import { Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import Swal from 'sweetalert2';
import { SGC_CAPITULOS_ORDEN } from './sgc-formatos.catalog';

import {
  ApexAxisChartSeries,
  ApexNonAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexDataLabels,
  ApexStroke,
  ApexFill,
  ApexTooltip,
  ApexGrid,
  ApexLegend,
  ApexMarkers,
  ApexPlotOptions,
  ApexResponsive
} from 'ng-apexcharts';

export type SgcAreaChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis | ApexYAxis[];
  dataLabels: ApexDataLabels;
  stroke: ApexStroke;
  fill: ApexFill;
  tooltip: ApexTooltip;
  grid: ApexGrid;
  colors: string[];
  legend?: ApexLegend;
  markers?: ApexMarkers;
  plotOptions?: ApexPlotOptions;
};

export type SgcRadialChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  plotOptions?: ApexPlotOptions;
  fill?: ApexFill;
  stroke?: ApexStroke;
  legend?: ApexLegend;
  dataLabels?: ApexDataLabels;
  tooltip?: ApexTooltip;
  responsive?: ApexResponsive[];
};

interface SgcKpiCard {
  titulo: string;
  valor: string;
  subtitulo: string;
  icono: string;
  color: string;
  gradiente: string;
  estado?: 'verde' | 'amarillo' | 'rojo';
}

interface QuejaSgc {
  queja_id: number;
  fecha: string | null;
  cliente: string;
  descripcion: string;
  estatus: string;
  area: string;
}

interface EvaluacionProveedorSgc {
  evaluacion_id: number;
  fecha: string | null;
  proveedor: string;
  calificacion: number;
  observaciones: string;
}

interface AuditoriaSgc {
  auditoria_id: number;
  historialId?: number | null;
  auditoriaNo?: string;
  anio: number;
  fecha: string | null;
  fechasAuditoria?: string;
  titulo: string;
  area: string;
  no_conformidades: number;
  totalHallazgos?: number;
  totalOp?: number;
  totalNcMenor?: number;
  totalNcMayor?: number;
  observaciones: string;
  nivel: 'alto' | 'medio' | 'bajo';
  nivelEtiqueta: string;
  cerrado?: boolean;
  enCurso?: boolean;
  fuente?: string;
  origen?: string;
  driveFileId?: string | null;
  editorUrl?: string | null;
}

interface QuejaSugerenciaSgc {
  id: number;
  folio: string;
  fecha: string | null;
  empresa: string;
  area: string;
  descripcion: string;
  fuente: string;
  estatus: string;
  estado?: string;
  abierta: boolean;
}

interface ChartKpiBadge {
  label: string;
  subtitulo: string;
  icono: string;
  color: string;
  gradiente: string;
  valor?: string | number;
  clave?: string;
}

@Component({
  selector: 'app-sistema-gestion-calidad',
  templateUrl: './sistema-gestion-calidad.component.html',
  styleUrls: ['./sistema-gestion-calidad.component.scss']
})
export class SistemaGestionCalidadComponent implements OnInit, OnDestroy {

  private readonly palette = {
    teal: '#15a596',
    tealDark: '#0f766e',
    satCliente: '#1e9d8e',
    satClienteLight: '#5eead4',
    azul: '#2563eb',
    morado: '#7c3aed',
    ambar: '#f59e0b',
    rojo: '#e11d48',
    verde: '#16a34a',
    gris: '#94a3b8',
    naranja: '#ea580c'
  };

  etiquetaRolUsuario = '';

  cargandoDashboard = true;
  errorDashboard = false;
  anioActual = new Date().getFullYear();
  anioSeleccionado = new Date().getFullYear();
  aniosDisponibles: number[] = [];
  chartsReady = false;
  indicadoresIntro = false;
  animacionIntroCompleta = false;

  donutCentroValor: number | string = 0;
  donutCentroEtiqueta = 'Proyectos';
  donutCentroPct = 0;

  eficaciaDonutCentroValor: number | string = 0;
  eficaciaDonutCentroEtiqueta = 'NC actuales';
  eficaciaDonutCentroSub = '';
  /** Modo del donut: eficacia (0–2 / 3–4 / ≥5) o detalle OP/NC de la auditoría seleccionada. */
  eficaciaChartModo: 'eficacia' | 'clasificacion' = 'eficacia';
  auditoriaSeleccionada: AuditoriaSgc | null = null;

  capDonutCentroValor: number | string = '0%';
  capDonutCentroEtiqueta = 'Aprobación';
  capDonutCentroSub = '';

  satDonutCentroValor: number | string = 0;
  satDonutCentroEtiqueta = 'Respuestas';
  satDonutCentroSub = '';

  satCapDonutCentroValor: number | string = 0;
  satCapDonutCentroEtiqueta = 'Respuestas';
  satCapDonutCentroSub = '';

  quejasSugDonutCentroValor: number | string = 0;
  quejasSugDonutCentroEtiqueta = 'Quejas abiertas';
  quejasSugDonutCentroSub = '';

  provF29DonutCentroValor: number | string = 0;
  provF29DonutCentroEtiqueta = 'Proveedores';
  provF29DonutCentroSub = '';

  kpiCardsSuperiores: SgcKpiCard[] = [];
  kpiCardsInferiores: SgcKpiCard[] = [];
  eficaciaCapacitacion: any = null;
  satisfaccionCapacitacion: any = null;
  satisfaccionCurso: any = null;
  quejasCliente: any = null;
  evaluacionProveedores: any = null;
  avanceProyectos: any = null;
  proveedoresF29: any = null;
  proveedoresF29Expandido: string | null = null;
  criteriosProveedoresF29List: Array<{ label: string; valor: number }> = [];
  eficacia: any = null;
  quejasSugerencias: any = null;

  eficaciaCapChart: Partial<SgcRadialChartOptions>;
  eficaciaCapMensualChart: Partial<SgcAreaChartOptions>;
  satisfaccionCapChart: Partial<SgcAreaChartOptions>;
  satisfaccionCapDimensionesChart: Partial<SgcAreaChartOptions>;
  satisfaccionCapDistribChart: Partial<SgcRadialChartOptions>;
  satisfaccionChart: Partial<SgcAreaChartOptions>;
  satisfaccionRespuestasChart: Partial<SgcRadialChartOptions>;
  quejasChart: Partial<SgcAreaChartOptions>;
  proveedoresChart: Partial<SgcAreaChartOptions>;
  avanceChart: Partial<SgcRadialChartOptions>;
  eficaciaChart: Partial<SgcRadialChartOptions>;
  audNcHistogramaChart: Partial<SgcAreaChartOptions>;
  quejasSugerenciasChart: Partial<SgcRadialChartOptions>;
  proveedoresF29Chart: Partial<SgcRadialChartOptions>;

  mostrarFormQueja = false;
  guardandoQueja = false;
  mostrarComentariosSatisfaccion = false;
  mostrarComentariosSatCap = false;
  mostrarPreguntasSatCap = false;
  mostrarPreguntasSatisfaccion = false;
  mostrarHistogramaAud = false;
  /** null = año completo */
  filtroMesSatCap: number | null = null;
  filtroMesSatCliente: number | null = null;
  /** '' = todas las empresas */
  filtroEmpresaSatCliente = '';
  filtroNegativosSatCliente = false;
  filtroMesSatCapAbierto = false;
  filtroMesSatClienteAbierto = false;
  filtroEmpresaSatClienteAbierto = false;
  readonly mesesCortosSat = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  nuevaQueja: { cliente: string; fecha: string; descripcion: string; estatus: string; area: string } = {
    cliente: '',
    fecha: '',
    descripcion: '',
    estatus: 'Abierta',
    area: ''
  };

  mostrarFormProveedor = false;
  guardandoProveedor = false;
  nuevaEvaluacion: { proveedor: string; fecha: string; calificacion: number; observaciones: string } = {
    proveedor: '',
    fecha: '',
    calificacion: 80,
    observaciones: ''
  };

  mostrarFormAuditoria = false;
  guardandoAuditoria = false;
  nuevaAuditoria: { titulo: string; fecha: string; area: string; no_conformidades: number; observaciones: string } = {
    titulo: '',
    fecha: '',
    area: '',
    no_conformidades: 0,
    observaciones: ''
  };

  readonly estatusQuejaOpciones = ['Abierta', 'En atención', 'Cerrada'];

  private readonly CARRUSEL_INTERVALO_MS = 8000;
  private readonly CARRUSEL_TICK_MS = 100;
  private carruselTimer: ReturnType<typeof setInterval> | null = null;
  private carruselElapsedMs = 0;

  readonly carruselSlides: { id: string; titulo: string }[] = [
    { id: 'eficacia-cap', titulo: 'Eficacia de la capacitación' },
    { id: 'satisfaccion-cap', titulo: 'Satisfacción de la capacitación' },
    { id: 'satisfaccion', titulo: 'Satisfacción del cliente' },
    { id: 'quejas-sugerencias', titulo: 'Quejas y Sugerencias' },
    { id: 'avance', titulo: 'Avance de proyectos' },
    { id: 'auditorias', titulo: 'Resultados de auditorías' },
    { id: 'proveedores-f29', titulo: 'Evaluación de proveedores' }
  ];

  carruselIndicadorActivo = 0;
  carruselHover = false;
  carruselAutoActivo = true;
  carruselProgresoPct = 0;
  carruselSegundosRestantes = 8;
  capituloDashSlug: string | null = null;

  constructor(
    private authService: AuthService,
    private backendService: BackendServices,
    private sgcDashboardCache: SgcDashboardCacheService,
    private ngZone: NgZone,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.initCharts();
  }

  ngOnInit(): void {
    const roles = this.authService.getRoles();
    const principal = (this.authService.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      this.etiquetaRolUsuario = principal === 'root' ? 'Super administrador' : 'Administrador';
    } else if (roles.some(r => r === 'sgc')) {
      this.etiquetaRolUsuario = 'SGC';
    } else {
      this.etiquetaRolUsuario = 'Usuario';
    }

    this.refrescarPermisoEditorSgc();

    this.capituloDashSlug = (this.route.snapshot.queryParamMap.get('cap') || '').toLowerCase() || null;
    this.route.queryParamMap.subscribe(qm => {
      this.capituloDashSlug = (qm.get('cap') || '').toLowerCase() || null;
    });

    this.aniosDisponibles = [this.anioActual, this.anioActual - 1, this.anioActual - 2, this.anioActual - 3];
    this.cargarDashboard();
    this.iniciarCarrusel();

    if (this.route.snapshot.fragment === 'sgc-capitulos-panel' || this.capituloDashSlug) {
      setTimeout(() => this.scrollACapitulos(), 350);
    }
  }

  private refrescarPermisoEditorSgc(): void {
    this.backendService.obtenerMiPermisoEditorSgc().subscribe({
      next: (res) => {
        if (res?.success) {
          this.authService.setEditorSgcDelegado(!!res.sgc_editor_delegado);
        }
      },
      error: () => { /* permiso local se mantiene */ }
    });
  }

  scrollACapitulos(): void {
    const el = document.getElementById('sgc-capitulos-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  ngOnDestroy(): void {
    this.detenerCarrusel();
  }

  iniciarCarrusel(): void {
    this.detenerCarrusel();
    this.reiniciarCarruselTimer();
    this.ngZone.runOutsideAngular(() => {
      this.carruselTimer = setInterval(() => {
        // Solo entra a Angular cuando hay que actualizar UI / cambiar slide.
        if (
          this.carruselHover ||
          !this.carruselAutoActivo ||
          this.mostrarPreguntasSatCap ||
          this.mostrarPreguntasSatisfaccion ||
          this.filtroMesSatCapAbierto ||
          this.filtroMesSatClienteAbierto ||
          this.filtroEmpresaSatClienteAbierto
        ) {
          return;
        }

        this.carruselElapsedMs += this.CARRUSEL_TICK_MS;
        if (this.carruselElapsedMs >= this.CARRUSEL_INTERVALO_MS) {
          this.ngZone.run(() => this.carruselSiguiente());
          return;
        }

        this.ngZone.run(() => this.actualizarCarruselUi());
      }, this.CARRUSEL_TICK_MS);
    });
  }

  detenerCarrusel(): void {
    if (this.carruselTimer) {
      clearInterval(this.carruselTimer);
      this.carruselTimer = null;
    }
  }

  private actualizarCarruselUi(): void {
    this.carruselProgresoPct = Math.min(100, (this.carruselElapsedMs / this.CARRUSEL_INTERVALO_MS) * 100);
    this.carruselSegundosRestantes = Math.max(
      1,
      Math.ceil((this.CARRUSEL_INTERVALO_MS - this.carruselElapsedMs) / 1000)
    );
  }

  private reiniciarCarruselTimer(): void {
    this.carruselElapsedMs = 0;
    this.actualizarCarruselUi();
  }

  carruselSiguiente(): void {
    this.carruselIndicadorActivo = (this.carruselIndicadorActivo + 1) % this.carruselSlides.length;
    this.reiniciarCarruselTimer();
  }

  carruselAnterior(): void {
    this.carruselIndicadorActivo =
      (this.carruselIndicadorActivo - 1 + this.carruselSlides.length) % this.carruselSlides.length;
    this.reiniciarCarruselTimer();
  }

  irACarruselSlide(index: number): void {
    if (index < 0 || index >= this.carruselSlides.length || index === this.carruselIndicadorActivo) {
      return;
    }
    this.carruselIndicadorActivo = index;
    this.reiniciarCarruselTimer();
  }

  onCarruselMouseEnter(): void {
    this.carruselHover = true;
  }

  onCarruselMouseLeave(): void {
    this.carruselHover = false;
  }

  toggleCarruselAuto(): void {
    this.carruselAutoActivo = !this.carruselAutoActivo;
    if (this.carruselAutoActivo) {
      this.reiniciarCarruselTimer();
    }
  }

  /**
   * @param forzarRefresco true tras mutaciones (quejas, auditorías, etc.)
   */
  cargarDashboard(forzarRefresco = false): void {
    this.errorDashboard = false;

    const cached = !forzarRefresco
      ? this.sgcDashboardCache.peek(this.anioSeleccionado)
      : null;

    if (cached?.success) {
      this.aplicarRespuestaDashboard(cached, { resetSeleccion: true });
      this.cargandoDashboard = false;
      // Soft refresh en segundo plano sin vaciar la UI
      this.sgcDashboardCache.obtener(this.anioSeleccionado, true).subscribe({
        next: (res) => {
          if (res?.success) {
            this.aplicarRespuestaDashboard(res, { resetSeleccion: false });
          }
        },
        error: () => { /* se mantiene el cache visible */ }
      });
      return;
    }

    this.cargandoDashboard = true;
    this.chartsReady = false;

    this.sgcDashboardCache.obtener(this.anioSeleccionado, forzarRefresco).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.aplicarRespuestaDashboard(res, { resetSeleccion: true });
        } else {
          this.errorDashboard = true;
        }
        this.cargandoDashboard = false;
      },
      error: () => {
        this.errorDashboard = true;
        this.cargandoDashboard = false;
      }
    });
  }

  private aplicarRespuestaDashboard(res: any, opts: { resetSeleccion: boolean }): void {
    if (Array.isArray(res.anios) && res.anios.length) {
      this.aniosDisponibles = res.anios;
    }
    this.eficaciaCapacitacion = res.eficaciaCapacitacion || null;
    this.satisfaccionCapacitacion = res.satisfaccionCapacitacion || null;
    this.satisfaccionCurso = res.satisfaccionCurso || res.satisfaccion || null;
    this.quejasCliente = res.quejasCliente || null;
    this.evaluacionProveedores = res.evaluacionProveedores || null;
    this.avanceProyectos = res.avanceProyectos || res.mejoraContinua || null;
    this.proveedoresF29 = res.proveedoresF29 || null;
    this.actualizarCriteriosProveedoresF29();
    this.eficacia = res.eficacia || null;
    this.quejasSugerencias = res.quejasSugerencias || null;
    if (opts.resetSeleccion) {
      this.auditoriaSeleccionada = null;
      this.eficaciaChartModo = 'eficacia';
    }
    this.sincronizarNcActualesDesdeListado();
    this.construirKpis();
    this.actualizarCharts();
    this.chartsReady = true;
    this.resetDonutCentro();
    this.activarIntroAnimacionUnaVez();
  }

  onAnioChange(): void {
    this.filtroMesSatCap = null;
    this.filtroMesSatCliente = null;
    this.filtroEmpresaSatCliente = '';
    this.filtroNegativosSatCliente = false;
    this.cerrarCombosFiltroSat();
    this.mostrarPreguntasSatCap = false;
    this.mostrarPreguntasSatisfaccion = false;
    this.mostrarHistogramaAud = false;
    this.cargarDashboard(true);
  }

  get hayDatosEficaciaCap(): boolean {
    return !!this.eficaciaCapacitacion && (this.eficaciaCapacitacion.totalEvaluados || 0) > 0;
  }

  get hayDatosSatisfaccionCap(): boolean {
    return !!this.satisfaccionCapacitacion && (this.satisfaccionCapacitacion.totalRespuestas || 0) > 0;
  }

  get hayDatosSatisfaccion(): boolean {
    return !!this.satisfaccionCurso && (this.satisfaccionCurso.totalRespuestas || 0) > 0;
  }

  /** % Excelente + Bueno (alineado con el donut de positivas). */
  get porcentajeSatisfaccionPositivas(): number {
    const dist = this.satisfaccionCurso?.distribucion || {};
    const positivas = (Number(dist.excelente) || 0) + (Number(dist.bueno) || 0);
    const negativas = (Number(dist.regular) || 0) + (Number(dist.malo) || 0);
    const total = positivas + negativas;
    return total > 0 ? Math.round((positivas / total) * 100) : 0;
  }

  get hayDatosQuejas(): boolean {
    return !!this.quejasCliente && (this.quejasCliente.total || 0) > 0;
  }

  get hayDatosProveedores(): boolean {
    return !!this.evaluacionProveedores && (this.evaluacionProveedores.total || 0) > 0;
  }

  get hayDatosProveedoresF29(): boolean {
    return !!this.proveedoresF29 && (this.proveedoresF29.total || 0) > 0;
  }

  get hayDatosAvance(): boolean {
    return !!this.avanceProyectos && (this.avanceProyectos.total || 0) > 0;
  }

  get hayAuditorias(): boolean {
    return !!this.eficacia && (this.eficacia.totalAuditorias || 0) > 0;
  }

  get hayQuejasSugerencias(): boolean {
    return !!this.quejasSugerencias && (this.quejasSugerencias.total || 0) > 0;
  }

  get quejasSugerenciasLista(): QuejaSugerenciaSgc[] {
    return (this.quejasSugerencias?.quejas || []) as QuejaSugerenciaSgc[];
  }

  get auditorias(): AuditoriaSgc[] {
    return (this.eficacia?.auditorias || []) as AuditoriaSgc[];
  }

  get auditoriasOrdenadas(): AuditoriaSgc[] {
    return [...this.auditorias].sort((a, b) => {
      // Informe en curso arriba; cerradas por fecha descendente.
      if (!!a.enCurso !== !!b.enCurso) {
        return a.enCurso ? -1 : 1;
      }
      const fa = a.fecha ? new Date(`${a.fecha}T00:00:00`).getTime() : 0;
      const fb = b.fecha ? new Date(`${b.fecha}T00:00:00`).getTime() : 0;
      if (fb !== fa) return fb - fa;
      const na = Number(String(a.auditoriaNo || '').replace(/\D/g, '')) || 0;
      const nb = Number(String(b.auditoriaNo || '').replace(/\D/g, '')) || 0;
      return nb - na;
    });
  }

  get auditoriaUltimaTomada(): AuditoriaSgc | null {
    return this.auditoriasOrdenadas[0] || null;
  }

  /** NC de la última auditoría tomada (en curso si existe). */
  get ncActualesDisplay(): number {
    const ultima = this.auditoriaUltimaTomada;
    if (ultima) {
      return Number(ultima.no_conformidades) || 0;
    }
    return Number(this.eficacia?.ncActual) || 0;
  }

  get auditoriaActualNoDisplay(): string {
    return String(this.auditoriaUltimaTomada?.auditoriaNo || this.eficacia?.auditoriaActualNo || '—');
  }

  get nivelActualEtiquetaDisplay(): string {
    return String(
      this.auditoriaUltimaTomada?.nivelEtiqueta
      || this.eficacia?.nivelActualEtiqueta
      || 'Sin auditorías'
    );
  }

  get nivelActualClaveDisplay(): 'alto' | 'medio' | 'bajo' | null {
    const n = this.auditoriaUltimaTomada?.nivel || this.eficacia?.nivelActual || null;
    if (n === 'alto' || n === 'medio' || n === 'bajo') {
      return n;
    }
    return null;
  }

  get auditoriaUltimaCerrada(): AuditoriaSgc | null {
    return this.auditoriasOrdenadas.find((a) => a.cerrado) || null;
  }

  get esModoClasificacionAud(): boolean {
    return this.eficaciaChartModo === 'clasificacion' && !!this.auditoriaSeleccionada;
  }

  claveAuditoria(aud: AuditoriaSgc | null | undefined): string {
    if (!aud) return '';
    return `${aud.auditoriaNo || ''}|${aud.auditoria_id || 0}|${aud.cerrado ? 'c' : 'v'}`;
  }

  estaAuditoriaSeleccionada(aud: AuditoriaSgc): boolean {
    return this.claveAuditoria(aud) === this.claveAuditoria(this.auditoriaSeleccionada);
  }

  get quejas(): QuejaSgc[] {
    return (this.quejasCliente?.quejas || []) as QuejaSgc[];
  }

  get evaluacionesProveedor(): EvaluacionProveedorSgc[] {
    return (this.evaluacionProveedores?.evaluaciones || []) as EvaluacionProveedorSgc[];
  }

  private sincronizarNcActualesDesdeListado(): void {
    const ultima = this.auditoriaUltimaTomada;
    if (!this.eficacia || !ultima) {
      return;
    }
    this.eficacia = {
      ...this.eficacia,
      ncActual: Number(ultima.no_conformidades) || 0,
      auditoriaActualNo: ultima.auditoriaNo || this.eficacia.auditoriaActualNo,
      auditoriaActualEnCurso: !!ultima.enCurso,
      nivelActual: ultima.nivel || this.eficacia.nivelActual,
      nivelActualEtiqueta: ultima.nivelEtiqueta || this.eficacia.nivelActualEtiqueta
    };
  }

  private construirKpis(): void {
    const ec = this.eficaciaCapacitacion || {};
    const sCap = this.satisfaccionCapacitacion || {};
    const sc = this.satisfaccionCurso || {};
    const auditorias = this.eficacia || {};
    const q = this.quejasSugerencias || {};
    const ep = this.proveedoresF29 || {};
    const ap = this.avanceProyectos || {};
    const totalFormatos = SGC_CAPITULOS_ORDEN.reduce(
      (total, capitulo) => total + capitulo.plantillas.length,
      0
    );
    // Siempre la última tomada del listado F-10 (incluye en curso).
    const noConformidades = this.ncActualesDisplay;
    const quejasAbiertas = Number(q.abiertas || 0);
    const estadoAuditorias: SgcKpiCard['estado'] =
      noConformidades <= 2 ? 'verde' : noConformidades <= 4 ? 'amarillo' : 'rojo';

    this.kpiCardsSuperiores = [
      {
        titulo: 'Satisfacción del cliente',
        valor: `${this.porcentajeSatisfaccionPositivas}%`,
        subtitulo: `${sc.totalRespuestas || 0} respuestas`,
        icono: 'fa-smile',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        titulo: 'Resultados de auditorías',
        valor: `${noConformidades} NC`,
        subtitulo: `No. ${this.auditoriaActualNoDisplay} · ${auditorias.totalAuditorias || 0} informes SGC-F-10`,
        icono: 'fa-clipboard-check',
        color: estadoAuditorias === 'verde'
          ? this.palette.verde
          : estadoAuditorias === 'amarillo' ? this.palette.ambar : this.palette.rojo,
        gradiente: estadoAuditorias === 'verde'
          ? 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
          : estadoAuditorias === 'amarillo'
            ? 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
            : 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)',
        estado: estadoAuditorias
      },
      {
        titulo: 'Avance de proyectos',
        valor: `${ap.avancePromedio || 0}%`,
        subtitulo: `${ap.concluidosGrafico || ap.concluidos || 0}/${ap.totalEnGrafico || 0} con avance`,
        icono: 'fa-tasks',
        color: this.palette.ambar,
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      }
    ];

    this.kpiCardsInferiores = [
      {
        titulo: 'Eficacia de la capacitación',
        valor: `${ec.tasaAprobacion || 0}%`,
        subtitulo: `${ec.totalAprobados || 0}/${ec.totalEvaluados || 0} evaluaciones aprobadas`,
        icono: 'fa-graduation-cap',
        color: this.palette.azul,
        gradiente: `linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)`
      },
      {
        titulo: 'Satisfacción de la capacitación',
        valor: `${sCap.indiceAnual || 0}%`,
        subtitulo: `${sCap.totalRespuestas || 0} respuestas`,
        icono: 'fa-star',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        titulo: 'Quejas y Sugerencias',
        valor: `${quejasAbiertas}`,
        subtitulo: `${quejasAbiertas} abiertas · ${q.total || 0} registradas`,
        icono: 'fa-comment-dots',
        color: quejasAbiertas === 0 ? this.palette.verde : this.palette.rojo,
        gradiente: quejasAbiertas === 0
          ? 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
          : 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)',
        estado: quejasAbiertas === 0 ? 'verde' : 'rojo'
      },
      {
        titulo: 'Evaluación de proveedores',
        valor: `${ep.promedioCalificacion || 0}%`,
        subtitulo: `${ep.total || 0} evaluaciones`,
        icono: 'fa-truck',
        color: this.palette.morado,
        gradiente: `linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)`
      },
      {
        titulo: 'Total de Formatos Implementados',
        valor: `${totalFormatos}`,
        subtitulo: 'Formatos corporativos',
        icono: 'fa-file-alt',
        color: this.palette.naranja,
        gradiente: 'linear-gradient(135deg, #c2410c 0%, #fb923c 100%)'
      }
    ];
  }

  private readonly CARRUSEL_CHART_HEIGHT = 340;
  private readonly CARRUSEL_SAT_CAP_CHART_HEIGHT = 365;
  private readonly CARRUSEL_SAT_CAP_DIM_HEIGHT = 220;
  private readonly CARRUSEL_SAT_CAP_DONUT_HEIGHT = 220;
  private readonly CARRUSEL_DONUT_HEIGHT = 220;
  private readonly CARRUSEL_AUD_DONUT_HEIGHT = 180;

  private chartBase(): Partial<ApexChart> {
    return {
      fontFamily: 'Open Sans, Inter, system-ui, sans-serif',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 700,
        animateGradually: { enabled: true, delay: 120 },
        dynamicAnimation: { enabled: true, speed: 320 }
      }
    };
  }

  private initCharts(): void {
    const gridModern = {
      borderColor: '#eef2f7',
      strokeDashArray: 0,
      padding: { top: 10, right: 10, bottom: 0, left: 6 },
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    };

    const legendBottom = {
      position: 'bottom' as const,
      horizontalAlign: 'center' as const,
      fontSize: '12px',
      fontWeight: 600,
      offsetY: 4,
      height: 40,
      markers: { width: 10, height: 10, radius: 10, offsetX: -3 } as any,
      itemMargin: { horizontal: 14, vertical: 4 }
    };

    const axisLabels = {
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 } }
    };

    const carouselLegend = {
      show: true,
      position: 'bottom' as const,
      horizontalAlign: 'center' as const,
      fontSize: '11px',
      fontWeight: 600,
      offsetY: 8,
      height: 46,
      markers: { width: 8, height: 8, radius: 3, offsetX: -2 } as any,
      itemMargin: { horizontal: 12, vertical: 5 }
    };

    const carouselComboPlot = {
      bar: {
        columnWidth: '36%',
        borderRadius: 7,
        borderRadiusApplication: 'end' as const,
        borderRadiusWhenStacked: 'last' as const
      }
    };

    this.eficaciaCapMensualChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'area',
        height: this.CARRUSEL_CHART_HEIGHT,
        dropShadow: { enabled: true, top: 6, left: 0, blur: 14, opacity: 0.07 }
      },
      colors: [this.palette.azul, this.palette.teal],
      stroke: { curve: 'smooth', width: [3, 0], lineCap: 'round' },
      plotOptions: carouselComboPlot,
      fill: {
        type: ['gradient', 'solid'],
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.4,
          opacityFrom: 0.48,
          opacityTo: 0.02,
          stops: [0, 88, 100]
        },
        opacity: [1, 0.85]
      },
      dataLabels: { enabled: false },
      markers: {
        size: [0, 0],
        strokeWidth: [2, 0],
        strokeColors: ['#fff'],
        hover: { size: 6, sizeOffset: 2 }
      },
      xaxis: { categories: [], ...axisLabels },
      yaxis: [
        {
          seriesName: 'Tasa de aprobación',
          min: 0, max: 100, tickAmount: 5,
          labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}%` }
        },
        {
          seriesName: 'Evaluados',
          opposite: true, min: 0, forceNiceScale: true,
          labels: { style: { colors: '#cbd5e1', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}` }
        }
      ],
      grid: {
        borderColor: '#eef2f7',
        strokeDashArray: 4,
        padding: { left: 8, right: 8, top: 8, bottom: 0 },
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } }
      },
      legend: carouselLegend,
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) => {
            const idx = opts?.seriesIndex ?? 0;
            return idx === 0 ? `${Math.round(val)}%` : `${Math.round(val)} evaluados`;
          }
        }
      }
    };

    this.eficaciaCapChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['Aprobación', 'Cursos', 'Personas'],
      colors: [this.palette.azul, this.palette.ambar, this.palette.teal],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: ['#60a5fa', '#fbbf24', '#5eead4'],
          opacityFrom: 1,
          opacityTo: 0.88,
          stops: [0, 95, 100]
        }
      },
      legend: { show: false },
      dataLabels: {
        enabled: false,
        formatter: () => '',
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          dataLabels: { minAngleToShowLabel: 360 },
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) => {
            const ec = this.eficaciaCapacitacion || {};
            const idx = opts?.seriesIndex ?? 0;
            if (idx === 0) {
              const tasa = Number(ec.tasaAprobacion) || 0;
              return `${Number(ec.totalAprobados) || 0} con resultado A (${tasa}%)`;
            }
            if (idx === 1) return `${val} curso${val !== 1 ? 's' : ''} evaluado${val !== 1 ? 's' : ''}`;
            return `${val} persona${val !== 1 ? 's' : ''} evaluada${val !== 1 ? 's' : ''}`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };

    this.satisfaccionCapChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'area',
        height: this.CARRUSEL_SAT_CAP_CHART_HEIGHT,
        dropShadow: { enabled: true, top: 6, left: 0, blur: 14, opacity: 0.07 }
      },
      colors: [this.palette.teal, '#99f6e4'],
      stroke: { curve: 'smooth', width: [3, 0], lineCap: 'round' },
      plotOptions: carouselComboPlot,
      fill: {
        type: ['gradient', 'solid'],
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.4,
          opacityFrom: 0.48,
          opacityTo: 0.02,
          stops: [0, 88, 100]
        },
        opacity: [1, 0.82]
      },
      dataLabels: { enabled: false },
      markers: {
        size: [0, 0],
        strokeWidth: [2, 0],
        strokeColors: ['#fff'],
        hover: { size: 6, sizeOffset: 2 }
      },
      xaxis: { categories: [], ...axisLabels },
      yaxis: [
        {
          seriesName: 'Índice de satisfacción',
          min: 0, max: 100, tickAmount: 5,
          labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}%` }
        },
        {
          seriesName: 'Respuestas',
          opposite: true, min: 0, forceNiceScale: true,
          labels: { style: { colors: '#cbd5e1', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}` }
        }
      ],
      grid: {
        ...gridModern,
        padding: { top: 8, right: 12, bottom: 10, left: 8 }
      },
      legend: carouselLegend,
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) =>
            opts?.seriesIndex === 0 ? `${Math.round(val)}%` : `${Math.round(val)}`
        }
      }
    };

    this.satisfaccionCapDimensionesChart = {
      series: [{ name: 'Índice', data: [] }],
      chart: {
        ...this.chartBase(),
        type: 'bar',
        height: this.CARRUSEL_SAT_CAP_DIM_HEIGHT,
        dropShadow: { enabled: true, top: 4, left: 0, blur: 10, opacity: 0.08 }
      },
      colors: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#34d399'],
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: '52%',
          borderRadius: 6,
          borderRadiusApplication: 'end',
          distributed: true
        }
      },
      dataLabels: {
        enabled: true,
        formatter: (val: number) => `${Math.round(val)}%`,
        style: { fontSize: '10px', fontWeight: 700, colors: ['#fff'] },
        offsetX: 4
      },
      stroke: { show: false },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'horizontal',
          shadeIntensity: 0.35,
          gradientToColors: ['#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#34d399'],
          opacityFrom: 1,
          opacityTo: 0.92,
          stops: [0, 100]
        }
      },
      xaxis: {
        categories: [],
        max: 100,
        labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: string) => `${Math.round(Number(v))}%` }
      },
      yaxis: {
        labels: {
          style: { colors: '#475569', fontSize: '10px', fontWeight: 600 },
          maxWidth: 200,
          align: 'left'
        }
      },
      grid: {
        borderColor: '#eef2f7',
        padding: { left: 8, right: 12, top: 4, bottom: 4 },
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } }
      },
      legend: { show: false },
      tooltip: {
        theme: 'dark',
        y: { formatter: (val: number) => `${Math.round(val)}% de satisfacción` }
      }
    };

    this.satisfaccionCapDistribChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_SAT_CAP_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['Excelente', 'Bueno', 'Regular', 'Malo'],
      colors: ['#16a34a', '#3b82f6', '#f59e0b', '#e11d48'],
      stroke: { width: 3, colors: ['#fff'] },
      legend: { show: false },
      dataLabels: {
        enabled: false,
        formatter: () => '',
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          dataLabels: { minAngleToShowLabel: 360 },
          donut: {
            size: '72%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        y: { formatter: (val: number) => `${Math.round(val)} respuesta${val !== 1 ? 's' : ''}` }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 220 } } }]
    };

    this.satisfaccionChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'area',
        height: this.CARRUSEL_CHART_HEIGHT,
        dropShadow: { enabled: true, top: 6, left: 0, blur: 14, opacity: 0.07 }
      },
      colors: [this.palette.satCliente, '#99f6e4'],
      stroke: { curve: 'smooth', width: [3, 0], lineCap: 'round' },
      plotOptions: carouselComboPlot,
      fill: {
        type: ['gradient', 'solid'],
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.4,
          opacityFrom: 0.52,
          opacityTo: 0.02,
          stops: [0, 88, 100]
        },
        opacity: [1, 0.82]
      },
      dataLabels: { enabled: false },
      markers: {
        size: [0, 0],
        strokeWidth: [2, 0],
        strokeColors: ['#fff'],
        hover: { size: 6, sizeOffset: 2 }
      },
      xaxis: { categories: [], ...axisLabels },
      yaxis: [
        {
          seriesName: 'Índice de satisfacción',
          min: 0, max: 100, tickAmount: 5,
          labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}%` }
        },
        {
          seriesName: 'Respuestas',
          opposite: true, min: 0, forceNiceScale: true,
          labels: { style: { colors: '#cbd5e1', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}` }
        }
      ],
      grid: {
        ...gridModern,
        padding: { top: 8, right: 12, bottom: 10, left: 8 }
      },
      legend: carouselLegend,
      tooltip: {
        theme: 'light',
        shared: true,
        intersect: false,
        style: { fontSize: '12px' },
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) =>
            opts?.seriesIndex === 0 ? `${Math.round(val)}%` : `${Math.round(val)}`
        }
      }
    };

    this.satisfaccionRespuestasChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: [],
      colors: ['#16a34a', '#e11d48'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.35,
          gradientToColors: ['#4ade80', '#fb7185'],
          opacityFrom: 1,
          opacityTo: 0.88,
          stops: [0, 95, 100]
        }
      },
      legend: { show: false },
      dataLabels: {
        enabled: false,
        formatter: () => '',
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          dataLabels: { minAngleToShowLabel: 360 },
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => `${Math.round(val)} respuesta${val !== 1 ? 's' : ''}`
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };

    this.quejasChart = {
      series: [],
      chart: { ...this.chartBase(), type: 'bar', height: 280 },
      colors: [this.palette.rojo, this.palette.verde],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '58%',
          borderRadius: 7,
          borderRadiusApplication: 'end'
        }
      },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      fill: {
        type: 'gradient',
        gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.35, opacityFrom: 1, opacityTo: 0.82, stops: [0, 100] }
      },
      dataLabels: { enabled: false },
      xaxis: { categories: [], ...axisLabels },
      yaxis: {
        min: 0, forceNiceScale: true, tickAmount: 4,
        labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}` }
      },
      grid: gridModern,
      legend: legendBottom,
      tooltip: { theme: 'dark', shared: true, intersect: false }
    };

    this.proveedoresChart = {
      series: [],
      chart: { ...this.chartBase(), type: 'area', height: 280 },
      colors: [this.palette.morado],
      stroke: { curve: 'smooth', width: 2.5 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 0.45, opacityFrom: 0.42, opacityTo: 0.04, stops: [0, 90, 100] }
      },
      dataLabels: { enabled: false },
      markers: { size: 0, hover: { size: 5 } },
      xaxis: { categories: [], ...axisLabels },
      yaxis: {
        min: 0, max: 100, tickAmount: 5,
        labels: { style: { colors: '#94a3b8', fontSize: '10px' }, formatter: (v: number) => `${Math.round(v)}%` }
      },
      grid: gridModern,
      legend: { show: false },
      tooltip: { theme: 'dark' }
    };

    this.avanceChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['Concluido', 'En proceso'],
      colors: ['#16a34a', '#15a596'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: ['#4ade80', '#5eead4'],
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
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => {
            const total = this.totalAvanceEnGrafico;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return `${val} proyecto${val !== 1 ? 's' : ''} (${pct}%)`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };

    this.proveedoresF29Chart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['Aprobados', 'Reprobados'],
      colors: ['#16a34a', '#e11d48'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: ['#4ade80', '#fb7185'],
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
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => {
            const total = Number(this.proveedoresF29?.total) || 0;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return `${val} proveedor${val !== 1 ? 'es' : ''} (${pct}%)`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };

    this.eficaciaChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_AUD_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['0–2 NC', '3–4 NC', '≥5 NC'],
      colors: ['#16a34a', '#f59e0b', '#e11d48'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: ['#4ade80', '#fbbf24', '#fb7185'],
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
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => {
            if (this.esModoClasificacionAud) {
              const aud = this.auditoriaSeleccionada;
              const total = (Number(aud?.totalOp) || 0)
                + (Number(aud?.totalNcMenor) || 0)
                + (Number(aud?.totalNcMayor) || 0);
              const pct = total ? Math.round((val / total) * 100) : 0;
              return `${val} hallazgo${val !== 1 ? 's' : ''} (${pct}%)`;
            }
            const total = this.auditorias.filter((a) => a.cerrado).length || this.auditorias.length;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return `${val} auditoría${val !== 1 ? 's' : ''} (${pct}%)`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };

    this.audNcHistogramaChart = {
      series: [
        { name: 'NC menor', type: 'column', data: [] },
        { name: 'NC mayor', type: 'column', data: [] }
      ],
      chart: {
        ...this.chartBase(),
        type: 'bar',
        height: 380,
        dropShadow: { enabled: true, top: 8, left: 0, blur: 18, opacity: 0.1 }
      },
      colors: ['#f59e0b', '#e11d48'],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '48%',
          borderRadius: 7,
          borderRadiusApplication: 'end',
          dataLabels: { position: 'top' }
        }
      },
      dataLabels: {
        enabled: true,
        offsetY: -16,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#334155'] },
        formatter: (val: number) => (Number(val) > 0 ? `${Math.round(Number(val))}` : '')
      },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.35,
          opacityFrom: 0.95,
          opacityTo: 0.72,
          stops: [0, 100]
        }
      },
      xaxis: {
        categories: [],
        ...axisLabels,
        labels: {
          style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
          rotate: 0,
          trim: true,
          hideOverlappingLabels: true
        },
        axisBorder: { show: true, color: '#e2e8f0' },
        axisTicks: { show: true, color: '#e2e8f0' }
      },
      yaxis: {
        min: 0,
        forceNiceScale: true,
        tickAmount: 5,
        title: { text: 'Cantidad de NC', style: { color: '#64748b', fontSize: '11px', fontWeight: 700 } },
        labels: {
          style: { colors: '#94a3b8', fontSize: '10px' },
          formatter: (v: number) => `${Math.round(v)}`
        }
      },
      grid: {
        ...gridModern,
        borderColor: '#eef2f7',
        padding: { top: 22, right: 16, bottom: 8, left: 12 }
      },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '12px',
        fontWeight: 600,
        markers: { width: 10, height: 10, radius: 3 } as any,
        itemMargin: { horizontal: 12, vertical: 0 }
      },
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        y: {
          formatter: (val: number) => `${Math.round(Number(val) || 0)} NC`
        }
      }
    };

    this.quejasSugerenciasChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.CARRUSEL_AUD_DONUT_HEIGHT,
        dropShadow: { enabled: true, top: 3, left: 0, blur: 10, opacity: 0.12 }
      },
      labels: ['0 quejas · Óptimo', '≥1 queja · Atención'],
      colors: ['#16a34a', '#e11d48'],
      stroke: { width: 3, colors: ['#fff'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: ['#4ade80', '#fb7185'],
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
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      tooltip: {
        theme: 'dark',
        fillSeriesColor: false,
        y: {
          formatter: (val: number) => {
            const total = Number(this.quejasSugerencias?.total) || 0;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return `${val} queja${val !== 1 ? 's' : ''} (${pct}%)`;
          }
        }
      },
      responsive: [{ breakpoint: 480, options: { chart: { height: 180 } } }]
    };
  }

  private actualizarCharts(): void {
    const ec = this.eficaciaCapacitacion || {};
    const cursos = Number(ec.totalCursos) || 0;
    const personas = Number(ec.totalEvaluados) || 0;
    const aprobados = Number(ec.totalAprobados) || 0;
    const self = this;
    this.eficaciaCapChart = {
      ...this.eficaciaCapChart,
      series: [Math.max(aprobados, 0), Math.max(cursos, 0), Math.max(personas, 0)],
      chart: {
        ...this.eficaciaCapChart.chart,
        height: this.CARRUSEL_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onCapDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetCapDonutCentro();
          }
        }
      }
    };
    this.resetCapDonutCentro();

    const ecSerie = (ec.serieMensual || []) as any[];
    this.eficaciaCapMensualChart = {
      ...this.eficaciaCapMensualChart,
      series: [
        { name: 'Tasa de aprobación', type: 'area', data: ecSerie.map(s => Number(s.tasaAprobacion) || 0) },
        { name: 'Evaluados', type: 'column', data: ecSerie.map(s => Number(s.evaluados) || 0) }
      ],
      xaxis: { ...this.eficaciaCapMensualChart.xaxis, categories: ecSerie.map(s => s.mes) }
    };

    const scap = this.satisfaccionCapacitacion || {};
    const scapSerie = (scap.serieMensual || []) as any[];
    this.satisfaccionCapChart = {
      ...this.satisfaccionCapChart,
      series: [
        { name: 'Índice de satisfacción', type: 'area', data: scapSerie.map(s => Number(s.indice) || 0) },
        { name: 'Respuestas', type: 'column', data: scapSerie.map(s => Number(s.respuestas) || 0) }
      ],
      xaxis: { ...this.satisfaccionCapChart.xaxis, categories: scapSerie.map(s => s.mes) }
    };

    const dimensiones = (scap.dimensiones || []).filter((d: any) => d?.titulo);
    const dimLabels = dimensiones.map((d: any) => this.etiquetaDimensionSatCap(d.titulo, d.id));
    const dimValues = dimensiones.map((d: any) => Number(d.indice) || 0);
    this.satisfaccionCapDimensionesChart = {
      ...this.satisfaccionCapDimensionesChart,
      series: [{ name: 'Índice', data: dimValues.length ? dimValues : [0] }],
      xaxis: {
        ...this.satisfaccionCapDimensionesChart.xaxis,
        categories: dimLabels.length ? dimLabels : ['Sin datos']
      }
    };

    const dist = scap.distribucion || {};
    const distSeries = [
      Number(dist.excelente) || 0,
      Number(dist.bueno) || 0,
      Number(dist.regular) || 0,
      Number(dist.malo) || 0
    ];
    this.satisfaccionCapDistribChart = {
      ...this.satisfaccionCapDistribChart,
      series: distSeries.some(v => v > 0) ? distSeries : [0, 0, 0, 1],
      chart: {
        ...this.satisfaccionCapDistribChart.chart,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onSatCapDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetSatCapDonutCentro();
          }
        }
      }
    };
    this.resetSatCapDonutCentro();

    const scSerie = (this.satisfaccionCurso?.serieMensual || []) as any[];
    this.satisfaccionChart = {
      ...this.satisfaccionChart,
      series: [
        { name: 'Índice de satisfacción', type: 'area', data: scSerie.map(s => Number(s.indice) || 0) },
        { name: 'Respuestas', type: 'column', data: scSerie.map(s => Number(s.respuestas) || 0) }
      ],
      xaxis: { ...this.satisfaccionChart.xaxis, categories: scSerie.map(s => s.mes) }
    };

    const scDistribucion = this.satisfaccionCurso?.distribucion || {};
    const satSeries = [
      (Number(scDistribucion.excelente) || 0) + (Number(scDistribucion.bueno) || 0),
      (Number(scDistribucion.regular) || 0) + (Number(scDistribucion.malo) || 0)
    ];
    this.satisfaccionRespuestasChart = {
      ...this.satisfaccionRespuestasChart,
      series: satSeries,
      labels: ['Positivas', 'Negativas'],
      chart: {
        ...this.satisfaccionRespuestasChart.chart,
        height: this.CARRUSEL_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onSatDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetSatDonutCentro();
          }
        }
      }
    };
    this.resetSatDonutCentro();

    const qSerie = (this.quejasCliente?.serieMensual || []) as any[];
    this.quejasChart = {
      ...this.quejasChart,
      series: [
        { name: 'Quejas registradas', data: qSerie.map(s => Number(s.total) || 0) },
        { name: 'Cerradas', data: qSerie.map(s => Number(s.cerradas) || 0) }
      ],
      xaxis: { ...this.quejasChart.xaxis, categories: qSerie.map(s => s.mes) }
    };

    const epSerie = (this.evaluacionProveedores?.serieMensual || []) as any[];
    this.proveedoresChart = {
      ...this.proveedoresChart,
      series: [{ name: 'Calificación promedio', data: epSerie.map(s => Number(s.promedio) || 0) }],
      xaxis: { ...this.proveedoresChart.xaxis, categories: epSerie.map(s => s.mes) }
    };

    const ap = this.avanceProyectos || {};
    this.avanceChart = {
      ...this.avanceChart,
      series: [
        Number(ap.concluidosGrafico ?? ap.concluidos) || 0,
        Number(ap.enProcesoGrafico ?? ap.enProceso) || 0
      ],
      chart: {
        ...this.avanceChart.chart,
        height: this.CARRUSEL_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetDonutCentro();
          }
        }
      }
    };
    this.resetDonutCentro();

    const pf = this.proveedoresF29 || {};
    const aprobadosPf = Number(pf.aprobados) || 0;
    const reprobadosPf = Number(pf.reprobados) || 0;
    this.proveedoresF29Chart = {
      ...this.proveedoresF29Chart,
      series: [aprobadosPf, reprobadosPf],
      chart: {
        ...this.proveedoresF29Chart.chart,
        height: this.CARRUSEL_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onProveedoresF29DonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetProveedoresF29DonutCentro();
          }
        }
      }
    };
    this.resetProveedoresF29DonutCentro();

    this.actualizarEficaciaChart();
    this.actualizarAudNcHistogramaChart();
    this.resetEficaciaDonutCentro();

    const qs = this.quejasSugerencias || {};
    const abiertasQs = Number(qs.abiertas) || 0;
    const cerradasQs = Number(qs.cerradas) || 0;
    // Segmento verde = óptimo / cerradas; rojo = abiertas.
    // Con 0 registros se fuerza un anillo verde (óptimo).
    const optimoQs = abiertasQs === 0;
    const serieQuejas = optimoQs
      ? [Math.max(cerradasQs, 1), 0]
      : [cerradasQs, abiertasQs];
    this.quejasSugerenciasChart = {
      ...this.quejasSugerenciasChart,
      series: serieQuejas,
      chart: {
        ...this.quejasSugerenciasChart.chart,
        height: this.CARRUSEL_AUD_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onQuejasSugDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetQuejasSugDonutCentro();
          }
        }
      }
    };
    this.resetQuejasSugDonutCentro();
  }

  resetQuejasSugDonutCentro(): void {
    this.ngZone.run(() => {
      const q = this.quejasSugerencias || {};
      this.quejasSugDonutCentroValor = q.abiertas ?? 0;
      this.quejasSugDonutCentroEtiqueta = 'Quejas abiertas';
      this.quejasSugDonutCentroSub = q.nivelActualEtiqueta || (q.optimo ? 'Óptimo' : 'Requiere atención');
    });
  }

  onQuejasSugDonutHover(index: number): void {
    this.ngZone.run(() => {
      const labels = ['0 quejas · Óptimo', '≥1 queja · Atención'];
      const q = this.quejasSugerencias || {};
      const abiertas = Number(q.abiertas) || 0;
      const cerradas = Number(q.cerradas) || 0;
      const optimo = abiertas === 0;
      const counts = [
        optimo ? Math.max(cerradas, Number(q.total) > 0 ? 1 : 0) : cerradas,
        abiertas
      ];
      const total = Number(q.total) || 0;
      const count = counts[index] ?? 0;
      this.quejasSugDonutCentroValor = count;
      this.quejasSugDonutCentroEtiqueta = labels[index] || 'Quejas';
      this.quejasSugDonutCentroSub = total ? `${Math.round((count / Math.max(total, 1)) * 100)}% del total` : '';
    });
  }

  resetEficaciaDonutCentro(): void {
    this.ngZone.run(() => {
      if (this.esModoClasificacionAud && this.auditoriaSeleccionada) {
        const aud = this.auditoriaSeleccionada;
        this.eficaciaDonutCentroValor = aud.no_conformidades ?? 0;
        this.eficaciaDonutCentroEtiqueta = `NC · No. ${aud.auditoriaNo || '—'}`;
        this.eficaciaDonutCentroSub = aud.nivelEtiqueta || this.nivelCorto(aud.nivel);
        return;
      }
      this.eficaciaDonutCentroValor = this.ncActualesDisplay;
      this.eficaciaDonutCentroEtiqueta = 'NC actuales';
      this.eficaciaDonutCentroSub = this.nivelActualEtiquetaDisplay;
    });
  }

  onEficaciaDonutHover(index: number): void {
    this.ngZone.run(() => {
      if (this.esModoClasificacionAud && this.auditoriaSeleccionada) {
        const aud = this.auditoriaSeleccionada;
        const labels = ['OP', 'NC menor', 'NC mayor'];
        const counts = [
          Number(aud.totalOp) || 0,
          Number(aud.totalNcMenor) || 0,
          Number(aud.totalNcMayor) || 0
        ];
        const total = counts.reduce((acc, n) => acc + n, 0);
        const count = counts[index] ?? 0;
        this.eficaciaDonutCentroValor = count;
        this.eficaciaDonutCentroEtiqueta = labels[index] || 'Hallazgos';
        this.eficaciaDonutCentroSub = total ? `${Math.round((count / total) * 100)}% de No. ${aud.auditoriaNo}` : '';
        return;
      }
      const labels = ['0–2 NC', '3–4 NC', '≥5 NC'];
      const counts = [
        this.auditorias.filter((a) => a.cerrado && a.nivel === 'alto').length,
        this.auditorias.filter((a) => a.cerrado && a.nivel === 'medio').length,
        this.auditorias.filter((a) => a.cerrado && a.nivel === 'bajo').length
      ];
      const total = counts.reduce((acc, n) => acc + n, 0);
      const count = counts[index] ?? 0;
      this.eficaciaDonutCentroValor = count;
      this.eficaciaDonutCentroEtiqueta = labels[index] || 'Auditorías';
      this.eficaciaDonutCentroSub = total ? `${Math.round((count / total) * 100)}% del histórico` : '';
    });
  }

  private actualizarEficaciaChart(): void {
    const self = this;
    let series: number[];
    let labels: string[];
    let colors: string[];
    let gradientTo: string[];

    if (this.esModoClasificacionAud && this.auditoriaSeleccionada) {
      const aud = this.auditoriaSeleccionada;
      series = [
        Number(aud.totalOp) || 0,
        Number(aud.totalNcMenor) || 0,
        Number(aud.totalNcMayor) || 0
      ];
      if (!series.some((v) => v > 0)) {
        series = [0, 0, 1];
      }
      labels = ['OP', 'NC menor', 'NC mayor'];
      colors = ['#15a596', '#f59e0b', '#e11d48'];
      gradientTo = ['#5eead4', '#fbbf24', '#fb7185'];
    } else {
      const cn = this.eficacia?.conteoNiveles || {};
      series = [
        Number(cn.alto) || 0,
        Number(cn.medio) || 0,
        Number(cn.bajo) || 0
      ];
      if (!series.some((v) => v > 0)) {
        series = [0, 0, 1];
      }
      labels = ['0–2 NC', '3–4 NC', '≥5 NC'];
      colors = ['#16a34a', '#f59e0b', '#e11d48'];
      gradientTo = ['#4ade80', '#fbbf24', '#fb7185'];
    }

    this.eficaciaChart = {
      ...this.eficaciaChart,
      series,
      labels,
      colors,
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          gradientToColors: gradientTo,
          opacityFrom: 1,
          opacityTo: 0.88,
          stops: [0, 95, 100]
        }
      },
      chart: {
        ...this.eficaciaChart.chart,
        height: this.CARRUSEL_AUD_DONUT_HEIGHT,
        events: {
          dataPointMouseEnter(_e: unknown, _chart: unknown, config: { dataPointIndex: number }) {
            self.onEficaciaDonutHover(config.dataPointIndex);
          },
          dataPointMouseLeave() {
            self.resetEficaciaDonutCentro();
          }
        }
      }
    };
  }

  seleccionarAuditoriaEficacia(aud: AuditoriaSgc): void {
    if (this.estaAuditoriaSeleccionada(aud)) {
      this.auditoriaSeleccionada = null;
      this.eficaciaChartModo = 'eficacia';
    } else {
      this.auditoriaSeleccionada = aud;
      this.eficaciaChartModo = 'clasificacion';
    }
    this.actualizarEficaciaChart();
    this.resetEficaciaDonutCentro();
  }

  limpiarSeleccionAuditoriaEficacia(): void {
    this.auditoriaSeleccionada = null;
    this.eficaciaChartModo = 'eficacia';
    this.actualizarEficaciaChart();
    this.resetEficaciaDonutCentro();
  }

  private colorNcPorCantidad(nc: number): string {
    if (nc <= 2) return '#16a34a';
    if (nc <= 4) return '#f59e0b';
    return '#e11d48';
  }

  private etiquetaAuditoriaHistograma(aud: AuditoriaSgc): string {
    const no = String(aud.auditoriaNo || '').trim();
    if (no) return `No. ${no}`;
    const titulo = String(aud.titulo || '').trim();
    if (titulo.length <= 18) return titulo || 'Auditoría';
    return `${titulo.slice(0, 16)}…`;
  }

  private actualizarAudNcHistogramaChart(): void {
    const lista = [...this.auditorias].sort((a, b) => {
      const fa = a.fecha ? new Date(`${a.fecha}T00:00:00`).getTime() : 0;
      const fb = b.fecha ? new Date(`${b.fecha}T00:00:00`).getTime() : 0;
      if (fa !== fb) return fa - fb;
      const na = Number(String(a.auditoriaNo || '').replace(/\D/g, '')) || 0;
      const nb = Number(String(b.auditoriaNo || '').replace(/\D/g, '')) || 0;
      return na - nb;
    });

    const categorias = lista.map((a) => this.etiquetaAuditoriaHistograma(a));
    const ncMenor = lista.map((a) => Number(a.totalNcMenor) || 0);
    const ncMayor = lista.map((a) => Number(a.totalNcMayor) || 0);
    const maxNc = Math.max(...ncMenor, ...ncMayor, 0);

    this.audNcHistogramaChart = {
      ...this.audNcHistogramaChart,
      series: [
        { name: 'NC menor', type: 'column', data: ncMenor.length ? ncMenor : [0] },
        { name: 'NC mayor', type: 'column', data: ncMayor.length ? ncMayor : [0] }
      ],
      xaxis: {
        ...this.audNcHistogramaChart.xaxis,
        categories: categorias.length ? categorias : ['Sin auditorías']
      },
      yaxis: {
        ...(Array.isArray(this.audNcHistogramaChart.yaxis)
          ? this.audNcHistogramaChart.yaxis[0]
          : this.audNcHistogramaChart.yaxis),
        min: 0,
        max: Math.max(4, maxNc + 1),
        forceNiceScale: true,
        tickAmount: 5
      },
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        custom: undefined,
        x: {
          formatter: (_val: number, opts?: { dataPointIndex?: number }) => {
            const idx = opts?.dataPointIndex ?? -1;
            const aud = lista[idx];
            if (!aud) return '';
            const fecha = aud.fecha ? this.formatFecha(aud.fecha) : '';
            const titulo = aud.titulo || `Auditoría ${aud.auditoriaNo || ''}`.trim();
            return fecha ? `${titulo} · ${fecha}` : titulo;
          }
        },
        y: {
          formatter: (val: number) => `${Math.round(Number(val) || 0)} NC`
        }
      }
    };
  }

  abrirHistogramaAud(): void {
    this.actualizarAudNcHistogramaChart();
    this.mostrarHistogramaAud = true;
  }

  cerrarHistogramaAud(): void {
    this.mostrarHistogramaAud = false;
  }

  private activarIntroAnimacionUnaVez(): void {
    if (this.animacionIntroCompleta) return;
    this.indicadoresIntro = false;
    setTimeout(() => {
      this.indicadoresIntro = true;
      setTimeout(() => {
        this.animacionIntroCompleta = true;
        this.indicadoresIntro = false;
      }, 550);
    }, 60);
  }

  get totalAvanceEnGrafico(): number {
    const ap = this.avanceProyectos || {};
    const indicado = Number(ap.totalEnGrafico);
    if (Number.isFinite(indicado) && indicado >= 0) return indicado;
    return (Number(ap.concluidos) || 0) + (Number(ap.enProceso) || 0);
  }

  resetDonutCentro(): void {
    this.ngZone.run(() => {
      const total = this.totalAvanceEnGrafico;
      this.donutCentroValor = total;
      this.donutCentroEtiqueta = 'Proyectos';
      this.donutCentroPct = 100;
    });
  }

  onDonutHover(index: number): void {
    this.ngZone.run(() => {
      const ap = this.avanceProyectos || {};
      const counts = [
        Number(ap.concluidosGrafico ?? ap.concluidos) || 0,
        Number(ap.enProcesoGrafico ?? ap.enProceso) || 0
      ];
      const labels = ['Concluido', 'En proceso'];
      const total = this.totalAvanceEnGrafico;
      const count = counts[index] ?? 0;
      this.donutCentroValor = count;
      this.donutCentroEtiqueta = labels[index] || 'Proyectos';
      this.donutCentroPct = total ? Math.round((count / total) * 100) : 0;
    });
  }

  resetProveedoresF29DonutCentro(): void {
    this.ngZone.run(() => {
      const total = Number(this.proveedoresF29?.total) || 0;
      this.provF29DonutCentroValor = total;
      this.provF29DonutCentroEtiqueta = 'Proveedores';
      this.provF29DonutCentroSub = total
        ? `${this.proveedoresF29?.promedioCalificacion || 0}% prom.`
        : '';
    });
  }

  onProveedoresF29DonutHover(index: number): void {
    this.ngZone.run(() => {
      const pf = this.proveedoresF29 || {};
      const counts = [Number(pf.aprobados) || 0, Number(pf.reprobados) || 0];
      const labels = ['Aprobados', 'Reprobados'];
      const total = Number(pf.total) || 0;
      const count = counts[index] ?? 0;
      this.provF29DonutCentroValor = count;
      this.provF29DonutCentroEtiqueta = labels[index] || 'Proveedores';
      this.provF29DonutCentroSub = total ? `${Math.round((count / total) * 100)}% del total` : '';
    });
  }

  resetCapDonutCentro(): void {
    this.ngZone.run(() => {
      const tasa = Number(this.eficaciaCapacitacion?.tasaAprobacion) || 0;
      this.capDonutCentroValor = `${tasa}%`;
      this.capDonutCentroEtiqueta = 'Aprobación';
      this.capDonutCentroSub = '';
    });
  }

  resetSatDonutCentro(): void {
    this.ngZone.run(() => {
      const dist = this.satisfaccionCurso?.distribucion || {};
      const positivas = (Number(dist.excelente) || 0) + (Number(dist.bueno) || 0);
      const negativas = (Number(dist.regular) || 0) + (Number(dist.malo) || 0);
      const total = positivas + negativas;
      this.satDonutCentroValor = `${total > 0 ? Math.round((positivas / total) * 100) : 0}%`;
      this.satDonutCentroEtiqueta = 'Positivas';
      this.satDonutCentroSub = 'Excelente + Bueno';
    });
  }

  onSatDonutHover(index: number): void {
    this.ngZone.run(() => {
      const dist = this.satisfaccionCurso?.distribucion || {};
      const items = [
        {
          label: 'Positivas',
          detalle: 'Excelente + Bueno',
          count: (Number(dist.excelente) || 0) + (Number(dist.bueno) || 0)
        },
        {
          label: 'Negativas',
          detalle: 'Regular + Malo',
          count: (Number(dist.regular) || 0) + (Number(dist.malo) || 0)
        }
      ];
      const total = items.reduce((sum, item) => sum + item.count, 0);
      const item = items[index];
      if (!item) {
        this.resetSatDonutCentro();
        return;
      }
      this.satDonutCentroValor = `${total > 0 ? Math.round((item.count / total) * 100) : 0}%`;
      this.satDonutCentroEtiqueta = item.label;
      this.satDonutCentroSub = `${item.count} respuestas · ${item.detalle}`;
    });
  }

  resetSatCapDonutCentro(): void {
    this.ngZone.run(() => {
      const scap = this.satisfaccionCapacitacion || {};
      this.satCapDonutCentroValor = Number(scap.indiceAnual) || 0;
      this.satCapDonutCentroEtiqueta = 'Índice anual';
      this.satCapDonutCentroSub = `${Number(scap.totalRespuestas) || 0} resp.`;
    });
  }

  onSatCapDonutHover(index: number): void {
    this.ngZone.run(() => {
      const labels = ['Excelente', 'Bueno', 'Regular', 'Malo'];
      const dist = this.satisfaccionCapacitacion?.distribucion || {};
      const values = [
        Number(dist.excelente) || 0,
        Number(dist.bueno) || 0,
        Number(dist.regular) || 0,
        Number(dist.malo) || 0
      ];
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const count = values[index] || 0;
      this.satCapDonutCentroValor = count;
      this.satCapDonutCentroEtiqueta = labels[index] || 'Evaluación';
      this.satCapDonutCentroSub = `${Math.round((count / total) * 100)}%`;
    });
  }

  onCapDonutHover(index: number): void {
    this.ngZone.run(() => {
      const ec = this.eficaciaCapacitacion || {};
      const aprobados = Number(ec.totalAprobados) || 0;
      const cursos = Number(ec.totalCursos) || 0;
      const personas = Number(ec.totalEvaluados) || 0;
      const tasa = Number(ec.tasaAprobacion) || 0;
      if (index === 0) {
        this.capDonutCentroValor = `${tasa}%`;
        this.capDonutCentroEtiqueta = 'Aprobación';
        this.capDonutCentroSub = `${aprobados} de ${personas}`;
        return;
      }
      if (index === 1) {
        this.capDonutCentroValor = cursos;
        this.capDonutCentroEtiqueta = 'Cursos';
        this.capDonutCentroSub = cursos === 1 ? 'evaluado' : 'evaluados';
        return;
      }
      this.capDonutCentroValor = personas;
      this.capDonutCentroEtiqueta = 'Personas';
      this.capDonutCentroSub = personas === 1 ? 'evaluada' : 'evaluadas';
    });
  }

  nombreProyectoDisplay(p: any): string {
    const nombre = (p?.nombreProyecto || '').trim();
    if (nombre) return nombre;
    return p?.folio ? `Proyecto ${p.folio}` : `Proyecto ${p?.item || ''}`.trim() || 'Sin nombre';
  }

  gradienteAvanceProyecto(estatus: string, avance?: number): string {
    const c = this.colorAvancePorEstatus(estatus, avance);
    if (c === this.palette.verde) return 'linear-gradient(90deg, #15803d 0%, #22c55e 55%, #86efac 100%)';
    if (c === this.palette.teal) return 'linear-gradient(90deg, #0f766e 0%, #15a596 50%, #5eead4 100%)';
    return 'linear-gradient(90deg, #94a3b8 0%, #cbd5e1 100%)';
  }

  claseEstatusProyecto(estatus: string, avance?: number): string {
    const e = (estatus || '').toLowerCase();
    if (e.includes('conclu') || (Number(avance) || 0) >= 100) return 'sgc-proyecto-badge--concluido';
    if (e.includes('proceso') || (Number(avance) || 0) > 0) return 'sgc-proyecto-badge--proceso';
    return 'sgc-proyecto-badge--pendiente';
  }

  labelEstatusProyecto(estatus: string, avance?: number): string {
    if (estatus?.trim()) return estatus;
    const pct = Number(avance) || 0;
    if (pct >= 100) return 'Concluido';
    if (pct > 0) return 'En proceso';
    return 'No iniciado';
  }

  clasePrioridadProyecto(prioridad: string): string {
    const p = (prioridad || '').toLowerCase();
    if (p.includes('inmediat') || p.includes('alta') || p.includes('urgent') || p.includes('crít')) return 'sgc-proyecto-prio--alta';
    if (p.includes('media') || p.includes('medio') || p.includes('normal')) return 'sgc-proyecto-prio--media';
    if (p.includes('baja') || p.includes('low')) return 'sgc-proyecto-prio--baja';
    return 'sgc-proyecto-prio--nd';
  }

  colorAvancePorEstatus(estatus: string, avance?: number): string {
    const e = (estatus || '').toLowerCase();
    if (e.includes('conclu')) return this.palette.verde;
    if (e.includes('proceso')) return this.palette.teal;
    const pct = Number(avance) || 0;
    if (pct >= 100) return this.palette.verde;
    if (pct > 0) return this.palette.teal;
    return this.palette.gris;
  }

  get resumenEficaciaCap(): ChartKpiBadge[] {
    const ec = this.eficaciaCapacitacion || {};
    const cursos = Number(ec.totalCursos) || 0;
    const evaluados = Number(ec.totalEvaluados) || 0;
    const aprobados = Number(ec.totalAprobados) || 0;
    const tasa = Number(ec.tasaAprobacion) || 0;
    return [
      {
        label: 'Aprobación',
        subtitulo: `${tasa}% con resultado A`,
        icono: 'fa-check-circle',
        color: this.palette.azul,
        gradiente: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)'
      },
      {
        label: 'Evaluados',
        subtitulo: `${evaluados} participante${evaluados !== 1 ? 's' : ''}`,
        icono: 'fa-graduation-cap',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        label: 'Cursos',
        subtitulo: `${cursos} evaluado${cursos !== 1 ? 's' : ''} · ${aprobados} A`,
        icono: 'fa-book-open',
        color: this.palette.ambar,
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      }
    ];
  }

  /** Tarjetas del donut (mismo patrón que Distribución por estatus). */
  get resumenEficaciaCapDonut(): ChartKpiBadge[] {
    const ec = this.eficaciaCapacitacion || {};
    const cursos = Number(ec.totalCursos) || 0;
    const evaluados = Number(ec.totalEvaluados) || 0;
    const aprobados = Number(ec.totalAprobados) || 0;
    const tasa = Number(ec.tasaAprobacion) || 0;
    return [
      {
        label: 'Aprobación',
        subtitulo: `${tasa}% · ${aprobados} de ${evaluados}`,
        icono: 'fa-check-circle',
        color: this.palette.azul,
        gradiente: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)'
      },
      {
        label: 'Cursos',
        subtitulo: `${cursos} evaluado${cursos !== 1 ? 's' : ''}`,
        icono: 'fa-book-open',
        color: this.palette.ambar,
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      },
      {
        label: 'Personas',
        subtitulo: `${evaluados} evaluada${evaluados !== 1 ? 's' : ''}`,
        icono: 'fa-user-check',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      }
    ];
  }

  get resumenSatisfaccionCap(): ChartKpiBadge[] {
    const scap = this.satisfaccionCapacitacion || {};
    return [
      {
        label: 'Índice anual',
        subtitulo: `${scap.indiceAnual || 0}% evaluación general`,
        icono: 'fa-star',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        label: 'Respuestas',
        subtitulo: `${scap.totalRespuestas || 0} encuestas SP-F-14`,
        icono: 'fa-poll-h',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        label: 'Cursos',
        subtitulo: `${scap.cursosConEncuesta || 0} con datos · ${scap.recomiendaPct || 0}% recomienda`,
        icono: 'fa-chalkboard-teacher',
        color: this.palette.ambar,
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      }
    ];
  }

  get resumenSatisfaccion(): ChartKpiBadge[] {
    const sc = this.satisfaccionCurso || {};
    return [
      {
        label: 'Positivas',
        subtitulo: `${this.porcentajeSatisfaccionPositivas}% Excelente + Bueno`,
        icono: 'fa-smile',
        color: this.palette.satCliente,
        gradiente: `linear-gradient(135deg, ${this.palette.satCliente} 0%, ${this.palette.satClienteLight} 100%)`
      },
      {
        label: 'Respuestas',
        subtitulo: `${sc.totalRespuestas || 0} encuestas SGC-F-26`,
        icono: 'fa-poll',
        color: this.palette.satClienteLight,
        gradiente: `linear-gradient(135deg, ${this.palette.satCliente} 0%, ${this.palette.satClienteLight} 100%)`
      },
      {
        label: 'Empresas',
        subtitulo: `${sc.empresas || sc.cursosConEncuesta || 0} encuestadas`,
        icono: 'fa-building',
        color: this.palette.satCliente,
        gradiente: `linear-gradient(135deg, ${this.palette.satCliente} 0%, ${this.palette.satClienteLight} 100%)`
      }
    ];
  }

  get resumenSatCapDistrib(): ChartKpiBadge[] {
    const scap = this.satisfaccionCapacitacion || {};
    const dist = scap.distribucion || {};
    const total = Number(dist.total) || Number(scap.totalRespuestas) || 0;
    const filas = [
      { clave: 'excelente', label: 'Excelente', count: Number(dist.excelente) || 0, color: '#16a34a', gradiente: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)' },
      { clave: 'bueno', label: 'Bueno', count: Number(dist.bueno) || 0, color: this.palette.azul, gradiente: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)' },
      { clave: 'regular', label: 'Regular', count: Number(dist.regular) || 0, color: this.palette.ambar, gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)' },
      { clave: 'malo', label: 'Malo', count: Number(dist.malo) || 0, color: '#e11d48', gradiente: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)' }
    ];
    return filas.map((f) => ({
      clave: f.clave,
      label: f.label,
      subtitulo: total > 0 ? `${f.count} · ${Math.round((f.count / total) * 100)}%` : `${f.count} · 0%`,
      icono: 'fa-circle',
      color: f.color,
      gradiente: f.gradiente
    }));
  }

  get resumenSatisfaccionRespuestas(): ChartKpiBadge[] {
    const dist = this.satisfaccionCurso?.distribucion || {};
    const filas = [
      {
        clave: 'positivas',
        label: 'Positivas',
        detalle: 'Excelente + Bueno',
        count: (Number(dist.excelente) || 0) + (Number(dist.bueno) || 0),
        color: '#16a34a',
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      },
      {
        clave: 'negativas',
        label: 'Negativas',
        detalle: 'Regular + Malo',
        count: (Number(dist.regular) || 0) + (Number(dist.malo) || 0),
        color: '#e11d48',
        gradiente: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)'
      }
    ];
    const total = filas.reduce((sum, fila) => sum + fila.count, 0);
    return filas.map((fila) => ({
      clave: fila.clave,
      label: fila.label,
      subtitulo: `${total > 0 ? Math.round((fila.count / total) * 100) : 0}% · ${fila.detalle}`,
      icono: 'fa-circle',
      color: fila.color,
      gradiente: fila.gradiente
    }));
  }

  get comentariosSatisfaccionCap(): Array<{ curso: string; empresa: string; texto: string; fecha?: string }> {
    return (this.satisfaccionCapacitacion?.comentarios || []) as Array<{
      curso: string;
      empresa: string;
      texto: string;
      fecha?: string;
    }>;
  }

  get totalComentariosSatisfaccionCap(): number {
    return this.comentariosSatisfaccionCap.length;
  }

  get preguntasSatCap(): any[] {
    if (this.filtroMesSatCap != null) {
      const bloque = ((this.satisfaccionCapacitacion?.preguntasPorMes || []) as any[])
        .find((m) => Number(m?.mes_num) === this.filtroMesSatCap);
      return (bloque?.preguntas || []) as any[];
    }
    return (this.satisfaccionCapacitacion?.preguntas || []) as any[];
  }

  get preguntasChoiceSatCap(): any[] {
    return this.preguntasSatCap.filter((p) => p?.type === 'choice' && (p?.total_respuestas || 0) > 0);
  }

  get mesesDisponiblesSatCap(): Array<{ mes_num: number; mes: string; totalRespuestas: number; cursosConEncuesta: number }> {
    return ((this.satisfaccionCapacitacion?.preguntasPorMes || []) as any[])
      .filter((m) => (Number(m?.totalRespuestas) || 0) > 0)
      .map((m) => ({
        mes_num: Number(m.mes_num),
        mes: String(m.mes || this.mesesCortosSat[(Number(m.mes_num) || 1) - 1] || ''),
        totalRespuestas: Number(m.totalRespuestas) || 0,
        cursosConEncuesta: Number(m.cursosConEncuesta) || 0
      }));
  }

  get metaPreguntasSatCap(): { totalRespuestas: number; cursos: number; etiquetaPeriodo: string } {
    if (this.filtroMesSatCap != null) {
      const bloque = this.mesesDisponiblesSatCap.find((m) => m.mes_num === this.filtroMesSatCap);
      const mesNom = bloque?.mes || this.mesesCortosSat[this.filtroMesSatCap - 1] || '';
      return {
        totalRespuestas: bloque?.totalRespuestas || 0,
        cursos: bloque?.cursosConEncuesta || 0,
        etiquetaPeriodo: `${mesNom} ${this.anioSeleccionado}`
      };
    }
    return {
      totalRespuestas: Number(this.satisfaccionCapacitacion?.totalRespuestas) || 0,
      cursos: Number(this.satisfaccionCapacitacion?.cursosConEncuesta) || 0,
      etiquetaPeriodo: String(this.anioSeleccionado)
    };
  }

  abrirComentariosSatCap(): void {
    this.mostrarComentariosSatCap = true;
  }

  cerrarComentariosSatCap(): void {
    this.mostrarComentariosSatCap = false;
  }

  abrirPreguntasSatCap(): void {
    this.filtroMesSatCap = null;
    this.cerrarCombosFiltroSat();
    this.mostrarPreguntasSatCap = true;
  }

  cerrarPreguntasSatCap(): void {
    this.mostrarPreguntasSatCap = false;
    this.filtroMesSatCap = null;
    this.cerrarCombosFiltroSat();
  }

  get etiquetaFiltroMesSatCap(): string {
    if (this.filtroMesSatCap == null) return 'Todo el año';
    const m = this.mesesDisponiblesSatCap.find((x) => x.mes_num === this.filtroMesSatCap);
    return m ? `${m.mes} · ${m.totalRespuestas} resp.` : (this.mesesCortosSat[this.filtroMesSatCap - 1] || 'Mes');
  }

  get etiquetaFiltroMesSatCliente(): string {
    if (this.filtroMesSatCliente == null) return 'Todo el año';
    const m = this.mesesDisponiblesSatCliente.find((x) => x.mes_num === this.filtroMesSatCliente);
    return m ? `${m.mes} · ${m.respuestas} resp.` : (this.mesesCortosSat[this.filtroMesSatCliente - 1] || 'Mes');
  }

  get etiquetaFiltroEmpresaSatCliente(): string {
    return this.filtroEmpresaSatCliente || 'Todas las empresas';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClickCerrarCombosSat(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.sgc-sat-combo')) {
      return;
    }
    this.cerrarCombosFiltroSat();
  }

  cerrarCombosFiltroSat(): void {
    this.filtroMesSatCapAbierto = false;
    this.filtroMesSatClienteAbierto = false;
    this.filtroEmpresaSatClienteAbierto = false;
  }

  toggleComboMesSatCap(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const next = !this.filtroMesSatCapAbierto;
    this.filtroMesSatClienteAbierto = false;
    this.filtroEmpresaSatClienteAbierto = false;
    this.filtroMesSatCapAbierto = next;
  }

  toggleComboMesSatCliente(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const next = !this.filtroMesSatClienteAbierto;
    this.filtroMesSatCapAbierto = false;
    this.filtroEmpresaSatClienteAbierto = false;
    this.filtroMesSatClienteAbierto = next;
  }

  toggleComboEmpresaSatCliente(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const next = !this.filtroEmpresaSatClienteAbierto;
    this.filtroMesSatCapAbierto = false;
    this.filtroMesSatClienteAbierto = false;
    this.filtroEmpresaSatClienteAbierto = next;
  }

  seleccionarMesSatCap(mes: number | null, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.filtroMesSatCap = mes;
    this.filtroMesSatCapAbierto = false;
  }

  seleccionarMesSatCliente(mes: number | null, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.filtroMesSatCliente = mes;
    this.filtroMesSatClienteAbierto = false;
    this.onFiltroMesSatClienteChange();
  }

  seleccionarEmpresaSatCliente(empresa: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.filtroEmpresaSatCliente = empresa;
    this.filtroEmpresaSatClienteAbierto = false;
    this.onFiltroEmpresaSatClienteChange();
  }

  acortarTituloPreguntaSatCap(titulo: string): string {
    const t = String(titulo || '').trim();
    if (t.length <= 34) return t;
    return `${t.slice(0, 32)}…`;
  }

  etiquetaDimensionSatCap(titulo: string, id?: string): string {
    const clave = String(id || '').trim();
    const mapa: Record<string, string> = {
      evaluacion: 'Eval. general',
      pertinencia: 'Pertinencia',
      desempeno: 'Desempeño instr.',
      dominio: 'Dominio instr.',
      recomendacion: 'Recomienda'
    };
    if (clave && mapa[clave]) {
      return mapa[clave];
    }
    const t = this.normalizarTextoSatCap(titulo);
    if (t.includes('evalua') && t.includes('general')) return 'Eval. general';
    if (t.includes('pertinencia')) return 'Pertinencia';
    if (t.includes('desempeno') || t.includes('desempe')) return 'Desempeño instr.';
    if (t.includes('dominio')) return 'Dominio instr.';
    if (t.includes('recomienda')) return 'Recomienda';
    return this.acortarTituloPreguntaSatCap(titulo);
  }

  private normalizarTextoSatCap(texto: string): string {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  colorOpcionSatCap(label: string): string {
    const n = String(label || '').toLowerCase();
    if (n.includes('excelente') || n.includes('definitivamente si')) return '#16a34a';
    if (n.includes('buen')) return this.palette.azul;
    if (n.includes('regular')) return '#f59e0b';
    if (n.includes('mal') || n.includes('no')) return '#e11d48';
    return '#94a3b8';
  }

  colorOpcionSatCliente(label: string): string {
    const n = String(label || '').toLowerCase();
    if (n.includes('excelente') || n.includes('definitivamente si')) return '#16a34a';
    if (n.includes('buen')) return this.palette.satCliente;
    if (n.includes('regular')) return '#f59e0b';
    if (n.includes('mal') || n.includes('no')) return '#e11d48';
    return '#94a3b8';
  }

  get comentariosSatisfaccion(): Array<{ empresa: string; servicio?: string; texto: string; fecha?: string }> {
    return (this.satisfaccionCurso?.comentarios || []) as Array<{
      empresa: string;
      servicio?: string;
      texto: string;
      fecha?: string;
    }>;
  }

  get totalComentariosSatisfaccion(): number {
    return this.comentariosSatisfaccion.length;
  }

  abrirComentariosSatisfaccion(): void {
    this.mostrarComentariosSatisfaccion = true;
  }

  cerrarComentariosSatisfaccion(): void {
    this.mostrarComentariosSatisfaccion = false;
  }

  get preguntasChoiceSatisfaccion(): any[] {
    const preguntas = this.preguntasSatisfaccionFiltradas;
    return preguntas.filter((p) => p?.type === 'choice' && (p?.total_respuestas || 0) > 0);
  }

  get respuestasLiteSatCliente(): Array<{ mes_num: number; empresa: string; answers: Record<string, string[]> }> {
    return ((this.satisfaccionCurso?.respuestasLite || []) as any[]).map((r) => ({
      mes_num: Number(r?.mes_num) || 0,
      empresa: String(r?.empresa || 'Sin empresa'),
      answers: (r?.answers || {}) as Record<string, string[]>
    }));
  }

  get respuestasLiteSatClienteFiltradas(): Array<{ mes_num: number; empresa: string; answers: Record<string, string[]> }> {
    let lista = this.respuestasLiteSatCliente;
    if (this.filtroNegativosSatCliente) {
      lista = lista.filter((r) => this.respuestaTieneNegativosSatCliente(r));
    }
    if (this.filtroMesSatCliente != null) {
      lista = lista.filter((r) => r.mes_num === this.filtroMesSatCliente);
    }
    if (this.filtroEmpresaSatCliente) {
      const key = this.filtroEmpresaSatCliente.trim().toLowerCase();
      lista = lista.filter((r) => r.empresa.trim().toLowerCase() === key);
    }
    return lista;
  }

  get mesesDisponiblesSatCliente(): Array<{ mes_num: number; mes: string; respuestas: number }> {
    let lista = this.respuestasLiteSatCliente;
    if (this.filtroNegativosSatCliente) {
      lista = lista.filter((r) => this.respuestaTieneNegativosSatCliente(r));
    }
    if (this.filtroEmpresaSatCliente) {
      const key = this.filtroEmpresaSatCliente.trim().toLowerCase();
      lista = lista.filter((r) => r.empresa.trim().toLowerCase() === key);
    }
    const conteo = new Map<number, number>();
    for (const r of lista) {
      if (!r.mes_num) continue;
      conteo.set(r.mes_num, (conteo.get(r.mes_num) || 0) + 1);
    }
    return Array.from(conteo.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([mes_num, respuestas]) => ({
        mes_num,
        mes: this.mesesCortosSat[mes_num - 1] || `M${mes_num}`,
        respuestas
      }));
  }

  get empresasDisponiblesSatCliente(): string[] {
    let lista = this.respuestasLiteSatCliente;
    if (this.filtroNegativosSatCliente) {
      lista = lista.filter((r) => this.respuestaTieneNegativosSatCliente(r));
    }
    if (this.filtroMesSatCliente != null) {
      lista = lista.filter((r) => r.mes_num === this.filtroMesSatCliente);
    }
    const set = new Set<string>();
    for (const r of lista) {
      const nombre = (r.empresa || 'Sin empresa').trim();
      if (nombre) set.add(nombre);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  get preguntasSatisfaccionFiltradas(): any[] {
    const form = (this.satisfaccionCurso?.preguntasForm || []) as any[];
    const lite = this.respuestasLiteSatCliente;
    const hayFiltro =
      this.filtroMesSatCliente != null ||
      !!this.filtroEmpresaSatCliente ||
      this.filtroNegativosSatCliente;

    if (!form.length || !lite.length) {
      // Fallback si el payload aún no trae respuestasLite (caché antigua).
      if (hayFiltro) return [];
      return (this.satisfaccionCurso?.preguntas || []) as any[];
    }

    return this.agregarPreguntasDesdeRespuestasLite(form, this.respuestasLiteSatClienteFiltradas);
  }

  get metaPreguntasSatCliente(): { totalRespuestas: number; empresas: number; etiquetaPeriodo: string } {
    const filtradas = this.respuestasLiteSatClienteFiltradas;
    const hayLite = this.respuestasLiteSatCliente.length > 0;
    const totalRespuestas = hayLite
      ? filtradas.length
      : (Number(this.satisfaccionCurso?.totalRespuestas) || 0);
    const empresasSet = new Set(filtradas.map((r) => r.empresa.trim().toLowerCase()).filter(Boolean));
    const empresas = hayLite
      ? empresasSet.size
      : (Number(this.satisfaccionCurso?.empresas) || 0);

    const partes: string[] = [];
    if (this.filtroMesSatCliente != null) {
      partes.push(this.mesesCortosSat[this.filtroMesSatCliente - 1] || `M${this.filtroMesSatCliente}`);
    }
    partes.push(String(this.anioSeleccionado));
    if (this.filtroEmpresaSatCliente) {
      partes.push(this.filtroEmpresaSatCliente);
    }

    return {
      totalRespuestas,
      empresas,
      etiquetaPeriodo: partes.join(' · ')
    };
  }

  abrirPreguntasSatisfaccion(): void {
    this.filtroMesSatCliente = null;
    this.filtroEmpresaSatCliente = '';
    this.filtroNegativosSatCliente = false;
    this.cerrarCombosFiltroSat();
    this.mostrarPreguntasSatisfaccion = true;
  }

  cerrarPreguntasSatisfaccion(): void {
    this.mostrarPreguntasSatisfaccion = false;
    this.filtroMesSatCliente = null;
    this.filtroEmpresaSatCliente = '';
    this.filtroNegativosSatCliente = false;
    this.cerrarCombosFiltroSat();
  }

  toggleFiltroNegativosSatCliente(event?: Event): void {
    event?.stopPropagation();
    this.filtroNegativosSatCliente = !this.filtroNegativosSatCliente;
    this.onFiltroNegativosSatClienteChange();
  }

  onFiltroNegativosSatClienteChange(): void {
    if (
      this.filtroEmpresaSatCliente &&
      !this.empresasDisponiblesSatCliente.some(
        (e) => e.trim().toLowerCase() === this.filtroEmpresaSatCliente.trim().toLowerCase()
      )
    ) {
      this.filtroEmpresaSatCliente = '';
    }
    if (
      this.filtroMesSatCliente != null &&
      !this.mesesDisponiblesSatCliente.some((m) => m.mes_num === this.filtroMesSatCliente)
    ) {
      this.filtroMesSatCliente = null;
    }
  }

  private esPreguntaEscalaSat(pregunta: { type?: string; options?: string[] }): boolean {
    if (!pregunta || pregunta.type !== 'choice') return false;
    const opts = (pregunta.options || []).map((o) => this.normalizarTextoSat(o));
    return (
      opts.some((o) => o.includes('excelente')) &&
      opts.some((o) => o.includes('buen') || o.includes('regular') || o.includes('mal'))
    );
  }

  private normalizarTextoSat(texto: string): string {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private esRespuestaNegativaSat(valor: string): boolean {
    const n = this.normalizarTextoSat(valor);
    return n.includes('regular') || n.includes('mal');
  }

  private get idsPreguntasEscalaSatCliente(): string[] {
    const form = (this.satisfaccionCurso?.preguntasForm || []) as Array<{
      questionId: string;
      type?: string;
      options?: string[];
    }>;
    return form.filter((p) => this.esPreguntaEscalaSat(p)).map((p) => p.questionId);
  }

  private respuestaTieneNegativosSatCliente(respuesta: {
    answers: Record<string, string[]>;
  }): boolean {
    const ids = this.idsPreguntasEscalaSatCliente;
    if (!ids.length) return false;
    for (const id of ids) {
      const valores = (respuesta?.answers?.[id] || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean);
      if (valores.some((v) => this.esRespuestaNegativaSat(v))) return true;
    }
    return false;
  }

  onFiltroMesSatClienteChange(): void {
    if (
      this.filtroEmpresaSatCliente &&
      !this.empresasDisponiblesSatCliente.some(
        (e) => e.trim().toLowerCase() === this.filtroEmpresaSatCliente.trim().toLowerCase()
      )
    ) {
      this.filtroEmpresaSatCliente = '';
    }
  }

  onFiltroEmpresaSatClienteChange(): void {
    if (
      this.filtroMesSatCliente != null &&
      !this.mesesDisponiblesSatCliente.some((m) => m.mes_num === this.filtroMesSatCliente)
    ) {
      this.filtroMesSatCliente = null;
    }
  }

  private agregarPreguntasDesdeRespuestasLite(
    preguntasForm: Array<{ questionId: string; title: string; type: string; options?: string[] }>,
    responses: Array<{ answers: Record<string, string[]> }>
  ): any[] {
    const mapa = new Map<string, any>();

    for (const pregunta of preguntasForm) {
      if (pregunta.type !== 'choice') continue;
      mapa.set(pregunta.questionId, {
        question_id: pregunta.questionId,
        title: pregunta.title,
        type: 'choice',
        total_respuestas: 0,
        options: (pregunta.options || []).map((label) => ({ label, count: 0, percent: 0 }))
      });
    }

    for (const response of responses) {
      const answers = response?.answers || {};
      for (const [questionId, valores] of Object.entries(answers)) {
        if (!mapa.has(questionId)) continue;
        const pregunta = mapa.get(questionId);
        const vals = (valores || []).map((v) => String(v || '').trim()).filter(Boolean);
        if (!vals.length) continue;

        pregunta.total_respuestas += 1;
        for (const valor of vals) {
          let opcion = pregunta.options.find((opt: any) => opt.label === valor);
          if (!opcion) {
            opcion = { label: valor, count: 0, percent: 0 };
            pregunta.options.push(opcion);
          }
          opcion.count += 1;
        }
      }
    }

    return Array.from(mapa.values()).map((pregunta) => {
      const total = pregunta.total_respuestas || 1;
      return {
        ...pregunta,
        options: (pregunta.options || [])
          .map((opt: any) => ({ ...opt, percent: Math.round((opt.count / total) * 100) }))
          .sort((a: any, b: any) => b.count - a.count)
      };
    });
  }

  acortarEtiquetaServicio(label: string): string {
    const n = (label || '').toLowerCase();
    if (n.includes('consultor')) return 'Consultoría';
    if (n.includes('capacit')) return 'Capacitación';
    if (n.includes('trámite') || n.includes('tramite')) return 'Trámites';
    if (n.includes('salud')) return 'Salud ocupacional';
    return label.length > 28 ? `${label.slice(0, 26)}…` : label;
  }

  get resumenQuejas(): ChartKpiBadge[] {
    const q = this.quejasCliente || {};
    return [
      {
        label: 'Registradas',
        subtitulo: `${q.total || 0} en ${this.anioSeleccionado}`,
        icono: 'fa-inbox',
        color: this.palette.rojo,
        gradiente: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)'
      },
      {
        label: 'Abiertas',
        subtitulo: `${q.abiertas || 0} pendientes`,
        icono: 'fa-exclamation-circle',
        color: this.palette.ambar,
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      },
      {
        label: 'Atendidas',
        subtitulo: `${q.pctAtendidas || 0}% cerradas`,
        icono: 'fa-check',
        color: this.palette.verde,
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      }
    ];
  }

  get resumenProveedores(): ChartKpiBadge[] {
    const ep = this.evaluacionProveedores || {};
    return [
      {
        label: 'Promedio',
        subtitulo: `${ep.promedioCalificacion || 0}% calificación`,
        icono: 'fa-star-half-alt',
        color: this.palette.morado,
        gradiente: 'linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)'
      },
      {
        label: 'Evaluaciones',
        subtitulo: `${ep.total || 0} registradas`,
        icono: 'fa-truck',
        color: '#8b5cf6',
        gradiente: 'linear-gradient(135deg, #7c3aed 0%, #c4b5fd 100%)'
      }
    ];
  }

  get resumenAvance(): ChartKpiBadge[] {
    const ap = this.avanceProyectos || {};
    const base = this.totalAvanceEnGrafico || 0;
    return [
      {
        label: 'Concluidos',
        subtitulo: `${(ap.concluidosGrafico ?? ap.concluidos) || 0} de ${base}`,
        icono: 'fa-flag-checkered',
        color: this.palette.verde,
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      },
      {
        label: 'En proceso',
        subtitulo: `${(ap.enProcesoGrafico ?? ap.enProceso) || 0} activos`,
        icono: 'fa-spinner',
        color: this.palette.teal,
        gradiente: `linear-gradient(135deg, ${this.palette.tealDark} 0%, ${this.palette.teal} 100%)`
      },
      {
        label: 'No iniciados',
        subtitulo: `${ap.noIniciados || 0} fuera del gráfico`,
        icono: 'fa-pause-circle',
        color: this.palette.gris,
        gradiente: 'linear-gradient(135deg, #64748b 0%, #cbd5e1 100%)'
      }
    ];
  }

  get resumenProveedoresF29(): ChartKpiBadge[] {
    const pf = this.proveedoresF29 || {};
    const unicos = pf.totalProveedoresUnicos || pf.proveedoresAgrupados?.length || pf.total || 0;
    return [
      {
        label: 'Aprobados',
        subtitulo: `${pf.aprobados || 0} de ${pf.total || 0} eval. (≥80%)`,
        icono: 'fa-check-circle',
        color: this.palette.verde,
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      },
      {
        label: 'Reprobados',
        subtitulo: `${pf.reprobados || 0} bajo el mínimo · ${unicos} proveedores`,
        icono: 'fa-exclamation-circle',
        color: '#e11d48',
        gradiente: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)'
      }
    ];
  }

  get rankingProveedoresF29(): any[] {
    const agrupados = this.proveedoresF29?.proveedoresAgrupados;
    if (Array.isArray(agrupados) && agrupados.length) {
      return agrupados;
    }
    // Fallback: lista plana (compatibilidad)
    return (this.proveedoresF29?.proveedores || []).map((p: any) => ({
      proveedor: p.proveedor,
      totalEvaluaciones: 1,
      promedioCalificacion: p.calificacion,
      aprobado: p.aprobado,
      evidencias: p.evidencias || 0,
      evaluaciones: [p]
    }));
  }

  toggleExpandProveedorF29(nombre: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const clave = String(nombre || '');
    this.proveedoresF29Expandido = this.proveedoresF29Expandido === clave ? null : clave;
  }

  esProveedorF29Expandido(nombre: string): boolean {
    return this.proveedoresF29Expandido === String(nombre || '');
  }

  get criteriosProveedoresF29(): Array<{ label: string; valor: number }> {
    return this.criteriosProveedoresF29List;
  }

  private actualizarCriteriosProveedoresF29(): void {
    const c = this.proveedoresF29?.criterios || {};
    this.criteriosProveedoresF29List = [
      { label: 'Entrega a tiempo', valor: Number(c.entregaTiempo) || 0 },
      { label: 'Entrega a Domicilio', valor: Number(c.entregaDomicilio) || 0 },
      { label: 'Precio', valor: Number(c.precio) || 0 },
      { label: 'Pago Transferencia', valor: Number(c.pagoTransferencia) || 0 },
      { label: 'Calidad del Servicio', valor: Number(c.servicio) || 0 },
      { label: 'Calidad del producto', valor: Number(c.calidad) || 0 }
    ];
  }

  trackByCriterioProveedor(_index: number, c: { label: string }): string {
    return c.label;
  }

  trackByMesSat(_index: number, m: { mes_num: number }): number {
    return m.mes_num;
  }

  trackByEmpresaSat(_index: number, emp: string): string {
    return emp;
  }

  colorCalificacionProveedor(calificacion: number | null | undefined): string {
    const n = Number(calificacion);
    if (!Number.isFinite(n) || n <= 0) return '#94a3b8';
    if (n >= 80) return '#16a34a';
    if (n >= 50) return '#f59e0b';
    return '#e11d48';
  }

  gradienteCalificacionProveedor(calificacion: number | null | undefined): string {
    const color = this.colorCalificacionProveedor(calificacion);
    return `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`;
  }

  getEstatusQuejaClase(estatus: string): string {
    const n = (estatus || '').toLowerCase();
    if (n.includes('cerrad')) return 'sgc-nivel--alto';
    if (n.includes('atencion')) return 'sgc-nivel--medio';
    return 'sgc-nivel--bajo';
  }

  getNivelClase(nivel: string | null): string {
    if (nivel === 'alto') return 'sgc-nivel--alto';
    if (nivel === 'medio') return 'sgc-nivel--medio';
    if (nivel === 'bajo') return 'sgc-nivel--bajo';
    return 'sgc-nivel--nd';
  }

  private nivelCorto(nivel: string | null): string {
    if (nivel === 'alto') return 'Alto';
    if (nivel === 'medio') return 'Medio';
    if (nivel === 'bajo') return 'Bajo';
    return 'N/D';
  }

  private aclarar(hex: string): string {
    const map: Record<string, string> = {
      [this.palette.verde]: '#4ade80',
      [this.palette.ambar]: '#fbbf24',
      [this.palette.rojo]: '#fb7185',
      [this.palette.gris]: '#cbd5e1'
    };
    return map[hex] || hex;
  }

  formatFecha(fecha: string | null): string {
    if (!fecha) return 'Sin fecha';
    const d = new Date(`${fecha}T00:00:00`);
    if (Number.isNaN(d.getTime())) return fecha;
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  abrirFormQueja(): void {
    this.mostrarFormQueja = true;
    this.nuevaQueja = {
      cliente: '',
      fecha: new Date().toISOString().slice(0, 10),
      descripcion: '',
      estatus: 'Abierta',
      area: ''
    };
  }

  cancelarFormQueja(): void {
    this.mostrarFormQueja = false;
  }

  guardarQueja(): void {
    const cliente = (this.nuevaQueja.cliente || '').trim();
    if (!cliente) {
      Swal.fire({ icon: 'warning', title: 'Cliente requerido', text: 'Ingresa el nombre del cliente.', confirmButtonColor: '#15a596' });
      return;
    }
    const fecha = this.nuevaQueja.fecha || null;
    const anio = fecha ? Number(fecha.slice(0, 4)) : this.anioSeleccionado;

    this.guardandoQueja = true;
    this.backendService.crearQuejaSgc({
      cliente,
      fecha,
      anio,
      descripcion: (this.nuevaQueja.descripcion || '').trim(),
      estatus: this.nuevaQueja.estatus,
      area: (this.nuevaQueja.area || '').trim()
    }).subscribe({
      next: (res: any) => {
        this.guardandoQueja = false;
        if (res?.success) {
          this.mostrarFormQueja = false;
          if (anio !== this.anioSeleccionado && this.aniosDisponibles.includes(anio)) {
            this.anioSeleccionado = anio;
          }
          this.cargarDashboard(true);
          Swal.fire({ icon: 'success', title: 'Queja registrada', confirmButtonColor: '#15a596', timer: 1600, showConfirmButton: false });
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: res?.message || 'No se pudo registrar la queja.', confirmButtonColor: '#15a596' });
        }
      },
      error: (err) => {
        this.guardandoQueja = false;
        Swal.fire({ icon: 'error', title: 'Error', text: err?.error?.message || 'No se pudo registrar la queja.', confirmButtonColor: '#15a596' });
      }
    });
  }

  eliminarQueja(q: QuejaSgc): void {
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar queja?',
      html: `Se eliminará el registro de <strong>${q.cliente}</strong>.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.eliminarQuejaSgc(q.queja_id).subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.cargarDashboard(true);
            Swal.fire({ icon: 'success', title: 'Eliminada', confirmButtonColor: '#15a596', timer: 1400, showConfirmButton: false });
          }
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar la queja.', confirmButtonColor: '#15a596' });
        }
      });
    });
  }

  abrirFormProveedor(): void {
    this.mostrarFormProveedor = true;
    this.nuevaEvaluacion = {
      proveedor: '',
      fecha: new Date().toISOString().slice(0, 10),
      calificacion: 80,
      observaciones: ''
    };
  }

  cancelarFormProveedor(): void {
    this.mostrarFormProveedor = false;
  }

  guardarEvaluacionProveedor(): void {
    const proveedor = (this.nuevaEvaluacion.proveedor || '').trim();
    if (!proveedor) {
      Swal.fire({ icon: 'warning', title: 'Proveedor requerido', text: 'Ingresa el nombre del proveedor.', confirmButtonColor: '#15a596' });
      return;
    }
    const fecha = this.nuevaEvaluacion.fecha || null;
    const anio = fecha ? Number(fecha.slice(0, 4)) : this.anioSeleccionado;
    const calificacion = Math.min(100, Math.max(0, Number(this.nuevaEvaluacion.calificacion) || 0));

    this.guardandoProveedor = true;
    this.backendService.crearEvaluacionProveedorSgc({
      proveedor,
      fecha,
      anio,
      calificacion,
      observaciones: (this.nuevaEvaluacion.observaciones || '').trim()
    }).subscribe({
      next: (res: any) => {
        this.guardandoProveedor = false;
        if (res?.success) {
          this.mostrarFormProveedor = false;
          if (anio !== this.anioSeleccionado && this.aniosDisponibles.includes(anio)) {
            this.anioSeleccionado = anio;
          }
          this.cargarDashboard(true);
          Swal.fire({ icon: 'success', title: 'Evaluación registrada', confirmButtonColor: '#15a596', timer: 1600, showConfirmButton: false });
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: res?.message || 'No se pudo registrar la evaluación.', confirmButtonColor: '#15a596' });
        }
      },
      error: (err) => {
        this.guardandoProveedor = false;
        Swal.fire({ icon: 'error', title: 'Error', text: err?.error?.message || 'No se pudo registrar la evaluación.', confirmButtonColor: '#15a596' });
      }
    });
  }

  eliminarEvaluacionProveedor(ev: EvaluacionProveedorSgc): void {
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar evaluación?',
      html: `Se eliminará la evaluación de <strong>${ev.proveedor}</strong>.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.eliminarEvaluacionProveedorSgc(ev.evaluacion_id).subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.cargarDashboard(true);
            Swal.fire({ icon: 'success', title: 'Eliminada', confirmButtonColor: '#15a596', timer: 1400, showConfirmButton: false });
          }
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar la evaluación.', confirmButtonColor: '#15a596' });
        }
      });
    });
  }

  abrirFormAuditoria(): void {
    void this.router.navigate(['/sistema-gestion-calidad', 'capitulo-9', 'plantilla', 'sgc-f-10']);
  }

  cancelarFormAuditoria(): void {
    this.mostrarFormAuditoria = false;
  }

  guardarAuditoria(): void {
    // Captura manual deshabilitada: la fuente de verdad es SGC-F-10.
    this.abrirFormAuditoria();
  }

  eliminarAuditoria(aud: AuditoriaSgc): void {
    if (aud?.cerrado || aud?.fuente === 'SGC-F-10') {
      void Swal.fire({
        icon: 'info',
        title: 'Histórico SGC-F-10',
        text: 'Los informes cerrados en SGC-F-10 no se eliminan desde el dashboard. Usa el formato para consultar o archivar nuevos ciclos.',
        confirmButtonColor: '#15a596'
      });
      return;
    }
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar auditoría?',
      html: `Se eliminará <strong>${aud.titulo}</strong> y su resultado del indicador de eficacia.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.eliminarAuditoriaSgc(aud.auditoria_id).subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.cargarDashboard(true);
            Swal.fire({ icon: 'success', title: 'Eliminada', confirmButtonColor: '#15a596', timer: 1400, showConfirmButton: false });
          }
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar la auditoría.', confirmButtonColor: '#15a596' });
        }
      });
    });
  }
}
