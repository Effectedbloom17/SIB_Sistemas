/**
 * Agenda de actividades (Control de Proyectos).
 * Tablas: agenda, agenda_estatus, agenda_observaciones, agenda_paginas (BD biznaga).
 * Actividades con posición libre (pos_x/pos_y) y página (pagina_uuid).
 */
const crypto = require('crypto');

const PRIORIDADES = new Set(['alta', 'normal', 'baja']);

const ESTATUS_DEFAULT = [
    { clave: 'pendiente', etiqueta: 'Pendiente', color: '#64748B', orden: 10, es_final: 0 },
    { clave: 'en_proceso', etiqueta: 'En proceso', color: '#2D5BFF', orden: 20, es_final: 0 },
    { clave: 'pendiente_revision', etiqueta: 'Pendiente de revisión', color: '#F59E0B', orden: 30, es_final: 0 },
    { clave: 'pendiente_correo', etiqueta: 'Pendiente de respuesta de correo', color: '#8B5CF6', orden: 40, es_final: 0 },
    { clave: 'pendiente_cliente', etiqueta: 'Esperando cliente', color: '#06B6D4', orden: 50, es_final: 0 },
    { clave: 'pospuesto', etiqueta: 'Pospuesto', color: '#94A3B8', orden: 60, es_final: 0 },
    { clave: 'completado', etiqueta: 'Completado', color: '#10B981', orden: 70, es_final: 1 },
    { clave: 'no_completado', etiqueta: 'No completado', color: '#EF4444', orden: 80, es_final: 1 }
];

let tablaAsegurada = false;

function ahoraMs() {
    return Date.now();
}

function nuevoUuid() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex').replace(
        /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
        '$1-$2-$3-$4-$5'
    );
}

function normalizarTexto(valor, maxLen) {
    const texto = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

function normalizarClave(valor, maxLen = 64) {
    const raw = String(valor == null ? '' : valor)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLen);
    return raw || '';
}

function normalizarColor(valor) {
    const c = String(valor || '').trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(c)) return c.toUpperCase();
    if (/^#[0-9A-Fa-f]{3}$/.test(c)) {
        return (`#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`).toUpperCase();
    }
    return '#64748B';
}

function normalizarPrioridad(valor) {
    const p = String(valor || '').trim().toLowerCase();
    return PRIORIDADES.has(p) ? p : 'normal';
}

function normalizarBool(valor) {
    return valor === true || valor === 1 || valor === '1' || valor === 'true' ? 1 : 0;
}

function normalizarMs(valor, fallback = ahoraMs()) {
    const n = Number(valor);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return fallback;
}

function normalizarUuid(valor) {
    const u = String(valor || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)) {
        return u.toLowerCase();
    }
    if (/^[0-9a-f]{32}$/i.test(u)) {
        const h = u.toLowerCase();
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    return '';
}

function normalizarEntero(valor, def, min = 0, max = 20000) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function mapActividad(row) {
    if (!row) return null;
    return {
        id: Number(row.agenda_id),
        clientUuid: row.client_uuid,
        usuarioId: Number(row.usuario_id),
        paginaUuid: row.pagina_uuid || null,
        titulo: row.titulo,
        descripcion: row.descripcion || '',
        estatusClave: row.estatus_clave,
        prioridad: row.prioridad,
        fechaLimite: row.fecha_limite
            ? (row.fecha_limite instanceof Date
                ? row.fecha_limite.toISOString().slice(0, 10)
                : String(row.fecha_limite).slice(0, 10))
            : null,
        posX: Number(row.pos_x) || 40,
        posY: Number(row.pos_y) || 40,
        ancho: Number(row.ancho) || 260,
        diagramaId: row.diagrama_id != null && Number(row.diagrama_id) > 0
            ? Number(row.diagrama_id)
            : null,
        orden: Number(row.orden) || 0,
        eliminado: !!Number(row.eliminado),
        updatedAtMs: Number(row.updated_at_ms) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapEstatus(row) {
    if (!row) return null;
    return {
        id: Number(row.estatus_id),
        clientUuid: row.client_uuid,
        usuarioId: Number(row.usuario_id),
        clave: row.clave,
        etiqueta: row.etiqueta,
        color: row.color,
        orden: Number(row.orden) || 0,
        esFinal: !!Number(row.es_final),
        eliminado: !!Number(row.eliminado),
        updatedAtMs: Number(row.updated_at_ms) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapPagina(row) {
    if (!row) return null;
    return {
        id: Number(row.pagina_id),
        clientUuid: row.client_uuid,
        usuarioId: Number(row.usuario_id),
        titulo: row.titulo,
        observaciones: row.observaciones || '',
        orden: Number(row.orden) || 0,
        eliminado: !!Number(row.eliminado),
        updatedAtMs: Number(row.updated_at_ms) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function asegurarColumna(pool, tabla, columna, ddl) {
    try {
        const [rows] = await pool.query(
            `SELECT COLUMN_NAME AS nombre
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [tabla, columna]
        );
        if (rows?.length) return;
        await pool.query(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
    } catch (err) {
        if (err?.code !== 'ER_DUP_FIELDNAME' && err?.errno !== 1060) {
            console.warn(`[agenda] columna ${tabla}.${columna}:`, err.message);
        }
    }
}

async function asegurarTabla(pool) {
    if (!tablaAsegurada) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda (
                agenda_id INT AUTO_INCREMENT PRIMARY KEY,
                client_uuid CHAR(36) NOT NULL,
                usuario_id INT NOT NULL,
                titulo VARCHAR(255) NOT NULL DEFAULT '',
                descripcion TEXT NULL,
                estatus_clave VARCHAR(64) NOT NULL DEFAULT 'pendiente',
                prioridad ENUM('alta','normal','baja') NOT NULL DEFAULT 'normal',
                fecha_limite DATE NULL,
                orden INT NOT NULL DEFAULT 0,
                eliminado TINYINT(1) NOT NULL DEFAULT 0,
                updated_at_ms BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_agenda_usuario_uuid (usuario_id, client_uuid),
                INDEX idx_agenda_usuario (usuario_id),
                INDEX idx_agenda_estatus (estatus_clave),
                INDEX idx_agenda_eliminado (eliminado),
                INDEX idx_agenda_orden (usuario_id, orden)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS agenda_estatus (
                estatus_id INT AUTO_INCREMENT PRIMARY KEY,
                client_uuid CHAR(36) NOT NULL,
                usuario_id INT NOT NULL,
                clave VARCHAR(64) NOT NULL,
                etiqueta VARCHAR(100) NOT NULL,
                color VARCHAR(20) NOT NULL DEFAULT '#64748B',
                orden INT NOT NULL DEFAULT 0,
                es_final TINYINT(1) NOT NULL DEFAULT 0,
                eliminado TINYINT(1) NOT NULL DEFAULT 0,
                updated_at_ms BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_agenda_estatus_uuid (usuario_id, client_uuid),
                UNIQUE KEY uk_agenda_estatus_clave (usuario_id, clave),
                INDEX idx_agenda_estatus_usuario (usuario_id),
                INDEX idx_agenda_estatus_orden (usuario_id, orden)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        tablaAsegurada = true;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS agenda_observaciones (
            usuario_id INT NOT NULL PRIMARY KEY,
            texto MEDIUMTEXT NULL,
            updated_at_ms BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS agenda_paginas (
            pagina_id INT AUTO_INCREMENT PRIMARY KEY,
            client_uuid CHAR(36) NOT NULL,
            usuario_id INT NOT NULL,
            titulo VARCHAR(120) NOT NULL DEFAULT 'Hoja 1',
            orden INT NOT NULL DEFAULT 0,
            eliminado TINYINT(1) NOT NULL DEFAULT 0,
            updated_at_ms BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_agenda_pagina_uuid (usuario_id, client_uuid),
            INDEX idx_agenda_pagina_usuario (usuario_id),
            INDEX idx_agenda_pagina_orden (usuario_id, orden)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await asegurarColumna(pool, 'agenda', 'pagina_uuid', 'pagina_uuid CHAR(36) NULL');
    await asegurarColumna(pool, 'agenda', 'pos_x', 'pos_x INT NOT NULL DEFAULT 40');
    await asegurarColumna(pool, 'agenda', 'pos_y', 'pos_y INT NOT NULL DEFAULT 40');
    await asegurarColumna(pool, 'agenda', 'ancho', 'ancho INT NOT NULL DEFAULT 320');
    await asegurarColumna(pool, 'agenda', 'diagrama_id', 'diagrama_id INT NULL');
    await asegurarColumna(pool, 'agenda_paginas', 'observaciones', 'observaciones MEDIUMTEXT NULL');

    // Migración puntual: observaciones globales → primera hoja del usuario
    try {
        const [globales] = await pool.query(
            `SELECT usuario_id, texto, updated_at_ms FROM agenda_observaciones
             WHERE texto IS NOT NULL AND TRIM(texto) <> ''`
        );
        for (const g of globales || []) {
            const [pags] = await pool.query(
                `SELECT pagina_id, observaciones FROM agenda_paginas
                 WHERE usuario_id = ? AND eliminado = 0
                 ORDER BY orden ASC, pagina_id ASC LIMIT 1`,
                [g.usuario_id]
            );
            if (!pags?.length) continue;
            if (pags[0].observaciones && String(pags[0].observaciones).trim()) continue;
            await pool.query(
                `UPDATE agenda_paginas SET observaciones = ?, updated_at_ms = GREATEST(updated_at_ms, ?)
                 WHERE pagina_id = ?`,
                [g.texto, Number(g.updated_at_ms) || Date.now(), pags[0].pagina_id]
            );
        }
    } catch (_e) {
        // tabla antigua puede no existir aún
    }
}

async function sembrarEstatusSiVacio(pool, usuarioId) {
    const uid = Number(usuarioId);
    if (!Number.isInteger(uid) || uid <= 0) return;

    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total FROM agenda_estatus WHERE usuario_id = ?`,
        [uid]
    );
    if (Number(rows?.[0]?.total || 0) > 0) return;

    const ms = ahoraMs();
    for (const e of ESTATUS_DEFAULT) {
        await pool.query(
            `INSERT INTO agenda_estatus
                (client_uuid, usuario_id, clave, etiqueta, color, orden, es_final, eliminado, updated_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [nuevoUuid(), uid, e.clave, e.etiqueta, e.color, e.orden, e.es_final, ms]
        );
    }
}

async function sembrarPaginaSiVacio(pool, usuarioId) {
    const uid = Number(usuarioId);
    if (!Number.isInteger(uid) || uid <= 0) return null;

    const [rows] = await pool.query(
        `SELECT * FROM agenda_paginas WHERE usuario_id = ? AND eliminado = 0 ORDER BY orden ASC, pagina_id ASC LIMIT 1`,
        [uid]
    );
    if (rows?.length) return mapPagina(rows[0]);

    const uuid = nuevoUuid();
    const ms = ahoraMs();
    const [result] = await pool.query(
        `INSERT INTO agenda_paginas (client_uuid, usuario_id, titulo, orden, eliminado, updated_at_ms)
         VALUES (?, ?, 'Hoja 1', 10, 0, ?)`,
        [uuid, uid, ms]
    );

    // Asignar actividades huérfanas a esta página
    await pool.query(
        `UPDATE agenda SET pagina_uuid = ? WHERE usuario_id = ? AND (pagina_uuid IS NULL OR pagina_uuid = '')`,
        [uuid, uid]
    );

    const [created] = await pool.query(`SELECT * FROM agenda_paginas WHERE pagina_id = ?`, [result.insertId]);
    return mapPagina(created[0]);
}

async function listarEstatus(pool, usuarioId, { incluirEliminados = false } = {}) {
    await asegurarTabla(pool);
    await sembrarEstatusSiVacio(pool, usuarioId);
    const uid = Number(usuarioId);
    const sql = incluirEliminados
        ? `SELECT * FROM agenda_estatus WHERE usuario_id = ? ORDER BY orden ASC, estatus_id ASC`
        : `SELECT * FROM agenda_estatus WHERE usuario_id = ? AND eliminado = 0 ORDER BY orden ASC, estatus_id ASC`;
    const [rows] = await pool.query(sql, [uid]);
    return (rows || []).map(mapEstatus);
}

async function listarPaginas(pool, usuarioId, { incluirEliminados = false } = {}) {
    await asegurarTabla(pool);
    await sembrarPaginaSiVacio(pool, usuarioId);
    const uid = Number(usuarioId);
    const sql = incluirEliminados
        ? `SELECT * FROM agenda_paginas WHERE usuario_id = ? ORDER BY orden ASC, pagina_id ASC`
        : `SELECT * FROM agenda_paginas WHERE usuario_id = ? AND eliminado = 0 ORDER BY orden ASC, pagina_id ASC`;
    const [rows] = await pool.query(sql, [uid]);
    return (rows || []).map(mapPagina);
}

async function listarActividades(pool, usuarioId, { incluirEliminados = false } = {}) {
    await asegurarTabla(pool);
    await sembrarEstatusSiVacio(pool, usuarioId);
    await sembrarPaginaSiVacio(pool, usuarioId);
    const uid = Number(usuarioId);
    const sql = incluirEliminados
        ? `SELECT * FROM agenda WHERE usuario_id = ? ORDER BY orden ASC, agenda_id DESC`
        : `SELECT * FROM agenda WHERE usuario_id = ? AND eliminado = 0 ORDER BY orden ASC, agenda_id DESC`;
    const [rows] = await pool.query(sql, [uid]);
    return (rows || []).map(mapActividad);
}

async function upsertPagina(pool, usuarioId, payload = {}) {
    await asegurarTabla(pool);
    const uid = Number(usuarioId);
    const clientUuid = normalizarUuid(payload.clientUuid || payload.client_uuid) || nuevoUuid();
    const titulo = normalizarTexto(payload.titulo, 120) || 'Hoja';
    const observaciones = String(payload.observaciones == null ? '' : payload.observaciones).slice(0, 20000);
    const orden = Number.isFinite(Number(payload.orden)) ? Math.floor(Number(payload.orden)) : 0;
    const eliminado = normalizarBool(payload.eliminado);
    const updatedAtMs = normalizarMs(payload.updatedAtMs || payload.updated_at_ms);

    const [existentes] = await pool.query(
        `SELECT pagina_id, updated_at_ms FROM agenda_paginas WHERE usuario_id = ? AND client_uuid = ? LIMIT 1`,
        [uid, clientUuid]
    );

    if (existentes?.length) {
        const actual = existentes[0];
        if (Number(actual.updated_at_ms) > updatedAtMs) {
            const [rows] = await pool.query(`SELECT * FROM agenda_paginas WHERE pagina_id = ?`, [actual.pagina_id]);
            return mapPagina(rows[0]);
        }
        await pool.query(
            `UPDATE agenda_paginas
             SET titulo = ?, observaciones = ?, orden = ?, eliminado = ?, updated_at_ms = ?
             WHERE pagina_id = ?`,
            [titulo, observaciones, orden, eliminado, updatedAtMs, actual.pagina_id]
        );
        const [rows] = await pool.query(`SELECT * FROM agenda_paginas WHERE pagina_id = ?`, [actual.pagina_id]);
        return mapPagina(rows[0]);
    }

    const [result] = await pool.query(
        `INSERT INTO agenda_paginas
            (client_uuid, usuario_id, titulo, observaciones, orden, eliminado, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [clientUuid, uid, titulo, observaciones, orden, eliminado, updatedAtMs]
    );
    const [rows] = await pool.query(`SELECT * FROM agenda_paginas WHERE pagina_id = ?`, [result.insertId]);
    return mapPagina(rows[0]);
}

async function obtenerSnapshot(pool, usuarioId) {
    const [actividades, estatus, paginas] = await Promise.all([
        listarActividades(pool, usuarioId, { incluirEliminados: false }),
        listarEstatus(pool, usuarioId, { incluirEliminados: false }),
        listarPaginas(pool, usuarioId, { incluirEliminados: false })
    ]);
    return { actividades, estatus, paginas };
}

async function upsertActividad(pool, usuarioId, payload = {}) {
    await asegurarTabla(pool);
    await sembrarEstatusSiVacio(pool, usuarioId);
    const primera = await sembrarPaginaSiVacio(pool, usuarioId);
    const uid = Number(usuarioId);
    const clientUuid = normalizarUuid(payload.clientUuid || payload.client_uuid) || nuevoUuid();
    let titulo = String(payload.titulo == null ? '' : payload.titulo)
        .replace(/\r\n/g, '\n')
        .replace(/^\n+|\n+$/g, '')
        .slice(0, 255);
    // Permitir tarjetas vacías (escritura libre); BD NOT NULL → cadena vacía
    const descripcion = String(payload.descripcion == null ? '' : payload.descripcion).trim().slice(0, 4000);
    let estatusClave = normalizarClave(payload.estatusClave || payload.estatus_clave || 'pendiente');
    if (!estatusClave) estatusClave = 'pendiente';

    const prioridad = normalizarPrioridad(payload.prioridad);
    let fechaLimite = payload.fechaLimite || payload.fecha_limite || null;
    if (fechaLimite) {
        const f = String(fechaLimite).slice(0, 10);
        fechaLimite = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
    } else {
        fechaLimite = null;
    }
    const orden = Number.isFinite(Number(payload.orden)) ? Math.floor(Number(payload.orden)) : 0;
    const eliminado = normalizarBool(payload.eliminado);
    const updatedAtMs = normalizarMs(payload.updatedAtMs || payload.updated_at_ms);
    let paginaUuid = normalizarUuid(payload.paginaUuid || payload.pagina_uuid) || (primera?.clientUuid || null);
    const posX = normalizarEntero(payload.posX ?? payload.pos_x, 40, 0, 4000);
    const posY = normalizarEntero(payload.posY ?? payload.pos_y, 40, 0, 6000);
    const ancho = normalizarEntero(payload.ancho, 320, 180, 1200);
    const diagramaRaw = payload.diagramaId ?? payload.diagrama_id;
    const diagramaId = diagramaRaw == null || diagramaRaw === '' || Number(diagramaRaw) <= 0
        ? null
        : Math.floor(Number(diagramaRaw));

    // Soft-delete: se conserva el título aunque esté vacío

    const [existentes] = await pool.query(
        `SELECT agenda_id, updated_at_ms FROM agenda WHERE usuario_id = ? AND client_uuid = ? LIMIT 1`,
        [uid, clientUuid]
    );

    if (existentes?.length) {
        const actual = existentes[0];
        if (Number(actual.updated_at_ms) > updatedAtMs) {
            const [rows] = await pool.query(`SELECT * FROM agenda WHERE agenda_id = ?`, [actual.agenda_id]);
            return mapActividad(rows[0]);
        }
        await pool.query(
            `UPDATE agenda SET
                titulo = ?, descripcion = ?, estatus_clave = ?, prioridad = ?,
                fecha_limite = ?, orden = ?, eliminado = ?, updated_at_ms = ?,
                pagina_uuid = ?, pos_x = ?, pos_y = ?, ancho = ?, diagrama_id = ?
             WHERE agenda_id = ?`,
            [
                titulo, descripcion || null, estatusClave, prioridad, fechaLimite, orden, eliminado, updatedAtMs,
                paginaUuid, posX, posY, ancho, diagramaId, actual.agenda_id
            ]
        );
        const [rows] = await pool.query(`SELECT * FROM agenda WHERE agenda_id = ?`, [actual.agenda_id]);
        return mapActividad(rows[0]);
    }

    const [result] = await pool.query(
        `INSERT INTO agenda
            (client_uuid, usuario_id, titulo, descripcion, estatus_clave, prioridad,
             fecha_limite, orden, eliminado, updated_at_ms, pagina_uuid, pos_x, pos_y, ancho, diagrama_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            clientUuid, uid, titulo, descripcion || null, estatusClave, prioridad,
            fechaLimite, orden, eliminado, updatedAtMs, paginaUuid, posX, posY, ancho, diagramaId
        ]
    );
    const [rows] = await pool.query(`SELECT * FROM agenda WHERE agenda_id = ?`, [result.insertId]);
    return mapActividad(rows[0]);
}

async function upsertEstatus(pool, usuarioId, payload = {}) {
    await asegurarTabla(pool);
    const uid = Number(usuarioId);
    const clientUuid = normalizarUuid(payload.clientUuid || payload.client_uuid) || nuevoUuid();
    let clave = normalizarClave(payload.clave);
    const etiqueta = normalizarTexto(payload.etiqueta, 100);
    if (!etiqueta) {
        const err = new Error('La etiqueta del estatus es obligatoria');
        err.status = 400;
        throw err;
    }
    if (!clave) {
        clave = normalizarClave(etiqueta) || `estatus_${Date.now()}`;
    }
    const color = normalizarColor(payload.color);
    const orden = Number.isFinite(Number(payload.orden)) ? Math.floor(Number(payload.orden)) : 0;
    const esFinal = normalizarBool(payload.esFinal ?? payload.es_final);
    const eliminado = normalizarBool(payload.eliminado);
    const updatedAtMs = normalizarMs(payload.updatedAtMs || payload.updated_at_ms);

    const [existentes] = await pool.query(
        `SELECT estatus_id, updated_at_ms, clave FROM agenda_estatus
         WHERE usuario_id = ? AND client_uuid = ? LIMIT 1`,
        [uid, clientUuid]
    );

    if (existentes?.length) {
        const actual = existentes[0];
        if (Number(actual.updated_at_ms) > updatedAtMs) {
            const [rows] = await pool.query(`SELECT * FROM agenda_estatus WHERE estatus_id = ?`, [actual.estatus_id]);
            return mapEstatus(rows[0]);
        }
        await pool.query(
            `UPDATE agenda_estatus SET
                etiqueta = ?, color = ?, orden = ?, es_final = ?, eliminado = ?, updated_at_ms = ?
             WHERE estatus_id = ?`,
            [etiqueta, color, orden, esFinal, eliminado, updatedAtMs, actual.estatus_id]
        );
        const [rows] = await pool.query(`SELECT * FROM agenda_estatus WHERE estatus_id = ?`, [actual.estatus_id]);
        return mapEstatus(rows[0]);
    }

    const [porClave] = await pool.query(
        `SELECT estatus_id, updated_at_ms FROM agenda_estatus
         WHERE usuario_id = ? AND clave = ? LIMIT 1`,
        [uid, clave]
    );
    if (porClave?.length) {
        const actual = porClave[0];
        if (Number(actual.updated_at_ms) > updatedAtMs) {
            const [rows] = await pool.query(`SELECT * FROM agenda_estatus WHERE estatus_id = ?`, [actual.estatus_id]);
            return mapEstatus(rows[0]);
        }
        await pool.query(
            `UPDATE agenda_estatus SET
                etiqueta = ?, color = ?, orden = ?, es_final = ?, eliminado = ?, updated_at_ms = ?
             WHERE estatus_id = ?`,
            [etiqueta, color, orden, esFinal, eliminado, updatedAtMs, actual.estatus_id]
        );
        const [rows] = await pool.query(`SELECT * FROM agenda_estatus WHERE estatus_id = ?`, [actual.estatus_id]);
        return mapEstatus(rows[0]);
    }

    const [result] = await pool.query(
        `INSERT INTO agenda_estatus
            (client_uuid, usuario_id, clave, etiqueta, color, orden, es_final, eliminado, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientUuid, uid, clave, etiqueta, color, orden, esFinal, eliminado, updatedAtMs]
    );
    const [rows] = await pool.query(`SELECT * FROM agenda_estatus WHERE estatus_id = ?`, [result.insertId]);
    return mapEstatus(rows[0]);
}

async function softDeleteActividad(pool, usuarioId, clientUuid, updatedAtMs) {
    await asegurarTabla(pool);
    const uid = Number(usuarioId);
    const uuid = normalizarUuid(clientUuid);
    if (!uuid) {
        const err = new Error('UUID inválido');
        err.status = 400;
        throw err;
    }
    const ms = normalizarMs(updatedAtMs);
    const [existentes] = await pool.query(
        `SELECT * FROM agenda WHERE usuario_id = ? AND client_uuid = ? LIMIT 1`,
        [uid, uuid]
    );
    if (!existentes?.length) {
        return upsertActividad(pool, usuarioId, {
            clientUuid: uuid,
            titulo: '',
            eliminado: 1,
            updatedAtMs: ms
        });
    }
    const row = existentes[0];
    if (Number(row.updated_at_ms) > ms) {
        return mapActividad(row);
    }
    await pool.query(
        `UPDATE agenda SET eliminado = 1, updated_at_ms = ? WHERE agenda_id = ?`,
        [ms, row.agenda_id]
    );
    const [rows] = await pool.query(`SELECT * FROM agenda WHERE agenda_id = ?`, [row.agenda_id]);
    return mapActividad(rows[0]);
}

async function sincronizar(pool, usuarioId, payload = {}) {
    await asegurarTabla(pool);
    await sembrarEstatusSiVacio(pool, usuarioId);
    await sembrarPaginaSiVacio(pool, usuarioId);

    const paginasIn = Array.isArray(payload.paginas) ? payload.paginas : [];
    const estatusIn = Array.isArray(payload.estatus) ? payload.estatus : [];
    const actividadesIn = Array.isArray(payload.actividades) ? payload.actividades : [];

    for (const p of paginasIn) {
        try {
            await upsertPagina(pool, usuarioId, p);
        } catch (err) {
            console.warn('[agenda] sync pagina:', err.message);
        }
    }

    for (const e of estatusIn) {
        try {
            await upsertEstatus(pool, usuarioId, e);
        } catch (err) {
            console.warn('[agenda] sync estatus:', err.message);
        }
    }

    for (const a of actividadesIn) {
        try {
            // Soft-delete: conservar título/datos; no sobrescribir con marcadores
            await upsertActividad(pool, usuarioId, a);
        } catch (err) {
            console.warn('[agenda] sync actividad:', err.message);
        }
    }

    const [actividadesAll, estatusAll, paginasAll] = await Promise.all([
        listarActividades(pool, usuarioId, { incluirEliminados: true }),
        listarEstatus(pool, usuarioId, { incluirEliminados: true }),
        listarPaginas(pool, usuarioId, { incluirEliminados: true })
    ]);

    const actsArch = actividadesAll.filter((a) => a.eliminado);
    const estsArch = estatusAll.filter((e) => e.eliminado);
    const pagsArch = paginasAll.filter((p) => p.eliminado);

    return {
        actividades: actividadesAll.filter((a) => !a.eliminado),
        estatus: estatusAll.filter((e) => !e.eliminado),
        paginas: paginasAll.filter((p) => !p.eliminado),
        // Objetos completos para poder reactivar sin perder información
        archivados: {
            actividades: actsArch,
            estatus: estsArch,
            paginas: pagsArch
        },
        eliminados: {
            actividades: actsArch.map((a) => a.clientUuid),
            estatus: estsArch.map((e) => e.clientUuid),
            paginas: pagsArch.map((p) => p.clientUuid)
        },
        serverTimeMs: ahoraMs()
    };
}

module.exports = {
    ESTATUS_DEFAULT,
    asegurarTabla,
    obtenerSnapshot,
    listarActividades,
    listarEstatus,
    listarPaginas,
    upsertPagina,
    upsertActividad,
    upsertEstatus,
    softDeleteActividad,
    sincronizar,
    nuevoUuid,
    ahoraMs
};
