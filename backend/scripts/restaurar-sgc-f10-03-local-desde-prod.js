/**
 * Copia el historial No.03 (y opcionalmente 01) desde producción → local.
 * NO toca el vigente. NO borra en producción.
 */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

function loadEnv(file) {
  const r = dotenv.config({ path: file, quiet: true, override: true });
  if (r.error) throw r.error;
  return {
    host: process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME_SGC
  };
}

(async () => {
  const prodCfg = loadEnv(path.join(__dirname, '..', '.env.produccion'));
  // Forzar host remoto de producción
  dotenv.config({ path: path.join(__dirname, '..', '.env.produccion'), quiet: true, override: true });
  prodCfg.host = process.env.DB_HOST_REMOTE || prodCfg.host;

  const localEnvPath = path.join(__dirname, '..', '.env');
  dotenv.config({ path: localEnvPath, quiet: true, override: true });
  const localCfg = {
    host: process.env.DB_HOST_LOCAL || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME_SGC
  };

  const prod = await mysql.createPool({ ...prodCfg, connectionLimit: 2, connectTimeout: 25000 });
  const local = await mysql.createPool({ ...localCfg, connectionLimit: 2, connectTimeout: 25000 });

  try {
    const [rows] = await prod.query(
      `SELECT * FROM sgc_f10_historial WHERE auditoria_no IN ('01','03','1','3') ORDER BY auditoria_no`
    );
    console.log(`Producción: ${rows.length} filas a copiar (01/03)`);

    for (const row of rows) {
      const no = String(row.auditoria_no || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
      const [exists] = await local.query(
        `SELECT id FROM sgc_f10_historial WHERE auditoria_no IN (?, ?) LIMIT 1`,
        [no, String(Number(no))]
      );
      if (exists.length) {
        await local.query(
          `UPDATE sgc_f10_historial SET
              fechas_auditoria=?, fecha_auditoria=?, anio=?, empresa=?, ubicaciones=?,
              total_hallazgos=?, total_op=?, total_nc_menor=?, total_nc_mayor=?, total_nc=?,
              datos_json=?, drive_file_id=?, drive_file_name=?,
              pdf_drive_file_id=?, pdf_drive_file_name=?,
              origen=?, cerrado=?, cerrado_en=?, cerrado_por=?, sgc_auditoria_id=?
            WHERE auditoria_no IN (?, ?)`,
          [
            row.fechas_auditoria, row.fecha_auditoria, row.anio, row.empresa, row.ubicaciones,
            row.total_hallazgos, row.total_op, row.total_nc_menor, row.total_nc_mayor, row.total_nc,
            typeof row.datos_json === 'string' ? row.datos_json : JSON.stringify(row.datos_json),
            row.drive_file_id, row.drive_file_name,
            row.pdf_drive_file_id, row.pdf_drive_file_name,
            row.origen || 'sistema', row.cerrado ?? 1, row.cerrado_en, row.cerrado_por, row.sgc_auditoria_id,
            no, String(Number(no))
          ]
        );
        console.log(`LOCAL UPDATE No.${no}`);
      } else {
        await local.query(
          `INSERT INTO sgc_f10_historial (
              auditoria_no, fechas_auditoria, fecha_auditoria, anio, empresa, ubicaciones,
              total_hallazgos, total_op, total_nc_menor, total_nc_mayor, total_nc,
              datos_json, drive_file_id, drive_file_name, pdf_drive_file_id, pdf_drive_file_name,
              origen, cerrado, cerrado_en, cerrado_por, sgc_auditoria_id
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            no, row.fechas_auditoria, row.fecha_auditoria, row.anio, row.empresa, row.ubicaciones,
            row.total_hallazgos, row.total_op, row.total_nc_menor, row.total_nc_mayor, row.total_nc,
            typeof row.datos_json === 'string' ? row.datos_json : JSON.stringify(row.datos_json),
            row.drive_file_id, row.drive_file_name, row.pdf_drive_file_id, row.pdf_drive_file_name,
            row.origen || 'sistema', row.cerrado ?? 1, row.cerrado_en, row.cerrado_por, row.sgc_auditoria_id
          ]
        );
        console.log(`LOCAL INSERT No.${no}`);
      }
    }

    const [localHist] = await local.query(
      `SELECT auditoria_no, origen, total_nc, total_op, total_hallazgos FROM sgc_f10_historial ORDER BY auditoria_no`
    );
    console.log('Historial local ahora:', localHist);
  } finally {
    await prod.end();
    await local.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
