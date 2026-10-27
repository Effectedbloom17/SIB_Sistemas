/**
 * SGC-F-03 · Lista de distribución de documentos REV 00
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF03-MMAA / _N).
 * Patrón: sgcDgF05Service / sgcSgcF18Service.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-03';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1DWdTrHeYbSlXp2lHIqrUzHcxxB4Oo9_8LxjiM-juMH4
 */
const TEMPLATE_DRIVE_ID = '1DWdTrHeYbSlXp2lHIqrUzHcxxB4Oo9_8LxjiM-juMH4';
/**
 * Archivo de trabajo Centro SGC (historial SGCF03-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1XpcTc_ZzNMf747KGejC3D4NM67hwHTIpPJ3--mRKtsA
 */
const DRIVE_FILE_ID_SISTEMA = '1XpcTc_ZzNMf747KGejC3D4NM67hwHTIpPJ3--mRKtsA';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-03 Lista de distribución de documentos REV 00 (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback de resolución de hoja; el trabajo real usa SGCF03-MMAA(_N). */
const SHEET_TITLE = 'Plantilla';
const MAX_COLUMNAS_SISTEMA = 12;

/** Nombre de hoja base del mes actual (SGCF03-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

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

function textoPlanoCampo(valor) {
    return String(valor || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizarRegistro(item) {
    const base = item && typeof item === 'object' ? item : {};
    const copias = String(base.numeroCopias ?? '').trim().replace(/[^\d]/g, '');
    return {
        codigo: textoPlanoCampo(base.codigo),
        nombreDocumento: textoPlanoCampo(base.nombreDocumento),
        numeroVersion: textoPlanoCampo(base.numeroVersion),
        formaDistribucion: normalizarOpcion(base.formaDistribucion, FORMAS_DISTRIBUCION),
        fechaEntrega: formatearFechaIso(base.fechaEntrega),
        entrego: textoPlanoCampo(base.entrego),
        numeroCopias: copias,
        nombreRecibe: textoPlanoCampo(base.nombreRecibe),
        areaUso: textoPlanoCampo(base.areaUso),
        fechaRecuperacion: formatearFechaIso(base.fechaRecuperacion),
        motivo: textoPlanoCampo(base.motivo),
        disposicionFinal: textoPlanoCampo(base.disposicionFinal)
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
        || lista.find((h) => String(h.name || '').trim().toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase())
        || lista[0];
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

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets.find(
        (h) => String(h.name || '').trim().toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase()
    ) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-03 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
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
            DATA_END_ROW,
            { registros: d.registros }
        );
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || '').trim();
    if (!titulo) throw new Error('Falta título de hoja para sincronizar SGC-F-03.');
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

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        if (!id || id === excluirId || esArchivoProtegidoDrive(id)) {
            return false;
        }
        return name.startsWith(objetivo);
    });

    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) {
                return false;
            }
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/** Valida cabeceras A6 típicas de la plantilla SGC-F-03. */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return false;
    }
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!A${HEADER_ROW}:L${HEADER_ROW}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const codigo = String(row[0] || '').toLowerCase();
        const nombre = String(row[1] || '').toLowerCase();
        const recibe = String(row[7] || '').toLowerCase();
        return (codigo.includes('código') || codigo.includes('codigo'))
            && (nombre.includes('nombre') || nombre.includes('documento'))
            && (recibe.includes('recibe') || recibe.includes('quién') || recibe.includes('quien')
                || String(row[8] || '').toLowerCase().includes('área')
                || String(row[8] || '').toLowerCase().includes('area'));
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[SGC-F-03] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SGC-F-03] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados de lista de distribución).`
        );
    }
    return copiada.title;
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/**
 * Última versión del mes: SGCF03-1026_3 > SGCF03-1026_2 > SGCF03-1026.
 */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => t === mes || new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-03] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-03] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-03] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[SGC-F-03] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-03] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) {
        return delMes;
    }
    if (!titulos.length) {
        return mesActual;
    }

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
}

async function editorUrlConHojaVigente(driveId) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId) {
        return null;
    }
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return `${base}&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[SGC-F-03] No se pudo resolver gid editor:', err.message);
    }
    return base;
}

/**
 * SGC-F-03 solo usa pestañas SGCF03-MMAA / SGCF03-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes.
 */
async function aplicarHistorialSgcF03(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente: () => true,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
    });
}

/**
 * Elimina pestañas Alias_r* residuales. Conserva SGCF03-MMAA(_N).
 */
async function eliminarHojasHistorialFormatoSgcF03(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        return;
    }
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && patronAlias.test(nombre);
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) {
        return;
    }
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-03] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-03] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
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
    if (archivoDrive?.modifiedTime) {
        return formatearInstanteMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        formasDistribucion: FORMAS_DISTRIBUCION
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

    const driveFileId = await resolverDriveFileId(registro);
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

    const datosDb = await leerDatosRegistro(registro);

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            const datosDrive = await leerDatosDesdeBuffer(buffer, { modo: 'vigente' });
            if (datosDb?.registros?.length && !datosDrive?.registros?.length) {
                datos = datosDb;
            } else if (datosDrive?.registros?.length) {
                datos = datosDrive;
            } else {
                datos = datosDb || datosDrive;
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoSgcF03(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[SGC-F-03] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[SGC-F-03] «${destino}» no coincide con plantilla; se regenera.`);
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[SGC-F-03] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        } else if (!datos) {
            datos = datosDb || sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = { ...registro, drive_file_id: driveFileId || null };
    datos = sanitizarDatos(datos || DATOS_DEFECTO);

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo asegurar permiso de enlace:', err.message);
        }
    }

    return construirRespuesta(registro, datos, archivoDrive);
}

let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body, options = {}) {
    const ejecutar = () => guardarFormatoInterno(pool, body, options);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) return sincronizarDesdeDrive(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    let datosPrevios = await leerDatosRegistro(registroPrevio);

    if (!body?.vaciar && datosEntrada.registros.length === 0 && datosPrevios?.registros?.length) {
        const driveId = await resolverDriveFileId(registroPrevio);
        const archivoDrive = driveId ? await driveService.obtenerInfoArchivo(driveId).catch(() => null) : null;
        return construirRespuesta(
            { ...(registroPrevio || {}), drive_file_id: driveId || registroPrevio?.drive_file_id },
            datosPrevios,
            archivoDrive
        );
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    const driveId = await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                await eliminarHojasHistorialFormatoSgcF03(driveId);
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF03({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
                    origen
                });
                datosGuardar = hist.datosGuardar;

                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = fechaCambio;
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                let archivoDrive = null;
                const tituloSync = String(hist.hojaVigente || '').trim()
                    || await resolverTituloHojaVigente(driveId);
                try {
                    archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
                } catch (syncErr) {
                    console.warn('[SGC-F-03] Sync hoja edición falló tras historial:', syncErr.message);
                }
                if (!archivoDrive) {
                    archivoDrive = await driveService
                        .obtenerInfoArchivo(driveId)
                        .catch(() => ({ id: driveId }));
                }
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive);
            }
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const driveTrabajo = driveId || await resolverDriveFileId(registroPrevio);
    if (!driveTrabajo || driveTrabajo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo sincronizar SGC-F-03: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[SGC-F-03] Adoptar plantilla en fallback:', adoptErr.message);
    }
    const archivoDrive = await sincronizarHojaEdicionDrive(driveTrabajo, datosGuardar, tituloNuevo)
        || await driveService.obtenerInfoArchivo(driveTrabajo).catch(() => ({ id: driveTrabajo }));

    await guardarRegistroDb(pool, {
        driveFileId: driveTrabajo,
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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = await leerDatosDesdeBuffer(buffer, { modo: 'edicion' });
    const datosPrevios = await leerDatosRegistro(registro);

    if (!datosDrive.registros.length && datosPrevios?.registros?.length) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }
    if (datosPrevios && contenidoEsEquivalente(datosPrevios, datosDrive)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive);
    }

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialSgcF03({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaCambio;
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

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

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-03 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    await driveService.asignarPermisoEscrituraEnlace(driveFileId);
    try {
        await driveService.asignarPermisoLecturaPublica(driveFileId);
    } catch (_) { /* ignore */ }
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (hoja del mes vigente), sin borrar pestañas de historial ni tocar la plantilla.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datos.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema SGC-F-03 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoSgcF03(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-03] No se pudo eliminar hoja previa del mes:', err.message);
        }
    }

    tituloHoja = await adoptarPlantillaEnSistema(driveId, tituloMes);
    const archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosPublicar, tituloHoja);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-03 para exportar a PDF.');
    }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
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
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    asegurarAccesoEditor,
    descargarPlantillaPdf,
    sanitizarDatos,
    FORMAS_DISTRIBUCION
};
