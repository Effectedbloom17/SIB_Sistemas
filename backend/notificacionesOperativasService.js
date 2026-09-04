/**
 * Notificaciones operativas calculadas en vivo (no persistidas).
 * Desaparecen solas cuando se resuelve la condición de negocio.
 */

const SPF03_SUBQUERY = `
    SELECT DISTINCT programado_id
    FROM documento_curso_programado
    WHERE descripcion = 'entrega_documentos_spf03_firmado'
       OR descripcion LIKE 'entrega_documentos_spf03%'
       OR tipo_documento = 'entrega_documentos'
       OR LOWER(nombre_archivo) LIKE '%sp-f-03%'
       OR LOWER(nombre_archivo) LIKE '%spf03%'
       OR LOWER(nombre_archivo) LIKE '%entrega%documentos%'
       OR LOWER(descripcion) LIKE '%sp-f-03%'
       OR LOWER(descripcion) LIKE '%spf03%'
`;

function rolesDeUsuario(user = {}) {
    if (Array.isArray(user.roles) && user.roles.length) {
        return user.roles.map((r) => String(r).toLowerCase());
    }
    return user.rol ? [String(user.rol).toLowerCase()] : [];
}

function tieneRol(roles, ...buscar) {
    return buscar.some((r) => roles.includes(String(r).toLowerCase()));
}

function fmtFecha(valor) {
    if (!valor) return '';
    const dt = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(dt.getTime())) return String(valor);
    return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function diasHasta(fechaIso) {
    if (!fechaIso) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(`${String(fechaIso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(f.getTime())) return null;
    return Math.round((f.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

function clasificarPrioridadAmbiental(diasRestantes) {
    if (diasRestantes == null) return 'sin_prioridad';
    if (diasRestantes < 0) return 'vencido';
    if (diasRestantes <= 5) return 'critico';
    if (diasRestantes <= 10) return 'urgente';
    return 'otro';
}

function notifBase(partial) {
    return {
        notif_id: partial.notif_id,
        tipo: partial.tipo || 'info',
        icono: partial.icono || 'fa-bell',
        titulo: partial.titulo,
        mensaje: partial.mensaje || '',
        ruta: partial.ruta || null,
        auto: true,
        categoria: partial.categoria || 'general',
        prioridad: partial.prioridad || 50
    };
}

async function notifsInstructor(pool, user) {
    const instructorId = Number(user.instructor_id || 0);
    if (!instructorId) return [];

    const [rows] = await pool.query(
        `SELECT cp.programado_id, cp.curso_id, cp.estatus,
                DATE_FORMAT(cp.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
                DATE_FORMAT(cp.fecha_fin, '%Y-%m-%d') AS fecha_fin,
                DATEDIFF(cp.fecha_inicio, CURDATE()) AS dias_para_inicio,
                DATEDIFF(CURDATE(), cp.fecha_fin) AS dias_desde_fin,
                c.nombre_curso, e.nombre_empresa
         FROM curso_programado cp
         JOIN curso c ON cp.curso_id = c.curso_id
         JOIN empresa e ON cp.empresa_id = e.empresa_id
         WHERE cp.instructor_id = ?
           AND cp.estatus NOT IN ('cancelado')
         ORDER BY cp.fecha_inicio ASC`,
        [instructorId]
    );

    const out = [];
    const idsAlerta = new Set();

    for (const row of rows) {
        const diasFin = Number(row.dias_desde_fin);
        const estatus = String(row.estatus || '').toLowerCase();
        const noFinalizado = !['completado', 'finalizado', 'cerrado', 'terminado'].includes(estatus);
        if (noFinalizado && row.fecha_fin && Number.isFinite(diasFin) && diasFin > 4) {
            idsAlerta.add(row.programado_id);
            out.push(notifBase({
                notif_id: `cap-alerta-${row.programado_id}`,
                tipo: 'danger',
                icono: 'fa-exclamation-triangle',
                titulo: `Capacitación sin gestionar: ${row.nombre_curso}`,
                mensaje: `${row.nombre_empresa} · Finalizó hace ${diasFin} días (${fmtFecha(row.fecha_fin)}). Pendiente de cierre.`,
                ruta: `/informacion-general/${row.curso_id}?programado_id=${row.programado_id}&origen=notificaciones`,
                categoria: 'capacitacion',
                prioridad: 10
            }));
        }
    }

    for (const row of rows) {
        const dias = Number(row.dias_para_inicio);
        const estatus = String(row.estatus || '').toLowerCase();
        if (idsAlerta.has(row.programado_id)) continue;
        if (!['programado', 'en_curso'].includes(estatus)) continue;
        if (!Number.isFinite(dias) || dias < 0 || dias > 3) continue;
        const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;
        out.push(notifBase({
            notif_id: `cap-proximo-${row.programado_id}`,
            tipo: 'warning',
            icono: 'fa-calendar-day',
            titulo: `Curso por iniciar: ${row.nombre_curso}`,
            mensaje: `${row.nombre_empresa} · ${cuando} (${fmtFecha(row.fecha_inicio)})`,
            ruta: `/informacion-general/${row.curso_id}?programado_id=${row.programado_id}&origen=notificaciones`,
            categoria: 'capacitacion',
            prioridad: 20
        }));
    }

    return out;
}

async function notifsControlDocumental(pool) {
    const [rows] = await pool.query(
        `SELECT e.empresa_id, e.nombre_empresa,
                COUNT(*) AS total_faltantes
         FROM curso_programado cp
         JOIN empresa e ON cp.empresa_id = e.empresa_id
         LEFT JOIN (${SPF03_SUBQUERY}) spf ON spf.programado_id = cp.programado_id
         WHERE cp.estatus NOT IN ('cancelado', 'pospuesto')
           AND spf.programado_id IS NULL
           AND (
                LOWER(COALESCE(cp.estatus, '')) IN ('completado', 'finalizado', 'cerrado', 'terminado')
                OR (cp.fecha_fin IS NOT NULL AND cp.fecha_fin < CURDATE())
           )
         GROUP BY e.empresa_id, e.nombre_empresa
         HAVING total_faltantes > 0
         ORDER BY total_faltantes DESC, e.nombre_empresa ASC
         LIMIT 40`
    );

    return rows.map((row) => {
        const n = Number(row.total_faltantes) || 0;
        const empresaId = Number(row.empresa_id);
        const ruta = `/historial-cursos?empresa_id=${empresaId}&filtro_anexo=sin_anexo`;
        return notifBase({
            notif_id: `doc-spf03-${empresaId}`,
            tipo: 'warning',
            icono: 'fa-file-excel',
            titulo: `SP-F-03 faltante: ${row.nombre_empresa}`,
            mensaje: `${n} capacitación${n === 1 ? '' : 'es'} sin Entrega de Documentos (SP-F-03).`,
            ruta,
            categoria: 'control_documental',
            prioridad: 15
        });
    });
}

async function notifsProteccionCivil(poolSgc, poolPC, poolBiznaga, user, pcResolutivosService) {
    if (!poolSgc || !pcResolutivosService) return [];

    const userId = Number(user.id || user.usuario_id || 0);
    const nombreUsuario = [user.nombre, user.apellido].filter(Boolean).join(' ').trim().toLowerCase();

    let registros = [];
    try {
        registros = await pcResolutivosService.obtenerDatosControlResolutivos(poolSgc, poolPC, poolBiznaga);
    } catch (e) {
        console.error('[NOTIF] Error listando resolutivos PC:', e.message);
        return [];
    }

    const propios = registros.filter((r) => {
        const uid = Number(r.responsable_usuario_id || 0);
        if (userId && uid === userId) return true;
        const resp = String(r.responsable || '').trim().toLowerCase();
        return !!(nombreUsuario && resp && (resp === nombreUsuario || resp.includes(nombreUsuario) || nombreUsuario.includes(resp)));
    });

    const out = [];
    for (const row of propios) {
        const estatus = String(row.estatus || '').trim();
        const empresaId = Number(row.empresa_id_biznaga || 0);
        if (!empresaId) continue;

        const ruta = `/proteccion-civil?vista=menuDocumentos&empresaId=${empresaId}&paso=documentacion`;
        const asignacion = row.nombre_asignacion || row.tipo_tramite || 'PIPC';
        const empresa = row.nombre_empresa || `Empresa #${empresaId}`;
        const key = row.resolutivo_id || `${empresaId}-${asignacion}`;

        if (estatus === 'Vencido') {
            out.push(notifBase({
                notif_id: `pc-vencido-${key}`,
                tipo: 'danger',
                icono: 'fa-shield-alt',
                titulo: `PIPC vencido: ${empresa}`,
                mensaje: `${asignacion} · Estatus operativo: Vencido. Requiere gestión.`,
                ruta,
                categoria: 'pc',
                prioridad: 10
            }));
        } else if (estatus === 'Próximo a vencer') {
            out.push(notifBase({
                notif_id: `pc-proximo-${key}`,
                tipo: 'warning',
                icono: 'fa-hourglass-half',
                titulo: `PIPC próximo a vencer: ${empresa}`,
                mensaje: `${asignacion} · Revisar y actualizar documentación.`,
                ruta,
                categoria: 'pc',
                prioridad: 20
            }));
        } else if (estatus === 'En tramite') {
            out.push(notifBase({
                notif_id: `pc-tramite-${key}`,
                tipo: 'warning',
                icono: 'fa-folder-open',
                titulo: `PIPC en trámite: ${empresa}`,
                mensaje: `${asignacion} · Documentación pendiente de completar.`,
                ruta,
                categoria: 'pc',
                prioridad: 35
            }));
        }
    }

    return out;
}

async function notifsAmbiental(poolSgc, ambientalService) {
    if (!poolSgc || !ambientalService) return [];

    let tramites = [];
    try {
        tramites = await ambientalService.listarTramites(poolSgc, { estatus: 'abierto' });
    } catch (e) {
        console.error('[NOTIF] Error listando trámites ambiental:', e.message);
        return [];
    }

    const out = [];
    for (const t of tramites) {
        const dias = diasHasta(t.fecha_vencimiento);
        const prioridad = clasificarPrioridadAmbiental(dias);
        if (!['critico', 'urgente', 'vencido'].includes(prioridad)) continue;

        const empresa = t.empresa_nombre || (t.empresa_id ? `Empresa #${t.empresa_id}` : 'Sin empresa');
        const empresaQ = encodeURIComponent(empresa);
        const ruta = `/ambiental?empresa=${empresaQ}&tramite_id=${t.tramite_id || ''}`;
        const oficio = t.oficio || `Ítem ${t.item || ''}`.trim();

        if (prioridad === 'vencido') {
            out.push(notifBase({
                notif_id: `amb-vencido-${t.tramite_id}`,
                tipo: 'danger',
                icono: 'fa-tree',
                titulo: `Trámite vencido: ${empresa}`,
                mensaje: `${oficio} · Venció el ${fmtFecha(t.fecha_vencimiento)}`,
                ruta,
                categoria: 'ambiental',
                prioridad: 10
            }));
        } else if (prioridad === 'critico') {
            out.push(notifBase({
                notif_id: `amb-critico-${t.tramite_id}`,
                tipo: 'danger',
                icono: 'fa-bolt',
                titulo: `Prioridad crítica: ${empresa}`,
                mensaje: `${oficio} · Vence ${fmtFecha(t.fecha_vencimiento)} (${dias} día${dias === 1 ? '' : 's'})`,
                ruta,
                categoria: 'ambiental',
                prioridad: 12
            }));
        } else {
            out.push(notifBase({
                notif_id: `amb-urgente-${t.tramite_id}`,
                tipo: 'warning',
                icono: 'fa-exclamation-circle',
                titulo: `Prioridad urgente: ${empresa}`,
                mensaje: `${oficio} · Vence ${fmtFecha(t.fecha_vencimiento)} (${dias} días)`,
                ruta,
                categoria: 'ambiental',
                prioridad: 18
            }));
        }
    }

    return out;
}

/**
 * Genera notificaciones operativas según roles del usuario autenticado.
 */
async function generarNotificacionesOperativas({
    pool,
    poolSgc,
    poolPC,
    user,
    pcResolutivosService,
    ambientalService
}) {
    const roles = rolesDeUsuario(user);
    const tareas = [];

    if (tieneRol(roles, 'instructor') || Number(user.instructor_id || 0) > 0) {
        tareas.push(notifsInstructor(pool, user));
    }

    if (tieneRol(roles, 'control_documental')) {
        tareas.push(notifsControlDocumental(pool));
    }

    if (tieneRol(roles, 'proteccion_civil')) {
        tareas.push(notifsProteccionCivil(poolSgc, poolPC, pool, user, pcResolutivosService));
    }

    if (tieneRol(roles, 'ambiental')) {
        tareas.push(notifsAmbiental(poolSgc, ambientalService));
    }

    const grupos = await Promise.all(tareas);
    const flat = grupos.flat().filter(Boolean);
    flat.sort((a, b) => (a.prioridad - b.prioridad) || String(a.titulo).localeCompare(String(b.titulo)));
    return flat;
}

module.exports = {
    generarNotificacionesOperativas,
    rolesDeUsuario,
    tieneRol
};
