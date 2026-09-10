/**
 * SGC-F-24 · Control de cambios — persistencia en biznaga_sgc y sync con Drive.
 *
 * Plantilla (hoja «Plantilla»):
 *   C5 no. proyecto · E6 fecha · C6 producto/servicio · C7 cliente
 *   G8/G9/G10 tipo de cambio (X)
 *   A13 descripción · A19 motivo
 *   Acciones filas 26–30 (expandible) · B33/C33 resultado · D32 aprobó
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-24';
const TEMPLATE_DRIVE_ID = '1ynjots5lpgG9misbTjnw5g6aJy9pB7mkD0tyTMVNfqY';
const DRIVE_FILE_ID_SISTEMA = '1ynjots5lpgG9misbTjnw5g6aJy9pB7mkD0tyTMVNfqY';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** PDF firmados (histórico por cambio); distinto de la carpeta del Google Sheet. */
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-24 Control de cambios (sistema)';
const SHEET_TITLE = 'Plantilla';
const MAX_ACCIONES = 20;
const ACCIONES_SLOTS_BASE = 5;

const LAYOUT_BASE = {
    revision: { row: 2, col: 6 },
    fechaRevision: { row: 3, col: 6 },
    numeroProyecto: { row: 5, col: 3 },
    fecha: { row: 6, col: 5 },
    productoServicio: { row: 6, col: 3 },
    cliente: { row: 7, col: 3 },
    tipoRequisitos: { row: 8, col: 7 },
    tipoDiseno: { row: 9, col: 7 },
    tipoProduccion: { row: 10, col: 7 },
    descripcion: { row: 13, col: 1 },
    motivo: { row: 19, col: 1 },
    accionesStart: 26,
    accionesEnd: 30,
    accionesSlots: ACCIONES_SLOTS_BASE,
    resultadosLabelRow: 31,
    resultadoAprobado: { row: 33, col: 2 },
    resultadoNoAprobado: { row: 33, col: 3 },
    aprobo: { row: 32, col: 4 }
};

const ACCION_DEFECTO = { descripcion: '', responsable: '', fechaCompromiso: '' };

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-20',
    revision: '00',
    fechaRevision: '2025-01-20',
    cambios: [],
    cambioActivoId: null
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

function etiquetaNormalizada(valor) {
    return celdaATexto(valor)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[:.]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function etiquetaEs(valor, ...needles) {
    const t = etiquetaNormalizada(valor);
    return needles.some((n) => t === n || t.startsWith(n));
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (fecha instanceof Date) {
        if (Number.isNaN(fecha.getTime())) return '';
        // ExcelJS / Drive XLSX suelen entregar medianoche UTC.
        const y = fecha.getUTCFullYear();
        const mo = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const day = String(fecha.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    }
    const raw = String(fecha).trim();
    const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const m = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
        const day = m[1].padStart(2, '0');
        const month = m[2].padStart(2, '0');
        let year = m[3];
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
    }
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return formatearFechaIso(d);
    }
    return raw.slice(0, 10);
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

/** ISO → DD-MM-YYYY (hoja). */
function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y}`;
}

/** ISO → DD-MM-YY (meta Revisión). */
function formatearFechaRevCorta(iso) {
    const f = formatearFechaIso(iso);
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y.slice(2)}`;
}

function extraerRevision(texto) {
    const m = String(texto || '').match(/(\d{2})/);
    return m ? m[1] : '00';
}

function extraerFechaRevision(texto) {
    const iso = formatearFechaIso(texto);
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const m = String(texto || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    return m ? formatearFechaIso(m[0]) : '';
}

function marcaX(valor) {
    const t = String(valor || '').trim().toUpperCase();
    return t === 'X' || t === '✕' || t === '✗' || t === 'SI' || t === 'SÍ' || t === '1' || t === 'TRUE';
}

function textoMarca(activo) {
    return activo ? 'X' : '';
}

function normalizarResultadoRevision(valor) {
    const t = String(valor || '').trim().toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (t === 'aprobado' || t === 'aprobada' || t === 'si' || t === 'ok') return 'aprobado';
    return 'no_aprobado';
}

function sanitizarAccion(item) {
    return {
        descripcion: normalizarSaltosLinea(item?.descripcion || item?.accion || ''),
        responsable: normalizarSaltosLinea(item?.responsable || ''),
        fechaCompromiso: formatearFechaIso(item?.fechaCompromiso || item?.fecha || '')
    };
}

function esAccionVacia(item) {
    const a = sanitizarAccion(item);
    return !a.descripcion && !a.responsable && !a.fechaCompromiso;
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) {
        out.push(factory());
    }
    return out;
}

function nuevoIdCambio() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `cg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-24 Control de cambios firmado.pdf').trim()
            || 'SGC-F-24 Control de cambios firmado.pdf',
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function crearCambioVacio() {
    return {
        id: nuevoIdCambio(),
        folio: '',
        numeroProyecto: '',
        fecha: '',
        productoServicio: '',
        cliente: '',
        tipoRequisitos: false,
        tipoDiseno: false,
        tipoProduccion: false,
        descripcion: '',
        motivo: '',
        acciones: [{ ...ACCION_DEFECTO }],
        resultadoRevision: 'no_aprobado',
        aprobo: '',
        pdfFirmado: null
    };
}

function sanitizarCambio(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const acciones = (Array.isArray(base.acciones) ? base.acciones : [])
        .map(sanitizarAccion)
        .filter((a) => !esAccionVacia(a))
        .slice(0, MAX_ACCIONES);
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);

    return {
        id: String(base.id || '').trim() || nuevoIdCambio(),
        folio: String(base.folio || '').trim().toUpperCase(),
        numeroProyecto: String(base.numeroProyecto || base.numero_proyecto || '').trim(),
        fecha: formatearFechaIso(base.fecha),
        productoServicio: String(base.productoServicio || base.producto_servicio || '').trim(),
        cliente: String(base.cliente || '').trim(),
        tipoRequisitos: !!(base.tipoRequisitos ?? base.tipo_requisitos),
        tipoDiseno: !!(base.tipoDiseno ?? base.tipo_diseno),
        tipoProduccion: !!(base.tipoProduccion ?? base.tipo_produccion),
        descripcion: normalizarSaltosLinea(base.descripcion),
        motivo: normalizarSaltosLinea(base.motivo),
        acciones: conFilasMinimas(acciones, 1, () => ({ ...ACCION_DEFECTO })),
        // Aprobación automática: solo con Versión firmada (PDF).
        resultadoRevision: pdfFirmado ? 'aprobado' : 'no_aprobado',
        aprobo: String(base.aprobo || '').trim(),
        pdfFirmado
    };
}

function esCambioLegacyPlano(base) {
    return !Array.isArray(base?.cambios)
        && !!(base?.numeroProyecto || base?.productoServicio || base?.cliente
            || base?.descripcion || base?.motivo || base?.acciones
            || base?.fecha || base?.tipoRequisitos || base?.tipoDiseno || base?.tipoProduccion);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let cambiosRaw = [];
    if (Array.isArray(base.cambios)) {
        cambiosRaw = base.cambios;
    } else if (esCambioLegacyPlano(base)) {
        cambiosRaw = [base];
    }
    const cambios = cambiosRaw.map(sanitizarCambio);
    const cambioActivoId = base.cambioActivoId
        ? String(base.cambioActivoId)
        : (cambios[0]?.id || null);

    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: extraerFechaRevision(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        cambios,
        cambioActivoId: cambioActivoId && cambios.some((c) => c.id === cambioActivoId)
            ? cambioActivoId
            : (cambios[0]?.id || null)
    };
}

function resolverCambioActivo(datos) {
    const lista = Array.isArray(datos?.cambios) ? datos.cambios : [];
    if (!lista.length) return crearCambioVacio();
    const id = datos?.cambioActivoId;
    if (id) {
        const found = lista.find((c) => c.id === id);
        if (found) return found;
    }
    return lista[0];
}

/**
 * Aplana el cambio activo para los escritores de hoja (mapeo de celdas).
 */
function aPayloadHoja(datos) {
    const d = sanitizarDatos(datos);
    const c = resolverCambioActivo(d);
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fechaElaboracion: d.fechaElaboracion,
        numeroProyecto: c.numeroProyecto,
        fecha: c.fecha,
        productoServicio: c.productoServicio,
        cliente: c.cliente,
        tipoRequisitos: c.tipoRequisitos,
        tipoDiseno: c.tipoDiseno,
        tipoProduccion: c.tipoProduccion,
        descripcion: c.descripcion,
        motivo: c.motivo,
        acciones: c.acciones,
        resultadoRevision: c.resultadoRevision,
        aprobo: c.aprobo
    };
}

function cambioTieneContenido(c) {
    if (!c) return false;
    return !!(c.numeroProyecto || c.fecha || c.productoServicio || c.cliente || c.folio
        || c.descripcion || c.motivo || c.aprobo || c.resultadoRevision
        || c.tipoRequisitos || c.tipoDiseno || c.tipoProduccion
        || (Array.isArray(c.acciones) && c.acciones.some((a) => !esAccionVacia(a)))
        || c.pdfFirmado?.driveFileId);
}

function hojaTieneContenido(datosHoja) {
    const hoja = sanitizarDatos(datosHoja || {});
    if (hoja.cambios.length) return hoja.cambios.some(cambioTieneContenido);
    return cambioTieneContenido(resolverCambioActivo(hoja));
}

/**
 * Prefiere archivero BD; fusiona campos de la hoja Drive solo en el cambio activo.
 * Conserva el resto de cambios y sus pdfFirmado.
 */
function fusionarHojaEnCambioActivo(datosDb, datosHoja) {
    const db = sanitizarDatos(datosDb || DATOS_DEFECTO);
    const hoja = sanitizarDatos(datosHoja || {});
    const hojaCambio = resolverCambioActivo(hoja);

    if (!db.cambios.length) {
        if (!hojaTieneContenido(hoja)) {
            return db;
        }
        const primero = sanitizarCambio({ ...hojaCambio, pdfFirmado: null });
        return sanitizarDatos({
            revision: hoja.revision || db.revision,
            fechaRevision: hoja.fechaRevision || db.fechaRevision,
            fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
            cambios: [primero],
            cambioActivoId: primero.id
        });
    }

    const activaId = db.cambioActivoId && db.cambios.some((c) => c.id === db.cambioActivoId)
        ? db.cambioActivoId
        : db.cambios[0].id;

    const cambios = db.cambios.map((c) => {
        if (c.id !== activaId) return c;
        return sanitizarCambio({
            ...c,
            numeroProyecto: hojaCambio.numeroProyecto,
            fecha: hojaCambio.fecha,
            productoServicio: hojaCambio.productoServicio,
            cliente: hojaCambio.cliente,
            tipoRequisitos: hojaCambio.tipoRequisitos,
            tipoDiseno: hojaCambio.tipoDiseno,
            tipoProduccion: hojaCambio.tipoProduccion,
            descripcion: hojaCambio.descripcion,
            motivo: hojaCambio.motivo,
            acciones: hojaCambio.acciones,
            resultadoRevision: hojaCambio.resultadoRevision,
            aprobo: hojaCambio.aprobo,
            folio: c.folio,
            pdfFirmado: c.pdfFirmado
        });
    });

    return sanitizarDatos({
        revision: hoja.revision || db.revision,
        fechaRevision: hoja.fechaRevision || db.fechaRevision,
        fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
        cambios,
        cambioActivoId: activaId
    });
}

function buscarFilaEtiqueta(ws, needles, maxRow = 80) {
    const maxCol = Math.min(Number(ws.columnCount) || 7, 7);
    for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
            if (etiquetaEs(row.getCell(c).value, ...needles)) {
                return { row: r, col: c };
            }
        }
    }
    return null;
}

function parsearLayoutDesdeHoja(ws) {
    const layout = { ...LAYOUT_BASE };
    const resultados = buscarFilaEtiqueta(ws, ['resultados de la revision', 'resultados de la revisión']);
    const accionesHeader = buscarFilaEtiqueta(ws, ['acciones']);
    const responsableHeader = buscarFilaEtiqueta(ws, ['responsable']);

    if (resultados) {
        layout.resultadosLabelRow = resultados.row;
        layout.resultadoAprobado = { row: resultados.row + 2, col: 2 };
        layout.resultadoNoAprobado = { row: resultados.row + 2, col: 3 };
        layout.aprobo = { row: resultados.row + 1, col: 4 };
    }

    const startAcciones = (accionesHeader && responsableHeader && accionesHeader.row === responsableHeader.row)
        ? accionesHeader.row + 1
        : LAYOUT_BASE.accionesStart;
    layout.accionesStart = startAcciones;
    layout.accionesEnd = Math.max(startAcciones, layout.resultadosLabelRow - 1);
    layout.accionesSlots = Math.max(1, layout.accionesEnd - layout.accionesStart + 1);

    return layout;
}

function parsearDatosDesdeHoja(ws) {
    const layout = parsearLayoutDesdeHoja(ws);
    const acciones = [];
    for (let r = layout.accionesStart; r <= layout.accionesEnd; r++) {
        const row = ws.getRow(r);
        const item = sanitizarAccion({
            descripcion: celdaATexto(row.getCell(1).value),
            responsable: celdaATexto(row.getCell(4).value),
            fechaCompromiso: celdaATexto(row.getCell(6).value)
        });
        if (!esAccionVacia(item)) acciones.push(item);
    }

    const aprobado = marcaX(celdaATexto(ws.getRow(layout.resultadoAprobado.row).getCell(layout.resultadoAprobado.col).value));
    const noAprobado = marcaX(celdaATexto(ws.getRow(layout.resultadoNoAprobado.row).getCell(layout.resultadoNoAprobado.col).value));
    let resultadoRevision = '';
    if (aprobado && !noAprobado) resultadoRevision = 'aprobado';
    else if (noAprobado && !aprobado) resultadoRevision = 'no_aprobado';
    else if (aprobado) resultadoRevision = 'aprobado';

    return sanitizarDatos({
        revision: extraerRevision(celdaATexto(ws.getRow(layout.revision.row).getCell(layout.revision.col).value)),
        fechaRevision: extraerFechaRevision(celdaATexto(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col).value)),
        numeroProyecto: celdaATexto(ws.getRow(layout.numeroProyecto.row).getCell(layout.numeroProyecto.col).value),
        fecha: celdaATexto(ws.getRow(layout.fecha.row).getCell(layout.fecha.col).value),
        productoServicio: celdaATexto(ws.getRow(layout.productoServicio.row).getCell(layout.productoServicio.col).value),
        cliente: celdaATexto(ws.getRow(layout.cliente.row).getCell(layout.cliente.col).value),
        tipoRequisitos: marcaX(celdaATexto(ws.getRow(layout.tipoRequisitos.row).getCell(layout.tipoRequisitos.col).value)),
        tipoDiseno: marcaX(celdaATexto(ws.getRow(layout.tipoDiseno.row).getCell(layout.tipoDiseno.col).value)),
        tipoProduccion: marcaX(celdaATexto(ws.getRow(layout.tipoProduccion.row).getCell(layout.tipoProduccion.col).value)),
        descripcion: celdaATexto(ws.getRow(layout.descripcion.row).getCell(layout.descripcion.col).value),
        motivo: celdaATexto(ws.getRow(layout.motivo.row).getCell(layout.motivo.col).value),
        acciones,
        resultadoRevision,
        aprobo: celdaATexto(ws.getRow(layout.aprobo.row).getCell(layout.aprobo.col).value)
    });
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

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(col)}${row}`, sheetTitle),
        values: [[valor ?? '']]
    });
}

function aplicarExtrasAlLayout(layout, extraAcciones) {
    if (!extraAcciones) return layout;
    return {
        ...layout,
        accionesEnd: layout.accionesEnd + extraAcciones,
        accionesSlots: layout.accionesSlots + extraAcciones,
        resultadosLabelRow: layout.resultadosLabelRow + extraAcciones,
        resultadoAprobado: {
            ...layout.resultadoAprobado,
            row: layout.resultadoAprobado.row + extraAcciones
        },
        resultadoNoAprobado: {
            ...layout.resultadoNoAprobado,
            row: layout.resultadoNoAprobado.row + extraAcciones
        },
        aprobo: {
            ...layout.aprobo,
            row: layout.aprobo.row + extraAcciones
        }
    };
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

async function asegurarFilasAcciones(spreadsheetId, sheetTitle, datos, layout) {
    const d = aPayloadHoja(datos);
    const necesarias = Math.min(MAX_ACCIONES, Math.max(ACCIONES_SLOTS_BASE, d.acciones.length));
    const extra = Math.max(0, necesarias - layout.accionesSlots);
    if (!extra) {
        return { layout, insertoFilas: false };
    }

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return { layout, insertoFilas: false };
    }

    // Sheets API startIndex es 0-based: pasar accionesEnd (1-based última fila)
    // inserta justo antes de «Resultados» (misma convención que F-16).
    await driveService.insertarFilasGoogleSheet(
        spreadsheetId,
        sheetId,
        layout.accionesEnd,
        extra,
        { inheritFromBefore: true }
    );
    return { layout: aplicarExtrasAlLayout(layout, extra), insertoFilas: true };
}

function datosAActualizacionesSheet(datos, sheetTitle, layout) {
    const d = aPayloadHoja(datos);
    const actualizaciones = [];

    pushUpdate(actualizaciones, layout.revision.row, layout.revision.col, `Revisión: ${d.revision}`, sheetTitle);
    pushUpdate(
        actualizaciones,
        layout.fechaRevision.row,
        layout.fechaRevision.col,
        `Fecha Rev.: ${formatearFechaRevCorta(d.fechaRevision)}`,
        sheetTitle
    );
    pushUpdate(actualizaciones, layout.numeroProyecto.row, layout.numeroProyecto.col, d.numeroProyecto || '', sheetTitle);
    pushUpdate(
        actualizaciones,
        layout.fecha.row,
        layout.fecha.col,
        formatearFechaDisplay(d.fecha) || '',
        sheetTitle
    );
    pushUpdate(actualizaciones, layout.productoServicio.row, layout.productoServicio.col, d.productoServicio || '', sheetTitle);
    pushUpdate(actualizaciones, layout.cliente.row, layout.cliente.col, d.cliente || '', sheetTitle);
    pushUpdate(actualizaciones, layout.tipoRequisitos.row, layout.tipoRequisitos.col, textoMarca(d.tipoRequisitos), sheetTitle);
    pushUpdate(actualizaciones, layout.tipoDiseno.row, layout.tipoDiseno.col, textoMarca(d.tipoDiseno), sheetTitle);
    pushUpdate(actualizaciones, layout.tipoProduccion.row, layout.tipoProduccion.col, textoMarca(d.tipoProduccion), sheetTitle);
    pushUpdate(actualizaciones, layout.descripcion.row, layout.descripcion.col, d.descripcion || '', sheetTitle);
    pushUpdate(actualizaciones, layout.motivo.row, layout.motivo.col, d.motivo || '', sheetTitle);

    for (let i = 0; i < layout.accionesSlots; i++) {
        const row = layout.accionesStart + i;
        const item = i < d.acciones.length ? d.acciones[i] : ACCION_DEFECTO;
        const vacia = i >= d.acciones.length || esAccionVacia(item);
        pushUpdate(actualizaciones, row, 1, vacia ? '' : (item.descripcion || ''), sheetTitle);
        pushUpdate(actualizaciones, row, 4, vacia ? '' : (item.responsable || ''), sheetTitle);
        pushUpdate(
            actualizaciones,
            row,
            6,
            vacia ? '' : (formatearFechaDisplay(item.fechaCompromiso) || ''),
            sheetTitle
        );
    }

    pushUpdate(
        actualizaciones,
        layout.resultadoAprobado.row,
        layout.resultadoAprobado.col,
        textoMarca(d.resultadoRevision === 'aprobado'),
        sheetTitle
    );
    pushUpdate(
        actualizaciones,
        layout.resultadoNoAprobado.row,
        layout.resultadoNoAprobado.col,
        textoMarca(d.resultadoRevision === 'no_aprobado'),
        sheetTitle
    );
    pushUpdate(actualizaciones, layout.aprobo.row, layout.aprobo.col, d.aprobo || '', sheetTitle);

    return actualizaciones;
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.numFmt = '@';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function insertarFilasAccionesEnWorksheet(ws, layout, extra) {
    if (!extra || extra < 0) return layout;
    const insertAt = layout.resultadosLabelRow;
    for (let i = 0; i < extra; i++) {
        ws.spliceRows(insertAt, 0, []);
    }
    return aplicarExtrasAlLayout(layout, extra);
}

function escribirDatosEnHoja(ws, datos) {
    const d = aPayloadHoja(datos);
    let layout = parsearLayoutDesdeHoja(ws);
    const necesarias = Math.min(MAX_ACCIONES, Math.max(ACCIONES_SLOTS_BASE, d.acciones.length));
    const extra = Math.max(0, necesarias - layout.accionesSlots);
    if (extra > 0) {
        layout = insertarFilasAccionesEnWorksheet(ws, layout, extra);
    }

    asignarTextoSimple(ws.getRow(layout.revision.row).getCell(layout.revision.col), `Revisión: ${d.revision}`);
    asignarTextoSimple(
        ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col),
        `Fecha Rev.: ${formatearFechaRevCorta(d.fechaRevision)}`
    );
    asignarTextoSimple(ws.getRow(layout.numeroProyecto.row).getCell(layout.numeroProyecto.col), d.numeroProyecto || '');
    asignarTextoSimple(
        ws.getRow(layout.fecha.row).getCell(layout.fecha.col),
        formatearFechaDisplay(d.fecha) || '',
        'center'
    );
    asignarTextoSimple(ws.getRow(layout.productoServicio.row).getCell(layout.productoServicio.col), d.productoServicio || '');
    asignarTextoSimple(ws.getRow(layout.cliente.row).getCell(layout.cliente.col), d.cliente || '');
    asignarTextoSimple(
        ws.getRow(layout.tipoRequisitos.row).getCell(layout.tipoRequisitos.col),
        textoMarca(d.tipoRequisitos),
        'center'
    );
    asignarTextoSimple(
        ws.getRow(layout.tipoDiseno.row).getCell(layout.tipoDiseno.col),
        textoMarca(d.tipoDiseno),
        'center'
    );
    asignarTextoSimple(
        ws.getRow(layout.tipoProduccion.row).getCell(layout.tipoProduccion.col),
        textoMarca(d.tipoProduccion),
        'center'
    );
    asignarTextoSimple(ws.getRow(layout.descripcion.row).getCell(layout.descripcion.col), d.descripcion || '');
    asignarTextoSimple(ws.getRow(layout.motivo.row).getCell(layout.motivo.col), d.motivo || '');

    for (let i = 0; i < layout.accionesSlots; i++) {
        const row = ws.getRow(layout.accionesStart + i);
        const item = i < d.acciones.length ? d.acciones[i] : ACCION_DEFECTO;
        const vacia = i >= d.acciones.length || esAccionVacia(item);
        asignarTextoSimple(row.getCell(1), vacia ? '' : (item.descripcion || ''));
        asignarTextoSimple(row.getCell(4), vacia ? '' : (item.responsable || ''));
        asignarTextoSimple(
            row.getCell(6),
            vacia ? '' : (formatearFechaDisplay(item.fechaCompromiso) || ''),
            'center'
        );
    }

    asignarTextoSimple(
        ws.getRow(layout.resultadoAprobado.row).getCell(layout.resultadoAprobado.col),
        textoMarca(d.resultadoRevision === 'aprobado'),
        'center'
    );
    asignarTextoSimple(
        ws.getRow(layout.resultadoNoAprobado.row).getCell(layout.resultadoNoAprobado.col),
        textoMarca(d.resultadoRevision === 'no_aprobado'),
        'center'
    );
    asignarTextoSimple(ws.getRow(layout.aprobo.row).getCell(layout.aprobo.col), d.aprobo || '');
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        const vigente = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        return vigente || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[SGC-F-24] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-24 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
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

async function aplicarWrapTextoDatos(spreadsheetId, sheetTitle, layout) {
    const rangos = [
        {
            startRow: layout.descripcion.row,
            endRow: layout.descripcion.row + 3,
            startColumn: 1,
            endColumn: 7
        },
        {
            startRow: layout.motivo.row,
            endRow: layout.motivo.row + 3,
            startColumn: 1,
            endColumn: 7
        },
        {
            startRow: layout.accionesStart,
            endRow: layout.accionesEnd,
            startColumn: 1,
            endColumn: 3
        },
        {
            startRow: layout.accionesStart,
            endRow: layout.accionesEnd,
            startColumn: 4,
            endColumn: 5
        }
    ];
    for (const rango of rangos) {
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow: rango.startRow,
                endRow: rango.endRow,
                startColumn: rango.startColumn,
                endColumn: rango.endColumn,
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
            });
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo aplicar wrap:', err.message);
        }
    }

    const marcas = [
        layout.tipoRequisitos,
        layout.tipoDiseno,
        layout.tipoProduccion,
        layout.resultadoAprobado,
        layout.resultadoNoAprobado
    ];
    for (const celda of marcas) {
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow: celda.row,
                endRow: celda.row,
                startColumn: celda.col,
                endColumn: celda.col,
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'CLIP'
            });
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo centrar marca X:', err.message);
        }
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    let buffer = await descargarBufferDrive(spreadsheetId);
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    let ws = wb.getWorksheet(titulo) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-24 no contiene hojas.');

    const asegurado = await asegurarFilasAcciones(spreadsheetId, titulo, datos, parsearLayoutDesdeHoja(ws));
    let layout = asegurado.layout;

    if (asegurado.insertoFilas) {
        buffer = await descargarBufferDrive(spreadsheetId);
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        ws = wb.getWorksheet(titulo) || wb.worksheets[0];
        if (!ws) throw new Error('La plantilla SGC-F-24 no contiene hojas.');
        layout = parsearLayoutDesdeHoja(ws);
    }

    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarWrapTextoDatos(spreadsheetId, titulo, layout);
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
    if (!ws) throw new Error('La plantilla SGC-F-24 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        cambios: d.cambios.map((c) => ({
            id: c.id,
            folio: c.folio,
            numeroProyecto: c.numeroProyecto,
            fecha: c.fecha,
            productoServicio: c.productoServicio,
            cliente: c.cliente,
            tipoRequisitos: c.tipoRequisitos,
            tipoDiseno: c.tipoDiseno,
            tipoProduccion: c.tipoProduccion,
            descripcion: c.descripcion,
            motivo: c.motivo,
            acciones: c.acciones.filter((a) => !esAccionVacia(a)),
            resultadoRevision: c.resultadoRevision,
            aprobo: c.aprobo,
            pdfFirmadoId: c.pdfFirmado?.driveFileId || null
        })),
        cambioActivoId: d.cambioActivoId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
}

/** Añadir acciones = información; no forzar historial de estructura. */
function estructuraEsEquivalente() {
    return true;
}

async function aplicarHistorialSgcF24(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    const nombreMesAnio = `${excelHistorial.codigoHistorialBase(CODIGO_FORMATO)}-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        try {
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo reescribir hoja tras historial:', err.message);
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
        console.warn('[SGC-F-24] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-24] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-24] Google Sheet restaurado: ${nuevoId}`);
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
        throw new Error('No hay archivo SGC-F-24 configurado en Drive.');
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
                console.warn('[SGC-F-24] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 7, keepSingleSheet: false }
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

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;
    const datosDb = await leerDatosRegistro(registro);

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
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

    let datosHoja = null;
    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datosHoja = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (datosDb && Array.isArray(datosDb.cambios) && datosDb.cambios.length) {
        if (datosHoja && hojaTieneContenido(datosHoja)) {
            datos = fusionarHojaEnCambioActivo(datosDb, datosHoja);
        } else {
            datos = datosDb;
        }
    } else if (datosHoja) {
        datos = sanitizarDatos(datosHoja);
    } else {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo leer plantilla, usando datos por defecto:', err.message);
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
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
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

    const rawDatos = body?.datos || body || {};
    const cambioActivoId = body?.cambioActivoId || rawDatos?.cambioActivoId || null;
    const datosEntrada = sanitizarDatos({
        ...rawDatos,
        cambioActivoId: cambioActivoId || rawDatos?.cambioActivoId
    });
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    if (!huboCambio && driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveId);
        await actualizarDatosEnGoogleSheet(driveId, datosEntrada, hojaDestino);
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialSgcF24({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: { ...datosEntrada },
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;

            if (hist.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                ? fechaModificacion
                : fechaOriginal;

            const hojaDestino = hist.aplicado && hist.hojaVigente
                ? hist.hojaVigente
                : await resolverTituloHojaTrabajo(driveId);
            if (!hist.aplicado) {
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            }
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-24] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosGuardar,
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
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const buffer = await descargarBufferDrive(driveFileId);
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

    const datosFusionados = fusionarHojaEnCambioActivo(
        datosPrevios || sanitizarDatos(DATOS_DEFECTO),
        datosDrive
    );

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosFusionados);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosFusionados, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF24({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosFusionados,
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    if (!hist.aplicado) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveFileId);
        await actualizarDatosEnGoogleSheet(driveFileId, datosGuardar, hojaDestino);
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

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
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

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-24] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos);
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

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const parts = iso.split('-');
    const mm = parts[1] || '01';
    const yy = (parts[0] || '').slice(2, 4) || '00';
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-24 ${tag} - ${mm}/${yy}.pdf`;
}

async function publicarPdfEnDrive(pdfBuffer, folio) {
    const nombreArchivo = nombrePdfHistorial(folio);
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const cambioId = String(body?.cambioId || body?.cambio_id || '').trim();
    if (!cambioId) throw new Error('Se requiere cambioId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const cambios = Array.isArray(datosPrevios.cambios) ? [...datosPrevios.cambios] : [];
    const idx = cambios.findIndex((c) => c.id === cambioId);
    if (idx < 0) {
        throw new Error('No se encontró el cambio indicado en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, cambios[idx].folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(cambios[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    cambios[idx] = { ...cambios[idx], pdfFirmado, resultadoRevision: 'aprobado' };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        cambios,
        cambioActivoId: cambioId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    // Reflejar "Aprobado" en la hoja activa cuando hay archivo de trabajo.
    try {
        let driveId = await resolverDriveFileId(registroPrevio);
        if (driveId) {
            driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
            if (await esSpreadsheetEditableEnDrive(driveId)) {
                const hojaDestino = await resolverTituloHojaTrabajo(driveId);
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-24] No se pudo marcar Aprobado en Drive tras PDF:', err.message);
    }

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive);
    return { ...respuesta, pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet SGC-F-24 configurado para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-24] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, { gid });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-24 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sanitizarDatos,
    crearCambioVacio,
    nuevoIdCambio,
    resolverCambioActivo,
    aPayloadHoja
};
