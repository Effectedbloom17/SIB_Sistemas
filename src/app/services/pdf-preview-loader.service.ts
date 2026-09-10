import { Injectable } from '@angular/core';
import { HttpEvent, HttpEventType } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PdfPreviewLoadState {
  pct: number;
  etiqueta: string;
  lento: boolean;
  blob?: Blob;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class PdfPreviewLoaderService {
  observar(
    request$: Observable<HttpEvent<Blob>>,
    etiquetaEspera = 'Convirtiendo el documento a PDF…'
  ): Observable<PdfPreviewLoadState> {
    return new Observable(subscriber => {
      const started = Date.now();
      let lastPct = 4;
      let blobEmitido = false;
      let terminado = false;

      const emitirEspera = () => {
        if (terminado || blobEmitido) {
          return;
        }
        const s = (Date.now() - started) / 1000;
        let pct = 8;
        let etiqueta = 'Solicitando documento…';
        let lento = false;
        if (s < 3) {
          pct = 8 + (s / 3) * 12;
          etiqueta = 'Solicitando documento…';
        } else if (s < 12) {
          pct = 20 + ((s - 3) / 9) * 28;
          etiqueta = etiquetaEspera;
        } else if (s < 28) {
          pct = 48 + ((s - 12) / 16) * 22;
          etiqueta = 'Sigue preparando la vista previa…';
        } else {
          pct = Math.min(86, 70 + (s - 28) * 0.35);
          etiqueta = 'Esto está tardando más de lo habitual. Sigue en curso…';
          lento = true;
        }
        lastPct = Math.max(lastPct, Math.round(pct));
        subscriber.next({ pct: lastPct, etiqueta, lento });
      };

      emitirEspera();
      const interval = setInterval(emitirEspera, 250);

      const timeout = setTimeout(() => {
        if (terminado || blobEmitido) {
          return;
        }
        terminado = true;
        clearInterval(interval);
        subscriber.next({
          pct: lastPct,
          etiqueta: 'La preparación se detuvo',
          lento: true,
          error: 'La vista previa tardó demasiado. Cierra e intenta de nuevo.'
        });
        subscriber.complete();
      }, 90000);

      const sub = request$.subscribe({
        next: (event: HttpEvent<Blob>) => {
          if (event.type === HttpEventType.DownloadProgress) {
            const total = event.total || 0;
            if (total > 0) {
              const httpPct = 70 + Math.round((event.loaded / total) * 24);
              lastPct = Math.max(lastPct, Math.min(94, httpPct));
              subscriber.next({
                pct: lastPct,
                etiqueta: 'Descargando documento…',
                lento: false
              });
            }
          }
          if (event.type === HttpEventType.Response) {
            blobEmitido = true;
            clearInterval(interval);
            clearTimeout(timeout);
            const body = event.body;
            this.validarPdf(body)
              .then(validado => {
                lastPct = Math.max(lastPct, 96);
                subscriber.next({
                  pct: lastPct,
                  etiqueta: 'Preparando páginas…',
                  lento: false,
                  blob: validado
                });
                subscriber.complete();
              })
              .catch((err: any) => {
                subscriber.next({
                  pct: lastPct,
                  etiqueta: 'No se pudo preparar',
                  lento: false,
                  error: err?.message || 'No se pudo generar la vista previa.'
                });
                subscriber.complete();
              });
          }
        },
        error: (err) => {
          terminado = true;
          clearInterval(interval);
          clearTimeout(timeout);
          this.mensajeError(err).then(msg => {
            subscriber.next({
              pct: lastPct,
              etiqueta: 'Error',
              lento: false,
              error: msg
            });
            subscriber.complete();
          });
        }
      });

      return () => {
        terminado = true;
        clearInterval(interval);
        clearTimeout(timeout);
        sub.unsubscribe();
      };
    });
  }

  private async validarPdf(blob: Blob | null): Promise<Blob> {
    if (!blob || blob.size === 0) {
      throw new Error('La vista previa está vacía.');
    }
    if (blob.type && blob.type.includes('application/json')) {
      throw new Error(await this.extraerMensajeJson(blob, 'No se pudo generar la vista previa.'));
    }
    const cabeza = await blob.slice(0, 8).text();
    const recorte = cabeza.trimStart();
    if (recorte.startsWith('{') || recorte.startsWith('<')) {
      throw new Error(await this.extraerMensajeJson(blob, 'No se pudo generar la vista previa.'));
    }
    if (!cabeza.startsWith('%PDF')) {
      throw new Error('La respuesta del servidor no es un PDF válido.');
    }
    return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  }

  private async extraerMensajeJson(blob: Blob, fallback: string): Promise<string> {
    try {
      const parsed = JSON.parse(await blob.text());
      return parsed?.message || parsed?.error || fallback;
    } catch {
      return fallback;
    }
  }

  private async mensajeError(err: any): Promise<string> {
    if (err?.error instanceof Blob) {
      return this.extraerMensajeJson(err.error, err?.message || 'No se pudo preparar la vista previa.');
    }
    if (typeof err?.error === 'string') {
      try {
        return JSON.parse(err.error)?.message || err.error;
      } catch {
        return err.error;
      }
    }
    return err?.error?.message || err?.message || 'No se pudo preparar la vista previa.';
  }
}
