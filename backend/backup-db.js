const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

(async () => {
  try {
    const pool = await mysql.createPool({
      host: process.env.DB_HOST_LOCAL,
      port: parseInt(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    const dbName = process.env.DB_NAME;
    let sql = '';

    sql += '-- =====================================================\n';
    sql += `-- BACKUP COMPLETO: ${dbName}\n`;
    sql += `-- Fecha: ${new Date().toISOString()}\n`;
    sql += '-- Incluye: Tablas + Datos + Vistas + Stored Procedures\n';
    sql += '-- =====================================================\n\n';
    sql += 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

    // ── TABLAS (orden por dependencias, padres primero) ──
    const tableOrder = [
      'roles', 'sector_empresarial', 'area_tematica', 'configuracion',
      'usuario', 'empresa', 'instructor', 'instructor_areas', 'usuario_areas',
      'curso', 'documento_curso', 'checklist_curso',
      'empleado', 'curso_programado', 'documento_curso_programado',
      'inscripcion_curso', 'historial_cursos',
      'log_actividad', 'notificaciones'
    ];

    sql += '-- ─────────────────────────────────────────────────────\n';
    sql += '-- TABLAS Y DATOS\n';
    sql += '-- ─────────────────────────────────────────────────────\n\n';

    for (const table of tableOrder) {
      console.log(`Backing up table: ${table}...`);

      const [createResult] = await pool.query('SHOW CREATE TABLE ??', [table]);
      sql += `-- TABLE: ${table}\n`;
      sql += `DROP TABLE IF EXISTS \`${table}\`;\n`;
      sql += createResult[0]['Create Table'] + ';\n\n';

      const [rows] = await pool.query('SELECT * FROM ??', [table]);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => '`' + c + '`').join(', ');

        const valueRows = rows.map(row => {
          const vals = cols.map(col => {
            const v = row[col];
            if (v === null || v === undefined) return 'NULL';
            if (v instanceof Date) {
              return "'" + v.toISOString().slice(0, 19).replace('T', ' ') + "'";
            }
            if (typeof v === 'number') return String(v);
            if (Buffer.isBuffer(v)) return 'NULL';
            const s = String(v)
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
            return "'" + s + "'";
          });
          return '(' + vals.join(', ') + ')';
        });

        sql += `INSERT INTO \`${table}\` (${colList}) VALUES\n`;
        sql += valueRows.join(',\n') + ';\n\n';
        console.log(`  -> ${rows.length} registros`);
      } else {
        sql += '-- (tabla vacia)\n\n';
        console.log('  -> vacia');
      }
    }

    // ── VISTAS ──
    sql += '\n-- ─────────────────────────────────────────────────────\n';
    sql += '-- VISTAS SQL\n';
    sql += '-- ─────────────────────────────────────────────────────\n\n';

    const [allTables] = await pool.query(
      `SHOW FULL TABLES IN \`${dbName}\` WHERE Table_type = 'VIEW'`
    );

    const viewNames = allTables.map(row => Object.values(row)[0]);
    console.log(`\nVistas encontradas: ${viewNames.length}`);

    for (const viewName of viewNames) {
      console.log(`Backing up view: ${viewName}...`);
      const [viewDef] = await pool.query('SHOW CREATE VIEW ??', [viewName]);
      const createView = viewDef[0]['Create View'];

      // Limpiar el DEFINER del CREATE VIEW para portabilidad
      const cleanView = createView
        .replace(/DEFINER=`[^`]+`@`[^`]+`\s*/g, '')
        .replace(/SQL SECURITY DEFINER\s*/g, '');

      sql += `DROP VIEW IF EXISTS \`${viewName}\`;\n`;
      sql += cleanView + ';\n\n';
    }

    // ── STORED PROCEDURES ──
    sql += '-- ─────────────────────────────────────────────────────\n';
    sql += '-- STORED PROCEDURES\n';
    sql += '-- ─────────────────────────────────────────────────────\n\n';

    const [procs] = await pool.query(
      `SHOW PROCEDURE STATUS WHERE Db = ?`, [dbName]
    );

    console.log(`Procedures encontrados: ${procs.length}`);

    for (const proc of procs) {
      const procName = proc.Name;
      console.log(`Backing up procedure: ${procName}...`);
      const [procDef] = await pool.query('SHOW CREATE PROCEDURE ??', [procName]);
      const createProc = procDef[0]['Create Procedure'];

      // Limpiar DEFINER para portabilidad
      const cleanProc = createProc
        .replace(/DEFINER=`[^`]+`@`[^`]+`\s*/g, '')
        .replace(/SQL SECURITY DEFINER\s*/g, '');

      sql += `DROP PROCEDURE IF EXISTS \`${procName}\`;\n`;
      sql += 'DELIMITER //\n';
      sql += cleanProc + ' //\n';
      sql += 'DELIMITER ;\n\n';
    }

    sql += '\nSET FOREIGN_KEY_CHECKS = 1;\n';
    sql += '-- FIN DEL BACKUP\n';

    const fecha = new Date().toISOString().slice(0, 10);
    const filename = `backup-${dbName}-${fecha}.sql`;
    fs.writeFileSync(filename, sql, 'utf8');
    const size = (fs.statSync(filename).size / 1024).toFixed(1);
    console.log(`\nBackup guardado: ${filename} (${size} KB)`);
    console.log(`Contenido: ${tableOrder.length} tablas, ${viewNames.length} vistas, ${procs.length} procedures`);

    await pool.end();
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
