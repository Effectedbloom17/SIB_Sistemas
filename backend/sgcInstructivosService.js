/**
 * Instructivos corporativos SGC — persistencia en biznaga_sgc (sgc_instructivos)
 * y archivos PDF en Google Drive (Calidad / 5 Instructivos).
 */
const driveService = require('./driveService');

const CARPETA_INSTRUCTIVOS = '5 Instructivos';

/** Catálogo inicial (mismo contenido que el frontend) para seed en BD. */
const CATALOGO_INICIAL = [
    {
        codigo: 'SGC-I-01',
        titulo: 'Número de cotización y número de proyecto',
        driveFileId: '1UH8Guu25vBNL_zPAKgLFRiwHjva7EVZm',
        categoriaId: 'sgc'
    },
    {
        codigo: 'SGC-I-02',
        titulo: 'Folio para no conformidades',
        driveFileId: '1EUEr-KiAMwjCjdl3iHzoaZ2a2pcyDHzw',
        categoriaId: 'sgc'
    },
    {
        codigo: 'SGC-I-03',
        titulo: 'Folio para proyectos de mejora',
        driveFileId: '1huk2aEh5LkzMykE61zEzeJZcaZJGIgbV',
        categoriaId: 'sgc'
    }
];

const CATEGORIAS_VALIDAS = new Set(['ath', 'ein', 'sgc', 'sp']);

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function normalizarCodigo(codigo) {
    return sanitizarTexto(codigo, 32).toUpperCase().replace(/\s+/g, '-');
}

function nombreSeguroArchivo(nombre) {
    const base = String(nombre || 'instructivo.pdf')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base || 'instructivo.pdf';
}

function bufferDesdeBase64(archivoBase64) {
    const raw = String(archivoBase64 || '').trim();
    if (!raw) {
        throw new Error('No se recibió el archivo (archivo_base64 requerido).');
    }
    const sinPrefijo = raw.includes(',') ? raw.split(',').pop() : raw;
    const buffer = Buffer.from(sinPrefijo, 'base64');
    if (!buffer.length) {
        throw new Error('El archivo está vacío.');
    }
    return buffer;
}

function formatearRegistro(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        codigo: row.codigo,
        titulo: row.titulo,
        categoriaId: row.categoria_id,
        driveFileId: row.drive_file_id,
        nombreArchivo: row.nombre_archivo || null,
        mimeType: row.mime_type || 'application/pdf',
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        carpetaDriveId: row.carpeta_drive_id || null,
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        actualizadoPor: row.actualizado_por || null,
        activo: row.activo == null ? true : !!row.activo,
        fechaCreacion: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

const COLUMNAS_SELECT = `
    id, codigo, titulo, categoria_id, drive_file_id, nombre_archivo,
    mime_type, tamano_bytes, carpeta_drive_id, web_view_link,
    subido_por, actualizado_por, activo, created_at, updated_at
`;

let _cacheCarpetaInstructivosId = null;

async function obtenerCarpetaInstructivos() {
    if (_cacheCarpetaInstructivosId) {
        return _cacheCarpetaInstructivosId;
    }
    const carpetaCalidad = await driveService.obtenerCarpetaCalidad();
    _cacheCarpetaInstructivosId = await driveService.obtenerOCrearCarpeta(
        CARPETA_INSTRUCTIVOS,
        carpetaCalidad
    );
    return _cacheCarpetaInstructivosId;
}

async function asegurarTablaSgcInstructivos(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_instructivos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codigo VARCHAR(32) NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            categoria_id VARCHAR(16) NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            nombre_archivo VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
            tamano_bytes BIGINT NULL,
            carpeta_drive_id VARCHAR(128) NULL,
            web_view_link VARCHAR(512) NULL,
            subido_por VARCHAR(128) NULL,
            actualizado_por VARCHAR(128) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_inst_codigo (codigo),
            UNIQUE KEY uq_sgc_inst_drive (drive_file_id),
            KEY idx_sgc_inst_categoria (categoria_id),
            KEY idx_sgc_inst_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await sembrarCatalogoInicial(pool);
}

async function sembrarCatalogoInicial(pool) {
    for (const item of CATALOGO_INICIAL) {
        await pool.query(
            `INSERT INTO sgc_instructivos
                (codigo, titulo, categoria_id, drive_file_id, nombre_archivo, mime_type, activo)
             VALUES (?, ?, ?, ?, ?, 'application/pdf', 1)
             ON DUPLICATE KEY UPDATE
                codigo = codigo`,
            [
                item.codigo,
                item.titulo,
                item.categoriaId,
                item.driveFileId,
                `${item.codigo} ${item.titulo}.pdf`
            ]
        );
    }
}

async function listarInstructivos(pool) {
    await asegurarTablaSgcInstructivos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_instructivos
         WHERE activo = 1
         ORDER BY categoria_id ASC, codigo ASC`
    );
    return rows.map(formatearRegistro);
}

async function obtenerInstructivo(pool, id) {
    await asegurarTablaSgcInstructivos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_instructivos
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0] || null);
}

async function obtenerPorCodigo(pool, codigo) {
    await asegurarTablaSgcInstructivos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_instructivos
         WHERE codigo = ?
         LIMIT 1`,
        [normalizarCodigo(codigo)]
    );
    return formatearRegistro(rows[0] || null);
}

/**
 * Sube un PDF nuevo a Drive y crea el registro en BD.
 */
async function subirInstructivo(pool, body, usuario) {
    await asegurarTablaSgcInstructivos(pool);

    const codigo = normalizarCodigo(body?.codigo);
    const titulo = sanitizarTexto(body?.titulo, 255);
    const categoriaId = sanitizarTexto(body?.categoria_id || body?.categoriaId, 16).toLowerCase();
    const nombreArchivo = nombreSeguroArchivo(
        body?.nombre_archivo || body?.nombreArchivo || `${codigo} ${titulo}.pdf`
    );

    if (!codigo || !/^[A-Z]{2,4}-I-\d{2}$/.test(codigo)) {
        throw new Error('Código inválido. Usa el formato ÁREA-I-NN (ej. SGC-I-01).');
    }
    if (!titulo) {
        throw new Error('El título del instructivo es obligatorio.');
    }
    if (!CATEGORIAS_VALIDAS.has(categoriaId)) {
        throw new Error('Área inválida. Usa: ath, ein, sgc o sp.');
    }

    const existente = await obtenerPorCodigo(pool, codigo);
    if (existente && existente.activo) {
        throw new Error(`Ya existe el instructivo ${codigo}. Usa «Reemplazar» para actualizar el PDF.`);
    }

    const buffer = bufferDesdeBase64(body?.archivo_base64 || body?.archivoBase64);
    const mimeType = 'application/pdf';
    const carpetaId = await obtenerCarpetaInstructivos();

    let driveResult = null;
    try {
        driveResult = await driveService.subirArchivoNuevo(buffer, nombreArchivo, mimeType, carpetaId);
        try {
            await driveService.asignarPermisoLecturaPublica(driveResult.id);
        } catch (permErr) {
            console.warn('[SGC-INST] No se pudo publicar lectura del PDF:', permErr.message);
        }

        if (existente && !existente.activo) {
            await pool.query(
                `UPDATE sgc_instructivos
                 SET titulo = ?, categoria_id = ?, drive_file_id = ?, nombre_archivo = ?,
                     mime_type = ?, tamano_bytes = ?, carpeta_drive_id = ?, web_view_link = ?,
                     subido_por = ?, actualizado_por = ?, activo = 1
                 WHERE id = ?`,
                [
                    titulo,
                    categoriaId,
                    driveResult.id,
                    nombreArchivo,
                    mimeType,
                    buffer.length,
                    carpetaId,
                    driveResult.webViewLink || null,
                    sanitizarTexto(usuario, 128) || null,
                    sanitizarTexto(usuario, 128) || null,
                    existente.id
                ]
            );
            return obtenerInstructivo(pool, existente.id);
        }

        const [insert] = await pool.query(
            `INSERT INTO sgc_instructivos
                (codigo, titulo, categoria_id, drive_file_id, nombre_archivo, mime_type,
                 tamano_bytes, carpeta_drive_id, web_view_link, subido_por, actualizado_por, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                codigo,
                titulo,
                categoriaId,
                driveResult.id,
                nombreArchivo,
                mimeType,
                buffer.length,
                carpetaId,
                driveResult.webViewLink || null,
                sanitizarTexto(usuario, 128) || null,
                sanitizarTexto(usuario, 128) || null
            ]
        );
        return obtenerInstructivo(pool, insert.insertId);
    } catch (err) {
        if (driveResult?.id) {
            try {
                await driveService.eliminarArchivo(driveResult.id);
            } catch (cleanupErr) {
                console.warn('[SGC-INST] No se pudo revertir archivo en Drive:', cleanupErr.message);
            }
        }
        throw err;
    }
}

/**
 * Reemplaza el PDF de un instructivo existente (mismo código / registro).
 */
async function reemplazarInstructivo(pool, id, body, usuario) {
    await asegurarTablaSgcInstructivos(pool);
    const doc = await obtenerInstructivo(pool, id);
    if (!doc || !doc.activo) {
        throw new Error('Instructivo no encontrado.');
    }

    const buffer = bufferDesdeBase64(body?.archivo_base64 || body?.archivoBase64);
    const mimeType = 'application/pdf';
    const tituloNuevo = sanitizarTexto(body?.titulo, 255);
    const nombreArchivo = nombreSeguroArchivo(
        body?.nombre_archivo || body?.nombreArchivo || doc.nombreArchivo || `${doc.codigo}.pdf`
    );

    let driveFileId = doc.driveFileId;
    let webViewLink = doc.webViewLink;

    if (driveFileId) {
        const actualizado = await driveService.reemplazarArchivoEnDrive(
            driveFileId,
            buffer,
            mimeType,
            nombreArchivo
        );
        webViewLink = actualizado?.webViewLink || webViewLink;
        try {
            await driveService.asignarPermisoLecturaPublica(driveFileId);
        } catch (permErr) {
            console.warn('[SGC-INST] No se pudo republicar lectura del PDF:', permErr.message);
        }
    } else {
        const carpetaId = await obtenerCarpetaInstructivos();
        const driveResult = await driveService.subirArchivoNuevo(buffer, nombreArchivo, mimeType, carpetaId);
        driveFileId = driveResult.id;
        webViewLink = driveResult.webViewLink || null;
        try {
            await driveService.asignarPermisoLecturaPublica(driveFileId);
        } catch (permErr) {
            console.warn('[SGC-INST] No se pudo publicar lectura del PDF:', permErr.message);
        }
        await pool.query(
            `UPDATE sgc_instructivos SET carpeta_drive_id = ? WHERE id = ?`,
            [carpetaId, id]
        );
    }

    await pool.query(
        `UPDATE sgc_instructivos
         SET drive_file_id = ?,
             nombre_archivo = ?,
             mime_type = ?,
             tamano_bytes = ?,
             web_view_link = ?,
             titulo = COALESCE(NULLIF(?, ''), titulo),
             actualizado_por = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            driveFileId,
            nombreArchivo,
            mimeType,
            buffer.length,
            webViewLink,
            tituloNuevo,
            sanitizarTexto(usuario, 128) || null,
            id
        ]
    );

    return obtenerInstructivo(pool, id);
}

module.exports = {
    CATALOGO_INICIAL,
    asegurarTablaSgcInstructivos,
    listarInstructivos,
    obtenerInstructivo,
    subirInstructivo,
    reemplazarInstructivo
};
