import { Component, OnInit, OnDestroy, Renderer2, ElementRef } from '@angular/core';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import Swal from 'sweetalert2';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

@Component({
  selector: 'app-estadisticas-medicas',
  templateUrl: './estadisticas-medicas.component.html',
  styleUrls: ['./estadisticas-medicas.component.scss']
})
export class EstadisticasMedicasComponent implements OnInit, OnDestroy {

  private mainContentEl: HTMLElement | null = null;

  empresas: any[] = [];
  empresaSeleccionada: any = null;
  cargandoEmpresas = false;

  cargandoEstadisticas: boolean = false;
  estadisticas: any = null;
  empresaEstadisticas: number | null = null; // null = todas
  chartEdad: any = {};
  chartGenero: any = {};
  chartIMC: any = {};
  chartTA: any = {};
  chartAdicciones: any = {};
  chartPatologias: any = {};
  chartParaclinicos: any = {};
  chartSaludGeneral: any = {};
  chartHeredoFamiliares: any = {};
  chartVacunacion: any = {};
  chartEjercicio: any = {};
  chartOrganosSistemas: any = {};
  chartTipoHistoria: any = {};
  // KPI computados
  pctTANormal: number = 0;
  pctIMCNormal: number = 0;
  pctNoFuma: number = 0;
  pctEnfermos: number = 0;

  // =====================================================
  // REPORTE
  // =====================================================
  mostrarReporte: boolean = false;
  exportandoPDF: boolean = false;
  exportandoPPT: boolean = false;
  progresoSlides: number = 0;
  textoProgresoSlides: string = '';
  private progresoSlidesTimer: number | null = null;
  anioReporte: number = new Date().getFullYear();
  reporteTituloPersonalizado: string = '';
  reporteTextos: { [key: string]: string } = {
    portada_intro: '',
    portada_bullet1: '',
    portada_bullet2: '',
    portada_bullet3: '',
    portada_bullet4: '',
    edad_texto: '',
    genero_texto: '',
    imc_texto: '',
    ta_texto: '',
    adicciones_texto: '',
    paraclinicos_texto: '',
    patologias_texto: '',
    heredo_familiares_texto: '',
    organos_sistemas_texto: '',
    recomendaciones: ''
  };
  reporteChartEdad: any = {};
  reporteChartGenero: any = {};
  reporteChartIMC: any = {};
  reporteChartTA: any = {};
  reporteChartAdicciones: any = {};
  reporteChartParaclinicos: any = {};
  reporteChartPatologias: any = {};
  reporteChartHeredoFamiliares: any = {};
  reporteChartOrganosSistemas: any = {};


  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendServices.obtenerEmpresasExpedientes().subscribe({
      next: (resp: any) => {
        if (resp.success) {
          const empresasExpedientes = Array.isArray(resp.empresas) ? resp.empresas : [];
          this.backendServices.obtenerEmpresas().subscribe({
            next: (catalogoResp: any) => {
              const catalogoEmpresas = catalogoResp?.success && Array.isArray(catalogoResp.empresas)
                ? catalogoResp.empresas
                : [];

              this.empresas = this.combinarEmpresasConCatalogo(empresasExpedientes, catalogoEmpresas);
              this.cargandoEmpresas = false;
            },
            error: () => {
              this.empresas = this.combinarEmpresasConCatalogo(empresasExpedientes, []);
              this.cargandoEmpresas = false;
            }
          });
          return;
        }
        this.cargandoEmpresas = false;
      },
      error: () => {
        this.cargandoEmpresas = false;
        // Fallback: cargar empresas normales
        this.backendServices.obtenerEmpresas().subscribe({
          next: (resp: any) => {
            if (resp.success) {
              this.empresas = resp.empresas.map((e: any) => ({
                empresa_id: e.empresa_id,
                nombre_empresa: e.nombre_empresa,
                rfc: e.rfc,
                logo: e.logo || e.logo_url || null,
                logo_url: e.logo_url || e.logo || null,
                estado: e.estado || '',
                ciudad: e.ciudad || '',
                historias_totales: 0
              }));
            }
          }
        });
      }
    });
  }

  private combinarEmpresasConCatalogo(empresasExpedientes: any[], catalogoEmpresas: any[]): any[] {
    const catalogoPorId = new Map<number, any>();

    catalogoEmpresas.forEach((empresa) => {
      if (empresa?.empresa_id) {
        catalogoPorId.set(empresa.empresa_id, empresa);
      }
    });

    return empresasExpedientes.map((empresaExpediente: any) => {
      const empresaCatalogo = catalogoPorId.get(empresaExpediente.empresa_id) || {};
      const logo = empresaExpediente.logo || empresaExpediente.logo_url || empresaCatalogo.logo || empresaCatalogo.logo_url || null;

      return {
        ...empresaCatalogo,
        ...empresaExpediente,
        estado: empresaExpediente.estado || empresaCatalogo.estado || '',
        ciudad: empresaExpediente.ciudad || empresaCatalogo.ciudad || '',
        logo,
        logo_url: empresaExpediente.logo_url || empresaExpediente.logo || empresaCatalogo.logo_url || empresaCatalogo.logo || null
      };
    });
  }

  onEmpresaEstadisticaChange(): void {
    this.cargarEstadisticas();
  }

  cargarEstadisticas(): void {
    this.cargandoEstadisticas = true;
    this.backendServices.obtenerEstadisticasExpedientes(
      this.empresaEstadisticas || undefined
    ).subscribe({
      next: (resp: any) => {
        if (resp.success) {
          this.estadisticas = resp;
          this.construirGraficas(resp);
        }
        this.cargandoEstadisticas = false;
      },
      error: () => {
        this.cargandoEstadisticas = false;
        Swal.fire('Error', 'No se pudieron cargar las estadÃ­sticas', 'error');
      }
    });
  }


  private construirGraficas(data: any): void {
    const total = data.total || 1;

    // KPI percentages
    const ta = data.tensionArterial || {};
    const taTotal = (ta.normal || 0) + (ta.elevada || 0) + (ta.hipertension1 || 0) + (ta.hipertension2 || 0);
    this.pctTANormal = taTotal > 0 ? Math.round(((ta.normal || 0) / taTotal) * 100) : 0;

    const imc = data.imc || {};
    const imcTotal = (imc.bajoPeso || 0) + (imc.normal || 0) + (imc.sobrepeso || 0) + (imc.obesidad1 || 0) + (imc.obesidad2 || 0) + (imc.obesidad3 || 0);
    this.pctIMCNormal = imcTotal > 0 ? Math.round(((imc.normal || 0) / imcTotal) * 100) : 0;

    const tab = data.tabaquismo || {};
    const tabNoFuma = parseInt(tab.no_fuma) || 0;
    const tabTotal = (parseInt(tab.fuma_actualmente) || 0) + (parseInt(tab.ex_fumador) || 0) + tabNoFuma;
    this.pctNoFuma = tabTotal > 0 ? Math.round((tabNoFuma / tabTotal) * 100) : 0;

    // Probabilidad de enfermos: suma de todas las patologÃ­as vs total
    const patKpi = data.patologias || {};
    const totalPat = (parseInt(patKpi.dentales) || 0) + (parseInt(patKpi.alergias) || 0) + (parseInt(patKpi.musculo_esqueleticas) || 0) +
      (parseInt(patKpi.digestivas) || 0) + (parseInt(patKpi.endocrinas) || 0) + (parseInt(patKpi.cardiovasculares) || 0) +
      (parseInt(patKpi.dermatologicas) || 0) + (parseInt(patKpi.pulmonares) || 0) + (parseInt(patKpi.urinarias) || 0) +
      (parseInt(patKpi.otras) || 0) + (parseInt(patKpi.psiquiatricas) || 0) + (parseInt(patKpi.infecto_contagiosas) || 0) +
      (parseInt(patKpi.congenitas) || 0);
    this.pctEnfermos = total > 0 ? Math.min(Math.round((totalPat / total) * 100), 100) : 0;

    // ---- Salud General (radialBar gauge) ----
    this.chartSaludGeneral = {
      series: [this.pctTANormal],
      chart: { type: 'radialBar', height: 260, sparkline: { enabled: true } },
      plotOptions: {
        radialBar: {
          startAngle: -135, endAngle: 135,
          hollow: { size: '60%' },
          track: { background: '#e7e7e7', strokeWidth: '100%' },
          dataLabels: {
            name: { show: true, fontSize: '11px', color: '#8a94a6', offsetY: 18, fontWeight: 500 },
            value: {
              show: true, fontSize: '28px', fontWeight: 800, color: '#1B2A4A', offsetY: -12,
              formatter: (val: number) => val + '%'
            }
          }
        }
      },
      colors: ['#0097A7'],
      labels: ['T.A. Normal'],
      stroke: { lineCap: 'round' }
    };

    // ---- Grupos de edad (bar) ----
    const edad = data.edad || {};
    this.chartEdad = {
      series: [{
        name: 'Personas', data: [
          parseInt(edad['18-29']) || 0, parseInt(edad['30-39']) || 0,
          parseInt(edad['40-49']) || 0, parseInt(edad['50-59']) || 0, parseInt(edad['60+']) || 0
        ]
      }],
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '52%', distributed: true } },
      colors: ['#006064', '#00838F', '#0097A7', '#00ACC1', '#00BCD4'],
      dataLabels: {
        enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        offsetY: -1
      },
      xaxis: {
        categories: ['18-29', '30-39', '40-49', '50-59', '60+'],
        labels: { style: { fontSize: '11px', colors: '#64748b' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#94a3b8' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' personas' } }
    };

    // ---- GÃ©nero (donut) ----
    const generoMap: any = {};
    (data.genero || []).forEach((g: any) => { generoMap[g.genero] = g.cantidad; });
    this.chartGenero = {
      series: [generoMap['masculino'] || 0, generoMap['femenino'] || 0],
      chart: { type: 'donut', height: 270 },
      labels: ['Masculino', 'Femenino'],
      colors: ['#006064', '#00BCD4'],
      legend: {
        position: 'bottom', fontSize: '12px', fontWeight: 600,
        markers: { width: 10, height: 10, radius: 3 }
      },
      dataLabels: {
        enabled: true, formatter: (val: number) => val.toFixed(0) + '%',
        style: { fontSize: '12px', fontWeight: 700 },
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: true, total: {
                show: true, label: 'Total', fontSize: '12px', fontWeight: 600, color: '#64748b',
                formatter: (w: any) => w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0)
              }
            },
            name: { show: true, fontSize: '11px' }
          }
        }
      },
      stroke: { width: 2, colors: ['#fff'] },
      responsive: [{ breakpoint: 480, options: { chart: { height: 200 } } }]
    };

    // ---- IMC (bar horizontal) ----
    const imcLabels = ['Bajo Peso', 'Normal', 'Sobrepeso', 'Obes. I', 'Obes. II', 'Obes. III'];
    const imcData = [imc.bajoPeso || 0, imc.normal || 0, imc.sobrepeso || 0,
    imc.obesidad1 || 0, imc.obesidad2 || 0, imc.obesidad3 || 0];
    this.chartIMC = {
      series: [{ name: 'Personas', data: imcData }],
      chart: { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {
        bar: {
          horizontal: true, borderRadius: 3, barHeight: '60%', distributed: true,
          dataLabels: { position: 'center' }
        }
      },
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#b91c1c'],
      dataLabels: {
        enabled: true,
        style: { fontSize: '12px', fontWeight: 700, colors: ['#fff'] },
        formatter: (val: number) => val > 0 ? String(val) : '',
        offsetX: 0
      },
      xaxis: {
        categories: imcLabels,
        labels: { style: { fontSize: '10px', colors: '#94a3b8' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#475569' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      legend: {
        show: true, position: 'bottom', fontSize: '12px',
        labels: { colors: '#475569' },
        markers: { radius: 3 },
        itemMargin: { horizontal: 8, vertical: 4 }
      },
      tooltip: { y: { formatter: (val: number) => val + ' personas' } }
    };

    // ---- TensiÃ³n arterial (donut) ----
    this.chartTA = {
      series: [ta.normal || 0, ta.elevada || 0, ta.hipertension1 || 0, ta.hipertension2 || 0],
      chart: { type: 'donut', height: 270 },
      labels: ['Normal', 'Elevada', 'Hiper. I', 'Hiper. II'],
      colors: ['#10b981', '#f59e0b', '#f97316', '#ef4444'],
      legend: {
        position: 'bottom', fontSize: '11px', fontWeight: 600,
        markers: { width: 10, height: 10, radius: 3 }
      },
      dataLabels: {
        enabled: true, formatter: (val: number) => val.toFixed(0) + '%',
        style: { fontSize: '11px', fontWeight: 700 }, dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: true, total: {
                show: true, label: 'Total', fontSize: '12px', fontWeight: 600, color: '#64748b',
                formatter: (w: any) => w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0)
              }
            }
          }
        }
      },
      stroke: { width: 2, colors: ['#fff'] },
      responsive: [{ breakpoint: 480, options: { chart: { height: 200 } } }]
    };

    // ---- Adicciones (grouped bar: Tabaco + Alcohol + Drogas) ----
    const alc = data.alcoholismo || {};
    const drg = data.drogas || {};
    this.chartAdicciones = {
      series: [
        { name: 'Activo', data: [parseInt(tab.fuma_actualmente) || 0, parseInt(alc.bebe_actualmente) || 0, parseInt(drg.consume_actualmente) || 0] },
        { name: 'Ex-consumidor', data: [parseInt(tab.ex_fumador) || 0, parseInt(alc.ex_bebedor) || 0, parseInt(drg.ex_consumidor) || 0] },
        { name: 'No consume', data: [parseInt(tab.no_fuma) || 0, parseInt(alc.no_bebe) || 0, parseInt(drg.no_consume) || 0] }
      ],
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit', stacked: false },
      plotOptions: { bar: { borderRadius: 3, columnWidth: '65%' } },
      colors: ['#ef4444', '#f59e0b', '#10b981'],
      dataLabels: { enabled: false },
      xaxis: {
        categories: ['Tabaquismo', 'Alcoholismo', 'Drogas'],
        labels: { style: { fontSize: '11px', colors: '#475569', fontWeight: 600 } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '10px', colors: '#94a3b8' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
      legend: {
        position: 'top', fontSize: '11px', fontWeight: 600, horizontalAlign: 'right',
        markers: { width: 9, height: 9, radius: 2 }
      },
      tooltip: { shared: true, intersect: false }
    };

    // ---- ParaclÃ­nicos (bar) ----
    const pc = data.paraclinicos || {};
    this.chartParaclinicos = {
      series: [{
        name: 'Realizados', data: [
          parseInt(pc.con_espirometria) || 0, parseInt(pc.con_audiometria) || 0,
          parseInt(pc.con_tele_torax) || 0, parseInt(pc.con_glucosa) || 0
        ]
      }],
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '48%', distributed: true } },
      colors: ['#006064', '#00838F', '#0097A7', '#00ACC1'],
      dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] }, offsetY: -1 },
      xaxis: {
        categories: ['EspirometrÃ­a', 'AudiometrÃ­a', 'Tele de tÃ³rax', 'ClÃ­nica sanguÃ­nea'],
        labels: { style: { fontSize: '10px', colors: '#64748b' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '10px', colors: '#94a3b8' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' estudios' } }
    };

    // ---- PatologÃ­as (horizontal bar, top 8) ----
    const pat = data.patologias || {};
    const patAll = [
      { label: 'Dentales', val: parseInt(pat.dentales) || 0 },
      { label: 'Alergias', val: parseInt(pat.alergias) || 0 },
      { label: 'MÃºsculo-esquelÃ©ticas', val: parseInt(pat.musculo_esqueleticas) || 0 },
      { label: 'Digestivas', val: parseInt(pat.digestivas) || 0 },
      { label: 'Endocrinas', val: parseInt(pat.endocrinas) || 0 },
      { label: 'Cardiovasculares', val: parseInt(pat.cardiovasculares) || 0 },
      { label: 'DermatolÃ³gicas', val: parseInt(pat.dermatologicas) || 0 },
      { label: 'Pulmonares', val: parseInt(pat.pulmonares) || 0 },
      { label: 'Urinarias', val: parseInt(pat.urinarias) || 0 },
      { label: 'Otras', val: parseInt(pat.otras) || 0 },
      { label: 'PsiquiÃ¡tricas', val: parseInt(pat.psiquiatricas) || 0 },
      { label: 'Infecto-contagiosas', val: parseInt(pat.infecto_contagiosas) || 0 },
      { label: 'CongÃ©nitas', val: parseInt(pat.congenitas) || 0 }
    ].sort((a, b) => b.val - a.val).slice(0, 8);

    this.chartPatologias = {
      series: [{ name: 'Casos', data: patAll.map(p => p.val) }],
      chart: { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {
        bar: {
          horizontal: true, borderRadius: 3, barHeight: '55%',
          distributed: true, dataLabels: { position: 'center' }
        }
      },
      colors: ['#006064', '#00696E', '#00838F', '#008F9B', '#0097A7', '#00A4B4', '#00ACC1', '#00BCD4'],
      dataLabels: {
        enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        formatter: (val: number) => val > 0 ? String(val) : ''
      },
      xaxis: {
        categories: patAll.map(p => p.label),
        labels: { style: { fontSize: '10px', colors: '#94a3b8' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#475569' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' casos' } }
    };

    // ---- Antecedentes Heredo-Familiares (bar horizontal) ----
    const hf = data.heredoFamiliares || {};
    const hfAll = [
      { label: 'Diabetes', val: parseInt(hf.diabetes) || 0 },
      { label: 'HipertensiÃ³n', val: parseInt(hf.hipertension) || 0 },
      { label: 'CÃ¡ncer', val: parseInt(hf.cancer) || 0 },
      { label: 'CardÃ­acos', val: parseInt(hf.cardiacos) || 0 },
      { label: 'Asma', val: parseInt(hf.asma) || 0 },
      { label: 'Alergias', val: parseInt(hf.alergias) || 0 },
      { label: 'Renales', val: parseInt(hf.renales) || 0 },
      { label: 'Convulsiones', val: parseInt(hf.convulsiones) || 0 },
      { label: 'Auditivas', val: parseInt(hf.auditivas) || 0 },
      { label: 'Visuales', val: parseInt(hf.visuales) || 0 }
    ].sort((a, b) => b.val - a.val);

    this.chartHeredoFamiliares = {
      series: [{ name: 'Casos', data: hfAll.map(h => h.val) }],
      chart: { type: 'bar', height: 340, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {
        bar: {
          horizontal: true, borderRadius: 3, barHeight: '55%',
          distributed: true, dataLabels: { position: 'center' }
        }
      },
      colors: ['#7c3aed', '#8b5cf6', '#a78bfa', '#6d28d9', '#5b21b6', '#7e22ce', '#9333ea', '#a855f7', '#c084fc', '#d8b4fe'],
      dataLabels: {
        enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        formatter: (val: number) => val > 0 ? String(val) : ''
      },
      xaxis: {
        categories: hfAll.map(h => h.label),
        labels: { style: { fontSize: '10px', colors: '#94a3b8' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#475569' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' casos' } }
    };

    // ---- VacunaciÃ³n (bar) ----
    const vac = data.vacunacion || {};
    this.chartVacunacion = {
      series: [{
        name: 'Vacunados', data: [
          parseInt(vac.sarampion) || 0, parseInt(vac.rubeola) || 0,
          parseInt(vac.influenza) || 0, parseInt(vac.toxoide_tetanico) || 0,
          parseInt(vac.covid) || 0
        ]
      }],
      chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { borderRadius: 4, columnWidth: '52%', distributed: true } },
      colors: ['#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] }, offsetY: -1 },
      xaxis: {
        categories: ['SarampiÃ³n', 'RubÃ©ola', 'Influenza', 'TÃ©tanos', 'COVID'],
        labels: { style: { fontSize: '10px', colors: '#64748b' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '10px', colors: '#94a3b8' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3 },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' personas' } }
    };

    // ---- Ejercicio / Actividad FÃ­sica (donut) ----
    const ej = data.ejercicio || {};
    this.chartEjercicio = {
      series: [parseInt(ej.realiza) || 0, parseInt(ej.no_realiza) || 0],
      chart: { type: 'donut', height: 270 },
      labels: ['SÃ­ realiza', 'No realiza'],
      colors: ['#059669', '#e11d48'],
      legend: {
        position: 'bottom', fontSize: '12px', fontWeight: 600,
        markers: { width: 10, height: 10, radius: 3 }
      },
      dataLabels: {
        enabled: true, formatter: (val: number) => val.toFixed(0) + '%',
        style: { fontSize: '12px', fontWeight: 700 }, dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: true, total: {
                show: true, label: 'Total', fontSize: '12px', fontWeight: 600, color: '#64748b',
                formatter: (w: any) => w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0)
              }
            }
          }
        }
      },
      stroke: { width: 2, colors: ['#fff'] },
      responsive: [{ breakpoint: 480, options: { chart: { height: 200 } } }]
    };

    // ---- Ã“rganos y Sistemas - Hallazgos Anormales (bar horizontal) ----
    const os = data.organosSistemas || {};
    const osAll = [
      { label: 'Cabeza/Cuello', val: parseInt(os.cabeza_cuello) || 0 },
      { label: 'Ojos', val: parseInt(os.ojos) || 0 },
      { label: 'OÃ­dos', val: parseInt(os.oidos) || 0 },
      { label: 'Nariz', val: parseInt(os.nariz) || 0 },
      { label: 'Orofaringe', val: parseInt(os.orofaringe) || 0 },
      { label: 'TÃ³rax', val: parseInt(os.torax) || 0 },
      { label: 'Abdomen', val: parseInt(os.abdomen) || 0 },
      { label: 'Extremidades', val: parseInt(os.extremidades) || 0 },
      { label: 'NeurolÃ³gico', val: parseInt(os.neurologico) || 0 },
      { label: 'Piel', val: parseInt(os.piel) || 0 }
    ].sort((a, b) => b.val - a.val);

    this.chartOrganosSistemas = {
      series: [{ name: 'Anormales', data: osAll.map(o => o.val) }],
      chart: { type: 'bar', height: 340, toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: {
        bar: {
          horizontal: true, borderRadius: 3, barHeight: '55%',
          distributed: true, dataLabels: { position: 'center' }
        }
      },
      colors: ['#dc2626', '#e11d48', '#f43f5e', '#fb7185', '#fda4af', '#fecdd3', '#be123c', '#9f1239', '#881337', '#4c0519'],
      dataLabels: {
        enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        formatter: (val: number) => val > 0 ? String(val) : ''
      },
      xaxis: {
        categories: osAll.map(o => o.label),
        labels: { style: { fontSize: '10px', colors: '#94a3b8' } },
        axisBorder: { show: false }, axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#475569' } } },
      grid: { borderColor: '#f1f5f9', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => val + ' hallazgos anormales' } }
    };

    // ---- Tipo de Historia ClÃ­nica (donut) ----
    const tipoMap: any = {};
    (data.tipoHistoria || []).forEach((t: any) => { tipoMap[t.tipo_historia] = parseInt(t.cantidad) || 0; });
    const tipoLabels = ['Ingreso', 'Subsecuente', 'Especial', 'Egreso'];
    const tipoKeys = ['ingreso', 'periodico', 'especial', 'egreso'];
    this.chartTipoHistoria = {
      series: tipoKeys.map(k => tipoMap[k] || 0),
      chart: { type: 'donut', height: 270 },
      labels: tipoLabels,
      colors: ['#2563eb', '#7c3aed', '#d97706', '#64748b'],
      legend: {
        position: 'bottom', fontSize: '12px', fontWeight: 600,
        markers: { width: 10, height: 10, radius: 3 }
      },
      dataLabels: {
        enabled: true, formatter: (val: number) => val.toFixed(0) + '%',
        style: { fontSize: '12px', fontWeight: 700 }, dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: true, total: {
                show: true, label: 'Total', fontSize: '12px', fontWeight: 600, color: '#64748b',
                formatter: (w: any) => w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0)
              }
            }
          }
        }
      },
      stroke: { width: 2, colors: ['#fff'] },
      responsive: [{ breakpoint: 480, options: { chart: { height: 200 } } }]
    };
  }

  getLogoEmpresaUrl(empresa: any = this.empresaSeleccionada): string | null {
    if (!empresa) {
      return null;
    }

    return this.backendServices.resolverUrlDrivePreview(empresa.logo || empresa.logo_url || null);
  }

  // =====================================================
  // REPORTE â€” mÃ©todos
  // =====================================================

  /**
   * Genera el reporte directamente desde la vista de estadÃ­sticas.
   * Muestra la barra de progreso en la misma pantalla y al finalizar
   * abre Google Slides en una nueva ventana.
   */
  generarReporteDirecto(): void {
    if (this.exportandoPPT) return;

    // Generar textos automÃ¡ticos y preparar grÃ¡ficas del reporte
    this.generarTextosAutoReporte();
    this.anioReporte = new Date().getFullYear();
    this.prepararGraficasReporte();

    // Mostrar el modal del reporte de forma oculta (necesario para que html2canvas capture las grÃ¡ficas)
    this.mostrarReporte = true;
    document.body.classList.add('reporte-abierto');

    // Esperar un tick para que Angular renderice las grÃ¡ficas, luego exportar
    setTimeout(() => {
      this.exportarGoogleSlides();
    }, 800);
  }

  abrirReporte(): void {
    this.generarTextosAutoReporte();
    this.anioReporte = new Date().getFullYear();
    this.prepararGraficasReporte();
    this.mostrarReporte = true;
    document.body.classList.add('reporte-abierto');
  }

  cerrarReporte(): void {
    this.mostrarReporte = false;
    document.body.classList.remove('reporte-abierto');
  }

  private prepararGraficasReporte(): void {
    const rh = 230;
    const mk = (orig: any, h: number = rh) => {
      if (!orig || !orig.chart) return {};
      return { ...orig, chart: { ...orig.chart, height: h, toolbar: { show: false } } };
    };
    this.reporteChartEdad = mk(this.chartEdad);
    this.reporteChartGenero = mk(this.chartGenero);
    this.reporteChartIMC = mk(this.chartIMC);
    this.reporteChartTA = mk(this.chartTA);
    this.reporteChartAdicciones = mk(this.chartAdicciones);
    this.reporteChartParaclinicos = mk(this.chartParaclinicos);
    this.reporteChartPatologias = mk(this.chartPatologias);
    this.reporteChartHeredoFamiliares = mk(this.chartHeredoFamiliares);
    this.reporteChartOrganosSistemas = mk(this.chartOrganosSistemas);
  }

  getEmpresaEstadisticasNombre(): string {
    if (!this.empresaEstadisticas) return 'Todas las empresas';
    const emp = this.empresas.find((e: any) => e.empresa_id === this.empresaEstadisticas);
    return emp ? emp.nombre_empresa : '';
  }

  getEmpresaEstadisticasObj(): any {
    if (this.empresaEstadisticas) {
      return this.empresas.find((e: any) => e.empresa_id === this.empresaEstadisticas) || null;
    }
    return this.empresaSeleccionada || null;
  }

  getLogoEmpresaReporteUrl(): string | null {
    const emp = this.getEmpresaEstadisticasObj();
    return this.getLogoEmpresaUrl(emp);
  }

  private generarTextosAutoReporte(): void {
    const d = this.estadisticas;
    if (!d) return;
    const total = d.total || 0;
    const empresaNombre = this.getEmpresaEstadisticasNombre();

    this.reporteTituloPersonalizado = `RESULTADOS DEL PLAN DE SALUD\n${empresaNombre.toUpperCase()} - ${this.anioReporte}`;
    this.reporteTextos['portada_intro'] = `A travÃ©s de este informe le presentamos los resultados obtenidos despuÃ©s de haber realizado revisiones mÃ©dicas a sus colaboradores en el aÃ±o ${this.anioReporte} los cuales incluyeron:`;
    this.reporteTextos['portada_bullet1'] = `${total} revisiones de peso y talla, con resultado de Ã­ndice de masa corporal (IMC) por bÃ¡scula de impedancia asÃ­ como toma de signos vitales.`;
    this.reporteTextos['portada_bullet2'] = `RevisiÃ³n de agudeza visual con tabla snellen`;
    this.reporteTextos['portada_bullet3'] = `EspirometrÃ­as con resultados obtenidos dentro de parÃ¡metros normales`;
    this.reporteTextos['portada_bullet4'] = `Electrocardiogramas con resultado normal`;

    const edad = d.edad || {};
    const edadEntries = Object.entries(edad).map(([k, v]: any) => [k, parseInt(v) || 0]).sort(([, a]: any, [, b]: any) => (b as number) - (a as number));
    const edadTotal = edadEntries.reduce((s: number, [, v]: any) => s + (v as number), 0);
    const edadLabels: any = { '18-29': 'adulto joven (18-29 aÃ±os)', '30-39': 'adulto (30-39 aÃ±os)', '40-49': 'adulto medio (40-49 aÃ±os)', '50-59': 'adulto mayor (50-59 aÃ±os)', '60+': 'tercera edad (60+ aÃ±os)' };
    const maxEdad = edadEntries[0];
    const maxLabel = maxEdad ? (edadLabels[maxEdad[0]] || maxEdad[0] + ' aÃ±os') : 'adulto joven (18-29 aÃ±os)';
    const pctMaxEdad = edadTotal > 0 && maxEdad ? Math.round(((maxEdad[1] as number) / edadTotal) * 100) : 0;
    const edadDesglose = edadEntries.filter(([, v]: any) => v > 0).map(([k, v]: any) => {
      const pct = Math.round((v / edadTotal) * 100);
      return `${k} aÃ±os: ${v} personas (${pct}%)`;
    }).join(', ');
    this.reporteTextos['edad_texto'] = `El rango de edad promedio se encuentra dentro del grupo de ${maxLabel} con ${maxEdad?.[1] || 0} personas (${pctMaxEdad}%), sin embargo, se deberÃ¡ dar seguimiento a las patologÃ­as del grupo adulto.\n\nDistribuciÃ³n: ${edadDesglose}.`;

    const generoMap: any = {};
    (d.genero || []).forEach((g: any) => { generoMap[g.genero] = parseInt(g.cantidad); });
    const masc = generoMap['masculino'] || 0;
    const fem = generoMap['femenino'] || 0;
    const genTotal = masc + fem;
    const pctMasc = genTotal > 0 ? Math.round((masc / genTotal) * 100) : 0;
    const pctFem = genTotal > 0 ? Math.round((fem / genTotal) * 100) : 0;
    this.reporteTextos['genero_texto'] = `El ${pctMasc}% de las revisiones fueron a personal del sexo masculino (${masc} personas) y el ${pctFem}% al sexo femenino (${fem} personas). Se propone realizar campaÃ±as de salud dirigidas al gÃ©nero predominante.`;

    const imc = d.imc || {};
    const imcNormal = imc.normal || 0;
    const imcSobrepeso = imc.sobrepeso || 0;
    const imcObes = (imc.obesidad1 || 0) + (imc.obesidad2 || 0) + (imc.obesidad3 || 0);
    const imcTotal = (imc.bajoPeso || 0) + imcNormal + imcSobrepeso + imcObes;
    const pctNorm = imcTotal > 0 ? Math.round((imcNormal / imcTotal) * 100) : 0;
    const pctSob = imcTotal > 0 ? Math.round(((imcSobrepeso + imcObes) / imcTotal) * 100) : 0;
    this.reporteTextos['imc_texto'] = `El ${pctNorm}% del personal se encuentra dentro del peso normal.\n\nEl ${pctSob}% del total de las personas presentan sobrepeso y obesidad de acuerdo a su Ã­ndice de masa corporal (IMC).\n\nSe recomienda planificar campaÃ±as motivacionales acerca del bienestar fÃ­sico y educaciÃ³n nutricional.`;

    const ta = d.tensionArterial || {};
    const taNormal = ta.normal || 0;
    const taAlta = ta.elevada || 0;
    const taHiper = (ta.hipertension1 || 0) + (ta.hipertension2 || 0);
    const taTotal = taNormal + taAlta + taHiper;
    const pctTAN = taTotal > 0 ? Math.round((taNormal / taTotal) * 100) : 0;
    this.reporteTextos['ta_texto'] = `El ${pctTAN}% de la poblaciÃ³n se encuentra dentro de cifras tensionales normales.\n\nSe detectaron ${taAlta} personas con cifras tensionales elevadas, por lo que deberÃ¡n hacer seguimiento de sus cifras de presiÃ³n arterial.\n\n${taHiper} colaboradores padecen hipertensiÃ³n arterial, con tratamiento establecido.`;

    const tab = d.tabaquismo || {};
    const fuma = parseInt(tab.fuma_actualmente) || 0;
    const exFumador = parseInt(tab.ex_fumador) || 0;
    const noFuma = parseInt(tab.no_fuma) || 0;
    const tabTotal2 = fuma + exFumador + noFuma;
    const pctFuma = tabTotal2 > 0 ? Math.round((fuma / tabTotal2) * 100) : 0;
    const pctExFuma = tabTotal2 > 0 ? Math.round((exFumador / tabTotal2) * 100) : 0;
    const pctNoFuma = tabTotal2 > 0 ? Math.round((noFuma / tabTotal2) * 100) : 0;

    const alc = d.alcoholismo || {};
    const bebeActivo = parseInt(alc.bebe_actualmente) || 0;
    const exBebedor = parseInt(alc.ex_bebedor) || 0;
    const noBebe = parseInt(alc.no_bebe) || 0;
    const alcTotal = bebeActivo + exBebedor + noBebe;
    const pctBebe = alcTotal > 0 ? Math.round((bebeActivo / alcTotal) * 100) : 0;
    const pctExBebe = alcTotal > 0 ? Math.round((exBebedor / alcTotal) * 100) : 0;
    const pctNoBebe = alcTotal > 0 ? Math.round((noBebe / alcTotal) * 100) : 0;

    const drg = d.drogas || {};
    const consumeActivo = parseInt(drg.consume_actualmente) || 0;
    const exConsumidor = parseInt(drg.ex_consumidor) || 0;
    const noConsume = parseInt(drg.no_consume) || 0;
    const drgTotal = consumeActivo + exConsumidor + noConsume;
    const pctConsumeD = drgTotal > 0 ? Math.round((consumeActivo / drgTotal) * 100) : 0;
    const pctExConsumeD = drgTotal > 0 ? Math.round((exConsumidor / drgTotal) * 100) : 0;
    const pctNoConsumeD = drgTotal > 0 ? Math.round((noConsume / drgTotal) * 100) : 0;

    this.reporteTextos['adicciones_texto'] = `Dentro de las adicciones interrogadas, se encontrÃ³ que el ${pctFuma}% del total de las personas evaluadas tienen el hÃ¡bito tabÃ¡quico (activo), el ${pctExFuma}% son ex-fumadores y el ${pctNoFuma}% no fuman, por lo que se recomienda realizar campaÃ±as anti tabaco permanentes con un enfoque psicolÃ³gico.\n\nEn cuanto al alcoholismo, el ${pctBebe}% consume alcohol activamente, el ${pctExBebe}% es ex-bebedor y el ${pctNoBebe}% no consume alcohol.\n\nRespecto a otras drogas, el ${pctConsumeD}% consume activamente, el ${pctExConsumeD}% es ex-consumidor y el ${pctNoConsumeD}% no consume drogas.`;

    this.reporteTextos['paraclinicos_texto'] = `Se presentan los resultados de los estudios paraclÃ­nicos realizados a los colaboradores. Se recomienda dar seguimiento a los resultados alterados y realizar las interconsultas necesarias con especialistas.`;

    this.reporteTextos['patologias_texto'] = `Se detectaron diversas patologÃ­as en los colaboradores evaluados. Se detectaron casos que requieren seguimiento mÃ©dico prioritario. Se recomienda realizar las interconsultas necesarias con especialistas.`;

    this.reporteTextos['heredo_familiares_texto'] = `Se identificaron antecedentes heredo-familiares de importancia mÃ©dica en la poblaciÃ³n evaluada, lo que representa un factor de riesgo a considerar en el bienestar general de los colaboradores. Se sugieren estrategias de prevenciÃ³n primaria.`;

    this.reporteTextos['organos_sistemas_texto'] = `En relaciÃ³n con las alteraciones detectadas por aparatos y sistemas, se encontraron hallazgos que ameritan atenciÃ³n y vigilancia continua. Es recomendable canalizar los casos afirmativos para una evaluaciÃ³n y diagnÃ³stico oportuno.`;

    this.reporteTextos['recomendaciones'] = `1. Realizar campaÃ±a para disminuir el consumo del hÃ¡bito tabÃ¡quico.\n2. Fomentar el hÃ¡bito del ejercicio durante 30 minutos diarios.\n3. Fomentar la buena alimentaciÃ³n, plÃ¡ticas o talleres â€œplato del buen comerâ€.\n4. Realizar campaÃ±a de sensibilizaciÃ³n de hipertensiÃ³n arterial.\n5. Realizar campaÃ±a de sensibilizaciÃ³n de diabetes mellitus.\n6. Realizar campaÃ±a prevenciÃ³n de obesidad.\n7. Terminar esquemas de vacunaciÃ³n incompletos.\n8. Fomentar la desparasitaciÃ³n de manera semestral.\n9. CampaÃ±as anuales visuales.\n10. CampaÃ±a de prevenciÃ³n de enfermedades respiratorias, actividades preventivas.`;
  }

  // â”€â”€ Helper: capture a chart element as base64 PNG â”€â”€
  private async captureChartImage(slideIndex: number): Promise<string> {
    const allSlides = document.querySelectorAll('.reporte-slide-print');
    const chartEl = allSlides[slideIndex]?.querySelector('.rslide-chart-wrap') as HTMLElement;
    if (!chartEl) return '';
    try {
      const cc = await html2canvas(chartEl, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
      return cc.toDataURL('image/png');
    } catch { return ''; }
  }

  // â”€â”€ Helper: load image as base64 from URL â”€â”€
  private loadImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = url;
    });
  }

  // â”€â”€ Helper: wrap text into lines that fit a given width (jsPDF) â”€â”€
  private wrapText(pdf: jsPDF, text: string, maxWidth: number, fontSize: number): string[] {
    pdf.setFontSize(fontSize);
    const paragraphs = text.split('\n');
    const allLines: string[] = [];
    for (const para of paragraphs) {
      if (para.trim() === '') { allLines.push(''); continue; }
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (pdf.getTextWidth(test) > maxWidth) {
          if (line) allLines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) allLines.push(line);
    }
    return allLines;
  }

  // â”€â”€ PDF slide header (Biznaga left, empresa right) â”€â”€
  private addPdfHeader(pdf: jsPDF, pdfW: number, bizLogo: string, empLogo: string, empresaNombre: string): void {
    const bizLogoH = 17; // 1.7 cm
    const bizLogoW = 59.7; // 5.97 cm
    const empLogoH = 17; // 1.7 cm
    const empLogoW = 35; // 3.5 cm max
    // Top green bar
    pdf.setFillColor(56, 81, 47);
    pdf.rect(0, 0, pdfW, 3, 'F');

    // Biznaga logo
    const logoY = 4;
    if (bizLogo) {
      try { pdf.addImage(bizLogo, 'PNG', 8, logoY, bizLogoW, bizLogoH); } catch { }
    }

    // Empresa logo + name on right
    if (empLogo) {
      try { pdf.addImage(empLogo, 'PNG', pdfW - empLogoW - 8, logoY, empLogoW, empLogoH); } catch { }
    }
    if (empresaNombre) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(100, 100, 100);
      pdf.text(empresaNombre, pdfW - (empLogo ? empLogoW + 10 : 10), logoY + 6, { align: 'right' });
    }
  }

  // â”€â”€ PDF slide footer â”€â”€
  private addPdfFooter(pdf: jsPDF, pdfW: number, pdfH: number): void {
    pdf.setFillColor(26, 46, 26);
    pdf.rect(0, pdfH - 1.5, pdfW, 0.3, 'F');
    pdf.setFillColor(56, 81, 47);
    pdf.rect(0, pdfH - 4, pdfW, 4, 'F');
  }

  // â”€â”€ PDF section title with red accent â”€â”€
  private addPdfSectionTitle(pdf: jsPDF, title: string, y: number): number {
    // Red accent line
    pdf.setFillColor(204, 51, 51);
    pdf.rect(8, y, 12, 1.5, 'F');
    y += 5;
    // Title
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(26, 26, 46);
    pdf.text(title, 8, y);
    y += 2;
    // Divider line under title area (for text column)
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.line(8, y + 2, 80, y + 2);
    return y + 6;
  }

  async exportarPDF(): Promise<void> {
    this.exportandoPDF = true;
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();   // 297mm
      const pdfH = pdf.internal.pageSize.getHeight();   // 210mm
      const empresaNombre = this.getEmpresaEstadisticasNombre();

      // Load logos
      let bizLogo = '';
      let empLogo = '';
      try { bizLogo = await this.loadImageAsBase64('assets/img/logo_biznaga.png'); } catch { }
      const empUrl = this.getLogoEmpresaReporteUrl();
      if (empUrl) { try { empLogo = await this.loadImageAsBase64(empUrl); } catch { } }

      // Capture chart images
      const chartImages: string[] = [];
      for (let i = 1; i <= 9; i++) {
        chartImages.push(await this.captureChartImage(i));
      }

      // â•â•â•â•â•â•â• PAGE 1: PORTADA â•â•â•â•â•â•â•
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pdfW, pdfH, 'F');

      const portadaLogoH = 17; // 1.7 cm (biznaga)
      const portadaLogoW = 59.7; // 5.97 cm
      const portadaEmpLogoH = 17; // 1.7 cm
      const portadaEmpLogoW = 35; // 3.5 cm
      // Biznaga logo (izquierda) + empresa logo (derecha)
      if (bizLogo) { try { pdf.addImage(bizLogo, 'PNG', 10, 8, portadaLogoW, portadaLogoH); } catch { } }
      if (empLogo) { try { pdf.addImage(empLogo, 'PNG', pdfW - portadaEmpLogoW - 10, 8, portadaEmpLogoW, portadaEmpLogoH); } catch { } }

      // Title
      const titulos = this.reporteTituloPersonalizado.split('\n');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(24);
      pdf.setTextColor(56, 81, 47);
      pdf.text(titulos[0] || '', pdfW / 2, 45, { align: 'center', maxWidth: 228.6 });
      pdf.setFontSize(24);
      pdf.setTextColor(56, 81, 47);
      pdf.text(titulos[1] || '', pdfW / 2, 58, { align: 'center', maxWidth: 228.6 });

      // Intro text
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(51, 51, 51);
      const introLines = this.wrapText(pdf, this.reporteTextos['portada_intro'] || '', pdfW - 60, 10);
      let iy = 100;
      for (const ln of introLines) { pdf.text(ln, 30, iy); iy += 5.5; }

      // Bullets
      iy += 4;
      const bulletKeys = ['portada_bullet1', 'portada_bullet2', 'portada_bullet3', 'portada_bullet4'];
      for (const bk of bulletKeys) {
        const bt = this.reporteTextos[bk];
        if (!bt) continue;
        const bLines = this.wrapText(pdf, bt, pdfW - 70, 9.5);
        pdf.setFontSize(9.5);
        pdf.text('\u25C6', 33, iy);
        for (let li = 0; li < bLines.length; li++) {
          pdf.text(bLines[li], 40, iy + li * 5);
        }
        iy += bLines.length * 5 + 3;
      }

      // â•â•â•â•â•â•â• CONTENT PAGES (7 sections) â•â•â•â•â•â•â•
      const sections = [
        { titulo: 'GRUPOS DE EDAD', key: 'edad_texto', chartIdx: 0 },
        { titulo: 'SEXO', key: 'genero_texto', chartIdx: 1 },
        { titulo: 'ESTADO NUTRICIONAL', key: 'imc_texto', chartIdx: 2 },
        { titulo: 'CIFRAS TENSIONALES', key: 'ta_texto', chartIdx: 3 },
        { titulo: 'ADICCIONES', key: 'adicciones_texto', chartIdx: 4 },
        { titulo: 'ESTUDIOS PARACLÃNICOS', key: 'paraclinicos_texto', chartIdx: 5 },
        { titulo: 'OTRAS PATOLOGÃAS', key: 'patologias_texto', chartIdx: 6 },
        { titulo: 'ANTECEDENTES HEREDO-FAMILIARES', key: 'heredo_familiares_texto', chartIdx: 7 },
        { titulo: 'Ã“RGANOS Y SISTEMAS', key: 'organos_sistemas_texto', chartIdx: 8 },
      ];

      for (const sec of sections) {
        pdf.addPage();
        // White background
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pdfW, pdfH, 'F');

        // Header & footer
        this.addPdfHeader(pdf, pdfW, bizLogo, empLogo, empresaNombre);
        this.addPdfFooter(pdf, pdfW, pdfH);

        // Section title with red accent
        const contentY = this.addPdfSectionTitle(pdf, sec.titulo, 27);

        // Text column (left side, ~40% width)
        const textX = 10;
        const textMaxW = 115;
        const texto = this.reporteTextos[sec.key] || '';
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
        pdf.setTextColor(51, 51, 51);
        const textLines = this.wrapText(pdf, texto, textMaxW, 9.5);
        let ty = contentY;
        for (const ln of textLines) {
          if (ln === '') { ty += 3; continue; }
          pdf.text(ln, textX, ty);
          ty += 5;
        }

        // Chart image (right side)
        const chartImg = chartImages[sec.chartIdx];
        if (chartImg) {
          const chartX = 135;
          const chartW = pdfW - chartX - 8;
          const chartH = pdfH - contentY - 12;
          try { pdf.addImage(chartImg, 'PNG', chartX, contentY - 6, chartW, chartH); } catch { }
        }
      }

      // â•â•â•â•â•â•â• LAST PAGE: RECOMENDACIONES â•â•â•â•â•â•â•
      pdf.addPage();
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pdfW, pdfH, 'F');
      this.addPdfHeader(pdf, pdfW, bizLogo, empLogo, empresaNombre);
      this.addPdfFooter(pdf, pdfW, pdfH);

      let ry = this.addPdfSectionTitle(pdf, 'RECOMENDACIONES PARA PLAN DE SALUD', 27);
      const recLineas = (this.reporteTextos['recomendaciones'] || '').split('\n').filter(Boolean);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(26, 26, 46);
      for (const linea of recLineas) {
        const rLines = this.wrapText(pdf, linea, pdfW - 30, 10);
        for (const rl of rLines) { pdf.text(rl, 12, ry); ry += 5.5; }
        ry += 1;
      }

      const nombre = empresaNombre.replace(/[^a-zA-Z0-9Ã¡-Ãº]/gi, '_');
      pdf.save(`Reporte_Plan_Salud_${nombre}_${this.anioReporte}.pdf`);
    } catch (err) {
      console.error('Error exportando PDF:', err);
      Swal.fire('Error', 'No se pudo exportar el PDF', 'error');
    }
    this.exportandoPDF = false;
  }

  async exportarGoogleSlides(): Promise<void> {
    if (this.exportandoPPT) {
      return;
    }

    this.exportandoPPT = true;
    this.iniciarProgresoSlides();

    try {
      const empresaNombre = this.getEmpresaEstadisticasNombre();
      this.actualizarProgresoSlides(12, 'Cargando logos...');

      // Cargar logos como base64
      let bizLogo = '';
      let empLogo = '';
      try { bizLogo = await this.loadImageAsBase64('assets/img/logo_biznaga.png'); } catch { }
      const empUrl = this.getLogoEmpresaReporteUrl();
      if (empUrl) { try { empLogo = await this.loadImageAsBase64(empUrl); } catch { } }

      // Obtener Drive ID del logo de empresa como fallback
      const empObj = this.getEmpresaEstadisticasObj();
      const empLogoRaw = empObj?.logo || empObj?.logo_url || null;
      const nombreCliente = String(empObj?.nombre_cliente || empresaNombre || '').trim();

      // Capturar imÃ¡genes de grÃ¡ficas
      const chartImages: string[] = [];
      for (let i = 1; i <= 9; i++) {
        chartImages.push(await this.captureChartImage(i));
        this.actualizarProgresoSlides(15 + Math.round((i / 9) * 45), `Capturando grÃ¡ficas (${i}/9)...`);
      }

      const datos = {
        titulo: this.reporteTituloPersonalizado,
        empresaNombre,
        nombre_cliente: nombreCliente,
        empresaId: empObj?.empresa_id || this.empresaEstadisticas || this.empresaSeleccionada?.empresa_id || null,
        anio: this.anioReporte,
        textos: this.reporteTextos,
        chartImages,
        bizLogoBase64: bizLogo || null,
        empLogoBase64: empLogo || null,
        empLogoDriveRaw: empLogoRaw || null
      };

      this.actualizarProgresoSlides(72, 'Generando presentaciÃ³n en Google Slides...');

      this.backendServices.generarReporteSaludSlides(datos).subscribe({
        next: (res: any) => {
          if (res.success && res.url) {
            this.finalizarProgresoSlides('Reporte listo. Abriendo Google Slides...');
            window.setTimeout(() => {
              this.exportandoPPT = false;
              this.cerrarReporte();
              const reportUrl = String(res.url || '').trim();
              const nuevaVentana = window.open(reportUrl, '_blank', 'noopener,noreferrer');
              if (!nuevaVentana) {
                Swal.fire({
                  icon: 'success',
                  title: 'Reporte generado',
                  text: 'El reporte se generÃ³ correctamente. Permite ventanas emergentes para abrir Google Slides automÃ¡ticamente.',
                  confirmButtonText: 'OK',
                  confirmButtonColor: '#38512F'
                });
              }
            }, 500);
          } else {
            this.exportandoPPT = false;
            this.resetProgresoSlides();
            this.cerrarReporte();
            Swal.fire('Error', res.message || 'No se pudo generar el reporte', 'error');
          }
        },
        error: (err: any) => {
          this.exportandoPPT = false;
          this.resetProgresoSlides();
          this.cerrarReporte();
          console.error('Error generando reporte en Google Slides:', err);
          Swal.fire('Error', err?.error?.message || 'No se pudo generar el reporte en Google Slides', 'error');
        }
      });
    } catch (err) {
      console.error('Error preparando datos para Google Slides:', err);
      Swal.fire('Error', 'No se pudo preparar el reporte', 'error');
      this.exportandoPPT = false;
      this.resetProgresoSlides();
      this.cerrarReporte();
    }
  }

  private iniciarProgresoSlides(): void {
    this.progresoSlides = 5;
    this.textoProgresoSlides = 'Preparando reporte...';
    this.limpiarProgresoSlidesTimer();
    this.progresoSlidesTimer = window.setInterval(() => {
      if (this.progresoSlides < 92) {
        this.progresoSlides += this.progresoSlides < 70 ? 2 : 1;
      }
    }, 500);
  }

  private actualizarProgresoSlides(valor: number, texto?: string): void {
    this.progresoSlides = Math.max(this.progresoSlides, Math.min(valor, 100));
    if (texto) {
      this.textoProgresoSlides = texto;
    }
  }

  private finalizarProgresoSlides(texto: string): void {
    this.actualizarProgresoSlides(100, texto);
    this.limpiarProgresoSlidesTimer();
  }

  private resetProgresoSlides(): void {
    this.limpiarProgresoSlidesTimer();
    this.progresoSlides = 0;
    this.textoProgresoSlides = '';
  }

  private limpiarProgresoSlidesTimer(): void {
    if (this.progresoSlidesTimer !== null) {
      window.clearInterval(this.progresoSlidesTimer);
      this.progresoSlidesTimer = null;
    }
  }
  constructor(
    private authService: AuthService,
    private backendServices: BackendServices,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) { }

  ngOnInit(): void {
    this.mainContentEl = this.elRef.nativeElement.closest('.main-content');
    if (this.mainContentEl) {
      this.renderer.addClass(this.mainContentEl, 'doctor-theme');
    }
    this.cargarEmpresas();
    this.cargarEstadisticas();
  }

  ngOnDestroy(): void {
    if (this.mainContentEl && this.authService.getRol()?.toLowerCase() !== 'doctor') {
      this.renderer.removeClass(this.mainContentEl, 'doctor-theme');
    }
    document.body.classList.remove('reporte-abierto');
    this.limpiarProgresoSlidesTimer();
  }
}
