/**
 * SGC-F-25 · Actividades posteriores a la entrega.
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF25-MMAA / _N + histograma).
 * Patrón: docs/GUIA-PLANTILLA-EXCEL-SGC.md / sgcDgF05Service / sgcF03Service.
 *
 * Tabla: No. contrato/cotización | Cliente | Actividad | Descripción | Fecha compromiso |
 *   Responsable(s) | Categorías 1..5 (marca X).
 * Sin archivero.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-25';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1kaE2ZDm2Za6PdZLEJMWyoBnj6TP2fkoc17W0sasleEM
 */
const TEMPLATE_DRIVE_ID = '1kaE2ZDm2Za6PdZLEJMWyoBnj6TP2fkoc17W0sasleEM';
/**
 * Archivo de trabajo Centro SGC (historial SGCF25-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1tXQx1lxhdHas40sS2tF97HoBOypwGP8Qjfrv5aM41Mk
 */
const DRIVE_FILE_ID_SISTEMA = '1tXQx1lxhdHas40sS2tF97HoBOypwGP8Qjfrv5aM41Mk';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-25 Actividades posteriores a la entrega (Sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Alias legado (misma hoja en plantilla antigua del sistema). */
const TEMPLATE_SHEET_TITLE_LEGACY = 'Plantilla.';
/** Fallback de resolución de hoja; el trabajo real usa SGCF25-MMAA(_N). */
const SHEET_TITLE = 'Plantilla';
const MAX_COLUMNAS_SISTEMA = 11;

/** Nombre base del mes actual (SGCF25-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

// Encabezados de tabla en fila 6; los datos comienzan en fila 7.
const HEADER_ROW = 6;
const DATA_START_ROW = 7;
const MAX_FILAS = 60;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;
/** Posición fija antigua de la leyenda (tras las 60 filas vacías); se limpia al reubicar. */
const LEYENDA_FILA_LEGACY = DATA_END_ROW + 2;

const COLUMNAS = {
    noContrato: 1,   // A
    cliente: 2,      // B
    actividad: 3,    // C
    descripcion: 4,  // D
    fechaCompromiso: 5, // E
    responsables: 6, // F
    cat1: 7,         // G
    cat2: 8,         // H
    cat3: 9,         // I
    cat4: 10,        // J
    cat5: 11         // K
};

const CATEGORIAS = [
    { id: 1, label: 'Requisito legal o reglamentario' },
    { id: 2, label: 'Consecuencia potencial no deseada asociada a los productos o servicios' },
    { id: 3, label: 'Naturaleza, uso y vida útil de los productos y servicios' },
    { id: 4, label: 'Requisito del cliente' },
    { id: 5, label: 'Retroalimentación del cliente' }
];

const LEYENDA_NUM_FILAS = CATEGORIAS.length;

const ACTIVIDADES_VALIDAS = [
    'Garantía',
    'Obligaciones contractuales',
    'Servicio de mantenimiento',
    'Reciclaje',
    'Disposición final',
    'Otra'
];

const ACTIVIDAD_DEFECTO = {
    noContrato: '',
    cliente: '',
    actividad: '',
    descripcion: '',
    fechaCompromiso: '',
    responsables: '',
    categorias: [false, false, false, false, false]
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-20',
    fechaRevision: '2025-01-20',
    revision: '00',
    actividades: []
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
    celda.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    celda.font = {
        ...(celda.font || {}),
        name: 'Century Gothic',
        size: 11
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f || f.length < 10) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${String(y).slice(-2)}`;
}

function esMarcaCategoria(valor) {
    const t = String(valor || '').trim().toLowerCase();
    if (!t) return false;
    return t === 'x' || t === 'sí' || t === 'si' || t === '1' || t === 'true'
        || t === '✓' || t === '✔' || t === '●' || t === '•';
}

function marcaDesdeBooleano(activo) {
    return activo ? 'X' : '';
}

function sanitizarCategorias(raw) {
    const base = Array.isArray(raw) ? raw : [];
    return [0, 1, 2, 3, 4].map((i) => {
        const v = base[i];
        if (typeof v === 'boolean') return v;
        return esMarcaCategoria(v);
    });
}

function normalizarTextoComparacion(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizarActividadOpcion(valor) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const clave = normalizarTextoComparacion(limpio);
    const encontrado = ACTIVIDADES_VALIDAS.find((op) => normalizarTextoComparacion(op) === clave);
    return encontrado || '';
}

function sanitizarActividad(item) {
    return {
        noContrato: String(item?.noContrato || '').trim(),
        cliente: String(item?.cliente || '').trim(),
        actividad: normalizarActividadOpcion(item?.actividad),
        descripcion: String(item?.descripcion || '').trim(),
        fechaCompromiso: formatearFechaIso(item?.fechaCompromiso),
        responsables: String(item?.responsables || '').trim(),
        categorias: sanitizarCategorias(item?.categorias)
    };
}

function esActividadVacia(item) {
    const a = sanitizarActividad(item);
    const tieneCat = a.categorias.some(Boolean);
    return !a.noContrato && !a.cliente && !a.actividad && !a.descripcion
        && !a.fechaCompromiso && !a.responsables && !tieneCat;
}

function textoCoincideLeyenda(texto, catId) {
    const t = String(texto || '').toLowerCase();
    if (!t) return false;
    const esperado = CATEGORIAS[catId - 1]?.label || '';
    if (esperado && t.includes(String(esperado).toLowerCase().slice(0, 20))) return true;
    return CATEGORIAS.some((cat) => t.includes(String(cat.label).toLowerCase().slice(0, 20)));
}

function esFilaLeyendaCategorias(row) {
    const a = celdaATexto(row.getCell(1).value);
    const b = celdaATexto(row.getCell(2).value);
    const c = celdaATexto(row.getCell(3).value);
    // Formato unificado: "1. Requisito…" en columna A
    const m = String(a).match(/^(\d+)\.\s+(.+)$/);
    if (m) {
        const n = Number(m[1]);
        if (Number.isInteger(n) && n >= 1 && n <= 5 && textoCoincideLeyenda(m[2], n)) {
            return true;
        }
    }
    // Formato legado: número en B, texto en C
    if (a) return false;
    const n = Number(b);
    if (!Number.isInteger(n) || n < 1 || n > 5) return false;
    return textoCoincideLeyenda(c, n);
}

function textoLeyendaCategoria(cat) {
    return `${cat.id}. ${cat.label}`;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const actividades = Array.isArray(base.actividades) ? base.actividades : [];
    const fechaElaboracion = formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion;
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        actividades: actividades
            .map(sanitizarActividad)
            .filter((a) => !esActividadVacia(a))
            .slice(0, MAX_FILAS)
    };
}

function leerActividadesDesdeHoja(ws) {
    const actividades = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        if (esFilaLeyendaCategorias(row)) {
            continue;
        }
        const fila = sanitizarActividad({
            noContrato: celdaATexto(row.getCell(COLUMNAS.noContrato).value),
            cliente: celdaATexto(row.getCell(COLUMNAS.cliente).value),
            actividad: celdaATexto(row.getCell(COLUMNAS.actividad).value),
            descripcion: celdaATexto(row.getCell(COLUMNAS.descripcion).value),
            fechaCompromiso: celdaATexto(row.getCell(COLUMNAS.fechaCompromiso).value),
            responsables: celdaATexto(row.getCell(COLUMNAS.responsables).value),
            categorias: [
                esMarcaCategoria(celdaATexto(row.getCell(COLUMNAS.cat1).value)),
                esMarcaCategoria(celdaATexto(row.getCell(COLUMNAS.cat2).value)),
                esMarcaCategoria(celdaATexto(row.getCell(COLUMNAS.cat3).value)),
                esMarcaCategoria(celdaATexto(row.getCell(COLUMNAS.cat4).value)),
                esMarcaCategoria(celdaATexto(row.getCell(COLUMNAS.cat5).value))
            ]
        });
        if (!esActividadVacia(fila)) {
            actividades.push(fila);
        }
    }
    return actividades;
}

function parsearDatosDesdeHoja(ws) {
    return sanitizarDatos({
        revision: DATOS_DEFECTO.revision,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: DATOS_DEFECTO.fechaRevision,
        actividades: leerActividadesDesdeHoja(ws)
    });
}

function escribirFilaActividad(row, item) {
    const a = sanitizarActividad(item);
    asignarTextoSimple(row.getCell(COLUMNAS.noContrato), a.noContrato, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.cliente), a.cliente, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.actividad), a.actividad, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.descripcion), a.descripcion, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.fechaCompromiso), formatearFechaDisplay(a.fechaCompromiso), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.responsables), a.responsables, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.cat1), marcaDesdeBooleano(a.categorias[0]), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.cat2), marcaDesdeBooleano(a.categorias[1]), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.cat3), marcaDesdeBooleano(a.categorias[2]), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.cat4), marcaDesdeBooleano(a.categorias[3]), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.cat5), marcaDesdeBooleano(a.categorias[4]), 'center');
}

/**
 * Leyenda pegada a la tabla (1 fila en blanco de separación) para que el PDF
 * no deje páginas vacías entre datos y el listado 1..5.
 */
function resolverFilaInicioLeyenda(numActividades) {
    const n = Math.max(0, Math.min(MAX_FILAS, Number(numActividades) || 0));
    const ultimaFilaDatos = n > 0
        ? DATA_START_ROW + n - 1
        : DATA_START_ROW;
    return ultimaFilaDatos + 2;
}

function resolverUltimaFilaImpresion(numActividades) {
    return resolverFilaInicioLeyenda(numActividades) + LEYENDA_NUM_FILAS - 1;
}

function limpiarCeldasLeyendaEnFila(row) {
    for (const col of [1, 2, 3]) {
        const celda = row.getCell(col);
        celda.value = '';
        celda.border = {};
        celda.font = {
            name: 'Century Gothic',
            size: 11
        };
        celda.alignment = {
            horizontal: 'left',
            vertical: 'middle',
            wrapText: true
        };
    }
}

function limpiarFilaActividad(row) {
    for (let col = 1; col <= 11; col++) {
        const celda = row.getCell(col);
        celda.value = '';
        celda.border = {};
        celda.font = {
            name: 'Century Gothic',
            size: 11
        };
        celda.alignment = {
            horizontal: 'left',
            vertical: 'middle',
            wrapText: true
        };
    }
}

function escribirLeyendaCategorias(ws, filaInicio) {
    for (let i = 0; i < CATEGORIAS.length; i++) {
        const row = ws.getRow(filaInicio + i);
        // Una sola celda «N. texto» alineada a la izquierda (evita números desalineados).
        const celda = row.getCell(1);
        celda.value = textoLeyendaCategoria(CATEGORIAS[i]);
        celda.border = {};
        celda.font = { name: 'Century Gothic', size: 11 };
        celda.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        for (const col of [2, 3]) {
            const vacia = row.getCell(col);
            vacia.value = '';
            vacia.border = {};
        }
    }
}

function limpiarZonaLeyendaHoja(ws, desdeFila, hastaFila) {
    const desde = Math.max(1, Number(desdeFila) || 1);
    const hasta = Math.max(desde, Number(hastaFila) || desde);
    for (let r = desde; r <= hasta; r++) {
        limpiarCeldasLeyendaEnFila(ws.getRow(r));
    }
}

function escribirActividadesEnHoja(ws, actividadesRaw) {
    const actividades = Array.isArray(actividadesRaw) ? actividadesRaw : [];
    const n = Math.min(actividades.length, MAX_FILAS);
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        if (i < n) {
            escribirFilaActividad(ws.getRow(rowNum), actividades[i]);
        } else {
            limpiarFilaActividad(ws.getRow(rowNum));
        }
    }
    // Limpia leyenda legacy (fila 68+) y cualquier residuo entre datos y esa zona.
    const leyendaInicio = resolverFilaInicioLeyenda(n);
    const clearDesde = DATA_START_ROW + n;
    const clearHasta = LEYENDA_FILA_LEGACY + LEYENDA_NUM_FILAS - 1;
    limpiarZonaLeyendaHoja(ws, clearDesde, clearHasta);
    escribirLeyendaCategorias(ws, leyendaInicio);
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    escribirActividadesEnHoja(ws, d.actividades);
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

function datosAActualizacionesSheet(datos, sheetTitle) {
    const d = sanitizarDatos(datos);
    const n = d.actividades.length;
    const actualizaciones = [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const a = i < n ? d.actividades[i] : { ...ACTIVIDAD_DEFECTO, categorias: [false, false, false, false, false] };
        const cats = sanitizarCategorias(a.categorias);
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.noContrato)}${rowNum}`, sheetTitle), values: [[a.noContrato || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cliente)}${rowNum}`, sheetTitle), values: [[a.cliente || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.actividad)}${rowNum}`, sheetTitle), values: [[a.actividad || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.descripcion)}${rowNum}`, sheetTitle), values: [[a.descripcion || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.fechaCompromiso)}${rowNum}`, sheetTitle), values: [[formatearFechaDisplay(a.fechaCompromiso)]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.responsables)}${rowNum}`, sheetTitle), values: [[a.responsables || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cat1)}${rowNum}`, sheetTitle), values: [[marcaDesdeBooleano(cats[0])]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cat2)}${rowNum}`, sheetTitle), values: [[marcaDesdeBooleano(cats[1])]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cat3)}${rowNum}`, sheetTitle), values: [[marcaDesdeBooleano(cats[2])]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cat4)}${rowNum}`, sheetTitle), values: [[marcaDesdeBooleano(cats[3])]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cat5)}${rowNum}`, sheetTitle), values: [[marcaDesdeBooleano(cats[4])]] });
    }
    // Limpia leyenda anterior (posición fija o dinámica) y reescribe junto a la tabla.
    const clearDesde = DATA_START_ROW + n;
    const clearHasta = LEYENDA_FILA_LEGACY + LEYENDA_NUM_FILAS - 1;
    for (let rowNum = clearDesde; rowNum <= clearHasta; rowNum++) {
        actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [['']] });
    }
    const leyendaInicio = resolverFilaInicioLeyenda(n);
    for (let i = 0; i < CATEGORIAS.length; i++) {
        const rowNum = leyendaInicio + i;
        actualizaciones.push({
            range: rangoSheet(`A${rowNum}`, sheetTitle),
            values: [[textoLeyendaCategoria(CATEGORIAS[i])]]
        });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [['']] });
    }
    return actualizaciones;
}

function esTituloPlantillaF25(titulo) {
    const t = String(titulo || '').trim().toLowerCase().replace(/\.$/, '');
    return !t || t === 'plantilla' || t.startsWith('_tmp_');
}

/** Legado: SGCF25-DDMM-NN (p. ej. SGCF25-1009-01). */
function esHojaHistorialLegadoF25(titulo) {
    return /^SGCF25-\d{4}-\d{2}$/i.test(String(titulo || '').trim());
}

function parsearHojaHistorialLegadoF25(titulo) {
    const m = String(titulo || '').trim().match(/^SGCF25-(\d{2})(\d{2})-(\d{2})$/i);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const nn = Number(m[3]);
    if (![dd, mm, nn].every((n) => Number.isFinite(n))) return null;
    return { dd, mm, nn, sortKey: mm * 1000000 + dd * 1000 + nn };
}

function esNombreHojaHistorial(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return false;
    if (excelHistorial.esHojaHistorialInformacion(t, CODIGO_FORMATO)) return true;
    return esHojaHistorialLegadoF25(t);
}

function listarHojasHistorialOrdenadas(titulos) {
    return (Array.isArray(titulos) ? titulos : [])
        .map((titulo) => {
            const t = String(titulo || '').trim();
            const metaMmaa = excelHistorial.parsearFechaHojaHistorial(t, CODIGO_FORMATO);
            if (metaMmaa) {
                return { titulo: t, sortKey: metaMmaa.sortKey };
            }
            const legado = parsearHojaHistorialLegadoF25(t);
            if (legado) {
                // Prioridad menor que MMAA del mismo mes aproximado.
                return { titulo: t, sortKey: legado.sortKey };
            }
            return null;
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

/** Última versión del mes: SGCF25-1026_3 > SGCF25-1026_2 > SGCF25-1026. */
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

/**
 * Última hoja de historial con actividades. Si todas están vacías, la más reciente.
 */
function resolverHojaLecturaDesdeWorkbook(wb) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;

    const historiales = listarHojasHistorialOrdenadas(lista.map((ws) => ws.name));
    for (const item of historiales) {
        const ws = hojaPorTituloEnWorkbook(wb, item.titulo);
        if (!ws) continue;
        const actividades = leerActividadesDesdeHoja(ws);
        if (actividades.length > 0) {
            return ws;
        }
    }
    if (historiales[0]) {
        const wsVacia = hojaPorTituloEnWorkbook(wb, historiales[0].titulo);
        if (wsVacia) return wsVacia;
    }
    return hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE_LEGACY)
        || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        || lista[0];
}

function hojaPorTituloEnWorkbook(wb, titulo) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    const buscado = String(titulo || '').trim();
    if (!buscado) return null;
    return lista.find((ws) => String(ws.name || '').trim() === buscado)
        || lista.find((ws) => String(ws.name || '').trim().toLowerCase() === buscado.toLowerCase())
        || null;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    void modo;
    return resolverHojaLecturaDesdeWorkbook(wb);
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-25 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

/**
 * Lee Drive priorizando hojas SGCF25-MMAA(_N) / legado DDMM con datos
 * (nunca Plantilla si hay historial con info).
 */
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
        console.warn('[SGC-F-25] No se pudieron listar hojas en Drive:', err.message);
        titulos = (wb.worksheets || []).map((ws) => ws.name);
    }

    const historiales = listarHojasHistorialOrdenadas(titulos);
    for (const item of historiales) {
        const ws = hojaPorTituloEnWorkbook(wb, item.titulo);
        if (!ws) continue;
        const datos = sanitizarDatos(parsearDatosDesdeHoja(ws));
        if (datos.actividades.length) {
            return datos;
        }
    }

    // Sin historial con datos: intentar Plantilla solo como último recurso.
    const wsPlantilla = hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE_LEGACY)
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
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE_LEGACY)
        || (wb.worksheets || [])[0];
    if (!ws) throw new Error('La plantilla SGC-F-25 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function resolverTituloPlantillaExterna() {
    const titulos = await driveService.listarHojasGoogleSheet(TEMPLATE_DRIVE_ID).catch(() => []);
    const lista = (titulos || []).map((t) => String(t || '').trim()).filter(Boolean);
    const exacta = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase());
    if (exacta) return exacta;
    const legado = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE_LEGACY.toLowerCase());
    if (legado) return legado;
    if (lista.length) return lista[0];
    throw new Error(
        `No se encontró la hoja «${TEMPLATE_SHEET_TITLE}» en la plantilla SGC-F-25 `
        + `(${TEMPLATE_DRIVE_ID}).`
    );
}

/** Valida cabeceras A6 típicas de la plantilla SGC-F-25. */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!A${HEADER_ROW}:F${HEADER_ROW}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const contrato = String(row[0] || '').toLowerCase();
        const cliente = String(row[1] || '').toLowerCase();
        const actividad = String(row[2] || '').toLowerCase();
        return (contrato.includes('contrato') || contrato.includes('cotiz'))
            && cliente.includes('cliente')
            && actividad.includes('actividad');
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia «Plantilla» del archivo plantilla externo → sistema como SGCF25-MMAA(_N).
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar plantilla sobre el archivo plantilla SGC-F-25.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    const origenTitulo = await resolverTituloPlantillaExterna();
    console.warn(
        `[SGC-F-25] Copiando hoja «${origenTitulo}» desde plantilla `
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
        console.warn('[SGC-F-25] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados Contrato / Cliente / Actividad).`
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
        throw new Error('No se puede regenerar sobre el archivo plantilla SGC-F-25.');
    }
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-25] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-25] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-25] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
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
        throw new Error('No se puede sincronizar sobre el archivo plantilla SGC-F-25.');
    }
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo) || esTituloPlantillaF25(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[SGC-F-25] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-25] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-25] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const historicas = listarHojasHistorialOrdenadas(titulos)
        .filter((item) => !esTituloPlantillaF25(item.titulo));
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
        console.warn('[SGC-F-25] No se pudo resolver hoja vigente:', err.message);
    }

    // Sin historial MMAA/legado: el mes actual se creará desde la plantilla externa.
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
        console.warn('[SGC-F-25] No se pudo resolver gid editor:', err.message);
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

async function aplicarFormatoVisualSgcF25(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    const numFilas = d.actividades.length;
    const leyendaInicio = resolverFilaInicioLeyenda(numFilas);
    try {
        await driveService.aplicarFormatoFilasSgcF25(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW,
            leyendaInicio,
            LEYENDA_NUM_FILAS
        );
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF25(spreadsheetId, titulo, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-25 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(sanitizarDatos(a).actividades) === JSON.stringify(sanitizarDatos(b).actividades);
}

function estructuraEsEquivalente() {
    // Agregar/quitar actividades es captura normal de información.
    return true;
}

/**
 * SGC-F-25 solo usa pestañas SGCF25-MMAA / SGCF25-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes (_2, _3…).
 */
async function aplicarHistorialSgcF25(opciones) {
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

/**
 * Elimina pestañas Alias_r* residuales. Conserva SGCF25-MMAA(_N), legado e histograma.
 */
async function eliminarHojasHistorialFormatoSgcF25(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-25] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && patronAlias.test(nombre);
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-25] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-25] No se pudieron eliminar pestañas Alias_r*:', err.message);
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
            console.warn('[SGC-F-25] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) return false;
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
    if (!spreadsheetId) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-25] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-25] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA]
        .filter(Boolean)
        .map((id) => String(id).trim())
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
        throw new Error('No hay archivo SGC-F-25 configurado en Drive.');
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
                console.warn('[SGC-F-25] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 11, keepSingleSheet: false }
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
        plantillaDriveId: TEMPLATE_DRIVE_ID,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
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
            console.warn('[SGC-F-25] No se pudo restaurar Google Sheet al cargar:', err.message);
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
            console.warn('[SGC-F-25] No se pudo leer archivo en Drive, usando BD:', err.message);
        }
    }

    // Fuente de verdad del sistema: BD. Drive solo recupera si la BD está vacía.
    if (datosDb?.actividades?.length) {
        datos = datosDb;
    } else if (datosDrive?.actividades?.length) {
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
            console.log(`[SGC-F-25] BD restaurada desde Drive (${datos.actividades.length} actividades).`);
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo restaurar BD desde Drive:', err.message);
        }
    } else {
        datos = datosDb || datosDrive || null;
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoSgcF25(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[SGC-F-25] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[SGC-F-25] «${destino}» no coincide con plantilla; se regenera.`);
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[SGC-F-25] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        } else if (!datos) {
            datos = datosDb || sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
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
            console.warn('[SGC-F-25] No se pudo asegurar permiso de enlace:', err.message);
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
    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveId) {
        try {
            driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo asegurar Google Sheet:', err.message);
        }
    }

    // Protección: no permitir que un guardado vacío (p. ej. refresh) borre el último trabajo.
    const previosEfectivos = datosPrevios || sanitizarDatos(DATOS_DEFECTO);
    if (!body?.vaciar && datosEntrada.actividades.length === 0) {
        let datosConservar = previosEfectivos.actividades.length ? previosEfectivos : null;
        if (!datosConservar && driveId && driveId !== TEMPLATE_DRIVE_ID) {
            try {
                const desdeDrive = await leerDatosDesdeDriveConfiable(driveId);
                if (desdeDrive.actividades.length) {
                    datosConservar = desdeDrive;
                }
            } catch (err) {
                console.warn('[SGC-F-25] No se pudo validar Drive ante guardado vacío:', err.message);
            }
        }
        if (datosConservar?.actividades?.length) {
            const archivoDrive = driveId
                ? await driveService.obtenerInfoArchivo(driveId).catch(() => null)
                : null;
            if (!datosPrevios?.actividades?.length) {
                try {
                    await guardarRegistroDb(pool, {
                        driveFileId: driveId || registroPrevio?.drive_file_id,
                        datos: datosConservar,
                        fechaElaboracionOriginal: fechaOriginal,
                        fechaModificacionContenido: fechaHoyIso(),
                        contenidoModificado: true
                    });
                } catch (_) { /* ignore */ }
            }
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(
                { ...(registro || registroPrevio || {}), drive_file_id: driveId || registroPrevio?.drive_file_id },
                datosConservar,
                archivoDrive
            );
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
            await eliminarHojasHistorialFormatoSgcF25(driveId);
            const fechaCambio = fechaHoyIso();
            const datosHistorial = origen !== 'consulta'
                ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                : datosEntrada;
            const hist = await aplicarHistorialSgcF25({
                spreadsheetId: driveId,
                datosPrevios: datosPrevios || sanitizarDatos(DATOS_DEFECTO),
                datosNuevos: datosHistorial,
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;

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
            if (!tituloSync || esTituloPlantillaF25(tituloSync) || !esNombreHojaHistorial(tituloSync)) {
                tituloSync = await resolverTituloHojaVigente(driveId);
            }
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
            } catch (syncErr) {
                console.warn('[SGC-F-25] Sync hoja edición falló tras historial:', syncErr.message);
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
            console.warn('[SGC-F-25] No se pudo actualizar Google Sheet:', err.message);
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
        throw new Error('No se pudo sincronizar SGC-F-25: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo) || esTituloPlantillaF25(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[SGC-F-25] Adoptar plantilla en fallback:', adoptErr.message);
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

    // Nunca sobrescribir BD con un Drive vacío si ya había información.
    if (!datosDrive.actividades.length && datosPrevios?.actividades?.length) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(
            { ...registro, drive_file_id: driveFileId },
            datosPrevios,
            archivoDrive
        );
    }

    if (datosPrevios && contenidoEsEquivalente(datosPrevios, datosDrive)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaElaboracion
        || fechaHoyIso();
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialSgcF25({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });
    const datosGuardar = hist.datosGuardar;
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

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-25 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* ignore */ }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
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

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datos.fechaElaboracion
        || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema SGC-F-25 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoSgcF25(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo eliminar hoja previa del mes:', err.message);
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

/**
 * PDF: hoja actual, Carta, horizontal, márgenes normales, escala 84%.
 * Reubica la leyenda junto a la tabla y limita el rango de impresión
 * para evitar hojas en blanco y texto flotando solo.
 */
async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-25 para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    let datos = await leerDatosRegistro(registro);
    if (!datos?.actividades?.length) {
        try {
            datos = await leerDatosDesdeDriveConfiable(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-25] PDF: no se pudieron leer datos de Drive:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    } else {
        datos = sanitizarDatos(datos);
    }

    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
    // Asegura leyenda pegada a la tabla antes de exportar (corrige hojas ya guardadas).
    try {
        await actualizarDatosEnGoogleSheet(driveFileId, datos, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-25] PDF: no se pudo reubicar leyenda antes de exportar:', err.message);
    }

    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }

    const ultimaFila = resolverUltimaFilaImpresion(datos.actividades.length);
    // r1/r2 son 0-based exclusivos en el extremo superior → r2 = última fila 1-based.
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        size: 'letter',
        margins: 'normal',
        scalePercent: 84,
        verticalAlignment: 'TOP',
        horizontalAlignment: 'CENTER',
        range: {
            r1: 0,
            r2: ultimaFila,
            c1: 0,
            c2: 11
        }
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-25 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    sanitizarDatos,
    CATEGORIAS,
    ACTIVIDADES_VALIDAS
};
