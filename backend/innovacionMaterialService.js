/**
 * Diseño e Innovación · Materiales de cotización — persistencia en biznaga_sgc (innovacion_material).
 */
const MATERIALES_INICIALES = [
    { slug: 'trovicel', label: 'Trovicel' },
    { slug: 'fotoluminiscente', label: 'Impresión fotoluminiscente' },
    { slug: 'acrilico', label: 'Acrílico' },
    { slug: 'coroplast', label: 'Coroplast' },
    { slug: 'etiquetas_impresion_en_vinil', label: 'Etiquetas Impresión en Vinil' }
];

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function slugDesdeTexto(texto) {
    return sanitizarTexto(texto, 64)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

function formatearMaterial(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        slug: row.slug,
        label: row.label,
        activo: row.activo === 1 || row.activo === true,
        creadoPor: row.creado_por || null,
        fechaCreacion: row.created_at
    };
}

async function asegurarTablaInnovacionMaterial(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_material (
            id INT AUTO_INCREMENT PRIMARY KEY,
            slug VARCHAR(64) NOT NULL,
            label VARCHAR(255) NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            creado_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_innovacion_material_slug (slug),
            KEY idx_innovacion_material_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    for (const item of MATERIALES_INICIALES) {
        await pool.query(
            `INSERT IGNORE INTO innovacion_material (slug, label, activo, creado_por)
             VALUES (?, ?, 1, 'sistema')`,
            [item.slug, item.label]
        );
        await pool.query(
            `UPDATE innovacion_material SET label = ? WHERE slug = ?`,
            [item.label, item.slug]
        );
    }
}

async function listarMateriales(pool, soloActivos = true) {
    const where = soloActivos ? 'WHERE activo = 1' : '';
    const [rows] = await pool.query(
        `SELECT id, slug, label, activo, creado_por, created_at
         FROM innovacion_material ${where}
         ORDER BY label ASC, id ASC`
    );
    return rows.map(formatearMaterial);
}

async function obtenerSlugsActivos(pool) {
    const materiales = await listarMateriales(pool, true);
    return new Set(materiales.map(m => m.slug));
}

async function crearMaterial(pool, payload, usuario) {
    const label = sanitizarTexto(payload.label || payload.nombre, 255);
    if (!label) {
        throw new Error('El nombre del material es obligatorio.');
    }

    let slug = slugDesdeTexto(payload.slug || label);
    if (!slug) {
        throw new Error('No se pudo generar un identificador válido para el material.');
    }

    const [existentes] = await pool.query(
        'SELECT id FROM innovacion_material WHERE slug = ? LIMIT 1',
        [slug]
    );
    if (existentes.length) {
        slug = `${slug}_${Date.now().toString(36).slice(-4)}`;
    }

    const creadoPor = sanitizarTexto(usuario, 128);
    const [result] = await pool.query(
        `INSERT INTO innovacion_material (slug, label, activo, creado_por)
         VALUES (?, ?, 1, ?)`,
        [slug, label, creadoPor]
    );

    const [rows] = await pool.query(
        `SELECT id, slug, label, activo, creado_por, created_at
         FROM innovacion_material WHERE id = ? LIMIT 1`,
        [result.insertId]
    );
    return formatearMaterial(rows[0]);
}

module.exports = {
    MATERIALES_INICIALES,
    asegurarTablaInnovacionMaterial,
    listarMateriales,
    obtenerSlugsActivos,
    crearMaterial
};
