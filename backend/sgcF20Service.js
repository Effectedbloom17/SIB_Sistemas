/**
 * SGC-F-20 · Ficha de conocimientos (ISO 7.1.6).
 * Archivero de fichas. La hoja vigente muestra la ficha activa.
 * Cada PDF firmado se guarda en la carpeta de firmados del capítulo.
 * La plantilla maestra no se edita: la primera carga la copia al capítulo 7.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-20';
const TEMPLATE_DRIVE_ID = '1we0bWgQpKUKybvveOrqmmrWdtfwFFIdbFMjWQs1Oxm4';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-20 Ficha de conocimientos (sistema)';
const SHEET_TITLE = 'Plantilla';
const SHEET_TITLE_ANTERIOR = 'Copia de Hoja1';
const HOJA_FUENTES = 'Hoja2';
const NOMBRE_PDF_BASE = 'SGC-F-20 Ficha de conocimientos.pdf';

const TIPOS_FUENTE = [
    'Propiedad intelectual (Interna)',
    'Conocimientos adquiridos con la experiencia (Interna)',
    'Lecciones aprendidas de los fracasos y de proyectos de éxito (Interna)',
    'Capturar y compartir conocimientos y experiencia no documentados (Interna)',
    'Resultados de mejora en los procesos, productos y servicios (Interna)',
    'Normas (Externo)',
    'Academia (Externo)',
    'Conferencias (Externo)',
    'Recopilación de conocimientos provenientes de clientes o proveedores externos (Externo)'
];

const FIRMA = {
    elaboro: 'Coordinador del SGC',
    reviso: 'Directora General'
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-20',
    fechaRevision: '2025-01-20',
    revision: '00',
    fichas: [],
    fichaActivaId: null
};

function texto(valor) {
    return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
}

function textoLargo(valor) {
    return String(valor == null ? '' : valor)
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso();
}

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `fc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
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
    const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
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

function extraerRevision(valor) {
    const match = texto(valor).match(/(\d+)/);
    return (match ? match[1] : '00').padStart(2, '0').slice(-2);
}

function clienteSheets() {
    return google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
}

function rango(titulo, a1) {
    return `'${String(titulo).replace(/'/g, "''")}'!${a1}`;
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = texto(raw.driveFileId || raw.drive_file_id);
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: texto(raw.nombreArchivo || raw.nombre_archivo) || NOMBRE_PDF_BASE,
        webViewLink: texto(raw.webViewLink || raw.web_view_link) || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarFicha(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const tipo = texto(base.tipoFuente || base.tipo_fuente);
    return {
        id: texto(base.id) || nuevoId(),
        folio: texto(base.folio).toUpperCase(),
        tipoFuente: tipo,
        descripcion: textoLargo(base.descripcion),
        fechaCaptura: formatearFechaIso(base.fechaCaptura || base.fecha_captura),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado)
    };
}

function fichaTieneDatos(ficha) {
    return !!(ficha && (ficha.tipoFuente || ficha.descripcion || ficha.fechaCaptura || ficha.folio || ficha.pdfFirmado));
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const fichas = (Array.isArray(base.fichas) ? base.fichas : [])
        .map(sanitizarFicha)
        .filter(fichaTieneDatos);
    const activa = texto(base.fichaActivaId || base.ficha_activa_id);
    return {
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        revision: extraerRevision(base.revision || '00'),
        fichas,
        fichaActivaId: activa && fichas.some((f) => f.id === activa) ? activa : (fichas[0]?.id || null),
        _metaHoja: base._metaHoja || null
    };
}

function resolverFichaActiva(datos) {
    const lista = Array.isArray(datos?.fichas) ? datos.fichas : [];
    if (!lista.length) return null;
    const id = datos?.fichaActivaId;
    if (id) {
        const found = lista.find((f) => f.id === id);
        if (found) return found;
    }
    return lista[0];
}

function firmaContenido(datos) {
    const d = sanitizarDatos(datos || {});
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fichaActivaId: d.fichaActivaId,
        fichas: d.fichas.map((f) => ({
            id: f.id,
            folio: f.folio,
            tipoFuente: f.tipoFuente,
            descripcion: f.descripcion,
            fechaCaptura: f.fechaCaptura
        }))
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(firmaContenido(a)) === JSON.stringify(firmaContenido(b));
}

function estructuraEsEquivalente() {
    return true;
}

function conservarPdfs(entrada, previos) {
    const mapa = new Map((previos?.fichas || []).map((f) => [f.id, f.pdfFirmado]));
    return sanitizarDatos({
        ...entrada,
        fichas: (entrada.fichas || []).map((f) => ({
            ...f,
            pdfFirmado: f.pdfFirmado || mapa.get(f.id) || null
        }))
    });
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
            firma: FIRMA,
            tiposFuente: TIPOS_FUENTE
        },
        fechaElaboracionOriginal: fechaOriginal || limpio.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: registro?.ultima_sync_drive
            ? formatearDatetimeMysqlMexico(registro.ultima_sync_drive)
            : (archivoDrive?.modifiedTime ? formatearDatetimeMysqlMexico(archivoDrive.modifiedTime) : null),
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
        console.warn('[SGC-F-20] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function crearCopiaSistema() {
    const archivo = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (!archivo?.id) throw new Error('No se pudo copiar la plantilla SGC-F-20.');
    try {
        await driveService.asignarPermisoEscrituraEnlace(archivo.id);
    } catch (err) {
        console.warn('[SGC-F-20] No se pudo compartir la copia:', err.message);
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
        fields: 'sheets.properties(sheetId,title,hidden)'
    });
    const hojas = meta.data.sheets || [];
    const titulo = texto(tituloPreferido);
    const exacta = hojas.find((s) => texto(s.properties?.title) === titulo);
    const base = exacta
        || hojas.find((s) => texto(s.properties?.title) === SHEET_TITLE)
        || hojas.find((s) => texto(s.properties?.title) === SHEET_TITLE_ANTERIOR)
        || hojas.find((s) => !excelHistorial.esHojaHistorial(s.properties?.title, CODIGO_FORMATO) && texto(s.properties?.title) !== HOJA_FUENTES)
        || hojas[0];
    if (!base?.properties) throw new Error('La hoja SGC-F-20 no está disponible.');
    return {
        sheets,
        sheetId: base.properties.sheetId,
        title: base.properties.title
    };
}

async function asegurarCatalogoFuentes(spreadsheetId, hojaDestino) {
    const sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title,hidden)'
    });
    const hojas = meta.data.sheets || [];
    let fuentes = hojas.find((s) => texto(s.properties?.title) === HOJA_FUENTES);
    const requests = [];
    if (!fuentes) {
        const creada = await driveService.crearHojaGoogleSheet(spreadsheetId, HOJA_FUENTES);
        fuentes = { properties: { sheetId: creada.sheetId, title: creada.title } };
        requests.push({
            updateSheetProperties: {
                properties: { sheetId: creada.sheetId, hidden: true },
                fields: 'hidden'
            }
        });
    } else if (!fuentes.properties.hidden) {
        requests.push({
            updateSheetProperties: {
                properties: { sheetId: fuentes.properties.sheetId, hidden: true },
                fields: 'hidden'
            }
        });
    }
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
        range: rango(HOJA_FUENTES, 'A1:A10'),
        values: [['Tipo de fuente'], ...TIPOS_FUENTE.map((t) => [t])]
    }]);
    if (hojaDestino?.sheetId != null) {
        requests.push({
            setDataValidation: {
                range: {
                    sheetId: hojaDestino.sheetId,
                    startRowIndex: 8,
                    endRowIndex: 9,
                    startColumnIndex: 2,
                    endColumnIndex: 3
                },
                rule: {
                    condition: {
                        type: 'ONE_OF_RANGE',
                        values: [{ userEnteredValue: `=${HOJA_FUENTES}!$A$2:$A$10` }]
                    },
                    strict: false,
                    showCustomUi: true
                }
            }
        });
        requests.push({
            unmergeCells: {
                range: {
                    sheetId: hojaDestino.sheetId,
                    startRowIndex: 11,
                    endRowIndex: 27,
                    startColumnIndex: 0,
                    endColumnIndex: 5
                }
            }
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId: hojaDestino.sheetId,
                    startRowIndex: 11,
                    endRowIndex: 27,
                    startColumnIndex: 0,
                    endColumnIndex: 5
                },
                mergeType: 'MERGE_ALL'
            }
        });
    }
    if (requests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    }
}

async function leerDatosDesdeHoja(spreadsheetId, tituloHoja) {
    const hoja = await resolverHoja(spreadsheetId, tituloHoja || SHEET_TITLE);
    const sheets = clienteSheets();
    const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [
            rango(hoja.title, 'D2'),
            rango(hoja.title, 'D3'),
            rango(hoja.title, 'C9'),
            rango(hoja.title, 'A12'),
            rango(hoja.title, 'D30')
        ],
        valueRenderOption: 'FORMATTED_VALUE'
    });
    const bloques = res.data.valueRanges || [];
    const pick = (i) => texto(bloques[i]?.values?.[0]?.[0]);
    const tipo = pick(2);
    const descripcion = textoLargo(bloques[3]?.values?.[0]?.[0]);
    const fecha = formatearFechaIso(pick(4));
    const placeholder = tipo === TIPOS_FUENTE[0] && !descripcion && !fecha;
    return {
        revision: extraerRevision(pick(0)),
        fechaRevision: formatearFechaIso(pick(1)) || DATOS_DEFECTO.fechaRevision,
        tipoFuente: placeholder ? '' : tipo,
        descripcion,
        fechaCaptura: fecha
    };
}

function fusionarHojaEnFichaActiva(datosDb, hoja) {
    const db = sanitizarDatos(datosDb || DATOS_DEFECTO);
    if (!hoja || (!hoja.descripcion && !hoja.fechaCaptura && !hoja.tipoFuente)) return db;
    if (!db.fichas.length) {
        if (!hoja.descripcion && !hoja.fechaCaptura) return db;
        const primera = sanitizarFicha({
            tipoFuente: hoja.tipoFuente,
            descripcion: hoja.descripcion,
            fechaCaptura: hoja.fechaCaptura
        });
        return sanitizarDatos({
            ...db,
            revision: hoja.revision || db.revision,
            fechaRevision: hoja.fechaRevision || db.fechaRevision,
            fichas: [primera],
            fichaActivaId: primera.id
        });
    }
    const activaId = db.fichaActivaId || db.fichas[0].id;
    const fichas = db.fichas.map((f) => {
        if (f.id !== activaId) return f;
        return sanitizarFicha({
            ...f,
            tipoFuente: hoja.tipoFuente || f.tipoFuente,
            descripcion: hoja.descripcion || f.descripcion,
            fechaCaptura: hoja.fechaCaptura || f.fechaCaptura
        });
    });
    return sanitizarDatos({
        ...db,
        revision: hoja.revision || db.revision,
        fechaRevision: hoja.fechaRevision || db.fechaRevision,
        fichas,
        fichaActivaId: activaId
    });
}

async function adoptarPlantillaMaestra(spreadsheetId, opciones = {}) {
    const sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title,gridProperties(columnCount))'
    });
    const hojas = meta.data.sheets || [];
    const vigente = hojas.find((s) => texto(s.properties?.title) === SHEET_TITLE);
    const columnas = Number(vigente?.properties?.gridProperties?.columnCount || 0);
    if (!opciones.forzar && vigente && columnas > 0 && columnas <= 6) return SHEET_TITLE;

    const master = await sheets.spreadsheets.get({
        spreadsheetId: TEMPLATE_DRIVE_ID,
        fields: 'sheets.properties(sheetId,title)'
    });
    const origen = (master.data.sheets || []).find((s) => texto(s.properties?.title) === SHEET_TITLE)
        || (master.data.sheets || []).find((s) => texto(s.properties?.title) === SHEET_TITLE_ANTERIOR)
        || (master.data.sheets || [])[0];
    if (origen?.properties?.sheetId == null) {
        throw new Error('La plantilla maestra SGC-F-20 no tiene hoja.');
    }
    const copiada = await sheets.spreadsheets.sheets.copyTo({
        spreadsheetId: TEMPLATE_DRIVE_ID,
        sheetId: origen.properties.sheetId,
        requestBody: { destinationSpreadsheetId: spreadsheetId }
    });
    const nuevoId = copiada.data.sheetId;
    const borrar = hojas
        .filter((s) => {
            if (s.properties?.sheetId === nuevoId) return false;
            const titulo = texto(s.properties?.title);
            if (!titulo || titulo === HOJA_FUENTES) return false;
            if (excelHistorial.esHojaHistorial(titulo, CODIGO_FORMATO)) return false;
            return titulo === SHEET_TITLE || titulo === SHEET_TITLE_ANTERIOR;
        })
        .map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } }));
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                ...borrar,
                {
                    updateSheetProperties: {
                        properties: { sheetId: nuevoId, title: SHEET_TITLE, index: 0 },
                        fields: 'title,index'
                    }
                }
            ]
        }
    });
    return SHEET_TITLE;
}

async function escribirEnHoja(spreadsheetId, tituloHoja, datos, opciones = {}) {
    const limpio = sanitizarDatos(datos);
    const tituloPedido = texto(tituloHoja);
    const escribeBase = !tituloPedido || tituloPedido === SHEET_TITLE || tituloPedido === SHEET_TITLE_ANTERIOR;
    if (escribeBase) {
        await adoptarPlantillaMaestra(spreadsheetId, { forzar: !!opciones.forzarPlantilla });
    }
    const hoja = await resolverHoja(spreadsheetId, tituloHoja || SHEET_TITLE);
    await asegurarCatalogoFuentes(spreadsheetId, hoja);
    const ficha = resolverFichaActiva(limpio);
    const actualizaciones = [
        { range: rango(hoja.title, 'D2'), values: [[`Rev. ${limpio.revision}`]] },
        { range: rango(hoja.title, 'D3'), values: [[`Fecha de rev. ${fechaCortaHoja(limpio.fechaRevision)}`]] },
        { range: rango(hoja.title, 'C9'), values: [[ficha?.tipoFuente || '']] },
        { range: rango(hoja.title, 'A12'), values: [[ficha?.descripcion || '']] },
        { range: rango(hoja.title, 'D30'), values: [[fechaCortaHoja(ficha?.fechaCaptura)]] }
    ];
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    const comun = {
        sheetTitle: hoja.title,
        fontFamily: 'Century Gothic',
        fontSize: 11,
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'WRAP'
    };
    await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
        ...comun,
        startRow: 9,
        endRow: 9,
        startColumn: 3,
        endColumn: 3,
        horizontalAlignment: 'CENTER'
    });
    await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
        ...comun,
        startRow: 12,
        endRow: 27,
        startColumn: 1,
        endColumn: 5,
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'TOP'
    });
    await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
        ...comun,
        startRow: 30,
        endRow: 30,
        startColumn: 4,
        endColumn: 5,
        horizontalAlignment: 'CENTER'
    });
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

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = null;
    try {
        driveFileId = await asegurarCopiaSistema(pool, registro);
    } catch (err) {
        console.warn('[SGC-F-20] No se pudo asegurar la copia en Drive:', err.message);
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        registro = await obtenerRegistroDb(pool);
    }
    let datos = await leerDatosRegistro(registro);
    if (driveFileId) {
        try {
            const hoja = await leerDatosDesdeHoja(driveFileId, SHEET_TITLE);
            datos = fusionarHojaEnFichaActiva(datos || DATOS_DEFECTO, hoja);
        } catch (err) {
            console.warn('[SGC-F-20] No se pudo leer la hoja:', err.message);
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
    const crudo = body?.datos || body || {};
    const datosEntrada = conservarPdfs(sanitizarDatos({
        ...crudo,
        fichaActivaId: body?.fichaActivaId || crudo.fichaActivaId || null
    }), datosPrevios);

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosEntrada);
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosEntrada.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado || huboCambio;
    let fechaModificacion = huboCambio
        ? fechaHoyIso()
        : formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    let driveId = await asegurarCopiaSistema(pool, registroPrevio).catch(() => null);
    let datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    if (driveId) {
        try {
            await escribirEnHoja(driveId, SHEET_TITLE, datosGuardar);
            if (huboCambio) {
                const hist = await aplicarHistorial({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosGuardar,
                    origen: 'sistema',
                    forzarTipo: 'informacion'
                });
                if (hist?.datosGuardar) {
                    datosGuardar = conservarPdfs(sanitizarDatos(hist.datosGuardar), datosGuardar);
                }
            }
        } catch (err) {
            console.warn('[SGC-F-20] Drive no sincronizó; la BD igual se guarda:', err.message);
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
    let datos = previos;
    try {
        const hoja = await leerDatosDesdeHoja(driveFileId, SHEET_TITLE);
        datos = fusionarHojaEnFichaActiva(previos, hoja);
    } catch (err) {
        console.warn('[SGC-F-20] No se pudo importar la hoja:', err.message);
    }
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
    await escribirEnHoja(driveFileId, SHEET_TITLE, datos, { forzarPlantilla: true });
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
        console.warn('[SGC-F-20] No se pudo escribir la hoja antes del PDF:', err.message);
    }
    let gid = await driveService.obtenerGidHojaPorNombre(driveFileId, SHEET_TITLE);
    if (gid == null) gid = await driveService.obtenerGidHojaPorNombre(driveFileId, SHEET_TITLE_ANTERIOR);
    if (gid == null) throw new Error('No se encontró la hoja de la ficha para exportar a PDF.');
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid: String(gid),
        landscape: false,
        size: 'letter',
        fitToWidth: true,
        margins: 'normal'
    });
    if (!pdfBuffer || !pdfBuffer.length) throw new Error('La exportación a PDF de SGC-F-20 quedó vacía.');
    return pdfBuffer;
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const mm = iso.slice(5, 7);
    const yy = iso.slice(2, 4);
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-20 ${tag} - ${mm}/${yy}.pdf`;
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = texto(body?.pdf_base64 || body?.pdfBase64);
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const fichaId = texto(body?.fichaId || body?.ficha_id);
    if (!fichaId) throw new Error('Se requiere fichaId para asociar el PDF firmado.');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const fichas = [...datosPrevios.fichas];
    const idx = fichas.findIndex((f) => f.id === fichaId);
    if (idx < 0) throw new Error('No se encontró la ficha indicada en el archivero.');

    const nombreArchivo = nombrePdfHistorial(fichas[idx].folio);
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
    fichas[idx] = { ...fichas[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        fichas,
        fichaActivaId: fichaId
    });
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

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    subirPdfFirmado,
    sanitizarDatos,
    TIPOS_FUENTE,
    CARPETA_PDF_FIRMADOS_ID
};
