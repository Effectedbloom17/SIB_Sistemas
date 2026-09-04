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
  /** Descripción del problema (Google Forms → bitácora F-03 actividades) */
  descripcionProblema: string;
  /** Acción realizada ante el reporte (manual → Word F-04 «Breve descripción…») */
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
    creadoEn: String(raw?.creadoEn || new Date().toISOString()),
    actualizadoEn: String(raw?.actualizadoEn || new Date().toISOString())
  };
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
 * Devuelve { lista, nuevos } sin tocar campos de gestión ya capturados en filas existentes.
 */
export function sincronizarCasosDesdeForms(
  existentes: EinF02Solicitud[],
  casos: FormsCasoMantenimiento[]
): { lista: EinF02Solicitud[]; nuevos: number; eliminados: number } {
  const idsForms = new Set(
    (casos || [])
      .map(c => String(c.formsResponseId || '').trim())
      .filter(Boolean)
  );

  const byForms = new Map<string, EinF02Solicitud>();
  for (const s of existentes) {
    const rid = String(s.formsResponseId || '').trim();
    if (rid && idsForms.has(rid) && !byForms.has(rid)) {
      byForms.set(rid, s);
    }
  }

  const antes = existentes.length;
  let lista = Array.from(byForms.values());
  let nuevos = 0;

  for (const caso of casos || []) {
    const rid = String(caso.formsResponseId || '').trim();
    if (!rid) {
      continue;
    }
    const prev = byForms.get(rid);
    if (prev) {
      let changed = false;
      if (caso.tipoInfraestructura && prev.tipoInfraestructura !== caso.tipoInfraestructura) {
        prev.tipoInfraestructura = caso.tipoInfraestructura;
        changed = true;
      }
      if (caso.descripcionProblema && prev.descripcionProblema !== caso.descripcionProblema) {
        prev.descripcionProblema = caso.descripcionProblema;
        changed = true;
      }
      if (caso.nombreSolicitante && prev.nombreSolicitante !== caso.nombreSolicitante) {
        prev.nombreSolicitante = caso.nombreSolicitante;
        changed = true;
      }
      if (caso.puesto && prev.puesto !== caso.puesto) {
        prev.puesto = caso.puesto;
        changed = true;
      }
      const areaNueva = caso.area || caso.ubicacion || '';
      if (areaNueva && prev.area !== areaNueva) {
        prev.area = areaNueva;
        changed = true;
      }
      if (caso.ubicacion && prev.ubicacion !== caso.ubicacion) {
        prev.ubicacion = caso.ubicacion;
        changed = true;
      }
      if (caso.prioridad && prev.prioridad !== caso.prioridad) {
        prev.prioridad = caso.prioridad;
        changed = true;
      }
      if (caso.fechaSolicitud && prev.fechaSolicitud !== caso.fechaSolicitud) {
        prev.fechaSolicitud = caso.fechaSolicitud;
        changed = true;
      }
      if (prev.tipoMantenimiento !== 'Correctivo') {
        prev.tipoMantenimiento = 'Correctivo';
        changed = true;
      }
      if (asegurarIdSerie(prev, lista)) {
        changed = true;
      }
      if (changed) {
        prev.actualizadoEn = new Date().toISOString();
      }
      continue;
    }

    const sol = crearSolicitudVacia(lista, {
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
    asegurarIdSerie(sol, lista);
    lista = [sol, ...lista];
    byForms.set(rid, sol);
    nuevos += 1;
  }

  for (const s of lista) {
    asegurarIdSerie(s, lista);
  }

  return { lista, nuevos, eliminados: antes - lista.length };
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
