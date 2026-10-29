/** Puestos oficiales del Organigrama Biznaga (ATH-F-01 Rev. 04, 27-10-26) y su distribución visual. */

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
  /**
   * Si es true, `nodos[0]` es el jefe de rama y `nodos[1..]` se muestran
   * en rejilla (pares bajo el jefe), no en cadena vertical.
   */
  hijosEnRejilla?: boolean;
  /**
   * Subramas bajo `nodos[0]`. Cada rama es una cadena vertical
   * que cuelga del jefe (no de Dirección).
   */
  ramas?: OrganigramaColumna[];
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
      'Residente'
    ]
  },
  {
    grupo: 'Reportan a Dirección',
    puestos: [
      'Especialista Ambiental',
      'Ejecutivo Ambiental',
      'Especialista de Sistemas de Gestión y Capacitación',
      'Ejecutivo de Sistemas de Calidad',
      'Especialista de Seguridad Industrial',
      'Ejecutivo de Seguridad Industrial',
      'Supervisor de Seguridad Industrial'
    ]
  },
  {
    grupo: 'Estrategias e Innovación',
    puestos: [
      'Gerente de Estrategias e Innovación',
      'Ejecutivo de Arquitectura',
      'Ejecutivo de Tecnologías de la Información',
      'Ejecutivo Eléctrico y Mantenimiento',
      'Ejecutivo de Diseño e Innovación'
    ]
  }
];

/**
 * Variantes de género / mayúsculas → puesto canónico.
 * Los cargos que salieron en la Rev. 04 se conservan como alias para no
 * reescribir el texto ya guardado en usuarios.
 */
export const ORGANIGRAMA_PUESTO_ALIAS: Record<string, string> = {
  'director general': 'Dirección General',
  'directora general': 'Dirección General',
  'direccion general': 'Dirección General',
  'gerente de administracion y talento humano': 'Gerente de Administración y Talento Humano',
  'gerente de estrategias e innovacion': 'Gerente de Estrategias e Innovación',
  'ejecutivo de administracion': 'Ejecutivo de Administración',
  'especialista ambiental': 'Especialista Ambiental',
  'ejecutivo ambiental': 'Ejecutivo Ambiental',
  'especialista de sistemas de gestion y capacitacion': 'Especialista de Sistemas de Gestión y Capacitación',
  'ejecutivo de sistemas de calidad': 'Ejecutivo de Sistemas de Calidad',
  'especialista de seguridad industrial': 'Especialista de Seguridad Industrial',
  'ejecutivo de seguridad industrial': 'Ejecutivo de Seguridad Industrial',
  'supervisor de seguridad industrial': 'Supervisor de Seguridad Industrial',
  'gerente de estrategias e innovación': 'Gerente de Estrategias e Innovación',
  'ejecutivo de arquitectura': 'Ejecutivo de Arquitectura',
  'ejecutivo de tecnologias de la informacion': 'Ejecutivo de Tecnologías de la Información',
  'ejecutivo de tecnologías de la información': 'Ejecutivo de Tecnologías de la Información',
  'ejecutivo de diseño e innovacion': 'Ejecutivo de Diseño e Innovación',
  'ejecutivo de diseño e innovación': 'Ejecutivo de Diseño e Innovación',
  'ejecutivo electrico y mantenimiento': 'Ejecutivo Eléctrico y Mantenimiento',
  'ejecutivo eléctrico y mantenimiento': 'Ejecutivo Eléctrico y Mantenimiento',
  'residente': 'Residente',
  'ejecutivo de salud ocupacional': 'Ejecutivo de salud ocupacional',
  'ejecutivo de sistemas de gestion': 'Ejecutivo de sistemas de gestión',
  'instructor': 'Instructor',
  'ejecutivo de ventas': 'Ejecutivo de ventas'
};

export const AREA_POR_PUESTO: Record<string, string> = {
  'Dirección General': 'Dirección',
  'Gerente de Administración y Talento Humano': 'Administración y Talento Humano',
  'Ejecutivo de Administración': 'Administración y Talento Humano',
  'Especialista Ambiental': 'Ambiental',
  'Ejecutivo Ambiental': 'Ambiental',
  'Especialista de Sistemas de Gestión y Capacitación': 'Sistemas de gestión y capacitación',
  'Ejecutivo de Sistemas de Calidad': 'Sistemas de gestión y capacitación',
  'Especialista de Seguridad Industrial': 'Seguridad industrial',
  'Ejecutivo de Seguridad Industrial': 'Seguridad industrial',
  'Supervisor de Seguridad Industrial': 'Seguridad industrial',
  'Gerente de Estrategias e Innovación': 'Estrategias e Innovación',
  'Ejecutivo de Arquitectura': 'Estrategias e Innovación',
  'Ejecutivo de Tecnologías de la Información': 'Estrategias e Innovación',
  'Ejecutivo de Diseño e Innovación': 'Estrategias e Innovación',
  'Ejecutivo Eléctrico y Mantenimiento': 'Estrategias e Innovación',
  'Residente': 'Administración y Talento Humano',
  'Ejecutivo de salud ocupacional': 'Salud ocupacional',
  'Ejecutivo de sistemas de gestión': 'Sistemas de gestión y capacitación',
  'Instructor': 'Sistemas de gestión y capacitación',
  'Ejecutivo de ventas': 'Estrategias e Innovación'
};

export const ORGANIGRAMA_DIRECCION: OrganigramaNodo = {
  puesto: 'Dirección General'
};

/**
 * ATH-F-01 Rev. 04:
 * izquierda = Gerencia ATH (solo Ejecutivo de Administración),
 * centro = reportan a Dirección (Ambiental, Sistemas, Seguridad),
 * derecha = Gerencia de Estrategias (4 ejecutivos en rejilla).
 * Residente se asigna en Gestión de usuarios y no se dibuja.
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
    id: 'sgc',
    area: 'Sistemas de gestión y capacitación',
    nodos: [
      { puesto: 'Especialista de Sistemas de Gestión y Capacitación' },
      { puesto: 'Ejecutivo de Sistemas de Calidad' }
    ]
  },
  {
    id: 'seguridad',
    area: 'Seguridad industrial',
    nodos: [
      { puesto: 'Especialista de Seguridad Industrial' },
      { puesto: 'Ejecutivo de Seguridad Industrial' },
      { puesto: 'Supervisor de Seguridad Industrial' }
    ]
  },
  {
    id: 'estrategia',
    area: 'Estrategias e Innovación',
    hijosEnRejilla: true,
    nodos: [
      { puesto: 'Gerente de Estrategias e Innovación' },
      { puesto: 'Ejecutivo de Arquitectura' },
      { puesto: 'Ejecutivo de Tecnologías de la Información' },
      { puesto: 'Ejecutivo Eléctrico y Mantenimiento' },
      { puesto: 'Ejecutivo de Diseño e Innovación' }
    ]
  }
];

export const ORGANIGRAMA_RAMAS: OrganigramaRama[] = [
  { id: 'ath', titulo: 'Administración y Talento Humano', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => c.id === 'admin') },
  { id: 'centro', titulo: 'Reportan a Dirección', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => ['ambiental', 'sgc', 'seguridad'].includes(c.id)) },
  { id: 'estrategia', titulo: 'Estrategias e Innovación', columnas: ORGANIGRAMA_COLUMNAS.filter((c) => c.id === 'estrategia') }
];

export function puestosEnColumna(col: OrganigramaColumna): string[] {
  return [
    ...col.nodos.map((nodo) => nodo.puesto),
    ...(col.ramas || []).flatMap((rama) => puestosEnColumna(rama))
  ];
}

export const ORGANIGRAMA_PUESTOS_LAYOUT = new Set<string>([
  ORGANIGRAMA_DIRECCION.puesto,
  ...ORGANIGRAMA_COLUMNAS.flatMap((col) => puestosEnColumna(col))
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
