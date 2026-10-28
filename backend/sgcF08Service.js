/**
 * SGC-F-08 · Plan de auditoría.
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF08-MMAA / _N + histograma).
 * Patrón: docs/GUIA-PLANTILLA-EXCEL-SGC.md / sgcDgF05Service / sgcF25Service.
 * Sin archivero.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-08';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1EJMKbuUde5EVdtf39-nAppB_9NBwmTwjKbYjE1HbqJ8
 */
const TEMPLATE_DRIVE_ID = '1EJMKbuUde5EVdtf39-nAppB_9NBwmTwjKbYjE1HbqJ8';
/**
 * Archivo de trabajo Centro SGC (historial SGCF08-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0
 */
const DRIVE_FILE_ID_SISTEMA = '19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/**
 * Documentos firmados (PDF).
 * https://drive.google.com/drive/folders/18nzgxhMQD4yHHVcvZMUHu9PaxtKtIFQ8
 */
const CARPETA_PDF_FIRMADO_DRIVE_ID = '18nzgxhMQD4yHHVcvZMUHu9PaxtKtIFQ8';
/** Carpeta historial SGC-F-08 donde quedaron PDFs antes del traslado. */
const CARPETA_PDF_FIRMADO_LEGACY_DRIVE_ID = '1FZD9Rc4V66pyznYNos-xOQQwpV0U79PZ';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-08 Plan de auditoría (sistema)';
const NOMBRE_PDF_ARCHIVO = 'SGC-F-08 Plan de auditoría.pdf';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Alias legado de hoja de edición en el archivo sistema antiguo. */
const SHEET_TITLE = 'Plan';
const MAX_COLUMNAS_SISTEMA = 8;

/** Nombre base del mes actual (SGCF08-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

/** Carta, vertical, ajustar al ancho, márgenes normales, izq / arriba */
const OPCIONES_PDF_IMPRESION = {
    landscape: false,
    fitToWidth: true,
    size: 'letter',
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    margins: 'normales'
};

/** Columnas útiles del plan (A–H) al subir plantilla a Drive. */
const PDF_MAX_COLUMNAS = 8;

const AGENDA_HEADER_ROW = 21;
/** Fallback si no se localiza «Roles y responsabilidades» en la hoja. */
const AGENDA_START_ROW = 22;
const AGENDA_END_ROW_FALLBACK = 23;
const TEXTO_ROLES_TITULO = 'Roles y responsabilidades';
const TEXTO_LABEL_CRITERIOS = 'Criterios de auditoría:';
const TEXTO_LABEL_ALCANCE = 'Alcance de auditoría:';
const TEXTO_LABEL_OBJETIVO = 'Objetivo(s) de auditoría:';
const TEXTO_FIRMA_AUDITOR = 'Auditor Líder';
const TEXTO_FIRMA_DIRECCION = 'Dirección General';
const TEXTO_FIRMA_ELABORO = 'ELABORÓ';
const TEXTO_FIRMA_REVISO = 'REVISÓ Y APROBÓ';
/** Columnas agenda (plantilla): A Fecha · B Hora · C Área · D:E Criterio · F Auditado · G Auditor */
const AGENDA_COL = {
    fecha: 1,
    hora: 2,
    area: 3,
    criterio: 4,
    auditado: 6,
    auditor: 7
};

const CELDAS = {
    revision: 'F2',
    fechaRevision: 'F3',
    auditoriaNo: 'B5',
    fechaElaboracionInforme: 'E6',
    fechaInicio: 'B6',
    fechaTermino: 'B7',
    fechaEntregaInforme: 'E8',
    empresa: 'B8',
    ubicacion: 'B9',
    criteriosAuditoria: 'C11',
    alcanceAuditoria: 'C12',
    objetivoAuditoria: 'C13',
    auditorLider: 'B15',
    metodoAuditoria: 'G15',
    equipoAuditor: 'A17',
    numObservadores: 'G16',
    numInterpretes: 'G17',
    numGuias: 'G18'
};

const EQUIPO_AUDITOR_ROW = 17;
const EQUIPO_AUDITOR_END_ROW = 19;

const AGENDA_DEFECTO = [
    {
        actividad: 'Reunión de Apertura de Auditoría',
        fecha: '',
        hora: 'No aplica',
        areaDepto: 'No aplica',
        criterio: 'No aplica',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '4.1 Comprensión de las necesidades y su contexto\n4.2 Comprensión de las partes interesadas\n4.3 Determinación del alcance\n5.1 Liderazgo\n5.1.2 Enfoque al cliente\n6.2 Objetivos de calidad\n5.2 Política\n4.4 Sistema de Gestión de Calidad y sus procesos.\n9.3 Revisión por la dirección\n10.3 Mejora continua',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '6.3 Planificación de los cambios\n7.1.5 Recursos de seguimiento y medición\n7.1.6 Conocimiento de la organización\n7.5 Información documentada\n7.3 Toma de conciencia\n8.5.3 Propiedad del cliente.\n10.2 No conformidad y acciones correctivas\n9.1. Seguimiento, medición y análisis.\n9.1.3 Análisis y evaluación.\n9.2 Auditoría interna.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '5.3 Roles, responsabilidad y autoridades\n7.1.4 Ambiente para la Operación de los procesos\n7.2 Competencia\n7.3 Toma de conciencia\n7.4 Comunicación (Interna)',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura\n8.5.4 Preservación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1 Recursos\n9.1.3 Análisis y evaluación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.4 Control de procesos, productos y servicios suministrados externamente.\n8.4.2. Tipo, alcance y control.\n8.4.3 Información para los proveedores externos',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.5.1 Control de la producción.\n8.5.6 Control de los cambios',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.5.1 Control de la producción.\n8.5.6 Control de los cambios',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.4 Control de procesos, productos y servicios suministrados externamente\n8.5.4 Preservación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.4 Control de procesos, productos y servicios suministrados externamente.\n8.5.1 Control de la producción.\n8.5.2 Identificación y trazabilidad\n8.6 Liberación de los productos y servicios.\n8.7 Control de las salidas no conformes.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '5.1.2 Enfoque al cliente\n7.4 Comunicación (Externa).\n8.2.2 Determinación para los requisitos para los productos y servicios.\n8.2.3 Revisión de los requisitos para los productos y servicios.\n8.5.5 Actividades posteriores a la entrega.\n9.1.2 Satisfacción al cliente.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: 'Cierre de Auditoría',
        fecha: '',
        hora: 'No aplica',
        areaDepto: 'No aplica',
        criterio: 'No aplica',
        auditado: '',
        auditor: ''
    }
];

const ROLES_DEFECTO = [
    'Auditor líder: coordinar la auditoría interna y asignar a cada miembro del equipo la responsabilidad para auditar procesos.',
    'Equipo auditor: auditar procesos, funciones, actividades o lugares específicos, según sea apropiado.',
    'Observador: acompaña al equipo auditor y vigila el curso de la auditoría, pero no tiene funciones de auditor.',
    'Guía: asiste al equipo auditor y actúan cuando lo solicite el auditor.'
];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-14',
    fechaElaboracion: '2025-01-14',
    auditoriaNo: '',
    fechaElaboracionInforme: '',
    fechaInicio: '',
    fechaTermino: '',
    fechaEntregaInforme: '',
    empresa: '',
    ubicacion: '',
    criteriosAuditoria: '',
    alcanceAuditoria: 'Toda la Norma, excepto el apartado 8.3 Diseño y desarrollo de productos y servicios.',
    objetivoAuditoria: 'Identificar las oportunidades para la mejora del SGC.',
    auditorLider: '',
    metodoAuditoria: 'En sitio',
    equipoAuditor: '',
    numObservadores: '0',
    numInterpretes: '0',
    numGuias: '0',
    agenda: AGENDA_DEFECTO.map((fila) => ({ ...fila })),
    roles: [...ROLES_DEFECTO],
    pdfFirmado: null,
    pdfsHistorial: []
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return formatearFechaIso(valor);
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
    }
    return normalizarSaltosLinea(String(valor));
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaDisplay(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function parsearRevisionDesdeTexto(texto) {
    const match = String(texto || '').match(/revisi[oó]n\s*:?\s*(\d+)/i);
    return match ? String(match[1]).padStart(2, '0') : '';
}

function parsearFechaRevisionDesdeTexto(texto) {
    const match = String(texto || '').match(/fecha\s*(?:de\s*)?revisi[oó]n\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
    if (match) {
        return formatearFechaIso(match[1].replace(/-/g, '/'));
    }
    return '';
}

function deduplicarCriterioEnFilaAgenda(fila) {
    const item = { ...fila };
    const crit = item.criterio;
    if (!crit) {
        return item;
    }
    if (item.auditado && item.auditado === crit) {
        item.auditado = '';
    }
    if (item.auditor && item.auditor === crit) {
        item.auditor = '';
    }
    if (item.auditado && item.auditor && item.auditor === item.auditado && item.auditado === crit) {
        item.auditor = '';
    }
    return item;
}

function sanitizarFilaAgenda(item) {
    return deduplicarCriterioEnFilaAgenda({
        actividad: String(item?.actividad || '').trim(),
        fecha: String(item?.fecha || '').trim(),
        hora: String(item?.hora || '').trim(),
        areaDepto: String(item?.areaDepto || '').trim(),
        criterio: String(item?.criterio || '').trim(),
        auditado: String(item?.auditado || '').trim(),
        auditor: String(item?.auditor || '').trim()
    });
}

function nombrePdfHistorial(fechaIso = fechaHoyIso(), historial = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const version = siguienteVersionPdfHistorial(historial);
    return `${NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '')} - ${mm}/${yy} - ${version}.pdf`;
}

function siguienteVersionPdfHistorial(historial = []) {
    let max = 0;
    const lista = Array.isArray(historial) ? historial : [];
    for (const item of lista) {
        const nombre = String(item?.nombreArchivo || item?.name || '');
        const match = nombre.match(/- (\d{2})\.pdf$/i);
        if (match) {
            const n = parseInt(match[1], 10);
            if (!Number.isNaN(n) && n > max) max = n;
        }
    }
    return String(max + 1).padStart(2, '0');
}

function esPdfFirmadoSgcF08(nombre) {
    const n = String(nombre || '');
    return /\.pdf$/i.test(n) && /^SGC-F-08 Plan de auditor[ií]a/i.test(n);
}

async function listarPdfsHistorialDrive() {
    const carpetas = [CARPETA_PDF_FIRMADO_DRIVE_ID, CARPETA_PDF_FIRMADO_LEGACY_DRIVE_ID]
        .filter(Boolean);
    const vistos = new Set();
    const todos = [];
    for (const carpetaId of carpetas) {
        const archivos = await driveService.listarArchivosCarpeta(carpetaId).catch(() => []);
        for (const f of archivos || []) {
            if (!esPdfFirmadoSgcF08(f.name) || !f.id || vistos.has(f.id)) continue;
            vistos.add(f.id);
            const item = sanitizarPdfFirmado({
                driveFileId: f.id,
                nombreArchivo: f.name,
                webViewLink: f.webViewLink || null,
                fechaSubida: f.modifiedTime || fechaHoyIso()
            });
            if (item) todos.push(item);
        }
    }
    return todos.sort((a, b) => String(b.fechaSubida || '').localeCompare(String(a.fechaSubida || '')));
}

/**
 * Mueve PDFs firmados SGC-F-08 desde la carpeta historial legacy
 * hacia Documentos Firmados (CARPETA_PDF_FIRMADO_DRIVE_ID).
 */
async function migrarPdfsFirmadosACarpetaCorrecta() {
    const destino = CARPETA_PDF_FIRMADO_DRIVE_ID;
    const movidos = [];
    const omitidos = [];
    const errores = [];
    const origenes = new Set(
        [CARPETA_PDF_FIRMADO_LEGACY_DRIVE_ID].filter((id) => id && id !== destino)
    );

    // Subcarpeta «Documentos Firmados» dentro del historial legacy (si no es ya el destino).
    try {
        const subId = await driveService.buscarCarpeta(
            'Documentos Firmados',
            CARPETA_PDF_FIRMADO_LEGACY_DRIVE_ID
        );
        if (subId && subId !== destino) {
            origenes.add(subId);
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo resolver subcarpeta Documentos Firmados:', err.message);
    }

    for (const origenId of origenes) {
        const archivos = await driveService.listarArchivosCarpeta(origenId).catch(() => []);
        for (const f of archivos || []) {
            if (!esPdfFirmadoSgcF08(f.name) || !f.id) continue;
            try {
                await driveService.moverArchivoDrive(f.id, destino);
                movidos.push({ id: f.id, nombre: f.name, desde: origenId });
                console.log(`[SGC-F-08] PDF firmado movido a Documentos Firmados: ${f.name}`);
            } catch (err) {
                errores.push({ id: f.id, nombre: f.name, error: err.message });
                console.warn(`[SGC-F-08] No se pudo mover PDF «${f.name}»:`, err.message);
            }
        }
    }

    if (!movidos.length && !errores.length) {
        omitidos.push('No había PDFs firmados pendientes de mover.');
    }

    return {
        destino,
        movidos,
        omitidos,
        errores,
        totalMovidos: movidos.length
    };
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
    const vistos = new Set();
    const lista = [];
    for (const item of raw) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || vistos.has(pdf.driveFileId)) continue;
        vistos.add(pdf.driveFileId);
        lista.push(pdf);
    }
    return lista;
}

function preservarPdfMeta(datosEntrada, datosPrevios) {
    const pdfFirmado = sanitizarPdfFirmado(datosEntrada?.pdfFirmado)
        || sanitizarPdfFirmado(datosPrevios?.pdfFirmado)
        || null;
    const histEntrada = sanitizarPdfsHistorial(datosEntrada?.pdfsHistorial);
    const histPrevios = sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial);
    const pdfsHistorial = histEntrada.length ? histEntrada : histPrevios;
    return { pdfFirmado, pdfsHistorial };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const agenda = Array.isArray(base.agenda) ? base.agenda : DATOS_DEFECTO.agenda;
    const roles = Array.isArray(base.roles) ? base.roles : DATOS_DEFECTO.roles;
    const fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;

    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || fechaRevision,
        auditoriaNo: String(base.auditoriaNo || '').trim(),
        fechaElaboracionInforme: String(base.fechaElaboracionInforme || '').trim(),
        fechaInicio: String(base.fechaInicio || '').trim(),
        fechaTermino: String(base.fechaTermino || '').trim(),
        fechaEntregaInforme: String(base.fechaEntregaInforme || '').trim(),
        empresa: String(base.empresa || '').trim(),
        ubicacion: String(base.ubicacion || '').trim(),
        criteriosAuditoria: String(base.criteriosAuditoria || '').trim(),
        alcanceAuditoria: String(base.alcanceAuditoria || DATOS_DEFECTO.alcanceAuditoria).trim(),
        objetivoAuditoria: String(base.objetivoAuditoria || DATOS_DEFECTO.objetivoAuditoria).trim(),
        auditorLider: String(base.auditorLider || '').trim(),
        metodoAuditoria: String(base.metodoAuditoria || DATOS_DEFECTO.metodoAuditoria).trim(),
        equipoAuditor: String(base.equipoAuditor || '').trim(),
        numObservadores: String(base.numObservadores ?? DATOS_DEFECTO.numObservadores).trim(),
        numInterpretes: String(base.numInterpretes ?? DATOS_DEFECTO.numInterpretes).trim(),
        numGuias: String(base.numGuias ?? DATOS_DEFECTO.numGuias).trim(),
        agenda: agenda.map(sanitizarFilaAgenda),
        roles: roles.map((r) => String(r || '').trim()).filter(Boolean),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial)
    };
}

function leerTextoMultiFilasColumna(ws, col, startRow, endRow, omitirPatrones = []) {
    const partes = [];
    for (let r = startRow; r <= endRow; r++) {
        const t = celdaATexto(ws.getRow(r).getCell(col).value);
        if (!t) continue;
        const lower = t.toLowerCase();
        if (omitirPatrones.some((pat) => lower.includes(pat))) continue;
        partes.push(t);
    }
    return partes.join('\n').trim();
}

function leerValorCampo(ws, celdaPrincipal, alternativas = [], patronesOmitir = []) {
    const candidatos = [celdaPrincipal, ...alternativas].filter(Boolean);
    for (const addr of candidatos) {
        const t = celdaATexto(ws.getCell(addr).value);
        if (!t) continue;
        const low = t.toLowerCase();
        if (patronesOmitir.some((pat) => low.includes(pat))) continue;
        return t;
    }
    return '';
}

function leerCampoMultilineaHoja(ws, rowNum, celdasPreferidas = [], patronesOmitir = []) {
    for (const addr of celdasPreferidas) {
        const t = leerValorCampo(ws, addr, [], patronesOmitir);
        if (t) return t;
    }
    for (let col = 3; col <= 8; col++) {
        const t = celdaATexto(ws.getRow(rowNum).getCell(col).value);
        if (!t) continue;
        const low = t.toLowerCase();
        if (patronesOmitir.some((pat) => low.includes(pat))) continue;
        return t;
    }
    return '';
}

function resolverFechaRevisionDocumento(datos, datosPrevios) {
    void datos;
    void datosPrevios;
    return DATOS_DEFECTO.fechaRevision;
}

function esTextoPlaceholderSgcF08(valor) {
    const texto = String(valor || '').trim().toLowerCase();
    if (!texto) return true;
    if (texto === 'ejemplo') return true;
    if (texto === 'criterios de auditoría:') return true;
    if (texto === 'alcance de auditoría:') return true;
    if (texto === 'objetivo(s) de auditoría:') return true;
    return false;
}

function fusionarDatosPreservandoTexto(datosNuevos, datosPrevios) {
    const d = sanitizarDatos(datosNuevos || {});
    if (!datosPrevios) {
        d.fechaRevision = resolverFechaRevisionDocumento(d, null);
        return d;
    }
    const p = sanitizarDatos(datosPrevios);
    if (esTextoPlaceholderSgcF08(d.criteriosAuditoria) && p.criteriosAuditoria) {
        d.criteriosAuditoria = p.criteriosAuditoria;
    }
    if (
        (esTextoPlaceholderSgcF08(d.alcanceAuditoria)
            || d.alcanceAuditoria === DATOS_DEFECTO.alcanceAuditoria)
        && p.alcanceAuditoria
    ) {
        d.alcanceAuditoria = p.alcanceAuditoria;
    }
    if (
        (esTextoPlaceholderSgcF08(d.objetivoAuditoria)
            || d.objetivoAuditoria === DATOS_DEFECTO.objetivoAuditoria)
        && p.objetivoAuditoria
    ) {
        d.objetivoAuditoria = p.objetivoAuditoria;
    }
    d.fechaRevision = resolverFechaRevisionDocumento(d, p);
    if (Array.isArray(d.agenda) && Array.isArray(p.agenda)) {
        d.agenda = d.agenda.map((fila, i) => {
            const prev = p.agenda[i];
            if (!prev) return fila;
            const merged = { ...fila };
            if (!merged.auditado && prev.auditado) merged.auditado = prev.auditado;
            if (!merged.auditor && prev.auditor) merged.auditor = prev.auditor;
            return sanitizarFilaAgenda(merged);
        });
    }
    const metaPdf = preservarPdfMeta(d, p);
    d.pdfFirmado = metaPdf.pdfFirmado;
    d.pdfsHistorial = metaPdf.pdfsHistorial;
    return d;
}

function pushCampoMultilineaSheet(actualizaciones, rowNum, valor, sheetTitle) {
    // Solo C{row}: en plantilla C:G está fusionado; un rango C:H limpia celdas vecinas.
    actualizaciones.push({
        range: rangoSheet(`C${rowNum}`, sheetTitle),
        values: [[valor || '']]
    });
}

function pushCriterioAgenda(actualizaciones, criterio, rowNum, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`D${rowNum}`, sheetTitle),
        values: [[criterio || '']]
    });
}

/** Evita reescribir textos largos de alcance/objetivo en campos cortos corruptos. */
function sanitizarCampoCorto(valor, datos) {
    const v = String(valor || '').trim();
    if (!v) return '';
    const alcance = String(datos?.alcanceAuditoria || '').trim();
    const objetivo = String(datos?.objetivoAuditoria || '').trim();
    if (alcance && v === alcance) return '';
    if (objetivo && v === objetivo) return '';
    if (v.length > 60 && /apartado\s*8\.3|oportunidades para la mejora/i.test(v)) return '';
    return v;
}

function esTextoCriterioAgenda(texto) {
    const s = String(texto || '').trim();
    if (!s) return false;
    if (/^\d+\.\d/.test(s)) return true;
    if (s.length >= 48) return true;
    if (/comprensión de las necesidades|planificación y control|infraestructura/i.test(s)) return true;
    return false;
}

function leerEquipoAuditorDesdeHoja(ws) {
    const principal = celdaATexto(ws.getCell(CELDAS.equipoAuditor).value);
    const desdeA = leerTextoMultiFilasColumna(
        ws,
        1,
        EQUIPO_AUDITOR_ROW,
        EQUIPO_AUDITOR_END_ROW,
        ['equipo auditor', 'no. de', 'auditor líder', 'método de auditoría']
    );
    const desdeB = leerTextoMultiFilasColumna(
        ws,
        2,
        16,
        EQUIPO_AUDITOR_END_ROW,
        ['equipo auditor', 'no. de', 'auditor líder', 'método de auditoría']
    );
    return principal || desdeA || desdeB;
}

function resolverCriterioAgendaFila(d, e, a) {
    const criterioEnD = d || '';
    if (criterioEnD) {
        if (e && e === criterioEnD) return criterioEnD;
        if (e && esTextoCriterioAgenda(e)) {
            return e.includes(criterioEnD) ? e : `${criterioEnD}\n${e}`.trim();
        }
        return criterioEnD;
    }
    if (e && esTextoCriterioAgenda(e)) return e;
    if (esTextoCriterioAgenda(a)) return a;
    return e || '';
}

function leerFilaAgenda(row) {
    const a = celdaATexto(row.getCell(AGENDA_COL.fecha).value);
    const b = celdaATexto(row.getCell(AGENDA_COL.hora).value);
    const c = celdaATexto(row.getCell(AGENDA_COL.area).value);
    const d = celdaATexto(row.getCell(AGENDA_COL.criterio).value);
    const e = celdaATexto(row.getCell(5).value); // posible resto de merge Criterio D:E
    const f = celdaATexto(row.getCell(AGENDA_COL.auditado).value);
    const g = celdaATexto(row.getCell(AGENDA_COL.auditor).value);

    // Layout vigente: F=Auditado, G=Auditor. Legado: E=Auditado, F=Auditor.
    const layoutNuevo = !!(f || g) || (!e && !f && !g);
    const criterioExtra = (!layoutNuevo && esTextoCriterioAgenda(e)) ? e : '';
    const auditado = layoutNuevo ? f : (e && !esTextoCriterioAgenda(e) ? e : f);
    const auditor = layoutNuevo ? g : (g || f);

    if (/apertura de auditoría|cierre de auditoría/i.test(a)) {
        return sanitizarFilaAgenda({
            actividad: a,
            hora: b,
            areaDepto: c,
            criterio: resolverCriterioAgendaFila(d, criterioExtra, a),
            auditado,
            auditor
        });
    }

    const criterioFinal = resolverCriterioAgendaFila(d, criterioExtra, a);
    const fechaEnA = esTextoCriterioAgenda(a) ? '' : a;

    if (fechaEnA || b || c) {
        return sanitizarFilaAgenda({
            fecha: fechaEnA,
            hora: b,
            areaDepto: c,
            criterio: criterioFinal,
            auditado,
            auditor
        });
    }

    if (criterioFinal) {
        return sanitizarFilaAgenda({
            criterio: criterioFinal,
            auditado,
            auditor
        });
    }

    return sanitizarFilaAgenda({
        fecha: a,
        hora: b,
        areaDepto: c,
        criterio: d,
        auditado,
        auditor
    });
}

function escribirFilaAgenda(row, item) {
    const fila = sanitizarFilaAgenda(item);
    for (const col of Object.values(AGENDA_COL)) {
        asignarTextoSimple(row.getCell(col), '', 'left');
    }
    asignarTextoSimple(row.getCell(5), '', 'left'); // celda interior del merge Criterio D:E

    if (fila.actividad) {
        asignarTextoSimple(row.getCell(AGENDA_COL.fecha), fila.actividad, 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.hora), fila.hora || 'No aplica', 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.area), fila.areaDepto || 'No aplica', 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.criterio), fila.criterio || 'No aplica', 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.auditado), fila.auditado, 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.auditor), fila.auditor, 'left');
        return;
    }

    if (fila.criterio && !fila.fecha && !fila.hora && !fila.areaDepto) {
        asignarTextoSimple(row.getCell(AGENDA_COL.criterio), fila.criterio, 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.auditado), fila.auditado, 'left');
        asignarTextoSimple(row.getCell(AGENDA_COL.auditor), fila.auditor, 'left');
        return;
    }

    asignarTextoSimple(row.getCell(AGENDA_COL.fecha), fila.fecha, 'left');
    asignarTextoSimple(row.getCell(AGENDA_COL.hora), fila.hora, 'left');
    asignarTextoSimple(row.getCell(AGENDA_COL.area), fila.areaDepto, 'left');
    asignarTextoSimple(row.getCell(AGENDA_COL.criterio), fila.criterio, 'left');
    asignarTextoSimple(row.getCell(AGENDA_COL.auditado), fila.auditado, 'left');
    asignarTextoSimple(row.getCell(AGENDA_COL.auditor), fila.auditor, 'left');
}

function esFilaAgendaVacia(item) {
    const fila = sanitizarFilaAgenda(item);
    return !fila.actividad && !fila.fecha && !fila.hora && !fila.areaDepto
        && !fila.criterio && !fila.auditado && !fila.auditor;
}

function resolverFilaRolesDesdeWorkbook(ws) {
    const maxScan = Math.max(Number(ws?.rowCount) || 0, 80);
    for (let r = AGENDA_START_ROW; r <= maxScan; r++) {
        const cellA = celdaATexto(ws.getRow(r).getCell(1).value);
        if (new RegExp(`^${TEXTO_ROLES_TITULO}$`, 'i').test(cellA.trim())) {
            return r;
        }
    }
    return null;
}

function leerAgendaDesdeHoja(ws) {
    const agenda = [];
    const filaRoles = resolverFilaRolesDesdeWorkbook(ws);
    const endRow = filaRoles
        ? filaRoles - 1
        : AGENDA_END_ROW_FALLBACK;
    for (let r = AGENDA_START_ROW; r <= endRow; r++) {
        const cellA = celdaATexto(ws.getRow(r).getCell(1).value);
        if (new RegExp(`^${TEXTO_ROLES_TITULO}$`, 'i').test(cellA.trim())) {
            break;
        }
        const fila = leerFilaAgenda(ws.getRow(r));
        if (esFilaAgendaVacia(fila)) {
            continue;
        }
        agenda.push(fila);
    }
    return agenda.length ? agenda : DATOS_DEFECTO.agenda.map((f) => ({ ...f }));
}

function escribirAgendaEnHoja(ws, agendaRaw) {
    const agenda = Array.isArray(agendaRaw) && agendaRaw.length ? agendaRaw : DATOS_DEFECTO.agenda;
    const filaRoles = resolverFilaRolesDesdeWorkbook(ws);
    const endRow = filaRoles ? filaRoles - 1 : AGENDA_END_ROW_FALLBACK;
    const totalSlots = Math.max(0, endRow - AGENDA_START_ROW + 1);
    for (let i = 0; i < totalSlots; i++) {
        const rowNum = AGENDA_START_ROW + i;
        const fila = i < agenda.length ? sanitizarFilaAgenda(agenda[i]) : sanitizarFilaAgenda({});
        escribirFilaAgenda(ws.getRow(rowNum), fila);
    }
}

function pushActualizacionesFilaAgenda(actualizaciones, fila, rowNum, sheetTitle) {
    const item = sanitizarFilaAgenda(fila);
    const colF = columnaALetra(AGENDA_COL.auditado);
    const colG = columnaALetra(AGENDA_COL.auditor);

    if (item.actividad) {
        actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [[item.actividad]] });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [[item.hora || 'No aplica']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [[item.areaDepto || 'No aplica']] });
        pushCriterioAgenda(actualizaciones, item.criterio || 'No aplica', rowNum, sheetTitle);
        actualizaciones.push({ range: rangoSheet(`${colF}${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
        actualizaciones.push({ range: rangoSheet(`${colG}${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
        return;
    }

    if (item.criterio && !item.fecha && !item.hora && !item.areaDepto) {
        actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [['']] });
        pushCriterioAgenda(actualizaciones, item.criterio, rowNum, sheetTitle);
        actualizaciones.push({ range: rangoSheet(`${colF}${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
        actualizaciones.push({ range: rangoSheet(`${colG}${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
        return;
    }

    actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [[item.fecha || '']] });
    actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [[item.hora || '']] });
    actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [[item.areaDepto || '']] });
    pushCriterioAgenda(actualizaciones, item.criterio || '', rowNum, sheetTitle);
    actualizaciones.push({ range: rangoSheet(`${colF}${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
    actualizaciones.push({ range: rangoSheet(`${colG}${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
}

function parsearDatosDesdeHoja(ws) {
    const revisionTexto = celdaATexto(ws.getCell(CELDAS.revision).value);
    const revision = parsearRevisionDesdeTexto(revisionTexto) || DATOS_DEFECTO.revision;
    const fechaRevisionTexto = celdaATexto(ws.getCell(CELDAS.fechaRevision).value)
        || celdaATexto(ws.getCell('A3').value);
    const fechaRevision = parsearFechaRevisionDesdeTexto(fechaRevisionTexto)
        || DATOS_DEFECTO.fechaRevision;

    const agenda = leerAgendaDesdeHoja(ws);

    const roles = [];
    const filaRoles = resolverFilaRolesDesdeWorkbook(ws);
    if (filaRoles) {
        for (let r = filaRoles; r <= filaRoles + 5; r++) {
            const texto = celdaATexto(ws.getRow(r).getCell(1).value);
            if (!texto) continue;
            if (/^auditor líder$/i.test(texto) || /^elaboró$/i.test(texto)) break;
            roles.push(texto);
        }
    }

    const equipoAuditor = leerEquipoAuditorDesdeHoja(ws);

    const criteriosAuditoria = leerCampoMultilineaHoja(ws, 11, ['C11', 'D11'], ['criterios de auditoría']);
    const alcanceAuditoria = leerCampoMultilineaHoja(ws, 12, ['C12', 'D12'], ['alcance de auditoría']);
    const objetivoAuditoria = leerCampoMultilineaHoja(ws, 13, ['C13', 'D13'], ['objetivo']);
    const baseLeida = {
        revision,
        fechaRevision,
        fechaElaboracion: fechaRevision,
        auditoriaNo: celdaATexto(ws.getCell(CELDAS.auditoriaNo).value),
        fechaElaboracionInforme: leerValorCampo(ws, 'E6', ['F6', 'D5']),
        fechaInicio: celdaATexto(ws.getCell(CELDAS.fechaInicio).value),
        fechaTermino: celdaATexto(ws.getCell(CELDAS.fechaTermino).value),
        fechaEntregaInforme: leerValorCampo(ws, 'E8', ['F8', 'D7']),
        empresa: celdaATexto(ws.getCell(CELDAS.empresa).value),
        ubicacion: celdaATexto(ws.getCell(CELDAS.ubicacion).value),
        criteriosAuditoria,
        alcanceAuditoria,
        objetivoAuditoria,
        auditorLider: celdaATexto(ws.getCell(CELDAS.auditorLider).value),
        metodoAuditoria: celdaATexto(ws.getCell(CELDAS.metodoAuditoria).value),
        equipoAuditor,
        numObservadores: celdaATexto(ws.getCell(CELDAS.numObservadores).value),
        numInterpretes: celdaATexto(ws.getCell(CELDAS.numInterpretes).value),
        numGuias: celdaATexto(ws.getCell(CELDAS.numGuias).value),
        agenda: agenda.length ? agenda : DATOS_DEFECTO.agenda,
        roles: roles.length ? roles : DATOS_DEFECTO.roles
    };
    // Limpia campos cortos contaminados con alcance/objetivo (sync previo roto).
    baseLeida.auditoriaNo = sanitizarCampoCorto(baseLeida.auditoriaNo, baseLeida);
    baseLeida.fechaElaboracionInforme = sanitizarCampoCorto(baseLeida.fechaElaboracionInforme, baseLeida);
    baseLeida.fechaInicio = sanitizarCampoCorto(baseLeida.fechaInicio, baseLeida);
    baseLeida.fechaTermino = sanitizarCampoCorto(baseLeida.fechaTermino, baseLeida);
    baseLeida.fechaEntregaInforme = sanitizarCampoCorto(baseLeida.fechaEntregaInforme, baseLeida);
    baseLeida.empresa = sanitizarCampoCorto(baseLeida.empresa, baseLeida);
    baseLeida.ubicacion = sanitizarCampoCorto(baseLeida.ubicacion, baseLeida);
    baseLeida.auditorLider = sanitizarCampoCorto(baseLeida.auditorLider, baseLeida);
    baseLeida.equipoAuditor = sanitizarCampoCorto(baseLeida.equipoAuditor, baseLeida);
    return sanitizarDatos(baseLeida);
}

function limpiarCeldasLegacySgcF08(ws) {
    // Solo limpia celdas de valor legado; NUNCA etiquetas A11:B13 ni firmas.
    asignarTextoSimple(ws.getCell('D5'), '');
    asignarTextoSimple(ws.getCell('D7'), '');
    asignarTextoSimple(ws.getCell('D15'), '');
}

function pushLimpiezaLegacySgcF08(actualizaciones, sheetTitle) {
    // No tocar A11:B13 (etiquetas Criterios/Alcance/Objetivo) ni bloque ELABORÓ.
    const celdas = ['D5', 'D7', 'D15'];
    for (const celda of celdas) {
        actualizaciones.push({ range: rangoSheet(celda, sheetTitle), values: [['']] });
    }
}

function pushEtiquetasEstaticasSgcF08(actualizaciones, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet('A11', sheetTitle),
        values: [[TEXTO_LABEL_CRITERIOS]]
    });
    actualizaciones.push({
        range: rangoSheet('A12', sheetTitle),
        values: [[TEXTO_LABEL_ALCANCE]]
    });
    actualizaciones.push({
        range: rangoSheet('A13', sheetTitle),
        values: [[TEXTO_LABEL_OBJETIVO]]
    });
}

function prepararDatosParaEscritura(datos) {
    const d = sanitizarDatos(datos);
    d.fechaRevision = resolverFechaRevisionDocumento(d, null);
    return d;
}

function escribirDatosEnHoja(ws, datos) {
    const d = prepararDatosParaEscritura(datos);
    limpiarCeldasLegacySgcF08(ws);
    asignarTextoSimple(ws.getCell(CELDAS.revision), `Revisión: ${d.revision}`, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaRevision), `Fecha de revisión: ${formatearFechaDisplay(d.fechaRevision)}`, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.auditoriaNo), d.auditoriaNo);
    asignarTextoSimple(ws.getCell(CELDAS.fechaElaboracionInforme), d.fechaElaboracionInforme, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaInicio), d.fechaInicio, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaTermino), d.fechaTermino, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaEntregaInforme), d.fechaEntregaInforme, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.empresa), d.empresa);
    asignarTextoSimple(ws.getCell(CELDAS.ubicacion), d.ubicacion);
    asignarTextoSimple(ws.getCell(CELDAS.criteriosAuditoria), d.criteriosAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.alcanceAuditoria), d.alcanceAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.objetivoAuditoria), d.objetivoAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.auditorLider), d.auditorLider);
    asignarTextoSimple(ws.getCell(CELDAS.metodoAuditoria), d.metodoAuditoria, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.equipoAuditor), d.equipoAuditor, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.numObservadores), d.numObservadores, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.numInterpretes), d.numInterpretes, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.numGuias), d.numGuias, 'center');

    escribirAgendaEnHoja(ws, d.agenda);
}

function esTituloPlantillaF08(titulo) {
    const t = String(titulo || '').trim().toLowerCase();
    return !t
        || t === 'plantilla'
        || t === 'plantilla.'
        || t === 'plan'
        || t.startsWith('_tmp_');
}

function esNombreHojaHistorial(titulo) {
    return excelHistorial.esHojaHistorialInformacion(String(titulo || '').trim(), CODIGO_FORMATO);
}

function listarHojasHistorialOrdenadas(titulos) {
    return (Array.isArray(titulos) ? titulos : [])
        .map((titulo) => {
            const t = String(titulo || '').trim();
            const meta = excelHistorial.parsearFechaHojaHistorial(t, CODIGO_FORMATO);
            return meta ? { titulo: t, sortKey: meta.sortKey } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.sortKey - a.sortKey);
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/** Última versión del mes: SGCF08-1026_3 > SGCF08-1026_2 > SGCF08-1026. */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => esHojaDelMesActual(t, mes))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

function hojaPorTituloEnWorkbook(wb, titulo) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    const buscado = String(titulo || '').trim();
    if (!buscado) return null;
    return lista.find((ws) => String(ws.name || '').trim() === buscado)
        || lista.find((ws) => String(ws.name || '').trim().toLowerCase() === buscado.toLowerCase())
        || null;
}

function resolverHojaLecturaDesdeWorkbook(wb) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;

    const historiales = listarHojasHistorialOrdenadas(lista.map((ws) => ws.name));
    for (const item of historiales) {
        const ws = hojaPorTituloEnWorkbook(wb, item.titulo);
        if (!ws) continue;
        const datos = parsearDatosDesdeHoja(ws);
        if (datos.auditoriaNo || datos.empresa || (Array.isArray(datos.agenda) && datos.agenda.length)) {
            return ws;
        }
    }
    if (historiales[0]) {
        const wsVacia = hojaPorTituloEnWorkbook(wb, historiales[0].titulo);
        if (wsVacia) return wsVacia;
    }
    return hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE)
        || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        || lista[0];
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    void modo;
    return resolverHojaLecturaDesdeWorkbook(wb);
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-08 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

/** Lee Drive priorizando hojas SGCF08-MMAA(_N) (nunca Plantilla/Plan si hay historial). */
async function leerDatosDesdeDriveConfiable(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        return sanitizarDatos(DATOS_DEFECTO);
    }
    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-08] No se pudieron listar hojas en Drive:', err.message);
        titulos = (wb.worksheets || []).map((ws) => ws.name);
    }

    const historiales = listarHojasHistorialOrdenadas(titulos);
    for (const item of historiales) {
        const ws = hojaPorTituloEnWorkbook(wb, item.titulo);
        if (!ws) continue;
        return sanitizarDatos(parsearDatosDesdeHoja(ws));
    }

    const wsPlantilla = hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE)
        || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        || (wb.worksheets || [])[0];
    if (!wsPlantilla) {
        return sanitizarDatos(DATOS_DEFECTO);
    }
    return sanitizarDatos(parsearDatosDesdeHoja(wsPlantilla));
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || (wb.worksheets || [])[0];
    if (!ws) throw new Error('La plantilla SGC-F-08 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function resolverTituloPlantillaExterna() {
    const titulos = await driveService.listarHojasGoogleSheet(TEMPLATE_DRIVE_ID).catch(() => []);
    const lista = (titulos || []).map((t) => String(t || '').trim()).filter(Boolean);
    const exacta = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase());
    if (exacta) return exacta;
    const plan = lista.find((t) => t.toLowerCase() === SHEET_TITLE.toLowerCase());
    if (plan) return plan;
    if (lista.length) return lista[0];
    throw new Error(
        `No se encontró la hoja «${TEMPLATE_SHEET_TITLE}» en la plantilla SGC-F-08 `
        + `(${TEMPLATE_DRIVE_ID}).`
    );
}

/** Valida cabeceras de agenda (fila 21) típicas de la plantilla SGC-F-08. */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!A${AGENDA_HEADER_ROW}:F${AGENDA_HEADER_ROW}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const joined = row.map((c) => String(c || '').toLowerCase()).join(' ');
        return joined.includes('fecha')
            && (joined.includes('hora') || joined.includes('criterio') || joined.includes('auditor'));
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia «Plantilla» del archivo plantilla externo → sistema como SGCF08-MMAA(_N).
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar plantilla sobre el archivo plantilla SGC-F-08.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    const origenTitulo = await resolverTituloPlantillaExterna();
    console.warn(
        `[SGC-F-08] Copiando hoja «${origenTitulo}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        origenTitulo,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            origenTitulo,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SGC-F-08] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados FECHA / HORA / CRITERIO en la agenda).`
        );
    }
    return copiada.title;
}

/**
 * Sustituye SOLO la hoja del mes de trabajo por una copia limpia de la plantilla
 * externa. Nunca reescribe pestañas de historial de meses previos.
 */
async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede regenerar sobre el archivo plantilla SGC-F-08.');
    }
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-08] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-08] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-08] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede sincronizar sobre el archivo plantilla SGC-F-08.');
    }
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo) || esTituloPlantillaF08(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    const tieneRoles = !!(await resolverFilaRolesDesdeDrive(spreadsheetId, titulo));
    if (!estructuraOk || !tieneRoles) {
        console.warn(
            `[SGC-F-08] «${titulo}» `
            + `${!estructuraOk ? 'sin estructura de agenda' : 'sin Roles/firmas'}; se regenera.`
        );
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-08] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-08] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const historicas = listarHojasHistorialOrdenadas(titulos)
        .filter((item) => !esTituloPlantillaF08(item.titulo));
    if (historicas[0]?.titulo) return historicas[0].titulo;

    if (!titulos.length) return mesActual;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && esNombreHojaHistorial(nombre)
            && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo resolver hoja vigente:', err.message);
    }

    return mesActual;
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return nombreHojaMesActual();
    return resolverTituloHojaVigente(spreadsheetId);
}

async function editorUrlConHojaVigente(driveId) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) return null;
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return `${base}&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo resolver gid editor:', err.message);
    }
    return base;
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch {
        return driveService.descargarArchivo(fileId);
    }
}

function columnaALetra(col) {
    let numero = Number(col);
    let letras = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letras = String.fromCharCode(65 + resto) + letras;
        numero = Math.floor((numero - 1) / 26);
    }
    return letras;
}

function rangoSheet(celda, sheetTitle) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle, agendaEndRow = null) {
    const d = prepararDatosParaEscritura(datos);
    const actualizaciones = [];

    pushLimpiezaLegacySgcF08(actualizaciones, sheetTitle);
    pushEtiquetasEstaticasSgcF08(actualizaciones, sheetTitle);

    actualizaciones.push({
        range: rangoSheet(CELDAS.revision, sheetTitle),
        values: [[`Revisión: ${d.revision}`]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaRevision, sheetTitle),
        values: [[`Fecha de revisión: ${formatearFechaDisplay(d.fechaRevision)}`]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.auditoriaNo, sheetTitle),
        values: [[sanitizarCampoCorto(d.auditoriaNo, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaElaboracionInforme, sheetTitle),
        values: [[sanitizarCampoCorto(d.fechaElaboracionInforme, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaInicio, sheetTitle),
        values: [[sanitizarCampoCorto(d.fechaInicio, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaTermino, sheetTitle),
        values: [[sanitizarCampoCorto(d.fechaTermino, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaEntregaInforme, sheetTitle),
        values: [[sanitizarCampoCorto(d.fechaEntregaInforme, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.empresa, sheetTitle),
        values: [[sanitizarCampoCorto(d.empresa, d)]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.ubicacion, sheetTitle),
        values: [[sanitizarCampoCorto(d.ubicacion, d)]]
    });
    pushCampoMultilineaSheet(actualizaciones, 11, d.criteriosAuditoria, sheetTitle);
    pushCampoMultilineaSheet(actualizaciones, 12, d.alcanceAuditoria, sheetTitle);
    pushCampoMultilineaSheet(actualizaciones, 13, d.objetivoAuditoria, sheetTitle);
    actualizaciones.push({
        range: rangoSheet(CELDAS.auditorLider, sheetTitle),
        values: [[sanitizarCampoCorto(d.auditorLider, d)]]
    });
    actualizaciones.push({ range: rangoSheet(CELDAS.metodoAuditoria, sheetTitle), values: [[d.metodoAuditoria]] });
    actualizaciones.push({
        range: rangoSheet(CELDAS.equipoAuditor, sheetTitle),
        values: [[sanitizarCampoCorto(d.equipoAuditor, d)]]
    });
    actualizaciones.push({ range: rangoSheet(CELDAS.numObservadores, sheetTitle), values: [[d.numObservadores]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.numInterpretes, sheetTitle), values: [[d.numInterpretes]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.numGuias, sheetTitle), values: [[d.numGuias]] });

    const agenda = d.agenda.length ? d.agenda : DATOS_DEFECTO.agenda;
    const endRow = Number(agendaEndRow) > 0 ? Number(agendaEndRow) : AGENDA_END_ROW_FALLBACK;
    const totalSlots = Math.max(0, endRow - AGENDA_START_ROW + 1);
    for (let i = 0; i < totalSlots; i++) {
        const rowNum = AGENDA_START_ROW + i;
        const fila = i < agenda.length ? agenda[i] : sanitizarFilaAgenda({});
        pushActualizacionesFilaAgenda(actualizaciones, fila, rowNum, sheetTitle);
    }

    return actualizaciones;
}

async function resolverFilaRolesDesdeDrive(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return null;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!A${AGENDA_START_ROW}:A80`
        );
        for (let i = 0; i < (filas || []).length; i++) {
            const texto = String(filas[i]?.[0] || '').trim();
            if (new RegExp(`^${TEXTO_ROLES_TITULO}$`, 'i').test(texto)) {
                return AGENDA_START_ROW + i;
            }
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo localizar fila de roles:', err.message);
    }
    return null;
}

/**
 * Inserta filas de agenda antes de «Roles y responsabilidades» para no pisar
 * roles ni el bloque ELABORÓ / REVISÓ Y APROBÓ.
 */
async function asegurarFilasAgendaEnDrive(spreadsheetId, sheetTitle, numFilasAgenda) {
    const necesitadas = Math.max(1, Number(numFilasAgenda) || 1);
    let filaRoles = await resolverFilaRolesDesdeDrive(spreadsheetId, sheetTitle);
    if (!filaRoles) {
        // Sin bloque de roles: usar hueco mínimo de la plantilla.
        return AGENDA_START_ROW + necesitadas - 1;
    }

    const disponibles = Math.max(0, filaRoles - AGENDA_START_ROW);
    if (necesitadas === disponibles) {
        return filaRoles - 1;
    }

    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hoja = (hojas || []).find((h) => String(h.title || '').trim() === String(sheetTitle).trim());
    if (!hoja || hoja.sheetId == null) {
        return filaRoles - 1;
    }

    if (necesitadas > disponibles) {
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            hoja.sheetId,
            filaRoles - 1, // índice 0-based: insertar justo antes de Roles
            necesitadas - disponibles,
            { inheritFromBefore: true }
        );
        filaRoles = await resolverFilaRolesDesdeDrive(spreadsheetId, sheetTitle) || (filaRoles + (necesitadas - disponibles));
    } else if (necesitadas < disponibles) {
        // No eliminamos filas sobrantes para no acercar firmas; solo se limpian al escribir.
    }

    return Math.max(AGENDA_START_ROW, filaRoles - 1);
}

async function asegurarMergesCriterioAgenda(spreadsheetId, sheetTitle, agendaStart, agendaEnd) {
    if (!spreadsheetId || !sheetTitle || agendaEnd < agendaStart) return;
    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId).catch(() => []);
    const hoja = (hojas || []).find((h) => String(h.title || '').trim() === String(sheetTitle).trim());
    if (!hoja || hoja.sheetId == null) return;

    const sheetIdNum = Number(hoja.sheetId);
    const requests = [];
    // Primero descombinar D:E por si quedó un merge parcial (evita error de la API).
    for (let row = agendaStart; row <= agendaEnd; row++) {
        requests.push({
            unmergeCells: {
                range: {
                    sheetId: sheetIdNum,
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: 3,
                    endColumnIndex: 5
                }
            }
        });
    }
    for (let row = agendaStart; row <= agendaEnd; row++) {
        // D:E = Criterio (2 columnas, como la plantilla / imagen 2)
        requests.push({
            mergeCells: {
                range: {
                    sheetId: sheetIdNum,
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: 3,
                    endColumnIndex: 5
                },
                mergeType: 'MERGE_ALL'
            }
        });
    }
    try {
        await driveService.batchUpdateGoogleSheet(spreadsheetId, requests, 'sgcF08.mergeCriterio');
    } catch (err) {
        // Si unmerge falla en celdas sin merge, reintentar solo merges fila a fila.
        console.warn('[SGC-F-08] Merge batch Criterio D:E falló; reintento por fila:', err.message);
        for (let row = agendaStart; row <= agendaEnd; row++) {
            try {
                await driveService.batchUpdateGoogleSheet(spreadsheetId, [
                    {
                        unmergeCells: {
                            range: {
                                sheetId: sheetIdNum,
                                startRowIndex: row - 1,
                                endRowIndex: row,
                                startColumnIndex: 3,
                                endColumnIndex: 5
                            }
                        }
                    },
                    {
                        mergeCells: {
                            range: {
                                sheetId: sheetIdNum,
                                startRowIndex: row - 1,
                                endRowIndex: row,
                                startColumnIndex: 3,
                                endColumnIndex: 5
                            },
                            mergeType: 'MERGE_ALL'
                        }
                    }
                ], 'sgcF08.mergeCriterio.fila');
            } catch (_) { /* fila ya ok o no mergeable */ }
        }
    }
}

/**
 * Escribe SIEMPRE el bloque inferior (Roles + firmas) debajo de la agenda,
 * igual que la plantilla / hoja histórica SGCF08-0125.
 * Layout:
 *   agendaEnd+1  → «Roles y responsabilidades»
 *   +2..+5       → textos de roles
 *   +11 / +12    → Auditor Líder | Dirección General / ELABORÓ | REVISÓ Y APROBÓ
 */
async function escribirBloqueRolesYFirmas(spreadsheetId, sheetTitle, agendaEndRow) {
    if (!spreadsheetId || !sheetTitle) return null;
    const base = Number(agendaEndRow) > 0 ? Number(agendaEndRow) : AGENDA_END_ROW_FALLBACK;
    const filaRoles = base + 1;
    const rolesTextos = Array.isArray(ROLES_DEFECTO) && ROLES_DEFECTO.length
        ? ROLES_DEFECTO
        : [
            'Auditor líder: coordinar la auditoría interna y asignar a cada miembro del equipo la responsabilidad para auditar procesos.',
            'Equipo auditor: auditar procesos, funciones, actividades o lugares específicos, según sea apropiado.',
            'Observador: acompaña al equipo auditor y vigila el curso de la auditoría, pero no tiene funciones de auditor.',
            'Guía: asiste al equipo auditor y actúan cuando lo solicite el auditor.'
        ];
    const filaFirmaNombres = filaRoles + 10;
    const filaFirmaTitulos = filaRoles + 11;

    const actualizaciones = [
        { range: rangoSheet(`A${filaRoles}`, sheetTitle), values: [[TEXTO_ROLES_TITULO]] },
        // Limpia basura residual bajo la agenda (p. ej. alcance pegado).
        { range: rangoSheet(`B${filaRoles}:G${filaRoles}`, sheetTitle), values: [['', '', '', '', '', '']] }
    ];
    for (let i = 0; i < rolesTextos.length; i++) {
        const row = filaRoles + 1 + i;
        actualizaciones.push({ range: rangoSheet(`A${row}`, sheetTitle), values: [[rolesTextos[i]]] });
        actualizaciones.push({
            range: rangoSheet(`B${row}:G${row}`, sheetTitle),
            values: [['', '', '', '', '', '']]
        });
    }
    // Hueco entre roles y firmas (filas intermedias): limpiar A:G
    for (let row = filaRoles + 1 + rolesTextos.length; row < filaFirmaNombres; row++) {
        actualizaciones.push({
            range: rangoSheet(`A${row}:G${row}`, sheetTitle),
            values: [['', '', '', '', '', '', '']]
        });
    }
    actualizaciones.push(
        { range: rangoSheet(`B${filaFirmaNombres}`, sheetTitle), values: [[TEXTO_FIRMA_AUDITOR]] },
        { range: rangoSheet(`E${filaFirmaNombres}`, sheetTitle), values: [[TEXTO_FIRMA_DIRECCION]] },
        { range: rangoSheet(`B${filaFirmaTitulos}`, sheetTitle), values: [[TEXTO_FIRMA_ELABORO]] },
        { range: rangoSheet(`E${filaFirmaTitulos}`, sheetTitle), values: [[TEXTO_FIRMA_REVISO]] }
    );

    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);

    // Merges de firmas (B:C y E:F). Solo borde superior en «Auditor Líder» / «Dirección General».
    try {
        const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId).catch(() => []);
        const hoja = (hojas || []).find((h) => String(h.title || '').trim() === String(sheetTitle).trim());
        if (hoja?.sheetId != null) {
            const sheetIdNum = Number(hoja.sheetId);
            const sinBorde = { style: 'NONE' };
            const bordeSuperior = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
            const requests = [];
            const mergeFirma = (row1, colStart0, colEnd0) => {
                requests.push({
                    unmergeCells: {
                        range: {
                            sheetId: sheetIdNum,
                            startRowIndex: row1 - 1,
                            endRowIndex: row1,
                            startColumnIndex: colStart0,
                            endColumnIndex: colEnd0
                        }
                    }
                });
                requests.push({
                    mergeCells: {
                        range: {
                            sheetId: sheetIdNum,
                            startRowIndex: row1 - 1,
                            endRowIndex: row1,
                            startColumnIndex: colStart0,
                            endColumnIndex: colEnd0
                        },
                        mergeType: 'MERGE_ALL'
                    }
                });
            };
            // B:C y E:F en ambas filas de firma
            mergeFirma(filaFirmaNombres, 1, 3);
            mergeFirma(filaFirmaNombres, 4, 6);
            mergeFirma(filaFirmaTitulos, 1, 3);
            mergeFirma(filaFirmaTitulos, 4, 6);

            // Quitar cualquier borde del bloque completo de firmas.
            requests.push({
                updateBorders: {
                    range: {
                        sheetId: sheetIdNum,
                        startRowIndex: filaFirmaNombres - 1,
                        endRowIndex: filaFirmaTitulos,
                        startColumnIndex: 1,
                        endColumnIndex: 6
                    },
                    top: sinBorde,
                    bottom: sinBorde,
                    left: sinBorde,
                    right: sinBorde,
                    innerHorizontal: sinBorde,
                    innerVertical: sinBorde
                }
            });
            // Solo línea superior (firma) sobre «Auditor Líder» (B:C).
            requests.push({
                updateBorders: {
                    range: {
                        sheetId: sheetIdNum,
                        startRowIndex: filaFirmaNombres - 1,
                        endRowIndex: filaFirmaNombres,
                        startColumnIndex: 1,
                        endColumnIndex: 3
                    },
                    top: bordeSuperior
                }
            });
            // Solo línea superior (firma) sobre «Dirección General» (E:F).
            requests.push({
                updateBorders: {
                    range: {
                        sheetId: sheetIdNum,
                        startRowIndex: filaFirmaNombres - 1,
                        endRowIndex: filaFirmaNombres,
                        startColumnIndex: 4,
                        endColumnIndex: 6
                    },
                    top: bordeSuperior
                }
            });
            requests.push({
                repeatCell: {
                    range: {
                        sheetId: sheetIdNum,
                        startRowIndex: filaFirmaNombres - 1,
                        endRowIndex: filaFirmaTitulos,
                        startColumnIndex: 1,
                        endColumnIndex: 6
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP'
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
                }
            });
            await driveService.batchUpdateGoogleSheet(spreadsheetId, requests, 'sgcF08.firmas');
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo formatear bloque de firmas:', err.message);
    }

    return { filaRoles, filaFirmaNombres, filaFirmaTitulos };
}

/** Estima alto de fila (px) según contenido, con wrap en Criterio D:E. */
function estimarAltoFilaAgendaPx(fila) {
    const item = sanitizarFilaAgenda(fila || {});
    const columnas = [
        { texto: item.actividad || item.fecha, charsPorLinea: 16 },
        { texto: item.hora, charsPorLinea: 10 },
        { texto: item.areaDepto, charsPorLinea: 18 },
        // Criterio ocupa D:E (~2 columnas): más ancho, pero textos muy largos.
        { texto: item.criterio, charsPorLinea: 45 },
        { texto: item.auditado, charsPorLinea: 16 },
        { texto: item.auditor, charsPorLinea: 16 }
    ];
    let maxLineas = 1;
    for (const { texto, charsPorLinea } of columnas) {
        const t = String(texto || '').trim();
        if (!t) continue;
        const lineas = t.split(/\n/).reduce((sum, parte) => {
            const limpio = String(parte || '').trim();
            if (!limpio) return sum + 1;
            return sum + Math.max(1, Math.ceil(limpio.length / Math.max(8, charsPorLinea)));
        }, 0);
        maxLineas = Math.max(maxLineas, lineas);
    }
    // ~20px por línea + margen; tope alto para no cortar criterios largos.
    return Math.min(520, Math.max(36, 16 + maxLineas * 20));
}

async function aplicarFormatoVisualSgcF08(spreadsheetId, sheetTitle, agendaEndRow = null, agenda = []) {
    if (!spreadsheetId || !sheetTitle) {
        return;
    }
    const endRow = Number(agendaEndRow) > 0 ? Number(agendaEndRow) : AGENDA_END_ROW_FALLBACK;
    try {
        await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
            sheetTitle,
            startRow: 6,
            endRow: 7,
            startColumn: 2,
            endColumn: 2,
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP'
        });
        // Etiquetas + valores Criterios/Alcance/Objetivo
        await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
            sheetTitle,
            startRow: 11,
            endRow: 13,
            startColumn: 1,
            endColumn: 7,
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP'
        });

        const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId).catch(() => []);
        const hoja = (hojas || []).find((h) => String(h.title || '').trim() === String(sheetTitle).trim());
        if (hoja?.sheetId != null) {
            const borde = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
            const sheetIdNum = Number(hoja.sheetId);
            const requests = [
                {
                    updateBorders: {
                        range: {
                            sheetId: sheetIdNum,
                            startRowIndex: AGENDA_HEADER_ROW - 1,
                            endRowIndex: endRow,
                            startColumnIndex: 0,
                            endColumnIndex: 7
                        },
                        top: borde,
                        bottom: borde,
                        left: borde,
                        right: borde,
                        innerHorizontal: borde,
                        innerVertical: borde
                    }
                },
                {
                    repeatCell: {
                        range: {
                            sheetId: sheetIdNum,
                            startRowIndex: AGENDA_HEADER_ROW - 1,
                            endRowIndex: endRow,
                            startColumnIndex: 0,
                            endColumnIndex: 7
                        },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: 'LEFT',
                                verticalAlignment: 'MIDDLE',
                                wrapStrategy: 'WRAP'
                            }
                        },
                        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
                    }
                }
            ];
            const lista = Array.isArray(agenda) ? agenda : [];
            const totalFilas = Math.max(0, endRow - AGENDA_START_ROW + 1);
            for (let i = 0; i < totalFilas; i++) {
                const alto = estimarAltoFilaAgendaPx(lista[i] || {});
                const row0 = AGENDA_START_ROW + i - 1;
                requests.push({
                    updateDimensionProperties: {
                        range: {
                            sheetId: sheetIdNum,
                            dimension: 'ROWS',
                            startIndex: row0,
                            endIndex: row0 + 1
                        },
                        properties: { pixelSize: alto },
                        fields: 'pixelSize'
                    }
                });
            }
            await driveService.batchUpdateGoogleSheet(spreadsheetId, requests, 'sgcF08.formatoAgenda');
        } else {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow: AGENDA_HEADER_ROW,
                endRow,
                startColumn: 1,
                endColumn: 7,
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
            });
        }
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle, opciones = {}) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const d = prepararDatosParaEscritura(datos);
    const agenda = d.agenda.length ? d.agenda : DATOS_DEFECTO.agenda;

    // Si falta el bloque Roles (p. ej. historial copiado de hoja corrupta), regenerar
    // desde plantilla externa — salvo cuando venimos de un copyTo fresco.
    if (!opciones.omitirHealRoles) {
        const filaRolesPrevia = await resolverFilaRolesDesdeDrive(spreadsheetId, titulo);
        if (!filaRolesPrevia) {
            console.warn(
                `[SGC-F-08] «${titulo}» sin bloque Roles/firmas; se regenera desde plantilla.`
            );
            return reescribirHojaDesdePlantilla(spreadsheetId, titulo, d);
        }
    }

    let agendaEndRow = await asegurarFilasAgendaEnDrive(spreadsheetId, titulo, agenda.length);
    // Si aun así no hay Roles (omitirHeal / insert falló), reservar hueco fijo y
    // escribir el bloque inferior a mano.
    if (!(await resolverFilaRolesDesdeDrive(spreadsheetId, titulo))) {
        agendaEndRow = AGENDA_START_ROW + Math.max(1, agenda.length) - 1;
    }

    await asegurarMergesCriterioAgenda(spreadsheetId, titulo, AGENDA_START_ROW, agendaEndRow);

    const actualizaciones = datosAActualizacionesSheet(d, titulo, agendaEndRow);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    // Siempre reescribe Roles + ELABORÓ / REVISÓ debajo de la agenda (imagen 2).
    await escribirBloqueRolesYFirmas(spreadsheetId, titulo, agendaEndRow);
    await aplicarFormatoVisualSgcF08(spreadsheetId, titulo, agendaEndRow, agenda);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    // Tras copyTo la plantilla ya trae Roles; no re-entrar a regenerar el libro.
    // Igual se vuelve a escribir el bloque inferior por si el insert de filas lo desplazó.
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle, { omitirHealRoles: true });
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-08 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const { pdfFirmado: _pdf, pdfsHistorial: _hist, ...rest } = sanitizarDatos(datos);
        return rest;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function estructuraEsEquivalente(a, b) {
    const fa = Array.isArray(a?.agenda) ? a.agenda.length : 0;
    const fb = Array.isArray(b?.agenda) ? b.agenda.length : 0;
    return fa === fb;
}

/**
 * SGC-F-08 solo usa pestañas SGCF08-MMAA / SGCF08-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes (_2, _3…).
 */
async function aplicarHistorialSgcF08(opciones) {
    const datosNuevosFusionados = fusionarDatosPreservandoTexto(
        opciones.datosNuevos,
        opciones.datosPrevios
    );
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: datosNuevosFusionados,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
    });
}

/**
 * Elimina pestañas Alias_r* residuales. Conserva SGCF08-MMAA(_N) e histograma.
 */
async function eliminarHojasHistorialFormatoSgcF08(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-08] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && (patronAlias.test(nombre) || nombre.toLowerCase() === SHEET_TITLE.toLowerCase());
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-08] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-08] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

function esArchivoProtegidoDrive(id) {
    const val = String(id || '').trim();
    return !!val && (val === TEMPLATE_DRIVE_ID || val === DRIVE_FILE_ID_SISTEMA);
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        if (!id || id === excluirId || esArchivoProtegidoDrive(id)) return false;
        return name.startsWith(objetivo);
    });
    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) {
                return false;
            }
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function archivoEstaEnCarpeta(fileId, folderId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const parents = Array.isArray(info?.parents) ? info.parents : [];
        return parents.includes(folderId);
    } catch {
        return false;
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) {
        return false;
    }
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function persistirDriveFileIdEnDb(pool, driveFileId, registro = null) {
    const registroBase = registro || await obtenerRegistroDb(pool);
    const datosActuales = await leerDatosRegistro(registroBase) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosActuales,
        fechaElaboracionOriginal: formatearFechaIso(registroBase?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registroBase?.fecha_modificacion_contenido),
        contenidoModificado: !!registroBase?.contenido_modificado
    });
}

async function restaurarDriveComoGoogleSheet(fileId, pool, registro = null) {
    console.log(`[SGC-F-08] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
    const archivo = await driveService.convertirOfficeExcelAGoogleSheet(fileId, {
        nombre: NOMBRE_ARCHIVO_DRIVE,
        carpetaId: CARPETA_DRIVE_ID,
        eliminarOriginal: true
    });
    const nuevoId = archivo?.id;
    if (!nuevoId) {
        throw new Error('No se obtuvo ID del Google Sheet restaurado');
    }
    await persistirDriveFileIdEnDb(pool, nuevoId, registro);
    console.log(`[SGC-F-08] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA]
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== TEMPLATE_DRIVE_ID);
    const unicos = [...new Set(candidatos)];

    for (const id of unicos) {
        if (await esSpreadsheetEditableEnDrive(id)) {
            if (id !== driveId) {
                await persistirDriveFileIdEnDb(pool, id, registro);
            }
            return id;
        }
    }

    const idOffice = unicos.find(Boolean);
    if (!idOffice) {
        throw new Error('No hay archivo sistema SGC-F-08 configurado en Drive.');
    }
    return await restaurarDriveComoGoogleSheet(idOffice, pool, registro);
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
        if (existeSistema) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb).catch(() => false);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-08] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: PDF_MAX_COLUMNAS, keepSingleSheet: false }
    );
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

function formatearInstanteMexico(fecha) {
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return null;
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

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    const dbVal = registro?.ultima_sync_drive;
    if (dbVal != null && dbVal !== '') {
        return formatearDatetimeMysqlMexico(dbVal);
    }
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) {
        return formatearInstanteMexico(driveVal);
    }
    return null;
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    let driveId = archivoDrive?.id || registro?.drive_file_id || null;
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;
    const pdfsHistorial = sanitizarPdfsHistorial(datos.pdfsHistorial);

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            fechaRevision: resolverFechaRevisionDocumento(datos, null),
            pdfFirmado,
            pdfsHistorial
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        plantillaDriveId: TEMPLATE_DRIVE_ID,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: pdfsHistorial
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = null;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        driveFileId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDbPrev = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDbPrev || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const datosDb = await leerDatosRegistro(registro);
    let datosDrive = null;
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            datosDrive = await leerDatosDesdeDriveConfiable(driveFileId);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo leer archivo en Drive, usando BD:', err.message);
        }
    }

    // Fuente de verdad: BD. Drive recupera si BD está vacía; PDFs siempre desde BD.
    if (datosDb) {
        datos = datosDb;
        if (datosDrive) {
            // Preferir campos de formulario de BD; Drive solo si BD no tiene agenda útil.
            const agendaDb = Array.isArray(datosDb.agenda) ? datosDb.agenda : [];
            if (!agendaDb.length && Array.isArray(datosDrive.agenda) && datosDrive.agenda.length) {
                datos = {
                    ...datosDrive,
                    pdfFirmado: datosDb.pdfFirmado,
                    pdfsHistorial: datosDb.pdfsHistorial
                };
            }
        }
    } else if (datosDrive) {
        datos = datosDrive;
        try {
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original)
                    || datos.fechaElaboracion
                    || fechaHoyIso(),
                fechaModificacionContenido: fechaHoyIso(),
                contenidoModificado: true
            });
            registro = await obtenerRegistroDb(pool);
            console.log('[SGC-F-08] BD restaurada desde Drive.');
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo restaurar BD desde Drive:', err.message);
        }
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoSgcF08(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[SGC-F-08] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[SGC-F-08] «${destino}» no coincide con plantilla; se regenera.`);
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[SGC-F-08] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        } else if (!datos) {
            datos = datosDb || sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo leer plantilla, usando datos por defecto:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = { ...registro, drive_file_id: driveFileId || null };
    datos = sanitizarDatos(datos || DATOS_DEFECTO);
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo asegurar permiso de enlace:', err.message);
        }
    }
    return construirRespuesta(registro, datos, archivoDrive);
}

let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body, options = {}) {
    const ejecutar = () => guardarFormatoInterno(pool, body, options);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    const registroPrevio = await obtenerRegistroDb(pool);
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
    const datosEntrada = fusionarDatosPreservandoTexto(
        sanitizarDatos(body?.datos || body),
        datosPrevios
    );
    const metaPdfEntrada = preservarPdfMeta(datosEntrada, datosPrevios);
    datosEntrada.pdfFirmado = metaPdfEntrada.pdfFirmado;
    datosEntrada.pdfsHistorial = metaPdfEntrada.pdfsHistorial;
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaRevision || DATOS_DEFECTO.fechaElaboracion;
    }

    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveId) {
        try {
            driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo asegurar Google Sheet:', err.message);
        }
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);

    if (!huboCambio && driveId && driveId !== TEMPLATE_DRIVE_ID) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            await eliminarHojasHistorialFormatoSgcF08(driveId);
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialSgcF08({
                spreadsheetId: driveId,
                datosPrevios: datosPrevios || sanitizarDatos(DATOS_DEFECTO),
                datosNuevos: origen !== 'consulta' ? { ...datosEntrada } : datosEntrada,
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;
            const metaPdfHist = preservarPdfMeta(datosGuardar, datosEntrada);
            datosGuardar.pdfFirmado = metaPdfHist.pdfFirmado;
            datosGuardar.pdfsHistorial = metaPdfHist.pdfsHistorial;

            if (hist.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            } else if (huboCambio && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                ? fechaModificacion
                : fechaOriginal;

            let archivoDrive = null;
            let tituloSync = String(hist.hojaVigente || '').trim();
            if (!tituloSync || esTituloPlantillaF08(tituloSync) || !esNombreHojaHistorial(tituloSync)) {
                tituloSync = await resolverTituloHojaVigente(driveId);
            }
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
            } catch (syncErr) {
                console.warn('[SGC-F-08] Sync hoja edición falló tras historial:', syncErr.message);
            }
            if (!archivoDrive) {
                archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
            }

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            return construirRespuesta(await obtenerRegistroDb(pool), datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const driveTrabajo = driveId || await resolverDriveFileId(registroPrevio);
    if (!driveTrabajo || driveTrabajo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo sincronizar SGC-F-08: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo) || esTituloPlantillaF08(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[SGC-F-08] Adoptar plantilla en fallback:', adoptErr.message);
    }
    const archivoDrive = await sincronizarHojaEdicionDrive(driveTrabajo, datosGuardar, tituloNuevo)
        || await driveService.obtenerInfoArchivo(driveTrabajo).catch(() => ({ id: driveTrabajo }));

    await guardarRegistroDb(pool, {
        driveFileId: driveTrabajo,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });
    return construirRespuesta(await obtenerRegistroDb(pool), datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const datosDrive = await leerDatosDesdeDriveConfiable(driveFileId);
    const datosPrevios = await leerDatosRegistro(registro);
    const metaPdfDrive = preservarPdfMeta(datosDrive, datosPrevios);
    datosDrive.pdfFirmado = metaPdfDrive.pdfFirmado;
    datosDrive.pdfsHistorial = metaPdfDrive.pdfsHistorial;

    if (datosPrevios && contenidoEsEquivalente(datosPrevios, datosDrive)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaRevision
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialSgcF08({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosDrive,
        origen: 'drive'
    });
    const datosGuardar = hist.datosGuardar;
    const metaPdfSync = preservarPdfMeta(datosGuardar, datosPrevios);
    datosGuardar.pdfFirmado = metaPdfSync.pdfFirmado;
    datosGuardar.pdfsHistorial = metaPdfSync.pdfsHistorial;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaCambio;
    } else {
        contenidoModificado = true;
        fechaModificacion = fechaCambio;
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (hoja del mes vigente), sin borrar historial ni tocar la plantilla ni el histograma.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema SGC-F-08 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoSgcF08(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo eliminar hoja previa del mes:', err.message);
        }
    }

    tituloHoja = await adoptarPlantillaEnSistema(driveId, tituloMes);
    const archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosPublicar, tituloHoja);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-08 para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const opciones = { ...OPCIONES_PDF_IMPRESION };
    const info = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
        let tituloHoja = nombreHojaMesActual();
        try {
            tituloHoja = await resolverTituloHojaVigente(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo resolver la hoja vigente para PDF:', err.message);
        }
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
            if (gid != null) opciones.gid = gid;
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo resolver gid de hoja para PDF:', err.message);
        }
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, opciones);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-08 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    const historialDrivePrev = await listarPdfsHistorialDrive().catch(() => []);
    const histPrev = sanitizarPdfsHistorial([
        ...sanitizarPdfsHistorial(datosPrevios.pdfsHistorial),
        ...historialDrivePrev
    ]);
    const nombreArchivo = nombrePdfHistorial(fechaHoyIso(), histPrev);
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADO_DRIVE_ID
    );

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const pdfsHistorial = [
        pdfFirmado,
        ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)
    ];

    const datosGuardar = { ...datosPrevios, pdfFirmado, pdfsHistorial };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let driveFileId = registroPrevio?.drive_file_id || await resolverDriveFileId(registroPrevio);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        driveFileId = DRIVE_FILE_ID_SISTEMA;
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveFileId
        ? await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }))
        : null;
    return { ...(await construirRespuesta(registro, datosGuardar, archivoDrive)), pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[SGC-F-08] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const datosGuardar = { ...datosPrevios, pdfFirmado, pdfsHistorial: hist };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let sheetId = registroPrevio?.drive_file_id || null;
    if (sheetId === TEMPLATE_DRIVE_ID) {
        sheetId = DRIVE_FILE_ID_SISTEMA;
    }

    await guardarRegistroDb(pool, {
        driveFileId: sheetId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = sheetId
        ? await driveService.obtenerInfoArchivo(sheetId).catch(() => ({ id: sheetId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    CARPETA_PDF_FIRMADO_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    migrarPdfsFirmadosACarpetaCorrecta
};
