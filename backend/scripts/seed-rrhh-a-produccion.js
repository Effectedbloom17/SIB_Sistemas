/**
 * Copia residentes activos de desarrollo (local) a producción (GoDaddy).
 * Uso: node scripts/seed-rrhh-a-produccion.js
 *
 * Origen:  backend/.env → DB_HOST_LOCAL
 * Destino: backend/.env.produccion → DB_HOST_REMOTE / DB_USER / DB_NAME
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const net = require('net');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');

const envDev = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env')));
const envProd = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.produccion')));

// Drive y servicios usan el .env de desarrollo (OAuth local).
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const rrhh = require('../rrhhResidentesService');

const CAMPOS = [
  'anio', 'nombre', 'edad', 'estancia', 'escuela_procedencia', 'carrera',
  'fecha_ingreso', 'fecha_terminacion', 'nombre_proyecto', 'supervision_a_cargo',
  'telefono', 'correo_personal', 'correo_institucional', 'matricula',
  'asesor_academico', 'correo_asesor', 'tutor_nombre', 'tutor_telefono',
  'direccion', 'nss', 'foto_url'
];

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

function payloadDesdeFila(row) {
  const out = {};
  for (const c of CAMPOS) {
    out[c] = row[c] == null ? (c === 'foto_url' ? null : '') : row[c];
  }
  if (out.anio != null) out.anio = Number(out.anio);
  if (out.edad != null && out.edad !== '') out.edad = Number(out.edad);
  return out;
}

(async () => {
  const localHost = envDev.DB_HOST_LOCAL;
  const localPort = Number(envDev.DB_PORT || 3306);
  const remoteHost = envProd.DB_HOST_REMOTE || envProd.DB_HOST_LOCAL;
  const remotePort = Number(envProd.DB_PORT || 3306);

  if (!localHost || !remoteHost) {
    throw new Error('Faltan hosts en .env / .env.produccion');
  }

  const okLocal = await puedeConectar(localHost, localPort);
  const okRemote = await puedeConectar(remoteHost, remotePort);
  if (!okLocal) throw new Error(`No se puede conectar a desarrollo (${localHost}:${localPort})`);
  if (!okRemote) throw new Error(`No se puede conectar a producción (${remoteHost}:${remotePort})`);

  console.log(`Origen (dev):   ${localHost}:${localPort} / ${envDev.DB_NAME} / ${envDev.DB_USER}`);
  console.log(`Destino (prod): ${remoteHost}:${remotePort} / ${envProd.DB_NAME} / ${envProd.DB_USER}`);

  const poolDev = mysql.createPool(buildMysqlPoolOptions({
    host: localHost,
    port: localPort,
    user: envDev.DB_USER,
    password: envDev.DB_PASS,
    database: envDev.DB_NAME,
    connectionLimit: 2
  }));

  const poolProd = mysql.createPool(buildMysqlPoolOptions({
    host: remoteHost,
    port: remotePort,
    user: envProd.DB_USER,
    password: envProd.DB_PASS,
    database: envProd.DB_NAME,
    connectionLimit: 2
  }));

  try {
    await rrhh.asegurarTabla(poolProd);

    const [rows] = await poolDev.query(
      `SELECT * FROM RRHH_residentes WHERE activo = 1 ORDER BY anio DESC, nombre ASC, id ASC`
    );
    console.log(`Residentes activos en desarrollo: ${(rows || []).length}`);

    const resultados = [];
    for (const row of rows || []) {
      const datos = payloadDesdeFila(row);
      const [exist] = await poolProd.query(
        `SELECT id FROM RRHH_residentes
         WHERE activo = 1 AND UPPER(TRIM(nombre)) = UPPER(TRIM(?))
         LIMIT 1`,
        [datos.nombre]
      );

      let residente;
      let accion;
      if (exist?.length) {
        residente = await rrhh.actualizar(poolProd, exist[0].id, datos, 'seed-prod-rrhh');
        accion = 'actualizado';
      } else {
        residente = await rrhh.crear(poolProd, datos, 'seed-prod-rrhh');
        accion = 'creado';
      }

      resultados.push({
        accion,
        id: residente.id,
        nombre: residente.nombre,
        matricula: residente.matricula,
        drive_sheet_title: residente.drive_sheet_title
      });
      console.log(`✓ ${accion}: ${residente.nombre} (id=${residente.id})`);
    }

    console.log('\nResumen producción:');
    console.log(JSON.stringify(resultados, null, 2));
  } finally {
    await poolDev.end();
    await poolProd.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
