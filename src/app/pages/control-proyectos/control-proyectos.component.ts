import { Component, ElementRef, HostBinding, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { EChartsOption } from 'echarts';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';

type VistaControlProyectos = 'dashboard' | 'gestion' | 'tablero' | 'cronograma' | 'actividades' | 'eliminados';
type ColumnaTableroId = 'por-hacer' | 'en-curso' | 'revision' | 'listo';
type EscalaCronograma = 'semanas' | 'meses' | 'trimestres';

interface MenuOpcion {
  id: VistaControlProyectos;
  label: string;
  icon: string;
  soloRoot?: boolean;
}

interface ProyectoEliminadoGrupo {
  clave: string;
  empresaId?: number | null;
  empresaNombre?: string;
  folio: string;
  nombreProyecto: string;
  totalActividades: number;
  eliminadoPor?: string | null;
  eliminadoEn?: string | null;
  actividades: ProyectoTableroItem[];
  expandido?: boolean;
}

interface KpiCard {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
}

interface CargaEquipoItem {
  responsable: string;
  total: number;
  maxProyectos: number;
  avancePromedio: number;
}

interface ProgresoActividadesItem {
  responsable: string;
  totalActividades: number;
  concluidas: number;
  avancePromedio: number;
}

interface ProyectoTableroItem {
  id?: number;
  empresaId?: number | null;
  empresaNombre?: string;
  folio: string;
  nombreProyecto: string;
  item?: string;
  condicionRequerimiento?: string;
  actividadesAccion?: string;
  referenciaNormativa?: string;
  responsable: string;
  /** IDs de usuario (trabajador) asociados a los responsables — ownership infalible. */
  responsableUsuarioIds?: number[];
  fechaInicio?: string;
  fechaCompromiso?: string;
  entregables?: string;
  prioridad: string;
  estatus: string;
  avance: number;
  activo?: boolean;
  modificadoPor?: string | null;
  modificadoEn?: string | null;
  eliminadoPor?: string | null;
  eliminadoEn?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface FormRegistroProyecto {
  empresaId: number | null;
  empresaNombre: string;
  nombreProyecto: string;
  folio: string;
  item: string;
  condicionRequerimiento: string;
  actividadesAccion: string;
  referenciaNormativa: string;
  responsable: string;
  responsableUsuarioId: number | null;
  fechaInicio: string;
  fechaCompromiso: string;
  avance: number;
  entregables: string;
  prioridad: string;
  estatus: string;
}

interface UsuarioInternoControl {
  id: number;
  nombre: string;
  apellido: string;
  nombreCompleto: string;
}

interface ProyectoCronogramaItem extends Omit<ProyectoTableroItem, 'fechaInicio'> {
  fechaInicio: Date;
  fechaFin: Date;
}

interface PeriodoCronograma {
  label: string;
  anchoPx: number;
}

interface ActividadResponsableItem {
  clave: string;
  proyectoId?: number;
  proyectoNombre: string;
  folio: string;
  actividad: string;
  numero: number;
  totalEnProyecto: number;
  condicionRequerimiento: string;
  fechaInicio: string;
  fechaCompromiso: string;
  prioridad: string;
  estatus: 'concluida' | 'en-curso' | 'pendiente';
}

interface GrupoActividadesProyecto {
  folio: string;
  proyectoNombre: string;
  actividades: ActividadResponsableItem[];
}

interface ActividadTablaFila {
  actividad: ProyectoTableroItem;
  mostrarProyecto: boolean;
  rowspan: number;
  indiceOriginal: number;
}

interface ColumnaTablero {
  id: ColumnaTableroId;
  titulo: string;
  estatuses: string[];
}

interface EmpresaControlProyecto {
  empresaId: number;
  nombreEmpresa: string;
}

interface PizarronNota {
  id: string;
  texto: string;
  autor: string;
  color: string;
  createdAt: string;
}

interface GrupoProyectoBacklog {
  clave: string;
  folio: string;
  nombreProyecto: string;
  prioridad: string;
  actividades: ProyectoTableroItem[];
}

interface GrupoGestionProyecto {
  clave: string;
  folio: string;
  nombreProyecto: string;
  empresaNombre: string;
  actividades: Array<{ proyecto: ProyectoTableroItem; indice: number }>;
}

@Component({
  selector: 'app-control-proyectos',
  templateUrl: './control-proyectos.component.html',
  styleUrls: ['./control-proyectos.component.scss']
})
export class ControlProyectosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @ViewChild('timelineScroll') timelineScroll?: ElementRef<HTMLDivElement>;

  @HostBinding('class.cp-modal-open') get modalRegistroAbierto(): boolean {
    return this.mostrarRegistro;
  }

  readonly menuOpciones: MenuOpcion[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
    { id: 'gestion', label: 'Gestión', icon: 'fa-edit' },
    { id: 'tablero', label: 'Tablero', icon: 'fa-columns' },
    { id: 'cronograma', label: 'Cronograma', icon: 'fa-stream' },
    { id: 'actividades', label: 'Actividades', icon: 'fa-list' },
    { id: 'eliminados', label: 'Eliminados', icon: 'fa-trash-restore', soloRoot: true }
  ];

  readonly escalasCronograma: { id: EscalaCronograma; label: string }[] = [
    { id: 'semanas', label: 'Semanas' },
    { id: 'meses', label: 'Meses' },
    { id: 'trimestres', label: 'Trimestres' }
  ];

  readonly columnasTablero: ColumnaTablero[] = [
    { id: 'por-hacer', titulo: 'No Iniciado', estatuses: ['No iniciado', ''] },
    { id: 'en-curso', titulo: 'En curso', estatuses: ['En proceso'] },
    { id: 'revision', titulo: 'En revisión', estatuses: ['En revisión'] },
    { id: 'listo', titulo: 'Listo', estatuses: ['Concluido'] }
  ];

  readonly opcionesEstatusActividadGestion = [
    { value: 'No iniciado', label: 'No iniciado', icon: 'fa-circle', tone: 'todo' },
    { value: 'En proceso', label: 'En curso', icon: 'fa-play-circle', tone: 'progress' },
    { value: 'En revisión', label: 'En revisión', icon: 'fa-search', tone: 'review' },
    { value: 'Concluido', label: 'Listo', icon: 'fa-check-circle', tone: 'done' }
  ];

  private readonly RESPONSABLE_SEP = ' | ';
  readonly MAX_AVATARES_VISIBLES = 3;

  vistaActiva: VistaControlProyectos = 'dashboard';
  cargando = true;
  errorCarga = false;

  kpis: KpiCard[] = [];
  cargaEquipo: CargaEquipoItem[] = [];
  cargaEquipoEnriquecida: Array<CargaEquipoItem & {
    anchoConcluidos: number;
    anchoEnCurso: number;
    anchoPendientes: number;
    concluidos: number;
    enCurso: number;
    pendientes: number;
  }> = [];
  progresoActividades: ProgresoActividadesItem[] = [];
  proyectos: ProyectoTableroItem[] = [];
  proyectosResumen: any[] = [];
  proyectosCronograma: ProyectoCronogramaItem[] = [];
  responsablesTablero: string[] = [];
  empresasControl: EmpresaControlProyecto[] = [];
  empresaSeleccionadaId: number | null = null;
  empresaDashboardBusqueda = '';
  empresaDashboardDropdownAbierto = false;
  actividadesDashboardPagina = 1;
  readonly actividadesDashboardTamanoPagina = 6;
  proyectosActivosPagina = 1;
  readonly proyectosActivosTamanoPagina = 4;

  busquedaTablero = '';
  busquedaCronograma = '';
  busquedaActividades = '';
  busquedaBacklog = '';
  busquedaGestion = '';
  busquedaActividadesGestion = '';
  busquedaEliminados = '';
  filtroPrioridadActividadesGestion = '';
  ordenVencimientoActividadesGestion: '' | 'proxima' | 'lejana' = '';
  busquedaProyectoDashboard = '';
  filtroResponsable = '';
  filtroPrioridadDashboard = '';
  filtroEstatusActividades = '';
  filtroEstatusCronograma = '';
  escalaCronograma: EscalaCronograma = 'meses';

  proyectosEliminados: ProyectoEliminadoGrupo[] = [];
  cargandoEliminados = false;
  errorEliminados = '';
  restaurandoEliminados = false;
  mensajeEliminados = '';
  eliminadosProyectoExpandido: string | null = null;

  pizarronNotas: PizarronNota[] = [];
  pizarronTextoNuevo = '';
  pizarronAutorNuevo = '';
  guardandoPizarron = false;
  readonly pizarronColores = ['#fef08a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fed7aa', '#ddd6fe'];

  readonly CARRUSEL_DASH_INTERVALO_MS = 8000;
  readonly CARRUSEL_DASH_TICK_MS = 100;
  private carruselDashTimer: ReturnType<typeof setInterval> | null = null;
  private carruselDashElapsedMs = 0;
  carruselDashHover = false;
  carruselDashAutoActivo = true;
  carruselDashProgresoPct = 0;
  carruselDashSegundosRestantes = 8;
  actualizandoEstatusBacklog = false;
  backlogMenuAbiertoClave: string | null = null;
  gestionAgrupadaLista: GrupoGestionProyecto[] = [];
  gestionProyectoSeleccionadoClave: string | null = null;
  /** Catálogo de proyectos → detalle de actividades (drill-down). */
  gestionNivelVista: 'proyectos' | 'actividades' = 'proyectos';
  gestionActividadExpandidaIndice: number | null = null;
  gestionActPagina = 1;
  readonly gestionActTamanoPagina = 25;
  guardandoActividadGestion = false;
  menuAgregarActividadAbierto = false;
  menuPrioridadGestionIndice: number | null = null;
  menuPrioridadGestionStyle: { top: string; left: string } | null = null;
  menuEstatusGestionIndice: number | null = null;
  menuEstatusGestionStyle: { top: string; left: string } | null = null;
  menuResponsablesGestionIndice: number | null = null;
  menuResponsablesGestionStyle: { top: string; left: string } | null = null;
  busquedaResponsablesGestion = '';
  backlogAgrupadoLista: GrupoProyectoBacklog[] = [];
  usuariosInternos: UsuarioInternoControl[] = [];
  usuariosInternosNombres: string[] = [];
  registroEmpresaBusqueda = '';
  registroResponsableBusqueda = '';
  registroEmpresaDropdownAbierto = false;
  registroResponsableDropdownAbierto = false;
  proyectoDashboardSeleccionadoClave: string | null = null;
  avancePromedioPortfolio = 0;
  resumenAvanceTarjetas: Array<{
    label: string;
    valor: number;
    total: number;
    detalle: string;
    color: string;
    key: string;
    mostrarTotal?: boolean;
  }> = [];
  private portfolioResumenAvanceTarjetas: Array<{
    label: string;
    valor: number;
    total: number;
    detalle: string;
    color: string;
    key: string;
    mostrarTotal?: boolean;
  }> = [];
  private portfolioEstatusDistribucion: Array<{ etiqueta: string; total: number; color: string; key: string; pct: number; alturaPct: number; icono: string }> = [];
  prioridadDistribucionChartOption: EChartsOption = {};

  selectedActividades = new Set<string>();
  backlogSeccionColapsada = { sprint: false, pendientes: false };

  mostrarRegistro = false;
  guardandoRegistro = false;
  errorRegistro = '';
  registroModo: 'crear' | 'editar' = 'crear';
  registroEditarIndice: number | null = null;
  registroEditarGrupo: GrupoGestionProyecto | null = null;
  formRegistro: FormRegistroProyecto = this.formRegistroVacio();

  proyectosGestion: ProyectoTableroItem[] = [];
  gestionCambiosPendientes = false;
  guardandoGestion = false;
  sincronizandoDrive = false;
  errorGestion = '';

  readonly estatusRegistro = ['No iniciado', 'En proceso', 'En revisión', 'Concluido'];
  readonly estatusDashboard = ['Concluido', 'En revisión', 'En proceso', 'No iniciado'];

  readonly opcionesPrioridadRegistro = [
    { value: 'Muy Prioritaria', shortLabel: 'Muy prioritaria', hint: 'Crítica', icon: 'fa-angle-double-up', tone: 'critical' },
    { value: 'Prioritaria', shortLabel: 'Prioritaria', hint: 'Alta', icon: 'fa-arrow-up', tone: 'high' },
    { value: 'Media', shortLabel: 'Media', hint: 'Estándar', icon: 'fa-equals', tone: 'medium' },
    { value: 'Baja', shortLabel: 'Baja', hint: 'Flexible', icon: 'fa-arrow-down', tone: 'low' },
    { value: 'Muy baja', shortLabel: 'Muy baja', hint: 'Mínima', icon: 'fa-angle-double-down', tone: 'lowest' }
  ];

  readonly opcionesEstatusRegistro = [
    { value: 'No iniciado', shortLabel: 'No iniciado', hint: 'Pendiente', icon: 'fa-circle', tone: 'todo' },
    { value: 'En proceso', shortLabel: 'En proceso', hint: 'Activo', icon: 'fa-play-circle', tone: 'progress' },
    { value: 'En revisión', shortLabel: 'En revisión', hint: 'Revisión', icon: 'fa-search', tone: 'review' },
    { value: 'Concluido', shortLabel: 'Concluido', hint: 'Cerrado', icon: 'fa-check-circle', tone: 'done' }
  ];

  readonly prioridadesRegistro = ['Muy Prioritaria', 'Prioritaria', 'Media', 'Baja', 'Muy baja', 'Ninguna'];

  graficoDashboardIndice = 0;
  readonly slidesGraficosDashboard: Array<{ id: 'estado' | 'prioridad'; titulo: string; icon: string; iconMod: string }> = [
    { id: 'estado', titulo: 'Distribución por estatus', icon: 'fa-chart-pie', iconMod: 'estado' },
    { id: 'prioridad', titulo: 'Despliegue de prioridad', icon: 'fa-flag', iconMod: 'prioridad' }
  ];

  periodosTimeline: PeriodoCronograma[] = [];
  timelineAnchoTotal = 0;
  posicionHoyPx = 0;
  rangoCronogramaInicio = new Date();
  rangoCronogramaFin = new Date();

  prioridadDistribucion: Array<{ etiqueta: string; total: number; color: string; pct: number; alturaPct: number }> = [];
  prioridadDistribucionVista: Array<{ etiqueta: string; total: number; color: string; pct: number }> = [];
  totalPrioridadVista = 0;
  estatusDistribucion: Array<{ etiqueta: string; total: number; color: string; key: string; pct: number; alturaPct: number; icono: string }> = [];
  totalEstatusVista = 0;

  dashboardIntroActiva = false;
  private dashboardIntroMostrado = false;

  estadoChartOption: EChartsOption = {};
  prioridadChartOption: EChartsOption = {};

  readonly coloresPrioridadSistema: Record<string, string> = {
    'Muy Prioritaria': '#dc2626',
    Prioritaria: '#ea580c',
    Media: '#d97706',
    Baja: '#2563eb',
    'Muy baja': '#7c3aed',
    Ninguna: '#64748b'
  };

  private readonly coloresEstatusSuaves: Record<string, string> = {
    concluido: '#10b981',
    'en revision': '#a855f7',
    'en revisión': '#a855f7',
    'en proceso': '#3b82f6',
    'no iniciado': '#f59e0b'
  };

  constructor(
    private backend: BackendServices,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.cargarEmpresasControl();
    this.cargarUsuariosInternos();
    this.cargarDashboard();
    this.cargarPizarron();
    this.iniciarCarruselDashboard();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.backlogMenuAbiertoClave = null;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    this.cerrarMenuResponsablesGestion();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    this.cerrarMenuResponsablesGestion();
    this.actualizarChartEstado();
    this.actualizarChartPrioridadDistribucion();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.menuPrioridadGestionIndice !== null) {
      this.cerrarMenuPrioridadGestion();
    }
    if (this.menuEstatusGestionIndice !== null) {
      this.cerrarMenuEstatusGestion();
    }
    if (this.menuResponsablesGestionIndice !== null) {
      this.cerrarMenuResponsablesGestion();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.empresaDashboardDropdownAbierto && !target?.closest('.cp-company-combo')) {
      this.cerrarDropdownEmpresaDashboard();
    }
    if (!this.registroEmpresaDropdownAbierto && !this.registroResponsableDropdownAbierto) {
      return;
    }
    if (target?.closest('.cp-registro-combobox')) {
      return;
    }
    this.cerrarComboboxesRegistro();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onDocumentEscape(event: KeyboardEvent): void {
    if (this.empresaDashboardDropdownAbierto) {
      event.preventDefault();
      event.stopPropagation();
      this.cerrarDropdownEmpresaDashboard();
      return;
    }
    if (!this.registroEmpresaDropdownAbierto && !this.registroResponsableDropdownAbierto) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cerrarComboboxesRegistro(true);
  }

  ngOnDestroy(): void {
    this.autoGuardarGestionSiPendiente();
    this.gestionComponenteDestruido = true;
    this.detenerCarruselDashboard();
    this.destroy$.next();
    this.destroy$.complete();
  }

  seleccionarVista(vista: VistaControlProyectos): void {
    if (vista === 'eliminados' && !this.esSuperAdministrador) {
      return;
    }

    if (this.vistaActiva === 'gestion' && vista !== 'gestion') {
      this.autoGuardarGestionSiPendiente();
    }

    const yaEstabaEnGestion = this.vistaActiva === 'gestion';
    this.vistaActiva = vista;

    if (vista === 'gestion') {
      // Evita refrescar si ya estás en Gestión o hay ediciones en curso (rompe la tabla).
      if (!yaEstabaEnGestion && !this.gestionCambiosPendientes) {
        this.refrescarDesdeBd();
      } else if (!this.proyectosGestion.length) {
        this.sincronizarGestionDesdeProyectos();
      }
      if (!this.gestionProyectoSeleccionadoClave) {
        this.gestionNivelVista = 'proyectos';
      }
    }
    if (vista === 'cronograma') {
      setTimeout(() => this.irAHoy(), 80);
    }
    if (vista === 'eliminados') {
      this.cargarEliminados();
    }
  }

  private autoGuardarGestionSiPendiente(): void {
    if (!this.gestionCambiosPendientes || this.guardandoGestion) return;
    this.guardarGestion(true);
  }

  private gestionComponenteDestruido = false;

  private cargarEmpresasControl(): void {
    this.backend.obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const lista = Array.isArray(res?.empresas) ? res.empresas : Array.isArray(res) ? res : [];
          this.empresasControl = lista
            .map((e: any) => ({
              empresaId: Number(e?.empresa_id || e?.empresaId || 0),
              nombreEmpresa: String(e?.nombre_empresa || e?.nombreEmpresa || e?.nombre || '').trim()
            }))
            .filter((e: EmpresaControlProyecto) => e.empresaId > 0 && !!e.nombreEmpresa)
            .sort((a: EmpresaControlProyecto, b: EmpresaControlProyecto) => a.nombreEmpresa.localeCompare(b.nombreEmpresa, 'es'));
          this.sincronizarBusquedaEmpresaDashboard();
        },
        error: () => {
          this.empresasControl = [];
          this.sincronizarBusquedaEmpresaDashboard();
        }
      });
  }

  cambiarEscalaCronograma(escala: EscalaCronograma): void {
    this.escalaCronograma = escala;
    this.calcularRangoYPeriodos();
    setTimeout(() => this.irAHoy(), 50);
  }

  irAHoy(): void {
    const el = this.timelineScroll?.nativeElement;
    if (!el) return;
    el.scrollLeft = Math.max(0, this.posicionHoyPx - el.clientWidth / 2);
  }

  estiloBarraCronograma(item: ProyectoCronogramaItem): { left: string; width: string } {
    const totalMs = this.rangoCronogramaFin.getTime() - this.rangoCronogramaInicio.getTime();
    if (totalMs <= 0 || this.timelineAnchoTotal <= 0) {
      return { left: '0px', width: '0px' };
    }
    const inicioMs = item.fechaInicio.getTime() - this.rangoCronogramaInicio.getTime();
    const duracionMs = Math.max(item.fechaFin.getTime() - item.fechaInicio.getTime(), 86400000);
    const leftPx = (inicioMs / totalMs) * this.timelineAnchoTotal;
    const widthPx = Math.max((duracionMs / totalMs) * this.timelineAnchoTotal, 28);
    return {
      left: `${Math.max(0, leftPx)}px`,
      width: `${widthPx}px`
    };
  }

  get proyectosCronogramaVisibles(): ProyectoCronogramaItem[] {
    const q = this.normalizar(this.busquedaCronograma);
    const responsable = this.normalizar(this.filtroResponsable);
    const estatusFiltro = this.normalizar(this.filtroEstatusCronograma);

    return this.proyectosCronograma.filter((p) => {
      if (estatusFiltro) {
        const estatus = this.normalizar(p.estatus || 'No iniciado');
        if (estatusFiltro === 'no iniciado' && estatus && estatus !== 'no iniciado') return false;
        if (estatusFiltro !== 'no iniciado' && estatus !== estatusFiltro) return false;
      }
      if (responsable) {
        if (!this.coincideFiltroResponsable(p, responsable)) return false;
      }
      if (!q) return true;
      return [p.folio, p.nombreProyecto, p.actividadesAccion, p.responsable, p.prioridad, p.estatus]
        .some((campo) => this.normalizar(campo).includes(q));
    });
  }

  nombreActividad(item: ProyectoTableroItem): string {
    return String(item.actividadesAccion || item.condicionRequerimiento || item.nombreProyecto || 'Actividad sin detalle').trim();
  }

  private cargarUsuariosInternos(): void {
    this.backend.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const lista = Array.isArray(res?.usuarios) ? res.usuarios : [];
          this.usuariosInternos = lista
            .filter((u: any) => {
              const rol = this.normalizar(String(u?.rol || u?.rol_nombre || ''));
              return rol !== 'empresa' && rol !== 'usuario empresa';
            })
            .map((u: any) => this.mapearUsuarioInterno(u))
            .filter((u: UsuarioInternoControl | null): u is UsuarioInternoControl => !!u && u.id > 0 && !!u.nombreCompleto)
            .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
          this.usuariosInternosNombres = this.usuariosInternos.map((u) => u.nombreCompleto);
          this.enriquecerResponsableIdsProyectos();
        },
        error: () => {
          this.usuariosInternos = [];
          this.usuariosInternosNombres = [];
        }
      });
  }

  /** Completa IDs de responsable en proyectos ya cargados (datos legacy sin ID). */
  private enriquecerResponsableIdsProyectos(): void {
    if (!this.usuariosInternos.length) return;
    const enriquecer = (lista: ProyectoTableroItem[]) => {
      for (const p of lista) {
        if (!p) continue;
        const actuales = this.parseResponsableUsuarioIds(p.responsableUsuarioIds);
        if (actuales.length) continue;
        const resueltos = this.resolverUsuarioIdsPorResponsables(p.responsable || '');
        if (resueltos.length) p.responsableUsuarioIds = resueltos;
      }
    };
    enriquecer(this.proyectos);
    enriquecer(this.proyectosGestion);
  }

  private mapearUsuarioInterno(u: any): UsuarioInternoControl | null {
    const id = Number(u?.id || u?.usuario_id || 0);
    if (!Number.isInteger(id) || id <= 0) return null;
    const nombre = String(u?.nombre || '').trim();
    const apellido = String(
      u?.apellido_paterno || u?.apellido || ''
    ).trim();
    const apellidoMaterno = String(u?.apellido_materno || '').trim();
    const partes = [nombre, apellido, apellidoMaterno].filter(Boolean);
    const nombreCompleto = partes.length
      ? partes.join(' ')
      : String(u?.username || '').trim();
    if (!nombreCompleto) return null;
    return { id, nombre, apellido, nombreCompleto };
  }

  private nombreCompletoUsuario(u: any): string {
    return this.mapearUsuarioInterno(u)?.nombreCompleto || String(u?.username || '').trim();
  }

  private reconstruirGestionVista(): void {
    const q = this.normalizar(this.busquedaGestion);
    const visibles = !q
      ? this.proyectosGestion.map((proyecto, indice) => ({ proyecto, indice }))
      : this.proyectosGestion
        .map((proyecto, indice) => ({ proyecto, indice }))
        .filter(({ proyecto }) =>
          [
            proyecto.folio,
            proyecto.nombreProyecto,
            proyecto.item,
            proyecto.condicionRequerimiento,
            proyecto.actividadesAccion,
            proyecto.referenciaNormativa,
            proyecto.responsable,
            proyecto.entregables,
            proyecto.prioridad,
            proyecto.estatus
          ].some((campo) => this.normalizar(campo).includes(q))
        );

    const grupos = new Map<string, GrupoGestionProyecto>();
    for (const { proyecto, indice } of visibles) {
      const clave = `${proyecto.empresaId || 'sin-empresa'}|${this.normalizar(proyecto.folio || proyecto.nombreProyecto || `idx-${indice}`)}`;
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          clave,
          folio: proyecto.folio || '',
          nombreProyecto: proyecto.nombreProyecto || 'Proyecto sin nombre',
          empresaNombre: proyecto.empresaNombre || '',
          actividades: []
        });
      }
      grupos.get(clave)!.actividades.push({ proyecto, indice });
    }
    this.gestionAgrupadaLista = Array.from(grupos.values());
    this.asegurarSeleccionProyectoGestion();
  }

  seleccionarProyectoGestion(clave: string): void {
    this.gestionProyectoSeleccionadoClave = clave;
    this.gestionNivelVista = 'actividades';
    this.gestionActividadExpandidaIndice = null;
    this.gestionActPagina = 1;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    this.limpiarFiltrosActividadesGestion();
  }

  volverAListaProyectosGestion(): void {
    this.gestionNivelVista = 'proyectos';
    this.gestionProyectoSeleccionadoClave = null;
    this.gestionActividadExpandidaIndice = null;
    this.gestionActPagina = 1;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    this.limpiarFiltrosActividadesGestion();
  }

  get grupoGestionSeleccionado(): GrupoGestionProyecto | null {
    if (!this.gestionProyectoSeleccionadoClave) return null;
    return this.gestionAgrupadaLista.find((g) => g.clave === this.gestionProyectoSeleccionadoClave) || null;
  }

  limpiarFiltrosActividadesGestion(): void {
    this.busquedaActividadesGestion = '';
    this.filtroPrioridadActividadesGestion = '';
    this.ordenVencimientoActividadesGestion = '';
    this.gestionActPagina = 1;
  }

  get hayFiltrosActividadesGestion(): boolean {
    return !!(
      this.busquedaActividadesGestion
      || this.filtroPrioridadActividadesGestion
      || this.ordenVencimientoActividadesGestion
    );
  }

  actividadesGestionFiltradas(
    grupo: GrupoGestionProyecto | null
  ): Array<{ proyecto: ProyectoTableroItem; indice: number }> {
    if (!grupo?.actividades?.length) return [];

    const q = this.normalizar(this.busquedaActividadesGestion);
    const prioridadFiltro = this.normalizarPrioridad(this.filtroPrioridadActividadesGestion);

    let lista = grupo.actividades.filter(({ proyecto }) => {
      if (q && !this.normalizar(proyecto.actividadesAccion || proyecto.condicionRequerimiento || '').includes(q)) {
        return false;
      }
      if (prioridadFiltro && this.normalizarPrioridad(proyecto.prioridad) !== prioridadFiltro) {
        return false;
      }
      return true;
    });

    if (this.ordenVencimientoActividadesGestion === 'proxima') {
      lista = [...lista].sort((a, b) => this.ordenFechaVencimientoAsc(a.proyecto) - this.ordenFechaVencimientoAsc(b.proyecto));
    } else if (this.ordenVencimientoActividadesGestion === 'lejana') {
      lista = [...lista].sort((a, b) => this.ordenFechaVencimientoAsc(b.proyecto) - this.ordenFechaVencimientoAsc(a.proyecto));
    }

    return lista;
  }

  actividadesGestionPaginadas(
    grupo: GrupoGestionProyecto | null
  ): Array<{ proyecto: ProyectoTableroItem; indice: number }> {
    const lista = this.actividadesGestionFiltradas(grupo);
    const totalPaginas = Math.max(1, Math.ceil(lista.length / this.gestionActTamanoPagina));
    const pagina = Math.min(totalPaginas, Math.max(1, this.gestionActPagina));
    const inicio = (pagina - 1) * this.gestionActTamanoPagina;
    return lista.slice(inicio, inicio + this.gestionActTamanoPagina);
  }

  totalPaginasActividadesGestion(grupo: GrupoGestionProyecto | null): number {
    const total = this.actividadesGestionFiltradas(grupo).length;
    return Math.max(1, Math.ceil(total / this.gestionActTamanoPagina));
  }

  cambiarPaginaActividadesGestion(delta: number, grupo: GrupoGestionProyecto | null): void {
    const max = this.totalPaginasActividadesGestion(grupo);
    this.gestionActPagina = Math.min(max, Math.max(1, this.gestionActPagina + delta));
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
  }

  onFiltroActividadesGestionChange(): void {
    this.gestionActPagina = 1;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
  }

  toggleExpandirActividadGestion(indice: number): void {
    this.gestionActividadExpandidaIndice =
      this.gestionActividadExpandidaIndice === indice ? null : indice;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
  }

  actividadGestionExpandida(indice: number): boolean {
    return this.gestionActividadExpandidaIndice === indice;
  }

  statsGrupoGestion(grupo: GrupoGestionProyecto): {
    total: number;
    concluidas: number;
    vencidas: number;
    avance: number;
  } {
    const actividades = grupo?.actividades || [];
    const total = actividades.length;
    let concluidas = 0;
    let vencidas = 0;
    let sumaAvance = 0;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    for (const { proyecto } of actividades) {
      const avance = Number(proyecto.avance || 0);
      sumaAvance += avance;
      const est = this.normalizar(proyecto.estatus || '');
      if (est === 'concluido' || avance >= 100) {
        concluidas += 1;
        continue;
      }
      const fecha = this.parsearFechaIso(proyecto.fechaCompromiso);
      if (fecha) {
        const f = new Date(fecha);
        f.setHours(0, 0, 0, 0);
        if (f.getTime() < hoy.getTime()) vencidas += 1;
      }
    }

    return {
      total,
      concluidas,
      vencidas,
      avance: total ? Math.round(sumaAvance / total) : 0
    };
  }

  private ordenFechaVencimientoAsc(proyecto: ProyectoTableroItem): number {
    const fecha = this.parsearFechaIso(proyecto.fechaCompromiso);
    if (!fecha) return Number.MAX_SAFE_INTEGER;
    return fecha.getTime();
  }

  numeroActividadGestion(
    grupo: GrupoGestionProyecto | null,
    item: { proyecto: ProyectoTableroItem; indice: number }
  ): number {
    if (!grupo?.actividades?.length) return 1;
    const pos = grupo.actividades.findIndex((a) => a.indice === item.indice);
    return pos >= 0 ? pos + 1 : 1;
  }

  resumenGrupoGestion(grupo: GrupoGestionProyecto): {
    responsable: string;
    fechaCompromiso: string;
    prioridad: string;
    estatus: string;
    avance: number;
  } {
    const base = grupo?.actividades?.[0]?.proyecto;
    return {
      responsable: this.responsablePrincipal(base) || 'Sin responsable',
      fechaCompromiso: base?.fechaCompromiso || '',
      prioridad: base?.prioridad || '',
      estatus: base?.estatus || 'No iniciado',
      avance: Number(base?.avance || 0)
    };
  }

  iconoPrioridadGestion(prioridad: string): string {
    return this.prioridadIcono(prioridad);
  }

  iconoEstatusGestion(estatus: string): string {
    const n = this.normalizar(estatus);
    if (n === 'concluido') return 'fa-check-circle';
    if (n === 'en revision' || n === 'en revisión') return 'fa-search';
    if (n === 'en proceso') return 'fa-play-circle';
    return 'fa-circle';
  }

  etiquetaEstatusActividadGestion(estatus: string): string {
    const found = this.opcionesEstatusActividadGestion.find(
      (es) => this.normalizar(es.value) === this.normalizar(estatus)
    );
    return found?.label || estatus || 'No iniciado';
  }

  toneEstatusActividadGestion(estatus: string): string {
    const found = this.opcionesEstatusActividadGestion.find(
      (es) => this.normalizar(es.value) === this.normalizar(estatus)
    );
    return found?.tone || 'todo';
  }

  /**
   * Indicador de proximidad a vencimiento:
   * crítico ≤5, urgente ≤15, próximo ≤30, en plazo >30.
   */
  indicadorVencimientoActividad(proyecto: ProyectoTableroItem): {
    key: 'critico' | 'urgente' | 'proximo' | 'plazo' | 'sin-fecha';
    label: string;
    icono: string;
    dias: number | null;
    titulo: string;
  } {
    const fecha = this.parsearFechaIso(proyecto?.fechaCompromiso);
    if (!fecha) {
      return {
        key: 'sin-fecha',
        label: 'Sin fecha',
        icono: 'fa-calendar-times',
        dias: null,
        titulo: 'Sin fecha de compromiso'
      };
    }
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(fecha);
    f.setHours(0, 0, 0, 0);
    const dias = Math.round((f.getTime() - hoy.getTime()) / 86400000);
    const est = this.normalizar(proyecto?.estatus || '');
    if (est === 'concluido') {
      return {
        key: 'plazo',
        label: 'Cerrada',
        icono: 'fa-check-circle',
        dias,
        titulo: dias < 0
          ? `Cerrada · venció hace ${Math.abs(dias)} día(s)`
          : `Cerrada · ${dias} día(s) respecto a la fecha`
      };
    }
    if (dias < 0) {
      return {
        key: 'critico',
        label: 'Vencida',
        icono: 'fa-exclamation-circle',
        dias,
        titulo: `Vencida · hace ${Math.abs(dias)} día(s)`
      };
    }
    if (dias <= 5) {
      return {
        key: 'critico',
        label: 'Crítico',
        icono: 'fa-exclamation-circle',
        dias,
        titulo: `Crítico · ${dias} día(s) restantes`
      };
    }
    if (dias <= 15) {
      return {
        key: 'urgente',
        label: 'Urgente',
        icono: 'fa-exclamation-triangle',
        dias,
        titulo: `Urgente · ${dias} día(s) restantes`
      };
    }
    if (dias <= 30) {
      return {
        key: 'proximo',
        label: 'Próximo',
        icono: 'fa-clock',
        dias,
        titulo: `Próximo · ${dias} día(s) restantes`
      };
    }
    return {
      key: 'plazo',
      label: 'En plazo',
      icono: 'fa-check-circle',
      dias,
      titulo: `En plazo · ${dias} día(s) restantes`
    };
  }

  private asegurarSeleccionProyectoGestion(): void {
    if (!this.gestionAgrupadaLista.length) {
      this.gestionProyectoSeleccionadoClave = null;
      this.gestionNivelVista = 'proyectos';
      return;
    }
    const existe = this.gestionAgrupadaLista.some((g) => g.clave === this.gestionProyectoSeleccionadoClave);
    if (!existe) {
      this.gestionProyectoSeleccionadoClave = null;
      this.gestionNivelVista = 'proyectos';
    }
  }

  private reconstruirBacklogAgrupado(): void {
    const grupos = new Map<string, GrupoProyectoBacklog>();
    for (const actividad of this.proyectosBacklogFiltrados) {
      const clave = `${actividad.empresaId || 'sin-empresa'}|${this.normalizar(actividad.folio || actividad.nombreProyecto || 'sin-proyecto')}`;
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          clave,
          folio: actividad.folio || '',
          nombreProyecto: actividad.nombreProyecto || 'Proyecto sin nombre',
          prioridad: actividad.prioridad || '',
          actividades: []
        });
      }
      grupos.get(clave)!.actividades.push(actividad);
    }

    for (const grupo of grupos.values()) {
      grupo.actividades.sort((a, b) => this.ordenFechaCompromiso(a) - this.ordenFechaCompromiso(b));
    }

    this.backlogAgrupadoLista = Array.from(grupos.values());
  }

  onBusquedaGestionChange(): void {
    this.reconstruirGestionVista();
  }

  onBusquedaBacklogChange(): void {
    this.reconstruirBacklogAgrupado();
  }

  trackByGrupoGestion(_index: number, grupo: GrupoGestionProyecto): string {
    return grupo.clave;
  }

  trackByGestionActividad(_index: number, item: { proyecto: ProyectoTableroItem; indice: number }): string {
    return `${item.indice}-${item.proyecto.id || item.proyecto.folio || _index}`;
  }

  trackByGrupoBacklog(_index: number, grupo: GrupoProyectoBacklog): string {
    return grupo.clave;
  }

  claveActividadBacklog(actividad: ProyectoTableroItem): string {
    return `${actividad.id || actividad.folio || 'p'}-${actividad.item || ''}-${this.normalizar(actividad.actividadesAccion || actividad.condicionRequerimiento || '')}`;
  }

  toggleBacklogMenu(event: Event, actividad: ProyectoTableroItem): void {
    event.stopPropagation();
    const clave = this.claveActividadBacklog(actividad);
    this.backlogMenuAbiertoClave = this.backlogMenuAbiertoClave === clave ? null : clave;
  }

  backlogMenuVisible(actividad: ProyectoTableroItem): boolean {
    return this.backlogMenuAbiertoClave === this.claveActividadBacklog(actividad);
  }

  puedeEditarEstatusBacklog(actividad: ProyectoTableroItem): boolean {
    return this.puedeEditarActividadGestion(actividad);
  }

  /** Administradores y root tienen permiso universal (todas las empresas / eliminados). */
  get tienePermisoUniversalGestion(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  /** ID del trabajador/usuario logueado (método infalible de ownership). */
  private idPerfilGestion(): number | null {
    const id = Number(this.auth.getUsuarioId() || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /** Nombre normalizado del perfil actual (vacío si no es usable). */
  private nombrePerfilNormalizado(): string {
    const yo = this.normalizar(this.nombrePerfilGestion);
    if (!yo || yo === 'usuario') return '';
    return yo;
  }

  private perfilNombreApellido(): { nombre: string; apellido: string; completo: string } {
    const u = this.auth.usuarioActualValue;
    const nombre = this.normalizar(String(u?.nombre || ''));
    const apellido = this.normalizar(String(u?.apellido_paterno || u?.apellido || ''));
    const completo = this.nombrePerfilNormalizado();
    return { nombre, apellido, completo };
  }

  /**
   * ¿El usuario actual figura como responsable/autor de esta actividad?
   * Prioridad: 1) ID trabajador, 2) nombre + apellido, 3) nombre completo exacto.
   */
  private usuarioEsResponsableDe(
    proyecto: { responsable?: string; responsableUsuarioIds?: number[] } | null | undefined
  ): boolean {
    if (!proyecto) return false;

    const miId = this.idPerfilGestion();
    const ids = this.parseResponsableUsuarioIds(proyecto.responsableUsuarioIds);
    if (miId && ids.includes(miId)) return true;

    const lista = this.parseResponsables(proyecto.responsable);
    if (!lista.length) return false;

    const perfil = this.perfilNombreApellido();
    if (!perfil.completo) return false;

    for (const responsable of lista) {
      if (this.coincideResponsableConPerfil(responsable, perfil, miId)) return true;
    }
    return false;
  }

  /** Dueño/autor del proyecto (responsable de cabecera). */
  esDuenoProyectoGestion(grupo: GrupoGestionProyecto | null | undefined): boolean {
    if (this.tienePermisoUniversalGestion) return true;
    if (this.auth.esUsuarioEmpresa()) return false;
    const base = grupo?.actividades?.[0]?.proyecto;
    if (!base) return false;
    return this.usuarioEsResponsableDe(base);
  }

  /**
   * Cualquier usuario interno puede gestionar proyectos y actividades.
   * Perfiles empresa: solo lectura.
   */
  puedeEditarProyectoGestion(_grupo?: GrupoGestionProyecto | null): boolean {
    return !this.auth.esUsuarioEmpresa();
  }

  /**
   * Cualquier usuario interno puede editar actividades de cualquier proyecto.
   */
  puedeEditarActividadGestion(
    _actividad?: ProyectoTableroItem | null,
    _grupo?: GrupoGestionProyecto | null
  ): boolean {
    return !this.auth.esUsuarioEmpresa();
  }

  /**
   * Solo el autor (responsable) de la actividad — o admin/root — puede eliminarla.
   */
  puedeEliminarActividadGestion(actividad: ProyectoTableroItem | null | undefined): boolean {
    if (this.auth.esUsuarioEmpresa()) return false;
    if (this.tienePermisoUniversalGestion || this.esSuperAdministrador) return true;
    if (!actividad) return false;
    // Actividad nueva aún no guardada: quien la creó en esta sesión puede quitarla.
    if (!actividad.id) return true;
    return this.usuarioEsResponsableDe(actividad);
  }

  /** Solo Super Administrador (root) puede ver/restaurar eliminados. */
  get esSuperAdministrador(): boolean {
    return this.auth.esRoot();
  }

  /** root, calidad o marisol12 pueden desactivar un proyecto completo. */
  get puedeDesactivarProyectoGestion(): boolean {
    if (this.esSuperAdministrador) return true;
    const username = String(this.auth.getUsername() || '').toLowerCase().trim();
    return username === 'calidad' || username === 'sergio56' || username === 'marisol12';
  }

  get menuOpcionesVisibles(): MenuOpcion[] {
    return this.menuOpciones.filter((op) => !op.soloRoot || this.esSuperAdministrador);
  }

  get nombrePerfilGestion(): string {
    return String(this.auth.getNombreCompleto() || '').trim();
  }

  get proyectosEliminadosFiltrados(): ProyectoEliminadoGrupo[] {
    const q = this.normalizar(this.busquedaEliminados);
    if (!q) return this.proyectosEliminados;
    return this.proyectosEliminados.filter((p) => {
      const haystack = this.normalizar([
        p.folio,
        p.nombreProyecto,
        p.empresaNombre,
        p.eliminadoPor,
        ...(p.actividades || []).map((a) =>
          [a.item, a.condicionRequerimiento, a.actividadesAccion, a.responsable].join(' ')
        )
      ].join(' '));
      return haystack.includes(q);
    });
  }

  get totalActividadesEliminadas(): number {
    return this.proyectosEliminados.reduce((acc, p) => acc + (p.totalActividades || 0), 0);
  }

  cargarEliminados(): void {
    if (!this.esSuperAdministrador) {
      this.proyectosEliminados = [];
      this.errorEliminados = 'Solo el Super Administrador puede consultar eliminados.';
      return;
    }

    this.cargandoEliminados = true;
    this.errorEliminados = '';
    this.mensajeEliminados = '';
    this.backend.listarControlProyectosEliminados(this.empresaSeleccionadaId || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoEliminados = false;
          if (!res?.success) {
            this.errorEliminados = res?.message || 'No se pudieron cargar los eliminados.';
            this.proyectosEliminados = [];
            return;
          }
          this.aplicarEliminados(res);
        },
        error: (err) => {
          this.cargandoEliminados = false;
          this.proyectosEliminados = [];
          this.errorEliminados = err?.error?.message || 'No se pudieron cargar los eliminados.';
        }
      });
  }

  private aplicarEliminados(res: any): void {
    const lista = Array.isArray(res?.proyectos) ? res.proyectos : [];
    this.proyectosEliminados = lista.map((p: any) => ({
      clave: String(p.clave || `${p.empresaId || 'sin'}|${p.folio || p.nombreProyecto || ''}`),
      empresaId: p.empresaId ? Number(p.empresaId) : null,
      empresaNombre: String(p.empresaNombre || '').trim(),
      folio: String(p.folio || '').trim(),
      nombreProyecto: String(p.nombreProyecto || '').trim() || 'Proyecto sin nombre',
      totalActividades: Number(p.totalActividades || (p.actividades || []).length || 0),
      eliminadoPor: p.eliminadoPor || null,
      eliminadoEn: p.eliminadoEn || null,
      actividades: (Array.isArray(p.actividades) ? p.actividades : []).map((a: any) => this.normalizarProyecto(a))
    }));
  }

  toggleProyectoEliminado(clave: string): void {
    this.eliminadosProyectoExpandido = this.eliminadosProyectoExpandido === clave ? null : clave;
  }

  restaurarProyectoEliminado(grupo: ProyectoEliminadoGrupo): void {
    if (!this.esSuperAdministrador || this.restaurandoEliminados) return;
    const ok = window.confirm(
      `¿Restaurar el proyecto "${grupo.nombreProyecto}" con ${grupo.totalActividades} actividad(es)?`
    );
    if (!ok) return;

    this.restaurandoEliminados = true;
    this.errorEliminados = '';
    this.mensajeEliminados = '';
    this.backend.restaurarControlProyectosEliminados({
      proyecto: {
        empresaId: grupo.empresaId ?? null,
        folio: grupo.folio,
        nombreProyecto: grupo.nombreProyecto
      },
      empresaId: this.empresaSeleccionadaId
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.restaurandoEliminados = false;
          if (!res?.success) {
            this.errorEliminados = res?.message || 'No se pudo restaurar el proyecto.';
            return;
          }
          this.mensajeEliminados = res.message || 'Proyecto restaurado.';
          if (res.eliminados) {
            this.aplicarEliminados(res.eliminados);
          } else {
            this.cargarEliminados();
          }
          this.aplicarDashboard(res);
        },
        error: (err) => {
          this.restaurandoEliminados = false;
          this.errorEliminados = err?.error?.message || 'No se pudo restaurar el proyecto.';
        }
      });
  }

  restaurarActividadEliminada(actividad: ProyectoTableroItem): void {
    if (!this.esSuperAdministrador || this.restaurandoEliminados || !actividad?.id) return;
    const etiqueta = actividad.actividadesAccion || actividad.condicionRequerimiento || actividad.item || `#${actividad.id}`;
    const ok = window.confirm(`¿Restaurar la actividad "${etiqueta}"?`);
    if (!ok) return;

    this.restaurandoEliminados = true;
    this.errorEliminados = '';
    this.mensajeEliminados = '';
    this.backend.restaurarControlProyectosEliminados({
      ids: [Number(actividad.id)],
      empresaId: this.empresaSeleccionadaId
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.restaurandoEliminados = false;
          if (!res?.success) {
            this.errorEliminados = res?.message || 'No se pudo restaurar la actividad.';
            return;
          }
          this.mensajeEliminados = res.message || 'Actividad restaurada.';
          if (res.eliminados) {
            this.aplicarEliminados(res.eliminados);
          } else {
            this.cargarEliminados();
          }
          this.aplicarDashboard(res);
        },
        error: (err) => {
          this.restaurandoEliminados = false;
          this.errorEliminados = err?.error?.message || 'No se pudo restaurar la actividad.';
        }
      });
  }

  get responsablesFiltroDisponibles(): string[] {
    return this.responsablesTablero.filter((r) => {
      const n = this.normalizar(r);
      return n && n !== 'sin asignar';
    });
  }

  get proyectosActivosLista(): any[] {
    return this.proyectosResumen
      .filter((p) => this.normalizar(p?.estatus || '') !== 'concluido')
      .sort((a, b) => this.ordenPrioridad(a?.prioridad) - this.ordenPrioridad(b?.prioridad));
  }

  get proyectosActivosTotalPaginas(): number {
    return Math.max(1, Math.ceil(this.proyectosActivosLista.length / this.proyectosActivosTamanoPagina));
  }

  get proyectosActivosPaginaActual(): number {
    return Math.min(Math.max(1, this.proyectosActivosPagina), this.proyectosActivosTotalPaginas);
  }

  get proyectosActivosPaginados(): any[] {
    const pagina = this.proyectosActivosPaginaActual;
    const inicio = (pagina - 1) * this.proyectosActivosTamanoPagina;
    return this.proyectosActivosLista.slice(inicio, inicio + this.proyectosActivosTamanoPagina);
  }

  paginaProyectosActivosAnterior(): void {
    const actual = this.proyectosActivosPaginaActual;
    if (actual <= 1) return;
    this.proyectosActivosPagina = actual - 1;
  }

  paginaProyectosActivosSiguiente(): void {
    const actual = this.proyectosActivosPaginaActual;
    if (actual >= this.proyectosActivosTotalPaginas) return;
    this.proyectosActivosPagina = actual + 1;
  }

  totalActividadesProyectoActivo(proyecto: any): number {
    if (Array.isArray(proyecto?.actividades) && proyecto.actividades.length) {
      return proyecto.actividades.length;
    }
    const lineas = this.desglosarActividadesTexto(proyecto?.actividadesAccion);
    return Math.max(lineas.length, 1);
  }

  claveProyectoDashboard(proyecto: any): string {
    return `${proyecto?.empresaId || 'sin-empresa'}|${this.normalizar(proyecto?.folio || proyecto?.nombreProyecto || 'sin-proyecto')}`;
  }

  get proyectoDashboardSeleccionado(): any | null {
    if (!this.proyectoDashboardSeleccionadoClave) return null;
    return this.proyectosResumen.find(
      (p) => this.claveProyectoDashboard(p) === this.proyectoDashboardSeleccionadoClave
    ) || null;
  }

  get hayProyectoDashboardSeleccionado(): boolean {
    return !!this.proyectoDashboardSeleccionado;
  }

  get nombreProyectoDashboardSeleccionado(): string {
    const p = this.proyectoDashboardSeleccionado;
    if (!p) return '';
    return p.nombreProyecto || p.folio || 'Proyecto seleccionado';
  }

  get subtituloEstatusDashboard(): string {
    if (this.hayProyectoDashboardSeleccionado) {
      return `Actividades de «${this.nombreProyectoDashboardSeleccionado}»`;
    }
    return 'Vista consolidada del portafolio';
  }

  get subtituloPrioridadDashboard(): string {
    if (this.hayProyectoDashboardSeleccionado) {
      return `Prioridad de actividades del proyecto`;
    }
    return 'Prioridades asignadas por proyecto';
  }

  get etiquetaCentroEstatusChart(): string {
    return this.hayProyectoDashboardSeleccionado ? 'Actividades' : 'Proyectos';
  }

  get etiquetaCentroPrioridadChart(): string {
    return this.hayProyectoDashboardSeleccionado ? 'Actividades' : 'Proyectos';
  }

  get totalCentroEstatusChart(): number {
    return this.totalEstatusVista;
  }

  seleccionarProyectoDashboard(proyecto: any): void {
    const clave = this.claveProyectoDashboard(proyecto);
    this.proyectoDashboardSeleccionadoClave =
      this.proyectoDashboardSeleccionadoClave === clave ? null : clave;
    this.actualizarVistaChartsDashboard();
  }

  limpiarProyectoDashboardSeleccionado(): void {
    if (!this.proyectoDashboardSeleccionadoClave) return;
    this.proyectoDashboardSeleccionadoClave = null;
    this.actualizarVistaChartsDashboard();
  }

  esProyectoDashboardSeleccionado(proyecto: any): boolean {
    return !!this.proyectoDashboardSeleccionadoClave
      && this.claveProyectoDashboard(proyecto) === this.proyectoDashboardSeleccionadoClave;
  }

  private actividadesDelProyectoDashboard(proyecto: any): ProyectoTableroItem[] {
    if (!proyecto) return [];
    if (Array.isArray(proyecto.actividades) && proyecto.actividades.length) {
      return proyecto.actividades.map((a: any) => this.normalizarProyecto(a));
    }
    const clave = this.claveProyectoDashboard(proyecto);
    return this.proyectos.filter((a) => this.claveProyectoDashboard(a) === clave);
  }

  tonoProyectoActivo(index: number): number {
    return Math.abs(Number(index) || 0) % 6;
  }

  acentoProyectoActivo(index: number): string {
    const acentos = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669'];
    return acentos[this.tonoProyectoActivo(index)];
  }

  tituloIndicadorEstatus(item: { label: string }): string {
    return item.label;
  }

  subtituloIndicadorEstatus(item: { valor: number; total: number; detalle: string; mostrarTotal?: boolean }): string {
    if (item.mostrarTotal) return `${item.valor} / ${item.total} ${item.detalle}`;
    return `${item.valor} ${item.detalle}`;
  }

  subtituloIndicadorPrioridad(item: { total: number; pct: number }): string {
    const unidad = this.hayProyectoDashboardSeleccionado
      ? (item.total === 1 ? 'actividad' : 'actividades')
      : (item.total === 1 ? 'proyecto' : 'proyectos');
    return `${item.total} ${unidad} · ${item.pct}%`;
  }

  claseIndicadorEstatus(key: string): string {
    const k = this.normalizar(key);
    if (k === 'concluido') return 'cp-eficacia-rule-card--concluido';
    if (k === 'en proceso') return 'cp-eficacia-rule-card--proceso';
    if (k === 'en revision' || k === 'en revisión') return 'cp-eficacia-rule-card--revision';
    return 'cp-eficacia-rule-card--pendiente';
  }

  claseIndicadorPrioridad(etiqueta: string): string {
    const n = this.normalizarPrioridad(etiqueta);
    if (n === 'muy prioritaria') return 'cp-eficacia-rule-card--muy-prioritaria';
    if (n === 'prioritaria') return 'cp-eficacia-rule-card--prioritaria';
    if (n === 'media') return 'cp-eficacia-rule-card--media';
    if (n === 'baja') return 'cp-eficacia-rule-card--baja';
    if (n === 'muy baja') return 'cp-eficacia-rule-card--muy-baja';
    return 'cp-eficacia-rule-card--ninguna';
  }

  get prioridadDominanteChart(): { etiqueta: string; pct: number } | null {
    const conDatos = this.prioridadDistribucionVista.filter((item) => item.total > 0);
    if (!conDatos.length) return null;
    const top = conDatos.reduce((prev, item) => (item.total > prev.total ? item : prev), conDatos[0]);
    return { etiqueta: top.etiqueta, pct: top.pct };
  }

  resumenAvanceProyecto(proyecto: any): string {
    const n = this.normalizar(proyecto?.estatus || '');
    if (n === 'concluido') return `${proyecto?.avance || 0}% completado`;
    if (n === 'en revision' || n === 'en revisión') return 'En revisión';
    if (n === 'en proceso') return `${proyecto?.avance || 0}% en curso`;
    return 'Pendiente por iniciar';
  }

  colorAvancePorEstatusProyecto(estatus: string, avance?: number): string {
    const e = (estatus || '').toLowerCase();
    if (e.includes('conclu')) return '#15803d';
    if (e.includes('proceso')) return '#0f766e';
    const pct = Number(avance) || 0;
    if (pct >= 100) return '#15803d';
    if (pct > 0) return '#0f766e';
    return '#94a3b8';
  }

  gradienteAvanceProyectoResumen(estatus: string, avance?: number): string {
    const c = this.colorAvancePorEstatusProyecto(estatus, avance);
    if (c === '#15803d') return 'linear-gradient(90deg, #15803d 0%, #22c55e 55%, #86efac 100%)';
    if (c === '#0f766e') return 'linear-gradient(90deg, #0f766e 0%, #15a596 50%, #5eead4 100%)';
    return 'linear-gradient(90deg, #94a3b8 0%, #cbd5e1 100%)';
  }

  claseEstatusProyectoResumen(estatus: string, avance?: number): string {
    const e = (estatus || '').toLowerCase();
    if (e.includes('conclu') || (Number(avance) || 0) >= 100) return 'cp-proyecto-badge--concluido';
    if (e.includes('proceso') || (Number(avance) || 0) > 0) return 'cp-proyecto-badge--proceso';
    return 'cp-proyecto-badge--pendiente';
  }

  labelEstatusProyectoResumen(estatus: string, avance?: number): string {
    if (estatus?.trim()) return estatus;
    const pct = Number(avance) || 0;
    if (pct >= 100) return 'Concluido';
    if (pct > 0) return 'En proceso';
    return 'No iniciado';
  }

  clasePrioridadProyectoResumen(prioridad: string): string {
    const p = (prioridad || '').toLowerCase();
    if (p.includes('muy prioritaria') || p.includes('prioritaria') || p.includes('urgent') || p.includes('crít')) return 'cp-proyecto-prio--alta';
    if (p.includes('media') || p.includes('medio') || p.includes('normal')) return 'cp-proyecto-prio--media';
    if (p.includes('baja') || p.includes('low')) return 'cp-proyecto-prio--baja';
    return 'cp-proyecto-prio--nd';
  }

  estatusBacklogActivo(proyecto: ProyectoTableroItem): 'todo' | 'progress' | 'review' | 'done' {
    const n = this.normalizar(proyecto.estatus);
    if (n === 'concluido') return 'done';
    if (n === 'en revision' || n === 'en revisión') return 'review';
    if (n === 'en proceso') return 'progress';
    return 'todo';
  }

  cambiarEstatusBacklog(proyecto: ProyectoTableroItem, tipo: 'todo' | 'progress' | 'review' | 'done'): void {
    if (this.actualizandoEstatusBacklog || !this.puedeEditarEstatusBacklog(proyecto)) return;
    this.backlogMenuAbiertoClave = null;

    const mapa: Record<typeof tipo, { estatus: string; avance: number }> = {
      todo: { estatus: 'No iniciado', avance: 0 },
      progress: { estatus: 'En proceso', avance: 50 },
      review: { estatus: 'En revisión', avance: 75 },
      done: { estatus: 'Concluido', avance: 100 }
    };

    const destino = mapa[tipo];
    const indice = this.proyectos.findIndex((p) =>
      (p.id && proyecto.id && p.id === proyecto.id)
      || (p.folio === proyecto.folio && p.nombreProyecto === proyecto.nombreProyecto && p.item === proyecto.item && p.actividadesAccion === proyecto.actividadesAccion)
    );
    if (indice < 0) return;

    this.proyectos[indice] = {
      ...this.proyectos[indice],
      estatus: destino.estatus,
      avance: destino.avance
    };

    this.actualizandoEstatusBacklog = true;
    const payload = this.proyectos.map((p) => ({
      id: p.id || undefined,
      empresaId: p.empresaId || this.empresaSeleccionadaId,
      empresaNombre: String(p.empresaNombre || '').trim(),
      folio: String(p.folio || '').trim(),
      nombreProyecto: String(p.nombreProyecto || '').trim(),
      item: String(p.item || '').trim(),
      condicionRequerimiento: String(p.condicionRequerimiento || '').trim(),
      actividadesAccion: String(p.actividadesAccion || '').trim(),
      referenciaNormativa: String(p.referenciaNormativa || '').trim(),
      responsable: String(p.responsable || '').trim(),
      responsableUsuarioIds: this.parseResponsableUsuarioIds(p.responsableUsuarioIds),
      fechaInicio: p.fechaInicio || undefined,
      fechaCompromiso: p.fechaCompromiso || undefined,
      entregables: String(p.entregables || '').trim(),
      prioridad: p.prioridad || undefined,
      estatus: p.estatus || undefined,
      avance: p.avance
    }));

    this.backend.guardarControlProyectos(payload, this.empresaSeleccionadaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.actualizandoEstatusBacklog = false;
          if (res?.success) {
            this.aplicarDashboard(res);
            this.reconstruirBacklogAgrupado();
          }
        },
        error: () => {
          this.actualizandoEstatusBacklog = false;
        }
      });
  }

  private clavePizarronStorage(): string {
    return `cp-pizarron-${this.empresaSeleccionadaId || 'global'}`;
  }

  cargarPizarron(): void {
    try {
      const raw = localStorage.getItem(this.clavePizarronStorage());
      const parsed = raw ? JSON.parse(raw) : [];
      this.pizarronNotas = Array.isArray(parsed)
        ? parsed.filter((n) => n && String(n.texto || '').trim())
        : [];
    } catch {
      this.pizarronNotas = [];
    }
  }

  private persistirPizarron(): void {
    localStorage.setItem(this.clavePizarronStorage(), JSON.stringify(this.pizarronNotas));
  }

  agregarNotaPizarron(): void {
    const texto = String(this.pizarronTextoNuevo || '').trim();
    if (!texto) return;

    const autor = String(this.pizarronAutorNuevo || 'Anónimo').trim() || 'Anónimo';
    const nota: PizarronNota = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      texto,
      autor,
      color: this.pizarronColores[Math.floor(Math.random() * this.pizarronColores.length)],
      createdAt: new Date().toISOString()
    };

    this.pizarronNotas = [nota, ...this.pizarronNotas].slice(0, 24);
    this.pizarronTextoNuevo = '';
    this.persistirPizarron();
  }

  eliminarNotaPizarron(id: string): void {
    this.pizarronNotas = this.pizarronNotas.filter((n) => n.id !== id);
    this.persistirPizarron();
  }

  iniciarCarruselDashboard(): void {
    this.detenerCarruselDashboard();
    this.reiniciarCarruselDashboardTimer();
    this.carruselDashTimer = setInterval(() => this.tickCarruselDashboard(), this.CARRUSEL_DASH_TICK_MS);
  }

  detenerCarruselDashboard(): void {
    if (this.carruselDashTimer) {
      clearInterval(this.carruselDashTimer);
      this.carruselDashTimer = null;
    }
  }

  private tickCarruselDashboard(): void {
    if (this.carruselDashHover || !this.carruselDashAutoActivo) return;

    this.carruselDashElapsedMs += this.CARRUSEL_DASH_TICK_MS;
    if (this.carruselDashElapsedMs >= this.CARRUSEL_DASH_INTERVALO_MS) {
      this.siguienteGraficoDashboard();
      return;
    }
    this.actualizarCarruselDashboardUi();
  }

  private actualizarCarruselDashboardUi(): void {
    this.carruselDashProgresoPct = Math.min(100, (this.carruselDashElapsedMs / this.CARRUSEL_DASH_INTERVALO_MS) * 100);
    this.carruselDashSegundosRestantes = Math.max(
      0,
      Math.ceil((this.CARRUSEL_DASH_INTERVALO_MS - this.carruselDashElapsedMs) / 1000)
    );
  }

  private reiniciarCarruselDashboardTimer(): void {
    this.carruselDashElapsedMs = 0;
    this.actualizarCarruselDashboardUi();
  }

  onCarruselDashboardMouseEnter(): void {
    this.carruselDashHover = true;
  }

  onCarruselDashboardMouseLeave(): void {
    this.carruselDashHover = false;
  }

  toggleCarruselDashboardAuto(): void {
    this.carruselDashAutoActivo = !this.carruselDashAutoActivo;
    if (this.carruselDashAutoActivo) {
      this.reiniciarCarruselDashboardTimer();
    }
  }

  proyectosPorColumna(columnaId: ColumnaTableroId): ProyectoTableroItem[] {
    const columna = this.columnasTablero.find((c) => c.id === columnaId);
    if (!columna) return [];

    return this.proyectosFiltrados.filter((p) => {
      const estatus = String(p.estatus || '').trim();
      if (columnaId === 'por-hacer') {
        const n = this.normalizar(estatus);
        return !n || n === 'no iniciado';
      }
      return columna.estatuses.some((e) => this.normalizar(e) === this.normalizar(estatus));
    });
  }

  cambiarEmpresaDashboard(valor: string | number | null): void {
    const id = Number(valor || 0);
    this.empresaSeleccionadaId = Number.isInteger(id) && id > 0 ? id : null;
    this.filtroResponsable = '';
    this.busquedaProyectoDashboard = '';
    this.actividadesDashboardPagina = 1;
    this.proyectosActivosPagina = 1;
    this.proyectoDashboardSeleccionadoClave = null;
    this.cargarPizarron();
    this.cargarDashboard();
    if (this.vistaActiva === 'eliminados') {
      this.cargarEliminados();
    }
  }

  get empresasDashboardFiltradas(): EmpresaControlProyecto[] {
    const q = this.normalizar(this.empresaDashboardBusqueda);
    if (!q || q === this.normalizar(this.empresaSeleccionadaNombre)) {
      return this.empresasControl;
    }
    return this.empresasControl.filter((e) => this.normalizar(e.nombreEmpresa).includes(q));
  }

  abrirDropdownEmpresaDashboard(): void {
    this.empresaDashboardDropdownAbierto = true;
  }

  cerrarDropdownEmpresaDashboard(): void {
    this.empresaDashboardDropdownAbierto = false;
    this.sincronizarBusquedaEmpresaDashboard();
  }

  onBusquedaEmpresaDashboard(): void {
    this.empresaDashboardDropdownAbierto = true;
  }

  seleccionarEmpresaDashboard(empresa: EmpresaControlProyecto | null): void {
    this.empresaDashboardDropdownAbierto = false;
    if (!empresa) {
      this.empresaDashboardBusqueda = 'Todas las empresas';
      this.cambiarEmpresaDashboard(null);
      return;
    }
    this.empresaDashboardBusqueda = empresa.nombreEmpresa;
    this.cambiarEmpresaDashboard(empresa.empresaId);
  }

  limpiarEmpresaDashboard(event?: Event): void {
    event?.stopPropagation();
    this.empresaDashboardBusqueda = '';
    this.empresaDashboardDropdownAbierto = true;
    if (this.empresaSeleccionadaId) {
      this.cambiarEmpresaDashboard(null);
    }
  }

  sincronizarBusquedaEmpresaDashboard(): void {
    this.empresaDashboardBusqueda = this.empresaSeleccionadaNombre;
  }

  get empresasRegistroFiltradas(): EmpresaControlProyecto[] {
    const q = this.normalizar(this.registroEmpresaBusqueda);
    if (!q || this.formRegistro.empresaNombre === this.registroEmpresaBusqueda) {
      return this.empresasControl;
    }
    return this.empresasControl.filter((e) => this.normalizar(e.nombreEmpresa).includes(q));
  }

  get responsablesRegistroFiltrados(): string[] {
    const q = this.normalizar(this.registroResponsableBusqueda);
    if (!q || this.formRegistro.responsable === this.registroResponsableBusqueda) {
      return this.usuariosInternosNombres;
    }
    return this.usuariosInternosNombres.filter((n) => this.normalizar(n).includes(q));
  }

  abrirDropdownEmpresaRegistro(): void {
    this.registroResponsableDropdownAbierto = false;
    this.registroEmpresaDropdownAbierto = true;
  }

  abrirDropdownResponsableRegistro(): void {
    this.registroEmpresaDropdownAbierto = false;
    this.registroResponsableDropdownAbierto = true;
  }

  cerrarComboboxesRegistro(blurActivo = false): void {
    this.registroEmpresaDropdownAbierto = false;
    this.registroResponsableDropdownAbierto = false;
    if (!blurActivo) return;
    const activo = document.activeElement as HTMLElement | null;
    if (activo?.closest?.('.cp-registro-combobox')) {
      activo.blur();
    }
  }

  onBusquedaEmpresaRegistro(): void {
    this.registroEmpresaDropdownAbierto = true;
    this.registroResponsableDropdownAbierto = false;
    if (this.formRegistro.empresaNombre && this.registroEmpresaBusqueda !== this.formRegistro.empresaNombre) {
      this.formRegistro.empresaId = null;
      this.formRegistro.empresaNombre = '';
    }
  }

  onBusquedaResponsableRegistro(): void {
    this.registroResponsableDropdownAbierto = true;
    this.registroEmpresaDropdownAbierto = false;
    if (this.formRegistro.responsable && this.registroResponsableBusqueda !== this.formRegistro.responsable) {
      this.formRegistro.responsable = '';
      this.formRegistro.responsableUsuarioId = null;
    }
  }

  seleccionarEmpresaRegistro(empresa: EmpresaControlProyecto | null): void {
    if (!empresa) {
      this.formRegistro.empresaId = null;
      this.formRegistro.empresaNombre = '';
      this.registroEmpresaBusqueda = '';
    } else {
      this.formRegistro.empresaId = empresa.empresaId;
      this.formRegistro.empresaNombre = empresa.nombreEmpresa;
      this.registroEmpresaBusqueda = empresa.nombreEmpresa;
    }
    this.cerrarComboboxesRegistro();
  }

  limpiarEmpresaRegistro(event: Event): void {
    event.stopPropagation();
    this.seleccionarEmpresaRegistro(null);
    this.registroEmpresaDropdownAbierto = true;
  }

  seleccionarResponsableRegistro(nombre: string): void {
    this.formRegistro.responsable = nombre;
    this.formRegistro.responsableUsuarioId = this.resolverUsuarioIdPorNombre(nombre);
    this.registroResponsableBusqueda = nombre;
    this.cerrarComboboxesRegistro();
  }

  limpiarResponsableRegistro(event: Event): void {
    event.stopPropagation();
    this.formRegistro.responsable = '';
    this.formRegistro.responsableUsuarioId = null;
    this.registroResponsableBusqueda = '';
    this.registroResponsableDropdownAbierto = true;
  }

  seleccionarPrioridadRegistro(valor: string): void {
    this.formRegistro.prioridad = valor;
  }

  seleccionarEstatusRegistro(valor: string): void {
    this.formRegistro.estatus = valor;
  }

  etiquetaPrioridadRegistro(valor: string): string {
    const item = this.opcionesPrioridadRegistro.find((p) => p.value === valor);
    if (!item) return valor ? `Prioridad: ${valor}` : 'Sin prioridad seleccionada';
    return `${item.shortLabel} — ${item.hint}`;
  }

  etiquetaEstatusRegistro(valor: string): string {
    const item = this.opcionesEstatusRegistro.find((e) => e.value === valor);
    if (!item) return valor ? `Estatus: ${valor}` : 'Sin estatus seleccionado';
    return `${item.shortLabel} — ${item.hint}`;
  }

  private sincronizarBusquedasRegistro(): void {
    this.registroEmpresaBusqueda = this.formRegistro.empresaNombre || '';
    this.registroResponsableBusqueda = this.formRegistro.responsable || '';
    this.cerrarComboboxesRegistro();
  }

  get empresaSeleccionadaNombre(): string {
    if (!this.empresaSeleccionadaId) return 'Todas las empresas';
    return this.empresasControl.find((e) => e.empresaId === this.empresaSeleccionadaId)?.nombreEmpresa || 'Empresa seleccionada';
  }

  contarColumna(columnaId: ColumnaTableroId): number {
    return this.proyectosPorColumna(columnaId).length;
  }

  get proyectosFiltrados(): ProyectoTableroItem[] {
    const q = this.normalizar(this.busquedaTablero);
    const responsable = this.normalizar(this.filtroResponsable);

    return this.proyectos.filter((p) => {
      if (responsable) {
        if (!this.coincideFiltroResponsable(p, responsable)) return false;
      }
      if (!q) return true;
      return [p.folio, p.nombreProyecto, p.responsable, p.prioridad, p.estatus]
        .some((campo) => this.normalizar(campo).includes(q));
    });
  }

  get proyectosActividadesVisibles(): ProyectoTableroItem[] {
    const q = this.normalizar(this.busquedaActividades);
    const responsable = this.normalizar(this.filtroResponsable);
    const estatusFiltro = this.normalizar(this.filtroEstatusActividades);

    return this.proyectos
      .filter((p) => {
        if (estatusFiltro) {
          const estatus = this.normalizar(p.estatus || 'No iniciado');
          if (estatusFiltro === 'no iniciado' && estatus && estatus !== 'no iniciado') return false;
          if (estatusFiltro !== 'no iniciado' && estatus !== estatusFiltro) return false;
        }
        if (responsable) {
          if (!this.coincideFiltroResponsable(p, responsable)) return false;
        }
        if (!q) return true;
        return [p.folio, p.nombreProyecto, p.responsable, p.prioridad, p.estatus]
          .some((campo) => this.normalizar(campo).includes(q));
      })
      .sort((a, b) => {
        const tb = this.timestampActividad(b.updatedAt || b.createdAt);
        const ta = this.timestampActividad(a.updatedAt || a.createdAt);
        return tb - ta;
      });
  }

  get actividadesTablaVisibles(): ActividadTablaFila[] {
    const filas: ActividadTablaFila[] = [];
    const visibles = this.proyectosActividadesVisibles;
    const grupos = new Map<string, ProyectoTableroItem[]>();

    for (const actividad of visibles) {
      const clave = `${actividad.empresaId || 'sin-empresa'}|${this.normalizar(actividad.folio || actividad.nombreProyecto || 'sin-proyecto')}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave)!.push(actividad);
    }

    for (const grupo of grupos.values()) {
      grupo.forEach((actividad, index) => {
        filas.push({
          actividad,
          mostrarProyecto: index === 0,
          rowspan: grupo.length,
          indiceOriginal: visibles.indexOf(actividad)
        });
      });
    }

    return filas;
  }

  get todasActividadesSeleccionadas(): boolean {
    const proyectos = this.proyectosUnicosActividadesVisibles;
    if (!proyectos.length) return false;
    return proyectos.every((p) => this.selectedActividades.has(this.claveProyectoActividad(p)));
  }

  get proyectosUnicosActividadesVisibles(): ProyectoTableroItem[] {
    const vistos = new Set<string>();
    const unicos: ProyectoTableroItem[] = [];
    for (const p of this.proyectosActividadesVisibles) {
      const clave = this.claveProyectoActividad(p);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      unicos.push(p);
    }
    return unicos;
  }

  claveProyectoActividad(p: ProyectoTableroItem): string {
    return `${p.empresaId || 'sin-empresa'}|${this.normalizar(p.folio || p.nombreProyecto || 'sin-proyecto')}`;
  }

  /** @deprecated usar claveProyectoActividad — se mantiene por compatibilidad interna */
  claveActividad(p: ProyectoTableroItem, _index?: number): string {
    return this.claveProyectoActividad(p);
  }

  actividadSeleccionada(p: ProyectoTableroItem, _index?: number): boolean {
    return this.selectedActividades.has(this.claveProyectoActividad(p));
  }

  toggleSeleccionActividad(p: ProyectoTableroItem, _index?: number): void {
    const clave = this.claveProyectoActividad(p);
    if (this.selectedActividades.has(clave)) {
      this.selectedActividades.delete(clave);
    } else {
      this.selectedActividades.add(clave);
    }
  }

  toggleSeleccionTodasActividades(): void {
    const proyectos = this.proyectosUnicosActividadesVisibles;
    if (this.todasActividadesSeleccionadas) {
      proyectos.forEach((p) => this.selectedActividades.delete(this.claveProyectoActividad(p)));
      return;
    }
    proyectos.forEach((p) => this.selectedActividades.add(this.claveProyectoActividad(p)));
  }

  actividadFinalizada(estatus: string): boolean {
    return this.normalizar(estatus) === 'concluido';
  }

  estatusEtiqueta(estatus: string): string {
    const n = this.normalizar(estatus);
    if (n === 'concluido') return 'Listo';
    if (n === 'en revision' || n === 'en revisión') return 'En revisión';
    if (n === 'en proceso') return 'En curso';
    return 'No Iniciado';
  }

  estatusBadgeClass(estatus: string): string {
    const n = this.normalizar(estatus);
    if (n === 'concluido') return 'cp-status--done';
    if (n === 'en revision' || n === 'en revisión') return 'cp-status--review';
    if (n === 'en proceso') return 'cp-status--progress';
    return 'cp-status--todo';
  }

  resolucionActividad(estatus: string, avance: number): string {
    if (this.normalizar(estatus) === 'concluido') return 'Listo';
    if (this.normalizar(estatus) === 'en revision' || this.normalizar(estatus) === 'en revisión') return 'En revisión';
    if (avance > 0) return 'En progreso';
    return 'Sin resolver';
  }

  prioridadIcono(prioridad: string): string {
    const n = this.normalizarPrioridad(prioridad);
    if (n === 'muy prioritaria') return 'fa-angle-double-up';
    if (n === 'prioritaria') return 'fa-arrow-up';
    if (n === 'media') return 'fa-equals';
    if (n === 'baja') return 'fa-arrow-down';
    if (n === 'muy baja') return 'fa-angle-double-down';
    return 'fa-minus';
  }

  prioridadIconClass(prioridad: string): string {
    const n = this.normalizarPrioridad(prioridad);
    if (n === 'muy prioritaria') return 'cp-priority-icon--very-high';
    if (n === 'prioritaria') return 'cp-priority-icon--high';
    if (n === 'media') return 'cp-priority-icon--medium';
    if (n === 'baja') return 'cp-priority-icon--low';
    if (n === 'muy baja') return 'cp-priority-icon--very-low';
    return 'cp-priority-icon--none';
  }

  informadorActividad(p: ProyectoTableroItem): string {
    return p.responsable || 'Sin asignar';
  }

  nombreTruncado(nombre: string, max = 18): string {
    const texto = String(nombre || '').trim();
    if (!texto || this.normalizar(texto) === 'sin asignar') return 'Sin asignar';
    if (texto.length <= max) return texto.toUpperCase();
    return `${texto.slice(0, max).trim()}…`;
  }

  formatearFechaHoraActividad(valor: string | null | undefined): string {
    const fecha = this.parsearFechaHora(valor);
    if (!fecha) return '—';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const hh = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    return `${fecha.getDate()} ${meses[fecha.getMonth()]} ${fecha.getFullYear()}, ${hh}:${min}`;
  }

  formatearFechaVencimiento(p: ProyectoTableroItem): string {
    const fecha = this.calcularFechaVencimiento(p);
    if (!fecha) return 'Ninguno';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${fecha.getDate()} ${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
  }

  vencimientoVencido(p: ProyectoTableroItem): boolean {
    if (this.actividadFinalizada(p.estatus)) return false;
    const fecha = this.calcularFechaVencimiento(p);
    if (!fecha) return false;
    return fecha.getTime() < this.inicioDia(new Date()).getTime();
  }

  private calcularFechaVencimiento(p: ProyectoTableroItem): Date | null {
    const compromiso = this.parsearFechaIso(p.fechaCompromiso);
    if (compromiso) return compromiso;

    const base = this.parsearFechaHora(p.createdAt);
    if (!base) return null;
    const copia = new Date(base);
    const n = this.normalizarPrioridad(p.prioridad);
    if (n === 'muy prioritaria') {
      copia.setDate(copia.getDate() + 14);
      return copia;
    }
    if (n === 'prioritaria') {
      copia.setMonth(copia.getMonth() + 1);
      return copia;
    }
    if (n === 'media') {
      copia.setMonth(copia.getMonth() + 2);
      return copia;
    }
    if (n === 'baja') {
      copia.setMonth(copia.getMonth() + 3);
      return copia;
    }
    if (n === 'muy baja') {
      copia.setMonth(copia.getMonth() + 6);
      return copia;
    }
    return null;
  }

  private timestampActividad(valor: string | null | undefined): number {
    const fecha = this.parsearFechaHora(valor);
    return fecha ? fecha.getTime() : 0;
  }

  private parsearFechaHora(valor: unknown): Date | null {
    if (!valor) return null;
    const fecha = new Date(String(valor));
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  toggleSeccionBacklog(seccion: 'sprint' | 'pendientes'): void {
    this.backlogSeccionColapsada[seccion] = !this.backlogSeccionColapsada[seccion];
  }

  get proyectosBacklogFiltrados(): ProyectoTableroItem[] {
    const q = this.normalizar(this.busquedaBacklog);
    const responsable = this.normalizar(this.filtroResponsable);

    return this.proyectos.filter((p) => {
      if (responsable) {
        if (!this.coincideFiltroResponsable(p, responsable)) return false;
      }
      if (!q) return true;
      return [p.folio, p.nombreProyecto, p.responsable, p.prioridad, p.estatus]
        .some((campo) => this.normalizar(campo).includes(q));
    });
  }

  get sprintActivoItems(): ProyectoTableroItem[] {
    return this.proyectosBacklogFiltrados
      .filter((p) => {
        const n = this.normalizar(p.estatus);
        return n === 'en proceso' || n === 'en revision' || n === 'en revisión' || n === 'concluido';
      })
      .sort((a, b) => this.ordenFechaCompromiso(a) - this.ordenFechaCompromiso(b));
  }

  get backlogPendienteItems(): ProyectoTableroItem[] {
    return this.proyectosBacklogFiltrados
      .filter((p) => {
        const n = this.normalizar(p.estatus);
        return !n || n === 'no iniciado';
      })
      .sort((a, b) => this.ordenFechaCompromiso(a) - this.ordenFechaCompromiso(b));
  }

  private ordenFechaCompromiso(item: ProyectoTableroItem): number {
    const fecha = this.parsearFechaIso(item.fechaCompromiso);
    if (fecha) return fecha.getTime();
    return Number.MAX_SAFE_INTEGER - this.ordenPrioridad(item.prioridad);
  }

  rangoSprintActivo(): string {
    const items = this.sprintActivoItems;
    if (!items.length) return 'Sin fechas';

    const fechas = items
      .flatMap((p) => [this.parsearFechaIso(p.createdAt), this.parsearFechaIso(p.updatedAt)])
      .filter((f): f is Date => !!f);

    if (!fechas.length) return 'Ciclo actual';

    const min = new Date(Math.min(...fechas.map((f) => f.getTime())));
    const max = new Date(Math.max(...fechas.map((f) => f.getTime())));
    return `${this.formatearFechaCorta(min)} – ${this.formatearFechaCorta(max)}`;
  }

  contarEstatusBacklog(items: ProyectoTableroItem[], tipo: 'todo' | 'progress' | 'done'): number {
    return items.filter((p) => {
      const n = this.normalizar(p.estatus);
      if (tipo === 'done') return n === 'concluido';
      if (tipo === 'progress') return n === 'en proceso';
      return !n || n === 'no iniciado';
    }).length;
  }

  private ordenPrioridad(prioridad: string): number {
    const n = this.normalizarPrioridad(prioridad);
    if (n === 'muy prioritaria') return 0;
    if (n === 'prioritaria') return 1;
    if (n === 'media') return 2;
    if (n === 'baja') return 3;
    if (n === 'muy baja') return 4;
    if (n === 'ninguna') return 5;
    return 6;
  }

  private normalizarPrioridad(prioridad: string): string {
    const n = this.normalizar(prioridad);
    if (n === 'inmediato') return 'muy prioritaria';
    if (n === 'mediano plazo') return 'media';
    if (n === 'largo plazo') return 'baja';
    return n;
  }

  private formatearFechaCorta(fecha: Date): string {
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${fecha.getDate()} ${meses[fecha.getMonth()]}`;
  }

  get graficoDashboardActivo(): 'estado' | 'prioridad' {
    return this.slidesGraficosDashboard[this.graficoDashboardIndice]?.id || 'estado';
  }

  get slideGraficoDashboardActual() {
    return this.slidesGraficosDashboard[this.graficoDashboardIndice];
  }

  siguienteGraficoDashboard(): void {
    this.graficoDashboardIndice = (this.graficoDashboardIndice + 1) % this.slidesGraficosDashboard.length;
    this.reiniciarCarruselDashboardTimer();
    this.refrescarChartsDashboard();
  }

  anteriorGraficoDashboard(): void {
    this.graficoDashboardIndice =
      (this.graficoDashboardIndice - 1 + this.slidesGraficosDashboard.length) % this.slidesGraficosDashboard.length;
    this.reiniciarCarruselDashboardTimer();
    this.refrescarChartsDashboard();
  }

  irGraficoDashboard(indice: number): void {
    if (indice >= 0 && indice < this.slidesGraficosDashboard.length && indice !== this.graficoDashboardIndice) {
      this.graficoDashboardIndice = indice;
      this.reiniciarCarruselDashboardTimer();
      this.refrescarChartsDashboard();
    }
  }

  private refrescarChartsDashboard(): void {
    setTimeout(() => {
      this.actualizarVistaChartsDashboard();
    }, 180);
  }

  trackByResponsable(_index: number, item: CargaEquipoItem): string {
    return item.responsable;
  }

  trackByActividad(_index: number, item: ProyectoTableroItem): string {
    return item.folio || item.nombreProyecto || String(_index);
  }

  trackByActividadResponsable(_index: number, item: ActividadResponsableItem): string {
    return item.clave;
  }

  trackByGrupoProyecto(_index: number, grupo: GrupoActividadesProyecto): string {
    return grupo.folio || grupo.proyectoNombre;
  }

  desglosarActividadesTexto(texto: string | undefined): string[] {
    const raw = String(texto || '').trim();
    if (!raw) return [];

    const porLinea = raw
      .split(/\r?\n+/)
      .map((linea) => linea.trim())
      .filter(Boolean);

    const lineas = porLinea.length ? porLinea : [raw];
    const normalizadas: string[] = [];

    for (const linea of lineas) {
      const partes = linea
        .split(/(?=\s*\d+[\.\)]\s)/)
        .map((parte) => parte.trim())
        .filter(Boolean);

      const bloques = partes.length > 1 ? partes : [linea];
      for (const bloque of bloques) {
        const limpio = bloque
          .replace(/^(\d+[\.\)]\s*)/, '')
          .replace(/^[-•*–—]\s+/, '')
          .trim();
        if (limpio) normalizadas.push(limpio);
      }
    }

    return [...new Set(normalizadas)];
  }

  inferirEstadoActividad(
    indice: number,
    total: number,
    avance: number,
    estatus: string
  ): 'concluida' | 'en-curso' | 'pendiente' {
    if (this.normalizar(estatus) === 'concluido' || avance >= 100) return 'concluida';

    const completadas = Math.min(total, Math.floor((avance / 100) * total));
    if (indice < completadas) return 'concluida';
    if (indice === completadas && avance > 0) return 'en-curso';
    if (this.normalizar(estatus) === 'en proceso' && completadas === 0 && indice === 0) return 'en-curso';
    return 'pendiente';
  }

  etiquetaEstadoActividad(estatus: ActividadResponsableItem['estatus']): string {
    if (estatus === 'concluida') return 'Concluida';
    if (estatus === 'en-curso') return 'En curso';
    return 'Pendiente';
  }

  claseEstadoActividad(estatus: ActividadResponsableItem['estatus']): string {
    if (estatus === 'concluida') return 'cp-dash-act-estado--done';
    if (estatus === 'en-curso') return 'cp-dash-act-estado--progress';
    return 'cp-dash-act-estado--todo';
  }

  get actividadesResponsableSeleccionadas(): ActividadResponsableItem[] {
    if (!this.filtroResponsable) return [];

    const responsable = this.normalizar(this.filtroResponsable);
    const proyectos = this.proyectos
      .filter((p) => this.normalizar(p.responsable || 'Sin asignar') === responsable)
      .sort((a, b) => this.ordenPrioridad(a.prioridad) - this.ordenPrioridad(b.prioridad));

    const resultado: ActividadResponsableItem[] = [];

    for (const proyecto of proyectos) {
      const lineas = this.desglosarActividadesTexto(proyecto.actividadesAccion);
      const actividades = lineas.length
        ? lineas
        : [proyecto.condicionRequerimiento || proyecto.nombreProyecto || 'Actividad sin detallar'];

      actividades.forEach((actividad, indice) => {
        resultado.push({
          clave: `${proyecto.id || proyecto.folio || 'p'}-${indice}`,
          proyectoId: proyecto.id,
          proyectoNombre: proyecto.nombreProyecto || proyecto.folio,
          folio: proyecto.folio,
          actividad,
          numero: indice + 1,
          totalEnProyecto: actividades.length,
          condicionRequerimiento: proyecto.condicionRequerimiento || '',
          fechaInicio: proyecto.fechaInicio || '',
          fechaCompromiso: proyecto.fechaCompromiso || '',
          prioridad: proyecto.prioridad,
          estatus: this.inferirEstadoActividad(indice, actividades.length, proyecto.avance, proyecto.estatus)
        });
      });
    }

    return resultado;
  }

  get actividadesResponsableAgrupadas(): GrupoActividadesProyecto[] {
    const grupos = new Map<string, GrupoActividadesProyecto>();

    for (const actividad of this.actividadesResponsableSeleccionadas) {
      const clave = actividad.folio || actividad.proyectoNombre;
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          folio: actividad.folio,
          proyectoNombre: actividad.proyectoNombre,
          actividades: []
        });
      }
      grupos.get(clave)!.actividades.push(actividad);
    }

    return Array.from(grupos.values());
  }

  get totalActividadesResponsable(): number {
    return this.actividadesResponsableSeleccionadas.length;
  }

  limpiarFiltroResponsable(): void {
    this.filtroResponsable = '';
  }

  seleccionarResponsable(responsable: string): void {
    this.filtroResponsable = this.filtroResponsable === responsable ? '' : responsable;
  }

  seleccionarPrioridadDashboard(prioridad: string): void {
    this.filtroPrioridadDashboard = this.filtroPrioridadDashboard === prioridad ? '' : prioridad;
  }

  prioridadDashboardActiva(prioridad: string): boolean {
    return this.filtroPrioridadDashboard === prioridad;
  }

  limpiarFiltroPrioridadDashboard(): void {
    if (!this.filtroPrioridadDashboard) return;
    this.filtroPrioridadDashboard = '';
  }

  onPrioridadChartClick(_event: any): void {
    // El gráfico radial de prioridad ya no filtra desde el chart.
  }

  mezclaCargaEquipo(responsable: string, maxProyectos: number): {
    concluidos: number;
    enCurso: number;
    pendientes: number;
    anchoConcluidos: number;
    anchoEnCurso: number;
    anchoPendientes: number;
  } {
    const r = this.resumenCargaEquipo(responsable);
    const base = Math.max(maxProyectos, 1);
    return {
      ...r,
      anchoConcluidos: Math.round((r.concluidos / base) * 100),
      anchoEnCurso: Math.round((r.enCurso / base) * 100),
      anchoPendientes: Math.round((r.pendientes / base) * 100)
    };
  }

  colorPrioridadSistema(prioridad: string): string {
    const clave = this.prioridadesRegistro.find((p) => this.normalizarPrioridad(p) === this.normalizarPrioridad(prioridad));
    if (clave && this.coloresPrioridadSistema[clave]) {
      return this.coloresPrioridadSistema[clave];
    }
    return '#94a3b8';
  }

  formatearFechaProyecto(valor: string | null | undefined): string {
    const fecha = this.parsearFechaIso(valor);
    if (!fecha) return '—';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${fecha.getDate()} ${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
  }

  /** Muestra fecha/hora ya guardada en hora México (YYYY-MM-DD HH:mm:ss). */
  formatearFechaHoraAuditoria(valor: string | null | undefined): string {
    const crudo = String(valor || '').trim();
    if (!crudo) return '—';
    const match = crudo.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const day = Number(match[3]);
      const month = Number(match[2]) - 1;
      const year = match[1];
      return `${day} ${meses[month]} ${year}, ${match[4]}:${match[5]}`;
    }
    return this.formatearFechaProyecto(crudo);
  }

  resumenCargaEquipo(responsable: string): { concluidos: number; enCurso: number; pendientes: number } {
    const items = this.proyectos.filter((p) => (p.responsable || 'Sin asignar') === responsable);
    let concluidos = 0;
    let enCurso = 0;
    let pendientes = 0;

    for (const p of items) {
      const estatus = this.normalizar(p.estatus);
      if (estatus === 'concluido' || p.avance >= 100) {
        concluidos += 1;
      } else if (estatus === 'en proceso' || p.avance > 0) {
        enCurso += 1;
      } else {
        pendientes += 1;
      }
    }

    return { concluidos, enCurso, pendientes };
  }

  abrirRegistro(): void {
    this.registroModo = 'crear';
    this.registroEditarIndice = null;
    this.errorRegistro = '';
    this.formRegistro = this.formRegistroVacio();
    this.formRegistro.empresaId = this.empresaSeleccionadaId;
    this.formRegistro.empresaNombre = this.empresaSeleccionadaNombre === 'Todas las empresas' ? '' : this.empresaSeleccionadaNombre;
    this.formRegistro.folio = this.generarFolioAutomatico();
    this.sincronizarBusquedasRegistro();
    this.mostrarRegistro = true;
  }

  abrirEdicionProyecto(
    proyecto: ProyectoTableroItem,
    indice: number,
    grupo: GrupoGestionProyecto | null = null
  ): void {
    if (!this.puedeEditarProyectoGestion(grupo || this.grupoGestionSeleccionado)) return;
    this.registroModo = 'editar';
    this.registroEditarIndice = indice;
    this.registroEditarGrupo = grupo || this.grupoGestionSeleccionado;
    this.errorRegistro = '';
    this.formRegistro = this.proyectoAFormRegistro(proyecto);
    this.sincronizarBusquedasRegistro();
    this.mostrarRegistro = true;
  }

  cerrarRegistro(): void {
    if (this.guardandoRegistro) return;
    this.mostrarRegistro = false;
    this.errorRegistro = '';
    this.registroModo = 'crear';
    this.registroEditarIndice = null;
    this.registroEditarGrupo = null;
    this.cerrarComboboxesRegistro();
  }

  private generarFolioAutomatico(): string {
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const yy = String(hoy.getFullYear()).slice(-2);
    const prefijo = `SP-${dd}${mm}${yy}-`;

    const candidatos = [...this.proyectos, ...this.proyectosGestion]
      .map((p) => String(p?.folio || ''))
      .filter((folio) => folio.startsWith(prefijo))
      .map((folio) => {
        const sec = Number.parseInt(folio.substring(prefijo.length), 10);
        return Number.isFinite(sec) ? sec : 0;
      });

    const siguiente = (candidatos.length ? Math.max(...candidatos) : 0) + 1;
    return `${prefijo}${String(siguiente).padStart(3, '0')}`;
  }

  anchoCargaEquipo(item: CargaEquipoItem): number {
    if (!item.maxProyectos) return 0;
    return Math.round((item.total / item.maxProyectos) * 100);
  }

  etiquetaAvanceInstructor(item: ProgresoActividadesItem): string {
    if (!item.totalActividades) return '0%';
    return `${item.avancePromedio}%`;
  }

  estadoAvanceInstructor(avance: number): 'done' | 'progress' | 'todo' {
    if (avance >= 100) return 'done';
    if (avance > 0) return 'progress';
    return 'todo';
  }

  guardarRegistro(): void {
    if (this.registroModo === 'editar' && !this.puedeEditarProyectoGestion(this.grupoGestionSeleccionado)) {
      this.errorRegistro = 'No tienes permiso para editar este proyecto.';
      return;
    }
    const nombre = String(this.formRegistro.nombreProyecto || '').trim();
    if (!nombre) {
      this.errorRegistro = 'El nombre del proyecto es obligatorio.';
      return;
    }

    if (this.registroModo === 'editar' && this.registroEditarIndice !== null) {
      const base = this.proyectosGestion[this.registroEditarIndice];
      if (!base) {
        this.errorRegistro = 'No se encontró el proyecto a editar.';
        return;
      }

      const actualizado = this.formRegistroAProyecto(base, this.formRegistro);
      this.aplicarEdicionProyectoDesdeRegistro(actualizado, this.registroEditarGrupo, this.registroEditarIndice);

      const nuevaClave = `${actualizado.empresaId || 'sin-empresa'}|${this.normalizar(actualizado.folio || actualizado.nombreProyecto || `idx-${this.registroEditarIndice}`)}`;
      this.gestionProyectoSeleccionadoClave = nuevaClave;
      this.gestionNivelVista = 'actividades';
      this.gestionCambiosPendientes = true;
      this.reconstruirGestionVista();

      this.mostrarRegistro = false;
      this.registroModo = 'crear';
      this.registroEditarIndice = null;
      this.registroEditarGrupo = null;
      this.guardarGestion();
      return;
    }

    this.guardandoRegistro = true;
    this.errorRegistro = '';

    this.backend.crearControlProyecto({
      empresaId: this.formRegistro.empresaId,
      empresaNombre: this.formRegistro.empresaNombre,
      folio: this.formRegistro.folio.trim() || undefined,
      nombreProyecto: nombre,
      item: this.formRegistro.item.trim(),
      condicionRequerimiento: this.formRegistro.condicionRequerimiento.trim(),
      actividadesAccion: this.formRegistro.actividadesAccion.trim(),
      referenciaNormativa: this.formRegistro.referenciaNormativa.trim(),
      responsable: this.formRegistro.responsable.trim(),
      responsableUsuarioIds: this.formRegistro.responsableUsuarioId
        ? [this.formRegistro.responsableUsuarioId]
        : this.resolverUsuarioIdsPorResponsables(this.formRegistro.responsable.trim()),
      fechaInicio: this.formRegistro.fechaInicio || undefined,
      fechaCompromiso: this.formRegistro.fechaCompromiso || undefined,
      entregables: this.formRegistro.entregables.trim(),
      prioridad: this.formRegistro.prioridad || undefined,
      estatus: this.formRegistro.estatus || undefined,
      avance: this.formRegistro.avance
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.guardandoRegistro = false;
          if (!res?.success) {
            this.errorRegistro = res?.message || 'No se pudo registrar el proyecto.';
            return;
          }
          this.mostrarRegistro = false;
          // Recargar con el filtro actual; la empresa elegida en el modal puede ser distinta.
          this.cargarDashboard();
        },
        error: (err) => {
          this.guardandoRegistro = false;
          this.errorRegistro = err?.error?.message || 'No se pudo registrar el proyecto.';
        }
      });
  }

  private formRegistroVacio(): FormRegistroProyecto {
    return {
      empresaId: null,
      empresaNombre: '',
      nombreProyecto: '',
      folio: '',
      item: '',
      condicionRequerimiento: '',
      actividadesAccion: '',
      referenciaNormativa: '',
      responsable: '',
      responsableUsuarioId: null,
      fechaInicio: '',
      fechaCompromiso: '',
      avance: 0,
      entregables: '',
      prioridad: 'Media',
      estatus: 'No iniciado'
    };
  }

  private proyectoAFormRegistro(proyecto: ProyectoTableroItem): FormRegistroProyecto {
    const ids = this.parseResponsableUsuarioIds(proyecto.responsableUsuarioIds);
    return {
      empresaId: proyecto.empresaId || null,
      empresaNombre: proyecto.empresaNombre || '',
      nombreProyecto: proyecto.nombreProyecto || '',
      folio: proyecto.folio || '',
      item: proyecto.item || '',
      condicionRequerimiento: proyecto.condicionRequerimiento || '',
      actividadesAccion: proyecto.actividadesAccion || '',
      referenciaNormativa: proyecto.referenciaNormativa || '',
      responsable: proyecto.responsable || '',
      responsableUsuarioId: ids[0] || this.resolverUsuarioIdPorNombre(this.responsablePrincipal(proyecto)),
      fechaInicio: proyecto.fechaInicio || '',
      fechaCompromiso: proyecto.fechaCompromiso || '',
      avance: proyecto.avance,
      entregables: proyecto.entregables || '',
      prioridad: proyecto.prioridad || 'Media',
      estatus: proyecto.estatus || 'No iniciado'
    };
  }

  /**
   * Aplica datos generales del proyecto a todas las actividades del grupo.
   * Mutación in-place para no romper referencias usadas por la vista agrupada.
   */
  private aplicarEdicionProyectoDesdeRegistro(
    actualizado: ProyectoTableroItem,
    grupo: GrupoGestionProyecto | null,
    indiceFallback: number
  ): void {
    const indices = grupo?.actividades?.length
      ? grupo.actividades.map((a) => a.indice)
      : [indiceFallback];

    const camposProyecto: Partial<ProyectoTableroItem> = {
      empresaId: actualizado.empresaId,
      empresaNombre: actualizado.empresaNombre,
      folio: actualizado.folio,
      nombreProyecto: actualizado.nombreProyecto,
      responsable: actualizado.responsable,
      responsableUsuarioIds: actualizado.responsableUsuarioIds,
      fechaInicio: actualizado.fechaInicio,
      fechaCompromiso: actualizado.fechaCompromiso,
      prioridad: actualizado.prioridad,
      estatus: actualizado.estatus
    };

    for (const indice of indices) {
      const fila = this.proyectosGestion[indice];
      if (!fila) continue;
      Object.assign(fila, camposProyecto);
    }
  }

  private formRegistroAProyecto(base: ProyectoTableroItem, form: FormRegistroProyecto): ProyectoTableroItem {
    const responsable = form.responsable.trim() || 'Sin asignar';
    const ids = form.responsableUsuarioId
      ? [form.responsableUsuarioId]
      : this.resolverUsuarioIdsPorResponsables(responsable);
    return {
      ...base,
      empresaId: form.empresaId,
      empresaNombre: form.empresaNombre.trim(),
      folio: form.folio.trim(),
      nombreProyecto: form.nombreProyecto.trim(),
      item: form.item.trim(),
      condicionRequerimiento: form.condicionRequerimiento.trim(),
      actividadesAccion: form.actividadesAccion.trim(),
      referenciaNormativa: form.referenciaNormativa.trim(),
      responsable,
      responsableUsuarioIds: ids,
      fechaInicio: form.fechaInicio,
      fechaCompromiso: form.fechaCompromiso,
      avance: this.normalizarAvance(form.avance),
      entregables: form.entregables.trim(),
      prioridad: form.prioridad,
      estatus: form.estatus
    };
  }

  sincronizarGestionDesdeProyectos(): void {
    this.proyectosGestion = this.proyectos.map((p) => ({ ...p }));
    this.gestionCambiosPendientes = false;
    this.errorGestion = '';
    this.limpiarFiltrosActividadesGestion();
    this.reconstruirGestionVista();
  }

  marcarGestionCambios(): void {
    this.gestionCambiosPendientes = true;
    this.errorGestion = '';
  }

  private actividadGestionPorIndice(indice: number): ProyectoTableroItem | null {
    return this.proyectosGestion[indice] || null;
  }

  private puedeEditarIndiceGestion(indice: number): boolean {
    return this.puedeEditarActividadGestion(
      this.actividadGestionPorIndice(indice),
      this.grupoGestionSeleccionado
    );
  }

  /** Al guardar: cualquier usuario interno puede persistir cambios de gestión. */
  private puedeEditarActividadAlGuardar(actividad: ProyectoTableroItem): boolean {
    return this.puedeEditarActividadGestion(actividad);
  }

  get proyectosGestionVisibles(): ProyectoTableroItem[] {
    const q = this.normalizar(this.busquedaGestion);
    if (!q) return this.proyectosGestion;
    return this.proyectosGestion.filter((p) =>
      [
        p.folio,
        p.nombreProyecto,
        p.item,
        p.condicionRequerimiento,
        p.actividadesAccion,
        p.referenciaNormativa,
        p.responsable,
        p.entregables,
        p.prioridad,
        p.estatus
      ].some((campo) => this.normalizar(campo).includes(q))
    );
  }

  onAvanceGestionChange(proyecto: ProyectoTableroItem): void {
    if (!this.puedeEditarActividadGestion(proyecto, this.grupoGestionSeleccionado)) return;
    const avance = this.normalizarAvance(proyecto.avance);
    proyecto.avance = avance;
    if (avance >= 100) proyecto.estatus = 'Concluido';
    else if (avance >= 75) proyecto.estatus = 'En revisión';
    else if (avance > 0) proyecto.estatus = 'En proceso';
    else proyecto.estatus = 'No iniciado';
    this.marcarGestionCambios();
  }

  refrescarDesdeBd(): void {
    if (this.sincronizandoDrive || this.guardandoGestion) return;
    this.sincronizandoDrive = true;
    this.errorGestion = '';
    this.backend.refrescarControlProyectosDesdeBd(this.empresaSeleccionadaId || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sincronizandoDrive = false;
          if (!res?.success) {
            this.errorGestion = res?.message || 'No se pudo actualizar desde la base de datos.';
            return;
          }
          this.aplicarDashboard(res);
          this.sincronizarGestionDesdeProyectos();
        },
        error: (err) => {
          this.sincronizandoDrive = false;
          this.errorGestion = err?.error?.message || 'No se pudo actualizar desde la base de datos.';
        }
      });
  }

  indiceGestionProyecto(proyecto: ProyectoTableroItem): number {
    return this.proyectosGestion.findIndex((p) =>
      (p.id && proyecto.id && p.id === proyecto.id)
      || (p.folio && proyecto.folio && p.folio === proyecto.folio && p.nombreProyecto === proyecto.nombreProyecto)
      || p === proyecto
    );
  }

  agregarFilaGestion(): void {
    this.proyectosGestion = [
      ...this.proyectosGestion,
      {
        empresaId: this.empresaSeleccionadaId,
        empresaNombre: this.empresaSeleccionadaNombre === 'Todas las empresas' ? '' : this.empresaSeleccionadaNombre,
        folio: '',
        nombreProyecto: '',
        item: '1',
        condicionRequerimiento: '',
        actividadesAccion: '',
        referenciaNormativa: '',
        responsable: '',
        fechaInicio: '',
        fechaCompromiso: '',
        entregables: '',
        prioridad: 'Media',
        estatus: 'No iniciado',
        avance: 0
      }
    ];
    this.gestionCambiosPendientes = true;
    this.reconstruirGestionVista();
  }

  agregarActividadAProyecto(grupo: GrupoGestionProyecto): void {
    this.agregarActividadAProyectoYGuardar(grupo);
  }

  toggleMenuAgregarActividad(event: Event): void {
    event.stopPropagation();
    if (!this.puedeEditarProyectoGestion(this.grupoGestionSeleccionado)) return;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    this.cerrarMenuResponsablesGestion();
    this.menuAgregarActividadAbierto = !this.menuAgregarActividadAbierto;
  }

  toggleMenuPrioridadGestion(event: Event, indice: number): void {
    event.stopPropagation();
    if (!this.puedeEditarIndiceGestion(indice)) return;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuEstatusGestion();
    this.cerrarMenuResponsablesGestion();
    if (this.menuPrioridadGestionIndice === indice) {
      this.cerrarMenuPrioridadGestion();
      return;
    }
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 180;
    const menuApproxHeight = 280;
    const gap = 6;
    let top = (rect?.bottom || 0) + gap;
    let left = Math.max(8, (rect?.right || menuWidth) - menuWidth);

    if (rect && top + menuApproxHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuApproxHeight - gap);
    }
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }

    this.menuPrioridadGestionIndice = indice;
    this.menuPrioridadGestionStyle = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`
    };
  }

  cerrarMenuPrioridadGestion(): void {
    this.menuPrioridadGestionIndice = null;
    this.menuPrioridadGestionStyle = null;
  }

  toggleMenuEstatusGestion(event: Event, indice: number): void {
    event.stopPropagation();
    if (!this.puedeEditarIndiceGestion(indice)) return;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuResponsablesGestion();
    if (this.menuEstatusGestionIndice === indice) {
      this.cerrarMenuEstatusGestion();
      return;
    }
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 200;
    const menuApproxHeight = 220;
    const gap = 6;
    // Preferir siempre debajo del botón; solo subir si no cabe abajo.
    let top = (rect?.bottom || 0) + gap;
    let left = Math.max(8, rect?.left || 0);

    if (rect && top + menuApproxHeight > window.innerHeight - 8) {
      const espacioAbajo = window.innerHeight - rect.bottom - 8;
      if (espacioAbajo < 120) {
        top = Math.max(8, rect.top - menuApproxHeight - gap);
      }
    }
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }

    this.menuEstatusGestionIndice = indice;
    this.menuEstatusGestionStyle = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`
    };
  }

  cerrarMenuEstatusGestion(): void {
    this.menuEstatusGestionIndice = null;
    this.menuEstatusGestionStyle = null;
  }

  toggleMenuResponsablesGestion(event: Event, indice: number): void {
    event.stopPropagation();
    if (!this.puedeEditarIndiceGestion(indice)) return;
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    if (this.menuResponsablesGestionIndice === indice) {
      this.cerrarMenuResponsablesGestion();
      return;
    }
    this.busquedaResponsablesGestion = '';
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 260;
    const menuApproxHeight = 320;
    const gap = 6;
    let top = (rect?.bottom || 0) + gap;
    let left = Math.max(8, rect?.left || 0);

    if (rect && top + menuApproxHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuApproxHeight - gap);
    }
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }

    this.menuResponsablesGestionIndice = indice;
    this.menuResponsablesGestionStyle = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`
    };
  }

  cerrarMenuResponsablesGestion(): void {
    this.menuResponsablesGestionIndice = null;
    this.menuResponsablesGestionStyle = null;
    this.busquedaResponsablesGestion = '';
  }

  parseResponsables(valor: string | null | undefined): string[] {
    const s = String(valor || '').trim();
    if (!s || this.normalizar(s) === 'sin asignar') return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x || '').trim()).filter(Boolean);
        }
      } catch {
        /* texto plano */
      }
    }
    return s.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
  }

  parseResponsableUsuarioIds(valor: number[] | string | null | undefined): number[] {
    if (Array.isArray(valor)) {
      return valor
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0);
    }
    const s = String(valor || '').trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed
            .map((x) => Number(x))
            .filter((n) => Number.isInteger(n) && n > 0);
        }
      } catch {
        /* texto plano */
      }
    }
    return s.split(/\s*\|\s*/)
      .map((x) => Number(String(x || '').trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  serializeResponsables(lista: string[]): string {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const nombre of lista || []) {
      const limpio = String(nombre || '').trim();
      if (!limpio || this.normalizar(limpio) === 'sin asignar') continue;
      const key = this.normalizar(limpio);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(limpio);
    }
    return unique.join(this.RESPONSABLE_SEP);
  }

  private quitarTituloProfesional(texto: string): string {
    return String(texto || '')
      .replace(/^(ing\.?|lic\.?|mtro\.?|mtra\.?|dr\.?|dra\.?|arq\.?|c\.?p\.?)\s+/i, '')
      .trim();
  }

  private tokensNombre(texto: string): string[] {
    return this.normalizar(this.quitarTituloProfesional(texto))
      .split(/\s+/)
      .filter(Boolean);
  }

  private contieneTodosLosTokens(haystack: string, needle: string): boolean {
    const tokensNeedle = this.tokensNombre(needle);
    if (!tokensNeedle.length) return false;
    const tokensHay = new Set(this.tokensNombre(haystack));
    return tokensNeedle.every((t) => tokensHay.has(t));
  }

  /**
   * Resuelve el ID de trabajador a partir del nombre mostrado.
   * Exige coincidencia única (nombre completo o nombre+apellido) para evitar homónimos.
   */
  resolverUsuarioIdPorNombre(nombreResponsable: string): number | null {
    const limpio = this.normalizar(this.quitarTituloProfesional(nombreResponsable));
    if (!limpio || limpio === 'sin asignar') return null;

    const exactos = this.usuariosInternos.filter(
      (u) => this.normalizar(u.nombreCompleto) === limpio
    );
    if (exactos.length === 1) return exactos[0].id;

    const porNombreApellido = this.usuariosInternos.filter((u) => {
      const nom = this.normalizar(u.nombre);
      const ape = this.normalizar(u.apellido);
      if (!nom) return false;
      if (!this.contieneTodosLosTokens(limpio, nom)) return false;
      if (ape && !this.contieneTodosLosTokens(limpio, ape)) return false;
      // Si el responsable no trae apellido, solo aceptar si el nombre completo
      // del usuario empieza igual y no hay homónimos.
      if (!ape) return this.normalizar(u.nombreCompleto) === limpio;
      return true;
    });
    if (porNombreApellido.length === 1) return porNombreApellido[0].id;

    // Prefijo único: "Ing. José Luis" → "José Luis García" (solo si no hay ambigüedad)
    const porPrefijo = this.usuariosInternos.filter((u) => {
      const full = this.normalizar(u.nombreCompleto);
      return full === limpio || full.startsWith(`${limpio} `) || limpio.startsWith(`${full} `);
    });
    if (porPrefijo.length === 1) return porPrefijo[0].id;

    return null;
  }

  resolverUsuarioIdsPorResponsables(responsableCampo: string): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const nombre of this.parseResponsables(responsableCampo)) {
      const id = this.resolverUsuarioIdPorNombre(nombre);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  private sincronizarIdsResponsables(proyecto: ProyectoTableroItem): void {
    const existentes = this.parseResponsableUsuarioIds(proyecto.responsableUsuarioIds);
    const resueltos = this.resolverUsuarioIdsPorResponsables(proyecto.responsable || '');
    const merged = Array.from(new Set([...existentes, ...resueltos]));
    // Si cambió la lista de nombres, preferir IDs que correspondan a esos nombres
    const porNombres = resueltos.length ? resueltos : merged;
    proyecto.responsableUsuarioIds = porNombres;
  }

  private coincideResponsableConPerfil(
    responsable: string,
    perfil: { nombre: string; apellido: string; completo: string },
    miId: number | null
  ): boolean {
    const limpio = this.normalizar(this.quitarTituloProfesional(responsable));
    if (!limpio) return false;

    // 1) Nombre completo exacto (sin título)
    if (perfil.completo && limpio === perfil.completo) return true;

    // 2) Nombre + apellido (ambos deben aparecer en el responsable)
    if (perfil.nombre && perfil.apellido) {
      if (this.contieneTodosLosTokens(limpio, perfil.nombre)
        && this.contieneTodosLosTokens(limpio, perfil.apellido)) {
        return true;
      }
    }

    // 3) Resolver contra catálogo por ID (cubre "Ing. José Luis" → usuario único)
    const resuelto = this.resolverUsuarioIdPorNombre(responsable);
    if (miId && resuelto === miId) return true;

    return false;
  }

  responsablesDe(proyecto: ProyectoTableroItem | null | undefined): string[] {
    return this.parseResponsables(proyecto?.responsable);
  }

  responsablePrincipal(proyecto: ProyectoTableroItem | null | undefined): string {
    return this.responsablesDe(proyecto)[0] || 'Sin asignar';
  }

  actividadTieneResponsable(proyecto: ProyectoTableroItem, nombre: string): boolean {
    const target = this.normalizar(nombre);
    return this.responsablesDe(proyecto).some((r) => this.normalizar(r) === target);
  }

  coincideFiltroResponsable(proyecto: { responsable?: string } | null | undefined, responsableFiltro: string): boolean {
    const target = this.normalizar(responsableFiltro);
    if (!target) return true;
    const lista = this.parseResponsables(proyecto?.responsable);
    if (!lista.length) return target === 'sin asignar';
    return lista.some((r) => this.normalizar(r) === target);
  }

  toggleResponsableActividad(proyecto: ProyectoTableroItem, nombre: string): void {
    if (!this.puedeEditarActividadGestion(proyecto, this.grupoGestionSeleccionado)) return;
    const lista = this.responsablesDe(proyecto);
    const ids = this.parseResponsableUsuarioIds(proyecto.responsableUsuarioIds);
    const target = this.normalizar(nombre);
    const idx = lista.findIndex((r) => this.normalizar(r) === target);
    const usuarioId = this.resolverUsuarioIdPorNombre(nombre);
    if (idx >= 0) {
      lista.splice(idx, 1);
      if (usuarioId) {
        const idIdx = ids.indexOf(usuarioId);
        if (idIdx >= 0) ids.splice(idIdx, 1);
      }
    } else {
      lista.push(nombre);
      if (usuarioId && !ids.includes(usuarioId)) ids.push(usuarioId);
    }
    proyecto.responsable = this.serializeResponsables(lista) || 'Sin asignar';
    proyecto.responsableUsuarioIds = ids.length
      ? ids
      : this.resolverUsuarioIdsPorResponsables(proyecto.responsable);
    this.marcarGestionCambios();
  }

  get usuariosResponsablesGestionFiltrados(): string[] {
    const q = this.normalizar(this.busquedaResponsablesGestion);
    const base = this.usuariosInternosNombres.length
      ? this.usuariosInternosNombres
      : this.responsablesTablero.filter((r) => this.normalizar(r) !== 'sin asignar');
    if (!q) return base;
    return base.filter((n) => this.normalizar(n).includes(q));
  }

  seleccionarEstatusGestion(proyecto: ProyectoTableroItem, estatus: string): void {
    if (!this.puedeEditarActividadGestion(proyecto, this.grupoGestionSeleccionado)) return;
    proyecto.estatus = estatus;
    if (this.normalizar(estatus) === 'concluido') {
      proyecto.avance = 100;
    } else if (this.normalizar(estatus) === 'no iniciado') {
      proyecto.avance = 0;
    } else if (!proyecto.avance || proyecto.avance <= 0) {
      proyecto.avance = 25;
    }
    this.cerrarMenuEstatusGestion();
    this.marcarGestionCambios();
  }

  seleccionarPrioridadGestion(proyecto: ProyectoTableroItem, prioridad: string): void {
    if (!this.puedeEditarActividadGestion(proyecto, this.grupoGestionSeleccionado)) return;
    proyecto.prioridad = prioridad;
    this.cerrarMenuPrioridadGestion();
    this.marcarGestionCambios();
  }

  agregarActividadAProyectoYGuardar(grupo: GrupoGestionProyecto): void {
    if (!this.puedeEditarProyectoGestion(grupo)) {
      this.errorGestion = 'No tienes permiso para agregar actividades.';
      return;
    }
    this.menuAgregarActividadAbierto = false;
    this.cerrarMenuPrioridadGestion();
    this.cerrarMenuEstatusGestion();
    const base = grupo.actividades[0]?.proyecto;
    if (!base) {
      this.errorGestion = 'No se encontró el proyecto base para agregar actividades.';
      return;
    }
    if (this.guardandoActividadGestion || this.guardandoGestion) return;

    // Si hay cambios pendientes, guardarlos primero y luego crear la actividad.
    if (this.gestionCambiosPendientes) {
      this.errorGestion = '';
      this.guardandoActividadGestion = true;
      this.guardarGestionYContinuar(() => {
        this.guardandoActividadGestion = false;
        const grupoActual = this.gestionAgrupadaLista.find((g) => g.clave === grupo.clave) || grupo;
        this.crearActividadNuevaEnProyecto(grupoActual);
      });
      return;
    }

    this.crearActividadNuevaEnProyecto(grupo);
  }

  private crearActividadNuevaEnProyecto(grupo: GrupoGestionProyecto): void {
    const base = grupo.actividades[0]?.proyecto;
    if (!base) {
      this.errorGestion = 'No se encontró el proyecto base para agregar actividades.';
      return;
    }
    if (this.guardandoActividadGestion || this.guardandoGestion) return;

    const siguienteItem = String(
      Math.max(
        0,
        ...grupo.actividades.map((a) => Number.parseInt(String(a.proyecto.item || '0'), 10) || 0)
      ) + 1
    );

    this.guardandoActividadGestion = true;
    this.errorGestion = '';
    const claveSeleccion = grupo.clave;

    this.backend.crearControlProyecto({
      empresaId: base.empresaId ?? this.empresaSeleccionadaId,
      empresaNombre: base.empresaNombre || '',
      folio: base.folio || undefined,
      nombreProyecto: base.nombreProyecto || grupo.nombreProyecto || 'Proyecto sin nombre',
      item: siguienteItem,
      condicionRequerimiento: '',
      actividadesAccion: '',
      referenciaNormativa: '',
      responsable: base.responsable || '',
      responsableUsuarioIds: this.parseResponsableUsuarioIds(base.responsableUsuarioIds).length
        ? this.parseResponsableUsuarioIds(base.responsableUsuarioIds)
        : this.resolverUsuarioIdsPorResponsables(base.responsable || ''),
      fechaInicio: base.fechaInicio || undefined,
      fechaCompromiso: base.fechaCompromiso || undefined,
      entregables: '',
      prioridad: base.prioridad || 'Media',
      estatus: 'No iniciado',
      avance: 0
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.guardandoActividadGestion = false;
            this.errorGestion = res?.message || 'No se pudo agregar la actividad.';
            return;
          }

          const restaurarVista = () => {
            this.guardandoActividadGestion = false;
            this.sincronizarGestionDesdeProyectos();
            this.gestionProyectoSeleccionadoClave = claveSeleccion;
            this.gestionNivelVista = 'actividades';
            this.asegurarSeleccionProyectoGestion();
          };

          // El endpoint ya devuelve dashboard; si no, recargar para no vaciar la gestión.
          if (Array.isArray(res?.actividades)) {
            this.aplicarDashboard(res);
            restaurarVista();
            return;
          }

          this.backend.obtenerDashboardControlProyectos(this.empresaSeleccionadaId || undefined)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (dash) => {
                if (dash?.success) {
                  this.aplicarDashboard(dash);
                }
                restaurarVista();
              },
              error: () => {
                this.guardandoActividadGestion = false;
                this.errorGestion = 'La actividad se creó, pero no se pudo refrescar el tablero.';
                this.cargarDashboard();
              }
            });
        },
        error: (err) => {
          this.guardandoActividadGestion = false;
          this.errorGestion = err?.error?.message || 'No se pudo agregar la actividad.';
        }
      });
  }

  private guardarGestionYContinuar(onOk: () => void): void {
    const payload = this.proyectosGestion
      .filter((p) => this.puedeEditarActividadAlGuardar(p))
      .map((p) => {
        this.sincronizarIdsResponsables(p);
        return {
          id: p.id || undefined,
          empresaId: p.empresaId || this.empresaSeleccionadaId,
          empresaNombre: String(p.empresaNombre || (this.empresaSeleccionadaNombre === 'Todas las empresas' ? '' : this.empresaSeleccionadaNombre)).trim(),
          folio: String(p.folio || '').trim(),
          nombreProyecto: String(p.nombreProyecto || '').trim(),
          item: String(p.item || '').trim(),
          condicionRequerimiento: String(p.condicionRequerimiento || '').trim(),
          actividadesAccion: String(p.actividadesAccion || '').trim(),
          referenciaNormativa: String(p.referenciaNormativa || '').trim(),
          responsable: String(p.responsable || '').trim(),
          responsableUsuarioIds: this.parseResponsableUsuarioIds(p.responsableUsuarioIds),
          fechaInicio: p.fechaInicio || undefined,
          fechaCompromiso: p.fechaCompromiso || undefined,
          entregables: String(p.entregables || '').trim(),
          prioridad: p.prioridad || undefined,
          estatus: p.estatus || undefined,
          avance: p.avance
        };
      })
      .filter((p) =>
        p.nombreProyecto
        || p.folio
        || p.item
        || p.condicionRequerimiento
        || p.actividadesAccion
        || p.responsable
        || p.id
      );

    // Payload vacío = soft-delete de lo que ya no está en la lista (p. ej. última actividad).
    this.guardandoGestion = true;
    this.errorGestion = '';
    this.backend.guardarControlProyectos(payload, this.empresaSeleccionadaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.guardandoGestion = false;
          if (!res?.success) {
            this.guardandoActividadGestion = false;
            this.errorGestion = res?.message || 'No se pudieron guardar los proyectos.';
            return;
          }
          this.gestionCambiosPendientes = false;
          this.aplicarDashboard(res);
          this.sincronizarGestionDesdeProyectos();
          onOk();
        },
        error: (err) => {
          this.guardandoGestion = false;
          this.guardandoActividadGestion = false;
          this.errorGestion = err?.error?.message || 'No se pudieron guardar los proyectos.';
        }
      });
  }

  actualizarProyectoGestion(
    grupo: GrupoGestionProyecto,
    campo: 'nombreProyecto' | 'responsable' | 'prioridad' | 'estatus' | 'fechaInicio' | 'fechaCompromiso',
    valor: string
  ): void {
    for (const { indice } of grupo.actividades) {
      const fila = this.proyectosGestion[indice];
      if (!fila) continue;
      fila[campo] = valor;
      if (campo === 'responsable') {
        fila.responsableUsuarioIds = this.resolverUsuarioIdsPorResponsables(valor);
      }
    }
    if (campo === 'nombreProyecto') {
      grupo.nombreProyecto = valor || 'Proyecto sin nombre';
    }
    this.marcarGestionCambios();
  }

  desactivarProyectoGestion(grupo: GrupoGestionProyecto): void {
    if (!this.puedeDesactivarProyectoGestion || this.guardandoGestion || this.guardandoActividadGestion) return;
    if (this.gestionCambiosPendientes) {
      this.errorGestion = 'Guarda o descarta los cambios pendientes antes de desactivar el proyecto.';
      return;
    }

    const ids = grupo.actividades
      .map(({ proyecto }) => Number(proyecto?.id || 0))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) {
      this.errorGestion = 'No hay actividades guardadas para desactivar.';
      return;
    }

    const ok = window.confirm(
      `¿Desactivar el proyecto "${grupo.nombreProyecto}"?\n\n`
      + `Se marcarán ${ids.length} actividad(es) como inactivas. `
      + 'Un Super Administrador puede restaurarlas desde la vista de eliminados.'
    );
    if (!ok) return;

    this.guardandoGestion = true;
    this.errorGestion = '';
    this.backend.desactivarProyectoControlProyectos(ids, this.empresaSeleccionadaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.guardandoGestion = false;
          if (!res?.success) {
            this.errorGestion = res?.message || 'No se pudo desactivar el proyecto.';
            return;
          }
          this.aplicarDashboard(res);
          this.sincronizarGestionDesdeProyectos();
          this.volverAListaProyectosGestion();
        },
        error: (err) => {
          this.guardandoGestion = false;
          this.errorGestion = err?.error?.message || 'No se pudo desactivar el proyecto.';
        }
      });
  }

  quitarFilaGestion(indice: number): void {
    if (indice < 0 || indice >= this.proyectosGestion.length) return;
    if (this.guardandoGestion || this.guardandoActividadGestion) return;

    const actividad = this.proyectosGestion[indice];
    if (!this.puedeEliminarActividadGestion(actividad)) {
      this.errorGestion = 'Solo el autor (responsable) de la actividad puede eliminarla.';
      return;
    }

    const claveSeleccion = this.gestionProyectoSeleccionadoClave;
    if (!actividad.id) {
      this.proyectosGestion = this.proyectosGestion.filter((_, i) => i !== indice);
      this.gestionCambiosPendientes = true;
      this.reconstruirGestionVista();
      return;
    }
    if (this.gestionCambiosPendientes) {
      this.errorGestion = 'Guarda los cambios pendientes antes de eliminar una actividad.';
      return;
    }

    this.guardandoGestion = true;
    this.errorGestion = '';
    this.backend.desactivarControlProyectos([actividad.id], this.empresaSeleccionadaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.guardandoGestion = false;
          if (!res?.success) {
            this.errorGestion = res?.message || 'No se pudo eliminar la actividad.';
            return;
          }
          this.aplicarDashboard(res);
          this.sincronizarGestionDesdeProyectos();
          if (claveSeleccion) {
            this.gestionProyectoSeleccionadoClave = claveSeleccion;
            this.gestionNivelVista = 'actividades';
            this.asegurarSeleccionProyectoGestion();
          }
        },
        error: (err) => {
          this.guardandoGestion = false;
          this.errorGestion = err?.error?.message || 'No se pudo eliminar la actividad.';
        }
      });
  }

  guardarGestion(silencioso = false): void {
    const payload = this.proyectosGestion
      .filter((p) => this.puedeEditarActividadAlGuardar(p))
      .map((p) => {
        this.sincronizarIdsResponsables(p);
        return {
          id: p.id || undefined,
          empresaId: p.empresaId || this.empresaSeleccionadaId,
          empresaNombre: String(p.empresaNombre || (this.empresaSeleccionadaNombre === 'Todas las empresas' ? '' : this.empresaSeleccionadaNombre)).trim(),
          folio: String(p.folio || '').trim(),
          nombreProyecto: String(p.nombreProyecto || '').trim(),
          item: String(p.item || '').trim(),
          condicionRequerimiento: String(p.condicionRequerimiento || '').trim(),
          actividadesAccion: String(p.actividadesAccion || '').trim(),
          referenciaNormativa: String(p.referenciaNormativa || '').trim(),
          responsable: String(p.responsable || '').trim(),
          responsableUsuarioIds: this.parseResponsableUsuarioIds(p.responsableUsuarioIds),
          fechaInicio: p.fechaInicio || undefined,
          fechaCompromiso: p.fechaCompromiso || undefined,
          entregables: String(p.entregables || '').trim(),
          prioridad: p.prioridad || undefined,
          estatus: p.estatus || undefined,
          avance: p.avance
        };
      })
      .filter((p) =>
        p.nombreProyecto
        || p.folio
        || p.item
        || p.condicionRequerimiento
        || p.actividadesAccion
        || p.responsable
        || p.id
      );

    if (!payload.length && !this.gestionCambiosPendientes) {
      if (!silencioso) {
        this.errorGestion = 'Agrega al menos una actividad (nombre, condición o acción) para guardar.';
      }
      return;
    }

    this.guardandoGestion = true;
    if (!silencioso) {
      this.errorGestion = '';
    }

    // En auto-guardado al salir no usamos takeUntil(destroy$) para no cancelar el request.
    const req$ = this.backend.guardarControlProyectos(payload, this.empresaSeleccionadaId);
    const obs$ = silencioso ? req$ : req$.pipe(takeUntil(this.destroy$));

    obs$.subscribe({
        next: (res) => {
          this.guardandoGestion = false;
          if (!res?.success) {
            if (!silencioso) {
              this.errorGestion = res?.message || 'No se pudieron guardar los proyectos.';
            }
            return;
          }
          this.gestionCambiosPendientes = false;
          if (!this.gestionComponenteDestruido) {
            this.aplicarDashboard(res);
          }
        },
        error: (err) => {
          this.guardandoGestion = false;
          if (!silencioso) {
            this.errorGestion = err?.error?.message || 'No se pudieron guardar los proyectos.';
          }
        }
      });
  }

  descartarCambiosGestion(): void {
    // Recarga limpia desde BD para recuperar controles/datos si el estado local quedó inconsistente.
    this.gestionCambiosPendientes = false;
    this.errorGestion = '';
    this.refrescarDesdeBd();
  }

  /** Normaliza a yyyy-MM-dd para <input type="date">. */
  fechaInputGestion(valor: string | null | undefined): string {
    const crudo = String(valor || '').trim();
    const iso = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const fecha = this.parsearFechaIso(crudo);
    if (!fecha) return '';
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  setFechaCompromisoGestion(proyecto: ProyectoTableroItem, valor: string): void {
    if (!this.puedeEditarActividadGestion(proyecto, this.grupoGestionSeleccionado)) return;
    proyecto.fechaCompromiso = this.fechaInputGestion(valor);
    this.marcarGestionCambios();
  }

  get tituloRegistroModal(): string {
    return this.registroModo === 'editar' ? 'Editar proyecto' : 'Registrar proyecto';
  }

  get textoBotonRegistroModal(): string {
    if (this.guardandoRegistro) return 'Guardando…';
    return this.registroModo === 'editar' ? 'Aplicar cambios' : 'Guardar proyecto';
  }

  private aplicarDashboard(res: any): void {
    if (!res || typeof res !== 'object') return;

    const k = res.kpis || {};
    const resumen = res.resumen || {};
    const tienePayloadDashboard = Array.isArray(res.actividades) || Array.isArray(res.proyectos);

    // Evita vaciar el tablero si la respuesta no trae el payload del dashboard
    // (p. ej. respuestas parciales de endpoints que solo confirman la operación).
    if (!tienePayloadDashboard) return;

    this.kpis = [
      {
        title: 'Finalizadas',
        value: String(k.finalizados || 0),
        subtitle: 'proyectos concluidos',
        icon: 'fa-check-circle'
      },
      {
        title: 'Actualizadas',
        value: String(k.actualizados || 0),
        subtitle: 'en los últimos 7 días',
        icon: 'fa-bolt'
      },
      {
        title: 'Proyectos',
        value: String(k.creados || 0),
        subtitle: 'registrados',
        icon: 'fa-plus-square'
      },
      {
        title: 'Avance global',
        value: `${resumen.avancePromedio || 0}%`,
        subtitle: 'promedio del portafolio',
        icon: 'fa-chart-line'
      }
    ];

    this.cargaEquipo = Array.isArray(res.cargaEquipo)
      ? res.cargaEquipo.map((c: any) => ({
        responsable: String(c?.responsable || 'Sin asignar'),
        total: Number(c?.total || 0),
        maxProyectos: Number(c?.maxProyectos || 1),
        avancePromedio: this.normalizarAvance(c?.avancePromedio)
      }))
      : [];

    this.progresoActividades = Array.isArray(res.progresoActividades)
      ? res.progresoActividades.map((p: any) => ({
        responsable: String(p?.responsable || 'Sin asignar'),
        totalActividades: Number(p?.totalActividades || 0),
        concluidas: Number(p?.concluidas || 0),
        avancePromedio: this.normalizarAvance(p?.avancePromedio)
      }))
      : [];

    if (Array.isArray(res.proyectos)) {
      this.proyectosResumen = res.proyectos;
    }
    if (Array.isArray(res.actividades)) {
      this.proyectos = res.actividades.map((p: any) => this.normalizarProyecto(p));
    }
    this.avancePromedioPortfolio = Number(resumen.avancePromedio || 0);

    this.actualizarCargaEquipoEnriquecida();

    this.responsablesTablero = Array.from(
      new Set(
        this.proyectos.flatMap((p) => {
          const lista = this.parseResponsables(p.responsable);
          return lista.length ? lista : ['Sin asignar'];
        })
      )
    ).sort((a, b) => a.localeCompare(b, 'es'));

    if (this.proyectoDashboardSeleccionadoClave) {
      const sigueValido = this.proyectosResumen.some(
        (p) => this.claveProyectoDashboard(p) === this.proyectoDashboardSeleccionadoClave
      );
      if (!sigueValido) {
        this.proyectoDashboardSeleccionadoClave = null;
      }
    }

    this.reconstruirCronograma();
    this.actualizarCharts(res);
    this.refrescarChartsDashboard();
    if (this.vistaActiva === 'gestion') {
      this.sincronizarGestionDesdeProyectos();
    }
    this.cargando = false;
    this.errorCarga = false;
    this.activarIntroDashboardSiCorresponde();
  }

  private activarIntroDashboardSiCorresponde(): void {
    if (this.dashboardIntroMostrado) return;
    this.dashboardIntroMostrado = true;
    this.dashboardIntroActiva = true;
    setTimeout(() => {
      this.dashboardIntroActiva = false;
    }, 1100);
  }

  cargarDashboard(): void {
    this.cargando = true;
    this.errorCarga = false;

    this.backend.obtenerDashboardControlProyectos(this.empresaSeleccionadaId || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.errorCarga = true;
            this.cargando = false;
            return;
          }
          this.aplicarDashboard(res);
        },
        error: () => {
          this.errorCarga = true;
          this.cargando = false;
        }
      });
  }

  private actualizarCargaEquipoEnriquecida(): void {
    this.cargaEquipoEnriquecida = this.cargaEquipo.map((m) => ({
      ...m,
      ...this.mezclaCargaEquipo(m.responsable, m.maxProyectos)
    }));
  }

  estadoKey(estatus: string): 'done' | 'progress' | 'review' | 'todo' {
    const n = this.normalizar(estatus);
    if (n === 'concluido') return 'done';
    if (n === 'en revision' || n === 'en revisión') return 'review';
    if (n === 'en proceso') return 'progress';
    return 'todo';
  }

  get totalProyectos(): number {
    return this.proyectosResumen.length;
  }

  get proyectosActivos(): number {
    return this.proyectosResumen.filter((p) => {
      const estatus = this.normalizar(p.estatus);
      return estatus !== 'concluido';
    }).length;
  }

  get proyectosConcluidosDashboard(): number {
    return Math.max(this.totalProyectos - this.proyectosActivos, 0);
  }

  get estatusDominanteDashboard(): { etiqueta: string; pct: number } | null {
    if (!this.estatusDistribucion.length) return null;
    const dominante = this.estatusDistribucion.reduce((prev, item) => (item.total > prev.total ? item : prev), this.estatusDistribucion[0]);
    if (!dominante?.total) return null;
    return {
      etiqueta: dominante.etiqueta,
      pct: dominante.pct
    };
  }

  get actividadesDashboard(): ProyectoTableroItem[] {
    const q = this.normalizar(this.busquedaProyectoDashboard);
    const prioridadFiltro = this.filtroPrioridadDashboard
      ? this.normalizarPrioridad(this.filtroPrioridadDashboard)
      : '';

    return [...this.proyectos]
      .filter((p) => {
        const estatus = this.normalizar(p.estatus);
        if (estatus === 'concluido') return false;
        if (!p.nombreProyecto && !p.folio) return false;

        if (prioridadFiltro) {
          const prioridad = this.normalizarPrioridad(p.prioridad);
          if (prioridad !== prioridadFiltro) return false;
        }

        if (q) {
          const proyecto = this.normalizar(p.nombreProyecto || p.folio);
          if (!proyecto.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => this.ordenPrioridad(a.prioridad) - this.ordenPrioridad(b.prioridad));
  }

  get actividadesDashboardTotalPaginas(): number {
    return Math.max(1, Math.ceil(this.actividadesDashboard.length / this.actividadesDashboardTamanoPagina));
  }

  get actividadesDashboardPaginaActual(): number {
    return Math.min(Math.max(1, this.actividadesDashboardPagina), this.actividadesDashboardTotalPaginas);
  }

  get actividadesDashboardPaginadas(): ProyectoTableroItem[] {
    const pagina = this.actividadesDashboardPaginaActual;
    const inicio = (pagina - 1) * this.actividadesDashboardTamanoPagina;
    return this.actividadesDashboard.slice(inicio, inicio + this.actividadesDashboardTamanoPagina);
  }

  onFiltroActividadesDashboardChange(): void {
    this.actividadesDashboardPagina = 1;
  }

  paginaActividadesDashboardAnterior(): void {
    const actual = this.actividadesDashboardPaginaActual;
    if (actual <= 1) return;
    this.actividadesDashboardPagina = actual - 1;
  }

  paginaActividadesDashboardSiguiente(): void {
    const actual = this.actividadesDashboardPaginaActual;
    if (actual >= this.actividadesDashboardTotalPaginas) return;
    this.actividadesDashboardPagina = actual + 1;
  }

  get proyectosResponsableSeleccionado(): ProyectoTableroItem[] {
    if (!this.filtroResponsable) return [];

    const responsable = this.normalizar(this.filtroResponsable);
    return [...this.proyectos]
      .filter((p) => this.normalizar(p.responsable || 'Sin asignar') === responsable)
      .sort((a, b) => this.ordenPrioridad(a.prioridad) - this.ordenPrioridad(b.prioridad));
  }

  iconoEstatusDistribucion(key: string): string {
    if (key === 'concluido') return 'fa-check-circle';
    if (key === 'en revision' || key === 'en revisión') return 'fa-eye';
    if (key === 'en proceso') return 'fa-spinner';
    return 'fa-clock';
  }

  prioridadClase(prioridad: string): string {
    const n = this.normalizarPrioridad(prioridad);
    if (n === 'muy prioritaria') return 'cp-priority--very-high';
    if (n === 'prioritaria') return 'cp-priority--high';
    if (n === 'media') return 'cp-priority--medium';
    if (n === 'baja') return 'cp-priority--low';
    if (n === 'muy baja') return 'cp-priority--very-low';
    return 'cp-priority--none';
  }

  colorAvatar(nombre: string): string {
    const paleta = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#059669', '#4f46e5'];
    const texto = String(nombre || 'Sin asignar');
    let hash = 0;
    for (let i = 0; i < texto.length; i++) {
      hash = texto.charCodeAt(i) + ((hash << 5) - hash);
    }
    return paleta[Math.abs(hash) % paleta.length];
  }

  iniciales(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '–';
    const primera = partes[0].charAt(0);
    const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (primera + ultima).toUpperCase();
  }

  private normalizarProyecto(item: any): ProyectoTableroItem {
    const responsable = String(item?.responsable || '').trim() || 'Sin asignar';
    let responsableUsuarioIds = this.parseResponsableUsuarioIds(
      item?.responsableUsuarioIds ?? item?.responsable_usuario_ids
    );
    if (!responsableUsuarioIds.length) {
      responsableUsuarioIds = this.resolverUsuarioIdsPorResponsables(responsable);
    }
    return {
      id: item?.id ? Number(item.id) : undefined,
      empresaId: item?.empresaId ? Number(item.empresaId) : null,
      empresaNombre: String(item?.empresaNombre || '').trim(),
      folio: String(item?.folio || '').trim(),
      nombreProyecto: String(item?.nombreProyecto || '').trim(),
      item: String(item?.item || '').trim(),
      condicionRequerimiento: String(item?.condicionRequerimiento || '').trim(),
      actividadesAccion: String(item?.actividadesAccion || '').trim(),
      referenciaNormativa: String(item?.referenciaNormativa || '').trim(),
      responsable,
      responsableUsuarioIds,
      fechaInicio: this.fechaInputGestion(item?.fechaInicio),
      fechaCompromiso: this.fechaInputGestion(item?.fechaCompromiso),
      entregables: String(item?.entregables || '').trim(),
      prioridad: String(item?.prioridad || '').trim() || 'Ninguna',
      estatus: String(item?.estatus || '').trim() || 'No iniciado',
      avance: this.normalizarAvance(item?.avance),
      activo: item?.activo !== false,
      modificadoPor: item?.modificadoPor || null,
      modificadoEn: item?.modificadoEn || null,
      eliminadoPor: item?.eliminadoPor || null,
      eliminadoEn: item?.eliminadoEn || null,
      createdAt: item?.createdAt || null,
      updatedAt: item?.updatedAt || null
    };
  }

  private reconstruirCronograma(): void {
    this.proyectosCronograma = this.proyectos.map((p, index) => this.calcularFechasProyecto(p, index));
    this.calcularRangoYPeriodos();
  }

  private calcularFechasProyecto(p: ProyectoTableroItem, index: number): ProyectoCronogramaItem {
    const hoy = this.inicioDia(new Date());
    let fechaInicio = this.parsearFechaIso(p.fechaInicio)
      || this.parsearFechaFolio(p.folio)
      || this.parsearFechaIso(p.createdAt)
      || this.sumarDias(hoy, -30 - index * 7);

    const duracionDias = this.duracionPorPrioridad(p.prioridad);
    let fechaFin = this.parsearFechaIso(p.fechaCompromiso)
      || this.sumarDias(fechaInicio, duracionDias);

    const estatus = this.normalizar(p.estatus);
    if (estatus === 'concluido') {
      const finReal = this.parsearFechaIso(p.updatedAt);
      if (finReal && finReal >= fechaInicio) {
        fechaFin = finReal;
      }
    } else if (estatus === 'en proceso') {
      fechaFin = this.maxFecha(fechaFin, this.sumarDias(hoy, 14));
    } else if (fechaFin < hoy) {
      fechaFin = this.sumarDias(hoy, 21);
    }

    if (fechaFin <= fechaInicio) {
      fechaFin = this.sumarDias(fechaInicio, Math.max(duracionDias, 14));
    }

    return { ...p, fechaInicio, fechaFin };
  }

  private calcularRangoYPeriodos(): void {
    const hoy = this.inicioDia(new Date());
    const visibles = this.proyectosCronograma.length ? this.proyectosCronograma : [];

    let inicio = visibles.length
      ? new Date(Math.min(...visibles.map((p) => p.fechaInicio.getTime())))
      : this.sumarDias(hoy, -45);
    let fin = visibles.length
      ? new Date(Math.max(...visibles.map((p) => p.fechaFin.getTime())))
      : this.sumarDias(hoy, 90);

    inicio = this.sumarDias(inicio, -14);
    fin = this.sumarDias(fin, 21);

    this.rangoCronogramaInicio = this.alinearInicioPeriodo(inicio);
    this.rangoCronogramaFin = this.alinearFinPeriodo(fin);

    if (this.rangoCronogramaFin <= this.rangoCronogramaInicio) {
      this.rangoCronogramaFin = this.sumarDias(this.rangoCronogramaInicio, 90);
    }

    this.periodosTimeline = this.generarPeriodos();
    this.timelineAnchoTotal = this.periodosTimeline.reduce((acc, p) => acc + p.anchoPx, 0);

    const totalMs = this.rangoCronogramaFin.getTime() - this.rangoCronogramaInicio.getTime();
    this.posicionHoyPx = totalMs > 0
      ? ((hoy.getTime() - this.rangoCronogramaInicio.getTime()) / totalMs) * this.timelineAnchoTotal
      : 0;
  }

  private generarPeriodos(): PeriodoCronograma[] {
    const periodos: PeriodoCronograma[] = [];
    const cursor = new Date(this.rangoCronogramaInicio);
    const mesesCortos = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    if (this.escalaCronograma === 'semanas') {
      while (cursor < this.rangoCronogramaFin) {
        const finSemana = this.sumarDias(cursor, 7);
        periodos.push({
          label: `${cursor.getDate()} ${mesesCortos[cursor.getMonth()]}`,
          anchoPx: 72
        });
        cursor.setTime(finSemana.getTime());
      }
      return periodos;
    }

    if (this.escalaCronograma === 'trimestres') {
      while (cursor < this.rangoCronogramaFin) {
        const trimestre = Math.floor(cursor.getMonth() / 3) + 1;
        periodos.push({
          label: `T${trimestre} ${cursor.getFullYear()}`,
          anchoPx: 140
        });
        cursor.setMonth(cursor.getMonth() + 3, 1);
      }
      return periodos;
    }

    while (cursor < this.rangoCronogramaFin) {
      periodos.push({
        label: `${mesesCortos[cursor.getMonth()]} ${cursor.getFullYear()}`,
        anchoPx: 100
      });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
    return periodos;
  }

  private duracionPorPrioridad(prioridad: string): number {
    const n = this.normalizarPrioridad(prioridad);
    if (n === 'muy prioritaria') return 14;
    if (n === 'prioritaria') return 28;
    if (n === 'media') return 60;
    if (n === 'baja') return 90;
    if (n === 'muy baja') return 180;
    return 60;
  }

  private parsearFechaFolio(folio: string): Date | null {
    const texto = String(folio || '');
    const matchPm = texto.match(/^PM-(\d{2})(\d{2})(\d{2})-\d+$/i);
    const matchSp = texto.match(/^SP-(\d{2})(\d{2})(\d{2})-\d+$/i);
    const match = matchPm || matchSp;
    if (!match) return null;
    const dd = Number(match[1]);
    const mm = Number(match[2]) - 1;
    const yy = 2000 + Number(match[3]);
    const fecha = new Date(yy, mm, dd);
    return Number.isNaN(fecha.getTime()) ? null : this.inicioDia(fecha);
  }

  private parsearFechaIso(valor: unknown): Date | null {
    if (!valor) return null;
    const fecha = new Date(String(valor));
    return Number.isNaN(fecha.getTime()) ? null : this.inicioDia(fecha);
  }

  private inicioDia(fecha: Date): Date {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  }

  private sumarDias(fecha: Date, dias: number): Date {
    const copia = new Date(fecha);
    copia.setDate(copia.getDate() + dias);
    return this.inicioDia(copia);
  }

  private maxFecha(a: Date, b: Date): Date {
    return a.getTime() >= b.getTime() ? a : b;
  }

  private alinearInicioPeriodo(fecha: Date): Date {
    const d = this.inicioDia(fecha);
    if (this.escalaCronograma === 'semanas') {
      const dia = d.getDay();
      const diff = dia === 0 ? -6 : 1 - dia;
      return this.sumarDias(d, diff);
    }
    if (this.escalaCronograma === 'trimestres') {
      const mes = Math.floor(d.getMonth() / 3) * 3;
      return new Date(d.getFullYear(), mes, 1);
    }
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  private alinearFinPeriodo(fecha: Date): Date {
    const d = this.inicioDia(fecha);
    if (this.escalaCronograma === 'semanas') {
      return this.sumarDias(this.alinearInicioPeriodo(d), 7);
    }
    if (this.escalaCronograma === 'trimestres') {
      const mes = Math.floor(d.getMonth() / 3) * 3 + 3;
      return new Date(d.getFullYear(), mes, 0);
    }
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  private actualizarCharts(res: any): void {
    const distEstatus = Array.isArray(res?.distribuciones?.porEstatus) ? res.distribuciones.porEstatus : [];
    const distPrioridad = Array.isArray(res?.distribuciones?.porPrioridad) ? res.distribuciones.porPrioridad : [];

    const mapaEstatus = new Map<string, number>();
    for (const d of distEstatus) {
      const etiqueta = this.etiquetaEstatusDashboard(String(d?.etiqueta || ''));
      mapaEstatus.set(etiqueta, (mapaEstatus.get(etiqueta) || 0) + Number(d?.total || 0));
    }

    const estatusSeries = this.estatusDashboard.map((etiqueta) => mapaEstatus.get(etiqueta) || 0);
    const totalEstatus = estatusSeries.reduce((acc, n) => acc + n, 0) || 1;

    this.portfolioEstatusDistribucion = this.estatusDashboard.map((etiqueta) => {
      const clave = this.normalizar(etiqueta);
      const total = mapaEstatus.get(etiqueta) || 0;
      return {
        etiqueta,
        total,
        color: this.coloresEstatusSuaves[clave] || '#cbd5e1',
        key: clave,
        pct: Math.round((total / totalEstatus) * 100),
        alturaPct: 0,
        icono: this.iconoEstatusDistribucion(clave)
      };
    });

    const mapaPrioridad = new Map<string, number>();
    for (const d of distPrioridad) {
      const etiqueta = this.etiquetaPrioridadDashboard(String(d?.etiqueta || ''));
      mapaPrioridad.set(etiqueta, (mapaPrioridad.get(etiqueta) || 0) + Number(d?.total || 0));
    }

    const etiquetasPrioridad = [
      ...this.prioridadesRegistro,
      ...Array.from(mapaPrioridad.keys()).filter((etiqueta) => !this.prioridadesRegistro.includes(etiqueta))
    ];

    const prioridadTotales = etiquetasPrioridad.map((etiqueta) => mapaPrioridad.get(etiqueta) || 0);
    const prioridadMax = Math.max(...prioridadTotales, 1);
    const prioridadSuma = prioridadTotales.reduce((acc, n) => acc + n, 0) || 1;

    this.prioridadDistribucion = etiquetasPrioridad.map((etiqueta) => {
      const total = mapaPrioridad.get(etiqueta) || 0;
      return {
        etiqueta,
        total,
        color: this.coloresPrioridadSistema[etiqueta] || '#94a3b8',
        pct: Math.round((total / prioridadSuma) * 100),
        alturaPct: Math.max(Math.round((total / prioridadMax) * 100), total > 0 ? 18 : 6)
      };
    });

    const resumen = res?.resumen || {};
    const totalProy = Number(resumen.total || this.proyectosResumen.length || 0);
    const concluidos = Number(resumen.concluidos || 0);
    const enRevision = Number(resumen.enRevision || 0);
    const enProceso = Number(resumen.enProceso || 0);
    const noIniciados = Number(resumen.noIniciados || 0);

    this.portfolioResumenAvanceTarjetas = [
      {
        label: 'Concluidos',
        valor: concluidos,
        total: totalProy,
        detalle: `de ${totalProy} proyecto${totalProy === 1 ? '' : 's'}`,
        color: '#10b981',
        key: 'concluido',
        mostrarTotal: true
      },
      {
        label: 'En revisión',
        valor: enRevision,
        total: totalProy,
        detalle: 'en revisión',
        color: '#a855f7',
        key: 'en revision'
      },
      {
        label: 'En proceso',
        valor: enProceso,
        total: totalProy,
        detalle: 'activos',
        color: '#3b82f6',
        key: 'en proceso'
      },
      {
        label: 'No iniciados',
        valor: noIniciados,
        total: totalProy,
        detalle: 'pendientes',
        color: '#f59e0b',
        key: 'no iniciado'
      }
    ];

    this.actualizarVistaChartsDashboard();
  }

  private actualizarVistaChartsDashboard(): void {
    const proyecto = this.proyectoDashboardSeleccionado;
    if (proyecto) {
      this.aplicarDistribucionesDesdeItems(
        this.actividadesDelProyectoDashboard(proyecto),
        'actividad'
      );
    } else {
      this.estatusDistribucion = this.portfolioEstatusDistribucion.map((item) => ({ ...item }));
      this.resumenAvanceTarjetas = this.portfolioResumenAvanceTarjetas.map((item) => ({ ...item }));
      this.totalEstatusVista = this.estatusDistribucion.reduce((acc, item) => acc + item.total, 0);
      this.aplicarPrioridadDesdeItems(this.proyectosResumen);
    }

    this.actualizarChartEstado();
    this.actualizarChartPrioridadDistribucion();
  }

  private aplicarDistribucionesDesdeItems(
    items: Array<{ estatus?: string; prioridad?: string; avance?: number }>,
    unidad: 'proyecto' | 'actividad'
  ): void {
    const mapaEstatus = new Map<string, number>();
    for (const etiqueta of this.estatusDashboard) {
      mapaEstatus.set(etiqueta, 0);
    }

    for (const item of items) {
      const etiqueta = this.etiquetaEstatusDashboard(String(item?.estatus || 'No iniciado'));
      mapaEstatus.set(etiqueta, (mapaEstatus.get(etiqueta) || 0) + 1);
    }

    const total = items.length;
    this.totalEstatusVista = total;
    const totalBase = total || 1;

    this.estatusDistribucion = this.estatusDashboard.map((etiqueta) => {
      const clave = this.normalizar(etiqueta);
      const valor = mapaEstatus.get(etiqueta) || 0;
      return {
        etiqueta,
        total: valor,
        color: this.coloresEstatusSuaves[clave] || '#cbd5e1',
        key: clave,
        pct: Math.round((valor / totalBase) * 100),
        alturaPct: 0,
        icono: this.iconoEstatusDistribucion(clave)
      };
    });

    const unidadPlural = unidad === 'actividad'
      ? (total === 1 ? 'actividad' : 'actividades')
      : (total === 1 ? 'proyecto' : 'proyectos');

    this.resumenAvanceTarjetas = [
      {
        label: 'Concluidos',
        valor: mapaEstatus.get('Concluido') || 0,
        total,
        detalle: `de ${total} ${unidadPlural}`,
        color: '#10b981',
        key: 'concluido',
        mostrarTotal: true
      },
      {
        label: 'En revisión',
        valor: mapaEstatus.get('En revisión') || 0,
        total,
        detalle: unidad === 'actividad' ? 'en revisión' : 'en revisión',
        color: '#a855f7',
        key: 'en revision'
      },
      {
        label: 'En proceso',
        valor: mapaEstatus.get('En proceso') || 0,
        total,
        detalle: unidad === 'actividad' ? 'en proceso' : 'activos',
        color: '#3b82f6',
        key: 'en proceso'
      },
      {
        label: 'No iniciados',
        valor: mapaEstatus.get('No iniciado') || 0,
        total,
        detalle: 'pendientes',
        color: '#f59e0b',
        key: 'no iniciado'
      }
    ];

    this.aplicarPrioridadDesdeItems(items);
  }

  private aplicarPrioridadDesdeItems(
    items: Array<{ prioridad?: string }>
  ): void {
    const conteo = new Map<string, number>();
    for (const pr of this.prioridadesRegistro) {
      conteo.set(pr, 0);
    }

    for (const item of items) {
      const etiqueta = this.prioridadesRegistro.find(
        (pr) => this.normalizarPrioridad(pr) === this.normalizarPrioridad(item?.prioridad)
      ) || 'Ninguna';
      conteo.set(etiqueta, (conteo.get(etiqueta) || 0) + 1);
    }

    const valores = this.prioridadesRegistro.map((nombre) => conteo.get(nombre) || 0);
    const total = valores.reduce((acc, v) => acc + v, 0);
    this.totalPrioridadVista = total;

    this.prioridadDistribucionVista = this.prioridadesRegistro.map((nombre) => {
      const valor = conteo.get(nombre) || 0;
      return {
        etiqueta: nombre,
        total: valor,
        color: this.coloresPrioridadSistema[nombre] || '#94a3b8',
        pct: total ? Math.round((valor / total) * 100) : 0
      };
    });
  }

  private actualizarChartPrioridadDistribucion(): void {
    const valores = this.prioridadDistribucionVista.map((item) => item.total);
    const total = this.totalPrioridadVista;
    const unidad = this.hayProyectoDashboardSeleccionado ? 'actividad' : 'proyecto';

    const serieDatos = this.prioridadDistribucionVista
      .map((item) => {
        const colorBase = item.color || '#94a3b8';
        return {
          value: item.total,
          name: item.etiqueta,
          itemStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 1,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorBase },
                { offset: 1, color: this.colorPrioridadSuave(item.etiqueta) }
              ]
            },
            borderColor: '#ffffff',
            borderWidth: 2,
            borderRadius: 6,
            shadowBlur: item.total > 0 ? 8 : 0,
            shadowColor: item.total > 0 ? `${colorBase}55` : 'transparent'
          }
        };
      })
      .filter((item) => item.value > 0);

    const baseData = total
      ? serieDatos
      : [{ name: 'Sin datos', value: 1, itemStyle: { color: '#e8edf4', borderColor: '#fff', borderWidth: 2 } }];

    const padAngle = total > 1 ? 2 : 0;

    this.prioridadDistribucionChartOption = {
      animationDuration: 650,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(148, 163, 184, 0.4)',
        textStyle: { color: '#f8fafc' },
        formatter: (params: any) => {
          if (!total) {
            return unidad === 'actividad' ? 'Sin actividades registradas' : 'Sin proyectos registrados';
          }
          const pct = Math.round(((Number(params?.value || 0)) / total) * 100);
          const label = unidad === 'actividad'
            ? `actividad${params.value === 1 ? '' : 'es'}`
            : `proyecto${params.value === 1 ? '' : 's'}`;
          return `${params.name}<br/><b>${params.value}</b> ${label} (${pct}%)`;
        }
      },
      series: [
        {
          type: 'pie',
          radius: ['56%', '82%'],
          center: ['50%', '50%'],
          startAngle: 90,
          minAngle: 8,
          padAngle,
          clockwise: true,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: '#ffffff',
            borderWidth: 2,
            borderRadius: 6
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: {
              shadowBlur: 14,
              shadowColor: 'rgba(15, 23, 42, 0.18)'
            }
          },
          data: baseData
        }
      ]
    };
  }

  private colorPrioridadSuave(prioridad: string): string {
    const mapa: Record<string, string> = {
      'Muy Prioritaria': '#f87171',
      Prioritaria: '#fb923c',
      Media: '#fbbf24',
      Baja: '#60a5fa',
      'Muy baja': '#a78bfa',
      Ninguna: '#94a3b8'
    };
    return mapa[prioridad] || '#cbd5e1';
  }

  private actualizarChartEstado(): void {
    const data = this.estatusDistribucion.map((item) => ({
      name: item.etiqueta,
      value: item.total,
      itemStyle: { color: item.color }
    }));

    const total = this.estatusDistribucion.reduce((acc, item) => acc + item.total, 0);
    this.totalEstatusVista = total;
    const vistaCompacta = this.esVistaCompacta();
    const vistaMuyCompacta = this.esVistaMuyCompacta();
    const unidad = this.hayProyectoDashboardSeleccionado ? 'actividad' : 'proyecto';

    const padAngle = total > 2 ? 1.5 : 0;
    const baseData = total ? data : [{ name: 'Sin datos', value: 1, itemStyle: { color: '#e2e8f0' } }];
    const radioInterno = vistaMuyCompacta ? '54%' : vistaCompacta ? '56%' : '58%';
    const radioExterno = vistaMuyCompacta ? '76%' : vistaCompacta ? '78%' : '80%';

    this.estadoChartOption = {
      animationDuration: 560,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderColor: 'rgba(148, 163, 184, 0.35)',
        textStyle: { color: '#f8fafc' },
        formatter: (params: any) => {
          if (!total) {
            return unidad === 'actividad' ? 'Sin actividades registradas' : 'Sin proyectos registrados';
          }
          const label = unidad === 'actividad'
            ? `actividad${params.value === 1 ? '' : 'es'}`
            : `proyecto${params.value === 1 ? '' : 's'}`;
          return `${params.name}<br/><b>${params.value}</b> ${label} (${params.percent}%)`;
        }
      },
      series: [
        {
          type: 'pie',
          radius: [radioInterno, radioExterno],
          center: ['50%', '50%'],
          startAngle: 90,
          minAngle: 6,
          padAngle,
          clockwise: true,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: '#f8fafc',
            borderWidth: 3,
            borderRadius: 8,
            shadowBlur: 6,
            shadowColor: 'rgba(15, 23, 42, 0.08)'
          },
          label: {
            show: false
          },
          labelLine: {
            show: false
          },
          emphasis: {
            scale: true,
            scaleSize: 6
          },
          data: baseData
        }
      ]
    };
  }

  private actualizarChartPrioridad(): void {
    const categorias = this.prioridadDistribucion.map((item) => item.etiqueta);
    const valores = this.prioridadDistribucion.map((item) => item.total);
    const total = valores.reduce((acc, n) => acc + n, 0);
    const max = Math.max(...valores, 1);
    const hayFiltro = !!this.filtroPrioridadDashboard;
    const vistaCompacta = this.esVistaCompacta();
    const vistaMuyCompacta = this.esVistaMuyCompacta();
    const grosorBarra = vistaMuyCompacta ? 12 : vistaCompacta ? 14 : 18;

    this.prioridadChartOption = {
      animationDuration: 620,
      animationEasing: 'cubicOut',
      grid: {
        top: vistaCompacta ? 6 : 10,
        right: vistaCompacta ? 10 : 14,
        bottom: 8,
        left: vistaCompacta ? 5 : 8,
        containLabel: true
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderColor: 'rgba(148, 163, 184, 0.35)',
        textStyle: { color: '#f8fafc' },
        formatter: (params: any) => {
          if (!total) return 'Sin proyectos registrados';
          const pct = Math.round(((Number(params?.value || 0)) / total) * 100);
          return `${params.name}<br/><b>${params.value}</b> proyecto${params.value === 1 ? '' : 's'} (${pct}%)`;
        }
      },
      xAxis: {
        type: 'value',
        min: 0,
        max,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#94a3b8',
          fontSize: vistaCompacta ? 9 : 10
        },
        splitLine: {
          lineStyle: {
            color: '#edf2f7',
            type: 'dashed'
          }
        }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#334155',
          fontSize: vistaCompacta ? 10 : 11,
          fontWeight: 700,
          margin: vistaCompacta ? 8 : 12,
          formatter: (value: string) => this.etiquetaPrioridadCorta(value, vistaCompacta)
        },
        data: categorias
      },
      series: [
        {
          type: 'bar',
          silent: true,
          data: valores.map(() => max),
          barWidth: grosorBarra,
          barGap: '-100%',
          itemStyle: {
            color: '#eef2f7',
            borderRadius: 999
          },
          z: 1
        },
        {
          type: 'bar',
          data: this.prioridadDistribucion.map((item) => {
            const opacidad = hayFiltro && !this.prioridadDashboardActiva(item.etiqueta) ? 0.3 : 1;
            return {
              value: item.total,
              name: item.etiqueta,
              itemStyle: {
                color: item.color,
                opacity: opacidad,
                borderRadius: 999,
                shadowBlur: this.prioridadDashboardActiva(item.etiqueta) ? 10 : 0,
                shadowColor: this.prioridadDashboardActiva(item.etiqueta) ? item.color : 'transparent'
              }
            };
          }),
          barWidth: grosorBarra,
          z: 3,
          label: {
            show: true,
            position: 'right',
            distance: vistaCompacta ? 5 : 8,
            color: '#334155',
            fontWeight: 700,
            fontSize: vistaCompacta ? 10 : 11,
            formatter: (params: any) => {
              if (!total) return '';
              const value = Number(params?.value || 0);
              if (!value) return vistaCompacta ? '' : '0 · 0%';
              const pct = Math.round((Number(params?.value || 0) / total) * 100);
              return vistaCompacta ? `${value}` : `${value} · ${pct}%`;
            }
          }
        }
      ]
    };
  }

  private esVistaCompacta(): boolean {
    return typeof window !== 'undefined' ? window.innerWidth <= 1440 : false;
  }

  private esVistaMuyCompacta(): boolean {
    return typeof window !== 'undefined' ? window.innerWidth <= 1200 : false;
  }

  private etiquetaPrioridadCorta(etiqueta: string, compacta: boolean): string {
    const texto = String(etiqueta || '').trim();
    if (!compacta || texto.length <= 12) return texto;

    const n = this.normalizarPrioridad(texto);
    if (n === 'muy prioritaria') return 'Muy prior.';
    if (n === 'prioritaria') return 'Prioritaria';
    if (n === 'media') return 'Media';
    if (n === 'muy baja') return 'Muy baja';
    if (n === 'baja') return 'Baja';
    if (n === 'ninguna') return 'Ninguna';
    return `${texto.slice(0, 10).trim()}…`;
  }

  private etiquetaEstatusDashboard(valor: string): string {
    const n = this.normalizar(valor);
    if (n === 'concluido' || n === 'completado' || n === 'finalizado' || n === 'cerrado' || n === 'terminado') {
      return 'Concluido';
    }
    if (n === 'en revision' || n === 'en revisión') return 'En revisión';
    if (n === 'en proceso') return 'En proceso';
    if (n === 'no iniciado' || !n) return 'No iniciado';
    return 'No iniciado';
  }

  private etiquetaPrioridadDashboard(valor: string): string {
    const n = this.normalizarPrioridad(valor);
    const prioridad = this.prioridadesRegistro.find((item) => this.normalizarPrioridad(item) === n);
    if (prioridad) return prioridad;
    return String(valor || '').trim() || 'Ninguna';
  }

  private normalizarAvance(valor: unknown): number {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return 0;
    let n = Number(crudo);
    if (!Number.isFinite(n)) return 0;
    if (n > 0 && n <= 1) n = n * 100;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }

  private normalizar(texto: string): string {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
