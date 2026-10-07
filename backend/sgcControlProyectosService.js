/**
 * Control de Proyectos — flujo propio del sistema.
 *
 * Modelo operativo:
 *   Empresa -> Proyectos -> Actividades
 *
 * Una fila en `sgc_control_proyectos` representa una actividad. El proyecto se
 * agrupa por empresa + folio/nombre, para conservar datos históricos sin una
 * migración riesgosa de varias tablas.
 *
 * Cortafuegos:
 * - Solo se actualiza una actividad si hay cambios reales (por id).
 * - Un usuario solo puede modificar actividades de las que es responsable
 *   (salvo admin/root).
 * - Cada cambio guarda la versión anterior en sgc_control_proyectos_historial
 *   (retención 14 días).
 */
const crypto = require('crypto');
const CODIGO_FORMATO = 'CONTROL-PROYECTOS';
const REV_FORMATO = '02';
/** Días que se conservan las versiones en historial antes de purgar. */
const RETENCION_HISTORIAL_DIAS = 14;
const ROLES_PRIVILEGIO_UNIVERSAL = new Set(['root', 'administrador', 'super_admin', 'superadmin']);

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
    { name: 'observaciones', sql: 'TEXT' },
    { name: 'creado_por', sql: 'VARCHAR(255) NULL' },
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

function fechaIsoDesdePartes(anio, mes, dia) {
    let y = Number(anio);
    const m = Number(mes);
    const d = Number(dia);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    // Un Date.getYear() de 2024 devuelve 124. MySQL lo guarda como 0124 y al consultar
    // se ve "20 mar 124". Se restituye el siglo solo en ese rango.
    if (y >= 100 && y < 300) y += 1900;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Fecha calendario YYYY-MM-DD sin corrimiento de zona.
 * `new Date('YYYY-MM-DD')` es medianoche UTC y en México resta un día;
 * ese valor luego se volvía a guardar y la base quedaba modificada.
 */
function formatearFechaIso(fecha) {
    if (fecha == null || fecha === '') return '';

    if (!(fecha instanceof Date)) {
        const crudo = String(fecha).trim();
        if (!crudo) return '';
        const iso = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return fechaIsoDesdePartes(iso[1], iso[2], iso[3]);
        const dmy = crudo.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
        if (dmy) {
            let year = dmy[3];
            if (year.length === 2) year = `20${year}`;
            return fechaIsoDesdePartes(year, dmy[2], dmy[1]);
        }
    }

    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';

    // Solo una medianoche UTC (fecha sin hora) se lee en UTC. El DATE de MySQL
    // llega como medianoche local y debe conservar el día local.
    const medianocheUtc = d.getUTCHours() === 0
        && d.getUTCMinutes() === 0
        && d.getUTCSeconds() === 0
        && d.getUTCMilliseconds() === 0;
    if (medianocheUtc && d.getHours() !== 0) {
        return fechaIsoDesdePartes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return fechaIsoDesdePartes(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function parsearAvance(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return 0;
    let n = Number(crudo);
    if (!Number.isFinite(n)) return 0;
    // Solo fracciones reales (0.75). El entero 1 es 1 %, no 100 %.
    if (n > 0 && n < 1) n *= 100;
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

function avanceDesdeEstatus(estatus) {
    const n = normalizar(estatus);
    if (n === 'concluido') return 100;
    if (n === 'en revision' || n === 'en revisión') return 75;
    if (n === 'en proceso') return 50;
    return 0;
}

function estatusDesdeAvance(avance) {
    const n = parsearAvance(avance);
    if (n >= 100) return 'Concluido';
    if (n >= 75) return 'En revisión';
    if (n > 0) return 'En proceso';
    return 'No iniciado';
}

/** El estatus elegido manda. Los alias de la interfaz no se reinterpretan con el porcentaje. */
function canonizarEstatus(valor) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const n = normalizar(limpio);
    if (n === 'concluido' || n === 'listo' || n === 'finalizado' || n === 'hecho') return 'Concluido';
    if (n === 'en revision' || n === 'revision') return 'En revisión';
    if (n === 'en proceso' || n === 'en curso' || n === 'en progreso') return 'En proceso';
    if (n === 'no iniciado' || n === 'pendiente' || n === 'sin iniciar' || n === 'por hacer') return 'No iniciado';
    const encontrado = ESTATUS_VALIDOS.find((op) => normalizar(op) === n);
    return encontrado || limpio;
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
    const estatusGuardado = canonizarEstatus(row.estatus);
    const avance = estatusGuardado && ESTATUS_VALIDOS.includes(estatusGuardado)
        ? avanceDesdeEstatus(estatusGuardado)
        : parsearAvance(row.avance);
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
        observaciones: String(row.observaciones || '').trim(),
        prioridad: String(row.prioridad || '').trim(),
        estatus: estatusGuardado || estatusDesdeAvance(avance),
        avance,
        orden: Number.isFinite(Number(row.orden)) ? Number(row.orden) : 0,
        activo: row.activo == null ? true : Boolean(Number(row.activo)),
        modificadoPor: row.modificado_por || null,
        modificadoEn: row.modificado_en || null,
        creadoPor: row.creado_por || null,
        eliminadoPor: row.eliminado_por || null,
        eliminadoEn: row.eliminado_en || null,
        updatedAt: row.updated_at || null,
        createdAt: row.created_at || null
    };
}

function sanitizarActividad(item) {
    const estatusEntrada = canonizarEstatus(item?.estatus);
    const avance = estatusEntrada && ESTATUS_VALIDOS.includes(estatusEntrada)
        ? avanceDesdeEstatus(estatusEntrada)
        : normalizarIndicadorAvance(item?.avance);
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
        observaciones: String(item?.observaciones || '').trim(),
        prioridad: normalizarPrioridad(item?.prioridad),
        estatus: estatusEntrada || estatusDesdeAvance(avance),
        avance,
        orden: (() => {
            const n = Number(item?.orden);
            return Number.isInteger(n) && n > 0 ? n : 0;
        })()
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

async function asegurarTablaHistorial(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos_historial (
            historial_id INT AUTO_INCREMENT PRIMARY KEY,
            control_proyecto_id INT NOT NULL,
            version_token VARCHAR(64) NULL,
            empresa_id INT NULL,
            folio VARCHAR(80) NULL,
            nombre_proyecto VARCHAR(255) NULL,
            snapshot_json LONGTEXT NULL,
            campo VARCHAR(80) NOT NULL,
            etiqueta VARCHAR(120) NOT NULL DEFAULT '',
            valor_anterior TEXT NULL,
            valor_nuevo TEXT NULL,
            modificado_por VARCHAR(255) NULL,
            modificado_en DATETIME NOT NULL,
            INDEX idx_cp_hist_actividad (control_proyecto_id),
            INDEX idx_cp_hist_fecha (modificado_en),
            INDEX idx_cp_hist_version (version_token),
            INDEX idx_cp_hist_folio (folio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const columnasExtraHistorial = [
        { name: 'version_token', sql: 'VARCHAR(64) NULL' },
        { name: 'empresa_id', sql: 'INT NULL' },
        { name: 'folio', sql: 'VARCHAR(80) NULL' },
        { name: 'nombre_proyecto', sql: 'VARCHAR(255) NULL' },
        { name: 'snapshot_json', sql: 'LONGTEXT NULL' }
    ];
    for (const col of columnasExtraHistorial) {
        try {
            await pool.query(`ALTER TABLE sgc_control_proyectos_historial ADD COLUMN ${col.name} ${col.sql}`);
        } catch (error) {
            if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
    }

    try {
        await pool.query('CREATE INDEX idx_cp_hist_version ON sgc_control_proyectos_historial (version_token)');
    } catch (_error) { /* índice ya existe */ }
    try {
        await pool.query('CREATE INDEX idx_cp_hist_folio ON sgc_control_proyectos_historial (folio)');
    } catch (_error) { /* índice ya existe */ }

    await purgarHistorialAntiguo(pool);
}

async function purgarHistorialAntiguo(pool) {
    try {
        await pool.query(
            `DELETE FROM sgc_control_proyectos_historial
             WHERE modificado_en < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [RETENCION_HISTORIAL_DIAS]
        );
    } catch (error) {
        console.warn('[control-proyectos] No se pudo purgar historial antiguo:', error.message);
    }
}

const CAMPOS_HISTORIAL = [
    { key: 'actividadesAccion', col: 'actividades_accion', etiqueta: 'Actividad' },
    { key: 'referenciaNormativa', col: 'referencia_normativa', etiqueta: 'Referencia' },
    { key: 'responsable', col: 'responsable', etiqueta: 'Responsable' },
    { key: 'fechaInicio', col: 'fecha_inicio', etiqueta: 'Fecha de inicio' },
    { key: 'fechaCompromiso', col: 'fecha_compromiso', etiqueta: 'Vencimiento' },
    { key: 'entregables', col: 'entregables', etiqueta: 'Entregables' },
    { key: 'observaciones', col: 'observaciones', etiqueta: 'Observaciones' },
    { key: 'prioridad', col: 'prioridad', etiqueta: 'Prioridad' },
    { key: 'estatus', col: 'estatus', etiqueta: 'Estatus' },
    { key: 'avance', col: 'avance', etiqueta: 'Avance' },
    { key: 'nombreProyecto', col: 'nombre_proyecto', etiqueta: 'Proyecto' },
    { key: 'orden', col: 'orden', etiqueta: 'Orden' }
];

function valorHistorialComparable(valor) {
    if (valor == null) return '';
    return String(valor).trim();
}

function snapshotActividadParaHistorial(actividad) {
    if (!actividad) return null;
    return {
        id: actividad.id || null,
        empresaId: actividad.empresaId || null,
        empresaNombre: actividad.empresaNombre || '',
        folio: actividad.folio || '',
        nombreProyecto: actividad.nombreProyecto || '',
        item: actividad.item || '',
        condicionRequerimiento: actividad.condicionRequerimiento || '',
        actividadesAccion: actividad.actividadesAccion || '',
        referenciaNormativa: actividad.referenciaNormativa || '',
        responsable: actividad.responsable || '',
        responsableUsuarioIds: Array.isArray(actividad.responsableUsuarioIds)
            ? actividad.responsableUsuarioIds
            : parseResponsableUsuarioIds(actividad.responsableUsuarioIds),
        fechaInicio: actividad.fechaInicio || '',
        fechaCompromiso: actividad.fechaCompromiso || '',
        entregables: actividad.entregables || '',
        observaciones: actividad.observaciones || '',
        prioridad: actividad.prioridad || '',
        estatus: actividad.estatus || '',
        avance: Number(actividad.avance) || 0,
        orden: Number(actividad.orden) || 0
    };
}

function detectarCambiosActividad(anterior, nuevo) {
    if (!anterior || !nuevo) return [];
    const cambios = [];
    for (const campo of CAMPOS_HISTORIAL) {
        const prev = valorHistorialComparable(anterior[campo.key]);
        const next = valorHistorialComparable(nuevo[campo.key]);
        if (prev === next) continue;
        cambios.push({
            key: campo.key,
            etiqueta: campo.etiqueta,
            valorAnterior: prev || null,
            valorNuevo: next || null
        });
    }
    return cambios;
}

function esPrivilegioUniversal(roles = []) {
    return (Array.isArray(roles) ? roles : [])
        .some((r) => ROLES_PRIVILEGIO_UNIVERSAL.has(String(r || '').toLowerCase()));
}

/**
 * Un usuario solo puede tocar actividades de las que es responsable (por ID).
 * Admin/root tienen privilegio universal. Actividades nuevas (sin id en BD) se permiten.
 */
function usuarioPuedeModificarFila(filaBd, opciones = {}) {
    if (opciones.esPrivilegioUniversal || esPrivilegioUniversal(opciones.roles)) return true;
    const uid = Number(opciones.usuarioId || 0);
    if (!Number.isInteger(uid) || uid <= 0) return false;
    const ids = parseResponsableUsuarioIds(
        filaBd?.responsable_usuario_ids ?? filaBd?.responsableUsuarioIds
    );
    if (ids.includes(uid)) return true;
    // Fallback por nombre si aún no hay IDs sincronizados.
    if (!ids.length && opciones.usuarioNombre) {
        const yo = normalizar(opciones.usuarioNombre);
        if (!yo || yo === 'usuario') return false;
        return parseResponsables(filaBd?.responsable).some((r) => {
            const nr = normalizar(r);
            return nr === yo || nr.includes(yo) || yo.includes(nr);
        });
    }
    return false;
}

function nuevoVersionToken() {
    return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

async function registrarCambiosHistorial(pool, id, anterior, nuevo, auditoria = {}, meta = {}) {
    if (!id || !anterior || !nuevo) return null;
    const cambios = detectarCambiosActividad(anterior, nuevo);
    if (!cambios.length) return null;

    const usuario = normalizarUsuarioAuditoria(auditoria.usuarioNombre);
    const ahora = auditoria.fechaHora || fechaHoraMexicoMySQL();
    const versionToken = meta.versionToken || nuevoVersionToken();
    const snapshot = JSON.stringify(snapshotActividadParaHistorial(anterior));
    const empresaId = anterior.empresaId || nuevo.empresaId || meta.empresaId || null;
    const folio = String(anterior.folio || nuevo.folio || meta.folio || '').trim() || null;
    const nombreProyecto = String(anterior.nombreProyecto || nuevo.nombreProyecto || meta.nombreProyecto || '').trim() || null;

    const filas = cambios.map((cambio, indice) => ([
        id,
        versionToken,
        empresaId,
        folio,
        nombreProyecto,
        indice === 0 ? snapshot : null,
        cambio.key,
        cambio.etiqueta,
        cambio.valorAnterior,
        cambio.valorNuevo,
        usuario,
        ahora
    ]));

    await pool.query(
        `INSERT INTO sgc_control_proyectos_historial
            (control_proyecto_id, version_token, empresa_id, folio, nombre_proyecto, snapshot_json,
             campo, etiqueta, valor_anterior, valor_nuevo, modificado_por, modificado_en)
         VALUES ${filas.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        filas.flat()
    );
    return versionToken;
}

function mapearFilasHistorial(rows = []) {
    return (rows || []).map((h) => ({
        id: h.historial_id,
        controlProyectoId: h.control_proyecto_id,
        versionToken: h.version_token || null,
        empresaId: h.empresa_id ? Number(h.empresa_id) : null,
        folio: h.folio || null,
        nombreProyecto: h.nombre_proyecto || null,
        campo: h.campo,
        etiqueta: h.etiqueta || h.campo,
        valorAnterior: h.valor_anterior,
        valorNuevo: h.valor_nuevo,
        snapshotJson: h.snapshot_json || null,
        modificadoPor: h.modificado_por,
        modificadoEn: h.modificado_en
    }));
}

function timestampHistorialMs(valor) {
    if (valor == null || valor === '') return 0;
    if (valor instanceof Date) {
        const t = valor.getTime();
        return Number.isNaN(t) ? 0 : t;
    }
    const crudo = String(valor).trim();
    if (!crudo) return 0;
    // YYYY-MM-DD HH:mm:ss (MySQL / México) → comparable de forma estable
    const mysql = crudo.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (mysql) {
        return Date.UTC(
            Number(mysql[1]),
            Number(mysql[2]) - 1,
            Number(mysql[3]),
            Number(mysql[4]),
            Number(mysql[5]),
            Number(mysql[6] || 0)
        );
    }
    const t = new Date(crudo).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/**
 * Clave de agrupación por actividad.
 * El version_token puede ser compartido entre varias actividades del mismo
 * guardado de proyecto; aquí se separa por control_proyecto_id para no mezclarlas.
 */
function claveVersionHistorial(h) {
    const actId = Number(h.controlProyectoId || 0) || 0;
    if (h.versionToken) {
        return `act-${actId}-tok-${String(h.versionToken)}`;
    }
    // Legacy: mismo segundo + usuario + actividad = una sola versión (varios campos).
    return `legacy-${timestampHistorialMs(h.modificadoEn)}-${String(h.modificadoPor || '').trim()}-${actId}`;
}

function agruparHistorialEnVersiones(filas = [], extras = {}) {
    const ordenadas = [...filas].sort((a, b) => {
        const tb = timestampHistorialMs(b.modificadoEn);
        const ta = timestampHistorialMs(a.modificadoEn);
        if (tb !== ta) return tb - ta; // más reciente primero
        return Number(b.id || 0) - Number(a.id || 0);
    });

    const mapa = new Map();
    for (const h of ordenadas) {
        const key = claveVersionHistorial(h);
        if (!mapa.has(key)) {
            let snapshot = null;
            if (h.snapshotJson) {
                try {
                    snapshot = typeof h.snapshotJson === 'string'
                        ? JSON.parse(h.snapshotJson)
                        : h.snapshotJson;
                } catch (_error) {
                    snapshot = null;
                }
            }
            // versionToken real (compartible en lote); versionKey único por actividad.
            const tokenReal = h.versionToken ? String(h.versionToken) : key;
            mapa.set(key, {
                versionToken: tokenReal,
                versionKey: key,
                esLegacy: !h.versionToken,
                historialIds: [],
                controlProyectoId: h.controlProyectoId,
                empresaId: h.empresaId,
                folio: h.folio,
                nombreProyecto: h.nombreProyecto,
                actividadNombre: extras.actividadNombre || null,
                modificadoPor: h.modificadoPor,
                modificadoEn: h.modificadoEn,
                snapshot,
                cambios: [],
                esActual: false,
                alcance: 'actividad',
                actividadesAfectadas: []
            });
        }
        const version = mapa.get(key);
        if (!version.snapshot && h.snapshotJson) {
            try {
                version.snapshot = typeof h.snapshotJson === 'string'
                    ? JSON.parse(h.snapshotJson)
                    : h.snapshotJson;
            } catch (_error) { /* ignore */ }
        }
        if (h.id) version.historialIds.push(Number(h.id));
        version.cambios.push({
            id: h.id,
            campo: h.campo,
            etiqueta: h.etiqueta || h.campo,
            valorAnterior: h.valorAnterior,
            valorNuevo: h.valorNuevo,
            controlProyectoId: h.controlProyectoId || null
        });
    }

    const lista = Array.from(mapa.values()).sort((a, b) => {
        const tb = timestampHistorialMs(b.modificadoEn);
        const ta = timestampHistorialMs(a.modificadoEn);
        if (tb !== ta) return tb - ta;
        const maxId = (v) => Math.max(0, ...(v.historialIds || [0]));
        const byId = maxId(b) - maxId(a);
        if (byId !== 0) return byId;
        return Number(a.controlProyectoId || 0) - Number(b.controlProyectoId || 0);
    });
    lista.forEach((v, i) => {
        v.esActual = i === 0;
        v.versionKey = v.versionKey || `v-${i}`;
        // Conservar token real; no pisarlo con versionKey compuesto act-N-tok-...
        if (!v.versionToken || String(v.versionToken).startsWith('act-')) {
            v.versionToken = v.esLegacy ? v.versionKey : String(v.versionToken || v.versionKey);
        }
        v.alcance = 'actividad';
        if (v.controlProyectoId) {
            v.actividadesAfectadas = [{
                controlProyectoId: v.controlProyectoId,
                actividadNombre: v.actividadNombre || null,
                versionToken: v.versionToken,
                historialIds: [...(v.historialIds || [])],
                snapshot: v.snapshot || null,
                cambios: [...(v.cambios || [])]
            }];
        }
    });
    return lista;
}

/**
 * Clave de lote de proyecto cuando no hay token compartido entre actividades.
 * Une guardados del mismo segundo + usuario + folio (legado / auto-guardado).
 */
function claveLoteProyecto(version) {
    const tsSec = Math.floor(timestampHistorialMs(version?.modificadoEn) / 1000);
    const user = String(version?.modificadoPor || '').trim().toLowerCase();
    const folio = String(version?.folio || '').trim().toLowerCase();
    const nombre = String(version?.nombreProyecto || '').trim().toLowerCase();
    return `lote-${tsSec}-${user}-${folio}-${nombre}`;
}

function agruparVersionesEnLotesProyecto(versionesActividad = []) {
    // Tokens que aparecen en más de una actividad = lote batch explícito.
    const conteoToken = new Map();
    for (const v of versionesActividad) {
        const t = String(v?.versionToken || '').trim();
        if (!t || v?.esLegacy || t.startsWith('legacy-') || t.startsWith('lote-')) continue;
        conteoToken.set(t, (conteoToken.get(t) || 0) + 1);
    }
    const tokensCompartidos = new Set(
        [...conteoToken.entries()].filter(([, n]) => n > 1).map(([t]) => t)
    );

    const mapa = new Map();
    for (const v of versionesActividad) {
        const token = String(v?.versionToken || '').trim();
        const key = tokensCompartidos.has(token)
            ? `tok-${token}`
            : claveLoteProyecto(v);
        if (!mapa.has(key)) {
            mapa.set(key, {
                versionToken: String(v.versionToken || key),
                versionKey: key,
                esLegacy: Boolean(v.esLegacy) || key.startsWith('lote-'),
                historialIds: [],
                controlProyectoId: null,
                controlProyectoIds: [],
                empresaId: v.empresaId || null,
                folio: v.folio || null,
                nombreProyecto: v.nombreProyecto || null,
                actividadNombre: null,
                modificadoPor: v.modificadoPor || null,
                modificadoEn: v.modificadoEn || null,
                snapshot: null,
                cambios: [],
                esActual: false,
                alcance: 'proyecto',
                actividadesAfectadas: []
            });
        }
        const lote = mapa.get(key);
        const actId = Number(v.controlProyectoId || 0) || null;
        if (actId && !lote.controlProyectoIds.includes(actId)) {
            lote.controlProyectoIds.push(actId);
        }
        const ids = (v.historialIds || []).map((n) => Number(n)).filter((n) => n > 0);
        lote.historialIds.push(...ids);
        if (timestampHistorialMs(v.modificadoEn) > timestampHistorialMs(lote.modificadoEn)) {
            lote.modificadoEn = v.modificadoEn;
            lote.modificadoPor = v.modificadoPor || lote.modificadoPor;
        }
        if (v.versionToken && !String(v.versionToken).startsWith('legacy-') && !String(v.versionToken).startsWith('lote-')) {
            if (!lote.versionToken || String(lote.versionToken).startsWith('lote-') || String(lote.versionToken).startsWith('legacy-')) {
                lote.versionToken = String(v.versionToken);
            }
        }
        lote.actividadesAfectadas.push({
            controlProyectoId: actId,
            actividadNombre: v.actividadNombre || (actId ? `Actividad #${actId}` : 'Actividad'),
            versionToken: String(v.versionToken || v.versionKey || ''),
            historialIds: ids,
            snapshot: v.snapshot || null,
            cambios: Array.isArray(v.cambios) ? v.cambios.map((c) => ({ ...c })) : []
        });
        for (const c of v.cambios || []) {
            lote.cambios.push({
                ...c,
                controlProyectoId: actId,
                actividadNombre: v.actividadNombre || (actId ? `Actividad #${actId}` : 'Actividad')
            });
        }
    }

    const lista = Array.from(mapa.values()).sort((a, b) => {
        const tb = timestampHistorialMs(b.modificadoEn);
        const ta = timestampHistorialMs(a.modificadoEn);
        if (tb !== ta) return tb - ta;
        const maxId = (v) => Math.max(0, ...(v.historialIds || [0]));
        return maxId(b) - maxId(a);
    });
    lista.forEach((v, i) => {
        v.esActual = i === 0;
        v.versionKey = v.versionKey || v.versionToken || `proyecto-v-${i}`;
        if (!v.versionToken || String(v.versionToken).startsWith('lote-') || String(v.versionToken).startsWith('act-')) {
            const tokenCompartido = (v.actividadesAfectadas || [])
                .map((a) => String(a.versionToken || '').trim())
                .find((t) => t && !t.startsWith('lote-') && !t.startsWith('legacy-') && !t.startsWith('act-'));
            v.versionToken = tokenCompartido || v.versionKey;
        }
        v.controlProyectoId = v.controlProyectoIds.length === 1 ? v.controlProyectoIds[0] : null;
        v.actividadesAfectadas = (v.actividadesAfectadas || []).slice().sort((a, b) => {
            const na = String(a.actividadNombre || '').localeCompare(
                String(b.actividadNombre || ''),
                'es',
                { sensitivity: 'base', numeric: true }
            );
            if (na !== 0) return na;
            return Number(a.controlProyectoId || 0) - Number(b.controlProyectoId || 0);
        });
        v.actividadNombre = v.actividadesAfectadas.length === 1
            ? v.actividadesAfectadas[0].actividadNombre
            : (v.actividadesAfectadas.length > 1
                ? `${v.actividadesAfectadas.length} actividades`
                : null);
    });
    return lista;
}

/**
 * Reconstruye el estado de una actividad respecto a una versión del historial.
 *
 * - deshacerObjetivo=false: deja el estado "después" de la versión elegida
 *   (lo que se ve en el historial como DESPUÉS) y deshace solo lo más nuevo.
 * - deshacerObjetivo=true: deshace también el guardado elegido (estado ANTES).
 */
function reconstruirSnapshotHastaVersion(
    estadoActual,
    versionesDesc,
    versionTokenObjetivo,
    historialIdsObjetivo = [],
    opciones = {}
) {
    const deshacerObjetivo = Boolean(opciones.deshacerObjetivo);
    const objetivoIds = new Set(
        (Array.isArray(historialIdsObjetivo) ? historialIdsObjetivo : [])
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n > 0)
    );
    const token = String(versionTokenObjetivo || '').trim()
        .replace(/^act-\d+-tok-/, '');
    const estado = snapshotActividadParaHistorial(estadoActual);
    let encontrada = false;

    const aplicarValor = (campoKey, valor) => {
        if (campoKey === 'avance') {
            estado.avance = Number(valor) || 0;
        } else {
            estado[campoKey] = valor == null ? '' : valor;
        }
    };

    for (const version of versionesDesc) {
        const idsVersion = (version.historialIds || []).map((n) => Number(n));
        const tokenVersion = String(version.versionToken || '')
            .replace(/^act-\d+-tok-/, '');
        const esObjetivo = (token && (
                tokenVersion === token
                || String(version.versionToken) === token
                || String(version.versionKey || '') === token
            ))
            || (objetivoIds.size > 0 && idsVersion.some((id) => objetivoIds.has(id)));

        if (esObjetivo && !deshacerObjetivo) {
            encontrada = true;
            // Forzar el estado "después" mostrado en el historial.
            for (const cambio of version.cambios || []) {
                const campo = CAMPOS_HISTORIAL.find((c) => c.key === cambio.campo);
                if (!campo) continue;
                aplicarValor(campo.key, cambio.valorNuevo);
            }
            break;
        }

        if (esObjetivo && deshacerObjetivo && version.snapshot && typeof version.snapshot === 'object') {
            return {
                snapshot: { ...version.snapshot, id: estadoActual.id },
                encontrada: true
            };
        }

        for (const cambio of version.cambios || []) {
            const campo = CAMPOS_HISTORIAL.find((c) => c.key === cambio.campo);
            if (!campo) continue;
            aplicarValor(campo.key, cambio.valorAnterior);
        }

        if (esObjetivo) {
            encontrada = true;
            break;
        }
    }

    return { snapshot: estado, encontrada };
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
    await asegurarTablaHistorial(pool);
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
            observaciones,
            prioridad,
            estatus,
            avance,
            orden,
            activo,
            modificado_por,
            modificado_en,
            creado_por,
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
             observaciones, prioridad, estatus, avance, orden, activo, creado_por, modificado_por, modificado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
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
            p.observaciones || null,
            p.prioridad,
            p.estatus,
            p.avance,
            orden,
            usuario,
            usuario,
            ahora
        ]
    );
    return {
        ...p,
        id: result.insertId,
        responsableUsuarioIds: parseResponsableUsuarioIds(p.responsableUsuarioIds),
        activo: true,
        creadoPor: usuario,
        modificadoPor: usuario,
        modificadoEn: ahora
    };
}

async function actualizarActividad(pool, actividadRaw, orden, auditoria = {}, opciones = {}) {
    const p = sanitizarActividad(actividadRaw);
    const id = idActividadValido(p.id);
    if (!id) return null;
    p.orden = Number.isInteger(orden) && orden > 0 ? orden : p.orden;

    const usuario = normalizarUsuarioAuditoria(auditoria.usuarioNombre);
    const ahora = auditoria.fechaHora || fechaHoraMexicoMySQL();

    const [prevRows] = await pool.query(
        `SELECT control_proyecto_id, empresa_id, empresa_nombre, folio, nombre_proyecto, item,
                condicion_requerimiento, actividades_accion, referencia_normativa, responsable,
                responsable_usuario_ids, fecha_inicio, fecha_compromiso, entregables, observaciones,
                prioridad, estatus, avance, orden, creado_por, created_at
         FROM sgc_control_proyectos
         WHERE control_proyecto_id = ?
         LIMIT 1`,
        [id]
    );
    if (!prevRows[0]) return null;
    const anterior = mapRowToActividad(prevRows[0]);

    // Cortafuegos de ownership: un usuario no puede tocar actividades ajenas.
    if (opciones.verificarOwnership !== false) {
        if (!usuarioPuedeModificarFila(prevRows[0], opciones)) {
            const err = new Error('No tienes permiso para modificar esta actividad: solo el responsable asignado (o un administrador) puede editarla.');
            err.statusCode = 403;
            err.code = 'CP_OWNERSHIP_DENIED';
            throw err;
        }
    }

    const cambios = detectarCambiosActividad(anterior, p);
    if (!cambios.length) {
        // Sin cambios reales: no tocar BD ni auditoría (evita el sellado masivo de modificado_en).
        return {
            ...anterior,
            id,
            orden: anterior.orden || orden,
            responsableUsuarioIds: parseResponsableUsuarioIds(anterior.responsableUsuarioIds),
            activo: true,
            sinCambios: true
        };
    }

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
             observaciones = ?,
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
            p.observaciones || null,
            p.prioridad,
            p.estatus,
            p.avance,
            p.orden,
            usuario,
            ahora,
            id
        ]
    );

    if (Array.isArray(opciones.deferHistorial)) {
        opciones.deferHistorial.push({
            id,
            anterior,
            nuevo: p,
            auditoria: { usuarioNombre: usuario, fechaHora: ahora }
        });
    } else {
        try {
            await registrarCambiosHistorial(pool, id, anterior, p, {
                usuarioNombre: usuario,
                fechaHora: ahora
            });
        } catch (histErr) {
            console.warn('[control-proyectos] No se pudo registrar historial:', histErr.message);
        }
    }

    return {
        ...p,
        id,
        orden: p.orden,
        responsableUsuarioIds: parseResponsableUsuarioIds(p.responsableUsuarioIds),
        activo: true,
        modificadoPor: usuario,
        modificadoEn: ahora,
        creadoPor: anterior?.creadoPor || null,
        createdAt: anterior?.createdAt || null,
        sinCambios: false
    };
}

async function obtenerDetalleActividad(pool, actividadId) {
    await asegurarTablaControlProyectos(pool);
    await purgarHistorialAntiguo(pool);
    const id = idActividadValido(actividadId);
    if (!id) {
        const err = new Error('Actividad no válida');
        err.statusCode = 400;
        throw err;
    }
    const [rows] = await pool.query(
        `SELECT
            control_proyecto_id, empresa_id, empresa_nombre, folio, nombre_proyecto, item,
            condicion_requerimiento, actividades_accion, referencia_normativa, responsable,
            responsable_usuario_ids, fecha_inicio, fecha_compromiso, entregables, observaciones,
            prioridad, estatus, avance, orden, activo, modificado_por, modificado_en, creado_por,
            eliminado_por, eliminado_en, created_at, updated_at
         FROM sgc_control_proyectos
         WHERE control_proyecto_id = ?
         LIMIT 1`,
        [id]
    );
    if (!rows[0]) {
        const err = new Error('Actividad no encontrada');
        err.statusCode = 404;
        throw err;
    }
    const actividad = mapRowToActividad(rows[0]);
    const [hist] = await pool.query(
        `SELECT historial_id, control_proyecto_id, version_token, empresa_id, folio, nombre_proyecto,
                snapshot_json, campo, etiqueta, valor_anterior, valor_nuevo, modificado_por, modificado_en
         FROM sgc_control_proyectos_historial
         WHERE control_proyecto_id = ?
         ORDER BY modificado_en DESC, historial_id DESC
         LIMIT 200`,
        [id]
    );
    const historial = mapearFilasHistorial(hist);
    const versiones = agruparHistorialEnVersiones(historial, {
        actividadNombre: actividad.actividadesAccion || actividad.item || 'Actividad'
    });
    return {
        actividad,
        historial,
        versiones,
        retencionDias: RETENCION_HISTORIAL_DIAS
    };
}

async function obtenerHistorialProyecto(pool, filtros = {}) {
    await asegurarTablaControlProyectos(pool);
    await purgarHistorialAntiguo(pool);

    const empresaId = normalizarEmpresaId(filtros.empresaId);
    const folio = String(filtros.folio || '').trim();
    const nombreProyecto = String(filtros.nombreProyecto || '').trim();
    const actividadId = idActividadValido(filtros.actividadId);

    if (!folio && !nombreProyecto && !actividadId) {
        const err = new Error('Indica folio, nombre de proyecto o actividad para consultar el historial.');
        err.statusCode = 400;
        throw err;
    }

    const whereParts = [];
    const params = [];

    if (actividadId) {
        whereParts.push('control_proyecto_id = ?');
        params.push(actividadId);
    } else {
        if (empresaId) {
            whereParts.push('(empresa_id = ? OR empresa_id IS NULL)');
            params.push(empresaId);
        }
        if (folio) {
            whereParts.push('LOWER(TRIM(COALESCE(folio, \'\'))) = LOWER(TRIM(?))');
            params.push(folio);
        }
        if (nombreProyecto) {
            whereParts.push('LOWER(TRIM(COALESCE(nombre_proyecto, \'\'))) = LOWER(TRIM(?))');
            params.push(nombreProyecto);
        }
    }

    const [hist] = await pool.query(
        `SELECT historial_id, control_proyecto_id, version_token, empresa_id, folio, nombre_proyecto,
                snapshot_json, campo, etiqueta, valor_anterior, valor_nuevo, modificado_por, modificado_en
         FROM sgc_control_proyectos_historial
         WHERE ${whereParts.join(' AND ')}
         ORDER BY modificado_en DESC, historial_id DESC
         LIMIT 400`,
        params
    );

    const historial = mapearFilasHistorial(hist);
    const versionesActividad = agruparHistorialEnVersiones(historial);

    // Enriquecer con nombre de actividad actual cuando exista.
    const idsActs = [...new Set(versionesActividad.map((v) => v.controlProyectoId).filter(Boolean))];
    const nombresPorId = new Map();
    if (idsActs.length) {
        const placeholders = idsActs.map(() => '?').join(', ');
        const [acts] = await pool.query(
            `SELECT control_proyecto_id, actividades_accion, item
             FROM sgc_control_proyectos
             WHERE control_proyecto_id IN (${placeholders})`,
            idsActs
        );
        for (const a of acts || []) {
            nombresPorId.set(
                Number(a.control_proyecto_id),
                String(a.actividades_accion || a.item || 'Actividad').trim() || 'Actividad'
            );
        }
    }
    for (const v of versionesActividad) {
        v.actividadNombre = nombresPorId.get(Number(v.controlProyectoId))
            || v.actividadNombre
            || `Actividad #${v.controlProyectoId}`;
        if (Array.isArray(v.actividadesAfectadas)) {
            for (const a of v.actividadesAfectadas) {
                a.actividadNombre = nombresPorId.get(Number(a.controlProyectoId))
                    || a.actividadNombre
                    || `Actividad #${a.controlProyectoId}`;
            }
        }
        if (Array.isArray(v.cambios)) {
            for (const c of v.cambios) {
                c.actividadNombre = v.actividadNombre;
            }
        }
    }

    // Historial de proyecto: un lote = un guardado que pudo tocar N actividades.
    const versiones = actividadId
        ? versionesActividad
        : agruparVersionesEnLotesProyecto(versionesActividad);

    return {
        historial,
        versiones,
        retencionDias: RETENCION_HISTORIAL_DIAS,
        folio: folio || (versiones[0]?.folio || null),
        nombreProyecto: nombreProyecto || (versiones[0]?.nombreProyecto || null),
        alcance: actividadId ? 'actividad' : 'proyecto'
    };
}

/**
 * Restaura una actividad al estado anterior a una versión del historial.
 * Funciona con la versión más reciente o con cualquiera más antigua (2ª, 3ª, N).
 * Acepta versionToken real o legacy, y/o historialIds del grupo.
 */
async function restaurarVersionActividad(pool, actividadId, versionToken, opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const id = idActividadValido(actividadId);
    const token = String(versionToken || '').trim().replace(/^act-\d+-tok-/, '');
    const historialIds = (Array.isArray(opciones.historialIds) ? opciones.historialIds : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0);
    const cambiosObjetivo = Array.isArray(opciones.cambiosObjetivo) ? opciones.cambiosObjetivo : [];

    if (!id || (!token && !historialIds.length && !cambiosObjetivo.length)) {
        const err = new Error('Actividad o versión no válida.');
        err.statusCode = 400;
        throw err;
    }

    const [actRows] = await pool.query(
        `SELECT control_proyecto_id, empresa_id, empresa_nombre, folio, nombre_proyecto, item,
                condicion_requerimiento, actividades_accion, referencia_normativa, responsable,
                responsable_usuario_ids, fecha_inicio, fecha_compromiso, entregables, observaciones,
                prioridad, estatus, avance, orden
         FROM sgc_control_proyectos
         WHERE control_proyecto_id = ?
         LIMIT 1`,
        [id]
    );
    if (!actRows[0]) {
        const err = new Error('Actividad no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const actual = mapRowToActividad(actRows[0]);

    const [hist] = await pool.query(
        `SELECT historial_id, control_proyecto_id, version_token, empresa_id, folio, nombre_proyecto,
                snapshot_json, campo, etiqueta, valor_anterior, valor_nuevo, modificado_por, modificado_en
         FROM sgc_control_proyectos_historial
         WHERE control_proyecto_id = ?
         ORDER BY modificado_en DESC, historial_id DESC
         LIMIT 400`,
        [id]
    );
    const filas = mapearFilasHistorial(hist);
    const versiones = agruparHistorialEnVersiones(filas);
    if (!versiones.length && !cambiosObjetivo.length) {
        const err = new Error('No hay versiones en el historial para esta actividad.');
        err.statusCode = 404;
        throw err;
    }

    let snapshot = null;
    let encontrada = false;

    if (versiones.length && (token || historialIds.length)) {
        const reconstruido = reconstruirSnapshotHastaVersion(
            actual,
            versiones,
            token,
            historialIds,
            { deshacerObjetivo: Boolean(opciones.deshacerObjetivo) }
        );
        snapshot = reconstruido.snapshot;
        encontrada = reconstruido.encontrada;
    }

    // Fallback: aplicar directamente los valores "después" enviados desde el lote.
    if (!encontrada && cambiosObjetivo.length) {
        const estado = snapshotActividadParaHistorial(actual);
        // Deshacer cambios más nuevos que el primer historialId del objetivo, si hay.
        if (versiones.length && historialIds.length) {
            const minObjetivo = Math.min(...historialIds);
            for (const version of versiones) {
                const idsVersion = (version.historialIds || []).map((n) => Number(n));
                const esObjetivo = idsVersion.some((hid) => historialIds.includes(hid));
                if (esObjetivo) break;
                const maxId = Math.max(0, ...idsVersion);
                if (maxId > 0 && maxId < minObjetivo) break;
                for (const cambio of version.cambios || []) {
                    const campo = CAMPOS_HISTORIAL.find((c) => c.key === cambio.campo);
                    if (!campo) continue;
                    if (campo.key === 'avance') estado.avance = Number(cambio.valorAnterior) || 0;
                    else estado[campo.key] = cambio.valorAnterior == null ? '' : cambio.valorAnterior;
                }
            }
        }
        for (const cambio of cambiosObjetivo) {
            const campo = CAMPOS_HISTORIAL.find((c) => c.key === cambio.campo);
            if (!campo) continue;
            if (campo.key === 'avance') estado.avance = Number(cambio.valorNuevo) || 0;
            else estado[campo.key] = cambio.valorNuevo == null ? '' : cambio.valorNuevo;
        }
        snapshot = estado;
        encontrada = true;
    }

    if (!encontrada || !snapshot) {
        const err = new Error('No se encontró esa versión en el historial (puede haber expirado tras 14 días).');
        err.statusCode = 404;
        throw err;
    }

    const auditoria = {
        usuarioNombre: normalizarUsuarioAuditoria(opciones.usuarioNombre),
        fechaHora: opciones.fechaHora || fechaHoraMexicoMySQL()
    };

    const restaurada = await actualizarActividad(
        pool,
        {
            ...snapshot,
            id,
            control_proyecto_id: id
        },
        Number(snapshot.orden) || actual.orden || 0,
        auditoria,
        {
            usuarioId: opciones.usuarioId,
            roles: opciones.roles,
            esPrivilegioUniversal: opciones.esPrivilegioUniversal,
            usuarioNombre: auditoria.usuarioNombre,
            verificarOwnership: true
        }
    );

    return {
        actividad: restaurada,
        versionToken: token || null,
        historialIds,
        restauradoPor: auditoria.usuarioNombre,
        restauradoEn: auditoria.fechaHora
    };
}

/**
 * Restaura un lote de proyecto: deja el estado "después" de esa versión
 * como el actual en todas las actividades afectadas (y deshace lo más nuevo).
 * El lote se resuelve siempre desde el historial del proyecto (fuente de verdad).
 */
async function restaurarVersionProyecto(pool, opciones = {}) {
    await asegurarTablaControlProyectos(pool);

    const token = String(opciones.versionToken || '').trim();
    const versionKey = String(opciones.versionKey || '').trim();
    const historialIds = (Array.isArray(opciones.historialIds) ? opciones.historialIds : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0);
    const actividadesPayload = Array.isArray(opciones.actividades) ? opciones.actividades : [];
    const empresaId = normalizarEmpresaId(opciones.empresaId);
    const folio = String(opciones.folio || '').trim();
    const nombreProyecto = String(opciones.nombreProyecto || '').trim();

    const normalizarTokenActividad = (raw) => {
        let t = String(raw || '').trim();
        const composed = t.match(/^act-\d+-tok-(.+)$/);
        if (composed) t = composed[1];
        if (!t || t.startsWith('lote-') || t.startsWith('legacy-') || t.startsWith('proyecto-v-')) {
            return '';
        }
        return t;
    };

    if (!folio && !nombreProyecto && !historialIds.length && !token && !versionKey && !actividadesPayload.length) {
        const err = new Error('Indica la versión del proyecto a recuperar.');
        err.statusCode = 400;
        throw err;
    }

    // Fuente de verdad: rearmar el lote desde BD para no perder actividades.
    const histPayload = await obtenerHistorialProyecto(pool, {
        empresaId,
        folio,
        nombreProyecto
    });
    const versiones = Array.isArray(histPayload.versiones) ? histPayload.versiones : [];
    const idsSet = new Set(historialIds);
    const payloadActIds = new Set(
        actividadesPayload
            .map((a) => idActividadValido(a.controlProyectoId || a.id))
            .filter(Boolean)
    );

    let lote = versiones.find((v) => {
        if (versionKey && (v.versionKey === versionKey || v.versionToken === versionKey)) return true;
        if (token && (v.versionToken === token || v.versionKey === token)) return true;
        if (idsSet.size) {
            const ids = v.historialIds || [];
            const hits = ids.filter((id) => idsSet.has(Number(id))).length;
            if (hits > 0 && hits >= Math.min(idsSet.size, ids.length)) return true;
            if (hits > 0 && idsSet.size >= 2 && hits >= 2) return true;
        }
        return false;
    });

    if (!lote && payloadActIds.size) {
        lote = versiones.find((v) => {
            const ids = new Set((v.controlProyectoIds || []).map((n) => Number(n)));
            let hits = 0;
            for (const id of payloadActIds) {
                if (ids.has(id)) hits += 1;
            }
            return hits >= Math.max(1, Math.min(payloadActIds.size, ids.size));
        }) || null;
    }

    let objetivos = [];
    if (lote && Array.isArray(lote.actividadesAfectadas) && lote.actividadesAfectadas.length) {
        objetivos = lote.actividadesAfectadas
            .map((a) => ({
                controlProyectoId: idActividadValido(a.controlProyectoId),
                versionToken: normalizarTokenActividad(a.versionToken),
                historialIds: (Array.isArray(a.historialIds) ? a.historialIds : [])
                    .map((n) => Number(n))
                    .filter((n) => Number.isInteger(n) && n > 0),
                // Valores "después" del historial: se aplican sí o sí.
                cambios: Array.isArray(a.cambios) ? a.cambios : []
            }))
            .filter((a) => a.controlProyectoId && (a.versionToken || a.historialIds.length || a.cambios.length));
    } else {
        objetivos = actividadesPayload
            .map((a) => ({
                controlProyectoId: idActividadValido(a.controlProyectoId || a.id),
                versionToken: normalizarTokenActividad(a.versionToken || token),
                historialIds: (Array.isArray(a.historialIds) ? a.historialIds : [])
                    .map((n) => Number(n))
                    .filter((n) => Number.isInteger(n) && n > 0),
                cambios: Array.isArray(a.cambios) ? a.cambios : []
            }))
            .filter((a) => a.controlProyectoId && (a.versionToken || a.historialIds.length || a.cambios.length));
    }

    if (!objetivos.length) {
        const err = new Error('No se encontró esa versión del proyecto o no tiene actividades recuperables.');
        err.statusCode = 404;
        throw err;
    }

    const fechaHoraLote = opciones.fechaHora || fechaHoraMexicoMySQL();
    const restauradas = [];
    const errores = [];

    for (const obj of objetivos) {
        try {
            const r = await restaurarVersionActividad(
                pool,
                obj.controlProyectoId,
                obj.versionToken,
                {
                    ...opciones,
                    fechaHora: fechaHoraLote,
                    historialIds: obj.historialIds,
                    // Aplicar el estado "después" de esa versión (la que se ve en el panel).
                    deshacerObjetivo: false,
                    cambiosObjetivo: obj.cambios
                }
            );
            restauradas.push({
                controlProyectoId: obj.controlProyectoId,
                actividad: r.actividad,
                sinCambios: Boolean(r.actividad?.sinCambios)
            });
        } catch (error) {
            errores.push({
                controlProyectoId: obj.controlProyectoId,
                message: error?.message || 'No se pudo restaurar'
            });
        }
    }

    if (!restauradas.length) {
        const err = new Error(errores[0]?.message || 'No se pudo restaurar ninguna actividad del lote.');
        err.statusCode = 400;
        throw err;
    }

    const conCambios = restauradas.filter((r) => !r.sinCambios).length;

    return {
        restauradas,
        errores,
        totalActividades: objetivos.length,
        restauradasOk: restauradas.length,
        actividadesConCambios: conCambios,
        versionToken: (lote && lote.versionToken) || token || versionKey || null,
        versionKey: (lote && lote.versionKey) || versionKey || null,
        historialIds: (lote && lote.historialIds) || historialIds,
        restauradoPor: normalizarUsuarioAuditoria(opciones.usuarioNombre),
        restauradoEn: fechaHoraLote
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
 * - Actualiza por id las actividades que siguen en el payload **y tienen cambios reales**
 * - Inserta las nuevas
 * - Un usuario solo puede actualizar actividades de las que es responsable (salvo admin/root)
 * La ausencia de una actividad en el payload nunca se interpreta como eliminación.
 * Reintenta ante deadlock y bloquea filas en orden de id para evitar ciclos de locks.
 */
async function reemplazarActividades(pool, actividadesRaw, opciones = {}) {
    await asegurarTablaControlProyectos(pool);
    const actividades = sanitizarListaActividades(actividadesRaw, { excluirLegacyF14: true });
    const empresaId = normalizarEmpresaId(opciones.empresaId);
    const auditoria = {
        usuarioNombre: normalizarUsuarioAuditoria(opciones.usuarioNombre),
        fechaHora: opciones.fechaHora || fechaHoraMexicoMySQL()
    };
    const ownershipOpts = {
        usuarioId: Number(opciones.usuarioId || 0) || null,
        roles: Array.isArray(opciones.roles) ? opciones.roles : [],
        esPrivilegioUniversal: Boolean(opciones.esPrivilegioUniversal) || esPrivilegioUniversal(opciones.roles),
        usuarioNombre: auditoria.usuarioNombre
    };

    const maxAttempts = 4;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            try {
                await conn.query('SET SESSION innodb_lock_wait_timeout = 15');
            } catch (_timeoutErr) {
                /* algunos entornos no permiten cambiar el timeout de sesión */
            }

            // Solo bloquear las filas que el payload pretende tocar (evita sellar el portafolio entero).
            const idsPayload = actividades
                .map((a) => idActividadValido(a.id))
                .filter(Boolean)
                .sort((a, b) => a - b);

            let idsExistentes = new Set();
            const filasPorId = new Map();
            if (idsPayload.length) {
                const placeholders = idsPayload.map(() => '?').join(', ');
                const whereParts = [`control_proyecto_id IN (${placeholders})`, 'activo = 1'];
                const params = [...idsPayload];
                if (empresaId) {
                    whereParts.push('empresa_id = ?');
                    params.push(empresaId);
                }
                const [existentes] = await conn.query(
                    `SELECT control_proyecto_id, responsable, responsable_usuario_ids
                     FROM sgc_control_proyectos
                     WHERE ${whereParts.join(' AND ')}
                     ORDER BY control_proyecto_id ASC
                     FOR UPDATE`,
                    params
                );
                for (const row of existentes) {
                    const id = Number(row.control_proyecto_id);
                    idsExistentes.add(id);
                    filasPorId.set(id, row);
                }
            }

            // Orden estable por proyecto (respeta orden del payload / drag-and-drop).
            const contadorPorProyecto = new Map();
            const conOrden = actividades.map((actividad, indicePayload) => {
                const clave = claveProyecto(actividad);
                const siguiente = (contadorPorProyecto.get(clave) || 0) + 1;
                contadorPorProyecto.set(clave, siguiente);
                const ordenPayload = Number(actividad.orden);
                const orden = Number.isInteger(ordenPayload) && ordenPayload > 0
                    ? ordenPayload
                    : siguiente;
                return { actividad, orden, indicePayload };
            });

            // Actualizar por id ascendente evita deadlocks entre transacciones concurrentes.
            const paraActualizar = conOrden
                .filter(({ actividad }) => {
                    const id = idActividadValido(actividad.id);
                    return id && idsExistentes.has(id);
                })
                .sort((a, b) => idActividadValido(a.actividad.id) - idActividadValido(b.actividad.id));

            const paraInsertar = conOrden.filter(({ actividad }) => {
                const id = idActividadValido(actividad.id);
                return !id || !idsExistentes.has(id);
            });

            const resultadoPorPayload = new Array(actividades.length);
            const pendientesHistorial = [];
            const omitidasOwnership = [];
            let actualizadas = 0;
            let sinCambios = 0;

            for (const { actividad, orden, indicePayload } of paraActualizar) {
                const id = idActividadValido(actividad.id);
                const filaBd = filasPorId.get(id);
                if (filaBd && !usuarioPuedeModificarFila(filaBd, ownershipOpts)) {
                    omitidasOwnership.push(id);
                    continue;
                }
                const actualizada = await actualizarActividad(conn, actividad, orden, auditoria, {
                    deferHistorial: pendientesHistorial,
                    verificarOwnership: false,
                    ...ownershipOpts
                });
                if (actualizada) {
                    resultadoPorPayload[indicePayload] = actualizada;
                    if (actualizada.sinCambios) sinCambios += 1;
                    else actualizadas += 1;
                }
            }

            for (const { actividad, orden, indicePayload } of paraInsertar) {
                const creada = await insertarActividad(conn, { ...actividad, id: null }, orden, auditoria);
                resultadoPorPayload[indicePayload] = creada;
            }

            // Un solo version_token por proyecto en el lote → historial de proyecto multi-actividad.
            const tokenPorProyecto = new Map();
            for (const pendiente of pendientesHistorial) {
                const folioP = String(pendiente.anterior?.folio || pendiente.nuevo?.folio || '').trim().toLowerCase();
                const nombreP = String(pendiente.anterior?.nombreProyecto || pendiente.nuevo?.nombreProyecto || '').trim().toLowerCase();
                const empresaP = Number(pendiente.anterior?.empresaId || pendiente.nuevo?.empresaId || 0) || 0;
                const clave = `${empresaP}|${folioP}|${nombreP}`;
                if (!tokenPorProyecto.has(clave)) {
                    tokenPorProyecto.set(clave, nuevoVersionToken());
                }
                await registrarCambiosHistorial(
                    conn,
                    pendiente.id,
                    pendiente.anterior,
                    pendiente.nuevo,
                    pendiente.auditoria,
                    { versionToken: tokenPorProyecto.get(clave) }
                );
            }

            await purgarHistorialAntiguo(conn);
            await conn.commit();

            if (omitidasOwnership.length) {
                console.warn(
                    `[control-proyectos] Guardado: se omitieron ${omitidasOwnership.length} actividad(es) por ownership:`,
                    omitidasOwnership.join(', ')
                );
            }

            const resultado = resultadoPorPayload.filter(Boolean);
            resultado._meta = {
                actualizadas,
                sinCambios,
                insertadas: paraInsertar.length,
                omitidasOwnership: omitidasOwnership.length
            };
            return resultado;
        } catch (error) {
            try {
                await conn.rollback();
            } catch (_rollbackErr) {
                /* ignore */
            }
            lastError = error;
            const esDeadlock = error?.code === 'ER_LOCK_DEADLOCK' || Number(error?.errno) === 1213;
            if (esDeadlock && attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 40)));
                continue;
            }
            throw error;
        } finally {
            conn.release();
        }
    }

    throw lastError || new Error('No se pudieron guardar los proyectos.');
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
        `SELECT COALESCE(MAX(orden), 0) AS maxOrden
         FROM sgc_control_proyectos
         WHERE activo = 1
           AND LOWER(TRIM(COALESCE(folio, ''))) = LOWER(TRIM(?))
           AND LOWER(TRIM(COALESCE(nombre_proyecto, ''))) = LOWER(TRIM(?))`,
        [p.folio || '', p.nombreProyecto || '']
    );
    const ordenPayload = Number(body?.orden);
    const orden = Number.isInteger(ordenPayload) && ordenPayload > 0
        ? ordenPayload
        : Number(ordenRows[0]?.maxOrden || 0) + 1;
    return insertarActividad(pool, p, orden, auditoria);
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
        observaciones: p.observaciones,
        prioridad: p.prioridad,
        estatus: p.estatus,
        avance: parsearAvance(p.avance),
        orden: Number.isFinite(Number(p.orden)) ? Number(p.orden) : 0,
        activo: p.activo !== false,
        creadoPor: p.creadoPor || null,
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
        const sumaAvance = proyecto.actividades.reduce(
            (acc, a) => acc + avanceDesdeEstatus(a.estatus || estatusDesdeAvance(a.avance)),
            0
        );
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
    const lista = Array.isArray(actividades) ? atividadesSinMeta(actividades) : [];
    return {
        codigo: CODIGO_FORMATO,
        revision: REV_FORMATO,
        titulo: 'Control de Proyectos',
        datos: {
            fechaElaboracion,
            proyectos: actividadesParaFormato(lista)
        },
        fechaElaboracionOriginal: fechaElaboracion,
        fechaModificacionContenido: fechaElaboracion,
        contenidoModificado: false
    };
}

function atividadesSinMeta(actividades) {
    return actividades.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
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
        fechaHora: body?.fechaHora,
        usuarioId: body?.usuarioId,
        roles: body?.roles,
        esPrivilegioUniversal: body?.esPrivilegioUniversal
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
    RETENCION_HISTORIAL_DIAS,
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
    obtenerDetalleActividad,
    obtenerHistorialProyecto,
    restaurarVersionActividad,
    restaurarVersionProyecto,
    purgarHistorialAntiguo,
    fechaHoraMexicoMySQL
};
