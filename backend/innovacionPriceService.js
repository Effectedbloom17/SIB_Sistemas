/**
 * Diseño e Innovación · Cotizaciones de señalización — persistencia en biznaga_sgc (innovacion_price).
 */
const innovacionMaterialService = require('./innovacionMaterialService');

const FORMAS_VALIDAS = new Set([
    'circular',
    'rectangular',
    'cuadrada',
    'hexagonal',
    'octogonal',
    'personalizado'
]);

const MATERIALES_VALIDOS = new Set(['trovicel', 'fotoluminiscente']);
const TIPOS_COTIZACION_VALIDOS = new Set(['produccion', 'cliente']);

async function asegurarColumnasTipoCotizacion(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'innovacion_price'
          AND COLUMN_NAME IN ('tipo_cotizacion', 'cotizacion_origen_id')
    `);
    const existentes = new Set(cols.map(col => col.COLUMN_NAME));
    if (!existentes.has('tipo_cotizacion')) {
        await pool.query(`
            ALTER TABLE innovacion_price
            ADD COLUMN tipo_cotizacion VARCHAR(16) NOT NULL DEFAULT 'produccion'
            COMMENT 'produccion o cliente'
            AFTER sign_id
        `);
    }
    if (!existentes.has('cotizacion_origen_id')) {
        await pool.query(`
            ALTER TABLE innovacion_price
            ADD COLUMN cotizacion_origen_id INT NULL
            COMMENT 'Cotización utilizada como base para esta copia'
            AFTER tipo_cotizacion
        `);
    }
}

async function asegurarColumnaFormaPersonalizadoTexto(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_price' AND COLUMN_NAME = 'forma_personalizado_texto'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_price
            ADD COLUMN forma_personalizado_texto VARCHAR(500) NULL
            AFTER aristas_personalizado
        `);
    }
}

async function asegurarColumnaNotas(pool) {
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'innovacion_price' AND COLUMN_NAME = 'notas'
    `);
    if (!cols.length) {
        await pool.query(`
            ALTER TABLE innovacion_price
            ADD COLUMN notas TEXT NULL
            COMMENT 'Notas adicionales de la cotización'
            AFTER materiales_json
        `);
    }
}

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function normalizarForma(forma) {
    const f = String(forma || '').trim().toLowerCase();
    if (!FORMAS_VALIDAS.has(f)) {
        throw new Error('Forma geométrica no válida.');
    }
    return f;
}

function normalizarTipoCotizacion(tipo) {
    const valor = String(tipo || 'produccion').trim().toLowerCase();
    if (!TIPOS_COTIZACION_VALIDOS.has(valor)) {
        throw new Error('Tipo de cotización no válido. Use producción o cliente.');
    }
    return valor;
}

async function normalizarMateriales(pool, materiales) {
    let lista = materiales;
    if (typeof lista === 'string') {
        try {
            lista = JSON.parse(lista);
        } catch {
            lista = lista.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    if (!Array.isArray(lista) || lista.length === 0) {
        throw new Error('Seleccione al menos un material.');
    }
    const slugsActivos = await innovacionMaterialService.obtenerSlugsActivos(pool);
    const normalizados = [...new Set(lista.map(m => String(m).trim().toLowerCase()))];
    for (const m of normalizados) {
        if (!slugsActivos.has(m)) {
            throw new Error(`Material no válido: ${m}`);
        }
    }
    return normalizados;
}

function numeroPositivo(valor, nombreCampo) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`${nombreCampo} debe ser un número mayor a cero.`);
    }
    return Math.round(n * 100) / 100;
}

function formatearCotizacion(row, signRow) {
    if (!row) {
        return null;
    }
    let materiales = [];
    try {
        materiales = JSON.parse(row.materiales_json || '[]');
    } catch {
        materiales = [];
    }
    return {
        id: row.id,
        signId: row.sign_id,
        tipoCotizacion: row.tipo_cotizacion || 'produccion',
        cotizacionOrigenId: row.cotizacion_origen_id != null ? Number(row.cotizacion_origen_id) : null,
        signDescripcion: signRow?.descripcion || '',
        signNombreSenal: signRow?.nombre_senal || signRow?.nombreSenal || '',
        signNombreArchivo: signRow?.nombre_archivo || signRow?.nombreArchivo || '',
        forma: row.forma,
        aristasPersonalizado: row.aristas_personalizado != null ? Number(row.aristas_personalizado) : null,
        formaPersonalizadoTexto: row.forma_personalizado_texto || null,
        distanciaVisualizacionM: row.distancia_visualizacion_m != null ? Number(row.distancia_visualizacion_m) : null,
        largoCm: Number(row.largo_cm),
        anchoCm: Number(row.ancho_cm),
        areaCm2: row.area_cm2 != null ? Number(row.area_cm2) : null,
        cantidad: Number(row.cantidad),
        materiales,
        notas: row.notas || null,
        esMixta: materiales.length > 1,
        creadoPor: row.creado_por || null,
        fechaCreacion: row.created_at
    };
}

async function asegurarTablaInnovacionPrice(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_price (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sign_id INT NOT NULL,
            tipo_cotizacion VARCHAR(16) NOT NULL DEFAULT 'produccion',
            cotizacion_origen_id INT NULL,
            forma VARCHAR(32) NOT NULL,
            aristas_personalizado TINYINT NULL,
            distancia_visualizacion_m DECIMAL(8,2) NULL,
            largo_cm DECIMAL(10,2) NOT NULL,
            ancho_cm DECIMAL(10,2) NOT NULL,
            area_cm2 DECIMAL(12,2) NULL,
            cantidad INT NOT NULL DEFAULT 1,
            materiales_json JSON NOT NULL,
            creado_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            KEY idx_innovacion_price_sign (sign_id),
            KEY idx_innovacion_price_created (created_at),
            CONSTRAINT fk_innovacion_price_sign
                FOREIGN KEY (sign_id) REFERENCES innovacion_sign(id)
                ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnasTipoCotizacion(pool);
    await asegurarColumnaFormaPersonalizadoTexto(pool);
    await asegurarColumnaNotas(pool);
}

async function listarCotizaciones(pool) {
    const [rows] = await pool.query(`
        SELECT p.*, s.descripcion AS sign_descripcion, s.nombre_senal AS sign_nombre_senal,
               s.nombre_archivo AS sign_nombre_archivo
        FROM innovacion_price p
        INNER JOIN innovacion_sign s ON s.id = p.sign_id
        ORDER BY p.created_at DESC, p.id DESC
    `);
    return rows.map(row =>
        formatearCotizacion(row, {
            descripcion: row.sign_descripcion,
            nombre_senal: row.sign_nombre_senal,
            nombre_archivo: row.sign_nombre_archivo
        })
    );
}

async function obtenerCotizacion(pool, id) {
    const [rows] = await pool.query(
        `SELECT p.*, s.descripcion AS sign_descripcion, s.nombre_senal AS sign_nombre_senal,
                s.nombre_archivo AS sign_nombre_archivo
         FROM innovacion_price p
         INNER JOIN innovacion_sign s ON s.id = p.sign_id
         WHERE p.id = ? LIMIT 1`,
        [id]
    );
    const row = rows[0];
    if (!row) {
        return null;
    }
    return formatearCotizacion(row, {
        descripcion: row.sign_descripcion,
        nombre_senal: row.sign_nombre_senal,
        nombre_archivo: row.sign_nombre_archivo
    });
}

async function crearCotizacion(pool, payload, usuario) {
    const signId = Number(payload.sign_id ?? payload.signId);
    if (!Number.isInteger(signId) || signId <= 0) {
        throw new Error('Seleccione una señalización válida.');
    }

    const [signRows] = await pool.query('SELECT id FROM innovacion_sign WHERE id = ? LIMIT 1', [signId]);
    if (!signRows.length) {
        throw new Error('La señalización seleccionada no existe.');
    }

    const forma = normalizarForma(payload.forma);
    const tipoCotizacion = normalizarTipoCotizacion(
        payload.tipo_cotizacion ?? payload.tipoCotizacion
    );
    let cotizacionOrigenId = payload.cotizacion_origen_id ?? payload.cotizacionOrigenId ?? null;
    if (cotizacionOrigenId != null) {
        cotizacionOrigenId = Number(cotizacionOrigenId);
        if (!Number.isInteger(cotizacionOrigenId) || cotizacionOrigenId <= 0) {
            throw new Error('La cotización de origen no es válida.');
        }
        const [origenRows] = await pool.query(
            'SELECT id FROM innovacion_price WHERE id = ? LIMIT 1',
            [cotizacionOrigenId]
        );
        if (!origenRows.length) {
            throw new Error('La cotización de origen ya no existe.');
        }
    }
    let aristasPersonalizado = null;
    let formaPersonalizadoTexto = null;
    if (forma === 'personalizado') {
        formaPersonalizadoTexto = sanitizarTexto(
            payload.forma_personalizado_texto ?? payload.formaPersonalizadoTexto,
            500
        );
        if (!formaPersonalizadoTexto) {
            throw new Error('Describa la forma personalizada.');
        }
    }

    const largoCm = numeroPositivo(payload.largo_cm ?? payload.largoCm, 'Largo');
    const anchoCm = numeroPositivo(payload.ancho_cm ?? payload.anchoCm, 'Ancho');
    const cantidad = Number(payload.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error('La cantidad debe ser un entero mayor a cero.');
    }

    let distanciaVisualizacionM = null;
    if (payload.distancia_visualizacion_m != null || payload.distanciaVisualizacionM != null) {
        distanciaVisualizacionM = numeroPositivo(
            payload.distancia_visualizacion_m ?? payload.distanciaVisualizacionM,
            'Distancia de visualización'
        );
    }

    const materiales = await normalizarMateriales(pool, payload.materiales);
    const areaCm2 = Math.round(largoCm * anchoCm * 100) / 100;
    const creadoPor = sanitizarTexto(usuario, 128);
    const notasRaw = payload.notas ?? payload.notasCotizacion ?? null;
    const notas = notasRaw != null && String(notasRaw).trim() ? sanitizarTexto(notasRaw, 4000) : null;

    const [result] = await pool.query(
        `INSERT INTO innovacion_price
         (sign_id, tipo_cotizacion, cotizacion_origen_id, forma, aristas_personalizado,
          forma_personalizado_texto, distancia_visualizacion_m, largo_cm, ancho_cm,
          area_cm2, cantidad, materiales_json, notas, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            signId,
            tipoCotizacion,
            cotizacionOrigenId,
            forma,
            aristasPersonalizado,
            formaPersonalizadoTexto,
            distanciaVisualizacionM,
            largoCm,
            anchoCm,
            areaCm2,
            cantidad,
            JSON.stringify(materiales),
            notas,
            creadoPor
        ]
    );

    return obtenerCotizacion(pool, result.insertId);
}

module.exports = {
    FORMAS_VALIDAS,
    MATERIALES_VALIDOS,
    TIPOS_COTIZACION_VALIDOS,
    asegurarTablaInnovacionPrice,
    listarCotizaciones,
    obtenerCotizacion,
    crearCotizacion
};
