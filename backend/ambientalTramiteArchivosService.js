/**
 * Archivos múltiples de trámites ambientales (Documento / Contestación).
 * Drive: Ambiental / {Empresa} / {Oficio} / Documento|Contestacion / [subcarpetas...] /
 * BD: ambiental_tramite_archivos (biznaga_sgc)
 */
const driveService = require('./driveService');
const ambientalAnexoService = require('./ambientalAnexoService');

const AMBITOS = new Set(['documento', 'contestacion']);

function repararNombreUtf8(valor) {
    const original = String(valor || '').trim();
    if (!original) return '';

    // Solo intenta latin1→utf8 cuando hay señales claras de mojibake (Ã³, Â, etc.).
    const pareceMojibake = /Ã[\u0080-\u00BF]|Â.|Ä.|Å.|Æ.|Ç.|È.|É.|Ê.|Ë.|Ì.|Í.|Î.|Ï.|Ð.|Ñ.|Ò.|Ó.|Ô.|Õ.|Ö.|Ø.|Ù.|Ú.|Û.|Ü.|Ý.|Þ.|ß./.test(original);
    if (pareceMojibake) {
        try {
            const reparado = Buffer.from(original, 'latin1').toString('utf8');
            if (reparado && !/\uFFFD/.test(reparado) && reparado !== original) {
                return reparado.normalize('NFC');
            }
        } catch (_) { /* ignore */ }
        // Mojibake no reversible: quitar diacríticos para un nombre usable.
        return original.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // UTF-8 correcto: conservar acentos.
    return original.normalize('NFC');
}

function sanitizarTexto(valor, max = 255) {
    return repararNombreUtf8(valor)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function nombreSeguroArchivo(nombre) {
    const base = repararNombreUtf8(nombre || 'documento')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base || 'documento';
}

function sanitizarCarpetaRelativa(ruta) {
    return String(ruta || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(seg => sanitizarTexto(seg, 120).replace(/[/\\?%*:|"<>]/g, '_'))
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .slice(0, 8)
        .join('/');
}

function normalizarAmbito(ambito) {
    const a = String(ambito || '').trim().toLowerCase();
    if (!AMBITOS.has(a)) {
        throw new Error('Ámbito inválido. Use documento o contestacion.');
    }
    return a;
}

function formatearRegistro(row) {
    if (!row) return null;
    return {
        id: row.id,
        tramiteId: Number(row.tramite_id),
        ambito: row.ambito,
        carpetaRelativa: row.carpeta_relativa || '',
        nombreArchivo: repararNombreUtf8(row.nombre_archivo),
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        driveFileId: row.drive_file_id,
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at
    };
}

async function asegurarTabla(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ambiental_tramite_archivos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tramite_id INT NOT NULL,
            ambito VARCHAR(20) NOT NULL,
            carpeta_relativa VARCHAR(512) NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            web_view_link VARCHAR(512) NULL,
            subido_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_amb_tram_arch_drive (drive_file_id),
            KEY idx_amb_tram_arch_tramite (tramite_id, ambito),
            KEY idx_amb_tram_arch_carpeta (tramite_id, ambito, carpeta_relativa(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * Migra el archivo legacy (columnas del trámite) a la tabla multi-archivo una sola vez.
 */
async function migrarLegacySiAplica(pool, tramite, ambito) {
    const amb = normalizarAmbito(ambito);
    const tramiteId = Number(tramite?.tramite_id || tramite?.id);
    if (!tramiteId) return;

    const [existentes] = await pool.query(
        `SELECT id FROM ambiental_tramite_archivos WHERE tramite_id = ? AND ambito = ? LIMIT 1`,
        [tramiteId, amb]
    );
    if (existentes.length) return;

    const driveId = amb === 'documento'
        ? tramite.documento_drive_id
        : tramite.contestacion_drive_id;
    const nombre = amb === 'documento'
        ? tramite.documento_nombre
        : tramite.contestacion_nombre;
    const url = amb === 'documento'
        ? tramite.documento_url
        : tramite.contestacion_url;

    if (!driveId) return;

    await pool.query(
        `INSERT INTO ambiental_tramite_archivos
            (tramite_id, ambito, carpeta_relativa, nombre_archivo, mime_type, tamano_bytes,
             drive_file_id, web_view_link, subido_por)
         VALUES (?, ?, NULL, ?, 'application/octet-stream', NULL, ?, ?, 'migracion')`,
        [
            tramiteId,
            amb,
            nombreSeguroArchivo(nombre || 'documento'),
            driveId,
            url || null
        ]
    );
}

async function sincronizarColumnasLegacy(pool, tramiteId, ambito) {
    const amb = normalizarAmbito(ambito);
    const [rows] = await pool.query(
        `SELECT nombre_archivo, drive_file_id, web_view_link
         FROM ambiental_tramite_archivos
         WHERE tramite_id = ? AND ambito = ?
         ORDER BY
           CASE WHEN carpeta_relativa IS NULL OR carpeta_relativa = '' THEN 0 ELSE 1 END,
           created_at ASC
         LIMIT 1`,
        [tramiteId, amb]
    );
    const primero = rows[0] || null;

    if (amb === 'documento') {
        await pool.query(
            `UPDATE ambiental_control_tramites
             SET documento_nombre = ?, documento_drive_id = ?, documento_url = ?
             WHERE tramite_id = ?`,
            [
                primero?.nombre_archivo || null,
                primero?.drive_file_id || null,
                primero?.web_view_link || null,
                tramiteId
            ]
        );
    } else {
        await pool.query(
            `UPDATE ambiental_control_tramites
             SET contestacion_nombre = ?, contestacion_drive_id = ?, contestacion_url = ?,
                 tiene_contestacion = ?
             WHERE tramite_id = ?`,
            [
                primero?.nombre_archivo || null,
                primero?.drive_file_id || null,
                primero?.web_view_link || null,
                primero ? 1 : 0,
                tramiteId
            ]
        );
    }
}

async function listarArchivos(pool, tramite, ambito) {
    await asegurarTabla(pool);
    const amb = normalizarAmbito(ambito);
    const tramiteId = Number(tramite?.tramite_id || tramite?.id);
    if (!tramiteId) throw new Error('tramite_id inválido.');

    await migrarLegacySiAplica(pool, tramite, amb);

    const [rows] = await pool.query(
        `SELECT id, tramite_id, ambito, carpeta_relativa, nombre_archivo, mime_type,
                tamano_bytes, drive_file_id, web_view_link, subido_por, created_at
         FROM ambiental_tramite_archivos
         WHERE tramite_id = ? AND ambito = ?
         ORDER BY
           CASE WHEN carpeta_relativa IS NULL OR carpeta_relativa = '' THEN 1 ELSE 0 END,
           carpeta_relativa ASC,
           nombre_archivo ASC,
           created_at DESC`,
        [tramiteId, amb]
    );
    return rows.map(formatearRegistro);
}

async function obtenerArchivo(pool, id, tramiteId = null) {
    await asegurarTabla(pool);
    const params = [Number(id)];
    let sql = `SELECT id, tramite_id, ambito, carpeta_relativa, nombre_archivo, mime_type,
                      tamano_bytes, drive_file_id, web_view_link, subido_por, created_at
               FROM ambiental_tramite_archivos WHERE id = ?`;
    if (tramiteId != null) {
        sql += ' AND tramite_id = ?';
        params.push(Number(tramiteId));
    }
    sql += ' LIMIT 1';
    const [rows] = await pool.query(sql, params);
    return formatearRegistro(rows[0] || null);
}

async function subirArchivo(pool, tramite, {
    ambito,
    buffer,
    nombreArchivo,
    mimeType,
    carpetaRelativa,
    usuario
}) {
    await asegurarTabla(pool);
    const amb = normalizarAmbito(ambito);
    const tramiteId = Number(tramite?.tramite_id || tramite?.id);
    if (!tramiteId) throw new Error('tramite_id inválido.');
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new Error('El archivo está vacío.');
    }

    const nombre = nombreSeguroArchivo(nombreArchivo);
    const carpeta = sanitizarCarpetaRelativa(carpetaRelativa);
    const mime = String(mimeType || 'application/octet-stream');

    const empresa = tramite.empresa_nombre || tramite.empresa || 'SinEmpresa';
    const oficio = tramite.oficio || '';
    const item = tramite.item;
    const clasificacion = tramite.clasificacion || null;

    const carpetaOficio = await ambientalAnexoService.obtenerCarpetaOficioTramite(
        empresa,
        oficio,
        item,
        clasificacion
    );
    const nombreAmbito = amb === 'contestacion' ? 'Contestacion' : 'Documento';
    let carpetaDestino = await driveService.obtenerOCrearCarpeta(nombreAmbito, carpetaOficio);
    if (carpeta) {
        for (const segmento of carpeta.split('/')) {
            carpetaDestino = await driveService.obtenerOCrearCarpeta(segmento, carpetaDestino);
        }
    }

    const driveResult = await driveService.subirArchivoNuevo(
        buffer,
        nombre,
        mime,
        carpetaDestino
    );

    const [insert] = await pool.query(
        `INSERT INTO ambiental_tramite_archivos
            (tramite_id, ambito, carpeta_relativa, nombre_archivo, mime_type, tamano_bytes,
             drive_file_id, web_view_link, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tramiteId,
            amb,
            carpeta || null,
            nombre,
            mime,
            buffer.length,
            driveResult.id,
            driveResult.webViewLink || null,
            sanitizarTexto(usuario, 128) || null
        ]
    );

    await sincronizarColumnasLegacy(pool, tramiteId, amb);
    return obtenerArchivo(pool, insert.insertId, tramiteId);
}

async function eliminarArchivo(pool, id, tramiteId) {
    const doc = await obtenerArchivo(pool, id, tramiteId);
    if (!doc) throw new Error('Archivo no encontrado.');

    if (doc.driveFileId) {
        try {
            await driveService.eliminarArchivo(doc.driveFileId);
        } catch (err) {
            console.warn('[AMB-ARCH] No se pudo eliminar en Drive:', err.message);
        }
    }
    await pool.query('DELETE FROM ambiental_tramite_archivos WHERE id = ?', [doc.id]);
    await sincronizarColumnasLegacy(pool, doc.tramiteId, doc.ambito);
    return { eliminado: true, id: doc.id };
}

async function descargarBuffer(pool, id, tramiteId) {
    const doc = await obtenerArchivo(pool, id, tramiteId);
    if (!doc) throw new Error('Archivo no encontrado.');
    if (!doc.driveFileId) throw new Error('Sin archivo en Drive.');
    const buffer = await driveService.descargarArchivo(doc.driveFileId);
    return { doc, buffer };
}

async function prepararVista(pool, id, tramiteId) {
    const doc = await obtenerArchivo(pool, id, tramiteId);
    if (!doc) throw new Error('Archivo no encontrado.');
    if (doc.driveFileId) {
        await driveService.asignarPermisoLecturaPublica(doc.driveFileId);
    }
    return doc;
}

module.exports = {
    repararNombreUtf8,
    sanitizarCarpetaRelativa,
    normalizarAmbito,
    asegurarTabla,
    listarArchivos,
    obtenerArchivo,
    subirArchivo,
    eliminarArchivo,
    descargarBuffer,
    prepararVista
};
