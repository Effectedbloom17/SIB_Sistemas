#!/usr/bin/env node
/**
 * Crea la BD sensores (local o producción) y la tabla de lecturas.
 *   node scripts/setup-sensores-db.js
 *   node scripts/setup-sensores-db.js --produccion
 */
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { asegurarTablasSensores } = require('../sensoresHistorialService');

const usarProduccion = process.argv.includes('--produccion');
const envFile = usarProduccion ? '.env.produccion' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile), quiet: true });

const host = usarProduccion
    ? (process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL)
    : (process.env.DB_HOST_LOCAL || '127.0.0.1');
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER;
const password = process.env.DB_PASS;
const database = process.env.DB_NAME_SENSORES || (usarProduccion ? 'ou9c93ce6l5d_sensores' : 'sensores');

async function main() {
    if (!user) {
        throw new Error(`Falta DB_USER en ${envFile}`);
    }

    console.log(`Creando BD ${database} en ${host}:${port} (${usarProduccion ? 'produccion' : 'local'})...`);
    const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        connectTimeout: 20000
    });

    try {
        try {
            await conn.query(
                `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
            );
        } catch (err) {
            const msg = String(err?.message || '');
            if (!/access denied/i.test(msg)) throw err;
            console.warn('CREATE DATABASE no permitido (cPanel). Se usará la base ya creada.');
        }
        await conn.query(`USE \`${database}\``);
        await asegurarTablasSensores(conn);
        console.log(`OK: ${database}.sensor_cisterna_lectura lista`);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('ERROR:', err.message);
    if (/access denied|create database/i.test(err.message)) {
        console.error('');
        console.error('En cPanel cree la base con el prefijo de la cuenta (ej. ou9c93ce6l5d_sensores),');
        console.error('asígnela al usuario de Biznaga y vuelva a ejecutar:');
        console.error('  node backend/scripts/setup-sensores-db.js --produccion');
    }
    process.exit(1);
});
