/**
 * Anexos SP-F-15 / SP-F-28 — carpeta Documentos en Drive.
 * SP-F-28:
 *   sin clasificación → Ambiental / {Empresa} / {Oficio} / Documento|Contestacion
 *   con clasificación → Ambiental / {Empresa} / {Clasificacion} / {Oficio} / Documento|Contestacion
 */
const driveService = require('./driveService');

const SP_F15_ANEXOS_FOLDER_ID = process.env.AMBIENTAL_SPF15_ANEXOS_FOLDER_ID
    || '1NmVN46qtKcNkXKZRbQXxBfNbvFv8j3fw';

/** Carpeta raíz "Ambiental" en Drive para anexos SP-F-28 */
const SP_F28_ANEXOS_FOLDER_ID = process.env.AMBIENTAL_SPF28_ANEXOS_FOLDER_ID
    || '1NhqJo27LtnSmVMUoBqmUNwUFB0nYsARE';

const CLASIFICACIONES_VALIDAS = ['MIA', 'COA', 'LAE', 'ENA', 'RME', 'IP'];

function normalizarClasificacion(valor) {
    const v = String(valor || '').trim().toUpperCase();
    return CLASIFICACIONES_VALIDAS.includes(v) ? v : null;
}

function extensionDesdeNombre(nombre, mimeType) {
    const base = String(nombre || '').trim();
    const match = base.match(/(\.[a-z0-9]{1,8})$/i);
    if (match) return match[1].toLowerCase();
    const map = {
        'application/pdf': '.pdf',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
    };
    return map[mimeType] || '';
}

function normalizarNombreEmpresaArchivo(empresa) {
    const palabras = String(empresa || 'SinEmpresa')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    const unido = palabras.join('').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/g, '');
    return unido || 'SinEmpresa';
}

/** Nombre de carpeta Drive: limpia controles, colapsa espacios y limita longitud. */
function normalizarNombreCarpetaDrive(nombre, fallback = 'SinNombre') {
    const limpio = String(nombre || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    return limpio || fallback;
}

function formatearFechaArchivoOficio(fecha = new Date()) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const hoy = new Date();
        return formatearFechaArchivoOficio(hoy);
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function construirNombreBaseAnexo(empresa, numeroOficio, fecha = new Date()) {
    const nom = normalizarNombreEmpresaArchivo(empresa);
    const num = Number(numeroOficio) || 0;
    const fec = formatearFechaArchivoOficio(fecha);
    return `${nom}_${num}_${fec}`;
}

function construirNombreArchivoAnexo(empresa, numeroOficio, nombreOriginal, mimeType, fecha = new Date()) {
    const base = construirNombreBaseAnexo(empresa, numeroOficio, fecha);
    const ext = extensionDesdeNombre(nombreOriginal, mimeType) || '.pdf';
    return `${base}${ext}`;
}

function construirNombreBaseAnexoTramite(empresa, item, fecha = new Date()) {
    const nom = normalizarNombreEmpresaArchivo(empresa);
    const num = Number(item) || 0;
    const fec = formatearFechaArchivoOficio(fecha);
    return `${nom}_T${num}_${fec}`;
}

function construirNombreArchivoAnexoTramite(empresa, item, nombreOriginal, mimeType, fecha = new Date()) {
    const base = construirNombreBaseAnexoTramite(empresa, item, fecha);
    const ext = extensionDesdeNombre(nombreOriginal, mimeType) || '.pdf';
    return `${base}${ext}`;
}

function construirNombreArchivoContestacionTramite(empresa, item, nombreOriginal, mimeType, fecha = new Date()) {
    const base = construirNombreBaseAnexoTramite(empresa, item, fecha);
    const ext = extensionDesdeNombre(nombreOriginal, mimeType) || '.pdf';
    return `${base}_Contestacion${ext}`;
}

function nombreOficioCarpeta(oficio, item) {
    return normalizarNombreCarpetaDrive(
        oficio,
        Number(item) > 0 ? `Item_${Number(item)}` : 'SinOficio'
    );
}

/**
 * Padre del oficio: Ambiental / Empresa  ó  Ambiental / Empresa / Clasificacion
 */
async function obtenerCarpetaPadreOficio(empresa, clasificacion, { crear = true } = {}) {
    const nombreEmpresa = normalizarNombreCarpetaDrive(empresa, 'SinEmpresa');
    let padre;
    if (crear) {
        padre = await driveService.obtenerOCrearCarpeta(nombreEmpresa, SP_F28_ANEXOS_FOLDER_ID);
    } else {
        padre = await driveService.buscarCarpeta(nombreEmpresa, SP_F28_ANEXOS_FOLDER_ID);
        if (!padre) return null;
    }
    const clase = normalizarClasificacion(clasificacion);
    if (!clase) return padre;
    if (crear) {
        return driveService.obtenerOCrearCarpeta(clase, padre);
    }
    return driveService.buscarCarpeta(clase, padre);
}

/**
 * Ambiental / {Empresa} [/ {Clasificacion}] / {Oficio}
 */
async function obtenerCarpetaOficioTramite(empresa, oficio, item, clasificacion = null) {
    const padre = await obtenerCarpetaPadreOficio(empresa, clasificacion, { crear: true });
    const nombreOficio = nombreOficioCarpeta(oficio, item);
    return driveService.obtenerOCrearCarpeta(nombreOficio, padre);
}

/**
 * Busca la carpeta de oficio existente sin crearla.
 */
async function buscarCarpetaOficioTramite(empresa, oficio, item, clasificacion = null) {
    const padre = await obtenerCarpetaPadreOficio(empresa, clasificacion, { crear: false });
    if (!padre) return null;
    return driveService.buscarCarpeta(nombreOficioCarpeta(oficio, item), padre);
}

/**
 * Mueve (y opcionalmente renombra) la carpeta de oficio cuando cambia
 * clasificación u oficio en la edición del trámite.
 */
async function reubicarCarpetaOficioTramite({
    empresa,
    oficioAnterior,
    oficioNuevo,
    item,
    clasificacionAnterior = null,
    clasificacionNueva = null
}) {
    const claseAnt = normalizarClasificacion(clasificacionAnterior);
    const claseNueva = normalizarClasificacion(clasificacionNueva);
    const nombreAnt = nombreOficioCarpeta(oficioAnterior, item);
    const nombreNuevo = nombreOficioCarpeta(oficioNuevo, item);
    const mismaRuta = claseAnt === claseNueva && nombreAnt === nombreNuevo;
    if (mismaRuta) {
        return { movido: false, motivo: 'sin_cambios' };
    }

    const carpetaOrigen = await buscarCarpetaOficioTramite(
        empresa,
        oficioAnterior,
        item,
        claseAnt
    );
    if (!carpetaOrigen) {
        return { movido: false, motivo: 'sin_carpeta_origen' };
    }

    const padreDestino = await obtenerCarpetaPadreOficio(empresa, claseNueva, { crear: true });
    const existenteDestino = await driveService.buscarCarpeta(nombreNuevo, padreDestino);

    if (existenteDestino && existenteDestino !== carpetaOrigen) {
        // Ya hay carpeta en destino: fusionar contenido y eliminar origen.
        const [subcarpetas, archivos] = await Promise.all([
            driveService.listarSubcarpetas(carpetaOrigen).catch(() => []),
            driveService.listarArchivosCarpeta(carpetaOrigen).catch(() => [])
        ]);
        for (const sub of subcarpetas || []) {
            if (sub?.id) {
                await driveService.moverArchivoDrive(sub.id, existenteDestino).catch((err) => {
                    console.warn('[AMB-DRIVE] No se pudo mover subcarpeta:', err.message);
                });
            }
        }
        for (const arch of archivos || []) {
            if (arch?.id) {
                await driveService.moverArchivoDrive(arch.id, existenteDestino).catch((err) => {
                    console.warn('[AMB-DRIVE] No se pudo mover archivo:', err.message);
                });
            }
        }
        try {
            await driveService.eliminarCarpetaPorId(carpetaOrigen);
        } catch (err) {
            console.warn('[AMB-DRIVE] No se pudo eliminar carpeta origen vacía:', err.message);
        }
        return { movido: true, carpetaId: existenteDestino, fusionado: true };
    }

    await driveService.moverArchivoDrive(carpetaOrigen, padreDestino);
    if (nombreAnt !== nombreNuevo) {
        try {
            await driveService.renombrarCarpetaPorId(carpetaOrigen, nombreNuevo);
        } catch (err) {
            console.warn('[AMB-DRIVE] No se pudo renombrar carpeta de oficio:', err.message);
        }
    }
    return { movido: true, carpetaId: carpetaOrigen, fusionado: false };
}

async function subirAnexoOficio(fileBuffer, mimeType, nombreOriginal, empresa, numeroOficio, fecha = new Date()) {
    const nombreArchivo = construirNombreArchivoAnexo(
        empresa, numeroOficio, nombreOriginal, mimeType, fecha
    );
    return driveService.subirArchivo(
        fileBuffer,
        nombreArchivo,
        mimeType || 'application/octet-stream',
        SP_F15_ANEXOS_FOLDER_ID
    );
}

async function subirAnexoTramite(
    fileBuffer,
    mimeType,
    nombreOriginal,
    empresa,
    item,
    oficio = '',
    fecha = new Date(),
    clasificacion = null
) {
    const carpetaOficio = await obtenerCarpetaOficioTramite(empresa, oficio, item, clasificacion);
    const nombreArchivo = construirNombreArchivoAnexoTramite(
        empresa, item, nombreOriginal, mimeType, fecha
    );
    return driveService.subirArchivo(
        fileBuffer,
        nombreArchivo,
        mimeType || 'application/octet-stream',
        carpetaOficio
    );
}

async function subirContestacionTramite(
    fileBuffer,
    mimeType,
    nombreOriginal,
    empresa,
    item,
    oficio = '',
    fecha = new Date(),
    clasificacion = null
) {
    const carpetaOficio = await obtenerCarpetaOficioTramite(empresa, oficio, item, clasificacion);
    const nombreArchivo = construirNombreArchivoContestacionTramite(
        empresa, item, nombreOriginal, mimeType, fecha
    );
    return driveService.subirArchivo(
        fileBuffer,
        nombreArchivo,
        mimeType || 'application/octet-stream',
        carpetaOficio
    );
}

async function eliminarAnexoOficio(driveFileId) {
    if (!driveFileId) return { success: false };
    return driveService.eliminarArchivo(driveFileId);
}

module.exports = {
    SP_F15_ANEXOS_FOLDER_ID,
    SP_F28_ANEXOS_FOLDER_ID,
    CLASIFICACIONES_VALIDAS,
    normalizarClasificacion,
    construirNombreBaseAnexo,
    construirNombreArchivoAnexo,
    construirNombreBaseAnexoTramite,
    construirNombreArchivoAnexoTramite,
    construirNombreArchivoContestacionTramite,
    obtenerCarpetaOficioTramite,
    buscarCarpetaOficioTramite,
    reubicarCarpetaOficioTramite,
    subirAnexoOficio,
    subirAnexoTramite,
    subirContestacionTramite,
    eliminarAnexoOficio
};
