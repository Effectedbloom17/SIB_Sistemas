import { Component, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { BackendServices } from 'src/app/services/backend.services';
import { obtenerFechaHoyLocal } from 'src/app/utils/fecha.util';
import Swal from 'sweetalert2';

type Vista = 'empresas' | 'lista' | 'formulario';

interface FilaEstudio {
  dia: string;
  nombre: string;
  areaPuesto: string;
  tipoEstudio: string;
  firma: string;
}

interface ProgramacionForm {
  fechaProgramacion: string;
  siglas: string;
  personaAcude: string;
  fechaRealizacion: string;
  observaciones: string;
  filas: FilaEstudio[];
}

@Component({
  selector: 'app-programacion-estudios',
  templateUrl: './programacion-estudios.component.html',
  styleUrls: ['./programacion-estudios.component.scss']
})
export class ProgramacionEstudiosComponent implements OnInit, OnDestroy {
  readonly tiposEstudio = ['Espirometría', 'Audiometría', 'Laboratorios', 'Placas'];
  vistaActual: Vista = 'empresas';
  empresas: any[] = [];
  empresasFiltradas: any[] = [];
  empresaSeleccionada: any = null;
  cargandoEmpresas = false;
  textoBusquedaEmpresa = '';

  programaciones: any[] = [];
  cargandoLista = false;
  guardando = false;
  subiendoPdf = false;
  editandoId: number | null = null;
  driveUrl = '';
  pdfUrl = '';
  pdfNombre = '';
  formulario: ProgramacionForm = this.formularioVacio();

  private mainContentEl: HTMLElement | null = null;

  constructor(
    private backendServices: BackendServices,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) {}

  ngOnInit(): void {
    this.mainContentEl = this.elRef.nativeElement.closest('.main-content');
    if (this.mainContentEl) {
      this.renderer.addClass(this.mainContentEl, 'doctor-theme');
    }
    this.cargarEmpresas();
  }

  ngOnDestroy(): void {
    if (this.mainContentEl) {
      this.renderer.removeClass(this.mainContentEl, 'doctor-theme');
    }
  }

  get nombreHoja(): string {
    const fecha = this.formulario.fechaProgramacion;
    const siglas = this.normalizarSiglas(this.formulario.siglas);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || siglas.length < 2) return '';
    const [anio, mes, dia] = fecha.split('-');
    return `${dia}-${mes}-${anio.slice(2)} ${siglas}`;
  }

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendServices.obtenerEmpresasProgramacionEstudios().subscribe({
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
        this.cargandoEmpresas = false;
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
    this.vistaActual = 'lista';
    this.cargarProgramaciones();
  }

  volverAEmpresas(): void {
    this.vistaActual = 'empresas';
    this.empresaSeleccionada = null;
    this.cargarEmpresas();
  }

  cargarProgramaciones(): void {
    const empresaId = this.empresaSeleccionada?.empresa_id;
    if (!empresaId) return;
    this.cargandoLista = true;
    this.backendServices.obtenerProgramacionesEstudios(empresaId).subscribe({
      next: (resp: any) => {
        this.programaciones = resp?.success && Array.isArray(resp.programaciones) ? resp.programaciones : [];
        this.cargandoLista = false;
      },
      error: () => {
        this.programaciones = [];
        this.cargandoLista = false;
      }
    });
  }

  nuevaProgramacion(): void {
    this.editandoId = null;
    this.driveUrl = '';
    this.pdfUrl = '';
    this.pdfNombre = '';
    this.formulario = this.formularioVacio(this.siglasDe(this.empresaSeleccionada?.nombre_empresa));
    this.vistaActual = 'formulario';
  }

  editarProgramacion(item: any): void {
    this.editandoId = item.id;
    this.driveUrl = item.drive_url || '';
    this.pdfUrl = item.pdf_url || '';
    this.pdfNombre = item.pdf_nombre || '';
    const filas = Array.isArray(item.filas) && item.filas.length
      ? item.filas.map((fila: FilaEstudio) => ({ ...this.filaVacia(), ...fila, firma: '', tipoEstudio: this.textoTipos(fila.tipoEstudio) }))
      : [this.filaVacia()];
    this.formulario = {
      fechaProgramacion: item.fecha_programacion || obtenerFechaHoyLocal(),
      siglas: item.siglas || this.siglasDe(this.empresaSeleccionada?.nombre_empresa),
      personaAcude: item.persona_acude || '',
      fechaRealizacion: item.fecha_realizacion || '',
      observaciones: item.observaciones || '',
      filas
    };
    this.vistaActual = 'formulario';
  }

  volverALista(): void {
    this.vistaActual = 'lista';
    this.cargarProgramaciones();
  }

  agregarFila(): void {
    if (this.formulario.filas.length >= 40) return;
    this.formulario.filas.push(this.filaVacia());
  }

  quitarFila(indice: number): void {
    if (this.formulario.filas.length === 1) {
      this.formulario.filas[0] = this.filaVacia();
      return;
    }
    this.formulario.filas.splice(indice, 1);
  }

  guardar(): void {
    if (!this.empresaSeleccionada?.empresa_id) return;
    if (!this.formulario.fechaProgramacion) {
      Swal.fire({ icon: 'warning', title: 'Falta la fecha', text: 'Indica la fecha en la que se hizo la programación.', confirmButtonColor: '#0f3661' });
      return;
    }
    if (this.normalizarSiglas(this.formulario.siglas).length < 2) {
      Swal.fire({ icon: 'warning', title: 'Faltan las siglas', text: 'Escribe las siglas de la empresa. Con la fecha forman el nombre de la hoja.', confirmButtonColor: '#0f3661' });
      return;
    }
    const payload = {
      empresa_id: this.empresaSeleccionada.empresa_id,
      nombre_empresa: this.empresaSeleccionada.nombre_empresa,
      fecha_programacion: this.formulario.fechaProgramacion,
      siglas: this.normalizarSiglas(this.formulario.siglas),
      persona_acude: this.formulario.personaAcude,
      fecha_realizacion: this.formulario.fechaRealizacion || null,
      observaciones: this.formulario.observaciones,
      filas: this.formulario.filas.map((fila) => ({ ...fila, firma: '' }))
    };
    this.guardando = true;
    const peticion = this.editandoId
      ? this.backendServices.actualizarProgramacionEstudios(this.editandoId, payload)
      : this.backendServices.guardarProgramacionEstudios(payload);
    peticion.subscribe({
      next: (resp: any) => {
        this.guardando = false;
        const programacion = resp?.programacion;
        if (programacion?.id) {
          this.editandoId = programacion.id;
          this.driveUrl = programacion.drive_url || '';
          this.pdfUrl = programacion.pdf_url || this.pdfUrl;
          this.pdfNombre = programacion.pdf_nombre || this.pdfNombre;
          this.formulario.siglas = programacion.siglas || this.formulario.siglas;
        }
        Swal.fire({
          icon: 'success',
          title: 'Programación guardada',
          text: programacion?.hoja_titulo
            ? `La hoja del archivero quedó como ${programacion.hoja_titulo}. La plantilla no se modificó.`
            : 'La programación quedó en el archivero.',
          confirmButtonColor: '#0f3661'
        });
      },
      error: (err) => {
        this.guardando = false;
        Swal.fire({
          icon: 'error',
          title: 'No se pudo guardar',
          text: err?.error?.message || 'Revisa la conexión con Drive e inténtalo de nuevo.',
          confirmButtonColor: '#0f3661'
        });
      }
    });
  }

  abrirExcel(): void {
    if (!this.driveUrl) return;
    window.open(this.driveUrl, '_blank', 'noopener');
  }

  abrirPdf(): void {
    if (!this.pdfUrl) return;
    window.open(this.pdfUrl, '_blank', 'noopener');
  }

  onPdfSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files && input.files[0];
    input.value = '';
    if (!archivo) return;
    const programacionId = this.editandoId;
    if (!programacionId) {
      Swal.fire({ icon: 'info', title: 'Guarda primero', text: 'La versión firmada se asocia a una programación ya guardada.', confirmButtonColor: '#0f3661' });
      return;
    }
    if (archivo.type && archivo.type !== 'application/pdf') {
      Swal.fire({ icon: 'warning', title: 'Archivo no válido', text: 'Sube un PDF firmado.', confirmButtonColor: '#0f3661' });
      return;
    }
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = String(lector.result || '');
      const base64 = resultado.includes(',') ? resultado.split(',')[1] : resultado;
      this.subiendoPdf = true;
      this.backendServices.subirPdfProgramacionEstudios(programacionId, base64).subscribe({
        next: (resp: any) => {
          this.subiendoPdf = false;
          this.pdfUrl = resp?.programacion?.pdf_url || '';
          this.pdfNombre = resp?.programacion?.pdf_nombre || archivo.name;
          Swal.fire({ icon: 'success', title: 'PDF firmado guardado', text: 'Quedó en la carpeta Documentos Firmados.', confirmButtonColor: '#0f3661' });
        },
        error: (err) => {
          this.subiendoPdf = false;
          Swal.fire({ icon: 'error', title: 'No se pudo subir el PDF', text: err?.error?.message || 'Inténtalo de nuevo.', confirmButtonColor: '#0f3661' });
        }
      });
    };
    lector.readAsDataURL(archivo);
  }

  quitarProgramacion(item: any): void {
    Swal.fire({
      icon: 'warning',
      title: 'Quitar del listado',
      text: 'La programación deja de verse aquí. La hoja del Excel se conserva.',
      showCancelButton: true,
      confirmButtonText: 'Quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0f3661'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendServices.eliminarProgramacionEstudios(item.id).subscribe({
        next: () => this.cargarProgramaciones(),
        error: (err) => {
          Swal.fire({ icon: 'error', title: 'No se pudo quitar', text: err?.error?.message || 'Inténtalo de nuevo.', confirmButtonColor: '#0f3661' });
        }
      });
    });
  }

  tieneTipo(fila: FilaEstudio, tipo: string): boolean {
    return this.listaTipos(fila?.tipoEstudio).includes(tipo);
  }

  cambiarTipo(fila: FilaEstudio, tipo: string, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    const elegidos = new Set(this.listaTipos(fila.tipoEstudio));
    if (marcado) elegidos.add(tipo);
    else elegidos.delete(tipo);
    fila.tipoEstudio = this.tiposEstudio.filter((item) => elegidos.has(item)).join(', ');
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

  private formularioVacio(siglas = ''): ProgramacionForm {
    return {
      fechaProgramacion: obtenerFechaHoyLocal(),
      siglas,
      personaAcude: '',
      fechaRealizacion: '',
      observaciones: '',
      filas: [this.filaVacia()]
    };
  }

  private filaVacia(): FilaEstudio {
    return { dia: '', nombre: '', areaPuesto: '', tipoEstudio: '', firma: '' };
  }

  private siglasDe(nombre: string): string {
    const limpio = String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .trim();
    const palabras = limpio.split(/\s+/).filter(Boolean);
    const stop = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'SA', 'CV', 'SRL', 'SC', 'S', 'RL', 'THE', 'AND']);
    const base = palabras.filter((p) => p.length > 1 && !stop.has(p));
    const usar = base.length ? base : palabras;
    const siglas = usar.map((p) => p[0]).join('');
    if (siglas.length >= 3) return siglas.slice(0, 3);
    return (usar[0] || '').slice(0, 3);
  }

  private textoTipos(valor: string): string {
    const elegidos = new Set(this.listaTipos(valor));
    return this.tiposEstudio.filter((tipo) => elegidos.has(tipo)).join(', ');
  }

  private listaTipos(valor: string): string[] {
    return String(valor || '').split(',').map((parte) => parte.trim()).filter(Boolean);
  }

  private normalizarSiglas(valor: string): string {
    return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  private combinarEmpresas(conConteo: any[], catalogo: any[]): any[] {
    const porId = new Map<number, any>();
    catalogo.forEach((empresa) => {
      if (empresa?.empresa_id) porId.set(empresa.empresa_id, empresa);
    });
    return conConteo.map((empresa) => {
      const extra = porId.get(empresa.empresa_id) || {};
      const logo = empresa.logo || empresa.logo_url || extra.logo || extra.logo_url || null;
      return { ...extra, ...empresa, logo, logo_url: logo };
    });
  }
}
