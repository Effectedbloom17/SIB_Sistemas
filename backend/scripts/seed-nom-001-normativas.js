/**
 * Importa NOM-001-STPS-2008 desde Google Sheets a la BD normativas (desarrollo).
 * Uso: node scripts/seed-nom-001-normativas.js
 */
require('dotenv').config();
const drive = require('../driveService');
const seguridadNormativasService = require('../seguridadNormativasService');
const mysql = require('mysql2/promise');

const SHEET_ID = '1fLRLJCl28Mlh5tDJxv13joKp7ET0DrlAKW_IqFp-I4s';
const DB_NAME = process.env.DB_NAME_NORMATIVAS || 'normativas';

(async () => {
  try {
    const buf = await drive.exportarGoogleSheetComoXLSX(SHEET_ID);
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST_LOCAL || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || 'root'
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.end();

    const pool = mysql.createPool({
      host: process.env.DB_HOST_LOCAL || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || 'root',
      database: DB_NAME,
      connectionLimit: 2
    });

    await seguridadNormativasService.asegurarTablas(pool);
    const resultado = await seguridadNormativasService.importarDesdeExcel(pool, buf, {
      nombreArchivo: 'NOM-001-STPS-2008 REQUISITOS.xlsx',
      usuario: { nombre: 'Super Administrador', perfil: 'Super Administrador', roles: ['root'] }
    });

    console.log('OK:', resultado.normativa.codigo, '-', resultado.requisitos_importados, 'requisitos');
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
