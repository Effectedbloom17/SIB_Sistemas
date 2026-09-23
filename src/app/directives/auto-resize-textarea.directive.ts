import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges
} from '@angular/core';

/**
 * Textarea que crece hacia abajo con el contenido (sin scroll vertical).
 *
 * Uso: `<textarea appAutoResize [(ngModel)]="..."></textarea>`
 * Tras cargar datos externos: `[appAutoResizeRefresh]="tick"` e incrementar tick.
 */
@Directive({
  selector: 'textarea[appAutoResize]'
})
export class AutoResizeTextareaDirective implements AfterViewInit, OnChanges, OnDestroy {
  /** Incrementar tras cargar/pegar contenido programáticamente. */
  @Input() appAutoResizeRefresh = 0;
  /** Altura mínima en px (opcional). */
  @Input() appAutoResizeMinHeight = 0;

  private resizeObserver: ResizeObserver | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly el: ElementRef<HTMLTextAreaElement>) {}

  ngAfterViewInit(): void {
    this.bindResizeObserver();
    this.scheduleResize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      (changes['appAutoResizeRefresh'] && !changes['appAutoResizeRefresh'].firstChange)
      || (changes['appAutoResizeMinHeight'] && !changes['appAutoResizeMinHeight'].firstChange)
    ) {
      this.scheduleResize();
    }
  }

  ngOnDestroy(): void {
    if (this.pending != null) {
      clearTimeout(this.pending);
    }
    this.resizeObserver?.disconnect();
  }

  @HostListener('input')
  onInput(): void {
    this.resize();
  }

  @HostListener('change')
  onChange(): void {
    this.scheduleResize();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleResize();
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(this.el.nativeElement);
  }

  private scheduleResize(): void {
    if (this.pending != null) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(() => {
      this.pending = null;
      this.resize();
    });
  }

  private resize(): void {
    const ta = this.el.nativeElement;
    if (!ta) {
      return;
    }
    ta.style.overflow = 'hidden';
    ta.style.overflowY = 'hidden';
    ta.style.resize = 'none';
    ta.style.maxHeight = 'none';
    ta.style.height = 'auto';
    const minH = Number(this.appAutoResizeMinHeight) || 0;
    const next = Math.max(ta.scrollHeight, minH);
    ta.style.height = `${next}px`;
  }
}
