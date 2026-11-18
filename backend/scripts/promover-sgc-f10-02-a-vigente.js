/**
 * Local: toma la auditoría No.02 (contenido del informe) y la deja como
 * informe DINÁMICO vigente del sistema (BD + Doc SGC-F-10 sistema).
 * Elimina los registros históricos locales (seed / ejemplos) del archivero.
 *
 * Uso:
 *   node scripts/promover-sgc-f10-02-a-vigente.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envFile)) {
  console.error(`No se encontró ${envFile}`);
  process.exit(1);
}
dotenv.config({ path: envFile, quiet: true });

const mysql = require('mysql2/promise');
const sgcF10Service = require('../sgcF10Service');
const { HISTORICOS } = require('../data/sgc-f10-historicos-seed');

function normalizarNo(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.padStart(2, '0').slice(-2);
}

(async () => {
  const host = process.env.DB_HOST_LOCAL || '127.0.0.1';
  const database = process.env.DB_NAME_SGC || 'biznaga_sgc';
  console.log(`[SGC-F-10] Promover No.02 → vigente dinámico @ ${database}@${host}`);

  const item = (HISTORICOS || []).find((h) => normalizarNo(h.auditoriaNo) === '02');
  if (!item) {
    console.error('No se encontró la auditoría 02 en el seed.');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 20000
  });

  try {
    const registroPrevio = await sgcF10Service.cargarFormato(pool);
    const plantillaBaseFileId = registroPrevio?.datos?.plantillaBaseFileId || '';

    const datos = sgcF10Service.sanitizarDatos({
      ...sgcF10Service.DATOS_DEFECTO,
      auditoriaNo: '02',
      fechasAuditoria: item.fechasAuditoria,
      ubicaciones: item.ubicaciones,
      empresa: item.empresa,
      domicilio: item.domicilio,
      objetivos: item.objetivos,
      criterios: item.criterios,
      alcance: item.alcance,
      auditorLider: item.auditorLider,
      auditores: item.auditores,
      participantes: item.participantes,
      otrosParticipantes: item.otrosParticipantes,
      conclusiones: item.conclusiones,
      hallazgos: item.hallazgos,
      fechaElaboracion: item.fechaAuditoria,
      plantillaBaseFileId
    });

    console.log(
      `[SGC-F-10] Datos No.02: hallazgos=${(datos.hallazgos || []).length}`
      + ` · fechas=${datos.fechasAuditoria}`
    );

    // Sync al documento dinámico del sistema (no al Word/Doc histórico).
    let plantillaOk = plantillaBaseFileId;
    try {
      const syncRes = await sgcF10Service.sincronizarDocumentoDrive(
        datos,
        sgcF10Service.DRIVE_FILE_ID_SISTEMA,
        plantillaBaseFileId
      );
      plantillaOk = syncRes?.plantillaBaseFileId || plantillaBaseFileId;
      console.log('[SGC-F-10] Sync Drive sistema OK');
    } catch (err) {
      console.warn('[SGC-F-10] Sync Drive falló (se guarda BD igual):', err.message);
    }

    datos.plantillaBaseFileId = plantillaOk || '';

    // Persistir como vigente del formato (mismo Doc sistema).
    const { persistirRegistroSgc } = require('../sgcDgF05Service');
    await persistirRegistroSgc(pool, sgcF10Service.CODIGO_FORMATO, {
      driveFileId: sgcF10Service.DRIVE_FILE_ID_SISTEMA,
      datos,
      fechaElaboracionOriginal: item.fechaAuditoria || null,
      fechaModificacionContenido: new Date().toISOString().slice(0, 10),
      contenidoModificado: true
    });
    console.log('[SGC-F-10] Vigente BD = Auditoría No.02 (dinámico)');

    // Quitar históricos locales (seed + ejemplos) del archivero.
    await sgcF10Service.asegurarTablaHistorialF10(pool);
    const [del] = await pool.query('DELETE FROM sgc_f10_historial');
    console.log(`[SGC-F-10] Históricos locales eliminados: ${del.affectedRows}`);

    const despues = await sgcF10Service.cargarFormato(pool);
    console.log('VIGENTE', {
      auditoriaNo: despues?.datos?.auditoriaNo,
      empresa: despues?.datos?.empresa,
      fechas: despues?.datos?.fechasAuditoria,
      hallazgos: (despues?.datos?.hallazgos || []).length,
      driveFileId: despues?.driveFileId,
      historial: (despues?.historial || []).length
    });
    console.log('\nListo. Recarga SGC-F-10: verás No.02 en captura (sistema), sin libros históricos.');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
