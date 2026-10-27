/**
 * SGC-F-19 · Listado de conocimientos de la organización (ISO 7.1.6).
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF19-MMAA / _N + histograma).
 * Patrón: sgcDgF05Service / sgcF03Service. PDFs firmados en carpeta aparte.
 */
const { google } = require('googleapis');
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-19';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1KUJxWvly0Hm0urH0aAGoaEWZfmBloahpAXA7uwQfAFg
 */
const TEMPLATE_DRIVE_ID = '1KUJxWvly0Hm0urH0aAGoaEWZfmBloahpAXA7uwQfAFg';
/**
 * Archivo de trabajo Centro SGC (historial SGCF19-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1ExqXpnX4J617v1V2JimjEzg1VN_sV0XJOHQnaCxTLMA
 */
const DRIVE_FILE_ID_SISTEMA = '1ExqXpnX4J617v1V2JimjEzg1VN_sV0XJOHQnaCxTLMA';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '1NocNp6nAtHdseYLpU1KozGdW_zVdE_SP';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-19 Listado de conocimientos de la organización (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback legado / resolución; el trabajo real usa SGCF19-MMAA(_N). */
const SHEET_TITLE = 'Copia de Listado de conocimientos';
const MAX_COLUMNAS_SISTEMA = 10;
const NOMBRE_PDF_ARCHIVO = 'SGC-F-19 Listado de conocimientos de la organización.pdf';

const HEADER_ROW = 5;
const DATA_START_ROW = 6;
const FILAS_BASE = 15;
const MAX_FILAS = 80;
const COLUMNAS_HOJA = 10;
/** Alto de filas de datos en el Google Sheet (píxeles). */
const ALTO_FILA_DATOS_PX = 50;
const BORDE = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };

/** Nombre de hoja base del mes actual (SGCF19-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

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

function textoComparable(valor) {
    return texto(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function esEtiquetaFirma(valor) {
    const t = textoComparable(valor);
    if (!t) return false;
    if (/^elaboro\b/.test(t)) return true;
    if (t.startsWith('reviso y aprobo')) return true;
    if (t === 'directora general' || t === 'director general') return true;
    if (t === 'coordinador del sgc') return true;
    return false;
}

function limpiarRegistroVisible(registro) {
    const limpio = sanitizarRegistro(registro);
    if (esEtiquetaFirma(limpio.tipoFuente)) limpio.tipoFuente = '';
    if (esEtiquetaFirma(limpio.puesto)) limpio.puesto = '';
    if (esEtiquetaFirma(limpio.disponibleEn)) limpio.disponibleEn = '';
    return limpio;
}

function registroEsPieDeFirma(registro) {
    if (!registroTieneDatos(registro)) return true;
    if (esEtiquetaFirma(registro.conocimiento)) return true;
    if (texto(registro.conocimiento)) return false;
    return esEtiquetaFirma(registro.tipoFuente)
        || esEtiquetaFirma(registro.puesto)
        || esEtiquetaFirma(registro.disponibleEn);
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
    const vistos = new Set();
    const registros = [];
    for (const crudo of (Array.isArray(base.registros) ? base.registros : [])) {
        const registro = limpiarRegistroVisible(crudo);
        if (registroEsPieDeFirma(registro) || !texto(registro.conocimiento)) continue;
        const clave = [
            registro.conocimiento,
            registro.tipoFuente,
            registro.puesto,
            registro.disponibleEn
        ].map((valor) => texto(valor).toLowerCase()).join('|');
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        registros.push(registro);
        if (registros.length >= MAX_FILAS) break;
    }
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
        if (!id || id === excluirId || esArchivoProtegidoDrive(id)) return false;
        return name.startsWith(objetivo);
    });
    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo eliminar copia en Drive:', err.message);
        }
    }
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

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) return DRIVE_FILE_ID_SISTEMA;
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) return enCarpeta.id;
    return DRIVE_FILE_ID_SISTEMA || null;
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/** Última versión del mes: SGCF19-1026_3 > SGCF19-1026_2 > SGCF19-1026. */
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

/** Valida encabezados típicos de la plantilla SGC-F-19 (fila 5). */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!A${HEADER_ROW}:J${HEADER_ROW}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const unidos = row.map((c) => String(c || '').toLowerCase()).join(' ');
        return unidos.includes('conocimiento')
            && (unidos.includes('fuente') || unidos.includes('puesto') || unidos.includes('disponible'));
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[SGC-F-19] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
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
        console.warn('[SGC-F-19] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados del listado de conocimientos).`
        );
    }
    return copiada.title;
}

async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-19] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-19] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirEnHoja(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-19] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
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
        console.warn('[SGC-F-19] No se pudo listar hojas; se usa plantilla:', err.message);
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
        console.warn(`[SGC-F-19] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirEnHoja(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-19] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const legado = (titulos || []).find((t) => texto(t) === SHEET_TITLE);
    if (legado) return legado;

    if (!titulos.length) return mesActual;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) return nombre;
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
}

async function editorUrlConHojaVigente(driveId) {
    if (!driveId) return null;
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return driveService.construirUrlEditorGoogleSheet(driveId, { gid })
                || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo resolver gid editor:', err.message);
    }
    return driveService.construirUrlEditorGoogleSheet(driveId)
        || `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
}

/** Elimina pestañas Alias_r* residuales. Conserva SGCF19-MMAA(_N). */
async function eliminarHojasHistorialFormatoSgcF19(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && patronAlias.test(nombre);
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-19] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const limpio = sanitizarDatos(datos);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || limpio.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
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
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        pdfPreviewUrl: limpio.pdfFirmado?.previewUrl || null,
        pdfDriveFileId: limpio.pdfFirmado?.driveFileId || null,
        historialPdfs: limpio.pdfsHistorial,
        carpetaFirmadosUrl: `https://drive.google.com/drive/folders/${CARPETA_PDF_FIRMADOS_ID}`
    };
}

async function resolverHoja(spreadsheetId, tituloPreferido) {
    const sheets = clienteSheets();
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hojas = meta.data.sheets || [];
    const titulos = hojas.map((s) => texto(s.properties?.title)).filter(Boolean);
    const titulo = texto(tituloPreferido);
    const mesActual = nombreHojaMesActual();
    const tituloMes = resolverTituloMesMasReciente(titulos, mesActual);
    const exacta = titulo
        ? hojas.find((s) => texto(s.properties?.title) === titulo)
        : null;
    const base = exacta
        || (tituloMes ? hojas.find((s) => texto(s.properties?.title) === tituloMes) : null)
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
        try {
            await driveService.aplicarAltoFilasGoogleSheet(
                spreadsheetId,
                hoja.sheetId,
                DATA_START_ROW,
                DATA_START_ROW + capacidad - 1,
                ALTO_FILA_DATOS_PX
            );
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo fijar alto de filas a 50px:', err.message);
        }
        return hoja.title;
    }
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    return hoja.title;
}

/**
 * SGC-F-19 solo usa pestañas SGCF19-MMAA / SGCF19-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes.
 */
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
        forzarTipo: null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
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
    const pdfPrev = preservarPdf(datosDb, datosDb);

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            const titulo = await resolverTituloHojaVigente(driveFileId);
            const hoja = await leerDatosDesdeHoja(driveFileId, titulo);
            if (datosDb?.registros?.length && !hoja?.registros?.length) {
                datos = datosDb;
            } else if (hoja?.registros?.length) {
                datos = sanitizarDatos({ ...hoja, ...pdfPrev });
            } else {
                datos = datosDb || sanitizarDatos({ ...hoja, ...pdfPrev });
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo leer archivo en Drive, usando BD:', err.message);
            datos = datosDb;
        }

        // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
        const tituloMes = nombreHojaMesActual();
        try {
            await eliminarHojasHistorialFormatoSgcF19(driveFileId);
            const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
            const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
            const existeMes = !!tituloVigente;
            const estructuraMesOk = existeMes
                ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
                : false;

            if (!existeMes || !estructuraMesOk) {
                const destino = tituloVigente || tituloMes;
                if (!existeMes) {
                    console.warn(`[SGC-F-19] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
                } else {
                    console.warn(`[SGC-F-19] «${destino}» no coincide con plantilla; se regenera.`);
                }
                datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
                try {
                    await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                    archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
                } catch (healErr) {
                    console.warn('[SGC-F-19] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
                }
            }
        } catch (healOuter) {
            console.warn('[SGC-F-19] Heal de hoja del mes:', healOuter.message);
        }
    }

    datos = sanitizarDatos(datos || datosDb || DATOS_DEFECTO);
    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo asegurar permiso de enlace:', err.message);
        }
    }

    return construirRespuesta({ ...(registro || {}), drive_file_id: driveFileId }, datos, archivoDrive);
}

let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body) {
    const ejecutar = () => guardarFormatoInterno(pool, body);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    if (body?.editorActivo) return sincronizarDesdeDrive(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const pdf = preservarPdf(datosEntrada, datosPrevios);
    const entrada = sanitizarDatos({ ...datosEntrada, ...pdf, _metaHoja: datosPrevios._metaHoja });
    const origen = String(body?.origen || 'sistema').toLowerCase();

    const huboCambio = !contenidoEsEquivalente(datosPrevios, entrada);
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || entrada.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    const driveId = await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
        return construirRespuesta({ ...(registroPrevio || {}), drive_file_id: driveId }, entrada, archivoDrive);
    }

    let datosGuardar = {
        ...entrada,
        fechaElaboracion: fechaOriginal
    };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && huboCambio) {
        try {
            await eliminarHojasHistorialFormatoSgcF19(driveId);
            const fechaCambio = fechaHoyIso();
            const datosHistorial = origen !== 'consulta'
                ? { ...entrada, fechaElaboracion: fechaCambio }
                : entrada;
            const hist = await aplicarHistorial({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: datosHistorial,
                origen
            });
            datosGuardar = sanitizarDatos({
                ...(hist?.datosGuardar || datosHistorial),
                ...preservarPdf(entrada, datosPrevios)
            });

            if (hist?.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                ? fechaModificacion
                : fechaOriginal;

            const tituloSync = String(hist?.hojaVigente || '').trim()
                || await resolverTituloHojaVigente(driveId);
            let archivoDrive = null;
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
            } catch (syncErr) {
                console.warn('[SGC-F-19] Sync hoja edición falló tras historial:', syncErr.message);
            }
            if (!archivoDrive) {
                archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
            }

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado,
                ultimaSyncDrive: fechaHoyIso()
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-19] Drive no sincronizó; la BD igual se guarda:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }

    const previos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    let hoja = null;
    try {
        const titulo = await resolverTituloHojaVigente(driveFileId);
        hoja = await leerDatosDesdeHoja(driveFileId, titulo);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo importar la hoja:', err.message);
    }
    if (!hoja || (!hoja.registros.length && previos.registros.length)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, previos, archivoDrive);
    }

    const datosDrive = sanitizarDatos({ ...hoja, ...preservarPdf(previos, previos), _metaHoja: previos._metaHoja });
    if (contenidoEsEquivalente(previos, datosDrive)) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, previos, archivoDrive);
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datosDrive.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const fechaCambio = fechaHoyIso();

    const hist = await aplicarHistorial({
        spreadsheetId: driveFileId,
        datosPrevios: previos,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });

    const datosGuardar = sanitizarDatos({
        ...(hist?.datosGuardar || datosDrive),
        ...preservarPdf(previos, previos)
    });
    if (hist?.aplicado) {
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
        contenidoModificado,
        ultimaSyncDrive: fechaHoyIso()
    });
    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (hoja del mes vigente), sin borrar pestañas de historial ni tocar la plantilla.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
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
        throw new Error('No hay archivo sistema SGC-F-19 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoSgcF19(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-19] No se pudo eliminar hoja previa del mes:', err.message);
        }
    }

    tituloHoja = await adoptarPlantillaEnSistema(driveId, tituloMes);
    const archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosPublicar, tituloHoja);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado,
        ultimaSyncDrive: fechaHoyIso()
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

async function asegurarAccesoEditor(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-19 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-19 para exportar a PDF.');
    }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
    try {
        await escribirEnHoja(driveFileId, tituloHoja, datos);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo volcar la hoja antes del PDF:', err.message);
    }
    const gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    if (gid == null) throw new Error(`No se encontró la hoja «${tituloHoja}» para exportar a PDF.`);
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

async function descargarPlantillaXlsx(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SGC-F-19 para exportar a Excel.');
    }
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const tituloHoja = await resolverTituloHojaVigente(driveFileId);
    try {
        await escribirEnHoja(driveFileId, tituloHoja, datos);
    } catch (err) {
        console.warn('[SGC-F-19] No se pudo volcar la hoja antes del Excel:', err.message);
    }
    const xlsxBuffer = await driveService.exportarGoogleSheetComoXLSX(driveFileId);
    if (!xlsxBuffer || !xlsxBuffer.length) throw new Error('La exportación a Excel de SGC-F-19 quedó vacía.');
    return xlsxBuffer;
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

function textoPlanoCelda(valor) {
    if (valor == null) return '';
    if (valor instanceof Date) return '';
    if (typeof valor === 'object') {
        if (Array.isArray(valor.richText)) {
            return valor.richText.map((parte) => parte?.text || '').join('');
        }
        if (valor.result != null) return textoPlanoCelda(valor.result);
        if (valor.text != null) return String(valor.text);
    }
    return String(valor);
}

function valorCeldaExcel(cell) {
    if (!cell) return '';
    try {
        return texto(textoPlanoCelda(cell.value));
    } catch {
        return '';
    }
}

function filaExcel(ws, numeroFila, columnas = COLUMNAS_HOJA) {
    const fila = [];
    for (let columna = 1; columna <= columnas; columna += 1) {
        fila.push(valorCeldaExcel(ws.getCell(numeroFila, columna)));
    }
    return fila;
}

function filaEsPieExcel(celdas) {
    return (celdas || []).some((celda) => /^elaboro\b/.test(textoComparable(celda)));
}

function esEncabezadoListado(fila) {
    const unidos = fila.join(' ').toLowerCase();
    return unidos.includes('conocimiento')
        && (unidos.includes('fuente') || unidos.includes('puesto') || unidos.includes('disponible'));
}

function indiceColumna(fila, ...palabras) {
    return fila.findIndex((celda) => palabras.some((palabra) => celda.toLowerCase().includes(palabra)));
}

function parsearHojaListado(ws) {
    const maxFila = Math.min(Math.max(ws?.rowCount || 0, DATA_START_ROW), MAX_FILAS + 20);
    let inicio = DATA_START_ROW;
    let columnas = { conocimiento: 0, tipoFuente: 4, puesto: 6, disponibleEn: 8 };
    for (let fila = 1; fila <= Math.min(maxFila, 12); fila += 1) {
        const celdas = filaExcel(ws, fila);
        if (!esEncabezadoListado(celdas)) continue;
        inicio = fila + 1;
        const conocimiento = indiceColumna(celdas, 'conocimiento');
        const tipoFuente = indiceColumna(celdas, 'fuente');
        const puesto = indiceColumna(celdas, 'puesto');
        const disponibleEn = indiceColumna(celdas, 'disponible');
        if (conocimiento >= 0) columnas.conocimiento = conocimiento;
        if (tipoFuente >= 0) columnas.tipoFuente = tipoFuente;
        if (puesto >= 0) columnas.puesto = puesto;
        if (disponibleEn >= 0) columnas.disponibleEn = disponibleEn;
        break;
    }

    const registros = [];
    for (let fila = inicio; fila <= maxFila; fila += 1) {
        const celdas = filaExcel(ws, fila);
        if (filaEsPieExcel(celdas)) break;
        const registro = limpiarRegistroVisible({
            conocimiento: celdas[columnas.conocimiento] || '',
            tipoFuente: celdas[columnas.tipoFuente] || '',
            puesto: celdas[columnas.puesto] || '',
            disponibleEn: celdas[columnas.disponibleEn] || ''
        });
        if (registroEsPieDeFirma(registro) || !texto(registro.conocimiento)) continue;
        if (/^conocimiento$/i.test(registro.conocimiento)
            && !registro.tipoFuente && !registro.puesto && !registro.disponibleEn) continue;
        registros.push(registro);
    }

    const revRaw = texto(textoPlanoCelda(ws.getCell(2, 9)?.value));
    const fechaRaw = texto(textoPlanoCelda(ws.getCell(3, 9)?.value));
    const revMatch = revRaw.match(/(\d+)/);
    return {
        registros,
        revision: revMatch ? revMatch[1].padStart(2, '0').slice(-2) : '',
        fechaRevision: formatearFechaIso(fechaRaw)
    };
}

async function leerRegistrosDesdeExcelBuffer(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    for (const ws of wb.worksheets || []) {
        if (!ws || ws.state === 'hidden' || ws.state === 'veryHidden') continue;
        const parsed = parsearHojaListado(ws);
        if (parsed.registros.length) return parsed;
    }
    return null;
}

function claveRegistroImportado(registro) {
    return [
        registro?.conocimiento,
        registro?.tipoFuente,
        registro?.puesto,
        registro?.disponibleEn
    ].map((valor) => texto(valor).toLowerCase()).join('|');
}

async function importarExcelListado(pool, body = {}) {
    const crudo = String(body.excelBase64 || body.excel_base64 || '').trim();
    const limpio = crudo.replace(/^data:.*;base64,/i, '').replace(/\s+/g, '');
    if (!limpio) {
        const error = new Error('Selecciona un archivo Excel (.xlsx) del formato SGC-F-19.');
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
        const error = new Error('El archivo debe ser un Excel .xlsx con el formato SGC-F-19.');
        error.statusCode = 400;
        throw error;
    }

    let encontrado;
    try {
        encontrado = await leerRegistrosDesdeExcelBuffer(buffer);
    } catch (err) {
        console.error('[SGC-F-19] No se pudo leer el Excel:', err);
        const error = new Error('No se pudo leer el Excel. Usa el formato SGC-F-19 (.xlsx).');
        error.statusCode = 400;
        throw error;
    }
    if (!encontrado?.registros?.length) {
        const error = new Error(
            'El Excel no tiene conocimientos. Llena el listado SGC-F-19 y vuelve a importarlo.'
        );
        error.statusCode = 400;
        throw error;
    }

    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const registros = [...(datos.registros || [])];
    const importados = [];

    for (const item of encontrado.registros) {
        const clave = claveRegistroImportado(item);
        const idx = clave ? registros.findIndex((fila) => claveRegistroImportado(fila) === clave) : -1;
        if (idx >= 0) {
            registros[idx] = sanitizarRegistro({
                ...registros[idx],
                tipoFuente: item.tipoFuente || registros[idx].tipoFuente,
                puesto: item.puesto || registros[idx].puesto,
                disponibleEn: item.disponibleEn || registros[idx].disponibleEn
            });
            importados.push({
                conocimiento: registros[idx].conocimiento,
                tipoFuente: registros[idx].tipoFuente,
                puesto: registros[idx].puesto,
                disponibleEn: registros[idx].disponibleEn,
                accion: 'actualizado'
            });
            continue;
        }
        const creado = sanitizarRegistro(item);
        registros.push(creado);
        importados.push({
            conocimiento: creado.conocimiento,
            tipoFuente: creado.tipoFuente,
            puesto: creado.puesto,
            disponibleEn: creado.disponibleEn,
            accion: 'creado'
        });
    }

    const respuesta = await guardarFormato(pool, {
        datos: {
            ...datos,
            revision: encontrado.revision || datos.revision,
            fechaRevision: encontrado.fechaRevision || datos.fechaRevision,
            registros
        },
        origen: 'sistema'
    });
    return { ...respuesta, importados };
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
    descargarPlantillaXlsx,
    importarExcelListado,
    subirPdfFirmado,
    eliminarPdfHistorial,
    sanitizarDatos,
    CARPETA_PDF_FIRMADOS_ID,
    NOMBRE_PDF_ARCHIVO
};
