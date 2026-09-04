/**
 * Tickets / aportaciones y sugerencias de mejora.
 * Tabla: tickets (BD biznaga / pool principal).
 *
 * Ciclo de deploy:
 * - Mientras se desarrolla: publicado_version IS NULL (lista activa).
 * - Al terminar deploy.ps1 sin error: se marcan con la versión y se limpian
 *   las notificaciones de aportaciones para empezar un ciclo nuevo.
 *
 * Evidencias: se guardan en Google Drive (carpeta Tickets) para no perderlas
 * en deploys. Fallback local solo para registros antiguos.
 */
const fs = require('fs');
const path = require('path');
const driveService = require('./driveService');

const AREAS = [
    'Capacitación',
    'Protección Civil',
    'SGC',
    'Recursos Humanos',
    'Médicos',
    'Ambiental',
    'Control de Proyectos',
    'Control de Oficios',
    'Diseño e Innovación',
    'Mantenimiento',
    'General'
];

const ESTADOS = new Set(['abierto', 'en_progreso', 'cerrado']);
const PRIORIDADES = [
    { valor: 'critica', label: 'Crítica' },
    { valor: 'urgente', label: 'Urgente' },
    { valor: 'prioritaria', label: 'Prioritaria' },
    { valor: 'normal', label: 'Normal' },
    { valor: 'no_prioritaria', label: 'No prioritaria' }
];
const PRIORIDAD_VALORES = new Set(PRIORIDADES.map((p) => p.valor));
const TIPOS = [
    { valor: 'falla', label: 'Falla' },
    { valor: 'sugerencia', label: 'Sugerencia de mejora' },
    { valor: 'actualizacion', label: 'Actualización' }
];
const TIPO_VALORES = new Set(TIPOS.map((t) => t.valor));
const NOTAS_PATH = path.join(__dirname, 'data', 'notas-version.json');
const EVIDENCIAS_DIR = path.join(__dirname, 'data', 'ticket-evidencias');
/** Carpeta Drive: Sistema_Integral / Tickets */
const TICKETS_EVIDENCIAS_DRIVE_FOLDER_ID = String(
    process.env.TICKETS_EVIDENCIAS_DRIVE_FOLDER_ID || '1N5NvC8YnRv5dF5CN_s4h07gcbxVK2xd2'
).trim();

function normalizarTexto(valor, maxLen) {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

function normalizarArea(area) {
    const valor = String(area || '').trim();
    return AREAS.includes(valor) ? valor : '';
}

function normalizarEstado(estado) {
    const valor = String(estado || '').trim().toLowerCase();
    return ESTADOS.has(valor) ? valor : '';
}

function normalizarPrioridad(prioridad) {
    const valor = String(prioridad || '').trim().toLowerCase();
    return PRIORIDAD_VALORES.has(valor) ? valor : '';
}

function normalizarTipo(tipo) {
    const valor = String(tipo || '').trim().toLowerCase();
    if (valor === 'sugerencia_mejora' || valor === 'mejora') return 'sugerencia';
    if (valor === 'actualización' || valor === 'update' || valor === 'actualizacion_sgc') {
        return 'actualizacion';
    }
    return TIPO_VALORES.has(valor) ? valor : '';
}

function extensionPorMime(mime) {
    const valor = String(mime || '').toLowerCase();
    if (valor === 'image/png') return '.png';
    if (valor === 'image/webp') return '.webp';
    return '.jpg';
}

function parseDescripcionesEvidencia(raw, count) {
    let arr = [];
    if (Array.isArray(raw)) {
        arr = raw;
    } else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            arr = Array.isArray(parsed) ? parsed : [raw];
        } catch (_e) {
            arr = [raw];
        }
    }
    return Array.from({ length: count }, (_, i) => normalizarTexto(arr[i], 500));
}

function esErrorColumnaYaExiste(err) {
    return err?.code === 'ER_DUP_FIELDNAME'
        || err?.errno === 1060
        || String(err?.message || '').toLowerCase().includes('duplicate column');
}

function esErrorIndiceYaExiste(err) {
    return err?.code === 'ER_DUP_KEYNAME'
        || err?.errno === 1061
        || String(err?.message || '').toLowerCase().includes('duplicate key');
}

async function columnasDeTabla(pool, tabla) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME AS nombre
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabla]
    );
    return new Set((rows || []).map((r) => String(r.nombre || '')));
}

async function ejecutarAlterTickets(pool, sql) {
    try {
        await pool.query(sql);
        return;
    } catch (err) {
        const msg = String(err?.message || '').toLowerCase();
        if (!msg.includes('invalid default value')) {
            throw err;
        }
        await pool.query(`
            ALTER TABLE tickets
              MODIFY created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
              MODIFY updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);
        await pool.query(sql);
    }
}

async function asegurarColumnaTickets(pool, columnas, nombre, ddl, afterCol) {
    if (columnas.has(nombre)) return;
    const after = afterCol && columnas.has(afterCol) ? ` AFTER ${afterCol}` : '';
    try {
        await ejecutarAlterTickets(pool, `ALTER TABLE tickets ADD COLUMN ${ddl}${after}`);
        columnas.add(nombre);
        console.log(`[tickets] Columna ${nombre} agregada`);
        return;
    } catch (err) {
        if (esErrorColumnaYaExiste(err)) {
            columnas.add(nombre);
            return;
        }
        if (after) {
            try {
                await ejecutarAlterTickets(pool, `ALTER TABLE tickets ADD COLUMN ${ddl}`);
                columnas.add(nombre);
                console.log(`[tickets] Columna ${nombre} agregada`);
                return;
            } catch (err2) {
                if (esErrorColumnaYaExiste(err2)) {
                    columnas.add(nombre);
                    return;
                }
                throw err2;
            }
        }
        throw err;
    }
}

async function asegurarIndiceTickets(pool, nombre, columnasSql) {
    try {
        await pool.query(`CREATE INDEX ${nombre} ON tickets (${columnasSql})`);
    } catch (err) {
        if (!esErrorIndiceYaExiste(err)) {
            console.warn(`[tickets] No se pudo crear índice ${nombre}:`, err.message);
        }
    }
}

let tablaAsegurada = false;

async function asegurarTabla(pool) {
    if (tablaAsegurada) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tickets (
            ticket_id INT AUTO_INCREMENT PRIMARY KEY,
            area VARCHAR(100) NOT NULL,
            descripcion TEXT NOT NULL,
            usuario_id INT NOT NULL,
            estado ENUM('abierto','en_progreso','cerrado') NOT NULL DEFAULT 'abierto',
            prioridad ENUM('critica','urgente','prioritaria','normal','no_prioritaria') NOT NULL DEFAULT 'normal',
            tipo ENUM('falla','sugerencia') NOT NULL DEFAULT 'sugerencia',
            publicado_version VARCHAR(32) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_tickets_estado (estado),
            INDEX idx_tickets_prioridad (prioridad),
            INDEX idx_tickets_tipo (tipo),
            INDEX idx_tickets_usuario (usuario_id),
            INDEX idx_tickets_created (created_at),
            INDEX idx_tickets_publicado (publicado_version)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const columnas = await columnasDeTabla(pool, 'tickets');
    await asegurarColumnaTickets(
        pool,
        columnas,
        'publicado_version',
        'publicado_version VARCHAR(32) DEFAULT NULL',
        'estado'
    );
    await asegurarColumnaTickets(
        pool,
        columnas,
        'prioridad',
        "prioridad ENUM('critica','urgente','prioritaria','normal','no_prioritaria') NOT NULL DEFAULT 'normal'",
        'estado'
    );
    await asegurarColumnaTickets(
        pool,
        columnas,
        'tipo',
        "tipo ENUM('falla','sugerencia') NOT NULL DEFAULT 'sugerencia'",
        'prioridad'
    );
    try {
        await pool.query(
            `ALTER TABLE tickets
             MODIFY COLUMN tipo ENUM('falla','sugerencia','actualizacion') NOT NULL DEFAULT 'sugerencia'`
        );
    } catch (err) {
        console.warn('[tickets] ALTER tipo actualizacion:', err.message);
    }
    await asegurarIndiceTickets(pool, 'idx_tickets_tipo', 'tipo');
    await asegurarIndiceTickets(pool, 'idx_tickets_prioridad', 'prioridad');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ticket_evidencias (
            evidencia_id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id INT NOT NULL,
            filename VARCHAR(255) NOT NULL,
            mime VARCHAR(80) NOT NULL,
            descripcion VARCHAR(500) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ticket_evidencias_ticket (ticket_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const colsEvidencia = await columnasDeTabla(pool, 'ticket_evidencias');
    if (!colsEvidencia.has('descripcion')) {
        try {
            const after = colsEvidencia.has('mime') ? ' AFTER mime' : '';
            await pool.query(
                `ALTER TABLE ticket_evidencias ADD COLUMN descripcion VARCHAR(500) DEFAULT NULL${after}`
            );
            console.log('[tickets] Columna ticket_evidencias.descripcion agregada');
        } catch (err) {
            if (!esErrorColumnaYaExiste(err)) {
                throw err;
            }
        }
    }
    if (!colsEvidencia.has('drive_file_id')) {
        try {
            const after = colsEvidencia.has('filename') ? ' AFTER filename' : '';
            await pool.query(
                `ALTER TABLE ticket_evidencias ADD COLUMN drive_file_id VARCHAR(128) DEFAULT NULL${after}`
            );
            console.log('[tickets] Columna ticket_evidencias.drive_file_id agregada');
        } catch (err) {
            if (!esErrorColumnaYaExiste(err)) {
                throw err;
            }
        }
    }

    if (!fs.existsSync(EVIDENCIAS_DIR)) {
        fs.mkdirSync(EVIDENCIAS_DIR, { recursive: true });
    }

    tablaAsegurada = true;
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
             VALUES (?, 'info', 'fa-ticket-alt', ?, ?, ?)`,
            [usuarioId, titulo, mensaje, ruta || '/tickets']
        );
    }
    return ids.length;
}

async function carpetaEvidenciasTicket(ticketId) {
    if (!TICKETS_EVIDENCIAS_DRIVE_FOLDER_ID) {
        const error = new Error('No está configurada la carpeta de evidencias en Drive');
        error.status = 500;
        throw error;
    }
    return driveService.obtenerOCrearCarpeta(
        `ticket-${ticketId}`,
        TICKETS_EVIDENCIAS_DRIVE_FOLDER_ID
    );
}

async function guardarEvidencias(pool, ticketId, archivos, descripcionesRaw) {
    const files = Array.isArray(archivos) ? archivos.filter(Boolean) : [];
    if (!files.length) return [];

    const caps = parseDescripcionesEvidencia(descripcionesRaw, files.length);
    const carpetaTicketId = await carpetaEvidenciasTicket(ticketId);

    const guardadas = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const mime = String(file.mimetype || 'image/jpeg');
        const ext = extensionPorMime(mime);
        const descripcion = caps[i] || null;
        const [evResult] = await pool.query(
            `INSERT INTO ticket_evidencias (ticket_id, filename, mime, descripcion)
             VALUES (?, '', ?, ?)`,
            [ticketId, mime, descripcion]
        );
        const evidenciaId = evResult.insertId;
        const filename = `ticket-${ticketId}_ev-${evidenciaId}${ext}`;

        let driveFileId = null;
        try {
            const subido = await driveService.subirArchivoNuevo(
                file.buffer,
                filename,
                mime,
                carpetaTicketId
            );
            driveFileId = subido?.id || null;
        } catch (err) {
            console.error(
                `[tickets] Drive falló para evidencia ${evidenciaId}; se usa disco local:`,
                err.message
            );
            const destDir = path.join(EVIDENCIAS_DIR, String(ticketId));
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.writeFileSync(path.join(destDir, `${evidenciaId}${ext}`), file.buffer);
        }

        const filenameDb = driveFileId ? filename : `${evidenciaId}${ext}`;
        await pool.query(
            `UPDATE ticket_evidencias
             SET filename = ?, drive_file_id = ?
             WHERE evidencia_id = ?`,
            [filenameDb, driveFileId, evidenciaId]
        );
        guardadas.push({
            evidencia_id: evidenciaId,
            descripcion,
            mime,
            drive_file_id: driveFileId
        });
    }
    return guardadas;
}

async function listarEvidenciasMap(pool, ticketIds) {
    const ids = (ticketIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) return {};
    const [rows] = await pool.query(
        `SELECT evidencia_id, ticket_id, descripcion, mime
         FROM ticket_evidencias
         WHERE ticket_id IN (?)
         ORDER BY evidencia_id ASC`,
        [ids]
    );
    const map = {};
    for (const row of rows || []) {
        const tid = Number(row.ticket_id);
        if (!map[tid]) map[tid] = [];
        map[tid].push({
            evidencia_id: Number(row.evidencia_id),
            descripcion: row.descripcion || '',
            mime: row.mime
        });
    }
    return map;
}

async function crear(pool, { area, descripcion, prioridad, tipo, usuarioId, evidencias, evidenciaDescripciones }) {
    await asegurarTabla(pool);
    const areaLimpia = normalizarArea(area);
    const descripcionLimpia = normalizarTexto(descripcion, 2000);
    const prioridadLimpia = normalizarPrioridad(prioridad) || 'normal';
    const tipoLimpio = normalizarTipo(tipo);
    if (!areaLimpia) {
        const error = new Error('Selecciona un área válida');
        error.status = 400;
        throw error;
    }
    if (!tipoLimpio) {
        const error = new Error('Selecciona si es una falla, sugerencia o actualización');
        error.status = 400;
        throw error;
    }
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

    const [result] = await pool.query(
        `INSERT INTO tickets (area, descripcion, usuario_id, estado, prioridad, tipo, publicado_version)
         VALUES (?, ?, ?, 'abierto', ?, ?, NULL)`,
        [areaLimpia, descripcionLimpia, usuarioId, prioridadLimpia, tipoLimpio]
    );

    const ticketId = result.insertId;
    let evidenciasGuardadas = [];
    try {
        evidenciasGuardadas = await guardarEvidencias(
            pool,
            ticketId,
            evidencias,
            evidenciaDescripciones
        );
    } catch (err) {
        console.error('[tickets] No se pudieron guardar evidencias:', err.message);
    }

    const tipoLabel = tipoLimpio === 'falla'
        ? 'Falla'
        : (tipoLimpio === 'actualizacion' ? 'Actualización' : 'Sugerencia');
    const resumen = descripcionLimpia.length > 90
        ? `${descripcionLimpia.slice(0, 87)}…`
        : descripcionLimpia;

    await notificarRoots(pool, {
        titulo: `${tipoLabel} · ${areaLimpia}`,
        mensaje: resumen,
        ruta: '/tickets'
    });

    return {
        ticket_id: ticketId,
        area: areaLimpia,
        descripcion: descripcionLimpia,
        usuario_id: usuarioId,
        estado: 'abierto',
        prioridad: prioridadLimpia,
        tipo: tipoLimpio,
        publicado_version: null,
        evidencias: evidenciasGuardadas
    };
}

const DIAS_CERRADOS_VISIBLES = 3;

async function listar(pool, {
    estado,
    ciclo,
    incluirCerradosRecientes = false,
    ocultarCerradosAntiguos = false,
    usuarioId = null
} = {}) {
    await asegurarTabla(pool);
    const estadoFiltro = normalizarEstado(estado);
    const params = [];
    const clauses = [];

    const uid = Number(usuarioId);
    if (Number.isFinite(uid) && uid > 0) {
        clauses.push('t.usuario_id = ?');
        params.push(uid);
    }

    if (estadoFiltro) {
        clauses.push('t.estado = ?');
        params.push(estadoFiltro);
    }

    // "Realizados" (cerrado): siempre todos, sin filtrar por ciclo de deploy.
    const ignorarCiclo = estadoFiltro === 'cerrado';

    if (!ignorarCiclo) {
        if (ciclo === 'pendiente') {
            if (incluirCerradosRecientes) {
                // Activos del ciclo + cerrados por admin en los últimos N días.
                clauses.push(`(
                    t.publicado_version IS NULL
                    OR (
                        t.estado = 'cerrado'
                        AND t.updated_at >= DATE_SUB(NOW(), INTERVAL ${DIAS_CERRADOS_VISIBLES} DAY)
                    )
                )`);
            } else {
                clauses.push('t.publicado_version IS NULL');
            }
        } else if (ciclo === 'publicado') {
            clauses.push('t.publicado_version IS NOT NULL');
        }
    }

    if (ocultarCerradosAntiguos) {
        clauses.push(`(
            t.estado != 'cerrado'
            OR t.updated_at >= DATE_SUB(NOW(), INTERVAL ${DIAS_CERRADOS_VISIBLES} DAY)
        )`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
        `SELECT
            t.ticket_id,
            t.area,
            t.descripcion,
            t.usuario_id,
            t.estado,
            t.prioridad,
            t.tipo,
            t.publicado_version,
            t.created_at,
            t.updated_at,
            TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellido, ''))) AS autor_nombre,
            u.username AS autor_usuario
         FROM tickets t
         LEFT JOIN usuario u ON u.id = t.usuario_id
         ${where}
         ORDER BY
            CASE WHEN t.publicado_version IS NULL THEN 0 ELSE 1 END,
            CASE t.estado
                WHEN 'abierto' THEN 1
                WHEN 'en_progreso' THEN 2
                ELSE 3
            END,
            CASE t.prioridad
                WHEN 'critica' THEN 1
                WHEN 'urgente' THEN 2
                WHEN 'prioritaria' THEN 3
                WHEN 'normal' THEN 4
                ELSE 5
            END,
            t.updated_at DESC,
            t.created_at DESC`,
        params
    );
    const tickets = rows || [];
    let evidenciasMap = {};
    try {
        evidenciasMap = await listarEvidenciasMap(
            pool,
            tickets.map((t) => t.ticket_id)
        );
    } catch (_e) {
        evidenciasMap = {};
    }
    return tickets.map((t) => ({
        ...t,
        tipo: t.tipo || 'sugerencia',
        evidencias: evidenciasMap[Number(t.ticket_id)] || []
    }));
}

async function actualizarEstado(pool, ticketId, estado) {
    await asegurarTabla(pool);
    const id = Number(ticketId);
    const estadoLimpio = normalizarEstado(estado);
    if (!Number.isFinite(id) || id <= 0) {
        const error = new Error('Ticket inválido');
        error.status = 400;
        throw error;
    }
    if (!estadoLimpio) {
        const error = new Error('Estado inválido');
        error.status = 400;
        throw error;
    }

    const [result] = await pool.query(
        `UPDATE tickets SET estado = ? WHERE ticket_id = ?`,
        [estadoLimpio, id]
    );
    if (!result.affectedRows) {
        const error = new Error('Ticket no encontrado');
        error.status = 404;
        throw error;
    }
    return { ticket_id: id, estado: estadoLimpio };
}

async function obtenerPorId(pool, ticketId) {
    await asegurarTabla(pool);
    const id = Number(ticketId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const [rows] = await pool.query(
        `SELECT ticket_id, usuario_id, area, estado, tipo
         FROM tickets WHERE ticket_id = ? LIMIT 1`,
        [id]
    );
    return rows && rows[0] ? rows[0] : null;
}

async function obtenerArchivoEvidencia(pool, ticketId, evidenciaId) {
    const tid = Number(ticketId);
    const eid = Number(evidenciaId);
    if (!Number.isFinite(tid) || tid <= 0 || !Number.isFinite(eid) || eid <= 0) {
        const error = new Error('Evidencia inválida');
        error.status = 400;
        throw error;
    }
    const [rows] = await pool.query(
        `SELECT evidencia_id, ticket_id, filename, mime, drive_file_id
         FROM ticket_evidencias
         WHERE evidencia_id = ? AND ticket_id = ?
         LIMIT 1`,
        [eid, tid]
    );
    const row = rows && rows[0];
    if (!row) {
        const error = new Error('Evidencia no encontrada');
        error.status = 404;
        throw error;
    }

    const mime = row.mime || 'image/jpeg';
    const filename = row.filename || `evidencia-${eid}`;
    const driveFileId = String(row.drive_file_id || '').trim();

    if (driveFileId) {
        try {
            const buffer = await driveService.descargarArchivo(driveFileId);
            return { buffer, mime, filename, driveFileId };
        } catch (err) {
            const error = new Error('Archivo de evidencia no encontrado en Drive');
            error.status = 404;
            error.cause = err;
            throw error;
        }
    }

    if (!row.filename) {
        const error = new Error('Evidencia no encontrada');
        error.status = 404;
        throw error;
    }

    const filePath = path.join(EVIDENCIAS_DIR, String(tid), String(row.filename));
    if (!fs.existsSync(filePath)) {
        const error = new Error('Archivo de evidencia no encontrado');
        error.status = 404;
        throw error;
    }
    return {
        path: filePath,
        buffer: fs.readFileSync(filePath),
        mime,
        filename
    };
}

function leerNotasArchivo() {
    try {
        if (!fs.existsSync(NOTAS_PATH)) {
            return { activo: true, borrador: [], historial: [] };
        }
        const parsed = JSON.parse(fs.readFileSync(NOTAS_PATH, 'utf8'));
        return {
            activo: true,
            borrador: Array.isArray(parsed.borrador) ? parsed.borrador : [],
            historial: Array.isArray(parsed.historial) ? parsed.historial : []
        };
    } catch (_e) {
        return { activo: true, borrador: [], historial: [] };
    }
}

function escribirNotasArchivo(data) {
    const dir = path.dirname(NOTAS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
        NOTAS_PATH,
        JSON.stringify({
            activo: true,
            borrador: data.borrador || [],
            historial: data.historial || []
        }, null, 2) + '\n',
        'utf8'
    );
}

function fechaTicketLabel(valor) {
    const d = valor ? new Date(valor) : new Date();
    if (Number.isNaN(d.getTime())) {
        return new Date().toISOString().slice(0, 10);
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Antes de empaquetar backend: pasa tickets pendientes al historial de novedades
 * (archivo) para que viajen a producción. No marca aún la BD.
 */
async function prepararCicloEnArchivo(pool, version) {
    await asegurarTabla(pool);
    const versionLimpia = String(version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(versionLimpia)) {
        throw new Error('Versión inválida para publicar tickets');
    }

    const pendientes = await listar(pool, { ciclo: 'pendiente' });
    if (!pendientes.length) {
        return { preparados: 0, version: versionLimpia };
    }

    const notas = pendientes.map((t) => {
        const area = String(t.area || '').trim() || 'General';
        const desc = String(t.descripcion || '').trim();
        const fechaPedido = fechaTicketLabel(t.created_at);
        const fechaModificacion = fechaTicketLabel(t.updated_at || t.created_at);
        const fechaPedidoUi = (() => {
            const [y, m, d] = fechaPedido.split('-');
            return y && m && d ? `${d}/${m}/${y}` : fechaPedido;
        })();
        return {
            id: `ticket-${t.ticket_id}`,
            titulo: `(${area}) Ticket ${fechaPedidoUi}`,
            descripcion: desc,
            icono: 'fa-ticket-alt',
            area,
            fecha: fechaModificacion,
            fechaModificacion,
            fechaPedido
        };
    });

    const data = leerNotasArchivo();
    const fecha = new Date().toISOString().slice(0, 10);
    const existente = data.historial.find((h) => h.version === versionLimpia);
    if (existente) {
        const ids = new Set((existente.notas || []).map((n) => n.id));
        const nuevas = notas.filter((n) => !ids.has(n.id));
        existente.notas = [...nuevas, ...(existente.notas || [])];
        existente.fecha = fecha;
    } else {
        data.historial.unshift({
            version: versionLimpia,
            fecha,
            notas
        });
    }
    data.borrador = [];
    data.activo = true;
    escribirNotasArchivo(data);

    return { preparados: pendientes.length, version: versionLimpia };
}

/**
 * Tras deploy exitoso: marca tickets como publicados y limpia notificaciones
 * de aportaciones para reiniciar el ciclo.
 * No modifica el estatus (abierto / en_progreso / cerrado): solo lo cambia el admin.
 */
async function finalizarCiclo(pool, version) {
    await asegurarTabla(pool);
    const versionLimpia = String(version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(versionLimpia)) {
        throw new Error('Versión inválida para finalizar ciclo de tickets');
    }

    const [result] = await pool.query(
        `UPDATE tickets
         SET publicado_version = ?
         WHERE publicado_version IS NULL`,
        [versionLimpia]
    );

    const [notif] = await pool.query(
        `DELETE FROM notificacion_usuario
         WHERE ruta = '/tickets'
            OR titulo LIKE 'Nueva aportación%'`
    );

    return {
        version: versionLimpia,
        ticketsPublicados: result.affectedRows || 0,
        notificacionesEliminadas: notif.affectedRows || 0
    };
}

module.exports = {
    AREAS,
    PRIORIDADES,
    TIPOS,
    NOTAS_PATH,
    EVIDENCIAS_DIR,
    TICKETS_EVIDENCIAS_DRIVE_FOLDER_ID,
    asegurarTabla,
    crear,
    listar,
    actualizarEstado,
    obtenerPorId,
    obtenerArchivoEvidencia,
    prepararCicloEnArchivo,
    finalizarCiclo
};
