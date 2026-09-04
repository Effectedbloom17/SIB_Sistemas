/** Catálogo de normativas STPS — módulo Seguridad (BD normativas). */

export interface SegNormativaCategoria {
  id: string;
  prefijo: string;
  titulo: string;
  descripcion: string;
  iconClass: string;
}

export interface SegNormativaResumen {
  id: number;
  codigo: string;
  titulo: string;
  autoridad: string;
  anio: number | null;
  numero: number | null;
  categoria_id: string;
  estado: string;
  total_requisitos: number;
  importado_por: string | null;
  importado_perfil?: string | null;
  importado_en: string | null;
  updated_at: string | null;
}

export const SEG_NORMATIVAS_CATEGORIAS: SegNormativaCategoria[] = [
  {
    id: 'nom-001-010',
    prefijo: '001–010',
    titulo: 'Instalaciones y materiales',
    descripcion: 'Edificios, incendio, maquinaria, sustancias.',
    iconClass: 'fas fa-building'
  },
  {
    id: 'nom-011-020',
    prefijo: '011–020',
    titulo: 'Agentes y organización',
    descripcion: 'Ruido, radiaciones, EPP, químicos.',
    iconClass: 'fas fa-user-shield'
  },
  {
    id: 'nom-021-030',
    prefijo: '021–030',
    titulo: 'Electricidad y procesos',
    descripcion: 'Electricidad, iluminación, soldadura.',
    iconClass: 'fas fa-bolt'
  },
  {
    id: 'nom-031-040',
    prefijo: '031–040',
    titulo: 'Construcción y factores humanos',
    descripcion: 'Construcción, espacios confinados, ergonomía.',
    iconClass: 'fas fa-hard-hat'
  },
  {
    id: 'otras',
    prefijo: 'OTRAS',
    titulo: 'Otras normativas',
    descripcion: 'Normas de otras dependencias.',
    iconClass: 'fas fa-balance-scale'
  }
];
