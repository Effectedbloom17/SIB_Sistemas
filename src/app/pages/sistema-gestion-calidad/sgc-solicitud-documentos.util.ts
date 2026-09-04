import { SgcF01DocumentoCatalogo, clonarCatalogoSgcF01 } from './sgc-f-01.catalog';

export type TipoSolicitudDocumento = 'modificacion' | 'creacion' | 'eliminacion';

export interface SgcDocCatalogoItem {
  nombreDocumento: string;
  codigo: string;
  versionVigente: string;
  especie?: string;
  tipoDocumento?: string;
  vigente?: boolean;
}

export const TIPOS_SOLICITUD_CICLO: TipoSolicitudDocumento[] = [
  'modificacion',
  'creacion',
  'eliminacion'
];

export const TIPO_SOLICITUD_LABELS: Record<TipoSolicitudDocumento, string> = {
  modificacion: 'Modificación',
  creacion: 'Creación',
  eliminacion: 'Eliminación'
};

export function normalizarTextoBusquedaDoc(valor: string): string {
  return String(valor || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function inferirTipoDocumentoDesdeCodigo(codigo: string): string {
  const c = String(codigo || '').toUpperCase().trim();
  if (!c) return '';
  if (/-PO-/.test(c)) return 'Política';
  if (/-F-/.test(c)) return 'Formato';
  if (/-I-/.test(c)) return 'Instructivo';
  if (/-P-/.test(c)) return 'Procedimiento';
  return '';
}

export function mapearTipoDocumentoSolicitud(especie?: string, codigo?: string): string {
  const e = String(especie || '').trim();
  const lower = e.toLowerCase();
  if (lower.includes('polit')) return 'Política';
  if (lower.includes('instruct')) return 'Instructivo';
  if (lower.includes('proced')) return 'Procedimiento';
  if (lower.includes('format')) return 'Formato';
  if (lower.includes('manual')) return 'Manual';
  if (lower.includes('registro')) return 'Registro';
  if (e) return e;
  return inferirTipoDocumentoDesdeCodigo(codigo || '');
}

export function ciclarTipoSolicitud(actual: TipoSolicitudDocumento): TipoSolicitudDocumento {
  const idx = TIPOS_SOLICITUD_CICLO.indexOf(actual);
  const next = idx < 0 ? 0 : (idx + 1) % TIPOS_SOLICITUD_CICLO.length;
  return TIPOS_SOLICITUD_CICLO[next];
}

export function resolverDocumentoCatalogo(
  catalogo: SgcDocCatalogoItem[],
  texto: string
): SgcDocCatalogoItem | null {
  const q = normalizarTextoBusquedaDoc(texto);
  if (!q) return null;

  const base = (catalogo || []).filter(
    (d) => d.vigente !== false && (d.nombreDocumento || d.codigo)
  );

  const exacto = base.find((d) =>
    normalizarTextoBusquedaDoc(d.codigo) === q
    || normalizarTextoBusquedaDoc(d.nombreDocumento) === q
  );
  if (exacto) return exacto;

  const filtrados = base.filter((d) => {
    const hay = `${d.codigo} ${d.nombreDocumento}`;
    return normalizarTextoBusquedaDoc(hay).includes(q);
  });
  if (filtrados.length === 1) return filtrados[0];
  return null;
}

export function filtrarDocumentosCatalogo(
  catalogo: SgcDocCatalogoItem[],
  query: string,
  limite = 12
): SgcDocCatalogoItem[] {
  const q = normalizarTextoBusquedaDoc(query);
  const base = (catalogo || []).filter(
    (d) => d.vigente !== false && (d.nombreDocumento || d.codigo)
  );
  if (!q) return base.slice(0, limite);
  return base
    .filter((d) => {
      const hay = `${d.codigo} ${d.nombreDocumento} ${d.versionVigente || ''}`;
      return normalizarTextoBusquedaDoc(hay).includes(q);
    })
    .slice(0, limite);
}

export function catalogoDocumentosFallback(): SgcDocCatalogoItem[] {
  return clonarCatalogoSgcF01().map((d: SgcF01DocumentoCatalogo) => ({
    nombreDocumento: d.nombreDocumento,
    codigo: d.codigo,
    versionVigente: d.versionVigente,
    especie: d.especie,
    tipoDocumento: mapearTipoDocumentoSolicitud(d.especie, d.codigo),
    vigente: d.vigente !== false
  }));
}

export function etiquetaDocumentoCatalogo(doc: SgcDocCatalogoItem): string {
  const partes = [
    doc.codigo,
    doc.versionVigente ? `v${doc.versionVigente}` : '',
    doc.nombreDocumento
  ].filter(Boolean);
  return partes.join(' · ');
}
