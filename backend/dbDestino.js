'use strict';

const mysql = require('mysql2/promise');

const CODIGOS_AUTENTICACION = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ER_DBACCESS_DENIED_ERROR',
    'ER_ACCESS_DENIED_NO_PASSWORD_ERROR'
]);

function timeoutMs() {
    const valor = Number(process.env.DB_CONNECT_TIMEOUT_MS);
    return Number.isFinite(valor) && valor >= 1000 ? valor : 4000;
}

function puerto(valor, respaldo) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : respaldo;
}

function credenciales(userKey, passKey) {
    const user = String(process.env[userKey] || process.env.DB_USER || '').trim();
    const passPropio = process.env[passKey];
    const password = passPropio != null && String(passPropio) !== ''
        ? String(passPropio)
        : String(process.env.DB_PASS || '');
    return { user, password };
}

/**
 * Orden de desarrollo:
 *   1. Principal  — DB_HOST_LAN (IP ya configurada) y su puerto
 *   2. Secundario — 192.168.1.171:3307
 *   3. Local      — 127.0.0.1 y DB_PORT_LOCAL (contenedor Docker, 3307)
 *   4. Producción — DB_HOST_REMOTE, solo si las tres anteriores no aceptan conexión
 *
 * Con NODE_ENV=production o DB_PREFER=remote se usa únicamente producción.
 */
function candidatos() {
    const prefer = String(process.env.DB_PREFER || '').trim().toLowerCase();
    const soloProduccion = process.env.NODE_ENV === 'production' || prefer === 'remote';
    const cred = credenciales('DB_USER', 'DB_PASS');
    const credLocal = credenciales('DB_USER_LOCAL', 'DB_PASS_LOCAL');

    const produccion = {
        rol: 'produccion',
        etiqueta: 'BD: PRODUCCIÓN',
        host: String(process.env.DB_HOST_REMOTE || '').trim(),
        port: puerto(process.env.DB_PORT_REMOTE || process.env.DB_PORT, 3306),
        user: cred.user,
        password: cred.password
    };

    if (soloProduccion) {
        return produccion.host ? [produccion] : [];
    }

    const lista = [
        {
            rol: 'principal',
            etiqueta: 'BD: PRINCIPAL',
            host: String(process.env.DB_HOST_LAN || '').trim(),
            port: puerto(process.env.DB_PORT_LAN || process.env.DB_PORT, 3306),
            user: cred.user,
            password: cred.password
        },
        {
            rol: 'secundaria',
            etiqueta: 'BD: SECUNDARIA',
            host: String(process.env.DB_HOST_SECUNDARIO || '192.168.1.171').trim(),
            port: puerto(process.env.DB_PORT_SECUNDARIO, 3307),
            user: cred.user,
            password: cred.password
        },
        {
            rol: 'local',
            etiqueta: 'BD: LOCAL',
            host: String(process.env.DB_HOST_LOCAL || '127.0.0.1').trim(),
            port: puerto(process.env.DB_PORT_LOCAL, 3307),
            user: credLocal.user,
            password: credLocal.password
        },
        produccion
    ];

    return lista.filter((c) => c.host);
}

function esAutenticacion(error) {
    const code = String(error?.code || '');
    if (CODIGOS_AUTENTICACION.has(code)) return true;
    return /access denied/i.test(String(error?.message || ''));
}

async function probar(candidato) {
    const espera = timeoutMs();
    let conn = null;
    try {
        conn = await mysql.createConnection({
            host: candidato.host,
            port: candidato.port,
            user: candidato.user,
            password: candidato.password,
            connectTimeout: espera
        });
        await conn.query('SELECT 1');
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            auth: esAutenticacion(error),
            code: String(error?.code || ''),
            message: error?.message || String(error)
        };
    } finally {
        if (conn) {
            try { await conn.end(); } catch (_e) { /* ignore */ }
        }
    }
}

let destinoActual = null;
let seleccionPromise = null;

async function ejecutarSeleccion() {
    const lista = candidatos();
    if (!lista.length) {
        const error = new Error('No existen bases de datos disponibles.');
        error.code = 'DB_SIN_DESTINO';
        error.statusCode = 503;
        throw error;
    }

    for (const candidato of lista) {
        const resultado = await probar(candidato);
        if (resultado.ok) {
            destinoActual = {
                rol: candidato.rol,
                etiqueta: candidato.etiqueta,
                host: candidato.host,
                port: candidato.port,
                user: candidato.user,
                password: candidato.password
            };
            console.log(`[DB] Servidor seleccionado: ${candidato.etiqueta} (${candidato.host}:${candidato.port})`);
            return destinoActual;
        }

        const motivo = resultado.auth ? 'autenticación rechazada' : 'sin conectividad';
        console.warn(
            `[DB] ${candidato.etiqueta} ${candidato.host}:${candidato.port} no disponible (${motivo}).`
        );
    }

    destinoActual = null;
    const error = new Error('No existen bases de datos disponibles.');
    error.code = 'DB_SIN_DESTINO';
    error.statusCode = 503;
    throw error;
}

function seleccionarDestino() {
    if (!seleccionPromise) {
        seleccionPromise = ejecutarSeleccion().catch((error) => {
            destinoActual = null;
            seleccionPromise = null;
            console.error(`[DB] ${error.message}`);
            throw error;
        });
    }
    return seleccionPromise;
}

function invalidarDestino() {
    destinoActual = null;
    seleccionPromise = null;
}

function getDestino() {
    return destinoActual;
}

function estadoPublico() {
    if (!destinoActual) {
        return { conectado: false, rol: 'sin_conexion', etiqueta: 'BD: SIN CONEXIÓN' };
    }
    return {
        conectado: true,
        rol: destinoActual.rol,
        etiqueta: destinoActual.etiqueta
    };
}

module.exports = {
    seleccionarDestino,
    invalidarDestino,
    getDestino,
    estadoPublico,
    candidatos
};
