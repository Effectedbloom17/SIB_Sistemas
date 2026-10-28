/**
 * SGC-F-07 · Programa de auditoría — persistencia en biznaga_sgc y sync con Drive.
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF07-MMAA / _N + histograma).
 * Archivero de programas vive en BD/UI; Excel proyecta el programa activo en pestañas mensuales.
 * «Motivo de Auditoría» es campo del formulario; no nombra la hoja.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-07';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/112kGODk9XU0lvJ0LmYkgVTSOKdTL1-3e3l2jNuJQ2wE
 */
const TEMPLATE_DRIVE_ID = '112kGODk9XU0lvJ0LmYkgVTSOKdTL1-3e3l2jNuJQ2wE';
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/**
 * Archivo de trabajo Centro SGC (programas del archivero + histograma).
 * https://docs.google.com/spreadsheets/d/1wvrP_EB5XvdL5xu_j5xiiX53o8Bz9KzvLaVMCwwXT2w
 */
const DRIVE_FILE_ID_SISTEMA = '1wvrP_EB5XvdL5xu_j5xiiX53o8Bz9KzvLaVMCwwXT2w';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/**
 * PDFs firmados (escaneados) — Documentos Firmados de SGC-F-07.
 * https://drive.google.com/drive/folders/1yodruqEhzAHJbQY3cU-ZvQFTLKKsT4gp
 */
const CARPETA_PDF_FIRMADO_DRIVE_ID = '1yodruqEhzAHJbQY3cU-ZvQFTLKKsT4gp';
/** Carpeta anterior / padre donde quedaron PDFs firmados por error (legado). */
const CARPETA_PDF_FIRMADO_LEGADO_IDS = [
    '11BP-e95f54iD7r0Tp9YhupT2ROkGmxCk'
];
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-07 Programa de auditoría (sistema)';
const NOMBRE_PDF_ARCHIVO = 'SGC-F-07 Programa de auditoría.pdf';
/** Fallback local en el sistema (legado); el trabajo real usa SGCF07-MMAA(_N). */
const SHEET_TITLE = TEMPLATE_SHEET_TITLE;

/** Nombre base del mes actual (SGCF07-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

const MESES_KEYS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: 58,
    keepSingleSheet: false
};

const META_ROW = 5;
const HEADER_ROW = 11;
const DATA_START_ROW = 12;
/** Filas 18–19 = etiqueta «Comentarios» (C18:D19); la tabla de auditorías termina en 17. */
const DATA_END_ROW = 17;
const MAX_AUDITORIAS_TABLA = Math.floor((DATA_END_ROW - DATA_START_ROW + 1) / 2);

const FOOTER_CELDAS = {
    /** Merge C18:D19 — etiqueta fija. */
    comentariosTitulo: 'C18',
    /** Caja de detalle (merge C20:J22 en plantilla). */
    comentariosDetalle: 'C20',
    notaPrograma: 'C26',
    firmaEjecutivo: 'H30',
    firmaDireccion: 'N30'
};

const COLUMNAS = {
    noAudi: 1,
    tipoAuditoria: 2,
    alcance: 3,
    objetivo: 4,
    criterios: 5,
    equipoAuditor: 6,
    auditorLider: 7,
    metodoAuditoria: 8,
    estadoCalendario: 9,
    fecha: 10,
    calendarioInicio: 11,
    calendarioFin: 58
};

const COLOR_CALENDARIO_P = 'FFFF00';
const COLOR_CALENDARIO_R = '17CD1F';
const COLOR_CALENDARIO_P_RGB = { red: 1, green: 1, blue: 0 };
const COLOR_CALENDARIO_R_RGB = {
    red: 0x17 / 255,
    green: 0xCD / 255,
    blue: 0x1F / 255
};
const COLOR_CALENDARIO_VACIO_RGB = { red: 1, green: 1, blue: 1 };

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    motivoAuditoria: '',
    fechaElaboracion: '2025-01-14',
    auditorias: [
        {
            noAudi: '1',
            tipoAuditoria: 'Interna',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Identificar las oportunidades para la mejora del SGC.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: '',
            auditorLider: '',
            metodoAuditoria: 'En sitio y persona a persona',
            fecha: '',
            fechaP: '',
            fechaR: '',
            calendarioP: crearCalendarioVacio(),
            calendarioR: crearCalendarioVacio()
        },
        {
            noAudi: '2',
            tipoAuditoria: 'Externa',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Cumplir con los requisitos de certificación de la norma ISO 9001:2015.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: 'Auditor(es) externo(s)',
            auditorLider: 'Auditor externo',
            metodoAuditoria: 'En sitio y persona a persona',
            fecha: '',
            fechaP: '',
            fechaR: '',
            calendarioP: crearCalendarioVacio(),
            calendarioR: crearCalendarioVacio()
        },
        {
            noAudi: '3',
            tipoAuditoria: 'Interna',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Identificar las oportunidades para la mejora del SGC.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: '',
            auditorLider: '',
            metodoAuditoria: 'Remota',
            fecha: '',
            fechaP: '',
            fechaR: '',
            calendarioP: crearCalendarioVacio(),
            calendarioR: crearCalendarioVacio()
        }
    ],
    footer: {
        comentariosTitulo: 'Comentarios',
        comentariosDetalle: '',
        notaPrograma: '',
        firmaEjecutivo: 'Ejecutivo JR SGVC',
        firmaDireccion: 'Dirección General'
    },
    pdfFirmado: null,
    pdfsHistorial: []
};

async function obtenerMetaHojaParaHistorial(fileId, infoArchivo = null) {
    const id = String(fileId || '').trim();
    if (!id) {
        return null;
    }

    let info = infoArchivo;
    if (!info) {
        try {
            info = await driveService.obtenerInfoArchivo(id);
        } catch {
            info = null;
        }
    }

    const mime = String(info?.mimeType || '').trim();
    if (mime !== 'application/vnd.google-apps.spreadsheet') {
        return null;
    }

    try {
        return await driveService.obtenerDimensionesHojaGoogleSheet(id, SHEET_TITLE);
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo leer dimensiones de hoja para historial:', err.message);
        return null;
    }
}

function crearCalendarioVacio() {
    return MESES_KEYS.reduce((acc, mes) => {
        acc[mes] = ['', '', '', ''];
        return acc;
    }, {});
}

/** Normaliza marca de celda a la letra del tipo ('P' | 'R') o vacío. Acepta X legacy. */
function marcarCeldaCalendario(valor, letraTipo) {
    const letra = String(letraTipo || '').trim().toUpperCase();
    const texto = String(valor || '').trim().toUpperCase();
    if (!texto) return '';
    if (letra === 'P' || letra === 'R') {
        if (texto === letra || texto === 'X' || /^(✓|1|SI|SÍ)$/.test(texto)) {
            return letra;
        }
        return '';
    }
    if (texto === 'P' || texto === 'R') return texto;
    if (texto === 'X' || /^(✓|1|SI|SÍ)$/.test(texto)) return 'X';
    return '';
}

function celdaCalendarioMarcada(valor, letraTipo) {
    return marcarCeldaCalendario(valor, letraTipo) === String(letraTipo || '').toUpperCase();
}

function leerCalendarioDesdeFila(row, letraTipo) {
    const letra = String(letraTipo || 'P').toUpperCase() === 'R' ? 'R' : 'P';
    const calendario = crearCalendarioVacio();
    MESES_KEYS.forEach((mes, idxMes) => {
        for (let sem = 0; sem < 4; sem++) {
            const col = COLUMNAS.calendarioInicio + idxMes * 4 + sem;
            calendario[mes][sem] = marcarCeldaCalendario(row.getCell(col).value, letra);
        }
    });
    return calendario;
}

function combinarCalendarios(base, extra, letraTipo = 'P') {
    const letra = String(letraTipo || 'P').toUpperCase() === 'R' ? 'R' : 'P';
    const calendario = crearCalendarioVacio();
    MESES_KEYS.forEach((mes) => {
        for (let i = 0; i < 4; i++) {
            calendario[mes][i] = marcarCeldaCalendario(extra?.[mes]?.[i] || base?.[mes]?.[i], letra);
        }
    });
    return calendario;
}

function esCalendarioMesesPlano(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    if (obj.p || obj.r || obj.calendarioP || obj.calendarioR) return false;
    return MESES_KEYS.some((mes) => Array.isArray(obj[mes]));
}

function migrarCalendariosAuditoria(item) {
    let calendarioP = crearCalendarioVacio();
    let calendarioR = crearCalendarioVacio();

    if (item?.calendarioP || item?.calendarioR) {
        calendarioP = combinarCalendarios(crearCalendarioVacio(), item.calendarioP, 'P');
        calendarioR = combinarCalendarios(crearCalendarioVacio(), item.calendarioR, 'R');
    } else if (item?.calendario?.p || item?.calendario?.r) {
        calendarioP = combinarCalendarios(crearCalendarioVacio(), item.calendario.p, 'P');
        calendarioR = combinarCalendarios(crearCalendarioVacio(), item.calendario.r, 'R');
    } else if (esCalendarioMesesPlano(item?.calendario)) {
        calendarioP = combinarCalendarios(crearCalendarioVacio(), item.calendario, 'P');
    } else {
        if (item?.semana1) calendarioP.enero[0] = marcarCeldaCalendario(item.semana1, 'P');
        if (item?.semana2) calendarioP.enero[1] = marcarCeldaCalendario(item.semana2, 'P');
        if (item?.semana3) calendarioP.enero[2] = marcarCeldaCalendario(item.semana3, 'P');
        if (item?.semana4) calendarioP.enero[3] = marcarCeldaCalendario(item.semana4, 'P');
    }

    // Exclusividad: si ambas están marcadas en la misma semana, prioriza P
    MESES_KEYS.forEach((mes) => {
        for (let i = 0; i < 4; i++) {
            if (calendarioP[mes][i] && calendarioR[mes][i]) {
                calendarioR[mes][i] = '';
            }
        }
    });

    return { calendarioP, calendarioR };
}

function columnaCalendarioParaMesSemana(idxMes, idxSemana) {
    return COLUMNAS.calendarioInicio + idxMes * 4 + idxSemana;
}

function indiceFilaProgramada(indiceAuditoria) {
    return DATA_START_ROW + indiceAuditoria * 2;
}

/**
 * ExcelJS reutiliza el mismo objeto de estilo entre celdas de la plantilla.
 * Mutarlo pinta otras filas (incluidas las vacías) y desplaza el color de la letra.
 */
function aislarEstiloCelda(celda) {
    const src = celda.style && typeof celda.style === 'object' ? celda.style : {};
    const lado = (borde) => (borde ? { ...borde, color: borde.color ? { ...borde.color } : undefined } : undefined);
    celda.style = {
        numFmt: src.numFmt,
        font: src.font ? { ...src.font, color: src.font.color ? { ...src.font.color } : undefined } : undefined,
        alignment: src.alignment ? { ...src.alignment } : undefined,
        border: src.border ? {
            top: lado(src.border.top),
            left: lado(src.border.left),
            bottom: lado(src.border.bottom),
            right: lado(src.border.right)
        } : undefined,
        fill: src.fill ? {
            type: src.fill.type,
            pattern: src.fill.pattern,
            fgColor: src.fill.fgColor ? { ...src.fill.fgColor } : undefined,
            bgColor: src.fill.bgColor ? { ...src.fill.bgColor } : undefined
        } : undefined,
        protection: src.protection ? { ...src.protection } : undefined
    };
}

function aplicarRellenoCalendarioExcel(celda, marcado, colorArgb) {
    aislarEstiloCelda(celda);
    celda.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: marcado ? `FF${colorArgb}` : 'FFFFFFFF' }
    };
}

function escribirMarcasCalendarioEnFila(row, calendario, letraTipo, colorArgb) {
    const letra = String(letraTipo || 'P').toUpperCase() === 'R' ? 'R' : 'P';
    MESES_KEYS.forEach((mes, idxMes) => {
        for (let sem = 0; sem < 4; sem++) {
            const col = columnaCalendarioParaMesSemana(idxMes, sem);
            const celda = row.getCell(col);
            const marcado = celdaCalendarioMarcada(calendario?.[mes]?.[sem], letra) ? letra : '';
            asignarTextoSimple(celda, marcado, 'center');
            aplicarRellenoCalendarioExcel(celda, marcado, colorArgb);
        }
    });
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

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\|/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function asignarTextoSimple(celda, valor, horizontal = 'center') {
    aislarEstiloCelda(celda);
    celda.value = valor ?? '';
    celda.alignment = {
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
            return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaCelda(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${Number(d)}/${Number(m)}/${y}`;
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
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

function esNombrePdfFirmadoSgcF07(nombre) {
    const n = String(nombre || '');
    return /\.pdf$/i.test(n) && /^SGC-F-07 Programa de auditor[ií]a/i.test(n);
}

/**
 * Mueve PDFs firmados fuera de lugar (carpeta padre SGC-F-07 o legado)
 * hacia Documentos Firmados.
 */
async function moverPdfsFirmadosACarpetaCorrecta(idsExtra = []) {
    const destino = CARPETA_PDF_FIRMADO_DRIVE_ID;
    if (!destino) return { movidos: 0, omitidos: 0 };

    const carpetasOrigen = new Set(CARPETA_PDF_FIRMADO_LEGADO_IDS.filter(Boolean));
    try {
        const destInfo = await driveService.obtenerInfoArchivo(destino);
        const padreId = Array.isArray(destInfo?.parents) ? destInfo.parents[0] : null;
        if (padreId) carpetasOrigen.add(padreId);
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo resolver carpeta padre de Documentos Firmados:', err.message);
    }

    const candidatos = new Map();
    for (const carpetaId of carpetasOrigen) {
        if (!carpetaId || carpetaId === destino) continue;
        try {
            const archivos = await driveService.listarArchivosCarpeta(carpetaId);
            for (const f of archivos || []) {
                if (!f?.id || !esNombrePdfFirmadoSgcF07(f.name)) continue;
                candidatos.set(f.id, f);
            }
        } catch (err) {
            console.warn(`[SGC-F-07] No se pudo listar PDFs en ${carpetaId}:`, err.message);
        }
    }

    for (const id of idsExtra || []) {
        const fileId = String(id || '').trim();
        if (!fileId || candidatos.has(fileId)) continue;
        try {
            const info = await driveService.obtenerInfoArchivo(fileId);
            if (info?.id && esNombrePdfFirmadoSgcF07(info.name || info.nombreArchivo)) {
                candidatos.set(info.id, info);
            }
        } catch (_) { /* ignore */ }
    }

    let movidos = 0;
    let omitidos = 0;
    for (const [fileId, archivo] of candidatos) {
        try {
            const parents = Array.isArray(archivo.parents) ? archivo.parents : null;
            if (parents && parents.includes(destino)) {
                omitidos += 1;
                continue;
            }
            if (!parents) {
                const info = await driveService.obtenerInfoArchivo(fileId).catch(() => null);
                if (Array.isArray(info?.parents) && info.parents.includes(destino)) {
                    omitidos += 1;
                    continue;
                }
            }
            await driveService.moverArchivoDrive(fileId, destino);
            movidos += 1;
            console.warn(`[SGC-F-07] PDF firmado movido a Documentos Firmados: ${archivo.name || fileId}`);
        } catch (err) {
            omitidos += 1;
            console.warn(`[SGC-F-07] No se pudo mover PDF ${archivo.name || fileId}:`, err.message);
        }
    }
    return { movidos, omitidos };
}

async function listarPdfsHistorialDrive() {
    await moverPdfsFirmadosACarpetaCorrecta().catch((err) => {
        console.warn('[SGC-F-07] Migración de PDFs firmados:', err.message);
    });
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_PDF_FIRMADO_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfFirmadoSgcF07(f.name))
        .map((f) => sanitizarPdfFirmado({
            driveFileId: f.id,
            nombreArchivo: f.name,
            webViewLink: f.webViewLink || null,
            fechaSubida: f.modifiedTime || fechaHoyIso()
        }))
        .filter(Boolean)
        .sort((a, b) => String(b.fechaSubida || '').localeCompare(String(a.fechaSubida || '')));
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

function sanitizarAuditoria(item) {
    const { calendarioP, calendarioR } = migrarCalendariosAuditoria(item);
    const fechaLegacy = String(item?.fecha || '').trim();
    const fechaP = String(item?.fechaP || item?.fecha_p || fechaLegacy || '').trim();
    const fechaR = String(item?.fechaR || item?.fecha_r || '').trim();
    return {
        noAudi: String(item?.noAudi || '').trim(),
        tipoAuditoria: String(item?.tipoAuditoria || '').trim(),
        alcance: String(item?.alcance || '').trim(),
        objetivo: String(item?.objetivo || '').trim(),
        criterios: String(item?.criterios || '').trim(),
        equipoAuditor: String(item?.equipoAuditor || '').trim(),
        auditorLider: String(item?.auditorLider || '').trim(),
        metodoAuditoria: String(item?.metodoAuditoria || '').trim(),
        fecha: fechaP,
        fechaP,
        fechaR,
        calendarioP,
        calendarioR
    };
}

function sanitizarFooter(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        comentariosTitulo: String(base.comentariosTitulo ?? DATOS_DEFECTO.footer.comentariosTitulo).trim()
            || DATOS_DEFECTO.footer.comentariosTitulo
            || 'Comentarios',
        comentariosDetalle: String(base.comentariosDetalle ?? DATOS_DEFECTO.footer.comentariosDetalle).trim(),
        notaPrograma: String(base.notaPrograma ?? DATOS_DEFECTO.footer.notaPrograma).trim(),
        firmaEjecutivo: String(base.firmaEjecutivo ?? DATOS_DEFECTO.footer.firmaEjecutivo).trim() || DATOS_DEFECTO.footer.firmaEjecutivo,
        firmaDireccion: String(base.firmaDireccion ?? DATOS_DEFECTO.footer.firmaDireccion).trim() || DATOS_DEFECTO.footer.firmaDireccion
    };
}

function sanitizarNombreHoja(texto) {
    return String(texto || '').trim()
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function esTituloPlantillaF07(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (t === SHEET_TITLE || /^plantilla\.?$/i.test(t)) return true;
    if (/^programa\s+de\s+auditor[ií]a\s+interna$/i.test(t)) return true;
    return false;
}

function esHojaReservadaSgcF07(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (esTituloPlantillaF07(t)) return true;
    if (/histograma/i.test(t)) return true;
    if (/^Alias_/i.test(t) || /^Partes_/i.test(t)) return true;
    if (/^_tmp_/i.test(t) || /^BORRADOR-/i.test(t)) return true;
    if (/^SGC-F-07\s+Programa/i.test(t)) return true;
    if (excelHistorial.esHojaHistorial(t, CODIGO_FORMATO)) return true;
    return false;
}

function esNombreHojaHistorialF07(titulo) {
    return excelHistorial.esHojaHistorialInformacion(String(titulo || '').trim(), CODIGO_FORMATO);
}

function esHojaDelMesActual(titulo, mesActual = nombreHojaMesActual()) {
    const t = String(titulo || '').trim();
    const base = String(mesActual || '').trim();
    if (!t || !base) return false;
    if (t === base) return true;
    return new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

function tituloHojaCoincide(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buscarTituloHoja(titulos, nombre) {
    return (titulos || []).find((titulo) => tituloHojaCoincide(titulo, nombre)) || '';
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const auditorias = Array.isArray(base.auditorias) ? base.auditorias : DATOS_DEFECTO.auditorias;
    
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        motivoAuditoria: String(base.motivoAuditoria || base.motivo_auditoria || '').trim(),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        auditorias: auditorias.map(sanitizarAuditoria).filter(a => 
            a.noAudi || a.tipoAuditoria || a.alcance || a.objetivo
        ),
        footer: sanitizarFooter(base.footer),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial)
    };
}

function nuevoIdPrograma() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `sgcf07-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function esPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

function programaDesdePlano(plano, meta = {}) {
    const datos = sanitizarDatos(plano);
    const anioFecha = String(datos.fechaElaboracion || '').slice(0, 4);
    const nombreHojaFijo = sanitizarNombreHoja(meta.nombreHoja || plano?.nombreHoja || '');
    return {
        id: String(meta.id || plano?.id || '').trim() || nuevoIdPrograma(),
        anio: String(meta.anio || plano?.anio || anioFecha || '').trim(),
        titulo: String(meta.titulo || plano?.titulo || '').trim(),
        fechaCreacion: formatearFechaIso(meta.fechaCreacion || plano?.fechaCreacion) || fechaHoyIso(),
        ...datos,
        nombreHoja: nombreHojaFijo || null
    };
}

function normalizarArchivo(crudo, planoActivo, crudoDb = null) {
    const traeLista = Array.isArray(crudo?.programas);
    const fuente = traeLista
        ? crudo.programas
        : (Array.isArray(crudoDb?.programas) ? crudoDb.programas : []);
    const previos = Array.isArray(crudoDb?.programas) ? crudoDb.programas : [];
    const metaDe = (item) => {
        const previo = previos.find((p) => String(p?.id || '') === String(item?.id || '')) || null;
        return {
            ...(previo || {}),
            ...(item || {}),
            nombreHoja: item?.nombreHoja || previo?.nombreHoja || null
        };
    };
    let programas = fuente.map((item) => programaDesdePlano(item, metaDe(item)));
    if (!programas.length) {
        const unico = programaDesdePlano(planoActivo);
        return { programas: [unico], programaActivoId: unico.id };
    }
    let activoId = String(crudo?.programaActivoId || crudoDb?.programaActivoId || '').trim();
    if (!programas.some((item) => item.id === activoId)) {
        activoId = programas[0].id;
    }
    const plano = sanitizarDatos(planoActivo);
    programas = programas.map((item) => (
        item.id === activoId
            ? programaDesdePlano({
                ...item,
                ...plano,
                id: item.id,
                anio: item.anio || String(plano.fechaElaboracion || '').slice(0, 4),
                titulo: item.titulo,
                fechaCreacion: item.fechaCreacion,
                nombreHoja: item.nombreHoja
            }, item)
            : item
    ));
    return { programas, programaActivoId: activoId };
}

function unirArchivo(plano, archivo) {
    const normal = normalizarArchivo(
        { programas: archivo?.programas, programaActivoId: archivo?.programaActivoId },
        plano,
        null
    );
    return {
        ...sanitizarDatos(plano),
        programas: normal.programas,
        programaActivoId: normal.programaActivoId
    };
}

function esFilaAuditoriaValida(noAudi, tipoAuditoria) {
    const no = String(noAudi || '').trim();
    const tipo = String(tipoAuditoria || '').trim();
    if (!no || /^[RP]$/i.test(no)) {
        return false;
    }
    if (!/^\d+$/.test(no)) {
        return false;
    }
    return !!tipo;
}

function parsearFechaRevisionDesdeHoja(ws) {
    for (let r = 1; r <= 8; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 6; c++) {
            const texto = celdaATexto(row.getCell(c).value);
            const match = texto.match(/fecha\s*(?:de\s*)?revisi[oó]n\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
            if (match) {
                return formatearFechaIso(match[1].replace(/-/g, '/'));
            }
        }
    }
    return '';
}

function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) {
        return null;
    }
    if (modo === 'edicion') {
        return excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || wb.getWorksheet(SHEET_TITLE)
            || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

function parsearDatosDesdeHoja(ws) {
    const fechaElaboracion = parsearFechaRevisionDesdeHoja(ws) || DATOS_DEFECTO.fechaElaboracion;

    const auditorias = [];
    const numerosVistos = new Set();
    let rowNum = DATA_START_ROW;

    while (rowNum <= DATA_END_ROW) {
        const row = ws.getRow(rowNum);
        const noAudi = celdaATexto(row.getCell(COLUMNAS.noAudi).value).trim();
        const tipoAuditoria = celdaATexto(row.getCell(COLUMNAS.tipoAuditoria).value).trim();

        if (esFilaAuditoriaValida(noAudi, tipoAuditoria) && !numerosVistos.has(noAudi)) {
            numerosVistos.add(noAudi);
            const filaRealizada = ws.getRow(rowNum + 1);
            const estadoRealizada = celdaATexto(filaRealizada.getCell(COLUMNAS.estadoCalendario).value).trim();
            const calendarioP = leerCalendarioDesdeFila(row, 'P');
            const calendarioR = /^R$/i.test(estadoRealizada)
                ? leerCalendarioDesdeFila(filaRealizada, 'R')
                : crearCalendarioVacio();
            const fechaP = celdaATexto(row.getCell(COLUMNAS.fecha).value);
            const fechaR = /^R$/i.test(estadoRealizada)
                ? celdaATexto(filaRealizada.getCell(COLUMNAS.fecha).value)
                : '';
            auditorias.push({
                noAudi,
                tipoAuditoria,
                alcance: celdaATexto(row.getCell(COLUMNAS.alcance).value),
                objetivo: celdaATexto(row.getCell(COLUMNAS.objetivo).value),
                criterios: celdaATexto(row.getCell(COLUMNAS.criterios).value),
                equipoAuditor: celdaATexto(row.getCell(COLUMNAS.equipoAuditor).value),
                auditorLider: celdaATexto(row.getCell(COLUMNAS.auditorLider).value),
                metodoAuditoria: celdaATexto(row.getCell(COLUMNAS.metodoAuditoria).value),
                fecha: fechaP,
                fechaP,
                fechaR,
                calendarioP,
                calendarioR
            });
        }
        rowNum++;
    }

    return sanitizarDatos({
        empresa: DATOS_DEFECTO.empresa,
        fechaElaboracion,
        auditorias: auditorias.length ? auditorias : DATOS_DEFECTO.auditorias,
        footer: {
            comentariosTitulo: celdaATexto(ws.getCell(FOOTER_CELDAS.comentariosTitulo).value) || DATOS_DEFECTO.footer.comentariosTitulo,
            comentariosDetalle: celdaATexto(ws.getCell(FOOTER_CELDAS.comentariosDetalle).value),
            notaPrograma: celdaATexto(ws.getCell(FOOTER_CELDAS.notaPrograma).value),
            firmaEjecutivo: celdaATexto(ws.getCell(FOOTER_CELDAS.firmaEjecutivo).value) || DATOS_DEFECTO.footer.firmaEjecutivo,
            firmaDireccion: celdaATexto(ws.getCell(FOOTER_CELDAS.firmaDireccion).value) || DATOS_DEFECTO.footer.firmaDireccion
        }
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = obtenerHojaDatos(wb, modo);
    if (!ws) throw new Error('La plantilla SGC-F-07 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    return leerDatosDesdeBuffer(buffer);
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

function escribirAuditoriaEnFilasPar(ws, filaProgramada, filaRealizada, auditoria) {
    const aud = sanitizarAuditoria(auditoria);
    [filaProgramada, filaRealizada].forEach((fila, idx) => {
        const row = ws.getRow(fila);
        asignarTextoSimple(row.getCell(COLUMNAS.noAudi), aud.noAudi, 'center');
        asignarTextoSimple(row.getCell(COLUMNAS.tipoAuditoria), aud.tipoAuditoria, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.alcance), aud.alcance, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.objetivo), aud.objetivo, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.criterios), aud.criterios, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.equipoAuditor), aud.equipoAuditor, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.auditorLider), aud.auditorLider, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.metodoAuditoria), aud.metodoAuditoria, 'left');
        const celdaEstado = row.getCell(COLUMNAS.estadoCalendario);
        asignarTextoSimple(celdaEstado, idx === 0 ? 'P' : 'R', 'center');
        aplicarRellenoCalendarioExcel(
            celdaEstado,
            'X',
            idx === 0 ? COLOR_CALENDARIO_P : COLOR_CALENDARIO_R
        );
    });

    const rowP = ws.getRow(filaProgramada);
    const rowR = ws.getRow(filaRealizada);
    asignarTextoSimple(rowP.getCell(COLUMNAS.fecha), aud.fechaP || aud.fecha, 'center');
    asignarTextoSimple(rowR.getCell(COLUMNAS.fecha), aud.fechaR, 'center');
    escribirMarcasCalendarioEnFila(rowP, aud.calendarioP, 'P', COLOR_CALENDARIO_P);
    escribirMarcasCalendarioEnFila(rowR, aud.calendarioR, 'R', COLOR_CALENDARIO_R);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-07 no contiene hojas.');

    const datosSanitizados = sanitizarDatos(datos);

    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        for (let c = COLUMNAS.noAudi; c <= COLUMNAS.calendarioFin; c++) {
            const celda = row.getCell(c);
            asignarTextoSimple(celda, '', c >= COLUMNAS.calendarioInicio || c === COLUMNAS.estadoCalendario ? 'center' : 'left');
            if (c >= COLUMNAS.estadoCalendario && c <= COLUMNAS.calendarioFin) {
                aplicarRellenoCalendarioExcel(celda, '', COLOR_CALENDARIO_P);
            }
        }
    }

    datosSanitizados.auditorias.slice(0, MAX_AUDITORIAS_TABLA).forEach((auditoria, index) => {
        const filaP = indiceFilaProgramada(index);
        escribirAuditoriaEnFilasPar(ws, filaP, filaP + 1, auditoria);
    });

    const footer = sanitizarFooter(datosSanitizados.footer);
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.comentariosTitulo), footer.comentariosTitulo || 'Comentarios', 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.comentariosDetalle), footer.comentariosDetalle, 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.notaPrograma), footer.notaPrograma, 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.firmaEjecutivo), footer.firmaEjecutivo, 'center');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.firmaDireccion), footer.firmaDireccion, 'center');
    aplicarConfiguracionImpresionHoja(ws);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/** Carta, horizontal, ajustar a 1 página, márgenes estrechos. */
function aplicarConfiguracionImpresionHoja(ws) {
    ws.pageSetup = {
        ...(ws.pageSetup || {}),
        paperSize: 1,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: false,
        verticalCentered: false,
        margins: {
            left: 0.25,
            right: 0.25,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3
        }
    };
    if (ws.pageSetup.scale) {
        delete ws.pageSetup.scale;
    }
}

const OPCIONES_PDF_IMPRESION = {
    landscape: true,
    fitToPage: true,
    size: 'letter',
    margins: 'estrechos',
    horizontalAlignment: 'RIGHT',
    verticalAlignment: 'TOP'
};

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        const cargado = await cargarFormato(pool);
        driveFileId = cargado?.driveFileId || null;
    }
    if (!driveFileId || esPlantillaMaestra(driveFileId)) {
        throw new Error('No hay archivo SGC-F-07 en Drive para exportar a PDF.');
    }

    const tituloHoja = await resolverTituloHojaVigente(driveFileId);

    const opciones = { ...OPCIONES_PDF_IMPRESION };
    const info = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
            if (gid != null) opciones.gid = gid;
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo resolver gid de hoja para PDF:', err.message);
        }
    }

    const pdfBuffer = await driveService.exportarArchivoPDF(driveFileId, opciones);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-07 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle = SHEET_TITLE) {
    const datosSanitizados = sanitizarDatos(datos);
    const actualizaciones = [];
    // Solo datos de auditoría (A-H). Estado/Fecha/Calendario (I-BF) van en sync atómico con color.
    const COL_DATOS_FIN = COLUMNAS.metodoAuditoria;

    for (let rowNum = DATA_START_ROW; rowNum <= DATA_END_ROW; rowNum++) {
        for (let colNum = COLUMNAS.noAudi; colNum <= COL_DATOS_FIN; colNum++) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(colNum)}${rowNum}`, sheetTitle),
                values: [['']]
            });
        }
    }

    let rowNum = DATA_START_ROW;
    datosSanitizados.auditorias.slice(0, MAX_AUDITORIAS_TABLA).forEach((auditoriaRaw) => {
        const auditoria = sanitizarAuditoria(auditoriaRaw);
        const filaR = rowNum + 1;

        const empujarFilaBase = (fila) => {
            actualizaciones.push({
                range: rangoSheet(`A${fila}`, sheetTitle),
                values: [[auditoria.noAudi || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`B${fila}`, sheetTitle),
                values: [[auditoria.tipoAuditoria || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`C${fila}`, sheetTitle),
                values: [[auditoria.alcance || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`D${fila}`, sheetTitle),
                values: [[auditoria.objetivo || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`E${fila}`, sheetTitle),
                values: [[auditoria.criterios || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`F${fila}`, sheetTitle),
                values: [[auditoria.equipoAuditor || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`G${fila}`, sheetTitle),
                values: [[auditoria.auditorLider || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`H${fila}`, sheetTitle),
                values: [[auditoria.metodoAuditoria || '']]
            });
        };

        empujarFilaBase(rowNum);
        empujarFilaBase(filaR);
        rowNum += 2;
    });

    const footer = sanitizarFooter(datosSanitizados.footer);
    // Etiqueta fija en merge C18:D19 (plantilla vigente).
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.comentariosTitulo, sheetTitle),
        values: [[footer.comentariosTitulo || 'Comentarios']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.comentariosDetalle, sheetTitle),
        values: [[footer.comentariosDetalle || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.notaPrograma, sheetTitle),
        values: [[footer.notaPrograma || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.firmaEjecutivo, sheetTitle),
        values: [[footer.firmaEjecutivo || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.firmaDireccion, sheetTitle),
        values: [[footer.firmaDireccion || '']]
    });

    return actualizaciones;
}

function celdaSheetConValorYColor(texto, colorRgb) {
    const valor = String(texto || '');
    const tieneColor = !!colorRgb;
    return {
        userEnteredValue: valor ? { stringValue: valor } : { stringValue: '' },
        userEnteredFormat: {
            backgroundColor: tieneColor ? colorRgb : COLOR_CALENDARIO_VACIO_RGB,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE'
        }
    };
}

function construirFilasCalendarioAtomicas(datos) {
    const datosSanitizados = sanitizarDatos(datos);
    const auditorias = Array.isArray(datosSanitizados.auditorias) ? datosSanitizados.auditorias : [];
    const filas = [];

    for (let index = 0; index < MAX_AUDITORIAS_TABLA; index++) {
        const auditoria = auditorias[index] || null;
        const hayAuditoria = !!auditoria;

        const construirFila = (tipo) => {
            const esP = tipo === 'P';
            const cells = [];

            // Col I: estado P/R
            cells.push(celdaSheetConValorYColor(
                hayAuditoria ? tipo : '',
                hayAuditoria ? (esP ? COLOR_CALENDARIO_P_RGB : COLOR_CALENDARIO_R_RGB) : null
            ));

            // Col J: fecha
            const fecha = !hayAuditoria
                ? ''
                : (esP ? (auditoria.fechaP || auditoria.fecha || '') : (auditoria.fechaR || ''));
            cells.push(celdaSheetConValorYColor(fecha, null));

            // Cols K-BF: calendario 12 meses x 4 semanas
            const calendario = hayAuditoria
                ? (esP ? auditoria.calendarioP : auditoria.calendarioR)
                : null;
            MESES_KEYS.forEach((mes) => {
                for (let sem = 0; sem < 4; sem++) {
                    const marcado = hayAuditoria && celdaCalendarioMarcada(calendario?.[mes]?.[sem], tipo)
                        ? tipo
                        : '';
                    cells.push(celdaSheetConValorYColor(
                        marcado,
                        marcado ? (esP ? COLOR_CALENDARIO_P_RGB : COLOR_CALENDARIO_R_RGB) : null
                    ));
                }
            });

            return { values: cells };
        };

        filas.push(construirFila('P'));
        filas.push(construirFila('R'));
    }

    return filas;
}

async function resolverSheetIdPorTitulo(sheetsApi, spreadsheetId, sheetTitle) {
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),conditionalFormats,bandedRanges)'
    });
    const normalizarTitulo = (t) => String(t || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const tituloBuscado = normalizarTitulo(sheetTitle);
    const hojas = meta.data.sheets || [];
    const sheet = hojas.find((s) => {
        const t = (s.properties?.title || '').trim();
        return t === sheetTitle || normalizarTitulo(t) === tituloBuscado;
    });
    if (!sheet?.properties || sheet.properties.sheetId === undefined || sheet.properties.sheetId === null) {
        return { sheetId: null, sheet: null, hojas };
    }
    return { sheetId: sheet.properties.sheetId, sheet, hojas };
}

async function limpiarFormatosAutomaticosCalendario(sheetsApi, spreadsheetId, sheetTitle, sheetId) {
    const colStart = COLUMNAS.estadoCalendario - 1;
    const colEnd = COLUMNAS.calendarioFin;
    const rowStart = DATA_START_ROW - 1;
    const rowEnd = DATA_END_ROW;
    const rangosSeSolapan = (range) => {
        if (range?.sheetId != null && range.sheetId !== sheetId) return false;
        const c0 = Number(range.startColumnIndex ?? 0);
        const c1 = Number(range.endColumnIndex ?? 0);
        const r0 = Number(range.startRowIndex ?? 0);
        const r1 = Number(range.endRowIndex ?? 0);
        return c0 < colEnd && c1 > colStart && r0 < rowEnd && r1 > rowStart;
    };

    for (let intento = 0; intento < 40; intento += 1) {
        const meta = await sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title),conditionalFormats)'
        });
        const hoja = (meta.data.sheets || []).find((s) => s.properties?.sheetId === sheetId)
            || (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === sheetTitle);
        const reglas = Array.isArray(hoja?.conditionalFormats) ? hoja.conditionalFormats : [];
        let indiceBorrar = -1;
        for (let index = reglas.length - 1; index >= 0; index -= 1) {
            const afecta = Array.isArray(reglas[index]?.ranges)
                && reglas[index].ranges.some(rangosSeSolapan);
            if (afecta) {
                indiceBorrar = index;
                break;
            }
        }
        if (indiceBorrar < 0) break;
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteConditionalFormatRule: { sheetId, index: indiceBorrar }
                }]
            }
        });
    }

    const metaBand = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),bandedRanges)'
    });
    const hojaBand = (metaBand.data.sheets || []).find((s) => s.properties?.sheetId === sheetId);
    const bandas = Array.isArray(hojaBand?.bandedRanges) ? hojaBand.bandedRanges : [];
    const requestsBand = [];
    for (const banda of bandas) {
        const rango = banda?.range;
        if (rangosSeSolapan(rango) && banda.bandedRangeId != null) {
            requestsBand.push({ deleteBanding: { bandedRangeId: banda.bandedRangeId } });
        }
    }
    if (requestsBand.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requestsBand }
        });
    }
}

async function sincronizarCalendarioAtomicoGoogleSheet(spreadsheetId, datos, sheetTitle = SHEET_TITLE) {
    if (!spreadsheetId) return;
    try {
        const { google } = require('googleapis');
        const auth = driveService.getAuthClient();
        if (!auth) {
            console.warn('[SGC-F-07] Sin cliente Google Auth; no se sincroniza calendario.');
            return;
        }
        const sheetsApi = google.sheets({ version: 'v4', auth });
        const { sheetId, hojas } = await resolverSheetIdPorTitulo(sheetsApi, spreadsheetId, sheetTitle);
        if (sheetId === undefined || sheetId === null) {
            console.warn(
                `[SGC-F-07] No se encontró hoja «${sheetTitle}» para calendario. Hojas:`,
                (hojas || []).map((s) => s.properties?.title).join(', ')
            );
            return;
        }

        await limpiarFormatosAutomaticosCalendario(sheetsApi, spreadsheetId, sheetTitle, sheetId);

        const filas = construirFilasCalendarioAtomicas(datos);
        // I=9 → index 8; BF=58 → end exclusive 58
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    updateCells: {
                        range: {
                            sheetId,
                            startRowIndex: DATA_START_ROW - 1,
                            endRowIndex: DATA_END_ROW,
                            startColumnIndex: COLUMNAS.estadoCalendario - 1,
                            endColumnIndex: COLUMNAS.calendarioFin
                        },
                        rows: filas,
                        fields: 'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment'
                    }
                }]
            }
        });
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo sincronizar calendario/colores:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = SHEET_TITLE) {
    const actualizaciones = datosAActualizacionesSheet(datos, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await sincronizarCalendarioAtomicoGoogleSheet(spreadsheetId, datos, sheetTitle);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const { pdfFirmado: _pdf, pdfsHistorial: _hist, ...rest } = sanitizarDatos(datos);
        return rest;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function contenidoProgramaEquivalente(a, b) {
    const firma = (programa) => {
        const { pdfFirmado: _pdf, pdfsHistorial: _hist, nombreHoja: _nh, ...rest } = programaDesdePlano(programa);
        return rest;
    };
    return JSON.stringify(firma(a)) === JSON.stringify(firma(b));
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

function preservarPdfFirmado(datosEntrada, datosPrevios) {
    return preservarPdfMeta(datosEntrada, datosPrevios).pdfFirmado;
}

function estructuraEsEquivalente(a, b) {
    const fa = Array.isArray(a?.auditorias) ? a.auditorias.length : 0;
    const fb = Array.isArray(b?.auditorias) ? b.auditorias.length : 0;
    return fa === fb;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = 'sgc-f-07 programa de auditoría';
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

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 * Nunca escribe ni borra en TEMPLATE_DRIVE_ID.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[SGC-F-07] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    return copiada.title || destino;
}

function resolverTituloMesMasReciente(titulos, mesActual = nombreHojaMesActual()) {
    const base = String(mesActual || '').trim();
    const delMes = (titulos || [])
        .map((t) => String(t || '').trim())
        .filter((t) => esHojaDelMesActual(t, base));
    if (!delMes.length) return '';
    delMes.sort((a, b) => {
        const num = (t) => {
            const m = t.match(/_(\d+)$/);
            return m ? Number(m[1]) : 1;
        };
        return num(b) - num(a) || b.localeCompare(a, 'es');
    });
    return delMes[0];
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        if (vigente && !esTituloPlantillaF07(vigente)) {
            return vigente;
        }
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo resolver hoja vigente:', err.message);
    }
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    } catch {
        return mesActual;
    }
}

/**
 * Sustituye SOLO la hoja del mes de trabajo por una copia limpia de la plantilla
 * externa. Nunca reescribe pestañas de historial de meses previos.
 */
async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-07 solo regenera hojas en el archivo sistema.');
    }
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-07] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-07] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);
    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);
    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-07] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }
    return titulo;
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede sincronizar sobre el archivo plantilla SGC-F-07.');
    }
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo) || esTituloPlantillaF07(titulo) || /^BORRADOR-/i.test(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return titulo;
    } catch (err) {
        console.warn('[SGC-F-07] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

/** Elimina pestañas residuales BORRADOR-* / Plantilla / Alias_r* del sistema. */
async function limpiarHojasResidualesSgcF07(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch {
        return;
    }
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        if (!nombre) return false;
        if (/^BORRADOR-/i.test(nombre)) return true;
        if (esTituloPlantillaF07(nombre)) return true;
        if (/^Alias_/i.test(nombre) || /^Partes_/i.test(nombre)) return true;
        return false;
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-07] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-07] No se pudieron eliminar pestañas residuales:', err.message);
    }
}

/**
 * SGC-F-07 solo usa pestañas SGCF07-MMAA / SGCF07-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes (_2, _3…).
 */
async function aplicarHistorialSgcF07(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
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

async function aplicarUrlsHojaEnRespuesta(respuesta, spreadsheetId, tituloHoja) {
    if (!respuesta || !spreadsheetId || !tituloHoja) return respuesta;
    try {
        const gid = await driveService.obtenerGidHojaPorNombre(spreadsheetId, tituloHoja);
        if (gid == null) return respuesta;
        respuesta.editorUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid });
        respuesta.previewUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid, modo: 'preview' });
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo resolver la hoja del editor:', err.message);
    }
    return respuesta;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
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
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function construirRespuesta(registro, datos, archivoDrive, tituloHojaActiva = null) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const datosConArchivo = unirArchivo(datos, {
        programas: datos?.programas,
        programaActivoId: datos?.programaActivoId
    });
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;
    const pdfsHistorial = sanitizarPdfsHistorial(datos.pdfsHistorial);
    const programas = (datosConArchivo.programas || []).map((item) => (
        item.id === datosConArchivo.programaActivoId
            ? { ...item, fechaElaboracion: fechaMostrar, pdfFirmado, pdfsHistorial }
            : item
    ));
    const activo = programas.find((item) => item.id === datosConArchivo.programaActivoId) || programas[0];
    const driveCandidato = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA || null;
    const driveId = driveCandidato && !esPlantillaMaestra(driveCandidato)
        ? driveCandidato
        : (DRIVE_FILE_ID_SISTEMA || null);
    const hoja = String(tituloHojaActiva || '').trim() || nombreHojaMesActual();

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datosConArchivo,
            fechaElaboracion: fechaMostrar,
            motivoAuditoria: activo?.motivoAuditoria || datosConArchivo.motivoAuditoria || '',
            pdfFirmado,
            pdfsHistorial,
            programas,
            programaActivoId: datosConArchivo.programaActivoId
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        hojaActiva: hoja || null,
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
    const crudoDb = await leerDatosRegistro(registro);
    const base = crudoDb || sanitizarDatos(DATOS_DEFECTO);
    const archivo = normalizarArchivo(crudoDb || {}, base, crudoDb);

    // Migrar PDFs firmados que quedaron fuera de Documentos Firmados.
    try {
        const idsPdf = [];
        for (const p of archivo.programas || []) {
            if (p?.pdfFirmado?.driveFileId) idsPdf.push(p.pdfFirmado.driveFileId);
            for (const h of p?.pdfsHistorial || []) {
                if (h?.driveFileId) idsPdf.push(h.driveFileId);
            }
        }
        if (base?.pdfFirmado?.driveFileId) idsPdf.push(base.pdfFirmado.driveFileId);
        for (const h of base?.pdfsHistorial || []) {
            if (h?.driveFileId) idsPdf.push(h.driveFileId);
        }
        await moverPdfsFirmadosACarpetaCorrecta(idsPdf);
    } catch (err) {
        console.warn('[SGC-F-07] Migración PDFs firmados al cargar:', err.message);
    }

    let hojaActiva = '';
    const driveId = await resolverDriveFileId(registro);
    const drivePersistir = driveId && !esPlantillaMaestra(driveId) ? driveId : DRIVE_FILE_ID_SISTEMA;

    const activo = (archivo.programas || []).find((item) => item.id === archivo.programaActivoId)
        || archivo.programas[0];
    const plano = sanitizarDatos(activo || base);
    const datos = unirArchivo({
        ...plano,
        pdfFirmado: activo?.pdfFirmado || plano.pdfFirmado,
        pdfsHistorial: activo?.pdfsHistorial || plano.pdfsHistorial
    }, archivo);

    if (drivePersistir && drivePersistir !== TEMPLATE_DRIVE_ID) {
        try {
            await limpiarHojasResidualesSgcF07(drivePersistir);
            const titulos = await driveService.listarHojasGoogleSheet(drivePersistir).catch(() => []);
            const mesActual = nombreHojaMesActual();
            hojaActiva = resolverTituloMesMasReciente(titulos, mesActual) || '';
            if (!hojaActiva) {
                hojaActiva = await reescribirHojaDesdePlantilla(drivePersistir, mesActual, plano);
            }
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo preparar la hoja del mes:', err.message);
            hojaActiva = nombreHojaMesActual();
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || plano.fechaElaboracion;
    if (drivePersistir && registro?.drive_file_id !== drivePersistir) {
        await guardarRegistroDb(pool, {
            driveFileId: drivePersistir,
            datos,
            fechaElaboracionOriginal: fechaOriginal,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const archivoDrive = drivePersistir
        ? await driveService.obtenerInfoArchivo(drivePersistir).catch(() => ({ id: drivePersistir }))
        : null;
    const respuesta = construirRespuesta(
        { ...(registro || {}), drive_file_id: drivePersistir || null },
        datos,
        archivoDrive,
        hojaActiva
    );
    return aplicarUrlsHojaEnRespuesta(respuesta, drivePersistir, respuesta.hojaActiva);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const crudoEntrada = body?.datos || body;
    const datosEntrada = sanitizarDatos(crudoEntrada);
    const incluyeFooterEnPayload = !!(body?.datos?.footer || body?.footer);
    const origen = String(body?.origen || 'sistema').toLowerCase();
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        try {
            const plantilla = await leerDatosDesdePlantilla();
            fechaOriginal = plantilla.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
        } catch {
            fechaOriginal = DATOS_DEFECTO.fechaElaboracion;
        }
    }

    let datosPrevios = null;
    let crudoPrevio = null;
    if (registroPrevio?.datos_json) {
        try {
            crudoPrevio = typeof registroPrevio.datos_json === 'string'
                ? JSON.parse(registroPrevio.datos_json)
                : registroPrevio.datos_json;
            datosPrevios = sanitizarDatos(crudoPrevio);
        } catch {
            datosPrevios = null;
            crudoPrevio = null;
        }
    }
    if (!incluyeFooterEnPayload && datosPrevios?.footer) {
        datosEntrada.footer = sanitizarFooter(datosPrevios.footer);
    }

    datosEntrada.pdfFirmado = preservarPdfMeta(datosEntrada, datosPrevios).pdfFirmado;
    datosEntrada.pdfsHistorial = preservarPdfMeta(datosEntrada, datosPrevios).pdfsHistorial;

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    datosEntrada.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const archivoGuardado = normalizarArchivo(crudoEntrada, datosEntrada, crudoPrevio);
    const archivoPrevioNorm = normalizarArchivo(crudoPrevio || {}, datosPrevios || datosEntrada, crudoPrevio);
    const cambioArchivero = (() => {
        const firma = (lista) => (lista || [])
            .map((p) => `${p.id}:${p.motivoAuditoria || ''}:${(p.auditorias || []).length}`)
            .join('|');
        return firma(archivoPrevioNorm.programas) !== firma(archivoGuardado.programas)
            || archivoPrevioNorm.programaActivoId !== archivoGuardado.programaActivoId;
    })();
    const debeVersionar = huboCambio || cambioArchivero;

    let hojaActiva = '';
    const driveId = await resolverDriveFileId(registroPrevio);
    let archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    const datosPublicar = unirArchivo(datosEntrada, archivoGuardado);
    const drivePersistir = driveId && !esPlantillaMaestra(driveId) ? driveId : DRIVE_FILE_ID_SISTEMA;

    if (drivePersistir && drivePersistir !== TEMPLATE_DRIVE_ID && (debeVersionar || !registroPrevio?.drive_file_id)) {
        try {
            await limpiarHojasResidualesSgcF07(drivePersistir);
            let hist = {
                aplicado: false,
                datosGuardar: datosEntrada,
                hojaVigente: null
            };
            if (debeVersionar && datosPrevios && origen !== 'consulta') {
                hist = await aplicarHistorialSgcF07({
                    spreadsheetId: drivePersistir,
                    datosPrevios,
                    datosNuevos: datosEntrada,
                    origen,
                    forzarTipo: 'informacion'
                });
                if (hist.aplicado) {
                    console.log(`[SGC-F-07] Historial creado: "${hist.nombreHistorial || hist.hojaVigente}"`);
                }
            }

            let tituloSync = String(hist.hojaVigente || '').trim();
            if (!tituloSync || esTituloPlantillaF07(tituloSync) || /^BORRADOR-/i.test(tituloSync)
                || !esNombreHojaHistorialF07(tituloSync)) {
                tituloSync = await resolverTituloHojaVigente(drivePersistir);
            }
            hojaActiva = await sincronizarHojaEdicionDrive(drivePersistir, datosEntrada, tituloSync);
            archivoDrive = await driveService.obtenerInfoArchivo(drivePersistir).catch(() => ({ id: drivePersistir }));
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo sincronizar hoja del mes:', err.message);
        }
    }

    const driveCambio = !!(drivePersistir && registroPrevio?.drive_file_id !== drivePersistir);
    if (!debeVersionar && !driveCambio && registroPrevio) {
        if (!hojaActiva && drivePersistir) {
            hojaActiva = await resolverTituloHojaVigente(drivePersistir).catch(() => nombreHojaMesActual());
        }
        const resp = construirRespuesta(registroPrevio, datosPublicar, archivoDrive, hojaActiva);
        return aplicarUrlsHojaEnRespuesta(resp, drivePersistir, resp.hojaActiva);
    }

    await guardarRegistroDb(pool, {
        driveFileId: drivePersistir || null,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    if (!hojaActiva && drivePersistir) {
        hojaActiva = await resolverTituloHojaVigente(drivePersistir).catch(() => nombreHojaMesActual());
    }
    const respuesta = construirRespuesta(registro, datosPublicar, archivoDrive, hojaActiva);
    return aplicarUrlsHojaEnRespuesta(respuesta, drivePersistir, respuesta.hojaActiva);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveId = await resolverDriveFileId(registro);
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }

    let datosPrevios = null;
    let crudoPrevio = null;
    if (registro?.datos_json) {
        try {
            crudoPrevio = typeof registro.datos_json === 'string'
                ? JSON.parse(registro.datos_json)
                : registro.datos_json;
            datosPrevios = sanitizarDatos(crudoPrevio);
        } catch {
            datosPrevios = null;
            crudoPrevio = null;
        }
    }

    const archivoPrevio = normalizarArchivo(crudoPrevio || {}, datosPrevios || DATOS_DEFECTO, crudoPrevio);
    const activoPrevio = (archivoPrevio.programas || []).find((item) => item.id === archivoPrevio.programaActivoId)
        || archivoPrevio.programas?.[0];
    const tituloHoja = await resolverTituloHojaVigente(driveId);

    const buffer = await descargarBufferDrive(driveId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(tituloHoja)
        || obtenerHojaDatos(wb, 'edicion');
    if (!ws) {
        return cargarFormato(pool);
    }
    const datosDrive = sanitizarDatos({
        ...parsearDatosDesdeHoja(ws),
        motivoAuditoria: activoPrevio?.motivoAuditoria || ''
    });

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const datosConPdf = {
        ...datosDrive,
        ...preservarPdfMeta(datosDrive, datosPrevios)
    };
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
        datosConPdf.fechaElaboracion = fechaModificacion;
    } else {
        datosConPdf.fechaElaboracion = contenidoModificado && fechaModificacion
            ? fechaModificacion
            : fechaOriginal;
    }

    const archivoSync = normalizarArchivo(crudoPrevio || {}, datosConPdf, crudoPrevio);
    const datosPublicar = unirArchivo(datosConPdf, archivoSync);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
    if (!huboCambio) {
        const resp = construirRespuesta(registro, datosPublicar, archivoDrive, tituloHoja);
        return aplicarUrlsHojaEnRespuesta(resp, driveId, resp.hojaActiva);
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const respuesta = construirRespuesta(registroActualizado, datosPublicar, archivoDrive, tituloHoja);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveId, respuesta.hojaActiva);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const crudo = await leerDatosRegistro(registro);
    const base = crudo || sanitizarDatos(DATOS_DEFECTO);
    const archivo = normalizarArchivo(crudo || {}, base, crudo);
    const driveId = await resolverDriveFileId(registro);
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-07 para regenerar desde la plantilla.');
    }

    const activo = (archivo.programas || []).find((item) => item.id === archivo.programaActivoId)
        || archivo.programas[0];
    const plano = sanitizarDatos(activo || base);
    await limpiarHojasResidualesSgcF07(driveId);
    const vigente = await resolverTituloHojaVigente(driveId);
    const destino = esHojaDelMesActual(vigente) ? vigente : nombreHojaMesActual();
    const hojaActiva = await reescribirHojaDesdePlantilla(driveId, destino, plano);
    const datosPublicar = unirArchivo(plano, archivo);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datosPublicar.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
    const respuesta = construirRespuesta(registroActualizado, datosPublicar, archivoDrive, hojaActiva);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveId, respuesta.hojaActiva);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    await moverPdfsFirmadosACarpetaCorrecta().catch((err) => {
        console.warn('[SGC-F-07] Migración previa a subir PDF:', err.message);
    });
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

    const planoPdf = {
        ...sanitizarDatos(datosPrevios),
        pdfFirmado,
        pdfsHistorial
    };
    const archivoPdf = normalizarArchivo(datosPrevios, planoPdf, datosPrevios);
    const datosGuardar = unirArchivo(planoPdf, archivoPdf);
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    const driveFileId = await resolverDriveFileId(registroPrevio)
        || (esPlantillaMaestra(registroPrevio?.drive_file_id) ? null : (registroPrevio?.drive_file_id || null));
    const tituloHoja = driveFileId
        ? await resolverTituloHojaVigente(driveFileId).catch(() => nombreHojaMesActual())
        : nombreHojaMesActual();

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
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive, tituloHoja);
    return {
        ...await aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, respuesta.hojaActiva),
        pdfFirmado
    };
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
        console.warn('[SGC-F-07] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const planoPdf = {
        ...sanitizarDatos(datosPrevios),
        pdfFirmado,
        pdfsHistorial: hist
    };
    const archivoPdf = normalizarArchivo(datosPrevios, planoPdf, datosPrevios);
    const datosGuardar = unirArchivo(planoPdf, archivoPdf);
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    const sheetId = await resolverDriveFileId(registroPrevio)
        || (esPlantillaMaestra(registroPrevio?.drive_file_id) ? null : (registroPrevio?.drive_file_id || null));
    const tituloHoja = sheetId
        ? await resolverTituloHojaVigente(sheetId).catch(() => nombreHojaMesActual())
        : nombreHojaMesActual();

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
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive, tituloHoja);
    return aplicarUrlsHojaEnRespuesta(respuesta, sheetId, respuesta.hojaActiva);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    TEMPLATE_SHEET_TITLE,
    DRIVE_FILE_ID_SISTEMA,
    CARPETA_PDF_FIRMADO_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sanitizarDatos,
    adoptarPlantillaEnSistema,
    moverPdfsFirmadosACarpetaCorrecta
};
