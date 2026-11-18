/**
 * PRODUCCIÓN · Deja la auditoría No.02 como informe VIGENTE dinámico
 * (igual que en local), SIN borrar registros.
 *
 * Flujo seguro:
 * 1) Snapshot del vigente actual (No.3) → actualiza historial No.03 (UPDATE, no DELETE)
 * 2) Carga No.02 en el informe vigente + sync al Doc del sistema
 * 3) No elimina filas del historial (01/02/03 siguen)
 *
 * Uso:
 *   node scripts/promover-sgc-f10-02-produccion-dinamico.js
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
const { HISTORICOS } = require('../data/sgc-f10-historicos-seed');

function normalizarNo(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.padStart(2, '0').slice(-2);
}

function fingerprint(datos) {
  if (!datos || typeof datos !== 'object') {
    return { auditoriaNo: null, hallazgos: 0, hash: 'sin-datos' };
  }
  const auditoriaNo = String(datos.auditoriaNo || '').trim();
  const hallazgos = Array.isArray(datos.hallazgos) ? datos.hallazgos.length : 0;
  const firmas = [
    auditoriaNo,
    String(datos.fechasAuditoria || ''),
    String(datos.empresa || ''),
    String(datos.conclusiones || '').slice(0, 160),
    hallazgos,
    Array.isArray(datos.hallazgos)
      ? datos.hallazgos.map((h) => `${h?.clausula || ''}|${h?.clasificacion || ''}`).join(';')
      : ''
  ].join('::');
  return { auditoriaNo, hallazgos, hash: firmas };
}

function contadoresDe(datos) {
  const lista = Array.isArray(datos?.hallazgos) ? datos.hallazgos : [];
  let totalOp = 0;
  let totalNcMenor = 0;
  let totalNcMayor = 0;
  for (const h of lista) {
    const c = String(h?.clasificacion || '').toUpperCase().replace(/\s+/g, '_');
    if (c === 'OP') totalOp += 1;
    else if (c === 'NC_MENOR') totalNcMenor += 1;
    else if (c === 'NC_MAYOR') totalNcMayor += 1;
  }
  return {
    totalHallazgos: lista.length,
    totalOp,
    totalNcMenor,
    totalNcMayor,
    totalNc: totalNcMenor + totalNcMayor
  };
}

(async () => {
  const host = process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1';
  const database = process.env.DB_NAME_SGC || '';
  if (!String(database).includes('sgc')) {
    console.error(`ABORTADO: DB_NAME_SGC sospechoso: ${database}`);
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PRODUCCIÓN · No.02 como vigente dinámico                 ║');
  console.log('║  Conserva No.03 (y todo el historial) · SIN DELETE        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`DB: ${database}@${host}`);

  const item02 = (HISTORICOS || []).find((h) => normalizarNo(h.auditoriaNo) === '02');
  if (!item02) {
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
    connectTimeout: 30000
  });

  try {
    await sgcF10Service.asegurarTablaHistorialF10(pool);

    const antes = await sgcF10Service.cargarFormato(pool);
    const datosVigenteAntes = antes?.datos || null;
    const fpAntes = fingerprint(datosVigenteAntes);
    console.log(`[ANTES] Vigente No.${fpAntes.auditoriaNo || '—'} · hallazgos=${fpAntes.hallazgos}`);

    const [histAntes] = await pool.query(
      `SELECT auditoria_no, origen, total_nc, total_op, total_hallazgos
         FROM sgc_f10_historial ORDER BY auditoria_no`
    );
    console.log('[ANTES] Historial:', histAntes);

    // 1) Preservar el vigente actual en historial No.03 (UPDATE, nunca DELETE).
    const noVigente = normalizarNo(fpAntes.auditoriaNo);
    if (datosVigenteAntes && (noVigente === '03' || noVigente === '3')) {
      const c = contadoresDe(datosVigenteAntes);
      const snapshot = {
        ...datosVigenteAntes,
        auditoriaNo: '03',
        totalHallazgos: c.totalHallazgos
      };
      const [upd03] = await pool.query(
        `UPDATE sgc_f10_historial
            SET fechas_auditoria = ?,
                empresa = ?,
                ubicaciones = ?,
                total_hallazgos = ?,
                total_op = ?,
                total_nc_menor = ?,
                total_nc_mayor = ?,
                total_nc = ?,
                datos_json = ?
          WHERE auditoria_no IN ('03','3')`,
        [
          datosVigenteAntes.fechasAuditoria || null,
          datosVigenteAntes.empresa || null,
          datosVigenteAntes.ubicaciones || null,
          c.totalHallazgos,
          c.totalOp,
          c.totalNcMenor,
          c.totalNcMayor,
          c.totalNc,
          JSON.stringify(snapshot)
        ]
      );
      console.log(`[OK] Historial No.03 preservado/actualizado (UPDATE=${upd03.affectedRows}, sin borrar)`);
    } else {
      console.log(`[INFO] Vigente no es No.03 (es No.${noVigente || '—'}); no se toca historial 03.`);
    }

    // 2) Cargar No.02 como vigente dinámico del sistema.
    const plantillaBaseFileId = datosVigenteAntes?.plantillaBaseFileId || '';
    const datos02 = sgcF10Service.sanitizarDatos({
      ...sgcF10Service.DATOS_DEFECTO,
      auditoriaNo: '02',
      fechasAuditoria: item02.fechasAuditoria,
      ubicaciones: item02.ubicaciones,
      empresa: item02.empresa,
      domicilio: item02.domicilio,
      objetivos: item02.objetivos,
      criterios: item02.criterios,
      alcance: item02.alcance,
      auditorLider: item02.auditorLider,
      auditores: item02.auditores,
      participantes: item02.participantes,
      otrosParticipantes: item02.otrosParticipantes,
      conclusiones: item02.conclusiones,
      hallazgos: item02.hallazgos,
      fechaElaboracion: item02.fechaAuditoria,
      plantillaBaseFileId
    });

    let plantillaOk = plantillaBaseFileId;
    try {
      const syncRes = await sgcF10Service.sincronizarDocumentoDrive(
        datos02,
        sgcF10Service.DRIVE_FILE_ID_SISTEMA,
        plantillaBaseFileId
      );
      plantillaOk = syncRes?.plantillaBaseFileId || plantillaBaseFileId;
      console.log('[OK] Sync Drive sistema con No.02');
    } catch (err) {
      console.warn('[WARN] Sync Drive falló (se guarda BD igual):', err.message);
    }
    datos02.plantillaBaseFileId = plantillaOk || '';

    const { persistirRegistroSgc } = require('../sgcDgF05Service');
    await persistirRegistroSgc(pool, sgcF10Service.CODIGO_FORMATO, {
      driveFileId: sgcF10Service.DRIVE_FILE_ID_SISTEMA,
      datos: datos02,
      fechaElaboracionOriginal: item02.fechaAuditoria || null,
      fechaModificacionContenido: new Date().toISOString().slice(0, 10),
      contenidoModificado: true
    });
    console.log('[OK] Vigente BD = Auditoría No.02 (dinámico)');

    // 3) Verificación: historial intacto en cantidad; vigente = 02.
    const despues = await sgcF10Service.cargarFormato(pool);
    const fpDespues = fingerprint(despues?.datos);
    console.log(`[DESPUÉS] Vigente No.${fpDespues.auditoriaNo || '—'} · hallazgos=${fpDespues.hallazgos}`);

    const [histDespues] = await pool.query(
      `SELECT auditoria_no, origen, total_nc, total_op, total_hallazgos
         FROM sgc_f10_historial ORDER BY auditoria_no`
    );
    console.log('[DESPUÉS] Historial (sin DELETE):', histDespues);

    if (histDespues.length < histAntes.length) {
      console.error('ERROR: se perdieron filas de historial.');
      process.exitCode = 2;
    } else if (normalizarNo(fpDespues.auditoriaNo) !== '02') {
      console.error('ERROR: el vigente no quedó en No.02.');
      process.exitCode = 2;
    } else {
      console.log('[OK] No.02 dinámico · historial preservado · No.03 sigue en archivero histórico.');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
