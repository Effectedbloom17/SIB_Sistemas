/**
 * ATH-F-14 · Control de vacaciones.
 * Plantilla externa (solo diseño) + archivo sistema (historial ATHF14-MMAA / _N + histograma).
 * Sin archivero. Patrón: sgcDgF05Service / sgcF19Service.
 *
 * Layout (hoja «Plantilla», columnas A–G):
 *   Encabezado filas 1–3 · encabezados fila 5 · datos desde fila 6
 *   A nombre · B ingreso · C antigüedad · D disponibles · E tomados · F restantes · G periodo
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-14';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1nKn62UggYGS16Wx_sl0t8ZfunixTdixrsW43L7aDWwk
 */
const TEMPLATE_DRIVE_ID = '1nKn62UggYGS16Wx_sl0t8ZfunixTdixrsW43L7aDWwk';
/**
 * Archivo de trabajo Centro SGC (historial ATHF14-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1Fxn1FNWcByT3RcinuVmmf4IgPR4g1AVksYF149-YvBc
 */
const DRIVE_FILE_ID_SISTEMA = '1Fxn1FNWcByT3RcinuVmmf4IgPR4g1AVksYF149-YvBc';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'ATH-F-14 Control de vacaciones (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback legado; el trabajo real usa ATHF14-MMAA(_N). */
const SHEET_TITLE_LEGACY = ['Plantilla', 'Hoja1'];
const DATA_START_ROW = 6;
const CLEAR_ROWS = 200;
const MAX_COLUMNAS_SISTEMA = 7;
const ROW_HEIGHT = 21;
const COLUMN_WIDTHS = [252, 117, 110, 128, 100, 158, 134];
const BORDE_SOLIDO = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
const BORDE_NULO = { style: 'NONE' };

const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2026-03-17',
    filas: []
};

/** Nombre de hoja base del mes actual (ATHF14-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso();
}

function isoDePartes(anio, mes, dia) {
    if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
    const d = new Date(anio, mes - 1, dia);
    if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return '';
    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    return `${anio}-${mm}-${dd}`;
}

function parseFechaLibre(valor) {
    const raw = String(valor || '').trim();
    if (!raw) return '';
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return isoDePartes(+iso[1], +iso[2], +iso[3]);
    const corta = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (corta) {
        let anio = +corta[3];
        if (anio < 100) anio += 2000;
        return isoDePartes(anio, +corta[2], +corta[1]);
    }
    const t = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const larga = t.match(/(\d{1,2})\s+de\s+([a-z]+)(?:\s+de)?\s+(\d{4})/);
    if (larga && MESES[larga[2]]) return isoDePartes(+larga[3], MESES[larga[2]], +larga[1]);
    const mesAnio = t.match(/^([a-z]{3,})-(\d{2,4})$/);
    if (mesAnio && MESES[mesAnio[1]]) {
        let anio = +mesAnio[2];
        if (anio < 100) anio += 2000;
        return isoDePartes(anio, MESES[mesAnio[1]], 1);
    }
    return '';
}

function formatearFechaCorta(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
        const y = fecha.getFullYear();
        const mo = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    }
    return parseFechaLibre(fecha) || String(fecha || '').trim();
}

function etiquetaAntiguedad(iso, hoy = new Date()) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const ingreso = new Date(+m[1], +m[2] - 1, +m[3]);
    if (Number.isNaN(ingreso.getTime())) return '';
    let meses = (hoy.getFullYear() - ingreso.getFullYear()) * 12 + (hoy.getMonth() - ingreso.getMonth());
    if (hoy.getDate() < ingreso.getDate()) meses -= 1;
    if (meses < 0) meses = 0;
    const anios = Math.floor(meses / 12);
    const resto = meses % 12;
    const txtAnios = anios === 1 ? '1 año' : `${anios} años`;
    const txtMeses = resto === 1 ? '1 mes' : `${resto} meses`;
    if (anios && resto) return `${txtAnios} ${txtMeses}`;
    if (anios) return txtAnios;
    return txtMeses;
}

function numeroDias(valor) {
    const n = parseInt(String(valor ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function claveNombre(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/^(ing|mtro|mtra|dr|dra|doc|lic|prof|arq|c)\.?\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizarFila(raw) {
    const nombre = String(raw?.nombreCompleto || raw?.nombre || '').trim();
    const fechaIngreso = parseFechaLibre(raw?.fechaIngreso || raw?.fecha_ingreso || '');
    return {
        nombreCompleto: nombre,
        fechaIngreso,
        diasDisponibles: numeroDias(raw?.diasDisponibles ?? raw?.dias_disponibles)
    };
}

function sanitizarDatos(raw) {
    const lista = Array.isArray(raw?.filas) ? raw.filas : [];
    const filas = [];
    const vistos = new Set();
    for (const item of lista) {
        const fila = sanitizarFila(item);
        const key = claveNombre(fila.nombreCompleto);
        if (!key || vistos.has(key)) continue;
        vistos.add(key);
        filas.push(fila);
    }
    return {
        revision: String(raw?.revision || DATOS_DEFECTO.revision).trim() || '00',
        fechaRevision: formatearFechaIso(raw?.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        filas,
        _metaHoja: raw?._metaHoja || null
    };
}

function firmaContenido(datos) {
    const d = sanitizarDatos(datos || {});
    return {
        filas: d.filas.map((f) => ({
            nombreCompleto: f.nombreCompleto,
            fechaIngreso: f.fechaIngreso,
            diasDisponibles: f.diasDisponibles
        }))
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(firmaContenido(a)) === JSON.stringify(firmaContenido(b));
}

function estructuraEsEquivalente() {
    return true;
}

function rango(titulo, a1) {
    return `'${String(titulo).replace(/'/g, "''")}'!${a1}`;
}

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
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

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) return DRIVE_FILE_ID_SISTEMA;
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) return enCarpeta.id;
    return DRIVE_FILE_ID_SISTEMA || null;
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/** Última versión del mes: ATHF14-1026_3 > ATHF14-1026_2 > ATHF14-1026. */
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

async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            rango(sheetTitle, 'A5:G5')
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const unidos = row.map((c) => String(c || '').toLowerCase()).join(' ');
        return unidos.includes('nombre')
            && (unidos.includes('ingreso') || unidos.includes('disponib') || unidos.includes('antig'));
    } catch (err) {
        console.warn('[ATH-F-14] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[ATH-F-14] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
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
        console.warn('[ATH-F-14] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados de control de vacaciones).`
        );
    }
    return copiada.title;
}

function filaParaHoja(fila) {
    const base = sanitizarFila(fila);
    if (!base.nombreCompleto) return null;
    const diasTomados = numeroDias(fila?.diasTomados ?? fila?.dias_tomados);
    const vacaciones = String(fila?.fechaVacaciones || fila?.fecha_vacaciones || '').trim();
    return [
        base.nombreCompleto,
        formatearFechaCorta(base.fechaIngreso),
        etiquetaAntiguedad(base.fechaIngreso),
        base.diasDisponibles,
        diasTomados,
        Math.max(0, base.diasDisponibles - diasTomados),
        vacaciones
    ];
}

/** Filas de captura (pueden traer días tomados / periodo desde la UI). */
function filasCapturaDesde(raw) {
    const lista = Array.isArray(raw) ? raw : [];
    const out = [];
    const vistos = new Set();
    for (const item of lista) {
        const celdas = filaParaHoja(item);
        if (!celdas) continue;
        const key = claveNombre(celdas[0]);
        if (!key || vistos.has(key)) continue;
        vistos.add(key);
        out.push({ raw: item, celdas });
    }
    return out;
}

async function obtenerSheetIdPorTitulo(spreadsheetId, titulo) {
    const auth = driveService.getAuthClient();
    if (!auth) return null;
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hoja = (meta.data.sheets || []).find(
        (s) => String(s.properties?.title || '').trim() === String(titulo || '').trim()
    );
    return hoja?.properties?.sheetId ?? null;
}

async function aplicarTamanoYBordes(spreadsheetId, titulo, cantidadFilas) {
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, titulo);
    const auth = driveService.getAuthClient();
    if (sheetId == null || !auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    const inicio = DATA_START_ROW - 1;
    const finDatos = inicio + Math.max(0, cantidadFilas);
    const finLimpieza = inicio + CLEAR_ROWS;
    const requests = [
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: inicio, endIndex: finLimpieza },
                properties: { pixelSize: ROW_HEIGHT },
                fields: 'pixelSize'
            }
        },
        ...COLUMN_WIDTHS.map((pixelSize, index) => ({
            updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
                properties: { pixelSize },
                fields: 'pixelSize'
            }
        }))
    ];
    if (cantidadFilas > 0) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: inicio,
                    endRowIndex: finDatos,
                    startColumnIndex: 0,
                    endColumnIndex: 7
                },
                cell: {
                    userEnteredFormat: {
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'OVERFLOW_CELL',
                        textFormat: { fontFamily: 'Calibri', fontSize: 11 },
                        borders: {
                            top: BORDE_SOLIDO,
                            bottom: BORDE_SOLIDO,
                            left: BORDE_SOLIDO,
                            right: BORDE_SOLIDO
                        }
                    }
                },
                fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat,borders)'
            }
        });
    }
    if (finDatos < finLimpieza) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: finDatos,
                    endRowIndex: finLimpieza,
                    startColumnIndex: 0,
                    endColumnIndex: 7
                },
                cell: {
                    userEnteredFormat: {
                        borders: {
                            top: BORDE_NULO,
                            bottom: BORDE_NULO,
                            left: BORDE_NULO,
                            right: BORDE_NULO
                        }
                    }
                },
                fields: 'userEnteredFormat.borders'
            }
        });
    }
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

async function escribirEnHoja(spreadsheetId, tituloHoja, datos, filasCaptura = null) {
    const limpio = sanitizarDatos(datos);
    const captura = filasCapturaDesde(filasCaptura || limpio.filas);
    const values = captura.map((c) => c.celdas);
    const vacias = Array.from(
        { length: Math.max(0, CLEAR_ROWS - values.length) },
        () => ['', '', '', '', '', '', '']
    );
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
        range: rango(tituloHoja, `A${DATA_START_ROW}:G${DATA_START_ROW + CLEAR_ROWS - 1}`),
        values: values.concat(vacias)
    }]);
    await aplicarTamanoYBordes(spreadsheetId, tituloHoja, values.length);
    return tituloHoja;
}

async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos, filasCaptura = null) {
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[ATH-F-14] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[ATH-F-14] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirEnHoja(spreadsheetId, tituloTmp, datos, filasCaptura);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[ATH-F-14] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null, filasCaptura = null) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-14] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos, filasCaptura);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos, filasCaptura);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[ATH-F-14] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos, filasCaptura);
    }

    try {
        await escribirEnHoja(spreadsheetId, titulo, datos, filasCaptura);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[ATH-F-14] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos, filasCaptura);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-14] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const legado = (titulos || []).find((t) => SHEET_TITLE_LEGACY.includes(String(t || '').trim()));
    if (legado) return legado;

    if (!titulos.length) return mesActual;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE_LEGACY[0],
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) return nombre;
    } catch (err) {
        console.warn('[ATH-F-14] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
}

async function editorUrlConHojaVigente(driveId) {
    if (!driveId) return null;
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return driveService.construirUrlEditorGoogleSheet(driveId, { gid })
                || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[ATH-F-14] No se pudo resolver gid editor:', err.message);
    }
    return driveService.construirUrlEditorGoogleSheet(driveId)
        || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
}

async function eliminarHojasHistorialFormato(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[ATH-F-14] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
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
        console.warn(`[ATH-F-14] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[ATH-F-14] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

async function leerFilasDesdeHoja(spreadsheetId, tituloHoja) {
    const auth = driveService.getAuthClient();
    if (!auth || !spreadsheetId || !tituloHoja) return [];
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rango(tituloHoja, `A${DATA_START_ROW}:D${DATA_START_ROW + CLEAR_ROWS - 1}`)
    });
    const rows = res.data.values || [];
    return rows
        .map((row) => sanitizarFila({
            nombreCompleto: row[0],
            fechaIngreso: row[1],
            diasDisponibles: row[3]
        }))
        .filter((f) => f.nombreCompleto);
}

/**
 * ATH-F-14 solo usa pestañas ATHF14-MMAA / ATHF14-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes.
 */
async function aplicarHistorial(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE_LEGACY[0],
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: async (spreadsheetId, hoja, datos) => {
            await escribirEnHoja(spreadsheetId, hoja, datos, opciones.filasCaptura);
        },
        origen: opciones.origen || 'sistema',
        forzarTipo: null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
    });
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
    return formatearInstanteMexico(dt);
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
    if (dbVal != null && dbVal !== '') return formatearDatetimeMysqlMexico(dbVal);
    if (archivoDrive?.modifiedTime) return formatearInstanteMexico(archivoDrive.modifiedTime);
    return null;
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const limpio = sanitizarDatos(datos);
    const driveId = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA || null;
    return {
        codigo: CODIGO_FORMATO,
        datos: limpio,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId
            ? (driveService.construirUrlEditorGoogleSheet(driveId, { modo: 'preview' })
                || `https://docs.google.com/spreadsheets/d/${driveId}/preview`)
            : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        contenidoModificado: !!registro?.contenido_modificado,
        plantillaDriveId: TEMPLATE_DRIVE_ID,
        sistemaDriveId: DRIVE_FILE_ID_SISTEMA
    };
}

const GESTORES_CONTROL_VACACIONES = new Set(['supersu', 'mafer295', 'marisol12']);

function nombreDesdeUsuario(user) {
    const nombre = String(user?.nombre || '')
        .replace(/^(Ing\.?|Mtro\.?|Mtra\.?|Dr\.?|Dra\.?|Doc\.?|Lic\.?|Prof\.?|Arq\.?|C\.)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const apellido = String(user?.apellido || user?.apellido_paterno || '').trim();
    const materno = String(user?.apellido_materno || '').trim();
    return [nombre, apellido, materno].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * ATH-F-13 solo lo usan quienes están en este control.
 * root y los tres registradores (supersu, mafer295, marisol12) conservan la vista completa.
 */
async function resolverAccesoSolicitud(pool, user) {
    const roles = Array.isArray(user?.roles)
        ? user.roles.map((r) => String(r).toLowerCase())
        : (user?.rol ? [String(user.rol).toLowerCase()] : []);
    const username = String(user?.username || '').toLowerCase().trim();
    const esGestor = roles.includes('root') || GESTORES_CONTROL_VACACIONES.has(username);
    const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    const datos = sanitizarDatos(registro?.datos_json || { filas: [] });
    const nombreUsuario = nombreDesdeUsuario(user);
    const key = claveNombre(nombreUsuario);
    const fila = key
        ? datos.filas.find((f) => claveNombre(f.nombreCompleto) === key)
        : null;
    return {
        esGestor,
        registrado: !!fila,
        permitido: esGestor || !!fila,
        nombreRegistrado: fila?.nombreCompleto || ''
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    let datos;
    let archivoDrive = null;

    const driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = registro?.datos_json
            ? sanitizarDatos(registro.datos_json)
            : sanitizarDatos(DATOS_DEFECTO);
        await persistirRegistroSgc(pool, CODIGO_FORMATO, {
            driveFileId,
            datos: datosDb,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || '2026-03-17',
            fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    }

    const datosDb = registro?.datos_json ? sanitizarDatos(registro.datos_json) : null;

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            const titulo = await resolverTituloHojaVigente(driveFileId);
            const filasHoja = await leerFilasDesdeHoja(driveFileId, titulo);
            if (datosDb?.filas?.length) {
                datos = datosDb;
            } else if (filasHoja.length) {
                datos = sanitizarDatos({ filas: filasHoja });
            } else {
                datos = datosDb || sanitizarDatos(DATOS_DEFECTO);
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
        } catch (err) {
            console.warn('[ATH-F-14] No se pudo leer archivo en Drive, usando BD:', err.message);
            datos = datosDb;
        }

        const tituloMes = nombreHojaMesActual();
        try {
            await eliminarHojasHistorialFormato(driveFileId);
            const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
            const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
            const existeMes = !!tituloVigente;
            const estructuraMesOk = existeMes
                ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
                : false;

            if (!existeMes || !estructuraMesOk) {
                const destino = tituloVigente || tituloMes;
                if (!existeMes) {
                    console.warn(`[ATH-F-14] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
                } else {
                    console.warn(`[ATH-F-14] «${destino}» no coincide con plantilla; se regenera.`);
                }
                datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
                try {
                    await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                    archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
                } catch (healErr) {
                    console.warn('[ATH-F-14] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
                }
            }
        } catch (healOuter) {
            console.warn('[ATH-F-14] Heal de hoja del mes:', healOuter.message);
        }
    }

    datos = sanitizarDatos(datos || datosDb || DATOS_DEFECTO);
    if (!registro) {
        registro = {
            fecha_elaboracion_original: '2026-03-17',
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[ATH-F-14] No se pudo asegurar permiso de enlace:', err.message);
        }
    }

    return construirRespuesta(
        { ...(registro || {}), drive_file_id: driveFileId },
        datos,
        archivoDrive
    );
}

let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body) {
    const ejecutar = () => guardarFormatoInterno(pool, body);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);

    const registroPrevio = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    const datosPrevios = registroPrevio?.datos_json
        ? sanitizarDatos(registroPrevio.datos_json)
        : sanitizarDatos(DATOS_DEFECTO);

    const rawEntrada = body?.datos || body || {};
    const filasCaptura = Array.isArray(rawEntrada?.filas) ? rawEntrada.filas : [];
    const entrada = sanitizarDatos({
        ...rawEntrada,
        _metaHoja: datosPrevios._metaHoja
    });
    const origen = String(body?.origen || 'sistema').toLowerCase();

    const huboCambio = !contenidoEsEquivalente(datosPrevios, entrada);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    const driveId = await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
        return construirRespuesta(
            { ...(registroPrevio || {}), drive_file_id: driveId },
            entrada,
            archivoDrive
        );
    }

    let datosGuardar = { ...entrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && huboCambio) {
        try {
            await eliminarHojasHistorialFormato(driveId);
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorial({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: entrada,
                origen,
                filasCaptura: filasCaptura.length ? filasCaptura : entrada.filas
            });
            datosGuardar = sanitizarDatos(hist?.datosGuardar || entrada);

            if (hist?.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            const tituloSync = String(hist?.hojaVigente || '').trim()
                || await resolverTituloHojaVigente(driveId);
            let archivoDrive = null;
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(
                    driveId,
                    datosGuardar,
                    tituloSync,
                    filasCaptura.length ? filasCaptura : datosGuardar.filas
                );
            } catch (syncErr) {
                console.warn('[ATH-F-14] Sync hoja edición falló tras historial:', syncErr.message);
            }
            if (!archivoDrive) {
                archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
            }

            await persistirRegistroSgc(pool, CODIGO_FORMATO, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || '2026-03-17',
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado,
                ultimaSyncDrive: fechaHoyIso()
            });
            const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[ATH-F-14] Drive no sincronizó; la BD igual se guarda:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        driveFileId: driveId || DRIVE_FILE_ID_SISTEMA,
        datos: datosGuardar,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || '2026-03-17',
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });
    const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function descargarPlantillaPdf() {
    const driveId = DRIVE_FILE_ID_SISTEMA;
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema ATH-F-14 configurado.');
    }
    const titulo = await resolverTituloHojaVigente(driveId);
    const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
    if (gid == null) {
        throw new Error('No se encontró la hoja vigente para exportar a PDF.');
    }
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveId, {
        gid: String(gid),
        landscape: true,
        size: 'letter',
        fitToWidth: true,
        margins: 'normal'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF quedó vacía.');
    }
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    cargarFormato,
    guardarFormato,
    descargarPlantillaPdf,
    sanitizarDatos,
    claveNombre,
    resolverAccesoSolicitud
};
