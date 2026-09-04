/**
 * Formatos SGC (página descarga): reemplazo versionado en Drive + historial en BD.
 * El archivo anterior se conserva renombrado con _02, _03, …
 * Reemplazo: root y perfil calidad (sergio56 / calidad).
 * Subida de formatos nuevos: root y administrador.
 */

const crypto = require('crypto');
const path = require('path');
const driveService = require('./driveService');

const CARPETA_FORMATOS_DRIVE_ID =
    String(process.env.SGC_FORMATOS_DESCARGA_DRIVE_FOLDER_ID || '').trim()
    || '1qA9FXEv3Cqpexps1Zx_E6WrQJwDhRNpw';

const CATEGORIAS_VALIDAS = new Set([
    'capitulo-4',
    'capitulo-5',
    'capitulo-6',
    'capitulo-7',
    'capitulo-8',
    'capitulo-9',
    'capitulo-10'
]);

function ahoraMexicoSql() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function stripSufijoVersion(nombreArchivo) {
    const base = String(nombreArchivo || '').trim();
    if (!base) return 'formato';
    return base.replace(/_(\d{2})(\.[^.]+)$/i, '$2');
}

function agregarSufijoVersion(nombreArchivo, versionNum) {
    const limpio = stripSufijoVersion(nombreArchivo);
    const suf = `_${String(versionNum).padStart(2, '0')}`;
    const ext = path.extname(limpio);
    const stem = ext ? limpio.slice(0, -ext.length) : limpio;
    return `${stem}${suf}${ext}`;
}

function inferirTipoArchivo(nombreArchivo) {
    const ext = path.extname(String(nombreArchivo || '')).toLowerCase();
    if (ext === '.xls' || ext === '.xlsx') return 'excel';
    if (ext === '.ppt' || ext === '.pptx') return 'pptx';
    if (ext === '.pdf') return 'pdf';
    return 'word';
}

function nombreArchivoFormato(codigo, titulo, originalName) {
    const ext = path.extname(String(originalName || '')).toLowerCase() || '.docx';
    const cod = String(codigo || '').trim();
    const tit = String(titulo || '').trim();
    return `${cod} ${tit}${ext}`;
}

async function asegurarTablaFormatosSubidos(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_formatos_descarga_subido (
            formato_id INT AUTO_INCREMENT PRIMARY KEY,
            catalog_key VARCHAR(128) NOT NULL,
            codigo VARCHAR(64) NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            categoria_id VARCHAR(32) NOT NULL,
            nombre_archivo VARCHAR(255) NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            tipo_archivo VARCHAR(16) NULL,
            subido_por_usuario_id INT NULL,
            subido_por_username VARCHAR(100) NULL,
            subido_por_nombre VARCHAR(255) NULL,
            fecha_subida_mexico DATETIME NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_fmt_sub_key (catalog_key),
            KEY idx_sgc_fmt_sub_cat (categoria_id),
            KEY idx_sgc_fmt_sub_codigo (codigo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function asegurarTablaFormatosDesactivados(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_formatos_descarga_desactivado (
            catalog_key VARCHAR(128) NOT NULL PRIMARY KEY,
            codigo VARCHAR(64) NULL,
            desactivado_por_usuario_id INT NULL,
            desactivado_por_username VARCHAR(100) NULL,
            desactivado_por_nombre VARCHAR(255) NULL,
            fecha_desactivacion DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_sgc_fmt_des_codigo (codigo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function asegurarTablasFormatosDescarga(poolSgc) {
    if (!poolSgc?.query) throw new Error('Pool biznaga_sgc no disponible');

    await asegurarTablaFormatosSubidos(poolSgc);
    await asegurarTablaFormatosDesactivados(poolSgc);

    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_formatos_descarga_activo (
            catalog_key VARCHAR(128) NOT NULL PRIMARY KEY,
            codigo VARCHAR(64) NOT NULL,
            titulo VARCHAR(255) NULL,
            nombre_archivo VARCHAR(255) NOT NULL,
            drive_file_id_actual VARCHAR(128) NOT NULL,
            version_actual INT NOT NULL DEFAULT 1,
            fecha_actualizacion DATETIME NULL,
            actualizado_por_usuario_id INT NULL,
            actualizado_por_username VARCHAR(100) NULL,
            actualizado_por_nombre VARCHAR(255) NULL,
            KEY idx_sgc_fmt_desc_codigo (codigo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_formatos_descarga_historial (
            historial_id INT AUTO_INCREMENT PRIMARY KEY,
            catalog_key VARCHAR(128) NOT NULL,
            codigo VARCHAR(64) NOT NULL,
            version_numero INT NOT NULL,
            drive_file_id_archivado VARCHAR(128) NULL,
            nombre_archivo_archivado VARCHAR(255) NULL,
            drive_file_id_nuevo VARCHAR(128) NOT NULL,
            nombre_archivo_nuevo VARCHAR(255) NOT NULL,
            usuario_id INT NULL,
            username VARCHAR(100) NULL,
            nombre_usuario VARCHAR(255) NULL,
            fecha_hora_mexico DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_sgc_fmt_hist_key (catalog_key),
            KEY idx_sgc_fmt_hist_codigo (codigo),
            KEY idx_sgc_fmt_hist_fecha (fecha_hora_mexico)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function listarActivos(poolSgc) {
    await asegurarTablasFormatosDescarga(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT catalog_key, codigo, titulo, nombre_archivo, drive_file_id_actual,
                version_actual, fecha_actualizacion,
                actualizado_por_usuario_id, actualizado_por_username, actualizado_por_nombre
         FROM sgc_formatos_descarga_activo`
    );
    return rows || [];
}

async function listarSubidos(poolSgc) {
    await asegurarTablaFormatosSubidos(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT formato_id, catalog_key, codigo, titulo, categoria_id, nombre_archivo,
                drive_file_id, tipo_archivo, subido_por_usuario_id, subido_por_username,
                subido_por_nombre, fecha_subida_mexico, created_at
         FROM sgc_formatos_descarga_subido
         WHERE activo = 1
         ORDER BY categoria_id, codigo, formato_id`
    );
    return rows || [];
}

async function listarDesactivados(poolSgc) {
    await asegurarTablaFormatosDesactivados(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT catalog_key, codigo, desactivado_por_nombre, fecha_desactivacion
         FROM sgc_formatos_descarga_desactivado
         ORDER BY fecha_desactivacion DESC`
    );
    return rows || [];
}

function esFormatoSubido(catalogKey) {
    return String(catalogKey || '').trim().startsWith('subido-');
}

function datosUsuarioFormato(usuario) {
    const usuarioId = Number(usuario?.id || usuario?.usuario_id || 0) || null;
    const username = String(usuario?.username || '').trim() || null;
    const nombreUsuario = [usuario?.nombre, usuario?.apellido, usuario?.apellido_paterno]
        .filter(Boolean)
        .join(' ')
        .trim() || username;
    return { usuarioId, username, nombreUsuario };
}

async function listarHistorial(poolSgc, catalogKey) {
    await asegurarTablasFormatosDescarga(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT historial_id, catalog_key, codigo, version_numero,
                drive_file_id_archivado, nombre_archivo_archivado,
                drive_file_id_nuevo, nombre_archivo_nuevo,
                usuario_id, username, nombre_usuario, fecha_hora_mexico, created_at
         FROM sgc_formatos_descarga_historial
         WHERE catalog_key = ?
         ORDER BY version_numero DESC, historial_id DESC`,
        [catalogKey]
    );
    return rows || [];
}

/**
 * Reemplaza el formato activo:
 * 1) Renombra el archivo actual en Drive con _02 / _03 / …
 * 2) Sube el nuevo archivo con el nombre limpio en la misma carpeta
 * 3) Actualiza activo + historial (fecha/hora México)
 */
async function reemplazarFormatoDescarga({
    poolSgc,
    catalogKey,
    codigo,
    titulo,
    driveFileIdActual,
    nombreArchivo,
    fileBuffer,
    mimeType,
    originalName,
    usuario
}) {
    await asegurarTablasFormatosDescarga(poolSgc);

    const key = String(catalogKey || '').trim();
    if (!key) throw Object.assign(new Error('catalog_key es obligatorio'), { status: 400 });

    const [existentes] = await poolSgc.query(
        `SELECT * FROM sgc_formatos_descarga_activo WHERE catalog_key = ? LIMIT 1`,
        [key]
    );
    const activo = existentes[0] || null;

    const fileIdActual = String(activo?.drive_file_id_actual || driveFileIdActual || '').trim();
    if (!fileIdActual) {
        throw Object.assign(new Error('No se encontró el archivo actual en Drive'), { status: 400 });
    }

    const nombreBase = stripSufijoVersion(
        activo?.nombre_archivo || nombreArchivo || originalName || 'formato'
    );
    const versionActual = Number(activo?.version_actual || 1);
    const versionArchivo = versionActual + 1; // _02 en el 1er reemplazo
    const nombreArchivado = agregarSufijoVersion(nombreBase, versionArchivo);

    const meta = await driveService.obtenerMetadatosArchivo(fileIdActual);
    const parentId = meta?.parents?.[0] || null;
    if (!parentId) {
        throw Object.assign(
            new Error('No se pudo determinar la carpeta del archivo en Drive'),
            { status: 500 }
        );
    }

    await driveService.renombrarArchivoPorId(fileIdActual, nombreArchivado);

    const mime = mimeType || 'application/octet-stream';
    const nuevo = await driveService.subirArchivoNuevo(fileBuffer, nombreBase, mime, parentId);

    const usuarioId = Number(usuario?.id || usuario?.usuario_id || 0) || null;
    const username = String(usuario?.username || '').trim() || null;
    const nombreUsuario = [usuario?.nombre, usuario?.apellido, usuario?.apellido_paterno]
        .filter(Boolean)
        .join(' ')
        .trim() || username;
    const fechaMx = ahoraMexicoSql();

    await poolSgc.query(
        `INSERT INTO sgc_formatos_descarga_activo
            (catalog_key, codigo, titulo, nombre_archivo, drive_file_id_actual, version_actual,
             fecha_actualizacion, actualizado_por_usuario_id, actualizado_por_username, actualizado_por_nombre)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            codigo = VALUES(codigo),
            titulo = VALUES(titulo),
            nombre_archivo = VALUES(nombre_archivo),
            drive_file_id_actual = VALUES(drive_file_id_actual),
            version_actual = VALUES(version_actual),
            fecha_actualizacion = VALUES(fecha_actualizacion),
            actualizado_por_usuario_id = VALUES(actualizado_por_usuario_id),
            actualizado_por_username = VALUES(actualizado_por_username),
            actualizado_por_nombre = VALUES(actualizado_por_nombre)`,
        [
            key,
            String(codigo || activo?.codigo || '').trim() || 'SIN-CODIGO',
            titulo || activo?.titulo || null,
            nombreBase,
            nuevo.id,
            versionArchivo,
            fechaMx,
            usuarioId,
            username,
            nombreUsuario
        ]
    );

    const [hist] = await poolSgc.query(
        `INSERT INTO sgc_formatos_descarga_historial
            (catalog_key, codigo, version_numero, drive_file_id_archivado, nombre_archivo_archivado,
             drive_file_id_nuevo, nombre_archivo_nuevo, usuario_id, username, nombre_usuario, fecha_hora_mexico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            key,
            String(codigo || activo?.codigo || '').trim() || 'SIN-CODIGO',
            versionArchivo,
            fileIdActual,
            nombreArchivado,
            nuevo.id,
            nombreBase,
            usuarioId,
            username,
            nombreUsuario,
            fechaMx
        ]
    );

    return {
        catalog_key: key,
        codigo: String(codigo || activo?.codigo || '').trim(),
        version_actual: versionArchivo,
        drive_file_id_actual: nuevo.id,
        nombre_archivo: nombreBase,
        archivado: {
            drive_file_id: fileIdActual,
            nombre_archivo: nombreArchivado,
            version_numero: versionArchivo
        },
        historial_id: hist.insertId,
        fecha_hora_mexico: fechaMx,
        actualizado_por: nombreUsuario
    };
}

/**
 * Sube un formato nuevo (no presente en el catálogo estático).
 * Solo administradores en la API; el archivo queda en Drive y en BD.
 */
async function codigoFormatoDescargaExiste(poolSgc, codigo) {
    const cod = String(codigo || '').trim();
    if (!cod) return null;

    const [subidos] = await poolSgc.query(
        `SELECT catalog_key, codigo, titulo FROM sgc_formatos_descarga_subido
         WHERE activo = 1 AND UPPER(TRIM(codigo)) = UPPER(?)
         LIMIT 1`,
        [cod]
    );
    if (subidos?.[0]) return subidos[0];

    return null;
}

async function subirFormatoDescarga({
    poolSgc,
    codigo,
    titulo,
    categoriaId,
    fileBuffer,
    mimeType,
    originalName,
    nombreArchivo,
    usuario
}) {
    await asegurarTablasFormatosDescarga(poolSgc);

    const cod = String(codigo || '').trim();
    const cat = String(categoriaId || '').trim();
    const nombreFinal = path.basename(String(nombreArchivo || originalName || '').trim());
    const ext = path.extname(nombreFinal);
    const tit = path.basename(nombreFinal) || cod;

    if (!cod) throw Object.assign(new Error('El código del formato es obligatorio'), { status: 400 });
    if (!nombreFinal) throw Object.assign(new Error('Debe adjuntar el archivo del formato'), { status: 400 });

    const duplicado = await codigoFormatoDescargaExiste(poolSgc, cod);
    if (duplicado) {
        throw Object.assign(
            new Error(`Ya existe un formato con el código ${duplicado.codigo}${duplicado.titulo ? ` (${duplicado.titulo})` : ''}`),
            { status: 409 }
        );
    }

    if (!CATEGORIAS_VALIDAS.has(cat)) {
        throw Object.assign(new Error('Capítulo ISO no válido'), { status: 400 });
    }
    if (!fileBuffer?.length) {
        throw Object.assign(new Error('Debe adjuntar el archivo del formato'), { status: 400 });
    }

    const mime = mimeType || 'application/octet-stream';
    const subido = await driveService.subirArchivoNuevo(
        fileBuffer,
        nombreFinal,
        mime,
        CARPETA_FORMATOS_DRIVE_ID
    );

    const catalogKey = `subido-${crypto.randomBytes(8).toString('hex')}`;
    const usuarioId = Number(usuario?.id || usuario?.usuario_id || 0) || null;
    const username = String(usuario?.username || '').trim() || null;
    const nombreUsuario = [usuario?.nombre, usuario?.apellido, usuario?.apellido_paterno]
        .filter(Boolean)
        .join(' ')
        .trim() || username;
    const fechaMx = ahoraMexicoSql();
    const tipoArchivo = inferirTipoArchivo(nombreFinal);

    await poolSgc.query(
        `INSERT INTO sgc_formatos_descarga_subido
            (catalog_key, codigo, titulo, categoria_id, nombre_archivo, drive_file_id, tipo_archivo,
             subido_por_usuario_id, subido_por_username, subido_por_nombre, fecha_subida_mexico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            catalogKey,
            cod,
            tit,
            cat,
            nombreFinal,
            subido.id,
            tipoArchivo,
            usuarioId,
            username,
            nombreUsuario,
            fechaMx
        ]
    );

    await poolSgc.query(
        `INSERT INTO sgc_formatos_descarga_activo
            (catalog_key, codigo, titulo, nombre_archivo, drive_file_id_actual, version_actual,
             fecha_actualizacion, actualizado_por_usuario_id, actualizado_por_username, actualizado_por_nombre)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            codigo = VALUES(codigo),
            titulo = VALUES(titulo),
            nombre_archivo = VALUES(nombre_archivo),
            drive_file_id_actual = VALUES(drive_file_id_actual),
            fecha_actualizacion = VALUES(fecha_actualizacion),
            actualizado_por_usuario_id = VALUES(actualizado_por_usuario_id),
            actualizado_por_username = VALUES(actualizado_por_username),
            actualizado_por_nombre = VALUES(actualizado_por_nombre)`,
        [catalogKey, cod, tit, nombreFinal, subido.id, fechaMx, usuarioId, username, nombreUsuario]
    );

    return {
        catalog_key: catalogKey,
        codigo: cod,
        titulo: tit,
        categoria_id: cat,
        nombre_archivo: nombreFinal,
        drive_file_id: subido.id,
        drive_file_id_actual: subido.id,
        tipo_archivo: tipoArchivo,
        version_actual: 1,
        fecha_subida_mexico: fechaMx,
        subido_por: nombreUsuario
    };
}

/**
 * Oculta un formato del listado público.
 * - Subidos: marca activo = 0.
 * - Catálogo estático: registro en sgc_formatos_descarga_desactivado.
 */
async function desactivarFormatoDescarga({ poolSgc, catalogKey, codigo, usuario }) {
    await asegurarTablasFormatosDescarga(poolSgc);

    const key = String(catalogKey || '').trim();
    if (!key) throw Object.assign(new Error('catalog_key es obligatorio'), { status: 400 });

    const { usuarioId, username, nombreUsuario } = datosUsuarioFormato(usuario);
    const fechaMx = ahoraMexicoSql();
    const cod = String(codigo || '').trim() || null;

    if (esFormatoSubido(key)) {
        const [rows] = await poolSgc.query(
            `SELECT catalog_key, codigo FROM sgc_formatos_descarga_subido
             WHERE catalog_key = ? AND activo = 1 LIMIT 1`,
            [key]
        );
        if (!rows?.length) {
            throw Object.assign(new Error('Formato no encontrado o ya desactivado'), { status: 404 });
        }
        await poolSgc.query(
            `UPDATE sgc_formatos_descarga_subido SET activo = 0 WHERE catalog_key = ?`,
            [key]
        );
        return {
            catalog_key: key,
            codigo: cod || rows[0].codigo,
            es_subido: true,
            fecha_desactivacion: fechaMx,
            desactivado_por: nombreUsuario
        };
    }

    const [yaDesactivado] = await poolSgc.query(
        `SELECT catalog_key FROM sgc_formatos_descarga_desactivado WHERE catalog_key = ? LIMIT 1`,
        [key]
    );
    if (yaDesactivado?.length) {
        throw Object.assign(new Error('Este formato ya está desactivado'), { status: 409 });
    }

    await poolSgc.query(
        `INSERT INTO sgc_formatos_descarga_desactivado
            (catalog_key, codigo, desactivado_por_usuario_id, desactivado_por_username,
             desactivado_por_nombre, fecha_desactivacion)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [key, cod, usuarioId, username, nombreUsuario, fechaMx]
    );

    return {
        catalog_key: key,
        codigo: cod,
        es_subido: false,
        fecha_desactivacion: fechaMx,
        desactivado_por: nombreUsuario
    };
}

/**
 * Elimina definitivamente un formato (BD + Drive).
 * - Subidos: borra registro subido, activo, historial y archivos en Drive.
 * - Catálogo estático: registra desactivado, limpia activo/historial y borra archivos en Drive.
 */
async function eliminarFormatoDescarga({ poolSgc, catalogKey, codigo, driveFileId, usuario }) {
    await asegurarTablasFormatosDescarga(poolSgc);

    const key = String(catalogKey || '').trim();
    if (!key) throw Object.assign(new Error('catalog_key es obligatorio'), { status: 400 });

    const esSubido = esFormatoSubido(key);
    let codigoFmt = String(codigo || '').trim() || null;

    const historial = await listarHistorial(poolSgc, key);
    const fileIds = new Set();

    if (driveFileId) fileIds.add(String(driveFileId).trim());
    if (!esSubido) fileIds.add(key);

    const [activos] = await poolSgc.query(
        `SELECT drive_file_id_actual, codigo FROM sgc_formatos_descarga_activo WHERE catalog_key = ? LIMIT 1`,
        [key]
    );
    if (activos?.[0]?.drive_file_id_actual) {
        fileIds.add(String(activos[0].drive_file_id_actual));
    }
    if (!codigoFmt && activos?.[0]?.codigo) {
        codigoFmt = String(activos[0].codigo);
    }

    if (esSubido) {
        const [rows] = await poolSgc.query(
            `SELECT catalog_key, codigo, drive_file_id FROM sgc_formatos_descarga_subido WHERE catalog_key = ? LIMIT 1`,
            [key]
        );
        const subido = rows?.[0];
        if (!subido) {
            throw Object.assign(new Error('Formato no encontrado'), { status: 404 });
        }
        if (subido.drive_file_id) fileIds.add(String(subido.drive_file_id));
        if (!codigoFmt) codigoFmt = String(subido.codigo || '').trim() || null;
    }

    for (const h of historial) {
        if (h.drive_file_id_archivado) fileIds.add(String(h.drive_file_id_archivado));
        if (h.drive_file_id_nuevo) fileIds.add(String(h.drive_file_id_nuevo));
    }

    if (!esSubido) {
        const { usuarioId, username, nombreUsuario } = datosUsuarioFormato(usuario);
        const fechaMx = ahoraMexicoSql();
        await poolSgc.query(
            `INSERT INTO sgc_formatos_descarga_desactivado
                (catalog_key, codigo, desactivado_por_usuario_id, desactivado_por_username,
                 desactivado_por_nombre, fecha_desactivacion)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                codigo = VALUES(codigo),
                desactivado_por_usuario_id = VALUES(desactivado_por_usuario_id),
                desactivado_por_username = VALUES(desactivado_por_username),
                desactivado_por_nombre = VALUES(desactivado_por_nombre),
                fecha_desactivacion = VALUES(fecha_desactivacion)`,
            [key, codigoFmt, usuarioId, username, nombreUsuario, fechaMx]
        );
    }

    await poolSgc.query(`DELETE FROM sgc_formatos_descarga_historial WHERE catalog_key = ?`, [key]);
    await poolSgc.query(`DELETE FROM sgc_formatos_descarga_activo WHERE catalog_key = ?`, [key]);
    if (esSubido) {
        await poolSgc.query(`DELETE FROM sgc_formatos_descarga_subido WHERE catalog_key = ?`, [key]);
    }

    const driveEliminados = [];
    for (const fileId of fileIds) {
        if (!fileId) continue;
        try {
            await driveService.eliminarArchivo(fileId);
            driveEliminados.push(fileId);
        } catch (err) {
            console.warn(`[SGC formatos] No se pudo eliminar ${fileId} en Drive:`, err.message);
        }
    }

    return {
        catalog_key: key,
        codigo: codigoFmt,
        es_subido: esSubido,
        eliminado: true,
        archivos_drive_eliminados: driveEliminados.length
    };
}

module.exports = {
    asegurarTablasFormatosDescarga,
    listarActivos,
    listarSubidos,
    listarDesactivados,
    listarHistorial,
    reemplazarFormatoDescarga,
    subirFormatoDescarga,
    desactivarFormatoDescarga,
    eliminarFormatoDescarga,
    esFormatoSubido,
    agregarSufijoVersion,
    stripSufijoVersion,
    ahoraMexicoSql
};
