const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.produccion') });

const destArg = process.argv[2];
const destDir = destArg || path.join(process.env.USERPROFILE || '', 'OneDrive', 'Documentos', 'Copia_Docker', `produccion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`);

const host = process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL;
const port = parseInt(process.env.DB_PORT || '3306', 10);
const user = process.env.DB_USER;
const pass = process.env.DB_PASS;

const dbNames = [...new Set([
  process.env.DB_NAME,
  process.env.DB_NAME_SGC,
  process.env.DB_NAME_MEDICOS,
  process.env.DB_NAME_PC
].filter(Boolean))];

function esc(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (typeof value === 'number') return String(value);
  if (Buffer.isBuffer(value)) return 'NULL';
  const s = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${s}'`;
}

async function dumpDatabase(dbName) {
  const pool = await mysql.createPool({
    host,
    port,
    user,
    password: pass,
    database: dbName,
    multipleStatements: false
  });

  let sql = '';
  sql += `-- BACKUP ${dbName}\n`;
  sql += `-- Fecha: ${new Date().toISOString()}\n\n`;
  sql += 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

  const [tables] = await pool.query('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
  const tableNames = tables.map((row) => Object.values(row)[0]);

  for (const table of tableNames) {
    process.stdout.write(`  tabla ${table}... `);
    const [createResult] = await pool.query('SHOW CREATE TABLE ??', [table]);
    sql += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    sql += `${createResult[0]['Create Table']};\n\n`;

    const [rows] = await pool.query('SELECT * FROM ??', [table]);
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const chunks = [];
      for (const row of rows) {
        chunks.push(`(${cols.map((col) => esc(row[col])).join(', ')})`);
      }
      sql += `INSERT INTO \`${table}\` (${colList}) VALUES\n`;
      sql += `${chunks.join(',\n')};\n\n`;
    }
    process.stdout.write(`${rows.length} filas\n`);
  }

  const [views] = await pool.query('SHOW FULL TABLES WHERE Table_type = \'VIEW\'');
  for (const row of views) {
    const viewName = Object.values(row)[0];
    process.stdout.write(`  vista ${viewName}...\n`);
    const [viewDef] = await pool.query('SHOW CREATE VIEW ??', [viewName]);
    const createView = viewDef[0]['Create View']
      .replace(/DEFINER=`[^`]+`@`[^`]+`\s*/g, '')
      .replace(/SQL SECURITY DEFINER\s*/g, '');
    sql += `DROP VIEW IF EXISTS \`${viewName}\`;\n`;
    sql += `${createView};\n\n`;
  }

  const [procs] = await pool.query('SHOW PROCEDURE STATUS WHERE Db = ?', [dbName]);
  for (const proc of procs) {
    const procName = proc.Name;
    process.stdout.write(`  procedure ${procName}...\n`);
    try {
      const [procDef] = await pool.query('SHOW CREATE PROCEDURE ??', [procName]);
      const rawProc = procDef[0]?.['Create Procedure'];
      if (!rawProc) {
        process.stdout.write(`    (omitido: sin definicion)\n`);
        continue;
      }
      const createProc = rawProc
        .replace(/DEFINER=`[^`]+`@`[^`]+`\s*/g, '')
        .replace(/SQL SECURITY DEFINER\s*/g, '');
      sql += `DROP PROCEDURE IF EXISTS \`${procName}\`;\n`;
      sql += 'DELIMITER //\n';
      sql += `${createProc} //\n`;
      sql += 'DELIMITER ;\n\n';
    } catch (procErr) {
      process.stdout.write(`    (omitido: ${procErr.message})\n`);
    }
  }

  sql += 'SET FOREIGN_KEY_CHECKS = 1;\n';
  await pool.end();
  return sql;
}

(async () => {
  if (!host || !user || !pass || dbNames.length === 0) {
    console.error('Faltan variables DB_* en .env.produccion');
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  console.log(`Destino: ${destDir}`);
  console.log(`Servidor: ${host}:${port}`);
  console.log(`Bases: ${dbNames.join(', ')}\n`);

  for (const dbName of dbNames) {
    console.log(`Respaldando ${dbName}...`);
    try {
      const sql = await dumpDatabase(dbName);
      const safeName = dbName.replace(/[^A-Za-z0-9._-]/g, '_');
      const gzPath = path.join(destDir, `${safeName}.sql.gz`);
      const compressed = zlib.gzipSync(Buffer.from(sql, 'utf8'), { level: 9 });
      fs.writeFileSync(gzPath, compressed);
      const mb = (compressed.length / (1024 * 1024)).toFixed(2);
      console.log(`OK -> ${gzPath} (${mb} MB comprimido)\n`);
    } catch (err) {
      console.error(`ERROR en ${dbName}:`, err.message);
      process.exit(1);
    }
  }

  console.log('Respaldo completado.');
})();
