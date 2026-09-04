/** Normativas oficiales (NOM-STPS) — PDFs de la carpeta Drive Documentos externos / Normativas. */

export interface SgcNormativaDoc {
  id: string;
  codigo: string;
  titulo: string;
  driveFileId: string;
  categoriaId: string;
  nombreArchivo: string;
  mimeType?: string;
  tamanoBytes?: number | null;
  fechaModificacion?: string | null;
  autoridad?: string | null;
  anio?: number | null;
  numero?: number;
}

export interface SgcNormativaCategoria {
  id: string;
  numero: number;
  prefijo: string;
  titulo: string;
  descripcion: string;
  iconClass: string;
}

export const SGC_NORMATIVAS_CATEGORIAS: SgcNormativaCategoria[] = [
  {
    id: 'nom-001-010',
    numero: 1,
    prefijo: '001–010',
    titulo: 'Instalaciones y materiales',
    descripcion: 'Edificios, incendio, maquinaria, sustancias y almacenamiento.',
    iconClass: 'fas fa-building'
  },
  {
    id: 'nom-011-020',
    numero: 2,
    prefijo: '011–020',
    titulo: 'Agentes y organización',
    descripcion: 'Ruido, radiaciones, EPP, identificación de químicos y comisiones.',
    iconClass: 'fas fa-user-shield'
  },
  {
    id: 'nom-021-030',
    numero: 3,
    prefijo: '021–030',
    titulo: 'Electricidad y procesos',
    descripcion: 'Electricidad estática, iluminación, soldadura y servicios preventivos.',
    iconClass: 'fas fa-bolt'
  },
  {
    id: 'nom-031-040',
    numero: 4,
    prefijo: '031–040',
    titulo: 'Construcción y factores humanos',
    descripcion: 'Construcción, minas, espacios confinados, ergonómicos, psicosociales y teletrabajo.',
    iconClass: 'fas fa-hard-hat'
  },
  {
    id: 'otras',
    numero: 5,
    prefijo: 'OTRAS',
    titulo: 'Otras normativas',
    descripcion: 'Normas de otras dependencias o documentos sin clave NOM-STPS.',
    iconClass: 'fas fa-balance-scale'
  }
];

function categoriaDesdeNumero(numero: number): string {
  if (numero >= 1 && numero <= 10) return 'nom-001-010';
  if (numero >= 11 && numero <= 20) return 'nom-011-020';
  if (numero >= 21 && numero <= 30) return 'nom-021-030';
  if (numero >= 31 && numero <= 40) return 'nom-031-040';
  return 'otras';
}

function nom(
  codigo: string,
  titulo: string,
  driveFileId: string,
  nombreArchivo: string,
  tamanoBytes?: number
): SgcNormativaDoc {
  const match = codigo.match(/^NOM-(\d+)(?:-(\d+))?-([A-Z0-9]+)-(\d{4})$/i);
  const numero = match ? Number(match[1]) : 9999;
  const autoridad = match ? String(match[3]).toUpperCase() : 'STPS';
  const anio = match ? Number(match[4]) : null;
  return {
    id: driveFileId,
    codigo,
    titulo,
    driveFileId,
    categoriaId: categoriaDesdeNumero(numero),
    nombreArchivo,
    mimeType: 'application/pdf',
    tamanoBytes: tamanoBytes ?? null,
    autoridad,
    anio,
    numero
  };
}

/** Archivos reales de https://drive.google.com/drive/folders/1HDGYBfbi_wtgDNnaEHSwpHrRAUAUnvYY */
export const SGC_NORMATIVAS_CATALOG: SgcNormativaDoc[] = [
  nom('NOM-001-STPS-2008', 'Edificios, locales, instalaciones y áreas en los centros de trabajo', '1HWIXOy8-7TMPTHp_b-ljM1lSxvBBRQN3', 'NOM-001-STPS-2008.pdf', 201190),
  nom('NOM-002-STPS-2010', 'Prevención y protección contra incendios', '1zdUbTxpAQT5at5eUCrIQgagF8BruRbNt', 'NOM-002-STPS-2010.pdf', 354852),
  nom('NOM-003-STPS-2023', 'Actividades agrícolas: uso de insumos fitosanitarios o plaguicidas', '1U5O3TE8dR5g0_Ph16xnOMyj1gOquIg8S', 'NOM-003-STPS-2023.pdf', 2000784),
  nom('NOM-004-STPS-1999', 'Sistemas de protección y dispositivos de seguridad en la maquinaria', '1fdWs_YHGWtLEuV4cTvu3OUBvGllCuIKO', 'NOM-004-STPS-1999.pdf', 39733),
  nom('NOM-005-STPS-1998', 'Manejo, transporte y almacenamiento de sustancias químicas peligrosas', '16NRjwKCXOiDOOV-6VQ21LpyqLtWn1FM0', 'NOM-005-STPS-1998.pdf', 79133),
  nom('NOM-006-STPS-2023', 'Manejo y almacenamiento de materiales', '1xH8urAmBjL2Cyl-2uZToFWk0qXZiFyff', 'NOM-006-STPS-2023.pdf', 1284209),
  nom('NOM-008-STPS-2013', 'Actividades de aprovechamiento forestal maderable y de aserraderos', '1stViK4Vxkeu6VFbRUNEn12UXCagJhYKL', 'NOM-008-STPS-2013.pdf', 508610),
  nom('NOM-009-STPS-2011', 'Condiciones de seguridad para realizar trabajos en altura', '10ggz1afFVNdaUc75t5Ln8K5X9c3uHipC', 'NOM-009-STPS-2011.pdf', 383858),
  nom('NOM-010-STPS-2014', 'Agentes químicos contaminantes del ambiente laboral', '1JDvoikltp0f4G3kFN8q8qvnPTmjw_VQk', 'NOM-010-STPS-2014.pdf', 1633829),
  nom('NOM-011-STPS-2001', 'Condiciones de seguridad e higiene donde se genere ruido', '1uzj-Fqf1mNhWqMp5fOVeKVwHVvR4uAo8', 'NOM-011-STPS-2001.pdf', 181630),
  nom('NOM-012-STPS-2012', 'Fuentes de radiación ionizante', '1AAvUzB4eYuZW3AqT-UQznAbkxcEPLPbO', 'NOM-012-STPS-2012.pdf', 203652),
  nom('NOM-013-STPS-1993', 'Radiaciones electromagnéticas no ionizantes', '1daUNuC61GlO28qo20DJGl_FJjyTF2mUK', 'NOM-013-STPS-1993.pdf', 87103),
  nom('NOM-014-STPS-2000', 'Exposición laboral a presiones ambientales anormales', '1jQZ49hcyxTBW_WTrm6P6oJL51fB-ulHa', 'NOM-014-STPS-2000.pdf', 1224490),
  nom('NOM-015-STPS-2001', 'Condiciones térmicas elevadas o abatidas', '1j_n_yBH6-vJoDaEWc2OtQinEpWQ12gZd', 'NOM-015-STPS-2001.pdf', 273768),
  nom('NOM-016-STPS-2001', 'Exposición laboral a vibraciones', '1FR5ZCnV_tPGnVQCgI1BSCfCv3UvSb0GR', 'NOM-016-STPS-2001.pdf', 78940),
  nom('NOM-017-STPS-2024', 'Equipo de protección personal: selección, uso y manejo', '1UGM828x3n9ygFos-_bQIfS4gMT4hMREG', 'NOM-017-STPS-2024.pdf', 746119),
  nom('NOM-018-STPS-2015', 'Sistema armonizado de identificación de sustancias químicas peligrosas', '1l_40A47P52szNz7lOjDJqdVnTZY5H7kb', 'NOM-018-STPS-2015.pdf', 1064020),
  nom('NOM-019-STPS-2011', 'Comisiones de seguridad e higiene', '1-r6C7A2s4MTBga8HpnufQ-Z4zCeYc1zL', 'NOM-019-STPS-2011.pdf', 183571),
  nom('NOM-020-STPS-2011', 'Recipientes sujetos a presión y calderas', '12jZRa1C3Y3tbpqBhJhxg1U-M3H9Pqkqz', 'NOM-020-STPS-2011.pdf', 2017065),
  nom('NOM-022-STPS-2015', 'Electricidad estática en los centros de trabajo', '1ysGq4oNVRQzjsOeUXNr6y47FUeZIYPQ2', 'NOM-022-STPS-2015.pdf', 418718),
  nom('NOM-023-STPS-2012', 'Trabajos en minas subterráneas y a cielo abierto', '1wQvddQThgDUQz3Nzs-JVJAR9lnjWwRvx', 'NOM-023-STPS-2012.pdf', 1006708),
  nom('NOM-024-STPS-2001', 'Vibraciones: condiciones de seguridad e higiene', '1omdAhuUM_iZzR55yU-XAaHqWZ1QbnC3G', 'NOM-024-STPS-2001.pdf', 737832),
  nom('NOM-025-STPS-2008', 'Condiciones de iluminación en los centros de trabajo', '1uZ8Djsl0DaDhN9bBqLNgxecfJga3nFs-', 'NOM-025-STPS-2008.pdf', 130820),
  nom('NOM-026-STPS-2008', 'Colores y señales de seguridad e higiene', '1BCb-bsMjm-lfe3dHdCqxGMyaUlWsFW0y', 'NOM-026-STPS-2008.pdf', 503696),
  nom('NOM-027-STPS-2008', 'Actividades de soldadura y corte', '1YNanF0qrcUKQFj0oCAH7EkKJhLpPpYDa', 'NOM-027-STPS-2008.pdf', 165568),
  nom('NOM-028-STPS-2012', 'Seguridad en los procesos de sustancias químicas', '1I6GszZ2HAhcy8HFP19Gifc_IuvrDnzjf', 'NOM-028-STPS-2012.pdf', 441146),
  nom('NOM-029-STPS-2011', 'Mantenimiento de las instalaciones eléctricas', '10Wzt9O20J8JTp_hh6pmyG6m_FEcS2qvc', 'NOM-029-STPS-2011.pdf', 225346),
  nom('NOM-030-STPS-2009', 'Servicios preventivos de seguridad y salud en el trabajo', '1zL6w--fAO67ysXvGQ5vBb3rGvLdY_TXe', 'NOM-030-STPS-2009.pdf', 87060),
  nom('NOM-031-STPS-2011', 'Construcción: condiciones de seguridad y salud', '1yqtQzuicj3Puw3IEjdFGN7At2XNlj_D9', 'NOM-031-STPS-2011.pdf', 363882),
  nom('NOM-032-STPS-2008', 'Seguridad para minas subterráneas de carbón', '1gp38TYjgvvoRPSD8xklA1ZeEblBx5TLi', 'NOM-032-STPS-2008.pdf', 414509),
  nom('NOM-033-STPS-2015', 'Trabajos en espacios confinados', '1FnrvpIqqfTt77drDIsv6NtwlxCr58UlC', 'NOM-033-STPS-2015.pdf', 451856),
  nom('NOM-034-STPS-2016', 'Acceso y actividades de trabajadores con discapacidad', '1bRuftdiUV8nXxlxy8WdK1uqPt3oz7W4e', 'NOM-034-STPS-2016.pdf', 142047),
  nom('NOM-035-STPS-2018', 'Factores de riesgo psicosocial en el trabajo', '1samgvxIua_BgFFQq8peGB82fzemP7XFi', 'NOM-035-STPS-2018.pdf', 731568),
  nom('NOM-036-1-STPS-2018', 'Factores de riesgo ergonómico. Parte 1: manejo manual de cargas', '1NziuSU7_HcEBqAMBSMxtnZf6uNZ3n7uU', 'NOM-036-1-STPS-2018.pdf', 902841),
  nom('NOM-037-STPS-2023', 'Teletrabajo: condiciones de seguridad y salud', '1x2IpTjOfHaQ0jDhY7T9ffgfBBu3_WE4E', 'NOM-037-STPS-2023.pdf', 2244553)
];
