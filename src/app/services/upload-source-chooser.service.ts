import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';

export type UploadSourceChoice = 'galeria' | 'pegar';

export interface UploadSourceChooserOptions {
  titulo?: string;
  subtitulo?: string;
  /** Texto del botón de archivos/galería. */
  etiquetaGaleria?: string;
  /** Texto del botón de pegar. */
  etiquetaPegar?: string;
}

/**
 * Cuadro intermedio: ¿Galería/archivos o pegar desde el portapapeles?
 * Se usa antes de abrir el selector de archivos en apartados de subida.
 */
@Injectable({ providedIn: 'root' })
export class UploadSourceChooserService {
  private estilosInyectados = false;

  async elegir(opciones: UploadSourceChooserOptions = {}): Promise<UploadSourceChoice | null> {
    this.asegurarEstilos();

    const titulo = opciones.titulo || '¿Cómo quieres agregar el archivo?';
    const subtitulo = opciones.subtitulo
      || 'Puedes elegirlo desde tu equipo o pegarlo si ya lo copiaste.';
    const etiquetaGaleria = opciones.etiquetaGaleria || 'Desde mi galería o archivos';
    const etiquetaPegar = opciones.etiquetaPegar || 'Pegar imagen o archivo';

    return new Promise<UploadSourceChoice | null>((resolve) => {
      let resuelto = false;
      const terminar = (valor: UploadSourceChoice | null) => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        Swal.close();
        resolve(valor);
      };

      void Swal.fire({
        title: titulo,
        html: `
          <p class="usc-sub">${this.escapar(subtitulo)}</p>
          <div class="usc-grid" role="group" aria-label="Origen del archivo">
            <button type="button" class="usc-card" data-origen="galeria">
              <span class="usc-card__icon usc-card__icon--galeria" aria-hidden="true">
                <i class="fas fa-images"></i>
              </span>
              <strong class="usc-card__title">${this.escapar(etiquetaGaleria)}</strong>
              <span class="usc-card__hint">Abre el explorador para elegir archivos</span>
            </button>
            <button type="button" class="usc-card" data-origen="pegar">
              <span class="usc-card__icon usc-card__icon--pegar" aria-hidden="true">
                <i class="fas fa-paste"></i>
              </span>
              <strong class="usc-card__title">${this.escapar(etiquetaPegar)}</strong>
              <span class="usc-card__hint">Usa Ctrl+V con lo que tengas copiado</span>
            </button>
          </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        reverseButtons: true,
        focusCancel: false,
        allowOutsideClick: true,
        buttonsStyling: false,
        customClass: {
          popup: 'usc-popup',
          title: 'usc-title',
          htmlContainer: 'usc-html',
          cancelButton: 'usc-cancel',
          actions: 'usc-actions'
        },
        didOpen: (popup) => {
          popup.querySelectorAll<HTMLButtonElement>('[data-origen]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const origen = btn.getAttribute('data-origen');
              if (origen === 'galeria' || origen === 'pegar') {
                terminar(origen);
              }
            });
          });
        }
      }).then((result) => {
        if (!resuelto) {
          resuelto = true;
          resolve(result.isConfirmed ? null : null);
        }
      });
    });
  }

  /**
   * Muestra un cuadro esperando Ctrl+V y resuelve con los archivos pegados.
   * Cancelar / cerrar → null.
   */
  async esperarPegado(opciones: { titulo?: string; subtitulo?: string } = {}): Promise<File[] | null> {
    this.asegurarEstilos();
    const titulo = opciones.titulo || 'Pega el archivo';
    const subtitulo = opciones.subtitulo
      || 'Copia una imagen o archivo y pégalo con Ctrl+V.';

    return new Promise<File[] | null>((resolve) => {
      let resuelto = false;
      const terminar = (files: File[] | null) => {
        if (resuelto) {
          return;
        }
        resuelto = true;
        document.removeEventListener('paste', onPaste, true);
        Swal.close();
        resolve(files);
      };

      const onPaste = (event: ClipboardEvent) => {
        const files = this.extraerArchivosClipboard(event);
        if (!files.length) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        terminar(files);
      };

      document.addEventListener('paste', onPaste, true);

      void Swal.fire({
        title: titulo,
        html: `
          <p class="usc-sub">${this.escapar(subtitulo)}</p>
          <div class="usc-paste-wait" tabindex="0">
            <span class="usc-card__icon usc-card__icon--pegar" aria-hidden="true">
              <i class="fas fa-paste"></i>
            </span>
            <strong>Esperando pegado…</strong>
            <span class="usc-card__hint">Ctrl+V · imagen o archivo del portapapeles</span>
          </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        allowOutsideClick: true,
        buttonsStyling: false,
        customClass: {
          popup: 'usc-popup',
          title: 'usc-title',
          htmlContainer: 'usc-html',
          cancelButton: 'usc-cancel',
          actions: 'usc-actions'
        },
        didOpen: (popup) => {
          const zona = popup.querySelector('.usc-paste-wait') as HTMLElement | null;
          zona?.focus();
        },
        willClose: () => {
          document.removeEventListener('paste', onPaste, true);
        }
      }).then((result) => {
        if (!resuelto) {
          resuelto = true;
          document.removeEventListener('paste', onPaste, true);
          resolve(result.isConfirmed ? [] : null);
        }
      });
    });
  }

  private extraerArchivosClipboard(event: ClipboardEvent): File[] {
    const clip = event.clipboardData;
    if (!clip) {
      return [];
    }
    const out: File[] = [];
    const seen = new Set<string>();
    const push = (file: File | null | undefined) => {
      if (!file || file.size < 0) {
        return;
      }
      const key = `${file.size}|${String(file.type || '').toLowerCase()}|${String(file.name || '').toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const nombre = String(file.name || '').trim().toLowerCase();
      const esClipboard = !nombre || nombre === 'blob' || nombre.startsWith('image.');
      if (!esClipboard) {
        out.push(file);
        return;
      }
      const mime = String(file.type || 'application/octet-stream');
      const ext = mime.includes('png') ? 'png'
        : mime.includes('webp') ? 'webp'
          : mime.includes('pdf') ? 'pdf'
            : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
              : 'bin';
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      out.push(new File([file], `pegado-${stamp}.${ext}`, {
        type: mime,
        lastModified: file.lastModified || Date.now()
      }));
    };

    if (clip.files?.length) {
      Array.from(clip.files).forEach((f) => push(f));
    } else if (clip.items?.length) {
      for (let i = 0; i < clip.items.length; i++) {
        const item = clip.items[i];
        if (item?.kind === 'file') {
          push(item.getAsFile());
        }
      }
    }
    return out;
  }

  private escapar(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private asegurarEstilos(): void {
    if (this.estilosInyectados || typeof document === 'undefined') {
      return;
    }
    if (document.getElementById('usc-chooser-styles')) {
      this.estilosInyectados = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'usc-chooser-styles';
    style.textContent = `
      .usc-popup {
        border-radius: 16px !important;
        padding: 1.35rem 1.35rem 1.1rem !important;
        max-width: 440px !important;
        width: calc(100% - 1.5rem) !important;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18) !important;
      }
      .usc-title {
        font-size: 1.15rem !important;
        font-weight: 700 !important;
        color: #18181b !important;
        padding: 0 !important;
        margin: 0 0 0.35rem !important;
      }
      .usc-html {
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      .usc-sub {
        margin: 0 0 1rem;
        font-size: 0.88rem;
        line-height: 1.45;
        color: #71717a;
      }
      .usc-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.65rem;
      }
      .usc-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.2rem;
        width: 100%;
        text-align: left;
        border: 1.5px solid rgba(39, 39, 42, 0.14);
        border-radius: 12px;
        background: #fafafa;
        padding: 0.95rem 1rem 0.95rem 0.95rem;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s, transform 0.15s;
      }
      .usc-card:hover,
      .usc-card:focus-visible {
        border-color: #38512F;
        background: #f3f7f0;
        outline: none;
        transform: translateY(-1px);
      }
      .usc-card__icon {
        width: 2.4rem;
        height: 2.4rem;
        border-radius: 999px;
        display: grid;
        place-items: center;
        margin-bottom: 0.35rem;
        font-size: 1rem;
      }
      .usc-card__icon--galeria {
        background: rgba(56, 81, 47, 0.12);
        color: #38512F;
      }
      .usc-card__icon--pegar {
        background: rgba(14, 116, 144, 0.12);
        color: #0e7490;
      }
      .usc-card__title {
        font-size: 0.92rem;
        font-weight: 700;
        color: #18181b;
      }
      .usc-card__hint {
        font-size: 0.78rem;
        color: #71717a;
        line-height: 1.35;
      }
      .usc-actions {
        margin-top: 0.85rem !important;
      }
      .usc-cancel {
        border: 0 !important;
        background: transparent !important;
        color: #71717a !important;
        font-weight: 600 !important;
        font-size: 0.88rem !important;
        padding: 0.45rem 0.75rem !important;
        border-radius: 8px !important;
        box-shadow: none !important;
      }
      .usc-cancel:hover {
        background: rgba(39, 39, 42, 0.06) !important;
        color: #3f3f46 !important;
      }
      .usc-paste-wait {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 1.15rem 1rem;
        border: 2px dashed rgba(14, 116, 144, 0.4);
        border-radius: 12px;
        background: rgba(14, 116, 144, 0.06);
        text-align: center;
        outline: none;
      }
      .usc-paste-wait:focus,
      .usc-paste-wait:focus-visible {
        border-color: #0e7490;
        box-shadow: 0 0 0 3px rgba(14, 116, 144, 0.16);
      }
      .usc-paste-wait strong {
        font-size: 0.92rem;
        color: #18181b;
      }
      @media (min-width: 480px) {
        .usc-grid {
          grid-template-columns: 1fr 1fr;
        }
        .usc-popup {
          max-width: 520px !important;
        }
      }
    `;
    document.head.appendChild(style);
    this.estilosInyectados = true;
  }
}
