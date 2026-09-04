/** Puestos oficiales del Organigrama Biznaga (ATH-F-01) y su distribución visual. */

export interface OrganigramaGrupo {
  grupo: string;
  puestos: string[];
}

export interface OrganigramaNodo {
  puesto: string;
}

export interface OrganigramaColumna {
  id: string;
  nodos: OrganigramaNodo[];
  area?: string;
}

export interface OrganigramaRama {
  id: 'ath' | 'centro' | 'estrategia';
  titulo: string;
  columnas: OrganigramaColumna[];
}

export const ORGANIGRAMA_BIZNAGA_GRUPOS: OrganigramaGrupo[] = [
  {
    grupo: 'Dirección',
    puestos: ['Dirección General']
  },
  {
    grupo: 'Administración y Talento Humano',
    puestos: [
      'Gerente de Administración y Talento Humano',
      'Ejecutivo de Administración',
      'Especialista Ambiental',
      'Ejecutivo Ambiental',
      'Ejecutivo de salud ocupacional',
      'Especialista de sistemas de gestión y capacitación',
      'Ejecutivo de sistemas de gestión',
      'Instructor',
      'Especialista de seguridad industrial',
      'Ejecutivo de seguridad industrial',
      'Supervisor de seguridad industrial',
      'Residente'
    ]
  },
  {
    grupo: 'Estrategias e Innovación',
    puestos: [
      'Gerente de Estrategias e Innovación',
      'Ejecutivo de ventas',
      'Ejecutivo de Tecnologías de la Información',
      'Ejecutivo de diseño e Innovación'
    ]
  }
];

/** Variantes de género / mayúsculas → puesto canónico del organigrama. */
export const ORGANIGRAMA_PUESTO_ALIAS: Record<string, string> = {
  'director general': 'Dirección General',
  'directora general': 'Dirección General',
  'direccion general': 'Dirección General',
  'gerente de administracion y talento humano': 'Gerente de Administración y Talento Humano',
  'gerente de estrategias e innovacion': 'Gerente de Estrategias e Innovación',
  'ejecutivo de administracion': 'Ejecutivo de Administración',
  'especialista ambiental': 'Especialista Ambiental',
  'ejecutivo ambiental': 'Ejecutivo Ambiental',
  'ejecutivo de salud ocupacional': 'Ejecutivo de salud ocupacional',
  'especialista de sistemas de gestion y capacitacion': 'Especialista de sistemas de gestión y capacitación',
  'ejecutivo de sistemas de gestion': 'Ejecutivo de sistemas de gestión',
  'instructor': 'Instructor',
  'especialista de seguridad industrial': 'Especialista de seguridad industrial',
  'ejecutivo de seguridad industrial': 'Ejecutivo de seguridad industrial',
  'supervisor de seguridad industrial': 'Supervisor de seguridad industrial',
  'gerente de estrategias e innovación': 'Gerente de Estrategias e Innovación',
  'ejecutivo de ventas': 'Ejecutivo de ventas',
  'ejecutivo de tecnologias de la informacion': 'Ejecutivo de Tecnologías de la Información',
  'ejecutivo de tecnologías de la información': 'Ejecutivo de Tecnologías de la Información',
  'ejecutivo de diseño e innovacion': 'Ejecutivo de diseño e Innovación',
  'ejecutivo de diseño e innovación': 'Ejecutivo de diseño e Innovación',
  'residente': 'Residente'
};

export const AREA_POR_PUESTO: Record<string, string> = {
  'Dirección General': 'Dirección',
  'Gerente de Administración y Talento Humano': 'Administración y Talento Humano',
  'Ejecutivo de Administración': 'Administración y Talento Humano',
  'Especialista Ambiental': 'Ambiental',
  'Ejecutivo Ambiental': 'Ambiental',
  'Ejecutivo de salud ocupacional': 'Salud ocupacional',
  'Especialista de sistemas de gestión y capacitación': 'Sistemas de gestión y capacitación',
  'Ejecutivo de sistemas de gestión': 'Sistemas de gestión y capacitación',
  'Instructor': 'Sistemas de gestión y capacitación',
  'Especialista de seguridad industrial': 'Seguridad industrial',
  'Ejecutivo de seguridad industrial': 'Seguridad industrial',
  'Supervisor de seguridad industrial': 'Seguridad industrial',
  'Gerente de Estrategias e Innovación': 'Estrategias e Innovación',
  'Ejecutivo de ventas': 'Estrategias e Innovación',
  'Ejecutivo de Tecnologías de la Información': 'Estrategias e Innovación',
  'Ejecutivo de diseño e Innovación': 'Estrategias e Innovación',
  'Residente': 'Administración y Talento Humano'
};

export const ORGANIGRAMA_DIRECCION: OrganigramaNodo = {
  puesto: 'Dirección General'
};

/**
 * Tres bloques del ATH-F-01:
 * izquierda = Gerencia ATH, centro = reportan a Dirección, derecha = Gerencia de Estrategias.
 */
export const ORGANIGRAMA_COLUMNAS: OrganigramaColumna[] = [
  {
    id: 'admin',
    area: 'Administración y Talento Humano',
    nodos: [
      { puesto: 'Gerente de Administración y Talento Humano' },
      { puesto: 'Ejecutivo de Administración' }
    ]
  },
  {
    id: 'ambiental',
    area: 'Ambiental',
    nodos: [
      { puesto: 'Especialista Ambiental' },
      { puesto: 'Ejecutivo Ambiental' }
    ]
  },
  {
    id: 'salud',
    area: 'Salud ocupacional',
    nodos: [
      { puesto: 'Ejecutivo de salud ocupacional' }
    ]
  },
  {
    id: 'sgc',
    area: 'Sistemas de gestión y capacitación',
    nodos: [
      { puesto: 'Especialista de sistemas de gestión y capacitación' },
      { puesto: 'Ejecutivo de sistemas de gestión' },
      { puesto: 'Instructor' }
    ]
  },
  {
    id: 'seguridad',
    area: 'Seguridad industrial',
    nodos: [
      { puesto: 'Especialista de seguridad industrial' },
      { puesto: 'Ejecutivo de seguridad industrial' },
      { puesto: 'Supervisor de seguridad industrial' }
    ]
  },
  {
    id: 'estrategia',
    area: 'Estrategias e Innovación',
    nodos: [
      { puesto: 'Gerente de Estrategias e Innovación' },
      { puesto: 'Ejecutivo de ventas' },
      { puesto: 'Ejecutivo de Tecnologías de la Información' },
      { puesto: 'Ejecutivo de diseño e Innovación' }
    ]
  }
];

export const ORGANIGRAMA_RAMAS: OrganigramaRama[] = [
  { id: 'ath', titulo: 'Administración y Talento Humano', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => c.id === 'admin') },
  { id: 'centro', titulo: 'Reportan a Dirección', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => ['ambiental', 'salud', 'sgc', 'seguridad'].includes(c.id)) },
  { id: 'estrategia', titulo: 'Estrategias e Innovación', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => c.id === 'estrategia') }
];

export const ORGANIGRAMA_PUESTOS_LAYOUT = new Set<string>([
  ORGANIGRAMA_DIRECCION.puesto,
  ...ORGANIGRAMA_COLUMNAS.flatMap((col) => col.nodos.map((n) => n.puesto))
]);

export function normalizarTextoPuesto(valor: string): string {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function puestoCanonicoOrganigrama(valor?: string | null): string | null {
  const crudo = String(valor || '').trim();
  if (!crudo) return null;
  const alias = ORGANIGRAMA_PUESTO_ALIAS[normalizarTextoPuesto(crudo)];
  if (alias) return alias;
  for (const grupo of ORGANIGRAMA_BIZNAGA_GRUPOS) {
    const exacto = grupo.puestos.find((p) => p === crudo);
    if (exacto) return exacto;
  }
  return crudo;
}

export function areaDePuesto(valor?: string | null): string | null {
  const puesto = puestoCanonicoOrganigrama(valor);
  if (!puesto) return null;
  return AREA_POR_PUESTO[puesto] || null;
}
