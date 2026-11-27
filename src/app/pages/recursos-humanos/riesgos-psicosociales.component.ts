import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis
} from 'ng-apexcharts';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

export type TipoEncuestaNom035 = 'ats' | 'factores' | 'otro';
type PestanaVista = 'individuales' | 'grupales' | 'importar' | 'comparativas';

export interface Nom035Persona {
  nombre: string;
  puesto?: string;
  departamento?: string;
  puntaje?: number | null;
  nivel_riesgo?: string;
  color_nivel?: string;
}

export interface Nom035Grupo {
  departamento: string;
  personal: number;
  promedio: number | null;
  nivel_riesgo: string;
  color_nivel?: string;
  distribucion_niveles?: Record<string, number>;
}

export interface Nom035Registro {
  id: number;
  periodo: string;
  tipo_encuesta: TipoEncuestaNom035;
  departamento: string;
  puesto: string;
  resumen: any;
  detalle: any;
  archivo_nombre?: string | null;
  tiene_archivo?: boolean;
  notas?: string | null;
  creado_por?: string | null;
  creado_en?: string;
}

interface BorradorImportacion {
  periodo: string;
  tipo_encuesta: TipoEncuestaNom035;
  departamento: string;
  puesto: string;
  resumen: any;
  detalle: any;
  texto_extraido?: string;
  confianza?: string;
  notas?: string;
}

type ChartBar = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  plotOptions: ApexPlotOptions;
  dataLabels: ApexDataLabels;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  legend: ApexLegend;
  tooltip: ApexTooltip;
  fill: ApexFill;
  stroke: ApexStroke;
};

type ChartDonut = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  legend: ApexLegend;
  dataLabels: ApexDataLabels;
  tooltip: ApexTooltip;
  plotOptions: ApexPlotOptions;
};

type ChartLine = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  stroke: ApexStroke;
  dataLabels: ApexDataLabels;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  legend: ApexLegend;
  tooltip: ApexTooltip;
  fill?: ApexFill;
};

@Component({
  selector: 'app-riesgos-psicosociales',
  templateUrl: './riesgos-psicosociales.component.html',
  styleUrls: ['./residentes.component.scss', './riesgos-psicosociales.component.scss']
})
export class RiesgosPsicosocialesComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();

  cargando = false;
  importando = false;
  guardando = false;
  errorCarga = '';
  mensajeOk = '';
  pestana: PestanaVista = 'individuales';
  filtroDepto = '';
  busquedaPersona = '';

  registros: Nom035Registro[] = [];
  ultimoFactores: Nom035Registro | null = null;
  catalogo: any = { niveles: [], rangos: [], reglas: [] };
  totales = { reportes: 0, ats: 0, factores: 0 };
  individuales: Nom035Persona[] = [];
  grupales: Nom035Grupo[] = [];
  distribucionPersonas: Record<string, number> = {};
  comparativas: any = { periodos: [], serie_promedio: [], serie_personal: [], etiquetas: [] };

  archivoPendiente: File | null = null;
  borrador: BorradorImportacion | null = null;
  previewMensaje = '';
  dropOver = false;

  chartNivelesInd: ChartDonut | null = null;
  chartPuntajesInd: ChartBar | null = null;
  chartGruposPromedio: ChartBar | null = null;
  chartGruposPersonal: ChartBar | null = null;
  chartCompPromedio: ChartLine | null = null;
  chartCompPersonal: ChartBar | null = null;
  chartCompNiveles: ChartBar | null = null;

  readonly nivelesOrden = ['NULO', 'BAJO', 'MEDIO', 'ALTO', 'MUY ALTO'];

  constructor(private backend: BackendServices) {}

  ngOnInit(): void {
    this.cargarDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get resumen(): any {
    return this.ultimoFactores?.resumen || {};
  }

  get nivelesRef(): any[] {
    return Array.isArray(this.catalogo?.niveles) && this.catalogo.niveles.length
      ? this.catalogo.niveles
      : (this.ultimoFactores?.detalle?.niveles || []);
  }

  get rangosRef(): any[] {
    return Array.isArray(this.catalogo?.rangos) && this.catalogo.rangos.length
      ? this.catalogo.rangos
      : (this.ultimoFactores?.detalle?.rangos || []);
  }

  get personasFiltradas(): Nom035Persona[] {
    const q = this.busquedaPersona.trim().toLowerCase();
    const depto = this.filtroDepto.trim().toLowerCase();
    return (this.individuales || []).filter((p) => {
      if (depto && String(p.departamento || '').toLowerCase() !== depto) return false;
      if (!q) return true;
      const blob = `${p.nombre} ${p.puesto || ''} ${p.departamento || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }

  get departamentosOpciones(): string[] {
    const set = new Set<string>();
    for (const p of this.individuales || []) {
      if (p.departamento) set.add(p.departamento);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  get personasBorrador(): Nom035Persona[] {
    return Array.isArray(this.borrador?.detalle?.personas) ? this.borrador.detalle.personas : [];
  }

  colorNivel(nivel?: string | null): string {
    const n = String(nivel || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const map: Record<string, string> = {
      'MUY ALTO': '#dc2626',
      ALTO: '#ea580c',
      MEDIO: '#ca8a04',
      BAJO: '#16a34a',
      NULO: '#38bdf8'
    };
    return map[n] || '#64748b';
  }

  textoRango(r: { min?: number; max?: number | null }): string {
    if (r == null) return '—';
    if (r.max == null) return `Mayor de ${r.min}`;
    return `${r.min} – ${r.max}`;
  }

  rangoDeNivel(nivel?: string | null): string {
    const n = String(nivel || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const item = (this.rangosRef || []).find((x: any) =>
      String(x.nivel || '').toUpperCase().replace(/\s+/g, ' ').trim() === n
    );
    return item ? this.textoRango(item) : '—';
  }

  cargarDashboard(): void {
    this.cargando = true;
    this.errorCarga = '';
    this.backend.obtenerDashboardRrhhNom035()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => { this.cargando = false; })
      )
      .subscribe({
        next: (res) => {
          this.registros = res?.registros || [];
          this.ultimoFactores = res?.ultimo_factores || null;
          this.catalogo = res?.catalogo || { niveles: [], rangos: [], reglas: [] };
          this.totales = res?.totales || { reportes: 0, ats: 0, factores: 0 };
          this.individuales = res?.individuales || res?.ultimo_factores?.individuales || [];
          this.grupales = res?.grupales || res?.ultimo_factores?.grupales || [];
          this.distribucionPersonas = res?.distribucion_personas || {};
          this.comparativas = res?.comparativas || { periodos: [], serie_promedio: [], serie_personal: [], etiquetas: [] };
          this.armarCharts();
        },
        error: (err) => {
          this.errorCarga = err?.error?.message || 'No se pudo cargar el dashboard de riesgos psicosociales';
        }
      });
  }

  irPestana(p: PestanaVista): void {
    this.pestana = p;
  }

  dispararImportacion(): void {
    this.fileInput?.nativeElement?.click();
  }

  onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.procesarArchivo(file);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dropOver = true;
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dropOver = false;
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dropOver = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.procesarArchivo(file);
  }

  procesarArchivo(file: File): void {
    const okExt = /\.(pdf|png|jpe?g|webp|gif|xlsx|xls)$/i.test(file.name);
    if (!okExt) {
      Swal.fire({
        icon: 'warning',
        title: 'Formato no soportado',
        text: 'Sube un Excel (.xlsx), PDF o imagen del reporte.'
      });
      return;
    }
    this.pestana = 'importar';
    this.archivoPendiente = file;
    this.importando = true;
    this.previewMensaje = '';
    this.borrador = null;
    this.backend.previsualizarRrhhNom035(file)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => { this.importando = false; })
      )
      .subscribe({
        next: (res) => {
          this.previewMensaje = res?.mensaje || '';
          const b = res?.borrador || {};
          this.borrador = {
            periodo: b.periodo || 'Sin periodo',
            tipo_encuesta: b.tipo_encuesta || 'factores',
            departamento: b.departamento || 'Todos',
            puesto: b.puesto || 'Todos',
            resumen: { ...(b.resumen || {}) },
            detalle: { ...(b.detalle || {}) },
            texto_extraido: b.texto_extraido || '',
            confianza: b.confianza || 'baja',
            notas: ''
          };
          if (res?.catalogo) this.catalogo = res.catalogo;
          this.asegurarResumenBorrador();
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo leer el archivo',
            text: err?.error?.message || err?.message || 'Revisa el formato del Excel o PDF.'
          });
        }
      });
  }

  asegurarResumenBorrador(): void {
    if (!this.borrador) return;
    if (this.borrador.tipo_encuesta === 'ats') {
      this.borrador.resumen = {
        total_evaluados: this.borrador.resumen.total_evaluados ?? null,
        requieren_atencion: this.borrador.resumen.requieren_atencion ?? null,
        sin_riesgo: this.borrador.resumen.sin_riesgo ?? null
      };
      return;
    }
    const personas = Array.isArray(this.borrador.detalle?.personas) ? this.borrador.detalle.personas : [];
    this.borrador.resumen = {
      nivel_riesgo: this.borrador.resumen.nivel_riesgo || 'BAJO',
      personal_evaluado: this.borrador.resumen.personal_evaluado ?? personas.length ?? null,
      calificacion_promedio: this.borrador.resumen.calificacion_promedio ?? null,
      color_nivel: this.colorNivel(this.borrador.resumen.nivel_riesgo || 'BAJO'),
      distribucion_niveles: this.borrador.resumen.distribucion_niveles || {}
    };
  }

  onNivelBorradorChange(): void {
    if (!this.borrador) return;
    this.borrador.resumen.color_nivel = this.colorNivel(this.borrador.resumen.nivel_riesgo);
  }

  cancelarImportacion(): void {
    this.archivoPendiente = null;
    this.borrador = null;
    this.previewMensaje = '';
  }

  guardarImportacion(): void {
    if (!this.borrador) return;
    this.guardando = true;
    this.backend.guardarRrhhNom035(this.borrador, this.archivoPendiente || undefined)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => { this.guardando = false; })
      )
      .subscribe({
        next: () => {
          this.mensajeOk = 'Concentrado NOM-035 guardado correctamente';
          this.cancelarImportacion();
          this.pestana = 'individuales';
          this.cargarDashboard();
          Swal.fire({
            icon: 'success',
            title: 'Guardado',
            text: 'Ya puedes ver factores individuales, grupales y comparativas.',
            timer: 1800,
            showConfirmButton: false
          });
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo guardar',
            text: err?.error?.message || err?.message || 'Error al guardar el reporte'
          });
        }
      });
  }

  eliminarRegistro(item: Nom035Registro): void {
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar registro?',
      text: item.periodo,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#be185d'
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.backend.eliminarRrhhNom035(item.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.mensajeOk = 'Registro eliminado';
            this.cargarDashboard();
          },
          error: (err) => {
            Swal.fire({
              icon: 'error',
              title: 'No se pudo eliminar',
              text: err?.error?.message || 'Error al eliminar'
            });
          }
        });
    });
  }

  private armarCharts(): void {
    this.armarChartsIndividuales();
    this.armarChartsGrupales();
    this.armarChartsComparativas();
  }

  private armarChartsIndividuales(): void {
    const dist = this.distribucionPersonas || {};
    const seriesDonut = this.nivelesOrden.map((n) => Number(dist[n] || 0));
    if (seriesDonut.some((n) => n > 0)) {
      this.chartNivelesInd = {
        series: seriesDonut,
        chart: { type: 'donut', height: 280, fontFamily: 'Open Sans, sans-serif' },
        labels: this.nivelesOrden,
        colors: this.nivelesOrden.map((n) => this.colorNivel(n)),
        legend: { position: 'bottom' },
        dataLabels: { enabled: true },
        tooltip: { y: { formatter: (v) => `${v} persona(s)` } },
        plotOptions: {
          pie: {
            donut: {
              size: '58%',
              labels: {
                show: true,
                total: {
                  show: true,
                  label: 'Evaluados',
                  formatter: () => String(this.individuales.length || seriesDonut.reduce((a, b) => a + b, 0))
                }
              }
            }
          }
        }
      };
    } else {
      this.chartNivelesInd = null;
    }

    const top = [...(this.individuales || [])]
      .filter((p) => p.puntaje != null)
      .sort((a, b) => Number(b.puntaje) - Number(a.puntaje))
      .slice(0, 12);
    if (top.length) {
      this.chartPuntajesInd = {
        series: [{ name: 'Puntaje', data: top.map((p) => Number(p.puntaje) || 0) }],
        chart: { type: 'bar', height: Math.max(260, top.length * 28), toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
        colors: top.map((p) => this.colorNivel(p.nivel_riesgo)),
        plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 5, barHeight: '68%' } },
        dataLabels: { enabled: true },
        xaxis: { categories: top.map((p) => p.nombre), labels: { style: { fontSize: '11px' } } },
        yaxis: { labels: { maxWidth: 160 } },
        legend: { show: false },
        tooltip: { y: { formatter: (v) => `${v}` } },
        fill: { opacity: 1 },
        stroke: { width: 0 }
      };
    } else {
      this.chartPuntajesInd = null;
    }
  }

  private armarChartsGrupales(): void {
    const grupos = this.grupales || [];
    if (!grupos.length) {
      this.chartGruposPromedio = null;
      this.chartGruposPersonal = null;
      return;
    }
    this.chartGruposPromedio = {
      series: [{ name: 'Promedio', data: grupos.map((g) => Number(g.promedio) || 0) }],
      chart: { type: 'bar', height: Math.max(280, grupos.length * 36), toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
      colors: grupos.map((g) => this.colorNivel(g.nivel_riesgo)),
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 6, barHeight: '62%' } },
      dataLabels: { enabled: true },
      xaxis: { categories: grupos.map((g) => g.departamento) },
      yaxis: { labels: { maxWidth: 180 } },
      legend: { show: false },
      tooltip: { y: { formatter: (v) => `${v}` } },
      fill: { opacity: 1 },
      stroke: { width: 0 }
    };
    this.chartGruposPersonal = {
      series: [{ name: 'Personal', data: grupos.map((g) => Number(g.personal) || 0) }],
      chart: { type: 'bar', height: Math.max(260, grupos.length * 34), toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
      colors: ['#db2777'],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '48%' } },
      dataLabels: { enabled: true },
      xaxis: {
        categories: grupos.map((g) => g.departamento),
        labels: { rotate: -25, style: { fontSize: '10px' } }
      },
      yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v) => String(Math.round(Number(v))) } },
      legend: { show: false },
      tooltip: { y: { formatter: (v) => `${v} persona(s)` } },
      fill: { opacity: 1 },
      stroke: { width: 0 }
    };
  }

  private armarChartsComparativas(): void {
    const etiquetas = this.comparativas?.etiquetas || [];
    const serieProm = this.comparativas?.serie_promedio || [];
    const seriePers = this.comparativas?.serie_personal || [];
    const periodos = this.comparativas?.periodos || [];

    if (etiquetas.length && serieProm.length) {
      this.chartCompPromedio = {
        series: [{ name: 'Calificación promedio', data: serieProm }],
        chart: { type: 'area', height: 280, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
        colors: ['#9d174d'],
        stroke: { curve: 'smooth', width: 3 },
        dataLabels: { enabled: true },
        xaxis: { categories: etiquetas, labels: { rotate: -20, style: { fontSize: '11px' } } },
        yaxis: { min: 0, forceNiceScale: true },
        legend: { show: false },
        tooltip: { y: { formatter: (v) => `${v}` } },
        fill: {
          type: 'gradient',
          gradient: { shadeIntensity: 0.4, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 90, 100] }
        }
      };
    } else {
      this.chartCompPromedio = null;
    }

    if (etiquetas.length && seriePers.length) {
      this.chartCompPersonal = {
        series: [{ name: 'Personal evaluado', data: seriePers }],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
        colors: ['#db2777'],
        plotOptions: { bar: { borderRadius: 6, columnWidth: '45%' } },
        dataLabels: { enabled: true },
        xaxis: { categories: etiquetas, labels: { rotate: -20, style: { fontSize: '11px' } } },
        yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v) => String(Math.round(Number(v))) } },
        legend: { show: false },
        tooltip: { y: { formatter: (v) => `${v}` } },
        fill: { opacity: 1 },
        stroke: { width: 0 }
      };
    } else {
      this.chartCompPersonal = null;
    }

    const conteo = this.nivelesOrden.map((nivel) =>
      periodos.filter((p: any) => String(p.nivel_riesgo || '').toUpperCase().replace(/\s+/g, ' ') === nivel).length
    );
    if (conteo.some((n) => n > 0)) {
      this.chartCompNiveles = {
        series: [{ name: 'Periodos', data: conteo }],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
        colors: this.nivelesOrden.map((n) => this.colorNivel(n)),
        plotOptions: { bar: { distributed: true, borderRadius: 6, columnWidth: '50%' } },
        dataLabels: { enabled: true },
        xaxis: { categories: this.nivelesOrden },
        yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v) => String(Math.round(Number(v))) } },
        legend: { show: false },
        tooltip: { y: { formatter: (v) => `${v} periodo(s)` } },
        fill: { opacity: 1 },
        stroke: { width: 0 }
      };
    } else {
      this.chartCompNiveles = null;
    }
  }
}
