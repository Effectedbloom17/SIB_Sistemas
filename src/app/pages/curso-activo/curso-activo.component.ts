import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BackendServices } from '../../services/backend.services';
import { GoogleCalendarService } from '../../services/google-calendar.service';
import Swal from 'sweetalert2';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { formatearFechaDdmmaaaa, fechaSoloDiaATimestamp } from '../../utils/fecha.util';
import {
  construirHtmlErroresRegistro,
  construirHtmlFilasDescartadasExcel,
  FilaDescartadaExcel,
  traducirErroresLista,
  traducirMensajeError
} from '../../utils/error-mensajes.util';

interface EmpleadoRegistro {
  nombre: string;
  curp: string;
  puesto: string;
  educacion?: string;
  antiguedad?: string;
  inscripcion_id?: number;  // presente si ya está inscrito en BD
  estaInscrito?: boolean;   // true = ya registrado, false/undefined = nuevo
}

interface EmpleadoGuardadoEmpresa {
  empleado_id: number;
  nombre: string;
  curp: string;
  puesto: string;
  educacion: string;
  antiguedad: string;
  activo: boolean;
  seleccionado: boolean;
}

interface ResumenImportacionExcel {
  totalFilasAnalizadas: number;
  importadas: number;
  validas: number;
  invalidas: number;
  duplicadas: number;
  curpsCorregidos: number;
  columnasDetectadas: string[];
  filasDescartadas: FilaDescartadaExcel[];
}

interface ColumnasDetectadasExcel {
  headerIndex: number;
  dataStartIndex: number;
  nombre: number;
  primerNombre: number;
  segundoNombre: number;
  apellidoPaterno: number;
  apellidoMaterno: number;
  curp: number;
  puesto: number;
  columnasDetectadas: string[];
}


@Component({
  selector: 'app-curso-activo',
  templateUrl: './curso-activo.component.html',
  styleUrls: ['./curso-activo.component.scss']
})
export class CursoActivoComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private readonly FILTROS_STORAGE_PREFIX = 'curso-activo-filtros';
  private restaurandoEstadoFiltros = false;

  // Cursos de la base de datos
  cursosProgramadosBD: any[] = [];
  cursosProgramadosFiltrados: any[] = [];
  cursosProgramadosPropiosBD: any[] = [];
  cursosProgramadosPropiosFiltrados: any[] = [];
  loadingBD: boolean = true;

  // Filtros
  textoBusqueda: string = '';
  filtroEmpresa: string = '';
  filtroEstatus: string = '';
  empresasUnicas: { id: number, nombre: string }[] = [];

  // Ordenamiento
  ordenCampo: string = 'fecha_inicio';
  ordenAsc: boolean = false;

  // Paginación
  paginaActual: number = 1;
  itemsPorPagina: number = 10;
  paginaActualPropios: number = 1;
  itemsPorPaginaPropios: number = 10;
  mostrarCapacitacionesGlobales: boolean = false;

  // Preview visual de línea de tiempo en tabla
  timelinePreviewsAbiertos = new Set<string>();
  pasosTimelineCurso = [
    { numero: 1, nombre: 'Inicio', icono: 'fa-play', descripcion: 'Inicio del curso', seccion: 'capacitacion' },
    { numero: 2, nombre: 'Checklist', icono: 'fa-tasks', descripcion: 'Control de materiales', seccion: 'capacitacion' },
    { numero: 3, nombre: 'Encuesta', icono: 'fa-poll', descripcion: 'Encuesta de satisfacción', seccion: 'capacitacion' },
    { numero: 4, nombre: 'Pase de lista', icono: 'fa-clipboard-check', descripcion: 'Registro de asistencia', seccion: 'capacitacion' },
    { numero: 5, nombre: 'Examenes', icono: 'fa-file-alt', descripcion: 'Diagnóstico y evaluación final', seccion: 'documentacion' },
    { numero: 6, nombre: 'Evidencias', icono: 'fa-camera', descripcion: 'Fotos del curso', seccion: 'documentacion' },
    { numero: 7, nombre: 'Informe', icono: 'fa-file-pdf', descripcion: 'Reporte de resultados', seccion: 'documentacion' },
    { numero: 8, nombre: 'Constancias', icono: 'fa-certificate', descripcion: 'Generación de documentos', seccion: 'documentacion' },
    { numero: 10, nombre: 'Finalizado', icono: 'fa-check-circle', descripcion: 'Curso completado', seccion: 'documentacion' }
  ];

  // Modal de registro de empleados
  mostrarModalEmpleados: boolean = false;
  cursoParaRegistro: any = null;
  empleadosARegistrar: EmpleadoRegistro[] = [];
  registrandoEmpleados: boolean = false;
  errorRegistro: string = '';
  excelCargando: boolean = false;
  resultadoImportacionExcel: ResumenImportacionExcel | null = null;
  empleadosGuardadosEmpresa: EmpleadoGuardadoEmpresa[] = [];
  empleadosGuardadosFiltrados: EmpleadoGuardadoEmpresa[] = [];
  textoBusquedaEmpleadosGuardados: string = '';
  cargandoEmpleadosGuardados: boolean = false;
  mostrarPanelEmpleadosGuardados: boolean = false;
  puedeUsarMisEmpleados: boolean = false;
  errorSelectorEmpleados: string = '';
  pasoRegistroEmpleados: 1 | 2 = 1;
  enriqueciendoDatosAdicionales: boolean = false;

  readonly opcionesEducacion = ['Educación Básica', 'Media Superior', 'Educación Superior'];
  readonly opcionesAntiguedad = ['Menor a 6 meses', '6 meses - 1 año', 'Mayor a un año'];

  // Roles del usuario
  esEmpresa: boolean = false;
  empresaId: number | null = null;
  esInstructor: boolean = false;
  instructorId: number | null = null;
  esRoot: boolean = false;
  esAdministradorOSuperior: boolean = false;
  esInstructorYAdministrador: boolean = false;

  constructor(
    private router: Router,
    private authService: AuthService,
    private backendServices: BackendServices,
    private googleCalendarService: GoogleCalendarService
  ) { }

  ngOnInit(): void {
    this.esEmpresa = this.authService.esUsuarioEmpresa();
    this.empresaId = this.authService.getEmpresaId();
    this.esInstructor = this.authService.esInstructor();
    this.instructorId = this.authService.getInstructorId();
    this.esRoot = this.authService.esRoot();
    this.esAdministradorOSuperior = this.authService.esAdministradorOSuperior();
    this.esInstructorYAdministrador = this.esInstructor && this.esAdministradorOSuperior;

    this.restaurarEstadoFiltros();
    this.restaurandoEstadoFiltros = true;
    this.cargarCursosProgramadosBD();
  }

  private getStorageKeyFiltros(): string {
    const usuarioId = this.authService.getUsuarioId() || 'anon';
    return `${this.FILTROS_STORAGE_PREFIX}-${usuarioId}`;
  }

  private guardarEstadoFiltros(): void {
    try {
      sessionStorage.setItem(this.getStorageKeyFiltros(), JSON.stringify({
        textoBusqueda: this.textoBusqueda,
        filtroEmpresa: this.filtroEmpresa,
        filtroEstatus: this.filtroEstatus,
        paginaActual: this.paginaActual,
        paginaActualPropios: this.paginaActualPropios,
        mostrarCapacitacionesGlobales: this.mostrarCapacitacionesGlobales
      }));
    } catch (_) { /* sessionStorage no disponible */ }
  }

  private restaurarEstadoFiltros(): void {
    try {
      const raw = sessionStorage.getItem(this.getStorageKeyFiltros());
      if (!raw) return;

      const estado = JSON.parse(raw);
      this.textoBusqueda = typeof estado.textoBusqueda === 'string' ? estado.textoBusqueda : '';
      this.filtroEmpresa = estado.filtroEmpresa != null ? String(estado.filtroEmpresa) : '';
      this.filtroEstatus = typeof estado.filtroEstatus === 'string'
        ? (estado.filtroEstatus === 'en_curso' ? 'con_inscritos' : estado.filtroEstatus)
        : '';
      this.paginaActual = Number(estado.paginaActual) > 0 ? Number(estado.paginaActual) : 1;
      this.paginaActualPropios = Number(estado.paginaActualPropios) > 0 ? Number(estado.paginaActualPropios) : 1;
      this.mostrarCapacitacionesGlobales = Boolean(estado.mostrarCapacitacionesGlobales);
    } catch (_) { /* estado corrupto, usar valores por defecto */ }
  }

  /**
   * Carga los cursos programados directamente de la base de datos
   * Si el usuario es de tipo empresa, solo carga los cursos de su empresa
   */
  cargarCursosProgramadosBD(): void {
    this.loadingBD = true;

    if (this.esInstructorYAdministrador) {
      this.cargarCursosDualInstructorAdministrador();
      return;
    }

    // Empresa sin empresa_id: no cargar datos (evitar exponer todos los cursos)
    if (this.esEmpresa && !this.empresaId) {
      this.cursosProgramadosBD = [];
      this.cursosProgramadosPropiosBD = [];
      this.cursosProgramadosPropiosFiltrados = [];
      this.finalizarRestauracionFiltros();
      this.loadingBD = false;
      return;
    }

    // Instructor sin instructor_id: no cargar datos
    if (this.esInstructor && !this.instructorId) {
      this.cursosProgramadosBD = [];
      this.cursosProgramadosPropiosBD = [];
      this.cursosProgramadosPropiosFiltrados = [];
      this.finalizarRestauracionFiltros();
      this.loadingBD = false;
      return;
    }

    // Filtrar según el rol del usuario
    let peticion$;
    if (this.esEmpresa && this.empresaId) {
      peticion$ = this.backendServices.obtenerCursosProgramadosPorEmpresa(this.empresaId);
    } else if (this.esInstructor && this.instructorId) {
      peticion$ = this.backendServices.obtenerCursosProgramadosPorInstructor(this.instructorId);
    } else {
      peticion$ = this.backendServices.obtenerCursosProgramados();
    }

    peticion$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        if (response.success) {
          const cursosProgramados = Array.isArray(response.cursosProgramados) ? response.cursosProgramados : [];
          this.backendServices.obtenerEmpresas().pipe(takeUntil(this.destroy$)).subscribe({
            next: (empresasResponse: any) => {
              const empresas = empresasResponse?.success && Array.isArray(empresasResponse.empresas)
                ? empresasResponse.empresas
                : [];

              this.cursosProgramadosBD = this.enriquecerCursosConLogoEmpresa(cursosProgramados, empresas);
              this.extraerEmpresasUnicas();
              this.filtrarCursos();
              this.finalizarRestauracionFiltros();
              this.loadingBD = false;
            },
            error: () => {
              this.cursosProgramadosBD = cursosProgramados;
              this.extraerEmpresasUnicas();
              this.filtrarCursos();
              this.finalizarRestauracionFiltros();
              this.loadingBD = false;
            }
          });
          return;
        }
        this.finalizarRestauracionFiltros();
        this.loadingBD = false;
      },
      error: (error) => {
        console.error('Error cargando cursos programados:', error);
        this.finalizarRestauracionFiltros();
        this.loadingBD = false;
      }
    });
  }

  private cargarCursosDualInstructorAdministrador(): void {
    if (!this.instructorId) {
      this.cursosProgramadosBD = [];
      this.cursosProgramadosFiltrados = [];
      this.cursosProgramadosPropiosBD = [];
      this.cursosProgramadosPropiosFiltrados = [];
      this.finalizarRestauracionFiltros();
      this.loadingBD = false;
      return;
    }

    const propios$ = this.backendServices.obtenerCursosProgramadosPorInstructor(this.instructorId).pipe(
      catchError((error) => {
        console.error('Error cargando capacitaciones propias:', error);
        return of({ success: false, cursosProgramados: [] });
      })
    );

    const globales$ = this.backendServices.obtenerCursosProgramados().pipe(
      catchError((error) => {
        console.error('Error cargando capacitaciones globales:', error);
        return of({ success: false, cursosProgramados: [] });
      })
    );

    const empresas$ = this.backendServices.obtenerEmpresas().pipe(
      catchError(() => of({ success: false, empresas: [] }))
    );

    forkJoin({ propiosResponse: propios$, globalesResponse: globales$, empresasResponse: empresas$ })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ propiosResponse, globalesResponse, empresasResponse }) => {
          const cursosPropios = Array.isArray(propiosResponse?.cursosProgramados)
            ? propiosResponse.cursosProgramados
            : [];
          const cursosGlobales = Array.isArray(globalesResponse?.cursosProgramados)
            ? globalesResponse.cursosProgramados
            : [];
          const empresas = empresasResponse?.success && Array.isArray(empresasResponse?.empresas)
            ? empresasResponse.empresas
            : [];

          this.cursosProgramadosPropiosBD = this.enriquecerCursosConLogoEmpresa(cursosPropios, empresas);
          this.cursosProgramadosBD = this.enriquecerCursosConLogoEmpresa(cursosGlobales, empresas);
          this.extraerEmpresasUnicas();
          this.filtrarCursos();
          this.finalizarRestauracionFiltros();
          this.loadingBD = false;
        },
        error: (error) => {
          console.error('Error cargando cursos duales:', error);
          this.cursosProgramadosPropiosBD = [];
          this.cursosProgramadosBD = [];
          this.cursosProgramadosPropiosFiltrados = [];
          this.cursosProgramadosFiltrados = [];
          this.finalizarRestauracionFiltros();
          this.loadingBD = false;
        }
      });
  }

  private enriquecerCursosConLogoEmpresa(cursos: any[], empresas: any[]): any[] {
    const empresasPorId = new Map<number, any>();

    empresas.forEach((empresa) => {
      if (empresa?.empresa_id) {
        empresasPorId.set(empresa.empresa_id, empresa);
      }
    });

    return cursos.map((curso) => {
      const empresa = empresasPorId.get(curso.empresa_id) || {};
      const logo = curso.empresa_logo || curso.logo || curso.logo_url || empresa.logo || empresa.logo_url || null;

      return {
        ...empresa,
        ...curso,
        empresa_logo: logo,
        logo,
        logo_url: curso.logo_url || curso.empresa_logo || empresa.logo_url || empresa.logo || null
      };
    });
  }

  getLogoEmpresaUrl(curso: any): string | null {
    return this.backendServices.resolverUrlDrivePreview(
      curso?.empresa_logo || curso?.logo || curso?.logo_url || null
    );
  }

  getInicialesEmpresa(nombre: string): string {
    if (!nombre) return '??';
    const palabras = nombre.trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  onLogoEmpresaError(curso: any): void {
    if (!curso) return;
    curso.empresa_logo = null;
    curso.logo = null;
    curso.logo_url = null;
  }

  /**
   * Extrae las empresas únicas para el dropdown de filtro
   */
  extraerEmpresasUnicas(): void {
    const mapa = new Map<number, string>();
    this.cursosProgramadosBD.forEach(c => {
      if (c.empresa_id && c.nombre_empresa) {
        mapa.set(c.empresa_id, c.nombre_empresa);
      }
    });
    this.empresasUnicas = Array.from(mapa, ([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  /**
   * Filtra los cursos según todos los filtros activos
   * 
   * REGLAS DE VISUALIZACIÓN:
  * 1. Solo se muestran cursos con estatus: PROGRAMADO o EN_CURSO
  * 2. Los cursos COMPLETADOS, CANCELADOS y POSPUESTOS no se muestran
  * 3. Los cursos se ordenan por estatus: PROGRAMADO → EN_CURSO
   */
  filtrarCursos(): void {
    const procesarCursos = (cursos: any[]): any[] => {
      const filtrados = this.aplicarFiltrosCursos(cursos);
      return this.ordenarCursos(filtrados);
    };

    const hayFiltroPrincipal = Boolean(
      (this.textoBusqueda && this.textoBusqueda.trim()) ||
      this.filtroEmpresa ||
      this.filtroEstatus
    );

    if (this.esInstructorYAdministrador) {
      this.cursosProgramadosPropiosFiltrados = procesarCursos(this.cursosProgramadosPropiosBD);
      const cursosGlobalesProcesados = procesarCursos(this.cursosProgramadosBD);
      this.cursosProgramadosFiltrados = cursosGlobalesProcesados;
      if (!this.restaurandoEstadoFiltros) {
        this.paginaActualPropios = 1;
        this.paginaActual = 1;
      }
      if (hayFiltroPrincipal && !this.restaurandoEstadoFiltros) {
        this.mostrarCapacitacionesGlobales = true;
      }
      this.ajustarPaginacionValida();
      this.guardarEstadoFiltros();
      return;
    }

    this.cursosProgramadosFiltrados = procesarCursos(this.cursosProgramadosBD);
    if (!this.restaurandoEstadoFiltros) {
      this.paginaActual = 1;
    }
    this.ajustarPaginacionValida();
    this.guardarEstadoFiltros();
  }

  private finalizarRestauracionFiltros(): void {
    this.restaurandoEstadoFiltros = false;
    this.ajustarPaginacionValida();
    this.guardarEstadoFiltros();
  }

  private ajustarPaginacionValida(): void {
    if (this.totalPaginas > 0 && this.paginaActual > this.totalPaginas) {
      this.paginaActual = this.totalPaginas;
    }
    if (this.totalPaginasPropios > 0 && this.paginaActualPropios > this.totalPaginasPropios) {
      this.paginaActualPropios = this.totalPaginasPropios;
    }
  }

  private aplicarFiltrosCursos(cursos: any[]): any[] {
    let resultado = [...cursos];

    // ========== FILTROS AUTOMÁTICOS DE VISUALIZACIÓN ==========

    // Regla 1: Solo mostrar cursos PROGRAMADOS y EN_CURSO
    resultado = resultado.filter(c => {
      if (c.estatus === 'cancelado' || c.estatus === 'pospuesto' || c.estatus === 'completado') {
        return false;
      }

      return c.estatus === 'programado' || c.estatus === 'en_curso';
    });

    // ========== FILTROS MANUALES DEL USUARIO ==========
    if (this.filtroEmpresa) {
      resultado = resultado.filter(c => c.empresa_id == this.filtroEmpresa);
    }

    // Filtro por estatus / participantes
    if (this.filtroEstatus === 'con_inscritos') {
      resultado = resultado.filter(c => (Number(c.inscritos) || 0) > 0);
    } else if (this.filtroEstatus) {
      resultado = resultado.filter(c => c.estatus === this.filtroEstatus);
    }

    // Filtro por texto de búsqueda
    if (this.textoBusqueda && this.textoBusqueda.trim()) {
      const texto = this.textoBusqueda.toLowerCase().trim();
      resultado = resultado.filter(c =>
        (c.nombre_curso && c.nombre_curso.toLowerCase().includes(texto)) ||
        (c.nombre_empresa && c.nombre_empresa.toLowerCase().includes(texto)) ||
        (c.instructor_nombre && c.instructor_nombre.toLowerCase().includes(texto))
      );
    }

    return resultado;
  }

  private ordenarCursos(cursos: any[]): any[] {
    const resultado = [...cursos];

    // Ordenamiento: primero por estatus (programado → en_curso), luego por campo seleccionado
    const ordenEstatus: { [key: string]: number } = { 'programado': 0, 'en_curso': 1 };
    resultado.sort((a, b) => {
      // Prioridad 1: Ordenar por estatus
      const estatusA = ordenEstatus[a.estatus] ?? 3;
      const estatusB = ordenEstatus[b.estatus] ?? 3;
      if (estatusA !== estatusB) return estatusA - estatusB;

      // Prioridad 2: Ordenar por campo seleccionado por el usuario
      let valA: any, valB: any;
      if (this.ordenCampo === 'fecha_inicio') {
        valA = fechaSoloDiaATimestamp(a.fecha_inicio);
        valB = fechaSoloDiaATimestamp(b.fecha_inicio);
      } else {
        valA = (a[this.ordenCampo] || '').toString().toLowerCase();
        valB = (b[this.ordenCampo] || '').toString().toLowerCase();
      }
      if (valA < valB) return this.ordenAsc ? -1 : 1;
      if (valA > valB) return this.ordenAsc ? 1 : -1;
      return 0;
    });

    return resultado;
  }

  /**
   * Ordena por un campo específico
   */
  ordenarPor(campo: string): void {
    if (this.ordenCampo === campo) {
      this.ordenAsc = !this.ordenAsc;
    } else {
      this.ordenCampo = campo;
      this.ordenAsc = campo !== 'fecha_inicio';
    }
    this.filtrarCursos();
  }

  // ========== PAGINACIÓN ==========

  get totalPaginas(): number {
    return Math.ceil(this.cursosProgramadosFiltrados.length / this.itemsPorPagina);
  }

  get totalPaginasPropios(): number {
    return Math.ceil(this.cursosProgramadosPropiosFiltrados.length / this.itemsPorPaginaPropios);
  }

  get cursosPaginados(): any[] {
    const inicio = (this.paginaActual - 1) * this.itemsPorPagina;
    return this.cursosProgramadosFiltrados.slice(inicio, inicio + this.itemsPorPagina);
  }

  get cursosPropiosPaginados(): any[] {
    const inicio = (this.paginaActualPropios - 1) * this.itemsPorPaginaPropios;
    return this.cursosProgramadosPropiosFiltrados.slice(inicio, inicio + this.itemsPorPaginaPropios);
  }

  get paginasVisibles(): number[] {
    const total = this.totalPaginas;
    const actual = this.paginaActual;
    const paginas: number[] = [];

    let inicio = Math.max(1, actual - 2);
    let fin = Math.min(total, actual + 2);

    // Ajustar para mostrar siempre 5 páginas si hay suficientes
    if (fin - inicio < 4) {
      if (inicio === 1) fin = Math.min(total, inicio + 4);
      else inicio = Math.max(1, fin - 4);
    }

    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }
    return paginas;
  }

  get paginasVisiblesPropios(): number[] {
    const total = this.totalPaginasPropios;
    const actual = this.paginaActualPropios;
    const paginas: number[] = [];

    let inicio = Math.max(1, actual - 2);
    let fin = Math.min(total, actual + 2);

    // Ajustar para mostrar siempre 5 páginas si hay suficientes
    if (fin - inicio < 4) {
      if (inicio === 1) fin = Math.min(total, inicio + 4);
      else inicio = Math.max(1, fin - 4);
    }

    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }
    return paginas;
  }

  cambiarPagina(pagina: number): void {
    if (pagina >= 1 && pagina <= this.totalPaginas) {
      this.paginaActual = pagina;
      this.guardarEstadoFiltros();
    }
  }

  cambiarPaginaPropios(pagina: number): void {
    if (pagina >= 1 && pagina <= this.totalPaginasPropios) {
      this.paginaActualPropios = pagina;
      this.guardarEstadoFiltros();
    }
  }

  toggleCapacitacionesGlobales(): void {
    this.mostrarCapacitacionesGlobales = !this.mostrarCapacitacionesGlobales;
    this.guardarEstadoFiltros();
  }

  /**
   * Limpia todos los filtros
   */
  limpiarFiltros(): void {
    this.textoBusqueda = '';
    this.filtroEmpresa = '';
    this.filtroEstatus = '';
    this.mostrarCapacitacionesGlobales = false;
    this.filtrarCursos();
  }

  toggleTimelinePreviewCurso(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): void {
    if (contexto === 'propio') {
      return;
    }

    const key = this.getTimelinePreviewKey(curso, contexto);
    if (!key) {
      return;
    }

    if (this.timelinePreviewsAbiertos.has(key)) {
      this.timelinePreviewsAbiertos.delete(key);
      return;
    }

    this.timelinePreviewsAbiertos.clear();
    this.timelinePreviewsAbiertos.add(key);
  }

  isTimelinePreviewCursoSeleccionado(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): boolean {
    if (contexto === 'propio') {
      return false;
    }

    const key = this.getTimelinePreviewKey(curso, contexto);
    return key ? this.timelinePreviewsAbiertos.has(key) : false;
  }

  private getTimelinePreviewKey(curso: any, contexto: 'propio' | 'global' | 'unico'): string {
    const cursoId = Number(curso?.programado_id || 0);
    if (!cursoId) {
      return '';
    }
    return `${contexto}:${cursoId}`;
  }

  private normalizarPasosCompletadosTimeline(pasosRaw: any, curso: any): number[] {
    let pasos = pasosRaw;

    if (typeof pasos === 'string') {
      try {
        pasos = JSON.parse(pasos);
      } catch (_) {
        pasos = [];
      }
    }

    if (!Array.isArray(pasos)) {
      pasos = [];
    }

    const pasosValidos = new Set(this.pasosTimelineCurso.map((paso: any) => paso.numero));
    const normalizados: number[] = Array.from(new Set<number>(
      pasos
        .map((paso: any) => Number(paso))
        .filter((paso: number) => Number.isFinite(paso))
    )).filter((paso: number) => pasosValidos.has(paso));

    const estatusCompletado = String(curso?.estatus || '').toLowerCase() === 'completado';
    if (estatusCompletado && normalizados.includes(9) && !normalizados.includes(10)) {
      normalizados.push(10);
    }

    return normalizados;
  }

  getPasosCompletadosTimelineCurso(curso: any): number[] {
    return this.normalizarPasosCompletadosTimeline(curso?.pasos_completados, curso);
  }

  isPasoTimelineCompletado(curso: any, numeroPaso: number): boolean {
    return this.getPasosCompletadosTimelineCurso(curso).includes(numeroPaso);
  }

  isPasoTimelineActual(curso: any, numeroPaso: number): boolean {
    const pasosCompletados = this.getPasosCompletadosTimelineCurso(curso);

    if (pasosCompletados.length === 0) {
      return numeroPaso === (this.pasosTimelineCurso[0]?.numero || 1);
    }

    for (const paso of this.pasosTimelineCurso) {
      if (!pasosCompletados.includes(paso.numero)) {
        return numeroPaso === paso.numero;
      }
    }

    return numeroPaso === (this.pasosTimelineCurso[this.pasosTimelineCurso.length - 1]?.numero || 1);
  }

  getPorcentajeTimelineSeleccionado(curso: any): number {
    if (!this.pasosTimelineCurso.length) return 0;
    const pasosCompletados = this.getPasosCompletadosTimelineCurso(curso);
    return (pasosCompletados.length / this.pasosTimelineCurso.length) * 100;
  }

  getProgresoTimelineSeccion(curso: any, seccion: string): number {
    const pasosSeccion = this.pasosTimelineCurso.filter((paso: any) => paso.seccion === seccion);
    if (!pasosSeccion.length) {
      return 0;
    }

    const pasosCompletados = this.getPasosCompletadosTimelineCurso(curso);
    const completados = pasosSeccion.filter((paso: any) => pasosCompletados.includes(paso.numero)).length;
    return (completados / pasosSeccion.length) * 100;
  }

  getPasoTimelineActual(curso: any): any | null {
    if (!this.pasosTimelineCurso.length) return null;
    const pasosCompletados = this.getPasosCompletadosTimelineCurso(curso);

    for (const paso of this.pasosTimelineCurso) {
      if (!pasosCompletados.includes(paso.numero)) {
        return paso;
      }
    }

    return this.pasosTimelineCurso[this.pasosTimelineCurso.length - 1] || null;
  }

  get hayFiltrosActivos(): boolean {
    return !!(this.textoBusqueda || this.filtroEmpresa || this.filtroEstatus);
  }

  get hayCursosBase(): boolean {
    if (this.esInstructorYAdministrador) {
      return this.cursosProgramadosPropiosBD.length > 0 || this.cursosProgramadosBD.length > 0;
    }
    return this.cursosProgramadosBD.length > 0;
  }

  get hayCursosFiltrados(): boolean {
    if (this.esInstructorYAdministrador) {
      return this.cursosProgramadosPropiosFiltrados.length > 0 || this.cursosProgramadosFiltrados.length > 0;
    }
    return this.cursosProgramadosFiltrados.length > 0;
  }

  /**
   * Obtiene la etiqueta de estatus para mostrar
   */
  getEstatusLabel(estatus: string): string {
    switch (estatus) {
      case 'programado': return 'Programado';
      case 'en_curso': return 'En Curso';
      case 'completado': return 'Completado';
      case 'cancelado': return 'Cancelado';
      case 'pospuesto': return 'Pospuesto';
      default: return 'Programado';
    }
  }

  /**
   * Obtiene el color del estatus
   */
  getEstatusColor(estatus: string): string {
    switch (estatus) {
      case 'programado': return '#fb6340';
      case 'en_curso': return '#5e72e4';
      case 'completado': return '#2dce89';
      case 'cancelado': return '#f5365c';
      case 'pospuesto': return '#ffd600';
      default: return '#8898aa';
    }
  }

  /**
   * Obtiene el tooltip para el estatus con descripción del color
   */
  getEstatusTooltip(estatus: string): string {
    switch (estatus) {
      case 'programado': return 'Pendiente de verificación - Requiere revisión antes de iniciar';
      case 'pospuesto': return 'Curso pospuesto - En espera de reprogramación';
      case 'en_curso': return 'Curso activo - En progreso actualmente';
      case 'completado': return 'Curso finalizado - Completado exitosamente';
      case 'cancelado': return 'Curso cancelado';
      default: return 'Pendiente de verificación';
    }
  }

  /**
   * Formatea la hora para quitar los segundos (HH:mm)
   */
  formatTime(time: string): string {
    if (!time) return '--:--';
    // Si viene en formato HH:mm:ss o similar, tomar solo los primeros dos bloques
    const partes = time.split(':');
    if (partes.length >= 2) {
      return `${partes[0]}:${partes[1]}`;
    }
    return time;
  }

  // ========== MÉTODOS PARA REGISTRO DE EMPLEADOS ==========

  /**
   * Abre el modal para registrar empleados en un curso
   * Inicializa las filas según el cupo disponible del curso
   */
  abrirModalRegistroEmpleados(curso: any): void {
    this.cursoParaRegistro = curso;
    this.errorRegistro = '';
    this.pasoRegistroEmpleados = 1;
    this.resultadoImportacionExcel = null;
    this.empleadosARegistrar = [];
    this.mostrarPanelEmpleadosGuardados = false;
    this.mostrarModalEmpleados = true;
    this.limpiarEstadoEmpleadosGuardados();
    this.precargarCatalogoEmpleadosEmpresa();

    // Cargar participantes ya inscritos para permitir edición
    this.backendServices.obtenerParticipantesCurso(curso.programado_id).subscribe({
      next: (response: any) => {
        const inscritos: EmpleadoRegistro[] = (response?.participantes || response?.alumnos || []).map((p: any) => ({
          nombre: p.nombre_completo || [p.apellido_paterno, p.apellido_materno, p.nombre].filter(Boolean).join(' ') || '',
          curp: p.curp || '',
          puesto: p.puesto || '',
          inscripcion_id: p.inscripcion_id,
          estaInscrito: true
        }));

        const cupoTotal = curso.cupo || 25;
        const filasVacias = Math.max(1, cupoTotal - inscritos.length);

        this.empleadosARegistrar = [
          ...inscritos,
          ...Array.from({ length: filasVacias }, () => ({ nombre: '', curp: '', puesto: '', educacion: '', antiguedad: '' }))
        ];
      },
      error: () => {
        // Si falla la carga, abrir con filas vacías normalmente
        const cupoDisponible = Math.max(1, (curso.cupo || 25) - (curso.inscritos || 0));
        this.empleadosARegistrar = Array.from({ length: cupoDisponible }, () => ({ nombre: '', curp: '', puesto: '', educacion: '', antiguedad: '' }));
      }
    });
  }

  /**
   * Cierra el modal de registro de empleados
   */
  cerrarModalEmpleados(): void {
    this.mostrarModalEmpleados = false;
    this.cursoParaRegistro = null;
    this.empleadosARegistrar = [];
    this.pasoRegistroEmpleados = 1;
    this.errorRegistro = '';
    this.resultadoImportacionExcel = null;
    this.limpiarEstadoEmpleadosGuardados();
  }

  /**
   * Agrega una nueva fila vacía para registrar otro empleado
   */
  agregarEmpleado(): void {
    this.empleadosARegistrar.push({ nombre: '', curp: '', puesto: '', educacion: '', antiguedad: '' });
  }

  get totalEmpleadosGuardadosSeleccionados(): number {
    return this.empleadosGuardadosEmpresa.filter(emp => emp.seleccionado).length;
  }

  get puedeUsarSelectorMisEmpleados(): boolean {
    return this.esEmpresa || this.esAdministradorOSuperior;
  }

  trackByEmpleadoGuardado(index: number, empleado: EmpleadoGuardadoEmpresa): number {
    return empleado?.empleado_id || index;
  }

  esCurpYaEnTablaRegistro(curp: string): boolean {
    if (!curp) return false;
    const curpLimpio = this.limpiarCURP(curp);
    if (!curpLimpio) return false;
    return this.empleadosARegistrar.some(
      (emp) => this.limpiarCURP(emp.curp) === curpLimpio && (emp.nombre.trim().length > 0 || emp.curp.trim().length > 0)
    );
  }

  getInicialesEmpleadoGuardado(nombre: string): string {
    const limpio = String(nombre || '').trim();
    if (!limpio) return '??';

    const partes = limpio.split(/\s+/).filter(Boolean);
    if (partes.length === 1) {
      return partes[0].slice(0, 2).toUpperCase();
    }

    return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
  }

  abrirModalSeleccionEmpleadosGuardados(): void {
    if (!this.puedeUsarSelectorMisEmpleados || !this.puedeUsarMisEmpleados) return;

    this.mostrarPanelEmpleadosGuardados = true;
    this.errorSelectorEmpleados = '';

    if (this.empleadosGuardadosEmpresa.length === 0 && !this.cargandoEmpleadosGuardados) {
      this.cargarEmpleadosGuardadosEmpresa();
      return;
    }

    this.filtrarEmpleadosGuardados();
  }

  cerrarModalSeleccionEmpleadosGuardados(): void {
    this.mostrarPanelEmpleadosGuardados = false;
    this.errorSelectorEmpleados = '';
  }

  filtrarEmpleadosGuardados(): void {
    const texto = this.normalizarBusqueda(this.textoBusquedaEmpleadosGuardados);

    if (!texto) {
      this.empleadosGuardadosFiltrados = [...this.empleadosGuardadosEmpresa];
      return;
    }

    this.empleadosGuardadosFiltrados = this.empleadosGuardadosEmpresa.filter((empleado) => {
      return this.normalizarBusqueda(empleado.nombre).includes(texto)
        || this.normalizarBusqueda(empleado.curp).includes(texto);
    });
  }

  seleccionarTodosEmpleadosGuardadosFiltrados(): void {
    this.empleadosGuardadosFiltrados.forEach((empleado) => {
      empleado.seleccionado = true;
    });
  }

  limpiarSeleccionEmpleadosGuardados(): void {
    this.empleadosGuardadosEmpresa.forEach((empleado) => {
      empleado.seleccionado = false;
    });
  }

  agregarEmpleadosGuardadosSeleccionados(cerrarModal: boolean = false): void {
    const seleccionados = this.empleadosGuardadosEmpresa.filter((empleado) => empleado.seleccionado);
    if (seleccionados.length === 0) return;

    const curpsExistentes = new Set(
      this.empleadosARegistrar
        .map((empleado) => this.limpiarCURP(empleado.curp))
        .filter((curp) => curp.length > 0)
    );

    let agregados = 0;
    let omitidos = 0;

    seleccionados.forEach((empleado) => {
      const nombre = this.autoAcentuar(this.limpiarNombre(empleado.nombre));
      const curp = this.limpiarCURP(empleado.curp);
      const puesto = this.autoAcentuar(this.limpiarPuesto(empleado.puesto || ''));

      if (!nombre || !curp || curpsExistentes.has(curp)) {
        omitidos++;
        empleado.seleccionado = false;
        return;
      }

      const indiceFilaLibre = this.obtenerIndiceFilaLibre();
      const filaPayload: EmpleadoRegistro = {
        nombre,
        curp,
        puesto,
        educacion: '',
        antiguedad: ''
      };

      if (indiceFilaLibre >= 0) {
        this.empleadosARegistrar[indiceFilaLibre] = {
          ...this.empleadosARegistrar[indiceFilaLibre],
          ...filaPayload,
          inscripcion_id: undefined,
          estaInscrito: false
        };
      } else {
        this.empleadosARegistrar.push(filaPayload);
      }

      curpsExistentes.add(curp);
      empleado.seleccionado = false;
      agregados++;
    });

    if (agregados === 0) {
      this.errorSelectorEmpleados = 'Los empleados seleccionados ya están en la tabla o no tienen CURP válido.';
      return;
    }

    this.errorSelectorEmpleados = '';

    if (cerrarModal) {
      this.cerrarModalSeleccionEmpleadosGuardados();
    }

    Swal.fire({
      title: 'Empleados cargados',
      html: `<p>Se cargaron <strong>${agregados}</strong> empleado(s) en la tabla.</p>${omitidos > 0
        ? `<small class="text-muted">${omitidos} registro(s) se omitieron por CURP duplicado o datos incompletos.</small>`
        : ''}`,
      icon: 'success',
      confirmButtonColor: '#38512F'
    });
  }

  private cargarEmpleadosGuardadosEmpresa(): void {
    const empresaIdRescate = this.obtenerEmpresaIdObjetivoCurso();
    if (!empresaIdRescate) return;

    this.cargandoEmpleadosGuardados = true;

    this.backendServices.obtenerEmpleadosPorEmpresa(empresaIdRescate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const empleadosRaw = Array.isArray(response?.empleados) ? response.empleados : [];

          this.empleadosGuardadosEmpresa = this.mapearEmpleadosGuardadosEmpresa(empleadosRaw);
          this.puedeUsarMisEmpleados = this.empleadosGuardadosEmpresa.length > 0;

          this.filtrarEmpleadosGuardados();
          this.cargandoEmpleadosGuardados = false;
        },
        error: (error: any) => {
          console.error('Error cargando empleados guardados de empresa:', error);
          this.empleadosGuardadosEmpresa = [];
          this.empleadosGuardadosFiltrados = [];
          this.puedeUsarMisEmpleados = false;
          this.cargandoEmpleadosGuardados = false;
        }
      });
  }

  private precargarCatalogoEmpleadosEmpresa(alTerminar?: () => void): void {
    const empresaIdRescate = this.obtenerEmpresaIdObjetivoCurso();
    if (!empresaIdRescate) {
      alTerminar?.();
      return;
    }

    this.cargandoEmpleadosGuardados = true;

    this.backendServices.obtenerEmpleadosPorEmpresa(empresaIdRescate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const empleadosRaw = Array.isArray(response?.empleados) ? response.empleados : [];
          this.empleadosGuardadosEmpresa = this.mapearEmpleadosGuardadosEmpresa(empleadosRaw);
          this.puedeUsarMisEmpleados = this.empleadosGuardadosEmpresa.length > 0;
          this.filtrarEmpleadosGuardados();
          this.cargandoEmpleadosGuardados = false;
          alTerminar?.();
        },
        error: (error: any) => {
          console.error('Error cargando catálogo de empleados de empresa:', error);
          this.empleadosGuardadosEmpresa = [];
          this.empleadosGuardadosFiltrados = [];
          this.puedeUsarMisEmpleados = false;
          this.cargandoEmpleadosGuardados = false;
          alTerminar?.();
        }
      });
  }

  private mapearEmpleadosGuardadosEmpresa(empleadosRaw: any[]): EmpleadoGuardadoEmpresa[] {
    return empleadosRaw
      .filter((empleado: any) => this.esEmpleadoGuardadoActivo(empleado))
      .map((empleado: any) => {
        const nombre = this.construirNombreEmpleadoGuardado(empleado);
        const curp = this.limpiarCURP(empleado?.curp || '');
        return {
          empleado_id: Number(empleado?.empleado_id || 0),
          nombre,
          curp,
          puesto: this.autoAcentuar(this.limpiarPuesto(empleado?.puesto || '')),
          educacion: this.normalizarEducacionDB(empleado?.educacion),
          antiguedad: this.normalizarAntiguedadDB(empleado?.antiguedad),
          activo: true,
          seleccionado: false
        };
      })
      .filter((empleado: EmpleadoGuardadoEmpresa) =>
        empleado.empleado_id > 0 &&
        empleado.nombre.length > 0 &&
        empleado.curp.length > 0
      )
      .sort((a: EmpleadoGuardadoEmpresa, b: EmpleadoGuardadoEmpresa) => a.nombre.localeCompare(b.nombre));
  }

  private obtenerEmpresaIdObjetivoCurso(): number | null {
    const empresaCursoId = Number(this.cursoParaRegistro?.empresa_id || 0);

    // En perfil admin/superadmin siempre se trabaja con la empresa del curso.
    if (this.esAdministradorOSuperior && empresaCursoId > 0) {
      return empresaCursoId;
    }

    const empresaUsuarioId = Number(this.empresaId || 0);
    const empresaFinal = empresaUsuarioId > 0 ? empresaUsuarioId : empresaCursoId;

    return empresaFinal > 0 ? empresaFinal : null;
  }

  private limpiarEstadoEmpleadosGuardados(): void {
    this.empleadosGuardadosEmpresa = [];
    this.empleadosGuardadosFiltrados = [];
    this.textoBusquedaEmpleadosGuardados = '';
    this.cargandoEmpleadosGuardados = false;
    this.mostrarPanelEmpleadosGuardados = false;
    this.puedeUsarMisEmpleados = false;
  }

  private esEmpleadoGuardadoActivo(empleado: any): boolean {
    const activoRaw = empleado?.activo;
    if (activoRaw === undefined || activoRaw === null) return true;
    if (typeof activoRaw === 'boolean') return activoRaw;
    return Number(activoRaw) === 1;
  }

  private construirNombreEmpleadoGuardado(empleado: any): string {
    const nombreBase = this.limpiarNombre(empleado?.nombre || '');
    const apellidoPaterno = this.limpiarNombre(empleado?.apellido_paterno || '');
    const apellidoMaterno = this.limpiarNombre(empleado?.apellido_materno || '');
    const nombreCompleto = this.construirNombreCompleto(nombreBase, apellidoPaterno, apellidoMaterno) || nombreBase;
    return this.autoAcentuar(nombreCompleto);
  }

  private obtenerIndiceFilaLibre(): number {
    return this.empleadosARegistrar.findIndex((empleado) =>
      !empleado.estaInscrito &&
      this.limpiarNombre(empleado.nombre).length === 0 &&
      this.limpiarCURP(empleado.curp).length === 0 &&
      this.limpiarPuesto(empleado.puesto).length === 0
    );
  }

  private normalizarBusqueda(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  actualizarNombreEmpleado(empleado: EmpleadoRegistro, valor: string): void {
    if (!empleado || empleado.estaInscrito) return;
    empleado.nombre = this.normalizarTextoInputEditable(valor);
  }

  autoAcentuarNombreEmpleado(empleado: EmpleadoRegistro): void {
    if (!empleado || empleado.estaInscrito) return;
    empleado.nombre = this.autoAcentuar(this.limpiarNombre(empleado.nombre));
  }

  actualizarPuestoEmpleado(empleado: EmpleadoRegistro, valor: string): void {
    if (!empleado || empleado.estaInscrito) return;
    empleado.puesto = this.normalizarTextoInputEditable(valor);
  }

  autoAcentuarPuestoEmpleado(empleado: EmpleadoRegistro): void {
    if (!empleado || empleado.estaInscrito) return;
    empleado.puesto = this.autoAcentuar(this.limpiarPuesto(empleado.puesto));
  }

  /**
   * Elimina una fila nueva (no inscrita) del formulario
   */
  eliminarEmpleado(index: number): void {
    if (this.empleadosARegistrar.length > 1) {
      this.empleadosARegistrar.splice(index, 1);
    }
  }

  /**
   * Desinscribe de la BD a un trabajador ya inscrito (soft-delete / activo=0)
   */
  desinscribirEmpleado(index: number): void {
    const empleado = this.empleadosARegistrar[index];
    if (!empleado?.inscripcion_id) return;

    Swal.fire({
      title: '¿Eliminar participante?',
      html: `<p>Se eliminará a <strong>${empleado.nombre}</strong> del curso.</p>
             <small class="text-muted">El participante se marcará como inactivo y dejará de aparecer en el pase de lista.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then(result => {
      if (!result.isConfirmed) return;

      this.backendServices.eliminarInscripcion(empleado.inscripcion_id!)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (resp: any) => {
            if (resp?.success) {
              this.empleadosARegistrar.splice(index, 1);
              // Si la lista queda vacía, agregar una fila vacía
              if (this.empleadosARegistrar.length === 0) {
                this.empleadosARegistrar.push({ nombre: '', curp: '', puesto: '', educacion: '', antiguedad: '' });
              }
              this.cargarCursosProgramadosBD();
              Swal.fire({
                title: 'Eliminado',
                text: resp.message || 'Participante eliminado correctamente.',
                icon: 'success',
                confirmButtonColor: '#38512F',
                timer: 2000,
                timerProgressBar: true
              });
            } else {
              Swal.fire('Error', resp?.message || 'No se pudo eliminar al participante.', 'error');
            }
          },
          error: (err: any) => {
            const msg = err?.error?.message || 'Error al conectar con el servidor.';
            Swal.fire('Error', msg, 'error');
          }
        });
    });
  }

  /**
   * Valida el formato de CURP
   * Formato: 4 letras + 6 dígitos + H/M/X + 5 letras + 1 alfanumérico + 1 dígito
   */
  validarCURP(curp: string): boolean {
    const curpLimpio = this.limpiarCURP(curp);
    // Acepta 18 chars (formato moderno) o 17 chars (pre-1997). X = género no binario.
    const regex18 = /^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[0-9A-Z][0-9]$/i;
    const regex17 = /^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[0-9A-Z]$/i;
    return regex18.test(curpLimpio) || regex17.test(curpLimpio);
  }

  /**
   * Obtiene el estilo del input de CURP según validación
   */
  getCURPInputStyle(curp: string): string {
    if (!curp || curp.length === 0) return '';
    return this.validarCURP(curp) ? 'border-color: #28a745;' : 'border-color: #dc3545;';
  }

  /** Empleado con nombre y CURP no vacíos (sin validar formato oficial) */
  empleadoCompletoParaRegistro(emp: EmpleadoRegistro): boolean {
    return this.limpiarNombre(emp.nombre).length > 0 && this.limpiarCURP(emp.curp).length > 0;
  }

  /**
   * Detecta CURPs duplicados en la lista actual
   */
  detectarCURPsDuplicados(): string[] {
    const curps = this.empleadosARegistrar
      .map(emp => this.limpiarCURP(emp.curp))
      .filter(curp => curp.length > 0);

    const duplicados = curps.filter((curp, index) => curps.indexOf(curp) !== index);
    return [...new Set(duplicados)]; // Retornar únicos
  }

  /**
   * Verifica si hay al menos un empleado válido y todos los que tienen datos son válidos
   * NOTA: Puesto es OPCIONAL
   */
  empleadosValidos(): boolean {
    // Filtrar solo empleados que tienen algún dato ingresado (nombre o curp)
    const empleadosConDatos = this.empleadosARegistrar.filter(emp =>
      emp.nombre.trim().length > 0 || emp.curp.trim().length > 0
    );

    // Debe haber al menos un empleado con datos
    if (empleadosConDatos.length === 0) return false;

    // Verificar que no haya CURPs duplicados
    if (this.detectarCURPsDuplicados().length > 0) return false;

    // Todos los empleados con datos deben tener nombre y CURP (puesto es opcional)
    return empleadosConDatos.every((emp) => this.empleadoCompletoParaRegistro(emp));
  }

  /**
   * Cuenta los empleados con datos completos (nombre + CURP)
   */
  contarEmpleadosValidos(): number {
    return this.empleadosARegistrar.filter((emp) => this.empleadoCompletoParaRegistro(emp)).length;
  }

  /**
   * Empleados nuevos (no inscritos) con nombre y CURP completos
   */
  obtenerEmpleadosNuevosParaRegistro(): EmpleadoRegistro[] {
    return this.empleadosARegistrar.filter(
      (emp) => !emp.estaInscrito && this.empleadoCompletoParaRegistro(emp)
    );
  }

  empleadoTieneDatosAdicionales(emp: EmpleadoRegistro): boolean {
    return this.opcionesEducacion.includes(emp.educacion || '')
      && this.opcionesAntiguedad.includes(emp.antiguedad || '');
  }

  /** Datos ya guardados previamente en BD (solo consulta, no modifica el formulario) */
  empleadoTieneDatosAdicionalesEnBD(emp: EmpleadoRegistro): boolean {
    return !!this.obtenerDatosAdicionalesCatalogo(emp.curp);
  }

  empleadoDatosAdicionalesListos(emp: EmpleadoRegistro): boolean {
    return this.empleadoTieneDatosAdicionalesEnBD(emp) || this.empleadoTieneDatosAdicionales(emp);
  }

  obtenerEmpleadosPendientesDatosAdicionales(): EmpleadoRegistro[] {
    return this.obtenerEmpleadosNuevosParaRegistro().filter(
      (emp) => !this.empleadoTieneDatosAdicionalesEnBD(emp)
    );
  }

  contarEmpleadosConDatosAdicionalesPrevios(): number {
    return this.obtenerEmpleadosNuevosParaRegistro().filter(
      (emp) => this.empleadoTieneDatosAdicionalesEnBD(emp)
    ).length;
  }

  private normalizarEducacionDB(valor: string | null | undefined): string {
    const limpio = String(valor || '').trim();
    return this.opcionesEducacion.includes(limpio) ? limpio : '';
  }

  private normalizarAntiguedadDB(valor: string | null | undefined): string {
    const limpio = String(valor || '').trim();
    return this.opcionesAntiguedad.includes(limpio) ? limpio : '';
  }

  private obtenerDatosAdicionalesCatalogo(curp: string): { educacion: string; antiguedad: string } | null {
    const curpLimpio = this.limpiarCURP(curp);
    if (!curpLimpio) return null;

    const guardado = this.empleadosGuardadosEmpresa.find(
      (emp) => this.limpiarCURP(emp.curp) === curpLimpio
    );
    if (!guardado) return null;

    const educacion = this.normalizarEducacionDB(guardado.educacion);
    const antiguedad = this.normalizarAntiguedadDB(guardado.antiguedad);
    if (!educacion || !antiguedad) return null;

    return { educacion, antiguedad };
  }

  /** Resuelve escolaridad/antigüedad solo al momento de registrar (formulario o BD previa) */
  private resolverDatosAdicionalesParaRegistro(emp: EmpleadoRegistro): { educacion: string; antiguedad: string } {
    const enFormulario = {
      educacion: this.normalizarEducacionDB(emp.educacion),
      antiguedad: this.normalizarAntiguedadDB(emp.antiguedad)
    };
    if (enFormulario.educacion && enFormulario.antiguedad) {
      return enFormulario;
    }

    const enCatalogo = this.obtenerDatosAdicionalesCatalogo(emp.curp);
    return {
      educacion: enFormulario.educacion || enCatalogo?.educacion || '',
      antiguedad: enFormulario.antiguedad || enCatalogo?.antiguedad || ''
    };
  }

  private continuarFlujoDatosAdicionales(): void {
    const pendientes = this.obtenerEmpleadosPendientesDatosAdicionales();

    // Todos ya tienen escolaridad/antigüedad en BD: omitir paso 2 y registrar directo
    if (pendientes.length === 0 && this.datosAdicionalesValidos()) {
      this.ejecutarRegistroEmpleados();
      return;
    }

    pendientes.forEach((emp) => {
      emp.educacion = '';
      emp.antiguedad = '';
    });

    this.errorRegistro = '';
    this.pasoRegistroEmpleados = 2;
  }

  /**
   * Avanza al paso 2: escolaridad y antigüedad por empleado
   */
  avanzarPasoDatosAdicionales(): void {
    this.empleadosARegistrar.forEach((empleado) => {
      if (empleado.estaInscrito) return;
      empleado.nombre = this.autoAcentuar(this.limpiarNombre(empleado.nombre));
      empleado.puesto = this.autoAcentuar(this.limpiarPuesto(empleado.puesto));
      empleado.curp = this.limpiarCURP(empleado.curp);
    });

    const curpsDuplicados = this.detectarCURPsDuplicados();
    if (curpsDuplicados.length > 0) {
      this.errorRegistro = `Se detectaron CURPs duplicados: ${curpsDuplicados.join(', ')}. Cada empleado debe tener un CURP único.`;
      return;
    }

    if (!this.empleadosValidos()) {
      this.errorRegistro = 'Por favor, complete nombre y CURP para cada empleado. El puesto es opcional.';
      return;
    }

    const nuevos = this.obtenerEmpleadosNuevosParaRegistro();
    if (nuevos.length === 0) {
      this.errorRegistro = 'No hay empleados nuevos para registrar. Agregue al menos uno con nombre y CURP.';
      return;
    }

    this.errorRegistro = '';
    this.enriqueciendoDatosAdicionales = true;

    const finalizar = () => {
      this.enriqueciendoDatosAdicionales = false;
      this.continuarFlujoDatosAdicionales();
    };

    if (this.empleadosGuardadosEmpresa.length > 0) {
      finalizar();
      return;
    }

    this.precargarCatalogoEmpleadosEmpresa(finalizar);
  }

  volverPasoDatosBasicos(): void {
    this.obtenerEmpleadosNuevosParaRegistro().forEach((emp) => {
      if (!this.empleadoTieneDatosAdicionalesEnBD(emp)) {
        emp.educacion = '';
        emp.antiguedad = '';
      }
    });
    this.pasoRegistroEmpleados = 1;
    this.errorRegistro = '';
  }

  datosAdicionalesValidos(): boolean {
    const nuevos = this.obtenerEmpleadosNuevosParaRegistro();
    if (nuevos.length === 0) return false;
    return nuevos.every((emp) => this.empleadoDatosAdicionalesListos(emp));
  }

  contarEmpleadosPendientesDatosAdicionales(): number {
    return this.obtenerEmpleadosPendientesDatosAdicionales().length;
  }

  contarEmpleadosNuevosValidos(): number {
    return this.obtenerEmpleadosNuevosParaRegistro().length;
  }

  calcularEdadDesdeCURP(curp: string): number | null {
    const curpLimpio = this.limpiarCURP(curp);
    if (curpLimpio.length < 10) return null;

    const yy = parseInt(curpLimpio.substring(4, 6), 10);
    const mm = parseInt(curpLimpio.substring(6, 8), 10);
    const dd = parseInt(curpLimpio.substring(8, 10), 10);
    if ([yy, mm, dd].some(Number.isNaN)) return null;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const hoy = new Date();
    const yyActual = hoy.getFullYear() % 100;
    const anioNacimiento = yy <= yyActual ? 2000 + yy : 1900 + yy;
    const fechaNac = new Date(anioNacimiento, mm - 1, dd);
    if (fechaNac.getFullYear() !== anioNacimiento || fechaNac.getMonth() !== mm - 1 || fechaNac.getDate() !== dd) {
      return null;
    }

    let edad = hoy.getFullYear() - anioNacimiento;
    const mesDiff = hoy.getMonth() - fechaNac.getMonth();
    if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < fechaNac.getDate())) {
      edad--;
    }
    return edad >= 0 && edad <= 120 ? edad : null;
  }

  /**
   * Registra los empleados en el curso
   */
  registrarEmpleados(): void {
    if (this.pasoRegistroEmpleados !== 2) {
      this.avanzarPasoDatosAdicionales();
      return;
    }

    this.ejecutarRegistroEmpleados();
  }

  private ejecutarRegistroEmpleados(): void {
    // Normalizar inputs manuales antes de validar/enviar para asegurar autoacentuado.
    this.empleadosARegistrar.forEach((empleado) => {
      if (empleado.estaInscrito) return;
      empleado.nombre = this.autoAcentuar(this.limpiarNombre(empleado.nombre));
      empleado.puesto = this.autoAcentuar(this.limpiarPuesto(empleado.puesto));
      empleado.curp = this.limpiarCURP(empleado.curp);
    });

    // Verificar CURPs duplicados primero
    const curpsDuplicados = this.detectarCURPsDuplicados();
    if (curpsDuplicados.length > 0) {
      this.errorRegistro = `Se detectaron CURPs duplicados: ${curpsDuplicados.join(', ')}. Cada empleado debe tener un CURP único.`;
      return;
    }

    if (!this.empleadosValidos()) {
      this.errorRegistro = 'Por favor, complete nombre y CURP para cada empleado. El puesto es opcional.';
      return;
    }

    const empresaIdRegistro = this.obtenerEmpresaIdObjetivoCurso();

    if (!this.cursoParaRegistro || !empresaIdRegistro) {
      this.errorRegistro = 'Error: No se pudo identificar el curso o la empresa.';
      return;
    }

    this.registrandoEmpleados = true;
    this.errorRegistro = '';

    // Filtrar solo empleados nuevos con datos completos
    const empleadosParaEnviar = this.obtenerEmpleadosNuevosParaRegistro();

    const payload = {
      empresa_id: empresaIdRegistro,
      empleados: empleadosParaEnviar.map(emp => {
        const datosAdicionales = this.resolverDatosAdicionalesParaRegistro(emp);
        return {
          nombre: this.limpiarNombre(emp.nombre),
          curp: this.limpiarCURP(emp.curp),
          puesto: this.limpiarPuesto(emp.puesto) || null,
          educacion: datosAdicionales.educacion,
          antiguedad: datosAdicionales.antiguedad
        };
      })
    };

    this.backendServices.registrarEmpleadosCurso(this.cursoParaRegistro.programado_id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {

          if (response && response.success) {
            // Capturar programadoId ANTES de cerrar el modal (cerrarModalEmpleados pone cursoParaRegistro = null)
            const programadoId = this.cursoParaRegistro?.programado_id;

            // Cerrar modal
            this.cerrarModalEmpleados();

            // Recargar datos del servidor para reflejar cambios reales
            this.cargarCursosProgramadosBD();

            // Construir mensaje detallado con HTML
            let htmlExtra = '';
            if (response.empleadosYaInscritos && response.empleadosYaInscritos.length > 0) {
              htmlExtra += `<div class="mt-2" style="color: #A8A9A2; font-size: 0.85rem;"><i class="fas fa-info-circle mr-1"></i>${response.empleadosYaInscritos.length} empleado(s) ya estaban inscritos.</div>`;
            }
            if (response.errores && response.errores.length > 0) {
              htmlExtra += construirHtmlErroresRegistro(response.errores);
            }
            if (response.advertencias && response.advertencias.length > 0) {
              htmlExtra += `<div class="mt-2" style="color: #f0ad4e; font-size: 0.85rem;"><i class="fas fa-exclamation-circle mr-1"></i>${response.advertencias.join('<br>')}</div>`;
            }

            // Generar y guardar la Lista de Asistencia SGC-F-33 en Drive (no bloquea)
            if (programadoId) {
              this.backendServices.generarSGCF33Drive(programadoId)
                .pipe(takeUntil(this.destroy$))
                .subscribe({
                  error: (err: any) => {
                    console.info('[SGC-F-33] Drive (respaldo):', err?.error?.message || err?.message);
                  }
                });

              // Generar y guardar la Lista SGC-F-33 VACÍA en Drive (misma carpeta, no bloquea)
              this.backendServices.generarSGCF33VaciaDrive(programadoId)
                .pipe(takeUntil(this.destroy$))
                .subscribe({
                  error: (err: any) => {
                    console.info('[SGC-F-33 Vacía] Drive:', err?.error?.message || err?.message);
                  }
                });

            }

            Swal.fire({
              title: 'Registro Exitoso!',
              html: `<p>${response.message || 'Empleados registrados correctamente.'}</p>${htmlExtra}<div class="mt-2" style="color: #38512F; font-size: 0.85rem;"><i class="fas fa-file-excel mr-1"></i>Se están guardando en Drive la lista SGC-F-33 (llena y vacía).</div>`,
              icon: 'success',
              confirmButtonColor: '#38512F',
              confirmButtonText: 'Entendido'
            });
          } else {
            const mensajeBase = traducirMensajeError(response?.message || 'Error al registrar empleados. Intente nuevamente.');
            const erroresTraducidos = response?.errores?.length
              ? traducirErroresLista(response.errores)
              : [];
            this.errorRegistro = erroresTraducidos.length > 0
              ? erroresTraducidos.join(' ')
              : mensajeBase;

            const htmlError = erroresTraducidos.length > 0
              ? `<p>${mensajeBase}</p>${construirHtmlErroresRegistro(response.errores)}`
              : mensajeBase;

            Swal.fire({
              title: 'No se pudo registrar',
              html: htmlError,
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        },
        error: (error) => {
          console.error('Error registrando empleados:', error);

          let mensajeError = 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.';
          if (error.status === 0) {
            mensajeError = 'No se pudo conectar con el servidor. Verifica tu conexión.';
          } else if (error.error?.message) {
            mensajeError = traducirMensajeError(error.error.message);
          } else if (error.error?.errores?.length) {
            mensajeError = traducirErroresLista(error.error.errores).join(' ');
          }

          this.errorRegistro = mensajeError;

          const htmlError = error.error?.errores?.length
            ? `<p>${mensajeError}</p>${construirHtmlErroresRegistro(error.error.errores)}`
            : mensajeError;

          Swal.fire({
            title: 'Error al registrar',
            html: htmlError,
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        },
        complete: () => {
          this.registrandoEmpleados = false;
        }
      });
  }

  /**
   * Abre el selector de archivo Excel
   */
  abrirSelectorExcel(fileInput: HTMLInputElement): void {
    if (!fileInput || this.excelCargando) return;
    fileInput.click();
  }

  /**
   * Maneja la selección de archivo Excel y autocompleta la tabla editable
   */
  async onArchivoExcelSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];

    if (!file) {
      return;
    }

    const extensionValida = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!extensionValida) {
      this.errorRegistro = 'Formato no válido. Sube un archivo .xlsx, .xls o .csv';
      input.value = '';
      return;
    }

    this.excelCargando = true;
    this.errorRegistro = '';

    try {
      const rows = await this.leerArchivoExcel(file);
      const resultado = this.extraerEmpleadosDesdeExcel(rows);
      this.resultadoImportacionExcel = resultado.resumen;

      if (resultado.empleados.length === 0) {
        this.errorRegistro = 'No se detectaron filas válidas para importar. Revisa columnas, CURP y filas vacías.';
        return;
      }

      this.empleadosARegistrar = resultado.empleados;

      const cupoDisponible = this.cursoParaRegistro
        ? Math.max(0, (this.cursoParaRegistro.cupo || 25) - (this.cursoParaRegistro.inscritos || 0))
        : 0;

      let html = `
        <div style="text-align:left; font-size:0.95rem;">
          <p style="margin-bottom:0.4rem;"><strong>${resultado.resumen.importadas}</strong> fila(s) importada(s) y listas para editar.</p>
          <p style="margin-bottom:0.35rem;">Columnas detectadas: <strong>${resultado.resumen.columnasDetectadas.join(', ')}</strong></p>
      `;

      if (resultado.resumen.filasDescartadas.length > 0) {
        html += construirHtmlFilasDescartadasExcel(resultado.resumen.filasDescartadas);
      } else if (resultado.resumen.invalidas > 0) {
        html += `<p style="margin-bottom:0.35rem; color:#fb6340;">${resultado.resumen.invalidas} fila(s) se descartaron por datos incompletos o inválidos.</p>`;
      }

      if (resultado.resumen.duplicadas > 0 && resultado.resumen.filasDescartadas.length === 0) {
        html += `<p style="margin-bottom:0.35rem; color:#f5365c;">${resultado.resumen.duplicadas} fila(s) duplicadas por CURP se omitieron.</p>`;
      }

      if (resultado.resumen.curpsCorregidos > 0) {
        html += `<p style="margin-bottom:0.35rem; color:#2dce89;">${resultado.resumen.curpsCorregidos} CURP(s) se normalizaron automáticamente.</p>`;
      }

      const curpsInvalidosImportados = resultado.empleados.filter((emp) => !this.validarCURP(emp.curp)).length;
      if (curpsInvalidosImportados > 0) {
        html += `<p style="margin-bottom:0.35rem; color:#f5365c;"><strong>${curpsInvalidosImportados} CURP(s) no cumplen el formato estándar y se cargaron para revisión.</strong></p>`;
      }

      if (cupoDisponible > 0 && resultado.resumen.importadas > cupoDisponible) {
        html += `<p style="margin-bottom:0.35rem; color:#5e72e4;">Importaste ${resultado.resumen.importadas} filas y el cupo disponible es ${cupoDisponible}. Puedes editar/eliminar antes de registrar.</p>`;
      }

      html += '</div>';

      const huboDescartes = resultado.resumen.filasDescartadas.length > 0;
      await Swal.fire({
        title: huboDescartes ? 'Excel cargado con observaciones' : 'Excel cargado',
        html,
        icon: huboDescartes ? 'warning' : 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (error: any) {
      console.error('Error procesando Excel:', error);
      const mensaje = traducirMensajeError(error?.message || 'No se pudo procesar el archivo Excel.');
      this.errorRegistro = mensaje;
      await Swal.fire({
        title: 'No se pudo importar el Excel',
        text: mensaje,
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.excelCargando = false;
      input.value = '';
    }
  }

  /**
   * Lee el archivo y devuelve todas las filas de la primera hoja
   */
  private leerArchivoExcel(file: File): Promise<any[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const arrayBuffer = e.target?.result;
          if (!arrayBuffer) {
            reject(new Error('No se pudo leer el contenido del archivo.'));
            return;
          }

          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          if (!worksheet) {
            reject(new Error('El archivo no contiene hojas válidas.'));
            return;
          }

          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            raw: false,
            blankrows: false
          });

          resolve(rows);
        } catch (err) {
          reject(new Error('No se pudo interpretar el archivo Excel.'));
        }
      };

      reader.onerror = () => reject(new Error('Error leyendo el archivo.'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Extrae empleados desde filas de Excel con detección flexible de encabezados
   */
  private extraerEmpleadosDesdeExcel(rows: any[][]): {
    empleados: EmpleadoRegistro[];
    resumen: ResumenImportacionExcel;
  } {
    if (!rows || rows.length === 0) {
      throw new Error('El archivo está vacío.');
    }

    if (rows.length > 5000) {
      throw new Error('El archivo es demasiado grande para procesar en pantalla (máximo 5000 filas).');
    }

    const columnas = this.detectarColumnasExcel(rows);
    const inicioDatos = this.encontrarInicioDatosParticipantes(rows, columnas);

    const hayColumnaNombre = columnas.nombre !== -1 || columnas.primerNombre !== -1;
    if (columnas.curp === -1 || !hayColumnaNombre) {
      throw new Error('No se pudieron detectar columnas requeridas. Asegura al menos CURP y una columna de Nombre (Nombre, Primer Nombre o similar).');
    }

    const empleados: EmpleadoRegistro[] = [];
    const curpsVistos = new Set<string>();
    const filasDescartadas: FilaDescartadaExcel[] = [];

    let totalFilasAnalizadas = 0;
    let invalidas = 0;
    let duplicadas = 0;
    let curpsCorregidos = 0;
    let filasVaciasConsecutivas = 0;

    const registrarFilaDescartada = (
      numeroFila: number,
      motivo: string,
      detalle?: string
    ): void => {
      filasDescartadas.push({ numeroFila, motivo, detalle });
    };

    for (let i = inicioDatos; i < rows.length; i++) {
      const row = rows[i] || [];
      const numeroFilaExcel = i + 1;

      const nombreCol = this.obtenerValorCeldaConVecinos(row, columnas.nombre);
      const primerNombreCol = this.obtenerValorCeldaConVecinos(row, columnas.primerNombre);
      const segundoNombreCol = this.obtenerValorCeldaConVecinos(row, columnas.segundoNombre);
      const apPat = columnas.apellidoPaterno !== columnas.nombre
        ? this.obtenerValorCeldaConVecinos(row, columnas.apellidoPaterno)
        : '';
      const apMat = columnas.apellidoMaterno !== columnas.nombre
        ? this.obtenerValorCeldaConVecinos(row, columnas.apellidoMaterno)
        : '';
      let curpRaw = this.obtenerValorCeldaConVecinos(row, columnas.curp);
      const puestoRaw = this.obtenerValorCeldaConVecinos(row, columnas.puesto);

      if (!this.pareceCURP(this.limpiarCURP(curpRaw))) {
        const curpEnFila = this.buscarCURPEnFila(row);
        if (curpEnFila) {
          curpRaw = curpEnFila;
        }
      }

      const nombreBase = this.unirPartesSinDuplicar([nombreCol, primerNombreCol, segundoNombreCol]);
      const nombre = this.construirNombreCompleto(nombreBase, apPat, apMat);
      const curpLimpio = this.limpiarCURP(curpRaw);
      let puesto = this.limpiarPuesto(puestoRaw);

      if (this.pareceParteDelNombre(puesto, [nombreCol, primerNombreCol, segundoNombreCol, apPat, apMat, nombre])) {
        puesto = '';
      }

      if (this.esFilaPiePlantilla(nombre, curpLimpio, puesto, row)) {
        break;
      }

      if (this.esFilaIgnorableSilenciosa(nombre, curpLimpio, puesto)) {
        continue;
      }

      const filaVacia = !nombre && !curpLimpio && !puesto;
      if (filaVacia) {
        filasVaciasConsecutivas++;
        if (filasVaciasConsecutivas >= 3 && empleados.length > 0) {
          break;
        }
        continue;
      }

      filasVaciasConsecutivas = 0;
      totalFilasAnalizadas++;

      if (this.esFilaNoData(nombre, curpLimpio, puesto)) {
        invalidas++;
        registrarFilaDescartada(numeroFilaExcel, 'Parece una fila de resumen o nota, no de empleado');
        continue;
      }

      // Descartar solo si no hay ni nombre ni CURP (fila verdaderamente vacía)
      if (!nombre && !curpLimpio) {
        invalidas++;
        registrarFilaDescartada(numeroFilaExcel, 'Faltan el nombre y el CURP');
        continue;
      }

      if (!nombre) {
        invalidas++;
        registrarFilaDescartada(
          numeroFilaExcel,
          'Falta el nombre completo',
          curpLimpio || String(curpRaw || '').trim() || undefined
        );
        continue;
      }
      if (!curpLimpio) {
        invalidas++;
        registrarFilaDescartada(numeroFilaExcel, 'Falta el CURP', nombre);
        continue;
      }

      if (curpsVistos.has(curpLimpio)) {
        duplicadas++;
        registrarFilaDescartada(
          numeroFilaExcel,
          'CURP repetido en el archivo',
          `${nombre} · ${curpLimpio}`
        );
        continue;
      }

      const curpOriginalNormalizada = String(curpRaw || '').toUpperCase().trim();
      if (curpLimpio !== curpOriginalNormalizada) {
        curpsCorregidos++;
      }

      curpsVistos.add(curpLimpio);

      // Auto-acentuar nombre y puesto con diccionario de nombres mexicanos
      const nombreAcentuado = this.autoAcentuar(nombre);
      const puestoAcentuado = this.autoAcentuar(puesto);

      empleados.push({ nombre: nombreAcentuado, curp: curpLimpio, puesto: puestoAcentuado, educacion: '', antiguedad: '' });
    }

    return {
      empleados,
      resumen: {
        totalFilasAnalizadas,
        importadas: empleados.length,
        validas: empleados.length,
        invalidas,
        duplicadas,
        curpsCorregidos,
        columnasDetectadas: columnas.columnasDetectadas,
        filasDescartadas
      }
    };
  }

  private detectarColumnasExcel(rows: any[][]): ColumnasDetectadasExcel {
    const aliases = {
      nombre: ['nombre', 'nombres', 'nombrecompleto', 'nomcompleto', 'fullname', 'fullnombre',
        'participante', 'nombreparticipante', 'nombretrabajador', 'nombreempleado',
        'nombrecolaborador', 'datosdelparticipante', 'nombresyapellidos',
        'nombrecompletodelparticipante', 'nombredelparticipante'],
      primerNombre: ['primernombre', 'nombre1', 'nombre01', '1ernombre', 'pnombre', 'nombredpila', 'firstname', 'givenname'],
      segundoNombre: ['segundonombre', 'nombre2', 'nombre02', '2donombre', 'snombre', 'middlename', 'secondname'],
      apellidoPaterno: ['apellidopaterno', 'apaterno', 'primerapellido', 'apellido1', 'paterno', 'lastname', 'surname'],
      apellidoMaterno: ['apellidomaterno', 'amaterno', 'segundoapellido', 'apellido2', 'materno'],
      curp: ['curp', 'curpempleado', 'curptrabajador', 'documentocurp', 'idcurp'],
      puesto: ['puesto', 'cargo', 'departamento', 'area', 'rol', 'posicion', 'funcion', 'jobtitle',
        'ocupacion', 'ocupacionespecifica', 'catalogonacionaldeocupaciones', 'actividad', 'categoria', 'perfil',
        'plaza', 'especialidad', 'profesion', 'oficio']
    };

    const maxHeaderScan = Math.min(rows.length, 35);
    let best: ColumnasDetectadasExcel = {
      headerIndex: -1,
      dataStartIndex: 0,
      nombre: -1,
      primerNombre: -1,
      segundoNombre: -1,
      apellidoPaterno: -1,
      apellidoMaterno: -1,
      curp: -1,
      puesto: -1,
      columnasDetectadas: []
    };
    let bestScore = -1;

    for (let rowIndex = 0; rowIndex < maxHeaderScan; rowIndex++) {
      const row = rows[rowIndex] || [];
      const candidate: ColumnasDetectadasExcel = {
        headerIndex: rowIndex,
        dataStartIndex: rowIndex + 1,
        nombre: -1,
        primerNombre: -1,
        segundoNombre: -1,
        apellidoPaterno: -1,
        apellidoMaterno: -1,
        curp: -1,
        puesto: -1,
        columnasDetectadas: []
      };

      row.forEach((cell, colIndex) => {
        const norm = this.normalizarTextoExcel(cell);
        if (!norm) return;
        const encabezadoEsIdentificador = this.esEncabezadoIdentificador(norm);
        const encabezadoEsNombreEspecifico =
          this.coincideAliasExcel(norm, aliases.primerNombre) ||
          this.coincideAliasExcel(norm, aliases.segundoNombre);

        if (!encabezadoEsIdentificador && candidate.primerNombre === -1 && this.coincideAliasExcel(norm, aliases.primerNombre)) candidate.primerNombre = colIndex;
        if (!encabezadoEsIdentificador && candidate.segundoNombre === -1 && this.coincideAliasExcel(norm, aliases.segundoNombre)) candidate.segundoNombre = colIndex;
        const encabezadoEsNombreCompleto = this.coincideAliasExcel(norm, aliases.nombre);

        if (!encabezadoEsIdentificador && !encabezadoEsNombreEspecifico && candidate.nombre === -1 && encabezadoEsNombreCompleto) candidate.nombre = colIndex;
        if (!encabezadoEsNombreCompleto && candidate.apellidoPaterno === -1 && this.coincideAliasExcel(norm, aliases.apellidoPaterno)) candidate.apellidoPaterno = colIndex;
        if (!encabezadoEsNombreCompleto && candidate.apellidoMaterno === -1 && this.coincideAliasExcel(norm, aliases.apellidoMaterno)) candidate.apellidoMaterno = colIndex;
        if (candidate.curp === -1 && this.coincideAliasExcel(norm, aliases.curp)) candidate.curp = colIndex;
        if (candidate.puesto === -1 && this.coincideAliasExcel(norm, aliases.puesto)) candidate.puesto = colIndex;
      });

      const score =
        (candidate.curp !== -1 ? 4 : 0) +
        (candidate.nombre !== -1 ? 3 : 0) +
        (candidate.primerNombre !== -1 ? 2 : 0) +
        (candidate.segundoNombre !== -1 ? 1 : 0) +
        (candidate.apellidoPaterno !== -1 ? 2 : 0) +
        (candidate.apellidoMaterno !== -1 ? 1 : 0) +
        (candidate.puesto !== -1 ? 1 : 0) +
        (rowIndex <= 2 ? 1 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    const candidateLooksHeader = best.headerIndex >= 0 && best.headerIndex <= 12;

    if (best.curp === -1 || (best.nombre === -1 && best.primerNombre === -1) || !candidateLooksHeader) {
      const inferred = this.inferirColumnasPorContenido(rows);
      best = {
        ...best,
        ...inferred,
        headerIndex: -1,
        dataStartIndex: 0
      };
    }

    if (best.apellidoPaterno === best.nombre) best.apellidoPaterno = -1;
    if (best.apellidoMaterno === best.nombre) best.apellidoMaterno = -1;

    const detectadas: string[] = [];
    if (best.curp !== -1) detectadas.push('CURP');
    if (best.nombre !== -1) detectadas.push('Nombre completo');
    if (best.primerNombre !== -1) detectadas.push('Primer nombre');
    if (best.segundoNombre !== -1) detectadas.push('Segundo nombre');
    if (best.apellidoPaterno !== -1 && best.apellidoPaterno !== best.nombre) detectadas.push('Apellido paterno');
    if (best.apellidoMaterno !== -1 && best.apellidoMaterno !== best.nombre) detectadas.push('Apellido materno');
    if (best.puesto !== -1) detectadas.push('Puesto/Cargo');

    best.columnasDetectadas = detectadas;
    return best;
  }

  private inferirColumnasPorContenido(rows: any[][]): Partial<ColumnasDetectadasExcel> {
    const sample = rows.slice(0, Math.min(rows.length, 250));
    const maxCols = sample.reduce((m, r) => Math.max(m, (r || []).length), 0);
    if (maxCols === 0) {
      return { nombre: -1, curp: -1, puesto: -1, apellidoPaterno: -1, apellidoMaterno: -1 };
    }

    const stats = Array.from({ length: maxCols }).map((_, col) => {
      let nonEmpty = 0;
      let curpMatches = 0;
      let alphaLike = 0;
      let avgLenAcc = 0;
      let puestoKeywordMatches = 0;

      const puestoKeywords = [
        'auxiliar', 'analista', 'coordinador', 'supervisor', 'gerente', 'director',
        'tecnico', 'operador', 'asistente', 'jefe', 'encargado', 'inspector',
        'capturista', 'administrativo', 'chofer', 'vigilante', 'instructor',
        'lider', 'ingeniero', 'soldador', 'mecanico', 'electricista', 'montacarguista',
        'almacenista', 'empacador', 'ayudante', 'obrero', 'intendente', 'seguridad',
        'produccion', 'calidad', 'mantenimiento', 'logistica', 'recibo', 'embarque',
        'maquinista', 'tornero', 'pintor', 'herramentista', 'programador', 'planeador'
      ];

      for (const row of sample) {
        const value = this.obtenerValorColumna(row || [], col);
        if (!value) continue;
        nonEmpty++;
        avgLenAcc += value.length;
        const curp = this.limpiarCURP(value);
        if (this.validarCURP(curp)) curpMatches++;
        if (/^[a-zA-ZÀ-ÿ\s.\-']+$/.test(value)) alphaLike++;

        const normVal = this.normalizarTextoExcel(value);
        if (puestoKeywords.some(keyword => normVal.includes(keyword))) {
          puestoKeywordMatches++;
        }
      }

      const avgLen = nonEmpty > 0 ? avgLenAcc / nonEmpty : 0;
      const curpRatio = nonEmpty > 0 ? curpMatches / nonEmpty : 0;
      const alphaRatio = nonEmpty > 0 ? alphaLike / nonEmpty : 0;
      const puestoKeywordRatio = nonEmpty > 0 ? puestoKeywordMatches / nonEmpty : 0;

      return { col, nonEmpty, curpMatches, avgLen, curpRatio, alphaRatio, puestoKeywordRatio };
    });

    const curpCandidate = [...stats]
      .filter(s => s.nonEmpty > 0)
      .sort((a, b) => b.curpRatio - a.curpRatio || b.curpMatches - a.curpMatches)[0];

    const curp = curpCandidate && curpCandidate.curpRatio >= 0.55 && curpCandidate.curpMatches >= 3
      ? curpCandidate.col
      : -1;

    const nombreCandidate = [...stats]
      .filter(s => s.col !== curp && s.nonEmpty > 0)
      .sort((a, b) => b.alphaRatio - a.alphaRatio || b.nonEmpty - a.nonEmpty)[0];

    const nombre = nombreCandidate && nombreCandidate.alphaRatio >= 0.45 ? nombreCandidate.col : -1;

    const puestoCandidate = [...stats]
      .filter(s => s.col !== curp && s.col !== nombre && s.nonEmpty > 0)
      .sort((a, b) => b.puestoKeywordRatio - a.puestoKeywordRatio || b.nonEmpty - a.nonEmpty)[0];

    const puesto = puestoCandidate && puestoCandidate.puestoKeywordRatio >= 0.2
      ? puestoCandidate.col
      : -1;

    return {
      nombre,
      primerNombre: -1,
      segundoNombre: -1,
      curp,
      puesto,
      apellidoPaterno: -1,
      apellidoMaterno: -1
    };
  }

  private encontrarInicioDatosParticipantes(rows: any[][], columnas: ColumnasDetectadasExcel): number {
    const limiteBusqueda = Math.min(rows.length, columnas.dataStartIndex + 20);

    for (let i = columnas.dataStartIndex; i < limiteBusqueda; i++) {
      const row = rows[i] || [];
      const curpRaw = this.obtenerValorCeldaConVecinos(row, columnas.curp) || this.buscarCURPEnFila(row);
      if (this.pareceCURP(this.limpiarCURP(curpRaw))) {
        return i;
      }
    }

    return columnas.dataStartIndex;
  }

  private pareceCURP(curp: string): boolean {
    if (!curp) return false;
    return /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[\dA-Z][\dA-Z]?$/i.test(curp);
  }

  private buscarCURPEnFila(row: any[]): string {
    for (const cell of row || []) {
      const curp = this.limpiarCURP(String(cell ?? ''));
      if (this.pareceCURP(curp)) {
        return curp;
      }
    }
    return '';
  }

  private esFilaIgnorableSilenciosa(nombre: string, curp: string, puesto: string): boolean {
    const texto = this.normalizarTextoExcel(`${nombre} ${curp} ${puesto}`);
    if (!texto) return true;

    const marcadoresIgnorar = [
      'instrucciones',
      'nombredelcurso',
      'fechadelcurso',
      'empresa',
      'codigo',
      'revision',
      'fecharev',
      'solicituddatosdelparticipante',
      'solicituddatos',
      'biznaga',
      'datosdecontactoparaenviarentregables',
      'datosdecontacto',
      'catalogonacionaldeocupaciones',
      'nombrecompletodelparticipante'
    ];

    if (marcadoresIgnorar.some((marcador) => texto.includes(marcador))) {
      return true;
    }

    const etiquetasPie = ['nombre', 'puesto', 'email', 'correo', 'telefono', 'tel', 'cel', 'notelcel'];
    const pareceEtiqueta = etiquetasPie.some((etiqueta) =>
      texto === etiqueta || texto.startsWith(`${etiqueta}:`) || texto.endsWith(etiqueta)
    );

    return pareceEtiqueta && !this.pareceCURP(curp);
  }

  private esFilaPiePlantilla(nombre: string, curp: string, puesto: string, row: any[]): boolean {
    const textoFila = this.normalizarTextoExcel((row || []).join(' '));
    const marcadoresFin = [
      'datosdecontactoparaenviarentregables',
      'datosdecontacto',
      'entregables',
      'firmadeconformidad',
      'firmadelresponsable'
    ];

    if (marcadoresFin.some((marcador) => textoFila.includes(marcador))) {
      return true;
    }

    const texto = this.normalizarTextoExcel(`${nombre} ${curp} ${puesto}`);
    return marcadoresFin.some((marcador) => texto.includes(marcador));
  }

  private esFilaNoData(nombre: string, curp: string, puesto: string): boolean {
    const joined = this.normalizarTextoExcel(`${nombre} ${curp} ${puesto}`);
    const marcadoresExactos = ['total', 'totales', 'subtotal', 'resumen', 'observacion', 'nota', 'na'];
    const marcadoresInicio = ['total', 'totales', 'subtotal', 'resumen', 'observacion'];

    if (marcadoresExactos.includes(joined)) {
      return true;
    }

    return marcadoresInicio.some((marcador) => joined.startsWith(marcador));
  }

  private limpiarCURP(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }

  private limpiarNombre(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private limpiarPuesto(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizarTextoInputEditable(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/\s{2,}/g, ' ');
  }

  private construirNombreCompleto(nombreCol: string, apPat: string, apMat: string): string {
    const nombreBase = this.limpiarNombre(nombreCol);
    const apPaterno = this.limpiarNombre(apPat);
    const apMaterno = this.limpiarNombre(apMat);

    if (!nombreBase && !apPaterno && !apMaterno) {
      return '';
    }

    const nombreNormalizado = this.normalizarTextoPlano(nombreBase);

    const apellidoNoRepetido = (apellido: string): string => {
      if (!apellido) return '';
      const apellidoNorm = this.normalizarTextoPlano(apellido);
      if (!apellidoNorm) return '';

      if (nombreNormalizado === apellidoNorm) return '';
      if (nombreNormalizado.includes(` ${apellidoNorm} `)) return '';
      if (nombreNormalizado.startsWith(`${apellidoNorm} `)) return '';
      if (nombreNormalizado.endsWith(` ${apellidoNorm}`)) return '';

      return apellido;
    };

    const apPatFinal = apellidoNoRepetido(apPaterno);
    const apMatFinal = apellidoNoRepetido(apMaterno);

    // Mantener el formato solicitado para participantes: APELLIDOS + NOMBRE(S)
    return this.limpiarNombre([apPatFinal, apMatFinal, nombreBase].filter(Boolean).join(' '));
  }

  private unirPartesSinDuplicar(partes: string[]): string {
    const resultado: string[] = [];

    for (const parte of partes) {
      const limpia = this.limpiarNombre(parte);
      if (!limpia) continue;

      const limpiaNorm = this.normalizarTextoPlano(limpia).trim();
      const yaIncluida = resultado.some(actual => {
        const actualNorm = this.normalizarTextoPlano(actual).trim();
        return actualNorm === limpiaNorm || actualNorm.includes(` ${limpiaNorm} `) || limpiaNorm.includes(` ${actualNorm} `);
      });

      if (!yaIncluida) {
        resultado.push(limpia);
      }
    }

    return this.limpiarNombre(resultado.join(' '));
  }

  private normalizarTextoPlano(value: string): string {
    return ` ${String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()} `;
  }

  private normalizarTextoExcel(value: any): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private coincideAliasExcel(valor: string, aliases: string[]): boolean {
    return aliases.some(alias =>
      valor === alias ||
      valor.includes(alias)
    );
  }

  private pareceParteDelNombre(puesto: string, partesNombre: string[]): boolean {
    const puestoNorm = this.normalizarTextoPlano(puesto).trim();
    if (!puestoNorm) return false;

    for (const parte of partesNombre) {
      const parteNorm = this.normalizarTextoPlano(parte || '').trim();
      if (!parteNorm) continue;

      if (parteNorm === puestoNorm) return true;
      if (parteNorm.includes(` ${puestoNorm} `)) return true;
    }

    return false;
  }

  private esEncabezadoIdentificador(valorNormalizado: string): boolean {
    const tokensIdentificador = [
      'idempleado',
      'noempleado',
      'numempleado',
      'numeroempleado',
      'numerodeempleado',
      'numerotrabajador',
      'numerodetrabajador',
      'matricula',
      'folio',
      'codigoempleado',
      'claveempleado',
      'employeeid',
      'idtrabajador',
      'idcolaborador',
      'idpersona',
      'nodetrabajador',
      'numdetrabajador'
    ];

    if (tokensIdentificador.some(token => valorNormalizado.includes(token))) {
      return true;
    }

    return valorNormalizado.startsWith('id') &&
      (valorNormalizado.includes('empleado') || valorNormalizado.includes('trabajador') || valorNormalizado.includes('colaborador') || valorNormalizado.includes('persona'));
  }

  private obtenerValorColumna(row: any[], colIndex: number): string {
    if (colIndex < 0 || colIndex >= row.length) return '';
    return String(row[colIndex] ?? '').trim();
  }

  private obtenerValorCeldaConVecinos(row: any[], colIndex: number, radio = 8): string {
    const directo = this.obtenerValorColumna(row, colIndex);
    if (directo || colIndex < 0) {
      return directo;
    }

    for (let offset = 1; offset <= radio; offset++) {
      const derecha = this.obtenerValorColumna(row, colIndex + offset);
      if (derecha) {
        return derecha;
      }
    }

    return '';
  }

  // ==================== AUTO-ACENTUACIÓN DE NOMBRES MEXICANOS ====================

  /**
   * Diccionario de acentuación para nombres, apellidos y puestos comunes en México.
   * Mapea la palabra en MAYÚSCULAS SIN ACENTO → forma correcta con acento.
   */
  private static readonly ACENTUACION_MX: { [key: string]: string } = {
    // === NOMBRES DE PILA (HOMBRE) ===
    'ADRIAN': 'ADRIÁN', 'ANDRES': 'ANDRÉS', 'ANGEL': 'ÁNGEL', 'ANIBAL': 'ANÍBAL',
    'BENJAMIN': 'BENJAMÍN', 'CESAR': 'CÉSAR', 'CRISTOBAL': 'CRISTÓBAL',
    'DARIO': 'DARÍO', 'EFRAIN': 'EFRAÍN', 'ELIAS': 'ELÍAS',
    'FABIAN': 'FABIÁN', 'FELIX': 'FÉLIX', 'FERMIN': 'FERMÍN',
    'GAMALIEL': 'GAMALIEL', 'GERMAN': 'GERMÁN',
    'HECTOR': 'HÉCTOR', 'HERNAN': 'HERNÁN', 'HIPOLITO': 'HIPÓLITO',
    'INES': 'INÉS', 'ISAAC': 'ISAAC', 'ISAIAS': 'ISAÍAS',
    'IVAN': 'IVÁN',
    'JERONIMO': 'JERÓNIMO', 'JESUS': 'JESÚS', 'JOAQUIN': 'JOAQUÍN',
    'JOSE': 'JOSÉ', 'JULIAN': 'JULIÁN',
    'LAZARO': 'LÁZARO',
    'MARTIN': 'MARTÍN', 'MAXIMO': 'MÁXIMO', 'MOISES': 'MOISÉS',
    'NEFTALI': 'NEFTALÍ', 'NESTOR': 'NÉSTOR', 'NICOLAS': 'NICOLÁS',
    'ONESIMO': 'ONÉSIMO', 'OSCAR': 'ÓSCAR',
    'RAMON': 'RAMÓN', 'RAUL': 'RAÚL', 'RENE': 'RENÉ', 'RUBEN': 'RUBÉN',
    'SAUL': 'SAÚL', 'SEBASTIAN': 'SEBASTIÁN', 'SIMON': 'SIMÓN',
    'TOMAS': 'TOMÁS', 'VALENTIN': 'VALENTÍN', 'VICTOR': 'VÍCTOR',
    // === NOMBRES DE PILA (MUJER) ===
    'AMERICA': 'AMÉRICA', 'ANGELICA': 'ANGÉLICA', 'BELEN': 'BELÉN',
    'CECILIA': 'CECILIA', 'CONCEPCION': 'CONCEPCIÓN',
    'FATIMA': 'FÁTIMA', 'GUADALUPE': 'GUADALUPE',
    'JAZMIN': 'JAZMÍN',
    'LUCIA': 'LUCÍA', 'MAGDALENA': 'MAGDALENA',
    'MARIA': 'MARÍA', 'MARIANA': 'MARIANA', 'MONICA': 'MÓNICA',
    'NATALIA': 'NATALIA', 'NOEMI': 'NOEMÍ',
    'ROCIO': 'ROCÍO', 'ROSA': 'ROSA',
    'SOFIA': 'SOFÍA', 'SOLEDAD': 'SOLEDAD',
    'VERONICA': 'VERÓNICA', 'VIRGINIA': 'VIRGINIA',
    // === APELLIDOS COMUNES CON ACENTO ===
    'ALARCON': 'ALARCÓN', 'ALCANTARA': 'ALCÁNTARA', 'ALVAREZ': 'ÁLVAREZ',
    'AVILA': 'ÁVILA', 'AVALOS': 'ÁVALOS',
    'BAEZ': 'BÁEZ', 'BELTRAN': 'BELTRÁN', 'BENITEZ': 'BENÍTEZ',
    'CARDENAS': 'CÁRDENAS', 'CARRION': 'CARRIÓN', 'CASTAÑON': 'CASTAÑÓN',
    'CHACON': 'CHACÓN', 'CHAVARRIA': 'CHAVARRÍA', 'CHAVEZ': 'CHÁVEZ', 'CORTES': 'CORTÉS',
    'DAVILA': 'DÁVILA', 'DIAZ': 'DÍAZ', 'DOMINGUEZ': 'DOMÍNGUEZ', 'DURAN': 'DURÁN',
    'ESCOBAR': 'ESCOBAR', 'ESPINDOLA': 'ESPÍNDOLA', 'ESQUIVEL': 'ESQUIVEL',
    'FERNANDEZ': 'FERNÁNDEZ', 'GALVAN': 'GALVÁN', 'GARATE': 'GÁRATE',
    'GARCIA': 'GARCÍA', 'GARRIDO': 'GARRIDO', 'GOMEZ': 'GÓMEZ',
    'GONZALEZ': 'GONZÁLEZ', 'GUDINO': 'GUDIÑO', 'GUTIERREZ': 'GUTIÉRREZ',
    'GUZMAN': 'GUZMÁN',
    'HENRIQUEZ': 'HENRÍQUEZ', 'HERNANDEZ': 'HERNÁNDEZ',
    'IBAÑEZ': 'IBÁÑEZ', 'JIMENEZ': 'JIMÉNEZ',
    'LEON': 'LEÓN', 'LOPEZ': 'LÓPEZ', 'LORENZO': 'LORENZO',
    'MALDONADO': 'MALDONADO', 'MARIN': 'MARÍN', 'MARQUEZ': 'MÁRQUEZ',
    'MARTINEZ': 'MARTÍNEZ', 'MELENDEZ': 'MELÉNDEZ', 'MENDEZ': 'MÉNDEZ',
    'MENDOZA': 'MENDOZA', 'MILLAN': 'MILLÁN', 'MONDRAGON': 'MONDRAGÓN',
    'MUÑIZ': 'MUÑIZ', 'MUÑOZ': 'MUÑOZ',
    'NARVAEZ': 'NARVÁEZ', 'NUÑEZ': 'NÚÑEZ',
    'ORDOÑEZ': 'ORDÓÑEZ', 'OROZCO': 'OROZCO', 'ORTIZ': 'ORTIZ',
    'PATIÑO': 'PATIÑO', 'PEÑA': 'PEÑA', 'PEREZ': 'PÉREZ', 'PIÑA': 'PIÑA',
    'RAMIREZ': 'RAMÍREZ', 'RENDON': 'RENDÓN', 'REVILLA': 'REVILLA',
    'RIOS': 'RÍOS', 'RIVERON': 'RIVERÓN', 'RODRIGUEZ': 'RODRÍGUEZ',
    'ROMAN': 'ROMÁN', 'RUIZ': 'RUIZ',
    'SAENZ': 'SÁENZ', 'SALDIVAR': 'SALDÍVAR', 'SANCHEZ': 'SÁNCHEZ', 'SANTILLAN': 'SANTILLÁN',
    'TELLEZ': 'TÉLLEZ', 'TOVAR': 'TOVAR',
    'VALDEZ': 'VALDÉZ', 'VALDES': 'VALDÉS', 'VAZQUEZ': 'VÁZQUEZ', 'VELAZQUEZ': 'VELÁZQUEZ',
    'YANEZ': 'YÁÑEZ',
    'ZARATE': 'ZÁRATE', 'ZUÑIGA': 'ZÚÑIGA',
    // === PALABRAS COMUNES EN PUESTOS / OCUPACIONES ===
    'TECNICO': 'TÉCNICO', 'TECNICA': 'TÉCNICA', 'MECANICO': 'MECÁNICO', 'MECANICA': 'MECÁNICA',
    'ELECTRICO': 'ELÉCTRICO', 'ELECTRICA': 'ELÉCTRICA', 'ELECTRONICO': 'ELECTRÓNICO',
    'ELECTRONICA': 'ELECTRÓNICA',
    'LIDER': 'LÍDER', 'LOGISTICA': 'LOGÍSTICA', 'LOGISTICO': 'LOGÍSTICO',
    'ALMACEN': 'ALMACÉN', 'PRODUCCION': 'PRODUCCIÓN',
    'ADMINISTRACION': 'ADMINISTRACIÓN', 'OPERACION': 'OPERACIÓN', 'OPERACIONES': 'OPERACIONES',
    'DIRECCION': 'DIRECCIÓN', 'SUPERVISIÓN': 'SUPERVISIÓN',
    'PLANEACION': 'PLANEACIÓN', 'COORDINACION': 'COORDINACIÓN',
    'CALIDAD': 'CALIDAD', 'MANTENIMIENTO': 'MANTENIMIENTO',
    'PREVENCION': 'PREVENCIÓN', 'PROTECCION': 'PROTECCIÓN',
    'RECEPCION': 'RECEPCIÓN', 'INSPECCION': 'INSPECCIÓN',
    'FABRICACION': 'FABRICACIÓN', 'DISTRIBUCION': 'DISTRIBUCIÓN',
    'AREA': 'ÁREA', 'LINEA': 'LÍNEA',
    'HIDRAULICO': 'HIDRÁULICO', 'HIDRAULICA': 'HIDRÁULICA',
    'NEUMATICO': 'NEUMÁTICO', 'NEUMATICA': 'NEUMÁTICA',
    'QUIMICO': 'QUÍMICO', 'QUIMICA': 'QUÍMICA',
    'BIOLOGO': 'BIÓLOGO', 'BIOLOGA': 'BIÓLOGA',
    'MEDICO': 'MÉDICO', 'MEDICA': 'MÉDICA',
    'INGENIERO': 'INGENIERO', 'INGENIERA': 'INGENIERA'
  };

  /**
   * Auto-acentúa un texto (nombre, apellido o puesto) usando el diccionario
   * de nombres mexicanos comunes. Trabaja palabra por palabra.
   * Preserva mayúsculas. Ejemplo: "RAMIREZ VAZQUEZ ROSENDO IVAN" → "RAMÍREZ VÁZQUEZ ROSENDO IVÁN"
   */
  private autoAcentuar(texto: string): string {
    if (!texto) return texto;
    return texto
      .split(/\s+/)
      .map(palabra => {
        // Quitar acentos existentes para buscar en diccionario (normalizar)
        const sinAcento = palabra
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase();
        return CursoActivoComponent.ACENTUACION_MX[sinAcento] || palabra;
      })
      .join(' ');
  }

  /**
   * Calcula el mínimo de inscritos requeridos para habilitar un curso.
   * Regla actual: sin mínimo, se puede gestionar desde que se crea el curso.
   */
  getMinimoRequerido(curso: any): number {
    return 0;
  }

  /**
   * Verifica si un curso cumple el mínimo de participantes para habilitar Gestionar
   */
  esCursoListo(curso: any): boolean {
    const inscritos = curso.inscritos || 0;
    return inscritos >= this.getMinimoRequerido(curso);
  }

  /**
   * Define cuándo aplica el bloqueo de mínimo inscritos para instructor.
   * - Instructor en contexto propio: SI aplica (incluso si también es admin).
   * - Instructor en contexto global (vista admin): NO aplica.
   * - Instructor sin doble vista (contexto único): aplica salvo admin/superadmin.
   */
  private aplicaBloqueoInstructorPorMinimo(contexto: 'propio' | 'global' | 'unico' = 'unico'): boolean {
    if (!this.esInstructor) return false;
    if (contexto === 'propio') return true;
    if (contexto === 'global') return false;
    return !this.esAdministradorOSuperior;
  }

  /**
   * Reglas de gestión:
   * - Sin mínimo de inscritos; la gestión depende de rol y estatus.
   */
  puedeGestionarCurso(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): boolean {
    if (this.aplicaBloqueoInstructorPorMinimo(contexto)) {
      return this.esCursoListo(curso);
    }

    if (this.esAdministradorOSuperior) {
      return true;
    }

    return this.esCursoListo(curso);
  }

  getTooltipGestionCurso(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): string {
    if (this.puedeGestionarCurso(curso, contexto)) {
      return 'Gestionar este curso';
    }

    if (this.aplicaBloqueoInstructorPorMinimo(contexto)) {
      return 'Bloqueado para instructor: requiere al menos 1 empleado registrado por la empresa';
    }

    return 'Requiere al menos 1 empleado registrado';
  }

  /**
   * Retorna el porcentaje de ocupación de un curso (0–100)
   */
  getPorcentajeOcupacion(curso: any): number {
    const inscritos = curso.inscritos || 0;
    const cupo = curso.cupo || 25;
    return Math.min((inscritos / cupo) * 100, 100);
  }

  /**
   * Retorna el porcentaje mínimo requerido para este curso
   */
  getPorcentajeMinimo(curso: any): number {
    const cupo = curso.cupo || 25;
    const minimo = this.getMinimoRequerido(curso);
    return Math.round((minimo / cupo) * 100);
  }

  /**
   * Formatea una fecha en formato DD/MM/YYYY
   */
  formatDate(fecha: string | Date): string {
    return formatearFechaDdmmaaaa(fecha);
  }

  /**
   * Abre el timeline del curso directamente (paso actual) para gestión operativa.
   * Empresa sigue yendo a gestionar-curso (solo consulta).
   */
  abrirTimelineCapacitacion(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): void {
    if (this.esEmpresa) {
      this.abrirGestionCurso(curso, contexto);
      return;
    }

    const esGestionAdminInstructor = curso?.estatus === 'programado' || curso?.estatus === 'en_curso';
    if (esGestionAdminInstructor && !this.puedeGestionarCurso(curso, contexto)) {
      Swal.fire({
        title: 'Curso bloqueado',
        text: this.getTooltipGestionCurso(curso, contexto),
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const pasoActual = this.getPasoTimelineActual(curso);
    const paso = pasoActual?.numero || 1;
    const vistaPropiaInstructor = contexto === 'propio' ||
      (contexto === 'unico' && this.esInstructor && !this.esAdministradorOSuperior && !this.esEmpresa);

    const navigationState: any = { curso };
    if (vistaPropiaInstructor && this.esAdministradorOSuperior) {
      navigationState.modoGestion = true;
    }

    this.router.navigate(['/timeline-curso'], {
      queryParams: { id: curso.programado_id, paso },
      state: navigationState
    });
  }

  /**
   * Abre la interfaz de gestión para instructores/admin
   * Los instructores van a timeline-curso, los demás a gestionar-curso
   */
  abrirGestionCurso(curso: any, contexto: 'propio' | 'global' | 'unico' = 'unico'): void {
    const esGestionAdminInstructor = !this.esEmpresa && (curso?.estatus === 'programado' || curso?.estatus === 'en_curso');
    if (esGestionAdminInstructor && !this.puedeGestionarCurso(curso, contexto)) {
      Swal.fire({
        title: 'Curso bloqueado',
        text: this.getTooltipGestionCurso(curso, contexto),
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const vistaPropiaInstructor = contexto === 'propio' ||
      (contexto === 'unico' && this.esInstructor && !this.esAdministradorOSuperior && !this.esEmpresa);
    const ruta = vistaPropiaInstructor ? '/timeline-curso' : '/gestionar-curso';

    // Navegar al componente correspondiente pasando el ID del curso y el estado completo
    // modoGestion: true indica que el admin está gestionando su propio curso como instructor
    const navigationState: any = { curso: curso };
    if (vistaPropiaInstructor && this.esAdministradorOSuperior) {
      navigationState.modoGestion = true;
    }
    this.router.navigate([ruta], {
      queryParams: { id: curso.programado_id },
      state: navigationState
    });
  }

  puedeEmpresaGestionarParticipantes(curso: any): boolean {
    if (!this.esEmpresa) return false;
    const estatus = curso?.estatus;
    return estatus === 'programado' || estatus === 'en_curso';
  }

  puedeAdministradorGestionarParticipantes(curso: any): boolean {
    if (!this.esAdministradorOSuperior) return false;
    const estatus = curso?.estatus;
    return estatus === 'programado' || estatus === 'en_curso';
  }

  /**
   * Elimina un curso programado (administrador o superior, requiere contraseña propia)
   */
  eliminarCursoProgramado(curso: any): void {
    if (!this.esAdministradorOSuperior) {
      Swal.fire({
        icon: 'error',
        title: 'Sin permisos',
        text: 'Solo los administradores pueden eliminar cursos.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    Swal.fire({
      title: '¿Eliminar este curso?',
      html: `
        <div style="text-align: left; margin-bottom: 1rem;">
          <p style="margin-bottom: 0.5rem;"><strong>${curso.nombre_curso}</strong></p>
          <small class="text-muted">${curso.nombre_empresa || 'Sin empresa'} · ${this.formatDate(curso.fecha_inicio)}</small>
          ${curso.inscritos > 0 ? `<div class="mt-2" style="color: #f5365c; font-size: 0.85rem;"><i class="fas fa-exclamation-triangle mr-1"></i>Se eliminarán <strong>${curso.inscritos} inscripción(es)</strong> asociadas.</div>` : ''}
        </div>
        <hr style="border-top: 1px solid #dee2e6;">
        <div style="text-align: left; margin-top: 1rem;">
          <label style="font-weight: 600; color: #1A1A1A; font-size: 0.9rem;">
            <i class="fas fa-lock mr-2" style="color: #38512F;"></i>
            Confirma tu contraseña:
          </label>
          <input type="text" id="passwordConfirmDelete" class="form-control mt-2" placeholder="Ingresa tu contraseña"
                 autocomplete="off" data-lpignore="true" data-form-type="other" data-1p-ignore
                 style="border: 2px solid #dee2e6; border-radius: 8px; padding: 0.6rem; -webkit-text-security: disc; text-security: disc;">
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      didOpen: () => {
        const pwInput = document.getElementById('passwordConfirmDelete') as HTMLInputElement;
        if (pwInput) {
          pwInput.focus();
        }
      },
      preConfirm: () => {
        const passwordInput = document.getElementById('passwordConfirmDelete') as HTMLInputElement;
        const password = passwordInput?.value;
        if (!password) {
          Swal.showValidationMessage('Debes ingresar tu contraseña');
          return false;
        }
        return password;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        // Verificar contraseña primero
        this.backendServices.verificarPassword(result.value)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (authResponse: any) => {
              if (!authResponse.success) {
                Swal.fire({
                  icon: 'error',
                  title: 'Contraseña incorrecta',
                  text: 'La contraseña ingresada no es correcta',
                  confirmButtonColor: '#38512F'
                });
                return;
              }

              // Contraseña correcta, proceder con la eliminación
              const token = this.authService.getToken();
              if (!token) {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Sesión expirada', confirmButtonColor: '#38512F' });
                return;
              }

              const actualizarBarra = (pct: number, texto?: string) => {
                const bar = document.getElementById('swal-prog-bar');
                const pctEl = document.getElementById('swal-prog-pct');
                const txEl = document.getElementById('swal-paso-txt');
                if (bar) bar.style.width = `${pct}%`;
                if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
                if (txEl && texto) txEl.textContent = texto;
              };

              Swal.fire({
                title: 'Eliminando curso',
                html: `
                  <p id="swal-paso-txt" style="color:#6c757d;font-size:0.88rem;margin-bottom:0.75rem;">Conectando...</p>
                  <div style="background:#e9ecef;border-radius:8px;overflow:hidden;height:12px;">
                    <div id="swal-prog-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#38512F,#768D6B);border-radius:8px;transition:width 0.4s ease;"></div>
                  </div>
                  <p id="swal-prog-pct" style="color:#38512F;font-weight:600;margin-top:0.4rem;font-size:0.85rem;">0%</p>
                `,
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false
              });

              const sseUrl = this.backendServices.getEliminarCursoStreamUrl(curso.programado_id, token);
              const sse = new EventSource(sseUrl);
              let lastProgress = 0;
              let completed = false;

              sse.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.error) {
                  sse.close();
                  Swal.fire({
                    icon: 'error',
                    title: 'Error al eliminar',
                    text: data.message || 'No se pudo eliminar el curso programado',
                    confirmButtonColor: '#38512F'
                  });
                  return;
                }

                if (data.progress !== undefined) {
                  lastProgress = data.progress;
                  actualizarBarra(data.progress, data.message);
                }

                if (data.done) {
                  completed = true;
                  sse.close();
                  actualizarBarra(100, 'Completado');

                  // Eliminar evento del calendario de Google
                  this.googleCalendarService.deleteEventsByCursoId(curso.programado_id)
                    .then(() => { })
                    .catch(() => { });

                  setTimeout(() => {
                    Swal.fire({
                      icon: 'success',
                      title: 'Curso eliminado',
                      html: `<p>${data.message || 'Curso eliminado correctamente'}</p>${(data.inscripcionesEliminadas ?? 0) > 0 ? `<small class="text-muted">${data.inscripcionesEliminadas} inscripción(es) eliminadas</small>` : ''}`,
                      confirmButtonColor: '#38512F',
                      timer: 2500
                    });
                  }, 400);
                  this.cargarCursosProgramadosBD();
                }
              };

              sse.onerror = () => {
                sse.close();
                if (completed) return;
                if (lastProgress > 50) {
                  // Si ya avanzó bastante, probablemente se completó pero se cortó la conexión
                  Swal.fire({
                    icon: 'warning',
                    title: 'Conexión interrumpida',
                    text: 'La eliminación pudo haberse completado. Recarga la página para verificar.',
                    confirmButtonColor: '#38512F'
                  });
                  this.cargarCursosProgramadosBD();
                } else {
                  Swal.fire({
                    icon: 'error',
                    title: 'Error de conexión',
                    text: 'Se perdió la conexión con el servidor. Intenta de nuevo.',
                    confirmButtonColor: '#38512F'
                  });
                }
              };
            },
            error: () => {
              Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'No se pudo verificar la contraseña',
                confirmButtonColor: '#38512F'
              });
            }
          });
      }
    });
  }

  ngOnDestroy(): void {
    this.guardarEstadoFiltros();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
