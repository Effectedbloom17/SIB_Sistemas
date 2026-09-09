/**
 * Evidencias de proyecto SGC-F-14 por fila (proyecto).
 * Archivos en Drive: carpeta F-14 / {folio} / {proyectoId}
 * Índice en biznaga_sgc.sgc_f14_evidencia
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const driveService = require('./driveService');

const CARPETA_DRIVE_EVIDENCIAS = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
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
    return sanitizarTexto(valor, 80)
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

async function resolverCarpetaEvaluacion(folio, proyectoId) {
    const carpetaFolio = await driveService.obtenerOCrearCarpeta(
        sanitizarNombreCarpeta(folio || 'Sin-folio'),
        CARPETA_DRIVE_EVIDENCIAS
    );
    return driveService.obtenerOCrearCarpeta(proyectoId, carpetaFolio);
}

async function listarEvidencias(pool, proyectoId) {
    await asegurarTablas(pool);
    const id = normalizarProyectoId(proyectoId);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_f14_evidencia
         WHERE proyecto_id = ?
         ORDER BY created_at DESC`,
        [id]
    );
    const documentos = rows.map(formatearRegistro);
    const totalBytes = documentos.reduce((s, d) => s + (d.tamanoBytes || 0), 0);
    return {
        proyectoId: id,
        carpetaDriveId: CARPETA_DRIVE_EVIDENCIAS,
        carpetaDriveUrl: `https://drive.google.com/drive/folders/${CARPETA_DRIVE_EVIDENCIAS}`,
        documentos,
        total: documentos.length,
        totalBytes
    };
}

async function contarEvidencias(pool, proyectoIds) {
    await asegurarTablas(pool);
    const ids = (Array.isArray(proyectoIds) ? proyectoIds : [])
        .map((v) => String(v || '').trim())
        .filter((v) => v && v.length <= 64);
    if (!ids.length) return {};
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT proyecto_id, COUNT(*) AS total
         FROM sgc_f14_evidencia
         WHERE proyecto_id IN (${placeholders})
         GROUP BY proyecto_id`,
        ids
    );
    const mapa = {};
    for (const row of rows) {
        mapa[row.proyecto_id] = Number(row.total) || 0;
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
    const proyectoId = normalizarProyectoId(body?.proyecto_id || body?.proyectoId);
    const folio = sanitizarTexto(body?.folio, 255);
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

    const carpetaDriveId = await resolverCarpetaEvaluacion(folio, proyectoId);
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
            return await subirABaseDeDatos(pool, {
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
        } catch (err) {
            ultimoError = err;
            if (driveResult?.id) {
                try {
                    await driveService.eliminarArchivo(driveResult.id);
                } catch (cleanupErr) {
                    console.warn('[SGC-F14-EVID] No se pudo revertir archivo en Drive:', cleanupErr.message);
                }
                driveResult = null;
            }
            if (intento < SUBIDA_REINTENTOS_MAX && esErrorReintentable(err)) {
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
    const proyectoId = normalizarProyectoId(body?.proyecto_id || body?.proyectoId);
    const folio = sanitizarTexto(body?.folio, 255);
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
            ...archivo
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
        errores
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
    subirEvidencia,
    subirEvidenciasLote,
    eliminarEvidencia,
    obtenerDocumento,
    obtenerBufferEvidencia
};
