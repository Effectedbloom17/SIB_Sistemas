/**
 * Copia una Historia Clínica de PRODUCCIÓN → LOCAL
 * y la asigna a la empresa "ejemplo 3".
 *
 * Folio B-HC-26-029 = id 29 (año 2026).
 * NO modifica producción.
 *
 * Uso: node backend/scripts/copiar-hc-prod-a-ejemplo3-local.js
 * Opcional: node backend/scripts/copiar-hc-prod-a-ejemplo3-local.js 29
 */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const HC_ID = Number(process.argv[2] || 29);
const EMPRESA_DESTINO = 'ejemplo 3';

function loadProd() {
  dotenv.config({ path: path.join(__dirname, '..', '.env.produccion'), quiet: true, override: true });
  return {
    host: process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME_MEDICOS
  };
}

function loadLocal() {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true, override: true });
  return {
    host: process.env.DB_HOST_LOCAL || '127.0.0.1',
    port: Number(process.env.DB_PORT_LOCAL || process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME_MEDICOS,
    databaseBiz: process.env.DB_NAME
  };
}

function sqlDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  return value;
}

(async () => {
  const prodCfg = loadProd();
  const localCfg = loadLocal();

  if (!prodCfg.user || !prodCfg.password || !prodCfg.database) {
    throw new Error('Faltan credenciales de producción (.env.produccion / DB_NAME_MEDICOS).');
  }
  if (!localCfg.user || !localCfg.database || !localCfg.databaseBiz) {
    throw new Error('Faltan credenciales locales (.env / DB_NAME_MEDICOS / DB_NAME).');
  }

  const prod = await mysql.createPool({ ...prodCfg, connectionLimit: 2, connectTimeout: 25000 });
  const localMed = await mysql.createPool({
    host: localCfg.host,
    port: localCfg.port,
    user: localCfg.user,
    password: localCfg.password,
    database: localCfg.database,
    connectionLimit: 2,
    connectTimeout: 25000
  });
  const localBiz = await mysql.createPool({
    host: localCfg.host,
    port: localCfg.port,
    user: localCfg.user,
    password: localCfg.password,
    database: localCfg.databaseBiz,
    connectionLimit: 2,
    connectTimeout: 25000
  });

  try {
    const [empresas] = await localBiz.query(
      `SELECT empresa_id, nombre_empresa
       FROM empresa
       WHERE activo = 1 AND LOWER(TRIM(nombre_empresa)) = LOWER(?)
       LIMIT 1`,
      [EMPRESA_DESTINO]
    );
    if (!empresas.length) {
      throw new Error(`No se encontró la empresa local "${EMPRESA_DESTINO}".`);
    }
    const empresaIdLocal = empresas[0].empresa_id;
    console.log(`Empresa destino: ${empresas[0].nombre_empresa} (id=${empresaIdLocal})`);

    const [hcRows] = await prod.query(
      `SELECT * FROM historia_clinica WHERE id = ? AND activo = 1 LIMIT 1`,
      [HC_ID]
    );
    if (!hcRows.length) {
      throw new Error(`No existe historia clínica activa id=${HC_ID} en producción.`);
    }
    const hc = hcRows[0];
    console.log(`Producción HC id=${hc.id} → ${hc.nombre || '(sin nombre)'} (empresa_id prod=${hc.empresa_id})`);

    const [laborales] = await prod.query(
      `SELECT * FROM antecedente_laboral WHERE historia_clinica_id = ? ORDER BY orden, id`,
      [HC_ID]
    );
    const [diagnosticos] = await prod.query(
      `SELECT * FROM diagnostico WHERE historia_clinica_id = ? ORDER BY numero, id`,
      [HC_ID]
    );
    console.log(`Hijos: ${laborales.length} antecedentes laborales, ${diagnosticos.length} diagnósticos`);

    const conn = await localMed.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(`DELETE FROM antecedente_laboral WHERE historia_clinica_id = ?`, [HC_ID]);
      await conn.query(`DELETE FROM diagnostico WHERE historia_clinica_id = ?`, [HC_ID]);
      await conn.query(`DELETE FROM historia_clinica WHERE id = ?`, [HC_ID]);

      const row = { ...hc };
      row.empresa_id = empresaIdLocal;
      // Evitar enlaces de Drive de producción en pruebas locales
      if ('pdf_drive_file_id' in row) row.pdf_drive_file_id = null;
      if ('pdf_drive_url' in row) row.pdf_drive_url = null;
      if ('pdf_drive_file_name' in row) row.pdf_drive_file_name = null;
      if ('pdf_nombre_archivo' in row) row.pdf_nombre_archivo = null;

      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => {
        const v = row[c];
        if (v instanceof Date) return sqlDate(v);
        return v;
      });

      await conn.query(
        `INSERT INTO historia_clinica (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        values
      );

      for (const lab of laborales) {
        const labRow = { ...lab };
        delete labRow.id;
        labRow.historia_clinica_id = HC_ID;
        const labCols = Object.keys(labRow);
        await conn.query(
          `INSERT INTO antecedente_laboral (${labCols.map((c) => `\`${c}\``).join(', ')})
           VALUES (${labCols.map(() => '?').join(', ')})`,
          labCols.map((c) => (labRow[c] instanceof Date ? sqlDate(labRow[c]) : labRow[c]))
        );
      }

      for (const diag of diagnosticos) {
        const diagRow = { ...diag };
        delete diagRow.id;
        diagRow.historia_clinica_id = HC_ID;
        const diagCols = Object.keys(diagRow);
        await conn.query(
          `INSERT INTO diagnostico (${diagCols.map((c) => `\`${c}\``).join(', ')})
           VALUES (${diagCols.map(() => '?').join(', ')})`,
          diagCols.map((c) => (diagRow[c] instanceof Date ? sqlDate(diagRow[c]) : diagRow[c]))
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const anio = new Date(hc.created_at || hc.fecha_elaboracion || Date.now())
      .getFullYear()
      .toString()
      .slice(-2);
    const folio = `B-HC-${anio}-${String(HC_ID).padStart(3, '0')}`;

    const [verify] = await localMed.query(
      `SELECT id, empresa_id, nombre, activo, created_at FROM historia_clinica WHERE id = ?`,
      [HC_ID]
    );
    console.log('OK local:', verify[0]);
    console.log(`Folio disponible en local (ejemplo 3): ${folio}`);
  } finally {
    await prod.end();
    await localMed.end();
    await localBiz.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
