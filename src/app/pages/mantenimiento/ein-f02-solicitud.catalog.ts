/** EIN-F-02 / EIN-F-03 / EIN-F-04 — modelo compartido de casos de mantenimiento */

export interface EinF02Evidencia {
  driveFileId: string;
  nombre: string;
  mime?: string;
  webViewLink?: string;
  url?: string;
  previewUrl?: string;
}

export type EinF04TipoMantenimiento = 'Preventivo' | 'Correctivo' | '';
export type EinF03InternoExterno = 'Interno' | 'Externo' | '';

export interface EinF02PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink?: string;
  fechaSubida?: string;
}

export interface EinF02Solicitud {
  id: string;
  folio: string;
  codigo: string;
  revision: string;
  fechaRev: string;
  clausula: string;
  nombreSolicitante: string;
  puesto: string;
  area: string;
  fechaSolicitud: string;
  /** Descripción del problema. En Forms es referencia; en un reporte manual se escribe aquí. */
  descripcionProblema: string;
  /** Breve descripción del mantenimiento realizado. Es lo que muestra la bitácora. */
  descripcionMantenimientoRealizado: string;
  /** @deprecated EIN-F-02 Excel ya no se usa; se conserva por compatibilidad local */
  observacionesAdministrador: string;
  evidencias: EinF02Evidencia[];
  /** @deprecated */
  excelDriveFileId?: string;
  /** @deprecated */
  excelWebViewLink?: string;
  /** Campos EIN-F-04 (también alimentan F-03) */
  tipoMantenimiento: EinF04TipoMantenimiento;
  fechaRealizado: string;
  responsableMantenimiento: string;
  reporteDriveFileId?: string;
  reporteWebViewLink?: string;
  /** Campos EIN-F-03 Bitácora */
  tipoInfraestructura: string;
  idSerie: string;
  internoExterno: EinF03InternoExterno;
  observacionesBitacora: string;
  bitacoraDriveFileId?: string;
  bitacoraWebViewLink?: string;
  /** Origen Google Forms */
  formsResponseId?: string;
  ubicacion?: string;
  prioridad?: string;
  /** PDF firmado EIN-F-04 */
  pdfFirmado?: EinF02PdfFirmado;
  /** false = desactivado (no se borra; se oculta del archivero/bitácora) */
  activo?: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export const EIN_F02_META = {
  codigo: 'EIN-F-02',
  revision: '00',
  fechaRev: '22/1/2025',
  clausula: '7.1.3'
};

export const EIN_F03_META = {
  codigo: 'EIN-F-03',
  revision: '00',
  fechaRev: '22-01-25',
  clausula: '7.1.3',
  titulo: 'Bitácora de mantenimiento'
};

export const EIN_F04_META = {
  codigo: 'EIN-F-04',
  revision: '00',
  fechaRev: '21-08-26'
};

export const STORAGE_KEY_SOLICITUDES = 'biznaga:ein-f02:solicitudes';

/** Prefijo de folio: EIFF02-MMYY-N  (ej. EIFF02-0826-1) */
export function prefijoFolioEinF02(fecha = new Date()): string {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const yy = String(fecha.getFullYear()).slice(-2);
  return `EIFF02-${mm}${yy}`;
}

export function siguienteFolio(existentes: EinF02Solicitud[], fecha = new Date()): string {
  const prefijo = prefijoFolioEinF02(fecha);
  let max = 0;
  for (const s of existentes) {
    if (!s.folio?.startsWith(prefijo + '-')) {
      continue;
    }
    const n = parseInt(s.folio.slice(prefijo.length + 1), 10);
    if (!Number.isNaN(n) && n > max) {
      max = n;
    }
  }
  return `${prefijo}-${max + 1}`;
}

/** Prefijo ID bitácora: EINF03-MMDDYY  (ej. EINF03-082726) */
export function prefijoIdSerieEinF03(fecha = new Date()): string {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const yy = String(fecha.getFullYear()).slice(-2);
  return `EINF03-${mm}${dd}${yy}`;
}

export function parseFechaIso(iso: string): Date | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function esRegistroForms(s: EinF02Solicitud): boolean {
  return !!String(s?.formsResponseId || '').trim();
}

/** Conserva reportes escritos a mano que otra vista guardó mientras esta lista estaba en memoria. */
export function conservarReportesManuales(
  memoria: EinF02Solicitud[],
  disco: EinF02Solicitud[]
): EinF02Solicitud[] {
  const ids = new Set((memoria || []).map(s => s.id));
  const ajenos = (disco || []).filter(s => !ids.has(s.id) && !esRegistroForms(s));
  return ajenos.length ? [...(memoria || []), ...ajenos] : (memoria || []);
}

/** ID / No. de serie: EINF03-MMDDYY-NN  (ej. EINF03-082726-01) */
export function generarIdSerie(existentes: EinF02Solicitud[], fecha = new Date()): string {
  const prefijo = prefijoIdSerieEinF03(fecha);
  let max = 0;
  for (const s of existentes) {
    const id = String(s.idSerie || '');
    if (!id.startsWith(prefijo + '-')) {
      continue;
    }
    const n = parseInt(id.slice(prefijo.length + 1), 10);
    if (!Number.isNaN(n) && n > max) {
      max = n;
    }
  }
  return `${prefijo}-${String(max + 1).padStart(2, '0')}`;
}

/** Asigna ID EINF03 si falta o usa formato legacy INF-… */
export function asegurarIdSerie(
  solicitud: EinF02Solicitud,
  existentes: EinF02Solicitud[]
): boolean {
  const actual = String(solicitud.idSerie || '').trim();
  if (actual && actual.startsWith('EINF03-')) {
    return false;
  }
  const fecha = parseFechaIso(solicitud.fechaSolicitud) || new Date();
  solicitud.idSerie = generarIdSerie(
    existentes.filter(s => s.id !== solicitud.id),
    fecha
  );
  return true;
}

export function fechaIsoHoy(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const AREA_POR_ROL: Record<string, string> = {
  root: 'Dirección / Sistemas',
  administrador: 'Administración',
  innovacion: 'Estrategias e Innovación',
  sgc: 'Sistema de Gestión de Calidad',
  ambiental: 'Ambiental',
  proteccion_civil: 'Protección Civil',
  doctor: 'Médicos',
  rrhh: 'Recursos Humanos',
  instructor: 'Capacitación',
  control_documental: 'Control documental',
  coordinador: 'Coordinación',
  consulta: 'Consulta',
  iot: 'Sensorización'
};

const PUESTO_POR_ROL: Record<string, string> = {
  root: 'Super administrador',
  administrador: 'Administrador',
  innovacion: 'Gerente de Estrategias e Innovación',
  sgc: 'Responsable SGC',
  ambiental: 'Especialista ambiental',
  proteccion_civil: 'Especialista PC',
  doctor: 'Médico',
  rrhh: 'Recursos Humanos',
  instructor: 'Instructor',
  control_documental: 'Control documental',
  iot: 'IoT / Sensores'
};

export function areaDesdeRol(rol: string): string {
  const key = String(rol || '').toLowerCase().trim();
  return AREA_POR_ROL[key] || (rol ? String(rol) : 'General');
}

export function puestoDesdeRol(rol: string): string {
  const key = String(rol || '').toLowerCase().trim();
  return PUESTO_POR_ROL[key] || (rol ? String(rol) : '');
}

export function normalizarSolicitud(raw: any): EinF02Solicitud {
  return {
    id: String(raw?.id || `sol-${Date.now()}`),
    folio: String(raw?.folio || ''),
    codigo: String(raw?.codigo || EIN_F02_META.codigo),
    revision: String(raw?.revision || EIN_F02_META.revision),
    fechaRev: String(raw?.fechaRev || EIN_F02_META.fechaRev),
    clausula: String(raw?.clausula || EIN_F02_META.clausula),
    nombreSolicitante: String(raw?.nombreSolicitante || ''),
    puesto: String(raw?.puesto || ''),
    area: String(raw?.area || ''),
    fechaSolicitud: String(raw?.fechaSolicitud || fechaIsoHoy()),
    descripcionProblema: String(raw?.descripcionProblema || ''),
    descripcionMantenimientoRealizado: String(
      raw?.descripcionMantenimientoRealizado || ''
    ),
    observacionesAdministrador: String(raw?.observacionesAdministrador || ''),
    evidencias: Array.isArray(raw?.evidencias) ? raw.evidencias : [],
    excelDriveFileId: raw?.excelDriveFileId || undefined,
    excelWebViewLink: raw?.excelWebViewLink || undefined,
    tipoMantenimiento: (raw?.tipoMantenimiento || '') as EinF04TipoMantenimiento,
    fechaRealizado: String(raw?.fechaRealizado || ''),
    responsableMantenimiento: String(raw?.responsableMantenimiento || ''),
    reporteDriveFileId: raw?.reporteDriveFileId || undefined,
    reporteWebViewLink: raw?.reporteWebViewLink || undefined,
    tipoInfraestructura: String(raw?.tipoInfraestructura || ''),
    idSerie: String(raw?.idSerie || ''),
    internoExterno: (raw?.internoExterno || '') as EinF03InternoExterno,
    observacionesBitacora: String(
      raw?.observacionesBitacora || raw?.observacionesAdministrador || ''
    ),
    bitacoraDriveFileId: raw?.bitacoraDriveFileId || undefined,
    bitacoraWebViewLink: raw?.bitacoraWebViewLink || undefined,
    formsResponseId: raw?.formsResponseId ? String(raw.formsResponseId) : undefined,
    ubicacion: String(raw?.ubicacion || ''),
    prioridad: String(raw?.prioridad || ''),
    pdfFirmado: raw?.pdfFirmado?.driveFileId
      ? {
          driveFileId: String(raw.pdfFirmado.driveFileId),
          nombreArchivo: String(raw.pdfFirmado.nombreArchivo || ''),
          webViewLink: raw.pdfFirmado.webViewLink || undefined,
          fechaSubida: raw.pdfFirmado.fechaSubida || undefined
        }
      : undefined,
    activo: raw?.activo === false || raw?.activo === 0 || raw?.activo === '0' ? false : true,
    creadoEn: String(raw?.creadoEn || new Date().toISOString()),
    actualizadoEn: String(raw?.actualizadoEn || new Date().toISOString())
  };
}

export function estaActivo(s: EinF02Solicitud | null | undefined): boolean {
  return !s || s.activo !== false;
}

export function soloActivos(lista: EinF02Solicitud[]): EinF02Solicitud[] {
  return (lista || []).filter(estaActivo);
}

/** Qué tan “lleno” está un reporte (gestión EIN-F-04 / bitácora). */
export function scoreRiquezaSolicitud(s: EinF02Solicitud | null | undefined): number {
  if (!s) {
    return 0;
  }
  let n = 0;
  if (String(s.descripcionMantenimientoRealizado || '').trim()) {
    n += 4;
  }
  if (String(s.responsableMantenimiento || '').trim()) {
    n += 3;
  }
  if (String(s.fechaRealizado || '').trim()) {
    n += 2;
  }
  if (String(s.descripcionProblema || '').trim()) {
    n += 2;
  }
  if (s.reporteDriveFileId) {
    n += 3;
  }
  if (s.pdfFirmado?.driveFileId) {
    n += 3;
  }
  if (Array.isArray(s.evidencias) && s.evidencias.length) {
    n += Math.min(s.evidencias.length, 5);
  }
  if (String(s.observacionesBitacora || '').trim()) {
    n += 1;
  }
  if (String(s.tipoInfraestructura || '').trim()) {
    n += 1;
  }
  if (String(s.tipoMantenimiento || '').trim()) {
    n += 1;
  }
  return n;
}

/**
 * Rellena huecos del ganador con datos del perdedor.
 * Activo: solo queda oculto si AMBOS están ocultos (evita que un cascarón
 * vacío “reactive-hide” borre un reporte lleno al fusionar duplicados).
 */
export function fusionarCamposSolicitud(
  primario: EinF02Solicitud,
  secundario: EinF02Solicitud
): EinF02Solicitud {
  const a = normalizarSolicitud(primario);
  const b = normalizarSolicitud(secundario);
  const out: EinF02Solicitud = { ...a };

  const tomarSiVacio = <K extends keyof EinF02Solicitud>(key: K) => {
    const va = out[key];
    const vb = b[key];
    const vacioA =
      va == null ||
      va === '' ||
      (Array.isArray(va) && !(va as unknown[]).length);
    if (vacioA && vb != null && vb !== '' && !(Array.isArray(vb) && !(vb as unknown[]).length)) {
      (out as any)[key] = vb;
    }
  };

  const tsAms = Date.parse(String(a.actualizadoEn || '')) || 0;
  const tsBms = Date.parse(String(b.actualizadoEn || '')) || 0;
  // Si el primario es claramente más nuevo, no rellenar gestión con datos viejos del secundario
  // (evita que localStorage de prueba pise un espejo reciente de producción).
  const primarioMasNuevo = tsAms - tsBms > 2000;

  tomarSiVacio('nombreSolicitante');
  tomarSiVacio('puesto');
  tomarSiVacio('area');
  tomarSiVacio('descripcionProblema');
  if (!primarioMasNuevo) {
    tomarSiVacio('descripcionMantenimientoRealizado');
    tomarSiVacio('observacionesAdministrador');
    tomarSiVacio('tipoMantenimiento');
    tomarSiVacio('fechaRealizado');
    tomarSiVacio('responsableMantenimiento');
    tomarSiVacio('reporteDriveFileId');
    tomarSiVacio('reporteWebViewLink');
    tomarSiVacio('observacionesBitacora');
  }
  tomarSiVacio('tipoInfraestructura');
  tomarSiVacio('idSerie');
  tomarSiVacio('internoExterno');
  tomarSiVacio('bitacoraDriveFileId');
  tomarSiVacio('bitacoraWebViewLink');
  tomarSiVacio('ubicacion');
  tomarSiVacio('prioridad');
  tomarSiVacio('formsResponseId');
  tomarSiVacio('folio');

  if (!out.pdfFirmado?.driveFileId && b.pdfFirmado?.driveFileId && !primarioMasNuevo) {
    out.pdfFirmado = { ...b.pdfFirmado };
  }

  const evMap = new Map<string, EinF02Evidencia>();
  for (const ev of [...(b.evidencias || []), ...(a.evidencias || [])]) {
    const key = String(ev?.driveFileId || ev?.url || ev?.webViewLink || '').trim();
    if (key) {
      evMap.set(key, ev);
    }
  }
  out.evidencias = Array.from(evMap.values());

  // Recuperar visibilidad si al menos una copia seguía activa.
  out.activo = !(a.activo === false && b.activo === false);

  const tsA = String(a.actualizadoEn || '');
  const tsB = String(b.actualizadoEn || '');
  out.actualizadoEn = tsAms >= tsBms ? (a.actualizadoEn || tsA) : (b.actualizadoEn || tsB);
  out.creadoEn =
    String(a.creadoEn || '') <= String(b.creadoEn || '')
      ? String(a.creadoEn || b.creadoEn || out.creadoEn)
      : String(b.creadoEn || a.creadoEn || out.creadoEn);

  return out;
}

function preferirSolicitud(a: EinF02Solicitud, b: EinF02Solicitud): EinF02Solicitud {
  const ta = Date.parse(String(a.actualizadoEn || '')) || 0;
  const tb = Date.parse(String(b.actualizadoEn || '')) || 0;
  const sa = scoreRiquezaSolicitud(a);
  const sb = scoreRiquezaSolicitud(b);
  // Gana lo más reciente (p. ej. sync prod→local); la riqueza solo desempata
  // si las marcas de tiempo están casi iguales (±2s), para no revivir localStorage viejo.
  let primario: EinF02Solicitud;
  if (Math.abs(ta - tb) > 2000) {
    primario = ta >= tb ? a : b;
  } else if (sa !== sb) {
    primario = sa > sb ? a : b;
  } else {
    primario = ta >= tb ? a : b;
  }
  const secundario = primario === a ? b : a;
  return fusionarCamposSolicitud(primario, secundario);
}

/**
 * Une local + remoto por id y por formsResponseId.
 * Evita duplicados vacíos de Forms que “borran” reportes ya gestionados.
 */
export function fusionarSolicitudes(
  local: EinF02Solicitud[],
  remoto: EinF02Solicitud[]
): EinF02Solicitud[] {
  const byId = new Map<string, EinF02Solicitud>();
  for (const raw of [...(remoto || []), ...(local || [])]) {
    const s = normalizarSolicitud(raw);
    if (!s.id) {
      continue;
    }
    const prev = byId.get(s.id);
    byId.set(s.id, prev ? preferirSolicitud(prev, s) : s);
  }

  const byForms = new Map<string, EinF02Solicitud>();
  const sinForms: EinF02Solicitud[] = [];
  for (const s of byId.values()) {
    const rid = String(s.formsResponseId || '').trim();
    if (!rid) {
      sinForms.push(s);
      continue;
    }
    const prev = byForms.get(rid);
    byForms.set(rid, prev ? preferirSolicitud(prev, s) : s);
  }

  return [...Array.from(byForms.values()), ...sinForms].sort((a, b) =>
    String(b.actualizadoEn || '').localeCompare(String(a.actualizadoEn || ''))
  );
}

/** Busca por id primero; si no, por folio (manual antes que Forms). */
export function encontrarSolicitudPorClave(
  lista: EinF02Solicitud[],
  clave: string
): EinF02Solicitud | undefined {
  const key = String(clave || '').trim();
  if (!key) {
    return undefined;
  }
  const porId = (lista || []).find(s => s.id === key);
  if (porId) {
    return porId;
  }
  const porFolio = (lista || []).filter(s => s.folio === key);
  if (!porFolio.length) {
    return undefined;
  }
  return porFolio.find(s => !esRegistroForms(s)) || porFolio[0];
}

export function cargarSolicitudesLocal(): EinF02Solicitud[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SOLICITUDES);
    if (!raw) {
      return [];
    }
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map(normalizarSolicitud);
  } catch {
    return [];
  }
}

export function guardarSolicitudesLocal(solicitudes: EinF02Solicitud[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY_SOLICITUDES, JSON.stringify(solicitudes));
    return true;
  } catch {
    return false;
  }
}

export function crearSolicitudVacia(
  existentes: EinF02Solicitud[],
  defaults?: Partial<Pick<EinF02Solicitud, 'nombreSolicitante' | 'puesto' | 'area'>>
): EinF02Solicitud {
  const ahora = new Date().toISOString();
  return {
    id: `sol-${Date.now()}`,
    folio: siguienteFolio(existentes),
    codigo: EIN_F02_META.codigo,
    revision: EIN_F02_META.revision,
    fechaRev: EIN_F02_META.fechaRev,
    clausula: EIN_F02_META.clausula,
    nombreSolicitante: defaults?.nombreSolicitante || '',
    puesto: defaults?.puesto || '',
    area: defaults?.area || '',
    fechaSolicitud: fechaIsoHoy(),
    descripcionProblema: '',
    descripcionMantenimientoRealizado: '',
    observacionesAdministrador: '',
    evidencias: [],
    tipoMantenimiento: '',
    fechaRealizado: '',
    responsableMantenimiento: '',
    tipoInfraestructura: '',
    idSerie: generarIdSerie(existentes),
    internoExterno: '',
    observacionesBitacora: '',
    ubicacion: '',
    prioridad: '',
    activo: true,
    creadoEn: ahora,
    actualizadoEn: ahora
  };
}

export interface FormsCasoMantenimiento {
  formsResponseId: string;
  fechaEnvio?: string;
  fechaSolicitud?: string;
  nombreSolicitante?: string;
  puesto?: string;
  area?: string;
  ubicacion?: string;
  tipoInfraestructura?: string;
  descripcionProblema?: string;
  prioridad?: string;
  observaciones?: string;
}

/**
 * Incorpora respuestas del Forms que aún no existen (por formsResponseId).
 * Conserva gestión ya capturada, ocultos (activo=false) y huérfanos con datos.
 */
export function sincronizarCasosDesdeForms(
  existentes: EinF02Solicitud[],
  casos: FormsCasoMantenimiento[]
): { lista: EinF02Solicitud[]; nuevos: number; eliminados: number } {
  const manuales = (existentes || []).filter(s => !esRegistroForms(s));
  const formsExistentes = (existentes || []).filter(esRegistroForms);

  const byForms = new Map<string, EinF02Solicitud>();
  for (const s of formsExistentes) {
    const rid = String(s.formsResponseId || '').trim();
    if (!rid) {
      continue;
    }
    const prev = byForms.get(rid);
    byForms.set(rid, prev ? preferirSolicitud(prev, s) : s);
  }
  const formsUnicosAntes = byForms.size;

  const lista: EinF02Solicitud[] = [];
  const vistos = new Set<string>();
  let nuevos = 0;

  const aplicarMetaForms = (prev: EinF02Solicitud, caso: FormsCasoMantenimiento): void => {
    let changed = false;
    // Solo rellena huecos o actualiza metadatos de Forms; nunca borra gestión local.
    if (caso.tipoInfraestructura && !String(prev.tipoInfraestructura || '').trim()) {
      prev.tipoInfraestructura = caso.tipoInfraestructura;
      changed = true;
    } else if (
      caso.tipoInfraestructura &&
      prev.tipoInfraestructura !== caso.tipoInfraestructura &&
      scoreRiquezaSolicitud(prev) < 4
    ) {
      prev.tipoInfraestructura = caso.tipoInfraestructura;
      changed = true;
    }
    if (caso.descripcionProblema && !String(prev.descripcionProblema || '').trim()) {
      prev.descripcionProblema = caso.descripcionProblema;
      changed = true;
    }
    if (caso.nombreSolicitante && !String(prev.nombreSolicitante || '').trim()) {
      prev.nombreSolicitante = caso.nombreSolicitante;
      changed = true;
    }
    if (caso.puesto && !String(prev.puesto || '').trim()) {
      prev.puesto = caso.puesto;
      changed = true;
    }
    const areaNueva = caso.area || caso.ubicacion || '';
    if (areaNueva && !String(prev.area || '').trim()) {
      prev.area = areaNueva;
      changed = true;
    }
    if (caso.ubicacion && !String(prev.ubicacion || '').trim()) {
      prev.ubicacion = caso.ubicacion;
      changed = true;
    }
    if (caso.prioridad && !String(prev.prioridad || '').trim()) {
      prev.prioridad = caso.prioridad;
      changed = true;
    }
    if (caso.fechaSolicitud && !String(prev.fechaSolicitud || '').trim()) {
      prev.fechaSolicitud = caso.fechaSolicitud;
      changed = true;
    }
    if (asegurarIdSerie(prev, [...lista, ...manuales])) {
      changed = true;
    }
    if (changed) {
      prev.actualizadoEn = new Date().toISOString();
    }
  };

  for (const caso of casos || []) {
    const rid = String(caso.formsResponseId || '').trim();
    if (!rid) {
      continue;
    }
    const prev = byForms.get(rid);
    if (prev) {
      aplicarMetaForms(prev, caso);
      if (!vistos.has(rid)) {
        lista.push(prev);
        vistos.add(rid);
      }
      continue;
    }

    // Folios e ID serie deben considerar también los manuales para no colisionar.
    const baseFolio = [...lista, ...manuales, ...Array.from(byForms.values())];
    const sol = crearSolicitudVacia(baseFolio, {
      nombreSolicitante: caso.nombreSolicitante || '',
      puesto: caso.puesto || '',
      area: caso.area || caso.ubicacion || ''
    });
    sol.formsResponseId = rid;
    sol.fechaSolicitud = caso.fechaSolicitud || fechaIsoHoy();
    if (caso.fechaEnvio) {
      const d = new Date(caso.fechaEnvio);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        sol.fechaSolicitud = `${y}-${m}-${day}`;
      }
    }
    sol.tipoInfraestructura = caso.tipoInfraestructura || '';
    sol.descripcionProblema = caso.descripcionProblema || '';
    sol.ubicacion = caso.ubicacion || '';
    sol.prioridad = caso.prioridad || '';
    sol.tipoMantenimiento = 'Correctivo';
    asegurarIdSerie(sol, baseFolio);
    lista.unshift(sol);
    byForms.set(rid, sol);
    vistos.add(rid);
    nuevos += 1;
  }

  // Conservar Forms ocultos o con gestión aunque ya no vengan en Google Forms.
  for (const s of byForms.values()) {
    const rid = String(s.formsResponseId || '').trim();
    if (!rid || vistos.has(rid)) {
      continue;
    }
    const conservar =
      s.activo === false ||
      scoreRiquezaSolicitud(s) > 0 ||
      !!s.reporteDriveFileId ||
      !!s.pdfFirmado?.driveFileId;
    if (conservar) {
      lista.push(s);
      vistos.add(rid);
    }
  }

  const listaCompleta = [...lista, ...manuales];
  for (const s of listaCompleta) {
    asegurarIdSerie(s, listaCompleta);
  }

  const conservadosDeAntes = Math.max(0, lista.length - nuevos);
  return {
    lista: listaCompleta,
    nuevos,
    eliminados: Math.max(0, formsUnicosAntes - conservadosDeAntes)
  };
}

export function formatearFechaCorta(iso: string): string {
  if (!iso) {
    return '';
  }
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return iso;
}
