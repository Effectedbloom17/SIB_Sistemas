/** Instructivos corporativos — categorías y helpers de URLs Drive.
 *  El listado vivo viene de la API (`sgc_instructivos`); este catálogo
 *  queda como respaldo offline / seed de referencia.
 */

export interface SgcInstructivoDoc {
  id?: number;
  codigo: string;
  titulo: string;
  driveFileId: string;
  categoriaId: string;
  nombreArchivo?: string | null;
  tamanoBytes?: number | null;
  actualizadoPor?: string | null;
  fechaActualizacion?: string | null;
}

export interface SgcInstructivoCategoria {
  id: string;
  prefijo: string;
  titulo: string;
  descripcion: string;
  iconClass: string;
  colorInicio: string;
  colorFin: string;
}

export const SGC_INSTRUCTIVOS_CATEGORIAS: SgcInstructivoCategoria[] = [
  {
    id: 'ath',
    prefijo: 'ATH',
    titulo: 'Administración de Talento Humano',
    descripcion: 'Instructivos de cotización, contratación y administración de personal.',
    iconClass: 'fas fa-users',
    colorInicio: '#15a596',
    colorFin: '#0f766e'
  },
  {
    id: 'ein',
    prefijo: 'EIN',
    titulo: 'Infraestructura',
    descripcion: 'Instructivos operativos de mantenimiento e instalaciones.',
    iconClass: 'fas fa-building',
    colorInicio: '#6366f1',
    colorFin: '#4f46e5'
  },
  {
    id: 'sgc',
    prefijo: 'SGC',
    titulo: 'Sistema de Gestión de Calidad',
    descripcion: 'Instructivos ISO 9001: folios, cotizaciones, no conformidades y mejora.',
    iconClass: 'fas fa-award',
    colorInicio: '#059669',
    colorFin: '#047857'
  },
  {
    id: 'sp',
    prefijo: 'SP',
    titulo: 'Servicios Profesionales',
    descripcion: 'Instructivos de consultoría, capacitación y servicios al cliente.',
    iconClass: 'fas fa-briefcase',
    colorInicio: '#d97706',
    colorFin: '#b45309'
  }
];

/** Respaldo si la API no responde (mismo seed que backend). */
export const SGC_INSTRUCTIVOS_CATALOG: SgcInstructivoDoc[] = [
  {
    codigo: 'SGC-I-01',
    titulo: 'Número de cotización y número de proyecto',
    driveFileId: '1UH8Guu25vBNL_zPAKgLFRiwHjva7EVZm',
    categoriaId: 'sgc'
  },
  {
    codigo: 'SGC-I-02',
    titulo: 'Folio para no conformidades',
    driveFileId: '1EUEr-KiAMwjCjdl3iHzoaZ2a2pcyDHzw',
    categoriaId: 'sgc'
  },
  {
    codigo: 'SGC-I-03',
    titulo: 'Folio para proyectos de mejora',
    driveFileId: '1huk2aEh5LkzMykE61zEzeJZcaZJGIgbV',
    categoriaId: 'sgc'
  }
];

export function urlPreviewDriveInstructivo(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/preview`;
}

export function urlThumbnailDriveInstructivo(driveFileId: string, cacheBust = 0): string {
  const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w480`;
  return cacheBust ? `${base}&t=${cacheBust}` : base;
}

export function urlAbrirDriveInstructivo(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}
