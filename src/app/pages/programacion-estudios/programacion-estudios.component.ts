import { Component, ElementRef, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { obtenerFechaHoyLocal } from 'src/app/utils/fecha.util';
import Swal from 'sweetalert2';

type Vista = 'inicio' | 'programar' | 'lista' | 'formulario';

interface TrabajadorFila {
  nombre: string;
  areaPuesto: string;
  tipoEstudio: string;
  firma: string;
}

interface DiaProgramacion {
  dia: string;
  trabajadores: TrabajadorFila[];
}

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
  dias: DiaProgramacion[];
}

@Component({
  selector: 'app-programacion-estudios',
  templateUrl: './programacion-estudios.component.html',
  styleUrls: ['./programacion-estudios.component.scss']
})
export class ProgramacionEstudiosComponent implements OnInit, OnDestroy {
  readonly tiposEstudio = [
    { key: 'Espirometría', icon: 'fa-wind', short: 'Espiro' },
    { key: 'Audiometría', icon: 'fa-deaf', short: 'Audio' },
    { key: 'Laboratorios', icon: 'fa-flask', short: 'Labs' },
    { key: 'Placas', icon: 'fa-file-medical', short: 'Placas' }
  ];

  vistaActual: Vista = 'inicio';
  empresas: any[] = [];
  empresasFiltradas: any[] = [];
  empresaSeleccionada: any = null;
  cargandoEmpresas = false;
  textoBusquedaEmpresa = '';
  mostrarDropdownEmpresa = false;
  modoArchivero = false;

  programaciones: any[] = [];
  cargandoLista = false;
  guardando = false;
  editandoId: number | null = null;
  driveUrl = '';
  pdfUrl = '';
  pdfNombre = '';
  formulario: ProgramacionForm = this.formularioVacio();

  editandoSiglas = false;
  siglasEdicion = '';
  guardandoSiglas = false;
  /** true si la empresa ya trae siglas persistidas en BD */
  siglasEnBd = false;

  progresoGuardado = 0;
  mensajeProgreso = '';
  private progresoTimer: ReturnType<typeof setInterval> | null = null;

  /** false = solo lectura hasta pulsar Habilitar edición */
  edicionHabilitada = true;
  versionActual = 1;
  versiones: any[] = [];
  cargandoVersiones = false;
  mostrarHistorialVersiones = false;

  private mainContentEl: HTMLElement | null = null;
  private logoErrorIds = new Set<number>();

  constructor(
    private backendServices: BackendServices,
    private authService: AuthService,
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
    this.detenerProgresoGuardado();
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

  get siglasEmpresaActual(): string {
    return this.normalizarSiglas(this.formulario.siglas || this.empresaSeleccionada?.siglas || '');
  }

  get empresasConProgramacion(): any[] {
    return this.empresas.filter((empresa) => Number(empresa?.programaciones_totales || 0) > 0);
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
            this.filtrarEmpresas();
            this.cargandoEmpresas = false;
          },
          error: () => {
            this.empresas = this.combinarEmpresas(conConteo, []);
            this.filtrarEmpresas();
            this.cargandoEmpresas = false;
          }
        });
      },
      error: () => {
        this.cargandoEmpresas = false;
      }
    });
  }

  iniciarProgramacion(): void {
    this.modoArchivero = false;
    this.empresaSeleccionada = null;
    this.textoBusquedaEmpresa = '';
    this.mostrarDropdownEmpresa = false;
    this.editandoSiglas = false;
    this.resetFormularioNuevo();
    this.vistaActual = 'programar';
    this.filtrarEmpresas();
  }

  iniciarArchivero(): void {
    this.modoArchivero = true;
    this.empresaSeleccionada = null;
    this.textoBusquedaEmpresa = '';
    this.mostrarDropdownEmpresa = false;
    this.programaciones = [];
    this.vistaActual = 'programar';
    this.filtrarEmpresas();
  }

  volverAInicio(): void {
    this.vistaActual = 'inicio';
    this.modoArchivero = false;
    this.empresaSeleccionada = null;
    this.textoBusquedaEmpresa = '';
    this.mostrarDropdownEmpresa = false;
    this.editandoId = null;
    this.editandoSiglas = false;
    this.cargarEmpresas();
  }

  filtrarEmpresas(): void {
    const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
    const base = !texto
      ? [...this.empresas]
      : this.empresas.filter((empresa) =>
          String(empresa.nombre_empresa || '').toLowerCase().includes(texto)
          || String(empresa.rfc || '').toLowerCase().includes(texto)
          || String(empresa.ciudad || '').toLowerCase().includes(texto)
          || String(empresa.siglas || '').toLowerCase().includes(texto)
        );
    this.empresasFiltradas = base.slice(0, 40);
  }

  mostrarEmpresas(): void {
    this.mostrarDropdownEmpresa = true;
    this.filtrarEmpresas();
  }

  ocultarDropdownEmpresa(): void {
    setTimeout(() => {
      this.mostrarDropdownEmpresa = false;
    }, 180);
  }

  seleccionarEmpresa(empresa: any): void {
    this.logoErrorIds.delete(Number(empresa.empresa_id));
    this.empresaSeleccionada = empresa;
    this.textoBusquedaEmpresa = empresa.nombre_empresa || '';
    this.mostrarDropdownEmpresa = false;
    this.editandoSiglas = false;
    this.siglasEnBd = this.normalizarSiglas(empresa?.siglas).length >= 2;

    if (this.modoArchivero) {
      this.vistaActual = 'lista';
      this.cargarProgramaciones();
      return;
    }

    const siglas = this.resolverSiglasEmpresa(empresa);
    this.resetFormularioNuevo(siglas);
    this.vistaActual = 'programar';
  }

  abrirArchiveroEmpresa(empresa: any): void {
    this.modoArchivero = true;
    this.empresaSeleccionada = empresa;
    this.textoBusquedaEmpresa = empresa?.nombre_empresa || '';
    this.editandoSiglas = false;
    this.siglasEnBd = this.normalizarSiglas(empresa?.siglas).length >= 2;
    this.vistaActual = 'lista';
    this.cargarProgramaciones();
  }

  limpiarEmpresa(): void {
    this.empresaSeleccionada = null;
    this.textoBusquedaEmpresa = '';
    this.mostrarDropdownEmpresa = false;
    this.programaciones = [];
    this.editandoSiglas = false;
    if (!this.modoArchivero) {
      this.resetFormularioNuevo();
    }
  }

  irAArchiveroEmpresa(): void {
    if (!this.empresaSeleccionada) return;
    this.modoArchivero = true;
    this.editandoSiglas = false;
    this.vistaActual = 'lista';
    this.cargarProgramaciones();
  }

  volverAEmpresas(): void {
    this.detenerProgresoGuardado();
    this.vistaActual = 'inicio';
    this.modoArchivero = false;
    this.empresaSeleccionada = null;
    this.textoBusquedaEmpresa = '';
    this.editandoSiglas = false;
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
    this.modoArchivero = false;
    this.editandoSiglas = false;
    this.edicionHabilitada = true;
    this.versionActual = 1;
    this.versiones = [];
    this.mostrarHistorialVersiones = false;
    this.resetFormularioNuevo(this.resolverSiglasEmpresa(this.empresaSeleccionada));
    this.vistaActual = 'programar';
  }

  editarProgramacion(item: any): void {
    this.modoArchivero = false;
    this.editandoId = item.id;
    this.driveUrl = item.drive_url || '';
    this.pdfUrl = item.pdf_url || '';
    this.pdfNombre = item.pdf_nombre || '';
    this.editandoSiglas = false;
    this.edicionHabilitada = false;
    this.versionActual = Number(item.version_actual || 1) || 1;
    this.mostrarHistorialVersiones = false;
    const filas = Array.isArray(item.filas) && item.filas.length
      ? item.filas.map((fila: FilaEstudio) => ({
          dia: fila.dia || '',
          nombre: fila.nombre || '',
          areaPuesto: fila.areaPuesto || '',
          tipoEstudio: this.textoTipos(fila.tipoEstudio),
          firma: ''
        }))
      : [];
    this.formulario = {
      fechaProgramacion: item.fecha_programacion || obtenerFechaHoyLocal(),
      siglas: item.siglas || this.resolverSiglasEmpresa(this.empresaSeleccionada),
      personaAcude: item.persona_acude || '',
      fechaRealizacion: item.fecha_realizacion || '',
      observaciones: item.observaciones || '',
      dias: this.agruparPorDia(filas)
    };
    this.vistaActual = 'formulario';
    this.cargarVersiones(item.id);
  }

  habilitarEdicion(): void {
    this.edicionHabilitada = true;
  }

  cancelarEdicion(): void {
    if (!this.editandoId) return;
    this.edicionHabilitada = false;
    this.editandoSiglas = false;
    const actual = this.programaciones.find((p) => p.id === this.editandoId);
    if (actual) this.editarProgramacion(actual);
  }

  cargarVersiones(programacionId: number): void {
    if (!programacionId) return;
    this.cargandoVersiones = true;
    this.backendServices.obtenerVersionesProgramacionEstudios(programacionId).subscribe({
      next: (resp: any) => {
        this.cargandoVersiones = false;
        this.versionActual = Number(resp?.version_actual || this.versionActual || 1) || 1;
        this.versiones = Array.isArray(resp?.versiones) ? resp.versiones : [];
      },
      error: () => {
        this.cargandoVersiones = false;
        this.versiones = [];
      }
    });
  }

  resumenDias(item: any): string {
    const dias = Array.isArray(item?.pacientes_por_dia) ? item.pacientes_por_dia : [];
    if (!dias.length) return 'Sin días registrados';
    return dias.map((d: any) => `${d.dia || 'Sin día'}: ${d.pacientes || 0}`).join(' · ');
  }

  abrirPdfItem(item: any): void {
    const url = item?.pdf_url;
    if (!url) {
      Swal.fire({
        icon: 'info',
        title: 'PDF pendiente',
        text: 'Esta programación aún no tiene versión firmada en PDF.',
        confirmButtonColor: '#0f3661'
      });
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  imprimirProgramacion(item: any): void {
    if (item?.pdf_url) {
      const win = window.open(item.pdf_url, '_blank', 'noopener');
      if (win) {
        setTimeout(() => {
          try { win.print(); } catch (_) { /* ignore */ }
        }, 800);
      }
      return;
    }
    if (item?.drive_url) {
      window.open(item.drive_url, '_blank', 'noopener');
      return;
    }
    const html = this.htmlImpresion(item);
    const win = window.open('', '_blank', 'noopener,width=900,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  private htmlImpresion(item: any): string {
    const dias = Array.isArray(item?.pacientes_por_dia) ? item.pacientes_por_dia : [];
    const filas = Array.isArray(item?.filas) ? item.filas : [];
    const filasHtml = filas.map((f: any) =>
      `<tr><td>${f.dia || ''}</td><td>${f.nombre || ''}</td><td>${f.areaPuesto || ''}</td><td>${f.tipoEstudio || ''}</td></tr>`
    ).join('');
    const diasHtml = dias.map((d: any) => `<li>${d.dia}: ${d.pacientes} paciente(s)</li>`).join('');
    return `<!doctype html><html><head><title>${item?.hoja_titulo || 'Programación'}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#123} table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ccd;padding:6px 8px;font-size:12px;text-align:left} h1{font-size:18px;margin:0 0 8px}
      .meta{color:#456;font-size:13px}</style></head><body>
      <h1>SP-F-30 · ${item?.hoja_titulo || ''}</h1>
      <p class="meta">Empresa: ${this.empresaSeleccionada?.nombre_empresa || ''} · Fecha: ${item?.fecha_programacion || ''} · Persona: ${item?.persona_acude || '—'}</p>
      <p class="meta">Días: ${item?.total_dias || 0} · Pacientes: ${item?.total_pacientes || 0}</p>
      <ul>${diasHtml}</ul>
      <table><thead><tr><th>Día</th><th>Nombre</th><th>Área</th><th>Estudio</th></tr></thead>
      <tbody>${filasHtml || '<tr><td colspan="4">Sin filas</td></tr>'}</tbody></table>
      </body></html>`;
  }

  volverALista(): void {
    this.modoArchivero = true;
    this.editandoSiglas = false;
    this.vistaActual = 'lista';
    this.cargarProgramaciones();
  }

  iniciarEdicionSiglas(): void {
    if (!this.edicionHabilitada) return;
    this.siglasEdicion = this.siglasEmpresaActual || this.siglasDe(this.empresaSeleccionada?.nombre_empresa);
    this.editandoSiglas = true;
  }

  cancelarEdicionSiglas(): void {
    this.editandoSiglas = false;
    this.siglasEdicion = '';
  }

  confirmarEdicionSiglas(): void {
    const siglas = this.normalizarSiglas(this.siglasEdicion);
    if (siglas.length < 2) return;
    this.formulario.siglas = siglas;
    this.persistirSiglasEmpresa(siglas, true);
  }

  asignarOtroDia(): void {
    if (!this.edicionHabilitada || this.contarTrabajadores() >= 40) return;
    this.formulario.dias.push(this.diaVacio());
  }

  quitarDia(indice: number): void {
    if (!this.edicionHabilitada) return;
    if (this.formulario.dias.length === 1) {
      this.formulario.dias[0] = this.diaVacio();
      return;
    }
    this.formulario.dias.splice(indice, 1);
  }

  agregarTrabajador(dia: DiaProgramacion): void {
    if (!this.edicionHabilitada || this.contarTrabajadores() >= 40) return;
    dia.trabajadores.push(this.trabajadorVacio());
  }

  quitarTrabajador(dia: DiaProgramacion, indice: number): void {
    if (!this.edicionHabilitada) return;
    if (dia.trabajadores.length === 1) {
      dia.trabajadores[0] = this.trabajadorVacio();
      return;
    }
    dia.trabajadores.splice(indice, 1);
  }

  tituloDia(dia: DiaProgramacion, indice: number): string {
    const texto = String(dia?.dia || '').trim();
    return texto || `Día ${indice + 1}`;
  }

  guardar(): void {
    if (!this.empresaSeleccionada?.empresa_id) return;
    if (!this.formulario.fechaProgramacion) {
      Swal.fire({ icon: 'warning', title: 'Falta la fecha', text: 'Indica la fecha en la que se hizo la programación.', confirmButtonColor: '#0f3661' });
      return;
    }
    const siglas = this.normalizarSiglas(this.formulario.siglas);
    if (siglas.length < 2) {
      Swal.fire({ icon: 'warning', title: 'Faltan las siglas', text: 'Edita las siglas de la empresa en la parte superior.', confirmButtonColor: '#0f3661' });
      return;
    }
    if (this.editandoId && !this.edicionHabilitada) {
      Swal.fire({
        icon: 'info',
        title: 'Edición bloqueada',
        text: 'Pulsa «Habilitar edición» para modificar y guardar una nueva versión.',
        confirmButtonColor: '#0f3661'
      });
      return;
    }
    const filas = this.aplanarDias();
    const usuario = this.authService.usuarioActualValue;
    const payload = {
      empresa_id: this.empresaSeleccionada.empresa_id,
      nombre_empresa: this.empresaSeleccionada.nombre_empresa,
      fecha_programacion: this.formulario.fechaProgramacion,
      siglas,
      persona_acude: this.formulario.personaAcude,
      fecha_realizacion: this.formulario.fechaRealizacion || null,
      observaciones: this.formulario.observaciones,
      filas,
      usuario_id: usuario?.usuario_id || usuario?.id || null,
      usuario_nombre: [usuario?.nombre, usuario?.apellido_paterno].filter(Boolean).join(' ') || usuario?.username || '',
      nota_version: 'Edición de programación'
    };
    this.guardando = true;
    this.iniciarProgresoGuardado();
    const peticion = this.editandoId
      ? this.backendServices.actualizarProgramacionEstudios(this.editandoId, payload)
      : this.backendServices.guardarProgramacionEstudios(payload);
    peticion.subscribe({
      next: (resp: any) => {
        this.completarProgresoGuardado();
        const programacion = resp?.programacion;
        if (programacion?.id) {
          this.editandoId = programacion.id;
          this.driveUrl = programacion.drive_url || '';
          this.pdfUrl = programacion.pdf_url || this.pdfUrl;
          this.pdfNombre = programacion.pdf_nombre || this.pdfNombre;
          this.formulario.siglas = programacion.siglas || this.formulario.siglas;
          this.versionActual = Number(programacion.version_actual || this.versionActual || 1) || 1;
        }
        if (this.empresaSeleccionada) {
          this.empresaSeleccionada.siglas = siglas;
        }
        this.siglasEnBd = true;
        this.edicionHabilitada = false;
        this.guardando = false;
        const warning = programacion?.drive_warning;
        Swal.fire({
          icon: warning ? 'warning' : 'success',
          title: warning ? 'Guardada con aviso' : 'Programación guardada',
          text: warning
            || (programacion?.hoja_titulo
              ? `Quedó en el archivero como ${programacion.hoja_titulo}.`
              : 'La programación quedó en el archivero.'),
          confirmButtonColor: '#0f3661'
        }).then(() => {
          this.detenerProgresoGuardado();
          this.irAArchiveroEmpresa();
        });
      },
      error: (err) => {
        this.detenerProgresoGuardado();
        this.guardando = false;
        Swal.fire({
          icon: 'error',
          title: 'No se pudo guardar',
          text: err?.error?.message || 'Revisa la conexión e inténtalo de nuevo.',
          confirmButtonColor: '#0f3661'
        });
      }
    });
  }

  tieneTipo(fila: TrabajadorFila, tipo: string): boolean {
    return this.listaTipos(fila?.tipoEstudio).includes(tipo);
  }

  toggleTipo(fila: TrabajadorFila, tipo: string): void {
    if (!this.edicionHabilitada) return;
    const elegidos = new Set(this.listaTipos(fila.tipoEstudio));
    if (elegidos.has(tipo)) elegidos.delete(tipo);
    else elegidos.add(tipo);
    fila.tipoEstudio = this.tiposEstudio.map((t) => t.key).filter((item) => elegidos.has(item)).join(', ');
  }

  getInicialesEmpresa(nombre: string): string {
    const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return '??';
    if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
    return (palabras[0][0] + palabras[1][0]).toUpperCase();
  }

  getLogoEmpresaUrl(empresa: any = this.empresaSeleccionada): string | null {
    if (!empresa) return null;
    const id = Number(empresa.empresa_id);
    if (id && this.logoErrorIds.has(id)) return null;
    return this.backendServices.resolverUrlDrivePreview(empresa.logo || empresa.logo_url || null);
  }

  onLogoEmpresaError(empresa: any = this.empresaSeleccionada): void {
    if (!empresa) return;
    const id = Number(empresa.empresa_id);
    if (id) this.logoErrorIds.add(id);
    empresa.logo = null;
    empresa.logo_url = null;
  }

  private persistirSiglasEmpresa(siglas: string, mostrarFeedback: boolean): void {
    const empresaId = this.empresaSeleccionada?.empresa_id;
    if (!empresaId) return;
    const normalizadas = this.normalizarSiglas(siglas);
    if (normalizadas.length < 2) return;
    this.guardandoSiglas = true;
    this.backendServices.guardarSiglasEmpresaProgramacion(empresaId, normalizadas).subscribe({
      next: (resp: any) => {
        this.guardandoSiglas = false;
        const guardadas = this.normalizarSiglas(resp?.empresa?.siglas || normalizadas);
        this.formulario.siglas = guardadas;
        if (this.empresaSeleccionada) this.empresaSeleccionada.siglas = guardadas;
        const idx = this.empresas.findIndex((e) => e.empresa_id === empresaId);
        if (idx >= 0) this.empresas[idx].siglas = guardadas;
        this.siglasEnBd = true;
        this.editandoSiglas = false;
        if (mostrarFeedback) {
          Swal.fire({
            icon: 'success',
            title: 'Siglas guardadas',
            text: `La empresa quedó registrada como ${guardadas}.`,
            timer: 1400,
            showConfirmButton: false
          });
        }
      },
      error: () => {
        // Silencioso: las siglas quedan en el formulario y se persisten al guardar la programación.
        this.guardandoSiglas = false;
        this.formulario.siglas = normalizadas;
        this.editandoSiglas = false;
      }
    });
  }

  private iniciarProgresoGuardado(): void {
    this.detenerProgresoGuardado();
    this.progresoGuardado = 8;
    this.mensajeProgreso = 'Preparando programación...';
    const etapas = [
      { hasta: 35, texto: 'Validando datos de la empresa...' },
      { hasta: 62, texto: 'Guardando en el archivero...' },
      { hasta: 88, texto: 'Sincronizando hoja SP-F-30...' }
    ];
    let etapa = 0;
    this.progresoTimer = setInterval(() => {
      if (etapa < etapas.length && this.progresoGuardado >= etapas[etapa].hasta - 2) {
        this.mensajeProgreso = etapas[etapa].texto;
        etapa += 1;
      }
      if (this.progresoGuardado < 90) {
        this.progresoGuardado = Math.min(90, this.progresoGuardado + 3);
      }
    }, 220);
  }

  private completarProgresoGuardado(): void {
    if (this.progresoTimer) {
      clearInterval(this.progresoTimer);
      this.progresoTimer = null;
    }
    this.progresoGuardado = 100;
    this.mensajeProgreso = 'Programación lista';
  }

  private detenerProgresoGuardado(): void {
    if (this.progresoTimer) {
      clearInterval(this.progresoTimer);
      this.progresoTimer = null;
    }
    this.progresoGuardado = 0;
    this.mensajeProgreso = '';
  }

  private resolverSiglasEmpresa(empresa: any): string {
    const guardadas = this.normalizarSiglas(empresa?.siglas);
    if (guardadas.length >= 2) return guardadas;
    return this.siglasDe(empresa?.nombre_empresa);
  }

  private resetFormularioNuevo(siglas = ''): void {
    this.editandoId = null;
    this.driveUrl = '';
    this.pdfUrl = '';
    this.pdfNombre = '';
    this.edicionHabilitada = true;
    this.versionActual = 1;
    this.versiones = [];
    this.formulario = this.formularioVacio(siglas);
  }

  private formularioVacio(siglas = ''): ProgramacionForm {
    return {
      fechaProgramacion: obtenerFechaHoyLocal(),
      siglas,
      personaAcude: '',
      fechaRealizacion: '',
      observaciones: '',
      dias: [this.diaVacio()]
    };
  }

  private diaVacio(): DiaProgramacion {
    return { dia: '', trabajadores: [this.trabajadorVacio()] };
  }

  private trabajadorVacio(): TrabajadorFila {
    return { nombre: '', areaPuesto: '', tipoEstudio: '', firma: '' };
  }

  private contarTrabajadores(): number {
    return this.formulario.dias.reduce((acc, dia) => acc + dia.trabajadores.length, 0);
  }

  private aplanarDias(): FilaEstudio[] {
    const filas: FilaEstudio[] = [];
    this.formulario.dias.forEach((dia) => {
      const etiqueta = String(dia.dia || '').trim();
      dia.trabajadores.forEach((trabajador) => {
        filas.push({
          dia: etiqueta,
          nombre: trabajador.nombre || '',
          areaPuesto: trabajador.areaPuesto || '',
          tipoEstudio: trabajador.tipoEstudio || '',
          firma: ''
        });
      });
    });
    return filas;
  }

  private agruparPorDia(filas: FilaEstudio[]): DiaProgramacion[] {
    if (!filas.length) return [this.diaVacio()];
    const orden: string[] = [];
    const mapa = new Map<string, TrabajadorFila[]>();
    filas.forEach((fila) => {
      const key = String(fila.dia || '').trim();
      if (!mapa.has(key)) {
        mapa.set(key, []);
        orden.push(key);
      }
      mapa.get(key)!.push({
        nombre: fila.nombre || '',
        areaPuesto: fila.areaPuesto || '',
        tipoEstudio: this.textoTipos(fila.tipoEstudio),
        firma: ''
      });
    });
    return orden.map((dia) => ({
      dia,
      trabajadores: mapa.get(dia)!.length ? mapa.get(dia)! : [this.trabajadorVacio()]
    }));
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
    return this.tiposEstudio.map((t) => t.key).filter((tipo) => elegidos.has(tipo)).join(', ');
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
      const siglas = empresa.siglas || extra.siglas || null;
      return { ...extra, ...empresa, logo, logo_url: logo, siglas };
    });
  }
}
