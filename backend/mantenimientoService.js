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
  const t = String(tituloNorm || '');
  if (
    t.includes('infraestructura') ||
    t.includes('tipo de infraestructura') ||
    t.includes('tipo infraestructura') ||
    (t.includes('tipo') && t.includes('activo'))
  ) {
    return 'tipoInfraestructura';
  }
  if (t.includes('prioridad') || t.includes('urgencia') || t.includes('nivel de prioridad')) {
    return 'prioridad';
  }
  if (
    (t.includes('nombre') &&
      (t.includes('solicitante') || t.includes('reporta') || t.includes('quien') || t.includes('empleado'))) ||
    t === 'nombre' ||
    t.includes('nombre completo')
  ) {
    return 'nombreSolicitante';
  }
  if (t.includes('puesto') || t.includes('cargo')) {
    return 'puesto';
  }
  if (t.includes('area') || t.includes('departamento') || t.includes('seccion') || t.includes('sección')) {
    return 'area';
  }
  if (
    t.includes('ubicacion') ||
    t.includes('lugar') ||
    t.includes('sitio') ||
    t.includes('donde') ||
    t.includes('localizacion') ||
    t.includes('localización')
  ) {
    return 'ubicacion';
  }
  if (
    t.includes('descripcion') ||
    t.includes('problema') ||
    t.includes('detalle del reporte') ||
    t.includes('que reporta') ||
    t.includes('falla') ||
    t.includes('hallazgo') ||
    t.includes('reporte de')
  ) {
    return 'descripcionProblema';
  }
  if (t.includes('observacion') || t.includes('comentario') || t.includes('nota')) {
    return 'observaciones';
  }
  if (t.includes('fecha') && !t.includes('rev')) {
    return 'fechaSolicitud';
  }
  if (t.includes('correo') || t.includes('email')) {
    return 'correo';
  }
  if (t.includes('telefono') || t.includes('celular') || t.includes('whatsapp')) {
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

function scoreRiquezaSolicitudDb(s) {
  if (!s || typeof s !== 'object') return 0;
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

function fusionarCamposSolicitudDb(primario, secundario) {
  const a = { ...(primario || {}) };
  const b = secundario || {};
  const tomar = (key) => {
    const va = a[key];
    const vb = b[key];
    const vacio = va == null || va === '' || (Array.isArray(va) && !va.length);
    if (vacio && vb != null && vb !== '' && !(Array.isArray(vb) && !vb.length)) {
      a[key] = vb;
    }
  };
  [
    'nombreSolicitante', 'puesto', 'area', 'descripcionProblema',
    'descripcionMantenimientoRealizado', 'observacionesAdministrador',
    'tipoMantenimiento', 'fechaRealizado', 'responsableMantenimiento',
    'reporteDriveFileId', 'reporteWebViewLink', 'tipoInfraestructura',
    'idSerie', 'internoExterno', 'observacionesBitacora',
    'bitacoraDriveFileId', 'bitacoraWebViewLink', 'ubicacion', 'prioridad',
    'formsResponseId', 'folio', 'fechaSolicitud'
  ].forEach(tomar);
  if (!(a.pdfFirmado && a.pdfFirmado.driveFileId) && b.pdfFirmado && b.pdfFirmado.driveFileId) {
    a.pdfFirmado = { ...b.pdfFirmado };
  }
  const evMap = new Map();
  for (const ev of [...(b.evidencias || []), ...(a.evidencias || [])]) {
    const key = String((ev && (ev.driveFileId || ev.url || ev.webViewLink)) || '').trim();
    if (key) evMap.set(key, ev);
  }
  a.evidencias = Array.from(evMap.values());
  // Solo oculto si ambos están ocultos (recupera reportes llenos mal desactivados).
  a.activo = !(a.activo === false && b.activo === false);
  const tsA = String(a.actualizadoEn || '');
  const tsB = String(b.actualizadoEn || '');
  a.actualizadoEn = tsA >= tsB ? tsA : tsB;
  return a;
}

function preferirSolicitudDb(a, b) {
  const ta = Date.parse(String(a.actualizadoEn || '')) || 0;
  const tb = Date.parse(String(b.actualizadoEn || '')) || 0;
  const sa = scoreRiquezaSolicitudDb(a);
  const sb = scoreRiquezaSolicitudDb(b);
  let primario;
  if (Math.abs(ta - tb) > 2000) {
    primario = ta >= tb ? a : b;
  } else if (sa !== sb) {
    primario = sa > sb ? a : b;
  } else {
    primario = ta >= tb ? a : b;
  }
  const secundario = primario === a ? b : a;
  return fusionarCamposSolicitudDb(primario, secundario);
}

/**
 * Une por id y por formsResponseId. Un Forms = un reporte.
 * Evita que la bitácora/archivero listen 26 filas por 13 respuestas.
 */
function consolidarSolicitudesEnMemoria(lista) {
  const byId = new Map();
  for (const raw of lista || []) {
    const s = normalizarSolicitudDb(raw);
    if (!s?.id) continue;
    const prev = byId.get(s.id);
    byId.set(s.id, prev ? preferirSolicitudDb(prev, s) : s);
  }
  const byForms = new Map();
  const sinForms = [];
  for (const s of byId.values()) {
    const rid = String(s.formsResponseId || '').trim();
    if (!rid) {
      sinForms.push(s);
      continue;
    }
    const prev = byForms.get(rid);
    byForms.set(rid, prev ? preferirSolicitudDb(prev, s) : s);
  }
  return [...byForms.values(), ...sinForms].sort((a, b) =>
    String(b.actualizadoEn || '').localeCompare(String(a.actualizadoEn || ''))
  );
}

/**
 * Persiste consolidación: ganador queda activo (si corresponde) y perdedores se ocultan.
 */
async function consolidarDuplicadosCatalogo(pool) {
  await asegurarEsquemaSolicitudes(pool);
  const [rows] = await pool.query(
    `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
     FROM mantenimiento_solicitud`
  );
  const todas = [];
  for (const row of rows || []) {
    const parsed = normalizarSolicitudDb(parseDatosJson(row.datos_json), row);
    if (parsed) todas.push(parsed);
  }
  const consolidadas = consolidarSolicitudesEnMemoria(todas);
  const keptIds = new Set(consolidadas.map((s) => s.id));
  const formsKept = new Map(
    consolidadas
      .filter((s) => String(s.formsResponseId || '').trim())
      .map((s) => [String(s.formsResponseId).trim(), s.id])
  );

  // Por formsResponseId: si el ganador tiene gestión y había cascarones, recuperar visibilidad.
  const grupoPorForms = new Map();
  for (const raw of todas) {
    const rid = String(raw.formsResponseId || '').trim();
    if (!rid) continue;
    if (!grupoPorForms.has(rid)) grupoPorForms.set(rid, []);
    grupoPorForms.get(rid).push(raw);
  }
  for (const sol of consolidadas) {
    const rid = String(sol.formsResponseId || '').trim();
    if (!rid) continue;
    const grupo = grupoPorForms.get(rid) || [];
    if (grupo.length < 2) continue;
    const score = scoreRiquezaSolicitudDb(sol);
    const habiaCascaron = grupo.some(
      (s) => s.id !== sol.id && scoreRiquezaSolicitudDb(s) < Math.max(4, score)
    );
    const algunoActivo = grupo.some((s) => s.activo !== false);
    // Recupera reportes con gestión que quedaron ocultos por cascarones duplicados.
    if (sol.activo === false && score >= 4 && (algunoActivo || habiaCascaron)) {
      sol.activo = true;
    }
  }

  let ganadores = 0;
  let ocultos = 0;
  for (const sol of consolidadas) {
    const activo = sol.activo === false ? 0 : 1;
    const folio = String(sol.folio || '').trim() || sol.id;
    const formsId = sol.formsResponseId ? String(sol.formsResponseId).trim() : null;
    const payload = JSON.stringify({ ...sol, activo: activo === 1 });
    await pool.query(
      `UPDATE mantenimiento_solicitud
       SET folio = ?, forms_response_id = ?, activo = ?, datos_json = ?, actualizado_en = NOW()
       WHERE id = ?`,
      [folio, formsId, activo, payload, sol.id]
    );
    ganadores += 1;
  }

  for (const raw of todas) {
    const rid = String(raw.formsResponseId || '').trim();
    if (!rid || keptIds.has(raw.id)) continue;
    if (formsKept.get(rid) === raw.id) continue;
    if (!formsKept.has(rid)) continue;
    // Desliga el cascarón del forms_response_id para no volver a duplicar en bitácora.
    const datos = {
      ...raw,
      activo: false,
      formsResponseId: undefined,
      _duplicadoDe: formsKept.get(rid),
      actualizadoEn: new Date().toISOString()
    };
    await pool.query(
      `UPDATE mantenimiento_solicitud
       SET activo = 0, forms_response_id = NULL, datos_json = ?, actualizado_en = NOW()
       WHERE id = ?`,
      [JSON.stringify(datos), raw.id]
    );
    ocultos += 1;
  }

  return {
    total: todas.length,
    unicos: consolidadas.length,
    ganadores,
    ocultos,
    activos: consolidadas.filter((s) => s.activo !== false).length
  };
}

/**
 * Lista solicitudes compartidas (archivero EIN-F-04 / bitácora F-03).
 * Por defecto solo activas. Consolida duplicados de Forms al leer.
 */
async function listarSolicitudesCatalogo(pool, { incluirInactivos = false, consolidar = true } = {}) {
  await asegurarEsquemaSolicitudes(pool);
  if (consolidar) {
    try {
      await consolidarDuplicadosCatalogo(pool);
    } catch (err) {
      console.warn('[mantenimiento] consolidarDuplicadosCatalogo:', err?.message || err);
    }
  }
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
  return consolidarSolicitudesEnMemoria(solicitudes);
}

/** Upsert por id. Conserva desactivados si llegan con activo=false. Consolida Forms al final. */
async function guardarSolicitudesCatalogo(pool, lista) {
  await asegurarEsquemaSolicitudes(pool);
  const items = consolidarSolicitudesEnMemoria(Array.isArray(lista) ? lista : []);
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
  // Ocultar cascarones que el cliente ya no manda pero siguen activos como duplicado Forms.
  try {
    await consolidarDuplicadosCatalogo(pool);
  } catch (err) {
    console.warn('[mantenimiento] consolidar tras guardar:', err?.message || err);
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

/**
 * Persiste en mantenimiento_solicitud los campos del EIN-F-04 al generar el Word.
 * Evita que Drive diga “ok” y el catálogo quede sin la gestión capturada.
 */
async function aplicarCamposReporteF04AlCatalogo(pool, folio, campos = {}, reporte = null) {
  await asegurarEsquemaSolicitudes(pool);
  const folioKey = String(folio || '').trim();
  if (!folioKey || !pool) {
    return null;
  }
  const [rows] = await pool.query(
    `SELECT id, folio, forms_response_id, activo, datos_json, creado_en, actualizado_en
     FROM mantenimiento_solicitud
     WHERE folio = ? OR id = ?
     ORDER BY actualizado_en DESC
     LIMIT 8`,
    [folioKey, folioKey]
  );
  if (!rows || !rows.length) {
    return null;
  }

  const candidatas = [];
  for (const row of rows) {
    const parsed = normalizarSolicitudDb(parseDatosJson(row.datos_json), row);
    if (parsed) {
      candidatas.push(parsed);
    }
  }
  if (!candidatas.length) {
    return null;
  }
  candidatas.sort((a, b) => {
    const sa = scoreRiquezaSolicitudDb(a);
    const sb = scoreRiquezaSolicitudDb(b);
    if (sa !== sb) return sb - sa;
    return String(b.actualizadoEn || '').localeCompare(String(a.actualizadoEn || ''));
  });
  const target = candidatas[0];
  const setIfDefined = (key, value) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && !value.trim() && String(target[key] || '').trim()) {
      return;
    }
    target[key] = value;
  };

  setIfDefined(
    'descripcionMantenimientoRealizado',
    campos.descripcionMantenimientoRealizado || campos.descripcionMantenimiento
  );
  setIfDefined('descripcionProblema', campos.descripcionProblema);
  setIfDefined('tipoInfraestructura', campos.tipoInfraestructura);
  setIfDefined('tipoMantenimiento', campos.tipoMantenimiento);
  setIfDefined('fechaSolicitud', campos.fechaSolicitud);
  setIfDefined('fechaRealizado', campos.fechaRealizado);
  setIfDefined(
    'responsableMantenimiento',
    campos.responsableMantenimiento || campos.responsable
  );
  setIfDefined('nombreSolicitante', campos.nombreSolicitante);
  if (Array.isArray(campos.evidencias) && campos.evidencias.length) {
    const prev = Array.isArray(target.evidencias) ? target.evidencias : [];
    const map = new Map();
    for (const ev of [...prev, ...campos.evidencias]) {
      const key = String(ev?.driveFileId || ev?.url || ev?.webViewLink || '').trim();
      if (key) map.set(key, ev);
    }
    target.evidencias = Array.from(map.values());
  }
  if (reporte?.driveFileId) {
    target.reporteDriveFileId = reporte.driveFileId;
  }
  if (reporte?.webViewLink) {
    target.reporteWebViewLink = reporte.webViewLink;
  }
  target.actualizadoEn = new Date().toISOString();
  const activo = target.activo === false ? 0 : 1;
  const formsId = target.formsResponseId ? String(target.formsResponseId).trim() : null;
  const payload = JSON.stringify({ ...target, activo: activo === 1 });
  await pool.query(
    `UPDATE mantenimiento_solicitud
     SET folio = ?, forms_response_id = ?, activo = ?, datos_json = ?, actualizado_en = NOW()
     WHERE id = ?`,
    [String(target.folio || folioKey).trim() || folioKey, formsId, activo, payload, target.id]
  );
  return target;
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
  desactivarSolicitudCatalogo,
  aplicarCamposReporteF04AlCatalogo,
  consolidarDuplicadosCatalogo,
  consolidarSolicitudesEnMemoria
};
