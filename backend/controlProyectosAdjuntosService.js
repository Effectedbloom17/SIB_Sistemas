/**
 * Evidencias / repositorio documental de Control de Proyectos.
 * Drive: {CARPETA_RAIZ} / {Empresa} / {Proyecto} / archivos
 */
const driveService = require('./driveService');

const CARPETA_PADRE_ADJUNTOS = process.env.CONTROL_PROYECTOS_DRIVE_FOLDER_ID
    || '1qdlIoNwb6HOub4HuuteofDq4CQcAgDfA';

function sanitizarNombreCarpeta(valor) {
    const limpio = String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return limpio || 'Sin-nombre';
}

function nombreCarpetaEmpresa(meta = {}) {
    return sanitizarNombreCarpeta(meta.empresaNombre || meta.empresa_nombre || 'Sin-empresa');
}

function nombreCarpetaProyecto(meta = {}) {
    const folioLimpio = String(meta.folio || '').trim();
    const nombre = sanitizarNombreCarpeta(meta.nombreProyecto || meta.nombre_proyecto || 'Proyecto');
    return folioLimpio
        ? sanitizarNombreCarpeta(`${folioLimpio} - ${nombre}`)
        : nombre;
}

/** Nombre plano legacy: "Empresa · Folio - Proyecto" (antes de jerarquía). */
function nombreCarpetaProyectoLegacy(meta = {}) {
    const empresa = nombreCarpetaEmpresa(meta);
    const proyecto = nombreCarpetaProyecto(meta);
    if (empresa && empresa !== 'Sin-nombre' && empresa !== 'Sin-empresa') {
        return sanitizarNombreCarpeta(`${empresa} · ${proyecto}`);
    }
    return proyecto;
}

async function resolverCarpetaProyecto(meta = {}) {
    const nombreEmpresa = nombreCarpetaEmpresa(meta);
    const nombreProyecto = nombreCarpetaProyecto(meta);
    const carpetaEmpresaId = await driveService.obtenerOCrearCarpeta(
        nombreEmpresa,
        CARPETA_PADRE_ADJUNTOS
    );
    const carpetaId = await driveService.obtenerOCrearCarpeta(nombreProyecto, carpetaEmpresaId);
    return {
        carpetaId,
        carpetaEmpresaId,
        nombreCarpetaEmpresa: nombreEmpresa,
        nombreCarpeta: nombreProyecto,
        carpetaPadreId: CARPETA_PADRE_ADJUNTOS,
        webViewLink: `https://drive.google.com/drive/folders/${carpetaId}`,
        webViewLinkEmpresa: `https://drive.google.com/drive/folders/${carpetaEmpresaId}`
    };
}

function mapearArchivo(file) {
    if (!file?.id) return null;
    return {
        id: file.id,
        nombre: file.name || 'Archivo',
        nombreArchivo: file.name || 'Archivo',
        mimeType: file.mimeType || 'application/octet-stream',
        size: file.size != null ? Number(file.size) : null,
        tamanoBytes: file.size != null ? Number(file.size) : null,
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    };
}

async function listarArchivosEnCarpeta(carpetaId) {
    const files = await driveService.listarArchivosCarpeta(carpetaId);
    return (files || []).map(mapearArchivo).filter(Boolean)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

async function listarAdjuntos(meta = {}) {
    const carpeta = await resolverCarpetaProyecto(meta);
    let archivos = await listarArchivosEnCarpeta(carpeta.carpetaId);

    // Compatibilidad: si la carpeta nueva está vacía, incluir legacy plano bajo la raíz.
    if (!archivos.length) {
        try {
            const legacyNombre = nombreCarpetaProyectoLegacy(meta);
            const folderId = await driveService.buscarCarpeta(legacyNombre, CARPETA_PADRE_ADJUNTOS);
            if (folderId) {
                const legacyFiles = await listarArchivosEnCarpeta(folderId);
                if (legacyFiles.length) {
                    archivos = legacyFiles;
                    return {
                        ...carpeta,
                        carpetaLegacyId: folderId,
                        archivos,
                        total: archivos.length,
                        totalBytes: archivos.reduce((s, a) => s + (Number(a.size) || 0), 0)
                    };
                }
            }
        } catch (_e) {
            // ignore legacy lookup errors
        }
    }

    return {
        ...carpeta,
        archivos,
        total: archivos.length,
        totalBytes: archivos.reduce((s, a) => s + (Number(a.size) || 0), 0)
    };
}

async function subirAdjunto(meta = {}, file) {
    if (!file?.buffer || !file.originalname) {
        const err = new Error('Archivo requerido');
        err.statusCode = 400;
        throw err;
    }
    const carpeta = await resolverCarpetaProyecto(meta);
    const nombre = String(file.originalname || 'adjunto').trim().slice(0, 180) || 'adjunto';
    const mime = String(file.mimetype || 'application/octet-stream');
    const subido = await driveService.subirArchivoNuevo(file.buffer, nombre, mime, carpeta.carpetaId);
    try {
        await driveService.asignarPermisoLecturaPublica(subido.id);
    } catch (_e) { /* preview still may work via service account download */ }
    return {
        ...carpeta,
        archivo: mapearArchivo(subido)
    };
}

async function eliminarAdjunto(meta = {}, fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        const err = new Error('Indica el archivo a eliminar');
        err.statusCode = 400;
        throw err;
    }
    const listado = await listarAdjuntos(meta);
    const pertenece = (listado.archivos || []).some((f) => f.id === id);
    if (!pertenece) {
        const err = new Error('El archivo no pertenece a este proyecto');
        err.statusCode = 403;
        throw err;
    }
    await driveService.eliminarArchivo(id);
    return { success: true, fileId: id, carpetaId: listado.carpetaId };
}

async function asegurarArchivoDelProyecto(meta, fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        const err = new Error('Archivo no válido');
        err.statusCode = 400;
        throw err;
    }
    const listado = await listarAdjuntos(meta);
    const archivo = (listado.archivos || []).find((f) => f.id === id);
    if (!archivo) {
        const err = new Error('El archivo no pertenece a este proyecto');
        err.statusCode = 404;
        throw err;
    }
    return { archivo, listado };
}

async function descargarAdjunto(meta = {}, fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        const err = new Error('Archivo no válido');
        err.statusCode = 400;
        throw err;
    }
    const carpeta = await resolverCarpetaProyecto(meta);
    let permitido = await driveService.perteneceACarpetaAncestral(id, carpeta.carpetaId, 4);
    if (!permitido) {
        permitido = await driveService.perteneceACarpetaAncestral(id, carpeta.carpetaEmpresaId, 5);
    }
    if (!permitido) {
        try {
            const legacyNombre = nombreCarpetaProyectoLegacy(meta);
            const legacyId = await driveService.buscarCarpeta(legacyNombre, CARPETA_PADRE_ADJUNTOS);
            if (legacyId) {
                permitido = await driveService.perteneceACarpetaAncestral(id, legacyId, 3);
            }
        } catch (_e) { /* ignore */ }
    }
    if (!permitido) {
        // Fallback: si aparece en el listado del proyecto
        const listado = await listarAdjuntos(meta);
        permitido = (listado.archivos || []).some((f) => f.id === id);
    }
    if (!permitido) {
        const err = new Error('El archivo no pertenece a este proyecto');
        err.statusCode = 404;
        throw err;
    }
    const info = await driveService.obtenerMetadatosArchivo?.(id).catch(() => null)
        || await driveService.obtenerInfoArchivo?.(id).catch(() => null)
        || {};
    const buffer = await driveService.descargarArchivo(id);
    return {
        buffer,
        nombre: info.name || info.nombre || 'archivo',
        mimeType: info.mimeType || 'application/octet-stream'
    };
}

async function prepararVistaAdjunto(meta = {}, fileId) {
    const { archivo } = await asegurarArchivoDelProyecto(meta, fileId);
    await driveService.asignarPermisoLecturaPublica(archivo.id);
    const previewUrl = `https://drive.google.com/file/d/${archivo.id}/preview`;
    const editorUrl = archivo.webViewLink
        || `https://drive.google.com/file/d/${archivo.id}/view`;
    return {
        success: true,
        archivo,
        previewUrl,
        editorUrl,
        fileId: archivo.id
    };
}

module.exports = {
    CARPETA_PADRE_ADJUNTOS,
    listarAdjuntos,
    subirAdjunto,
    eliminarAdjunto,
    descargarAdjunto,
    prepararVistaAdjunto,
    resolverCarpetaProyecto,
    nombreCarpetaEmpresa,
    nombreCarpetaProyecto
};
