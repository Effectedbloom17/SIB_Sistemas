import { Injectable } from '@angular/core';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

// El worker se copia a assets desde angular.json para funcionar también en producción.
GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';

@Injectable({ providedIn: 'root' })
export class PdfThumbnailService {
  async renderizarPrimeraPagina(archivo: Blob, anchoMaximo = 720): Promise<Blob> {
    const data = await archivo.arrayBuffer();

    let pdf;
    try {
      pdf = await getDocument({ data }).promise;
    } catch {
      // Fallback si el worker no carga (404 / CSP / path)
      pdf = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableWorker: true } as any).promise;
    }

    try {
      const pagina = await pdf.getPage(1);
      const viewportBase = pagina.getViewport({ scale: 1 });
      const escala = Math.min(2, anchoMaximo / Math.max(viewportBase.width, 1));
      const viewport = pagina.getViewport({ scale: Math.max(escala, 0.75) });
      const canvas = document.createElement('canvas');
      const contexto = canvas.getContext('2d', { alpha: false });

      if (!contexto) {
        throw new Error('No se pudo preparar el lienzo para la miniatura.');
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, canvas.width, canvas.height);

      await pagina.render({ canvasContext: contexto, viewport }).promise;

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error('No se pudo generar la miniatura.'))),
          'image/jpeg',
          0.86
        );
      });
    } finally {
      await pdf.destroy();
    }
  }
}
