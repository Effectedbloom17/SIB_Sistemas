/** Catálogo semilla EIN-F-01 — Programa de mantenimiento a la infraestructura */

export type TipoMantenimiento = 'Int' | 'Ext';

/** Semana programada: mes 0–11, semana 0–3 */
export interface SemanaProgramada {
  mes: number;
  semana: number;
}

/** Ciclo de celda semanal: vacío → verde sin P → verde con P → vacío */
export type EstadoCeldaPrograma = 'reservado' | 'P';

export interface InfraestructuraFila {
  id: string;
  infraestructura: string;
  responsable: string;
  tipo: TipoMantenimiento;
  /** Claves "m{mes}-s{semana}": reservado = verde sin P, P = programado con letra */
  programado: Record<string, EstadoCeldaPrograma>;
}

export function normalizarEstadoCelda(val: unknown): EstadoCeldaPrograma | null {
  if (val === true || val === 'P' || val === 'p') {
    return 'P';
  }
  if (val === 'reservado' || val === 'reservada' || val === 'marked') {
    return 'reservado';
  }
  return null;
}

export function normalizarProgramado(
  raw: Record<string, unknown> | undefined
): Record<string, EstadoCeldaPrograma> {
  const out: Record<string, EstadoCeldaPrograma> = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const [key, val] of Object.entries(raw)) {
    const estado = normalizarEstadoCelda(val);
    if (estado) {
      out[key] = estado;
    }
  }
  return out;
}

export interface EinF01Meta {
  codigo: string;
  revision: string;
  fechaRev: string;
  clausula: string;
  empresa: string;
  tipoInfraestructura: string;
  periodo: string;
  anio: number;
  administrador: string;
}

export const MESES_EIN_F01 = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
] as const;

export const SEMANAS_POR_MES = [1, 2, 3, 4] as const;

export function claveSemana(mes: number, semana: number): string {
  return `m${mes}-s${semana}`;
}

export function metaInicialEinF01(anio = 2026): EinF01Meta {
  return {
    codigo: 'EIN-F-01',
    revision: '00',
    fechaRev: '22-01-25',
    clausula: '7.1.3',
    empresa: 'BIZNAGA RISK AND TECH',
    tipoInfraestructura: 'Toda la infraestructura en general',
    periodo: `Enero - Diciembre ${anio}`,
    anio,
    administrador: 'Gerente de Estrategias e Innovación'
  };
}

function prog(...pares: Array<[number, number, EstadoCeldaPrograma?]>): Record<string, EstadoCeldaPrograma> {
  const out: Record<string, EstadoCeldaPrograma> = {};
  for (const [mes, semana, estado = 'P'] of pares) {
    out[claveSemana(mes, semana)] = estado;
  }
  return out;
}

/** Datos iniciales alineados al formato EIN-F-01 (ejemplo operativo Biznaga). */
export function filasSemillaEinF01(): InfraestructuraFila[] {
  return [
    {
      id: 'inf-1',
      infraestructura: 'Página web Biznaga',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([1, 3])
    },
    {
      id: 'inf-2',
      infraestructura: 'Nube / Servidor',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([2, 1])
    },
    {
      id: 'inf-3',
      infraestructura: 'Equipos de cómputo\n/ Lap Top',
      responsable: 'Mundo web\nS.A. de C.V.',
      tipo: 'Ext',
      programado: prog([1, 1])
    },
    {
      id: 'inf-4',
      infraestructura: 'Impresoras',
      responsable: 'Mundo web\nS.A. de C.V.',
      tipo: 'Ext',
      programado: prog([0, 0])
    },
    {
      id: 'inf-5',
      infraestructura: 'Proyector',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([5, 2])
    },
    {
      id: 'inf-6',
      infraestructura: 'Camioneta',
      responsable: 'Agencia VOLVO',
      tipo: 'Ext',
      programado: prog([3, 2], [3, 3])
    },
    {
      id: 'inf-7',
      infraestructura: 'Sistema de\ninformación',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([6, 0])
    },
    {
      id: 'inf-8',
      infraestructura: 'Tractocamión',
      responsable: 'Grupo Álvarez',
      tipo: 'Ext',
      programado: prog([8, 1])
    },
    {
      id: 'inf-9',
      infraestructura: 'Compresores',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([4, 3])
    },
    {
      id: 'inf-10',
      infraestructura: 'Lámparas de\nemergencia',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([9, 0])
    },
    {
      id: 'inf-11',
      infraestructura: 'Equipo eléctrico',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Int',
      programado: prog([10, 2])
    },
    {
      id: 'inf-12',
      infraestructura: 'Maquinaria\ny equipo',
      responsable: 'Administrador\nde mantenimiento',
      tipo: 'Ext',
      programado: prog([3, 2], [3, 3])
    }
  ];
}
