/**
 * Navegación desde Lista Maestra / Solicitud → formato dinámico en el sistema.
 * Prioridad: Centro SGC (plantilla) → módulos de otras áreas (Capacitación, PC, Mantenimiento, …).
 */
import {
  formatoSgcVisibleParaUsuario,
  resolverPlantillaCentroSgcPorCodigo
} from './sgc-formatos.catalog';

export type AreaFormatoSistema =
  | 'Centro SGC'
  | 'Capacitación'
  | 'Protección Civil'
  | 'Mantenimiento'
  | 'Ambiental'
  | 'Control de Proyectos'
  | 'Recursos Humanos';

export interface DestinoFormatoSistema {
  codigo: string;
  /** Ruta Angular absoluta (sin hash), p. ej. /mantenimiento/programa-infraestructura */
  ruta: string;
  area: AreaFormatoSistema;
  /** Texto corto para chip / tooltip */
  etiqueta: string;
  /** Query params opcionales */
  queryParams?: Record<string, string>;
  /**
   * true = el formato vive dentro de un curso; la ruta lleva al hub
   * (Curso activos) para elegir el curso.
   */
  requiereCurso?: boolean;
}

/** Formatos dinámicos fuera de Centro SGC (código lista maestra → ruta del módulo). */
const FORMATOS_FUERA_CENTRO_SGC: DestinoFormatoSistema[] = [
  // —— Mantenimiento ——
  {
    codigo: 'EIN-F-01',
    ruta: '/mantenimiento/programa-infraestructura',
    area: 'Mantenimiento',
    etiqueta: 'Programa infraestructura'
  },
  {
    codigo: 'EIN-F-02',
    ruta: '/mantenimiento/solicitud',
    area: 'Mantenimiento',
    etiqueta: 'Solicitud de mantenimiento'
  },
  {
    codigo: 'EIN-F-03',
    ruta: '/mantenimiento/bitacora',
    area: 'Mantenimiento',
    etiqueta: 'Bitácora de mantenimiento'
  },
  // —— Protección Civil ——
  {
    codigo: 'SP-F-01',
    ruta: '/proteccion-civil/catalogo',
    area: 'Protección Civil',
    etiqueta: 'Catálogo PIPC'
  },
  {
    codigo: 'SP-F-02',
    ruta: '/proteccion-civil',
    area: 'Protección Civil',
    etiqueta: 'PIPC / Recorrido'
  },
  {
    codigo: 'SP-F-29',
    ruta: '/proteccion-civil/control-resolutivos',
    area: 'Protección Civil',
    etiqueta: 'Control de resolutivos'
  },
  // —— Capacitación (standalone) ——
  {
    codigo: 'SP-F-13',
    ruta: '/control-capacitacion',
    area: 'Capacitación',
    etiqueta: 'Control de capacitación'
  },
  // —— Capacitación (por curso: hub Curso activos) ——
  {
    codigo: 'SP-F-03',
    ruta: '/historial-cursos',
    area: 'Capacitación',
    etiqueta: 'Entrega de documentos',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-08',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Checklist del curso',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-09',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Evaluación diagnóstica',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-10',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Evaluación del aprendizaje',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-11',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Informe final',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-12',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Datos del participante',
    requiereCurso: true
  },
  {
    codigo: 'SP-F-14',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Encuesta de satisfacción',
    requiereCurso: true
  },
  {
    codigo: 'SGC-F-33',
    ruta: '/curso-activos',
    area: 'Capacitación',
    etiqueta: 'Lista de asistencia',
    requiereCurso: true
  },
  // —— Control de proyectos / Ambiental ——
  {
    codigo: 'SP-F-05',
    ruta: '/control-proyectos',
    area: 'Control de Proyectos',
    etiqueta: 'Control de proyectos'
  },
  {
    codigo: 'SP-F-15',
    ruta: '/control-oficios',
    area: 'Ambiental',
    etiqueta: 'Control de oficios'
  },
  {
    codigo: 'SP-F-28',
    ruta: '/control-tramites',
    area: 'Ambiental',
    etiqueta: 'Control de trámites'
  },
  // —— RRHH ——
  {
    codigo: 'ATH-F-01',
    ruta: '/recursos-humanos/colaboradores',
    area: 'Recursos Humanos',
    etiqueta: 'Colaboradores'
  }
];

const MAPA_FUERA = new Map(
  FORMATOS_FUERA_CENTRO_SGC.map((d) => [d.codigo.toUpperCase(), d])
);

/**
 * Resuelve a dónde ir desde la lista maestra / solicitud.
 * 1) Plantilla en Centro SGC
 * 2) Módulo de otra área (si existe UI dinámica)
 */
export function resolverDestinoFormatoSistema(
  codigoDoc: string | null | undefined,
  esSuperusuario = false
): DestinoFormatoSistema | null {
  const codigo = String(codigoDoc || '').trim().toUpperCase();
  if (!codigo) {
    return null;
  }

  const centro = resolverPlantillaCentroSgcPorCodigo(codigo, esSuperusuario);
  if (centro) {
    return {
      codigo,
      ruta: `/sistema-gestion-calidad/${centro.capituloSlug}/plantilla/${centro.previewSlug}`,
      area: 'Centro SGC',
      etiqueta: centro.plantilla.titulo || codigo
    };
  }

  const fuera = MAPA_FUERA.get(codigo);
  if (!fuera) {
    return null;
  }
  if (!formatoSgcVisibleParaUsuario(codigo, esSuperusuario)) {
    return null;
  }
  return { ...fuera };
}

export function tooltipDestinoFormato(destino: DestinoFormatoSistema | null | undefined): string {
  if (!destino) {
    return '';
  }
  if (destino.requiereCurso) {
    return `Abrir en ${destino.etiqueta} · elige un curso`;
  }
  return `Abrir en ${destino.etiqueta}`;
}

/** Clase CSS del riel expandible según el área destino. */
export function tonoAreaFormatoSistema(area: AreaFormatoSistema | string | null | undefined): string {
  switch (String(area || '').trim()) {
    case 'Mantenimiento':
      return 'mantenimiento';
    case 'Protección Civil':
      return 'pc';
    case 'Capacitación':
      return 'capacitacion';
    case 'Ambiental':
      return 'ambiental';
    case 'Control de Proyectos':
      return 'proyectos';
    case 'Recursos Humanos':
      return 'rrhh';
    case 'Centro SGC':
    default:
      return 'sgc';
  }
}

/** Icono Font Awesome del área (para el FAB del riel). */
export function iconoAreaFormatoSistema(area: AreaFormatoSistema | string | null | undefined): string {
  switch (String(area || '').trim()) {
    case 'Mantenimiento':
      return 'fa-industry';
    case 'Protección Civil':
      return 'fa-shield-alt';
    case 'Capacitación':
      return 'fa-chalkboard-teacher';
    case 'Ambiental':
      return 'fa-leaf';
    case 'Control de Proyectos':
      return 'fa-tasks';
    case 'Recursos Humanos':
      return 'fa-user-tie';
    case 'Centro SGC':
    default:
      return 'fa-external-link-alt';
  }
}
