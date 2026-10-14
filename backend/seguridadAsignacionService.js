// =====================================================
// BIZNAGA R&T — Seguridad · Asignación y gestión de normativas por empresa
// Borrador persistente, un responsable por norma y evidencias por punto
// Evidencias → Drive: Sistema / {Empresa} / Normativas {Año} / {NOM} / {Punto}
// =====================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatearPuntoNorma, contextoUsuario } = require('./seguridadNormativasService');
const driveService = require('./driveService');

const MAX_NORMAS = 80;
const MAX_PUNTOS_NORMA = 8000;
const MAX_EMPLEADOS = 1;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads', 'seguridad-asignacion');
/** Carpeta raíz «Sistema» en Drive (evidencias de gestión de normativas). */
const CARPETA_SISTEMA_DRIVE_ID = '1Jq-rhvJByXIhN0xclZVfmGmlbd8t073y';

const CATEGORIAS_META = {
    'nom-001-010': { prefijo: '001–010', titulo: 'Instalaciones y materiales', descripcion: 'Edificios, incendio, maquinaria, sustancias.' },
    'nom-011-020': { prefijo: '011–020', titulo: 'Agentes y organización', descripcion: 'Ruido, radiaciones, EPP, químicos.' },
    'nom-021-030': { prefijo: '021–030', titulo: 'Electricidad y procesos', descripcion: 'Electricidad, iluminación, soldadura.' },
    'nom-031-040': { prefijo: '031–040', titulo: 'Construcción y factores humanos', descripcion: 'Construcción, espacios confinados, ergonomía.' },
    otras: { prefijo: 'OTRAS', titulo: 'Otras normativas', descripcion: 'Normas de otras dependencias.' }
};

let tablasPromise = null;

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function entero(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function rolesUsuario(usuario) {
    if (Array.isArray(usuario?.roles)) {
        return usuario.roles.map((r) => String(r || '').toLowerCase().trim()).filter(Boolean);
    }
    if (usuario?.rol) return [String(usuario.rol).toLowerCase().trim()].filter(Boolean);
    return [];
}

/** root / administrador ven todas las asignaciones; el resto solo las propias. */
function esAdminSeguridad(usuario) {
    const roles = rolesUsuario(usuario);
    return roles.includes('root')
        || roles.includes('administrador')
        || roles.includes('super_admin')
        || roles.includes('superadmin');
}

function idUsuarioSeguridad(usuario) {
    return entero(usuario?.id || usuario?.usuario_id);
}

/**
 * Opciones de alcance para listados de gestión.
 * @returns {{ empleadoId: number|null }} empleadoId null = sin filtro (admin o sin usuario).
 */
function alcanceGestion(usuario) {
    if (!usuario || esAdminSeguridad(usuario)) return { empleadoId: null };
    return { empleadoId: idUsuarioSeguridad(usuario) };
}

async function assertAccesoAsignacion(pool, asignacionId, usuario) {
    if (esAdminSeguridad(usuario)) return;
    const uid = idUsuarioSeguridad(usuario);
    if (!uid) throw httpError(403, 'No tiene esta normativa asignada.');
    const [rows] = await pool.query(
        `SELECT 1 FROM seg_asignacion_responsable
         WHERE asignacion_id = ? AND empleado_id = ? LIMIT 1`,
        [asignacionId, uid]
    );
    if (!rows.length) throw httpError(403, 'No tiene esta normativa asignada.');
}

function aIso(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sanitizarPayload(raw) {
    const origen = raw && typeof raw === 'object' ? raw : {};
    const paso = Math.max(0, Math.min(4, parseInt(origen.paso, 10) || 0));
    const vista = origen.vista === 'compacta' ? 'compacta' : '';
    const lista = Array.isArray(origen.normas) ? origen.normas.slice(0, MAX_NORMAS) : [];
    const vistas = new Set();
    const normas = [];

    for (const item of lista) {
        const normativaId = entero(item?.normativa_id);
        if (!normativaId || vistas.has(normativaId)) continue;
        vistas.add(normativaId);

        const empleadosVistos = new Set();
        const empleados = [];
        const fuenteEmp = Array.isArray(item.empleados) ? item.empleados : [];
        for (const emp of fuenteEmp) {
            if (empleados.length >= MAX_EMPLEADOS) break;
            const empleadoId = entero(emp?.empleado_id);
            if (!empleadoId || empleadosVistos.has(empleadoId)) continue;
            empleadosVistos.add(empleadoId);
            const nombre = String(emp?.nombre || '').trim().slice(0, 200);
            empleados.push({
                empleado_id: empleadoId,
                nombre,
                puesto: String(emp?.puesto || '').trim().slice(0, 120)
            });
        }

        const puntosVistos = new Set();
        const requisitoIds = [];
        const fuentePts = Array.isArray(item.requisito_ids) ? item.requisito_ids : [];
        for (const id of fuentePts) {
            if (requisitoIds.length >= MAX_PUNTOS_NORMA) break;
            const reqId = entero(id);
            if (!reqId || puntosVistos.has(reqId)) continue;
            puntosVistos.add(reqId);
            requisitoIds.push(reqId);
        }

        const puntosAccion = [];
        const fuentePuntos = Array.isArray(item.puntos) ? item.puntos : [];
        const vistosAccion = new Set();
        for (const pto of fuentePuntos) {
            const reqId = entero(pto?.requisito_id);
            if (!reqId || vistosAccion.has(reqId) || !puntosVistos.has(reqId)) continue;
            vistosAccion.add(reqId);
            const score = normalizarAccionScore(pto?.accion_score);
            if (score == null) continue;
            puntosAccion.push({ requisito_id: reqId, accion_score: score });
        }

        normas.push({
            normativa_id: normativaId,
            empleados,
            requisito_ids: requisitoIds,
            puntos: puntosAccion
        });
    }

    return { paso, vista, normas };
}

function anioCiclo(valor) {
    const actual = new Date().getFullYear();
    const n = parseInt(valor, 10);
    if (!Number.isInteger(n) || n < 2000 || n > actual + 2) return actual;
    return n;
}

let historialSyncPromise = null;

async function asegurarTablas(pool) {
    if (!pool?.query) throw new Error('Pool de normativas no disponible');
    if (!tablasPromise) {
        tablasPromise = crearTablas(pool).catch((err) => {
            tablasPromise = null;
            throw err;
        });
    }
    await tablasPromise;
    // Una vez listas las tablas, volcar asignaciones vigentes → historial (puntos incluidos).
    if (!historialSyncPromise) {
        historialSyncPromise = sincronizarHistorialesPendientes(pool)
            .catch((err) => {
                historialSyncPromise = null;
                console.warn('[seguridad] No se pudo sincronizar historial de asignaciones:', err?.message || err);
                return null;
            });
    }
    await historialSyncPromise;
    return tablasPromise;
}

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function addColumnIfNotExists(pool, table, column, definition) {
    if (await columnExists(pool, table, column)) return;
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function crearTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_borrador (
          empresa_id INT UNSIGNED NOT NULL,
          payload LONGTEXT NOT NULL,
          actualizado_por VARCHAR(120) NULL,
          usuario_id INT UNSIGNED NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          empresa_id INT UNSIGNED NOT NULL,
          empresa_nombre VARCHAR(255) NOT NULL,
          normativa_id INT UNSIGNED NOT NULL,
          estado ENUM('activa','archivada') NOT NULL DEFAULT 'activa',
          publicado_por VARCHAR(120) NULL,
          publicado_en DATETIME NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_empresa_norma (empresa_id, normativa_id),
          KEY idx_estado (estado),
          KEY idx_empresa (empresa_id, estado),
          CONSTRAINT fk_seg_asig_normativa FOREIGN KEY (normativa_id)
            REFERENCES seg_normativa (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_responsable (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          asignacion_id INT UNSIGNED NOT NULL,
          empleado_id INT UNSIGNED NOT NULL,
          empleado_nombre VARCHAR(200) NOT NULL,
          empleado_puesto VARCHAR(120) NULL,
          orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
          PRIMARY KEY (id),
          UNIQUE KEY uk_asig_empleado (asignacion_id, empleado_id),
          KEY idx_empleado (empleado_id),
          CONSTRAINT fk_seg_resp_asig FOREIGN KEY (asignacion_id)
            REFERENCES seg_asignacion (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_punto (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          asignacion_id INT UNSIGNED NOT NULL,
          requisito_id BIGINT UNSIGNED NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uk_asig_req (asignacion_id, requisito_id),
          KEY idx_req (requisito_id),
          CONSTRAINT fk_seg_punto_asig FOREIGN KEY (asignacion_id)
            REFERENCES seg_asignacion (id) ON DELETE CASCADE,
          CONSTRAINT fk_seg_punto_req FOREIGN KEY (requisito_id)
            REFERENCES seg_normativa_requisito (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_documento (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          asignacion_id INT UNSIGNED NOT NULL,
          requisito_id BIGINT UNSIGNED NULL,
          nombre_original VARCHAR(255) NOT NULL,
          ruta_relativa VARCHAR(400) NOT NULL,
          mime VARCHAR(120) NULL,
          tamano INT UNSIGNED NOT NULL DEFAULT 0,
          subido_por VARCHAR(120) NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_doc_asig (asignacion_id),
          KEY idx_doc_req (requisito_id),
          CONSTRAINT fk_seg_doc_asig FOREIGN KEY (asignacion_id)
            REFERENCES seg_asignacion (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await addColumnIfNotExists(pool, 'seg_asignacion_documento', 'drive_file_id', 'VARCHAR(128) NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_documento', 'drive_folder_id', 'VARCHAR(128) NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_documento', 'drive_web_view_link', 'VARCHAR(512) NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_documento', 'anio', 'SMALLINT UNSIGNED NULL');

    await addColumnIfNotExists(pool, 'seg_asignacion_punto', 'accion_score', 'TINYINT UNSIGNED NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_punto', 'fecha_inicio', 'DATE NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_punto', 'indicador_avance', 'TINYINT UNSIGNED NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion_punto', 'observaciones', 'TEXT NULL');
    await addColumnIfNotExists(pool, 'seg_asignacion', 'anio_ciclo', 'SMALLINT UNSIGNED NULL');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_historial (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          empresa_id INT UNSIGNED NOT NULL,
          empresa_nombre VARCHAR(255) NOT NULL,
          anio SMALLINT UNSIGNED NOT NULL,
          total_normativas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          total_puntos INT UNSIGNED NOT NULL DEFAULT 0,
          publicado_por VARCHAR(120) NULL,
          usuario_id INT UNSIGNED NULL,
          origen ENUM('publicacion','clonacion','sincronizacion') NOT NULL DEFAULT 'publicacion',
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_hist_empresa_anio (empresa_id, anio),
          KEY idx_hist_empresa (empresa_id, anio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_historial_norma (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          historial_id INT UNSIGNED NOT NULL,
          normativa_id INT UNSIGNED NOT NULL,
          codigo VARCHAR(80) NULL,
          titulo VARCHAR(255) NULL,
          empleado_id INT UNSIGNED NULL,
          empleado_nombre VARCHAR(200) NULL,
          empleado_puesto VARCHAR(120) NULL,
          orden SMALLINT UNSIGNED NOT NULL DEFAULT 1,
          PRIMARY KEY (id),
          UNIQUE KEY uk_hist_norma (historial_id, normativa_id),
          KEY idx_hist_norma_normativa (normativa_id),
          CONSTRAINT fk_seg_hist_norma_hist FOREIGN KEY (historial_id)
            REFERENCES seg_asignacion_historial (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_asignacion_historial_punto (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          historial_norma_id BIGINT UNSIGNED NOT NULL,
          requisito_id BIGINT UNSIGNED NOT NULL,
          punto_norma VARCHAR(40) NULL,
          accion_score TINYINT UNSIGNED NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uk_hist_punto (historial_norma_id, requisito_id),
          KEY idx_hist_punto_req (requisito_id),
          CONSTRAINT fk_seg_hist_punto_norma FOREIGN KEY (historial_norma_id)
            REFERENCES seg_asignacion_historial_norma (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

const ACCION_SCORE_META = {
    100: { grupo: 'preventiva', clave: 'conservar', etiqueta: 'Conservar' },
    80: { grupo: 'preventiva', clave: 'mejorar', etiqueta: 'Mejorar' },
    60: { grupo: 'preventiva', clave: 'actualizar', etiqueta: 'Actualizar' },
    40: { grupo: 'correctiva', clave: 'complementar', etiqueta: 'Complementar' },
    20: { grupo: 'correctiva', clave: 'corregir', etiqueta: 'Corregir' },
    0: { grupo: 'correctiva', clave: 'realizar', etiqueta: 'Realizar' }
};

function accionesDesdeScore(score) {
    const vacio = {
        preventiva: { conservar: false, mejorar: false, actualizar: false },
        correctiva: { complementar: false, corregir: false, realizar: false }
    };
    if (score == null || !Object.prototype.hasOwnProperty.call(ACCION_SCORE_META, Number(score))) {
        return vacio;
    }
    const meta = ACCION_SCORE_META[Number(score)];
    vacio[meta.grupo][meta.clave] = true;
    return vacio;
}

function scoreDesdeAccionesCatalogo(row) {
    if (Number(row.accion_prev_conservar)) return 100;
    if (Number(row.accion_prev_mejorar)) return 80;
    if (Number(row.accion_prev_actualizar)) return 60;
    if (Number(row.accion_corr_complementar)) return 40;
    if (Number(row.accion_corr_corregir)) return 20;
    if (Number(row.accion_corr_realizar)) return 0;
    return null;
}

function normalizarAccionScore(valor) {
    if (valor == null || valor === '') return null;
    const n = Number(valor);
    if (![0, 20, 40, 60, 80, 100].includes(n)) {
        throw httpError(400, 'La acción debe ser 100, 80, 60, 40, 20 o 0.');
    }
    return n;
}

function normalizarFechaInicioMes(valor) {
    if (valor == null || valor === '') return null;
    const raw = String(valor).trim();
    const m = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (!m) throw httpError(400, 'La fecha de inicio debe ser mes y año (AAAA-MM).');
    const anio = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
        throw httpError(400, 'Mes o año de inicio inválido.');
    }
    return `${m[1]}-${m[2]}-01`;
}

function pct(conEvidencia, total) {
    const t = Number(total) || 0;
    if (!t) return 0;
    return Math.round(((Number(conEvidencia) || 0) / t) * 100);
}

function nombreCarpetaDrive(valor, fallback = 'Sin nombre') {
    const limpio = String(valor || '')
        .replace(/[\\/:*?"<>|#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return limpio || fallback;
}

function metaCategoria(categoriaId) {
    const id = String(categoriaId || 'otras');
    const meta = CATEGORIAS_META[id] || CATEGORIAS_META.otras;
    return { categoria_id: id, ...meta };
}

function estadoPunto(documentos) {
    const n = Array.isArray(documentos) ? documentos.length : 0;
    if (n >= 1) return 'cumple';
    return 'no_cumple';
}

/** Responsable del punto de norma: Cliente | Empresa (vacío → Empresa). */
function normalizarResponsableGestion(valor) {
    const txt = String(valor || '').trim().toLowerCase();
    if (!txt) return 'Empresa';
    if (txt === 'c' || txt === 'cliente' || /^cliente\b/.test(txt)) return 'Cliente';
    if (txt === 'e' || txt === 'empresa' || /^empresa\b/.test(txt)) return 'Empresa';
    return 'Empresa';
}

function filtrarPayloadPorEmpleado(payload, empleadoId) {
    const limpio = sanitizarPayload(payload || {});
    if (!empleadoId) return limpio;
    return {
        ...limpio,
        normas: (limpio.normas || []).filter((n) =>
            (n.empleados || []).some((e) => Number(e.empleado_id) === Number(empleadoId))
        )
    };
}

async function guardarBorrador(pool, empresaId, payload, usuario) {
    await asegurarTablas(pool);
    if (!esAdminSeguridad(usuario)) {
        throw httpError(403, 'Solo administradores pueden editar la asignación de normativas.');
    }
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Seleccione una empresa válida.');
    const limpio = sanitizarPayload(payload);
    const ctx = contextoUsuario(usuario);
    const json = JSON.stringify(limpio);
    if (json.length > 4_000_000) {
        throw httpError(400, 'El borrador es demasiado grande.');
    }
    await pool.query(
        `INSERT INTO seg_asignacion_borrador (empresa_id, payload, actualizado_por, usuario_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           payload = VALUES(payload),
           actualizado_por = VALUES(actualizado_por),
           usuario_id = VALUES(usuario_id)`,
        [id, json, ctx.nombre, ctx.usuario_id || null]
    );
    const [rows] = await pool.query(
        'SELECT updated_at, actualizado_por FROM seg_asignacion_borrador WHERE empresa_id = ? LIMIT 1',
        [id]
    );
    return {
        empresa_id: id,
        updated_at: aIso(rows[0]?.updated_at),
        actualizado_por: rows[0]?.actualizado_por || ctx.nombre
    };
}

async function eliminarBorrador(pool, empresaId) {
    await asegurarTablas(pool);
    const id = entero(empresaId);
    if (!id) return;
    await pool.query('DELETE FROM seg_asignacion_borrador WHERE empresa_id = ?', [id]);
}

function leerPayload(raw) {
    if (!raw) return { paso: 0, normas: [] };
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return sanitizarPayload(obj);
    } catch {
        return { paso: 0, normas: [] };
    }
}

async function payloadPublicado(pool, empresaId) {
    const [asigs] = await pool.query(
        `SELECT id, normativa_id FROM seg_asignacion
         WHERE empresa_id = ? AND estado = 'activa'`,
        [empresaId]
    );
    if (!asigs.length) return null;
    const ids = asigs.map((a) => a.id);
    const [resps] = await pool.query(
        `SELECT asignacion_id, empleado_id, empleado_nombre, empleado_puesto, orden
         FROM seg_asignacion_responsable
         WHERE asignacion_id IN (?)
         ORDER BY orden ASC, id ASC`,
        [ids]
    );
    const [puntos] = await pool.query(
        `SELECT asignacion_id, requisito_id, accion_score
         FROM seg_asignacion_punto WHERE asignacion_id IN (?)`,
        [ids]
    );
    const porAsigResp = new Map();
    for (const r of resps) {
        if (!porAsigResp.has(r.asignacion_id)) porAsigResp.set(r.asignacion_id, []);
        porAsigResp.get(r.asignacion_id).push({
            empleado_id: r.empleado_id,
            nombre: r.empleado_nombre,
            puesto: r.empleado_puesto || ''
        });
    }
    const porAsigPts = new Map();
    const porAsigAccion = new Map();
    for (const p of puntos) {
        if (!porAsigPts.has(p.asignacion_id)) {
            porAsigPts.set(p.asignacion_id, []);
            porAsigAccion.set(p.asignacion_id, []);
        }
        porAsigPts.get(p.asignacion_id).push(p.requisito_id);
        const score = normalizarAccionScore(p.accion_score);
        if (score != null) {
            porAsigAccion.get(p.asignacion_id).push({
                requisito_id: p.requisito_id,
                accion_score: score
            });
        }
    }
    return {
        paso: 4,
        normas: asigs.map((a) => ({
            normativa_id: a.normativa_id,
            empleados: porAsigResp.get(a.id) || [],
            requisito_ids: porAsigPts.get(a.id) || [],
            puntos: porAsigAccion.get(a.id) || []
        }))
    };
}

async function leerAsignacionesVigentesParaHistorial(db, empresaId) {
    const [asigs] = await db.query(
        `SELECT a.id, a.empresa_nombre, a.normativa_id, a.publicado_en, a.anio_ciclo,
                n.codigo, n.titulo
         FROM seg_asignacion a
         JOIN seg_normativa n ON n.id = a.normativa_id
         WHERE a.empresa_id = ? AND a.estado = 'activa'
         ORDER BY n.codigo ASC, a.id ASC`,
        [empresaId]
    );
    if (!asigs.length) return null;

    const ids = asigs.map((a) => a.id);
    const [resps] = await db.query(
        `SELECT asignacion_id, empleado_id, empleado_nombre, empleado_puesto, orden
         FROM seg_asignacion_responsable
         WHERE asignacion_id IN (?)
         ORDER BY orden ASC, id ASC`,
        [ids]
    );
    const [puntos] = await db.query(
        `SELECT p.asignacion_id, p.requisito_id, p.accion_score, r.punto_norma
         FROM seg_asignacion_punto p
         LEFT JOIN seg_normativa_requisito r ON r.id = p.requisito_id
         WHERE p.asignacion_id IN (?)`,
        [ids]
    );

    const porResp = new Map();
    for (const r of resps) {
        if (!porResp.has(r.asignacion_id)) porResp.set(r.asignacion_id, []);
        porResp.get(r.asignacion_id).push(r);
    }
    const porPts = new Map();
    for (const p of puntos) {
        if (!porPts.has(p.asignacion_id)) porPts.set(p.asignacion_id, []);
        porPts.get(p.asignacion_id).push(p);
    }

    return asigs.map((a) => ({
        ...a,
        responsables: porResp.get(a.id) || [],
        puntos: porPts.get(a.id) || []
    }));
}

async function upsertSnapshotHistorial(db, {
    empresaId,
    empresaNombre,
    anio,
    usuario,
    origen = 'publicacion',
    filas = null
}) {
    const vigentes = filas || await leerAsignacionesVigentesParaHistorial(db, empresaId);
    if (!vigentes || !vigentes.length) return null;

    const totalNormativas = vigentes.length;
    const totalPuntos = vigentes.reduce((sum, a) => sum + (a.puntos?.length || 0), 0);
    const ctx = contextoUsuario(usuario);
    const nombreEmpresa = String(empresaNombre || vigentes[0].empresa_nombre || '').trim().slice(0, 255);

    const [existentes] = await db.query(
        `SELECT id FROM seg_asignacion_historial WHERE empresa_id = ? AND anio = ? LIMIT 1`,
        [empresaId, anio]
    );

    let historialId;
    if (existentes.length) {
        historialId = existentes[0].id;
        await db.query(
            `UPDATE seg_asignacion_historial
             SET empresa_nombre = ?, total_normativas = ?, total_puntos = ?,
                 publicado_por = ?, usuario_id = ?, origen = ?
             WHERE id = ?`,
            [nombreEmpresa, totalNormativas, totalPuntos, ctx.nombre, ctx.usuario_id || null, origen, historialId]
        );
        await db.query('DELETE FROM seg_asignacion_historial_norma WHERE historial_id = ?', [historialId]);
    } else {
        const [ins] = await db.query(
            `INSERT INTO seg_asignacion_historial
             (empresa_id, empresa_nombre, anio, total_normativas, total_puntos,
              publicado_por, usuario_id, origen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [empresaId, nombreEmpresa, anio, totalNormativas, totalPuntos, ctx.nombre, ctx.usuario_id || null, origen]
        );
        historialId = ins.insertId;
    }

    let orden = 1;
    for (const asig of vigentes) {
        const resp = asig.responsables[0] || null;
        const [insNorma] = await db.query(
            `INSERT INTO seg_asignacion_historial_norma
             (historial_id, normativa_id, codigo, titulo, empleado_id, empleado_nombre, empleado_puesto, orden)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                historialId,
                asig.normativa_id,
                String(asig.codigo || '').slice(0, 80) || null,
                String(asig.titulo || '').slice(0, 255) || null,
                resp?.empleado_id || null,
                resp ? String(resp.empleado_nombre || '').slice(0, 200) : null,
                resp ? String(resp.empleado_puesto || '').slice(0, 120) : null,
                orden++
            ]
        );
        const historialNormaId = insNorma.insertId;
        if (!asig.puntos?.length) continue;
        const valores = asig.puntos.map((p) => [
            historialNormaId,
            p.requisito_id,
            formatearPuntoNorma(p.punto_norma) || null,
            normalizarAccionScore(p.accion_score)
        ]);
        await db.query(
            `INSERT INTO seg_asignacion_historial_punto
             (historial_norma_id, requisito_id, punto_norma, accion_score)
             VALUES ?`,
            [valores]
        );
    }

    return {
        id: historialId,
        empresa_id: empresaId,
        anio,
        total_normativas: totalNormativas,
        total_puntos: totalPuntos
    };
}

async function mapHistorialDetalle(pool, historialRow) {
    if (!historialRow) return null;
    const historialId = historialRow.id;
    const [normas] = await pool.query(
        `SELECT id, normativa_id, codigo, titulo, empleado_id, empleado_nombre, empleado_puesto, orden
         FROM seg_asignacion_historial_norma
         WHERE historial_id = ?
         ORDER BY orden ASC, id ASC`,
        [historialId]
    );
    const normaIds = normas.map((n) => n.id);
    const porPuntos = new Map();
    if (normaIds.length) {
        const [puntos] = await pool.query(
            `SELECT historial_norma_id, requisito_id, punto_norma, accion_score
             FROM seg_asignacion_historial_punto
             WHERE historial_norma_id IN (?)`,
            [normaIds]
        );
        for (const p of puntos) {
            if (!porPuntos.has(p.historial_norma_id)) porPuntos.set(p.historial_norma_id, []);
            porPuntos.get(p.historial_norma_id).push({
                requisito_id: p.requisito_id,
                punto_norma: p.punto_norma || null,
                accion_score: normalizarAccionScore(p.accion_score)
            });
        }
    }

    const payloadNormas = normas.map((n) => {
        const pts = porPuntos.get(n.id) || [];
        const empleados = n.empleado_id
            ? [{
                empleado_id: n.empleado_id,
                nombre: n.empleado_nombre || `Usuario ${n.empleado_id}`,
                puesto: n.empleado_puesto || ''
            }]
            : [];
        return {
            normativa_id: n.normativa_id,
            codigo: n.codigo || null,
            titulo: n.titulo || null,
            empleados,
            requisito_ids: pts.map((p) => p.requisito_id),
            puntos: pts
                .filter((p) => p.accion_score != null)
                .map((p) => ({ requisito_id: p.requisito_id, accion_score: p.accion_score }))
        };
    });

    return {
        id: historialId,
        empresa_id: historialRow.empresa_id,
        empresa_nombre: historialRow.empresa_nombre,
        anio: historialRow.anio,
        total_normativas: Number(historialRow.total_normativas) || payloadNormas.length,
        total_puntos: Number(historialRow.total_puntos)
            || payloadNormas.reduce((s, n) => s + n.requisito_ids.length, 0),
        publicado_por: historialRow.publicado_por || null,
        origen: historialRow.origen || 'publicacion',
        creado_en: aIso(historialRow.creado_en),
        actualizado_en: aIso(historialRow.actualizado_en),
        normas_resumen: payloadNormas.map((n) => ({
            normativa_id: n.normativa_id,
            codigo: n.codigo,
            titulo: n.titulo,
            puntos: n.requisito_ids.length,
            responsable: n.empleados[0]?.nombre || null
        })),
        payload: {
            paso: 2,
            vista: 'compacta',
            normas: payloadNormas.map((n) => ({
                normativa_id: n.normativa_id,
                empleados: n.empleados,
                requisito_ids: n.requisito_ids,
                puntos: n.puntos
            }))
        }
    };
}

async function obtenerHistorialAnio(pool, empresaId, anio) {
    const [rows] = await pool.query(
        `SELECT id, empresa_id, empresa_nombre, anio, total_normativas, total_puntos,
                publicado_por, origen, creado_en, actualizado_en
         FROM seg_asignacion_historial
         WHERE empresa_id = ? AND anio = ?
         LIMIT 1`,
        [empresaId, anio]
    );
    if (!rows.length) return null;
    return mapHistorialDetalle(pool, rows[0]);
}

async function obtenerHistorialPrevio(pool, empresaId, anioActual) {
    const [rows] = await pool.query(
        `SELECT id, empresa_id, empresa_nombre, anio, total_normativas, total_puntos,
                publicado_por, origen, creado_en, actualizado_en
         FROM seg_asignacion_historial
         WHERE empresa_id = ? AND anio < ?
         ORDER BY anio DESC
         LIMIT 1`,
        [empresaId, anioActual]
    );
    if (!rows.length) return null;
    return mapHistorialDetalle(pool, rows[0]);
}

async function resolverAnioVigenteEmpresa(db, empresaId, vigentes = null) {
    const filas = vigentes || await leerAsignacionesVigentesParaHistorial(db, empresaId);
    if (!filas?.length) return anioCiclo();
    const conCiclo = filas.find((a) => a.anio_ciclo);
    if (conCiclo?.anio_ciclo) return anioCiclo(conCiclo.anio_ciclo);

    const [pubRows] = await db.query(
        `SELECT MAX(publicado_en) AS ultima
         FROM seg_asignacion
         WHERE empresa_id = ? AND estado = 'activa'`,
        [empresaId]
    );
    const ultima = pubRows[0]?.ultima ? new Date(pubRows[0].ultima) : null;
    if (ultima && !Number.isNaN(ultima.getTime())) {
        return anioCiclo(ultima.getFullYear());
    }
    return anioCiclo();
}

/**
 * Vuelca a historial todas las asignaciones activas (normas + puntos + nivel de acción)
 * cuando aún no hay snapshot o el conteo de puntos no coincide.
 */
async function sincronizarHistorialesPendientes(pool) {
    if (!pool?.query) return { empresas: 0, sincronizadas: 0 };
    const [empresas] = await pool.query(
        `SELECT DISTINCT empresa_id, empresa_nombre
         FROM seg_asignacion
         WHERE estado = 'activa'
         ORDER BY empresa_id ASC`
    );
    let sincronizadas = 0;
    for (const emp of empresas) {
        const empresaId = Number(emp.empresa_id);
        const vigentes = await leerAsignacionesVigentesParaHistorial(pool, empresaId);
        if (!vigentes?.length) continue;

        const totalNormas = vigentes.length;
        const totalPuntos = vigentes.reduce((sum, a) => sum + (a.puntos?.length || 0), 0);
        const anio = await resolverAnioVigenteEmpresa(pool, empresaId, vigentes);

        const [hist] = await pool.query(
            `SELECT h.id, h.total_normativas, h.total_puntos,
                    (SELECT COUNT(*)
                     FROM seg_asignacion_historial_norma hn
                     WHERE hn.historial_id = h.id) AS normas_reales,
                    (SELECT COUNT(*)
                     FROM seg_asignacion_historial_punto hp
                     JOIN seg_asignacion_historial_norma hn ON hn.id = hp.historial_norma_id
                     WHERE hn.historial_id = h.id) AS puntos_reales
             FROM seg_asignacion_historial h
             WHERE h.empresa_id = ? AND h.anio = ?
             LIMIT 1`,
            [empresaId, anio]
        );

        const desfasado = !hist.length
            || Number(hist[0].normas_reales) !== totalNormas
            || Number(hist[0].puntos_reales) !== totalPuntos
            || Number(hist[0].total_normativas) !== totalNormas
            || Number(hist[0].total_puntos) !== totalPuntos;

        if (!desfasado) continue;

        await upsertSnapshotHistorial(pool, {
            empresaId,
            empresaNombre: emp.empresa_nombre,
            anio,
            usuario: { nombre: 'sistema', id: null },
            origen: 'sincronizacion',
            filas: vigentes
        });
        await pool.query(
            `UPDATE seg_asignacion SET anio_ciclo = COALESCE(anio_ciclo, ?)
             WHERE empresa_id = ? AND estado = 'activa'`,
            [anio, empresaId]
        );
        sincronizadas += 1;
    }
    if (sincronizadas > 0) {
        console.log(`[seguridad] Historial de asignación sincronizado: ${sincronizadas} empresa(s), puntos vigentes guardados.`);
    }
    return { empresas: empresas.length, sincronizadas };
}

async function listarHistorialEmpresa(pool, empresaId) {
    await asegurarTablas(pool);
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Seleccione una empresa válida.');
    const [rows] = await pool.query(
        `SELECT id, empresa_id, empresa_nombre, anio, total_normativas, total_puntos,
                publicado_por, origen, creado_en, actualizado_en
         FROM seg_asignacion_historial
         WHERE empresa_id = ?
         ORDER BY anio DESC`,
        [id]
    );
    return rows.map((r) => ({
        id: r.id,
        empresa_id: r.empresa_id,
        empresa_nombre: r.empresa_nombre,
        anio: r.anio,
        total_normativas: Number(r.total_normativas) || 0,
        total_puntos: Number(r.total_puntos) || 0,
        publicado_por: r.publicado_por || null,
        origen: r.origen || 'publicacion',
        creado_en: aIso(r.creado_en),
        actualizado_en: aIso(r.actualizado_en)
    }));
}

async function obtenerHistorialDetalle(pool, empresaId, anio) {
    await asegurarTablas(pool);
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Seleccione una empresa válida.');
    const ciclo = anioCiclo(anio);
    const detalle = await obtenerHistorialAnio(pool, id, ciclo);
    if (!detalle) throw httpError(404, `No hay asignación guardada para ${ciclo}.`);
    return detalle;
}

async function sincronizarAccionEnHistorial(pool, asignacionId, requisitoId, accionScore) {
    const [asig] = await pool.query(
        `SELECT empresa_id, empresa_nombre, normativa_id, anio_ciclo
         FROM seg_asignacion WHERE id = ? LIMIT 1`,
        [asignacionId]
    );
    if (!asig.length) return;
    const anio = anioCiclo(asig[0].anio_ciclo || new Date().getFullYear());
    let [histNorma] = await pool.query(
        `SELECT hn.id
         FROM seg_asignacion_historial_norma hn
         JOIN seg_asignacion_historial h ON h.id = hn.historial_id
         WHERE h.empresa_id = ? AND h.anio = ? AND hn.normativa_id = ?
         LIMIT 1`,
        [asig[0].empresa_id, anio, asig[0].normativa_id]
    );
    // Si el historial aún no tiene esa norma/puntos, reconstruye el snapshot completo.
    if (!histNorma.length) {
        await upsertSnapshotHistorial(pool, {
            empresaId: asig[0].empresa_id,
            empresaNombre: asig[0].empresa_nombre,
            anio,
            usuario: { nombre: 'sistema', id: null },
            origen: 'sincronizacion'
        });
        [histNorma] = await pool.query(
            `SELECT hn.id
             FROM seg_asignacion_historial_norma hn
             JOIN seg_asignacion_historial h ON h.id = hn.historial_id
             WHERE h.empresa_id = ? AND h.anio = ? AND hn.normativa_id = ?
             LIMIT 1`,
            [asig[0].empresa_id, anio, asig[0].normativa_id]
        );
    }
    if (!histNorma.length) return;
    await pool.query(
        `INSERT INTO seg_asignacion_historial_punto
         (historial_norma_id, requisito_id, accion_score)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE accion_score = VALUES(accion_score)`,
        [histNorma[0].id, requisitoId, accionScore]
    );
}

async function obtenerEstado(pool, empresaId, anioQuery, usuario = null) {
    await asegurarTablas(pool);
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Seleccione una empresa válida.');
    const anio = anioCiclo(anioQuery);
    const alcance = alcanceGestion(usuario);

    const [borradorRows] = await pool.query(
        `SELECT payload, actualizado_por, updated_at
         FROM seg_asignacion_borrador WHERE empresa_id = ? LIMIT 1`,
        [id]
    );
    const publicada = await payloadPublicado(pool, id);
    const [activas] = await pool.query(
        `SELECT normativa_id, anio_ciclo FROM seg_asignacion WHERE empresa_id = ? AND estado = 'activa'`,
        [id]
    );

    // Asegura que los puntos ya asignados estén en historial (por si el backfill global aún no corrió).
    if (activas.length) {
        try {
            const vigentes = await leerAsignacionesVigentesParaHistorial(pool, id);
            if (vigentes?.length) {
                const anioVigente = await resolverAnioVigenteEmpresa(pool, id, vigentes);
                const totalPuntos = vigentes.reduce((sum, a) => sum + (a.puntos?.length || 0), 0);
                const [hist] = await pool.query(
                    `SELECT h.id,
                            (SELECT COUNT(*)
                             FROM seg_asignacion_historial_punto hp
                             JOIN seg_asignacion_historial_norma hn ON hn.id = hp.historial_norma_id
                             WHERE hn.historial_id = h.id) AS puntos_reales
                     FROM seg_asignacion_historial h
                     WHERE h.empresa_id = ? AND h.anio = ?
                     LIMIT 1`,
                    [id, anioVigente]
                );
                if (!hist.length || Number(hist[0].puntos_reales) !== totalPuntos) {
                    await upsertSnapshotHistorial(pool, {
                        empresaId: id,
                        empresaNombre: null,
                        anio: anioVigente,
                        usuario: { nombre: 'sistema', id: null },
                        origen: 'sincronizacion',
                        filas: vigentes
                    });
                    await pool.query(
                        `UPDATE seg_asignacion SET anio_ciclo = COALESCE(anio_ciclo, ?)
                         WHERE empresa_id = ? AND estado = 'activa'`,
                        [anioVigente, id]
                    );
                }
            }
        } catch (err) {
            console.warn('[seguridad] No se pudo sembrar historial de asignación:', err?.message || err);
        }
    }

    const historialAnio = await obtenerHistorialAnio(pool, id, anio);
    const historialPrevio = await obtenerHistorialPrevio(pool, id, anio);
    const sugerirHistorial = !!(historialPrevio && !historialAnio);

    let borradorPayload = borradorRows[0] ? leerPayload(borradorRows[0].payload) : null;
    let publicadaFiltrada = publicada;
    let publicadaIds = activas.map((r) => r.normativa_id);
    let historialPrevioFiltrado = historialPrevio;

    if (alcance.empleadoId) {
        if (borradorPayload) {
            borradorPayload = filtrarPayloadPorEmpleado(borradorPayload, alcance.empleadoId);
        }
        if (publicadaFiltrada?.normas) {
            publicadaFiltrada = filtrarPayloadPorEmpleado(publicadaFiltrada, alcance.empleadoId);
            publicadaIds = (publicadaFiltrada.normas || []).map((n) => n.normativa_id);
        } else {
            publicadaIds = [];
        }
        if (historialPrevioFiltrado?.payload) {
            const payloadHistFiltrado = filtrarPayloadPorEmpleado(
                historialPrevioFiltrado.payload,
                alcance.empleadoId
            );
            const idsPropios = new Set(
                (payloadHistFiltrado.normas || []).map((n) => Number(n.normativa_id))
            );
            historialPrevioFiltrado = {
                ...historialPrevioFiltrado,
                payload: payloadHistFiltrado,
                normas_resumen: Array.isArray(historialPrevioFiltrado.normas_resumen)
                    ? historialPrevioFiltrado.normas_resumen.filter((n) =>
                        idsPropios.has(Number(n.normativa_id))
                    )
                    : []
            };
        }
    }

    const borrador = borradorRows[0]
        ? {
            payload: borradorPayload,
            actualizado_por: borradorRows[0].actualizado_por,
            updated_at: aIso(borradorRows[0].updated_at)
        }
        : null;

    return {
        anio,
        borrador,
        publicada: publicadaFiltrada,
        publicada_ids: publicadaIds,
        solo_propias: !!alcance.empleadoId,
        historial_anio: historialAnio
            ? {
                id: historialAnio.id,
                anio: historialAnio.anio,
                total_normativas: historialAnio.total_normativas,
                total_puntos: historialAnio.total_puntos,
                publicado_por: historialAnio.publicado_por
            }
            : null,
        historial_previo: historialPrevioFiltrado
            ? {
                id: historialPrevioFiltrado.id,
                anio: historialPrevioFiltrado.anio,
                total_normativas: historialPrevioFiltrado.payload?.normas?.length
                    ?? historialPrevioFiltrado.total_normativas,
                total_puntos: historialPrevioFiltrado.total_puntos,
                publicado_por: historialPrevioFiltrado.publicado_por,
                normas_resumen: historialPrevioFiltrado.normas_resumen,
                payload: historialPrevioFiltrado.payload
            }
            : null,
        sugerir_historial: sugerirHistorial
    };
}

async function listarPuntos(pool, normativaId) {
    await asegurarTablas(pool);
    const id = entero(normativaId);
    if (!id) throw httpError(400, 'Normativa inválida.');
    const [normas] = await pool.query(
        'SELECT id FROM seg_normativa WHERE id = ? AND estado != \'archivada\' LIMIT 1',
        [id]
    );
    if (!normas.length) throw httpError(404, 'Normativa no encontrada.');
    let rows;
    try {
        [rows] = await pool.query(
            `SELECT id, numero_item, punto_norma, descripcion, descripcion_html, tipo_evidencia, periodicidad,
                    evidencia_requerida, formato_nombre, formato_archivo, orden
             FROM seg_normativa_requisito
             WHERE normativa_id = ?
             ORDER BY orden ASC, id ASC`,
            [id]
        );
    } catch (err) {
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
        [rows] = await pool.query(
            `SELECT id, numero_item, punto_norma, descripcion, tipo_evidencia, periodicidad,
                    evidencia_requerida, formato_nombre, formato_archivo, orden
             FROM seg_normativa_requisito
             WHERE normativa_id = ?
             ORDER BY orden ASC, id ASC`,
            [id]
        );
    }
    const imagenes = await listarImagenesPunto(pool, id);
    return rows.map((row) => ({
        id: row.id,
        numero_item: row.numero_item,
        punto_norma: formatearPuntoNorma(row.punto_norma) || '',
        descripcion: row.descripcion || '',
        descripcion_html: row.descripcion_html || null,
        tipo_evidencia: row.tipo_evidencia || null,
        periodicidad: row.periodicidad || null,
        evidencia_requerida: row.evidencia_requerida || null,
        formato_nombre: row.formato_nombre || null,
        formato_archivo: row.formato_archivo || null,
        orden: row.orden,
        imagenes: imagenes.get(row.id) || []
    }));
}

async function listarImagenesPunto(pool, normativaId) {
    const mapa = new Map();
    try {
        const [imgs] = await pool.query(
            `SELECT id, requisito_id, ruta, nombre
             FROM seg_normativa_requisito_imagen
             WHERE normativa_id = ?
             ORDER BY orden ASC, id ASC`,
            [normativaId]
        );
        for (const img of imgs) {
            const lista = mapa.get(img.requisito_id) || [];
            lista.push({
                id: img.id,
                ruta: img.ruta,
                nombre: img.nombre || ''
            });
            mapa.set(img.requisito_id, lista);
        }
    } catch (err) {
        if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    return mapa;
}

async function validarResponsables(poolMain, responsables) {
    if (!responsables.length || responsables.length > MAX_EMPLEADOS) {
        throw httpError(400, 'Cada normativa debe tener un responsable.');
    }
    const ids = responsables.map((e) => e.empleado_id);
    const [rows] = await poolMain.query(
        `SELECT u.id, u.nombre, u.apellido, r.nombre_rol
         FROM usuario u
         JOIN roles r ON r.rol_id = u.rol_id
         WHERE u.id IN (?) AND u.activo = 1`,
        [ids]
    );
    if (rows.length !== ids.length) {
        throw httpError(400, 'Cada responsable debe ser un usuario activo del sistema.');
    }
    const porId = new Map(rows.map((r) => [Number(r.id), r]));
    return ids.map((usuarioId, index) => {
        const row = porId.get(usuarioId);
        const rol = String(row.nombre_rol || '').trim();
        if (rol.toLowerCase() === 'empresa') {
            throw httpError(400, 'El perfil de empresa no puede ser responsable de una normativa.');
        }
        const nombre = [row.nombre, row.apellido].map((p) => String(p || '').trim()).filter(Boolean).join(' ');
        return {
            empleado_id: usuarioId,
            nombre: (nombre || `Usuario ${usuarioId}`).slice(0, 200),
            puesto: rol.slice(0, 120),
            orden: index + 1
        };
    });
}

async function publicar(pool, poolMain, body, usuario) {
    await asegurarTablas(pool);
    if (!esAdminSeguridad(usuario)) {
        throw httpError(403, 'Solo administradores pueden publicar la asignación de normativas.');
    }
    const empresaId = entero(body?.empresa_id);
    if (!empresaId) throw httpError(400, 'Seleccione una empresa.');

    const [empresas] = await poolMain.query(
        'SELECT empresa_id, nombre_empresa FROM empresa WHERE empresa_id = ? AND activo = TRUE LIMIT 1',
        [empresaId]
    );
    if (!empresas.length) throw httpError(404, 'La empresa no está disponible.');
    const empresaNombre = String(empresas[0].nombre_empresa || '').trim().slice(0, 255);

    const anio = anioCiclo(body?.anio);
    const clonarDesdeAnio = body?.clonar_desde_anio != null
        ? anioCiclo(body.clonar_desde_anio)
        : null;
    const nuevoCiclo = body?.nuevo_ciclo === true
        || body?.nuevo_ciclo === 1
        || body?.nuevo_ciclo === '1'
        || (clonarDesdeAnio != null && clonarDesdeAnio !== anio);

    const payload = sanitizarPayload(body?.payload || body);
    if (!payload.normas.length) {
        throw httpError(400, 'Seleccione al menos una normativa.');
    }

    const normaIds = payload.normas.map((n) => n.normativa_id);
    const [normasDb] = await pool.query(
        `SELECT id, codigo FROM seg_normativa WHERE id IN (?) AND estado != 'archivada'`,
        [normaIds]
    );
    if (normasDb.length !== normaIds.length) {
        throw httpError(400, 'Alguna normativa ya no está en el catálogo.');
    }

    // Niveles de acción del historial a clonar (si aplica).
    const scoresHistorial = new Map();
    if (clonarDesdeAnio != null) {
        const hist = await obtenerHistorialAnio(pool, empresaId, clonarDesdeAnio);
        for (const norma of hist?.payload?.normas || []) {
            for (const pto of norma.puntos || []) {
                if (pto.accion_score != null) {
                    scoresHistorial.set(Number(pto.requisito_id), pto.accion_score);
                }
            }
        }
    }

    const preparados = [];
    for (const norma of payload.normas) {
        const empleados = await validarResponsables(poolMain, norma.empleados);
        if (!norma.requisito_ids.length) {
            const codigo = normasDb.find((n) => n.id === norma.normativa_id)?.codigo || 'seleccionada';
            throw httpError(400, `Seleccione al menos un punto de ${codigo}.`);
        }
        const [reqs] = await pool.query(
            `SELECT id FROM seg_normativa_requisito WHERE normativa_id = ? AND id IN (?)`,
            [norma.normativa_id, norma.requisito_ids]
        );
        if (reqs.length !== norma.requisito_ids.length) {
            throw httpError(400, 'Algunos puntos no corresponden a la normativa seleccionada.');
        }
        const scoresPayload = new Map(
            (norma.puntos || []).map((p) => [p.requisito_id, p.accion_score])
        );
        preparados.push({
            normativa_id: norma.normativa_id,
            empleados,
            requisito_ids: norma.requisito_ids,
            scoresPayload
        });
    }

    const ctx = contextoUsuario(usuario);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const asignacionIds = [];
        for (const norma of preparados) {
            const [existentes] = await conn.query(
                `SELECT id FROM seg_asignacion WHERE empresa_id = ? AND normativa_id = ? LIMIT 1`,
                [empresaId, norma.normativa_id]
            );
            let asignacionId;
            if (existentes.length) {
                asignacionId = existentes[0].id;
                await conn.query(
                    `UPDATE seg_asignacion
                     SET empresa_nombre = ?, estado = 'activa', publicado_por = ?,
                         publicado_en = NOW(), anio_ciclo = ?
                     WHERE id = ?`,
                    [empresaNombre, ctx.nombre, anio, asignacionId]
                );
            } else {
                const [ins] = await conn.query(
                    `INSERT INTO seg_asignacion
                     (empresa_id, empresa_nombre, normativa_id, estado, publicado_por, publicado_en, anio_ciclo)
                     VALUES (?, ?, ?, 'activa', ?, NOW(), ?)`,
                    [empresaId, empresaNombre, norma.normativa_id, ctx.nombre, anio]
                );
                asignacionId = ins.insertId;
            }
            asignacionIds.push(asignacionId);

            await conn.query('DELETE FROM seg_asignacion_responsable WHERE asignacion_id = ?', [asignacionId]);
            for (const emp of norma.empleados) {
                await conn.query(
                    `INSERT INTO seg_asignacion_responsable
                     (asignacion_id, empleado_id, empleado_nombre, empleado_puesto, orden)
                     VALUES (?, ?, ?, ?, ?)`,
                    [asignacionId, emp.empleado_id, emp.nombre, emp.puesto || null, emp.orden]
                );
            }

            const [prevPts] = await conn.query(
                `SELECT requisito_id, accion_score, fecha_inicio, observaciones, indicador_avance
                 FROM seg_asignacion_punto WHERE asignacion_id = ?`,
                [asignacionId]
            );
            const prevMap = new Map(prevPts.map((p) => [Number(p.requisito_id), p]));

            await conn.query('DELETE FROM seg_asignacion_punto WHERE asignacion_id = ?', [asignacionId]);
            const valores = norma.requisito_ids.map((reqId) => {
                const prev = prevMap.get(reqId);
                const score = norma.scoresPayload.get(reqId)
                    ?? scoresHistorial.get(reqId)
                    ?? normalizarAccionScore(prev?.accion_score);
                // Nuevo ciclo anual: reinicia fechas y observaciones; conserva nivel de acción.
                // Catálogo (tipo evidencia, periodicidad, responsable, descripción, formato)
                // se lee siempre de seg_normativa_requisito.
                const fechaInicio = nuevoCiclo ? null : (prev?.fecha_inicio || null);
                const observaciones = nuevoCiclo ? null : (prev?.observaciones || null);
                const indicador = nuevoCiclo ? null : (prev?.indicador_avance ?? null);
                return [asignacionId, reqId, score, fechaInicio, indicador, observaciones];
            });
            await conn.query(
                `INSERT INTO seg_asignacion_punto
                 (asignacion_id, requisito_id, accion_score, fecha_inicio, indicador_avance, observaciones)
                 VALUES ?`,
                [valores]
            );
        }

        await conn.query(
            `UPDATE seg_asignacion
             SET estado = 'archivada'
             WHERE empresa_id = ? AND estado = 'activa' AND normativa_id NOT IN (?)`,
            [empresaId, normaIds]
        );
        await conn.query('DELETE FROM seg_asignacion_borrador WHERE empresa_id = ?', [empresaId]);

        const historial = await upsertSnapshotHistorial(conn, {
            empresaId,
            empresaNombre,
            anio,
            usuario,
            origen: nuevoCiclo && clonarDesdeAnio != null ? 'clonacion' : 'publicacion'
        });

        await conn.commit();
        return {
            empresa_id: empresaId,
            empresa_nombre: empresaNombre,
            asignaciones: asignacionIds.length,
            anio,
            nuevo_ciclo: !!nuevoCiclo,
            clonar_desde_anio: clonarDesdeAnio,
            historial
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

function mapAsignacionLista(row) {
    const puntosAsignados = Number(row.puntos_asignados) || 0;
    const puntosConEvidencia = Number(row.puntos_con_evidencia) || 0;
    return {
        id: row.id,
        empresa_id: row.empresa_id,
        empresa_nombre: row.empresa_nombre,
        normativa_id: row.normativa_id,
        codigo: row.codigo,
        titulo: row.titulo,
        categoria_id: row.categoria_id || 'otras',
        autoridad: row.autoridad || null,
        total_catalogo: row.total_requisitos,
        puntos_asignados: puntosAsignados,
        documentos: Number(row.documentos) || 0,
        puntos_con_evidencia: puntosConEvidencia,
        avance: pct(puntosConEvidencia, puntosAsignados),
        imagen_portada: row.imagen_portada || null,
        publicado_por: row.publicado_por,
        publicado_en: aIso(row.publicado_en),
        updated_at: aIso(row.updated_at)
    };
}

function agruparEmpresas(asignaciones) {
    const mapa = new Map();
    for (const item of asignaciones) {
        let emp = mapa.get(item.empresa_id);
        if (!emp) {
            emp = {
                empresa_id: item.empresa_id,
                empresa_nombre: item.empresa_nombre,
                puntos_asignados: 0,
                puntos_con_evidencia: 0,
                documentos: 0,
                normativas: 0,
                normativas_cerradas: 0,
                normativas_abiertas: 0,
                ultima_gestion: null,
                categoriasMap: new Map()
            };
            mapa.set(item.empresa_id, emp);
        }
        emp.puntos_asignados += item.puntos_asignados;
        emp.puntos_con_evidencia += item.puntos_con_evidencia;
        emp.documentos += item.documentos;
        emp.normativas += 1;
        if (Number(item.avance) >= 100) emp.normativas_cerradas += 1;
        else emp.normativas_abiertas += 1;
        const fechaItem = item.updated_at || item.publicado_en || null;
        if (fechaItem && (!emp.ultima_gestion || String(fechaItem) > String(emp.ultima_gestion))) {
            emp.ultima_gestion = fechaItem;
        }

        const catId = item.categoria_id || 'otras';
        let cat = emp.categoriasMap.get(catId);
        if (!cat) {
            cat = {
                ...metaCategoria(catId),
                puntos_asignados: 0,
                puntos_con_evidencia: 0,
                documentos: 0,
                normativas: 0
            };
            emp.categoriasMap.set(catId, cat);
        }
        cat.puntos_asignados += item.puntos_asignados;
        cat.puntos_con_evidencia += item.puntos_con_evidencia;
        cat.documentos += item.documentos;
        cat.normativas += 1;
    }

    return Array.from(mapa.values())
        .map((emp) => {
            const categorias = Array.from(emp.categoriasMap.values())
                .map((c) => ({
                    ...c,
                    avance: pct(c.puntos_con_evidencia, c.puntos_asignados)
                }))
                .sort((a, b) => a.categoria_id.localeCompare(b.categoria_id, 'es'));
            return {
                empresa_id: emp.empresa_id,
                empresa_nombre: emp.empresa_nombre,
                puntos_asignados: emp.puntos_asignados,
                puntos_con_evidencia: emp.puntos_con_evidencia,
                documentos: emp.documentos,
                normativas: emp.normativas,
                normativas_cerradas: emp.normativas_cerradas,
                normativas_abiertas: emp.normativas_abiertas,
                ultima_gestion: emp.ultima_gestion,
                avance: pct(emp.puntos_con_evidencia, emp.puntos_asignados),
                categorias
            };
        })
        .sort((a, b) => a.empresa_nombre.localeCompare(b.empresa_nombre, 'es'));
}

async function listarGestion(pool, empresaId, usuario = null) {
    await asegurarTablas(pool);
    const params = [];
    let filtro = '';
    const id = entero(empresaId);
    if (id) {
        filtro = ' AND a.empresa_id = ?';
        params.push(id);
    }
    const alcance = alcanceGestion(usuario);
    if (alcance.empleadoId) {
        filtro += ` AND EXISTS (
            SELECT 1 FROM seg_asignacion_responsable ar
            WHERE ar.asignacion_id = a.id AND ar.empleado_id = ?
        )`;
        params.push(alcance.empleadoId);
    }
    const [rows] = await pool.query(
        `SELECT a.id, a.empresa_id, a.empresa_nombre, a.normativa_id, a.publicado_por,
                a.publicado_en, a.updated_at,
                n.codigo, n.titulo, n.categoria_id, n.autoridad, n.total_requisitos, n.imagen_portada,
                (SELECT COUNT(*) FROM seg_asignacion_punto p WHERE p.asignacion_id = a.id) AS puntos_asignados,
                (SELECT COUNT(*) FROM seg_asignacion_documento d WHERE d.asignacion_id = a.id) AS documentos,
                (SELECT COUNT(DISTINCT d.requisito_id) FROM seg_asignacion_documento d
                  WHERE d.asignacion_id = a.id AND d.requisito_id IS NOT NULL) AS puntos_con_evidencia
         FROM seg_asignacion a
         JOIN seg_normativa n ON n.id = a.normativa_id
         WHERE a.estado = 'activa' ${filtro}
         ORDER BY a.empresa_nombre ASC, n.numero ASC, n.codigo ASC`,
        params
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [resps] = await pool.query(
        `SELECT asignacion_id, empleado_id, empleado_nombre, empleado_puesto, orden
         FROM seg_asignacion_responsable
         WHERE asignacion_id IN (?)
         ORDER BY orden ASC, id ASC`,
        [ids]
    );
    const porAsig = new Map();
    for (const r of resps) {
        if (!porAsig.has(r.asignacion_id)) porAsig.set(r.asignacion_id, []);
        porAsig.get(r.asignacion_id).push({
            empleado_id: r.empleado_id,
            nombre: r.empleado_nombre,
            puesto: r.empleado_puesto || ''
        });
    }
    return rows.map((row) => ({
        ...mapAsignacionLista(row),
        responsables: porAsig.get(row.id) || []
    }));
}

async function listarEmpresasGestion(pool, usuario = null) {
    const asignaciones = await listarGestion(pool, null, usuario);
    return agruparEmpresas(asignaciones);
}

async function obtenerEmpresaGestion(pool, empresaId, categoriaId, usuario = null) {
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Empresa inválida.');
    const asignaciones = await listarGestion(pool, id, usuario);
    if (!asignaciones.length) {
        throw httpError(404, esAdminSeguridad(usuario)
            ? 'No hay normativas asignadas para esta empresa.'
            : 'No tiene normativas asignadas en esta empresa.');
    }

    const [empresa] = agruparEmpresas(asignaciones);
    const catFiltro = categoriaId ? String(categoriaId).trim() : '';
    const normas = catFiltro
        ? asignaciones.filter((a) => a.categoria_id === catFiltro)
        : asignaciones;

    return {
        empresa,
        categorias: empresa.categorias,
        asignaciones: normas
    };
}

function mapDocumento(row) {
    return {
        id: row.id,
        asignacion_id: row.asignacion_id,
        requisito_id: row.requisito_id,
        nombre_original: row.nombre_original,
        mime: row.mime,
        tamano: row.tamano,
        subido_por: row.subido_por,
        creado_en: aIso(row.creado_en),
        drive_file_id: row.drive_file_id || null,
        drive_folder_id: row.drive_folder_id || null,
        drive_web_view_link: row.drive_web_view_link || null,
        anio: row.anio != null ? Number(row.anio) : null
    };
}

async function obtenerGestion(pool, asignacionId, usuario = null) {
    await asegurarTablas(pool);
    const id = entero(asignacionId);
    if (!id) throw httpError(400, 'Asignación inválida.');
    if (usuario) await assertAccesoAsignacion(pool, id, usuario);
    const [rows] = await pool.query(
        `SELECT a.id, a.empresa_id, a.empresa_nombre, a.normativa_id, a.publicado_por,
                a.publicado_en, a.updated_at,
                n.codigo, n.titulo, n.categoria_id, n.autoridad, n.total_requisitos, n.imagen_portada,
                (SELECT COUNT(*) FROM seg_asignacion_punto p WHERE p.asignacion_id = a.id) AS puntos_asignados,
                (SELECT COUNT(*) FROM seg_asignacion_documento d WHERE d.asignacion_id = a.id) AS documentos,
                (SELECT COUNT(DISTINCT d.requisito_id) FROM seg_asignacion_documento d
                  WHERE d.asignacion_id = a.id AND d.requisito_id IS NOT NULL) AS puntos_con_evidencia
         FROM seg_asignacion a
         JOIN seg_normativa n ON n.id = a.normativa_id
         WHERE a.id = ? AND a.estado = 'activa'
         LIMIT 1`,
        [id]
    );
    if (!rows.length) throw httpError(404, 'La asignación no está disponible.');

    const normativaId = rows[0].normativa_id;
    const imagenesMap = await listarImagenesPunto(pool, normativaId);

    const [resps] = await pool.query(
        `SELECT empleado_id, empleado_nombre, empleado_puesto, orden
         FROM seg_asignacion_responsable
         WHERE asignacion_id = ?
         ORDER BY orden ASC, id ASC`,
        [id]
    );
    let puntos;
    try {
        [puntos] = await pool.query(
            `SELECT r.id, r.numero_item, r.punto_norma, r.descripcion, r.descripcion_html,
                    r.aplica, r.tipo_evidencia, r.periodicidad,
                    r.accion_prev_conservar, r.accion_prev_mejorar, r.accion_prev_actualizar,
                    r.accion_corr_complementar, r.accion_corr_corregir, r.accion_corr_realizar,
                    r.fecha_inicio AS cat_fecha_inicio, r.responsable, r.indicador_avance AS cat_indicador,
                    r.evidencia_requerida, r.observaciones AS cat_observaciones,
                    r.formato_nombre, r.formato_archivo, r.formato_nombre_archivo, r.orden,
                    p.accion_score AS ges_accion_score,
                    p.fecha_inicio AS ges_fecha_inicio,
                    p.indicador_avance AS ges_indicador,
                    p.observaciones AS ges_observaciones,
                    (SELECT MAX(d.creado_en) FROM seg_asignacion_documento d
                      WHERE d.asignacion_id = ? AND d.requisito_id = r.id) AS ultima_evidencia
             FROM seg_asignacion_punto p
             JOIN seg_normativa_requisito r ON r.id = p.requisito_id
             WHERE p.asignacion_id = ?
             ORDER BY r.orden ASC, r.id ASC`,
            [id, id]
        );
    } catch (err) {
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
        [puntos] = await pool.query(
            `SELECT r.id, r.numero_item, r.punto_norma, r.descripcion,
                    r.tipo_evidencia, r.periodicidad, r.evidencia_requerida, r.responsable,
                    r.formato_nombre, r.formato_archivo, r.orden,
                    (SELECT MAX(d.creado_en) FROM seg_asignacion_documento d
                      WHERE d.asignacion_id = ? AND d.requisito_id = r.id) AS ultima_evidencia
             FROM seg_asignacion_punto p
             JOIN seg_normativa_requisito r ON r.id = p.requisito_id
             WHERE p.asignacion_id = ?
             ORDER BY r.orden ASC, r.id ASC`,
            [id, id]
        );
    }
    const [docs] = await pool.query(
        `SELECT id, asignacion_id, requisito_id, nombre_original, mime, tamano, subido_por, creado_en,
                drive_file_id, drive_folder_id, drive_web_view_link, anio
         FROM seg_asignacion_documento
         WHERE asignacion_id = ?
         ORDER BY creado_en DESC, id DESC`,
        [id]
    );
    const docsMap = docs.map(mapDocumento);
    return {
        asignacion: {
            ...mapAsignacionLista(rows[0]),
            categoria: metaCategoria(rows[0].categoria_id),
            responsables: resps.map((r) => ({
                empleado_id: r.empleado_id,
                nombre: r.empleado_nombre,
                puesto: r.empleado_puesto || ''
            }))
        },
        puntos: puntos.map((row) => {
            const documentos = docsMap.filter((d) => Number(d.requisito_id) === Number(row.id));
            const ultima = aIso(row.ultima_evidencia);
            const scoreGes = row.ges_accion_score != null ? Number(row.ges_accion_score) : null;
            const score = scoreGes != null && !Number.isNaN(scoreGes)
                ? scoreGes
                : scoreDesdeAccionesCatalogo(row);
            const acciones = score != null
                ? accionesDesdeScore(score)
                : {
                    preventiva: {
                        conservar: !!Number(row.accion_prev_conservar || 0),
                        mejorar: !!Number(row.accion_prev_mejorar || 0),
                        actualizar: !!Number(row.accion_prev_actualizar || 0)
                    },
                    correctiva: {
                        complementar: !!Number(row.accion_corr_complementar || 0),
                        corregir: !!Number(row.accion_corr_corregir || 0),
                        realizar: !!Number(row.accion_corr_realizar || 0)
                    }
                };
            const fechaInicio = row.ges_fecha_inicio || row.cat_fecha_inicio || null;
            const observaciones = row.ges_observaciones != null
                ? row.ges_observaciones
                : (row.cat_observaciones || null);
            const estado = estadoPunto(documentos);
            /** Avance por cumplimiento (evidencias), no por nivel de acción. */
            const indicador = estado === 'cumple' ? 100 : (estado === 'parcial' ? 50 : 0);
            return {
                id: row.id,
                numero_item: row.numero_item != null ? Number(row.numero_item) : null,
                punto_norma: formatearPuntoNorma(row.punto_norma) || '',
                descripcion: row.descripcion || '',
                descripcion_html: row.descripcion_html || null,
                tipo_evidencia: row.tipo_evidencia || null,
                periodicidad: row.periodicidad || null,
                accion_score: score,
                acciones,
                fecha_inicio: fechaInicio,
                /** Fecha de terminación = día en que se subió la evidencia. */
                fecha_terminacion: ultima,
                responsable: normalizarResponsableGestion(row.responsable),
                indicador_avance: indicador,
                evidencia_requerida: row.evidencia_requerida || null,
                observaciones,
                formato_nombre: row.formato_nombre || null,
                formato_archivo: row.formato_archivo || null,
                formato_nombre_archivo: row.formato_nombre_archivo || null,
                orden: row.orden,
                ultima_evidencia: ultima,
                estado,
                imagenes: imagenesMap.get(row.id) || [],
                documentos
            };
        }),
        documentos_generales: docsMap.filter((d) => !d.requisito_id)
    };
}

function rutaAbsoluta(relativa) {
    const base = UPLOAD_DIR;
    const full = path.resolve(base, relativa);
    if (full !== base && !full.startsWith(base + path.sep)) {
        throw httpError(400, 'Ruta de archivo no válida.');
    }
    return full;
}

async function asegurarRutaDriveEvidencia({ empresaNombre, anio, codigoNorma, puntoNorma, requisitoId }) {
    if (!driveService.driveDisponible || !driveService.driveDisponible()) {
        throw httpError(503, 'Google Drive no está autenticado. Revisa la conexión de Drive.');
    }
    const carpetaEmpresa = await driveService.obtenerOCrearCarpeta(
        nombreCarpetaDrive(empresaNombre, 'Empresa'),
        CARPETA_SISTEMA_DRIVE_ID
    );
    const carpetaAnio = await driveService.obtenerOCrearCarpeta(
        `Normativas ${anio}`,
        carpetaEmpresa
    );
    const carpetaNorma = await driveService.obtenerOCrearCarpeta(
        nombreCarpetaDrive(codigoNorma, 'Normativa'),
        carpetaAnio
    );
    const etiquetaPunto = puntoNorma
        ? nombreCarpetaDrive(puntoNorma, `Punto ${requisitoId || ''}`)
        : nombreCarpetaDrive(`Punto ${requisitoId || 'general'}`, 'Punto');
    const carpetaPunto = await driveService.obtenerOCrearCarpeta(etiquetaPunto, carpetaNorma);
    return carpetaPunto;
}

async function guardarDocumento(pool, asignacionId, file, requisitoId, usuario, anioOpcional) {
    await asegurarTablas(pool);
    const id = entero(asignacionId);
    if (!id) throw httpError(400, 'Asignación inválida.');
    if (!file?.buffer) throw httpError(400, 'Adjunte un archivo.');
    if (usuario) await assertAccesoAsignacion(pool, id, usuario);

    const [asigs] = await pool.query(
        `SELECT a.id, a.empresa_nombre, n.codigo
         FROM seg_asignacion a
         JOIN seg_normativa n ON n.id = a.normativa_id
         WHERE a.id = ? AND a.estado = 'activa'
         LIMIT 1`,
        [id]
    );
    if (!asigs.length) throw httpError(404, 'La asignación no está disponible.');

    const reqId = requisitoId ? entero(requisitoId) : null;
    if (requisitoId && !reqId) throw httpError(400, 'Punto inválido.');

    let puntoNorma = '';
    if (reqId) {
        const [pts] = await pool.query(
            `SELECT r.punto_norma
             FROM seg_asignacion_punto p
             JOIN seg_normativa_requisito r ON r.id = p.requisito_id
             WHERE p.asignacion_id = ? AND p.requisito_id = ?
             LIMIT 1`,
            [id, reqId]
        );
        if (!pts.length) throw httpError(400, 'Ese punto no forma parte de la normativa asignada.');
        puntoNorma = formatearPuntoNorma(pts[0].punto_norma) || String(reqId);
    }

    const anio = entero(anioOpcional) || new Date().getFullYear();
    const original = String(file.originalname || 'archivo').slice(0, 240);
    const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const nombreDisco = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const relativa = path.join(String(id), nombreDisco);
    const destino = rutaAbsoluta(relativa);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, file.buffer);

    let driveFileId = null;
    let driveFolderId = null;
    let driveWebViewLink = null;
    try {
        driveFolderId = await asegurarRutaDriveEvidencia({
            empresaNombre: asigs[0].empresa_nombre,
            anio,
            codigoNorma: asigs[0].codigo,
            puntoNorma: reqId ? puntoNorma : 'Documentos generales',
            requisitoId: reqId
        });
        const subido = await driveService.subirArchivoNuevo(
            file.buffer,
            original,
            String(file.mimetype || 'application/octet-stream'),
            driveFolderId
        );
        driveFileId = subido?.id || null;
        driveWebViewLink = subido?.webViewLink
            || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null);
    } catch (err) {
        await fs.promises.unlink(destino).catch(() => {});
        const msg = err?.message || 'No se pudo subir el archivo a Google Drive.';
        throw httpError(err?.status || err?.statusCode || 502, msg);
    }

    const ctx = contextoUsuario(usuario);
    const [ins] = await pool.query(
        `INSERT INTO seg_asignacion_documento
         (asignacion_id, requisito_id, nombre_original, ruta_relativa, mime, tamano, subido_por,
          drive_file_id, drive_folder_id, drive_web_view_link, anio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            reqId,
            original,
            relativa.replace(/\\/g, '/'),
            String(file.mimetype || '').slice(0, 120),
            file.size || file.buffer.length,
            ctx.nombre,
            driveFileId,
            driveFolderId,
            driveWebViewLink,
            anio
        ]
    );
    const [rows] = await pool.query(
        `SELECT id, asignacion_id, requisito_id, nombre_original, mime, tamano, subido_por, creado_en,
                drive_file_id, drive_folder_id, drive_web_view_link, anio
         FROM seg_asignacion_documento WHERE id = ? LIMIT 1`,
        [ins.insertId]
    );
    return mapDocumento(rows[0]);
}

async function leerDocumento(pool, documentoId) {
    await asegurarTablas(pool);
    const id = entero(documentoId);
    if (!id) throw httpError(400, 'Documento inválido.');
    const [rows] = await pool.query(
        `SELECT d.id, d.nombre_original, d.ruta_relativa, d.mime, d.drive_file_id, d.drive_web_view_link, a.estado
         FROM seg_asignacion_documento d
         JOIN seg_asignacion a ON a.id = d.asignacion_id
         WHERE d.id = ? LIMIT 1`,
        [id]
    );
    if (!rows.length || rows[0].estado !== 'activa') {
        throw httpError(404, 'Documento no encontrado.');
    }
    const row = rows[0];
    if (row.ruta_relativa) {
        const absoluta = rutaAbsoluta(row.ruta_relativa);
        if (fs.existsSync(absoluta)) {
            return {
                path: absoluta,
                nombre: row.nombre_original,
                mime: row.mime || 'application/octet-stream',
                drive_web_view_link: row.drive_web_view_link || null
            };
        }
    }
    if (row.drive_web_view_link || row.drive_file_id) {
        return {
            path: null,
            nombre: row.nombre_original,
            mime: row.mime || 'application/octet-stream',
            drive_web_view_link: row.drive_web_view_link
                || `https://drive.google.com/file/d/${row.drive_file_id}/view`,
            drive_file_id: row.drive_file_id
        };
    }
    throw httpError(404, 'El archivo ya no está en el servidor ni en Drive.');
}

async function eliminarDocumento(pool, documentoId) {
    await asegurarTablas(pool);
    const id = entero(documentoId);
    if (!id) throw httpError(400, 'Documento inválido.');
    const [rows] = await pool.query(
        'SELECT id, ruta_relativa, drive_file_id FROM seg_asignacion_documento WHERE id = ? LIMIT 1',
        [id]
    );
    if (!rows.length) throw httpError(404, 'Documento no encontrado.');
    await pool.query('DELETE FROM seg_asignacion_documento WHERE id = ?', [id]);
    if (rows[0].ruta_relativa) {
        const absoluta = rutaAbsoluta(rows[0].ruta_relativa);
        await fs.promises.unlink(absoluta).catch(() => {});
    }
    if (rows[0].drive_file_id) {
        try {
            await driveService.eliminarArchivo(rows[0].drive_file_id);
        } catch (err) {
            console.warn('[seguridad] No se eliminó el archivo de Drive:', err?.message || err);
        }
    }
}

async function archivarAsignacion(pool, asignacionId) {
    await asegurarTablas(pool);
    const id = entero(asignacionId);
    if (!id) throw httpError(400, 'Asignación inválida.');
    const [res] = await pool.query(
        `UPDATE seg_asignacion SET estado = 'archivada' WHERE id = ? AND estado = 'activa'`,
        [id]
    );
    if (!res.affectedRows) throw httpError(404, 'La asignación no está disponible.');
}

async function actualizarPuntoGestion(pool, asignacionId, requisitoId, datos = {}, usuario = null) {
    await asegurarTablas(pool);
    const asigId = entero(asignacionId);
    const reqId = entero(requisitoId);
    if (!asigId || !reqId) throw httpError(400, 'Asignación o requisito inválido.');
    if (usuario) await assertAccesoAsignacion(pool, asigId, usuario);

    const [asig] = await pool.query(
        `SELECT id, normativa_id FROM seg_asignacion WHERE id = ? AND estado = 'activa' LIMIT 1`,
        [asigId]
    );
    if (!asig.length) throw httpError(404, 'La normativa no está en gestión activa.');

    const [pto] = await pool.query(
        `SELECT id FROM seg_asignacion_punto
         WHERE asignacion_id = ? AND requisito_id = ? LIMIT 1`,
        [asigId, reqId]
    );
    if (!pto.length) throw httpError(404, 'El punto no pertenece a esta asignación.');

    const campos = [];
    const vals = [];

    let accionScoreSync = undefined;
    if (Object.prototype.hasOwnProperty.call(datos, 'accion_score')
        || Object.prototype.hasOwnProperty.call(datos, 'tipo_accion')) {
        let score = null;
        if (Object.prototype.hasOwnProperty.call(datos, 'tipo_accion')) {
            const tipo = String(datos.tipo_accion || '').trim().toLowerCase();
            if (tipo === 'preventiva') score = 60;
            else if (tipo === 'correctiva') score = 0;
            else if (tipo === '' || tipo === 'null' || datos.tipo_accion == null) score = null;
            else throw httpError(400, 'El nivel de acción debe ser Preventiva o Correctiva.');
        } else {
            score = normalizarAccionScore(datos.accion_score);
        }
        // Si ya hay un score del mismo grupo, conservar el detalle numérico legacy.
        if (score != null && Object.prototype.hasOwnProperty.call(datos, 'tipo_accion')) {
            const [prevScoreRows] = await pool.query(
                `SELECT accion_score FROM seg_asignacion_punto
                 WHERE asignacion_id = ? AND requisito_id = ? LIMIT 1`,
                [asigId, reqId]
            );
            const rawPrev = prevScoreRows[0]?.accion_score;
            const prevNum = rawPrev == null || rawPrev === '' ? null : Number(rawPrev);
            const prevScore = [0, 20, 40, 60, 80, 100].includes(prevNum) ? prevNum : null;
            if (prevScore != null) {
                const prevGrupo = ACCION_SCORE_META[prevScore]?.grupo;
                const nuevoGrupo = ACCION_SCORE_META[score]?.grupo;
                if (prevGrupo && prevGrupo === nuevoGrupo) score = prevScore;
            }
        }
        campos.push('accion_score = ?');
        vals.push(score);
        accionScoreSync = score;
    }
    if (Object.prototype.hasOwnProperty.call(datos, 'fecha_inicio')) {
        campos.push('fecha_inicio = ?');
        vals.push(normalizarFechaInicioMes(datos.fecha_inicio));
    }
    if (Object.prototype.hasOwnProperty.call(datos, 'observaciones')) {
        const obs = datos.observaciones == null ? null : String(datos.observaciones).trim().slice(0, 4000);
        campos.push('observaciones = ?');
        vals.push(obs || null);
    }
    if (Object.prototype.hasOwnProperty.call(datos, 'indicador_avance')
        && !Object.prototype.hasOwnProperty.call(datos, 'accion_score')
        && !Object.prototype.hasOwnProperty.call(datos, 'tipo_accion')) {
        const ind = datos.indicador_avance == null || datos.indicador_avance === ''
            ? null
            : Math.max(0, Math.min(100, Number(datos.indicador_avance)));
        if (ind != null && Number.isNaN(ind)) throw httpError(400, 'Indicador de avance inválido.');
        campos.push('indicador_avance = ?');
        vals.push(ind);
    }

    let responsableActualizado = false;
    if (Object.prototype.hasOwnProperty.call(datos, 'responsable')) {
        const resp = normalizarResponsableGestion(datos.responsable);
        await pool.query(
            `UPDATE seg_normativa_requisito SET responsable = ?
             WHERE id = ? AND normativa_id = ?`,
            [resp, reqId, asig[0].normativa_id]
        );
        responsableActualizado = true;
    }

    if (!campos.length && !responsableActualizado) {
        throw httpError(400, 'No hay campos para actualizar.');
    }

    if (campos.length) {
        vals.push(asigId, reqId);
        await pool.query(
            `UPDATE seg_asignacion_punto SET ${campos.join(', ')}
             WHERE asignacion_id = ? AND requisito_id = ?`,
            vals
        );
    }

    if (accionScoreSync !== undefined) {
        try {
            await sincronizarAccionEnHistorial(pool, asigId, reqId, accionScoreSync);
        } catch (err) {
            console.warn('[seguridad] No se sincronizó nivel de acción en historial:', err?.message || err);
        }
    }

    return obtenerGestion(pool, asigId, usuario);
}

module.exports = {
    asegurarTablas,
    sincronizarHistorialesPendientes,
    guardarBorrador,
    eliminarBorrador,
    obtenerEstado,
    listarPuntos,
    publicar,
    listarGestion,
    listarEmpresasGestion,
    obtenerEmpresaGestion,
    obtenerGestion,
    guardarDocumento,
    leerDocumento,
    eliminarDocumento,
    archivarAsignacion,
    actualizarPuntoGestion,
    listarHistorialEmpresa,
    obtenerHistorialDetalle,
    CARPETA_SISTEMA_DRIVE_ID
};
