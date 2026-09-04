/**
 * Búsqueda global del sistema (navbar).
 * Devuelve resultados tipados según el rol del usuario.
 */
const ambientalService = require('./ambientalService');
const sgcDocumentacionExtraService = require('./sgcDocumentacionExtraService');

const LIMITE_POR_FUENTE = 5;
const LIMITE_TOTAL = 20;

function normalizar(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function rolesDeUsuario(roles) {
    return (Array.isArray(roles) ? roles : [])
        .map((r) => String(r || '').toLowerCase().trim())
        .filter(Boolean);
}

function tieneRol(roles, ...permitidos) {
    const set = new Set(rolesDeUsuario(roles));
    if (set.has('root')) return true;
    return permitidos.some((r) => set.has(String(r).toLowerCase()));
}

function esEmpresa(roles) {
    const set = new Set(rolesDeUsuario(roles));
    return set.has('empresa') && !set.has('root') && !set.has('administrador');
}

function resultado({ id, tipo, titulo, descripcion, icono, ruta, meta }) {
    return {
        id,
        tipo,
        titulo,
        descripcion,
        icono: icono || 'fa-search',
        ruta,
        meta: meta || null
    };
}

async function buscarConstanciasDc3(pool, q) {
    const like = `%${q.slice(0, 100)}%`;
    const [rows] = await pool.query(
        `SELECT
            ic.inscripcion_id,
            ic.programado_id,
            ic.folio_constancia,
            ic.folio_dc3,
            CONCAT_WS(' ',
                NULLIF(TRIM(e.apellido_paterno), ''),
                NULLIF(TRIM(e.apellido_materno), ''),
                NULLIF(TRIM(e.nombre), '')
            ) AS empleado_nombre,
            c.nombre_curso,
            emp.nombre_empresa
        FROM inscripcion_curso ic
        JOIN empleado e ON e.empleado_id = ic.empleado_id
        JOIN curso_programado cp ON cp.programado_id = ic.programado_id
        JOIN curso c ON c.curso_id = cp.curso_id
        JOIN empresa emp ON emp.empresa_id = cp.empresa_id
        WHERE ic.activo = 1
          AND (
            ic.folio_constancia LIKE ?
            OR ic.folio_dc3 LIKE ?
          )
        ORDER BY cp.fecha_inicio DESC
        LIMIT ?`,
        [like, like, LIMITE_POR_FUENTE]
    );

    return (rows || []).map((r) => {
        const folio = r.folio_constancia || r.folio_dc3 || '';
        const etiqueta = r.folio_constancia && r.folio_dc3
            ? `Constancia ${r.folio_constancia} · DC-3 ${r.folio_dc3}`
            : (r.folio_constancia ? `Constancia ${r.folio_constancia}` : `DC-3 ${r.folio_dc3}`);
        return resultado({
            id: `constancia-${r.inscripcion_id}`,
            tipo: 'documento',
            titulo: etiqueta,
            descripcion: `${r.empleado_nombre || 'Participante'} · ${r.nombre_curso || 'Curso'} · ${r.nombre_empresa || ''}`,
            icono: 'fa-certificate',
            ruta: `/historial-constancias-dc3?q=${encodeURIComponent(folio)}`,
            meta: { fuente: 'constancias_dc3', folio }
        });
    });
}

async function buscarSenalizacion(poolSgc, q) {
    const like = `%${q.slice(0, 100)}%`;
    const [rows] = await poolSgc.query(
        `SELECT id, folio, empresa_nombre, nombre_proyecto
         FROM innovacion_cotizacion_proyecto
         WHERE COALESCE(activo, 1) = 1
           AND (
                folio LIKE ?
                OR empresa_nombre LIKE ?
                OR nombre_proyecto LIKE ?
           )
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [like, like, like, LIMITE_POR_FUENTE]
    );

    return (rows || []).map((r) => resultado({
        id: `senalizacion-${r.id}`,
        tipo: 'documento',
        titulo: `Señalización folio ${r.folio || r.id}`,
        descripcion: `${r.nombre_proyecto || 'Proyecto'} · ${r.empresa_nombre || ''}`,
        icono: 'fa-drafting-compass',
        ruta: `/diseno-innovacion?folio=${encodeURIComponent(r.folio || '')}`,
        meta: { fuente: 'senalizacion', folio: r.folio, id: r.id }
    }));
}

async function buscarRepositorio(poolSgc, q) {
    const nq = normalizar(q);
    if (!nq) return [];

    const { documentos } = await sgcDocumentacionExtraService.listarDocumentos(poolSgc);
    return (documentos || [])
        .map((doc) => {
            const titulo = String(doc.titulo || doc.nombreArchivo || '').trim();
            const carpeta = String(doc.carpetaRelativa || '').trim();
            const haystack = normalizar(`${titulo} ${doc.nombreArchivo || ''} ${carpeta}`);
            if (!haystack.includes(nq)) return null;
            return resultado({
                id: `repositorio-${doc.id}`,
                tipo: 'documento',
                titulo: titulo || 'Documento del repositorio',
                descripcion: carpeta ? `Repositorio · ${carpeta}` : 'Repositorio de documentación',
                icono: 'fa-folder-open',
                ruta: `/diseno-innovacion/repositorio?doc=${encodeURIComponent(doc.id)}`,
                meta: { fuente: 'repositorio', id: doc.id }
            });
        })
        .filter(Boolean)
        .slice(0, LIMITE_POR_FUENTE);
}

async function buscarTramitesAmbientales(poolSgc, q) {
    const tramites = await ambientalService.listarTramites(poolSgc, { busqueda: q });
    return (tramites || []).slice(0, LIMITE_POR_FUENTE).map((t) => resultado({
        id: `tramite-${t.tramite_id}`,
        tipo: 'funcion',
        titulo: `Trámite #${t.item || t.tramite_id}${t.oficio ? ` · ${t.oficio}` : ''}`,
        descripcion: `${t.empresa_nombre || 'Empresa'} · ${t.accion_realizar || t.estatus || 'Trámite ambiental'}`,
        icono: 'fa-clipboard-list',
        ruta: `/control-tramites?tramiteId=${encodeURIComponent(t.tramite_id)}`,
        meta: { fuente: 'tramites', id: t.tramite_id }
    }));
}

async function buscarDocumentosPc(poolPc, poolBiznaga, q) {
    const like = `%${q.slice(0, 100)}%`;
    let rows;
    try {
        const [result] = await poolPc.query(
            `SELECT documento_id, empresa_id, nombre_documento, estatus
             FROM documento_proteccion_civil
             WHERE nombre_documento LIKE ?
               AND (documento_padre_id IS NULL OR documento_padre_id = 0)
             ORDER BY documento_id DESC
             LIMIT ?`,
            [like, LIMITE_POR_FUENTE]
        );
        rows = result;
    } catch (err) {
        // Compatibilidad si la columna documento_padre_id no existe
        const [result] = await poolPc.query(
            `SELECT documento_id, empresa_id, nombre_documento, estatus
             FROM documento_proteccion_civil
             WHERE nombre_documento LIKE ?
             ORDER BY documento_id DESC
             LIMIT ?`,
            [like, LIMITE_POR_FUENTE]
        );
        rows = result;
    }

    if (!rows || !rows.length) return [];

    const empresaIds = [...new Set(rows.map((r) => Number(r.empresa_id)).filter((id) => id > 0))];
    const nombres = new Map();
    if (empresaIds.length) {
        const [emps] = await poolBiznaga.query(
            `SELECT empresa_id, nombre_empresa FROM empresa WHERE empresa_id IN (?)`,
            [empresaIds]
        );
        for (const e of emps || []) {
            nombres.set(Number(e.empresa_id), e.nombre_empresa);
        }
    }

    return rows.map((r) => {
        const empresa = nombres.get(Number(r.empresa_id)) || `Empresa #${r.empresa_id}`;
        return resultado({
            id: `pc-doc-${r.documento_id}`,
            tipo: 'documento',
            titulo: r.nombre_documento || 'Documento PC',
            descripcion: `${empresa}${r.estatus ? ` · ${r.estatus}` : ''}`,
            icono: 'fa-shield-alt',
            ruta: `/proteccion-civil?vista=menuDocumentos&empresaId=${encodeURIComponent(r.empresa_id || '')}&paso=documentacion&documentoId=${encodeURIComponent(r.documento_id)}`,
            meta: { fuente: 'pc', id: r.documento_id, empresa_id: r.empresa_id }
        });
    });
}

async function buscarControlProyectos(poolSgc, q) {
    const like = `%${q.slice(0, 100)}%`;
    const [rows] = await poolSgc.query(
        `SELECT control_proyecto_id, folio, nombre_proyecto, empresa_nombre, estatus, empresa_id
         FROM sgc_control_proyectos
         WHERE activo = 1
           AND (
             folio LIKE ?
             OR nombre_proyecto LIKE ?
             OR empresa_nombre LIKE ?
             OR item LIKE ?
           )
         ORDER BY updated_at DESC, control_proyecto_id DESC
         LIMIT 40`,
        [like, like, like, like]
    );

    const vistos = new Set();
    const unicos = [];
    for (const r of rows || []) {
        const key = `${r.empresa_id || 0}|${r.folio || ''}|${r.nombre_proyecto || ''}`;
        if (vistos.has(key)) continue;
        vistos.add(key);
        unicos.push(r);
        if (unicos.length >= LIMITE_POR_FUENTE) break;
    }

    return unicos.map((r) => resultado({
        id: `proyecto-${r.control_proyecto_id}`,
        tipo: 'funcion',
        titulo: r.folio ? `Proyecto ${r.folio}` : (r.nombre_proyecto || 'Proyecto'),
        descripcion: `${r.nombre_proyecto || ''}${r.empresa_nombre ? ` · ${r.empresa_nombre}` : ''}${r.estatus ? ` · ${r.estatus}` : ''}`.trim(),
        icono: 'fa-project-diagram',
        ruta: `/control-proyectos?q=${encodeURIComponent(r.folio || r.nombre_proyecto || q)}`,
        meta: { fuente: 'proyectos', folio: r.folio }
    }));
}

async function buscarControlOficios(poolSgc, q) {
    const oficios = await ambientalService.listarOficios(poolSgc, { busqueda: q });
    return (oficios || []).slice(0, LIMITE_POR_FUENTE).map((o) => resultado({
        id: `oficio-${o.oficio_id}`,
        tipo: 'documento',
        titulo: `Oficio #${o.numero_oficio}`,
        descripcion: `${o.empresa || 'Empresa'}${o.motivo ? ` · ${o.motivo}` : ''}`,
        icono: 'fa-folder-open',
        ruta: `/control-oficios?busqueda=${encodeURIComponent(q)}`,
        meta: { fuente: 'oficios', id: o.oficio_id, numero: o.numero_oficio }
    }));
}

/**
 * @param {object} deps
 * @param {import('mysql2/promise').Pool} deps.pool
 * @param {import('mysql2/promise').Pool} deps.poolSgc
 * @param {import('mysql2/promise').Pool} deps.poolPc
 * @param {string} deps.query
 * @param {string[]} deps.roles
 */
async function buscarGlobal({ pool, poolSgc, poolPc, query, roles }) {
    const q = String(query || '').trim().slice(0, 100);
    if (q.length < 2) {
        return { success: true, query: q, resultados: [] };
    }

    const userRoles = rolesDeUsuario(roles);
    const tareas = [];

    if (tieneRol(userRoles, 'administrador', 'control_documental')) {
        tareas.push(
            buscarConstanciasDc3(pool, q).catch((err) => {
                console.warn('[busqueda-global] constancias:', err.message);
                return [];
            })
        );
    }

    if (tieneRol(userRoles, 'administrador', 'innovacion')) {
        tareas.push(
            buscarSenalizacion(poolSgc, q).catch((err) => {
                console.warn('[busqueda-global] señalización:', err.message);
                return [];
            })
        );
    }

    if (tieneRol(userRoles, 'administrador', 'innovacion', 'sgc')) {
        tareas.push(
            buscarRepositorio(poolSgc, q).catch((err) => {
                console.warn('[busqueda-global] repositorio:', err.message);
                return [];
            })
        );
    }

    if (tieneRol(userRoles, 'administrador', 'ambiental')) {
        tareas.push(
            buscarTramitesAmbientales(poolSgc, q).catch((err) => {
                console.warn('[busqueda-global] trámites:', err.message);
                return [];
            })
        );
    }

    if (tieneRol(userRoles, 'administrador', 'proteccion_civil')) {
        tareas.push(
            buscarDocumentosPc(poolPc, pool, q).catch((err) => {
                console.warn('[busqueda-global] PC:', err.message);
                return [];
            })
        );
    }

    if (!esEmpresa(userRoles)) {
        tareas.push(
            buscarControlProyectos(poolSgc, q).catch((err) => {
                console.warn('[busqueda-global] proyectos:', err.message);
                return [];
            }),
            buscarControlOficios(poolSgc, q).catch((err) => {
                console.warn('[busqueda-global] oficios:', err.message);
                return [];
            })
        );
    }

    const lotes = await Promise.all(tareas);
    const resultados = lotes.flat().slice(0, LIMITE_TOTAL);

    return { success: true, query: q, resultados };
}

module.exports = {
    buscarGlobal,
    // expuesto para pruebas / reuso
    buscarConstanciasDc3,
    buscarSenalizacion,
    buscarRepositorio,
    buscarTramitesAmbientales,
    buscarDocumentosPc,
    buscarControlProyectos,
    buscarControlOficios
};
