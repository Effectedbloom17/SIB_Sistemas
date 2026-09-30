/**
 * SGC-F-17 · Bitácora de calibración y verificación de equipos de medición.
 * La hoja «Plantilla.» solo se copia. Cada modificación con cambios crea
 * una hoja «MMAA-01», «MMAA-02», … y el consecutivo vuelve a 01 al cambiar de mes.
 * Sin archivero ni versiones firmadas.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-17';
const DRIVE_FILE_ID_SISTEMA = '1XzxX2gRHUSf0z2ToPp1YCvzD6IOzzRUlpsEsY62takk';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const SHEET_TITLE = 'Plantilla.';
const HOJA_LISTAS = 'No borrar esta hoja';
const FILA_DATOS = 7;
const MAX_FILAS = 80;
const ZONA = 'America/Mexico_City';
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

const LISTAS = [
    { col: 7, rango: `='${HOJA_LISTAS}'!$A$2:$A$4` },
    { col: 8, rango: `='${HOJA_LISTAS}'!$C$2:$C$6` },
    { col: 9, rango: `='${HOJA_LISTAS}'!$E$2:$E$4` },
    { col: 11, rango: `='${HOJA_LISTAS}'!$G$2:$G$3` },
    { col: 12, rango: `='${HOJA_LISTAS}'!$I$2:$I$3` },
    { col: 15, rango: `='${HOJA_LISTAS}'!$A$10:$A$12` },
    { col: 17, rango: `='${HOJA_LISTAS}'!$E$10:$E$13` }
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

function mesTagMexico(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: ZONA,
        month: '2-digit',
        year: '2-digit'
    }).formatToParts(fecha);
    const mm = partes.find((p) => p.type === 'month')?.value || '01';
    const yy = partes.find((p) => p.type === 'year')?.value || '00';
    return `${mm}${yy}`;
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

function sanitizarHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
        const base = item && typeof item === 'object' ? item : {};
        const nombreHoja = texto(base.nombreHoja);
        if (!/^\d{4}-\d{2}$/.test(nombreHoja)) return null;
        return {
            mes: nombreHoja.slice(0, 4),
            numero: nombreHoja.slice(5),
            nombreHoja,
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
        hojaVigente: /^\d{4}-\d{2}$/.test(hojaVigente)
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

function construirRespuesta(registro, datos) {
    const driveId = registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    const limpio = sanitizarDatos(datos);
    return {
        codigo: CODIGO_FORMATO,
        datos: limpio,
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
    const hoja = (archivos || []).find((f) => String(f.name || '').includes('SGC-F-17')
        && String(f.mimeType || '').includes('spreadsheet'));
    if (!hoja?.id) throw new Error('No se encontró la bitácora SGC-F-17 en Drive.');
    return hoja.id;
}

function siguienteNombreHoja(titulos) {
    const mes = mesTagMexico();
    const re = new RegExp(`^${mes}-(\\d{2})$`);
    let max = 0;
    for (const titulo of titulos || []) {
        const match = re.exec(texto(titulo));
        if (match) max = Math.max(max, Number(match[1]));
    }
    const numero = String(max + 1).padStart(2, '0');
    return { mes, numero, nombreHoja: `${mes}-${numero}` };
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
                        type: 'ONE_OF_RANGE',
                        values: [{ userEnteredValue: lista.rango }]
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
    const titulo = String(tituloHoja || SHEET_TITLE).replace(/'/g, "''");
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

async function escribirSnapshot(spreadsheetId, datos, nombreHoja) {
    const tituloDeseado = texto(nombreHoja);
    if (!/^\d{4}-\d{2}$/.test(tituloDeseado)) {
        throw new Error('El nombre de la hoja de historial no es válido.');
    }
    const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, SHEET_TITLE, tituloDeseado);
    const titulo = texto(dup?.title) || tituloDeseado;
    const sheetId = dup?.sheetId;
    if (sheetId == null) throw new Error(`No se pudo crear la hoja «${tituloDeseado}».`);
    if (titulo === SHEET_TITLE || titulo === HOJA_LISTAS) {
        throw new Error('No se puede escribir el historial sobre la plantilla.');
    }
    try {
        const sheets = clienteSheets();
        const filas = datos.equipos.length ? datos.equipos.map(filaValores) : [filaValores(null)];
        const anchos = await anchosColumnas(spreadsheetId, SHEET_TITLE);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requestsFormato(sheetId, filas, anchos) }
        });
        const fin = FILA_DATOS + filas.length - 1;
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
            range: `'${titulo.replace(/'/g, "''")}'!A${FILA_DATOS}:Z${fin}`,
            values: filas
        }]);
        return titulo;
    } catch (error) {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]).catch(() => {});
        throw error;
    }
}

async function leerEquiposDesdeHoja(spreadsheetId, tituloHoja) {
    const titulo = texto(tituloHoja);
    if (!titulo || titulo === SHEET_TITLE || titulo === HOJA_LISTAS) return null;
    const sheets = clienteSheets();
    const fin = FILA_DATOS + MAX_FILAS - 1;
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [`'${titulo.replace(/'/g, "''")}'!A${FILA_DATOS}:Z${fin}`],
        includeGridData: true,
        fields: 'sheets(data(rowData(values(formattedValue,effectiveValue))))'
    });
    const rows = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
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
    const driveFileId = await resolverDriveFileId().catch(() => DRIVE_FILE_ID_SISTEMA);
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
    const driveFileId = await resolverDriveFileId();
    let modificado = false;
    if (!contenidoEsEquivalente(previos, entrada)) {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        const hoja = siguienteNombreHoja(titulos);
        const titulo = await escribirSnapshot(driveFileId, entrada, hoja.nombreHoja);
        entrada.historial = previos.historial.concat([{
            mes: hoja.mes,
            numero: titulo.slice(5),
            nombreHoja: titulo,
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
    const driveFileId = await resolverDriveFileId();
    if (datos.hojaVigente) {
        const equipos = await leerEquiposDesdeHoja(driveFileId, datos.hojaVigente);
        if (equipos) datos.equipos = equipos;
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
    const driveFileId = await resolverDriveFileId();
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    const driveFileId = await resolverDriveFileId();
    const hoja = datos.hojaVigente || SHEET_TITLE;
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, hoja);
    if (gid == null) {
        throw new Error('No se encontró la hoja actual para exportar a PDF.');
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
    const driveFileId = await resolverDriveFileId();
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* el enlace de lectura puede ya existir */ }
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos({});
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    sanitizarDatos
};
