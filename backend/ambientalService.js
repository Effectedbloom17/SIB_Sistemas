/**
 * Módulo Ambiental — SP-F-15 / SP-F-28
 * Persistencia en biznaga_sgc (BD satélite SGC).
 */
const { OFICIOS_SEED, OFICIOS_SEED_REV, TRAMITES_SEED } = require('./ambientalSeedData');

const RESPONSABLES_VALIDOS = ['Biznaga', 'Cliente'];
const ESTATUS_VALIDOS = ['abierto', 'cerrado'];

function normalizarEmpresaId(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : null;
}

const COLUMNAS_OFICIOS_DOC = [
    `ALTER TABLE ambiental_control_oficios ADD COLUMN documento_url VARCHAR(500) DEFAULT NULL AFTER motivo`,
    `ALTER TABLE ambiental_control_oficios ADD COLUMN documento_nombre VARCHAR(255) DEFAULT NULL AFTER documento_url`,
    `ALTER TABLE ambiental_control_oficios ADD COLUMN documento_drive_id VARCHAR(128) DEFAULT NULL AFTER documento_nombre`
];

async function asegurarColumnasOficiosDoc(pool) {
    for (const sql of COLUMNAS_OFICIOS_DOC) {
        try {
            await pool.query(sql);
        } catch (e) { /* columna ya existe */ }
    }
}

async function asegurarMetaAmbiental(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ambiental_meta (
            meta_key VARCHAR(64) PRIMARY KEY,
            meta_value VARCHAR(255) NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * SP-F-28 por empresa: cada empresa registrada maneja sus propios trámites
 * (columna empresa_id) y su propia hoja/pestaña en Drive + metadatos.
 */
const COLUMNAS_TRAMITES_EMPRESA = [
    `ALTER TABLE ambiental_control_tramites ADD COLUMN empresa_id INT DEFAULT NULL AFTER tramite_id`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN empresa_nombre VARCHAR(255) DEFAULT NULL AFTER empresa_id`
];

const COLUMNAS_TRAMITES_DOC = [
    `ALTER TABLE ambiental_control_tramites ADD COLUMN documento_url VARCHAR(500) DEFAULT NULL AFTER observaciones`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN documento_nombre VARCHAR(255) DEFAULT NULL AFTER documento_url`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN documento_drive_id VARCHAR(128) DEFAULT NULL AFTER documento_nombre`
];

const COLUMNAS_TRAMITES_CONTESTACION = [
    `ALTER TABLE ambiental_control_tramites ADD COLUMN contestacion_url VARCHAR(500) DEFAULT NULL AFTER documento_drive_id`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN contestacion_nombre VARCHAR(255) DEFAULT NULL AFTER contestacion_url`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN contestacion_drive_id VARCHAR(128) DEFAULT NULL AFTER contestacion_nombre`,
    `ALTER TABLE ambiental_control_tramites ADD COLUMN tiene_contestacion TINYINT(1) NOT NULL DEFAULT 0 AFTER contestacion_drive_id`
];

const COLUMNAS_TRAMITES_CLASIFICACION = [
    `ALTER TABLE ambiental_control_tramites ADD COLUMN clasificacion VARCHAR(16) DEFAULT NULL AFTER fecha_vencimiento`
];

const CLASIFICACIONES_VALIDAS = ['MIA', 'COA', 'LAE', 'ENA', 'RME', 'IP'];

async function asegurarColumnasTramitesEmpresa(pool) {
    for (const sql of COLUMNAS_TRAMITES_EMPRESA) {
        try { await pool.query(sql); } catch (e) { /* columna ya existe */ }
    }
    for (const sql of COLUMNAS_TRAMITES_DOC) {
        try { await pool.query(sql); } catch (e) { /* columna ya existe */ }
    }
    for (const sql of COLUMNAS_TRAMITES_CONTESTACION) {
        try { await pool.query(sql); } catch (e) { /* columna ya existe */ }
    }
    for (const sql of COLUMNAS_TRAMITES_CLASIFICACION) {
        try { await pool.query(sql); } catch (e) { /* columna ya existe */ }
    }
    try {
        await pool.query(`
            UPDATE ambiental_control_tramites
            SET tiene_contestacion = 1
            WHERE activo = 1
              AND tiene_contestacion = 0
              AND contestacion_drive_id IS NOT NULL
              AND contestacion_drive_id <> ''
        `);
    } catch (e) { /* columna aún no disponible */ }
    // El ítem ahora es único por empresa, no globalmente.
    try { await pool.query('ALTER TABLE ambiental_control_tramites DROP INDEX uk_ambiental_tramite_item'); } catch (e) { /* ya no existe */ }
    try {
        await pool.query('ALTER TABLE ambiental_control_tramites ADD UNIQUE KEY uk_ambiental_empresa_item (empresa_id, item)');
    } catch (e) { /* ya existe */ }
}

async function asegurarTablaSpF28Empresa(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ambiental_spf28_empresa (
            empresa_id INT PRIMARY KEY,
            nombre_empresa VARCHAR(255) NOT NULL DEFAULT '',
            nombre_consultor VARCHAR(255) NOT NULL DEFAULT '',
            documento_creado_at DATE DEFAULT NULL,
            drive_tab_title VARCHAR(120) DEFAULT NULL,
            drive_sheet_gid VARCHAR(32) DEFAULT NULL,
            ultima_sync VARCHAR(40) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function obtenerMetaAmbiental(pool, key) {
    const [rows] = await pool.query(
        'SELECT meta_value FROM ambiental_meta WHERE meta_key = ? LIMIT 1',
        [key]
    );
    return rows[0]?.meta_value || null;
}

async function guardarMetaAmbiental(pool, key, value) {
    await pool.query(
        `INSERT INTO ambiental_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = NOW()`,
        [key, value]
    );
}

async function sincronizarOficiosSeed(pool) {
    for (const row of OFICIOS_SEED) {
        await pool.query(
            `INSERT INTO ambiental_control_oficios (numero_oficio, empresa, motivo)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                empresa = VALUES(empresa),
                motivo = VALUES(motivo),
                activo = 1,
                updated_at = NOW()`,
            [row.numero_oficio, row.empresa ?? '', row.motivo ?? '']
        );
    }
}

async function sincronizarTramitesSeed(pool) {
    for (const row of TRAMITES_SEED) {
        await pool.query(
            `INSERT INTO ambiental_control_tramites
                (item, oficio, accion_realizar, responsable, fecha_vencimiento, estatus, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                oficio = VALUES(oficio),
                accion_realizar = VALUES(accion_realizar),
                responsable = VALUES(responsable),
                fecha_vencimiento = VALUES(fecha_vencimiento),
                estatus = VALUES(estatus),
                observaciones = VALUES(observaciones),
                activo = 1,
                updated_at = NOW()`,
            [
                row.item,
                row.oficio ?? '',
                row.accion_realizar ?? '',
                row.responsable,
                row.fecha_vencimiento,
                row.estatus,
                row.observaciones ?? ''
            ]
        );
    }
}

async function asegurarTablasAmbiental(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ambiental_control_oficios (
            oficio_id INT AUTO_INCREMENT PRIMARY KEY,
            numero_oficio INT NOT NULL,
            empresa VARCHAR(255) NOT NULL DEFAULT '',
            motivo VARCHAR(500) NOT NULL DEFAULT '',
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_ambiental_numero_oficio (numero_oficio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ambiental_control_tramites (
            tramite_id INT AUTO_INCREMENT PRIMARY KEY,
            item INT NOT NULL,
            oficio VARCHAR(500) NOT NULL DEFAULT '',
            accion_realizar TEXT,
            responsable ENUM('Biznaga','Cliente') NOT NULL DEFAULT 'Biznaga',
            fecha_vencimiento DATE DEFAULT NULL,
            estatus ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto',
            observaciones TEXT,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_ambiental_tramite_item (item)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await asegurarColumnasOficiosDoc(pool);
    await asegurarColumnasTramitesEmpresa(pool);
    await asegurarTablaSpF28Empresa(pool);
    await asegurarMetaAmbiental(pool);

    const revOficios = await obtenerMetaAmbiental(pool, 'oficios_seed_rev');
    if (revOficios !== OFICIOS_SEED_REV) {
        await sincronizarOficiosSeed(pool);
        await guardarMetaAmbiental(pool, 'oficios_seed_rev', OFICIOS_SEED_REV);
    } else {
        const [[oficiosCount]] = await pool.query(
            'SELECT COUNT(*) AS total FROM ambiental_control_oficios WHERE activo = 1'
        );
        if (Number(oficiosCount.total) === 0) {
            await sincronizarOficiosSeed(pool);
        }
    }

    const revTramites = await obtenerMetaAmbiental(pool, 'tramites_seed_rev');
    if (revTramites !== 'v1') {
        await sincronizarTramitesSeed(pool);
        await guardarMetaAmbiental(pool, 'tramites_seed_rev', 'v1');
    } else {
        const [[tramitesCount]] = await pool.query(
            'SELECT COUNT(*) AS total FROM ambiental_control_tramites WHERE activo = 1'
        );
        if (Number(tramitesCount.total) === 0) {
            await sincronizarTramitesSeed(pool);
        }
    }
}

async function listarOficios(pool, filtros = {}) {
    let sql = `
        SELECT oficio_id, numero_oficio, empresa, motivo,
               documento_url, documento_nombre, documento_drive_id,
               created_at, updated_at
        FROM ambiental_control_oficios
        WHERE activo = 1
    `;
    const params = [];

    if (filtros.busqueda) {
        sql += ` AND (empresa LIKE ? OR motivo LIKE ? OR CAST(numero_oficio AS CHAR) LIKE ?)`;
        const term = `%${filtros.busqueda}%`;
        params.push(term, term, term);
    }

    sql += ' ORDER BY numero_oficio DESC';
    const [rows] = await pool.query(sql, params);
    return rows;
}

async function purgarOficiosInactivosPorNumero(pool, numero) {
    await pool.query(
        'DELETE FROM ambiental_control_oficios WHERE numero_oficio = ? AND activo = 0',
        [numero]
    );
}

async function crearOficio(pool, datos) {
    const numero = Number(datos.numero_oficio);
    if (!Number.isFinite(numero) || numero <= 0) {
        throw Object.assign(new Error('Número de oficio inválido'), { code: 'VALIDACION' });
    }
    await purgarOficiosInactivosPorNumero(pool, numero);
    const [result] = await pool.query(
        `INSERT INTO ambiental_control_oficios (numero_oficio, empresa, motivo) VALUES (?, ?, ?)`,
        [numero, (datos.empresa || '').trim(), (datos.motivo || '').trim()]
    );
    return obtenerOficioPorId(pool, result.insertId);
}

async function actualizarOficio(pool, oficioId, datos) {
    const numero = Number(datos.numero_oficio);
    if (!Number.isFinite(numero) || numero <= 0) {
        throw Object.assign(new Error('Número de oficio inválido'), { code: 'VALIDACION' });
    }
    await purgarOficiosInactivosPorNumero(pool, numero);
    await pool.query(
        `UPDATE ambiental_control_oficios
         SET numero_oficio = ?, empresa = ?, motivo = ?, updated_at = NOW()
         WHERE oficio_id = ? AND activo = 1`,
        [numero, (datos.empresa || '').trim(), (datos.motivo || '').trim(), oficioId]
    );
    return obtenerOficioPorId(pool, oficioId);
}

async function actualizarDocumentoOficio(pool, oficioId, datos) {
    await pool.query(
        `UPDATE ambiental_control_oficios
         SET documento_url = ?, documento_nombre = ?, documento_drive_id = ?, updated_at = NOW()
         WHERE oficio_id = ? AND activo = 1`,
        [
            datos.documento_url ?? null,
            datos.documento_nombre ?? null,
            datos.documento_drive_id ?? null,
            oficioId
        ]
    );
    return obtenerOficioPorId(pool, oficioId);
}

async function eliminarOficio(pool, oficioId) {
    const oficio = await obtenerOficioPorId(pool, oficioId);
    if (!oficio) return;
    if (oficio.documento_drive_id) {
        try {
            const ambientalAnexoService = require('./ambientalAnexoService');
            await ambientalAnexoService.eliminarAnexoOficio(oficio.documento_drive_id);
        } catch (e) {
            console.warn('[WARN] No se pudo eliminar anexo en Drive:', e.message);
        }
    }
    await pool.query('DELETE FROM ambiental_control_oficios WHERE oficio_id = ?', [oficioId]);
}

async function obtenerOficioPorId(pool, oficioId) {
    const [rows] = await pool.query(
        `SELECT oficio_id, numero_oficio, empresa, motivo,
                documento_url, documento_nombre, documento_drive_id,
                created_at, updated_at
         FROM ambiental_control_oficios WHERE oficio_id = ? AND activo = 1`,
        [oficioId]
    );
    return rows[0] || null;
}

async function estadisticasOficios(pool) {
    const [rows] = await pool.query(`
        SELECT
            COUNT(*) AS total,
            COUNT(DISTINCT empresa) AS empresas_unicas
        FROM ambiental_control_oficios
        WHERE activo = 1
    `);
    return rows[0];
}

async function obtenerSiguienteNumeroOficio(pool) {
    const [rows] = await pool.query(
        'SELECT COALESCE(MAX(numero_oficio), 0) AS max_num FROM ambiental_control_oficios WHERE activo = 1'
    );
    return Number(rows[0]?.max_num || 0) + 1;
}

async function listarTramites(pool, filtros = {}) {
    let sql = `
        SELECT tramite_id, empresa_id, empresa_nombre, item, oficio, accion_realizar, responsable,
               DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
               clasificacion, estatus, observaciones,
               documento_url, documento_nombre, documento_drive_id,
               contestacion_url, contestacion_nombre, contestacion_drive_id,
               tiene_contestacion,
               created_at, updated_at
        FROM ambiental_control_tramites
        WHERE activo = 1
    `;
    const params = [];

    if (Object.prototype.hasOwnProperty.call(filtros, 'empresa_id')) {
        const eid = normalizarEmpresaId(filtros.empresa_id);
        if (eid === null) {
            sql += ' AND empresa_id IS NULL';
        } else {
            sql += ' AND empresa_id = ?';
            params.push(eid);
        }
    }

    if (filtros.busqueda) {
        sql += ` AND (oficio LIKE ? OR accion_realizar LIKE ? OR observaciones LIKE ? OR CAST(item AS CHAR) LIKE ? OR IFNULL(empresa_nombre, '') LIKE ?)`;
        const term = `%${filtros.busqueda}%`;
        params.push(term, term, term, term, term);
    }
    if (filtros.estatus && ESTATUS_VALIDOS.includes(filtros.estatus)) {
        sql += ' AND estatus = ?';
        params.push(filtros.estatus);
    }
    if (filtros.responsable && RESPONSABLES_VALIDOS.includes(filtros.responsable)) {
        sql += ' AND responsable = ?';
        params.push(filtros.responsable);
    }

    sql += ' ORDER BY empresa_nombre ASC, item ASC';
    const [rows] = await pool.query(sql, params);
    return rows;
}

function normalizarResponsable(valor) {
    const v = (valor || '').trim();
    if (v.toLowerCase() === 'cliente') return 'Cliente';
    return 'Biznaga';
}

function normalizarEstatus(valor) {
    const v = (valor || '').trim().toLowerCase();
    return v === 'cerrado' ? 'cerrado' : 'abierto';
}

function normalizarClasificacion(valor) {
    const v = String(valor || '').trim().toUpperCase();
    return CLASIFICACIONES_VALIDAS.includes(v) ? v : null;
}

async function crearTramite(pool, datos) {
    const item = Number(datos.item);
    if (!Number.isFinite(item) || item <= 0) {
        throw Object.assign(new Error('Ítem inválido'), { code: 'VALIDACION' });
    }
    const empresaId = normalizarEmpresaId(datos.empresa_id);
    const [result] = await pool.query(
        `INSERT INTO ambiental_control_tramites
            (empresa_id, empresa_nombre, item, oficio, accion_realizar, responsable, fecha_vencimiento, clasificacion, estatus, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            empresaId,
            (datos.empresa_nombre || '').trim() || null,
            item,
            (datos.oficio || '').trim(),
            (datos.accion_realizar || '').trim(),
            normalizarResponsable(datos.responsable),
            datos.fecha_vencimiento || null,
            normalizarClasificacion(datos.clasificacion),
            normalizarEstatus(datos.estatus),
            (datos.observaciones || '').trim()
        ]
    );
    return obtenerTramitePorId(pool, result.insertId);
}

async function actualizarTramite(pool, tramiteId, datos) {
    const item = Number(datos.item);
    if (!Number.isFinite(item) || item <= 0) {
        throw Object.assign(new Error('Ítem inválido'), { code: 'VALIDACION' });
    }
    const actualizaClasificacion = Object.prototype.hasOwnProperty.call(datos, 'clasificacion');
    if (actualizaClasificacion) {
        await pool.query(
            `UPDATE ambiental_control_tramites
             SET item = ?, oficio = ?, accion_realizar = ?, responsable = ?,
                 fecha_vencimiento = ?, clasificacion = ?, estatus = ?, observaciones = ?, updated_at = NOW()
             WHERE tramite_id = ? AND activo = 1`,
            [
                item,
                (datos.oficio || '').trim(),
                (datos.accion_realizar || '').trim(),
                normalizarResponsable(datos.responsable),
                datos.fecha_vencimiento || null,
                normalizarClasificacion(datos.clasificacion),
                normalizarEstatus(datos.estatus),
                (datos.observaciones || '').trim(),
                tramiteId
            ]
        );
    } else {
        await pool.query(
            `UPDATE ambiental_control_tramites
             SET item = ?, oficio = ?, accion_realizar = ?, responsable = ?,
                 fecha_vencimiento = ?, estatus = ?, observaciones = ?, updated_at = NOW()
             WHERE tramite_id = ? AND activo = 1`,
            [
                item,
                (datos.oficio || '').trim(),
                (datos.accion_realizar || '').trim(),
                normalizarResponsable(datos.responsable),
                datos.fecha_vencimiento || null,
                normalizarEstatus(datos.estatus),
                (datos.observaciones || '').trim(),
                tramiteId
            ]
        );
    }
    return obtenerTramitePorId(pool, tramiteId);
}

async function eliminarTramite(pool, tramiteId) {
    await pool.query(
        'UPDATE ambiental_control_tramites SET activo = 0, updated_at = NOW() WHERE tramite_id = ?',
        [tramiteId]
    );
}

async function obtenerTramitePorId(pool, tramiteId) {
    const [rows] = await pool.query(
        `SELECT tramite_id, empresa_id, empresa_nombre, item, oficio, accion_realizar, responsable,
                DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                clasificacion, estatus, observaciones,
                documento_url, documento_nombre, documento_drive_id,
                contestacion_url, contestacion_nombre, contestacion_drive_id,
                tiene_contestacion,
                created_at, updated_at
         FROM ambiental_control_tramites WHERE tramite_id = ? AND activo = 1`,
        [tramiteId]
    );
    return rows[0] || null;
}

async function actualizarDocumentoTramite(pool, tramiteId, datos) {
    await pool.query(
        `UPDATE ambiental_control_tramites
         SET documento_url = ?, documento_nombre = ?, documento_drive_id = ?, updated_at = NOW()
         WHERE tramite_id = ? AND activo = 1`,
        [
            datos.documento_url ?? null,
            datos.documento_nombre ?? null,
            datos.documento_drive_id ?? null,
            tramiteId
        ]
    );
    return obtenerTramitePorId(pool, tramiteId);
}

async function actualizarContestacionTramite(pool, tramiteId, datos) {
    const driveId = datos.contestacion_drive_id ?? null;
    const tiene = driveId ? 1 : 0;
    await pool.query(
        `UPDATE ambiental_control_tramites
         SET contestacion_url = ?, contestacion_nombre = ?, contestacion_drive_id = ?,
             tiene_contestacion = ?, updated_at = NOW()
         WHERE tramite_id = ? AND activo = 1`,
        [
            datos.contestacion_url ?? null,
            datos.contestacion_nombre ?? null,
            driveId,
            tiene,
            tramiteId
        ]
    );
    return obtenerTramitePorId(pool, tramiteId);
}

async function marcarTieneContestacion(pool, tramiteId, tiene) {
    const flag = tiene ? 1 : 0;
    await pool.query(
        `UPDATE ambiental_control_tramites
         SET tiene_contestacion = ?, updated_at = NOW()
         WHERE tramite_id = ? AND activo = 1`,
        [flag, tramiteId]
    );
    return obtenerTramitePorId(pool, tramiteId);
}

async function listarEmpresaIdsConTramites(pool) {
    const [rows] = await pool.query(`
        SELECT DISTINCT empresa_id
        FROM ambiental_control_tramites
        WHERE activo = 1 AND empresa_id IS NOT NULL
    `);
    return rows
        .map((r) => Number(r.empresa_id))
        .filter((id) => Number.isFinite(id) && id > 0);
}

async function estadisticasTramites(pool, empresaId) {
    const tieneFiltro = empresaId !== undefined && empresaId !== null && empresaId !== '' && empresaId !== 'all' && Number(empresaId) !== -1;
    let where = '1=1';
    const params = [];
    if (tieneFiltro) {
        const eid = normalizarEmpresaId(empresaId);
        if (eid === null) {
            where = 'empresa_id IS NULL';
        } else {
            where = 'empresa_id = ?';
            params.push(eid);
        }
    }
    const [rows] = await pool.query(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN estatus = 'abierto' THEN 1 ELSE 0 END) AS abiertos,
            SUM(CASE WHEN estatus = 'cerrado' THEN 1 ELSE 0 END) AS cerrados,
            SUM(CASE WHEN fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURDATE() AND estatus = 'abierto' THEN 1 ELSE 0 END) AS vencidos
        FROM ambiental_control_tramites
        WHERE activo = 1 AND ${where}
    `, params);
    return rows[0];
}

async function actualizarTramitesLote(pool, tramites = []) {
    const resultados = [];
    for (const t of tramites) {
        const tramiteId = Number(t.tramite_id);
        if (!Number.isFinite(tramiteId) || tramiteId <= 0) continue;
        const actualizado = await actualizarTramite(pool, tramiteId, t);
        if (actualizado) resultados.push(actualizado);
    }
    return resultados;
}

async function obtenerMetaSpF28(pool) {
    let creado = await obtenerMetaAmbiental(pool, 'spf28_documento_creado_at');
    if (!creado) {
        creado = fechaHoyIso();
        await guardarMetaAmbiental(pool, 'spf28_documento_creado_at', creado);
    }
    return {
        nombre_empresa: (await obtenerMetaAmbiental(pool, 'spf28_nombre_empresa')) || '',
        nombre_consultor: (await obtenerMetaAmbiental(pool, 'spf28_nombre_consultor')) || '',
        documento_creado_at: creado
    };
}

async function guardarMetaSpF28(pool, datos = {}) {
    if (datos.nombre_empresa !== undefined) {
        await guardarMetaAmbiental(pool, 'spf28_nombre_empresa', String(datos.nombre_empresa || '').trim());
    }
    if (datos.nombre_consultor !== undefined) {
        await guardarMetaAmbiental(pool, 'spf28_nombre_consultor', String(datos.nombre_consultor || '').trim());
    }
    return obtenerMetaSpF28(pool);
}

async function obtenerSiguienteItemTramite(pool, empresaId) {
    const eid = normalizarEmpresaId(empresaId);
    const where = eid === null ? 'empresa_id IS NULL' : 'empresa_id = ?';
    const params = eid === null ? [] : [eid];
    const [rows] = await pool.query(
        `SELECT COALESCE(MAX(item), 0) AS max_item FROM ambiental_control_tramites WHERE ${where}`,
        params
    );
    return Number(rows[0]?.max_item || 0) + 1;
}

/** Fecha de hoy (YYYY-MM-DD) en horario de México, no UTC. */
function fechaHoyIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

function formatearFechaIso(fecha) {
    if (!fecha) return fechaHoyIso();
    if (fecha instanceof Date) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(fecha);
    }
    const s = String(fecha);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : fechaHoyIso();
}

/**
 * Metadatos del SP-F-28 por empresa (nombre, consultor, fecha de revisión).
 * Si no existe el registro de la empresa, lo crea con el nombre proporcionado.
 */
async function obtenerMetaSpF28Empresa(pool, empresaId, nombreEmpresaFallback = '') {
    const eid = normalizarEmpresaId(empresaId);
    if (eid === null) {
        return obtenerMetaSpF28(pool);
    }
    const [rows] = await pool.query(
        `SELECT empresa_id, nombre_empresa, nombre_consultor,
                DATE_FORMAT(documento_creado_at, '%Y-%m-%d') AS documento_creado_at
         FROM ambiental_spf28_empresa WHERE empresa_id = ? LIMIT 1`,
        [eid]
    );
    if (!rows[0]) {
        const creado = fechaHoyIso();
        await pool.query(
            `INSERT INTO ambiental_spf28_empresa (empresa_id, nombre_empresa, documento_creado_at)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE nombre_empresa = VALUES(nombre_empresa)`,
            [eid, String(nombreEmpresaFallback || '').trim(), creado]
        );
        return {
            empresa_id: eid,
            nombre_empresa: String(nombreEmpresaFallback || '').trim(),
            nombre_consultor: '',
            documento_creado_at: creado
        };
    }
    return {
        empresa_id: eid,
        nombre_empresa: rows[0].nombre_empresa || String(nombreEmpresaFallback || '').trim(),
        nombre_consultor: rows[0].nombre_consultor || '',
        documento_creado_at: formatearFechaIso(rows[0].documento_creado_at)
    };
}

async function guardarMetaSpF28Empresa(pool, empresaId, datos = {}) {
    const eid = normalizarEmpresaId(empresaId);
    if (eid === null) {
        return guardarMetaSpF28(pool, datos);
    }
    const actual = await obtenerMetaSpF28Empresa(pool, eid, datos.nombre_empresa);
    const nombreEmpresa = datos.nombre_empresa !== undefined
        ? String(datos.nombre_empresa || '').trim()
        : actual.nombre_empresa;
    const nombreConsultor = datos.nombre_consultor !== undefined
        ? String(datos.nombre_consultor || '').trim()
        : actual.nombre_consultor;
    await pool.query(
        `INSERT INTO ambiental_spf28_empresa (empresa_id, nombre_empresa, nombre_consultor, documento_creado_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            nombre_empresa = VALUES(nombre_empresa),
            nombre_consultor = VALUES(nombre_consultor),
            updated_at = NOW()`,
        [eid, nombreEmpresa, nombreConsultor, actual.documento_creado_at]
    );
    return obtenerMetaSpF28Empresa(pool, eid, nombreEmpresa);
}

async function obtenerDriveTabEmpresa(pool, empresaId) {
    const eid = normalizarEmpresaId(empresaId);
    if (eid === null) return null;
    const [rows] = await pool.query(
        'SELECT drive_tab_title, drive_sheet_gid, ultima_sync FROM ambiental_spf28_empresa WHERE empresa_id = ? LIMIT 1',
        [eid]
    );
    if (!rows[0]) return null;
    return {
        title: rows[0].drive_tab_title || null,
        gid: rows[0].drive_sheet_gid != null ? String(rows[0].drive_sheet_gid) : null,
        ultima_sync: rows[0].ultima_sync || null
    };
}

async function guardarDriveTabEmpresa(pool, empresaId, title, gid) {
    const eid = normalizarEmpresaId(empresaId);
    if (eid === null) return;
    await pool.query(
        `INSERT INTO ambiental_spf28_empresa (empresa_id, drive_tab_title, drive_sheet_gid)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
            drive_tab_title = VALUES(drive_tab_title),
            drive_sheet_gid = VALUES(drive_sheet_gid),
            updated_at = NOW()`,
        [eid, title || null, gid != null ? String(gid) : null]
    );
}

async function guardarUltimaSyncEmpresa(pool, empresaId, iso) {
    const eid = normalizarEmpresaId(empresaId);
    if (eid === null) {
        return guardarMetaAmbiental(pool, 'spf28_ultima_sync', iso);
    }
    await pool.query(
        `INSERT INTO ambiental_spf28_empresa (empresa_id, ultima_sync)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE ultima_sync = VALUES(ultima_sync), updated_at = NOW()`,
        [eid, iso]
    );
}

const AMBIENTAL_SGC_MIGRATION_REV = '2026-06-23';

async function tablaExisteEnPool(dbPool, tableName) {
    const [rows] = await dbPool.query(
        `SELECT 1 FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
        [tableName]
    );
    return rows.length > 0;
}

/**
 * Copia datos desde la BD principal (biznaga) a biznaga_sgc una sola vez, si existían allí.
 */
async function migrarAmbientalDesdeBiznagaPrincipalSiAplica(poolPrincipal, poolSgc) {
    if (!poolPrincipal || !poolSgc) return { migrated: false, reason: 'no_pools' };

    await asegurarTablasAmbiental(poolSgc);

    const rev = await obtenerMetaAmbiental(poolSgc, 'ambiental_db_sgc_rev');
    if (rev === AMBIENTAL_SGC_MIGRATION_REV) {
        return { migrated: false, reason: 'already_done' };
    }

    const [[destOficios]] = await poolSgc.query(
        'SELECT COUNT(*) AS n FROM ambiental_control_oficios'
    );
    const [[destTramites]] = await poolSgc.query(
        'SELECT COUNT(*) AS n FROM ambiental_control_tramites'
    );
    if (Number(destOficios.n) > 0 || Number(destTramites.n) > 0) {
        await guardarMetaAmbiental(poolSgc, 'ambiental_db_sgc_rev', AMBIENTAL_SGC_MIGRATION_REV);
        return { migrated: false, reason: 'dest_has_data' };
    }

    if (!(await tablaExisteEnPool(poolPrincipal, 'ambiental_control_oficios'))) {
        await guardarMetaAmbiental(poolSgc, 'ambiental_db_sgc_rev', AMBIENTAL_SGC_MIGRATION_REV);
        return { migrated: false, reason: 'no_source_tables' };
    }

    const [metaRows] = await poolPrincipal.query(
        'SELECT meta_key, meta_value FROM ambiental_meta'
    ).catch(() => [[]]);
    for (const row of metaRows) {
        await guardarMetaAmbiental(poolSgc, row.meta_key, row.meta_value);
    }

    const [oficios] = await poolPrincipal.query(`
        SELECT oficio_id, numero_oficio, empresa, motivo,
               documento_url, documento_nombre, documento_drive_id,
               activo, created_at, updated_at
        FROM ambiental_control_oficios
    `);
    for (const o of oficios) {
        await poolSgc.query(
            `INSERT INTO ambiental_control_oficios
                (oficio_id, numero_oficio, empresa, motivo,
                 documento_url, documento_nombre, documento_drive_id,
                 activo, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                o.oficio_id, o.numero_oficio, o.empresa ?? '', o.motivo ?? '',
                o.documento_url ?? null, o.documento_nombre ?? null, o.documento_drive_id ?? null,
                o.activo ?? 1, o.created_at, o.updated_at
            ]
        );
    }
    if (oficios.length) {
        const maxId = Math.max(...oficios.map((o) => Number(o.oficio_id)));
        await poolSgc.query('ALTER TABLE ambiental_control_oficios AUTO_INCREMENT = ?', [maxId + 1]);
    }

    const [tramites] = await poolPrincipal.query(`
        SELECT tramite_id, item, oficio, accion_realizar, responsable,
               fecha_vencimiento, estatus, observaciones, activo, created_at, updated_at
        FROM ambiental_control_tramites
    `);
    for (const t of tramites) {
        await poolSgc.query(
            `INSERT INTO ambiental_control_tramites
                (tramite_id, item, oficio, accion_realizar, responsable,
                 fecha_vencimiento, estatus, observaciones, activo, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                t.tramite_id, t.item, t.oficio ?? '', t.accion_realizar ?? '',
                t.responsable, t.fecha_vencimiento, t.estatus, t.observaciones ?? '',
                t.activo ?? 1, t.created_at, t.updated_at
            ]
        );
    }
    if (tramites.length) {
        const maxId = Math.max(...tramites.map((t) => Number(t.tramite_id)));
        await poolSgc.query('ALTER TABLE ambiental_control_tramites AUTO_INCREMENT = ?', [maxId + 1]);
    }

    await guardarMetaAmbiental(poolSgc, 'ambiental_db_sgc_rev', AMBIENTAL_SGC_MIGRATION_REV);
    return {
        migrated: true,
        oficios: oficios.length,
        tramites: tramites.length,
        meta: metaRows.length
    };
}

module.exports = {
    asegurarTablasAmbiental,
    guardarMetaAmbiental,
    obtenerMetaAmbiental,
    listarOficios,
    crearOficio,
    actualizarOficio,
    actualizarDocumentoOficio,
    eliminarOficio,
    estadisticasOficios,
    obtenerSiguienteNumeroOficio,
    listarTramites,
    obtenerTramitePorId,
    crearTramite,
    actualizarTramite,
    actualizarTramitesLote,
    actualizarDocumentoTramite,
    actualizarContestacionTramite,
    marcarTieneContestacion,
    eliminarTramite,
    estadisticasTramites,
    listarEmpresaIdsConTramites,
    obtenerMetaSpF28,
    guardarMetaSpF28,
    obtenerMetaSpF28Empresa,
    guardarMetaSpF28Empresa,
    obtenerDriveTabEmpresa,
    guardarDriveTabEmpresa,
    guardarUltimaSyncEmpresa,
    obtenerSiguienteItemTramite,
    migrarAmbientalDesdeBiznagaPrincipalSiAplica,
    RESPONSABLES_VALIDOS,
    ESTATUS_VALIDOS,
    CLASIFICACIONES_VALIDAS,
    normalizarClasificacion
};
