/**
 * Corrige vistas, procedures y triggers cuyo DEFINER no existe
 * (común al importar un dump de producción a MySQL local).
 *
 * Uso: node fix-definers.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

function stripDefiner(sql) {
  return sql
    .replace(/DEFINER=`[^`]+`@`[^`]+`\s*/g, '')
    .replace(/SQL SECURITY DEFINER\s*/g, '');
}

async function fixViews(conn, dbName) {
  await conn.query(`USE \`${dbName}\``);
  const [views] = await conn.query(
    `SHOW FULL TABLES IN \`${dbName}\` WHERE Table_type = 'VIEW'`
  );
  for (const row of views) {
    const viewName = Object.values(row)[0];
    const [def] = await conn.query('SHOW CREATE VIEW ??', [viewName]);
    let createSql = stripDefiner(def[0]['Create View']);
    createSql = createSql.replace(/^CREATE .*? VIEW/, 'CREATE OR REPLACE VIEW');
    await conn.query(createSql);
    console.log(`  Vista OK: ${dbName}.${viewName}`);
  }
}

async function fixProcedures(conn, dbName) {
  await conn.query(`USE \`${dbName}\``);
  const [procs] = await conn.query('SHOW PROCEDURE STATUS WHERE Db = ?', [dbName]);
  for (const proc of procs) {
    const [def] = await conn.query('SHOW CREATE PROCEDURE ??', [proc.Name]);
    let createSql = stripDefiner(def[0]['Create Procedure']);
    await conn.query(`DROP PROCEDURE IF EXISTS \`${proc.Name}\``);
    await conn.query(createSql);
    console.log(`  Procedure OK: ${dbName}.${proc.Name}`);
  }
}

async function fixFunctions(conn, dbName) {
  await conn.query(`USE \`${dbName}\``);
  const [funcs] = await conn.query('SHOW FUNCTION STATUS WHERE Db = ?', [dbName]);
  for (const fn of funcs) {
    const [def] = await conn.query('SHOW CREATE FUNCTION ??', [fn.Name]);
    let createSql = stripDefiner(def[0]['Create Function']);
    await conn.query(`DROP FUNCTION IF EXISTS \`${fn.Name}\``);
    await conn.query(createSql);
    console.log(`  Function OK: ${dbName}.${fn.Name}`);
  }
}

async function fixTriggers(conn, dbName) {
  await conn.query(`USE \`${dbName}\``);
  const [triggers] = await conn.query(
    'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
    [dbName]
  );
  for (const t of triggers) {
    const [def] = await conn.query('SHOW CREATE TRIGGER ??', [t.TRIGGER_NAME]);
    let createSql = stripDefiner(def[0]['SQL Original Statement']);
    await conn.query(`DROP TRIGGER IF EXISTS \`${t.TRIGGER_NAME}\``);
    await conn.query(createSql);
    console.log(`  Trigger OK: ${dbName}.${t.TRIGGER_NAME}`);
  }
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST_LOCAL,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    multipleStatements: true
  });

  const dbs = [
    process.env.DB_NAME,
    process.env.DB_NAME_MEDICOS,
    process.env.DB_NAME_PC,
    process.env.DB_NAME_SGC
  ].filter(Boolean);

  console.log('Corrigiendo DEFINER en bases de datos locales...\n');

  for (const db of dbs) {
    console.log(`[${db}]`);
    await fixViews(conn, db);
    await fixProcedures(conn, db);
    await fixFunctions(conn, db);
    await fixTriggers(conn, db);
  }

  // Verificar la vista que fallaba
  await conn.query(`USE \`${process.env.DB_NAME}\``);
  const [test] = await conn.query(
    'SELECT COUNT(*) AS total FROM v_cursos_programados'
  );
  console.log(`\nVerificacion: v_cursos_programados -> ${test[0].total} fila(s)`);

  await conn.end();
  console.log('\nListo.');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
