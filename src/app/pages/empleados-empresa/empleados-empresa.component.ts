import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';

type ModalMode = 'crear' | 'editar';

interface EmpleadoForm {
  nombre: string;
  curp: string;
  puesto: string;
}

interface EmpresaFiltro {
  empresa_id: number;
  nombre_empresa: string;
}

interface GeneracionDocsForm {
  curso_id: number | null;
  horas: string;
  instructor_id: number | null;
  fecha: string;
}

@Component({
  selector: 'app-empleados-empresa',
  templateUrl: './empleados-empresa.component.html',
  styleUrls: ['./empleados-empresa.component.scss']
})
export class EmpleadosEmpresaComponent implements OnInit, OnDestroy {
  cargando: boolean = false;
  cargandoEmpresas: boolean = false;
  guardando: boolean = false;
  guardandoPanel: boolean = false;
  textoBusqueda: string = '';
  textoBusquedaCurso: string = '';
  textoBusquedaInstructor: string = '';
  morphActivo: boolean = false;
  morphStyle: { [key: string]: string } = {};
  panelFlotanteStyle: { [key: string]: string } = {};
  panelLado: 'left' | 'right' = 'right';
  panelModoDesktop: boolean = false;
  esVistaEmpresa: boolean = false;
  esVistaAdministrador: boolean = false;

  empresasDisponibles: EmpresaFiltro[] = [];
  empresasFiltradasPicker: EmpresaFiltro[] = [];
  empresaSeleccionadaAdminId: number | null = null;
  textoBusquedaEmpresa: string = '';
  dropdownEmpresaAbierto: boolean = false;
  empresaActivaIndice: number = -1;

  empleados: any[] = [];
  empleadosFiltrados: any[] = [];
  empleadosInactivosFiltrados: any[] = [];
  empleadosVista: any[] = [];
  empleadoSeleccionadoId: number | null = null;

  editorLateral: { nombre: string; curp: string; puesto: string } = {
    nombre: '',
    curp: '',
    puesto: ''
  };

  private readonly MORPH_DURATION_MS = 360;
  private readonly PANEL_BREAKPOINT_DESKTOP = 1200;
  private readonly PANEL_ANCHO_BASE = 305;
  private morphTimeout: ReturnType<typeof setTimeout> | null = null;
  private panelPositionTimeout: ReturnType<typeof setTimeout> | null = null;

  empresaId: number | null = null;

  modalAbierto: boolean = false;
  modoModal: ModalMode = 'crear';
  empleadoEditandoId: number | null = null;

  formulario: EmpleadoForm = this.crearFormularioVacio();

  mostrarModalGeneracionDocs: boolean = false;
  generandoDocs: boolean = false;
  cargandoCursosGeneracion: boolean = false;
  cargandoInstructoresGeneracion: boolean = false;
  mostrarDropdownCursoGeneracion: boolean = false;
  mostrarDropdownInstructorGeneracion: boolean = false;
  cursosDisponiblesGeneracion: any[] = [];
  instructoresDisponiblesGeneracion: any[] = [];
  empleadoGeneracionDocs: any | null = null;
  generacionDocsForm: GeneracionDocsForm = this.crearFormularioGeneracionVacio();

  constructor(
    private backendService: BackendServices,
    private authService: AuthService
  ) {}

  get empresaObjetivoSeleccionada(): boolean {
    return Number(this.empresaId || 0) > 0;
  }

  get puedeGestionarEmpleados(): boolean {
    return this.esVistaEmpresa || (this.esVistaAdministrador && this.empresaObjetivoSeleccionada);
  }

  get puedeVerDetalleEmpleado(): boolean {
    return this.esVistaEmpresa || this.esVistaAdministrador;
  }

  get cursosFiltradosGeneracion(): any[] {
    const busqueda = this.normalizarBusquedaEmpresa(this.textoBusquedaCurso);
    if (!busqueda) return this.cursosDisponiblesGeneracion;

    return this.cursosDisponiblesGeneracion.filter((curso: any) => {
      const nombre = this.normalizarBusquedaEmpresa(curso?.nombre_curso || '');
      return nombre.includes(busqueda);
    });
  }

  get instructoresFiltradosGeneracion(): any[] {
    const busqueda = this.normalizarBusquedaEmpresa(this.textoBusquedaInstructor);
    if (!busqueda) return this.instructoresDisponiblesGeneracion;

    return this.instructoresDisponiblesGeneracion.filter((inst: any) => {
      const nombre = `${inst?.nombre || ''} ${inst?.apellido_paterno || ''} ${inst?.apellido_materno || ''}`.trim();
      const nombreNormalizado = this.normalizarBusquedaEmpresa(nombre);
      return nombreNormalizado.includes(busqueda);
    });
  }

  // trackBy: evita re-render completo de las listas de empleados al filtrar/buscar.
  trackByEmpleadoId(_index: number, empleado: any): any {
    return empleado?.empleado_id ?? _index;
  }

  ngOnInit(): void {
    this.actualizarModoPanel();
    this.esVistaEmpresa = this.authService.esUsuarioEmpresa();
    this.esVistaAdministrador = this.authService.esAdministrador();

    if (this.esVistaEmpresa) {
      this.empresaId = this.authService.getEmpresaId();

      if (!this.empresaId) {
        Swal.fire('Sin empresa asociada', 'No se encontro una empresa vinculada a este usuario.', 'warning');
        return;
      }

      this.cargarEmpleados();
      return;
    }

    if (this.esVistaAdministrador) {
      this.empresaId = null;
      this.cargarEmpresasParaAdministrador();
      return;
    }

    Swal.fire('Sin permisos', 'Este apartado solo esta disponible para empresa y administradores.', 'warning');
  }

  ngOnDestroy(): void {
    if (this.morphTimeout) {
      clearTimeout(this.morphTimeout);
      this.morphTimeout = null;
    }

    if (this.panelPositionTimeout) {
      clearTimeout(this.panelPositionTimeout);
      this.panelPositionTimeout = null;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.actualizarModoPanel();
    this.programarRecalculoPanel();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (this.dropdownEmpresaAbierto && !target.closest('.empresa-picker')) {
      this.cerrarBuscadorEmpresas();
    }

    const dropdownGeneracionAbierto = this.mostrarDropdownCursoGeneracion || this.mostrarDropdownInstructorGeneracion;
    if (dropdownGeneracionAbierto && !target.closest('.empleado-docs-combobox')) {
      this.cerrarDropdownsGeneracionDocs();
    }
  }

  private crearFormularioVacio(): EmpleadoForm {
    return {
      nombre: '',
      curp: '',
      puesto: ''
    };
  }

  private crearFormularioGeneracionVacio(): GeneracionDocsForm {
    const hoy = this.obtenerFechaHoyInput();
    return {
      curso_id: null,
      horas: '',
      instructor_id: null,
      fecha: hoy
    };
  }

  private obtenerFechaHoyInput(): string {
    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private limpiarEstadoEmpleados(): void {
    this.cerrarPanelEmpleado(true);
    this.empleados = [];
    this.empleadosFiltrados = [];
    this.empleadosInactivosFiltrados = [];
    this.empleadosVista = [];
  }

  private cargarEmpresasParaAdministrador(): void {
    this.cargandoEmpresas = true;

    this.backendService.obtenerEmpresas().subscribe(
      (response: any) => {
        const empresas = response?.success && Array.isArray(response?.empresas)
          ? response.empresas
          : [];

        this.empresasDisponibles = empresas
          .map((empresa: any) => ({
            empresa_id: Number(empresa?.empresa_id || 0),
            nombre_empresa: String(empresa?.nombre_empresa || '').trim()
          }))
          .filter((empresa: EmpresaFiltro) => Number.isInteger(empresa.empresa_id) && empresa.empresa_id > 0)
          .sort((a: EmpresaFiltro, b: EmpresaFiltro) => a.nombre_empresa.localeCompare(b.nombre_empresa));

        this.empresasFiltradasPicker = [...this.empresasDisponibles];
        if (this.empresaSeleccionadaAdminId) {
          this.textoBusquedaEmpresa = this.obtenerNombreEmpresaSeleccionada();
        }

        this.cargandoEmpresas = false;
      },
      (error) => {
        console.error('Error al cargar empresas para filtro administrativo:', error);
        this.cargandoEmpresas = false;
        this.empresasDisponibles = [];
        this.empresasFiltradasPicker = [];
        Swal.fire('Error', 'No se pudieron cargar las empresas para el filtro de empleados.', 'error');
      }
    );
  }

  abrirBuscadorEmpresas(): void {
    if (!this.esVistaAdministrador) return;
    this.dropdownEmpresaAbierto = true;
    this.filtrarEmpresasDisponibles();
  }

  onInputEmpresaFocus(): void {
    this.abrirBuscadorEmpresas();
  }

  onBusquedaEmpresaInput(): void {
    if (!this.esVistaAdministrador) return;

    const nombreSeleccionado = this.obtenerNombreEmpresaSeleccionada();
    const coincideConSeleccion = this.normalizarBusquedaEmpresa(this.textoBusquedaEmpresa)
      === this.normalizarBusquedaEmpresa(nombreSeleccionado);

    if (this.empresaSeleccionadaAdminId && !coincideConSeleccion) {
      this.empresaSeleccionadaAdminId = null;
      this.empresaId = null;
      this.limpiarEstadoEmpleados();
    }

    this.dropdownEmpresaAbierto = true;
    this.filtrarEmpresasDisponibles();
  }

  onBuscadorEmpresaKeydown(event: KeyboardEvent): void {
    const totalOpciones = this.empresasFiltradasPicker.length;

    if (event.key === 'Escape') {
      this.cerrarBuscadorEmpresas();
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !this.dropdownEmpresaAbierto) {
      this.abrirBuscadorEmpresas();
      event.preventDefault();
      return;
    }

    if (!this.dropdownEmpresaAbierto || totalOpciones === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.empresaActivaIndice = this.empresaActivaIndice >= totalOpciones - 1
        ? 0
        : this.empresaActivaIndice + 1;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.empresaActivaIndice = this.empresaActivaIndice <= 0
        ? totalOpciones - 1
        : this.empresaActivaIndice - 1;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const indice = this.empresaActivaIndice >= 0 ? this.empresaActivaIndice : 0;
      const empresa = this.empresasFiltradasPicker[indice];
      if (empresa) {
        this.seleccionarEmpresaDesdeBuscador(empresa);
      }
    }
  }

  seleccionarEmpresaDesdeBuscador(empresa: EmpresaFiltro): void {
    if (!empresa) return;

    this.empresaSeleccionadaAdminId = empresa.empresa_id;
    this.textoBusquedaEmpresa = empresa.nombre_empresa;
    this.cerrarBuscadorEmpresas();
    this.onEmpresaAdminChange();
  }

  limpiarEmpresaAdminSeleccionada(event?: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.textoBusquedaEmpresa = '';
    this.empresaSeleccionadaAdminId = null;
    this.onEmpresaAdminChange();
    this.abrirBuscadorEmpresas();
  }

  private cerrarBuscadorEmpresas(): void {
    this.dropdownEmpresaAbierto = false;
    this.empresaActivaIndice = -1;
  }

  private filtrarEmpresasDisponibles(): void {
    const busqueda = this.normalizarBusquedaEmpresa(this.textoBusquedaEmpresa);

    this.empresasFiltradasPicker = !busqueda
      ? [...this.empresasDisponibles]
      : this.empresasDisponibles.filter((empresa: EmpresaFiltro) => {
          const nombre = this.normalizarBusquedaEmpresa(empresa.nombre_empresa);
          const id = String(empresa.empresa_id || '');
          return nombre.includes(busqueda) || id.includes(busqueda);
        });

    if (!this.empresasFiltradasPicker.length) {
      this.empresaActivaIndice = -1;
      return;
    }

    const indiceSeleccionado = this.empresasFiltradasPicker.findIndex(
      (empresa: EmpresaFiltro) => empresa.empresa_id === this.empresaSeleccionadaAdminId
    );

    this.empresaActivaIndice = indiceSeleccionado >= 0 ? indiceSeleccionado : 0;
  }

  private normalizarBusquedaEmpresa(valor: string): string {
    return String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  onEmpresaAdminChange(): void {
    const empresaIdSeleccionada = Number(this.empresaSeleccionadaAdminId || 0);

    this.textoBusqueda = '';

    if (!Number.isInteger(empresaIdSeleccionada) || empresaIdSeleccionada <= 0) {
      this.empresaId = null;
      if (!this.textoBusquedaEmpresa.trim()) {
        this.empresasFiltradasPicker = [...this.empresasDisponibles];
      }
      this.limpiarEstadoEmpleados();
      return;
    }

    this.empresaId = empresaIdSeleccionada;
    this.textoBusquedaEmpresa = this.obtenerNombreEmpresaSeleccionada();
    this.cargarEmpleados();
  }

  obtenerNombreEmpresaSeleccionada(): string {
    if (!this.empresaSeleccionadaAdminId) return '';

    const empresa = this.empresasDisponibles.find(
      (item: EmpresaFiltro) => item.empresa_id === this.empresaSeleccionadaAdminId
    );

    return empresa?.nombre_empresa || `Empresa #${this.empresaSeleccionadaAdminId}`;
  }

  cargarEmpleados(): void {
    if (!this.empresaId) {
      this.limpiarEstadoEmpleados();
      return;
    }

    this.cargando = true;
    this.cerrarPanelEmpleado(true);

    this.backendService.obtenerEmpleadosPorEmpresa(this.empresaId).subscribe(
      (response: any) => {
        if (response.success) {
          this.empleados = response.empleados || [];
          this.filtrarEmpleados();
        } else {
          this.limpiarEstadoEmpleados();
          Swal.fire('Atencion', response.message || 'No se pudieron cargar los empleados.', 'warning');
        }
        this.cargando = false;
      },
      (error) => {
        console.error('Error al cargar empleados:', error);
        this.cargando = false;
        this.limpiarEstadoEmpleados();
        Swal.fire('Error', 'No se pudieron cargar los empleados de la empresa.', 'error');
      }
    );
  }

  filtrarEmpleados(): void {
    const texto = this.textoBusqueda.toLowerCase().trim();

    const baseFiltrada = !texto
      ? [...this.empleados]
      : this.empleados.filter((empleado: any) => {
          const nombre = this.obtenerNombreCompleto(empleado).toLowerCase();
          const curp = String(empleado.curp || '').toLowerCase();
          const puesto = String(empleado.puesto || '').toLowerCase();

          return (
            nombre.includes(texto)
            || curp.includes(texto)
            || puesto.includes(texto)
          );
        });

    this.empleadosFiltrados = baseFiltrada;
    this.empleadosInactivosFiltrados = baseFiltrada.filter((empleado: any) => !this.esEmpleadoActivo(empleado));

    this.validarSeleccionActual();
    this.actualizarEmpleadosVista();
  }

  seleccionarEmpleado(empleado: any): void {
    if (!this.puedeVerDetalleEmpleado) return;

    const empleadoId = Number(empleado?.empleado_id || 0);
    if (!empleadoId) return;
    if (!this.esEmpleadoActivo(empleado)) return;

    if (this.empleadoSeleccionadoId === empleadoId) {
      return;
    }

    const origenRect = this.obtenerRectTarjeta(empleadoId);

    this.empleadoSeleccionadoId = empleadoId;
    this.editorLateral = {
      nombre: String(empleado?.nombre || '').trim(),
      curp: String(empleado?.curp || '').toUpperCase().trim(),
      puesto: String(empleado?.puesto || '').trim()
    };

    this.actualizarEmpleadosVista();
    this.animarMorphHaciaPanel(origenRect);
  }

  esEmpleadoSeleccionado(empleado: any): boolean {
    return Number(empleado?.empleado_id || 0) === this.empleadoSeleccionadoId;
  }

  esEmpleadoDesenfocado(empleado: any): boolean {
    if (this.empleadoSeleccionadoId === null) return false;
    return Number(empleado?.empleado_id || 0) !== this.empleadoSeleccionadoId;
  }

  obtenerEmpleadoSeleccionado(): any | null {
    if (!this.empleadoSeleccionadoId) return null;
    return this.empleados.find((emp: any) => Number(emp.empleado_id) === this.empleadoSeleccionadoId) || null;
  }

  cerrarPanelEmpleado(force: boolean = false): void {
    if (!force && this.guardandoPanel) return;
    this.empleadoSeleccionadoId = null;
    this.editorLateral = { nombre: '', curp: '', puesto: '' };
    this.panelFlotanteStyle = {};
    this.actualizarEmpleadosVista();
  }

  guardarCambiosPanel(): void {
    if (!this.puedeGestionarEmpleados) return;

    const empleadoId = Number(this.empleadoSeleccionadoId || 0);
    if (!empleadoId || this.guardandoPanel) return;

    const nombre = String(this.editorLateral.nombre || '').trim();
    if (!nombre) {
      Swal.fire('Campo requerido', 'El nombre del empleado es obligatorio.', 'warning');
      return;
    }

    const payload: any = {
      nombre,
      curp: this.normalizarTexto(this.editorLateral.curp)?.toUpperCase() || null,
      puesto: this.normalizarTexto(this.editorLateral.puesto)
    };

    this.guardandoPanel = true;

    this.backendService.actualizarEmpleado(empleadoId, payload).subscribe(
      (response: any) => {
        this.guardandoPanel = false;

        if (response.success) {
          Swal.fire('Guardado', 'Empleado actualizado correctamente.', 'success');
          this.cerrarPanelEmpleado(true);
          this.cargarEmpleados();
        } else {
          Swal.fire('Atencion', response.message || 'No fue posible actualizar el empleado.', 'warning');
        }
      },
      (error) => {
        console.error('Error al actualizar empleado desde panel lateral:', error);
        this.guardandoPanel = false;
        Swal.fire('Error', 'No se pudo actualizar el empleado.', 'error');
      }
    );
  }

  abrirModalGeneracionDocs(empleado: any): void {
    if (!empleado) return;
    this.empleadoGeneracionDocs = empleado;
    this.generacionDocsForm = this.crearFormularioGeneracionVacio();
    this.textoBusquedaCurso = '';
    this.textoBusquedaInstructor = '';
    this.mostrarModalGeneracionDocs = true;
    this.cargarCatalogosGeneracionDocs();
  }

  cerrarModalGeneracionDocs(): void {
    if (this.generandoDocs) return;
    this.mostrarModalGeneracionDocs = false;
    this.empleadoGeneracionDocs = null;
    this.generacionDocsForm = this.crearFormularioGeneracionVacio();
    this.textoBusquedaCurso = '';
    this.textoBusquedaInstructor = '';
    this.cerrarDropdownsGeneracionDocs();
  }

  private cargarCatalogosGeneracionDocs(): void {
    if (this.cursosDisponiblesGeneracion.length === 0 && !this.cargandoCursosGeneracion) {
      this.cargandoCursosGeneracion = true;
      this.backendService.cursos().subscribe(
        (data: any) => {
          const cursos = Array.isArray(data) ? data : (data?.cursos || []);
          this.cursosDisponiblesGeneracion = cursos
            .filter((curso: any) => curso?.curso_id)
            .sort((a: any, b: any) => String(a?.nombre_curso || '').localeCompare(String(b?.nombre_curso || '')));
          this.cargandoCursosGeneracion = false;
        },
        (error) => {
          console.error('Error al cargar cursos para generacion:', error);
          this.cargandoCursosGeneracion = false;
          Swal.fire('Error', 'No se pudieron cargar los cursos.', 'error');
        }
      );
    }

    if (this.instructoresDisponiblesGeneracion.length === 0 && !this.cargandoInstructoresGeneracion) {
      this.cargandoInstructoresGeneracion = true;
      this.backendService.obtenerInstructores().subscribe(
        (data: any) => {
          const instructores = data?.success && Array.isArray(data?.instructores)
            ? data.instructores
            : [];
          this.instructoresDisponiblesGeneracion = instructores
            .filter((inst: any) => inst?.instructor_id)
            .sort((a: any, b: any) =>
              `${a?.nombre || ''} ${a?.apellido_paterno || ''}`.localeCompare(`${b?.nombre || ''} ${b?.apellido_paterno || ''}`)
            );
          this.cargandoInstructoresGeneracion = false;
        },
        (error) => {
          console.error('Error al cargar instructores para generacion:', error);
          this.cargandoInstructoresGeneracion = false;
          Swal.fire('Error', 'No se pudieron cargar los instructores.', 'error');
        }
      );
    }
  }

  onCursoGeneracionChange(): void {
    const curso = this.obtenerCursoSeleccionadoGeneracion();
    if (!curso) return;
    if (!this.generacionDocsForm.horas) {
      this.generacionDocsForm.horas = String(curso?.horas || '');
    }
  }

  mostrarCursosGeneracion(): void {
    if (this.cargandoCursosGeneracion || this.generandoDocs) return;
    this.mostrarDropdownCursoGeneracion = true;
    this.mostrarDropdownInstructorGeneracion = false;
  }

  mostrarInstructoresGeneracion(): void {
    if (this.cargandoInstructoresGeneracion || this.generandoDocs) return;
    this.mostrarDropdownInstructorGeneracion = true;
    this.mostrarDropdownCursoGeneracion = false;
  }

  onBusquedaCursoGeneracionInput(): void {
    const cursoSeleccionado = this.obtenerCursoSeleccionadoGeneracion();
    const textoActual = this.normalizarBusquedaEmpresa(this.textoBusquedaCurso);
    const textoSeleccionado = this.normalizarBusquedaEmpresa(cursoSeleccionado?.nombre_curso || '');

    if (cursoSeleccionado && textoActual !== textoSeleccionado) {
      this.generacionDocsForm.curso_id = null;
    }

    this.mostrarCursosGeneracion();
  }

  onBusquedaInstructorGeneracionInput(): void {
    const instructorSeleccionado = this.obtenerInstructorSeleccionadoGeneracion();
    const textoActual = this.normalizarBusquedaEmpresa(this.textoBusquedaInstructor);
    const textoSeleccionado = this.normalizarBusquedaEmpresa(this.obtenerNombreInstructorGeneracion(instructorSeleccionado));

    if (instructorSeleccionado && textoActual !== textoSeleccionado) {
      this.generacionDocsForm.instructor_id = null;
    }

    this.mostrarInstructoresGeneracion();
  }

  seleccionarCursoGeneracion(curso: any): void {
    if (!curso || this.generandoDocs) return;
    this.generacionDocsForm.curso_id = Number(curso?.curso_id || 0) || null;
    this.textoBusquedaCurso = String(curso?.nombre_curso || '').trim();
    this.mostrarDropdownCursoGeneracion = false;
    this.onCursoGeneracionChange();
  }

  seleccionarInstructorGeneracion(instructor: any): void {
    if (!instructor || this.generandoDocs) return;
    this.generacionDocsForm.instructor_id = Number(instructor?.instructor_id || 0) || null;
    this.textoBusquedaInstructor = this.obtenerNombreInstructorGeneracion(instructor);
    this.mostrarDropdownInstructorGeneracion = false;
  }

  limpiarCursoGeneracion(event?: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.generacionDocsForm.curso_id = null;
    this.textoBusquedaCurso = '';
    this.mostrarCursosGeneracion();
  }

  limpiarInstructorGeneracion(event?: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.generacionDocsForm.instructor_id = null;
    this.textoBusquedaInstructor = '';
    this.mostrarInstructoresGeneracion();
  }

  cerrarDropdownsGeneracionDocs(): void {
    this.mostrarDropdownCursoGeneracion = false;
    this.mostrarDropdownInstructorGeneracion = false;
  }

  obtenerNombreInstructorGeneracion(instructor: any): string {
    if (!instructor) return '';

    return [instructor?.nombre, instructor?.apellido_paterno, instructor?.apellido_materno]
      .map((valor) => String(valor || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  obtenerInicialesInstructorGeneracion(instructor: any): string {
    const partes = [instructor?.nombre, instructor?.apellido_paterno]
      .map((valor) => String(valor || '').trim())
      .filter(Boolean);

    return partes
      .map((parte) => parte.charAt(0))
      .join('')
      .toUpperCase() || 'IN';
  }

  private obtenerCursoSeleccionadoGeneracion(): any | null {
    const cursoId = Number(this.generacionDocsForm.curso_id || 0);
    if (!cursoId) return null;
    return this.cursosDisponiblesGeneracion.find((curso: any) => Number(curso?.curso_id) === cursoId) || null;
  }

  private obtenerInstructorSeleccionadoGeneracion(): any | null {
    const instructorId = Number(this.generacionDocsForm.instructor_id || 0);
    if (!instructorId) return null;
    return this.instructoresDisponiblesGeneracion.find((inst: any) => Number(inst?.instructor_id) === instructorId) || null;
  }

  async generarConstanciasDocs(): Promise<void> {
    if (this.generandoDocs) return;

    const empleado = this.empleadoGeneracionDocs;
    if (!empleado) return;

    const curso = this.obtenerCursoSeleccionadoGeneracion();
    if (!curso) {
      Swal.fire('Campo requerido', 'Selecciona el curso para generar documentos.', 'warning');
      return;
    }

    const instructor = this.obtenerInstructorSeleccionadoGeneracion();
    if (!instructor) {
      Swal.fire('Campo requerido', 'Selecciona un instructor para continuar.', 'warning');
      return;
    }

    if (!this.generacionDocsForm.fecha) {
      Swal.fire('Campo requerido', 'La fecha del curso es obligatoria.', 'warning');
      return;
    }

    const horasNum = Number(this.generacionDocsForm.horas || 0);
    if (!Number.isFinite(horasNum) || horasNum <= 0) {
      Swal.fire('Campo requerido', 'La cantidad de horas es obligatoria.', 'warning');
      return;
    }

    const nombreEmpleado = [
      empleado?.apellido_paterno,
      empleado?.apellido_materno,
      empleado?.nombre
    ].map((valor) => String(valor || '').trim()).filter(Boolean).join(' ')
      || this.obtenerNombreCompleto(empleado)
      || String(empleado?.nombre || '').trim();

    this.generandoDocs = true;

    try {
      const instructorId = Number(instructor?.instructor_id || 0);
      const payload: {
        empleado: {
          empleado_id?: number;
          empresa_id?: number;
          nombre: string;
          nombre_base?: string;
          apellido_paterno?: string;
          apellido_materno?: string;
          curp: string;
          puesto: string;
          departamento?: string;
        };
        curso: { curso_id?: number; nombre: string; horas: number };
        instructor: { nombre: string; apellido_paterno: string; apellido_materno: string; instructor_id?: number };
        tipoDocumento: 'constancia' | 'dc3' | 'ambos';
        fecha: string;
        empresa_id?: number;
      } = {
        empleado: {
          empleado_id: Number(empleado?.empleado_id || 0) || undefined,
          empresa_id: Number(this.empresaId || empleado?.empresa_id || 0) || undefined,
          nombre: nombreEmpleado,
          nombre_base: String(empleado?.nombre || '').trim(),
          apellido_paterno: String(empleado?.apellido_paterno || '').trim(),
          apellido_materno: String(empleado?.apellido_materno || '').trim(),
          curp: String(empleado?.curp || '').trim(),
          puesto: String(empleado?.puesto || '').trim(),
          departamento: String(empleado?.departamento || '').trim()
        },
        curso: {
          curso_id: Number(curso?.curso_id || curso?.id || 0) || undefined,
          nombre: curso.nombre_curso || curso.nombre || String(curso?.curso_id || ''),
          horas: horasNum
        },
        instructor: {
          nombre: instructor.nombre || '',
          apellido_paterno: instructor.apellido_paterno || '',
          apellido_materno: instructor.apellido_materno || '',
          ...(Number.isFinite(instructorId) && instructorId > 0 ? { instructor_id: instructorId } : {})
        },
        tipoDocumento: 'ambos',
        fecha: this.generacionDocsForm.fecha,
        empresa_id: Number(this.empresaId || empleado?.empresa_id || 0) || undefined
      };

      // Usar la misma lógica que timeline-curso: generar y descargar directamente
      const blob = await firstValueFrom(this.backendService.generarConstanciasDC3TemporalZip(payload));

      const nombreEmpleadoSeguro = nombreEmpleado
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 50);
      const fechaActual = new Date().toISOString().split('T')[0];
      const nombreZip = `Documentos_${nombreEmpleadoSeguro}_${fechaActual}.zip`;
      
      this.descargarBlobArchivo(blob, nombreZip);

      await Swal.fire({
        title: 'Documentos generados',
        html: `<p style="font-size:0.95rem; color:#374151; margin:0 0 8px;">
                 Constancia y DC-3 generados correctamente
               </p>
               <p style="font-size:0.82rem; color:#6b7280; margin:0;">
                 Los documentos se descargaron automáticamente sin guardar en la base de datos
               </p>`,
        icon: 'success',
        confirmButtonColor: '#38512F'
      });

      this.cerrarModalGeneracionDocs();
    } catch (error) {
      console.error('Error en generacion individual de documentos:', error);
      Swal.fire('Error', 'Ocurrio un problema al generar los documentos.', 'error');
    } finally {
      this.generandoDocs = false;
    }
  }

  private descargarBlobArchivo(blob: Blob, nombreArchivo: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  abrirModalCrear(): void {
    if (!this.puedeGestionarEmpleados) return;

    this.cerrarPanelEmpleado(true);
    this.modoModal = 'crear';
    this.empleadoEditandoId = null;
    this.formulario = this.crearFormularioVacio();
    this.modalAbierto = true;
  }

  abrirModalEditar(empleado: any): void {
    this.modoModal = 'editar';
    this.empleadoEditandoId = Number(empleado.empleado_id || 0);

    this.formulario = {
      nombre: String(empleado.nombre || ''),
      curp: String(empleado.curp || ''),
      puesto: String(empleado.puesto || '')
    };

    this.modalAbierto = true;
  }

  actualizarCurpFormulario(): void {
    this.formulario.curp = String(this.formulario.curp || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 18);
  }

  cerrarModal(): void {
    if (this.guardando) return;

    this.modalAbierto = false;
    this.modoModal = 'crear';
    this.empleadoEditandoId = null;
    this.formulario = this.crearFormularioVacio();
  }

  guardarEmpleado(): void {
    if (!this.puedeGestionarEmpleados) return;
    if (this.guardando || !this.empresaId) return;

    const nombre = String(this.formulario.nombre || '').trim();
    const curp = String(this.formulario.curp || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 18);

    if (!nombre) {
      Swal.fire('Campo requerido', 'El nombre del empleado es obligatorio.', 'warning');
      return;
    }

    if (!curp) {
      Swal.fire('Campo requerido', 'El CURP del empleado es obligatorio.', 'warning');
      return;
    }

    if (curp.length !== 18) {
      Swal.fire('Dato invalido', 'El CURP debe tener 18 caracteres.', 'warning');
      return;
    }

    if (this.modoModal === 'editar' && !this.empleadoEditandoId) {
      Swal.fire('Error', 'No se encontro el empleado a editar.', 'error');
      return;
    }

    const payload: any = {
      empresa_id: this.empresaId,
      nombre,
      curp,
      puesto: this.normalizarTexto(this.formulario.puesto)
    };

    this.guardando = true;

    const request$ = this.modoModal === 'crear'
      ? this.backendService.crearEmpleado(payload)
      : this.backendService.actualizarEmpleado(this.empleadoEditandoId as number, payload);

    request$.subscribe(
      (response: any) => {
        this.guardando = false;

        if (response.success) {
          this.modalAbierto = false;
          this.formulario = this.crearFormularioVacio();
          this.empleadoEditandoId = null;

          Swal.fire(
            'Guardado',
            this.modoModal === 'crear' ? 'Empleado registrado correctamente.' : 'Empleado actualizado correctamente.',
            'success'
          );

          this.cargarEmpleados();
        } else {
          Swal.fire('Atencion', response.message || 'No fue posible guardar el empleado.', 'warning');
        }
      },
      (error) => {
        console.error('Error al guardar empleado:', error);
        this.guardando = false;
        Swal.fire('Error', 'Ocurrio un problema al guardar la informacion.', 'error');
      }
    );
  }

  eliminarEmpleado(empleado: any): void {
    if (!this.puedeGestionarEmpleados) return;

    const empleadoId = Number(empleado.empleado_id || 0);
    if (!empleadoId) return;

    const nombre = this.obtenerNombreCompleto(empleado) || 'este empleado';

    Swal.fire({
      title: 'Desactivar empleado',
      text: `${nombre} sera marcado como inactivo para esta empresa.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Si, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.backendService.eliminarEmpleado(empleadoId).subscribe(
        (response: any) => {
          if (response.success) {
            Swal.fire('Desactivado', 'Empleado marcado como inactivo correctamente.', 'success');
            if (this.empleadoSeleccionadoId === empleadoId) {
              this.cerrarPanelEmpleado(true);
            }
            this.cargarEmpleados();
          } else {
            Swal.fire('Atencion', response.message || 'No se pudo desactivar el empleado.', 'warning');
          }
        },
        (error) => {
          console.error('Error al desactivar empleado:', error);
          Swal.fire('Error', 'No se pudo desactivar el empleado.', 'error');
        }
      );
    });
  }

  esEmpleadoActivo(empleado: any): boolean {
    const activoRaw = empleado?.activo;
    if (activoRaw === undefined || activoRaw === null) return true;
    if (typeof activoRaw === 'boolean') return activoRaw;
    return Number(activoRaw) === 1;
  }

  obtenerNombreCompleto(empleado: any): string {
    const partes = [empleado?.nombre, empleado?.apellido_paterno, empleado?.apellido_materno]
      .map((valor) => String(valor || '').trim())
      .filter(Boolean);

    return partes.join(' ').trim();
  }

  onEmpleadoCardSpace(event: KeyboardEvent, empleado: any): void {
    event.preventDefault();
    if (!this.puedeVerDetalleEmpleado) return;
    this.seleccionarEmpleado(empleado);
  }

  private normalizarTexto(valor: string): string | null {
    const limpio = String(valor || '').trim();
    return limpio ? limpio : null;
  }

  private validarSeleccionActual(): void {
    if (!this.empleadoSeleccionadoId) return;

    const existeSeleccionado = this.empleadosFiltrados.some(
      (emp: any) => Number(emp.empleado_id) === this.empleadoSeleccionadoId && this.esEmpleadoActivo(emp)
    );

    if (!existeSeleccionado) {
      this.cerrarPanelEmpleado(true);
    }
  }

  private actualizarEmpleadosVista(): void {
    this.empleadosVista = this.empleadosFiltrados.filter((empleado: any) => this.esEmpleadoActivo(empleado));
    this.programarRecalculoPanel();
  }

  private actualizarModoPanel(): void {
    if (typeof window === 'undefined') {
      this.panelModoDesktop = false;
      return;
    }

    this.panelModoDesktop = window.innerWidth >= this.PANEL_BREAKPOINT_DESKTOP;
    if (!this.panelModoDesktop) {
      this.panelFlotanteStyle = {};
    }
  }

  private programarRecalculoPanel(): void {
    if (this.panelPositionTimeout) {
      clearTimeout(this.panelPositionTimeout);
      this.panelPositionTimeout = null;
    }

    if (!this.panelModoDesktop || !this.empleadoSeleccionadoId) {
      this.panelFlotanteStyle = {};
      return;
    }

    this.panelPositionTimeout = setTimeout(() => {
      this.actualizarPosicionPanel();
    }, 0);
  }

  private actualizarPosicionPanel(): void {
    if (!this.panelModoDesktop || !this.empleadoSeleccionadoId || typeof document === 'undefined') {
      this.panelFlotanteStyle = {};
      return;
    }

    const contenedor = document.querySelector('.empleados-focus-layout') as HTMLElement | null;
    const tarjeta = document.querySelector(
      `.empleado-card[data-empleado-id="${this.empleadoSeleccionadoId}"]`
    ) as HTMLElement | null;
    const panel = document.querySelector('.empleado-editor-panel') as HTMLElement | null;

    if (!contenedor || !tarjeta) {
      this.panelFlotanteStyle = {};
      return;
    }

    const contRect = contenedor.getBoundingClientRect();
    const cardRect = tarjeta.getBoundingClientRect();
    const gap = 10;

    const panelWidth = Math.round(
      Math.max(280, Math.min(this.PANEL_ANCHO_BASE, contRect.width * 0.33))
    );

    const centroContenedor = contRect.left + contRect.width / 2;
    const centroTarjeta = cardRect.left + cardRect.width / 2;
    const abrirADerecha = centroTarjeta <= centroContenedor;
    this.panelLado = abrirADerecha ? 'right' : 'left';

    let left = abrirADerecha
      ? (cardRect.left - contRect.left) + cardRect.width + gap
      : (cardRect.left - contRect.left) - panelWidth - gap;

    const leftMin = 0;
    const leftMax = Math.max(contRect.width - panelWidth, 0);
    left = Math.min(Math.max(left, leftMin), leftMax);

    const panelHeight = Math.max(Number(panel?.offsetHeight || 0), 280);
    let top = cardRect.top - contRect.top;
    const topMin = 0;
    const topMaxByContainer = Math.max(contRect.height - panelHeight - 6, 0);
    const viewportBottomSafeMargin = 14;
    const topMaxByViewport = Math.max(window.innerHeight - contRect.top - panelHeight - viewportBottomSafeMargin, 0);
    const topMax = Math.min(topMaxByContainer, topMaxByViewport);
    top = Math.min(Math.max(top, topMin), topMax);

    this.panelFlotanteStyle = {
      width: `${panelWidth}px`,
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`
    };
  }

  private obtenerRectTarjeta(empleadoId: number): DOMRect | null {
    if (typeof document === 'undefined') return null;
    const elementoTarjeta = document.querySelector(
      `.empleado-card[data-empleado-id="${empleadoId}"]`
    ) as HTMLElement | null;

    return elementoTarjeta ? elementoTarjeta.getBoundingClientRect() : null;
  }

  private obtenerRectPanel(): DOMRect | null {
    if (typeof document === 'undefined') return null;
    const panel = document.querySelector('.empleado-editor-panel') as HTMLElement | null;
    return panel ? panel.getBoundingClientRect() : null;
  }

  private construirMorphStyle(rect: DOMRect, opacity: number): { [key: string]: string } {
    return {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      opacity: `${opacity}`
    };
  }

  private animarMorphHaciaPanel(origenRect: DOMRect | null): void {
    if (!origenRect) return;

    setTimeout(() => {
      const destinoRect = this.obtenerRectPanel();
      if (!destinoRect) return;

      this.dispararMorph(origenRect, destinoRect);
    }, 30);
  }

  private dispararMorph(origenRect: DOMRect, destinoRect: DOMRect): void {
    if (this.morphTimeout) {
      clearTimeout(this.morphTimeout);
      this.morphTimeout = null;
    }

    this.morphActivo = true;
    this.morphStyle = this.construirMorphStyle(origenRect, 0.9);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.morphStyle = this.construirMorphStyle(destinoRect, 0);
      });
    });

    this.morphTimeout = setTimeout(() => {
      this.morphActivo = false;
    }, this.MORPH_DURATION_MS + 40);
  }
}
