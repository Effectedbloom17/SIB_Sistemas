/**
 * Centro de operaciones PIPC — ciclo activo por empresa y documentos de workflow.
 */

const { repararPadresPipcHuerfanos } = require('./pcPipcAsignacionService');

const PC_OPS_PASOS = ['asignar', 'recorrido', 'documentacion', 'oficio', 'observaciones', 'resolutivo', 'finalizar'];
const PC_OPS_PASOS_OBLIGATORIOS_FINAL = ['asignar', 'documentacion', 'oficio', 'resolutivo'];

/** Claves legacy (compatibilidad con ciclos antiguos). */
const PC_WORKFLOW_CLAVES_LEGACY = {
    ops_oficio_ingreso: 'Oficio de Ingreso',
    ops_observacion_1: 'Observación 1',
    ops_observacion_2: 'Observación 2',
    ops_resolutivo_pipc: 'Resolutivo PIPC',
    ops_resolutivo_factibilidad: 'Resolutivo Factibilidad',
    ops_resolutivo_otms: 'Resolutivo OTMS'
};

/** @deprecated Usar claves dinámicas ops_oficio_{id} / ops_obs_{id} / ops_resolutivo_{id} */
const PC_WORKFLOW_CLAVES = PC_WORKFLOW_CLAVES_LEGACY;

const CAMPOS_FECHA_CICLO = new Set([
    'fecha_ingreso_tramite',
    'fecha_oficio_observaciones',
    'fecha_aprobacion',
    'fecha_aprobacion_pipc',
    'fecha_aprobacion_factibilidad',
    'fecha_aprobacion_otms'
]);

function parseFechasWorkflow(raw) {
    if (!raw) return {};
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
        return {};
    }
}

function claveOficioPipc(padreId) {
    return `ops_oficio_${padreId}`;
}

function claveObs1Pipc(padreId) {
    return `ops_obs1_${padreId}`;
}

function claveObs2Pipc(padreId) {
    return `ops_obs2_${padreId}`;
}

/** Clave de fecha de observaciones por PIPC (en fechas_workflow). */
function claveFechaObsPipc(padreId) {
    return `ops_obs_${padreId}`;
}

function claveResolutivoTipoPipc(padreId, tipo) {
    return `ops_resolutivo_${tipo}_${padreId}`;
}

const RESOLUTIVO_TIPOS = [
    { tipo: 'pipc', label: 'PIPC', tipoSpf29: 'PIPC' },
    { tipo: 'factibilidad', label: 'Factibilidad', tipoSpf29: 'Factibilidad' },
    { tipo: 'otms', label: 'OTMS', tipoSpf29: 'OTMS' }
];

/**
 * Parsea campos de fecha dinámicos del workflow.
 * fecha_oficio_123 → ops_oficio_123
 * fecha_obs_123 → ops_obs_123
 * fecha_resolutivo_pipc_123 → ops_resolutivo_pipc_123
 * (legacy) fecha_resolutivo_123 → ops_resolutivo_pipc_123
 */
function parseCampoFechaWorkflowDinamico(campo) {
    const c = String(campo || '');
    let m = c.match(/^fecha_oficio_(\d+)$/);
    if (m) return { padreId: Number(m[1]), claveWorkflow: claveOficioPipc(m[1]) };

    m = c.match(/^fecha_obs_(\d+)$/);
    if (m) return { padreId: Number(m[1]), claveWorkflow: claveFechaObsPipc(m[1]) };

    m = c.match(/^fecha_resolutivo_(pipc|factibilidad|otms)_(\d+)$/);
    if (m) return { padreId: Number(m[2]), claveWorkflow: claveResolutivoTipoPipc(m[2], m[1]) };

    // Legacy: fecha_resolutivo_{id} → slot PIPC
    m = c.match(/^fecha_resolutivo_(\d+)$/);
    if (m) return { padreId: Number(m[1]), claveWorkflow: claveResolutivoTipoPipc(m[1], 'pipc') };

    return null;
}

/** @deprecated usar parseCampoFechaWorkflowDinamico */
function parseCampoFechaResolutivoDinamico(campo) {
    return parseCampoFechaWorkflowDinamico(campo);
}

/** Padres PIPC activos (con requisitos reales) asignados a la empresa. */
function listarPipcAsignadosActivos(allDocs = []) {
    const normales = (allDocs || []).filter((doc) => !doc.clave_workflow);
    const hijos = normales.filter((doc) => Number(doc.documento_padre_id || 0) > 0);
    const padresPipc = normales.filter(
        (doc) => !Number(doc.documento_padre_id || 0) && Number(doc.catalogo_documento_id || 0) > 0
    );
    return padresPipc
        .filter((padre) => {
            const subs = hijos
                .filter((hijo) => mismoPadreId(hijo.documento_padre_id, padre.documento_id))
                .filter((hijo) => !esSubtituloOperativo(hijo.nombre_documento));
            return subs.length > 0;
        })
        .map((padre) => {
            const id = Number(padre.documento_id);
            const nombre = String(padre.nombre_documento || `PIPC ${id}`).trim();
            return {
                documento_id: id,
                catalogo_documento_id: Number(padre.catalogo_documento_id) || null,
                nombre_documento: nombre,
                clave_oficio: claveOficioPipc(id),
                clave_obs_1: claveObs1Pipc(id),
                clave_obs_2: claveObs2Pipc(id),
                clave_fecha_obs: claveFechaObsPipc(id),
                clave_resolutivo_pipc: claveResolutivoTipoPipc(id, 'pipc'),
                clave_resolutivo_factibilidad: claveResolutivoTipoPipc(id, 'factibilidad'),
                clave_resolutivo_otms: claveResolutivoTipoPipc(id, 'otms'),
                /** @deprecated compat lectura antigua */
                clave_obs: claveObs1Pipc(id),
                clave_resolutivo: claveResolutivoTipoPipc(id, 'pipc')
            };
        })
        .sort((a, b) => a.nombre_documento.localeCompare(b.nombre_documento, 'es'));
}

function tieneArchivoWorkflow(archivosWorkflow, clave) {
    const a = archivosWorkflow?.[clave];
    return !!(a?.archivo_url || a?.nombre_archivo);
}

function parsePasosCompletados(raw) {
    if (!raw) return [];
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(arr) ? arr.filter((p) => PC_OPS_PASOS.includes(p)) : [];
    } catch {
        return [];
    }
}

function esSubtituloOperativo(nombre = '') {
    const n = String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return n === 'fisico' || n === 'usb' || n === 'presentar';
}

function tieneContenidoEntregable(doc) {
    if (String(doc.tipo_entrada || '').toLowerCase() === 'texto') {
        return !!String(doc.valor_texto || '').trim();
    }
    return !!(doc.archivo_url || doc.nombre_archivo);
}

function mismoPadreId(hijoPadreId, padreId) {
    return Number(hijoPadreId || 0) === Number(padreId || 0);
}

function agruparDocumentosAsignacion(allDocs) {
    const normales = allDocs.filter((d) => !d.clave_workflow);
    const padres = normales.filter((d) => !Number(d.documento_padre_id || 0));
    const hijos = normales.filter((d) => Number(d.documento_padre_id || 0) > 0);
    return padres.map((padre) => ({
        ...padre,
        subdocumentos: hijos
            .filter((h) => mismoPadreId(h.documento_padre_id, padre.documento_id))
            .filter((h) => !esSubtituloOperativo(h.nombre_documento))
    }));
}

function todosDocumentosAsignacionCargados(allDocs) {
    const grupos = agruparDocumentosAsignacion(allDocs);
    if (!grupos.length) return false;

    for (const padre of grupos) {
        const subs = padre.subdocumentos || [];
        if (subs.length > 0) {
            for (const sub of subs) {
                if (!tieneContenidoEntregable(sub)) return false;
            }
        } else if (!tieneContenidoEntregable(padre)) {
            return false;
        }
    }
    return true;
}

/** Misma regla que el stepper «Subir documentación» en el frontend. */
function esElementoCompletadoSubir(doc) {
    const tipo =
        doc.tipo_entrada === 'texto' || /\*\s*$/.test(String(doc.nombre_documento || ''))
            ? 'texto'
            : 'archivo';
    if (tipo === 'texto') {
        const tieneTexto = !!String(doc.valor_texto || '').trim();
        return doc.estatus === 'aprobado' || (doc.estatus === 'revision' && tieneTexto);
    }
    return (
        doc.estatus === 'aprobado' ||
        (doc.estatus === 'revision' && !!(doc.archivo_url || doc.nombre_archivo))
    );
}

function esPadreCompletadoSubir(padre, hijos) {
    const subs = hijos
        .filter((h) => mismoPadreId(h.documento_padre_id, padre.documento_id))
        .filter((h) => !esSubtituloOperativo(h.nombre_documento));
    if (subs.length > 0) {
        return subs.every((sub) => esElementoCompletadoSubir(sub));
    }
    return esElementoCompletadoSubir(padre);
}

/** Conteo por empresa: ítems individuales de subir documentación (hijos PIPC o padre suelto). */
function contarProgresoDocumentacionSubir(allDocs = []) {
    const normales = allDocs.filter((d) => !d.clave_workflow);
    const padres = normales.filter((d) => !Number(d.documento_padre_id || 0));
    const hijos = normales.filter((d) => Number(d.documento_padre_id || 0) > 0);
    let documentos_totales = 0;
    let documentos_completos = 0;
    for (const padre of padres) {
        const subs = hijos
            .filter((h) => mismoPadreId(h.documento_padre_id, padre.documento_id))
            .filter((h) => !esSubtituloOperativo(h.nombre_documento));
        if (subs.length > 0) {
            documentos_totales += subs.length;
            documentos_completos += subs.filter((sub) => esElementoCompletadoSubir(sub)).length;
        } else {
            documentos_totales += 1;
            if (esElementoCompletadoSubir(padre)) {
                documentos_completos += 1;
            }
        }
    }
    return { documentos_totales, documentos_completos };
}

function evaluarSlotResolutivo(archivo, fechaAprobacion) {
    const hasFile = !!(archivo?.archivo_url || archivo?.nombre_archivo);
    const hasAprobacion = !!fechaAprobacion;
    if (!hasFile && !hasAprobacion) return 'empty';
    if (hasFile && hasAprobacion) return 'complete';
    return 'incomplete';
}

function evaluarReglas(ciclo, allDocs, archivosWorkflow, pipcCobertura = null, fechasWorkflow = {}, recorridoEstado = null) {
    const pasos = parsePasosCompletados(ciclo?.pasos_completados);
    const docsCargados = todosDocumentosAsignacionCargados(allDocs);
    const pipcAsignados = listarPipcAsignadosActivos(allDocs);
    const fechasWf = fechasWorkflow && typeof fechasWorkflow === 'object' ? fechasWorkflow : parseFechasWorkflow(ciclo?.fechas_workflow);

    let oficioOk = false;
    if (pipcAsignados.length > 0) {
        oficioOk = pipcAsignados.every(
            (p) =>
                tieneArchivoWorkflow(archivosWorkflow, p.clave_oficio) &&
                !!fechasWf[p.clave_oficio]
        );
    } else {
        oficioOk = !!archivosWorkflow.ops_oficio_ingreso?.archivo_url && !!ciclo?.fecha_ingreso_tramite;
    }

    let obsCompleto = false;
    let obsVacio = true;
    let obsValidoPorPipc = true;
    if (pipcAsignados.length > 0) {
        const estados = pipcAsignados.map((p) => {
            const a1 = tieneArchivoWorkflow(archivosWorkflow, p.clave_obs_1);
            const a2 = tieneArchivoWorkflow(archivosWorkflow, p.clave_obs_2);
            const fecha = !!fechasWf[p.clave_fecha_obs];
            const vacio = !a1 && !a2 && !fecha;
            const completo = a1 && a2 && fecha;
            const parcial = !vacio && !completo;
            return { a1, a2, fecha, vacio, completo, parcial };
        });
        obsCompleto = estados.every((e) => e.completo);
        obsVacio = estados.every((e) => e.vacio);
        obsValidoPorPipc = estados.every((e) => e.vacio || e.completo);
    } else {
        const obs1 = archivosWorkflow.ops_observacion_1?.archivo_url;
        const obs2 = archivosWorkflow.ops_observacion_2?.archivo_url;
        const obsFecha = !!ciclo?.fecha_oficio_observaciones;
        obsCompleto = !!(obs1 && obs2 && obsFecha);
        obsVacio = !obs1 && !obs2 && !obsFecha;
        obsValidoPorPipc = obsVacio || obsCompleto;
    }

    const resolutivoEstadoPorPipc = {};
    let resolutivoOk = false;
    if (pipcAsignados.length > 0) {
        const allSlotStates = [];
        for (const p of pipcAsignados) {
            const porTipo = {};
            for (const rt of RESOLUTIVO_TIPOS) {
                const clave = claveResolutivoTipoPipc(p.documento_id, rt.tipo);
                const estado = evaluarSlotResolutivo(archivosWorkflow[clave], fechasWf[clave] || null);
                porTipo[rt.tipo] = estado;
                allSlotStates.push(estado);
            }
            resolutivoEstadoPorPipc[p.documento_id] = porTipo;
        }
        resolutivoOk = allSlotStates.includes('complete') && !allSlotStates.includes('incomplete');
    } else {
        const pipcSlot = evaluarSlotResolutivo(
            archivosWorkflow.ops_resolutivo_pipc,
            ciclo?.fecha_aprobacion_pipc
        );
        const factSlot = evaluarSlotResolutivo(
            archivosWorkflow.ops_resolutivo_factibilidad,
            ciclo?.fecha_aprobacion_factibilidad
        );
        const otmsSlot = evaluarSlotResolutivo(
            archivosWorkflow.ops_resolutivo_otms,
            ciclo?.fecha_aprobacion_otms
        );
        const resolutivoSlots = [pipcSlot, factSlot, otmsSlot];
        resolutivoOk = resolutivoSlots.includes('complete') && !resolutivoSlots.includes('incomplete');
        resolutivoEstadoPorPipc.legacy = { pipc: pipcSlot, factibilidad: factSlot, otms: otmsSlot };
    }

    const asignarCompleto = pipcCobertura
        ? Number(pipcCobertura.total_asignadas || 0) > 0
        : pipcAsignados.length > 0 || agruparDocumentosAsignacion(allDocs).length > 0;

    const recorridoOk = pipcAsignados.length > 0 && !!(recorridoEstado?.recorrido_completo);
    // Reporte de recorrido: opcional temporalmente (se puede completar el nodo sin llenar SP-F-02).
    const recorridoCompletable = true;

    const puedeCompletar = {
        asignar: asignarCompleto,
        recorrido: recorridoCompletable,
        documentacion: docsCargados,
        oficio: oficioOk,
        observaciones: obsValidoPorPipc,
        resolutivo: resolutivoOk,
        finalizar: PC_OPS_PASOS_OBLIGATORIOS_FINAL.every((p) => pasos.includes(p))
            && (pasos.includes('observaciones') || obsVacio)
    };

    return {
        pasos_completados: pasos,
        puede_completar: puedeCompletar,
        documentacion_cargada: docsCargados,
        observaciones_opcional_vacio: obsVacio,
        observaciones_omitible: obsVacio,
        recorrido_opcional: true,
        resolutivo_slots: resolutivoEstadoPorPipc,
        pipc_cobertura: pipcCobertura,
        pipc_asignados: pipcAsignados,
        recorrido_estado: recorridoEstado
    };
}

async function evaluarCoberturaPipcAsignacion(poolProteccionCivil, empresaId, allDocs = []) {
    const [catRows] = await poolProteccionCivil.query(
        `SELECT d.documento_id
         FROM pc_catalogo_documento d
         INNER JOIN pc_catalogo_categoria c ON c.categoria_id = d.categoria_id AND c.slug = 'pipc'
         WHERE d.activo = 1 AND TRIM(COALESCE(d.hoja_nombre, '')) <> ''
         ORDER BY d.nombre ASC`
    );
    const catalogoIds = catRows.map((row) => Number(row.documento_id)).filter((id) => id > 0);
    const totalCatalogo = catalogoIds.length;

    const normales = (allDocs || []).filter((doc) => !doc.clave_workflow);
    const hijos = normales.filter((doc) => Number(doc.documento_padre_id || 0) > 0);
    const padresPipc = normales.filter(
        (doc) => !Number(doc.documento_padre_id || 0) && Number(doc.catalogo_documento_id || 0) > 0
    );
    const padresPipcActivos = padresPipc.filter((padre) => {
        const subs = hijos
            .filter((hijo) => mismoPadreId(hijo.documento_padre_id, padre.documento_id))
            .filter((hijo) => !esSubtituloOperativo(hijo.nombre_documento));
        return subs.length > 0;
    });
    const asignadosIds = new Set(
        padresPipcActivos.map((doc) => Number(doc.catalogo_documento_id)).filter((id) => id > 0)
    );

    if (!totalCatalogo) {
        const asignadas = agruparDocumentosAsignacion(allDocs).length;
        return {
            total_catalogo: 0,
            total_asignadas: asignadas,
            todas_asignadas: asignadas > 0,
            faltantes_ids: []
        };
    }

    const faltantesIds = catalogoIds.filter((id) => !asignadosIds.has(id));

    return {
        total_catalogo: totalCatalogo,
        total_asignadas: asignadosIds.size,
        todas_asignadas: faltantesIds.length === 0,
        faltantes_ids: faltantesIds
    };
}

async function syncPasoAsignarSegunCobertura(poolProteccionCivil, empresaId, allDocs = []) {
    const ciclo = await obtenerCicloActivo(poolProteccionCivil, empresaId);
    if (!ciclo) {
        return { pasos_completados: [], pipc_cobertura: null };
    }

    const pipcCobertura = await evaluarCoberturaPipcAsignacion(poolProteccionCivil, empresaId, allDocs);
    let pasos = parsePasosCompletados(ciclo.pasos_completados);
    const teniaAsignar = pasos.includes('asignar');

    const tieneAlMenosUna = Number(pipcCobertura.total_asignadas || 0) > 0;
    if (tieneAlMenosUna && !teniaAsignar) {
        pasos.push('asignar');
    } else if (!tieneAlMenosUna && teniaAsignar) {
        pasos = pasos.filter((paso) => paso !== 'asignar');
    }

    const pasosPrevios = parsePasosCompletados(ciclo.pasos_completados);
    if (JSON.stringify(pasos) !== JSON.stringify(pasosPrevios)) {
        await poolProteccionCivil.query(
            `UPDATE pc_centro_operaciones SET pasos_completados = ?, fecha_actualizacion = NOW() WHERE operacion_id = ?`,
            [JSON.stringify(pasos), ciclo.operacion_id]
        );
    }

    return { pasos_completados: pasos, pipc_cobertura: pipcCobertura };
}

async function ensureCentroOperacionesTable(poolProteccionCivil) {
    await poolProteccionCivil.query(`
        CREATE TABLE IF NOT EXISTS pc_centro_operaciones (
            operacion_id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            pasos_completados JSON NULL,
            fecha_ingreso_tramite DATE NULL,
            fecha_oficio_observaciones DATE NULL,
            fecha_aprobacion DATE NULL,
            fecha_aprobacion_pipc DATE NULL,
            fecha_aprobacion_factibilidad DATE NULL,
            fecha_aprobacion_otms DATE NULL,
            fecha_vencimiento_pipc DATE NULL,
            fecha_vencimiento_factibilidad DATE NULL,
            fecha_vencimiento_otms DATE NULL,
            ciclo_cerrado_at DATETIME NULL,
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_pc_ops_empresa (empresa_id),
            INDEX idx_pc_ops_activo (empresa_id, activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function ensureResponsablePipcColumn(poolProteccionCivil, addColumnIfNotExists) {
    if (!addColumnIfNotExists) return;
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'responsable_pipc_usuario_id',
        'INT NULL AFTER pasos_completados'
    );
}

function nombreCompletoUsuarioRow(row = {}) {
    const partes = [row.nombre, row.apellido, row.apellido_paterno, row.apellido_materno]
        .map((p) => String(p || '').trim())
        .filter(Boolean);
    if (partes.length) return partes.join(' ');
    return String(row.username || row.email || '').trim();
}

async function obtenerNombresUsuariosPorIds(poolBiznaga, usuarioIds = []) {
    const ids = [...new Set((usuarioIds || []).map((id) => Number(id)).filter((id) => id > 0))];
    const mapa = new Map();
    if (!poolBiznaga?.query || !ids.length) {
        return mapa;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await poolBiznaga.query(
        `SELECT id, username, nombre, apellido, email
         FROM usuario
         WHERE id IN (${placeholders}) AND activo = 1`,
        ids
    );

    for (const row of rows) {
        mapa.set(Number(row.id), nombreCompletoUsuarioRow(row));
    }
    return mapa;
}

async function ensureCentroOperacionesFechasColumns(poolProteccionCivil, addColumnIfNotExists) {
    if (!addColumnIfNotExists) return;
    await addColumnIfNotExists(poolProteccionCivil, 'pc_centro_operaciones', 'fecha_aprobacion_pipc', 'DATE NULL AFTER fecha_aprobacion');
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fecha_aprobacion_factibilidad',
        'DATE NULL AFTER fecha_aprobacion_pipc'
    );
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fecha_aprobacion_otms',
        'DATE NULL AFTER fecha_aprobacion_factibilidad'
    );
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fecha_vencimiento_pipc',
        'DATE NULL AFTER fecha_aprobacion_otms'
    );
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fecha_vencimiento_factibilidad',
        'DATE NULL AFTER fecha_vencimiento_pipc'
    );
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fecha_vencimiento_otms',
        'DATE NULL AFTER fecha_vencimiento_factibilidad'
    );
    await addColumnIfNotExists(
        poolProteccionCivil,
        'pc_centro_operaciones',
        'fechas_workflow',
        'JSON NULL AFTER fecha_vencimiento_otms'
    );
}

async function ensureClaveWorkflowColumn(poolProteccionCivil, addColumnIfNotExists) {
    await addColumnIfNotExists(
        poolProteccionCivil,
        'documento_proteccion_civil',
        'clave_workflow',
        'VARCHAR(80) NULL AFTER catalogo_documento_id'
    );
    try {
        await poolProteccionCivil.query(
            'ALTER TABLE documento_proteccion_civil ADD INDEX idx_dpc_clave_workflow (clave_workflow)'
        );
    } catch (e) {
        if (!String(e.message).includes('Duplicate')) {
            console.warn('[PC-OPS] idx clave_workflow:', e.message);
        }
    }
}

async function resolvePool(deps) {
    await deps.poolProteccionCivilReady;
    const pool = deps.getPoolProteccionCivil ? deps.getPoolProteccionCivil() : deps.poolProteccionCivil;
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool de proteccion_civil no disponible');
    }
    return pool;
}

async function obtenerCicloActivo(poolProteccionCivil, empresaId) {
    const [rows] = await poolProteccionCivil.query(
        `SELECT * FROM pc_centro_operaciones
         WHERE empresa_id = ? AND activo = 1 AND ciclo_cerrado_at IS NULL
         ORDER BY operacion_id DESC LIMIT 1`,
        [empresaId]
    );
    return rows[0] || null;
}

async function crearCicloActivo(poolProteccionCivil, empresaId) {
    const [result] = await poolProteccionCivil.query(
        `INSERT INTO pc_centro_operaciones (empresa_id, activo, pasos_completados)
         VALUES (?, 1, '[]')`,
        [empresaId]
    );
    const [rows] = await poolProteccionCivil.query(
        'SELECT * FROM pc_centro_operaciones WHERE operacion_id = ?',
        [result.insertId]
    );
    return rows[0];
}

async function ensureWorkflowDocRow(poolProteccionCivil, empresaId, clave, nombre) {
    const [existentes] = await poolProteccionCivil.query(
        `SELECT documento_id, nombre_documento, estatus, archivo_url, nombre_archivo, fecha_subida, clave_workflow
         FROM documento_proteccion_civil
         WHERE empresa_id = ? AND clave_workflow = ? LIMIT 1`,
        [empresaId, clave]
    );
    if (existentes.length) {
        return existentes[0];
    }
    const [ins] = await poolProteccionCivil.query(
        `INSERT INTO documento_proteccion_civil
            (empresa_id, clave_workflow, nombre_documento, especificacion, obligatorio, estatus, tipo_entrada, fecha_creacion)
         VALUES (?, ?, ?, ?, 0, 'pendiente', 'archivo', NOW())`,
        [empresaId, clave, nombre, 'Documento del centro de operaciones']
    );
    return {
        documento_id: ins.insertId,
        nombre_documento: nombre,
        estatus: 'pendiente',
        archivo_url: null,
        nombre_archivo: null,
        fecha_subida: null,
        clave_workflow: clave
    };
}

async function copiarArchivoWorkflowSiVacio(pool, destino, origen) {
    if (!destino || !origen) return destino;
    if (destino.archivo_url || destino.nombre_archivo) return destino;
    if (!origen.archivo_url && !origen.nombre_archivo) return destino;
    await pool.query(
        `UPDATE documento_proteccion_civil
         SET archivo_url = ?, nombre_archivo = ?, fecha_subida = COALESCE(?, NOW()), estatus = 'aprobado'
         WHERE documento_id = ?`,
        [origen.archivo_url || null, origen.nombre_archivo || null, origen.fecha_subida || null, destino.documento_id]
    );
    return {
        ...destino,
        archivo_url: origen.archivo_url || null,
        nombre_archivo: origen.nombre_archivo || null,
        fecha_subida: origen.fecha_subida || destino.fecha_subida,
        estatus: 'aprobado'
    };
}

/**
 * Crea/asegura documentos de workflow por cada PIPC asignado.
 * Migra archivos legacy y slots antiguos (ops_obs_{id}, ops_resolutivo_{id}) a la nueva estructura.
 */
async function ensureWorkflowDocuments(poolProteccionCivil, empresaId, allDocs = null) {
    let docs = allDocs;
    if (!docs) {
        const [rows] = await poolProteccionCivil.query(
            `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow, tipo_entrada,
                    nombre_documento, archivo_url, nombre_archivo, valor_texto, estatus
             FROM documento_proteccion_civil WHERE empresa_id = ?`,
            [empresaId]
        );
        docs = rows;
    }

    const archivos = {};
    const pipcAsignados = listarPipcAsignadosActivos(docs);

    for (const [clave, nombre] of Object.entries(PC_WORKFLOW_CLAVES_LEGACY)) {
        archivos[clave] = await ensureWorkflowDocRow(poolProteccionCivil, empresaId, clave, nombre);
    }

    for (const pipc of pipcAsignados) {
        archivos[pipc.clave_oficio] = await ensureWorkflowDocRow(
            poolProteccionCivil,
            empresaId,
            pipc.clave_oficio,
            `Oficio de Ingreso — ${pipc.nombre_documento}`
        );
        archivos[pipc.clave_obs_1] = await ensureWorkflowDocRow(
            poolProteccionCivil,
            empresaId,
            pipc.clave_obs_1,
            `Observaciones 1 — ${pipc.nombre_documento}`
        );
        archivos[pipc.clave_obs_2] = await ensureWorkflowDocRow(
            poolProteccionCivil,
            empresaId,
            pipc.clave_obs_2,
            `Observaciones 2 — ${pipc.nombre_documento}`
        );
        for (const rt of RESOLUTIVO_TIPOS) {
            const clave = claveResolutivoTipoPipc(pipc.documento_id, rt.tipo);
            archivos[clave] = await ensureWorkflowDocRow(
                poolProteccionCivil,
                empresaId,
                clave,
                `Resolutivo ${rt.label} — ${pipc.nombre_documento}`
            );
        }
    }

    if (pipcAsignados.length > 0) {
        // Legacy global → primer PIPC
        archivos[pipcAsignados[0].clave_oficio] = await copiarArchivoWorkflowSiVacio(
            poolProteccionCivil,
            archivos[pipcAsignados[0].clave_oficio],
            archivos.ops_oficio_ingreso
        );
        archivos[pipcAsignados[0].clave_obs_1] = await copiarArchivoWorkflowSiVacio(
            poolProteccionCivil,
            archivos[pipcAsignados[0].clave_obs_1],
            archivos.ops_observacion_1
        );
        archivos[pipcAsignados[0].clave_obs_2] = await copiarArchivoWorkflowSiVacio(
            poolProteccionCivil,
            archivos[pipcAsignados[0].clave_obs_2],
            archivos.ops_observacion_2
        );
        archivos[pipcAsignados[0].clave_resolutivo_pipc] = await copiarArchivoWorkflowSiVacio(
            poolProteccionCivil,
            archivos[pipcAsignados[0].clave_resolutivo_pipc],
            archivos.ops_resolutivo_pipc
        );
        if (pipcAsignados[0]) {
            archivos[pipcAsignados[0].clave_resolutivo_factibilidad] = await copiarArchivoWorkflowSiVacio(
                poolProteccionCivil,
                archivos[pipcAsignados[0].clave_resolutivo_factibilidad],
                archivos.ops_resolutivo_factibilidad
            );
            archivos[pipcAsignados[0].clave_resolutivo_otms] = await copiarArchivoWorkflowSiVacio(
                poolProteccionCivil,
                archivos[pipcAsignados[0].clave_resolutivo_otms],
                archivos.ops_resolutivo_otms
            );
        }

        // Migración slots v1 (ops_obs_{id}, ops_resolutivo_{id}) → v2
        for (const pipc of pipcAsignados) {
            const id = pipc.documento_id;
            const obsLegacy = await ensureWorkflowDocRow(
                poolProteccionCivil,
                empresaId,
                `ops_obs_${id}`,
                `Observaciones — ${pipc.nombre_documento}`
            );
            archivos[pipc.clave_obs_1] = await copiarArchivoWorkflowSiVacio(
                poolProteccionCivil,
                archivos[pipc.clave_obs_1],
                obsLegacy
            );
            const resLegacy = await ensureWorkflowDocRow(
                poolProteccionCivil,
                empresaId,
                `ops_resolutivo_${id}`,
                `Resolutivo — ${pipc.nombre_documento}`
            );
            archivos[pipc.clave_resolutivo_pipc] = await copiarArchivoWorkflowSiVacio(
                poolProteccionCivil,
                archivos[pipc.clave_resolutivo_pipc],
                resLegacy
            );
        }
    }

    return archivos;
}

function buildCicloResponse(ciclo, reglas, extras = {}) {
    const fechasWf = parseFechasWorkflow(ciclo.fechas_workflow);
    const responsableId = Number(ciclo.responsable_pipc_usuario_id || 0) || null;
    return {
        operacion_id: ciclo.operacion_id,
        pasos_completados: reglas.pasos_completados,
        responsable_pipc_usuario_id: responsableId,
        responsable_pipc_nombre: extras.responsable_pipc_nombre || null,
        fecha_ingreso_tramite: ciclo.fecha_ingreso_tramite,
        fecha_oficio_observaciones: ciclo.fecha_oficio_observaciones,
        fecha_aprobacion_pipc: ciclo.fecha_aprobacion_pipc || ciclo.fecha_aprobacion || null,
        fecha_aprobacion_factibilidad: ciclo.fecha_aprobacion_factibilidad || null,
        fecha_aprobacion_otms: ciclo.fecha_aprobacion_otms || null,
        fechas_workflow: fechasWf,
        ciclo_cerrado: !!ciclo.ciclo_cerrado_at
    };
}

async function intentarSincronizarResolutivosOps(deps, req, empresaId, poolPC) {
    const { pcResolutivosService, poolBiznagaSgcReady, getPoolBiznagaSgc, getPoolBiznaga, poolReady } = deps;
    if (!pcResolutivosService || !poolBiznagaSgcReady || !getPoolBiznagaSgc) {
        return { sincronizados: 0, registros: [] };
    }
    try {
        if (poolReady) await poolReady;
        await poolBiznagaSgcReady;
        const poolSgc = getPoolBiznagaSgc();
        const poolBiznaga = getPoolBiznaga ? getPoolBiznaga() : null;
        if (!poolSgc?.query || !poolBiznaga?.query || !poolPC?.query) {
            throw new Error('Conexiones a base de datos no disponibles para el control SP-F-29');
        }
        return await pcResolutivosService.sincronizarResolutivosCentroOperaciones({
            poolSgc,
            poolBiznaga,
            poolPC,
            empresaId,
            responsableUsuarioId: req.user?.id || null
        });
    } catch (syncErr) {
        console.warn('[PC-OPS] Sincronización resolutivos SP-F-29:', syncErr.message);
        throw syncErr;
    }
}

function esCampoFechaResolutivoOps(campo) {
    const dinamico = parseCampoFechaWorkflowDinamico(campo);
    if (dinamico && String(dinamico.claveWorkflow).startsWith('ops_resolutivo_')) return true;
    const pcResolutivosService = require('./pcResolutivosService');
    return pcResolutivosService.CAMPOS_FECHA_RESOLUTIVO_OPS.has(campo);
}

async function finalizarRevisionEmpresaPC(poolProteccionCivil, empresaId) {
    const [padres] = await poolProteccionCivil.query(
        `SELECT documento_id, nombre_documento, estatus, archivo_url, clave_workflow
         FROM documento_proteccion_civil
         WHERE empresa_id = ? AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           AND (clave_workflow IS NULL OR clave_workflow = '')`,
        [empresaId]
    );

    let eliminados = 0;
    let conservados = 0;

    for (const padre of padres) {
        const [hijos] = await poolProteccionCivil.query(
            `SELECT documento_id, estatus, archivo_url
             FROM documento_proteccion_civil
             WHERE documento_padre_id = ?`,
            [padre.documento_id]
        );

        if (hijos.length > 0) {
            const hijosAprobados = hijos.filter((h) => h.estatus === 'aprobado');
            const hijosRechazados = hijos.filter((h) => h.estatus === 'rechazado');

            for (const hijo of hijosAprobados) {
                await poolProteccionCivil.query('DELETE FROM documento_proteccion_civil WHERE documento_id = ?', [hijo.documento_id]);
                eliminados++;
            }

            if (hijosRechazados.length === 0) {
                const [restantes] = await poolProteccionCivil.query(
                    'SELECT COUNT(*) as cnt FROM documento_proteccion_civil WHERE documento_padre_id = ?',
                    [padre.documento_id]
                );
                if (restantes[0].cnt === 0) {
                    await poolProteccionCivil.query('DELETE FROM documento_proteccion_civil WHERE documento_id = ?', [padre.documento_id]);
                    eliminados++;
                }
            } else {
                conservados += hijosRechazados.length;
            }
        } else if (padre.estatus === 'aprobado') {
            await poolProteccionCivil.query('DELETE FROM documento_proteccion_civil WHERE documento_id = ?', [padre.documento_id]);
            eliminados++;
        } else if (padre.estatus === 'rechazado') {
            conservados++;
        }
    }

    return { eliminados, conservados };
}

function registerPcCentroOperacionesRoutes(app, deps) {
    const {
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        handleError,
        poolBiznagaSgcReady,
        getPoolBiznagaSgc,
        poolBiznaga,
        pcResolutivosService
    } = deps;

    app.get('/api/proteccion-civil/empresas/:empresaId/centro-operaciones', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            let ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) {
                ciclo = await crearCicloActivo(pool, empresaId);
            }

            const reparacion = await repararPadresPipcHuerfanos(pool, empresaId);
            if (reparacion.eliminados > 0) {
                console.log(`[PC-REPARAR] empresa_id=${empresaId}: ${reparacion.eliminados} plantilla(s) PIPC huérfana(s) eliminada(s)`);
            }

            const [allDocs] = await pool.query(
                `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow, tipo_entrada,
                        nombre_documento, archivo_url, nombre_archivo, valor_texto, estatus
                 FROM documento_proteccion_civil WHERE empresa_id = ?`,
                [empresaId]
            );

            const archivosWorkflow = await ensureWorkflowDocuments(pool, empresaId, allDocs);
            const pipcCobertura = await evaluarCoberturaPipcAsignacion(pool, empresaId, allDocs);
            await syncPasoAsignarSegunCobertura(pool, empresaId, allDocs);
            // Releer ciclo por si sync actualizó pasos
            ciclo = (await obtenerCicloActivo(pool, empresaId)) || ciclo;
            const fechasWf = parseFechasWorkflow(ciclo.fechas_workflow);
            const pcRecorridoService = require('./pcRecorridoService');
            const recorridoEstado = await pcRecorridoService.listarEstadoRecorrido(
                pool,
                empresaId,
                ciclo.operacion_id,
                allDocs,
                poolBiznaga
            );
            const reglas = evaluarReglas(ciclo, allDocs, archivosWorkflow, pipcCobertura, fechasWf, recorridoEstado);
            const responsableId = Number(ciclo.responsable_pipc_usuario_id || 0) || null;
            let responsableNombre = null;
            if (responsableId && poolBiznaga?.query) {
                const nombres = await obtenerNombresUsuariosPorIds(poolBiznaga, [responsableId]);
                responsableNombre = nombres.get(responsableId) || null;
            }

            res.json({
                success: true,
                ciclo: buildCicloResponse(ciclo, reglas, { responsable_pipc_nombre: responsableNombre }),
                archivos_workflow: archivosWorkflow,
                puede_completar: reglas.puede_completar,
                documentacion_cargada: reglas.documentacion_cargada,
                observaciones_omitible: reglas.observaciones_omitible,
                recorrido_opcional: reglas.recorrido_opcional,
                resolutivo_slots: reglas.resolutivo_slots,
                pipc_cobertura: pipcCobertura,
                pipc_asignados: reglas.pipc_asignados,
                recorrido_estado: reglas.recorrido_estado,
                pasos: PC_OPS_PASOS
            });
        } catch (error) {
            handleError(res, error, 'Error al obtener centro de operaciones');
        }
    });

    app.put('/api/proteccion-civil/empresas/:empresaId/centro-operaciones/responsable-pipc', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            const rawUsuarioId = req.body?.usuario_id;
            const usuarioId = rawUsuarioId === null || rawUsuarioId === undefined || rawUsuarioId === ''
                ? null
                : Number(rawUsuarioId);

            if (usuarioId !== null && (!Number.isInteger(usuarioId) || usuarioId <= 0)) {
                return res.status(400).json({ success: false, message: 'Usuario no válido' });
            }

            let ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) {
                ciclo = await crearCicloActivo(pool, empresaId);
            }

            if (usuarioId && poolBiznaga?.query) {
                const [usuarios] = await poolBiznaga.query(
                    'SELECT id FROM usuario WHERE id = ? AND activo = 1 LIMIT 1',
                    [usuarioId]
                );
                if (!usuarios.length) {
                    return res.status(400).json({ success: false, message: 'Usuario no encontrado o inactivo' });
                }
            }

            await pool.query(
                `UPDATE pc_centro_operaciones
                 SET responsable_pipc_usuario_id = ?, fecha_actualizacion = NOW()
                 WHERE operacion_id = ?`,
                [usuarioId, ciclo.operacion_id]
            );

            let responsableNombre = null;
            if (usuarioId && poolBiznaga?.query) {
                const nombres = await obtenerNombresUsuariosPorIds(poolBiznaga, [usuarioId]);
                responsableNombre = nombres.get(usuarioId) || null;
            }

            res.json({
                success: true,
                responsable_pipc_usuario_id: usuarioId,
                responsable_pipc_nombre: responsableNombre
            });
        } catch (error) {
            handleError(res, error, 'Error al guardar responsable de PIPC');
        }
    });

    app.put('/api/proteccion-civil/empresas/:empresaId/centro-operaciones/fechas', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            const { campo, valor } = req.body || {};
            const campoFechaDinamico = parseCampoFechaResolutivoDinamico(campo);
            const columna = CAMPOS_FECHA_CICLO.has(campo) ? campo : null;
            if (!columna && !campoFechaDinamico) {
                return res.status(400).json({ success: false, message: 'Campo de fecha no válido' });
            }

            const fechasObligatorias = new Set(['fecha_ingreso_tramite']);
            const valorNorm = valor ? String(valor).trim() : null;
            if (!valorNorm && columna && fechasObligatorias.has(columna)) {
                return res.status(400).json({ success: false, message: 'La fecha es obligatoria' });
            }

            let ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) ciclo = await crearCicloActivo(pool, empresaId);

            if (campoFechaDinamico) {
                const fechasWf = parseFechasWorkflow(ciclo.fechas_workflow);
                if (valorNorm) {
                    fechasWf[campoFechaDinamico.claveWorkflow] = valorNorm;
                } else {
                    delete fechasWf[campoFechaDinamico.claveWorkflow];
                }
                await pool.query(
                    `UPDATE pc_centro_operaciones SET fechas_workflow = ?, fecha_actualizacion = NOW() WHERE operacion_id = ?`,
                    [JSON.stringify(fechasWf), ciclo.operacion_id]
                );
            } else {
                await pool.query(
                    `UPDATE pc_centro_operaciones SET ${columna} = ?, fecha_actualizacion = NOW() WHERE operacion_id = ?`,
                    [valorNorm, ciclo.operacion_id]
                );
            }

            let resolutivosSincronizados = null;
            if (esCampoFechaResolutivoOps(campo)) {
                try {
                    resolutivosSincronizados = await intentarSincronizarResolutivosOps(deps, req, empresaId, pool);
                } catch (syncErr) {
                    return res.status(500).json({
                        success: false,
                        message: `Fecha guardada, pero no se pudo actualizar el control SP-F-29: ${syncErr.message}`
                    });
                }
            }

            res.json({
                success: true,
                message: 'Fecha guardada',
                resolutivos_sincronizados: resolutivosSincronizados?.sincronizados ?? 0
            });
        } catch (error) {
            handleError(res, error, 'Error al guardar fecha del centro de operaciones');
        }
    });

    app.post(
        '/api/proteccion-civil/empresas/:empresaId/centro-operaciones/sincronizar-resolutivos',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool(deps);
                const empresaId = Number(req.params.empresaId);
                const resultado = await intentarSincronizarResolutivosOps(deps, req, empresaId, pool);
                res.json({
                    success: true,
                    message: resultado.sincronizados > 0
                        ? `${resultado.sincronizados} registro(s) actualizado(s) en el control SP-F-29`
                        : 'No hay resolutivos completos (archivo + fechas) para sincronizar',
                    ...resultado
                });
            } catch (error) {
                handleError(res, error, 'Error al sincronizar resolutivos con SP-F-29');
            }
        }
    );

    app.post('/api/proteccion-civil/empresas/:empresaId/centro-operaciones/completar-paso', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            const paso = String(req.body?.paso || '');
            if (!PC_OPS_PASOS.includes(paso) || paso === 'finalizar') {
                return res.status(400).json({ success: false, message: 'Paso no válido' });
            }

            let ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) ciclo = await crearCicloActivo(pool, empresaId);

            const [allDocs] = await pool.query(
                `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow, tipo_entrada,
                        nombre_documento, archivo_url, nombre_archivo, valor_texto
                 FROM documento_proteccion_civil WHERE empresa_id = ?`,
                [empresaId]
            );
            const archivosWorkflow = await ensureWorkflowDocuments(pool, empresaId, allDocs);
            const pipcCobertura = await evaluarCoberturaPipcAsignacion(pool, empresaId, allDocs);
            const fechasWf = parseFechasWorkflow(ciclo.fechas_workflow);
            const pcRecorridoService = require('./pcRecorridoService');
            const recorridoEstado = await pcRecorridoService.listarEstadoRecorrido(
                pool,
                empresaId,
                ciclo.operacion_id,
                allDocs,
                poolBiznaga
            );
            const reglas = evaluarReglas(ciclo, allDocs, archivosWorkflow, pipcCobertura, fechasWf, recorridoEstado);

            if (!reglas.puede_completar[paso]) {
                return res.status(400).json({
                    success: false,
                    message: 'Aún no se cumplen los requisitos para completar este paso'
                });
            }

            const pasos = parsePasosCompletados(ciclo.pasos_completados);
            if (!pasos.includes(paso)) pasos.push(paso);

            await pool.query(
                `UPDATE pc_centro_operaciones SET pasos_completados = ?, fecha_actualizacion = NOW() WHERE operacion_id = ?`,
                [JSON.stringify(pasos), ciclo.operacion_id]
            );

            let resolutivosSincronizados = null;
            if (paso === 'resolutivo') {
                try {
                    resolutivosSincronizados = await intentarSincronizarResolutivosOps(deps, req, empresaId, pool);
                } catch (syncErr) {
                    console.warn('[PC-OPS] No se pudieron sincronizar resolutivos SP-F-29:', syncErr.message);
                }
            }

            res.json({
                success: true,
                pasos_completados: pasos,
                resolutivos_sincronizados: resolutivosSincronizados?.sincronizados ?? 0
            });
        } catch (error) {
            handleError(res, error, 'Error al completar paso');
        }
    });

    app.post('/api/proteccion-civil/empresas/:empresaId/centro-operaciones/desbloquear-paso', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            const paso = String(req.body?.paso || '');
            if (!PC_OPS_PASOS.includes(paso)) {
                return res.status(400).json({ success: false, message: 'Paso no válido' });
            }

            const ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) {
                return res.json({ success: true, pasos_completados: [] });
            }

            const pasos = parsePasosCompletados(ciclo.pasos_completados).filter((p) => p !== paso);
            await pool.query(
                `UPDATE pc_centro_operaciones SET pasos_completados = ?, fecha_actualizacion = NOW() WHERE operacion_id = ?`,
                [JSON.stringify(pasos), ciclo.operacion_id]
            );

            res.json({ success: true, pasos_completados: pasos });
        } catch (error) {
            handleError(res, error, 'Error al desbloquear paso');
        }
    });

    app.post('/api/proteccion-civil/empresas/:empresaId/centro-operaciones/cerrar-ciclo', requireAdminOrPC, verificarServicioProteccionCivilEmpresa, async (req, res) => {
        try {
            const pool = await resolvePool(deps);
            const empresaId = Number(req.params.empresaId);
            let ciclo = await obtenerCicloActivo(pool, empresaId);
            if (!ciclo) ciclo = await crearCicloActivo(pool, empresaId);

            const [allDocs] = await pool.query(
                `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow, tipo_entrada,
                        nombre_documento, archivo_url, nombre_archivo, valor_texto, fecha_subida
                 FROM documento_proteccion_civil WHERE empresa_id = ?`,
                [empresaId]
            );
            const archivosWorkflow = await ensureWorkflowDocuments(pool, empresaId, allDocs);
            const pipcCobertura = await evaluarCoberturaPipcAsignacion(pool, empresaId, allDocs);
            const fechasWf = parseFechasWorkflow(ciclo.fechas_workflow);
            const reglas = evaluarReglas(ciclo, allDocs, archivosWorkflow, pipcCobertura, fechasWf);

            if (!reglas.puede_completar.finalizar) {
                return res.status(400).json({
                    success: false,
                    message: 'Completa los pasos obligatorios antes de finalizar el ciclo'
                });
            }

            const pcHistorialCicloService = require('./pcHistorialCicloService');
            const historialResumen = await pcHistorialCicloService.snapshotCicloAlCerrar(pool, {
                ciclo,
                empresaId,
                allDocs
            });

            await finalizarRevisionEmpresaPC(pool, empresaId);
            await pcHistorialCicloService.limpiarDocumentosWorkflowTrasCierre(pool, empresaId);

            const pasos = parsePasosCompletados(ciclo.pasos_completados);
            if (!pasos.includes('finalizar')) pasos.push('finalizar');

            await pool.query(
                `UPDATE pc_centro_operaciones
                 SET pasos_completados = ?, ciclo_cerrado_at = NOW(), activo = 0, fecha_actualizacion = NOW()
                 WHERE operacion_id = ?`,
                [JSON.stringify(pasos), ciclo.operacion_id]
            );

            res.json({
                success: true,
                message: 'Ciclo de Protección Civil cerrado. El expediente quedó en Historial PC y ya puedes iniciar una nueva asignación.',
                pasos_completados: pasos,
                historial_resumen: historialResumen
            });
        } catch (error) {
            handleError(res, error, 'Error al cerrar ciclo de operaciones');
        }
    });
}

module.exports = {
    PC_OPS_PASOS,
    PC_WORKFLOW_CLAVES,
    RESOLUTIVO_TIPOS,
    listarPipcAsignadosActivos,
    claveResolutivoTipoPipc,
    parseFechasWorkflow,
    ensureCentroOperacionesTable,
    ensureCentroOperacionesFechasColumns,
    ensureResponsablePipcColumn,
    ensureClaveWorkflowColumn,
    obtenerNombresUsuariosPorIds,
    registerPcCentroOperacionesRoutes,
    finalizarRevisionEmpresaPC,
    parsePasosCompletados,
    agruparDocumentosAsignacion,
    contarProgresoDocumentacionSubir,
    evaluarCoberturaPipcAsignacion,
    syncPasoAsignarSegunCobertura,
    obtenerCicloActivo
};
