// =====================================================
// Adjuntos grandes de correo → Google Drive
// Carpeta raíz: CORREO_DRIVE_CARPETA_ID (env) o default Biznaga.
// Por cada archivo grande: crea subcarpeta con el nombre del archivo
// y sube el archivo dentro (enlace público de vista/descarga).
// =====================================================

const path = require('path');
const driveService = require('./driveService');

const CARPETA_CORREO_DRIVE_DEFAULT = '1r_LE8jxuc3zUGWLHJHQG17UUDV_AiDbY';

function obtenerCarpetaRaizCorreoDrive() {
    const desdeEnv = String(process.env.CORREO_DRIVE_CARPETA_ID || '').trim();
    return desdeEnv || CARPETA_CORREO_DRIVE_DEFAULT;
}

function formatearTamanoHumano(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function nombreCarpetaDesdeArchivo(nombreArchivo = '') {
    const base = path.basename(String(nombreArchivo || 'archivo').trim()) || 'archivo';
    const sinExt = base.replace(/\.[^.]+$/, '').trim();
    const limpio = (sinExt || base)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return limpio || 'Archivo';
}

function urlVistaDrive(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

/**
 * Guarda cada adjunto grande en Drive:
 * raíz → carpeta(nombre del archivo) → archivo
 */
async function guardarPaqueteAdjuntosDrive(adjuntosGrandes = [], meta = {}) {
    if (!Array.isArray(adjuntosGrandes) || adjuntosGrandes.length === 0) {
        return null;
    }

    const carpetaRaizId = obtenerCarpetaRaizCorreoDrive();
    const archivos = [];

    for (const adjunto of adjuntosGrandes) {
        const content = adjunto?.content;
        if (!Buffer.isBuffer(content) || content.length === 0) {
            continue;
        }

        const nombre = path.basename(String(adjunto.filename || adjunto.nombre || 'archivo'))
            .replace(/["\r\n]/g, '') || 'archivo';
        const mimeType = String(adjunto.contentType || adjunto.mimeType || 'application/octet-stream');
        const nombreCarpeta = nombreCarpetaDesdeArchivo(nombre);

        console.log(
            `[CORREO-DRIVE] Creando carpeta "${nombreCarpeta}" en ${carpetaRaizId} | ${nombre} (${formatearTamanoHumano(content.length)})`
        );

        const carpetaId = await driveService.obtenerOCrearCarpeta(nombreCarpeta, carpetaRaizId);
        try {
            await driveService.asignarPermisoLecturaPublica(carpetaId);
        } catch (_e) {
            // El archivo público basta para abrir el enlace.
        }

        console.log(`[CORREO-DRIVE] Subiendo "${nombre}" → carpeta ${carpetaId}`);
        const subido = await driveService.subirArchivoNuevo(content, nombre, mimeType, carpetaId);
        try {
            await driveService.asignarPermisoLecturaPublica(subido.id);
        } catch (_e) {
            console.warn(`[CORREO-DRIVE] No se pudo hacer público ${subido.id}`);
        }

        const url = subido.webViewLink || urlVistaDrive(subido.id);
        archivos.push({
            nombre,
            url,
            fileId: subido.id,
            carpetaId,
            carpetaNombre: nombreCarpeta,
            carpetaUrl: `https://drive.google.com/drive/folders/${carpetaId}`,
            tamanoBytes: content.length,
            tamanoTexto: formatearTamanoHumano(content.length),
            mimeType
        });
    }

    if (archivos.length === 0) {
        return null;
    }

    return {
        proveedor: 'google-drive',
        carpetaRaizId,
        carpetaRaizUrl: `https://drive.google.com/drive/folders/${carpetaRaizId}`,
        remitente: meta?.remitente || null,
        destinatarios: meta?.destinatarios || null,
        archivos,
        totalArchivos: archivos.length,
        totalBytes: archivos.reduce((s, a) => s + (Number(a.tamanoBytes) || 0), 0)
    };
}

module.exports = {
    CARPETA_CORREO_DRIVE_DEFAULT,
    obtenerCarpetaRaizCorreoDrive,
    formatearTamanoHumano,
    nombreCarpetaDesdeArchivo,
    guardarPaqueteAdjuntosDrive
};
