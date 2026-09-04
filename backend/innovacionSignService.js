/**
 * Diseño e Innovación · Catálogo de señalización — persistencia en biznaga_sgc (innovacion_sign).
 */
const fs = require('fs');
const path = require('path');
const driveService = require('./driveService');

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'innovacion-sign');
const CARPETA_DRIVE_SENALES_ID = '1PlKRTc4uzu_c8JoT54w_07j_kWAJjzo5';
const CARPETAS_DRIVE_CATEGORIA = {
    biznaga: 'Biznaga',
    iso: 'ISO'
};

const MIME_PERMITIDOS = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png'
]);

const EXTENSION_A_MIME = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png'
};

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
    return null;
}

function sanitizarTexto(valor, max = 2000) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function nombreSeguroArchivo(nombre) {
    const base = String(nombre || 'senal')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    return base || 'senal';
}

function asegurarDirectorioUpload() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

const CATEGORIAS_VALIDAS = new Set(['biznaga', 'iso']);

const CLASIFICACIONES_VALIDAS = new Set([
    'advertencia',
    'obligacion',
    'prohibicion',
    'equipo_incendios',
    'condicion_segura',
    'personalizado'
]);

const CLASIFICACION_LABELS = {
    advertencia: 'Advertencia',
    obligacion: 'Obligación',
    prohibicion: 'Prohibición',
    equipo_incendios: 'Equipo contra incendios',
    condicion_segura: 'Condición segura',
    personalizado: 'Personalizado'
};

function normalizarCategoria(valor) {
    const c = String(valor || 'biznaga').trim().toLowerCase();
    if (!CATEGORIAS_VALIDAS.has(c)) {
        throw new Error('Categoría no válida. Use Biznaga o ISO.');
    }
    return c;
}

function normalizarClasificacion(valor) {
    if (valor == null || String(valor).trim() === '') {
        return null;
    }
    const c = String(valor).trim().toLowerCase();
    if (!CLASIFICACIONES_VALIDAS.has(c)) {
        throw new Error(
            'Clasificación no válida. Use: advertencia, obligacion, prohibicion, equipo_incendios, condicion_segura o personalizado.'
        );
    }
    return c;
}

function normalizarCostoUnitario(valor) {
    if (valor == null || valor === '') {
        return null;
    }
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error('El costo unitario debe ser un número mayor o igual a cero.');
    }
    return Math.round(n * 100) / 100;
}

function resolverDescripcionParaDb(descripcion, clasificacion, nombreSenal) {
    const desc = sanitizarTexto(descripcion, 4000);
    if (desc) {
        return desc;
    }
    if (clasificacion && CLASIFICACION_LABELS[clasificacion]) {
        return CLASIFICACION_LABELS[clasificacion];
    }
    return sanitizarTexto(nombreSenal, 255) || 'Sin descripción';
}

async function asegurarColumnaCategoria(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_sign' AND COLUMN_NAME = 'categoria'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_sign
            ADD COLUMN categoria VARCHAR(16) NOT NULL DEFAULT 'biznaga'
            COMMENT 'biznaga o iso'
            AFTER apartado_oficial
        `);
        await pool.query(`UPDATE innovacion_sign SET categoria = 'biznaga' WHERE categoria IS NULL OR categoria = ''`);
    }
}

async function asegurarColumnaNombreSenal(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_sign' AND COLUMN_NAME = 'nombre_senal'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_sign
            ADD COLUMN nombre_senal VARCHAR(255) NOT NULL DEFAULT ''
            COMMENT 'Nombre corto para búsqueda y catálogo'
            AFTER categoria
        `);
        await pool.query(`
            UPDATE innovacion_sign
            SET nombre_senal = LEFT(descripcion, 255)
            WHERE nombre_senal IS NULL OR nombre_senal = ''
        `);
    }
}

async function asegurarColumnaClasificacion(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_sign' AND COLUMN_NAME = 'clasificacion'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_sign
            ADD COLUMN clasificacion VARCHAR(64) NULL
            COMMENT 'advertencia, obligacion, prohibicion, equipo_incendios, condicion_segura, personalizado'
            AFTER nombre_senal
        `);
    }
}

async function asegurarColumnaCostoUnitario(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_sign' AND COLUMN_NAME = 'costo_unitario'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_sign
            ADD COLUMN costo_unitario DECIMAL(12,2) NULL DEFAULT NULL
            COMMENT 'Costo unitario de catálogo'
            AFTER clasificacion
        `);
    }
}

function formatearRegistro(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        apartadoOficial: row.apartado_oficial != null ? Number(row.apartado_oficial) : null,
        categoria: row.categoria || 'biznaga',
        nombreSenal: row.nombre_senal || '',
        clasificacion: row.clasificacion || null,
        costoUnitario: row.costo_unitario != null ? Number(row.costo_unitario) : null,
        descripcion: row.descripcion || '',
        nombreArchivo: row.nombre_archivo,
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        rutaArchivo: row.ruta_archivo,
        driveFileId: row.drive_file_id || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at,
        actualizadoPor: row.actualizado_por || null,
        fechaActualizacion: row.updated_at
    };
}

async function asegurarTablaInnovacionSign(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_sign (
            id INT AUTO_INCREMENT PRIMARY KEY,
            apartado_oficial TINYINT NULL COMMENT '1 o 2 para apartados oficiales del registro',
            descripcion TEXT NOT NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            ruta_archivo VARCHAR(512) NOT NULL,
            drive_file_id VARCHAR(128) NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            subido_por VARCHAR(128) NULL,
            actualizado_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_innovacion_sign_apartado (apartado_oficial),
            KEY idx_innovacion_sign_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnaCategoria(pool);
    await asegurarColumnaNombreSenal(pool);
    await asegurarColumnaClasificacion(pool);
    await asegurarColumnaCostoUnitario(pool);
    try {
        await pool.query(`
            ALTER TABLE innovacion_sign
            ADD COLUMN drive_file_id VARCHAR(128) NULL AFTER ruta_archivo
        `);
    } catch (err) {
        if (!String(err?.message || '').includes('Duplicate column')) {
            throw err;
        }
    }
    asegurarDirectorioUpload();
}

async function listarSigns(pool) {
    const [rows] = await pool.query(`
        SELECT id, apartado_oficial, categoria, nombre_senal, clasificacion, costo_unitario, descripcion,
               nombre_archivo, ruta_archivo, drive_file_id, mime_type,
               tamano_bytes, subido_por, actualizado_por, created_at, updated_at
        FROM innovacion_sign
        ORDER BY created_at DESC, id DESC
    `);
    return rows.map(formatearRegistro);
}

async function obtenerSign(pool, id) {
    const [rows] = await pool.query(
        `SELECT id, apartado_oficial, categoria, nombre_senal, clasificacion, costo_unitario, descripcion,
                nombre_archivo, ruta_archivo, drive_file_id, mime_type,
                tamano_bytes, subido_por, actualizado_por, created_at, updated_at
         FROM innovacion_sign WHERE id = ? LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0]);
}

function rutaAbsolutaArchivo(rutaRelativa) {
    const rel = String(rutaRelativa || '').replace(/^[/\\]+/, '');
    const abs = path.join(__dirname, rel.startsWith('uploads') ? rel : path.join('uploads', 'innovacion-sign', path.basename(rel)));
    const normalized = path.normalize(abs);
    const uploadRoot = path.normalize(UPLOAD_DIR);
    if (!normalized.startsWith(uploadRoot)) {
        throw new Error('Ruta de archivo no válida.');
    }
    return normalized;
}

async function obtenerCarpetaDrive(categoria = 'biznaga') {
    const categoriaNormalizada = normalizarCategoria(categoria);
    return driveService.obtenerOCrearCarpeta(
        CARPETAS_DRIVE_CATEGORIA[categoriaNormalizada],
        CARPETA_DRIVE_SENALES_ID
    );
}

async function subirArchivoDrive(buffer, nombreArchivo, mimeType, categoria) {
    const carpetaId = await obtenerCarpetaDrive(categoria);
    return driveService.subirArchivoNuevo(buffer, nombreArchivo, mimeType, carpetaId);
}

async function recuperarArchivoDrivePorNombre(pool, doc) {
    const carpetaCategoriaId = await obtenerCarpetaDrive(doc.categoria || 'biznaga');
    const encontrado = await driveService.buscarArchivo(doc.nombreArchivo, carpetaCategoriaId)
        || await driveService.buscarArchivo(doc.nombreArchivo, CARPETA_DRIVE_SENALES_ID)
        || await driveService.buscarArchivoGlobal(doc.nombreArchivo);
    if (!encontrado?.id) {
        return null;
    }
    const tamanoEsperado = Number(doc.tamanoBytes || 0);
    const tamanoEncontrado = Number(encontrado.size || 0);
    if (tamanoEsperado > 0 && tamanoEncontrado > 0 && tamanoEsperado !== tamanoEncontrado) {
        console.warn(
            `[INNOVACION-SIGN] Se encontró "${doc.nombreArchivo}" en Drive, pero su tamaño no coincide.`
        );
        return null;
    }
    await pool.query(
        'UPDATE innovacion_sign SET drive_file_id = ? WHERE id = ?',
        [encontrado.id, doc.id]
    );
    console.log(`[INNOVACION-SIGN] Archivo ${doc.id} recuperado desde Drive por nombre.`);
    return encontrado.id;
}

async function leerBufferSign(pool, id) {
    const doc = await obtenerSign(pool, id);
    if (!doc) {
        throw new Error('Registro no encontrado.');
    }
    const abs = rutaAbsolutaArchivo(doc.rutaArchivo);
    if (fs.existsSync(abs)) {
        const buffer = fs.readFileSync(abs);
        if (!doc.driveFileId) {
            try {
                const driveResult = await subirArchivoDrive(
                    buffer,
                    doc.nombreArchivo,
                    doc.mimeType,
                    doc.categoria
                );
                const driveFileId = driveResult?.id || null;
                if (driveFileId) {
                    await pool.query(
                        'UPDATE innovacion_sign SET drive_file_id = ? WHERE id = ?',
                        [driveFileId, doc.id]
                    );
                    doc.driveFileId = driveFileId;
                }
            } catch (error) {
                console.warn(`[INNOVACION-SIGN] No se pudo respaldar ${doc.id} en Drive: ${error.message}`);
            }
        }
        return { doc, buffer };
    }

    let driveFileId = doc.driveFileId;
    if (!driveFileId) {
        driveFileId = await recuperarArchivoDrivePorNombre(pool, doc);
    }
    if (driveFileId) {
        try {
            const buffer = await driveService.descargarArchivo(driveFileId);
            asegurarDirectorioUpload();
            fs.writeFileSync(abs, buffer);
            return { doc: { ...doc, driveFileId }, buffer };
        } catch (error) {
            console.warn(`[INNOVACION-SIGN] No se pudo recuperar ${doc.id} desde Drive: ${error.message}`);
        }
    }

    throw new Error(
        `El archivo de "${doc.nombreSenal || doc.nombreArchivo}" ya no existe. Reemplácelo desde Editar señalización.`
    );
}

function decodificarBase64(archivoBase64) {
    const raw = String(archivoBase64 || '').trim();
    if (!raw) {
        return null;
    }
    const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
    return Buffer.from(base64, 'base64');
}

async function guardarArchivoEnDisco(buffer, nombreOriginal, mimeType) {
    asegurarDirectorioUpload();
    const ext = extensionDesdeNombre(nombreOriginal) || (mimeType === 'application/pdf' ? 'pdf' : 'jpg');
    const base = nombreSeguroArchivo(path.basename(nombreOriginal, path.extname(nombreOriginal)));
    const nombreUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}.${ext}`;
    const rutaRelativa = path.join('uploads', 'innovacion-sign', nombreUnico).replace(/\\/g, '/');
    const abs = path.join(__dirname, rutaRelativa);
    fs.writeFileSync(abs, buffer);
    return { rutaRelativa, tamanoBytes: buffer.length };
}

async function eliminarArchivoDisco(rutaRelativa) {
    try {
        const abs = rutaAbsolutaArchivo(rutaRelativa);
        if (fs.existsSync(abs)) {
            fs.unlinkSync(abs);
        }
    } catch {
        /* ignorar */
    }
}

async function crearSign(pool, payload, usuario) {
    const permitirIncompleto =
        payload.permitir_incompleto === true ||
        payload.permitirIncompleto === true;
    const nombreSenal = sanitizarTexto(payload.nombre_senal ?? payload.nombreSenal, 255);
    if (!nombreSenal && !permitirIncompleto) {
        throw new Error('El nombre de señal es obligatorio.');
    }
    const clasificacion = normalizarClasificacion(payload.clasificacion);
    const costoUnitario = Object.prototype.hasOwnProperty.call(payload, 'costo_unitario')
        || Object.prototype.hasOwnProperty.call(payload, 'costoUnitario')
        ? normalizarCostoUnitario(payload.costo_unitario ?? payload.costoUnitario)
        : null;
    const descripcion = resolverDescripcionParaDb(payload.descripcion, clasificacion, nombreSenal);
    const nombreArchivo = sanitizarTexto(payload.nombre_archivo || payload.nombreArchivo, 512);
    if (!nombreArchivo) {
        throw new Error('El nombre del archivo es obligatorio.');
    }
    const mimeType = resolverMimeType(nombreArchivo, payload.mime_type || payload.mimeType);
    if (!mimeType) {
        throw new Error('Formato no permitido. Use JPG, JPEG, PNG o PDF.');
    }
    const buffer = decodificarBase64(payload.archivo_base64 || payload.archivoBase64);
    if (!buffer || buffer.length === 0) {
        throw new Error('El archivo está vacío o no es válido.');
    }

    let apartadoOficial = payload.apartado_oficial ?? payload.apartadoOficial ?? null;
    if (apartadoOficial != null) {
        apartadoOficial = Number(apartadoOficial);
        if (![1, 2].includes(apartadoOficial)) {
            apartadoOficial = null;
        }
    }

    const categoria = normalizarCategoria(payload.categoria);

    const { rutaRelativa, tamanoBytes } = await guardarArchivoEnDisco(buffer, nombreArchivo, mimeType);
    let driveFileId = null;
    try {
        const driveResult = await subirArchivoDrive(buffer, nombreArchivo, mimeType, categoria);
        driveFileId = driveResult?.id || null;
    } catch (error) {
        console.warn(`[INNOVACION-SIGN] Drive no disponible; se conserva respaldo local: ${error.message}`);
    }
    const subidoPor = sanitizarTexto(usuario, 128);

    const [result] = await pool.query(
        `INSERT INTO innovacion_sign
         (apartado_oficial, categoria, nombre_senal, clasificacion, costo_unitario, descripcion,
          nombre_archivo, ruta_archivo, drive_file_id, mime_type, tamano_bytes, subido_por, actualizado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            apartadoOficial, categoria, nombreSenal, clasificacion, costoUnitario, descripcion,
            nombreArchivo, rutaRelativa, driveFileId, mimeType, tamanoBytes, subidoPor, subidoPor
        ]
    );

    return obtenerSign(pool, result.insertId);
}

async function actualizarSign(pool, id, payload, usuario) {
    const existente = await obtenerSign(pool, id);
    if (!existente) {
        throw new Error('Registro no encontrado.');
    }

    const nombreSenal = sanitizarTexto(
        payload.nombre_senal ?? payload.nombreSenal ?? existente.nombreSenal,
        255
    );
    if (!nombreSenal) {
        throw new Error('El nombre de señal es obligatorio.');
    }

    const clasificacion = Object.prototype.hasOwnProperty.call(payload, 'clasificacion')
        ? normalizarClasificacion(payload.clasificacion)
        : (existente.clasificacion || null);

    const costoUnitario = Object.prototype.hasOwnProperty.call(payload, 'costo_unitario')
        || Object.prototype.hasOwnProperty.call(payload, 'costoUnitario')
        ? normalizarCostoUnitario(payload.costo_unitario ?? payload.costoUnitario)
        : existente.costoUnitario;

    const descripcionRaw = Object.prototype.hasOwnProperty.call(payload, 'descripcion')
        ? payload.descripcion
        : existente.descripcion;
    const descripcion = resolverDescripcionParaDb(descripcionRaw, clasificacion, nombreSenal);

    const actualizadoPor = sanitizarTexto(usuario, 128);
    let rutaArchivo = existente.rutaArchivo;
    let nombreArchivo = existente.nombreArchivo;
    let mimeType = existente.mimeType;
    let tamanoBytes = existente.tamanoBytes;
    let driveFileId = existente.driveFileId;
    let categoria = existente.categoria || 'biznaga';
    if (payload.categoria != null) {
        categoria = normalizarCategoria(payload.categoria);
    }

    const base64 = payload.archivo_base64 || payload.archivoBase64;
    if (base64) {
        const nuevoNombre = sanitizarTexto(payload.nombre_archivo || payload.nombreArchivo || nombreArchivo, 512);
        const nuevoMime = resolverMimeType(nuevoNombre, payload.mime_type || payload.mimeType);
        if (!nuevoMime) {
            throw new Error('Formato no permitido. Use JPG, JPEG, PNG o PDF.');
        }
        const buffer = decodificarBase64(base64);
        if (!buffer || buffer.length === 0) {
            throw new Error('El archivo está vacío o no es válido.');
        }
        const guardado = await guardarArchivoEnDisco(buffer, nuevoNombre, nuevoMime);
        let nuevoDriveFileId = null;
        try {
            const driveResult = await subirArchivoDrive(buffer, nuevoNombre, nuevoMime, categoria);
            nuevoDriveFileId = driveResult?.id || null;
        } catch (error) {
            console.warn(`[INNOVACION-SIGN] No se pudo respaldar reemplazo en Drive: ${error.message}`);
        }
        await eliminarArchivoDisco(existente.rutaArchivo);
        if (nuevoDriveFileId && existente.driveFileId) {
            try {
                await driveService.eliminarArchivo(existente.driveFileId);
            } catch (error) {
                console.warn(`[INNOVACION-SIGN] No se pudo eliminar versión anterior de Drive: ${error.message}`);
            }
        }
        rutaArchivo = guardado.rutaRelativa;
        tamanoBytes = guardado.tamanoBytes;
        nombreArchivo = nuevoNombre;
        mimeType = nuevoMime;
        driveFileId = nuevoDriveFileId;
    }

    await pool.query(
        `UPDATE innovacion_sign
         SET nombre_senal = ?, clasificacion = ?, costo_unitario = ?, descripcion = ?, categoria = ?,
             nombre_archivo = ?, ruta_archivo = ?, drive_file_id = ?, mime_type = ?, tamano_bytes = ?,
             actualizado_por = ?
         WHERE id = ?`,
        [
            nombreSenal, clasificacion, costoUnitario, descripcion, categoria,
            nombreArchivo, rutaArchivo, driveFileId, mimeType, tamanoBytes, actualizadoPor, id
        ]
    );

    return obtenerSign(pool, id);
}

async function eliminarSign(pool, id) {
    const existente = await obtenerSign(pool, id);
    if (!existente) {
        throw new Error('Registro no encontrado.');
    }

    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        await conexion.query('DELETE FROM innovacion_price WHERE sign_id = ?', [id]);
        await conexion.query('DELETE FROM innovacion_sign WHERE id = ?', [id]);

        if (existente.driveFileId) {
            await driveService.eliminarArchivo(existente.driveFileId);
        }
        await conexion.commit();
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }

    await eliminarArchivoDisco(existente.rutaArchivo);
    return { id, eliminado: true, cotizacionesEliminadas: true };
}

module.exports = {
    CATEGORIAS_VALIDAS,
    CLASIFICACIONES_VALIDAS,
    asegurarTablaInnovacionSign,
    listarSigns,
    obtenerSign,
    leerBufferSign,
    crearSign,
    actualizarSign,
    eliminarSign
};
