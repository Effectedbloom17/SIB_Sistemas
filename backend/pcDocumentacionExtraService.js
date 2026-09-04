/**
 * Documentación Extra de Protección Civil (fuera del checklist PIPC).
 * Persistencia en BD proteccion_civil y en Drive:
 * Protección_Civil / Historial de Documentos / {empresa} / Documentación Extra / [subcarpetas...]
 */
const driveService = require('./driveService');

const NOMBRE_CARPETA_EXTRA = 'Documentación Extra';
const MIME_GENERICO = 'application/octet-stream';

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
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed'
};

const SUBIDA_REINTENTOS_MAX = 3;
const SUBIDA_REINTENTO_MS = 1200;

function extensionDesdeNombre(nombre) {
    const partes = String(nombre || '').toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
}

function resolverMimeType(nombreArchivo, mimeEntrada) {
    const mime = String(mimeEntrada || '').trim().toLowerCase();
    if (mime && mime !== 'application/octet-stream') {
        return mime;
    }
    const ext = extensionDesdeNombre(nombreArchivo);
    if (EXTENSION_A_MIME[ext]) {
        return EXTENSION_A_MIME[ext];
    }
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
 * Normaliza ruta relativa bajo Documentación Extra.
 * Ej: "Planos\\2024/../x" → "Planos/2024/x" (sin .. ni segmentos vacíos).
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

function formatearRegistro(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        empresaId: Number(row.empresa_id),
        titulo: row.titulo,
        nombreArchivo: row.nombre_archivo,
        nombreArchivoDrive: row.nombre_archivo_drive || row.nombre_archivo,
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        driveFileId: row.drive_file_id,
        carpetaDriveId: row.carpeta_drive_id || null,
        carpetaRelativa: row.carpeta_relativa || '',
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

const COLUMNAS_SELECT = `
    id, empresa_id, titulo, nombre_archivo, nombre_archivo_drive,
    drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type,
    tamano_bytes, subido_por, created_at, updated_at
`;

async function asegurarColumnasPcDocumentacionExtra(pool) {
    const alteres = [
        `ADD COLUMN carpeta_relativa VARCHAR(512) NULL DEFAULT NULL AFTER carpeta_drive_id`
    ];
    for (const sql of alteres) {
        try {
            await pool.query(`ALTER TABLE pc_documentacion_extra ${sql}`);
        } catch (err) {
            // Columna ya existe u otro error no crítico de duplicado
            if (err?.code !== 'ER_DUP_FIELDNAME' && !String(err?.message || '').includes('Duplicate column')) {
                // Ignorar solo duplicados; el resto se re-lanza si es grave en create
            }
        }
    }
    try {
        await pool.query(`
            ALTER TABLE pc_documentacion_extra
            ADD KEY idx_pc_doc_extra_carpeta (empresa_id, carpeta_relativa(191))
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarTablaPcDocumentacionExtra(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_documentacion_extra (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            nombre_archivo_drive VARCHAR(512) NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            carpeta_drive_id VARCHAR(128) NULL,
            carpeta_relativa VARCHAR(512) NULL,
            web_view_link VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            subido_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_pc_doc_extra_drive (drive_file_id),
            KEY idx_pc_doc_extra_empresa (empresa_id),
            KEY idx_pc_doc_extra_created (created_at),
            KEY idx_pc_doc_extra_carpeta (empresa_id, carpeta_relativa(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnasPcDocumentacionExtra(pool);
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

async function listarDocumentos(pool, empresaId) {
    await asegurarTablaPcDocumentacionExtra(pool);
    const id = Number(empresaId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('empresa_id inválido.');
    }
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM pc_documentacion_extra
         WHERE empresa_id = ?
         ORDER BY
           CASE WHEN carpeta_relativa IS NULL OR carpeta_relativa = '' THEN 1 ELSE 0 END,
           carpeta_relativa ASC,
           nombre_archivo ASC,
           created_at DESC`,
        [id]
    );
    return rows.map(formatearRegistro);
}

async function obtenerDocumento(pool, id, empresaId = null) {
    await asegurarTablaPcDocumentacionExtra(pool);
    const params = [Number(id)];
    let sql = `SELECT ${COLUMNAS_SELECT} FROM pc_documentacion_extra WHERE id = ?`;
    if (empresaId != null) {
        sql += ' AND empresa_id = ?';
        params.push(Number(empresaId));
    }
    sql += ' LIMIT 1';
    const [rows] = await pool.query(sql, params);
    return formatearRegistro(rows[0] || null);
}

async function subirABaseDeDatos(pool, {
    empresaId,
    nombreArchivo,
    mimeType,
    buffer,
    driveResult,
    carpetaDriveId,
    carpetaRelativa,
    usuario
}) {
    await asegurarTablaPcDocumentacionExtra(pool);
    const [insert] = await pool.query(
        `INSERT INTO pc_documentacion_extra
            (empresa_id, titulo, nombre_archivo, nombre_archivo_drive,
             drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type, tamano_bytes, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            Number(empresaId),
            nombreArchivo,
            nombreArchivo,
            driveResult.name || nombreArchivo,
            driveResult.id,
            carpetaDriveId || null,
            carpetaRelativa || null,
            driveResult.webViewLink || null,
            mimeType,
            buffer.length,
            sanitizarTexto(usuario, 128) || null
        ]
    );
    return obtenerDocumento(pool, insert.insertId);
}

/**
 * @param {object} pool
 * @param {number} empresaId
 * @param {string} nombreEmpresa
 * @param {{ buffer: Buffer, nombreArchivo: string, mimeType?: string, carpetaRelativa?: string }} archivo
 * @param {string} [usuario]
 */
async function subirDocumento(pool, empresaId, nombreEmpresa, archivo, usuario) {
    const id = Number(empresaId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('empresa_id inválido.');
    }
    const nombreArchivo = nombreSeguroArchivo(archivo?.nombreArchivo || archivo?.nombre_archivo);
    const buffer = archivo?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new Error('El archivo está vacío o no se recibió correctamente.');
    }
    if (!nombreEmpresa) {
        throw new Error('No se pudo resolver el nombre de la empresa para Drive.');
    }

    const carpetaRelativa = sanitizarCarpetaRelativa(
        archivo?.carpetaRelativa || archivo?.carpeta_relativa || ''
    );
    const mimeType = resolverMimeType(nombreArchivo, archivo?.mimeType || archivo?.mime_type);
    let driveResult = null;
    let carpetaDriveId = null;
    let ultimoError = null;

    for (let intento = 1; intento <= SUBIDA_REINTENTOS_MAX; intento++) {
        try {
            const subida = await driveService.subirArchivoDocumentacionExtraPC(
                buffer,
                nombreEmpresa,
                nombreArchivo,
                mimeType,
                carpetaRelativa
            );
            driveResult = subida;
            carpetaDriveId = subida.carpetaId || null;

            return await subirABaseDeDatos(pool, {
                empresaId: id,
                nombreArchivo,
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
                    console.warn('[PC-EXTRA] No se pudo revertir archivo en Drive:', cleanupErr.message);
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

async function descargarBufferDocumento(pool, id, empresaId = null) {
    const doc = await obtenerDocumento(pool, id, empresaId);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (!doc.driveFileId) {
        throw new Error('El documento no tiene archivo asociado en Drive.');
    }
    const buffer = await driveService.descargarArchivo(doc.driveFileId);
    return { doc, buffer };
}

async function eliminarDocumento(pool, id, empresaId = null) {
    const doc = await obtenerDocumento(pool, id, empresaId);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (doc.driveFileId) {
        try {
            await driveService.eliminarArchivo(doc.driveFileId);
        } catch (err) {
            console.warn('[PC-EXTRA] No se pudo eliminar en Drive:', err.message);
        }
    }
    await pool.query('DELETE FROM pc_documentacion_extra WHERE id = ?', [doc.id]);
    return { eliminado: true, id: doc.id };
}

/**
 * Elimina una carpeta (y subcarpetas) de Documentación Extra: Drive + BD.
 * @param {object} pool
 * @param {number} empresaId
 * @param {string} nombreEmpresa
 * @param {string} rutaRelativa
 */
async function eliminarCarpeta(pool, empresaId, nombreEmpresa, rutaRelativa) {
    await asegurarTablaPcDocumentacionExtra(pool);
    const id = Number(empresaId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('empresa_id inválido.');
    }
    const ruta = sanitizarCarpetaRelativa(rutaRelativa);
    if (!ruta) {
        throw new Error('Indica la carpeta a eliminar.');
    }
    if (!nombreEmpresa) {
        throw new Error('No se pudo resolver el nombre de la empresa para Drive.');
    }

    const prefijoLike = `${ruta}/%`;
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM pc_documentacion_extra
         WHERE empresa_id = ?
           AND (carpeta_relativa = ? OR carpeta_relativa LIKE ?)`,
        [id, ruta, prefijoLike]
    );
    const docs = rows.map(formatearRegistro);

    let driveEliminado = false;
    try {
        const driveResult = await driveService.eliminarCarpetaDocumentacionExtraPC(nombreEmpresa, ruta);
        driveEliminado = !!driveResult?.eliminado;
    } catch (err) {
        console.warn('[PC-EXTRA] No se pudo eliminar carpeta en Drive:', err.message);
    }

    // Si la carpeta de Drive no existía o falló, limpia archivos sueltos por ID
    if (!driveEliminado) {
        for (const doc of docs) {
            if (!doc.driveFileId) {
                continue;
            }
            try {
                await driveService.eliminarArchivo(doc.driveFileId);
            } catch (err) {
                console.warn('[PC-EXTRA] No se pudo eliminar archivo en Drive:', err.message);
            }
        }
    }

    const [del] = await pool.query(
        `DELETE FROM pc_documentacion_extra
         WHERE empresa_id = ?
           AND (carpeta_relativa = ? OR carpeta_relativa LIKE ?)`,
        [id, ruta, prefijoLike]
    );

    return {
        eliminado: true,
        ruta,
        documentosEliminados: Number(del?.affectedRows) || docs.length,
        driveEliminado
    };
}

/**
 * Asegura permiso de lectura pública para el visor embebido de Drive.
 */
async function prepararVistaDocumento(pool, id, empresaId = null) {
    const doc = await obtenerDocumento(pool, id, empresaId);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (doc.driveFileId) {
        await driveService.asignarPermisoLecturaPublica(doc.driveFileId);
    }
    return doc;
}

module.exports = {
    NOMBRE_CARPETA_EXTRA,
    sanitizarCarpetaRelativa,
    asegurarTablaPcDocumentacionExtra,
    listarDocumentos,
    obtenerDocumento,
    subirDocumento,
    descargarBufferDocumento,
    eliminarDocumento,
    eliminarCarpeta,
    prepararVistaDocumento
};
