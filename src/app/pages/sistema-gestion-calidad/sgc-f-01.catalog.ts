/**
 * SGC-F-01 · Catálogo base de la lista maestra (desarrollo).
 * Fuente: hoja 1raOGsFXYsXffNFY0Zm42KuKKdIDHPtyF (orden Excel, no alfabético).
 * Secciones: PROCEDIMIENTOS → FORMATOS → POLÍTICAS → INSTRUCTIVOS → DOCUMENTOS EXTERNOS
 */

export interface SgcF01DocumentoCatalogo {
  area: string;
  tipoDocumento: string;
  /** Clave de sección Excel (Procedimiento, Formato, …). */
  especie: string;
  codigo: string;
  versionVigente: string;
  fechaRevision: string;
  nombreDocumento: string;
  responsable: string;
  /** false = no vigente (oculto en lista maestra salvo superadmin; oculto en Centro SGC). */
  vigente?: boolean;
  fuenteVersion?: 'sistema' | 'catalogo';
  enSistema?: boolean;
}

export interface SgcF01SeccionDef {
  id: string;
  titulo: string;
  /** Valores de `especie` que pertenecen a esta sección. */
  especies: string[];
}

/** Orden de bloques tal cual el Excel oficial. */
export const SGC_F01_SECCIONES: SgcF01SeccionDef[] = [
  { id: 'procedimientos', titulo: 'PROCEDIMIENTOS', especies: ['Procedimiento'] },
  { id: 'formatos', titulo: 'FORMATOS', especies: ['Formato'] },
  { id: 'politicas', titulo: 'POLÍTICAS', especies: ['Política'] },
  { id: 'instructivos', titulo: 'INSTRUCTIVOS', especies: ['Instructivo'] },
  { id: 'documentos-externos', titulo: 'DOCUMENTOS EXTERNOS', especies: ['Documento', 'Externo', 'Documento externo'] }
];

export const SGC_F01_ESPECIES = [
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
] as const;

const RESPONSABLE = 'Ejecutivo de Sist. Gest. y Cap.';

function d(
  area: string,
  tipoDocumento: string,
  especie: string,
  codigo: string,
  versionVigente: string,
  fechaRevision: string,
  nombreDocumento: string,
  responsable = RESPONSABLE
): SgcF01DocumentoCatalogo {
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

export const SGC_F01_CATALOGO_BASE: SgcF01DocumentoCatalogo[] = [

  // —— PROCEDIMIENTOS ——
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-01', '00', '2024-08-01', 'Control de la información documentada'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-02', '00', '2025-01-13', 'No conformidad y acciones correctivas'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-03', '00', '2025-01-14', 'Auditoría interna'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-04', '00', '2025-01-16', 'Gestión de riesgos y oportunidades'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-05', '00', '2025-01-17', 'Mejora'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-06', '00', '2025-01-20', 'Revisión por la dirección'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-07', '00', '2025-01-21', 'Equipos de medición'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-08', '01', '2026-04-27', 'Satisfacción del cliente'),
  d('SGC', 'Interno', 'Procedimiento', 'SGC-P-09', '00', '2025-07-28', 'Proveeduría externa'),
  d('EIN', 'Interno', 'Procedimiento', 'EIN-P-01', '00', '2026-05-22', 'Mantenimiento a la infraestructura'),
  d('ATH', 'Interno', 'Procedimiento', 'ATH-P-01', '00', '2026-02-09', 'Reclutamiento, selección y contratación'),
  d('ATH', 'Interno', 'Procedimiento', 'ATH-P-02', '01', '2026-03-20', 'Competencia y capacitación'),
  d('ATH', 'Interno', 'Procedimiento', 'ATH-P-03', '01', '2026-05-19', 'Cotización, contrato, pago y facturación'),
  d('ATH', 'Interno', 'Procedimiento', 'ATH-P-04', '00', '2026-03-02', 'Desarrollo organizacional'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-01', '02', '2026-05-12', 'Consultoría estratégica'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-02', '02', '2026-04-22', 'Capacitación empresarial'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-03', '02', '2025-11-07', 'Trámites'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-04', '00', '2025-08-14', 'Medición de tierras físicas'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-05', '00', '2025-08-15', 'Verificación de los niveles de ruido'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-06', '00', '2025-08-15', 'Verificación de los niveles de iluminación'),
  d('SP', 'Interno', 'Procedimiento', 'SP-P-07', '00', '2026-07-13', 'Programa interno de protección civil'),

  // —— FORMATOS ——
  d('SGC', 'Interno', 'Formato', 'SGC-F-01', '00', '2024-08-01', 'Lista maestra de documentos controlados'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-02', '00', '2024-08-01', 'Solicitud de cambios a documentos'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-03', '00', '2024-08-01', 'Lista de distribución de documentos'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-04', '02', '2026-08-05', 'Reporte de no conformidad'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-05', '00', '2025-01-13', 'Bitácora de no conformidades'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-06', '00', '2025-01-14', 'Lista y calificación de auditores internos'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-07', '00', '2025-01-14', 'Programa de auditoría'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-08', '00', '2025-01-14', 'Plan de auditoría'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-09', '00', '2025-01-14', 'Lista de verificación'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-10', '00', '2025-01-14', 'Informe de auditoría'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-11', '00', '2025-01-16', 'AMEF'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-12', '00', '2025-01-17', 'Notificación de cambios al SGC'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-13', '00', '2025-01-17', 'Plan de acción'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-14', '00', '2025-01-17', 'Bitácora de proyectos de mejora'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-15', '00', '2025-01-20', 'Análisis y evaluación de indicadores'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-16', '00', '2021-01-13', 'Minuta'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-17', '00', '2025-01-21', 'Bitácora de calibración y verificación de equipos de medición'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-18', '00', '2025-07-03', 'Tabla de requisitos legales y reglamentarios'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-19', '00', '2025-01-20', 'Listado de conocimientos de la organización'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-20', '00', '2025-01-20', 'Ficha de conocimientos'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-21', '00', '2025-01-20', 'Tablero de comunicación'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-22', '00', '2025-01-20', 'Registro de daño o pérdida de propiedad del cliente o proveedor'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-23', '00', '2025-01-20', 'Aviso de privacidad de datos personales'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-24', '00', '2025-01-20', 'Control de cambios'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-25', '00', '2025-01-20', 'Actividades posteriores a la entrega'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-26', '00', '2025-01-24', 'Cuestionario de satisfacción del cliente'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-27', '00', '2025-07-18', 'Orden de compra', 'Ger. Administración y TH'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-28', '00', '2025-01-23', 'Comparativa de proveedores', 'Ger. Administración y TH'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-29', '00', '2025-01-23', 'Evaluación de proveedores'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-30', '00', '2025-01-23', 'Encuesta de satisfacción del proveedor'),
  d('SGC', 'Interno', 'Formato', 'SGC-F-33', '00', '2022-05-17', 'Lista de asistencia'),
  d('SP', 'Interno', 'Formato', 'SP-F-01', '01', '2025-01-08', 'Listado maestro de documentación a solicitar', 'Colaborador'),
  d('SP', 'Interno', 'Formato', 'SP-F-02', '00', '2021-08-05', 'Reporte de visita y recorrido', 'Consultor'),
  d('SP', 'Interno', 'Formato', 'SP-F-03', '01', '2025-10-08', 'Control de entrega de documentos', 'Colaborador'),
  d('SP', 'Interno', 'Formato', 'SP-F-04', '00', '2020-10-13', 'Control de proyectos Biznaga', 'Dirección General'),
  d('SP', 'Interno', 'Formato', 'SP-F-05', '01', '2025-01-08', 'Control de avance de proyecto', 'Consultor'),
  d('SP', 'Interno', 'Formato', 'SP-F-06', '00', '2025-01-07', 'Listado básico para diagnóstico situacional', 'Consultor'),
  d('SP', 'Interno', 'Formato', 'SP-F-07', '00', '2025-01-08', 'Plan del curso', 'Instructor'),
  d('SP', 'Interno', 'Formato', 'SP-F-08', '00', '2025-01-08', 'Lista de verificación de necesidades para el curso', 'Instructor'),
  d('SP', 'Interno', 'Formato', 'SP-F-09', '00', '2025-01-08', 'Evaluación diagnóstica', 'Instructor'),
  d('SP', 'Interno', 'Formato', 'SP-F-10', '00', '2025-01-08', 'Evaluación del aprendizaje', 'Instructor'),
  d('SP', 'Interno', 'Formato', 'SP-F-11', '01', '2025-10-16', 'Informe final del curso', 'Instructor'),
  d('SP', 'Interno', 'Formato', 'SP-F-12', '00', '2025-01-08', 'Solicitud de datos del participante'),
  d('SP', 'Interno', 'Formato', 'SP-F-13', '00', '2025-01-08', 'Control de capacitación empresarial'),
  d('SP', 'Interno', 'Formato', 'SP-F-14', '00', '2025-01-24', 'Instrumento de satisfacción del curso'),
  d('SP', 'Interno', 'Formato', 'SP-F-15', '00', '2025-08-13', 'Control de oficios', 'Dirección General'),
  d('SP', 'Interno', 'Formato', 'SP-F-16', '00', '2025-08-14', 'Reconocimiento de red de puesta a tierra', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-17', '00', '2025-08-14', 'Hoja de campo', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-18', '00', '2025-08-14', 'Cálculos de la resistencia de puesta a tierra para cada punto', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-19', '00', '2025-08-14', 'Resumen de los resultados de la medición de la resistencia a tierra', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-20', '00', '2025-08-15', 'Registro del NS(A) o NSCE(A,T)', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-21', '00', '2025-08-15', 'Gráfica de los NS(A) por punto', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-22', '00', '2025-08-15', 'Registro de los NPA por bandas de octava', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-23', '00', '2025-08-15', 'Registro del espectro acústico', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-24', '00', '2025-08-15', 'Registro de evaluación personal', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-25', '00', '2025-08-15', 'Hoja de reconocimiento de condiciones de iluminación', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-26', '00', '2025-08-15', 'Resultados de la medición', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-27', '00', '2025-08-15', 'Informe de resultados del estudio de iluminación', 'Técnico verificador'),
  d('SP', 'Interno', 'Formato', 'SP-F-28', '00', '2025-11-07', 'Control de estatus de trámites', 'Consultores'),
  d('SP', 'Interno', 'Formato', 'SP-F-29', '00', '2026-01-19', 'Control de resolutivos PIPC'),
  d('EIN', 'Interno', 'Formato', 'EIN-F-01', '00', '2025-01-22', 'Programa de mantenimiento a la infraestructura', 'Gerente Estrategias e innovación'),
  d('EIN', 'Interno', 'Formato', 'EIN-F-02', '00', '2025-01-22', 'Solicitud de mantenimiento'),
  d('EIN', 'Interno', 'Formato', 'EIN-F-03', '00', '2025-01-22', 'Bitácora de mantenimiento', 'Gerente Estrategias e innovación'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-01', '00', '2025-07-09', 'Organigrama', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-02', '00', '2025-07-10', 'Descripción y perfil de puesto', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-03', '00', '2026-02-09', 'Entrega - recepción de EPP', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-04', '00', '2025-01-27', 'Lista de documentos para contratación', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-05', '00', '', 'Contrato laboral', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-06', '00', '2025-01-28', 'DNC', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-07', '00', '2025-01-28', 'Programa de capacitación', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-08', '00', '2026-01-26', 'Eficacia de la capacitación', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-09', '01', '2025-08-25', 'Cotización', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-10', '00', '', 'Contrato de prueba', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-11', '00', '2026-03-04', 'Evaluación de desempeño', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-12', '00', '2026-03-17', 'Reglamento interno de trabajo', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-13', '00', '2026-03-17', 'Solicitud de vacaciones', 'Gerente de Admón y Talento Humano'),
  d('ATH', 'Interno', 'Formato', 'ATH-F-14', '00', '2026-03-17', 'Control de vacaciones', 'Gerente de Admón y Talento Humano'),
  d('DG', 'Interno', 'Formato', 'DG-F-01', '00', '2025-01-20', 'Mapa de procesos', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-02', '00', '2025-07-11', 'Alcance', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-03', '00', '2025-07-10', 'Objetivos de calidad', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-04', '00', '2025-01-21', 'Análisis FODA', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-05', '00', '2025-01-21', 'Listado de partes interesadas y sus requisitos', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-06', '00', '2025-01-21', 'Cuadro de mando para objetivos de calidad e indicadores', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-07', '00', '2025-01-21', 'Caracterización de procesos', 'Dirección General'),
  d('DG', 'Interno', 'Formato', 'DG-F-08', '00', '2026-03-17', 'Filosofía Biznaga Risk and Tech', 'Dirección General'),

  // —— POLÍTICAS ——
  d('Dirección General', 'Interno', 'Política', 'SGC-PO-01', '00', '2025-07-09', 'Política de calidad'),
  d('Dirección General', 'Interno', 'Política', 'SGC-PO-02', '00', '2025-07-09', 'Política de protección de propiedad del cliente o proveedor'),

  // —— INSTRUCTIVOS ——
  d('Admón y Talento Humano', 'Interno', 'Instructivo', 'SGC-I-01', '00', '2026-06-03', 'Número de cotización y número de proyecto', 'Ger. Admón y Talento Humano'),
  d('SGC', 'Interno', 'Instructivo', 'SGC-I-02', '00', '2026-06-03', 'Folio para no conformidades'),
  d('SGC', 'Interno', 'Instructivo', 'SGC-I-03', '00', '2026-06-03', 'Folio para proyectos de mejora'),

  // —— DOCUMENTOS EXTERNOS ——
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2025-01-16', 'Metodología AMEF'),
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2025-01-21', 'Norma Internacional ISO 9001:2015 Requisitos'),
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2025-01-21', 'Norma Internacional ISO 9000:2015 Fundamentos y vocabulario'),
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2025-01-21', 'Norma Internacional ISO 19011:2018 Directrices para auditar sistemas de gestión'),
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2025-10-15', 'Técnicas para identificar la causa raíz para hallazgos de auditoría'),
  d('SGC', 'Externo', 'Documento externo', '', 'Sí', '2026-02-17', 'Manual del MOCEBPASS para hospitales'),
];

export function clonarCatalogoSgcF01(): SgcF01DocumentoCatalogo[] {
  return SGC_F01_CATALOGO_BASE.map((row) => ({ ...row }));
}

export function seccionIdParaEspecie(especie: string): string {
  const e = String(especie || '').trim().toLowerCase();
  for (const sec of SGC_F01_SECCIONES) {
    if (sec.especies.some((x) => x.toLowerCase() === e)) {
      return sec.id;
    }
  }
  return 'otros';
}

export function esDocumentoExternoSgcF01(doc?: {
  tipoDocumento?: string;
  especie?: string;
  codigo?: string;
} | null): boolean {
  if (!doc) return false;
  const tipo = String(doc.tipoDocumento || '').trim().toLowerCase();
  const especie = String(doc.especie || '').trim().toLowerCase();
  const codigo = String(doc.codigo || '').trim().toUpperCase();
  return tipo === 'externo'
    || especie === 'documento externo'
    || especie === 'externo'
    || /^EXT-\d+$/.test(codigo);
}

/** Índice en el catálogo Excel (orden fijo; -1 si no está). */
export function indiceCatalogoSgcF01(codigo: string, nombreDocumento?: string): number {
  const c = String(codigo || '').trim().toUpperCase();
  if (c) {
    const byCode = SGC_F01_CATALOGO_BASE.findIndex((row) => row.codigo.toUpperCase() === c);
    if (byCode >= 0) return byCode;
  }
  const n = String(nombreDocumento || '').trim().toLowerCase();
  if (n) {
    return SGC_F01_CATALOGO_BASE.findIndex((row) => row.nombreDocumento.trim().toLowerCase() === n);
  }
  return -1;
}

/** Conserva el orden del Excel; docs desconocidos al final por sección. */
export function ordenarComoExcelSgcF01<T extends {
  codigo?: string;
  especie?: string;
  nombreDocumento?: string;
}>(filas: T[]): T[] {
  return [...filas].sort((a, b) => {
    const ia = indiceCatalogoSgcF01(a.codigo || '', a.nombreDocumento);
    const ib = indiceCatalogoSgcF01(b.codigo || '', b.nombreDocumento);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    const sa = SGC_F01_SECCIONES.findIndex((s) => s.id === seccionIdParaEspecie(a.especie || ''));
    const sb = SGC_F01_SECCIONES.findIndex((s) => s.id === seccionIdParaEspecie(b.especie || ''));
    return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
  });
}
