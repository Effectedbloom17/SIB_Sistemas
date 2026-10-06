/**
 * SGC-F-19 · Listado de conocimientos de la organización (ISO 7.1.6).
 * Tabla en el sistema, hoja vigente en Drive y PDFs firmados en carpeta aparte.
 * La plantilla maestra no se edita: la primera carga la copia al capítulo 7.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-19';
const TEMPLATE_DRIVE_ID = '1ExqXpnX4J617v1V2JimjEzg1VN_sV0XJOHQnaCxTLMA';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1NocNp6nAtHdseYLpU1KozGdW_zVdE_SP';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-19 Listado de conocimientos de la organización (sistema)';
const SHEET_TITLE = 'Copia de Listado de conocimientos';
const NOMBRE_PDF_ARCHIVO = 'SGC-F-19 Listado de conocimientos de la organización.pdf';

const DATA_START_ROW = 6;
const FILAS_BASE = 15;
const MAX_FILAS = 80;
const COLUMNAS_HOJA = 10;
const BORDE = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };

const FIRMA = {
    elaboro: 'Coordinador del SGC',
    reviso: 'Directora General'
};

const REGISTRO_DEFECTO = {
    conocimiento: '',
    tipoFuente: '',
    puesto: '',
    disponibleEn: ''
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-20',
    fechaRevision: '2025-01-20',
    revision: '00',
    registros: [],
    pdfFirmado: null,
    pdfsHistorial: []
};

function texto(valor) {
    return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
        const y = fecha.getUTCFullYear();
        const mo = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const day = String(fecha.getUTCDate()).padStart(2, '0');
        if (y > 1900) return `${y}-${mo}-${day}`;
    }
    const t = String(fecha).trim();
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const m = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!m) return '';
    const day = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let y = m[3];
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    return `${y}-${mo}-${day}`;
}

function fechaCortaHoja(iso) {
    const t = formatearFechaIso(iso);
    if (!t) return '';
    const [y, m, d] = t.split('-');
    return `${d}-${m}-${y.slice(2)}`;
}

function clienteSheets() {
    return google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
}

function rango(titulo, a1) {
    return `'${String(titulo).replace(/'/g, "''")}'!${a1}`;
}

function sanitizarRegistro(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        conocimiento: texto(base.conocimiento),
        tipoFuente: texto(base.tipoFuente || base.tipo_fuente),
        puesto: texto(base.puesto),
        disponibleEn: texto(base.disponibleEn || base.disponible_en)
    };
}

function registroTieneDatos(registro) {
    return !!(registro.conocimiento || registro.tipoFuente || registro.puesto || registro.disponibleEn);
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = texto(raw.driveFileId || raw.drive_file_id);
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: texto(raw.nombreArchivo || raw.nombre_archivo) || NOMBRE_PDF_ARCHIVO,
        webViewLink: texto(raw.webViewLink || raw.web_view_link) || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarPdfsHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    const vistos = new Set();
    const lista = [];
    for (const item of raw) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || vistos.has(pdf.driveFileId)) continue;
        vistos.add(pdf.driveFileId);
        lista.push(pdf);
    }
    return lista;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const registros = (Array.isArray(base.registros) ? base.registros : [])
        .map(sanitizarRegistro)
        .filter(registroTieneDatos)
        .slice(0, MAX_FILAS);
    return {
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        revision: texto(base.revision || '00').padStart(2, '0').slice(-2),
        registros,
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial),
        _metaHoja: base._metaHoja || null
    };
}

function firmaContenido(datos) {
    const d = datos || {};
    return {
        revision: texto(d.revision),
        fechaRevision: formatearFechaIso(d.fechaRevision),
        registros: (d.registros || []).map((r) => ({
            conocimiento: r.conocimiento,
            tipoFuente: r.tipoFuente,
            puesto: r.puesto,
            disponibleEn: r.disponibleEn
        }))
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(firmaContenido(a)) === JSON.stringify(firmaContenido(b));
}

function estructuraEsEquivalente() {
    return true;
}

function filaValores(registro) {
    const r = registro || REGISTRO_DEFECTO;
    const fila = new Array(COLUMNAS_HOJA).fill('');
    fila[0] = r.conocimiento || '';
    fila[4] = r.tipoFuente || '';
    fila[6] = r.puesto || '';
    fila[8] = r.disponibleEn || '';
    return fila;
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

function construirRespuesta(registro, datos, archivoDrive) {
    const limpio = sanitizarDatos(datos);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || limpio.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const editorUrl = driveId
        ? (driveService.construirUrlEditorGoogleSheet(driveId) || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`)
        : null;
    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...limpio,
            fechaElaboracion: fechaMostrar,
            firma: FIRMA
        },
        fechaElaboracionOriginal: fechaOriginal || limpio.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        pdfPreviewUrl: limpio.pdfFirmado?.previewUrl || null,
        pdfDriveFileId: limpio.pdfFirmado?.driveFileId || null,
        historialPdfs: limpio.pdfsHistorial,
        carpetaFirmadosUrl: `https://drive.google.com/drive/folders/${CARPETA_PDF_FIRMADOS_ID}`
    };
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .filter((f) => String(f.id || '') !== TEMPLATE_DRIVE_ID)
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
        console.warn('[SGC-F-19] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function crearCopiaSistema() {
    const archivo = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (!archivo?.id) throw new Error('No se pudo copiar la plantilla SGC-F-19.');
    try {
        await driveService.asignarPermisoEscrituraEnlace(archivo.id);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo compartir la copia:', err.message);
    }
    return archivo.id;
}

async function resolverDriveFileId(registro) {
    const candidatos = [];
    const agregar = (id) => {
        const val = texto(id);
        if (val && val !== TEMPLATE_DRIVE_ID && !candidatos.includes(val)) candidatos.push(val);
    };
    agregar(registro?.drive_file_id);
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    agregar(enCarpeta?.id);
    for (const id of candidatos) {
        if (await esSpreadsheetEditableEnDrive(id)) return id;
    }
    return null;
}

async function asegurarCopiaSistema(pool, registro) {
    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId) return driveFileId;
    driveFileId = await crearCopiaSistema();
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });
    return driveFileId;
}

async function resolverHoja(spreadsheetId, tituloPreferido) {
    const sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hojas = meta.data.sheets || [];
    const titulo = texto(tituloPreferido);
    const exacta = hojas.find((s) => texto(s.properties?.title) === titulo);
    const base = exacta
        || hojas.find((s) => texto(s.properties?.title) === SHEET_TITLE)
        || hojas.find((s) => !excelHistorial.esHojaHistorial(s.properties?.title, CODIGO_FORMATO))
        || hojas[0];
    if (!base?.properties) throw new Error('La hoja SGC-F-19 no está disponible.');
    return {
        sheets,
        sheetId: base.properties.sheetId,
        title: base.properties.title
    };
}

async function filaElaboro(spreadsheetId, titulo) {
    const sheets = clienteSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rango(titulo, 'C1:C120'),
        valueRenderOption: 'FORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
        if (texto(rows[i]?.[0]).toUpperCase().includes('ELABOR')) return i + 1;
    }
    return DATA_START_ROW + FILAS_BASE + 2;
}

async function leerDatosDesdeHoja(spreadsheetId, tituloHoja) {
    const hoja = await resolverHoja(spreadsheetId, tituloHoja || SHEET_TITLE);
    const sheets = clienteSheets();
    const elaboro = await filaElaboro(spreadsheetId, hoja.title);
    const fin = Math.max(DATA_START_ROW, elaboro - 3);
    const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [
            rango(hoja.title, 'I2'),
            rango(hoja.title, 'I3'),
            rango(hoja.title, `A${DATA_START_ROW}:J${fin}`)
        ],
        valueRenderOption: 'FORMATTED_VALUE'
    });
    const bloques = res.data.valueRanges || [];
    const revRaw = texto(bloques[0]?.values?.[0]?.[0]);
    const fechaRaw = texto(bloques[1]?.values?.[0]?.[0]);
    const revMatch = revRaw.match(/(\d+)/);
    const filas = bloques[2]?.values || [];
    const registros = [];
    for (const fila of filas) {
        const registro = sanitizarRegistro({
            conocimiento: fila?.[0],
            tipoFuente: fila?.[4],
            puesto: fila?.[6],
            disponibleEn: fila?.[8]
        });
        if (!registroTieneDatos(registro)) continue;
        registros.push(registro);
    }
    return sanitizarDatos({
        revision: revMatch ? revMatch[1] : '00',
        fechaRevision: formatearFechaIso(fechaRaw) || DATOS_DEFECTO.fechaRevision,
        registros
    });
}

async function ajustarFilasDatos(spreadsheetId, hoja, elaboro, cantidad) {
    const objetivo = Math.min(MAX_FILAS, Math.max(0, cantidad));
    let firma = elaboro;
    let capacidad = Math.max(0, firma - DATA_START_ROW - 2);
    if (objetivo > capacidad) {
        const extra = objetivo - capacidad;
        const indice = capacidad > 0 ? firma - 3 : DATA_START_ROW - 1;
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            hoja.sheetId,
            indice,
            extra,
            { inheritFromBefore: capacidad > 0 }
        );
        firma += extra;
        capacidad = objetivo;
    } else if (objetivo < capacidad) {
        const sobrantes = capacidad - objetivo;
        await driveService.eliminarFilasGoogleSheet(
            spreadsheetId,
            hoja.sheetId,
            (DATA_START_ROW - 1) + objetivo,
            sobrantes
        );
        firma -= sobrantes;
        capacidad = objetivo;
    }
    return { elaboro: firma, capacidad };
}

async function escribirEnHoja(spreadsheetId, tituloHoja, datos) {
    const limpio = sanitizarDatos(datos);
    const hoja = await resolverHoja(spreadsheetId, tituloHoja || SHEET_TITLE);
    const elaboro = await filaElaboro(spreadsheetId, hoja.title);
    const ajuste = await ajustarFilasDatos(spreadsheetId, hoja, elaboro, limpio.registros.length);
    const capacidad = ajuste.capacidad;
    const sheets = clienteSheets();
    const actualizaciones = [
        {
            range: rango(hoja.title, 'I2'),
            values: [[`No. Rev.: ${limpio.revision}`]]
        },
        {
            range: rango(hoja.title, 'I3'),
            values: [[`Fecha Rev.: ${fechaCortaHoja(limpio.fechaRevision)}`]]
        }
    ];
    if (capacidad > 0) {
        const inicio = DATA_START_ROW - 1;
        const fin = DATA_START_ROW + capacidad - 1;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    unmergeCells: {
                        range: {
                            sheetId: hoja.sheetId,
                            startRowIndex: inicio,
                            endRowIndex: fin,
                            startColumnIndex: 0,
                            endColumnIndex: COLUMNAS_HOJA
                        }
                    }
                }]
            }
        });
        const valores = [];
        for (let i = 0; i < capacidad; i++) {
            valores.push(filaValores(limpio.registros[i] || null));
        }
        actualizaciones.unshift({
            range: rango(hoja.title, `A${DATA_START_ROW}:J${fin}`),
            values: valores
        });
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
        const requests = [];
        for (let row = inicio; row < fin; row++) {
            [[0, 4], [4, 6], [6, 8], [8, 10]].forEach(([c0, c1]) => {
                requests.push({
                    mergeCells: {
                        range: {
                            sheetId: hoja.sheetId,
                            startRowIndex: row,
                            endRowIndex: row + 1,
                            startColumnIndex: c0,
                            endColumnIndex: c1
                        },
                        mergeType: 'MERGE_ALL'
                    }
                });
            });
        }
        requests.push({
            repeatCell: {
                range: {
                    sheetId: hoja.sheetId,
                    startRowIndex: inicio,
                    endRowIndex: fin,
                    startColumnIndex: 0,
                    endColumnIndex: COLUMNAS_HOJA
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat: { fontFamily: 'Century Gothic', fontSize: 11 },
                        borders: { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,borders)'
            }
        });
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
        return hoja.title;
    }
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    return hoja.title;
}

async function aplicarHistorial(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: async (spreadsheetId, hoja, datos) => {
            await escribirEnHoja(spreadsheetId, hoja, datos);
        },
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null
    });
}

function preservarPdf(entrada, previos) {
    const pdfFirmado = sanitizarPdfFirmado(entrada?.pdfFirmado)
        || sanitizarPdfFirmado(previos?.pdfFirmado)
        || null;
    const histEntrada = sanitizarPdfsHistorial(entrada?.pdfsHistorial);
    const histPrevios = sanitizarPdfsHistorial(previos?.pdfsHistorial);
    return {
        pdfFirmado,
        pdfsHistorial: histEntrada.length ? histEntrada : histPrevios
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = null;
    try {
        driveFileId = await asegurarCopiaSistema(pool, registro);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo asegurar la copia en Drive:', err.message);
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        registro = await obtenerRegistroDb(pool);
    }
    let datos = await leerDatosRegistro(registro);
    if (!datos && driveFileId) {
        try {
            const hoja = await leerDatosDesdeHoja(driveFileId, SHEET_TITLE);
            const pdf = preservarPdf(null, null);
            datos = sanitizarDatos({ ...hoja, ...pdf });
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo leer la hoja:', err.message);
        }
    }
    datos = datos || sanitizarDatos(DATOS_DEFECTO);
    const archivoDrive = driveFileId
        ? await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }))
        : null;
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) return sincronizarDesdeDrive(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const pdf = preservarPdf(datosEntrada, datosPrevios);
    const entrada = sanitizarDatos({ ...datosEntrada, ...pdf, _metaHoja: datosPrevios._metaHoja });

    const huboCambio = !contenidoEsEquivalente(datosPrevios, entrada);
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || entrada.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado || huboCambio;
    let fechaModificacion = huboCambio
        ? fechaHoyIso()
        : formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    let driveId = await asegurarCopiaSistema(pool, registroPrevio).catch(() => null);
    let datosGuardar = {
        ...entrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    if (driveId && huboCambio) {
        try {
            await escribirEnHoja(driveId, SHEET_TITLE, datosGuardar);
            const hist = await aplicarHistorial({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: datosGuardar,
                origen: 'sistema',
                forzarTipo: 'informacion'
            });
            if (hist?.datosGuardar) {
                datosGuardar = sanitizarDatos({
                    ...hist.datosGuardar,
                    ...preservarPdf(datosGuardar, datosPrevios)
                });
            }
        } catch (err) {
            console.warn('[SGC-F-19] Drive no sincronizó; la BD igual se guarda:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado,
        ultimaSyncDrive: fechaHoyIso()
    });
    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    const previos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    let hoja = null;
    try {
        hoja = await leerDatosDesdeHoja(driveFileId, SHEET_TITLE);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo importar la hoja:', err.message);
    }
    if (!hoja || (!hoja.registros.length && previos.registros.length)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, previos, archivoDrive);
    }
    const datos = sanitizarDatos({ ...hoja, ...preservarPdf(previos, previos), _metaHoja: previos._metaHoja });
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion;
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true,
        ultimaSyncDrive: fechaHoyIso()
    });
    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    await escribirEnHoja(driveFileId, SHEET_TITLE, datos);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* el enlace puede existir */ }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    try {
        await escribirEnHoja(driveFileId, SHEET_TITLE, datos);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo recortar la hoja antes del PDF:', err.message);
    }
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, SHEET_TITLE);
    if (gid == null) throw new Error('No se encontró la hoja del listado para exportar a PDF.');
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid: String(gid),
        landscape: false,
        size: 'letter',
        fitToWidth: true,
        margins: 'normal'
    });
    if (!pdfBuffer || !pdfBuffer.length) throw new Error('La exportación a PDF de SGC-F-19 quedó vacía.');
    return pdfBuffer;
}

function nombrePdfHistorial(fechaIso, historial) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const mm = iso.slice(5, 7);
    const yy = iso.slice(2, 4);
    const version = String((historial?.length || 0) + 1).padStart(2, '0');
    return `SGC-F-19 Listado de conocimientos - ${mm}/${yy} - ${version}.pdf`;
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = texto(body?.pdf_base64 || body?.pdfBase64);
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const histPrev = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial);
    const nombreArchivo = nombrePdfHistorial(fechaHoyIso(), histPrev);
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
    try {
        await driveService.asignarPermisoLecturaPublica(driveResult.id);
    } catch (_) { /* preview */ }

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });
    const pdfsHistorial = [
        pdfFirmado,
        ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)
    ];
    const datosGuardar = sanitizarDatos({ ...datosPrevios, pdfFirmado, pdfsHistorial });
    const driveFileId = registroPrevio?.drive_file_id || await resolverDriveFileId(registroPrevio);
    await guardarRegistroDb(pool, {
        driveFileId: driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosGuardar.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registroPrevio?.fecha_modificacion_contenido),
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });
    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveFileId
        ? await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }))
        : null;
    return { ...construirRespuesta(registro, datosGuardar, archivoDrive), pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileIdPdf = texto(body?.driveFileId || body?.drive_file_id);
    if (!driveFileIdPdf) throw new Error('driveFileId requerido.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    await driveService.eliminarArchivo(driveFileIdPdf).catch((err) => {
        console.warn('[SGC-F-19] No se pudo borrar PDF en Drive:', err.message);
    });
    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileIdPdf);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileIdPdf) pdfFirmado = hist[0] || null;
    const datosGuardar = sanitizarDatos({ ...datosPrevios, pdfFirmado, pdfsHistorial: hist });
    const sheetId = registroPrevio?.drive_file_id || null;
    await guardarRegistroDb(pool, {
        driveFileId: sheetId,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosGuardar.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registroPrevio?.fecha_modificacion_contenido),
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });
    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = sheetId
        ? await driveService.obtenerInfoArchivo(sheetId).catch(() => ({ id: sheetId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    subirPdfFirmado,
    eliminarPdfHistorial,
    sanitizarDatos,
    CARPETA_PDF_FIRMADOS_ID,
    NOMBRE_PDF_ARCHIVO
};
