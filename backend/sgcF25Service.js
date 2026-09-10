/**
 * SGC-F-25 · Actividades posteriores a la entrega — persistencia en biznaga_sgc y sync con Drive.
 *
 * Tabla simple: cada renglón es una actividad con columnas
 *   No. contrato/cotización | Cliente | Actividad | Descripción | Fecha compromiso |
 *   Responsable(s) | Categorías 1..5 (marca X).
 * Sin archivero, sin firma ni PDF firmado.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-25';
const TEMPLATE_DRIVE_ID = '1tXQx1lxhdHas40sS2tF97HoBOypwGP8Qjfrv5aM41Mk';
const DRIVE_FILE_ID_SISTEMA = '1tXQx1lxhdHas40sS2tF97HoBOypwGP8Qjfrv5aM41Mk';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-25 Actividades posteriores a la entrega (Sistema)';
const SHEET_TITLE = 'Plantilla.';

// Encabezados de tabla en fila 6; los datos comienzan en fila 7.
const HEADER_ROW = 6;
const DATA_START_ROW = 7;
const MAX_FILAS = 60;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;

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

function esFilaLeyendaCategorias(row) {
    const a = celdaATexto(row.getCell(1).value);
    const b = celdaATexto(row.getCell(2).value);
    const c = celdaATexto(row.getCell(3).value);
    if (a) return false;
    const n = Number(b);
    if (!Number.isInteger(n) || n < 1 || n > 5) return false;
    const esperado = CATEGORIAS[n - 1]?.label || '';
    return String(c).toLowerCase() === String(esperado).toLowerCase()
        || CATEGORIAS.some((cat) => String(c).toLowerCase().includes(String(cat.label).toLowerCase().slice(0, 20)));
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

function escribirLeyendaCategorias(ws, filaInicio) {
    for (let i = 0; i < CATEGORIAS.length; i++) {
        const row = ws.getRow(filaInicio + i);
        asignarTextoSimple(row.getCell(2), String(CATEGORIAS[i].id), 'center');
        asignarTextoSimple(row.getCell(3), CATEGORIAS[i].label, 'left');
    }
}

function escribirActividadesEnHoja(ws, actividadesRaw) {
    const actividades = Array.isArray(actividadesRaw) ? actividadesRaw : [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const fila = i < actividades.length ? actividades[i] : { ...ACTIVIDAD_DEFECTO };
        escribirFilaActividad(ws.getRow(rowNum), fila);
    }
    // Leyenda debajo del bloque de datos (fuera de las filas con bordes de captura).
    const leyendaInicio = DATA_END_ROW + 2;
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
    const actualizaciones = [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const a = i < d.actividades.length ? d.actividades[i] : { ...ACTIVIDAD_DEFECTO, categorias: [false, false, false, false, false] };
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
    // Leyenda debajo del bloque de datos
    const leyendaInicio = DATA_END_ROW + 2;
    for (let i = 0; i < CATEGORIAS.length; i++) {
        const rowNum = leyendaInicio + i;
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [[String(CATEGORIAS[i].id)]] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [[CATEGORIAS[i].label]] });
    }
    return actualizaciones;
}

function esTituloPlantillaF25(titulo) {
    const t = String(titulo || '').trim().toLowerCase().replace(/\.$/, '');
    return !t || t === 'plantilla';
}

/** Hojas de trabajo F-25: SGCF25-DDMM-NN (p. ej. SGCF25-1009-01). */
function esHojaHistorialF25(titulo) {
    return /^SGCF25-\d{4}-\d{2}$/i.test(String(titulo || '').trim());
}

function parsearHojaHistorialF25(titulo) {
    const m = String(titulo || '').trim().match(/^SGCF25-(\d{2})(\d{2})-(\d{2})$/i);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const nn = Number(m[3]);
    if (![dd, mm, nn].every((n) => Number.isFinite(n))) return null;
    // Orden cronológico aproximado dentro del año: mes → día → consecutivo.
    return { dd, mm, nn, sortKey: mm * 1000000 + dd * 1000 + nn };
}

function resolverTituloHojaVigenteF25(titulos) {
    const hist = (Array.isArray(titulos) ? titulos : [])
        .map((titulo) => ({
            titulo: String(titulo || '').trim(),
            meta: parsearHojaHistorialF25(titulo)
        }))
        .filter((item) => item.meta)
        .sort((a, b) => b.meta.sortKey - a.meta.sortKey);
    return hist[0]?.titulo || null;
}

function listarHojasHistorialF25Ordenadas(titulos) {
    return (Array.isArray(titulos) ? titulos : [])
        .map((titulo) => ({
            titulo: String(titulo || '').trim(),
            meta: parsearHojaHistorialF25(titulo)
        }))
        .filter((item) => item.meta)
        .sort((a, b) => b.meta.sortKey - a.meta.sortKey);
}

/**
 * Última hoja de historial con actividades. Si todas están vacías, la más reciente.
 * Evita que una hoja vacía posterior oculte el último documento con información.
 */
function resolverHojaLecturaDesdeWorkbook(wb) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;

    const historiales = listarHojasHistorialF25Ordenadas(lista.map((ws) => ws.name));
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

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return resolverTituloHojaVigenteF25(titulos) || SHEET_TITLE;
    } catch (err) {
        console.warn('[SGC-F-25] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

/**
 * Garantiza una hoja de trabajo distinta de Plantilla.
 * Si aún no hay historial, duplica Plantilla → SGCF25-DDMM-NN y escribe ahí.
 */
async function resolverHojaDestinoEscritura(spreadsheetId, datos) {
    const vigente = await resolverTituloHojaTrabajo(spreadsheetId);
    if (vigente && !esTituloPlantillaF25(vigente) && esHojaHistorialF25(vigente)) {
        return vigente;
    }
    const nombre = await resolverNombreHistorialDiaMes(spreadsheetId);
    const { title } = await driveService.duplicarHojaGoogleSheet(
        spreadsheetId,
        SHEET_TITLE,
        nombre
    );
    const hojaNueva = title || nombre;
    await escribirSnapshotEnHojaDrive(spreadsheetId, hojaNueva, datos);
    return hojaNueva;
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-25 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

/**
 * Lee Drive priorizando hojas SGCF25-* con datos (nunca Plantilla si hay historial con info).
 */
async function leerDatosDesdeDriveConfiable(spreadsheetId) {
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

    const historiales = listarHojasHistorialF25Ordenadas(titulos);
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
        || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        || (wb.worksheets || [])[0];
    if (!wsPlantilla) {
        return sanitizarDatos(DATOS_DEFECTO);
    }
    return sanitizarDatos(parsearDatosDesdeHoja(wsPlantilla));
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
    try {
        await driveService.aplicarFormatoFilasSgcF25(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW
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

/** Nombre corto mes/año + consecutivo: SGCF25-0926-01, SGCF25-0926-02, … */
async function resolverNombreHistorialDiaMes(spreadsheetId) {
    const parts = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '00';
    // Día + mes (DDMM), p. ej. 09-sep → 0909 → SGCF25-0909-01
    const diaMes = `${pick('day')}${pick('month')}`;
    const prefijo = `${excelHistorial.codigoHistorialBase(CODIGO_FORMATO)}-${diaMes}`;
    let titulos = [];
    if (spreadsheetId) {
        try {
            titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        } catch (err) {
            console.warn('[SGC-F-25] No se pudieron listar hojas para consecutivo:', err.message);
        }
    }
    const re = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{2})$`, 'i');
    let max = 0;
    for (const titulo of titulos || []) {
        const m = String(titulo || '').trim().match(re);
        if (m) {
            const n = Number.parseInt(m[1], 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return `${prefijo}-${String(max + 1).padStart(2, '0')}`;
}

async function aplicarHistorialSgcF25(opciones) {
    // Siempre duplicar desde Plantilla (estructura limpia). Nunca escribir en ella.
    const sheetActiva = SHEET_TITLE;
    const datosPrevios = opciones.datosPrevios || sanitizarDatos(DATOS_DEFECTO);
    const nombreHistorial = await resolverNombreHistorialDiaMes(opciones.spreadsheetId);
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        // false: origen = Plantilla.; la hoja nueva recibe el snapshot.
        usarHojaVigenteComoOrigen: false,
        resolverNombreHistorial: () => nombreHistorial
    });
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        if (esTituloPlantillaF25(result.hojaVigente)) {
            console.warn('[SGC-F-25] Historial devolvió Plantilla; se fuerza hoja de trabajo.');
            try {
                result.hojaVigente = await resolverHojaDestinoEscritura(
                    opciones.spreadsheetId,
                    result.datosGuardar || opciones.datosNuevos
                );
            } catch (err) {
                console.warn('[SGC-F-25] No se pudo crear hoja de trabajo:', err.message);
            }
            return result;
        }
        try {
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
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
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA].filter(Boolean);
    const unicos = [...new Set(candidatos.map((id) => String(id).trim()).filter(Boolean))];

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
        try {
            const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
            if (existe && (await esSpreadsheetEditableEnDrive(DRIVE_FILE_ID_SISTEMA))) {
                return DRIVE_FILE_ID_SISTEMA;
            }
        } catch {
            // Continuar con otros candidatos.
        }
    }

    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) {
            candidatos.push(val);
        }
    };

    agregar(registro?.drive_file_id);
    agregar(DRIVE_FILE_ID_SISTEMA);
    const enCarpeta = await buscarArchivoDriveTrabajo();
    agregar(enCarpeta?.id);

    const resolver = async (soloGoogleSheet, requiereCarpeta) => {
        for (const id of candidatos) {
            try {
                const existe = await driveService.verificarArchivoExiste(id);
                if (!existe) continue;
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) continue;
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) continue;
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) return editableSinCarpeta;
    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) return editableEnCarpeta;
    const cualquieraSinCarpeta = await resolver(false, false);
    if (cualquieraSinCarpeta) return cualquieraSinCarpeta;
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

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const editorUrl = driveId
        ? (driveService.construirUrlEditorGoogleSheet(driveId) || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`)
        : null;

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
        editorUrl,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
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
    if (driveFileId) {
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
        datos = datosDb || datosDrive || sanitizarDatos(DATOS_DEFECTO);
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
    if (driveFileId) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo asegurar permiso de enlace:', err.message);
        }
    }
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
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

    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    // Protección: no permitir que un guardado vacío (p. ej. refresh) borre el último trabajo.
    const previosEfectivos = datosPrevios || sanitizarDatos(DATOS_DEFECTO);
    if (!body?.vaciar && datosEntrada.actividades.length === 0) {
        let datosConservar = previosEfectivos.actividades.length ? previosEfectivos : null;
        if (!datosConservar && driveId) {
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
    const fechaCambio = fechaHoyIso();
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaCambio;
    }

    let datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion
            ? fechaModificacion
            : fechaOriginal
    };

    // 1) Persistir SIEMPRE en BD primero (fuente de verdad del sistema).
    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    let archivoDrive = null;

    // 2) Sincronizar Drive (no debe impedir que la UI recupere desde BD).
    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            if (!huboCambio) {
                const hojaDestino = await resolverHojaDestinoEscritura(driveId, datosGuardar);
                if (!esTituloPlantillaF25(hojaDestino)) {
                    await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
                }
            } else {
                const hist = await aplicarHistorialSgcF25({
                    spreadsheetId: driveId,
                    datosPrevios: datosPrevios || sanitizarDatos(DATOS_DEFECTO),
                    datosNuevos: { ...datosGuardar },
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = {
                    ...hist.datosGuardar,
                    fechaElaboracion: contenidoModificado && fechaModificacion
                        ? fechaModificacion
                        : fechaOriginal
                };

                let hojaDestino = hist.aplicado && hist.hojaVigente && !esTituloPlantillaF25(hist.hojaVigente)
                    ? hist.hojaVigente
                    : null;
                if (!hist.aplicado || !hojaDestino) {
                    const previa = await resolverTituloHojaTrabajo(driveId);
                    const yaHabiaHistorial = previa && !esTituloPlantillaF25(previa);
                    hojaDestino = await resolverHojaDestinoEscritura(driveId, datosGuardar);
                    if (!hist.aplicado && !esTituloPlantillaF25(hojaDestino) && yaHabiaHistorial) {
                        await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
                    }
                }

                // Reafirma BD por si el historial ajustó revisión/meta.
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-25] Drive no sincronizó; la BD ya tiene el guardado:', err.message);
            archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        }
    } else if (!driveId) {
        try {
            const buffer = await escribirDatosEnPlantilla(datosGuardar, DRIVE_FILE_ID_SISTEMA);
            archivoDrive = await subirOReemplazarEnDrive(buffer, null);
            if (archivoDrive?.id) {
                await guardarRegistroDb(pool, {
                    driveFileId: archivoDrive.id,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                driveId = archivoDrive.id;
            }
        } catch (err) {
            console.warn('[SGC-F-25] No se pudo crear archivo Drive inicial:', err.message);
        }
    }

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
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
    const fechaModificacion = fechaHoyIso();

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosDrive,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: fechaModificacion,
        contenidoModificado: true
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datosDrive, archivoDrive);
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return construirRespuesta(registro || {}, sanitizarDatos(DATOS_DEFECTO), null);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    // Refuerzo: también lectura pública por si el navegador abre primero en modo vista.
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* ignore */ }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (registro?.drive_file_id && registro.drive_file_id !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-25] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos, TEMPLATE_DRIVE_ID);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, null);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    sanitizarDatos,
    CATEGORIAS,
    ACTIVIDADES_VALIDAS
};
