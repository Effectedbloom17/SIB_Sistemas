/**
 * Imprime un Blob sin abrir pestaña nueva: iframe oculto en la misma página
 * y diálogo nativo del navegador sobre el sistema.
 */
export function lanzarImpresionEnSistema(blob: Blob, esImagen = false): void {
  const url = URL.createObjectURL(blob);
  let impresionLanzada = false;
  let limpiado = false;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Impresión');
  iframe.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;z-index:-1;';

  const limpiar = (): void => {
    if (limpiado) {
      return;
    }
    limpiado = true;
    setTimeout(() => {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
      URL.revokeObjectURL(url);
    }, 1500);
  };

  const lanzar = (): void => {
    if (impresionLanzada) {
      return;
    }
    impresionLanzada = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // El diálogo nativo puede fallar en algunos entornos.
    }
    setTimeout(limpiar, 800);
  };

  document.body.appendChild(iframe);

  if (esImagen) {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      URL.revokeObjectURL(url);
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Imprimir</title>
  <style>
    @page { margin: 10mm; }
    html, body { margin: 0; padding: 0; background: #fff; min-height: 100%; }
    body { display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100vh; object-fit: contain; display: block; }
  </style>
</head>
<body>
  <img src="${url}" alt="Documento">
</body>
</html>`);
    doc.close();
    const img = doc.querySelector('img');
    if (img && !img.complete) {
      img.onload = () => setTimeout(lanzar, 200);
      img.onerror = () => setTimeout(lanzar, 200);
    } else {
      setTimeout(lanzar, 300);
    }
    setTimeout(lanzar, 2500);
    return;
  }

  iframe.onload = () => setTimeout(lanzar, 400);
  iframe.src = url;
  setTimeout(lanzar, 2500);
}

/** True si mime/nombre parecen imagen. */
export function esMimeImagen(mimeType?: string | null, nombreArchivo?: string | null): boolean {
  const m = String(mimeType || '').toLowerCase();
  const n = String(nombreArchivo || '').toLowerCase();
  return m.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i.test(n);
}

/** True si mime/nombre parecen PDF. */
export function esMimePdf(mimeType?: string | null, nombreArchivo?: string | null): boolean {
  const m = String(mimeType || '').toLowerCase();
  const n = String(nombreArchivo || '').toLowerCase();
  return m.includes('pdf') || /\.pdf(\?|$)/i.test(n);
}
