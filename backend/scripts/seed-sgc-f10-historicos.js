/**
 * Inserta SOLO el precedente histórico SGC-F-10 (auditorías 01 y 02)
 * en la tabla sgc_f10_historial.
 *
 * IMPORTANTE:
 * - NO modifica el informe vigente (sgc_formato_* / Word del sistema).
 * - En producción conserva intactos los hallazgos del ciclo actual (No. 03).
 * - Solo escribe filas históricas inmutables 01 (SEP-25) y 02 (ABR-26).
 *
 * Uso:
 *   node scripts/seed-sgc-f10-historicos.js
 *   node scripts/seed-sgc-f10-historicos.js --forzar
 *   node scripts/seed-sgc-f10-historicos.js --produccion
 *   node scripts/seed-sgc-f10-historicos.js --produccion --forzar
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const forzar = process.argv.includes('--forzar');
const esProduccion = process.argv.includes('--produccion');

const envFile = esProduccion
  ? path.join(__dirname, '..', '.env.produccion')
  : path.join(__dirname, '..', '.env');

if (!fs.existsSync(envFile)) {
  console.error(`No se encontró ${envFile}`);
  process.exit(1);
}

dotenv.config({ path: envFile, quiet: true });

const mysql = require('mysql2/promise');
const sgcF10Service = require('../sgcF10Service');
const { HISTORICOS } = require('../data/sgc-f10-historicos-seed');

const PERMITIDOS = new Set(['01', '1', '02', '2']);

function normalizarNo(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.padStart(2, '0').slice(-2);
}

function fingerprintVigente(datos) {
  if (!datos || typeof datos !== 'object') {
    return { auditoriaNo: null, hallazgos: 0, hash: 'sin-datos' };
  }
  const auditoriaNo = String(datos.auditoriaNo || '').trim();
  const hallazgos = Array.isArray(datos.hallazgos) ? datos.hallazgos.length : 0;
  const firmas = [
    auditoriaNo,
    String(datos.fechasAuditoria || ''),
    String(datos.empresa || ''),
    String(datos.conclusiones || '').slice(0, 120),
    hallazgos,
    Array.isArray(datos.hallazgos)
      ? datos.hallazgos.map((h) => `${h?.clausula || ''}|${h?.clasificacion || ''}`).join(';')
      : ''
  ].join('::');
  return { auditoriaNo, hallazgos, hash: firmas };
}

(async () => {
  const host = process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME_SGC || 'biznaga_sgc';

  // Seguridad: el seed nunca puede incluir 03 ni otras auditorías.
  const nos = HISTORICOS.map((h) => normalizarNo(h.auditoriaNo));
  const invalidos = nos.filter((n) => !PERMITIDOS.has(n));
  if (invalidos.length || nos.length !== 2) {
    console.error('ABORTADO: HISTORICOS debe contener exactamente 01 y 02. Encontrado:', nos);
    process.exit(1);
  }

  if (esProduccion) {
    if (!String(database).includes('sgc') && !String(database).includes('_sgc')) {
      console.error(`ABORTADO: DB_NAME_SGC sospechoso para producción: ${database}`);
      process.exit(1);
    }
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  PRODUCCIÓN · Solo historial SGC-F-10 No.01 y No.02     ║');
    console.log('║  El informe vigente (No.03 en curso) NO se modifica     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
  }

  const pool = mysql.createPool({
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 20000
  });

  try {
    console.log(`[SGC-F-10] Seed SOLO histórico → ${database}@${host}:${port} (forzar=${forzar}, produccion=${esProduccion})`);

    // Snapshot del informe vigente ANTES
    const antes = await sgcF10Service.cargarFormato(pool);
    const fpAntes = fingerprintVigente(antes?.datos);
    console.log(`[SGC-F-10] Vigente ANTES: No.${fpAntes.auditoriaNo || '—'} · hallazgos=${fpAntes.hallazgos}`);

    if (esProduccion) {
      const noVigente = normalizarNo(fpAntes.auditoriaNo);
      if (noVigente && noVigente !== '03' && Number(noVigente) < 3) {
        console.warn(`[SGC-F-10] Aviso: el vigente no es No.03 (es No.${noVigente}). Se respeta igual.`);
      }
    }

    const resultados = await sgcF10Service.seedHistoricosPrecedentes(pool, { forzar });
    console.log(JSON.stringify(resultados, null, 2));

    // Snapshot DESPUÉS — debe ser idéntico
    const despues = await sgcF10Service.cargarFormato(pool);
    const fpDespues = fingerprintVigente(despues?.datos);
    console.log(`[SGC-F-10] Vigente DESPUÉS: No.${fpDespues.auditoriaNo || '—'} · hallazgos=${fpDespues.hallazgos}`);

    if (fpAntes.hash !== fpDespues.hash) {
      console.error('ERROR CRÍTICO: el informe vigente cambió durante el seed. Revisar BD de inmediato.');
      process.exitCode = 2;
    } else {
      console.log('[SGC-F-10] OK: informe vigente intacto (No.03 / ciclo actual no tocado).');
    }

    const historial = await sgcF10Service.listarHistorial(pool);
    console.log('\n=== Histórico cerrado (sgc_f10_historial) ===');
    for (const h of historial) {
      console.log(
        `No.${h.auditoriaNo} · ${h.fechasAuditoria} · hallazgos=${h.totalHallazgos}`
        + ` (OP=${h.totalOp}, NC=${h.totalNc} [menor=${h.totalNcMenor}, mayor=${h.totalNcMayor}])`
        + ` · drive=${h.driveFileId || '—'}`
      );
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.code) console.error('code:', err.code);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
