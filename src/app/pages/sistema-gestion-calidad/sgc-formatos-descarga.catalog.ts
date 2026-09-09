/** Formatos limpios corporativos — solo consulta y descarga (Drive), por capítulos ISO. */

export type SgcFormatoTipo = 'word' | 'excel' | 'pptx' | 'pdf';

export interface SgcFormatoDescarga {
  /** Clave estable del catálogo (driveFileId original). */
  id: string;
  codigo: string;
  titulo: string;
  driveFileId: string;
  /** Capítulo ISO: capitulo-4 … capitulo-10 */
  categoriaId: string;
  nombreArchivo: string;
  tipo: SgcFormatoTipo;
  /** Versión activa (1 = original; 2+ tras reemplazos). */
  versionActual?: number;
  fechaUltimaActualizacion?: string | null;
  actualizadoPorNombre?: string | null;
  /** true si fue subido por un administrador (subido-*). */
  esSubido?: boolean;
}

export interface SgcFormatoCategoria {
  id: string;
  numero: number;
  prefijo: string;
  titulo: string;
  descripcion: string;
  iconClass: string;
  colorInicio: string;
  colorFin: string;
}

/** Misma estructura visual que Centro SGC (capítulos 4–10). */
export const SGC_FORMATOS_CATEGORIAS: SgcFormatoCategoria[] = [
  {
    id: 'capitulo-4',
    numero: 4,
    prefijo: 'CAP. 4',
    titulo: 'Contexto de la organización',
    descripcion: 'Comprensión de la organización, partes interesadas, alcance y procesos.',
    iconClass: 'fas fa-sitemap',
    colorInicio: '#0f766e',
    colorFin: '#14b8a6'
  },
  {
    id: 'capitulo-5',
    numero: 5,
    prefijo: 'CAP. 5',
    titulo: 'Liderazgo',
    descripcion: 'Compromiso de la dirección, política de calidad y roles organizacionales.',
    iconClass: 'fas fa-user-tie',
    colorInicio: '#6d28d9',
    colorFin: '#a78bfa'
  },
  {
    id: 'capitulo-6',
    numero: 6,
    prefijo: 'CAP. 6',
    titulo: 'Planificación',
    descripcion: 'Acciones para abordar riesgos, oportunidades y objetivos de calidad.',
    iconClass: 'fas fa-calendar-check',
    colorInicio: '#1d4ed8',
    colorFin: '#60a5fa'
  },
  {
    id: 'capitulo-7',
    numero: 7,
    prefijo: 'CAP. 7',
    titulo: 'Apoyo',
    descripcion: 'Recursos, competencia, comunicación, información documentada y soporte.',
    iconClass: 'fas fa-hands-helping',
    colorInicio: '#15803d',
    colorFin: '#4ade80'
  },
  {
    id: 'capitulo-8',
    numero: 8,
    prefijo: 'CAP. 8',
    titulo: 'Operación',
    descripcion: 'Planificación y control operacional, diseño y provisión de productos y servicios.',
    iconClass: 'fas fa-cogs',
    colorInicio: '#c2410c',
    colorFin: '#fb923c'
  },
  {
    id: 'capitulo-9',
    numero: 9,
    prefijo: 'CAP. 9',
    titulo: 'Evaluación del desempeño',
    descripcion: 'Seguimiento, medición, análisis, evaluación, auditoría interna y revisión.',
    iconClass: 'fas fa-chart-line',
    colorInicio: '#b45309',
    colorFin: '#fbbf24'
  },
  {
    id: 'capitulo-10',
    numero: 10,
    prefijo: 'CAP. 10',
    titulo: 'Mejora',
    descripcion: 'No conformidad, acciones correctivas y mejora continua del SGC.',
    iconClass: 'fas fa-sync-alt',
    colorInicio: '#be123c',
    colorFin: '#fb7185'
  }
];

function fmt(
  codigo: string,
  titulo: string,
  driveFileId: string,
  categoriaId: string,
  nombreArchivo: string
): SgcFormatoDescarga {
  const ext = nombreArchivo.split('.').pop()?.toLowerCase() || '';
  let tipo: SgcFormatoTipo = 'word';
  if (ext === 'xls' || ext === 'xlsx') {
    tipo = 'excel';
  } else if (ext === 'ppt' || ext === 'pptx') {
    tipo = 'pptx';
  } else if (ext === 'pdf') {
    tipo = 'pdf';
  }
  return { id: driveFileId, codigo, titulo, driveFileId, categoriaId, nombreArchivo, tipo };
}

/** Catálogo Formatos_limpios + DG/PO/DI organizados por capítulos ISO. */
export const SGC_FORMATOS_DESCARGA_CATALOG: SgcFormatoDescarga[] = [
  // ── Cap. 4 Contexto ──
  fmt('DG-F-04', 'Análisis FODA', '1NbSIXdjNw_Ygd22f2h0vAz-8gJ5y03tt', 'capitulo-4', 'DG-F-04 Análisis FODA.xlsx'),
  fmt('DG-F-05', 'Listado de partes interesadas', '10XvdGS2I2kiM4npzp7YPKJVe_9U5q5Wa', 'capitulo-4', 'DG-F-05 Listado de partes interesadas.xlsx'),
  fmt('DG-F-02', 'Alcance', '1ZBhclp084AS4Pxgvkukpu1kuKV7hQPtp', 'capitulo-4', 'DG-F-02 Alcance.docx'),
  fmt('DG-F-01', 'Mapa de procesos', '1fqwVLZuNZqQMWPpKhSITw_bxo-_64z6h', 'capitulo-4', 'DG-F-01 Mapa de procesos.docx'),
  fmt('DG-F-07', 'Caracterización de procesos', '1iYGK1KcsYIilSqtTcAMljXKmTbx6b0V0', 'capitulo-4', 'DG-F-07 Caracterización de procesos.xlsx'),

  // ── Cap. 5 Liderazgo ──
  fmt('SGC-F-18', 'Tabla de requisitos legales y reglamentarios', '1lF8neqhRhRktx_EIVZ5N744BACMr1kA5', 'capitulo-5', 'SGC-F-18 Tabla de requisitos legales y reglamentarios.xlsx'),
  fmt('SGC-PO-01', 'Política de calidad', '1cSMF8hoi5nOvU7opL0Q_bZBIJOwwbU7r', 'capitulo-5', 'SGC-PO-01 Politica de calidad_Biznaga.docx'),
  fmt('DG-F-08', 'Filosofía Biznaga Risk and Tech', '1fEfPhLuNVXd2rmuzSWtyTvNmqxqeTcqe', 'capitulo-5', 'DG-F-08 Filosofía Biznaga Risk and Tech.docx'),

  // ── Cap. 6 Planificación ──
  fmt('SGC-F-11', 'AMEF', '1UJk-Fv0NcEgRTHDUGlDZr3c--aNzJQ31', 'capitulo-6', 'SGC-F-11 AMEF.xlsx'),
  fmt('DG-F-03', 'Objetivos de calidad', '1WiLflIcVaCTRaYJKCFre6ejEZNUM_qUV', 'capitulo-6', 'DG-F-03 Objetivos de calidad.docx'),
  fmt('SGC-F-12', 'Notificacion de cambios al SGC', '1RXpyKoC8vw5NJfWjNqNaOia-ojDSy5mW', 'capitulo-6', 'SGC-F-12 Notificacion de cambios al SGC.xlsx'),
  fmt('SGC-DI-06', 'Metodología AMEF', '17jM2x1JwpekMg4xTJUByt9WraIXU05DWYbYg-jpXFG4', 'capitulo-6', 'Metodología AMEF.pptx'),

  // ── Cap. 7 Apoyo ──
  fmt('AF-F-02', 'Contrato', '1sBdyfShWudk4zzooCmmFE0vhZtQNmZGZ', 'capitulo-7', 'AF-F-02 Contrato.docx'),
  fmt('ATH-F-01', 'Organigrama Biznaga 2026', '1I1ljPLPmIFjSYx6xW5AQ5SAYXPiZH1wL', 'capitulo-7', 'ATH-F-01 Organigrama Biznaga 2026.pdf'),
  fmt('ATH-F-02', 'Descripción y perfil de puesto', '1GgIuHFxg0EkFjlz4csBSXKqMQpi8jEJA', 'capitulo-7', 'ATH-F-02 Descripción y perfil de puesto.xlsx'),
  fmt('ATH-F-03', 'Entrega - Recepción de EPP', '1wOY5S1v_2R-r7Y10S09c_h7uBjDsBV79', 'capitulo-7', 'ATH-F-03 Entrega - Recepción de EPP.docx'),
  fmt('ATH-F-04', 'Lista de documentos para contratación', '1yrGUQFlOonYKJ21V2CjTQhXEQxRy-Yxv', 'capitulo-7', 'ATH-F-04 Lista de documentos para contratación.xlsx'),
  fmt('ATH-F-06', 'DNC', '1HkeOY3KAPzrM6rJY_HziRjZ_TelTD-qg', 'capitulo-7', 'ATH-F-06 DNC.xlsx'),
  fmt('ATH-F-07', 'Programa de Capacitación', '1NTWlYRx86ZJNjpHl5Q1zHGMVFTv_bIFh', 'capitulo-7', 'ATH-F-07 Programa de Capacitación.doc'),
  fmt('ATH-F-08', 'Eficacia de la capacitación', '1hfLrMhj-8A3mK3NvDuuBMS8i3uJIRWXL', 'capitulo-7', 'ATH-F-08 Eficacia de la capacitación.xlsx'),
  fmt('ATH-F-13', 'Solicitud de vacaciones', '1jHJjnwgnv6FW7pH-gpxS5N1qQPyOe7PM', 'capitulo-7', 'ATH-F-13 Solicitud de vacaciones.docx'),
  fmt('ATH-F-14', 'Control de vacaciones', '1mFSPTBphwJaWHzoFnp5-9JZ2YaLhbqgM', 'capitulo-7', 'ATH-F-14 Control de vacaciones.xlsx'),
  fmt('EIN-F-01', 'Programa de mantenimiento a la infraestructura', '1MaXJjsd9IcjiNd70Z4zXmzouEP0pZG_k9l6izOkGSng', 'capitulo-7', 'EIN-F-01 Programa de mantenimiento a la infraestructura.xlsx'),
  fmt('EIN-F-02', 'Solicitud de mantenimiento', '1L2lK3cre8SADN9et3F-F0zzD1fa8YmRd', 'capitulo-7', 'EIN-F-02 Solicitud de mantenimiento.xlsx'),
  fmt('EIN-F-03', 'Bitácora de mantenimiento', '1CmYDinQTOv_nuDUTa0AmiWwgN-pWJWgypQifVOU0oi0', 'capitulo-7', 'EIN-F-03 Bitácora de mantenimiento.xlsx'),
  fmt('EIN-MAN', 'Manual', '1e28mWPWYPnrJvIyhabaGSSbcQrQJV4M8', 'capitulo-7', 'Manual.docx'),
  fmt('SGC-F-01', 'Lista maestra de documentos controlados REV 00', '1NAgUvvargXH3dkICZ0WQePJvt2Q3zUmbApAbwBhr6WY', 'capitulo-7', 'SGC-F-01 Lista maestra de documentos controlados REV 00.xlsx'),
  fmt('SGC-F-02', 'Solicitud de cambios a documentos', '1HIOltlUF0O9zxZ6tedSSCZgzuG0eSw45iHe3IKdF9xQ', 'capitulo-7', 'SGC-F-02 Solicitud de cambios a documentos.xlsx'),
  fmt('SGC-F-03', 'Lista de distribución de documentos REV 00', '1sl3L2WhTRhjwVptlPAHGaZZQD_QvSA_v', 'capitulo-7', 'SGC-F-03 Lista de distribución de documentos REV 00.xlsx'),
  fmt('SGC-F-17', 'Bitácora de calibración y verificación de equipos de medición', '1_fdHg-uaqnWShJcyeazGFhzPLcOVtH6c', 'capitulo-7', 'SGC-F-17 Bitácora de calibración y verificación de equipos de medición.xlsx'),
  fmt('SGC-F-19', 'Listado de conocimientos de la organización', '1Yf4_zm5KzQWPXgtSMFFwBb6LgH6N_ogu', 'capitulo-7', 'SGC-F-19 Listado de conocimientos de la organización.xlsx'),
  fmt('SGC-F-20', 'Ficha de conocimientos', '1fZS8EqyjVXu8smfKps6wKDweFI9I2PRp', 'capitulo-7', 'SGC-F-20 Ficha de conocimientos.xlsx'),
  fmt('SGC-F-21', 'Tablero de Comuniación', '1V_JpRtXRIJB3THMdLeiWVX5e2If2Zjff', 'capitulo-7', 'SGC-F-21 Tablero de Comuniación.xlsx'),
  fmt('SGC-F-27', 'Reporte de verificación de equipos de medición', '1TBXqkb9JKw2v8NVOEcACvYidsHbbcl_e', 'capitulo-7', 'SGC-F-27 Reporte de verificación de equipos de medición.xlsx'),
  fmt('SGC-I-00', 'Instructivo', '15qngMa_qY-Id-PoqpY14_wZN9gdnTQMk', 'capitulo-7', 'SGC-I-00 Instructivo.doc'),

  // ── Cap. 8 Operación ──
  fmt('ATH-F-09', 'Cotización Rev 2', '1TIBbSYCxnwFo3YJOb2HcPpkvvYJH2Mmd', 'capitulo-8', 'ATH-F-09 Cotización Rev 2.docx'),
  fmt('ATH-F-09', 'Cotización', '1KmEUSe8Nx0swgs0MpPn7cCOq6PfKMggR', 'capitulo-8', 'ATH-F-09 Cotización.docx'),
  fmt('SGC-F-22', 'Reporte de daño o perdida de propiedad del cliente o proveedor', '1asICBqzuBkhpvD4tXdfB1VIkFNPyhiOGNv6SxaEcYMw', 'capitulo-8', 'SGC-F-22 Reporte de daño o perdida de propiedad del cliente o proveedor.xlsx'),
  fmt('SGC-F-23', 'Aviso de privacidad de datos personales (Biznaga)', '1eLXnioCus439yYn_idYI_ZGMu8A1egKY', 'capitulo-8', 'SGC-F-23 Aviso de privacidad de datos personales (Biznaga).docx'),
  fmt('SGC-F-24', 'Control de cambios', '19n0BZV3eRuD80BFnULD8MXTZt0QGSd98', 'capitulo-8', 'SGC-F-24 Control de cambios.xlsx'),
  fmt('SGC-F-25', 'Actividades posteriores a la entrega', '1Z9274MtL2PAifIi9_lAF2TrfihhJ7Ncg', 'capitulo-8', 'SGC-F-25 Actividades posteriores a la entrega.xlsx'),
  fmt('SGC-F-27', 'Orden de compra', '1fwlGktID5LGN7AqsP-AXFGmnZ-hIThOa', 'capitulo-8', 'SGC-F-27 Orden de compra.xlsx'),
  fmt('SGC-F-28', 'Comparativa de proveedores', '1iwv4OBckp-4m6gjlYA5tRRj_PQgjuvgh', 'capitulo-8', 'SGC-F-28 Comparativa de proveedores.xlsx'),
  fmt('SGC-F-29', 'Evaluación de Proveedores', '12t9GUYEMj8p_shhD1aG6iNDul3TpThDY', 'capitulo-8', 'SGC-F-29 Evaluación de Proveedores.xlsx'),
  fmt('SGC-F-30', 'Encuesta de satisfacción del proveedor', '1uw5SAMYOCpFWvu4UR7V7OOaMKCfrrG5C', 'capitulo-8', 'SGC-F-30 Encuesta de satisfacción del proveedor.xlsx'),
  fmt('SP-F-01', 'Listado maestro de documentación a solicitar REV-01', '1PRQ2Mnip8YWPSQ6ycs9nvdOJAVYyid2I', 'capitulo-8', 'SP-F-01 Listado maestro de documentación a solicitar REV-01.xlsx'),
  fmt('SP-F-02', 'Reporte de visita y recorrido', '1QtGWRsLZwopCPkLAF-V-v-Gf0kHmQTCi', 'capitulo-8', 'SP-F-02 Reporte de visita y recorrido.xlsx'),
  fmt('SP-F-03', 'Control de entrega de documentos REV 01', '1W7aojSWva2gcVwaOLZM_mz7gAEp6Eqqm', 'capitulo-8', 'SP-F-03 Control de entrega de documentos REV 01.docx'),
  fmt('SP-F-04', 'Control de Proyectos Biznaga', '11pNSvWqSp_kN3dr3EAvgBP8AcP1MPVmi', 'capitulo-8', 'SP-F-04 Control de Proyectos Biznaga.xlsx'),
  fmt('SP-F-05', 'Control de avance de proyecto REV 01', '1xD18ErrqaxQxAVdXH6Bf2Z8RtMNdpQDa', 'capitulo-8', 'SP-F-05 Control de avance de proyecto REV 01.xlsx'),
  fmt('SP-F-06', 'Listado básico para diagnóstico situacional', '1Ge29giPEFwXBmg-kfMpioRW6bcSyGzki', 'capitulo-8', 'SP-F-06 Listado básico para diagnóstico situacional.xlsx'),
  fmt('SP-F-07', 'Plan del curso', '1sh6s6nR2JJ6j6i6ELJmDtMBZCBqVIFG3', 'capitulo-8', 'SP-F-07 Plan del curso.xlsx'),
  fmt('SP-F-08', 'Lista de verificación de necesidades para el curso', '1W7spY03iYgHxiDv7s4uH2eT5MmBDSBOW', 'capitulo-8', 'SP-F-08 Lista de verificación de necesidades para el curso.xlsx'),
  fmt('SP-F-09', 'Evaluación diagnóstica', '1Lq64OWTySUBI6gSnH5_pbaIdPgs4l5T6', 'capitulo-8', 'SP-F-09 Evaluación diagnóstica.docx'),
  fmt('SP-F-09', 'Evaluación diagnóstica', '1HgE8qGknMWsk6T8gps6nS7CWcVGvNZGb', 'capitulo-8', 'SP-F-09 Evaluación diagnóstica.xlsx'),
  fmt('SP-F-10', 'Evaluación del aprendizaje', '126deu0W9kRxAXjIYPi7kxExSF9KdJENI', 'capitulo-8', 'SP-F-10 Evaluación del aprendizaje.docx'),
  fmt('SP-F-10', 'Evaluación del aprendizaje', '1gioatdtaUSarw4SZuArM6zejuS5veBKf', 'capitulo-8', 'SP-F-10 Evaluación del aprendizaje.xlsx'),
  fmt('SP-F-11', 'Informe final del curso', '1txYj3VeuHpCcME5Oxp8SfDD8UfekNIVk', 'capitulo-8', 'SP-F-11 Informe final del curso.xlsx'),
  fmt('SP-F-12', 'Solicitud de datos del participante', '1R9esTIKZo7iVgAL_UqnKOyOnKndhd03I', 'capitulo-8', 'SP-F-12 Solicitud de datos del participante.xlsx'),
  fmt('SP-F-15', 'Control oficios', '1UG8OfLMjKUCUIqr08k8mtepNUNc3sD45', 'capitulo-8', 'SP-F-15 Control oficios.xlsx'),
  fmt('SP-F-28', 'Control de estatus de trámites', '1zhWH7qwA2lqwr-cWPOFyrq3xZvYkWNEd', 'capitulo-8', 'SP-F-28 Control de estatus de trámites.xlsx'),
  fmt('SP-F-29', 'Control de resolutivos PIPC', '1W8A_7d-C8cvbDgkqE90n3JWN6iy1fgmu', 'capitulo-8', 'SP-F-29 Control de resolutivos PIPC.xlsx'),

  // ── Cap. 9 Evaluación del desempeño ──
  fmt('ATH-F-11', 'Evaluación de desempeño', '1f1bqkxu-Nzci72CGN1-j1vPX1xwWbJR9', 'capitulo-9', 'ATH-F-11 Evaluación de desempeño.docx'),
  fmt('SGC-F-06', 'Lista y calificación de auditores internos', '1W4zLgVcXuxr3eVbIIgLykaQccRQlfrXx', 'capitulo-9', 'SGC-F-06 Lista y calificación de auditores internos.xlsx'),
  fmt('SGC-F-07', 'Programa de auditoría', '1Z9bR6NtFvaWj27BO9T-vtadCAv7pl-qe', 'capitulo-9', 'SGC-F-07 Programa de auditoría.xls'),
  fmt('SGC-F-08', 'Plan de auditoría', '1v5BKGVPnu-NI44ev8lG1j9zdy7bFJp5t', 'capitulo-9', 'SGC-F-08 Plan de auditoría.xlsx'),
  fmt('SGC-F-09', 'Lista de verificación de auditoría', '1N0XFxQ4pBpmlnqsf0JUZc_BTW_unWZEx', 'capitulo-9', 'SGC-F-09 Lista de verificación de auditoría.docx'),
  fmt('SGC-F-10', 'Informe de auditoría', '1qe83iT5T8pQHEmLpX7T_RWKlwK7kcqVy', 'capitulo-9', 'SGC-F-10 Informe de auditoría.docx'),
  fmt('SGC-F-15', 'Análisis y evaluación de indicadores', '1exxb2RLamONJU4WRHjrfkmVeHgBncS33', 'capitulo-9', 'SGC-F-15 Análisis y evaluación de indicadores.xlsx'),
  fmt('SGC-F-16', 'Minuta', '17iGzIrHLg26lRNUTsQOEIrbrjpE9agyJ', 'capitulo-9', 'SGC-F-16 Minuta.xlsx'),
  fmt('DG-F-06', 'Cuadro de mando', '1sjnun7HgBMf-o9iDRLvN5C7yH_5vJkKSf7mnaGxGGOI', 'capitulo-9', 'DG-F-06 Cuadro de mando.xlsx'),
  fmt('SGC-F-26', 'Encuesta de satisfacción del cliente', '1VwcPTVGE54S2uPKUh5s1uOfPxlAcYNzt', 'capitulo-9', 'SGC-F-26 Encuesta de satisfacción del cliente.doc'),
  fmt('SGC-F-33', 'Lista de asistencia', '1OPLJ385reI8HLQYOShgf972qi2hHklIz', 'capitulo-9', 'SGC-F-33 Lista de asistencia.xls'),

  // ── Cap. 10 Mejora ──
  fmt('SGC-F-04', 'Reporte de no conformidad', '1QdDYj8DlY4cAsWpF0UZd7SnoJ2t52WzhnXgrKQ80GvU', 'capitulo-10', 'SGC-F-04 Reporte de no conformidad Rev 02.xlsx'),
  fmt('SGC-F-05', 'Bitacora de no conformidades', '17Rd37pyaQqubyndRcouc1TwOEgn6myZWlN0t05MW7MY', 'capitulo-10', 'SGC-F-05 Bitacora de no conformidades.xlsx'),
  fmt('SGC-F-13', 'Plan de acción', '1Y1pVNdpL7K58ChKX_cDrkFPl8gE7zzxo', 'capitulo-10', 'SGC-F-13 Plan de acción.xlsx'),
  fmt('SGC-F-14', 'Bitácora de proyectos de mejora', '18GVfSlhrDDg3PvBVRp_launYo4IBd7WN', 'capitulo-10', 'SGC-F-14 Bitácora de proyectos de mejora.xlsx')
];

export function etiquetaTipoFormato(tipo: SgcFormatoTipo): string {
  if (tipo === 'excel') {
    return 'Excel';
  }
  if (tipo === 'pptx') {
    return 'Documento';
  }
  if (tipo === 'pdf') {
    return 'PDF';
  }
  return 'Word';
}

export function extensionFormato(doc: SgcFormatoDescarga): string {
  const ext = doc.nombreArchivo.split('.').pop()?.toUpperCase();
  if (ext) {
    return ext;
  }
  if (doc.tipo === 'excel') {
    return 'XLSX';
  }
  if (doc.tipo === 'pptx') {
    return 'PPTX';
  }
  if (doc.tipo === 'pdf') {
    return 'PDF';
  }
  return 'DOCX';
}

export function iconoTipoFormato(tipo: SgcFormatoTipo): string {
  if (tipo === 'excel') {
    return 'fas fa-file-excel';
  }
  if (tipo === 'pptx') {
    return 'fas fa-file-alt';
  }
  if (tipo === 'pdf') {
    return 'fas fa-file-pdf';
  }
  return 'fas fa-file-word';
}
