/**
 * Documentación complementaria del SGC (fuera de capítulos ISO).
 * Cada archivo se persiste en biznaga_sgc (sgc_documentacion_extra) y en Google Drive (Repositorio DI).
 * Además se guarda una caché local para servir miniaturas aunque Drive falle.
 * Soporte de carpetas virtuales vía carpeta_relativa + registro de carpetas vacías.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const driveService = require('./driveService');

/** Carpeta exclusiva del Repositorio de Diseño e Innovación. */
const CARPETA_DRIVE_REPOSITORIO_ID = '1cjhFcAN_gxQlViMwNc7REIh-TpfwW24s';
const CACHE_DIR = path.join(__dirname, 'uploads', 'sgc-documentacion-extra');
const THUMB_DIR = path.join(CACHE_DIR, 'thumbs');

const MIME_GENERICO = 'application/octet-stream';

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

const SUBIDA_LOTE_CONCURRENCIA = 2;
const SUBIDA_REINTENTOS_MAX = 3;
const SUBIDA_REINTENTO_MS = 1200;

function extensionDesdeNombre(nombre) {
    const partes = String(nombre || '').toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
}

function resolverMimeType(nombreArchivo, mimeEntrada) {
    const mime = String(mimeEntrada || '').trim().toLowerCase();
    if (mime && MIME_PERMITIDOS.has(mime)) {
        return mime;
    }
    const ext = extensionDesdeNombre(nombreArchivo);
    if (EXTENSION_A_MIME[ext]) {
        return EXTENSION_A_MIME[ext];
    }
    // Se aceptan archivos de cualquier tipo (incluye subida de carpetas completas).
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

/**
 * Normaliza ruta relativa bajo el Repositorio.
 * Ej: "Inventario\\2024/../x" → "Inventario/2024/x"
 */
function sanitizarCarpetaRelativa(ruta) {
    return String(ruta || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(seg => sanitizarTexto(seg, 120).replace(/[/\\?%*:|"<>]/g, '_'))
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .slice(0, 8)
        .join('/');
}

function unirRutaCarpeta(base, relativa) {
    const a = sanitizarCarpetaRelativa(base);
    const b = sanitizarCarpetaRelativa(relativa);
    if (!a) return b;
    if (!b) return a;
    return sanitizarCarpetaRelativa(`${a}/${b}`);
}

/**
 * Resuelve (o crea) la carpeta de Drive correspondiente a una ruta relativa.
 */
async function resolverCarpetaDrivePorRuta(rutaRelativa) {
    const ruta = sanitizarCarpetaRelativa(rutaRelativa);
    if (!ruta) {
        return CARPETA_DRIVE_REPOSITORIO_ID;
    }
    let carpetaId = CARPETA_DRIVE_REPOSITORIO_ID;
    for (const segmento of ruta.split('/')) {
        carpetaId = await driveService.obtenerOCrearCarpeta(segmento, carpetaId);
    }
    return carpetaId;
}

function formatearRegistro(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        titulo: row.titulo,
        descripcion: row.descripcion || '',
        categoria: row.categoria || '',
        nombreArchivo: row.nombre_archivo,
        nombreArchivoDrive: row.nombre_archivo_drive || row.nombre_archivo,
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        driveFileId: row.drive_file_id,
        carpetaDriveId: row.carpeta_drive_id || CARPETA_DRIVE_REPOSITORIO_ID,
        carpetaRelativa: row.carpeta_relativa || '',
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

function formatearCarpeta(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        ruta: row.ruta || '',
        nombre: row.nombre || (row.ruta || '').split('/').pop() || '',
        driveFolderId: row.drive_folder_id || null,
        creadaPor: row.creada_por || null,
        fechaCreacion: row.created_at
    };
}

const COLUMNAS_SELECT = `
    id, titulo, descripcion, categoria, nombre_archivo, nombre_archivo_drive,
    drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type,
    tamano_bytes, subido_por, created_at, updated_at
`;

async function asegurarColumnasSgcDocumentacionExtra(pool) {
    const alteraciones = [
        'ADD COLUMN nombre_archivo_drive VARCHAR(512) NULL AFTER nombre_archivo',
        'ADD COLUMN carpeta_drive_id VARCHAR(128) NULL AFTER drive_file_id',
        'ADD COLUMN web_view_link VARCHAR(512) NULL AFTER carpeta_drive_id',
        'ADD COLUMN carpeta_relativa VARCHAR(512) NULL DEFAULT NULL AFTER carpeta_drive_id'
    ];
    for (const sql of alteraciones) {
        try {
            await pool.query(`ALTER TABLE sgc_documentacion_extra ${sql}`);
        } catch (err) {
            const msg = String(err?.message || '');
            if (!msg.includes('Duplicate column')) {
                throw err;
            }
        }
    }
    try {
        await pool.query(`
            ALTER TABLE sgc_documentacion_extra
            ADD KEY idx_sgc_doc_extra_carpeta (carpeta_relativa(191))
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarTablaCarpetas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_documentacion_extra_carpetas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ruta VARCHAR(512) NOT NULL,
            nombre VARCHAR(120) NOT NULL,
            drive_folder_id VARCHAR(128) NULL,
            creada_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_doc_extra_carpeta_ruta (ruta(191)),
            KEY idx_sgc_doc_extra_carpeta_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function asegurarTablaSgcDocumentacionExtra(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_documentacion_extra (
            id INT AUTO_INCREMENT PRIMARY KEY,
            titulo VARCHAR(255) NOT NULL,
            descripcion TEXT NULL,
            categoria VARCHAR(64) NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            nombre_archivo_drive VARCHAR(512) NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            carpeta_drive_id VARCHAR(128) NOT NULL DEFAULT '${CARPETA_DRIVE_REPOSITORIO_ID}',
            carpeta_relativa VARCHAR(512) NULL,
            web_view_link VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            subido_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_doc_extra_drive (drive_file_id),
            KEY idx_sgc_doc_extra_created (created_at),
            KEY idx_sgc_doc_extra_categoria (categoria),
            KEY idx_sgc_doc_extra_carpeta (carpeta_relativa(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnasSgcDocumentacionExtra(pool);
    await asegurarTablaCarpetas(pool);
}

async function listarCarpetasRegistradas(pool) {
    await asegurarTablaCarpetas(pool);
    const [rows] = await pool.query(
        `SELECT id, ruta, nombre, drive_folder_id, creada_por, created_at
         FROM sgc_documentacion_extra_carpetas
         ORDER BY ruta ASC`
    );
    return rows.map(formatearCarpeta);
}

/**
 * Lista documentos y carpetas registradas (las vacías también).
 */
async function listarDocumentos(pool) {
    await asegurarTablaSgcDocumentacionExtra(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_documentacion_extra
         ORDER BY
           CASE WHEN carpeta_relativa IS NULL OR carpeta_relativa = '' THEN 1 ELSE 0 END,
           carpeta_relativa ASC,
           created_at DESC`
    );
    const documentos = rows.map(formatearRegistro);
    const carpetas = await listarCarpetasRegistradas(pool);
    return { documentos, carpetas };
}

async function obtenerDocumento(pool, id) {
    await asegurarTablaSgcDocumentacionExtra(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_documentacion_extra
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0] || null);
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function esErrorReintentable(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const code = err?.code || err?.response?.status;
    return (
        code === 429 ||
        code === 503 ||
        code === 500 ||
        msg.includes('rate limit') ||
        msg.includes('quota') ||
        msg.includes('user rate limit') ||
        msg.includes('backend error') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('socket hang up')
    );
}

async function subirABaseDeDatos(pool, {
    nombreArchivo,
    titulo,
    mimeType,
    buffer,
    driveResult,
    carpetaDriveId,
    carpetaRelativa,
    usuario
}) {
    await asegurarTablaSgcDocumentacionExtra(pool);
    const ruta = sanitizarCarpetaRelativa(carpetaRelativa) || null;
    const [insert] = await pool.query(
        `INSERT INTO sgc_documentacion_extra
            (titulo, descripcion, categoria, nombre_archivo, nombre_archivo_drive,
             drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type, tamano_bytes, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            titulo,
            null,
            null,
            nombreArchivo,
            driveResult.name || nombreArchivo,
            driveResult.id,
            carpetaDriveId || CARPETA_DRIVE_REPOSITORIO_ID,
            ruta,
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

async function subirUnDocumentoInterno(pool, body, usuario, opciones = {}) {
    const usarSubidaRapida = opciones.rapido !== false;
    const archivoBase64 = String(body?.archivo_base64 || body?.archivoBase64 || '').trim();
    const nombreArchivo = nombreSeguroArchivo(body?.nombre_archivo || body?.nombreArchivo);
    const titulo = nombreArchivo;
    const carpetaRelativa = sanitizarCarpetaRelativa(
        body?.carpeta_relativa || body?.carpetaRelativa || ''
    );

    if (!archivoBase64) {
        throw new Error('No se recibió el archivo (archivo_base64 requerido).');
    }
    if (!nombreArchivo) {
        throw new Error('Nombre de archivo inválido.');
    }

    const mimeType = resolverMimeType(nombreArchivo, body?.mime_type || body?.mimeType);
    const buffer = Buffer.from(archivoBase64, 'base64');
    if (!buffer.length) {
        throw new Error('El archivo está vacío.');
    }

    const carpetaDriveId = await resolverCarpetaDrivePorRuta(carpetaRelativa);
    let driveResult = null;
    let ultimoError = null;

    for (let intento = 1; intento <= SUBIDA_REINTENTOS_MAX; intento++) {
        try {
            driveResult = usarSubidaRapida
                ? await driveService.uploadFileFast(buffer, nombreArchivo, mimeType, carpetaDriveId)
                : await driveService.subirArchivo(buffer, nombreArchivo, mimeType, carpetaDriveId);

            return await subirABaseDeDatos(pool, {
                nombreArchivo,
                titulo,
                mimeType,
                buffer,
                driveResult,
                carpetaDriveId,
                carpetaRelativa,
                usuario
            });
        } catch (err) {
            ultimoError = err;
            if (driveResult?.id) {
                try {
                    await driveService.eliminarArchivo(driveResult.id);
                } catch (cleanupErr) {
                    console.warn('[SGC-EXTRA] No se pudo revertir archivo en Drive:', cleanupErr.message);
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
    throw ultimoError || new Error('No se pudo subir el documento.');
}

async function subirDocumento(pool, body, usuario) {
    return subirUnDocumentoInterno(pool, body, usuario, { rapido: false });
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

    const workers = Array.from(
        { length: Math.min(concurrencia, items.length) },
        () => worker()
    );
    await Promise.all(workers);
    return resultados;
}

/**
 * Sube varios archivos en un solo request (menos viajes HTTP, subida rápida a Drive).
 */
async function subirDocumentosLote(pool, archivos, usuario) {
    const lista = Array.isArray(archivos) ? archivos : [];
    if (!lista.length) {
        throw new Error('No se recibieron archivos para subir.');
    }
    if (lista.length > 30) {
        throw new Error('Máximo 30 archivos por lote. Divide la selección en varios envíos.');
    }

    const resultados = await ejecutarConConcurrencia(lista, SUBIDA_LOTE_CONCURRENCIA, async (item) => {
        const nombre = nombreSeguroArchivo(item?.nombre_archivo || item?.nombreArchivo);
        try {
            const documento = await subirUnDocumentoInterno(pool, item, usuario, { rapido: true });
            return { ok: true, nombre, documento };
        } catch (err) {
            return {
                ok: false,
                nombre: nombre || 'archivo',
                error: err?.message || String(err)
            };
        }
    });

    const exitosos = [];
    const fallidos = [];
    for (const r of resultados) {
        if (r?.ok && r.valor?.ok) {
            exitosos.push(r.valor.documento);
        } else if (r?.ok && r.valor && !r.valor.ok) {
            fallidos.push({ nombre: r.valor.nombre, error: r.valor.error });
        } else {
            fallidos.push({
                nombre: 'archivo',
                error: r?.error?.message || 'Error desconocido'
            });
        }
    }

    return {
        total: lista.length,
        exitosos: exitosos.length,
        fallidos: fallidos.length,
        documentos: exitosos,
        errores: fallidos
    };
}

/**
 * Crea una carpeta vacía en el repositorio (UI + Drive).
 * @param {object} pool
 * @param {{ nombre: string, carpeta_padre?: string }} body
 * @param {string} [usuario]
 */
async function crearCarpeta(pool, body, usuario) {
    await asegurarTablaSgcDocumentacionExtra(pool);
    const nombre = sanitizarTexto(body?.nombre || body?.name, 120).replace(/[/\\?%*:|"<>]/g, '_');
    if (!nombre) {
        throw new Error('Indica un nombre para la carpeta.');
    }
    const padre = sanitizarCarpetaRelativa(body?.carpeta_padre || body?.carpetaPadre || body?.padre || '');
    const ruta = unirRutaCarpeta(padre, nombre);
    if (!ruta) {
        throw new Error('Ruta de carpeta inválida.');
    }

    const [existentes] = await pool.query(
        `SELECT id FROM sgc_documentacion_extra_carpetas WHERE ruta = ? LIMIT 1`,
        [ruta]
    );
    if (existentes.length) {
        throw new Error(`Ya existe la carpeta «${nombre}».`);
    }

    const driveFolderId = await resolverCarpetaDrivePorRuta(ruta);
    const [insert] = await pool.query(
        `INSERT INTO sgc_documentacion_extra_carpetas
            (ruta, nombre, drive_folder_id, creada_por)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            nombre = VALUES(nombre),
            drive_folder_id = COALESCE(VALUES(drive_folder_id), drive_folder_id)`,
        [ruta, nombre, driveFolderId, sanitizarTexto(usuario, 128) || null]
    );

    // Si era duplicado silencioso por race, recuperar registro
    let id = insert.insertId;
    if (!id) {
        const [rows] = await pool.query(
            `SELECT id, ruta, nombre, drive_folder_id, creada_por, created_at
             FROM sgc_documentacion_extra_carpetas WHERE ruta = ? LIMIT 1`,
            [ruta]
        );
        return formatearCarpeta(rows[0]);
    }

    const [rows] = await pool.query(
        `SELECT id, ruta, nombre, drive_folder_id, creada_por, created_at
         FROM sgc_documentacion_extra_carpetas WHERE id = ? LIMIT 1`,
        [id]
    );
    return formatearCarpeta(rows[0]);
}

/**
 * Mueve un documento a otra carpeta relativa (raíz = '').
 */
async function moverDocumento(pool, id, carpetaRelativaDestino) {
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    const destino = sanitizarCarpetaRelativa(carpetaRelativaDestino);
    const origen = sanitizarCarpetaRelativa(doc.carpetaRelativa);
    if (destino === origen) {
        return doc;
    }

    const carpetaDriveId = await resolverCarpetaDrivePorRuta(destino);
    if (doc.driveFileId) {
        await driveService.moverArchivoDrive(doc.driveFileId, carpetaDriveId);
    }

    await pool.query(
        `UPDATE sgc_documentacion_extra
         SET carpeta_relativa = ?, carpeta_drive_id = ?
         WHERE id = ?`,
        [destino || null, carpetaDriveId, id]
    );

    // Asegura que la carpeta destino quede registrada si no lo estaba
    if (destino) {
        const nombre = destino.split('/').pop();
        await pool.query(
            `INSERT IGNORE INTO sgc_documentacion_extra_carpetas
                (ruta, nombre, drive_folder_id)
             VALUES (?, ?, ?)`,
            [destino, nombre, carpetaDriveId]
        );
    }

    return obtenerDocumento(pool, id);
}

/**
 * Elimina una carpeta registrada. Solo si no tiene archivos ni subcarpetas.
 */
async function eliminarCarpeta(pool, rutaRelativa) {
    await asegurarTablaSgcDocumentacionExtra(pool);
    const ruta = sanitizarCarpetaRelativa(rutaRelativa);
    if (!ruta) {
        throw new Error('Indica la carpeta a eliminar.');
    }

    const prefijoLike = `${ruta}/%`;
    const [docs] = await pool.query(
        `SELECT id FROM sgc_documentacion_extra
         WHERE carpeta_relativa = ? OR carpeta_relativa LIKE ?
         LIMIT 1`,
        [ruta, prefijoLike]
    );
    if (docs.length) {
        throw new Error('La carpeta no está vacía. Mueve o elimina sus documentos primero.');
    }

    const [subcarpetas] = await pool.query(
        `SELECT id FROM sgc_documentacion_extra_carpetas
         WHERE ruta LIKE ? LIMIT 1`,
        [prefijoLike]
    );
    if (subcarpetas.length) {
        throw new Error('La carpeta tiene subcarpetas. Elimínalas primero.');
    }

    await pool.query(
        `DELETE FROM sgc_documentacion_extra_carpetas WHERE ruta = ?`,
        [ruta]
    );
    return { eliminado: true, ruta };
}

async function asegurarCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (!fs.existsSync(THUMB_DIR)) {
        fs.mkdirSync(THUMB_DIR, { recursive: true });
    }
}

function rutaCacheDocumento(docId, nombreArchivo) {
    const id = Number(docId) || 0;
    const ext = path.extname(String(nombreArchivo || '')).replace(/[^\w.]/g, '') || '.bin';
    return path.join(CACHE_DIR, `${id}${ext}`);
}

function rutaThumbDocumento(docId) {
    return path.join(THUMB_DIR, `${Number(docId) || 0}.jpg`);
}

/**
 * Genera data URL JPEG pequeña para miniaturas (estable en el frontend, sin blob:).
 */
async function bufferADataUrlMiniatura(buffer, { max = 240 } = {}) {
    if (!buffer || !buffer.length) {
        throw new Error('Archivo vacío.');
    }
    try {
        const jpeg = await sharp(buffer)
            .rotate()
            .resize(max, max, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer();
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err) {
        // SVG u otros formatos: devolver original si parece imagen pequeña.
        if (buffer.length <= 1.5 * 1024 * 1024) {
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        throw err;
    }
}

async function obtenerMiniaturaDocumento(pool, id, opciones = {}) {
    const docId = Number(id);
    if (!Number.isFinite(docId) || docId <= 0) {
        throw new Error('Documento no encontrado.');
    }
    asegurarCacheDir();
    const thumbPath = rutaThumbDocumento(docId);
    if (fs.existsSync(thumbPath)) {
        const jpeg = fs.readFileSync(thumbPath);
        return {
            dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
            cached: true,
            docId
        };
    }

    const { doc, buffer } = await descargarBufferDocumento(pool, docId);
    const dataUrl = await bufferADataUrlMiniatura(buffer, { max: opciones.max || 240 });
    try {
        const b64 = dataUrl.split(',')[1] || '';
        fs.writeFileSync(thumbPath, Buffer.from(b64, 'base64'));
    } catch (err) {
        console.warn('[SGC-EXTRA] No se pudo guardar miniatura:', err.message);
    }
    return { dataUrl, cached: false, docId: doc.id, nombreArchivo: doc.nombreArchivo };
}

function escribirCacheDocumento(docId, nombreArchivo, buffer) {
    try {
        asegurarCacheDir();
        const destino = rutaCacheDocumento(docId, nombreArchivo);
        fs.writeFileSync(destino, buffer);
        return destino;
    } catch (err) {
        console.warn('[SGC-EXTRA] No se pudo escribir caché local:', err.message);
        return null;
    }
}

function leerCacheDocumento(docId, nombreArchivo) {
    try {
        const destino = rutaCacheDocumento(docId, nombreArchivo);
        if (fs.existsSync(destino)) {
            return fs.readFileSync(destino);
        }
        asegurarCacheDir();
        const idStr = String(Number(docId));
        const match = fs.readdirSync(CACHE_DIR).find(
            (f) => path.basename(f, path.extname(f)) === idStr
        );
        if (match) {
            return fs.readFileSync(path.join(CACHE_DIR, match));
        }
    } catch (err) {
        console.warn('[SGC-EXTRA] No se pudo leer caché local:', err.message);
    }
    return null;
}

async function descargarBufferDocumento(pool, id) {
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }

    const cached = leerCacheDocumento(doc.id, doc.nombreArchivo);
    if (cached && cached.length) {
        return { doc, buffer: cached };
    }

    if (!doc.driveFileId) {
        throw new Error('El documento no tiene archivo asociado en Drive.');
    }
    const buffer = await driveService.descargarArchivo(doc.driveFileId);
    if (buffer && buffer.length) {
        escribirCacheDocumento(doc.id, doc.nombreArchivo, buffer);
    }
    return { doc, buffer };
}

async function eliminarDocumento(pool, id) {
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (doc.driveFileId) {
        try {
            await driveService.eliminarArchivo(doc.driveFileId);
        } catch (err) {
            console.warn('[SGC-EXTRA] No se pudo eliminar en Drive:', err.message);
        }
    }
    try {
        const cached = rutaCacheDocumento(doc.id, doc.nombreArchivo);
        if (fs.existsSync(cached)) {
            fs.unlinkSync(cached);
        }
        const thumb = rutaThumbDocumento(doc.id);
        if (fs.existsSync(thumb)) {
            fs.unlinkSync(thumb);
        }
    } catch {
        /* ignore */
    }
    await pool.query('DELETE FROM sgc_documentacion_extra WHERE id = ?', [id]);
    return { eliminado: true, id: doc.id };
}

/**
 * Asegura permiso de lectura pública para miniaturas/visor embebido de Drive.
 */
async function prepararVistaDocumento(pool, id) {
    const doc = await obtenerDocumento(pool, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (doc.driveFileId) {
        await driveService.asignarPermisoLecturaPublica(doc.driveFileId);
    }
    return doc;
}

module.exports = {
    CARPETA_DRIVE_REPOSITORIO_ID,
    asegurarTablaSgcDocumentacionExtra,
    listarDocumentos,
    obtenerDocumento,
    subirDocumento,
    subirDocumentosLote,
    crearCarpeta,
    moverDocumento,
    eliminarCarpeta,
    descargarBufferDocumento,
    obtenerMiniaturaDocumento,
    bufferADataUrlMiniatura,
    eliminarDocumento,
    prepararVistaDocumento,
    sanitizarCarpetaRelativa,
    MIME_PERMITIDOS
};
