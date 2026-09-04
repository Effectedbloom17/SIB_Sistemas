/**
 * Prepara o finaliza el ciclo de tickets para deploy.
 * Uso:
 *   node scripts/ticketsCiclo.js preparar [version]
 *   node scripts/ticketsCiclo.js finalizar [version]
 *
 * Por defecto usa .env del backend. Para producción remota se ejecuta
 * finalizar vía SSH en el servidor tras un deploy exitoso.
 */
const path = require('path');
const mysql = require('mysql2/promise');

const modo = String(process.argv[2] || '').trim().toLowerCase();
const versionArg = String(process.argv[3] || '').trim();

if (!['preparar', 'finalizar'].includes(modo)) {
    console.error('Uso: node scripts/ticketsCiclo.js <preparar|finalizar> [version]');
    process.exit(1);
}

const ENV_FILE = process.env.ENV_FILE || '.env';
require('dotenv').config({
    path: path.join(__dirname, '..', ENV_FILE),
    quiet: true
});

const ticketsService = require('../ticketsService');

/** En local: package.json raíz. En servidor solo existe backend/ + app-version.json. */
function resolveVersion() {
    if (versionArg) return versionArg;
    try {
        return require('../../package.json').version;
    } catch (_) {
        try {
            return require('../app-version.json').version;
        } catch (__) {
            console.error('No se pudo resolver la version (pase [version] o empaquete app-version.json).');
            process.exit(1);
        }
    }
}

const version = resolveVersion();

async function main() {
    const host =
        process.env.DB_HOST ||
        (process.env.NODE_ENV === 'production'
            ? (process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL)
            : (process.env.DB_HOST_LOCAL || process.env.DB_HOST_REMOTE)) ||
        '127.0.0.1';

    const pool = mysql.createPool({
        host,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME || 'biznaga',
        waitForConnections: true,
        connectionLimit: 2
    });

    try {
        await ticketsService.asegurarTabla(pool);
        if (modo === 'preparar') {
            const res = await ticketsService.prepararCicloEnArchivo(pool, version);
            console.log(`[TICKETS] Preparados ${res.preparados} ticket(s) → historial v${res.version}`);
        } else {
            const res = await ticketsService.finalizarCiclo(pool, version);
            console.log(
                `[TICKETS] Ciclo publicado v${res.version}: ${res.ticketsPublicados} ticket(s), ` +
                `${res.notificacionesEliminadas} notificación(es) de aportaciones eliminadas`
            );
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('[TICKETS] Error:', err.message || err);
    process.exit(1);
});
