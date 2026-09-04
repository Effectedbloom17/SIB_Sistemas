/**
 * Chat manual empresa ↔ administración (tipo chatbot asistido).
 * Tablas: chat_conversacion, chat_mensaje (BD biznaga / pool principal).
 *
 * Modelo:
 * - Una conversación por empresa (hilo único).
 * - Mensajes con emisor_tipo = 'empresa' | 'admin'.
 * - Contadores de no leídos por lado para filtrar y notificar.
 */
async function asegurarTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_conversacion (
            conversacion_id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
            ultimo_mensaje_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_chat_conv_empresa (empresa_id),
            INDEX idx_chat_conv_ultimo (ultimo_mensaje_at),
            INDEX idx_chat_conv_estado (estado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_mensaje (
            mensaje_id INT AUTO_INCREMENT PRIMARY KEY,
            conversacion_id INT NOT NULL,
            emisor_tipo ENUM('empresa','admin') NOT NULL,
            emisor_usuario_id INT NOT NULL,
            cuerpo TEXT NOT NULL,
            leido_destinatario TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_msg_conv_fecha (conversacion_id, created_at),
            INDEX idx_chat_msg_leido (conversacion_id, emisor_tipo, leido_destinatario),
            CONSTRAINT fk_chat_msg_conv
                FOREIGN KEY (conversacion_id) REFERENCES chat_conversacion(conversacion_id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function normalizarTexto(valor, maxLen) {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

function esAdminChat(user) {
    const roles = Array.isArray(user?.roles)
        ? user.roles.map((r) => String(r).toLowerCase())
        : (user?.rol ? [String(user.rol).toLowerCase()] : []);
    return roles.includes('root') || roles.includes('administrador');
}

function esEmpresaChat(user) {
    const roles = Array.isArray(user?.roles)
        ? user.roles.map((r) => String(r).toLowerCase())
        : (user?.rol ? [String(user.rol).toLowerCase()] : []);
    return roles.includes('empresa');
}

async function listarIdsAdmin(pool) {
    const [rows] = await pool.query(
        `SELECT DISTINCT u.id
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE LOWER(COALESCE(r.nombre_rol, '')) IN ('root', 'administrador')
            OR LOWER(COALESCE(u.roles_adicionales, '')) LIKE '%root%'
            OR LOWER(COALESCE(u.roles_adicionales, '')) LIKE '%administrador%'`
    );
    return (rows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function listarIdsEmpresa(pool, empresaId) {
    const eid = Number(empresaId);
    if (!Number.isFinite(eid) || eid <= 0) return [];
    const [rows] = await pool.query(
        `SELECT DISTINCT u.id
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE u.empresa_id = ?
           AND (
             LOWER(COALESCE(r.nombre_rol, '')) = 'empresa'
             OR LOWER(COALESCE(u.roles_adicionales, '')) LIKE '%empresa%'
           )`,
        [eid]
    );
    return (rows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function notificarUsuarios(pool, usuarioIds, { titulo, mensaje, ruta, icono }) {
    const ids = [...new Set((usuarioIds || []).map(Number).filter((id) => id > 0))];
    for (const usuarioId of ids) {
        await pool.query(
            `INSERT INTO notificacion_usuario (usuario_id, tipo, icono, titulo, mensaje, ruta)
             VALUES (?, 'info', ?, ?, ?, ?)`,
            [usuarioId, icono || 'fa-comments', titulo, mensaje, ruta || '/chat-empresas']
        );
    }
    return ids.length;
}

async function obtenerOCrearConversacion(pool, empresaId) {
    const eid = Number(empresaId);
    if (!Number.isFinite(eid) || eid <= 0) {
        const error = new Error('Empresa no válida');
        error.status = 400;
        throw error;
    }

    const [existentes] = await pool.query(
        `SELECT conversacion_id, empresa_id, estado, ultimo_mensaje_at, created_at
         FROM chat_conversacion
         WHERE empresa_id = ?
         LIMIT 1`,
        [eid]
    );
    if (existentes?.length) {
        return existentes[0];
    }

    const [empresaRows] = await pool.query(
        `SELECT empresa_id, nombre_empresa FROM empresa WHERE empresa_id = ? LIMIT 1`,
        [eid]
    );
    if (!empresaRows?.length) {
        const error = new Error('La empresa no existe');
        error.status = 404;
        throw error;
    }

    const [result] = await pool.query(
        `INSERT INTO chat_conversacion (empresa_id, estado) VALUES (?, 'abierta')`,
        [eid]
    );

    return {
        conversacion_id: result.insertId,
        empresa_id: eid,
        estado: 'abierta',
        ultimo_mensaje_at: null,
        created_at: new Date()
    };
}

/**
 * Lista conversaciones.
 * - Admin: todas (con filtro de búsqueda y no leídos).
 * - Empresa: solo la suya.
 */
async function listarConversaciones(pool, user, { q = '', soloNoLeidos = false } = {}) {
    await asegurarTablas(pool);

    const admin = esAdminChat(user);
    const empresa = esEmpresaChat(user);
    if (!admin && !empresa) {
        const error = new Error('No tienes permiso para ver el chat');
        error.status = 403;
        throw error;
    }

    const params = [];
    const clauses = [];

    if (empresa && !admin) {
        const empresaId = Number(user?.empresa_id || 0);
        if (!empresaId) {
            const error = new Error('Tu usuario no tiene empresa asociada');
            error.status = 400;
            throw error;
        }
        clauses.push('c.empresa_id = ?');
        params.push(empresaId);
    }

    const busqueda = normalizarTexto(q, 120);
    if (busqueda) {
        clauses.push('e.nombre_empresa LIKE ?');
        params.push(`%${busqueda}%`);
    }

    // No leídos según el lado que consulta
    const ladoNoLeido = admin ? 'empresa' : 'admin';
    if (soloNoLeidos) {
        clauses.push(`EXISTS (
            SELECT 1 FROM chat_mensaje mnl
            WHERE mnl.conversacion_id = c.conversacion_id
              AND mnl.emisor_tipo = ?
              AND mnl.leido_destinatario = 0
        )`);
        params.push(ladoNoLeido);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
        `SELECT
            c.conversacion_id,
            c.empresa_id,
            c.estado,
            c.ultimo_mensaje_at,
            c.created_at,
            e.nombre_empresa,
            e.logo AS empresa_logo,
            (
              SELECT m.cuerpo
              FROM chat_mensaje m
              WHERE m.conversacion_id = c.conversacion_id
              ORDER BY m.created_at DESC, m.mensaje_id DESC
              LIMIT 1
            ) AS ultimo_mensaje,
            (
              SELECT m.emisor_tipo
              FROM chat_mensaje m
              WHERE m.conversacion_id = c.conversacion_id
              ORDER BY m.created_at DESC, m.mensaje_id DESC
              LIMIT 1
            ) AS ultimo_emisor_tipo,
            (
              SELECT COUNT(*)
              FROM chat_mensaje m
              WHERE m.conversacion_id = c.conversacion_id
                AND m.emisor_tipo = ?
                AND m.leido_destinatario = 0
            ) AS no_leidos
         FROM chat_conversacion c
         INNER JOIN empresa e ON e.empresa_id = c.empresa_id
         ${where}
         ORDER BY
           CASE WHEN c.ultimo_mensaje_at IS NULL THEN 1 ELSE 0 END,
           c.ultimo_mensaje_at DESC,
           c.created_at DESC`,
        [ladoNoLeido, ...params]
    );

    return (rows || []).map((r) => ({
        conversacion_id: Number(r.conversacion_id),
        empresa_id: Number(r.empresa_id),
        nombre_empresa: r.nombre_empresa || '',
        logo: r.empresa_logo || null,
        estado: r.estado,
        ultimo_mensaje_at: r.ultimo_mensaje_at,
        ultimo_mensaje: r.ultimo_mensaje || '',
        ultimo_emisor_tipo: r.ultimo_emisor_tipo || null,
        no_leidos: Number(r.no_leidos) || 0,
        created_at: r.created_at
    }));
}

async function obtenerConversacionAutorizada(pool, conversacionId, user) {
    const cid = Number(conversacionId);
    if (!Number.isFinite(cid) || cid <= 0) {
        const error = new Error('Conversación no válida');
        error.status = 400;
        throw error;
    }

    const [rows] = await pool.query(
        `SELECT c.conversacion_id, c.empresa_id, c.estado, c.ultimo_mensaje_at, e.nombre_empresa, e.logo AS empresa_logo
         FROM chat_conversacion c
         INNER JOIN empresa e ON e.empresa_id = c.empresa_id
         WHERE c.conversacion_id = ?
         LIMIT 1`,
        [cid]
    );
    if (!rows?.length) {
        const error = new Error('Conversación no encontrada');
        error.status = 404;
        throw error;
    }

    const conv = rows[0];
    const admin = esAdminChat(user);
    if (!admin) {
        const empresaId = Number(user?.empresa_id || 0);
        if (Number(conv.empresa_id) !== empresaId) {
            const error = new Error('No tienes acceso a esta conversación');
            error.status = 403;
            throw error;
        }
    }
    return conv;
}

async function listarMensajes(pool, conversacionId, user, { afterId = 0 } = {}) {
    await asegurarTablas(pool);
    const conv = await obtenerConversacionAutorizada(pool, conversacionId, user);

    const params = [Number(conv.conversacion_id)];
    let afterClause = '';
    const aid = Number(afterId);
    if (Number.isFinite(aid) && aid > 0) {
        afterClause = 'AND m.mensaje_id > ?';
        params.push(aid);
    }

    const [rows] = await pool.query(
        `SELECT
            m.mensaje_id,
            m.conversacion_id,
            m.emisor_tipo,
            m.emisor_usuario_id,
            m.cuerpo,
            m.leido_destinatario,
            m.created_at,
            TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellido, ''))) AS emisor_nombre,
            u.username AS emisor_username
         FROM chat_mensaje m
         LEFT JOIN usuario u ON u.id = m.emisor_usuario_id
         WHERE m.conversacion_id = ?
           ${afterClause}
         ORDER BY m.created_at ASC, m.mensaje_id ASC`,
        params
    );

    return {
        conversacion: {
            conversacion_id: Number(conv.conversacion_id),
            empresa_id: Number(conv.empresa_id),
            nombre_empresa: conv.nombre_empresa || '',
            logo: conv.empresa_logo || null,
            estado: conv.estado,
            ultimo_mensaje_at: conv.ultimo_mensaje_at
        },
        mensajes: (rows || []).map((r) => ({
            mensaje_id: Number(r.mensaje_id),
            conversacion_id: Number(r.conversacion_id),
            emisor_tipo: r.emisor_tipo,
            emisor_usuario_id: Number(r.emisor_usuario_id),
            emisor_nombre: String(r.emisor_nombre || '').trim() || r.emisor_username || 'Usuario',
            cuerpo: r.cuerpo,
            leido_destinatario: !!r.leido_destinatario,
            created_at: r.created_at
        }))
    };
}

async function marcarLeidos(pool, conversacionId, user) {
    await asegurarTablas(pool);
    const conv = await obtenerConversacionAutorizada(pool, conversacionId, user);
    const admin = esAdminChat(user);
    // Admin lee mensajes de empresa; empresa lee mensajes de admin
    const emisorAMarcar = admin ? 'empresa' : 'admin';

    const [result] = await pool.query(
        `UPDATE chat_mensaje
         SET leido_destinatario = 1
         WHERE conversacion_id = ?
           AND emisor_tipo = ?
           AND leido_destinatario = 0`,
        [Number(conv.conversacion_id), emisorAMarcar]
    );

    return { marcados: result.affectedRows || 0 };
}

async function enviarMensaje(pool, user, { cuerpo, conversacionId = null, empresaId = null }) {
    await asegurarTablas(pool);

    const texto = normalizarTexto(cuerpo, 4000);
    if (!texto) {
        const error = new Error('El mensaje no puede estar vacío');
        error.status = 400;
        throw error;
    }

    const usuarioId = Number(user?.id || 0);
    if (!usuarioId) {
        const error = new Error('Usuario no autenticado');
        error.status = 401;
        throw error;
    }

    const admin = esAdminChat(user);
    const empresa = esEmpresaChat(user);
    if (!admin && !empresa) {
        const error = new Error('No tienes permiso para enviar mensajes');
        error.status = 403;
        throw error;
    }

    let conv;
    if (admin) {
        if (conversacionId) {
            conv = await obtenerConversacionAutorizada(pool, conversacionId, user);
        } else if (empresaId) {
            conv = await obtenerOCrearConversacion(pool, empresaId);
        } else {
            const error = new Error('Indica la conversación o la empresa');
            error.status = 400;
            throw error;
        }
    } else {
        const eid = Number(user?.empresa_id || 0);
        if (!eid) {
            const error = new Error('Tu usuario no tiene empresa asociada');
            error.status = 400;
            throw error;
        }
        conv = await obtenerOCrearConversacion(pool, eid);
    }

    if (String(conv.estado) === 'cerrada') {
        await pool.query(
            `UPDATE chat_conversacion SET estado = 'abierta' WHERE conversacion_id = ?`,
            [Number(conv.conversacion_id)]
        );
        conv.estado = 'abierta';
    }

    const emisorTipo = admin ? 'admin' : 'empresa';

    const [result] = await pool.query(
        `INSERT INTO chat_mensaje (conversacion_id, emisor_tipo, emisor_usuario_id, cuerpo, leido_destinatario)
         VALUES (?, ?, ?, ?, 0)`,
        [Number(conv.conversacion_id), emisorTipo, usuarioId, texto]
    );

    await pool.query(
        `UPDATE chat_conversacion
         SET ultimo_mensaje_at = CURRENT_TIMESTAMP
         WHERE conversacion_id = ?`,
        [Number(conv.conversacion_id)]
    );

    const resumen = texto.length > 90 ? `${texto.slice(0, 87)}…` : texto;
    const [empRows] = await pool.query(
        `SELECT nombre_empresa FROM empresa WHERE empresa_id = ? LIMIT 1`,
        [Number(conv.empresa_id)]
    );
    const nombreEmpresa = empRows?.[0]?.nombre_empresa || 'Empresa';

    if (emisorTipo === 'empresa') {
        const admins = await listarIdsAdmin(pool);
        await notificarUsuarios(pool, admins, {
            titulo: `Asesoría y Soporte · ${nombreEmpresa}`,
            mensaje: resumen,
            ruta: `/chat-empresas?c=${conv.conversacion_id}`,
            icono: 'fa-comments'
        });
    } else {
        const empresaUsers = await listarIdsEmpresa(pool, conv.empresa_id);
        await notificarUsuarios(pool, empresaUsers, {
            titulo: 'Nueva respuesta · Asesoría y Soporte',
            mensaje: resumen,
            ruta: '/chat-empresas',
            icono: 'fa-comments'
        });
    }

    return {
        mensaje_id: result.insertId,
        conversacion_id: Number(conv.conversacion_id),
        empresa_id: Number(conv.empresa_id),
        emisor_tipo: emisorTipo,
        emisor_usuario_id: usuarioId,
        cuerpo: texto,
        leido_destinatario: false,
        created_at: new Date()
    };
}

async function actualizarEstado(pool, conversacionId, user, estado) {
    await asegurarTablas(pool);
    if (!esAdminChat(user)) {
        const error = new Error('Solo administración puede cambiar el estado');
        error.status = 403;
        throw error;
    }
    const valor = String(estado || '').toLowerCase();
    if (valor !== 'abierta' && valor !== 'cerrada') {
        const error = new Error('Estado inválido');
        error.status = 400;
        throw error;
    }
    const conv = await obtenerConversacionAutorizada(pool, conversacionId, user);
    await pool.query(
        `UPDATE chat_conversacion SET estado = ? WHERE conversacion_id = ?`,
        [valor, Number(conv.conversacion_id)]
    );
    return { conversacion_id: Number(conv.conversacion_id), estado: valor };
}

module.exports = {
    asegurarTablas,
    listarConversaciones,
    listarMensajes,
    enviarMensaje,
    marcarLeidos,
    actualizarEstado,
    obtenerOCrearConversacion,
    esAdminChat,
    esEmpresaChat
};
