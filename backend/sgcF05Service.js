/**
 * SGC-F-05 · Bitácora de no conformidades — persistencia en biznaga_sgc y sync con Drive.
 *
 * Tabla simple: cada renglón es una no conformidad con columnas
 *   Folio | Fuente | Fecha inicio | Fecha cierre | Área donde se originó |
 *   Cliente | Descripción de la No Conformidad | Acción para la NC | Estatus.
 * Reutiliza el mismo esquema de persistencia/historial que SGC-F-14.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-05';
const TEMPLATE_DRIVE_ID = '17Rd37pyaQqubyndRcouc1TwOEgn6myZWlN0t05MW7MY';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-05 Bitacora de no conformidades (sistema)';
const SHEET_TITLE = 'Bitácora';

// Encabezados de tabla en fila 6; los datos comienzan en fila 7.
const HEADER_ROW = 6;
const DATA_START_ROW = 7;
const MAX_FILAS = 60;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;

// Columnas según la plantilla (todas de una celda, sin fusiones por fila).
const COLUMNAS = {
    folio: 1,        // A
    fuente: 2,       // B
    fechaInicio: 3,  // C
    fechaCierre: 4,  // D
    area: 5,         // E
    cliente: 6,      // F
    descripcion: 7,  // G
    accion: 8,       // H
    estatus: 9       // I
};

// Opciones tomadas de la hoja «L. Desplegables» de la plantilla original.
const FUENTES_VALIDAS = [
    'Queja de cliente',
    'Auditoría interna',
    'Auditoría externa',
    'Encuestas de clima laboral',
    'Encuestas de satisfacción',
    'Análisis de indicadores',
    'Producto o servicio no conforme',
    'Revisión por la dirección',
    'Derivada de un proceso',
    'Otro'
];
const ACCIONES_VALIDAS = ['Corrección', 'Acción correctiva', 'Tratamiento para producto o servicio nc'];
const ESTATUS_VALIDOS = ['Abierta', 'Cerrada'];

const REGISTRO_DEFECTO = {
    folio: '',
    fuente: '',
    fechaInicio: '',
    fechaCierre: '',
    area: '',
    cliente: '',
    descripcion: '',
    accion: '',
    estatus: ''
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-13',
    fechaRevision: '2025-01-13',
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
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    // Excel / Sheets suelen devolver Date a medianoche UTC; usar UTC evita
    // el desfase de un día en America/Mexico_City (UTC-6).
    if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
        const y = fecha.getUTCFullYear();
        const mo = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const day = String(fecha.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    }
    const crudo = String(fecha).trim();
    const isoDirecto = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDirecto) {
        return `${isoDirecto[1]}-${isoDirecto[2]}-${isoDirecto[3]}`;
    }
    const dmy = crudo.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        let year = dmy[3];
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
    }
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        return crudo.slice(0, 10);
    }
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaDisplay(fecha) {
    const iso = formatearFechaIso(fecha);
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return '';
    return `${d}/${m}/${y.slice(-2)}`;
}

function fechaHoyIso() {
    return fechaHoyMexicoIso();
}

function normalizarOpcion(valor, opciones) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const encontrado = opciones.find((op) => op.toLowerCase() === limpio.toLowerCase());
    return encontrado || limpio;
}

function sanitizarRegistro(item) {
    return {
        folio: String(item?.folio || '').trim(),
        fuente: normalizarOpcion(item?.fuente, FUENTES_VALIDAS),
        fechaInicio: formatearFechaIso(item?.fechaInicio) || '',
        fechaCierre: formatearFechaIso(item?.fechaCierre) || '',
        area: String(item?.area || '').trim(),
        cliente: String(item?.cliente || '').trim(),
        descripcion: normalizarSaltosLinea(item?.descripcion),
        accion: normalizarOpcion(item?.accion, ACCIONES_VALIDAS),
        estatus: normalizarOpcion(item?.estatus, ESTATUS_VALIDOS)
    };
}

function esRegistroVacio(item) {
    const r = sanitizarRegistro(item);
    return !r.folio && !r.fuente && !r.fechaInicio && !r.fechaCierre
        && !r.area && !r.cliente && !r.descripcion && !r.accion && !r.estatus;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const registros = Array.isArray(base.registros) ? base.registros : [];
    const fechaElaboracion = formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion;
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        registros: registros
            .map(sanitizarRegistro)
            .filter((r) => !esRegistroVacio(r))
            .slice(0, MAX_FILAS)
    };
}

function esFilaEncabezadosTabla(item) {
    return String(item?.folio || '').trim().toLowerCase() === 'folio';
}

function leerRegistrosDesdeHoja(ws) {
    const registros = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const fila = sanitizarRegistro({
            folio: celdaATexto(row.getCell(COLUMNAS.folio).value),
            fuente: celdaATexto(row.getCell(COLUMNAS.fuente).value),
            fechaInicio: celdaATexto(row.getCell(COLUMNAS.fechaInicio).value),
            fechaCierre: celdaATexto(row.getCell(COLUMNAS.fechaCierre).value),
            area: celdaATexto(row.getCell(COLUMNAS.area).value),
            cliente: celdaATexto(row.getCell(COLUMNAS.cliente).value),
            descripcion: celdaATexto(row.getCell(COLUMNAS.descripcion).value),
            accion: celdaATexto(row.getCell(COLUMNAS.accion).value),
            estatus: celdaATexto(row.getCell(COLUMNAS.estatus).value)
        });
        if (esFilaEncabezadosTabla(fila)) continue;
        if (!esRegistroVacio(fila)) {
            registros.push(fila);
        }
    }
    return registros;
}

function parsearDatosDesdeHoja(ws) {
    return sanitizarDatos({
        revision: DATOS_DEFECTO.revision,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: DATOS_DEFECTO.fechaRevision,
        registros: leerRegistrosDesdeHoja(ws)
    });
}

function escribirFilaRegistro(row, item) {
    const r = sanitizarRegistro(item);
    asignarTextoSimple(row.getCell(COLUMNAS.folio), r.folio, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.fuente), r.fuente, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.fechaInicio), formatearFechaDisplay(r.fechaInicio), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.fechaCierre), formatearFechaDisplay(r.fechaCierre), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.area), r.area, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.cliente), r.cliente, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.descripcion), r.descripcion, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.accion), r.accion, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.estatus), r.estatus, 'center');
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const fila = i < d.registros.length ? d.registros[i] : { ...REGISTRO_DEFECTO };
        escribirFilaRegistro(ws.getRow(rowNum), fila);
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
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle) {
    const d = sanitizarDatos(datos);
    const actualizaciones = [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const r = i < d.registros.length ? d.registros[i] : { ...REGISTRO_DEFECTO };
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.folio)}${rowNum}`, sheetTitle), values: [[r.folio || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.fuente)}${rowNum}`, sheetTitle), values: [[r.fuente || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.fechaInicio)}${rowNum}`, sheetTitle), values: [[formatearFechaDisplay(r.fechaInicio)]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.fechaCierre)}${rowNum}`, sheetTitle), values: [[formatearFechaDisplay(r.fechaCierre)]] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.area)}${rowNum}`, sheetTitle), values: [[r.area || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.cliente)}${rowNum}`, sheetTitle), values: [[r.cliente || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.descripcion)}${rowNum}`, sheetTitle), values: [[r.descripcion || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.accion)}${rowNum}`, sheetTitle), values: [[r.accion || '']] });
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.estatus)}${rowNum}`, sheetTitle), values: [[r.estatus || '']] });
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
        console.warn('[SGC-F-05] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-05 no contiene hojas.');
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

async function aplicarFormatoVisualSgcF05(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    const numFilas = d.registros.length;
    try {
        await driveService.aplicarFormatoFilasSgcF05(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW,
            d.registros
        );
    } catch (err) {
        console.warn('[SGC-F-05] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF05(spreadsheetId, titulo, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

async function generarBufferPlantillaMinimaSgcF05(datos = DATOS_DEFECTO) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_TITLE);
    const titulos = [
        'Folio',
        'Fuente',
        'Fecha inicio',
        'Fecha cierre',
        'Área donde se originó',
        'Cliente',
        'Descripción de la No Conformidad',
        'Acción para la NC',
        'Estatus'
    ];
    titulos.forEach((titulo, idx) => {
        asignarTextoSimple(ws.getRow(HEADER_ROW).getCell(idx + 1), titulo, 'center');
    });
    escribirDatosEnHoja(ws, sanitizarDatos(datos));
    return Buffer.from(await wb.xlsx.writeBuffer());
}

async function obtenerBufferPlantillaSgcF05(datosFallback = null) {
    const candidatos = [];

    if (TEMPLATE_DRIVE_ID) {
        candidatos.push(TEMPLATE_DRIVE_ID);
    }

    try {
        const enCarpeta = await buscarArchivoDriveTrabajo();
        if (enCarpeta?.id && !candidatos.includes(enCarpeta.id)) {
            candidatos.push(enCarpeta.id);
        }
    } catch {
        // Sin copia en carpeta.
    }

    for (const fileId of candidatos) {
        if (esIdPlantillaMaestra(fileId)) {
            try {
                const existe = await driveService.verificarArchivoExiste(fileId);
                if (!existe) continue;
            } catch {
                continue;
            }
        }
        try {
            return await descargarBufferDrive(fileId);
        } catch (err) {
            console.warn(`[SGC-F-05] No se pudo descargar plantilla ${fileId}:`, err.message);
        }
    }

    console.warn('[SGC-F-05] Generando plantilla mínima local (plantilla Drive no disponible).');
    return generarBufferPlantillaMinimaSgcF05(datosFallback || DATOS_DEFECTO);
}

async function eliminarCopiasTrabajoEnCarpeta(excluirId = null) {
    try {
        const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
        const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
        for (const f of archivos || []) {
            const id = String(f.id || '').trim();
            if (!id || id === excluirId || esIdPlantillaMaestra(id)) continue;
            const nombre = String(f.name || '').toLowerCase();
            if (!nombre.startsWith(objetivo)) continue;
            try {
                await driveService.eliminarArchivo(id);
            } catch (err) {
                console.warn(`[SGC-F-05] No se pudo eliminar copia ${id}:`, err.message);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-05] No se pudieron limpiar copias en carpeta:', err.message);
    }
}

async function crearCopiaPlantillaEnCarpeta(pool, registro = null) {
    const existePlantilla = TEMPLATE_DRIVE_ID
        ? await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false)
        : false;
    if (!existePlantilla) {
        throw new Error(
            'Plantilla SGC-F-05 no encontrada en Drive. Compártela con la cuenta del sistema (risktechbiznaga@gmail.com) como Editor.'
        );
    }
    const copia = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (pool && copia?.id) {
        await persistirDriveFileIdEnDb(pool, copia.id, registro);
    }
    return copia;
}

async function asegurarCopiaTrabajoDrive(pool, registro = null) {
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && await esSpreadsheetEditableEnDrive(enCarpeta.id)) {
        return enCarpeta.id;
    }

    const driveDb = registro?.drive_file_id;
    if (driveDb && !esIdPlantillaMaestra(driveDb) && await esSpreadsheetEditableEnDrive(driveDb)) {
        return driveDb;
    }

    try {
        const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
        return copia.id;
    } catch (err) {
        console.warn('[SGC-F-05] No se pudo copiar plantilla maestra:', err.message);
    }

    const datos = registro ? await leerDatosRegistro(registro) : null;
    const buffer = await generarBufferPlantillaMinimaSgcF05(datos || DATOS_DEFECTO);
    const archivo = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 9, keepSingleSheet: false }
    );
    if (pool && archivo?.id) {
        await persistirDriveFileIdEnDb(pool, archivo.id, registro);
    }
    return archivo.id;
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await obtenerBufferPlantillaSgcF05(datos);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-05 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(sanitizarDatos(a).registros) === JSON.stringify(sanitizarDatos(b).registros);
}

function estructuraEsEquivalente() {
    // Agregar o quitar no conformidades es captura normal de información;
    // clasificarlo como cambio estructural duplicaría la hoja mensual del
    // historial (SGCF05-MMAA_2) y la vista se vaciaría.
    return true;
}

async function aplicarHistorialSgcF05(opciones) {
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
            console.warn('[SGC-F-05] No se pudo reescribir hoja tras historial:', err.message);
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
        console.warn('[SGC-F-05] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-05] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-05] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId].filter(Boolean);
    const unicos = [...new Set(candidatos.map((id) => String(id).trim()).filter(Boolean))];

    for (const id of unicos) {
        if (esIdPlantillaMaestra(id)) {
            continue;
        }
        if (await esSpreadsheetEditableEnDrive(id)) {
            return id;
        }
    }

    if (pool) {
        return asegurarCopiaTrabajoDrive(pool, registro);
    }

    const idOffice = unicos.find(Boolean);
    if (!idOffice) {
        throw new Error('No hay archivo SGC-F-05 configurado en Drive.');
    }
    return restaurarDriveComoGoogleSheet(idOffice, pool, registro);
}

async function resolverDriveFileId(registro, pool = null) {
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id) {
        try {
            const existe = await driveService.verificarArchivoExiste(enCarpeta.id);
            if (existe && await esSpreadsheetEditableEnDrive(enCarpeta.id)) {
                return enCarpeta.id;
            }
        } catch {
            // Continuar con otros candidatos.
        }
    }

    const driveDb = registro?.drive_file_id;
    if (driveDb && !esIdPlantillaMaestra(driveDb)) {
        try {
            const existe = await driveService.verificarArchivoExiste(driveDb);
            if (existe && await esSpreadsheetEditableEnDrive(driveDb)) {
                return driveDb;
            }
        } catch {
            // Continuar.
        }
    }

    if (pool && TEMPLATE_DRIVE_ID) {
        try {
            return await asegurarCopiaTrabajoDrive(pool, registro);
        } catch (err) {
            console.warn('[SGC-F-05] No se pudo crear copia de trabajo:', err.message);
        }
    }

    return null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-05] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-05] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 9, keepSingleSheet: false }
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

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro, pool);
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-05] No se pudo restaurar Google Sheet al cargar:', err.message);
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
            console.warn('[SGC-F-05] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[SGC-F-05] No se pudo leer plantilla, usando datos por defecto:', err.message);
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

    try {
        const sync = await sincronizarRegistrosDesdeF04(pool, datos);
        if (sync.cambio) {
            datos = sync.datos;
            await guardarRegistroDb(pool, {
                driveFileId: registro?.drive_file_id || driveFileId || null,
                datos,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
            registro = { ...registro, drive_file_id: driveFileId || registro?.drive_file_id || null };
        }
    } catch (err) {
        console.warn('[SGC-F-05] No se pudo sincronizar desde SGC-F-04 al cargar:', err.message);
    }

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
    let driveId = await resolverDriveFileId(registroPrevio, pool);
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
            const hist = await aplicarHistorialSgcF05({
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
            console.warn('[SGC-F-05] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    try {
        const driveCopia = await asegurarCopiaTrabajoDrive(pool, registroPrevio);
        if (driveCopia && await esSpreadsheetEditableEnDrive(driveCopia)) {
            const hojaDestino = await resolverTituloHojaTrabajo(driveCopia);
            await actualizarDatosEnGoogleSheet(driveCopia, datosGuardar, hojaDestino);
            const archivoDrive = await driveService.obtenerInfoArchivo(driveCopia).catch(() => null);
            await guardarRegistroDb(pool, {
                driveFileId: driveCopia,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        }
    } catch (err) {
        console.warn('[SGC-F-05] Fallback copia de plantilla:', err.message);
    }

    const buffer = await escribirDatosEnPlantilla(datosGuardar);
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
    let driveFileId = await resolverDriveFileId(registro, pool);
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

    const hist = await aplicarHistorialSgcF05({
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

function fechaHoyMexicoIso() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    return parts; // en-CA produce YYYY-MM-DD
}

function generarFolioNc(registrosExistentes) {
    const iso = fechaHoyMexicoIso();
    const [y, m, d] = iso.split('-');
    const fechaTag = `${d}${m}${y.slice(-2)}`;
    let maximo = 0;
    for (const r of registrosExistentes || []) {
        const match = String(r?.folio || '').match(/^NC-(\d{6})-(\d{1,})$/i);
        if (match && match[1] === fechaTag) {
            const consecutivo = parseInt(match[2], 10);
            if (Number.isFinite(consecutivo) && consecutivo > maximo) {
                maximo = consecutivo;
            }
        }
    }
    return `NC-${fechaTag}-${String(maximo + 1).padStart(2, '0')}`;
}

/**
 * Registra una no conformidad individual en la bitácora SGC-F-05:
 * carga el estado vigente, agrega el registro con folio automático
 * NC-DDMMAA-NN y guarda mediante el flujo normal (Drive + historial + BD).
 */
async function registrarNoConformidad(pool, registroRaw) {
    await asegurarTablaSgcFormatoDatos(pool);
    const estadoActual = await cargarFormato(pool);
    const datos = sanitizarDatos(estadoActual?.datos || DATOS_DEFECTO);

    if (datos.registros.length >= MAX_FILAS) {
        throw new Error(`La bitácora alcanzó el máximo de ${MAX_FILAS} registros.`);
    }

    const registro = sanitizarRegistro(registroRaw || {});
    if (!registro.descripcion) {
        throw new Error('La descripción de la queja o no conformidad es obligatoria.');
    }
    // Folio, fecha (México) y estatus siempre se asignan en el servidor.
    if (!registro.fuente) {
        registro.fuente = 'Queja de cliente';
    }
    registro.folio = generarFolioNc(datos.registros);
    registro.fechaInicio = fechaHoyMexicoIso();
    registro.estatus = 'Abierta';
    registro.fechaCierre = '';

    datos.registros.push(registro);
    const respuesta = await guardarFormato(pool, { datos, origen: 'sistema' });
    return { ...respuesta, registro };
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

    try {
        const sync = await sincronizarRegistrosDesdeF04(pool, datos);
        datos = sync.datos;
    } catch (err) {
        console.warn('[SGC-F-05] No se pudo sincronizar desde SGC-F-04 al actualizar plantilla:', err.message);
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    await eliminarCopiasTrabajoEnCarpeta();

    let archivoDrive = null;
    let driveIdGuardado = null;

    try {
        const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
        driveIdGuardado = copia.id;
        const hojaDestino = await resolverTituloHojaTrabajo(driveIdGuardado);
        await actualizarDatosEnGoogleSheet(driveIdGuardado, datos, hojaDestino);
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado).catch(() => copia);
        console.log(`[SGC-F-05] Plantilla actualizada desde maestra → copia ${driveIdGuardado}`);
    } catch (err) {
        console.warn('[SGC-F-05] Drive no disponible al actualizar plantilla:', err.message);
        driveIdGuardado = registro?.drive_file_id && !esIdPlantillaMaestra(registro.drive_file_id)
            ? registro.drive_file_id
            : null;
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveIdGuardado,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    if (driveIdGuardado && !archivoDrive) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado).catch(() => null);
    }
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

const ACCIONES_F04_LABELS = {
    correccion: 'Corrección',
    analisisCausas: 'Análisis de las causas',
    separacion: 'Separación',
    contencion: 'Contención',
    devolucion: 'Devolución',
    informarCliente: 'Informar al cliente',
    suspension: 'Suspensión de provisión de productos o servicios',
    autorizacionConcesion: 'Obtención de autorización para su aceptación bajo concesión'
};

const FUENTE_F04_A_F05 = {
    'AUDITORÍA': 'Auditoría interna',
    'AUDITORIA': 'Auditoría interna',
    'PROCESO': 'Derivada de un proceso',
    'QUEJA': 'Queja de cliente',
    'SERVICIO NO CONFORME': 'Producto o servicio no conforme',
    'OTRO': 'Otro'
};

function mapearFuenteDesdeF04(fuente) {
    const raw = String(fuente || '').trim();
    if (!raw) return '';
    const key = raw.toUpperCase();
    return FUENTE_F04_A_F05[key] || raw;
}

function mapearAccionDesdeF04(accionesInmediatas) {
    const acc = accionesInmediatas && typeof accionesInmediatas === 'object' ? accionesInmediatas : {};
    const labels = Object.keys(ACCIONES_F04_LABELS)
        .filter((k) => !!acc[k])
        .map((k) => ACCIONES_F04_LABELS[k]);
    if (!labels.length) return '';
    if (acc.correccion && labels.length === 1) return 'Corrección';
    if (acc.analisisCausas && !acc.correccion && labels.length === 1) return 'Acción correctiva';
    return labels.join('; ');
}

function mapearReporteF04ARegistro(reporte) {
    const folio = String(reporte?.folio || '').trim();
    const fechaCierre = formatearFechaIso(reporte?.fechaCierre) || '';
    return sanitizarRegistro({
        folio,
        fuente: mapearFuenteDesdeF04(reporte?.fuente),
        fechaInicio: formatearFechaIso(reporte?.fecha) || '',
        fechaCierre,
        area: String(reporte?.origenArea || '').trim(),
        cliente: String(reporte?.reportaEmpresa || '').trim(),
        descripcion: reporte?.descripcionNc || '',
        accion: mapearAccionDesdeF04(reporte?.accionesInmediatas),
        estatus: fechaCierre ? 'Cerrada' : 'Abierta'
    });
}

function contenidoRegistroEquivalente(a, b) {
    const x = sanitizarRegistro(a || {});
    const y = sanitizarRegistro(b || {});
    return x.folio === y.folio
        && x.fuente === y.fuente
        && x.fechaInicio === y.fechaInicio
        && x.fechaCierre === y.fechaCierre
        && x.area === y.area
        && x.cliente === y.cliente
        && x.descripcion === y.descripcion
        && x.accion === y.accion
        && x.estatus === y.estatus;
}

async function leerReportesSgcF04(pool) {
    const registro = await obtenerRegistroSgcPersistido(pool, 'SGC-F-04');
    if (!registro?.datos_json) return [];
    let datos;
    try {
        datos = typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
    } catch {
        return [];
    }
    return Array.isArray(datos?.reportes) ? datos.reportes : [];
}

/**
 * Une la bitácora F-05 con los reportes de F-04 (upsert por folio).
 * Conserva registros de F-05 cuyo folio no exista en F-04 (p. ej. Quejas).
 */
async function sincronizarRegistrosDesdeF04(pool, datosBase) {
    const base = sanitizarDatos(datosBase || DATOS_DEFECTO);
    const reportes = await leerReportesSgcF04(pool);
    const desdeF04 = reportes
        .map(mapearReporteF04ARegistro)
        .filter((r) => !!r.folio);

    const foliosF04 = new Set(desdeF04.map((r) => r.folio.toLowerCase()));
    const conservados = (base.registros || []).filter((r) => {
        const folio = String(r?.folio || '').trim().toLowerCase();
        return folio && !foliosF04.has(folio);
    });

    const registrosNuevos = [...desdeF04, ...conservados].slice(0, MAX_FILAS);
    const datos = sanitizarDatos({ ...base, registros: registrosNuevos });

    let cambio = registrosNuevos.length !== (base.registros || []).length;
    if (!cambio) {
        for (let i = 0; i < registrosNuevos.length; i++) {
            if (!contenidoRegistroEquivalente(registrosNuevos[i], base.registros[i])) {
                cambio = true;
                break;
            }
        }
    }

    return { datos, cambio };
}

/**
 * Persiste en F-05 los reportes de F-04 (BD + Drive si es posible).
 */
async function upsertDesdeReportesF04(pool, reportes) {
    await asegurarTablaSgcFormatoDatos(pool);
    const estado = await cargarFormatoSinSyncF04(pool);
    const datosBase = sanitizarDatos(estado?.datos || DATOS_DEFECTO);
    const desdeF04 = (Array.isArray(reportes) ? reportes : [])
        .map(mapearReporteF04ARegistro)
        .filter((r) => !!r.folio);

    const foliosF04 = new Set(desdeF04.map((r) => r.folio.toLowerCase()));
    const conservados = (datosBase.registros || []).filter((r) => {
        const folio = String(r?.folio || '').trim().toLowerCase();
        return folio && !foliosF04.has(folio);
    });

    const datos = sanitizarDatos({
        ...datosBase,
        registros: [...desdeF04, ...conservados].slice(0, MAX_FILAS)
    });

    try {
        return await guardarFormato(pool, { datos, origen: 'sistema' });
    } catch (err) {
        console.warn('[SGC-F-05] Guardado Drive falló al sync F-04; persistiendo solo BD:', err.message);
        const registro = await obtenerRegistroDb(pool);
        await guardarRegistroDb(pool, {
            driveFileId: registro?.drive_file_id || null,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
            fechaModificacionContenido: fechaHoyIso(),
            contenidoModificado: true
        });
        return construirRespuesta(await obtenerRegistroDb(pool), datos, null);
    }
}

/** Carga F-05 sin reentrar a sync F-04 (evita ciclos). */
async function cargarFormatoSinSyncF04(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }
    return construirRespuesta(registro || {}, datos, null);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    registrarNoConformidad,
    upsertDesdeReportesF04,
    sanitizarDatos,
    FUENTES_VALIDAS,
    ACCIONES_VALIDAS,
    ESTATUS_VALIDOS
};
