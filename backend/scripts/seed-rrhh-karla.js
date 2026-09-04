/**
 * Seed one-shot: crea tabla + ejemplo Karla + hoja en Google Sheets.
 * Uso: node scripts/seed-rrhh-karla.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');
const net = require('net');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');
const rrhh = require('../rrhhResidentesService');

function puedeConectarLocal(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!host) return resolve(false);
    const socket = new net.Socket();
    const done = (ok) => {
      try { socket.destroy(); } catch (_) { /* */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(port) || 3306, host);
  });
}

(async () => {
  const localHost = process.env.DB_HOST_LOCAL;
  const remoteHost = process.env.DB_HOST_REMOTE;
  const port = Number(process.env.DB_PORT || 3306);
  const isLocal = await puedeConectarLocal(localHost, port);
  const host = isLocal ? localHost : remoteHost;

  console.log(`Conectando a ${host}:${port} (${isLocal ? 'local' : 'remoto'})…`);

  const pool = mysql.createPool(buildMysqlPoolOptions({
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 2
  }));

  try {
    console.log('Sembrando residente de ejemplo…');
    const r = await rrhh.seedEjemploSiVacio(pool);
    console.log(JSON.stringify({
      id: r.id,
      nombre: r.nombre,
      drive_sheet_title: r.drive_sheet_title,
      drive_sheet_gid: r.drive_sheet_gid,
      editor_url: r.editor_url
    }, null, 2));
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
