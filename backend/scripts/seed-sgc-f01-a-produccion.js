/**
 * Publica el catálogo SGC-F-01 en desarrollo y/o producción.
 * - Quita SGC-DI-06 / SP-P-08 del listado.
 * - Documentos externos sin código (limpia EXT-01… generados antes).
 *
 * Uso:
 *   node scripts/seed-sgc-f01-a-produccion.js
 *   node scripts/seed-sgc-f01-a-produccion.js --prod-only
 *   node scripts/seed-sgc-f01-a-produccion.js --dev-only
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
const envProd = dotenv.parse(
  fs.readFileSync(fs.existsSync(envProdPath) ? envProdPath : envDevPath)
);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const sgcF01 = require('../sgcSgcF01Service');
const { asegurarTablaSgcFormatoDatos, resetAsegurarTablasSgcFlag } = require('../sgcDgF05Service');

const EXCLUIDOS = new Set(['SGC-DI-06', 'SP-P-08']);
const args = new Set(process.argv.slice(2));
const soloProd = args.has('--prod-only');
const soloDev = args.has('--dev-only');
if (soloProd && soloDev) {
  throw new Error('Usa solo uno: --prod-only o --dev-only');
}

function resumenExternos(documentos = []) {
  return (documentos || [])
    .filter((d) => String(d.tipoDocumento || '').toLowerCase() === 'externo'
      || /externo/i.test(String(d.especie || '')))
    .map((d) => ({
      codigo: String(d.codigo || '').trim() || '(sin código)',
      nombre: d.nombreDocumento
    }));
}

function codigosExtPersistidos(documentos = []) {
  return (documentos || [])
    .map((d) => String(d.codigo || '').trim().toUpperCase())
    .filter((c) => /^EXT-\d+$/.test(c));
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

async function publicarEn(pool, etiqueta) {
  resetAsegurarTablasSgcFlag();
  await asegurarTablaSgcFormatoDatos(pool);

  const [tablas] = await pool.query("SHOW TABLES LIKE 'sgc_formato_cabecera'");
  if (!tablas.length) {
    throw new Error(`[${etiqueta}] No existe sgc_formato_cabecera tras asegurarTabla`);
  }

  const actual = await sgcF01.cargarFormato(pool);
  const docsPrevios = actual?.datos?.documentos || [];
  const quitados = docsPrevios
    .filter((d) => EXCLUIDOS.has(String(d.codigo || '').toUpperCase()))
    .map((d) => d.codigo);

  const extAntes = resumenExternos(docsPrevios);
  const extCodigosAntes = codigosExtPersistidos(docsPrevios);

  const docsLimpios = (docsPrevios.length ? docsPrevios : sgcF01.CATALOGO_BASE)
    .filter((d) => !EXCLUIDOS.has(String(d.codigo || '').toUpperCase()));

  const porClave = new Map();
  for (const d of docsLimpios) {
    const codigo = String(d.codigo || '').trim().toUpperCase();
    const nombre = String(d.nombreDocumento || '').trim().toLowerCase();
    if (codigo) porClave.set(`c:${codigo}`, d);
    if (nombre) porClave.set(`n:${nombre}`, d);
  }
  const documentos = sgcF01.CATALOGO_BASE.map((base) => {
    const codigo = String(base.codigo || '').trim().toUpperCase();
    const nombre = String(base.nombreDocumento || '').trim().toLowerCase();
    const prev = (codigo && porClave.get(`c:${codigo}`))
      || (nombre && porClave.get(`n:${nombre}`))
      || null;
    if (!prev) return { ...base };
    return {
      ...base,
      ...prev,
      codigo: base.codigo,
      especie: prev.especie || base.especie
    };
  });

  const payload = await sgcF01.guardarFormato(pool, {
    datos: {
      revision: actual?.datos?.revision || '00',
      fechaRevision: actual?.datos?.fechaRevision || '2024-08-01',
      fechaElaboracion: actual?.datos?.fechaElaboracion || '2024-08-01',
      documentos
    }
  });

  const n = payload?.datos?.documentos?.length || 0;
  const [cnt] = await pool.query(
    "SELECT COUNT(*) AS n FROM sgc_formato_campos WHERE codigo_formato='SGC-F-01'"
  );
  const [hit] = await pool.query(
    `SELECT COUNT(*) AS n FROM sgc_formato_campos
      WHERE codigo_formato='SGC-F-01'
        AND valor_texto IN ('SGC-DI-06', 'SP-P-08')`
  );

  const extDespues = resumenExternos(payload?.datos?.documentos);
  const extCodigosDespues = codigosExtPersistidos(payload?.datos?.documentos);
  const [hitExt] = await pool.query(
    `SELECT COUNT(*) AS n FROM sgc_formato_campos
      WHERE codigo_formato='SGC-F-01'
        AND valor_texto REGEXP '^EXT-[0-9]+$'`
  );

  console.log(`\n[${etiqueta}]`);
  console.log(`  Quitados de vista:       ${quitados.length ? quitados.join(', ') : '(ninguno)'}`);
  console.log(`  Documentos en respuesta: ${n}`);
  console.log(`  Campos persistidos:      ${cnt[0].n}`);
  console.log(`  Códigos excluidos en BD: ${hit[0].n}`);
  console.log(`  EXT-* antes:             ${extCodigosAntes.length ? extCodigosAntes.join(', ') : '(ninguno)'}`);
  console.log(`  EXT-* después:           ${extCodigosDespues.length ? extCodigosDespues.join(', ') : '(ninguno)'}`);
  console.log(`  EXT-* en valor_texto BD: ${hitExt[0].n}`);
  console.log(`  Documentos externos (${extDespues.length}):`);
  for (const row of extDespues) {
    console.log(`    · ${row.codigo} — ${row.nombre}`);
  }

  if (Number(cnt[0].n) < 100) {
    throw new Error(`[${etiqueta}] Persistencia incompleta (${cnt[0].n} campos)`);
  }
  if (Number(hit[0].n) > 0) {
    throw new Error(`[${etiqueta}] Aún hay códigos excluidos en BD`);
  }
  if (extCodigosDespues.length > 0 || Number(hitExt[0].n) > 0) {
    throw new Error(`[${etiqueta}] Aún hay códigos EXT-* en la lista maestra`);
  }
  return { n, extDespues };
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

  if (!soloProd) {
    console.log(`Dev:  ${localHost}:${localPort} / ${envDev.DB_NAME_SGC || envDev.DB_NAME} / ${envDev.DB_USER}`);
  }
  if (!soloDev) {
    console.log(`Prod: ${remoteHost}:${remotePort} / ${envProd.DB_NAME_SGC || envProd.DB_NAME} / ${envProd.DB_USER}`);
  }
  console.log(`Catálogo base: ${sgcF01.CATALOGO_BASE.length} docs`);
  console.log(`Excluir: ${[...EXCLUIDOS].join(', ')}`);
  console.log(`Modo: ${soloProd ? 'solo producción' : soloDev ? 'solo desarrollo' : 'desarrollo + producción'}`);

  const poolDev = soloProd ? null : crearPool(envDev, 'DB_HOST_LOCAL');
  const poolProd = soloDev ? null : crearPool(envProd, 'DB_HOST_REMOTE');

  try {
    if (poolDev) await publicarEn(poolDev, 'DESARROLLO');
    if (poolProd) await publicarEn(poolProd, 'PRODUCCIÓN');
    console.log('\nListo: SGC-F-01 publicado. Documentos externos sin código EXT-*.');
  } finally {
    if (poolDev) await poolDev.end().catch(() => {});
    if (poolProd) await poolProd.end().catch(() => {});
  }
})().catch((err) => {
  console.error('\nError:', err.message || err);
  process.exit(1);
});
