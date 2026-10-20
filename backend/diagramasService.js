/**
 * Diagramas de Comunicación.
 * El editor es diagrams.net en modo embed; el XML vive en la BD satélite `sensores`.
 */

const XML_VACIO = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const XML_MAX = 8_000_000;
const tablasListas = new WeakMap();
let migracionIntentada = false;

function errorHttp(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function asegurarTabla(pool) {
    let pendiente = tablasListas.get(pool);
    if (!pendiente) {
        pendiente = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS diagramas (
                    diagrama_id INT AUTO_INCREMENT PRIMARY KEY,
                    titulo VARCHAR(180) NOT NULL,
                    xml MEDIUMTEXT NOT NULL,
                    creado_por INT NULL,
                    actualizado_por INT NULL,
                    autor_nombre VARCHAR(180) NULL,
                    editor_nombre VARCHAR(180) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_diagramas_updated (updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [autor] = await pool.query(`SHOW COLUMNS FROM diagramas LIKE 'autor_nombre'`);
            if (!autor.length) {
                await pool.query(`ALTER TABLE diagramas ADD COLUMN autor_nombre VARCHAR(180) NULL AFTER actualizado_por`);
            }
            const [editor] = await pool.query(`SHOW COLUMNS FROM diagramas LIKE 'editor_nombre'`);
            if (!editor.length) {
                await pool.query(`ALTER TABLE diagramas ADD COLUMN editor_nombre VARCHAR(180) NULL AFTER autor_nombre`);
            }
        })().catch((err) => {
            tablasListas.delete(pool);
            throw err;
        });
        tablasListas.set(pool, pendiente);
    }
    await pendiente;
}

/**
 * Copia los diagramas que se crearon en la BD principal y, si la copia queda
 * completa, quita esa tabla para que solo exista en sensores.
 */
async function migrarDesdePrincipal(poolSensores, poolPrincipal) {
    if (migracionIntentada || !poolPrincipal?.query) return;
    migracionIntentada = true;

    try {
        const [tablas] = await poolPrincipal.query(
            `SELECT 1 AS ok
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'diagramas'
             LIMIT 1`
        );
        if (!tablas.length) return;

        const [rows] = await poolPrincipal.query(`
            SELECT
                d.diagrama_id,
                d.titulo,
                d.xml,
                d.creado_por,
                d.actualizado_por,
                d.created_at,
                d.updated_at,
                TRIM(CONCAT(COALESCE(uc.nombre, ''), ' ', COALESCE(uc.apellido, ''))) AS autor_nombre,
                uc.username AS autor_usuario,
                TRIM(CONCAT(COALESCE(ua.nombre, ''), ' ', COALESCE(ua.apellido, ''))) AS editor_nombre,
                ua.username AS editor_usuario
            FROM diagramas d
            LEFT JOIN usuario uc ON uc.id = d.creado_por
            LEFT JOIN usuario ua ON ua.id = d.actualizado_por
        `);

        for (const row of rows || []) {
            await poolSensores.query(
                `INSERT IGNORE INTO diagramas
                    (diagrama_id, titulo, xml, creado_por, actualizado_por, autor_nombre, editor_nombre, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.diagrama_id,
                    row.titulo,
                    row.xml,
                    row.creado_por,
                    row.actualizado_por,
                    nombreVisible(row.autor_nombre, '', row.autor_usuario) || null,
                    nombreVisible(row.editor_nombre, '', row.editor_usuario) || null,
                    row.created_at,
                    row.updated_at
                ]
            );
        }

        const [cuenta] = await poolSensores.query('SELECT COUNT(*) AS n FROM diagramas');
        if (Number(cuenta?.[0]?.n || 0) >= (rows || []).length) {
            await poolPrincipal.query('DROP TABLE IF EXISTS diagramas');
            console.log(`[diagramas] ${(rows || []).length} diagrama(s) quedaron en la BD sensores`);
        }
    } catch (err) {
        migracionIntentada = false;
        console.warn('[diagramas] No se pudieron mover los diagramas a sensores:', err.message);
    }
}

async function preparar(poolSensores, poolPrincipal) {
    await asegurarTabla(poolSensores);
    await migrarDesdePrincipal(poolSensores, poolPrincipal);
}

function idUsuario(user) {
    const id = Number(user?.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function nombreDeUsuario(user) {
    return nombreVisible(user?.nombre, user?.apellido, user?.username);
}

function normalizarTitulo(valor, { requerido = true } = {}) {
    const titulo = String(valor || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 180);
    if (requerido && !titulo) {
        throw errorHttp(400, 'Escribe un nombre para el diagrama');
    }
    return titulo;
}

function normalizarXml(valor) {
    if (typeof valor !== 'string') {
        throw errorHttp(400, 'El diagrama no tiene un formato válido');
    }
    const xml = valor.trim();
    if (!xml) {
        throw errorHttp(400, 'El diagrama está vacío');
    }
    if (xml.length > XML_MAX) {
        throw errorHttp(413, 'El diagrama es demasiado grande para guardarlo (máximo 8 MB)');
    }
    if (!/<mxGraphModel[\s>]|<mxfile[\s>]/i.test(xml)) {
        throw errorHttp(400, 'El contenido no parece un diagrama de diagrams.net');
    }
    return xml;
}

function nombreVisible(nombre, apellido, username) {
    const completo = [nombre, apellido].map((p) => String(p || '').trim()).filter(Boolean).join(' ');
    return completo || String(username || '').trim() || '';
}

function filaResumen(row) {
    return {
        diagrama_id: row.diagrama_id,
        titulo: row.titulo,
        created_at: row.created_at,
        updated_at: row.updated_at,
        autor_nombre: row.autor_nombre || '',
        editor_nombre: row.editor_nombre || ''
    };
}

async function listar(pool) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(`
        SELECT diagrama_id, titulo, created_at, updated_at, autor_nombre, editor_nombre
        FROM diagramas
        ORDER BY updated_at DESC, diagrama_id DESC
    `);
    return (rows || []).map(filaResumen);
}

async function obtener(pool, diagramaId) {
    await asegurarTabla(pool);
    const id = Number(diagramaId);
    if (!Number.isInteger(id) || id <= 0) {
        throw errorHttp(400, 'Diagrama no válido');
    }
    const [rows] = await pool.query(
        `SELECT diagrama_id, titulo, xml, created_at, updated_at, autor_nombre, editor_nombre
         FROM diagramas
         WHERE diagrama_id = ?
         LIMIT 1`,
        [id]
    );
    const row = rows?.[0];
    if (!row) {
        throw errorHttp(404, 'No se encontró el diagrama');
    }
    return row;
}

async function crear(pool, user, titulo) {
    await asegurarTabla(pool);
    const nombre = normalizarTitulo(titulo);
    const quien = nombreDeUsuario(user) || null;
    const usuarioId = idUsuario(user);
    const [result] = await pool.query(
        `INSERT INTO diagramas (titulo, xml, creado_por, actualizado_por, autor_nombre, editor_nombre)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nombre, XML_VACIO, usuarioId, usuarioId, quien, quien]
    );
    return obtener(pool, result.insertId);
}

async function actualizar(pool, user, diagramaId, cambios) {
    await asegurarTabla(pool);
    const actual = await obtener(pool, diagramaId);
    const campos = [];
    const valores = [];

    if (Object.prototype.hasOwnProperty.call(cambios || {}, 'titulo')) {
        campos.push('titulo = ?');
        valores.push(normalizarTitulo(cambios.titulo));
    }
    if (Object.prototype.hasOwnProperty.call(cambios || {}, 'xml')) {
        campos.push('xml = ?');
        valores.push(normalizarXml(cambios.xml));
    }
    if (!campos.length) {
        throw errorHttp(400, 'No hay cambios para guardar');
    }

    campos.push('actualizado_por = ?');
    valores.push(idUsuario(user));
    campos.push('editor_nombre = ?');
    valores.push(nombreDeUsuario(user) || null);
    valores.push(actual.diagrama_id);

    await pool.query(
        `UPDATE diagramas SET ${campos.join(', ')} WHERE diagrama_id = ?`,
        valores
    );
    return obtener(pool, actual.diagrama_id);
}

async function eliminar(pool, diagramaId) {
    await asegurarTabla(pool);
    const actual = await obtener(pool, diagramaId);
    await pool.query('DELETE FROM diagramas WHERE diagrama_id = ?', [actual.diagrama_id]);
    return { diagrama_id: actual.diagrama_id };
}

module.exports = {
    XML_VACIO,
    preparar,
    listar,
    obtener,
    crear,
    actualizar,
    eliminar
};
