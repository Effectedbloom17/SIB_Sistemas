/**
 * Control de Proyectos — flujo propio del sistema.
 *
 * Modelo operativo:
 *   Empresa -> Proyectos -> Actividades
 *
 * Una fila en `sgc_control_proyectos` representa una actividad. El proyecto se
 * agrupa por empresa + folio/nombre, para conservar datos históricos sin una
 * migración riesgosa de varias tablas.
 */
const CODIGO_FORMATO = 'CONTROL-PROYECTOS';
const REV_FORMATO = '02';

const PRIORIDADES_VALIDAS = ['Muy Prioritaria', 'Prioritaria', 'Media', 'Baja', 'Muy baja', 'Ninguna'];
const PRIORIDADES_LEGACY = {
    inmediato: 'Muy Prioritaria',
    'mediano plazo': 'Media',
    'largo plazo': 'Baja'
};
const COLORES_PRIORIDAD = {
    'Muy Prioritaria': '#dc2626',
    Prioritaria: '#ea580c',
    Media: '#eab308',
    Baja: '#3b82f6',
    'Muy baja': '#6366f1',
    Ninguna: '#94a3b8'
};
const ESTATUS_VALIDOS = ['Concluido', 'En revisión', 'En proceso', 'No iniciado'];
const INDICADORES_AVANCE = [0, 25, 50, 75, 100];
const RESPONSABLE_SEP = ' | ';

const COLUMNAS_EXTRA = [
    { name: 'empresa_id', sql: 'INT NULL' },
    { name: 'empresa_nombre', sql: "VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: 'item', sql: "VARCHAR(80) NOT NULL DEFAULT ''" },
    { name: 'condicion_requerimiento', sql: 'TEXT' },
    { name: 'actividades_accion', sql: 'TEXT' },
    { name: 'referencia_normativa', sql: "VARCHAR(500) NOT NULL DEFAULT ''" },
    { name: 'fecha_inicio', sql: 'DATE NULL' },
    { name: 'fecha_compromiso', sql: 'DATE NULL' },
    { name: 'entregables', sql: 'TEXT' },
    { name: 'activo', sql: 'TINYINT(1) NOT NULL DEFAULT 1' },
    { name: 'modificado_por', sql: 'VARCHAR(255) NULL' },
    { name: 'modificado_en', sql: 'DATETIME NULL' },
    { name: 'eliminado_por', sql: 'VARCHAR(255) NULL' },
    { name: 'eliminado_en', sql: 'DATETIME NULL' },
    /** IDs de usuario (trabajador) alineados a responsables; método infalible de ownership. */
    { name: 'responsable_usuario_ids', sql: 'TEXT NULL' }
];

/** Fecha/hora actual en zona America/Mexico_City para auditoría (YYYY-MM-DD HH:mm:ss). */
function fechaHoraMexicoMySQL(fechaBase = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(fechaBase);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function normalizarUsuarioAuditoria(valor) {
    const nombre = String(valor || '').trim();
    return nombre || 'Usuario';
}

function idActividadValido(valor) {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizar(texto = '') {
    return String(texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    const crudo = String(fecha).trim();
    const iso = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = crudo.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        let year = dmy[3];
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
    }
    return crudo.slice(0, 10);
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function parsearAvance(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return 0;
    let n = Number(crudo);
    if (!Number.isFinite(n)) return 0;
    if (n > 0 && n <= 1) n *= 100;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
}

function normalizarIndicadorAvance(valor) {
    const avance = parsearAvance(valor);
    return INDICADORES_AVANCE.reduce((prev, curr) =>
        (Math.abs(curr - avance) < Math.abs(prev - avance) ? curr : prev), 0);
}

function estatusDesdeAvance(avance) {
    const n = parsearAvance(avance);
    if (n >= 100) return 'Concluido';
    if (n >= 75) return 'En revisión';
    if (n > 0) return 'En proceso';
    return 'No iniciado';
}

function normalizarPrioridad(valor) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const clave = normalizar(limpio);
    if (PRIORIDADES_LEGACY[clave]) return PRIORIDADES_LEGACY[clave];
    const encontrado = PRIORIDADES_VALIDAS.find((op) => normalizar(op) === clave);
    return encontrado || limpio;
}

function normalizarOpcion(valor, opciones) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const encontrado = opciones.find((op) => normalizar(op) === normalizar(limpio));
    return encontrado || limpio;
}

function parseResponsables(valor) {
    const s = String(valor || '').trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map((x) => String(x || '').trim()).filter(Boolean);
            }
        } catch (_error) {
            /* legacy / texto plano */
        }
    }
    return s.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
}

function serializeResponsables(valor) {
    let lista = [];
    if (Array.isArray(valor)) {
        lista = valor;
    } else if (valor && typeof valor === 'object') {
        if (Array.isArray(valor.responsables)) lista = valor.responsables;
        else lista = parseResponsables(valor.responsable);
    } else {
        lista = parseResponsables(valor);
    }

    const unique = [];
    const seen = new Set();
    for (const nombre of lista) {
        const limpio = String(nombre || '').trim();
        if (!limpio) continue;
        const key = limpio.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(limpio);
    }
    return unique.join(RESPONSABLE_SEP);
}

function parseResponsableUsuarioIds(valor) {
    if (Array.isArray(valor)) {
        return valor
            .map((x) => Number(x))
            .filter((n) => Number.isInteger(n) && n > 0);
    }
    const s = String(valor || '').trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((x) => Number(x))
                    .filter((n) => Number.isInteger(n) && n > 0);
            }
        } catch (_error) {
            /* texto plano */
        }
    }
    return s.split(/\s*\|\s*/)
        .map((x) => Number(String(x || '').trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
}

function serializeResponsableUsuarioIds(valor) {
    const unique = [];
    const seen = new Set();
    for (const id of parseResponsableUsuarioIds(valor)) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }
    return unique.length ? unique.join(RESPONSABLE_SEP) : null;
}

function mapRowToActividad(row) {
    const avance = parsearAvance(row.avance);
    return {
        id: row.control_proyecto_id,
        empresaId: row.empresa_id ? Number(row.empresa_id) : null,
        empresaNombre: String(row.empresa_nombre || '').trim(),
        folio: String(row.folio || '').trim(),
        nombreProyecto: String(row.nombre_proyecto || '').trim(),
        item: String(row.item || '').trim(),
        condicionRequerimiento: String(row.condicion_requerimiento || '').trim(),
        actividadesAccion: String(row.actividades_accion || '').trim(),
        referenciaNormativa: String(row.referencia_normativa || '').trim(),
        responsable: serializeResponsables(row.responsable),
        responsableUsuarioIds: parseResponsableUsuarioIds(row.responsable_usuario_ids),
        fechaInicio: row.fecha_inicio ? formatearFechaIso(row.fecha_inicio) : '',
        fechaCompromiso: row.fecha_compromiso ? formatearFechaIso(row.fecha_compromiso) : '',
        entregables: String(row.entregables || '').trim(),
        prioridad: String(row.prioridad || '').trim(),
        estatus: String(row.estatus || '').trim() || estatusDesdeAvance(avance),
        avance,
        activo: row.activo == null ? true : Boolean(Number(row.activo)),
        modificadoPor: row.modificado_por || null,
        modificadoEn: row.modificado_en || null,
        eliminadoPor: row.eliminado_por || null,
        eliminadoEn: row.eliminado_en || null,
        updatedAt: row.updated_at || null,
        createdAt: row.created_at || null
    };
}

function sanitizarActividad(item) {
    const avance = normalizarIndicadorAvance(item?.avance);
    const estatusEntrada = normalizarOpcion(item?.estatus, ESTATUS_VALIDOS);
    const idsEntrada = item?.responsableUsuarioIds
        ?? item?.responsable_usuario_ids
        ?? item?.responsableUsuarioId
        ?? item?.responsable_usuario_id;
    return {
        id: idActividadValido(item?.id ?? item?.control_proyecto_id),
        empresaId: item?.empresaId || item?.empresa_id ? Number(item?.empresaId || item?.empresa_id) : null,
        empresaNombre: String(item?.empresaNombre || item?.empresa_nombre || '').trim(),
        folio: String(item?.folio || '').trim(),
        nombreProyecto: String(item?.nombreProyecto || '').trim(),
        item: String(item?.item || '').trim(),
        condicionRequerimiento: String(item?.condicionRequerimiento || '').trim(),
        actividadesAccion: String(item?.actividadesAccion || '').trim(),
        referenciaNormativa: String(item?.referenciaNormativa || '').trim(),
        responsable: serializeResponsables(item?.responsables ?? item?.responsable),
        responsableUsuarioIds: serializeResponsableUsuarioIds(idsEntrada),
        fechaInicio: formatearFechaIso(item?.fechaInicio) || null,
        fechaCompromiso: formatearFechaIso(item?.fechaCompromiso) || null,
        entregables: String(item?.entregables || '').trim(),
        prioridad: normalizarPrioridad(item?.prioridad),
        estatus: estatusEntrada || estatusDesdeAvance(avance),
        avance
    };
}

function esActividadVacia(item) {
    const p = sanitizarActividad(item);
    return !p.empresaId
        && !p.empresaNombre
        && !p.folio
        && !p.nombreProyecto
        && !p.item
        && !p.condicionRequerimiento
        && !p.actividadesAccion
        && !p.referenciaNormativa
        && !p.responsable
        && !p.prioridad
        && !p.estatus
        && !p.avance
        && !p.entregables;
}

function esFilaLegacyBitacoraF14(item) {
    const p = sanitizarActividad(item);
    const folioPm = /^PM-\d{6}-\d+/i.test(p.folio);
    const sinDetalle = !p.item && !p.condicionRequerimiento && !p.actividadesAccion
        && !p.referenciaNormativa && !p.fechaInicio && !p.fechaCompromiso && !p.entregables;
    return folioPm && sinDetalle;
}

function sanitizarListaActividades(lista, opciones = {}) {
    if (!Array.isArray(lista)) return [];
    return lista
        .map((item) => sanitizarActividad(item))
        .filter((item) => !esActividadVacia(item))
        .filter((item) => !opciones.excluirLegacyF14 || !esFilaLegacyBitacoraF14(item));
}

async function asegurarColumnasExtra(pool) {
    for (const col of COLUMNAS_EXTRA) {
        try {
            await pool.query(`ALTER TABLE sgc_control_proyectos ADD COLUMN ${col.name} ${col.sql}`);
        } catch (error) {
            if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
    }
}

async function asegurarTablaControlProyectos(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos (
            control_proyecto_id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NULL,
            empresa_nombre VARCHAR(255) NOT NULL DEFAULT '',
            folio VARCHAR(80) NOT NULL DEFAULT '',
            nombre_proyecto VARCHAR(255) NOT NULL DEFAULT '',
            item VARCHAR(80) NOT NULL DEFAULT '',
            condicion_requerimiento TEXT,
            actividades_accion TEXT,
            referencia_normativa VARCHAR(500) NOT NULL DEFAULT '',
            responsable TEXT NOT NULL,
            fecha_inicio DATE NULL,
            fecha_compromiso DATE NULL,
            entregables TEXT,
            prioridad VARCHAR(80) NOT NULL DEFAULT '',
            estatus VARCHAR(80) NOT NULL DEFAULT '',
            avance TINYINT UNSIGNED NOT NULL DEFAULT 0,
            orden INT NOT NULL DEFAULT 0,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            modificado_por VARCHAR(255) NULL,
            modificado_en DATETIME NULL,
            eliminado_por VARCHAR(255) NULL,
            eliminado_en DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_sgc_control_proyectos_empresa (empresa_id),
            INDEX idx_sgc_control_proyectos_orden (orden),
            INDEX idx_sgc_control_proyectos_estatus (estatus),
            INDEX idx_sgc_control_proyectos_prioridad (prioridad),
            INDEX idx_sgc_control_proyectos_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnasExtra(pool);
    try {
        await pool.query('ALTER TABLE sgc_control_proyectos MODIFY COLUMN responsable TEXT NOT NULL');
    } catch (_error) {
        /* ya migrada o sin privilegios — se ignora */
    }
}

function normalizarEmpresaId(empresaId) {
    const n = Number(empresaId || 0);
    return Number.isInteger(n) && n > 0 ? n : null;
}

async function obtenerActividades(pool, filtros = {}) {
    await asegurarTablaControlProyectos(pool);
    const empresaId = normalizarEmpresaId(filtros.empresaId);
    const incluirInactivos = Boolean(filtros.incluirInactivos);
    const soloInactivos = Boolean(filtros.soloInactivos);
    const params = [];
    const whereParts = [];

    if (soloInactivos) {
        whereParts.push('activo = 0');
    } else if (!incluirInactivos) {
        whereParts.push('activo = 1');
    }
    if (empresaId) {
        whereParts.push('empresa_id = ?');
        params.push(empresaId);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const [rows] = await pool.query(`
        SELECT
            control_proyecto_id,
            empresa_id,
            empresa_nombre,
            folio,
            nombre_proyecto,
            item,
            condicion_requerimiento,
            actividades_accion,
            referencia_normativa,
            responsable,
            responsable_usuario_ids,
            fecha_inicio,
            fecha_compromiso,
            entregables,
            prioridad,
            estatus,
            avance,
            orden,
            activo,
            modificado_por,
            modificado_en,
            eliminado_por,
            eliminado_en,
            created_at,
            updated_at
        FROM sgc_control_proyectos
        ${where}
        ORDER BY empresa_nombre ASC, nombre_proyecto ASC, orden ASC, control_proyecto_id ASC
    `, params);

    return rows.map(mapRowToActividad);
}

async function insertarActividad(pool, actividadRaw, orden, auditoria = {}) {
    const p = sanitizarActividad(actividadRaw);
    const usuario = normalizarUsuarioAuditoria(auditoria.usuarioNombre);
    const ahora = auditoria.fechaHora || fechaHoraMexicoMySQL();
    const [result] = await pool.query(
        `INSERT INTO sgc_control_proyectos
            (empresa_id, empresa_nombre, folio, nombre_proyecto, item, condicion_requerimiento, actividades_accion,
             referencia_normativa, responsable, responsable_usuario_ids, fecha_inicio, fecha_compromiso, entregables,
             prioridad, estatus, avance, orden, activo, modificado_por, modificado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
            p.empresaId,
            p.empresaNombre,
            p.folio,
            p.nombreProyecto,
            p.item,
            p.condicionRequerimiento || null,
            p.actividadesAccion || null,
            p.referenciaNormativa,
            p.responsable,
            p.responsableUsuarioIds,
            p.fechaInicio,
            p.fechaCompromiso,
            p.entregables || null,
            p.prioridad,
            p.estatus,
            p.avance,
            orden,
            usuario,
            ahora
        ]
    );
    return {
        ...p,
        id: result.insertId,
        responsableUsuarioIds: parseResponsableUsuarioIds(p.responsableUsuarioIds),
        activo: true,
        modificadoPor: usuario,
        modificadoEn: ahora
    };
}

async function actualizarActividad(pool, actividadRaw, orden, auditoria = {}) {
    const p = sanitizarActividad(actividadRaw);
    const id = idActividadValido(p.id);
    if (!id) return null;

    const usuario = normalizarUsuarioAuditoria(auditoria.usuarioNombre);
    const ahora = auditoria.fechaHora || fechaHoraMexicoMySQL();

    await pool.query(
        `UPDATE sgc_control_proyectos
         SET empresa_id = ?,
             empresa_nombre = ?,
             folio = ?,
             nombre_proyecto = ?,
             item = ?,
             condicion_requerimiento = ?,
             actividades_accion = ?,
             referencia_normativa = ?,
             responsable = ?,
             responsable_usuario_ids = ?,
             fecha_inicio = ?,
             fecha_compromiso = ?,
             entregables = ?,
             prioridad = ?,
             estatus = ?,
             avance = ?,
             orden = ?,
             activo = 1,
             modificado_por = ?,
             modificado_en = ?,
             eliminado_por = NULL,
             eliminado_en = NULL
         WHERE control_proyecto_id = ?`,
        [
            p.empresaId,
            p.empresaNombre,
            p.folio,
            p.nombreProyecto,
            p.item,
            p.condicionRequerimiento || null,
            p.actividadesAccion || null,
            p.referenciaNormativa,
            p.responsable,
            p.responsableUsuarioIds,
            p.fechaInicio,
            p.fechaCompromiso,
            p.entregables || null,
            p.prioridad,
            p.estatus,
            p.avance,
            orden,
            usuario,
            ahora,
            id
        ]
    );
    return {
        ...p,
        id,
        responsableUsuarioIds: parseResponsableUsuarioIds(p.responsableUsuarioIds),
        activo: true,
        modificadoPor: usuario,
        modificadoEn: ahora
    };
}

async function softDeleteActividades(pool, ids, auditoria = {}) {
    const lista = (Array.isArray(ids) ? ids : [])
        .map((id) => idActividadValido(id))
        .filter(Boolean);
    if (!lista.length) return 0;

    const usuario = normalizarUsuarioAuditoria(auditoria.usuarioNombre);
    const ahora = auditoria.fechaHora || fechaHoraMexicoMySQL();
    const placeholders = lista.map(() => '?').join(', ');

    const [result] = await pool.query(
        `UPDATE sgc_control_proyectos
         SET activo = 0,
             eliminado_por = ?,
             eliminado_en = ?,
             modificado_por = ?,
             modificado_en = ?
         WHERE control_proyecto_id IN (${placeholders})
           AND activo = 1`,
        [usuario, ahora, usuario, ahora, ...lista]
    );
    return result?.affectedRows || 0;
}

/**
 * Guarda el listado activo sin borrar filas de BD.
 * - Actualiza por id las actividades que siguen en el payload
 * - Inserta las nuevas
 * La ausencia de una actividad en el payload nunca se interpreta como eliminación.
 */
async function reemplazarActividades(pool, actividadesRaw, opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const actividades = sanitizarListaActividades(actividadesRaw, { excluirLegacyF14: true });
    const empresaId = normalizarEmpresaId(opciones.empresaId);
    const auditoria = {
        usuarioNombre: normalizarUsuarioAuditoria(opciones.usuarioNombre),
        fechaHora: opciones.fechaHora || fechaHoraMexicoMySQL()
    };

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const whereParts = ['activo = 1'];
        const params = [];
        if (empresaId) {
            whereParts.push('empresa_id = ?');
            params.push(empresaId);
        }

        const [existentes] = await conn.query(
            `SELECT control_proyecto_id
             FROM sgc_control_proyectos
             WHERE ${whereParts.join(' AND ')}`,
            params
        );
        const idsExistentes = new Set(
            existentes.map((row) => Number(row.control_proyecto_id)).filter((id) => Number.isInteger(id) && id > 0)
        );
        const resultado = [];

        for (let i = 0; i < actividades.length; i++) {
            const actividad = actividades[i];
            const id = idActividadValido(actividad.id);
            const orden = i + 1;

            if (id && idsExistentes.has(id)) {
                const actualizada = await actualizarActividad(conn, actividad, orden, auditoria);
                if (actualizada) {
                    resultado.push(actualizada);
                }
            } else {
                const creada = await insertarActividad(conn, { ...actividad, id: null }, orden, auditoria);
                resultado.push(creada);
            }
        }

        await conn.commit();
        return resultado;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function desactivarActividades(pool, idsRaw = [], opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const ids = (Array.isArray(idsRaw) ? idsRaw : [])
        .map((id) => idActividadValido(id))
        .filter(Boolean);
    if (!ids.length) {
        const err = new Error('Indica al menos una actividad para eliminar.');
        err.statusCode = 400;
        throw err;
    }

    const desactivadas = await softDeleteActividades(pool, ids, opciones);
    return {
        desactivadas,
        ids,
        modificadoPor: normalizarUsuarioAuditoria(opciones.usuarioNombre),
        modificadoEn: opciones.fechaHora || fechaHoraMexicoMySQL()
    };
}

async function crearProyecto(pool, body = {}, opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const p = sanitizarActividad(body);
    const auditoria = {
        usuarioNombre: normalizarUsuarioAuditoria(opciones.usuarioNombre || body?.usuarioNombre),
        fechaHora: opciones.fechaHora || fechaHoraMexicoMySQL()
    };

    if (!p.nombreProyecto) {
        const err = new Error('El nombre del proyecto es obligatorio.');
        err.statusCode = 400;
        throw err;
    }

    if (!p.folio) {
        const hoy = new Date();
        const dd = String(hoy.getDate()).padStart(2, '0');
        const mm = String(hoy.getMonth() + 1).padStart(2, '0');
        const yy = String(hoy.getFullYear()).slice(-2);
        const [countRows] = await pool.query(
            'SELECT COUNT(DISTINCT folio) AS total FROM sgc_control_proyectos WHERE activo = 1'
        );
        const seq = String((countRows[0]?.total || 0) + 1).padStart(3, '0');
        p.folio = `PY-${dd}${mm}${yy}-${seq}`;
    }

    const [ordenRows] = await pool.query(
        'SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM sgc_control_proyectos WHERE activo = 1'
    );
    return insertarActividad(pool, p, Number(ordenRows[0]?.maxOrden || 0) + 1, auditoria);
}

function actividadesParaFormato(actividades) {
    return actividades.map((p) => ({
        id: p.id,
        empresaId: p.empresaId,
        empresaNombre: p.empresaNombre,
        folio: p.folio,
        nombreProyecto: p.nombreProyecto,
        item: p.item,
        condicionRequerimiento: p.condicionRequerimiento,
        actividadesAccion: p.actividadesAccion,
        referenciaNormativa: p.referenciaNormativa,
        responsable: p.responsable,
        responsableUsuarioIds: Array.isArray(p.responsableUsuarioIds)
            ? p.responsableUsuarioIds
            : parseResponsableUsuarioIds(p.responsableUsuarioIds),
        fechaInicio: p.fechaInicio,
        fechaCompromiso: p.fechaCompromiso,
        entregables: p.entregables,
        prioridad: p.prioridad,
        estatus: p.estatus,
        avance: parsearAvance(p.avance),
        activo: p.activo !== false,
        modificadoPor: p.modificadoPor || null,
        modificadoEn: p.modificadoEn || null,
        eliminadoPor: p.eliminadoPor || null,
        eliminadoEn: p.eliminadoEn || null,
        createdAt: p.createdAt || null,
        updatedAt: p.updatedAt || null
    }));
}

function claveProyecto(p) {
    return [
        p.empresaId || p.empresaNombre || 'sin-empresa',
        normalizar(p.folio || p.nombreProyecto || 'sin-proyecto')
    ].join('|');
}

function agruparProyectos(actividades) {
    const mapa = new Map();
    for (const actividad of actividades) {
        const key = claveProyecto(actividad);
        if (!mapa.has(key)) {
            mapa.set(key, {
                empresaId: actividad.empresaId,
                empresaNombre: actividad.empresaNombre,
                folio: actividad.folio,
                nombreProyecto: actividad.nombreProyecto || actividad.folio || 'Proyecto sin nombre',
                responsable: actividad.responsable || 'Sin asignar',
                prioridad: actividad.prioridad || 'Ninguna',
                estatus: 'No iniciado',
                avance: 0,
                fechaInicio: actividad.fechaInicio,
                fechaCompromiso: actividad.fechaCompromiso,
                actividades: []
            });
        }
        const proyecto = mapa.get(key);
        proyecto.actividades.push(actividad);
        if (!proyecto.fechaInicio || (actividad.fechaInicio && actividad.fechaInicio < proyecto.fechaInicio)) {
            proyecto.fechaInicio = actividad.fechaInicio;
        }
        if (!proyecto.fechaCompromiso || (actividad.fechaCompromiso && actividad.fechaCompromiso > proyecto.fechaCompromiso)) {
            proyecto.fechaCompromiso = actividad.fechaCompromiso;
        }
        if (actividad.prioridad && ordenPrioridad(actividad.prioridad) < ordenPrioridad(proyecto.prioridad)) {
            proyecto.prioridad = actividad.prioridad;
        }
        if (actividad.responsable && proyecto.responsable === 'Sin asignar') {
            proyecto.responsable = actividad.responsable;
        }
    }

    return Array.from(mapa.values()).map((proyecto) => {
        const total = proyecto.actividades.length || 1;
        const sumaAvance = proyecto.actividades.reduce((acc, a) => acc + parsearAvance(a.avance), 0);
        const avance = Math.round(sumaAvance / total);
        const estados = proyecto.actividades.map((a) => normalizar(a.estatus || estatusDesdeAvance(a.avance)));
        let estatus = 'No iniciado';
        if (estados.every((e) => e === 'concluido')) estatus = 'Concluido';
        else if (estados.some((e) => e === 'en revision' || e === 'en revisión')) estatus = 'En revisión';
        else if (estados.some((e) => e === 'en proceso' || e === 'concluido')) estatus = 'En proceso';

        return { ...proyecto, avance, estatus };
    });
}

function ordenPrioridad(prioridad) {
    const n = normalizarPrioridad(prioridad);
    const orden = {
        'muy prioritaria': 0,
        prioritaria: 1,
        media: 2,
        baja: 3,
        'muy baja': 4,
        ninguna: 5
    };
    return orden[normalizar(n)] ?? 6;
}

function resumir(actividades) {
    const proyectos = agruparProyectos(actividades);
    const porEstatus = { Concluido: 0, 'En revisión': 0, 'En proceso': 0, 'No iniciado': 0 };
    const porPrioridad = PRIORIDADES_VALIDAS.reduce((acc, item) => ({ ...acc, [item]: 0 }), {});
    let sumaAvance = 0;

    for (const proyecto of proyectos) {
        porEstatus[proyecto.estatus] = (porEstatus[proyecto.estatus] || 0) + 1;
        const prioridad = normalizarPrioridad(proyecto.prioridad) || 'Ninguna';
        if (Object.prototype.hasOwnProperty.call(porPrioridad, prioridad)) {
            porPrioridad[prioridad] += 1;
        }
        sumaAvance += proyecto.avance;
    }

    return {
        total: proyectos.length,
        totalActividades: actividades.length,
        concluidos: porEstatus.Concluido,
        enRevision: porEstatus['En revisión'],
        enProceso: porEstatus['En proceso'],
        noIniciados: porEstatus['No iniciado'],
        avancePromedio: proyectos.length ? Math.round(sumaAvance / proyectos.length) : 0,
        porEstatus,
        porPrioridad,
        proyectos
    };
}

function construirRespuestaFormato(actividades) {
    const fechaElaboracion = fechaHoyIso();
    return {
        codigo: CODIGO_FORMATO,
        revision: REV_FORMATO,
        titulo: 'Control de Proyectos',
        datos: {
            fechaElaboracion,
            proyectos: actividadesParaFormato(actividades)
        },
        fechaElaboracionOriginal: fechaElaboracion,
        fechaModificacionContenido: fechaElaboracion,
        contenidoModificado: false
    };
}

async function cargarFormato(pool, filtros = {}) {
    const actividades = await obtenerActividades(pool, filtros);
    return construirRespuestaFormato(actividades);
}

async function guardarFormato(pool, body = {}) {
    const datos = body && typeof body === 'object' && body.datos ? body.datos : body;
    const actividadesEntrada = Array.isArray(datos?.proyectos) ? datos.proyectos : [];
    const actividades = await reemplazarActividades(pool, actividadesEntrada, {
        empresaId: body?.empresaId,
        usuarioNombre: body?.usuarioNombre,
        fechaHora: body?.fechaHora
    });
    return construirRespuestaFormato(actividades);
}

async function sincronizarDesdeDrive(pool) {
    return cargarFormato(pool);
}

async function actualizarPlantillaDesdeSistema(pool) {
    return cargarFormato(pool);
}

async function obtenerResumenMejora(pool) {
    const actividades = (await obtenerActividades(pool)).filter((p) => !esFilaLegacyBitacoraF14(p));
    return resumir(actividades);
}

async function obtenerDashboard(pool, filtros = {}) {
    const actividades = (await obtenerActividades(pool, filtros)).filter((p) => !esFilaLegacyBitacoraF14(p));
    const resumen = resumir(actividades);
    const proyectos = resumen.proyectos;

    const ahora = Date.now();
    const haceSieteDias = ahora - (7 * 24 * 60 * 60 * 1000);
    const actualizadosUltimos7Dias = actividades.filter((p) => p.updatedAt && new Date(p.updatedAt).getTime() >= haceSieteDias).length;

    const cargaPorResponsableMap = new Map();
    for (const actividad of actividades) {
        const responsables = parseResponsables(actividad.responsable);
        const nombres = responsables.length ? responsables : ['Sin asignar'];
        for (const responsable of nombres) {
            const acumulado = cargaPorResponsableMap.get(responsable) || {
                total: 0,
                sumaAvance: 0,
                concluidas: 0
            };
            acumulado.total += 1;
            acumulado.sumaAvance += parsearAvance(actividad.avance);
            if (normalizar(actividad.estatus) === 'concluido' || parsearAvance(actividad.avance) >= 100) {
                acumulado.concluidas += 1;
            }
            cargaPorResponsableMap.set(responsable, acumulado);
        }
    }

    const maxProyectos = Math.max(1, ...Array.from(cargaPorResponsableMap.values()).map((d) => d.total));
    const cargaEquipo = Array.from(cargaPorResponsableMap.entries())
        .map(([responsable, data]) => ({
            responsable,
            total: data.total,
            maxProyectos,
            avancePromedio: data.total ? Math.round(data.sumaAvance / data.total) : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    const progresoActividades = cargaEquipo.map((item) => ({
        responsable: item.responsable,
        totalActividades: item.total,
        concluidas: cargaPorResponsableMap.get(item.responsable)?.concluidas || 0,
        avancePromedio: item.avancePromedio
    }));

    const empresasMap = new Map();
    for (const actividad of actividades) {
        const id = actividad.empresaId || 0;
        const nombre = actividad.empresaNombre || (id ? `Empresa #${id}` : 'Sin empresa');
        const actual = empresasMap.get(id || nombre) || { empresaId: actividad.empresaId, nombreEmpresa: nombre, totalActividades: 0 };
        actual.totalActividades += 1;
        empresasMap.set(id || nombre, actual);
    }

    return {
        kpis: {
            finalizados: resumen.concluidos,
            actualizados: actualizadosUltimos7Dias,
            creados: resumen.total,
            actividades: resumen.totalActividades,
            vencenPronto: actividades.filter((p) => p.fechaCompromiso && new Date(p.fechaCompromiso).getTime() <= ahora && normalizar(p.estatus) !== 'concluido').length
        },
        resumen,
        empresasResumen: Array.from(empresasMap.values()),
        distribuciones: {
            porEstatus: [
                { etiqueta: 'Concluido', total: resumen.porEstatus.Concluido, color: '#22c55e' },
                { etiqueta: 'En revisión', total: resumen.porEstatus['En revisión'], color: '#a855f7' },
                { etiqueta: 'En proceso', total: resumen.porEstatus['En proceso'], color: '#38bdf8' },
                { etiqueta: 'No iniciado', total: resumen.porEstatus['No iniciado'], color: '#f59e0b' }
            ],
            porPrioridad: PRIORIDADES_VALIDAS.map((etiqueta) => ({
                etiqueta,
                total: resumen.porPrioridad[etiqueta] || 0,
                color: COLORES_PRIORIDAD[etiqueta] || '#94a3b8'
            }))
        },
        cargaEquipo,
        progresoActividades,
        proyectos,
        actividades: actividadesParaFormato(actividades)
    };
}

async function listarEliminados(pool, filtros = {}) {
    const soloEliminadas = await obtenerActividades(pool, {
        empresaId: filtros.empresaId,
        soloInactivos: true
    });
    const proyectos = agruparProyectos(soloEliminadas).map((proyecto) => ({
        ...proyecto,
        clave: claveProyecto(proyecto),
        totalActividades: proyecto.actividades.length,
        eliminadoPor: proyecto.actividades.map((a) => a.eliminadoPor).find(Boolean) || null,
        eliminadoEn: proyecto.actividades
            .map((a) => a.eliminadoEn)
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || null,
        actividades: actividadesParaFormato(proyecto.actividades)
    }));

    return {
        totalActividades: soloEliminadas.length,
        totalProyectos: proyectos.length,
        proyectos,
        actividades: actividadesParaFormato(soloEliminadas)
    };
}

async function restaurarActividades(pool, idsRaw = [], opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const ids = (Array.isArray(idsRaw) ? idsRaw : [])
        .map((id) => idActividadValido(id))
        .filter(Boolean);
    if (!ids.length) {
        const err = new Error('Indica al menos una actividad para restaurar.');
        err.statusCode = 400;
        throw err;
    }

    const usuario = normalizarUsuarioAuditoria(opciones.usuarioNombre);
    const ahora = opciones.fechaHora || fechaHoraMexicoMySQL();
    const placeholders = ids.map(() => '?').join(', ');

    const [result] = await pool.query(
        `UPDATE sgc_control_proyectos
         SET activo = 1,
             eliminado_por = NULL,
             eliminado_en = NULL,
             modificado_por = ?,
             modificado_en = ?
         WHERE control_proyecto_id IN (${placeholders})
           AND activo = 0`,
        [usuario, ahora, ...ids]
    );

    return {
        restauradas: result?.affectedRows || 0,
        ids,
        modificadoPor: usuario,
        modificadoEn: ahora
    };
}

async function restaurarProyecto(pool, body = {}, opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const empresaId = normalizarEmpresaId(body.empresaId);
    const folio = String(body.folio || '').trim();
    const nombreProyecto = String(body.nombreProyecto || '').trim();

    if (!folio && !nombreProyecto) {
        const err = new Error('Indica folio o nombre del proyecto a restaurar.');
        err.statusCode = 400;
        throw err;
    }

    const whereParts = ['activo = 0'];
    const params = [];
    if (empresaId) {
        whereParts.push('empresa_id = ?');
        params.push(empresaId);
    } else if (body.empresaId === null || body.empresaId === '') {
        whereParts.push('empresa_id IS NULL');
    }
    if (folio) {
        whereParts.push('folio = ?');
        params.push(folio);
    }
    if (nombreProyecto) {
        whereParts.push('nombre_proyecto = ?');
        params.push(nombreProyecto);
    }

    const [rows] = await pool.query(
        `SELECT control_proyecto_id
         FROM sgc_control_proyectos
         WHERE ${whereParts.join(' AND ')}`,
        params
    );
    const ids = rows.map((r) => r.control_proyecto_id);
    return restaurarActividades(pool, ids, opciones);
}

module.exports = {
    CODIGO_FORMATO,
    REV_FORMATO,
    PRIORIDADES_VALIDAS,
    ESTATUS_VALIDOS,
    INDICADORES_AVANCE,
    asegurarTablaControlProyectos,
    obtenerProyectos: obtenerActividades,
    crearProyecto,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    obtenerResumenMejora,
    obtenerDashboard,
    listarEliminados,
    desactivarActividades,
    restaurarActividades,
    restaurarProyecto,
    fechaHoraMexicoMySQL
};
