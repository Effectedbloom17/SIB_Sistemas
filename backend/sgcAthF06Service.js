/**
 * ATH-F-06 · Detección de necesidades de capacitación (DNC).
 * Plantilla externa (solo diseño) + archivo sistema (historial ATHF06-MMAA / _N + histograma).
 * Patrón: sgcDgF05Service / sgcF03Service.
 *
 * Layout (hoja «Plantilla», columnas B–E):
 *   C3 revisión · D3 fecha de rev.
 *   B7 fecha de emisión · C7 nombre del solicitante · E7 puesto
 *   B9 área o departamento
 *   B11 tipos de requerimiento (Ingreso / Cambio de puesto / Formación / Extraordinaria)
 *   Filas de trabajadores (B nombre · C puesto) hasta «Identificación de Necesidades»
 *   Filas de necesidades (B capacitación · C justificación · E fecha) hasta «Comentarios»
 *   Celda siguiente a «Comentarios» = comentarios
 * El PDF firmado de cada registro se guarda en CARPETA_PDF_FIRMADOS_ID.
 */
const ExcelJS = require('exceljs');
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-06';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1fdsvuQkiZ0Wg-un23-EKjDYOnmles4HCvCR-_f-YxJs
 */
const TEMPLATE_DRIVE_ID = '1fdsvuQkiZ0Wg-un23-EKjDYOnmles4HCvCR-_f-YxJs';
/**
 * Archivo de trabajo Centro SGC (historial ATHF06-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc
 */
const DRIVE_FILE_ID_SISTEMA = '1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const NOMBRE_ARCHIVO_DRIVE = 'ATH-F-06 DNC (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback de resolución de hoja; el trabajo real usa ATHF06-MMAA(_N). */
const SHEET_TITLE = 'Plantilla';
const MAX_COLUMNAS_SISTEMA = 6;
const MAX_TRABAJADORES = 40;
const MAX_NECESIDADES = 30;

/** Nombre de hoja base del mes actual (ATHF06-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

/** Coincide con la plantilla externa: 1 fila de trabajador y 1 bloque de necesidades. */
const LAYOUT_BASE = {
    revision: { row: 3, col: 3 },
    fechaRevision: { row: 3, col: 4 },
    fechaEmision: { row: 7, col: 2 },
    nombreSolicitante: { row: 7, col: 3 },
    puestoSolicitante: { row: 7, col: 5 },
    area: { row: 9, col: 2 },
    requerimiento: { row: 11, col: 2 },
    trabajadoresStart: 13,
    trabajadoresEnd: 13,
    trabajadoresSlots: 1,
    necesidadesStart: 16,
    necesidadesEnd: 16,
    necesidadesSlots: 1,
    comentarios: { row: 20, col: 2 }
};

const TRABAJADOR_DEFECTO = { nombre: '', puesto: '' };
const NECESIDAD_DEFECTO = { capacitacion: '', justificacion: '', fechaRequerida: '' };

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-28',
    revision: '00',
    fechaRevision: '2025-01-28',
    registros: [],
    registroActivoId: null
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
    return '';
}

function fechaHoyIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y}`;
}

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

function nuevoIdRegistro() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `dnc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'ATH-F-06 DNC firmado.pdf').trim()
            || 'ATH-F-06 DNC firmado.pdf',
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarTrabajador(item) {
    return {
        nombre: normalizarSaltosLinea(item?.nombre || ''),
        puesto: normalizarSaltosLinea(item?.puesto || '')
    };
}

function esTrabajadorVacio(item) {
    const t = sanitizarTrabajador(item);
    return !t.nombre && !t.puesto;
}

function sanitizarNecesidad(item) {
    return {
        capacitacion: normalizarSaltosLinea(item?.capacitacion || item?.capacitacionRequerida || ''),
        justificacion: normalizarSaltosLinea(item?.justificacion || ''),
        fechaRequerida: normalizarSaltosLinea(item?.fechaRequerida || item?.fecha || '')
    };
}

function esNecesidadVacia(item) {
    const n = sanitizarNecesidad(item);
    return !n.capacitacion && !n.justificacion && !n.fechaRequerida;
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) out.push(factory());
    return out;
}

function textoRequerimiento(reg) {
    // Plantilla: «Ingreso ___ …»; seleccionado → «_X_».
    const marca = (activo) => (activo ? '_X_' : '___');
    return `Ingreso ${marca(reg.tipoIngreso)} Cambio de puesto ${marca(reg.tipoCambioPuesto)} Formación y desarrollo ${marca(reg.tipoFormacion)} Capacitación extraordinaria ${marca(reg.tipoExtraordinaria)}`;
}

function parsearTiposRequerimiento(texto) {
    const t = String(texto || '');
    const tomar = (label) => {
        const re = new RegExp(`${label}\\s+(_X_|X+|_+)`, 'i');
        const m = t.match(re);
        return !!(m && /x/i.test(m[1]));
    };
    return {
        tipoIngreso: tomar('Ingreso'),
        tipoCambioPuesto: tomar('Cambio de puesto'),
        tipoFormacion: tomar('Formaci[oó]n y desarrollo'),
        tipoExtraordinaria: tomar('Capacitaci[oó]n extraordinaria')
    };
}

/** Texto listo para celda Sheets: conserva Enter (\\n) y wrap. */
function textoCeldaConEnter(valor) {
    return normalizarSaltosLinea(valor).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function esPlaceholderPlantilla(texto) {
    const t = etiquetaNormalizada(texto);
    return !t || t === 'ejemplo' || t === 'ejemplo.' || t === '-' || t === 'n/a';
}

function estimarAltoFilaPx(texto, { base = 24, porLinea = 18, max = 140 } = {}) {
    const raw = String(texto || '');
    const lineasEnter = raw.split('\n').length;
    const wrapAprox = Math.max(1, Math.ceil(raw.replace(/\n/g, ' ').length / 42));
    const lineas = Math.max(lineasEnter, wrapAprox);
    return Math.min(max, Math.max(base, lineas * porLinea));
}

function crearRegistroVacio() {
    return {
        id: nuevoIdRegistro(),
        folio: '',
        fechaEmision: '',
        nombreSolicitante: '',
        puestoSolicitante: '',
        area: '',
        tipoIngreso: false,
        tipoCambioPuesto: false,
        tipoFormacion: false,
        tipoExtraordinaria: false,
        trabajadores: [{ ...TRABAJADOR_DEFECTO }],
        necesidades: [{ ...NECESIDAD_DEFECTO }],
        comentarios: '',
        pdfFirmado: null
    };
}

function sanitizarRegistro(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const trabajadores = (Array.isArray(base.trabajadores) ? base.trabajadores : [])
        .map(sanitizarTrabajador)
        .filter((t) => !esTrabajadorVacio(t))
        .slice(0, MAX_TRABAJADORES);
    const necesidades = (Array.isArray(base.necesidades) ? base.necesidades : [])
        .map(sanitizarNecesidad)
        .filter((n) => !esNecesidadVacia(n))
        .slice(0, MAX_NECESIDADES);
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    return {
        id: String(base.id || '').trim() || nuevoIdRegistro(),
        folio: String(base.folio || '').trim().toUpperCase(),
        fechaEmision: formatearFechaIso(base.fechaEmision || base.fecha_emision),
        nombreSolicitante: normalizarSaltosLinea(base.nombreSolicitante || base.nombre_solicitante || ''),
        puestoSolicitante: normalizarSaltosLinea(base.puestoSolicitante || base.puesto_solicitante || ''),
        area: normalizarSaltosLinea(base.area || base.areaDepartamento || ''),
        tipoIngreso: !!(base.tipoIngreso ?? base.tipo_ingreso),
        tipoCambioPuesto: !!(base.tipoCambioPuesto ?? base.tipo_cambio_puesto),
        tipoFormacion: !!(base.tipoFormacion ?? base.tipo_formacion),
        tipoExtraordinaria: !!(base.tipoExtraordinaria ?? base.tipo_extraordinaria),
        trabajadores: conFilasMinimas(trabajadores, 1, () => ({ ...TRABAJADOR_DEFECTO })),
        necesidades: conFilasMinimas(necesidades, 1, () => ({ ...NECESIDAD_DEFECTO })),
        comentarios: normalizarSaltosLinea(base.comentarios || ''),
        pdfFirmado
    };
}

function esRegistroLegacyPlano(base) {
    return !Array.isArray(base?.registros)
        && !!(base?.nombreSolicitante || base?.area || base?.comentarios
            || base?.tipoIngreso || base?.trabajadores || base?.necesidades);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let registrosRaw = [];
    if (Array.isArray(base.registros)) registrosRaw = base.registros;
    else if (esRegistroLegacyPlano(base)) registrosRaw = [base];
    const registros = registrosRaw.map(sanitizarRegistro);
    const registroActivoId = base.registroActivoId
        ? String(base.registroActivoId)
        : (registros[0]?.id || null);
    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: extraerFechaRevision(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        registros,
        registroActivoId: registroActivoId && registros.some((r) => r.id === registroActivoId)
            ? registroActivoId
            : (registros[0]?.id || null)
    };
}

function resolverRegistroActivo(datos) {
    const lista = Array.isArray(datos?.registros) ? datos.registros : [];
    if (!lista.length) return crearRegistroVacio();
    const id = datos?.registroActivoId;
    if (id) {
        const found = lista.find((r) => r.id === id);
        if (found) return found;
    }
    return lista[0];
}

function aPayloadHoja(datos) {
    const d = sanitizarDatos(datos);
    const r = resolverRegistroActivo(d);
    const vacio = !d.registros.length;
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fechaEmision: vacio ? '' : r.fechaEmision,
        nombreSolicitante: vacio ? '' : r.nombreSolicitante,
        puestoSolicitante: vacio ? '' : r.puestoSolicitante,
        area: vacio ? '' : r.area,
        tipoIngreso: vacio ? false : r.tipoIngreso,
        tipoCambioPuesto: vacio ? false : r.tipoCambioPuesto,
        tipoFormacion: vacio ? false : r.tipoFormacion,
        tipoExtraordinaria: vacio ? false : r.tipoExtraordinaria,
        trabajadores: vacio ? [] : r.trabajadores.filter((t) => !esTrabajadorVacio(t)),
        necesidades: vacio ? [] : r.necesidades.filter((n) => !esNecesidadVacia(n)),
        comentarios: vacio ? '' : r.comentarios
    };
}

function registroTieneContenido(r) {
    if (!r) return false;
    return !!(r.folio || r.fechaEmision || r.nombreSolicitante || r.puestoSolicitante || r.area
        || r.comentarios || r.tipoIngreso || r.tipoCambioPuesto || r.tipoFormacion || r.tipoExtraordinaria
        || (Array.isArray(r.trabajadores) && r.trabajadores.some((t) => !esTrabajadorVacio(t)))
        || (Array.isArray(r.necesidades) && r.necesidades.some((n) => !esNecesidadVacia(n)))
        || r.pdfFirmado?.driveFileId);
}

function hojaTieneContenido(datosHoja) {
    const hoja = sanitizarDatos(datosHoja || {});
    return hoja.registros.some(registroTieneContenido);
}

function contarItemsConContenido(lista, esVacioFn) {
    return (Array.isArray(lista) ? lista : []).filter((item) => !esVacioFn(item)).length;
}

/**
 * Fusiona la hoja (registro activo visual) sobre BD.
 * No reduce trabajadores/necesidades de BD si la hoja trae menos filas
 * (evita perder filas al parsear mal o al haber «Ejemplo»/espaciadores).
 */
function fusionarHojaEnRegistroActivo(datosDb, datosHoja) {
    const db = sanitizarDatos(datosDb || DATOS_DEFECTO);
    const hoja = sanitizarDatos(datosHoja || {});
    const hojaReg = resolverRegistroActivo(hoja);
    if (!db.registros.length) {
        if (!hojaTieneContenido(hoja)) return db;
        const primero = sanitizarRegistro({ ...hojaReg, pdfFirmado: null, folio: '' });
        return sanitizarDatos({
            revision: hoja.revision || db.revision,
            fechaRevision: hoja.fechaRevision || db.fechaRevision,
            fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
            registros: [primero],
            registroActivoId: primero.id
        });
    }
    const activaId = db.registroActivoId && db.registros.some((r) => r.id === db.registroActivoId)
        ? db.registroActivoId
        : db.registros[0].id;
    const registros = db.registros.map((r) => {
        if (r.id !== activaId) return r;
        const trabHoja = contarItemsConContenido(hojaReg.trabajadores, esTrabajadorVacio);
        const trabDb = contarItemsConContenido(r.trabajadores, esTrabajadorVacio);
        const necHoja = contarItemsConContenido(hojaReg.necesidades, esNecesidadVacia);
        const necDb = contarItemsConContenido(r.necesidades, esNecesidadVacia);
        return sanitizarRegistro({
            ...r,
            fechaEmision: hojaReg.fechaEmision || r.fechaEmision,
            nombreSolicitante: hojaReg.nombreSolicitante || r.nombreSolicitante,
            puestoSolicitante: hojaReg.puestoSolicitante || r.puestoSolicitante,
            area: hojaReg.area || r.area,
            tipoIngreso: hojaReg.tipoIngreso,
            tipoCambioPuesto: hojaReg.tipoCambioPuesto,
            tipoFormacion: hojaReg.tipoFormacion,
            tipoExtraordinaria: hojaReg.tipoExtraordinaria,
            trabajadores: trabHoja >= trabDb ? hojaReg.trabajadores : r.trabajadores,
            necesidades: necHoja >= necDb ? hojaReg.necesidades : r.necesidades,
            comentarios: hojaReg.comentarios || r.comentarios,
            folio: r.folio,
            pdfFirmado: r.pdfFirmado
        });
    });
    return sanitizarDatos({
        revision: hoja.revision || db.revision,
        fechaRevision: hoja.fechaRevision || db.fechaRevision,
        fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
        registros,
        registroActivoId: activaId
    });
}

function buscarFilaEtiqueta(ws, needles, maxRow = 80) {
    const maxCol = Math.min(Math.max(Number(ws.actualColumnCount) || 5, 5), 8);
    const limite = Math.min(Math.max(Number(ws.actualRowCount) || maxRow, 40), maxRow);
    for (let r = 1; r <= limite; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
            if (etiquetaEs(row.getCell(c).value, ...needles)) return { row: r, col: c };
        }
    }
    return null;
}

function filaTieneTextoEnRango(ws, rowNum, colInicio = 2, colFin = 5) {
    const row = ws.getRow(rowNum);
    for (let c = colInicio; c <= colFin; c++) {
        if (celdaATexto(row.getCell(c).value).trim()) return true;
    }
    return false;
}

/**
 * Bloque de datos + espaciador opcional (fila vacía final antes de la siguiente sección).
 * El espaciador no cuenta como slot de datos.
 */
function resolverBloqueConEspaciador(ws, startRow, limiteInclusive) {
    const start = Math.max(1, Number(startRow) || 1);
    const limite = Math.max(start, Number(limiteInclusive) || start);
    let spacerRow = null;
    let endData = limite;
    if (limite > start && !filaTieneTextoEnRango(ws, limite)) {
        spacerRow = limite;
        endData = limite - 1;
    }
    if (endData < start) endData = start;
    return {
        start,
        end: endData,
        slots: Math.max(1, endData - start + 1),
        spacerRow
    };
}

function parsearLayoutDesdeHoja(ws) {
    const layout = { ...LAYOUT_BASE };
    const trabajadoresHeader = buscarFilaEtiqueta(ws, ['nombre del trabajador']);
    const necesidadesSeccion = buscarFilaEtiqueta(ws, ['identificacion de necesidades de capacitacion']);
    const necesidadesHeader = buscarFilaEtiqueta(ws, ['capacitacion requerida']);
    const comentarios = buscarFilaEtiqueta(ws, ['comentarios']);
    const fechaEmision = buscarFilaEtiqueta(ws, ['fecha de emision']);
    const area = buscarFilaEtiqueta(ws, ['area o departamento']);
    const requerimiento = buscarFilaEtiqueta(ws, ['ingreso']);

    if (fechaEmision) {
        layout.fechaEmision = { row: fechaEmision.row + 1, col: 2 };
        layout.nombreSolicitante = { row: fechaEmision.row + 1, col: 3 };
        layout.puestoSolicitante = { row: fechaEmision.row + 1, col: 5 };
    }
    if (area) layout.area = { row: area.row + 1, col: 2 };
    if (requerimiento) layout.requerimiento = { row: requerimiento.row, col: 2 };

    const startTrab = trabajadoresHeader ? trabajadoresHeader.row + 1 : LAYOUT_BASE.trabajadoresStart;
    const limTrab = necesidadesSeccion
        ? Math.max(startTrab, necesidadesSeccion.row - 1)
        : LAYOUT_BASE.trabajadoresEnd;
    const bloqueTrab = resolverBloqueConEspaciador(ws, startTrab, limTrab);
    layout.trabajadoresStart = bloqueTrab.start;
    layout.trabajadoresEnd = bloqueTrab.end;
    layout.trabajadoresSlots = bloqueTrab.slots;
    layout.spacerTrasTrabajadores = bloqueTrab.spacerRow;
    layout.necesidadesSeccionRow = necesidadesSeccion?.row || null;

    const startNec = necesidadesHeader ? necesidadesHeader.row + 1 : LAYOUT_BASE.necesidadesStart;
    const limNec = comentarios
        ? Math.max(startNec, comentarios.row - 1)
        : LAYOUT_BASE.necesidadesEnd;
    const bloqueNec = resolverBloqueConEspaciador(ws, startNec, limNec);
    layout.necesidadesStart = bloqueNec.start;
    layout.necesidadesEnd = bloqueNec.end;
    layout.necesidadesSlots = bloqueNec.slots;
    layout.spacerTrasNecesidades = bloqueNec.spacerRow;
    layout.comentariosLabelRow = comentarios?.row || null;
    if (comentarios) layout.comentarios = { row: comentarios.row + 1, col: 2 };
    return layout;
}

function leerRegistroDesdeLayout(ws, layout) {
    const tipos = parsearTiposRequerimiento(
        celdaATexto(ws.getRow(layout.requerimiento.row).getCell(layout.requerimiento.col).value)
    );
    const trabajadores = [];
    for (let r = layout.trabajadoresStart; r <= layout.trabajadoresEnd; r++) {
        const row = ws.getRow(r);
        const item = sanitizarTrabajador({
            nombre: celdaATexto(row.getCell(2).value),
            puesto: celdaATexto(row.getCell(3).value)
        });
        if (!esTrabajadorVacio(item) && !esPlaceholderPlantilla(item.nombre)) trabajadores.push(item);
    }
    const necesidades = [];
    for (let r = layout.necesidadesStart; r <= layout.necesidadesEnd; r++) {
        const row = ws.getRow(r);
        const fechaCelda = celdaATexto(row.getCell(5).value) || celdaATexto(row.getCell(4).value);
        const item = sanitizarNecesidad({
            capacitacion: celdaATexto(row.getCell(2).value),
            justificacion: celdaATexto(row.getCell(3).value),
            fechaRequerida: fechaCelda
        });
        if (
            !esNecesidadVacia(item)
            && !esPlaceholderPlantilla(item.capacitacion)
            && !esPlaceholderPlantilla(item.justificacion)
        ) {
            necesidades.push(item);
        }
    }
    return sanitizarRegistro({
        fechaEmision: celdaATexto(ws.getRow(layout.fechaEmision.row).getCell(layout.fechaEmision.col).value),
        nombreSolicitante: celdaATexto(ws.getRow(layout.nombreSolicitante.row).getCell(layout.nombreSolicitante.col).value),
        puestoSolicitante: celdaATexto(ws.getRow(layout.puestoSolicitante.row).getCell(layout.puestoSolicitante.col).value),
        area: celdaATexto(ws.getRow(layout.area.row).getCell(layout.area.col).value),
        ...tipos,
        trabajadores,
        necesidades,
        comentarios: celdaATexto(ws.getRow(layout.comentarios.row).getCell(layout.comentarios.col).value)
    });
}

function parsearDatosDesdeHoja(ws) {
    const layout = parsearLayoutDesdeHoja(ws);
    const revision = extraerRevision(celdaATexto(ws.getRow(layout.revision.row).getCell(layout.revision.col).value));
    const fechaRevision = extraerFechaRevision(celdaATexto(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col).value));
    const reg = leerRegistroDesdeLayout(ws, layout);
    if (!registroTieneContenido(reg)) {
        return sanitizarDatos({ revision, fechaRevision, registros: [] });
    }
    return sanitizarDatos({
        revision,
        fechaRevision,
        registros: [reg],
        registroActivoId: reg.id
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

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: `'${sheetTitle}'!${columnaALetra(col)}${row}`,
        values: [[valor ?? '']]
    });
}

function datosAActualizacionesSheet(datos, sheetTitle, layout) {
    const d = aPayloadHoja(datos);
    const actualizaciones = [];
    pushUpdate(actualizaciones, layout.revision.row, layout.revision.col, `Revisión: ${d.revision}`, sheetTitle);
    pushUpdate(
        actualizaciones,
        layout.fechaRevision.row,
        layout.fechaRevision.col,
        `Fecha de rev.: ${formatearFechaRevCorta(d.fechaRevision)}`,
        sheetTitle
    );
    pushUpdate(actualizaciones, layout.fechaEmision.row, layout.fechaEmision.col, formatearFechaDisplay(d.fechaEmision) || '', sheetTitle);
    pushUpdate(actualizaciones, layout.nombreSolicitante.row, layout.nombreSolicitante.col, textoCeldaConEnter(d.nombreSolicitante), sheetTitle);
    pushUpdate(actualizaciones, layout.puestoSolicitante.row, layout.puestoSolicitante.col, textoCeldaConEnter(d.puestoSolicitante), sheetTitle);
    pushUpdate(actualizaciones, layout.area.row, layout.area.col, textoCeldaConEnter(d.area), sheetTitle);
    pushUpdate(actualizaciones, layout.requerimiento.row, layout.requerimiento.col, textoRequerimiento(d), sheetTitle);

    const trabSlots = Math.max(1, layout.trabajadoresSlots);
    for (let i = 0; i < trabSlots; i++) {
        const row = layout.trabajadoresStart + i;
        const item = i < d.trabajadores.length ? d.trabajadores[i] : TRABAJADOR_DEFECTO;
        const vacio = i >= d.trabajadores.length || esTrabajadorVacio(item);
        pushUpdate(actualizaciones, row, 2, vacio ? '' : textoCeldaConEnter(item.nombre), sheetTitle);
        pushUpdate(actualizaciones, row, 3, vacio ? '' : textoCeldaConEnter(item.puesto), sheetTitle);
    }
    const necSlots = Math.max(1, layout.necesidadesSlots);
    for (let i = 0; i < necSlots; i++) {
        const row = layout.necesidadesStart + i;
        const item = i < d.necesidades.length ? d.necesidades[i] : NECESIDAD_DEFECTO;
        const vacio = i >= d.necesidades.length || esNecesidadVacia(item);
        pushUpdate(actualizaciones, row, 2, vacio ? '' : textoCeldaConEnter(item.capacitacion), sheetTitle);
        pushUpdate(actualizaciones, row, 3, vacio ? '' : textoCeldaConEnter(item.justificacion), sheetTitle);
        pushUpdate(actualizaciones, row, 5, vacio ? '' : textoCeldaConEnter(item.fechaRequerida), sheetTitle);
    }
    pushUpdate(actualizaciones, layout.comentarios.row, layout.comentarios.col, textoCeldaConEnter(d.comentarios), sheetTitle);
    return actualizaciones;
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
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

async function cargarWorkbook(spreadsheetId, sheetTitle) {
    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(sheetTitle) || wb.worksheets[0];
    return { wb, ws };
}

/**
 * Copia formato (bordes, merges visuales vía PASTE_FORMAT) de una fila plantilla
 * a las filas recién insertadas.
 */
async function copiarFormatoFilasAthF06(spreadsheetId, sheetId, filaOrigen1, filaDestino1, numFilas, colInicio, colFin) {
    if (!spreadsheetId || sheetId == null || numFilas <= 0) return;
    const origen = Math.max(1, Math.floor(filaOrigen1));
    const destino = Math.max(1, Math.floor(filaDestino1));
    const n = Math.max(1, Math.floor(numFilas));
    const c0 = Math.max(1, Math.floor(colInicio));
    const c1 = Math.max(c0, Math.floor(colFin));
    try {
        await driveService.batchUpdateGoogleSheet(spreadsheetId, [{
            copyPaste: {
                source: {
                    sheetId: Number(sheetId),
                    startRowIndex: origen - 1,
                    endRowIndex: origen,
                    startColumnIndex: c0 - 1,
                    endColumnIndex: c1
                },
                destination: {
                    sheetId: Number(sheetId),
                    startRowIndex: destino - 1,
                    endRowIndex: destino - 1 + n,
                    startColumnIndex: c0 - 1,
                    endColumnIndex: c1
                },
                pasteType: 'PASTE_FORMAT'
            }
        }], 'athF06.copiarFormatoFilas');
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo copiar formato de filas:', err.message);
    }
}

/**
 * Ajusta filas al contenido real (plantilla = 1 fila base).
 * Recorta filas vacías de más y, al agregar, hereda diseño de la fila plantilla.
 */
async function asegurarFilasDinamicas(spreadsheetId, sheetTitle, datos) {
    let { ws } = await cargarWorkbook(spreadsheetId, sheetTitle);
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    let layout = parsearLayoutDesdeHoja(ws);
    const d = aPayloadHoja(datos);
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return layout;

    const trabDeseadas = Math.max(1, Math.min(MAX_TRABAJADORES, Math.max(d.trabajadores.length, 1)));
    if (layout.trabajadoresSlots > trabDeseadas) {
        const sobran = layout.trabajadoresSlots - trabDeseadas;
        const deleteStart = layout.trabajadoresStart - 1 + trabDeseadas;
        try {
            await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, deleteStart, sobran);
            console.warn(`[ATH-F-06] Recortadas ${sobran} fila(s) extra de trabajadores (plantilla = 1 base).`);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudieron recortar filas de trabajadores:', err.message);
        }
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    } else if (layout.trabajadoresSlots < trabDeseadas) {
        const extra = trabDeseadas - layout.trabajadoresSlots;
        const filaOrigen = layout.trabajadoresStart;
        const insertAt = layout.trabajadoresEnd; // 0-based index = after last 1-based row
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, insertAt, extra, {
            inheritFromBefore: true
        });
        await copiarFormatoFilasAthF06(
            spreadsheetId, sheetId, filaOrigen, layout.trabajadoresEnd + 1, extra, 2, 5
        );
        await driveService.fusionarRangoGoogleSheet(
            spreadsheetId, sheetId, layout.trabajadoresEnd, layout.trabajadoresEnd + extra, 2, 5
        ).catch((err) => console.warn('[ATH-F-06] No se pudo fusionar filas de trabajadores:', err.message));
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }

    const necDeseadas = Math.max(1, Math.min(MAX_NECESIDADES, Math.max(d.necesidades.length, 1)));
    if (layout.necesidadesSlots > necDeseadas) {
        const sobran = layout.necesidadesSlots - necDeseadas;
        const deleteStart = layout.necesidadesStart - 1 + necDeseadas;
        try {
            await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, deleteStart, sobran);
            console.warn(`[ATH-F-06] Recortadas ${sobran} fila(s) extra de necesidades.`);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudieron recortar filas de necesidades:', err.message);
        }
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    } else if (layout.necesidadesSlots < necDeseadas) {
        const extra = necDeseadas - layout.necesidadesSlots;
        const filaOrigen = layout.necesidadesStart;
        const insertAt = layout.necesidadesEnd;
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, insertAt, extra, {
            inheritFromBefore: true
        });
        await copiarFormatoFilasAthF06(
            spreadsheetId, sheetId, filaOrigen, layout.necesidadesEnd + 1, extra, 2, 5
        );
        await driveService.fusionarRangoGoogleSheet(
            spreadsheetId, sheetId, layout.necesidadesEnd, layout.necesidadesEnd + extra, 2, 4
        ).catch((err) => console.warn('[ATH-F-06] No se pudo fusionar filas de necesidades:', err.message));
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }

    return layout;
}

/** Alto fijo de la fila de contenido de Comentarios (pedido UI). */
const ALTO_FILA_COMENTARIOS_PX = 21;
/** Alto fijo de cada fila de trabajador (nombre / puesto). */
const ALTO_FILA_TRABAJADOR_PX = 60;

/**
 * Fila espaciadora: relleno blanco + solo borde superior
 * (cierra la tabla de arriba; sin laterales ni inferior).
 */
async function aplicarBordeSuperiorEspaciador(spreadsheetId, sheetId, row1, colInicio = 2, colFin = 5) {
    if (!spreadsheetId || sheetId == null || !row1) return;
    const bordeTop = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sin = { style: 'NONE' };
    const blanco = { red: 1, green: 1, blue: 1 };
    const range = {
        sheetId: Number(sheetId),
        startRowIndex: row1 - 1,
        endRowIndex: row1,
        startColumnIndex: colInicio - 1,
        endColumnIndex: colFin
    };
    try {
        await driveService.batchUpdateGoogleSheet(spreadsheetId, [
            {
                repeatCell: {
                    range,
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: blanco,
                            borders: {
                                top: bordeTop,
                                bottom: sin,
                                left: sin,
                                right: sin
                            }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,borders)'
                }
            },
            {
                updateBorders: {
                    range,
                    top: bordeTop,
                    bottom: sin,
                    left: sin,
                    right: sin,
                    innerHorizontal: sin,
                    innerVertical: sin
                }
            }
        ], 'athF06.bordeEspaciador');
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo aplicar borde de espaciador:', err.message);
    }
}

async function limpiarCeldasEspaciador(spreadsheetId, sheetTitle, row1) {
    if (!row1) return;
    const actualizaciones = [2, 3, 4, 5].map((col) => ({
        range: `'${sheetTitle}'!${columnaALetra(col)}${row1}`,
        values: [['']]
    }));
    try {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo limpiar espaciador:', err.message);
    }
}

/**
 * Garantiza 1 fila vacía debajo de trabajadores y de necesidades
 * (solo borde superior; sin laterales/inferior).
 */
async function asegurarEspaciadoresSecciones(spreadsheetId, sheetTitle) {
    let { ws } = await cargarWorkbook(spreadsheetId, sheetTitle);
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    let layout = parsearLayoutDesdeHoja(ws);
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return layout;

    // Espaciador tras trabajadores (antes de «Identificación…»).
    if (!layout.spacerTrasTrabajadores && layout.necesidadesSeccionRow) {
        const insertAt = layout.necesidadesSeccionRow - 1; // 0-based = fila antes del encabezado
        try {
            await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, insertAt, 1, {
                inheritFromBefore: false,
                pixelSize: 12
            });
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo insertar espaciador tras trabajadores:', err.message);
        }
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }

    // Espaciador tras necesidades (antes de «Comentarios»).
    if (!layout.spacerTrasNecesidades && layout.comentariosLabelRow) {
        const insertAt = layout.comentariosLabelRow - 1;
        try {
            await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, insertAt, 1, {
                inheritFromBefore: false,
                pixelSize: 12
            });
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo insertar espaciador tras necesidades:', err.message);
        }
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }

    for (const spacerRow of [layout.spacerTrasTrabajadores, layout.spacerTrasNecesidades]) {
        if (!spacerRow) continue;
        await limpiarCeldasEspaciador(spreadsheetId, sheetTitle, spacerRow);
        await aplicarBordeSuperiorEspaciador(spreadsheetId, sheetId, spacerRow, 2, 5);
        try {
            await driveService.aplicarAltoFilasGoogleSheet(
                spreadsheetId, sheetId, spacerRow, spacerRow, 12
            );
        } catch (_) { /* opcional */ }
    }

    return layout;
}

async function aplicarAltosFilasPorContenido(spreadsheetId, sheetTitle, layout, datos) {
    const d = aPayloadHoja(datos);
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;

    const altos = [];
    for (let i = 0; i < layout.trabajadoresSlots; i++) {
        altos.push({
            row: layout.trabajadoresStart + i,
            px: ALTO_FILA_TRABAJADOR_PX
        });
    }
    for (let i = 0; i < layout.necesidadesSlots; i++) {
        const item = d.necesidades[i] || NECESIDAD_DEFECTO;
        const texto = [item.capacitacion, item.justificacion, item.fechaRequerida].filter(Boolean).join('\n');
        altos.push({
            row: layout.necesidadesStart + i,
            px: estimarAltoFilaPx(texto, { base: 48, porLinea: 18, max: 160 })
        });
    }
    // Comentarios: alto fijo 21 (no autoajustar por contenido).
    altos.push({
        row: layout.comentarios.row,
        px: ALTO_FILA_COMENTARIOS_PX
    });

    for (const item of altos) {
        try {
            await driveService.aplicarAltoFilasGoogleSheet(
                spreadsheetId, sheetId, item.row, item.row, item.px
            );
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo ajustar alto de fila:', err.message);
        }
    }
}

async function aplicarFormatoVisualAthF06(spreadsheetId, sheetTitle, layout, datos = null) {
    // Centro + Medio en cabeceras/datos de emisión, solicitante, área, trabajadores y necesidades.
    // Comentarios: solo ese bloque queda alineado a la izquierda.
    const headerTrab = Math.max(1, layout.trabajadoresStart - 1);
    const headerNec = Math.max(1, layout.necesidadesStart - 1);
    const seccionNec = layout.necesidadesSeccionRow || headerNec;
    const rangos = [
        { startRow: headerTrab, endRow: layout.trabajadoresEnd, startColumn: 2, endColumn: 5, horizontalAlignment: 'CENTER' },
        { startRow: seccionNec, endRow: layout.necesidadesEnd, startColumn: 2, endColumn: 5, horizontalAlignment: 'CENTER' },
        { startRow: layout.fechaEmision.row - 1, endRow: layout.fechaEmision.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'CENTER' },
        { startRow: layout.nombreSolicitante.row - 1, endRow: layout.nombreSolicitante.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'CENTER' },
        { startRow: layout.area.row - 1, endRow: layout.area.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'CENTER' },
        { startRow: layout.comentarios.row, endRow: layout.comentarios.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' }
    ];
    for (const rango of rangos) {
        if (!rango.startRow || rango.endRow < rango.startRow) continue;
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow: rango.startRow,
                endRow: rango.endRow,
                startColumn: rango.startColumn,
                endColumn: rango.endColumn,
                horizontalAlignment: rango.horizontalAlignment,
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP',
                fontFamily: 'Century Gothic',
                fontSize: 11
            });
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo aplicar formato visual:', err.message);
        }
    }

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    for (const spacerRow of [layout.spacerTrasTrabajadores, layout.spacerTrasNecesidades]) {
        if (!spacerRow || sheetId == null) continue;
        await aplicarBordeSuperiorEspaciador(spreadsheetId, sheetId, spacerRow, 2, 5);
    }

    if (datos) {
        await aplicarAltosFilasPorContenido(spreadsheetId, sheetTitle, layout, datos);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede escribir en el archivo plantilla ATH-F-06.');
    }
    const titulo = String(sheetTitle || await resolverTituloHojaVigente(spreadsheetId)).trim();
    if (!titulo) throw new Error('Falta título de hoja para sincronizar ATH-F-06.');
    await asegurarFilasDinamicas(spreadsheetId, titulo, datos);
    const layout = await asegurarEspaciadoresSecciones(spreadsheetId, titulo);
    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualAthF06(spreadsheetId, titulo, layout, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

function asignarTextoSimple(celda, valor) {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal: 'left',
        vertical: 'middle',
        wrapText: true
    };
    celda.font = { ...(celda.font || {}), name: 'Century Gothic', size: 11 };
}

function escribirDatosEnHoja(ws, datos) {
    const d = aPayloadHoja(datos);
    let layout = parsearLayoutDesdeHoja(ws);
    const extraTrab = Math.max(0, Math.min(MAX_TRABAJADORES, d.trabajadores.length) - layout.trabajadoresSlots);
    if (extraTrab > 0) {
        for (let i = 0; i < extraTrab; i++) ws.spliceRows(layout.trabajadoresEnd + 1, 0, []);
        layout = parsearLayoutDesdeHoja(ws);
    }
    const extraNec = Math.max(0, Math.min(MAX_NECESIDADES, d.necesidades.length) - layout.necesidadesSlots);
    if (extraNec > 0) {
        for (let i = 0; i < extraNec; i++) ws.spliceRows(layout.necesidadesEnd + 1, 0, []);
        layout = parsearLayoutDesdeHoja(ws);
    }
    asignarTextoSimple(ws.getRow(layout.revision.row).getCell(layout.revision.col), `Revisión: ${d.revision}`);
    asignarTextoSimple(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col), `Fecha de rev.: ${formatearFechaRevCorta(d.fechaRevision)}`);
    asignarTextoSimple(ws.getRow(layout.fechaEmision.row).getCell(layout.fechaEmision.col), formatearFechaDisplay(d.fechaEmision) || '');
    asignarTextoSimple(ws.getRow(layout.nombreSolicitante.row).getCell(layout.nombreSolicitante.col), d.nombreSolicitante || '');
    asignarTextoSimple(ws.getRow(layout.puestoSolicitante.row).getCell(layout.puestoSolicitante.col), d.puestoSolicitante || '');
    asignarTextoSimple(ws.getRow(layout.area.row).getCell(layout.area.col), d.area || '');
    asignarTextoSimple(ws.getRow(layout.requerimiento.row).getCell(layout.requerimiento.col), textoRequerimiento(d));
    for (let i = 0; i < layout.trabajadoresSlots; i++) {
        const row = ws.getRow(layout.trabajadoresStart + i);
        const item = i < d.trabajadores.length ? d.trabajadores[i] : TRABAJADOR_DEFECTO;
        const vacio = i >= d.trabajadores.length || esTrabajadorVacio(item);
        asignarTextoSimple(row.getCell(2), vacio ? '' : item.nombre);
        asignarTextoSimple(row.getCell(3), vacio ? '' : item.puesto);
    }
    for (let i = 0; i < layout.necesidadesSlots; i++) {
        const row = ws.getRow(layout.necesidadesStart + i);
        const item = i < d.necesidades.length ? d.necesidades[i] : NECESIDAD_DEFECTO;
        const vacio = i >= d.necesidades.length || esNecesidadVacia(item);
        asignarTextoSimple(row.getCell(2), vacio ? '' : item.capacitacion);
        asignarTextoSimple(row.getCell(3), vacio ? '' : item.justificacion);
        asignarTextoSimple(row.getCell(5), vacio ? '' : item.fechaRequerida);
    }
    asignarTextoSimple(ws.getRow(layout.comentarios.row).getCell(layout.comentarios.col), d.comentarios || '');
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
            || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets.find(
        (h) => String(h.name || '').trim().toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase()
    ) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        registros: d.registros.map((r) => ({
            id: r.id,
            folio: r.folio,
            fechaEmision: r.fechaEmision,
            nombreSolicitante: r.nombreSolicitante,
            puestoSolicitante: r.puestoSolicitante,
            area: r.area,
            tipoIngreso: r.tipoIngreso,
            tipoCambioPuesto: r.tipoCambioPuesto,
            tipoFormacion: r.tipoFormacion,
            tipoExtraordinaria: r.tipoExtraordinaria,
            trabajadores: r.trabajadores.filter((t) => !esTrabajadorVacio(t)),
            necesidades: r.necesidades.filter((n) => !esNecesidadVacia(n)),
            comentarios: r.comentarios,
            pdfFirmadoId: r.pdfFirmado?.driveFileId || null
        })),
        registroActivoId: d.registroActivoId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
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
            console.warn('[ATH-F-06] No se pudo eliminar copia en Drive:', err.message);
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

/** Valida etiquetas típicas del DNC en la hoja copiada desde plantilla. */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const safeTitle = String(sheetTitle).replace(/'/g, "''");
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${safeTitle}'!A1:E40`
        );
        const texto = (filas || [])
            .flat()
            .map((c) => etiquetaNormalizada(c))
            .join(' | ');
        return texto.includes('fecha de emision')
            && (texto.includes('nombre del trabajador') || texto.includes('trabajadores'))
            && (texto.includes('identificacion de necesidades')
                || texto.includes('capacitacion requerida')
                || texto.includes('comentarios'));
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como destino de copia ATH-F-06.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[ATH-F-06] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
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
        console.warn('[ATH-F-06] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan etiquetas de DNC / ATH-F-06).`
        );
    }
    return copiada.title;
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/**
 * Última versión del mes: ATHF06-1026_3 > ATHF06-1026_2 > ATHF06-1026.
 */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => t === mes || new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede regenerar sobre el archivo plantilla ATH-F-06.');
    }
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[ATH-F-06] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[ATH-F-06] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[ATH-F-06] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
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
        throw new Error('No se puede sincronizar sobre el archivo plantilla ATH-F-06.');
    }
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[ATH-F-06] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[ATH-F-06] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;
    if (!titulos.length) return mesActual;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
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
        console.warn('[ATH-F-06] No se pudo resolver gid editor:', err.message);
    }
    return base;
}

/**
 * ATH-F-06 solo usa pestañas ATHF06-MMAA / ATHF06-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes.
 */
async function aplicarHistorialAthF06(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente: () => true,
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
 * Elimina pestañas Alias_r* residuales. Conserva ATHF06-MMAA(_N) e histograma.
 */
async function eliminarHojasHistorialFormatoAthF06(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
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
        console.warn(`[ATH-F-06] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') return false;
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) return null;
    try {
        const parsed = typeof registro.datos_json === 'string' ? JSON.parse(registro.datos_json) : registro.datos_json;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function formatearDatetimeMysqlMexico(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string' && !fecha.includes('T')) {
        const [datePart, timePart = '00:00:00'] = fecha.trim().split(/\s+/);
        const [y, m, d] = datePart.split('-');
        const [hh, mm] = timePart.split(':');
        if (!y || !m || !d) return String(fecha);
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${String(hh || '00').padStart(2, '0')}:${String(mm || '00').padStart(2, '0')}`;
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
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(dt);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    const dbVal = registro?.ultima_sync_drive;
    if (dbVal != null && dbVal !== '') return formatearDatetimeMysqlMexico(dbVal);
    if (archivoDrive?.modifiedTime) return formatearInstanteMexico(archivoDrive.modifiedTime);
    return null;
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    const editorUrl = driveId && driveId !== TEMPLATE_DRIVE_ID
        ? await editorUrlConHojaVigente(driveId)
        : null;
    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId && driveId !== TEMPLATE_DRIVE_ID ? driveId : DRIVE_FILE_ID_SISTEMA,
        editorUrl,
        previewUrl: driveId && driveId !== TEMPLATE_DRIVE_ID
            ? `https://docs.google.com/spreadsheets/d/${driveId}/preview`
            : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) return DRIVE_FILE_ID_SISTEMA;
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && await esSpreadsheetEditableEnDrive(idDb)) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
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
    let datosHoja = null;

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            datosHoja = await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId), { modo: 'vigente' });
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    // Archivero: la BD es la fuente de verdad (varios DNC).
    // La hoja solo refleja el registro activo; al fusionar no se reducen
    // trabajadores/necesidades si el parseo de la hoja trae menos filas.
    if (datosDb && Array.isArray(datosDb.registros) && datosDb.registros.length) {
        datos = datosHoja && hojaTieneContenido(datosHoja)
            ? fusionarHojaEnRegistroActivo(datosDb, datosHoja)
            : datosDb;
    } else if (datosHoja && hojaTieneContenido(datosHoja)) {
        datos = sanitizarDatos(datosHoja);
    } else {
        datos = null;
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo e histograma intactos.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoAthF06(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[ATH-F-06] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[ATH-F-06] «${destino}» no coincide con plantilla; se regenera.`);
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[ATH-F-06] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
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
            drive_file_id: driveFileId,
            ultima_sync_drive: null
        };
    }
    registro = { ...registro, drive_file_id: driveFileId || null };
    datos = sanitizarDatos(datos || DATOS_DEFECTO);

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo asegurar permiso de enlace:', err.message);
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
    if (body?.editorActivo || options.editorActivo) return sincronizarDesdeDrive(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const rawDatos = body?.datos || body || {};
    const datosEntrada = sanitizarDatos({
        ...rawDatos,
        registroActivoId: body?.registroActivoId || rawDatos?.registroActivoId || null
    });
    const origen = String(body?.origen || 'sistema').toLowerCase();
    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosEntrada.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    const driveId = await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId && driveId !== TEMPLATE_DRIVE_ID) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && await esSpreadsheetEditableEnDrive(driveId)) {
        try {
            await eliminarHojasHistorialFormatoAthF06(driveId);
            const fechaCambio = fechaHoyIso();
            const datosHistorial = origen !== 'consulta'
                ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                : datosEntrada;
            const hist = await aplicarHistorialAthF06({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: datosHistorial,
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

            let archivoDrive = null;
            const tituloSync = String(hist.hojaVigente || '').trim()
                || await resolverTituloHojaVigente(driveId);
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
            } catch (syncErr) {
                console.warn('[ATH-F-06] Sync hoja edición falló tras historial:', syncErr.message);
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
            console.warn('[ATH-F-06] No se pudo actualizar Google Sheet:', err.message);
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
        throw new Error('No se pudo sincronizar ATH-F-06: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[ATH-F-06] Adoptar plantilla en fallback:', adoptErr.message);
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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) return cargarFormato(pool);

    const datosDrive = sanitizarDatos(
        await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId), { modo: 'edicion' })
    );
    const datosPrevios = await leerDatosRegistro(registro);
    const datosFusionados = fusionarHojaEnRegistroActivo(
        datosPrevios || sanitizarDatos(DATOS_DEFECTO),
        datosDrive
    );
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosFusionados);
    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosFusionados.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(
            { ...registro, drive_file_id: driveFileId },
            datosPrevios || datosFusionados,
            archivoDrive
        );
    }

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialAthF06({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: { ...datosFusionados, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaCambio;
    }
    const datosGuardar = hist.datosGuardar;
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
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(await obtenerRegistroDb(pool), datosGuardar, archivoDrive);
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
        || DATOS_DEFECTO.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema ATH-F-06 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoAthF06(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo eliminar hoja previa del mes:', err.message);
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
    return construirRespuesta(await obtenerRegistroDb(pool), datosPublicar, archivoDrive);
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const parts = iso.split('-');
    const mm = parts[1] || '01';
    const yy = (parts[0] || '').slice(2, 4) || '00';
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `ATH-F-06 ${tag} - ${mm}/${yy}.pdf`;
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const registroId = String(body?.registroId || body?.registro_id || '').trim();
    if (!registroId) throw new Error('Se requiere registroId para asociar el PDF firmado.');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const registros = Array.isArray(datosPrevios.registros) ? [...datosPrevios.registros] : [];
    const idx = registros.findIndex((r) => r.id === registroId);
    if (idx < 0) throw new Error('No se encontró el DNC indicado en el archivero.');

    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfHistorial(registros[idx].folio),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(registros[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });
    registros[idx] = { ...registros[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        registros,
        registroActivoId: registroId
    });
    const driveSistema = await resolverDriveFileId(registroPrevio);
    await guardarRegistroDb(pool, {
        driveFileId: driveSistema || DRIVE_FILE_ID_SISTEMA,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });
    const archivoDrive = await driveService.obtenerInfoArchivo(driveSistema || DRIVE_FILE_ID_SISTEMA)
        .catch(() => ({ id: driveSistema || DRIVE_FILE_ID_SISTEMA }));
    return {
        ...(await construirRespuesta(await obtenerRegistroDb(pool), datosGuardar, archivoDrive)),
        pdfFirmado
    };
}

function sheetsApiAthF06() {
    return google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
}

async function obtenerHojaConMerges(spreadsheetId, sheetTitle) {
    const meta = await sheetsApiAthF06().spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),merges)'
    });
    return (meta.data.sheets || []).find((s) => String(s.properties?.title || '').trim() === String(sheetTitle).trim()) || null;
}

async function batchUpdateAthF06(spreadsheetId, requests) {
    if (!requests.length) return;
    await sheetsApiAthF06().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/**
 * En la copia del PDF deja solo las filas capturadas.
 * La plantilla del sistema conserva sus filas en blanco.
 */
async function recortarBloqueFilasPdf(spreadsheetId, sheetTitle, startRow1, slots, usados, colInicio, colFin) {
    const keep = Math.max(1, Math.min(slots, Math.max(0, usados)));
    const sobran = slots - keep;
    if (sobran <= 0) return;
    const sheet = await obtenerHojaConMerges(spreadsheetId, sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId == null) return;

    const headerIndex = Math.max(0, startRow1 - 2);
    const blockStart = startRow1 - 1;
    const blockEnd = blockStart + slots;
    const deleteStart = blockStart + keep;
    const unmerge = (sheet.merges || [])
        .filter((m) => m.startRowIndex < blockEnd && m.endRowIndex > headerIndex
            && m.startColumnIndex < 5 && m.endColumnIndex > 1)
        .map((m) => ({ unmergeCells: { range: { ...m, sheetId } } }));
    if (unmerge.length) {
        await batchUpdateAthF06(spreadsheetId, unmerge);
    }
    await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, deleteStart, sobran);

    const merges = [];
    const fusionarFila = (rowIndex) => ({
        mergeCells: {
            range: {
                sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: colInicio,
                endColumnIndex: colFin
            },
            mergeType: 'MERGE_ALL'
        }
    });
    merges.push(fusionarFila(headerIndex));
    for (let i = 0; i < keep; i++) merges.push(fusionarFila(blockStart + i));
    await batchUpdateAthF06(spreadsheetId, merges).catch((err) => {
        console.warn('[ATH-F-06] No se pudieron restaurar las fusiones del PDF:', err.message);
    });
}

async function recortarFilasSobrantesPdf(spreadsheetId, sheetTitle, datos) {
    const d = aPayloadHoja(datos);
    let { ws } = await cargarWorkbook(spreadsheetId, sheetTitle);
    if (!ws) return;
    let layout = parsearLayoutDesdeHoja(ws);
    await recortarBloqueFilasPdf(
        spreadsheetId,
        sheetTitle,
        layout.trabajadoresStart,
        layout.trabajadoresSlots,
        d.trabajadores.length,
        2,
        5
    );
    ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
    if (!ws) return;
    layout = parsearLayoutDesdeHoja(ws);
    await recortarBloqueFilasPdf(
        spreadsheetId,
        sheetTitle,
        layout.necesidadesStart,
        layout.necesidadesSlots,
        d.necesidades.length,
        2,
        4
    );
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema ATH-F-06 configurado para exportar a PDF.');
    }
    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
    const copia = await driveService.copiarGoogleSheetACarpeta(
        driveFileId,
        `ATH-F-06 PDF temporal ${Date.now()}`,
        CARPETA_DRIVE_ID
    );
    try {
        // En la copia temporal sí se puede escribir; no es la plantilla maestra.
        const layout = await asegurarFilasDinamicas(copia.id, tituloHoja, datos);
        const actualizaciones = datosAActualizacionesSheet(datos, tituloHoja, layout);
        const CHUNK = 200;
        for (let i = 0; i < actualizaciones.length; i += CHUNK) {
            await driveService.actualizarCeldasGoogleSheet(copia.id, actualizaciones.slice(i, i + CHUNK));
        }
        await recortarFilasSobrantesPdf(copia.id, tituloHoja, datos);
        const gid = await driveService.obtenerGidHojaPorNombre(copia.id, tituloHoja);
        if (gid == null) throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
        const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(copia.id, { gid });
        if (!pdfBuffer || !pdfBuffer.length) throw new Error('La exportación a PDF de ATH-F-06 quedó vacía.');
        return Buffer.from(pdfBuffer);
    } finally {
        await driveService.eliminarArchivo(copia.id).catch((err) => {
            console.warn('[ATH-F-06] No se pudo borrar la copia temporal del PDF:', err.message);
        });
    }
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
    subirPdfFirmado,
    descargarPlantillaPdf,
    sanitizarDatos,
    crearRegistroVacio
};
