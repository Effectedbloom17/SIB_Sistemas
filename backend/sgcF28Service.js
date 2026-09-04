/**
 * SGC-F-28 · Comparativa de proveedores — persistencia en biznaga_sgc y sync con Drive.
 * Arquetipo: SGC-F-04 (una hoja por comparativa, nombrada por «nombre de cotización»).
 *
 * Plantilla: hoja «Plantilla», columnas A–G (5 proveedores en C–G).
 * Criterios dinámicos a partir de la fila 12; Resultado y Observaciones se desplazan.
 */
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-28';
const TEMPLATE_DRIVE_ID = '1PxxA5U1Z0tOpbaj1eH8agdxOuQVgF8ya8VU2Uc9BhOI';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** Historial de Documentos > SGC-F-28 > Imagenes */
const CARPETA_IMAGENES_DRIVE_ID = '1r04mGmTXHWlj7R6CY-gnXWT2hR_uMWLN';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-28 Comparativa de proveedores (sistema)';
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
    'material'
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
    material: 'Material'
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
        criterios: []
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
        criterios
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

function resolverNombreHojaComparativa(datos) {
    const comp = resolverComparativaActiva(sanitizarDatos(datos));
    const nombre = sanitizarNombreHoja(comp?.nombreCotizacion);
    if (nombre) return nombre;
    const id = String(comp?.id || '').trim();
    if (id) return `BORRADOR-${id.slice(0, 8)}`;
    return 'Sin-nombre';
}

function esHojaComparativaSgcF28(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    if (/^SGCF28/i.test(t)) return false;
    return true;
}

function softWrapTextoExcel(texto, cada = 40) {
    const t = String(texto || '').replace(/\r\n/g, '\n').trim();
    if (!t || t.includes('\n') || t.length <= cada) {
        return t;
    }
    const partes = [];
    for (let i = 0; i < t.length; i += cada) {
        partes.push(t.slice(i, i + cada));
    }
    return partes.join('\n');
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
        return softWrapTextoExcel(valor.texto || '', 28);
    }
    return softWrapTextoExcel(valor.texto || '', 42);
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
        pushUpdate(actualizaciones, 7, col, p.nombre || '', sheetTitle);
        pushUpdate(actualizaciones, 8, col, p.procesoProductoServicio || '', sheetTitle);
        pushUpdate(actualizaciones, 9, col, formatearFechaDisplay(p.fechaCotizacion), sheetTitle);
        pushUpdate(actualizaciones, resultadoRow, col, p.resultado || '', sheetTitle);
        // Observaciones: conservar saltos; si es un bloque largo sin \n, partirlo.
        const obs = softWrapTextoExcel(p.observaciones || '', 48);
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

async function asegurarFilasCriterios(spreadsheetId, sheetTitle, numCriterios) {
    const n = Math.max(1, Math.min(MAX_CRITERIO_ROWS, Number(numCriterios) || 1));
    const extra = n - 1; // plantilla ya tiene 1 fila de criterio
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        throw new Error(`Hoja "${sheetTitle}" no encontrada`);
    }
    if (extra > 0) {
        // Insertar antes de Resultado (fila 13 → índice 12)
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, CRITERIO_START_ROW, extra, {
            inheritFromBefore: true
        });
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

        // Criterios por fila (tipografía / alto específicos)
        const criterios = comparativa?.criterios || [];
        for (let i = 0; i < nCrit; i++) {
            const tipo = criterios[i]?.tipo;
            const rowIndex = CRITERIO_START_ROW - 1 + i;
            const fontSize = tipo === 'liga_compra' ? 9 : 10;
            const pixelSize = tipo === 'liga_compra' ? 80 : (tipo === 'imagen' ? 120 : 36);
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

        // Observaciones: Centro + Medio + Ajuste
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
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: obsRow - 1,
                    endIndex: obsRow + 2
                },
                properties: { pixelSize: 40 },
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

async function recrearHojaComparativa(spreadsheetId, nombreHoja, datosConActiva) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    if (titulos.includes(nombreHoja)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [nombreHoja]);
        } catch (err) {
            console.warn(`[SGC-F-28] No se pudo eliminar hoja previa ${nombreHoja}:`, err.message);
        }
    }
    const origen = driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /plantilla/i })
        || SHEET_TITLE;
    const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, origen, nombreHoja);
    const tituloFinal = dup.title || nombreHoja;
    const comp = resolverComparativaActiva(datosConActiva);
    const nCrit = Math.max(1, (comp.criterios || []).length);
    const layout = await asegurarFilasCriterios(spreadsheetId, tituloFinal, nCrit);
    await actualizarDatosEnGoogleSheet(spreadsheetId, datosConActiva, tituloFinal);
    await insertarImagenesComparativa(spreadsheetId, tituloFinal, layout.sheetId, comp);
    return tituloFinal;
}

async function sincronizarHojasComparativasEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    );

    if (!plantillaOrigen) {
        console.warn(
            '[SGC-F-28] Hoja plantilla «Plantilla» no encontrada en el spreadsheet. '
            + `Hojas: ${titulosExistentes.join(', ') || '(ninguna)'}`
        );
    }

    const mapaIdHojaPrevio = new Map();
    if (prev?.comparativas) {
        for (const c of prev.comparativas) {
            mapaIdHojaPrevio.set(c.id, resolverNombreHojaComparativa(datosConComparativaActiva(meta, c)));
        }
    }

    const hojasActivas = new Set();

    for (const comparativa of meta.comparativas) {
        if (!comparativaTieneContenido(comparativa)) continue;

        let nombreHoja = resolverNombreHojaComparativa(datosConComparativaActiva(meta, comparativa));
        const hojaPrev = mapaIdHojaPrevio.get(comparativa.id);

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                await driveService.eliminarHojasGoogleSheet(spreadsheetId, [hojaPrev]);
                setExistentes.delete(hojaPrev);
            } catch (err) {
                console.warn(`[SGC-F-28] No se pudo eliminar hoja previa ${hojaPrev}:`, err.message);
            }
        }

        try {
            const tituloFinal = await recrearHojaComparativa(
                spreadsheetId,
                nombreHoja,
                datosConComparativaActiva(meta, comparativa)
            );
            nombreHoja = tituloFinal;
            setExistentes.add(nombreHoja);
            hojasActivas.add(nombreHoja);
        } catch (err) {
            console.warn(`[SGC-F-28] No se pudo sincronizar hoja "${nombreHoja}":`, err.message);
        }
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaComparativaSgcF28(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    // También eliminar hojas que recreamos (ya no están en titulosExistentes originales si se borraron)
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-28] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return hojasActivas;
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
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
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
    if (idDb && !esIdPlantillaMaestra(idDb)) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && await archivoEstaEnCarpeta(idDb, CARPETA_DRIVE_ID)) {
            return idDb;
        }
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
}

async function crearCopiaPlantillaEnCarpeta(pool, registro = null) {
    const existePlantilla = TEMPLATE_DRIVE_ID
        ? await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false)
        : false;
    if (!existePlantilla) {
        throw new Error(
            'Plantilla SGC-F-28 no encontrada en Drive. Compártela con la cuenta del sistema (risktechbiznaga@gmail.com) como Editor.'
        );
    }
    const copia = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (pool && copia?.id && registro) {
        await guardarRegistroDb(pool, {
            driveFileId: copia.id,
            datos: await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original),
            fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    return copia;
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
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

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
    const driveId = registroPrevio?.drive_file_id || await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                await sincronizarHojasComparativasEnDrive(driveId, datosEntrada, datosPrevios);
            }
        } catch (err) {
            console.warn('[SGC-F-28] Re-sync hojas:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive, {
            hojaEditor: resolverNombreHojaComparativa(datosEntrada)
        });
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

                await sincronizarHojasComparativasEnDrive(driveId, datosGuardar, datosPrevios);

                const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive, {
                    hojaEditor: resolverNombreHojaComparativa(datosGuardar)
                });
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

    let archivoDrive = null;
    try {
        const copia = await crearCopiaPlantillaEnCarpeta(pool, registroPrevio);
        await sincronizarHojasComparativasEnDrive(copia.id, datosGuardar, datosPrevios);
        archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
    } catch (err) {
        console.warn('[SGC-F-28] Sync Drive omitida; se guarda en BD:', err.message || err);
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive?.id || driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
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
                    const hojaEsperada = resolverNombreHojaComparativa(datosConComparativaActiva(datosPrevios, c));
                    return hojaEsperada === titulo
                        || sanitizarNombreHoja(c.nombreCotizacion) === sanitizarNombreHoja(titulo);
                });
                if (idx < 0) continue;
                const leida = await leerComparativaDesdeHoja(driveFileId, titulo, comparativasActualizadas[idx]);
                comparativasActualizadas[idx] = sanitizarComparativa({
                    ...leida,
                    id: comparativasActualizadas[idx].id
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

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);

    const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
    await sincronizarHojasComparativasEnDrive(copia.id, datos, null);

    await guardarRegistroDb(pool, {
        driveFileId: copia.id,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
    return construirRespuesta(registroFinal, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaComparativa(datos)
    });
}

module.exports = {
    CODIGO_FORMATO,
    TIPOS_CRITERIO,
    ETIQUETAS_TIPO,
    MONEDAS,
    RESULTADOS,
    CARPETA_IMAGENES_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos,
    migrarImagenesACarpetaImagenes
};
