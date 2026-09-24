/**
 * Evidencias de proyecto SGC-F-14 por fila (proyecto).
 * Archivos en Drive: {CARPETA_DRIVE_EVIDENCIAS} / {nombre del proyecto} / [subcarpeta opcional]
 * Índice en biznaga_sgc.sgc_f14_evidencia
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const driveService = require('./driveService');

/** Carpeta raíz de evidencias SGC-F-14 en Drive (una subcarpeta por nombre de proyecto). */
const CARPETA_DRIVE_EVIDENCIAS = '1D0hAwRjPMykzD-fmiW6mIZtj5rPNXL6F';
const CACHE_DIR = path.join(__dirname, 'uploads', 'sgc-f14-evidencias');
const MIME_GENERICO = 'application/octet-stream';
const SUBIDA_REINTENTOS_MAX = 3;
const SUBIDA_REINTENTO_MS = 1200;
const SUBIDA_LOTE_CONCURRENCIA = 2;

const MIME_PERMITIDOS = new Set([
    'application/pdf',
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
]);

const EXTENSION_A_MIME = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    txt: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml'
};

const COLUMNAS_SELECT = `
    id, proyecto_id, folio, nombre_proyecto, titulo, nombre_archivo, nombre_archivo_drive,
    drive_file_id, carpeta_drive_id, web_view_link, mime_type, tamano_bytes, subido_por,
    created_at, updated_at
`;

function extensionDesdeNombre(nombre) {
    const partes = String(nombre || '').toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
}

function resolverMimeType(nombreArchivo, mimeEntrada) {
    const mime = String(mimeEntrada || '').trim().toLowerCase();
    if (mime && MIME_PERMITIDOS.has(mime)) return mime;
    const ext = extensionDesdeNombre(nombreArchivo);
    if (EXTENSION_A_MIME[ext]) return EXTENSION_A_MIME[ext];
    return mime || MIME_GENERICO;
}

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function nombreSeguroArchivo(nombre) {
    const base = String(nombre || 'documento')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base || 'documento';
}

function sanitizarNombreCarpeta(valor) {
    return sanitizarTexto(valor, 200)
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'Sin-nombre';
}

function normalizarProyectoId(valor) {
    const id = String(valor || '').trim();
    if (!id || id.length > 64) {
        const err = new Error('ID de proyecto inválido.');
        err.status = 400;
        throw err;
    }
    return id;
}

/** Clave estable: folio (PM-…) cuando existe; si no, el id UUID enviado. */
function resolverClaveProyecto(folio, proyectoIdRaw) {
    const folioLimpio = sanitizarTexto(folio, 64);
    if (folioLimpio) return folioLimpio;
    return normalizarProyectoId(proyectoIdRaw);
}

function generarProyectoId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function formatearRegistro(row) {
    if (!row) return null;
    return {
        id: row.id,
        proyectoId: row.proyecto_id,
        folio: row.folio || '',
        nombreProyecto: row.nombre_proyecto || '',
        titulo: row.titulo,
        nombreArchivo: row.nombre_archivo,
        nombreArchivoDrive: row.nombre_archivo_drive || row.nombre_archivo,
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        driveFileId: row.drive_file_id,
        carpetaDriveId: row.carpeta_drive_id || null,
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

async function asegurarTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_f14_evidencia (
            id INT AUTO_INCREMENT PRIMARY KEY,
            proyecto_id VARCHAR(64) NOT NULL,
            folio VARCHAR(255) NULL,
            nombre_proyecto VARCHAR(255) NULL,
            titulo VARCHAR(255) NOT NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            nombre_archivo_drive VARCHAR(512) NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            carpeta_drive_id VARCHAR(128) NOT NULL,
            web_view_link VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            subido_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_f14_evid_drive (drive_file_id),
            KEY idx_sgc_f14_evid_eval (proyecto_id),
            KEY idx_sgc_f14_evid_prov (folio(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function asegurarCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function rutaCacheDocumento(id, nombreArchivo) {
    asegurarCacheDir();
    const safe = nombreSeguroArchivo(nombreArchivo).replace(/\s+/g, '_');
    return path.join(CACHE_DIR, `${id}_${safe}`);
}

function escribirCacheDocumento(id, nombreArchivo, buffer) {
    try {
        fs.writeFileSync(rutaCacheDocumento(id, nombreArchivo), buffer);
    } catch (err) {
        console.warn('[SGC-F14-EVID] No se pudo cachear archivo:', err.message);
    }
}

function leerCacheDocumento(id, nombreArchivo) {
    try {
        const ruta = rutaCacheDocumento(id, nombreArchivo);
        if (fs.existsSync(ruta)) return fs.readFileSync(ruta);
    } catch (_) { /* ignore */ }
    return null;
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function esErrorReintentable(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const code = err?.code || err?.response?.status;
    return (
        code === 429 || code === 503 || code === 500
        || msg.includes('rate limit') || msg.includes('quota')
        || msg.includes('econnreset') || msg.includes('etimedout')
        || msg.includes('socket hang up')
    );
}

/**
 * Resuelve (o crea) la carpeta del proyecto bajo la raíz de evidencias.
 * Estructura: raíz / {nombreProyecto} / [subcarpeta]
 */
async function resolverCarpetaProyecto(nombreProyecto, subcarpeta) {
    const carpetaProyecto = await driveService.obtenerOCrearCarpeta(
        sanitizarNombreCarpeta(nombreProyecto || 'Sin-nombre'),
        CARPETA_DRIVE_EVIDENCIAS
    );
    const sub = sanitizarNombreCarpeta(subcarpeta || '');
    if (sub && sub !== 'Sin-nombre') {
        return driveService.obtenerOCrearCarpeta(sub, carpetaProyecto);
    }
    return carpetaProyecto;
}

async function buscarCarpetaProyectoExistente(nombreProyecto) {
    const nombre = sanitizarNombreCarpeta(nombreProyecto || '');
    if (!nombre || nombre === 'Sin-nombre') return null;
    try {
        return await driveService.buscarCarpeta(nombre, CARPETA_DRIVE_EVIDENCIAS);
    } catch (err) {
        console.warn('[SGC-F14-EVID] No se pudo buscar carpeta de proyecto:', err.message);
        return null;
    }
}

/** Lista archivos en la carpeta del proyecto y 1 nivel de subcarpetas. */
async function listarArchivosDriveProyecto(carpetaProyectoId) {
    if (!carpetaProyectoId) return [];
    const resultados = [];
    const raiz = await driveService.listarArchivosCarpeta(carpetaProyectoId);
    for (const f of raiz || []) {
        if (f?.id) resultados.push({ ...f, carpetaDriveId: carpetaProyectoId });
    }
    let subcarpetas = [];
    try {
        subcarpetas = await driveService.listarSubcarpetas(carpetaProyectoId);
    } catch (_) {
        subcarpetas = [];
    }
    for (const sub of subcarpetas || []) {
        if (!sub?.id) continue;
        try {
            const archivos = await driveService.listarArchivosCarpeta(sub.id);
            for (const f of archivos || []) {
                if (f?.id) resultados.push({ ...f, carpetaDriveId: sub.id });
            }
        } catch (err) {
            console.warn('[SGC-F14-EVID] No se pudo listar subcarpeta Drive:', err.message);
        }
    }
    return resultados;
}

/**
 * Reasigna filas huérfanas (UUID viejo) al folio estable y registra en BD
 * los archivos que ya están en Drive pero no en sgc_f14_evidencia.
 */
async function sincronizarEvidenciasDesdeDrive(pool, {
    proyectoId,
    folio,
    nombreProyecto
}) {
    await asegurarTablas(pool);
    const clave = resolverClaveProyecto(folio, proyectoId);
    const folioLimpio = sanitizarTexto(folio, 255);
    const nombreLimpio = sanitizarTexto(nombreProyecto, 255);

    // Unificar registros previos ligados por folio/nombre/UUID al folio estable.
    const whereParts = ['proyecto_id = ?'];
    const whereParams = [clave];
    if (proyectoId && String(proyectoId).trim() !== clave) {
        whereParts.push('proyecto_id = ?');
        whereParams.push(String(proyectoId).trim());
    }
    if (folioLimpio) {
        whereParts.push('folio = ?');
        whereParams.push(folioLimpio);
    }
    if (nombreLimpio) {
        whereParts.push('nombre_proyecto = ?');
        whereParams.push(nombreLimpio);
    }
    await pool.query(
        `UPDATE sgc_f14_evidencia
         SET proyecto_id = ?,
             folio = COALESCE(NULLIF(?, ''), folio),
             nombre_proyecto = COALESCE(NULLIF(?, ''), nombre_proyecto)
         WHERE ${whereParts.join(' OR ')}`,
        [clave, folioLimpio || '', nombreLimpio || '', ...whereParams]
    );

    const carpetaId = await buscarCarpetaProyectoExistente(nombreLimpio || folioLimpio || clave);
    if (!carpetaId) {
        return { clave, importados: 0, carpetaDriveId: null };
    }

    const archivosDrive = await listarArchivosDriveProyecto(carpetaId);
    if (!archivosDrive.length) {
        return { clave, importados: 0, carpetaDriveId: carpetaId };
    }

    const driveIds = archivosDrive.map((a) => a.id).filter(Boolean);
    const existentes = new Set();
    if (driveIds.length) {
        const placeholders = driveIds.map(() => '?').join(',');
        const [rows] = await pool.query(
            `SELECT drive_file_id FROM sgc_f14_evidencia WHERE drive_file_id IN (${placeholders})`,
            driveIds
        );
        for (const row of rows) {
            if (row.drive_file_id) existentes.add(row.drive_file_id);
        }
    }

    let importados = 0;
    for (const archivo of archivosDrive) {
        if (!archivo?.id || existentes.has(archivo.id)) continue;
        const nombreArchivo = nombreSeguroArchivo(archivo.name || 'documento');
        const mimeType = resolverMimeType(nombreArchivo, archivo.mimeType);
        const tamano = archivo.size != null ? Number(archivo.size) : null;
        try {
            await pool.query(
                `INSERT INTO sgc_f14_evidencia
                    (proyecto_id, folio, nombre_proyecto, titulo, nombre_archivo, nombre_archivo_drive,
                     drive_file_id, carpeta_drive_id, web_view_link, mime_type, tamano_bytes, subido_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    proyecto_id = VALUES(proyecto_id),
                    folio = COALESCE(VALUES(folio), folio),
                    nombre_proyecto = COALESCE(VALUES(nombre_proyecto), nombre_proyecto),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    clave,
                    folioLimpio || null,
                    nombreLimpio || null,
                    nombreArchivo,
                    nombreArchivo,
                    archivo.name || nombreArchivo,
                    archivo.id,
                    archivo.carpetaDriveId || carpetaId,
                    archivo.webViewLink || `https://drive.google.com/file/d/${archivo.id}/view`,
                    mimeType,
                    Number.isFinite(tamano) ? tamano : null,
                    'sync-drive'
                ]
            );
            importados += 1;
        } catch (err) {
            console.warn('[SGC-F14-EVID] No se pudo registrar archivo de Drive en BD:', err.message);
        }
    }

    return { clave, importados, carpetaDriveId: carpetaId };
}

async function crearCarpetaEvidencia(pool, body) {
    const folio = sanitizarTexto(body?.folio, 255);
    const proyectoId = resolverClaveProyecto(folio, body?.proyecto_id || body?.proyectoId);
    const nombreProyecto = sanitizarTexto(body?.nombre_proyecto || body?.nombreProyecto, 255);
    const nombre = sanitizarNombreCarpeta(body?.nombre || body?.nombre_carpeta);
    if (!nombre || nombre === 'Sin-nombre') {
        throw Object.assign(new Error('Indica un nombre válido para la carpeta.'), { status: 400 });
    }
    const nombreCarpetaProyecto = nombreProyecto || folio;
    if (!nombreCarpetaProyecto) {
        throw Object.assign(new Error('Indica el nombre del proyecto de mejora.'), { status: 400 });
    }
    const carpetaDriveId = await resolverCarpetaProyecto(nombreCarpetaProyecto, nombre);
    return {
        proyectoId,
        nombreProyecto: nombreCarpetaProyecto,
        nombre,
        carpetaDriveId,
        webViewLink: `https://drive.google.com/drive/folders/${carpetaDriveId}`
    };
}

async function listarEvidencias(pool, proyectoId, opciones = {}) {
    await asegurarTablas(pool);
    const folio = sanitizarTexto(opciones.folio, 255);
    const nombreProyecto = sanitizarTexto(
        opciones.nombre_proyecto || opciones.nombreProyecto,
        255
    );
    const clave = resolverClaveProyecto(folio, proyectoId);

    let syncInfo = { importados: 0, carpetaDriveId: null };
    try {
        syncInfo = await sincronizarEvidenciasDesdeDrive(pool, {
            proyectoId,
            folio,
            nombreProyecto
        });
    } catch (err) {
        console.warn('[SGC-F14-EVID] Sync Drive→BD omitida:', err.message);
    }

    const whereParts = ['proyecto_id = ?'];
    const params = [clave];
    if (proyectoId && String(proyectoId).trim() !== clave) {
        whereParts.push('proyecto_id = ?');
        params.push(String(proyectoId).trim());
    }
    if (folio) {
        whereParts.push('folio = ?');
        params.push(folio);
    }
    if (nombreProyecto) {
        whereParts.push('nombre_proyecto = ?');
        params.push(nombreProyecto);
    }

    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_f14_evidencia
         WHERE ${whereParts.join(' OR ')}
         ORDER BY created_at DESC`,
        params
    );
    const documentos = rows.map(formatearRegistro);
    const totalBytes = documentos.reduce((s, d) => s + (d.tamanoBytes || 0), 0);
    const carpetaProyectoId = syncInfo.carpetaDriveId || documentos[0]?.carpetaDriveId || null;
    return {
        proyectoId: clave,
        carpetaDriveId: carpetaProyectoId || CARPETA_DRIVE_EVIDENCIAS,
        carpetaDriveUrl: carpetaProyectoId
            ? `https://drive.google.com/drive/folders/${carpetaProyectoId}`
            : `https://drive.google.com/drive/folders/${CARPETA_DRIVE_EVIDENCIAS}`,
        documentos,
        total: documentos.length,
        totalBytes,
        sincronizados: syncInfo.importados || 0
    };
}

async function contarEvidencias(pool, proyectoIds) {
    await asegurarTablas(pool);
    const ids = (Array.isArray(proyectoIds) ? proyectoIds : [])
        .map((v) => String(v || '').trim())
        .filter((v) => v && v.length <= 64);
    if (!ids.length) return {};

    const mapa = {};
    for (const id of ids) mapa[id] = 0;

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT id, proyecto_id, folio
         FROM sgc_f14_evidencia
         WHERE proyecto_id IN (${placeholders}) OR folio IN (${placeholders})`,
        [...ids, ...ids]
    );

    const porClave = new Map();
    for (const id of ids) porClave.set(id, new Set());
    for (const row of rows) {
        for (const id of ids) {
            if (row.proyecto_id === id || row.folio === id) {
                porClave.get(id).add(row.id);
            }
        }
    }
    for (const id of ids) {
        mapa[id] = porClave.get(id)?.size || 0;
    }
    return mapa;
}

async function obtenerDocumento(pool, id) {
    await asegurarTablas(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT} FROM sgc_f14_evidencia WHERE id = ? LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0] || null);
}

async function subirABaseDeDatos(pool, {
    proyectoId,
    folio,
    nombre_proyecto,
    nombreArchivo,
    mimeType,
    buffer,
    driveResult,
    carpetaDriveId,
    usuario
}) {
    await asegurarTablas(pool);
    const [insert] = await pool.query(
        `INSERT INTO sgc_f14_evidencia
            (proyecto_id, folio, nombre_proyecto, titulo, nombre_archivo, nombre_archivo_drive,
             drive_file_id, carpeta_drive_id, web_view_link, mime_type, tamano_bytes, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            proyectoId,
            sanitizarTexto(folio, 255) || null,
            sanitizarTexto(nombre_proyecto, 255) || null,
            nombreArchivo,
            nombreArchivo,
            driveResult.name || nombreArchivo,
            driveResult.id,
            carpetaDriveId,
            driveResult.webViewLink || null,
            mimeType,
            buffer.length,
            sanitizarTexto(usuario, 128) || null
        ]
    );
    const creado = await obtenerDocumento(pool, insert.insertId);
    if (creado?.id && buffer?.length) {
        escribirCacheDocumento(creado.id, creado.nombreArchivo || nombreArchivo, buffer);
    }
    return creado;
}

async function subirEvidencia(pool, body, usuario) {
    const folio = sanitizarTexto(body?.folio, 255);
    const proyectoId = resolverClaveProyecto(folio, body?.proyecto_id || body?.proyectoId);
    const nombreProyecto = sanitizarTexto(body?.nombre_proyecto || body?.nombreProyecto, 255);
    const archivoBase64 = String(body?.archivo_base64 || body?.archivoBase64 || '').trim();
    const nombreArchivo = nombreSeguroArchivo(body?.nombre_archivo || body?.nombreArchivo);

    if (!archivoBase64) {
        throw Object.assign(new Error('No se recibió el archivo (archivo_base64 requerido).'), { status: 400 });
    }
    if (!nombreArchivo) {
        throw Object.assign(new Error('Nombre de archivo inválido.'), { status: 400 });
    }

    const mimeType = resolverMimeType(nombreArchivo, body?.mime_type || body?.mimeType);
    const buffer = Buffer.from(archivoBase64, 'base64');
    if (!buffer.length) {
        throw Object.assign(new Error('El archivo está vacío.'), { status: 400 });
    }
    if (buffer.length > 40 * 1024 * 1024) {
        throw Object.assign(new Error('El archivo supera el máximo de 40 MB.'), { status: 400 });
    }

    if (!nombreProyecto && !folio) {
        throw Object.assign(new Error('Indica el nombre del proyecto de mejora.'), { status: 400 });
    }

    const carpetaDriveId = await resolverCarpetaProyecto(
        nombreProyecto || folio,
        body?.subcarpeta || body?.carpeta || body?.folder
    );
    let driveResult = null;
    let ultimoError = null;

    for (let intento = 1; intento <= SUBIDA_REINTENTOS_MAX; intento++) {
        try {
            driveResult = await driveService.uploadFileFast(
                buffer,
                nombreArchivo,
                mimeType,
                carpetaDriveId
            );
            let documento;
            try {
                documento = await subirABaseDeDatos(pool, {
                    proyectoId,
                    folio,
                    nombre_proyecto: nombreProyecto,
                    nombreArchivo,
                    mimeType,
                    buffer,
                    driveResult,
                    carpetaDriveId,
                    usuario
                });
            } catch (dbErr) {
                // Si Drive ya tiene el archivo, no lo borramos: reintentamos registrar en BD.
                console.error('[SGC-F14-EVID] Archivo en Drive pero falló registro BD:', dbErr.message);
                throw Object.assign(
                    new Error(`El archivo se subió a Drive pero no se registró en BD: ${dbErr.message}`),
                    { status: 500, driveFileId: driveResult?.id }
                );
            }
            return {
                ...documento,
                carpetaProyectoUrl: `https://drive.google.com/drive/folders/${carpetaDriveId}`
            };
        } catch (err) {
            ultimoError = err;
            // Solo revertir Drive si el fallo fue ANTES de tener id o si no es error de BD post-subida
            if (driveResult?.id && !err?.driveFileId) {
                try {
                    await driveService.eliminarArchivo(driveResult.id);
                } catch (cleanupErr) {
                    console.warn('[SGC-F14-EVID] No se pudo revertir archivo en Drive:', cleanupErr.message);
                }
                driveResult = null;
            }
            if (intento < SUBIDA_REINTENTOS_MAX && esErrorReintentable(err) && !err?.driveFileId) {
                await esperar(SUBIDA_REINTENTO_MS * intento);
                continue;
            }
            throw err;
        }
    }
    throw ultimoError || new Error('No se pudo subir la evidencia.');
}

async function ejecutarConConcurrencia(items, concurrencia, fn) {
    const resultados = new Array(items.length);
    let indice = 0;
    async function worker() {
        while (indice < items.length) {
            const i = indice++;
            try {
                resultados[i] = { ok: true, valor: await fn(items[i], i) };
            } catch (err) {
                resultados[i] = { ok: false, error: err };
            }
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(concurrencia, items.length) }, () => worker())
    );
    return resultados;
}

async function subirEvidenciasLote(pool, body, usuario) {
    const folio = sanitizarTexto(body?.folio, 255);
    const proyectoId = resolverClaveProyecto(folio, body?.proyecto_id || body?.proyectoId);
    const nombreProyecto = sanitizarTexto(body?.nombre_proyecto || body?.nombreProyecto, 255);
    const archivos = Array.isArray(body?.archivos) ? body.archivos : [];
    if (!archivos.length) {
        throw Object.assign(new Error('No se recibieron archivos para subir.'), { status: 400 });
    }
    if (archivos.length > 20) {
        throw Object.assign(new Error('Máximo 20 archivos por lote.'), { status: 400 });
    }

    const resultados = await ejecutarConConcurrencia(archivos, SUBIDA_LOTE_CONCURRENCIA, (archivo) =>
        subirEvidencia(pool, {
            proyecto_id: proyectoId,
            folio,
            nombre_proyecto: nombreProyecto,
            nombre_archivo: archivo?.nombre_archivo || archivo?.nombreArchivo,
            mime_type: archivo?.mime_type || archivo?.mimeType,
            archivo_base64: archivo?.archivo_base64 || archivo?.archivoBase64,
            subcarpeta: archivo?.subcarpeta || archivo?.carpeta || body?.subcarpeta || body?.carpeta
        }, usuario)
    );

    const documentos = [];
    const errores = [];
    resultados.forEach((r, i) => {
        if (r.ok) documentos.push(r.valor);
        else errores.push({ indice: i, message: r.error?.message || 'Error al subir' });
    });

    return {
        exitosos: documentos.length,
        fallidos: errores.length,
        documentos,
        errores,
        carpetaProyectoUrl: documentos[0]?.carpetaProyectoUrl
            || (documentos[0]?.carpetaDriveId
                ? `https://drive.google.com/drive/folders/${documentos[0].carpetaDriveId}`
                : null),
        carpetaRaizUrl: `https://drive.google.com/drive/folders/${CARPETA_DRIVE_EVIDENCIAS}`
    };
}

async function eliminarEvidencia(pool, id) {
    await asegurarTablas(pool);
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        const err = new Error('Evidencia no encontrada.');
        err.status = 404;
        throw err;
    }
    if (doc.driveFileId) {
        try {
            await driveService.eliminarArchivo(doc.driveFileId);
        } catch (err) {
            console.warn('[SGC-F14-EVID] No se pudo borrar en Drive:', err.message);
        }
    }
    await pool.query('DELETE FROM sgc_f14_evidencia WHERE id = ?', [id]);
    try {
        const cache = rutaCacheDocumento(doc.id, doc.nombreArchivo);
        if (fs.existsSync(cache)) fs.unlinkSync(cache);
    } catch (_) { /* ignore */ }
    return { eliminado: true, id };
}

async function obtenerBufferEvidencia(pool, id) {
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        const err = new Error('Evidencia no encontrada.');
        err.status = 404;
        throw err;
    }
    let buffer = leerCacheDocumento(doc.id, doc.nombreArchivo);
    if (!buffer && doc.driveFileId) {
        buffer = await driveService.descargarArchivoBinario(doc.driveFileId);
        if (buffer?.length) escribirCacheDocumento(doc.id, doc.nombreArchivo, buffer);
    }
    if (!buffer?.length) {
        const err = new Error('No se pudo obtener el archivo.');
        err.status = 404;
        throw err;
    }
    return { documento: doc, buffer };
}

module.exports = {
    CARPETA_DRIVE_EVIDENCIAS,
    generarProyectoId,
    asegurarTablas,
    listarEvidencias,
    contarEvidencias,
    crearCarpetaEvidencia,
    subirEvidencia,
    subirEvidenciasLote,
    eliminarEvidencia,
    obtenerDocumento,
    obtenerBufferEvidencia,
    sincronizarEvidenciasDesdeDrive
};
