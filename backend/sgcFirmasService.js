/**
 * Firmas y autorizaciones del SGC (fase 1).
 * Solicitudes, firmantes, zonas y auditoría en biznaga_sgc.
 * Las notificaciones se escriben en notificacion_usuario (BD principal).
 *
 * La huella liga la autorización a código, registro, versión declarada,
 * archivo de Drive y resumen. No incluye todavía el volcado del formulario:
 * si el contenido cambia, hay que invalidar o crear otra solicitud.
 * Las coordenadas de firma no se inventan: si no están medidas, quedan NULL.
 */
const crypto = require('crypto');

const ESTADOS_SOLICITUD = new Set(['pendiente', 'parcial', 'autorizada', 'rechazada', 'invalidada']);
const ESTADOS_VIGENTES = new Set(['pendiente', 'parcial', 'autorizada']);

const ZONAS_SEMILLA = [
    {
        codigo: 'SGC-PO-01',
        tipo: 'Política',
        clave: 'firmante',
        etiqueta: 'Firmante',
        origen: 'campo_formulario',
        confianza: 'identificado',
        firmas: 1,
        notas: 'Pie del formulario interactivo (Firmante y Cargo). El archivo de Drive no se midió; la coordenada queda pendiente.'
    },
    {
        codigo: 'DG-F-08',
        tipo: 'Formato',
        clave: 'firmante',
        etiqueta: 'Firmante',
        origen: 'campo_formulario',
        confianza: 'identificado',
        firmas: 1,
        notas: 'Pie de Filosofía Biznaga (Firmante y Cargo). Sin coordenadas del archivo original.'
    },
    {
        codigo: 'SGC-F-23',
        tipo: 'Formato',
        clave: 'firmante',
        etiqueta: 'Firmante',
        origen: 'campo_formulario',
        confianza: 'identificado',
        firmas: 1,
        notas: 'Pie del aviso de privacidad (Firmante y Cargo). Sin coordenadas del archivo original.'
    },
    {
        codigo: 'DG-F-03',
        tipo: 'Formato',
        clave: 'firmante',
        etiqueta: 'Firmante',
        origen: 'campo_formulario',
        confianza: 'identificado',
        firmas: 1,
        notas: 'Pie de objetivos de calidad (Firmante y Cargo). Sin coordenadas del archivo original.'
    },
    {
        codigo: 'AF-F-02',
        tipo: 'Formato',
        clave: 'pie_firmas',
        etiqueta: 'Pie de firmas',
        origen: 'texto_libre',
        confianza: 'pendiente',
        firmas: 1,
        notas: 'Texto libre. La vista indica que las firmas se hacen a mano sobre el impreso. Posición y cantidad no confirmadas.'
    },
    {
        codigo: 'ATH-F-06',
        tipo: 'Formato',
        clave: 'firma_solicitante',
        etiqueta: 'Firma del solicitante',
        origen: 'pdf_adjunto',
        confianza: 'pendiente',
        firmas: 1,
        notas: 'El flujo actual pide generar el PDF, firmarlo fuera del sistema y volver a subirlo. No hay recuadro con coordenadas.'
    },
    {
        codigo: 'SGC-F-11',
        tipo: 'Formato',
        clave: 'elaboro',
        etiqueta: 'Elaboró',
        origen: 'campo_nombre',
        confianza: 'pendiente',
        firmas: 1,
        notas: 'Campo de nombre, no un recuadro de firma manuscrita. Pendiente de confirmación manual.'
    }
];

let tablasListas = false;

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function normalizarTexto(valor, maxLen = 500) {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!texto) return '';
    return texto.slice(0, maxLen);
}

const CARPETA_FIRMAS_DRIVE = '12tzd8TTGhSzTWFD0EjbQVUJRxbbyhqQn';

function sanitizarRutaDocumento(ruta) {
    const raw = String(ruta || '').trim();
    if (!raw.startsWith('/sistema-gestion-calidad')) return '';
    if (raw.includes('://') || raw.startsWith('//') || raw.includes('..')) return '';
    return raw.slice(0, 255);
}

function claveDocumento(ruta) {
    return sanitizarRutaDocumento(ruta).toUpperCase().slice(0, 120);
}

function sanitizarDriveId(valor) {
    const id = String(valor || '').trim();
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(id)) return '';
    return id;
}

function huellaVersion(input) {
    const canon = {
        codigo: normalizarTexto(input.codigo, 64).toUpperCase(),
        registro: normalizarTexto(input.registro, 120).toUpperCase(),
        version: normalizarTexto(input.version, 64),
        versionSistema: normalizarTexto(input.versionSistema, 64),
        driveFileId: sanitizarDriveId(input.driveFileId),
        resumen: normalizarTexto(input.resumen, 4000)
    };
    return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

function estadoSolicitudDesdeFirmantes(firmantes, actual = 'pendiente') {
    if (actual === 'invalidada') return 'invalidada';
    const lista = Array.isArray(firmantes) ? firmantes : [];
    if (lista.some((f) => f.estado === 'rechazada')) return 'rechazada';
    if (lista.length && lista.every((f) => f.estado === 'aprobada')) return 'autorizada';
    if (lista.some((f) => f.estado === 'aprobada')) return 'parcial';
    return 'pendiente';
}

function validarAsignacion(zonas, firmantes, opciones = {}) {
    const errores = [];
    const lista = Array.isArray(firmantes) ? firmantes : [];
    if (!lista.length) {
        errores.push('Selecciona al menos un firmante.');
    }
    const vistos = new Set();
    for (const f of lista) {
        const usuarioId = Number(f.usuarioId || f.usuario_id);
        const zonaId = Number(f.zonaId || f.zona_id) || 0;
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
            errores.push('Cada firmante debe ser un usuario del sistema.');
            continue;
        }
        const key = `${usuarioId}:${zonaId}`;
        if (vistos.has(key)) {
            errores.push('Hay un firmante repetido en la misma zona.');
        }
        vistos.add(key);
    }
    if (opciones.exigirZonas !== false) {
        const identificadas = (zonas || []).filter((z) => z.activo && z.confianza === 'identificado');
        for (const zona of identificadas) {
            const requeridas = Math.max(1, Number(zona.firmas_requeridas) || 1);
            const asignadas = lista.filter((f) => Number(f.zonaId || f.zona_id) === Number(zona.zona_id)).length;
            if (asignadas < requeridas) {
                errores.push(`La zona «${zona.etiqueta}» requiere ${requeridas} firmante(s).`);
            }
        }
    }
    return errores;
}

function coordenadasCompletas(body) {
    const pagina = body.pagina == null || body.pagina === '' ? null : Number(body.pagina);
    const posX = body.posX == null || body.posX === '' ? null : Number(body.posX);
    const posY = body.posY == null || body.posY === '' ? null : Number(body.posY);
    const ancho = body.ancho == null || body.ancho === '' ? null : Number(body.ancho);
    const alto = body.alto == null || body.alto === '' ? null : Number(body.alto);
    const valores = [pagina, posX, posY, ancho, alto];
    const alguno = valores.some((v) => v != null && !Number.isNaN(v));
    const todos = valores.every((v) => v != null && Number.isFinite(v));
    if (alguno && !todos) {
        throw httpError(400, 'Para fijar la zona indica página, posición X, posición Y, ancho y alto.');
    }
    if (!todos) {
        return { pagina: null, posX: null, posY: null, ancho: null, alto: null, completa: false };
    }
    if (pagina < 1 || ancho <= 0 || alto <= 0 || posX < 0 || posY < 0) {
        throw httpError(400, 'La página y las dimensiones de la zona no son válidas.');
    }
    return { pagina, posX, posY, ancho, alto, completa: true };
}

function mapZona(row) {
    if (!row) return null;
    return {
        zona_id: Number(row.zona_id),
        codigo_formato: row.codigo_formato || '',
        tipo_formato: row.tipo_formato || '',
        clave_zona: row.clave_zona || '',
        etiqueta: row.etiqueta || '',
        pagina: row.pagina == null ? null : Number(row.pagina),
        pos_x: row.pos_x == null ? null : Number(row.pos_x),
        pos_y: row.pos_y == null ? null : Number(row.pos_y),
        ancho: row.ancho == null ? null : Number(row.ancho),
        alto: row.alto == null ? null : Number(row.alto),
        unidad: row.unidad || 'pt',
        rol_responsable: row.rol_responsable || '',
        usuario_responsable_id: row.usuario_responsable_id == null ? null : Number(row.usuario_responsable_id),
        firmas_requeridas: Number(row.firmas_requeridas) || 1,
        origen: row.origen || '',
        confianza: row.confianza || 'pendiente',
        notas: row.notas || '',
        activo: Number(row.activo) === 1,
        posicion_pendiente: row.pagina == null || row.pos_x == null || row.ancho == null || row.alto == null
    };
}

function mapFirmante(row) {
    return {
        firmante_id: Number(row.firmante_id),
        solicitud_id: Number(row.solicitud_id),
        usuario_id: Number(row.usuario_id),
        zona_id: Number(row.zona_id) || 0,
        rol_etiqueta: row.rol_etiqueta || '',
        orden_firma: Number(row.orden_firma) || 1,
        estado: row.estado || 'pendiente',
        observacion: row.observacion || '',
        contenido_hash: row.contenido_hash || '',
        tiene_imagen: String(row.imagen_drive_id || '').length > 0 || Number(row.tiene_png) === 1,
        decidido_at: row.decidido_at || null,
        nombre: row.nombre_firmante || ''
    };
}

function mapSolicitud(row, firmantes = []) {
    return {
        solicitud_id: Number(row.solicitud_id),
        codigo: row.codigo || '',
        nombre_documento: row.nombre_documento || '',
        tipo_documento: row.tipo_documento || '',
        registro_clave: row.registro_clave || '',
        drive_file_id: row.drive_file_id || '',
        version_etiqueta: row.version_etiqueta || '',
        version_sistema: row.version_sistema || '',
        contenido_resumen: row.contenido_resumen || '',
        contenido_hash: row.contenido_hash || '',
        estado: row.estado || 'pendiente',
        solicitante_id: Number(row.solicitante_id),
        nombre_solicitante: row.nombre_solicitante || '',
        ruta_documento: row.ruta_documento || '',
        firma_consumida: Number(row.firma_consumida) === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        firmantes
    };
}

async function asegurarTablas(poolSgc) {
    if (!poolSgc?.query) {
        throw httpError(503, 'Base de datos SGC no disponible.');
    }
    if (tablasListas) return;
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_zona (
            zona_id INT AUTO_INCREMENT PRIMARY KEY,
            codigo_formato VARCHAR(64) NOT NULL,
            tipo_formato VARCHAR(64) NOT NULL DEFAULT 'Formato',
            clave_zona VARCHAR(64) NOT NULL,
            etiqueta VARCHAR(120) NOT NULL,
            pagina INT NULL,
            pos_x DECIMAL(10,2) NULL,
            pos_y DECIMAL(10,2) NULL,
            ancho DECIMAL(10,2) NULL,
            alto DECIMAL(10,2) NULL,
            unidad VARCHAR(16) NOT NULL DEFAULT 'pt',
            rol_responsable VARCHAR(120) NOT NULL DEFAULT '',
            usuario_responsable_id INT NULL,
            firmas_requeridas INT NOT NULL DEFAULT 1,
            origen VARCHAR(40) NOT NULL DEFAULT 'pendiente_manual',
            confianza VARCHAR(40) NOT NULL DEFAULT 'pendiente',
            notas TEXT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_firma_zona (codigo_formato, clave_zona),
            INDEX idx_sgc_firma_zona_codigo (codigo_formato)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_solicitud (
            solicitud_id INT AUTO_INCREMENT PRIMARY KEY,
            codigo VARCHAR(64) NOT NULL,
            nombre_documento VARCHAR(500) NOT NULL DEFAULT '',
            tipo_documento VARCHAR(64) NOT NULL DEFAULT '',
            registro_clave VARCHAR(120) NOT NULL DEFAULT '',
            drive_file_id VARCHAR(128) NOT NULL DEFAULT '',
            version_etiqueta VARCHAR(64) NOT NULL,
            version_sistema VARCHAR(64) NOT NULL DEFAULT '',
            contenido_resumen TEXT NOT NULL,
            contenido_hash CHAR(64) NOT NULL,
            estado ENUM('pendiente','parcial','autorizada','rechazada','invalidada') NOT NULL DEFAULT 'pendiente',
            solicitante_id INT NOT NULL,
            nombre_solicitante VARCHAR(255) NOT NULL DEFAULT '',
            ruta_documento VARCHAR(255) NOT NULL DEFAULT '',
            firma_consumida TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_sgc_firma_sol_estado (estado),
            INDEX idx_sgc_firma_sol_codigo (codigo, registro_clave),
            INDEX idx_sgc_firma_sol_hash (contenido_hash),
            INDEX idx_sgc_firma_sol_solicitante (solicitante_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_firmante (
            firmante_id INT AUTO_INCREMENT PRIMARY KEY,
            solicitud_id INT NOT NULL,
            usuario_id INT NOT NULL,
            zona_id INT NOT NULL DEFAULT 0,
            rol_etiqueta VARCHAR(120) NOT NULL DEFAULT '',
            orden_firma INT NOT NULL DEFAULT 1,
            estado ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
            observacion TEXT NULL,
            contenido_hash CHAR(64) NOT NULL DEFAULT '',
            imagen_drive_id VARCHAR(128) NOT NULL DEFAULT '',
            decidido_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_firma_firmante (solicitud_id, usuario_id, zona_id),
            INDEX idx_sgc_firma_firmante_usuario (usuario_id, estado),
            CONSTRAINT fk_sgc_firma_firmante_sol
                FOREIGN KEY (solicitud_id) REFERENCES sgc_firma_solicitud (solicitud_id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_auditoria (
            auditoria_id INT AUTO_INCREMENT PRIMARY KEY,
            solicitud_id INT NULL,
            usuario_id INT NOT NULL,
            accion VARCHAR(40) NOT NULL,
            detalle VARCHAR(1000) NOT NULL DEFAULT '',
            contenido_hash CHAR(64) NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sgc_firma_aud_sol (solicitud_id),
            INDEX idx_sgc_firma_aud_usuario (usuario_id),
            INDEX idx_sgc_firma_aud_accion (accion)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_personal (
            firma_id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL DEFAULT '',
            salt_b64 VARCHAR(64) NOT NULL DEFAULT '',
            iv_b64 VARCHAR(64) NOT NULL DEFAULT '',
            iteraciones INT NOT NULL DEFAULT 210000,
            tamano_bytes INT NOT NULL DEFAULT 0,
            estado ENUM('activa','revocada') NOT NULL DEFAULT 'activa',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_firma_personal_usuario (usuario_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnaImagenFirmante(poolSgc);
    await asegurarColumnaFirmaConsumida(poolSgc);
    await asegurarColumnaTamanoFirma(poolSgc);
    await asegurarColumnaTienePng(poolSgc);
    await asegurarTablaImagenDocumento(poolSgc);
    await asegurarTablaAvisosFirma(poolSgc);
    await sembrarZonas(poolSgc);
    tablasListas = true;
}

async function asegurarColumnaImagenFirmante(poolSgc) {
    const [cols] = await poolSgc.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'sgc_firma_firmante'
           AND COLUMN_NAME = 'imagen_drive_id'
         LIMIT 1`
    );
    if (cols?.length) return;
    await poolSgc.query(
        `ALTER TABLE sgc_firma_firmante
         ADD COLUMN imagen_drive_id VARCHAR(128) NOT NULL DEFAULT '' AFTER contenido_hash`
    );
}

async function asegurarColumnaFirmaConsumida(poolSgc) {
    const [cols] = await poolSgc.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'sgc_firma_solicitud'
           AND COLUMN_NAME = 'firma_consumida'
         LIMIT 1`
    );
    if (cols?.length) return;
    await poolSgc.query(
        `ALTER TABLE sgc_firma_solicitud
         ADD COLUMN firma_consumida TINYINT(1) NOT NULL DEFAULT 0 AFTER ruta_documento`
    );
}

async function asegurarColumnaTienePng(poolSgc) {
    const [cols] = await poolSgc.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'sgc_firma_firmante'
           AND COLUMN_NAME = 'tiene_png'
         LIMIT 1`
    );
    if (cols?.length) return;
    await poolSgc.query(
        `ALTER TABLE sgc_firma_firmante
         ADD COLUMN tiene_png TINYINT(1) NOT NULL DEFAULT 0 AFTER imagen_drive_id`
    );
}

async function asegurarTablaImagenDocumento(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_imagen (
            firmante_id INT NOT NULL PRIMARY KEY,
            png MEDIUMBLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function asegurarTablaAvisosFirma(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_firma_aviso (
            aviso_id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            solicitud_id INT NOT NULL,
            tipo VARCHAR(20) NOT NULL,
            codigo VARCHAR(64) NOT NULL DEFAULT '',
            nombre_documento VARCHAR(255) NOT NULL DEFAULT '',
            solicitado_por VARCHAR(255) NOT NULL DEFAULT '',
            resuelto_por VARCHAR(255) NOT NULL DEFAULT '',
            mensaje VARCHAR(500) NOT NULL DEFAULT '',
            ruta VARCHAR(255) NOT NULL DEFAULT '',
            descartado TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sgc_firma_aviso_user (usuario_id, descartado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function guardarImagenDocumento(executor, firmanteId, png) {
    await executor.query(
        `INSERT INTO sgc_firma_imagen (firmante_id, png)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE png = VALUES(png)`,
        [Number(firmanteId), png]
    );
}

async function insertarAvisoFirma(poolSgc, aviso) {
    try {
        await asegurarTablaAvisosFirma(poolSgc);
        const usuarioId = Math.round(Number(aviso.usuarioId));
        const solicitudId = Math.round(Number(aviso.solicitudId));
        const tipo = normalizarTexto(aviso.tipo, 20);
        if (!Number.isFinite(usuarioId) || usuarioId <= 0 || !Number.isFinite(solicitudId) || solicitudId <= 0 || !tipo) {
            console.warn('[SGC-FIRMA] aviso omitido: datos incompletos', {
                usuarioId: aviso.usuarioId,
                solicitudId: aviso.solicitudId,
                tipo: aviso.tipo
            });
            return;
        }
        const [previos] = await poolSgc.query(
            `SELECT aviso_id FROM sgc_firma_aviso
             WHERE usuario_id = ? AND solicitud_id = ? AND tipo = ?
             LIMIT 1`,
            [usuarioId, solicitudId, tipo]
        );
        if (previos?.length) return;
        await poolSgc.query(
            `INSERT INTO sgc_firma_aviso
                (usuario_id, solicitud_id, tipo, codigo, nombre_documento, solicitado_por, resuelto_por, mensaje, ruta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                usuarioId,
                solicitudId,
                tipo,
                normalizarTexto(aviso.codigo, 64),
                normalizarTexto(aviso.nombreDocumento, 255),
                normalizarTexto(aviso.solicitadoPor, 255),
                normalizarTexto(aviso.resueltoPor, 255),
                normalizarTexto(aviso.mensaje, 500),
                aviso.ruta || rutaSolicitud(solicitudId, tipo === 'solicitud' ? 'pendientes' : 'historial')
            ]
        );
    } catch (error) {
        console.warn('[SGC-FIRMA] No se pudo crear aviso popup:', error.message);
    }
}

async function sincronizarAvisosPendientes(poolSgc, usuarioId) {
    const pendientes = await pendientesDeUsuario(poolSgc, usuarioId);
    for (const row of pendientes || []) {
        await insertarAvisoFirma(poolSgc, {
            usuarioId,
            solicitudId: row.solicitud_id,
            tipo: 'solicitud',
            codigo: row.codigo,
            nombreDocumento: row.nombre_documento || row.codigo,
            solicitadoPor: row.nombre_solicitante || '',
            mensaje: `${row.nombre_solicitante || 'Alguien'} te pidió firmar ${row.codigo || 'un documento'}.`,
            ruta: rutaSolicitud(row.solicitud_id, 'pendientes')
        });
    }
}

async function sincronizarAvisosRespuesta(poolSgc, usuarioId) {
    const uid = Math.round(Number(usuarioId));
    if (!Number.isFinite(uid) || uid <= 0) return;
    const [rows] = await poolSgc.query(
        `SELECT solicitud_id, codigo, nombre_documento, estado, nombre_solicitante
         FROM sgc_firma_solicitud
         WHERE solicitante_id = ?
           AND estado IN ('autorizada', 'rechazada')
           AND updated_at >= (NOW() - INTERVAL 3 DAY)
         ORDER BY updated_at DESC
         LIMIT 8`,
        [uid]
    );
    for (const row of rows || []) {
        const tipo = row.estado === 'rechazada' ? 'rechazada' : 'aprobada';
        await insertarAvisoFirma(poolSgc, {
            usuarioId: uid,
            solicitudId: row.solicitud_id,
            tipo,
            codigo: row.codigo,
            nombreDocumento: row.nombre_documento || row.codigo,
            resueltoPor: '',
            mensaje: tipo === 'rechazada'
                ? 'La solicitud de firma fue rechazada.'
                : 'La solicitud de firma quedó aprobada.',
            ruta: rutaSolicitud(row.solicitud_id, tipo === 'rechazada' ? 'historial' : 'mias')
        });
    }
}

async function listarAvisosFirma(poolSgc, usuarioId) {
    await asegurarTablas(poolSgc);
    await asegurarTablaAvisosFirma(poolSgc);
    const uid = Math.round(Number(usuarioId));
    if (!Number.isFinite(uid) || uid <= 0) return [];
    await sincronizarAvisosPendientes(poolSgc, uid);
    await sincronizarAvisosRespuesta(poolSgc, uid);
    const [rows] = await poolSgc.query(
        `SELECT aviso_id, solicitud_id, tipo, codigo, nombre_documento, solicitado_por, resuelto_por, mensaje, ruta
         FROM sgc_firma_aviso
         WHERE usuario_id = ? AND descartado = 0
         ORDER BY
           CASE tipo
             WHEN 'solicitud' THEN 0
             WHEN 'rechazada' THEN 1
             WHEN 'aprobada' THEN 2
             ELSE 3
           END,
           aviso_id DESC
         LIMIT 20`,
        [uid]
    );
    return (rows || []).map((row) => ({
        id: Number(row.aviso_id),
        solicitudId: Number(row.solicitud_id),
        tipo: row.tipo || 'solicitud',
        codigo: row.codigo || '',
        nombreDocumento: row.nombre_documento || '',
        solicitadoPor: row.solicitado_por || '',
        resueltoPor: row.resuelto_por || '',
        mensaje: row.mensaje || '',
        ruta: row.ruta || '/sistema-gestion-calidad/firmas'
    }));
}

async function descartarAvisoFirma(poolSgc, avisoId, usuarioId) {
    await asegurarTablaAvisosFirma(poolSgc);
    const id = Number(avisoId);
    if (!Number.isInteger(id) || id <= 0) return false;
    await poolSgc.query(
        `UPDATE sgc_firma_aviso SET descartado = 1 WHERE aviso_id = ? AND usuario_id = ?`,
        [id, Number(usuarioId)]
    );
    return true;
}

async function descartarAvisosSolicitud(poolSgc, solicitudId, usuarioId = null, tipo = 'solicitud') {
    try {
        await asegurarTablaAvisosFirma(poolSgc);
        const sid = Math.round(Number(solicitudId));
        if (!Number.isFinite(sid) || sid <= 0) return;
        if (usuarioId != null) {
            await poolSgc.query(
                `UPDATE sgc_firma_aviso SET descartado = 1
                 WHERE solicitud_id = ? AND usuario_id = ? AND tipo = ? AND descartado = 0`,
                [sid, Math.round(Number(usuarioId)), tipo]
            );
            return;
        }
        await poolSgc.query(
            `UPDATE sgc_firma_aviso SET descartado = 1
             WHERE solicitud_id = ? AND tipo = ? AND descartado = 0`,
            [sid, tipo]
        );
    } catch (error) {
        console.warn('[SGC-FIRMA] No se pudieron cerrar avisos de solicitud:', error.message);
    }
}

async function asegurarColumnaTamanoFirma(poolSgc) {
    const [cols] = await poolSgc.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'sgc_firma_personal'
           AND COLUMN_NAME = 'tamano_bytes'
         LIMIT 1`
    );
    if (cols?.length) return;
    await poolSgc.query(
        `ALTER TABLE sgc_firma_personal
         ADD COLUMN tamano_bytes INT NOT NULL DEFAULT 0 AFTER iteraciones`
    );
}

async function sembrarZonas(poolSgc) {
    for (const zona of ZONAS_SEMILLA) {
        await poolSgc.query(
            `INSERT IGNORE INTO sgc_firma_zona
                (codigo_formato, tipo_formato, clave_zona, etiqueta, origen, confianza, firmas_requeridas, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                zona.codigo,
                zona.tipo,
                zona.clave,
                zona.etiqueta,
                zona.origen,
                zona.confianza,
                zona.firmas,
                zona.notas
            ]
        );
    }
}

async function auditar(executor, { solicitudId = null, usuarioId, accion, detalle = '', hash = '' }) {
    await executor.query(
        `INSERT INTO sgc_firma_auditoria (solicitud_id, usuario_id, accion, detalle, contenido_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [solicitudId, usuarioId, accion, normalizarTexto(detalle, 1000), String(hash || '').slice(0, 64)]
    );
}

async function notificar(pool, usuarioId, { tipo = 'info', titulo, mensaje, ruta }) {
    const uid = Number(usuarioId);
    if (!pool?.query || !Number.isInteger(uid) || uid <= 0) return;
    await pool.query(
        `INSERT INTO notificacion_usuario (usuario_id, tipo, icono, titulo, mensaje, ruta)
         VALUES (?, ?, 'fa-file-signature', ?, ?, ?)`,
        [uid, tipo, normalizarTexto(titulo, 255), normalizarTexto(mensaje, 1000), ruta || '/sistema-gestion-calidad/firmas']
    );
}

function rutaSolicitud(id, vista = 'pendientes') {
    return `/sistema-gestion-calidad/firmas?vista=${vista}&solicitud=${id}`;
}

async function nombresUsuarios(pool, ids) {
    const unicos = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    const mapa = new Map();
    if (!unicos.length || !pool?.query) return mapa;
    const [rows] = await pool.query(
        `SELECT id, nombre, apellido, username
         FROM usuario
         WHERE id IN (?)`,
        [unicos]
    );
    for (const row of rows || []) {
        const nombre = [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.username || `Usuario ${row.id}`;
        mapa.set(Number(row.id), nombre);
    }
    return mapa;
}

async function listarUsuariosInternos(pool) {
    const [rows] = await pool.query(
        `SELECT u.id, u.nombre, u.apellido, u.username, u.organigrama,
                LOWER(COALESCE(r.nombre_rol, '')) AS rol
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE u.activo = 1
           AND LOWER(COALESCE(r.nombre_rol, '')) <> 'empresa'
         ORDER BY u.nombre ASC, u.apellido ASC
         LIMIT 400`
    );
    return (rows || []).map((row) => ({
        id: Number(row.id),
        nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.username,
        username: row.username || '',
        puesto: row.organigrama || '',
        rol: row.rol || ''
    }));
}

async function listarZonas(poolSgc, codigo = '') {
    await asegurarTablas(poolSgc);
    const filtro = normalizarTexto(codigo, 64).toUpperCase();
    const [rows] = filtro
        ? await poolSgc.query(
            `SELECT * FROM sgc_firma_zona WHERE codigo_formato = ? ORDER BY zona_id ASC`,
            [filtro]
        )
        : await poolSgc.query(`SELECT * FROM sgc_firma_zona ORDER BY codigo_formato ASC, zona_id ASC`);
    return (rows || []).map(mapZona);
}

async function guardarZona(poolSgc, zonaId, body, usuarioId) {
    await asegurarTablas(poolSgc);
    const id = Number(zonaId);
    const [rows] = await poolSgc.query(`SELECT * FROM sgc_firma_zona WHERE zona_id = ? LIMIT 1`, [id]);
    const actual = rows?.[0];
    if (!actual) throw httpError(404, 'Zona de firma no encontrada');
    const coords = coordenadasCompletas(body || {});
    const firmas = Math.min(10, Math.max(1, Number(body?.firmasRequeridas) || Number(actual.firmas_requeridas) || 1));
    const confianza = coords.completa ? 'configurada' : (actual.confianza === 'configurada' ? 'pendiente' : actual.confianza);
    const responsable = Object.prototype.hasOwnProperty.call(body || {}, 'usuarioResponsableId')
        ? (body.usuarioResponsableId ? Number(body.usuarioResponsableId) : null)
        : actual.usuario_responsable_id;
    await poolSgc.query(
        `UPDATE sgc_firma_zona
         SET pagina = ?, pos_x = ?, pos_y = ?, ancho = ?, alto = ?,
             rol_responsable = ?, usuario_responsable_id = ?, firmas_requeridas = ?,
             confianza = ?, notas = ?, activo = ?
         WHERE zona_id = ?`,
        [
            coords.pagina,
            coords.posX,
            coords.posY,
            coords.ancho,
            coords.alto,
            normalizarTexto(body?.rolResponsable, 120),
            responsable,
            firmas,
            confianza,
            normalizarTexto(body?.notas ?? actual.notas, 2000),
            body?.activo === false ? 0 : 1,
            id
        ]
    );
    await auditar(poolSgc, {
        usuarioId,
        accion: 'configurar_zona',
        detalle: `${actual.codigo_formato} · ${actual.clave_zona}`,
        hash: ''
    });
    const [actualizadas] = await poolSgc.query(`SELECT * FROM sgc_firma_zona WHERE zona_id = ?`, [id]);
    return mapZona(actualizadas[0]);
}

async function crearZona(poolSgc, body, usuarioId) {
    await asegurarTablas(poolSgc);
    const codigo = normalizarTexto(body?.codigo, 64).toUpperCase();
    const clave = normalizarTexto(body?.clave, 64).toLowerCase().replace(/\s+/g, '_');
    const etiqueta = normalizarTexto(body?.etiqueta, 120);
    if (!codigo || !clave || !etiqueta) {
        throw httpError(400, 'Indica código, clave y etiqueta de la zona.');
    }
    const coords = coordenadasCompletas(body || {});
    const confianza = coords.completa ? 'configurada' : 'pendiente';
    try {
        const [result] = await poolSgc.query(
            `INSERT INTO sgc_firma_zona
                (codigo_formato, tipo_formato, clave_zona, etiqueta, pagina, pos_x, pos_y, ancho, alto,
                 rol_responsable, firmas_requeridas, origen, confianza, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
            [
                codigo,
                normalizarTexto(body?.tipoFormato, 64) || 'Formato',
                clave,
                etiqueta,
                coords.pagina,
                coords.posX,
                coords.posY,
                coords.ancho,
                coords.alto,
                normalizarTexto(body?.rolResponsable, 120),
                Math.min(10, Math.max(1, Number(body?.firmasRequeridas) || 1)),
                confianza,
                normalizarTexto(body?.notas, 2000)
            ]
        );
        await auditar(poolSgc, {
            usuarioId,
            accion: 'configurar_zona',
            detalle: `Alta ${codigo} · ${clave}`
        });
        const [rows] = await poolSgc.query(`SELECT * FROM sgc_firma_zona WHERE zona_id = ?`, [result.insertId]);
        return mapZona(rows[0]);
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            throw httpError(409, 'Esa zona ya existe para el documento.');
        }
        throw error;
    }
}

async function resolverAnclaDocumento(poolSgc, codigo) {
    const queries = [
        `SELECT drive_file_id AS id, '' AS version_sistema
         FROM sgc_formato_cabecera
         WHERE UPPER(TRIM(codigo_formato)) = ? LIMIT 1`,
        `SELECT drive_file_id_actual AS id, CAST(version_actual AS CHAR) AS version_sistema
         FROM sgc_formatos_descarga_activo
         WHERE UPPER(TRIM(codigo)) = ? LIMIT 1`
    ];
    for (const sql of queries) {
        try {
            const [rows] = await poolSgc.query(sql, [codigo]);
            const id = sanitizarDriveId(rows?.[0]?.id);
            if (id) {
                return {
                    driveFileId: id,
                    versionSistema: normalizarTexto(rows?.[0]?.version_sistema, 64)
                };
            }
        } catch (_error) {
            /* la tabla puede no existir en algún entorno */
        }
    }
    return { driveFileId: '', versionSistema: '' };
}

async function adjuntarFirmantes(poolSgc, pool, solicitudes) {
    if (!solicitudes.length) return [];
    const ids = solicitudes.map((s) => s.solicitud_id);
    const [rows] = await poolSgc.query(
        `SELECT * FROM sgc_firma_firmante WHERE solicitud_id IN (?) ORDER BY orden_firma ASC, firmante_id ASC`,
        [ids]
    );
    const nombres = await nombresUsuarios(pool, (rows || []).map((r) => r.usuario_id));
    const porSolicitud = new Map();
    for (const row of rows || []) {
        const item = mapFirmante({ ...row, nombre_firmante: nombres.get(Number(row.usuario_id)) || '' });
        const lista = porSolicitud.get(item.solicitud_id) || [];
        lista.push(item);
        porSolicitud.set(item.solicitud_id, lista);
    }
    return solicitudes.map((row) => mapSolicitud(row, porSolicitud.get(Number(row.solicitud_id)) || []));
}

async function obtenerFila(poolSgc, solicitudId, conn = null) {
    const executor = conn || poolSgc;
    const [rows] = await executor.query(
        `SELECT * FROM sgc_firma_solicitud WHERE solicitud_id = ? LIMIT 1`,
        [Number(solicitudId)]
    );
    return rows?.[0] || null;
}

function puedeVer(solicitud, usuarioId, esGestor, firmantes) {
    if (esGestor) return true;
    if (Number(solicitud.solicitante_id) === Number(usuarioId)) return true;
    return (firmantes || []).some((f) => Number(f.usuario_id || f.usuarioId) === Number(usuarioId));
}

async function listar(poolSgc, pool, { usuarioId, esGestor, vista }) {
    await asegurarTablas(poolSgc);
    const uid = Number(usuarioId);
    let rows;
    if (vista === 'pendientes') {
        [rows] = await poolSgc.query(
            `SELECT DISTINCT s.*
             FROM sgc_firma_solicitud s
             INNER JOIN sgc_firma_firmante f ON f.solicitud_id = s.solicitud_id
             WHERE f.usuario_id = ?
               AND f.estado = 'pendiente'
               AND s.estado IN ('pendiente', 'parcial')
             ORDER BY s.created_at DESC
             LIMIT 200`,
            [uid]
        );
    } else if (vista === 'historial') {
        const sql = esGestor
            ? `SELECT * FROM sgc_firma_solicitud
               WHERE estado IN ('autorizada','rechazada','invalidada','parcial')
               ORDER BY updated_at DESC LIMIT 200`
            : `SELECT DISTINCT s.*
               FROM sgc_firma_solicitud s
               LEFT JOIN sgc_firma_firmante f ON f.solicitud_id = s.solicitud_id
               WHERE s.estado IN ('autorizada','rechazada','invalidada','parcial')
                 AND (s.solicitante_id = ? OR f.usuario_id = ?)
               ORDER BY s.updated_at DESC
               LIMIT 200`;
        [rows] = esGestor
            ? await poolSgc.query(sql)
            : await poolSgc.query(sql, [uid, uid]);
    } else {
        [rows] = await poolSgc.query(
            `SELECT * FROM sgc_firma_solicitud
             WHERE solicitante_id = ?
             ORDER BY created_at DESC
             LIMIT 200`,
            [uid]
        );
    }
    return adjuntarFirmantes(poolSgc, pool, rows || []);
}

async function obtenerDetalle(poolSgc, pool, solicitudId, usuarioId, esGestor) {
    await asegurarTablas(poolSgc);
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila) throw httpError(404, 'Solicitud no encontrada');
    const items = await adjuntarFirmantes(poolSgc, pool, [fila]);
    const solicitud = items[0];
    if (!solicitud) throw httpError(404, 'Solicitud no encontrada');
    if (!puedeVer(fila, usuarioId, esGestor, solicitud.firmantes)) {
        throw httpError(403, 'No puedes consultar esta solicitud.');
    }
    await auditar(poolSgc, {
        solicitudId: solicitud.solicitud_id,
        usuarioId,
        accion: 'consultar',
        detalle: solicitud.codigo,
        hash: solicitud.contenido_hash
    });
    const [aud] = await poolSgc.query(
        `SELECT auditoria_id, solicitud_id, usuario_id, accion, detalle, contenido_hash, created_at
         FROM sgc_firma_auditoria
         WHERE solicitud_id = ?
         ORDER BY auditoria_id DESC
         LIMIT 40`,
        [solicitud.solicitud_id]
    );
    const nombres = await nombresUsuarios(pool, (aud || []).map((a) => a.usuario_id));
    solicitud.auditoria = (aud || []).map((a) => ({
        ...a,
        auditoria_id: Number(a.auditoria_id),
        usuario_id: Number(a.usuario_id),
        nombre: nombres.get(Number(a.usuario_id)) || ''
    }));
    return solicitud;
}

async function usuariosActivos(pool, ids) {
    const unicos = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!unicos.length) return new Set();
    const [rows] = await pool.query(
        `SELECT u.id
         FROM usuario u
         LEFT JOIN roles r ON u.rol_id = r.rol_id
         WHERE u.activo = 1
           AND u.id IN (?)
           AND LOWER(COALESCE(r.nombre_rol, '')) <> 'empresa'`,
        [unicos]
    );
    return new Set((rows || []).map((r) => Number(r.id)));
}

async function crearSolicitud({ poolSgc, pool, usuarioId, nombreSolicitante, body }) {
    await asegurarTablas(poolSgc);
    const codigo = normalizarTexto(body?.codigo, 64).toUpperCase();
    const nombre = normalizarTexto(body?.nombreDocumento, 500);
    const desdeFormato = body?.origen === 'version-firmada';
    let version = normalizarTexto(body?.version, 64);
    let resumen = normalizarTexto(body?.resumen, 4000);
    let registro = normalizarTexto(body?.registroClave, 120).toUpperCase() || codigo;
    if (desdeFormato) {
        version = version || codigo;
        registro = claveDocumento(body?.rutaDocumento) || codigo;
        if (resumen.length < 10) resumen = `Autorización de firma del documento ${codigo}.`;
    }
    if (!codigo || !nombre) throw httpError(400, 'Selecciona un documento del SGC.');
    if (!version) throw httpError(400, 'Indica la versión exacta que se va a autorizar.');
    if (resumen.length < 10) {
        throw httpError(400, 'Describe la versión que se autoriza (al menos 10 caracteres).');
    }
    let firmantesIn = Array.isArray(body?.firmantes) ? body.firmantes : [];
    const zonas = await listarZonas(poolSgc, codigo);
    if (desdeFormato) {
        const primera = (zonas || []).find((z) => z.activo && z.confianza === 'identificado');
        if (primera) {
            firmantesIn = firmantesIn.map((f) => ({
                ...f,
                zonaId: Number(f.zonaId) || primera.zona_id,
                rol: f.rol || primera.etiqueta
            }));
        }
    }
    const errores = validarAsignacion(zonas, firmantesIn, { exigirZonas: !desdeFormato });
    if (errores.length) throw httpError(400, errores[0]);

    const ancla = await resolverAnclaDocumento(poolSgc, codigo);
    const hash = huellaVersion({
        codigo,
        registro,
        version,
        versionSistema: ancla.versionSistema,
        driveFileId: ancla.driveFileId,
        resumen
    });

    const [vigentes] = await poolSgc.query(
        `SELECT solicitud_id, contenido_hash, estado
         FROM sgc_firma_solicitud
         WHERE codigo = ? AND registro_clave = ? AND estado IN ('pendiente','parcial','autorizada')
           AND COALESCE(firma_consumida, 0) = 0`,
        [codigo, registro]
    );
    if ((vigentes || []).some((row) => row.contenido_hash === hash)) {
        throw httpError(409, 'Ya existe una solicitud vigente para esta misma versión.');
    }
    const aInvalidar = (vigentes || []).filter((row) => row.contenido_hash !== hash);

    const idsFirmantes = firmantesIn.map((f) => Number(f.usuarioId));
    const activos = await usuariosActivos(pool, idsFirmantes);
    if (idsFirmantes.some((id) => !activos.has(id))) {
        throw httpError(400, 'Uno de los firmantes no es un usuario interno activo.');
    }
    const zonasValidas = new Set(zonas.filter((z) => z.activo).map((z) => z.zona_id));
    for (const f of firmantesIn) {
        const zonaId = Number(f.zonaId) || 0;
        if (zonaId && !zonasValidas.has(zonaId)) {
            throw httpError(400, 'La zona indicada no pertenece a este documento.');
        }
    }

    const conn = await poolSgc.getConnection();
    let solicitudId = 0;
    try {
        await conn.beginTransaction();
        for (const previa of aInvalidar) {
            await conn.query(
                `UPDATE sgc_firma_solicitud SET estado = 'invalidada' WHERE solicitud_id = ?`,
                [previa.solicitud_id]
            );
            await auditar(conn, {
                solicitudId: previa.solicitud_id,
                usuarioId,
                accion: 'invalidar',
                detalle: 'Sustituida por una solicitud de otra versión',
                hash: previa.contenido_hash
            });
        }
        const [insert] = await conn.query(
            `INSERT INTO sgc_firma_solicitud
                (codigo, nombre_documento, tipo_documento, registro_clave, drive_file_id,
                 version_etiqueta, version_sistema, contenido_resumen, contenido_hash,
                 estado, solicitante_id, nombre_solicitante, ruta_documento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
            [
                codigo,
                nombre,
                normalizarTexto(body?.tipoDocumento, 64),
                registro,
                ancla.driveFileId,
                version,
                ancla.versionSistema,
                resumen,
                hash,
                usuarioId,
                normalizarTexto(nombreSolicitante, 255),
                sanitizarRutaDocumento(body?.rutaDocumento)
            ]
        );
        solicitudId = insert.insertId;
        let orden = 1;
        for (const f of firmantesIn) {
            await conn.query(
                `INSERT INTO sgc_firma_firmante
                    (solicitud_id, usuario_id, zona_id, rol_etiqueta, orden_firma)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    solicitudId,
                    Number(f.usuarioId),
                    Number(f.zonaId) || 0,
                    normalizarTexto(f.rol, 120),
                    orden
                ]
            );
            orden += 1;
        }
        await auditar(conn, {
            solicitudId,
            usuarioId,
            accion: 'solicitar',
            detalle: `${codigo} · versión ${version}`,
            hash
        });
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    for (const previa of aInvalidar) {
        const detallePrevio = await obtenerDetalleSinAuditar(poolSgc, pool, previa.solicitud_id);
        const destinatarios = new Set([
            detallePrevio?.solicitante_id,
            ...(detallePrevio?.firmantes || []).map((f) => f.usuario_id)
        ]);
        for (const destino of destinatarios) {
            if (Number(destino) === Number(usuarioId)) continue;
            await notificar(pool, destino, {
                tipo: 'warning',
                titulo: `Autorización invalidada: ${codigo}`,
                mensaje: 'El documento cambió de versión. La autorización anterior ya no aplica.',
                ruta: rutaSolicitud(previa.solicitud_id, 'historial')
            });
        }
    }

    for (const firmante of firmantesIn) {
        if (Number(firmante.usuarioId) === Number(usuarioId)) continue;
        await insertarAvisoFirma(poolSgc, {
            usuarioId: firmante.usuarioId,
            solicitudId,
            tipo: 'solicitud',
            codigo,
            nombreDocumento: nombre,
            solicitadoPor: nombreSolicitante,
            mensaje: `${nombreSolicitante || 'Alguien'} te pidió firmar ${codigo}.`,
            ruta: rutaSolicitud(solicitudId, 'pendientes')
        });
    }

    return obtenerDetalleSinAuditar(poolSgc, pool, solicitudId);
}

async function obtenerDetalleSinAuditar(poolSgc, pool, solicitudId) {
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila) return null;
    const items = await adjuntarFirmantes(poolSgc, pool, [fila]);
    return items[0] || null;
}

async function decidir({ poolSgc, pool, solicitudId, usuarioId, decision, observacion, firmaPng }) {
    await asegurarTablas(poolSgc);
    if (decision !== 'aprobada' && decision !== 'rechazada') {
        throw httpError(400, 'Decisión no válida.');
    }
    const nota = normalizarTexto(observacion, 2000);
    if (decision === 'rechazada' && nota.length < 3) {
        throw httpError(400, 'Escribe una observación para el rechazo.');
    }
    const png = decision === 'aprobada' ? leerPng(firmaPng) : null;

    const conn = await poolSgc.getConnection();
    let resultado = null;
    let solicitanteId = 0;
    let codigo = '';
    let hash = '';
    let otrosPendientes = [];
    try {
        await conn.beginTransaction();
        const [bloqueadas] = await conn.query(
            `SELECT * FROM sgc_firma_solicitud WHERE solicitud_id = ? FOR UPDATE`,
            [Number(solicitudId)]
        );
        const solicitud = bloqueadas?.[0];
        if (!solicitud) throw httpError(404, 'Solicitud no encontrada');
        if (!ESTADOS_SOLICITUD.has(solicitud.estado) || !['pendiente', 'parcial'].includes(solicitud.estado)) {
            throw httpError(409, 'Esta solicitud ya no admite autorización.');
        }
        const [firmantes] = await conn.query(
            `SELECT * FROM sgc_firma_firmante WHERE solicitud_id = ? FOR UPDATE`,
            [solicitud.solicitud_id]
        );
        const propio = (firmantes || []).find(
            (f) => Number(f.usuario_id) === Number(usuarioId) && f.estado === 'pendiente'
        );
        if (!propio) {
            throw httpError(403, 'Solo un firmante pendiente asignado puede resolver esta solicitud.');
        }
        let imagenId = '';
        if (png) {
            await guardarImagenDocumento(conn, propio.firmante_id, png);
        }
        await conn.query(
            `UPDATE sgc_firma_firmante
             SET estado = ?, observacion = ?, contenido_hash = ?, imagen_drive_id = '', tiene_png = ?, decidido_at = NOW()
             WHERE firmante_id = ? AND estado = 'pendiente'`,
            [decision, nota, solicitud.contenido_hash, png ? 1 : 0, propio.firmante_id]
        );
        const actualizados = (firmantes || []).map((f) => (
            Number(f.firmante_id) === Number(propio.firmante_id)
                ? { ...f, estado: decision }
                : f
        ));
        const estado = estadoSolicitudDesdeFirmantes(actualizados, solicitud.estado);
        await conn.query(
            `UPDATE sgc_firma_solicitud SET estado = ? WHERE solicitud_id = ?`,
            [estado, solicitud.solicitud_id]
        );
        await auditar(conn, {
            solicitudId: solicitud.solicitud_id,
            usuarioId,
            accion: decision === 'aprobada' ? 'aprobar' : 'rechazar',
            detalle: nota || solicitud.codigo,
            hash: solicitud.contenido_hash
        });
        solicitanteId = Number(solicitud.solicitante_id);
        codigo = solicitud.codigo;
        hash = solicitud.contenido_hash;
        otrosPendientes = actualizados
            .filter((f) => f.estado === 'pendiente' && Number(f.usuario_id) !== Number(usuarioId))
            .map((f) => Number(f.usuario_id));
        resultado = estado;
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    const vista = resultado === 'pendiente' || resultado === 'parcial' ? 'pendientes' : 'historial';
    const ruta = rutaSolicitud(solicitudId, vista);
    if (solicitanteId && solicitanteId !== Number(usuarioId)) {
        await notificar(pool, solicitanteId, {
            tipo: resultado === 'autorizada' ? 'success' : (decision === 'rechazada' ? 'danger' : 'info'),
            titulo: resultado === 'autorizada'
                ? `Documento autorizado: ${codigo}`
                : (decision === 'rechazada' ? `Firma rechazada: ${codigo}` : `Firma registrada: ${codigo}`),
            mensaje: resultado === 'autorizada'
                ? 'Todas las firmas requeridas quedaron registradas para esa versión.'
                : (nota || 'Hay un movimiento en la solicitud de firma.'),
            ruta
        });
    }
    if (decision === 'rechazada') {
        for (const destino of otrosPendientes) {
            await notificar(pool, destino, {
                tipo: 'warning',
                titulo: `Solicitud rechazada: ${codigo}`,
                mensaje: nota || 'Otro firmante rechazó la solicitud.',
                ruta: rutaSolicitud(solicitudId, 'historial')
            });
        }
    }
    if (resultado === 'autorizada') {
        const detalle = await obtenerDetalleSinAuditar(poolSgc, pool, solicitudId);
        const destinatarios = new Set((detalle?.firmantes || []).map((f) => f.usuario_id));
        for (const destino of destinatarios) {
            if (Number(destino) === Number(usuarioId)) continue;
            await notificar(pool, destino, {
                tipo: 'success',
                titulo: `Firmas completas: ${codigo}`,
                mensaje: 'La versión solicitada quedó autorizada por todos los firmantes.',
                ruta
            });
        }
    }
    await descartarAvisosSolicitud(poolSgc, solicitudId, usuarioId, 'solicitud');
    const nombres = await nombresUsuarios(pool, [usuarioId]);
    const quien = nombres.get(Number(usuarioId)) || 'Un firmante';
    const detalleFinal = await obtenerDetalleSinAuditar(poolSgc, pool, solicitudId);
    const nombreDoc = detalleFinal?.nombre_documento || codigo;
    if (solicitanteId) {
        if (decision === 'rechazada') {
            await insertarAvisoFirma(poolSgc, {
                usuarioId: solicitanteId,
                solicitudId,
                tipo: 'rechazada',
                codigo,
                nombreDocumento: nombreDoc,
                solicitadoPor: '',
                resueltoPor: quien,
                mensaje: nota || `${quien} rechazó la solicitud de firma.`,
                ruta: rutaSolicitud(solicitudId, 'historial')
            });
        } else if (resultado === 'autorizada') {
            await insertarAvisoFirma(poolSgc, {
                usuarioId: solicitanteId,
                solicitudId,
                tipo: 'aprobada',
                codigo,
                nombreDocumento: nombreDoc,
                solicitadoPor: '',
                resueltoPor: quien,
                mensaje: `${quien} aprobó la firma. Ya puedes imprimir el documento.`,
                ruta: rutaSolicitud(solicitudId, 'mias')
            });
        } else if (decision === 'aprobada') {
            await insertarAvisoFirma(poolSgc, {
                usuarioId: solicitanteId,
                solicitudId,
                tipo: 'aprobada',
                codigo,
                nombreDocumento: nombreDoc,
                solicitadoPor: '',
                resueltoPor: quien,
                mensaje: `${quien} registró su firma. Aún faltan otros firmantes.`,
                ruta: rutaSolicitud(solicitudId, 'mias')
            });
        }
    }
    return detalleFinal;
}

async function invalidarSolicitud({ poolSgc, pool, solicitudId, usuarioId, esGestor, motivo }) {
    await asegurarTablas(poolSgc);
    const nota = normalizarTexto(motivo, 1000);
    if (nota.length < 3) throw httpError(400, 'Indica por qué queda invalidada la autorización.');
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila) throw httpError(404, 'Solicitud no encontrada');
    const esSolicitante = Number(fila.solicitante_id) === Number(usuarioId);
    if (!esSolicitante && !esGestor) {
        throw httpError(403, 'Solo quien solicitó la firma, o un gestor del SGC, puede invalidarla.');
    }
    if (!ESTADOS_VIGENTES.has(fila.estado)) {
        throw httpError(409, 'Esta solicitud ya no está vigente.');
    }
    await poolSgc.query(
        `UPDATE sgc_firma_solicitud SET estado = 'invalidada' WHERE solicitud_id = ?`,
        [fila.solicitud_id]
    );
    await auditar(poolSgc, {
        solicitudId: fila.solicitud_id,
        usuarioId,
        accion: 'invalidar',
        detalle: nota,
        hash: fila.contenido_hash
    });
    const detalle = await obtenerDetalleSinAuditar(poolSgc, pool, fila.solicitud_id);
    const destinatarios = new Set([
        detalle?.solicitante_id,
        ...(detalle?.firmantes || []).map((f) => f.usuario_id)
    ]);
    for (const destino of destinatarios) {
        if (Number(destino) === Number(usuarioId)) continue;
        await notificar(pool, destino, {
            tipo: 'warning',
            titulo: `Autorización invalidada: ${fila.codigo}`,
            mensaje: nota,
            ruta: rutaSolicitud(fila.solicitud_id, 'historial')
        });
    }
    return obtenerDetalleSinAuditar(poolSgc, pool, fila.solicitud_id);
}

async function pendientesDeUsuario(poolSgc, usuarioId) {
    if (!poolSgc?.query) return [];
    try {
        await asegurarTablas(poolSgc);
    } catch (_error) {
        return [];
    }
    const [rows] = await poolSgc.query(
        `SELECT s.solicitud_id, s.codigo, s.nombre_documento, s.nombre_solicitante, s.version_etiqueta
         FROM sgc_firma_solicitud s
         INNER JOIN sgc_firma_firmante f ON f.solicitud_id = s.solicitud_id
         WHERE f.usuario_id = ?
           AND f.estado = 'pendiente'
           AND s.estado IN ('pendiente', 'parcial')
         ORDER BY s.created_at DESC
         LIMIT 20`,
        [Number(usuarioId)]
    );
    return rows || [];
}

function leerCifrado(body) {
    const salt = Buffer.from(String(body?.salt || ''), 'base64');
    const iv = Buffer.from(String(body?.iv || ''), 'base64');
    const cifrado = Buffer.from(String(body?.cifrado || ''), 'base64');
    const iteraciones = Number(body?.iteraciones);
    if (salt.length !== 16 || iv.length !== 12) {
        throw httpError(400, 'El cifrado de la firma no trae sal o vector válidos.');
    }
    if (!cifrado.length || cifrado.length > 2200000) {
        throw httpError(400, 'La imagen de la firma debe pesar menos de 2 MB.');
    }
    if (!Number.isInteger(iteraciones) || iteraciones < 100000 || iteraciones > 1000000) {
        throw httpError(400, 'La derivación de la contraseña no es válida.');
    }
    return { salt, iv, cifrado, iteraciones };
}

async function estadoFirmaPersonal(poolSgc, usuarioId) {
    await asegurarTablas(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT estado, drive_file_id, created_at, updated_at, tamano_bytes
         FROM sgc_firma_personal WHERE usuario_id = ? LIMIT 1`,
        [Number(usuarioId)]
    );
    const row = rows?.[0];
    const activa = row && row.estado === 'activa' && String(row.drive_file_id || '').length > 0;
    return {
        tieneFirma: !!activa,
        estado: activa ? 'activa' : (row?.estado || 'sin_firma'),
        creada: row?.created_at || null,
        actualizada: row?.updated_at || null,
        tamano: Number(row?.tamano_bytes) || 0
    };
}

async function guardarFirmaPersonal(poolSgc, usuarioId, body) {
    await asegurarTablas(poolSgc);
    const pack = leerCifrado(body);
    const tamano = Math.min(Math.max(Math.round(Number(body?.tamano) || 0), 0), 2200000);
    const drive = require('./driveService');
    const subido = await drive.subirArchivoPrivado(
        pack.cifrado,
        `firma-usuario-${usuarioId}-${Date.now()}.bin`,
        'application/octet-stream',
        CARPETA_FIRMAS_DRIVE
    );
    const fileId = String(subido?.id || '').trim();
    if (!fileId) throw httpError(502, 'Drive no devolvió el archivo cifrado.');
    const [previas] = await poolSgc.query(
        `SELECT drive_file_id FROM sgc_firma_personal WHERE usuario_id = ? LIMIT 1`,
        [Number(usuarioId)]
    );
    const anterior = String(previas?.[0]?.drive_file_id || '');
    await poolSgc.query(
        `INSERT INTO sgc_firma_personal
            (usuario_id, drive_file_id, salt_b64, iv_b64, iteraciones, tamano_bytes, estado)
         VALUES (?, ?, ?, ?, ?, ?, 'activa')
         ON DUPLICATE KEY UPDATE
            drive_file_id = VALUES(drive_file_id),
            salt_b64 = VALUES(salt_b64),
            iv_b64 = VALUES(iv_b64),
            iteraciones = VALUES(iteraciones),
            tamano_bytes = VALUES(tamano_bytes),
            estado = 'activa'`,
        [Number(usuarioId), fileId, pack.salt.toString('base64'), pack.iv.toString('base64'), pack.iteraciones, tamano]
    );
    if (anterior && anterior !== fileId) {
        try { await drive.eliminarArchivo(anterior); } catch (_error) { /* el archivo viejo puede ya no existir */ }
    }
    await auditar(poolSgc, {
        usuarioId,
        accion: 'registrar_firma',
        detalle: 'Firma personal cifrada guardada'
    });
    return estadoFirmaPersonal(poolSgc, usuarioId);
}

async function obtenerCifradoPropio(poolSgc, usuarioId) {
    await asegurarTablas(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT drive_file_id, salt_b64, iv_b64, iteraciones, estado
         FROM sgc_firma_personal WHERE usuario_id = ? LIMIT 1`,
        [Number(usuarioId)]
    );
    const row = rows?.[0];
    if (!row || row.estado !== 'activa' || !row.drive_file_id) {
        throw httpError(404, 'No tienes una firma activa.');
    }
    const drive = require('./driveService');
    const buffer = await drive.descargarArchivo(row.drive_file_id);
    return {
        cifrado: Buffer.from(buffer).toString('base64'),
        salt: row.salt_b64,
        iv: row.iv_b64,
        iteraciones: Number(row.iteraciones) || 210000
    };
}

async function revocarFirmaPersonal(poolSgc, usuarioId) {
    await asegurarTablas(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT drive_file_id FROM sgc_firma_personal WHERE usuario_id = ? LIMIT 1`,
        [Number(usuarioId)]
    );
    const fileId = String(rows?.[0]?.drive_file_id || '');
    await poolSgc.query(
        `UPDATE sgc_firma_personal
         SET estado = 'revocada', drive_file_id = '', salt_b64 = '', iv_b64 = ''
         WHERE usuario_id = ?`,
        [Number(usuarioId)]
    );
    if (fileId) {
        try { await require('./driveService').eliminarArchivo(fileId); } catch (_error) { /* ya no está en Drive */ }
    }
    await auditar(poolSgc, {
        usuarioId,
        accion: 'revocar_firma',
        detalle: 'Firma personal revocada'
    });
    return estadoFirmaPersonal(poolSgc, usuarioId);
}

function leerPng(valor) {
    const limpio = String(valor || '').replace(/^data:image\/png;base64,/i, '').replace(/\s/g, '');
    const buffer = Buffer.from(limpio, 'base64');
    if (!buffer.length || buffer.length > 1400000) {
        throw httpError(400, 'La firma debe ser un PNG de menos de 1.4 MB.');
    }
    const firma = buffer.toString('ascii', 1, 4);
    if (buffer[0] !== 0x89 || firma !== 'PNG') {
        throw httpError(400, 'La firma tiene que ser un archivo PNG.');
    }
    return buffer;
}

async function subirPngFirma(buffer, nombre) {
    const drive = require('./driveService');
    const subido = await drive.subirArchivoPrivado(buffer, nombre, 'image/png', CARPETA_FIRMAS_DRIVE);
    const fileId = String(subido?.id || '').trim();
    if (!fileId) throw httpError(502, 'Drive no guardó la firma del documento.');
    return fileId;
}

async function documentoAutorizado(poolSgc, pool, { codigo, ruta, usuarioId, esGestor }) {
    await asegurarTablas(poolSgc);
    const clave = claveDocumento(ruta);
    const codigoNorm = normalizarTexto(codigo, 64).toUpperCase();
    const rutaNorm = sanitizarRutaDocumento(ruta);
    const rutaSinQuery = sanitizarRutaDocumento(String(ruta || '').split('?')[0]);
    if (!codigoNorm || !clave) return null;
    const [rows] = await poolSgc.query(
        `SELECT * FROM sgc_firma_solicitud
         WHERE codigo = ?
           AND estado IN ('pendiente','parcial','autorizada')
           AND (
             registro_clave = ?
             OR (registro_clave = ? AND ruta_documento IN (?, ?))
           )
         ORDER BY solicitud_id DESC
         LIMIT 1`,
        [codigoNorm, clave, codigoNorm, rutaNorm, rutaSinQuery]
    );
    const fila = rows?.[0];
    if (!fila) return null;
    const items = await adjuntarFirmantes(poolSgc, pool, [fila]);
    const solicitud = items[0];
    if (!solicitud) return null;
    if (!puedeVer(fila, usuarioId, esGestor, solicitud.firmantes)) {
        throw httpError(403, 'No puedes consultar la firma de este documento.');
    }
    return solicitud;
}

async function prepararImpresion({ poolSgc, solicitudId, usuarioId, firmaPng }) {
    await asegurarTablas(poolSgc);
    const png = leerPng(firmaPng);
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila || fila.estado !== 'autorizada') {
        throw httpError(409, 'Este documento todavía no está autorizado.');
    }
    const [rows] = await poolSgc.query(
        `SELECT * FROM sgc_firma_firmante
         WHERE solicitud_id = ? AND usuario_id = ? AND estado = 'aprobada'
         ORDER BY firmante_id ASC LIMIT 1`,
        [Number(solicitudId), Number(usuarioId)]
    );
    const propio = rows?.[0];
    if (!propio) throw httpError(403, 'Solo quien autorizó puede preparar su firma para imprimir.');
    if (!Number(propio.tiene_png) && !String(propio.imagen_drive_id || '')) {
        await guardarImagenDocumento(poolSgc, propio.firmante_id, png);
        await poolSgc.query(
            `UPDATE sgc_firma_firmante SET tiene_png = 1, imagen_drive_id = '' WHERE firmante_id = ?`,
            [propio.firmante_id]
        );
    }
    return true;
}

async function imagenesImpresion({ poolSgc, pool, solicitudId, usuarioId, esGestor }) {
    await asegurarTablas(poolSgc);
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila) throw httpError(404, 'Solicitud no encontrada');
    const items = await adjuntarFirmantes(poolSgc, pool, [fila]);
    const solicitud = items[0];
    if (!solicitud || !puedeVer(fila, usuarioId, esGestor, solicitud.firmantes)) {
        throw httpError(403, 'No puedes imprimir este documento.');
    }
    if (fila.estado !== 'autorizada') {
        throw httpError(409, 'El documento todavía no está autorizado.');
    }
    const aprobados = (solicitud.firmantes || []).filter((f) => f.estado === 'aprobada');
    if (!aprobados.length || aprobados.some((f) => !f.tiene_imagen)) {
        throw httpError(409, 'Falta preparar la firma para impresión.');
    }
    const [crudos] = await poolSgc.query(
        `SELECT firmante_id, usuario_id, rol_etiqueta, imagen_drive_id, tiene_png
         FROM sgc_firma_firmante
         WHERE solicitud_id = ? AND estado = 'aprobada'
         ORDER BY orden_firma ASC, firmante_id ASC`,
        [fila.solicitud_id]
    );
    const imagenes = [];
    const drive = require('./driveService');
    for (const row of crudos || []) {
        let buffer = null;
        if (Number(row.tiene_png) === 1) {
            const [guardadas] = await poolSgc.query(
                `SELECT png FROM sgc_firma_imagen WHERE firmante_id = ? LIMIT 1`,
                [row.firmante_id]
            );
            buffer = guardadas?.[0]?.png || null;
        } else if (row.imagen_drive_id) {
            buffer = await drive.descargarArchivo(row.imagen_drive_id);
        }
        if (!buffer) continue;
        imagenes.push({
            usuarioId: Number(row.usuario_id),
            rol: row.rol_etiqueta || 'Firmante',
            png: Buffer.from(buffer).toString('base64')
        });
    }
    if (!imagenes.length) throw httpError(409, 'No hay una firma PNG lista para imprimir.');
    await auditar(poolSgc, {
        solicitudId: fila.solicitud_id,
        usuarioId,
        accion: 'imprimir',
        detalle: fila.codigo,
        hash: fila.contenido_hash
    });
    return imagenes;
}

function sinAcentos(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function ubicarZonaFirma(pdfBuffer) {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(pdfBuffer),
        disableWorker: true,
        isEvalSupported: false
    }).promise;
    const prioridades = ['autorizo', 'solicito', 'firmante', 'firma del responsable', 'elaboro', 'reviso', 'aprobo'];
    const hallados = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const contenido = await page.getTextContent();
        for (const item of contenido.items || []) {
            const texto = sinAcentos(item.str).trim();
            if (!texto || texto.length > 48) continue;
            const prioridad = prioridades.findIndex((pista) => texto.includes(pista));
            if (prioridad < 0) continue;
            hallados.push({
                prioridad,
                page: n,
                x: Number(item.transform?.[4]) || 0,
                y: Number(item.transform?.[5]) || 0,
                alto: Number(item.height) || 12,
                pageHeight: viewport.height
            });
        }
    }
    hallados.sort((a, b) => a.prioridad - b.prioridad || b.y - a.y);
    return hallados[0] || null;
}

async function estamparPngEnPdf(pdfBuffer, pngBuffer) {
    const { PDFDocument } = require('pdf-lib');
    const ancla = await ubicarZonaFirma(pdfBuffer);
    if (!ancla) {
        throw httpError(409, 'El PDF no trae un apartado de firma (Autorizó, Solicitó o Firmante).');
    }
    const pdf = await PDFDocument.load(pdfBuffer);
    const png = await pdf.embedPng(pngBuffer);
    const pagina = pdf.getPages()[ancla.page - 1];
    const escala = Math.min(150 / png.width, 46 / png.height, 1);
    const ancho = png.width * escala;
    const alto = png.height * escala;
    let y = ancla.y + (ancla.alto || 12) + 8;
    const tope = (ancla.pageHeight || pagina.getHeight()) - alto - 10;
    if (y > tope) y = Math.max(10, ancla.y - alto - 6);
    pagina.drawImage(png, { x: ancla.x, y, width: ancho, height: alto });
    return Buffer.from(await pdf.save());
}

async function pdfConFirma({ poolSgc, pool, solicitudId, usuarioId, esGestor }) {
    const imagenes = await imagenesImpresion({ poolSgc, pool, solicitudId, usuarioId, esGestor });
    const fila = await obtenerFila(poolSgc, solicitudId);
    const codigo = String(fila?.codigo || '').toUpperCase();
    if (codigo !== 'SGC-F-27') {
        throw httpError(409, 'Este formato todavía no imprime el PDF de Drive. La orden de compra sí.');
    }
    const pdf = await require('./sgcF27Service').descargarPlantillaPdf(poolSgc);
    const png = Buffer.from(String(imagenes[0]?.png || ''), 'base64');
    if (!png.length) throw httpError(409, 'No hay una firma PNG lista para imprimir.');
    return estamparPngEnPdf(pdf, png);
}

async function consumirFirma({ poolSgc, pool, solicitudId, usuarioId, esGestor }) {
    await asegurarTablas(poolSgc);
    const fila = await obtenerFila(poolSgc, solicitudId);
    if (!fila) throw httpError(404, 'Solicitud no encontrada');
    const items = await adjuntarFirmantes(poolSgc, pool, [fila]);
    const solicitud = items[0];
    if (!solicitud || !puedeVer(fila, usuarioId, esGestor, solicitud.firmantes)) {
        throw httpError(403, 'No puedes consumir la firma de este documento.');
    }
    if (Number(fila.firma_consumida) === 1) return true;
    const [firmantes] = await poolSgc.query(
        `SELECT firmante_id FROM sgc_firma_firmante WHERE solicitud_id = ?`,
        [fila.solicitud_id]
    );
    const ids = (firmantes || []).map((f) => Number(f.firmante_id)).filter((id) => id > 0);
    if (ids.length) {
        await poolSgc.query(`DELETE FROM sgc_firma_imagen WHERE firmante_id IN (?)`, [ids]);
    }
    await poolSgc.query(
        `UPDATE sgc_firma_firmante SET imagen_drive_id = '', tiene_png = 0 WHERE solicitud_id = ?`,
        [fila.solicitud_id]
    );
    await poolSgc.query(
        `UPDATE sgc_firma_solicitud SET firma_consumida = 1 WHERE solicitud_id = ?`,
        [fila.solicitud_id]
    );
    await auditar(poolSgc, {
        solicitudId: fila.solicitud_id,
        usuarioId,
        accion: 'consumir_firma',
        detalle: 'La firma se retiró de esta solicitud tras la impresión',
        hash: fila.contenido_hash
    });
    return true;
}

module.exports = {
    asegurarTablas,
    listarUsuariosInternos,
    listarZonas,
    guardarZona,
    crearZona,
    listar,
    obtenerDetalle,
    crearSolicitud,
    decidir,
    invalidarSolicitud,
    pendientesDeUsuario,
    estadoFirmaPersonal,
    guardarFirmaPersonal,
    obtenerCifradoPropio,
    revocarFirmaPersonal,
    documentoAutorizado,
    prepararImpresion,
    imagenesImpresion,
    pdfConFirma,
    consumirFirma,
    listarAvisosFirma,
    descartarAvisoFirma,
    huellaVersion,
    estadoSolicitudDesdeFirmantes,
    validarAsignacion,
    sanitizarRutaDocumento,
    ZONAS_SEMILLA
};
