/**
 * SGC-F-27 · Reporte de verificación de equipos de medición (capítulo 7).
 *
 * Código visible: SGC-F-27. La clave interna SGC-F-27V evita chocar con
 * la orden de compra (también registrada como SGC-F-27 en el capítulo 8).
 *
 * Matemáticas de cada corrida (n = 3), iguales a la plantilla:
 *   Eabs = Xi − X'
 *   (Xi−X')²
 *   Σ(Xi−X')²
 *   n−1 = 2
 *   varianza = Σ / (n−1)
 *   S = √varianza
 * Criterio: S <= 0.50 en todas las corridas y estatus OK en al menos 3.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-27V';
const CODIGO_VISIBLE = 'SGC-F-27';
const DRIVE_FILE_ID_SISTEMA = '1EK1xd8hJtpkDs_H7F_aoprV3eAz7bAmzIp9Fy0kHZy0';
const CARPETA_DRIVE_ID = '1QR_QluYmog0K45Z2gZot0EgOnw26l6Aj';
const CARPETA_PDF_FIRMADOS_ID = '1T5yhvPmTE8621G4xL15ueDN3trwmHUKH';
const SHEET_TITLE = 'Plantilla';
const HOJA_LISTAS = 'No borrar esta hoja';
const FILA_DATOS = 16;
const FILA_CRITERIO_BASE = 21;
const FILA_RESULTADO_BASE = 24;
const FILA_FIN_BASE = 32;
const MAX_CORRIDAS = 12;
const MAX_INTERVALOS = 4;
const LIMITE_S = 0.5;
const ESTATUS = ['OK', 'Fuera de rango'];
const RESULTADOS = ['Verificación aprobada', 'Verificación no aprobada'];

const FUENTE = { fontFamily: 'Century Gothic', fontSize: 11 };

const EJEMPLO = {
    fechaElaboracion: '2025-01-21',
    revision: '00',
    fechaRevision: '2025-01-21',
    nombreVerifica: '',
    fechaVerificacion: '',
    instrumento: 'Probetas',
    queMide: 'Volumen',
    patronNombre: 'Báscula',
    patronClave: 'BAS-01',
    patronUnidad: 'Gramos (g)',
    recursoId: 'PROB-01',
    recursoUnidad: 'mililitros (ml)',
    intervalos: ['a 100 ml', 'a 350 ml', 'a 700 ml'],
    corridas: [
        { estandar: 100, mediciones: [100.1, 100.1, 100.1], estatus: 'OK' },
        { estandar: 350, mediciones: [350.3, 350.3, 350.3], estatus: 'OK' },
        { estandar: 700, mediciones: [700.1, 700.1, 700.1], estatus: 'OK' },
        { estandar: null, mediciones: [1000.06, 999.45, 999.87], estatus: 'OK' }
    ],
    resultado: 'Verificación aprobada',
    accion: '',
    pdfFirmado: null,
    pdfsHistorial: []
};

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

function aNumero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    const n = parseFloat(String(valor).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
}

function normalizarEstatus(valor) {
    const t = texto(valor).toLowerCase();
    if (t === 'ok') return 'OK';
    if (t.includes('fuera')) return 'Fuera de rango';
    return '';
}

function normalizarResultado(valor) {
    const t = texto(valor).toLowerCase();
    if (t.includes('no aprob')) return 'Verificación no aprobada';
    if (t.includes('aprob')) return 'Verificación aprobada';
    return '';
}

function sanitizarPdf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = texto(raw.driveFileId || raw.drive_file_id);
    if (!id) return null;
    return {
        driveFileId: id,
        nombreArchivo: texto(raw.nombreArchivo || raw.nombre) || 'SGC-F-27 firmado.pdf',
        webViewLink: texto(raw.webViewLink) || null,
        previewUrl: texto(raw.previewUrl) || `https://drive.google.com/file/d/${id}/preview`,
        fechaSubida: texto(raw.fechaSubida) || null
    };
}

function sanitizarCorrida(raw, index) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const mediciones = [0, 1, 2].map((i) => aNumero(Array.isArray(base.mediciones) ? base.mediciones[i] : null));
    return {
        estandar: aNumero(base.estandar),
        mediciones,
        estatus: normalizarEstatus(base.estatus)
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const origen = Object.keys(base).length ? base : EJEMPLO;
    let corridas = Array.isArray(origen.corridas) ? origen.corridas.map(sanitizarCorrida) : [];
    corridas = corridas.filter((c) => c.estandar != null || c.mediciones.some((m) => m != null) || c.estatus);
    if (!corridas.length) {
        corridas = [sanitizarCorrida({})];
    }
    if (corridas.length > MAX_CORRIDAS) corridas = corridas.slice(0, MAX_CORRIDAS);

    let intervalos = Array.isArray(origen.intervalos)
        ? origen.intervalos.map((v) => texto(v)).filter(Boolean)
        : [];
    if (intervalos.length > MAX_INTERVALOS) intervalos = intervalos.slice(0, MAX_INTERVALOS);

    const hist = (Array.isArray(origen.pdfsHistorial) ? origen.pdfsHistorial : [])
        .map(sanitizarPdf)
        .filter(Boolean);

    return {
        fechaElaboracion: texto(origen.fechaElaboracion) || EJEMPLO.fechaElaboracion,
        revision: texto(origen.revision) || '00',
        fechaRevision: texto(origen.fechaRevision) || EJEMPLO.fechaRevision,
        nombreVerifica: texto(origen.nombreVerifica),
        fechaVerificacion: texto(origen.fechaVerificacion),
        instrumento: texto(origen.instrumento),
        queMide: texto(origen.queMide),
        patronNombre: texto(origen.patronNombre),
        patronClave: texto(origen.patronClave),
        patronUnidad: texto(origen.patronUnidad),
        recursoId: texto(origen.recursoId),
        recursoUnidad: texto(origen.recursoUnidad),
        intervalos,
        corridas,
        resultado: normalizarResultado(origen.resultado),
        accion: texto(origen.accion),
        pdfFirmado: sanitizarPdf(origen.pdfFirmado),
        pdfsHistorial: hist
    };
}

function datosEjemploSiVacio(datos) {
    const d = datos || sanitizarDatos({});
    const vacio = !d.instrumento && !d.recursoId && d.corridas.length <= 1
        && d.corridas.every((c) => c.estandar == null && c.mediciones.every((m) => m == null));
    if (vacio) return sanitizarDatos(EJEMPLO);
    return d;
}

function contenidoEsEquivalente(a, b) {
    const limpio = (d) => {
        const c = sanitizarDatos(d);
        delete c.pdfFirmado;
        delete c.pdfsHistorial;
        return JSON.stringify(c);
    };
    return limpio(a) === limpio(b);
}

function filaInicioCorrida(index) {
    return FILA_DATOS + index * 3;
}

function filaCriterio(n) {
    return FILA_CRITERIO_BASE + (n - 1) * 3;
}

function filaResultado(n) {
    return FILA_RESULTADO_BASE + (n - 1) * 3;
}

function filaFinImpresion(n) {
    return FILA_FIN_BASE + (n - 1) * 3;
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) return null;
    const parsed = typeof registro.datos_json === 'string'
        ? JSON.parse(registro.datos_json)
        : registro.datos_json;
    if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length) return null;
    return sanitizarDatos(parsed);
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function construirRespuesta(registro, datos, archivo) {
    const driveId = archivo?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    return {
        codigo: CODIGO_VISIBLE,
        datos: sanitizarDatos(datos),
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original || null,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
        contenidoModificado: !!registro?.contenido_modificado,
        driveFileId: driveId,
        editorUrl: `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`,
        previewUrl: `https://docs.google.com/spreadsheets/d/${driveId}/preview`,
        ultimaSyncDrive: registro?.ultima_sync_drive || null
    };
}

async function resolverDriveFileId() {
    const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
    if (existe) return DRIVE_FILE_ID_SISTEMA;
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const hoja = (archivos || []).find((f) => String(f.mimeType || '').includes('spreadsheet'));
    if (!hoja?.id) throw new Error('No se encontró la hoja SGC-F-27 de verificación en Drive.');
    return hoja.id;
}

async function metadatosHojas(spreadsheetId) {
    const sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    return meta.data.sheets || [];
}

async function asegurarHojaListas(spreadsheetId) {
    const hojas = await metadatosHojas(spreadsheetId);
    const existe = hojas.some((h) => (h.properties?.title || '') === HOJA_LISTAS);
    if (!existe) {
        await driveService.crearHojaGoogleSheet(spreadsheetId, HOJA_LISTAS);
    }
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
        range: `'${HOJA_LISTAS}'!A1:C3`,
        values: [
            ['Estatus', '', 'Resultado'],
            ['OK', '', 'Verificación aprobada'],
            ['Fuera de rango', '', 'Verificación no aprobada']
        ]
    }]);
}

function valorCeldaApi(valor) {
    if (valor == null) return '';
    if (typeof valor === 'object') {
        if (valor.formattedValue != null) return valor.formattedValue;
        const ev = valor.effectiveValue || valor.userEnteredValue || {};
        if (ev.numberValue != null) return ev.numberValue;
        if (ev.stringValue != null) return ev.stringValue;
        return '';
    }
    return valor;
}

async function leerColumnaA(spreadsheetId, titulo) {
    const sheets = clienteSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${titulo}'!A1:A80`,
        valueRenderOption: 'FORMATTED_VALUE'
    });
    const filas = res.data.values || [];
    return filas.map((r) => texto(r && r[0]));
}

async function contarCorridasEnHoja(spreadsheetId, titulo) {
    const col = await leerColumnaA(spreadsheetId, titulo);
    const idx = col.findIndex((v) => v.toLowerCase().startsWith('criterio de acept'));
    if (idx < 0) return 1;
    const fila = idx + 1;
    const n = (fila - FILA_CRITERIO_BASE) / 3 + 1;
    if (!Number.isInteger(n) || n < 1 || n > MAX_CORRIDAS + 4) return 1;
    return n;
}

async function ajustarBloquesCorrida(spreadsheetId, sheetId, titulo, nObjetivo) {
    const actual = await contarCorridasEnHoja(spreadsheetId, titulo);
    const delta = nObjetivo - actual;
    if (delta > 0) {
        const startIndex = FILA_DATOS + actual * 3 - 1;
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, startIndex, delta * 3, {
            inheritFromBefore: true
        });
    } else if (delta < 0) {
        const startIndex = FILA_DATOS + nObjetivo * 3 - 1;
        await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, startIndex, (-delta) * 3);
    }
}

function requestsFormato(sheetId, datos) {
    const n = datos.corridas.length;
    const inicio = FILA_DATOS - 1;
    const finDatos = FILA_DATOS - 1 + n * 3;
    const requests = [{
        unmergeCells: {
            range: {
                sheetId,
                startRowIndex: inicio,
                endRowIndex: finDatos,
                startColumnIndex: 0,
                endColumnIndex: 10
            }
        }
    }];

    datos.corridas.forEach((_, i) => {
        const row = FILA_DATOS - 1 + i * 3;
        [0, 1, 5, 6, 7, 8, 9].forEach((col) => {
            requests.push({
                mergeCells: {
                    mergeType: 'MERGE_ALL',
                    range: {
                        sheetId,
                        startRowIndex: row,
                        endRowIndex: row + 3,
                        startColumnIndex: col,
                        endColumnIndex: col + 1
                    }
                }
            });
        });
        const estatus = datos.corridas[i].estatus;
        const fondo = estatus === 'OK'
            ? { red: 0.714, green: 0.843, blue: 0.659 }
            : (estatus === 'Fuera de rango'
                ? { red: 0.957, green: 0.8, blue: 0.8 }
                : { red: 1, green: 1, blue: 1 });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: row,
                    endRowIndex: row + 3,
                    startColumnIndex: 9,
                    endColumnIndex: 10
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: fondo,
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        textFormat: { ...FUENTE, bold: true }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)'
            }
        });
        requests.push({
            setDataValidation: {
                range: {
                    sheetId,
                    startRowIndex: row,
                    endRowIndex: row + 3,
                    startColumnIndex: 9,
                    endColumnIndex: 10
                },
                rule: {
                    condition: {
                        type: 'ONE_OF_RANGE',
                        values: [{ userEnteredValue: `='${HOJA_LISTAS}'!$A$2:$A$3` }]
                    },
                    showCustomUi: true,
                    strict: false
                }
            }
        });
    });

    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: inicio,
                endRowIndex: finDatos,
                startColumnIndex: 0,
                endColumnIndex: 9
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

    const numberFormats = [
        { cols: [3, 4], pattern: '0.00' },
        { cols: [7], pattern: '0.000' },
        { cols: [8], pattern: '0.00' }
    ];
    numberFormats.forEach((fmt) => {
        fmt.cols.forEach((col) => {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: inicio,
                        endRowIndex: finDatos,
                        startColumnIndex: col,
                        endColumnIndex: col + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: { type: 'NUMBER', pattern: fmt.pattern },
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            textFormat: FUENTE
                        }
                    },
                    fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,textFormat)'
                }
            });
        });
    });

    const resRow = filaResultado(n) - 1;
    requests.push({
        unmergeCells: {
            range: {
                sheetId,
                startRowIndex: resRow,
                endRowIndex: resRow + 1,
                startColumnIndex: 0,
                endColumnIndex: 10
            }
        }
    });
    requests.push({
        mergeCells: {
            mergeType: 'MERGE_ALL',
            range: {
                sheetId,
                startRowIndex: resRow,
                endRowIndex: resRow + 1,
                startColumnIndex: 0,
                endColumnIndex: 2
            }
        }
    });
    requests.push({
        mergeCells: {
            mergeType: 'MERGE_ALL',
            range: {
                sheetId,
                startRowIndex: resRow,
                endRowIndex: resRow + 1,
                startColumnIndex: 2,
                endColumnIndex: 10
            }
        }
    });
    requests.push({
        setDataValidation: {
            range: {
                sheetId,
                startRowIndex: resRow,
                endRowIndex: resRow + 1,
                startColumnIndex: 0,
                endColumnIndex: 2
            },
            rule: {
                condition: {
                    type: 'ONE_OF_RANGE',
                    values: [{ userEnteredValue: `='${HOJA_LISTAS}'!$C$2:$C$3` }]
                },
                showCustomUi: true,
                strict: false
            }
        }
    });
    return requests;
}

function actualizacionesValores(titulo, datos) {
    const n = datos.corridas.length;
    const intervalos = [...datos.intervalos];
    while (intervalos.length < MAX_INTERVALOS) intervalos.push('');
    const header = [{
        range: `'${titulo}'!C5`,
        values: [[datos.nombreVerifica]]
    }, {
        range: `'${titulo}'!I5`,
        values: [[datos.fechaVerificacion]]
    }, {
        range: `'${titulo}'!C6`,
        values: [[datos.instrumento]]
    }, {
        range: `'${titulo}'!I6`,
        values: [[datos.queMide]]
    }, {
        range: `'${titulo}'!C8`,
        values: [[datos.patronNombre]]
    }, {
        range: `'${titulo}'!E8`,
        values: [[datos.patronClave]]
    }, {
        range: `'${titulo}'!I8`,
        values: [[datos.patronUnidad]]
    }, {
        range: `'${titulo}'!C11`,
        values: [[datos.recursoId]]
    }, {
        range: `'${titulo}'!G11`,
        values: [[datos.recursoUnidad]]
    }, {
        range: `'${titulo}'!C12`,
        values: [[intervalos[0]]]
    }, {
        range: `'${titulo}'!E12`,
        values: [[intervalos[1]]]
    }, {
        range: `'${titulo}'!G12`,
        values: [[intervalos[2]]]
    }, {
        range: `'${titulo}'!I12`,
        values: [[intervalos[3]]]
    }];

    const bloques = [];
    datos.corridas.forEach((c, i) => {
        const r = filaInicioCorrida(i);
        const estandar = c.estandar == null ? '' : c.estandar;
        const xi = (k) => (c.mediciones[k] == null ? '' : c.mediciones[k]);
        bloques.push(
            { range: `'${titulo}'!A${r}`, values: [[i + 1]] },
            { range: `'${titulo}'!B${r}`, values: [[estandar]] },
            { range: `'${titulo}'!C${r}:C${r + 2}`, values: [[xi(0)], [xi(1)], [xi(2)]] },
            { range: `'${titulo}'!D${r}:D${r + 2}`, values: [[`=C${r}-$B$${r}`], [`=C${r + 1}-$B$${r}`], [`=C${r + 2}-$B$${r}`]] },
            { range: `'${titulo}'!E${r}:E${r + 2}`, values: [[`=(D${r})^2`], [`=(D${r + 1})^2`], [`=(D${r + 2})^2`]] },
            { range: `'${titulo}'!F${r}`, values: [[`=SUM(E${r}:E${r + 2})`]] },
            { range: `'${titulo}'!G${r}`, values: [['=3-1']] },
            { range: `'${titulo}'!H${r}`, values: [[`=F${r}/G${r}`]] },
            { range: `'${titulo}'!I${r}`, values: [[`=SQRT(H${r})`]] },
            { range: `'${titulo}'!J${r}`, values: [[c.estatus || '']] }
        );
    });

    const rr = filaResultado(n);
    bloques.push({
        range: `'${titulo}'!A${rr}`,
        values: [[datos.resultado || '']]
    });
    bloques.push({
        range: `'${titulo}'!C${rr}`,
        values: [[datos.accion || '']]
    });
    return header.concat(bloques);
}

async function escribirEnHoja(spreadsheetId, datos) {
    const hojas = await metadatosHojas(spreadsheetId);
    const hoja = hojas.find((h) => (h.properties?.title || '') === SHEET_TITLE) || hojas[0];
    if (!hoja) throw new Error('La hoja de trabajo SGC-F-27 no existe.');
    const titulo = hoja.properties.title;
    const sheetId = hoja.properties.sheetId;
    await asegurarHojaListas(spreadsheetId);
    await ajustarBloquesCorrida(spreadsheetId, sheetId, titulo, datos.corridas.length);
    const sheets = clienteSheets();
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: requestsFormato(sheetId, datos) }
    });
    await driveService.actualizarCeldasGoogleSheet(
        spreadsheetId,
        actualizacionesValores(titulo, datos)
    );
    return titulo;
}

async function leerDatosDesdeDrive(spreadsheetId) {
    const hojas = await metadatosHojas(spreadsheetId);
    const hoja = hojas.find((h) => (h.properties?.title || '') === SHEET_TITLE) || hojas[0];
    if (!hoja) return sanitizarDatos(EJEMPLO);
    const titulo = hoja.properties.title;
    const n = await contarCorridasEnHoja(spreadsheetId, titulo);
    const sheets = clienteSheets();
    const fin = filaFinImpresion(n);
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [`'${titulo}'!A1:J${fin}`],
        includeGridData: true,
        fields: 'sheets(data(rowData(values(formattedValue,effectiveValue))))'
    });
    const rows = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
    const val = (r, c) => valorCeldaApi(rows[r - 1]?.values?.[c]);
    const corridas = [];
    for (let i = 0; i < n; i++) {
        const r = filaInicioCorrida(i);
        corridas.push({
            estandar: aNumero(val(r, 1)),
            mediciones: [0, 1, 2].map((k) => aNumero(val(r + k, 2))),
            estatus: normalizarEstatus(val(r, 9))
        });
    }
    const rr = filaResultado(n);
    const intervalos = [val(12, 2), val(12, 4), val(12, 6), val(12, 8)].map(texto).filter(Boolean);
    return sanitizarDatos({
        nombreVerifica: val(5, 2),
        fechaVerificacion: val(5, 8),
        instrumento: val(6, 2),
        queMide: val(6, 8),
        patronNombre: val(8, 2),
        patronClave: val(8, 4),
        patronUnidad: val(8, 8),
        recursoId: val(11, 2),
        recursoUnidad: val(11, 6),
        intervalos,
        corridas,
        resultado: val(rr, 0),
        accion: val(rr, 2)
    });
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(EJEMPLO);
    } else {
        datos = datosEjemploSiVacio(datos);
    }
    const driveFileId = await resolverDriveFileId().catch(() => DRIVE_FILE_ID_SISTEMA);
    return construirRespuesta(
        { ...(registro || {}), drive_file_id: driveFileId },
        datos,
        { id: driveFileId }
    );
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) {
        return sincronizarDesdeDrive(pool);
    }
    const registroPrevio = await obtenerRegistroDb(pool);
    const previos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(EJEMPLO);
    const entrada = sanitizarDatos(body?.datos || body);
    entrada.pdfFirmado = previos.pdfFirmado;
    entrada.pdfsHistorial = previos.pdfsHistorial;
    const driveFileId = await resolverDriveFileId();
    await escribirEnHoja(driveFileId, entrada);
    const modificado = !contenidoEsEquivalente(previos, entrada);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: entrada,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || entrada.fechaElaboracion,
        fechaModificacionContenido: modificado
            ? excelHistorial.fechaAhoraMexicoIso()
            : registroPrevio?.fecha_modificacion_contenido,
        contenidoModificado: modificado || !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, entrada, { id: driveFileId });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const previos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(EJEMPLO);
    const driveFileId = await resolverDriveFileId();
    const leidos = await leerDatosDesdeDrive(driveFileId);
    leidos.pdfFirmado = previos.pdfFirmado;
    leidos.pdfsHistorial = previos.pdfsHistorial;
    leidos.fechaElaboracion = previos.fechaElaboracion;
    leidos.revision = previos.revision || leidos.revision;
    leidos.fechaRevision = previos.fechaRevision || leidos.fechaRevision;
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: leidos,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || leidos.fechaElaboracion,
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, leidos, { id: driveFileId });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const driveFileId = await resolverDriveFileId();
    await asegurarHojaListas(driveFileId);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(EJEMPLO);
    return construirRespuesta(registro || {}, datos, { id: driveFileId });
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const driveFileId = await resolverDriveFileId();
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* ignore */ }
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(EJEMPLO);
    return construirRespuesta(
        { ...(registro || {}), drive_file_id: driveFileId },
        datos,
        { id: driveFileId }
    );
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(EJEMPLO);
    const driveFileId = await resolverDriveFileId();
    let titulo = SHEET_TITLE;
    try {
        titulo = await escribirEnHoja(driveFileId, datos);
    } catch (err) {
        console.warn('[SGC-F-27 medición] PDF sin reescritura previa:', err.message);
    }
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, titulo);
    if (gid == null) throw new Error('No se encontró la hoja para exportar el PDF.');
    const ultima = filaFinImpresion(datos.corridas.length);
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: false,
        size: 'letter',
        margins: 'normal',
        fitToWidth: true,
        verticalAlignment: 'TOP',
        horizontalAlignment: 'CENTER',
        pageOrder: 'down',
        range: { r1: 0, r2: ultima, c1: 0, c2: 10 }
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-27 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

function nombrePdfFirmado(datos, historial) {
    const ref = texto(datos?.recursoId || datos?.instrumento || 'equipo').replace(/[^\w.\- ]+/g, '').trim() || 'equipo';
    const n = (Array.isArray(historial) ? historial.length : 0) + 1;
    const seq = String(n).padStart(2, '0');
    return `SGC-F-27 Verificacion ${ref} firmado - ${seq}.pdf`;
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');
    if (pdfBuffer.length > 20 * 1024 * 1024) throw new Error('El PDF supera 20 MB.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(EJEMPLO);
    const historial = Array.isArray(datos.pdfsHistorial) ? datos.pdfsHistorial : [];
    const nombre = texto(body?.nombreArchivo) || nombrePdfFirmado(datos, historial);
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombre.endsWith('.pdf') ? nombre : `${nombre}.pdf`,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
    const pdfFirmado = sanitizarPdf({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombre,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: excelHistorial.fechaAhoraMexicoIso()
    });
    datos.pdfFirmado = pdfFirmado;
    datos.pdfsHistorial = [pdfFirmado, ...historial.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)];
    const driveFileId = registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || datos.fechaElaboracion,
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return {
        ...construirRespuesta(registro, datos, { id: driveFileId }),
        pdfFirmado
    };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = texto(body?.driveFileId || body?.drive_file_id);
    if (!driveFileId) throw new Error('driveFileId es requerido.');
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(EJEMPLO);
    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[SGC-F-27 medición] No se pudo borrar el PDF en Drive:', err.message);
    });
    const hist = (datos.pdfsHistorial || []).filter((p) => p.driveFileId !== driveFileId);
    let vigente = datos.pdfFirmado;
    if (vigente?.driveFileId === driveFileId) vigente = hist[0] || null;
    datos.pdfsHistorial = hist;
    datos.pdfFirmado = vigente;
    const hojaId = registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    await guardarRegistroDb(pool, {
        driveFileId: hojaId,
        datos,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: registroPrevio?.fecha_modificacion_contenido,
        contenidoModificado: !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datos, { id: hojaId });
}

module.exports = {
    CODIGO_FORMATO,
    CODIGO_VISIBLE,
    ESTATUS,
    RESULTADOS,
    LIMITE_S,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    subirPdfFirmado,
    eliminarPdfHistorial,
    sanitizarDatos
};
