/**
 * SGC-F-01 · Lista maestra de documentos controlados
 *
 * GET es intencionalmente liviano: catálogo / persistido + 1 SELECT a metadatos.
 * NO llama asegurarTabla en el GET (eso bloqueaba la UI).
 *
 * Edición de una fila: actualiza la lista maestra y propaga revisión/fecha
 * al documento original en sgc_formato_metadatos (sin borrar sus campos).
 */
const startupLog = require('./startupLog');
const CODIGO_FORMATO = 'SGC-F-01';
const TEMPLATE_DRIVE_ID = '1NAgUvvargXH3dkICZ0WQePJvt2Q3zUmbApAbwBhr6WY';
const DRIVE_FILE_ID_SISTEMA = '1NAgUvvargXH3dkICZ0WQePJvt2Q3zUmbApAbwBhr6WY';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-01 Lista maestra de documentos controlados (sistema)';
const RESPONSABLE_DEFAULT = 'Ejecutivo de Sist. Gest. y Cap.';
const TIMEZONE_MEXICO = 'America/Mexico_City';

function doc(area, tipoDocumento, especie, codigo, versionVigente, fechaRevision, nombreDocumento, responsable = RESPONSABLE_DEFAULT) {
  return {
    area,
    tipoDocumento,
    especie,
    codigo,
    versionVigente,
    fechaRevision,
    nombreDocumento,
    responsable,
    vigente: true,
    fuenteVersion: 'catalogo',
    enSistema: false
  };
}

const CATALOGO_BASE = [
  doc("SGC", "Interno", "Procedimiento", "SGC-P-01", "00", "2024-08-01", "Control de la información documentada"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-02", "00", "2025-01-13", "No conformidad y acciones correctivas"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-03", "00", "2025-01-14", "Auditoría interna"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-04", "00", "2025-01-16", "Gestión de riesgos y oportunidades"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-05", "00", "2025-01-17", "Mejora"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-06", "00", "2025-01-20", "Revisión por la dirección"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-07", "00", "2025-01-21", "Equipos de medición"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-08", "01", "2026-04-27", "Satisfacción del cliente"),
  doc("SGC", "Interno", "Procedimiento", "SGC-P-09", "00", "2025-07-28", "Proveeduría externa"),
  doc("EIN", "Interno", "Procedimiento", "EIN-P-01", "00", "2026-05-22", "Mantenimiento a la infraestructura"),
  doc("ATH", "Interno", "Procedimiento", "ATH-P-01", "00", "2026-02-09", "Reclutamiento, selección y contratación"),
  doc("ATH", "Interno", "Procedimiento", "ATH-P-02", "01", "2026-03-20", "Competencia y capacitación"),
  doc("ATH", "Interno", "Procedimiento", "ATH-P-03", "01", "2026-05-19", "Cotización, contrato, pago y facturación"),
  doc("ATH", "Interno", "Procedimiento", "ATH-P-04", "00", "2026-03-02", "Desarrollo organizacional"),
  doc("SP", "Interno", "Procedimiento", "SP-P-01", "02", "2026-05-12", "Consultoría estratégica"),
  doc("SP", "Interno", "Procedimiento", "SP-P-02", "02", "2026-04-22", "Capacitación empresarial"),
  doc("SP", "Interno", "Procedimiento", "SP-P-03", "02", "2025-11-07", "Trámites"),
  doc("SP", "Interno", "Procedimiento", "SP-P-04", "00", "2025-08-14", "Medición de tierras físicas"),
  doc("SP", "Interno", "Procedimiento", "SP-P-05", "00", "2025-08-15", "Verificación de los niveles de ruido"),
  doc("SP", "Interno", "Procedimiento", "SP-P-06", "00", "2025-08-15", "Verificación de los niveles de iluminación"),
  doc("SP", "Interno", "Procedimiento", "SP-P-07", "00", "2026-07-13", "Programa interno de protección civil"),
  doc("SGC", "Interno", "Formato", "SGC-F-01", "00", "2024-08-01", "Lista maestra de documentos controlados"),
  doc("SGC", "Interno", "Formato", "SGC-F-02", "00", "2024-08-01", "Solicitud de cambios a documentos"),
  doc("SGC", "Interno", "Formato", "SGC-F-03", "00", "2024-08-01", "Lista de distribución de documentos"),
  doc("SGC", "Interno", "Formato", "SGC-F-04", "02", "2026-08-05", "Reporte de no conformidad"),
  doc("SGC", "Interno", "Formato", "SGC-F-05", "00", "2025-01-13", "Bitácora de no conformidades"),
  doc("SGC", "Interno", "Formato", "SGC-F-06", "00", "2025-01-14", "Lista y calificación de auditores internos"),
  doc("SGC", "Interno", "Formato", "SGC-F-07", "00", "2025-01-14", "Programa de auditoría"),
  doc("SGC", "Interno", "Formato", "SGC-F-08", "00", "2025-01-14", "Plan de auditoría"),
  doc("SGC", "Interno", "Formato", "SGC-F-09", "00", "2025-01-14", "Lista de verificación"),
  doc("SGC", "Interno", "Formato", "SGC-F-10", "00", "2025-01-14", "Informe de auditoría"),
  doc("SGC", "Interno", "Formato", "SGC-F-11", "00", "2025-01-16", "AMEF"),
  doc("SGC", "Interno", "Formato", "SGC-F-12", "00", "2025-01-17", "Notificación de cambios al SGC"),
  doc("SGC", "Interno", "Formato", "SGC-F-13", "00", "2025-01-17", "Plan de acción"),
  doc("SGC", "Interno", "Formato", "SGC-F-14", "00", "2025-01-17", "Bitácora de proyectos de mejora"),
  doc("SGC", "Interno", "Formato", "SGC-F-15", "00", "2025-01-20", "Análisis y evaluación de indicadores"),
  doc("SGC", "Interno", "Formato", "SGC-F-16", "00", "2021-01-13", "Minuta"),
  doc("SGC", "Interno", "Formato", "SGC-F-17", "00", "2025-01-21", "Bitácora de calibración y verificación de equipos de medición"),
  doc("SGC", "Interno", "Formato", "SGC-F-18", "00", "2025-07-03", "Tabla de requisitos legales y reglamentarios"),
  doc("SGC", "Interno", "Formato", "SGC-F-19", "00", "2025-01-20", "Listado de conocimientos de la organización"),
  doc("SGC", "Interno", "Formato", "SGC-F-20", "00", "2025-01-20", "Ficha de conocimientos"),
  doc("SGC", "Interno", "Formato", "SGC-F-21", "00", "2025-01-20", "Tablero de comunicación"),
  doc("SGC", "Interno", "Formato", "SGC-F-22", "00", "2025-01-20", "Registro de daño o pérdida de propiedad del cliente o proveedor"),
  doc("SGC", "Interno", "Formato", "SGC-F-23", "00", "2025-01-20", "Aviso de privacidad de datos personales"),
  doc("SGC", "Interno", "Formato", "SGC-F-24", "00", "2025-01-20", "Control de cambios"),
  doc("SGC", "Interno", "Formato", "SGC-F-25", "00", "2025-01-20", "Actividades posteriores a la entrega"),
  doc("SGC", "Interno", "Formato", "SGC-F-26", "00", "2025-01-24", "Cuestionario de satisfacción del cliente"),
  doc("SGC", "Interno", "Formato", "SGC-F-27", "00", "2025-07-18", "Orden de compra", "Ger. Administración y TH"),
  doc("SGC", "Interno", "Formato", "SGC-F-28", "00", "2025-01-23", "Comparativa de proveedores", "Ger. Administración y TH"),
  doc("SGC", "Interno", "Formato", "SGC-F-29", "00", "2025-01-23", "Evaluación de proveedores"),
  doc("SGC", "Interno", "Formato", "SGC-F-30", "00", "2025-01-23", "Encuesta de satisfacción del proveedor"),
  doc("SGC", "Interno", "Formato", "SGC-F-33", "00", "2022-05-17", "Lista de asistencia"),
  doc("SP", "Interno", "Formato", "SP-F-01", "01", "2025-01-08", "Listado maestro de documentación a solicitar", "Colaborador"),
  doc("SP", "Interno", "Formato", "SP-F-02", "00", "2021-08-05", "Reporte de visita y recorrido", "Consultor"),
  doc("SP", "Interno", "Formato", "SP-F-03", "01", "2025-10-08", "Control de entrega de documentos", "Colaborador"),
  doc("SP", "Interno", "Formato", "SP-F-04", "00", "2020-10-13", "Control de proyectos Biznaga", "Dirección General"),
  doc("SP", "Interno", "Formato", "SP-F-05", "01", "2025-01-08", "Control de avance de proyecto", "Consultor"),
  doc("SP", "Interno", "Formato", "SP-F-06", "00", "2025-01-07", "Listado básico para diagnóstico situacional", "Consultor"),
  doc("SP", "Interno", "Formato", "SP-F-07", "00", "2025-01-08", "Plan del curso", "Instructor"),
  doc("SP", "Interno", "Formato", "SP-F-08", "00", "2025-01-08", "Lista de verificación de necesidades para el curso", "Instructor"),
  doc("SP", "Interno", "Formato", "SP-F-09", "00", "2025-01-08", "Evaluación diagnóstica", "Instructor"),
  doc("SP", "Interno", "Formato", "SP-F-10", "00", "2025-01-08", "Evaluación del aprendizaje", "Instructor"),
  doc("SP", "Interno", "Formato", "SP-F-11", "01", "2025-10-16", "Informe final del curso", "Instructor"),
  doc("SP", "Interno", "Formato", "SP-F-12", "00", "2025-01-08", "Solicitud de datos del participante"),
  doc("SP", "Interno", "Formato", "SP-F-13", "00", "2025-01-08", "Control de capacitación empresarial"),
  doc("SP", "Interno", "Formato", "SP-F-14", "00", "2025-01-24", "Instrumento de satisfacción del curso"),
  doc("SP", "Interno", "Formato", "SP-F-15", "00", "2025-08-13", "Control de oficios", "Dirección General"),
  doc("SP", "Interno", "Formato", "SP-F-16", "00", "2025-08-14", "Reconocimiento de red de puesta a tierra", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-17", "00", "2025-08-14", "Hoja de campo", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-18", "00", "2025-08-14", "Cálculos de la resistencia de puesta a tierra para cada punto", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-19", "00", "2025-08-14", "Resumen de los resultados de la medición de la resistencia a tierra", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-20", "00", "2025-08-15", "Registro del NS(A) o NSCE(A,T)", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-21", "00", "2025-08-15", "Gráfica de los NS(A) por punto", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-22", "00", "2025-08-15", "Registro de los NPA por bandas de octava", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-23", "00", "2025-08-15", "Registro del espectro acústico", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-24", "00", "2025-08-15", "Registro de evaluación personal", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-25", "00", "2025-08-15", "Hoja de reconocimiento de condiciones de iluminación", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-26", "00", "2025-08-15", "Resultados de la medición", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-27", "00", "2025-08-15", "Informe de resultados del estudio de iluminación", "Técnico verificador"),
  doc("SP", "Interno", "Formato", "SP-F-28", "00", "2025-11-07", "Control de estatus de trámites", "Consultores"),
  doc("SP", "Interno", "Formato", "SP-F-29", "00", "2026-01-19", "Control de resolutivos PIPC"),
  doc("EIN", "Interno", "Formato", "EIN-F-01", "00", "2025-01-22", "Programa de mantenimiento a la infraestructura", "Gerente Estrategias e innovación"),
  doc("EIN", "Interno", "Formato", "EIN-F-02", "00", "2025-01-22", "Solicitud de mantenimiento"),
  doc("EIN", "Interno", "Formato", "EIN-F-03", "00", "2025-01-22", "Bitácora de mantenimiento", "Gerente Estrategias e innovación"),
  doc("ATH", "Interno", "Formato", "ATH-F-01", "00", "2025-07-09", "Organigrama", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-02", "00", "2025-07-10", "Descripción y perfil de puesto", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-03", "00", "2026-02-09", "Entrega - recepción de EPP", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-04", "00", "2025-01-27", "Lista de documentos para contratación", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-05", "00", "", "Contrato laboral", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-06", "00", "2025-01-28", "DNC", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-07", "00", "2025-01-28", "Programa de capacitación", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-08", "00", "2026-01-26", "Eficacia de la capacitación", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-09", "01", "2025-08-25", "Cotización", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-10", "00", "", "Contrato de prueba", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-11", "00", "2026-03-04", "Evaluación de desempeño", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-12", "00", "2026-03-17", "Reglamento interno de trabajo", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-13", "00", "2026-03-17", "Solicitud de vacaciones", "Gerente de Admón y Talento Humano"),
  doc("ATH", "Interno", "Formato", "ATH-F-14", "00", "2026-03-17", "Control de vacaciones", "Gerente de Admón y Talento Humano"),
  doc("DG", "Interno", "Formato", "DG-F-01", "00", "2025-01-20", "Mapa de procesos", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-02", "00", "2025-07-11", "Alcance", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-03", "00", "2025-07-10", "Objetivos de calidad", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-04", "00", "2025-01-21", "Análisis FODA", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-05", "00", "2025-01-21", "Listado de partes interesadas y sus requisitos", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-06", "00", "2025-01-21", "Cuadro de mando para objetivos de calidad e indicadores", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-07", "00", "2025-01-21", "Caracterización de procesos", "Dirección General"),
  doc("DG", "Interno", "Formato", "DG-F-08", "00", "2026-03-17", "Filosofía Biznaga Risk and Tech", "Dirección General"),
  doc("Dirección General", "Interno", "Política", "SGC-PO-01", "00", "2025-07-09", "Política de calidad"),
  doc("Dirección General", "Interno", "Política", "SGC-PO-02", "00", "2025-07-09", "Política de protección de propiedad del cliente o proveedor"),
  doc("Admón y Talento Humano", "Interno", "Instructivo", "SGC-I-01", "00", "2026-06-03", "Número de cotización y número de proyecto", "Ger. Admón y Talento Humano"),
  doc("SGC", "Interno", "Instructivo", "SGC-I-02", "00", "2026-06-03", "Folio para no conformidades"),
  doc("SGC", "Interno", "Instructivo", "SGC-I-03", "00", "2026-06-03", "Folio para proyectos de mejora"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2025-01-16", "Metodología AMEF"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2025-01-21", "Norma Internacional ISO 9001:2015 Requisitos"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2025-01-21", "Norma Internacional ISO 9000:2015 Fundamentos y vocabulario"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2025-01-21", "Norma Internacional ISO 19011:2018 Directrices para auditar sistemas de gestión"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2025-10-15", "Técnicas para identificar la causa raíz para hallazgos de auditoría"),
  doc("SGC", "Externo", "Documento externo", "", "Sí", "2026-02-17", "Manual del MOCEBPASS para hospitales")
];

const ORDEN_SECCION = [
  'Procedimiento',
  'Formato',
  'Política',
  'Instructivo',
  'Documento',
  'Externo',
  'Documento externo',
  'Manual',
  'Registro',
  'Otro'
];

function formatearFechaIso(fecha) {
  if (!fecha) return '';
  const texto = String(fecha).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) {
    const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      let year = m[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
    return texto.slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(d);
}

function fechaHoyIso() {
  return formatearFechaIso(new Date());
}

function normalizarRevision(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  if (/^(sí|si|vigente)$/i.test(texto)) return 'Sí';
  if (/^(n\/a|na)$/i.test(texto)) return 'N/A';
  const m = texto.match(/^(\d{1,3})$/);
  if (m) return String(parseInt(m[1], 10)).padStart(2, '0');
  const m2 = texto.match(/(\d{1,3})\s*$/);
  if (m2 && /^\d/.test(texto)) return String(parseInt(m2[1], 10)).padStart(2, '0');
  return texto.slice(0, 12);
}

function parsearVigente(valor) {
  if (valor === false || valor === 0 || valor === '0') return false;
  if (typeof valor === 'string') {
    const t = valor.trim().toLowerCase();
    if (['false', 'no', 'inactivo', 'obsoleto', 'baja'].includes(t)) return false;
  }
  return true;
}

function esDocumentoExterno(item = {}) {
  const tipo = String(item.tipoDocumento || item.tipo || '').trim().toLowerCase();
  const especie = String(item.especie || '').trim().toLowerCase();
  const codigo = String(item.codigo || '').trim().toUpperCase();
  return tipo === 'externo'
    || especie === 'documento externo'
    || especie === 'externo'
    || /^EXT-\d+$/.test(codigo);
}

function claveFila(item = {}) {
  const codigo = String(item.codigo || '').trim().toUpperCase();
  if (codigo && !esDocumentoExterno(item) && !/^EXT-\d+$/.test(codigo)) {
    return `c:${codigo}`;
  }
  const nombre = String(item.nombreDocumento || item.nombre || '').trim().toLowerCase();
  return nombre ? `n:${nombre}` : '';
}

function sanitizarFila(item = {}) {
  const codigoRaw = String(item.codigo || '').trim().toUpperCase();
  const externo = esDocumentoExterno(item);
  return {
    area: String(item.area || '').trim(),
    tipoDocumento: String(item.tipoDocumento || item.tipo || (externo ? 'Externo' : 'Interno')).trim()
      || (externo ? 'Externo' : 'Interno'),
    especie: String(item.especie || (externo ? 'Documento externo' : '')).trim(),
    codigo: externo || /^EXT-\d+$/.test(codigoRaw) ? '' : codigoRaw,
    versionVigente: normalizarRevision(item.versionVigente || item.revision || item.version) || '00',
    fechaRevision: formatearFechaIso(item.fechaRevision || item.fecha_revision || ''),
    nombreDocumento: String(item.nombreDocumento || item.nombre || '').trim(),
    responsable: String(item.responsable || RESPONSABLE_DEFAULT).trim() || RESPONSABLE_DEFAULT,
    vigente: parsearVigente(item.vigente),
    fuenteVersion: item.fuenteVersion === 'sistema' ? 'sistema' : 'catalogo',
    enSistema: Boolean(item.enSistema)
  };
}

function indiceCatalogo(filaOCodigo) {
  if (filaOCodigo && typeof filaOCodigo === 'object') {
    const c = String(filaOCodigo.codigo || '').trim().toUpperCase();
    if (c) {
      const byCode = CATALOGO_BASE.findIndex((row) => String(row.codigo).toUpperCase() === c);
      if (byCode >= 0) return byCode;
    }
    const n = String(filaOCodigo.nombreDocumento || '').trim().toLowerCase();
    if (n) {
      return CATALOGO_BASE.findIndex((row) => String(row.nombreDocumento).trim().toLowerCase() === n);
    }
    return -1;
  }
  const c = String(filaOCodigo || '').trim().toUpperCase();
  if (!c) return -1;
  return CATALOGO_BASE.findIndex((row) => String(row.codigo).toUpperCase() === c);
}

function ordenSeccion(especie) {
  const idx = ORDEN_SECCION.findIndex((e) => e.toLowerCase() === String(especie || '').toLowerCase());
  return idx >= 0 ? idx : ORDEN_SECCION.length;
}

/** Conserva el orden del Excel/catálogo (no alfabético). */
function ordenarDocumentos(filas) {
  return [...filas].sort((a, b) => {
    const ia = indiceCatalogo(a);
    const ib = indiceCatalogo(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    const sec = ordenSeccion(a.especie) - ordenSeccion(b.especie);
    if (sec !== 0) return sec;
    return 0;
  });
}

function sanitizarDatos(base = {}) {
  const documentosRaw = Array.isArray(base.documentos) ? base.documentos : CATALOGO_BASE;
  return {
    revision: normalizarRevision(base.revision) || '00',
    fechaRevision: formatearFechaIso(base.fechaRevision) || '2024-08-01',
    fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || '2024-08-01',
    documentos: ordenarDocumentos(documentosRaw.map(sanitizarFila).filter((f) => f.codigo || f.nombreDocumento))
  };
}

function construirRespuesta(datos, extras = {}) {
  const driveId = extras.driveFileId || DRIVE_FILE_ID_SISTEMA || TEMPLATE_DRIVE_ID;
  return {
    codigo: CODIGO_FORMATO,
    datos,
    fechaElaboracionOriginal: extras.fechaElaboracionOriginal || datos.fechaElaboracion,
    fechaModificacionContenido: extras.fechaModificacionContenido || null,
    contenidoModificado: Boolean(extras.contenidoModificado),
    driveFileId: driveId,
    editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
    previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
    ultimaSyncDrive: extras.ultimaSyncDrive || null,
    resumen: extras.resumen || null,
    propagacion: extras.propagacion || null
  };
}

function enriquecerConMapa(documentos, mapaSistema) {
  let vinculados = 0;
  const resultado = documentos.map((fila) => {
    const live = fila.codigo ? mapaSistema.get(fila.codigo) : null;
    if (!live) {
      return { ...fila, enSistema: false, fuenteVersion: 'catalogo' };
    }
    vinculados += 1;
    return {
      ...fila,
      versionVigente: live.revision || fila.versionVigente,
      fechaRevision: live.fechaRevision || fila.fechaRevision,
      enSistema: true,
      fuenteVersion: 'sistema'
    };
  });
  return {
    documentos: ordenarDocumentos(resultado),
    resumen: {
      total: resultado.length,
      vinculados,
      actualizadosDesdeSistema: vinculados,
      vigentes: resultado.filter((d) => d.vigente !== false).length,
      noVigentes: resultado.filter((d) => d.vigente === false).length
    }
  };
}

/**
 * SELECT único y tolerante a fallos. Si la tabla no existe o falla, mapa vacío.
 */
async function obtenerMapaVersionesSistema(pool) {
  const mapa = new Map();
  if (!pool) return mapa;
  try {
    const [rows] = await pool.query(
      `SELECT codigo_formato, revision, fecha_original
         FROM sgc_formato_metadatos
        WHERE codigo_formato IS NOT NULL AND codigo_formato <> ''
        LIMIT 500`
    );
    for (const row of rows || []) {
      const codigo = String(row.codigo_formato || '').trim().toUpperCase();
      if (!codigo) continue;
      mapa.set(codigo, {
        revision: normalizarRevision(row.revision),
        fechaRevision: formatearFechaIso(row.fecha_original)
      });
    }
  } catch (err) {
    console.warn('[SGC-F-01] No se pudieron leer metadatos (se usa catálogo):', err?.message || err);
  }
  return mapa;
}

/** Carga liviana de documentos persistidos de F-01 (sin asegurarTabla). */
async function cargarDocumentosPersistidosLiviano(pool) {
  if (!pool) return null;
  try {
    const [filas] = await pool.query(
      `SELECT orden, ruta_campo, tipo_valor, valor_texto, valor_numero, valor_booleano, valor_fecha, valor_json
         FROM sgc_formato_campos
        WHERE codigo_formato = ?
        ORDER BY orden ASC
        LIMIT 4000`,
      [CODIGO_FORMATO]
    );
    if (!filas?.length) return null;

    const { obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
    // Preferir reconstrucción oficial si está disponible vía SELECT ya hecho:
    // reconstruimos localmente para no llamar asegurarTabla.
    const datos = reconstruirDocumentosDesdeFilas(filas);
    if (Array.isArray(datos?.documentos) && datos.documentos.length) {
      return {
        revision: datos.revision,
        fechaRevision: datos.fechaRevision,
        fechaElaboracion: datos.fechaElaboracion,
        documentos: datos.documentos.map(sanitizarFila)
      };
    }

    // Fallback: registro completo (puede ser más lento).
    const reg = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    const d = reg?.datos_json || {};
    if (Array.isArray(d.documentos) && d.documentos.length) {
      return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fechaElaboracion: d.fechaElaboracion,
        documentos: d.documentos.map(sanitizarFila)
      };
    }
  } catch (err) {
    console.warn('[SGC-F-01] Persistido liviano omitido:', err?.message || err);
  }
  return null;
}

function deserializarJson(valor) {
  if (valor == null) return null;
  if (typeof valor === 'object') return valor;
  try {
    return JSON.parse(String(valor));
  } catch {
    return null;
  }
}

/** Reconstrucción mínima orientada a F-01 (documentos[] + meta). */
function reconstruirDocumentosDesdeFilas(filas) {
  const root = {};
  const setPath = (obj, ruta, valor) => {
    const limpio = String(ruta || '').replace(/^\$\.?/, '');
    if (!limpio) return;
    const parts = limpio.split('.').filter(Boolean);
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const m = part.match(/^(.*)\[(\d+)\]$/);
      const esUltimo = i === parts.length - 1;
      if (m) {
        const key = m[1];
        const idx = Number(m[2]);
        if (!Array.isArray(cur[key])) cur[key] = [];
        if (esUltimo) {
          cur[key][idx] = valor;
        } else {
          if (!cur[key][idx] || typeof cur[key][idx] !== 'object') cur[key][idx] = {};
          cur = cur[key][idx];
        }
      } else if (esUltimo) {
        cur[part] = valor;
      } else {
        if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
        cur = cur[part];
      }
    }
  };

  for (const fila of filas || []) {
    const tipo = String(fila.tipo_valor || '');
    let valor = null;
    if (tipo === 'array' || tipo === 'object') {
      valor = deserializarJson(fila.valor_json);
    } else if (tipo === 'boolean') {
      valor = Boolean(fila.valor_booleano);
    } else if (tipo === 'number') {
      valor = fila.valor_numero != null ? Number(fila.valor_numero) : null;
    } else if (tipo === 'null') {
      valor = null;
    } else {
      valor = fila.valor_texto != null ? String(fila.valor_texto) : (fila.valor_fecha || null);
    }
    setPath(root, fila.ruta_campo, valor);
  }
  return root;
}

/** Códigos que no deben permanecer en F-01 (fuera del listado oficial). */
const CODIGOS_EXCLUIDOS_LISTA = new Set(['SGC-DI-06', 'SP-P-08']);

function mergeCatalogoConPersistido(persistidoDocs) {
  const mapaPers = new Map();
  for (const d of persistidoDocs || []) {
    const fila = sanitizarFila(d);
    const c = String(d?.codigo || '').toUpperCase();
    if (CODIGOS_EXCLUIDOS_LISTA.has(c)) continue;
    const k = claveFila(fila);
    if (!k) continue;
    mapaPers.set(k, fila);
  }
  const usados = new Set();
  const base = CATALOGO_BASE.map((row) => {
    const limpio = sanitizarFila(row);
    const k = claveFila(limpio);
    const p = k ? mapaPers.get(k) : null;
    if (k) usados.add(k);
    if (!p) return limpio;
    return sanitizarFila({
      ...limpio,
      ...p,
      codigo: limpio.codigo,
      especie: p.especie || limpio.especie
    });
  });
  for (const d of persistidoDocs || []) {
    const fila = sanitizarFila(d);
    const c = String(d?.codigo || '').toUpperCase();
    if (CODIGOS_EXCLUIDOS_LISTA.has(c)) continue;
    const k = claveFila(fila);
    if (!k || usados.has(k)) continue;
    base.push(fila);
    usados.add(k);
  }
  return ordenarDocumentos(base);
}

function respuestaDesdeDocumentos(documentos, mapa, extras = {}) {
  const { documentos: docs, resumen } = enriquecerConMapa(documentos, mapa);
  const selfMeta = mapa.get(CODIGO_FORMATO);
  const datos = sanitizarDatos({
    revision: extras.revision || selfMeta?.revision || '00',
    fechaRevision: extras.fechaRevision || selfMeta?.fechaRevision || '2024-08-01',
    fechaElaboracion: extras.fechaElaboracion || '2024-08-01',
    documentos: docs
  });
  return construirRespuesta(datos, {
    driveFileId: DRIVE_FILE_ID_SISTEMA,
    ultimaSyncDrive: fechaHoyIso(),
    resumen,
    contenidoModificado: Boolean(extras.contenidoModificado),
    fechaModificacionContenido: extras.fechaModificacionContenido || null,
    propagacion: extras.propagacion || null
  });
}

/** GET rápido: sin asegurarTabla. */
async function cargarFormato(pool) {
  const t0 = Date.now();
  try {
    const mapa = await obtenerMapaVersionesSistema(pool);
    const persistido = await cargarDocumentosPersistidosLiviano(pool);
    const docs = persistido?.documentos?.length
      ? mergeCatalogoConPersistido(persistido.documentos)
      : CATALOGO_BASE.map(sanitizarFila);
    const payload = respuestaDesdeDocumentos(docs, mapa, {
      revision: persistido?.revision,
      fechaRevision: persistido?.fechaRevision,
      fechaElaboracion: persistido?.fechaElaboracion
    });
    startupLog.detail(
      `[SGC-F-01] formato listo en ${Date.now() - t0}ms · docs=${payload.datos.documentos.length} · vinculados=${payload.resumen?.vinculados || 0}`
    );
    return payload;
  } catch (err) {
    console.error('[SGC-F-01] cargarFormato fallback catálogo:', err?.message || err);
    return respuestaDesdeDocumentos(CATALOGO_BASE.map(sanitizarFila), new Map());
  }
}

/**
 * Actualiza revisión/fecha del documento destino en metadatos
 * SIN borrar sgc_formato_campos (crítico).
 */
async function propagarMetadatosDocumento(pool, codigo, revision, fechaRevision) {
  if (!pool || !codigo) {
    return { ok: false, motivo: 'sin_pool_o_codigo' };
  }
  const codigoNorm = String(codigo).trim().toUpperCase();
  const rev = normalizarRevision(revision) || '00';
  const fecha = formatearFechaIso(fechaRevision) || fechaHoyIso();

  try {
    // Cabecera mínima (FK de metadatos). No toca campos.
    await pool.query(
      `INSERT INTO sgc_formato_cabecera
          (codigo_formato, drive_file_id, fecha_elaboracion_original,
           fecha_modificacion_contenido, contenido_modificado, ultima_sync_drive)
       VALUES (?, NULL, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
          fecha_modificacion_contenido = VALUES(fecha_modificacion_contenido),
          contenido_modificado = 1,
          ultima_sync_drive = NOW()`,
      [codigoNorm, fecha, fecha]
    );

    await pool.query(
      `INSERT INTO sgc_formato_metadatos
          (codigo_formato, revision, fecha_original, fecha_modificacion)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
          revision = VALUES(revision),
          fecha_original = VALUES(fecha_original),
          fecha_modificacion = VALUES(fecha_modificacion),
          updated_at = CURRENT_TIMESTAMP`,
      [codigoNorm, rev, fecha, fecha]
    );

    // Si el formato ya tiene campos scalar de revisión/fecha, alinearlos.
    try {
      await pool.query(
        `UPDATE sgc_formato_campos
            SET valor_texto = ?, valor_fecha = NULL
          WHERE codigo_formato = ?
            AND (
              ruta_campo IN ('$.revision', 'revision')
              OR ruta_campo LIKE '%.revision'
            )
            AND tipo_valor = 'string'`,
        [rev, codigoNorm]
      );
      await pool.query(
        `UPDATE sgc_formato_campos
            SET valor_texto = ?, valor_fecha = ?
          WHERE codigo_formato = ?
            AND (
              ruta_campo IN ('$.fechaRevision', 'fechaRevision')
              OR ruta_campo LIKE '%.fechaRevision'
            )
            AND tipo_valor IN ('string', 'null')`,
        [fecha, fecha, codigoNorm]
      );
    } catch (errCampos) {
      console.warn('[SGC-F-01] Patch campos revisión omitido:', errCampos?.message || errCampos);
    }

    return { ok: true, codigo: codigoNorm, revision: rev, fechaRevision: fecha };
  } catch (err) {
    console.warn('[SGC-F-01] Propagación metadatos falló:', err?.message || err);
    return { ok: false, motivo: err?.message || 'error_bd' };
  }
}

async function persistirListaMaestra(pool, datos) {
  if (!pool) return;
  try {
    const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc } = require('./sgcDgF05Service');
    await asegurarTablaSgcFormatoDatos(pool);
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
      datos,
      driveFileId: DRIVE_FILE_ID_SISTEMA,
      fechaElaboracionOriginal: datos.fechaElaboracion,
      fechaModificacionContenido: fechaHoyIso(),
      contenidoModificado: true
    });
  } catch (err) {
    console.warn('[SGC-F-01] Guardado lista maestra omitido:', err?.message || err);
  }
}

async function guardarFormato(pool, body = {}) {
  const entrada = body.datos || body;
  const mapa = await obtenerMapaVersionesSistema(pool);
  let datos = sanitizarDatos({
    revision: entrada.revision || '00',
    fechaRevision: entrada.fechaRevision || fechaHoyIso(),
    fechaElaboracion: entrada.fechaElaboracion || fechaHoyIso(),
    documentos: Array.isArray(entrada.documentos) ? entrada.documentos : CATALOGO_BASE
  });

  // Persistir lista tal cual (incluye vigente y campos editados).
  await persistirListaMaestra(pool, datos);

  // Releer mapa por si hubo cambios concurrentes y enriquecer versiones.
  const mapa2 = await obtenerMapaVersionesSistema(pool);
  const enriquecido = enriquecerConMapa(datos.documentos, mapa2.size ? mapa2 : mapa);
  datos = sanitizarDatos({ ...datos, documentos: enriquecido.documentos });

  return construirRespuesta(datos, {
    driveFileId: DRIVE_FILE_ID_SISTEMA,
    fechaElaboracionOriginal: datos.fechaElaboracion,
    fechaModificacionContenido: fechaHoyIso(),
    contenidoModificado: true,
    ultimaSyncDrive: fechaHoyIso(),
    resumen: enriquecido.resumen
  });
}

/**
 * Edita un documento de la lista maestra y propaga versión/fecha
 * al registro del documento original en BD.
 */
async function actualizarDocumento(pool, body = {}) {
  const entradaDoc = body.documento || body;
  const docNuevo = sanitizarFila(entradaDoc);
  const nombreOriginal = String(
    entradaDoc.nombreOriginal || entradaDoc.nombreDocumento || docNuevo.nombreDocumento || ''
  ).trim().toLowerCase();
  if (!docNuevo.codigo && !docNuevo.nombreDocumento) {
    const err = new Error('Indica el código o el nombre del documento');
    err.statusCode = 400;
    throw err;
  }

  const actual = await cargarFormato(pool);
  const docs = [...(actual.datos?.documentos || [])];
  const idx = docs.findIndex((d) => {
    if (docNuevo.codigo && d.codigo === docNuevo.codigo) return true;
    if (!docNuevo.codigo && nombreOriginal) {
      return String(d.nombreDocumento || '').trim().toLowerCase() === nombreOriginal;
    }
    return false;
  });
  if (idx >= 0) {
    docs[idx] = { ...docs[idx], ...docNuevo, codigo: docNuevo.codigo };
  } else {
    docs.push(docNuevo);
  }

  const datos = sanitizarDatos({
    revision: actual.datos?.revision || '00',
    fechaRevision: actual.datos?.fechaRevision || fechaHoyIso(),
    fechaElaboracion: actual.datos?.fechaElaboracion || fechaHoyIso(),
    documentos: docs
  });

  // 1) Propagar al documento original (metadatos + patch de campos scalar).
  const propagacion = docNuevo.codigo
    ? await propagarMetadatosDocumento(
      pool,
      docNuevo.codigo,
      docNuevo.versionVigente,
      docNuevo.fechaRevision
    )
    : { ok: true, omitido: true, motivo: 'documento_sin_codigo' };

  // 2) Si se edita el propio F-01, alinear cabecera de la lista.
  if (docNuevo.codigo === CODIGO_FORMATO) {
    datos.revision = docNuevo.versionVigente;
    datos.fechaRevision = docNuevo.fechaRevision;
  }

  // 3) Persistir lista maestra.
  await persistirListaMaestra(pool, datos);

  // 4) Respuesta fresca (mapa ya incluye la propagación).
  const mapa = await obtenerMapaVersionesSistema(pool);
  return respuestaDesdeDocumentos(datos.documentos, mapa, {
    revision: datos.revision,
    fechaRevision: datos.fechaRevision,
    fechaElaboracion: datos.fechaElaboracion,
    contenidoModificado: true,
    fechaModificacionContenido: fechaHoyIso(),
    propagacion
  });
}

async function listarCodigosNoVigentes(pool) {
  const payload = await cargarFormato(pool);
  const docs = payload?.datos?.documentos || [];
  return docs
    .filter((d) => d && d.vigente === false && d.codigo)
    .map((d) => String(d.codigo).toUpperCase());
}

async function sincronizarDesdeDrive(pool) {
  return cargarFormato(pool);
}

async function actualizarPlantillaDesdeSistema(pool) {
  return cargarFormato(pool);
}

module.exports = {
  CODIGO_FORMATO,
  TEMPLATE_DRIVE_ID,
  DRIVE_FILE_ID_SISTEMA,
  CARPETA_DRIVE_ID,
  NOMBRE_ARCHIVO_DRIVE,
  CATALOGO_BASE,
  DATOS_DEFECTO: sanitizarDatos({ documentos: CATALOGO_BASE }),
  cargarFormato,
  guardarFormato,
  actualizarDocumento,
  listarCodigosNoVigentes,
  sincronizarDesdeDrive,
  actualizarPlantillaDesdeSistema,
  sanitizarDatos
};
