/**
 * SGC-F-12 · Notificación de cambios — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-12';
const TEMPLATE_DRIVE_ID = '1n0TAYAe9b-Q_XAYUXYArqqYPz60cLFjY';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-12 Notificacion de cambios (sistema)';
const SHEET_TITLE = 'Notificación';

const HEADER_ROW = 18;
const DATA_START_ROW = 19;
const MAX_FILAS_TABLA = 12;
const REVISION_ROW = 2;
const REVISION_COL = 11;
const FECHA_REV_ROW = 3;
const FECHA_REV_COL = 11;

const TEXT_FIELDS = {
    fecha: { row: 6, startCol: 10, endCol: 11, align: 'center' },
    responsableCambio: { row: 8, startCol: 5, endCol: 11, align: 'left' },
    queSeVaACambiar: { row: 10, startCol: 6, endCol: 11, align: 'left' },
    proposito: { row: 12, startCol: 4, endCol: 11, align: 'left' },
    consecuencias: { row: 14, startCol: 5, endCol: 11, align: 'left' },
    planTrabajo: { row: 17, startCol: 4, endCol: 11, align: 'left' }
};

const LEGACY_TEXT_FIELDS = {
    fecha: { row: 7, startCol: 10, endCol: 11 },
    responsableCambio: { row: 9, startCol: 5, endCol: 11 },
    queSeVaACambiar: { row: 11, startCol: 6, endCol: 11 },
    proposito: { row: 13, startCol: 4, endCol: 11 },
    consecuencias: { row: 15, startCol: 5, endCol: 11 }
};

const COL = {
    actividad: 1,
    asignacion: 6,
    recursos: 9,
    fechaCompromiso: 10,
    verificacion: 12
};

const FIRMAS = {
    elaboro: { row: 33, col: 2, fallbackRow: 32 },
    reviso: { row: 33, col: 6, fallbackRow: 32 },
    autorizo: { row: 33, col: 10, fallbackRow: 32 }
};

const MAX_COLUMNAS_SISTEMA = 12;
const COLUMNA_L_ANCHO_PIXELES = 150;
const TIMEZONE_MEXICO = 'America/Mexico_City';
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: true
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-17',
    fecha: '',
    responsableCambio: '',
    queSeVaACambiar: '',
    proposito: '',
    consecuencias: '',
    planTrabajo: '',
    fechaElaboracion: '2025-01-17',
    elaboro: '',
    reviso: '',
    autorizo: '',
    filas: []
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
    const texto = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        return texto;
    }
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return texto.slice(0, 10);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(d);
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

function camposTextoPrincipales() {
    return Object.entries(TEXT_FIELDS)
        .filter(([key]) => key !== 'planTrabajo')
        .map(([, pos]) => ({
            row: pos.row,
            startCol: pos.startCol,
            endCol: pos.endCol,
            align: pos.align || 'left'
        }));
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function esEtiquetaFirma(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t === 'ELABORÓ' || t === 'ELABORO' || t === 'REVISÓ' || t === 'REVISO'
        || t === 'AUTORIZÓ' || t === 'AUTORIZO'
        || t.includes('DUEÑO DEL PROCESO') || t.includes('EJEC. SIST') || t.includes('DIRECCIÓN GENERAL');
}

function leerCampoTexto(ws, { row, col }) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function leerCampoRango(ws, { row, startCol, endCol }) {
    for (let col = startCol; col <= endCol; col++) {
        const texto = celdaATexto(ws.getRow(row).getCell(col).value);
        if (texto) {
            return normalizarSaltosLinea(texto);
        }
    }
    return '';
}

function leerCampoRangoConFallback(ws, principal, alterno) {
    const texto = leerCampoRango(ws, principal);
    if (texto) {
        return { texto, usoFallback: false };
    }
    if (!alterno) {
        return { texto: '', usoFallback: false };
    }
    const alternoTexto = leerCampoRango(ws, alterno);
    return { texto: alternoTexto, usoFallback: !!alternoTexto };
}

function rangoCeldasRef(config) {
    return `${celdaRef(config.row, config.startCol)}:${celdaRef(config.row, config.endCol)}`;
}

function leerFirma(ws, { row, col, fallbackRow }) {
    const valor = leerCampoTexto(ws, { row, col });
    if (valor && !esEtiquetaFirma(valor)) return valor;
    const fallback = leerCampoTexto(ws, { row: fallbackRow, col });
    if (fallback && !esEtiquetaFirma(fallback)) return fallback;
    return valor && !esEtiquetaFirma(valor) ? valor : '';
}

function normalizarFechaCampo(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const iso = formatearFechaIso(texto);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return texto;
}

function sanitizarFila(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        actividad: String(base.actividad || '').trim(),
        asignacion: String(base.asignacion || '').trim(),
        recursos: String(base.recursos || '').trim(),
        fechaCompromiso: normalizarFechaCampo(base.fechaCompromiso),
        verificacion: String(base.verificacion || '').trim()
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filasRaw = Array.isArray(base.filas) ? base.filas : DATOS_DEFECTO.filas;
    const filas = filasRaw.map(sanitizarFila).filter((f) =>
        f.actividad || f.asignacion || f.recursos || f.fechaCompromiso || f.verificacion
    );
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fecha: formatearFechaIso(base.fecha) || String(base.fecha || '').trim(),
        responsableCambio: String(base.responsableCambio || '').trim(),
        queSeVaACambiar: normalizarSaltosLinea(base.queSeVaACambiar),
        proposito: normalizarSaltosLinea(base.proposito),
        consecuencias: normalizarSaltosLinea(base.consecuencias),
        planTrabajo: normalizarSaltosLinea(base.planTrabajo),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        elaboro: String(base.elaboro || '').trim(),
        reviso: String(base.reviso || '').trim(),
        autorizo: String(base.autorizo || '').trim(),
        filas
    };
}

function textoTieneContenido(valor) {
    return String(valor || '').trim().length > 0;
}

function camposPrincipalesConContenido(datos) {
    if (!datos) return false;
    return [
        datos.fecha,
        datos.responsableCambio,
        datos.queSeVaACambiar,
        datos.proposito,
        datos.consecuencias
    ].some(textoTieneContenido);
}

function camposPrincipalesVacios(datos) {
    return !camposPrincipalesConContenido(datos);
}

function fusionarDatosPreferirDb(datosDrive, datosDb) {
    if (!datosDb) {
        return datosDrive;
    }
    if (!datosDrive) {
        return datosDb;
    }
    if (!camposPrincipalesVacios(datosDrive) || camposPrincipalesVacios(datosDb)) {
        return datosDrive;
    }
    return sanitizarDatos({
        ...datosDrive,
        ...datosDb,
        filas: (Array.isArray(datosDrive.filas) && datosDrive.filas.length)
            ? datosDrive.filas
            : datosDb.filas
    });
}

function necesitaRehidratarDriveDesdeDb(datosDrive, datosDb) {
    return !!datosDb
        && camposPrincipalesVacios(datosDrive)
        && camposPrincipalesConContenido(datosDb);
}

async function publicarDatosEnDrive(driveFileId, datos, filasPrevias = 0, limpiarLegacy = false) {
    if (!driveFileId) {
        return null;
    }
    try {
        const infoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
            return actualizarDatosEnGoogleSheet(driveFileId, datos, filasPrevias, limpiarLegacy);
        }
    } catch (err) {
        console.warn('[SGC-F-12] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
    }
    const buffer = await escribirDatosEnPlantilla(datos);
    const archivo = await subirOReemplazarEnDrive(buffer, driveFileId);
    if (archivo?.id) {
        try {
            await driveService.aplicarFormatoVisualSgcF12(archivo.id, {
                sheetTitle: SHEET_TITLE,
                columnLPixelWidth: COLUMNA_L_ANCHO_PIXELES,
                textFields: camposTextoPrincipales()
            });
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo aplicar formato visual tras reemplazar archivo:', err.message);
        }
    }
    return archivo;
}

function driveEsMasViejoQueDb(registro, archivoDrive) {
    if (!archivoDrive?.modifiedTime || !registro?.ultima_sync_drive) {
        return true;
    }
    const driveTime = new Date(archivoDrive.modifiedTime).getTime();
    const dbTime = new Date(registro.ultima_sync_drive).getTime();
    if (Number.isNaN(driveTime) || Number.isNaN(dbTime)) {
        return true;
    }
    return driveTime <= dbTime;
}

function encontrarFilaFinDatos(ws) {
    const limite = DATA_START_ROW + MAX_FILAS_TABLA;
    for (let r = DATA_START_ROW; r <= limite; r++) {
        const actividad = celdaATexto(ws.getRow(r).getCell(COL.actividad).value);
        const asignacion = celdaATexto(ws.getRow(r).getCell(COL.asignacion).value);
        if (!actividad && !asignacion && r > DATA_START_ROW) {
            const prev = celdaATexto(ws.getRow(r - 1).getCell(COL.actividad).value);
            if (prev) return r;
        }
    }
    return limite;
}

function parsearDatosDesdeHoja(ws) {
    const filaFin = encontrarFilaFinDatos(ws);
    const filas = [];

    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        const actividad = celdaATexto(row.getCell(COL.actividad).value);
        if (!actividad) continue;
        if (actividad.toLowerCase().includes('actividad')) continue;

        filas.push(sanitizarFila({
            actividad,
            asignacion: celdaATexto(row.getCell(COL.asignacion).value),
            recursos: celdaATexto(row.getCell(COL.recursos).value),
            fechaCompromiso: celdaATexto(row.getCell(COL.fechaCompromiso).value),
            verificacion: celdaATexto(row.getCell(COL.verificacion).value)
        }));
    }

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL).value);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);

    const fechaRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.fecha, LEGACY_TEXT_FIELDS.fecha);
    const respRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.responsableCambio, LEGACY_TEXT_FIELDS.responsableCambio);
    const queRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.queSeVaACambiar, LEGACY_TEXT_FIELDS.queSeVaACambiar);
    const propRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.proposito, LEGACY_TEXT_FIELDS.proposito);
    const consRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.consecuencias, LEGACY_TEXT_FIELDS.consecuencias);
    const legacyUsed = [
        fechaRes.usoFallback,
        respRes.usoFallback,
        queRes.usoFallback,
        propRes.usoFallback,
        consRes.usoFallback
    ].some(Boolean);
    const fechaLeida = fechaRes.texto;

    return {
        datos: sanitizarDatos({
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
        fecha: fechaLeida,
        responsableCambio: respRes.texto,
        queSeVaACambiar: queRes.texto,
        proposito: propRes.texto,
        consecuencias: consRes.texto,
        planTrabajo: leerCampoRango(ws, TEXT_FIELDS.planTrabajo),
        fechaElaboracion: fechaLeida
            ? formatearFechaIso(fechaLeida)
            : DATOS_DEFECTO.fechaElaboracion,
        elaboro: leerFirma(ws, FIRMAS.elaboro),
        reviso: leerFirma(ws, FIRMAS.reviso),
        autorizo: leerFirma(ws, FIRMAS.autorizo),
        filas
        }),
        legacyUsed
    };
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla SGC-F-12 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const { datos } = await leerDatosDesdeBuffer(buffer);
    return datos;
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

function asignarTexto(celda, texto) {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = { ...(celda.alignment || {}), vertical: 'middle', wrapText: true };
}

function asignarTextoConAlineacion(celda, texto, align = 'left') {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal: align === 'center' ? 'center' : 'left'
    };
}

function asignarTextoEnRango(ws, config, texto) {
    const valor = normalizarSaltosLinea(texto);
    asignarTextoConAlineacion(
        ws.getRow(config.row).getCell(config.startCol),
        valor,
        config.align || 'left'
    );
}

function asignarFirma(ws, config, valor) {
    const texto = String(valor || '').trim();
    if (!texto) return;
    const celda = ws.getRow(config.row).getCell(config.col);
    if (celdaATexto(celda.value) && !esEtiquetaFirma(celdaATexto(celda.value))) {
        asignarTexto(celda, texto);
    } else {
        asignarTexto(celda, texto);
    }
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-12 no contiene hojas.');

    const filaFin = encontrarFilaFinDatos(ws);
    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        Object.values(COL).forEach((c) => {
            row.getCell(c).value = null;
        });
    }

    ws.getRow(REVISION_ROW).getCell(REVISION_COL).value = `Revisión: ${datos.revision || '00'}`;
    ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL).value =
        `Fecha Rev.: ${formatearFechaDisplay(datos.fechaRevision)}`;

    Object.entries(TEXT_FIELDS).forEach(([key, pos]) => {
        if (key === 'planTrabajo') {
            return;
        }
        const valor = key === 'fecha' ? formatearFechaDisplay(datos.fecha) : datos[key];
        asignarTextoEnRango(ws, pos, valor);
    });

    datos.filas.slice(0, MAX_FILAS_TABLA).forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        asignarTexto(row.getCell(COL.actividad), fila.actividad);
        asignarTexto(row.getCell(COL.asignacion), fila.asignacion);
        asignarTexto(row.getCell(COL.recursos), fila.recursos);
        const fc = fila.fechaCompromiso;
        const fcDisplay = /^\d{4}-\d{2}-\d{2}$/.test(fc) ? formatearFechaDisplay(fc) : fc;
        asignarTexto(row.getCell(COL.fechaCompromiso), fcDisplay);
        asignarTexto(row.getCell(COL.verificacion), fila.verificacion);
    });

    asignarFirma(ws, FIRMAS.elaboro, datos.elaboro);
    asignarFirma(ws, FIRMAS.reviso, datos.reviso);
    asignarFirma(ws, FIRMAS.autorizo, datos.autorizo);

    ws.getColumn(COL.verificacion).width = COLUMNA_L_ANCHO_PIXELES / 7;

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function columnaALetra(col) {
    let n = col;
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function celdaRef(row, col) {
    return `${columnaALetra(col)}${row}`;
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, filasPrevias = 0, limpiarLegacy = false, sheetTitle = SHEET_TITLE) {
    const actualizaciones = [];

    actualizaciones.push({
        range: rangoSheet(celdaRef(REVISION_ROW, REVISION_COL), sheetTitle),
        values: [[`Revisión: ${datos.revision || '00'}`]]
    });
    actualizaciones.push({
        range: rangoSheet(celdaRef(FECHA_REV_ROW, FECHA_REV_COL), sheetTitle),
        values: [[`Fecha Rev.: ${formatearFechaDisplay(datos.fechaRevision)}`]]
    });

    Object.entries(TEXT_FIELDS).forEach(([key, pos]) => {
        if (key === 'planTrabajo') {
            return;
        }
        const valor = key === 'fecha' ? formatearFechaDisplay(datos.fecha) : (datos[key] || '');
        actualizaciones.push({
            range: rangoSheet(celdaRef(pos.row, pos.startCol), sheetTitle),
            values: [[normalizarSaltosLinea(valor)]]
        });
    });

    if (limpiarLegacy) {
        Object.values(LEGACY_TEXT_FIELDS).forEach((pos) => {
            actualizaciones.push({
                range: rangoSheet(celdaRef(pos.row, pos.startCol), sheetTitle),
                values: [['']]
            });
        });
    }

    const totalFilas = Math.max(Array.isArray(datos.filas) ? datos.filas.length : 0, filasPrevias, 1);
    for (let idx = 0; idx < totalFilas; idx++) {
        const fila = (datos.filas && datos.filas[idx]) || {
            actividad: '',
            asignacion: '',
            recursos: '',
            fechaCompromiso: '',
            verificacion: ''
        };
        const rowNum = DATA_START_ROW + idx;
        const fc = fila.fechaCompromiso;
        const fcDisplay = /^\d{4}-\d{2}-\d{2}$/.test(fc) ? formatearFechaDisplay(fc) : fc;

        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.actividad), sheetTitle),
            values: [[normalizarSaltosLinea(fila.actividad)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.asignacion), sheetTitle),
            values: [[normalizarSaltosLinea(fila.asignacion)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.recursos), sheetTitle),
            values: [[normalizarSaltosLinea(fila.recursos)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.fechaCompromiso), sheetTitle),
            values: [[fcDisplay]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.verificacion), sheetTitle),
            values: [[normalizarSaltosLinea(fila.verificacion)]]
        });
    }

    if (datos.elaboro) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.elaboro.row, FIRMAS.elaboro.col), sheetTitle),
            values: [[datos.elaboro]]
        });
    }
    if (datos.reviso) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.reviso.row, FIRMAS.reviso.col), sheetTitle),
            values: [[datos.reviso]]
        });
    }
    if (datos.autorizo) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.autorizo.row, FIRMAS.autorizo.col), sheetTitle),
            values: [[datos.autorizo]]
        });
    }

    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(
    spreadsheetId,
    datos,
    filasPrevias = 0,
    limpiarLegacy = false,
    sheetTitle = SHEET_TITLE
) {
    const actualizaciones = datosAActualizacionesSheet(datos, filasPrevias, limpiarLegacy, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    if (sheetTitle === SHEET_TITLE) {
        try {
            await driveService.recortarColumnasGoogleSheet(spreadsheetId, DRIVE_SHEET_OPTIONS);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron recortar columnas en Drive:', err.message);
        }
        try {
            await driveService.aplicarFormatoVisualSgcF12(spreadsheetId, {
                sheetTitle: SHEET_TITLE,
                columnLPixelWidth: COLUMNA_L_ANCHO_PIXELES,
                textFields: camposTextoPrincipales()
            });
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo aplicar formato visual en Drive:', err.message);
        }
    }
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const filasPrevias = Array.isArray(datos?.filas) ? datos.filas.length : 0;
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, filasPrevias, false, sheetTitle);
}

async function aplicarHistorialSgcF12(opciones) {
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
                console.warn('[SGC-F-12] No se pudo eliminar copia en Drive:', err.message);
            }
        }
    }
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

function datosSonEquivalentes(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
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

function aplicarRevisionPorCambio(revisionActual, fechaRevisionActual, huboCambio, origen = 'sistema') {
    let revision = String(revisionActual || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision;
    let fechaRevision = formatearFechaIso(fechaRevisionActual) || DATOS_DEFECTO.fechaRevision;
    if (huboCambio && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        fechaRevision = fechaHoyIso();
    }
    return { revision, fechaRevision };
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const actualizado = await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
            return actualizado;
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;
    let legacyUsado = false;
    const datosDb = await leerDatosRegistro(registro);

    const driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
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
            const lectura = await leerDatosDesdeBuffer(buffer);
            datos = lectura.datos;
            legacyUsado = lectura.legacyUsed;
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    } else {
        datos = fusionarDatosPreferirDb(datos, datosDb);
    }

    const necesitaRehidratacion = necesitaRehidratarDriveDesdeDb(datos, datosDb);

    if (necesitaRehidratacion && driveFileId) {
        try {
            datos = datosDb;
            const filasPrevias = Array.isArray(datos?.filas) ? datos.filas.length : 0;
            const actualizado = await publicarDatosEnDrive(driveFileId, datos, filasPrevias, true);
            if (actualizado) {
                archivoDrive = actualizado;
            }
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo rehidratar datos en Drive desde BD:', err.message);
        }
    }

    if (legacyUsado && driveFileId) {
        try {
            const filasPrevias = Array.isArray(datos?.filas) ? datos.filas.length : 0;
            const actualizado = await actualizarDatosEnGoogleSheet(driveFileId, datos, filasPrevias, true);
            if (actualizado) {
                archivoDrive = actualizado;
            }
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo migrar celdas legacy en Drive:', err.message);
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

    if (!driveFileId) {
        try {
            const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
                || datos.fechaElaboracion
                || DATOS_DEFECTO.fechaElaboracion;
            const buffer = await escribirDatosEnPlantilla(datos);
            archivoDrive = await subirOReemplazarEnDrive(buffer, null);
            await guardarRegistroDb(pool, {
                driveFileId: archivoDrive.id,
                datos,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
        }
    }

    registro = {
        ...registro,
        drive_file_id: registro?.drive_file_id || archivoDrive?.id || driveFileId || null
    };
    return construirRespuesta(registro, datos, archivoDrive);
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
        let datosDriveActuales = null;
        try {
            const bufferDrive = await descargarBufferDrive(registroPrevio.drive_file_id);
            const lecturaDrive = await leerDatosDesdeBuffer(bufferDrive);
            datosDriveActuales = lecturaDrive.datos;
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo leer Drive para validar sincronización:', err.message);
        }

        if (!necesitaRehidratarDriveDesdeDb(datosDriveActuales, datosEntrada)) {
            const archivoDrive = await driveService
                .obtenerInfoArchivo(registroPrevio.drive_file_id)
                .catch(() => null);
            return construirRespuesta(registroPrevio, datosEntrada, archivoDrive);
        }
    }

    const driveId = registroPrevio?.drive_file_id || null;
    const filasPrevias = Array.isArray(datosPrevios?.filas) ? datosPrevios.filas.length : 0;
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = excelHistorial.fechaAhoraMexicoIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF12({
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
                    await actualizarDatosEnGoogleSheet(
                        driveId,
                        datosGuardar,
                        filasPrevias,
                        necesitaRehidratarDriveDesdeDb(null, datosGuardar)
                    );
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
            console.warn('[SGC-F-12] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    let archivoDrive = await publicarDatosEnDrive(
        driveId,
        datosGuardar,
        filasPrevias,
        true
    );
    if (!archivoDrive) {
        const buffer = await escribirDatosEnPlantilla(datosGuardar);
        archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive?.id || driveId,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(archivoDrive?.id || driveId, SHEET_TITLE)
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
        return cargarFormato(pool);
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const lectura = await leerDatosDesdeBuffer(buffer, { modo: 'edicion' });
    let datosDrive = lectura.datos;
    const legacyUsado = lectura.legacyUsed;
    const archivoDriveInfo = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosPrevios = await leerDatosRegistro(registro);
    datosDrive = fusionarDatosPreferirDb(datosDrive, datosPrevios);
    const necesitaRehidratacion = necesitaRehidratarDriveDesdeDb(
        lectura.datos,
        datosPrevios
    );

    if (necesitaRehidratacion) {
        try {
            datosDrive = datosPrevios;
            const filasPrevias = Array.isArray(datosDrive?.filas) ? datosDrive.filas.length : 0;
            await publicarDatosEnDrive(driveFileId, datosDrive, filasPrevias, true);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo rehidratar datos en Drive desde BD:', err.message);
        }
    }
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const fechaCambio = excelHistorial.fechaAhoraMexicoIso();
    const hist = await aplicarHistorialSgcF12({
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
    let archivoDrive = null;
    if (legacyUsado) {
        try {
            const filasPrevias = Array.isArray(datosDrive?.filas) ? datosDrive.filas.length : 0;
            archivoDrive = await actualizarDatosEnGoogleSheet(driveFileId, datosDrive, filasPrevias, true);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo migrar celdas legacy en Drive:', err.message);
        }
    }
    if (!archivoDrive) {
        archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    }
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
            console.warn('[SGC-F-12] Archivo previo no encontrado al actualizar plantilla:', err.message);
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
