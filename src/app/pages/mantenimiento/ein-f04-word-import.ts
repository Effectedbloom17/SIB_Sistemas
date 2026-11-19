/**
 * Importación de Word (.docx) EIN-F-04 → campos del reporte en sistema.
 * Extrae texto e imágenes del documento llenado (plantilla oficial o copia en Drive).
 */
import JSZip from 'jszip';
import { EinF04TipoMantenimiento } from './ein-f02-solicitud.catalog';

export interface EinF04WordImportResult {
  tipoMantenimiento?: EinF04TipoMantenimiento;
  fechaSolicitud?: string;
  fechaRealizado?: string;
  responsableMantenimiento?: string;
  descripcionMantenimientoRealizado?: string;
  nombreSolicitante?: string;
  folioDetectado?: string;
  imagenes: File[];
  camposAplicados: string[];
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

/** Une runs de Word en texto plano, respetando saltos de párrafo. */
export function textoPlanoDesdeDocumentXml(xml: string): string {
  if (!xml) {
    return '';
  }
  const conSaltos = xml
    .replace(/<w:tab\b[^/]*\/>/gi, '\t')
    .replace(/<w:br\b[^/]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n');
  const sinTags = conSaltos.replace(/<[^>]+>/g, '');
  return decodeXmlEntities(sinTags)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Convierte fechas frecuentes del Word a YYYY-MM-DD. */
export function parsearFechaWord(raw: string): string | undefined {
  const s = String(raw || '').trim();
  if (!s || /^pendiente$/i.test(s) || /^n\/?a$/i.test(s) || s === '-' || s === '—') {
    return undefined;
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let anio = Number(m[3]);
    if (anio < 100) {
      anio += anio >= 70 ? 1900 : 2000;
    }
    const d = Number(m[1]);
    const mes = Number(m[2]);
    // Preferir día/mes/año (México). Si mes > 12, invertir.
    if (mes >= 1 && mes <= 12 && d >= 1 && d <= 31) {
      return `${anio}-${pad2(mes)}-${pad2(d)}`;
    }
    if (d >= 1 && d <= 12 && mes >= 1 && mes <= 31) {
      return `${anio}-${pad2(d)}-${pad2(mes)}`;
    }
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m) {
    const anio = 2000 + Number(m[3]);
    return `${anio}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  }

  return undefined;
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
      // "Etiqueta: valor" en la misma línea
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
      return norm.slice(0, 400);
    }
    return norm.slice(i, i + 220);
  })();

  const marcado = (opcion: string): boolean => {
    const re = new RegExp(
      `(?:[☒☑xX✓✔]|\\[[xX]\\]|\\(\\s*[xX]\\s*\\))\\s*${opcion}|${opcion}\\s*(?:[☒☑xX✓✔]|\\[[xX]\\])`,
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
    // Ambos marcados: preferir el que aparece con marca más cerca del label
    const iPrev = bloque.search(/preventivo/);
    const iCorr = bloque.search(/correctivo/);
    return iCorr >= 0 && (iPrev < 0 || iCorr < iPrev) ? 'Correctivo' : 'Preventivo';
  }
  return undefined;
}

function extraerDescripcion(texto: string): string | undefined {
  const labelMatch = texto.match(
    /breve\s+descripci[oó]n\s+del\s+mantenimiento\s+realizado|descripci[oó]n\s+del\s+mantenimiento\s+realizado/i
  );
  if (!labelMatch || labelMatch.index == null) {
    return undefined;
  }

  const from = labelMatch.index + labelMatch[0].length;
  const resto = texto.slice(from);
  const finMatch = resto.match(
    /\n?\s*evidencia\s+fotogr[aá]fica|\n?\s*nombre\s+y\s+firma/i
  );
  const hasta = finMatch?.index != null ? finMatch.index : resto.length;

  let cuerpo = resto.slice(0, hasta).trim();
  cuerpo = cuerpo.replace(/^[:：\s\-–—]+/, '').trim();
  return cuerpo || undefined;
}

function detectarFolio(texto: string): string | undefined {
  const m = texto.match(/\b(EIFF0?2[-_\s]?\d{2,4}[-_]?\d{1,4})\b/i)
    || texto.match(/\bFolio\s*[:：]?\s*([A-Z0-9][-A-Z0-9_/]{4,})\b/i);
  return m ? String(m[1]).replace(/\s+/g, '').toUpperCase() : undefined;
}

function extensionDesdeNombre(nombre: string, mimeFallback: string): string {
  const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (m) {
    return m[1];
  }
  if (mimeFallback.includes('png')) {
    return 'png';
  }
  if (mimeFallback.includes('webp')) {
    return 'webp';
  }
  return 'jpg';
}

function mimeDesdeNombre(nombre: string): string {
  const n = String(nombre || '').toLowerCase();
  if (n.endsWith('.png')) {
    return 'image/png';
  }
  if (n.endsWith('.webp')) {
    return 'image/webp';
  }
  if (n.endsWith('.gif')) {
    return 'image/gif';
  }
  if (n.endsWith('.bmp')) {
    return 'image/bmp';
  }
  return 'image/jpeg';
}

function mediaPathDesdeTarget(target: string): string | null {
  const t = String(target || '').replace(/\\/g, '/').trim();
  if (!t) {
    return null;
  }
  // Targets típicos: "media/image1.png" o "../media/image1.png"
  const m = t.match(/(?:^|\/)(media\/[^?#]+)$/i);
  if (!m) {
    return null;
  }
  return `word/${m[1]}`.replace(/\/+/g, '/');
}

async function leerMapaRels(zip: JSZip, relsPath: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const entry = zip.file(relsPath);
  if (!entry) {
    return mapa;
  }
  const xml = await entry.async('string');
  const re = /<Relationship\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const tag = match[0];
    const id = (tag.match(/\bId="([^"]+)"/i) || [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/i) || [])[1];
    const type = (tag.match(/\bType="([^"]+)"/i) || [])[1] || '';
    if (!id || !target) {
      continue;
    }
    if (type && !/\/image$/i.test(type) && !/media\//i.test(target)) {
      continue;
    }
    const mediaPath = mediaPathDesdeTarget(target);
    if (mediaPath) {
      mapa.set(id, mediaPath);
    }
  }
  return mapa;
}

/** Medios referenciados desde encabezado/pie (logo, membrete) — no son evidencias. */
async function mediasDeEncabezadoPie(zip: JSZip): Promise<Set<string>> {
  const excluir = new Set<string>();
  const relsPaths = Object.keys(zip.files).filter(p =>
    /^word\/_rels\/(header|footer)\d*\.xml\.rels$/i.test(p)
  );
  for (const relsPath of relsPaths) {
    const mapa = await leerMapaRels(zip, relsPath);
    mapa.forEach(path => excluir.add(path.toLowerCase()));
  }
  return excluir;
}

/**
 * Arma texto plano del XML y un mapa índice-plano → índice-xml
 * (soporta etiquetas partidas en varios <w:t>).
 */
function textoConMapaXml(documentXml: string): { plain: string; mapa: number[] } {
  const plainParts: string[] = [];
  const mapa: number[] = [];
  const re = /<[^>]+>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml))) {
    if (!m[1]) {
      continue;
    }
    const chunk = decodeXmlEntities(m[1]);
    const xmlIndex = m.index;
    for (let i = 0; i < chunk.length; i++) {
      plainParts.push(chunk[i]);
      mapa.push(xmlIndex);
    }
  }
  return { plain: plainParts.join(''), mapa };
}

/**
 * Índice XML a partir del cual inicia «Evidencia fotográfica».
 * Si no aparece, usa «Breve descripción…» como piso (todo lo anterior = logo/membrete).
 */
function indiceInicioEvidenciasEnXml(documentXml: string): number {
  const { plain, mapa } = textoConMapaXml(documentXml);

  const buscar = (re: RegExp): number => {
    const m = plain.match(re);
    if (!m || m.index == null) {
      return -1;
    }
    return mapa[m.index] ?? -1;
  };

  // Buscar sobre el texto original (sin quitar acentos) para no desalinear el mapa.
  const ev = buscar(/evidencia\s+fotogr[aá]fica/i);
  if (ev >= 0) {
    return ev;
  }
  const desc = buscar(/breve\s+descripci[oó]n\s+del\s+mantenimiento\s+realizado/i);
  if (desc >= 0) {
    return desc;
  }
  return -1;
}

interface ImagenDocxRef {
  mediaPath: string;
  indexEnXml: number;
}

/** Imágenes embebidas del cuerpo, en orden de aparición. */
function referenciasImagenesDocumento(
  documentXml: string,
  rels: Map<string, string>
): ImagenDocxRef[] {
  const refs: ImagenDocxRef[] = [];
  const vistos = new Set<string>();
  // a:blip r:embed / r:link — drawing ML; también v:imagedata r:id (VML legado)
  const re = /<(?:a:blip|asvg:blip|v:imagedata)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(documentXml))) {
    const tag = match[0];
    const rid = (tag.match(/\b(?:r:embed|r:id|r:link)="([^"]+)"/i) || [])[1];
    if (!rid) {
      continue;
    }
    const mediaPath = rels.get(rid);
    if (!mediaPath) {
      continue;
    }
    const key = mediaPath.toLowerCase();
    if (vistos.has(key)) {
      continue;
    }
    vistos.add(key);
    refs.push({ mediaPath, indexEnXml: match.index });
  }
  return refs;
}

async function extraerImagenesDocx(
  zip: JSZip,
  prefijoNombre: string,
  documentXml: string
): Promise<File[]> {
  const excluirHeader = await mediasDeEncabezadoPie(zip);
  const docRels = await leerMapaRels(zip, 'word/_rels/document.xml.rels');
  const refs = referenciasImagenesDocumento(documentXml, docRels);
  const inicioEvidencias = indiceInicioEvidenciasEnXml(documentXml);

  // Nunca importar logo/membrete de encabezado o pie.
  let candidatas = refs.filter(r => !excluirHeader.has(r.mediaPath.toLowerCase()));

  if (inicioEvidencias >= 0) {
    // Solo fotos de la sección «Evidencia fotográfica» (el logo del formato va antes).
    candidatas = candidatas.filter(r => r.indexEnXml >= inicioEvidencias);
  } else if (candidatas.length > 1) {
    // Sin ancla de sección: omitir la primera (casi siempre el logo Biznaga).
    candidatas = candidatas.slice(1);
  } else {
    // Una sola imagen y sin sección de evidencias → asumir logo, no importar.
    candidatas = [];
  }

  const out: File[] = [];
  let idx = 1;
  for (const ref of candidatas) {
    const entry = zip.file(ref.mediaPath);
    if (!entry) {
      continue;
    }
    const base = ref.mediaPath.split('/').pop() || `evidencia-${idx}`;
    const mime = mimeDesdeNombre(base);
    if (!/^image\/(jpeg|png|webp|jpg)/i.test(mime) && !/\.(jpe?g|png|webp)$/i.test(base)) {
      continue;
    }
    const blob = await entry.async('blob');
    const tipo = mimeDesdeNombre(base);
    const ext = extensionDesdeNombre(base, tipo);
    const nombre = `${prefijoNombre}-evidencia-${idx}.${ext}`;
    out.push(new File([blob], nombre, { type: tipo === 'image/jpg' ? 'image/jpeg' : tipo }));
    idx += 1;
  }
  return out;
}

/**
 * Lee un .docx EIN-F-04 (o similar) y devuelve campos + imágenes embebidas.
 */
export async function importarEinF04DesdeDocx(archivo: File): Promise<EinF04WordImportResult> {
  const avisos: string[] = [];
  const camposAplicados: string[] = [];
  const nombre = String(archivo?.name || '').toLowerCase();

  if (!archivo) {
    throw new Error('No se seleccionó ningún archivo.');
  }
  if (nombre.endsWith('.doc') && !nombre.endsWith('.docx')) {
    throw new Error('El formato .doc antiguo no es compatible. Guarda el archivo como .docx e inténtalo de nuevo.');
  }
  if (!nombre.endsWith('.docx')
    && archivo.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    throw new Error('Selecciona un archivo Word (.docx).');
  }

  const zip = await JSZip.loadAsync(archivo);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('El archivo no parece un Word válido (falta document.xml).');
  }

  const xml = await docEntry.async('string');
  const texto = textoPlanoDesdeDocumentXml(xml);
  if (!texto.trim()) {
    avisos.push('El documento no tiene texto legible.');
  }

  const result: EinF04WordImportResult = {
    imagenes: [],
    camposAplicados,
    avisos
  };

  const tipo = detectarTipo(texto);
  if (tipo) {
    result.tipoMantenimiento = tipo;
    camposAplicados.push('tipo');
  } else {
    avisos.push('No se detectó el tipo de mantenimiento (Preventivo/Correctivo).');
  }

  const fechaSolRaw = valorTrasEtiqueta(texto, [
    'Fecha de la solicitud del mantenimiento',
    'Fecha de la solicitud'
  ]);
  const fechaSol = parsearFechaWord(fechaSolRaw || '');
  if (fechaSol) {
    result.fechaSolicitud = fechaSol;
    camposAplicados.push('fechaSolicitud');
  } else if (fechaSolRaw) {
    avisos.push(`Fecha de solicitud no reconocida: «${fechaSolRaw}».`);
  }

  const fechaRealRaw = valorTrasEtiqueta(texto, [
    'Fecha en la que se realizó el mantenimiento',
    'Fecha en la que se realizo el mantenimiento',
    'Fecha en la que se realizó'
  ]);
  const fechaReal = parsearFechaWord(fechaRealRaw || '');
  if (fechaReal) {
    result.fechaRealizado = fechaReal;
    camposAplicados.push('fechaRealizado');
  } else if (fechaRealRaw) {
    avisos.push(`Fecha realizada no reconocida: «${fechaRealRaw}».`);
  }

  const responsable = valorTrasEtiqueta(texto, [
    'Responsable quien realizó el mantenimiento',
    'Responsable quien realizo el mantenimiento',
    'Responsable quien realizó'
  ]);
  if (responsable && !/^pendiente$/i.test(responsable)) {
    result.responsableMantenimiento = responsable;
    camposAplicados.push('responsable');
  }

  const descripcion = extraerDescripcion(texto);
  if (descripcion) {
    result.descripcionMantenimientoRealizado = descripcion;
    camposAplicados.push('descripcion');
  } else {
    avisos.push('No se encontró la descripción del mantenimiento realizado.');
  }

  const folio = detectarFolio(texto);
  if (folio) {
    result.folioDetectado = folio;
  }

  try {
    result.imagenes = await extraerImagenesDocx(zip, folio || 'ein-f04', xml);
    if (result.imagenes.length) {
      camposAplicados.push(`imagenes(${result.imagenes.length})`);
    }
  } catch {
    avisos.push('No se pudieron extraer las imágenes del Word.');
  }

  if (!camposAplicados.length) {
    throw new Error(
      'No se pudo leer información útil del Word. Verifica que sea el formato EIN-F-04 llenado.'
    );
  }

  return result;
}
