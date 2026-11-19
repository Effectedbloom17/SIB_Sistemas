/**
 * Consolida duplicados de mantenimiento_solicitud (mismo forms_response_id).
 * Uso:
 *   node backend/scripts/consolidarMantSolicitudes.js local
 *   node backend/scripts/consolidarMantSolicitudes.js prod
 */
const path = require('path');
const mysql = require('mysql2/promise');

function loadService() {
  // Requiere el servicio ya parcheado.
  return require('../mantenimientoService');
}

async function run(target) {
  const svc = loadService();
  let cfg;
  if (target === 'prod' || target === 'production') {
    cfg = {
      host: '132.148.181.6',
      port: 3306,
      user: 'ou9c93ce6l5d_biz',
      password: 'Pr0d_B1znaga_2026!',
      database: 'ou9c93ce6l5d_biznaga'
    };
  } else {
    cfg = {
      host: process.env.DB_HOST_LOCAL || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || 'root',
      database: process.env.DB_NAME || 'biznaga'
    };
  }

  const pool = await mysql.createPool({ ...cfg, connectTimeout: 10000 });
  console.log(`Consolidando ${target} @ ${cfg.host}/${cfg.database} ...`);
  const before = await pool.query(
    `SELECT COUNT(*) n, SUM(activo=1) a, SUM(forms_response_id IS NOT NULL AND forms_response_id<>'') f
     FROM mantenimiento_solicitud`
  );
  console.log('antes:', before[0][0]);
  const result = await svc.consolidarDuplicadosCatalogo(pool);
  console.log('resultado:', result);

  // Recuperación puntual: reportes con gestión que quedaron ocultos por el bug de duplicados.
  if (process.argv.includes('--reactivar-gestion')) {
    const [rows] = await pool.query(
      `SELECT id, folio, forms_response_id, activo, datos_json FROM mantenimiento_solicitud WHERE activo = 0`
    );
    let reactivados = 0;
    for (const r of rows || []) {
      let d = {};
      try {
        d = typeof r.datos_json === 'string' ? JSON.parse(r.datos_json) : r.datos_json || {};
      } catch {
        d = {};
      }
      const score = svc.consolidarSolicitudesEnMemoria
        ? // score inline
          ([
            d.descripcionMantenimientoRealizado,
            d.responsableMantenimiento,
            d.fechaRealizado,
            d.reporteDriveFileId
          ].filter((x) => String(x || '').trim()).length)
        : 0;
      const gestion = String(d.descripcionMantenimientoRealizado || '').trim();
      const resp = String(d.responsableMantenimiento || '').trim();
      if (!gestion && !resp) continue;
      d.activo = true;
      d.actualizadoEn = new Date().toISOString();
      if (!d.formsResponseId && r.forms_response_id) {
        d.formsResponseId = r.forms_response_id;
      }
      await pool.query(
        `UPDATE mantenimiento_solicitud
         SET activo = 1, datos_json = ?, actualizado_en = NOW()
         WHERE id = ?`,
        [JSON.stringify(d), r.id]
      );
      reactivados += 1;
      console.log(`reactivado: ${r.folio} | ${d.nombreSolicitante || ''} | ${gestion.slice(0, 40)}`);
    }
    console.log(`reactivados con gestión: ${reactivados}`);
  }
  const after = await pool.query(
    `SELECT COUNT(*) n, SUM(activo=1) a, SUM(forms_response_id IS NOT NULL AND forms_response_id<>'') f
     FROM mantenimiento_solicitud`
  );
  console.log('despues:', after[0][0]);

  const [activos] = await pool.query(
    `SELECT id, folio, forms_response_id, activo, LEFT(datos_json, 1) dummy, datos_json
     FROM mantenimiento_solicitud WHERE activo = 1 ORDER BY folio`
  );
  for (const r of activos) {
    let d = {};
    try {
      d = typeof r.datos_json === 'string' ? JSON.parse(r.datos_json) : r.datos_json || {};
    } catch {
      d = {};
    }
    const mant = String(d.descripcionMantenimientoRealizado || '').trim();
    console.log(
      `${r.folio} | ${d.nombreSolicitante || ''} | forms=${!!r.forms_response_id} | mant=${mant.slice(0, 40)} | resp=${String(d.responsableMantenimiento || '').slice(0, 24)}`
    );
  }
  await pool.end();
}

const target = String(process.argv[2] || 'local').toLowerCase();
run(target).catch((e) => {
  console.error(e);
  process.exit(1);
});
