/**
 * DG-F-04 · Análisis FODA — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'DG-F-04';
const TEMPLATE_DRIVE_ID = '1SMkPlfUpFctTjesbStrD7P_t9Q5fA_tG';
const CARPETA_DRIVE_ID = '1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4';
const NOMBRE_ARCHIVO_DRIVE = 'DG-F-04 Análisis FODA (sistema)';
const SHEET_TITLE = 'Analisis FODA';
/** Columnas A–N: datos FODA (A–J) + matriz de riesgos/oportunidades (K–N). */
const MAX_COLUMNAS_SISTEMA = 14;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: true
};

const REVISION_ROW = 2;
const FECHA_REV_ROW = 3;
const REVISION_COL = 9;
const META_ROW = 7;
const META_COL = { empresa: 3, fecha: 9 };
const COL = { factor: 2, responsable: 6, seguimiento: 9 };
const COL_FIRMA = 5;
/** Rangos de columnas fusionadas en la plantilla Excel. */
const COL_GRUPO = {
    factor: [2, 3, 4, 5],
    responsable: [6, 7, 8],
    seguimiento: [9, 10]
};
/** Columnas L–N: matriz de riesgos (Probabilidad, Consecuencia o Impacto, Resultado). K queda vacía en plantilla sistema. */
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
    row.getCell(11).value = null;
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

function encontrarFilaNota(ws) {
    for (let r = 1; r <= ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL.factor).value).toLowerCase();
        if (txt.startsWith('nota 2')) return r;
    }
    return 46;
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
        sec.dataEnd = idx < found.length - 1 ? found[idx + 1].headerRow - 1 : filaNota - 1;
    });
    return found;
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

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla DG-F-04 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
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

function recortarColumnasSistema(ws) {
    const total = Number(ws.columnCount || ws.actualColumnCount || 0);
    if (total <= MAX_COLUMNAS_SISTEMA) {
        return;
    }
    ws.spliceColumns(MAX_COLUMNAS_SISTEMA + 1, total - MAX_COLUMNAS_SISTEMA);
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla DG-F-04 no contiene hojas.');

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
            asignarGrupoSimple(row, COL_GRUPO.factor, fila.factor, 'left');
            asignarGrupoSimple(row, COL_GRUPO.responsable, fila.responsable, 'center');
            asignarGrupoMultilinea(row, COL_GRUPO.seguimiento, fila.seguimiento, 'left');
            asignarMatrizFila(row, sec.key, fila);
        });
    }

    escribirFirma(ws, datos.autorizo);
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
        const maxFilas = Math.max(filas.length, sec.dataEnd - sec.dataStart + 1);
        for (let idx = 0; idx < maxFilas; idx++) {
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
            actualizaciones.push({
                range: rangoSheet(`B${rowNum}:E${rowNum}`, sheetTitle),
                values: [[fila.factor]]
            });
            actualizaciones.push({
                range: rangoSheet(`F${rowNum}:H${rowNum}`, sheetTitle),
                values: [[fila.responsable]]
            });
            actualizaciones.push({
                range: rangoSheet(`I${rowNum}:J${rowNum}`, sheetTitle),
                values: [[normalizarSaltosLinea(fila.seguimiento)]]
            });
            actualizaciones.push({
                range: rangoSheet(`K${rowNum}`, sheetTitle),
                values: [['']]
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

async function asegurarColumnasSistemaDrive(spreadsheetId) {
    if (!spreadsheetId) {
        return;
    }
    try {
        await driveService.recortarColumnasGoogleSheet(spreadsheetId, DRIVE_SHEET_OPTIONS);
    } catch (err) {
        console.warn('[DG-F-04] No se pudieron recortar columnas O+ en Drive:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesMap, sheetTitle = SHEET_TITLE) {
    const actualizaciones = datosAActualizacionesSheet(datos, seccionesMap, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    if (sheetTitle === SHEET_TITLE) {
        await asegurarColumnasSistemaDrive(spreadsheetId);
    }
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) {
        throw new Error('No se pudo leer la plantilla para historial DG-F-04');
    }
    const seccionesMap = mapearSeccionesEnHoja(ws);
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, seccionesMap, sheetTitle);
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

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        return id && id !== excluirId && name.startsWith(objetivo);
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
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
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
            console.warn('[DG-F-04] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[DG-F-04] No se pudo eliminar duplicado en Drive:', err.message);
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
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

function construirRespuesta(registro, datos, archivoDrive) {
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
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
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

    if (!datos) {
        datos = await leerDatosRegistro(registro);
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
    return construirRespuesta(registro, datos, archivoDrive);
}

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

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[DG-F-04] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await eliminarCopiasDriveTrabajo();

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );
    await asegurarColumnasSistemaDrive(archivoDrive.id);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
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

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const datosSinCambio = excelHistorial.adjuntarMetaHoja(
            { ...datosEntrada },
            excelHistorial.leerMetaHoja(datosPrevios)
        );
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registroPrevio, datosSinCambio, archivoDrive);
    }

    const driveId = registroPrevio?.drive_file_id || null;
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
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
                    fechaModificacion = hist.tipoCambio === 'formato'
                        ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
                        : fechaCambio;
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                if (!hist.aplicado) {
                    const buffer = await descargarBufferDrive(driveId);
                    const wb = new ExcelJS.Workbook();
                    await wb.xlsx.load(buffer);
                    const wsActiva = excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE);
                    const seccionesMap = mapearSeccionesEnHoja(wsActiva);
                    if (seccionesMap.length) {
                        const archivoDrive = await actualizarDatosEnGoogleSheet(
                            driveId,
                            datosGuardar,
                            seccionesMap
                        );
                        await guardarRegistroDb(pool, {
                            driveFileId: driveId,
                            datos: datosGuardar,
                            fechaElaboracionOriginal: fechaOriginal,
                            fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                            contenidoModificado
                        });
                        const registro = await obtenerRegistroDb(pool);
                        return construirRespuesta(registro, datosGuardar, archivoDrive);
                    }
                } else {
                    const archivoDrive = await driveService
                        .obtenerInfoArchivo(driveId)
                        .catch(() => ({ id: driveId }));
                    await guardarRegistroDb(pool, {
                        driveFileId: driveId,
                        datos: datosGuardar,
                        fechaElaboracionOriginal: fechaOriginal,
                        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                        contenidoModificado
                    });
                    const registro = await obtenerRegistroDb(pool);
                    return construirRespuesta(registro, datosGuardar, archivoDrive);
                }
            }
        } catch (err) {
            console.warn('[DG-F-04] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);
    await asegurarColumnasSistemaDrive(archivoDrive.id);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(archivoDrive.id, SHEET_TITLE)
        ),
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
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
        return construirRespuesta(registro, datosDrive, archivoDrive);
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

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
