/**
 * ATH-F-14 · Control de vacaciones.
 * Una sola hoja. No hay archivero ni PDF firmado: se guarda la tabla viva.
 */
const { google } = require('googleapis');
const {
    actualizarCeldasGoogleSheet,
    asignarPermisoEscrituraEnlace,
    construirUrlEditorGoogleSheet,
    exportarGoogleSheetComoPDF,
    getAuthClient,
    obtenerGidHojaPorNombre
} = require('./driveService');
const {
    obtenerRegistroSgcPersistido,
    persistirRegistroSgc
} = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'ATH-F-14';
const DRIVE_FILE_ID = '1Fxn1FNWcByT3RcinuVmmf4IgPR4g1AVksYF149-YvBc';
const SHEET_TITLE = 'Hoja1';
const DATA_START_ROW = 6;
const CLEAR_ROWS = 200;
const ROW_HEIGHT = 21;
const COLUMN_WIDTHS = [252, 117, 110, 128, 100, 158, 134];
const BORDE_SOLIDO = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
const BORDE_NULO = { style: 'NONE' };

const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12
};

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
    return {
        revision: '00',
        fechaRevision: '2026-03-17',
        filas: lista.map(sanitizarFila).filter((f) => f.nombreCompleto)
    };
}

async function leerFilasHoja() {
    const auth = getAuthClient();
    if (!auth) return [];
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: DRIVE_FILE_ID,
        range: `'${SHEET_TITLE}'!A${DATA_START_ROW}:D${DATA_START_ROW + CLEAR_ROWS - 1}`
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

function construirRespuesta(datos, registro) {
    return {
        codigo: CODIGO_FORMATO,
        datos,
        driveFileId: DRIVE_FILE_ID,
        editorUrl: construirUrlEditorGoogleSheet(DRIVE_FILE_ID),
        previewUrl: construirUrlEditorGoogleSheet(DRIVE_FILE_ID, { modo: 'preview' }),
        ultimaSyncDrive: registro?.ultima_sync_drive || null,
        contenidoModificado: !!registro?.contenido_modificado
    };
}

async function cargarFormato(pool) {
    await asignarPermisoEscrituraEnlace(DRIVE_FILE_ID);
    const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    let datos;
    if (registro?.datos_json && Array.isArray(registro.datos_json.filas)) {
        datos = sanitizarDatos(registro.datos_json);
    } else {
        const filas = await leerFilasHoja();
        datos = sanitizarDatos({ filas });
    }
    return construirRespuesta(datos, registro);
}

function claveNombre(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
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
        base.diasDisponibles - diasTomados,
        vacaciones
    ];
}

async function obtenerSheetId() {
    const auth = getAuthClient();
    if (!auth) return null;
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: DRIVE_FILE_ID,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hoja = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === SHEET_TITLE);
    return hoja?.properties?.sheetId ?? null;
}

async function aplicarTamanoYBordes(cantidadFilas) {
    const sheetId = await obtenerSheetId();
    const auth = getAuthClient();
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
        spreadsheetId: DRIVE_FILE_ID,
        requestBody: { requests }
    });
}

async function escribirHoja(filasCaptura) {
    const values = [];
    const vistos = new Set();
    for (const fila of filasCaptura || []) {
        const celdas = filaParaHoja(fila);
        if (!celdas) continue;
        const key = claveNombre(celdas[0]);
        if (!key || vistos.has(key)) continue;
        vistos.add(key);
        values.push(celdas);
    }
    const vacias = Array.from({ length: Math.max(0, CLEAR_ROWS - values.length) }, () => ['', '', '', '', '', '', '']);
    await actualizarCeldasGoogleSheet(DRIVE_FILE_ID, [{
        range: `'${SHEET_TITLE}'!A${DATA_START_ROW}:G${DATA_START_ROW + CLEAR_ROWS - 1}`,
        values: values.concat(vacias)
    }]);
    await aplicarTamanoYBordes(values.length);
}

async function guardarFormato(pool, body) {
    const datos = sanitizarDatos(body?.datos || body || {});
    const filasHoja = Array.isArray(body?.datos?.filas) ? body.datos.filas : (body?.filas || []);
    await escribirHoja(filasHoja.length ? filasHoja : datos.filas);
    const ahora = new Date();
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        driveFileId: DRIVE_FILE_ID,
        fechaElaboracionOriginal: '2026-03-17',
        fechaModificacionContenido: ahora.toISOString().slice(0, 10),
        contenidoModificado: true,
        datos
    });
    const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    return construirRespuesta(datos, registro);
}

async function descargarPlantillaPdf() {
    const gid = await obtenerGidHojaPorNombre(DRIVE_FILE_ID, SHEET_TITLE);
    if (gid == null) {
        throw new Error('No se encontró la hoja actual para exportar a PDF.');
    }
    const pdfBuffer = await exportarGoogleSheetComoPDF(DRIVE_FILE_ID, {
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
    cargarFormato,
    guardarFormato,
    descargarPlantillaPdf,
    sanitizarDatos
};
