/** Procedimientos corporativos — categorías y helpers de URLs Drive.
 *  El listado vivo viene de la API (`sgc_procedimientos`); este catálogo
 *  queda como respaldo offline / seed de referencia.
 */

export interface SgcProcedimientoDoc {
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

export interface SgcProcedimientoCategoria {
  id: string;
  prefijo: string;
  titulo: string;
  descripcion: string;
  iconClass: string;
  colorInicio: string;
  colorFin: string;
}

export const SGC_PROCEDIMIENTOS_CATEGORIAS: SgcProcedimientoCategoria[] = [
  {
    id: 'ath',
    prefijo: 'ATH',
    titulo: 'Administración de Talento Humano',
    descripcion: 'Reclutamiento, competencias, contratación y desarrollo organizacional.',
    iconClass: 'fas fa-users',
    colorInicio: '#15a596',
    colorFin: '#0f766e'
  },
  {
    id: 'ein',
    prefijo: 'EIN',
    titulo: 'Infraestructura',
    descripcion: 'Mantenimiento y conservación de instalaciones.',
    iconClass: 'fas fa-building',
    colorInicio: '#6366f1',
    colorFin: '#4f46e5'
  },
  {
    id: 'sgc',
    prefijo: 'SGC',
    titulo: 'Sistema de Gestión de Calidad',
    descripcion: 'Procedimientos ISO 9001: control documental, auditorías, riesgos y mejora.',
    iconClass: 'fas fa-award',
    colorInicio: '#059669',
    colorFin: '#047857'
  },
  {
    id: 'sp',
    prefijo: 'SP',
    titulo: 'Servicios Profesionales',
    descripcion: 'Consultoría, capacitación, trámites, protección civil y salud integral.',
    iconClass: 'fas fa-briefcase',
    colorInicio: '#d97706',
    colorFin: '#b45309'
  }
];

/** Respaldo si la API no responde (mismo seed que backend). */
export const SGC_PROCEDIMIENTOS_CATALOG: SgcProcedimientoDoc[] = [
  { codigo: 'ATH-P-01', titulo: 'Reclutamiento selección y contratación', driveFileId: '1aSDR7tBWqGAkaX6ItnVnclnHCEzQ_FlM', categoriaId: 'ath' },
  { codigo: 'ATH-P-02', titulo: 'Competencia y capacitación', driveFileId: '1j2pHscij-nBqkdRVBcIlvuntcUL-x-Iw', categoriaId: 'ath' },
  { codigo: 'ATH-P-03', titulo: 'Cotización contrato pago y facturación', driveFileId: '1aG4HKS6u6xtSsCcy6hTDyVw-I0J1zIKm', categoriaId: 'ath' },
  { codigo: 'ATH-P-04', titulo: 'Desarrollo organizacional', driveFileId: '185vgxkgCoah1WTiUkcOlQ2-r1zJneBb6', categoriaId: 'ath' },
  { codigo: 'EIN-P-01', titulo: 'Mantenimiento a la Infraestructura', driveFileId: '1AS5KdXdsw0q_8FLDdSr6acBe6X2YDELd', categoriaId: 'ein' },
  { codigo: 'SGC-P-01', titulo: 'Control de la información documentada', driveFileId: '1UbPgdWMW_9dkal-SN5pF2HWgx9jIhIwv', categoriaId: 'sgc' },
  { codigo: 'SGC-P-02', titulo: 'No conformidad y acciones correctivas', driveFileId: '1MgSI6jOsM16RkduA3IWFBT6dL1V35Ik1', categoriaId: 'sgc' },
  { codigo: 'SGC-P-03', titulo: 'Auditoría interna', driveFileId: '1PW55oVhSpyrSbUPEbXda5NFT5co0NFH1', categoriaId: 'sgc' },
  { codigo: 'SGC-P-04', titulo: 'Gestión de riesgos y oportunidades', driveFileId: '1i3bmsTRlnurihWL3C0dsoTd3sYPgI9xl', categoriaId: 'sgc' },
  { codigo: 'SGC-P-05', titulo: 'Mejora', driveFileId: '1SEkaHjB4SHuZAMsu5YI7aPSadp8YpNrg', categoriaId: 'sgc' },
  { codigo: 'SGC-P-06', titulo: 'Revisión por la dirección', driveFileId: '1Ury4RP-ZPSFZLw5E0nSbaLMOyF11g5Bu', categoriaId: 'sgc' },
  { codigo: 'SGC-P-07', titulo: 'Equipos de medición', driveFileId: '11v2cNi1gDLjK2U_oBNu1mfOv1f8qEYhY', categoriaId: 'sgc' },
  { codigo: 'SGC-P-08', titulo: 'Satisfacción del cliente', driveFileId: '1yP9mr1mbpkWXXu9ubdYMm_Q81nxA_IRI', categoriaId: 'sgc' },
  { codigo: 'SGC-P-09', titulo: 'Proveeduría externa', driveFileId: '1fOK0RbRQL-9gWf2MB_tpui-xktuMj6gA', categoriaId: 'sgc' },
  { codigo: 'SP-P-01', titulo: 'Consultoría estratégica REV-02', driveFileId: '10C1TvE1Cd8InvNBL2WIkCt_qDgrJDAky', categoriaId: 'sp' },
  { codigo: 'SP-P-02', titulo: 'Capacitación empresarial REV-01', driveFileId: '1pY-Xh9WgM--l8XdEm4vTQ2vZVyL2u7Jz', categoriaId: 'sp' },
  { codigo: 'SP-P-03', titulo: 'Trámites REV-02', driveFileId: '1Gshpfyk-Ku8xcw29nghcsDRCi-r42sIr', categoriaId: 'sp' },
  { codigo: 'SP-P-07', titulo: 'Programa Interno de Protección Civil', driveFileId: '1ocoRjEam6ODkckodKaVzW2tZdcKH-dW9', categoriaId: 'sp' },
  { codigo: 'SP-P-08', titulo: 'Plan integral de salud', driveFileId: '1OONXhouMRc8KuL9U1rJtD9qEDtMSaquX', categoriaId: 'sp' }
];

export function urlPreviewDriveProcedimiento(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/preview`;
}

export function urlThumbnailDriveProcedimiento(driveFileId: string, cacheBust = 0): string {
  const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w480`;
  return cacheBust ? `${base}&t=${cacheBust}` : base;
}

export function urlAbrirDriveProcedimiento(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}
