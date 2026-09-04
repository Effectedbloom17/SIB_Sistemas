import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';

interface PdfPaginaVista {
  num: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-pdf-canvas-viewer',
  templateUrl: './pdf-canvas-viewer.component.html',
  styleUrls: ['./pdf-canvas-viewer.component.scss']
})
export class PdfCanvasViewerComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() blob: Blob | null = null;
  @Input() preparando = false;
  @Input() progresoServidor = 0;
  @Input() etiquetaServidor = 'Preparando vista previa…';
  @Input() lento = false;
  @Input() tema: 'oscuro' | 'claro' | 'oliva' | 'naranja' = 'oscuro';
  @Output() listo = new EventEmitter<void>();
  @Output() fallo = new EventEmitter<string>();

  @ViewChild('scrollHost') scrollHost?: ElementRef<HTMLElement>;

  paginas: PdfPaginaVista[] = [];
  paginaActual = 1;
  totalPaginas = 0;
  zoom = 1;
  rotacion = 0;
  operandoVista = false;
  renderizando = false;
  progresoRender = 0;
  etiquetaRender = 'Renderizando páginas…';
  errorInterno: string | null = null;

  private pdf: PDFDocumentProxy | null = null;
  private seq = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private canvasesPendientes: HTMLCanvasElement[] | null = null;
  private anchoRenderizado = 0;

  constructor(private cdr: ChangeDetectorRef) {}

  get mostrandoCarga(): boolean {
    return !this.errorInterno && (this.preparando || this.renderizando || (!!this.blob && this.paginas.length === 0));
  }

  get progresoVisible(): number {
    if (this.renderizando || (this.blob && this.paginas.length === 0)) {
      return Math.max(this.progresoServidor, this.progresoRender, 96);
    }
    return Math.max(4, Math.min(100, this.progresoServidor));
  }

  get etiquetaVisible(): string {
    if (this.renderizando || (this.blob && this.paginas.length === 0 && !this.errorInterno)) {
      return this.etiquetaRender || 'Renderizando páginas…';
    }
    return this.etiquetaServidor || 'Preparando vista previa…';
  }

  get zoomPct(): number {
    return Math.round(this.zoom * 100);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['blob']) {
      void this.cargarDesdeBlob();
    }
  }

  ngAfterViewInit(): void {
    if (this.canvasesPendientes?.length) {
      this.pintarCanvases(this.canvasesPendientes);
      this.canvasesPendientes = null;
      this.cdr.detectChanges();
      return;
    }
    if (this.blob && this.pdf && this.paginas.length) {
      const real = this.anchoContenedor();
      if (this.anchoRenderizado && Math.abs(real - this.anchoRenderizado) > 48) {
        void this.renderizarPaginas(this.seq);
      }
    }
  }

  ngOnDestroy(): void {
    this.seq += 1;
    this.limpiarCanvases();
    this.paginas = [];
    this.canvasesPendientes = null;
    if (this.pdf) {
      void this.pdf.destroy();
      this.pdf = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.blob || !this.pdf) {
      return;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      const real = this.anchoContenedor();
      if (this.anchoRenderizado && Math.abs(real - this.anchoRenderizado) < 24) {
        return;
      }
      void this.renderizarPaginas(this.seq);
    }, 180);
  }

  async zoomIn(): Promise<void> {
    this.zoom = Math.min(2.4, Math.round((this.zoom + 0.15) * 100) / 100);
    await this.renderizarPaginas(this.seq);
  }

  async zoomOut(): Promise<void> {
    this.zoom = Math.max(0.55, Math.round((this.zoom - 0.15) * 100) / 100);
    await this.renderizarPaginas(this.seq);
  }

  async rotarIzquierda(): Promise<void> {
    if (this.operandoVista || !this.pdf) {
      return;
    }
    this.operandoVista = true;
    this.rotacion = (this.rotacion + 270) % 360;
    await this.renderizarPaginas(this.seq);
    this.operandoVista = false;
  }

  async rotarDerecha(): Promise<void> {
    if (this.operandoVista || !this.pdf) {
      return;
    }
    this.operandoVista = true;
    this.rotacion = (this.rotacion + 90) % 360;
    await this.renderizarPaginas(this.seq);
    this.operandoVista = false;
  }

  onScroll(): void {
    const host = this.scrollHost?.nativeElement;
    if (!host || !this.paginas.length) {
      return;
    }
    const hojas = Array.from(host.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    const medio = host.scrollTop + host.clientHeight * 0.35;
    let actual = 1;
    for (const hoja of hojas) {
      const top = hoja.offsetTop;
      const bottom = top + hoja.offsetHeight;
      if (medio >= top && medio <= bottom) {
        actual = Number(hoja.dataset['pdfPage'] || '1');
        break;
      }
    }
    this.paginaActual = actual;
  }

  private async cargarDesdeBlob(): Promise<void> {
    const seq = ++this.seq;
    this.limpiarCanvases();
    this.paginas = [];
    this.canvasesPendientes = null;
    this.errorInterno = null;
    this.paginaActual = 1;
    this.totalPaginas = 0;
    this.rotacion = 0;
    this.progresoRender = 90;
    this.etiquetaRender = 'Abriendo documento…';

    if (this.pdf) {
      await this.pdf.destroy();
      this.pdf = null;
    }

    if (!this.blob) {
      this.renderizando = false;
      return;
    }

    this.renderizando = true;
    try {
      if (seq !== this.seq) {
        return;
      }

      const abrirPdf = async (sinWorker: boolean): Promise<PDFDocumentProxy> => {
        const data = new Uint8Array(await this.blob!.arrayBuffer());
        if (sinWorker) {
          return getDocument({
            data,
            useWorkerFetch: false,
            isEvalSupported: false,
            disableWorker: true
          } as any).promise;
        }
        const task = getDocument({ data });
        task.onProgress = (p: { loaded: number; total: number }) => {
          if (seq !== this.seq || !p?.total) {
            return;
          }
          this.progresoRender = Math.min(98, 90 + Math.round((p.loaded / p.total) * 8));
          this.etiquetaRender = 'Leyendo el PDF…';
        };
        return task.promise;
      };

      let pdf: PDFDocumentProxy;
      try {
        pdf = await abrirPdf(false);
      } catch {
        pdf = await abrirPdf(true);
      }

      if (seq !== this.seq) {
        await pdf.destroy();
        return;
      }

      this.pdf = pdf;
      this.totalPaginas = pdf.numPages;
      await this.renderizarPaginas(seq);
    } catch (err: any) {
      if (seq !== this.seq) {
        return;
      }
      this.renderizando = false;
      this.errorInterno = err?.message || 'No se pudo mostrar el PDF en este dispositivo.';
      this.fallo.emit(this.errorInterno);
    }
  }

  private async renderizarPaginas(seq: number): Promise<void> {
    if (!this.pdf || seq !== this.seq) {
      return;
    }
    this.renderizando = this.paginas.length === 0;
    this.etiquetaRender = 'Renderizando páginas…';

    const hostWidth = this.anchoContenedor();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nuevas: PdfPaginaVista[] = [];
    const canvases: HTMLCanvasElement[] = [];
    const maxPx = 4096;

    try {
      for (let n = 1; n <= this.pdf.numPages; n++) {
        if (seq !== this.seq) {
          return;
        }
        this.progresoRender = Math.min(99, 92 + Math.round((n / this.pdf.numPages) * 7));
        this.etiquetaRender = `Renderizando página ${n} de ${this.pdf.numPages}…`;
        this.cdr.detectChanges();

        const page = await this.pdf.getPage(n);
        const base = page.getViewport({ scale: 1, rotation: this.rotacion });
        const cssWidth = Math.max(280, hostWidth * this.zoom);
        let scale = (cssWidth / Math.max(base.width, 1)) * dpr;
        let viewport = page.getViewport({ scale: Math.max(scale, 0.5), rotation: this.rotacion });
        if (viewport.width > maxPx || viewport.height > maxPx) {
          scale *= Math.min(maxPx / viewport.width, maxPx / viewport.height);
          viewport = page.getViewport({ scale: Math.max(scale, 0.35) });
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
        if (!ctx) {
          throw new Error('No se pudo preparar el visor.');
        }
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const cssW = Math.ceil(viewport.width / dpr);
        const cssH = Math.ceil(viewport.height / dpr);
        canvas.className = 'pdf-cv__page';
        canvas.setAttribute('data-pdf-page', String(n));
        canvas.style.width = '100%';
        canvas.style.maxWidth = `${cssW}px`;
        canvas.style.height = 'auto';
        canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;

        canvases.push(canvas);
        nuevas.push({ num: n, width: cssW, height: cssH });
      }

      if (seq !== this.seq) {
        return;
      }

      this.anchoRenderizado = hostWidth;
      this.paginas = nuevas;
      this.totalPaginas = nuevas.length;
      this.renderizando = false;
      this.progresoRender = 100;
      if (this.scrollHost?.nativeElement) {
        this.pintarCanvases(canvases);
      } else {
        this.canvasesPendientes = canvases;
      }
      this.cdr.detectChanges();
      this.listo.emit();
    } catch (err: any) {
      if (seq !== this.seq) {
        return;
      }
      this.renderizando = false;
      this.errorInterno = err?.message || 'No se pudieron dibujar las páginas del PDF.';
      this.fallo.emit(this.errorInterno);
    }
  }

  private pintarCanvases(canvases: HTMLCanvasElement[]): void {
    const host = this.scrollHost?.nativeElement;
    if (!host) {
      this.canvasesPendientes = canvases;
      return;
    }
    this.vaciarHost(host);
    for (const canvas of canvases) {
      host.appendChild(canvas);
    }
  }

  private limpiarCanvases(): void {
    const host = this.scrollHost?.nativeElement;
    if (host) {
      this.vaciarHost(host);
    }
  }

  private vaciarHost(host: HTMLElement): void {
    while (host.firstChild) {
      host.removeChild(host.firstChild);
    }
  }

  private anchoContenedor(): number {
    const host = this.scrollHost?.nativeElement;
    const w = host?.clientWidth || host?.parentElement?.clientWidth || 0;
    if (w >= 160) {
      return Math.max(280, w - 28);
    }
    const vista = typeof window !== 'undefined' ? Math.min(window.innerWidth, 720) : 360;
    return Math.max(280, vista - 48);
  }
}
