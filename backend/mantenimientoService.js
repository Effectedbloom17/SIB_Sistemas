/**
 * Mantenimiento — evidencias, EIN-F-03 Bitácora, EIN-F-04, estadísticas Forms F-02.
 */

const fs = require('fs');
const path = require('path');
const driveService = require('./driveService');

const CARPETA_MANTENIMIENTO_ID =
  process.env.MANTENIMIENTO_DRIVE_FOLDER_ID || '1PSzlU-LIr4wkCZANDgDIchY6lASsPue8';

const CARPETA_FIRMADOS_F04_ID =
  process.env.EIN_F04_FIRMADOS_FOLDER_ID || '1q3COOqQEqbkZRPvHNz0l3mNZWn1TfXtx';

const CARPETA_REPORTES_F04_ID =
  process.env.EIN_F04_REPORTES_FOLDER_ID || '1q3COOqQEqbkZRPvHNz0l3mNZWn1TfXtx';

const CARPETA_ARCHIVERO_F04_ID =
  process.env.EIN_F04_ARCHIVERO_FOLDER_ID || '1TPCTKPyeN9dMdh2_FijH1WhbsMIsp267';

const EIN_F02_FORM_ID =
  process.env.EIN_F02_FORM_ID || '1JQQuYAhTah0pZkHyvM40dp1bi1s51aEXSn5rXw6zZ9Q';

function sanitizarNombre(valor) {
  return String(valor || 'archivo')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function extensionPorMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('pdf')) return '.pdf';
  return '.jpg';
}

function normalizarTexto(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clasificarCampo(tituloNorm) {
  if (tituloNorm.includes('infraestructura') || tituloNorm.includes('tipo de infraestructura')) {
    return 'tipoInfraestructura';
  }
  if (tituloNorm.includes('prioridad') || tituloNorm.includes('urgencia')) {
    return 'prioridad';
  }
  if (
    (tituloNorm.includes('nombre') &&
      (tituloNorm.includes('solicitante') || tituloNorm.includes('reporta') || tituloNorm.includes('quien'))) ||
    tituloNorm === 'nombre'
  ) {
    return 'nombreSolicitante';
  }
  if (tituloNorm.includes('puesto') || tituloNorm.includes('cargo')) {
    return 'puesto';
  }
  if (tituloNorm.includes('area') || tituloNorm.includes('área') || tituloNorm.includes('departamento')) {
    return 'area';
  }
  if (tituloNorm.includes('ubicacion') || tituloNorm.includes('ubicación') || tituloNorm.includes('lugar')) {
    return 'ubicacion';
  }
  if (
    tituloNorm.includes('descripcion') ||
    tituloNorm.includes('descripción') ||
    tituloNorm.includes('problema') ||
    tituloNorm.includes('detalle del reporte') ||
    tituloNorm.includes('que reporta')
  ) {
    return 'descripcionProblema';
  }
  if (tituloNorm.includes('observacion') || tituloNorm.includes('comentario') || tituloNorm.includes('nota')) {
    return 'observaciones';
  }
  if (tituloNorm.includes('fecha') && !tituloNorm.includes('rev')) {
    return 'fechaSolicitud';
  }
  if (tituloNorm.includes('correo') || tituloNorm.includes('email')) {
    return 'correo';
  }
  if (tituloNorm.includes('telefono') || tituloNorm.includes('teléfono') || tituloNorm.includes('celular')) {
    return 'telefono';
  }
  return null;
}

async function carpetaSolicitud(folio) {
  const nombre = sanitizarNombre(folio || `solicitud-${Date.now()}`);
  return driveService.obtenerOCrearCarpeta(nombre, CARPETA_MANTENIMIENTO_ID);
}

async function subirEvidencias(folio, archivos = []) {
  const files = Array.isArray(archivos) ? archivos.filter(Boolean) : [];
  if (!files.length) {
    const err = new Error('No se recibieron archivos');
    err.status = 400;
    throw err;
  }
  if (!folio) {
    const err = new Error('Folio obligatorio');
    err.status = 400;
    throw err;
  }

  const carpetaId = await carpetaSolicitud(folio);
  const subidas = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mime = String(file.mimetype || 'image/jpeg');
    const ext = extensionPorMime(mime);
    const nombre = `${sanitizarNombre(folio)}_ev-${Date.now()}-${i + 1}${ext}`;
    const subido = await driveService.subirArchivoNuevo(file.buffer, nombre, mime, carpetaId);
    const driveFileId = subido.id;
    subidas.push({
      driveFileId,
      nombre: subido.name || nombre,
      mime,
      webViewLink: subido.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`,
      url: `https://drive.google.com/uc?id=${driveFileId}&export=download`,
      previewUrl: `/api/drive-preview/${driveFileId}`
    });
  }

  return { carpetaId, evidencias: subidas };
}

async function eliminarEvidencia(driveFileId) {
  if (!driveFileId) return false;
  return driveService.eliminarArchivo(driveFileId);
}

async function subirPdfFirmadoF04(folio, archivo) {
  if (!archivo?.buffer) {
    const err = new Error('No se recibió el PDF');
    err.status = 400;
    throw err;
  }
  const mime = String(archivo.mimetype || 'application/pdf');
  if (!mime.includes('pdf')) {
    const err = new Error('Solo se acepta PDF');
    err.status = 400;
    throw err;
  }
  const nombre = sanitizarNombre(
    archivo.originalname || `EIN-F-04 ${folio || 'reporte'} firmado.pdf`
  ).replace(/\.pdf$/i, '') + '.pdf';

  const subido = await driveService.subirArchivoNuevo(
    archivo.buffer,
    nombre,
    'application/pdf',
    CARPETA_FIRMADOS_F04_ID
  );
  const driveFileId = subido.id;
  return {
    driveFileId,
    nombreArchivo: subido.name || nombre,
    webViewLink: subido.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`,
    fechaSubida: new Date().toISOString(),
    carpetaId: CARPETA_FIRMADOS_F04_ID
  };
}

async function generarSolicitudEinF02(datos = {}) {
  return driveService.generarSolicitudMantenimientoEinF02({
    folio: datos.folio,
    nombreSolicitante: datos.nombreSolicitante,
    puesto: datos.puesto,
    area: datos.area,
    fechaSolicitud: datos.fechaSolicitud,
    descripcionProblema: datos.descripcionProblema || datos.descripcion,
    observacionesAdministrador: datos.observacionesAdministrador || datos.observaciones,
    nombreArchivo: datos.nombreArchivo,
    carpetaDestinoId: CARPETA_MANTENIMIENTO_ID
  });
}

async function leerProgramaEinF01() {
  return driveService.leerProgramaMantenimientoEinF01({});
}

async function generarProgramaEinF01(datos = {}) {
  return driveService.generarProgramaMantenimientoEinF01({
    meta: datos.meta,
    filas: datos.filas,
    anio: datos.anio,
    spreadsheetId: datos.spreadsheetId,
    nombreArchivo: datos.nombreArchivo,
    carpetaDestinoId: CARPETA_MANTENIMIENTO_ID
  });
}

async function generarBitacoraEinF03(datos = {}) {
  return driveService.generarBitacoraMantenimientoEinF03({
    folio: datos.folio,
    filas: datos.filas,
    spreadsheetId: datos.spreadsheetId,
    tipoInfraestructura: datos.tipoInfraestructura,
    idSerie: datos.idSerie,
    tipoMantenimiento: datos.tipoMantenimiento,
    internoExterno: datos.internoExterno,
    actividades: datos.actividades || datos.descripcionProblema,
    responsable: datos.responsable || datos.responsableMantenimiento,
    fechaRealizado: datos.fechaRealizado,
    observaciones: datos.observaciones || datos.observacionesBitacora,
    nombreArchivo: datos.nombreArchivo,
    carpetaDestinoId: CARPETA_MANTENIMIENTO_ID
  });
}

async function descargarPdfReporteEinF04(datos = {}) {
  const reporte = await generarReporteEinF04(datos);
  const driveFileId = reporte?.driveFileId;
  if (!driveFileId) {
    const err = new Error('No se pudo generar el documento EIN-F-04');
    err.status = 500;
    throw err;
  }
  const pdfBuffer = await driveService.exportarArchivoPDF(driveFileId);
  const folio = String(datos.folio || 'reporte').trim();
  return {
    buffer: pdfBuffer,
    nombreArchivo: `EIN-F-04 ${folio}.pdf`,
    reporte
  };
}

async function generarReporteEinF04(datos = {}) {
  return driveService.generarReporteMantenimientoEinF04({
    folio: datos.folio,
    descripcionMantenimiento:
      datos.descripcionMantenimiento || datos.descripcionMantenimientoRealizado || '',
    evidencias: datos.evidencias || [],
    tipoMantenimiento: datos.tipoMantenimiento || 'Correctivo',
    fechaSolicitud: datos.fechaSolicitud,
    fechaRealizado: datos.fechaRealizado,
    responsable: datos.responsable || '',
    nombreSolicitante: datos.nombreSolicitante,
    nombreArchivo: datos.nombreArchivo || datos.folio,
    carpetaDestinoId: CARPETA_REPORTES_F04_ID,
    carpetaArchiveroId: CARPETA_ARCHIVERO_F04_ID,
    documentId: datos.documentId || datos.reporteDriveFileId,
    insertarLogo: datos.insertarLogo === true,
  });
}

function emptyStats(extra = {}) {
  return {
    total: 0,
    esteMes: 0,
    porInfraestructura: [],
    porPrioridad: [],
    porUbicacion: [],
    graficos: [],
    textos: [],
    recientes: [],
    casos: [],
    ...extra
  };
}

/**
 * Estadísticas + casos mapeados del Google Form EIN-F-02.
 */
async function obtenerEstadisticasFormsF02() {
  const formId = EIN_F02_FORM_ID;
  let googleFormsService;
  try {
    googleFormsService = require('./googleFormsService');
  } catch (err) {
    return emptyStats({
      fuente: 'sin_servicio',
      mensaje: 'Servicio de Google Forms no disponible.'
    });
  }

  if (googleFormsService.authMethod === 'none') {
    return emptyStats({
      fuente: 'sin_auth',
      mensaje: 'Google Forms no autenticado. Configura OAuth con scope forms.responses.readonly.'
    });
  }

  try {
    const pack = await googleFormsService.obtenerFormularioConRespuestas(formId);
    const responses = Array.isArray(pack.responses) ? pack.responses : [];
    const preguntas = Array.isArray(pack.preguntas) ? pack.preguntas : [];

    const preguntaByQid = new Map();
    for (const p of preguntas) {
      if (p?.questionId) {
        preguntaByQid.set(p.questionId, p);
      }
    }

    const contadoresChoice = new Map(); // qid -> Map(label -> count)
    const muestrasText = new Map(); // qid -> string[]
    const porInfra = new Map();
    const porPrio = new Map();
    const porUbic = new Map();
    let esteMes = 0;
    const ahora = new Date();
    const mesActual = ahora.getMonth();
    const anioActual = ahora.getFullYear();
    const casos = [];

    const valorRespuesta = (answer) => {
      const vals = (answer?.textAnswers?.answers || [])
        .map((a) => String(a?.value || '').trim())
        .filter(Boolean);
      return vals;
    };

    const bump = (map, key) => {
      const k = String(key || 'Sin dato').trim() || 'Sin dato';
      map.set(k, (map.get(k) || 0) + 1);
    };

    for (const response of responses) {
      const answers = response?.answers || {};
      const campos = {
        nombreSolicitante: '',
        puesto: '',
        area: '',
        ubicacion: '',
        tipoInfraestructura: '',
        descripcionProblema: '',
        prioridad: '',
        observaciones: '',
        fechaSolicitud: '',
        correo: '',
        telefono: ''
      };
      const respuestasPlano = {};

      for (const answer of Object.values(answers)) {
        const qid = answer?.questionId;
        const pregunta = preguntaByQid.get(qid);
        const titulo = String(pregunta?.title || '');
        const tituloNorm = normalizarTexto(titulo);
        const vals = valorRespuesta(answer);
        if (!vals.length) continue;
        const valor = vals.join(', ');
        respuestasPlano[titulo || qid] = valor;

        const campo = clasificarCampo(tituloNorm);
        if (campo && !campos[campo]) {
          campos[campo] = valor;
        }

        if (pregunta?.type === 'choice') {
          if (!contadoresChoice.has(qid)) contadoresChoice.set(qid, new Map());
          const m = contadoresChoice.get(qid);
          for (const v of vals) bump(m, v);
        } else {
          if (!muestrasText.has(qid)) muestrasText.set(qid, []);
          const arr = muestrasText.get(qid);
          for (const v of vals) {
            if (arr.length < 12 && !arr.includes(v)) arr.push(v);
          }
        }
      }

      if (campos.tipoInfraestructura) bump(porInfra, campos.tipoInfraestructura);
      if (campos.prioridad) bump(porPrio, campos.prioridad);
      if (campos.ubicacion) bump(porUbic, campos.ubicacion);

      const ts = response?.lastSubmittedTime || response?.createTime || '';
      if (ts) {
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime()) && d.getMonth() === mesActual && d.getFullYear() === anioActual) {
          esteMes += 1;
        }
        if (!campos.fechaSolicitud) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          if (!Number.isNaN(d.getTime())) {
            campos.fechaSolicitud = `${y}-${m}-${day}`;
          }
        }
      }

      casos.push({
        formsResponseId: String(response?.responseId || response?.id || `${ts}-${campos.nombreSolicitante}`),
        fechaEnvio: ts,
        ...campos,
        respuestas: respuestasPlano
      });
    }

    casos.sort((a, b) => String(b.fechaEnvio).localeCompare(String(a.fechaEnvio)));

    const toArr = (map) =>
      Array.from(map.entries())
        .map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);

    const graficos = [];
    const textos = [];

    for (const p of preguntas) {
      const qid = p.questionId;
      const titulo = String(p.title || 'Pregunta');
      if (p.type === 'choice') {
        const m = contadoresChoice.get(qid) || new Map();
        const datos = toArr(m);
        if (!datos.length) continue;
        graficos.push({
          questionId: qid,
          titulo,
          tipo: 'choice',
          total: datos.reduce((a, x) => a + x.cantidad, 0),
          datos
        });
      } else {
        const muestras = muestrasText.get(qid) || [];
        if (!muestras.length) continue;
        textos.push({
          questionId: qid,
          titulo,
          tipo: 'text',
          totalRespuestas: muestras.length,
          muestras
        });
      }
    }

    return {
      total: responses.length,
      esteMes,
      porInfraestructura: toArr(porInfra),
      porPrioridad: toArr(porPrio),
      porUbicacion: toArr(porUbic),
      graficos,
      textos,
      recientes: casos.slice(0, 10).map((c) => ({
        fecha: c.fechaEnvio,
        nombre: c.nombreSolicitante,
        infraestructura: c.tipoInfraestructura,
        prioridad: c.prioridad,
        ubicacion: c.ubicacion,
        descripcion: c.descripcionProblema
      })),
      casos,
      fuente: 'google_forms',
      mensaje: responses.length
        ? undefined
        : 'El formulario aún no tiene respuestas registradas.'
    };
  } catch (err) {
    const msg = String(err?.message || err || '');
    const scopeIssue =
      /insufficient|scope|permission|403|401/i.test(msg) ||
      msg.toLowerCase().includes('insufficient authentication scopes');
    return emptyStats({
      fuente: 'error',
      mensaje: scopeIssue
        ? 'Faltan permisos OAuth de Forms. Regenera el token con forms.responses.readonly.'
        : `No se pudieron leer las respuestas: ${msg.slice(0, 180)}`
    });
  }
}

/** Ruta local del logo Biznaga (para insertar en Docs). */
function rutaLogoBiznaga() {
  const candidatos = [
    path.join(__dirname, '../src/assets/img/logo_biznaga.png'),
    path.join(__dirname, '../../src/assets/img/logo_biznaga.png')
  ];
  for (const p of candidatos) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let esquemaSolicitudesListo = false;

async function asegurarEsquemaSolicitudes(pool) {
  if (esquemaSolicitudesListo || !pool) {
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mantenimiento_solicitud (
      id VARCHAR(80) NOT NULL PRIMARY KEY,
      folio VARCHAR(80) NOT NULL,
      forms_response_id VARCHAR(160) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      datos_json LONGTEXT NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mant_sol_folio (folio),
      INDEX idx_mant_sol_activo (activo),
      INDEX idx_mant_sol_forms (forms_response_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  esquemaSolicitudesListo = true;
}

function parseDatosJson(raw) {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'object') {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function normalizarSolicitudDb(raw, meta = {}) {
  const base = raw && typeof raw === 'object' ? { ...raw } : {};
  const id = String(base.id || meta.id || '').trim();
  if (!id) {
    return null;
  }
  const activoMeta =
    meta.activo === undefined || meta.activo === null
      ? undefined
      : Number(meta.activo) !== 0;
  return {
    ...base,
    id,
    folio: String(base.folio || meta.folio || '').trim(),
    formsResponseId: base.formsResponseId
      ? String(base.formsResponseId)
      : meta.forms_response_id
        ? String(meta.forms_response_id)
        : undefined,
    activo: activoMeta === undefined
      ? base.activo !== false && base.activo !== 0 && base.activo !== '0'
      : activoMeta,
    creadoEn: String(base.creadoEn || meta.creado_en || new Date().toISOString()),
    actualizadoEn: String(
      base.actualizadoEn || meta.actualizado_en || new Date().toISOString()
    )
  };
}

/**
 * Lista solicitudes compartidas (archivero EIN-F-04 / bitácora F-03).
 * Por defecto solo activas.
 */
async function listarSolicitudesCatalogo(pool, { incluirInactivos = false } = {}) {
  await asegurarEsquemaSolicitudes(pool);
  const sql = incluirInactivos
    ? `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
       FROM mantenimiento_solicitud
       ORDER BY actualizado_en DESC`
    : `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
       FROM mantenimiento_solicitud
       WHERE activo = 1
       ORDER BY actualizado_en DESC`;
  const [rows] = await pool.query(sql);
  const solicitudes = [];
  for (const row of rows || []) {
    const parsed = normalizarSolicitudDb(parseDatosJson(row.datos_json), row);
    if (parsed) {
      solicitudes.push(parsed);
    }
  }
  return solicitudes;
}

/** Upsert por id. Conserva desactivados si llegan con activo=false. */
async function guardarSolicitudesCatalogo(pool, lista) {
  await asegurarEsquemaSolicitudes(pool);
  const items = Array.isArray(lista) ? lista : [];
  let guardados = 0;
  for (const raw of items) {
    const sol = normalizarSolicitudDb(raw);
    if (!sol?.id) {
      continue;
    }
    const activo = sol.activo === false ? 0 : 1;
    const folio = String(sol.folio || '').trim() || sol.id;
    const formsId = sol.formsResponseId ? String(sol.formsResponseId).trim() : null;
    const payload = JSON.stringify({ ...sol, activo: activo === 1 });
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
      [sol.id, folio, formsId, activo, payload]
    );
    guardados += 1;
  }
  return { guardados };
}

async function desactivarSolicitudCatalogo(pool, id) {
  await asegurarEsquemaSolicitudes(pool);
  const key = String(id || '').trim();
  if (!key) {
    const err = new Error('Id de solicitud requerido');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
     FROM mantenimiento_solicitud WHERE id = ? LIMIT 1`,
    [key]
  );
  const row = rows && rows[0];
  if (!row) {
    const err = new Error('Solicitud no encontrada');
    err.status = 404;
    throw err;
  }
  const datos = normalizarSolicitudDb(parseDatosJson(row.datos_json), row) || {
    id: key,
    folio: row.folio,
    activo: false
  };
  datos.activo = false;
  datos.actualizadoEn = new Date().toISOString();
  await pool.query(
    `UPDATE mantenimiento_solicitud
     SET activo = 0, datos_json = ?, actualizado_en = NOW()
     WHERE id = ?`,
    [JSON.stringify(datos), key]
  );
  return datos;
}

module.exports = {
  CARPETA_MANTENIMIENTO_ID,
  CARPETA_FIRMADOS_F04_ID,
  EIN_F02_FORM_ID,
  subirEvidencias,
  eliminarEvidencia,
  subirPdfFirmadoF04,
  generarSolicitudEinF02,
  leerProgramaEinF01,
  generarProgramaEinF01,
  generarBitacoraEinF03,
  generarReporteEinF04,
  descargarPdfReporteEinF04,
  obtenerEstadisticasFormsF02,
  carpetaSolicitud,
  rutaLogoBiznaga,
  listarSolicitudesCatalogo,
  guardarSolicitudesCatalogo,
  desactivarSolicitudCatalogo
};
