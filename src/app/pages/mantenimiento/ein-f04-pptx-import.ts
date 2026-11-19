/**
 * Importación de PowerPoint (.pptx) → uno o varios reportes EIN-F-04.
 * Cada diapositiva se revisa por separado (texto + imágenes).
 */
import JSZip from 'jszip';
import { EinF04WordImportResult, parsearFechaWord } from './ein-f04-word-import';
import { EinF04TipoMantenimiento } from './ein-f02-solicitud.catalog';

export interface EinF04PptxSlidePreview {
  indice: number;
  titulo: string;
  textoPlano: string;
  parsed: EinF04WordImportResult;
  imagenPreviews: string[];
  incluir: boolean;
}

export interface EinF04PptxImportPack {
  archivoNombre: string;
  slides: EinF04PptxSlidePreview[];
  avisos: string[];
}

function normalizar(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Texto plano de una diapositiva PPTX (`ppt/slides/slideN.xml`). */
export function textoPlanoDesdeSlideXml(xml: string): string {
  if (!xml) {
    return '';
  }
  const conSaltos = xml
    .replace(/<\/a:p>/gi, '\n')
    .replace(/<a:br\b[^/]*\/>/gi, '\n');
  const sinTags = conSaltos.replace(/<[^>]+>/g, '');
  return decodeXmlEntities(sinTags)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function valorTrasEtiqueta(texto: string, etiquetas: string[]): string | undefined {
  const lineas = texto.split(/\n+/);
  for (const linea of lineas) {
    const normLinea = normalizar(linea);
    for (const et of etiquetas) {
      const normEt = normalizar(et);
      if (!normEt || !normLinea.includes(normEt)) {
        continue;
      }
      const idxColon = linea.search(/[:：]/);
      if (idxColon >= 0) {
        const despues = linea.slice(idxColon + 1).trim();
        if (despues) {
          return despues.replace(/^[\s\-–—]+/, '').trim();
        }
      }
    }
  }
  return undefined;
}

function detectarTipo(texto: string): EinF04TipoMantenimiento | undefined {
  const norm = normalizar(texto);
  const bloque = (() => {
    const i = norm.indexOf('tipo de mantenimiento');
    if (i < 0) {
      return norm.slice(0, 500);
    }
    // Plantilla EIN-F-04 PPT: Preventivo / Correctivo justo debajo del label.
    return norm.slice(i, i + 320);
  })();

  const marcado = (opcion: string): boolean => {
    const re = new RegExp(
      `(?:[☒☑xX✓✔■●]|\\[[xX]\\]|\\(\\s*[xX]\\s*\\))\\s*${opcion}|${opcion}\\s*(?:[☒☑xX✓✔■●]|\\[[xX]\\])`,
      'i'
    );
    return re.test(bloque) || re.test(texto);
  };

  const prev = marcado('preventivo');
  const corr = marcado('correctivo');
  if (prev && !corr) {
    return 'Preventivo';
  }
  if (corr && !prev) {
    return 'Correctivo';
  }
  if (prev && corr) {
    const iPrev = bloque.search(/preventivo/);
    const iCorr = bloque.search(/correctivo/);
    return iCorr >= 0 && (iPrev < 0 || iCorr < iPrev) ? 'Correctivo' : 'Preventivo';
  }

  // En PPT a veces solo aparece el texto de la opción elegida cerca del label.
  const soloCorr = /\bcorrectivo\b/.test(bloque) && !/\bpreventivo\b/.test(bloque);
  const soloPrev = /\bpreventivo\b/.test(bloque) && !/\bcorrectivo\b/.test(bloque);
  if (soloCorr) return 'Correctivo';
  if (soloPrev) return 'Preventivo';
  return undefined;
}

function extraerDescripcion(texto: string): string | undefined {
  const labelMatch = texto.match(
    /breve\s+descripci[oó]n\s+del\s+mantenimiento\s+realizado|descripci[oó]n\s+del\s+mantenimiento\s+realizado|descripci[oó]n\s+del\s+problema|actividades?\s+realizadas?/i
  );
  if (!labelMatch || labelMatch.index == null) {
    // Si no hay etiqueta, usar el bloque de texto más largo como descripción.
    const lineas = texto.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const candidatas = lineas.filter(l => l.length >= 40 && !/^(folio|fecha|tipo|responsable)/i.test(l));
    if (candidatas.length) {
      return candidatas.slice(0, 4).join('\n');
    }
    return undefined;
  }
  const from = labelMatch.index + labelMatch[0].length;
  const resto = texto.slice(from);
  const finMatch = resto.match(
    /\n?\s*evidencia\s+fotogr[aá]fica|\n?\s*nombre\s+y\s+firma|\n?\s*responsable/i
  );
  const hasta = finMatch?.index != null ? finMatch.index : resto.length;
  let cuerpo = resto.slice(0, hasta).trim().replace(/^[:：\s\-–—]+/, '').trim();
  return cuerpo || undefined;
}

function detectarFolio(texto: string): string | undefined {
  const m = texto.match(/\b(EIFF0?2[-_\s]?\d{2,4}[-_]?\d{1,4})\b/i)
    || texto.match(/\bFolio\s*[:：]?\s*([A-Z0-9][-A-Z0-9_/]{4,})\b/i);
  return m ? String(m[1]).replace(/\s+/g, '').toUpperCase() : undefined;
}

function mimeDesdeNombre(nombre: string): string {
  const n = String(nombre || '').toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function extensionDesdeNombre(nombre: string, mime: string): string {
  const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m) return m[1];
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

async function leerMapaRels(zip: JSZip, relsPath: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const entry = zip.file(relsPath);
  if (!entry) return mapa;
  const xml = await entry.async('string');
  const re = /<Relationship\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const tag = match[0];
    const id = (tag.match(/\bId="([^"]+)"/i) || [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/i) || [])[1];
    const type = (tag.match(/\bType="([^"]+)"/i) || [])[1] || '';
    if (!id || !target) continue;
    if (type && !/\/image$/i.test(type) && !/media\//i.test(target)) continue;
    const cleaned = target.replace(/\\/g, '/');
    const media = cleaned.match(/(?:^|\/)(media\/[^?#]+)$/i);
    if (media) {
      mapa.set(id, `ppt/${media[1]}`.replace(/\/+/g, '/'));
    } else if (/^\.\.\/media\//i.test(cleaned)) {
      mapa.set(id, `ppt/${cleaned.replace(/^\.\.\//, '')}`.replace(/\/+/g, '/'));
    }
  }
  return mapa;
}

function rIdsImagenEnSlide(slideXml: string): string[] {
  const ids: string[] = [];
  const vistos = new Set<string>();
  const re = /<(?:a:blip|asvg:blip|p:blip)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slideXml))) {
    const rid = (match[0].match(/\b(?:r:embed|r:link)="([^"]+)"/i) || [])[1];
    if (!rid || vistos.has(rid)) continue;
    vistos.add(rid);
    ids.push(rid);
  }
  return ids;
}

function parsearCamposDesdeTexto(texto: string): EinF04WordImportResult {
  const avisos: string[] = [];
  const camposAplicados: string[] = [];
  const result: EinF04WordImportResult = { imagenes: [], camposAplicados, avisos };

  const tipo = detectarTipo(texto);
  if (tipo) {
    result.tipoMantenimiento = tipo;
    camposAplicados.push('tipo');
  }

  const fechaSolRaw = valorTrasEtiqueta(texto, [
    'Fecha de la solicitud del mantenimiento',
    'Fecha de la solicitud',
    'Fecha solicitud'
  ]);
  const fechaSol = parsearFechaWord(fechaSolRaw || '');
  if (fechaSol) {
    result.fechaSolicitud = fechaSol;
    camposAplicados.push('fechaSolicitud');
  }

  const fechaRealRaw = valorTrasEtiqueta(texto, [
    'Fecha en la que se realizó el mantenimiento',
    'Fecha en la que se realizo el mantenimiento',
    'Fecha realizado',
    'Fecha de realización'
  ]);
  const fechaReal = parsearFechaWord(fechaRealRaw || '');
  if (fechaReal) {
    result.fechaRealizado = fechaReal;
    camposAplicados.push('fechaRealizado');
  }

  const responsable = valorTrasEtiqueta(texto, [
    'Responsable quien realizó el mantenimiento',
    'Responsable quien realizo el mantenimiento',
    'Responsable quien realizó',
    'Responsable del mantenimiento'
  ]);
  if (
    responsable
    && !/^pendiente$/i.test(responsable)
    && !/^responsable$/i.test(normalizar(responsable))
    && !/nombre y firma/i.test(responsable)
  ) {
    result.responsableMantenimiento = responsable;
    camposAplicados.push('responsable');
  }

  const descripcion = extraerDescripcion(texto);
  if (descripcion) {
    result.descripcionMantenimientoRealizado = descripcion;
    camposAplicados.push('descripcion');
  }

  const folio = detectarFolio(texto);
  if (folio) {
    result.folioDetectado = folio;
  }

  const solicitante = valorTrasEtiqueta(texto, [
    'Nombre del solicitante',
    'Solicitante',
    'Reportó',
    'Reporto'
  ]);
  if (solicitante) {
    result.nombreSolicitante = solicitante;
    camposAplicados.push('solicitante');
  }

  if (!camposAplicados.length && texto.trim().length >= 20) {
    result.descripcionMantenimientoRealizado = texto.trim().slice(0, 1200);
    camposAplicados.push('descripcion');
    avisos.push('No se detectaron etiquetas EIN-F-04; se usó el texto de la diapositiva como descripción.');
  }

  return result;
}

function tituloSlide(texto: string, indice: number): string {
  const folio = detectarFolio(texto);
  if (folio) return folio;
  const primera = texto.split(/\n+/).map(l => l.trim()).find(l => l.length >= 4);
  if (primera) return primera.slice(0, 60);
  return `Diapositiva ${indice}`;
}

function slideTieneContenidoUtil(parsed: EinF04WordImportResult, texto: string): boolean {
  if ((parsed.camposAplicados || []).length) return true;
  if ((parsed.imagenes || []).length) return true;
  return texto.trim().length >= 12;
}

/**
 * Lee un .pptx y devuelve una vista previa por diapositiva lista para revisión.
 */
export async function importarEinF04DesdePptx(archivo: File): Promise<EinF04PptxImportPack> {
  const avisos: string[] = [];
  const nombre = String(archivo?.name || '').toLowerCase();
  if (!archivo) {
    throw new Error('No se seleccionó ningún archivo.');
  }
  if (nombre.endsWith('.ppt') && !nombre.endsWith('.pptx')) {
    throw new Error('El formato .ppt antiguo no es compatible. Guarda el archivo como .pptx.');
  }
  if (!nombre.endsWith('.pptx')
    && archivo.type !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    throw new Error('Selecciona un archivo PowerPoint (.pptx).');
  }

  const zip = await JSZip.loadAsync(archivo);
  const slidePaths = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
      return na - nb;
    });

  if (!slidePaths.length) {
    throw new Error('El PowerPoint no tiene diapositivas legibles.');
  }

  const slides: EinF04PptxSlidePreview[] = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideNum = Number((slidePath.match(/slide(\d+)/i) || [])[1] || i + 1);
    const entry = zip.file(slidePath);
    if (!entry) continue;
    const slideXml = await entry.async('string');
    const texto = textoPlanoDesdeSlideXml(slideXml);
    const parsed = parsearCamposDesdeTexto(texto);

    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const rels = await leerMapaRels(zip, relsPath);
    const imagenes: File[] = [];
    const imagenPreviews: string[] = [];
    let imgIdx = 1;
    for (const rid of rIdsImagenEnSlide(slideXml)) {
      const mediaPath = rels.get(rid);
      if (!mediaPath) continue;
      const mediaEntry = zip.file(mediaPath);
      if (!mediaEntry) continue;
      const base = mediaPath.split('/').pop() || `slide-${slideNum}-${imgIdx}.jpg`;
      const mime = mimeDesdeNombre(base);
      if (!/^image\//i.test(mime)) continue;
      const blob = await mediaEntry.async('blob');
      // Plantilla EIN-F-04: el logo Biznaga suele ser la 1.ª imagen; no es evidencia.
      if (imagenes.length === 0 && rIdsImagenEnSlide(slideXml).length > 2 && blob.size < 120_000) {
        const esLogoProbable = /logo|biznaga|header|membrete/i.test(base) || blob.size < 45_000;
        if (esLogoProbable) {
          continue;
        }
      }
      const ext = extensionDesdeNombre(base, mime);
      const file = new File(
        [blob],
        `pptx-s${slideNum}-ev-${imgIdx}.${ext}`,
        { type: mime === 'image/jpg' ? 'image/jpeg' : mime }
      );
      imagenes.push(file);
      imagenPreviews.push(URL.createObjectURL(file));
      imgIdx += 1;
    }
    parsed.imagenes = imagenes;
    if (imagenes.length) {
      parsed.camposAplicados.push(`imagenes(${imagenes.length})`);
    }

    const util = slideTieneContenidoUtil(parsed, texto);
    slides.push({
      indice: slideNum,
      titulo: tituloSlide(texto, slideNum),
      textoPlano: texto,
      parsed,
      imagenPreviews,
      incluir: util
    });
  }

  const utiles = slides.filter(s => s.incluir);
  if (!utiles.length) {
    throw new Error('No se encontró información útil en las diapositivas del PowerPoint.');
  }
  if (utiles.length < slides.length) {
    avisos.push(`${slides.length - utiles.length} diapositiva(s) vacías se marcaron para omitir.`);
  }

  return {
    archivoNombre: archivo.name,
    slides,
    avisos
  };
}

export function liberarPreviewsPptx(pack: EinF04PptxImportPack | null): void {
  if (!pack) return;
  for (const s of pack.slides || []) {
    for (const url of s.imagenPreviews || []) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  }
}
