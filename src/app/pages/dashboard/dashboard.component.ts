import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { NotificacionesService } from 'src/app/services/notificaciones.service';
import { formatearFechaCursoEs } from 'src/app/utils/fecha.util';

import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexFill,
  ApexTooltip,
  ApexYAxis,
  ApexGrid,
  ApexPlotOptions,
  ApexLegend,
  ApexMarkers
} from 'ng-apexcharts';

export type AreaChartOptions = {
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
  plotOptions?: ApexPlotOptions;
  legend?: ApexLegend;
  markers?: ApexMarkers;
};

interface MetricasResumen {
  totalCursos: number;
  totalProgramados: number;
  totalHistorialFinalizados: number;
  totalConParticipantes: number;
  constanciasEntregadas: number;
  constanciasNoRealizadas: number;
  constanciasDescargadas: number;
  constanciasGeneradas: number;
  sinParticipantes: number;
}

interface MetricaCard {
  key: string;
  titulo: string;
  valor: number;
  final: number;
  icono: string;
  color: string;
  gradiente: string;
  subtitulo: string;
}

interface CursoAgenda {
  programado_id: number;
  nombre_curso: string;
  nombre_empresa: string;
  empresa_logo?: string | null;
  instructor: string;
  fecha_inicio: string;
  fecha_fin?: string | null;
  hora_inicio: string | null;
  hora_fin?: string | null;
  participantes_cargados: number;
  cupo: number;
  dias_faltantes: number;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();
  private readonly meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  private readonly palette = {
    programados: '#5e72e4',
    finalizados: '#2dce89',
    participantes: '#f5365c',
    entregadas: '#38512F',
    generadas: '#768D6B',
    pendientes: '#fb6340',
    descargadas: '#5e8a4e'
  };

  cargando = true;
  error = false;
  anioActual = new Date().getFullYear();
  chartsReady = false;
  indicadoresIntro = false;
  private primeraCargaIndicadores = true;

  kpiCards: MetricaCard[] = [];
  metricasResumen: MetricasResumen = {
    totalCursos: 0,
    totalProgramados: 0,
    totalHistorialFinalizados: 0,
    totalConParticipantes: 0,
    constanciasEntregadas: 0,
    constanciasNoRealizadas: 0,
    constanciasDescargadas: 0,
    constanciasGeneradas: 0,
    sinParticipantes: 0
  };

  dashboardFiltros: { anio: number; empresaId: number | null; cursoId: number | null } = {
    anio: this.anioActual,
    empresaId: null,
    cursoId: null
  };
  filtrosCatalogo: { anios: number[]; empresas: any[]; cursos: any[] } = {
    anios: [],
    empresas: [],
    cursos: []
  };

  panoramaChartOptions: Partial<AreaChartOptions>;
  constanciasChartOptions: Partial<AreaChartOptions>;
  cursoHoy: CursoAgenda | null = null;
  cursosHoy: CursoAgenda[] = [];
  proximosCursosProgramados: CursoAgenda[] = [];

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router,
    private notificacionesService: NotificacionesService
  ) {
    this.initCharts();
  }

  ngOnInit() {
    if (this.authService.tieneAlgunRol(['empresa'])) {
      this.router.navigate(['/curso-activos']);
      return;
    }
    this.filtrosCatalogo.anios = [this.anioActual, this.anioActual - 1, this.anioActual - 2, this.anioActual - 3];
    this.cargarDashboard();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargarDashboard() {
    this.cargando = true;
    this.error = false;
    this.chartsReady = false;

    const filtros = this.getDashboardFiltrosPayload();

    this.backendService.obtenerDashboardCompleto(filtros)
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          if (res.success) {
            this.sincronizarCatalogosFiltros(res?.filtros);
            // Las notificaciones operativas viven en /api/notificaciones (campana).
            // No mezclar alertas genéricas del dashboard para roles con avisos filtrados.
            const rolesOperativos = ['instructor', 'control_documental', 'proteccion_civil', 'ambiental'];
            const usaNotifsOperativas = this.authService.tieneAlgunRol(rolesOperativos);
            this.notificacionesService.setAlertas(usaNotifsOperativas ? [] : (res.alertas || []));
            this.procesarMetricasOperativas(res.metricasOperativas);
            const fuenteCursosHoy = Array.isArray(res?.cursosHoy) && res.cursosHoy.length
              ? res.cursosHoy
              : (res?.cursoHoy ? [res.cursoHoy] : []);
            this.cursosHoy = fuenteCursosHoy
              .map((item: any) => this.normalizarCursoAgenda(item, 0))
              .filter((item: CursoAgenda | null): item is CursoAgenda => !!item);
            this.cursoHoy = this.cursosHoy[0] || null;
            this.proximosCursosProgramados = (res?.proximosCursosProgramados || res?.proximosCursos || [])
              .map((item: any) => this.normalizarCursoAgenda(item, Number(item?.dias_faltantes || 0)))
              .filter((item: CursoAgenda) => item.programado_id > 0 && item.dias_faltantes > 0);
          }
          this.cargando = false;
        },
        () => {
          this.error = true;
          this.cursoHoy = null;
          this.cursosHoy = [];
          this.proximosCursosProgramados = [];
          this.cargando = false;
        }
      );
  }

  private sincronizarCatalogosFiltros(filtrosPayload: any) {
    if (!filtrosPayload) return;

    this.filtrosCatalogo.anios = filtrosPayload.anios?.length
      ? filtrosPayload.anios
      : this.filtrosCatalogo.anios;
    this.filtrosCatalogo.empresas = filtrosPayload.empresas || [];
    this.filtrosCatalogo.cursos = filtrosPayload.cursos || [];

    const anioValido = this.filtrosCatalogo.anios.includes(this.dashboardFiltros.anio);
    if (!anioValido && this.filtrosCatalogo.anios.length) {
      this.dashboardFiltros.anio = this.filtrosCatalogo.anios[0];
    }

    if (this.dashboardFiltros.empresaId) {
      const empresaExiste = this.filtrosCatalogo.empresas.some(
        (e: any) => Number(e.empresa_id) === Number(this.dashboardFiltros.empresaId)
      );
      if (!empresaExiste) this.dashboardFiltros.empresaId = null;
    }
  }

  private getDashboardFiltrosPayload() {
    return {
      anio: this.dashboardFiltros.anio,
      ...(this.dashboardFiltros.empresaId ? { empresaId: this.dashboardFiltros.empresaId } : {}),
      ...(this.dashboardFiltros.cursoId ? { cursoId: this.dashboardFiltros.cursoId } : {})
    };
  }

  onFiltrosChange() {
    this.cargarDashboard();
  }

  limpiarFiltros() {
    this.dashboardFiltros = {
      anio: this.anioActual,
      empresaId: null,
      cursoId: null
    };
    this.cargarDashboard();
  }

  procesarMetricasOperativas(payload: any) {
    const resumen: MetricasResumen = {
      totalCursos: Number(payload?.resumen?.totalCursos || 0),
      totalProgramados: Number(payload?.resumen?.totalProgramados || 0),
      totalHistorialFinalizados: Number(payload?.resumen?.totalHistorialFinalizados || 0),
      totalConParticipantes: Number(payload?.resumen?.totalConParticipantes || 0),
      constanciasEntregadas: Number(payload?.resumen?.constanciasEntregadas || 0),
      constanciasNoRealizadas: Number(payload?.resumen?.constanciasNoRealizadas || 0),
      constanciasDescargadas: Number(payload?.resumen?.constanciasDescargadas || 0),
      constanciasGeneradas: Number(payload?.resumen?.constanciasGeneradas || 0),
      sinParticipantes: Number(payload?.resumen?.sinParticipantes || 0)
    };
    this.metricasResumen = resumen;
    this.kpiCards = this.buildKpiOperativos(resumen);
    this.kpiCards.forEach(card => this.animateCounter(card));
    this.actualizarCharts(payload?.tendenciaMensual || []);
    this.chartsReady = true;
    if (this.primeraCargaIndicadores) {
      this.indicadoresIntro = true;
      this.primeraCargaIndicadores = false;
      setTimeout(() => { this.indicadoresIntro = false; }, 480);
    }
  }

  private buildKpiOperativos(r: MetricasResumen): MetricaCard[] {
    return [
      {
        key: 'totalCapacitaciones',
        titulo: 'Total de capacitaciones',
        valor: 0, final: r.totalCursos,
        icono: 'fa-layer-group',
        gradiente: `linear-gradient(135deg, #32325d 0%, #525f7f 100%)`,
        subtitulo: `Registradas en ${this.dashboardFiltros.anio}`,
        color: '#32325d'
      },
      {
        key: 'programados',
        titulo: 'Programados',
        valor: 0, final: r.totalProgramados,
        icono: 'fa-calendar-alt',
        gradiente: `linear-gradient(135deg, ${this.palette.programados} 0%, #825ee4 100%)`,
        subtitulo: 'Estatus programado',
        color: this.palette.programados
      },
      {
        key: 'finalizados',
        titulo: 'Finalizados',
        valor: 0, final: r.totalHistorialFinalizados,
        icono: 'fa-check-double',
        gradiente: `linear-gradient(135deg, ${this.palette.finalizados} 0%, #26af74 100%)`,
        subtitulo: 'Impartidos y cerrados',
        color: this.palette.finalizados
      },
      {
        key: 'participantes',
        titulo: 'Con participantes',
        valor: 0, final: r.totalConParticipantes,
        icono: 'fa-user-check',
        gradiente: `linear-gradient(135deg, ${this.palette.participantes} 0%, #fb6340 100%)`,
        subtitulo: 'Inscripciones activas',
        color: this.palette.participantes
      },
      {
        key: 'entregadas',
        titulo: 'Constancias entregadas',
        valor: 0, final: r.constanciasEntregadas,
        icono: 'fa-file-signature',
        gradiente: `linear-gradient(135deg, ${this.palette.entregadas} 0%, #5a7456 100%)`,
        subtitulo: 'SP-F-03 o acreditación',
        color: this.palette.entregadas
      },
      {
        key: 'pendientes',
        titulo: 'Constancias pendientes',
        valor: 0, final: r.constanciasNoRealizadas,
        icono: 'fa-exclamation-circle',
        gradiente: `linear-gradient(135deg, ${this.palette.pendientes} 0%, #f5365c 100%)`,
        subtitulo: 'Sin anexo SP-F-03',
        color: this.palette.pendientes
      }
    ];
  }

  animateCounter(card: MetricaCard, duration: number = 1200) {
    const finalValue = card.final;
    const startTime = performance.now();
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      card.valor = Math.floor(finalValue * easeOut);
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        card.valor = finalValue;
      }
    };
    requestAnimationFrame(animate);
  }

  private chartBase() {
    return {
      fontFamily: 'Inter, Open Sans, system-ui, sans-serif',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: {
        enabled: true,
        easing: 'easeinout' as const,
        speed: 700,
        animateGradually: { enabled: true, delay: 100 },
        dynamicAnimation: { enabled: true, speed: 300 }
      }
    };
  }

  initCharts() {
    const gridModern = {
      borderColor: '#eef2f7',
      strokeDashArray: 0,
      padding: { top: 8, right: 12, bottom: 0, left: 8 },
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    };

    const legendBottom = {
      position: 'bottom' as const,
      horizontalAlign: 'center' as const,
      fontSize: '13px',
      fontWeight: 600,
      offsetY: 6,
      height: 44,
      markers: {
        width: 10,
        height: 10,
        radius: 10,
        offsetX: -3,
        offsetY: 0
      } as any,
      itemMargin: { horizontal: 16, vertical: 4 }
    };

    this.panoramaChartOptions = {
      series: [],
      chart: { ...this.chartBase(), type: 'area', height: 360, sparkline: { enabled: false } },
      colors: [this.palette.programados, this.palette.finalizados, this.palette.participantes],
      stroke: { curve: 'smooth', width: 2.5 },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 0.4,
          opacityFrom: 0.45,
          opacityTo: 0.04,
          stops: [0, 90, 100]
        }
      },
      dataLabels: { enabled: false },
      markers: { size: 0, hover: { size: 5 } },
      xaxis: {
        categories: [],
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { colors: '#94a3b8', fontSize: '12px', fontWeight: 500 } }
      },
      yaxis: {
        labels: {
          style: { colors: '#94a3b8', fontSize: '11px' },
          formatter: (val: number) => Math.round(val).toString()
        },
        min: 0,
        forceNiceScale: true
      },
      grid: { ...gridModern, padding: { top: 12, right: 12, bottom: 0, left: 8 } },
      legend: { show: false },
      tooltip: {
        theme: 'dark',
        x: { show: true },
        y: { formatter: (val: number) => `${Math.round(val)} curso${val !== 1 ? 's' : ''}` }
      }
    };

    this.constanciasChartOptions = {
      series: [],
      chart: { ...this.chartBase(), type: 'bar', height: 240, stacked: false },
      colors: [this.palette.entregadas, this.palette.pendientes, this.palette.descargadas],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '62%',
          borderRadius: 7,
          borderRadiusApplication: 'end'
        }
      },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.4,
          opacityFrom: 1,
          opacityTo: 0.82,
          stops: [0, 100]
        }
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: [],
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 600 } }
      },
      yaxis: {
        labels: {
          style: { colors: '#94a3b8', fontSize: '10px' },
          formatter: (val: number) => Math.round(val).toString()
        },
        min: 0,
        forceNiceScale: true,
        tickAmount: 4
      },
      grid: { ...gridModern, padding: { top: 8, right: 8, bottom: 0, left: 4 } },
      legend: { ...legendBottom, fontSize: '12px', height: 40, offsetY: 4 },
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        x: { show: true },
        y: { formatter: (val: number) => `${Math.round(val)} constancia${val !== 1 ? 's' : ''}` }
      }
    };
  }

  private buildConstanciasChart(labelsMes: string[], tendenciaMensual: any[]): Partial<AreaChartOptions> {
    const entregadas = tendenciaMensual.map((i: any) => Number(i.constanciasEntregadas) || 0);
    const pendientes = tendenciaMensual.map((i: any) => Number(i.constanciasNoRealizadas) || 0);
    const descargadas = tendenciaMensual.map((i: any) => Number(i.constanciasDescargadas) || 0);
    const maxVal = Math.max(...entregadas, ...pendientes, ...descargadas, 1);

    return {
      ...this.constanciasChartOptions,
      series: [
        { name: 'Entregadas', data: entregadas },
        { name: 'Pendientes', data: pendientes },
        { name: 'Descargas', data: descargadas }
      ],
      xaxis: { ...this.constanciasChartOptions.xaxis, categories: labelsMes },
      yaxis: {
        ...(this.constanciasChartOptions.yaxis as ApexYAxis),
        max: maxVal <= 3 ? maxVal + 1 : undefined
      }
    };
  }

  actualizarCharts(tendenciaMensual: any[]) {
    const labelsMes = (tendenciaMensual || []).map(
      (item: any) => this.meses[(Number(item.mes_num) || 1) - 1]
    );

    this.panoramaChartOptions = {
      ...this.panoramaChartOptions,
      series: [
        { name: 'Programados', data: tendenciaMensual.map((i: any) => Number(i.programados) || 0) },
        { name: 'Finalizados', data: tendenciaMensual.map((i: any) => Number(i.finalizados) || 0) },
        { name: 'Con participantes', data: tendenciaMensual.map((i: any) => Number(i.conParticipantes) || 0) }
      ],
      xaxis: { ...this.panoramaChartOptions.xaxis, categories: labelsMes }
    };

    this.constanciasChartOptions = this.buildConstanciasChart(labelsMes, tendenciaMensual);
  }

  get panoramaResumen(): { key: string; label: string; valor: number; icono: string; color: string; gradiente: string; subtitulo: string }[] {
    const r = this.metricasResumen;
    const total = r.totalCursos;
    return [
      {
        key: 'programados',
        label: 'Programados',
        valor: r.totalProgramados,
        icono: 'fa-calendar-alt',
        color: this.palette.programados,
        gradiente: `linear-gradient(135deg, ${this.palette.programados} 0%, #825ee4 100%)`,
        subtitulo: total ? `${this.getPct(r.totalProgramados, total)}% del total` : 'Estatus programado'
      },
      {
        key: 'finalizados',
        label: 'Finalizados',
        valor: r.totalHistorialFinalizados,
        icono: 'fa-check-double',
        color: this.palette.finalizados,
        gradiente: `linear-gradient(135deg, ${this.palette.finalizados} 0%, #26af74 100%)`,
        subtitulo: total ? `${this.getPct(r.totalHistorialFinalizados, total)}% del total` : 'Impartidos y cerrados'
      },
      {
        key: 'participantes',
        label: 'Con participantes',
        valor: r.totalConParticipantes,
        icono: 'fa-user-check',
        color: this.palette.participantes,
        gradiente: `linear-gradient(135deg, ${this.palette.participantes} 0%, #fb6340 100%)`,
        subtitulo: total ? `${this.getPct(r.totalConParticipantes, total)}% del total` : 'Inscripciones activas'
      }
    ];
  }

  get constanciasResumen(): { key: string; label: string; valor: number; icono: string; color: string; gradiente: string; subtitulo: string }[] {
    const r = this.metricasResumen;
    const totalEstatus = r.constanciasEntregadas + r.constanciasNoRealizadas;
    return [
      {
        key: 'entregadas',
        label: 'Entregadas',
        valor: r.constanciasEntregadas,
        icono: 'fa-file-signature',
        color: this.palette.entregadas,
        gradiente: `linear-gradient(135deg, #6b8f5e 0%, ${this.palette.entregadas} 100%)`,
        subtitulo: totalEstatus ? `${this.getPct(r.constanciasEntregadas, totalEstatus)}% del estatus` : 'Sin movimiento'
      },
      {
        key: 'pendientes',
        label: 'Pendientes',
        valor: r.constanciasNoRealizadas,
        icono: 'fa-hourglass-half',
        color: this.palette.pendientes,
        gradiente: `linear-gradient(135deg, #ff7a59 0%, ${this.palette.pendientes} 100%)`,
        subtitulo: totalEstatus ? `${this.getPct(r.constanciasNoRealizadas, totalEstatus)}% del estatus` : 'Sin pendientes'
      },
      {
        key: 'descargas',
        label: 'Descargas',
        valor: r.constanciasDescargadas,
        icono: 'fa-download',
        color: this.palette.descargadas,
        gradiente: `linear-gradient(135deg, #8ec97a 0%, ${this.palette.descargadas} 100%)`,
        subtitulo: r.constanciasGeneradas
          ? `${this.getPct(r.constanciasDescargadas, r.constanciasGeneradas)}% de generadas`
          : 'Registro de descargas'
      }
    ];
  }

  get hayDatosOperativos(): boolean {
    return this.metricasResumen.totalCursos > 0;
  }

  getPct(parte: number, total: number): number {
    if (!total) return 0;
    return Math.round((parte * 100) / total);
  }

  private normalizarCursoAgenda(item: any, diasDefault: number): CursoAgenda | null {
    if (!item) return null;
    const programadoId = Number(item.programado_id || 0);
    if (!programadoId) return null;
    return {
      programado_id: programadoId,
      nombre_curso: String(item.nombre_curso || 'Curso sin nombre'),
      nombre_empresa: String(item.nombre_empresa || 'Empresa no especificada'),
      empresa_logo: item.empresa_logo || item.logo || null,
      instructor: (String(item.instructor || '') || '').trim() || 'Sin instructor asignado',
      fecha_inicio: item.fecha_inicio,
      fecha_fin: item.fecha_fin || null,
      hora_inicio: item.hora_inicio || null,
      hora_fin: item.hora_fin || null,
      participantes_cargados: Number(item.participantes_cargados || item.inscritos || 0),
      cupo: Number(item.cupo || 25),
      dias_faltantes: Number(item.dias_faltantes ?? diasDefault ?? 0)
    };
  }

  getLogoEmpresaUrl(curso: CursoAgenda): string | null {
    return this.backendService.resolverUrlDrivePreview(curso?.empresa_logo || null);
  }

  getInicialesEmpresa(nombre: string): string {
    if (!nombre) return '??';
    const palabras = nombre.trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  onLogoEmpresaError(curso: CursoAgenda): void {
    if (!curso) return;
    curso.empresa_logo = null;
  }

  getPorcentajeOcupacion(curso: CursoAgenda): number {
    const inscritos = curso.participantes_cargados || 0;
    const cupo = curso.cupo || 25;
    return Math.min((inscritos / cupo) * 100, 100);
  }

  esCursoListo(curso: CursoAgenda): boolean {
    return (curso.participantes_cargados || 0) >= 0;
  }

  formatearFechaCurso(fecha: string): string {
    if (!fecha) return 'Sin fecha';
    return formatearFechaCursoEs(fecha) || 'Sin fecha';
  }

  formatearHoraCurso(hora: string | null): string {
    if (!hora) return 'Horario por confirmar';
    const [hh, mm] = String(hora).split(':');
    if (hh == null || mm == null) return String(hora);
    const hour24 = Number(hh);
    const minute = Number(mm);
    if (Number.isNaN(hour24) || Number.isNaN(minute)) return String(hora);
    const dt = new Date();
    dt.setHours(hour24, minute, 0, 0);
    return dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  formatearRangoHorario(horaInicio: string | null, horaFin: string | null): string {
    if (!horaInicio && !horaFin) return 'Horario por confirmar';
    const inicio = horaInicio ? this.formatearHoraCurso(horaInicio) : null;
    const fin = horaFin ? this.formatearHoraCurso(horaFin) : null;
    if (inicio && fin) return `${inicio} - ${fin}`;
    return inicio || fin || 'Horario por confirmar';
  }

  etiquetaDiasFaltantes(diasFaltantes: number): string {
    if (diasFaltantes <= 0) return 'Hoy';
    if (diasFaltantes === 1) return '1 día';
    return `${diasFaltantes} días`;
  }

  partirTextoEnLineas(texto: string, maxCaracteres = 12): string {
    if (!texto) return '';
    const limpio = texto.trim();
    if (limpio.length <= maxCaracteres) return limpio;

    const palabras = limpio.split(/\s+/);
    const lineas: string[] = [];
    let lineaActual = '';

    for (const palabra of palabras) {
      const candidato = lineaActual ? `${lineaActual} ${palabra}` : palabra;
      if (candidato.length > maxCaracteres && lineaActual) {
        lineas.push(lineaActual);
        lineaActual = palabra;
      } else {
        lineaActual = candidato;
      }
    }

    if (lineaActual) lineas.push(lineaActual);
    return lineas.join('\n');
  }
}
