/**
 * PRODUCCIÓN · Agrega SOLO la auditoría No.02 al historial SGC-F-10.
 *
 * GARANTÍAS:
 * - NO borra ningún registro
 * - NO modifica el informe vigente (No.03 u otro)
 * - Si No.02 ya existe, no hace nada (omitido)
 *
 * Uso:
 *   node scripts/agregar-sgc-f10-02-produccion.js
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

function fingerprintVigente(datos) {
  if (!datos || typeof datos !== 'object') {
    return { auditoriaNo: null, hallazgos: 0, hash: 'sin-datos' };
  }
  const auditoriaNo = String(datos.auditoriaNo || '').trim();
  const hallazgos = Array.isArray(datos.hallazgos) ? datos.hallazgos.length : 0;
  const firmas = [
    auditoriaNo,
    String(datos.fechasAuditoria || ''),
    String(datos.empresa || ''),
    String(datos.conclusiones || '').slice(0, 120),
    hallazgos,
    Array.isArray(datos.hallazgos)
      ? datos.hallazgos.map((h) => `${h?.clausula || ''}|${h?.clasificacion || ''}`).join(';')
      : ''
  ].join('::');
  return { auditoriaNo, hallazgos, hash: firmas };
}

(async () => {
  const host = process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL || '127.0.0.1';
  const database = process.env.DB_NAME_SGC || '';
  if (!String(database).includes('sgc')) {
    console.error(`ABORTADO: DB_NAME_SGC sospechoso: ${database}`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PRODUCCIÓN · Agregar SOLO historial SGC-F-10 No.02     ║');
  console.log('║  Sin borrar · Sin tocar el informe vigente              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`DB: ${database}@${host}`);

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
    connectTimeout: 25000
  });

  try {
    await sgcF10Service.asegurarTablaHistorialF10(pool);

    const antes = await sgcF10Service.cargarFormato(pool);
    const fpAntes = fingerprintVigente(antes?.datos);
    console.log(`[ANTES] Vigente No.${fpAntes.auditoriaNo || '—'} · hallazgos=${fpAntes.hallazgos}`);

    const [histAntes] = await pool.query(
      `SELECT auditoria_no, origen, empresa, total_nc, total_op
         FROM sgc_f10_historial
        ORDER BY auditoria_no`
    );
    console.log('[ANTES] Historial:', histAntes);

    const yaExiste = histAntes.some((r) => normalizarNo(r.auditoria_no) === '02');
    if (yaExiste) {
      console.log('No.02 ya existe en historial. No se modifica nada.');
    } else {
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
        fechaElaboracion: item.fechaAuditoria
      });

      const insertado = await sgcF10Service.insertarHistorialInmutable(pool, {
        datos,
        driveFileId: item.driveFileId || null,
        driveFileName: item.driveFileName || null,
        origen: 'sistema',
        cerradoPor: 'agregar-produccion',
        fechaAuditoriaOverride: item.fechaAuditoria,
        anioOverride: item.anio
      });

      console.log('[OK] Insertado historial No.02:', insertado);
    }

    const despues = await sgcF10Service.cargarFormato(pool);
    const fpDespues = fingerprintVigente(despues?.datos);
    console.log(`[DESPUÉS] Vigente No.${fpDespues.auditoriaNo || '—'} · hallazgos=${fpDespues.hallazgos}`);

    if (fpAntes.hash !== fpDespues.hash) {
      console.error('ERROR CRÍTICO: el informe vigente cambió. Revisar de inmediato.');
      process.exitCode = 2;
    } else {
      console.log('[OK] Informe vigente intacto.');
    }

    const [histDespues] = await pool.query(
      `SELECT auditoria_no, origen, empresa, total_nc, total_op, total_hallazgos, drive_file_id
         FROM sgc_f10_historial
        ORDER BY auditoria_no`
    );
    console.log('[DESPUÉS] Historial:', histDespues);
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.code === 'ER_DUP_ENTRY' || err.statusCode === 409) {
      console.error('No.02 ya existía. No se borró ni modificó nada más.');
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
