/**
 * SGC-F-17 · Bitácora de calibración y verificación de equipos de medición.
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF17-MMAA / _N).
 * Patrón: docs/GUIA-PLANTILLA-EXCEL-SGC.md / sgcDgF05Service / sgcF03Service.
 * Sin archivero ni versiones firmadas.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-17';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1cVw6AeNlQLrl8iwb0pdUADMb61oI2hDgZGVo-lB9Yao
 */
const TEMPLATE_DRIVE_ID = '1cVw6AeNlQLrl8iwb0pdUADMb61oI2hDgZGVo-lB9Yao';
/**
 * Archivo de trabajo Centro SGC (historial SGCF17-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1XzxX2gRHUSf0z2ToPp1YCvzD6IOzzRUlpsEsY62takk
 */
const DRIVE_FILE_ID_SISTEMA = '1XzxX2gRHUSf0z2ToPp1YCvzD6IOzzRUlpsEsY62takk';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-17 Bitácora de calibración y verificación de equipos de medición (Sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Alias legado (misma hoja en plantilla antigua del sistema). */
const TEMPLATE_SHEET_TITLE_LEGACY = 'Plantilla.';
const HOJA_LISTAS = 'No borrar esta hoja';
const FILA_DATOS = 7;
const MAX_FILAS = 80;
const MAX_COLUMNAS_SISTEMA = 26;
const FUENTE = { fontFamily: 'Century Gothic', fontSize: 11 };
const ALTO_FILA_DATOS = 32;
const BORDE = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
const COLS_DATOS = 26;
const MARGENES_PDF = {
    top: 0.7480314960629921,
    bottom: 0.7480314960629921,
    left: 0.2362204724409449,
    right: 0.2362204724409449
};

/** Nombre base del mes actual (SGCF17-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

/** SGCF17-1026 / SGCF17-1026_2 … o legado MMAA-NN (1026-05). */
function esNombreHojaHistorial(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return false;
    if (excelHistorial.esHojaHistorialInformacion(t, CODIGO_FORMATO)) return true;
    return /^\d{4}-\d{2}$/.test(t);
}

function esHojaReservada(titulo) {
    const t = String(titulo || '').trim().toLowerCase();
    return t === TEMPLATE_SHEET_TITLE.toLowerCase()
        || t === TEMPLATE_SHEET_TITLE_LEGACY.toLowerCase()
        || t === HOJA_LISTAS.toLowerCase()
        || t.startsWith('_tmp_');
}

const CONDICIONES = ['Buen estado', 'Estado regular', 'Mal estado'];
const ACCIONES_MANTENIMIENTO = [
    'Ninguna por ahora',
    'Reparación (Correctivo)',
    'Retirar de circulación',
    'Limpieza',
    'Mantenimiento preventivo'
];
const TIPOS_MANTENIMIENTO = ['Interno', 'Externo', 'N/A'];
const TIPOS_CONTROL = ['Calibración', 'Verificación'];
const RESULTADOS = ['Aprobado', 'No aprobado', 'N/A'];
const ACCIONES_INMEDIATAS = ['Re-calibrar', 'Reparar', 'Deshechar y comprar nuevo', 'Ninguna'];

const MERGES = [
    [1, 3],
    [15, 17],
    [17, 20],
    [20, 23],
    [23, 26]
];

/** Validaciones embebidas (ONE_OF_LIST). No dependen de «No borrar esta hoja». */
const LISTAS = [
    { col: 7, opciones: CONDICIONES },
    { col: 8, opciones: ACCIONES_MANTENIMIENTO },
    { col: 9, opciones: TIPOS_MANTENIMIENTO },
    { col: 11, opciones: ['Sí', 'No'] },
    { col: 12, opciones: TIPOS_CONTROL },
    { col: 15, opciones: RESULTADOS },
    { col: 17, opciones: ACCIONES_INMEDIATAS }
];

let sheetsAuth = null;
function clienteSheets() {
    if (!sheetsAuth) {
        sheetsAuth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        sheetsAuth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    }
    return google.sheets({ version: 'v4', auth: sheetsAuth });
}

function texto(valor) {
    return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
}

function opcion(valor, lista) {
    const t = texto(valor).toLowerCase();
    if (!t) return '';
    return lista.find((item) => item.toLowerCase() === t) || '';
}

function siNo(valor) {
    const t = texto(valor).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t === 'si') return 'Sí';
    if (t === 'no') return 'No';
    return '';
}

function fechaIso(valor) {
    const t = texto(valor);
    let match = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return '';
    const dia = match[1].padStart(2, '0');
    const mes = match[2].padStart(2, '0');
    let anio = match[3];
    if (anio.length === 2) anio = Number(anio) > 50 ? `19${anio}` : `20${anio}`;
    return `${anio}-${mes}-${dia}`;
}

function fechaHoja(iso) {
    const t = fechaIso(iso);
    if (!t) return texto(iso);
    const [anio, mes, dia] = t.split('-');
    return `${dia}/${mes}/${anio}`;
}

function equipoVacio() {
    return {
        queMide: '',
        nombre: '',
        responsable: '',
        controlInterno: '',
        marca: '',
        modelo: '',
        condiciones: '',
        accionesMantenimiento: '',
        tipoMantenimiento: '',
        fechaMantenimiento: '',
        equipoPatron: '',
        tipoControl: '',
        empresa: '',
        numeroCertificado: '',
        resultado: '',
        accionesInmediatas: '',
        fechaCalibracion: '',
        fechaProxima: ''
    };
}

function sanitizarEquipo(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const equipo = {
        ...equipoVacio(),
        queMide: texto(base.queMide),
        nombre: texto(base.nombre),
        responsable: texto(base.responsable),
        controlInterno: texto(base.controlInterno),
        marca: texto(base.marca),
        modelo: texto(base.modelo),
        condiciones: opcion(base.condiciones, CONDICIONES),
        accionesMantenimiento: opcion(base.accionesMantenimiento, ACCIONES_MANTENIMIENTO),
        tipoMantenimiento: opcion(base.tipoMantenimiento, TIPOS_MANTENIMIENTO),
        fechaMantenimiento: fechaIso(base.fechaMantenimiento),
        equipoPatron: siNo(base.equipoPatron),
        tipoControl: opcion(base.tipoControl, TIPOS_CONTROL),
        empresa: texto(base.empresa),
        numeroCertificado: texto(base.numeroCertificado),
        resultado: opcion(base.resultado, RESULTADOS),
        accionesInmediatas: opcion(base.accionesInmediatas, ACCIONES_INMEDIATAS),
        fechaCalibracion: fechaIso(base.fechaCalibracion),
        fechaProxima: fechaIso(base.fechaProxima)
    };
    const tieneDatos = Object.values(equipo).some(Boolean);
    return tieneDatos ? equipo : null;
}

function parsearMetaNombreHoja(nombreHoja) {
    const t = texto(nombreHoja);
    // Legado: 1026-05
    const legado = t.match(/^(\d{4})-(\d{2})$/);
    if (legado) {
        return { mes: legado[1], numero: legado[2], nombreHoja: t };
    }
    // Vigente: SGCF17-1026 o SGCF17-1026_3
    const vigente = t.match(/^SGCF17-(\d{4})(?:_(\d+))?$/i);
    if (vigente) {
        return {
            mes: vigente[1],
            numero: vigente[2] || '1',
            nombreHoja: t
        };
    }
    return null;
}

function sanitizarHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
        const base = item && typeof item === 'object' ? item : {};
        const meta = parsearMetaNombreHoja(base.nombreHoja);
        if (!meta) return null;
        return {
            ...meta,
            fecha: texto(base.fecha) || null
        };
    }).filter(Boolean);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let equipos = Array.isArray(base.equipos) ? base.equipos.map(sanitizarEquipo).filter(Boolean) : [];
    if (equipos.length > MAX_FILAS) equipos = equipos.slice(0, MAX_FILAS);
    const historial = sanitizarHistorial(base.historial);
    const hojaVigente = texto(base.hojaVigente);
    return {
        equipos,
        hojaVigente: esNombreHojaHistorial(hojaVigente)
            ? hojaVigente
            : (historial.length ? historial[historial.length - 1].nombreHoja : ''),
        historial
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(sanitizarDatos(a).equipos) === JSON.stringify(sanitizarDatos(b).equipos);
}

function filaValores(equipo) {
    const e = equipo || equipoVacio();
    const fila = Array(26).fill('');
    fila[0] = e.queMide;
    fila[1] = e.nombre;
    fila[3] = e.responsable;
    fila[4] = e.controlInterno;
    fila[5] = e.marca;
    fila[6] = e.modelo;
    fila[7] = e.condiciones;
    fila[8] = e.accionesMantenimiento;
    fila[9] = e.tipoMantenimiento;
    fila[10] = fechaHoja(e.fechaMantenimiento);
    fila[11] = e.equipoPatron;
    fila[12] = e.tipoControl;
    fila[13] = e.empresa;
    fila[14] = e.numeroCertificado;
    fila[15] = e.resultado;
    fila[17] = e.accionesInmediatas;
    fila[20] = fechaHoja(e.fechaCalibracion);
    fila[23] = fechaHoja(e.fechaProxima);
    return fila;
}

function valorCelda(cell) {
    if (!cell) return '';
    if (cell.formattedValue != null && String(cell.formattedValue).trim()) {
        return cell.formattedValue;
    }
    const ev = cell.effectiveValue || {};
    if (ev.stringValue != null) return ev.stringValue;
    if (ev.numberValue != null) return String(ev.numberValue);
    return '';
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
        if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length) return null;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function editorUrlConHojaVigente(driveId, hojaVigente) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) return null;
    const preferida = texto(hojaVigente);
    try {
        let titulo = preferida;
        if (!titulo || !esNombreHojaHistorial(titulo)) {
            titulo = await resolverTituloHojaVigente(driveId);
        }
        if (titulo) {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
            if (gid != null) {
                return `${base}&gid=${gid}#gid=${gid}`;
            }
        }
    } catch (err) {
        console.warn('[SGC-F-17] No se pudo resolver gid editor:', err.message);
    }
    return base;
}

async function construirRespuesta(registro, datos) {
    const driveIdRaw = registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    const driveId = driveIdRaw === TEMPLATE_DRIVE_ID ? DRIVE_FILE_ID_SISTEMA : driveIdRaw;
    const limpio = sanitizarDatos(datos);
    const editorUrl = await editorUrlConHojaVigente(driveId, limpio.hojaVigente);
    return {
        codigo: CODIGO_FORMATO,
        datos: limpio,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original || null,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
        contenidoModificado: !!registro?.contenido_modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl: `https://docs.google.com/spreadsheets/d/${driveId}/preview`,
        plantillaDriveId: TEMPLATE_DRIVE_ID,
        ultimaSyncDrive: registro?.ultima_sync_drive || null
    };
}

async function resolverDriveFileId(registro = null) {
    const idDb = texto(registro?.drive_file_id);
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existeDb = await driveService.verificarArchivoExiste(idDb).catch(() => false);
        if (existeDb) return idDb;
    }
    const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
    if (existe) return DRIVE_FILE_ID_SISTEMA;
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const hoja = (archivos || []).find((f) => {
        const id = String(f.id || '');
        const nombre = String(f.name || '');
        return id !== TEMPLATE_DRIVE_ID
            && nombre.includes('SGC-F-17')
            && String(f.mimeType || '').includes('spreadsheet');
    });
    if (!hoja?.id) throw new Error('No se encontró la bitácora SGC-F-17 (sistema) en Drive.');
    return hoja.id;
}

/**
 * Resuelve el título de la pestaña Plantilla en el archivo plantilla externo.
 */
async function resolverTituloPlantillaExterna() {
    const titulos = await driveService.listarHojasGoogleSheet(TEMPLATE_DRIVE_ID).catch(() => []);
    const lista = (titulos || []).map((t) => String(t || '').trim()).filter(Boolean);
    const exacta = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase());
    if (exacta) return exacta;
    const legado = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE_LEGACY.toLowerCase());
    if (legado) return legado;
    if (lista.length) return lista[0];
    throw new Error(
        `No se encontró la hoja «${TEMPLATE_SHEET_TITLE}» en la plantilla SGC-F-17 `
        + `(${TEMPLATE_DRIVE_ID}).`
    );
}

/**
 * Copia «Plantilla» del archivo plantilla externo → sistema como SGCF17-MMAA(_N).
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar plantilla sobre el archivo plantilla.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    const origenTitulo = await resolverTituloPlantillaExterna();
    console.warn(
        `[SGC-F-17] Copiando hoja «${origenTitulo}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        origenTitulo,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            origenTitulo,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SGC-F-17] Anchos de columna desde plantilla:', err.message);
    }
    return copiada;
}

/**
 * Las validaciones usan ONE_OF_LIST embebidas; la hoja de listas es opcional.
 * Si existe en plantilla y falta en sistema, se copia por compatibilidad.
 */
async function asegurarHojaListasEnSistema(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    const ya = (titulos || []).some(
        (t) => String(t || '').trim().toLowerCase() === HOJA_LISTAS.toLowerCase()
    );
    if (ya) return;
    const titulosPlantilla = await driveService.listarHojasGoogleSheet(TEMPLATE_DRIVE_ID).catch(() => []);
    const origen = (titulosPlantilla || []).find(
        (t) => String(t || '').trim().toLowerCase() === HOJA_LISTAS.toLowerCase()
    );
    if (!origen) return;
    try {
        await driveService.copiarHojaEntreSpreadsheets(
            TEMPLATE_DRIVE_ID,
            origen,
            spreadsheetId,
            HOJA_LISTAS
        );
    } catch (err) {
        console.warn(`[SGC-F-17] No se pudo copiar «${HOJA_LISTAS}»:`, err.message);
    }
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => esHojaDelMesActual(t, mes))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-17] No se pudieron listar hojas:', err.message);
    }
    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const historicas = (titulos || [])
        .map((t) => String(t || '').trim())
        .filter((t) => esNombreHojaHistorial(t) && !esHojaReservada(t))
        .map((titulo) => {
            const meta = parsearMetaNombreHoja(titulo);
            const sortKey = meta
                ? Number(`${meta.mes}${String(meta.numero).padStart(3, '0')}`)
                : 0;
            return { titulo, sortKey };
        })
        .sort((a, b) => b.sortKey - a.sortKey);
    if (historicas[0]?.titulo) return historicas[0].titulo;
    return mesActual;
}

function bloquesConBorde() {
    const dentroDeMerge = new Set();
    const bloques = MERGES.map(([inicio, fin]) => {
        for (let col = inicio; col < fin; col += 1) dentroDeMerge.add(col);
        return [inicio, fin];
    });
    for (let col = 0; col < COLS_DATOS; col += 1) {
        if (!dentroDeMerge.has(col)) bloques.push([col, col + 1]);
    }
    return bloques;
}

const ANCHO_CARACTER = 8.2;
const PADDING_CELDA_X = 10;
const ALTO_LINEA = 22;
const RELLENO_LINEA_EXTRA = 8;

function anchoBloque(anchos, inicio, fin) {
    let suma = 0;
    for (let col = inicio; col < fin; col += 1) suma += Number(anchos[col]) || 80;
    return suma;
}

function contarLineas(valor, anchoPx) {
    const texto = String(valor || '').replace(/\r/g, '').trim();
    if (!texto) return 1;
    const util = Math.max(28, anchoPx - PADDING_CELDA_X);
    let total = 0;
    texto.split('\n').forEach((parte) => {
        const palabras = parte.split(/\s+/).filter(Boolean);
        if (!palabras.length) {
            total += 1;
            return;
        }
        let lineas = 1;
        let usado = 0;
        palabras.forEach((palabra) => {
            const anchoPalabra = palabra.length * ANCHO_CARACTER;
            if (anchoPalabra > util) {
                if (usado > 0) lineas += 1;
                lineas += Math.ceil(anchoPalabra / util) - 1;
                usado = 0;
                return;
            }
            const espacio = usado > 0 ? ANCHO_CARACTER * 0.45 : 0;
            if (usado > 0 && usado + espacio + anchoPalabra > util) {
                lineas += 1;
                usado = anchoPalabra;
                return;
            }
            usado += espacio + anchoPalabra;
        });
        total += lineas;
    });
    return Math.max(1, total);
}

function altoDeFila(valores, anchos) {
    let lineas = 1;
    bloquesConBorde().forEach(([inicio, fin]) => {
        lineas = Math.max(lineas, contarLineas(valores[inicio], anchoBloque(anchos, inicio, fin)));
    });
    if (lineas <= 1) return ALTO_FILA_DATOS;
    return ALTO_FILA_DATOS + (lineas - 1) * ALTO_LINEA + RELLENO_LINEA_EXTRA;
}

function requestsAltoFilas(sheetId, filas, anchos) {
    const lista = filas.length ? filas : [Array(COLS_DATOS).fill('')];
    return lista.map((fila, i) => ({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: FILA_DATOS - 1 + i,
                endIndex: FILA_DATOS + i
            },
            properties: { pixelSize: altoDeFila(fila, anchos) },
            fields: 'pixelSize'
        }
    }));
}

function requestsBordes(sheetId, cantidad) {
    const n = Math.max(cantidad, 1);
    const inicio = FILA_DATOS - 1;
    const bloques = bloquesConBorde();
    const requests = [];
    for (let i = 0; i < n; i += 1) {
        bloques.forEach(([c1, c2]) => {
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: inicio + i,
                        endRowIndex: inicio + i + 1,
                        startColumnIndex: c1,
                        endColumnIndex: c2
                    },
                    top: BORDE,
                    bottom: BORDE,
                    left: BORDE,
                    right: BORDE
                }
            });
        });
    }
    return requests;
}

function requestsFormato(sheetId, filas, anchos) {
    const lista = Array.isArray(filas) && filas.length ? filas : [Array(COLS_DATOS).fill('')];
    const n = lista.length;
    const inicio = FILA_DATOS - 1;
    const fin = inicio + n;
    const requests = [];
    if (n > 1) {
        requests.push({
            insertDimension: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: FILA_DATOS,
                    endIndex: FILA_DATOS + (n - 1)
                },
                inheritFromBefore: true
            }
        });
    }
    requests.push({
        unmergeCells: {
            range: {
                sheetId,
                startRowIndex: inicio,
                endRowIndex: fin,
                startColumnIndex: 0,
                endColumnIndex: 26
            }
        }
    });
    for (let i = 0; i < n; i += 1) {
        MERGES.forEach(([c1, c2]) => {
            requests.push({
                mergeCells: {
                    mergeType: 'MERGE_ALL',
                    range: {
                        sheetId,
                        startRowIndex: inicio + i,
                        endRowIndex: inicio + i + 1,
                        startColumnIndex: c1,
                        endColumnIndex: c2
                    }
                }
            });
        });
    }
    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: inicio,
                endRowIndex: fin,
                startColumnIndex: 0,
                endColumnIndex: 26
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat: FUENTE
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });
    [0, 1, 3, 13].forEach((col) => {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: inicio,
                    endRowIndex: fin,
                    startColumnIndex: col,
                    endColumnIndex: col === 1 ? 3 : col + 1
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat: FUENTE
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });
    });
    LISTAS.forEach((lista) => {
        const opciones = Array.isArray(lista.opciones) ? lista.opciones.filter(Boolean) : [];
        if (!opciones.length) return;
        requests.push({
            setDataValidation: {
                range: {
                    sheetId,
                    startRowIndex: inicio,
                    endRowIndex: fin,
                    startColumnIndex: lista.col,
                    endColumnIndex: lista.col + 1
                },
                rule: {
                    condition: {
                        type: 'ONE_OF_LIST',
                        values: opciones.map((valor) => ({ userEnteredValue: String(valor) }))
                    },
                    showCustomUi: true,
                    strict: false
                }
            }
        });
    });
    requests.push(...requestsBordes(sheetId, n));
    requests.push(...requestsAltoFilas(sheetId, lista, anchos));
    return requests;
}

async function anchosColumnas(spreadsheetId, tituloHoja) {
    const sheets = clienteSheets();
    const titulo = String(tituloHoja || TEMPLATE_SHEET_TITLE).replace(/'/g, "''");
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [`'${titulo}'!A1:Z1`],
        includeGridData: true,
        fields: 'sheets(data(columnMetadata(pixelSize)))'
    });
    const cols = res.data.sheets?.[0]?.data?.[0]?.columnMetadata || [];
    const anchos = cols.map((col) => Number(col.pixelSize) || 80);
    while (anchos.length < COLS_DATOS) anchos.push(80);
    return anchos;
}

/**
 * Crea una versión nueva del mes (SGCF17-MMAA / _N) copiando desde la plantilla externa
 * y escribe los datos. No toca meses previos ni versiones _N anteriores.
 */
async function escribirSnapshot(spreadsheetId, datos, nombreHojaBase = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo de trabajo no puede ser la plantilla SGC-F-17.');
    }
    await asegurarHojaListasEnSistema(spreadsheetId);
    const base = texto(nombreHojaBase) || nombreHojaMesActual();
    const copiada = await adoptarPlantillaEnSistema(spreadsheetId, base);
    const titulo = texto(copiada?.title) || base;
    const sheetId = copiada?.sheetId;
    if (sheetId == null) throw new Error(`No se pudo crear la hoja «${base}».`);
    if (esHojaReservada(titulo) || titulo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede escribir el historial sobre la plantilla o hojas reservadas.');
    }
    try {
        const sheets = clienteSheets();
        const filas = datos.equipos.length ? datos.equipos.map(filaValores) : [filaValores(null)];
        let anchos;
        try {
            const origenTitulo = await resolverTituloPlantillaExterna();
            anchos = await anchosColumnas(TEMPLATE_DRIVE_ID, origenTitulo);
        } catch (_) {
            anchos = await anchosColumnas(spreadsheetId, titulo);
        }
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requestsFormato(sheetId, filas, anchos) }
        });
        const fin = FILA_DATOS + filas.length - 1;
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
            range: `'${titulo.replace(/'/g, "''")}'!A${FILA_DATOS}:Z${fin}`,
            values: filas
        }]);
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
        } catch (_) { /* opcional */ }
        return titulo;
    } catch (error) {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]).catch(() => {});
        throw error;
    }
}

/**
 * Lee filas de datos por sheetId (evita error A1 con hojas legado tipo «0926-01»).
 */
async function leerFilasDatosPorSheetId(spreadsheetId, sheetId) {
    const sheets = clienteSheets();
    const res = await sheets.spreadsheets.getByDataFilter({
        spreadsheetId,
        requestBody: {
            includeGridData: true,
            dataFilters: [{
                gridRange: {
                    sheetId: Number(sheetId),
                    startRowIndex: FILA_DATOS - 1,
                    endRowIndex: FILA_DATOS + MAX_FILAS - 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS_DATOS
                }
            }]
        },
        fields: 'sheets(data(rowData(values(formattedValue,effectiveValue))))'
    });
    return res.data.sheets?.[0]?.data?.[0]?.rowData || [];
}

async function leerEquiposDesdeHoja(spreadsheetId, tituloHoja) {
    const titulo = texto(tituloHoja);
    if (!titulo || esHojaReservada(titulo)) return null;

    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId).catch(() => []);
    const hoja = (hojas || []).find((h) => String(h.title || '').trim() === titulo);
    if (!hoja || hoja.sheetId == null) {
        console.warn(`[SGC-F-17] Hoja «${titulo}» no encontrada al sincronizar.`);
        return null;
    }

    let rows = [];
    try {
        rows = await leerFilasDatosPorSheetId(spreadsheetId, hoja.sheetId);
    } catch (err) {
        // Fallback A1 solo si el nombre no parece fecha/número (legado MMAA-NN falla al parsear).
        if (/^\d{4}-\d{2}$/.test(titulo)) {
            console.warn(
                `[SGC-F-17] No se pudo leer «${titulo}» por sheetId:`,
                err.message
            );
            return null;
        }
        const sheets = clienteSheets();
        const fin = FILA_DATOS + MAX_FILAS - 1;
        const res = await sheets.spreadsheets.get({
            spreadsheetId,
            ranges: [`'${titulo.replace(/'/g, "''")}'!A${FILA_DATOS}:Z${fin}`],
            includeGridData: true,
            fields: 'sheets(data(rowData(values(formattedValue,effectiveValue))))'
        });
        rows = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
    }

    const equipos = [];
    for (const row of rows) {
        const vals = row?.values || [];
        const celda = (col) => valorCelda(vals[col]);
        const equipo = sanitizarEquipo({
            queMide: celda(0),
            nombre: celda(1),
            responsable: celda(3),
            controlInterno: celda(4),
            marca: celda(5),
            modelo: celda(6),
            condiciones: celda(7),
            accionesMantenimiento: celda(8),
            tipoMantenimiento: celda(9),
            fechaMantenimiento: celda(10),
            equipoPatron: celda(11),
            tipoControl: celda(12),
            empresa: celda(13),
            numeroCertificado: celda(14),
            resultado: celda(15),
            accionesInmediatas: celda(17),
            fechaCalibracion: celda(20),
            fechaProxima: celda(23)
        });
        if (!equipo) {
            if (equipos.length) break;
            continue;
        }
        equipos.push(equipo);
    }
    return equipos;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    const driveFileId = await resolverDriveFileId(registro).catch(() => DRIVE_FILE_ID_SISTEMA);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) {
        return sincronizarDesdeDrive(pool);
    }
    const registroPrevio = await obtenerRegistroDb(pool);
    const previos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos({});
    const entrada = sanitizarDatos(body?.datos || body);
    entrada.historial = previos.historial;
    entrada.hojaVigente = previos.hojaVigente;
    const driveFileId = await resolverDriveFileId(registroPrevio);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo de trabajo SGC-F-17 no puede ser la plantilla.');
    }
    let modificado = false;
    if (!contenidoEsEquivalente(previos, entrada)) {
        const titulo = await escribirSnapshot(driveFileId, entrada, nombreHojaMesActual());
        const meta = parsearMetaNombreHoja(titulo) || {
            mes: nombreHojaMesActual().split('-')[1] || '',
            numero: '1',
            nombreHoja: titulo
        };
        entrada.historial = previos.historial.concat([{
            ...meta,
            fecha: excelHistorial.fechaAhoraMexicoIso()
        }]);
        entrada.hojaVigente = titulo;
        modificado = true;
    }
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: entrada,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || excelHistorial.fechaAhoraMexicoIso(),
        fechaModificacionContenido: modificado
            ? excelHistorial.fechaAhoraMexicoIso()
            : registroPrevio?.fecha_modificacion_contenido,
        contenidoModificado: modificado || !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, entrada);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos({});
    const driveFileId = await resolverDriveFileId(registroPrevio);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se sincroniza desde la plantilla SGC-F-17.');
    }
    const hoja = datos.hojaVigente || await resolverTituloHojaVigente(driveFileId);
    if (hoja) {
        try {
            const equipos = await leerEquiposDesdeHoja(driveFileId, hoja);
            if (equipos) {
                datos.equipos = equipos;
                datos.hojaVigente = hoja;
            }
        } catch (err) {
            console.warn(`[SGC-F-17] Sync desde hoja «${hoja}» omitido:`, err.message);
        }
    }
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || excelHistorial.fechaAhoraMexicoIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const existePlantilla = await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false);
    if (!existePlantilla) {
        throw new Error('No se encontró el archivo plantilla SGC-F-17 en Drive.');
    }
    await resolverTituloPlantillaExterna();
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    const driveFileId = await resolverDriveFileId(registro);
    return {
        ...(await construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos)),
        plantillaDriveId: TEMPLATE_DRIVE_ID,
        sistemaDriveId: DRIVE_FILE_ID_SISTEMA,
        plantillaOk: true
    };
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-17 para exportar a PDF.');
    }
    const hoja = datos.hojaVigente || await resolverTituloHojaVigente(driveFileId);
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, hoja);
    if (gid == null) {
        throw new Error('No se encontró la hoja vigente para exportar a PDF.');
    }
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid: String(gid),
        landscape: true,
        size: 'letter',
        fitToWidth: true,
        margins: MARGENES_PDF
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF quedó vacía.');
    }
    return pdfBuffer;
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-17 para el editor.');
    }
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* el enlace de lectura puede ya existir */ }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    sanitizarDatos
};
