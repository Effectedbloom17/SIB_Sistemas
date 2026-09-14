/**
 * Elimina reportes de ejemplo NC-060826-02 y NC-060826-03
 * de SGC-F-04 (reportes) y SGC-F-05 (bitácora) en desarrollo y/o producción.
 *
 * Uso:
 *   node scripts/borrar-nc-ejemplo-f04-f05.js
 *   node scripts/borrar-nc-ejemplo-f04-f05.js --prod-only
 *   node scripts/borrar-nc-ejemplo-f04-f05.js --dev-only
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const net = require('net');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');
const { obtenerRegistroSgcPersistido, asegurarTablaSgcFormatoDatos, resetAsegurarTablasSgcFlag } = require('../sgcDgF05Service');
const sgcF04 = require('../sgcSgcF04Service');
const sgcF05 = require('../sgcF05Service');

const envDevPath = path.join(__dirname, '..', '.env');
const envProdPath = path.join(__dirname, '..', '.env.produccion');
const envDev = dotenv.parse(fs.readFileSync(envDevPath));
const envProd = dotenv.parse(
  fs.readFileSync(fs.existsSync(envProdPath) ? envProdPath : envDevPath)
);

dotenv.config({ path: envDevPath, quiet: true });

const FOLIOS = new Set(['NC-060826-02', 'NC-060826-03']);
const args = new Set(process.argv.slice(2));
const soloProd = args.has('--prod-only');
const soloDev = args.has('--dev-only');
if (soloProd && soloDev) {
  throw new Error('Usa solo uno: --prod-only o --dev-only');
}

function folioNorm(v) {
  return String(v || '').trim().toUpperCase();
}

function puedeConectar(host, port, timeoutMs = 2500) {
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

function crearPool(env, hostKey) {
  const host = env[hostKey] || env.DB_HOST_REMOTE || env.DB_HOST_LOCAL;
  return mysql.createPool(buildMysqlPoolOptions({
    host,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME_SGC || env.DB_NAME,
    connectionLimit: 2
  }));
}

function parseDatos(registro) {
  if (!registro?.datos_json) return null;
  try {
    return typeof registro.datos_json === 'string'
      ? JSON.parse(registro.datos_json)
      : registro.datos_json;
  } catch {
    return null;
  }
}

async function borrarEn(pool, etiqueta) {
  resetAsegurarTablasSgcFlag();
  await asegurarTablaSgcFormatoDatos(pool);

  // 1) SGC-F-04 — quitar reportes (si no, la sync F-04→F-05 los reintroduciría como conservados)
  const reg04 = await obtenerRegistroSgcPersistido(pool, 'SGC-F-04');
  const datos04 = parseDatos(reg04) || { reportes: [] };
  const reportesAntes = Array.isArray(datos04.reportes) ? datos04.reportes : [];
  const quitados04 = reportesAntes
    .filter((r) => FOLIOS.has(folioNorm(r?.folio)))
    .map((r) => folioNorm(r.folio));
  const reportesDespues = reportesAntes.filter((r) => !FOLIOS.has(folioNorm(r?.folio)));

  if (quitados04.length) {
    await sgcF04.guardarFormato(pool, {
      datos: { ...datos04, reportes: reportesDespues },
      origen: 'sistema'
    });
  }

  // 2) SGC-F-05 — quitar de la bitácora sin pasar por cargarFormato (evita re-sync raro)
  const reg05 = await obtenerRegistroSgcPersistido(pool, 'SGC-F-05');
  const datos05 = parseDatos(reg05) || { registros: [] };
  const regsAntes = Array.isArray(datos05.registros) ? datos05.registros : [];
  const quitados05 = regsAntes
    .filter((r) => FOLIOS.has(folioNorm(r?.folio)))
    .map((r) => folioNorm(r.folio));
  const regsDespues = regsAntes.filter((r) => !FOLIOS.has(folioNorm(r?.folio)));

  if (quitados05.length) {
    await sgcF05.guardarFormato(pool, {
      datos: { ...datos05, registros: regsDespues },
      origen: 'sistema'
    });
  }

  // Verificación
  const ver04 = parseDatos(await obtenerRegistroSgcPersistido(pool, 'SGC-F-04'));
  const ver05 = parseDatos(await obtenerRegistroSgcPersistido(pool, 'SGC-F-05'));
  const resto04 = (ver04?.reportes || []).filter((r) => FOLIOS.has(folioNorm(r?.folio)));
  const resto05 = (ver05?.registros || []).filter((r) => FOLIOS.has(folioNorm(r?.folio)));

  console.log(`\n[${etiqueta}]`);
  console.log(`  F-04 quitados: ${quitados04.length ? quitados04.join(', ') : '(ninguno)'}`);
  console.log(`  F-05 quitados: ${quitados05.length ? quitados05.join(', ') : '(ninguno)'}`);
  console.log(`  F-04 restantes objetivo: ${resto04.length}`);
  console.log(`  F-05 restantes objetivo: ${resto05.length}`);

  if (resto04.length || resto05.length) {
    throw new Error(`[${etiqueta}] Aún quedan folios objetivo en BD`);
  }

  return { quitados04, quitados05 };
}

(async () => {
  const localHost = envDev.DB_HOST_LOCAL;
  const localPort = Number(envDev.DB_PORT || 3306);
  const remoteHost = envProd.DB_HOST_REMOTE || envProd.DB_HOST_LOCAL;
  const remotePort = Number(envProd.DB_PORT || 3306);

  if ((!soloProd && !localHost) || (!soloDev && !remoteHost)) {
    throw new Error('Faltan hosts en .env / .env.produccion');
  }

  const okLocal = soloProd ? true : await puedeConectar(localHost, localPort);
  const okRemote = soloDev ? true : await puedeConectar(remoteHost, remotePort);
  if (!soloProd && !okLocal) throw new Error(`No se puede conectar a desarrollo (${localHost}:${localPort})`);
  if (!soloDev && !okRemote) throw new Error(`No se puede conectar a producción (${remoteHost}:${remotePort})`);

  console.log(`Folios a borrar: ${[...FOLIOS].join(', ')}`);
  if (!soloProd) {
    console.log(`Dev:  ${localHost}:${localPort} / ${envDev.DB_NAME_SGC || envDev.DB_NAME}`);
  }
  if (!soloDev) {
    console.log(`Prod: ${remoteHost}:${remotePort} / ${envProd.DB_NAME_SGC || envProd.DB_NAME}`);
  }

  if (!soloProd) {
    const poolDev = crearPool(envDev, 'DB_HOST_LOCAL');
    try {
      await borrarEn(poolDev, 'DESARROLLO');
    } finally {
      await poolDev.end();
    }
  }

  if (!soloDev) {
    const poolProd = crearPool(envProd, 'DB_HOST_REMOTE');
    try {
      await borrarEn(poolProd, 'PRODUCCIÓN');
    } finally {
      await poolProd.end();
    }
  }

  console.log('\nListo.');
  process.exit(0);
})().catch((err) => {
  console.error('\nError:', err.message || err);
  process.exit(1);
});
