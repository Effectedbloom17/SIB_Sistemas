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

        normas.push({
            normativa_id: normativaId,
            empleados,
            requisito_ids: requisitoIds
        });
    }

    return { paso, vista, normas };
}

async function asegurarTablas(pool) {
    if (!pool?.query) throw new Error('Pool de normativas no disponible');
    if (!tablasPromise) {
        tablasPromise = crearTablas(pool).catch((err) => {
            tablasPromise = null;
            throw err;
        });
    }
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

async function guardarBorrador(pool, empresaId, payload, usuario) {
    await asegurarTablas(pool);
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
        `SELECT asignacion_id, requisito_id FROM seg_asignacion_punto WHERE asignacion_id IN (?)`,
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
    for (const p of puntos) {
        if (!porAsigPts.has(p.asignacion_id)) porAsigPts.set(p.asignacion_id, []);
        porAsigPts.get(p.asignacion_id).push(p.requisito_id);
    }
    return {
        paso: 4,
        normas: asigs.map((a) => ({
            normativa_id: a.normativa_id,
            empleados: porAsigResp.get(a.id) || [],
            requisito_ids: porAsigPts.get(a.id) || []
        }))
    };
}

async function obtenerEstado(pool, empresaId) {
    await asegurarTablas(pool);
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Seleccione una empresa válida.');

    const [borradorRows] = await pool.query(
        `SELECT payload, actualizado_por, updated_at
         FROM seg_asignacion_borrador WHERE empresa_id = ? LIMIT 1`,
        [id]
    );
    const publicada = await payloadPublicado(pool, id);
    const [activas] = await pool.query(
        `SELECT normativa_id FROM seg_asignacion WHERE empresa_id = ? AND estado = 'activa'`,
        [id]
    );
    const borrador = borradorRows[0]
        ? {
            payload: leerPayload(borradorRows[0].payload),
            actualizado_por: borradorRows[0].actualizado_por,
            updated_at: aIso(borradorRows[0].updated_at)
        }
        : null;

    return {
        borrador,
        publicada,
        publicada_ids: activas.map((r) => r.normativa_id)
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
    const empresaId = entero(body?.empresa_id);
    if (!empresaId) throw httpError(400, 'Seleccione una empresa.');

    const [empresas] = await poolMain.query(
        'SELECT empresa_id, nombre_empresa FROM empresa WHERE empresa_id = ? AND activo = TRUE LIMIT 1',
        [empresaId]
    );
    if (!empresas.length) throw httpError(404, 'La empresa no está disponible.');
    const empresaNombre = String(empresas[0].nombre_empresa || '').trim().slice(0, 255);

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
        preparados.push({
            normativa_id: norma.normativa_id,
            empleados,
            requisito_ids: norma.requisito_ids
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
                     SET empresa_nombre = ?, estado = 'activa', publicado_por = ?, publicado_en = NOW()
                     WHERE id = ?`,
                    [empresaNombre, ctx.nombre, asignacionId]
                );
            } else {
                const [ins] = await conn.query(
                    `INSERT INTO seg_asignacion
                     (empresa_id, empresa_nombre, normativa_id, estado, publicado_por, publicado_en)
                     VALUES (?, ?, ?, 'activa', ?, NOW())`,
                    [empresaId, empresaNombre, norma.normativa_id, ctx.nombre]
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

            await conn.query('DELETE FROM seg_asignacion_punto WHERE asignacion_id = ?', [asignacionId]);
            const valores = norma.requisito_ids.map((reqId) => [asignacionId, reqId]);
            await conn.query(
                'INSERT INTO seg_asignacion_punto (asignacion_id, requisito_id) VALUES ?',
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
        await conn.commit();
        return {
            empresa_id: empresaId,
            empresa_nombre: empresaNombre,
            asignaciones: asignacionIds.length
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

async function listarGestion(pool, empresaId) {
    await asegurarTablas(pool);
    const params = [];
    let filtro = '';
    const id = entero(empresaId);
    if (id) {
        filtro = ' AND a.empresa_id = ?';
        params.push(id);
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

async function listarEmpresasGestion(pool) {
    const asignaciones = await listarGestion(pool);
    return agruparEmpresas(asignaciones);
}

async function obtenerEmpresaGestion(pool, empresaId, categoriaId) {
    const id = entero(empresaId);
    if (!id) throw httpError(400, 'Empresa inválida.');
    const asignaciones = await listarGestion(pool, id);
    if (!asignaciones.length) throw httpError(404, 'No hay normativas asignadas para esta empresa.');

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

async function obtenerGestion(pool, asignacionId) {
    await asegurarTablas(pool);
    const id = entero(asignacionId);
    if (!id) throw httpError(400, 'Asignación inválida.');
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
                    r.fecha_inicio, r.fecha_terminacion, r.responsable, r.indicador_avance,
                    r.evidencia_requerida, r.observaciones,
                    r.formato_nombre, r.formato_archivo, r.formato_nombre_archivo, r.orden,
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
            return {
                id: row.id,
                numero_item: row.numero_item != null ? Number(row.numero_item) : null,
                punto_norma: formatearPuntoNorma(row.punto_norma) || '',
                descripcion: row.descripcion || '',
                descripcion_html: row.descripcion_html || null,
                aplica: row.aplica == null ? null : !!Number(row.aplica),
                tipo_evidencia: row.tipo_evidencia || null,
                periodicidad: row.periodicidad || null,
                acciones: {
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
                },
                fecha_inicio: row.fecha_inicio || null,
                fecha_terminacion: row.fecha_terminacion || null,
                responsable: normalizarResponsableGestion(row.responsable),
                indicador_avance: row.indicador_avance != null ? Number(row.indicador_avance) : null,
                evidencia_requerida: row.evidencia_requerida || null,
                observaciones: row.observaciones || null,
                formato_nombre: row.formato_nombre || null,
                formato_archivo: row.formato_archivo || null,
                formato_nombre_archivo: row.formato_nombre_archivo || null,
                orden: row.orden,
                ultima_evidencia: aIso(row.ultima_evidencia),
                estado: estadoPunto(documentos),
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

module.exports = {
    asegurarTablas,
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
    CARPETA_SISTEMA_DRIVE_ID
};
