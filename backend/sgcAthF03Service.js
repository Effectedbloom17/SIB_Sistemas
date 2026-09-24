/**
 * 1ATH-F-03 · Entrega - Recepción de EPP.
 * Archivero: una copia del Google Doc por entrega + PDF firmado en Drive.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-03';
const TEMPLATE_DRIVE_ID = '1wb0UqwXAF2-f-0qmX2RnBroD9mRF8UZg-qQetBhEElE';
const CARPETA_DRIVE_ID = '1sR2OcTU77AydynwgijT4R-pyb7R0CGsj';
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const SLOTS_EPP_PLANTILLA = 5;
const MAX_EQUIPOS = 20;

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '',
    fechaElaboracion: '',
    entregas: [],
    entregaActivaId: null
};

const TIPOS_ENTREGA = new Set(['ingreso', 'reposicion', 'cambio_puesto']);

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath03-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function normalizarSaltos(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const crudo = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(crudo)) return crudo.slice(0, 10);
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(crudo)) {
        return crudo.slice(0, 10);
    }
    const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
        let y = m[3];
        if (y.length === 2) y = `20${y}`;
        return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return '';
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso().slice(0, 10);
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || '1ATH-F-03 Entrega firmada.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarEquipo(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const cantidadRaw = base.cantidad;
    const cantidad = cantidadRaw === '' || cantidadRaw == null
        ? ''
        : String(cantidadRaw).trim();
    return {
        descripcion: normalizarSaltos(base.descripcion || ''),
        marca: normalizarSaltos(base.marca || ''),
        modelo: normalizarSaltos(base.modelo || ''),
        talla: normalizarSaltos(base.talla || ''),
        cantidad,
        estado: normalizarSaltos(base.estado || '')
    };
}

function equipoVacio(item) {
    const e = sanitizarEquipo(item);
    return !e.descripcion && !e.marca && !e.modelo && !e.talla && !e.cantidad && !e.estado;
}

function sanitizarEquipos(raw) {
    const lista = (Array.isArray(raw) ? raw : [])
        .map(sanitizarEquipo)
        .slice(0, MAX_EQUIPOS);
    if (!lista.length) lista.push(sanitizarEquipo({}));
    return lista;
}

function normalizarTipoEntrega(valor) {
    const t = String(valor || '').trim().toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_');
    if (t === 'reposicion' || t === 'reposicion_de_epp') return 'reposicion';
    if (t === 'cambio_de_puesto' || t === 'cambio_puesto' || t === 'cambio') return 'cambio_puesto';
    if (t === 'ingreso') return 'ingreso';
    return TIPOS_ENTREGA.has(t) ? t : '';
}

function textoTipoEntrega(tipo) {
    const marca = (clave) => (tipo === clave ? '☑' : '☐');
    return `Ingreso ${marca('ingreso')} / Reposición ${marca('reposicion')} / Cambio de puesto ${marca('cambio_puesto')}`;
}

function sanitizarPdfsHistorial(raw) {
    const lista = Array.isArray(raw) ? raw : [];
    const vistos = new Set();
    const salida = [];
    for (const item of lista) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || vistos.has(pdf.driveFileId)) continue;
        vistos.add(pdf.driveFileId);
        salida.push(pdf);
    }
    return salida;
}

function sanitizarEntrega(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    let pdfsHistorial = sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial);
    if (pdfFirmado && !pdfsHistorial.some((p) => p.driveFileId === pdfFirmado.driveFileId)) {
        pdfsHistorial = [pdfFirmado, ...pdfsHistorial];
    }
    if (!pdfFirmado && pdfsHistorial[0]) pdfFirmado = pdfsHistorial[0];
    return {
        id: String(base.id || '').trim() || nuevoId(),
        folio: String(base.folio || '').trim().toUpperCase(),
        nombreCompleto: normalizarSaltos(base.nombreCompleto || base.nombre_completo || ''),
        puesto: normalizarSaltos(base.puesto || ''),
        areaDepartamento: normalizarSaltos(base.areaDepartamento || base.area_departamento || ''),
        fechaIngreso: formatearFechaIso(base.fechaIngreso || base.fecha_ingreso),
        fechaEntrega: formatearFechaIso(base.fechaEntrega || base.fecha_entrega),
        tipoEntrega: normalizarTipoEntrega(base.tipoEntrega || base.tipo_entrega),
        observaciones: normalizarSaltos(base.observaciones || ''),
        equipos: sanitizarEquipos(base.equipos),
        nombreEntrego: normalizarSaltos(base.nombreEntrego || base.nombre_entrego || ''),
        nombreRecibio: normalizarSaltos(base.nombreRecibio || base.nombre_recibio || ''),
        driveFileId: String(base.driveFileId || base.drive_file_id || '').trim() || null,
        nombreArchivo: String(base.nombreArchivo || base.nombre_archivo || '').trim() || null,
        pdfFirmado,
        pdfsHistorial
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const entregas = (Array.isArray(base.entregas) ? base.entregas : []).map(sanitizarEntrega);
    const activoId = String(base.entregaActivaId || base.entrega_activa_id || '').trim();
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || '00',
        fechaRevision: formatearFechaIso(base.fechaRevision || base.fecha_revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion || base.fecha_elaboracion) || fechaHoyIso(),
        entregas,
        entregaActivaId: activoId && entregas.some((e) => e.id === activoId)
            ? activoId
            : (entregas[0]?.id || null)
    };
}

function resolverEntregaActiva(datos) {
    const d = sanitizarDatos(datos);
    return d.entregas.find((e) => e.id === d.entregaActivaId) || d.entregas[0] || null;
}

function nombreArchivoDrive(entrega) {
    const folio = String(entrega?.folio || '').trim() || 'sin-folio';
    const nombre = String(entrega?.nombreCompleto || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
    const base = nombre ? `1ATH-F-03 ${folio} ${nombre}` : `1ATH-F-03 ${folio}`;
    return base.slice(0, 180);
}

function nombrePdfFirmado(entrega, historial = []) {
    const folio = String(entrega?.folio || '').trim() || 'sin-folio';
    const base = `1ATH-F-03 ${folio} firmado`;
    const usados = new Set(
        (Array.isArray(historial) ? historial : [])
            .map((p) => String(p?.nombreArchivo || '').trim().toLowerCase())
            .filter(Boolean)
    );
    if (!usados.has(`${base}.pdf`.toLowerCase())) return `${base}.pdf`;
    let n = 2;
    while (usados.has(`${base} - ${String(n).padStart(2, '0')}.pdf`.toLowerCase())) n += 1;
    return `${base} - ${String(n).padStart(2, '0')}.pdf`;
}

function clienteGoogle() {
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    return {
        auth,
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

function extraerTablas(content) {
    const tablas = [];
    for (const el of content || []) {
        if (el?.table) {
            tablas.push({ startIndex: el.startIndex, table: el.table });
        }
    }
    return tablas;
}

function rangoEditableCelda(cell) {
    const content = Array.isArray(cell?.content) ? cell.content : [];
    if (!content.length) return null;
    const start = Number(content[0].startIndex);
    const endRaw = Number(content[content.length - 1].endIndex);
    if (!Number.isFinite(start) || !Number.isFinite(endRaw)) return null;
    return { start, end: endRaw - 1 };
}

async function asegurarFilasEpp(docsApi, docId, cantidad) {
    let faltan = Math.max(0, cantidad - SLOTS_EPP_PLANTILLA);
    while (faltan > 0) {
        const doc = await docsApi.documents.get({ documentId: docId });
        const tablas = extraerTablas(doc.data.body?.content);
        const tabla = tablas[2];
        if (!tabla) throw new Error('La plantilla 1ATH-F-03 no tiene la tabla de EPP.');
        const filas = tabla.table.tableRows?.length || 0;
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [{
                    insertTableRow: {
                        tableCellLocation: {
                            tableStartLocation: { index: tabla.startIndex },
                            rowIndex: Math.max(0, filas - 1),
                            columnIndex: 0
                        },
                        insertBelow: true
                    }
                }]
            }
        });
        faltan -= 1;
    }
}

function armarEscrituras(tablas, entrega) {
    const colab = tablas[0]?.table;
    const entregaTbl = tablas[1]?.table;
    const epp = tablas[2]?.table;
    const firmas = tablas[3]?.table;
    if (!colab || !entregaTbl || !epp || !firmas) {
        throw new Error('La plantilla 1ATH-F-03 no tiene las cuatro tablas esperadas.');
    }

    const equipos = (entrega.equipos || []).filter((e) => !equipoVacio(e));
    const filasDatos = Math.max(0, (epp.tableRows || []).length - 1);
    const escrituras = [];

    const push = (tabla, row, col, texto) => {
        const cell = tabla.tableRows?.[row]?.tableCells?.[col];
        const rango = rangoEditableCelda(cell);
        if (!rango) return;
        escrituras.push({ ...rango, texto: String(texto ?? '') });
    };

    push(colab, 0, 1, entrega.nombreCompleto);
    push(colab, 1, 1, entrega.puesto);
    push(colab, 2, 1, entrega.areaDepartamento);
    push(colab, 2, 3, formatearFechaDisplay(entrega.fechaIngreso));

    push(entregaTbl, 0, 1, formatearFechaDisplay(entrega.fechaEntrega));
    push(entregaTbl, 0, 3, textoTipoEntrega(entrega.tipoEntrega));
    push(entregaTbl, 1, 1, entrega.observaciones);

    for (let i = 0; i < filasDatos; i += 1) {
        const item = equipos[i] || sanitizarEquipo({});
        const row = i + 1;
        const tiene = !equipoVacio(item);
        push(epp, row, 0, tiene ? String(i + 1) : '');
        push(epp, row, 1, item.descripcion);
        push(epp, row, 2, item.marca);
        push(epp, row, 3, item.modelo);
        push(epp, row, 4, item.talla);
        push(epp, row, 5, item.cantidad);
        push(epp, row, 6, item.estado);
    }

    // Dos renglones en blanco para escribir la firma y el nombre a mano.
    const espacioFirma = '\n\n';
    push(firmas, 0, 0, espacioFirma);
    push(firmas, 0, 1, espacioFirma);
    return escrituras;
}

async function aplicarContenidoEnDocumento(docId, entrega) {
    const { docsApi } = clienteGoogle();
    const item = sanitizarEntrega(entrega);
    const equipos = (item.equipos || []).filter((e) => !equipoVacio(e));
    if (equipos.length > SLOTS_EPP_PLANTILLA) {
        await asegurarFilasEpp(docsApi, docId, equipos.length);
    }
    const doc = await docsApi.documents.get({ documentId: docId });
    const tablas = extraerTablas(doc.data.body?.content);
    const escrituras = armarEscrituras(tablas, item)
        .sort((a, b) => b.start - a.start);
    const requests = [];
    const firmasStart = tablas[3]?.startIndex;
    if (Number.isFinite(firmasStart)) {
        requests.push({
            updateTableRowStyle: {
                tableStartLocation: { index: firmasStart },
                rowIndices: [0],
                tableRowStyle: {
                    minRowHeight: { magnitude: 48, unit: 'PT' }
                },
                fields: 'minRowHeight'
            }
        });
    }
    for (const celda of escrituras) {
        if (celda.end > celda.start) {
            requests.push({
                deleteContentRange: {
                    range: { startIndex: celda.start, endIndex: celda.end }
                }
            });
        }
        if (celda.texto) {
            requests.push({
                insertText: {
                    location: { index: celda.start },
                    text: celda.texto
                }
            });
        }
    }
    if (!requests.length) return;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}

async function copiarPlantilla(nombreArchivo) {
    const { drive } = clienteGoogle();
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: String(nombreArchivo || '1ATH-F-03 Entrega - Recepción de EPP').trim(),
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true
    });
    if (copyResp?.data?.mimeType && copyResp.data.mimeType !== GOOGLE_DOC_MIME) {
        throw new Error('La copia de 1ATH-F-03 no quedó como Google Doc.');
    }
    if (!copyResp?.data?.id) {
        throw new Error('No se pudo crear el documento de entrega de EPP.');
    }
    return copyResp.data;
}

async function asegurarDocumentoEntrega(entrega) {
    const item = sanitizarEntrega(entrega);
    const nombre = nombreArchivoDrive(item);
    let driveFileId = item.driveFileId;
    if (driveFileId === TEMPLATE_DRIVE_ID) driveFileId = null;

    if (driveFileId) {
        const existe = await driveService.verificarArchivoExiste(driveFileId).catch(() => false);
        if (!existe) driveFileId = null;
    }
    if (!driveFileId) {
        const copia = await copiarPlantilla(nombre);
        driveFileId = copia.id;
    } else if (item.nombreArchivo !== nombre) {
        await driveService.renombrarArchivoPorId(driveFileId, nombre).catch((err) => {
            console.warn('[ATH-F-03] No se pudo renombrar documento:', err.message);
        });
    }
    await aplicarContenidoEnDocumento(driveFileId, item);
    return { driveFileId, nombreArchivo: nombre };
}

async function eliminarDocumentoTrabajo(fileId) {
    const id = String(fileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) return;
    await driveService.eliminarArchivo(id).catch((err) => {
        console.warn('[ATH-F-03] No se pudo eliminar el documento de trabajo:', err.message);
    });
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) return null;
    try {
        const parsed = typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function construirRespuesta(registro, datos) {
    const activa = resolverEntregaActiva(datos);
    const driveId = activa?.driveFileId && activa.driveFileId !== TEMPLATE_DRIVE_ID
        ? activa.driveFileId
        : null;
    const editorUrl = driveId ? `https://docs.google.com/document/d/${driveId}/edit?usp=sharing` : null;
    const previewUrl = driveId ? `https://docs.google.com/document/d/${driveId}/preview` : null;
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: registro?.ultima_sync_drive || null,
        entregaActivaId: activa?.id || null
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta(registro, datos);
}

function entregaTieneCaptura(entrega) {
    const e = sanitizarEntrega(entrega);
    if (e.folio || e.nombreCompleto || e.puesto || e.areaDepartamento || e.fechaEntrega || e.observaciones) {
        return true;
    }
    if (e.nombreEntrego || e.nombreRecibio || e.tipoEntrega || e.driveFileId || e.pdfFirmado) return true;
    return (e.equipos || []).some((item) => !equipoVacio(item));
}

async function procesarEntregasEnGuardado(datosEntrada, datosPrevios) {
    const previas = new Map((datosPrevios?.entregas || []).map((e) => [e.id, e]));
    const salida = [];
    const idsNuevos = new Set();

    for (const raw of datosEntrada.entregas) {
        const item = sanitizarEntrega(raw);
        idsNuevos.add(item.id);
        const prev = previas.get(item.id);
        if (!item.driveFileId && prev?.driveFileId) item.driveFileId = prev.driveFileId;
        if (!item.pdfFirmado && prev?.pdfFirmado) item.pdfFirmado = prev.pdfFirmado;
        if (!item.pdfsHistorial?.length && prev?.pdfsHistorial?.length) {
            item.pdfsHistorial = prev.pdfsHistorial;
        }
        if (entregaTieneCaptura(item)) {
            const doc = await asegurarDocumentoEntrega(item);
            item.driveFileId = doc.driveFileId;
            item.nombreArchivo = doc.nombreArchivo;
        }
        salida.push(item);
    }

    for (const prev of previas.values()) {
        if (!idsNuevos.has(prev.id) && prev.driveFileId) {
            await eliminarDocumentoTrabajo(prev.driveFileId);
        }
    }

    return sanitizarDatos({ ...datosEntrada, entregas: salida });
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    if (!fechaOriginal) fechaOriginal = datosEntrada.fechaElaboracion || fechaHoyIso();

    const datosProcesados = await procesarEntregasEnGuardado(datosEntrada, datosPrevios);
    const contenidoModificado = JSON.stringify(datosProcesados) !== JSON.stringify(datosPrevios);
    const fechaModificacion = contenidoModificado
        ? excelHistorial.fechaAhoraMexicoIso()
        : formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosProcesados,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado: contenidoModificado || !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosProcesados);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId: registro?.drive_file_id || null,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido,
        contenidoModificado: !!registro?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datos);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const existe = await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false);
    if (!existe) throw new Error('Plantilla 1ATH-F-03 no encontrada en Drive.');
    return {
        codigo: CODIGO_FORMATO,
        templateDriveId: TEMPLATE_DRIVE_ID,
        message: 'La plantilla 1ATH-F-03 está configurada. Cada entrega nueva se genera como copia independiente.'
    };
}

async function publicarPdfEnDrive(pdfBuffer, entrega, historial = []) {
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfFirmado(entrega, historial),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const entregaId = String(body?.entregaId || body?.entrega_id || '').trim();
    if (!entregaId) throw new Error('Se requiere entregaId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const entregas = [...datosPrevios.entregas];
    const idx = entregas.findIndex((e) => e.id === entregaId);
    if (idx < 0) {
        throw new Error('Guarda la entrega antes de subir el PDF firmado.');
    }

    const actual = { ...entregas[idx] };
    const historialPrevio = sanitizarPdfsHistorial(actual.pdfsHistorial);
    const driveResult = await publicarPdfEnDrive(pdfBuffer, actual, historialPrevio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfFirmado(actual, historialPrevio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });
    actual.pdfFirmado = pdfFirmado;
    actual.pdfsHistorial = [
        pdfFirmado,
        ...historialPrevio.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)
    ];
    entregas[idx] = actual;

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        entregas,
        entregaActivaId: entregaId
    });
    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return {
        ...construirRespuesta(registro, datosGuardar),
        pdfFirmado: actual.pdfFirmado
    };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const entregaId = String(body?.entregaId || body?.entrega_id || '').trim();
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!entregaId || !driveFileId) throw new Error('entregaId y driveFileId son requeridos.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const entregas = [...datosPrevios.entregas];
    const idx = entregas.findIndex((e) => e.id === entregaId);
    if (idx < 0) throw new Error('No se encontró la entrega.');

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[ATH-F-03] No se pudo borrar PDF en Drive:', err.message);
    });

    const actual = { ...entregas[idx] };
    const hist = sanitizarPdfsHistorial(actual.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = actual.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) pdfFirmado = hist[0] || null;
    actual.pdfsHistorial = hist;
    actual.pdfFirmado = pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null;
    entregas[idx] = actual;

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        entregas,
        entregaActivaId: entregaId
    });
    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: registroPrevio?.fecha_modificacion_contenido,
        contenidoModificado: !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar);
}

async function descargarPdfEntrega(pool, entregaId) {
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const id = String(entregaId || datos.entregaActivaId || '').trim();
    const entrega = datos.entregas.find((e) => e.id === id) || null;
    if (!entrega?.driveFileId) {
        throw new Error('Guarda la entrega antes de generar el PDF.');
    }
    return driveService.exportarArchivoPDF(entrega.driveFileId);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPdfEntrega
};
