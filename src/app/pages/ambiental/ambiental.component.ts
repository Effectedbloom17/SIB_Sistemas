import { Component, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexResponsive,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis
} from 'ng-apexcharts';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { AmbientalControlTramitesComponent } from './ambiental-control-tramites.component';
import { AmbientalTramiteArchivosPanelComponent } from './ambiental-tramite-archivos-panel.component';

export interface OficioAmbiental {
  oficio_id: number;
  numero_oficio: number;
  empresa: string;
  motivo: string;
  documento_url?: string | null;
  documento_nombre?: string | null;
  documento_drive_id?: string | null;
}

export interface TramiteAmbiental {
  tramite_id: number;
  item: number;
  oficio: string;
  accion_realizar: string;
  responsable: 'Biznaga' | 'Cliente';
  fecha_vencimiento: string | null;
  clasificacion?: string | null;
  estatus: 'abierto' | 'cerrado';
  observaciones: string;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  documento_url?: string | null;
  documento_nombre?: string | null;
  documento_drive_id?: string | null;
  contestacion_url?: string | null;
  contestacion_nombre?: string | null;
  contestacion_drive_id?: string | null;
  /** 0 = sin contestación, 1 = con contestación */
  tiene_contestacion?: number | boolean | null;
}

export interface MetaSpF28 {
  nombre_empresa: string;
  nombre_consultor: string;
  documento_creado_at: string;
}

export interface EmpresaRegistrada {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
}

type TabAmbiental = 'oficios' | 'tramites' | 'control-tramites';
type ModoAmbiental = 'oficios' | 'tramites' | 'control-tramites';

export type AmbientalEstatusChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  stroke: ApexStroke;
  fill: ApexFill;
  legend: ApexLegend;
  dataLabels: ApexDataLabels;
  plotOptions: ApexPlotOptions;
  tooltip: ApexTooltip;
  responsive: ApexResponsive[];
};

export type AmbientalPrioridadKey =
  | 'critico'
  | 'urgente'
  | 'proximo'
  | 'seguimiento'
  | 'programado'
  | 'sin_prioridad';

export type AmbientalPrioridadChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  plotOptions: ApexPlotOptions;
  dataLabels: ApexDataLabels;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  grid: ApexGrid;
  legend: ApexLegend;
  tooltip: ApexTooltip;
  fill: ApexFill;
  stroke: ApexStroke;
};

@Component({
  selector: 'app-ambiental',
  templateUrl: './ambiental.component.html',
  styleUrls: ['./ambiental.component.scss']
})
export class AmbientalComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  readonly pageSize = 20;
  readonly responsables = ['Biznaga', 'Cliente'] as const;
  readonly clasificacionesTramite = ['MIA', 'COA', 'LAE', 'ENA', 'RME', 'IP'] as const;
  readonly prioridadEntregaDefs: ReadonlyArray<{
    key: AmbientalPrioridadKey;
    label: string;
    labelCorto: string;
    rango: string;
    color: string;
    maxDias: number | null;
  }> = [
    { key: 'critico', label: 'Crítico', labelCorto: 'Crítico', rango: '≤ 5 días', color: '#dc2626', maxDias: 5 },
    { key: 'urgente', label: 'Urgente', labelCorto: 'Urgente', rango: '≤ 10 días', color: '#ea580c', maxDias: 10 },
    { key: 'proximo', label: 'Próximo', labelCorto: 'Próximo', rango: '≤ 15 días', color: '#d97706', maxDias: 15 },
    { key: 'seguimiento', label: 'En seguimiento', labelCorto: 'Seguimiento', rango: '≤ 30 días', color: '#65a30d', maxDias: 30 },
    { key: 'programado', label: 'Programado', labelCorto: 'Programado', rango: '≤ 60 días', color: '#38512F', maxDias: 60 },
    { key: 'sin_prioridad', label: 'Sin prioridad inmediata', labelCorto: 'Sin prioridad', rango: '> 60 días', color: '#94a3b8', maxDias: null }
  ];

  tabActiva: TabAmbiental = 'oficios';
  /**
   * Modo de la pantalla según la ruta:
   * - 'oficios'          -> /control-oficios (SP-F-15)
   * - 'tramites'         -> /ambiental (dashboard SP-F-28)
   * - 'control-tramites' -> /control-tramites (visor lista + detalle)
   */
  modo: ModoAmbiental = 'tramites';
  puedeEditar = false;
  /** Gestionar oficios SP-F-15 (crear / editar / eliminar): todos excepto empresa */
  puedeCrearOficio = false;
  visorExpandido = false;

  @ViewChild(AmbientalControlTramitesComponent) controlTramitesPanel?: AmbientalControlTramitesComponent;
  @ViewChildren(AmbientalTramiteArchivosPanelComponent)
  tramiteArchivosPanels?: QueryList<AmbientalTramiteArchivosPanelComponent>;

  oficioSeleccionado: OficioAmbiental | null = null;
  tramiteSeleccionado: TramiteAmbiental | null = null;

  cargandoOficios = true;
  cargandoTramites = true;
  guardando = false;
  eliminandoTramite = false;

  oficios: OficioAmbiental[] = [];
  oficiosFiltrados: OficioAmbiental[] = [];
  tramites: TramiteAmbiental[] = [];
  tramitesFiltrados: TramiteAmbiental[] = [];
  tramitesEdit: TramiteAmbiental[] = [];

  paginaOficios = 1;
  paginaTramites = 1;

  statsOficios = { total: 0, empresas_unicas: 0 };
  statsTramites = { total: 0, abiertos: 0, cerrados: 0, vencidos: 0 };

  busquedaOficios = '';
  busquedaTramites = '';
  filtroEstatus = '';
  filtroResponsable = '';
  filtroSoloVencidos = false;
  filtroSoloEnPlazo = false;
  filtroDashboardActivo: 'todos' | 'abierto' | 'cerrado' | 'vencidos' = 'todos';

  chartsReady = false;
  prioridadChartReady = false;
  prioridadChipActivo: AmbientalPrioridadKey | null = null;
  estatusChart: Partial<AmbientalEstatusChartOptions> = {};
  prioridadChart: Partial<AmbientalPrioridadChartOptions> = {};
  donutCentroValor: number | string = 0;
  donutCentroEtiqueta = 'Trámites';
  donutCentroPct = 0;

  modalOficioAbierto = false;
  modalTramiteAbierto = false;
  visorDocumentoTramiteAbierto = false;
  tramiteControlInicialId: number | null = null;
  tramiteControlAmbitoInicial: 'documento' | 'contestacion' = 'documento';
  /** Conservado para compatibilidad con el estado existente del modal. */
  pasoModalTramite: 1 | 2 = 1;
  editandoOficio: OficioAmbiental | null = null;
  editandoTramite: TramiteAmbiental | null = null;

  formOficio = { numero_oficio: null as number | null, empresa: '', motivo: '' };
  anexoOficioSeleccionado: File | null = null;
  anexoOficioNombreActual: string | null = null;
  formTramite = {
    item: null as number | null,
    oficio: '',
    accion_realizar: '',
    responsable: 'Biznaga' as 'Biznaga' | 'Cliente',
    fecha_vencimiento: '',
    clasificacion: '' as string,
    estatus: 'abierto' as 'abierto' | 'cerrado',
    observaciones: ''
  };
  anexoTramiteSeleccionado: File | null = null;
  anexoTramiteNombreActual: string | null = null;
  anexoTramitePreviewUrl: string | null = null;
  anexoTramitePreviewSafe: SafeResourceUrl | null = null;
  anexoTramitePreviewTipo: 'pdf' | 'image' | 'other' | null = null;
  anexoTramiteDragOver = false;

  mostrarContestacionTramite = false;
  contestacionTramiteSeleccionada: File | null = null;
  contestacionTramiteNombreActual: string | null = null;
  contestacionTramitePreviewUrl: string | null = null;
  contestacionTramitePreviewSafe: SafeResourceUrl | null = null;
  contestacionTramitePreviewTipo: 'pdf' | 'image' | 'other' | null = null;
  contestacionTramiteDragOver = false;

  /** Drive / editor integrado SP-F-15 */
  spF15DriveFileId: string | null = null;
  spF15EditorUrl: string | null = null;
  spF15EditorEmbedUrl: string | null = null;
  spF15EditorEmbedSafe: SafeResourceUrl | null = null;
  mostrarEditorSpF15 = false;
  editorSpF15Cargando = false;
  editorSpF15Zoom = 100;
  siguienteNumeroOficio = 1;
  driveSyncGuardando = false;
  spF15UltimaSync: string | null = null;

  /** Drive / editor integrado SP-F-28 */
  spF28DriveFileId: string | null = null;
  spF28EditorUrl: string | null = null;
  spF28EditorEmbedUrl: string | null = null;
  spF28EditorEmbedSafe: SafeResourceUrl | null = null;
  mostrarEditorSpF28 = false;
  editorSpF28Cargando = false;
  spF28UltimaSync: string | null = null;
  editorSpF28Zoom = 100;
  cambiosPendientesSpF28 = false;
  /** Timestamp del primer cambio pendiente (para auto-guardado a los 30 min). */
  private cambiosPendientesDesdeSpF28: number | null = null;
  private autoSaveSpF28Timer: ReturnType<typeof setInterval> | null = null;
  private readonly autoSaveSpF28Ms = 30 * 60 * 1000;
  siguienteItemTramite = 1;
  metaSpF28: MetaSpF28 = {
    nombre_empresa: '',
    nombre_consultor: '',
    documento_creado_at: new Date().toISOString().slice(0, 10)
  };

  /** Selector de empresas registradas (SP-F-28) — estilo buscador DG-F-07 */
  empresasRegistradas: EmpresaRegistrada[] = [];
  /** null = sin selección; -1 = todas las empresas; >0 = empresa concreta */
  empresaSeleccionadaId: number | null = null;
  readonly empresaTodasId = -1;
  cargandoEmpresas = false;
  empresaBusqueda = '';
  empresaPanelBusquedaAbierto = false;
  /** Si true, el buscador solo lista empresas que ya tienen trámites SP-F-28. */
  filtroEmpresasConDocumentos = false;
  empresaIdsConTramites = new Set<number>();
  /** Menú custom abierto: filtroEstatus | filtroResponsable | consultor | tramiteResponsable | tramiteClasificacion | tramiteEstatus */
  comboAbierto: string | null = null;
  private readonly empresaStorageKey = 'ambiental_spf28_empresa_id';
  private readonly empresaStorageTodas = 'todas';

  /** Consultores responsables: usuarios del sistema (excluye los de empresa/cliente) */
  consultores: string[] = [];

  private pageContentEl: HTMLElement | null = null;
  private pageContentOverflowPrev = '';
  private pageContentDisplayPrev = '';
  private pageContentFlexPrev = '';
  private pageContentMinHeightPrev = '';

  constructor(
    private backend: BackendServices,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private router: Router,
    private route: ActivatedRoute,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    if (this.router.url.includes('control-oficios')) {
      this.modo = 'oficios';
    } else if (this.router.url.includes('control-tramites')) {
      this.modo = 'control-tramites';
      this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        const tramiteId = Number(params.get('tramiteId'));
        this.tramiteControlInicialId = Number.isFinite(tramiteId) && tramiteId > 0 ? tramiteId : null;
        this.tramiteControlAmbitoInicial =
          params.get('ambito') === 'contestacion' ? 'contestacion' : 'documento';
      });
    } else {
      this.modo = 'tramites';
    }
    this.tabActiva = this.modo === 'control-tramites' ? 'tramites' : this.modo;
    this.puedeEditar = this.authService.tieneAlgunRol(['root', 'administrador', 'ambiental']);
    this.puedeCrearOficio = !this.authService.esUsuarioEmpresa();
    this.initEstatusChart();
    this.initPrioridadChart();
    this.aplicarScrollPaginaAmbiental();
    if (this.modo === 'oficios') {
      this.cargarEstadoDriveSpF15();
      this.cargarOficios();
    } else if (this.modo === 'control-tramites') {
      // El listado y preview viven en app-ambiental-control-tramites
    } else {
      this.cargarConsultores();
      this.cargarEmpresasRegistradas();
      this.iniciarAutoSaveSpF28();
      this.aplicarDeepLinkEmpresa();
    }
  }

  private aplicarDeepLinkEmpresa(): void {
    const empresa = String(this.route.snapshot.queryParamMap.get('empresa') || '').trim();
    if (empresa) {
      this.empresaBusqueda = empresa;
    }
  }

  get headerTitulo(): string {
    if (this.modo === 'oficios') return 'Control de Oficios';
    if (this.modo === 'control-tramites') return 'Control de Trámites';
    return 'Ambiental';
  }

  get headerIcono(): string {
    if (this.modo === 'oficios') return 'fa-folder-open';
    if (this.modo === 'control-tramites') return 'fa-clipboard-list';
    return 'fa-tree';
  }

  ngOnDestroy(): void {
    this.detenerAutoSaveSpF28();
    // Al salir de la pantalla: guardar pendientes en Drive (sin importar desde el editor).
    if (this.cambiosPendientesSpF28 && !this.mostrarEditorSpF28) {
      this.guardarSpF28EnDrive(true);
    }
    this.liberarPreviewAnexoTramite();
    this.destroy$.next();
    this.destroy$.complete();
    this.restaurarScrollPaginaAmbiental();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarOverlaysAmbiental(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.empresaPanelBusquedaAbierto) {
      event.preventDefault();
      this.empresaPanelBusquedaAbierto = false;
      return;
    }
    if (this.mostrarEditorSpF15) {
      event.preventDefault();
      this.cerrarEditorSpF15();
      return;
    }
    if (this.mostrarEditorSpF28) {
      event.preventDefault();
      this.cerrarEditorSpF28();
      return;
    }
    if (this.visorExpandido) {
      event.preventDefault();
      this.toggleVisorExpandido();
    }
  }

  @HostListener('window:beforeunload')
  onBeforeUnloadSpF28(): void {
    if (this.cambiosPendientesSpF28 && !this.mostrarEditorSpF28) {
      this.guardarSpF28EnDrive(true);
    }
  }

  private aplicarScrollPaginaAmbiental(): void {
    this.pageContentEl = document.querySelector('.main-content > .page-content');
    if (!this.pageContentEl) return;
    this.pageContentOverflowPrev = this.pageContentEl.style.overflow;
    this.pageContentDisplayPrev = this.pageContentEl.style.display;
    this.pageContentFlexPrev = this.pageContentEl.style.flex;
    this.pageContentMinHeightPrev = this.pageContentEl.style.minHeight;
    this.pageContentEl.style.overflow = 'hidden';
    this.pageContentEl.style.display = 'flex';
    this.pageContentEl.style.flexDirection = 'column';
    this.pageContentEl.style.flex = '1 1 auto';
    this.pageContentEl.style.minHeight = '0';
  }

  private restaurarScrollPaginaAmbiental(): void {
    if (!this.pageContentEl) return;
    this.pageContentEl.style.overflow = this.pageContentOverflowPrev;
    this.pageContentEl.style.display = this.pageContentDisplayPrev;
    this.pageContentEl.style.flex = this.pageContentFlexPrev;
    this.pageContentEl.style.minHeight = this.pageContentMinHeightPrev;
    this.pageContentEl = null;
  }

  get oficiosPaginados(): OficioAmbiental[] {
    const start = (this.paginaOficios - 1) * this.pageSize;
    return this.oficiosFiltrados.slice(start, start + this.pageSize);
  }

  get totalPaginasOficios(): number {
    return Math.max(1, Math.ceil(this.oficiosFiltrados.length / this.pageSize));
  }

  get tramitesPaginados(): TramiteAmbiental[] {
    const start = (this.paginaTramites - 1) * this.pageSize;
    return this.tramitesEdit.slice(start, start + this.pageSize);
  }

  get totalPaginasTramites(): number {
    return Math.max(1, Math.ceil(this.tramitesEdit.length / this.pageSize));
  }

  get anioActualSpF28(): number {
    return new Date().getFullYear();
  }

  get ultimaRevisionSpF28(): string {
    return this.formatearFechaDocumento(this.metaSpF28.documento_creado_at);
  }

  cambiarTab(tab: TabAmbiental): void {
    if (this.tabActiva === tab) return;
    this.tabActiva = tab;
    this.visorExpandido = false;
  }

  trackByOficioId(_: number, o: OficioAmbiental): number {
    return o.oficio_id;
  }

  trackByTramiteId(_: number, t: TramiteAmbiental): number {
    return t.tramite_id;
  }

  get documentoPreviewUrl(): string | null {
    const o = this.oficioSeleccionado;
    if (!o) return null;
    const driveId = o.documento_drive_id?.trim();
    if (driveId) {
      // Solo PDF/imagen vía proxy: otros MIME salen como octet-stream y el
      // navegador descarga el archivo (nombre = driveId) al cargar el iframe.
      if (this.esImagenPreview || this.esPdfPreview) {
        return this.backend.resolverUrlDrivePreview(driveId);
      }
      return `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
    }
    const url = o.documento_url?.trim();
    return url || null;
  }

  get documentoPreviewNombre(): string {
    return this.oficioSeleccionado?.documento_nombre?.trim()
      || `Oficio #${this.oficioSeleccionado?.numero_oficio ?? ''}`;
  }

  get esImagenPreview(): boolean {
    const nombre = this.oficioSeleccionado?.documento_nombre?.toLowerCase() || '';
    if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(nombre)) {
      return true;
    }
    const url = (this.oficioSeleccionado?.documento_url || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(url) || url.includes('image/');
  }

  get esPdfPreview(): boolean {
    const nombre = this.oficioSeleccionado?.documento_nombre?.toLowerCase() || '';
    if (/\.pdf(\?|$)/i.test(nombre)) return true;
    const url = (this.oficioSeleccionado?.documento_url || '').toLowerCase();
    return /\.pdf(\?|$)/i.test(url);
  }

  /** Vista previa embebible (PDF, imagen o iframe de Drive). */
  get puedeEmbeberPreviewOficio(): boolean {
    return !!(this.documentoPreviewUrl && (this.esImagenPreview || this.esPdfPreview || this.oficioSeleccionado?.documento_drive_id));
  }

  seleccionarOficio(oficio: OficioAmbiental): void {
    this.oficioSeleccionado = oficio;
    this.visorExpandido = false;
  }

  seleccionarTramite(tramite: TramiteAmbiental): void {
    this.tramiteSeleccionado = tramite;
    if (this.puedeEditar) {
      this.abrirEditarTramite(tramite);
    }
  }

  abrirEditarTramite(tramite: TramiteAmbiental): void {
    if (!this.puedeEditar) return;
    this.abrirModalTramite(tramite);
  }

  irPaginaOficios(pagina: number): void {
    const p = Math.min(Math.max(1, pagina), this.totalPaginasOficios);
    this.paginaOficios = p;
  }

  irPaginaTramites(pagina: number): void {
    const p = Math.min(Math.max(1, pagina), this.totalPaginasTramites);
    this.paginaTramites = p;
  }

  toggleVisorExpandido(): void {
    if (!this.documentoPreviewUrl) return;
    this.visorExpandido = !this.visorExpandido;
    document.body.style.overflow = this.visorExpandido ? 'hidden' : '';
  }

  editarOficioSeleccionado(): void {
    if (!this.puedeCrearOficio || !this.oficioSeleccionado) return;
    this.abrirModalOficio(this.oficioSeleccionado);
  }

  cargarEstadoDriveSpF15(): void {
    this.backend.obtenerAmbientalSpF15EstadoDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.spF15DriveFileId = res.driveFileId || null;
            this.spF15EditorUrl = res.editorUrl || null;
            this.spF15EditorEmbedUrl = res.embedUrl || res.editorUrl || null;
            this.spF15UltimaSync = res.ultimaSyncLocal || res.ultimaSyncDrive || null;
          }
        }
      });
  }

  cargarEstadoDriveSpF28(): void {
    if (this.esVistaTodasEmpresas || this.empresaSeleccionadaId === null) return;
    const emp = this.empresaSeleccionada;
    this.backend.obtenerAmbientalSpF28EstadoDrive(this.empresaSeleccionadaId, emp?.nombre_empresa)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.spF28DriveFileId = res.driveFileId || null;
            this.spF28EditorUrl = res.editorUrl || null;
            this.spF28EditorEmbedUrl = res.embedUrl || res.editorUrl || null;
            this.spF28UltimaSync = res.ultimaSyncLocal || res.ultimaSyncDrive || null;
            if (res.metaSpF28) {
              this.metaSpF28 = { ...this.metaSpF28, ...res.metaSpF28 };
            }
          }
        }
      });
  }

  toggleEditorSpF15(): void {
    if (!this.spF15DriveFileId || !this.spF15EditorEmbedUrl) return;
    if (this.mostrarEditorSpF15) {
      this.cerrarEditorSpF15();
      return;
    }
    this.mostrarEditorSpF15 = true;
    this.editorSpF15Cargando = true;
    this.fijarEditorSpF15Embed(this.spF15EditorEmbedUrl);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private fijarEditorSpF15Embed(url: string | null): void {
    if (!url) {
      this.spF15EditorEmbedSafe = null;
      return;
    }
    this.spF15EditorEmbedSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  cerrarEditorSpF15(): void {
    this.mostrarEditorSpF15 = false;
    this.editorSpF15Cargando = false;
    this.editorSpF15Zoom = 100;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onEditorSpF15Load(): void {
    this.editorSpF15Cargando = false;
  }

  abrirEditorSpF15EnPestana(): void {
    if (this.spF15EditorUrl) {
      window.open(this.spF15EditorUrl, '_blank', 'noopener,noreferrer');
    }
  }

  ajustarZoomEditorSpF15(delta: number): void {
    this.editorSpF15Zoom = Math.min(125, Math.max(75, this.editorSpF15Zoom + delta));
  }

  resetZoomEditorSpF15(): void {
    this.editorSpF15Zoom = 100;
  }

  toggleEditorSpF28(): void {
    if (!this.spF28DriveFileId || !this.spF28EditorEmbedUrl) return;
    if (this.mostrarEditorSpF28) {
      this.cerrarEditorSpF28();
      return;
    }
    if (this.empresaSeleccionadaId === null || this.esVistaTodasEmpresas) {
      Swal.fire(
        'Selecciona una empresa',
        'Elige una empresa registrada para abrir su hoja en el editor.',
        'info'
      );
      return;
    }
    if (this.driveSyncGuardando) return;

    // Solo sincronizar BD → Drive si hay cambios pendientes; si no, abrir directo.
    if (this.cambiosPendientesSpF28) {
      this.guardarSpF28EnDrive(false, () => this.abrirEditorSpF28Panel());
      return;
    }
    this.abrirEditorSpF28Panel();
  }

  private abrirEditorSpF28Panel(): void {
    this.mostrarEditorSpF28 = true;
    this.editorSpF28Cargando = true;
    this.fijarEditorSpF28Embed(this.spF28EditorEmbedUrl);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private fijarEditorSpF28Embed(url: string | null): void {
    if (!url) {
      this.spF28EditorEmbedSafe = null;
      return;
    }
    this.spF28EditorEmbedSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  /** Cierra el editor sin sincronizar (no guarda automáticamente). */
  cerrarEditorSpF28(): void {
    this.mostrarEditorSpF28 = false;
    this.editorSpF28Cargando = false;
    this.editorSpF28Zoom = 100;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onEditorSpF28Load(): void {
    this.editorSpF28Cargando = false;
  }

  abrirEditorSpF28EnPestana(): void {
    if (this.spF28EditorUrl) {
      window.open(this.spF28EditorUrl, '_blank', 'noopener,noreferrer');
    }
  }

  ajustarZoomEditorSpF28(delta: number): void {
    this.editorSpF28Zoom = Math.min(125, Math.max(75, this.editorSpF28Zoom + delta));
  }

  resetZoomEditorSpF28(): void {
    this.editorSpF28Zoom = 100;
  }

  guardarInformacionSpF15(): void {
    if (this.driveSyncGuardando) return;
    this.driveSyncGuardando = true;
    const req = this.mostrarEditorSpF15
      ? this.backend.sincronizarAmbientalSpF15DesdeDrive()
      : this.backend.guardarAmbientalSpF15Drive();

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.aplicarRespuestaSpF15(res);
        if (res?.success) {
          Swal.fire({
            icon: 'success',
            title: this.mostrarEditorSpF15 ? 'Sincronización completada' : 'Información guardada',
            text: this.mostrarEditorSpF15
              ? 'Los cambios del editor se importaron correctamente.'
              : 'SP-F-15 actualizado en el sistema y en Drive.',
            timer: 2000,
            showConfirmButton: false
          });
        }
      },
      error: (err) => this.errorDriveSync(err, 'SP-F-15')
    });
  }

  private aplicarRespuestaSpF15(res: any): void {
    this.driveSyncGuardando = false;
    if (res?.success) {
      this.spF15UltimaSync = new Date().toISOString();
      if (res.oficios) {
        const seleccionadoId = this.oficioSeleccionado?.oficio_id;
        this.oficios = this.ordenarOficiosDesc(res.oficios);
        this.oficiosFiltrados = [...this.oficios];
        this.statsOficios = res.estadisticas || this.statsOficios;
        this.siguienteNumeroOficio = this.oficios.reduce(
          (max, o) => Math.max(max, o.numero_oficio), 0
        ) + 1;
        if (seleccionadoId) {
          this.oficioSeleccionado = this.oficios.find((o) => o.oficio_id === seleccionadoId) || this.oficioSeleccionado;
        }
        this.ajustarSeleccionOficio();
      }
    }
  }

  guardarInformacionSpF28(): void {
    if (this.driveSyncGuardando) return;
    if (this.empresaSeleccionadaId === null || this.esVistaTodasEmpresas) {
      Swal.fire(
        'Selecciona una empresa',
        this.esVistaTodasEmpresas
          ? 'En la vista «Todas» no se puede guardar en Drive. Elige una empresa específica.'
          : 'Elige una empresa registrada para guardar su información.',
        'info'
      );
      return;
    }

    // Con el editor abierto: importar cambios de la hoja → BD (acción manual del botón).
    if (this.mostrarEditorSpF28) {
      this.driveSyncGuardando = true;
      this.backend.sincronizarAmbientalSpF28DesdeDrive(this.empresaSeleccionadaId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => this.aplicarRespuestaSpF28(res),
          error: (err) => this.errorDriveSync(err, 'SP-F-28')
        });
      return;
    }

    this.guardarSpF28EnDrive(false);
  }

  /** Exporta trámites locales → Drive. `silencioso` evita tocar UI de error con Swal agresivo al salir. */
  private guardarSpF28EnDrive(silencioso = false, onOk?: () => void): void {
    if (this.driveSyncGuardando) return;
    if (this.empresaSeleccionadaId === null || this.esVistaTodasEmpresas) {
      onOk?.();
      return;
    }
    this.driveSyncGuardando = true;
    const payload = this.tramitesEdit.map((t) => ({
      tramite_id: t.tramite_id,
      item: t.item,
      oficio: t.oficio,
      accion_realizar: t.accion_realizar,
      responsable: t.responsable,
      fecha_vencimiento: t.fecha_vencimiento || null,
      estatus: t.estatus,
      observaciones: t.observaciones
    }));

    const req$ = this.backend.guardarAmbientalSpF28Drive(payload, {
      nombre_empresa: this.metaSpF28.nombre_empresa,
      nombre_consultor: this.metaSpF28.nombre_consultor
    }, this.empresaSeleccionadaId);
    (silencioso ? req$ : req$.pipe(takeUntil(this.destroy$))).subscribe({
      next: (res) => {
        this.aplicarRespuestaSpF28(res);
        if (res?.editorUrl) this.spF28EditorUrl = res.editorUrl;
        if (res?.embedUrl) this.spF28EditorEmbedUrl = res.embedUrl;
        onOk?.();
      },
      error: (err) => {
        if (silencioso) {
          this.driveSyncGuardando = false;
        } else {
          this.errorDriveSync(err, 'SP-F-28');
        }
      }
    });
  }

  private iniciarAutoSaveSpF28(): void {
    this.detenerAutoSaveSpF28();
    this.autoSaveSpF28Timer = setInterval(() => {
      if (this.mostrarEditorSpF28 || !this.cambiosPendientesSpF28 || this.driveSyncGuardando) return;
      if (!this.cambiosPendientesDesdeSpF28) return;
      if (Date.now() - this.cambiosPendientesDesdeSpF28 < this.autoSaveSpF28Ms) return;
      this.guardarSpF28EnDrive(true);
    }, 60_000);
  }

  private detenerAutoSaveSpF28(): void {
    if (this.autoSaveSpF28Timer) {
      clearInterval(this.autoSaveSpF28Timer);
      this.autoSaveSpF28Timer = null;
    }
  }

  private aplicarRespuestaSpF28(res: any): void {
    this.driveSyncGuardando = false;
    if (res?.success) {
      this.cambiosPendientesSpF28 = false;
      this.cambiosPendientesDesdeSpF28 = null;
      this.spF28UltimaSync = new Date().toISOString();
      if (res.metaSpF28) {
        this.metaSpF28 = { ...this.metaSpF28, ...res.metaSpF28 };
      }
      if (res.tramites) {
        this.tramites = res.tramites;
        this.statsTramites = res.estadisticas || this.statsTramites;
        this.aplicarVistaTramitesLocal();
        this.actualizarEstatusChart();
        this.ajustarSeleccionTramite();
      }
    }
  }

  private errorDriveSync(err: any, codigo: string): void {
    this.driveSyncGuardando = false;
    Swal.fire('Error', err?.error?.message || `No se pudo sincronizar ${codigo}.`, 'error');
  }

  onTramiteEditChange(): void {
    this.marcarCambiosPendientesSpF28();
  }

  onMetaSpF28Change(): void {
    this.marcarCambiosPendientesSpF28();
  }

  private marcarCambiosPendientesSpF28(): void {
    this.cambiosPendientesSpF28 = true;
    if (this.cambiosPendientesDesdeSpF28 == null) {
      this.cambiosPendientesDesdeSpF28 = Date.now();
    }
  }

  cargarEmpresasRegistradas(): void {
    this.cargandoEmpresas = true;
    this.backend.obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.cargandoEmpresas = false;
          const lista = res?.success && Array.isArray(res.empresas)
            ? res.empresas
            : (Array.isArray(res) ? res : []);
          this.empresasRegistradas = lista
            .filter((e: any) => e && e.nombre_empresa)
            .map((e: any) => ({
              empresa_id: e.empresa_id,
              nombre_empresa: e.nombre_empresa,
              rfc: e.rfc
            }))
            .sort((a: EmpresaRegistrada, b: EmpresaRegistrada) =>
              a.nombre_empresa.localeCompare(b.nombre_empresa, 'es', { sensitivity: 'base' }));
          this.cargarEmpresaIdsConTramites();
          this.autoSeleccionarEmpresa();
        },
        error: () => {
          this.cargandoEmpresas = false;
        }
      });
  }

  private cargarEmpresaIdsConTramites(): void {
    this.backend.listarAmbientalEmpresasConTramites()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const ids = Array.isArray(res?.empresaIds) ? res.empresaIds : [];
          this.empresaIdsConTramites = new Set(
            ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
          );
        },
        error: () => {
          this.empresaIdsConTramites = new Set();
        }
      });
  }

  /** Selecciona la empresa guardada (localStorage) o, en su defecto, la primera de la lista. */
  private autoSeleccionarEmpresa(): void {
    if (this.empresaSeleccionadaId !== null || this.empresasRegistradas.length === 0) return;

    const deepLink = String(this.route.snapshot.queryParamMap.get('empresa') || '').trim();
    if (deepLink) {
      const q = this.normalizarBusquedaEmpresa(deepLink);
      const porNombre = this.empresasRegistradas.find((e) =>
        this.normalizarBusquedaEmpresa(e.nombre_empresa).includes(q)
        || q.includes(this.normalizarBusquedaEmpresa(e.nombre_empresa))
      );
      if (porNombre) {
        this.empresaBusqueda = deepLink;
        this.seleccionarEmpresa(porNombre);
        return;
      }
    }

    const guardada = localStorage.getItem(this.empresaStorageKey);
    if (guardada === this.empresaStorageTodas) {
      this.seleccionarTodasEmpresas();
      return;
    }
    let objetivo: EmpresaRegistrada | undefined;
    const guardadaId = Number(guardada);
    if (Number.isFinite(guardadaId) && guardadaId > 0) {
      objetivo = this.empresasRegistradas.find((e) => e.empresa_id === guardadaId);
    }
    if (!objetivo) objetivo = this.empresasRegistradas[0];
    if (objetivo) this.seleccionarEmpresa(objetivo);
  }

  cargarConsultores(): void {
    this.backend.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const usuarios = Array.isArray(res?.usuarios) ? res.usuarios : (Array.isArray(res) ? res : []);
          this.consultores = usuarios
            .filter((u: any) => String(u?.rol || '').toLowerCase() !== 'empresa')
            .map((u: any) => `${u?.nombre || ''} ${u?.apellido || ''}`.trim())
            .filter((nombre: string) => !!nombre)
            .filter((nombre: string, i: number, arr: string[]) => arr.indexOf(nombre) === i)
            .sort((a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        },
        error: () => { /* lista de consultores opcional */ }
      });
  }

  get esVistaTodasEmpresas(): boolean {
    return this.empresaSeleccionadaId === this.empresaTodasId;
  }

  get hayEmpresaActiva(): boolean {
    return this.empresaSeleccionadaId !== null;
  }

  get empresasFiltradas(): EmpresaRegistrada[] {
    const q = this.normalizarBusquedaEmpresa(this.empresaBusqueda);
    let base = this.empresasRegistradas;
    if (this.filtroEmpresasConDocumentos) {
      base = base.filter((e) => this.empresaIdsConTramites.has(Number(e.empresa_id)));
    }
    if (!q) return base;
    return base.filter((e) => this.coincideBusquedaEmpresa(e, q));
  }

  get mostrarOpcionTodos(): boolean {
    if (!this.empresaPanelBusquedaAbierto) return false;
    const q = this.normalizarBusquedaEmpresa(this.empresaBusqueda);
    if (!q) return true;
    return 'todos'.includes(q) || 'todas'.includes(q) || 'todas las empresas'.includes(q) || q.includes('todo');
  }

  toggleFiltroEmpresasConDocumentos(): void {
    this.filtroEmpresasConDocumentos = !this.filtroEmpresasConDocumentos;
    if (this.filtroEmpresasConDocumentos && this.empresaIdsConTramites.size === 0) {
      this.cargarEmpresaIdsConTramites();
    }
  }

  get etiquetaFiltroEstatus(): string {
    if (this.filtroEstatus === 'abierto') return 'Abierto';
    if (this.filtroEstatus === 'cerrado') return 'Cerrado';
    return 'Todos los estatus';
  }

  get etiquetaFiltroResponsable(): string {
    if (this.filtroResponsable === 'Biznaga' || this.filtroResponsable === 'Cliente') {
      return this.filtroResponsable;
    }
    return 'Todos los responsables';
  }

  get etiquetaConsultor(): string {
    return this.metaSpF28.nombre_consultor?.trim() || 'Consultor responsable';
  }

  toggleCombo(id: string, event?: Event): void {
    event?.stopPropagation();
    this.comboAbierto = this.comboAbierto === id ? null : id;
  }

  cerrarCombo(): void {
    this.comboAbierto = null;
  }

  seleccionarFiltroEstatus(valor: string): void {
    this.filtroEstatus = valor;
    this.cerrarCombo();
    this.filtrarTramites();
  }

  seleccionarFiltroResponsable(valor: string): void {
    this.filtroResponsable = valor;
    this.cerrarCombo();
    this.filtrarTramites();
  }

  seleccionarConsultor(valor: string): void {
    this.metaSpF28.nombre_consultor = valor;
    this.onMetaSpF28Change();
    this.cerrarCombo();
  }

  seleccionarTramiteResponsable(valor: 'Biznaga' | 'Cliente'): void {
    this.formTramite.responsable = valor;
    this.cerrarCombo();
  }

  seleccionarTramiteEstatus(valor: 'abierto' | 'cerrado'): void {
    this.formTramite.estatus = valor;
    this.cerrarCombo();
  }

  seleccionarTramiteClasificacion(valor: string): void {
    this.formTramite.clasificacion = valor || '';
    this.cerrarCombo();
  }

  etiquetaClasificacionTramite(valor: string | null | undefined): string {
    const v = String(valor || '').trim().toUpperCase();
    return (this.clasificacionesTramite as readonly string[]).includes(v) ? v : 'Sin clasificación';
  }

  get empresaSeleccionada(): EmpresaRegistrada | null {
    if (this.empresaSeleccionadaId === null || this.esVistaTodasEmpresas) return null;
    return this.empresasRegistradas.find(
      (e) => e.empresa_id === Number(this.empresaSeleccionadaId)
    ) || null;
  }

  get dashTotalTramites(): number {
    return Number(this.statsTramites.total) || 0;
  }

  get dashAbiertos(): number {
    return Number(this.statsTramites.abiertos) || 0;
  }

  get dashCerrados(): number {
    return Number(this.statsTramites.cerrados) || 0;
  }

  get dashVencidos(): number {
    return Number(this.statsTramites.vencidos) || 0;
  }

  get dashAbiertosEnPlazo(): number {
    return Math.max(0, this.dashAbiertos - this.dashVencidos);
  }

  get dashPorcentajeCerrados(): number {
    if (!this.dashTotalTramites) return 0;
    return Math.round((this.dashCerrados / this.dashTotalTramites) * 100);
  }

  get dashDistribucionEstatus(): Array<{
    key: string;
    label: string;
    count: number;
    pct: number;
    color: string;
    filtro: 'todos' | 'abierto' | 'cerrado' | 'vencidos';
  }> {
    const total = this.dashTotalTramites || 1;
    return [
      {
        key: 'cerrado',
        label: 'Cerrados',
        count: this.dashCerrados,
        pct: Math.round((this.dashCerrados / total) * 100),
        color: '#768D6B',
        filtro: 'cerrado'
      },
      {
        key: 'abierto',
        label: 'Abiertos en plazo',
        count: this.dashAbiertosEnPlazo,
        pct: Math.round((this.dashAbiertosEnPlazo / total) * 100),
        color: '#38512F',
        filtro: 'abierto'
      },
      {
        key: 'vencido',
        label: 'Vencidos',
        count: this.dashVencidos,
        pct: Math.round((this.dashVencidos / total) * 100),
        color: '#ea580c',
        filtro: 'vencidos'
      }
    ];
  }

  get dashConteoPrioridad(): Record<AmbientalPrioridadKey, number> {
    const conteo: Record<AmbientalPrioridadKey, number> = {
      critico: 0,
      urgente: 0,
      proximo: 0,
      seguimiento: 0,
      programado: 0,
      sin_prioridad: 0
    };
    const hoy = this.fechaHoyMexicoIso();
    const hoyMs = new Date(`${hoy}T00:00:00`).getTime();

    for (const t of this.tramites) {
      if (t.estatus !== 'abierto' || !t.fecha_vencimiento) continue;
      const fecha = t.fecha_vencimiento.slice(0, 10);
      const fvMs = new Date(`${fecha}T00:00:00`).getTime();
      const dias = Math.round((fvMs - hoyMs) / 86400000);
      conteo[this.clasificarPrioridadEntrega(dias)] += 1;
    }
    return conteo;
  }

  get dashTotalPrioridad(): number {
    const c = this.dashConteoPrioridad;
    return c.critico + c.urgente + c.proximo + c.seguimiento + c.programado + c.sin_prioridad;
  }

  get dashSinFechaPrioridad(): number {
    return this.tramites.filter((t) => t.estatus === 'abierto' && !t.fecha_vencimiento).length;
  }

  get dashResumenPrioridad(): Array<{
    key: AmbientalPrioridadKey;
    label: string;
    labelCorto: string;
    rango: string;
    color: string;
    cantidad: number;
    pct: number;
  }> {
    const conteo = this.dashConteoPrioridad;
    const total = this.dashTotalPrioridad || 1;
    return this.prioridadEntregaDefs.map((def) => ({
      key: def.key,
      label: def.label,
      labelCorto: def.labelCorto,
      rango: def.rango,
      color: def.color,
      cantidad: conteo[def.key],
      pct: Math.round((conteo[def.key] / total) * 100)
    }));
  }

  get dashPrioridadDominante(): { label: string; cantidad: number; color: string } | null {
    const items = this.dashResumenPrioridad.filter((i) => i.cantidad > 0);
    if (!items.length) return null;
    const top = items.reduce((a, b) => (b.cantidad > a.cantidad ? b : a));
    return { label: top.label, cantidad: top.cantidad, color: top.color };
  }

  get dashResumenEstatus(): Array<{
    label: string;
    cantidad: number;
    filtro: 'cerrado' | 'abierto' | 'vencidos';
    clase: 'cerrado' | 'abierto' | 'vencido';
  }> {
    return [
      {
        label: 'Cerrados',
        cantidad: this.dashCerrados,
        filtro: 'cerrado',
        clase: 'cerrado'
      },
      {
        label: 'Abiertos en plazo',
        cantidad: this.dashAbiertosEnPlazo,
        filtro: 'abierto',
        clase: 'abierto'
      },
      {
        label: 'Vencidos',
        cantidad: this.dashVencidos,
        filtro: 'vencidos',
        clase: 'vencido'
      }
    ];
  }

  get dashConicGradient(): string {
    const total = this.dashTotalTramites;
    if (!total) return '#e2e8f0';
    const cerrPct = (this.dashCerrados / total) * 100;
    const plazoPct = (this.dashAbiertosEnPlazo / total) * 100;
    const venPct = (this.dashVencidos / total) * 100;
    const a = cerrPct;
    const b = a + plazoPct;
    const c = b + venPct;
    return `conic-gradient(#768D6B 0% ${a}%, #38512F ${a}% ${b}%, #ea580c ${b}% ${c}%, rgba(194, 209, 178, 0.45) ${c}% 100%)`;
  }

  clasificarPrioridadEntrega(diasRestantes: number): AmbientalPrioridadKey {
    if (diasRestantes <= 5) return 'critico';
    if (diasRestantes <= 10) return 'urgente';
    if (diasRestantes <= 15) return 'proximo';
    if (diasRestantes <= 30) return 'seguimiento';
    if (diasRestantes <= 60) return 'programado';
    return 'sin_prioridad';
  }

  private initEstatusChart(): void {
    const self = this;
    this.estatusChart = {
      series: [0, 0, 0],
      chart: {
        type: 'donut',
        height: 200,
        fontFamily: 'Open Sans, sans-serif',
        toolbar: { show: false },
        animations: { enabled: true, speed: 600 },
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.1 },
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetDonutCentro();
          }
        }
      },
      labels: ['Cerrados', 'Abiertos en plazo', 'Vencidos'],
      colors: ['#768D6B', '#38512F', '#ea580c'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.35,
          gradientToColors: ['#9eb194', '#5a7456', '#fb923c'],
          opacityFrom: 1,
          opacityTo: 0.88,
          stops: [0, 95, 100]
        }
      },
      legend: { show: false },
      dataLabels: { enabled: false },
      plotOptions: {
        pie: {
          expandOnClick: false,
          donut: { size: '74%', labels: { show: false } }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => {
            const total = this.dashTotalTramites || 0;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return `${val} trámite${val !== 1 ? 's' : ''} (${pct}%)`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };
  }

  private initPrioridadChart(): void {
    const labels = this.prioridadEntregaDefs.map((d) => d.labelCorto);
    const colors = this.prioridadEntregaDefs.map((d) => d.color);
    this.prioridadChart = {
      series: [{ name: 'Trámites', data: [0, 0, 0, 0, 0, 0] }],
      chart: {
        type: 'bar',
        height: 200,
        fontFamily: 'Open Sans, sans-serif',
        toolbar: { show: false },
        animations: { enabled: true, speed: 650 },
        parentHeightOffset: 0,
        offsetX: 4
      },
      colors,
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 5,
          barHeight: '62%',
          distributed: true,
          dataLabels: { position: 'top' }
        }
      },
      dataLabels: {
        enabled: true,
        textAnchor: 'start',
        offsetX: 6,
        style: {
          fontSize: '10px',
          fontWeight: 700,
          colors: ['#1A1A1A']
        },
        formatter: (val: number) => (val > 0 ? String(val) : '')
      },
      xaxis: {
        categories: labels,
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
        max: undefined
      },
      yaxis: {
        labels: {
          style: {
            fontSize: '10px',
            fontWeight: 600,
            colors: ['#38512F', '#38512F', '#38512F', '#38512F', '#38512F', '#38512F']
          },
          maxWidth: 118,
          offsetX: 0
        }
      },
      grid: {
        borderColor: 'rgba(56, 81, 47, 0.08)',
        strokeDashArray: 4,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
        padding: { left: 12, right: 18, top: -12, bottom: -12 }
      },
      legend: { show: false },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'horizontal',
          shadeIntensity: 0.25,
          opacityFrom: 1,
          opacityTo: 0.82,
          stops: [0, 90, 100]
        }
      },
      stroke: { width: 0 },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val: number, opts?: { dataPointIndex?: number }) => {
            const idx = opts?.dataPointIndex ?? 0;
            const def = this.prioridadEntregaDefs[idx];
            const total = this.dashTotalPrioridad || 0;
            const pct = total ? Math.round((val / total) * 100) : 0;
            const rango = def?.rango ? ` · ${def.rango}` : '';
            return `${val} trámite${val !== 1 ? 's' : ''} (${pct}%)${rango}`;
          }
        }
      }
    };
  }

  private actualizarEstatusChart(): void {
    this.estatusChart = {
      ...this.estatusChart,
      series: [this.dashCerrados, this.dashAbiertosEnPlazo, this.dashVencidos]
    };
    this.resetDonutCentro();
    this.chartsReady = true;
    this.actualizarPrioridadChart();
  }

  private actualizarPrioridadChart(): void {
    const conteo = this.dashConteoPrioridad;
    const data = this.prioridadEntregaDefs.map((d) => conteo[d.key]);
    const maxVal = Math.max(...data, 1);
    this.prioridadChart = {
      ...this.prioridadChart,
      series: [{ name: 'Trámites', data }],
      xaxis: {
        ...this.prioridadChart.xaxis,
        max: Math.max(maxVal + 1, 3)
      }
    };
    this.prioridadChartReady = true;
  }

  private resetDonutCentro(): void {
    this.ngZone.run(() => {
      const total = this.dashTotalTramites;
      this.donutCentroValor = total;
      this.donutCentroEtiqueta = 'Trámites';
      this.donutCentroPct = this.dashPorcentajeCerrados;
    });
  }

  private onDonutHover(index: number): void {
    this.ngZone.run(() => {
      const labels = ['Cerrados', 'Abiertos en plazo', 'Vencidos'];
      const counts = [this.dashCerrados, this.dashAbiertosEnPlazo, this.dashVencidos];
      const total = this.dashTotalTramites || 0;
      const count = counts[index] ?? 0;
      this.donutCentroValor = count;
      this.donutCentroEtiqueta = labels[index] || 'Trámites';
      this.donutCentroPct = total ? Math.round((count / total) * 100) : 0;
    });
  }

  trackByEmpresaId(_: number, e: EmpresaRegistrada): number {
    return e.empresa_id;
  }

  trackByPrioridadKey(_: number, item: { key: AmbientalPrioridadKey }): AmbientalPrioridadKey {
    return item.key;
  }

  nombreEmpresaTramite(t: TramiteAmbiental): string {
    const directo = (t.empresa_nombre || '').trim();
    if (directo) return directo;
    const id = Number(t.empresa_id);
    if (Number.isFinite(id) && id > 0) {
      const emp = this.empresasRegistradas.find((e) => e.empresa_id === id);
      if (emp) return emp.nombre_empresa;
    }
    return 'Sin empresa';
  }

  togglePrioridadChip(key: AmbientalPrioridadKey, event?: Event): void {
    event?.stopPropagation();
    this.prioridadChipActivo = this.prioridadChipActivo === key ? null : key;
  }

  abrirBusquedaEmpresa(): void {
    if (!this.puedeEditar) return;
    this.empresaPanelBusquedaAbierto = true;
  }

  seleccionarEmpresa(empresa: EmpresaRegistrada): void {
    if (this.empresaSeleccionadaId === empresa.empresa_id) {
      this.empresaBusqueda = '';
      this.empresaPanelBusquedaAbierto = false;
      return;
    }
    const aplicar = () => {
      this.empresaSeleccionadaId = empresa.empresa_id;
      try { localStorage.setItem(this.empresaStorageKey, String(empresa.empresa_id)); } catch { /* noop */ }
      this.metaSpF28 = {
        nombre_empresa: empresa.nombre_empresa,
        nombre_consultor: '',
        documento_creado_at: this.fechaHoyMexicoIso()
      };
      this.resetFiltrosTrasCambioEmpresa();
      this.cargarTramites();
      this.cargarEstadoDriveSpF28();
    };
    if (this.cambiosPendientesSpF28 && !this.mostrarEditorSpF28) {
      this.guardarSpF28EnDrive(true, aplicar);
      return;
    }
    aplicar();
  }

  seleccionarTodasEmpresas(): void {
    if (this.esVistaTodasEmpresas) {
      this.empresaBusqueda = '';
      this.empresaPanelBusquedaAbierto = false;
      return;
    }
    const aplicar = () => {
      this.empresaSeleccionadaId = this.empresaTodasId;
      try { localStorage.setItem(this.empresaStorageKey, this.empresaStorageTodas); } catch { /* noop */ }
      this.metaSpF28 = {
        nombre_empresa: 'Todas las empresas',
        nombre_consultor: '',
        documento_creado_at: this.fechaHoyMexicoIso()
      };
      this.resetFiltrosTrasCambioEmpresa();
      this.cargarTramites();
      this.spF28DriveFileId = null;
      this.spF28EditorUrl = null;
      this.spF28EditorEmbedUrl = null;
      this.spF28EditorEmbedSafe = null;
      this.mostrarEditorSpF28 = false;
      this.spF28UltimaSync = null;
    };
    if (this.cambiosPendientesSpF28 && !this.mostrarEditorSpF28) {
      this.guardarSpF28EnDrive(true, aplicar);
      return;
    }
    aplicar();
  }

  private resetFiltrosTrasCambioEmpresa(): void {
    this.cambiosPendientesSpF28 = false;
    this.cambiosPendientesDesdeSpF28 = null;
    this.filtroDashboardActivo = 'todos';
    this.filtroSoloVencidos = false;
    this.filtroSoloEnPlazo = false;
    this.filtroEstatus = '';
    this.filtroResponsable = '';
    this.busquedaTramites = '';
    this.empresaBusqueda = '';
    this.empresaPanelBusquedaAbierto = false;
    this.paginaTramites = 1;
    this.tramiteSeleccionado = null;
  }

  onBusquedaEmpresaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.empresaPanelBusquedaAbierto = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (this.mostrarOpcionTodos && !this.empresaBusqueda.trim()) {
      this.seleccionarTodasEmpresas();
      return;
    }
    const primero = this.empresasFiltradas[0];
    if (primero) {
      this.seleccionarEmpresa(primero);
    } else if (this.mostrarOpcionTodos) {
      this.seleccionarTodasEmpresas();
    }
  }

  private normalizarBusquedaEmpresa(texto: string): string {
    return (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private coincideBusquedaEmpresa(empresa: EmpresaRegistrada, consulta: string): boolean {
    const campos = [empresa.nombre_empresa, empresa.rfc || ''];
    return campos.some((campo) => this.normalizarBusquedaEmpresa(campo).includes(consulta));
  }

  @HostListener('document:click', ['$event'])
  cerrarBusquedaEmpresaSiFuera(event: MouseEvent): void {
    if (this.prioridadChipActivo !== null) {
      const target = event.target as HTMLElement;
      if (!target.closest('.ambiental-prio-chip')) {
        this.prioridadChipActivo = null;
      }
    }
    if (this.comboAbierto) {
      const target = event.target as HTMLElement;
      if (!target.closest('.ambiental-combo')) {
        this.comboAbierto = null;
      }
    }
    if (this.modo !== 'tramites' || !this.empresaPanelBusquedaAbierto) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.ambiental-empresa-nav')) {
      this.empresaPanelBusquedaAbierto = false;
    }
  }

  cargarOficios(): void {
    this.cargandoOficios = true;
    this.backend.listarAmbientalOficios(this.busquedaOficios)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoOficios = false;
          if (res?.success) {
            this.oficios = this.ordenarOficiosDesc(res.oficios || []);
            this.oficiosFiltrados = [...this.oficios];
            this.statsOficios = res.estadisticas || this.statsOficios;
            if (res.siguienteNumero) {
              this.siguienteNumeroOficio = Number(res.siguienteNumero) || 1;
            }
            this.paginaOficios = Math.min(this.paginaOficios, this.totalPaginasOficios);
            this.ajustarSeleccionOficio();
          }
        },
        error: () => {
          this.cargandoOficios = false;
          Swal.fire('Error', 'No se pudo cargar el control de oficios.', 'error');
        }
      });
  }

  private ajustarSeleccionOficio(): void {
    if (!this.oficioSeleccionado && this.oficiosFiltrados.length > 0) {
      this.oficioSeleccionado = this.oficiosPaginados[0] || this.oficiosFiltrados[0];
    } else if (this.oficioSeleccionado) {
      const actual = this.oficiosFiltrados.find(o => o.oficio_id === this.oficioSeleccionado!.oficio_id);
      this.oficioSeleccionado = actual || this.oficiosPaginados[0] || this.oficiosFiltrados[0] || null;
    }
  }

  private ordenarOficiosDesc(lista: OficioAmbiental[]): OficioAmbiental[] {
    return [...(lista || [])].sort((a, b) => Number(b.numero_oficio) - Number(a.numero_oficio));
  }

  cargarTramites(): void {
    if (this.empresaSeleccionadaId === null) {
      this.tramites = [];
      this.tramitesFiltrados = [];
      this.tramitesEdit = [];
      this.statsTramites = { total: 0, abiertos: 0, cerrados: 0, vencidos: 0 };
      this.tramiteSeleccionado = null;
      this.cargandoTramites = false;
      this.actualizarEstatusChart();
      return;
    }
    const emp = this.empresaSeleccionada;
    this.cargandoTramites = true;
    const filtros: {
      busqueda?: string;
      estatus?: string;
      responsable?: string;
      empresa_id?: number | null;
      empresa_nombre?: string;
    } = {
      busqueda: this.busquedaTramites,
      estatus: this.filtroEstatus,
      responsable: this.filtroResponsable
    };
    if (!this.esVistaTodasEmpresas) {
      filtros.empresa_id = this.empresaSeleccionadaId;
      filtros.empresa_nombre = emp?.nombre_empresa;
    }
    this.backend.listarAmbientalTramites(filtros)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoTramites = false;
          if (res?.success) {
            this.tramites = res.tramites || [];
            this.statsTramites = res.estadisticas || this.statsTramites;
            if (this.esVistaTodasEmpresas) {
              this.recalcularStatsDesdeTramites();
            }
            this.aplicarVistaTramitesLocal();
            this.actualizarEstatusChart();
            if (res.metaSpF28 && !this.esVistaTodasEmpresas) {
              this.metaSpF28 = { ...this.metaSpF28, ...res.metaSpF28 };
            }
            if (res.siguienteItem && !this.esVistaTodasEmpresas) {
              this.siguienteItemTramite = Number(res.siguienteItem) || 1;
            }
            this.paginaTramites = Math.min(this.paginaTramites, this.totalPaginasTramites);
            this.ajustarSeleccionTramite();
          }
        },
        error: () => {
          this.cargandoTramites = false;
          Swal.fire('Error', 'No se pudo cargar el control de trámites.', 'error');
        }
      });
  }

  private ajustarSeleccionTramite(): void {
    if (!this.tramiteSeleccionado && this.tramitesEdit.length > 0) {
      this.tramiteSeleccionado = this.tramitesPaginados[0] || this.tramitesEdit[0];
    } else if (this.tramiteSeleccionado) {
      const actual = this.tramitesEdit.find(t => t.tramite_id === this.tramiteSeleccionado!.tramite_id);
      this.tramiteSeleccionado = actual || this.tramitesPaginados[0] || this.tramitesEdit[0] || null;
    }
  }

  filtrarOficios(): void {
    this.paginaOficios = 1;
    this.cargarOficios();
  }

  filtrarTramites(): void {
    this.filtroSoloVencidos = false;
    this.filtroSoloEnPlazo = false;
    if (this.filtroEstatus === 'abierto') {
        this.filtroDashboardActivo = 'abierto';
      } else if (this.filtroEstatus === 'cerrado') {
        this.filtroDashboardActivo = 'cerrado';
      } else {
        this.filtroDashboardActivo = 'todos';
      }
    this.paginaTramites = 1;
    this.cargarTramites();
  }

  aplicarFiltroDashboard(tipo: 'todos' | 'abierto' | 'cerrado' | 'vencidos'): void {
    this.filtroDashboardActivo = tipo;
    this.filtroSoloVencidos = tipo === 'vencidos';
    this.filtroSoloEnPlazo = tipo === 'abierto';
    this.filtroEstatus = tipo === 'todos' || tipo === 'vencidos' ? '' : tipo;
    this.paginaTramites = 1;
    this.cargarTramites();
  }

  private aplicarVistaTramitesLocal(): void {
    let lista = [...this.tramites];
    if (this.filtroSoloVencidos) {
      lista = lista.filter((t) => this.esVencido(t));
    } else if (this.filtroSoloEnPlazo) {
      lista = lista.filter((t) => t.estatus === 'abierto' && !this.esVencido(t));
    }
    this.tramitesFiltrados = lista;
    this.tramitesEdit = lista.map((t) => ({ ...t }));
  }

  private recalcularStatsDesdeTramites(): void {
    const lista = this.tramites || [];
    const abiertos = lista.filter((t) => t.estatus === 'abierto').length;
    const cerrados = lista.filter((t) => t.estatus === 'cerrado').length;
    const vencidos = lista.filter((t) => this.esVencido(t)).length;
    this.statsTramites = {
      total: lista.length,
      abiertos,
      cerrados,
      vencidos
    };
  }

  abrirModalOficio(oficio?: OficioAmbiental): void {
    if (!this.puedeCrearOficio) return;
    this.editandoOficio = oficio || null;
    this.anexoOficioSeleccionado = null;
    if (oficio) {
      this.formOficio = {
        numero_oficio: oficio.numero_oficio,
        empresa: oficio.empresa,
        motivo: oficio.motivo
      };
      this.anexoOficioNombreActual = oficio.documento_nombre?.trim() || null;
    } else {
      this.formOficio = {
        numero_oficio: this.siguienteNumeroOficio,
        empresa: '',
        motivo: ''
      };
      this.anexoOficioNombreActual = null;
    }
    this.modalOficioAbierto = true;
  }

  cerrarModalOficio(): void {
    this.modalOficioAbierto = false;
    this.editandoOficio = null;
    this.anexoOficioSeleccionado = null;
    this.anexoOficioNombreActual = null;
  }

  onAnexoOficioSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.anexoOficioSeleccionado = file;
    if (file) {
      this.anexoOficioNombreActual = file.name;
    }
  }

  quitarAnexoOficioSeleccionado(input?: HTMLInputElement): void {
    this.anexoOficioSeleccionado = null;
    if (!this.editandoOficio?.documento_nombre) {
      this.anexoOficioNombreActual = null;
    } else {
      this.anexoOficioNombreActual = this.editandoOficio.documento_nombre;
    }
    if (input) {
      input.value = '';
    }
  }

  guardarOficio(): void {
    if (!this.puedeCrearOficio) return;
    if (!this.formOficio.numero_oficio || !this.formOficio.empresa.trim()) {
      Swal.fire('Validación', 'Número de oficio y empresa son obligatorios.', 'warning');
      return;
    }
    this.guardando = true;
    const payload = {
      numero_oficio: this.formOficio.numero_oficio,
      empresa: this.formOficio.empresa.trim(),
      motivo: this.formOficio.motivo.trim()
    };
    const req = this.editandoOficio
      ? this.backend.actualizarAmbientalOficio(this.editandoOficio.oficio_id, payload, this.anexoOficioSeleccionado)
      : this.backend.crearAmbientalOficio(payload, this.anexoOficioSeleccionado);

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res?.success) {
          const esEdicion = !!this.editandoOficio;
          const oficioGuardado = res.oficio as OficioAmbiental | undefined;
          this.cerrarModalOficio();
          this.backend.guardarAmbientalSpF15Drive()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (driveRes) => {
                this.aplicarRespuestaSpF15(driveRes);
                if (oficioGuardado) {
                  this.oficioSeleccionado = this.oficios.find(
                    (o) => o.oficio_id === oficioGuardado.oficio_id
                  ) || oficioGuardado;
                }
                if (!driveRes?.oficios) {
                  this.cargarOficios();
                }
                Swal.fire({
                  icon: 'success',
                  title: esEdicion ? 'Oficio actualizado' : 'Oficio registrado',
                  text: 'La información se guardó en el sistema y en Excel/Drive.',
                  timer: 2200,
                  showConfirmButton: false
                });
              },
              error: () => {
                this.cargarOficios();
                Swal.fire({
                  icon: 'warning',
                  title: esEdicion ? 'Oficio actualizado en sistema' : 'Oficio registrado en sistema',
                  text: 'Se guardó en la base de datos, pero no se pudo sincronizar con Excel/Drive.',
                  confirmButtonColor: '#38512F'
                });
              }
            });
        }
        this.guardando = false;
      },
      error: (err) => {
        this.guardando = false;
        Swal.fire('Error', err?.error?.message || 'No se pudo guardar el oficio.', 'error');
      }
    });
  }

  confirmarEliminarOficio(oficio: OficioAmbiental): void {
    if (!this.puedeCrearOficio || !oficio?.oficio_id) return;
    this.backend.eliminarAmbientalOficio(oficio.oficio_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.oficioSeleccionado?.oficio_id === oficio.oficio_id) {
            this.oficioSeleccionado = null;
          }
          this.backend.guardarAmbientalSpF15Drive()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (driveRes) => this.aplicarRespuestaSpF15(driveRes),
              error: () => this.cargarOficios()
            });
        },
        error: () => Swal.fire('Error', 'No se pudo eliminar el oficio.', 'error')
      });
  }

  abrirModalTramite(tramite?: TramiteAmbiental): void {
    if (!tramite) {
      if (this.empresaSeleccionadaId === null || this.esVistaTodasEmpresas) {
        Swal.fire(
          'Selecciona una empresa',
          this.esVistaTodasEmpresas
            ? 'Para agregar trámites elige una empresa específica (no «Todas»).'
            : 'Elige una empresa registrada para agregar trámites.',
          'info'
        );
        return;
      }
    } else if (!this.puedeEditar) {
      return;
    }
    this.editandoTramite = tramite || null;
    this.liberarPreviewAnexoTramite();
    this.liberarPreviewContestacionTramite();
    this.anexoTramiteSeleccionado = null;
    this.anexoTramiteDragOver = false;
    this.contestacionTramiteSeleccionada = null;
    this.contestacionTramiteDragOver = false;
    if (tramite) {
      this.formTramite = {
        item: tramite.item,
        oficio: tramite.oficio,
        accion_realizar: tramite.accion_realizar,
        responsable: tramite.responsable,
        fecha_vencimiento: tramite.fecha_vencimiento || '',
        clasificacion: tramite.clasificacion || '',
        estatus: tramite.estatus,
        observaciones: tramite.observaciones
      };
      this.anexoTramiteNombreActual = tramite.documento_nombre?.trim() || null;
      this.contestacionTramiteNombreActual = tramite.contestacion_nombre?.trim() || null;
      this.mostrarContestacionTramite = true;
      this.actualizarPreviewAnexoTramite();
      this.actualizarPreviewContestacionTramite();
    } else {
      this.formTramite = {
        item: this.siguienteItemTramite,
        oficio: '',
        accion_realizar: '',
        responsable: 'Biznaga',
        fecha_vencimiento: '',
        clasificacion: '',
        estatus: 'abierto',
        observaciones: ''
      };
      this.anexoTramiteNombreActual = null;
      this.contestacionTramiteNombreActual = null;
      this.mostrarContestacionTramite = true;
    }
    this.pasoModalTramite = 1;
    this.modalTramiteAbierto = true;
  }

  cerrarModalTramite(): void {
    if (this.guardando || this.eliminandoTramite) return;
    this.modalTramiteAbierto = false;
    this.visorDocumentoTramiteAbierto = false;
    this.pasoModalTramite = 1;
    this.editandoTramite = null;
    this.liberarPreviewAnexoTramite();
    this.liberarPreviewContestacionTramite();
    this.anexoTramiteSeleccionado = null;
    this.anexoTramiteNombreActual = null;
    this.anexoTramiteDragOver = false;
    this.contestacionTramiteSeleccionada = null;
    this.contestacionTramiteNombreActual = null;
    this.contestacionTramiteDragOver = false;
    this.mostrarContestacionTramite = false;
    this.comboAbierto = null;
  }

  toggleContestacionTramite(): void {
    this.mostrarContestacionTramite = !this.mostrarContestacionTramite;
  }

  irPasoModalTramite(paso: 1 | 2): void {
    this.pasoModalTramite = paso;
    this.comboAbierto = null;
  }

  onArchivosTramiteCambiaron(): void {
    this.marcarCambiosPendientesSpF28();
    if (this.modo === 'control-tramites') {
      this.controlTramitesPanel?.cargarLista();
    } else {
      this.cargarTramites();
    }
  }

  get tramiteActualTieneDocumentacion(): boolean {
    if (!this.editandoTramite) return false;
    const paneles = this.tramiteArchivosPanels?.toArray() || [];
    if (paneles.some(panel => panel.hayContenido)) return true;
    return !!(
      this.editandoTramite.documento_drive_id
      || this.editandoTramite.documento_nombre
      || this.editandoTramite.contestacion_drive_id
      || this.editandoTramite.contestacion_nombre
      || Number(this.editandoTramite.tiene_contestacion) === 1
    );
  }

  irAControlTramite(): void {
    const tramiteId = this.editandoTramite?.tramite_id;
    if (!tramiteId) return;
    const paneles = this.tramiteArchivosPanels?.toArray() || [];
    const tieneDocumento = paneles.some(panel => panel.ambito === 'documento' && panel.hayContenido)
      || !!this.editandoTramite?.documento_drive_id;
    const ambito = tieneDocumento ? 'documento' : 'contestacion';
    this.cerrarModalTramite();
    void this.router.navigate(['/control-tramites'], {
      queryParams: { tramiteId, ambito }
    });
  }

  onAnexoTramiteSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.asignarAnexoTramite(file);
    if (input) input.value = '';
  }

  onAnexoTramiteDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.anexoTramiteDragOver = true;
  }

  onAnexoTramiteDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.anexoTramiteDragOver = false;
  }

  onAnexoTramiteDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.anexoTramiteDragOver = false;
    const file = event.dataTransfer?.files?.[0] || null;
    if (file) this.asignarAnexoTramite(file);
  }

  private asignarAnexoTramite(file: File | null): void {
    if (!file) return;
    this.anexoTramiteSeleccionado = file;
    this.anexoTramiteNombreActual = file.name;
    this.actualizarPreviewAnexoTramite();
  }

  quitarAnexoTramiteSeleccionado(input?: HTMLInputElement): void {
    this.anexoTramiteSeleccionado = null;
    if (!this.editandoTramite?.documento_nombre) {
      this.anexoTramiteNombreActual = null;
      this.liberarPreviewAnexoTramite();
    } else {
      this.anexoTramiteNombreActual = this.editandoTramite.documento_nombre;
      this.actualizarPreviewAnexoTramite();
    }
    if (input) input.value = '';
  }

  get etiquetaTipoAnexoTramite(): string {
    return this.etiquetaTipoArchivoTramite(this.anexoTramitePreviewTipo);
  }

  get etiquetaTipoContestacionTramite(): string {
    return this.etiquetaTipoArchivoTramite(this.contestacionTramitePreviewTipo);
  }

  private etiquetaTipoArchivoTramite(tipo: 'pdf' | 'image' | 'other' | null): string {
    if (tipo === 'image') return 'IMG';
    if (tipo === 'pdf') return 'PDF';
    if (tipo === 'other') return 'DOC';
    return 'DOC';
  }

  private liberarPreviewAnexoTramite(): void {
    if (this.anexoTramitePreviewUrl && this.anexoTramitePreviewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(this.anexoTramitePreviewUrl); } catch { /* noop */ }
    }
    this.anexoTramitePreviewUrl = null;
    this.anexoTramitePreviewSafe = null;
    this.anexoTramitePreviewTipo = null;
  }

  private liberarPreviewContestacionTramite(): void {
    if (this.contestacionTramitePreviewUrl && this.contestacionTramitePreviewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(this.contestacionTramitePreviewUrl); } catch { /* noop */ }
    }
    this.contestacionTramitePreviewUrl = null;
    this.contestacionTramitePreviewSafe = null;
    this.contestacionTramitePreviewTipo = null;
  }

  private clasificarTipoArchivoTramite(nombre: string, mime?: string): 'pdf' | 'image' | 'other' {
    const n = (nombre || '').toLowerCase();
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(n)) return 'image';
    if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
    return 'other';
  }

  private actualizarPreviewAnexoTramite(): void {
    this.liberarPreviewAnexoTramite();

    if (this.anexoTramiteSeleccionado) {
      const file = this.anexoTramiteSeleccionado;
      const tipo = this.clasificarTipoArchivoTramite(file.name, file.type);
      this.anexoTramitePreviewTipo = tipo;
      if (tipo === 'other') {
        // Word y similares: solo metadatos, sin iframe
        return;
      }
      const url = URL.createObjectURL(file);
      this.anexoTramitePreviewUrl = url;
      this.anexoTramitePreviewSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      return;
    }

    const tramite = this.editandoTramite;
    if (!tramite) return;
    const driveUrl = this.urlDocumentoTramite(tramite);
    if (!driveUrl) return;
    const tipo = this.clasificarTipoArchivoTramite(tramite.documento_nombre || '');
    this.anexoTramitePreviewTipo = tipo === 'other' ? 'pdf' : tipo;
    this.anexoTramitePreviewUrl = driveUrl;
    this.anexoTramitePreviewSafe = this.sanitizer.bypassSecurityTrustResourceUrl(driveUrl);
  }

  onContestacionTramiteSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.asignarContestacionTramite(file);
    if (input) input.value = '';
  }

  onContestacionTramiteDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contestacionTramiteDragOver = true;
  }

  onContestacionTramiteDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contestacionTramiteDragOver = false;
  }

  onContestacionTramiteDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contestacionTramiteDragOver = false;
    const file = event.dataTransfer?.files?.[0] || null;
    if (file) this.asignarContestacionTramite(file);
  }

  private asignarContestacionTramite(file: File | null): void {
    if (!file) return;
    this.contestacionTramiteSeleccionada = file;
    this.contestacionTramiteNombreActual = file.name;
    this.mostrarContestacionTramite = true;
    this.actualizarPreviewContestacionTramite();
  }

  quitarContestacionTramiteSeleccionada(input?: HTMLInputElement): void {
    this.contestacionTramiteSeleccionada = null;
    if (!this.editandoTramite?.contestacion_nombre) {
      this.contestacionTramiteNombreActual = null;
      this.liberarPreviewContestacionTramite();
    } else {
      this.contestacionTramiteNombreActual = this.editandoTramite.contestacion_nombre;
      this.actualizarPreviewContestacionTramite();
    }
    if (input) input.value = '';
  }

  private actualizarPreviewContestacionTramite(): void {
    this.liberarPreviewContestacionTramite();

    if (this.contestacionTramiteSeleccionada) {
      const file = this.contestacionTramiteSeleccionada;
      const tipo = this.clasificarTipoArchivoTramite(file.name, file.type);
      this.contestacionTramitePreviewTipo = tipo;
      if (tipo === 'other') return;
      const url = URL.createObjectURL(file);
      this.contestacionTramitePreviewUrl = url;
      this.contestacionTramitePreviewSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      return;
    }

    const tramite = this.editandoTramite;
    if (!tramite) return;
    const driveUrl = this.urlContestacionTramite(tramite);
    if (!driveUrl) return;
    const tipo = this.clasificarTipoArchivoTramite(tramite.contestacion_nombre || '');
    this.contestacionTramitePreviewTipo = tipo === 'other' ? 'pdf' : tipo;
    this.contestacionTramitePreviewUrl = driveUrl;
    this.contestacionTramitePreviewSafe = this.sanitizer.bypassSecurityTrustResourceUrl(driveUrl);
  }

  urlDocumentoTramite(tramite: TramiteAmbiental | null | undefined): string | null {
    if (!tramite) return null;
    if (tramite.documento_drive_id?.trim()) {
      return this.backend.resolverUrlDrivePreview(tramite.documento_drive_id.trim());
    }
    const url = tramite.documento_url?.trim();
    return url || null;
  }

  urlContestacionTramite(tramite: TramiteAmbiental | null | undefined): string | null {
    if (!tramite) return null;
    if (tramite.contestacion_drive_id?.trim()) {
      return this.backend.resolverUrlDrivePreview(tramite.contestacion_drive_id.trim());
    }
    const url = tramite.contestacion_url?.trim();
    return url || null;
  }

  etiquetaEstatusTramite(estatus: 'abierto' | 'cerrado'): string {
    return estatus === 'cerrado' ? 'Cerrado' : 'Abierto';
  }

  guardarTramite(): void {
    if (!this.formTramite.item) {
      Swal.fire('Validación', 'El ítem es obligatorio.', 'warning');
      return;
    }
    const empresaId = this.editandoTramite?.empresa_id ?? this.empresaSeleccionadaId;
    if (empresaId === null || empresaId === undefined) {
      Swal.fire('Validación', 'No se pudo determinar la empresa del trámite.', 'warning');
      return;
    }
    const oficio = String(this.formTramite.oficio || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    const hayArchivosPendientes = this.tramiteArchivosPanels?.some(panel => panel.hayPendientes) || false;
    if (hayArchivosPendientes && !oficio) {
      Swal.fire('Validación', 'Indica el oficio antes de guardar archivos o carpetas.', 'warning');
      return;
    }
    this.guardando = true;
    const emp = this.empresaSeleccionada;
    const payload = {
      item: this.formTramite.item,
      oficio,
      accion_realizar: this.formTramite.accion_realizar.trim(),
      responsable: this.formTramite.responsable,
      fecha_vencimiento: this.formTramite.fecha_vencimiento || '',
      clasificacion: this.formTramite.clasificacion || '',
      estatus: this.formTramite.estatus,
      observaciones: this.formTramite.observaciones.trim(),
      empresa_id: empresaId,
      empresa_nombre: this.editandoTramite?.empresa_nombre
        || emp?.nombre_empresa
        || this.metaSpF28.nombre_empresa
    };
    const req = this.editandoTramite
      ? this.backend.actualizarAmbientalTramite(
          this.editandoTramite.tramite_id,
          payload,
          null,
          null
        )
      : this.backend.crearAmbientalTramite(
          payload,
          null,
          null
        );

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.guardando = false;
        if (res?.success) {
          const fueAlta = !this.editandoTramite;
          const tramiteGuardado = res.tramite || null;
          this.cargarEmpresaIdsConTramites();
          if (this.modo === 'control-tramites') {
            this.controlTramitesPanel?.cargarLista();
          } else {
            this.cargarTramites();
          }
          this.marcarCambiosPendientesSpF28();

          if (fueAlta && tramiteGuardado?.tramite_id) {
            this.editandoTramite = tramiteGuardado;
            this.formTramite = {
              item: tramiteGuardado.item,
              oficio: tramiteGuardado.oficio || this.formTramite.oficio,
              accion_realizar: tramiteGuardado.accion_realizar || '',
              responsable: tramiteGuardado.responsable || 'Biznaga',
              fecha_vencimiento: tramiteGuardado.fecha_vencimiento || '',
              clasificacion: tramiteGuardado.clasificacion || this.formTramite.clasificacion || '',
              estatus: tramiteGuardado.estatus === 'cerrado' ? 'cerrado' : 'abierto',
              observaciones: tramiteGuardado.observaciones || ''
            };
            this.mostrarContestacionTramite = true;
            this.finalizarAltaTramiteConArchivos();
            return;
          }

          if (this.tramiteArchivosPanels?.some(panel => panel.hayPendientes)) {
            this.finalizarAltaTramiteConArchivos();
            return;
          }

          this.cerrarModalTramite();
          Swal.fire({
            icon: 'success',
            title: 'Guardado',
            timer: 1400,
            showConfirmButton: false,
            confirmButtonColor: '#38512F'
          });
        }
      },
      error: (err) => {
        this.guardando = false;
        const msg = err?.error?.message || 'No se pudo guardar el trámite.';
        const detalle = err?.status === 409
          ? `${msg} Revisa la tabla ambiental_control_tramites (el ítem debe ser único).`
          : msg;
        Swal.fire('Error', detalle, 'error');
      }
    });
  }

  private finalizarAltaTramiteConArchivos(): void {
    this.guardando = true;
    setTimeout(async () => {
      const paneles = this.tramiteArchivosPanels?.toArray() || [];
      const hayArchivosPendientes = paneles.some(panel => panel.hayPendientes);
      const resultados = await Promise.all(paneles.map(panel => panel.subirPendientes()));
      this.guardando = false;

      if (resultados.every(Boolean)) {
        this.cerrarModalTramite();
        Swal.fire({
          icon: 'success',
          title: 'Trámite guardado',
          text: hayArchivosPendientes
            ? 'El trámite y su documentación se guardaron correctamente.'
            : 'El trámite se guardó correctamente.',
          timer: 1800,
          showConfirmButton: false,
          confirmButtonColor: '#38512F'
        });
      } else {
        Swal.fire({
          icon: 'warning',
          title: 'Trámite creado',
          text: 'No se pudieron cargar todos los archivos. Revísalos y vuelve a guardar.',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  desactivarTramiteModal(): void {
    if (!this.editandoTramite || this.guardando || this.eliminandoTramite) return;

    const tramite = this.editandoTramite;
    const nombre = this.nombreEmpresaTramite(tramite);
    const oficio = tramite.oficio || `Ítem ${tramite.item}`;

    Swal.fire({
      title: '¿Eliminar trámite?',
      html: `Se eliminará el trámite <strong>${oficio}</strong> de <strong>${nombre}</strong>.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c0392b',
      cancelButtonColor: '#6b7280'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.eliminandoTramite = true;
      this.backend.eliminarAmbientalTramite(tramite.tramite_id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.eliminandoTramite = false;
            this.cerrarModalTramite();
            this.cargarEmpresaIdsConTramites();
            if (this.modo === 'control-tramites') {
              this.controlTramitesPanel?.cargarLista();
            } else {
              this.cargarTramites();
            }
            this.marcarCambiosPendientesSpF28();
            Swal.fire({
              title: 'Trámite eliminado',
              text: 'El registro ya no aparece en el listado.',
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2200,
              showConfirmButton: false
            });
          },
          error: () => {
            this.eliminandoTramite = false;
            Swal.fire('Error', 'No se pudo eliminar el trámite.', 'error');
          }
        });
    });
  }

  esVencido(tramite: TramiteAmbiental): boolean {
    if (!tramite.fecha_vencimiento || tramite.estatus === 'cerrado') return false;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fv = new Date(tramite.fecha_vencimiento + 'T00:00:00');
    return fv < hoy;
  }

  formatearFecha(fecha: string | null): string {
    if (!fecha) return '—';
    return this.formatearFechaDocumento(fecha);
  }

  formatearFechaDocumento(fecha: string | null): string {
    if (!fecha) return '—';
    const s = fecha.slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  formatearUltimaSync(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('es-MX', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Mexico_City'
      });
    } catch {
      return iso;
    }
  }

  /** Fecha de hoy (YYYY-MM-DD) en horario de México. */
  private fechaHoyMexicoIso(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  }
}
