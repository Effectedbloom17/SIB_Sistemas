/**
 * SGC-PO-01 · Política de calidad — persistencia en biznaga_sgc y documento de trabajo en Drive.
 *
 * Flujo plantilla → sistema (docs/GUIA-PLANTILLA-WORD-SGC.md):
 * - Plantilla externa (solo lectura): {{codigo}} {{num_rev}} {{fecha}} {{politica_calidad}}.
 * - Documento sistema: copia de trabajo en CARPETA_DRIVE_ID.
 * - Words viejos al regenerar (cambio de rev / plantilla): CARPETA_HISTORIAL_DRIVE_ID.
 * - Código / No. Rev / Fecha se rescatan de Lista Maestra (sgc_formato_metadatos / F-01).
 */
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { google } = require('googleapis');
const driveService = require('./driveService');
const pdfDescargaCache = require('./sgcPdfDescargaCache');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'SGC-PO-01';
/** Carpeta del Word vigente y de los PDF firmados. */
const CARPETA_DRIVE_ID = '1qA9FXEv3Cqpexps1Zx_E6WrQJwDhRNpw';
/** Historial de Versiones — Words sistema previos. */
const CARPETA_HISTORIAL_DRIVE_ID = '1YtwfRsNyZa8ToctuUADeWpYe62cj3PVr';
/** Plantilla maestra Word (solo lectura / files.copy). */
const TEMPLATE_DRIVE_ID = '1xzgZ9xcm414a-wV5iy_iF8fT-lMNCUxT';
/**
 * Subir cuando cambien placeholders o la estructura que el sync debe rellenar.
 * Si el dato guardado es menor, el siguiente load archiva y regenera.
 */
const PLANTILLA_CONTENIDO_VERSION = 1;
const NOMBRE_DOCUMENTO_SISTEMA = 'SGC-PO-01 Politica de calidad (sistema).docx';
const NOMBRE_PDF_ARCHIVO = 'SGC-PO-01 Politica de calidad_Biznaga.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-09',
    fechaRevision: '2025-07-09',
    revision: '00',
    politica:
        'En Biznaga Risk and Tech brindamos el servicio oportuno y confiable de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión. Cumplimos con todos los requisitos aplicables y mejoramos continuamente nuestro sistema de gestión de calidad para alcanzar la satisfacción de nuestros clientes.',
    firmante: 'Marisol Azucena Santillán Melo',
    cargoFirmante: 'DIRECTORA GENERAL',
    pdfFirmado: null,
    pdfsHistorial: [],
    documentoSistemaDriveFileId: null,
    plantillaSistemaDriveFileId: null,
    plantillaOrigenDriveId: null,
    plantillaContenidoVersion: 0,
    plantillaDriveFileId: TEMPLATE_DRIVE_ID
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Google Docs no acepta saltos de línea en replaceAllText. Se reconstruyen al armar el docx. */
const MARCA_SALTO = '[[SALTO]]';

function textoParaDocs(texto) {
    return normalizarSaltosLinea(texto).replace(/\n/g, MARCA_SALTO);
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (typeof fecha === 'string') {
        const trimmed = fecha.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    }
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

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function formatearRevisionPlantillaDoc(revision) {
    return String(revision || DATOS_DEFECTO.revision).trim().padStart(2, '0');
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
    const sistemaId = String(
        base.plantillaSistemaDriveFileId
        || base.documentoSistemaDriveFileId
        || ''
    ).trim() || null;
    const sistemaValido = sistemaId && sistemaId !== TEMPLATE_DRIVE_ID ? sistemaId : null;
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        revision: formatearRevisionPlantillaDoc(base.revision),
        politica: normalizarSaltosLinea(base.politica) || DATOS_DEFECTO.politica,
        firmante: String(base.firmante || DATOS_DEFECTO.firmante).trim(),
        cargoFirmante: String(base.cargoFirmante || DATOS_DEFECTO.cargoFirmante).trim(),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial),
        documentoSistemaDriveFileId: sistemaValido,
        plantillaSistemaDriveFileId: sistemaValido,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaOrigenDriveId: String(base.plantillaOrigenDriveId || '').trim() || null,
        plantillaContenidoVersion: Number(base.plantillaContenidoVersion || 0) || 0,
        plantillaSync
    };
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotPlantillaDesdeDatos(raw);
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    return {
        politica: base.politica,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante,
        revision: base.revision,
        fechaRevision: base.fechaRevision,
        fechaElaboracion: base.fechaElaboracion,
        codigo: CODIGO_FORMATO
    };
}

/**
 * Cabecera oficial del Word: Código / No. Rev / Fecha ← Lista Maestra.
 * Prioridad: metadatos SGC → catálogo F-01 → defecto.
 */
async function resolverCabeceraListaMaestra(pool, datosActuales = {}) {
    const base = sanitizarDatos(datosActuales);
    let revision = formatearRevisionPlantillaDoc(base.revision);
    let fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;
    let desdeMetadatos = false;

    if (pool) {
        try {
            const [rows] = await pool.query(
                `SELECT revision, fecha_original
                   FROM sgc_formato_metadatos
                  WHERE UPPER(TRIM(codigo_formato)) = ?
                  LIMIT 1`,
                [CODIGO_FORMATO]
            );
            const meta = rows?.[0];
            if (meta) {
                if (meta.revision != null && String(meta.revision).trim() !== '') {
                    revision = formatearRevisionPlantillaDoc(meta.revision);
                    desdeMetadatos = true;
                }
                const fechaMeta = formatearFechaIso(meta.fecha_original);
                if (fechaMeta) {
                    fechaRevision = fechaMeta;
                    desdeMetadatos = true;
                }
            }
        } catch (err) {
            console.warn('[SGC-PO-01] Metadatos lista maestra omitidos:', err.message);
        }
    }

    if (!desdeMetadatos) {
        try {
            const { CATALOGO_BASE } = require('./sgcSgcF01Service');
            const fila = (CATALOGO_BASE || []).find(
                (d) => String(d?.codigo || '').trim().toUpperCase() === CODIGO_FORMATO
            );
            if (fila) {
                if (fila.versionVigente) {
                    revision = formatearRevisionPlantillaDoc(fila.versionVigente);
                }
                const fechaFila = formatearFechaIso(fila.fechaRevision);
                if (fechaFila) fechaRevision = fechaFila;
            }
        } catch (err) {
            console.warn('[SGC-PO-01] Catálogo F-01 omitido para cabecera:', err.message);
        }
    }

    return { codigo: CODIGO_FORMATO, revision, fechaRevision };
}

function snapshotParaReemplazo(snapshotAnterior) {
    if (!snapshotAnterior) return snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
    if (snapshotAnterior.plantillaSync) return snapshotPlantillaDesdeDatos(snapshotAnterior.plantillaSync);
    return snapshotPlantillaDesdeDatos(snapshotAnterior);
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = textoParaDocs(textoNuevo);
    if (!anterior.trim() || anterior === nuevo) return null;
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: true },
            replaceText: nuevo
        }
    };
}

/** Fecha del Word = fecha de revisión (lista maestra), no la de elaboración. */
function fechaCabeceraWord(destino) {
    return formatearFechaPlantillaDoc(destino.fechaRevision || DATOS_DEFECTO.fechaRevision);
}

/**
 * Placeholders de la plantilla. No filtrar los que contienen {{.
 * Cabecera (pie): {{codigo}} {{num_rev}} {{fecha}}. Cuerpo: {{politica_calidad}}.
 */
function crearReemplazosPlaceholders(destino) {
    const codigo = CODIGO_FORMATO;
    const rev = formatearRevisionPlantillaDoc(destino.revision);
    const fecha = fechaCabeceraWord(destino);
    const cuerpo = textoParaDocs(destino.politica);
    return [
        crearReplaceRequest('{{codigo}}', codigo),
        crearReplaceRequest('{{num_rev}}', rev),
        crearReplaceRequest('{{fecha}}', fecha),
        crearReplaceRequest('{{CODIGO}}', codigo),
        crearReplaceRequest('{{NUM_REV}}', rev),
        crearReplaceRequest('{{FECHA}}', fecha),
        crearReplaceRequest('{{politica_calidad}}', cuerpo),
        crearReplaceRequest('{{POLITICA_CALIDAD}}', cuerpo)
    ].filter(Boolean);
}

function crearReemplazosCodigo(snapshot, destino) {
    const nuevo = `Código: ${CODIGO_FORMATO}`;
    const codigos = new Set([
        String(snapshot.codigo || CODIGO_FORMATO).trim(),
        CODIGO_FORMATO
    ]);
    return [...codigos]
        .filter((c) => c && `Código: ${c}` !== nuevo)
        .map((c) => crearReplaceRequest(`Código: ${c}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosFecha(snapshot, destino) {
    const nuevo = `Fecha: ${fechaCabeceraWord(destino)}`;
    const fechasAnteriores = new Set([
        formatearFechaPlantillaDoc(snapshot.fechaRevision),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaRevision),
        fechaCabeceraWord(destino)
    ]);
    return [...fechasAnteriores]
        .filter((f) => f && `Fecha: ${f}` !== nuevo)
        .map((f) => crearReplaceRequest(`Fecha: ${f}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosRevision(snapshot, destino) {
    const revNuevo = formatearRevisionPlantillaDoc(destino.revision);
    const nuevo = `No. Rev: ${revNuevo}`;
    const revisiones = new Set([
        formatearRevisionPlantillaDoc(snapshot.revision),
        formatearRevisionPlantillaDoc(DATOS_DEFECTO.revision),
        revNuevo
    ]);
    return [...revisiones]
        .filter((r) => `No. Rev: ${r}` !== nuevo)
        .map((r) => crearReplaceRequest(`No. Rev: ${r}`, nuevo))
        .filter(Boolean);
}

function crearReemplazoTexto(anterior, nuevo) {
    const prev = normalizarSaltosLinea(anterior);
    const next = normalizarSaltosLinea(nuevo);
    if (!prev || prev === next || prev.includes('{{')) return null;
    const variantes = new Set([prev, `${prev}\n`, prev.replace(/\n\n+/g, '\n')]);
    for (const variante of variantes) {
        const req = crearReplaceRequest(variante, next);
        if (req) return req;
    }
    return null;
}

function crearReemplazoPolitica(anterior, nuevo) {
    const prev = normalizarSaltosLinea(anterior);
    const next = normalizarSaltosLinea(nuevo);
    if (!prev || prev === next) return null;
    // Si el texto nuevo ya contiene el anterior, reemplazarlo lo duplicaría.
    if (next.includes(prev)) return null;
    return crearReemplazoTexto(prev, next);
}

function construirRequestsPlantilla(snapshot, destino) {
    return [
        ...crearReemplazosPlaceholders(destino),
        crearReemplazoPolitica(snapshot.politica, destino.politica),
        crearReemplazoTexto(snapshot.firmante, destino.firmante),
        crearReemplazoTexto(snapshot.cargoFirmante, destino.cargoFirmante),
        ...crearReemplazosCodigo(snapshot, destino),
        ...crearReemplazosRevision(snapshot, destino),
        ...crearReemplazosFecha(snapshot, destino)
    ].filter(Boolean);
}

function extraerTextoDeContent(content) {
    let text = '';
    for (const el of content || []) {
        if (el.paragraph) {
            for (const pe of el.paragraph.elements || []) {
                if (pe.textRun?.content) text += pe.textRun.content;
            }
        }
        if (el.table) {
            for (const row of el.table.tableRows || []) {
                for (const cell of row.tableCells || []) {
                    text += extraerTextoDeContent(cell.content);
                }
            }
        }
    }
    return text;
}

function extraerTextoCompletoGoogleDoc(docData) {
    let text = extraerTextoDeContent(docData?.body?.content);
    for (const h of Object.values(docData?.headers || {})) {
        text += `\n${extraerTextoDeContent(h.content)}`;
    }
    for (const f of Object.values(docData?.footers || {})) {
        text += `\n${extraerTextoDeContent(f.content)}`;
    }
    return text;
}

function documentoReflejaDestino(texto, destino) {
    const t = String(texto || '');
    if (/\{\{\s*(politica_calidad|codigo|num_rev|fecha)\s*\}\}/i.test(t)) return false;
    const politica = normalizarSaltosLinea(destino.politica);
    const muestra = politica.slice(0, Math.min(40, politica.length));
    if (muestra && !t.includes(muestra)) return false;
    const rev = formatearRevisionPlantillaDoc(destino.revision);
    const fecha = fechaCabeceraWord(destino);
    if (rev && !t.includes(rev)) return false;
    if (fecha && !t.includes(fecha)) return false;
    const firmante = String(destino.firmante || '').trim();
    const cargo = String(destino.cargoFirmante || '').trim();
    if (firmante && !t.includes(firmante)) return false;
    if (cargo && !t.includes(cargo)) return false;
    return true;
}

async function buscarDocumentoSistemaEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    return (archivos || []).find((f) => String(f.name || '').toLowerCase() === objetivo) || null;
}

async function validarDocumentoSistemaEnDrive(fileId) {
    const id = String(fileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) return false;
    try {
        const auth = driveService.getAuthClient();
        if (!auth) return false;
        const drive = google.drive({ version: 'v3', auth });
        const resp = await drive.files.get({ fileId: id, fields: 'id, name, trashed' });
        if (resp.data.trashed) return false;
        return String(resp.data.name || '').toLowerCase() === NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    } catch {
        return false;
    }
}

async function resolverDocumentoSistemaId(datos) {
    const idDb = String(datos?.plantillaSistemaDriveFileId || datos?.documentoSistemaDriveFileId || '').trim();
    if (idDb && await validarDocumentoSistemaEnDrive(idDb)) return idDb;
    const enDrive = await buscarDocumentoSistemaEnDrive();
    return enDrive?.id || null;
}

function nombreArchivoHistorialWord(datos = {}, sufijo = '') {
    const rev = formatearRevisionPlantillaDoc(datos.revision || DATOS_DEFECTO.revision);
    const fecha = formatearFechaIso(datos.fechaRevision || datos.fechaElaboracion) || fechaHoyIso();
    const stamp = fecha.replace(/-/g, '');
    const extra = sufijo ? ` - ${sufijo}` : '';
    return `SGC-PO-01 Politica de calidad (sistema) - Rev ${rev} - ${stamp}${extra}.docx`;
}

/**
 * Mueve el Word sistema vigente al Historial de Versiones (no borra).
 */
async function archivarDocumentoSistemaActual(sistemaFileId, datos = {}, sufijo = '') {
    const id = String(sistemaFileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) return null;
    try {
        const nombreHist = nombreArchivoHistorialWord(datos, sufijo);
        await driveService.renombrarArchivoPorId(id, nombreHist).catch((err) => {
            console.warn('[SGC-PO-01] No se pudo renombrar Word antes de archivar:', err.message);
        });
        await driveService.moverArchivoDrive(id, CARPETA_HISTORIAL_DRIVE_ID);
        console.log(`[SGC-PO-01] Word archivado → Historial: ${nombreHist} (${id})`);
        return id;
    } catch (err) {
        console.warn('[SGC-PO-01] No se pudo archivar Word:', err.message);
        return null;
    }
}

/** Words .docx que ya estaban en la carpeta de trabajo y no son el vigente. */
async function archivarDocxLegadosEnCarpetaTrabajo(datos = {}) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const sistema = NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    let n = 0;
    for (const f of archivos || []) {
        const nombre = String(f.name || '');
        const mime = String(f.mimeType || '');
        const esDocx = mime === DOCX_MIME || nombre.toLowerCase().endsWith('.docx');
        if (!esDocx) continue;
        if (f.id === TEMPLATE_DRIVE_ID) continue;
        if (nombre.toLowerCase() === sistema) continue;
        n += 1;
        await archivarDocumentoSistemaActual(f.id, datos, n === 1 ? '' : String(n).padStart(2, '0'));
    }
}

async function crearDocumentoSistemaDesdePlantilla() {
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: NOMBRE_DOCUMENTO_SISTEMA,
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id, name, webViewLink'
    });
    const fileId = copyResp?.data?.id;
    if (!fileId || fileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo crear el documento SGC-PO-01 (sistema) desde la plantilla.');
    }
    console.log(`[SGC-PO-01] Documento sistema creado desde plantilla: ${NOMBRE_DOCUMENTO_SISTEMA} (${fileId})`);
    return fileId;
}

function debeRegenerarDocumentoSistema(datos, cabeceraLista) {
    const origen = String(datos?.plantillaOrigenDriveId || '').trim();
    if (!origen || origen !== TEMPLATE_DRIVE_ID) return true;
    if (Number(datos?.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION) return true;
    const sync = datos?.plantillaSync;
    if (!sync) return false;
    const revSync = formatearRevisionPlantillaDoc(sync.revision);
    const revLista = formatearRevisionPlantillaDoc(cabeceraLista.revision);
    if (revSync !== revLista) return true;
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaLista = formatearFechaIso(cabeceraLista.fechaRevision);
    if (fechaSync && fechaLista && fechaSync !== fechaLista) return true;
    return false;
}

async function asegurarDocumentoSistema(datos, opciones = {}) {
    const existente = await resolverDocumentoSistemaId(datos);
    const forzarRegenerar = !!opciones.forzarRegenerar;

    if (existente && !forzarRegenerar) {
        return { fileId: existente, newlyCreated: false, regenerated: false };
    }

    if (existente && forzarRegenerar) {
        await archivarDocumentoSistemaActual(existente, {
            revision: datos?.plantillaSync?.revision || datos?.revision,
            fechaRevision: datos?.plantillaSync?.fechaRevision || datos?.fechaRevision,
            fechaElaboracion: datos?.plantillaSync?.fechaElaboracion || datos?.fechaElaboracion
        });
    }

    await archivarDocxLegadosEnCarpetaTrabajo({
        revision: datos?.plantillaSync?.revision || datos?.revision,
        fechaRevision: datos?.plantillaSync?.fechaRevision || datos?.fechaRevision,
        fechaElaboracion: datos?.plantillaSync?.fechaElaboracion || datos?.fechaElaboracion
    });

    const fileId = await crearDocumentoSistemaDesdePlantilla();
    return {
        fileId,
        newlyCreated: !existente,
        regenerated: !!existente && forzarRegenerar
    };
}

async function copiarDocumentoComoGoogleDoc(sourceFileId) {
    if (!sourceFileId || sourceFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se edita la plantilla maestra de SGC-PO-01.');
    }
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: sourceFileId,
        requestBody: {
            name: `_temp_sgc_po01_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) throw new Error('No se pudo abrir el documento sistema como Google Doc.');
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

function textoPlanoParrafoXml(parrafo) {
    return (String(parrafo || '').match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

function partirParrafosCuerpo(inner) {
    const paras = [];
    const re = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let match;
    const xml = String(inner || '');
    while ((match = re.exec(xml))) {
        const raw = match[0];
        paras.push({ raw, text: textoPlanoParrafoXml(raw) });
    }
    return paras;
}

function esParrafoDibujo(raw) {
    return /straightConnector|<w:drawing|<w:pict|<v:shape|<v:rect/.test(raw)
        && !textoPlanoParrafoXml(raw);
}

function escaparXml(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Separa los párrafos que Google Docs dejó unidos con la marca de salto. */
function expandirSaltosParrafo(raw, esTitulo) {
    const texto = textoPlanoParrafoXml(raw);
    if (!texto.includes(MARCA_SALTO)) {
        return [esTitulo ? asegurarEspacioBajoLogo(raw) : raw];
    }
    const pPrBase = (raw.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
    const rPr = (raw.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    return texto.split(MARCA_SALTO).map((parte, idx) => {
        let pPr = pPrBase;
        if (esTitulo && idx === 0) {
            const envuelto = asegurarEspacioBajoLogo(`<w:p>${pPrBase}</w:p>`);
            pPr = (envuelto.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [pPrBase])[0];
        }
        if (!parte) return `<w:p>${pPr}</w:p>`;
        return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaparXml(parte)}</w:t></w:r></w:p>`;
    });
}

/** El logo vive en el encabezado y tapa el inicio del cuerpo. Este espacio lo deja debajo. */
function asegurarEspacioBajoLogo(parrafoXml) {
    const antes = parrafoXml.match(/w:before="(\d+)"/);
    if (antes && Number(antes[1]) >= 1400) return parrafoXml;
    if (antes) {
        return parrafoXml.replace(/w:before="\d+"/, 'w:before="1600"');
    }
    const spacing = '<w:spacing w:before="1600" w:after="160" w:line="276" w:lineRule="auto"/>';
    if (parrafoXml.includes('<w:pPr>')) {
        return parrafoXml.replace('<w:pPr>', `<w:pPr>${spacing}`);
    }
    return parrafoXml.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr>${spacing}</w:pPr>`);
}

function asegurarKeepNext(parrafoXml) {
    if (parrafoXml.includes('<w:keepNext')) return parrafoXml;
    if (parrafoXml.includes('<w:pPr>')) {
        return parrafoXml.replace('<w:pPr>', '<w:pPr><w:keepNext/>');
    }
    return parrafoXml.replace(/<w:p\b([^>]*)>/, '<w:p$1><w:pPr><w:keepNext/></w:pPr>');
}

/** Línea de firma delgada (borde de párrafo, ~1 pt), no la forma que Google Docs engorda. */
function parrafoLineaFirma() {
    return '<w:p>'
        + '<w:pPr>'
        + '<w:keepNext/>'
        + '<w:spacing w:before="60" w:after="40" w:line="240" w:lineRule="auto"/>'
        + '<w:ind w:left="2550" w:right="2550"/>'
        + '<w:jc w:val="center"/>'
        + '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="1A1A1A"/></w:pBdr>'
        + '</w:pPr>'
        + '</w:p>';
}

function envolverFirmaEnTabla(contenidoXml, firmaXml) {
    const ancho = '8838';
    const celda = (interior, extraPr) => ''
        + '<w:tc><w:tcPr>'
        + `<w:tcW w:w="${ancho}" w:type="dxa"/>`
        + extraPr
        + '</w:tcPr>'
        + interior
        + '</w:tc>';
    return '<w:tbl>'
        + '<w:tblPr>'
        + '<w:tblW w:w="5000" w:type="pct"/>'
        + '<w:tblLayout w:type="fixed"/>'
        + '<w:tblCaption w:val="sgc-po01-cuerpo"/>'
        + '<w:tblCellMar>'
        + '<w:top w:w="0" w:type="dxa"/>'
        + '<w:left w:w="0" w:type="dxa"/>'
        + '<w:bottom w:w="0" w:type="dxa"/>'
        + '<w:right w:w="0" w:type="dxa"/>'
        + '</w:tblCellMar>'
        + '<w:tblBorders>'
        + '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/>'
        + '<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>'
        + '</w:tblBorders>'
        + '</w:tblPr>'
        + `<w:tblGrid><w:gridCol w:w="${ancho}"/></w:tblGrid>`
        + '<w:tr><w:trPr><w:trHeight w:val="10800" w:hRule="atLeast"/></w:trPr>'
        + celda(contenidoXml, '<w:vAlign w:val="top"/>')
        + '</w:tr>'
        + '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="640" w:hRule="atLeast"/></w:trPr>'
        + celda(firmaXml, '<w:vAlign w:val="bottom"/>')
        + '</w:tr>'
        + '</w:tbl>';
}

/**
 * La barra de firma del Word es una forma flotante. Al pasar por Google Docs
 * se vuelve un bloque alto. Se cambia por un borde de 1 pt y el bloque queda
 * al fondo del cuerpo. El título conserva espacio superior para no montarse
 * sobre el logo del encabezado.
 */
function ajustarFirmaEnDocumentXml(xml) {
    const doc = String(xml || '').replace(
        /<mc:AlternateContent>[\s\S]*?straightConnector1[\s\S]*?<\/mc:AlternateContent>/g,
        ''
    );
    const bodyMatch = doc.match(/<w:body>([\s\S]*)(<w:sectPr[\s\S]*<\/w:sectPr>\s*<\/w:body>)/);
    if (!bodyMatch) return doc;
    const paras = partirParrafosCuerpo(bodyMatch[1]);
    const tituloIdx = paras.findIndex((p) => /POL[IÍ]TICA DE CALIDAD/i.test(p.text));
    const conTexto = [];
    paras.forEach((p, i) => {
        if (p.text) conTexto.push(i);
    });
    if (tituloIdx < 0 || conTexto.length < 3) return doc;
    const cargoIdx = conTexto[conTexto.length - 1];
    const nameIdx = conTexto[conTexto.length - 2];
    if (nameIdx <= tituloIdx) return doc;

    const medio = [];
    let yaPolitica = false;
    for (let i = tituloIdx; i < nameIdx; i += 1) {
        const p = paras[i];
        if (esParrafoDibujo(p.raw)) continue;
        if (!p.text) {
            if (!yaPolitica) medio.push(p.raw);
            continue;
        }
        const esTitulo = i === tituloIdx;
        yaPolitica = !esTitulo;
        medio.push(...expandirSaltosParrafo(p.raw, esTitulo));
    }
    if (!medio.length) return doc;

    const firma = [
        parrafoLineaFirma(),
        asegurarKeepNext(paras[nameIdx].raw),
        paras[cargoIdx].raw
    ].join('');
    const tabla = envolverFirmaEnTabla(medio.join(''), firma);
    return doc.replace(bodyMatch[0], `<w:body>${tabla}${bodyMatch[2]}`);
}

function ajustarFirmaEnDocx(buffer) {
    const zip = new AdmZip(Buffer.from(buffer));
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return Buffer.from(buffer);
    const xml = entry.getData().toString('utf8');
    const ajustado = ajustarFirmaEnDocumentXml(xml);
    if (ajustado === xml) return Buffer.from(buffer);
    zip.updateFile('word/document.xml', Buffer.from(ajustado, 'utf8'));
    return zip.toBuffer();
}

async function persistirDocumentoSistema(drive, docId, sistemaFileId) {
    if (!sistemaFileId || sistemaFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('El Word de trabajo no puede ser la plantilla maestra.');
    }
    const docxResp = await drive.files.export(
        { fileId: docId, mimeType: DOCX_MIME },
        { responseType: 'arraybuffer' }
    );
    const docxBuffer = ajustarFirmaEnDocx(Buffer.from(docxResp.data));
    await driveService.reemplazarArchivoEnDrive(
        sistemaFileId,
        docxBuffer,
        DOCX_MIME,
        NOMBRE_DOCUMENTO_SISTEMA
    );
}

async function leerTextoDocumento(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    return extraerTextoCompletoGoogleDoc(doc.data);
}

async function resyncCompletoDesdePlantilla(datos, sistemaFileId) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: `_temp_sgc_po01_resync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId || docId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo copiar la plantilla SGC-PO-01 para rellenar.');
    }
    const docsApi = google.docs({ version: 'v1', auth });
    try {
        const requests = construirRequestsPlantilla(snapshotPlantillaDesdeDatos(DATOS_DEFECTO), destino);
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }
        const texto = await leerTextoDocumento(docsApi, docId);
        if (!documentoReflejaDestino(texto, destino)) {
            console.warn('[SGC-PO-01] Resync completo: la copia sigue sin reflejar cabecera o política');
        }
        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return destino;
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[SGC-PO-01] No se pudo eliminar copia temporal de resync:', err.message);
        }
    }
}

async function sincronizarDocumentoSistema(datos, _snapshotAnterior, sistemaFileId) {
    // Siempre desde la plantilla maestra. Reescribir el Word ya parchado
    // perdía el espacio bajo el logo y volvía a montar el texto en el encabezado.
    const plantillaSync = await resyncCompletoDesdePlantilla(datos, sistemaFileId);
    return { actualizado: true, plantillaSync };
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
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
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

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) return sanitizarPdfFirmado(pdfDb);
    }
    const lista = await listarPdfsHistorialDrive().catch(() => []);
    if (lista[0]?.driveFileId) return lista[0];
    return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
}

function construirRespuesta(registro, datos, historialPdfs = [], archivoDrive = null) {
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

    const documentoSistemaDriveFileId = datos.plantillaSistemaDriveFileId
        || datos.documentoSistemaDriveFileId
        || archivoDrive?.id
        || null;

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
            documentoSistemaDriveFileId,
            plantillaSistemaDriveFileId: documentoSistemaDriveFileId,
            pdfsHistorial: historialDb.length ? historialDb : historialUnido
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(
            archivoDrive?.modifiedTime || registro?.ultima_sync_drive
        ),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: historialUnido,
        documentoSistemaDriveFileId,
        documentoSistemaEditorUrl: documentoSistemaDriveFileId
            ? `https://docs.google.com/document/d/${documentoSistemaDriveFileId}/edit`
            : null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`,
        plantillaOrigenDriveId: datos.plantillaOrigenDriveId || TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: datos.plantillaContenidoVersion || PLANTILLA_CONTENIDO_VERSION,
        carpetaHistorialDriveId: CARPETA_HISTORIAL_DRIVE_ID
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

function payloadRegistroDesdeRegistro(registro, datos, pdfDriveFileId = null) {
    return {
        pdfDriveFileId: pdfDriveFileId ?? registro?.drive_file_id ?? datos?.pdfFirmado?.driveFileId ?? null,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido ?? null,
        contenidoModificado: !!registro?.contenido_modificado
    };
}

async function aplicarCabeceraLista(pool, datos) {
    const cabeceraLista = await resolverCabeceraListaMaestra(pool, datos);
    return {
        cabeceraLista,
        datos: {
            ...sanitizarDatos(datos),
            revision: cabeceraLista.revision,
            fechaRevision: cabeceraLista.fechaRevision
        }
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    const aplicado = await aplicarCabeceraLista(pool, datos);
    datos = aplicado.datos;
    const regenerar = debeRegenerarDocumentoSistema(datos, aplicado.cabeceraLista);
    const {
        fileId: sistemaFileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(datos, { forzarRegenerar: regenerar });

    if (newlyCreated || regenerated) {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datos,
                DATOS_DEFECTO,
                sistemaFileId,
                { forzarSnapshotPlantilla: true }
            );
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
                plantillaSync: syncResult.plantillaSync
            };
        } catch (err) {
            console.warn('[SGC-PO-01] No se pudo sincronizar documento sistema recién creado:', err.message);
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
            };
        }
        await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
        registro = await obtenerRegistroDb(pool);
    } else {
        const prev = await leerDatosRegistro(registro);
        const debePersistir = !prev
            || sistemaFileId !== prev.plantillaSistemaDriveFileId
            || prev.plantillaOrigenDriveId !== TEMPLATE_DRIVE_ID
            || Number(prev.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION
            || prev.revision !== datos.revision
            || prev.fechaRevision !== datos.fechaRevision;
        datos = {
            ...datos,
            documentoSistemaDriveFileId: sistemaFileId,
            plantillaSistemaDriveFileId: sistemaFileId,
            plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
            plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
        };
        if (debePersistir) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
            registro = await obtenerRegistroDb(pool);
        }
    }

    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos, pdfResuelto.driveFileId));
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
    const archivoDrive = await driveService.obtenerInfoArchivo(sistemaFileId).catch(() => ({ id: sistemaFileId }));
    return construirRespuesta(registro, datos, historialPdfs, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const huboCambioContenido = datosPrevios
        ? !contenidoEsEquivalente(datosPrevios, datosEntrada)
        : !contenidoEsEquivalente(DATOS_DEFECTO, datosEntrada);

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const baseParaDoc = {
        ...(datosPrevios || {}),
        ...datosEntrada,
        pdfFirmado,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        plantillaSync: datosPrevios?.plantillaSync || null,
        plantillaOrigenDriveId: datosPrevios?.plantillaOrigenDriveId || null,
        plantillaContenidoVersion: datosPrevios?.plantillaContenidoVersion || 0,
        plantillaSistemaDriveFileId: datosPrevios?.plantillaSistemaDriveFileId || null,
        documentoSistemaDriveFileId: datosPrevios?.documentoSistemaDriveFileId || null
    };
    const aplicado = await aplicarCabeceraLista(pool, baseParaDoc);
    const regenerar = debeRegenerarDocumentoSistema(aplicado.datos, aplicado.cabeceraLista);
    const {
        fileId: sistemaFileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(aplicado.datos, { forzarRegenerar: regenerar });

    if (huboCambioContenido && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        ...aplicado.datos,
        empresa: datosEntrada.empresa,
        politica: datosEntrada.politica,
        firmante: datosEntrada.firmante,
        cargoFirmante: datosEntrada.cargoFirmante,
        fechaElaboracion,
        revision: aplicado.cabeceraLista.revision,
        fechaRevision: aplicado.cabeceraLista.fechaRevision,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        documentoSistemaDriveFileId: sistemaFileId,
        plantillaSistemaDriveFileId: sistemaFileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
        plantillaSync: datosPrevios?.plantillaSync || null
    };

    if (origen !== 'consulta') {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datosGuardar,
                (newlyCreated || regenerated) ? DATOS_DEFECTO : (datosPrevios || DATOS_DEFECTO),
                sistemaFileId,
                { forzarSnapshotPlantilla: newlyCreated || regenerated }
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
            datosGuardar.plantillaContenidoVersion = PLANTILLA_CONTENIDO_VERSION;
        } catch (err) {
            console.error('[SGC-PO-01] Error sincronizando documento sistema en Drive:', err.message);
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
    const archivoDrive = await driveService.obtenerInfoArchivo(sistemaFileId).catch(() => null);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs, archivoDrive);
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
        CARPETA_DRIVE_ID
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

    await guardarRegistroDb(pool, {
        ...payloadRegistroDesdeRegistro(registroPrevio, datosGuardar),
        pdfDriveFileId: pdfFirmado.driveFileId,
        fechaElaboracionOriginal: fechaOriginal
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
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: registroPrevio?.fecha_modificacion_contenido ?? null,
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

function wordYaReflejaDatos(datos) {
    const sync = datos?.plantillaSync;
    if (!sync) return false;
    if (formatearRevisionPlantillaDoc(sync.revision) !== formatearRevisionPlantillaDoc(datos.revision)) return false;
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaDatos = formatearFechaIso(datos.fechaRevision);
    if (fechaSync && fechaDatos && fechaSync !== fechaDatos) return false;
    if (normalizarSaltosLinea(sync.politica) !== normalizarSaltosLinea(datos.politica)) return false;
    if (String(sync.firmante || '').trim() !== String(datos.firmante || '').trim()) return false;
    if (String(sync.cargoFirmante || '').trim() !== String(datos.cargoFirmante || '').trim()) return false;
    return true;
}

function clavePdfDescarga(datos) {
    return crypto.createHash('sha1').update(JSON.stringify({
        politica: datos.politica || '',
        firmante: datos.firmante || '',
        cargoFirmante: datos.cargoFirmante || '',
        revision: datos.revision || '',
        fechaRevision: datos.fechaRevision || '',
        fileId: datos.plantillaSistemaDriveFileId || datos.documentoSistemaDriveFileId || ''
    })).digest('hex');
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const cabecera = await resolverCabeceraListaMaestra(pool, datos);
    datos = {
        ...datos,
        revision: cabecera.revision,
        fechaRevision: cabecera.fechaRevision
    };

    const regenerar = debeRegenerarDocumentoSistema(datos, cabecera);
    const sistemaFileId = String(datos.plantillaSistemaDriveFileId || datos.documentoSistemaDriveFileId || '').trim();
    const exportacionDirecta = !regenerar
        && !!sistemaFileId
        && sistemaFileId !== TEMPLATE_DRIVE_ID
        && wordYaReflejaDatos(datos);

    if (exportacionDirecta) {
        const clave = clavePdfDescarga(datos);
        const cache = pdfDescargaCache.leer('SGC-PO-01', clave);
        if (cache) {
            console.log('[SGC-PO-01] PDF servido desde caché');
            return cache;
        }
        try {
            const pdfBuffer = await driveService.exportarArchivoPDF(sistemaFileId);
            pdfDescargaCache.guardar('SGC-PO-01', clave, pdfBuffer);
            console.log('[SGC-PO-01] PDF exportado del Word vigente, sin resincronizar');
            return pdfBuffer;
        } catch (err) {
            console.warn('[SGC-PO-01] Exportación directa de PDF falló, se regenera el Word:', err.message);
        }
    }

    const {
        fileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(datos, {
        forzarRegenerar: regenerar || !sistemaFileId
    });
    const syncResult = await sincronizarDocumentoSistema(
        datos,
        (newlyCreated || regenerated) ? DATOS_DEFECTO : (datos.plantillaSync || DATOS_DEFECTO),
        fileId,
        { forzarSnapshotPlantilla: newlyCreated || regenerated }
    );
    const pdfBuffer = await driveService.exportarArchivoPDF(fileId);
    const datosActualizados = {
        ...datos,
        documentoSistemaDriveFileId: fileId,
        plantillaSistemaDriveFileId: fileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
        plantillaSync: syncResult.plantillaSync || datos.plantillaSync || null
    };
    pdfDescargaCache.guardar('SGC-PO-01', clavePdfDescarga(datosActualizados), pdfBuffer);
    await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datosActualizados));
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_DOCUMENTO_SISTEMA,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_HISTORIAL_DRIVE_ID,
    PLANTILLA_CONTENIDO_VERSION,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sincronizarDocumentoSistema,
    sanitizarDatos,
    resolverCabeceraListaMaestra,
    crearReemplazosPlaceholders,
    documentoReflejaDestino,
    ajustarFirmaEnDocx
};
