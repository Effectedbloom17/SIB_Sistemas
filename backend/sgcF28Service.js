/**
 * SGC-F-28 · Comparativa de proveedores — persistencia en biznaga_sgc y sync con Drive.
 * Archivero: plantilla externa aislada + una hoja por comparativa en el archivo sistema.
 * Nombre de cada pestaña = valor de «Nombre de cotización» (sanitizado; colisiones → « 2», « 3»…).
 * El histograma / hojas auxiliares del sistema se conservan; nunca se escribe en la plantilla.
 *
 * Plantilla: hoja «Plantilla», columnas A–G (5 proveedores en C–G).
 * Criterios dinámicos a partir de la fila 12; Resultado y Observaciones se desplazan.
 */
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-28';

/** Plantilla maestra (solo lectura / copyTo). */
const TEMPLATE_DRIVE_ID = '1QIXS3sn51MefyzwXam-HxIN_9bsdv37_F6ITnF_OHHo';
const TEMPLATE_SHEET_TITLE = 'Plantilla';

/** Archivo de trabajo Centro SGC (archivero + histograma). */
const DRIVE_FILE_ID_SISTEMA = '1PxxA5U1Z0tOpbaj1eH8agdxOuQVgF8ya8VU2Uc9BhOI';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** Historial de Documentos > SGC-F-28 > Imagenes */
const CARPETA_IMAGENES_DRIVE_ID = '1r04mGmTXHWlj7R6CY-gnXWT2hR_uMWLN';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-28 Comparativa de proveedores (sistema)';
/** Fallback local en el sistema (legado); el origen real es TEMPLATE_DRIVE_ID. */
const SHEET_TITLE = 'Plantilla';
const MAX_PROVEEDORES = 5;
const PROVEEDOR_COLS = [3, 4, 5, 6, 7]; // C–G
const MAX_CRITERIO_ROWS = 20;
const CRITERIO_START_ROW = 12;
const RESULTADO_OFFSET = 1; // filas después del último criterio
const OBS_GAP = 2; // Resultado + fila en blanco antes de Observaciones
const OBS_SPAN = 3;

const TIPOS_CRITERIO = [
    'precio',
    'imagen',
    'liga_compra',
    'dimensiones',
    'caracteristicas',
    'metodo_pago',
    'requiere_cotizacion_previa',
    'modelo',
    'material',
    'otro'
];

const ETIQUETAS_TIPO = {
    precio: 'Precio',
    imagen: 'Imagen',
    liga_compra: 'Liga de Compra',
    dimensiones: 'Dimensiones',
    caracteristicas: 'Características',
    metodo_pago: 'Método de Pago',
    requiere_cotizacion_previa: 'Requiere Cotización Previa',
    modelo: 'Modelo',
    material: 'Material',
    otro: 'Otro'
};

const MONEDAS = ['MXN', 'USD', 'EUR', '-'];
const RESULTADOS = ['', 'Viable', 'Descartado'];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-23',
    fechaElaboracion: '2025-01-23',
    comparativas: [],
    comparativaActivaId: null,
    catalogoCriterios: []
};

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `f28-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaIso(valor) {
    if (!valor) return '';
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        const y = valor.getFullYear();
        const m = String(valor.getMonth() + 1).padStart(2, '0');
        const d = String(valor.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(valor).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        let yyyy = dmy[3];
        if (yyyy.length === 2) yyyy = `20${yyyy}`;
        return `${yyyy}-${mm}-${dd}`;
    }
    return '';
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

function formatearDatetimeMysqlMexico(valor) {
    if (!valor) return null;
    try {
        const d = valor instanceof Date ? valor : new Date(valor);
        if (Number.isNaN(d.getTime())) return null;
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(d).replace(' ', ' ');
    } catch {
        return null;
    }
}

function sanitizarTipo(tipo) {
    const t = String(tipo || '').trim().toLowerCase();
    return TIPOS_CRITERIO.includes(t) ? t : 'caracteristicas';
}

function sanitizarMoneda(moneda) {
    const raw = String(moneda || 'MXN').trim();
    if (raw === '-' || /^nulo|null|na$/i.test(raw)) {
        return '-';
    }
    const m = raw.toUpperCase();
    return MONEDAS.includes(m) ? m : 'MXN';
}

function sanitizarResultado(valor) {
    const v = String(valor || '').trim();
    if (/^viable$/i.test(v)) return 'Viable';
    if (/^descartado$/i.test(v)) return 'Descartado';
    return '';
}

function esUrlValida(texto) {
    const t = String(texto || '').trim();
    if (!t) return true;
    try {
        const u = new URL(t);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function sanitizarImagen(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    const base64 = String(raw.base64 || '').trim();
    const dataUrl = String(raw.dataUrl || raw.previewUrl || '').trim();
    const mimeType = String(raw.mimeType || raw.mime_type || 'image/jpeg').trim() || 'image/jpeg';
    const nombreArchivo = String(raw.nombreArchivo || raw.nombre_archivo || 'imagen.jpg').trim() || 'imagen.jpg';
    if (!driveFileId && !base64 && !dataUrl) return null;
    return {
        driveFileId: driveFileId || null,
        base64: base64 || null,
        dataUrl: dataUrl || null,
        mimeType,
        nombreArchivo
    };
}

function crearValorVacio(tipo) {
    const t = sanitizarTipo(tipo);
    if (t === 'precio') {
        return { texto: '', numero: null, moneda: 'MXN', imagen: null };
    }
    if (t === 'imagen') {
        return { texto: '', numero: null, moneda: 'MXN', imagen: null };
    }
    return { texto: '', numero: null, moneda: 'MXN', imagen: null };
}

function sanitizarValor(raw, tipo) {
    const base = crearValorVacio(tipo);
    if (!raw || typeof raw !== 'object') {
        if (typeof raw === 'string' || typeof raw === 'number') {
            if (tipo === 'precio') {
                const n = Number(String(raw).replace(/[^0-9.,-]/g, '').replace(',', '.'));
                return { ...base, numero: Number.isFinite(n) ? n : null, texto: String(raw) };
            }
            return { ...base, texto: String(raw) };
        }
        return base;
    }
    const texto = String(raw.texto ?? raw.valor ?? '').trim();
    let numero = raw.numero;
    if (numero === '' || numero === undefined) numero = null;
    if (numero !== null) {
        const n = Number(numero);
        numero = Number.isFinite(n) ? n : null;
    }
    let imagen = sanitizarImagen(raw.imagen);
    if (tipo === 'liga_compra' && texto && !esUrlValida(texto)) {
        return { ...base, texto: '' };
    }
    return {
        texto,
        numero,
        moneda: sanitizarMoneda(raw.moneda),
        imagen
    };
}

function crearProveedorVacio() {
    return {
        nombre: '',
        procesoProductoServicio: '',
        fechaCotizacion: '',
        resultado: '',
        observaciones: ''
    };
}

function sanitizarProveedor(raw) {
    const base = crearProveedorVacio();
    if (!raw || typeof raw !== 'object') return base;
    return {
        nombre: String(raw.nombre || '').trim(),
        procesoProductoServicio: String(raw.procesoProductoServicio || raw.proceso || '').trim(),
        fechaCotizacion: formatearFechaIso(raw.fechaCotizacion || raw.fecha || ''),
        resultado: sanitizarResultado(raw.resultado),
        observaciones: normalizarSaltosLinea(raw.observaciones)
    };
}

function crearCriterioVacio(tipo = 'caracteristicas', etiqueta = '') {
    const t = sanitizarTipo(tipo);
    return {
        id: nuevoId(),
        tipo: t,
        etiqueta: String(etiqueta || ETIQUETAS_TIPO[t] || 'Criterio').trim(),
        valores: Array.from({ length: MAX_PROVEEDORES }, () => crearValorVacio(t))
    };
}

function sanitizarCriterio(raw) {
    const tipo = sanitizarTipo(raw?.tipo);
    const etiquetaDefault = ETIQUETAS_TIPO[tipo] || 'Criterio';
    const valoresRaw = Array.isArray(raw?.valores) ? raw.valores : [];
    const valores = [];
    for (let i = 0; i < MAX_PROVEEDORES; i++) {
        valores.push(sanitizarValor(valoresRaw[i], tipo));
    }
    return {
        id: String(raw?.id || '').trim() || nuevoId(),
        tipo,
        etiqueta: String(raw?.etiqueta || etiquetaDefault).trim() || etiquetaDefault,
        valores
    };
}

function crearComparativaVacia() {
    return {
        id: nuevoId(),
        nombreCotizacion: '',
        fechaCreacion: excelHistorial.fechaAhoraMexicoIso(),
        proveedores: Array.from({ length: MAX_PROVEEDORES }, () => crearProveedorVacio()),
        criterios: [],
        nombreHoja: ''
    };
}

function sanitizarComparativa(raw) {
    const base = crearComparativaVacia();
    if (!raw || typeof raw !== 'object') return base;
    const proveedoresRaw = Array.isArray(raw.proveedores) ? raw.proveedores : [];
    const proveedores = [];
    for (let i = 0; i < MAX_PROVEEDORES; i++) {
        proveedores.push(sanitizarProveedor(proveedoresRaw[i]));
    }
    const criterios = Array.isArray(raw.criterios)
        ? raw.criterios.map(sanitizarCriterio).slice(0, MAX_CRITERIO_ROWS)
        : [];
    return {
        id: String(raw.id || '').trim() || nuevoId(),
        nombreCotizacion: String(raw.nombreCotizacion || raw.nombre || '').trim(),
        fechaCreacion: formatearFechaIso(raw.fechaCreacion) || base.fechaCreacion,
        proveedores,
        criterios,
        nombreHoja: sanitizarNombreHoja(raw.nombreHoja || raw.nombre_hoja || '')
    };
}

function sanitizarCatalogo(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const tipo = sanitizarTipo(item?.tipo);
        const etiqueta = String(item?.etiqueta || ETIQUETAS_TIPO[tipo] || '').trim();
        if (!etiqueta) continue;
        const key = `${tipo}::${etiqueta.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tipo, etiqueta });
    }
    return out.slice(0, 80);
}

function aprenderCatalogo(catalogo, criterios) {
    const merged = sanitizarCatalogo([
        ...catalogo,
        ...(criterios || []).map((c) => ({ tipo: c.tipo, etiqueta: c.etiqueta }))
    ]);
    return merged;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const comparativas = Array.isArray(base.comparativas)
        ? base.comparativas.map(sanitizarComparativa)
        : [];
    let catalogo = sanitizarCatalogo(base.catalogoCriterios);
    for (const c of comparativas) {
        catalogo = aprenderCatalogo(catalogo, c.criterios);
    }
    let activa = String(base.comparativaActivaId || '').trim() || null;
    if (activa && !comparativas.some((c) => c.id === activa)) {
        activa = comparativas[0]?.id || null;
    }
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || '00',
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        comparativas,
        comparativaActivaId: activa,
        catalogoCriterios: catalogo
    };
}

function resolverComparativaActiva(datos) {
    const meta = sanitizarDatos(datos);
    if (!meta.comparativas.length) return crearComparativaVacia();
    const hit = meta.comparativas.find((c) => c.id === meta.comparativaActivaId);
    return hit || meta.comparativas[0];
}

function datosConComparativaActiva(datos, comparativa) {
    return sanitizarDatos({
        ...(datos || {}),
        comparativaActivaId: comparativa?.id || null
    });
}

function comparativaTieneContenido(comp) {
    if (!comp) return false;
    if (String(comp.nombreCotizacion || '').trim()) return true;
    if ((comp.criterios || []).length) return true;
    return (comp.proveedores || []).some((p) =>
        p.nombre || p.procesoProductoServicio || p.fechaCotizacion || p.resultado || p.observaciones
    );
}

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function esHojaReservadaSgcF28(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (t === SHEET_TITLE || /^plantilla\.?$/i.test(t)) return true;
    if (/histograma/i.test(t)) return true;
    if (/^Alias_/i.test(t) || /^Partes_/i.test(t)) return true;
    if (/^_tmp_/i.test(t)) return true;
    if (/^SGCF28/i.test(t)) return true;
    if (excelHistorial.esHojaHistorial(t, CODIGO_FORMATO)) return true;
    return false;
}

function tituloHojaCoincide(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buscarTituloHoja(titulos, nombre) {
    return (titulos || []).find((titulo) => tituloHojaCoincide(titulo, nombre)) || '';
}

/**
 * Nombre de pestaña = «Nombre de cotización» (campo del formulario).
 * Colisiones: «nombre 2», «nombre 3»…
 */
function resolverNombreHojaDesdeComparativa(comp, ocupados = []) {
    let base = sanitizarNombreHoja(comp?.nombreCotizacion);
    if (!base) {
        const id = String(comp?.id || '').trim();
        base = id ? `BORRADOR-${id.slice(0, 8)}` : 'Sin-nombre';
    }
    if (esHojaReservadaSgcF28(base)) {
        base = `Cotizacion ${base}`.slice(0, 90);
    }
    const usados = new Set(
        (ocupados || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
    );
    let nombre = base;
    let n = 2;
    while (usados.has(nombre.toLowerCase()) || esHojaReservadaSgcF28(nombre)) {
        nombre = `${base} ${n}`.slice(0, 90);
        n += 1;
    }
    return nombre;
}

function resolverNombreHojaComparativa(datos, ocupados = []) {
    const comp = resolverComparativaActiva(sanitizarDatos(datos));
    const fijo = sanitizarNombreHoja(comp?.nombreHoja);
    if (fijo && !esHojaReservadaSgcF28(fijo) && !(ocupados || []).length) {
        return fijo;
    }
    return resolverNombreHojaDesdeComparativa(comp, ocupados);
}

function esHojaComparativaSgcF28(titulo) {
    return !esHojaReservadaSgcF28(titulo);
}

function asignarNombresHojaComparativas(comparativas, mapaPrevio, titulosExistentes) {
    const nombrePorId = new Map();
    const ocupados = [];

    for (const item of comparativas || []) {
        const prev = mapaPrevio.get(item.id);
        if (!prev || esHojaReservadaSgcF28(prev)) continue;
        nombrePorId.set(item.id, prev);
        ocupados.push(prev);
    }

    for (const item of comparativas || []) {
        const prev = nombrePorId.get(item.id);
        if (!prev) continue;
        const base = sanitizarNombreHoja(item.nombreCotizacion)
            || (item.id ? `BORRADOR-${String(item.id).slice(0, 8)}` : 'Sin-nombre');
        if (tituloHojaCoincide(base, prev)) continue;
        const bloqueados = ocupados.filter((nombre) => !tituloHojaCoincide(nombre, prev));
        for (const titulo of titulosExistentes || []) {
            if (!tituloHojaCoincide(titulo, prev)) bloqueados.push(titulo);
        }
        const deseado = resolverNombreHojaDesdeComparativa(item, bloqueados);
        if (tituloHojaCoincide(deseado, prev)) continue;
        const idx = ocupados.findIndex((nombre) => tituloHojaCoincide(nombre, prev));
        if (idx >= 0) ocupados[idx] = deseado;
        else ocupados.push(deseado);
        nombrePorId.set(item.id, deseado);
    }

    for (const item of comparativas || []) {
        if (nombrePorId.has(item.id)) continue;
        const nombre = resolverNombreHojaDesdeComparativa(item, [...ocupados, ...(titulosExistentes || [])]);
        nombrePorId.set(item.id, nombre);
        ocupados.push(nombre);
    }
    return nombrePorId;
}

function aplicarNombresHojaEnDatos(datos, hojasPorId) {
    if (!datos || !hojasPorId) return;
    for (const item of datos.comparativas || []) {
        const nombre = hojasPorId.get(item.id);
        if (nombre) item.nombreHoja = nombre;
    }
}

/**
 * Inserta saltos de línea (\n) en textos largos para que quepan en celdas
 * de ~220 px (columnas C–G) al exportar a Sheets/PDF.
 * Respeta saltos existentes y parte por palabras cuando es posible.
 */
function softWrapTextoExcel(texto, cada = 28) {
    const ancho = Math.max(8, Number(cada) || 28);
    const raw = String(texto || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    const partirTokenLargo = (token) => {
        const partes = [];
        for (let i = 0; i < token.length; i += ancho) {
            partes.push(token.slice(i, i + ancho));
        }
        return partes;
    };

    const wrapLinea = (linea) => {
        const limpia = String(linea || '').trimEnd();
        if (!limpia) return '';
        if (limpia.length <= ancho) return limpia;

        const tokens = limpia.split(/(\s+)/);
        const lineas = [];
        let actual = '';

        for (const token of tokens) {
            if (!token) continue;
            if (!actual) {
                if (token.length > ancho && !/^\s+$/.test(token)) {
                    const trozos = partirTokenLargo(token);
                    lineas.push(...trozos.slice(0, -1));
                    actual = trozos[trozos.length - 1] || '';
                } else if (!/^\s+$/.test(token)) {
                    actual = token;
                }
                continue;
            }

            if ((actual + token).length <= ancho) {
                actual += token;
                continue;
            }

            lineas.push(actual.trimEnd());
            if (/^\s+$/.test(token)) {
                actual = '';
            } else if (token.length > ancho) {
                const trozos = partirTokenLargo(token);
                lineas.push(...trozos.slice(0, -1));
                actual = trozos[trozos.length - 1] || '';
            } else {
                actual = token;
            }
        }

        if (actual.trim()) lineas.push(actual.trimEnd());
        return lineas.join('\n');
    };

    return raw
        .split('\n')
        .map(wrapLinea)
        .filter((l, idx, arr) => l || (idx > 0 && idx < arr.length - 1))
        .join('\n');
}

function contarLineasTexto(texto) {
    const t = String(texto || '').replace(/\r\n/g, '\n').trim();
    if (!t) return 1;
    return Math.max(1, t.split('\n').length);
}

function estimarAltoFilaPx(lineas, opciones = {}) {
    const n = Math.max(1, Number(lineas) || 1);
    const porLinea = opciones.porLinea || 16;
    const pad = opciones.pad != null ? opciones.pad : 14;
    const min = opciones.min != null ? opciones.min : 36;
    const max = opciones.max != null ? opciones.max : 240;
    return Math.min(max, Math.max(min, pad + n * porLinea));
}

function valorCriterioATexto(criterio, valor) {
    if (!valor) return '';
    if (criterio.tipo === 'precio') {
        if (String(valor.moneda || '') === '-') {
            return '-';
        }
        if (valor.numero == null || valor.numero === '') return '';
        const n = Number(valor.numero);
        if (!Number.isFinite(n)) return '';
        // Sin monto cargado (0 por default de input) → celda vacía, no $0.00
        if (n === 0) return '';
        const formatted = n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const simb = valor.moneda === 'USD' ? 'US$' : valor.moneda === 'EUR' ? '€' : '$';
        return `${simb}${formatted}`;
    }
    if (criterio.tipo === 'imagen') {
        // La foto se escribe después con =IMAGE + permiso externo del spreadsheet.
        return '';
    }
    if (criterio.tipo === 'liga_compra') {
        return softWrapTextoExcel(valor.texto || '', 24);
    }
    // ~28 chars ≈ ancho útil de columna 220 px (Century Gothic 10)
    return softWrapTextoExcel(valor.texto || '', 28);
}

function urlPublicaImagenDrive(driveFileId) {
    const id = String(driveFileId || '').trim();
    if (!id) return '';
    // thumbnail es el más fiable para =IMAGE() con archivos públicos de Drive
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w800`;
}

function rangoSheet(a1, sheetTitle) {
    const titulo = String(sheetTitle || SHEET_TITLE).replace(/'/g, "''");
    return `'${titulo}'!${a1}`;
}

function celdaRef(row, col) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let c = col;
    let s = '';
    while (c > 0) {
        const rem = (c - 1) % 26;
        s = letters[rem] + s;
        c = Math.floor((c - 1) / 26);
    }
    return `${s}${row}`;
}

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(celdaRef(row, col), sheetTitle),
        values: [[valor == null ? '' : valor]]
    });
}

function etiquetaFechaRevision(fechaIso) {
    const display = formatearFechaDisplay(fechaIso);
    return display ? `Fecha de rev.: ${display}` : 'Fecha de rev.:';
}

function datosAActualizacionesSheet(datos, sheetTitle, layout) {
    const meta = sanitizarDatos(datos);
    const comp = resolverComparativaActiva(meta);
    const actualizaciones = [];
    const nCrit = Math.max(1, (comp.criterios || []).length);
    const resultadoRow = layout?.resultadoRow || (CRITERIO_START_ROW + nCrit);
    const obsRow = layout?.obsRow || (resultadoRow + OBS_GAP);

    pushUpdate(actualizaciones, 2, 7, `Revisión: ${meta.revision || '00'}`, sheetTitle);
    pushUpdate(actualizaciones, 3, 7, etiquetaFechaRevision(meta.fechaRevision), sheetTitle);

    for (let i = 0; i < MAX_PROVEEDORES; i++) {
        const col = PROVEEDOR_COLS[i];
        const p = comp.proveedores[i] || crearProveedorVacio();
        pushUpdate(actualizaciones, 6, col, String(i + 1), sheetTitle);
        pushUpdate(actualizaciones, 7, col, softWrapTextoExcel(p.nombre || '', 28), sheetTitle);
        pushUpdate(actualizaciones, 8, col, softWrapTextoExcel(p.procesoProductoServicio || '', 28), sheetTitle);
        pushUpdate(actualizaciones, 9, col, formatearFechaDisplay(p.fechaCotizacion), sheetTitle);
        pushUpdate(actualizaciones, resultadoRow, col, p.resultado || '', sheetTitle);
        // Observaciones: conservar saltos; si es un bloque largo sin \n, partirlo.
        const obs = softWrapTextoExcel(p.observaciones || '', 32);
        pushUpdate(actualizaciones, obsRow, col, obs, sheetTitle);
    }

    pushUpdate(actualizaciones, resultadoRow, 2, 'Resultado', sheetTitle);
    pushUpdate(actualizaciones, obsRow, 2, 'Observaciones', sheetTitle);

    const criterios = comp.criterios || [];
    for (let i = 0; i < nCrit; i++) {
        const row = CRITERIO_START_ROW + i;
        const crit = criterios[i];
        pushUpdate(actualizaciones, row, 1, String(i + 1), sheetTitle);
        if (crit) {
            // Conservar \n del usuario (Otro); el wrap visual lo aplica el formato WRAP de col. B.
            pushUpdate(actualizaciones, row, 2, crit.etiqueta || ETIQUETAS_TIPO[crit.tipo] || '', sheetTitle);
            for (let j = 0; j < MAX_PROVEEDORES; j++) {
                const col = PROVEEDOR_COLS[j];
                const val = crit.valores?.[j];
                pushUpdate(actualizaciones, row, col, valorCriterioATexto(crit, val), sheetTitle);
            }
        } else {
            pushUpdate(actualizaciones, row, 2, '', sheetTitle);
            for (const col of PROVEEDOR_COLS) {
                pushUpdate(actualizaciones, row, col, '', sheetTitle);
            }
        }
    }

    return actualizaciones;
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

/**
 * Ubica la fila 1-based de «Resultado» en col. B (tras los criterios).
 * Plantilla base: 1 criterio → Resultado en fila 13.
 */
async function detectarFilaResultado(spreadsheetId, sheetTitle) {
    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const fin = CRITERIO_START_ROW + MAX_CRITERIO_ROWS + OBS_GAP + 4;
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: rangoSheet(`B${CRITERIO_START_ROW}:B${fin}`, sheetTitle),
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    for (let i = 0; i < rows.length; i++) {
        const txt = String((rows[i] || [])[0] || '').trim();
        if (/^resultado$/i.test(txt)) {
            return CRITERIO_START_ROW + i;
        }
    }
    return null;
}

async function asegurarFilasCriterios(spreadsheetId, sheetTitle, numCriterios) {
    const n = Math.max(1, Math.min(MAX_CRITERIO_ROWS, Number(numCriterios) || 1));
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        throw new Error(`Hoja "${sheetTitle}" no encontrada`);
    }

    let filaResultado = null;
    try {
        filaResultado = await detectarFilaResultado(spreadsheetId, sheetTitle);
    } catch (err) {
        console.warn('[SGC-F-28] No se pudo detectar fila Resultado:', err.message);
    }
    // Plantilla: 1 criterio → Resultado en CRITERIO_START_ROW + 1
    const criteriosActuales = filaResultado != null
        ? Math.max(1, filaResultado - CRITERIO_START_ROW)
        : 1;
    const delta = n - criteriosActuales;

    if (delta > 0) {
        // Insertar antes de Resultado (índice 0-based = fila Resultado - 1)
        const startIndex = (filaResultado != null ? filaResultado : CRITERIO_START_ROW + 1) - 1;
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, startIndex, delta, {
            inheritFromBefore: true
        });
    } else if (delta < 0) {
        // Quitar filas de criterio sobrantes (justo antes de Resultado)
        const startIndex = CRITERIO_START_ROW + n - 1; // 0-based: primera fila a borrar
        await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, startIndex, -delta);
    }

    const resultadoRow = CRITERIO_START_ROW + n;
    const obsRow = resultadoRow + OBS_GAP;
    return { sheetId, nCrit: n, resultadoRow, obsRow };
}

async function aplicarFormatoResultados(spreadsheetId, sheetTitle, resultadoRow) {
    try {
        const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
        if (sheetId == null) return;
        const { google } = require('googleapis');
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const textFormat = { fontFamily: 'Century Gothic', fontSize: 11, bold: false };
        const requests = [];
        for (let i = 0; i < MAX_PROVEEDORES; i++) {
            const col = PROVEEDOR_COLS[i] - 1;
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: resultadoRow - 1,
                        endRowIndex: resultadoRow,
                        startColumnIndex: col,
                        endColumnIndex: col + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textFormat
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
                }
            });
        }
        // Colores vía conditional-like: leemos valores no; se aplican en batch aparte tras escribir
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SGC-F-28] Formato resultados:', err.message);
    }
}

async function aplicarColoresResultado(spreadsheetId, sheetTitle, resultadoRow, proveedores) {
    try {
        const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
        if (sheetId == null) return;
        const { google } = require('googleapis');
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const requests = [];
        for (let i = 0; i < MAX_PROVEEDORES; i++) {
            const res = sanitizarResultado(proveedores?.[i]?.resultado);
            const col = PROVEEDOR_COLS[i] - 1;
            let bg = null;
            let fg = null;
            if (res === 'Viable') {
                bg = { red: 0.85, green: 0.95, blue: 0.85 };
                fg = { red: 0.1, green: 0.45, blue: 0.2 };
            } else if (res === 'Descartado') {
                bg = { red: 0.98, green: 0.88, blue: 0.88 };
                fg = { red: 0.7, green: 0.15, blue: 0.15 };
            } else {
                bg = { red: 1, green: 1, blue: 1 };
                fg = { red: 0, green: 0, blue: 0 };
            }
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: resultadoRow - 1,
                        endRowIndex: resultadoRow,
                        startColumnIndex: col,
                        endColumnIndex: col + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: bg,
                            textFormat: {
                                fontFamily: 'Century Gothic',
                                fontSize: 11,
                                foregroundColor: fg,
                                bold: false
                            },
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE'
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
                }
            });
        }
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SGC-F-28] Colores resultado:', err.message);
    }
}

async function subirImagenCriterio(imagen) {
    if (!imagen) return null;
    const drive = require('googleapis').google.drive({
        version: 'v3',
        auth: driveService.getAuthClient()
    });

    const enriquecer = async (fileId) => {
        try {
            await drive.permissions.create({
                fileId,
                requestBody: { role: 'reader', type: 'anyone' }
            }).catch(() => null);
            const meta = await drive.files.get({
                fileId,
                fields: 'id,webContentLink,thumbnailLink,webViewLink'
            });
            const uc = `https://drive.google.com/uc?id=${fileId}&export=download`;
            const thumb = urlPublicaImagenDrive(fileId);
            return {
                driveFileId: fileId,
                url: thumb || meta.data.webContentLink || uc,
                thumbnailLink: meta.data.thumbnailLink || null,
                urls: [
                    thumb,
                    meta.data.thumbnailLink,
                    meta.data.webContentLink,
                    uc,
                    `https://drive.google.com/uc?export=download&id=${fileId}`,
                    `https://lh3.googleusercontent.com/d/${fileId}`
                ].filter(Boolean)
            };
        } catch {
            return {
                driveFileId: fileId,
                url: `https://drive.google.com/uc?id=${fileId}&export=download`,
                urls: [
                    `https://drive.google.com/uc?id=${fileId}&export=download`,
                    urlPublicaImagenDrive(fileId)
                ].filter(Boolean)
            };
        }
    };

    if (imagen.driveFileId) {
        await asegurarImagenEnCarpetaImagenes(imagen.driveFileId);
        return enriquecer(imagen.driveFileId);
    }
    let dataUrl = imagen.dataUrl || '';
    if (!dataUrl && imagen.base64) {
        const mime = imagen.mimeType || 'image/jpeg';
        dataUrl = imagen.base64.startsWith('data:')
            ? imagen.base64
            : `data:${mime};base64,${imagen.base64}`;
    }
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const nombre = imagen.nombreArchivo || `sgc-f28-${Date.now()}.jpg`;
    const subida = await driveService.subirImagenTemporal(dataUrl, nombre, CARPETA_IMAGENES_DRIVE_ID);
    return enriquecer(subida.fileId);
}

async function aplicarFormatoCeldasComparativa(spreadsheetId, sheetTitle, layout, comparativa) {
    try {
        const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
        if (sheetId == null) return;
        const { google } = require('googleapis');
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const nCrit = Math.max(1, (comparativa?.criterios || []).length);
        const resultadoRow = layout?.resultadoRow || (CRITERIO_START_ROW + nCrit);
        const obsRow = layout?.obsRow || (resultadoRow + OBS_GAP);
        const textFormat = { fontFamily: 'Century Gothic', fontSize: 10 };
        const requests = [];

        // Identificación proveedor (filas 7-9): Centro + Medio + Ajuste
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 6,
                    endRowIndex: 9,
                    startColumnIndex: PROVEEDOR_COLS[0] - 1,
                    endColumnIndex: PROVEEDOR_COLS[MAX_PROVEEDORES - 1]
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });

        // Identificación: alto dinámico según textos largos (nombre / proceso)
        const proveedores = comparativa?.proveedores || [];
        let maxLineasNombre = 1;
        let maxLineasProceso = 1;
        let maxLineasObs = 1;
        for (const p of proveedores) {
            maxLineasNombre = Math.max(
                maxLineasNombre,
                contarLineasTexto(softWrapTextoExcel(p?.nombre || '', 28))
            );
            maxLineasProceso = Math.max(
                maxLineasProceso,
                contarLineasTexto(softWrapTextoExcel(p?.procesoProductoServicio || '', 28))
            );
            maxLineasObs = Math.max(
                maxLineasObs,
                contarLineasTexto(softWrapTextoExcel(p?.observaciones || '', 32))
            );
        }
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: 6,
                    endIndex: 7
                },
                properties: { pixelSize: estimarAltoFilaPx(maxLineasNombre, { min: 28, max: 120 }) },
                fields: 'pixelSize'
            }
        });
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: 7,
                    endIndex: 8
                },
                properties: { pixelSize: estimarAltoFilaPx(maxLineasProceso, { min: 28, max: 140 }) },
                fields: 'pixelSize'
            }
        });

        // Columna A («No.»): centro + bordes en filas de criterio nuevas
        const bordeCriterio = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: CRITERIO_START_ROW - 1,
                    endRowIndex: CRITERIO_START_ROW - 1 + nCrit,
                    startColumnIndex: 0,
                    endColumnIndex: 1
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'OVERFLOW_CELL',
                        textFormat: { fontFamily: 'Century Gothic', fontSize: 10 }
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });
        // Bordes del bloque de criterios (A–G), incl. «No.» al registrar filas nuevas
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: CRITERIO_START_ROW - 1,
                    endRowIndex: CRITERIO_START_ROW - 1 + nCrit,
                    startColumnIndex: 0,
                    endColumnIndex: PROVEEDOR_COLS[MAX_PROVEEDORES - 1]
                },
                top: bordeCriterio,
                bottom: bordeCriterio,
                left: bordeCriterio,
                right: bordeCriterio,
                innerHorizontal: bordeCriterio,
                innerVertical: bordeCriterio
            }
        });

        // Columna B (criterios / Resultado / Observaciones): Ajuste de texto + vertical Medio
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: CRITERIO_START_ROW - 1,
                    endRowIndex: obsRow + 2,
                    startColumnIndex: 1,
                    endColumnIndex: 2
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat: { fontFamily: 'Century Gothic', fontSize: 10 }
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 1,
                    endIndex: 2
                },
                properties: { pixelSize: 160 },
                fields: 'pixelSize'
            }
        });

        // Criterios por fila (tipografía / alto según líneas con \n, incl. etiqueta col. B)
        const criterios = comparativa?.criterios || [];
        const ANCHO_ETIQUETA_COL_B = 18;
        for (let i = 0; i < nCrit; i++) {
            const crit = criterios[i];
            const tipo = crit?.tipo;
            const rowIndex = CRITERIO_START_ROW - 1 + i;
            const fontSize = tipo === 'liga_compra' ? 9 : 10;
            const etiquetaTxt = softWrapTextoExcel(
                crit?.etiqueta || ETIQUETAS_TIPO[tipo] || '',
                ANCHO_ETIQUETA_COL_B
            );
            let pixelSize;
            if (tipo === 'imagen') {
                pixelSize = 120;
            } else if (tipo === 'precio') {
                pixelSize = Math.max(36, estimarAltoFilaPx(contarLineasTexto(etiquetaTxt), {
                    min: 36,
                    max: 120,
                    porLinea: 16
                }));
            } else {
                let maxLineas = contarLineasTexto(etiquetaTxt);
                for (let j = 0; j < MAX_PROVEEDORES; j++) {
                    const txt = valorCriterioATexto(crit, crit?.valores?.[j]);
                    maxLineas = Math.max(maxLineas, contarLineasTexto(txt));
                }
                pixelSize = estimarAltoFilaPx(maxLineas, {
                    min: tipo === 'liga_compra' ? 48 : 36,
                    max: tipo === 'liga_compra' ? 160 : 220,
                    porLinea: tipo === 'liga_compra' ? 14 : 16
                });
            }
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex + 1,
                        startColumnIndex: PROVEEDOR_COLS[0] - 1,
                        endColumnIndex: PROVEEDOR_COLS[MAX_PROVEEDORES - 1]
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textFormat: { fontFamily: 'Century Gothic', fontSize }
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
                }
            });
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1
                    },
                    properties: { pixelSize },
                    fields: 'pixelSize'
                }
            });
        }

        // Observaciones: Centro + Medio + Ajuste; alto según texto con \n
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: obsRow - 1,
                    endRowIndex: obsRow + 2,
                    startColumnIndex: PROVEEDOR_COLS[0] - 1,
                    endColumnIndex: PROVEEDOR_COLS[MAX_PROVEEDORES - 1]
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });
        const altoObsPrincipal = estimarAltoFilaPx(maxLineasObs, {
            min: 48,
            max: 220,
            porLinea: 16,
            pad: 16
        });
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: obsRow - 1,
                    endIndex: obsRow
                },
                properties: { pixelSize: altoObsPrincipal },
                fields: 'pixelSize'
            }
        });
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: obsRow,
                    endIndex: obsRow + 2
                },
                properties: { pixelSize: 24 },
                fields: 'pixelSize'
            }
        });

        // Ancho fijo columnas C–G = 220 px
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: PROVEEDOR_COLS[0] - 1,
                    endIndex: PROVEEDOR_COLS[MAX_PROVEEDORES - 1]
                },
                properties: { pixelSize: 220 },
                fields: 'pixelSize'
            }
        });

        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SGC-F-28] Formato celdas comparativa:', err.message);
    }
}

async function insertarImagenesComparativa(spreadsheetId, sheetTitle, sheetId, comparativa) {
    const criterios = comparativa?.criterios || [];
    const hayImagenes = criterios.some((c) =>
        c?.tipo === 'imagen' && (c.valores || []).some((v) => v?.imagen)
    );
    if (!hayImagenes) return;

    try {
        await driveService.permitirAccesoUrlsExternasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-28] No se pudo habilitar URLs externas:', err.message);
    }

    const actualizaciones = [];
    for (let i = 0; i < criterios.length; i++) {
        const crit = criterios[i];
        if (crit.tipo !== 'imagen') continue;
        const row = CRITERIO_START_ROW + i;
        for (let j = 0; j < MAX_PROVEEDORES; j++) {
            const val = crit.valores?.[j];
            if (!val?.imagen) continue;
            try {
                const subida = await subirImagenCriterio(val.imagen);
                if (!subida?.driveFileId) {
                    console.warn(`[SGC-F-28] Sin driveFileId para imagen ${i + 1}/${j + 1}`);
                    continue;
                }
                val.imagen.driveFileId = subida.driveFileId;
                const url = urlPublicaImagenDrive(subida.driveFileId);
                actualizaciones.push({
                    range: rangoSheet(celdaRef(row, PROVEEDOR_COLS[j]), sheetTitle),
                    values: [[`=IMAGE("${url}")`]]
                });
            } catch (err) {
                console.warn(`[SGC-F-28] Imagen criterio ${i + 1} prov ${j + 1}:`, err.message);
            }
        }
    }

    if (actualizaciones.length) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
        console.log(`[SGC-F-28] IMAGE() escrita en ${actualizaciones.length} celda(s)`);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const meta = sanitizarDatos(datos);
    const comp = resolverComparativaActiva(meta);
    const nCrit = Math.max(1, (comp.criterios || []).length);
    const layout = {
        resultadoRow: CRITERIO_START_ROW + nCrit,
        obsRow: CRITERIO_START_ROW + nCrit + OBS_GAP
    };
    const actualizaciones = datosAActualizacionesSheet(meta, sheetTitle, layout);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await aplicarFormatoCeldasComparativa(spreadsheetId, sheetTitle, layout, comp);
    await aplicarFormatoResultados(spreadsheetId, sheetTitle, layout.resultadoRow);
    await aplicarColoresResultado(spreadsheetId, sheetTitle, layout.resultadoRow, comp.proveedores);
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 * Nunca escribe ni borra en TEMPLATE_DRIVE_ID.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || 'Sin-nombre';
    console.warn(
        `[SGC-F-28] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    return copiada.title || destino;
}

/**
 * Crea/recrea la hoja del ítem desde la plantilla externa.
 * Fallback legado: duplicar «Plantilla» local del sistema si aún existe.
 */
async function recrearHojaComparativa(spreadsheetId, nombreHoja, datosConActiva, plantillaLocal = '') {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-28 solo recrea hojas en el archivo sistema.');
    }
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const existente = buscarTituloHoja(titulos, nombreHoja);
    if (existente && !esHojaReservadaSgcF28(existente)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [existente]);
        } catch (err) {
            console.warn(`[SGC-F-28] No se pudo eliminar hoja previa ${existente}:`, err.message);
        }
    }

    let tituloFinal;
    try {
        tituloFinal = await adoptarPlantillaEnSistema(spreadsheetId, nombreHoja);
    } catch (err) {
        console.warn(`[SGC-F-28] copyTo plantilla falló para "${nombreHoja}":`, err.message);
        const origen = plantillaLocal
            || driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /plantilla/i })
            || '';
        if (!origen) throw err;
        const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, origen, nombreHoja);
        tituloFinal = dup.title || nombreHoja;
    }

    const comp = resolverComparativaActiva(datosConActiva);
    const nCrit = Math.max(1, (comp.criterios || []).length);
    const layout = await asegurarFilasCriterios(spreadsheetId, tituloFinal, nCrit);
    await actualizarDatosEnGoogleSheet(spreadsheetId, datosConActiva, tituloFinal);
    await insertarImagenesComparativa(spreadsheetId, tituloFinal, layout.sheetId, comp);
    return tituloFinal;
}

/**
 * Una pestaña por comparativa del archivero; nombre = «Nombre de cotización».
 * No versiona por mes ni escribe en la plantilla externa.
 */
async function sincronizarHojasComparativasEnDrive(spreadsheetId, datos, datosPrevios = null, opciones = {}) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-28 solo escribe en el archivo sistema, nunca en la plantilla externa.');
    }
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaLocal = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    ) || '';

    const mapaIdHojaPrevio = new Map();
    const ocupadosPrevios = [];
    if (prev?.comparativas) {
        for (const c of prev.comparativas) {
            const fijo = sanitizarNombreHoja(c.nombreHoja);
            const nombre = fijo || resolverNombreHojaDesdeComparativa(c, ocupadosPrevios);
            ocupadosPrevios.push(nombre);
            mapaIdHojaPrevio.set(c.id, nombre);
        }
    }

    const nombrePorId = asignarNombresHojaComparativas(
        meta.comparativas.filter(comparativaTieneContenido),
        mapaIdHojaPrevio,
        titulosExistentes
    );
    const forzarRecrear = !!opciones?.forzarRecrear;
    const hojasActivas = new Set();
    let hojaActiva = '';

    for (const comparativa of meta.comparativas) {
        if (!comparativaTieneContenido(comparativa)) continue;

        let nombreHoja = nombrePorId.get(comparativa.id)
            || resolverNombreHojaDesdeComparativa(comparativa, [...hojasActivas]);
        const hojaPrev = mapaIdHojaPrevio.get(comparativa.id);

        if (hojaPrev && !tituloHojaCoincide(hojaPrev, nombreHoja)
            && buscarTituloHoja([...setExistentes], hojaPrev)
            && !esHojaReservadaSgcF28(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(buscarTituloHoja([...setExistentes], hojaPrev));
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-28] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                nombreHoja = hojaPrev;
            }
        }

        const existe = !!buscarTituloHoja([...setExistentes], nombreHoja);
        try {
            if (!existe || forzarRecrear) {
                nombreHoja = await recrearHojaComparativa(
                    spreadsheetId,
                    nombreHoja,
                    datosConComparativaActiva(meta, comparativa),
                    plantillaLocal
                );
            } else {
                const comp = comparativa;
                const nCrit = Math.max(1, (comp.criterios || []).length);
                const layout = await asegurarFilasCriterios(spreadsheetId, nombreHoja, nCrit);
                await actualizarDatosEnGoogleSheet(
                    spreadsheetId,
                    datosConComparativaActiva(meta, comparativa),
                    nombreHoja
                );
                await insertarImagenesComparativa(spreadsheetId, nombreHoja, layout.sheetId, comp);
            }
            setExistentes.add(nombreHoja);
            hojasActivas.add(nombreHoja);
            nombrePorId.set(comparativa.id, nombreHoja);
            if (comparativa.id === meta.comparativaActivaId) {
                hojaActiva = nombreHoja;
            }
        } catch (err) {
            console.warn(`[SGC-F-28] No se pudo sincronizar hoja "${nombreHoja}":`, err.message);
        }
    }

    const eliminar = [];
    for (const titulo of [...setExistentes]) {
        if (esHojaReservadaSgcF28(titulo)) continue;
        const vigente = [...hojasActivas].some((nombre) => tituloHojaCoincide(nombre, titulo));
        const eraPrevia = [...mapaIdHojaPrevio.values()].some((nombre) => tituloHojaCoincide(nombre, titulo));
        if (!vigente && eraPrevia) eliminar.push(titulo);
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-28] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    if (hojaActiva) {
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, hojaActiva);
        } catch (err) {
            console.warn('[SGC-F-28] No se pudo mostrar la hoja activa al frente:', err.message);
        }
    }

    aplicarNombresHojaEnDatos(meta, nombrePorId);
    if (!hojaActiva && meta.comparativaActivaId) {
        hojaActiva = nombrePorId.get(meta.comparativaActivaId) || '';
    }
    return { hojasActivas, hojasPorId: nombrePorId, hojaActiva, datos: meta };
}

function firmaComparativa(c) {
    return JSON.stringify({
        nombreCotizacion: c.nombreCotizacion,
        proveedores: c.proveedores,
        criterios: (c.criterios || []).map((cr) => ({
            tipo: cr.tipo,
            etiqueta: cr.etiqueta,
            valores: (cr.valores || []).map((v) => ({
                texto: v.texto,
                numero: v.numero,
                moneda: v.moneda,
                imagenId: v.imagen?.driveFileId || (v.imagen?.base64 || v.imagen?.dataUrl ? 'pending' : null)
            }))
        }))
    });
}

function contenidoEsEquivalente(a, b) {
    const da = sanitizarDatos(a);
    const db = sanitizarDatos(b);
    if (da.revision !== db.revision || da.fechaRevision !== db.fechaRevision) return false;
    if (da.comparativas.length !== db.comparativas.length) return false;
    for (let i = 0; i < da.comparativas.length; i++) {
        if (firmaComparativa(da.comparativas[i]) !== firmaComparativa(db.comparativas[i])) return false;
    }
    return true;
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

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) return false;
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') return false;
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-28] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

function esArchivoImagenDrive(archivo) {
    const mime = String(archivo?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const nombre = String(archivo?.name || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|bmp)$/i.test(nombre);
}

function recolectarDriveFileIdsImagenes(datos) {
    const ids = [];
    for (const comp of datos?.comparativas || []) {
        for (const crit of comp?.criterios || []) {
            if (crit?.tipo !== 'imagen') continue;
            for (const val of crit?.valores || []) {
                const id = String(val?.imagen?.driveFileId || '').trim();
                if (id) ids.push(id);
            }
        }
    }
    return [...new Set(ids)];
}

async function asegurarImagenEnCarpetaImagenes(fileId) {
    const id = String(fileId || '').trim();
    if (!id) return false;
    try {
        await driveService.moverArchivoDrive(id, CARPETA_IMAGENES_DRIVE_ID);
        return true;
    } catch (err) {
        console.warn(`[SGC-F-28] No se pudo mover imagen ${id} a Imágenes:`, err.message);
        return false;
    }
}

async function migrarImagenesACarpetaImagenes(datos = null) {
    let movidas = 0;
    for (const id of recolectarDriveFileIdsImagenes(datos)) {
        if (await asegurarImagenEnCarpetaImagenes(id)) movidas += 1;
    }

    try {
        const sueltos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
        const imagenesSueltas = (sueltos || []).filter(esArchivoImagenDrive);
        for (const archivo of imagenesSueltas) {
            if (await asegurarImagenEnCarpetaImagenes(archivo.id)) {
                movidas += 1;
                console.log(`[SGC-F-28] Imagen suelta movida a Imágenes: ${archivo.name}`);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-28] No se pudieron listar imágenes sueltas en SGC-F:', err.message);
    }

    if (movidas > 0) {
        console.log(`[SGC-F-28] ${movidas} imagen(es) asegurada(s) en carpeta Imágenes`);
    }
    return movidas;
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
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/**
 * Garantiza el archivo sistema (nunca la plantilla externa).
 */
async function asegurarArchivoSistema(pool, registro) {
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        const error = new Error(
            'No se encontró el archivo sistema SGC-F-28 en Drive. '
            + `Verifica el ID ${DRIVE_FILE_ID_SISTEMA} y el acceso de la cuenta de servicio.`
        );
        error.statusCode = 404;
        throw error;
    }
    if (driveFileId !== registro?.drive_file_id) {
        const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
            fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    return driveFileId;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMysqlMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    let driveId = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA || null;
    if (esIdPlantillaMaestra(driveId)) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaComparativa(datos);

    if (driveId && hojaEditor && hojaEditor !== 'Sin-nombre') {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SGC-F-28] No se pudo resolver gid de hoja editor:', err.message);
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
        tiposCriterio: TIPOS_CRITERIO.map((t) => ({ tipo: t, etiqueta: ETIQUETAS_TIPO[t] })),
        monedas: MONEDAS,
        resultados: RESULTADOS.filter(Boolean)
    };
}

async function procesarImagenesAntesDeGuardar(datos) {
    const meta = sanitizarDatos(datos);
    for (const comp of meta.comparativas) {
        for (const crit of comp.criterios) {
            if (crit.tipo !== 'imagen') continue;
            for (const val of crit.valores) {
                if (!val.imagen) continue;
                if (val.imagen.driveFileId && !val.imagen.base64 && !val.imagen.dataUrl) continue;
                try {
                    const previewLocal = val.imagen.dataUrl || null;
                    const subida = await subirImagenCriterio(val.imagen);
                    if (subida?.driveFileId) {
                        val.imagen = {
                            driveFileId: subida.driveFileId,
                            // Conservar preview corto para respuestas; en Excel se usa Drive.
                            base64: null,
                            dataUrl: previewLocal && previewLocal.length < 900_000 ? previewLocal : null,
                            mimeType: val.imagen.mimeType || 'image/jpeg',
                            nombreArchivo: val.imagen.nombreArchivo || 'imagen.jpg'
                        };
                    }
                } catch (err) {
                    console.warn('[SGC-F-28] Subida imagen pre-guardado:', err.message);
                }
            }
        }
    }
    return meta;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;
    const datosDb = await leerDatosRegistro(registro);

    const driveFileId = await asegurarArchivoSistema(pool, registro).catch(() => null);
    if (driveFileId) {
        registro = await obtenerRegistroDb(pool);
    }

    if (datosDb) {
        datos = datosDb;
    } else {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    }

    await migrarImagenesACarpetaImagenes(datos).catch((err) => {
        console.warn('[SGC-F-28] Migración de imágenes al cargar:', err.message);
    });

    return construirRespuesta(registro, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaComparativa(datos)
    });
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    let datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;

    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    datosEntrada = await procesarImagenesAntesDeGuardar(datosEntrada);
    await migrarImagenesACarpetaImagenes(datosEntrada).catch((err) => {
        console.warn('[SGC-F-28] Migración de imágenes al guardar:', err.message);
    });

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
    let driveId = null;
    try {
        driveId = await asegurarArchivoSistema(pool, registroPrevio);
    } catch (err) {
        console.warn('[SGC-F-28] Archivo sistema no disponible:', err.message);
    }

    if (!huboCambio && driveId) {
        let hojaEditor = resolverNombreHojaComparativa(datosEntrada);
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const sync = await sincronizarHojasComparativasEnDrive(driveId, datosEntrada, datosPrevios);
                if (sync?.datos) datosEntrada = sync.datos;
                hojaEditor = sync?.hojaActiva || hojaEditor;
            }
        } catch (err) {
            console.warn('[SGC-F-28] Re-sync hojas:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive, { hojaEditor });
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                if (huboCambio && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
                }
                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                const sync = await sincronizarHojasComparativasEnDrive(driveId, datosGuardar, datosPrevios);
                if (sync?.datos) datosGuardar = sync.datos;
                const hojaEditor = sync?.hojaActiva || resolverNombreHojaComparativa(datosGuardar);

                const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive, { hojaEditor });
            }
        } catch (err) {
            console.warn('[SGC-F-28] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA,
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
        hojaEditor: resolverNombreHojaComparativa(datosGuardar)
    });
}

async function leerComparativaDesdeHoja(spreadsheetId, sheetTitle, comparativaBase) {
    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const nCritBase = Math.max(1, (comparativaBase?.criterios || []).length);
    const endRow = CRITERIO_START_ROW + nCritBase + OBS_GAP + OBS_SPAN;
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${String(sheetTitle).replace(/'/g, "''")}'!A6:G${endRow}`,
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    const get = (r0, c0) => String((rows[r0] || [])[c0] || '').trim();

    const proveedores = [];
    for (let i = 0; i < MAX_PROVEEDORES; i++) {
        const c = PROVEEDOR_COLS[i] - 1;
        proveedores.push(sanitizarProveedor({
            nombre: get(1, c),
            procesoProductoServicio: get(2, c),
            fechaCotizacion: get(3, c),
            resultado: '',
            observaciones: ''
        }));
    }

    const criterios = (comparativaBase?.criterios || []).map((crit, idx) => {
        const rowIdx = (CRITERIO_START_ROW - 6) + idx;
        const etiqueta = get(rowIdx, 1) || crit.etiqueta;
        const valores = crit.valores.map((v, j) => {
            const c = PROVEEDOR_COLS[j] - 1;
            const texto = get(rowIdx, c);
            if (crit.tipo === 'imagen') return v;
            if (crit.tipo === 'precio') {
                const n = Number(String(texto).replace(/[^0-9.,-]/g, '').replace(',', '.'));
                return sanitizarValor({ ...v, numero: Number.isFinite(n) ? n : v.numero, texto }, 'precio');
            }
            return sanitizarValor({ ...v, texto }, crit.tipo);
        });
        return sanitizarCriterio({ ...crit, etiqueta, valores });
    });

    const resultadoRowIdx = (CRITERIO_START_ROW - 6) + Math.max(1, criterios.length || nCritBase);
    const obsRowIdx = resultadoRowIdx + OBS_GAP;
    for (let i = 0; i < MAX_PROVEEDORES; i++) {
        const c = PROVEEDOR_COLS[i] - 1;
        proveedores[i].resultado = sanitizarResultado(get(resultadoRowIdx, c));
        proveedores[i].observaciones = get(obsRowIdx, c);
    }

    return sanitizarComparativa({
        ...comparativaBase,
        proveedores,
        criterios
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId;
    try {
        driveFileId = await asegurarArchivoSistema(pool, registro);
    } catch {
        return cargarFormato(pool);
    }

    const archivoDriveInfo = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosPrevios = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const comparativasActualizadas = Array.isArray(datosPrevios.comparativas)
        ? datosPrevios.comparativas.map((c) => ({ ...c }))
        : [];

    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        for (const titulo of titulos) {
            if (!esHojaComparativaSgcF28(titulo)) continue;
            try {
                const idx = comparativasActualizadas.findIndex((c) => {
                    const hojaEsperada = sanitizarNombreHoja(c.nombreHoja)
                        || resolverNombreHojaDesdeComparativa(c);
                    return tituloHojaCoincide(hojaEsperada, titulo)
                        || tituloHojaCoincide(sanitizarNombreHoja(c.nombreCotizacion), titulo);
                });
                if (idx < 0) continue;
                const leida = await leerComparativaDesdeHoja(driveFileId, titulo, comparativasActualizadas[idx]);
                comparativasActualizadas[idx] = sanitizarComparativa({
                    ...leida,
                    id: comparativasActualizadas[idx].id,
                    nombreHoja: titulo
                });
            } catch (err) {
                console.warn(`[SGC-F-28] No se pudo leer hoja "${titulo}":`, err.message);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-28] Listar hojas sync:', err.message);
    }

    const datosDrive = sanitizarDatos({
        ...datosPrevios,
        comparativas: comparativasActualizadas
    });

    if (!contenidoEsEquivalente(datosPrevios, datosDrive)) {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosDrive,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datosDrive, archivoDriveInfo, {
        hojaEditor: resolverNombreHojaComparativa(datosDrive)
    });
}

/**
 * Regenera las hojas del archivero desde la plantilla externa en el archivo sistema.
 * No copia el libro entero ni escribe en la plantilla.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await asegurarArchivoSistema(pool, registro);

    let hojaActiva = resolverNombreHojaComparativa(datos);
    if (datos.comparativas.length) {
        const sync = await sincronizarHojasComparativasEnDrive(driveFileId, datos, null, {
            forzarRecrear: true
        });
        if (sync?.datos) datos = sync.datos;
        hojaActiva = sync?.hojaActiva || hojaActiva;
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta(registroFinal, datos, archivoDrive, { hojaEditor: hojaActiva });
}

/**
 * Exporta la hoja de la comparativa activa (o la indicada) a PDF:
 * horizontal, papel carta, escala «ajustar a la página».
 */
async function descargarPlantillaPdf(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    if (!driveFileId || esIdPlantillaMaestra(driveFileId)) {
        throw new Error('No hay Google Sheet SGC-F-28 (sistema) configurado para exportar a PDF.');
    }

    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const comparativaId = String(opciones.comparativaId || '').trim();
    let datosParaHoja = datos;
    if (comparativaId) {
        const hit = (datos.comparativas || []).find((c) => c.id === comparativaId);
        if (hit) {
            datosParaHoja = datosConComparativaActiva(datos, hit);
        }
    }

    const tituloHoja = resolverNombreHojaComparativa(datosParaHoja);
    if (!tituloHoja || tituloHoja === 'Sin-nombre') {
        const err = new Error('Abre o selecciona una comparativa con nombre para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-28] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        const err = new Error(
            `No se encontró la hoja «${tituloHoja}» en Drive. Guarda la información primero para sincronizar la hoja.`
        );
        err.statusCode = 404;
        throw err;
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        fitToPage: true,
        size: 'letter'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-28 quedó vacía.');
    }

    const nombreSeguro = sanitizarNombreHoja(tituloHoja) || 'Comparativa';
    return {
        buffer: Buffer.from(pdfBuffer),
        nombreArchivo: `SGC-F-28 ${nombreSeguro}.pdf`
    };
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TIPOS_CRITERIO,
    ETIQUETAS_TIPO,
    MONEDAS,
    RESULTADOS,
    CARPETA_IMAGENES_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    sanitizarDatos,
    migrarImagenesACarpetaImagenes
};
