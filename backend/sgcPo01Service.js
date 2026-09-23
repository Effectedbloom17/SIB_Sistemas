/**
 * SGC-PO-01 · Política de calidad — persistencia en biznaga_sgc y PDF en Drive (Formatos).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'SGC-PO-01';
const CARPETA_FORMATOS_DRIVE_ID = '1qA9FXEv3Cqpexps1Zx_E6WrQJwDhRNpw';
const TEMPLATE_DRIVE_ID = '1lTfkG06cJxVKx4oQWtwXkCojVGnDByNZ';
const NOMBRE_PLANTILLA_DOCX = 'SGC-PO-01 Politica de calidad_Biznaga.docx';
const NOMBRE_PDF_ARCHIVO = 'SGC-PO-01 Politica de calidad_Biznaga.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-09',
    revision: '01',
    politica:
        'En Biznaga Risk and Tech brindamos el servicio oportuno y confiable de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión. Cumplimos con todos los requisitos aplicables y mejoramos continuamente nuestro sistema de gestión de calidad para alcanzar la satisfacción de nuestros clientes.',
    firmante: 'Marisol Azucena Santillán Melo',
    cargoFirmante: 'DIRECTORA GENERAL',
    pdfFirmado: null,
    pdfsHistorial: []
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const y = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const min = String(dt.getUTCMinutes()).padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${min}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** SGC-PO-01 ... - MM/YY - 01.pdf (legado: ... - MM/YY.pdf) */
function siguienteVersionPdf(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const prefijo = `${base} - ${mm}/${yy}`;
    let max = 0;
    const fuentes = Array.isArray(historialDrive) ? historialDrive : [];
    const seen = new Set();
    for (const p of fuentes) {
        const n = String(p?.nombreArchivo || p?.name || '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const mVer = n.match(new RegExp(`^${escaparRegex(prefijo)} - (\\d{1,2})\\.pdf$`, 'i'));
        if (mVer) {
            max = Math.max(max, parseInt(mVer[1], 10) || 0);
            continue;
        }
        if (new RegExp(`^${escaparRegex(prefijo)}\\.pdf$`, 'i').test(n)) {
            max = Math.max(max, 1);
        }
    }
    return String(max + 1).padStart(2, '0');
}

function nombrePdfHistorial(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const version = siguienteVersionPdf(iso, historialDrive);
    return `${base} - ${mm}/${yy} - ${version}.pdf`;
}

function esNombrePdfDelFormato(nombre) {
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const n = String(nombre || '').trim();
    return n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()
        || new RegExp(`^${escaparRegex(base)} - \\d{2}/\\d{2}( - \\d{1,2})?\\.pdf$`, 'i').test(n);
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        politica: normalizarSaltosLinea(raw.politica),
        firmante: String(raw.firmante || '').trim(),
        cargoFirmante: String(raw.cargoFirmante || '').trim(),
        revision: String(raw.revision || DATOS_DEFECTO.revision).trim(),
        fechaElaboracion: formatearFechaIso(raw.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion
    };
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    return {
        politica: base.politica,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante,
        revision: base.revision,
        fechaElaboracion: base.fechaElaboracion
    };
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = String(textoNuevo ?? '');
    if (!anterior.trim() || anterior === nuevo) {
        return null;
    }
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: false },
            replaceText: nuevo
        }
    };
}

async function copiarPlantillaComoGoogleDoc() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: `_temp_sgc_po01_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo convertir la plantilla Word a Google Doc.');
    }
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

async function sincronizarPlantillaGoogleDoc(datos, snapshotAnterior) {
    const snapshot = snapshotPlantillaDesdeDatos(snapshotAnterior || DATOS_DEFECTO);
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarPlantillaComoGoogleDoc();

    try {
        const requests = [
            crearReplaceRequest(textoParrafoDoc(snapshot.politica), textoParrafoDoc(destino.politica)),
            crearReplaceRequest(textoParrafoDoc(snapshot.firmante), textoParrafoDoc(destino.firmante)),
            crearReplaceRequest(textoParrafoDoc(snapshot.cargoFirmante), textoParrafoDoc(destino.cargoFirmante)),
            crearReplaceRequest(
                `No. Rev: ${String(snapshot.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`,
                `No. Rev: ${String(destino.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`
            ),
            crearReplaceRequest(
                `Fecha: ${formatearFechaPlantillaDoc(snapshot.fechaElaboracion)}`,
                `Fecha: ${formatearFechaPlantillaDoc(destino.fechaElaboracion)}`
            )
        ].filter(Boolean);

        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }

        const docxResp = await drive.files.export(
            { fileId: docId, mimeType: DOCX_MIME },
            { responseType: 'arraybuffer' }
        );
        const docxBuffer = Buffer.from(docxResp.data);

        await driveService.reemplazarArchivoEnDrive(
            TEMPLATE_DRIVE_ID,
            docxBuffer,
            DOCX_MIME,
            NOMBRE_PLANTILLA_DOCX
        );

        return {
            actualizado: requests.length > 0,
            plantillaSync: destino
        };
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[SGC-PO-01] No se pudo eliminar copia temporal de plantilla:', err.message);
        }
    }
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || NOMBRE_PDF_ARCHIVO).trim()
            || NOMBRE_PDF_ARCHIVO,
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarPdfsHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || seen.has(pdf.driveFileId)) continue;
        seen.add(pdf.driveFileId);
        out.push(pdf);
    }
    return out;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        politica: normalizarSaltosLinea(base.politica || DATOS_DEFECTO.politica),
        firmante: String(base.firmante || DATOS_DEFECTO.firmante).trim(),
        cargoFirmante: String(base.cargoFirmante || DATOS_DEFECTO.cargoFirmante).trim(),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial),
        plantillaSync
    };
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    return {
        empresa: base.empresa,
        politica: base.politica,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(extraerContenidoEditable(a)) === JSON.stringify(extraerContenidoEditable(b));
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

async function listarPdfsHistorialDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_FORMATOS_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))
        .map((f) => sanitizarPdfFirmado({
            driveFileId: f.id,
            nombreArchivo: f.name || NOMBRE_PDF_ARCHIVO,
            webViewLink: f.webViewLink || null,
            fechaSubida: f.modifiedTime || fechaHoyIso()
        }))
        .filter(Boolean);
}

async function buscarPdfEnFormatos() {
    const lista = await listarPdfsHistorialDrive();
    return lista[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) {
            return sanitizarPdfFirmado(pdfDb);
        }
    }

    const lista = await listarPdfsHistorialDrive().catch(() => []);
    if (lista[0]?.driveFileId) {
        return lista[0];
    }
    return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
}

function construirRespuesta(registro, datos, historialPdfs = []) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;

    const historialDb = sanitizarPdfsHistorial(datos.pdfsHistorial);
    const historialDrive = Array.isArray(historialPdfs) ? historialPdfs : [];
    const historialUnido = sanitizarPdfsHistorial([
        ...historialDb,
        ...historialDrive
    ]).sort((a, b) => new Date(b.fechaSubida || 0) - new Date(a.fechaSubida || 0));

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            pdfFirmado,
            pdfsHistorial: historialDb.length ? historialDb : historialUnido
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: historialUnido,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);

    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, {
                pdfDriveFileId: pdfResuelto.driveFileId,
                datos,
                fechaElaboracionOriginal: registro.fecha_elaboracion_original,
                fechaModificacionContenido: registro.fecha_modificacion_contenido,
                contenidoModificado: !!registro.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            ultima_sync_drive: null
        };
    }

    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datos, historialPdfs);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let revision = datosEntrada.revision || DATOS_DEFECTO.revision;

    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

    let datosPrevios = null;
    if (registroPrevio?.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    if (datosPrevios) {
        revision = datosPrevios.revision;
    }

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const huboCambioContenido = datosPrevios
        ? !contenidoEsEquivalente(datosPrevios, datosEntrada)
        : !contenidoEsEquivalente(DATOS_DEFECTO, datosEntrada);

    if (huboCambioContenido && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        empresa: datosEntrada.empresa,
        politica: datosEntrada.politica,
        firmante: datosEntrada.firmante,
        cargoFirmante: datosEntrada.cargoFirmante,
        revision,
        fechaElaboracion,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        plantillaSync: datosPrevios?.plantillaSync || null
    };

    if (huboCambioContenido && origen !== 'consulta') {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(
                datosGuardar,
                datosPrevios || DATOS_DEFECTO
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
        } catch (err) {
            console.error('[SGC-PO-01] Error sincronizando plantilla Word en Drive:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const historialDrivePrev = await listarPdfsHistorialDrive().catch(() => []);
    const nombreArchivo = nombrePdfHistorial(fechaHoyIso(), historialDrivePrev);
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_FORMATOS_DRIVE_ID
    );

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const histPrev = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial);
    const pdfsHistorial = [pdfFirmado, ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)];

    const datosGuardar = { ...datosPrevios, pdfFirmado, pdfsHistorial };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        pdfDriveFileId: pdfFirmado.driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return { ...construirRespuesta(registro, datosGuardar, historialPdfs), pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[SGC-PO-01] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const datosGuardar = {
        ...datosPrevios,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: hist
    };

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registroPrevio?.fecha_modificacion_contenido),
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

async function descargarPlantillaPdf(pool) {
    const respuesta = await cargarFormato(pool);
    const datos = respuesta.datos;
    const snapshot = datos.plantillaSync || snapshotPlantillaDesdeDatos(datos);

    try {
        const syncResult = await sincronizarPlantillaGoogleDoc(datos, snapshot);
        if (syncResult.plantillaSync) {
            const registro = await obtenerRegistroDb(pool);
            const datosActuales = (await leerDatosRegistro(registro)) || datos;
            const datosActualizados = {
                ...datosActuales,
                plantillaSync: syncResult.plantillaSync
            };
            await guardarRegistroDb(pool, {
                pdfDriveFileId: datosActualizados.pdfFirmado?.driveFileId || null,
                datos: datosActualizados,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
        }
    } catch (err) {
        console.warn('[SGC-PO-01] Descarga PDF: sync parcial, exportando plantilla actual:', err.message);
    }

    return driveService.exportarArchivoPDF(TEMPLATE_DRIVE_ID);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    sanitizarDatos
};
