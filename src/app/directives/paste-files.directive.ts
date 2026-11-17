import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';

/**
 * Permite pegar archivos/imágenes del portapapeles en zonas de carga.
 *
 * Uso básico (emite File[]):
 *   <div appPasteFiles (filesPasted)="subir($event)"></div>
 *
 * Con filtro y foco:
 *   <div appPasteFiles tabindex="0" pasteAccept="image/*" (filesPasted)="…">
 *
 * Inyecta en el input[type=file] hijo y dispara change (labels de adjunto):
 *   <label appPasteFiles [pasteDispatchInput]="true">
 *     <input type="file" accept="image/*" (change)="…">
 *   </label>
 *
 * Escucha Ctrl+V a nivel documento mientras el host esté en el DOM
 * (útil en paneles/modales de evidencias):
 *   <div appPasteFiles [pasteListenDocument]="true" (filesPasted)="…">
 */
@Directive({
  selector: '[appPasteFiles]'
})
export class PasteFilesDirective implements OnInit, OnDestroy {
  /** Filtro estilo input accept: "image/*", ".pdf,image/png", etc. Vacío = cualquier archivo. */
  @Input() pasteAccept = '';
  /** Si es false, no procesa pegados. */
  @Input() pasteEnabled = true;
  /**
   * Si true, busca un input[type=file] dentro del host, le asigna los archivos
   * y dispara el evento change (reutiliza handlers existentes).
   */
  @Input() pasteDispatchInput = false;
  /**
   * Si true, también escucha paste en document (mientras el host exista).
   * No intercepta cuando el foco está en otro input/textarea ajeno al host
   * y el portapapeles solo trae texto.
   */
  @Input() pasteListenDocument = false;

  @Output() filesPasted = new EventEmitter<File[]>();

  private documentListener: ((event: ClipboardEvent) => void) | null = null;
  /** Evita procesar el mismo ClipboardEvent dos veces (host + document). */
  private readonly eventosProcesados = new WeakSet<ClipboardEvent>();

  constructor(private readonly el: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    if (!this.pasteListenDocument || typeof document === 'undefined') {
      return;
    }
    this.documentListener = (event: ClipboardEvent) => this.onPaste(event, true);
    document.addEventListener('paste', this.documentListener, true);
  }

  ngOnDestroy(): void {
    if (this.documentListener) {
      document.removeEventListener('paste', this.documentListener, true);
      this.documentListener = null;
    }
  }

  @HostListener('paste', ['$event'])
  onHostPaste(event: ClipboardEvent): void {
    // Si ya escuchamos en document, el host no debe volver a procesar el mismo pegado.
    if (this.pasteListenDocument) {
      return;
    }
    this.onPaste(event, false);
  }

  private onPaste(event: ClipboardEvent, fromDocument: boolean): void {
    if (!this.pasteEnabled) {
      return;
    }
    if (this.eventosProcesados.has(event)) {
      return;
    }

    const host = this.el.nativeElement;
    if (!host?.isConnected) {
      return;
    }

    if (fromDocument) {
      const filesProbe = this.extraerArchivos(event, false);
      if (!filesProbe.length) {
        return;
      }
    }

    const archivos = this.extraerArchivos(event, true);
    if (!archivos.length) {
      return;
    }

    if (this.pasteDispatchInput) {
      const input = host.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (input && !input.disabled) {
        const aceptados = this.filtrarPorAccept(archivos, input.accept || this.pasteAccept);
        if (!aceptados.length) {
          return;
        }
        this.eventosProcesados.add(event);
        event.preventDefault();
        event.stopPropagation();
        const dt = new DataTransfer();
        const lote = input.multiple ? aceptados : aceptados.slice(0, 1);
        for (const file of lote) {
          dt.items.add(file);
        }
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }

    this.eventosProcesados.add(event);
    event.preventDefault();
    event.stopPropagation();
    this.filesPasted.emit(archivos);
  }

  private extraerArchivos(event: ClipboardEvent, aplicarFiltro: boolean): File[] {
    const out: File[] = [];
    const seen = new Set<string>();
    const clip = event.clipboardData;
    if (!clip) {
      return out;
    }

    const push = (file: File | null | undefined) => {
      if (!file || file.size < 0) {
        return;
      }
      // Deduplicar por contenido aparente ANTES de renombrar:
      // clipboard.files e items suelen exponer el mismo blob con lastModified distinto.
      const key = `${file.size}|${String(file.type || '').toLowerCase()}|${String(file.name || '').toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      out.push(this.asegurarNombre(file));
    };

    // Preferir files[]; items solo como respaldo (evita el doble pegado en Chromium).
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

    // Fallback: data-URL dentro de HTML pegado (copiar imagen en algunos sitios)
    if (!out.length) {
      const html = clip.getData?.('text/html') || '';
      if (html) {
        const dataUrl = this.extraerDataUrlDeHtml(html);
        if (dataUrl) {
          push(this.dataUrlAFile(dataUrl));
        }
      }
    }

    return aplicarFiltro ? this.filtrarPorAccept(out, this.pasteAccept) : out;
  }

  private filtrarPorAccept(files: File[], accept: string): File[] {
    const raw = String(accept || '').trim();
    if (!raw) {
      return files;
    }
    const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) {
      return files;
    }
    return files.filter((file) => this.coincideAccept(file, tokens));
  }

  private coincideAccept(file: File, tokens: string[]): boolean {
    const mime = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const ext = name.includes('.') ? `.${name.split('.').pop()}` : '';

    return tokens.some((token) => {
      if (token === '*/*') {
        return true;
      }
      if (token.endsWith('/*')) {
        const prefix = token.slice(0, -1); // "image/"
        return mime.startsWith(prefix);
      }
      if (token.startsWith('.')) {
        return ext === token || name.endsWith(token);
      }
      return mime === token;
    });
  }

  private asegurarNombre(file: File): File {
    const nombre = String(file.name || '').trim().toLowerCase();
    const esNombreClipboard =
      !nombre
      || nombre === 'blob'
      || nombre === 'image.png'
      || nombre === 'image.jpg'
      || nombre === 'image.jpeg'
      || nombre === 'image.webp';
    if (!esNombreClipboard) {
      return file;
    }
    const mime = String(file.type || 'application/octet-stream');
    const ext = this.extensionDeMime(mime);
    const stamp = this.stampNombre();
    return new File([file], `pegado-${stamp}.${ext}`, {
      type: mime,
      lastModified: file.lastModified || Date.now()
    });
  }

  private extensionDeMime(mime: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf'
    };
    if (map[mime]) {
      return map[mime];
    }
    if (mime.startsWith('image/')) {
      return mime.slice(6).split('+')[0] || 'png';
    }
    return 'bin';
  }

  private stampNombre(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  private extraerDataUrlDeHtml(html: string): string | null {
    const match = html.match(/<img[^>]+src=["'](data:image\/[a-zA-Z0-9+.-]+;base64,[^"']+)["']/i);
    return match?.[1] || null;
  }

  private dataUrlAFile(dataUrl: string): File | null {
    try {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      if (!m) {
        return null;
      }
      const mime = m[1];
      const b64 = m[2];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const ext = this.extensionDeMime(mime);
      return new File([bytes], `pegado-${this.stampNombre()}.${ext}`, { type: mime });
    } catch {
      return null;
    }
  }
}
