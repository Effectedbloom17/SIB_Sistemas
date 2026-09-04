import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  CapituloFormatoConfig,
  PlantillaFormato,
  SGC_CAPITULOS_CATALOG,
  SGC_CAPITULOS_ORDEN
} from './sgc-formatos.catalog';
import { FormatoBusquedaItem, TarjetaCapituloSgc } from './sgc-formato.types';
import { SgcListaMaestraVigenciaService } from './sgc-lista-maestra-vigencia.service';

export const SGC_CAPITULO_VISUAL: Record<number, {
  iconClass: string;
  colorInicio: string;
  colorFin: string;
  descripcion: string;
}> = {
  4: {
    iconClass: 'fas fa-sitemap',
    colorInicio: '#0f766e',
    colorFin: '#14b8a6',
    descripcion: 'Comprensión de la organización, partes interesadas, alcance y procesos.'
  },
  5: {
    iconClass: 'fas fa-user-tie',
    colorInicio: '#6d28d9',
    colorFin: '#a78bfa',
    descripcion: 'Compromiso de la dirección, política de calidad y roles organizacionales.'
  },
  6: {
    iconClass: 'fas fa-calendar-check',
    colorInicio: '#1d4ed8',
    colorFin: '#60a5fa',
    descripcion: 'Acciones para abordar riesgos, oportunidades y objetivos de calidad.'
  },
  7: {
    iconClass: 'fas fa-hands-helping',
    colorInicio: '#15803d',
    colorFin: '#4ade80',
    descripcion: 'Recursos, competencia, comunicación, información documentada y soporte.'
  },
  8: {
    iconClass: 'fas fa-cogs',
    colorInicio: '#c2410c',
    colorFin: '#fb923c',
    descripcion: 'Planificación y control operacional, diseño y provisión de productos y servicios.'
  },
  9: {
    iconClass: 'fas fa-chart-line',
    colorInicio: '#b45309',
    colorFin: '#fbbf24',
    descripcion: 'Seguimiento, medición, análisis, evaluación, auditoría interna y revisión.'
  },
  10: {
    iconClass: 'fas fa-sync-alt',
    colorInicio: '#be123c',
    colorFin: '#fb7185',
    descripcion: 'No conformidad, acciones correctivas y mejora continua del SGC.'
  }
};

@Component({
  selector: 'app-sgc-capitulos-panel',
  templateUrl: './sgc-capitulos-panel.component.html',
  styleUrls: ['./sgc-capitulos-panel.component.scss']
})
export class SgcCapitulosPanelComponent implements OnInit, OnChanges, OnDestroy {
  /** Si true, sincroniza el capítulo con ?cap= en la URL del dashboard. */
  @Input() syncQuery = false;
  /** Capítulo inicial forzado (slug), p. ej. desde query param del padre. */
  @Input() capituloInicial: string | null = null;

  busqueda = '';
  formatosFiltrados: FormatoBusquedaItem[] = [];
  capituloSeleccionado: TarjetaCapituloSgc | null = null;
  configSeleccionado: CapituloFormatoConfig | null = null;
  paginaDocs = 1;
  readonly DOCS_POR_PAGINA = 6;

  private readonly destroy$ = new Subject<void>();
  private querySubActiva = false;

  capitulos: TarjetaCapituloSgc[] = [];
  private todosLosFormatos: FormatoBusquedaItem[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private vigenciaSgc: SgcListaMaestraVigenciaService
  ) {
    this.rebuildCapitulos();
  }

  ngOnInit(): void {
    this.vigenciaSgc.refrescar().pipe(takeUntil(this.destroy$)).subscribe(() => this.rebuildCapitulos());
    this.vigenciaSgc.watchNoVigentes().pipe(takeUntil(this.destroy$)).subscribe(() => this.rebuildCapitulos());

    if (this.syncQuery) {
      this.querySubActiva = true;
      this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(qm => {
        const slug = (qm.get('cap') || this.capituloInicial || '').toLowerCase();
        this.aplicarCapitulo(slug || this.capitulos[0]?.slug || '');
      });
      return;
    }

    this.aplicarCapitulo(this.capituloInicial || this.capitulos[0]?.slug || '');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['capituloInicial'] && !changes['capituloInicial'].firstChange && !this.querySubActiva) {
      this.aplicarCapitulo(this.capituloInicial || this.capitulos[0]?.slug || '');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get buscandoFormatos(): boolean {
    return this.busqueda.trim().length > 0;
  }

  seleccionarCapitulo(c: TarjetaCapituloSgc): void {
    if (this.capituloSeleccionado?.slug === c.slug) {
      return;
    }
    this.limpiarBusqueda();
    this.aplicarCapitulo(c.slug);

    if (this.syncQuery) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { cap: c.slug },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  esCapituloActivo(c: TarjetaCapituloSgc): boolean {
    return this.capituloSeleccionado?.slug === c.slug;
  }

  aplicarFiltroFormatos(): void {
    const termino = this.normalizarTexto(this.busqueda);
    if (!termino) {
      this.formatosFiltrados = [];
      return;
    }

    this.formatosFiltrados = this.todosLosFormatos.filter(f => {
      const campos = [
        f.codigo,
        f.titulo,
        f.nombre,
        f.capituloTitulo,
        `capitulo ${f.capituloNumero}`,
        `cap ${f.capituloNumero}`
      ];
      return campos.some(campo => this.normalizarTexto(campo).includes(termino));
    });
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
    this.formatosFiltrados = [];
  }

  irAFormato(f: FormatoBusquedaItem): void {
    if (f.previewSlug) {
      this.router.navigate(['/sistema-gestion-calidad', f.capituloSlug, 'plantilla', f.previewSlug]);
      return;
    }
    this.seleccionarCapitulo(
      this.capitulos.find(c => c.slug === f.capituloSlug) || this.capitulos[0]
    );
  }

  tipoPlantilla(nombre: string): 'excel' | 'word' | 'pdf' | 'otro' {
    const n = nombre.toLowerCase();
    if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel';
    if (n.endsWith('.docx') || n.endsWith('.doc')) return 'word';
    if (n.endsWith('.pdf')) return 'pdf';
    return 'otro';
  }

  metaFormato(p: PlantillaFormato): string {
    return p.previewMode === 'form' ? 'Formulario interactivo' : 'Vista integrada';
  }

  get plantillasCentro(): PlantillaFormato[] {
    return this.vigenciaSgc.filtrarPlantillasCentro(this.configSeleccionado?.plantillas || []);
  }

  get plantillasPaginadas(): PlantillaFormato[] {
    const todas = this.plantillasCentro;
    const inicio = (this.paginaDocs - 1) * this.DOCS_POR_PAGINA;
    return todas.slice(inicio, inicio + this.DOCS_POR_PAGINA);
  }

  get totalPaginasDocs(): number {
    const total = this.plantillasCentro.length;
    return Math.max(1, Math.ceil(total / this.DOCS_POR_PAGINA));
  }

  get paginasDocs(): number[] {
    return Array.from({ length: this.totalPaginasDocs }, (_, i) => i + 1);
  }

  get mostrarPaginacionDocs(): boolean {
    return this.plantillasCentro.length > this.DOCS_POR_PAGINA;
  }

  get rangoDocsEtiqueta(): string {
    const total = this.plantillasCentro.length;
    if (!total) return '';
    const inicio = (this.paginaDocs - 1) * this.DOCS_POR_PAGINA + 1;
    const fin = Math.min(this.paginaDocs * this.DOCS_POR_PAGINA, total);
    return `${inicio}–${fin} de ${total}`;
  }

  irPaginaDocs(pagina: number): void {
    const max = this.totalPaginasDocs;
    this.paginaDocs = Math.min(Math.max(1, pagina), max);
  }

  tipoBadge(p: PlantillaFormato): string {
    const tipo = this.tipoPlantilla(p.nombre);
    if (tipo === 'excel') return 'Excel';
    if (tipo === 'word') return 'Word';
    if (tipo === 'pdf') return 'PDF';
    return 'Documento';
  }

  modoBadge(p: PlantillaFormato): string {
    return p.previewMode === 'form' ? 'Interactivo' : 'Integrado';
  }

  trackByFormato(_: number, f: FormatoBusquedaItem): string {
    return `${f.capituloSlug}-${f.codigo}`;
  }

  trackByCapitulo(_: number, c: TarjetaCapituloSgc): string {
    return c.slug;
  }

  trackByCodigo(_: number, p: PlantillaFormato): string {
    return p.codigo;
  }

  private rebuildCapitulos(): void {
    this.capitulos = SGC_CAPITULOS_ORDEN.map(c => {
      const visual = SGC_CAPITULO_VISUAL[c.numero];
      const plantillas = this.vigenciaSgc.filtrarPlantillasCentro(c.plantillas || []);
      return {
        slug: c.slug,
        numero: c.numero,
        titulo: c.titulo,
        descripcion: visual.descripcion,
        iconClass: visual.iconClass,
        colorInicio: visual.colorInicio,
        colorFin: visual.colorFin,
        totalFormatos: plantillas.length
      };
    });

    this.todosLosFormatos = SGC_CAPITULOS_ORDEN.flatMap(c => {
      const visual = SGC_CAPITULO_VISUAL[c.numero];
      return this.vigenciaSgc.filtrarPlantillasCentro(c.plantillas || []).map(p => ({
        capituloSlug: c.slug,
        capituloNumero: c.numero,
        capituloTitulo: c.titulo,
        colorInicio: visual?.colorInicio ?? '#0f766e',
        colorFin: visual?.colorFin ?? '#14b8a6',
        codigo: p.codigo,
        titulo: p.titulo,
        nombre: p.nombre,
        previewSlug: p.previewSlug
      }));
    });

    if (this.busqueda.trim()) {
      this.aplicarFiltroFormatos();
    }
  }

  private aplicarCapitulo(slug: string): void {
    const clean = (slug || '').toLowerCase();
    const tarjeta = this.capitulos.find(c => c.slug === clean) || this.capitulos[0] || null;
    const cfg = tarjeta ? (SGC_CAPITULOS_CATALOG[tarjeta.slug] || null) : null;
    this.capituloSeleccionado = tarjeta;
    this.configSeleccionado = cfg;
    this.paginaDocs = 1;
  }

  private normalizarTexto(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
