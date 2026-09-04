const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');

(async () => {
  const host = process.env.DB_HOST_LOCAL || process.env.DB_HOST || 'localhost';
  const pool = await mysql.createPool({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'biznaga',
    port: Number(process.env.DB_PORT || 3306)
  });

  try {
    await pool.query(
      `INSERT INTO roles (nombre_rol, descripcion, permisos)
       VALUES ('mantenimiento', 'Mantenimiento', '{"mantenimiento": true}')`
    );
    console.log('OK: rol mantenimiento insertado');
  } catch (e) {
    console.log('INFO:', e.code || e.message);
  }

  const [rows] = await pool.query(
    `SELECT rol_id, nombre_rol, descripcion
     FROM roles
     WHERE nombre_rol = 'mantenimiento'`
  );
  console.log(rows);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
