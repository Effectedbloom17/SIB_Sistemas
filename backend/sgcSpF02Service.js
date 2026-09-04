/**
 * SP-F-02 · Reporte de visita y recorrido — persistencia en biznaga_sgc y sync con Drive.
 * Arquetipo: SGC-F-28 (una hoja por reporte) + SGC-F-16 (cabecera + filas dinámicas).
 *
 * Plantilla (hoja «Plantilla»): cabecera r5–r8 · ítems desde r10 · resumen al pie.
 * Tipografía Excel: Century Gothic 10, vertical medio, ajuste de texto.
 * Columnas ítems: B=# · C:D problema · E:F acciones · G resp · H fecha · I estatus · J obs.
 */
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SP-F-02';
const TEMPLATE_DRIVE_ID = '1lZOjlr7PAvoudcOJF5Qz28x3ok88UUEb32L1YnxUAZI';
const DRIVE_FILE_ID_SISTEMA = '1lZOjlr7PAvoudcOJF5Qz28x3ok88UUEb32L1YnxUAZI';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SP-F-02 Reporte de visita y recorrido (sistema)';
const SHEET_TITLE = 'Plantilla';

const MAX_ITEMS = 40;
const MAX_IMAGENES_CAMPO = 3;
const MIN_ITEM_SLOTS = 2;
const CARPETA_IMAGENES_SP_F02_RAIZ_ID = '1SHrratEhQXEsRgq81ufTOpwSTXxnBmC-';
/** Carpeta legacy (imágenes subidas antes del cambio de ruta). */
const CARPETA_IMAGENES_SP_F02_LEGACY_ID = '1Ti3fVyN3YQm301RUgq5gxLNsVv6nm5sx';
const ESTATUS_VALIDOS = ['Abierto', 'Cerrado'];
const MODALIDADES = ['Presencial', 'Virtual', 'Híbrida'];
const FILA_ITEM_ALTO_PX = 50;

const LAYOUT_BASE = {
    empresa: { row: 5, col: 3 },
    fecha: { row: 5, col: 8 },
    proposito: { row: 6, col: 3 },
    hora: { row: 6, col: 8 },
    asistentes: { row: 7, col: 3 },
    modalidad: { row: 7, col: 8 },
    consultores: { row: 8, col: 3 },
    proxVisita: { row: 8, col: 8 },
    itemsStart: 11,
    itemsEnd: 12,
    // Fila 13 = separación vacía entre tabla y resumen
    resumenTotal: { row: 14, col: 4 },
    resumenAbiertos: { row: 15, col: 4 },
    resumenCerrados: { row: 16, col: 4 },
    resumenAvance: { row: 17, col: 4 },
    resumenRevision: { row: 18, col: 4 }
};

const ITEM_DEFECTO = {
    problema: '',
    problemaImagenes: [],
    acciones: '',
    responsable: '',
    fechaCompromiso: '',
    estatus: 'Abierto',
    observaciones: '',
    observacionesImagenes: []
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2021-08-05',
    revision: '00',
    fechaRevision: '2021-08-05',
    reportes: [],
    reporteActivoId: null
};

function clonarLayout() {
    return JSON.parse(JSON.stringify(LAYOUT_BASE));
}

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `sp02-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function normalizarSaltos(texto) {
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
            return normalizarSaltos(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltos(String(valor.text));
    }
    return normalizarSaltos(String(valor));
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
    return needles.some((n) => t === n || t.startsWith(`${n} `) || t.includes(n));
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
        const iso = String(fecha).match(/(\d{4})-(\d{2})-(\d{2})/);
        return iso ? iso[0] : String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso().slice(0, 10);
}

function formatearFechaExcel(iso) {
    const f = formatearFechaIso(iso);
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return iso || '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

function normalizarHora(valor) {
    const t = String(valor || '').trim();
    if (!t) return '';
    let m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
        const h = Math.min(23, Math.max(0, Number(m[1])));
        const min = Math.min(59, Math.max(0, Number(m[2])));
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    m = t.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)$/i);
    if (m) {
        let h = Number(m[1]);
        const min = Number(m[2]);
        const esPm = /^p/i.test(m[3].replace(/\s/g, ''));
        if (esPm && h < 12) h += 12;
        if (!esPm && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return '';
}

/** 02:09 → "2:09 am" */
function formatearHoraAmPm(hhmm) {
    const n = normalizarHora(hhmm);
    if (!n) return String(hhmm || '').trim();
    const [hs, ms] = n.split(':').map(Number);
    const sufijo = hs >= 12 ? 'pm' : 'am';
    let h12 = hs % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(ms).padStart(2, '0')} ${sufijo}`;
}

function extraerRevision(texto) {
    const m = String(texto || '').match(/(\d{2})/);
    return m ? m[1] : '00';
}

function normalizarEstatus(valor) {
    const t = etiquetaNormalizada(valor);
    if (/cerrad|cumpl|hecho|ok|conclu/.test(t)) return 'Cerrado';
    if (/abiert|pendient|open|proceso|seguimiento|curso/.test(t)) return 'Abierto';
    const hit = ESTATUS_VALIDOS.find((op) => op.toLowerCase() === String(valor || '').trim().toLowerCase());
    return hit || 'Abierto';
}

function normalizarModalidad(valor) {
    const t = etiquetaNormalizada(valor);
    if (/virtual|remoto|linea|zoom|meet/.test(t)) return 'Virtual';
    if (/hibrid/.test(t)) return 'Híbrida';
    if (/presenc|sitio|campo|planta/.test(t)) return 'Presencial';
    const hit = MODALIDADES.find((op) => etiquetaNormalizada(op) === t);
    return hit || String(valor || '').trim();
}

function sanitizarImagenCampo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    const thumbDataUrl = String(raw.thumbDataUrl || raw.thumb_data_url || '').trim() || null;
    const previewUrl = String(raw.previewUrl || raw.preview_url || '').trim()
        || `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w400`;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'imagen.jpg').trim(),
        mimeType: String(raw.mimeType || raw.mime_type || 'image/jpeg').trim(),
        previewUrl,
        thumbDataUrl
    };
}

async function normalizarBufferImagenSpF02(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new Error('Buffer de imagen inválido');
    }
    const imagen = sharp(buffer).rotate();
    const normalizado = await imagen
        .clone()
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    const thumb = await sharp(normalizado)
        .resize(160, 120, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
    return {
        buffer: normalizado,
        mimeType: 'image/jpeg',
        thumbDataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}`
    };
}

async function esImagenSpF02Conocida(driveFileId) {
    const id = String(driveFileId || '').trim();
    if (!id) return false;
    const raices = [CARPETA_IMAGENES_SP_F02_RAIZ_ID, CARPETA_IMAGENES_SP_F02_LEGACY_ID];
    for (const raiz of raices) {
        try {
            if (await driveService.perteneceACarpetaAncestral(id, raiz, 10)) {
                return true;
            }
        } catch (_e) {
            // silenced
        }
    }
    return false;
}

function preservarImagenesItemsSpF02(itemsParsed, itemsPrevios) {
    const parsed = Array.isArray(itemsParsed) ? itemsParsed : [];
    const prev = Array.isArray(itemsPrevios) ? itemsPrevios : [];
    return parsed.map((item, idx) => {
        const p = prev[idx];
        if (!p) return item;
        return {
            ...item,
            problemaImagenes: (item.problemaImagenes || []).length
                ? item.problemaImagenes
                : (p.problemaImagenes || []),
            observacionesImagenes: (item.observacionesImagenes || []).length
                ? item.observacionesImagenes
                : (p.observacionesImagenes || [])
        };
    });
}

/** Al guardar desde formulario: las imágenes del formulario mandan (vacío = borrado). */
function aplicarImagenesDesdeFormularioSpF02(reporteDestino, reporteFormulario) {
    if (!reporteFormulario) return reporteDestino;
    const itemsForm = reporteFormulario.items || [];
    const itemsDest = reporteDestino.items || [];
    return {
        ...reporteDestino,
        items: itemsDest.map((item, idx) => ({
            ...item,
            problemaImagenes: itemsForm[idx]?.problemaImagenes ?? [],
            observacionesImagenes: itemsForm[idx]?.observacionesImagenes ?? []
        }))
    };
}

function fusionarImagenesReporteSpF02(reporteParsed, reportePrevio) {
    if (!reportePrevio) return reporteParsed;
    return {
        ...reporteParsed,
        items: preservarImagenesItemsSpF02(reporteParsed.items, reportePrevio.items)
    };
}

function normalizarImagenesLista(raw, pluralKey, singularKey) {
    const out = [];
    const arr = Array.isArray(raw?.[pluralKey]) ? raw[pluralKey] : [];
    for (const img of arr) {
        const limpia = sanitizarImagenCampo(img);
        if (limpia && !out.some((x) => x.driveFileId === limpia.driveFileId)) {
            out.push(limpia);
        }
    }
    const legacy = sanitizarImagenCampo(raw?.[singularKey]);
    if (legacy && !out.some((x) => x.driveFileId === legacy.driveFileId)) {
        out.unshift(legacy);
    }
    return out.slice(0, MAX_IMAGENES_CAMPO);
}

function sanitizarItem(item) {
    const problemaImagenes = normalizarImagenesLista(item, 'problemaImagenes', 'problemaImagen');
    const observacionesImagenes = normalizarImagenesLista(item, 'observacionesImagenes', 'observacionesImagen');
    return {
        problema: normalizarSaltos(item?.problema || item?.asunto || ''),
        problemaImagenes,
        problemaImagen: problemaImagenes[0] || null,
        acciones: normalizarSaltos(item?.acciones || item?.accion || ''),
        responsable: normalizarSaltos(item?.responsable || ''),
        fechaCompromiso: formatearFechaIso(item?.fechaCompromiso || item?.fecha || ''),
        estatus: normalizarEstatus(item?.estatus),
        observaciones: normalizarSaltos(item?.observaciones || ''),
        observacionesImagenes,
        observacionesImagen: observacionesImagenes[0] || null
    };
}

function esItemVacio(item) {
    const i = sanitizarItem(item);
    return !i.problema && !i.problemaImagenes.length && !i.acciones && !i.responsable && !i.fechaCompromiso
        && !i.observaciones && !i.observacionesImagenes.length
        && (!i.estatus || i.estatus === 'Abierto');
}

function alturaFilaItemSpF02(item) {
    const maxImg = Math.max(
        (item?.problemaImagenes || []).length,
        (item?.observacionesImagenes || []).length
    );
    if (maxImg <= 0) return FILA_ITEM_ALTO_PX;
    if (maxImg === 1) return 130;
    if (maxImg === 2) return 145;
    return 200;
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) out.push(factory());
    return out;
}

function resumenItems(items) {
    const reales = (items || []).filter((i) => !esItemVacio(i));
    const total = reales.length;
    const cerrados = reales.filter((i) => i.estatus === 'Cerrado').length;
    const abiertos = total - cerrados;
    const avance = total ? Math.round((cerrados / total) * 100) : 0;
    return { total, abiertos, cerrados, avance };
}

function sanitizarReporte(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const items = (Array.isArray(base.items) ? base.items : [])
        .map(sanitizarItem)
        .filter((i) => !esItemVacio(i))
        .slice(0, MAX_ITEMS);
    const fecha = formatearFechaIso(base.fecha || base.fechaVisita);
    return {
        id: String(base.id || '').trim() || nuevoId(),
        folio: folioDesdeFecha(fecha),
        nombreEmpresa: String(base.nombreEmpresa || base.empresa || '').trim(),
        fecha,
        proposito: normalizarSaltos(base.proposito || base.asunto || ''),
        hora: normalizarHora(base.hora) || String(base.hora || '').trim(),
        asistentes: normalizarSaltos(base.asistentes || ''),
        modalidad: normalizarModalidad(base.modalidad),
        consultores: normalizarSaltos(base.consultores || ''),
        proxVisita: formatearFechaIso(base.proxVisita || base.proximaVisita),
        ultimaRevision: formatearFechaIso(base.ultimaRevision) || fechaHoyIso(),
        items: conFilasMinimas(items, 1, () => ({ ...ITEM_DEFECTO })),
        nombreHoja: String(base.nombreHoja || '').trim(),
        ...(base.origenPc ? { origenPc: true } : {}),
        ...(base.documentoPipcId != null && Number.isFinite(Number(base.documentoPipcId))
            ? { documentoPipcId: Number(base.documentoPipcId) } : {}),
        ...(base.empresaIdPc != null && Number.isFinite(Number(base.empresaIdPc))
            ? { empresaIdPc: Number(base.empresaIdPc) } : {}),
        ...(base.operacionIdPc != null && Number.isFinite(Number(base.operacionIdPc))
            ? { operacionIdPc: Number(base.operacionIdPc) } : {})
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let reportesRaw = [];
    if (Array.isArray(base.reportes)) {
        reportesRaw = base.reportes;
    } else if (base.nombreEmpresa || base.fecha || base.proposito || base.items) {
        reportesRaw = [base];
    }
    const reportes = reportesRaw.map(sanitizarReporte);
    const reporteActivoId = base.reporteActivoId
        ? String(base.reporteActivoId)
        : (reportes[0]?.id || null);
    const activo = reportes.find((r) => r.id === reporteActivoId) || reportes[0] || null;
    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        empresa: String(activo?.nombreEmpresa || base.empresa || '').trim(),
        reportes,
        reporteActivoId: reporteActivoId && reportes.some((r) => r.id === reporteActivoId)
            ? reporteActivoId
            : (reportes[0]?.id || null)
    };
}

function resolverReporteActivo(datos) {
    const lista = Array.isArray(datos?.reportes) ? datos.reportes : [];
    if (!lista.length) return sanitizarReporte({});
    const id = datos?.reporteActivoId;
    if (id) {
        const found = lista.find((r) => r.id === id);
        if (found) return found;
    }
    return lista[0];
}

function reporteTieneContenido(r) {
    if (!r) return false;
    return !!(r.nombreEmpresa || r.fecha || r.proposito || r.asistentes || r.consultores
        || r.folio || (Array.isArray(r.items) && r.items.some((i) => !esItemVacio(i))));
}

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

/** SP-F-02 → SPF02-0826 (mismo criterio que SGC-F-16 / historial MMAA). */
function folioDesdeFecha(fechaIso) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    return excelHistorial.nombreHojaHistorialInformacion(CODIGO_FORMATO, iso);
}

function resolverNombreHojaReporte(reporte) {
    return folioDesdeFecha(reporte?.fecha);
}

function esHojaReporteSpF02(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    if (/^plantilla$/i.test(t)) return false;
    if (excelHistorial.esHojaHistorialInformacion(t, CODIGO_FORMATO)) return true;
    // Hojas legacy (empresa + fecha, RV-, Visita-, etc.)
    return true;
}

function buscarFilaEtiqueta(ws, needles, maxRow = 40) {
    const maxCol = Math.min(Number(ws.columnCount) || 10, 10);
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

function valorDerecha(ws, row, col) {
    const maxCol = Math.min(Number(ws.columnCount) || 10, 10);
    const etiquetasCampo = [
        'nombre de la empresa', 'fecha', 'proposito', 'hora', 'asistentes',
        'modalidad', 'consultores', 'prox', 'proxima visita'
    ];
    let primerVacio = null;
    for (let c = col + 1; c <= maxCol; c++) {
        const texto = celdaATexto(ws.getRow(row).getCell(c).value);
        if (etiquetaEs(texto, ...etiquetasCampo)) continue;
        if (texto) return { row, col: c, texto };
        if (!primerVacio) primerVacio = c;
    }
    return { row, col: primerVacio || Math.min(col + 1, maxCol), texto: '' };
}

function parsearLayoutDesdeHoja(ws) {
    const layout = clonarLayout();
    const setCampo = (needles, key) => {
        const hit = buscarFilaEtiqueta(ws, needles);
        if (hit) {
            const v = valorDerecha(ws, hit.row, hit.col);
            layout[key] = { row: v.row, col: v.col };
        }
    };
    setCampo(['nombre de la empresa'], 'empresa');
    setCampo(['proposito de la visita', 'proposito'], 'proposito');
    setCampo(['asistentes'], 'asistentes');
    setCampo(['consultores'], 'consultores');

    for (let r = 5; r <= 8; r++) {
        const row = ws.getRow(r);
        for (let c = 5; c <= 10; c++) {
            const t = etiquetaNormalizada(row.getCell(c).value);
            if (t === 'fecha' || t === 'fecha de visita') {
                const v = valorDerecha(ws, r, c);
                layout.fecha = { row: v.row, col: v.col };
            }
        }
    }
    setCampo(['hora'], 'hora');
    setCampo(['modalidad'], 'modalidad');
    setCampo(['prox visita', 'proxima visita', 'prox'], 'proxVisita');

    const headerItems = buscarFilaEtiqueta(ws, ['problema / asunto', 'problema']);
    if (headerItems) layout.itemsStart = headerItems.row + 1;

    const total = buscarFilaEtiqueta(ws, ['total de items']);
    const abiertos = buscarFilaEtiqueta(ws, ['abiertos']);
    const cerrados = buscarFilaEtiqueta(ws, ['cerrados']);
    const avance = buscarFilaEtiqueta(ws, ['% de avance', 'avance']);
    const revision = buscarFilaEtiqueta(ws, ['ultima fecha de revision', 'ultima fecha']);
    const primeraResumen = [total, abiertos, cerrados, avance, revision]
        .filter(Boolean)
        .map((h) => h.row)
        .sort((a, b) => a - b)[0];
    if (primeraResumen) {
        let end = primeraResumen - 1;
        // Si hay fila vacía de separación antes del resumen, no cuenta como ítem
        if (end >= layout.itemsStart) {
            const rowSep = ws.getRow(end);
            const tieneDato = [2, 3, 5, 7, 8, 9, 10].some((c) => celdaATexto(rowSep.getCell(c).value));
            if (!tieneDato && end > layout.itemsStart) {
                end -= 1;
            }
        }
        layout.itemsEnd = Math.max(layout.itemsStart, end);
    }

    const setResumen = (hit, key) => {
        if (!hit) return;
        const v = valorDerecha(ws, hit.row, hit.col);
        layout[key] = { row: v.row, col: v.col };
    };
    setResumen(total, 'resumenTotal');
    setResumen(abiertos, 'resumenAbiertos');
    setResumen(cerrados, 'resumenCerrados');
    setResumen(avance, 'resumenAvance');
    setResumen(revision, 'resumenRevision');
    return layout;
}

function parsearDatosDesdeHoja(ws) {
    const layout = parsearLayoutDesdeHoja(ws);
    const leer = (pos) => celdaATexto(ws.getRow(pos.row).getCell(pos.col).value);
    const items = [];
    for (let r = layout.itemsStart; r <= layout.itemsEnd; r++) {
        const row = ws.getRow(r);
        const item = sanitizarItem({
            // B = # · C:D = problema · E:F = acciones · G resp · H fecha · I estatus · J obs
            problema: celdaATexto(row.getCell(3).value),
            acciones: celdaATexto(row.getCell(5).value),
            responsable: celdaATexto(row.getCell(7).value),
            fechaCompromiso: celdaATexto(row.getCell(8).value),
            estatus: celdaATexto(row.getCell(9).value),
            observaciones: celdaATexto(row.getCell(10).value)
        });
        if (!esItemVacio(item)) items.push(item);
    }
    return sanitizarReporte({
        nombreEmpresa: leer(layout.empresa),
        fecha: leer(layout.fecha),
        proposito: leer(layout.proposito),
        hora: normalizarHora(leer(layout.hora)) || leer(layout.hora),
        asistentes: leer(layout.asistentes),
        modalidad: leer(layout.modalidad),
        consultores: leer(layout.consultores),
        proxVisita: leer(layout.proxVisita),
        ultimaRevision: leer(layout.resumenRevision),
        items
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
    return `'${String(sheetTitle).replace(/'/g, "''")}'!${celda}`;
}

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(col)}${row}`, sheetTitle),
        values: [[valor ?? '']]
    });
}

function datosAActualizacionesSheet(reporte, sheetTitle, layout) {
    const r = sanitizarReporte(reporte);
    const actualizaciones = [];
    pushUpdate(actualizaciones, layout.empresa.row, layout.empresa.col, r.nombreEmpresa, sheetTitle);
    pushUpdate(actualizaciones, layout.fecha.row, layout.fecha.col, formatearFechaExcel(r.fecha), sheetTitle);
    pushUpdate(actualizaciones, layout.proposito.row, layout.proposito.col, r.proposito, sheetTitle);
    pushUpdate(actualizaciones, layout.hora.row, layout.hora.col, formatearHoraAmPm(r.hora), sheetTitle);
    pushUpdate(actualizaciones, layout.asistentes.row, layout.asistentes.col, r.asistentes, sheetTitle);
    pushUpdate(actualizaciones, layout.modalidad.row, layout.modalidad.col, r.modalidad, sheetTitle);
    pushUpdate(actualizaciones, layout.consultores.row, layout.consultores.col, r.consultores, sheetTitle);
    pushUpdate(actualizaciones, layout.proxVisita.row, layout.proxVisita.col, formatearFechaExcel(r.proxVisita), sheetTitle);

    // Encabezado de tabla: B = "#" · C:D problema · E:F acciones
    const headerRow = layout.itemsStart - 1;
    if (headerRow >= 1) {
        pushUpdate(actualizaciones, headerRow, 1, '', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 2, '#', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 3, 'Problema / Asunto / Condición insegura / Requisito', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 5, 'Acciones preventivas, correctivas o actividades a realizar', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 7, 'Responsable(s)', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 8, 'Fecha compromiso', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 9, 'Estatus', sheetTitle);
        pushUpdate(actualizaciones, headerRow, 10, 'Observaciones', sheetTitle);
    }

    const slots = Math.max(MIN_ITEM_SLOTS, layout.itemsEnd - layout.itemsStart + 1);
    const items = r.items.filter((i) => !esItemVacio(i));
    for (let i = 0; i < slots; i++) {
        const row = layout.itemsStart + i;
        const item = items[i];
        const tiene = !!item;
        // A vacía · B = # · C = problema (C:D merge) · E = acciones · G resp · H fecha · I estatus · J obs
        pushUpdate(actualizaciones, row, 1, '', sheetTitle);
        pushUpdate(actualizaciones, row, 2, tiene ? String(i + 1) : '', sheetTitle);
        pushUpdate(actualizaciones, row, 3, item?.problema || '', sheetTitle);
        pushUpdate(actualizaciones, row, 5, item?.acciones || '', sheetTitle);
        pushUpdate(actualizaciones, row, 7, item?.responsable || '', sheetTitle);
        pushUpdate(actualizaciones, row, 8, item ? formatearFechaExcel(item.fechaCompromiso) : '', sheetTitle);
        pushUpdate(actualizaciones, row, 9, tiene ? (item.estatus || '') : '', sheetTitle);
        pushUpdate(actualizaciones, row, 10, item?.observaciones || '', sheetTitle);
    }

    // Fila vacía de separación entre tabla y resumen
    const filaSep = layout.itemsEnd + 1;
    if (layout.resumenTotal && layout.resumenTotal.row > filaSep) {
        for (let c = 1; c <= 10; c++) {
            pushUpdate(actualizaciones, filaSep, c, '', sheetTitle);
        }
    }

    const sum = resumenItems(items);
    const ultima = r.ultimaRevision || fechaHoyIso();
    pushUpdate(actualizaciones, layout.resumenTotal.row, layout.resumenTotal.col, String(sum.total), sheetTitle);
    pushUpdate(actualizaciones, layout.resumenAbiertos.row, layout.resumenAbiertos.col, String(sum.abiertos), sheetTitle);
    pushUpdate(actualizaciones, layout.resumenCerrados.row, layout.resumenCerrados.col, String(sum.cerrados), sheetTitle);
    pushUpdate(actualizaciones, layout.resumenAvance.row, layout.resumenAvance.col, `${sum.avance}%`, sheetTitle);
    pushUpdate(actualizaciones, layout.resumenRevision.row, layout.resumenRevision.col, formatearFechaExcel(ultima), sheetTitle);
    return actualizaciones;
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        reportes: d.reportes.map((r) => ({
            id: r.id,
            folio: r.folio,
            nombreEmpresa: r.nombreEmpresa,
            fecha: r.fecha,
            proposito: r.proposito,
            hora: r.hora,
            asistentes: r.asistentes,
            modalidad: r.modalidad,
            consultores: r.consultores,
            proxVisita: r.proxVisita,
            items: r.items.filter((i) => !esItemVacio(i)).map((i) => ({
                ...i,
                problemaImagenes: (i.problemaImagenes || []).map((img) => ({
                    driveFileId: img.driveFileId,
                    nombreArchivo: img.nombreArchivo
                })),
                observacionesImagenes: (i.observacionesImagenes || []).map((img) => ({
                    driveFileId: img.driveFileId,
                    nombreArchivo: img.nombreArchivo
                }))
            }))
        })),
        reporteActivoId: d.reporteActivoId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
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

async function obtenerWorksheet(buffer, sheetTitle) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (sheetTitle) {
        const hit = wb.getWorksheet(sheetTitle) || wb.worksheets.find(
            (w) => String(w.name || '').trim() === String(sheetTitle).trim()
        );
        if (hit) return hit;
    }
    return wb.getWorksheet(SHEET_TITLE) || wb.worksheets[0] || null;
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

async function resolverTituloPlantilla(spreadsheetId) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    return driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /plantilla/i })
        || SHEET_TITLE
        || (titulos || [])[0]
        || SHEET_TITLE;
}

async function asegurarFilasItems(spreadsheetId, sheetTitle, reporte, layout) {
    const items = (reporte.items || []).filter((i) => !esItemVacio(i));
    const needed = Math.max(MIN_ITEM_SLOTS, items.length);
    const actuales = Math.max(1, layout.itemsEnd - layout.itemsStart + 1);
    const extra = Math.max(0, needed - actuales);
    if (!extra) return { layout, insertoFilas: false };

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return { layout, insertoFilas: false };

    await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.itemsEnd, extra, {
        inheritFromBefore: true
    });
    const shift = extra;
    return {
        insertoFilas: true,
        layout: {
            ...layout,
            itemsEnd: layout.itemsEnd + shift,
            resumenTotal: { ...layout.resumenTotal, row: layout.resumenTotal.row + shift },
            resumenAbiertos: { ...layout.resumenAbiertos, row: layout.resumenAbiertos.row + shift },
            resumenCerrados: { ...layout.resumenCerrados, row: layout.resumenCerrados.row + shift },
            resumenAvance: { ...layout.resumenAvance, row: layout.resumenAvance.row + shift },
            resumenRevision: { ...layout.resumenRevision, row: layout.resumenRevision.row + shift }
        }
    };
}

/** Garantiza una fila vacía entre la tabla de ítems y el bloque de resumen. */
async function asegurarSeparacionResumen(spreadsheetId, sheetTitle, layout) {
    const gap = Number(layout.resumenTotal?.row) - Number(layout.itemsEnd);
    if (!Number.isFinite(gap) || gap >= 2) {
        return { layout, insertoFilas: false };
    }
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return { layout, insertoFilas: false };

    await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.itemsEnd, 1, {
        inheritFromBefore: false
    });
    const shift = 1;
    return {
        insertoFilas: true,
        layout: {
            ...layout,
            resumenTotal: { ...layout.resumenTotal, row: layout.resumenTotal.row + shift },
            resumenAbiertos: { ...layout.resumenAbiertos, row: layout.resumenAbiertos.row + shift },
            resumenCerrados: { ...layout.resumenCerrados, row: layout.resumenCerrados.row + shift },
            resumenAvance: { ...layout.resumenAvance, row: layout.resumenAvance.row + shift },
            resumenRevision: { ...layout.resumenRevision, row: layout.resumenRevision.row + shift }
        }
    };
}

async function escribirReporteEnHoja(spreadsheetId, sheetTitle, reporte) {
    let buffer = await descargarBufferDrive(spreadsheetId);
    let ws = await obtenerWorksheet(buffer, sheetTitle);
    if (!ws) throw new Error(`No se encontró la hoja «${sheetTitle}» en SP-F-02.`);
    let layout = parsearLayoutDesdeHoja(ws);

    const asegurado = await asegurarFilasItems(spreadsheetId, sheetTitle, reporte, layout);
    layout = asegurado.layout;
    if (asegurado.insertoFilas) {
        buffer = await descargarBufferDrive(spreadsheetId);
        ws = await obtenerWorksheet(buffer, sheetTitle);
        if (ws) layout = parsearLayoutDesdeHoja(ws);
    }

    const sep = await asegurarSeparacionResumen(spreadsheetId, sheetTitle, layout);
    layout = sep.layout;
    if (sep.insertoFilas) {
        buffer = await descargarBufferDrive(spreadsheetId);
        ws = await obtenerWorksheet(buffer, sheetTitle);
        if (ws) layout = parsearLayoutDesdeHoja(ws);
    }

    const actualizaciones = datosAActualizacionesSheet(reporte, sheetTitle, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    try {
        const limpio = sanitizarReporte(reporte);
        const items = limpio.items.filter((i) => !esItemVacio(i));
        await driveService.aplicarFormatoVisualSpF02(spreadsheetId, sheetTitle, layout, { items });
    } catch (err) {
        console.warn('[SP-F-02] No se pudo aplicar formato visual:', err.message);
    }
    try {
        const limpio = sanitizarReporte(reporte);
        const items = limpio.items.filter((i) => !esItemVacio(i));
        let driveIdFinal = spreadsheetId;
        try {
            const driveIdImgs = await sincronizarImagenesItemsSpF02(spreadsheetId, sheetTitle, layout, items);
            if (driveIdImgs) {
                driveIdFinal = driveIdImgs;
            }
        } catch (err) {
            console.warn('[SP-F-02] No se pudieron sincronizar imágenes:', err.message);
        }
        try {
            await driveService.aplicarFormatoPostImagenesSpF02(driveIdFinal, sheetTitle, layout, { items });
        } catch (err) {
            console.warn('[SP-F-02] No se pudo aplicar formato post-imágenes:', err.message);
        }
        return driveIdFinal;
    } catch (err) {
        console.warn('[SP-F-02] Error en bloque de imágenes:', err.message);
    }
    return spreadsheetId;
}

function extensionImagenSpF02(buf, nombre = '') {
    if (!Buffer.isBuffer(buf) || !buf.length) return 'jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
    const ext = String(nombre).split('.').pop()?.toLowerCase() || '';
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    return 'jpeg';
}

async function prepararBuffersImagenSpF02(imagenes) {
    const out = [];
    for (const img of (imagenes || []).slice(0, MAX_IMAGENES_CAMPO)) {
        const id = String(img?.driveFileId || '').trim();
        if (!id) continue;
        try {
            const buffer = await driveService.descargarArchivo(id);
            const buf = Buffer.from(buffer);
            const normalizado = await sharp(buf)
                .rotate()
                .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 88, mozjpeg: true })
                .toBuffer();
            out.push({
                buffer: normalizado,
                extension: 'jpeg',
                driveFileId: id
            });
        } catch (err) {
            console.warn(`[SP-F-02] No se pudo descargar imagen ${id}:`, err.message);
        }
    }
    return out;
}

async function sincronizarImagenesItemsSpF02(spreadsheetId, sheetTitle, layout, items) {
    const itemsStart = Number(layout.itemsStart) || 11;
    const itemsEnd = Number(layout.itemsEnd) || itemsStart;
    const slots = Math.max(MIN_ITEM_SLOTS, itemsEnd - itemsStart + 1);

    const areasMulti = [];
    const actualizacionesCeldas = [];

    for (let i = 0; i < slots; i++) {
        const row = itemsStart + i;
        const item = items[i];

        pushUpdate(actualizacionesCeldas, row, 1, '', sheetTitle);
        pushUpdate(actualizacionesCeldas, row, 3, '', sheetTitle);
        pushUpdate(actualizacionesCeldas, row, 10, '', sheetTitle);

        if (!item) continue;

        const probImgs = (item.problemaImagenes || []).filter((img) => img?.driveFileId);
        const textoProb = String(item.problema || '').trim();
        if (probImgs.length === 1 && !textoProb) {
            pushUpdate(
                actualizacionesCeldas,
                row,
                3,
                driveService.formulaImagenSpF02(urlPublicaImagenSpF02(probImgs[0].driveFileId)),
                sheetTitle
            );
        } else if (probImgs.length >= 1) {
            areasMulti.push({
                row,
                campo: 'problema',
                texto: item.problema || '',
                imagenes: await prepararBuffersImagenSpF02(probImgs)
            });
        }

        const obsImgs = (item.observacionesImagenes || []).filter((img) => img?.driveFileId);
        const textoObs = String(item.observaciones || '').trim();
        if (obsImgs.length === 1 && !textoObs) {
            pushUpdate(
                actualizacionesCeldas,
                row,
                10,
                driveService.formulaImagenSpF02(urlPublicaImagenSpF02(obsImgs[0].driveFileId)),
                sheetTitle
            );
        } else if (obsImgs.length >= 1) {
            areasMulti.push({
                row,
                campo: 'observaciones',
                texto: item.observaciones || '',
                imagenes: await prepararBuffersImagenSpF02(obsImgs)
            });
        }
    }

    const xlsxExport = await driveService.exportarGoogleSheetComoXLSX(spreadsheetId);
    const xlsxConImgs = await driveService.embeberImagenesSpF02EnXlsx(xlsxExport, sheetTitle, areasMulti, {
        itemsStart,
        itemsEnd
    });
    let driveId = await driveService.reemplazarGoogleSheetConXlsx(
        spreadsheetId,
        xlsxConImgs,
        NOMBRE_ARCHIVO_DRIVE
    );
    if (!driveId) driveId = spreadsheetId;

    const formulasImage = actualizacionesCeldas.filter(
        (u) => Array.isArray(u.values?.[0]) && String(u.values[0][0] || '').startsWith('=IMAGE(')
    );
    if (formulasImage.length) {
        try {
            await driveService.permitirAccesoUrlsExternasGoogleSheet(driveId);
        } catch (err) {
            console.warn('[SP-F-02] No se pudo habilitar URLs externas:', err.message);
        }
    }
    if (actualizacionesCeldas.length) {
        await driveService.actualizarCeldasGoogleSheet(driveId, actualizacionesCeldas);
        if (formulasImage.length) {
            console.log(`[SP-F-02] IMAGE() en ${formulasImage.length} celda(s)`);
        }
    }

    if (driveId && driveId !== spreadsheetId) {
        console.warn(`[SP-F-02] ID de Drive cambió tras reconversión: ${spreadsheetId} → ${driveId}`);
        return driveId;
    }
    return spreadsheetId;
}

function urlPublicaImagenSpF02(driveFileId) {
    const id = String(driveFileId || '').trim();
    if (!id) return '';
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`;
}

async function resolverCarpetaImagenesRecorrido(folioRecorrido) {
    const folio = String(folioRecorrido || '').trim() || 'Recorrido-sin-folio';
    const nombre = folio
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90) || 'Recorrido-sin-folio';
    return driveService.obtenerOCrearCarpeta(nombre, CARPETA_IMAGENES_SP_F02_RAIZ_ID);
}

async function migrarImagenesReporteACarpetaRecorrido(reporte) {
    const rep = sanitizarReporte(reporte);
    const folio = rep.folio || resolverNombreHojaReporte(rep);
    if (!folio) return rep;

    let carpetaDestino = null;
    const moverSiAplica = async (img) => {
        const id = String(img?.driveFileId || '').trim();
        if (!id) return;
        if (!carpetaDestino) {
            carpetaDestino = await resolverCarpetaImagenesRecorrido(folio);
        }
        try {
            await driveService.moverArchivoDrive(id, carpetaDestino);
        } catch (err) {
            console.warn(`[SP-F-02] No se pudo mover imagen ${id} a ${folio}:`, err.message);
        }
    };

    for (const item of rep.items || []) {
        for (const img of item.problemaImagenes || []) {
            await moverSiAplica(img);
        }
        for (const img of item.observacionesImagenes || []) {
            await moverSiAplica(img);
        }
        if (item.problemaImagen) await moverSiAplica(item.problemaImagen);
        if (item.observacionesImagen) await moverSiAplica(item.observacionesImagen);
    }
    return rep;
}

async function migrarImagenesTodosReportes(reportes) {
    const lista = Array.isArray(reportes) ? reportes : [];
    for (const reporte of lista) {
        if (!reporteTieneContenido(reporte)) continue;
        try {
            await migrarImagenesReporteACarpetaRecorrido(reporte);
        } catch (err) {
            console.warn('[SP-F-02] Migración de imágenes:', err.message);
        }
    }
}

async function subirImagenItem(body = {}) {
    const campo = String(body.campo || '').trim().toLowerCase();
    if (!['problema', 'observaciones'].includes(campo)) {
        const err = new Error('Campo inválido. Use "problema" u "observaciones".');
        err.statusCode = 400;
        throw err;
    }

    const imagenBase64 = String(body.imagen_base64 || body.imagenBase64 || '').trim();
    if (!imagenBase64) {
        const err = new Error('No se recibió la imagen (imagen_base64 requerido).');
        err.statusCode = 400;
        throw err;
    }

    const buffer = Buffer.from(imagenBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) {
        const err = new Error('La imagen está vacía.');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > 12 * 1024 * 1024) {
        const err = new Error('La imagen no puede superar 12 MB.');
        err.statusCode = 400;
        throw err;
    }

    let procesada;
    try {
        procesada = await normalizarBufferImagenSpF02(buffer);
    } catch (normErr) {
        const err = new Error('No se pudo procesar la imagen.');
        err.statusCode = 400;
        throw err;
    }

    const mimeType = 'image/jpeg';
    const itemIndex = Math.max(0, Number(body.item_index ?? body.itemIndex ?? 0));
    const slotIndex = Math.max(0, Number(body.slot_index ?? body.slotIndex ?? 0));
    const ext = 'jpg';
    const nombreArchivo = String(body.nombre_archivo || body.nombreArchivo || '').trim()
        || `sp-f-02-item-${itemIndex + 1}-${campo}-${slotIndex + 1}-${Date.now()}.${ext}`;

    const folioRecorrido = String(
        body.reporte_folio || body.folio_recorrido || body.folio || body.nombre_hoja || ''
    ).trim() || folioDesdeFecha(body.fecha);
    const carpetaId = await resolverCarpetaImagenesRecorrido(folioRecorrido);
    const resultado = await driveService.subirArchivoNuevo(
        procesada.buffer,
        nombreArchivo.replace(/\.\w+$/, '.jpg'),
        mimeType,
        carpetaId
    );

    return {
        driveFileId: resultado.id,
        nombreArchivo: resultado.name || nombreArchivo,
        mimeType: resultado.mimeType || mimeType,
        previewUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(resultado.id)}&sz=w400`,
        thumbDataUrl: procesada.thumbDataUrl
    };
}

async function recrearHojaReporte(spreadsheetId, nombreHoja, reporte) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    if (titulos.includes(nombreHoja)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [nombreHoja]);
        } catch (err) {
            console.warn(`[SP-F-02] No se pudo eliminar hoja previa ${nombreHoja}:`, err.message);
        }
    }
    const origen = await resolverTituloPlantilla(spreadsheetId);
    const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, origen, nombreHoja);
    const tituloFinal = dup.title || nombreHoja;
    const nuevoId = await escribirReporteEnHoja(spreadsheetId, tituloFinal, reporte);
    return { titulo: tituloFinal, driveFileId: nuevoId || spreadsheetId };
}

async function sincronizarHojasReportesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    let driveIdActual = spreadsheetId;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(driveIdActual);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = await resolverTituloPlantilla(driveIdActual);

    const mapaIdHojaPrevio = new Map();
    if (prev?.reportes) {
        for (const r of prev.reportes) {
            const almacenado = sanitizarNombreHoja(r.nombreHoja);
            mapaIdHojaPrevio.set(r.id, almacenado || resolverNombreHojaReporte(r));
        }
    }

    const hojasActivas = new Set();
    const reportesOut = [];

    for (const reporte of meta.reportes) {
        if (!reporteTieneContenido(reporte)) {
            reportesOut.push({ ...reporte, folio: folioDesdeFecha(reporte.fecha) });
            continue;
        }
        let nombreHoja = resolverNombreHojaReporte(reporte);
        const hojaPrev = mapaIdHojaPrevio.get(reporte.id);
        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(driveIdActual, hojaPrev, nombreHoja);
                nombreHoja = ren?.title || nombreHoja;
                setExistentes.delete(hojaPrev);
                setExistentes.add(nombreHoja);
            } catch (err) {
                try {
                    await driveService.eliminarHojasGoogleSheet(driveIdActual, [hojaPrev]);
                    setExistentes.delete(hojaPrev);
                } catch (err2) {
                    console.warn(`[SP-F-02] No se pudo eliminar hoja previa ${hojaPrev}:`, err2.message);
                }
            }
        }
        try {
            if (setExistentes.has(nombreHoja)) {
                const nuevoId = await escribirReporteEnHoja(driveIdActual, nombreHoja, reporte);
                if (nuevoId && nuevoId !== driveIdActual) driveIdActual = nuevoId;
            } else {
                const creada = await recrearHojaReporte(driveIdActual, nombreHoja, reporte);
                nombreHoja = creada.titulo;
                if (creada.driveFileId && creada.driveFileId !== driveIdActual) driveIdActual = creada.driveFileId;
                setExistentes.add(nombreHoja);
            }
            hojasActivas.add(nombreHoja);
            reportesOut.push({
                ...reporte,
                folio: folioDesdeFecha(reporte.fecha),
                nombreHoja
            });
        } catch (err) {
            console.warn(`[SP-F-02] No se pudo sincronizar hoja "${nombreHoja}":`, err.message);
            reportesOut.push(reporte);
        }
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaReporteSpF02(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveIdActual, eliminar);
        } catch (err) {
            console.warn('[SP-F-02] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return { datos: { ...meta, reportes: reportesOut }, driveFileId: driveIdActual };
}

async function esSpreadsheetEditableEnDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        return String(info?.mimeType || '') === 'application/vnd.google-apps.spreadsheet';
    } catch {
        return false;
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo)
            || String(f.id || '') === DRIVE_FILE_ID_SISTEMA
            || String(f.id || '') === TEMPLATE_DRIVE_ID)
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) candidatos.push(val);
    };
    agregar(registro?.drive_file_id);
    agregar(DRIVE_FILE_ID_SISTEMA);
    agregar(TEMPLATE_DRIVE_ID);
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    agregar(enCarpeta?.id);
    for (const id of candidatos) {
        try {
            if (await driveService.verificarArchivoExiste(id) && await esSpreadsheetEditableEnDrive(id)) {
                return id;
            }
        } catch {
            continue;
        }
    }
    return DRIVE_FILE_ID_SISTEMA || TEMPLATE_DRIVE_ID || null;
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
    if (dbVal != null && dbVal !== '') return formatearDatetimeMysqlMexico(dbVal);
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) return formatearDatetimeMysqlMexico(driveVal);
    return null;
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

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaReporte(resolverReporteActivo(datos));

    if (driveId && hojaEditor && hojaEditor !== 'Sin-nombre') {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SP-F-02] No se pudo resolver gid de hoja editor:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        hojaEditor,
        estatus: ESTATUS_VALIDOS,
        modalidades: MODALIDADES
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    const datosDb = await leerDatosRegistro(registro);
    let datos = datosDb || sanitizarDatos(DATOS_DEFECTO);

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    let archivoDrive = null;
    if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    }
    try {
        await migrarImagenesTodosReportes(datos.reportes);
    } catch (err) {
        console.warn('[SP-F-02] Migración de imágenes al cargar:', err.message);
    }
    registro = { ...(registro || {}), drive_file_id: driveFileId || null };
    return construirRespuesta(registro, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(resolverReporteActivo(datos))
    });
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
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

    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    const datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    try {
        await migrarImagenesTodosReportes(datosGuardar.reportes);
    } catch (err) {
        console.warn('[SP-F-02] No se pudieron migrar imágenes a carpetas de recorrido:', err.message);
    }

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const sync = await sincronizarHojasReportesEnDrive(driveId, datosGuardar, datosPrevios);
            Object.assign(datosGuardar, sync.datos);
            if (sync.driveFileId) driveId = sync.driveFileId;
            // Imágenes del formulario mandan al guardar (Excel no guarda metadatos JSON).
            datosGuardar.reportes = (datosGuardar.reportes || []).map((rep) => {
                const orig = (datosEntrada.reportes || []).find((r) => r.id === rep.id);
                return orig ? aplicarImagenesDesdeFormularioSpF02(rep, orig) : rep;
            });
        } catch (err) {
            console.warn('[SP-F-02] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });
    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(resolverReporteActivo(datosGuardar))
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) return cargarFormato(pool);

    const datosDb = await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO);
    const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
    const plantilla = await resolverTituloPlantilla(driveFileId);
    const reportes = [];
    const buffer = await descargarBufferDrive(driveFileId);

    for (const titulo of titulos || []) {
        if (titulo === plantilla || /^plantilla$/i.test(String(titulo).trim())) continue;
        if (!esHojaReporteSpF02(titulo)) continue;
        try {
            const ws = await obtenerWorksheet(buffer, titulo);
            if (!ws) continue;
            const parsed = parsearDatosDesdeHoja(ws);
            parsed.nombreHoja = titulo;
            const prev = (datosDb.reportes || []).find(
                (r) => r.nombreHoja === titulo || resolverNombreHojaReporte(r) === titulo
            );
            let reporteFinal = parsed;
            if (prev) {
                parsed.id = prev.id;
                reporteFinal = fusionarImagenesReporteSpF02(parsed, prev);
            }
            if (reporteTieneContenido(reporteFinal)) reportes.push(reporteFinal);
        } catch (err) {
            console.warn(`[SP-F-02] No se pudo leer hoja "${titulo}":`, err.message);
        }
    }

    const datos = sanitizarDatos({
        ...datosDb,
        reportes: reportes.length ? reportes : datosDb.reportes
    });

    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido,
        contenidoModificado: !!registro?.contenido_modificado
    });
    const registroFinal = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta(registroFinal, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(resolverReporteActivo(datos))
    });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveId = await resolverDriveFileId(registro);
    if (driveId) {
        try {
            await sincronizarHojasReportesEnDrive(driveId, datos, null);
        } catch (err) {
            console.warn('[SP-F-02] Actualizar plantilla:', err.message);
        }
    }
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(resolverReporteActivo(datos))
    });
}

/** Sincroniza un solo reporte en un spreadsheet (reutilizable desde PC). */
async function sincronizarReporteIndividualEnDrive(spreadsheetId, reporte, reportePrevio = null) {
    const limpio = sanitizarReporte(reporte);
    const prev = reportePrevio ? sanitizarReporte(reportePrevio) : null;
    const datos = { ...DATOS_DEFECTO, reportes: [limpio], reporteActivoId: limpio.id };
    const datosPrev = prev ? { ...DATOS_DEFECTO, reportes: [prev], reporteActivoId: prev.id } : null;
    const sync = await sincronizarHojasReportesEnDrive(spreadsheetId, datos, datosPrev);
    const out = (sync.datos?.reportes || [])[0];
    return out || { ...limpio, nombreHoja: limpio.nombreHoja || resolverNombreHojaReporte(limpio) };
}

/** Elimina la hoja de un reporte individual en Drive. */
async function eliminarHojaReporteIndividualEnDrive(spreadsheetId, nombreHoja) {
    const hoja = String(nombreHoja || '').trim();
    if (!hoja || hoja === SHEET_TITLE) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, [hoja]);
    } catch (err) {
        console.warn(`[SP-F-02] No se pudo eliminar hoja ${hoja}:`, err.message);
    }
}

function reporteEsValidoParaPc(r) {
    const rep = sanitizarReporte(r);
    if (!rep.fecha || !rep.proposito.trim()) return false;
    const items = (rep.items || []).filter((i) => !esItemVacio(i));
    return items.length > 0;
}

function esMismoReportePcArchivero(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && a.id === b.id) return true;
    return !!(a.origenPc && b.origenPc
        && a.documentoPipcId != null && a.documentoPipcId === b.documentoPipcId
        && a.empresaIdPc != null && a.empresaIdPc === b.empresaIdPc
        && a.operacionIdPc != null && a.operacionIdPc === b.operacionIdPc);
}

/** Registra o actualiza en el archivero SGC un reporte originado en Protección Civil. */
async function upsertReportePcEnArchivero(pool, reporte, meta = {}) {
    if (!pool?.query) return null;
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);

    const limpio = sanitizarReporte({
        ...reporte,
        origenPc: true,
        documentoPipcId: meta.documentoPipcId ?? reporte?.documentoPipcId,
        empresaIdPc: meta.empresaIdPc ?? reporte?.empresaIdPc,
        operacionIdPc: meta.operacionId ?? meta.operacionIdPc ?? reporte?.operacionIdPc
    });

    const reportes = [...(datosPrevios.reportes || [])];
    const idx = reportes.findIndex((r) => esMismoReportePcArchivero(r, limpio));
    const previo = idx >= 0 ? reportes[idx] : null;

    if (idx >= 0) {
        reportes[idx] = sanitizarReporte({ ...previo, ...limpio });
    } else {
        reportes.push(limpio);
    }

    const datosGuardar = sanitizarDatos({ ...datosPrevios, reportes });

    await guardarRegistroDb(pool, {
        driveFileId: registro?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true
    });

    return idx >= 0 ? reportes[idx] : limpio;
}

/** Sincroniza un reporte PC en su spreadsheet dedicado (copia de plantilla por recorrido). */
async function sincronizarReportePcEnSpreadsheetDedicado(spreadsheetId, reporte) {
    const limpio = sanitizarReporte(reporte);
    const nombreHoja = resolverNombreHojaReporte(limpio);
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    let hojaActiva = nombreHoja;
    if (titulos.includes(nombreHoja)) {
        await escribirReporteEnHoja(spreadsheetId, nombreHoja, limpio);
    } else {
        const creada = await recrearHojaReporte(spreadsheetId, nombreHoja, limpio);
        hojaActiva = creada.titulo || nombreHoja;
    }
    return { nombreHoja: hojaActiva, folio: folioDesdeFecha(limpio.fecha) };
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    ESTATUS_VALIDOS,
    MODALIDADES,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos,
    sanitizarReporte,
    reporteTieneContenido,
    reporteEsValidoParaPc,
    upsertReportePcEnArchivero,
    sincronizarReportePcEnSpreadsheetDedicado,
    folioDesdeFecha,
    fechaHoyIso,
    sincronizarReporteIndividualEnDrive,
    eliminarHojaReporteIndividualEnDrive,
    subirImagenItem,
    esImagenSpF02Conocida,
    MAX_IMAGENES_CAMPO
};
