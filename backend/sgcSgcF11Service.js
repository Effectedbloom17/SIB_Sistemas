/**
 * SGC-F-11 · AMEF — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-11';
/** Plantilla maestra (hoja «Plantilla»): docs.google.com/spreadsheets/d/15iP8UalTLSW83DDuEmQEPZaAG3zao06zO51guKiR9_k */
const TEMPLATE_DRIVE_ID = '15iP8UalTLSW83DDuEmQEPZaAG3zao06zO51guKiR9_k';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-11 AMEF (sistema)';
const SHEET_TITLE = 'Plantilla';

const HEADER_ROW = 10;
const DATA_START_ROW = 11;
const DATA_ROW_HEIGHT = 150;
const REVISION_ROW = 2;
const REVISION_COL = 15;
const FECHA_REV_ROW = 3;
const FECHA_REV_COL = 15;

/** Metadatos — plantilla con columnas desde B (col 2). */
const META = {
    area: { row: 6, col: 2 },
    departamento: { row: 6, col: 5 },
    elaboro: { row: 6, col: 8 },
    /** N5:T5 — valor de fecha (etiqueta K5:M5) */
    fechaElaboracion: { row: 5, col: 14 },
    /** N6:T7 — valor de equipo (etiqueta K6:M7) */
    equipoTrabajo: { row: 6, col: 14 },
    /** H7:J7 — valor de proceso (etiqueta B7:G7) */
    proceso: { row: 7, col: 8 }
};

const TIMEZONE_MEXICO = 'America/Mexico_City';
const FUENTE_SISTEMA = { name: 'Century Gothic', size: 12 };
const FUENTE_ETIQUETA = { name: 'Century Gothic', size: 12, bold: true };
const BORDE_FINO = {
    style: 'thin',
    color: { argb: 'FF000000' }
};
const BORDES_CELDA = {
    top: BORDE_FINO,
    left: BORDE_FINO,
    bottom: BORDE_FINO,
    right: BORDE_FINO
};

/** Columnas de la tabla (B=2 … T=20). */
const COL = {
    operacion: 2,
    etapa: 3,
    modoFalla: 4,
    causas: 5,
    ocurrencia: 6,
    efecto: 7,
    severidad: 8,
    controlesPreventivos: 9,
    controlesDeteccion: 10,
    deteccion: 11,
    rpn: 12,
    acciones: 13,
    responsable: 14,
    fechaCompromiso: 15,
    resultado: 16,
    severidadPost: 17,
    ocurrenciaPost: 18,
    deteccionPost: 19,
    rpnPost: 20
};

const COLS_CENTRO = new Set([
    COL.ocurrencia,
    COL.severidad,
    COL.deteccion,
    COL.rpn,
    COL.severidadPost,
    COL.ocurrenciaPost,
    COL.deteccionPost,
    COL.rpnPost
]);

const MAX_COLUMNAS_SISTEMA = 20;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-16',
    area: '',
    departamento: '',
    elaboro: '',
    fechaElaboracion: '2025-01-16',
    proceso: 'VENTAS',
    equipoTrabajo: '',
    filas: [
        {
            operacion: '1',
            etapa: '',
            modoFalla: '',
            causas: '',
            ocurrencia: '2',
            efecto: '',
            severidad: '4',
            controlesPreventivos: '',
            controlesDeteccion: '',
            deteccion: '1',
            rpn: '8',
            acciones: '',
            responsable: '',
            fechaCompromiso: '',
            resultado: '',
            severidadPost: '2',
            ocurrenciaPost: '4',
            deteccionPost: '1',
            rpnPost: '8'
        },
        {
            operacion: '2',
            etapa: '',
            modoFalla: '',
            causas: '',
            ocurrencia: '4',
            efecto: '',
            severidad: '3',
            controlesPreventivos: '',
            controlesDeteccion: '',
            deteccion: '1',
            rpn: '12',
            acciones: '',
            responsable: '',
            fechaCompromiso: '',
            resultado: '',
            severidadPost: '4',
            ocurrenciaPost: '3',
            deteccionPost: '1',
            rpnPost: '12'
        },
        {
            operacion: '3',
            etapa: '',
            modoFalla: '',
            causas: '',
            ocurrencia: '4',
            efecto: '',
            severidad: '3',
            controlesPreventivos: '',
            controlesDeteccion: '',
            deteccion: '2',
            rpn: '24',
            acciones: '',
            responsable: '',
            fechaCompromiso: '',
            resultado: '',
            severidadPost: '4',
            ocurrenciaPost: '3',
            deteccionPost: '2',
            rpnPost: '24'
        }
    ]
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
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(new Date());
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function aplicarRevisionPorCambio(revisionActual, fechaRevisionActual, huboCambio, origen = 'sistema') {
    let revision = String(revisionActual || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision;
    let fechaRevision = formatearFechaIso(fechaRevisionActual) || DATOS_DEFECTO.fechaRevision;
    if (huboCambio && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        fechaRevision = fechaHoyIso();
    }
    return { revision, fechaRevision };
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function escalaAmef(valor) {
    const n = parseInt(String(valor || '').trim(), 10);
    return n >= 1 && n <= 4 ? String(n) : '';
}

function calcularRpn(ocurrencia, severidad, deteccion) {
    const o = escalaAmef(ocurrencia);
    const s = escalaAmef(severidad);
    const d = escalaAmef(deteccion);
    if (!o || !s || !d) {
        return '0';
    }
    return String(Number(o) * Number(s) * Number(d));
}

function sanitizarFila(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const ocurrencia = escalaAmef(base.ocurrencia);
    const severidad = escalaAmef(base.severidad);
    const deteccion = escalaAmef(base.deteccion);
    const ocurrenciaPost = escalaAmef(base.ocurrenciaPost);
    const severidadPost = escalaAmef(base.severidadPost);
    const deteccionPost = escalaAmef(base.deteccionPost);
    const rpnCalc = calcularRpn(ocurrencia, severidad, deteccion);
    const rpnPostCalc = calcularRpn(ocurrenciaPost, severidadPost, deteccionPost);

    return {
        operacion: String(base.operacion || '').trim(),
        etapa: String(base.etapa || '').trim(),
        modoFalla: String(base.modoFalla || '').trim(),
        causas: String(base.causas || '').trim(),
        ocurrencia,
        efecto: String(base.efecto || '').trim(),
        severidad,
        controlesPreventivos: String(base.controlesPreventivos || '').trim(),
        controlesDeteccion: String(base.controlesDeteccion || '').trim(),
        deteccion,
        rpn: rpnCalc,
        acciones: String(base.acciones || '').trim(),
        responsable: String(base.responsable || '').trim(),
        fechaCompromiso: String(base.fechaCompromiso || '').trim(),
        resultado: String(base.resultado || '').trim(),
        severidadPost,
        ocurrenciaPost,
        deteccionPost,
        rpnPost: rpnPostCalc
    };
}

function nuevoIdAnalisis() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `amef-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function sanitizarAnalisis(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filasRaw = Array.isArray(base.filas) ? base.filas : [];
    const filas = (filasRaw.length ? filasRaw : [{}]).map((fila, index) => {
        const limpia = sanitizarFila(fila);
        return {
            ...limpia,
            operacion: limpia.operacion || String(index + 1)
        };
    });
    return {
        id: String(base.id || '').trim() || nuevoIdAnalisis(),
        area: String(base.area || '').trim(),
        departamento: String(base.departamento || '').trim(),
        elaboro: String(base.elaboro || '').trim(),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || '',
        proceso: String(base.proceso || '').trim(),
        equipoTrabajo: String(base.equipoTrabajo || '').trim(),
        edicionBloqueada: base.edicionBloqueada === true || base.edicionBloqueada === 1 || base.edicionBloqueada === '1',
        filas
    };
}

function esAnalisisLegacyPlano(base) {
    return !Array.isArray(base.analisis) && (
        base.area
        || base.departamento
        || base.elaboro
        || base.proceso
        || base.equipoTrabajo
        || Array.isArray(base.filas)
    );
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let listaRaw = [];
    if (Array.isArray(base.analisis)) {
        listaRaw = base.analisis;
    } else if (esAnalisisLegacyPlano(base)) {
        listaRaw = [base];
    }
    const analisis = listaRaw.map(sanitizarAnalisis);
    const activo = base.analisisActivoId ? String(base.analisisActivoId) : '';
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        analisis,
        analisisActivoId: analisis.some((item) => item.id === activo)
            ? activo
            : (analisis[0]?.id || null)
    };
}

function resolverAnalisisActivo(datos) {
    const lista = Array.isArray(datos?.analisis) ? datos.analisis : [];
    if (!lista.length) return null;
    const id = datos?.analisisActivoId;
    if (id) {
        const found = lista.find((item) => item.id === id);
        if (found) return found;
    }
    return lista[0];
}

function vistaParaHoja(datos, analisis = null) {
    const doc = sanitizarDatos(datos);
    const item = analisis || resolverAnalisisActivo(doc);
    if (!item) return null;
    return {
        revision: doc.revision,
        fechaRevision: doc.fechaRevision,
        fechaElaboracion: item.fechaElaboracion || doc.fechaElaboracion,
        area: item.area,
        departamento: item.departamento,
        elaboro: item.elaboro,
        proceso: item.proceso,
        equipoTrabajo: item.equipoTrabajo,
        filas: item.filas
    };
}

function columnaALetra(col) {
    let n = col;
    let letra = '';
    while (n > 0) {
        const resto = (n - 1) % 26;
        letra = String.fromCharCode(65 + resto) + letra;
        n = Math.floor((n - 1) / 26);
    }
    return letra;
}

function sanitizarNombreHoja(texto) {
    return String(texto || '').trim()
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function esHojaReservadaSgcF11(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (/^plantilla$/i.test(t) || /^criterios\s*$/i.test(t)) return true;
    if (/^SGCF11-/i.test(t)) return true;
    return false;
}

function resolverNombreHojaAnalisis(analisis, ocupados = []) {
    let base = sanitizarNombreHoja(analisis?.proceso) || 'AMEF';
    if (esHojaReservadaSgcF11(base)) {
        base = `AMEF ${base}`.slice(0, 80);
    }
    const usados = new Set(ocupados.map((n) => String(n || '').toLowerCase()));
    let nombre = base;
    let n = 2;
    while (usados.has(nombre.toLowerCase()) || esHojaReservadaSgcF11(nombre)) {
        nombre = `${base} ${n}`.slice(0, 90);
        n += 1;
    }
    return nombre;
}

function encontrarFilaFinDatos(ws) {
    const maxRow = Math.max(ws.rowCount, DATA_START_ROW + 50);
    for (let r = DATA_START_ROW; r <= maxRow; r++) {
        const operacion = celdaATexto(ws.getRow(r).getCell(COL.operacion).value);
        const modoFalla = celdaATexto(ws.getRow(r).getCell(COL.modoFalla).value);
        if (!operacion && !modoFalla && r > DATA_START_ROW) {
            const prevOp = celdaATexto(ws.getRow(r - 1).getCell(COL.operacion).value);
            if (prevOp) return r;
        }
    }
    return DATA_START_ROW + 30;
}

function leerMetaCelda(ws, { row, col }) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function normalizarEquipoTrabajo(texto) {
    return celdaATexto(texto).replace(/^EQUIPO DE TRABAJO:\s*/i, '').trim();
}

function normalizarFechaElaboracion(texto) {
    const limpio = celdaATexto(texto)
        .replace(/^FECHA DE ELABORACIÓN:\s*/i, '')
        .trim();
    if (!limpio || /^EQUIPO DE TRABAJO:/i.test(limpio)) {
        return '';
    }
    const iso = formatearFechaIso(limpio);
    return iso || limpio;
}

function leerFechaElaboracion(ws) {
    const actual = normalizarFechaElaboracion(leerMetaCelda(ws, META.fechaElaboracion));
    if (actual) {
        return formatearFechaIso(actual) || DATOS_DEFECTO.fechaElaboracion;
    }
    // Compatibilidad con plantilla anterior (M8 / J9)
    const legacyM8 = normalizarFechaElaboracion(leerMetaCelda(ws, { row: 8, col: 13 }));
    if (legacyM8) {
        return formatearFechaIso(legacyM8) || DATOS_DEFECTO.fechaElaboracion;
    }
    const legacyJ9 = normalizarFechaElaboracion(leerMetaCelda(ws, { row: 9, col: 10 }));
    if (legacyJ9) {
        return formatearFechaIso(legacyJ9) || DATOS_DEFECTO.fechaElaboracion;
    }
    return DATOS_DEFECTO.fechaElaboracion;
}

function leerEquipoTrabajo(ws) {
    const actual = normalizarEquipoTrabajo(leerMetaCelda(ws, META.equipoTrabajo));
    if (actual) {
        return actual;
    }
    const legacyM9 = normalizarEquipoTrabajo(leerMetaCelda(ws, { row: 9, col: 13 }));
    if (legacyM9) {
        return legacyM9;
    }
    return normalizarEquipoTrabajo(leerMetaCelda(ws, { row: 9, col: 10 }));
}

function esColumnaCentrada(col) {
    return COLS_CENTRO.has(col);
}

function aplicarBordesCelda(celda) {
    celda.border = {
        ...(celda.border || {}),
        ...BORDES_CELDA
    };
}

function obtenerHojaPlantilla(wb) {
    return wb.getWorksheet(SHEET_TITLE)
        || wb.worksheets.find((h) => /plantilla/i.test(String(h.name || '')))
        || wb.worksheets[0]
        || null;
}

function parsearDatosDesdeHoja(ws) {
    const filaFin = encontrarFilaFinDatos(ws);
    const filas = [];

    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        const operacion = celdaATexto(row.getCell(COL.operacion).value);
        if (!operacion) continue;
        if (operacion.toLowerCase().includes('operación') || operacion.toLowerCase().includes('operacion')) continue;

        filas.push(sanitizarFila({
            operacion,
            etapa: celdaATexto(row.getCell(COL.etapa).value),
            modoFalla: celdaATexto(row.getCell(COL.modoFalla).value),
            causas: celdaATexto(row.getCell(COL.causas).value),
            ocurrencia: celdaATexto(row.getCell(COL.ocurrencia).value),
            efecto: celdaATexto(row.getCell(COL.efecto).value),
            severidad: celdaATexto(row.getCell(COL.severidad).value),
            controlesPreventivos: celdaATexto(row.getCell(COL.controlesPreventivos).value),
            controlesDeteccion: celdaATexto(row.getCell(COL.controlesDeteccion).value),
            deteccion: celdaATexto(row.getCell(COL.deteccion).value),
            rpn: celdaATexto(row.getCell(COL.rpn).value),
            acciones: celdaATexto(row.getCell(COL.acciones).value),
            responsable: celdaATexto(row.getCell(COL.responsable).value),
            fechaCompromiso: celdaATexto(row.getCell(COL.fechaCompromiso).value),
            resultado: celdaATexto(row.getCell(COL.resultado).value),
            severidadPost: celdaATexto(row.getCell(COL.severidadPost).value),
            ocurrenciaPost: celdaATexto(row.getCell(COL.ocurrenciaPost).value),
            deteccionPost: celdaATexto(row.getCell(COL.deteccionPost).value),
            rpnPost: celdaATexto(row.getCell(COL.rpnPost).value)
        }));
    }

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL).value);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);

    return sanitizarDatos({
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
        area: leerMetaCelda(ws, META.area),
        departamento: leerMetaCelda(ws, META.departamento),
        elaboro: leerMetaCelda(ws, META.elaboro),
        fechaElaboracion: leerFechaElaboracion(ws),
        proceso: leerMetaCelda(ws, META.proceso).replace(/^PROCESO:\s*/i, '').trim(),
        equipoTrabajo: leerEquipoTrabajo(ws),
        filas: filas.length ? filas : DATOS_DEFECTO.filas
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const titulo = String(opciones.sheetTitle || '').trim();
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = titulo
        ? (wb.getWorksheet(titulo) || obtenerHojaPlantilla(wb))
        : (modo === 'edicion'
            ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            : obtenerHojaPlantilla(wb));
    if (!ws) throw new Error('La plantilla SGC-F-11 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await obtenerBufferPlantillaSgcF11();
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
    } catch (err) {
        return driveService.descargarArchivo(fileId);
    }
}

function asignarTexto(celda, texto, horizontal = 'left', conBorde = false) {
    celda.value = normalizarSaltosLinea(texto);
    celda.font = { ...(celda.font || {}), ...FUENTE_SISTEMA };
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal
    };
    if (conBorde) {
        aplicarBordesCelda(celda);
    }
}

function asignarNumeroOCelda(celda, texto, horizontal = 'center', conBorde = false) {
    const t = String(texto || '').trim();
    celda.font = { ...(celda.font || {}), ...FUENTE_SISTEMA };
    if (t && /^-?\d+(\.\d+)?$/.test(t)) {
        celda.value = Number(t);
    } else {
        celda.value = normalizarSaltosLinea(t);
    }
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal
    };
    if (conBorde) {
        aplicarBordesCelda(celda);
    }
}

function aplicarEstiloCelda(celda, fuente, horizontal, conBorde = false) {
    celda.font = { ...(celda.font || {}), ...fuente };
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal
    };
    if (conBorde) {
        aplicarBordesCelda(celda);
    }
}

function aplicarTipografiaSgcF11(ws, numFilasDatos) {
    // Etiquetas de metadatos (fila 5 / 6 / 7)
    for (const col of [2, 5, 8, 11]) {
        aplicarEstiloCelda(ws.getRow(5).getCell(col), FUENTE_ETIQUETA, 'center');
    }
    aplicarEstiloCelda(ws.getRow(6).getCell(11), FUENTE_ETIQUETA, 'center');
    aplicarEstiloCelda(ws.getRow(7).getCell(2), FUENTE_ETIQUETA, 'center');

    // Valores meta
    for (const { row, col } of [
        META.area, META.departamento, META.elaboro,
        META.equipoTrabajo, META.fechaElaboracion, META.proceso
    ]) {
        aplicarEstiloCelda(ws.getRow(row).getCell(col), FUENTE_SISTEMA, 'left');
    }

    // Encabezados de tabla
    for (let c = COL.operacion; c <= COL.rpnPost; c++) {
        aplicarEstiloCelda(ws.getRow(HEADER_ROW).getCell(c), FUENTE_ETIQUETA, 'center', true);
    }

    if (numFilasDatos <= 0) {
        return;
    }

    const filaFin = DATA_START_ROW + numFilasDatos - 1;
    for (let r = DATA_START_ROW; r <= filaFin; r++) {
        const row = ws.getRow(r);
        row.height = DATA_ROW_HEIGHT;
        for (let c = COL.operacion; c <= COL.rpnPost; c++) {
            const horizontal = esColumnaCentrada(c) ? 'center' : 'left';
            aplicarEstiloCelda(row.getCell(c), FUENTE_SISTEMA, horizontal, true);
        }
    }
}

async function obtenerBufferPlantillaSgcF11() {
    try {
        const info = await driveService.obtenerInfoArchivo(TEMPLATE_DRIVE_ID);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(TEMPLATE_DRIVE_ID);
        }
    } catch (_err) {
        // Continuar con descarga binaria / fallback
    }
    return driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
}

async function escribirDatosEnPlantilla(datos) {
    const hoja = datos && Array.isArray(datos.filas) ? datos : vistaParaHoja(datos);
    if (!hoja) {
        throw new Error('No hay un análisis AMEF para escribir en la plantilla.');
    }
    const templateBuffer = await obtenerBufferPlantillaSgcF11();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = obtenerHojaPlantilla(wb);
    if (!ws) throw new Error('La plantilla SGC-F-11 no contiene la hoja «Plantilla».');

    ws.eachRow((row) => {
        row.eachCell({ includeEmpty: true }, (cell) => {
            if (cell.note) cell.note = undefined;
        });
    });

    const filaFin = encontrarFilaFinDatos(ws);
    const filasDisponibles = Math.max(0, filaFin - DATA_START_ROW);
    if (hoja.filas.length > filasDisponibles) {
        ws.spliceRows(filaFin, 0, ...Array.from({ length: hoja.filas.length - filasDisponibles }, () => []));
    }

    const filaFinActual = Math.max(encontrarFilaFinDatos(ws), DATA_START_ROW + hoja.filas.length);
    for (let r = DATA_START_ROW; r < filaFinActual; r++) {
        const row = ws.getRow(r);
        for (let c = COL.operacion; c <= COL.rpnPost; c++) {
            row.getCell(c).value = null;
        }
    }

    asignarTexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL), `Revisión: ${hoja.revision || '00'}`);
    asignarTexto(
        ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL),
        `Fecha de rev: ${formatearFechaDisplay(hoja.fechaRevision)}`
    );

    asignarTexto(ws.getRow(META.area.row).getCell(META.area.col), hoja.area);
    asignarTexto(ws.getRow(META.departamento.row).getCell(META.departamento.col), hoja.departamento);
    asignarTexto(ws.getRow(META.elaboro.row).getCell(META.elaboro.col), hoja.elaboro);
    asignarTexto(
        ws.getRow(META.fechaElaboracion.row).getCell(META.fechaElaboracion.col),
        formatearFechaDisplay(hoja.fechaElaboracion)
    );
    asignarTexto(ws.getRow(META.equipoTrabajo.row).getCell(META.equipoTrabajo.col), hoja.equipoTrabajo);
    asignarTexto(ws.getRow(META.proceso.row).getCell(META.proceso.col), hoja.proceso);

    hoja.filas.forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        row.height = DATA_ROW_HEIGHT;
        asignarTexto(row.getCell(COL.operacion), fila.operacion, 'left', true);
        asignarTexto(row.getCell(COL.etapa), fila.etapa, 'left', true);
        asignarTexto(row.getCell(COL.modoFalla), fila.modoFalla, 'left', true);
        asignarTexto(row.getCell(COL.causas), fila.causas, 'left', true);
        asignarNumeroOCelda(row.getCell(COL.ocurrencia), fila.ocurrencia, 'center', true);
        asignarTexto(row.getCell(COL.efecto), fila.efecto, 'left', true);
        asignarNumeroOCelda(row.getCell(COL.severidad), fila.severidad, 'center', true);
        asignarTexto(row.getCell(COL.controlesPreventivos), fila.controlesPreventivos, 'left', true);
        asignarTexto(row.getCell(COL.controlesDeteccion), fila.controlesDeteccion, 'left', true);
        asignarNumeroOCelda(row.getCell(COL.deteccion), fila.deteccion, 'center', true);
        asignarNumeroOCelda(row.getCell(COL.rpn), fila.rpn, 'center', true);
        asignarTexto(row.getCell(COL.acciones), fila.acciones, 'left', true);
        asignarTexto(row.getCell(COL.responsable), fila.responsable, 'left', true);
        asignarTexto(row.getCell(COL.fechaCompromiso), fila.fechaCompromiso, 'left', true);
        asignarTexto(row.getCell(COL.resultado), fila.resultado, 'left', true);
        asignarNumeroOCelda(row.getCell(COL.severidadPost), fila.severidadPost, 'center', true);
        asignarNumeroOCelda(row.getCell(COL.ocurrenciaPost), fila.ocurrenciaPost, 'center', true);
        asignarNumeroOCelda(row.getCell(COL.deteccionPost), fila.deteccionPost, 'center', true);
        asignarNumeroOCelda(row.getCell(COL.rpnPost), fila.rpnPost, 'center', true);
    });

    aplicarTipografiaSgcF11(ws, hoja.filas.length);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
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

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    for (const archivo of (archivos || [])) {
        const id = String(archivo.id || '');
        const name = String(archivo.name || '').toLowerCase();
        if (id && id !== excluirId && name.startsWith(objetivo)) {
            try {
                await driveService.eliminarArchivo(id);
            } catch (err) {
                console.warn('[SGC-F-11] No se pudo eliminar copia en Drive:', err.message);
            }
        }
    }
}

async function resolverDriveFileId(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && await archivoEstaEnCarpeta(idDb, CARPETA_DRIVE_ID)) {
            return idDb;
        }
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMysqlMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
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

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const base = sanitizarDatos(datos);
        delete base.fechaElaboracion;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function datosSonEquivalentes(a, b) {
    return contenidoEsEquivalente(a, b);
}

function datosAActualizacionesSheet(vista, tituloHoja) {
    const titulo = String(tituloHoja || SHEET_TITLE).replace(/'/g, "''");
    const celda = (col, row) => `'${titulo}'!${columnaALetra(col)}${row}`;
    const push = (lista, col, row, valor) => {
        lista.push({
            range: celda(col, row),
            values: [[valor == null ? '' : String(valor)]]
        });
    };
    const actualizaciones = [];
    push(actualizaciones, REVISION_COL, REVISION_ROW, `Revisión: ${vista.revision || '00'}`);
    push(actualizaciones, FECHA_REV_COL, FECHA_REV_ROW, `Fecha de rev: ${formatearFechaDisplay(vista.fechaRevision)}`);
    push(actualizaciones, META.area.col, META.area.row, vista.area || '');
    push(actualizaciones, META.departamento.col, META.departamento.row, vista.departamento || '');
    push(actualizaciones, META.elaboro.col, META.elaboro.row, vista.elaboro || '');
    push(actualizaciones, META.fechaElaboracion.col, META.fechaElaboracion.row, formatearFechaDisplay(vista.fechaElaboracion));
    push(actualizaciones, META.equipoTrabajo.col, META.equipoTrabajo.row, vista.equipoTrabajo || '');
    push(actualizaciones, META.proceso.col, META.proceso.row, vista.proceso || '');

    const filas = Array.isArray(vista.filas) ? vista.filas : [];
    const limite = Math.max(filas.length, 3, 12);
    for (let i = 0; i < limite; i++) {
        const fila = filas[i] || null;
        const row = DATA_START_ROW + i;
        const campos = [
            [COL.operacion, fila ? (fila.operacion || String(i + 1)) : ''],
            [COL.etapa, fila?.etapa || ''],
            [COL.modoFalla, fila?.modoFalla || ''],
            [COL.causas, fila?.causas || ''],
            [COL.ocurrencia, fila?.ocurrencia || ''],
            [COL.efecto, fila?.efecto || ''],
            [COL.severidad, fila?.severidad || ''],
            [COL.controlesPreventivos, fila?.controlesPreventivos || ''],
            [COL.controlesDeteccion, fila?.controlesDeteccion || ''],
            [COL.deteccion, fila?.deteccion || ''],
            [COL.rpn, fila?.rpn || ''],
            [COL.acciones, fila?.acciones || ''],
            [COL.responsable, fila?.responsable || ''],
            [COL.fechaCompromiso, fila?.fechaCompromiso || ''],
            [COL.resultado, fila?.resultado || ''],
            [COL.severidadPost, fila?.severidadPost || ''],
            [COL.ocurrenciaPost, fila?.ocurrenciaPost || ''],
            [COL.deteccionPost, fila?.deteccionPost || ''],
            [COL.rpnPost, fila?.rpnPost || '']
        ];
        for (const [col, valor] of campos) {
            push(actualizaciones, col, row, valor);
        }
    }
    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, vista, sheetTitle) {
    const titulo = sheetTitle || SHEET_TITLE;
    const actualizaciones = datosAActualizacionesSheet(vista, titulo);
    const CHUNK = 400;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(
            spreadsheetId,
            actualizaciones.slice(i, i + CHUNK)
        );
    }
    await reforzarFormatoDriveSheet(spreadsheetId, vista.filas?.length || 1, titulo);
}

async function sincronizarHojasAnalisisEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    ) || SHEET_TITLE;

    const mapaPrevio = new Map();
    const ocupadosPrevios = [];
    if (prev?.analisis) {
        for (const item of prev.analisis) {
            const nombre = resolverNombreHojaAnalisis(item, ocupadosPrevios);
            ocupadosPrevios.push(nombre);
            mapaPrevio.set(item.id, nombre);
        }
    }

    const ocupados = [];
    const nombresVigentes = new Set();
    for (const item of meta.analisis) {
        const nombre = resolverNombreHojaAnalisis(item, ocupados);
        ocupados.push(nombre);
        nombresVigentes.add(nombre);
    }

    const activoId = String(meta.analisisActivoId || '').trim();
    let hojaActiva = plantillaOrigen;
    ocupados.length = 0;

    for (const item of meta.analisis) {
        let nombreHoja = resolverNombreHojaAnalisis(item, ocupados);
        ocupados.push(nombreHoja);
        const hojaPrev = mapaPrevio.get(item.id);
        const esActivo = !!activoId && item.id === activoId;

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev) && !esHojaReservadaSgcF11(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-11] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                nombreHoja = hojaPrev;
            }
        }

        if (!setExistentes.has(nombreHoja)) {
            try {
                const dup = await driveService.duplicarHojaGoogleSheet(
                    spreadsheetId,
                    plantillaOrigen,
                    nombreHoja
                );
                nombreHoja = dup.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-11] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        const vista = vistaParaHoja(meta, item);
        await actualizarDatosEnGoogleSheet(spreadsheetId, vista, nombreHoja);
        if (esActivo || (!activoId && item === meta.analisis[0])) {
            hojaActiva = nombreHoja;
        }
    }

    const eliminar = [];
    for (const titulo of [...setExistentes]) {
        if (esHojaReservadaSgcF11(titulo)) continue;
        if (!nombresVigentes.has(titulo) && [...mapaPrevio.values()].includes(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-11] No se pudieron eliminar hojas de análisis obsoletas:', err.message);
        }
    }

    if (hojaActiva && meta.analisis.length) {
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, hojaActiva);
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo mostrar la hoja del análisis al frente:', err.message);
        }
    }
    return hojaActiva;
}

async function aplicarUrlsHojaEnRespuesta(respuesta, spreadsheetId, tituloHoja) {
    if (!respuesta || !spreadsheetId || !tituloHoja) return respuesta;
    try {
        const gid = await driveService.obtenerGidHojaPorNombre(spreadsheetId, tituloHoja);
        if (gid == null) return respuesta;
        respuesta.editorUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid });
        respuesta.previewUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid, modo: 'preview' });
    } catch (err) {
        console.warn('[SGC-F-11] No se pudo resolver la hoja del editor:', err.message);
    }
    return respuesta;
}

async function aplicarHistorialSgcF11(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente: excelHistorial.estructuraFilasEquivalente,
        escribirSnapshotEnHoja: async (spreadsheetId, sheetTitle, datos) => {
            const vista = datos && Array.isArray(datos.filas) ? datos : vistaParaHoja(datos);
            if (!vista) return;
            await actualizarDatosEnGoogleSheet(spreadsheetId, vista, sheetTitle || SHEET_TITLE);
        },
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function publicarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = SHEET_TITLE) {
    const vista = datos && Array.isArray(datos.filas) ? datos : vistaParaHoja(datos);
    if (!vista) return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    await actualizarDatosEnGoogleSheet(spreadsheetId, vista, sheetTitle);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function reforzarFormatoDriveSheet(spreadsheetId, numFilasDatos, sheetTitle = SHEET_TITLE) {
    if (!spreadsheetId) {
        return;
    }
    try {
        await driveService.aplicarFormatoVisualSgcF11(spreadsheetId, {
            sheetTitle: sheetTitle || SHEET_TITLE,
            numFilasDatos,
            dataStartRow: DATA_START_ROW,
            // Sheets API usa píxeles; ExcelJS usa puntos (~150 pt ≈ 200 px)
            dataRowHeight: Math.round(DATA_ROW_HEIGHT * (96 / 72)),
            headerRow: HEADER_ROW,
            colStart: COL.operacion,
            colEnd: COL.rpnPost,
            colsCentro: [...COLS_CENTRO]
        });
    } catch (err) {
        console.warn('[SGC-F-11] No se pudo aplicar formato visual en Drive:', err.message);
    }
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio, numFilasDatos = 1) {
    let archivo;
    if (driveFileIdPrevio) {
        try {
            archivo = await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
            await reforzarFormatoDriveSheet(archivo.id, numFilasDatos);
            return archivo;
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    archivo = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );
    await reforzarFormatoDriveSheet(archivo.id, numFilasDatos);
    return archivo;
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

    datos = await leerDatosRegistro(registro);
    if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    }
    if (!datos) {
        if (driveFileId) {
            try {
                const buffer = await descargarBufferDrive(driveFileId);
                datos = await leerDatosDesdeBuffer(buffer);
            } catch (err) {
                console.warn('[SGC-F-11] No se pudo leer archivo en Drive, usando plantilla:', err.message);
            }
        }
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }
    datos = sanitizarDatos(datos);

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    let driveFileIdFinal = driveFileId || registro?.drive_file_id || null;
    if (!driveFileIdFinal) {
        try {
            const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
                || datos.fechaElaboracion
                || DATOS_DEFECTO.fechaElaboracion;
            const vista = vistaParaHoja(datos);
            const buffer = vista
                ? await escribirDatosEnPlantilla(vista)
                : await obtenerBufferPlantillaSgcF11();
            archivoDrive = await subirOReemplazarEnDrive(buffer, null, vista?.filas?.length || 1);
            if (vista && archivoDrive?.id) {
                await sincronizarHojasAnalisisEnDrive(archivoDrive.id, datos, null);
            }
            driveFileIdFinal = archivoDrive.id;
            await guardarRegistroDb(pool, {
                driveFileId: driveFileIdFinal,
                datos,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
        }
    }

    registro = { ...registro, drive_file_id: driveFileIdFinal || null };
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) {
        return sincronizarDesdeDrive(pool);
    }
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
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
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    const datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion
            ? fechaModificacion
            : fechaOriginal
    };

    let driveId = await resolverDriveFileId(registroPrevio);
    let archivoDrive = null;
    let hojaActiva = null;

    if (!driveId) {
        const vista = vistaParaHoja(datosGuardar);
        const buffer = vista
            ? await escribirDatosEnPlantilla(vista)
            : await obtenerBufferPlantillaSgcF11();
        archivoDrive = await subirOReemplazarEnDrive(buffer, null, vista?.filas?.length || 1);
        driveId = archivoDrive?.id || null;
    }

    if (driveId && datosGuardar.analisis.length) {
        hojaActiva = await sincronizarHojasAnalisisEnDrive(driveId, datosGuardar, datosPrevios);
        archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => archivoDrive || { id: driveId });
    } else if (driveId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveId, hojaActiva);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay archivo SGC-F-11 en Drive para sincronizar.');
    }

    const datosPrevios = await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO);
    const activo = resolverAnalisisActivo(datosPrevios);
    const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
    let sheetTitle = activo ? resolverNombreHojaAnalisis(activo) : SHEET_TITLE;
    if (!titulos.includes(sheetTitle)) {
        sheetTitle = driveService.resolverTituloHojaExistente(
            titulos,
            SHEET_TITLE,
            { fallbackRegex: /plantilla/i }
        ) || titulos[0] || SHEET_TITLE;
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = await leerDatosDesdeBuffer(buffer, { sheetTitle, modo: 'edicion' });
    const traido = resolverAnalisisActivo(datosDrive);

    let analisis = Array.isArray(datosPrevios.analisis) ? datosPrevios.analisis.slice() : [];
    if (traido && activo) {
        analisis = analisis.map((item) => (
            item.id === activo.id ? { ...traido, id: activo.id } : item
        ));
    } else if (traido) {
        analisis = [{ ...traido, id: traido.id || nuevoIdAnalisis() }];
    }

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        revision: datosDrive.revision || datosPrevios.revision,
        fechaRevision: datosDrive.fechaRevision || datosPrevios.fechaRevision,
        analisis,
        analisisActivoId: activo?.id || analisis[0]?.id || null
    });

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosGuardar);
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosGuardar.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
        datosGuardar.fechaElaboracion = fechaModificacion;
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    const respuesta = construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, sheetTitle);
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

    let driveId = await resolverDriveFileId(registro);
    let archivoDrive = null;
    if (!driveId) {
        const buffer = await obtenerBufferPlantillaSgcF11();
        archivoDrive = await subirOReemplazarEnDrive(buffer, null, 1);
        driveId = archivoDrive?.id || null;
    }
    let hojaActiva = null;
    if (driveId) {
        hojaActiva = await sincronizarHojasAnalisisEnDrive(driveId, datosPublicar, null);
        archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => archivoDrive || { id: driveId });
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const respuesta = construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveId, hojaActiva);
}

async function descargarPdf(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = sanitizarDatos(await leerDatosRegistro(registro) || DATOS_DEFECTO);
    const solicitado = String(opciones.analisisId || '').trim();
    const analisis = datos.analisis.find((item) => item.id === solicitado)
        || resolverAnalisisActivo(solicitado ? { ...datos, analisisActivoId: solicitado } : datos);
    if (!analisis) {
        const err = new Error('Abre o crea un análisis AMEF para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        const err = new Error('No hay Google Sheet SGC-F-11 para exportar a PDF. Guarda la información primero.');
        err.statusCode = 404;
        throw err;
    }

    const datosHoja = sanitizarDatos({ ...datos, analisisActivoId: analisis.id });
    let tituloHoja = resolverNombreHojaAnalisis(analisis);
    let gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja).catch(() => null);
    if (gid == null) {
        tituloHoja = await sincronizarHojasAnalisisEnDrive(driveFileId, datosHoja, null);
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja).catch(() => null);
    }
    if (gid == null) {
        const err = new Error('No se encontró la hoja del análisis para exportar. Guarda la información e inténtalo de nuevo.');
        err.statusCode = 404;
        throw err;
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        size: 'a4',
        fitToWidth: true,
        margins: 'estrechos',
        pageOrder: 'down_then_over',
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'TOP'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-11 quedó vacía.');
    }

    const nombre = sanitizarNombreHoja(analisis.proceso) || 'AMEF';
    return {
        buffer: Buffer.from(pdfBuffer),
        nombreArchivo: `SGC-F-11 AMEF ${nombre}.pdf`
    };
}

async function publicarContenidoEnDrive(spreadsheetId, datos) {
    const limpios = sanitizarDatos(datos);
    if (!limpios.analisis.length) {
        throw new Error('No hay análisis AMEF para publicar en Drive.');
    }
    const hoja = await sincronizarHojasAnalisisEnDrive(spreadsheetId, limpios, null);
    return { hoja, total: limpios.analisis.length };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPdf,
    publicarContenidoEnDrive,
    sanitizarDatos
};
