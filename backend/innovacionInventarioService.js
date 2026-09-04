/**
 * Diseño e Innovación · Inventario de señalizaciones en empresa.
 * Persistencia en biznaga_sgc (innovacion_inventario).
 * Los datos iniciales se toman del registro Word de referencia (Drive).
 */

const ExcelJS = require('exceljs');

const TIPOS_CLASIFICACION = [
    'Advertencia',
    'Obligación',
    'Prohibición',
    'Equipo contra incendios',
    'Condición segura',
    'Personalizado'
];

const INVENTARIO_INICIAL = [
    { descripcion: 'Extintor', tamano: '20cm x 20cm', material: 'Trovicel', cantidad: 4 },
    { descripcion: 'Uso Obligatorio de Equipo de Protección Personal', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 3 },
    { descripcion: 'Puesto de Vigilancia', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Uso Obligatorio de Equipo en Alturas', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 4 },
    { descripcion: 'Área Asignada para Uso de Celular', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Caída de Objetos', tamano: '20cm x 20cm', material: 'Trovicel', cantidad: 3 },
    { descripcion: 'Generador Conectado', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Riesgo Eléctrico', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Carga Suspendida', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 2 },
    { descripcion: 'Prohibido Fumar', tamano: '20cm x 25cm', material: 'Trovicel', cantidad: 2 },
    { descripcion: 'Solo Personal Autorizado', tamano: '20cm x 20cm', material: 'Acrílico', cantidad: 4 },
    { descripcion: 'Botiquín', tamano: '20cm x 20cm', material: 'Acrílico', cantidad: 3 },
    { descripcion: 'Ruta de Evacuación', tamano: '20cm x 20cm', material: 'Acrílico', cantidad: 11 },
    { descripcion: 'Salida de Emergencia', tamano: '20cm x 25cm', material: 'Acrílico', cantidad: 3 },
    { descripcion: 'Extintor', tamano: '20cm x 20cm', material: 'Acrílico', cantidad: 1 },
    { descripcion: 'Extintor Color ISO', tamano: '20cm x 20cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Salida', tamano: '30cm x 15cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Salida de Emergencia', tamano: '40cm x 32cm', material: 'Trovicel', cantidad: 2 },
    { descripcion: 'Uso Obligatorio de Pasamanos', tamano: '40cm x 30cm', material: 'Trovicel', cantidad: 2 },
    { descripcion: 'Riesgo Biológico*', tamano: '40cm x 30cm', material: 'Trovicel', cantidad: 9 },
    { descripcion: 'Material Explosivo*', tamano: '40cm x 30cm', material: 'Trovicel', cantidad: 1 },
    { descripcion: 'Qué Hacer en Caso de Sismo/Incendio', tamano: '40cm x 30cm', material: 'Trovicel', cantidad: 5 },
    { descripcion: 'Ruta de Evacuación Derecha', tamano: '35cm x 17.5cm', material: 'Trovicel', cantidad: 3 },
    { descripcion: 'Ruta de Evacuación Izquierda', tamano: '35cm x 17.5cm', material: 'Trovicel', cantidad: 3 },
    { descripcion: 'Gel Sanitizante', tamano: '18cm x 21cm', material: 'Coroplast', cantidad: 2 },
    { descripcion: 'Punto de Hidratación', tamano: '18cm x 21cm', material: 'Coroplast', cantidad: 3 },
    { descripcion: 'Mantenga Limpia el Área de Trabajo', tamano: '18cm x 21cm', material: 'Coroplast', cantidad: 3 },
    { descripcion: 'Sanitario Mixto Hexagonal', tamano: '17cm x 20cm', material: 'Coroplast', cantidad: 2 },
    { descripcion: 'Riesgo Eléctrico', tamano: '15cm x 10cm', material: 'Etiquetas Impresión en Vinil', cantidad: 17 },
    { descripcion: 'Riesgo Biológico', tamano: '20cm x 20cm', material: 'Etiquetas Impresión en Vinil', cantidad: 5 }
];

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function parsearCantidad(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) {
        return null;
    }
    return Math.floor(n);
}

function normalizarClaveTipo(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function resolverTipo(valor, { requerido = false } = {}) {
    const crudo = sanitizarTexto(valor, 64);
    if (!crudo) {
        if (requerido) {
            throw new Error('El tipo (clasificación) es obligatorio.');
        }
        return null;
    }
    const clave = normalizarClaveTipo(crudo);
    const match = TIPOS_CLASIFICACION.find((t) => normalizarClaveTipo(t) === clave);
    if (match) {
        return match;
    }
    // Valores libres del Excel: se guardan como Personalizado si no coinciden.
    if (clave.includes('personal')) {
        return 'Personalizado';
    }
    throw new Error(
        `Tipo no válido: "${crudo}". Use: ${TIPOS_CLASIFICACION.join(', ')}.`
    );
}

const COLUMNAS_INVENTARIO = `
    i.id, i.descripcion, i.tipo, i.tamano, i.material, i.cantidad, i.notas,
    i.activo, i.imagen_documento_id, i.imagen_sign_id, i.creado_por, i.actualizado_por, i.created_at, i.updated_at,
    d.nombre_archivo AS imagen_nombre_archivo,
    d.mime_type AS imagen_mime_type,
    d.drive_file_id AS imagen_drive_file_id,
    d.web_view_link AS imagen_web_view_link,
    d.carpeta_relativa AS imagen_carpeta_relativa,
    s.nombre_archivo AS sign_nombre_archivo,
    s.mime_type AS sign_mime_type,
    s.drive_file_id AS sign_drive_file_id,
    s.nombre_senal AS sign_nombre_senal
`;

function formatearItem(row) {
    if (!row) {
        return null;
    }
    const imagenDocumentoId = row.imagen_documento_id != null
        ? Number(row.imagen_documento_id)
        : null;
    const imagenSignId = row.imagen_sign_id != null
        ? Number(row.imagen_sign_id)
        : null;
    const tieneDoc = Number.isFinite(imagenDocumentoId) && imagenDocumentoId > 0;
    const tieneSign = Number.isFinite(imagenSignId) && imagenSignId > 0;
    const activo = row.activo == null ? true : !!Number(row.activo);

    let imagenNombreArchivo = null;
    let imagenMimeType = null;
    let imagenDriveFileId = null;
    let imagenWebViewLink = null;
    let imagenCarpetaRelativa = '';
    let imagenOrigen = null;

    if (tieneSign) {
        imagenOrigen = 'catalogo';
        imagenNombreArchivo = row.sign_nombre_archivo || row.sign_nombre_senal || null;
        imagenMimeType = row.sign_mime_type || null;
        imagenDriveFileId = row.sign_drive_file_id || null;
    } else if (tieneDoc) {
        imagenOrigen = 'repositorio';
        imagenNombreArchivo = row.imagen_nombre_archivo || null;
        imagenMimeType = row.imagen_mime_type || null;
        imagenDriveFileId = row.imagen_drive_file_id || null;
        imagenWebViewLink = row.imagen_web_view_link || null;
        imagenCarpetaRelativa = row.imagen_carpeta_relativa || '';
    }

    return {
        id: row.id,
        descripcion: row.descripcion,
        tipo: row.tipo || '',
        tamano: row.tamano,
        material: row.material,
        cantidad: Number(row.cantidad) || 0,
        notas: row.notas || '',
        activo,
        imagenDocumentoId: tieneDoc ? imagenDocumentoId : null,
        imagenSignId: tieneSign ? imagenSignId : null,
        imagenOrigen,
        imagenNombreArchivo,
        imagenMimeType,
        imagenDriveFileId,
        imagenWebViewLink,
        imagenCarpetaRelativa,
        creadoPor: row.creado_por || null,
        actualizadoPor: row.actualizado_por || null,
        fechaCreacion: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

async function asegurarColumnaImagen(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD COLUMN imagen_documento_id INT NULL AFTER notas
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD KEY idx_innovacion_inventario_imagen (imagen_documento_id)
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarColumnaImagenSign(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD COLUMN imagen_sign_id INT NULL AFTER imagen_documento_id
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD KEY idx_innovacion_inventario_imagen_sign (imagen_sign_id)
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarColumnaTipo(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD COLUMN tipo VARCHAR(64) NULL AFTER descripcion
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD KEY idx_innovacion_inventario_tipo (tipo)
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarColumnaActivo(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER notas
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            ADD KEY idx_innovacion_inventario_activo (activo)
        `);
    } catch (err) {
        // Índice ya existe
    }
}

/**
 * Permite filas iguales en descripción/tamaño/material que solo difieren en notas
 * (p. ej. importación Excel tal cual).
 */
async function asegurarSinUniqueInventario(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_inventario
            DROP INDEX uq_innovacion_inventario_item
        `);
    } catch (err) {
        const msg = String(err?.message || err?.code || '');
        if (
            !msg.includes("check that it exists")
            && !msg.includes("Can't DROP")
            && !msg.includes('ER_CANT_DROP_FIELD_OR_KEY')
            && err?.code !== 'ER_CANT_DROP_FIELD_OR_KEY'
        ) {
            // Índice ausente: ok
        }
    }
}

async function asegurarTablaInnovacionInventario(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_inventario (
            id INT AUTO_INCREMENT PRIMARY KEY,
            descripcion VARCHAR(255) NOT NULL,
            tipo VARCHAR(64) NULL,
            tamano VARCHAR(64) NOT NULL,
            material VARCHAR(128) NOT NULL,
            cantidad INT NOT NULL DEFAULT 0,
            notas VARCHAR(500) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            imagen_documento_id INT NULL,
            imagen_sign_id INT NULL,
            creado_por VARCHAR(128) NULL,
            actualizado_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_innovacion_inventario_material (material),
            KEY idx_innovacion_inventario_descripcion (descripcion),
            KEY idx_innovacion_inventario_tipo (tipo),
            KEY idx_innovacion_inventario_activo (activo),
            KEY idx_innovacion_inventario_imagen (imagen_documento_id),
            KEY idx_innovacion_inventario_imagen_sign (imagen_sign_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnaTipo(pool);
    await asegurarColumnaActivo(pool);
    await asegurarColumnaImagen(pool);
    await asegurarColumnaImagenSign(pool);
    await asegurarSinUniqueInventario(pool);

    // Inserta solo faltantes (no sobrescribe cantidades ya editadas).
    for (const item of INVENTARIO_INICIAL) {
        const [existentes] = await pool.query(
            `SELECT id FROM innovacion_inventario
             WHERE descripcion = ? AND tamano = ? AND material = ?
             LIMIT 1`,
            [item.descripcion, item.tamano, item.material]
        );
        if (existentes && existentes.length) {
            continue;
        }
        await pool.query(
            `INSERT INTO innovacion_inventario
                (descripcion, tamano, material, cantidad, creado_por)
             VALUES (?, ?, ?, ?, 'sistema')`,
            [item.descripcion, item.tamano, item.material, item.cantidad]
        );
    }
}

function esMimeImagen(mime, nombre) {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.startsWith('image/')) {
        return true;
    }
    return /\.(jpe?g|png|webp|gif|svg)$/i.test(n);
}

async function resolverImagenDocumentoId(pool, valor) {
    if (valor === null || valor === '' || valor === undefined) {
        return null;
    }
    const id = Number(valor);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('La imagen asociada no es válida.');
    }
    const [rows] = await pool.query(
        `SELECT id, mime_type, nombre_archivo, drive_file_id
         FROM sgc_documentacion_extra
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    const doc = rows[0];
    if (!doc) {
        throw new Error('La imagen no existe en el repositorio.');
    }
    if (!esMimeImagen(doc.mime_type, doc.nombre_archivo)) {
        throw new Error('El archivo del repositorio no es una imagen.');
    }
    return id;
}

async function resolverImagenSignId(pool, valor) {
    if (valor === null || valor === '' || valor === undefined) {
        return null;
    }
    const id = Number(valor);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('La señal del catálogo no es válida.');
    }
    const [rows] = await pool.query(
        `SELECT id, mime_type, nombre_archivo, nombre_senal
         FROM innovacion_sign
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    const sign = rows[0];
    if (!sign) {
        throw new Error('La señal no existe en el catálogo.');
    }
    if (!esMimeImagen(sign.mime_type, sign.nombre_archivo)) {
        throw new Error('La señal del catálogo no tiene un archivo de imagen (solo JPG/PNG/WEBP/GIF/SVG).');
    }
    return id;
}

/**
 * Resuelve la pareja (documento|sign) desde el payload.
 * Son mutuamente excluyentes: si viene sign, limpia documento y viceversa.
 */
async function resolverImagenAsociada(pool, payload, actual = null) {
    const incluyeDoc = payload
        && (Object.prototype.hasOwnProperty.call(payload, 'imagenDocumentoId')
            || Object.prototype.hasOwnProperty.call(payload, 'imagen_documento_id'));
    const incluyeSign = payload
        && (Object.prototype.hasOwnProperty.call(payload, 'imagenSignId')
            || Object.prototype.hasOwnProperty.call(payload, 'imagen_sign_id'));

    let imagenDocumentoId = actual?.imagenDocumentoId ?? null;
    let imagenSignId = actual?.imagenSignId ?? null;

    if (incluyeSign) {
        const raw = payload.imagenSignId !== undefined
            ? payload.imagenSignId
            : payload.imagen_sign_id;
        imagenSignId = await resolverImagenSignId(pool, raw);
        if (imagenSignId) {
            imagenDocumentoId = null;
        } else if (!incluyeDoc) {
            // Limpieza explícita de sign sin tocar doc salvo que también venga doc.
            imagenSignId = null;
        }
    }

    if (incluyeDoc) {
        const raw = payload.imagenDocumentoId !== undefined
            ? payload.imagenDocumentoId
            : payload.imagen_documento_id;
        imagenDocumentoId = await resolverImagenDocumentoId(pool, raw);
        if (imagenDocumentoId) {
            imagenSignId = null;
        } else if (!incluyeSign) {
            imagenDocumentoId = null;
        }
    }

    // Si ambos vienen nulos en el mismo payload, limpia todo.
    if (incluyeDoc && incluyeSign) {
        const rawDoc = payload.imagenDocumentoId !== undefined
            ? payload.imagenDocumentoId
            : payload.imagen_documento_id;
        const rawSign = payload.imagenSignId !== undefined
            ? payload.imagenSignId
            : payload.imagen_sign_id;
        if ((rawDoc === null || rawDoc === '') && (rawSign === null || rawSign === '')) {
            imagenDocumentoId = null;
            imagenSignId = null;
        }
    }

    return { imagenDocumentoId, imagenSignId };
}

async function listarInventario(pool, opciones = {}) {
    const incluirInactivos = !!opciones.incluirInactivos;
    const where = incluirInactivos ? '' : 'WHERE i.activo = 1';
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_INVENTARIO}
         FROM innovacion_inventario i
         LEFT JOIN sgc_documentacion_extra d ON d.id = i.imagen_documento_id
         LEFT JOIN innovacion_sign s ON s.id = i.imagen_sign_id
         ${where}
         ORDER BY i.activo DESC, i.descripcion ASC, i.material ASC, i.id ASC`
    );
    return rows.map(formatearItem);
}

async function obtenerItem(pool, id) {
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || itemId <= 0) {
        return null;
    }
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_INVENTARIO}
         FROM innovacion_inventario i
         LEFT JOIN sgc_documentacion_extra d ON d.id = i.imagen_documento_id
         LEFT JOIN innovacion_sign s ON s.id = i.imagen_sign_id
         WHERE i.id = ?
         LIMIT 1`,
        [itemId]
    );
    return formatearItem(rows[0]);
}

function validarPayload(payload, { parcial = false } = {}) {
    const out = {};

    if (!parcial || payload.descripcion !== undefined) {
        out.descripcion = sanitizarTexto(payload.descripcion, 255);
        if (!out.descripcion) {
            throw new Error('La descripción es obligatoria.');
        }
    }

    if (!parcial || payload.tipo !== undefined || payload.Tipo !== undefined) {
        const tipoRaw = payload.tipo !== undefined ? payload.tipo : payload.Tipo;
        out.tipo = resolverTipo(tipoRaw, { requerido: false });
    }

    if (!parcial || payload.tamano !== undefined) {
        out.tamano = sanitizarTexto(payload.tamano, 64);
        if (!out.tamano) {
            throw new Error('El tamaño es obligatorio.');
        }
    }

    if (!parcial || payload.material !== undefined) {
        out.material = sanitizarTexto(payload.material, 128);
        if (!out.material) {
            throw new Error('El material es obligatorio.');
        }
    }

    if (!parcial || payload.cantidad !== undefined) {
        out.cantidad = parsearCantidad(payload.cantidad);
        if (out.cantidad === null) {
            throw new Error('La cantidad debe ser un número entero mayor o igual a cero.');
        }
    }

    if (!parcial || payload.notas !== undefined) {
        out.notas = sanitizarTexto(payload.notas, 500) || null;
    }

    return out;
}

function payloadIncluyeImagen(payload) {
    return payload
        && (Object.prototype.hasOwnProperty.call(payload, 'imagenDocumentoId')
            || Object.prototype.hasOwnProperty.call(payload, 'imagen_documento_id')
            || Object.prototype.hasOwnProperty.call(payload, 'imagenSignId')
            || Object.prototype.hasOwnProperty.call(payload, 'imagen_sign_id'));
}

function payloadIncluyeTipo(payload) {
    return payload
        && (Object.prototype.hasOwnProperty.call(payload, 'tipo')
            || Object.prototype.hasOwnProperty.call(payload, 'Tipo'));
}

async function crearItem(pool, payload, usuario) {
    const data = validarPayload(payload || {});
    if (!payloadIncluyeTipo(payload || {})) {
        data.tipo = null;
    }
    const creadoPor = sanitizarTexto(usuario, 128) || null;
    let imagenDocumentoId = null;
    let imagenSignId = null;
    if (payloadIncluyeImagen(payload)) {
        const imgs = await resolverImagenAsociada(pool, payload || {}, null);
        imagenDocumentoId = imgs.imagenDocumentoId;
        imagenSignId = imgs.imagenSignId;
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO innovacion_inventario
                (descripcion, tipo, tamano, material, cantidad, notas,
                 imagen_documento_id, imagen_sign_id, creado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.descripcion,
                data.tipo || null,
                data.tamano,
                data.material,
                data.cantidad,
                data.notas,
                imagenDocumentoId,
                imagenSignId,
                creadoPor
            ]
        );
        return obtenerItem(pool, result.insertId);
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            throw new Error('Ya existe un registro con la misma descripción, tamaño y material.');
        }
        throw err;
    }
}

async function actualizarItem(pool, id, payload, usuario) {
    const actual = await obtenerItem(pool, id);
    if (!actual) {
        throw new Error('Registro de inventario no encontrado.');
    }

    const data = validarPayload(
        {
            descripcion: payload.descripcion !== undefined ? payload.descripcion : actual.descripcion,
            tipo: payloadIncluyeTipo(payload) ? (payload.tipo !== undefined ? payload.tipo : payload.Tipo) : actual.tipo,
            tamano: payload.tamano !== undefined ? payload.tamano : actual.tamano,
            material: payload.material !== undefined ? payload.material : actual.material,
            cantidad: payload.cantidad !== undefined ? payload.cantidad : actual.cantidad,
            notas: payload.notas !== undefined ? payload.notas : actual.notas
        }
    );
    const actualizadoPor = sanitizarTexto(usuario, 128) || null;

    let imagenDocumentoId = actual.imagenDocumentoId;
    let imagenSignId = actual.imagenSignId;
    if (payloadIncluyeImagen(payload)) {
        const imgs = await resolverImagenAsociada(pool, payload || {}, actual);
        imagenDocumentoId = imgs.imagenDocumentoId;
        imagenSignId = imgs.imagenSignId;
    }

    try {
        await pool.query(
            `UPDATE innovacion_inventario
             SET descripcion = ?, tipo = ?, tamano = ?, material = ?, cantidad = ?, notas = ?,
                 imagen_documento_id = ?, imagen_sign_id = ?, actualizado_por = ?
             WHERE id = ?`,
            [
                data.descripcion,
                data.tipo || null,
                data.tamano,
                data.material,
                data.cantidad,
                data.notas,
                imagenDocumentoId,
                imagenSignId,
                actualizadoPor,
                actual.id
            ]
        );
        return obtenerItem(pool, actual.id);
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            throw new Error('Ya existe un registro con la misma descripción, tamaño y material.');
        }
        throw err;
    }
}

async function eliminarItem(pool, id, usuario) {
    const actual = await obtenerItem(pool, id);
    if (!actual) {
        throw new Error('Registro de inventario no encontrado.');
    }
    if (!actual.activo) {
        return { id: actual.id, desactivado: true, yaInactivo: true };
    }
    const actualizadoPor = sanitizarTexto(usuario, 128) || null;
    await pool.query(
        `UPDATE innovacion_inventario
         SET activo = 0, actualizado_por = ?
         WHERE id = ?`,
        [actualizadoPor, actual.id]
    );
    return { id: actual.id, desactivado: true };
}

async function reactivarItem(pool, id, usuario) {
    const actual = await obtenerItem(pool, id);
    if (!actual) {
        throw new Error('Registro de inventario no encontrado.');
    }
    if (actual.activo) {
        return obtenerItem(pool, actual.id);
    }
    const actualizadoPor = sanitizarTexto(usuario, 128) || null;
    await pool.query(
        `UPDATE innovacion_inventario
         SET activo = 1, actualizado_por = ?
         WHERE id = ?`,
        [actualizadoPor, actual.id]
    );
    return obtenerItem(pool, actual.id);
}

/** Desactiva (soft-delete) todos los registros activos del inventario. */
async function desactivarInventario(pool, usuario) {
    const actualizadoPor = sanitizarTexto(usuario, 128) || null;
    const [result] = await pool.query(
        `UPDATE innovacion_inventario
         SET activo = 0, actualizado_por = ?
         WHERE activo = 1`,
        [actualizadoPor]
    );
    return {
        desactivados: Number(result.affectedRows) || 0
    };
}

/** Desactiva solo los IDs indicados (activos). */
async function desactivarPorIds(pool, ids, usuario) {
    const lista = (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
    if (!lista.length) {
        throw new Error('Indica al menos un registro para desactivar.');
    }
    const unicos = Array.from(new Set(lista));
    if (unicos.length > 500) {
        throw new Error('Máximo 500 registros por operación.');
    }
    const actualizadoPor = sanitizarTexto(usuario, 128) || null;
    const placeholders = unicos.map(() => '?').join(',');
    const [result] = await pool.query(
        `UPDATE innovacion_inventario
         SET activo = 0, actualizado_por = ?
         WHERE activo = 1 AND id IN (${placeholders})`,
        [actualizadoPor, ...unicos]
    );
    return {
        desactivados: Number(result.affectedRows) || 0,
        solicitados: unicos.length
    };
}

function normalizarIdsInventario(ids) {
    const lista = (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
    const unicos = Array.from(new Set(lista));
    if (!unicos.length) {
        throw new Error('Indica al menos un registro.');
    }
    if (unicos.length > 500) {
        throw new Error('Máximo 500 registros por operación.');
    }
    return unicos;
}

/** Borrado físico de registros por ID (solo super admin / root en la ruta). */
async function borrarDefinitivoPorIds(pool, ids) {
    const unicos = normalizarIdsInventario(ids);
    const placeholders = unicos.map(() => '?').join(',');
    const [result] = await pool.query(
        `DELETE FROM innovacion_inventario WHERE id IN (${placeholders})`,
        unicos
    );
    return {
        eliminados: Number(result.affectedRows) || 0,
        solicitados: unicos.length
    };
}

/** Borrado físico de todo el inventario. */
async function borrarDefinitivoTodo(pool) {
    const [result] = await pool.query('DELETE FROM innovacion_inventario');
    return {
        eliminados: Number(result.affectedRows) || 0
    };
}

function celdaTexto(valor) {
    if (valor == null) {
        return '';
    }
    if (typeof valor === 'object' && valor.text != null) {
        return String(valor.text).trim();
    }
    if (typeof valor === 'object' && valor.result != null) {
        return String(valor.result).trim();
    }
    return String(valor).trim();
}

function normalizarEncabezado(valor) {
    return normalizarClaveTipo(celdaTexto(valor))
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function mapearColumnas(headerRow) {
    const mapa = {};
    (headerRow || []).forEach((celda, idx) => {
        const h = normalizarEncabezado(celda);
        if (!h) {
            return;
        }
        if (h === 'no' || h === 'n' || h === 'num' || h === 'numero') {
            mapa.no = idx;
        } else if (h.includes('descrip')) {
            mapa.descripcion = idx;
        } else if (h === 'tipo' || h.includes('clasific')) {
            mapa.tipo = idx;
        } else if (h.includes('taman') || h.includes('medida') || h.includes('dimens')) {
            mapa.tamano = idx;
        } else if (h.includes('material')) {
            mapa.material = idx;
        } else if (h.includes('cant')) {
            mapa.cantidad = idx;
        } else if (h.includes('nota') || h.includes('obs')) {
            mapa.notas = idx;
        }
    });
    return mapa;
}

/**
 * Importa filas desde Excel (cabeceras: No, Descripción, Tamaño, Material, Cantidad, Tipo, Notas).
 * Cada fila del Excel se inserta tal cual (permite duplicados que solo difieren en observaciones).
 */
async function importarDesdeExcel(pool, body, usuario) {
    const archivoBase64 = String(body?.archivo_base64 || body?.archivoBase64 || '').trim();
    if (!archivoBase64) {
        throw new Error('No se recibió el archivo Excel (archivo_base64).');
    }

    const buffer = Buffer.from(archivoBase64, 'base64');
    if (!buffer.length) {
        throw new Error('El archivo Excel está vacío.');
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    if (!sheet) {
        throw new Error('El Excel no contiene hojas.');
    }

    const filas = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
        filas.push(row.values.slice(1));
    });
    if (filas.length < 2) {
        throw new Error('El Excel no tiene filas de datos (solo encabezados o vacío).');
    }

    const mapa = mapearColumnas(filas[0]);
    if (mapa.descripcion == null || mapa.tamano == null || mapa.material == null || mapa.cantidad == null) {
        throw new Error(
            'Cabeceras requeridas: Descripción, Tamaño, Material y Cantidad. Opcionales: Tipo, Notas.'
        );
    }

    const creadoPor = sanitizarTexto(usuario, 128) || 'importacion';
    let creados = 0;
    let omitidos = 0;
    const errores = [];

    for (let i = 1; i < filas.length; i++) {
        const fila = filas[i] || [];
        const numFila = i + 1;
        try {
            const descripcion = sanitizarTexto(celdaTexto(fila[mapa.descripcion]), 255);
            const tamano = sanitizarTexto(celdaTexto(fila[mapa.tamano]), 64);
            const material = sanitizarTexto(celdaTexto(fila[mapa.material]), 128);
            const cantidad = parsearCantidad(celdaTexto(fila[mapa.cantidad]));
            const tipoRaw = mapa.tipo != null ? celdaTexto(fila[mapa.tipo]) : '';
            const notasRaw = mapa.notas != null ? celdaTexto(fila[mapa.notas]) : '';

            if (!descripcion && !tamano && !material && (cantidad === null || cantidad === 0) && !tipoRaw && !notasRaw) {
                omitidos += 1;
                continue;
            }
            if (!descripcion || !tamano || !material || cantidad === null) {
                throw new Error('Faltan descripción, tamaño, material o cantidad.');
            }

            let tipo = null;
            if (tipoRaw) {
                try {
                    tipo = resolverTipo(tipoRaw);
                } catch (errTipo) {
                    tipo = 'Personalizado';
                }
            }
            const notas = sanitizarTexto(notasRaw, 500) || null;

            await pool.query(
                `INSERT INTO innovacion_inventario
                    (descripcion, tipo, tamano, material, cantidad, notas, activo, creado_por)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
                [descripcion, tipo, tamano, material, cantidad, notas, creadoPor]
            );
            creados += 1;
        } catch (err) {
            errores.push({ fila: numFila, error: err?.message || String(err) });
        }
    }

    return {
        creados,
        actualizados: 0,
        omitidos,
        errores,
        totalFilas: filas.length - 1
    };
}

module.exports = {
    INVENTARIO_INICIAL,
    TIPOS_CLASIFICACION,
    asegurarTablaInnovacionInventario,
    listarInventario,
    obtenerItem,
    crearItem,
    actualizarItem,
    eliminarItem,
    reactivarItem,
    desactivarInventario,
    desactivarPorIds,
    borrarDefinitivoPorIds,
    borrarDefinitivoTodo,
    importarDesdeExcel,
    esMimeImagen,
    resolverImagenDocumentoId
};
