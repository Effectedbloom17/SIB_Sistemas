/**
 * SGC-F-20 · Ficha de conocimientos (ISO 7.1.6).
 * Archivero: plantilla externa aislada + una hoja por ficha en el archivo sistema.
 * Nombre de cada pestaña = valor de «Tipo de fuente» (sanitizado; colisiones → « 2», « 3»…).
 * El histograma / hojas auxiliares del sistema se conservan; nunca se escribe en la plantilla.
 */
const { google } = require('googleapis');
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-20';

/** Plantilla maestra (solo lectura / copyTo). */
const TEMPLATE_DRIVE_ID = '1IFE1KVStlqrHs5UIzhunjWh-tGoNfXtV1caVskE4unc';
const TEMPLATE_SHEET_TITLE = 'Plantilla';

/** Archivo de trabajo Centro SGC (historial / archivero). */
const DRIVE_FILE_ID_SISTEMA = '1we0bWgQpKUKybvveOrqmmrWdtfwFFIdbFMjWQs1Oxm4';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1KxlovhD8lMwRPZvNeRCqtfAGQWVX_3aF';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-20 Ficha de conocimientos (sistema)';

/** Fallback de resolución; el trabajo real usa pestañas por Tipo de fuente. */
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

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function esHojaReservadaSgcF20(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (t === SHEET_TITLE || /^plantilla$/i.test(t)) return true;
    if (t === SHEET_TITLE_ANTERIOR || /^copia de /i.test(t)) return true;
    if (t === HOJA_FUENTES || /^hoja\s*2$/i.test(t)) return true;
    if (/histograma/i.test(t)) return true;
    if (/^Alias_/i.test(t) || /^Partes_/i.test(t)) return true;
    if (/^_tmp_/i.test(t)) return true;
    if (excelHistorial.esHojaHistorial(t, CODIGO_FORMATO)) return true;
    return false;
}

function tituloHojaCoincide(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buscarTituloHoja(titulos, nombre) {
    return (titulos || []).find((titulo) => tituloHojaCoincide(titulo, nombre)) || '';
}

function resolverNombreHojaFicha(ficha, ocupados = []) {
    let base = sanitizarNombreHoja(ficha?.tipoFuente);
    if (!base) {
        const folio = sanitizarNombreHoja(ficha?.folio);
        const id = String(ficha?.id || '').trim();
        base = folio || (id ? `BORRADOR-${id.slice(0, 8)}` : 'Sin-fuente');
    }
    if (esHojaReservadaSgcF20(base)) {
        base = `Fuente ${base}`.slice(0, 90);
    }
    const usados = new Set(
        (ocupados || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
    );
    let nombre = base;
    let n = 2;
    while (usados.has(nombre.toLowerCase()) || esHojaReservadaSgcF20(nombre)) {
        nombre = `${base} ${n}`.slice(0, 90);
        n += 1;
    }
    return nombre;
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
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        nombreHoja: sanitizarNombreHoja(base.nombreHoja || base.nombre_hoja)
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

function aplicarNombresHojaEnDatos(datos, hojasPorId) {
    if (!datos || !hojasPorId) return;
    for (const item of datos.fichas || []) {
        const nombre = hojasPorId.get(item.id);
        if (nombre) item.nombreHoja = nombre;
    }
}

function asignarNombresHojaFichas(fichas, mapaPrevio, titulosExistentes) {
    const nombrePorId = new Map();
    const ocupados = [];

    for (const item of fichas) {
        const prev = mapaPrevio.get(item.id);
        if (!prev || esHojaReservadaSgcF20(prev)) continue;
        nombrePorId.set(item.id, prev);
        ocupados.push(prev);
    }

    for (const item of fichas) {
        const prev = nombrePorId.get(item.id);
        if (!prev) continue;
        const base = sanitizarNombreHoja(item.tipoFuente)
            || sanitizarNombreHoja(item.folio)
            || `BORRADOR-${String(item.id || '').slice(0, 8)}`;
        if (tituloHojaCoincide(base, prev)) continue;
        const bloqueados = ocupados.filter((nombre) => !tituloHojaCoincide(nombre, prev));
        for (const titulo of titulosExistentes) {
            if (!tituloHojaCoincide(titulo, prev)) bloqueados.push(titulo);
        }
        const deseado = resolverNombreHojaFicha(item, bloqueados);
        if (tituloHojaCoincide(deseado, prev)) continue;
        const idx = ocupados.findIndex((nombre) => tituloHojaCoincide(nombre, prev));
        if (idx >= 0) ocupados[idx] = deseado;
        else ocupados.push(deseado);
        nombrePorId.set(item.id, deseado);
    }

    for (const item of fichas) {
        if (nombrePorId.has(item.id)) continue;
        const nombre = resolverNombreHojaFicha(item, [...ocupados, ...titulosExistentes]);
        nombrePorId.set(item.id, nombre);
        ocupados.push(nombre);
    }
    return nombrePorId;
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

async function aplicarUrlsHojaEnRespuesta(respuesta, spreadsheetId, tituloHoja) {
    if (!respuesta || !spreadsheetId || !tituloHoja) return respuesta;
    try {
        const gid = await driveService.obtenerGidHojaPorNombre(spreadsheetId, tituloHoja);
        if (gid == null) return respuesta;
        respuesta.editorUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid });
        respuesta.previewUrl = driveService.construirUrlEditorGoogleSheet(spreadsheetId, { gid, modo: 'preview' });
    } catch (err) {
        console.warn('[SGC-F-20] No se pudo resolver la hoja del editor:', err.message);
    }
    return respuesta;
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

async function asegurarArchivoSistema(pool, registro) {
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        const error = new Error(
            'No se encontró el archivo sistema SGC-F-20 en Drive. '
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

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 * Nunca escribe ni borra en TEMPLATE_DRIVE_ID.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || 'Ficha';
    console.warn(
        `[SGC-F-20] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    return copiada.title;
}

async function resolverMetaHoja(spreadsheetId, tituloPreferido) {
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
        || hojas.find((s) => !esHojaReservadaSgcF20(s.properties?.title) || texto(s.properties?.title) === SHEET_TITLE)
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
    const hoja = await resolverMetaHoja(spreadsheetId, tituloHoja || SHEET_TITLE);
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
        fechaCaptura: fecha,
        nombreHoja: hoja.title
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
            fechaCaptura: hoja.fechaCaptura,
            nombreHoja: hoja.nombreHoja || ''
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
            fechaCaptura: hoja.fechaCaptura || f.fechaCaptura,
            nombreHoja: hoja.nombreHoja || f.nombreHoja
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

async function escribirDatosEnHoja(spreadsheetId, tituloHoja, datos, ficha) {
    const limpio = sanitizarDatos(datos);
    const item = ficha || resolverFichaActiva(limpio);
    const hoja = await resolverMetaHoja(spreadsheetId, tituloHoja);
    try {
        await asegurarCatalogoFuentes(spreadsheetId, hoja);
    } catch (err) {
        console.warn('[SGC-F-20] Catálogo de fuentes:', err.message);
    }
    const actualizaciones = [
        { range: rango(hoja.title, 'D2'), values: [[`Rev. ${limpio.revision}`]] },
        { range: rango(hoja.title, 'D3'), values: [[`Fecha de rev. ${fechaCortaHoja(limpio.fechaRevision)}`]] },
        { range: rango(hoja.title, 'C9'), values: [[item?.tipoFuente || '']] },
        { range: rango(hoja.title, 'A12'), values: [[item?.descripcion || '']] },
        { range: rango(hoja.title, 'D30'), values: [[fechaCortaHoja(item?.fechaCaptura)]] }
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

async function recrearHojaFicha(spreadsheetId, nombreHoja, plantillaLocal = '') {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-20 solo recrea hojas en el archivo sistema.');
    }
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    if (titulos.includes(nombreHoja) && !esHojaReservadaSgcF20(nombreHoja)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [nombreHoja]);
        } catch (err) {
            console.warn(`[SGC-F-20] No se pudo eliminar hoja previa ${nombreHoja}:`, err.message);
        }
    }
    try {
        return await adoptarPlantillaEnSistema(spreadsheetId, nombreHoja);
    } catch (err) {
        console.warn(`[SGC-F-20] copyTo plantilla falló para "${nombreHoja}":`, err.message);
        if (plantillaLocal) {
            const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaLocal, nombreHoja);
            return dup.title || nombreHoja;
        }
        throw err;
    }
}

/**
 * Una pestaña por ficha del archivero; nombre = Tipo de fuente.
 * No versiona por mes ni escribe en la plantilla externa.
 */
async function sincronizarHojasFichasEnDrive(spreadsheetId, datos, datosPrevios = null, opciones = {}) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-20 solo escribe en el archivo sistema, nunca en la plantilla externa.');
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

    const mapaPrevio = new Map();
    const ocupadosPrevios = [];
    if (prev?.fichas) {
        for (const item of prev.fichas) {
            const fijo = sanitizarNombreHoja(item.nombreHoja);
            const nombre = fijo || resolverNombreHojaFicha(item, ocupadosPrevios);
            ocupadosPrevios.push(nombre);
            mapaPrevio.set(item.id, nombre);
        }
    }

    const nombrePorId = asignarNombresHojaFichas(meta.fichas, mapaPrevio, titulosExistentes);
    const nombresVigentes = new Set();
    const exigirIds = new Set((opciones?.exigirIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    const priorizarId = String(opciones?.priorizarId || '').trim();
    const activoId = String(meta.fichaActivaId || '').trim();
    const forzarRecrear = !!opciones?.forzarRecrear;
    let hojaActiva = plantillaLocal || '';
    let hojaPrioritaria = '';

    for (const item of meta.fichas) {
        let nombreHoja = nombrePorId.get(item.id) || resolverNombreHojaFicha(item, [...nombresVigentes]);
        const hojaPrev = mapaPrevio.get(item.id);
        const esActivo = !!activoId && item.id === activoId;
        const exigir = exigirIds.has(item.id);

        if (hojaPrev && !tituloHojaCoincide(hojaPrev, nombreHoja)
            && buscarTituloHoja([...setExistentes], hojaPrev)
            && !esHojaReservadaSgcF20(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(buscarTituloHoja([...setExistentes], hojaPrev));
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-20] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                nombreHoja = hojaPrev;
            }
        }

        const existe = !!buscarTituloHoja([...setExistentes], nombreHoja);
        if (!existe || forzarRecrear) {
            try {
                if (existe && forzarRecrear) {
                    nombreHoja = await recrearHojaFicha(spreadsheetId, nombreHoja, plantillaLocal);
                } else if (!existe) {
                    nombreHoja = await adoptarPlantillaEnSistema(spreadsheetId, nombreHoja);
                }
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-20] No se pudo crear hoja "${nombreHoja}" desde plantilla:`, err.message);
                if (plantillaLocal && !existe) {
                    try {
                        const dup = await driveService.duplicarHojaGoogleSheet(
                            spreadsheetId,
                            plantillaLocal,
                            nombreHoja
                        );
                        nombreHoja = dup.title || nombreHoja;
                        setExistentes.add(nombreHoja);
                    } catch (errDup) {
                        console.warn('[SGC-F-20] Fallback duplicar hoja local falló:', errDup.message);
                        if (exigir) {
                            const error = new Error(
                                `No se pudo crear la hoja «${nombreHoja}» en ${NOMBRE_ARCHIVO_DRIVE}.`
                            );
                            error.statusCode = 502;
                            throw error;
                        }
                        continue;
                    }
                } else if (exigir) {
                    const error = new Error(
                        `No se pudo crear la hoja «${nombreHoja}» en ${NOMBRE_ARCHIVO_DRIVE}.`
                    );
                    error.statusCode = 502;
                    throw error;
                } else if (!existe) {
                    continue;
                }
            }
        }

        nombrePorId.set(item.id, nombreHoja);
        nombresVigentes.add(nombreHoja);
        await escribirDatosEnHoja(spreadsheetId, nombreHoja, meta, item);
        if (item.id === priorizarId) hojaPrioritaria = nombreHoja;
        if (esActivo || (!activoId && item === meta.fichas[0])) {
            hojaActiva = nombreHoja;
        }
    }

    for (const id of exigirIds) {
        if (!nombrePorId.get(id) || !nombresVigentes.has(nombrePorId.get(id))) {
            const error = new Error(`No se pudo crear la hoja de la ficha en ${NOMBRE_ARCHIVO_DRIVE}.`);
            error.statusCode = 502;
            throw error;
        }
    }

    const eliminar = [];
    for (const titulo of [...setExistentes]) {
        if (esHojaReservadaSgcF20(titulo)) continue;
        const vigente = [...nombresVigentes].some((nombre) => tituloHojaCoincide(nombre, titulo));
        const eraPrevia = [...mapaPrevio.values()].some((nombre) => tituloHojaCoincide(nombre, titulo));
        if (!vigente && eraPrevia) eliminar.push(titulo);
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-20] No se pudieron eliminar hojas de fichas obsoletas:', err.message);
        }
    }

    const alFrente = hojaPrioritaria || hojaActiva;
    if (alFrente && meta.fichas.length) {
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, alFrente);
        } catch (err) {
            console.warn('[SGC-F-20] No se pudo mostrar la hoja de la ficha al frente:', err.message);
        }
    }

    return { hojaActiva: alFrente || hojaActiva, hojasPorId: nombrePorId };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = null;
    try {
        driveFileId = await asegurarArchivoSistema(pool, registro);
    } catch (err) {
        console.warn('[SGC-F-20] No se pudo asegurar el archivo sistema:', err.message);
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        registro = await obtenerRegistroDb(pool);
    }
    let datos = await leerDatosRegistro(registro);
    datos = datos || sanitizarDatos(DATOS_DEFECTO);

    let hojaActiva = null;
    if (driveFileId && datos.fichas.length) {
        const activa = resolverFichaActiva(datos);
        hojaActiva = sanitizarNombreHoja(activa?.nombreHoja) || resolverNombreHojaFicha(activa || {});
        try {
            const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
            if (!buscarTituloHoja(titulos, hojaActiva)) {
                const sync = await sincronizarHojasFichasEnDrive(driveFileId, datos, null);
                aplicarNombresHojaEnDatos(datos, sync?.hojasPorId);
                hojaActiva = sync?.hojaActiva || hojaActiva;
                await guardarRegistroDb(pool, {
                    driveFileId,
                    datos,
                    fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
                    fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
                    contenidoModificado: !!registro?.contenido_modificado
                });
                registro = await obtenerRegistroDb(pool);
            } else {
                const hoja = await leerDatosDesdeHoja(driveFileId, hojaActiva);
                datos = fusionarHojaEnFichaActiva(datos, hoja);
            }
        } catch (err) {
            console.warn('[SGC-F-20] No se pudo leer/sincronizar hojas:', err.message);
        }
    }

    const archivoDrive = driveFileId
        ? await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }))
        : null;
    const respuesta = construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, hojaActiva);
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

    const driveId = await asegurarArchivoSistema(pool, registroPrevio);
    let datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    let hojaActiva = null;
    if (driveId && datosGuardar.fichas.length) {
        try {
            const sync = await sincronizarHojasFichasEnDrive(driveId, datosGuardar, datosPrevios, {
                priorizarId: datosGuardar.fichaActivaId || ''
            });
            hojaActiva = sync?.hojaActiva || null;
            aplicarNombresHojaEnDatos(datosGuardar, sync?.hojasPorId);
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
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveId, hojaActiva);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    const previos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const activa = resolverFichaActiva(previos);
    let sheetTitle = sanitizarNombreHoja(activa?.nombreHoja) || resolverNombreHojaFicha(activa || {});
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        if (!buscarTituloHoja(titulos, sheetTitle)) {
            sheetTitle = driveService.resolverTituloHojaExistente(
                titulos,
                SHEET_TITLE,
                { fallbackRegex: /plantilla/i }
            ) || titulos.find((t) => !esHojaReservadaSgcF20(t)) || sheetTitle;
        }
    } catch (_) { /* usar título calculado */ }

    let datos = previos;
    try {
        const hoja = await leerDatosDesdeHoja(driveFileId, sheetTitle);
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
    const respuesta = construirRespuesta(registroActualizado, datos, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, sheetTitle);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    let hojaActiva = null;
    if (datos.fichas.length) {
        const sync = await sincronizarHojasFichasEnDrive(driveFileId, datos, null, {
            forzarRecrear: true,
            priorizarId: datos.fichaActivaId || ''
        });
        hojaActiva = sync?.hojaActiva || null;
        aplicarNombresHojaEnDatos(datos, sync?.hojasPorId);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
            fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
            contenidoModificado: !!registro?.contenido_modificado,
            ultimaSyncDrive: fechaHoyIso()
        });
    }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const respuesta = construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, hojaActiva);
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* el enlace puede existir */ }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const activa = resolverFichaActiva(datos);
    const hojaActiva = sanitizarNombreHoja(activa?.nombreHoja) || resolverNombreHojaFicha(activa || {});
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const respuesta = construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
    return aplicarUrlsHojaEnRespuesta(respuesta, driveFileId, hojaActiva);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const activa = resolverFichaActiva(datos);
    if (!activa) {
        const err = new Error('Abre o crea una ficha para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }
    let tituloHoja = sanitizarNombreHoja(activa.nombreHoja) || resolverNombreHojaFicha(activa);
    let gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja).catch(() => null);
    if (gid == null) {
        const sync = await sincronizarHojasFichasEnDrive(
            driveFileId,
            { ...datos, fichaActivaId: activa.id },
            null,
            { priorizarId: activa.id, exigirIds: [activa.id] }
        );
        tituloHoja = sync?.hojaActiva || tituloHoja;
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja).catch(() => null);
    }
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

function textoPlanoCelda(valor) {
    if (valor == null) return '';
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        const y = valor.getUTCFullYear();
        const mo = String(valor.getUTCMonth() + 1).padStart(2, '0');
        const day = String(valor.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    }
    if (typeof valor === 'number' && valor > 20000 && valor < 80000) {
        const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
        const y = utc.getUTCFullYear();
        const mo = String(utc.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utc.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    }
    if (typeof valor === 'object') {
        if (Array.isArray(valor.richText)) {
            return valor.richText.map((parte) => parte?.text || '').join('');
        }
        if (valor.result != null) return textoPlanoCelda(valor.result);
        if (valor.text != null) return String(valor.text);
    }
    return String(valor);
}

function valorCelda(ws, direccion) {
    return textoPlanoCelda(ws.getCell(direccion)?.value);
}

function normalizarTipoFuente(valor) {
    const t = texto(valor);
    if (!t) return '';
    const exacto = TIPOS_FUENTE.find((item) => item.toLowerCase() === t.toLowerCase());
    return exacto || t;
}

function claveFichaImportada(ficha) {
    const descripcion = texto(ficha?.descripcion).toLowerCase();
    if (!descripcion) return '';
    return `${texto(ficha?.tipoFuente).toLowerCase()}|${descripcion}`;
}

function siguienteFolioFicha(fichas, fechaIso) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [y, m, d] = iso.split('-');
    const tag = `${d}${m}${y.slice(2)}`;
    let maximo = 0;
    for (const ficha of fichas || []) {
        const match = String(ficha?.folio || '').match(/^FC-(\d{6})-(\d+)$/i);
        if (match && match[1] === tag) {
            maximo = Math.max(maximo, parseInt(match[2], 10) || 0);
        }
    }
    return `FC-${tag}-${String(maximo + 1).padStart(2, '0')}`;
}

function parsearFichaDesdeHojaExcel(ws) {
    const nombre = texto(ws?.name);
    if (!ws || esHojaReservadaSgcF20(nombre)) return null;
    const tipoFuente = normalizarTipoFuente(valorCelda(ws, 'C9'));
    const descripcion = textoLargo(valorCelda(ws, 'A12'));
    const fechaCaptura = formatearFechaIso(valorCelda(ws, 'D30'));
    const placeholder = tipoFuente === TIPOS_FUENTE[0] && !descripcion && !fechaCaptura;
    if (placeholder || (!descripcion && !fechaCaptura)) return null;
    if (/^tipo de fuente$/i.test(descripcion)) return null;
    const revTexto = texto(valorCelda(ws, 'D2'));
    const revFechaTexto = texto(valorCelda(ws, 'D3'));
    return {
        tipoFuente,
        descripcion,
        fechaCaptura,
        revision: /rev|\d/i.test(revTexto) ? extraerRevision(revTexto) : '',
        fechaRevision: formatearFechaIso(revFechaTexto),
        nombreHoja: sanitizarNombreHoja(nombre)
    };
}

async function leerFichasDesdeExcelBuffer(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const encontradas = [];
    const vistas = new Set();
    for (const ws of wb.worksheets || []) {
        if (!ws || ws.state === 'hidden' || ws.state === 'veryHidden') continue;
        const ficha = parsearFichaDesdeHojaExcel(ws);
        if (!ficha) continue;
        const clave = claveFichaImportada(ficha);
        if (clave && vistas.has(clave)) continue;
        if (clave) vistas.add(clave);
        encontradas.push(ficha);
    }
    return encontradas;
}

async function importarExcelFichas(pool, body = {}) {
    const crudo = String(body.excelBase64 || body.excel_base64 || '').trim();
    const limpio = crudo.replace(/^data:.*;base64,/i, '').replace(/\s+/g, '');
    if (!limpio) {
        const error = new Error('Selecciona un archivo Excel (.xlsx) del formato SGC-F-20.');
        error.statusCode = 400;
        throw error;
    }
    let buffer;
    try {
        buffer = Buffer.from(limpio, 'base64');
    } catch {
        const error = new Error('No se pudo leer el archivo Excel.');
        error.statusCode = 400;
        throw error;
    }
    if (!buffer.length || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        const error = new Error('El archivo debe ser un Excel .xlsx con el formato SGC-F-20.');
        error.statusCode = 400;
        throw error;
    }

    let encontradas;
    try {
        encontradas = await leerFichasDesdeExcelBuffer(buffer);
    } catch (err) {
        const error = new Error('No se pudo leer el Excel. Usa el formato SGC-F-20 (.xlsx).');
        error.statusCode = 400;
        throw error;
    }
    if (!encontradas.length) {
        const error = new Error(
            'El Excel no tiene una ficha con descripción o fecha. Llena el formato SGC-F-20 y vuelve a importarlo.'
        );
        error.statusCode = 400;
        throw error;
    }

    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const fichas = [...(datos.fichas || [])];
    const importados = [];
    let revision = datos.revision;
    let fechaRevision = datos.fechaRevision;

    for (const item of encontradas) {
        if (item.revision) revision = item.revision;
        if (item.fechaRevision) fechaRevision = item.fechaRevision;
        const clave = claveFichaImportada(item);
        const idx = clave ? fichas.findIndex((f) => claveFichaImportada(f) === clave) : -1;
        if (idx >= 0) {
            const previo = fichas[idx];
            fichas[idx] = sanitizarFicha({
                ...previo,
                tipoFuente: item.tipoFuente || previo.tipoFuente,
                descripcion: item.descripcion || previo.descripcion,
                fechaCaptura: item.fechaCaptura || previo.fechaCaptura,
                pdfFirmado: previo.pdfFirmado,
                nombreHoja: previo.nombreHoja || item.nombreHoja || ''
            });
            importados.push({
                id: fichas[idx].id,
                folio: fichas[idx].folio,
                descripcion: fichas[idx].descripcion,
                accion: 'actualizado'
            });
            continue;
        }
        const creado = sanitizarFicha({
            tipoFuente: item.tipoFuente,
            descripcion: item.descripcion,
            fechaCaptura: item.fechaCaptura || fechaHoyIso(),
            folio: siguienteFolioFicha(fichas, item.fechaCaptura || fechaHoyIso()),
            pdfFirmado: null,
            nombreHoja: item.nombreHoja || ''
        });
        fichas.unshift(creado);
        importados.push({
            id: creado.id,
            folio: creado.folio,
            descripcion: creado.descripcion,
            accion: 'creado'
        });
    }

    const respuesta = await guardarFormato(pool, {
        datos: {
            ...datos,
            revision,
            fechaRevision,
            fichas,
            fichaActivaId: importados[0]?.id || datos.fichaActivaId
        },
        origen: 'sistema'
    });
    return { ...respuesta, importados };
}

async function descargarPlantillaXlsx(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarArchivoSistema(pool, registro);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    if (datos.fichas.length) {
        try {
            await sincronizarHojasFichasEnDrive(driveFileId, datos, null, {
                priorizarId: datos.fichaActivaId || ''
            });
        } catch (err) {
            console.warn('[SGC-F-20] No se pudo escribir antes del Excel:', err.message);
        }
    }
    const xlsxBuffer = await driveService.exportarGoogleSheetComoXLSX(driveFileId);
    if (!xlsxBuffer || !xlsxBuffer.length) throw new Error('La exportación a Excel de SGC-F-20 quedó vacía.');
    return xlsxBuffer;
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
    descargarPlantillaXlsx,
    importarExcelFichas,
    subirPdfFirmado,
    sanitizarDatos,
    TIPOS_FUENTE,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    CARPETA_PDF_FIRMADOS_ID,
    adoptarPlantillaEnSistema
};
