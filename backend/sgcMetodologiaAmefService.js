/**
 * SGC-DI-06 · Metodología AMEF — presentación Google Slides en Drive (diseño original PPT).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'SGC-DI-06';
const TEMPLATE_DRIVE_ID = '1xZV8qrebRvCovN1cXOXO3EcCZhCjs-Ck';
const CARPETA_DRIVE_ID = '1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4';
const NOMBRE_ARCHIVO_DRIVE = 'Metodología AMEF (sistema)';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';

const DATOS_DEFECTO = {
    origen: 'plantilla',
    plantillaDriveFileId: TEMPLATE_DRIVE_ID
};

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        origen: String(base.origen || DATOS_DEFECTO.origen).trim() || DATOS_DEFECTO.origen,
        plantillaDriveFileId: String(base.plantillaDriveFileId || TEMPLATE_DRIVE_ID).trim(),
        restauradoEn: formatearFechaIso(base.restauradoEn) || null
    };
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
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        datos: payload.datos || DATOS_DEFECTO
    });
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function crearPresentacionDesdePlantilla() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-DI-06] No se pudo eliminar presentación previa:', err.message);
        }
    }

    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: NOMBRE_ARCHIVO_DRIVE,
            mimeType: GOOGLE_SLIDES_MIME,
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id, webViewLink, modifiedTime'
    });

    const fileId = copyResp?.data?.id;
    if (!fileId) {
        throw new Error('No se pudo convertir la plantilla PowerPoint a Google Slides.');
    }

    return {
        id: fileId,
        webViewLink: copyResp.data.webViewLink || null,
        modifiedTime: copyResp.data.modifiedTime || null
    };
}

async function resolverPresentacionDrive(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const info = await driveService.obtenerInfoArchivo(idDb).catch(() => null);
        if (info?.id) {
            const mime = String(info.mimeType || '');
            if (mime === GOOGLE_SLIDES_MIME || mime.includes('presentation')) {
                return info;
            }
        }
    }

    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id) {
        const info = await driveService.obtenerInfoArchivo(enCarpeta.id).catch(() => enCarpeta);
        return info;
    }

    return null;
}

function construirUrlsPresentacion(fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        return { editorUrl: null, previewUrl: null, embedUrl: null };
    }
    return {
        editorUrl: `https://docs.google.com/presentation/d/${id}/edit?embedded=true&usp=sharing`,
        previewUrl: `https://docs.google.com/presentation/d/${id}/preview`,
        embedUrl: `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`
    };
}

function construirRespuesta(registro, archivoDrive, datos) {
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const urls = construirUrlsPresentacion(driveId);
    const datosSeguros = datos || DATOS_DEFECTO;

    return {
        codigo: CODIGO_FORMATO,
        datos: datosSeguros,
        driveFileId: driveId,
        editorUrl: urls.editorUrl,
        previewUrl: urls.previewUrl,
        embedUrl: urls.embedUrl,
        webViewLink: archivoDrive?.webViewLink || urls.editorUrl,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/presentation/d/${TEMPLATE_DRIVE_ID}/edit`,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(
            archivoDrive?.modifiedTime || registro?.ultima_sync_drive
        ),
        contenidoModificado: !!registro?.contenido_modificado,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original),
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido)
    };
}

async function asegurarPresentacionEnDrive(pool) {
    let registro = await obtenerRegistroDb(pool);
    let archivoDrive = await resolverPresentacionDrive(registro);

    if (!archivoDrive?.id) {
        archivoDrive = await crearPresentacionDesdePlantilla();
        const datos = sanitizarDatos(await leerDatosRegistro(registro));
        await guardarRegistroDb(pool, {
            driveFileId: archivoDrive.id,
            datos: { ...datos, origen: 'plantilla', restauradoEn: fechaHoyIso() },
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || fechaHoyIso(),
            fechaModificacionContenido: null,
            contenidoModificado: false
        });
        registro = await obtenerRegistroDb(pool);
    } else if (archivoDrive.id !== registro?.drive_file_id) {
        const datos = sanitizarDatos(await leerDatosRegistro(registro));
        await guardarRegistroDb(pool, {
            driveFileId: archivoDrive.id,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const datos = sanitizarDatos(await leerDatosRegistro(registro));
    return construirRespuesta(registro, archivoDrive, datos);
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    return asegurarPresentacionEnDrive(pool);
}

async function guardarFormato(pool, body) {
    // La edición ocurre directamente en Google Slides embebido; solo refrescamos metadatos.
    await asegurarTablaSgcFormatoDatos(pool);
    const payload = await asegurarPresentacionEnDrive(pool);
    return {
        ...payload,
        message: 'La presentación se edita directamente en Google Slides.'
    };
}

async function importarDesdePlantilla(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);

    if (registroPrevio?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registroPrevio.drive_file_id);
        } catch (err) {
            console.warn('[SGC-DI-06] Archivo previo no encontrado al restaurar:', err.message);
        }
    }

    const duplicados = await buscarArchivoDriveTrabajo();
    if (duplicados?.id && duplicados.id !== registroPrevio?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(duplicados.id);
        } catch (err) {
            console.warn('[SGC-DI-06] Duplicado no eliminado al restaurar:', err.message);
        }
    }

    const archivoDrive = await crearPresentacionDesdePlantilla();
    const datos = {
        origen: 'plantilla',
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        restauradoEn: fechaHoyIso()
    };

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    return {
        ...construirRespuesta(registro, archivoDrive, datos),
        message: 'Presentación restaurada desde la plantilla original.'
    };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    importarDesdePlantilla,
    sanitizarDatos
};
