/**
 * Control de cambios por proyecto (formato tipo SGC-F-24, capítulo 8).
 * Una fila = un cambio del proyecto, agrupado por empresa + folio/nombre.
 */
function normalizar(texto = '') {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function empresaIdValor(valor) {
    if (valor == null || valor === '' || valor === 'sin-empresa') return null;
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function claveProyecto(empresaId, folio, nombreProyecto) {
    const token = normalizar(folio) || normalizar(nombreProyecto);
    if (!token) return '';
    const empresa = empresaIdValor(empresaId);
    return `${empresa || 'sin-empresa'}|${token}`.slice(0, 700);
}

function textoPlano(valor, max = 20000) {
    return String(valor == null ? '' : valor).replace(/\r\n/g, '\n').slice(0, max);
}

function fechaIso(valor) {
    const crudo = String(valor == null ? '' : valor).trim();
    if (!crudo) return null;
    const match = crudo.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function bandera(valor) {
    return valor === true || valor === 1 || valor === '1' || valor === 'true' ? 1 : 0;
}

function errorEstado(mensaje, statusCode) {
    const err = new Error(mensaje);
    err.statusCode = statusCode;
    return err;
}

async function asegurarTabla(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos_cambios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NULL,
            folio VARCHAR(255) NOT NULL DEFAULT '',
            nombre_proyecto VARCHAR(500) NOT NULL DEFAULT '',
            clave_proyecto VARCHAR(700) NOT NULL,
            tipo_requisitos TINYINT(1) NOT NULL DEFAULT 0,
            tipo_diseno TINYINT(1) NOT NULL DEFAULT 0,
            tipo_produccion TINYINT(1) NOT NULL DEFAULT 0,
            descripcion TEXT NULL,
            motivo TEXT NULL,
            acciones TEXT NULL,
            responsable VARCHAR(255) NOT NULL DEFAULT '',
            responsable_usuario_id INT NULL,
            fecha_compromiso DATE NULL,
            acciones_filas TEXT NULL,
            orden INT NOT NULL DEFAULT 0,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            creado_por VARCHAR(255) NULL,
            modificado_por VARCHAR(255) NULL,
            creado_en DATETIME NULL,
            modificado_en DATETIME NULL,
            INDEX idx_cp_cambios_clave (clave_proyecto, activo),
            INDEX idx_cp_cambios_empresa (empresa_id)
        )
    `);
    const [columnas] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios LIKE 'acciones_filas'`
    );
    if (!columnas || !columnas.length) {
        await pool.query(
            `ALTER TABLE sgc_control_proyectos_cambios ADD COLUMN acciones_filas TEXT NULL`
        );
    }
    const [columnaSolicito] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios LIKE 'creado_por'`
    );
    if (!columnaSolicito || !columnaSolicito.length) {
        await pool.query(
            `ALTER TABLE sgc_control_proyectos_cambios ADD COLUMN creado_por VARCHAR(255) NULL`
        );
    }
    await pool.query(
        `UPDATE sgc_control_proyectos_cambios
         SET creado_por = modificado_por
         WHERE (creado_por IS NULL OR TRIM(creado_por) = '')
           AND modificado_por IS NOT NULL
           AND TRIM(modificado_por) <> ''`
    );
    await asegurarColumna(pool, 'estatus', "estatus VARCHAR(20) NOT NULL DEFAULT 'borrador'");
    await asegurarColumna(pool, 'solicitado_en', 'solicitado_en DATETIME NULL');
    await asegurarColumna(pool, 'editado_en', 'editado_en DATETIME NULL');
    await asegurarColumna(pool, 'resuelto_por', 'resuelto_por VARCHAR(255) NULL');
    await asegurarColumna(pool, 'resuelto_en', 'resuelto_en DATETIME NULL');
    await asegurarColumna(pool, 'solicitado_usuario_id', 'solicitado_usuario_id INT NULL');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos_cambios_avisos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            cambio_id INT NOT NULL,
            username VARCHAR(80) NOT NULL,
            mensaje TEXT NOT NULL,
            empresa_id INT NULL,
            folio VARCHAR(255) NOT NULL DEFAULT '',
            nombre_proyecto VARCHAR(500) NOT NULL DEFAULT '',
            solicitado_por VARCHAR(255) NOT NULL DEFAULT '',
            descartado TINYINT(1) NOT NULL DEFAULT 0,
            creado_en DATETIME NULL,
            INDEX idx_cp_cambios_aviso_user (username, descartado),
            INDEX idx_cp_cambios_aviso_cambio (cambio_id)
        )
    `);
    const [tipo] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios_avisos LIKE 'tipo'`
    );
    if (!tipo || !tipo.length) {
        await pool.query(
            `ALTER TABLE sgc_control_proyectos_cambios_avisos
             ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'revision'`
        );
    }
}

async function asegurarColumna(pool, nombre, definicion) {
    const [columnas] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios LIKE ?`,
        [nombre]
    );
    if (!columnas || !columnas.length) {
        await pool.query(`ALTER TABLE sgc_control_proyectos_cambios ADD COLUMN ${definicion}`);
    }
}

const APROBADORES_CAMBIO = ['marisol12', 'leonel58', 'root'];

function usuarioPuedeResolver(user = {}) {
    const username = String(user.username || '').toLowerCase().trim();
    const roles = Array.isArray(user.roles)
        ? user.roles.map((rol) => String(rol || '').toLowerCase())
        : [];
    if (user.rol) roles.push(String(user.rol).toLowerCase());
    return roles.includes('root') || APROBADORES_CAMBIO.includes(username);
}

function estatusCambio(valor) {
    const estatus = String(valor || '').trim();
    if (estatus === 'en_espera' || estatus === 'aprobado' || estatus === 'no_aprobado') return estatus;
    return 'borrador';
}

function recortarTexto(valor, max) {
    const texto = String(valor || '').replace(/\s+/g, ' ').trim();
    if (texto.length <= max) return texto;
    return `${texto.slice(0, max - 1).trim()}…`;
}

function accionTieneDatos(accion) {
    return !!(
        accion.descripcion
        || accion.responsable
        || accion.responsableUsuarioId
        || accion.fechaCompromiso
    );
}

function normalizarAccion(raw) {
    const fecha = fechaIso(raw?.fechaCompromiso);
    if (raw?.fechaCompromiso && !fecha) {
        throw errorEstado('La fecha de compromiso debe usar el formato de fecha.', 400);
    }
    const responsableId = Number(raw?.responsableUsuarioId);
    return {
        descripcion: textoPlano(raw?.descripcion),
        responsable: textoPlano(raw?.responsable, 255).trim(),
        responsableUsuarioId: Number.isInteger(responsableId) && responsableId > 0 ? responsableId : null,
        fechaCompromiso: fecha || ''
    };
}

function leerAccionesGuardadas(row) {
    let lista = [];
    if (row.acciones_filas) {
        try {
            const parsed = typeof row.acciones_filas === 'string'
                ? JSON.parse(row.acciones_filas)
                : row.acciones_filas;
            if (Array.isArray(parsed)) lista = parsed;
        } catch (error) {
            lista = [];
        }
    }
    const filas = lista
        .map((item) => normalizarAccion(item))
        .filter(accionTieneDatos);
    if (filas.length) return filas;
    const legacy = normalizarAccion({
        descripcion: row.acciones,
        responsable: row.responsable,
        responsableUsuarioId: row.responsable_usuario_id,
        fechaCompromiso: row.fecha_compromiso
    });
    return accionTieneDatos(legacy) ? [legacy] : [];
}

function mapearFila(row) {
    return {
        id: Number(row.id),
        tipoRequisitos: Number(row.tipo_requisitos) === 1,
        tipoDiseno: Number(row.tipo_diseno) === 1,
        tipoProduccion: Number(row.tipo_produccion) === 1,
        descripcion: row.descripcion == null ? '' : String(row.descripcion),
        motivo: row.motivo == null ? '' : String(row.motivo),
        creadoEn: row.creado_en ? String(row.creado_en).slice(0, 10) : '',
        creadoPor: row.creado_por == null ? '' : String(row.creado_por),
        solicitadoUsuarioId: Number(row.solicitado_usuario_id) > 0 ? Number(row.solicitado_usuario_id) : null,
        estatus: estatusCambio(row.estatus),
        solicitadoEn: row.solicitado_en ? String(row.solicitado_en) : '',
        editadoEn: row.editado_en ? String(row.editado_en) : '',
        resueltoPor: row.resuelto_por == null ? '' : String(row.resuelto_por),
        resueltoEn: row.resuelto_en ? String(row.resuelto_en) : '',
        accionesFilas: leerAccionesGuardadas(row)
    };
}

function validarSolicitudCompleta(raw, acciones) {
    const tieneTipo = bandera(raw?.tipoRequisitos) === 1
        || bandera(raw?.tipoDiseno) === 1
        || bandera(raw?.tipoProduccion) === 1;
    if (!tieneTipo || !textoPlano(raw?.descripcion).trim() || !textoPlano(raw?.motivo).trim()) {
        throw errorEstado('Completa el tipo, la descripción y el motivo del cambio antes de enviarlo.', 400);
    }
    if (!acciones.length) {
        throw errorEstado('Agrega al menos una acción con responsable y fecha de compromiso.', 400);
    }
    const incompleta = acciones.some((accion) => (
        !String(accion.descripcion || '').trim()
        || !String(accion.responsable || '').trim()
        || !accion.fechaCompromiso
    ));
    if (incompleta) {
        throw errorEstado('Cada acción necesita descripción, responsable y fecha de compromiso.', 400);
    }
}

function filaTieneDatos(fila) {
    return !!(
        fila.tipoRequisitos
        || fila.tipoDiseno
        || fila.tipoProduccion
        || fila.descripcion
        || fila.motivo
        || (Array.isArray(fila.accionesFilas) && fila.accionesFilas.some(accionTieneDatos))
    );
}

function normalizarFilas(lista) {
    if (!Array.isArray(lista)) return [];
    if (lista.length > 200) {
        throw errorEstado('El control de cambios admite hasta 200 filas por proyecto.', 400);
    }
    const filas = [];
    for (const raw of lista) {
        const origenAcciones = Array.isArray(raw?.accionesFilas) ? raw.accionesFilas : [];
        if (origenAcciones.length > 40) {
            throw errorEstado('Cada cambio admite hasta 40 acciones.', 400);
        }
        const accionesNormalizadas = origenAcciones.map((item) => normalizarAccion(item));
        if (raw?.solicitar === true || raw?.corregir === true) {
            validarSolicitudCompleta(raw, accionesNormalizadas);
        }
        const accionesFilas = accionesNormalizadas.filter(accionTieneDatos);
        const primera = accionesFilas[0] || {
            descripcion: '',
            responsable: '',
            responsableUsuarioId: null,
            fechaCompromiso: ''
        };
        const fila = {
            id: Number.isInteger(Number(raw?.id)) && Number(raw.id) > 0 ? Number(raw.id) : null,
            tipoRequisitos: bandera(raw?.tipoRequisitos) === 1,
            tipoDiseno: bandera(raw?.tipoDiseno) === 1,
            tipoProduccion: bandera(raw?.tipoProduccion) === 1,
            descripcion: textoPlano(raw?.descripcion),
            motivo: textoPlano(raw?.motivo),
            accionesFilas,
            acciones: primera.descripcion,
            responsable: primera.responsable,
            responsableUsuarioId: primera.responsableUsuarioId,
            fechaCompromiso: primera.fechaCompromiso || null,
            solicitar: raw?.solicitar === true,
            corregir: raw?.corregir === true
        };
        if (!filaTieneDatos(fila)) continue;
        const tieneTipo = fila.tipoRequisitos || fila.tipoDiseno || fila.tipoProduccion;
        if (!tieneTipo) {
            throw errorEstado('Cada cambio necesita al menos un tipo de cambio.', 400);
        }
        filas.push(fila);
    }
    return filas;
}

async function listar(pool, opciones = {}) {
    await asegurarTabla(pool);
    const clave = claveProyecto(opciones.empresaId, opciones.folio, opciones.nombreProyecto);
    if (!clave) return [];
    const [rows] = await pool.query(
        `SELECT id, tipo_requisitos, tipo_diseno, tipo_produccion,
                descripcion, motivo, acciones, responsable, responsable_usuario_id,
                DATE_FORMAT(fecha_compromiso, '%Y-%m-%d') AS fecha_compromiso,
                DATE_FORMAT(creado_en, '%Y-%m-%d') AS creado_en,
                creado_por,
                solicitado_usuario_id,
                estatus,
                DATE_FORMAT(solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en,
                DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
                resuelto_por,
                DATE_FORMAT(resuelto_en, '%Y-%m-%d %H:%i:%s') AS resuelto_en,
                acciones_filas
         FROM sgc_control_proyectos_cambios
         WHERE clave_proyecto = ? AND activo = 1
         ORDER BY orden ASC, id ASC`,
        [clave]
    );
    return (rows || []).map(mapearFila);
}

function contenidoGuardado(fila) {
    const primera = fila.accionesFilas[0] || {
        descripcion: '',
        responsable: '',
        responsableUsuarioId: null,
        fechaCompromiso: ''
    };
    return {
        tipoRequisitos: fila.tipoRequisitos ? 1 : 0,
        tipoDiseno: fila.tipoDiseno ? 1 : 0,
        tipoProduccion: fila.tipoProduccion ? 1 : 0,
        descripcion: fila.descripcion,
        motivo: fila.motivo,
        acciones: primera.descripcion,
        responsable: primera.responsable,
        responsableUsuarioId: primera.responsableUsuarioId,
        fechaCompromiso: primera.fechaCompromiso || null,
        accionesFilas: JSON.stringify(fila.accionesFilas)
    };
}

function contenidoDesdeRegistro(row) {
    const fila = mapearFila(row);
    return contenidoGuardado({
        ...fila,
        accionesFilas: fila.accionesFilas
    });
}

async function guardar(pool, opciones = {}) {
    await asegurarTabla(pool);
    const empresaId = empresaIdValor(opciones.empresaId);
    const folio = textoPlano(opciones.folio, 255).trim();
    const nombreProyecto = textoPlano(opciones.nombreProyecto, 500).trim();
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) {
        throw errorEstado('El proyecto no tiene folio ni nombre para guardar el control de cambios.', 400);
    }
    const filas = normalizarFilas(opciones.cambios);
    const usuario = textoPlano(opciones.usuarioNombre, 255).trim() || 'Usuario';
    const fechaHora = textoPlano(opciones.fechaHora, 32).trim() || null;
    const esRoot = opciones.esRoot === true;
    const pendientesAviso = [];

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [existentes] = await conn.query(
            `SELECT id, tipo_requisitos, tipo_diseno, tipo_produccion,
                    descripcion, motivo, acciones, responsable, responsable_usuario_id,
                    DATE_FORMAT(fecha_compromiso, '%Y-%m-%d') AS fecha_compromiso,
                    acciones_filas, estatus, creado_por, solicitado_usuario_id,
                    DATE_FORMAT(solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en,
                    DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
                    resuelto_por,
                    DATE_FORMAT(resuelto_en, '%Y-%m-%d %H:%i:%s') AS resuelto_en
             FROM sgc_control_proyectos_cambios
             WHERE clave_proyecto = ? AND activo = 1`,
            [clave]
        );
        const porId = new Map((existentes || []).map((row) => [Number(row.id), row]));
        const conservados = [];

        for (let i = 0; i < filas.length; i += 1) {
            const fila = filas[i];
            const previa = fila.id ? porId.get(fila.id) : null;
            if (previa) {
                const estatusPrevio = estatusCambio(previa.estatus);
                const bloqueado = estatusPrevio === 'aprobado' || estatusPrevio === 'no_aprobado';
                const corregir = estatusPrevio === 'en_espera' && fila.corregir;
                const solicitar = estatusPrevio === 'borrador' && fila.solicitar;
                const conservar = bloqueado || (estatusPrevio === 'en_espera' && !corregir);
                const contenido = conservar ? contenidoDesdeRegistro(previa) : contenidoGuardado(fila);
                const estatus = solicitar ? 'en_espera' : estatusPrevio;
                const creadoPor = solicitar ? usuario : (previa.creado_por || usuario);
                const solicitadoEn = solicitar ? fechaHora : (previa.solicitado_en || null);
                const editadoEn = corregir ? fechaHora : (previa.editado_en || null);
                const solicitadoUsuarioId = solicitar
                    ? (Number(opciones.usuarioId) || null)
                    : (Number(previa.solicitado_usuario_id) || null);
                await conn.query(
                    `UPDATE sgc_control_proyectos_cambios
                     SET empresa_id = ?, folio = ?, nombre_proyecto = ?, clave_proyecto = ?,
                         tipo_requisitos = ?, tipo_diseno = ?, tipo_produccion = ?,
                         descripcion = ?, motivo = ?, acciones = ?,
                         responsable = ?, responsable_usuario_id = ?, fecha_compromiso = ?,
                         acciones_filas = ?, orden = ?, activo = 1, estatus = ?,
                         creado_por = ?, solicitado_usuario_id = ?, solicitado_en = ?, editado_en = ?,
                         modificado_por = ?, modificado_en = ?
                     WHERE id = ? AND clave_proyecto = ?`,
                    [
                        empresaId, folio, nombreProyecto, clave,
                        contenido.tipoRequisitos, contenido.tipoDiseno, contenido.tipoProduccion,
                        contenido.descripcion, contenido.motivo, contenido.acciones,
                        contenido.responsable, contenido.responsableUsuarioId, contenido.fechaCompromiso,
                        contenido.accionesFilas, i + 1, estatus,
                        creadoPor, solicitadoUsuarioId, solicitadoEn, editadoEn,
                        usuario, fechaHora,
                        fila.id, clave
                    ]
                );
                conservados.push(fila.id);
                if (solicitar) {
                    pendientesAviso.push({ cambioId: fila.id, solicitadoPor: usuario });
                }
            } else {
                const estatus = fila.solicitar ? 'en_espera' : 'borrador';
                const contenido = contenidoGuardado(fila);
                const [result] = await conn.query(
                    `INSERT INTO sgc_control_proyectos_cambios
                        (empresa_id, folio, nombre_proyecto, clave_proyecto,
                         tipo_requisitos, tipo_diseno, tipo_produccion,
                         descripcion, motivo, acciones,
                         responsable, responsable_usuario_id, fecha_compromiso, acciones_filas,
                         orden, estatus, solicitado_en, editado_en,
                         modificado_por, modificado_en, creado_por, creado_en, solicitado_usuario_id, activo)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
                    [
                        empresaId, folio, nombreProyecto, clave,
                        contenido.tipoRequisitos, contenido.tipoDiseno, contenido.tipoProduccion,
                        contenido.descripcion, contenido.motivo, contenido.acciones,
                        contenido.responsable, contenido.responsableUsuarioId, contenido.fechaCompromiso,
                        contenido.accionesFilas,
                        i + 1, estatus, estatus === 'en_espera' ? fechaHora : null,
                        usuario, fechaHora, usuario, fechaHora,
                        estatus === 'en_espera' ? (Number(opciones.usuarioId) || null) : null
                    ]
                );
                const nuevoId = Number(result?.insertId || 0);
                if (nuevoId) {
                    conservados.push(nuevoId);
                    if (estatus === 'en_espera') {
                        pendientesAviso.push({ cambioId: nuevoId, solicitadoPor: usuario });
                    }
                }
            }
        }

        if (!esRoot) {
            for (const [id, row] of porId) {
                if (!conservados.includes(id) && estatusCambio(row.estatus) !== 'borrador') {
                    conservados.push(id);
                }
            }
        }
        const quitar = [...porId.keys()].filter((id) => !conservados.includes(id));
        if (quitar.length) {
            await conn.query(
                `UPDATE sgc_control_proyectos_cambios
                 SET activo = 0, modificado_por = ?, modificado_en = ?
                 WHERE clave_proyecto = ? AND id IN (${quitar.map(() => '?').join(',')})`,
                [usuario, fechaHora, clave, ...quitar]
            );
        }

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    for (const aviso of pendientesAviso) {
        await notificarAprobadores(pool, opciones.poolUsuarios, {
            cambioId: aviso.cambioId,
            empresaId,
            folio,
            nombreProyecto,
            solicitadoPor: aviso.solicitadoPor,
            fechaHora
        });
    }

    return listar(pool, { empresaId, folio, nombreProyecto });
}

async function resolver(pool, opciones = {}) {
    await asegurarTabla(pool);
    if (!usuarioPuedeResolver(opciones.user)) {
        throw errorEstado('No puedes resolver esta solicitud de cambio.', 403);
    }
    const decision = opciones.decision === 'aprobado' || opciones.decision === 'no_aprobado'
        ? opciones.decision
        : '';
    if (!decision) {
        throw errorEstado('Indica si el cambio se aprueba o no.', 400);
    }
    const cambioId = Number(opciones.cambioId);
    if (!Number.isInteger(cambioId) || cambioId <= 0) {
        throw errorEstado('No se encontró la solicitud de cambio.', 400);
    }
    const empresaId = empresaIdValor(opciones.empresaId);
    const folio = textoPlano(opciones.folio, 255).trim();
    const nombreProyecto = textoPlano(opciones.nombreProyecto, 500).trim();
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) {
        throw errorEstado('El proyecto no tiene folio ni nombre para resolver el cambio.', 400);
    }
    const usuario = textoPlano(opciones.usuarioNombre, 255).trim() || 'Usuario';
    const fechaHora = textoPlano(opciones.fechaHora, 32).trim() || null;
    const [previas] = await pool.query(
        `SELECT solicitado_usuario_id, creado_por, empresa_id, folio, nombre_proyecto
         FROM sgc_control_proyectos_cambios
         WHERE id = ? AND clave_proyecto = ? AND activo = 1 AND estatus = 'en_espera'
         LIMIT 1`,
        [cambioId, clave]
    );
    const previa = previas?.[0] || null;
    const [result] = await pool.query(
        `UPDATE sgc_control_proyectos_cambios
         SET estatus = ?, resuelto_por = ?, resuelto_en = ?, modificado_por = ?, modificado_en = ?
         WHERE id = ? AND clave_proyecto = ? AND activo = 1 AND estatus = 'en_espera'`,
        [decision, usuario, fechaHora, usuario, fechaHora, cambioId, clave]
    );
    if (!result?.affectedRows) {
        throw errorEstado('Esta solicitud ya fue resuelta o ya no está en espera.', 409);
    }
    if (previa) {
        await notificarSolicitante(pool, opciones.poolUsuarios, {
            cambioId,
            empresaId: previa.empresa_id,
            folio: previa.folio,
            nombreProyecto: previa.nombre_proyecto,
            solicitadoUsuarioId: previa.solicitado_usuario_id,
            creadoPor: previa.creado_por,
            resueltoPor: usuario,
            fechaHora
        });
    }
    return listar(pool, { empresaId, folio, nombreProyecto });
}

function mensajeSolicitud(nombre, proyecto) {
    const quien = recortarTexto(nombre, 80) || 'Un usuario';
    const proy = recortarTexto(proyecto, 72) || 'un proyecto';
    return `${quien} solicitó un cambio en «${proy}».`;
}

async function notificarAprobadores(pool, poolUsuarios, aviso) {
    if (!poolUsuarios) return;
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
        const destinos = new Set(
            (users || [])
                .map((row) => String(row.username || '').trim().toLowerCase())
                .filter(Boolean)
        );
        if (!destinos.size) return;
        const mensaje = mensajeSolicitud(aviso.solicitadoPor, aviso.nombreProyecto);
        for (const username of destinos) {
            await insertarAviso(pool, {
                cambioId: aviso.cambioId,
                username,
                mensaje,
                empresaId: aviso.empresaId,
                folio: aviso.folio,
                nombreProyecto: aviso.nombreProyecto,
                solicitadoPor: aviso.solicitadoPor,
                tipo: 'revision',
                fechaHora: aviso.fechaHora
            });
        }
    } catch (error) {
        console.warn('[cambios] No se pudo avisar a los aprobadores:', error.message);
    }
}

async function listarBandeja(pool) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        `SELECT id, empresa_id, folio, nombre_proyecto,
                tipo_requisitos, tipo_diseno, tipo_produccion,
                descripcion, motivo, acciones, responsable, responsable_usuario_id,
                DATE_FORMAT(fecha_compromiso, '%Y-%m-%d') AS fecha_compromiso,
                DATE_FORMAT(creado_en, '%Y-%m-%d') AS creado_en,
                creado_por, solicitado_usuario_id, estatus,
                DATE_FORMAT(solicitado_en, '%Y-%m-%d %H:%i:%s') AS solicitado_en,
                DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
                resuelto_por,
                DATE_FORMAT(resuelto_en, '%Y-%m-%d %H:%i:%s') AS resuelto_en,
                acciones_filas
         FROM sgc_control_proyectos_cambios
         WHERE activo = 1 AND estatus IN ('en_espera', 'aprobado', 'no_aprobado')
         ORDER BY CASE estatus WHEN 'en_espera' THEN 0 ELSE 1 END,
                  COALESCE(solicitado_en, creado_en) DESC,
                  id DESC`
    );
    return (rows || []).map((row) => ({
        ...mapearFila(row),
        empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
        folio: row.folio == null ? '' : String(row.folio),
        nombreProyecto: row.nombre_proyecto == null ? '' : String(row.nombre_proyecto)
    }));
}

async function listarAvisos(pool, username) {
    await asegurarTabla(pool);
    const usuario = String(username || '').trim().toLowerCase();
    if (!usuario) return [];
    const [rows] = await pool.query(
        `SELECT a.id, a.cambio_id, a.tipo, a.mensaje, a.empresa_id, a.folio, a.nombre_proyecto, a.solicitado_por,
                c.estatus AS estatus_cambio, c.resuelto_por,
                DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
         FROM sgc_control_proyectos_cambios_avisos a
         INNER JOIN sgc_control_proyectos_cambios c ON c.id = a.cambio_id AND c.activo = 1
         WHERE LOWER(a.username) = ?
           AND a.descartado = 0
           AND (
                a.tipo = 'respuesta'
                OR (c.estatus = 'en_espera' AND a.tipo IN ('revision', 'recordatorio', 'recordatorio_urgente'))
           )
         ORDER BY CASE a.tipo
                    WHEN 'respuesta' THEN 0
                    WHEN 'recordatorio_urgente' THEN 1
                    ELSE 2
                  END,
                  a.id DESC
         LIMIT 20`,
        [usuario]
    );
    return (rows || []).map((row) => ({
        id: Number(row.id),
        cambioId: Number(row.cambio_id),
        tipo: row.tipo == null ? 'revision' : String(row.tipo),
        mensaje: row.mensaje == null ? '' : String(row.mensaje),
        empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
        folio: row.folio == null ? '' : String(row.folio),
        nombreProyecto: row.nombre_proyecto == null ? '' : String(row.nombre_proyecto),
        solicitadoPor: row.solicitado_por == null ? '' : String(row.solicitado_por),
        resueltoPor: row.resuelto_por == null ? '' : String(row.resuelto_por),
        estatus: row.estatus_cambio == null ? '' : String(row.estatus_cambio),
        creadoEn: row.creado_en ? String(row.creado_en) : ''
    }));
}

async function descartarAviso(pool, id, username) {
    await asegurarTabla(pool);
    const avisoId = Number(id);
    const usuario = String(username || '').trim().toLowerCase();
    if (!Number.isInteger(avisoId) || avisoId <= 0 || !usuario) return false;
    await pool.query(
        `UPDATE sgc_control_proyectos_cambios_avisos
         SET descartado = 1
         WHERE id = ? AND LOWER(username) = ?`,
        [avisoId, usuario]
    );
    return true;
}

async function insertarAviso(pool, aviso) {
    await pool.query(
        `INSERT INTO sgc_control_proyectos_cambios_avisos
            (cambio_id, username, tipo, mensaje, empresa_id, folio, nombre_proyecto, solicitado_por, descartado, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
            aviso.cambioId,
            String(aviso.username || '').trim().toLowerCase(),
            aviso.tipo || 'revision',
            aviso.mensaje,
            aviso.empresaId ?? null,
            aviso.folio || '',
            textoPlano(aviso.nombreProyecto, 500),
            textoPlano(aviso.solicitadoPor, 255),
            aviso.fechaHora || fechaHoraMexico()
        ]
    );
}

async function notificarSolicitante(pool, poolUsuarios, aviso) {
    if (!poolUsuarios) return;
    const userId = Number(aviso.solicitadoUsuarioId);
    if (!Number.isInteger(userId) || userId <= 0) return;
    try {
        const [users] = await poolUsuarios.query(
            `SELECT username, nombre, apellido
             FROM usuario
             WHERE id = ? AND activo = 1
             LIMIT 1`,
            [userId]
        );
        const persona = users?.[0];
        const username = String(persona?.username || '').trim().toLowerCase();
        if (!username) return;
        const estimado = textoPlano(aviso.creadoPor, 120).trim()
            || [persona.nombre, persona.apellido].filter(Boolean).join(' ').trim()
            || username;
        const resolutor = recortarTexto(aviso.resueltoPor, 80) || 'un revisor';
        await insertarAviso(pool, {
            cambioId: aviso.cambioId,
            username,
            tipo: 'respuesta',
            mensaje: `Estimado ${estimado}, tu petición de cambio fue respondida por ${resolutor}. Ya puedes consultar el estatus.`,
            empresaId: aviso.empresaId,
            folio: aviso.folio,
            nombreProyecto: aviso.nombreProyecto,
            solicitadoPor: estimado,
            fechaHora: aviso.fechaHora
        });
    } catch (error) {
        console.warn('[cambios] No se pudo avisar al solicitante:', error.message);
    }
}

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

function sumarDiasIso(iso, dias) {
    const base = new Date(`${iso}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + dias);
    return base.toISOString().slice(0, 10);
}

function fechaCompromisoMasProxima(row) {
    const fechas = [];
    const columna = String(row?.fecha_compromiso || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(columna)) fechas.push(columna);
    let filas = row?.acciones_filas;
    if (typeof filas === 'string') {
        try { filas = JSON.parse(filas); } catch (_error) { filas = []; }
    }
    if (Array.isArray(filas)) {
        filas.forEach((accion) => {
            const fecha = String(accion?.fechaCompromiso || accion?.fecha_compromiso || '').slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fechas.push(fecha);
        });
    }
    return fechas.sort()[0] || '';
}

async function destinosAprobadores(poolUsuarios) {
    if (!poolUsuarios) return [];
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
            .map((row) => String(row.username || '').trim().toLowerCase())
            .filter(Boolean)
    )];
}

async function procesarRecordatorios(pool, poolUsuarios) {
    await asegurarTabla(pool);
    const destinos = await destinosAprobadores(poolUsuarios);
    if (!destinos.length) return { enviados: 0 };
    const ahora = fechaHoraMexico();
    const manana = sumarDiasIso(fechaMexico(), 1);
    const [pendientes] = await pool.query(
        `SELECT id, empresa_id, folio, nombre_proyecto, creado_por,
                DATE_FORMAT(fecha_compromiso, '%Y-%m-%d') AS fecha_compromiso,
                acciones_filas
         FROM sgc_control_proyectos_cambios
         WHERE activo = 1 AND estatus = 'en_espera'`
    );
    let enviados = 0;
    for (const cambio of pendientes || []) {
        const compromiso = fechaCompromisoMasProxima(cambio);
        const urgente = !!compromiso && compromiso <= manana;
        const tipo = urgente ? 'recordatorio_urgente' : 'recordatorio';
        const minutos = urgente ? 60 : 24 * 60;
        const proyecto = recortarTexto(cambio.nombre_proyecto, 72) || 'un proyecto';
        const quien = recortarTexto(cambio.creado_por, 80) || 'Un usuario';
        const mensaje = urgente
            ? `${quien} tiene un cambio en «${proyecto}» con la fecha de compromiso próxima.`
            : `${quien} tiene un cambio en «${proyecto}» que sigue en espera.`;
        for (const username of destinos) {
            const [previos] = await pool.query(
                `SELECT
                    SUM(CASE WHEN descartado = 0 AND tipo IN ('revision', 'recordatorio', 'recordatorio_urgente') THEN 1 ELSE 0 END) AS abiertos,
                    TIMESTAMPDIFF(MINUTE, MAX(creado_en), ?) AS minutos
                 FROM sgc_control_proyectos_cambios_avisos
                 WHERE cambio_id = ? AND LOWER(username) = ?`,
                [ahora, cambio.id, username]
            );
            const estado = previos?.[0] || {};
            if (Number(estado.abiertos) > 0) continue;
            if (estado.minutos != null && Number(estado.minutos) < minutos) continue;
            await insertarAviso(pool, {
                cambioId: cambio.id,
                username,
                tipo,
                mensaje,
                empresaId: cambio.empresa_id,
                folio: cambio.folio,
                nombreProyecto: cambio.nombre_proyecto,
                solicitadoPor: cambio.creado_por,
                fechaHora: ahora
            });
            enviados += 1;
        }
    }
    return { enviados };
}

module.exports = {
    listar,
    listarBandeja,
    guardar,
    resolver,
    listarAvisos,
    descartarAviso,
    procesarRecordatorios,
    usuarioPuedeResolver
};
