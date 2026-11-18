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
            silenciado TINYINT(1) NOT NULL DEFAULT 0,
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
    const [silenciado] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios_avisos LIKE 'silenciado'`
    );
    if (!silenciado || !silenciado.length) {
        await pool.query(
            `ALTER TABLE sgc_control_proyectos_cambios_avisos
             ADD COLUMN silenciado TINYINT(1) NOT NULL DEFAULT 0 AFTER descartado`
        );
    }
    const [cambioIdCol] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios_avisos LIKE 'cambio_id'`
    );
    if (cambioIdCol?.[0] && String(cambioIdCol[0].Null || '').toUpperCase() === 'NO') {
        await pool.query(
            `ALTER TABLE sgc_control_proyectos_cambios_avisos MODIFY cambio_id INT NULL`
        );
    }
    await asegurarColumnaAvisos(pool, 'pedido_id', 'pedido_id INT NULL');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos_pedidos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NULL,
            folio VARCHAR(255) NOT NULL DEFAULT '',
            nombre_proyecto VARCHAR(500) NOT NULL DEFAULT '',
            clave_proyecto VARCHAR(700) NOT NULL,
            nota TEXT NULL,
            solicitado_por VARCHAR(255) NOT NULL DEFAULT '',
            solicitado_usuario_id INT NULL,
            estatus VARCHAR(20) NOT NULL DEFAULT 'pendiente',
            cambio_id INT NULL,
            creado_en DATETIME NULL,
            llenado_en DATETIME NULL,
            INDEX idx_cp_pedidos_clave (clave_proyecto, estatus),
            INDEX idx_cp_pedidos_empresa (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_control_proyectos_pedidos_destinatarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pedido_id INT NOT NULL,
            usuario_id INT NOT NULL,
            username VARCHAR(80) NOT NULL DEFAULT '',
            nombre VARCHAR(255) NOT NULL DEFAULT '',
            INDEX idx_cp_pedido_dest (pedido_id),
            INDEX idx_cp_pedido_dest_user (usuario_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function asegurarColumnaAvisos(pool, nombre, definicion) {
    const [columnas] = await pool.query(
        `SHOW COLUMNS FROM sgc_control_proyectos_cambios_avisos LIKE ?`,
        [nombre]
    );
    if (!columnas || !columnas.length) {
        await pool.query(`ALTER TABLE sgc_control_proyectos_cambios_avisos ADD COLUMN ${definicion}`);
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

function rolesDe(user = {}) {
    const roles = Array.isArray(user.roles)
        ? user.roles.map((rol) => String(rol || '').toLowerCase())
        : [];
    if (user.rol) roles.push(String(user.rol).toLowerCase());
    return roles;
}

function usuarioPuedeResolver(user = {}) {
    const username = String(user.username || '').toLowerCase().trim();
    return rolesDe(user).includes('root') || APROBADORES_CAMBIO.includes(username);
}

function usuarioPuedePedir(user = {}) {
    const username = String(user.username || '').toLowerCase().trim();
    return rolesDe(user).includes('root') || username === 'root' || username === 'marisol12';
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
                if (fila.solicitar || fila.corregir) {
                    throw errorEstado('El formato se registra cuando hay un pedido de cambio.', 400);
                }
                const estatusPrevio = estatusCambio(previa.estatus);
                const bloqueado = estatusPrevio === 'aprobado' || estatusPrevio === 'no_aprobado';
                const corregir = false;
                const solicitar = false;
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
            } else {
                if (!esRoot || fila.solicitar) {
                    throw errorEstado('El formato se habilita cuando hay un pedido de cambio pendiente.', 403);
                }
                const estatus = 'borrador';
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
                if (nuevoId) conservados.push(nuevoId);
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

async function listarAvisos(pool, username, opciones = {}) {
    await asegurarTabla(pool);
    const usuario = String(username || '').trim().toLowerCase();
    if (!usuario) return [];
    const incluirSilenciados = !!opciones.incluirSilenciados;
    await pool.query(
        `UPDATE sgc_control_proyectos_cambios_avisos a
         INNER JOIN sgc_control_proyectos_cambios c ON c.id = a.cambio_id
         SET a.descartado = 1
         WHERE LOWER(a.username) = ?
           AND a.descartado = 0
           AND a.tipo IN ('revision', 'recordatorio', 'recordatorio_urgente')
           AND c.estatus IN ('aprobado', 'no_aprobado')`,
        [usuario]
    );
    await pool.query(
        `UPDATE sgc_control_proyectos_cambios_avisos a
         INNER JOIN sgc_control_proyectos_pedidos p ON p.id = a.pedido_id
         SET a.descartado = 1
         WHERE LOWER(a.username) = ?
           AND a.descartado = 0
           AND a.tipo = 'pedido'
           AND p.estatus <> 'pendiente'`,
        [usuario]
    );
    const [rows] = await pool.query(
        `SELECT a.id, a.cambio_id, a.pedido_id, a.tipo, a.mensaje, a.empresa_id, a.folio, a.nombre_proyecto, a.solicitado_por,
                a.silenciado, c.estatus AS estatus_cambio, c.resuelto_por,
                DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
         FROM sgc_control_proyectos_cambios_avisos a
         LEFT JOIN sgc_control_proyectos_cambios c ON c.id = a.cambio_id AND c.activo = 1
         LEFT JOIN sgc_control_proyectos_pedidos p ON p.id = a.pedido_id
         WHERE LOWER(a.username) = ?
           AND a.descartado = 0
           ${incluirSilenciados ? '' : 'AND a.silenciado = 0'}
           AND (
                (a.tipo = 'pedido' AND p.estatus = 'pendiente')
                OR ${incluirSilenciados ? '0' : "a.tipo = 'respuesta'"}
                OR (c.estatus = 'en_espera' AND a.tipo IN ('revision', 'recordatorio', 'recordatorio_urgente'))
           )
         ORDER BY CASE a.tipo
                    WHEN 'pedido' THEN 0
                    WHEN 'respuesta' THEN 1
                    WHEN 'recordatorio_urgente' THEN 2
                    ELSE 3
                  END,
                  a.id DESC
         LIMIT 40`,
        [usuario]
    );
    return (rows || []).map((row) => ({
        id: Number(row.id),
        cambioId: Number(row.cambio_id) > 0 ? Number(row.cambio_id) : null,
        pedidoId: Number(row.pedido_id) > 0 ? Number(row.pedido_id) : null,
        tipo: row.tipo == null ? 'revision' : String(row.tipo),
        mensaje: row.mensaje == null ? '' : String(row.mensaje),
        empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
        folio: row.folio == null ? '' : String(row.folio),
        nombreProyecto: row.nombre_proyecto == null ? '' : String(row.nombre_proyecto),
        solicitadoPor: row.solicitado_por == null ? '' : String(row.solicitado_por),
        resueltoPor: row.resuelto_por == null ? '' : String(row.resuelto_por),
        estatus: row.estatus_cambio == null ? '' : String(row.estatus_cambio),
        creadoEn: row.creado_en ? String(row.creado_en) : '',
        silenciado: Number(row.silenciado) === 1
    }));
}

async function silenciarAviso(pool, id, username) {
    await asegurarTabla(pool);
    const avisoId = Number(id);
    const usuario = String(username || '').trim().toLowerCase();
    if (!Number.isInteger(avisoId) || avisoId <= 0 || !usuario) return false;
    await pool.query(
        `UPDATE sgc_control_proyectos_cambios_avisos
         SET silenciado = 1
         WHERE id = ? AND LOWER(username) = ? AND descartado = 0`,
        [avisoId, usuario]
    );
    return true;
}

async function reactivarSilenciados(pool, username) {
    await asegurarTabla(pool);
    const usuario = String(username || '').trim().toLowerCase();
    if (!usuario) return { reactivados: 0 };
    const [result] = await pool.query(
        `UPDATE sgc_control_proyectos_cambios_avisos
         SET silenciado = 0
         WHERE LOWER(username) = ? AND descartado = 0 AND silenciado = 1`,
        [usuario]
    );
    return { reactivados: Number(result?.affectedRows || 0) };
}

async function descartarAviso(pool, id, username) {
    await asegurarTabla(pool);
    const avisoId = Number(id);
    const usuario = String(username || '').trim().toLowerCase();
    if (!Number.isInteger(avisoId) || avisoId <= 0 || !usuario) return false;
    const [rows] = await pool.query(
        `SELECT tipo FROM sgc_control_proyectos_cambios_avisos
         WHERE id = ? AND LOWER(username) = ? AND descartado = 0
         LIMIT 1`,
        [avisoId, usuario]
    );
    const tipo = String(rows?.[0]?.tipo || '');
    if (!tipo || tipo === 'pedido') return false;
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
            (cambio_id, pedido_id, username, tipo, mensaje, empresa_id, folio, nombre_proyecto, solicitado_por, descartado, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
            Number(aviso.cambioId) > 0 ? Number(aviso.cambioId) : null,
            Number(aviso.pedidoId) > 0 ? Number(aviso.pedidoId) : null,
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

function parseIdsResponsable(valor) {
    if (Array.isArray(valor)) {
        return valor.map((item) => Number(item)).filter((n) => Number.isInteger(n) && n > 0);
    }
    const texto = String(valor || '').trim();
    if (!texto) return [];
    if (texto.startsWith('[')) {
        try {
            const parsed = JSON.parse(texto);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => Number(item)).filter((n) => Number.isInteger(n) && n > 0);
            }
        } catch (_error) {
            /* texto plano */
        }
    }
    return texto.split(/\s*\|\s*/)
        .map((item) => Number(String(item || '').trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
}

function parseNombresResponsable(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return [];
    if (texto.startsWith('[')) {
        try {
            const parsed = JSON.parse(texto);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch (_error) {
            /* texto plano */
        }
    }
    return texto.split(/\s*\|\s*/).map((item) => item.trim()).filter(Boolean);
}

function nombreUsuario(row) {
    const completo = [row?.nombre, row?.apellido].filter(Boolean).join(' ').trim();
    return completo || String(row?.username || '').trim();
}

async function usuariosInternosActivos(poolUsuarios) {
    if (!poolUsuarios) return [];
    const [users] = await poolUsuarios.query(
        `SELECT u.id, u.username, u.nombre, u.apellido
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE u.activo = 1
           AND LOWER(COALESCE(r.nombre_rol, '')) NOT IN ('empresa', 'usuario empresa')`
    );
    return users || [];
}

async function filasProyecto(pool, empresaId, folio, nombreProyecto) {
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) return [];
    const params = [];
    let sql = `SELECT empresa_id, folio, nombre_proyecto, responsable, responsable_usuario_ids
               FROM sgc_control_proyectos
               WHERE activo = 1`;
    if (empresaId) {
        sql += ' AND empresa_id = ?';
        params.push(empresaId);
    } else {
        sql += ' AND (empresa_id IS NULL OR empresa_id = 0)';
    }
    const [rows] = await pool.query(sql, params);
    return (rows || []).filter((row) => claveProyecto(row.empresa_id, row.folio, row.nombre_proyecto) === clave);
}

function encargadosDesdeFilas(filas, usuarios) {
    const porId = new Map();
    const porNombre = new Map();
    (usuarios || []).forEach((user) => {
        const id = Number(user.id);
        if (!Number.isInteger(id) || id <= 0) return;
        porId.set(id, user);
        const nombre = normalizar(nombreUsuario(user));
        if (nombre) porNombre.set(nombre, user);
    });
    const elegidos = new Map();
    const tomar = (user) => {
        const id = Number(user?.id);
        if (!Number.isInteger(id) || id <= 0 || elegidos.has(id)) return;
        elegidos.set(id, {
            usuarioId: id,
            username: String(user.username || '').trim().toLowerCase(),
            nombre: nombreUsuario(user)
        });
    };
    (filas || []).forEach((fila) => {
        parseIdsResponsable(fila.responsable_usuario_ids).forEach((id) => {
            if (porId.has(id)) tomar(porId.get(id));
        });
        parseNombresResponsable(fila.responsable).forEach((nombre) => {
            const user = porNombre.get(normalizar(nombre));
            if (user) tomar(user);
        });
    });
    return [...elegidos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

async function pedidoPendienteDeClave(pool, clave) {
    const [rows] = await pool.query(
        `SELECT id, empresa_id, folio, nombre_proyecto, nota, solicitado_por, solicitado_usuario_id, estatus
         FROM sgc_control_proyectos_pedidos
         WHERE clave_proyecto = ? AND estatus = 'pendiente'
         ORDER BY id DESC
         LIMIT 1`,
        [clave]
    );
    return rows?.[0] || null;
}

function mapearPedido(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        empresaId: row.empresa_id == null ? null : Number(row.empresa_id),
        folio: row.folio == null ? '' : String(row.folio),
        nombreProyecto: row.nombre_proyecto == null ? '' : String(row.nombre_proyecto),
        nota: row.nota == null ? '' : String(row.nota),
        solicitadoPor: row.solicitado_por == null ? '' : String(row.solicitado_por),
        solicitadoUsuarioId: Number(row.solicitado_usuario_id) > 0 ? Number(row.solicitado_usuario_id) : null
    };
}

async function listarProyectosEmpresa(pool, empresaId) {
    await asegurarTabla(pool);
    const id = empresaIdValor(empresaId);
    if (!id) return [];
    const [rows] = await pool.query(
        `SELECT empresa_id, folio, nombre_proyecto
         FROM sgc_control_proyectos
         WHERE activo = 1 AND empresa_id = ?
         ORDER BY nombre_proyecto ASC, folio ASC`,
        [id]
    );
    const vistos = new Map();
    (rows || []).forEach((row) => {
        const clave = claveProyecto(row.empresa_id, row.folio, row.nombre_proyecto);
        if (!clave || vistos.has(clave)) return;
        vistos.set(clave, {
            empresaId: Number(row.empresa_id),
            folio: row.folio == null ? '' : String(row.folio),
            nombreProyecto: row.nombre_proyecto == null ? '' : String(row.nombre_proyecto)
        });
    });
    return [...vistos.values()];
}

async function listarEncargados(pool, poolUsuarios, opciones = {}) {
    await asegurarTabla(pool);
    const empresaId = empresaIdValor(opciones.empresaId);
    const folio = textoPlano(opciones.folio, 255).trim();
    const nombreProyecto = textoPlano(opciones.nombreProyecto, 500).trim();
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) {
        throw errorEstado('Elige un proyecto para ver a sus encargados.', 400);
    }
    const filas = await filasProyecto(pool, empresaId, folio, nombreProyecto);
    const usuarios = await usuariosInternosActivos(poolUsuarios);
    const encargados = encargadosDesdeFilas(filas, usuarios);
    const pendiente = await pedidoPendienteDeClave(pool, clave);
    return {
        encargados,
        pedidoPendiente: pendiente ? mapearPedido(pendiente) : null
    };
}

function mensajePedido(nombre, proyecto, nota) {
    const quien = recortarTexto(nombre, 80) || 'Marisol';
    const proy = recortarTexto(proyecto, 72) || 'un proyecto';
    const base = `${quien} solicitó cambios en «${proy}».`;
    const extra = recortarTexto(nota, 180);
    return extra ? `${base} ${extra}` : base;
}

async function crearPedido(pool, opciones = {}) {
    await asegurarTabla(pool);
    if (!usuarioPuedePedir(opciones.user)) {
        throw errorEstado('Solo Marisol o root pueden solicitar un cambio.', 403);
    }
    const empresaId = empresaIdValor(opciones.empresaId);
    const folio = textoPlano(opciones.folio, 255).trim();
    const nombreProyecto = textoPlano(opciones.nombreProyecto, 500).trim();
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) {
        throw errorEstado('Elige la empresa y el proyecto.', 400);
    }
    const nota = textoPlano(opciones.nota, 2000).trim();
    const consulta = await listarEncargados(pool, opciones.poolUsuarios, {
        empresaId, folio, nombreProyecto
    });
    if (consulta.pedidoPendiente) {
        throw errorEstado('Este proyecto ya tiene un pedido de cambio pendiente.', 409);
    }
    const encargados = consulta.encargados;
    if (!encargados.length) {
        throw errorEstado('Este proyecto no tiene un encargado con usuario.', 400);
    }
    let destinos = encargados;
    if (encargados.length > 1) {
        const ids = new Set(
            (Array.isArray(opciones.destinatarioIds) ? opciones.destinatarioIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
        );
        destinos = encargados.filter((item) => ids.has(item.usuarioId));
        if (!destinos.length) {
            throw errorEstado('Elige al menos un encargado.', 400);
        }
    }
    const usuario = textoPlano(opciones.usuarioNombre, 255).trim() || 'Usuario';
    const fechaHora = textoPlano(opciones.fechaHora, 32).trim() || fechaHoraMexico();
    const usuarioId = Number(opciones.usuarioId) > 0 ? Number(opciones.usuarioId) : null;
    const conn = await pool.getConnection();
    let pedidoId = 0;
    try {
        await conn.beginTransaction();
        const [existente] = await conn.query(
            `SELECT id FROM sgc_control_proyectos_pedidos
             WHERE clave_proyecto = ? AND estatus = 'pendiente'
             LIMIT 1`,
            [clave]
        );
        if (existente?.length) {
            throw errorEstado('Este proyecto ya tiene un pedido de cambio pendiente.', 409);
        }
        const [result] = await conn.query(
            `INSERT INTO sgc_control_proyectos_pedidos
                (empresa_id, folio, nombre_proyecto, clave_proyecto, nota,
                 solicitado_por, solicitado_usuario_id, estatus, creado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
            [empresaId, folio, nombreProyecto, clave, nota || null, usuario, usuarioId, fechaHora]
        );
        pedidoId = Number(result?.insertId || 0);
        for (const destino of destinos) {
            await conn.query(
                `INSERT INTO sgc_control_proyectos_pedidos_destinatarios
                    (pedido_id, usuario_id, username, nombre)
                 VALUES (?, ?, ?, ?)`,
                [pedidoId, destino.usuarioId, destino.username, destino.nombre]
            );
            await insertarAviso(conn, {
                pedidoId,
                username: destino.username,
                tipo: 'pedido',
                mensaje: mensajePedido(usuario, nombreProyecto || folio, nota),
                empresaId,
                folio,
                nombreProyecto,
                solicitadoPor: usuario,
                fechaHora
            });
        }
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
    return { id: pedidoId, destinatarios: destinos.length };
}

async function listarPedidosMios(pool, usuarioId, username) {
    await asegurarTabla(pool);
    const id = Number(usuarioId) > 0 ? Number(usuarioId) : 0;
    const user = String(username || '').trim().toLowerCase();
    if (!id && !user) return [];
    const [rows] = await pool.query(
        `SELECT p.id, p.empresa_id, p.folio, p.nombre_proyecto, p.nota,
                p.solicitado_por, p.solicitado_usuario_id
         FROM sgc_control_proyectos_pedidos p
         INNER JOIN sgc_control_proyectos_pedidos_destinatarios d ON d.pedido_id = p.id
         WHERE p.estatus = 'pendiente'
           AND (d.usuario_id = ? OR LOWER(d.username) = ?)
         ORDER BY p.id DESC`,
        [id, user]
    );
    const vistos = new Map();
    (rows || []).forEach((row) => {
        if (!vistos.has(Number(row.id))) vistos.set(Number(row.id), mapearPedido(row));
    });
    return [...vistos.values()];
}

async function llenarPedido(pool, opciones = {}) {
    await asegurarTabla(pool);
    const empresaId = empresaIdValor(opciones.empresaId);
    const folio = textoPlano(opciones.folio, 255).trim();
    const nombreProyecto = textoPlano(opciones.nombreProyecto, 500).trim();
    const clave = claveProyecto(empresaId, folio, nombreProyecto);
    if (!clave) {
        throw errorEstado('El proyecto no tiene folio ni nombre para registrar el cambio.', 400);
    }
    const usuarioId = Number(opciones.usuarioId) > 0 ? Number(opciones.usuarioId) : 0;
    const username = String(opciones.username || '').trim().toLowerCase();
    const usuario = textoPlano(opciones.usuarioNombre, 255).trim() || 'Usuario';
    const fechaHora = textoPlano(opciones.fechaHora, 32).trim() || fechaHoraMexico();
    const filas = normalizarFilas(Array.isArray(opciones.cambios) ? opciones.cambios : [opciones.cambio]);
    const fila = filas.find((item) => !item.id) || filas[0];
    if (!fila) {
        throw errorEstado('Completa el formato del cambio.', 400);
    }
    validarSolicitudCompleta(fila, fila.accionesFilas);
    const contenido = contenidoGuardado(fila);
    const conn = await pool.getConnection();
    let cambioId = 0;
    let pedido = null;
    try {
        await conn.beginTransaction();
        const [pedidos] = await conn.query(
            `SELECT p.id, p.empresa_id, p.folio, p.nombre_proyecto, p.nota,
                    p.solicitado_por, p.solicitado_usuario_id
             FROM sgc_control_proyectos_pedidos p
             INNER JOIN sgc_control_proyectos_pedidos_destinatarios d ON d.pedido_id = p.id
             WHERE p.clave_proyecto = ? AND p.estatus = 'pendiente'
               AND (d.usuario_id = ? OR LOWER(d.username) = ?)
             ORDER BY p.id DESC
             LIMIT 1`,
            [clave, usuarioId, username]
        );
        pedido = pedidos?.[0] || null;
        if (!pedido) {
            throw errorEstado('No tienes un pedido de cambio pendiente para este proyecto.', 403);
        }
        const [ordenRows] = await conn.query(
            `SELECT COALESCE(MAX(orden), 0) AS orden
             FROM sgc_control_proyectos_cambios
             WHERE clave_proyecto = ? AND activo = 1`,
            [clave]
        );
        const orden = Number(ordenRows?.[0]?.orden || 0) + 1;
        const [result] = await conn.query(
            `INSERT INTO sgc_control_proyectos_cambios
                (empresa_id, folio, nombre_proyecto, clave_proyecto,
                 tipo_requisitos, tipo_diseno, tipo_produccion,
                 descripcion, motivo, acciones,
                 responsable, responsable_usuario_id, fecha_compromiso, acciones_filas,
                 orden, estatus, solicitado_en, editado_en,
                 modificado_por, modificado_en, creado_por, creado_en,
                 solicitado_usuario_id, resuelto_por, resuelto_en, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aprobado', ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                empresaId, folio, nombreProyecto, clave,
                contenido.tipoRequisitos, contenido.tipoDiseno, contenido.tipoProduccion,
                contenido.descripcion, contenido.motivo, contenido.acciones,
                contenido.responsable, contenido.responsableUsuarioId, contenido.fechaCompromiso,
                contenido.accionesFilas,
                orden, fechaHora,
                usuario, fechaHora, usuario, fechaHora,
                usuarioId || null,
                usuario, fechaHora
            ]
        );
        cambioId = Number(result?.insertId || 0);
        await conn.query(
            `UPDATE sgc_control_proyectos_pedidos
             SET estatus = 'llenado', cambio_id = ?, llenado_en = ?
             WHERE id = ? AND estatus = 'pendiente'`,
            [cambioId || null, fechaHora, pedido.id]
        );
        await conn.query(
            `UPDATE sgc_control_proyectos_cambios_avisos
             SET descartado = 1
             WHERE pedido_id = ? AND tipo = 'pedido' AND descartado = 0`,
            [pedido.id]
        );
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
    return listar(pool, { empresaId, folio, nombreProyecto });
}

async function procesarRecordatorios() {
    return { enviados: 0 };
}

module.exports = {
    listar,
    listarBandeja,
    guardar,
    resolver,
    listarAvisos,
    silenciarAviso,
    reactivarSilenciados,
    descartarAviso,
    procesarRecordatorios,
    usuarioPuedeResolver,
    usuarioPuedePedir,
    listarProyectosEmpresa,
    listarEncargados,
    crearPedido,
    listarPedidosMios,
    llenarPedido
};
