import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {
  private sidebarVisible = new BehaviorSubject<boolean>(true);
  public sidebarVisible$ = this.sidebarVisible.asObservable();
  private wasMobile: boolean;

  constructor() {
    this.wasMobile = window.innerWidth < 768;
    // Detectar tamaño de pantalla inicial
    this.checkScreenSize();
    // Escuchar cambios de tamaño de pantalla
    window.addEventListener('resize', () => this.onResize());
  }

  getSidebarState(): boolean {
    return this.sidebarVisible.value;
  }

  toggleSidebar() {
    this.sidebarVisible.next(!this.sidebarVisible.value);
  }

  showSidebar() {
    this.sidebarVisible.next(true);
  }

  hideSidebar() {
    this.sidebarVisible.next(false);
  }

  isSidebarVisible(): boolean {
    return this.sidebarVisible.value;
  }

  /**
   * Solo cambia el sidebar automaticamente cuando se cruza el breakpoint (768px),
   * no en cada resize. Esto evita que el scroll en movil (que cambia el viewport
   * al ocultar/mostrar la barra del navegador) fuerce reabrir el sidebar.
   */
  private onResize() {
    const isMobile = window.innerWidth < 768;
    if (isMobile !== this.wasMobile) {
      this.wasMobile = isMobile;
      this.sidebarVisible.next(!isMobile);
    }
  }

  private checkScreenSize() {
    if (window.innerWidth < 768) {
      this.sidebarVisible.next(false);
    } else {
      this.sidebarVisible.next(true);
    }
  }
}
