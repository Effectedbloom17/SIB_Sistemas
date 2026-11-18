/**
 * PRODUCCIÓN · Solo actualiza el enlace Drive de la auditoría No.02.
 * NO borra registros · NO toca el informe vigente.
 *
 * Uso:
 *   node scripts/actualizar-drive-sgc-f10-02-produccion.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', '.env.produccion');
if (!fs.existsSync(envFile)) {
  console.error(`No se encontró ${envFile}`);
  process.exit(1);
}
dotenv.config({ path: envFile, quiet: true });

const mysql = require('mysql2/promise');
const sgcF10Service = require('../sgcF10Service');

const DRIVE_ID = '1O_PL0EKCkqkJ6_mcCuPrDH6O1vBohARwOOYvfz6IK1c';
const DRIVE_NAME = 'SGC-F-10 Informe de auditoría No.02 (histórico)';

(async () => {
  const host = process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1';
  const database = process.env.DB_NAME_SGC || '';
  if (!String(database).includes('sgc')) {
    console.error(`ABORTADO: DB_NAME_SGC sospechoso: ${database}`);
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
    connectionLimit: 2,
    connectTimeout: 25000
  });

  try {
    const antesFmt = await sgcF10Service.cargarFormato(pool);
    const vigenteNo = String(antesFmt?.datos?.auditoriaNo || '');
    console.log(`[ANTES] Vigente No.${vigenteNo}`);

    const [antes] = await pool.query(
      `SELECT id, auditoria_no, drive_file_id, drive_file_name, total_nc, total_op, total_hallazgos
         FROM sgc_f10_historial
        WHERE auditoria_no IN ('02','2')`
    );
    console.log('[ANTES] No.02:', antes);
    if (!antes.length) {
      console.error('No.02 no existe en historial. Abortado sin cambios.');
      process.exitCode = 1;
      return;
    }

    const [upd] = await pool.query(
      `UPDATE sgc_f10_historial
          SET drive_file_id = ?, drive_file_name = ?
        WHERE auditoria_no IN ('02','2')`,
      [DRIVE_ID, DRIVE_NAME]
    );
    console.log(`[OK] Filas actualizadas (solo Drive): ${upd.affectedRows}`);

    const despuesFmt = await sgcF10Service.cargarFormato(pool);
    const vigenteNo2 = String(despuesFmt?.datos?.auditoriaNo || '');
    console.log(`[DESPUÉS] Vigente No.${vigenteNo2}`);
    if (vigenteNo !== vigenteNo2) {
      console.error('ERROR: cambió el vigente. Revisar.');
      process.exitCode = 2;
    } else {
      console.log('[OK] Vigente intacto.');
    }

    const [despues] = await pool.query(
      `SELECT id, auditoria_no, drive_file_id, drive_file_name, total_nc, total_op, total_hallazgos
         FROM sgc_f10_historial
        WHERE auditoria_no IN ('02','2')`
    );
    console.log('[DESPUÉS] No.02:', despues);

    const [todos] = await pool.query(
      `SELECT auditoria_no, origen, total_nc, total_op FROM sgc_f10_historial ORDER BY auditoria_no`
    );
    console.log('[DESPUÉS] Historial completo (sin borrados):', todos);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
