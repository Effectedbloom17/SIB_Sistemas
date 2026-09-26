/**
 * ATH-F-07 · Programa de Capacitación — archivero de Google Docs + PDF firmados / historial.
 * Folio: PC-YY-NNN
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-07';
/** Plantilla maestra (Google Doc / Word). */
const TEMPLATE_DRIVE_ID = '1r2jJZXzF6-9z2upxZW03U9fR54vJOg52Oo0JTvag4Jc';
/** Carpeta donde se clonan los programas para gestión. */
const CARPETA_DRIVE_ID = '1-oOq3LUUVXzANIDYQ1N8llcGyAzFrZVy';
/** Carpeta de documentos firmados e historial. */
const CARPETA_PDF_FIRMADOS_ID = '1ltHFN6eu4GxTgxSqg276dBJK1ee-cUbB';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OFFICE_DOC_MIMES = new Set([
    DOCX_MIME,
    'application/msword'
]);

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-28',
    fechaElaboracion: '2025-01-28',
    programas: [],
    programaActivoId: null
};

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath07-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso().slice(0, 10);
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const crudo = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(crudo)) return crudo;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            let y = m[3];
            if (y.length === 2) y = `20${y}`;
            return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        }
        return crudo.slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearDatetimeMysqlMexico(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string' && !fecha.includes('T')) {
        const [datePart, timePart = '00:00:00'] = fecha.trim().split(/\s+/);
        const [y, m, d] = datePart.split('-');
        const [hh, mm] = timePart.split(':');
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return String(fecha);
    const parts = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(dt);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

function anioCortoFolio(fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    return iso.slice(2, 4);
}

function normalizarFolio(folio) {
    const limpio = String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = limpio.match(/^PC-\d{2}-\d{3}$/);
    return m ? m[0] : limpio.slice(0, 40);
}

function parsearConsecutivoFolio(folio) {
    const norm = normalizarFolio(folio);
    const m = norm.match(/^PC-(\d{2})-(\d{3})$/);
    if (!m) return null;
    return { anio: m[1], consecutivo: Number(m[2]) };
}

function generarSiguienteFolio(programas = [], fechaIso = fechaHoyIso()) {
    const yy = anioCortoFolio(fechaIso);
    let max = 0;
    for (const p of programas) {
        const parsed = parsearConsecutivoFolio(p?.folio);
        if (parsed && parsed.anio === yy && parsed.consecutivo > max) {
            max = parsed.consecutivo;
        }
    }
    return `PC-${yy}-${String(max + 1).padStart(3, '0')}`;
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    const nombreArchivo = String(raw.nombreArchivo || raw.nombre_archivo || 'documento-firmado.pdf').trim()
        || 'documento-firmado.pdf';
    const webViewLink = raw.webViewLink || raw.web_view_link
        || `https://drive.google.com/file/d/${driveFileId}/view`;
    return {
        driveFileId,
        nombreArchivo,
        webViewLink,
        previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso(),
        nota: String(raw.nota || '').trim().slice(0, 200)
    };
}

function sanitizarHistorial(raw) {
    const lista = Array.isArray(raw) ? raw : [];
    return lista.map(sanitizarPdfFirmado).filter(Boolean);
}

function sanitizarCurso(raw, index = 0) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const fecha = formatearFechaIso(base.fechaRealizacion || base.fecha || '');
    return {
        id: String(base.id || nuevoId()).trim() || nuevoId(),
        numero: Number(base.numero) > 0 ? Number(base.numero) : index + 1,
        curso: String(base.curso || base.cursoCapacitacion || '').trim().slice(0, 300),
        objetivo: String(base.objetivo || '').trim().slice(0, 500),
        fechaRealizacion: fecha,
        lugar: String(base.lugar || '').trim().slice(0, 180),
        duracion: String(base.duracion || base.duracionCurso || '').trim().slice(0, 80),
        instructor: String(base.instructor || '').trim().slice(0, 180),
        dirigidoA: String(base.dirigidoA || base.dirigido || '').trim().slice(0, 180),
        observaciones: String(base.observaciones || '').trim().slice(0, 400)
    };
}

function cursoVacio(curso) {
    if (!curso) return true;
    return ![curso.curso, curso.objetivo, curso.fechaRealizacion, curso.lugar, curso.duracion, curso.instructor, curso.dirigidoA, curso.observaciones]
        .some((v) => String(v || '').trim());
}

function sanitizarCursos(raw) {
    const lista = Array.isArray(raw) ? raw : [];
    return lista.map((c, i) => sanitizarCurso(c, i));
}

function sanitizarPrograma(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const folio = normalizarFolio(base.folio) || '';
    const anio = String(base.anio || base.año || '').trim().slice(0, 4);
    const cursos = sanitizarCursos(base.cursos);
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    let historialFirmados = sanitizarHistorial(base.historialFirmados || base.historial_firmados);
    if (pdfFirmado) {
        historialFirmados = historialFirmados.filter((h) => h.driveFileId !== pdfFirmado.driveFileId);
    }
    return {
        id: String(base.id || nuevoId()).trim() || nuevoId(),
        folio,
        anio: anio || (() => {
            const m = folio.match(/^PC-(\d{2})-/);
            return m ? `20${m[1]}` : String(new Date().getFullYear());
        })(),
        cursos,
        elaboroPuesto: String(base.elaboroPuesto || base.elaboro?.puesto || '').trim().slice(0, 120),
        revisoPuesto: String(base.revisoPuesto || base.reviso?.puesto || '').trim().slice(0, 120),
        aproboPuesto: String(base.aproboPuesto || base.aprobo?.puesto || '').trim().slice(0, 120),
        driveFileId: String(base.driveFileId || base.drive_file_id || '').trim() || null,
        nombreArchivo: String(base.nombreArchivo || base.nombre_archivo || '').trim() || null,
        fechaCreacion: formatearFechaIso(base.fechaCreacion || base.fecha_creacion) || fechaHoyIso(),
        fechaActualizacion: formatearFechaIso(base.fechaActualizacion || base.fecha_actualizacion) || null,
        pdfFirmado,
        historialFirmados,
        borrador: base.borrador === true || base.borrador === 1 || base.borrador === '1'
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const programas = (Array.isArray(base.programas) ? base.programas : [])
        .map(sanitizarPrograma)
        .filter((p) => p.folio || p.cursos.some((c) => !cursoVacio(c)) || p.driveFileId);
    const activoId = String(base.programaActivoId || base.programa_activo_id || '').trim();
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        programas,
        programaActivoId: activoId && programas.some((p) => p.id === activoId)
            ? activoId
            : (programas[0]?.id || null)
    };
}

function resolverProgramaActivo(datos) {
    const d = sanitizarDatos(datos);
    return d.programas.find((p) => p.id === d.programaActivoId) || d.programas[0] || null;
}

function nombreArchivoDrive(programa) {
    const folio = normalizarFolio(programa?.folio);
    const anio = String(programa?.anio || '').trim();
    if (folio && anio) return `ATH-F-07 Programa de Capacitación ${anio} (${folio})`;
    if (folio) return `ATH-F-07 Programa de Capacitación (${folio})`;
    return 'ATH-F-07 Programa de Capacitación';
}

function nombrePdfFirmado(programa, esHistorial = false) {
    const folio = normalizarFolio(programa?.folio) || 'sin-folio';
    const stamp = esHistorial
        ? ` ${excelHistorial.fechaAhoraMexicoIso().replace(/[:T]/g, '-').slice(0, 16)}`
        : '';
    return `ATH-F-07 ${folio} firmado${stamp}.pdf`;
}

function clienteGoogle() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    return {
        auth,
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

function extraerTablas(content, salida = []) {
    for (const el of content || []) {
        if (!el?.table) continue;
        salida.push({ startIndex: el.startIndex, table: el.table });
        for (const row of el.table.tableRows || []) {
            for (const cell of row.tableCells || []) {
                extraerTablas(cell.content, salida);
            }
        }
    }
    return salida;
}

function textoCelda(cell) {
    let texto = '';
    for (const el of cell?.content || []) {
        for (const part of el?.paragraph?.elements || []) {
            texto += part?.textRun?.content || '';
        }
    }
    return texto.replace(/\u000b/g, ' ').replace(/\n/g, ' ').trim();
}

function rangoEditableCelda(cell) {
    const content = Array.isArray(cell?.content) ? cell.content : [];
    if (!content.length) return null;
    const start = Number(content[0].startIndex);
    const endRaw = Number(content[content.length - 1].endIndex);
    if (!Number.isFinite(start) || !Number.isFinite(endRaw)) return null;
    return { start, end: endRaw - 1 };
}

function tablaContiene(tabla, fragmento) {
    const needle = String(fragmento || '').toLowerCase();
    for (const row of tabla?.table?.tableRows || []) {
        for (const cell of row?.tableCells || []) {
            if (textoCelda(cell).toLowerCase().includes(needle)) return true;
        }
    }
    return false;
}

function indiceColumna(tabla, fragmento) {
    const header = tabla?.table?.tableRows?.[0]?.tableCells || [];
    const needle = String(fragmento || '').toLowerCase();
    for (let i = 0; i < header.length; i += 1) {
        if (textoCelda(header[i]).toLowerCase().includes(needle)) return i;
    }
    return -1;
}

function formatearFechaDoc(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

async function asegurarFilasCurso(docsApi, docId, filasNecesarias) {
    let guard = 0;
    while (guard < 40) {
        const doc = await docsApi.documents.get({ documentId: docId });
        const tablas = extraerTablas(doc.data.body?.content);
        const tabla = tablas.find((t) => tablaContiene(t, 'curso de capacit'));
        if (!tabla) return;
        const filasDatos = Math.max(0, (tabla.table.tableRows || []).length - 1);
        if (filasDatos >= filasNecesarias) return;
        const last = Math.max(0, (tabla.table.tableRows || []).length - 1);
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [{
                    insertTableRow: {
                        tableCellLocation: {
                            tableStartLocation: { index: tabla.startIndex },
                            rowIndex: last,
                            columnIndex: 0
                        },
                        insertBelow: true
                    }
                }]
            }
        });
        guard += 1;
    }
}

async function aplicarCursosEnDocumento(docId, programa) {
    if (!docId) return;
    const { docsApi } = clienteGoogle();
    const cursos = (programa.cursos || []).filter((c) => !cursoVacio(c));
    const minFilas = Math.max(4, cursos.length);
    await asegurarFilasCurso(docsApi, docId, minFilas);
    const doc = await docsApi.documents.get({ documentId: docId });
    const tablas = extraerTablas(doc.data.body?.content);
    const cursosTbl = tablas.find((t) => tablaContiene(t, 'curso de capacit'));
    if (!cursosTbl) {
        throw new Error('No se encontró la tabla de cursos en el documento ATH-F-07.');
    }

    const col = {
        no: indiceColumna(cursosTbl, 'no'),
        curso: indiceColumna(cursosTbl, 'curso'),
        objetivo: indiceColumna(cursosTbl, 'objetivo'),
        fecha: indiceColumna(cursosTbl, 'fecha'),
        lugar: indiceColumna(cursosTbl, 'lugar'),
        duracion: indiceColumna(cursosTbl, 'duraci'),
        instructor: indiceColumna(cursosTbl, 'instructor'),
        dirigido: indiceColumna(cursosTbl, 'dirigido'),
        observaciones: indiceColumna(cursosTbl, 'observ')
    };
    const filasDatos = Math.max(0, (cursosTbl.table.tableRows || []).length - 1);
    const escrituras = [];
    const push = (tabla, row, column, texto) => {
        if (column < 0) return;
        const cell = tabla.table.tableRows?.[row]?.tableCells?.[column];
        const rango = rangoEditableCelda(cell);
        if (!rango) return;
        escrituras.push({ ...rango, texto: String(texto ?? '') });
    };

    for (let i = 0; i < filasDatos; i += 1) {
        const item = cursos[i] || null;
        const row = i + 1;
        push(cursosTbl, row, col.no, item ? String(i + 1) : '');
        push(cursosTbl, row, col.curso, item?.curso || '');
        push(cursosTbl, row, col.objetivo, item?.objetivo || '');
        push(cursosTbl, row, col.fecha, item ? formatearFechaDoc(item.fechaRealizacion) : '');
        push(cursosTbl, row, col.lugar, item?.lugar || '');
        push(cursosTbl, row, col.duracion, item?.duracion || '');
        push(cursosTbl, row, col.instructor, item?.instructor || '');
        push(cursosTbl, row, col.dirigido, item?.dirigidoA || '');
        push(cursosTbl, row, col.observaciones, item?.observaciones || '');
    }

    const requests = [];
    for (const celda of escrituras.sort((a, b) => b.start - a.start)) {
        if (celda.end > celda.start) {
            requests.push({
                deleteContentRange: { range: { startIndex: celda.start, endIndex: celda.end } }
            });
        }
        if (celda.texto) {
            requests.push({
                insertText: { location: { index: celda.start }, text: celda.texto }
            });
        }
    }
    if (!requests.length) return;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}

async function resolverTemplateSourceId() {
    const { drive } = clienteGoogle();
    const meta = await drive.files.get({
        fileId: TEMPLATE_DRIVE_ID,
        fields: 'id,mimeType,shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });
    let sourceId = TEMPLATE_DRIVE_ID;
    let mimeType = String(meta?.data?.mimeType || '').trim();
    if (mimeType === 'application/vnd.google-apps.shortcut') {
        sourceId = String(meta?.data?.shortcutDetails?.targetId || '').trim() || sourceId;
        mimeType = String(meta?.data?.shortcutDetails?.targetMimeType || '').trim();
    }
    return { sourceId, mimeType };
}

async function copiarPlantillaComoGoogleDoc(nombreArchivo) {
    const { drive } = clienteGoogle();
    const { sourceId, mimeType } = await resolverTemplateSourceId();
    const esGoogleDoc = mimeType === GOOGLE_DOC_MIME;
    const esOffice = OFFICE_DOC_MIMES.has(mimeType);
    if (!esGoogleDoc && !esOffice) {
        throw new Error(
            `Plantilla ATH-F-07 incompatible (${mimeType || 'desconocido'}). Usa Google Docs o Word.`
        );
    }
    const body = {
        name: String(nombreArchivo || 'ATH-F-07 Programa de Capacitación').trim(),
        parents: [CARPETA_DRIVE_ID]
    };
    if (!esGoogleDoc) {
        body.mimeType = GOOGLE_DOC_MIME;
    }
    const copyResp = await drive.files.copy({
        fileId: sourceId,
        requestBody: body,
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo crear el programa desde la plantilla ATH-F-07.');
    }
    return copyResp.data;
}

async function asegurarDocumentoPrograma(programa) {
    const nombreDeseado = nombreArchivoDrive(programa);
    let driveFileId = programa.driveFileId;
    let nombre = programa.nombreArchivo || nombreDeseado;

    if (!driveFileId) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreDeseado);
        return {
            driveFileId: copia.id,
            nombreArchivo: copia.name || nombreDeseado,
            borrador: false
        };
    }

    const existe = await driveService.verificarArchivoExiste(driveFileId).catch(() => false);
    if (!existe) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreDeseado);
        return {
            driveFileId: copia.id,
            nombreArchivo: copia.name || nombreDeseado,
            borrador: false
        };
    }

    if (nombre !== nombreDeseado) {
        await driveService.renombrarArchivoPorId(driveFileId, nombreDeseado).catch((err) => {
            console.warn('[ATH-F-07] No se pudo renombrar documento:', err.message);
        });
        nombre = nombreDeseado;
    }

    return { driveFileId, nombreArchivo: nombre, borrador: false };
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

function construirRespuesta(registro, datos, opciones = {}) {
    const activo = resolverProgramaActivo(datos);
    const driveId = activo?.driveFileId || null;
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
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive) || null,
        programaActivoId: activo?.id || null,
        siguienteFolioSugerido: opciones.siguienteFolioSugerido || generarSiguienteFolio(datos.programas),
        carpetaProgramasUrl: `https://drive.google.com/drive/folders/${CARPETA_DRIVE_ID}`,
        carpetaFirmadosUrl: `https://drive.google.com/drive/folders/${CARPETA_PDF_FIRMADOS_ID}`
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta(registro, datos, {
        siguienteFolioSugerido: generarSiguienteFolio(datos.programas)
    });
}

async function procesarProgramasEnGuardado(datosEntrada, datosPrevios) {
    const prevMap = new Map((datosPrevios?.programas || []).map((p) => [p.id, p]));
    const salida = [];
    const avisos = [];

    for (const raw of datosEntrada.programas) {
        const item = sanitizarPrograma(raw);
        const prev = prevMap.get(item.id);

        if (!item.folio) {
            item.folio = generarSiguienteFolio([
                ...salida,
                ...(datosPrevios?.programas || []).filter((p) => p.id !== item.id)
            ]);
        }

        const debeMaterializar = !item.borrador || !!item.driveFileId || !!prev?.driveFileId;
        if (debeMaterializar) {
            try {
                const doc = await asegurarDocumentoPrograma({
                    ...item,
                    driveFileId: item.driveFileId || prev?.driveFileId || null
                });
                item.driveFileId = doc.driveFileId;
                item.nombreArchivo = doc.nombreArchivo;
                item.borrador = false;
                item.fechaActualizacion = fechaHoyIso();
                await aplicarCursosEnDocumento(item.driveFileId, item);
            } catch (err) {
                console.error('[ATH-F-07] Guardado en sistema ok; Drive falló:', err.message);
                avisos.push(err.message || 'No se pudo actualizar el documento en Drive.');
            }
        }

        if (prev?.pdfFirmado && item.pdfFirmado === undefined) {
            item.pdfFirmado = prev.pdfFirmado;
        }
        if (prev?.historialFirmados?.length && !Array.isArray(raw.historialFirmados) && !Array.isArray(raw.historial_firmados)) {
            item.historialFirmados = prev.historialFirmados;
        }

        salida.push(item);
    }

    return {
        datos: sanitizarDatos({
            ...datosEntrada,
            programas: salida
        }),
        avisos
    };
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
        return sincronizarDesdeDrive(pool, body);
    }

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const procesado = await procesarProgramasEnGuardado(datosEntrada, datosPrevios);
    const datosProcesados = procesado.datos;
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
    const respuesta = construirRespuesta(registro, datosProcesados);
    if (procesado.avisos?.length) {
        respuesta.avisosDrive = procesado.avisos;
    }
    return respuesta;
}

async function sincronizarDesdeDrive(pool, body = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const activaId = String(body?.programaActivoId || body?.programa_id || datos.programaActivoId || '').trim();
    if (activaId) {
        datos.programaActivoId = activaId;
    }
    await guardarRegistroDb(pool, {
        driveFileId: null,
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
    if (!existe) {
        throw new Error('Plantilla ATH-F-07 no encontrada en Drive.');
    }
    return {
        codigo: CODIGO_FORMATO,
        templateDriveId: TEMPLATE_DRIVE_ID,
        message: 'La plantilla maestra ATH-F-07 está configurada. Los programas nuevos se generan como copia independiente.'
    };
}

async function publicarPdfEnDrive(pdfBuffer, programa, archivar = false) {
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfFirmado(programa, archivar),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const programaId = String(body?.programaId || body?.programa_id || '').trim();
    if (!programaId) throw new Error('Se requiere programaId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const nota = String(body?.nota || body?.comentario || '').trim().slice(0, 200);

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const programas = [...datosPrevios.programas];
    const idx = programas.findIndex((p) => p.id === programaId);
    if (idx < 0) {
        throw new Error('No se encontró el programa indicado en el archivero.');
    }

    const actual = { ...programas[idx] };
    if (!actual.folio) {
        actual.folio = generarSiguienteFolio(programas);
    }

    const historial = [...(actual.historialFirmados || [])];
    if (actual.pdfFirmado?.driveFileId) {
        historial.unshift({
            ...actual.pdfFirmado,
            nota: actual.pdfFirmado.nota || 'Versión anterior'
        });
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, actual, false);
    actual.pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfFirmado(actual),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso(),
        nota
    });
    actual.historialFirmados = historial
        .map(sanitizarPdfFirmado)
        .filter((h) => h && h.driveFileId !== actual.pdfFirmado.driveFileId)
        .slice(0, 40);
    actual.fechaActualizacion = fechaHoyIso();

    if (actual.driveFileId || !actual.borrador) {
        const doc = await asegurarDocumentoPrograma(actual);
        actual.driveFileId = doc.driveFileId;
        actual.nombreArchivo = doc.nombreArchivo;
        actual.borrador = false;
    }

    programas[idx] = actual;
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        programas,
        programaActivoId: programaId
    });

    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const registro = await obtenerRegistroDb(pool);
    const respuesta = construirRespuesta(registro, datosGuardar);
    return {
        ...respuesta,
        pdfFirmado: actual.pdfFirmado,
        historialFirmados: actual.historialFirmados
    };
}

const OPCIONES_PDF_IMPRESION = {
    landscape: true,
    size: 'letter',
    margins: 'predeterminados'
};

async function descargarPdfPrograma(pool, programaId) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registro)) || { ...DATOS_DEFECTO, programas: [] };
    const id = String(programaId || '').trim();
    let actual = id
        ? (datosPrevios.programas || []).find((p) => p.id === id)
        : resolverProgramaActivo(datosPrevios);
    if (!actual) {
        throw new Error('No hay programa seleccionado para descargar el PDF.');
    }

    const doc = await asegurarDocumentoPrograma(actual);
    actual = sanitizarPrograma({
        ...actual,
        driveFileId: doc.driveFileId,
        nombreArchivo: doc.nombreArchivo,
        borrador: false
    });

    const programas = (datosPrevios.programas || []).map((p) =>
        p.id === actual.id ? actual : p
    );
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        programas,
        programaActivoId: actual.id
    });
    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const pdfBuffer = await driveService.exportarArchivoPDF(doc.driveFileId, OPCIONES_PDF_IMPRESION);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF del programa quedó vacía.');
    }

    const etiqueta = String(actual.folio || actual.titulo || 'programa')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'programa';
    return {
        pdfBuffer: Buffer.from(pdfBuffer),
        nombreArchivo: `ATH-F-07 ${etiqueta}.pdf`,
        folio: actual.folio,
        programaId: actual.id,
        driveFileId: doc.driveFileId
    };
}

function crearProgramaVacio(programas = []) {
    const folio = generarSiguienteFolio(programas);
    const anio = `20${anioCortoFolio()}`;
    return sanitizarPrograma({
        id: nuevoId(),
        folio,
        anio,
        cursos: [sanitizarCurso({}, 0)],
        borrador: true,
        fechaCreacion: fechaHoyIso()
    });
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_PDF_FIRMADOS_ID,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    descargarPdfPrograma,
    sanitizarDatos,
    sanitizarPrograma,
    crearProgramaVacio,
    generarSiguienteFolio,
    resolverProgramaActivo
};
