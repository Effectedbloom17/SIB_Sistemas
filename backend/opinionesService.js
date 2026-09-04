/**
 * Opiniones y Sugerencias — registro independiente (no SGC).
 * Tabla: opiniones_sugerencias (BD biznaga / pool principal).
 */
const TIPOS = [
    { valor: 'opinion', label: 'Opinión' },
    { valor: 'sugerencia', label: 'Sugerencia' }
];
const TIPO_VALORES = new Set(TIPOS.map((t) => t.valor));
const ESTADOS = new Set(['abierto', 'en_progreso', 'cerrado']);

function normalizarTexto(valor, maxLen) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

function normalizarTipo(tipo) {
    const valor = String(tipo || '').trim().toLowerCase();
    if (valor === 'sugerencia_mejora' || valor === 'mejora') return 'sugerencia';
    if (valor === 'queja') return 'opinion';
    return TIPO_VALORES.has(valor) ? valor : '';
}

function normalizarEstado(estado) {
    const valor = String(estado || '').trim().toLowerCase();
    return ESTADOS.has(valor) ? valor : '';
}

function fechaTagMexico() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const get = (tipo) => parts.find((p) => p.type === tipo)?.value || '';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    return `${d}${m}${String(y).slice(-2)}`;
}

async function asegurarTabla(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS opiniones_sugerencias (
            opinion_id INT AUTO_INCREMENT PRIMARY KEY,
            folio VARCHAR(32) NOT NULL,
            tipo ENUM('opinion','sugerencia') NOT NULL DEFAULT 'opinion',
            descripcion TEXT NOT NULL,
            cliente VARCHAR(200) DEFAULT NULL,
            empresa_id INT DEFAULT NULL,
            usuario_id INT NOT NULL,
            estado ENUM('abierto','en_progreso','cerrado') NOT NULL DEFAULT 'abierto',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_opiniones_folio (folio),
            INDEX idx_opiniones_estado (estado),
            INDEX idx_opiniones_tipo (tipo),
            INDEX idx_opiniones_usuario (usuario_id),
            INDEX idx_opiniones_empresa (empresa_id),
            INDEX idx_opiniones_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function generarFolio(pool) {
    const tag = fechaTagMexico();
    const prefijo = `OP-${tag}-`;
    const [rows] = await pool.query(
        `SELECT folio FROM opiniones_sugerencias
         WHERE folio LIKE ?
         ORDER BY opinion_id DESC
         LIMIT 50`,
        [`${prefijo}%`]
    );
    let maximo = 0;
    for (const row of rows || []) {
        const match = String(row.folio || '').match(/^OP-\d{6}-(\d{1,})$/i);
        if (match) {
            const n = parseInt(match[1], 10);
            if (Number.isFinite(n) && n > maximo) maximo = n;
        }
    }
    return `${prefijo}${String(maximo + 1).padStart(2, '0')}`;
}

async function listarIdsRoot(pool) {
    const [rows] = await pool.query(
        `SELECT DISTINCT u.id
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE LOWER(COALESCE(r.nombre_rol, '')) = 'root'
            OR LOWER(COALESCE(u.roles_adicionales, '')) LIKE '%root%'`
    );
    return (rows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function notificarRoots(pool, { titulo, mensaje, ruta }) {
    const ids = await listarIdsRoot(pool);
    for (const usuarioId of ids) {
        await pool.query(
            `INSERT INTO notificacion_usuario (usuario_id, tipo, icono, titulo, mensaje, ruta)
             VALUES (?, 'info', 'fa-comment-dots', ?, ?, ?)`,
            [usuarioId, titulo, mensaje, ruta || '/quejas-sugerencias']
        );
    }
    return ids.length;
}

async function crear(pool, { tipo, descripcion, cliente, empresaId, usuarioId }) {
    const tipoLimpio = normalizarTipo(tipo) || 'opinion';
    const descripcionLimpia = normalizarTexto(descripcion, 2000);
    const clienteLimpio = normalizarTexto(cliente, 200) || null;
    const empresaNum = Number(empresaId);
    const empresaIdVal = Number.isFinite(empresaNum) && empresaNum > 0 ? empresaNum : null;

    if (!descripcionLimpia) {
        const error = new Error('La descripción es obligatoria');
        error.status = 400;
        throw error;
    }
    if (!usuarioId) {
        const error = new Error('Usuario no autenticado');
        error.status = 401;
        throw error;
    }

    const folio = await generarFolio(pool);
    const [result] = await pool.query(
        `INSERT INTO opiniones_sugerencias
            (folio, tipo, descripcion, cliente, empresa_id, usuario_id, estado)
         VALUES (?, ?, ?, ?, ?, ?, 'abierto')`,
        [folio, tipoLimpio, descripcionLimpia, clienteLimpio, empresaIdVal, usuarioId]
    );

    const tipoLabel = tipoLimpio === 'sugerencia' ? 'Sugerencia' : 'Opinión';
    const resumen = descripcionLimpia.length > 90
        ? `${descripcionLimpia.slice(0, 87)}…`
        : descripcionLimpia;

    await notificarRoots(pool, {
        titulo: `${tipoLabel} · ${folio}`,
        mensaje: resumen,
        ruta: '/quejas-sugerencias'
    });

    return {
        opinion_id: result.insertId,
        folio,
        tipo: tipoLimpio,
        descripcion: descripcionLimpia,
        cliente: clienteLimpio,
        empresa_id: empresaIdVal,
        usuario_id: usuarioId,
        estado: 'abierto'
    };
}

async function listar(pool, { estado, usuarioId, empresaId } = {}) {
    const estadoFiltro = normalizarEstado(estado);
    const params = [];
    const clauses = [];

    const uid = Number(usuarioId);
    if (Number.isFinite(uid) && uid > 0) {
        clauses.push('o.usuario_id = ?');
        params.push(uid);
    }

    const eid = Number(empresaId);
    if (Number.isFinite(eid) && eid > 0) {
        clauses.push('o.empresa_id = ?');
        params.push(eid);
    }

    if (estadoFiltro) {
        clauses.push('o.estado = ?');
        params.push(estadoFiltro);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
        `SELECT
            o.opinion_id,
            o.folio,
            o.tipo,
            o.descripcion,
            o.cliente,
            o.empresa_id,
            o.usuario_id,
            o.estado,
            o.created_at,
            o.updated_at,
            TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellido, ''))) AS autor_nombre,
            u.username AS autor_usuario
         FROM opiniones_sugerencias o
         LEFT JOIN usuario u ON u.id = o.usuario_id
         ${where}
         ORDER BY
            CASE o.estado
                WHEN 'abierto' THEN 1
                WHEN 'en_progreso' THEN 2
                ELSE 3
            END,
            o.created_at DESC`,
        params
    );
    return rows || [];
}

async function actualizarEstado(pool, opinionId, estado) {
    const id = Number(opinionId);
    const estadoLimpio = normalizarEstado(estado);
    if (!Number.isFinite(id) || id <= 0) {
        const error = new Error('Registro inválido');
        error.status = 400;
        throw error;
    }
    if (!estadoLimpio) {
        const error = new Error('Estado inválido');
        error.status = 400;
        throw error;
    }

    const [result] = await pool.query(
        `UPDATE opiniones_sugerencias SET estado = ? WHERE opinion_id = ?`,
        [estadoLimpio, id]
    );
    if (!result.affectedRows) {
        const error = new Error('Registro no encontrado');
        error.status = 404;
        throw error;
    }
    return { opinion_id: id, estado: estadoLimpio };
}

module.exports = {
    TIPOS,
    asegurarTabla,
    crear,
    listar,
    actualizarEstado
};
