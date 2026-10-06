/**
 * Quita el registro de prueba NC-220926-01 (Lorem Ipsum) de SGC-F-04 y SGC-F-05
 * en desarrollo (LAN o local) y en producción.
 *
 * Uso: node backend/scripts/borrar-nc-220926-01.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const net = require('net');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');

const envDevPath = path.join(__dirname, '..', '.env');
const envProdPath = path.join(__dirname, '..', '.env.produccion');
const envDev = dotenv.parse(fs.readFileSync(envDevPath));
const envProd = dotenv.parse(fs.readFileSync(fs.existsSync(envProdPath) ? envProdPath : envDevPath));
dotenv.config({ path: envDevPath, quiet: true });

const { obtenerRegistroSgcPersistido, asegurarTablaSgcFormatoDatos, resetAsegurarTablasSgcFlag } = require('../sgcDgF05Service');
const sgcF04 = require('../sgcSgcF04Service');
const sgcF05 = require('../sgcF05Service');

const FOLIO = 'NC-220926-01';

function folioNorm(v) {
  return String(v || '').trim().toUpperCase();
}

function esElRegistro(item) {
  if (folioNorm(item?.folio) !== FOLIO) return false;
  const desc = String(item?.descripcion || item?.descripcionNc || '').toLowerCase();
  return desc.includes('lorem ipsum');
}

function puedeConectar(host, port, timeoutMs = 4000) {
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

function crearPool(env, host, port) {
  return mysql.createPool(buildMysqlPoolOptions({
    host,
    port: Number(port) || 3306,
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME_SGC || 'biznaga_sgc',
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

  const reg04 = await obtenerRegistroSgcPersistido(pool, 'SGC-F-04');
  const datos04 = parseDatos(reg04) || { reportes: [] };
  const reportesAntes = Array.isArray(datos04.reportes) ? datos04.reportes : [];
  const quitados04 = reportesAntes.filter(esElRegistro).map((r) => folioNorm(r.folio));
  if (quitados04.length) {
    await sgcF04.guardarFormato(pool, {
      datos: { ...datos04, reportes: reportesAntes.filter((r) => !esElRegistro(r)) },
      origen: 'sistema'
    });
  }

  const reg05 = await obtenerRegistroSgcPersistido(pool, 'SGC-F-05');
  const datos05 = parseDatos(reg05) || { registros: [] };
  const regsAntes = Array.isArray(datos05.registros) ? datos05.registros : [];
  const coincidencias = regsAntes.filter((r) => folioNorm(r?.folio) === FOLIO);
  const quitados05 = coincidencias.filter(esElRegistro);
  if (quitados05.length) {
    await sgcF05.guardarFormato(pool, {
      datos: { ...datos05, registros: regsAntes.filter((r) => !esElRegistro(r)) },
      origen: 'sistema'
    });
  }

  const ver05 = parseDatos(await obtenerRegistroSgcPersistido(pool, 'SGC-F-05'));
  const resto = (ver05?.registros || []).filter(esElRegistro);
  console.log(`[${etiqueta}] F-04 quitados: ${quitados04.length} · F-05 quitados: ${quitados05.length} · restantes: ${resto.length}`);
  if (coincidencias.length && !quitados05.length) {
    console.log(`[${etiqueta}] El folio existe, pero la descripción no es el texto de prueba. No se borró.`);
  }
  if (resto.length) {
    throw new Error(`[${etiqueta}] El registro de prueba sigue en la bitácora`);
  }
}

(async () => {
  const destinos = [];
  const devPort = Number(envDev.DB_PORT_LAN || envDev.DB_PORT || 3306);
  const localPort = Number(envDev.DB_PORT_LOCAL || envDev.DB_PORT || 3306);
  if (await puedeConectar(envDev.DB_HOST_LAN, devPort)) {
    destinos.push({ etiqueta: 'DESARROLLO', env: envDev, host: envDev.DB_HOST_LAN, port: devPort });
  } else if (await puedeConectar(envDev.DB_HOST_LOCAL, localPort)) {
    destinos.push({ etiqueta: 'DESARROLLO', env: envDev, host: envDev.DB_HOST_LOCAL, port: localPort });
  } else {
    throw new Error('No hay conexión a la base de desarrollo');
  }

  if (!fs.existsSync(envProdPath)) {
    console.log('PRODUCCIÓN omitida: falta backend/.env.produccion');
  } else {
    const prodHost = envProd.DB_HOST_REMOTE || envProd.DB_HOST;
    const prodPort = Number(envProd.DB_PORT_REMOTE || envProd.DB_PORT || 3306);
    if (!(await puedeConectar(prodHost, prodPort))) {
      throw new Error(`No se puede conectar a producción (${prodHost}:${prodPort})`);
    }
    destinos.push({ etiqueta: 'PRODUCCIÓN', env: envProd, host: prodHost, port: prodPort });
  }

  for (const dest of destinos) {
    console.log(`Conectando ${dest.etiqueta}: ${dest.host}:${dest.port}`);
    const pool = crearPool(dest.env, dest.host, dest.port);
    try {
      await borrarEn(pool, dest.etiqueta);
    } finally {
      await pool.end();
    }
  }
  console.log('Listo.');
})().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
