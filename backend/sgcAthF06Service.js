/**
 * ATH-F-06 · Detección de necesidades de capacitación (DNC).
 *
 * Plantilla (hoja «Plantilla», columnas B–E):
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
const TEMPLATE_DRIVE_ID = '1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc';
const DRIVE_FILE_ID_SISTEMA = '1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const NOMBRE_ARCHIVO_DRIVE = 'ATH-F-06 DNC (sistema)';
const SHEET_TITLE = 'Plantilla';
const MAX_TRABAJADORES = 40;
const MAX_NECESIDADES = 30;

const LAYOUT_BASE = {
    revision: { row: 3, col: 3 },
    fechaRevision: { row: 3, col: 4 },
    fechaEmision: { row: 7, col: 2 },
    nombreSolicitante: { row: 7, col: 3 },
    puestoSolicitante: { row: 7, col: 5 },
    area: { row: 9, col: 2 },
    requerimiento: { row: 11, col: 2 },
    trabajadoresStart: 13,
    trabajadoresEnd: 25,
    trabajadoresSlots: 13,
    necesidadesStart: 28,
    necesidadesEnd: 28,
    necesidadesSlots: 1,
    comentarios: { row: 31, col: 2 }
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
    const marca = (activo) => (activo ? 'X' : '___');
    return `Ingreso ${marca(reg.tipoIngreso)} Cambio de puesto ${marca(reg.tipoCambioPuesto)} Formación y desarrollo ${marca(reg.tipoFormacion)} Capacitación extraordinaria ${marca(reg.tipoExtraordinaria)}`;
}

function parsearTiposRequerimiento(texto) {
    const t = String(texto || '');
    const tomar = (label) => {
        const re = new RegExp(`${label}\\s+(X+|_+)`, 'i');
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
        return sanitizarRegistro({
            ...r,
            fechaEmision: hojaReg.fechaEmision,
            nombreSolicitante: hojaReg.nombreSolicitante,
            puestoSolicitante: hojaReg.puestoSolicitante,
            area: hojaReg.area,
            tipoIngreso: hojaReg.tipoIngreso,
            tipoCambioPuesto: hojaReg.tipoCambioPuesto,
            tipoFormacion: hojaReg.tipoFormacion,
            tipoExtraordinaria: hojaReg.tipoExtraordinaria,
            trabajadores: hojaReg.trabajadores,
            necesidades: hojaReg.necesidades,
            comentarios: hojaReg.comentarios,
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
    const endTrab = necesidadesSeccion ? Math.max(startTrab, necesidadesSeccion.row - 1) : LAYOUT_BASE.trabajadoresEnd;
    layout.trabajadoresStart = startTrab;
    layout.trabajadoresEnd = endTrab;
    layout.trabajadoresSlots = Math.max(1, endTrab - startTrab + 1);

    const startNec = necesidadesHeader ? necesidadesHeader.row + 1 : LAYOUT_BASE.necesidadesStart;
    const endNec = comentarios ? Math.max(startNec, comentarios.row - 1) : LAYOUT_BASE.necesidadesEnd;
    layout.necesidadesStart = startNec;
    layout.necesidadesEnd = endNec;
    layout.necesidadesSlots = Math.max(1, endNec - startNec + 1);
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
        if (!esTrabajadorVacio(item)) trabajadores.push(item);
    }
    const necesidades = [];
    for (let r = layout.necesidadesStart; r <= layout.necesidadesEnd; r++) {
        const row = ws.getRow(r);
        const item = sanitizarNecesidad({
            capacitacion: celdaATexto(row.getCell(2).value),
            justificacion: celdaATexto(row.getCell(3).value),
            fechaRequerida: celdaATexto(row.getCell(5).value)
        });
        if (!esNecesidadVacia(item)) necesidades.push(item);
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
    pushUpdate(actualizaciones, layout.nombreSolicitante.row, layout.nombreSolicitante.col, d.nombreSolicitante || '', sheetTitle);
    pushUpdate(actualizaciones, layout.puestoSolicitante.row, layout.puestoSolicitante.col, d.puestoSolicitante || '', sheetTitle);
    pushUpdate(actualizaciones, layout.area.row, layout.area.col, d.area || '', sheetTitle);
    pushUpdate(actualizaciones, layout.requerimiento.row, layout.requerimiento.col, textoRequerimiento(d), sheetTitle);

    for (let i = 0; i < layout.trabajadoresSlots; i++) {
        const row = layout.trabajadoresStart + i;
        const item = i < d.trabajadores.length ? d.trabajadores[i] : TRABAJADOR_DEFECTO;
        const vacio = i >= d.trabajadores.length || esTrabajadorVacio(item);
        pushUpdate(actualizaciones, row, 2, vacio ? '' : item.nombre, sheetTitle);
        pushUpdate(actualizaciones, row, 3, vacio ? '' : item.puesto, sheetTitle);
    }
    for (let i = 0; i < layout.necesidadesSlots; i++) {
        const row = layout.necesidadesStart + i;
        const item = i < d.necesidades.length ? d.necesidades[i] : NECESIDAD_DEFECTO;
        const vacio = i >= d.necesidades.length || esNecesidadVacia(item);
        pushUpdate(actualizaciones, row, 2, vacio ? '' : item.capacitacion, sheetTitle);
        pushUpdate(actualizaciones, row, 3, vacio ? '' : item.justificacion, sheetTitle);
        pushUpdate(actualizaciones, row, 5, vacio ? '' : item.fechaRequerida, sheetTitle);
    }
    pushUpdate(actualizaciones, layout.comentarios.row, layout.comentarios.col, d.comentarios || '', sheetTitle);
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

async function asegurarFilasDinamicas(spreadsheetId, sheetTitle, datos) {
    let { ws } = await cargarWorkbook(spreadsheetId, sheetTitle);
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    let layout = parsearLayoutDesdeHoja(ws);
    const d = aPayloadHoja(datos);
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);

    const trabNecesarias = Math.min(MAX_TRABAJADORES, Math.max(layout.trabajadoresSlots, d.trabajadores.length));
    const extraTrab = Math.max(0, trabNecesarias - layout.trabajadoresSlots);
    if (extraTrab > 0 && sheetId != null) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.trabajadoresEnd, extraTrab, { inheritFromBefore: true });
        await driveService.fusionarRangoGoogleSheet(
            spreadsheetId, sheetId, layout.trabajadoresEnd, layout.trabajadoresEnd + extraTrab, 2, 5
        ).catch((err) => console.warn('[ATH-F-06] No se pudo fusionar filas de trabajadores:', err.message));
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }

    const necNecesarias = Math.min(MAX_NECESIDADES, Math.max(layout.necesidadesSlots, d.necesidades.length));
    const extraNec = Math.max(0, necNecesarias - layout.necesidadesSlots);
    if (extraNec > 0 && sheetId != null) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.necesidadesEnd, extraNec, { inheritFromBefore: true });
        await driveService.fusionarRangoGoogleSheet(
            spreadsheetId, sheetId, layout.necesidadesEnd, layout.necesidadesEnd + extraNec, 2, 4
        ).catch((err) => console.warn('[ATH-F-06] No se pudo fusionar filas de necesidades:', err.message));
        ({ ws } = await cargarWorkbook(spreadsheetId, sheetTitle));
        layout = parsearLayoutDesdeHoja(ws);
    }
    return layout;
}

async function aplicarFormatoVisualAthF06(spreadsheetId, sheetTitle, layout) {
    const rangos = [
        { startRow: layout.fechaEmision.row, endRow: layout.fechaEmision.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' },
        { startRow: layout.area.row, endRow: layout.area.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' },
        { startRow: layout.requerimiento.row, endRow: layout.requerimiento.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' },
        { startRow: layout.trabajadoresStart, endRow: layout.trabajadoresEnd, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' },
        { startRow: layout.necesidadesStart, endRow: layout.necesidadesEnd, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' },
        { startRow: layout.comentarios.row, endRow: layout.comentarios.row, startColumn: 2, endColumn: 5, horizontalAlignment: 'LEFT' }
    ];
    for (const rango of rangos) {
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
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const layout = await asegurarFilasDinamicas(spreadsheetId, titulo, datos);
    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualAthF06(spreadsheetId, titulo, layout);
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

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(spreadsheetId, SHEET_TITLE, CODIGO_FORMATO);
    } catch (err) {
        console.warn('[ATH-F-06] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla ATH-F-06 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    return Buffer.from(await wb.xlsx.writeBuffer());
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

function estructuraEsEquivalente() {
    return true;
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function aplicarHistorialAthF06(opciones) {
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
            await escribirSnapshotEnHojaDrive(opciones.spreadsheetId, result.hojaVigente, result.datosGuardar);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
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

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
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

async function resolverDriveFileId(registro) {
    const candidatos = [DRIVE_FILE_ID_SISTEMA, registro?.drive_file_id].filter(Boolean);
    for (const id of [...new Set(candidatos.map((v) => String(v).trim()))]) {
        if (await esSpreadsheetEditableEnDrive(id)) return id;
    }
    return DRIVE_FILE_ID_SISTEMA;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    const datosDb = await leerDatosRegistro(registro);
    const driveFileId = await resolverDriveFileId(registro);
    let datosHoja = null;
    let archivoDrive = null;
    if (driveFileId) {
        try {
            datosHoja = await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId));
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[ATH-F-06] No se pudo leer archivo en Drive, usando BD:', err.message);
        }
    }
    let datos;
    if (datosDb && Array.isArray(datosDb.registros) && datosDb.registros.length) {
        datos = datosHoja && hojaTieneContenido(datosHoja)
            ? fusionarHojaEnRegistroActivo(datosDb, datosHoja)
            : datosDb;
    } else if (datosHoja && hojaTieneContenido(datosHoja)) {
        datos = sanitizarDatos(datosHoja);
    } else {
        datos = sanitizarDatos({
            ...(datosHoja || DATOS_DEFECTO),
            registros: []
        });
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
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) return sincronizarDesdeDrive(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const rawDatos = body?.datos || body || {};
    const datosEntrada = sanitizarDatos({
        ...rawDatos,
        registroActivoId: body?.registroActivoId || rawDatos?.registroActivoId || null
    });
    const origen = String(body?.origen || 'sistema').toLowerCase();
    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    const driveId = await resolverDriveFileId(registroPrevio);

    let datosGuardar = { ...datosEntrada };
    if (driveId && await esSpreadsheetEditableEnDrive(driveId)) {
        try {
            if (huboCambio) {
                const hist = await aplicarHistorialAthF06({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: { ...datosEntrada },
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = hist.datosGuardar;
                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = fechaHoyIso();
                }
                if (!hist.aplicado) {
                    await actualizarDatosEnGoogleSheet(driveId, datosGuardar, await resolverTituloHojaTrabajo(driveId));
                }
            } else {
                await actualizarDatosEnGoogleSheet(driveId, datosEntrada, await resolverTituloHojaTrabajo(driveId));
            }
            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal;
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
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

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal;
    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(buffer, NOMBRE_ARCHIVO_DRIVE, CARPETA_DRIVE_ID, {
        sheetTitle: SHEET_TITLE,
        maxColumns: 6,
        keepSingleSheet: false
    });
    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
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
    if (!driveFileId) return cargarFormato(pool);
    const datosDrive = sanitizarDatos(await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId), { modo: 'edicion' }));
    const datosPrevios = await leerDatosRegistro(registro);
    const datosFusionados = fusionarHojaEnRegistroActivo(datosPrevios || sanitizarDatos(DATOS_DEFECTO), datosDrive);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosFusionados);
    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datosFusionados.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    if (huboCambio) {
        const hist = await aplicarHistorialAthF06({
            spreadsheetId: driveFileId,
            datosPrevios,
            datosNuevos: datosFusionados,
            origen: 'drive'
        });
        if (hist.aplicado) {
            contenidoModificado = true;
            fechaModificacion = fechaHoyIso();
        }
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: hist.datosGuardar,
            fechaElaboracionOriginal: fechaOriginal,
            fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
            contenidoModificado
        });
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(await obtenerRegistroDb(pool), hist.datosGuardar, archivoDrive);
    }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosFusionados, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveId = await resolverDriveFileId(registro);
    await actualizarDatosEnGoogleSheet(driveId, datos, SHEET_TITLE);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });
    return construirRespuesta(await obtenerRegistroDb(pool), datos, archivoDrive);
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
    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });
    const archivoDrive = await driveService.obtenerInfoArchivo(DRIVE_FILE_ID_SISTEMA).catch(() => ({ id: DRIVE_FILE_ID_SISTEMA }));
    return { ...construirRespuesta(await obtenerRegistroDb(pool), datosGuardar, archivoDrive), pdfFirmado };
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
    if (!driveFileId) throw new Error('No hay Google Sheet ATH-F-06 configurado para exportar a PDF.');
    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    const copia = await driveService.copiarGoogleSheetACarpeta(
        driveFileId,
        `ATH-F-06 PDF temporal ${Date.now()}`,
        CARPETA_DRIVE_ID
    );
    try {
        await actualizarDatosEnGoogleSheet(copia.id, datos, tituloHoja);
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
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sanitizarDatos,
    crearRegistroVacio
};
