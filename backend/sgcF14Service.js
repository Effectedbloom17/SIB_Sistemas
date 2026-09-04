/**
 * SGC-F-14 · Bitácora de proyectos de mejora — persistencia en biznaga_sgc y sync con Drive.
 *
 * Tabla simple: cada renglón es un proyecto de mejora con columnas
 *   # Folio | Nombre del proyecto | Responsable | Prioridad | Estatus | % Avance.
 * Reutiliza el mismo esquema de persistencia/historial que SGC-F-07/F-08.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-14';
const TEMPLATE_DRIVE_ID = '139p7a689G58heuOBYV7Z93KErY_PENgdY97EOvrcZNk';
const DRIVE_FILE_ID_SISTEMA = '139p7a689G58heuOBYV7Z93KErY_PENgdY97EOvrcZNk';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-14 Bitácora de proyectos de mejora (sistema)';
const SHEET_TITLE = 'Bitácora';

// Encabezados en la fila 5; los datos comienzan en la fila 6.
const HEADER_ROW = 5;
const DATA_START_ROW = 6;
const MAX_FILAS = 60;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;

// Columnas según la plantilla (Nombre del proyecto está combinada B:C, % Avance combinada G:H).
const COLUMNAS = {
    folio: 1,            // A
    nombreProyecto: 2,   // B (B:C)
    responsable: 4,      // D
    prioridad: 5,        // E
    estatus: 6,          // F
    avance: 7            // G (G:H)
};

const PRIORIDADES_VALIDAS = ['Inmediato', 'Mediano plazo', 'Largo plazo'];
const ESTATUS_VALIDOS = ['Concluido', 'En proceso', 'No iniciado'];

const PROYECTO_DEFECTO = {
    folio: '',
    nombreProyecto: '',
    responsable: '',
    prioridad: '',
    estatus: '',
    avance: ''
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-17',
    fechaRevision: '2025-01-17',
    revision: '00',
    proyectos: []
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
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function parsearAvance(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return '';
    let n = Number(crudo);
    if (!Number.isFinite(n)) return '';
    // Google Sheets guarda los porcentajes como fracción (0.5 = 50%).
    if (n > 0 && n <= 1) n = n * 100;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return String(n);
}

function normalizarOpcion(valor, opciones) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const encontrado = opciones.find((op) => op.toLowerCase() === limpio.toLowerCase());
    return encontrado || limpio;
}

function sanitizarProyecto(item) {
    return {
        folio: String(item?.folio || '').trim(),
        nombreProyecto: String(item?.nombreProyecto || '').trim(),
        responsable: String(item?.responsable || '').trim(),
        prioridad: normalizarOpcion(item?.prioridad, PRIORIDADES_VALIDAS),
        estatus: normalizarOpcion(item?.estatus, ESTATUS_VALIDOS),
        avance: parsearAvance(item?.avance)
    };
}

function esProyectoVacio(item) {
    const p = sanitizarProyecto(item);
    return !p.folio && !p.nombreProyecto && !p.responsable
        && !p.prioridad && !p.estatus && !p.avance;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const proyectos = Array.isArray(base.proyectos) ? base.proyectos : [];
    const fechaElaboracion = formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion;
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        proyectos: proyectos
            .map(sanitizarProyecto)
            .filter((p) => !esProyectoVacio(p))
            .slice(0, MAX_FILAS)
    };
}

function leerProyectosDesdeHoja(ws) {
    const proyectos = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const fila = sanitizarProyecto({
            folio: celdaATexto(row.getCell(COLUMNAS.folio).value),
            nombreProyecto: celdaATexto(row.getCell(COLUMNAS.nombreProyecto).value),
            responsable: celdaATexto(row.getCell(COLUMNAS.responsable).value),
            prioridad: celdaATexto(row.getCell(COLUMNAS.prioridad).value),
            estatus: celdaATexto(row.getCell(COLUMNAS.estatus).value),
            avance: celdaATexto(row.getCell(COLUMNAS.avance).value)
        });
        if (!esProyectoVacio(fila)) {
            proyectos.push(fila);
        }
    }
    return proyectos;
}

function parsearDatosDesdeHoja(ws) {
    return sanitizarDatos({
        revision: DATOS_DEFECTO.revision,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: DATOS_DEFECTO.fechaRevision,
        proyectos: leerProyectosDesdeHoja(ws)
    });
}

function escribirFilaProyecto(row, item) {
    const p = sanitizarProyecto(item);
    asignarTextoSimple(row.getCell(COLUMNAS.folio), p.folio, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.nombreProyecto), p.nombreProyecto, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.responsable), p.responsable, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.prioridad), p.prioridad, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.estatus), p.estatus, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.avance), p.avance ? `${p.avance}%` : '', 'center');
}

function escribirProyectosEnHoja(ws, proyectosRaw) {
    const proyectos = Array.isArray(proyectosRaw) ? proyectosRaw : [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const fila = i < proyectos.length ? proyectos[i] : { ...PROYECTO_DEFECTO };
        escribirFilaProyecto(ws.getRow(rowNum), fila);
    }
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    escribirProyectosEnHoja(ws, d.proyectos);
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
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle) {
    const d = sanitizarDatos(datos);
    const actualizaciones = [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const p = i < d.proyectos.length ? d.proyectos[i] : { ...PROYECTO_DEFECTO };
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.folio)}${rowNum}`, sheetTitle), values: [[p.folio || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.nombreProyecto)}${rowNum}`, sheetTitle), values: [[p.nombreProyecto || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.responsable)}${rowNum}`, sheetTitle), values: [[p.responsable || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.prioridad)}${rowNum}`, sheetTitle), values: [[p.prioridad || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.estatus)}${rowNum}`, sheetTitle), values: [[p.estatus || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.avance)}${rowNum}`, sheetTitle), values: [[p.avance ? `${p.avance}%` : '']] });
    }
    return actualizaciones;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        const vigente = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        return vigente || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || lista[0];
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
        console.warn('[SGC-F-14] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-14 no contiene hojas.');
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

async function aplicarFormatoVisualSgcF14(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    const numFilas = d.proyectos.length;
    try {
        // Replica el diseño de la tabla (bordes, fusiones B:C y G:H, alineación)
        // en cada proyecto para que toda fila nueva respete el formato anterior.
        await driveService.aplicarFormatoFilasSgcF14(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW
        );
    } catch (err) {
        console.warn('[SGC-F-14] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF14(spreadsheetId, titulo, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-14 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(sanitizarDatos(a).proyectos) === JSON.stringify(sanitizarDatos(b).proyectos);
}

function estructuraEsEquivalente() {
    // En la bitácora, agregar o quitar proyectos es captura normal de
    // información (no un cambio de formato/revisión). Si el número de filas se
    // tratara como cambio estructural, el historial duplicaría la hoja mensual
    // (SGCF14-MMAA → SGCF14-MMAA_2) y los datos quedarían en una hoja que el
    // sistema no reconoce como vigente, provocando que la vista se "vacíe".
    // Por eso siempre se considera equivalente: el cambio se clasifica como
    // "información" y se reutiliza la hoja del mes.
    return true;
}

async function aplicarHistorialSgcF14(opciones) {
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
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function archivoEstaEnCarpeta(fileId, folderId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const parents = Array.isArray(info?.parents) ? info.parents : [];
        return parents.includes(folderId);
    } catch {
        return false;
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-14] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function persistirDriveFileIdEnDb(pool, driveFileId, registro = null) {
    const registroBase = registro || await obtenerRegistroDb(pool);
    const datosActuales = await leerDatosRegistro(registroBase) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosActuales,
        fechaElaboracionOriginal: formatearFechaIso(registroBase?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registroBase?.fecha_modificacion_contenido),
        contenidoModificado: !!registroBase?.contenido_modificado
    });
}

async function restaurarDriveComoGoogleSheet(fileId, pool, registro = null) {
    console.log(`[SGC-F-14] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
    const archivo = await driveService.convertirOfficeExcelAGoogleSheet(fileId, {
        nombre: NOMBRE_ARCHIVO_DRIVE,
        carpetaId: CARPETA_DRIVE_ID,
        eliminarOriginal: true
    });
    const nuevoId = archivo?.id;
    if (!nuevoId) {
        throw new Error('No se obtuvo ID del Google Sheet restaurado');
    }
    await persistirDriveFileIdEnDb(pool, nuevoId, registro);
    console.log(`[SGC-F-14] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA].filter(Boolean);
    const unicos = [...new Set(candidatos.map((id) => String(id).trim()).filter(Boolean))];

    for (const id of unicos) {
        if (await esSpreadsheetEditableEnDrive(id)) {
            if (id !== driveId) {
                await persistirDriveFileIdEnDb(pool, id, registro);
            }
            return id;
        }
    }

    const idOffice = unicos.find(Boolean);
    if (!idOffice) {
        throw new Error('No hay archivo SGC-F-14 configurado en Drive.');
    }
    return await restaurarDriveComoGoogleSheet(idOffice, pool, registro);
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        try {
            const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
            if (existe && (await esSpreadsheetEditableEnDrive(DRIVE_FILE_ID_SISTEMA))) {
                return DRIVE_FILE_ID_SISTEMA;
            }
        } catch {
            // Continuar con otros candidatos.
        }
    }

    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) {
            candidatos.push(val);
        }
    };

    agregar(registro?.drive_file_id);
    agregar(DRIVE_FILE_ID_SISTEMA);
    const enCarpeta = await buscarArchivoDriveTrabajo();
    agregar(enCarpeta?.id);

    const resolver = async (soloGoogleSheet, requiereCarpeta) => {
        for (const id of candidatos) {
            try {
                const existe = await driveService.verificarArchivoExiste(id);
                if (!existe) continue;
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) continue;
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) continue;
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) return editableSinCarpeta;
    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) return editableEnCarpeta;
    const cualquieraSinCarpeta = await resolver(false, false);
    if (cualquieraSinCarpeta) return cualquieraSinCarpeta;
    return DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-14] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 8, keepSingleSheet: false }
    );
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
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return String(fecha);
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const y = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const min = String(dt.getUTCMinutes()).padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${min}`;
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
    if (dbVal != null && dbVal !== '') {
        return formatearDatetimeMysqlMexico(dbVal);
    }
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) {
        return formatearInstanteMexico(driveVal);
    }
    return null;
}

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function parsearAvanceNumerico(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return 0;
    let n = Number(crudo);
    if (!Number.isFinite(n)) return 0;
    if (n > 0 && n <= 1) n *= 100;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
}

function estatusDesdeAvance(avance) {
    const n = parsearAvanceNumerico(avance);
    if (n >= 100) return 'Concluido';
    if (n > 0) return 'En proceso';
    return 'No iniciado';
}

function normalizarEstatusProyecto(estatus, avance) {
    const limpio = String(estatus || '').trim();
    if (limpio) {
        const encontrado = ESTATUS_VALIDOS.find((op) => op.toLowerCase() === limpio.toLowerCase());
        return encontrado || limpio;
    }
    return estatusDesdeAvance(avance);
}

function proyectoCuentaEnGrafico(proyecto) {
    const estatus = normalizarEstatusProyecto(proyecto?.estatus, proyecto?.avance);
    if (estatus === 'No iniciado') return false;
    const avance = parsearAvanceNumerico(proyecto?.avance);
    return avance > 0 || estatus === 'Concluido';
}

function resumirProyectosMejora(proyectosRaw = []) {
    const proyectos = (Array.isArray(proyectosRaw) ? proyectosRaw : [])
        .map((item) => {
            const sanitizado = sanitizarProyecto(item);
            const avance = parsearAvanceNumerico(sanitizado.avance);
            return {
                folio: sanitizado.folio,
                nombreProyecto: sanitizado.nombreProyecto,
                responsable: sanitizado.responsable,
                prioridad: sanitizado.prioridad,
                estatus: normalizarEstatusProyecto(sanitizado.estatus, avance),
                avance
            };
        })
        .filter((p) => !esProyectoVacio(p));

    const porEstatus = { Concluido: 0, 'En proceso': 0, 'No iniciado': 0 };
    const porPrioridad = PRIORIDADES_VALIDAS.reduce((acc, item) => ({ ...acc, [item]: 0 }), {});
    const enGrafico = [];

    for (const proyecto of proyectos) {
        const estatus = normalizarEstatusProyecto(proyecto.estatus, proyecto.avance);
        if (Object.prototype.hasOwnProperty.call(porEstatus, estatus)) {
            porEstatus[estatus] += 1;
        }
        const prioridad = proyecto.prioridad || '';
        if (Object.prototype.hasOwnProperty.call(porPrioridad, prioridad)) {
            porPrioridad[prioridad] += 1;
        }
        if (proyectoCuentaEnGrafico(proyecto)) {
            enGrafico.push(proyecto);
        }
    }

    const sumaAvance = enGrafico.reduce((acc, p) => acc + parsearAvanceNumerico(p.avance), 0);
    const concluidosGrafico = enGrafico.filter((p) => normalizarEstatusProyecto(p.estatus, p.avance) === 'Concluido').length;
    const enProcesoGrafico = enGrafico.length - concluidosGrafico;

    return {
        total: proyectos.length,
        totalEnGrafico: enGrafico.length,
        concluidos: porEstatus.Concluido,
        enProceso: porEstatus['En proceso'],
        noIniciados: porEstatus['No iniciado'],
        concluidosGrafico,
        enProcesoGrafico,
        avancePromedio: enGrafico.length ? Math.round(sumaAvance / enGrafico.length) : 0,
        porEstatus,
        porPrioridad,
        proyectos
    };
}

async function obtenerResumenMejora(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return resumirProyectosMejora(datos.proyectos);
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo leer plantilla, usando datos por defecto:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = { ...registro, drive_file_id: driveFileId || null };
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    const registroPrevio = await obtenerRegistroDb(pool);
    let datosPrevios = null;
    if (registroPrevio?.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    if (!huboCambio && driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveId);
        await actualizarDatosEnGoogleSheet(driveId, datosEntrada, hojaDestino);
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialSgcF14({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: { ...datosEntrada },
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;

            if (hist.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                ? fechaModificacion
                : fechaOriginal;

            const hojaDestino = hist.aplicado && hist.hojaVigente
                ? hist.hojaVigente
                : await resolverTituloHojaTrabajo(driveId);
            if (!hist.aplicado) {
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            }
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-14] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = sanitizarDatos(await leerDatosDesdeBuffer(buffer, { modo: 'edicion' }));

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    let datosPrevios = null;
    if (registro.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registro.datos_json === 'string'
                    ? JSON.parse(registro.datos_json)
                    : registro.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF14({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosDrive,
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    if (!hist.aplicado) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveFileId);
        await actualizarDatosEnGoogleSheet(driveFileId, datosGuardar, hojaDestino);
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
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

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-14] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, null);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    obtenerResumenMejora
};
