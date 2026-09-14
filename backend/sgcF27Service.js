/**
 * SGC-F-27 · Orden de compra — persistencia en biznaga_sgc y sync con Drive.
 *
 * Plantilla (hoja «Plantilla»):
 *   H5 número de O/C · A12–B16 Para · E12–F16 Enviar a
 *   A19 fecha · B19 solicitante · C19 enviado · E19 entrega · G19 términos
 *   Partidas desde fila 23 (expandible según ítems) · totales debajo · A30 observaciones
 *   Firmas Solicitó / Autorizó más abajo
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-27';
const TEMPLATE_DRIVE_ID = '1Pb8M0vH5hIPpoTUoLcAUJkljIQ7g1041xVSGpy3ZrCQ';
const DRIVE_FILE_ID_SISTEMA = '1Pb8M0vH5hIPpoTUoLcAUJkljIQ7g1041xVSGpy3ZrCQ';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** PDF firmados (histórico por orden); carpeta dedicada de Órdenes de compra. */
const CARPETA_PDF_FIRMADOS_ID = '1EvrE-BRlMFgXVGSNo5eTvaNP5U3xvtXF';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-27 Orden de compra (sistema)';
const SHEET_TITLE = 'Plantilla';
const MAX_PARTIDAS = 40;
/** Slots base en plantilla corregida (1 fila). Se expanden/contraen según partidas reales. */
const PARTIDAS_SLOTS_BASE = 1;
const IMPUESTO_PCT_DEFECTO = 16;
const FUENTE_DATOS = { name: 'Century Gothic', size: 11 };

/** Layout alineado a la plantilla corregida (1 fila de partida; Sub total en fila 24). */
const LAYOUT_BASE = {
    revision: { row: 2, col: 7 },
    fechaRevision: { row: 3, col: 7 },
    numeroOc: { row: 5, col: 8 },
    empresaNombre: { row: 6, col: 1 },
    empresaDireccion: { row: 7, col: 2 },
    empresaCiudad: { row: 8, col: 1 },
    empresaCp: { row: 8, col: 4 },
    empresaTelefono: { row: 9, col: 2 },
    paraNombre: { row: 12, col: 2 },
    paraCompania: { row: 13, col: 2 },
    paraDireccion: { row: 14, col: 2 },
    paraCiudad: { row: 15, col: 2 },
    paraTelefono: { row: 16, col: 2 },
    enviarNombre: { row: 12, col: 6 },
    enviarCompania: { row: 13, col: 6 },
    enviarDireccion: { row: 14, col: 6 },
    enviarCiudad: { row: 15, col: 6 },
    enviarTelefono: { row: 16, col: 6 },
    fechaOc: { row: 19, col: 1 },
    solicitante: { row: 19, col: 2 },
    enviadoMediante: { row: 19, col: 3 },
    fechaEntrega: { row: 19, col: 5 },
    terminos: { row: 19, col: 7 },
    itemsStart: 23,
    itemsEnd: 23,
    itemsSlots: 1,
    subtotalLabelRow: 24,
    subtotal: { row: 24, col: 8 },
    descuentoPct: { row: 25, col: 8 },
    baseGravable: { row: 26, col: 8 },
    impuesto: { row: 27, col: 8 },
    total: { row: 28, col: 8 },
    observaciones: { row: 30, col: 1 },
    solicitoNombre: { row: 36, col: 1 },
    autorizoNombre: { row: 36, col: 4 }
};

const PARTIDA_DEFECTO = { descripcion: '', cantidad: 0, precioUnitario: 0 };

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-07-18',
    revision: '00',
    fechaRevision: '2025-07-18',
    empresaNombre: 'BIZNAGA RISK AND TECH',
    empresaDireccion: '',
    empresaCiudad: 'Pachuca de Soto, Hgo.',
    empresaCp: '',
    empresaTelefono: '',
    ordenes: [],
    ordenActivaId: null
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
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return String(valor);
    }
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
        if (valor.formula) return celdaATexto(valor.result);
    }
    return normalizarSaltosLinea(String(valor));
}

function aNumero(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (valor && typeof valor === 'object') {
        if (typeof valor.result === 'number') return valor.result;
        if (typeof valor.result === 'string') return aNumero(valor.result);
    }
    const t = String(valor == null ? '' : valor)
        .replace(/[$%\s]/g, '')
        .replace(/,/g, '');
    if (!t) return 0;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
}

function redondearDinero(valor) {
    return Math.round((Number(valor) || 0) * 100) / 100;
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
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return formatearFechaIso(d);
    }
    return raw.slice(0, 10);
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
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

function nuevoIdOrden() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `oc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-27 Orden de compra firmada.pdf').trim()
            || 'SGC-F-27 Orden de compra firmada.pdf',
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarPartida(item) {
    const cantidad = Math.max(0, aNumero(item?.cantidad));
    const precioUnitario = Math.max(0, aNumero(item?.precioUnitario ?? item?.precio_unitario ?? item?.precioUnit));
    return {
        descripcion: normalizarSaltosLinea(item?.descripcion || ''),
        cantidad,
        precioUnitario
    };
}

function esPartidaVacia(item) {
    const p = sanitizarPartida(item);
    return !p.descripcion && !(p.cantidad > 0) && !(p.precioUnitario > 0);
}

function importePartida(item) {
    const p = sanitizarPartida(item);
    return redondearDinero(p.cantidad * p.precioUnitario);
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) {
        out.push(factory());
    }
    return out;
}

function calcularTotales(orden) {
    const partidas = Array.isArray(orden?.partidas) ? orden.partidas : [];
    const subtotal = redondearDinero(partidas.reduce((acc, p) => acc + importePartida(p), 0));
    const descuentoPct = Math.max(0, aNumero(orden?.descuentoPct ?? orden?.descuento_pct));
    const impuestoPct = Math.max(0, aNumero(orden?.impuestoPct ?? orden?.impuesto_pct) || IMPUESTO_PCT_DEFECTO);
    const descuentoImporte = redondearDinero(subtotal * (descuentoPct / 100));
    const baseGravable = redondearDinero(subtotal - descuentoImporte);
    const impuesto = redondearDinero(baseGravable * (impuestoPct / 100));
    const total = redondearDinero(baseGravable + impuesto);
    return { subtotal, descuentoPct, descuentoImporte, baseGravable, impuestoPct, impuesto, total };
}

function crearOrdenVacia() {
    return {
        id: nuevoIdOrden(),
        folio: '',
        fechaOc: '',
        solicitante: '',
        enviadoMediante: '',
        fechaEntrega: '',
        terminos: '',
        paraNombre: '',
        paraCompania: '',
        paraDireccion: '',
        paraCiudad: '',
        paraTelefono: '',
        enviarNombre: '',
        enviarCompania: '',
        enviarDireccion: '',
        enviarCiudad: '',
        enviarTelefono: '',
        partidas: [{ ...PARTIDA_DEFECTO }],
        descuentoPct: 0,
        impuestoPct: IMPUESTO_PCT_DEFECTO,
        observaciones: '',
        solicitoNombre: '',
        autorizoNombre: '',
        pdfFirmado: null
    };
}

function sanitizarOrden(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const partidas = (Array.isArray(base.partidas) ? base.partidas : [])
        .map(sanitizarPartida)
        .filter((p) => !esPartidaVacia(p))
        .slice(0, MAX_PARTIDAS);
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    const descuentoPct = Math.max(0, aNumero(base.descuentoPct ?? base.descuento_pct));
    const rawImpuestoPct = base.impuestoPct ?? base.impuesto_pct;
    const impuestoPct = (rawImpuestoPct === undefined || rawImpuestoPct === null || rawImpuestoPct === '')
        ? IMPUESTO_PCT_DEFECTO
        : Math.max(0, aNumero(rawImpuestoPct));

    const folio = String(base.folio || base.numeroOc || base.numero_oc || '').trim();
    return {
        id: String(base.id || '').trim() || nuevoIdOrden(),
        folio,
        fechaOc: formatearFechaIso(base.fechaOc || base.fecha_oc || base.fecha),
        solicitante: String(base.solicitante || '').trim(),
        enviadoMediante: String(base.enviadoMediante || base.enviado_mediante || '').trim(),
        fechaEntrega: formatearFechaIso(base.fechaEntrega || base.fecha_entrega),
        terminos: String(base.terminos || base.terminosCondiciones || '').trim(),
        paraNombre: String(base.paraNombre || base.para_nombre || '').trim(),
        paraCompania: String(base.paraCompania || base.para_compania || '').trim(),
        paraDireccion: String(base.paraDireccion || base.para_direccion || '').trim(),
        paraCiudad: String(base.paraCiudad || base.para_ciudad || '').trim(),
        paraTelefono: String(base.paraTelefono || base.para_telefono || '').trim(),
        enviarNombre: String(base.enviarNombre || base.enviar_nombre || '').trim(),
        enviarCompania: String(base.enviarCompania || base.enviar_compania || '').trim(),
        enviarDireccion: String(base.enviarDireccion || base.enviar_direccion || '').trim(),
        enviarCiudad: String(base.enviarCiudad || base.enviar_ciudad || '').trim(),
        enviarTelefono: String(base.enviarTelefono || base.enviar_telefono || '').trim(),
        partidas: conFilasMinimas(partidas, 1, () => ({ ...PARTIDA_DEFECTO })),
        descuentoPct,
        impuestoPct,
        observaciones: normalizarSaltosLinea(base.observaciones),
        solicitoNombre: String(base.solicitoNombre || base.solicito_nombre || '').trim(),
        autorizoNombre: String(base.autorizoNombre || base.autorizo_nombre || '').trim(),
        pdfFirmado
    };
}

function esOrdenLegacyPlana(base) {
    return !Array.isArray(base?.ordenes)
        && !!(base?.paraNombre || base?.paraCompania || base?.folio || base?.partidas
            || base?.fechaOc || base?.solicitante || base?.observaciones);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let ordenesRaw = [];
    if (Array.isArray(base.ordenes)) {
        ordenesRaw = base.ordenes;
    } else if (esOrdenLegacyPlana(base)) {
        ordenesRaw = [base];
    }
    const ordenes = ordenesRaw.map(sanitizarOrden);
    const ordenActivaId = base.ordenActivaId
        ? String(base.ordenActivaId)
        : (ordenes[0]?.id || null);

    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: extraerFechaRevision(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        empresaNombre: String(base.empresaNombre || DATOS_DEFECTO.empresaNombre).trim() || DATOS_DEFECTO.empresaNombre,
        empresaDireccion: String(base.empresaDireccion || '').trim(),
        empresaCiudad: String(base.empresaCiudad || DATOS_DEFECTO.empresaCiudad).trim() || DATOS_DEFECTO.empresaCiudad,
        empresaCp: String(base.empresaCp || '').trim(),
        empresaTelefono: String(base.empresaTelefono || '').trim(),
        ordenes,
        ordenActivaId: ordenActivaId && ordenes.some((o) => o.id === ordenActivaId)
            ? ordenActivaId
            : (ordenes[0]?.id || null)
    };
}

function resolverOrdenActiva(datos) {
    const lista = Array.isArray(datos?.ordenes) ? datos.ordenes : [];
    if (!lista.length) return crearOrdenVacia();
    const id = datos?.ordenActivaId;
    if (id) {
        const found = lista.find((o) => o.id === id);
        if (found) return found;
    }
    return lista[0];
}

function aPayloadHoja(datos) {
    const d = sanitizarDatos(datos);
    const o = resolverOrdenActiva(d);
    const tot = calcularTotales(o);
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fechaElaboracion: d.fechaElaboracion,
        empresaNombre: d.empresaNombre,
        empresaDireccion: d.empresaDireccion,
        empresaCiudad: d.empresaCiudad,
        empresaCp: d.empresaCp,
        empresaTelefono: d.empresaTelefono,
        folio: o.folio,
        fechaOc: o.fechaOc,
        solicitante: o.solicitante,
        enviadoMediante: o.enviadoMediante,
        fechaEntrega: o.fechaEntrega,
        terminos: o.terminos,
        paraNombre: o.paraNombre,
        paraCompania: o.paraCompania,
        paraDireccion: o.paraDireccion,
        paraCiudad: o.paraCiudad,
        paraTelefono: o.paraTelefono,
        enviarNombre: o.enviarNombre,
        enviarCompania: o.enviarCompania,
        enviarDireccion: o.enviarDireccion,
        enviarCiudad: o.enviarCiudad,
        enviarTelefono: o.enviarTelefono,
        partidas: o.partidas,
        observaciones: o.observaciones,
        solicitoNombre: o.solicitoNombre,
        autorizoNombre: o.autorizoNombre,
        ...tot
    };
}

function ordenTieneContenido(o) {
    if (!o) return false;
    return !!(o.paraNombre || o.paraCompania || o.enviarNombre || o.enviarCompania
        || o.solicitante || o.enviadoMediante || o.terminos || o.observaciones
        || o.solicitoNombre || o.autorizoNombre
        || (Array.isArray(o.partidas) && o.partidas.some((p) => !esPartidaVacia(p)))
        || o.pdfFirmado?.driveFileId);
}

function hojaTieneContenido(datosHoja) {
    const hoja = sanitizarDatos(datosHoja || {});
    if (hoja.ordenes.length) return hoja.ordenes.some(ordenTieneContenido);
    return ordenTieneContenido(resolverOrdenActiva(hoja));
}

function fusionarHojaEnOrdenActiva(datosDb, datosHoja) {
    const db = sanitizarDatos(datosDb || DATOS_DEFECTO);
    const hoja = sanitizarDatos(datosHoja || {});
    const hojaOrden = resolverOrdenActiva(hoja);

    const letterhead = {
        empresaNombre: hoja.empresaNombre || db.empresaNombre,
        empresaDireccion: hoja.empresaDireccion || db.empresaDireccion,
        empresaCiudad: hoja.empresaCiudad || db.empresaCiudad,
        empresaCp: hoja.empresaCp || db.empresaCp,
        empresaTelefono: hoja.empresaTelefono || db.empresaTelefono,
        revision: hoja.revision || db.revision,
        fechaRevision: hoja.fechaRevision || db.fechaRevision,
        fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion
    };

    if (!db.ordenes.length) {
        if (!hojaTieneContenido(hoja)) {
            return sanitizarDatos({ ...db, ...letterhead });
        }
        const primero = sanitizarOrden({ ...hojaOrden, pdfFirmado: null });
        return sanitizarDatos({
            ...letterhead,
            ordenes: [primero],
            ordenActivaId: primero.id
        });
    }

    const activaId = db.ordenActivaId && db.ordenes.some((o) => o.id === db.ordenActivaId)
        ? db.ordenActivaId
        : db.ordenes[0].id;

    const ordenes = db.ordenes.map((o) => {
        if (o.id !== activaId) return o;
        return sanitizarOrden({
            ...o,
            folio: hojaOrden.folio || o.folio,
            fechaOc: hojaOrden.fechaOc,
            solicitante: hojaOrden.solicitante,
            enviadoMediante: hojaOrden.enviadoMediante,
            fechaEntrega: hojaOrden.fechaEntrega,
            terminos: hojaOrden.terminos,
            paraNombre: hojaOrden.paraNombre,
            paraCompania: hojaOrden.paraCompania,
            paraDireccion: hojaOrden.paraDireccion,
            paraCiudad: hojaOrden.paraCiudad,
            paraTelefono: hojaOrden.paraTelefono,
            enviarNombre: hojaOrden.enviarNombre,
            enviarCompania: hojaOrden.enviarCompania,
            enviarDireccion: hojaOrden.enviarDireccion,
            enviarCiudad: hojaOrden.enviarCiudad,
            enviarTelefono: hojaOrden.enviarTelefono,
            partidas: hojaOrden.partidas,
            descuentoPct: hojaOrden.descuentoPct,
            impuestoPct: hojaOrden.impuestoPct,
            observaciones: hojaOrden.observaciones,
            solicitoNombre: hojaOrden.solicitoNombre,
            autorizoNombre: hojaOrden.autorizoNombre,
            pdfFirmado: o.pdfFirmado
        });
    });

    return sanitizarDatos({
        ...letterhead,
        ordenes,
        ordenActivaId: activaId
    });
}

function buscarFilaEtiqueta(ws, needles, maxRow = 80) {
    const maxCol = Math.min(Number(ws.columnCount) || 8, 8);
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
    const subtotal = buscarFilaEtiqueta(ws, ['sub total', 'subtotal']);
    if (subtotal) {
        layout.subtotalLabelRow = subtotal.row;
        layout.subtotal = { row: subtotal.row, col: 8 };
        layout.descuentoPct = { row: subtotal.row + 1, col: 8 };
        layout.baseGravable = { row: subtotal.row + 2, col: 8 };
        layout.impuesto = { row: subtotal.row + 3, col: 8 };
        layout.total = { row: subtotal.row + 4, col: 8 };
        layout.observaciones = { row: subtotal.row + 6, col: 1 };
        layout.solicitoNombre = { row: subtotal.row + 11, col: 1 };
        layout.autorizoNombre = { row: subtotal.row + 11, col: 4 };
        layout.itemsEnd = Math.max(layout.itemsStart, subtotal.row - 1);
        layout.itemsSlots = Math.max(1, layout.itemsEnd - layout.itemsStart + 1);
    }
    return layout;
}

function parsearDatosDesdeHoja(ws) {
    const layout = parsearLayoutDesdeHoja(ws);
    const partidas = [];
    for (let r = layout.itemsStart; r <= layout.itemsEnd; r++) {
        const row = ws.getRow(r);
        const item = sanitizarPartida({
            descripcion: celdaATexto(row.getCell(2).value),
            cantidad: row.getCell(6).value,
            precioUnitario: row.getCell(7).value
        });
        if (!esPartidaVacia(item)) partidas.push(item);
    }

    const tot = calcularTotales({
        partidas,
        descuentoPct: ws.getRow(layout.descuentoPct.row).getCell(layout.descuentoPct.col).value,
        impuestoPct: IMPUESTO_PCT_DEFECTO
    });
    const impuestoHoja = aNumero(ws.getRow(layout.impuesto.row).getCell(layout.impuesto.col).value);
    let impuestoPct = IMPUESTO_PCT_DEFECTO;
    if (tot.baseGravable > 0 && impuestoHoja > 0) {
        impuestoPct = redondearDinero((impuestoHoja / tot.baseGravable) * 100);
    }

    return sanitizarDatos({
        revision: extraerRevision(celdaATexto(ws.getRow(layout.revision.row).getCell(layout.revision.col).value)),
        fechaRevision: extraerFechaRevision(celdaATexto(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col).value)),
        empresaNombre: celdaATexto(ws.getRow(layout.empresaNombre.row).getCell(layout.empresaNombre.col).value) || DATOS_DEFECTO.empresaNombre,
        empresaDireccion: celdaATexto(ws.getRow(layout.empresaDireccion.row).getCell(layout.empresaDireccion.col).value),
        empresaCiudad: celdaATexto(ws.getRow(layout.empresaCiudad.row).getCell(layout.empresaCiudad.col).value) || DATOS_DEFECTO.empresaCiudad,
        empresaCp: celdaATexto(ws.getRow(layout.empresaCp.row).getCell(layout.empresaCp.col).value),
        empresaTelefono: celdaATexto(ws.getRow(layout.empresaTelefono.row).getCell(layout.empresaTelefono.col).value),
        folio: celdaATexto(ws.getRow(layout.numeroOc.row).getCell(layout.numeroOc.col).value),
        fechaOc: celdaATexto(ws.getRow(layout.fechaOc.row).getCell(layout.fechaOc.col).value),
        solicitante: celdaATexto(ws.getRow(layout.solicitante.row).getCell(layout.solicitante.col).value),
        enviadoMediante: celdaATexto(ws.getRow(layout.enviadoMediante.row).getCell(layout.enviadoMediante.col).value),
        fechaEntrega: celdaATexto(ws.getRow(layout.fechaEntrega.row).getCell(layout.fechaEntrega.col).value),
        terminos: celdaATexto(ws.getRow(layout.terminos.row).getCell(layout.terminos.col).value),
        paraNombre: celdaATexto(ws.getRow(layout.paraNombre.row).getCell(layout.paraNombre.col).value),
        paraCompania: celdaATexto(ws.getRow(layout.paraCompania.row).getCell(layout.paraCompania.col).value),
        paraDireccion: celdaATexto(ws.getRow(layout.paraDireccion.row).getCell(layout.paraDireccion.col).value),
        paraCiudad: celdaATexto(ws.getRow(layout.paraCiudad.row).getCell(layout.paraCiudad.col).value),
        paraTelefono: celdaATexto(ws.getRow(layout.paraTelefono.row).getCell(layout.paraTelefono.col).value),
        enviarNombre: celdaATexto(ws.getRow(layout.enviarNombre.row).getCell(layout.enviarNombre.col).value),
        enviarCompania: celdaATexto(ws.getRow(layout.enviarCompania.row).getCell(layout.enviarCompania.col).value),
        enviarDireccion: celdaATexto(ws.getRow(layout.enviarDireccion.row).getCell(layout.enviarDireccion.col).value),
        enviarCiudad: celdaATexto(ws.getRow(layout.enviarCiudad.row).getCell(layout.enviarCiudad.col).value),
        enviarTelefono: celdaATexto(ws.getRow(layout.enviarTelefono.row).getCell(layout.enviarTelefono.col).value),
        partidas,
        descuentoPct: tot.descuentoPct,
        impuestoPct,
        observaciones: celdaATexto(ws.getRow(layout.observaciones.row).getCell(layout.observaciones.col).value),
        solicitoNombre: celdaATexto(ws.getRow(layout.solicitoNombre.row).getCell(layout.solicitoNombre.col).value),
        autorizoNombre: celdaATexto(ws.getRow(layout.autorizoNombre.row).getCell(layout.autorizoNombre.col).value)
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

function aplicarExtrasAlLayout(layout, extra) {
    if (!extra) return layout;
    const shift = extra;
    return {
        ...layout,
        itemsEnd: layout.itemsEnd + shift,
        itemsSlots: layout.itemsSlots + shift,
        subtotalLabelRow: layout.subtotalLabelRow + shift,
        subtotal: { ...layout.subtotal, row: layout.subtotal.row + shift },
        descuentoPct: { ...layout.descuentoPct, row: layout.descuentoPct.row + shift },
        baseGravable: { ...layout.baseGravable, row: layout.baseGravable.row + shift },
        impuesto: { ...layout.impuesto, row: layout.impuesto.row + shift },
        total: { ...layout.total, row: layout.total.row + shift },
        observaciones: { ...layout.observaciones, row: layout.observaciones.row + shift },
        solicitoNombre: { ...layout.solicitoNombre, row: layout.solicitoNombre.row + shift },
        autorizoNombre: { ...layout.autorizoNombre, row: layout.autorizoNombre.row + shift }
    };
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

function cantidadSlotsPartidas(datos) {
    const d = aPayloadHoja(datos);
    return Math.min(MAX_PARTIDAS, Math.max(1, d.partidas.length));
}

/**
 * Inserta o elimina filas de partidas para que el Excel solo tenga
 * tantas filas de ítems como partidas capturadas (mínimo 1).
 * Convención F-24/F-16: insert usa fila 1-based (itemsEnd) antes de totales.
 * deleteDimension usa índice 0-based (= fila 1-based - 1).
 */
async function ajustarFilasPartidas(spreadsheetId, sheetTitle, datos, layout) {
    const necesarias = cantidadSlotsPartidas(datos);
    const delta = necesarias - layout.itemsSlots;
    if (!delta) {
        return { layout, cambioFilas: false };
    }

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        console.warn(`[SGC-F-27] No se encontró sheetId para «${sheetTitle}»; no se ajustaron filas.`);
        return { layout, cambioFilas: false };
    }

    try {
        if (delta > 0) {
            await driveService.insertarFilasGoogleSheet(
                spreadsheetId,
                sheetId,
                layout.itemsEnd,
                delta,
                { inheritFromBefore: true }
            );
            console.log(`[SGC-F-27] Insertadas ${delta} fila(s) de partida en «${sheetTitle}».`);
        } else {
            const aEliminar = -delta;
            const startIndex = layout.itemsStart + necesarias - 1;
            await driveService.eliminarFilasGoogleSheet(
                spreadsheetId,
                sheetId,
                startIndex,
                aEliminar
            );
            console.log(`[SGC-F-27] Eliminadas ${aEliminar} fila(s) vacía(s) en «${sheetTitle}» (idx ${startIndex}).`);
        }
    } catch (err) {
        console.error(`[SGC-F-27] Falló ajustar filas de partidas (${delta}):`, err.message);
        throw err;
    }
    return { layout: aplicarExtrasAlLayout(layout, delta), cambioFilas: true };
}

function datosAActualizacionesSheet(datos, sheetTitle, layout) {
    const d = aPayloadHoja(datos);
    const actualizaciones = [];

    pushUpdate(actualizaciones, layout.revision.row, layout.revision.col, `Rev. ${d.revision}`, sheetTitle);
    pushUpdate(
        actualizaciones,
        layout.fechaRevision.row,
        layout.fechaRevision.col,
        `Fecha de rev.: ${formatearFechaRevCorta(d.fechaRevision)}`,
        sheetTitle
    );
    pushUpdate(actualizaciones, layout.numeroOc.row, layout.numeroOc.col, d.folio || '', sheetTitle);
    pushUpdate(actualizaciones, layout.empresaNombre.row, layout.empresaNombre.col, d.empresaNombre || '', sheetTitle);
    pushUpdate(actualizaciones, layout.empresaDireccion.row, layout.empresaDireccion.col, d.empresaDireccion || '', sheetTitle);
    pushUpdate(actualizaciones, layout.empresaCiudad.row, layout.empresaCiudad.col, d.empresaCiudad || '', sheetTitle);
    pushUpdate(actualizaciones, layout.empresaCp.row, layout.empresaCp.col, d.empresaCp || '', sheetTitle);
    pushUpdate(actualizaciones, layout.empresaTelefono.row, layout.empresaTelefono.col, d.empresaTelefono || '', sheetTitle);
    pushUpdate(actualizaciones, layout.paraNombre.row, layout.paraNombre.col, d.paraNombre || '', sheetTitle);
    pushUpdate(actualizaciones, layout.paraCompania.row, layout.paraCompania.col, d.paraCompania || '', sheetTitle);
    pushUpdate(actualizaciones, layout.paraDireccion.row, layout.paraDireccion.col, d.paraDireccion || '', sheetTitle);
    pushUpdate(actualizaciones, layout.paraCiudad.row, layout.paraCiudad.col, d.paraCiudad || '', sheetTitle);
    pushUpdate(actualizaciones, layout.paraTelefono.row, layout.paraTelefono.col, d.paraTelefono || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviarNombre.row, layout.enviarNombre.col, d.enviarNombre || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviarCompania.row, layout.enviarCompania.col, d.enviarCompania || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviarDireccion.row, layout.enviarDireccion.col, d.enviarDireccion || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviarCiudad.row, layout.enviarCiudad.col, d.enviarCiudad || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviarTelefono.row, layout.enviarTelefono.col, d.enviarTelefono || '', sheetTitle);
    pushUpdate(actualizaciones, layout.fechaOc.row, layout.fechaOc.col, formatearFechaDisplay(d.fechaOc) || '', sheetTitle);
    pushUpdate(actualizaciones, layout.solicitante.row, layout.solicitante.col, d.solicitante || '', sheetTitle);
    pushUpdate(actualizaciones, layout.enviadoMediante.row, layout.enviadoMediante.col, d.enviadoMediante || '', sheetTitle);
    pushUpdate(actualizaciones, layout.fechaEntrega.row, layout.fechaEntrega.col, formatearFechaDisplay(d.fechaEntrega) || '', sheetTitle);
    pushUpdate(actualizaciones, layout.terminos.row, layout.terminos.col, d.terminos || '', sheetTitle);

    // Escribe solo partidas reales; limpia cualquier slot sobrante (por si el delete no corrió).
    for (let i = 0; i < layout.itemsSlots; i++) {
        const row = layout.itemsStart + i;
        const item = i < d.partidas.length ? d.partidas[i] : PARTIDA_DEFECTO;
        const vacia = i >= d.partidas.length || esPartidaVacia(item);
        pushUpdate(actualizaciones, row, 1, vacia ? '' : (i + 1), sheetTitle);
        pushUpdate(actualizaciones, row, 2, vacia ? '' : (item.descripcion || ''), sheetTitle);
        pushUpdate(actualizaciones, row, 6, vacia ? '' : item.cantidad, sheetTitle);
        pushUpdate(actualizaciones, row, 7, vacia ? '' : item.precioUnitario, sheetTitle);
        pushUpdate(actualizaciones, row, 8, vacia ? '' : importePartida(item), sheetTitle);
    }

    pushUpdate(actualizaciones, layout.subtotal.row, layout.subtotal.col, d.subtotal, sheetTitle);
    pushUpdate(actualizaciones, layout.descuentoPct.row, layout.descuentoPct.col, d.descuentoPct, sheetTitle);
    pushUpdate(actualizaciones, layout.baseGravable.row, layout.baseGravable.col, d.baseGravable, sheetTitle);
    pushUpdate(actualizaciones, layout.impuesto.row, layout.impuesto.col, d.impuesto, sheetTitle);
    pushUpdate(actualizaciones, layout.total.row, layout.total.col, d.total, sheetTitle);
    pushUpdate(actualizaciones, layout.observaciones.row, layout.observaciones.col, d.observaciones || '', sheetTitle);
    pushUpdate(actualizaciones, layout.solicitoNombre.row, layout.solicitoNombre.col, d.solicitoNombre || '', sheetTitle);
    pushUpdate(actualizaciones, layout.autorizoNombre.row, layout.autorizoNombre.col, d.autorizoNombre || '', sheetTitle);

    return actualizaciones;
}

function aplicarFuenteDatos(celda) {
    celda.font = {
        ...(celda.font || {}),
        name: FUENTE_DATOS.name,
        size: FUENTE_DATOS.size
    };
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.numFmt = '@';
    aplicarFuenteDatos(celda);
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function asignarNumero(celda, valor, horizontal = 'right') {
    const n = aNumero(valor);
    celda.value = n;
    celda.numFmt = '#,##0.00';
    aplicarFuenteDatos(celda);
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: false
    };
}

function ajustarFilasPartidasEnWorksheet(ws, layout, delta) {
    if (!delta) return layout;
    if (delta > 0) {
        const insertAt = layout.subtotalLabelRow;
        for (let i = 0; i < delta; i++) {
            ws.spliceRows(insertAt, 0, []);
        }
    } else {
        const necesarias = layout.itemsSlots + delta;
        ws.spliceRows(layout.itemsStart + necesarias, -delta);
    }
    return aplicarExtrasAlLayout(layout, delta);
}

function escribirDatosEnHoja(ws, datos) {
    const d = aPayloadHoja(datos);
    let layout = parsearLayoutDesdeHoja(ws);
    const necesarias = cantidadSlotsPartidas(datos);
    const delta = necesarias - layout.itemsSlots;
    if (delta) {
        layout = ajustarFilasPartidasEnWorksheet(ws, layout, delta);
    }

    asignarTextoSimple(ws.getRow(layout.revision.row).getCell(layout.revision.col), `Rev. ${d.revision}`);
    asignarTextoSimple(
        ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col),
        `Fecha de rev.: ${formatearFechaRevCorta(d.fechaRevision)}`
    );
    asignarTextoSimple(ws.getRow(layout.numeroOc.row).getCell(layout.numeroOc.col), d.folio || '', 'center');
    asignarTextoSimple(ws.getRow(layout.empresaNombre.row).getCell(layout.empresaNombre.col), d.empresaNombre || '');
    asignarTextoSimple(ws.getRow(layout.empresaDireccion.row).getCell(layout.empresaDireccion.col), d.empresaDireccion || '');
    asignarTextoSimple(ws.getRow(layout.empresaCiudad.row).getCell(layout.empresaCiudad.col), d.empresaCiudad || '');
    asignarTextoSimple(ws.getRow(layout.empresaCp.row).getCell(layout.empresaCp.col), d.empresaCp || '');
    asignarTextoSimple(ws.getRow(layout.empresaTelefono.row).getCell(layout.empresaTelefono.col), d.empresaTelefono || '');
    asignarTextoSimple(ws.getRow(layout.paraNombre.row).getCell(layout.paraNombre.col), d.paraNombre || '');
    asignarTextoSimple(ws.getRow(layout.paraCompania.row).getCell(layout.paraCompania.col), d.paraCompania || '');
    asignarTextoSimple(ws.getRow(layout.paraDireccion.row).getCell(layout.paraDireccion.col), d.paraDireccion || '');
    asignarTextoSimple(ws.getRow(layout.paraCiudad.row).getCell(layout.paraCiudad.col), d.paraCiudad || '');
    asignarTextoSimple(ws.getRow(layout.paraTelefono.row).getCell(layout.paraTelefono.col), d.paraTelefono || '');
    asignarTextoSimple(ws.getRow(layout.enviarNombre.row).getCell(layout.enviarNombre.col), d.enviarNombre || '');
    asignarTextoSimple(ws.getRow(layout.enviarCompania.row).getCell(layout.enviarCompania.col), d.enviarCompania || '');
    asignarTextoSimple(ws.getRow(layout.enviarDireccion.row).getCell(layout.enviarDireccion.col), d.enviarDireccion || '');
    asignarTextoSimple(ws.getRow(layout.enviarCiudad.row).getCell(layout.enviarCiudad.col), d.enviarCiudad || '');
    asignarTextoSimple(ws.getRow(layout.enviarTelefono.row).getCell(layout.enviarTelefono.col), d.enviarTelefono || '');
    asignarTextoSimple(ws.getRow(layout.fechaOc.row).getCell(layout.fechaOc.col), formatearFechaDisplay(d.fechaOc) || '', 'center');
    asignarTextoSimple(ws.getRow(layout.solicitante.row).getCell(layout.solicitante.col), d.solicitante || '');
    asignarTextoSimple(ws.getRow(layout.enviadoMediante.row).getCell(layout.enviadoMediante.col), d.enviadoMediante || '');
    asignarTextoSimple(ws.getRow(layout.fechaEntrega.row).getCell(layout.fechaEntrega.col), formatearFechaDisplay(d.fechaEntrega) || '', 'center');
    asignarTextoSimple(ws.getRow(layout.terminos.row).getCell(layout.terminos.col), d.terminos || '');

    for (let i = 0; i < layout.itemsSlots; i++) {
        const row = ws.getRow(layout.itemsStart + i);
        const item = i < d.partidas.length ? d.partidas[i] : PARTIDA_DEFECTO;
        const vacia = i >= d.partidas.length || esPartidaVacia(item);
        asignarTextoSimple(row.getCell(1), vacia ? '' : (i + 1), 'center');
        asignarTextoSimple(row.getCell(2), vacia ? '' : (item.descripcion || ''));
        if (vacia) {
            asignarTextoSimple(row.getCell(6), '', 'center');
            asignarTextoSimple(row.getCell(7), '', 'right');
            asignarTextoSimple(row.getCell(8), '', 'right');
        } else {
            asignarNumero(row.getCell(6), item.cantidad, 'center');
            asignarNumero(row.getCell(7), item.precioUnitario);
            asignarNumero(row.getCell(8), importePartida(item));
        }
    }

    asignarNumero(ws.getRow(layout.subtotal.row).getCell(layout.subtotal.col), d.subtotal);
    asignarNumero(ws.getRow(layout.descuentoPct.row).getCell(layout.descuentoPct.col), d.descuentoPct);
    asignarNumero(ws.getRow(layout.baseGravable.row).getCell(layout.baseGravable.col), d.baseGravable);
    asignarNumero(ws.getRow(layout.impuesto.row).getCell(layout.impuesto.col), d.impuesto);
    asignarNumero(ws.getRow(layout.total.row).getCell(layout.total.col), d.total);
    asignarTextoSimple(ws.getRow(layout.observaciones.row).getCell(layout.observaciones.col), d.observaciones || '');
    asignarTextoSimple(ws.getRow(layout.solicitoNombre.row).getCell(layout.solicitoNombre.col), d.solicitoNombre || '', 'center');
    asignarTextoSimple(ws.getRow(layout.autorizoNombre.row).getCell(layout.autorizoNombre.col), d.autorizoNombre || '', 'center');
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
        console.warn('[SGC-F-27] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-27 no contiene hojas.');
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

async function aplicarFormatoVisualSgcF27(spreadsheetId, sheetTitle, layout) {
    const tipografia = { fontFamily: FUENTE_DATOS.name, fontSize: FUENTE_DATOS.size };
    const rangos = [
        {
            startRow: layout.itemsStart,
            endRow: layout.itemsEnd,
            startColumn: 1,
            endColumn: 1,
            horizontalAlignment: 'CENTER',
            wrapStrategy: 'CLIP',
            ...tipografia
        },
        {
            startRow: layout.itemsStart,
            endRow: layout.itemsEnd,
            startColumn: 2,
            endColumn: 5,
            horizontalAlignment: 'LEFT',
            wrapStrategy: 'WRAP',
            ...tipografia
        },
        {
            startRow: layout.itemsStart,
            endRow: layout.itemsEnd,
            startColumn: 6,
            endColumn: 8,
            horizontalAlignment: 'CENTER',
            wrapStrategy: 'CLIP',
            ...tipografia
        },
        {
            startRow: layout.subtotal.row,
            endRow: layout.total.row,
            startColumn: 8,
            endColumn: 8,
            horizontalAlignment: 'RIGHT',
            wrapStrategy: 'CLIP',
            ...tipografia
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
                horizontalAlignment: rango.horizontalAlignment,
                verticalAlignment: 'MIDDLE',
                wrapStrategy: rango.wrapStrategy,
                fontFamily: rango.fontFamily,
                fontSize: rango.fontSize
            });
        } catch (err) {
            console.warn('[SGC-F-27] No se pudo aplicar formato visual:', err.message);
        }
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    let buffer = await descargarBufferDrive(spreadsheetId);
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    let ws = wb.getWorksheet(titulo) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-27 no contiene hojas.');

    const ajustado = await ajustarFilasPartidas(spreadsheetId, titulo, datos, parsearLayoutDesdeHoja(ws));
    let layout = ajustado.layout;

    if (ajustado.cambioFilas) {
        buffer = await descargarBufferDrive(spreadsheetId);
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        ws = wb.getWorksheet(titulo) || wb.worksheets[0];
        if (!ws) throw new Error('La plantilla SGC-F-27 no contiene hojas.');
        layout = parsearLayoutDesdeHoja(ws);
    }

    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF27(spreadsheetId, titulo, layout);
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
    if (!ws) throw new Error('La plantilla SGC-F-27 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        empresaNombre: d.empresaNombre,
        empresaDireccion: d.empresaDireccion,
        empresaCiudad: d.empresaCiudad,
        empresaCp: d.empresaCp,
        empresaTelefono: d.empresaTelefono,
        ordenes: d.ordenes.map((o) => ({
            id: o.id,
            folio: o.folio,
            fechaOc: o.fechaOc,
            solicitante: o.solicitante,
            enviadoMediante: o.enviadoMediante,
            fechaEntrega: o.fechaEntrega,
            terminos: o.terminos,
            paraNombre: o.paraNombre,
            paraCompania: o.paraCompania,
            paraDireccion: o.paraDireccion,
            paraCiudad: o.paraCiudad,
            paraTelefono: o.paraTelefono,
            enviarNombre: o.enviarNombre,
            enviarCompania: o.enviarCompania,
            enviarDireccion: o.enviarDireccion,
            enviarCiudad: o.enviarCiudad,
            enviarTelefono: o.enviarTelefono,
            partidas: o.partidas.filter((p) => !esPartidaVacia(p)),
            descuentoPct: o.descuentoPct,
            impuestoPct: o.impuestoPct,
            observaciones: o.observaciones,
            solicitoNombre: o.solicitoNombre,
            autorizoNombre: o.autorizoNombre,
            pdfFirmadoId: o.pdfFirmado?.driveFileId || null
        })),
        ordenActivaId: d.ordenActivaId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
}

/** Añadir partidas = información; no forzar historial de estructura. */
function estructuraEsEquivalente() {
    return true;
}

async function aplicarHistorialSgcF27(opciones) {
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
            console.warn('[SGC-F-27] No se pudo reescribir hoja tras historial:', err.message);
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
        console.warn('[SGC-F-27] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-27] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-27] Google Sheet restaurado: ${nuevoId}`);
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
        throw new Error('No hay archivo SGC-F-27 configurado en Drive.');
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
                console.warn('[SGC-F-27] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-27] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 8, keepSingleSheet: false }
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
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    if (driveId) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveId);
        } catch (err) {
            console.warn('[SGC-F-27] No se pudo asignar permiso de edición por enlace:', err.message);
        }
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
            console.warn('[SGC-F-27] No se pudo restaurar Google Sheet al cargar:', err.message);
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
            console.warn('[SGC-F-27] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (datosDb && Array.isArray(datosDb.ordenes) && datosDb.ordenes.length) {
        if (datosHoja && hojaTieneContenido(datosHoja)) {
            datos = fusionarHojaEnOrdenActiva(datosDb, datosHoja);
        } else {
            datos = datosDb;
        }
    } else if (datosHoja && hojaTieneContenido(datosHoja)) {
        datos = sanitizarDatos(datosHoja);
    } else {
        datos = sanitizarDatos(datosDb || DATOS_DEFECTO);
        if (datosHoja) {
            datos = sanitizarDatos({
                ...datos,
                revision: datosHoja.revision || datos.revision,
                fechaRevision: datosHoja.fechaRevision || datos.fechaRevision,
                empresaNombre: datosHoja.empresaNombre || datos.empresaNombre,
                empresaDireccion: datosHoja.empresaDireccion || datos.empresaDireccion,
                empresaCiudad: datosHoja.empresaCiudad || datos.empresaCiudad,
                empresaCp: datosHoja.empresaCp || datos.empresaCp,
                empresaTelefono: datosHoja.empresaTelefono || datos.empresaTelefono
            });
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
    return await construirRespuesta(registro, datos, archivoDrive);
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
    const ordenActivaId = body?.ordenActivaId || rawDatos?.ordenActivaId || null;
    const datosEntrada = sanitizarDatos({
        ...rawDatos,
        ordenActivaId: ordenActivaId || rawDatos?.ordenActivaId
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
        return await construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialSgcF27({
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
            return await construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-27] No se pudo actualizar Google Sheet:', err.message);
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
    return await construirRespuesta(registro, datosGuardar, archivoDrive);
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

    const datosFusionados = fusionarHojaEnOrdenActiva(
        datosPrevios || sanitizarDatos(DATOS_DEFECTO),
        datosDrive
    );

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosFusionados);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosFusionados, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF27({
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

    return await construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (registro?.drive_file_id && registro.drive_file_id !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-27] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos, TEMPLATE_DRIVE_ID);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, TEMPLATE_DRIVE_ID);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return await construirRespuesta(registroActualizado, datos, archivoDrive);
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const parts = iso.split('-');
    const mm = parts[1] || '01';
    const yy = (parts[0] || '').slice(2, 4) || '00';
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-27 ${tag} - ${mm}/${yy}.pdf`;
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
    const ordenId = String(body?.ordenId || body?.orden_id || body?.cambioId || '').trim();
    if (!ordenId) throw new Error('Se requiere ordenId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const ordenes = Array.isArray(datosPrevios.ordenes) ? [...datosPrevios.ordenes] : [];
    const idx = ordenes.findIndex((o) => o.id === ordenId);
    if (idx < 0) {
        throw new Error('No se encontró la orden indicada en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, ordenes[idx].folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(ordenes[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    ordenes[idx] = { ...ordenes[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        ordenes,
        ordenActivaId: ordenId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    const respuesta = await construirRespuesta(registro, datosGuardar, archivoDrive);
    return { ...respuesta, pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet SGC-F-27 configurado para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-27] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, { gid });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-27 quedó vacía.');
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
    crearOrdenVacia,
    nuevoIdOrden,
    resolverOrdenActiva,
    calcularTotales
};
