/**
 * Copia/fusiona mantenimiento_solicitud de PRODUCCIÓN → LOCAL
 * para comprobar la información real de Forms + manuales.
 *
 * - Gana producción en campos con valor.
 * - Local solo rellena huecos si prod viene vacío.
 * - Importa todos los activos de prod (y los inactivos con gestión).
 *
 * Uso: node backend/scripts/syncMantSolicitudesProdALocal.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const PROD = {
  host: '132.148.181.6',
  port: 3306,
  user: 'ou9c93ce6l5d_biz',
  password: 'Pr0d_B1znaga_2026!',
  database: 'ou9c93ce6l5d_biznaga'
};

const LOCAL = {
  host: process.env.DB_HOST_LOCAL || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'biznaga'
};

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function score(s) {
  if (!s) return 0;
  let n = 0;
  if (String(s.descripcionMantenimientoRealizado || '').trim()) n += 4;
  if (String(s.responsableMantenimiento || '').trim()) n += 3;
  if (String(s.fechaRealizado || '').trim()) n += 2;
  if (String(s.descripcionProblema || '').trim()) n += 2;
  if (s.reporteDriveFileId) n += 3;
  if (s.pdfFirmado && s.pdfFirmado.driveFileId) n += 3;
  if (Array.isArray(s.evidencias) && s.evidencias.length) n += Math.min(s.evidencias.length, 5);
  if (String(s.observacionesBitacora || '').trim()) n += 1;
  if (String(s.tipoInfraestructura || '').trim()) n += 1;
  if (String(s.tipoMantenimiento || '').trim()) n += 1;
  return n;
}

function rowToSol(row) {
  const d = parseJson(row.datos_json);
  const id = String(d.id || row.id || '').trim();
  const formsResponseId =
    String(d.formsResponseId || row.forms_response_id || '').trim() || undefined;
  return {
    ...d,
    id,
    folio: String(d.folio || row.folio || id).trim(),
    formsResponseId,
    activo: Number(row.activo) !== 0 && d.activo !== false && d.activo !== 0 && d.activo !== '0',
    creadoEn: String(d.creadoEn || row.creado_en || new Date().toISOString()),
    actualizadoEn: String(d.actualizadoEn || row.actualizado_en || new Date().toISOString())
  };
}

/**
 * Espejo de producción para comprobar datos.
 * Campos de gestión vienen de prod tal cual (aunque vayan vacíos).
 * Evidencias: unión (prod + local) para no perder fotos locales de prueba.
 */
function fusionProdSobreLocal(prod, local, { estricto = true } = {}) {
  const p = prod || {};
  const l = local || {};
  const out = estricto
    ? { ...p }
    : { ...l };

  if (!estricto) {
    const keys = [
      'nombreSolicitante', 'puesto', 'area', 'descripcionProblema',
      'descripcionMantenimientoRealizado', 'observacionesAdministrador',
      'tipoMantenimiento', 'fechaRealizado', 'fechaSolicitud',
      'responsableMantenimiento', 'reporteDriveFileId', 'reporteWebViewLink',
      'tipoInfraestructura', 'idSerie', 'internoExterno', 'observacionesBitacora',
      'bitacoraDriveFileId', 'bitacoraWebViewLink', 'ubicacion', 'prioridad',
      'folio', 'codigo', 'revision', 'fechaRev', 'clausula', 'formsResponseId'
    ];
    for (const k of keys) {
      const pv = p[k];
      const tieneProd = pv != null && pv !== '' && !(Array.isArray(pv) && !pv.length);
      if (tieneProd) out[k] = pv;
    }
  }

  // Metadatos de documento si prod no los trae
  for (const k of ['codigo', 'revision', 'fechaRev', 'clausula']) {
    if (!out[k] && l[k]) out[k] = l[k];
  }

  if (p.pdfFirmado && p.pdfFirmado.driveFileId) {
    out.pdfFirmado = { ...p.pdfFirmado };
  } else if (!estricto && l.pdfFirmado && l.pdfFirmado.driveFileId) {
    out.pdfFirmado = { ...l.pdfFirmado };
  } else if (estricto) {
    out.pdfFirmado = p.pdfFirmado || undefined;
  }

  const evMap = new Map();
  for (const ev of [...(l.evidencias || []), ...(p.evidencias || [])]) {
    const key = String(ev?.driveFileId || ev?.url || ev?.webViewLink || '').trim();
    if (key) evMap.set(key, ev);
  }
  out.evidencias = Array.from(evMap.values());
  out.id = String(p.id || l.id || out.id).trim();
  out.formsResponseId = p.formsResponseId || undefined;
  out.folio = String(p.folio || l.folio || out.folio).trim();
  out.activo = p.activo !== false;
  out.actualizadoEn = new Date().toISOString();
  out.creadoEn = String(
    [p.creadoEn, l.creadoEn, out.creadoEn].filter(Boolean).sort()[0] || new Date().toISOString()
  );
  out._origenSync = 'prod→local-estricto';
  out._scoreProd = score(p);
  out._scoreLocalAntes = score(l);
  return out;
}

async function loadAll(pool) {
  const [rows] = await pool.query(
    `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
     FROM mantenimiento_solicitud`
  );
  return (rows || []).map(rowToSol).filter((s) => s.id);
}

async function upsert(pool, sol) {
  const activo = sol.activo === false ? 0 : 1;
  const folio = String(sol.folio || sol.id).trim();
  const formsId = sol.formsResponseId ? String(sol.formsResponseId).trim() : null;
  const payload = { ...sol };
  delete payload._origenSync;
  delete payload._scoreProd;
  delete payload._scoreLocalAntes;
  payload.activo = activo === 1;
  await pool.query(
    `INSERT INTO mantenimiento_solicitud
      (id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       folio = VALUES(folio),
       forms_response_id = VALUES(forms_response_id),
       activo = VALUES(activo),
       datos_json = VALUES(datos_json),
       actualizado_en = NOW()`,
    [sol.id, folio, formsId, activo, JSON.stringify(payload)]
  );
}

(async () => {
  const prodPool = await mysql.createPool({ ...PROD, connectTimeout: 12000 });
  const localPool = await mysql.createPool({ ...LOCAL, connectTimeout: 8000 });

  console.log('Leyendo producción...');
  const prodList = await loadAll(prodPool);
  console.log('Leyendo local...');
  const localList = await loadAll(localPool);

  const localById = new Map(localList.map((s) => [s.id, s]));
  const localByForms = new Map();
  for (const s of localList) {
    const rid = String(s.formsResponseId || '').trim();
    if (!rid) continue;
    const prev = localByForms.get(rid);
    if (!prev || score(s) > score(prev)) localByForms.set(rid, s);
  }

  const report = [];
  const fused = [];
  const usedLocalIds = new Set();

  // 1) Traer todo lo de prod (activo o con gestión)
  for (const p of prodList) {
    const rid = String(p.formsResponseId || '').trim();
    const keep = p.activo !== false || score(p) >= 2;
    if (!keep) continue;

    let localMatch = null;
    if (localById.has(p.id)) {
      localMatch = localById.get(p.id);
    } else if (rid && localByForms.has(rid)) {
      localMatch = localByForms.get(rid);
    }

    const merged = fusionProdSobreLocal(p, localMatch);
    // Preferir id de producción para alinear entornos
    merged.id = p.id;
    if (localMatch && localMatch.id !== p.id) {
      usedLocalIds.add(localMatch.id);
      report.push({
        accion: 'fusion-forms',
        folio: merged.folio,
        prodId: p.id,
        localIdAntes: localMatch.id,
        nombre: merged.nombreSolicitante,
        scoreProd: score(p),
        scoreLocal: score(localMatch),
        scoreFinal: score(merged),
        mant: String(merged.descripcionMantenimientoRealizado || '').slice(0, 50),
        resp: String(merged.responsableMantenimiento || '').slice(0, 30)
      });
    } else {
      report.push({
        accion: localMatch ? 'actualizar' : 'importar',
        folio: merged.folio,
        prodId: p.id,
        nombre: merged.nombreSolicitante,
        scoreProd: score(p),
        scoreLocal: localMatch ? score(localMatch) : 0,
        scoreFinal: score(merged),
        mant: String(merged.descripcionMantenimientoRealizado || '').slice(0, 50),
        resp: String(merged.responsableMantenimiento || '').slice(0, 30)
      });
    }
    if (localMatch) usedLocalIds.add(localMatch.id);
    usedLocalIds.add(p.id);
    fused.push(merged);
  }

  const prodFormsIds = new Set(
    prodList.map((s) => String(s.formsResponseId || '').trim()).filter(Boolean)
  );
  const prodIds = new Set(prodList.map((s) => s.id));

  // 2) Conservar solo MANUALES locales que no existen en prod (pruebas propias).
  //    Los Forms locales viejos se ocultan para no mezclar con el espejo de prod.
  for (const l of localList) {
    if (usedLocalIds.has(l.id) || prodIds.has(l.id)) continue;
    const rid = String(l.formsResponseId || '').trim();
    if (rid) {
      // Forms local duplicado / viejo: ocultar y desligar del forms_response_id
      // para que consolidar no vuelva a mezclar lorem/pruebas con el espejo de prod.
      fused.push({
        ...l,
        activo: false,
        formsResponseId: undefined,
        _duplicadoDe: rid,
        _origenSync: 'ocultar-forms-local'
      });
      report.push({
        accion: 'ocultar-forms-local',
        folio: l.folio,
        prodId: null,
        nombre: l.nombreSolicitante,
        scoreProd: 0,
        scoreLocal: score(l),
        scoreFinal: score(l),
        mant: String(l.descripcionMantenimientoRealizado || '').slice(0, 50),
        resp: String(l.responsableMantenimiento || '').slice(0, 30)
      });
      continue;
    }
    fused.push({ ...l, _origenSync: 'solo-local-manual' });
    report.push({
      accion: 'conservar-local-manual',
      folio: l.folio,
      prodId: null,
      nombre: l.nombreSolicitante,
      scoreProd: 0,
      scoreLocal: score(l),
      scoreFinal: score(l),
      mant: String(l.descripcionMantenimientoRealizado || '').slice(0, 50),
      resp: String(l.responsableMantenimiento || '').slice(0, 30)
    });
  }

  // Aviso si algún Forms de prod no quedó
  for (const rid of prodFormsIds) {
    if (!fused.some((f) => String(f.formsResponseId || '').trim() === rid && f.activo !== false)) {
      console.warn('WARN: Forms de prod sin activo en fused:', rid.slice(0, 24));
    }
  }

  // Backup JSON de lo que se va a escribir
  const outDir = path.join(__dirname, '../../backups-mant');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(outDir, `mant-sync-prod-a-local-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ generadoEn: new Date().toISOString(), prod: prodList, localAntes: localList, fused, report }, null, 2),
    'utf8'
  );
  console.log('Respaldo JSON:', backupPath);

  console.log(`Escribiendo ${fused.length} solicitudes en local...`);
  for (const sol of fused) {
    await upsert(localPool, sol);
  }

  // Desligar en BD cualquier Forms local viejo que aún comparta forms_response_id con prod.
  for (const p of prodList) {
    const rid = String(p.formsResponseId || '').trim();
    if (!rid) continue;
    await localPool.query(
      `UPDATE mantenimiento_solicitud
       SET forms_response_id = NULL, activo = 0, actualizado_en = NOW()
       WHERE forms_response_id = ? AND id <> ?`,
      [rid, p.id]
    );
  }

  // Consolidar duplicados Forms en local
  const svc = require('../mantenimientoService');
  const cons = await svc.consolidarDuplicadosCatalogo(localPool);
  console.log('Consolidación local:', cons);

  const after = await loadAll(localPool);
  const activos = after.filter((s) => s.activo !== false);
  console.log('\n=== LOCAL DESPUÉS (activos) ===');
  for (const s of activos.sort((a, b) => String(a.folio).localeCompare(String(b.folio)))) {
    console.log(
      [
        s.folio,
        s.formsResponseId ? 'FORMS' : 'MANUAL',
        (s.nombreSolicitante || '').slice(0, 28),
        `score=${score(s)}`,
        `mant=${String(s.descripcionMantenimientoRealizado || '').slice(0, 40)}`,
        `resp=${String(s.responsableMantenimiento || '').slice(0, 24)}`
      ].join(' | ')
    );
  }
  console.log(`\nActivos: ${activos.length} | Forms: ${activos.filter((s) => s.formsResponseId).length} | Manuales: ${activos.filter((s) => !s.formsResponseId).length}`);
  console.log('\nResumen acciones:');
  const counts = report.reduce((acc, r) => {
    acc[r.accion] = (acc[r.accion] || 0) + 1;
    return acc;
  }, {});
  console.log(counts);

  // Comparación prod vs local por forms
  console.log('\n=== Comparación Forms prod ↔ local ===');
  const prodForms = prodList.filter((s) => s.formsResponseId && s.activo !== false);
  for (const p of prodForms) {
    const rid = String(p.formsResponseId).trim();
    const loc = after.find((s) => String(s.formsResponseId || '').trim() === rid && s.activo !== false);
    const okMant =
      String(p.descripcionMantenimientoRealizado || '').trim() ===
      String(loc?.descripcionMantenimientoRealizado || '').trim();
    const okResp =
      String(p.responsableMantenimiento || '').trim() ===
      String(loc?.responsableMantenimiento || '').trim();
    console.log(
      `${p.folio} | ${(p.nombreSolicitante || '').slice(0, 22)} | local=${loc ? loc.folio : 'FALTA'} | mantEq=${okMant} respEq=${okResp} | prodMant=${String(p.descripcionMantenimientoRealizado || '').slice(0, 30)}`
    );
  }

  await prodPool.end();
  await localPool.end();
  console.log('\nListo. Recarga el archivero/bitácora en local (reinicia backend si hace falta).');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
