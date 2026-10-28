import { Component, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { environment } from 'src/environments/environment';
import { formatearFechaDdmmaaaa, obtenerFechaHoyLocal } from 'src/app/utils/fecha.util';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

type Vista = 'empresas' | 'menu' | 'formulario' | 'preview' | 'historial';
type ModoGrafico = 'combinado' | 'od' | 'oi';
type CampoUmbral = 'vaOd' | 'vaOi' | 'voOd' | 'voOi';

interface Umbral {
  frecuencia: number;
  vaOd: string;
  vaOi: string;
  voOd: string;
  voOi: string;
}

interface SerieAudiograma {
  campo: CampoUmbral;
  modos: ModoGrafico[];
  color: string;
  tipo: 'circulo' | 'x' | 'menor' | 'mayor';
  offset: number;
  etiqueta: string;
}

interface AudiometriaForm {
  tipoAudiometria: string;
  nombre: string;
  fechaElaboracion: string;
  ocupacion: string;
  edad: string;
  usoProtector: string;
  anosEnPuesto: string;
  horasExposicion: string;
  tipoRuido: string;
  perdidaUnilateral: string;
  perdidaBilateral: string;
  enfermedadSubita: string;
  enfermedadProgresiva: string;
  enfermedadFluctuante: string;
  perdidaAuditiva: string;
  perdidaParentesco: string;
  enfermedadOido: string;
  enfermedadCual: string;
  enfermedadParentesco: string;
  trastornosComunicacion: string;
  trastornosTipo: string;
  trastornosObservaciones: string;
  observacionesHeredo: string;
  infecciosos: string;
  traumatismo: string;
  audifonos: string;
  audifonosHoras: string;
  quimicos: string;
  quimicosHoras: string;
  ototoxicos: string;
  ruidoExtralaboral: string;
  disminucionAudicion: string;
  otalgia: string;
  tinnitus: string;
  mareos: string;
  vertigo: string;
  otorrea: string;
  oyeBien: string;
  oyeBienDesdeCuando: string;
  repetirFrases: string;
  aumentarVolumenTv: string;
  oyeMejorConRuido: string;
  molestanRuidosIntensos: string;
  otoscopiaOd: string;
  otoscopiaOi: string;
  diagnostico: string;
  recomendaciones: string;
  personalElaboro: string;
  cedulaProfesional: string;
}

@Component({
  selector: 'app-audiometria',
  templateUrl: './audiometria.component.html',
  styleUrls: ['./audiometria.component.scss']
})
export class AudiometriaComponent implements OnInit, OnDestroy {

  readonly frecuencias = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
  readonly frecuenciasOseas = new Set([250, 500, 750, 1000, 1500, 2000, 3000, 4000]);
  readonly tiposAudiometria = ['Inicial', 'Periódica', 'Confirmación', 'Egreso'];
  readonly usosProtector = ['Sí', 'No', 'Ocasional'];
  readonly tiposRuido = ['Continuo', 'Intermitente', 'De impacto', 'Mixto'];
  readonly opcionesSiNo = ['SI', 'NO'];
  readonly pasos = [
    { numero: 1, titulo: 'Datos generales' },
    { numero: 2, titulo: 'Heredo-familiares' },
    { numero: 3, titulo: 'Otológicos' },
    { numero: 4, titulo: 'Datos clínicos' },
    { numero: 5, titulo: 'Evaluación' },
    { numero: 6, titulo: 'Diagnóstico' }
  ];
  readonly series: SerieAudiograma[] = [
    { campo: 'vaOd', modos: ['combinado', 'od'], color: '#c62828', tipo: 'circulo', offset: 0, etiqueta: 'OD vía aérea' },
    { campo: 'vaOi', modos: ['combinado', 'oi'], color: '#1565c0', tipo: 'x', offset: 0, etiqueta: 'OI vía aérea' },
    { campo: 'voOd', modos: ['combinado', 'od'], color: '#c62828', tipo: 'menor', offset: -8, etiqueta: 'OD vía ósea' },
    { campo: 'voOi', modos: ['combinado', 'oi'], color: '#1565c0', tipo: 'mayor', offset: 8, etiqueta: 'OI vía ósea' }
  ];
  readonly nivelesDb = [-10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  readonly chartW = 680;
  readonly chartH = 390;
  readonly chartL = 46;
  readonly chartR = 18;
  readonly chartT = 28;
  readonly chartB = 36;

  vistaActual: Vista = 'empresas';
  pasoActual = 1;
  maxPasoAlcanzado = 1;
  guardando = false;
  generandoPdf = false;

  empresas: any[] = [];
  empresasFiltradas: any[] = [];
  empresaSeleccionada: any = null;
  cargandoEmpresas = false;
  textoBusquedaEmpresa = '';

  registros: any[] = [];
  registrosFiltrados: any[] = [];
  cargandoHistorial = false;
  filtroHistorial = '';

  formulario: AudiometriaForm = this.formularioVacio();
  umbrales: Umbral[] = this.umbralesVacios();
  editandoId: number | null = null;
  folio = '';
  excelUrl = '';
  origenPreview: 'formulario' | 'historial' = 'formulario';
  firmaUrlDoctor = '';

  private mainContentEl: HTMLElement | null = null;
  private esDoctorPrincipal = false;

  constructor(
    private authService: AuthService,
    private backendServices: BackendServices,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit(): void {
    this.mainContentEl = this.elRef.nativeElement.closest('.main-content');
    if (this.mainContentEl) {
      this.renderer.addClass(this.mainContentEl, 'doctor-theme');
    }
    this.cargarDatosDoctor();
    this.cargarEmpresas();
  }

  ngOnDestroy(): void {
    if (this.mainContentEl && !this.esDoctorPrincipal) {
      this.renderer.removeClass(this.mainContentEl, 'doctor-theme');
    }
  }

  get progresoPorcentaje(): number {
    return ((this.pasoActual - 1) / (this.pasos.length - 1)) * 100;
  }

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendServices.obtenerEmpresasAudiometria().subscribe({
      next: (resp: any) => {
        const conConteo = resp?.success && Array.isArray(resp.empresas) ? resp.empresas : [];
        this.backendServices.obtenerEmpresas().subscribe({
          next: (catalogoResp: any) => {
            const catalogo = catalogoResp?.success && Array.isArray(catalogoResp.empresas) ? catalogoResp.empresas : [];
            this.empresas = this.combinarEmpresas(conConteo, catalogo);
            this.empresasFiltradas = [...this.empresas];
            this.cargandoEmpresas = false;
          },
          error: () => {
            this.empresas = this.combinarEmpresas(conConteo, []);
            this.empresasFiltradas = [...this.empresas];
            this.cargandoEmpresas = false;
          }
        });
      },
      error: () => {
        this.backendServices.obtenerEmpresas().subscribe({
          next: (resp: any) => {
            this.empresas = (resp?.empresas || []).map((e: any) => ({ ...e, audiometrias_totales: 0 }));
            this.empresasFiltradas = [...this.empresas];
            this.cargandoEmpresas = false;
          },
          error: () => {
            this.cargandoEmpresas = false;
          }
        });
      }
    });
  }

  filtrarEmpresas(): void {
    const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
    this.empresasFiltradas = this.empresas.filter((empresa) =>
      !texto
      || String(empresa.nombre_empresa || '').toLowerCase().includes(texto)
      || String(empresa.rfc || '').toLowerCase().includes(texto)
    );
  }

  seleccionarEmpresa(empresa: any): void {
    this.empresaSeleccionada = empresa;
    this.vistaActual = 'menu';
    if (!empresa?.empresa_id) return;
    this.backendServices.asegurarCarpetaAudiometria(
      empresa.empresa_id,
      empresa.nombre_empresa
    ).subscribe({
      error: (err) => {
        Swal.fire({
          icon: 'warning',
          title: 'No se preparó la carpeta',
          text: err?.error?.message || 'La empresa se abrió, pero no se pudo crear su carpeta de audiometrías en Drive.',
          confirmButtonColor: '#0f3661'
        });
      }
    });
  }

  volverAEmpresas(): void {
    this.vistaActual = 'empresas';
    this.empresaSeleccionada = null;
    this.cargarEmpresas();
  }

  abrirFormulario(): void {
    this.reiniciarCaptura();
    this.vistaActual = 'formulario';
  }

  volverAlMenu(): void {
    this.vistaActual = 'menu';
  }

  irAPaso(numero: number): void {
    if (numero <= this.maxPasoAlcanzado) {
      this.pasoActual = numero;
    }
  }

  pasoSiguiente(): void {
    if (this.pasoActual === 1 && !String(this.formulario.nombre || '').trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre para continuar.', confirmButtonColor: '#0f3661' });
      return;
    }
    if (this.pasoActual < this.pasos.length) {
      this.pasoActual += 1;
      this.maxPasoAlcanzado = Math.max(this.maxPasoAlcanzado, this.pasoActual);
    }
  }

  pasoAnterior(): void {
    if (this.pasoActual > 1) {
      this.pasoActual -= 1;
    }
  }

  verReporte(): void {
    if (!String(this.formulario.nombre || '').trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre para generar el reporte.', confirmButtonColor: '#0f3661' });
      return;
    }
    this.origenPreview = 'formulario';
    this.vistaActual = 'preview';
  }

  volverAlFormulario(): void {
    this.vistaActual = 'formulario';
    this.origenPreview = 'formulario';
  }

  verHistorial(): void {
    this.vistaActual = 'historial';
    this.cargarHistorial();
  }

  cargarHistorial(): void {
    if (!this.empresaSeleccionada?.empresa_id) {
      return;
    }
    this.cargandoHistorial = true;
    this.backendServices.obtenerAudiometrias(this.empresaSeleccionada.empresa_id).subscribe({
      next: (resp: any) => {
        this.registros = resp?.success && Array.isArray(resp.audiometrias) ? resp.audiometrias : [];
        this.filtrarHistorial();
        this.cargandoHistorial = false;
      },
      error: () => {
        this.registros = [];
        this.registrosFiltrados = [];
        this.cargandoHistorial = false;
        Swal.fire('No se pudo cargar el historial', 'Si acabas de actualizar el sistema, reinicia el backend.', 'error');
      }
    });
  }

  filtrarHistorial(): void {
    const texto = this.filtroHistorial.toLowerCase().trim();
    this.registrosFiltrados = this.registros.filter((registro) =>
      !texto
      || String(registro.nombre || '').toLowerCase().includes(texto)
      || String(registro.folio || '').toLowerCase().includes(texto)
      || String(registro.ocupacion || '').toLowerCase().includes(texto)
    );
  }

  abrirRegistro(id: number): void {
    this.backendServices.obtenerAudiometria(id).subscribe({
      next: (resp: any) => {
        if (!resp?.success || !resp.audiometria) {
          Swal.fire('No encontrada', 'Esa audiometría ya no está disponible.', 'warning');
          return;
        }
        this.aplicarRegistro(resp.audiometria);
        this.origenPreview = 'historial';
        this.vistaActual = 'preview';
      },
      error: () => Swal.fire('Error', 'No se pudo abrir la audiometría.', 'error')
    });
  }

  editarRegistro(id: number | null = this.editandoId): void {
    if (!id) {
      this.vistaActual = 'formulario';
      return;
    }
    this.backendServices.obtenerAudiometria(id).subscribe({
      next: (resp: any) => {
        if (resp?.success && resp.audiometria) {
          this.aplicarRegistro(resp.audiometria);
          this.pasoActual = 1;
          this.maxPasoAlcanzado = this.pasos.length;
          this.origenPreview = 'formulario';
          this.vistaActual = 'formulario';
        }
      },
      error: () => Swal.fire('Error', 'No se pudo abrir la audiometría para editarla.', 'error')
    });
  }

  eliminarRegistro(id: number): void {
    Swal.fire({
      icon: 'warning',
      title: 'Eliminar audiometría',
      text: 'El registro dejará de mostrarse en el historial.',
      showCancelButton: true,
      confirmButtonColor: '#d32f2f',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendServices.eliminarAudiometria(id).subscribe({
        next: () => {
          if (this.editandoId === id) {
            this.reiniciarCaptura();
          }
          this.vistaActual = 'historial';
          this.cargarHistorial();
        },
        error: () => Swal.fire('Error', 'No se pudo eliminar la audiometría.', 'error')
      });
    });
  }

  guardar(): void {
    if (!String(this.formulario.nombre || '').trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', confirmButtonColor: '#0f3661' });
      return;
    }
    this.guardando = true;
    const payload = this.payload();
    const peticion = this.editandoId
      ? this.backendServices.actualizarAudiometria(this.editandoId, payload)
      : this.backendServices.guardarAudiometria(payload);

    peticion.subscribe({
      next: (resp: any) => {
        this.guardando = false;
        if (!resp?.success) {
          Swal.fire('No se guardó', resp?.message || 'Intenta de nuevo.', 'error');
          return;
        }
        this.editandoId = resp.id || this.editandoId;
        this.folio = resp.folio || this.folio;
        this.excelUrl = resp.drive_url || this.excelUrl;
        const folio = this.folio ? `Folio ${this.folio}` : 'El registro quedó guardado.';
        if (resp.drive_url) {
          Swal.fire({
            icon: 'success',
            title: 'Audiometría guardada',
            html: `${this.escaparHtml(folio)}<br><a href="${this.escaparHtml(resp.drive_url)}" target="_blank" rel="noopener">Abrir Excel en Drive</a>`,
            confirmButtonColor: '#0f3661'
          });
        } else if (resp.drive_error) {
          Swal.fire({
            icon: 'warning',
            title: 'Guardada sin Excel',
            text: `${folio} No se pudo copiar la plantilla: ${resp.drive_error}`,
            confirmButtonColor: '#0f3661'
          });
        } else {
          Swal.fire({
            icon: 'success',
            title: 'Audiometría guardada',
            text: folio,
            confirmButtonColor: '#0f3661'
          });
        }
      },
      error: (err) => {
        this.guardando = false;
        Swal.fire('No se pudo guardar', err?.error?.message || 'Reinicia el backend si el apartado es nuevo y vuelve a intentar.', 'error');
      }
    });
  }

  usarInterpretacion(): void {
    const texto = this.interpretacion();
    this.formulario.diagnostico = this.formulario.diagnostico
      ? `${this.formulario.diagnostico.trim()}\n${texto}`
      : texto;
  }

  etiquetaFrecuencia(frecuencia: number): string {
    return `${frecuencia} Hz`;
  }

  esOsea(frecuencia: number): boolean {
    return this.frecuenciasOseas.has(frecuencia);
  }

  fechaReporte(): string {
    return formatearFechaDdmmaaaa(this.formulario.fechaElaboracion) || this.formulario.fechaElaboracion || '';
  }

  private escaparHtml(valor: string): string {
    return String(valor || '').replace(/[&<>"']/g, (caracter) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[caracter] || caracter));
  }

  textoSiNo(valor: unknown): string {
    if (valor === true || valor === 'SI' || valor === 'Sí') return 'SI';
    if (valor === 'NO' || valor === 'No') return 'NO';
    return '';
  }

  mediaLado(lado: 'Od' | 'Oi'): number | null {
    return this.operarFrecuencias([1000, 1500, 2000, 4000], lado, (valores) => {
      const suma = valores.reduce((total, valor) => total + valor, 0);
      return suma / 11;
    });
  }

  sumaDb(lado: 'Od' | 'Oi'): number | null {
    const frecuencias = lado === 'Od'
      ? this.frecuencias
      : [1000, 1500, 2000, 3000, 4000];
    return this.operarFrecuencias(frecuencias, lado, (valores) => valores.reduce((total, valor) => total + valor, 0));
  }

  porcentajeOido(lado: 'Od' | 'Oi'): number | null {
    const suma = this.sumaDb(lado);
    if (suma == null) return null;
    if (suma <= 100) return 0;
    const porcentaje = 0.375 * suma - 37.5;
    return Math.min(100, Math.max(0, Math.round(porcentaje)));
  }

  porcentajeBinaural(): number | null {
    const derecho = this.porcentajeOido('Od');
    const izquierdo = this.porcentajeOido('Oi');
    if (derecho == null || izquierdo == null) return null;
    if (izquierdo > derecho) return (5 * derecho + izquierdo) / 6;
    return (5 * izquierdo + derecho) / 6;
  }

  porcentajeDiscapacidad(): number | null {
    const binaural = this.porcentajeBinaural();
    if (binaural == null || binaural <= 0) return binaural == null ? null : 0;
    const tramos = [
      1.6, 3.2, 4.8, 6.4, 8, 9.6, 11.2, 12.8, 14.4, 16,
      17.6, 19.2, 20.8, 22.4, 23.9, 25.4, 26.9, 28.4, 29.9, 32.5,
      35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5, 54.9, 59.5,
      64, 68.5, 73, 77.5, 81.9, 85.6, 89.2, 92.8, 96.4, 100
    ];
    const indice = tramos.findIndex((hasta) => binaural <= hasta);
    return indice === -1 ? 40 : indice + 1;
  }

  tipoPerdidaDb(): number | null {
    const derecho = this.mediaLado('Od');
    const izquierdo = this.mediaLado('Oi');
    if (derecho == null || izquierdo == null) return null;
    return (derecho + izquierdo) / 2;
  }

  clasificarTipo(db: number | null): string {
    if (db == null) return '—';
    if (db > 120) return 'Cofósis';
    if (db > 111) return 'Profunda. 3er. grado';
    if (db > 101) return 'Profunda. 2º grado';
    if (db > 91) return 'Profunda. 1er. grado';
    if (db > 81) return 'Severa. 2º grado';
    if (db > 71) return 'Severa. 1er. grado';
    if (db > 55) return 'Moderada. 2º grado';
    if (db > 40) return 'Moderada. 1er. grado';
    if (db > 20) return 'Leve';
    return 'Pérdida';
  }

  textoNumero(valor: number | null, decimales: number): string {
    if (valor == null || !Number.isFinite(valor)) return '—';
    return valor.toFixed(decimales);
  }

  interpretacion(): string {
    const tipo = this.tipoPerdidaDb();
    return [
      `Oído derecho: media ${this.textoNumero(this.mediaLado('Od'), 2)}, suma ${this.textoNumero(this.sumaDb('Od'), 0)} dB, ${this.textoNumero(this.porcentajeOido('Od'), 0)} %.`,
      `Oído izquierdo: media ${this.textoNumero(this.mediaLado('Oi'), 2)}, suma ${this.textoNumero(this.sumaDb('Oi'), 0)} dB, ${this.textoNumero(this.porcentajeOido('Oi'), 0)} %.`,
      `Tipo de pérdida ${this.textoNumero(tipo, 2)} dB, ${this.clasificarTipo(tipo)}.`,
      `% pérdida SNDA binaural ${this.textoNumero(this.porcentajeBinaural(), 1)}. % discapacidad ${this.textoNumero(this.porcentajeDiscapacidad(), 0)}.`
    ].join('\n');
  }

  yDb(db: number): number {
    const alto = this.chartH - this.chartT - this.chartB;
    return this.chartT + ((db - (-10)) / 130) * alto;
  }

  xFrecuencia(indice: number): number {
    const ancho = this.chartW - this.chartL - this.chartR;
    if (this.frecuencias.length <= 1) return this.chartL;
    return this.chartL + (indice * ancho) / (this.frecuencias.length - 1);
  }

  serieVisible(serie: SerieAudiograma, modo: ModoGrafico): boolean {
    return serie.modos.includes(modo);
  }

  tramos(serie: SerieAudiograma): string[] {
    const grupos: string[][] = [];
    let actual: string[] = [];
    this.marcas(serie).forEach((punto, indice, lista) => {
      actual.push(`${punto.x},${punto.y}`);
      const siguiente = lista[indice + 1];
      if (!siguiente || siguiente.indice !== punto.indice + 1) {
        if (actual.length > 1) grupos.push(actual);
        actual = [];
      }
    });
    return grupos.map((grupo) => grupo.join(' '));
  }

  marcas(serie: SerieAudiograma): { x: number; y: number; indice: number }[] {
    const puntos: { x: number; y: number; indice: number }[] = [];
    this.umbrales.forEach((umbral, indice) => {
      if ((serie.campo === 'voOd' || serie.campo === 'voOi') && !this.esOsea(umbral.frecuencia)) {
        return;
      }
      const valor = this.valorNum(umbral[serie.campo]);
      if (valor == null) return;
      puntos.push({
        x: this.xFrecuencia(indice) + serie.offset,
        y: this.yDb(valor),
        indice
      });
    });
    return puntos;
  }

  chevron(punto: { x: number; y: number }, direccion: string): string {
    const signo = direccion === 'menor' ? -1 : 1;
    const punta = punto.x + signo * 6;
    const base = punto.x - signo * 4;
    return `${base},${punto.y - 6} ${punta},${punto.y} ${base},${punto.y + 6}`;
  }

  descargarExcel(): void {
    const wb = XLSX.utils.book_new();
    const filas: any[][] = [];
    const merges: XLSX.Range[] = [];
    let r = 0;
    const columnas = 16;
    const add = (celdas: { v: string; colspan: number }[]) => {
      const row = new Array(columnas).fill('');
      let col = 0;
      celdas.forEach((celda) => {
        row[col] = celda.v;
        if (celda.colspan > 1) {
          merges.push({ s: { r, c: col }, e: { r, c: col + celda.colspan - 1 } });
        }
        col += celda.colspan;
      });
      filas.push(row);
      r += 1;
    };
    const f = this.formulario;
    add([{ v: 'HISTORIA CLINICA', colspan: 16 }]);
    add([{ v: `EMPRESA: ${this.empresaSeleccionada?.nombre_empresa || ''}`, colspan: 10 }, { v: `FOLIO: ${this.folio || ''}`, colspan: 6 }]);
    add([{ v: `TIPO DE AUDIOMETRÍA: ${f.tipoAudiometria || ''}`, colspan: 16 }]);
    add([{ v: `NOMBRE: ${f.nombre || ''}`, colspan: 16 }]);
    add([
      { v: `FECHA ELABORACIÓN: ${this.fechaReporte()}`, colspan: 6 },
      { v: `ÁREA DE TRABAJO: ${f.ocupacion || ''}`, colspan: 6 },
      { v: `EDAD: ${f.edad || ''}`, colspan: 4 }
    ]);
    add([
      { v: `USO DE PROTECTOR AUDITIVO: ${f.usoProtector || ''}`, colspan: 8 },
      { v: `AÑOS EN PUESTO: ${f.anosEnPuesto || ''}`, colspan: 8 }
    ]);
    add([
      { v: `EXPOSICIÓN A RUIDO (HORAS AL DÍA): ${f.horasExposicion || ''}`, colspan: 8 },
      { v: `TIPO DE RUIDO: ${f.tipoRuido || ''}`, colspan: 8 }
    ]);
    const sn = (valor: unknown) => this.textoSiNo(valor);
    add([{ v: '1. ANTECEDENTES HEREDO-FAMILIARES', colspan: 16 }]);
    add([
      { v: 'FAMILIAR CON PERDIDA AUDITIVA', colspan: 4 },
      { v: `UNILATERAL: ${sn(f.perdidaUnilateral)}`, colspan: 6 },
      { v: `BILATERAL: ${sn(f.perdidaBilateral)}`, colspan: 6 }
    ]);
    add([
      { v: 'FAMILIAR CON ALGUNA ENFERMEDAD OÍDO', colspan: 4 },
      { v: `SÚBITA: ${sn(f.enfermedadSubita)}`, colspan: 4 },
      { v: `PROGRESIVA: ${sn(f.enfermedadProgresiva)}`, colspan: 4 },
      { v: `FLUCTUANTE: ${sn(f.enfermedadFluctuante)}`, colspan: 4 }
    ]);
    add([
      { v: `FAMILIAR CON PERDIDA AUDITIVA: ${sn(f.perdidaAuditiva)}`, colspan: 6 },
      { v: `PARENTESCO: ${f.perdidaParentesco || ''}`, colspan: 10 }
    ]);
    add([
      { v: `FAMILIAR CON ALGUNA ENFERMEDAD OÍDO: ${sn(f.enfermedadOido)}`, colspan: 6 },
      { v: `CUÁL: ${f.enfermedadCual || ''}`, colspan: 5 },
      { v: `PARENTESCO: ${f.enfermedadParentesco || ''}`, colspan: 5 }
    ]);
    add([
      { v: `TRASTORNOS DE COMUNICACIÓN: ${sn(f.trastornosComunicacion)}`, colspan: 6 },
      { v: `TIPO: ${f.trastornosTipo || ''}`, colspan: 5 },
      { v: `OBSERVACIONES: ${f.trastornosObservaciones || ''}`, colspan: 5 }
    ]);
    add([{ v: `OBSERVACIONES: ${f.observacionesHeredo || ''}`, colspan: 16 }]);
    add([{ v: '2. ANTECEDENTES OTOLÓGICOS', colspan: 16 }]);
    add([
      { v: `MENINGITIS, PARÁLISIS FACIAL, HERPES ZOSTER, PAROTIDITIS, RUBÉOLA, FIEBRE TIFOIDEA: ${sn(f.infecciosos)}`, colspan: 8 },
      { v: `TRAUMATISMO, DAÑO DE OÍDO: ${sn(f.traumatismo)}`, colspan: 8 }
    ]);
    add([
      { v: `USO DE AUDÍFONOS: ${sn(f.audifonos)}`, colspan: 8 },
      { v: `HORAS AL DÍA: ${f.audifonosHoras || ''}`, colspan: 8 }
    ]);
    add([
      { v: `EXPOSICIÓN A QUÍMICOS: ${sn(f.quimicos)}`, colspan: 8 },
      { v: `HORAS AL DÍA: ${f.quimicosHoras || ''}`, colspan: 8 }
    ]);
    add([
      { v: `USO DE OTOTÓXICOS (ESTREPTOMICINA, QUININAS, GENTAMICINA, SALICILATOS, KANAMICINA, TOBRAMICINA, FUROSEMIDA): ${f.ototoxicos || ''}`, colspan: 8 },
      { v: `RUIDO EXTRALABORAL (DISCOTECA, AUTOMOVILISMO, AVIACIÓN, MOTOCICLISMO, ETC.): ${f.ruidoExtralaboral || ''}`, colspan: 8 }
    ]);
    add([{ v: 'D', colspan: 16 }]);
    add([
      { v: `DISMINUCIÓN DE LA AUDICIÓN: ${sn(f.disminucionAudicion)}`, colspan: 8 },
      { v: `OTALGIA: ${sn(f.otalgia)}`, colspan: 8 }
    ]);
    add([
      { v: `TINNITUS: ${f.tinnitus || ''}`, colspan: 8 },
      { v: `MAREOS: ${sn(f.mareos)}`, colspan: 8 }
    ]);
    add([
      { v: `VÉRTIGO: ${sn(f.vertigo)}`, colspan: 8 },
      { v: `OTORREA: ${sn(f.otorrea)}`, colspan: 8 }
    ]);
    add([
      { v: `OYE BIEN: ${sn(f.oyeBien)}`, colspan: 6 },
      { v: `SI NO OYE BIEN, DESDE CUÁNDO: ${f.oyeBienDesdeCuando || ''}`, colspan: 10 }
    ]);
    add([
      { v: `DEBE PEDIR QUE REPITAN LAS FRASES: ${sn(f.repetirFrases)}`, colspan: 8 },
      { v: `DEBE AUMENTAR EL VOL. DE T.V.: ${sn(f.aumentarVolumenTv)}`, colspan: 8 }
    ]);
    add([
      { v: `OYE MEJOR CUANDO HAY RUIDO: ${sn(f.oyeMejorConRuido)}`, colspan: 8 },
      { v: `LE MOLESTAN LOS RUIDOS INTENSOS: ${sn(f.molestanRuidosIntensos)}`, colspan: 8 }
    ]);
    add([
      { v: 'OÍDO DERECHO', colspan: 8 },
      { v: 'OÍDO IZQUIERDO', colspan: 8 }
    ]);

    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!merges'] = merges;
    ws['!cols'] = new Array(columnas).fill({ wch: 14 });
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    const nombre = String(f.nombre || 'paciente').replace(/[^\w\-]+/g, '_');
    XLSX.writeFile(wb, `Audiometria_${nombre}_${this.formulario.fechaElaboracion || 'sin_fecha'}.xlsx`);
  }

  async descargarPDF(): Promise<void> {
    const element = document.getElementById('audiometria-print');
    if (!element) return;
    this.generandoPdf = true;
    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'letter');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      // Área que muchas impresoras no alcanzan a pintar. Más chico que el margen lateral.
      const margenVertical = 8;
      const altoDisponible = pageHeight - margenVertical * 2;
      const escala = Math.min(pageWidth / canvas.width, altoDisponible / canvas.height);
      const ancho = canvas.width * escala;
      const alto = canvas.height * escala;
      const x = (pageWidth - ancho) / 2;
      const y = margenVertical + (altoDisponible - alto) / 2;
      pdf.addImage(img, 'PNG', x, y, ancho, alto);
      const nombre = String(this.formulario.nombre || 'paciente').replace(/[^\w\-]+/g, '_');
      pdf.save(`Audiometria_${nombre}_${this.formulario.fechaElaboracion || 'sin_fecha'}.pdf`);
    } catch (error) {
      console.error(error);
      Swal.fire('Error', 'No se pudo generar el PDF.', 'error');
    } finally {
      this.generandoPdf = false;
    }
  }

  imprimir(): void {
    window.print();
  }

  getInicialesEmpresa(nombre: string): string {
    const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return '??';
    if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
    return (palabras[0][0] + palabras[1][0]).toUpperCase();
  }

  getLogoEmpresaUrl(empresa: any = this.empresaSeleccionada): string | null {
    if (!empresa) return null;
    return this.backendServices.resolverUrlDrivePreview(empresa.logo || empresa.logo_url || null);
  }

  onLogoEmpresaError(empresa: any = this.empresaSeleccionada): void {
    if (!empresa) return;
    empresa.logo = null;
    empresa.logo_url = null;
  }

  private reiniciarCaptura(): void {
    const elaboro = this.formulario.personalElaboro;
    const cedula = this.formulario.cedulaProfesional;
    this.formulario = this.formularioVacio();
    this.formulario.personalElaboro = elaboro;
    this.formulario.cedulaProfesional = cedula;
    this.umbrales = this.umbralesVacios();
    this.editandoId = null;
    this.folio = '';
    this.excelUrl = '';
    this.pasoActual = 1;
    this.maxPasoAlcanzado = 1;
    this.origenPreview = 'formulario';
  }

  private formularioVacio(): AudiometriaForm {
    return {
      tipoAudiometria: '',
      nombre: '',
      fechaElaboracion: obtenerFechaHoyLocal(),
      ocupacion: '',
      edad: '',
      usoProtector: '',
      anosEnPuesto: '',
      horasExposicion: '',
      tipoRuido: '',
      perdidaUnilateral: '',
      perdidaBilateral: '',
      enfermedadSubita: '',
      enfermedadProgresiva: '',
      enfermedadFluctuante: '',
      perdidaAuditiva: '',
      perdidaParentesco: '',
      enfermedadOido: '',
      enfermedadCual: '',
      enfermedadParentesco: '',
      trastornosComunicacion: '',
      trastornosTipo: '',
      trastornosObservaciones: '',
      observacionesHeredo: '',
      infecciosos: '',
      traumatismo: '',
      audifonos: '',
      audifonosHoras: '',
      quimicos: '',
      quimicosHoras: '',
      ototoxicos: '',
      ruidoExtralaboral: '',
      disminucionAudicion: '',
      otalgia: '',
      tinnitus: '',
      mareos: '',
      vertigo: '',
      otorrea: '',
      oyeBien: '',
      oyeBienDesdeCuando: '',
      repetirFrases: '',
      aumentarVolumenTv: '',
      oyeMejorConRuido: '',
      molestanRuidosIntensos: '',
      otoscopiaOd: '',
      otoscopiaOi: '',
      diagnostico: '',
      recomendaciones: '',
      personalElaboro: '',
      cedulaProfesional: ''
    };
  }

  private umbralesVacios(): Umbral[] {
    return this.frecuencias.map((frecuencia) => ({
      frecuencia,
      vaOd: '',
      vaOi: '',
      voOd: '',
      voOi: ''
    }));
  }

  private payload(): any {
    return {
      empresa_id: this.empresaSeleccionada?.empresa_id,
      nombre_empresa: this.empresaSeleccionada?.nombre_empresa,
      instructor_id: this.authService.getInstructorId(),
      tipo_audiometria: this.formulario.tipoAudiometria,
      nombre: this.formulario.nombre,
      fecha_elaboracion: this.formulario.fechaElaboracion,
      ocupacion: this.formulario.ocupacion,
      edad: this.formulario.edad,
      personal_elaboro: this.formulario.personalElaboro,
      cedula_profesional: this.formulario.cedulaProfesional,
      datos: {
        ...this.formulario,
        umbrales: this.umbrales
      }
    };
  }

  private aplicarRegistro(registro: any): void {
    const datos = registro.datos || {};
    const base = this.formularioVacio();
    this.formulario = {
      ...base,
      ...datos,
      tipoAudiometria: datos.tipoAudiometria || registro.tipo_audiometria || '',
      nombre: datos.nombre || registro.nombre || '',
      fechaElaboracion: datos.fechaElaboracion || registro.fecha_elaboracion || base.fechaElaboracion,
      ocupacion: datos.ocupacion || registro.ocupacion || '',
      edad: datos.edad || registro.edad || '',
      personalElaboro: datos.personalElaboro || registro.personal_elaboro || '',
      cedulaProfesional: datos.cedulaProfesional || registro.cedula_profesional || ''
    };
    this.umbrales = this.umbralesVacios();
    (datos.umbrales || []).forEach((guardado: any) => {
      const destino = this.umbrales.find((item) => item.frecuencia === Number(guardado.frecuencia));
      if (!destino) return;
      destino.vaOd = guardado.vaOd ?? '';
      destino.vaOi = guardado.vaOi ?? '';
      destino.voOd = guardado.voOd ?? '';
      destino.voOi = guardado.voOi ?? '';
    });
    this.editandoId = registro.id;
    this.folio = registro.folio || '';
    this.excelUrl = registro.drive_url || '';
    this.maxPasoAlcanzado = this.pasos.length;
  }

  private combinarEmpresas(conConteo: any[], catalogo: any[]): any[] {
    const porId = new Map<number, any>();
    catalogo.forEach((empresa) => {
      if (empresa?.empresa_id) porId.set(empresa.empresa_id, empresa);
    });
    const base = conConteo.length ? conConteo : catalogo.map((empresa) => ({ ...empresa, audiometrias_totales: 0 }));
    return base.map((empresa) => {
      const extra = porId.get(empresa.empresa_id) || {};
      return {
        ...extra,
        ...empresa,
        logo: empresa.logo || empresa.logo_url || extra.logo || extra.logo_url || null,
        logo_url: empresa.logo_url || empresa.logo || extra.logo_url || extra.logo || null,
        audiometrias_totales: empresa.audiometrias_totales || 0
      };
    });
  }

  private cargarDatosDoctor(): void {
    const rol = this.authService.getRol()?.toLowerCase() || '';
    this.esDoctorPrincipal = rol === 'doctor';
    this.formulario.personalElaboro = this.authService.getNombreCompleto().replace(/^Dr\.?\s*/i, '').trim();
    if (!this.authService.tieneRol('doctor')) {
      return;
    }
    this.backendServices.obtenerPerfilDoctor().subscribe({
      next: (resp: any) => {
        const instructor = resp?.instructor;
        if (!resp?.success || !instructor || this.editandoId) return;
        const nombre = [instructor.nombre, instructor.apellido_paterno || instructor.apellido, instructor.apellido_materno]
          .filter(Boolean)
          .join(' ')
          .replace(/^Dr\.?\s*/i, '')
          .trim();
        if (nombre) this.formulario.personalElaboro = nombre;
        this.formulario.cedulaProfesional = instructor.cedula_profesional || this.formulario.cedulaProfesional;
        this.firmaUrlDoctor = instructor.firma_url ? this.convertirFirmaAProxy(instructor.firma_url) : '';
      }
    });
  }

  private convertirFirmaAProxy(url: string): string {
    if (!url) return '';
    const proxy = url.match(/\/firma-doctor\/([^/?]+)/);
    if (proxy?.[1]) return `${environment.apiUrl}/firma-doctor/${proxy[1]}`;
    const drive = url.match(/[?&]id=([^&]+)/);
    if (drive?.[1]) return `${environment.apiUrl}/firma-doctor/${drive[1]}`;
    return url;
  }

  private operarFrecuencias(
    frecuencias: number[],
    lado: 'Od' | 'Oi',
    calcular: (valores: number[]) => number
  ): number | null {
    const valores = frecuencias.map((frecuencia) => this.valorDe(frecuencia, `va${lado}` as CampoUmbral));
    if (valores.every((valor) => valor == null)) return null;
    return calcular(valores.map((valor) => valor ?? 0));
  }

  private valorDe(frecuencia: number, campo: CampoUmbral): number | null {
    const umbral = this.umbrales.find((item) => item.frecuencia === frecuencia);
    return umbral ? this.valorNum(umbral[campo]) : null;
  }

  private valorNum(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const numero = Number(raw);
    if (!Number.isFinite(numero) || numero < -10 || numero > 120) return null;
    return numero;
  }

}
