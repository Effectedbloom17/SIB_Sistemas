import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AvisoPopupArea,
  AvisoPopupItem,
  AVISO_AREA_META,
  AvisosPopupService
} from 'src/app/services/avisos-popup.service';
import { biznaguitaAsset, onBiznaguitaAssetError } from 'src/app/utils/biznaguita-assets';

type TabKey = 'todas' | AvisoPopupArea;

@Component({
  selector: 'app-biznaguita-gestor-avisos',
  templateUrl: './biznaguita-gestor-avisos.component.html',
  styleUrls: ['./biznaguita-gestor-avisos.component.scss']
})
export class BiznaguitaGestorAvisosComponent implements OnInit, OnDestroy {
  abierto = false;
  /** Clic en la mascota o en un apartado: no se cierra al quitar el cursor. */
  fijado = false;
  tabActiva: TabKey = 'todas';
  items: AvisoPopupItem[] = [];
  itemsFiltrados: AvisoPopupItem[] = [];
  tabsVisibles: Array<{ key: TabKey; label: string; color: string; count: number }> = [];
  readonly areaMeta = AVISO_AREA_META;
  readonly imgEstadoInicial = biznaguitaAsset('biznaguita_estado_inicial.png');
  readonly imgEstadoFinal = biznaguitaAsset('biznaguita_estado_final.png');
  gestionItem: AvisoPopupItem | null = null;
  gestionTexto = '';
  gestionError = '';
  gestionGuardando = false;
  gestionTick = 0;

  private destroy$ = new Subject<void>();
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private avisos: AvisosPopupService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    const sync = () => {
      this.items = this.sinDuplicados(this.avisos.todos);
      if (this.tabActiva !== 'todas' && this.conteoArea(this.tabActiva) === 0) {
        this.tabActiva = 'todas';
      }
      this.actualizarVista();
    };
    this.avisos.firma$.pipe(takeUntil(this.destroy$)).subscribe(sync);
    this.avisos.resolutivo$.pipe(takeUntil(this.destroy$)).subscribe(sync);
    this.avisos.cambio$.pipe(takeUntil(this.destroy$)).subscribe(sync);
    sync();
  }

  ngOnDestroy(): void {
    this.limpiarCierre();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get total(): number {
    return this.items.length;
  }

  abrirPorCursor(): void {
    this.limpiarCierre();
    if (!this.abierto) {
      this.tabActiva = 'todas';
    }
    this.abierto = true;
    this.actualizarVista();
  }

  salirPorCursor(): void {
    if (this.fijado || this.gestionItem) return;
    this.limpiarCierre();
    this.closeTimer = setTimeout(() => {
      if (!this.fijado && !this.gestionItem) this.abierto = false;
      this.closeTimer = null;
    }, 450);
  }

  fijar(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.limpiarCierre();
    this.fijado = true;
    if (!this.abierto) this.tabActiva = 'todas';
    this.abierto = true;
    this.actualizarVista();
  }

  seleccionarTab(key: TabKey, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.limpiarCierre();
    this.fijado = true;
    this.abierto = true;
    this.tabActiva = key;
    this.actualizarVista();
  }

  abrirItem(item: AvisoPopupItem, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (item.area === 'pc') {
      this.limpiarCierre();
      this.fijado = true;
      this.gestionItem = item;
      this.gestionTexto = '';
      this.gestionError = '';
      this.gestionGuardando = false;
      this.gestionTick += 1;
      return;
    }
    this.avisos.ir(item);
  }

  cerrarGestion(): void {
    if (this.gestionGuardando) return;
    this.gestionItem = null;
    this.gestionTexto = '';
    this.gestionError = '';
  }

  guardarGestion(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const item = this.gestionItem;
    const acciones = this.gestionTexto.trim();
    if (!item || this.gestionGuardando) return;
    if (!acciones) {
      this.gestionError = 'Escribe las acciones realizadas';
      return;
    }
    this.gestionGuardando = true;
    this.gestionError = '';
    this.avisos.registrarGestionPc(item, acciones).subscribe({
      next: () => {
        this.avisos.quitarResolutivoGestionado(Number(item.resolutivoId));
        this.gestionGuardando = false;
        this.gestionItem = null;
        this.gestionTexto = '';
      },
      error: (err) => {
        this.gestionGuardando = false;
        this.gestionError = err?.error?.message || 'No se pudo guardar la gestión';
      }
    });
  }

  @HostListener('document:click', ['$event'])
  cerrarSiClicFuera(event: MouseEvent): void {
    if (this.gestionItem) return;
    if (!this.abierto || !this.fijado) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.fijado = false;
    this.abierto = false;
  }

  colorArea(area: AvisoPopupArea): string {
    return this.areaMeta[area]?.color || '#64748b';
  }

  labelArea(area: AvisoPopupArea): string {
    return this.areaMeta[area]?.titulo || area;
  }

  onErrorImg(event: Event, fileName: string): void {
    onBiznaguitaAssetError(event, fileName);
  }

  /** Arrow: Angular llama trackBy sin `this` del componente. */
  trackByItem = (_i: number, item: AvisoPopupItem): string => {
    return BiznaguitaGestorAvisosComponent.claveDeAviso(item);
  };

  trackByTabKey = (_i: number, tab: { key: TabKey }): string => tab.key;

  private actualizarVista(): void {
    this.itemsFiltrados = this.tabActiva === 'todas'
      ? [...this.items]
      : this.items.filter((i) => i.area === this.tabActiva);

    const tabs: Array<{ key: TabKey; label: string; color: string; count: number }> = [
      { key: 'todas', label: 'Todas', color: '#334155', count: this.total }
    ];
    (['sgc', 'pc', 'proyectos'] as AvisoPopupArea[]).forEach((area) => {
      const count = this.conteoArea(area);
      if (count > 0) {
        tabs.push({
          key: area,
          label: this.areaMeta[area].titulo,
          color: this.areaMeta[area].color,
          count
        });
      }
    });
    this.tabsVisibles = tabs;
  }

  private conteoArea(area: AvisoPopupArea): number {
    return this.items.filter((i) => i.area === area).length;
  }

  private limpiarCierre(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /** Un aviso por trámite: el popup puede salir más de una vez, el gestor no los clona. */
  private sinDuplicados(lista: AvisoPopupItem[]): AvisoPopupItem[] {
    const elegidos = new Map<string, AvisoPopupItem>();
    for (const item of lista || []) {
      const clave = BiznaguitaGestorAvisosComponent.claveDeAviso(item);
      const previo = elegidos.get(clave);
      if (!previo || this.prioridad(item) < this.prioridad(previo) || (
        this.prioridad(item) === this.prioridad(previo) && item.id > previo.id
      )) {
        elegidos.set(clave, item);
      }
    }
    return [...elegidos.values()];
  }

  private static claveDeAviso(item: AvisoPopupItem): string {
    if (!item) return 'x';
    if (item.area === 'pc' && item.resolutivoId) return `pc-${item.resolutivoId}`;
    if (item.area === 'sgc' && item.solicitudId) return `sgc-${item.solicitudId}`;
    if (item.area === 'proyectos' && item.cambioId) return `proy-${item.cambioId}`;
    return `${item.area}-${item.id}`;
  }

  private prioridad(item: AvisoPopupItem): number {
    const tipo = String(item.tipo || '');
    if (item.area === 'pc') {
      if (tipo === 'urgente_ingreso') return 0;
      if (tipo === 'urgente_seguimiento') return 1;
      return 2;
    }
    if (item.area === 'sgc') {
      if (tipo === 'solicitud') return 0;
      if (tipo === 'rechazada') return 1;
      return 2;
    }
    if (tipo === 'recordatorio_urgente') return 0;
    if (tipo === 'revision') return 1;
    if (tipo === 'recordatorio') return 2;
    return 3;
  }
}
