/**
 * DG-F-04 · Análisis FODA — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'DG-F-04';
/**
 * Plantilla maestra (estructura). Editar aquí el diseño; el sistema la copia al archivo de trabajo.
 * https://docs.google.com/spreadsheets/d/1WKgNlkGR481eOhwl_wv4l5HaVj8pt3FR4oF4I_1GTuc
 */
const TEMPLATE_DRIVE_ID = '1WKgNlkGR481eOhwl_wv4l5HaVj8pt3FR4oF4I_1GTuc';
/**
 * Archivo de trabajo Centro SGC (historial DGF04-MMAA). Nunca se borra al actualizar plantilla.
 * https://docs.google.com/spreadsheets/d/1VfHOIJEeCJ8QZNYdWp6spszmcFKq_ZNVDn24oX8Rj9I
 */
const DRIVE_FILE_ID_SISTEMA = '1VfHOIJEeCJ8QZNYdWp6spszmcFKq_ZNVDn24oX8Rj9I';
const CARPETA_DRIVE_ID = '1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4';
const NOMBRE_ARCHIVO_DRIVE = 'DG-F-04 Análisis FODA (sistema)';
/** Nombre de la pestaña en el archivo plantilla. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Nombre base de hoja de edición (si existe) dentro del archivo sistema. */
const SHEET_TITLE = 'Analisis FODA';
/** Columnas A–N: factor/responsable/estrategia (B–K) + matriz L–N. */
const MAX_COLUMNAS_SISTEMA = 14;
/** Alto según palabras en «Estrategia» (seguimiento): >9 → 70 px; ≤9 → 50 px. */
const DATA_ROW_HEIGHT_SHORT_PX = 50;
const DATA_ROW_HEIGHT_TALL_PX = 70;
const ESTRATEGIA_PALABRAS_UMBRAL = 9;
/** @deprecated usar altoFilaSegunEstrategia; se mantiene como techo por compatibilidad. */
const DATA_ROW_HEIGHT_PX = DATA_ROW_HEIGHT_TALL_PX;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

const REVISION_ROW = 2;
const FECHA_REV_ROW = 3;
const REVISION_COL = 9;
const META_ROW = 7;
const META_COL = { empresa: 3, fecha: 9 };
const COL = { factor: 2, responsable: 6, seguimiento: 9 };
const COL_FIRMA = 5;
/** Rangos de columnas fusionadas en la plantilla Excel (igual que 1WKgNlk…). */
const COL_GRUPO = {
    factor: [2, 3, 4, 5],    // B:E
    responsable: [6, 7, 8],  // F:H
    seguimiento: [9, 10]     // I:J Estrategia (K queda vacía en plantilla)
};
/** Columnas L–N: Probabilidad, Consecuencia o Impacto, Resultado. */
const COL_MATRIZ = {
    probabilidad: 12,
    consecuencia: 13,
    resultado: [14]
};

const RIESGO_MATRIZ = {
    A: { 1: 'H', 2: 'H', 3: 'E', 4: 'E', 5: 'E' },
    B: { 1: 'M', 2: 'H', 3: 'H', 4: 'E', 5: 'E' },
    C: { 1: 'L', 2: 'M', 3: 'H', 4: 'E', 5: 'E' },
    D: { 1: 'L', 2: 'L', 3: 'M', 4: 'H', 5: 'E' },
    E: { 1: 'L', 2: 'L', 3: 'M', 4: 'H', 5: 'H' }
};

const RIESGO_ETIQUETAS = {
    E: 'E - Riesgo extremo; requiere acción inmediata',
    H: 'H - Riesgo alto; necesita atención de la alta gerencia',
    M: 'M - Riesgo moderado; debe especificarse responsabilidad gerencial',
    L: 'L - Riesgo bajo; administrar mediante procedimientos de rutina'
};

const OPORTUNIDAD_MATRIZ = {
    3: { 1: 'B', 2: 'A', 3: 'A' },
    2: { 1: 'C', 2: 'B', 3: 'A' },
    1: { 1: 'C', 2: 'C', 3: 'B' }
};

const OPORTUNIDAD_ETIQUETAS = {
    A: 'A - Perseguir la oportunidad.',
    B: 'B - Aceptar la oportunidad con condiciones.',
    C: 'C - Declinar la intención de alcanzarla por bajos beneficios.'
};

const SECCION_MARKERS = {
    fortalezas: 'fortalezas lo que',
    debilidades: 'debilidades aquello',
    amenazas: 'amenazas factores',
    oportunidades: 'oportunidades factores'
};

const SECCION_ORDEN = ['fortalezas', 'debilidades', 'amenazas', 'oportunidades'];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-21',
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-17',
    fortalezas: [
        { factor: 'Competencia del personal', responsable: 'NA', seguimiento: 'NA' },
        { factor: 'Infraestructura', responsable: 'NA', seguimiento: 'NA' },
        { factor: '8 años en el mercado', responsable: 'NA', seguimiento: 'NA' },
        { factor: 'Adaptabilidad / Flexibilidad', responsable: 'NA', seguimiento: 'NA' },
        { factor: 'Alcance y cobertura geográfica', responsable: 'NA', seguimiento: 'NA' },
        { factor: 'Cumplimiento legal', responsable: 'NA', seguimiento: 'NA' }
    ],
    oportunidades: [
        {
            factor: 'Convenios con universidades para desarroyo de proyectos internos',
            responsable: 'Leonel Pérez',
            seguimiento: 'Concretar convenios con universidades (Carta de aceptación de estancia)',
            probabilidad: '3',
            consecuencia: '2',
            resultado: OPORTUNIDAD_ETIQUETAS.A
        },
        {
            factor: 'Socios estratégicos de servicios complementarios',
            responsable: 'Leonel Pérez',
            seguimiento: 'Crear una cartera de socios estratégicos',
            probabilidad: '3',
            consecuencia: '3',
            resultado: OPORTUNIDAD_ETIQUETAS.A
        },
        {
            factor: 'Convocatorias gubernamentales y licitaciones',
            responsable: 'Alta Dirección',
            seguimiento: 'Participar en licitaciones regularmente (listado de licitaciones en activo)',
            probabilidad: '2',
            consecuencia: '2',
            resultado: OPORTUNIDAD_ETIQUETAS.B
        },
        {
            factor: 'Pertenecer a asociaciones empresariales',
            responsable: 'Alta Dirección',
            seguimiento: 'Registro de CANACINTRA',
            probabilidad: '3',
            consecuencia: '2',
            resultado: OPORTUNIDAD_ETIQUETAS.A
        },
        {
            factor: 'Certificaciones nacionales e internacionales',
            responsable: 'Sergio Guzmán',
            seguimiento: 'Implementación del SGC y buscar la certificación como Unidad Verificadora',
            probabilidad: '3',
            consecuencia: '3',
            resultado: OPORTUNIDAD_ETIQUETAS.A
        }
    ],
    debilidades: [
        {
            factor: 'Resguardo de información',
            responsable: 'Leonel Pérez',
            seguimiento: 'Renta de un sistema de almacenamiento para información (NUBE)',
            probabilidad: 'B',
            consecuencia: '3',
            resultado: RIESGO_ETIQUETAS.H
        },
        {
            factor: 'Seguimiento al cliente',
            responsable: 'Sergio Guzmán',
            seguimiento: 'Implementación del SGC',
            probabilidad: 'C',
            consecuencia: '2',
            resultado: RIESGO_ETIQUETAS.M
        },
        {
            factor: 'Tiempo de respuesta',
            responsable: 'Sergio Guzmán',
            seguimiento: 'Implementación del SGC',
            probabilidad: 'C',
            consecuencia: '3',
            resultado: RIESGO_ETIQUETAS.H
        },
        {
            factor: 'Seguimiento de cartera de cobro',
            responsable: 'Rozana Reyes',
            seguimiento:
                'Reuniones semanales entre Dirección General y Gerente de Administración y Talento Humano',
            probabilidad: 'B',
            consecuencia: '2',
            resultado: RIESGO_ETIQUETAS.H
        },
        {
            factor: 'Control de proyectos',
            responsable: 'Marisol Santillán',
            seguimiento: 'Implemetar el formato "Control de proyectos Biznaga"',
            probabilidad: 'C',
            consecuencia: '4',
            resultado: RIESGO_ETIQUETAS.E
        }
    ],
    amenazas: [
        {
            factor: 'Mayor competencia en el estado',
            responsable: 'Gerencias / Ejec de Sist. De Gest y Ca.',
            seguimiento: 'Capacitación de nuestro personal, nuevos proyectos y certificaciones',
            probabilidad: 'A',
            consecuencia: '3',
            resultado: RIESGO_ETIQUETAS.E
        },
        {
            factor: 'Innovación de herramientas tecnológicas para capacitación y control de proyectos',
            responsable: 'Leonel Pérez',
            seguimiento: 'Plan de acción',
            probabilidad: 'A',
            consecuencia: '4',
            resultado: RIESGO_ETIQUETAS.E
        },
        {
            factor:
                'Cambios frecuentes de requisitos para entrega de trámites y proyectos ante instancias de gobierno',
            responsable: 'Sergio Guzmán',
            seguimiento: 'Comunicación con el cliente e instancias gubernamentales (Integrar al SGC)',
            probabilidad: 'B',
            consecuencia: '2',
            resultado: RIESGO_ETIQUETAS.H
        }
    ],
    autorizo: 'Dirección General'
};

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

/** Texto de celda normalizado para comparar encabezados de sección (espacios colapsados). */
function normalizarTextoBusqueda(texto) {
    return normalizarSaltosLinea(texto).toLowerCase().replace(/\s+/g, ' ').trim();
}

function asignarTextoSimple(celda, valor, horizontal = 'center') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function asignarTextoMultilinea(celda, texto, horizontal = 'center') {
    const valor = normalizarSaltosLinea(texto);
    celda.value = valor;
    if (valor) {
        celda.alignment = {
            ...(celda.alignment || {}),
            horizontal,
            vertical: 'middle',
            wrapText: true
        };
    }
}

function leerCeldaGrupo(row, columnas) {
    for (const col of columnas) {
        const texto = celdaATexto(row.getCell(col).value);
        if (texto) {
            return texto;
        }
    }
    return '';
}

function limpiarCeldaGrupo(row, columnas) {
    for (const col of columnas) {
        row.getCell(col).value = null;
    }
}

function asignarGrupoSimple(row, columnas, valor, horizontal = 'center') {
    for (const col of columnas) {
        asignarTextoSimple(row.getCell(col), valor, horizontal);
    }
}

function asignarGrupoMultilinea(row, columnas, valor, horizontal = 'center') {
    for (const col of columnas) {
        asignarTextoMultilinea(row.getCell(col), valor, horizontal);
    }
}

function esSeccionOportunidades(seccionKey) {
    return seccionKey === 'oportunidades';
}

function calcularResultadoMatriz(seccionKey, probabilidad, consecuencia) {
    const prob = String(probabilidad || '').trim().toUpperCase();
    const cons = Number(String(consecuencia || '').trim());
    if (!prob || !cons) return '';

    if (esSeccionOportunidades(seccionKey)) {
        const probNum = Number(prob);
        if (![1, 2, 3].includes(probNum) || ![1, 2, 3].includes(cons)) return '';
        const codigo = OPORTUNIDAD_MATRIZ[probNum]?.[cons] || '';
        return codigo ? (OPORTUNIDAD_ETIQUETAS[codigo] || codigo) : '';
    }

    if (!RIESGO_MATRIZ[prob] || !RIESGO_MATRIZ[prob][cons]) return '';
    const codigo = RIESGO_MATRIZ[prob][cons];
    return RIESGO_ETIQUETAS[codigo] || codigo;
}

function limpiarCeldaMatriz(row) {
    row.getCell(COL_MATRIZ.probabilidad).value = null;
    row.getCell(COL_MATRIZ.consecuencia).value = null;
    for (const col of COL_MATRIZ.resultado) {
        row.getCell(col).value = null;
    }
}

function asignarMatrizFila(row, seccionKey, fila) {
    const probabilidad = String(fila?.probabilidad || '').trim();
    const consecuencia = String(fila?.consecuencia || '').trim();
    const resultado = calcularResultadoMatriz(seccionKey, probabilidad, consecuencia)
        || String(fila?.resultado || '').trim();

    asignarTextoSimple(row.getCell(COL_MATRIZ.probabilidad), probabilidad, 'center');
    asignarTextoSimple(row.getCell(COL_MATRIZ.consecuencia), consecuencia, 'center');
    asignarTextoMultilinea(row.getCell(COL_MATRIZ.resultado[0]), resultado, 'left');
}

function leerMatrizFila(row) {
    const probabilidad = celdaATexto(row.getCell(COL_MATRIZ.probabilidad).value).trim();
    const consecuencia = celdaATexto(row.getCell(COL_MATRIZ.consecuencia).value).trim();
    let resultado = celdaATexto(row.getCell(COL_MATRIZ.resultado[0]).value).trim();
    return { probabilidad, consecuencia, resultado };
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

function fechaAhoraMexicoIso() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function formatearFechaRevisionIso(fecha) {
    if (!fecha) return '';
    const s = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
        return s.slice(0, 19);
    }
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
        return s.replace(' ', 'T').slice(0, 19);
    }
    return formatearFechaIso(fecha);
}

function parseFechaRevisionDesdePlantilla(texto) {
    const limpio = celdaATexto(texto)
        .replace(/^fecha de rev\.?\s*:?\s*/i, '')
        .trim();
    const m = limpio.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) {
        return formatearFechaRevisionIso(limpio) || DATOS_DEFECTO.fechaRevision;
    }
    let [, d, mo, y, hh, mm, ss] = m;
    if (y.length === 2) {
        y = `20${y}`;
    }
    const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (hh !== undefined) {
        return `${date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${String(ss || '00').padStart(2, '0')}`;
    }
    return date;
}

function formatearFechaRevisionDisplay(fechaRevision) {
    const iso = formatearFechaRevisionIso(fechaRevision);
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function aplicarRevisionPorCambio(revisionActual, fechaRevisionActual, huboCambio, origen = 'sistema') {
    let revision = String(revisionActual || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision;
    let fechaRevision = formatearFechaRevisionIso(fechaRevisionActual) || DATOS_DEFECTO.fechaRevision;
    if (huboCambio && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        fechaRevision = fechaAhoraMexicoIso();
    }
    return { revision, fechaRevision };
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function esFilaEncabezadoSeccion(texto) {
    const t = normalizarTextoBusqueda(texto);
    return Object.values(SECCION_MARKERS).some((m) => t.includes(m));
}

/** Centra títulos Fortalezas/Debilidades/Amenazas/Oportunidades (+ Responsable/Estrategia). */
function centrarEncabezadosSeccionEnHoja(ws) {
    const secciones = mapearSeccionesEnHoja(ws);
    for (const sec of secciones) {
        const row = ws.getRow(sec.headerRow);
        for (const cols of [COL_GRUPO.factor, COL_GRUPO.responsable, COL_GRUPO.seguimiento]) {
            for (const col of cols) {
                const celda = row.getCell(col);
                celda.alignment = {
                    ...(celda.alignment || {}),
                    horizontal: 'center',
                    vertical: 'middle',
                    wrapText: true
                };
            }
        }
    }
    return secciones;
}

async function centrarEncabezadosSeccionEnDrive(spreadsheetId, seccionesMap, sheetTitle = SHEET_TITLE) {
    if (!spreadsheetId || !Array.isArray(seccionesMap) || !seccionesMap.length) {
        return;
    }
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return;
    }
    const requests = [];
    for (const sec of seccionesMap) {
        const fila = Number(sec.headerRow);
        if (!Number.isFinite(fila) || fila < 1) {
            continue;
        }
        // B–J: título de sección + Responsable + Estrategia
        requests.push({
            repeatCell: {
                range: {
                    sheetId: Number(sheetId),
                    startRowIndex: fila - 1,
                    endRowIndex: fila,
                    startColumnIndex: COL_GRUPO.factor[0] - 1,
                    endColumnIndex: COL_GRUPO.seguimiento[COL_GRUPO.seguimiento.length - 1]
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
    }
    if (!requests.length) {
        return;
    }
    try {
        await driveService.batchUpdateGoogleSheet(
            spreadsheetId,
            requests,
            'dgF04.centrarEncabezados'
        );
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron centrar encabezados de sección:', err.message);
    }
}

async function resolverYCentrarEncabezadosDrive(spreadsheetId, sheetTitle = SHEET_TITLE) {
    if (!spreadsheetId) {
        return [];
    }
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${sheetTitle}'!B1:B80`
        );
        const found = [];
        (filas || []).forEach((fila, idx) => {
            const txt = normalizarTextoBusqueda(fila?.[0]);
            for (const [key, marker] of Object.entries(SECCION_MARKERS)) {
                if (txt.includes(marker)) {
                    found.push({ key, headerRow: idx + 1 });
                }
            }
        });
        found.sort((a, b) => a.headerRow - b.headerRow);
        await centrarEncabezadosSeccionEnDrive(spreadsheetId, found, sheetTitle);
        return found;
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron centrar encabezados de sección en Drive:', err.message);
        return [];
    }
}

function encontrarFilaNota(ws) {
    for (let r = 1; r <= ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL.factor).value).toLowerCase();
        if (txt.startsWith('nota 2')) return r;
    }
    return 46;
}

function filaTieneContenidoDatos(ws, rowNum) {
    const row = ws.getRow(rowNum);
    const factor = leerCeldaGrupo(row, COL_GRUPO.factor);
    if (factor && !esFilaEncabezadoSeccion(factor) && !String(factor).toLowerCase().startsWith('nota')) {
        return true;
    }
    const responsable = leerCeldaGrupo(row, COL_GRUPO.responsable);
    const seguimiento = leerCeldaGrupo(row, COL_GRUPO.seguimiento);
    return !!(responsable || seguimiento);
}

function mapearSeccionesEnHoja(ws) {
    const found = [];
    for (let r = 1; r <= ws.rowCount; r++) {
        const txt = normalizarTextoBusqueda(ws.getRow(r).getCell(COL.factor).value);
        for (const [key, marker] of Object.entries(SECCION_MARKERS)) {
            if (txt.includes(marker)) {
                found.push({ key, headerRow: r });
            }
        }
    }
    found.sort((a, b) => a.headerRow - b.headerRow);
    const filaNota = encontrarFilaNota(ws);
    found.forEach((sec, idx) => {
        sec.dataStart = sec.headerRow + 1;
        const limit = idx < found.length - 1 ? found[idx + 1].headerRow - 1 : filaNota - 1;
        // Excluye filas en blanco de separación al final del bloque de datos.
        let end = limit;
        while (end > sec.dataStart && !filaTieneContenidoDatos(ws, end)) {
            end -= 1;
        }
        sec.dataEnd = Math.max(sec.dataStart, end);
    });
    return found;
}

function etiquetaColumnaFactores(seccionKey) {
    if (seccionKey === 'fortalezas' || seccionKey === 'debilidades') {
        return 'Factores Internos';
    }
    return 'Factores Externos';
}

function leerFilasSeccion(ws, dataStart, dataEnd, seccionKey) {
    const filas = [];
    for (let r = dataStart; r <= dataEnd; r++) {
        const factor = leerCeldaGrupo(ws.getRow(r), COL_GRUPO.factor);
        if (!factor) continue;
        if (esFilaEncabezadoSeccion(factor)) continue;
        const lower = factor.toLowerCase();
        if (lower.startsWith('nota')) break;
        const row = ws.getRow(r);
        const responsable = leerCeldaGrupo(row, COL_GRUPO.responsable);
        const seguimiento = leerCeldaGrupo(row, COL_GRUPO.seguimiento);
        const matriz = leerMatrizFila(row);
        if (!factor && !responsable && !seguimiento && !matriz.probabilidad && !matriz.consecuencia) continue;
        const resultado = matriz.resultado
            || calcularResultadoMatriz(seccionKey, matriz.probabilidad, matriz.consecuencia);
        filas.push({
            factor,
            responsable,
            seguimiento,
            probabilidad: matriz.probabilidad,
            consecuencia: matriz.consecuencia,
            resultado
        });
    }
    return filas;
}

function leerFirma(ws) {
    for (let r = 50; r < ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL_FIRMA).value).toLowerCase();
        if (txt === 'firma') {
            const nombre = celdaATexto(ws.getRow(r + 1).getCell(COL_FIRMA).value);
            if (nombre) return nombre;
        }
    }
    return DATOS_DEFECTO.autorizo;
}

function escribirFirma(ws, autorizo) {
    for (let r = 50; r < ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL_FIRMA).value).toLowerCase();
        if (txt === 'firma') {
            asignarTextoSimple(ws.getRow(r + 1).getCell(COL_FIRMA), autorizo, 'center');
            return;
        }
    }
}

function sanitizarFilasSeccion(filas, seccionKey) {
    const lista = Array.isArray(filas) ? filas : [];
    const normalizadas = lista.map((f) => {
        const probabilidad = String(f?.probabilidad || '').trim();
        const consecuencia = String(f?.consecuencia || '').trim();
        const resultado = calcularResultadoMatriz(seccionKey, probabilidad, consecuencia)
            || String(f?.resultado || '').trim();
        return {
            factor: String(f?.factor || '').trim(),
            responsable: String(f?.responsable || '').trim(),
            seguimiento: String(f?.seguimiento || '').trim(),
            probabilidad,
            consecuencia,
            resultado
        };
    });
    const conContenido = normalizadas.filter(
        (f) => f.factor || f.responsable || f.seguimiento || f.probabilidad || f.consecuencia
    );
    return conContenido.length
        ? conContenido
        : [{ factor: '', responsable: '', seguimiento: '', probabilidad: '', consecuencia: '', resultado: '' }];
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const datos = {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaRevisionIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        autorizo: String(base.autorizo || DATOS_DEFECTO.autorizo).trim() || DATOS_DEFECTO.autorizo
    };
    for (const key of SECCION_ORDEN) {
        datos[key] = sanitizarFilasSeccion(base[key] ?? DATOS_DEFECTO[key], key);
    }
    return datos;
}

function parsearDatosDesdeHoja(ws) {
    const meta = ws.getRow(META_ROW);
    const empresa = celdaATexto(meta.getCell(META_COL.empresa).value);
    const fechaRaw = meta.getCell(META_COL.fecha).value;
    const fechaElaboracion = fechaRaw instanceof Date
        ? formatearFechaIso(fechaRaw)
        : formatearFechaIso(String(fechaRaw || ''));

    const secciones = mapearSeccionesEnHoja(ws);
    const datosParciales = {
        empresa: empresa || DATOS_DEFECTO.empresa,
        fechaElaboracion: fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
        autorizo: leerFirma(ws)
    };

    for (const sec of secciones) {
        const filas = leerFilasSeccion(ws, sec.dataStart, sec.dataEnd, sec.key);
        datosParciales[sec.key] = filas.length ? filas : DATOS_DEFECTO[sec.key];
    }

    for (const key of SECCION_ORDEN) {
        if (!datosParciales[key]) {
            datosParciales[key] = DATOS_DEFECTO[key];
        }
    }

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(REVISION_COL).value);
    datosParciales.revision = revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision;
    datosParciales.fechaRevision = parseFechaRevisionDesdePlantilla(fechaRevText);

    return sanitizarDatos(datosParciales);
}

function obtenerHojaPlantillaDesdeWorkbook(wb) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) {
        return null;
    }
    const buscado = TEMPLATE_SHEET_TITLE.toLowerCase();
    return lista.find((h) => String(h.name || '').trim().toLowerCase() === buscado)
        || lista[0]
        || null;
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    let ws = null;
    if (modo === 'plantilla') {
        ws = obtenerHojaPlantillaDesdeWorkbook(wb);
    } else if (modo === 'edicion') {
        ws = excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    } else {
        ws = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    }
    if (!ws) throw new Error('La plantilla DG-F-04 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    return leerDatosDesdeBuffer(buffer, { modo: 'plantilla' });
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

function recortarColumnasSistema(ws) {
    const total = Number(ws.columnCount || ws.actualColumnCount || 0);
    if (total <= MAX_COLUMNAS_SISTEMA) {
        return;
    }
    ws.spliceColumns(MAX_COLUMNAS_SISTEMA + 1, total - MAX_COLUMNAS_SISTEMA);
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = obtenerHojaPlantillaDesdeWorkbook(wb);
    if (!ws) throw new Error('La plantilla DG-F-04 no contiene la hoja «Plantilla».');

    ws.getRow(REVISION_ROW).getCell(REVISION_COL).value = `Revisión: ${datos.revision || '00'}`;
    ws.getRow(FECHA_REV_ROW).getCell(REVISION_COL).value =
        `Fecha de rev.: ${formatearFechaRevisionDisplay(datos.fechaRevision)}`;

    const meta = ws.getRow(META_ROW);
    meta.getCell(META_COL.empresa).value = datos.empresa;
    const fechaCell = meta.getCell(META_COL.fecha);
    fechaCell.value = datos.fechaElaboracion ? new Date(`${datos.fechaElaboracion}T12:00:00`) : null;

    let secciones = mapearSeccionesEnHoja(ws);

    for (let i = secciones.length - 1; i >= 0; i--) {
        const sec = secciones[i];
        const filas = datos[sec.key] || [];
        const slots = Math.max(0, sec.dataEnd - sec.dataStart + 1);
        if (filas.length > slots) {
            const extra = filas.length - slots;
            ws.spliceRows(sec.dataEnd + 1, 0, ...Array.from({ length: extra }, () => []));
        }
    }

    secciones = mapearSeccionesEnHoja(ws);

    for (const sec of secciones) {
        const filas = datos[sec.key] || [];
        for (let r = sec.dataStart; r <= sec.dataEnd; r++) {
            const row = ws.getRow(r);
            limpiarCeldaGrupo(row, COL_GRUPO.factor);
            limpiarCeldaGrupo(row, COL_GRUPO.responsable);
            limpiarCeldaGrupo(row, COL_GRUPO.seguimiento);
            limpiarCeldaMatriz(row);
        }
        filas.forEach((fila, idx) => {
            const row = ws.getRow(sec.dataStart + idx);
            row.height = altoFilaExcelJsPuntos(fila.seguimiento);
            asignarGrupoSimple(row, COL_GRUPO.factor, fila.factor, 'left');
            asignarGrupoSimple(row, COL_GRUPO.responsable, fila.responsable, 'center');
            asignarGrupoMultilinea(row, COL_GRUPO.seguimiento, fila.seguimiento, 'left');
            asignarMatrizFila(row, sec.key, fila);
        });
    }

    escribirFirma(ws, datos.autorizo);
    centrarEncabezadosSeccionEnHoja(ws);
    recortarColumnasSistema(ws);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function datosAActualizacionesSheet(datos, seccionesMap, sheetTitle = SHEET_TITLE) {
    const actualizaciones = [];
    actualizaciones.push({
        range: rangoSheet(`I${REVISION_ROW}`, sheetTitle),
        values: [[`Revisión: ${datos.revision || '00'}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`I${FECHA_REV_ROW}`, sheetTitle),
        values: [[`Fecha de rev.: ${formatearFechaRevisionDisplay(datos.fechaRevision)}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`C${META_ROW}`, sheetTitle),
        values: [[datos.empresa || '']]
    });
    actualizaciones.push({
        range: rangoSheet(`I${META_ROW}`, sheetTitle),
        values: [[formatearFechaCelda(datos.fechaElaboracion)]]
    });

    for (const sec of seccionesMap) {
        const filas = datos[sec.key] || [];
        // Nunca escribir más allá de dataEnd: pisar el encabezado de la siguiente sección
        // es lo que mezclaba Debilidades dentro de Fortalezas.
        const slots = Math.max(0, Number(sec.dataEnd) - Number(sec.dataStart) + 1);
        if (filas.length > slots) {
            console.warn(
                `[DG-F-04] Sección «${sec.key}» tiene ${filas.length} filas y solo ${slots} slots; `
                + 'se truncará. Debe reescribirse desde plantilla.'
            );
        }
        for (let idx = 0; idx < slots; idx++) {
            const fila = filas[idx] || {
                factor: '',
                responsable: '',
                seguimiento: '',
                probabilidad: '',
                consecuencia: '',
                resultado: ''
            };
            const rowNum = sec.dataStart + idx;
            const resultado = calcularResultadoMatriz(sec.key, fila.probabilidad, fila.consecuencia)
                || fila.resultado
                || '';
            // Una sola celda ancla por grupo fusionado (B, F, I) evita romper merges.
            actualizaciones.push({
                range: rangoSheet(`B${rowNum}`, sheetTitle),
                values: [[fila.factor || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`F${rowNum}`, sheetTitle),
                values: [[fila.responsable || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`I${rowNum}`, sheetTitle),
                values: [[normalizarSaltosLinea(fila.seguimiento)]]
            });
            actualizaciones.push({
                range: rangoSheet(`L${rowNum}`, sheetTitle),
                values: [[fila.probabilidad || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`M${rowNum}`, sheetTitle),
                values: [[fila.consecuencia || '']]
            });
            actualizaciones.push({
                range: rangoSheet(`N${rowNum}`, sheetTitle),
                values: [[resultado]]
            });
        }
    }

    return actualizaciones;
}

function seccionesRequierenExpansion(datos, seccionesMap) {
    const secs = Array.isArray(seccionesMap) ? seccionesMap : [];
    if (!secs.length) {
        return true;
    }
    const keys = new Set(secs.map((s) => s.key));
    for (const key of SECCION_ORDEN) {
        if (!keys.has(key)) {
            return true;
        }
    }
    return secs.some((sec) => {
        const filas = Array.isArray(datos?.[sec.key]) ? datos[sec.key] : [];
        const slots = Math.max(0, Number(sec.dataEnd) - Number(sec.dataStart) + 1);
        return filas.length > slots;
    });
}

/**
 * Normaliza texto de encabezado para comparar con la plantilla.
 */
function normalizarEncabezadoColumna(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Verifica que la hoja vigente tenga el mismo layout A–N que la plantilla externa
 * (L=Probabilidad, M=Consecuencia, N=Resultado). Si no, hay que recopiar plantilla:
 * nunca «inventar» la columna N vacía sobre una hoja vieja del sistema.
 */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return false;
    }
    try {
        const dims = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, sheetTitle);
        if (Number(dims.columnCount || 0) < MAX_COLUMNAS_SISTEMA) {
            return false;
        }
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            rangoSheet('L9:N9', sheetTitle)
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const l = normalizarEncabezadoColumna(row[0]);
        const m = normalizarEncabezadoColumna(row[1]);
        const n = normalizarEncabezadoColumna(row[2]);
        return l.includes('probabilidad')
            && m.includes('consecuencia')
            && n.includes('resultado');
    } catch (err) {
        console.warn('[DG-F-04] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/** Solo recorta O+; si faltan columnas, la hoja debe reescribirse desde plantilla. */
async function asegurarColumnasSistemaDrive(spreadsheetId, sheetTitle = null) {
    if (!spreadsheetId) {
        return { ok: false, columnCount: 0 };
    }
    try {
        const titulo = sheetTitle || await resolverTituloHojaVigente(spreadsheetId);
        const dims = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, titulo);
        const colCount = Number(dims.columnCount || 0);
        if (colCount > 0 && colCount < MAX_COLUMNAS_SISTEMA) {
            console.warn(
                `[DG-F-04] Hoja «${titulo}» tiene ${colCount} columnas (se esperan ${MAX_COLUMNAS_SISTEMA}); `
                + 'debe recopiarse desde la plantilla externa.'
            );
            return { ok: false, columnCount: colCount, titulo };
        }
        await driveService.recortarColumnasGoogleSheet(spreadsheetId, {
            ...DRIVE_SHEET_OPTIONS,
            sheetTitle: titulo
        });
        return { ok: true, columnCount: colCount, titulo };
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron normalizar columnas A–N en Drive:', err.message);
        return { ok: false, columnCount: 0 };
    }
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const buscado = String(sheetTitle || '').trim().toLowerCase();
    const hit = (meta || []).find((s) => String(s.title || '').trim().toLowerCase() === buscado);
    return hit?.sheetId ?? null;
}

/**
 * Cuenta palabras en Estrategia ignorando signos ¿?¡! y puntuación habitual.
 */
function contarPalabrasEstrategia(texto) {
    const limpio = String(texto || '')
        .normalize('NFC')
        .replace(/[¿?¡!.,;:·…""''«»()[\]{}]/g, ' ')
        .replace(/[|/\\_+*=<>@#$%^&~`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!limpio) {
        return 0;
    }
    return limpio.split(' ').filter(Boolean).length;
}

/** >9 palabras → 70 px; en caso contrario → 50 px. */
function altoFilaSegunEstrategia(texto) {
    return contarPalabrasEstrategia(texto) > ESTRATEGIA_PALABRAS_UMBRAL
        ? DATA_ROW_HEIGHT_TALL_PX
        : DATA_ROW_HEIGHT_SHORT_PX;
}

/** ExcelJS usa puntos (~96 dpi): px * 72/96. */
function altoFilaExcelJsPuntos(texto) {
    return altoFilaSegunEstrategia(texto) * (72 / 96);
}

/**
 * La plantilla trae 1 fila modelo + a veces 1 fila en blanco entre secciones.
 * Deja exactamente 1 fila de datos por sección (sin huecos).
 */
async function compactarAUnaFilaModeloPorSeccion(spreadsheetId, sheetTitle, seccionesMap) {
    const secs = (Array.isArray(seccionesMap) ? seccionesMap : []).map((s) => ({ ...s }));
    if (!secs.length) {
        return secs;
    }
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return secs;
    }

    for (let i = secs.length - 1; i >= 0; i--) {
        const start = Number(secs[i].dataStart);
        const end = Number(secs[i].dataEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
            continue;
        }
        const slots = end - start + 1;
        const sobran = slots - 1;
        if (sobran <= 0) {
            continue;
        }
        // Borra desde la 2.ª fila de datos (0-based = dataStart).
        await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, start, sobran);
        secs[i].dataEnd = start;
        for (let j = i + 1; j < secs.length; j++) {
            secs[j].headerRow -= sobran;
            secs[j].dataStart -= sobran;
            secs[j].dataEnd -= sobran;
        }
    }
    return secs;
}

/**
 * Inserta filas heredando diseño de la fila plantilla (1 celda por sección).
 * El alto definitivo (50/70) se aplica después según palabras de Estrategia.
 */
async function asegurarFilasSeccionesEnDrive(spreadsheetId, sheetTitle, datos, seccionesMap) {
    let secs = (Array.isArray(seccionesMap) ? seccionesMap : []).map((s) => ({ ...s }));
    if (!secs.length) {
        return secs;
    }

    // Primero quita filas en blanco entre secciones (origen del «hueco» visual).
    secs = await compactarAUnaFilaModeloPorSeccion(spreadsheetId, sheetTitle, secs);

    const extras = secs.map((sec) => {
        const filas = Array.isArray(datos?.[sec.key]) ? datos[sec.key] : [];
        const needed = Math.max(1, filas.length);
        const slots = Math.max(0, Number(sec.dataEnd) - Number(sec.dataStart) + 1);
        return Math.max(0, needed - slots);
    });

    if (!extras.some((n) => n > 0)) {
        return secs;
    }

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        throw new Error(`No se pudo resolver sheetId de "${sheetTitle}" para insertar filas.`);
    }

    for (let i = secs.length - 1; i >= 0; i--) {
        const extra = extras[i];
        if (extra <= 0) {
            continue;
        }
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            sheetId,
            secs[i].dataEnd,
            extra,
            { inheritFromBefore: true, pixelSize: DATA_ROW_HEIGHT_SHORT_PX }
        );
        for (let j = i; j < secs.length; j++) {
            if (j === i) {
                secs[j].dataEnd += extra;
            } else {
                secs[j].headerRow += extra;
                secs[j].dataStart += extra;
                secs[j].dataEnd += extra;
            }
        }
    }

    return secs;
}

/**
 * Tras escribir datos: si sobran filas vacías al final de la sección, las elimina.
 * Siempre conserva al menos 1 fila modelo (como la plantilla).
 */
async function recortarFilasSobrantesSecciones(spreadsheetId, sheetTitle, datos, seccionesMap) {
    const secs = (Array.isArray(seccionesMap) ? seccionesMap : []).map((s) => ({ ...s }));
    if (!secs.length) {
        return secs;
    }
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return secs;
    }

    for (let i = secs.length - 1; i >= 0; i--) {
        const filas = Array.isArray(datos?.[secs[i].key]) ? datos[secs[i].key] : [];
        const needed = Math.max(1, filas.length);
        const start = Number(secs[i].dataStart);
        const end = Number(secs[i].dataEnd);
        const slots = end - start + 1;
        const sobran = slots - needed;
        if (sobran <= 0) {
            continue;
        }
        const deleteFrom = start + needed - 1; // 0-based primera fila sobrante
        await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, deleteFrom, sobran);
        secs[i].dataEnd = start + needed - 1;
        for (let j = i + 1; j < secs.length; j++) {
            secs[j].headerRow -= sobran;
            secs[j].dataStart -= sobran;
            secs[j].dataEnd -= sobran;
        }
    }
    return secs;
}

const COLOR_BLANCO = { red: 1, green: 1, blue: 1 };
/** #f2f2f2 — Factores Internos / Externos (columna A). */
const COLOR_FACTORES = { red: 242 / 255, green: 242 / 255, blue: 242 / 255 };
const COLOR_NEGRO = { red: 0, green: 0, blue: 0 };
const BORDE_FINO = { style: 'SOLID', width: 1, color: COLOR_NEGRO };
const BORDE_GRUESO = { style: 'SOLID', width: 2, color: COLOR_NEGRO };
const SIN_BORDE = { style: 'NONE' };
/** Columna K (1-based): separador sin bordes entre Estrategia y matriz. */
const COL_K = 11;

function rangoMergeRequest(sheetId, startRow1, endRow1Inclusive, startCol1, endCol1Inclusive) {
    return {
        sheetId: Number(sheetId),
        startRowIndex: Math.max(0, startRow1 - 1),
        endRowIndex: Math.max(0, endRow1Inclusive),
        startColumnIndex: Math.max(0, startCol1 - 1),
        endColumnIndex: Math.max(0, endCol1Inclusive)
    };
}

function pushUnmergeMerge(requests, range) {
    requests.push({ unmergeCells: { range } });
    requests.push({
        mergeCells: {
            range,
            mergeType: 'MERGE_ALL'
        }
    });
}

function pushFondo(requests, range, color) {
    requests.push({
        repeatCell: {
            range,
            cell: {
                userEnteredFormat: {
                    backgroundColor: color
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    });
}

function pushBordesGruesosAj(requests, range) {
    requests.push({
        updateBorders: {
            range,
            top: BORDE_GRUESO,
            bottom: BORDE_GRUESO,
            left: BORDE_GRUESO,
            right: BORDE_GRUESO,
            innerHorizontal: BORDE_GRUESO,
            innerVertical: BORDE_GRUESO
        }
    });
}

function pushBordesFinos(requests, range) {
    requests.push({
        updateBorders: {
            range,
            top: BORDE_FINO,
            bottom: BORDE_FINO,
            left: BORDE_FINO,
            right: BORDE_FINO,
            innerHorizontal: BORDE_FINO,
            innerVertical: BORDE_FINO
        }
    });
}

/**
 * Merges, altos y fondos. Los bordes FODA se aplican DESPUÉS de limpiar
 * filas extra y columna K (ver finalizarDisenoYSeparadoresDgF04).
 */
async function aplicarDisenoFilasDatosDgF04(spreadsheetId, sheetTitle, seccionesMap, datos = null) {
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null || !Array.isArray(seccionesMap) || !seccionesMap.length) {
        return;
    }

    const requests = [];
    const valoresFactores = [];

    for (const sec of seccionesMap) {
        const header = Number(sec.headerRow);
        const start = Number(sec.dataStart);
        const end = Number(sec.dataEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
            continue;
        }
        const filas = Array.isArray(datos?.[sec.key]) ? datos[sec.key] : [];

        // Encabezado de sección: B:E / F:H / I:J
        if (Number.isFinite(header) && header > 0) {
            for (const cols of [COL_GRUPO.factor, COL_GRUPO.responsable, COL_GRUPO.seguimiento]) {
                pushUnmergeMerge(
                    requests,
                    rangoMergeRequest(sheetId, header, header, cols[0], cols[cols.length - 1])
                );
            }
        }

        for (let row = start; row <= end; row++) {
            const idx = row - start;
            const estrategia = filas[idx]?.seguimiento || '';
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId: Number(sheetId),
                        dimension: 'ROWS',
                        startIndex: row - 1,
                        endIndex: row
                    },
                    properties: { pixelSize: altoFilaSegunEstrategia(estrategia) },
                    fields: 'pixelSize'
                }
            });
            for (const cols of [COL_GRUPO.factor, COL_GRUPO.responsable, COL_GRUPO.seguimiento]) {
                pushUnmergeMerge(
                    requests,
                    rangoMergeRequest(sheetId, row, row, cols[0], cols[cols.length - 1])
                );
            }
        }

        if (Number.isFinite(header) && header > 0) {
            // Datos B–N en blanco (A se pinta aparte).
            pushFondo(
                requests,
                rangoMergeRequest(sheetId, start, end, 2, MAX_COLUMNAS_SISTEMA),
                COLOR_BLANCO
            );

            // Columna A: Factores Internos/Externos con #f2f2f2.
            const rangeA = rangoMergeRequest(sheetId, header, end, 1, 1);
            pushUnmergeMerge(requests, rangeA);
            requests.push({
                repeatCell: {
                    range: rangeA,
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: COLOR_FACTORES,
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textRotation: { vertical: true }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textRotation)'
                }
            });
            valoresFactores.push({
                range: rangoSheet(`A${header}`, sheetTitle),
                values: [[etiquetaColumnaFactores(sec.key)]]
            });
        }
    }

    if (requests.length) {
        try {
            await driveService.batchUpdateGoogleSheet(spreadsheetId, requests, 'dgF04.disenoFilas');
        } catch (err) {
            console.warn('[DG-F-04] Diseño (merges/alto/fondos) falló; se intenta solo altos:', err.message);
            const soloAlto = requests.filter((r) => r.updateDimensionProperties);
            if (soloAlto.length) {
                try {
                    await driveService.batchUpdateGoogleSheet(
                        spreadsheetId,
                        soloAlto,
                        'dgF04.altoFilasEstrategia'
                    );
                } catch (errAlto) {
                    console.warn('[DG-F-04] No se pudo fijar alto según Estrategia:', errAlto.message);
                }
            }
        }
    }

    if (valoresFactores.length) {
        try {
            await driveService.actualizarCeldasGoogleSheet(spreadsheetId, valoresFactores);
        } catch (err) {
            console.warn('[DG-F-04] No se pudo escribir etiqueta Factores:', err.message);
        }
    }
}

/** Quita bordes de la columna K en el bloque FODA (y filas de separación). */
async function quitarBordesColumnaKDrive(spreadsheetId, sheetTitle, seccionesMap) {
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    const secs = Array.isArray(seccionesMap) ? seccionesMap : [];
    if (sheetId == null || !secs.length) {
        return;
    }
    const headers = secs.map((s) => Number(s.headerRow)).filter((n) => Number.isFinite(n));
    const ends = secs.map((s) => Number(s.dataEnd)).filter((n) => Number.isFinite(n));
    const filaNota = await resolverFilaNotaDrive(spreadsheetId, sheetTitle);
    const rowStart = Math.min(...headers);
    const rowEnd = Math.max(...ends, filaNota || 0, ...ends.map((e) => e + 1));
    if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd) || rowEnd < rowStart) {
        return;
    }
    try {
        await driveService.batchUpdateGoogleSheet(spreadsheetId, [
            {
                updateBorders: {
                    range: rangoMergeRequest(sheetId, rowStart, rowEnd, COL_K, COL_K),
                    top: SIN_BORDE,
                    bottom: SIN_BORDE,
                    left: SIN_BORDE,
                    right: SIN_BORDE,
                    innerHorizontal: SIN_BORDE,
                    innerVertical: SIN_BORDE
                }
            }
        ], 'dgF04.sinBordesColumnaK');
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron quitar bordes de columna K:', err.message);
    }
}

/**
 * Bordes gruesos A:J (bloques FODA) y finos L:N (matriz), DESPUÉS de limpiar
 * filas extra y columna K para no perder bordes superior/inferior.
 */
async function aplicarBordesTablasFodaDrive(spreadsheetId, sheetTitle, seccionesMap) {
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    const secs = Array.isArray(seccionesMap) ? seccionesMap : [];
    if (sheetId == null || !secs.length) {
        return;
    }
    const requests = [];
    for (const sec of secs) {
        const header = Number(sec.headerRow);
        const end = Number(sec.dataEnd);
        if (!Number.isFinite(header) || !Number.isFinite(end) || end < header) {
            continue;
        }
        // A:J — borde grueso del apartado FODA
        pushBordesGruesosAj(requests, rangoMergeRequest(sheetId, header, end, 1, 10));
        // L:N — matriz (borde fino)
        pushBordesFinos(requests, rangoMergeRequest(sheetId, header, end, 12, MAX_COLUMNAS_SISTEMA));
    }
    // Título matriz filas 7–8
    pushBordesFinos(requests, rangoMergeRequest(sheetId, 7, 8, 12, MAX_COLUMNAS_SISTEMA));

    if (!requests.length) {
        return;
    }
    try {
        await driveService.batchUpdateGoogleSheet(spreadsheetId, requests, 'dgF04.bordesTablaFoda');
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron aplicar bordes A:J / L:N:', err.message);
    }
}

async function resolverFilaNotaDrive(spreadsheetId, sheetTitle) {
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${sheetTitle}'!B1:B120`
        );
        for (let i = 0; i < (filas || []).length; i++) {
            const txt = String(filas[i]?.[0] || '').trim().toLowerCase();
            if (txt.startsWith('nota 2')) {
                return i + 1;
            }
        }
    } catch (err) {
        console.warn('[DG-F-04] No se pudo localizar Nota 2:', err.message);
    }
    return null;
}

/**
 * Deja 1 fila vacía sin bordes entre cada apartado FODA y antes de Nota 2.
 */
async function asegurarFilasSeparacionEntreSecciones(spreadsheetId, sheetTitle, seccionesMap) {
    const secs = (Array.isArray(seccionesMap) ? seccionesMap : []).map((s) => ({ ...s }));
    if (!secs.length) {
        return secs;
    }
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return secs;
    }

    let filaNota = await resolverFilaNotaDrive(spreadsheetId, sheetTitle);

    for (let i = secs.length - 1; i >= 0; i--) {
        const afterData = Number(secs[i].dataEnd);
        const nextBoundary = i < secs.length - 1
            ? Number(secs[i + 1].headerRow)
            : (filaNota || afterData + 2);
        if (!Number.isFinite(afterData) || !Number.isFinite(nextBoundary) || nextBoundary <= afterData) {
            continue;
        }

        const gapStart = afterData + 1; // 1-based
        const gapEnd = nextBoundary - 1;
        const gap = gapEnd >= gapStart ? gapEnd - gapStart + 1 : 0;

        if (gap === 1) {
            await limpiarFilaSeparacionDrive(spreadsheetId, sheetId, gapStart);
            continue;
        }

        if (gap > 1) {
            // Conserva 1 fila; borra el resto.
            await driveService.eliminarFilasGoogleSheet(
                spreadsheetId,
                sheetId,
                gapStart, // 0-based = segunda fila del hueco
                gap - 1
            );
            const deleted = gap - 1;
            if (i < secs.length - 1) {
                for (let j = i + 1; j < secs.length; j++) {
                    secs[j].headerRow -= deleted;
                    secs[j].dataStart -= deleted;
                    secs[j].dataEnd -= deleted;
                }
            }
            if (filaNota != null) {
                filaNota -= deleted;
            }
            await limpiarFilaSeparacionDrive(spreadsheetId, sheetId, gapStart);
            continue;
        }

        // gap === 0: insertar 1 fila de separación tras dataEnd.
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            sheetId,
            afterData, // 0-based: inserta después de la última fila de datos
            1,
            { inheritFromBefore: false, pixelSize: 22 }
        );
        if (i < secs.length - 1) {
            for (let j = i + 1; j < secs.length; j++) {
                secs[j].headerRow += 1;
                secs[j].dataStart += 1;
                secs[j].dataEnd += 1;
            }
        }
        if (filaNota != null) {
            filaNota += 1;
        }
        await limpiarFilaSeparacionDrive(spreadsheetId, sheetId, afterData + 1);
    }

    return secs;
}

async function limpiarFilaSeparacionDrive(spreadsheetId, sheetId, row1Based) {
    const r0 = Math.max(0, Number(row1Based) - 1);
    const range = {
        sheetId: Number(sheetId),
        startRowIndex: r0,
        endRowIndex: r0 + 1,
        startColumnIndex: 0,
        endColumnIndex: MAX_COLUMNAS_SISTEMA
    };
    try {
        // Solo blanco + sin bordes en la fila extra (los bordes FODA se reaplican después).
        await driveService.batchUpdateGoogleSheet(spreadsheetId, [
            {
                repeatCell: {
                    range,
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: COLOR_BLANCO
                        }
                    },
                    fields: 'userEnteredFormat.backgroundColor'
                }
            },
            {
                updateBorders: {
                    range,
                    top: SIN_BORDE,
                    bottom: SIN_BORDE,
                    left: SIN_BORDE,
                    right: SIN_BORDE,
                    innerHorizontal: SIN_BORDE,
                    innerVertical: SIN_BORDE
                }
            },
            {
                updateDimensionProperties: {
                    range: {
                        sheetId: Number(sheetId),
                        dimension: 'ROWS',
                        startIndex: r0,
                        endIndex: r0 + 1
                    },
                    properties: { pixelSize: 22 },
                    fields: 'pixelSize'
                }
            }
        ], 'dgF04.filaSeparacion');
    } catch (err) {
        console.warn('[DG-F-04] No se pudo limpiar fila de separación:', err.message);
    }
}

/**
 * Borde inferior grueso del último registro de Oportunidades (A:J) y superior de Nota 2.
 */
async function aplicarBordeCierreOportunidades(spreadsheetId, sheetTitle, seccionesMap) {
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return;
    }
    const opp = (seccionesMap || []).find((s) => s.key === 'oportunidades');
    if (!opp) {
        return;
    }
    const ultima = Number(opp.dataEnd);
    if (!Number.isFinite(ultima) || ultima < 1) {
        return;
    }
    const requests = [
        {
            updateBorders: {
                range: rangoMergeRequest(sheetId, ultima, ultima, 1, 10),
                bottom: BORDE_GRUESO
            }
        },
        {
            updateBorders: {
                range: rangoMergeRequest(sheetId, ultima, ultima, 12, MAX_COLUMNAS_SISTEMA),
                bottom: BORDE_FINO
            }
        }
    ];
    const filaNota = await resolverFilaNotaDrive(spreadsheetId, sheetTitle);
    if (filaNota) {
        requests.push({
            updateBorders: {
                range: rangoMergeRequest(sheetId, filaNota, filaNota, 1, 10),
                top: BORDE_GRUESO
            }
        });
    }
    try {
        await driveService.batchUpdateGoogleSheet(
            spreadsheetId,
            requests,
            'dgF04.bordeCierreOportunidades'
        );
    } catch (err) {
        console.warn('[DG-F-04] No se pudo aplicar borde de cierre Oportunidades/Nota 2:', err.message);
    }
}

/**
 * Orden obligatorio:
 * 1) merges / altos / fondos
 * 2) filas extra sin bordes (blanco)
 * 3) quitar bordes columna K
 * 4) bordes gruesos A:J + finos L:N (restaura superior/inferior del FODA)
 * 5) borde de cierre Oportunidades → Nota 2
 */
async function finalizarDisenoYSeparadoresDgF04(spreadsheetId, sheetTitle, seccionesMap, datos) {
    await aplicarDisenoFilasDatosDgF04(spreadsheetId, sheetTitle, seccionesMap, datos);
    const mapaConSep = await asegurarFilasSeparacionEntreSecciones(
        spreadsheetId,
        sheetTitle,
        seccionesMap
    );
    await quitarBordesColumnaKDrive(spreadsheetId, sheetTitle, mapaConSep);
    await aplicarBordesTablasFodaDrive(spreadsheetId, sheetTitle, mapaConSep);
    await aplicarBordeCierreOportunidades(spreadsheetId, sheetTitle, mapaConSep);
    await centrarEncabezadosSeccionEnDrive(spreadsheetId, mapaConSep, sheetTitle);
    return mapaConSep;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesMap, sheetTitle = SHEET_TITLE) {
    // Compacta huecos de datos + inserta filas necesarias (1 modelo por sección mínimo).
    let mapa = await asegurarFilasSeccionesEnDrive(spreadsheetId, sheetTitle, datos, seccionesMap);
    if (seccionesRequierenExpansion(datos, mapa)) {
        throw new Error(
            `La hoja «${sheetTitle}» no tiene slots suficientes tras insertar filas; `
            + 'usar reescritura desde plantilla.'
        );
    }
    const cols = await asegurarColumnasSistemaDrive(spreadsheetId, sheetTitle);
    if (!cols.ok) {
        throw new Error(
            `La hoja «${sheetTitle}» no tiene estructura A–N de plantilla; reescribir desde plantilla.`
        );
    }
    const actualizaciones = datosAActualizacionesSheet(datos, mapa, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    mapa = await recortarFilasSobrantesSecciones(spreadsheetId, sheetTitle, datos, mapa);
    await finalizarDisenoYSeparadoresDgF04(spreadsheetId, sheetTitle, mapa, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

/**
 * Sustituye SOLO la hoja del mes de trabajo por una copia limpia de la plantilla
 * externa, inserta filas y vuelca datos. Nunca reescribe pestañas de historial.
 */
async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    // Blindaje: historial pasado no se toca; siempre se regenera el mes actual.
    if (titulo !== mesActual && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[DG-F-04] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo «${mesActual}».`
        );
        titulo = mesActual;
    }

    console.warn(`[DG-F-04] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    // 1) Copiar a pestaña temporal (si falla, el historial queda intacto).
    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            spreadsheetId,
            tituloTmp,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron reaplicar anchos de plantilla:', err.message);
    }

    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets.find((h) => String(h.name || '').trim() === tituloTmp);
    if (!ws) {
        throw new Error(`No se encontró la hoja temporal «${tituloTmp}» tras copiar la plantilla.`);
    }
    let seccionesMap = mapearSeccionesEnHoja(ws);
    if (!seccionesMap.length) {
        throw new Error(`La plantilla copiada no tiene secciones FODA reconocibles («${tituloTmp}»).`);
    }

    // 2) Datos + merges B:E/F:H/I:J + Factores + fila de separación entre apartados.
    seccionesMap = await asegurarFilasSeccionesEnDrive(
        spreadsheetId,
        tituloTmp,
        datos,
        seccionesMap
    );
    await asegurarColumnasSistemaDrive(spreadsheetId, tituloTmp);
    const actualizaciones = datosAActualizacionesSheet(datos, seccionesMap, tituloTmp);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    seccionesMap = await recortarFilasSobrantesSecciones(
        spreadsheetId,
        tituloTmp,
        datos,
        seccionesMap
    );
    await finalizarDisenoYSeparadoresDgF04(spreadsheetId, tituloTmp, seccionesMap, datos);

    // 3) Reemplazar destino solo cuando la temporal ya está lista.
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[DG-F-04] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

/**
 * Escribe datos en la hoja vigente. Si faltan slots o la estructura está rota,
 * reescribe desde la plantilla externa en lugar de insertar filas a ciegas.
 */
async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    // Sync siempre sobre el mes actual; nunca sobre historial.
    const mesActual = nombreHojaMesActual();
    let titulo = String(sheetTitlePreferido || '').trim() || mesActual;
    if (titulo !== mesActual && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        titulo = mesActual;
    }

    let buffer;
    let wb;
    let wsActiva;
    try {
        buffer = await descargarBufferDrive(spreadsheetId);
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        // Solo la pestaña del mes actual; nunca caer al historial.
        wsActiva = wb.worksheets.find((h) => String(h.name || '').trim() === titulo) || null;
    } catch (err) {
        console.warn('[DG-F-04] No se pudo leer hoja del mes; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    if (!wsActiva) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const seccionesMap = mapearSeccionesEnHoja(wsActiva);
    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(
            `[DG-F-04] «${titulo}» no coincide con plantilla externa; se regenera.`
        );
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }
    if (!seccionesMap.length || seccionesRequierenExpansion(datos, seccionesMap)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    try {
        return await actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesMap, titulo);
    } catch (err) {
        console.warn('[DG-F-04] Sync celda falló; regenerando mes desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }
}

function totalFilasSecciones(datos) {
    return SECCION_ORDEN.reduce((acc, key) => {
        const filas = Array.isArray(datos?.[key]) ? datos[key] : [];
        return acc + filas.length;
    }, 0);
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    try {
        const buffer = await descargarBufferDrive(spreadsheetId);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const ws = excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, sheetTitle)
            || wb.worksheets.find((h) => String(h.name || '').trim() === String(sheetTitle || '').trim())
            || wb.worksheets[0];
        if (ws) {
            const seccionesMap = mapearSeccionesEnHoja(ws);
            if (seccionesMap.length) {
                await actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesMap, sheetTitle);
                return;
            }
        }
    } catch (err) {
        console.warn('[DG-F-04] Snapshot desde hoja destino falló, usando plantilla:', err.message);
    }

    const templateBuffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wbTpl = new ExcelJS.Workbook();
    await wbTpl.xlsx.load(templateBuffer);
    const wsTpl = obtenerHojaPlantillaDesdeWorkbook(wbTpl);
    if (!wsTpl) {
        throw new Error('No se pudo leer la plantilla para historial DG-F-04');
    }
    const seccionesTpl = mapearSeccionesEnHoja(wsTpl);
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesTpl, sheetTitle);
}

async function aplicarHistorialDgF04(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        hojasAEliminar: excelHistorial.HOJAS_CRITERIOS_DG_F04,
        contenidoEsEquivalente,
        estructuraEsEquivalente: (a, b) => excelHistorial.estructuraSeccionesDgF04Equivalente(
            a,
            b,
            SECCION_ORDEN
        ),
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        if (!id || id === excluirId || esArchivoProtegidoDrive(id)) {
            return false;
        }
        return name.startsWith(objetivo);
    });

    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[DG-F-04] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
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

async function resolverDriveFileId(registro) {
    // Archivo fijo de trabajo (historial Centro SGC).
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
 * Nunca reemplaza el archivo sistema ni la plantilla maestra (se perdería el historial).
 * Solo se usa como fallback extremo para archivos temporales.
 */
async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio && !esArchivoProtegidoDrive(driveFileIdPrevio)) {
        try {
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[DG-F-04] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    if (DRIVE_FILE_ID_SISTEMA) {
        const info = await driveService.obtenerInfoArchivo(DRIVE_FILE_ID_SISTEMA).catch(() => null);
        if (info?.id) {
            return info;
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );
}

/** Nombre de hoja del mes actual (DGF04-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo (TEMPLATE_DRIVE_ID)
 * al archivo sistema con el título indicado (sin borrar historial).
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[DG-F-04] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[DG-F-04] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan columnas L–N: Probabilidad / Consecuencia / Resultado).`
        );
    }
    return copiada.title;
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

async function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function datosSonEquivalentes(a, b) {
    return contenidoEsEquivalente(a, b);
}

/** Fecha que ve la pantalla: la de la última modificación, o la original si el formato no ha cambiado. */
function fechaElaboracionVisible(contenidoModificado, fechaModificacion, fechaOriginal) {
    const mod = formatearFechaIso(fechaModificacion);
    const original = formatearFechaIso(fechaOriginal);
    if (contenidoModificado && mod) return mod;
    return original || '';
}

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const base = sanitizarDatos(datos);
        delete base.revision;
        delete base.fechaRevision;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    const driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const datosDb = await leerDatosRegistro(registro);

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
            asegurarColumnasSistemaDrive(driveFileId).catch(() => {});
        } catch (err) {
            console.warn('[DG-F-04] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    // Solo se regenera la hoja del MES ACTUAL (DGF04-MMAA). El historial no se toca.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId) {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const existeMes = titulos.includes(tituloMes);
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloMes)
            : false;
        const driveConMenosFilas = !!(datos && datosDb
            && totalFilasSecciones(datosDb) > totalFilasSecciones(datos));

        if (!existeMes || !estructuraMesOk || driveConMenosFilas) {
            if (!existeMes) {
                console.warn(`[DG-F-04] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else if (!estructuraMesOk) {
                console.warn(`[DG-F-04] «${tituloMes}» no coincide con plantilla; se regenera.`);
            } else {
                console.warn('[DG-F-04] Drive con menos filas que BD; se regenera hoja del mes.');
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, tituloMes, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[DG-F-04] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        } else {
            // Reaplica merges B:E/F:H/I:J, Factores y filas de separación (sin regenerar historial).
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                const bufferMes = await descargarBufferDrive(driveFileId);
                const wbMes = new ExcelJS.Workbook();
                await wbMes.xlsx.load(bufferMes);
                const wsMes = wbMes.worksheets.find(
                    (h) => String(h.name || '').trim() === tituloMes
                );
                const mapaMes = wsMes ? mapearSeccionesEnHoja(wsMes) : [];
                if (mapaMes.length) {
                    await finalizarDisenoYSeparadoresDgF04(
                        driveFileId,
                        tituloMes,
                        mapaMes,
                        datos
                    );
                }
            } catch (designErr) {
                console.warn('[DG-F-04] No se pudo reaplicar diseño visual del mes:', designErr.message);
            }
        }
    }

    if (!datos) {
        datos = datosDb;
    }
    if (!datos) {
        datos = await leerDatosDesdePlantilla();
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
    return await construirRespuesta(registro, datos, archivoDrive);
}

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (nueva/actual hoja del mes), sin borrar pestañas de historial.
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

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datos.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema DG-F-04 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    // Limpia solo copias temporales; nunca plantilla ni sistema.
    await eliminarCopiasDriveTrabajo(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    let tituloHoja = titulos.includes(tituloMes) ? tituloMes : null;

    if (tituloHoja) {
        // Archiva la hoja del mes actual (estructura vieja) y trae la plantilla fresca.
        const aliasArchivo = excelHistorial.resolverAlias(CODIGO_FORMATO);
        const rev = String(datosPublicar.revision || '00').padStart(2, '0');
        try {
            await driveService.duplicarHojaGoogleSheet(
                driveId,
                tituloHoja,
                `${aliasArchivo}_r${rev}_prev`
            );
        } catch (err) {
            console.warn('[DG-F-04] No se pudo archivar hoja previa al adoptar plantilla:', err.message);
        }
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[DG-F-04] No se pudo eliminar hoja previa del mes:', err.message);
        }
    }

    tituloHoja = await adoptarPlantillaEnSistema(driveId, tituloMes);

    const buffer = await descargarBufferDrive(driveId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, tituloHoja)
        || wb.worksheets.find((h) => String(h.name || '').trim() === tituloHoja);
    const seccionesMap = ws ? mapearSeccionesEnHoja(ws) : [];
    if (!seccionesMap.length) {
        throw new Error(`No se mapearon secciones FODA en la hoja «${tituloHoja}» tras adoptar la plantilla.`);
    }

    const archivoDrive = await actualizarDatosEnGoogleSheet(
        driveId,
        datosPublicar,
        seccionesMap,
        tituloHoja
    );
    await resolverYCentrarEncabezadosDrive(driveId, tituloHoja);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return await construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

/** Serializa guardados: evita 2 syncs DG-F-04 compitiendo por la misma cuota Sheets. */
let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body, options = {}) {
    const ejecutar = () => guardarFormatoInterno(pool, body, options);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
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

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    // Solo root o Calidad pueden fijar la fecha. El resto conserva la que ya está en BD/Excel.
    const fechaManual = options.respetarFechaElaboracion
        ? formatearFechaIso(datosEntrada.fechaElaboracion)
        : '';
    const fechaVisiblePrevia = fechaElaboracionVisible(contenidoModificado, fechaModificacion, fechaOriginal);
    const fechaParaHoja = fechaManual || fechaVisiblePrevia;

    const fijarFechaElaboracionGuardada = () => {
        if (fechaManual) {
            if (contenidoModificado) {
                fechaModificacion = fechaManual;
            } else {
                fechaOriginal = fechaManual;
            }
        }
        datosGuardar.fechaElaboracion = fechaElaboracionVisible(
            contenidoModificado,
            fechaModificacion,
            fechaOriginal
        ) || fechaParaHoja;
    };

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const datosSinCambio = excelHistorial.adjuntarMetaHoja(
            { ...datosEntrada },
            excelHistorial.leerMetaHoja(datosPrevios)
        );
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return await construirRespuesta(registroPrevio, datosSinCambio, archivoDrive);
    }

    const driveId = registroPrevio?.drive_file_id || null;
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaParaHoja }
                    : datosEntrada;
                const hist = await aplicarHistorialDgF04({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = hist.datosGuardar;

                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    if (!fechaManual && hist.tipoCambio === 'formato') {
                        fechaModificacion = datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso();
                    }
                }

                fijarFechaElaboracionGuardada();

                // Volcar siempre a la hoja que abre el editor (DGF04-MMAA), nunca a FODA_rNN.
                let archivoDrive = null;
                try {
                    archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar);
                } catch (syncErr) {
                    console.warn('[DG-F-04] Sync hoja edición falló tras historial:', syncErr.message);
                }
                if (!archivoDrive) {
                    const tituloFallback = await resolverTituloHojaVigente(driveId);
                    await resolverYCentrarEncabezadosDrive(driveId, tituloFallback);
                    archivoDrive = await driveService
                        .obtenerInfoArchivo(driveId)
                        .catch(() => ({ id: driveId }));
                }
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return await construirRespuesta(registro, datosGuardar, archivoDrive);
            }
        } catch (err) {
            console.warn('[DG-F-04] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
        }
    }

    fijarFechaElaboracionGuardada();

    // Fallback: no reemplazar el archivo sistema. Adoptar plantilla en hoja del mes y volcar datos.
    const driveTrabajo = driveId || await resolverDriveFileId(registroPrevio);
    if (!driveTrabajo || driveTrabajo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo sincronizar DG-F-04: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[DG-F-04] Adoptar plantilla en fallback:', adoptErr.message);
    }
    const archivoDrive = await sincronizarHojaEdicionDrive(driveTrabajo, datosGuardar, tituloNuevo)
        || await driveService.obtenerInfoArchivo(driveTrabajo).catch(() => ({ id: driveTrabajo }));
    await resolverYCentrarEncabezadosDrive(driveTrabajo, tituloNuevo);

    await guardarRegistroDb(pool, {
        driveFileId: driveTrabajo,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(driveTrabajo, tituloNuevo).catch(() => null)
        ),
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return await construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    if (!registro?.drive_file_id) {
        return cargarFormato(pool);
    }

    const buffer = await descargarBufferDrive(registro.drive_file_id);
    const datosDrive = sanitizarDatos(await leerDatosDesdeBuffer(buffer, { modo: 'edicion' }));

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    let datosPrevios = null;
    if (registro.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registro.datos_json === 'string'
                    ? JSON.parse(registro.datos_json)
                    : registro.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registro.drive_file_id)
            .catch(() => null);
        return await construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialDgF04({
        spreadsheetId: registro.drive_file_id,
        datosPrevios,
        datosNuevos: datosDrive,
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = hist.tipoCambio === 'formato'
            ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
            : fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    await guardarRegistroDb(pool, {
        driveFileId: registro.drive_file_id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService
        .obtenerInfoArchivo(registro.drive_file_id)
        .catch(() => null);

    return await construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

/**
 * Hoja de trabajo del editor: siempre el mes actual (DGF04-MMAA).
 * El historial (meses anteriores) se conserva y no se usa como destino de sync.
 */
async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron listar hojas:', err.message);
    }

    if (titulos.some((t) => String(t).trim() === mesActual)) {
        return mesActual;
    }

    // Si aún no existe el mes, se reporta igual (cargar/guardar lo crearán).
    if (!titulos.length) {
        return mesActual;
    }

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) {
            // Solo para lectura/URL de respaldo; sync escribe en mesActual.
            return nombre;
        }
    } catch (err) {
        console.warn('[DG-F-04] No se pudo resolver hoja vigente:', err.message);
    }

    if (titulos.some((t) => String(t).trim() === SHEET_TITLE)) {
        return SHEET_TITLE;
    }

    return titulos[0] || mesActual;
}

async function editorUrlConHojaVigente(driveId) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId) {
        return null;
    }
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return `${base}&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[DG-F-04] No se pudo armar URL del editor:', err.message);
    }
    return base;
}

/**
 * Exporta el Google Sheet vigente a PDF.
 * Antes del export se re-centran los títulos de sección (Fortalezas, etc.).
 */
async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet DG-F-04 configurado para exportar a PDF.');
    }

    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[DG-F-04] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja vigente «${tituloHoja}» para exportar a PDF.`);
    }

    // Asegura centrado de Fortalezas/Debilidades/Amenazas/Oportunidades en la hoja a exportar.
    await resolverYCentrarEncabezadosDrive(driveFileId, tituloHoja);

    // Carta vertical, ajustar a la página, márgenes normales, centrado / arriba (como Sheets).
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: false,
        fitToPage: true,
        size: 'letter',
        margins: 'normales',
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'TOP'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de DG-F-04 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    sanitizarDatos
};
