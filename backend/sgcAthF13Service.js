/**
 * ATH-F-13 · Solicitud de vacaciones.
 * Archivero: una copia del Google Doc por solicitud (plantilla inmutable) + PDFs firmados
 * en «Documentos fisicos» con versiones 01, 02, 03…
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-13';
/** Google Doc plantilla viva (convertida desde el .docx). NUNCA se edita ni reemplaza. */
const TEMPLATE_DRIVE_ID = '14MCp6YsY4Gf82TcPRzmNlwLPhifytDbG_9kklYhLWk4';
/** .docx original de referencia. Solo lectura. */
const TEMPLATE_ORIGINAL_DRIVE_ID = '1BRv82PTyevSMb4v0PtuN5HYWRJWB6A2W';
/** Carpeta del formato ATH-F-13. */
const CARPETA_FORMATO_ID = '1nL1t-A2bpbOMkQymLduCtmkwXuBGQFm1';
/** Copias de trabajo (solicitudes). */
const CARPETA_DRIVE_ID = '1GQin0gbMIzX-HEL3P3yzuNUSXPPyNqg0';
/** PDFs firmados (Documentos fisicos). */
const CARPETA_PDF_FIRMADOS_ID = '1UBNP7S0Ly_3bYJKuQCBGrhbgQd0MeUXE';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const NOMBRE_PDF_ARCHIVO = 'ATH-F-13 Solicitud de vacaciones.pdf';

const PLANTILLAS_INMUTABLES = new Set([TEMPLATE_DRIVE_ID, TEMPLATE_ORIGINAL_DRIVE_ID]);

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2026-03-17',
    fechaElaboracion: '',
    solicitudes: [],
    solicitudActivaId: null
};

/** Blancos exactos de la plantilla Google Doc (no alterar). */
const BLANCOS = {
    lugarFecha: '_________________________________________________________',
    nombreCompleto: '____________________________________________________',
    puesto: '__________________________________________',
    areaDepartamento: '____________________________',
    fechaIngreso: '_______________________________',
    fechaPartes: '____ / ____ / ______',
    diasSolicitados: '________________',
    motivoLinea: '________________________________________________________________________'
};

function assertNoMutarPlantilla(fileId, accion = 'modificar') {
    const id = String(fileId || '').trim();
    if (id && PLANTILLAS_INMUTABLES.has(id)) {
        throw new Error(
            `[ATH-F-13] Prohibido ${accion} la plantilla (${id}). `
            + 'Solo se permiten copias de trabajo o archivos nuevos.'
        );
    }
}

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath13-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
        let y = m[3];
        if (y.length === 2) y = `20${y}`;
        return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
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

/** DD / MM / YYYY para alinear con «____ / ____ / ______» de la plantilla. */
function formatearFechaPartes(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d} / ${m} / ${y}`;
}

function sanitizarNombreArchivoDrive(nombre) {
    return String(nombre || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Colaborador';
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || NOMBRE_PDF_ARCHIVO).trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
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

function sanitizarSolicitud(raw) {
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
        lugarFecha: normalizarSaltos(base.lugarFecha || base.lugar_fecha || ''),
        nombreCompleto: normalizarSaltos(base.nombreCompleto || base.nombre_completo || ''),
        puesto: normalizarSaltos(base.puesto || ''),
        areaDepartamento: normalizarSaltos(base.areaDepartamento || base.area_departamento || ''),
        fechaIngreso: formatearFechaIso(base.fechaIngreso || base.fecha_ingreso),
        fechaInicio: formatearFechaIso(base.fechaInicio || base.fecha_inicio),
        fechaTermino: formatearFechaIso(base.fechaTermino || base.fecha_termino),
        diasSolicitados: String(base.diasSolicitados ?? base.dias_solicitados ?? '').trim(),
        fechaReincorporacion: formatearFechaIso(base.fechaReincorporacion || base.fecha_reincorporacion),
        motivo: normalizarSaltos(base.motivo || ''),
        fechaAutorizacion: formatearFechaIso(base.fechaAutorizacion || base.fecha_autorizacion),
        driveFileId: String(base.driveFileId || base.drive_file_id || '').trim() || null,
        nombreArchivo: String(base.nombreArchivo || base.nombre_archivo || '').trim() || null,
        pdfFirmado,
        pdfsHistorial
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const solicitudes = (Array.isArray(base.solicitudes) ? base.solicitudes : []).map(sanitizarSolicitud);
    const activoId = String(base.solicitudActivaId || base.solicitud_activa_id || '').trim();
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || '00',
        fechaRevision: formatearFechaIso(base.fechaRevision || base.fecha_revision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion || base.fecha_elaboracion) || fechaHoyIso(),
        solicitudes,
        solicitudActivaId: activoId && solicitudes.some((s) => s.id === activoId)
            ? activoId
            : (solicitudes[0]?.id || null)
    };
}

function resolverSolicitudActiva(datos) {
    const d = sanitizarDatos(datos);
    return d.solicitudes.find((s) => s.id === d.solicitudActivaId) || d.solicitudes[0] || null;
}

function nombreArchivoDrive(solicitud) {
    const folio = String(solicitud?.folio || '').trim() || 'sin-folio';
    const nombre = sanitizarNombreArchivoDrive(solicitud?.nombreCompleto || '');
    const base = nombre && nombre !== 'Colaborador'
        ? `ATH-F-13 ${folio} ${nombre}`
        : `ATH-F-13 ${folio}`;
    return base.slice(0, 180);
}

/**
 * ATH-F-13 Solicitud de vacaciones - {Nombre} - MM/AA - 01.pdf
 * Siempre incluye el sufijo 01, 02, 03…
 */
function siguienteVersionPdf(solicitud, historial = []) {
    const nombre = sanitizarNombreArchivoDrive(solicitud?.nombreCompleto || 'Colaborador');
    const iso = formatearFechaIso(solicitud?.fechaInicio || solicitud?.fechaElaboracion) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const prefijo = `ATH-F-13 Solicitud de vacaciones - ${nombre} - ${mm}/${yy}`;

    let max = 0;
    const seen = new Set();
    for (const p of (Array.isArray(historial) ? historial : [])) {
        const n = String(p?.nombreArchivo || '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const m = n.match(new RegExp(`^${escaparRegex(prefijo)} - (\\d{1,2})\\.pdf$`, 'i'));
        if (m) {
            max = Math.max(max, parseInt(m[1], 10) || 0);
            continue;
        }
        if (n.toLowerCase().startsWith(prefijo.toLowerCase()) && /\.pdf$/i.test(n)) {
            max = Math.max(max, 1);
        }
    }
    return String(max + 1).padStart(2, '0');
}

function nombrePdfFirmado(solicitud, historial = []) {
    const nombre = sanitizarNombreArchivoDrive(solicitud?.nombreCompleto || 'Colaborador');
    const iso = formatearFechaIso(solicitud?.fechaInicio) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const version = siguienteVersionPdf(solicitud, historial);
    return `ATH-F-13 Solicitud de vacaciones - ${nombre} - ${mm}/${yy} - ${version}.pdf`;
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

function valorOBlanco(valor, blanco) {
    const t = String(valor || '').trim();
    return t || blanco;
}

function armarReemplazosPlantilla(solicitud) {
    const s = sanitizarSolicitud(solicitud);
    const motivo = String(s.motivo || '').trim();
    const motivoL1 = motivo.slice(0, 72);
    const motivoL2 = motivo.length > 72 ? motivo.slice(72, 144) : '';

    return [
        {
            buscar: `Lugar y fecha: ${BLANCOS.lugarFecha}`,
            nuevo: `Lugar y fecha: ${valorOBlanco(s.lugarFecha, BLANCOS.lugarFecha)}`
        },
        {
            buscar: `Nombre completo: ${BLANCOS.nombreCompleto}`,
            nuevo: `Nombre completo: ${valorOBlanco(s.nombreCompleto, BLANCOS.nombreCompleto)}`
        },
        {
            buscar: `Puesto: ${BLANCOS.puesto}`,
            nuevo: `Puesto: ${valorOBlanco(s.puesto, BLANCOS.puesto)}`
        },
        {
            buscar: `Área / Departamento: ${BLANCOS.areaDepartamento}`,
            nuevo: `Área / Departamento: ${valorOBlanco(s.areaDepartamento, BLANCOS.areaDepartamento)}`
        },
        {
            buscar: `Fecha de ingreso: ${BLANCOS.fechaIngreso}`,
            nuevo: `Fecha de ingreso: ${valorOBlanco(formatearFechaDisplay(s.fechaIngreso), BLANCOS.fechaIngreso)}`
        },
        {
            buscar: `Fecha de inicio: ${BLANCOS.fechaPartes}`,
            nuevo: `Fecha de inicio: ${valorOBlanco(formatearFechaPartes(s.fechaInicio), BLANCOS.fechaPartes)}`
        },
        {
            buscar: `Fecha de término: ${BLANCOS.fechaPartes}`,
            nuevo: `Fecha de término: ${valorOBlanco(formatearFechaPartes(s.fechaTermino), BLANCOS.fechaPartes)}`
        },
        {
            buscar: `Número total de días solicitados: ${BLANCOS.diasSolicitados}`,
            nuevo: `Número total de días solicitados: ${valorOBlanco(s.diasSolicitados, BLANCOS.diasSolicitados)}`
        },
        {
            buscar: `Fecha de reincorporación laboral: ${BLANCOS.fechaPartes}`,
            nuevo: `Fecha de reincorporación laboral: ${valorOBlanco(formatearFechaPartes(s.fechaReincorporacion), BLANCOS.fechaPartes)}`
        },
        {
            buscar: `Fecha de autorización: ${BLANCOS.fechaPartes}`,
            nuevo: `Fecha de autorización: ${valorOBlanco(formatearFechaPartes(s.fechaAutorizacion), BLANCOS.fechaPartes)}`
        }
    ].concat(motivo ? [{
        // Sustituye ambas líneas de blancos; la 2ª queda vacía (sin guiones) si el
        // motivo cabe en una sola línea — evita subrayados residuales.
        buscar: `Motivo de la solicitud (opcional):\u000b${BLANCOS.motivoLinea}\u000b${BLANCOS.motivoLinea}`,
        nuevo: `Motivo de la solicitud (opcional):\u000b${motivoL1}\u000b${motivoL2}`
    }] : []);
}

async function aplicarContenidoEnDocumento(docId, solicitud) {
    assertNoMutarPlantilla(docId, 'editar con Docs API');
    const { docsApi } = clienteGoogle();
    const reemplazos = armarReemplazosPlantilla(solicitud);
    const requests = [];

    for (const item of reemplazos) {
        const anterior = String(item.buscar || '');
        const nuevo = String(item.nuevo || '');
        if (!anterior || anterior === nuevo) continue;
        requests.push({
            replaceAllText: {
                containsText: { text: anterior, matchCase: true },
                replaceText: nuevo
            }
        });
    }

    // Espacio de firma manuscrita (tabla Atentamente / Autorizó).
    const doc = await docsApi.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];
    let tablaFirmas = null;
    for (const el of content) {
        if (el?.table && el.table.columns === 2) {
            tablaFirmas = el;
            break;
        }
    }
    if (tablaFirmas && Number.isFinite(tablaFirmas.startIndex)) {
        requests.unshift({
            updateTableRowStyle: {
                tableStartLocation: { index: tablaFirmas.startIndex },
                rowIndices: [0],
                tableRowStyle: {
                    minRowHeight: { magnitude: 56, unit: 'PT' }
                },
                fields: 'minRowHeight'
            }
        });
    }

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }

    // Quita negrita/subrayado heredados de las líneas en blanco del motivo.
    await normalizarEstiloMotivo(docsApi, docId, solicitud);
}

/**
 * Tras reemplazar los blancos del motivo, el Docs API conserva negrita/subrayado
 * de las líneas «____». Aquí se normaliza el texto del motivo a peso regular
 * y sin subrayado, sin tocar el título «Motivo de la solicitud…».
 */
async function normalizarEstiloMotivo(docsApi, docId, solicitud) {
    const motivo = String(sanitizarSolicitud(solicitud).motivo || '').trim();
    if (!motivo) return;

    const doc = await docsApi.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];
    const marker = 'Motivo de la solicitud (opcional):';
    let parrafoMotivo = null;

    for (const el of content) {
        if (!el.paragraph) continue;
        const texto = (el.paragraph.elements || [])
            .map((e) => (e.textRun && e.textRun.content) || '')
            .join('');
        if (texto.includes(marker)) {
            parrafoMotivo = el;
            break;
        }
    }
    if (!parrafoMotivo) return;

    const elementos = parrafoMotivo.paragraph.elements || [];
    const requests = [];
    let pasadoTitulo = false;

    for (const e of elementos) {
        const run = e.textRun;
        if (!run || !run.content) continue;
        const start = Number(e.startIndex);
        const end = Number(e.endIndex);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

        const t = String(run.content);
        if (!pasadoTitulo) {
            if (t.includes(marker)) {
                pasadoTitulo = true;
                const idx = t.indexOf(marker) + marker.length;
                // Texto del mismo run después del título (si lo hay).
                if (idx < t.length) {
                    const rStart = start + idx;
                    if (end > rStart) {
                        requests.push({
                            updateTextStyle: {
                                range: { startIndex: rStart, endIndex: end },
                                textStyle: { bold: false, underline: false, weightedFontFamily: { fontFamily: 'Century Gothic', weight: 400 } },
                                fields: 'bold,underline,weightedFontFamily'
                            }
                        });
                    }
                }
            }
            continue;
        }

        // Después del título: cuerpo del motivo (no las líneas en blanco residuales).
        if (/^_+$/.test(t.replace(/\u000b|\n/g, '').trim())) continue;
        requests.push({
            updateTextStyle: {
                range: { startIndex: start, endIndex: end },
                textStyle: { bold: false, underline: false, weightedFontFamily: { fontFamily: 'Century Gothic', weight: 400 } },
                fields: 'bold,underline,weightedFontFamily'
            }
        });
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
            name: String(nombreArchivo || 'ATH-F-13 Solicitud de vacaciones').trim(),
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true
    });
    if (copyResp?.data?.mimeType && copyResp.data.mimeType !== GOOGLE_DOC_MIME) {
        throw new Error('La copia de ATH-F-13 no quedó como Google Doc.');
    }
    if (!copyResp?.data?.id) {
        throw new Error('No se pudo crear el documento de solicitud de vacaciones.');
    }
    assertNoMutarPlantilla(copyResp.data.id, 'usar como plantilla');
    return copyResp.data;
}

async function asegurarDocumentoSolicitud(solicitud) {
    const item = sanitizarSolicitud(solicitud);
    const nombre = nombreArchivoDrive(item);
    let driveFileId = item.driveFileId;
    if (PLANTILLAS_INMUTABLES.has(driveFileId)) driveFileId = null;

    if (driveFileId) {
        const existe = await driveService.verificarArchivoExiste(driveFileId).catch(() => false);
        if (!existe) driveFileId = null;
    }

    // Siempre partimos de una copia limpia de la plantilla para no acumular
    // reemplazos de blancos ya rellenados en ediciones previas.
    if (driveFileId) {
        await eliminarDocumentoTrabajo(driveFileId);
        driveFileId = null;
    }

    const copia = await copiarPlantilla(nombre);
    driveFileId = copia.id;
    await aplicarContenidoEnDocumento(driveFileId, item);
    return { driveFileId, nombreArchivo: nombre };
}

async function eliminarDocumentoTrabajo(fileId) {
    const id = String(fileId || '').trim();
    if (!id || PLANTILLAS_INMUTABLES.has(id)) return;
    await driveService.eliminarArchivo(id).catch((err) => {
        console.warn('[ATH-F-13] No se pudo eliminar el documento de trabajo:', err.message);
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
    const activa = resolverSolicitudActiva(datos);
    const driveId = activa?.driveFileId && !PLANTILLAS_INMUTABLES.has(activa.driveFileId)
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
        solicitudActivaId: activa?.id || null
    };
}

function claveNombreVacaciones(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/^(ing|mtro|mtra|dr|dra|doc|lic|prof|arq|c)\.?\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function solicitudEsDeUsuario(solicitud, acceso) {
    if (!acceso || acceso.esGestor) return true;
    const nombre = claveNombreVacaciones(acceso.nombreRegistrado);
    return !!nombre && claveNombreVacaciones(solicitud?.nombreCompleto) === nombre;
}

function filtrarDatosPorAcceso(datos, acceso) {
    const base = sanitizarDatos(datos);
    if (!acceso || acceso.esGestor) return base;
    if (!acceso.permitido) {
        return { ...base, solicitudes: [], solicitudActivaId: null };
    }
    const solicitudes = base.solicitudes.filter((s) => solicitudEsDeUsuario(s, acceso));
    const activa = solicitudes.some((s) => s.id === base.solicitudActivaId)
        ? base.solicitudActivaId
        : (solicitudes[0]?.id || null);
    return { ...base, solicitudes, solicitudActivaId: activa };
}

/**
 * Quien no administra el control solo puede guardar sus propias solicitudes.
 * Las de los demás se conservan tal cual.
 */
function fusionarSolicitudesPorAcceso(entrada, previos, acceso) {
    const datos = sanitizarDatos(entrada);
    if (!acceso || acceso.esGestor) return datos;
    const nombre = String(acceso.nombreRegistrado || '').trim();
    const propias = datos.solicitudes
        .filter((s) => !s.nombreCompleto || solicitudEsDeUsuario(s, acceso))
        .map((s) => ({ ...s, nombreCompleto: nombre || s.nombreCompleto }));
    const ajenas = (previos?.solicitudes || []).filter((s) => !solicitudEsDeUsuario(s, acceso));
    return sanitizarDatos({ ...datos, solicitudes: [...ajenas, ...propias] });
}

async function cargarFormato(pool, acceso = null) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = filtrarDatosPorAcceso(
        (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO),
        acceso
    );
    return {
        ...construirRespuesta(registro, datos),
        acceso: acceso || null
    };
}

function solicitudTieneCaptura(solicitud) {
    const s = sanitizarSolicitud(solicitud);
    return !!(
        s.folio || s.lugarFecha || s.nombreCompleto || s.puesto || s.areaDepartamento
        || s.fechaIngreso || s.fechaInicio || s.fechaTermino || s.diasSolicitados
        || s.fechaReincorporacion || s.motivo || s.fechaAutorizacion
        || s.driveFileId || s.pdfFirmado
    );
}

async function procesarSolicitudesEnGuardado(datosEntrada, datosPrevios, acceso = null) {
    const previas = new Map((datosPrevios?.solicitudes || []).map((s) => [s.id, s]));
    const salida = [];
    const idsNuevos = new Set();

    for (const raw of datosEntrada.solicitudes) {
        const item = sanitizarSolicitud(raw);
        idsNuevos.add(item.id);
        const prev = previas.get(item.id);
        if (acceso && !acceso.esGestor && !solicitudEsDeUsuario(item, acceso)) {
            salida.push(prev ? sanitizarSolicitud(prev) : item);
            continue;
        }
        if (!item.driveFileId && prev?.driveFileId) item.driveFileId = prev.driveFileId;
        if (!item.pdfFirmado && prev?.pdfFirmado) item.pdfFirmado = prev.pdfFirmado;
        if (!item.pdfsHistorial?.length && prev?.pdfsHistorial?.length) {
            item.pdfsHistorial = prev.pdfsHistorial;
        }
        if (solicitudTieneCaptura(item)) {
            const doc = await asegurarDocumentoSolicitud(item);
            item.driveFileId = doc.driveFileId;
            item.nombreArchivo = doc.nombreArchivo;
        }
        salida.push(item);
    }

    for (const prev of previas.values()) {
        if (!idsNuevos.has(prev.id) && prev.driveFileId) {
            if (acceso && !acceso.esGestor && !solicitudEsDeUsuario(prev, acceso)) continue;
            await eliminarDocumentoTrabajo(prev.driveFileId);
        }
    }

    return sanitizarDatos({ ...datosEntrada, solicitudes: salida });
}

function parseIsoLocalVacaciones(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const fecha = new Date(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function aIsoLocalVacaciones(fecha) {
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mm}-${dd}`;
}

function periodoVigenteVacaciones(fechaIngreso, hoy = new Date()) {
    const ingreso = parseIsoLocalVacaciones(fechaIngreso);
    if (!ingreso) return null;
    const hoyDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    let anio = hoyDia.getFullYear();
    const aniversario = new Date(anio, ingreso.getMonth(), ingreso.getDate());
    if (hoyDia < aniversario) anio -= 1;
    if (anio < ingreso.getFullYear()) return null;
    return {
        inicio: aIsoLocalVacaciones(new Date(anio, ingreso.getMonth(), ingreso.getDate())),
        fin: aIsoLocalVacaciones(new Date(anio + 1, ingreso.getMonth(), ingreso.getDate()))
    };
}

function solicitudCuentaEnPeriodo(solicitud, periodo) {
    if (!periodo) return true;
    const inicio = String(solicitud?.fechaInicio || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return true;
    return inicio >= periodo.inicio && inicio < periodo.fin;
}

function diasDeSolicitud(solicitud) {
    const n = parseInt(String(solicitud?.diasSolicitados || '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function tomadosPorPersona(solicitudes, ingresoPorNombre) {
    const mapa = new Map();
    for (const solicitud of solicitudes || []) {
        const key = claveNombreVacaciones(solicitud?.nombreCompleto);
        if (!key) continue;
        const ingreso = ingresoPorNombre.get(key) || solicitud?.fechaIngreso || '';
        if (!solicitudCuentaEnPeriodo(solicitud, periodoVigenteVacaciones(ingreso))) continue;
        mapa.set(key, (mapa.get(key) || 0) + diasDeSolicitud(solicitud));
    }
    return mapa;
}

async function validarSaldoRestante(pool, datosNuevos, datosPrevios) {
    const registro = await obtenerRegistroSgcPersistido(pool, 'ATH-F-14');
    let json = registro?.datos_json;
    if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch { json = null; }
    }
    const filas = Array.isArray(json?.filas) ? json.filas : [];
    const disponibles = new Map();
    const ingresos = new Map();
    for (const fila of filas) {
        const key = claveNombreVacaciones(fila?.nombreCompleto);
        if (!key) continue;
        const n = parseInt(String(fila?.diasDisponibles ?? ''), 10);
        disponibles.set(key, Number.isFinite(n) && n >= 0 ? n : 0);
        ingresos.set(key, String(fila?.fechaIngreso || '').trim());
    }
    const antes = tomadosPorPersona(datosPrevios?.solicitudes, ingresos);
    const despues = tomadosPorPersona(datosNuevos?.solicitudes, ingresos);
    for (const [key, tomados] of despues) {
        if (!disponibles.has(key)) continue;
        const tope = disponibles.get(key);
        const previo = antes.get(key) || 0;
        if (tomados > tope && tomados > previo) {
            const nombre = (datosNuevos.solicitudes || []).find(
                (s) => claveNombreVacaciones(s?.nombreCompleto) === key
            )?.nombreCompleto || 'El colaborador';
            const restantes = Math.max(0, tope - previo);
            throw new Error(
                `${nombre} solo tiene ${restantes} día${restantes === 1 ? '' : 's'} restante${restantes === 1 ? '' : 's'} en el control de vacaciones.`
            );
        }
    }
}

async function guardarFormato(pool, body, acceso = null) {
    if (acceso && !acceso.permitido) {
        throw new Error('Solo las personas registradas en el control de vacaciones pueden solicitar vacaciones.');
    }
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = fusionarSolicitudesPorAcceso(body?.datos || body, datosPrevios, acceso);
    await validarSaldoRestante(pool, datosEntrada, datosPrevios);

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    if (!fechaOriginal) fechaOriginal = datosEntrada.fechaElaboracion || fechaHoyIso();

    const datosProcesados = await procesarSolicitudesEnGuardado(datosEntrada, datosPrevios, acceso);
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
    return responderConAcceso(registro, datosProcesados, acceso);
}

function responderConAcceso(registro, datos, acceso, extra = {}) {
    const visibles = filtrarDatosPorAcceso(datos, acceso);
    return {
        ...construirRespuesta(registro, visibles),
        acceso: acceso || null,
        ...extra
    };
}

function assertSolicitudPropia(solicitud, acceso) {
    if (!acceso) return;
    if (!acceso.permitido || (!acceso.esGestor && !solicitudEsDeUsuario(solicitud, acceso))) {
        throw new Error('Solo puedes gestionar tus propias solicitudes de vacaciones.');
    }
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
    if (!existe) throw new Error('Plantilla ATH-F-13 no encontrada en Drive.');
    return {
        codigo: CODIGO_FORMATO,
        templateDriveId: TEMPLATE_DRIVE_ID,
        templateOriginalDriveId: TEMPLATE_ORIGINAL_DRIVE_ID,
        carpetaFormatoId: CARPETA_FORMATO_ID,
        message: 'La plantilla ATH-F-13 está configurada. Cada solicitud nueva se genera como copia independiente; la plantilla nunca se llena.'
    };
}

async function publicarPdfEnDrive(pdfBuffer, solicitud, historial = []) {
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfFirmado(solicitud, historial),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body, acceso = null) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const solicitudId = String(body?.solicitudId || body?.solicitud_id || '').trim();
    if (!solicitudId) throw new Error('Se requiere solicitudId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const solicitudes = [...datosPrevios.solicitudes];
    const idx = solicitudes.findIndex((s) => s.id === solicitudId);
    if (idx < 0) {
        throw new Error('Guarda la solicitud antes de subir el PDF firmado.');
    }

    const actual = { ...solicitudes[idx] };
    assertSolicitudPropia(actual, acceso);
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
    solicitudes[idx] = actual;

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        solicitudes,
        solicitudActivaId: solicitudId
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
    return responderConAcceso(registro, datosGuardar, acceso, { pdfFirmado: actual.pdfFirmado });
}

async function eliminarPdfHistorial(pool, body, opciones = {}, acceso = null) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const solicitudId = String(body?.solicitudId || body?.solicitud_id || '').trim();
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!solicitudId || !driveFileId) throw new Error('solicitudId y driveFileId son requeridos.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const solicitudes = [...datosPrevios.solicitudes];
    const idx = solicitudes.findIndex((s) => s.id === solicitudId);
    if (idx < 0) throw new Error('No se encontró la solicitud.');

    assertNoMutarPlantilla(driveFileId, 'eliminar');
    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[ATH-F-13] No se pudo borrar PDF en Drive:', err.message);
    });

    const actual = { ...solicitudes[idx] };
    assertSolicitudPropia(actual, acceso);
    const hist = sanitizarPdfsHistorial(actual.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = actual.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) pdfFirmado = hist[0] || null;
    actual.pdfsHistorial = hist;
    actual.pdfFirmado = pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null;
    solicitudes[idx] = actual;

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        solicitudes,
        solicitudActivaId: solicitudId
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
    return responderConAcceso(registro, datosGuardar, acceso);
}

async function descargarPdfSolicitud(pool, solicitudId, acceso = null) {
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const id = String(solicitudId || datos.solicitudActivaId || '').trim();
    const solicitud = datos.solicitudes.find((s) => s.id === id) || null;
    if (!solicitud?.driveFileId) {
        throw new Error('Guarda la solicitud antes de generar el PDF.');
    }
    assertSolicitudPropia(solicitud, acceso);
    assertNoMutarPlantilla(solicitud.driveFileId, 'exportar');
    return driveService.exportarArchivoPDF(solicitud.driveFileId);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    TEMPLATE_DRIVE_ID,
    TEMPLATE_ORIGINAL_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_PDF_FIRMADOS_ID,
    CARPETA_FORMATO_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPdfSolicitud,
    sanitizarDatos,
    nombrePdfFirmado
};
