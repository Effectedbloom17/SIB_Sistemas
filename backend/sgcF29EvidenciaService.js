/**
 * Evidencias de evaluación SGC-F-29 por fila (evaluación).
 * Archivos en Drive: carpeta 1_R4gKOBWcBOl3SIxSasgfrt5_EB2rDME / {proveedor} / {evaluacionId}
 * Índice en biznaga_sgc.sgc_f29_evidencia
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const driveService = require('./driveService');

const CARPETA_DRIVE_EVIDENCIAS = '1_R4gKOBWcBOl3SIxSasgfrt5_EB2rDME';
const CACHE_DIR = path.join(__dirname, 'uploads', 'sgc-f29-evidencias');
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
    id, evaluacion_id, proveedor, referencia, titulo, nombre_archivo, nombre_archivo_drive,
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

function normalizarEvaluacionId(valor) {
    const id = String(valor || '').trim();
    if (!id || id.length > 64) {
        const err = new Error('ID de evaluación inválido.');
        err.status = 400;
        throw err;
    }
    return id;
}

function generarEvaluacionId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function formatearRegistro(row) {
    if (!row) return null;
    return {
        id: row.id,
        evaluacionId: row.evaluacion_id,
        proveedor: row.proveedor || '',
        referencia: row.referencia || '',
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
        CREATE TABLE IF NOT EXISTS sgc_f29_evidencia (
            id INT AUTO_INCREMENT PRIMARY KEY,
            evaluacion_id VARCHAR(64) NOT NULL,
            proveedor VARCHAR(255) NULL,
            referencia VARCHAR(120) NULL,
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
            UNIQUE KEY uq_sgc_f29_evid_drive (drive_file_id),
            KEY idx_sgc_f29_evid_eval (evaluacion_id),
            KEY idx_sgc_f29_evid_prov (proveedor(191))
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
        console.warn('[SGC-F29-EVID] No se pudo cachear archivo:', err.message);
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

async function resolverCarpetaEvaluacion(proveedor, evaluacionId) {
    const carpetaProv = await driveService.obtenerOCrearCarpeta(
        sanitizarNombreCarpeta(proveedor || 'Sin-nombre'),
        CARPETA_DRIVE_EVIDENCIAS
    );
    return driveService.obtenerOCrearCarpeta(evaluacionId, carpetaProv);
}

async function listarEvidencias(pool, evaluacionId) {
    await asegurarTablas(pool);
    const id = normalizarEvaluacionId(evaluacionId);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_f29_evidencia
         WHERE evaluacion_id = ?
         ORDER BY created_at DESC`,
        [id]
    );
    const documentos = rows.map(formatearRegistro);
    const totalBytes = documentos.reduce((s, d) => s + (d.tamanoBytes || 0), 0);
    return {
        evaluacionId: id,
        carpetaDriveId: CARPETA_DRIVE_EVIDENCIAS,
        carpetaDriveUrl: `https://drive.google.com/drive/folders/${CARPETA_DRIVE_EVIDENCIAS}`,
        documentos,
        total: documentos.length,
        totalBytes
    };
}

async function contarEvidencias(pool, evaluacionIds) {
    await asegurarTablas(pool);
    const ids = (Array.isArray(evaluacionIds) ? evaluacionIds : [])
        .map((v) => String(v || '').trim())
        .filter((v) => v && v.length <= 64);
    if (!ids.length) return {};
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT evaluacion_id, COUNT(*) AS total
         FROM sgc_f29_evidencia
         WHERE evaluacion_id IN (${placeholders})
         GROUP BY evaluacion_id`,
        ids
    );
    const mapa = {};
    for (const row of rows) {
        mapa[row.evaluacion_id] = Number(row.total) || 0;
    }
    return mapa;
}

async function obtenerDocumento(pool, id) {
    await asegurarTablas(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT} FROM sgc_f29_evidencia WHERE id = ? LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0] || null);
}

async function subirABaseDeDatos(pool, {
    evaluacionId,
    proveedor,
    referencia,
    nombreArchivo,
    mimeType,
    buffer,
    driveResult,
    carpetaDriveId,
    usuario
}) {
    await asegurarTablas(pool);
    const [insert] = await pool.query(
        `INSERT INTO sgc_f29_evidencia
            (evaluacion_id, proveedor, referencia, titulo, nombre_archivo, nombre_archivo_drive,
             drive_file_id, carpeta_drive_id, web_view_link, mime_type, tamano_bytes, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            evaluacionId,
            sanitizarTexto(proveedor, 255) || null,
            sanitizarTexto(referencia, 120) || null,
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
    const evaluacionId = normalizarEvaluacionId(body?.evaluacion_id || body?.evaluacionId);
    const proveedor = sanitizarTexto(body?.proveedor, 255);
    const referencia = sanitizarTexto(body?.referencia, 120);
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

    const carpetaDriveId = await resolverCarpetaEvaluacion(proveedor, evaluacionId);
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
                evaluacionId,
                proveedor,
                referencia,
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
                    console.warn('[SGC-F29-EVID] No se pudo revertir archivo en Drive:', cleanupErr.message);
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
    const evaluacionId = normalizarEvaluacionId(body?.evaluacion_id || body?.evaluacionId);
    const proveedor = sanitizarTexto(body?.proveedor, 255);
    const referencia = sanitizarTexto(body?.referencia, 120);
    const archivos = Array.isArray(body?.archivos) ? body.archivos : [];
    if (!archivos.length) {
        throw Object.assign(new Error('No se recibieron archivos para subir.'), { status: 400 });
    }
    if (archivos.length > 20) {
        throw Object.assign(new Error('Máximo 20 archivos por lote.'), { status: 400 });
    }

    const resultados = await ejecutarConConcurrencia(archivos, SUBIDA_LOTE_CONCURRENCIA, (archivo) =>
        subirEvidencia(pool, {
            evaluacion_id: evaluacionId,
            proveedor,
            referencia,
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
            console.warn('[SGC-F29-EVID] No se pudo borrar en Drive:', err.message);
        }
    }
    await pool.query('DELETE FROM sgc_f29_evidencia WHERE id = ?', [id]);
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
    generarEvaluacionId,
    asegurarTablas,
    listarEvidencias,
    contarEvidencias,
    subirEvidencia,
    subirEvidenciasLote,
    eliminarEvidencia,
    obtenerDocumento,
    obtenerBufferEvidencia
};
