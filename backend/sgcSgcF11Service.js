/**
 * SGC-F-11 · AMEF — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-11';
const TEMPLATE_DRIVE_ID = '1WMWdR8NbUXoBRANEPXBp5uMES2l5ekwQ';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-11 AMEF (sistema)';
const SHEET_TITLE = 'AMEF';

const HEADER_ROW = 12;
const DATA_START_ROW = 14;
const REVISION_ROW = 3;
const REVISION_COL = 14;
const FECHA_REV_ROW = 5;
const FECHA_REV_COL = 14;

const META = {
    area: { row: 9, col: 1 },
    departamento: { row: 9, col: 4 },
    elaboro: { row: 9, col: 7 },
    /** M8:S8 — valor de fecha (etiqueta en J8:L8; EQUIPO DE TRABAJO en J9:L10 de plantilla) */
    fechaElaboracion: { row: 8, col: 13 },
    equipoTrabajo: { row: 9, col: 13 },
    proceso: { row: 10, col: 5 }
};

const TIMEZONE_MEXICO = 'America/Mexico_City';
const FUENTE_SISTEMA = { name: 'Century Gothic', size: 12 };
const FUENTE_ETIQUETA = { name: 'Century Gothic', size: 12, bold: true };

const COL = {
    operacion: 1,
    etapa: 2,
    modoFalla: 3,
    causas: 4,
    ocurrencia: 5,
    efecto: 6,
    severidad: 7,
    controlesPreventivos: 8,
    controlesDeteccion: 9,
    deteccion: 10,
    rpn: 11,
    acciones: 12,
    responsable: 13,
    fechaCompromiso: 14,
    resultado: 15,
    severidadPost: 16,
    ocurrenciaPost: 17,
    deteccionPost: 18,
    rpnPost: 19
};

const MAX_COLUMNAS_SISTEMA = 19;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: true
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

function calcularRpn(ocurrencia, severidad, deteccion) {
    const o = parseFloat(String(ocurrencia || '').trim());
    const s = parseFloat(String(severidad || '').trim());
    const d = parseFloat(String(deteccion || '').trim());
    if (Number.isFinite(o) && Number.isFinite(s) && Number.isFinite(d)) {
        return String(Math.round(o * s * d));
    }
    return String(ocurrencia || severidad || deteccion ? '' : '').trim();
}

function sanitizarFila(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const ocurrencia = String(base.ocurrencia || '').trim();
    const severidad = String(base.severidad || '').trim();
    const deteccion = String(base.deteccion || '').trim();
    const ocurrenciaPost = String(base.ocurrenciaPost || '').trim();
    const severidadPost = String(base.severidadPost || '').trim();
    const deteccionPost = String(base.deteccionPost || '').trim();
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
        rpn: rpnCalc || String(base.rpn || '').trim(),
        acciones: String(base.acciones || '').trim(),
        responsable: String(base.responsable || '').trim(),
        fechaCompromiso: String(base.fechaCompromiso || '').trim(),
        resultado: String(base.resultado || '').trim(),
        severidadPost,
        ocurrenciaPost,
        deteccionPost,
        rpnPost: rpnPostCalc || String(base.rpnPost || '').trim()
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filasRaw = Array.isArray(base.filas) ? base.filas : DATOS_DEFECTO.filas;
    const filas = filasRaw.map(sanitizarFila).filter((f) => f.operacion);
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        area: String(base.area || DATOS_DEFECTO.area).trim(),
        departamento: String(base.departamento || DATOS_DEFECTO.departamento).trim(),
        elaboro: String(base.elaboro || DATOS_DEFECTO.elaboro).trim(),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        proceso: String(base.proceso || DATOS_DEFECTO.proceso).trim() || DATOS_DEFECTO.proceso,
        equipoTrabajo: String(base.equipoTrabajo || DATOS_DEFECTO.equipoTrabajo).trim(),
        filas: filas.length ? filas : DATOS_DEFECTO.filas.map(sanitizarFila)
    };
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
    return normalizarEquipoTrabajo(leerMetaCelda(ws, { row: 9, col: 10 }));
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
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla SGC-F-11 no contiene hojas.');
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
    } catch (err) {
        return driveService.descargarArchivo(fileId);
    }
}

function asignarTexto(celda, texto, horizontal = 'left') {
    celda.value = normalizarSaltosLinea(texto);
    celda.font = { ...(celda.font || {}), ...FUENTE_SISTEMA };
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal
    };
}

function asignarNumeroOCelda(celda, texto) {
    const t = String(texto || '').trim();
    celda.font = { ...(celda.font || {}), ...FUENTE_SISTEMA };
    if (t && /^-?\d+(\.\d+)?$/.test(t)) {
        celda.value = Number(t);
    } else {
        asignarTexto(celda, t);
        return;
    }
    celda.alignment = { ...(celda.alignment || {}), vertical: 'middle', horizontal: 'center' };
}

function aplicarEstiloCelda(celda, fuente, horizontal) {
    celda.font = { ...(celda.font || {}), ...fuente };
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal
    };
}

function aplicarTipografiaSgcF11(ws, numFilasDatos) {
    const aplicarRango = (filaInicio, filaFin, colInicio, colFin, fuente, horizontal) => {
        for (let r = filaInicio; r <= filaFin; r++) {
            for (let c = colInicio; c <= colFin; c++) {
                aplicarEstiloCelda(ws.getRow(r).getCell(c), fuente, horizontal);
            }
        }
    };

    // Cuadros grises fila 8: Century Gothic 12 negritas, centrado
    for (const col of [1, 4, 7, 10]) {
        aplicarEstiloCelda(ws.getRow(8).getCell(col), FUENTE_ETIQUETA, 'center');
    }
    // Etiqueta EQUIPO DE TRABAJO (J9:L10 en plantilla)
    aplicarEstiloCelda(ws.getRow(9).getCell(10), FUENTE_ETIQUETA, 'center');
    // Etiqueta PROCESO (A10:D10)
    aplicarEstiloCelda(ws.getRow(10).getCell(1), FUENTE_ETIQUETA, 'center');

    // Valores meta fila 9 y fecha M8
    for (const { row, col } of [META.area, META.departamento, META.elaboro, META.equipoTrabajo, META.fechaElaboracion]) {
        aplicarEstiloCelda(ws.getRow(row).getCell(col), FUENTE_SISTEMA, 'left');
    }
    aplicarEstiloCelda(ws.getRow(META.proceso.row).getCell(META.proceso.col), FUENTE_SISTEMA, 'left');

    aplicarRango(HEADER_ROW, HEADER_ROW, 1, MAX_COLUMNAS_SISTEMA, FUENTE_ETIQUETA, 'center');
    if (numFilasDatos > 0) {
        aplicarRango(DATA_START_ROW, DATA_START_ROW + numFilasDatos - 1, 1, MAX_COLUMNAS_SISTEMA, FUENTE_SISTEMA, 'left');
    }
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-11 no contiene hojas.');

    const filaFin = encontrarFilaFinDatos(ws);
    const filasDisponibles = Math.max(0, filaFin - DATA_START_ROW);
    if (datos.filas.length > filasDisponibles) {
        ws.spliceRows(filaFin, 0, ...Array.from({ length: datos.filas.length - filasDisponibles }, () => []));
    }

    const filaFinActual = encontrarFilaFinDatos(ws);
    for (let r = DATA_START_ROW; r < filaFinActual; r++) {
        const row = ws.getRow(r);
        for (let c = COL.operacion; c <= COL.rpnPost; c++) {
            row.getCell(c).value = null;
        }
    }

    asignarTexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL), `Revisión: ${datos.revision || '00'}`);
    asignarTexto(
        ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL),
        `Fecha de rev: ${formatearFechaDisplay(datos.fechaRevision)}`
    );

    asignarTexto(ws.getRow(META.area.row).getCell(META.area.col), datos.area);
    asignarTexto(ws.getRow(META.departamento.row).getCell(META.departamento.col), datos.departamento);
    asignarTexto(ws.getRow(META.elaboro.row).getCell(META.elaboro.col), datos.elaboro);
    asignarTexto(
        ws.getRow(META.fechaElaboracion.row).getCell(META.fechaElaboracion.col),
        formatearFechaDisplay(datos.fechaElaboracion)
    );
    asignarTexto(ws.getRow(META.equipoTrabajo.row).getCell(META.equipoTrabajo.col), datos.equipoTrabajo);
    asignarTexto(ws.getRow(META.proceso.row).getCell(META.proceso.col), datos.proceso);

    datos.filas.forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        asignarTexto(row.getCell(COL.operacion), fila.operacion);
        asignarTexto(row.getCell(COL.etapa), fila.etapa);
        asignarTexto(row.getCell(COL.modoFalla), fila.modoFalla);
        asignarTexto(row.getCell(COL.causas), fila.causas);
        asignarNumeroOCelda(row.getCell(COL.ocurrencia), fila.ocurrencia);
        asignarTexto(row.getCell(COL.efecto), fila.efecto);
        asignarNumeroOCelda(row.getCell(COL.severidad), fila.severidad);
        asignarTexto(row.getCell(COL.controlesPreventivos), fila.controlesPreventivos);
        asignarTexto(row.getCell(COL.controlesDeteccion), fila.controlesDeteccion);
        asignarNumeroOCelda(row.getCell(COL.deteccion), fila.deteccion);
        asignarNumeroOCelda(row.getCell(COL.rpn), fila.rpn);
        asignarTexto(row.getCell(COL.acciones), fila.acciones);
        asignarTexto(row.getCell(COL.responsable), fila.responsable);
        asignarTexto(row.getCell(COL.fechaCompromiso), fila.fechaCompromiso);
        asignarTexto(row.getCell(COL.resultado), fila.resultado);
        asignarNumeroOCelda(row.getCell(COL.severidadPost), fila.severidadPost);
        asignarNumeroOCelda(row.getCell(COL.ocurrenciaPost), fila.ocurrenciaPost);
        asignarNumeroOCelda(row.getCell(COL.deteccionPost), fila.deteccionPost);
        asignarNumeroOCelda(row.getCell(COL.rpnPost), fila.rpnPost);
    });

    aplicarTipografiaSgcF11(ws, datos.filas.length);

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
        delete base.revision;
        delete base.fechaRevision;
        delete base.fechaElaboracion;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function datosSonEquivalentes(a, b) {
    return contenidoEsEquivalente(a, b);
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const buffer = await escribirDatosEnPlantilla(datos);
    await excelHistorial.escribirSnapshotDesdeBufferPlantilla(spreadsheetId, sheetTitle, buffer);
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
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function publicarDatosEnGoogleSheet(spreadsheetId, datos) {
    const buffer = await escribirDatosEnPlantilla(datos);
    await excelHistorial.escribirSnapshotDesdeBufferPlantilla(spreadsheetId, SHEET_TITLE, buffer);
    await reforzarFormatoDriveSheet(spreadsheetId, datos.filas?.length || 0);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function reforzarFormatoDriveSheet(spreadsheetId, numFilasDatos) {
    if (!spreadsheetId) {
        return;
    }
    try {
        await driveService.aplicarFormatoVisualSgcF11(spreadsheetId, {
            sheetTitle: SHEET_TITLE,
            numFilasDatos
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

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

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
            const buffer = await escribirDatosEnPlantilla(datos);
            archivoDrive = await subirOReemplazarEnDrive(buffer, null, datos.filas.length);
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

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
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

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive);
    }

    const driveId = registroPrevio?.drive_file_id || null;
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = excelHistorial.fechaAhoraMexicoIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF11({
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

                const archivoDrive = await driveService
                    .obtenerInfoArchivo(driveId)
                    .catch(() => ({ id: driveId }));
                if (!hist.aplicado) {
                    await publicarDatosEnGoogleSheet(driveId, datosGuardar);
                }
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
        } catch (err) {
            console.warn('[SGC-F-11] No se pudo actualizar Google Sheet, reemplazando archivo:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId, datosGuardar.filas.length);

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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay archivo SGC-F-11 en Drive para sincronizar.');
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = await leerDatosDesdeBuffer(buffer, { modo: 'edicion' });

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosPrevios = await leerDatosRegistro(registro);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const fechaCambio = excelHistorial.fechaAhoraMexicoIso();
    const hist = await aplicarHistorialSgcF11({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = hist.tipoCambio === 'formato'
            ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
            : fechaCambio;
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
            console.warn('[SGC-F-11] Archivo previo no encontrado al actualizar plantilla:', err.message);
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
    await reforzarFormatoDriveSheet(archivoDrive.id, datosPublicar.filas.length);

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

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
