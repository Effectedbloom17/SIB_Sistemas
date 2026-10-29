/**
 * Pop-ups de resolutivos PIPC (Protección Civil).
 *
 * Preventivo 40–21 días restantes → 1 aviso diario al responsable.
 * Urgente 20–1 días (pronto a vencer; NO vencidos) → al ingresar + ~3.5 h,
 * destinatarios: responsable, marisol12, leonel58 y root.
 * Fuera de esas ventanas (incl. vencidos) no se generan ni se muestran avisos.
 */

const pcResolutivosService = require('./pcResolutivosService');

const SUPERVISORES_URGENTES = ['marisol12', 'leonel58', 'root'];
const MINUTOS_SEGUIMIENTO = 210; // 3.5 horas (entre 3 y 4)
/** Tras logout/login debe poder generar de nuevo; 15 min evita spam en F5. */
const HORAS_NUEVA_SESION = 0.25;
const RUTA_ATENCION = '/proteccion-civil';

function fechaHoraMexico(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(fecha);
    const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value || '00';
    const hora = valor('hour') === '24' ? '00' : valor('hour');
    return `${valor('year')}-${valor('month')}-${valor('day')} ${hora}:${valor('minute')}:${valor('second')}`;
}

function fechaMexico(fecha = new Date()) {
    return fechaHoraMexico(fecha).slice(0, 10);
}

function sumarMinutosMexico(minutos, desde = new Date()) {
    return fechaHoraMexico(new Date(desde.getTime() + Number(minutos) * 60 * 1000));
}

function textoPlano(valor, max = 255) {
    const texto = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
    if (!texto) return '';
    return texto.length <= max ? texto : `${texto.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function normalizarUsername(valor) {
    return String(valor || '').trim().toLowerCase();
}

/** Días restantes en UI = dias_hasta_contacto + 40 */
function diasRestantesDeRegistro(row) {
    const diasHasta = pcResolutivosService.calcularDiasHastaContacto(row?.fecha_contacto_empresa);
    if (diasHasta == null || Number.isNaN(Number(diasHasta))) return null;
    return Number(diasHasta) + 40;
}

/**
 * diasRestantes = dias_hasta_contacto + 40 (días hasta “Vencido”).
 * Avisos SOLO en rango 1–40 (nunca >40 ni vencidos <=0):
 *  - Preventivo/diario: 40–21
 *  - Urgente al ingresar: 20–1
 */
function enVentanaPreventiva(dias) {
    const n = Number(dias);
    return Number.isFinite(n) && n > 20 && n <= 40;
}

/** Urgente al ingresar: últimos 20 días antes de vencer (20–1). */
function enVentanaUrgente(dias) {
    const n = Number(dias);
    return Number.isFinite(n) && n > 0 && n <= 20;
}

/** Rango permitido de avisos: 1–40 días. */
function enVentanaNotificacion(dias) {
    return enVentanaPreventiva(dias) || enVentanaUrgente(dias);
}

async function asegurarTablas(poolPC) {
    await poolPC.query(`
        CREATE TABLE IF NOT EXISTS pc_resolutivo_aviso_sesion (
            sesion_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            username VARCHAR(80) NOT NULL,
            ingreso_en DATETIME NOT NULL,
            seguimiento_en DATETIME NOT NULL,
            PRIMARY KEY (sesion_id),
            INDEX idx_pc_aviso_sesion_user (username, ingreso_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await poolPC.query(`
        CREATE TABLE IF NOT EXISTS pc_resolutivo_aviso (
            aviso_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            resolutivo_id INT UNSIGNED NOT NULL,
            sesion_id INT UNSIGNED NULL,
            username VARCHAR(80) NOT NULL,
            tipo VARCHAR(32) NOT NULL,
            mensaje VARCHAR(500) NOT NULL DEFAULT '',
            empresa_id INT UNSIGNED NULL,
            nombre_empresa VARCHAR(255) NOT NULL DEFAULT '',
            nombre_asignacion VARCHAR(255) NOT NULL DEFAULT '',
            responsable_nombre VARCHAR(255) NOT NULL DEFAULT '',
            dias_restantes INT NULL,
            ruta VARCHAR(255) NOT NULL DEFAULT '/proteccion-civil',
            descartado TINYINT(1) NOT NULL DEFAULT 0,
            silenciado TINYINT(1) NOT NULL DEFAULT 0,
            mostrar_despues DATETIME NULL,
            creado_en DATETIME NOT NULL,
            PRIMARY KEY (aviso_id),
            INDEX idx_pc_aviso_user (username, descartado, mostrar_despues),
            INDEX idx_pc_aviso_resolutivo (resolutivo_id, username, tipo),
            INDEX idx_pc_aviso_sesion (sesion_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [cols] = await poolPC.query(
        `SHOW COLUMNS FROM pc_resolutivo_aviso LIKE 'silenciado'`
    );
    if (!cols?.length) {
        await poolPC.query(
            `ALTER TABLE pc_resolutivo_aviso
             ADD COLUMN silenciado TINYINT(1) NOT NULL DEFAULT 0 AFTER descartado`
        );
    }
}

async function mapUsernamesPorId(poolUsuarios, ids) {
    const mapa = new Map();
    const unicos = [...new Set((ids || []).map((id) => Number(id)).filter((id) => id > 0))];
    if (!poolUsuarios?.query || !unicos.length) return mapa;
    const placeholders = unicos.map(() => '?').join(', ');
    const [rows] = await poolUsuarios.query(
        `SELECT id, username FROM usuario WHERE id IN (${placeholders}) AND activo = 1`,
        unicos
    );
    for (const row of rows || []) {
        const username = normalizarUsername(row.username);
        if (username) mapa.set(Number(row.id), username);
    }
    return mapa;
}

async function destinosSupervisores(poolUsuarios) {
    if (!poolUsuarios?.query) return [...SUPERVISORES_URGENTES];
    try {
        const [users] = await poolUsuarios.query(
            `SELECT u.username
             FROM usuario u
             LEFT JOIN roles r ON u.rol_id = r.rol_id
             WHERE u.activo = 1
               AND (
                    LOWER(u.username) IN ('marisol12', 'leonel58', 'root')
                    OR LOWER(COALESCE(r.nombre_rol, '')) = 'root'
               )`
        );
        return [...new Set(
            (users || [])
                .map((row) => normalizarUsername(row.username))
                .filter(Boolean)
        )];
    } catch (_err) {
        return [...SUPERVISORES_URGENTES];
    }
}

async function listarResolutivosElegibles(poolPC, poolUsuarios) {
    const registros = await pcResolutivosService.obtenerDatosControlResolutivos(
        poolPC,
        poolPC,
        poolUsuarios
    );
    const usernames = await mapUsernamesPorId(
        poolUsuarios,
        registros.map((r) => r.responsable_usuario_id)
    );
    return (registros || []).map((row) => {
        const diasRestantes = diasRestantesDeRegistro(row);
        const responsableUsername = usernames.get(Number(row.responsable_usuario_id || 0)) || '';
        return {
            resolutivoId: Number(row.resolutivo_id),
            empresaId: Number(row.empresa_id_biznaga || 0) || null,
            nombreEmpresa: textoPlano(row.nombre_empresa, 255),
            nombreAsignacion: textoPlano(row.nombre_asignacion || row.tipo_tramite || 'PIPC', 255),
            responsableNombre: textoPlano(row.responsable, 255),
            responsableUsername,
            estatus: String(row.estatus || ''),
            diasRestantes
        };
    }).filter((item) =>
        item.resolutivoId > 0
        && item.diasRestantes != null
        // Solo "Próximo a vencer" dentro de 40–21 / 20–1 (excluye vencidos).
        && item.estatus === 'Próximo a vencer'
        && enVentanaNotificacion(item.diasRestantes)
    );
}

function mensajeVentanaDiaria(item) {
    const dias = Number(item.diasRestantes);
    const unidad = dias === 1 ? 'día' : 'días';
    return `Quedan ${dias} ${unidad} para el vencimiento de ${item.nombreAsignacion || 'PIPC'} · ${item.nombreEmpresa || 'empresa'}.`;
}

function mensajeUrgente(item, seguimiento = false) {
    const dias = Number(item.diasRestantes);
    const empresa = item.nombreEmpresa || 'empresa';
    const asignacion = item.nombreAsignacion || 'PIPC';
    const unidad = dias === 1 ? 'día' : 'días';
    const base = `Faltan ${dias} ${unidad} para el vencimiento de ${asignacion} · ${empresa}.`;
    return seguimiento ? `${base} Recordatorio de seguimiento.` : base;
}

async function insertarAviso(poolPC, aviso) {
    await poolPC.query(
        `INSERT INTO pc_resolutivo_aviso
            (resolutivo_id, sesion_id, username, tipo, mensaje, empresa_id, nombre_empresa,
             nombre_asignacion, responsable_nombre, dias_restantes, ruta, descartado, mostrar_despues, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
            aviso.resolutivoId,
            aviso.sesionId ?? null,
            normalizarUsername(aviso.username),
            aviso.tipo,
            textoPlano(aviso.mensaje, 500),
            aviso.empresaId ?? null,
            textoPlano(aviso.nombreEmpresa, 255),
            textoPlano(aviso.nombreAsignacion, 255),
            textoPlano(aviso.responsableNombre, 255),
            aviso.diasRestantes == null ? null : Number(aviso.diasRestantes),
            aviso.ruta || RUTA_ATENCION,
            aviso.mostrarDespues || null,
            aviso.creadoEn || fechaHoraMexico()
        ]
    );
}

async function yaExisteAvisoHoy(poolPC, resolutivoId, username, tipo, ahora) {
    const dia = String(ahora || fechaHoraMexico()).slice(0, 10);
    const [rows] = await poolPC.query(
        `SELECT aviso_id
         FROM pc_resolutivo_aviso
         WHERE resolutivo_id = ?
           AND LOWER(username) = ?
           AND tipo = ?
           AND descartado = 0
           AND DATE(creado_en) = ?
         LIMIT 1`,
        [resolutivoId, normalizarUsername(username), tipo, dia]
    );
    return !!(rows && rows.length);
}

async function yaExisteAvisoSesion(poolPC, sesionId, resolutivoId, username, tipo) {
    if (!sesionId) return false;
    const [rows] = await poolPC.query(
        `SELECT aviso_id
         FROM pc_resolutivo_aviso
         WHERE sesion_id = ?
           AND resolutivo_id = ?
           AND LOWER(username) = ?
           AND tipo = ?
           AND descartado = 0
         LIMIT 1`,
        [sesionId, resolutivoId, normalizarUsername(username), tipo]
    );
    return !!(rows && rows.length);
}

async function tieneAvisoActivo(poolPC, resolutivoId, username, tipo) {
    const [rows] = await poolPC.query(
        `SELECT aviso_id
         FROM pc_resolutivo_aviso
         WHERE resolutivo_id = ?
           AND LOWER(username) = ?
           AND tipo = ?
           AND descartado = 0
         LIMIT 1`,
        [resolutivoId, normalizarUsername(username), tipo]
    );
    return !!(rows && rows.length);
}

async function reactivarSilenciados(poolPC, username) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { reactivados: 0 };
    const [result] = await poolPC.query(
        `UPDATE pc_resolutivo_aviso
         SET silenciado = 0
         WHERE LOWER(username) = ?
           AND descartado = 0
           AND silenciado = 1`,
        [user]
    );
    return { reactivados: Number(result?.affectedRows || 0) };
}

/**
 * Asegura avisos activos para el usuario (idempotente).
 * Cubre preventivo + urgente; no depende del cooldown de sesión.
 */
async function asegurarAvisosActivosUsuario(poolPC, poolUsuarios, username, opciones = {}) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { creados: 0 };
    const forzarPopup = !!opciones.forzarPopup;

    if (forzarPopup) {
        await reactivarSilenciados(poolPC, user);
    }

    const ahora = fechaHoraMexico();
    const seguimientoEn = sumarMinutosMexico(MINUTOS_SEGUIMIENTO);
    const supervisores = await destinosSupervisores(poolUsuarios);
    const items = await listarResolutivosElegibles(poolPC, poolUsuarios);
    let creados = 0;

    for (const item of items) {
        const dias = Number(item.diasRestantes);

        if (enVentanaUrgente(dias) && usuarioDebeRecibirUrgente(user, item, supervisores)) {
            if (!(await tieneAvisoActivo(poolPC, item.resolutivoId, user, 'urgente_ingreso'))) {
                await insertarAviso(poolPC, {
                    resolutivoId: item.resolutivoId,
                    sesionId: null,
                    username: user,
                    tipo: 'urgente_ingreso',
                    mensaje: mensajeUrgente(item, false),
                    empresaId: item.empresaId,
                    nombreEmpresa: item.nombreEmpresa,
                    nombreAsignacion: item.nombreAsignacion,
                    responsableNombre: item.responsableNombre,
                    diasRestantes: dias,
                    creadoEn: ahora,
                    mostrarDespues: null
                });
                creados += 1;
            }
            if (!(await tieneAvisoActivo(poolPC, item.resolutivoId, user, 'urgente_seguimiento'))) {
                await insertarAviso(poolPC, {
                    resolutivoId: item.resolutivoId,
                    sesionId: null,
                    username: user,
                    tipo: 'urgente_seguimiento',
                    mensaje: mensajeUrgente(item, true),
                    empresaId: item.empresaId,
                    nombreEmpresa: item.nombreEmpresa,
                    nombreAsignacion: item.nombreAsignacion,
                    responsableNombre: item.responsableNombre,
                    diasRestantes: dias,
                    creadoEn: ahora,
                    mostrarDespues: seguimientoEn
                });
                creados += 1;
            }
        }

        // Preventivo: responsable ve diario; supervisores también en ingreso al sistema.
        if (enVentanaPreventiva(dias) && (
            item.responsableUsername === user || usuarioDebeRecibirUrgente(user, item, supervisores)
        )) {
            if (!(await tieneAvisoActivo(poolPC, item.resolutivoId, user, 'ventana_diaria'))) {
                await insertarAviso(poolPC, {
                    resolutivoId: item.resolutivoId,
                    sesionId: null,
                    username: user,
                    tipo: 'ventana_diaria',
                    mensaje: mensajeVentanaDiaria(item),
                    empresaId: item.empresaId,
                    nombreEmpresa: item.nombreEmpresa,
                    nombreAsignacion: item.nombreAsignacion,
                    responsableNombre: item.responsableNombre,
                    diasRestantes: dias,
                    creadoEn: ahora
                });
                creados += 1;
            }
        }
    }

    return { creados };
}

/**
 * Reenvía avisos vigentes: reactiva silenciados, reinicia contador de sesión
 * y crea faltantes (aunque se hubieran descartado sin atender).
 */
async function reenviarAvisosPendientes(poolPC, poolUsuarios, username) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { reenviados: 0, reactivados: 0 };

    const { reactivados } = await reactivarSilenciados(poolPC, user);

    // Reinicia contador de sesión para que el ingreso vuelva a contar como “nuevo”.
    const ahora = fechaHoraMexico();
    const seguimientoEn = sumarMinutosMexico(MINUTOS_SEGUIMIENTO);
    const [sesionResult] = await poolPC.query(
        `INSERT INTO pc_resolutivo_aviso_sesion (username, ingreso_en, seguimiento_en)
         VALUES (?, ?, ?)`,
        [user, ahora, seguimientoEn]
    );
    const sesionId = Number(sesionResult.insertId);

    const { creados } = await asegurarAvisosActivosUsuario(poolPC, poolUsuarios, user, {
        forzarPopup: true
    });

    return { reenviados: creados, reactivados, sesionId };
}

/**
 * Ventana 40–20: un aviso diario al responsable.
 */
async function procesarVentanaDiaria(poolPC, poolUsuarios) {
    await asegurarTablas(poolPC);
    const ahora = fechaHoraMexico();
    const items = await listarResolutivosElegibles(poolPC, poolUsuarios);
    let enviados = 0;
    for (const item of items) {
        const dias = Number(item.diasRestantes);
        if (!enVentanaPreventiva(dias)) continue;
        const username = item.responsableUsername;
        if (!username) continue;
        if (await yaExisteAvisoHoy(poolPC, item.resolutivoId, username, 'ventana_diaria', ahora)) continue;
        await insertarAviso(poolPC, {
            resolutivoId: item.resolutivoId,
            username,
            tipo: 'ventana_diaria',
            mensaje: mensajeVentanaDiaria(item),
            empresaId: item.empresaId,
            nombreEmpresa: item.nombreEmpresa,
            nombreAsignacion: item.nombreAsignacion,
            responsableNombre: item.responsableNombre,
            diasRestantes: dias,
            creadoEn: ahora
        });
        enviados += 1;
    }
    return { enviados };
}

async function obtenerOCrearSesion(poolPC, username) {
    const user = normalizarUsername(username);
    if (!user) return null;
    const ahora = fechaHoraMexico();
    const [previas] = await poolPC.query(
        `SELECT sesion_id, ingreso_en, seguimiento_en,
                TIMESTAMPDIFF(MINUTE, ingreso_en, ?) AS minutos
         FROM pc_resolutivo_aviso_sesion
         WHERE LOWER(username) = ?
         ORDER BY sesion_id DESC
         LIMIT 1`,
        [ahora, user]
    );
    const previa = previas?.[0];
    const minutos = previa ? Number(previa.minutos) : null;
    if (previa && minutos != null && minutos < HORAS_NUEVA_SESION * 60) {
        return {
            sesionId: Number(previa.sesion_id),
            esNueva: false,
            ingresoEn: String(previa.ingreso_en),
            seguimientoEn: String(previa.seguimiento_en)
        };
    }
    const seguimientoEn = sumarMinutosMexico(MINUTOS_SEGUIMIENTO);
    const [result] = await poolPC.query(
        `INSERT INTO pc_resolutivo_aviso_sesion (username, ingreso_en, seguimiento_en)
         VALUES (?, ?, ?)`,
        [user, ahora, seguimientoEn]
    );
    return {
        sesionId: Number(result.insertId),
        esNueva: true,
        ingresoEn: ahora,
        seguimientoEn
    };
}

function usuarioDebeRecibirUrgente(username, item, supervisores) {
    const user = normalizarUsername(username);
    if (!user) return false;
    if (supervisores.includes(user)) return true;
    return !!item.responsableUsername && item.responsableUsername === user;
}

/**
 * <20 días: al ingresar genera aviso inmediato + seguimiento a ~3.5 h.
 */
async function generarAvisosUrgentesDeSesion(poolPC, poolUsuarios, username) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { sesion: null, generados: 0 };

    const sesion = await obtenerOCrearSesion(poolPC, user);
    if (!sesion?.esNueva) return { sesion, generados: 0 };

    const supervisores = await destinosSupervisores(poolUsuarios);
    const items = await listarResolutivosElegibles(poolPC, poolUsuarios);
    const urgentes = items.filter((item) => enVentanaUrgente(item.diasRestantes));
    let generados = 0;
    const ahora = fechaHoraMexico();

    for (const item of urgentes) {
        if (!usuarioDebeRecibirUrgente(user, item, supervisores)) continue;

        if (!(await yaExisteAvisoSesion(poolPC, sesion.sesionId, item.resolutivoId, user, 'urgente_ingreso'))) {
            await insertarAviso(poolPC, {
                resolutivoId: item.resolutivoId,
                sesionId: sesion.sesionId,
                username: user,
                tipo: 'urgente_ingreso',
                mensaje: mensajeUrgente(item, false),
                empresaId: item.empresaId,
                nombreEmpresa: item.nombreEmpresa,
                nombreAsignacion: item.nombreAsignacion,
                responsableNombre: item.responsableNombre,
                diasRestantes: item.diasRestantes,
                creadoEn: ahora,
                mostrarDespues: null
            });
            generados += 1;
        }

        if (!(await yaExisteAvisoSesion(poolPC, sesion.sesionId, item.resolutivoId, user, 'urgente_seguimiento'))) {
            await insertarAviso(poolPC, {
                resolutivoId: item.resolutivoId,
                sesionId: sesion.sesionId,
                username: user,
                tipo: 'urgente_seguimiento',
                mensaje: mensajeUrgente(item, true),
                empresaId: item.empresaId,
                nombreEmpresa: item.nombreEmpresa,
                nombreAsignacion: item.nombreAsignacion,
                responsableNombre: item.responsableNombre,
                diasRestantes: item.diasRestantes,
                creadoEn: ahora,
                mostrarDespues: sesion.seguimientoEn
            });
            generados += 1;
        }
    }

    return { sesion, generados };
}

/**
 * Al consultar avisos, también asegura el diario 40–20 del usuario actual
 * (sin esperar al job de 15 min).
 */
async function asegurarVentanaDiariaUsuario(poolPC, poolUsuarios, username) {
    const user = normalizarUsername(username);
    if (!user) return;
    const ahora = fechaHoraMexico();
    const items = await listarResolutivosElegibles(poolPC, poolUsuarios);
    for (const item of items) {
        const dias = Number(item.diasRestantes);
        if (!enVentanaPreventiva(dias)) continue;
        if (item.responsableUsername !== user) continue;
        if (await yaExisteAvisoHoy(poolPC, item.resolutivoId, user, 'ventana_diaria', ahora)) continue;
        await insertarAviso(poolPC, {
            resolutivoId: item.resolutivoId,
            username: user,
            tipo: 'ventana_diaria',
            mensaje: mensajeVentanaDiaria(item),
            empresaId: item.empresaId,
            nombreEmpresa: item.nombreEmpresa,
            nombreAsignacion: item.nombreAsignacion,
            responsableNombre: item.responsableNombre,
            diasRestantes: dias,
            creadoEn: ahora
        });
    }
}

async function listarAvisos(poolPC, poolUsuarios, username, opciones = {}) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return [];
    const incluirSilenciados = !!opciones.incluirSilenciados;
    const forzarReenvio = !!opciones.reenviar;

    if (forzarReenvio) {
        try {
            await reenviarAvisosPendientes(poolPC, poolUsuarios, user);
        } catch (error) {
            console.warn('[PC-AVISO] No se pudieron reenviar avisos pendientes:', error.message);
        }
    }

    let sesionNueva = false;
    try {
        const resultado = await generarAvisosUrgentesDeSesion(poolPC, poolUsuarios, user);
        sesionNueva = !!resultado?.sesion?.esNueva;
    } catch (error) {
        console.warn('[PC-AVISO] No se pudieron generar urgentes de sesión:', error.message);
    }

    // Al entrar (sesión nueva): reabrir silenciados y completar faltantes de la ventana ampliada.
    // No recrear en cada poll lo que el usuario descartó a propósito (X / Aceptar todas).
    if (sesionNueva && !forzarReenvio) {
        try {
            await reactivarSilenciados(poolPC, user);
            await asegurarAvisosActivosUsuario(poolPC, poolUsuarios, user, { forzarPopup: true });
        } catch (error) {
            console.warn('[PC-AVISO] No se pudieron asegurar avisos de sesión nueva:', error.message);
        }
    }

    const ahora = fechaHoraMexico();
    const [rows] = await poolPC.query(
        `SELECT aviso_id, resolutivo_id, tipo, mensaje, empresa_id, nombre_empresa,
                nombre_asignacion, responsable_nombre, dias_restantes, ruta, silenciado,
                DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
                DATE_FORMAT(mostrar_despues, '%Y-%m-%d %H:%i:%s') AS mostrar_despues
         FROM pc_resolutivo_aviso
         WHERE LOWER(username) = ?
           AND descartado = 0
           ${incluirSilenciados ? '' : 'AND silenciado = 0'}
           AND (mostrar_despues IS NULL OR mostrar_despues <= ?)
         ORDER BY CASE tipo
                    WHEN 'urgente_ingreso' THEN 0
                    WHEN 'urgente_seguimiento' THEN 1
                    ELSE 2
                  END,
                  CASE WHEN dias_restantes IS NULL THEN 9999 ELSE dias_restantes END ASC,
                  aviso_id DESC
         LIMIT 40`,
        [user, ahora]
    );

    // Revalida contra el estatus actual: no mostrar avisos de PIPC ya vencidos.
    let vigentesIds = null;
    let diasPorResolutivo = new Map();
    try {
        const elegibles = await listarResolutivosElegibles(poolPC, poolUsuarios);
        vigentesIds = new Set(elegibles.map((item) => item.resolutivoId));
        diasPorResolutivo = new Map(
            elegibles.map((item) => [item.resolutivoId, item.diasRestantes])
        );
    } catch (error) {
        console.warn('[PC-AVISO] No se pudo revalidar estatus de avisos:', error.message);
    }

    const avisos = [];
    const staleIds = [];
    for (const row of rows || []) {
        const resolutivoId = Number(row.resolutivo_id);
        const diasActuales = diasPorResolutivo.has(resolutivoId)
            ? Number(diasPorResolutivo.get(resolutivoId))
            : (row.dias_restantes == null ? null : Number(row.dias_restantes));

        // Fuera de ventana (vencidos <=0, >40, o resolutivo inexistente): no mostrar y auto-descartar.
        const fueraDeVentana = vigentesIds
            ? (!vigentesIds.has(resolutivoId) || !enVentanaNotificacion(diasActuales))
            : (diasActuales != null && !enVentanaNotificacion(diasActuales));
        if (fueraDeVentana) {
            staleIds.push(Number(row.aviso_id));
            continue;
        }

        avisos.push({
            id: Number(row.aviso_id),
            resolutivoId,
            tipo: String(row.tipo || 'ventana_diaria'),
            mensaje: row.mensaje == null ? '' : String(row.mensaje),
            empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
            nombreEmpresa: row.nombre_empresa == null ? '' : String(row.nombre_empresa),
            nombreAsignacion: row.nombre_asignacion == null ? '' : String(row.nombre_asignacion),
            responsableNombre: row.responsable_nombre == null ? '' : String(row.responsable_nombre),
            diasRestantes: diasActuales,
            ruta: row.ruta || RUTA_ATENCION,
            creadoEn: row.creado_en ? String(row.creado_en) : '',
            mostrarDespues: row.mostrar_despues ? String(row.mostrar_despues) : null,
            silenciado: Number(row.silenciado) === 1
        });
    }

    if (staleIds.length) {
        try {
            const placeholders = staleIds.map(() => '?').join(', ');
            await poolPC.query(
                `UPDATE pc_resolutivo_aviso
                 SET descartado = 1
                 WHERE aviso_id IN (${placeholders})
                   AND LOWER(username) = ?`,
                [...staleIds, user]
            );
        } catch (error) {
            console.warn('[PC-AVISO] No se pudieron descartar avisos vencidos:', error.message);
        }
    }

    return avisos;
}

async function silenciarAviso(poolPC, avisoId, username) {
    await asegurarTablas(poolPC);
    const id = Number(avisoId);
    const user = normalizarUsername(username);
    if (!Number.isInteger(id) || id <= 0 || !user) return false;
    await poolPC.query(
        `UPDATE pc_resolutivo_aviso
         SET silenciado = 1
         WHERE aviso_id = ? AND LOWER(username) = ? AND descartado = 0`,
        [id, user]
    );
    return true;
}

/** Cierra los popups sin descartar: siguen en el gestor hasta que se atiendan. */
async function silenciarTodosAvisos(poolPC, username) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { silenciados: 0 };
    const [result] = await poolPC.query(
        `UPDATE pc_resolutivo_aviso
         SET silenciado = 1
         WHERE LOWER(username) = ?
           AND descartado = 0
           AND silenciado = 0`,
        [user]
    );
    return { silenciados: Number(result?.affectedRows || 0) };
}

async function descartarAviso(poolPC, avisoId, username) {
    await asegurarTablas(poolPC);
    const id = Number(avisoId);
    const user = normalizarUsername(username);
    if (!Number.isInteger(id) || id <= 0 || !user) return false;
    await poolPC.query(
        `UPDATE pc_resolutivo_aviso
         SET descartado = 1
         WHERE aviso_id = ? AND LOWER(username) = ?`,
        [id, user]
    );
    return true;
}

/** Descarta todos los avisos abiertos del usuario (visibles y seguimientos pendientes). */
async function descartarTodosAvisos(poolPC, username) {
    await asegurarTablas(poolPC);
    const user = normalizarUsername(username);
    if (!user) return { descartados: 0 };
    const [result] = await poolPC.query(
        `UPDATE pc_resolutivo_aviso
         SET descartado = 1
         WHERE LOWER(username) = ?
           AND descartado = 0`,
        [user]
    );
    return { descartados: Number(result?.affectedRows || 0) };
}

module.exports = {
    asegurarTablas,
    listarAvisos,
    silenciarAviso,
    silenciarTodosAvisos,
    reactivarSilenciados,
    reenviarAvisosPendientes,
    asegurarAvisosActivosUsuario,
    descartarAviso,
    descartarTodosAvisos,
    procesarVentanaDiaria,
    generarAvisosUrgentesDeSesion,
    MINUTOS_SEGUIMIENTO,
    SUPERVISORES_URGENTES
};
