/**
 * Solicitudes de cambio a documentos SGC (flujo tipo tickets + wizard).
 * Tabla: sgc_solicitudes_documento (BD biznaga / pool principal).
 *
 * Pasos: revision → formato → lista_maestra → notificar → cerrado
 */
const ESTADOS = new Set(['abierto', 'en_progreso', 'cerrado']);
const TIPOS_SOLICITUD = new Set(['creacion', 'modificacion', 'eliminacion']);
const PASOS = new Set(['revision', 'formato', 'lista_maestra', 'notificar', 'cerrado']);

function normalizarTexto(valor, maxLen = 2000) {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

function normalizarEstado(estado) {
    const valor = String(estado || '').trim().toLowerCase();
    return ESTADOS.has(valor) ? valor : '';
}

function normalizarPaso(paso) {
    const valor = String(paso || '').trim().toLowerCase();
    return PASOS.has(valor) ? valor : '';
}

function normalizarTipoSolicitud(tipo) {
    const raw = String(tipo || '').trim().toLowerCase();
    const map = {
        creacion: 'creacion',
        creación: 'creacion',
        alta: 'creacion',
        modificacion: 'modificacion',
        modificación: 'modificacion',
        eliminacion: 'eliminacion',
        eliminación: 'eliminacion',
        baja: 'eliminacion'
    };
    const valor = map[raw] || raw;
    return TIPOS_SOLICITUD.has(valor) ? valor : '';
}

function labelTipoSolicitud(tipo) {
    const map = {
        creacion: 'Creación',
        modificacion: 'Modificación',
        eliminacion: 'Eliminación'
    };
    return map[tipo] || tipo;
}

function labelPaso(paso) {
    const map = {
        revision: 'Revisión',
        formato: 'Cambio de formato',
        lista_maestra: 'Lista maestra',
        notificar: 'Notificar sistemas',
        cerrado: 'Completado'
    };
    return map[paso] || paso;
}

function inferirTipoDocumentoDesdeCodigo(codigo) {
    const c = String(codigo || '').toUpperCase().trim();
    if (!c) return '';
    if (/-PO-/.test(c)) return 'Política';
    if (/-F-/.test(c)) return 'Formato';
    if (/-I-/.test(c)) return 'Instructivo';
    if (/-P-/.test(c)) return 'Procedimiento';
    return '';
}

function mapearTipoDocumento(especie, codigo) {
    const e = String(especie || '').trim();
    const lower = e.toLowerCase();
    if (lower.includes('polit')) return 'Política';
    if (lower.includes('instruct')) return 'Instructivo';
    if (lower.includes('proced')) return 'Procedimiento';
    if (lower.includes('format')) return 'Formato';
    if (lower.includes('manual')) return 'Manual';
    if (lower.includes('registro')) return 'Registro';
    if (e) return e;
    return inferirTipoDocumentoDesdeCodigo(codigo);
}

function fechaHoyIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

function incrementarVersion(versionActual) {
    const raw = String(versionActual || '00').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '01';
    const next = Number(digits) + 1;
    if (!Number.isFinite(next) || next < 0) return '01';
    return String(next).padStart(Math.max(2, digits.length), '0');
}

function estadoDesdePaso(paso) {
    if (paso === 'cerrado') return 'cerrado';
    if (paso === 'revision') return 'abierto';
    return 'en_progreso';
}

let tablaAsegurada = false;

async function asegurarColumnasFlujo(pool) {
    const alters = [
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN paso_flujo ENUM('revision','formato','lista_maestra','notificar','cerrado')
         NOT NULL DEFAULT 'revision' AFTER estado`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN autorizado_at DATETIME NULL AFTER paso_flujo`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN autorizado_por INT NULL AFTER autorizado_at`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN formato_listo TINYINT(1) NOT NULL DEFAULT 0 AFTER autorizado_por`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN catalog_key VARCHAR(128) NOT NULL DEFAULT '' AFTER formato_listo`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN drive_file_id VARCHAR(120) NOT NULL DEFAULT '' AFTER catalog_key`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN version_nueva VARCHAR(16) NOT NULL DEFAULT '' AFTER drive_file_id`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN fecha_revision_nueva DATE NULL AFTER version_nueva`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN lista_maestra_listo TINYINT(1) NOT NULL DEFAULT 0 AFTER fecha_revision_nueva`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN ticket_sistemas_id INT NULL AFTER lista_maestra_listo`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN notificar_sistemas TINYINT(1) NULL AFTER ticket_sistemas_id`,
        `ALTER TABLE sgc_solicitudes_documento
         ADD COLUMN notas_cambio TEXT NULL AFTER notificar_sistemas`
    ];
    for (const sql of alters) {
        try {
            await pool.query(sql);
        } catch (err) {
            if (err?.code !== 'ER_DUP_FIELDNAME') {
                // ignore duplicate; warn other errors
                if (!String(err?.message || '').includes('Duplicate column')) {
                    console.warn('[sgc-sol-doc] ALTER:', err.message);
                }
            }
        }
    }
}

async function asegurarTabla(pool) {
    if (tablaAsegurada) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_solicitudes_documento (
            solicitud_id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            nombre_documento VARCHAR(500) NOT NULL DEFAULT '',
            codigo VARCHAR(64) NOT NULL DEFAULT '',
            version_actual VARCHAR(16) NOT NULL DEFAULT '',
            tipo_documento VARCHAR(64) NOT NULL DEFAULT '',
            tipo_solicitud ENUM('creacion','modificacion','eliminacion') NOT NULL DEFAULT 'modificacion',
            motivo TEXT NOT NULL,
            estado ENUM('abierto','en_progreso','cerrado') NOT NULL DEFAULT 'abierto',
            paso_flujo ENUM('revision','formato','lista_maestra','notificar','cerrado') NOT NULL DEFAULT 'revision',
            autorizado_at DATETIME NULL,
            autorizado_por INT NULL,
            formato_listo TINYINT(1) NOT NULL DEFAULT 0,
            catalog_key VARCHAR(128) NOT NULL DEFAULT '',
            drive_file_id VARCHAR(120) NOT NULL DEFAULT '',
            version_nueva VARCHAR(16) NOT NULL DEFAULT '',
            fecha_revision_nueva DATE NULL,
            lista_maestra_listo TINYINT(1) NOT NULL DEFAULT 0,
            ticket_sistemas_id INT NULL,
            notificar_sistemas TINYINT(1) NULL,
            notas_cambio TEXT NULL,
            nombre_solicitante VARCHAR(255) NOT NULL DEFAULT '',
            puesto_solicitante VARCHAR(255) NOT NULL DEFAULT '',
            fecha_solicitud DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_sgc_sol_doc_estado (estado),
            INDEX idx_sgc_sol_doc_paso (paso_flujo),
            INDEX idx_sgc_sol_doc_usuario (usuario_id),
            INDEX idx_sgc_sol_doc_fecha (fecha_solicitud),
            INDEX idx_sgc_sol_doc_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnasFlujo(pool);
    tablaAsegurada = true;
}

async function obtenerDatosUsuario(pool, usuarioId) {
    const uid = Number(usuarioId);
    if (!Number.isFinite(uid) || uid <= 0) {
        return { nombre: '', puesto: '' };
    }
    const [rows] = await pool.query(
        `SELECT u.nombre, u.apellido, u.username, u.organigrama
         FROM usuario u
         WHERE u.id = ? AND u.activo = 1
         LIMIT 1`,
        [uid]
    );
    const u = rows?.[0];
    if (!u) {
        return { nombre: '', puesto: '' };
    }
    const partes = [u.nombre, u.apellido].filter(Boolean);
    const nombre = partes.join(' ').trim() || String(u.username || '').trim();
    const puesto = String(u.organigrama || '').trim();
    return { nombre, puesto };
}

async function listarIdsGestores(pool) {
    const [rows] = await pool.query(
        `SELECT DISTINCT u.id
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE u.activo = 1
           AND (
             LOWER(COALESCE(r.nombre_rol, '')) = 'root'
             OR LOWER(COALESCE(u.roles_adicionales, '')) LIKE '%root%'
             OR LOWER(COALESCE(u.username, '')) IN ('sergio56', 'calidad')
           )`
    );
    return (rows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function notificarGestores(pool, { titulo, mensaje, ruta, excluirUsuarioId = null }) {
    const ids = await listarIdsGestores(pool);
    const excluir = Number(excluirUsuarioId);
    for (const usuarioId of ids) {
        if (Number.isFinite(excluir) && excluir > 0 && usuarioId === excluir) {
            continue;
        }
        await pool.query(
            `INSERT INTO notificacion_usuario (usuario_id, tipo, icono, titulo, mensaje, ruta)
             VALUES (?, 'info', 'fa-file-signature', ?, ?, ?)`,
            [usuarioId, titulo, mensaje, ruta || '/sistema-gestion-calidad/solicitud-documentos']
        );
    }
    return ids.length;
}

function mapRow(row) {
    const paso = normalizarPaso(row.paso_flujo) || 'revision';
    return {
        solicitud_id: Number(row.solicitud_id),
        usuario_id: Number(row.usuario_id),
        nombre_documento: row.nombre_documento || '',
        codigo: row.codigo || '',
        version_actual: row.version_actual || '',
        tipo_documento: row.tipo_documento || '',
        tipo_solicitud: row.tipo_solicitud || 'modificacion',
        tipo_solicitud_label: labelTipoSolicitud(row.tipo_solicitud),
        motivo: row.motivo || '',
        estado: row.estado || 'abierto',
        paso_flujo: paso,
        paso_flujo_label: labelPaso(paso),
        autorizado_at: row.autorizado_at || null,
        autorizado_por: row.autorizado_por != null ? Number(row.autorizado_por) : null,
        formato_listo: Number(row.formato_listo) === 1,
        catalog_key: row.catalog_key || '',
        drive_file_id: row.drive_file_id || '',
        version_nueva: row.version_nueva || '',
        fecha_revision_nueva: row.fecha_revision_nueva || null,
        lista_maestra_listo: Number(row.lista_maestra_listo) === 1,
        ticket_sistemas_id: row.ticket_sistemas_id != null ? Number(row.ticket_sistemas_id) : null,
        notificar_sistemas: row.notificar_sistemas == null ? null : Number(row.notificar_sistemas) === 1,
        notas_cambio: row.notas_cambio || '',
        nombre_solicitante: row.nombre_solicitante || '',
        puesto_solicitante: String(row.puesto_solicitante || '').trim() || String(row.autor_organigrama || '').trim(),
        fecha_solicitud: row.fecha_solicitud,
        created_at: row.created_at,
        updated_at: row.updated_at,
        autor_nombre: row.autor_nombre || row.nombre_solicitante || '',
        autor_usuario: row.autor_usuario || ''
    };
}

async function obtenerPorId(pool, solicitudId) {
    await asegurarTabla(pool);
    const id = Number(solicitudId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const [rows] = await pool.query(
        `SELECT s.*,
                TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellido, ''))) AS autor_nombre,
                u.username AS autor_usuario,
                u.organigrama AS autor_organigrama
         FROM sgc_solicitudes_documento s
         LEFT JOIN usuario u ON u.id = s.usuario_id
         WHERE s.solicitud_id = ?
         LIMIT 1`,
        [id]
    );
    return rows?.[0] ? mapRow(rows[0]) : null;
}

async function crear(pool, payload) {
    await asegurarTabla(pool);
    const usuarioId = Number(payload?.usuarioId);
    const nombreDocumento = normalizarTexto(payload?.nombreDocumento, 500);
    const codigo = normalizarTexto(payload?.codigo, 64);
    const versionActual = normalizarTexto(payload?.versionActual, 16);
    const tipoDocumento = normalizarTexto(
        payload?.tipoDocumento || inferirTipoDocumentoDesdeCodigo(codigo),
        64
    );
    const tipoSolicitud = normalizarTipoSolicitud(payload?.tipoSolicitud) || 'modificacion';
    const motivo = normalizarTexto(payload?.motivo, 4000);

    if (!nombreDocumento && !codigo) {
        const error = new Error('Indica el nombre del documento o su código');
        error.status = 400;
        throw error;
    }
    if (!motivo) {
        const error = new Error('El motivo es obligatorio');
        error.status = 400;
        throw error;
    }
    if (!usuarioId) {
        const error = new Error('Usuario no autenticado');
        error.status = 401;
        throw error;
    }

    const { nombre, puesto } = await obtenerDatosUsuario(pool, usuarioId);
    const fechaSolicitud = fechaHoyIso();

    const [result] = await pool.query(
        `INSERT INTO sgc_solicitudes_documento (
            usuario_id, nombre_documento, codigo, version_actual, tipo_documento,
            tipo_solicitud, motivo, estado, paso_flujo, nombre_solicitante, puesto_solicitante, fecha_solicitud
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto', 'revision', ?, ?, ?)`,
        [
            usuarioId,
            nombreDocumento,
            codigo,
            versionActual,
            tipoDocumento,
            tipoSolicitud,
            motivo,
            nombre,
            puesto,
            fechaSolicitud
        ]
    );

    const solicitudId = result.insertId;
    const etiquetaDoc = codigo || nombreDocumento;
    const resumen = motivo.length > 90 ? `${motivo.slice(0, 87)}…` : motivo;

    await notificarGestores(pool, {
        titulo: `${labelTipoSolicitud(tipoSolicitud)} · ${etiquetaDoc}`,
        mensaje: `${nombre || 'Usuario'}: ${resumen}`,
        ruta: '/sistema-gestion-calidad/solicitud-documentos',
        excluirUsuarioId: usuarioId
    });

    return obtenerPorId(pool, solicitudId);
}

async function listar(pool, { estado, usuarioId = null, paso = null } = {}) {
    await asegurarTabla(pool);
    const estadoFiltro = normalizarEstado(estado);
    const pasoFiltro = normalizarPaso(paso);
    const params = [];
    const clauses = [];

    const uid = Number(usuarioId);
    if (Number.isFinite(uid) && uid > 0) {
        clauses.push('s.usuario_id = ?');
        params.push(uid);
    }
    if (estadoFiltro) {
        clauses.push('s.estado = ?');
        params.push(estadoFiltro);
    }
    if (pasoFiltro) {
        clauses.push('s.paso_flujo = ?');
        params.push(pasoFiltro);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
        `SELECT
            s.*,
            TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellido, ''))) AS autor_nombre,
            u.username AS autor_usuario,
            u.organigrama AS autor_organigrama
         FROM sgc_solicitudes_documento s
         LEFT JOIN usuario u ON u.id = s.usuario_id
         ${where}
         ORDER BY s.created_at DESC, s.solicitud_id DESC`,
        params
    );

    return (rows || []).map(mapRow);
}

async function actualizarEstado(pool, solicitudId, estado) {
    await asegurarTabla(pool);
    const id = Number(solicitudId);
    const estadoLimpio = normalizarEstado(estado);
    if (!Number.isFinite(id) || id <= 0) {
        const error = new Error('Solicitud no válida');
        error.status = 400;
        throw error;
    }
    if (!estadoLimpio) {
        const error = new Error('Estatus no válido');
        error.status = 400;
        throw error;
    }

    let pasoExtra = '';
    const params = [estadoLimpio];
    if (estadoLimpio === 'cerrado') {
        pasoExtra = ', paso_flujo = ?';
        params.push('cerrado');
    } else if (estadoLimpio === 'abierto') {
        pasoExtra = ', paso_flujo = ?';
        params.push('revision');
    }
    params.push(id);

    const [result] = await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET estado = ?, updated_at = NOW()${pasoExtra}
         WHERE solicitud_id = ?`,
        params
    );
    if (!result.affectedRows) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    return obtenerPorId(pool, id);
}

async function autorizar(pool, solicitudId, usuarioId) {
    await asegurarTabla(pool);
    const actual = await obtenerPorId(pool, solicitudId);
    if (!actual) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    if (actual.paso_flujo !== 'revision' && actual.paso_flujo !== 'formato') {
        // permitir reabrir a formato si ya autorizado
    }
    if (actual.estado === 'cerrado') {
        const error = new Error('La solicitud ya está cerrada');
        error.status = 400;
        throw error;
    }

    await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET estado = 'en_progreso',
             paso_flujo = 'formato',
             autorizado_at = NOW(),
             autorizado_por = ?,
             updated_at = NOW()
         WHERE solicitud_id = ?`,
        [Number(usuarioId) || null, actual.solicitud_id]
    );
    return obtenerPorId(pool, actual.solicitud_id);
}

async function marcarFormatoListo(pool, solicitudId, datos = {}) {
    await asegurarTabla(pool);
    const actual = await obtenerPorId(pool, solicitudId);
    if (!actual) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    if (actual.paso_flujo === 'revision') {
        const error = new Error('Primero autoriza la solicitud');
        error.status = 400;
        throw error;
    }
    if (actual.estado === 'cerrado') {
        const error = new Error('La solicitud ya está cerrada');
        error.status = 400;
        throw error;
    }

    const versionNueva = normalizarTexto(datos.versionNueva, 16)
        || incrementarVersion(actual.version_actual);
    const fechaRevision = normalizarTexto(datos.fechaRevisionNueva, 16) || fechaHoyIso();
    const catalogKey = normalizarTexto(datos.catalogKey, 128) || actual.catalog_key;
    const driveFileId = normalizarTexto(datos.driveFileId, 120) || actual.drive_file_id;

    await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET formato_listo = 1,
             paso_flujo = 'lista_maestra',
             estado = 'en_progreso',
             catalog_key = ?,
             drive_file_id = ?,
             version_nueva = ?,
             fecha_revision_nueva = ?,
             updated_at = NOW()
         WHERE solicitud_id = ?`,
        [catalogKey, driveFileId, versionNueva, fechaRevision, actual.solicitud_id]
    );
    return obtenerPorId(pool, actual.solicitud_id);
}

async function marcarListaMaestraListo(pool, solicitudId, datos = {}) {
    await asegurarTabla(pool);
    const actual = await obtenerPorId(pool, solicitudId);
    if (!actual) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    if (!actual.formato_listo && actual.paso_flujo === 'formato') {
        const error = new Error('Primero actualiza el formato del documento');
        error.status = 400;
        throw error;
    }
    if (actual.estado === 'cerrado') {
        const error = new Error('La solicitud ya está cerrada');
        error.status = 400;
        throw error;
    }

    const versionNueva = normalizarTexto(datos.versionNueva, 16)
        || actual.version_nueva
        || incrementarVersion(actual.version_actual);
    const fechaRevision = normalizarTexto(datos.fechaRevisionNueva, 16)
        || actual.fecha_revision_nueva
        || fechaHoyIso();

    await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET lista_maestra_listo = 1,
             paso_flujo = 'notificar',
             estado = 'en_progreso',
             version_nueva = ?,
             fecha_revision_nueva = ?,
             version_actual = ?,
             updated_at = NOW()
         WHERE solicitud_id = ?`,
        [versionNueva, fechaRevision, versionNueva, actual.solicitud_id]
    );
    return obtenerPorId(pool, actual.solicitud_id);
}

async function cerrarConNotificacion(pool, solicitudId, { notificar, ticketId = null, notasCambio = '' } = {}) {
    await asegurarTabla(pool);
    const actual = await obtenerPorId(pool, solicitudId);
    if (!actual) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    if (actual.estado === 'cerrado') {
        return actual;
    }
    if (!actual.lista_maestra_listo && actual.paso_flujo !== 'notificar' && actual.paso_flujo !== 'cerrado') {
        const error = new Error('Completa la actualización de la lista maestra antes de cerrar');
        error.status = 400;
        throw error;
    }

    const notas = normalizarTexto(notasCambio, 4000);
    const ticket = ticketId != null ? Number(ticketId) : null;

    await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET estado = 'cerrado',
             paso_flujo = 'cerrado',
             notificar_sistemas = ?,
             ticket_sistemas_id = ?,
             notas_cambio = ?,
             updated_at = NOW()
         WHERE solicitud_id = ?`,
        [notificar ? 1 : 0, Number.isFinite(ticket) ? ticket : null, notas || null, actual.solicitud_id]
    );
    return obtenerPorId(pool, actual.solicitud_id);
}

async function listarCatalogoDocumentos(poolSgc, sgcF01Service) {
    let documentos = [];
    try {
        if (poolSgc && sgcF01Service?.cargarFormato) {
            const payload = await sgcF01Service.cargarFormato(poolSgc);
            documentos = Array.isArray(payload?.datos?.documentos)
                ? payload.datos.documentos
                : [];
        }
    } catch (err) {
        console.warn('[sgc-sol-doc] No se pudo cargar catálogo F-01 desde BD:', err.message);
    }

    if (!documentos.length && sgcF01Service?.cargarFormato) {
        try {
            const fallback = await sgcF01Service.cargarFormato(null);
            documentos = Array.isArray(fallback?.datos?.documentos)
                ? fallback.datos.documentos
                : [];
        } catch (_err) {
            documentos = [];
        }
    }

    return (documentos || [])
        .filter((d) => d && d.vigente !== false && (d.nombreDocumento || d.codigo))
        .map((d) => ({
            nombreDocumento: String(d.nombreDocumento || '').trim(),
            codigo: String(d.codigo || '').trim(),
            versionVigente: String(d.versionVigente || '').trim(),
            especie: String(d.especie || d.tipoDocumento || '').trim(),
            tipoDocumento: mapearTipoDocumento(d.especie || d.tipoDocumento, d.codigo),
            area: String(d.area || '').trim(),
            tipo: String(d.tipo || d.tipoDocumento || '').trim(),
            fechaRevision: String(d.fechaRevision || '').trim(),
            responsable: String(d.responsable || d.responsableConservarlo || '').trim(),
            vigente: d.vigente !== false
        }));
}

async function resolverArchivoPorCodigo(poolSgc, formatosDescargaService, codigoRaw) {
    const codigo = String(codigoRaw || '').trim().toUpperCase();
    if (!codigo || !poolSgc) {
        return null;
    }

    // 1) Formatos interactivos SGC (sgc_formato_cabecera.drive_file_id) — ej. DG-F-04 FODA
    try {
        const [rows] = await poolSgc.query(
            `SELECT codigo_formato, drive_file_id
             FROM sgc_formato_cabecera
             WHERE UPPER(TRIM(codigo_formato)) = ?
             LIMIT 1`,
            [codigo]
        );
        const row = rows?.[0];
        const driveId = String(row?.drive_file_id || '').trim();
        if (driveId) {
            return {
                origen: 'formato_interactivo',
                catalog_key: `sgc:${codigo}`,
                codigo,
                titulo: codigo,
                nombre_archivo: codigo,
                drive_file_id_actual: driveId,
                version_actual: null,
                tipo_archivo: 'interactivo'
            };
        }
    } catch (err) {
        console.warn('[sgc-sol-doc] cabecera formato:', err.message);
    }

    // 2) Formatos de descarga (PDF/Word/Excel en Drive)
    try {
        if (formatosDescargaService?.listarActivos) {
            const activos = await formatosDescargaService.listarActivos(poolSgc);
            const lista = Array.isArray(activos) ? activos : [];
            const hit = lista.find(
                (f) => String(f.codigo || '').trim().toUpperCase() === codigo
            );
            if (hit?.drive_file_id_actual) {
                return {
                    origen: 'formato_descarga',
                    catalog_key: hit.catalog_key || '',
                    codigo: hit.codigo || codigo,
                    titulo: hit.titulo || '',
                    nombre_archivo: hit.nombre_archivo || '',
                    drive_file_id_actual: hit.drive_file_id_actual,
                    version_actual: hit.version_actual,
                    tipo_archivo: 'descarga'
                };
            }
        }
    } catch (err) {
        console.warn('[sgc-sol-doc] formatos-descarga:', err.message);
    }

    // 3) Instructivos / procedimientos (si existen tablas)
    for (const tabla of ['sgc_instructivos', 'sgc_procedimientos']) {
        try {
            const [rows] = await poolSgc.query(
                `SELECT codigo, titulo, drive_file_id, nombre_archivo
                 FROM ${tabla}
                 WHERE UPPER(TRIM(codigo)) = ? AND activo = 1
                 LIMIT 1`,
                [codigo]
            );
            const row = rows?.[0];
            const driveId = String(row?.drive_file_id || '').trim();
            if (driveId) {
                return {
                    origen: tabla,
                    catalog_key: `${tabla}:${codigo}`,
                    codigo: row.codigo || codigo,
                    titulo: row.titulo || '',
                    nombre_archivo: row.nombre_archivo || '',
                    drive_file_id_actual: driveId,
                    version_actual: null,
                    tipo_archivo: 'pdf'
                };
            }
        } catch (_err) {
            // tabla puede no existir
        }
    }

    return null;
}

async function resolverContextoGestion({
    pool,
    poolSgc,
    solicitudId,
    sgcF01Service,
    formatosDescargaService
}) {
    const solicitud = await obtenerPorId(pool, solicitudId);
    if (!solicitud) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }

    let documentoMaestro = null;
    try {
        const docs = await listarCatalogoDocumentos(poolSgc, sgcF01Service);
        const codigo = String(solicitud.codigo || '').trim().toUpperCase();
        documentoMaestro = docs.find((d) => String(d.codigo || '').toUpperCase() === codigo) || null;
        if (!documentoMaestro && solicitud.nombre_documento) {
            const nom = String(solicitud.nombre_documento).trim().toLowerCase();
            documentoMaestro = docs.find(
                (d) => String(d.nombreDocumento || '').trim().toLowerCase() === nom
            ) || null;
            // búsqueda parcial (ej. "FODA" → "Análisis FODA")
            if (!documentoMaestro && nom.length >= 3) {
                documentoMaestro = docs.find((d) =>
                    String(d.nombreDocumento || '').toLowerCase().includes(nom)
                ) || null;
            }
        }
    } catch (err) {
        console.warn('[sgc-sol-doc] contexto F-01:', err.message);
    }

    const codigoBusqueda = String(
        solicitud.codigo || documentoMaestro?.codigo || ''
    ).trim();

    let formatoDescarga = await resolverArchivoPorCodigo(
        poolSgc,
        formatosDescargaService,
        codigoBusqueda
    );

    // Si la solicitud ya tiene drive_file_id guardado, priorizarlo
    if (!formatoDescarga && solicitud.drive_file_id) {
        formatoDescarga = {
            origen: 'solicitud',
            catalog_key: solicitud.catalog_key || '',
            codigo: codigoBusqueda,
            titulo: solicitud.nombre_documento || '',
            nombre_archivo: '',
            drive_file_id_actual: solicitud.drive_file_id,
            version_actual: null,
            tipo_archivo: 'guardado'
        };
    }

    if (formatoDescarga && documentoMaestro) {
        formatoDescarga = {
            ...formatoDescarga,
            titulo: formatoDescarga.titulo || documentoMaestro.nombreDocumento || '',
            codigo: formatoDescarga.codigo || documentoMaestro.codigo || codigoBusqueda
        };
    }

    const versionBase = documentoMaestro?.versionVigente || solicitud.version_actual || '00';
    const versionPropuesta = solicitud.version_nueva || incrementarVersion(versionBase);
    const fechaPropuesta = solicitud.fecha_revision_nueva || fechaHoyIso();

    return {
        solicitud,
        documentoMaestro,
        formatoDescarga,
        propuesta: {
            versionNueva: versionPropuesta,
            versionAnterior: versionBase,
            fechaRevisionNueva: fechaPropuesta,
            fechaHoyMexico: fechaHoyIso()
        }
    };
}

async function regresarPaso(pool, solicitudId) {
    await asegurarTabla(pool);
    const actual = await obtenerPorId(pool, solicitudId);
    if (!actual) {
        const error = new Error('Solicitud no encontrada');
        error.status = 404;
        throw error;
    }
    if (actual.estado === 'cerrado' || actual.paso_flujo === 'cerrado') {
        const error = new Error('No se puede regresar una solicitud cerrada');
        error.status = 400;
        throw error;
    }

    const mapaRegreso = {
        formato: {
            paso: 'revision',
            estado: 'abierto',
            extra: 'autorizado_at = NULL, autorizado_por = NULL, formato_listo = 0'
        },
        lista_maestra: {
            paso: 'formato',
            estado: 'en_progreso',
            extra: 'formato_listo = 0, lista_maestra_listo = 0'
        },
        notificar: {
            paso: 'lista_maestra',
            estado: 'en_progreso',
            extra: 'lista_maestra_listo = 0, notificar_sistemas = NULL, ticket_sistemas_id = NULL'
        }
    };

    const dest = mapaRegreso[actual.paso_flujo];
    if (!dest) {
        const error = new Error('No hay un paso anterior disponible');
        error.status = 400;
        throw error;
    }

    await pool.query(
        `UPDATE sgc_solicitudes_documento
         SET paso_flujo = ?,
             estado = ?,
             ${dest.extra},
             updated_at = NOW()
         WHERE solicitud_id = ?`,
        [dest.paso, dest.estado, actual.solicitud_id]
    );
    return obtenerPorId(pool, actual.solicitud_id);
}

module.exports = {
    asegurarTabla,
    crear,
    listar,
    obtenerPorId,
    actualizarEstado,
    autorizar,
    marcarFormatoListo,
    marcarListaMaestraListo,
    cerrarConNotificacion,
    regresarPaso,
    listarCatalogoDocumentos,
    resolverContextoGestion,
    resolverArchivoPorCodigo,
    incrementarVersion,
    fechaHoyIso,
    inferirTipoDocumentoDesdeCodigo,
    mapearTipoDocumento,
    labelTipoSolicitud,
    labelPaso,
    PASOS
};
