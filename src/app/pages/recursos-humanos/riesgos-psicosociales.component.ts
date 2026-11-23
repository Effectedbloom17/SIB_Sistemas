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
type PestanaVista = 'factores' | 'ats' | 'importar' | 'historial';

export interface Nom035ResumenAts {
  total_evaluados?: number | null;
  requieren_atencion?: number | null;
  sin_riesgo?: number | null;
}

export interface Nom035ResumenFactores {
  nivel_riesgo?: string | null;
  personal_evaluado?: number | null;
  calificacion_promedio?: number | null;
  color_nivel?: string | null;
}

export interface Nom035Registro {
  id: number;
  periodo: string;
  tipo_encuesta: TipoEncuestaNom035;
  departamento: string;
  puesto: string;
  resumen: Nom035ResumenAts & Nom035ResumenFactores;
  detalle: any;
  archivo_nombre?: string | null;
  tiene_archivo?: boolean;
  notas?: string | null;
  creado_por?: string | null;
  creado_en?: string;
  confianza?: string;
  texto_extraido?: string;
}

interface BorradorImportacion {
  periodo: string;
  tipo_encuesta: TipoEncuestaNom035;
  departamento: string;
  puesto: string;
  resumen: Nom035ResumenAts & Nom035ResumenFactores;
  detalle: any;
  texto_extraido?: string;
  confianza?: string;
  notas?: string;
}

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
  pestana: PestanaVista = 'factores';

  registros: Nom035Registro[] = [];
  ultimoAts: Nom035Registro | null = null;
  ultimoFactores: Nom035Registro | null = null;
  catalogo: any = { niveles: [], rangos: [], reglas: [] };
  totales = { reportes: 0, ats: 0, factores: 0 };
  distribucionNiveles: Record<string, number> = {};

  archivoPendiente: File | null = null;
  borrador: BorradorImportacion | null = null;
  previewMensaje = '';
  dropOver = false;

  chartAts: {
    series: ApexNonAxisChartSeries;
    chart: ApexChart;
    labels: string[];
    colors: string[];
    legend: ApexLegend;
    dataLabels: ApexDataLabels;
    tooltip: ApexTooltip;
    plotOptions: ApexPlotOptions;
  } | null = null;

  chartNiveles: {
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
  } | null = null;

  readonly nivelesOrden = ['NULO', 'BAJO', 'MEDIO', 'ALTO', 'MUY ALTO'];

  constructor(private backend: BackendServices) {}

  ngOnInit(): void {
    this.cargarDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get metaFactores() {
    return this.ultimoFactores;
  }

  get metaAts() {
    return this.ultimoAts;
  }

  get resumenFactores(): Nom035ResumenFactores {
    return this.ultimoFactores?.resumen || {};
  }

  get resumenAts(): Nom035ResumenAts {
    return this.ultimoAts?.resumen || {};
  }

  get personasAts(): any[] {
    return Array.isArray(this.ultimoAts?.detalle?.personas) ? this.ultimoAts.detalle.personas : [];
  }

  get reglasAts(): any[] {
    return Array.isArray(this.catalogo?.reglas) && this.catalogo.reglas.length
      ? this.catalogo.reglas
      : (this.ultimoAts?.detalle?.reglas || []);
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
          this.ultimoAts = res?.ultimo_ats || null;
          this.ultimoFactores = res?.ultimo_factores || null;
          this.catalogo = res?.catalogo || { niveles: [], rangos: [], reglas: [] };
          this.totales = res?.totales || { reportes: 0, ats: 0, factores: 0 };
          this.distribucionNiveles = res?.distribucion_niveles || {};
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
    if (file) {
      this.procesarArchivo(file);
    }
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
    if (file) {
      this.procesarArchivo(file);
    }
  }

  procesarArchivo(file: File): void {
    const okExt = /\.(pdf|png|jpe?g|webp|gif)$/i.test(file.name);
    if (!okExt) {
      Swal.fire({
        icon: 'warning',
        title: 'Formato no soportado',
        text: 'Sube un PDF (preferido) o una imagen del reporte.'
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
          if (res?.catalogo) {
            this.catalogo = res.catalogo;
          }
          this.asegurarResumenBorrador();
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo leer el archivo',
            text: err?.error?.message || err?.message || 'Intenta con un PDF con texto seleccionable.'
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
      if (!Array.isArray(this.borrador.detalle?.personas)) {
        this.borrador.detalle = { ...(this.borrador.detalle || {}), personas: [] };
      }
    } else {
      this.borrador.resumen = {
        nivel_riesgo: this.borrador.resumen.nivel_riesgo || 'BAJO',
        personal_evaluado: this.borrador.resumen.personal_evaluado ?? null,
        calificacion_promedio: this.borrador.resumen.calificacion_promedio ?? null,
        color_nivel: this.colorNivel(this.borrador.resumen.nivel_riesgo || 'BAJO')
      };
    }
  }

  onTipoBorradorChange(): void {
    this.asegurarResumenBorrador();
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
    const tipoGuardado = this.borrador.tipo_encuesta;
    this.guardando = true;
    this.backend.guardarRrhhNom035(this.borrador, this.archivoPendiente || undefined)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => { this.guardando = false; })
      )
      .subscribe({
        next: () => {
          this.mensajeOk = 'Reporte NOM-035 guardado correctamente';
          this.cancelarImportacion();
          this.pestana = tipoGuardado === 'ats' ? 'ats' : 'factores';
          this.cargarDashboard();
          Swal.fire({
            icon: 'success',
            title: 'Guardado',
            text: 'Los indicadores ya están visibles en el dashboard.',
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
      title: '¿Eliminar reporte?',
      text: `${item.periodo} · ${item.tipo_encuesta === 'ats' ? 'Acontecimientos traumáticos' : 'Factores de riesgo'}`,
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
            this.mensajeOk = 'Reporte eliminado';
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

  etiquetaTipo(tipo: string): string {
    if (tipo === 'ats') return 'Acontecimientos traumáticos';
    if (tipo === 'factores') return 'Factores de riesgo';
    return 'Otro';
  }

  private armarCharts(): void {
    const ats = this.resumenAts;
    const requieren = Number(ats.requieren_atencion || 0);
    const sinRiesgo = Number(ats.sin_riesgo || 0);
    if ((requieren + sinRiesgo) > 0 || Number(ats.total_evaluados || 0) > 0) {
      this.chartAts = {
        series: [requieren, sinRiesgo || Math.max(0, Number(ats.total_evaluados || 0) - requieren)],
        chart: { type: 'donut', height: 260, fontFamily: 'Open Sans, sans-serif' },
        labels: ['Requieren atención', 'Sin riesgo'],
        colors: ['#db2777', '#16a34a'],
        legend: { position: 'bottom' },
        dataLabels: { enabled: true },
        tooltip: { y: { formatter: (v) => `${v}` } },
        plotOptions: {
          pie: {
            donut: {
              size: '62%',
              labels: {
                show: true,
                total: {
                  show: true,
                  label: 'Evaluados',
                  formatter: () => String(ats.total_evaluados ?? requieren + sinRiesgo)
                }
              }
            }
          }
        }
      };
    } else {
      this.chartAts = null;
    }

    const seriesData = this.nivelesOrden.map((n) => Number(this.distribucionNiveles?.[n] || 0));
    const colores = this.nivelesOrden.map((n) => this.colorNivel(n));
    if (seriesData.some((n) => n > 0) || this.ultimoFactores) {
      this.chartNiveles = {
        series: [{ name: 'Reportes', data: seriesData }],
        chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
        colors: colores,
        plotOptions: {
          bar: {
            distributed: true,
            borderRadius: 6,
            columnWidth: '52%'
          }
        },
        dataLabels: { enabled: true },
        xaxis: {
          categories: this.nivelesOrden,
          labels: { style: { fontWeight: 700 } }
        },
        yaxis: {
          min: 0,
          forceNiceScale: true,
          labels: { formatter: (v) => String(Math.round(Number(v))) }
        },
        legend: { show: false },
        tooltip: { y: { formatter: (v) => `${v} reporte(s)` } },
        fill: { opacity: 1 },
        stroke: { width: 0 }
      };
    } else {
      this.chartNiveles = null;
    }
  }
}
