import { Directive, ElementRef, OnDestroy, OnInit } from '@angular/core';

/**
 * En el teléfono, el primer toque solo muestra el nombre del botón compacto.
 * El segundo toque ejecuta la acción. En escritorio no interviene: el nombre
 * sigue saliendo al pasar el cursor.
 */
@Directive({
  selector: 'button.sgc-btn-pdf-icon'
})
export class SgcBtnRevelarDirective implements OnInit, OnDestroy {
  private revelado = false;

  private readonly alClick = (event: Event) => {
    const boton = event.currentTarget as HTMLButtonElement;
    if (!this.esTelefono() || boton.disabled) return;
    if (this.revelado) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.revelado = true;
    boton.classList.add('is-revealed');
  };

  private readonly alClickFuera = (event: Event) => {
    if (!this.revelado) return;
    const destino = event.target as Node | null;
    if (destino && this.el.nativeElement.contains(destino)) return;
    this.cerrar();
  };

  constructor(private el: ElementRef<HTMLButtonElement>) {}

  ngOnInit(): void {
    this.el.nativeElement.addEventListener('click', this.alClick, true);
    document.addEventListener('click', this.alClickFuera, true);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('click', this.alClick, true);
    document.removeEventListener('click', this.alClickFuera, true);
  }

  private esTelefono(): boolean {
    return window.matchMedia('(max-width: 767.98px)').matches;
  }

  private cerrar(): void {
    this.revelado = false;
    this.el.nativeElement.classList.remove('is-revealed');
  }
}
