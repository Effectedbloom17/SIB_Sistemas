import { Component, OnInit } from '@angular/core';
import * as QRCode from 'qrcode';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis
} from 'ng-apexcharts';
import { BackendServices } from 'src/app/services/backend.services';

/** Google Form público EIN-F-02 (respuesta). */
export const EIN_F02_FORMS_VIEW_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSeC8x7MYnmbsMnbt1FFNNj2TbLsiiAsohEkzd_mANPazqITsQ/viewform?usp=sharing';

export interface StatFila {
  etiqueta: string;
  cantidad: number;
  porcentaje: number;
}

interface FormsReciente {
  fecha?: string;
  nombre?: string;
  infraestructura?: string;
  prioridad?: string;
  ubicacion?: string;
  descripcion?: string;
}

const COLORES_INFRA = ['#0f766e', '#0284c7', '#7c3aed', '#d97706', '#e11d48', '#0891b2'];
const COLORES_UBIC = [
  '#0f766e', '#0284c7', '#7c3aed', '#d97706', '#db2777',
  '#0d9488', '#2563eb', '#c026d3', '#ea580c', '#4f46e5'
];
const COLORES_PRIORIDAD: Record<string, string> = {
  alta: '#e11d48',
  media: '#f59e0b',
  baja: '#16a34a',
  neutro: '#64748b'
};

export type MtBarChartOptions = {
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

export type MtDonutChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  plotOptions: ApexPlotOptions;
  dataLabels: ApexDataLabels;
  legend: ApexLegend;
  tooltip: ApexTooltip;
  stroke: ApexStroke;
  fill: ApexFill;
};

@Component({
  selector: 'app-solicitud-mantenimiento-forms',
  templateUrl: './solicitud-mantenimiento-forms.component.html',
  styleUrls: ['./solicitud-mantenimiento-forms.component.scss']
})
export class SolicitudMantenimientoFormsComponent implements OnInit {
  readonly formUrl = EIN_F02_FORMS_VIEW_URL;
  readonly codigo = 'EIN-F-02';
  readonly revision = '00';
  readonly fechaRev = '29-05-26';

  qrDataUrl = '';
  copiado = false;
  errorQr = '';
  cargandoStats = false;
  sincronizando = false;
  mensajeSync = '';

  total = 0;
  esteMes = 0;
  tiposInfra = 0;
  mensaje = '';
  fuente = '';

  porInfraestructura: StatFila[] = [];
  porPrioridad: StatFila[] = [];
  porUbicacion: StatFila[] = [];
  recientes: FormsReciente[] = [];

  infraChartReady = false;
  prioChartReady = false;
  ubicChartReady = false;
  infraChart: Partial<MtBarChartOptions> = {};
  prioChart: Partial<MtDonutChartOptions> = {};
  ubicChart: Partial<MtBarChartOptions> = {};
  donutCentroValor = 0;
  donutCentroEtiqueta = 'Respuestas';

  constructor(private backend: BackendServices) {}

  async ngOnInit(): Promise<void> {
    try {
      this.qrDataUrl = await QRCode.toDataURL(this.formUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('[mantenimiento] QR Forms:', err);
      this.errorQr = 'No se pudo generar el código QR.';
    }
    this.cargarEstadisticas(true);
  }

  get fuenteEtiqueta(): string {
    if (this.fuente === 'google_forms') {
      return 'Google Forms (en vivo)';
    }
    if (this.fuente === 'sin_auth') {
      return 'Sin autenticación Forms';
    }
    if (this.fuente === 'error') {
      return 'Error al leer Forms';
    }
    if (this.fuente === 'sin_servicio') {
      return 'Servicio Forms no disponible';
    }
    return this.fuente || 'Sin fuente';
  }

  get fuenteOk(): boolean {
    return this.fuente === 'google_forms';
  }

  cargarEstadisticas(_sincronizar = false): void {
    this.cargandoStats = true;
    this.backend.obtenerEstadisticasFormsMantenimientoF02().subscribe({
      next: (res) => {
        this.cargandoStats = false;
        this.aplicarRespuestaForms(res);
      },
      error: () => {
        this.cargandoStats = false;
        this.fuente = 'error';
        this.mensaje = 'No se pudieron cargar las respuestas del formulario.';
      }
    });
  }

  /** Solo refresca indicadores desde Forms; ya no empuja formatos a bitácora/reportes. */
  sincronizarAhora(): void {
    this.sincronizando = true;
    this.mensajeSync = '';
    this.backend.obtenerEstadisticasFormsMantenimientoF02().subscribe({
      next: (res) => {
        this.sincronizando = false;
        this.aplicarRespuestaForms(res);
        this.mensajeSync = this.fuenteOk
          ? `Indicadores actualizados desde Forms (${this.total} respuesta(s)).`
          : (this.mensaje || 'No se pudo confirmar la fuente de Forms.');
        setTimeout(() => {
          if (this.mensajeSync.startsWith('Indicadores')) {
            this.mensajeSync = '';
          }
        }, 4000);
      },
      error: () => {
        this.sincronizando = false;
        this.fuente = 'error';
        this.mensajeSync = 'No se pudieron leer las respuestas de Forms.';
      }
    });
  }

  private aplicarRespuestaForms(res: any): void {
    this.total = Number(res?.total) || 0;
    this.esteMes = Number(res?.esteMes) || 0;
    this.mensaje = res?.mensaje || '';
    this.fuente = res?.fuente || '';
    this.recientes = Array.isArray(res?.recientes) ? res.recientes : [];

    let porInfra = Array.isArray(res?.porInfraestructura) ? res.porInfraestructura : [];
    let porPrio = Array.isArray(res?.porPrioridad) ? res.porPrioridad : [];
    let porUbic = Array.isArray(res?.porUbicacion) ? res.porUbicacion : [];

    // Si el backend no clasificó campos, derivar de los casos crudos de Forms.
    const casos = Array.isArray(res?.casos) ? res.casos : [];
    if (casos.length) {
      if (!porInfra.length) {
        porInfra = this.contarCampoCasos(casos, 'tipoInfraestructura');
      }
      if (!porPrio.length) {
        porPrio = this.contarCampoCasos(casos, 'prioridad');
      }
      if (!porUbic.length) {
        porUbic = this.contarCampoCasos(casos, 'ubicacion');
      }
      if (!this.total) {
        this.total = casos.length;
      }
    }

    this.porInfraestructura = this.prepararFilas(porInfra, this.total);
    this.porPrioridad = this.prepararFilas(porPrio, this.total);
    this.porUbicacion = this.prepararFilas(porUbic, this.total);
    this.tiposInfra = this.porInfraestructura.length;
    this.construirGraficas();
  }

  private contarCampoCasos(
    casos: any[],
    campo: 'tipoInfraestructura' | 'prioridad' | 'ubicacion'
  ): Array<{ etiqueta: string; cantidad: number }> {
    const map = new Map<string, number>();
    for (const c of casos) {
      const etiqueta = String(c?.[campo] || '').trim();
      if (!etiqueta) {
        continue;
      }
      map.set(etiqueta, (map.get(etiqueta) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  trackByStat(_: number, item: StatFila): string {
    return `${item.etiqueta}__${item.cantidad}`;
  }

  clasePrioridad(etiqueta: string): string {
    const n = String(etiqueta || '').toLowerCase();
    if (n.includes('alta') || n.includes('urgent')) {
      return 'alta';
    }
    if (n.includes('media')) {
      return 'media';
    }
    if (n.includes('baja')) {
      return 'baja';
    }
    return 'neutro';
  }

  colorInfra(indice: number): string {
    return COLORES_INFRA[indice % COLORES_INFRA.length];
  }

  colorUbicacion(indice: number): string {
    return COLORES_UBIC[indice % COLORES_UBIC.length];
  }

  colorPrioridad(etiqueta: string): string {
    return COLORES_PRIORIDAD[this.clasePrioridad(etiqueta)] || COLORES_PRIORIDAD.neutro;
  }

  iconoPrioridad(etiqueta: string): string {
    const n = this.clasePrioridad(etiqueta);
    if (n === 'alta') {
      return 'fa-exclamation-triangle';
    }
    if (n === 'media') {
      return 'fa-minus-circle';
    }
    if (n === 'baja') {
      return 'fa-check-circle';
    }
    return 'fa-circle';
  }

  private construirGraficas(): void {
    this.infraChartReady = false;
    this.prioChartReady = false;
    this.ubicChartReady = false;
    this.donutCentroValor = this.total;
    this.donutCentroEtiqueta = 'Respuestas';

    if (this.porInfraestructura.length) {
      this.infraChart = this.crearBarChart(
        this.porInfraestructura,
        i => this.colorInfra(i),
        52
      );
    }
    if (this.porPrioridad.length) {
      this.prioChart = this.crearDonutChart(this.porPrioridad);
    }
    if (this.porUbicacion.length) {
      this.ubicChart = this.crearBarChart(
        this.porUbicacion,
        i => this.colorUbicacion(i),
        40
      );
    }

    setTimeout(() => {
      this.infraChartReady = this.porInfraestructura.length > 0;
      this.prioChartReady = this.porPrioridad.length > 0;
      this.ubicChartReady = this.porUbicacion.length > 0;
    });
  }

  private crearBarChart(
    filas: StatFila[],
    colorFn: (i: number) => string,
    filaAlto: number
  ): Partial<MtBarChartOptions> {
    const data = filas.map(f => f.cantidad);
    const maxVal = Math.max(...data, 1);
    const categorias = filas.map(f => this.acortarEtiqueta(f.etiqueta, 36));
    return {
      series: [{ name: 'Respuestas', data }],
      chart: {
        type: 'bar',
        height: Math.max(170, filas.length * filaAlto + 28),
        fontFamily: 'Open Sans, sans-serif',
        toolbar: { show: false },
        animations: { enabled: true, speed: 550 },
        parentHeightOffset: 0
      },
      colors: filas.map((_, i) => colorFn(i)),
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 6,
          barHeight: filas.length > 6 ? '58%' : '64%',
          distributed: true,
          dataLabels: { position: 'top' }
        }
      },
      dataLabels: {
        enabled: true,
        textAnchor: 'start',
        offsetX: 8,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#0f172a'] },
        formatter: (val: number, opts?: { dataPointIndex?: number }) => {
          const i = opts?.dataPointIndex ?? 0;
          const pct = filas[i]?.porcentaje ?? 0;
          return val > 0 ? `${val}  (${pct}%)` : '';
        }
      },
      xaxis: {
        categories: categorias,
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
        max: Math.max(maxVal * 1.38, maxVal + 1)
      },
      yaxis: {
        labels: {
          maxWidth: 220,
          style: { fontSize: '11px', fontWeight: 600, colors: ['#334155'] }
        }
      },
      grid: {
        borderColor: 'rgba(15, 23, 42, 0.08)',
        strokeDashArray: 4,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
        padding: { left: 8, right: 28, top: -8, bottom: -8 }
      },
      legend: { show: false },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'horizontal',
          shadeIntensity: 0.22,
          opacityFrom: 1,
          opacityTo: 0.78,
          stops: [0, 90, 100]
        }
      },
      stroke: { width: 0 },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val: number, opts?: { dataPointIndex?: number }) => {
            const i = opts?.dataPointIndex ?? 0;
            const fila = filas[i];
            const nombre = fila?.etiqueta || categorias[i] || '';
            const pct = fila?.porcentaje ?? 0;
            return `${val} respuesta${val !== 1 ? 's' : ''} · ${pct}% · ${nombre}`;
          }
        }
      }
    };
  }

  private crearDonutChart(filas: StatFila[]): Partial<MtDonutChartOptions> {
    return {
      series: filas.map(f => f.cantidad),
      chart: {
        type: 'donut',
        height: 228,
        fontFamily: 'Open Sans, sans-serif',
        animations: { enabled: true, speed: 550 }
      },
      labels: filas.map(f => f.etiqueta),
      colors: filas.map(f => this.colorPrioridad(f.etiqueta)),
      plotOptions: {
        pie: {
          expandOnClick: false,
          donut: {
            size: '74%',
            labels: { show: false }
          }
        }
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      stroke: { width: 3, colors: ['#fff'] },
      fill: { type: 'solid' },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) => {
            const i = opts?.seriesIndex ?? 0;
            const pct = filas[i]?.porcentaje ?? 0;
            return `${val} respuesta${val !== 1 ? 's' : ''} (${pct}%)`;
          }
        }
      }
    };
  }

  private acortarEtiqueta(texto: string, max = 36): string {
    const t = String(texto || '').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  private prepararFilas(
    datos: Array<{ etiqueta: string; cantidad: number }>,
    total: number,
    ordenarAlfabeticamente = false
  ): StatFila[] {
    const base = (datos || [])
      .map(d => ({
        etiqueta: String(d.etiqueta || 'Sin dato').trim() || 'Sin dato',
        cantidad: Number(d.cantidad) || 0,
        porcentaje: 0
      }))
      .filter(d => d.cantidad > 0);

    const suma = base.reduce((acc, d) => acc + d.cantidad, 0);
    const divisor = total > 0 ? total : suma;

    const filas = base.map(d => ({
      ...d,
      porcentaje: divisor > 0 ? Math.round((d.cantidad / divisor) * 1000) / 10 : 0
    }));

    if (ordenarAlfabeticamente) {
      return filas.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    }
    return filas.sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }

  copiarLink(): void {
    const ok = () => {
      this.copiado = true;
      setTimeout(() => {
        this.copiado = false;
      }, 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(this.formUrl).then(ok).catch(() => this.copiarFallback(ok));
      return;
    }
    this.copiarFallback(ok);
  }

  abrirFormulario(): void {
    window.open(this.formUrl, '_blank', 'noopener');
  }

  formatearFecha(iso?: string): string {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  private copiarFallback(onOk: () => void): void {
    try {
      const ta = document.createElement('textarea');
      ta.value = this.formUrl;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onOk();
    } catch {
      /* ignore */
    }
  }
}
