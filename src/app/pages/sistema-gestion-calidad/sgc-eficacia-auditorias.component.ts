import { Component, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  ApexChart,
  ApexFill,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexResponsive,
  ApexStroke,
  ApexTooltip
} from 'ng-apexcharts';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import { environment } from 'src/environments/environment';

export type SgcEficaciaRadialChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  plotOptions?: ApexPlotOptions;
  fill?: ApexFill;
  stroke?: ApexStroke;
  legend?: { show: boolean };
  dataLabels?: { enabled: boolean };
  tooltip?: ApexTooltip;
  responsive?: ApexResponsive[];
};

export interface AuditoriaSgcEficacia {
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
  ncCerradasBitacora?: number;
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

@Component({
  selector: 'app-sgc-eficacia-auditorias',
  templateUrl: './sgc-eficacia-auditorias.component.html',
  styleUrls: ['./sgc-eficacia-auditorias.component.scss']
})
export class SgcEficaciaAuditoriasComponent implements OnInit, OnDestroy {
  @Input() anio: number = new Date().getFullYear();
  /** Si false, oculta el botón «Abrir SGC-F-10» (útil cuando ya estás en el formato). */
  @Input() mostrarAbrirFormato = true;
  /** Incrementar para forzar recarga (p. ej. tras guardar/archivar). */
  @Input()
  set refreshKey(value: number) {
    const n = Number(value) || 0;
    if (n === this._refreshKey) {
      return;
    }
    this._refreshKey = n;
    if (this.readyOnce) {
      this.cargar(true);
    }
  }
  get refreshKey(): number {
    return this._refreshKey;
  }

  private _refreshKey = 0;
  private readyOnce = false;
  private readonly destroy$ = new Subject<void>();
  private readonly DONUT_HEIGHT = 180;
  private readonly DONUT_MOBILE: ApexResponsive = {
    breakpoint: 768,
    options: {
      chart: { height: 200, width: 200, dropShadow: { enabled: false } }
    }
  };

  cargando = true;
  chartsReady = false;
  eficacia: any = null;
  eficaciaChartModo: 'eficacia' | 'clasificacion' = 'eficacia';
  auditoriaSeleccionada: AuditoriaSgcEficacia | null = null;
  eficaciaDonutCentroValor: number | string = 0;
  eficaciaDonutCentroEtiqueta = 'NC actuales';
  eficaciaDonutCentroSub = '';
  eficaciaChart: Partial<SgcEficaciaRadialChartOptions> = {};

  constructor(
    private sgcDashboardCache: SgcDashboardCacheService,
    private ngZone: NgZone,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initChart();
    // En local forzamos datos frescos para no arrastrar históricos del cache.
    this.cargar(!environment.production);
    this.readyOnce = true;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargar(forzar = false): void {
    this.cargando = true;
    this.chartsReady = false;
    this.sgcDashboardCache.obtener(this.anio, forzar)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res?.eficacia != null) {
            this.eficacia = res.eficacia;
          }
          this.auditoriaSeleccionada = null;
          this.eficaciaChartModo = 'eficacia';
          this.sincronizarNcActualesDesdeListado();
          this.actualizarEficaciaChart();
          this.resetEficaciaDonutCentro();
          this.chartsReady = true;
          this.cargando = false;
        },
        error: () => {
          this.cargando = false;
          this.chartsReady = false;
        }
      });
  }

  get hayAuditorias(): boolean {
    return !!this.eficacia && (this.eficacia.totalAuditorias || 0) > 0;
  }

  get hayNcBitacora(): boolean {
    return (Number(this.eficacia?.totalNcBitacora) || 0) > 0;
  }

  get ncAbiertasAuditoriaDisplay(): number {
    return Number(this.eficacia?.ncAbiertasAuditoriaInterna) || 0;
  }

  get ncCerradasAuditoriaDisplay(): number {
    return Number(this.eficacia?.ncCerradasAuditoriaInterna) || 0;
  }

  get totalNcAuditoriaDisplay(): number {
    return Number(this.eficacia?.totalNcAuditoriaInterna) || 0;
  }

  get auditorias(): AuditoriaSgcEficacia[] {
    return (this.eficacia?.auditorias || []) as AuditoriaSgcEficacia[];
  }

  get auditoriasOrdenadas(): AuditoriaSgcEficacia[] {
    return [...this.auditorias].sort((a, b) => {
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

  get auditoriaUltimaTomada(): AuditoriaSgcEficacia | null {
    return this.auditoriasOrdenadas[0] || null;
  }

  get ncActualesDisplay(): number {
    const ultima = this.auditoriaUltimaTomada;
    if (ultima) {
      return Number(ultima.no_conformidades) || 0;
    }
    return Number(this.eficacia?.ncActual) || 0;
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

  get esModoClasificacionAud(): boolean {
    return this.eficaciaChartModo === 'clasificacion' && !!this.auditoriaSeleccionada;
  }

  claveAuditoria(aud: AuditoriaSgcEficacia | null | undefined): string {
    if (!aud) return '';
    return `${aud.auditoriaNo || ''}|${aud.auditoria_id || 0}|${aud.cerrado ? 'c' : 'v'}`;
  }

  estaAuditoriaSeleccionada(aud: AuditoriaSgcEficacia): boolean {
    return this.claveAuditoria(aud) === this.claveAuditoria(this.auditoriaSeleccionada);
  }

  getNivelClase(nivel: string | null): string {
    if (nivel === 'alto') return 'sgc-nivel--alto';
    if (nivel === 'medio') return 'sgc-nivel--medio';
    if (nivel === 'bajo') return 'sgc-nivel--bajo';
    return 'sgc-nivel--nd';
  }

  formatFecha(fecha: string | null): string {
    if (!fecha) return 'Sin fecha';
    const d = new Date(`${fecha}T00:00:00`);
    if (Number.isNaN(d.getTime())) return fecha;
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  seleccionarAuditoriaEficacia(aud: AuditoriaSgcEficacia): void {
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

  abrirFormAuditoria(): void {
    void this.router.navigate(['/sistema-gestion-calidad', 'capitulo-9', 'plantilla', 'sgc-f-10']);
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

  private initChart(): void {
    this.eficaciaChart = {
      series: [],
      chart: {
        ...this.chartBase(),
        type: 'donut',
        height: this.DONUT_HEIGHT,
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
      responsive: [this.DONUT_MOBILE]
    };
  }

  private nivelCorto(nivel: string | null): string {
    if (nivel === 'alto') return 'Alto';
    if (nivel === 'medio') return 'Medio';
    if (nivel === 'bajo') return 'Bajo';
    return 'N/D';
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
        this.eficaciaDonutCentroSub = total
          ? `${Math.round((count / total) * 100)}% de No. ${aud.auditoriaNo}`
          : '';
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
        height: this.DONUT_HEIGHT,
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
}
