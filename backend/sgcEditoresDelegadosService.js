/**
 * Delegación de edición de formatos SGC (por formato).
 * Solo root / calidad (sergio56|calidad) gestionan la lista de cada formato.
 * Los delegados pueden editar/registrar únicamente los formatos asignados
 * (todos los perfiles excepto empresa).
 */

function normalizarFormatoCodigo(codigo) {
    return String(codigo || '')
        .toLowerCase()
        .trim()
        .replace(/_/g, '-');
}

async function asegurarTabla(pool) {
    const [tables] = await pool.query(`SHOW TABLES LIKE 'sgc_editores_delegados'`);
    if (!tables.length) {
        await pool.query(`
            CREATE TABLE sgc_editores_delegados (
                id INT AUTO_INCREMENT PRIMARY KEY,
                formato_codigo VARCHAR(64) NOT NULL,
                usuario_id INT NOT NULL,
                otorgado_por INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_sgc_editor_formato_usuario (formato_codigo, usuario_id),
                KEY idx_sgc_editor_formato (formato_codigo),
                KEY idx_sgc_editor_usuario (usuario_id),
                KEY idx_sgc_editor_otorgado_por (otorgado_por)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        return;
    }

    const [cols] = await pool.query(`SHOW COLUMNS FROM sgc_editores_delegados LIKE 'formato_codigo'`);
    if (!cols.length) {
        await pool.query(`ALTER TABLE sgc_editores_delegados ADD COLUMN formato_codigo VARCHAR(64) NULL`);
        // La delegación global queda obsoleta: se reasigna por formato desde cada plantilla.
        await pool.query(`DELETE FROM sgc_editores_delegados`);
        await pool.query(`ALTER TABLE sgc_editores_delegados MODIFY formato_codigo VARCHAR(64) NOT NULL`);

        try {
            await pool.query(`ALTER TABLE sgc_editores_delegados DROP INDEX uk_sgc_editor_usuario`);
        } catch (_e) { /* índice antiguo inexistente */ }

        try {
            await pool.query(`
                ALTER TABLE sgc_editores_delegados
                ADD UNIQUE KEY uk_sgc_editor_formato_usuario (formato_codigo, usuario_id)
            `);
        } catch (_e) { /* ya existe */ }

        try {
            await pool.query(`ALTER TABLE sgc_editores_delegados ADD KEY idx_sgc_editor_formato (formato_codigo)`);
        } catch (_e) { /* ya existe */ }
        try {
            await pool.query(`ALTER TABLE sgc_editores_delegados ADD KEY idx_sgc_editor_usuario (usuario_id)`);
        } catch (_e) { /* ya existe */ }
    }
}

/** True si el usuario está delegado en al menos un formato. */
async function esEditorDelegado(pool, usuarioId) {
    const id = Number(usuarioId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const [rows] = await pool.query(
        'SELECT 1 AS ok FROM sgc_editores_delegados WHERE usuario_id = ? LIMIT 1',
        [id]
    );
    return rows.length > 0;
}

/** True si el usuario está delegado para un formato concreto. */
async function esEditorDelegadoFormato(pool, usuarioId, formatoCodigo) {
    const id = Number(usuarioId);
    const formato = normalizarFormatoCodigo(formatoCodigo);
    if (!Number.isFinite(id) || id <= 0 || !formato) return false;
    const [rows] = await pool.query(
        `SELECT 1 AS ok
         FROM sgc_editores_delegados
         WHERE usuario_id = ? AND formato_codigo = ?
         LIMIT 1`,
        [id, formato]
    );
    return rows.length > 0;
}

async function listarEditores(pool, formatoCodigo) {
    const formato = normalizarFormatoCodigo(formatoCodigo);
    if (!formato) return [];
    const [rows] = await pool.query(`
        SELECT
            d.formato_codigo,
            d.usuario_id,
            d.otorgado_por,
            d.created_at,
            u.username,
            u.nombre,
            u.apellido,
            u.email,
            r.nombre_rol AS rol
        FROM sgc_editores_delegados d
        INNER JOIN usuario u ON u.id = d.usuario_id
        LEFT JOIN roles r ON r.rol_id = u.rol_id
        WHERE u.activo = 1
          AND d.formato_codigo = ?
        ORDER BY u.nombre ASC, u.apellido ASC, u.username ASC
    `, [formato]);
    return rows;
}

/**
 * Candidatos a delegación: usuarios activos internos (no perfil empresa).
 */
async function listarCandidatos(pool) {
    const [rows] = await pool.query(`
        SELECT
            u.id AS usuario_id,
            u.username,
            u.nombre,
            u.apellido,
            u.email,
            r.nombre_rol AS rol,
            u.roles_adicionales
        FROM usuario u
        LEFT JOIN roles r ON r.rol_id = u.rol_id
        WHERE u.activo = 1
          AND LOWER(COALESCE(r.nombre_rol, '')) <> 'empresa'
          AND LOWER(COALESCE(u.roles_adicionales, '')) NOT LIKE '%empresa%'
        ORDER BY u.nombre ASC, u.apellido ASC, u.username ASC
    `);
    return rows;
}

/**
 * Reemplaza la lista de delegados de un formato.
 * Excluye perfil empresa.
 */
async function guardarEditores(pool, formatoCodigo, usuarioIds, otorgadoPor) {
    const formato = normalizarFormatoCodigo(formatoCodigo);
    if (!formato) {
        throw new Error('formato_codigo es requerido');
    }

    const idsUnicos = Array.from(
        new Set(
            (Array.isArray(usuarioIds) ? usuarioIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
        )
    );

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        let idsValidos = [];
        if (idsUnicos.length > 0) {
            const placeholders = idsUnicos.map(() => '?').join(',');
            const [validos] = await conn.query(
                `
                SELECT u.id
                FROM usuario u
                LEFT JOIN roles r ON r.rol_id = u.rol_id
                WHERE u.id IN (${placeholders})
                  AND u.activo = 1
                  AND LOWER(COALESCE(r.nombre_rol, '')) <> 'empresa'
                  AND LOWER(COALESCE(u.roles_adicionales, '')) NOT LIKE '%empresa%'
                `,
                idsUnicos
            );
            idsValidos = validos.map((r) => Number(r.id));
        }

        await conn.query(
            'DELETE FROM sgc_editores_delegados WHERE formato_codigo = ?',
            [formato]
        );

        if (idsValidos.length > 0) {
            const values = idsValidos.map((id) => [formato, id, otorgadoPor || null]);
            await conn.query(
                'INSERT INTO sgc_editores_delegados (formato_codigo, usuario_id, otorgado_por) VALUES ?',
                [values]
            );
        }

        await conn.commit();
        return idsValidos;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    normalizarFormatoCodigo,
    asegurarTabla,
    esEditorDelegado,
    esEditorDelegadoFormato,
    listarEditores,
    listarCandidatos,
    guardarEditores
};
