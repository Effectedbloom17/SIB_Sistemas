import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AvisoPopupArea,
  AvisoPopupItem,
  AVISO_AREA_META,
  AvisosPopupService
} from 'src/app/services/avisos-popup.service';

type TabKey = 'todas' | AvisoPopupArea;

@Component({
  selector: 'app-biznaguita-gestor-avisos',
  templateUrl: './biznaguita-gestor-avisos.component.html',
  styleUrls: ['./biznaguita-gestor-avisos.component.scss']
})
export class BiznaguitaGestorAvisosComponent implements OnInit, OnDestroy {
  abierto = false;
  tabActiva: TabKey = 'todas';
  items: AvisoPopupItem[] = [];
  itemsFiltrados: AvisoPopupItem[] = [];
  tabsVisibles: Array<{ key: TabKey; label: string; color: string; count: number }> = [];
  readonly areaMeta = AVISO_AREA_META;

  private destroy$ = new Subject<void>();

  constructor(
    private avisos: AvisosPopupService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    const sync = () => {
      this.items = this.avisos.todos;
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
    this.destroy$.next();
    this.destroy$.complete();
  }

  get total(): number {
    return this.items.length;
  }

  toggle(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.abrirYDejar(false);
  }

  abrirPorCursor(): void {
    this.abrirYDejar(false);
  }

  seleccionarTab(key: TabKey, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.abierto = true;
    this.tabActiva = key;
    this.actualizarVista();
  }

  abrirItem(item: AvisoPopupItem, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.avisos.abrir(item);
    this.actualizarVista();
    this.abierto = false;
  }

  @HostListener('document:click', ['$event'])
  cerrarSiClicFuera(event: MouseEvent): void {
    if (!this.abierto) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.abierto = false;
  }

  colorArea(area: AvisoPopupArea): string {
    return this.areaMeta[area]?.color || '#64748b';
  }

  labelArea(area: AvisoPopupArea): string {
    return this.areaMeta[area]?.titulo || area;
  }

  trackByItem(_i: number, item: AvisoPopupItem): string {
    return `${item.area}-${item.id}`;
  }

  trackByTabKey(_i: number, tab: { key: TabKey }): string {
    return tab.key;
  }

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

  private abrirYDejar(resetTab: boolean): void {
    if (!this.abierto || resetTab) {
      this.tabActiva = 'todas';
    }
    this.abierto = true;
    this.actualizarVista();
  }

  private conteoArea(area: AvisoPopupArea): number {
    return this.items.filter((i) => i.area === area).length;
  }
}
