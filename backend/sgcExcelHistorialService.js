/**
 * Historial de hojas Excel/Google Sheets para formatos SGC.
 * - Cambio de formato (filas/columnas): incrementa Revisión/Fecha Rev y archiva hoja corta (alias_rNN).
 * - Cambio de información: archiva hoja CODIGO-FECHA (ej. DGF04-0626) sin tocar revisión.
 */
const driveService = require('./driveService');

const ALIAS_POR_CODIGO = {
    'DG-F-04': 'FODA',
    'DG-F-05': 'Partes',
    'SGC-F-04': 'SGCF04',
    'SGC-F-06': 'SGCF06',
    'SGC-F-18': 'Legal',
    'SGC-F-11': 'AMEF',
    'SGC-F-12': 'Notif',
    'SGC-F-07': 'Audit',
    'SGC-F-08': 'SGCF08',
    'SGC-F-14': 'SGCF14'
};

function fechaAhoraMexicoIso() {
    const ahora = new Date();
    const mexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const y = mexico.getFullYear();
    const m = String(mexico.getMonth() + 1).padStart(2, '0');
    const d = String(mexico.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Formato legacy MM_YY (ej. 06_26). */
function fechaHistorialMmYy(fechaIso) {
    const iso = String(fechaIso || fechaAhoraMexicoIso()).slice(0, 10);
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    return `${mm}_${yy}`;
}

/** Formato vigente MMAA (ej. 0626). */
function fechaHistorialMmaa(fechaIso) {
    const iso = String(fechaIso || fechaAhoraMexicoIso()).slice(0, 10);
    const [, mm] = iso.split('-');
    const aa = iso.slice(2, 4);
    return `${mm}${aa}`;
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function leerMetaHoja(datos) {
    const meta = datos?._metaHoja;
    if (!meta || typeof meta !== 'object') {
        return null;
    }
    const rowCount = Number(meta.rowCount);
    const columnCount = Number(meta.columnCount);
    if (!Number.isFinite(rowCount) || !Number.isFinite(columnCount)) {
        return null;
    }
    return { rowCount, columnCount };
}

function adjuntarMetaHoja(datos, metaHoja) {
    if (!datos || typeof datos !== 'object' || !metaHoja) {
        return datos;
    }
    return {
        ...datos,
        _metaHoja: {
            rowCount: Number(metaHoja.rowCount || 0),
            columnCount: Number(metaHoja.columnCount || 0)
        }
    };
}

function nombreHojaHistorialFormato(alias, revisionAnterior) {
    const rev = String(revisionAnterior || '00').trim().padStart(2, '0');
    return `${alias}_r${rev}`;
}

/** DG-F-04 → DGF04, SGC-F-18 → SGCF18 */
function codigoHistorialBase(codigoFormato) {
    const partes = String(codigoFormato || '').trim().split('-').filter(Boolean);
    if (partes.length >= 3 && partes[1].toUpperCase() === 'F') {
        return `${partes[0]}${partes[1]}${partes[2]}`.toUpperCase();
    }
    if (partes.length >= 2) {
        return `${partes[0]}_${partes[1]}`;
    }
    return String(codigoFormato || 'Hist').replace(/-/g, '_');
}

/** Formato legacy: DG-F-04 → DG_04 */
function codigoHistorialBaseLegacy(codigoFormato) {
    const partes = String(codigoFormato || '').trim().split('-').filter(Boolean);
    if (partes.length >= 3 && partes[1].toUpperCase() === 'F') {
        return `${partes[0]}_${partes[2]}`;
    }
    if (partes.length >= 2) {
        return `${partes[0]}_${partes[1]}`;
    }
    return String(codigoFormato || 'Hist').replace(/-/g, '_');
}

function fechaHistorialSufijo(codigoFormato, fechaIso) {
    void codigoFormato;
    return fechaHistorialMmaa(fechaIso);
}

function nombreHojaHistorialInformacion(codigoFormato, fechaIso) {
    return `${codigoHistorialBase(codigoFormato)}-${fechaHistorialSufijo(codigoFormato, fechaIso)}`;
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esHojaHistorialInformacion(titulo, codigoFormato) {
    const t = String(titulo || '').trim();
    const base = codigoHistorialBase(codigoFormato);
    const baseLegacy = codigoHistorialBaseLegacy(codigoFormato);
    const patronVigente = new RegExp(`^${escaparRegex(base)}-\\d{4}$`, 'i');
    if (patronVigente.test(t)) {
        return true;
    }
    const patronLegacyBase = new RegExp(`^${escaparRegex(baseLegacy)}-\\d{2}_\\d{2}$`, 'i');
    if (patronLegacyBase.test(t)) {
        return true;
    }
    const patronLegacyCodigo = new RegExp(`^${escaparRegex(codigoFormato)}_\\d{2}_\\d{2}$`, 'i');
    return patronLegacyCodigo.test(t);
}

function esHojaHistorialFormato(titulo, codigoFormato) {
    const alias = resolverAlias(codigoFormato);
    return new RegExp(`^${escaparRegex(alias)}_r\\d+$`, 'i').test(String(titulo || '').trim());
}

function esHojaHistorial(titulo, codigoFormato) {
    return esHojaHistorialInformacion(titulo, codigoFormato)
        || esHojaHistorialFormato(titulo, codigoFormato);
}

function parsearFechaHojaHistorial(titulo, codigoFormato) {
    const t = String(titulo || '').trim();
    const base = codigoHistorialBase(codigoFormato);
    const baseLegacy = codigoHistorialBaseLegacy(codigoFormato);

    let match = t.match(new RegExp(`^${escaparRegex(base)}-(\\d{2})(\\d{2})$`, 'i'));
    if (!match) {
        match = t.match(new RegExp(`^${escaparRegex(baseLegacy)}-(\\d{2})_(\\d{2})$`, 'i'));
    }
    if (!match) {
        match = t.match(new RegExp(`^${escaparRegex(codigoFormato)}_(\\d{2})_(\\d{2})$`, 'i'));
    }
    if (!match) {
        return null;
    }
    const mm = match[1];
    const yy = match[2];
    return {
        mm,
        yy,
        sortKey: Number(`20${yy}`) * 100 + Number(mm)
    };
}

function resolverTituloHojaVigente(titulos, sheetTitle, codigoFormato) {
    const lista = Array.isArray(titulos) ? titulos : [];
    const historiales = lista
        .filter((titulo) => esHojaHistorialInformacion(titulo, codigoFormato))
        .map((titulo) => ({
            titulo,
            fecha: parsearFechaHojaHistorial(titulo, codigoFormato)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);

    if (historiales.length) {
        return historiales[0].titulo;
    }
    return String(sheetTitle || '').trim();
}

async function resolverTituloHojaVigenteDesdeDrive(spreadsheetId, sheetTitle, codigoFormato) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    return resolverTituloHojaVigente(titulos, sheetTitle, codigoFormato);
}

function resolverHojaPorTitulo(wb, titulo) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    const buscado = String(titulo || '').trim();
    if (!buscado) {
        return null;
    }
    const exacta = lista.find((ws) => String(ws.name || '').trim() === buscado);
    if (exacta) {
        return exacta;
    }
    const norm = buscado.toLowerCase();
    return lista.find((ws) => String(ws.name || '').trim().toLowerCase() === norm) || null;
}

/**
 * Hoja vigente para presentar en el sistema: la versión fechada más reciente.
 */
function obtenerHojaActivaDesdeWorkbook(wb, sheetTitle, codigoFormato) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) {
        return null;
    }
    const tituloVigente = resolverTituloHojaVigente(
        lista.map((ws) => ws.name),
        sheetTitle,
        codigoFormato
    );
    return resolverHojaPorTitulo(wb, tituloVigente) || lista[0] || null;
}

/** Hoja de edición en el editor integrado (plantilla base, p. ej. Analisis FODA). */
function obtenerHojaEdicionDesdeWorkbook(wb, sheetTitle) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) {
        return null;
    }
    return resolverHojaPorTitulo(wb, sheetTitle) || lista[0] || null;
}

function resolverAlias(codigoFormato) {
    return ALIAS_POR_CODIGO[codigoFormato] || String(codigoFormato || 'Hist').replace(/-/g, '');
}

/**
 * Clasifica el tipo de cambio entre dos snapshots de datos.
 * @returns {'ninguno'|'informacion'|'formato'}
 */
function clasificarTipoCambio({
    datosPrevios,
    datosNuevos,
    contenidoEsEquivalente,
    estructuraEsEquivalente,
    metaHojaPrevia = null,
    metaHojaNueva = null
}) {
    if (!datosPrevios || !datosNuevos) {
        return 'ninguno';
    }
    if (contenidoEsEquivalente(datosPrevios, datosNuevos)) {
        const metaCambio = metaHojaPrevia && metaHojaNueva && (
            metaHojaPrevia.rowCount !== metaHojaNueva.rowCount
            || metaHojaPrevia.columnCount !== metaHojaNueva.columnCount
        );
        return metaCambio ? 'formato' : 'ninguno';
    }
    const estructuraCambio = !estructuraEsEquivalente(datosPrevios, datosNuevos);
    const metaCambio = metaHojaPrevia && metaHojaNueva && (
        metaHojaPrevia.rowCount !== metaHojaNueva.rowCount
        || metaHojaPrevia.columnCount !== metaHojaNueva.columnCount
    );
    if (estructuraCambio || metaCambio) {
        return 'formato';
    }
    return 'informacion';
}

function estructuraFilasEquivalente(a, b, campoFilas = 'filas') {
    const fa = Array.isArray(a?.[campoFilas]) ? a[campoFilas].length : 0;
    const fb = Array.isArray(b?.[campoFilas]) ? b[campoFilas].length : 0;
    return fa === fb;
}

function estructuraSeccionesDgF04Equivalente(a, b, secciones = []) {
    return secciones.every((key) => {
        const fa = Array.isArray(a?.[key]) ? a[key].length : 0;
        const fb = Array.isArray(b?.[key]) ? b[key].length : 0;
        return fa === fb;
    });
}

/**
 * Archiva snapshot anterior en nueva hoja y calcula revisión si aplica.
 */
const HOJAS_CRITERIOS_DG_F04 = [
    'Criterios Debilidades-Amenazas',
    'Criterios Oportunidades'
];

async function aplicarHistorialEnDrive({
    codigoFormato,
    spreadsheetId,
    sheetActiva,
    datosPrevios,
    datosNuevos,
    contenidoEsEquivalente,
    estructuraEsEquivalente,
    escribirSnapshotEnHoja,
    hojasAEliminar = [],
    origen = 'sistema',
    forzarTipo = null,
    usarHojaVigenteComoOrigen = false,
    resolverNombreHistorial = null
}) {
    if (!spreadsheetId || !sheetActiva || origen === 'consulta') {
        return {
            aplicado: false,
            tipoCambio: 'ninguno',
            datosGuardar: datosNuevos,
            metaHojaNueva: null
        };
    }

    const metaHojaPrevia = leerMetaHoja(datosPrevios);
    let metaHojaNueva = null;
    try {
        metaHojaNueva = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, sheetActiva);
    } catch (err) {
        console.warn(`[${codigoFormato}] No se pudieron leer dimensiones de hoja:`, err.message);
    }

    const tipoCambio = forzarTipo || clasificarTipoCambio({
        datosPrevios,
        datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        metaHojaPrevia,
        metaHojaNueva
    });

    if (tipoCambio === 'ninguno' || !datosPrevios) {
        return {
            aplicado: false,
            tipoCambio: 'ninguno',
            datosGuardar: adjuntarMetaHoja(datosNuevos, metaHojaNueva),
            metaHojaNueva
        };
    }

    const alias = resolverAlias(codigoFormato);
    const revisionAnterior = String(
        datosPrevios.revision || datosNuevos.revision || '00'
    ).trim().padStart(2, '0');
    let revision = revisionAnterior;
    let fechaRevision = String(
        datosPrevios.fechaRevision || datosNuevos.fechaRevision || ''
    ).trim();

    if (tipoCambio === 'formato') {
        revision = incrementarRevision(revisionAnterior);
        fechaRevision = fechaAhoraMexicoIso();
    }

    let nombreHistorial = tipoCambio === 'formato'
        ? nombreHojaHistorialFormato(alias, revisionAnterior)
        : nombreHojaHistorialInformacion(codigoFormato, fechaAhoraMexicoIso());

    if (typeof resolverNombreHistorial === 'function') {
        const sugerido = String(resolverNombreHistorial({
            tipoCambio,
            codigoFormato,
            alias,
            revisionAnterior,
            datosPrevios,
            datosNuevos
        }) || '').trim();
        if (sugerido) {
            nombreHistorial = sugerido;
        }
    }

    let hojaOrigen = sheetActiva;
    if (usarHojaVigenteComoOrigen) {
        try {
            hojaOrigen = await resolverTituloHojaVigenteDesdeDrive(
                spreadsheetId,
                sheetActiva,
                codigoFormato
            );
        } catch (err) {
            console.warn(`[${codigoFormato}] No se pudo resolver hoja vigente:`, err.message);
        }
    }

    let hojaVigente = hojaOrigen;
    let historialCreado = false;
    let nombreHistorialFinal = null;
    const nombreNorm = String(nombreHistorial).trim();
    const hojaOrigenNorm = String(hojaOrigen).trim();
    let titulosExistentes = [];
    try {
        titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn(`[${codigoFormato}] No se pudieron listar hojas:`, err.message);
    }
    const yaExisteHistorial = titulosExistentes.includes(nombreNorm);
    const origenEsHojaMes = hojaOrigenNorm === nombreNorm;
    const reutilizarHojaMes = tipoCambio === 'informacion' && (yaExisteHistorial || origenEsHojaMes);

    if (reutilizarHojaMes) {
        const duplicados = titulosExistentes.filter((titulo) => {
            const t = String(titulo || '').trim();
            return t !== nombreNorm && new RegExp(`^${escaparRegex(nombreNorm)}_\\d+$`, 'i').test(t);
        });
        if (duplicados.length) {
            try {
                await driveService.eliminarHojasGoogleSheet(spreadsheetId, duplicados);
            } catch (err) {
                console.warn(`[${codigoFormato}] No se pudieron eliminar hojas duplicadas:`, err.message);
            }
        }

        hojaVigente = nombreNorm;
        nombreHistorialFinal = nombreNorm;
        historialCreado = true;

        if (typeof escribirSnapshotEnHoja === 'function') {
            try {
                await escribirSnapshotEnHoja(spreadsheetId, nombreNorm, datosNuevos);
            } catch (err) {
                console.warn(`[${codigoFormato}] No se pudo actualizar hoja "${nombreNorm}":`, err.message);
                historialCreado = false;
            }
        }

        try {
            metaHojaNueva = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, nombreNorm);
        } catch (err) {
            console.warn(`[${codigoFormato}] No se pudieron leer dimensiones de "${nombreNorm}":`, err.message);
        }
    } else {
        try {
            const { title: hojaNueva } = await driveService.duplicarHojaGoogleSheet(
                spreadsheetId,
                hojaOrigen,
                nombreHistorial
            );
            hojaVigente = hojaNueva;
            nombreHistorialFinal = hojaNueva;
            historialCreado = true;

            const eliminar = Array.isArray(hojasAEliminar) ? hojasAEliminar.filter(Boolean) : [];
            if (eliminar.length) {
                await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
            }

            if (typeof escribirSnapshotEnHoja === 'function') {
                await escribirSnapshotEnHoja(spreadsheetId, hojaNueva, datosNuevos);
            }

            try {
                metaHojaNueva = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, hojaNueva);
            } catch (err) {
                console.warn(`[${codigoFormato}] No se pudieron leer dimensiones de "${hojaNueva}":`, err.message);
            }
        } catch (err) {
            console.warn(`[${codigoFormato}] No se pudo crear versión "${nombreHistorial}":`, err.message);
        }
    }

    const datosGuardar = adjuntarMetaHoja({
        ...datosNuevos,
        revision,
        fechaRevision
    }, metaHojaNueva);

    return {
        aplicado: historialCreado,
        tipoCambio,
        datosGuardar,
        metaHojaNueva,
        nombreHistorial: nombreHistorialFinal,
        hojaVigente
    };
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

function valorCeldaExcel(cell) {
    const val = cell?.value;
    if (val == null) {
        return '';
    }
    if (val instanceof Date) {
        const d = val.getDate();
        const m = val.getMonth() + 1;
        const y = val.getFullYear();
        return `${d}/${m}/${y}`;
    }
    if (typeof val === 'object') {
        if (val.richText) {
            return val.richText.map((p) => p.text || '').join('');
        }
        if (val.formula) {
            return String(val.result ?? val.formula);
        }
        if (val.text) {
            return String(val.text);
        }
        if (val.hyperlink) {
            return String(val.text || val.hyperlink || '');
        }
    }
    return String(val);
}

/**
 * Escribe en una hoja de Google Sheet los valores de un buffer XLSX generado desde plantilla.
 */
async function escribirSnapshotDesdeBufferPlantilla(spreadsheetId, sheetTitle, bufferPlantilla) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferPlantilla);
    const ws = wb.worksheets[0];
    if (!ws) {
        return;
    }

    const titulo = String(sheetTitle || '').trim();
    const actualizaciones = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const texto = valorCeldaExcel(cell);
            if (!texto) {
                return;
            }
            actualizaciones.push({
                range: `'${titulo}'!${columnaALetra(colNumber)}${rowNumber}`,
                values: [[texto]]
            });
        });
    });

    const CHUNK = 400;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(
            spreadsheetId,
            actualizaciones.slice(i, i + CHUNK)
        );
    }
}

module.exports = {
    ALIAS_POR_CODIGO,
    fechaAhoraMexicoIso,
    fechaHistorialMmYy,
    fechaHistorialMmaa,
    fechaHistorialSufijo,
    codigoHistorialBaseLegacy,
    incrementarRevision,
    leerMetaHoja,
    adjuntarMetaHoja,
    clasificarTipoCambio,
    estructuraFilasEquivalente,
    estructuraSeccionesDgF04Equivalente,
    aplicarHistorialEnDrive,
    nombreHojaHistorialFormato,
    nombreHojaHistorialInformacion,
    codigoHistorialBase,
    esHojaHistorial,
    esHojaHistorialInformacion,
    parsearFechaHojaHistorial,
    HOJAS_CRITERIOS_DG_F04,
    obtenerHojaActivaDesdeWorkbook,
    obtenerHojaEdicionDesdeWorkbook,
    resolverTituloHojaVigente,
    resolverTituloHojaVigenteDesdeDrive,
    resolverAlias,
    escribirSnapshotDesdeBufferPlantilla
};
