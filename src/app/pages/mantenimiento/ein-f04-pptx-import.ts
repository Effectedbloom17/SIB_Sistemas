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

const RE_ETIQUETA_LINEA =
  /^(fecha|tipo|responsable|descripci[oó]n|evidencia|folio|nombre|solicitante|breve\s+descripci|c[oó]digo|no\.?\s*rev)/i;

function esOtraEtiqueta(linea: string): boolean {
  const t = String(linea || '').trim();
  if (!t) {
    return false;
  }
  if (RE_ETIQUETA_LINEA.test(t)) {
    return true;
  }
  // "Responsable quien realizó el mantenimiento:" sin valor
  if (/[:：]\s*$/.test(t) && t.length < 90) {
    return true;
  }
  return false;
}

function esValorInutil(valor: string): boolean {
  const v = String(valor || '').trim();
  if (!v) {
    return true;
  }
  if (esOtraEtiqueta(v)) {
    return true;
  }
  if (/^(pendiente|n\/?a|-|—|x)$/i.test(v)) {
    return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/** Ventana de texto entre una etiqueta y la siguiente etiqueta conocida del formato. */
function ventanaTrasEtiqueta(texto: string, etiquetas: string[]): string {
  for (const et of etiquetas) {
    const re = new RegExp(escapeRe(et) + '\\s*[:：]?', 'i');
    const m = re.exec(texto);
    if (!m || m.index == null) {
      continue;
    }
    const resto = texto.slice(m.index + m[0].length);
    const fin = resto.search(
      /\n?\s*(?:Fecha\s+(?:de\s+la\s+solicitud|en\s+la\s+que)|Tipo\s+de\s+mantenimiento|Responsable\s+quien|Breve\s+descripci[oó]n|Descripci[oó]n\s+del|Evidencia\s+fotogr[aá]fica|Nombre\s+y\s+firma|Nombre\s+del\s+solicitante)/i
    );
    return (fin >= 0 ? resto.slice(0, fin) : resto.slice(0, 400)).trim();
  }
  return '';
}

function primerValorUtil(ventana: string): string | undefined {
  const lineas = String(ventana || '')
    .split(/\n+/)
    .map(l => l.replace(/^[:：\s\-–—]+/, '').trim())
    .filter(Boolean);
  for (const linea of lineas) {
    if (esValorInutil(linea)) {
      continue;
    }
    return linea;
  }
  // A veces todo queda en una sola línea: "etiqueta valor"
  const plano = String(ventana || '').replace(/^[:：\s\-–—]+/, '').trim();
  if (plano && !esValorInutil(plano) && plano.length < 180) {
    return plano;
  }
  return undefined;
}

function fechaEnVentana(ventana: string): string | undefined {
  const re = /\b(\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ventana))) {
    const iso = parsearFechaWord(match[1]);
    if (iso) {
      return iso;
    }
  }
  return undefined;
}

/** Fechas del cuerpo (ignora "Fecha Rev." del encabezado EIN-F-04). */
function fechasCuerpo(texto: string): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  const re = /\b(\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(texto))) {
    const ctx = texto.slice(Math.max(0, match.index - 40), match.index);
    if (/fecha\s*rev|c[oó]digo\s*:|no\.?\s*rev/i.test(ctx)) {
      continue;
    }
    const iso = parsearFechaWord(match[1]);
    if (!iso || vistos.has(iso)) {
      continue;
    }
    vistos.add(iso);
    out.push(iso);
  }
  return out;
}

function extraerResponsable(texto: string): string | undefined {
  const ventana = ventanaTrasEtiqueta(texto, [
    'Responsable quien realizó el mantenimiento',
    'Responsable quien realizo el mantenimiento',
    'Responsable quien realizó',
    'Responsable del mantenimiento'
  ]);
  const lineasVentana = String(ventana || '')
    .split(/\n+/)
    .map(l => l.replace(/^[:：\s\-–—]+/, '').trim())
    .filter(Boolean);
  for (const linea of lineasVentana) {
    if (esValorInutil(linea) || /^\d{1,2}[\/\-.]/.test(linea) || linea.length < 5) {
      continue;
    }
    if (/^(preventivo|correctivo)$/i.test(linea)) {
      continue;
    }
    return linea.replace(/\s+/g, ' ').trim();
  }

  // "Nombre Apellido (Cargo)" típico en estos reportes
  const conCargo = texto.match(
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,3}\s*\([^)]{2,40}\))/
  );
  if (conCargo?.[1] && !/biznaga|sistema|gesti[oó]n|mantenimiento/i.test(conCargo[1])) {
    return conCargo[1].replace(/\s+/g, ' ').trim();
  }

  return undefined;
}

function extraerFechasFormulario(texto: string): { solicitud?: string; realizado?: string } {
  const sol = fechaEnVentana(
    ventanaTrasEtiqueta(texto, [
      'Fecha de la solicitud del mantenimiento',
      'Fecha de la solicitud',
      'Fecha solicitud'
    ])
  );
  const real = fechaEnVentana(
    ventanaTrasEtiqueta(texto, [
      'Fecha en la que se realizó el mantenimiento',
      'Fecha en la que se realizo el mantenimiento',
      'Fecha realizado',
      'Fecha de realización'
    ])
  );

  if (sol && real) {
    return { solicitud: sol, realizado: real };
  }

  // PDF→PPT suele listar etiquetas juntas y las fechas después, en orden.
  const todas = fechasCuerpo(texto);
  return {
    solicitud: sol || todas[0],
    realizado: real || (sol ? todas.find(f => f !== sol) : todas[1]) || todas[1]
  };
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

function limpiarLineasDescripcion(cuerpo: string): string {
  return String(cuerpo || '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !esOtraEtiqueta(l))
    .filter(l => !/^\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}$/.test(l))
    // Evitar que el nombre del responsable quede pegado al final de la descripción
    .filter(l => !/^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,3}\s*\([^)]+\)$/.test(l))
    .join('\n')
    .trim();
}

function extraerDescripcion(texto: string): string | undefined {
  const labelMatch = texto.match(
    /breve\s+descripci[oó]n\s+del\s+mantenimiento\s+realizado|descripci[oó]n\s+del\s+mantenimiento\s+realizado|descripci[oó]n\s+del\s+problema|actividades?\s+realizadas?/i
  );
  if (!labelMatch || labelMatch.index == null) {
    // Si no hay etiqueta, usar el bloque de texto más largo como descripción.
    const lineas = texto.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const candidatas = lineas.filter(l => l.length >= 40 && !esOtraEtiqueta(l));
    if (candidatas.length) {
      return limpiarLineasDescripcion(candidatas.slice(0, 4).join('\n'));
    }
    return undefined;
  }
  const from = labelMatch.index + labelMatch[0].length;
  const resto = texto.slice(from);
  const finMatch = resto.match(
    /\n?\s*evidencia\s+fotogr[aá]fica|\n?\s*nombre\s+y\s+firma|\n?\s*responsable\s+quien|\n?\s*fecha\s+en\s+la\s+que/i
  );
  const hasta = finMatch?.index != null ? finMatch.index : resto.length;
  let cuerpo = resto.slice(0, hasta).trim().replace(/^[:：\s\-–—]+/, '').trim();
  cuerpo = limpiarLineasDescripcion(cuerpo);
  return cuerpo || undefined;
}

function detectarFolio(texto: string): string | undefined {
  const m = texto.match(/\b(EIFF0?2[-_\s]?\d{2,4}[-_]?\d{1,4})\b/i)
    || texto.match(/\bFolio\s*[:：]?\s*([A-Z0-9][-A-Z0-9_/]{4,})\b/i);
  return m ? String(m[1]).replace(/\s+/g, '').toUpperCase() : undefined;
}

/** Detecta MIME real por cabecera; null = no previsualizable en navegador (EMF/WMF/etc.). */
function detectarMimeImagen(bytes: Uint8Array, nombre: string): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  // EMF placeable / WMF: el navegador no puede mostrarlos → imagen “corrupta”
  if (bytes.length >= 4 && bytes[0] === 0x01 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return null;
  }
  if (bytes.length >= 6
    && bytes[0] === 0xd7 && bytes[1] === 0xcd && bytes[2] === 0xc6 && bytes[3] === 0x9a) {
    return null;
  }

  const n = String(nombre || '').toLowerCase();
  if (/\.(emf|wmf|tif|tiff|svg)$/i.test(n)) {
    return null;
  }
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.bmp')) return 'image/bmp';
  if (/\.jpe?g$/i.test(n)) return 'image/jpeg';
  return null;
}

function extensionDesdeMime(mime: string, nombre: string): string {
  const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m && /^(png|jpe?g|gif|webp|bmp)$/i.test(m[1])) {
    return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  }
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
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
  // a:blip / a14:blip / asvg:svgBlip — r:embed o r:link
  const re = /<(?:[a-z0-9]+:)?(?:blip|svgBlip)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slideXml))) {
    const rid = (match[0].match(/\b(?:r:embed|r:link|embed|link)="([^"]+)"/i) || [])[1];
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

  const fechas = extraerFechasFormulario(texto);
  if (fechas.solicitud) {
    result.fechaSolicitud = fechas.solicitud;
    camposAplicados.push('fechaSolicitud');
  }
  if (fechas.realizado) {
    result.fechaRealizado = fechas.realizado;
    camposAplicados.push('fechaRealizado');
  }

  const responsable = extraerResponsable(texto);
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

  const solicitante = primerValorUtil(
    ventanaTrasEtiqueta(texto, [
      'Nombre del solicitante',
      'Solicitante',
      'Reportó',
      'Reporto'
    ])
  );
  if (solicitante && solicitante.length >= 3) {
    result.nombreSolicitante = solicitante;
    camposAplicados.push('solicitante');
  }

  // Quitar de la descripción valores ya capturados como campos (fechas, nombres).
  if (result.descripcionMantenimientoRealizado) {
    const excluir = [
      result.fechaSolicitud,
      result.fechaRealizado,
      result.responsableMantenimiento,
      result.nombreSolicitante,
      result.folioDetectado
    ]
      .filter(Boolean)
      .map(v => normalizar(String(v)));
    const limpia = result.descripcionMantenimientoRealizado
      .split(/\n+/)
      .map(l => l.trim())
      .filter(Boolean)
      .filter(l => {
        const n = normalizar(l);
        if (excluir.some(e => e && (n === e || n.includes(e)))) {
          return false;
        }
        // Fechas crudas tipo 09/09/2026 si ya hay fecha parseada
        if ((result.fechaRealizado || result.fechaSolicitud)
          && /^\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}$/.test(l)) {
          return false;
        }
        return true;
      })
      .join('\n')
      .trim();
    if (limpia) {
      result.descripcionMantenimientoRealizado = limpia;
    } else if (camposAplicados.includes('descripcion') && camposAplicados.length > 1) {
      delete result.descripcionMantenimientoRealizado;
      const idx = camposAplicados.indexOf('descripcion');
      if (idx >= 0) {
        camposAplicados.splice(idx, 1);
      }
    }
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
    const rIds = rIdsImagenEnSlide(slideXml);
    const mediaPaths = (rIds.length
      ? rIds.map(rid => rels.get(rid)).filter((p): p is string => !!p)
      : [...new Set(rels.values())]);
    let imgIdx = 1;
    let omitidasNoRaster = 0;
    for (const mediaPath of mediaPaths) {
      if (!mediaPath) continue;
      const mediaEntry = zip.file(mediaPath);
      if (!mediaEntry) continue;
      const base = mediaPath.split('/').pop() || `slide-${slideNum}-${imgIdx}.bin`;
      const buffer = await mediaEntry.async('arraybuffer');
      const bytes = new Uint8Array(buffer);
      const mime = detectarMimeImagen(bytes, base);
      if (!mime) {
        omitidasNoRaster += 1;
        continue;
      }
      // Plantilla EIN-F-04: el logo Biznaga suele ser la 1.ª imagen; no es evidencia.
      if (imagenes.length === 0 && mediaPaths.length > 2 && bytes.byteLength < 120_000) {
        const esLogoProbable = /logo|biznaga|header|membrete/i.test(base) || bytes.byteLength < 45_000;
        if (esLogoProbable) {
          continue;
        }
      }
      const ext = extensionDesdeMime(mime, base);
      const file = new File(
        [buffer],
        `pptx-s${slideNum}-ev-${imgIdx}.${ext}`,
        { type: mime }
      );
      imagenes.push(file);
      imagenPreviews.push(URL.createObjectURL(new Blob([buffer], { type: mime })));
      imgIdx += 1;
    }
    if (omitidasNoRaster && !imagenes.length) {
      parsed.avisos.push(
        'La diapositiva trae imágenes en formato no previsualizable (p. ej. EMF/WMF). Exporte la evidencia como PNG/JPG en PowerPoint.'
      );
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
