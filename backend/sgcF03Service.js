/**
 * SGC-F-03 · Lista de distribución de documentos REV 00 (sistema)
 * Tabla: identificación, distribución, acceso y recuperación.
 * Persistencia en biznaga_sgc y sync con Drive. La plantilla maestra no se edita:
 * la primera carga copia el Sheet a la carpeta del capítulo 7.
 */
const ExcelJS = require('exceljs');
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-03';
const TEMPLATE_DRIVE_ID = '1XpcTc_ZzNMf747KGejC3D4NM67hwHTIpPJ3--mRKtsA';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-03 Lista de distribución de documentos REV 00 (sistema)';
const SHEET_TITLE = 'Hoja 1';

const HEADER_ROW = 6;
const DATA_START_ROW = 7;
const MAX_FILAS = 80;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;
const ULTIMA_COLUMNA = 12;

const CELDA_REVISION = { row: 2, col: 10 };
const CELDA_FECHA_REVISION = { row: 3, col: 10 };

const COLUMNAS = {
    codigo: 1,
    nombreDocumento: 2,
    numeroVersion: 3,
    formaDistribucion: 4,
    fechaEntrega: 5,
    entrego: 6,
    numeroCopias: 7,
    nombreRecibe: 8,
    areaUso: 9,
    fechaRecuperacion: 10,
    motivo: 11,
    disposicionFinal: 12
};

const FORMAS_DISTRIBUCION = [
    'Copia controlada',
    'Copia no controlada',
    'Medio electrónico',
    'Original'
];

const REGISTRO_DEFECTO = {
    codigo: '',
    nombreDocumento: '',
    numeroVersion: '',
    formaDistribucion: '',
    fechaEntrega: '',
    entrego: '',
    numeroCopias: '',
    nombreRecibe: '',
    areaUso: '',
    fechaRecuperacion: '',
    motivo: '',
    disposicionFinal: ''
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2024-08-01',
    fechaRevision: '2024-08-01',
    revision: '00',
    registros: []
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return formatearFechaIso(valor);
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
    }
    return normalizarSaltosLinea(String(valor));
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
    celda.font = {
        ...(celda.font || {}),
        name: 'Century Gothic',
        size: 11
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
        const y = fecha.getUTCFullYear();
        const mo = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const day = String(fecha.getUTCDate()).padStart(2, '0');
        if (y > 1900) return `${y}-${mo}-${day}`;
    }
    const texto = String(fecha).trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
        const day = m[1].padStart(2, '0');
        const month = m[2].padStart(2, '0');
        let year = m[3];
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
    }
    return '';
}

function fechaHoyIso() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function formatearFechaDisplay(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

function formatearFechaRevisionSheet(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
}

function extraerTrasEtiqueta(texto, etiqueta) {
    const re = new RegExp(`${etiqueta}\\s*:\\s*(.*)`, 'i');
    const m = String(texto || '').match(re);
    return m ? String(m[1] || '').trim() : '';
}

function normalizarOpcion(valor, opciones) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const encontrado = opciones.find((op) => op.toLowerCase() === limpio.toLowerCase());
    return encontrado || limpio;
}

function sanitizarRegistro(item) {
    const base = item && typeof item === 'object' ? item : {};
    const copias = String(base.numeroCopias ?? '').trim().replace(/[^\d]/g, '');
    return {
        codigo: String(base.codigo || '').trim(),
        nombreDocumento: String(base.nombreDocumento || '').trim(),
        numeroVersion: String(base.numeroVersion || '').trim(),
        formaDistribucion: normalizarOpcion(base.formaDistribucion, FORMAS_DISTRIBUCION),
        fechaEntrega: formatearFechaIso(base.fechaEntrega),
        entrego: String(base.entrego || '').trim(),
        numeroCopias: copias,
        nombreRecibe: String(base.nombreRecibe || '').trim(),
        areaUso: String(base.areaUso || '').trim(),
        fechaRecuperacion: formatearFechaIso(base.fechaRecuperacion),
        motivo: String(base.motivo || '').trim(),
        disposicionFinal: String(base.disposicionFinal || '').trim()
    };
}

function esRegistroVacio(item) {
    const r = sanitizarRegistro(item);
    return !r.codigo && !r.nombreDocumento && !r.numeroVersion && !r.formaDistribucion
        && !r.fechaEntrega && !r.entrego && !r.numeroCopias && !r.nombreRecibe
        && !r.areaUso && !r.fechaRecuperacion && !r.motivo && !r.disposicionFinal;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const registros = Array.isArray(base.registros) ? base.registros : [];
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        registros: registros
            .map(sanitizarRegistro)
            .filter((r) => !esRegistroVacio(r))
            .slice(0, MAX_FILAS)
    };
}

function leerRegistrosDesdeHoja(ws) {
    const registros = [];
    const limite = Math.min(DATA_END_ROW, Number(ws.rowCount) || DATA_END_ROW);
    for (let r = DATA_START_ROW; r <= limite; r++) {
        const row = ws.getRow(r);
        const fila = sanitizarRegistro({
            codigo: celdaATexto(row.getCell(COLUMNAS.codigo).value),
            nombreDocumento: celdaATexto(row.getCell(COLUMNAS.nombreDocumento).value),
            numeroVersion: celdaATexto(row.getCell(COLUMNAS.numeroVersion).value),
            formaDistribucion: celdaATexto(row.getCell(COLUMNAS.formaDistribucion).value),
            fechaEntrega: celdaATexto(row.getCell(COLUMNAS.fechaEntrega).value),
            entrego: celdaATexto(row.getCell(COLUMNAS.entrego).value),
            numeroCopias: celdaATexto(row.getCell(COLUMNAS.numeroCopias).value),
            nombreRecibe: celdaATexto(row.getCell(COLUMNAS.nombreRecibe).value),
            areaUso: celdaATexto(row.getCell(COLUMNAS.areaUso).value),
            fechaRecuperacion: celdaATexto(row.getCell(COLUMNAS.fechaRecuperacion).value),
            motivo: celdaATexto(row.getCell(COLUMNAS.motivo).value),
            disposicionFinal: celdaATexto(row.getCell(COLUMNAS.disposicionFinal).value)
        });
        if (!esRegistroVacio(fila)) registros.push(fila);
    }
    return registros;
}

function parsearDatosDesdeHoja(ws) {
    const revTexto = celdaATexto(ws.getRow(CELDA_REVISION.row).getCell(CELDA_REVISION.col).value);
    const fechaTexto = celdaATexto(ws.getRow(CELDA_FECHA_REVISION.row).getCell(CELDA_FECHA_REVISION.col).value);
    const revision = extraerTrasEtiqueta(revTexto, 'Revisión') || extraerTrasEtiqueta(revTexto, 'Revision') || DATOS_DEFECTO.revision;
    const fechaRevision = formatearFechaIso(extraerTrasEtiqueta(fechaTexto, 'Fecha de revisión') || fechaTexto) || DATOS_DEFECTO.fechaRevision;
    return sanitizarDatos({
        revision,
        fechaElaboracion: fechaRevision,
        fechaRevision,
        registros: leerRegistrosDesdeHoja(ws)
    });
}

function escribirFilaRegistro(row, item) {
    const r = sanitizarRegistro(item);
    asignarTextoSimple(row.getCell(COLUMNAS.codigo), r.codigo, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.nombreDocumento), r.nombreDocumento, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.numeroVersion), r.numeroVersion, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.formaDistribucion), r.formaDistribucion, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.fechaEntrega), formatearFechaDisplay(r.fechaEntrega), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.entrego), r.entrego, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.numeroCopias), r.numeroCopias, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.nombreRecibe), r.nombreRecibe, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.areaUso), r.areaUso, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.fechaRecuperacion), formatearFechaDisplay(r.fechaRecuperacion), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.motivo), r.motivo, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.disposicionFinal), r.disposicionFinal, 'left');
}

function limpiarFilaRegistro(row) {
    for (let col = 1; col <= ULTIMA_COLUMNA; col++) {
        const celda = row.getCell(col);
        celda.value = '';
        celda.font = { name: 'Century Gothic', size: 11 };
        celda.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    asignarTextoSimple(
        ws.getRow(CELDA_REVISION.row).getCell(CELDA_REVISION.col),
        `Revisión: ${d.revision}`,
        'left'
    );
    asignarTextoSimple(
        ws.getRow(CELDA_FECHA_REVISION.row).getCell(CELDA_FECHA_REVISION.col),
        `Fecha de revisión: ${formatearFechaRevisionSheet(d.fechaRevision)}`,
        'left'
    );
    for (let i = 0; i < MAX_FILAS; i++) {
        const row = ws.getRow(DATA_START_ROW + i);
        if (i < d.registros.length) escribirFilaRegistro(row, d.registros[i]);
        else limpiarFilaRegistro(row);
    }
}

function columnaALetra(col) {
    let numero = Number(col);
    let letras = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letras = String.fromCharCode(65 + resto) + letras;
        numero = Math.floor((numero - 1) / 26);
    }
    return letras;
}

function rangoSheet(celda, sheetTitle) {
    return `'${String(sheetTitle).replace(/'/g, "''")}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle) {
    const d = sanitizarDatos(datos);
    const actualizaciones = [
        {
            range: rangoSheet(`${columnaALetra(CELDA_REVISION.col)}${CELDA_REVISION.row}`, sheetTitle),
            values: [[`Revisión: ${d.revision}`]]
        },
        {
            range: rangoSheet(`${columnaALetra(CELDA_FECHA_REVISION.col)}${CELDA_FECHA_REVISION.row}`, sheetTitle),
            values: [[`Fecha de revisión: ${formatearFechaRevisionSheet(d.fechaRevision)}`]]
        }
    ];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const r = i < d.registros.length ? d.registros[i] : { ...REGISTRO_DEFECTO };
        const pares = [
            [COLUMNAS.codigo, r.codigo || ''],
            [COLUMNAS.nombreDocumento, r.nombreDocumento || ''],
            [COLUMNAS.numeroVersion, r.numeroVersion || ''],
            [COLUMNAS.formaDistribucion, r.formaDistribucion || ''],
            [COLUMNAS.fechaEntrega, formatearFechaDisplay(r.fechaEntrega)],
            [COLUMNAS.entrego, r.entrego || ''],
            [COLUMNAS.numeroCopias, r.numeroCopias || ''],
            [COLUMNAS.nombreRecibe, r.nombreRecibe || ''],
            [COLUMNAS.areaUso, r.areaUso || ''],
            [COLUMNAS.fechaRecuperacion, formatearFechaDisplay(r.fechaRecuperacion)],
            [COLUMNAS.motivo, r.motivo || ''],
            [COLUMNAS.disposicionFinal, r.disposicionFinal || '']
        ];
        for (const [col, valor] of pares) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(col)}${rowNum}`, sheetTitle),
                values: [[valor]]
            });
        }
    }
    return actualizaciones;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        return excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-03 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch {
        return driveService.descargarArchivo(fileId);
    }
}

async function aplicarFormatoVisualSgcF03(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    try {
        await driveService.aplicarFormatoFilasSgcF03(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            d.registros.length,
            DATA_END_ROW
        );
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF03(spreadsheetId, titulo, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

function contenidoEsEquivalente(a, b) {
    const da = sanitizarDatos(a);
    const db = sanitizarDatos(b);
    return da.revision === db.revision
        && da.fechaRevision === db.fechaRevision
        && JSON.stringify(da.registros) === JSON.stringify(db.registros);
}

function estructuraEsEquivalente() {
    return true;
}

async function aplicarHistorialSgcF03(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    const nombreMesAnio = `${excelHistorial.codigoHistorialBase(CODIGO_FORMATO)}-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        try {
            await escribirSnapshotEnHojaDrive(opciones.spreadsheetId, result.hojaVigente, result.datosGuardar);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
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
        console.warn('[SGC-F-03] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function archivoTieneLogo(fileId) {
    if (!fileId) return false;
    try {
        const buffer = await descargarBufferDrive(fileId);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const media = wb.model?.media || [];
        if (media.length) return true;
        return (wb.worksheets || []).some((ws) => (ws.getImages?.() || []).length > 0);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo revisar el logo:', err.message);
        return true;
    }
}

/**
 * La copia de trabajo se generó antes de que la plantilla tuviera el logo.
 * Trae la hoja de la plantilla (con imagen) y reescribe los registros encima.
 */
async function restaurarLogoDesdePlantilla(spreadsheetId, datos) {
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const plantilla = await sheetsApi.spreadsheets.get({
        spreadsheetId: TEMPLATE_DRIVE_ID,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hojaPlantilla = (plantilla.data.sheets || [])
        .find((s) => String(s.properties?.title || '').trim() === SHEET_TITLE)
        || plantilla.data.sheets?.[0];
    const sheetIdOrigen = hojaPlantilla?.properties?.sheetId;
    if (sheetIdOrigen == null) {
        throw new Error('La plantilla SGC-F-03 no tiene hoja para copiar el logo.');
    }

    const copiada = await sheetsApi.spreadsheets.sheets.copyTo({
        spreadsheetId: TEMPLATE_DRIVE_ID,
        sheetId: sheetIdOrigen,
        requestBody: { destinationSpreadsheetId: spreadsheetId }
    });
    const tituloCopiado = String(copiada.data?.title || '').trim();
    if (!tituloCopiado) {
        throw new Error('No se pudo copiar la hoja con logo.');
    }

    const previas = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const aBorrar = previas.filter((titulo) => titulo !== tituloCopiado);
    if (aBorrar.length) {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aBorrar);
    }
    if (tituloCopiado !== SHEET_TITLE) {
        await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloCopiado, SHEET_TITLE);
    }
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, SHEET_TITLE);
    console.log('[SGC-F-03] Logo de la plantilla aplicado en la copia de Drive.');
}

async function crearCopiaSistema() {
    const archivo = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (!archivo?.id) throw new Error('No se pudo copiar la plantilla SGC-F-03.');
    try {
        await driveService.asignarPermisoEscrituraEnlace(archivo.id);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo compartir la copia:', err.message);
    }
    return archivo.id;
}

async function resolverDriveFileId(registro) {
    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
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
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const editorUrl = driveId
        ? (driveService.construirUrlEditorGoogleSheet(driveId) || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`)
        : null;
    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        formasDistribucion: FORMAS_DISTRIBUCION
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function asegurarCopiaSistema(pool, registro) {
    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId) return driveFileId;
    driveFileId = await crearCopiaSistema();
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });
    return driveFileId;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = null;
    let archivoDrive = null;

    let driveFileId = null;
    try {
        driveFileId = await asegurarCopiaSistema(pool, registro);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo asegurar la copia en Drive:', err.message);
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        registro = await obtenerRegistroDb(pool);
    }

    const datosDb = await leerDatosRegistro(registro);
    let datosDrive = null;
    if (driveFileId) {
        try {
            datosDrive = await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId));
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo leer Drive, usando BD:', err.message);
        }
    }

    if (datosDb?.registros?.length) {
        datos = datosDb;
    } else if (datosDrive?.registros?.length) {
        datos = datosDrive;
        try {
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion || fechaHoyIso(),
                fechaModificacionContenido: fechaHoyIso(),
                contenidoModificado: true
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo restaurar BD desde Drive:', err.message);
        }
    } else {
        datos = datosDb || datosDrive || sanitizarDatos(DATOS_DEFECTO);
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: driveFileId,
            ultima_sync_drive: null
        };
    }
    registro = { ...registro, drive_file_id: driveFileId || registro.drive_file_id || null };
    if (driveFileId) {
        try {
            if (!(await archivoTieneLogo(driveFileId))) {
                await restaurarLogoDesdePlantilla(driveFileId, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            }
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo restaurar el logo:', err.message);
        }
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo asegurar permiso de enlace:', err.message);
        }
    }
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) return sincronizarDesdeDrive(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    let datosPrevios = await leerDatosRegistro(registroPrevio);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    let driveId = await asegurarCopiaSistema(pool, registroPrevio).catch(() => null);

    if (!body?.vaciar && datosEntrada.registros.length === 0 && datosPrevios?.registros?.length) {
        const archivoDrive = driveId ? await driveService.obtenerInfoArchivo(driveId).catch(() => null) : null;
        return construirRespuesta(
            { ...(registroPrevio || {}), drive_file_id: driveId || registroPrevio?.drive_file_id },
            datosPrevios,
            archivoDrive
        );
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    let datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    let archivoDrive = null;
    if (driveId) {
        try {
            if (!huboCambio) {
                const hojaDestino = await resolverTituloHojaTrabajo(driveId);
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            } else {
                const hist = await aplicarHistorialSgcF03({
                    spreadsheetId: driveId,
                    datosPrevios: datosPrevios || sanitizarDatos(DATOS_DEFECTO),
                    datosNuevos: { ...datosGuardar },
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = {
                    ...hist.datosGuardar,
                    fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
                };
                if (!hist.aplicado) {
                    const hojaDestino = await resolverTituloHojaTrabajo(driveId);
                    await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
                }
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-03] Drive no sincronizó; la BD ya tiene el guardado:', err.message);
            archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        }
    }

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    const datosDrive = await leerDatosDesdeBuffer(await descargarBufferDrive(driveFileId), { modo: 'vigente' });
    const datosPrevios = await leerDatosRegistro(registro);

    if (!datosDrive.registros.length && datosPrevios?.registros?.length) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }
    if (datosPrevios && contenidoEsEquivalente(datosPrevios, datosDrive)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datosDrive.fechaElaboracion || fechaHoyIso();
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosDrive,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });
    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datosDrive, archivoDrive);
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* ignore */ }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const previo = registro?.drive_file_id && registro.drive_file_id !== TEMPLATE_DRIVE_ID
        ? registro.drive_file_id
        : null;
    const driveFileId = await crearCopiaSistema();
    await actualizarDatosEnGoogleSheet(driveFileId, datos, SHEET_TITLE);
    if (previo && previo !== driveFileId) {
        try {
            await driveService.eliminarArchivo(previo);
        } catch (err) {
            console.warn('[SGC-F-03] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });
    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await asegurarCopiaSistema(pool, registro);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }
    const ultimaFila = Math.max(HEADER_ROW, DATA_START_ROW + Math.max(datos.registros.length, 1) - 1);
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        size: 'letter',
        margins: 'estrechos',
        scalePercent: 78,
        verticalAlignment: 'TOP',
        horizontalAlignment: 'CENTER',
        range: { r1: 0, r2: ultimaFila, c1: 0, c2: ULTIMA_COLUMNA }
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-03 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    sanitizarDatos,
    FORMAS_DISTRIBUCION
};
