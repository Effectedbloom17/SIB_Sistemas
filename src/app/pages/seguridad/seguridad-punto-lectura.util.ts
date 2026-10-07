/** HTML de lectura de un punto (referencias e imágenes), mismo criterio que Asignación. */

export interface ImagenPuntoLite {
  id: number;
  ruta: string;
  nombre: string;
}

export interface PuntoLecturaInput {
  punto_norma: string;
  descripcion: string;
  descripcion_html?: string | null;
  imagenes: ImagenPuntoLite[];
}

function escaparHtml(texto: string): string {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializarSeguro(raiz: Node, escapar: (t: string) => string): string {
  let out = '';
  raiz.childNodes.forEach((nodo) => {
    if (nodo.nodeType === Node.TEXT_NODE) {
      out += escapar(nodo.textContent || '');
      return;
    }
    if (!(nodo instanceof HTMLElement)) return;
    const tag = nodo.tagName;
    if (tag === 'BR') {
      out += '<br>';
      return;
    }
    if (tag === 'IMG' && nodo.classList.contains('pto-inline')) {
      const src = nodo.getAttribute('src') || '';
      if (!src) return;
      out += `<img class="pto-inline" src="${escapar(src)}" alt="${escapar(nodo.getAttribute('alt') || '')}">`;
      return;
    }
    const mapa: Record<string, string> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u' };
    if (mapa[tag]) {
      out += `<${mapa[tag]}>${serializarSeguro(nodo, escapar)}</${mapa[tag]}>`;
      return;
    }
    if ((tag === 'P' || tag === 'DIV') && out && !out.endsWith('<br>')) out += '<br>';
    out += serializarSeguro(nodo, escapar);
  });
  return out.replace(/(^|<br>)(\s*)([a-zA-Z]\))/g, '$1$2<strong>$3</strong>');
}

function nodoImagen(
  doc: Document,
  punto: PuntoLecturaInput,
  img: ImagenPuntoLite,
  urlArchivo: (ruta: string | null | undefined) => string | null
): HTMLImageElement {
  const el = doc.createElement('img');
  el.className = 'pto-inline';
  el.src = urlArchivo(img.ruta) || '';
  el.alt = img.nombre || punto.punto_norma || 'Imagen del punto';
  return el;
}

function tomarImagen(
  punto: PuntoLecturaInput,
  usadas: Set<number>,
  nombre: string | null,
  src: string | null
): ImagenPuntoLite | null {
  const limpio = (nombre || '').trim().toLowerCase();
  const ruta = (src || '').trim();
  const hallada = punto.imagenes.find((img) => {
    if (usadas.has(img.id)) return false;
    if (limpio && img.nombre.trim().toLowerCase() === limpio) return true;
    return !!ruta && (img.ruta === ruta || img.ruta.endsWith(ruta) || ruta.endsWith(img.ruta));
  }) || punto.imagenes.find((img) => !usadas.has(img.id) && !nombre && !src);
  if (!hallada) return null;
  usadas.add(hallada.id);
  return hallada;
}

function buscarTexto(raiz: Node, token: string): Text | null {
  const pila = Array.from(raiz.childNodes);
  const q = token.toLowerCase();
  while (pila.length) {
    const nodo = pila.shift();
    if (!nodo) continue;
    if (nodo.nodeType === Node.TEXT_NODE && (nodo.textContent || '').toLowerCase().includes(q)) {
      return nodo as Text;
    }
    pila.unshift(...Array.from(nodo.childNodes));
  }
  return null;
}

function incrustarMenciones(
  doc: Document,
  punto: PuntoLecturaInput,
  usadas: Set<number>,
  urlArchivo: (ruta: string | null | undefined) => string | null
): void {
  for (const img of punto.imagenes) {
    if (usadas.has(img.id)) continue;
    const token = img.nombre.replace(/\.[^.]+$/, '').trim();
    if (token.length < 3) continue;
    const nodo = buscarTexto(doc.body, token);
    if (!nodo?.textContent) continue;
    const idx = nodo.textContent.toLowerCase().indexOf(token.toLowerCase());
    if (idx < 0) continue;
    const padre = nodo.parentNode;
    if (!padre) continue;
    const frag = doc.createDocumentFragment();
    const antes = nodo.textContent.slice(0, idx);
    const despues = nodo.textContent.slice(idx + token.length);
    if (antes) frag.appendChild(doc.createTextNode(antes));
    frag.appendChild(nodoImagen(doc, punto, img, urlArchivo));
    if (despues) frag.appendChild(doc.createTextNode(despues));
    padre.replaceChild(frag, nodo);
    usadas.add(img.id);
  }
}

export function construirHtmlPuntoLectura(
  punto: PuntoLecturaInput,
  urlArchivo: (ruta: string | null | undefined) => string | null
): { html: string; sobrantes: ImagenPuntoLite[] } {
  const usadas = new Set<number>();
  const origen = punto.descripcion_html
    || escaparHtml(punto.descripcion || 'Sin descripción').replace(/\n/g, '<br>');
  const doc = new DOMParser().parseFromString(origen, 'text/html');
  doc.body.querySelectorAll('span.seg-ref').forEach((span) => {
    const img = tomarImagen(
      punto,
      usadas,
      span.getAttribute('data-nombre'),
      span.getAttribute('data-src')
    );
    span.replaceWith(img ? nodoImagen(doc, punto, img, urlArchivo) : doc.createTextNode(''));
  });
  incrustarMenciones(doc, punto, usadas, urlArchivo);
  return {
    html: serializarSeguro(doc.body, escaparHtml),
    sobrantes: punto.imagenes.filter((img) => !usadas.has(img.id))
  };
}
