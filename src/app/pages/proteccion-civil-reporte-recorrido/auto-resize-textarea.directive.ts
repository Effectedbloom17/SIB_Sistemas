import { AfterViewInit, Directive, ElementRef, HostListener, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';

/** Textarea que crece hacia abajo con el contenido (sin scroll vertical). */
@Directive({
  selector: 'textarea[appAutoResize]'
})
export class AutoResizeTextareaDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() appAutoResizeRefresh = 0;

  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly el: ElementRef<HTMLTextAreaElement>) {}

  ngAfterViewInit(): void {
    this.bindResizeObserver();
    this.scheduleResize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appAutoResizeRefresh'] && !changes['appAutoResizeRefresh'].firstChange) {
      this.scheduleResize();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  @HostListener('input')
  onInput(): void {
    this.resize();
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
    setTimeout(() => this.resize());
  }

  private resize(): void {
    const ta = this.el.nativeElement;
    if (!ta) {
      return;
    }
    ta.style.overflow = 'hidden';
    ta.style.overflowY = 'hidden';
    ta.style.resize = 'none';
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }
}
