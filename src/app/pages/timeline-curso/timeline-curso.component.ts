import { Component, OnInit, OnDestroy, ElementRef, HostListener, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BackendServices } from '../../services/backend.services';
import { AuthService } from '../../services/auth.service';
import { HistorialPendientesService } from '../../services/historial-pendientes.service';
import { DocumentPreviewService } from '../../services/document-preview.service';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { SecurityContext } from '@angular/core';
import Swal from 'sweetalert2';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import Chart from 'chart.js';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import {
  formatearFechaCursoCortoEs,
  formatearFechaDdmmaaaa
} from 'src/app/utils/fecha.util';

interface EmpleadoEmpresaDisponible {
  empleado_id: number;
  nombre: string;
  curp: string;
  puesto: string;
  seleccionado: boolean;
  yaInscrito: boolean;
}

interface CursoSeleccionadoPaso8 {
  id: number;
  nombre: string;
  esActual: boolean;
}

interface EmpresaColaboradoraDoc {
  empresa_id: number;
  nombre_empresa: string;
  razon_social: string;
  rfc: string;
  es_principal: boolean;
  logo_url?: string;
}

interface InicioStatBar {
  label: string;
  count: number;
  pct: number;
  color: string;
  colorLight: string;
}

@Component({
  selector: 'app-timeline-curso',
  templateUrl: './timeline-curso.component.html',
  styleUrls: ['./timeline-curso.component.scss']
})
export class TimelineCursoComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private readonly timelinePasoStoragePrefix = 'timeline_paso_actual_';
  private readonly timelineDebugLogPrefix = 'timeline_debug_log_';
  private readonly timelineInformeDraftStoragePrefix = 'timeline_informe_borrador_';
  private readonly timelineCalificacionesDraftStoragePrefix = 'timeline_calificaciones_borrador_';
  private readonly timelineChecklistDraftStoragePrefix = 'timeline_checklist_borrador_';
  private autoInicioTimer: any = null;
  private autoCierreEncuestaTimer: any = null;

  cursoId: number | null = null;
  curso: any = null;
  loading: boolean = true;
  finalizandoCapacitacion = false;
  error: string = '';

  /**
   * true cuando el admin actual es el instructor asignado al curso.
   * En ese caso se prioriza el rol de instructor: puede gestionar todos los pasos
   * normalmente, pero conserva los permisos extra de admin (selección múltiple
   * de cursos en el paso 8 de Constancias y DC-3).
   */
  adminEnModoGestion: boolean = false;
  private readonly pasosAccesiblesAdminCursoAjeno: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10];

  // Datos del curso
  nombreCurso: string = '';
  empresaNombre: string = '';

  // Control de pasos
  pasoSeleccionado: number = 0; // 0 = ninguno seleccionado
  pasosCompletados: number[] = [];

  // Secciones del timeline
  seccionCapacitacion = { nombre: 'Capacitación', icono: 'fa-chalkboard-teacher', color: '#38512F' };
  seccionDocumentacion = { nombre: 'Examenes', icono: 'fa-folder-open', color: '#5e72e4' };

  pasosCurso = [
    // --- CAPACITACIÓN (durante el curso) ---
    { numero: 1, nombre: 'Inicio', icono: 'fa-play', descripcion: 'Iniciar el curso', seccion: 'capacitacion' },
    { numero: 2, nombre: 'Checklist', icono: 'fa-tasks', descripcion: 'Lista de verificación SP-F-08', seccion: 'capacitacion' },
    { numero: 3, nombre: 'Encuesta', icono: 'fa-poll', descripcion: 'Encuesta de satisfacción', seccion: 'capacitacion' },
    { numero: 4, nombre: 'Pase de lista', icono: 'fa-clipboard-check', descripcion: 'Registro de asistencia', seccion: 'capacitacion' },
    // --- DOCUMENTACIÓN (post-capacitación) ---
    { numero: 5, nombre: 'Examenes', icono: 'fa-file-alt', descripcion: 'Diagnóstico y evaluación final', seccion: 'documentacion' },
    { numero: 6, nombre: 'Evidencias', icono: 'fa-camera', descripcion: 'Fotos del curso', seccion: 'documentacion' },
    { numero: 7, nombre: 'Informe final', icono: 'fa-file-pdf', descripcion: 'Reporte de resultados', seccion: 'documentacion' },
    { numero: 8, nombre: 'Constancias y DC-3', icono: 'fa-certificate', descripcion: 'Generación de documentos', seccion: 'documentacion' },
    { numero: 10, nombre: 'Finalizado', icono: 'fa-check-circle', descripcion: 'Curso completado', seccion: 'documentacion' }
  ];

  // Lista de alumnos (cargada dinámicamente desde el backend)
  listaAlumnos: any[] = [];
  listaAlumnosPaseFiltrados: any[] = [];
  filtroPaseLista: string = '';
  filtroRapidoPaseLista: 'todos' | 'asistieron' | 'pendientes' = 'todos';
  paseListaToolbarCompacto: boolean = false;
  private paseListaToolbarEl: HTMLElement | null = null;
  cargandoParticipantes: boolean = false;
  mostrarEstadisticasInicio: boolean = false;
  estadisticasInicioParticipantes = {
    total: 0,
    educacion: [] as InicioStatBar[],
    antiguedad: [] as InicioStatBar[],
    edad: [] as InicioStatBar[],
    historialCurso: [] as InicioStatBar[]
  };
  calificacionFinalPaginaActual: number = 1;
  readonly calificacionFinalPorPagina: number = 10;
  busquedaCalificacionFinal: string = '';
  modoCapturaCalificacion: 'ambos' | 'teorico' | 'practico' = 'ambos';
  calificacionTabActiva: 'final' | 'diagnostico' = 'final';

  // Lista de materiales para el checklist (cargada dinámicamente desde BD)
  listaMateriales: any[] = [];
  checklistVerificacionItems: any[] = [];
  guardandoChecklistVerificacionDrive: boolean = false;
  checklistVerificacionArchivo: any = null;
  checklistOtroNuevoTexto: string = '';

  // Paso 2 - Checklist editor Google Sheets
  checklistEditorVisible: boolean = false;
  checklistEditorUrl: SafeResourceUrl | null = null;
  checklistEditorRawUrl: string = '';
  checklistGuardadoAviso: boolean = false;

  // Control de subida de documentos
  informeFinalSubido: File | null = null;
  cerrandoEncuesta: boolean = false;
  reactivandoEncuesta: boolean = false;

  // Paso 7 - Informe final (campos manuales + preview en vivo)
  informeFinalForm = {
    objetivos: [] as { texto: string; porcentaje: string; comentarios: string }[],
    expectativasTexto: '',
    expectativasPorcentaje: '100',
    expectativasComentarios: '',
    recomendacionesProceso: '',
    recomendacionesGrupo: '',
    areasOportunidad: '',
    mejoresPracticas: '',
    contingencias: '',
    accionCorrectiva: '',
    ajustesPrograma: '',
    sugerenciasParticipantes: '',
    totalHoras: ''
  };
  usarEmpresaComoSolicitante: boolean = false;
  personaSolicitanteManual: string = '';
  informeSeccionActiva: string | null = 'objetivos';
  informeFinalArchivoDrive: any = null;
  informeFinalPdfArchivoDrive: any = null;
  informeFinalEditorVisible: boolean = false;
  informeFinalEditorUrl: SafeResourceUrl | null = null;
  informeFinalEditorRawUrl: string = '';
  private editorPantallaCompletaScrollBloqueado: boolean = false;
  private editorPantallaCompletaOverflowBodyPrevio: string = '';
  private editorPantallaCompletaOverflowHtmlPrevio: string = '';
  private readonly editorModoDedicadoClase: string = 'timeline-editor-dedicated-open';
  informeEstructuraSugeridaCargada: boolean = false;
  private bloqueoScrollEditorActivo: boolean = false;
  private overflowBodyPrevio: string = '';
  private overflowHtmlPrevio: string = '';
  private bodyPositionPrevio: string = '';
  private bodyTopPrevio: string = '';
  private bodyWidthPrevio: string = '';
  private scrollPaginaPrevioBloqueo: number = 0;
  private editorScrollGuardY: number | null = null;
  private editorScrollGuardTs: number = 0;
  private editorScrollRestorePending: boolean = false;
  private editorScrollRestoreSource: 'visibility' | null = null;
  private readonly editorScrollGuardMaxAgeMs: number = 7000;
  private autosaveInformeBorradorTimer: any = null;
  private huellaInformeBorrador: string = '';
  private huellaCalificacionesBorrador: string = '';
  private huellaChecklistBorrador: string = '';
  private checklistEditorHostEl: HTMLElement | null = null;
  private informeFinalEditorHostEl: HTMLElement | null = null;
  private informeFotograficoEditorHostEl: HTMLElement | null = null;

  // Informe Fotográfico
  generandoInformeFotografico: boolean = false;
  informeFotograficoArchivo: any = null;
  informeFotograficoPdfArchivoDrive: any = null;
  informeFotograficoEditorVisible: boolean = false;
  informeFotograficoEditorUrl: SafeResourceUrl | null = null;
  informeFotograficoEditorRawUrl: string = '';
  descargandoInformeDesdeMenu: boolean = false;

  // Google Drive - cuenta activa
  googleDriveEmail: string | null = null;
  googleDriveNombre: string | null = null;
  googleDriveAuthOk: boolean = false;
  googleDriveAuthMethod: string = '';
  googleDriveAuthError: string | null = null;
  googleDriveAuthCargando: boolean = false;

  // Paso 8 - Constancias y DC-3
  firmaDocumento1Nombre: string = '';
  firmaDocumento1Cargo: string = 'Ejecutivo de sistemas de gestión y capacitación';
  firmaDocumento2Cargo: string = 'Instructor';
  firmaCalidadDriveId: string | null = null;
  firmaCalidadUrl: string | null = null;
  usarFirmaDigital: boolean = true;
  mostrarPuestosDc3: boolean = true;
  usarHorasBasePaso8: boolean = true;
  generandoDocumentosPaso8: boolean = false;
  progresoDocumentosPaso8: string = '';
  documentosGeneradosPaso8: boolean = false;
  descargandoZipPaso8: boolean = false;
  descargandoConstanciasCombinadasPaso8: boolean = false;
  descargandoDc3CombinadosPaso8: boolean = false;
  cursoGenerandoPaso8Nombre: string = '';
  cursosSeleccionadosPaso8Inicializado: boolean = false;
  liberarConstanciasPaso8: boolean = false;
  usaEmpresasColaboradorasPaso8: boolean = false;
  tieneGrupoColaboradorasPaso8: boolean = false;
  empresasColaboradorasPaso8: EmpresaColaboradoraDoc[] = [];
  cargandoColaboradorasPaso8: boolean = false;
  guardandoColaboradorasPaso8: boolean = false;
  private colaboradorasGuardarTimer: ReturnType<typeof setTimeout> | null = null;

  // Modal de asignación colaboradora (paso 8)
  alumnoModalPaso8: any = null;
  empresaModalSeleccionadaPaso8: number | null = null;
  cursosModalSeleccionadosPaso8: number[] = [];

  // Encuesta de satisfacción
  encuestaCursoUrl: string = '';
  encuestaEditUrl: string = '';
  cargandoEncuesta: boolean = false;
  encuestaStats: any = null;
  cargandoEncuestaStats: boolean = false;
  encuestaStatsError: string = '';
  encuestaStatsUltimaActualizacion: Date | null = null;
  private encuestaStatsTimer: any = null;
  private encuestaStatsRequestInFlight: boolean = false;
  private readonly encuestaStatsPollMs: number = 8000;
  private encuestaPieCharts: { [key: number]: Chart } = {};
  private readonly encuestaPalette: string[] = ['#5e72e4', '#2dce89', '#11cdef', '#fb6340', '#8965e0', '#f3a4b5', '#172b4d'];

  // Fotos de evidencia (Paso 6 - Evidencias)
  fotosEvidenciaArchivos: File[] = []; // Archivos seleccionados pendientes de subir
  fotosEvidenciaSubidas: any[] = []; // Fotos ya subidas a Drive (persistidas en BD)
  subiendoFotosEvidencia: boolean = false;
  eliminandoFotoId: number | null = null;
  arrastrandoFotos: boolean = false;
  private fotosEvidenciaPreview = new Map<File, SafeUrl>();
  private readonly maxFotosEvidencia = 20;

  // Lista de asistencia física (Paso 6)
  listaFisicaArchivo: File | null = null;
  listaFisicaSubida: any = null;
  subiendoListaFisica: boolean = false;
  arrastrandoListaFisica: boolean = false;

  // Paso 9 - Entrega de documentos (SP-F-03)
  entregaDocumentosGenerado: any = null;
  generandoEntregaDocumentos: boolean = false;
  entregaDocumentosFirmadoArchivo: File | null = null;
  entregaDocumentosFirmadoSubido: any = null;
  subiendoEntregaDocumentosFirmado: boolean = false;
  arrastrandoEntregaDocumentosFirmado: boolean = false;

  // Subida global de exámenes resueltos (PDF único)
  examenResueltoArchivo: File | null = null;
  examenResueltoSubido: any = null; // Info de Drive después de subir
  subiendoExamenResuelto: boolean = false;
  arrastrando: boolean = false;

  // Subida global de evaluaciones resueltas (PDF único)
  evaluacionResueltaArchivo: File | null = null;
  evaluacionResueltaSubida: any = null;
  subiendoEvaluacionResuelta: boolean = false;
  arrastrandoEvaluacion: boolean = false;
  paso5ErrorMensaje: string = '';

  // Documentos del curso desde Drive
  documentosCurso: any[] = [];
  cargandoDocumentos: boolean = false;

  // Documentos template del curso (examen diagnóstico y evaluación final en blanco) para paso 1
  examenDiagnosticoCurso: any = null;
  evaluacionFinalCurso: any = null;

  // Lista de asistencia SGC-F-33 (guardada en Drive al registrar empleados)
  listaAsistenciaDrive: any = null;
  listaAsistenciaVaciaDrive: any = null;
  listaAsistenciaModo: 'llena' | 'vacia' = 'llena';
  descargandoListaVacia: boolean = false;
  generandoListaVaciaDrive: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backendServices: BackendServices,
    private authService: AuthService,
    private historialPendientes: HistorialPendientesService,
    private documentPreview: DocumentPreviewService,
    private sanitizer: DomSanitizer
  ) { }

  // Métodos para identificar el tipo de perfil
  get esPerfilEmpresa(): boolean {
    return this.authService.esEmpresa();
  }

  get esPerfilInstructor(): boolean {
    return this.authService.esInstructor();
  }

  get esAdmin(): boolean {
    return this.authService.esAdministradorOSuperior();
  }

  /** El administrador puede gestionar todos los pasos reales del timeline, incluso en cursos ajenos. */
  esPasoAccesibleParaAdmin(numeroPaso: number): boolean {
    if (!this.esAdmin) return true;
    if (this.adminEnModoGestion) return true;
    return this.pasosAccesiblesAdminCursoAjeno.includes(numeroPaso);
  }

  /** Muestra el botón Editar para desbloquear pasos completados (instructores y administradores). */
  puedeMostrarBotonEditarPaso(): boolean {
    const paso = this.pasoSeleccionado;
    if (!this.isPasoCompletado(paso)) return false;
    if (paso === 10 || paso === 8 || paso === 7) return false;
    if (paso === 3 && this.encuestaStats?.cerrada) return false;
    return this.esPasoAccesibleParaAdmin(paso);
  }

  /**
   * Evalúa si el admin actual es el instructor asignado al curso.
   * Si lo es, activa `adminEnModoGestion = true` para que pueda gestionar el
   * curso como un instructor normal (todos los pasos accesibles), conservando
   * los permisos de admin del paso 8.
   * Se ejecuta cada vez que se carga/actualiza la información del curso.
   */
  private evaluarAdminEnModoGestion(): void {
    if (!this.esAdmin || !this.curso) {
      this.adminEnModoGestion = false;
      return;
    }

    const instructorIdSesion = Number(this.authService.getInstructorId() || 0);
    const instructorIdCurso = Number(
      this.curso?.instructor_id ?? this.curso?.instructorId ?? 0
    );

    this.adminEnModoGestion =
      instructorIdSesion > 0 &&
      instructorIdCurso > 0 &&
      instructorIdSesion === instructorIdCurso;
  }

  // Variables para la selección múltiple de cursos (Paso 8)
  cursosSeleccionadosPaso8: number[] = [];
  listaCursosDisponibles: any[] = [];
  cursosDisponiblesFiltradosPaso8: any[] = [];
  cursosSeleccionadosPaso8Info: CursoSeleccionadoPaso8[] = [];
  showCursosDropdownPaso8: boolean = false;
  cargandoCursosDisponibles: boolean = false;
  filtroTextoCursosPaso8: string = '';

  // ═══════════════════════════════════════════════════════════════════════
  // PASO 5 — Datos cacheados (NO usar getters para arrays en templates Angular;
  // cada getter crea una referencia nueva → *ngFor lo ve como cambio →
  // dispara nuevo ciclo de detección de cambios → loop infinito → browser muerto)
  // ═══════════════════════════════════════════════════════════════════════
  alumnosQueAsistieron: any[] = [];
  alumnosCalificacionFinalFiltrados: any[] = [];
  totalPaginasCalificacionFinal: number = 1;
  alumnosCalificacionFinalPaginados: any[] = [];
  alumnosCalificacionFinalPaginadosPares: any[][] = [];
  rangoInicioCalificacionFinal: number = 0;
  rangoFinCalificacionFinal: number = 0;

  /**
   * Recalcula TODOS los datos cacheados de paso 5 de una sola vez.
   * Llamar explícitamente cuando cambie:
   *   - listaAlumnos (cargarParticipantes, resetArrays)
   *   - alumno.asistio (guardarAsistencia)
   *   - busquedaCalificacionFinal
   *   - calificacionFinalPaginaActual
   */
  private recalcularDatosPaso5(): void {
    try {
      // 1. Asistentes
      const lista = Array.isArray(this.listaAlumnos) ? this.listaAlumnos : [];
      this.alumnosQueAsistieron = lista.filter(a => a && (a.asistio === true || a.asistio === 1));

      // 2. Filtrados por búsqueda
      const termino = (this.busquedaCalificacionFinal || '').trim().toLowerCase();
      this.alumnosCalificacionFinalFiltrados = !termino
        ? [...this.alumnosQueAsistieron]
        : this.alumnosQueAsistieron.filter(a => (a?.nombre || '').toLowerCase().includes(termino));

      // 3. Total de páginas
      const totalPags = Math.ceil(this.alumnosCalificacionFinalFiltrados.length / this.calificacionFinalPorPagina);
      this.totalPaginasCalificacionFinal = totalPags > 0 ? totalPags : 1;

      // 4. Ajustar página si quedó fuera de rango
      if (this.calificacionFinalPaginaActual > this.totalPaginasCalificacionFinal) {
        this.calificacionFinalPaginaActual = this.totalPaginasCalificacionFinal;
      }
      if (this.calificacionFinalPaginaActual < 1) {
        this.calificacionFinalPaginaActual = 1;
      }

      // 5. Página actual
      const offset = (this.calificacionFinalPaginaActual - 1) * this.calificacionFinalPorPagina;
      this.alumnosCalificacionFinalPaginados =
        this.alumnosCalificacionFinalFiltrados.slice(offset, offset + this.calificacionFinalPorPagina);

      // 6. Pares (filas de 2 columnas para la tabla)
      const pares: any[][] = [];
      for (let i = 0; i < this.alumnosCalificacionFinalPaginados.length; i += 2) {
        pares.push(this.alumnosCalificacionFinalPaginados.slice(i, i + 2));
      }
      this.alumnosCalificacionFinalPaginadosPares = pares;

      // 7. Rango textual "Mostrando X-Y de Z"
      this.rangoInicioCalificacionFinal = this.alumnosCalificacionFinalFiltrados.length === 0
        ? 0
        : offset + 1;
      const fin = this.calificacionFinalPaginaActual * this.calificacionFinalPorPagina;
      this.rangoFinCalificacionFinal = fin > this.alumnosCalificacionFinalFiltrados.length
        ? this.alumnosCalificacionFinalFiltrados.length
        : fin;

    } catch (error) {
      console.error('❌ [PASO5-recalc] Error recalculando datos paso 5:', error);
      this.alumnosQueAsistieron = [];
      this.alumnosCalificacionFinalFiltrados = [];
      this.totalPaginasCalificacionFinal = 1;
      this.alumnosCalificacionFinalPaginados = [];
      this.alumnosCalificacionFinalPaginadosPares = [];
      this.rangoInicioCalificacionFinal = 0;
      this.rangoFinCalificacionFinal = 0;
    }
  }

  ngOnInit(): void {
    this.inicializarInformeFinalForm();
    this.inicializarChecklistVerificacion();
    this.cargarPerfilResponsable(); // fallback endpoint, se sobreescribe con datos de cursos-programados

    // Intentar obtener el curso del estado de navegación (solo del Router, NO de history.state)
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state;

    if (state && state.curso && state.curso.programado_id) {
      // Si viene el curso completo en el estado del Router, usarlo directamente
      this.resetArrays();
      this.curso = state.curso;
      this.cursoId = state.curso.programado_id;
      this.nombreCurso = state.curso.nombre_curso || 'Curso sin nombre';
      this.empresaNombre = state.curso.nombre_empresa || 'Empresa sin nombre';
      this.evaluarAdminEnModoGestion();
      this.loading = false;
      this.restaurarPasoSeleccionado();
      this.preFillObjetivos();
      if (!this.informeFinalForm.totalHoras) {
        this.informeFinalForm.totalHoras = this.informeTotalHorasDefault;
      }
      this.sincronizarPersonaSolicitanteBase();
      this.restaurarInformeFinalBorradorLocal();
      this.restaurarChecklistBorradorLocal();
      this.iniciarAutoGuardadoInformeFinal();
      this.registrarTimelineLog('ngOnInit.routerState', { cursoId: this.cursoId, paso: this.pasoSeleccionado });
      this.cargarCursosDisponibles();
      // Cargar participantes y progreso del curso
      this.cargarParticipantes();
      this.cargarProgreso();
      this.cargarDocumentosCurso();
      this.cargarDocumentosProgramado();
      this.cargarChecklistCurso();
      this.cargarEncuestaConfig();
      this.cargarEmpresaContacto();
      this.cargarSugerenciaEstructuraInforme();
    } else {
      // Si no viene en el estado, intentar cargar por ID desde query params
      this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
        if (params['id']) {
          this.cursoId = +params['id'];
          this.resetArrays();
          this.restaurarInformeFinalBorradorLocal();
          this.restaurarChecklistBorradorLocal();
          this.iniciarAutoGuardadoInformeFinal();
          this.restaurarPasoSeleccionado();
          this.registrarTimelineLog('ngOnInit.queryParam', { cursoId: this.cursoId, paso: this.pasoSeleccionado });
          this.cargarCursosDisponibles(); // Cargar la lista para el Paso 8
          this.cargarDatosCurso();
        } else {
          this.error = 'No se proporcionó ID de curso';
          this.loading = false;
        }
      });
    }
  }

  cargarCursosDisponibles(): void {
    const requiereCatalogoCursos = this.esAdmin || this.tieneGrupoColaboradorasPaso8;
    if (!requiereCatalogoCursos && this.listaCursosDisponibles.length > 0) {
      return;
    }

    if (this.esAdmin) {
      this.cargandoCursosDisponibles = true;

      // Restaurar selección guardada antes de que el API responda
      const guardados = this.leerCursosSeleccionadosStorage();
      if (guardados.length > 0) {
        this.cursosSeleccionadosPaso8 = guardados;
        this.cursosSeleccionadosPaso8Inicializado = true;
      }
      this.liberarConstanciasPaso8 = this.leerLiberarConstanciasStorage();
    } else if (this.listaCursosDisponibles.length === 0) {
      this.cargandoCursosDisponibles = true;
    } else {
      return;
    }

    this.backendServices.cursos().subscribe({
        next: (res: any) => {
          if (res && Array.isArray(res.cursos)) {
            this.listaCursosDisponibles = res.cursos.map((c: any) => ({
              id: Number(c.curso_id ?? c.id),
              nombre: c.nombre_curso || c.nombre,
              horas: c.horas != null ? Number(c.horas) : null
            })).filter((c: any) => Number.isFinite(c.id));
          } else if (Array.isArray(res)) {
            this.listaCursosDisponibles = res.map((c: any) => ({
              id: Number(c.curso_id ?? c.id),
              nombre: c.nombre_curso || c.nombre,
              horas: c.horas != null ? Number(c.horas) : null
            })).filter((c: any) => Number.isFinite(c.id));
          }

          this.cursosDisponiblesFiltradosPaso8 = [...this.listaCursosDisponibles];
          this.normalizarCursosSeleccionadosPaso8();
          this.inicializarCursosSeleccionadosPaso8();
          this.cargandoCursosDisponibles = false;
        },
        error: (err) => {
          console.error('Error al cargar cursos para paso 8', err);
          this.cargandoCursosDisponibles = false;
        }
      });
  }

  private obtenerCursoCatalogoIdActual(): number | null {
    const raw = this.curso?.curso_id ?? this.curso?.cursoId ?? this.curso?.id;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  }

  get cursoCatalogoIdActual(): number | null {
    return this.obtenerCursoCatalogoIdActual();
  }

  private normalizarCursosSeleccionadosPaso8(): void {
    if (!Array.isArray(this.cursosSeleccionadosPaso8)) {
      this.cursosSeleccionadosPaso8 = [];
      this.actualizarCursosSeleccionadosPaso8Info();
      return;
    }

    const idsValidos = new Set((this.listaCursosDisponibles || []).map((c) => Number(c.id)));
    this.cursosSeleccionadosPaso8 = this.cursosSeleccionadosPaso8
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && (idsValidos.size === 0 || idsValidos.has(id)));
    this.actualizarCursosSeleccionadosPaso8Info();
  }

  private actualizarFiltroCursosPaso8(): void {
    const termino = (this.filtroTextoCursosPaso8 || '').trim().toLowerCase();
    const lista = Array.isArray(this.listaCursosDisponibles) ? this.listaCursosDisponibles : [];

    if (!termino) {
      this.cursosDisponiblesFiltradosPaso8 = [...lista];
      return;
    }

    this.cursosDisponiblesFiltradosPaso8 = lista.filter((curso) => {
      const nombre = String(curso?.nombre || '').toLowerCase();
      return nombre.includes(termino);
    });
  }

  onFiltroTextoCursosPaso8Change(valor: string): void {
    this.filtroTextoCursosPaso8 = valor || '';
    this.actualizarFiltroCursosPaso8();
    this.showCursosDropdownPaso8 = true;
  }

  mostrarCursosDropdownPaso8(): void {
    this.showCursosDropdownPaso8 = true;
  }

  ocultarCursosDropdownPaso8(): void {
    window.setTimeout(() => {
      this.showCursosDropdownPaso8 = false;
    }, 120);
  }

  private inicializarCursosSeleccionadosPaso8(): void {
    if (!this.esAdmin || this.cursosSeleccionadosPaso8Inicializado) {
      return;
    }

    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    if (!cursoActualId) {
      return;
    }

    if (this.cursosSeleccionadosPaso8.length === 0) {
      this.cursosSeleccionadosPaso8 = [cursoActualId];
    }

    this.actualizarCursosSeleccionadosPaso8Info();
    this.cursosSeleccionadosPaso8Inicializado = true;
  }

  onCursosSeleccionadosPaso8Change(): void {
    this.cursosSeleccionadosPaso8Inicializado = true;
    this.normalizarCursosSeleccionadosPaso8();
  }

  seleccionarTodosCursosPaso8(): void {
    const ids = (this.listaCursosDisponibles || []).map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
    this.cursosSeleccionadosPaso8 = [...new Set(ids)];
    this.cursosSeleccionadosPaso8Inicializado = true;
    this.actualizarCursosSeleccionadosPaso8Info();
  }

  toggleCursoActualSeleccionPaso8(): void {
    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    if (!cursoActualId) return;

    const seleccionados = this.cursosSeleccionadosPaso8.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    const existe = seleccionados.includes(cursoActualId);
    if (existe) {
      this.cursosSeleccionadosPaso8 = seleccionados.filter((id) => id !== cursoActualId);
    } else {
      this.cursosSeleccionadosPaso8 = [...seleccionados, cursoActualId];
    }

    this.cursosSeleccionadosPaso8Inicializado = true;
    this.actualizarCursosSeleccionadosPaso8Info();
  }

  limpiarCursosSeleccionadosPaso8(): void {
    this.cursosSeleccionadosPaso8 = [];
    this.cursosSeleccionadosPaso8Inicializado = true;
    this.actualizarCursosSeleccionadosPaso8Info();
  }

  isCursoSeleccionadoPaso8(id: number): boolean {
    if (!Array.isArray(this.cursosSeleccionadosPaso8)) return false;
    return this.cursosSeleccionadosPaso8.map((v) => Number(v)).includes(Number(id));
  }

  toggleSeleccionCursoPaso8(id: number, checked: boolean): void {
    const ids = (Array.isArray(this.cursosSeleccionadosPaso8) ? this.cursosSeleccionadosPaso8.map((v) => Number(v)) : []);
    const nid = Number(id);
    let nuevos = Array.from(ids);
    if (checked) {
      if (!nuevos.includes(nid)) nuevos.push(nid);
    } else {
      nuevos = nuevos.filter((x) => x !== nid);
    }
    this.cursosSeleccionadosPaso8 = nuevos;
    this.cursosSeleccionadosPaso8Inicializado = true;
    this.actualizarCursosSeleccionadosPaso8Info();
  }

  seleccionarCursoPaso8(curso: { id: number; nombre: string }): void {
    const id = Number(curso?.id);
    if (!Number.isFinite(id)) return;

    this.toggleSeleccionCursoPaso8(id, !this.isCursoSeleccionadoPaso8(id));
    this.filtroTextoCursosPaso8 = '';
    this.actualizarFiltroCursosPaso8();
    this.showCursosDropdownPaso8 = true;
  }

  private storageKeyCursosPaso8(): string {
    return `paso8_cursos_sel_${this.cursoId || 'global'}`;
  }

  private storageKeyLiberarPaso8(): string {
    return `paso8_liberar_${this.cursoId || 'global'}`;
  }

  toggleLiberarConstanciasPaso8(): void {
    this.liberarConstanciasPaso8 = !this.liberarConstanciasPaso8;
    try {
      localStorage.setItem(this.storageKeyLiberarPaso8(), this.liberarConstanciasPaso8 ? '1' : '0');
    } catch { /* storage no disponible */ }
  }

  private leerLiberarConstanciasStorage(): boolean {
    try {
      return localStorage.getItem(this.storageKeyLiberarPaso8()) === '1';
    } catch {
      return false;
    }
  }

  cargarColaboradorasDocumentosPaso8(): void {
    if (!this.cursoId) return;

    this.cargandoColaboradorasPaso8 = true;
    this.backendServices.obtenerColaboradorasDocumentos(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        this.tieneGrupoColaboradorasPaso8 = !!response?.tiene_grupo_colaboradoras;
        this.usaEmpresasColaboradorasPaso8 = !!response?.usa_empresas_colaboradoras;
        this.empresasColaboradorasPaso8 = Array.isArray(response?.empresas)
          ? response.empresas.map((empresa: any) => ({
            empresa_id: Number(empresa.empresa_id),
            nombre_empresa: empresa.nombre_empresa || '',
            razon_social: empresa.razon_social || empresa.nombre_empresa || '',
            rfc: empresa.rfc || '',
            es_principal: !!empresa.es_principal,
            logo_url: empresa.logo_url || empresa.logo || null
          })).filter((empresa: EmpresaColaboradoraDoc) => empresa.empresa_id > 0)
          : [];

        const asignaciones = Array.isArray(response?.asignaciones) ? response.asignaciones : [];
        if (asignaciones.length > 0 && Array.isArray(this.listaAlumnos) && this.listaAlumnos.length > 0) {
          const mapaAsignaciones = new Map(
            asignaciones.map((item: any) => [Number(item.inscripcion_id), item])
          );
          this.listaAlumnos.forEach((alumno) => {
            const asign: any = mapaAsignaciones.get(Number(alumno.inscripcion_id));
            if (!asign) return;
            alumno.empresa_documento_id = asign.empresa_documento_id != null
              ? Number(asign.empresa_documento_id)
              : null;
            const cursosIds = Array.isArray(asign.cursos_documento_ids)
              ? asign.cursos_documento_ids.map(Number).filter((id: number) => id > 0)
              : [];
            alumno.cursos_doc_ids = cursosIds.length > 0
              ? cursosIds
              : (asign.curso_documento_id != null ? [Number(asign.curso_documento_id)] : []);
            alumno.curso_documento_id = alumno.cursos_doc_ids[0] ?? null;
          });
        }

        this.cargandoColaboradorasPaso8 = false;
        if (this.tieneGrupoColaboradorasPaso8) {
          this.cargarCursosDisponibles();
        }
      },
      error: (err) => {
        console.error('Error cargando empresas colaboradoras paso 8:', err);
        this.cargandoColaboradorasPaso8 = false;
      }
    });
  }

  onUsaEmpresasColaboradorasChange(value: boolean): void {
    this.usaEmpresasColaboradorasPaso8 = value;

    if (this.usaEmpresasColaboradorasPaso8) {
      const empresaPrincipalId = this.obtenerEmpresaPrincipalColaboradorasId();
      const cursoActualId = this.obtenerCursoCatalogoIdActual();
      this.participantesAsistentesPaso8.forEach((alumno) => {
        if (!alumno.empresa_documento_id && empresaPrincipalId) {
          alumno.empresa_documento_id = empresaPrincipalId;
        }
        if (!alumno.curso_documento_id && cursoActualId) {
          alumno.curso_documento_id = cursoActualId;
        }
      });
    }

    this.programarGuardadoColaboradorasPaso8();
  }

  onAsignacionEmpresaColaboradoraChange(alumno: any, empresaId: number | null): void {
    alumno.empresa_documento_id = empresaId && Number(empresaId) > 0 ? Number(empresaId) : null;
    this.programarGuardadoColaboradorasPaso8();
  }

  onAsignacionCursoColaboradoraChange(alumno: any, cursoId: number | null): void {
    alumno.curso_documento_id = cursoId && Number(cursoId) > 0 ? Number(cursoId) : null;
    this.programarGuardadoColaboradorasPaso8();
  }

  private programarGuardadoColaboradorasPaso8(): void {
    if (!this.cursoId) return;
    if (this.colaboradorasGuardarTimer) {
      clearTimeout(this.colaboradorasGuardarTimer);
    }
    this.colaboradorasGuardarTimer = setTimeout(() => {
      this.guardarColaboradorasDocumentosPaso8();
    }, 500);
  }

  private guardarColaboradorasDocumentosPaso8(): Promise<boolean> {
    if (!this.cursoId) {
      return Promise.resolve(false);
    }

    const asignaciones = this.listaAlumnos
      .filter((alumno) => alumno?.inscripcion_id)
      .map((alumno) => {
        const cursosDocumentoIds = this.obtenerCursosDocumentoIdsAlumno(alumno);
        return {
          inscripcion_id: Number(alumno.inscripcion_id),
          empresa_documento_id: alumno.empresa_documento_id != null ? Number(alumno.empresa_documento_id) : null,
          curso_documento_id: cursosDocumentoIds[0] ?? null,
          cursos_documento_ids: cursosDocumentoIds
        };
      });

    this.guardandoColaboradorasPaso8 = true;
    return firstValueFrom(
      this.backendServices.guardarColaboradorasDocumentos(this.cursoId, {
        usa_empresas_colaboradoras: this.usaEmpresasColaboradorasPaso8,
        asignaciones
      }).pipe(takeUntil(this.destroy$))
    ).then((response: any) => {
      this.guardandoColaboradorasPaso8 = false;
      return !!response?.success;
    }).catch((error) => {
      console.error('Error guardando asignaciones colaboradoras:', error);
      this.guardandoColaboradorasPaso8 = false;
      return false;
    });
  }

  private obtenerEmpresaPrincipalColaboradorasId(): number | null {
    const principal = this.empresasColaboradorasPaso8.find((empresa) => empresa.es_principal);
    if (principal?.empresa_id) {
      return principal.empresa_id;
    }
    const empresaCursoId = Number(this.curso?.empresa_id || 0);
    return empresaCursoId > 0 ? empresaCursoId : null;
  }

  obtenerNombreEmpresaColaboradora(empresaId: number | null | undefined): string {
    const id = Number(empresaId || 0);
    if (!id) return 'Sin asignar';
    const empresa = this.empresasColaboradorasPaso8.find((item) => item.empresa_id === id);
    return empresa?.nombre_empresa || 'Empresa';
  }

  obtenerNombreCursoColaboradora(cursoId: number | null | undefined): string {
    const id = Number(cursoId || 0);
    if (!id) return 'Sin asignar';
    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    if (cursoActualId === id) {
      return this.nombreCurso || 'Curso actual';
    }
    const curso = this.listaCursosDisponibles.find((item) => Number(item.id) === id);
    return curso?.nombre || 'Curso';
  }

  private validarAsignacionesColaboradorasPaso8(): string | null {
    if (!this.usaEmpresasColaboradorasPaso8) {
      return null;
    }

    const asistentes = this.participantesAsistentesPaso8;
    const sinEmpresa = asistentes.filter((alumno) => !Number(alumno?.empresa_documento_id));
    if (sinEmpresa.length > 0) {
      return `Hay ${sinEmpresa.length} asistente(s) sin empresa asignada.`;
    }

    const sinCurso = asistentes.filter((alumno) => this.numeroCursosPaso8(alumno) === 0);
    if (sinCurso.length > 0) {
      return `Hay ${sinCurso.length} asistente(s) sin curso asignado para constancias/DC-3.`;
    }

    return null;
  }

  get mostrarPanelColaboradorasPaso8(): boolean {
    return this.tieneGrupoColaboradorasPaso8 || this.empresasColaboradorasPaso8.length >= 2;
  }

  get resumenColaboradorasPorEmpresaPaso8(): Array<{
    empresa: EmpresaColaboradoraDoc;
    total: number;
    cursoNombre: string;
  }> {
    if (!this.usaEmpresasColaboradorasPaso8) {
      return [];
    }

    return this.empresasColaboradorasPaso8
      .map((empresa) => {
        const asignados = this.participantesAsistentesPaso8.filter(
          (alumno) => Number(alumno?.empresa_documento_id) === empresa.empresa_id
        );
        const cursosUsados = new Set(
          asignados
            .map((alumno) => Number(alumno?.curso_documento_id))
            .filter((id) => id > 0)
        );
        let cursoNombre = 'Sin curso';
        if (cursosUsados.size === 1) {
          cursoNombre = this.obtenerNombreCursoColaboradora([...cursosUsados][0]);
        } else if (cursosUsados.size > 1) {
          cursoNombre = `${cursosUsados.size} cursos`;
        }

        return {
          empresa,
          total: asignados.length,
          cursoNombre
        };
      })
      .filter((item) => item.total > 0);
  }

  get totalAsistentesSinEmpresaColaboradoraPaso8(): number {
    return this.participantesAsistentesPaso8.filter((alumno) => !Number(alumno?.empresa_documento_id)).length;
  }

  get totalAsistentesSinCursoColaboradoraPaso8(): number {
    return this.participantesAsistentesPaso8.filter((alumno) => this.numeroCursosPaso8(alumno) === 0).length;
  }

  activarModoColaboradorasPaso8(): void {
    if (!this.usaEmpresasColaboradorasPaso8) {
      this.onUsaEmpresasColaboradorasChange(true);
    }
  }

  desactivarModoColaboradorasPaso8(): void {
    if (this.usaEmpresasColaboradorasPaso8) {
      this.onUsaEmpresasColaboradorasChange(false);
    }
  }

  seleccionarModoAsignacionPaso8(modo: 'cursos' | 'colaboradoras'): void {
    if (modo === 'colaboradoras') {
      if (!this.mostrarPanelColaboradorasPaso8 && !this.cargandoColaboradorasPaso8) {
        return;
      }
      if (!this.usaEmpresasColaboradorasPaso8) {
        this.onUsaEmpresasColaboradorasChange(true);
      }
      return;
    }
    if (this.usaEmpresasColaboradorasPaso8) {
      this.onUsaEmpresasColaboradorasChange(false);
    }
  }

  get mostrarSelectorModoAsignacionPaso8(): boolean {
    return this.mostrarPanelColaboradorasPaso8 || this.cargandoColaboradorasPaso8;
  }

  abreviarNombreCursoPaso8(nombre: string | null | undefined, max = 24): string {
    const texto = (nombre || '').trim();
    if (!texto) return 'Sin curso';
    if (texto.length <= max) return texto;
    return `${texto.slice(0, max - 1).trim()}…`;
  }

  obtenerTituloEmpresaColaboradora(alumno: any): string {
    const empresaId = Number(alumno?.empresa_documento_id);
    if (!empresaId) return 'Seleccione empresa';
    const empresa = this.empresasColaboradorasPaso8.find((e) => Number(e.empresa_id) === empresaId);
    if (!empresa) return 'Seleccione empresa';
    return empresa.rfc ? `${empresa.nombre_empresa} · RFC ${empresa.rfc}` : empresa.nombre_empresa;
  }

  obtenerTituloCursoColaboradora(alumno: any): string {
    const cursoId = Number(alumno?.curso_documento_id);
    if (!cursoId) return 'Seleccione curso';
    if (this.cursoCatalogoIdActual && cursoId === Number(this.cursoCatalogoIdActual)) {
      return `${this.nombreCurso || 'Curso actual'} (actual)`;
    }
    const curso = this.listaCursosDisponibles.find((c) => Number(c.id) === cursoId);
    return curso?.nombre || 'Curso seleccionado';
  }

  aplicarCursoATodosDeEmpresaColaboradora(empresaId: number, cursoId: number | null): void {
    const empresaNum = Number(empresaId);
    const cursoNum = cursoId != null ? Number(cursoId) : null;
    if (!empresaNum) return;

    this.participantesAsistentesPaso8.forEach((alumno) => {
      if (Number(alumno?.empresa_documento_id) === empresaNum) {
        if (cursoNum) {
          alumno.curso_documento_id = cursoNum;
        }
      }
    });
    this.programarGuardadoColaboradorasPaso8();
  }

  private guardarCursosSeleccionadosStorage(): void {
    try {
      localStorage.setItem(
        this.storageKeyCursosPaso8(),
        JSON.stringify(this.cursosSeleccionadosPaso8)
      );
    } catch { /* storage no disponible */ }
  }

  private leerCursosSeleccionadosStorage(): number[] {
    try {
      const raw = localStorage.getItem(this.storageKeyCursosPaso8());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((v: any) => Number(v)).filter((v) => Number.isFinite(v));
    } catch {
      return [];
    }
  }

  private actualizarCursosSeleccionadosPaso8Info(): void {
    const seleccionados = Array.isArray(this.cursosSeleccionadosPaso8) ? this.cursosSeleccionadosPaso8 : [];
    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    const nombres = new Map((this.listaCursosDisponibles || []).map((c) => [Number(c.id), c.nombre]));

    this.cursosSeleccionadosPaso8Info = seleccionados
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
      .map((id) => ({
        id,
        nombre: nombres.get(id) || (id === cursoActualId ? (this.nombreCurso || `Curso ${id}`) : `Curso ${id}`),
        esActual: id === cursoActualId
      }));

    this.guardarCursosSeleccionadosStorage();
  }

  get cursoActualSeleccionadoPaso8(): boolean {
    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    if (!cursoActualId) return false;
    return (this.cursosSeleccionadosPaso8Info || []).some((curso) => curso.id === cursoActualId);
  }

  private obtenerCursosPaso8Seleccionados(): CursoSeleccionadoPaso8[] {
    if (!this.esAdmin) {
      const cursoActualId = this.obtenerCursoCatalogoIdActual();
      if (!cursoActualId) return [];
      return [{
        id: cursoActualId,
        nombre: this.nombreCurso || `Curso ${cursoActualId}`,
        esActual: true
      }];
    }

    return this.cursosSeleccionadosPaso8Info;
  }

  /** Cargar datos del responsable de calidad desde la respuesta de cursos o endpoint dedicado */
  private cargarPerfilResponsable(responsable?: any): void {
    if (responsable) {
      this.aplicarResponsableCalidad(responsable);
      return;
    }
    // Fallback: endpoint dedicado si no vino en la respuesta de cursos
    this.backendServices.obtenerResponsableCalidad().subscribe({
      next: (res: any) => {
        if (res?.success && res.usuario) {
          this.aplicarResponsableCalidad(res.usuario);
        }
      },
      error: () => { }
    });
  }

  private aplicarResponsableCalidad(u: any): void {
    const nombre = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
    if (nombre) this.firmaDocumento1Nombre = nombre;
    if (u.firma_drive_id) this.firmaCalidadDriveId = u.firma_drive_id;
    if (u.firma_url) this.firmaCalidadUrl = u.firma_url;
  }

  private resetArrays(): void {
    this.listaAlumnos = [];
    this.listaAlumnosPaseFiltrados = [];
    this.filtroPaseLista = '';
    this.filtroRapidoPaseLista = 'todos';
    this.listaMateriales = [];
    this.checklistVerificacionItems = [];
    this.checklistVerificacionArchivo = null;
    this.checklistOtroNuevoTexto = '';
    this.documentosCurso = [];
    this.examenDiagnosticoCurso = null;
    this.evaluacionFinalCurso = null;
    this.listaAsistenciaDrive = null;
    this.listaAsistenciaVaciaDrive = null;
    this.listaAsistenciaModo = 'llena';
    this.entregaDocumentosGenerado = null;
    this.entregaDocumentosFirmadoArchivo = null;
    this.entregaDocumentosFirmadoSubido = null;
    this.fotosEvidenciaArchivos = [];
    this.fotosEvidenciaSubidas = [];
    this.limpiarPreviewsFotos();
    this.examenResueltoArchivo = null;
    this.examenResueltoSubido = null;
    this.evaluacionResueltaArchivo = null;
    this.evaluacionResueltaSubida = null;
    this.informeFinalSubido = null;
    this.checklistEditorVisible = false;
    this.checklistEditorUrl = null;
    this.checklistEditorRawUrl = '';
    this.informeFinalEditorVisible = false;
    this.informeFotograficoEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.informeEstructuraSugeridaCargada = false;
    this.encuestaCursoUrl = '';
    this.encuestaEditUrl = '';
    this.limpiarAutoInicioTimer();
    this.limpiarAutoCierreEncuestaTimer();
    this.pasosCompletados = [];
    this.pasoSeleccionado = 0;
    this.usarEmpresaComoSolicitante = false;
    this.personaSolicitanteManual = '';
    this.huellaInformeBorrador = '';
    this.huellaCalificacionesBorrador = '';
    this.huellaChecklistBorrador = '';
    this.cursosSeleccionadosPaso8 = [];
    this.listaCursosDisponibles = [];
    this.cursosSeleccionadosPaso8Info = [];
    this.cursosSeleccionadosPaso8Inicializado = false;
    this.cursoGenerandoPaso8Nombre = '';
    this.error = '';
    this.recalcularDatosPaso5();
    this.inicializarChecklistVerificacion();
  }

  ngOnDestroy(): void {
    this.guardarInformeFinalBorradorLocal(true);
    this.guardarCalificacionesBorradorLocal();
    this.guardarChecklistBorradorLocal();
    this.detenerAutoGuardadoInformeFinal();
    this.cerrarEditorIntegradoPaso7();
    this.desactivarBloqueoScrollPagina();
    this.detenerAutoRefreshEncuestaStats();
    this.destruirEncuestaPieCharts();
    this.limpiarPreviewsFotos();
    this.limpiarAutoInicioTimer();
    this.limpiarAutoCierreEncuestaTimer();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @ViewChild('paseListaToolbar')
  set setPaseListaToolbarRef(ref: ElementRef<HTMLElement> | undefined) {
    this.paseListaToolbarEl = ref?.nativeElement || null;
    this.actualizarEstadoToolbarPaseLista();
  }

  @ViewChild('checklistEditorHost')
  set setChecklistEditorHostRef(ref: ElementRef<HTMLElement> | undefined) {
    this.checklistEditorHostEl = ref?.nativeElement || null;
    if (this.pasoSeleccionado === 2 && this.checklistEditorVisible) {
      this.actualizarAnclaScrollEditor();
    }
  }

  @ViewChild('informeFinalEditorHost')
  set setInformeFinalEditorHostRef(ref: ElementRef<HTMLElement> | undefined) {
    this.informeFinalEditorHostEl = ref?.nativeElement || null;
    if (this.pasoSeleccionado === 7 && this.informeFinalEditorVisible) {
      this.actualizarAnclaScrollEditor();
    }
  }

  @ViewChild('informeFotograficoEditorHost')
  set setInformeFotograficoEditorHostRef(ref: ElementRef<HTMLElement> | undefined) {
    this.informeFotograficoEditorHostEl = ref?.nativeElement || null;
    if (this.pasoSeleccionado === 7 && this.informeFotograficoEditorVisible) {
      this.actualizarAnclaScrollEditor();
    }
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onWindowScrollResize(): void {
    this.actualizarEstadoToolbarPaseLista();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    // No-op: se desactiva el guard de scroll del editor para evitar saltos automáticos.
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    // No-op: se desactiva el guard de scroll del editor para evitar saltos automáticos.
  }

  @HostListener('document:visibilitychange')
  onDocumentVisibilityChange(): void {
    // No-op: deshabilitado el auto-reacomodo de scroll al cambiar visibilidad.
  }

  private actualizarEstadoToolbarPaseLista(): void {
    if (this.pasoSeleccionado !== 4 || !this.paseListaToolbarEl) {
      this.paseListaToolbarCompacto = false;
      return;
    }

    const stickyTop = window.innerWidth <= 768 ? 56 : 68;
    const rect = this.paseListaToolbarEl.getBoundingClientRect();
    this.paseListaToolbarCompacto = rect.top <= stickyTop + 1;
  }

  private hayEditorIntegradoVisible(): boolean {
    const checklistActivo = this.pasoSeleccionado === 2 && this.checklistEditorVisible;
    const informeFinalActivo = this.pasoSeleccionado === 7 && this.informeFinalEditorVisible;
    const informeFotograficoActivo = this.pasoSeleccionado === 7 && this.informeFotograficoEditorVisible;
    return checklistActivo || informeFinalActivo || informeFotograficoActivo;
  }

  private getWindowScrollY(): number {
    return window.scrollY || window.pageYOffset || 0;
  }

  private getEditorHostActivo(): HTMLElement | null {
    if (this.pasoSeleccionado === 2 && this.checklistEditorVisible) {
      return this.checklistEditorHostEl;
    }
    if (this.pasoSeleccionado === 7 && this.informeFinalEditorVisible) {
      return this.informeFinalEditorHostEl;
    }
    if (this.pasoSeleccionado === 7 && this.informeFotograficoEditorVisible) {
      return this.informeFotograficoEditorHostEl;
    }
    return null;
  }

  private getAnclaEditorActualY(): number {
    const currentY = this.getWindowScrollY();
    const hostEl = this.getEditorHostActivo();
    if (!hostEl) {
      return currentY;
    }

    const editorTopAbs = currentY + hostEl.getBoundingClientRect().top;
    const anchorY = Math.max(0, Math.round(editorTopAbs - 20));
    return Math.max(anchorY, currentY);
  }

  private sincronizarBloqueoScrollEditor(): void {
    // No-op: mantener scroll totalmente libre para evitar reacomodos al editar en iframe.
  }

  private actualizarAnclaScrollEditor(): void {
    // No-op: se elimina anclaje automático de scroll del editor embebido.
  }

  private limpiarRestauracionScrollEditorPendiente(): void {
    this.editorScrollRestorePending = false;
    this.editorScrollRestoreSource = null;
  }

  private prepararRestauracionScrollEditor(source: 'visibility' = 'visibility'): void {
    this.editorScrollRestorePending = false;
    this.editorScrollRestoreSource = null;
  }

  private restaurarScrollEditorSiSalto(): void {
    this.limpiarRestauracionScrollEditorPendiente();
  }

  cargarDatosCurso(): void {
    if (!this.cursoId) return;
    this.loading = true;


    this.backendServices.obtenerCursosProgramados().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        const cursos = response.cursosProgramados || response;
        const encontrado = (Array.isArray(cursos) ? cursos : []).find(
          (c: any) => c.programado_id === this.cursoId
        );

        // Cargar responsable de calidad desde la respuesta (robusto, sin endpoint extra)
        if (response.responsableCalidad) {
          this.cargarPerfilResponsable(response.responsableCalidad);
        }

        if (encontrado) {
          this.curso = encontrado;
          this.mostrarPuestosDc3 = true;
          this.nombreCurso = encontrado.nombre_curso || 'Curso sin nombre';
          this.empresaNombre = encontrado.nombre_empresa || 'Empresa sin nombre';
          this.evaluarAdminEnModoGestion();
          // Re-evaluar paso seleccionado ahora que sabemos si el admin está
          // gestionando su propio curso (puede acceder a pasos distintos al 8)
          this.restaurarPasoSeleccionado();
          this.inicializarCursosSeleccionadosPaso8();
          this.actualizarCursosSeleccionadosPaso8Info();
          this.restaurarPasoSeleccionado();
          this.preFillObjetivos();
          if (!this.informeFinalForm.totalHoras) {
            this.informeFinalForm.totalHoras = this.informeTotalHorasDefault;
          }
          this.sincronizarPersonaSolicitanteBase();
          this.restaurarInformeFinalBorradorLocal();
          this.restaurarChecklistBorradorLocal();
          this.registrarTimelineLog('cargarDatosCurso.encontrado', { cursoId: this.cursoId, paso: this.pasoSeleccionado });
          // Cargar participantes y progreso del curso
          this.cargarParticipantes();
          this.cargarProgreso();
          this.cargarDocumentosCurso();
          this.cargarDocumentosProgramado();
          this.cargarChecklistCurso();
          this.cargarEncuestaConfig();
          this.cargarEmpresaContacto();
          this.cargarSugerenciaEstructuraInforme();
        } else {
          this.error = 'Curso no encontrado';
          console.error('❌ Curso no encontrado con ID:', this.cursoId);
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Error al cargar el curso';
        console.error('❌ Error cargando curso:', err);
        this.loading = false;
      }
    });
  }

  onMostrarPuestosChange(value: boolean): void {
    if (!this.cursoId) return;

    const payload: any = { usar_puesto_real_dc3: value };
    this.backendServices.actualizarCursoProgramado(this.cursoId, payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        if (!res || !res.success) {
          this.mostrarPuestosDc3 = !value;
          Swal.fire({
            title: 'Error',
            text: res?.message || 'No se pudo guardar la preferencia',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      },
      error: (err) => {
        this.mostrarPuestosDc3 = !value;
        console.error('Error guardando preferencia de puestos DC-3:', err);
        Swal.fire({
          title: 'Error',
          text: 'No se pudo guardar la preferencia',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  // Cargar participantes del curso desde el backend
  cargarParticipantes(): void {
    if (!this.cursoId) return;

    this.cargandoParticipantes = true;

    this.backendServices.obtenerParticipantesCurso(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.participantes) {
          // Transformar los datos del backend al formato esperado por el componente
          this.listaAlumnos = response.participantes.map((p: any) => ({
            inscripcion_id: p.inscripcion_id,
            id: p.empleado_id,
            nombre: this.formatearNombreCompleto(p),
            nombre_base: p.nombre || '',
            apellido_paterno: p.apellido_paterno || '',
            apellido_materno: p.apellido_materno || '',
            nombre_completo_bd: p.nombre_completo || '',
            curp: p.curp,
            puesto: p.puesto,
            educacion: p.educacion || '',
            antiguedad: p.antiguedad || '',
            edad: p.edad != null ? Number(p.edad) : this.calcularEdadDesdeCURP(p.curp || ''),
            cursos_tomados: this.parseCursosTomadosEmpleado(p.cursos_tomados),
            asistio: p.asistio === 1,
            nota: p.notas || '',
            // Evita replicar la nota en el otro campo al refrescar cuando solo se capturó escrita o práctica.
            calificacionTeorica: p.calificacion_teorica !== null && p.calificacion_teorica !== undefined
              ? Number(p.calificacion_teorica).toFixed(1)
              : '',
            calificacionPractica: p.calificacion_practica !== null && p.calificacion_practica !== undefined
              ? Number(p.calificacion_practica).toFixed(1)
              : '',
            calificacionDiag: p.calificacion_diagnostica !== null && p.calificacion_diagnostica !== undefined
              ? Number(p.calificacion_diagnostica).toFixed(1) : '',
            requiereDC3: false,
            examenDiagnostico: null,
            evaluacionFinal: null,
            empresa_documento_id: p.empresa_documento_id != null ? Number(p.empresa_documento_id) : null,
            curso_documento_id: p.curso_documento_id != null ? Number(p.curso_documento_id) : null
          }));
          this.restaurarCalificacionesBorradorLocal();
          this.inferirModoCapturaCalificacionRegistrada();
          this.calificacionFinalPaginaActual = 1;
          this.recalcularListaPaseFiltrada();
          this.recalcularDatosPaso5();
          this.recalcularEstadisticasInicioParticipantes();
          this.inicializarChecklistVerificacion();
          this.cargarColaboradorasDocumentosPaso8();
        }
        this.cargandoParticipantes = false;
      },
      error: (err) => {
        console.error('❌ Error cargando participantes:', err);
        Swal.fire({
          title: 'Error',
          text: 'No se pudieron cargar los participantes del curso',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        this.cargandoParticipantes = false;
      }
    });
  }

  private parseCursosTomadosEmpleado(raw: unknown): number[] {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) {
      return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    }
    if (typeof raw === 'object') {
      return Object.values(raw as Record<string, unknown>).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    }
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed)
        ? parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    } catch {
      return String(raw).split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    }
  }

  private calcularEdadDesdeCURP(curp: string): number | null {
    const curpLimpio = String(curp || '').toUpperCase().trim();
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

  private readonly inicioStatPalette: ReadonlyArray<{ base: string; light: string }> = [
    { base: '#4a6741', light: '#6b8563' },
    { base: '#6b8f71', light: '#94b49a' },
    { base: '#8faaa4', light: '#b5c9c4' },
    { base: '#5c7a8a', light: '#8aa3b0' },
    { base: '#a8b5a0', light: '#c8d0c4' },
    { base: '#c4b5a0', light: '#ddd4c8' }
  ];

  trackByInicioStatLabel(_index: number, item: InicioStatBar): string {
    return item.label;
  }

  obtenerItemsInicioStatActivos(items: InicioStatBar[]): InicioStatBar[] {
    return (items || []).filter((item) => item.count > 0);
  }

  obtenerItemsLeyendaInicio(items: InicioStatBar[], incluirCeros = false): InicioStatBar[] {
    if (incluirCeros) {
      return items || [];
    }
    return this.obtenerItemsInicioStatActivos(items);
  }

  tieneInicioStatDatos(items: InicioStatBar[]): boolean {
    return this.obtenerItemsInicioStatActivos(items).length > 0;
  }

  getInicioDonutConic(items: InicioStatBar[]): string {
    const activos = this.obtenerItemsInicioStatActivos(items);
    if (!activos.length) {
      return 'conic-gradient(#edf2f7 0deg 360deg)';
    }

    const total = activos.reduce((sum, item) => sum + item.count, 0);
    if (total <= 0) {
      return 'conic-gradient(#edf2f7 0deg 360deg)';
    }

    let acumulado = 0;
    const segmentos = activos.map((item) => {
      const inicio = (acumulado / total) * 100;
      acumulado += item.count;
      const fin = (acumulado / total) * 100;
      return `${item.color} ${inicio}% ${fin}%`;
    });

    return `conic-gradient(from -90deg, ${segmentos.join(', ')})`;
  }

  getInicioDonutAria(items: InicioStatBar[]): string {
    const activos = this.obtenerItemsInicioStatActivos(items);
    if (!activos.length) {
      return 'Sin datos para mostrar';
    }
    return activos.map((item) => `${item.label}: ${item.count} (${item.pct}%)`).join('; ');
  }

  private construirBarrasDesdeConteo(
    conteo: Map<string, number>,
    total: number,
    orden?: string[],
    colores?: Array<{ base: string; light: string } | string>
  ): InicioStatBar[] {
    const entries = orden
      ? orden.map((label) => [label, conteo.get(label) || 0] as [string, number])
      : Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]);

    const palette = colores?.length
      ? colores.map((c) => (typeof c === 'string' ? { base: c, light: c } : c))
      : this.inicioStatPalette;

    return entries.map(([label, count], index) => {
      const tone = palette[index % palette.length];
      return {
        label,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
        color: tone.base,
        colorLight: tone.light
      };
    });
  }

  private obtenerRangoEdad(edad: number | null): string {
    if (edad == null || Number.isNaN(edad)) return 'Sin dato';
    if (edad < 26) return '18-25 años';
    if (edad < 36) return '26-35 años';
    if (edad < 46) return '36-45 años';
    if (edad < 56) return '46-55 años';
    return '56+ años';
  }

  recalcularEstadisticasInicioParticipantes(): void {
    const participantes = Array.isArray(this.listaAlumnos) ? this.listaAlumnos : [];
    const total = participantes.length;
    this.mostrarEstadisticasInicio = total > 0;

    if (total === 0) {
      this.estadisticasInicioParticipantes = {
        total: 0,
        educacion: [],
        antiguedad: [],
        edad: [],
        historialCurso: []
      };
      return;
    }

    const conteoEducacion = new Map<string, number>();
    const conteoAntiguedad = new Map<string, number>();
    const conteoEdad = new Map<string, number>();
    const conteoHistorial = new Map<string, number>([
      ['Primera vez', 0],
      ['Ya había tomado el curso', 0]
    ]);

    const cursoCatalogoId = this.obtenerCursoCatalogoIdActual();

    participantes.forEach((alumno) => {
      const educacion = String(alumno?.educacion || '').trim() || 'Sin dato';
      const antiguedad = String(alumno?.antiguedad || '').trim() || 'Sin dato';
      const rangoEdad = this.obtenerRangoEdad(
        alumno?.edad != null ? Number(alumno.edad) : this.calcularEdadDesdeCURP(alumno?.curp || '')
      );

      conteoEducacion.set(educacion, (conteoEducacion.get(educacion) || 0) + 1);
      conteoAntiguedad.set(antiguedad, (conteoAntiguedad.get(antiguedad) || 0) + 1);
      conteoEdad.set(rangoEdad, (conteoEdad.get(rangoEdad) || 0) + 1);

      const cursosPrevios = Array.isArray(alumno?.cursos_tomados) ? alumno.cursos_tomados : [];
      const yaTomo = cursoCatalogoId != null && cursosPrevios.includes(cursoCatalogoId);
      const claveHistorial = yaTomo ? 'Ya había tomado el curso' : 'Primera vez';
      conteoHistorial.set(claveHistorial, (conteoHistorial.get(claveHistorial) || 0) + 1);
    });

    this.estadisticasInicioParticipantes = {
      total,
      educacion: this.construirBarrasDesdeConteo(
        conteoEducacion,
        total,
        ['Educación Básica', 'Media Superior', 'Educación Superior', 'Sin dato']
      ),
      antiguedad: this.construirBarrasDesdeConteo(
        conteoAntiguedad,
        total,
        ['Menor a 6 meses', '6 meses - 1 año', 'Mayor a un año', 'Sin dato']
      ),
      edad: this.construirBarrasDesdeConteo(
        conteoEdad,
        total,
        ['18-25 años', '26-35 años', '36-45 años', '46-55 años', '56+ años', 'Sin dato']
      ),
      historialCurso: this.construirBarrasDesdeConteo(
        conteoHistorial,
        total,
        ['Primera vez', 'Ya había tomado el curso'],
        [
          { base: '#6b8f71', light: '#94b49a' },
          { base: '#c47d5a', light: '#d9a088' }
        ]
      )
    };
  }

  // Cargar todos los documentos del curso desde Drive
  cargarDocumentosCurso(): void {
    if (!this.cursoId) return;
    this.cargandoDocumentos = true;

    this.backendServices.obtenerTodosDocumentosCurso(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.documentosCurso = response.documentos || [];
          // Resolver por clave para soportar variantes Examen/Evaluacion y evitar falsos negativos.
          this.examenDiagnosticoCurso = this.obtenerDocumentoCursoBasicoPorClave('diagnostico');
          this.evaluacionFinalCurso = this.obtenerDocumentoCursoBasicoPorClave('final');
        }
        this.cargandoDocumentos = false;
      },
      error: (err) => {
        console.error('❌ Error cargando documentos del curso:', err);
        this.cargandoDocumentos = false;
      }
    });
  }

  /** Normalizar texto para búsquedas (sin acentos, minúsculas) */
  private normalizarNombre(texto: string): string {
    return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  private obtenerClaveDocumentoBasico(nombreDocumento: string | null | undefined): 'diagnostico' | 'final' | null {
    const nombre = this.normalizarNombre(nombreDocumento || '');
    const esEvaluacionOExamen = nombre.includes('evaluacion') || nombre.includes('examen');

    if (!esEvaluacionOExamen) {
      return null;
    }

    if (nombre.includes('diagnostico')) {
      return 'diagnostico';
    }

    if (nombre.includes('final')) {
      return 'final';
    }

    return null;
  }

  private obtenerDocumentoCursoBasicoPorClave(clave: 'diagnostico' | 'final'): any | null {
    const candidatos = (this.documentosCurso || []).filter((doc: any) => {
      const nombre = doc?.nombre || doc?.documento_nombre || '';
      return this.obtenerClaveDocumentoBasico(nombre) === clave;
    });

    if (!candidatos.length) {
      return null;
    }

    const ordenados = candidatos.sort((a: any, b: any) => {
      const aConArchivo = a?.tieneArchivo ? 1 : 0;
      const bConArchivo = b?.tieneArchivo ? 1 : 0;
      if (aConArchivo !== bConArchivo) {
        return bConArchivo - aConArchivo;
      }

      const fechaA = a?.fecha_subida ? new Date(a.fecha_subida).getTime() : 0;
      const fechaB = b?.fecha_subida ? new Date(b.fecha_subida).getTime() : 0;
      if (fechaA !== fechaB) {
        return fechaB - fechaA;
      }

      return Number(b?.documento_id || 0) - Number(a?.documento_id || 0);
    });

    return ordenados[0] || null;
  }

  private recalcularListaPaseFiltrada(): void {
    const termino = this.normalizarNombre(this.filtroPaseLista || '').trim();

    this.listaAlumnosPaseFiltrados = this.listaAlumnos.filter((alumno) => {
      const asistio = alumno?.asistio === true || alumno?.asistio === 1;
      if (this.filtroRapidoPaseLista === 'asistieron' && !asistio) {
        return false;
      }
      if (this.filtroRapidoPaseLista === 'pendientes' && asistio) {
        return false;
      }

      if (!termino) {
        return true;
      }

      const nombre = this.normalizarNombre(alumno?.nombre || '');
      const curp = this.normalizarNombre(alumno?.curp || '');
      const puesto = this.normalizarNombre(alumno?.puesto || '');
      return nombre.includes(termino) || curp.includes(termino) || puesto.includes(termino);
    });
  }

  onBusquedaPaseListaChange(): void {
    this.recalcularListaPaseFiltrada();
  }

  setFiltroRapidoPaseLista(filtro: 'todos' | 'asistieron' | 'pendientes'): void {
    this.filtroRapidoPaseLista = filtro;
    this.recalcularListaPaseFiltrada();
    this.actualizarEstadoToolbarPaseLista();
  }

  isFiltroRapidoPaseListaActivo(filtro: 'todos' | 'asistieron' | 'pendientes'): boolean {
    return this.filtroRapidoPaseLista === filtro;
  }

  getTotalAsistenciasMarcadas(): number {
    return this.listaAlumnos.filter((alumno) => alumno.asistio === true || alumno.asistio === 1).length;
  }

  getTotalAsistenciasPendientes(): number {
    return Math.max(this.listaAlumnos.length - this.getTotalAsistenciasMarcadas(), 0);
  }

  /** Previsualizar un documento template del curso (paso 1) */
  verExamenCurso(doc: any): void {
    if (!doc || !doc.tieneArchivo) return;
    this.documentPreview.abrir({
      nombre: doc.nombre,
      archivo_nombre: doc.archivo_nombre,
      archivo_url: doc.archivo_url,
      documento_id: doc.documento_id,
      curso_id: doc.curso_id
    });
  }

  /** Descargar un documento template del curso (paso 1) */
  descargarExamenCurso(doc: any): void {
    if (!doc || !doc.tieneArchivo) return;
    this.backendServices.descargarArchivoDocumento(doc.curso_id, doc.documento_id)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = doc.archivo_nombre || 'examen.pdf';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 100);
        },
        error: () => {
          Swal.fire({ title: 'Error', text: 'No se pudo descargar el documento.', icon: 'error', confirmButtonColor: '#38512F' });
        }
      });
  }

  /** Descargar en PDF un documento template del curso (paso 1) */
  imprimirExamenCurso(doc: any): void {
    if (!doc || !doc.tieneArchivo) return;
    const ext = (doc.archivo_nombre || '').split('.').pop()?.toLowerCase();
    const esPDF = ext === 'pdf';

    Swal.fire({
      title: 'Preparando descarga...',
      text: 'Un momento, esto puede tardar unos segundos...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const source$ = esPDF
      ? this.backendServices.descargarArchivoDocumento(doc.curso_id, doc.documento_id)
      : this.backendServices.imprimirDocumentoComoPDF(doc.documento_id);

    source$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob: Blob) => {
        Swal.close();
        const nombreBase = (doc?.nombre || doc?.archivo_nombre || 'documento').toString();
        this.descargarBlobPdf(blob, nombreBase);
      },
      error: () => {
        Swal.close();
        Swal.fire({ title: 'Error', text: 'No se pudo descargar el documento en PDF.', icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  // Cargar checklist dinámico del curso desde la BD
  cargarChecklistCurso(): void {
    const cursoId = this.curso?.curso_id;
    if (!cursoId) {
      return;
    }

    this.backendServices.obtenerChecklistCurso(cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.items) {
          this.listaMateriales = response.items.map((item: any) => ({
            nombre: item.nombre,
            icono: item.icono || 'fa-check-square',
            entregado: false,
            esObligatorio: this.esChecklistObligatorio(item.nombre),
            nota: '',
            checklist_id: item.checklist_id,
            documento_id: item.documento_id || null,
            docDrive: (item.documento_id && item.tiene_archivo) ? {
              documento_id: item.documento_id,
              curso_id: cursoId,
              nombre: item.doc_nombre,
              archivo_nombre: item.archivo_nombre,
              archivo_url: item.archivo_url
            } : null,
            tieneVinculo: !!item.documento_id,
            tieneArchivo: !!item.tiene_archivo
          }));
        }
      },
      error: (err) => {
        console.error('❌ Error cargando checklist del curso:', err);
      }
    });
  }

  // Cargar documentos del curso programado (exámenes resueltos, evaluaciones, etc.)
  // Carga directa desde BD para evitar eliminar registros recién subidos por sincronización prematura
  cargarDocumentosProgramado(): void {
    const cursoId = this.cursoId;
    if (!cursoId) return;
    this.cargarDocumentosProgramadoDesdeBD(cursoId);
  }

  // Cargar documentos directamente desde BD (después de sincronizar)
  private cargarDocumentosProgramadoDesdeBD(cursoId: number): void {
    this.backendServices.obtenerDocumentosCursoProgramado(cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.documentos) {
          this.fotosEvidenciaSubidas = [];
          this.examenResueltoSubido = null;
          this.evaluacionResueltaSubida = null;
          this.checklistVerificacionArchivo = null;
          this.checklistEditorVisible = false;
          this.checklistEditorUrl = null;
          this.checklistEditorRawUrl = '';
          this.informeFinalArchivoDrive = null;
          this.informeFinalPdfArchivoDrive = null;
          this.informeFotograficoArchivo = null;
          this.informeFotograficoPdfArchivoDrive = null;
          this.informeFinalEditorVisible = false;
          this.informeFotograficoEditorVisible = false;
          this.sincronizarPantallaCompletaEditorIntegrado();
          this.informeFotograficoEditorUrl = null;
          this.informeFotograficoEditorRawUrl = '';
          this.listaFisicaSubida = null;
          this.entregaDocumentosGenerado = null;
          this.entregaDocumentosFirmadoSubido = null;
          for (const doc of response.documentos) {
            if (doc.descripcion === 'examen_resuelto' && !this.examenResueltoSubido) {
              this.examenResueltoSubido = {
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                id: doc.documento_prog_id,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'evaluacion_resuelta' && !this.evaluacionResueltaSubida) {
              this.evaluacionResueltaSubida = {
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                id: doc.documento_prog_id,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'foto_evidencia') {
              const driveFileId = String(doc.drive_file_id || '').trim();
              this.fotosEvidenciaSubidas.push({
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                fecha: doc.fecha_subida,
                driveFileId,
                previewUrl: this.backendServices.resolverUrlDrivePreview(driveFileId) || '',
                href: doc.archivo_url || (driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view` : '#')
              });
            } else if (doc.descripcion === 'checklist_verificacion_spf08') {
              this.checklistVerificacionArchivo = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
              // Restaurar URL del editor de Google Sheets si hay drive_file_id
              if (doc.drive_file_id && !this.checklistEditorRawUrl) {
                const editorUrl = `https://docs.google.com/spreadsheets/d/${doc.drive_file_id}/edit`;
                this.checklistEditorRawUrl = editorUrl;
                this.checklistEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
              }
            } else if (doc.descripcion === 'informe_final_oficial') {
              this.informeFinalArchivoDrive = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'informe_final_pdf_oficial') {
              this.informeFinalPdfArchivoDrive = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'lista_asistencia_fisica' && !this.listaFisicaSubida) {
              this.listaFisicaSubida = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'entrega_documentos_spf03_generado' && !this.entregaDocumentosGenerado) {
              this.entregaDocumentosGenerado = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'entrega_documentos_spf03_firmado' && !this.entregaDocumentosFirmadoSubido) {
              this.entregaDocumentosFirmadoSubido = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'sgcf33_lista_asistencia' && !this.listaAsistenciaDrive) {
              this.listaAsistenciaDrive = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'sgcf33_lista_asistencia_vacia' && !this.listaAsistenciaVaciaDrive) {
              this.listaAsistenciaVaciaDrive = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            } else if (doc.descripcion === 'informe_fotografico' && !this.informeFotograficoArchivo) {
              this.informeFotograficoArchivo = {
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
              if ((doc.drive_file_id || doc.archivo_url) && !this.informeFotograficoEditorRawUrl) {
                const editorUrl = this.resolverUrlEdicionInformeFotografico(doc.drive_file_id, doc.archivo_url);
                if (editorUrl) {
                  this.informeFotograficoEditorRawUrl = editorUrl;
                  this.informeFotograficoEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
                }
              }
            } else if (doc.descripcion === 'informe_fotografico_pdf_oficial' && !this.informeFotograficoPdfArchivoDrive) {
              this.informeFotograficoPdfArchivoDrive = {
                id: doc.documento_prog_id,
                nombre: doc.nombre_archivo,
                url: doc.archivo_url,
                drive_file_id: doc.drive_file_id || null,
                fecha: doc.fecha_subida
              };
            }
          }
        }
      },
      error: (err) => {
        console.error('❌ Error cargando documentos del curso programado:', err);
      }
    });
  }

  /**
   * Ver/previsualizar un documento de Drive vinculado a un item del checklist
   */
  verDocumentoChecklist(item: any, event: Event): void {
    event.stopPropagation(); // Evitar toggle del checklist
    if (!item.docDrive) return;
    this.documentPreview.abrir({
      nombre: item.docDrive.nombre,
      archivo_nombre: item.docDrive.archivo_nombre,
      archivo_url: item.docDrive.archivo_url,
      documento_id: item.docDrive.documento_id,
      curso_id: item.docDrive.curso_id
    });
  }

  /**
   * Descargar un documento de Drive vinculado a un item del checklist
   */
  descargarDocumentoChecklist(item: any, event: Event): void {
    event.stopPropagation();
    if (!item.docDrive) return;
    const { curso_id, documento_id, archivo_nombre } = item.docDrive;
    this.backendServices.descargarArchivoDocumento(curso_id, documento_id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = archivo_nombre || 'documento.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
      },
      error: (err) => {
        console.error('❌ Error descargando documento:', err);
        Swal.fire({ title: 'Error', text: 'No se pudo descargar el documento.', icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  /**
   * Imprimir un documento de Drive usando el diálogo nativo del navegador
   * - PDF: descarga blob, abre en nueva pestaña y lanza print()
   * - Office (docx, xlsx, etc.): abre el visor nativo de Google Drive para imprimir desde ahí
   */
  imprimirDocumentoChecklist(item: any, event: Event): void {
    event.stopPropagation();
    if (!item.docDrive) return;
    const { curso_id, documento_id, archivo_nombre } = item.docDrive;
    const ext = (archivo_nombre || '').split('.').pop()?.toLowerCase();
    const esPDF = ext === 'pdf';

    Swal.fire({
      title: 'Preparando impresión...',
      text: 'Un momento, esto puede tardar unos segundos...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    // Si ya es PDF, descargar directamente sin pasar por conversión
    const source$ = esPDF
      ? this.backendServices.descargarArchivoDocumento(curso_id, documento_id)
      : this.backendServices.imprimirDocumentoComoPDF(documento_id);

    source$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob: Blob) => {
        Swal.close();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(pdfBlob);
        const printWindow = window.open(url, '_blank');
        if (printWindow) {
          printWindow.addEventListener('load', () => {
            setTimeout(() => {
              printWindow.focus();
              printWindow.print();
            }, 800);
          });
          // Fallback si load no dispara
          setTimeout(() => {
            try { printWindow.focus(); printWindow.print(); } catch (e) { }
          }, 2000);
        } else {
          // Si el popup fue bloqueado, usar iframe
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;';
          iframe.src = url;
          document.body.appendChild(iframe);
          iframe.onload = () => {
            setTimeout(() => {
              try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch (e) { }
              setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 2000);
            }, 800);
          };
        }
      },
      error: (err) => {
        Swal.close();
        console.error('❌ Error preparando impresión:', err);
        Swal.fire({ title: 'Error', text: 'No se pudo preparar el documento para impresión.', icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  // Obtener un documento específico por nombre
  getDocumento(nombre: string): any {
    return this.documentosCurso.find(d => {
      const n = d.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const buscar = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return n.includes(buscar);
    });
  }

  // Formatear nombre completo (apellidos primero)
  formatearNombreCompleto(participante: any): string {
    if (participante.nombre_completo && participante.nombre_completo.trim()) {
      return participante.nombre_completo.trim().toUpperCase();
    }
    const partes = [
      participante.apellido_paterno,
      participante.apellido_materno,
      participante.nombre
    ].filter(p => p && p.trim() !== '');
    return partes.join(' ').toUpperCase();
  }

  formatearNombreTitulo(nombre: string): string {
    if (!nombre) return '';
    return String(nombre)
      .normalize('NFC')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/(^|[\s-])([a-záéíóúüñ])/g, (_, prefijo, letra) => `${prefijo}${letra.toUpperCase()}`);
  }

  // Eliminar alumno (marcar como inactivo)
  async eliminarAlumno(alumno: any): Promise<'volver' | void> {
    const result = await Swal.fire({
      title: '¿Eliminar participante?',
      html: `
        <style>
          .swal2-actions { display:flex !important; justify-content:flex-end !important; gap:.5rem !important; margin-top:1rem !important; }
          .swal2-cancel, .swal2-confirm { border-radius:8px !important; padding:.56rem .9rem !important; font-weight:600 !important; box-shadow:0 4px 12px rgba(0,0,0,0.08) !important; border:0 !important; min-width:96px !important; }
          .swal2-cancel { background: #A8A9A2 !important; color:#fff !important; }
          .swal2-cancel:hover { filter:brightness(.98) !important; }
          .swal2-confirm { background:#f5365c !important; color:#fff !important; }
        </style>
        <div style="text-align:left;">
          <p>¿Estás seguro de eliminar a:</p>
          <p class="font-weight-bold">${alumno.nombre}</p>
          <p class="text-muted small">El participante será marcado como inactivo y no aparecerá en la lista de asistencia.</p>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Volver'
    });

    if (result.dismiss === Swal.DismissReason.cancel) {
      return 'volver';
    }

    if (!result.isConfirmed) {
      return;
    }

    if (!alumno?.inscripcion_id) {
      await Swal.fire({
        title: 'Error',
        text: 'No se encontró la inscripción del participante',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    try {
      const response: any = await firstValueFrom(
        this.backendServices.eliminarInscripcion(alumno.inscripcion_id).pipe(takeUntil(this.destroy$))
      );

      if (response?.success) {
        const index = this.listaAlumnos.findIndex(a => a.inscripcion_id === alumno.inscripcion_id);
        if (index > -1) {
          this.listaAlumnos.splice(index, 1);
          this.recalcularListaPaseFiltrada();
          this.recalcularDatosPaso5();
        }
        await Swal.fire({
          title: '¡Eliminado!',
          text: response.message || 'El participante ha sido eliminado del curso',
          icon: 'success',
          confirmButtonColor: '#38512F',
          timer: 2000
        });
        return;
      }

      await Swal.fire({
        title: 'Error',
        text: response?.message || 'No se pudo eliminar al participante',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } catch (err: any) {
      console.error('❌ Error eliminando participante:', err);
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo eliminar al participante',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  // Guardar asistencia del alumno
  guardarAsistencia(alumno: any): void {
    if (!alumno.inscripcion_id) return;

    const calificacionTeorica = this.parseCalificacionFinal(alumno.calificacionTeorica);
    const calificacionPractica = this.parseCalificacionFinal(alumno.calificacionPractica);

    if ((alumno.calificacionTeorica !== '' && calificacionTeorica === null)
      || (alumno.calificacionPractica !== '' && calificacionPractica === null)) {
      Swal.fire({
        title: 'Calificación inválida',
        text: 'Las calificaciones escrita y práctica deben estar entre 0 y 10',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.backendServices.actualizarAsistencia(
      alumno.inscripcion_id,
      alumno.asistio,
      alumno.nota || '',
      calificacionTeorica,
      calificacionPractica,
      this.parseCalificacionFinal(alumno.calificacionDiag)
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.recalcularListaPaseFiltrada();
          this.recalcularDatosPaso5();
        }
      },
      error: (err) => {
        console.error('❌ Error actualizando asistencia:', err);
      }
    });
  }

  cambiarPaginaCalificacionFinal(delta: number): void {
    const siguiente = this.calificacionFinalPaginaActual + delta;
    if (siguiente < 1 || siguiente > this.totalPaginasCalificacionFinal) {
      return;
    }
    this.calificacionFinalPaginaActual = siguiente;
    this.recalcularDatosPaso5();
  }

  onBusquedaCalificacionFinalChange(): void {
    this.calificacionFinalPaginaActual = 1;
    this.recalcularDatosPaso5();
  }

  get paso5EdicionBloqueada(): boolean {
    return this.isPasoCompletado(5);
  }

  setModoCapturaCalificacion(modo: 'ambos' | 'teorico' | 'practico'): void {
    if (this.paso5EdicionBloqueada) {
      return;
    }
    this.modoCapturaCalificacion = modo;
  }

  private inferirModoCapturaCalificacionRegistrada(): void {
    const lista = Array.isArray(this.listaAlumnos) ? this.listaAlumnos : [];
    let hayTeorica = false;
    let hayPractica = false;

    for (const alumno of lista) {
      if (!hayTeorica && this.parseCalificacionFinal(alumno?.calificacionTeorica) !== null) {
        hayTeorica = true;
      }
      if (!hayPractica && this.parseCalificacionFinal(alumno?.calificacionPractica) !== null) {
        hayPractica = true;
      }
      if (hayTeorica && hayPractica) {
        this.modoCapturaCalificacion = 'ambos';
        return;
      }
    }

    if (hayTeorica) {
      this.modoCapturaCalificacion = 'teorico';
      return;
    }

    if (hayPractica) {
      this.modoCapturaCalificacion = 'practico';
      return;
    }

    this.modoCapturaCalificacion = 'ambos';
  }

  setCalificacionTab(tab: 'final' | 'diagnostico'): void {
    this.calificacionTabActiva = tab;
  }

  get subiendoPaso5(): boolean {
    return this.subiendoExamenResuelto || this.subiendoEvaluacionResuelta;
  }

  /**
   * Clasifica visualmente la tarjeta del alumno:
   * - Diagnóstico: valor único
   * - Evaluación final: combinación de escrita y práctica
   */
  clasificarPorCalificacion(alumno: any): 'excelente' | 'regular' | 'pendiente' | 'reprobado' | 'mixto' {
    const esDiag = this.calificacionTabActiva === 'diagnostico';
    if (esDiag) {
      return this.clasificarValorUnico(this.parseCalificacionFinal(alumno?.calificacionDiag));
    }
    const teorica = this.parseCalificacionFinal(alumno?.calificacionTeorica);
    const practica = this.parseCalificacionFinal(alumno?.calificacionPractica);

    if (teorica === null || practica === null) return 'pendiente';

    const teoricaVerde = teorica >= 8;
    const practicaVerde = practica >= 8;
    const teoricaRojo = teorica === 0;
    const practicaRojo = practica === 0;

    if (teoricaVerde && practicaVerde) return 'excelente';
    if (teoricaRojo && practicaRojo) return 'reprobado';

    return 'regular';
  }

  private clasificarValorUnico(valor: number | null): 'excelente' | 'regular' | 'pendiente' | 'reprobado' {
    if (valor === null) return 'pendiente';
    if (valor === 0) return 'reprobado';
    if (valor >= 8) return 'excelente';
    return 'regular';
  }

  obtenerClaseCalificacionCampo(alumno: any, campo: string): string {
    const valor = this.parseCalificacionFinal(alumno?.[campo]);
    if (valor === null) return '';
    if (valor === 0) return 'calif-input-cero';
    if (valor >= 8) return 'calif-input-aprobado';
    if (valor > 0) return 'calif-input-parcial';
    return '';
  }

  onCalificacionInput(event: Event, alumno: any, campo: string): void {
    const input = event.target as HTMLInputElement | null;
    if (!input || !alumno) return;

    if (this.paso5EdicionBloqueada) {
      input.value = alumno?.[campo] ?? '';
      return;
    }

    const limpio = this.sanitizarEntradaNumerica(input.value, true, 2);
    input.value = limpio;
    alumno[campo] = limpio;
    this.guardarCalificacionesBorradorLocal();
  }

  normalizarCalificacionInput(alumno: any, campo: string): void {
    if (this.paso5EdicionBloqueada) {
      return;
    }

    try {
      const valorOriginal = alumno?.[campo];
      if (valorOriginal === undefined || valorOriginal === null || String(valorOriginal).trim() === '') {
        alumno[campo] = '';
        return;
      }

      const calificacionFinal = this.parseCalificacionFinal(valorOriginal);
      if (calificacionFinal === null) {
        Swal.fire({
          title: 'Calificación inválida',
          text: 'Ingresa un valor entre 0 y 10 (ej: 78 → 7.8, 9.5)',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        alumno[campo] = '';
        return;
      }

      alumno[campo] = calificacionFinal.toString();
    } catch (error) {
      console.error('❌ Error normalizando calificación final:', error);
      Swal.fire({
        title: 'Error',
        text: 'No se pudo validar la calificación.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      if (alumno) {
        alumno[campo] = '';
      }
    } finally {
      this.guardarCalificacionesBorradorLocal();
    }
  }

  // ajustarPaginaCalificacionFinal ahora integrado en recalcularDatosPaso5()

  // Cargar progreso de pasos completados desde el backend
  cargarProgreso(): void {
    if (!this.cursoId) return;

    this.registrarTimelineLog('cargarProgreso.inicio', { cursoId: this.cursoId });

    this.backendServices.obtenerProgresoCurso(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.pasosCompletados) {
          const pasosNormalizados: number[] = Array.from(
            new Set<number>(
              (response.pasosCompletados || [])
                .map((p: any) => Number(p))
                .filter((p: number) => Number.isFinite(p) && p >= 1 && p <= 10)
            )
          );

          // Compatibilidad con versiones previas donde "Finalizado" era el paso 9.
          const estatusCompletado = String(this.curso?.estatus || '').toLowerCase() === 'completado';
          if (estatusCompletado && pasosNormalizados.includes(9) && !pasosNormalizados.includes(10)) {
            pasosNormalizados.push(10);
          }

          const pasosValidos = new Set(this.pasosCurso.map(p => p.numero));
          this.pasosCompletados = pasosNormalizados.filter(p => pasosValidos.has(p));
        }

        this.evaluarAutoInicioCapacitacion();
        this.evaluarAutoCierreEncuesta();
        this.restaurarPasoSeleccionado();
        this.registrarTimelineLog('cargarProgreso.ok', {
          pasosCompletados: this.pasosCompletados,
          pasoRestaurado: this.pasoSeleccionado
        });
      },
      error: (err) => {
        console.error('❌ Error cargando progreso:', err);
        this.restaurarPasoSeleccionado();
        this.registrarTimelineLog('cargarProgreso.error', {
          error: err?.message || 'error',
          pasoRestaurado: this.pasoSeleccionado
        });
      }
    });
  }

  private limpiarAutoInicioTimer(): void {
    if (!this.autoInicioTimer) return;
    clearTimeout(this.autoInicioTimer);
    this.autoInicioTimer = null;
  }

  private obtenerFechaHoraInicioCurso(): Date | null {
    const fechaRaw = this.curso?.fecha_inicio;
    const horaRaw = this.curso?.hora_inicio;

    if (!fechaRaw || !horaRaw) return null;

    let year: number | null = null;
    let month: number | null = null;
    let day: number | null = null;

    if (fechaRaw instanceof Date && !Number.isNaN(fechaRaw.getTime())) {
      year = fechaRaw.getFullYear();
      month = fechaRaw.getMonth() + 1;
      day = fechaRaw.getDate();
    } else {
      const fechaStr = String(fechaRaw).split('T')[0].trim();
      const [y, m, d] = fechaStr.split('-').map((v) => Number(v));
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
      year = y;
      month = m;
      day = d;
    }

    const horaStr = String(horaRaw).trim();
    const [h, m, s] = horaStr.split(':').map((v) => Number(v));
    if (!Number.isFinite(h)) return null;

    const hh = h;
    const mm = Number.isFinite(m) ? m : 0;
    const ss = Number.isFinite(s) ? s : 0;
    const fecha = new Date(year, (month as number) - 1, day as number, hh, mm, ss, 0);

    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  private marcarPasoCompletadoAuto(paso: number, meta: any = {}): void {
    if (this.isPasoCompletado(paso)) return;

    const pasosValidos = new Set(this.pasosCurso.map(p => p.numero));
    if (!pasosValidos.has(paso)) return;

    this.pasosCompletados = Array.from(new Set([...this.pasosCompletados, paso]));
    this.guardarProgreso();
    this.registrarTimelineLog('autoInicio.marcado', { paso, ...meta });
  }

  private evaluarAutoInicioCapacitacion(): void {
    this.limpiarAutoInicioTimer();

    const inicio = this.obtenerFechaHoraInicioCurso();
    if (!inicio) {
      this.registrarTimelineLog('autoInicio.skip', { motivo: 'sin_fecha_hora' });
      return;
    }

    if (this.isPasoCompletado(1)) {
      this.registrarTimelineLog('autoInicio.skip', { motivo: 'ya_completado' });
      return;
    }

    const ahora = new Date();
    const msRestantes = inicio.getTime() - ahora.getTime();

    if (msRestantes <= 0) {
      this.marcarPasoCompletadoAuto(1, {
        origen: 'fecha_hora',
        inicio: inicio.toISOString()
      });
      return;
    }

    const maxDelay = 2147483647;
    const delay = Math.min(msRestantes, maxDelay);
    this.autoInicioTimer = setTimeout(() => {
      this.autoInicioTimer = null;
      this.evaluarAutoInicioCapacitacion();
    }, delay);

    this.registrarTimelineLog('autoInicio.programado', {
      msRestantes,
      inicio: inicio.toISOString()
    });
  }

  private limpiarAutoCierreEncuestaTimer(): void {
    if (!this.autoCierreEncuestaTimer) return;
    clearTimeout(this.autoCierreEncuestaTimer);
    this.autoCierreEncuestaTimer = null;
  }

  private obtenerFechaHoraCierreEncuesta(): Date | null {
    const inicio = this.obtenerFechaHoraInicioCurso();
    if (!inicio) return null;
    return new Date(inicio.getTime() + (24 * 60 * 60 * 1000));
  }

  private async ejecutarAutoCierreEncuesta(cierre: Date): Promise<void> {
    if (this.cerrandoEncuesta) {
      this.registrarTimelineLog('autoCierreEncuesta.skip', { motivo: 'cerrando', cierre: cierre.toISOString() });
      return;
    }

    const encuestaActiva = !!this.encuestaCursoUrl || !!this.encuestaEditUrl || (this.encuestaStats?.cerrada === false);
    if (!encuestaActiva) {
      this.registrarTimelineLog('autoCierreEncuesta.skip', { motivo: 'sin_encuesta', cierre: cierre.toISOString() });
      return;
    }

    const ok = await this.cerrarEncuestaYGuardarResultados();
    if (!ok) {
      this.registrarTimelineLog('autoCierreEncuesta.error', { cierre: cierre.toISOString() });
      return;
    }

    if (!this.pasosCompletados.includes(3)) {
      this.pasosCompletados.push(3);
      this.guardarProgreso();
      this.registrarTimelineLog('autoCierreEncuesta.paso3Completado');
    }

    if (this.pasoSeleccionado === 3) {
      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('autoCierreEncuesta.avanza', { nuevoPaso: this.pasoSeleccionado });
    }
  }

  private evaluarAutoCierreEncuesta(): void {
    this.limpiarAutoCierreEncuestaTimer();

    const cierre = this.obtenerFechaHoraCierreEncuesta();
    if (!cierre) {
      this.registrarTimelineLog('autoCierreEncuesta.skip', { motivo: 'sin_fecha_hora' });
      return;
    }

    const ahora = new Date();
    const msRestantes = cierre.getTime() - ahora.getTime();

    if (msRestantes <= 0) {
      void this.ejecutarAutoCierreEncuesta(cierre);
      return;
    }

    const maxDelay = 2147483647;
    const delay = Math.min(msRestantes, maxDelay);
    this.autoCierreEncuestaTimer = setTimeout(() => {
      this.autoCierreEncuestaTimer = null;
      this.evaluarAutoCierreEncuesta();
    }, delay);

    this.registrarTimelineLog('autoCierreEncuesta.programado', {
      msRestantes,
      cierre: cierre.toISOString()
    });
  }

  // Guardar progreso en el backend
  guardarProgreso(): void {
    if (!this.cursoId) return;
    this.registrarTimelineLog('guardarProgreso.inicio', {
      cursoId: this.cursoId,
      pasosCompletados: this.pasosCompletados
    });

    this.backendServices.guardarProgresoCurso(this.cursoId, this.pasosCompletados).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.registrarTimelineLog('guardarProgreso.ok', { pasosCompletados: this.pasosCompletados });
        }
      },
      error: (err) => {
        console.error('❌ Error guardando progreso:', err);
        this.registrarTimelineLog('guardarProgreso.error', { error: err?.message || 'error' });
      }
    });
  }

  // Guardar registro final de asistencia (Paso 2)
  async guardarRegistroFinal(): Promise<void> {
    const result = await Swal.fire({
      title: '¿Guardar Registro Final?',
      html: `<p>Se guardará el registro de asistencia de todos los participantes.</p>
             <p class="text-muted small">Los participantes marcados con asistencia serán actualizados en la base de datos.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, guardar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      // Guardar todos los registros de asistencia
      let guardados = 0;
      let errores = 0;

      for (const alumno of this.listaAlumnos) {
        try {
          await this.backendServices.actualizarAsistencia(
            alumno.inscripcion_id,
            alumno.asistio,
            alumno.nota || '',
            this.parseCalificacionFinal(alumno.calificacionTeorica),
            this.parseCalificacionFinal(alumno.calificacionPractica)
          ).toPromise();
          guardados++;
        } catch (err) {
          console.error(`Error guardando asistencia de ${alumno.nombre}:`, err);
          errores++;
        }
      }

      if (errores === 0) {
        Swal.fire({
          title: '¡Registro Guardado!',
          text: `${guardados} registros de asistencia guardados exitosamente`,
          icon: 'success',
          confirmButtonColor: '#38512F',
          timer: 2000
        });
      } else {
        Swal.fire({
          title: 'Guardado con errores',
          text: `${guardados} guardados, ${errores} con errores`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
      }
    }
  }

  get pasoSeleccionadoData() {
    return this.pasosCurso.find(p => p.numero === this.pasoSeleccionado);
  }

  seleccionarPaso(numero: number): void {
    this.registrarTimelineLog('seleccionarPaso.intento', {
      actual: this.pasoSeleccionado,
      solicitado: numero,
      encuestaCompletada: this.isPasoCompletado(3)
    });

    if (!this.esPasoAccesibleParaAdmin(numero)) {
      this.registrarTimelineLog('seleccionarPaso.bloqueadoAdmin', { solicitado: numero });
      return;
    }

    if (this.estaPasoBloqueado(numero)) {
      Swal.fire({
        title: 'Encuesta cerrada',
        text: 'No puedes regresar al paso de Encuesta una vez finalizado.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      if (this.pasoSeleccionado !== 5) {
        this.pasoSeleccionado = 5;
        this.guardarPasoActualLocal();
      }
      this.cerrarEditorIntegradoPaso7();
      this.desactivarBloqueoScrollPagina();
      this.detenerAutoRefreshEncuestaStats();
      this.destruirEncuestaPieCharts();
      this.registrarTimelineLog('seleccionarPaso.bloqueado', { solicitado: numero, redirigido: 5 });
      return;
    }

    this.pasoSeleccionado = this.normalizarPasoPermitido(numero);
    if (this.pasoSeleccionado !== 2 && this.pasoSeleccionado !== 7) {
      this.cerrarEditorIntegradoPaso7();
    }
    this.sincronizarBloqueoScrollEditor();
    this.guardarPasoActualLocal();
    this.registrarTimelineLog('seleccionarPaso.ok', { paso: this.pasoSeleccionado });

    this.sincronizarVistaEncuestaSegunPaso(this.pasoSeleccionado);
  }

  private sincronizarVistaEncuestaSegunPaso(pasoDestino: number): void {
    if (pasoDestino === 3) {
      this.cargarEncuestaStats(true);
      this.iniciarAutoRefreshEncuestaStats();
      setTimeout(() => this.renderEncuestaPieCharts(), 0);
      return;
    }

    this.detenerAutoRefreshEncuestaStats();
    this.destruirEncuestaPieCharts();
  }

  isPasoCompletado(numero: number): boolean {
    return this.pasosCompletados.includes(numero);
  }

  getPorcentajeProgreso(): number {
    return (this.pasosCompletados.length / this.pasosCurso.length) * 100;
  }

  getProgresoSeccion(seccion: string): number {
    const pasosSeccion = this.pasosCurso.filter(p => p.seccion === seccion);
    if (pasosSeccion.length === 0) return 0;
    const completados = pasosSeccion.filter(p => this.isPasoCompletado(p.numero)).length;
    return (completados / pasosSeccion.length) * 100;
  }

  // ACCIONES
  async iniciarCapacitacion(): Promise<void> {
    const result = await Swal.fire({
      title: '¿Iniciar Capacitación?',
      text: 'Se registrará el inicio del curso',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      confirmButtonText: 'Sí, iniciar'
    });

    if (result.isConfirmed) {
      this.marcarComoCompletado();
    }
  }

  async finalizarCapacitacion(): Promise<void> {
    if (this.finalizandoCapacitacion) {
      return;
    }

    // Validar que todos los pasos previos al cierre estén completados (1 al 8)
    const pasosObligatorios = [1, 2, 3, 4, 5, 6, 7, 8];
    const pasosFaltantes = [];
    for (let i of pasosObligatorios) {
      if (!this.isPasoCompletado(i)) {
        pasosFaltantes.push(this.pasosCurso.find(p => p.numero === i)?.nombre || `Paso ${i}`);
      }
    }

    if (pasosFaltantes.length > 0) {
      Swal.fire({
        title: 'No se puede finalizar',
        html: `<p>Debes completar los siguientes pasos antes de finalizar:</p>
               <ul class="text-left">
                 ${pasosFaltantes.map(p => `<li>${p}</li>`).join('')}
               </ul>`,
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const result = await Swal.fire({
      title: '¿Finalizar curso?',
      text: 'Se marcará la capacitación como completada.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#94a3b8',
      confirmButtonText: 'Sí, finalizar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) {
      return;
    }

    this.finalizandoCapacitacion = true;
    Swal.fire({
      title: 'Finalizando…',
      html: '<p class="mb-0 text-muted small">Guardando la capacitación, un momento.</p>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    if (!this.pasosCompletados.includes(10)) {
      this.pasosCompletados.push(10);
      this.guardarProgreso();
    }

    if (!this.cursoId) {
      this.finalizandoCapacitacion = false;
      Swal.fire('¡Listo!', 'Curso finalizado correctamente.', 'success');
      return;
    }

    this.backendServices.actualizarEstatusCurso(this.cursoId, 'completado')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.finalizandoCapacitacion = false;
          if (res?.success) {
            if (this.curso) {
              this.curso.estatus = 'completado';
            }
            if (res?.informeFinalPdfActualizado?.drive_file_id || res?.informeFinalPdfActualizado?.url) {
              this.informeFinalPdfArchivoDrive = {
                id: this.informeFinalPdfArchivoDrive?.id || null,
                nombre: res.informeFinalPdfActualizado?.nombre || 'Informe_Final.pdf',
                url: res.informeFinalPdfActualizado?.url || '',
                drive_file_id: res.informeFinalPdfActualizado?.drive_file_id || null,
                fecha: new Date().toISOString()
              };
            }
            this.historialPendientes.registrarPendienteLocal({
              programado_id: Number(this.cursoId),
              curso_id: Number(this.obtenerCursoCatalogoIdActual() || 0),
              empresa_id: Number(this.curso?.empresa_id || 0),
              nombre_curso: this.nombreCurso || this.curso?.nombre_curso || 'Curso finalizado',
              nombre_empresa: this.empresaNombre || this.curso?.nombre_empresa || 'Empresa'
            });
            this.historialPendientes.refrescar().subscribe(() => {
              this.mostrarOpcionesTrasFinalizarCapacitacion();
            });
          } else {
            Swal.fire('Advertencia', res?.message || 'No se pudo actualizar el estatus en la base de datos', 'warning');
          }
        },
        error: () => {
          this.finalizandoCapacitacion = false;
          Swal.fire(
            'Error',
            'No se pudo finalizar la capacitación en el servidor. Intenta de nuevo.',
            'error'
          );
        }
      });
  }

  private mostrarOpcionesTrasFinalizarCapacitacion(): void {
    Swal.fire({
      title: 'Capacitación finalizada',
      html: `
        <p class="mb-2">La capacitación se guardó correctamente.</p>
        <p class="mb-0 text-muted small">Regresa a Cursos activos para gestionar tus demás capacitaciones.</p>
      `,
      icon: 'success',
      confirmButtonText: 'Ir a Cursos activos',
      confirmButtonColor: '#38512F',
      allowOutsideClick: false
    }).then(() => {
      this.navegarACursosActivosTrasFinalizar();
    });
  }

  private navegarACursosActivosTrasFinalizar(): void {
    this.router.navigate(['/curso-activos']).then(() => {
      this.historialPendientes.refrescar().subscribe(() => {
        window.setTimeout(() => {
          this.historialPendientes.dispararAnimacionIncremento();
        }, 150);
      });
    });
  }

  async marcarComoCompletado(): Promise<void> {
    if (!this.pasosCompletados.includes(this.pasoSeleccionado)) {
      this.pasosCompletados.push(this.pasoSeleccionado);

      // Guardar en el backend
      this.guardarProgreso();

      Swal.fire({
        title: '¡Completado!',
        text: `Paso ${this.pasoSeleccionado} marcado como completado`,
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });

      // Avanzar automáticamente al siguiente paso después de un breve delay
      setTimeout(() => {
        if (this.pasoSeleccionado < 10) {
          this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
          this.guardarPasoActualLocal();
        }
      }, 1600);
    }
  }

  // Desmarcar paso para permitir edición
  async desmarcarPasoParaEditar(): Promise<void> {
    const result = await Swal.fire({
      title: '¿Habilitar Edición?',
      html: `<p>Se permitirá editar el paso <strong>${this.pasoSeleccionadoData?.nombre}</strong></p>
             <p class="text-muted small">Podrás volver a marcarlo como completado después de hacer cambios.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#5e72e4',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, habilitar edición',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      // Remover de la lista de completados
      const index = this.pasosCompletados.indexOf(this.pasoSeleccionado);
      if (index > -1) {
        this.pasosCompletados.splice(index, 1);

        // Guardar en el backend
        this.guardarProgreso();

        Swal.fire({
          title: 'Edición Habilitada',
          text: 'Ahora puedes hacer cambios en este paso',
          icon: 'info',
          confirmButtonColor: '#38512F',
          timer: 2000
        });
      }
    }
  }

  private async confirmarCompletarPasoYContinuar(): Promise<boolean> {
    const nombrePaso = this.pasoSeleccionadoData?.nombre || `Paso ${this.pasoSeleccionado}`;

    const result = await Swal.fire({
      title: '¿Completar este paso?',
      text: `Se marcará "${nombrePaso}" como completado y continuarás al siguiente paso.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d'
    });

    return result.isConfirmed;
  }

  async siguientePaso(): Promise<void> {
    this.registrarTimelineLog('siguientePaso.intento', { pasoActual: this.pasoSeleccionado });

    const requiereConfirmacionBase =
      this.pasoSeleccionado < 10 &&
      !this.isPasoCompletado(this.pasoSeleccionado) &&
      this.pasoSeleccionado !== 2 && // Ya tiene confirmación contextual cuando aplica
      this.pasoSeleccionado !== 3 && // Ya tiene confirmación específica de cierre de encuesta
      this.pasoSeleccionado !== 7 && // Tiene confirmación con opciones de generación/subida de informe
      this.pasoSeleccionado !== 8;   // Tiene flujo propio de generación de constancias y DC-3

    if (requiereConfirmacionBase) {
      const confirmado = await this.confirmarCompletarPasoYContinuar();
      if (!confirmado) {
        this.registrarTimelineLog('siguientePaso.canceladoConfirmacionBase', { paso: this.pasoSeleccionado });
        return;
      }
    }

    // Paso 2: Checklist - Guardar/reemplazar en Drive y marcar como completado
    if (this.pasoSeleccionado === 2) {
      if (this.guardandoChecklistVerificacionDrive) {
        await Swal.fire({
          title: 'Guardado en progreso',
          text: 'Espera a que termine el guardado del checklist en Drive.',
          icon: 'info',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const yaExiste = !!this.checklistVerificacionArchivo;
      const confirmar = await Swal.fire({
        title: yaExiste
          ? '¿Actualizar lista de verificación?'
          : '¿Guardar checklist y continuar?',
        html: yaExiste
          ? '<p>Se <strong>reemplazará</strong> el archivo anterior en Drive con las verificaciones actuales.</p>'
          : '<p>Se llenará la plantilla <strong>Lista de Verificación (SP-F-08)</strong> en Drive marcando cada respuesta con una <strong>"x"</strong>.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: yaExiste ? 'Sí, actualizar' : 'Guardar y continuar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#38512F',
        cancelButtonColor: '#6c757d'
      });

      if (!confirmar.isConfirmed) {
        return;
      }

      const guardadoChecklist = await this.guardarChecklistVerificacionEnDrive();
      if (!guardadoChecklist) {
        return;
      }

      // Marcar como completado
      if (!this.pasosCompletados.includes(2)) {
        this.pasosCompletados.push(2);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso2Completado');
      }

      // Avanzar al siguiente paso
      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Paso 4: Pase de Lista - Validar asistentes, marcar como completado y avanzar
    if (this.pasoSeleccionado === 4 && !this.isPasoCompletado(4)) {
      const asistentes = this.listaAlumnos.filter(alumno => alumno.asistio === true || alumno.asistio === 1);
      if (asistentes.length === 0) {
        Swal.fire({
          title: 'Sin asistentes',
          text: 'Marca al menos un participante con asistencia para continuar.',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      // Marcar como completado
      if (!this.pasosCompletados.includes(4)) {
        this.pasosCompletados.push(4);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso4Completado');
      }

      // Avanzar al siguiente paso
      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Paso 3: Encuesta - Cerrar encuesta, guardar, marcar como completado y avanzar
    const encuestaActiva = !!this.encuestaCursoUrl || !!this.encuestaEditUrl || (this.encuestaStats?.cerrada === false);
    if (this.pasoSeleccionado === 3 && (!this.isPasoCompletado(3) || encuestaActiva)) {
      const confirmar = await Swal.fire({
        title: 'Cerrar encuesta y continuar',
        html: `<p>Se cerrará la encuesta actual, se guardarán las métricas en Drive y se avanzará al siguiente paso.</p>
               <p class="text-muted small mb-0">Esta acción desvincula el link y el QR del curso programado.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, cerrar y continuar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#38512F',
        cancelButtonColor: '#6c757d'
      });

      if (!confirmar.isConfirmed) {
        return;
      }

      const ok = await this.cerrarEncuestaYGuardarResultados();
      if (!ok) return;

      // Marcar como completado
      if (!this.pasosCompletados.includes(3)) {
        this.pasosCompletados.push(3);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso3Completado');
      }

      // Avanzar al siguiente paso
      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Paso 5: Exámenes - Guardar calificaciones en BD y Drive, marcar como completado
    if (this.pasoSeleccionado === 5 && !this.isPasoCompletado(5)) {
      if (this.subiendoPaso5) {
        this.registrarTimelineLog('paso5.blocked_upload_in_progress');
        await Swal.fire({
          title: 'Subida en progreso',
          text: 'Espera a que termine la carga de archivos de exámenes para continuar.',
          icon: 'info',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      // Regla obligatoria: no se puede avanzar sin PDF de evaluación final subido
      if (!this.evaluacionResueltaSubida) {
        this.registrarTimelineLog('paso5.blocked_missing_final_pdf');
        await Swal.fire({
          title: 'Evaluación final obligatoria',
          text: 'Debes subir el PDF de la evaluación final resuelta para continuar al siguiente paso.',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const ok = await this.guardarCalificacionesFinalesAlContinuar();
      if (!ok) return;

      // Marcar como completado
      if (!this.pasosCompletados.includes(5)) {
        this.pasosCompletados.push(5);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso5Completado');
      }

      // Avanzar al siguiente paso
      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Paso 7: Informe final - elegir descargar o subir a Drive antes de completar
    if (this.pasoSeleccionado === 7 && !this.isPasoCompletado(7)) {
      const ok = await this.confirmarCompletarPaso7ConAccion();
      if (!ok) {
        this.registrarTimelineLog('siguientePaso.paso7Cancelado');
        return;
      }

      if (!this.pasosCompletados.includes(7)) {
        this.pasosCompletados.push(7);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso7Completado');
      }

      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Paso 8: Generar constancias y DC-3 (un botón: subir a Drive + reglas de elegibilidad)
    // DEV: permitir regenerar hasta 3 veces aunque ya esté completado
    if (this.pasoSeleccionado === 8) {
      const ok = await this.generarDocumentosPaso8();
      if (!ok) {
        this.registrarTimelineLog('siguientePaso.paso8Cancelado');
        return;
      }

      if (!this.pasosCompletados.includes(8)) {
        this.pasosCompletados.push(8);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.paso8Completado');
      }

      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
      return;
    }

    // Avanzar al siguiente paso (común para todos los casos)
    if (this.pasoSeleccionado < 10) {
      const pasoActual = this.pasoSeleccionado;

      if (!this.pasosCompletados.includes(pasoActual)) {
        this.pasosCompletados.push(pasoActual);
        this.guardarProgreso();
        this.registrarTimelineLog('siguientePaso.autoCompletado', { paso: pasoActual });
      }

      this.pasoSeleccionado = this.obtenerSiguientePasoPermitido(pasoActual);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('siguientePaso.ok', { nuevoPaso: this.pasoSeleccionado });
    }
  }

  private async guardarCalificacionesFinalesAlContinuar(): Promise<boolean> {
    if (!this.cursoId || (!this.evaluacionResueltaSubida && !this.examenResueltoSubido) || this.alumnosQueAsistieron.length === 0) {
      return true;
    }

    const asistentes = this.alumnosQueAsistieron;
    const usaTeorica = true;
    const usaPractica = true;

    const camposActivos: string[] = [];
    if (usaTeorica) camposActivos.push('escrita');
    if (usaPractica) camposActivos.push('práctica');
    const descripcionCamposActivos = camposActivos.join(' y ');

    // Validar todas las calificaciones antes de guardar
    for (const alumno of asistentes) {
      if (!usaTeorica) {
        alumno.calificacionTeorica = null;
      }
      if (!usaPractica) {
        alumno.calificacionPractica = null;
      }

      const valorTeorico = usaTeorica ? alumno.calificacionTeorica : null;
      const valorPractico = usaPractica ? alumno.calificacionPractica : null;
      if ((valorTeorico === undefined || valorTeorico === null || valorTeorico === '')
        && (valorPractico === undefined || valorPractico === null || valorPractico === '')) {
        continue;
      }

      const tieneTeorica = usaTeorica && valorTeorico !== undefined && valorTeorico !== null && String(valorTeorico).trim() !== '';
      const tienePractica = usaPractica && valorPractico !== undefined && valorPractico !== null && String(valorPractico).trim() !== '';
      const calificacionTeorica = tieneTeorica ? this.parseCalificacionFinal(valorTeorico) : null;
      const calificacionPractica = tienePractica ? this.parseCalificacionFinal(valorPractico) : null;
      if ((tieneTeorica && calificacionTeorica === null) || (tienePractica && calificacionPractica === null)) {
        await Swal.fire({
          title: 'Calificación inválida',
          text: `Verifica las calificaciones de ${alumno.nombre} (${descripcionCamposActivos}). Deben estar entre 0 y 10.`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return false;
      }

      alumno.calificacionTeorica = calificacionTeorica !== null ? calificacionTeorica.toString() : '';
      alumno.calificacionPractica = calificacionPractica !== null ? calificacionPractica.toString() : '';
    }

    try {
      Swal.fire({
        title: 'Guardando calificaciones...',
        text: 'Guardando en base de datos',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      // Guardar calificaciones según modo de captura en la base de datos
      for (const alumno of asistentes) {
        const calificacionTeorica = usaTeorica ? this.parseCalificacionFinal(alumno.calificacionTeorica) : null;
        const calificacionPractica = usaPractica ? this.parseCalificacionFinal(alumno.calificacionPractica) : null;
        const calificacionDiag = this.parseCalificacionFinal(alumno.calificacionDiag);

        await firstValueFrom(
          this.backendServices.actualizarAsistencia(
            alumno.inscripcion_id,
            alumno.asistio,
            alumno.nota || '',
            calificacionTeorica,
            calificacionPractica,
            calificacionDiag
          )
        );
      }

      Swal.close();

      await Swal.fire({
        title: 'Calificaciones guardadas',
        text: `Se guardaron en base de datos para ${asistentes.length} participante(s).`,
        icon: 'success',
        timer: 2200,
        showConfirmButton: false
      });

      this.limpiarCalificacionesBorradorLocal();

      return true;
    } catch (err) {
      Swal.close();
      console.error('❌ Error guardando calificaciones finales:', err);
      await Swal.fire({
        title: 'Error',
        text: 'No se pudieron guardar las calificaciones en la base de datos.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
  }

  private parseCalificacionFinal(valor: any): number | null {
    if (valor === undefined || valor === null) return null;
    const texto = String(valor).trim();
    if (!texto) return null;

    let normalizado = texto.replace(',', '.');

    // Auto-convertir enteros de 2 dígitos > 10: 32 → 3.2, 78 → 7.8 (pero 10 se mantiene como 10)
    if (/^\d{2}$/.test(normalizado) && Number(normalizado) > 10) {
      normalizado = normalizado[0] + '.' + normalizado[1];
    }

    if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;

    const numero = Number(normalizado);
    if (Number.isNaN(numero) || numero < 0 || numero > 10) return null;

    return Math.round(numero * 100) / 100;
  }

  onInformeHorasInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;

    const limpio = this.sanitizarEntradaNumerica(input.value, true, 2);
    input.value = limpio;
    this.informeFinalForm.totalHoras = limpio;
  }

  private sanitizarEntradaNumerica(valor: any, permitirDecimal: boolean = true, maxDecimales: number = 2): string {
    let texto = String(valor ?? '').replace(/,/g, '.').replace(/[^\d.]/g, '');
    if (!texto) return '';

    if (!permitirDecimal) {
      return texto.replace(/\./g, '');
    }

    if (texto.startsWith('.')) {
      texto = `0${texto}`;
    }

    const partes = texto.split('.');
    if (partes.length > 2) {
      texto = `${partes[0]}.${partes.slice(1).join('')}`;
    }

    const [entero = '', decimal = ''] = texto.split('.');
    const decimalRecortado = decimal.slice(0, maxDecimales);
    return decimal.length > 0 ? `${entero}.${decimalRecortado}` : entero;
  }

  getFotoEvidenciaPreview(foto: any): string {
    if (!foto) return '';
    return foto.previewUrl || foto.url || '';
  }

  getFotoEvidenciaHref(foto: any): string {
    if (!foto) return '#';
    return foto.href || foto.url || '#';
  }

  obtenerPromedioCalificacionesAlumno(alumno: any): number | null {
    const teorica = this.parseCalificacionFinal(alumno?.calificacionTeorica);
    const practica = this.parseCalificacionFinal(alumno?.calificacionPractica);
    const valores = [teorica, practica].filter((n): n is number => n !== null);
    if (valores.length === 0) return null;
    const promedio = valores.reduce((acc, n) => acc + n, 0) / valores.length;
    return Math.round(promedio * 100) / 100;
  }

  private async cerrarEncuestaYGuardarResultados(): Promise<boolean> {
    if (!this.cursoId || this.cerrandoEncuesta) return false;

    this.cerrandoEncuesta = true;
    this.detenerAutoRefreshEncuestaStats();

    try {
      Swal.fire({
        title: 'Cerrando encuesta...',
        text: 'Guardando métricas en Drive',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      const response: any = await firstValueFrom(this.backendServices.cerrarEncuestaProgramado(this.cursoId));
      Swal.close();

      if (!response?.success) {
        Swal.fire({
          title: 'No se pudo cerrar',
          text: response?.message || 'No fue posible cerrar la encuesta.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return false;
      }

      this.encuestaCursoUrl = '';
      this.encuestaEditUrl = '';
      this.encuestaStats = {
        ...(this.encuestaStats || {}),
        cerrada: true,
        encuesta_url: '',
        total_respuestas: response.total_respuestas ?? this.encuestaStats?.total_respuestas ?? 0
      };
      this.encuestaStatsUltimaActualizacion = new Date();
      this.destruirEncuestaPieCharts();

      Swal.fire({
        title: 'Encuesta cerrada',
        text: `Resultados guardados en Drive (${response.total_respuestas || 0} respuestas).`,
        icon: 'success',
        timer: 1800,
        showConfirmButton: false
      });

      return true;
    } catch (err: any) {
      Swal.close();
      Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'Ocurrió un error al cerrar la encuesta.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    } finally {
      this.cerrandoEncuesta = false;
      if (this.pasoSeleccionado === 3 && this.encuestaCursoUrl) {
        this.iniciarAutoRefreshEncuestaStats();
      }
    }
  }

  async habilitarEncuesta(): Promise<void> {
    if (!this.cursoId || this.reactivandoEncuesta || this.cerrandoEncuesta) return;

    const confirmar = await Swal.fire({
      title: '¿Habilitar encuesta nuevamente?',
      html: `<p>Se reactivará la encuesta para seguir recibiendo respuestas.</p>
             <p class="text-muted small mb-0">Las métricas actuales se conservan y las nuevas respuestas se sumarán automáticamente.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, habilitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d'
    });

    if (!confirmar.isConfirmed) {
      return;
    }

    this.reactivandoEncuesta = true;

    try {
      Swal.fire({
        title: 'Habilitando encuesta...',
        text: 'Abriendo formulario y restaurando vínculo',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      const response: any = await firstValueFrom(this.backendServices.habilitarEncuestaProgramado(this.cursoId));
      Swal.close();

      if (!response?.success) {
        Swal.fire({
          title: 'No se pudo habilitar',
          text: response?.message || 'No fue posible habilitar la encuesta.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      this.encuestaCursoUrl = response.encuesta_url || '';
      this.encuestaEditUrl = response.encuesta_edit_url || '';
      this.encuestaStatsError = '';
      if (this.encuestaStats) {
        this.encuestaStats.cerrada = false;
      }

      this.cargarEncuestaStats(true);
      if (this.pasoSeleccionado === 3) {
        this.iniciarAutoRefreshEncuestaStats();
      }

      Swal.fire({
        title: 'Encuesta habilitada',
        text: 'Ya puedes compartir nuevamente el enlace y seguir acumulando respuestas.',
        icon: 'success',
        timer: 1800,
        showConfirmButton: false
      });
    } catch (err: any) {
      Swal.close();
      Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'Ocurrió un error al habilitar la encuesta.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.reactivandoEncuesta = false;
    }
  }

  pasoAnterior(): void {
    if (this.pasoSeleccionado > 1) {
      this.registrarTimelineLog('pasoAnterior.intento', { pasoActual: this.pasoSeleccionado });
      this.pasoSeleccionado = this.obtenerPasoAnteriorPermitido(this.pasoSeleccionado);
      this.sincronizarVistaEncuestaSegunPaso(this.pasoSeleccionado);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('pasoAnterior.ok', { nuevoPaso: this.pasoSeleccionado });
    }
  }

  private restaurarPasoSeleccionado(): void {
    if (this.esAdmin && !this.adminEnModoGestion) {
      const solicitado = this.obtenerPasoSolicitadoNavegacion();
      const guardado = this.obtenerPasoActualLocal();
      this.pasoSeleccionado = this.normalizarPasoPermitido(solicitado ?? guardado ?? 8);
      this.guardarPasoActualLocal();
      this.registrarTimelineLog('restaurarPasoSeleccionado', {
        solicitado,
        guardado,
        aplicado: this.pasoSeleccionado,
        admin: true
      });
      return;
    }
    const guardado = this.obtenerPasoActualLocal();
    const fallback = this.obtenerPasoPorDefecto();
    const objetivo = this.normalizarPasoPermitido(guardado ?? fallback);
    this.pasoSeleccionado = objetivo;
    this.guardarPasoActualLocal();
    this.registrarTimelineLog('restaurarPasoSeleccionado', {
      guardado,
      fallback,
      aplicado: objetivo,
      pasosCompletados: this.pasosCompletados
    });
  }

  private obtenerPasoPorDefecto(): number {
    const primerPendiente = this.pasosCurso.find(p => !this.isPasoCompletado(p.numero));
    if (primerPendiente) {
      return this.normalizarPasoPermitido(primerPendiente.numero);
    }
    return this.normalizarPasoPermitido(10);
  }

  private normalizarPasoPermitido(numero: number): number {
    if (this.esAdmin && !this.adminEnModoGestion) {
      const pasoAdmin = Number(numero);
      return this.pasosAccesiblesAdminCursoAjeno.includes(pasoAdmin) ? pasoAdmin : 8;
    }

    let paso = Number(numero);
    if (Number.isNaN(paso)) paso = 1;
    if (paso < 1) paso = 1;
    if (paso > 10) paso = 10;

    if (this.estaPasoBloqueado(paso)) {
      return 5;
    }

    return paso;
  }

  private estaPasoBloqueado(_numero: number): boolean {
    // Se permite regresar al paso de encuesta aunque ya se haya completado.
    return false;
  }

  private obtenerSiguientePasoPermitido(actual: number): number {
    let paso = actual;
    while (paso < 10) {
      paso += 1;
      if (!this.estaPasoBloqueado(paso)) {
        return paso;
      }
    }
    return 10;
  }

  private obtenerPasoAnteriorPermitido(actual: number): number {
    let paso = actual;
    while (paso > 1) {
      paso -= 1;
      if (!this.estaPasoBloqueado(paso)) {
        return paso;
      }
    }
    return 1;
  }

  private getPasoStorageKey(): string | null {
    if (!this.cursoId) return null;
    return `${this.timelinePasoStoragePrefix}${this.cursoId}`;
  }

  private obtenerPasoSolicitadoNavegacion(): number | null {
    const valor = this.route.snapshot.queryParamMap.get('paso');
    if (!valor) return null;
    const numero = Number(valor);
    return Number.isNaN(numero) ? null : numero;
  }

  private getInformeDraftStorageKey(): string | null {
    if (!this.cursoId) return null;
    return `${this.timelineInformeDraftStoragePrefix}${this.cursoId}`;
  }

  private getCalificacionesDraftStorageKey(): string | null {
    if (!this.cursoId) return null;
    return `${this.timelineCalificacionesDraftStoragePrefix}${this.cursoId}`;
  }

  private getChecklistDraftStorageKey(): string | null {
    if (!this.cursoId) return null;
    return `${this.timelineChecklistDraftStoragePrefix}${this.cursoId}`;
  }

  private normalizarChecklistSnapshotKey(item: any): string {
    const categoria = String(item?.categoria || '').trim().toLowerCase();
    const concepto = String(item?.concepto || '').trim().toLowerCase();
    return `${categoria}|${concepto}`;
  }

  private construirSnapshotChecklistBorrador(): any {
    return {
      version: 1,
      cursoId: this.cursoId,
      items: this.checklistVerificacionItems.map((item) => ({
        fila: item?.fila ?? null,
        categoria: String(item?.categoria || ''),
        concepto: String(item?.concepto || ''),
        cumple: item?.cumple === true ? true : (item?.cumple === false ? false : null),
        userAdded: item?.userAdded === true
      }))
    };
  }

  private aplicarSnapshotChecklistBorrador(snapshot: any): void {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const base = this.crearPlantillaChecklistVerificacion();
    const mapa = new Map<string, any>();
    const agregados: any[] = [];

    for (const item of items) {
      if (!item) continue;
      if (item.userAdded === true) {
        const concepto = String(item?.concepto || '').trim();
        if (!concepto) continue;
        agregados.push({
          fila: null,
          categoria: String(item?.categoria || 'Equipo'),
          concepto,
          cumple: item?.cumple === true ? true : (item?.cumple === false ? false : null),
          userAdded: true
        });
        continue;
      }
      const key = this.normalizarChecklistSnapshotKey(item);
      if (key !== '|') {
        mapa.set(key, item);
      }
    }

    const actualizados = base.map((item) => {
      const key = this.normalizarChecklistSnapshotKey(item);
      if (mapa.has(key)) {
        const snapshotItem = mapa.get(key);
        item.cumple = snapshotItem?.cumple === true
          ? true
          : (snapshotItem?.cumple === false ? false : null);
      }
      return item;
    });

    this.checklistVerificacionItems = [...actualizados, ...agregados];
  }

  private restaurarChecklistBorradorLocal(): void {
    const key = this.getChecklistDraftStorageKey();
    if (!key) return;

    const raw = localStorage.getItem(key);
    if (!raw) return;

    try {
      const snapshot = JSON.parse(raw);
      this.aplicarSnapshotChecklistBorrador(snapshot);
      this.huellaChecklistBorrador = JSON.stringify(this.construirSnapshotChecklistBorrador());
    } catch (_) {
      this.huellaChecklistBorrador = '';
    }
  }

  private guardarChecklistBorradorLocal(): boolean {
    const key = this.getChecklistDraftStorageKey();
    if (!key) return false;

    try {
      const snapshot = this.construirSnapshotChecklistBorrador();
      const serializado = JSON.stringify(snapshot);

      if (serializado === this.huellaChecklistBorrador) {
        return true;
      }

      localStorage.setItem(key, serializado);
      this.huellaChecklistBorrador = serializado;
      return true;
    } catch (_) {
      return false;
    }
  }

  private valorCalificacionVacio(valor: any): boolean {
    return valor === undefined || valor === null || String(valor).trim() === '';
  }

  private construirSnapshotCalificacionesBorrador(): any {
    const lista = Array.isArray(this.listaAlumnos) ? this.listaAlumnos : [];
    const participantes: any[] = [];

    for (const alumno of lista) {
      const inscripcionId = Number(alumno?.inscripcion_id);
      if (!Number.isFinite(inscripcionId) || inscripcionId <= 0) {
        continue;
      }

      const calificacionTeorica = this.valorCalificacionVacio(alumno?.calificacionTeorica)
        ? ''
        : String(alumno.calificacionTeorica).trim();
      const calificacionPractica = this.valorCalificacionVacio(alumno?.calificacionPractica)
        ? ''
        : String(alumno.calificacionPractica).trim();
      const calificacionDiag = this.valorCalificacionVacio(alumno?.calificacionDiag)
        ? ''
        : String(alumno.calificacionDiag).trim();

      if (!calificacionTeorica && !calificacionPractica && !calificacionDiag) {
        continue;
      }

      participantes.push({
        inscripcion_id: inscripcionId,
        calificacionTeorica,
        calificacionPractica,
        calificacionDiag
      });
    }

    return {
      version: 1,
      cursoId: this.cursoId,
      participantes
    };
  }

  private aplicarSnapshotCalificacionesBorrador(snapshot: any): void {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const participantes = Array.isArray(snapshot.participantes) ? snapshot.participantes : [];
    if (participantes.length === 0 || !Array.isArray(this.listaAlumnos) || this.listaAlumnos.length === 0) {
      return;
    }

    const alumnosPorInscripcion = new Map<number, any>();
    for (const alumno of this.listaAlumnos) {
      const inscripcionId = Number(alumno?.inscripcion_id);
      if (Number.isFinite(inscripcionId) && inscripcionId > 0) {
        alumnosPorInscripcion.set(inscripcionId, alumno);
      }
    }

    for (const draft of participantes) {
      const inscripcionId = Number(draft?.inscripcion_id);
      if (!Number.isFinite(inscripcionId) || inscripcionId <= 0) {
        continue;
      }

      const alumno = alumnosPorInscripcion.get(inscripcionId);
      if (!alumno) {
        continue;
      }

      const calificacionTeorica = this.valorCalificacionVacio(draft?.calificacionTeorica)
        ? ''
        : String(draft.calificacionTeorica).trim();
      const calificacionPractica = this.valorCalificacionVacio(draft?.calificacionPractica)
        ? ''
        : String(draft.calificacionPractica).trim();
      const calificacionDiag = this.valorCalificacionVacio(draft?.calificacionDiag)
        ? ''
        : String(draft.calificacionDiag).trim();

      // Solo rellenar campos vacíos para no sobreescribir calificaciones ya guardadas en BD.
      if (calificacionTeorica && this.valorCalificacionVacio(alumno.calificacionTeorica)) {
        alumno.calificacionTeorica = calificacionTeorica;
      }
      if (calificacionPractica && this.valorCalificacionVacio(alumno.calificacionPractica)) {
        alumno.calificacionPractica = calificacionPractica;
      }
      if (calificacionDiag && this.valorCalificacionVacio(alumno.calificacionDiag)) {
        alumno.calificacionDiag = calificacionDiag;
      }
    }
  }

  private restaurarCalificacionesBorradorLocal(): void {
    const key = this.getCalificacionesDraftStorageKey();
    if (!key) return;

    const raw = localStorage.getItem(key);
    if (!raw) {
      this.huellaCalificacionesBorrador = '';
      return;
    }

    try {
      const snapshot = JSON.parse(raw);
      this.aplicarSnapshotCalificacionesBorrador(snapshot);
      this.huellaCalificacionesBorrador = JSON.stringify(this.construirSnapshotCalificacionesBorrador());
    } catch (_) {
      this.huellaCalificacionesBorrador = '';
    }
  }

  private guardarCalificacionesBorradorLocal(): void {
    const key = this.getCalificacionesDraftStorageKey();
    if (!key) return;

    try {
      const snapshot = this.construirSnapshotCalificacionesBorrador();
      const serializado = JSON.stringify(snapshot);

      if (serializado === this.huellaCalificacionesBorrador) {
        return;
      }

      if (!Array.isArray(snapshot.participantes) || snapshot.participantes.length === 0) {
        localStorage.removeItem(key);
        this.huellaCalificacionesBorrador = '';
        return;
      }

      localStorage.setItem(key, serializado);
      this.huellaCalificacionesBorrador = serializado;
    } catch (_) { }
  }

  private limpiarCalificacionesBorradorLocal(): void {
    const key = this.getCalificacionesDraftStorageKey();
    if (!key) return;

    try {
      localStorage.removeItem(key);
    } catch (_) { }

    this.huellaCalificacionesBorrador = '';
  }

  private guardarPasoActualLocal(): void {
    const key = this.getPasoStorageKey();
    if (!key) return;
    localStorage.setItem(key, String(this.pasoSeleccionado));
  }

  private obtenerPasoActualLocal(): number | null {
    const key = this.getPasoStorageKey();
    if (!key) return null;
    const valor = localStorage.getItem(key);
    if (!valor) return null;
    const numero = Number(valor);
    return Number.isNaN(numero) ? null : numero;
  }

  private normalizarObjetivosInformeBorrador(objetivos: any): { texto: string; porcentaje: string; comentarios: string }[] {
    const lista = Array.isArray(objetivos) ? objetivos : [];
    const normalizados = lista.map((objetivo: any) => ({
      texto: String(objetivo?.texto || ''),
      porcentaje: String(objetivo?.porcentaje || '100'),
      comentarios: String(objetivo?.comentarios || '')
    }));

    return normalizados.length > 0
      ? normalizados
      : [{ texto: '', porcentaje: '100', comentarios: '' }];
  }

  private construirSnapshotInformeBorrador(): any {
    const totalHorasNormalizado = this.sanitizarEntradaNumerica(
      this.informeFinalForm.totalHoras || this.informeTotalHorasDefault,
      true,
      2
    );

    return {
      version: 1,
      cursoId: this.cursoId,
      usarEmpresaComoSolicitante: this.usarEmpresaComoSolicitante,
      personaSolicitanteManual: String(this.personaSolicitanteManual || '').trim(),
      informeFinalForm: {
        ...this.informeFinalForm,
        objetivos: this.normalizarObjetivosInformeBorrador(this.informeFinalForm.objetivos),
        totalHoras: totalHorasNormalizado
      }
    };
  }

  private aplicarSnapshotInformeBorrador(snapshot: any): void {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const form = snapshot?.informeFinalForm || {};

    this.usarEmpresaComoSolicitante = !!snapshot?.usarEmpresaComoSolicitante;
    if (snapshot?.personaSolicitanteManual !== undefined && snapshot?.personaSolicitanteManual !== null) {
      this.personaSolicitanteManual = String(snapshot.personaSolicitanteManual).trim();
    }

    this.informeFinalForm.objetivos = this.normalizarObjetivosInformeBorrador(form.objetivos);
    this.informeFinalForm.expectativasTexto = String(form.expectativasTexto ?? this.informeFinalForm.expectativasTexto ?? '');
    this.informeFinalForm.expectativasPorcentaje = this.sanitizarEntradaNumerica(
      form.expectativasPorcentaje ?? this.informeFinalForm.expectativasPorcentaje,
      true,
      2
    ) || '100';
    this.informeFinalForm.expectativasComentarios = String(form.expectativasComentarios ?? this.informeFinalForm.expectativasComentarios ?? '');
    this.informeFinalForm.recomendacionesProceso = String(form.recomendacionesProceso ?? this.informeFinalForm.recomendacionesProceso ?? '');
    this.informeFinalForm.recomendacionesGrupo = String(form.recomendacionesGrupo ?? this.informeFinalForm.recomendacionesGrupo ?? '');
    this.informeFinalForm.areasOportunidad = String(form.areasOportunidad ?? this.informeFinalForm.areasOportunidad ?? '');
    this.informeFinalForm.mejoresPracticas = String(form.mejoresPracticas ?? this.informeFinalForm.mejoresPracticas ?? '');
    this.informeFinalForm.contingencias = String(form.contingencias ?? this.informeFinalForm.contingencias ?? '');
    this.informeFinalForm.accionCorrectiva = String(form.accionCorrectiva ?? this.informeFinalForm.accionCorrectiva ?? '');
    this.informeFinalForm.ajustesPrograma = String(form.ajustesPrograma ?? this.informeFinalForm.ajustesPrograma ?? '');
    this.informeFinalForm.sugerenciasParticipantes = String(form.sugerenciasParticipantes ?? this.informeFinalForm.sugerenciasParticipantes ?? '');

    const totalHorasNormalizado = this.sanitizarEntradaNumerica(
      form.totalHoras ?? this.informeFinalForm.totalHoras,
      true,
      2
    );
    if (totalHorasNormalizado) {
      this.informeFinalForm.totalHoras = totalHorasNormalizado;
    }
  }

  private restaurarInformeFinalBorradorLocal(): void {
    const key = this.getInformeDraftStorageKey();
    if (!key) return;

    const raw = localStorage.getItem(key);
    if (!raw) return;

    try {
      const snapshot = JSON.parse(raw);
      this.aplicarSnapshotInformeBorrador(snapshot);
      this.huellaInformeBorrador = JSON.stringify(this.construirSnapshotInformeBorrador());
    } catch (_) {
      this.huellaInformeBorrador = '';
    }
  }

  private guardarInformeFinalBorradorLocal(silencioso: boolean = true): boolean {
    const key = this.getInformeDraftStorageKey();
    if (!key) return false;

    try {
      const snapshot = this.construirSnapshotInformeBorrador();
      const serializado = JSON.stringify(snapshot);

      if (serializado === this.huellaInformeBorrador) {
        if (!silencioso) {
          Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: 'No hay cambios pendientes',
            showConfirmButton: false,
            timer: 1600
          });
        }
        return true;
      }

      localStorage.setItem(key, serializado);
      this.huellaInformeBorrador = serializado;

      if (!silencioso) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Informe actualizado',
          showConfirmButton: false,
          timer: 1700
        });
      }

      return true;
    } catch (_) {
      if (!silencioso) {
        Swal.fire({
          title: 'Error',
          text: 'No se pudo guardar el borrador del informe en este momento.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
      return false;
    }
  }

  guardarInformeFinalBorradorManual(): void {
    this.guardarInformeFinalBorradorLocal(false);
  }

  private iniciarAutoGuardadoInformeFinal(): void {
    if (!this.cursoId) return;

    this.detenerAutoGuardadoInformeFinal();
    this.autosaveInformeBorradorTimer = setInterval(() => {
      this.guardarInformeFinalBorradorLocal(true);
    }, 2000);
  }

  private detenerAutoGuardadoInformeFinal(): void {
    if (!this.autosaveInformeBorradorTimer) return;
    clearInterval(this.autosaveInformeBorradorTimer);
    this.autosaveInformeBorradorTimer = null;
  }

  private registrarTimelineLog(evento: string, payload: any = {}): void {
    const item = {
      at: new Date().toISOString(),
      evento,
      pasoActual: this.pasoSeleccionado,
      payload
    };

    try {
      const key = `${this.timelineDebugLogPrefix}${this.cursoId || 'na'}`;
      const raw = localStorage.getItem(key);
      const historial = raw ? JSON.parse(raw) : [];
      historial.push(item);
      const ultimos = historial.slice(-300);
      localStorage.setItem(key, JSON.stringify(ultimos));
    } catch (_) { }

  }

  verPDF(tipo: string): void {
    if (!this.cursoId) {
      Swal.fire({ title: 'Error', text: 'No se pudo identificar el curso', icon: 'error', confirmButtonColor: '#38512F' });
      return;
    }

    // Buscar en documentos ya cargados primero
    const docLocal = this.getDocumento(tipo);
    if (docLocal && docLocal.tieneArchivo) {
      this.documentPreview.abrir({
        nombre: docLocal.nombre || tipo,
        archivo_nombre: docLocal.archivo_nombre,
        archivo_url: docLocal.archivo_url,
        documento_id: docLocal.documento_id,
        curso_id: docLocal.curso_id
      });
      return;
    }

    // Si no está en caché, consultar el endpoint
    this.backendServices.obtenerDocumentoCursoPorTipo(this.cursoId, tipo).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (!response.success || !response.existe) {
          const disponibles = response.documentosDisponibles ? response.documentosDisponibles.join(', ') : '';
          Swal.fire({
            title: 'No disponible',
            html: `No se encontró <strong>${tipo}</strong> para este curso.${disponibles ? '<br><small class="text-muted">Documentos disponibles: ' + disponibles + '</small>' : ''}`,
            icon: 'warning',
            confirmButtonColor: '#38512F'
          });
          return;
        }

        if (!response.tieneArchivo) {
          Swal.fire({
            title: 'Archivo no disponible',
            text: `El documento "${response.documento.nombre}" aún no ha sido subido a Google Drive`,
            icon: 'info',
            confirmButtonColor: '#38512F'
          });
          return;
        }

        // Abrir con el servicio global de previsualización
        this.documentPreview.abrir({
          nombre: response.documento.nombre || tipo,
          archivo_nombre: response.documento.archivo_nombre,
          archivo_url: response.documento.archivo_url,
          documento_id: response.documento.documento_id,
          curso_id: response.documento.curso_id
        });
      },
      error: (err) => {
        console.error('❌ Error obteniendo documento:', err);
        Swal.fire({ title: 'Error', text: 'No se pudo cargar el documento.', icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  cargarEncuestaConfig(): void {
    if (!this.cursoId) return;
    if (this.cargandoEncuesta) return; // Evitar llamadas concurrentes
    this.cargandoEncuesta = true;
    this.backendServices.obtenerEncuestaConfigProgramado(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.encuestaCursoUrl = response.encuesta_url || '';
          this.encuestaEditUrl = response.encuesta_edit_url || '';
          this.cargarEncuestaStats(true);
          this.evaluarAutoCierreEncuesta();
          if (this.pasoSeleccionado === 3) {
            this.iniciarAutoRefreshEncuestaStats();
          }
        }
        this.cargandoEncuesta = false;
      },
      error: (err: any) => {
        console.error('Error al cargar config de encuesta:', err);
        this.cargandoEncuesta = false;
      }
    });
  }

  private iniciarAutoRefreshEncuestaStats(): void {
    if (!this.cursoId) return;
    this.detenerAutoRefreshEncuestaStats();

    this.cargarEncuestaStats(false);
    this.encuestaStatsTimer = setInterval(() => {
      this.cargarEncuestaStats(false);
    }, this.encuestaStatsPollMs);
  }

  private detenerAutoRefreshEncuestaStats(): void {
    if (this.encuestaStatsTimer) {
      clearInterval(this.encuestaStatsTimer);
      this.encuestaStatsTimer = null;
    }
    this.encuestaStatsRequestInFlight = false;
  }

  cargarEncuestaStats(mostrarLoader: boolean = false): void {
    if (!this.cursoId) return;
    if (this.encuestaStatsRequestInFlight) return;

    this.encuestaStatsRequestInFlight = true;
    if (mostrarLoader) {
      this.cargandoEncuestaStats = true;
    }

    this.backendServices.obtenerEncuestaStatsProgramado(this.cursoId, Date.now()).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.encuestaStats = response;
          this.encuestaStatsError = '';
          if (response.encuesta_url) {
            this.encuestaCursoUrl = response.encuesta_url;
          }
          this.encuestaStatsUltimaActualizacion = new Date();
          setTimeout(() => this.renderEncuestaPieCharts(), 0);
        }
        this.encuestaStatsRequestInFlight = false;
        this.cargandoEncuestaStats = false;
      },
      error: (err: any) => {
        console.error('Error cargando estadísticas de encuesta:', err);
        this.encuestaStatsError = 'No se pudieron cargar las estadísticas en vivo.';
        this.destruirEncuestaPieCharts();
        this.encuestaStatsRequestInFlight = false;
        this.cargandoEncuestaStats = false;
      }
    });
  }

  getEncuestaColor(index: number): string {
    return this.encuestaPalette[index % this.encuestaPalette.length];
  }

  private destruirEncuestaPieCharts(): void {
    Object.values(this.encuestaPieCharts).forEach((chart) => {
      try { chart.destroy(); } catch (e) { }
    });
    this.encuestaPieCharts = {};
  }

  private renderEncuestaPieCharts(): void {
    if (this.pasoSeleccionado !== 3 || !this.encuestaStats?.preguntas) {
      this.destruirEncuestaPieCharts();
      return;
    }

    this.destruirEncuestaPieCharts();

    this.encuestaStats.preguntas.forEach((pregunta: any, idx: number) => {
      if (pregunta?.type !== 'choice' || !(pregunta.options || []).length) return;

      const canvas = document.getElementById(`encuesta-pie-${idx}`) as HTMLCanvasElement | null;
      if (!canvas) return;

      const labels = (pregunta.options || []).map((op: any) => op.label || 'Opción');
      const data = (pregunta.options || []).map((op: any) => Number(op.count || 0));
      const colors = labels.map((_: string, optionIndex: number) => this.getEncuestaColor(optionIndex));

      this.encuestaPieCharts[idx] = new Chart(canvas, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors,
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          legend: { display: false },
          tooltips: {
            callbacks: {
              label: (tooltipItem: any, tooltipData: any) => {
                const value = Number((tooltipData?.datasets?.[0]?.data || [])[tooltipItem.index] || 0);
                const total = (tooltipData?.datasets?.[0]?.data || []).reduce((acc: number, val: any) => acc + Number(val || 0), 0);
                const percent = total > 0 ? Math.round((value / total) * 100) : 0;
                const label = (tooltipData?.labels || [])[tooltipItem.index] || 'Opción';
                return `${label}: ${value} (${percent}%)`;
              }
            }
          }
        }
      });
    });
  }

  copiarLink(link: string): void {
    // Copiar al portapapeles
    navigator.clipboard.writeText(link).then(() => {
      Swal.fire({
        title: '¡Copiado!',
        text: 'Link copiado al portapapeles',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });
    }).catch(() => {
      // Fallback para navegadores que no soportan clipboard API
      const input = document.getElementById('linkEncuesta') as HTMLInputElement;
      if (input) {
        input.select();
        document.execCommand('copy');
        Swal.fire({
          title: '¡Copiado!',
          text: 'Link copiado al portapapeles',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });
      }
    });
  }

  async mostrarQREncuesta(): Promise<void> {
    const link = (this.encuestaCursoUrl || '').trim();
    if (!link) {
      Swal.fire({
        title: 'Sin enlace',
        text: 'No hay URL de encuesta disponible para generar el QR.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(link, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M'
      });

      const resultado = await Swal.fire({
        title: 'QR de encuesta',
        html: `
          <div class="text-center">
            <img src="${qrDataUrl}" alt="QR encuesta" style="width: 260px; max-width: 100%; height: auto; border: 1px solid #eee; border-radius: 8px; padding: 8px; background: #fff;" />
            <p class="text-muted small mt-2 mb-0">Escanea para abrir el formulario actual.</p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Descargar PNG',
        cancelButtonText: 'Cerrar',
        confirmButtonColor: '#38512F',
        width: 420
      });

      if (resultado.isConfirmed) {
        const nombreCursoSeguro = (this.nombreCurso || 'encuesta').replace(/[^a-zA-Z0-9]+/g, '_');
        const a = document.createElement('a');
        a.href = qrDataUrl;
        a.download = `QR_Encuesta_${nombreCursoSeguro}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('❌ Error generando QR de encuesta:', error);
      Swal.fire({
        title: 'Error',
        text: 'No se pudo generar el código QR del enlace.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  descargarFormatoPDF(tipo: string): void {
    if (!this.cursoId) {
      Swal.fire({ title: 'Error', text: 'No se pudo identificar el curso', icon: 'error', confirmButtonColor: '#38512F' });
      return;
    }

    Swal.fire({
      title: `Descargando ${tipo}...`,
      text: 'Preparando descarga desde Google Drive',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.backendServices.obtenerDocumentoCursoPorTipo(this.cursoId, tipo).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (!response.success || !response.existe) {
          Swal.close();
          Swal.fire({ title: 'No disponible', text: `No se encontró ${tipo} para este curso`, icon: 'warning', confirmButtonColor: '#38512F' });
          return;
        }

        if (!response.tieneArchivo) {
          Swal.close();
          Swal.fire({ title: 'Archivo no disponible', text: `El documento "${response.documento.nombre}" aún no ha sido subido a Google Drive`, icon: 'info', confirmButtonColor: '#38512F' });
          return;
        }

        const documentoId = response.documento.documento_id;
        const cursoId = response.documento.curso_id;
        const nombreArchivo = response.documento.archivo_nombre || `${tipo}.pdf`;

        this.backendServices.descargarArchivoDocumento(cursoId, documentoId).pipe(takeUntil(this.destroy$)).subscribe({
          next: (blob: Blob) => {
            Swal.close();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = nombreArchivo;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
            Swal.fire({ title: '¡Descargando!', text: `${tipo} descargándose...`, icon: 'success', timer: 2000, showConfirmButton: false });
          },
          error: (err) => {
            Swal.close();
            console.error('❌ Error descargando archivo:', err);
            Swal.fire({ title: 'Error', text: 'No se pudo descargar el documento.', icon: 'error', confirmButtonColor: '#38512F' });
          }
        });
      },
      error: (err) => {
        Swal.close();
        console.error('❌ Error obteniendo documento:', err);
        Swal.fire({ title: 'Error', text: 'No se pudo cargar el documento.', icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  descargarDocumento(alumno: any, tipo: string): void {
    Swal.fire({
      title: 'Descargando...',
      text: `Generando ${tipo} para ${alumno.nombre}`,
      icon: 'success',
      timer: 1500,
      showConfirmButton: false
    });
  }

  // ========== SUBIDA GLOBAL DE EXÁMENES RESUELTOS ==========

  onDragOver(event: DragEvent, tipo: string = 'diagnostico'): void {
    event.preventDefault();
    event.stopPropagation();
    if (tipo === 'final') {
      this.arrastrandoEvaluacion = true;
    } else {
      this.arrastrando = true;
    }
  }

  onDragLeave(event: DragEvent, tipo: string = 'diagnostico'): void {
    event.preventDefault();
    event.stopPropagation();
    if (tipo === 'final') {
      this.arrastrandoEvaluacion = false;
    } else {
      this.arrastrando = false;
    }
  }

  onDrop(event: DragEvent, tipo: string = 'diagnostico'): void {
    try {
      event.preventDefault();
      event.stopPropagation();
      if (tipo === 'final') {
        this.arrastrandoEvaluacion = false;
      } else {
        this.arrastrando = false;
      }

      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        this.validarYAsignarArchivo(files[0], tipo);
      }
    } catch (error) {
      console.error('❌ Error al soltar archivo de examen:', error);
      Swal.fire({ title: 'Error', text: 'No se pudo procesar el archivo.', icon: 'error', confirmButtonColor: '#38512F' });
    }
  }

  onArchivoSeleccionado(event: Event, tipo: string = 'diagnostico'): void {
    try {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files.length > 0) {
        this.validarYAsignarArchivo(input.files[0], tipo);
      }
      this.limpiarFocoInputArchivo(input);
    } catch (error) {
      console.error('❌ Error al seleccionar archivo de examen:', error);
      Swal.fire({ title: 'Error', text: 'No se pudo leer el archivo seleccionado.', icon: 'error', confirmButtonColor: '#38512F' });
    }
  }

  /** PDFs escaneados de evaluación pueden ser más pesados que otros documentos del timeline */
  private static readonly MAX_EXAMEN_RESUELTO_MB = 512;

  private validarYAsignarArchivo(file: File, tipo: string): void {
    try {
      if (!file || file.type !== 'application/pdf') {
        Swal.fire({
          title: 'Formato no válido',
          text: 'Solo se permiten archivos PDF',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const maxBytes = TimelineCursoComponent.MAX_EXAMEN_RESUELTO_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        Swal.fire({
          title: 'Archivo muy grande',
          text: `El PDF pesa ${sizeMb} MB. El máximo permitido es ${TimelineCursoComponent.MAX_EXAMEN_RESUELTO_MB} MB. Comprima el archivo o reduzca la resolución del escaneo.`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (tipo === 'final') {
        this.evaluacionResueltaArchivo = file;
      } else {
        this.examenResueltoArchivo = file;
      }
    } catch (error) {
      console.error('❌ Error validando archivo de examen:', error);
      Swal.fire({ title: 'Error', text: 'No se pudo validar el archivo.', icon: 'error', confirmButtonColor: '#38512F' });
    }
  }

  subirExamenResuelto(tipo: string = 'diagnostico'): void {
    try {
      this.paso5ErrorMensaje = '';
      const archivo = tipo === 'final' ? this.evaluacionResueltaArchivo : this.examenResueltoArchivo;
      if (!archivo || !this.cursoId) return;

      if (this.subiendoPaso5) {
        return;
      }

      this.registrarTimelineLog('paso5.upload.inicio', {
        tipo,
        nombre: archivo.name,
        sizeMB: Number((archivo.size / 1024 / 1024).toFixed(2))
      });

      if (tipo === 'final') {
        this.subiendoEvaluacionResuelta = true;
      } else {
        this.subiendoExamenResuelto = true;
      }

      this.backendServices.subirExamenResuelto(this.cursoId, archivo, tipo).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          if (tipo === 'final') {
            this.subiendoEvaluacionResuelta = false;
          } else {
            this.subiendoExamenResuelto = false;
          }

          if (response.success) {
            const archivoSubido = response.archivo || {};
            const documentoProgId = archivoSubido.id ?? archivoSubido.documento_prog_id ?? null;
            const archivoNormalizado = {
              ...archivoSubido,
              id: documentoProgId,
              documento_prog_id: documentoProgId
            };

            if (tipo === 'final') {
              this.evaluacionResueltaSubida = archivoNormalizado;
              this.evaluacionResueltaArchivo = null;
            } else {
              this.examenResueltoSubido = archivoNormalizado;
              this.examenResueltoArchivo = null;
            }

            // Refresca desde BD para mantener consistencia de IDs y metadatos.
            this.cargarDocumentosProgramado();

            this.registrarTimelineLog('paso5.upload.ok', { tipo, archivo: response.archivo?.nombre || null });

            const label = tipo === 'final' ? 'Evaluaciones resueltas' : 'Exámenes resueltos';
            Swal.fire({
              title: '¡Subido!',
              text: `${label} subido exitosamente a Drive`,
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2500
            });
          }
        },
        error: (err) => {
          if (tipo === 'final') {
            this.subiendoEvaluacionResuelta = false;
          } else {
            this.subiendoExamenResuelto = false;
          }
          console.error('Error subiendo examen resuelto:', err);
          const mensaje = this.mensajeErrorSubidaExamen(err);
          this.paso5ErrorMensaje = mensaje;
          this.registrarTimelineLog('paso5.upload.error', { tipo, error: mensaje });
          Swal.fire({
            title: 'Error',
            text: mensaje,
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
    } catch (error) {
      this.subiendoEvaluacionResuelta = false;
      this.subiendoExamenResuelto = false;
      console.error('❌ Error inesperado al subir examen resuelto:', error);
      this.paso5ErrorMensaje = 'Ocurrió un error inesperado al subir el examen.';
      this.registrarTimelineLog('paso5.upload.crash', { tipo, error: String(error) });
      Swal.fire({
        title: 'Error',
        text: 'Ocurrió un error inesperado al subir el examen.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  private mensajeErrorSubidaExamen(err: any): string {
    if (err?.error?.message) {
      return err.error.message;
    }
    const status = err?.status;
    if (status === 413 || status === 0) {
      return `El archivo es demasiado grande para el servidor (máx. ${TimelineCursoComponent.MAX_EXAMEN_RESUELTO_MB} MB). Comprima el PDF o pida al administrador aumentar el límite de subida en Nginx.`;
    }
    return 'No se pudo subir el archivo. Intente de nuevo.';
  }

  quitarArchivo(tipo: string = 'diagnostico'): void {
    if (tipo === 'final') {
      this.evaluacionResueltaArchivo = null;
    } else {
      this.examenResueltoArchivo = null;
    }
  }

  onInformeCargado(archivo: File): void {
    this.informeFinalSubido = archivo;
    Swal.fire('¡Éxito!', 'Informe final cargado correctamente', 'success');
  }

  // ========== SUBIDA DE FOTOS DE EVIDENCIA (Paso 6 - Evidencias) ==========

  onDragOverFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = true;
  }

  onDragLeaveFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = false;
  }

  onDropFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = false;

    const files = event.dataTransfer?.files;
    if (files) {
      this.agregarFotosSeleccionadas(files);
    }
  }

  onFotosSeleccionadas(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.agregarFotosSeleccionadas(input.files);
    }
    this.limpiarFocoInputArchivo(input);
  }

  private agregarFotosSeleccionadas(files: FileList): void {
    if (this.subiendoFotosEvidencia) {
      return;
    }

    const permitidos = ['image/jpeg', 'image/png'];
    let rechazadosTipo = 0;
    let rechazadosDuplicados = 0;
    let rechazadosLimite = 0;

    const clavesActuales = new Set(
      this.fotosEvidenciaArchivos.map((foto) => `${foto.name}__${foto.size}__${foto.lastModified}`)
    );

    let capacidadDisponible = this.maxFotosEvidencia - this.fotosEvidenciaSubidas.length - this.fotosEvidenciaArchivos.length;
    if (capacidadDisponible <= 0) {
      Swal.fire({
        title: 'Límite alcanzado',
        text: `Ya tienes ${this.maxFotosEvidencia} evidencias entre subidas y pendientes.`,
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!permitidos.includes(file.type)) {
        rechazadosTipo++;
        continue;
      }

      const clave = `${file.name}__${file.size}__${file.lastModified}`;
      if (clavesActuales.has(clave)) {
        rechazadosDuplicados++;
        continue;
      }

      if (capacidadDisponible <= 0) {
        rechazadosLimite++;
        continue;
      }

      this.fotosEvidenciaArchivos.push(file);
      clavesActuales.add(clave);
      capacidadDisponible--;
    }

    const totalRechazados = rechazadosTipo + rechazadosDuplicados + rechazadosLimite;
    if (totalRechazados > 0) {
      const partes: string[] = [];
      if (rechazadosTipo > 0) partes.push(`${rechazadosTipo} por tipo inválido`);
      if (rechazadosDuplicados > 0) partes.push(`${rechazadosDuplicados} duplicadas`);
      if (rechazadosLimite > 0) partes.push(`${rechazadosLimite} por límite máximo`);

      Swal.fire({
        title: 'Archivos rechazados',
        text: partes.join(', '),
        icon: 'warning',
        confirmButtonColor: '#38512F',
        timer: 3000
      });
    }
  }

  quitarFotoPendiente(index: number): void {
    const foto = this.fotosEvidenciaArchivos[index];
    if (foto) {
      this.limpiarPreviewFoto(foto);
    }
    this.fotosEvidenciaArchivos.splice(index, 1);
  }

  limpiarFotosPendientes(): void {
    this.limpiarPreviewsFotos();
    this.fotosEvidenciaArchivos = [];
  }

  getFotoPreview(foto: File): SafeUrl {
    const previewExistente = this.fotosEvidenciaPreview.get(foto);
    if (previewExistente) return previewExistente;

    const nuevaPreview = this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(foto));
    this.fotosEvidenciaPreview.set(foto, nuevaPreview);
    return nuevaPreview;
  }

  formatearTamanoArchivo(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) return `${(bytes / mb).toFixed(2)} MB`;
    return `${Math.ceil(bytes / kb)} KB`;
  }

  subirFotosEvidencia(): void {
    if (!this.cursoId || this.subiendoFotosEvidencia) return;

    if (this.fotosEvidenciaArchivos.length === 0) {
      Swal.fire({
        title: 'Sin fotos pendientes',
        text: 'Selecciona al menos una foto para subir.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.subiendoFotosEvidencia = true;

    this.backendServices.subirFotosEvidencia(this.cursoId, this.fotosEvidenciaArchivos)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          this.subiendoFotosEvidencia = false;

          if (response.success) {
            const fallidas = Array.isArray(response.fotos)
              ? response.fotos.filter((foto: any) => !!foto.error)
              : [];

            this.limpiarFotosPendientes();
            this.cargarDocumentosProgramado();

            if (fallidas.length > 0) {
              Swal.fire({
                title: 'Subida parcial',
                text: `${response.message}. ${fallidas.length} archivo(s) no se pudieron subir.`,
                icon: 'warning',
                confirmButtonColor: '#38512F'
              });
            } else {
              Swal.fire({
                title: '¡Fotos subidas!',
                text: response.message,
                icon: 'success',
                confirmButtonColor: '#38512F',
                timer: 2200
              });
            }
          }
        },
        error: (err) => {
          this.subiendoFotosEvidencia = false;
          console.error('Error subiendo fotos de evidencia:', err);
          const mensaje = err?.error?.message || 'No se pudieron subir las fotos. Intente de nuevo.';
          Swal.fire({
            title: 'Error',
            text: mensaje,
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
  }

  private limpiarPreviewFoto(foto: File): void {
    const preview = this.fotosEvidenciaPreview.get(foto);
    if (preview) {
      const previewUrl = this.sanitizer.sanitize(SecurityContext.URL, preview);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      this.fotosEvidenciaPreview.delete(foto);
    }
  }

  private limpiarPreviewsFotos(): void {
    this.fotosEvidenciaPreview.forEach((preview) => {
      const previewUrl = this.sanitizer.sanitize(SecurityContext.URL, preview);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    });
    this.fotosEvidenciaPreview.clear();
  }

  eliminarFotoEvidencia(foto: any): void {
    if (!foto?.id || this.eliminandoFotoId === foto.id) {
      return;
    }

    Swal.fire({
      title: '¿Eliminar foto?',
      text: `Se eliminará "${foto.nombre}" de Drive y del sistema`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.eliminandoFotoId = foto.id;
        this.backendServices.eliminarDocumentoCursoProgramado(foto.id)
          .pipe(takeUntil(this.destroy$)).subscribe({
            next: () => {
              this.eliminandoFotoId = null;
              this.cargarDocumentosProgramado();
              Swal.fire({
                title: 'Eliminada de Drive y BD',
                icon: 'success',
                timer: 1200,
                showConfirmButton: false
              });
            },
            error: (err) => {
              this.eliminandoFotoId = null;
              console.error('Error eliminando foto:', err);
              Swal.fire('Error', 'No se pudo eliminar la foto', 'error');
            }
          });
      }
    });
  }

  // ── Lista de Asistencia Física ──

  onDragOverListaFisica(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoListaFisica = true;
  }

  onDragLeaveListaFisica(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoListaFisica = false;
  }

  onDropListaFisica(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoListaFisica = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.seleccionarListaFisica(files[0]);
    }
  }

  onListaFisicaSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.seleccionarListaFisica(input.files[0]);
    }
    this.limpiarFocoInputArchivo(input);
  }

  private limpiarFocoInputArchivo(input: HTMLInputElement | null): void {
    if (!input) {
      return;
    }

    // Permite volver a elegir el mismo archivo y evita que quede foco en el input oculto.
    input.value = '';
    if (document.activeElement === input) {
      input.blur();
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.tagName === 'INPUT') {
      const activeInput = activeEl as HTMLInputElement;
      if (activeInput.type === 'file') {
        activeInput.blur();
      }
    }
  }

  private seleccionarListaFisica(file: File): void {
    const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!tiposPermitidos.includes(file.type)) {
      Swal.fire({
        title: 'Formato no permitido',
        text: 'Solo se permiten archivos PDF, JPG o PNG.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }
    this.listaFisicaArchivo = file;
  }

  subirListaFisica(): void {
    if (!this.cursoId || !this.listaFisicaArchivo || this.subiendoListaFisica) return;

    this.subiendoListaFisica = true;

    this.backendServices.subirListaAsistenciaFisica(this.cursoId, this.listaFisicaArchivo)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          this.subiendoListaFisica = false;
          if (response.success) {
            this.listaFisicaArchivo = null;
            this.cargarDocumentosProgramado();
            Swal.fire({
              title: '¡Lista subida!',
              text: response.message,
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2200,
              showConfirmButton: false
            });
          }
        },
        error: (err) => {
          this.subiendoListaFisica = false;
          console.error('Error subiendo lista de asistencia física:', err);
          Swal.fire({
            title: 'Error',
            text: err?.error?.message || 'No se pudo subir la lista de asistencia.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
  }

  eliminarListaFisica(): void {
    if (!this.listaFisicaSubida?.id) return;

    Swal.fire({
      title: '¿Eliminar lista de asistencia?',
      text: 'Se eliminará de Drive y del sistema',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendServices.eliminarDocumentoCursoProgramado(this.listaFisicaSubida.id)
          .pipe(takeUntil(this.destroy$)).subscribe({
            next: () => {
              this.listaFisicaSubida = null;
              this.cargarDocumentosProgramado();
              Swal.fire({ title: 'Eliminada', icon: 'success', timer: 1200, showConfirmButton: false });
            },
            error: (err) => {
              console.error('Error eliminando lista física:', err);
              Swal.fire('Error', 'No se pudo eliminar la lista', 'error');
            }
          });
      }
    });
  }

  cancelarListaFisica(): void {
    this.listaFisicaArchivo = null;
  }

  // ── Paso 9: Entrega de documentos (SP-F-03) ──

  get entregaDocumentosFechaVista(): string {
    const hoy = new Date();
    return `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  }

  get entregaDocumentosPersonaVista(): string {
    return this.informePersonaSolicitante || this.empresaNombre || 'Pendiente';
  }

  generarEntregaDocumentos(): void {
    if (!this.cursoId || this.generandoEntregaDocumentos) return;

    this.generandoEntregaDocumentos = true;
    Swal.fire({
      title: 'Generando formato... ',
      text: 'Creando SP-F-03 en Google Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendServices.generarEntregaDocumentosDrive(this.cursoId, {
      personaEntrega: this.entregaDocumentosPersonaVista
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        this.generandoEntregaDocumentos = false;
        Swal.close();

        if (response?.success && response?.archivo) {
          this.entregaDocumentosGenerado = {
            id: null,
            nombre: response.archivo.nombre,
            url: response.archivo.url || '',
            drive_file_id: response.archivo.drive_file_id || null,
            fecha: new Date().toISOString()
          };

          this.cargarDocumentosProgramado();

          Swal.fire({
            title: 'Formato generado',
            text: response?.message || 'Se generó y guardó el formato SP-F-03 en Drive.',
            icon: 'success',
            confirmButtonColor: '#38512F'
          });
        } else {
          Swal.fire({
            title: 'No se pudo generar',
            text: response?.message || 'No se pudo generar el formato en Drive.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      },
      error: (err: any) => {
        this.generandoEntregaDocumentos = false;
        Swal.close();
        Swal.fire({
          title: 'Error',
          text: err?.error?.message || 'No se pudo generar el formato SP-F-03.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  verEntregaDocumentosGenerado(): void {
    const doc = this.entregaDocumentosGenerado;
    if (!doc) return;

    const viewUrl = doc?.drive_file_id
      ? `https://docs.google.com/document/d/${encodeURIComponent(doc.drive_file_id)}/edit`
      : doc?.url;

    if (viewUrl) {
      window.open(viewUrl, '_blank');
      return;
    }

    Swal.fire({
      title: 'No disponible',
      text: 'No se encontró una URL de visualización para el documento generado.',
      icon: 'info',
      confirmButtonColor: '#38512F'
    });
  }

  descargarEntregaDocumentosGenerado(): void {
    const doc = this.entregaDocumentosGenerado;
    if (!doc) return;

    if (!doc?.drive_file_id) {
      if (doc?.url) {
        window.open(doc.url, '_blank');
      } else {
        Swal.fire({
          title: 'No disponible',
          text: 'No se encontró una referencia válida del documento para descargar.',
          icon: 'info',
          confirmButtonColor: '#38512F'
        });
      }
      return;
    }

    Swal.fire({
      title: 'Preparando descarga... ',
      text: 'Convirtiendo el documento a PDF',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendServices.imprimirArchivoDriveComoPDF(
      doc.drive_file_id,
      doc?.nombre || 'control_entrega_documentos'
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob: Blob) => {
        Swal.close();
        this.descargarBlobPdf(blob, doc?.nombre || 'control_entrega_documentos');
      },
      error: (err: any) => {
        Swal.close();
        Swal.fire({
          title: 'Error',
          text: err?.error?.message || 'No se pudo descargar el documento generado.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  onDragOverEntregaDocumentosFirmado(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoEntregaDocumentosFirmado = true;
  }

  onDragLeaveEntregaDocumentosFirmado(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoEntregaDocumentosFirmado = false;
  }

  onDropEntregaDocumentosFirmado(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoEntregaDocumentosFirmado = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.seleccionarEntregaDocumentosFirmado(files[0]);
    }
  }

  onEntregaDocumentosFirmadoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.seleccionarEntregaDocumentosFirmado(input.files[0]);
    }
    this.limpiarFocoInputArchivo(input);
  }

  private seleccionarEntregaDocumentosFirmado(file: File): void {
    const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!tiposPermitidos.includes(file.type)) {
      Swal.fire({
        title: 'Formato no permitido',
        text: 'Solo se permiten archivos PDF, JPG o PNG.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      Swal.fire({
        title: 'Archivo muy grande',
        text: 'El tamaño máximo permitido es 10 MB.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.entregaDocumentosFirmadoArchivo = file;
  }

  subirEntregaDocumentosFirmado(): void {
    if (!this.cursoId || !this.entregaDocumentosFirmadoArchivo || this.subiendoEntregaDocumentosFirmado) return;

    this.subiendoEntregaDocumentosFirmado = true;

    this.backendServices.subirEntregaDocumentosFirmado(this.cursoId, this.entregaDocumentosFirmadoArchivo)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          this.subiendoEntregaDocumentosFirmado = false;
          if (response?.success) {
            this.entregaDocumentosFirmadoArchivo = null;
            this.cargarDocumentosProgramado();
            Swal.fire({
              title: 'Documento subido',
              text: response?.message || 'Documento firmado subido correctamente.',
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2200,
              showConfirmButton: false
            });
          } else {
            Swal.fire({
              title: 'Error',
              text: response?.message || 'No se pudo subir el documento firmado.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        },
        error: (err: any) => {
          this.subiendoEntregaDocumentosFirmado = false;
          Swal.fire({
            title: 'Error',
            text: err?.error?.message || 'No se pudo subir el documento firmado.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
  }

  cancelarEntregaDocumentosFirmado(): void {
    this.entregaDocumentosFirmadoArchivo = null;
  }

  eliminarEntregaDocumentosFirmado(): void {
    if (!this.entregaDocumentosFirmadoSubido?.id) return;

    Swal.fire({
      title: '¿Eliminar documento firmado?',
      text: 'Se eliminará de Drive y del sistema',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.backendServices.eliminarDocumentoCursoProgramado(this.entregaDocumentosFirmadoSubido.id)
        .pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            this.entregaDocumentosFirmadoSubido = null;
            this.cargarDocumentosProgramado();
            Swal.fire({ title: 'Eliminado', icon: 'success', timer: 1200, showConfirmButton: false });
          },
          error: (err) => {
            console.error('Error eliminando documento firmado:', err);
            Swal.fire('Error', 'No se pudo eliminar el documento firmado', 'error');
          }
        });
    });
  }

  // Eliminar examen resuelto o evaluación resuelta (Drive + BD)
  eliminarDocumentoProgramado(doc: any, tipo: 'examen' | 'evaluacion'): void {
    const titulo = tipo === 'examen' ? 'examen resuelto' : 'evaluación resuelta';
    const tipoCal = tipo === 'examen' ? 'diagnostico' : 'evaluacion';
    const documentoProgId = Number(doc?.id ?? doc?.documento_prog_id ?? doc?.documentoProgId);

    if (!Number.isFinite(documentoProgId) || documentoProgId <= 0) {
      Swal.fire('Error', `No se encontró el identificador para eliminar el ${titulo}. Recarga la vista e intenta de nuevo.`, 'error');
      return;
    }

    const advertenciaCalif = tipo === 'examen'
      ? 'También se borrarán las calificaciones de <strong>Diagnóstico</strong> ya registradas.'
      : 'También se borrarán las calificaciones de <strong>Evaluación final</strong> (escrita y práctica) ya registradas.';
    Swal.fire({
      title: `¿Eliminar ${titulo}?`,
      html: `<p>Se eliminará "<strong>${doc.nombre}</strong>" de Drive y del sistema.</p><p class="text-danger small mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>${advertenciaCalif}</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendServices.eliminarDocumentoCursoProgramado(documentoProgId)
          .pipe(takeUntil(this.destroy$)).subscribe({
            next: () => {
              if (tipo === 'examen') {
                this.examenResueltoSubido = null;
              } else {
                this.evaluacionResueltaSubida = null;
              }
              if (this.cursoId) {
                this.backendServices.limpiarCalificacionesCurso(this.cursoId, tipoCal)
                  .pipe(takeUntil(this.destroy$)).subscribe({
                    next: () => {
                      this.limpiarCalificacionesBorradorLocal();
                      this.cargarParticipantes();
                      Swal.fire({ title: 'Eliminado', text: 'Documento y calificaciones borradas correctamente.', icon: 'success', timer: 2000, showConfirmButton: false });
                    },
                    error: (err) => {
                      console.error('Error limpiando calificaciones:', err);
                      Swal.fire('Eliminado parcialmente', 'El documento fue eliminado pero no se pudieron limpiar las calificaciones.', 'warning');
                    }
                  });
              } else {
                Swal.fire({ title: 'Eliminado', icon: 'success', timer: 1200, showConfirmButton: false });
              }
            },
            error: (err) => {
              console.error(`Error eliminando ${titulo}:`, err);
              Swal.fire('Error', `No se pudo eliminar el ${titulo}`, 'error');
            }
          });
      }
    });
  }

  async enviarPorCorreo(alumno: any): Promise<void> {
    const tipoDoc = alumno.requiereDC3 ? 'Constancia y DC-3' : 'Constancia';

    const result = await Swal.fire({
      title: 'Enviar por correo',
      html: `¿Enviar ${tipoDoc} a <strong>${alumno.nombre}</strong>?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#2dce89',
      cancelButtonColor: '#5e72e4',
      confirmButtonText: 'Sí, enviar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      // Simular envío
      Swal.fire({
        title: 'Enviando...',
        timer: 1500,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      setTimeout(() => {
        Swal.fire({
          title: '¡Enviado!',
          text: `${tipoDoc} enviado(s) correctamente`,
          icon: 'success'
        });
      }, 1500);
    }
  }

  async enviarTodosPorCorreo(): Promise<void> {
    const alumnosAsistentes = this.listaAlumnos.filter(a => a.asistio);

    if (alumnosAsistentes.length === 0) {
      Swal.fire({
        title: 'Sin destinatarios',
        text: 'No hay alumnos que hayan asistido',
        icon: 'warning'
      });
      return;
    }

    const result = await Swal.fire({
      title: 'Enviar documentos por correo',
      text: `¿Enviar documentos a ${alumnosAsistentes.length} alumno(s)?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#2dce89',
      confirmButtonText: 'Sí, enviar todos'
    });

    if (result.isConfirmed) {
      Swal.fire({
        title: 'Enviando...',
        text: `Enviando documentos a ${alumnosAsistentes.length} alumno(s)`,
        timer: 2000,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      setTimeout(() => {
        Swal.fire({
          title: '¡Enviados!',
          text: 'Todos los documentos han sido enviados',
          icon: 'success'
        });
      }, 2000);
    }
  }

  async descargarTodos(): Promise<void> {
    const alumnosAsistentes = this.listaAlumnos.filter(a => a.asistio);

    if (alumnosAsistentes.length === 0) {
      Swal.fire({
        title: 'Sin documentos',
        text: 'No hay alumnos que hayan asistido',
        icon: 'warning'
      });
      return;
    }

    Swal.fire({
      title: 'Descargando...',
      text: `Generando ${alumnosAsistentes.length} documento(s)`,
      timer: 2000,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    setTimeout(() => {
      Swal.fire({
        title: '¡Descargados!',
        text: 'Todos los documentos han sido descargados',
        icon: 'success'
      });
    }, 2000);
  }

  descargarAmbos(alumno: any): void {
    Swal.fire({
      title: 'Descargando...',
      text: alumno.requiereDC3
        ? `Descargando Constancia y DC-3 de ${alumno.nombre}`
        : `Descargando Constancia de ${alumno.nombre}`,
      icon: 'success',
      timer: 1500,
      showConfirmButton: false
    });
  }

  volver(): void {
    this.router.navigate(['/curso-activos']);
  }

  /**
   * Descargar lista de asistencia en Excel
   */
  descargarListaAsistenciaExcel(): void {
    // Filtrar solo los participantes que asistieron
    const asistentes = this.listaAlumnos.filter(alumno => alumno.asistio === true || alumno.asistio === 1);

    if (asistentes.length === 0) {
      Swal.fire({
        title: 'Sin asistentes',
        text: 'No hay participantes que hayan asistido al curso',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Preparar datos para Excel
    const datos = asistentes.map((alumno, index) => ({
      'No.': index + 1,
      'NOMBRE': alumno.nombre,
      'CURP': alumno.curp,
      'PUESTO': alumno.puesto || 'Sin especificar'
    }));

    // Crear hoja de trabajo
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(datos);

    // Ajustar ancho de columnas
    ws['!cols'] = [
      { wch: 5 },  // No.
      { wch: 40 }, // NOMBRE
      { wch: 20 }, // CURP
      { wch: 25 }  // PUESTO
    ];

    // Crear libro de trabajo
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lista de Asistencia');

    // Generar nombre de archivo con fecha
    const fecha = new Date().toISOString().split('T')[0];
    const nombreArchivo = `Lista_Asistencia_${this.nombreCurso.replace(/ /g, '_')}_${fecha}.xlsx`;

    // Descargar archivo
    XLSX.writeFile(wb, nombreArchivo);

    Swal.fire({
      title: '¡Descargado!',
      text: `Lista de asistencia con ${asistentes.length} participante(s)`,
      icon: 'success',
      confirmButtonColor: '#38512F',
      timer: 2000
    });
  }

  /** Abrir en Drive la lista de asistencia con participantes (formato lleno) */
  abrirListaSGCF33Llena(): void {
    if (this.listaAsistenciaDrive?.url) {
      window.open(this.listaAsistenciaDrive.url, '_blank');
    } else {
      Swal.fire({
        title: 'No disponible',
        text: 'La lista con participantes aún no se ha generado. Registra empleados en el curso para generarla.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
    }
  }

  /** Descargar lista de asistencia vacía (solo datos del curso, sin nombres) */
  descargarListaSGCF33Vacia(): void {
    if (!this.cursoId) return;
    this.descargandoListaVacia = true;

    this.backendServices.descargarSGCF33Vacia(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob: Blob) => {
        this.descargandoListaVacia = false;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lista_Asistencia_Vacia_${this.nombreCurso.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      },
      error: async (err: any) => {
        this.descargandoListaVacia = false;
        let errorMsg = 'Error al generar la lista vacía.';
        if (err.error instanceof Blob) {
          try { const t = await err.error.text(); const j = JSON.parse(t); if (j.message) errorMsg = j.message; } catch (e) { }
        } else if (err.error?.message) { errorMsg = err.error.message; }
        Swal.fire({ title: 'Error', text: errorMsg, icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  /** Abrir lista de asistencia actual (llena o vacía) en Drive */
  verListaAsistencia(): void {
    const doc = this.listaAsistenciaModo === 'vacia' ? this.listaAsistenciaVaciaDrive : this.listaAsistenciaDrive;
    if (doc?.drive_file_id || doc?.url) {
      const driveFileId = String(doc?.drive_file_id || '').trim() || this.extraerDriveFileIdDesdeUrl(doc?.url);
      const nombreDocumento = (doc?.nombre || (this.listaAsistenciaModo === 'vacia'
        ? 'Lista de asistencia vacia'
        : 'Lista de asistencia')).toString();

      if (driveFileId) {
        const archivoNombre = nombreDocumento.includes('.') ? nombreDocumento : `${nombreDocumento}.xlsx`;
        this.documentPreview.abrir({
          nombre: nombreDocumento,
          archivo_nombre: archivoNombre,
          archivo_url: driveFileId,
          documento_id: Number(doc?.id) || undefined,
          curso_id: this.cursoId || undefined
        });
        return;
      }

      // Fallback de seguridad para enlaces no estandar sin drive_file_id parseable.
      if (doc?.url) {
        window.open(doc.url, '_blank');
        return;
      }
    } else if (this.listaAsistenciaModo === 'vacia') {
      this.generarYGuardarListaVaciaEnDrive();
    } else {
      Swal.fire({
        title: 'No disponible',
        text: 'La lista con participantes aún no se ha generado.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
    }
  }

  /** Descargar lista de asistencia actual (llena o vacía) en PDF */
  imprimirListaAsistencia(): void {
    if (this.listaAsistenciaModo === 'llena' && this.cursoId) {
      Swal.fire({
        title: 'Preparando descarga...',
        text: 'Actualizando lista de asistencia en Drive...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      this.backendServices.generarSGCF33Drive(this.cursoId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response: any) => {
            if (response?.success && response?.archivo) {
              this.listaAsistenciaDrive = {
                id: null,
                nombre: response.archivo.nombre,
                url: response.archivo.url || (response.archivo.drive_file_id ? `https://docs.google.com/spreadsheets/d/${response.archivo.drive_file_id}/edit` : ''),
                drive_file_id: response.archivo.drive_file_id || null,
                fecha: new Date().toISOString()
              };
              this.cargarDocumentosProgramado();
            }

            Swal.close();
            // Flujo único y estable: descargar PDF por backend forzando horizontal.
            if (this.listaAsistenciaDrive?.drive_file_id) {
              this.backendServices.imprimirArchivoDriveComoPDF(
                this.listaAsistenciaDrive.drive_file_id,
                this.listaAsistenciaDrive.nombre || 'lista_asistencia',
                true
              )
                .pipe(takeUntil(this.destroy$))
                .subscribe({
                  next: (blob: Blob) => {
                    this.descargarBlobPdf(blob, this.listaAsistenciaDrive?.nombre || 'lista_asistencia');
                  },
                  error: () => {
                    Swal.fire({
                      title: 'No disponible',
                      text: 'No se pudo descargar el archivo en PDF.',
                      icon: 'error',
                      confirmButtonColor: '#38512F'
                    });
                  }
                });
              return;
            }

            Swal.fire({
              title: 'No disponible',
              text: 'No se pudo resolver el archivo para descargar en PDF.',
              icon: 'info',
              confirmButtonColor: '#38512F'
            });
          },
          error: () => {
            Swal.close();
            Swal.fire({
              title: 'Error',
              text: 'No se pudo preparar la lista para descargar en PDF.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        });
      return;
    }

    const doc = this.listaAsistenciaModo === 'vacia' ? this.listaAsistenciaVaciaDrive : this.listaAsistenciaDrive;
    if (doc?.drive_file_id || doc?.url) {
      // Flujo único y estable: backend con landscape forzado.
      if (doc?.drive_file_id) {
        Swal.fire({
          title: 'Preparando descarga...',
          text: 'Un momento, esto puede tardar unos segundos...',
          allowOutsideClick: false,
          didOpen: () => { Swal.showLoading(); }
        });

        this.backendServices.imprimirArchivoDriveComoPDF(
          doc.drive_file_id,
          doc.nombre || 'lista_asistencia.xlsx',
          true
        )
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (blob: Blob) => {
              Swal.close();
              this.descargarBlobPdf(blob, doc?.nombre || 'lista_asistencia');
            },
            error: () => {
              Swal.close();
              Swal.fire({
                title: 'No disponible',
                text: 'No se pudo descargar el archivo en PDF.',
                icon: 'error',
                confirmButtonColor: '#38512F'
              });
            }
          });
        return;
      }

      Swal.fire({
        title: 'No disponible',
        text: 'No se pudo resolver el archivo para descargar en PDF.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
    } else if (this.listaAsistenciaModo === 'vacia') {
      this.generarYGuardarListaVaciaEnDrive();
    } else {
      Swal.fire({
        title: 'No disponible',
        text: 'La lista aún no se ha generado.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
    }
  }


  private descargarBlobPdf(blob: Blob, nombreBase: string): void {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    const nombre = (nombreBase || 'documento')
      .toString()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_\u00C0-\u024F]+/g, '_');
    link.href = url;
    link.download = `${nombre}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 150);
  }
  /** Generar y guardar la lista vacía en Drive (auto-genera si no existe) */
  generarYGuardarListaVaciaEnDrive(): void {
    if (!this.cursoId || this.generandoListaVaciaDrive) return;
    this.generandoListaVaciaDrive = true;

    Swal.fire({
      title: 'Generando lista vacía...',
      text: 'Guardando en Google Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendServices.generarSGCF33VaciaDrive(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        this.generandoListaVaciaDrive = false;
        Swal.close();
        if (response.success && response.archivo) {
          this.listaAsistenciaVaciaDrive = {
            id: null,
            nombre: response.archivo.nombre,
            url: response.archivo.url || (response.archivo.drive_file_id ? `https://docs.google.com/spreadsheets/d/${response.archivo.drive_file_id}/edit` : ''),
            drive_file_id: response.archivo.drive_file_id || null,
            fecha: new Date().toISOString()
          };
          if (this.listaAsistenciaVaciaDrive.url) {
            window.open(this.listaAsistenciaVaciaDrive.url, '_blank');
          }
          this.cargarDocumentosProgramado();
        }
      },
      error: (err: any) => {
        this.generandoListaVaciaDrive = false;
        Swal.close();
        const msg = err?.error?.message || 'No se pudo generar la lista vacía en Drive.';
        Swal.fire({ title: 'Error', text: msg, icon: 'error', confirmButtonColor: '#38512F' });
      }
    });
  }

  /** Cambiar (reemplazar) un documento template del curso via file picker */
  cambiarDocumentoCurso(doc: any): void {
    if (!doc?.documento_id || !doc?.curso_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.xls,.xlsx';
    input.onchange = (event: any) => {
      const file: File = event.target.files?.[0];
      if (!file) return;
      Swal.fire({
        title: 'Reemplazando documento...',
        text: `Subiendo ${file.name}`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
      this.backendServices.reemplazarArchivoDocumento(doc.curso_id, doc.documento_id, file)
        .pipe(takeUntil(this.destroy$)).subscribe({
          next: (response: any) => {
            Swal.close();
            if (response.success) {
              Swal.fire({
                title: '¡Actualizado!',
                text: 'El documento se reemplazó correctamente.',
                icon: 'success',
                confirmButtonColor: '#38512F',
                timer: 2500
              });
              this.cargarDocumentosCurso();
            }
          },
          error: (err) => {
            Swal.close();
            Swal.fire({
              title: 'Error',
              text: err?.error?.message || 'No se pudo reemplazar el documento.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        });
    };
    input.click();
  }



  // ========== CHECKLIST HELPERS ==========

  private crearPlantillaChecklistVerificacion(): any[] {
    return [
      { fila: 12, categoria: 'Instalaciones y servicios', concepto: 'Aula de Proyección Amplia', cumple: null },
      { fila: 13, categoria: 'Instalaciones y servicios', concepto: 'Aula limpia, ordenada, ventilada e iluminada', cumple: null },
      { fila: 14, categoria: 'Instalaciones y servicios', concepto: 'Conexión a internet estable', cumple: null },
      { fila: 15, categoria: 'Instalaciones y servicios', concepto: 'Contactos de energía de 127 volts', cumple: null },
      { fila: 16, categoria: 'Instalaciones y servicios', concepto: 'Sanitarios aseados y con material suficiente para la higiene personal', cumple: null },
      { fila: 18, categoria: 'Mobiliario', concepto: 'Escritorio y Silla para el instructor', cumple: null },
      { fila: 19, categoria: 'Mobiliario', concepto: 'Mesas y sillas para personas acomodadas en forma de U', cumple: null },
      { fila: 20, categoria: 'Mobiliario', concepto: 'Mesa de apoyo para el instructor', cumple: null },
      { fila: 21, categoria: 'Mobiliario', concepto: 'Pizarrón blanco', cumple: null },
      { fila: 22, categoria: 'Mobiliario', concepto: 'Rotafolio', cumple: null },
      { fila: 24, categoria: 'Material', concepto: 'Manual de Instructor', cumple: null },
      { fila: 25, categoria: 'Material', concepto: 'USB con la presentación del expositor', cumple: null },
      { fila: 26, categoria: 'Material', concepto: 'Juegos de manual del participante', cumple: null },
      { fila: 27, categoria: 'Material', concepto: 'Formatos de las evaluaciones diagnósticas', cumple: null },
      { fila: 28, categoria: 'Material', concepto: 'Formatos de las evaluaciones del curso', cumple: null },
      { fila: 29, categoria: 'Material', concepto: 'Formatos de la encuesta de satisfacción', cumple: null },
      { fila: 30, categoria: 'Material', concepto: 'Lápices / Plumas', cumple: null },
      { fila: 31, categoria: 'Material', concepto: 'Paquete de hojas blancas', cumple: null },
      { fila: 32, categoria: 'Material', concepto: 'Plumones de pizarrón blanco', cumple: null },
      { fila: 33, categoria: 'Material', concepto: 'Plumones de agua', cumple: null },
      { fila: 34, categoria: 'Material', concepto: 'Hojas tamaño rotafolio', cumple: null },
      { fila: 36, categoria: 'Equipo', concepto: 'Cañón', cumple: null },
      { fila: 37, categoria: 'Equipo', concepto: 'Cable de corriente para cañón', cumple: null },
      { fila: 38, categoria: 'Equipo', concepto: 'Control remoto para cañón', cumple: null },
      { fila: 39, categoria: 'Equipo', concepto: 'Señalador con pilas funcionales', cumple: null },
      { fila: 40, categoria: 'Equipo', concepto: 'Laptop', cumple: null },
      { fila: 41, categoria: 'Equipo', concepto: 'Pantalla o pared para proyección', cumple: null },
      { fila: 42, categoria: 'Equipo', concepto: 'Bocinas para PC', cumple: null },
      { fila: 43, categoria: 'Equipo', concepto: 'Cable de conexión PC - Bocinas', cumple: null },
      { fila: 44, categoria: 'Equipo', concepto: 'Cable de corriente para laptop', cumple: null },
      { fila: 45, categoria: 'Equipo', concepto: 'Extensión', cumple: null },
      { fila: 47, categoria: 'Equipo', concepto: 'Se han realizado pruebas de funcionamiento del equipo: PC, Bocinas, Cañón', cumple: null },
      { fila: 48, categoria: 'Equipo', concepto: 'Se han revisado las salidas de emergencia y puntos de reunión', cumple: null }
    ];
  }

  private inicializarChecklistVerificacion(): void {
    if (this.checklistVerificacionItems.length > 0) {
      return;
    }
    this.checklistVerificacionItems = this.crearPlantillaChecklistVerificacion();
  }

  private esChecklistOtroPrincipal(item: any): boolean {
    return item?.categoria === 'Equipo' && String(item?.concepto || '').trim().toLowerCase() === 'otros' && item?.userAdded !== true;
  }

  private esChecklistOtroConceptoFijo(item: any): boolean {
    const concepto = String(item?.concepto || '').trim().toLowerCase();
    return concepto === 'se han realizado pruebas de funcionamiento del equipo: pc, bocinas, cañón'
      || concepto === 'se han revisado las salidas de emergencia y puntos de reunión';
  }

  private esChecklistSeccionOtros(item: any): boolean {
    return this.esChecklistOtroPrincipal(item) || this.esChecklistOtroConceptoFijo(item) || item?.userAdded === true;
  }

  get checklistOtroPrincipalItem(): any | null {
    return this.checklistVerificacionItems.find((item) => this.esChecklistOtroPrincipal(item)) || null;
  }

  get checklistOtrosBaseItems(): any[] {
    return this.checklistVerificacionItems.filter((item) => this.esChecklistOtroPrincipal(item) || this.esChecklistOtroConceptoFijo(item));
  }

  get checklistOtrosAgregados(): any[] {
    return this.checklistVerificacionItems.filter((item) => item?.userAdded === true);
  }

  get checklistVerificacionAgrupado(): Array<{ categoria: string; items: any[] }> {
    const ordenCategorias = ['Instalaciones y servicios', 'Mobiliario', 'Material', 'Equipo'];
    return ordenCategorias.map((categoria) => ({
      categoria,
      items: this.checklistVerificacionItems.filter((item) => item.categoria === categoria && !this.esChecklistSeccionOtros(item))
    })).filter((grupo) => grupo.items.length > 0);
  }

  setChecklistValor(item: any, valor: boolean): void {
    if (!item) {
      return;
    }
    item.cumple = valor ? true : false;
    this.guardarChecklistBorradorLocal();
  }

  toggleChecklistValor(item: any): void {
    if (!item) {
      return;
    }

    if (item.cumple === null || item.cumple === undefined) {
      item.cumple = true;
      this.guardarChecklistBorradorLocal();
      return;
    }

    item.cumple = !item.cumple;
    this.guardarChecklistBorradorLocal();
  }

  agregarChecklistOtroPersonalizado(): void {
    const texto = String(this.checklistOtroNuevoTexto || '').trim();
    if (!texto) {
      return;
    }

    const existe = this.checklistVerificacionItems.some((item) =>
      String(item?.concepto || '').trim().toLowerCase() === texto.toLowerCase()
    );
    if (existe) {
      this.checklistOtroNuevoTexto = '';
      return;
    }

    this.checklistVerificacionItems.push({
      fila: null,
      categoria: 'Equipo',
      concepto: texto,
      cumple: null,
      userAdded: true
    });
    this.checklistOtroNuevoTexto = '';
    this.guardarChecklistBorradorLocal();
  }

  eliminarChecklistOtroPersonalizado(item: any): void {
    if (!item || item?.userAdded !== true) {
      return;
    }

    this.checklistVerificacionItems = this.checklistVerificacionItems.filter((it) => it !== item);
    this.guardarChecklistBorradorLocal();
  }

  get checklistVerificacionRespondidos(): number {
    return this.checklistVerificacionItems.filter((item) => item.cumple === true || item.cumple === false).length;
  }

  get checklistVerificacionTotal(): number {
    return this.checklistVerificacionItems.length;
  }

  get checklistVerificacionPercent(): number {
    if (this.checklistVerificacionTotal === 0) {
      return 0;
    }
    return Math.round((this.checklistVerificacionRespondidos / this.checklistVerificacionTotal) * 100);
  }

  private getChecklistVerificacionPendientes(): any[] {
    return this.checklistVerificacionItems.filter((item) => item.cumple === null || item.cumple === undefined);
  }

  get checklistPeriodo(): string {
    const inicio = this.curso?.fecha_inicio;
    if (inicio) {
      return this.formatDateShortEs(inicio);
    }
    return 'Pendiente';
  }

  get checklistInstructor(): string {
    return this.curso?.instructor_nombre || 'Pendiente';
  }

  private resolverLugarCiudadEstado(): string {
    const getFirst = (keys: string[]): string => {
      for (const key of keys) {
        const value = this.curso?.[key];
        if (value !== undefined && value !== null) {
          const txt = String(value).trim();
          if (txt) {
            return txt;
          }
        }
      }
      return '';
    };

    const ciudad = getFirst(['ciudad', 'municipio', 'nombre_ciudad']);
    const estado = getFirst(['estado', 'localidad', 'nombre_estado']);

    if (ciudad && estado) {
      return ciudad.toLowerCase() === estado.toLowerCase() ? ciudad : `${ciudad}, ${estado}`;
    }
    if (ciudad) {
      return ciudad;
    }
    if (estado) {
      return estado;
    }

    return getFirst(['lugar', 'ubicacion']) || 'Pendiente';
  }

  get checklistLugar(): string {
    return this.resolverLugarCiudadEstado();
  }

  get checklistParticipantes(): number {
    return this.listaAlumnos.length || Number(this.curso?.inscritos || 0);
  }

  private construirPayloadChecklistVerificacion(): any {
    return {
      nombreCurso: this.nombreCurso || '',
      instructor: this.checklistInstructor,
      periodo: this.checklistPeriodo,
      lugar: this.checklistLugar,
      totalParticipantes: this.checklistParticipantes,
      items: this.checklistVerificacionItems.map((item) => ({
        fila: item.fila,
        concepto: item.concepto,
        cumple: item.cumple === true,
        userAdded: item?.userAdded === true
      }))
    };
  }

  async guardarChecklistDesdeBoton(): Promise<void> {
    if (this.guardandoChecklistVerificacionDrive) return;

    const yaExiste = !!this.checklistVerificacionArchivo;
    const confirmar = await Swal.fire({
      title: yaExiste
        ? '¿Actualizar lista de verificación?'
        : '¿Guardar lista de verificación?',
      html: yaExiste
        ? '<p>Se <strong>reemplazará</strong> el archivo anterior en Drive con las verificaciones actuales.</p>'
        : '<p>Se llenará la plantilla <strong>Lista de Verificación (SP-F-08)</strong> y se subirá a Drive.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: yaExiste ? 'Sí, actualizar' : 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d'
    });

    if (!confirmar.isConfirmed) return;

    const ok = await this.guardarChecklistVerificacionEnDrive();
    if (ok && !this.pasosCompletados.includes(2)) {
      this.pasosCompletados.push(2);
      this.guardarProgreso();
    }
  }

  async guardarChecklistVerificacionEnDrive(): Promise<boolean> {
    if (!this.cursoId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo identificar el curso programado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    // Auto-marcar como "No" los conceptos sin respuesta
    const pendientes = this.getChecklistVerificacionPendientes();
    if (pendientes.length > 0) {
      pendientes.forEach(item => item.cumple = false);
      this.guardarChecklistBorradorLocal();
    }

    this.guardandoChecklistVerificacionDrive = true;
    Swal.fire({
      title: 'Actualizando plantilla...',
      text: 'Se está llenando la Lista de Verificación SP-F-08 y subiendo a Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const payload = this.construirPayloadChecklistVerificacion();
      const response = await firstValueFrom(
        this.backendServices.generarChecklistVerificacionEnDrive(this.cursoId, payload)
      );
      Swal.close();

      if (!response?.success) {
        await Swal.fire({
          title: 'No se pudo guardar',
          text: response?.message || 'No se pudo actualizar la lista de verificación en Drive.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return false;
      }

      this.checklistVerificacionArchivo = response.archivo || null;

      // Capturar URL del editor de Google Sheets si está disponible
      const editorUrl = response.archivo?.editor_url || null;
      if (editorUrl) {
        this.checklistEditorRawUrl = editorUrl;
        this.checklistEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
      }

      const cumplidos = this.checklistVerificacionItems.filter(i => i.cumple === true).length;
      const noCumplen = this.checklistVerificacionItems.filter(i => i.cumple === false).length;
      await Swal.fire({
        title: 'Lista de verificación actualizada',
        html: `<p>Se guardó la plantilla <strong>SP-F-08</strong> en Google Drive como hoja de cálculo editable.</p>
               <p class="mb-0"><span class="text-success"><strong>${cumplidos}</strong> cumplen</span> &nbsp;|&nbsp; <span class="text-danger"><strong>${noCumplen}</strong> no cumplen</span></p>
               <p class="text-muted small mt-2 mb-0">Usa el editor para ajustar columnas o nombre del curso si aparece cortado.</p>`,
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
      this.cargarDocumentosProgramado();
      return true;
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo guardar la lista de verificación en Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    } finally {
      this.guardandoChecklistVerificacionDrive = false;
    }
  }

  toggleMaterial(index: number): void {
    this.listaMateriales[index].entregado = !this.listaMateriales[index].entregado;
  }

  get checklistEditorDisponible(): boolean {
    return !!(this.checklistVerificacionArchivo?.drive_file_id || this.checklistEditorRawUrl);
  }

  toggleEditorChecklist(): void {
    if (!this.checklistEditorDisponible) return;

    if (!this.checklistEditorUrl && this.checklistVerificacionArchivo?.drive_file_id) {
      const fileId = this.checklistVerificacionArchivo.drive_file_id;
      const url = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
      this.checklistEditorRawUrl = url;
      this.checklistEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }

    this.checklistEditorVisible = !this.checklistEditorVisible;
    if (this.checklistEditorVisible) {
      this.informeFinalEditorVisible = false;
      this.informeFotograficoEditorVisible = false;
    }
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.sincronizarBloqueoScrollEditor();
    if (this.checklistEditorVisible) {
      this.limpiarRestauracionScrollEditorPendiente();
      this.actualizarAnclaScrollEditor();
    }
  }

  abrirChecklistEnNuevaPestana(): void {
    const url = this.checklistEditorRawUrl
      || (this.checklistVerificacionArchivo?.drive_file_id
        ? `https://docs.google.com/spreadsheets/d/${this.checklistVerificacionArchivo.drive_file_id}/edit`
        : this.checklistVerificacionArchivo?.url);
    if (url) window.open(url, '_blank', 'noopener');
  }

  async guardarChecklistYHabilitarEdicion(): Promise<void> {
    if (this.guardandoChecklistVerificacionDrive) return;

    const yaExiste = !!this.checklistVerificacionArchivo;
    const confirmar = await Swal.fire({
      title: yaExiste ? '¿Actualizar lista de verificación?' : '¿Guardar lista de verificación?',
      html: yaExiste
        ? '<p>Se <strong>actualizará</strong> la hoja de Google Sheets con las verificaciones actuales.</p>'
        : '<p>Se creará la lista <strong>SP-F-08</strong> en Google Drive como hoja de cálculo editable.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: yaExiste ? 'Sí, actualizar' : 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d'
    });

    if (!confirmar.isConfirmed) return;

    const ok = await this.guardarChecklistVerificacionEnDrive();
    if (!ok) return;

    if (!this.pasosCompletados.includes(2)) {
      this.pasosCompletados.push(2);
      this.guardarProgreso();
    }

    this.checklistEditorVisible = true;
    this.informeFinalEditorVisible = false;
    this.informeFotograficoEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.sincronizarBloqueoScrollEditor();
    this.limpiarRestauracionScrollEditorPendiente();
    this.actualizarAnclaScrollEditor();
  }

  async siguienteDesdeChecklist(): Promise<void> {
    if (this.guardandoChecklistVerificacionDrive) return;

    const ok = await this.guardarChecklistVerificacionEnDrive();
    if (!ok) return;

    if (!this.pasosCompletados.includes(2)) {
      this.pasosCompletados.push(2);
      this.guardarProgreso();
    }

    this.checklistEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.sincronizarBloqueoScrollEditor();
    this.checklistGuardadoAviso = true;

    await Swal.fire({
      icon: 'info',
      title: 'Puedes editarlo después',
      text: 'Puedes regresar a este apartado y editarlo en cualquier momento antes de finalizar la capacitación.',
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#38512F'
    });

    this.seleccionarPaso(3);
  }

  getMaterialesEntregados(): number {
    return this.listaMateriales.filter(m => m.entregado).length;
  }

  private normalizarTextoChecklist(texto: any): string {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private esChecklistObligatorio(nombre: string): boolean {
    const valor = this.normalizarTextoChecklist(nombre);
    const esDiagnostico = valor.includes('diagnostic') && valor.includes('examen');
    const esEvaluacionFinal = (valor.includes('evaluacion') || valor.includes('evaluation'))
      && valor.includes('final');
    return esDiagnostico || esEvaluacionFinal;
  }

  getChecklistPercent(): number {
    if (this.listaMateriales.length === 0) return 0;
    return Math.round((this.getMaterialesEntregados() / this.listaMateriales.length) * 100);
  }

  getIconoMaterial(index: number): string {
    return this.listaMateriales[index]?.icono || 'fa-check-square';
  }

  /**
   * Descargar checklist de materiales en Excel
   */
  descargarChecklistExcel(): void {
    // Preparar datos para Excel
    const datos = this.listaMateriales.map((item) => ({
      'Concepto': item.nombre,
      'CUMPLE-SÍ': item.entregado === true ? 'X' : '',
      'CUMPLE-NO': item.entregado === false ? 'X' : ''
    }));

    // Crear hoja de trabajo
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(datos);

    // Ajustar ancho de columnas
    ws['!cols'] = [
      { wch: 60 }, // Concepto
      { wch: 12 }, // CUMPLE-SÍ
      { wch: 12 }  // CUMPLE-NO
    ];

    // Crear libro de trabajo
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Checklist');

    // Generar nombre de archivo con fecha
    const fecha = new Date().toISOString().split('T')[0];
    const nombreArchivo = `Checklist_Materiales_${this.nombreCurso.replace(/ /g, '_')}_${fecha}.xlsx`;

    // Descargar archivo
    XLSX.writeFile(wb, nombreArchivo);

    Swal.fire({
      title: '¡Descargado!',
      text: 'Checklist de materiales descargado',
      icon: 'success',
      confirmButtonColor: '#38512F',
      timer: 2000
    });
  }

  /**
   * Agregar nuevo participante al curso
   */
  async abrirGestionParticipantes(): Promise<void> {
    // Mantener el flujo de gestión dentro de un loop para soportar "Volver" sin cerrar la interfaz
    while (true) {
      const accion = await this.seleccionarAccionGestionParticipantes();
      if (!accion) {
        break; // el usuario cerró el selector de acciones
      }

      if (accion === 'agregar') {
        const resAgregar = await this.agregarNuevoParticipante();
        if (resAgregar === 'volver') {
          continue; // regresar al selector de acciones
        }
        // después de agregar, volvemos al menú principal por defecto
        continue;
      }

      if (this.listaAlumnos.length === 0) {
        await Swal.fire({
          title: 'Sin participantes',
          text: 'Primero agrega participantes para poder editar o eliminar.',
          icon: 'info',
          confirmButtonColor: '#38512F'
        });
        continue;
      }

      const participante = await this.seleccionarParticipanteGestion(accion);
      if (participante === 'volver') {
        continue; // regresar al selector de acciones
      }
      if (!participante) {
        break; // cerrar todo
      }

      if (accion === 'editar') {
        const resEditar = await this.editarParticipante(participante);
        if (resEditar === 'volver') {
          continue;
        }
        continue;
      }

      const resEliminar = await this.eliminarAlumno(participante);
      if (resEliminar === 'volver') {
        continue;
      }
      continue;
    }
  }

  private async seleccionarAccionGestionParticipantes(): Promise<'agregar' | 'editar' | 'eliminar' | null> {
    let accionSeleccionada: 'agregar' | 'editar' | 'eliminar' | null = null;

    const html = `
      <style>
        .gp-actions-wrap {
          text-align: left;
          font-family: 'Open Sans', sans-serif;
        }
        .gp-actions-head {
          background: linear-gradient(135deg, rgba(56, 81, 47, 0.12) 0%, rgba(118, 141, 107, 0.16) 100%);
          border: 1px solid #C2D1B2;
          border-radius: 12px;
          padding: .65rem .75rem;
          margin-bottom: .7rem;
          display: flex;
          align-items: center;
          gap: .6rem;
        }
        .gp-actions-head__icon {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #38512F 0%, #5a7456 100%);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: .9rem;
          box-shadow: 0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08);
          flex-shrink: 0;
        }
        .gp-actions-head__text {
          color: #38512F;
          font-size: .79rem;
          line-height: 1.35;
        }
        .gp-actions-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: .65rem;
        }
        .gp-action-btn {
          border: 1px solid #C2D1B2;
          border-radius: 10px;
          background: #fff;
          padding: .75rem .65rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: .35rem;
          cursor: pointer;
          transition: all .2s ease;
          color: #38512F;
          min-height: 92px;
        }
        .gp-action-btn__icon {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: rgba(56, 81, 47, 0.12);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .gp-action-btn i {
          font-size: 1rem;
        }
        .gp-action-btn__label {
          font-size: .78rem;
          font-weight: 600;
          text-align: center;
          line-height: 1.2;
        }
        .gp-action-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08);
          border-color: #768D6B;
        }
        .gp-action-btn.is-active {
          background: linear-gradient(135deg, #38512F 0%, #5a7456 100%);
          color: #fff;
          border-color: #38512F;
          box-shadow: 0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08);
        }
        .gp-action-btn.is-active .gp-action-btn__icon {
          background: rgba(255, 255, 255, 0.22);
        }
        .gp-actions-help {
          margin-top: .6rem;
          font-size: .74rem;
          color: #A8A9A2;
          text-align: center;
        }
        @media (max-width: 640px) {
          .gp-actions-grid {
            grid-template-columns: 1fr;
          }
          .gp-action-btn {
            min-height: 76px;
            flex-direction: row;
            justify-content: flex-start;
            padding: .7rem .75rem;
          }
          .gp-action-btn__label {
            text-align: left;
          }
        }
        /* Estilos para las acciones de Swal: alinear a la derecha y botones más agradables */
        .swal2-actions {
          display: flex !important;
          justify-content: flex-end !important;
          gap: .5rem !important;
          margin-top: 1rem !important;
        }
        .swal2-cancel, .swal2-confirm {
          border-radius: 8px !important;
          padding: .56rem .9rem !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
          border: 0 !important;
          min-width: 96px !important;
        }
        .swal2-cancel {
          background: #A8A9A2 !important;
          color: #fff !important;
        }
        .swal2-cancel:hover { filter: brightness(.98) !important; }
        .swal2-confirm {
          background: #38512F !important;
          color: #fff !important;
        }
      </style>
      <div class="gp-actions-wrap">
        <div class="gp-actions-head">
          <span class="gp-actions-head__icon"><i class="fas fa-users"></i></span>
          <span class="gp-actions-head__text">Administra participantes desde un solo lugar con una experiencia clara y ordenada.</span>
        </div>
        <div class="gp-actions-grid" id="gp-actions-grid">
          <button type="button" class="gp-action-btn" data-accion="agregar">
            <span class="gp-action-btn__icon"><i class="fas fa-user-plus"></i></span>
            <span class="gp-action-btn__label">Agregar participante</span>
          </button>
          <button type="button" class="gp-action-btn" data-accion="editar">
            <span class="gp-action-btn__icon"><i class="fas fa-user-edit"></i></span>
            <span class="gp-action-btn__label">Editar datos</span>
          </button>
          <button type="button" class="gp-action-btn" data-accion="eliminar">
            <span class="gp-action-btn__icon"><i class="fas fa-user-minus"></i></span>
            <span class="gp-action-btn__label">Eliminar participante</span>
          </button>
        </div>
        <div class="gp-actions-help">Selecciona una acción</div>
      </div>
    `;

    await Swal.fire({
      title: 'Gestión de usuarios',
      html,
      width: '640px',
      showCancelButton: true,
      showConfirmButton: false,
      cancelButtonColor: '#A8A9A2',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const botones = Array.from(document.querySelectorAll<HTMLButtonElement>('.gp-action-btn'));
        botones.forEach((btn) => {
          btn.addEventListener('click', () => {
            const accion = btn.dataset.accion as 'agregar' | 'editar' | 'eliminar' | undefined;
            if (accion) {
              accionSeleccionada = accion;
              Swal.close();
            }
          });
        });
      }
    });

    return accionSeleccionada;
  }

  private async seleccionarParticipanteGestion(accion: 'editar' | 'eliminar'): Promise<any | 'volver' | null> {
    const participantes = this.listaAlumnos.map((alumno, index) => {
      const key = alumno?.inscripcion_id != null ? `insc-${alumno.inscripcion_id}` : `idx-${index}`;
      return {
        key,
        alumno,
        nombre: (alumno?.nombre || 'SIN NOMBRE').toString(),
        curp: (alumno?.curp || 'SIN CURP').toString().toUpperCase(),
        puesto: (alumno?.puesto || 'N/A').toString()
      };
    });

    const normalizar = (texto: string): string =>
      (texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    let terminoBusqueda = '';
    let claveSeleccionada: string | null = null;

    const renderLista = (items: Array<{ key: string; nombre: string; curp: string; puesto: string }>): string => {
      if (items.length === 0) {
        return '<div class="gp-empty">No se encontraron participantes con ese criterio.</div>';
      }

      return items.map((item) => {
        const isActive = claveSeleccionada === item.key ? ' gp-user-item--active' : '';
        return `
          <button type="button" class="gp-user-item${isActive}" data-key="${item.key}">
            <div class="gp-user-item__name">${this.escapeHtml(item.nombre)}</div>
            <div class="gp-user-item__meta">CURP: ${this.escapeHtml(item.curp)} · Puesto: ${this.escapeHtml(item.puesto)}</div>
          </button>
        `;
      }).join('');
    };

    const html = `
      <style>
        .gp-users-wrap {
          text-align: left;
          font-family: 'Open Sans', sans-serif;
        }
        .gp-users-search {
          width: 100%;
          border: 1px solid #C2D1B2;
          border-radius: 8px;
          padding: .55rem .7rem;
          font-size: .86rem;
          color: #32325d;
          margin-bottom: .6rem;
        }
        .gp-users-search:focus {
          border-color: #38512F;
          box-shadow: 0 0 0 3px rgba(56, 81, 47, 0.1);
          outline: none;
        }
        .gp-users-help {
          font-size: .74rem;
          color: #A8A9A2;
          margin-bottom: .5rem;
        }
        .gp-users-list {
          max-height: 300px;
          overflow-y: auto;
          border: 1px solid #E2E3DE;
          border-radius: 10px;
          padding: .45rem;
          background: #fff;
        }
        .gp-user-item {
          width: 100%;
          text-align: left;
          border: 1px solid #E2E3DE;
          background: #fff;
          border-radius: 8px;
          padding: .5rem .6rem;
          margin-bottom: .45rem;
          cursor: pointer;
          transition: all .2s ease;
        }
        .gp-user-item:last-child {
          margin-bottom: 0;
        }
        .gp-user-item:hover {
          border-color: #768D6B;
          transform: translateY(-1px);
        }
        .gp-user-item--active {
          border-color: #38512F;
          background: rgba(56, 81, 47, 0.08);
        }
        .gp-user-item__name {
          font-size: .84rem;
          font-weight: 700;
          color: #38512F;
          line-height: 1.2;
        }
        .gp-user-item__meta {
          margin-top: .15rem;
          font-size: .73rem;
          color: #6c757d;
          line-height: 1.25;
        }
        .gp-empty {
          text-align: center;
          color: #A8A9A2;
          font-size: .8rem;
          padding: 1.1rem .8rem;
          border: 1px dashed #C2D1B2;
          border-radius: 8px;
          background: #f8f9fc;
        }
        /* Ocultar el botón de confirmar para que la selección sea inmediata al hacer click */
        .swal2-confirm { display: none !important; }
        /* Estilos para las acciones de Swal: alinear a la derecha y botones más agradables */
        .swal2-actions {
          display: flex !important;
          justify-content: flex-end !important;
          gap: .5rem !important;
          margin-top: 1rem !important;
        }
        .swal2-cancel, .swal2-confirm {
          border-radius: 8px !important;
          padding: .56rem .9rem !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
          border: 0 !important;
          min-width: 96px !important;
        }
        .swal2-cancel {
          background: #A8A9A2 !important;
          color: #fff !important;
        }
        .swal2-cancel:hover { filter: brightness(.98) !important; }
        .swal2-confirm {
          background: #38512F !important;
          color: #fff !important;
        }
      </style>
      <div class="gp-users-wrap">
        <input id="gp-users-search" class="gp-users-search" type="text" placeholder="Buscar por nombre o CURP...">
        <div class="gp-users-help">Participantes: ${participantes.length}</div>
        <div id="gp-users-list" class="gp-users-list"></div>
      </div>
    `;

    const result = await Swal.fire({
      title: accion === 'editar' ? 'Editar participante' : 'Eliminar participante',
      html,
      width: '680px',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: accion === 'editar' ? 'Editar' : 'Eliminar',
      cancelButtonText: 'Volver',
      focusConfirm: false,
      didOpen: () => {
        const inputBusqueda = document.getElementById('gp-users-search') as HTMLInputElement | null;
        const contenedorLista = document.getElementById('gp-users-list');
        // ocultar visualmente el botón confirmar (ya que la selección será inmediata)
        const btnConfirm = document.querySelector('.swal2-confirm') as HTMLElement | null;
        if (btnConfirm) btnConfirm.style.display = 'none';

        if (!contenedorLista) {
          return;
        }

        const pintar = () => {
          const filtrados = participantes.filter((p) => {
            const target = `${p.nombre} ${p.curp}`;
            return normalizar(target).includes(normalizar(terminoBusqueda));
          });

          contenedorLista.innerHTML = renderLista(filtrados);

          const botones = Array.from(contenedorLista.querySelectorAll<HTMLButtonElement>('.gp-user-item'));
          botones.forEach((btn) => {
            btn.addEventListener('click', () => {
              claveSeleccionada = btn.dataset.key || null;
              // marcar visualmente y confirmar inmediatamente
              pintar();
              // programáticamente confirmar para que preConfirm retorne la clave
              (Swal as any).clickConfirm();
            });
          });
        };

        inputBusqueda?.addEventListener('input', () => {
          terminoBusqueda = inputBusqueda.value || '';
          pintar();
        });

        pintar();
        inputBusqueda?.focus();
      },
      preConfirm: () => {
        if (!claveSeleccionada) {
          Swal.showValidationMessage('Selecciona un participante para continuar');
          return false;
        }
        return claveSeleccionada;
      }
    });

    if (result.dismiss === Swal.DismissReason.cancel) {
      return 'volver';
    }

    if (!result.value) {
      return null;
    }

    const participante = participantes.find((p) => p.key === result.value);
    return participante ? participante.alumno : null;
  }

  private escapeHtml(value: string): string {
    return (value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Agregar nuevo participante al curso
   */
  async agregarNuevoParticipante(): Promise<'volver' | void> {
    const html = `
      <style>
        .gp-add-wrap {
          text-align: left;
          font-family: 'Open Sans', sans-serif;
        }
        .gp-add-head {
          background: linear-gradient(135deg, rgba(56, 81, 47, 0.12) 0%, rgba(118, 141, 107, 0.16) 100%);
          border: 1px solid #C2D1B2;
          border-radius: 12px;
          padding: .75rem;
          margin-bottom: .9rem;
          display: flex;
          align-items: center;
          gap: .65rem;
        }
        .gp-add-head__icon {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, #38512F 0%, #5a7456 100%);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: .95rem;
          box-shadow: 0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08);
          flex-shrink: 0;
        }
        .gp-add-head__text {
          color: #38512F;
          font-size: .79rem;
          line-height: 1.35;
        }
        .gp-add-form {
          display: grid;
          gap: .65rem;
        }
        .gp-add-label {
          display: block;
          font-size: .76rem;
          font-weight: 700;
          color: #4d4f45;
          margin: 0 0 .28rem 0;
          letter-spacing: .02em;
          text-transform: uppercase;
        }
        .gp-add-label span {
          color: #c0392b;
        }
        .gp-add-field {
          display: flex;
          align-items: center;
          border: 1px solid #C9D5C2;
          border-radius: 10px;
          background: #fff;
          transition: border-color .2s ease, box-shadow .2s ease;
          overflow: hidden;
        }
        .gp-add-field:focus-within {
          border-color: #6b8a60;
          box-shadow: 0 0 0 3px rgba(56,81,47,.12);
        }
        .gp-add-field__icon {
          width: 40px;
          min-width: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #6D7467;
          font-size: .9rem;
          border-right: 1px solid #E6E9E3;
          background: #F6F8F4;
          align-self: stretch;
        }
        .gp-add-input {
          border: 0;
          outline: 0;
          width: 100%;
          padding: .62rem .68rem;
          font-size: .9rem;
          color: #2f312c;
          background: transparent;
        }
        .gp-add-input::placeholder {
          color: #a8aca4;
        }
        .gp-add-meta {
          margin-top: .32rem;
          display: flex;
          justify-content: space-between;
          gap: .5rem;
        }
        .gp-add-help {
          font-size: .72rem;
          color: #8d9487;
        }
        .gp-add-counter {
          font-size: .72rem;
          color: #5f6557;
          font-weight: 600;
          min-width: 42px;
          text-align: right;
        }
        .gp-add-legend {
          margin-top: .6rem;
          text-align: right;
          font-size: .7rem;
          color: #93988f;
        }
        @media (max-width: 640px) {
          .gp-add-head {
            padding: .65rem;
          }
          .gp-add-head__icon {
            width: 34px;
            height: 34px;
            font-size: .86rem;
          }
          .gp-add-input {
            padding: .58rem .62rem;
          }
        }
        /* Estilos para acciones en Swal */
        .swal2-actions {
          display: flex !important;
          justify-content: flex-end !important;
          gap: .5rem !important;
          margin-top: 1rem !important;
        }
        .swal2-cancel, .swal2-deny, .swal2-confirm {
          border-radius: 8px !important;
          padding: .56rem .9rem !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
          border: 0 !important;
          min-width: 116px !important;
          transition: transform .18s ease, box-shadow .18s ease, filter .18s ease !important;
          letter-spacing: .01em !important;
        }
        .swal2-cancel {
          background: linear-gradient(135deg, #b4b6af 0%, #9ea09a 100%) !important;
          color: #fff !important;
        }
        .swal2-cancel:hover {
          filter: brightness(.98) !important;
          transform: translateY(-1px) !important;
          box-shadow: 0 10px 20px rgba(0, 0, 0, .12) !important;
        }
        .swal2-deny {
          background: linear-gradient(135deg, #ffffff 0%, #f2f6ef 100%) !important;
          color: #38512F !important;
          border: 1px solid #9FB496 !important;
          box-shadow: 0 6px 14px rgba(37, 50, 33, .08) !important;
        }
        .swal2-deny:hover {
          background: #f3f7f1 !important;
          transform: translateY(-1px) !important;
          box-shadow: 0 10px 20px rgba(37, 50, 33, .12) !important;
        }
        .swal2-confirm {
          background: linear-gradient(135deg, #3f6232 0%, #2e4a25 100%) !important;
          color: #fff !important;
        }
        .swal2-confirm:hover {
          transform: translateY(-1px) !important;
          box-shadow: 0 10px 22px rgba(46, 74, 37, .35) !important;
        }
        .swal2-styled i {
          margin-right: .34rem;
        }
      </style>
      <div class="gp-add-wrap">
        <div class="gp-add-head">
          <span class="gp-add-head__icon"><i class="fas fa-user-plus"></i></span>
          <span class="gp-add-head__text">Captura los datos del participante para integrarlo al pase de lista y al flujo documental del curso.</span>
        </div>

        <div class="gp-add-form">
          <div>
            <label class="gp-add-label" for="swal-input-nombre">Nombre completo <span>*</span></label>
            <div class="gp-add-field">
              <span class="gp-add-field__icon"><i class="fas fa-user"></i></span>
              <input id="swal-input-nombre" class="gp-add-input" placeholder="Ej. JUAN PEREZ HERNANDEZ" autocomplete="off">
            </div>
          </div>

          <div>
            <label class="gp-add-label" for="swal-input-curp">CURP <span>*</span></label>
            <div class="gp-add-field">
              <span class="gp-add-field__icon"><i class="fas fa-id-card"></i></span>
              <input id="swal-input-curp" class="gp-add-input" placeholder="CURP a 18 caracteres" maxlength="18" autocomplete="off">
            </div>
            <div class="gp-add-meta">
              <small class="gp-add-help">Se convierte automaticamente a mayusculas.</small>
              <small class="gp-add-counter" id="swal-curp-counter">0/18</small>
            </div>
          </div>

          <div>
            <label class="gp-add-label" for="swal-input-puesto">Puesto</label>
            <div class="gp-add-field">
              <span class="gp-add-field__icon"><i class="fas fa-briefcase"></i></span>
              <input id="swal-input-puesto" class="gp-add-input" placeholder="Opcional" autocomplete="off">
            </div>
          </div>
        </div>

        <div class="gp-add-legend">* Campos obligatorios</div>
      </div>
    `;

    const swalResult = await Swal.fire({
      title: 'Agregar Participante',
      html,
      width: '640px',
      focusConfirm: false,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      denyButtonColor: '#fff',
      confirmButtonText: '<i class="fas fa-plus"></i>Agregar',
      denyButtonText: '<i class="fas fa-users"></i>Empleados',
      cancelButtonText: '<i class="fas fa-arrow-left"></i>Volver',
      didOpen: () => {
        const inputNombre = document.getElementById('swal-input-nombre') as HTMLInputElement | null;
        const inputCurp = document.getElementById('swal-input-curp') as HTMLInputElement | null;
        const contadorCurp = document.getElementById('swal-curp-counter');

        const actualizarCurp = (): void => {
          if (!inputCurp) {
            return;
          }

          inputCurp.value = (inputCurp.value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 18);

          if (contadorCurp) {
            contadorCurp.textContent = `${inputCurp.value.length}/18`;
          }
        };

        inputCurp?.addEventListener('input', actualizarCurp);
        actualizarCurp();
        inputNombre?.focus();
      },
      preConfirm: () => {
        const nombre = ((document.getElementById('swal-input-nombre') as HTMLInputElement | null)?.value || '').trim();
        const curp = ((document.getElementById('swal-input-curp') as HTMLInputElement | null)?.value || '').toUpperCase().trim();
        const puesto = ((document.getElementById('swal-input-puesto') as HTMLInputElement | null)?.value || '').trim();

        if (!nombre || !curp) {
          Swal.showValidationMessage('Nombre y CURP son obligatorios');
          return false;
        }

        if (curp.length !== 18) {
          Swal.showValidationMessage('El CURP debe tener 18 caracteres');
          return false;
        }

        return { nombre, curp, puesto };
      }
    });

    if (swalResult.dismiss === Swal.DismissReason.cancel) {
      return 'volver';
    }

    if (swalResult.isDenied) {
      await this.abrirSelectorEmpleadosEmpresa();
      return;
    }

    const formValues = swalResult.value;

    if (formValues) {
      // Agregar al backend
      this.backendServices.agregarParticipanteCurso(this.cursoId!, formValues.nombre, formValues.curp, formValues.puesto).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          if (response.success) {
            // Agregar a la lista local
            const nuevoParticipante = {
              inscripcion_id: response.inscripcion_id,
              id: response.empleado_id,
              nombre: formValues.nombre.toUpperCase(),
              curp: formValues.curp.toUpperCase(),
              puesto: formValues.puesto || '',
              asistio: false,
              nota: '',
              requiereDC3: false,
              examenDiagnostico: null,
              evaluacionFinal: null
            };
            this.listaAlumnos.push(nuevoParticipante);
            this.recalcularListaPaseFiltrada();

            Swal.fire({
              title: '¡Agregado!',
              text: 'Participante agregado exitosamente',
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2000
            });
          }
        },
        error: (err) => {
          console.error('❌ Error agregando participante:', err);
          Swal.fire({
            title: 'Error',
            text: err.error?.message || 'No se pudo agregar al participante',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
    }
  }

  private obtenerEmpresaIdParaEmpleadosCurso(): number | null {
    const empresaCursoId = Number(this.curso?.empresa_id || 0);
    if (empresaCursoId > 0) {
      return empresaCursoId;
    }

    const empresaUsuarioId = Number(this.authService.getEmpresaId() || 0);
    return empresaUsuarioId > 0 ? empresaUsuarioId : null;
  }

  private esEmpleadoEmpresaActivo(empleado: any): boolean {
    const activoRaw = empleado?.activo;
    if (activoRaw === undefined || activoRaw === null) return true;
    if (typeof activoRaw === 'boolean') return activoRaw;
    return Number(activoRaw) === 1;
  }

  private construirNombreEmpleadoEmpresa(empleado: any): string {
    const nombre = String(empleado?.nombre || '').trim();
    const apellidoPaterno = String(empleado?.apellido_paterno || '').trim();
    const apellidoMaterno = String(empleado?.apellido_materno || '').trim();
    const compuesto = [apellidoPaterno, apellidoMaterno, nombre]
      .filter((parte) => !!parte)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return (compuesto || nombre).toUpperCase();
  }

  private curpsInscritosEnCursoSet(): Set<string> {
    return new Set(
      (this.listaAlumnos || [])
        .map((alumno) => String(alumno?.curp || '').toUpperCase().trim())
        .filter((curp) => curp.length > 0)
    );
  }

  private async abrirSelectorEmpleadosEmpresa(): Promise<void> {
    if (!this.cursoId) {
      await Swal.fire({
        title: 'Curso no disponible',
        text: 'No se pudo identificar el curso actual.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    let empleadosEmpresa: EmpleadoEmpresaDisponible[] = [];
    let empresaId = this.obtenerEmpresaIdParaEmpleadosCurso();

    try {
      const response: any = await firstValueFrom(
        this.backendServices.obtenerEmpleadosEmpresaCurso(this.cursoId).pipe(takeUntil(this.destroy$))
      );

      empresaId = Number(response?.empresa_id || empresaId || 0);
      if (!empresaId) {
        throw new Error('No se pudo resolver la empresa del curso.');
      }

      const empleadosRaw = Array.isArray(response?.empleados) ? response.empleados : [];
      const curpsInscritos = this.curpsInscritosEnCursoSet();

      empleadosEmpresa = empleadosRaw
        .filter((empleado: any) => this.esEmpleadoEmpresaActivo(empleado))
        .map((empleado: any) => {
          const curp = String(empleado?.curp || '').toUpperCase().trim();
          return {
            empleado_id: Number(empleado?.empleado_id || 0),
            nombre: this.construirNombreEmpleadoEmpresa(empleado),
            curp,
            puesto: String(empleado?.puesto || '').trim(),
            seleccionado: false,
            yaInscrito: curpsInscritos.has(curp)
          };
        })
        .filter((empleado: EmpleadoEmpresaDisponible) => empleado.empleado_id > 0 && empleado.nombre.length > 0 && empleado.curp.length > 0)
        .sort((a: EmpleadoEmpresaDisponible, b: EmpleadoEmpresaDisponible) => a.nombre.localeCompare(b.nombre));
    } catch (error: any) {
      console.error('❌ Error cargando empleados de la empresa:', error);
      await Swal.fire({
        title: 'Error',
        text: error?.error?.message || 'No se pudieron cargar los empleados de la empresa.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (empleadosEmpresa.length === 0) {
      await Swal.fire({
        title: 'Sin empleados disponibles',
        text: 'La empresa del curso no tiene empleados activos registrados.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const normalizar = (texto: string): string =>
      String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    let terminoBusqueda = '';

    const obtenerFiltrados = (): EmpleadoEmpresaDisponible[] => {
      if (!terminoBusqueda) {
        return [...empleadosEmpresa];
      }

      const termino = normalizar(terminoBusqueda);
      return empleadosEmpresa.filter((empleado) => {
        return normalizar(`${empleado.nombre} ${empleado.curp}`).includes(termino);
      });
    };

    const contarSeleccionados = (): number => {
      return empleadosEmpresa.filter((empleado) => empleado.seleccionado && !empleado.yaInscrito).length;
    };

    const renderLista = (filtrados: EmpleadoEmpresaDisponible[]): string => {
      if (filtrados.length === 0) {
        return '<div class="gp-emp-empty">No se encontraron empleados con ese criterio.</div>';
      }

      return filtrados.map((empleado) => {
        const disabled = empleado.yaInscrito ? ' disabled' : '';
        const checked = empleado.seleccionado ? ' checked' : '';
        const yaInscritoBadge = empleado.yaInscrito
          ? '<span class="gp-emp-item__tag">Ya agregado</span>'
          : '';

        return `
          <label class="gp-emp-item${empleado.yaInscrito ? ' is-disabled' : ''}">
            <input type="checkbox" class="gp-emp-item__checkbox" data-emp-id="${empleado.empleado_id}"${checked}${disabled}>
            <div class="gp-emp-item__main">
              <span class="gp-emp-item__name">${this.escapeHtml(empleado.nombre)}</span>
              <span class="gp-emp-item__meta">CURP: ${this.escapeHtml(empleado.curp)}</span>
            </div>
            ${yaInscritoBadge}
          </label>
        `;
      }).join('');
    };

    const tituloSelector = this.esPerfilEmpresa ? 'Seleccionar desde Mis Empleados' : 'Seleccionar empleados de la empresa';

    const resultado = await Swal.fire({
      title: 'Registrar Empleados',
      html: `
        <style>
          .gp-emp-wrap {
            text-align: left;
            font-family: 'Open Sans', sans-serif;
          }
          .gp-emp-head {
            display: flex;
            justify-content: space-between;
            gap: .75rem;
            align-items: flex-start;
            margin-bottom: .75rem;
            padding: .72rem .75rem;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(56, 81, 47, 0.12) 0%, rgba(118, 141, 107, 0.16) 100%);
            border: 1px solid #C2D1B2;
          }
          .gp-emp-head__title {
            color: #38512F;
            font-size: .96rem;
            font-weight: 700;
            line-height: 1.2;
            margin: 0;
          }
          .gp-emp-head__sub {
            color: #5d6356;
            font-size: .79rem;
            display: block;
            margin-top: .2rem;
            line-height: 1.35;
          }
          .gp-emp-count {
            background: #38512F;
            color: #fff;
            border-radius: 999px;
            padding: .34rem .62rem;
            font-size: .82rem;
            font-weight: 700;
            white-space: nowrap;
          }
          .gp-emp-toolbar {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: .6rem;
            margin-bottom: .7rem;
          }
          .gp-emp-search {
            position: relative;
          }
          .gp-emp-search i {
            position: absolute;
            left: .8rem;
            top: 50%;
            transform: translateY(-50%);
            color: #7f8778;
            font-size: .88rem;
          }
          .gp-emp-search input {
            width: 100%;
            border: 1px solid #D3DACD;
            border-radius: 10px;
            padding: .58rem .72rem .58rem 2.1rem;
            font-size: .88rem;
            color: #2f312c;
          }
          .gp-emp-search input:focus {
            border-color: #6b8a60;
            box-shadow: 0 0 0 3px rgba(56,81,47,.12);
            outline: none;
          }
          .gp-emp-actions {
            display: flex;
            gap: .45rem;
            align-items: center;
          }
          .gp-emp-actions button {
            border: 1px solid #9FB496;
            border-radius: 9px;
            background: linear-gradient(135deg, #ffffff 0%, #f2f6ef 100%);
            color: #38512F;
            font-size: .79rem;
            font-weight: 600;
            padding: .5rem .75rem;
            cursor: pointer;
            transition: all .2s ease;
            box-shadow: 0 6px 14px rgba(37, 50, 33, .08);
          }
          .gp-emp-actions button i {
            margin-right: .3rem;
          }
          .gp-emp-actions button:disabled {
            opacity: .5;
            cursor: not-allowed;
            box-shadow: none;
          }
          .gp-emp-actions button:not(:disabled):hover {
            background: #f3f7f1;
            transform: translateY(-1px);
            box-shadow: 0 10px 18px rgba(37, 50, 33, .14);
          }
          .gp-emp-list {
            border: 1px solid #E1E5DD;
            border-radius: 12px;
            max-height: 320px;
            overflow-y: auto;
            padding: .55rem;
            background: #fff;
          }
          .gp-emp-item {
            display: grid;
            grid-template-columns: 22px 1fr auto;
            gap: .55rem;
            align-items: center;
            border: 1px solid #E1E5DD;
            border-radius: 10px;
            padding: .5rem .62rem;
            margin-bottom: .5rem;
            transition: all .18s ease;
          }
          .gp-emp-item:last-child {
            margin-bottom: 0;
          }
          .gp-emp-item:hover {
            border-color: #9FB496;
          }
          .gp-emp-item.is-disabled {
            opacity: .62;
            background: #f7f8f6;
          }
          .gp-emp-item__checkbox {
            width: 20px;
            height: 20px;
            margin: 0;
          }
          .gp-emp-item__main {
            min-width: 0;
          }
          .gp-emp-item__name {
            display: block;
            color: #2f312c;
            font-size: .85rem;
            font-weight: 700;
            line-height: 1.2;
          }
          .gp-emp-item__meta {
            display: block;
            color: #6d7467;
            font-size: .75rem;
            margin-top: .16rem;
          }
          .gp-emp-item__tag {
            display: inline-flex;
            align-items: center;
            padding: .2rem .5rem;
            border-radius: 999px;
            background: #A8A9A2;
            color: #fff;
            font-size: .66rem;
            font-weight: 700;
            letter-spacing: .02em;
          }
          .gp-emp-empty {
            text-align: center;
            color: #83897f;
            border: 1px dashed #C2D1B2;
            border-radius: 10px;
            padding: 1.1rem .8rem;
            font-size: .83rem;
            background: #f8f9f7;
          }
          .gp-emp-foot {
            margin-top: .55rem;
            font-size: .75rem;
            color: #7a8173;
          }
          .swal2-actions {
            display: flex !important;
            justify-content: flex-end !important;
            gap: .55rem !important;
            margin-top: 1rem !important;
          }
          .swal2-cancel, .swal2-confirm {
            border-radius: 9px !important;
            min-width: 170px !important;
            padding: .6rem .95rem !important;
            font-weight: 700 !important;
            letter-spacing: .01em !important;
            transition: transform .18s ease, box-shadow .18s ease !important;
            border: 0 !important;
          }
          .swal2-cancel {
            background: linear-gradient(135deg, #b4b6af 0%, #9ea09a 100%) !important;
            color: #fff !important;
            box-shadow: 0 8px 16px rgba(0, 0, 0, .14) !important;
          }
          .swal2-confirm {
            background: linear-gradient(135deg, #3f6232 0%, #2e4a25 100%) !important;
            color: #fff !important;
            box-shadow: 0 10px 20px rgba(46, 74, 37, .32) !important;
          }
          .swal2-cancel:hover,
          .swal2-confirm:hover {
            transform: translateY(-1px) !important;
          }
          @media (max-width: 760px) {
            .gp-emp-toolbar {
              grid-template-columns: 1fr;
            }
            .gp-emp-actions {
              justify-content: flex-start;
              flex-wrap: wrap;
            }
            .gp-emp-item {
              grid-template-columns: 22px 1fr;
            }
            .gp-emp-item__tag {
              grid-column: 1 / -1;
              width: fit-content;
              margin-left: 1.75rem;
            }
            .swal2-cancel, .swal2-confirm {
              min-width: 140px !important;
            }
          }
        </style>

        <div class="gp-emp-wrap">
          <div class="gp-emp-head">
            <div>
              <p class="gp-emp-head__title">${this.escapeHtml(tituloSelector)}</p>
            </div>
            <span class="gp-emp-count" id="gp-emp-count">0 seleccionados</span>
          </div>
          <div class="gp-emp-toolbar">
            <div class="gp-emp-search">
              <i class="fas fa-search"></i>
              <input id="gp-emp-search" type="text" placeholder="Buscar empleado (nombre o CURP)">
            </div>
            <div class="gp-emp-actions">
              <button type="button" id="gp-emp-select-visible"><i class="fas fa-check-double"></i>Seleccionar visibles</button>
              <button type="button" id="gp-emp-clear-selection"><i class="fas fa-eraser"></i>Limpiar seleccion</button>
            </div>
          </div>

          <div class="gp-emp-list" id="gp-emp-list"></div>
          <div class="gp-emp-foot" id="gp-emp-foot"></div>
        </div>
      `,
      width: '1120px',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Cargar Empleados',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      didOpen: () => {
        const searchInput = document.getElementById('gp-emp-search') as HTMLInputElement | null;
        const listContainer = document.getElementById('gp-emp-list');
        const footer = document.getElementById('gp-emp-foot');
        const countBadge = document.getElementById('gp-emp-count');
        const btnSelectVisible = document.getElementById('gp-emp-select-visible') as HTMLButtonElement | null;
        const btnClearSelection = document.getElementById('gp-emp-clear-selection') as HTMLButtonElement | null;

        if (!listContainer) {
          return;
        }

        const pintar = (): void => {
          const filtrados = obtenerFiltrados();
          listContainer.innerHTML = renderLista(filtrados);

          listContainer.querySelectorAll<HTMLInputElement>('.gp-emp-item__checkbox').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
              const empleadoId = Number(checkbox.dataset.empId || 0);
              const empleado = empleadosEmpresa.find((item) => item.empleado_id === empleadoId);
              if (empleado && !empleado.yaInscrito) {
                empleado.seleccionado = checkbox.checked;
                if (countBadge) {
                  countBadge.textContent = `${contarSeleccionados()} seleccionados`;
                }
                if (btnClearSelection) {
                  btnClearSelection.disabled = contarSeleccionados() === 0;
                }
              }
            });
          });

          if (countBadge) {
            countBadge.textContent = `${contarSeleccionados()} seleccionados`;
          }

          if (footer) {
            footer.textContent = `Mostrando ${filtrados.length} de ${empleadosEmpresa.length} empleados.`;
          }

          const visiblesSeleccionables = filtrados.filter((empleado) => !empleado.yaInscrito);
          if (btnSelectVisible) {
            btnSelectVisible.disabled = visiblesSeleccionables.length === 0;
          }
          if (btnClearSelection) {
            btnClearSelection.disabled = contarSeleccionados() === 0;
          }
        };

        btnSelectVisible?.addEventListener('click', () => {
          const filtrados = obtenerFiltrados();
          filtrados.forEach((empleado) => {
            if (!empleado.yaInscrito) {
              empleado.seleccionado = true;
            }
          });
          pintar();
        });

        btnClearSelection?.addEventListener('click', () => {
          empleadosEmpresa.forEach((empleado) => {
            empleado.seleccionado = false;
          });
          pintar();
        });

        searchInput?.addEventListener('input', () => {
          terminoBusqueda = searchInput.value || '';
          pintar();
        });

        pintar();
        searchInput?.focus();
      },
      preConfirm: () => {
        const seleccionados = empleadosEmpresa.filter((empleado) => empleado.seleccionado && !empleado.yaInscrito);
        if (seleccionados.length === 0) {
          Swal.showValidationMessage('Selecciona al menos un empleado para continuar.');
          return false;
        }
        return seleccionados;
      }
    });

    if (!resultado.isConfirmed || !Array.isArray(resultado.value)) {
      return;
    }

    const empleadosSeleccionados = resultado.value as EmpleadoEmpresaDisponible[];
    const payload = {
      empresa_id: empresaId,
      empleados: empleadosSeleccionados.map((empleado) => ({
        nombre: empleado.nombre,
        curp: empleado.curp,
        puesto: empleado.puesto || null
      }))
    };

    try {
      Swal.fire({
        title: 'Cargando empleados',
        text: 'Registrando empleados en el curso...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const response: any = await firstValueFrom(
        this.backendServices.registrarEmpleadosCurso(this.cursoId, payload).pipe(takeUntil(this.destroy$))
      );

      Swal.close();

      if (!response?.success) {
        await Swal.fire({
          title: 'Error',
          text: response?.message || 'No se pudieron registrar los empleados seleccionados.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      this.cargarParticipantes();

      this.backendServices.generarSGCF33Drive(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.cargarDocumentosProgramado();
        },
        error: (err: any) => {
          console.info('[SGC-F-33] No se pudo regenerar automaticamente:', err?.error?.message || err?.message || err);
        }
      });

      this.backendServices.generarSGCF33VaciaDrive(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.cargarDocumentosProgramado();
        },
        error: (err: any) => {
          console.info('[SGC-F-33 vacia] No se pudo regenerar automaticamente:', err?.error?.message || err?.message || err);
        }
      });

      const totalRegistrados = Array.isArray(response?.empleadosRegistrados)
        ? response.empleadosRegistrados.length
        : empleadosSeleccionados.length;
      const totalYaInscritos = Array.isArray(response?.empleadosYaInscritos)
        ? response.empleadosYaInscritos.length
        : 0;
      const errores = Array.isArray(response?.errores) ? response.errores : [];
      const advertencias = Array.isArray(response?.advertencias) ? response.advertencias : [];

      let htmlResultado = `<p>Se registraron <strong>${totalRegistrados}</strong> empleado(s) al curso.</p>`;

      if (totalYaInscritos > 0) {
        htmlResultado += `<small class="d-block text-muted mt-2">${totalYaInscritos} empleado(s) ya estaban inscritos.</small>`;
      }
      if (advertencias.length > 0) {
        htmlResultado += `<small class="d-block mt-2" style="color:#f0ad4e;">${this.escapeHtml(advertencias.join(' | '))}</small>`;
      }
      if (errores.length > 0) {
        htmlResultado += `<small class="d-block mt-2" style="color:#fb6340;">${this.escapeHtml(errores.join(' | '))}</small>`;
      }

      await Swal.fire({
        title: 'Empleados cargados',
        html: htmlResultado,
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (error: any) {
      Swal.close();
      console.error('❌ Error registrando empleados seleccionados:', error);
      await Swal.fire({
        title: 'Error',
        text: error?.error?.message || 'No se pudieron registrar los empleados seleccionados.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  /**
   * Editar datos de un participante
   */
  async editarParticipante(alumno: any): Promise<'volver' | void> {
    const html = `
      <style>
        .gp-edit-wrap {
          text-align: left;
          font-family: 'Open Sans', sans-serif;
        }
        .gp-edit-head {
          background: linear-gradient(135deg, rgba(56, 81, 47, 0.12) 0%, rgba(118, 141, 107, 0.16) 100%);
          border: 1px solid #C2D1B2;
          border-radius: 12px;
          padding: .75rem;
          margin-bottom: .9rem;
          display: flex;
          align-items: center;
          gap: .65rem;
        }
        .gp-edit-head__icon {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, #38512F 0%, #5a7456 100%);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: .95rem;
          box-shadow: 0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08);
          flex-shrink: 0;
        }
        .gp-edit-head__text {
          color: #38512F;
          font-size: .79rem;
          line-height: 1.35;
        }
        .gp-edit-form {
          display: grid;
          gap: .65rem;
        }
        .gp-edit-label {
          display: block;
          font-size: .76rem;
          font-weight: 700;
          color: #4d4f45;
          margin: 0 0 .28rem 0;
          letter-spacing: .02em;
          text-transform: uppercase;
        }
        .gp-edit-label span {
          color: #c0392b;
        }
        .gp-edit-field {
          display: flex;
          align-items: center;
          border: 1px solid #C9D5C2;
          border-radius: 10px;
          background: #fff;
          transition: border-color .2s ease, box-shadow .2s ease;
          overflow: hidden;
        }
        .gp-edit-field:focus-within {
          border-color: #6b8a60;
          box-shadow: 0 0 0 3px rgba(56,81,47,.12);
        }
        .gp-edit-field__icon {
          width: 40px;
          min-width: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #6D7467;
          font-size: .9rem;
          border-right: 1px solid #E6E9E3;
          background: #F6F8F4;
          align-self: stretch;
        }
        .gp-edit-input {
          border: 0;
          outline: 0;
          width: 100%;
          padding: .62rem .68rem;
          font-size: .9rem;
          color: #2f312c;
          background: transparent;
        }
        .gp-edit-input::placeholder {
          color: #a8aca4;
        }
        .gp-edit-meta {
          margin-top: .32rem;
          display: flex;
          justify-content: space-between;
          gap: .5rem;
        }
        .gp-edit-help {
          font-size: .72rem;
          color: #8d9487;
        }
        .gp-edit-counter {
          font-size: .72rem;
          color: #5f6557;
          font-weight: 600;
          min-width: 42px;
          text-align: right;
        }
        .gp-edit-legend {
          margin-top: .6rem;
          text-align: right;
          font-size: .7rem;
          color: #93988f;
        }
        @media (max-width: 640px) {
          .gp-edit-head {
            padding: .65rem;
          }
          .gp-edit-head__icon {
            width: 34px;
            height: 34px;
            font-size: .86rem;
          }
          .gp-edit-input {
            padding: .58rem .62rem;
          }
        }
        /* Estilos para acciones en Swal */
        .swal2-actions {
          display: flex !important;
          justify-content: flex-end !important;
          gap: .5rem !important;
          margin-top: 1rem !important;
        }
        .swal2-cancel, .swal2-confirm {
          border-radius: 8px !important;
          padding: .56rem .9rem !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
          border: 0 !important;
          min-width: 96px !important;
        }
        .swal2-cancel { background: #A8A9A2 !important; color: #fff !important; }
        .swal2-cancel:hover { filter: brightness(.98) !important; }
        .swal2-confirm { background: #38512F !important; color: #fff !important; }
      </style>
      <div class="gp-edit-wrap">
        <div class="gp-edit-head">
          <span class="gp-edit-head__icon"><i class="fas fa-user-edit"></i></span>
          <span class="gp-edit-head__text">Actualiza los datos del participante para mantener el pase de lista y la documentacion del curso al dia.</span>
        </div>

        <div class="gp-edit-form">
          <div>
            <label class="gp-edit-label" for="swal-edit-nombre">Nombre completo <span>*</span></label>
            <div class="gp-edit-field">
              <span class="gp-edit-field__icon"><i class="fas fa-user"></i></span>
              <input id="swal-edit-nombre" class="gp-edit-input" placeholder="Ej. JUAN PEREZ HERNANDEZ" autocomplete="off">
            </div>
          </div>

          <div>
            <label class="gp-edit-label" for="swal-edit-curp">CURP <span>*</span></label>
            <div class="gp-edit-field">
              <span class="gp-edit-field__icon"><i class="fas fa-id-card"></i></span>
              <input id="swal-edit-curp" class="gp-edit-input" placeholder="CURP a 18 caracteres" maxlength="18" autocomplete="off">
            </div>
            <div class="gp-edit-meta">
              <small class="gp-edit-help">Se convierte automaticamente a mayusculas.</small>
              <small class="gp-edit-counter" id="swal-edit-curp-counter">0/18</small>
            </div>
          </div>

          <div>
            <label class="gp-edit-label" for="swal-edit-puesto">Puesto</label>
            <div class="gp-edit-field">
              <span class="gp-edit-field__icon"><i class="fas fa-briefcase"></i></span>
              <input id="swal-edit-puesto" class="gp-edit-input" placeholder="Opcional" autocomplete="off">
            </div>
          </div>
        </div>

        <div class="gp-edit-legend">* Campos obligatorios</div>
      </div>
    `;

    const result = await Swal.fire({
      title: 'Editar Participante',
      html,
      width: '640px',
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Volver',
      didOpen: () => {
        const inputNombre = document.getElementById('swal-edit-nombre') as HTMLInputElement | null;
        const inputCurp = document.getElementById('swal-edit-curp') as HTMLInputElement | null;
        const inputPuesto = document.getElementById('swal-edit-puesto') as HTMLInputElement | null;
        const contadorCurp = document.getElementById('swal-edit-curp-counter');

        if (inputNombre) {
          inputNombre.value = (alumno?.nombre || '').toString().trim();
        }
        if (inputCurp) {
          inputCurp.value = (alumno?.curp || '').toString().toUpperCase().trim();
        }
        if (inputPuesto) {
          inputPuesto.value = (alumno?.puesto || '').toString().trim();
        }

        const actualizarCurp = (): void => {
          if (!inputCurp) {
            return;
          }

          inputCurp.value = (inputCurp.value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 18);

          if (contadorCurp) {
            contadorCurp.textContent = `${inputCurp.value.length}/18`;
          }
        };

        inputCurp?.addEventListener('input', actualizarCurp);
        actualizarCurp();
        inputNombre?.focus();
      },
      preConfirm: () => {
        const nombre = ((document.getElementById('swal-edit-nombre') as HTMLInputElement | null)?.value || '').trim();
        const curp = ((document.getElementById('swal-edit-curp') as HTMLInputElement | null)?.value || '').toUpperCase().trim();
        const puesto = ((document.getElementById('swal-edit-puesto') as HTMLInputElement | null)?.value || '').trim();

        if (!nombre || !curp) {
          Swal.showValidationMessage('Nombre y CURP son obligatorios');
          return false;
        }

        if (curp.length !== 18) {
          Swal.showValidationMessage('El CURP debe tener 18 caracteres');
          return false;
        }

        return { nombre, curp, puesto };
      }
    });

    if (result.dismiss === Swal.DismissReason.cancel) {
      return 'volver';
    }

    const formValues = result.value;

    if (formValues) {
      // Actualizar en el backend
      this.backendServices.actualizarParticipante(alumno.inscripcion_id, formValues.nombre, formValues.curp, formValues.puesto).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response: any) => {
          if (response.success) {
            // Actualizar en la lista local
            alumno.nombre = formValues.nombre.toUpperCase();
            alumno.curp = formValues.curp.toUpperCase();
            alumno.puesto = formValues.puesto;
            this.recalcularListaPaseFiltrada();

            Swal.fire({
              title: '¡Actualizado!',
              text: 'Datos del participante actualizados',
              icon: 'success',
              confirmButtonColor: '#38512F',
              timer: 2000
            });
          }
        },
        error: (err) => {
          console.error('❌ Error actualizando participante:', err);
          Swal.fire({
            title: 'Error',
            text: 'No se pudieron actualizar los datos',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      });
    }
  }

  /**
   * Formatea una fecha al formato DD/MM/YYYY
   */
  formatDate(date: any): string {
    if (!date) return 'Sin fecha';
    return formatearFechaDdmmaaaa(date) || 'Sin fecha';
  }

  /**
   * Formatea fecha al estilo corto español: DD-mmm-YY (ej: 24-ene-26)
   */
  formatDateShortEs(date: any): string {
    if (!date) return 'Sin fecha';
    return formatearFechaCursoCortoEs(date) || 'Sin fecha';
  }

  private inicializarInformeFinalForm(): void {
    this.preFillObjetivos();
    if (!this.informeFinalForm.totalHoras) {
      this.informeFinalForm.totalHoras = this.informeTotalHorasDefault;
    }
  }

  /** Pre-fill objectives: start with one empty row so user can type */
  private preFillObjetivos(): void {
    if (this.informeFinalForm.objetivos.length === 0) {
      this.informeFinalForm.objetivos = [
        { texto: '', porcentaje: '100', comentarios: '' }
      ];
    }
  }

  private tieneObjetivosCapturados(): boolean {
    return (this.informeFinalForm.objetivos || []).some((obj: any) => String(obj?.texto || '').trim().length > 0);
  }

  private aplicarSugerenciaEstructuraInforme(estructura: any): void {
    if (!estructura) return;

    const objetivosSugeridos = Array.isArray(estructura.objetivos) ? estructura.objetivos : [];
    const expectativasArr = Array.isArray(estructura.expectativas)
      ? estructura.expectativas.map((texto: string) => String(texto || '').trim()).filter(Boolean)
      : [];
    const expectativasSugeridas = expectativasArr.join('\n') || String(estructura.expectativasTexto || '').trim();

    if (!this.tieneObjetivosCapturados() && objetivosSugeridos.length > 0) {
      this.informeFinalForm.objetivos = objetivosSugeridos
        .map((texto: string) => ({
          texto: String(texto || '').trim(),
          porcentaje: '100',
          comentarios: ''
        }))
        .filter((obj: any) => obj.texto);

      if (this.informeFinalForm.objetivos.length === 0) {
        this.preFillObjetivos();
      }
    }

    if (!String(this.informeFinalForm.expectativasTexto || '').trim() && expectativasSugeridas) {
      this.informeFinalForm.expectativasTexto = expectativasSugeridas;
    }
  }

  private cargarSugerenciaEstructuraInforme(): void {
    if (!this.cursoId || this.informeEstructuraSugeridaCargada) return;

    this.informeEstructuraSugeridaCargada = true;

    this.backendServices.obtenerSugerenciaEstructuraInforme(this.cursoId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          if (response?.success && response?.matched && response?.estructura) {
            this.aplicarSugerenciaEstructuraInforme(response.estructura);
          }
        },
        error: (err: any) => {
          console.warn('No se pudo cargar la sugerencia de estructura del informe:', err?.error?.message || err?.message || err);
        }
      });
  }

  agregarObjetivo(): void {
    this.informeFinalForm.objetivos.push({ texto: '', porcentaje: '100', comentarios: '' });
  }

  eliminarObjetivo(index: number): void {
    if (this.informeFinalForm.objetivos.length > 1) {
      this.informeFinalForm.objetivos.splice(index, 1);
    }
  }

  toggleSeccionInforme(seccion: string): void {
    this.informeSeccionActiva = this.informeSeccionActiva === seccion ? null : seccion;
  }

  private sincronizarPersonaSolicitanteBase(): void {
    const personaCurso = String(this.curso?.persona_solicitante || '').trim();
    if (!this.personaSolicitanteManual && personaCurso) {
      this.personaSolicitanteManual = personaCurso;
    }
  }

  get informePersonaSolicitante(): string {
    if (this.usarEmpresaComoSolicitante) {
      return this.empresaNombre || 'Pendiente';
    }

    const persona = String(this.personaSolicitanteManual || this.curso?.persona_solicitante || '').trim();
    if (persona) {
      return persona;
    }

    return this.empresaNombre || 'Pendiente';
  }

  /** Fetch persona solicitante (usuario responsable de la empresa) from backend */
  private cargarEmpresaContacto(): void {
    if (!this.cursoId) return;
    this.backendServices.obtenerEmpresaContacto(this.cursoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response: any) => {
        if (response.success && response.contacto) {
          const personaSolicitante = String(response.contacto.persona_solicitante || '').trim();
          if (this.curso) {
            this.curso.persona_solicitante = personaSolicitante || this.curso.persona_solicitante;
          }
          if (!this.personaSolicitanteManual && personaSolicitante) {
            this.personaSolicitanteManual = personaSolicitante;
          }
          if (!this.empresaNombre && response.contacto.nombre_empresa) {
            this.empresaNombre = response.contacto.nombre_empresa;
          }
        }
      },
      error: (err: any) => {
      }
    });
  }

  get informeInstructor(): string {
    return this.curso?.instructor_nombre || 'Pendiente';
  }

  get informeLugar(): string {
    return this.resolverLugarCiudadEstado();
  }

  get informePeriodo(): string {
    if (!this.curso?.fecha_inicio) return 'Pendiente';
    return this.formatDateShortEs(this.curso.fecha_inicio);
  }

  get informeHorarios(): string {
    const inicio = this.curso?.hora_inicio;
    const fin = this.curso?.hora_fin;
    if (inicio && fin) {
      const hI = String(inicio).substring(0, 5);
      const hF = String(fin).substring(0, 5);
      return `${hI} a ${hF} horas`;
    }
    if (inicio) return String(inicio).substring(0, 5);
    return 'Pendiente';
  }

  get informeTotalHorasDefault(): string {
    const inicio = this.curso?.hora_inicio;
    const fin = this.curso?.hora_fin;
    if (inicio && fin) {
      const [hI, mI] = String(inicio).split(':').map(Number);
      const [hF, mF] = String(fin).split(':').map(Number);
      const totalMinutos = (hF * 60 + (mF || 0)) - (hI * 60 + (mI || 0));
      if (totalMinutos > 0) {
        return String(Math.floor(totalMinutos / 60));
      }
    }
    const horas = this.curso?.curso_horas || this.curso?.horas || this.curso?.total_horas;
    return horas ? String(horas) : '';
  }

  get informeTotalHoras(): string {
    return this.informeFinalForm.totalHoras || this.informeTotalHorasDefault || 'Pendiente';
  }

  get informeTotalParticipantes(): number {
    return this.listaAlumnos.filter(a => a.asistio === true || a.asistio === 1).length;
  }

  get informeAsistentes(): any[] {
    return this.listaAlumnos.filter(a => a.asistio === true || a.asistio === 1);
  }

  get informePromedioCalificacion(): string {
    const calificaciones = this.informeAsistentes
      .map(a => this.obtenerPromedioCalificacionesAlumno(a))
      .filter((n): n is number => n !== null);

    if (calificaciones.length === 0) return 'N/A';

    const suma = calificaciones.reduce((acc, n) => acc + n, 0);
    return (suma / calificaciones.length).toFixed(2);
  }

  get informeTablaEvaluaciones(): any[] {
    return this.informeAsistentes.map((alumno) => {
      const teorica = this.parseCalificacionFinal(alumno.calificacionTeorica);
      const practica = this.parseCalificacionFinal(alumno.calificacionPractica);
      const diag = this.parseCalificacionFinal(alumno.calificacionDiag);
      const promedio = this.obtenerPromedioCalificacionesAlumno(alumno);
      return {
        nombre: alumno.nombre,
        diagnostica: diag === null ? 'N/A' : diag.toString(),
        practica: practica === null ? 'N/A' : practica.toString(),
        escrita: teorica === null ? 'N/A' : teorica.toString(),
        total: promedio === null ? 'N/A' : promedio.toString()
      };
    });
  }

  get informeSugerenciasAuto(): string {
    const preguntas = this.encuestaStats?.preguntas || [];
    const comentarios = preguntas
      .filter((p: any) => p?.type === 'text')
      .flatMap((p: any) => p?.muestras_texto || [])
      .map((txt: string) => String(txt || '').trim())
      .filter((txt: string) => !!txt);

    return comentarios.length > 0
      ? comentarios.slice(0, 5).join(' | ')
      : 'Sin comentarios registrados.';
  }

  private construirPayloadInformeFinal(): any {
    const totalHorasNormalizado = this.sanitizarEntradaNumerica(
      this.informeFinalForm.totalHoras || this.informeTotalHoras,
      true,
      2
    );

    return {
      instructor: this.informeInstructor,
      empresa: this.empresaNombre || 'Pendiente',
      curso: this.nombreCurso || 'Pendiente',
      personaSolicitante: this.informePersonaSolicitante,
      totalParticipantes: this.informeTotalParticipantes,
      lugar: this.informeLugar,
      periodo: this.informePeriodo,
      horarios: this.informeHorarios,
      totalHoras: totalHorasNormalizado,
      objetivos: this.informeFinalForm.objetivos,
      expectativasTexto: this.informeFinalForm.expectativasTexto || 'Expectativas del curso',
      expectativasPorcentaje: this.informeFinalForm.expectativasPorcentaje,
      expectativasComentarios: this.informeFinalForm.expectativasComentarios,
      recomendacionesProceso: this.informeFinalForm.recomendacionesProceso,
      recomendacionesGrupo: this.informeFinalForm.recomendacionesGrupo,
      areasOportunidad: this.informeFinalForm.areasOportunidad,
      mejoresPracticas: this.informeFinalForm.mejoresPracticas,
      contingencias: this.informeFinalForm.contingencias,
      accionCorrectiva: this.informeFinalForm.accionCorrectiva,
      ajustesPrograma: this.informeFinalForm.ajustesPrograma,
      sugerenciasParticipantes: this.informeFinalForm.sugerenciasParticipantes || this.informeSugerenciasAuto,
      evaluaciones: this.informeTablaEvaluaciones,
      // Reutilizar firma de calidad desde constancias (Sergio/usuario de calidad)
      firmaCalidadDriveId: this.firmaCalidadDriveId || null,
      firmaCalidadUrl: this.firmaCalidadUrl || null
    };
  }

  get firmaDocumento2Nombre(): string {
    return this.informeInstructor || 'Pendiente';
  }

  get participantesAsistentesPaso8(): any[] {
    return this.listaAlumnos.filter((a) => a.asistio === true || a.asistio === 1);
  }

  get participantesElegiblesDc3Paso8(): any[] {
    if (this.liberarConstanciasPaso8) {
      return this.participantesAsistentesPaso8;
    }
    return this.participantesAsistentesPaso8.filter((alumno) => {
      const promedio = this.obtenerPromedioCalificacionesAlumno(alumno);
      return promedio !== null && promedio >= 8;
    });
  }

  get totalParticipantesSinCalificacionPaso8(): number {
    return this.participantesAsistentesPaso8.filter((alumno) => {
      const teorica = this.parseCalificacionFinal(alumno?.calificacionTeorica);
      const practica = this.parseCalificacionFinal(alumno?.calificacionPractica);
      return teorica === null && practica === null;
    }).length;
  }

  get hayParticipantesSinCalificacionPaso8(): boolean {
    return this.totalParticipantesSinCalificacionPaso8 > 0;
  }

  get todasCalificacionesCargadas(): boolean {
    const asistentes = this.participantesAsistentesPaso8;
    if (asistentes.length === 0) return false;
    return asistentes.every((alumno) => {
      const teorica = this.parseCalificacionFinal(alumno?.calificacionTeorica);
      const practica = this.parseCalificacionFinal(alumno?.calificacionPractica);
      return teorica !== null || practica !== null;
    });
  }

  get puedeGenerarDocumentosPaso8(): boolean {
    return this.participantesAsistentesPaso8.length > 0;
  }

  private obtenerHorasBaseCurso(cursoCatalogoId?: number | null): string {
    const id = Number(cursoCatalogoId);
    if (Number.isFinite(id) && id > 0) {
      const enCatalogo = (this.listaCursosDisponibles || []).find((c) => Number(c.id) === id);
      const horasCat = enCatalogo?.horas;
      if (horasCat !== undefined && horasCat !== null && Number(horasCat) > 0) {
        return String(horasCat);
      }
    }
    const horas = this.curso?.curso_horas ?? this.curso?.horas ?? this.curso?.total_horas;
    return horas !== undefined && horas !== null ? String(horas) : '';
  }

  private obtenerHorasDocumentoPaso8(cursoCatalogoId?: number | null): string {
    const horasBase = this.obtenerHorasBaseCurso(cursoCatalogoId);
    const horasInforme = this.informeFinalForm.totalHoras || this.informeTotalHorasDefault || '';
    const horasSeleccionadas = this.usarHorasBasePaso8 && horasBase ? horasBase : horasInforme;
    return this.sanitizarEntradaNumerica(horasSeleccionadas, true, 2);
  }

  get totalConstanciasPaso8(): number {
    if (!this.usaEmpresasColaboradorasPaso8) {
      return this.participantesAsistentesPaso8.length;
    }
    return this.participantesAsistentesPaso8.reduce((sum, alumno) => sum + this.numeroCursosPaso8(alumno), 0);
  }

  get totalDc3Paso8(): number {
    if (!this.usaEmpresasColaboradorasPaso8) {
      return this.participantesElegiblesDc3Paso8.length;
    }
    return this.participantesElegiblesDc3Paso8.reduce((sum, alumno) => sum + this.numeroCursosPaso8(alumno), 0);
  }

  private obtenerCursosDocumentoIdsAlumno(alumno: any): number[] {
    const ids: number[] = Array.isArray(alumno?.cursos_doc_ids)
      ? alumno.cursos_doc_ids
      : (alumno?.curso_documento_id != null ? [Number(alumno.curso_documento_id)] : []);
    return [...new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  }

  private construirParticipantesGeneracionPaso8(): any[] {
    const mapParticipante = (p: any, cursoDocumentoId: number | null) => ({
      inscripcion_id: p.inscripcion_id,
      empleado_id: p.id,
      nombre_completo: p.nombre_completo_bd || p.nombre,
      nombre: p.nombre_base || '',
      apellido_paterno: p.apellido_paterno || '',
      apellido_materno: p.apellido_materno || '',
      curp: p.curp,
      puesto: p.puesto || '',
      departamento: p.departamento || '',
      empresa_documento_id: p.empresa_documento_id != null ? Number(p.empresa_documento_id) : null,
      curso_documento_id: cursoDocumentoId
    });

    if (!this.usaEmpresasColaboradorasPaso8) {
      return this.participantesAsistentesPaso8.map((p) => mapParticipante(p, p.curso_documento_id != null ? Number(p.curso_documento_id) : null));
    }

    const filas: any[] = [];
    for (const p of this.participantesAsistentesPaso8) {
      const cursoIds = this.obtenerCursosDocumentoIdsAlumno(p);
      for (const cursoId of cursoIds) {
        filas.push(mapParticipante(p, cursoId));
      }
    }
    return filas;
  }

  private construirCalificacionesGeneracionPaso8(): any[] {
    return this.participantesAsistentesPaso8
      .map((p) => ({
        inscripcion_id: Number(p.inscripcion_id),
        calificacionTeorica: this.parseCalificacionFinal(p.calificacionTeorica),
        calificacionPractica: this.parseCalificacionFinal(p.calificacionPractica),
        calificacionDiag: this.parseCalificacionFinal(p.calificacionDiag)
      }))
      .filter((c) =>
        Number.isFinite(c.inscripcion_id)
        && (c.calificacionTeorica !== null || c.calificacionPractica !== null || c.calificacionDiag !== null)
      );
  }

  /** Persiste calificaciones visibles en pantalla antes de generar DC-3 en backend. */
  private async persistirCalificacionesParaDocumentosPaso8(): Promise<boolean> {
    const asistentes = this.participantesAsistentesPaso8.filter((alumno) => {
      const teorica = this.parseCalificacionFinal(alumno?.calificacionTeorica);
      const practica = this.parseCalificacionFinal(alumno?.calificacionPractica);
      const diag = this.parseCalificacionFinal(alumno?.calificacionDiag);
      return teorica !== null || practica !== null || diag !== null;
    });

    if (asistentes.length === 0) {
      return true;
    }

    try {
      for (const alumno of asistentes) {
        await firstValueFrom(
          this.backendServices.actualizarAsistencia(
            alumno.inscripcion_id,
            alumno.asistio,
            alumno.nota || '',
            this.parseCalificacionFinal(alumno.calificacionTeorica),
            this.parseCalificacionFinal(alumno.calificacionPractica),
            this.parseCalificacionFinal(alumno.calificacionDiag)
          )
        );
      }
      this.limpiarCalificacionesBorradorLocal();
      return true;
    } catch (error) {
      console.error('Error persistiendo calificaciones antes de generar documentos:', error);
      return false;
    }
  }

  async generarDocumentosPaso8(): Promise<boolean> {
    if (!this.cursoId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo identificar el curso programado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const asistentes = this.participantesAsistentesPaso8;
    if (asistentes.length === 0) {
      await Swal.fire({
        title: 'Sin asistentes',
        text: 'No hay participantes con asistencia para generar constancias.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const errorAsignaciones = this.validarAsignacionesColaboradorasPaso8();
    if (errorAsignaciones) {
      await Swal.fire({
        title: 'Asignaciones incompletas',
        text: errorAsignaciones,
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const modoColaboradoras = this.usaEmpresasColaboradorasPaso8;
    const cursosSeleccionados = modoColaboradoras ? [] : this.obtenerCursosPaso8Seleccionados();
    if (!modoColaboradoras && cursosSeleccionados.length === 0) {
      await Swal.fire({
        title: 'Selecciona un curso',
        text: 'Debes seleccionar al menos un curso para generar documentos.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const elegiblesDc3 = this.participantesElegiblesDc3Paso8;
    const estiloCursoListado = 'margin-bottom: 0.2rem; color: #495057; font-size: 0.92rem; line-height: 1.35;';
    const estiloCursoActual = 'color: #38512F; font-size: 0.78rem; font-weight: 700;';

    let detalleModoHtml = '';
    if (modoColaboradoras) {
      const resumenEmpresas = this.empresasColaboradorasPaso8
        .filter((empresa) => asistentes.some((alumno) => Number(alumno.empresa_documento_id) === empresa.empresa_id))
        .map((empresa) => {
          const totalEmpresa = asistentes.filter((alumno) => Number(alumno.empresa_documento_id) === empresa.empresa_id).length;
          return `<li style="${estiloCursoListado}"><strong>${empresa.nombre_empresa}</strong> (RFC: ${empresa.rfc || 'N/D'}) — ${totalEmpresa} trabajador(es)</li>`;
        })
        .join('');
      detalleModoHtml = `
        <div class="text-left" style="margin-top: 0.75rem;">
          <div class="text-muted small" style="margin-bottom: 0.35rem;">Modo empresas colaboradoras activo:</div>
          <ul style="margin:0; padding-left: 1.1rem; color:#495057; font-size:0.92rem; line-height:1.35;">${resumenEmpresas}</ul>
          <p class="text-muted small mb-0" style="margin-top:0.5rem;">Cada constancia y DC-3 usará el RFC y curso asignado por participante.</p>
        </div>`;
    } else {
      const cursosListado = cursosSeleccionados
        .map((curso) => `<li style="${estiloCursoListado}">${curso.nombre}${curso.esActual ? ` <small style="${estiloCursoActual}">(actual)</small>` : ''}</li>`)
        .join('');
      detalleModoHtml = `
        <div class="text-left" style="margin-top: 0.75rem;">
          <div class="text-muted small" style="margin-bottom: 0.35rem;">Cursos seleccionados:</div>
          <ul style="margin:0; padding-left: 1.1rem; color:#495057; font-size:0.92rem; line-height:1.35;">${cursosListado}</ul>
        </div>`;
    }

    const totalAsistentes = modoColaboradoras ? this.totalConstanciasPaso8 : asistentes.length;
    const totalDc3 = modoColaboradoras ? this.totalDc3Paso8 : elegiblesDc3.length;
    const etiquetaConstancia = totalAsistentes === 1 ? 'constancia' : 'constancias';
    const totalSinCalificacion = this.totalParticipantesSinCalificacionPaso8;
    const avisoSinCalificacion = totalSinCalificacion > 0
      ? `<p class="text-muted small mb-0">Hay ${totalSinCalificacion} participante(s) sin calificación. Solo se generará la constancia.</p>`
      : '';

    const confirm = await Swal.fire({
      title: 'Generar constancias y DC-3',
      html: `
        <p>Se generarán <strong>${totalAsistentes} ${etiquetaConstancia}</strong> para los asistentes y <strong>${totalDc3} DC-3</strong> para quienes tengan promedio mayor o igual a 8.</p>
        ${avisoSinCalificacion}
        ${detalleModoHtml}
        <p class="text-muted small mb-1" style="margin-top:0.75rem;">Se guardarán en Drive en las carpetas <strong>Constancias</strong> y <strong>DC-3</strong>.</p>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Generar y subir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d'
    });

    if (!confirm.isConfirmed) {
      return false;
    }

    const calificacionesGuardadas = await this.persistirCalificacionesParaDocumentosPaso8();
    if (!calificacionesGuardadas) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudieron guardar las calificaciones antes de generar los documentos.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const guardadoColaboradoras = await this.guardarColaboradorasDocumentosPaso8();
    if (!guardadoColaboradoras && this.usaEmpresasColaboradorasPaso8) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudieron guardar las asignaciones de empresas colaboradoras.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    const participantesPayload = this.construirParticipantesGeneracionPaso8();
    const cursoActualId = this.obtenerCursoCatalogoIdActual();
    const cursosAGenerar = modoColaboradoras
      ? [{ id: cursoActualId || 0, nombre: this.nombreCurso || 'Curso', esActual: true }]
      : cursosSeleccionados;

    this.generandoDocumentosPaso8 = true;
    this.documentosGeneradosPaso8 = false;
    let alMenosUnoOk = false;
    const resultados: { nombre: string; constancias: number; dc3: number; fallidos: number; duracion: number; error?: boolean; dc3Error?: string }[] = [];

    try {
      for (let idx = 0; idx < cursosAGenerar.length; idx++) {
        const curso = cursosAGenerar[idx];
        const esCursoActual = cursoActualId !== null && curso.id === cursoActualId;
        this.cursoGenerandoPaso8Nombre = modoColaboradoras
          ? 'Empresas colaboradoras'
          : curso.nombre;

        const payload: any = {
          firmas: {
            firma1: {
              nombre: (this.firmaDocumento1Nombre || '').trim(),
              cargo: (this.firmaDocumento1Cargo || '').trim(),
              drive_id: this.firmaCalidadDriveId || null
            },
            firma2: {
              nombre: this.firmaDocumento2Nombre,
              cargo: this.firmaDocumento2Cargo
            }
          },
          horas: this.obtenerHorasDocumentoPaso8(curso.id),
          usarHorasBase: this.usarHorasBasePaso8,
          tipoDocumento: 'ambos',
          aplicarFiltroDC3Promedio8: !this.liberarConstanciasPaso8,
          usarFirmaDigital: this.usarFirmaDigital,
          mostrarPuestosDc3: this.mostrarPuestosDc3,
          participantes: participantesPayload,
          calificaciones: this.construirCalificacionesGeneracionPaso8(),
          usaEmpresasColaboradoras: modoColaboradoras
        };

        if (!modoColaboradoras && !esCursoActual) {
          payload.cursoDestinoId = curso.id;
          payload.actualizarInscripciones = false;
          payload.usarSubcarpetaCurso = true;
        }

        const res = await this.ejecutarGeneracionPaso8(
          payload,
          modoColaboradoras ? 'Empresas colaboradoras' : curso.nombre,
          idx + 1,
          cursosAGenerar.length,
          cursosAGenerar.length > 1
        );
        if (res.ok) {
          alMenosUnoOk = true;
          this.documentosGeneradosPaso8 = true;
          resultados.push({ nombre: curso.nombre, constancias: res.constancias, dc3: res.dc3, fallidos: res.fallidos, duracion: res.duracion, dc3Error: res.dc3Error });
        } else {
          resultados.push({ nombre: curso.nombre, constancias: 0, dc3: 0, fallidos: 1, duracion: 0, error: true });
          break;
        }
      }

      // Modal de resumen unificado (siempre al final)
      if (resultados.length > 0) {
        const totalC = resultados.reduce((s, r) => s + r.constancias, 0);
        const totalD = resultados.reduce((s, r) => s + r.dc3, 0);
        const totalF = resultados.reduce((s, r) => s + r.fallidos, 0);
        const totalT = resultados.reduce((s, r) => s + r.duracion, 0);
        const hayError = resultados.some((r) => r.error);
        const icon = hayError ? 'warning' : (totalF > 0 ? 'warning' : 'success');

        const filasTabla = resultados.map((r) => `
          <tr>
            <td style="text-align:left; padding:5px 10px; font-size:0.82rem; color:#374151; max-width:240px; word-break:break-word;">${r.nombre}</td>
            <td style="text-align:center; padding:5px 8px; font-size:0.82rem;">${r.error ? '<span style="color:#b42318">Error</span>' : r.constancias}</td>
            <td style="text-align:center; padding:5px 8px; font-size:0.82rem;">${r.error ? '—' : r.dc3}</td>
            <td style="text-align:center; padding:5px 8px; font-size:0.82rem; color:#6b7280;">${r.error ? '—' : r.duracion.toFixed(1) + 's'}</td>
          </tr>`).join('');

        const resumenHtml = cursosAGenerar.length === 1
          ? `<p style="font-size:1rem; font-weight:600; color:#38512F; margin:0 0 4px;">${resultados[0].constancias} constancias · ${resultados[0].dc3} DC-3</p>
             <p style="font-size:0.88rem; color:#6b7280; margin:0;">Tiempo total: ${resultados[0].duracion.toFixed(1)}s</p>
             ${resultados[0].dc3Error ? `<p style="color:#b42318; font-size:0.82rem; margin-top:8px;">DC-3: ${resultados[0].dc3Error}</p>` : ''}
             ${totalF > 0 ? `<p style="color:#b42318; font-size:0.82rem; margin-top:8px;">Incidencias: ${totalF}</p>` : ''}`
          : `<p style="font-size:0.9rem; color:#374151; margin:0 0 10px;">
               <strong>${totalC}</strong> constancias · <strong>${totalD}</strong> DC-3 generados en <strong>${totalT.toFixed(1)}s</strong>
             </p>
             <div style="overflow-x:auto;">
               <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
                 <thead>
                   <tr style="background:#f3f7f0;">
                     <th style="text-align:left; padding:5px 10px; color:#38512F; font-size:0.75rem;">Curso</th>
                     <th style="text-align:center; padding:5px 8px; color:#38512F; font-size:0.75rem;">Const.</th>
                     <th style="text-align:center; padding:5px 8px; color:#38512F; font-size:0.75rem;">DC-3</th>
                     <th style="text-align:center; padding:5px 8px; color:#38512F; font-size:0.75rem;">Tiempo</th>
                   </tr>
                 </thead>
                 <tbody>${filasTabla}</tbody>
               </table>
             </div>
             ${totalF > 0 ? `<p style="color:#b42318; font-size:0.82rem; margin-top:8px;">Incidencias totales: ${totalF}</p>` : ''}`;

        await Swal.fire({
          title: cursosSeleccionados.length === 1
            ? (totalF > 0 ? 'Generación con incidencias' : 'Documentos generados')
            : (hayError ? 'Generación con errores' : 'Generación completada'),
          html: `<div style="text-align:center; max-width:480px; margin:0 auto;">${resumenHtml}</div>`,
          icon,
          width: cursosSeleccionados.length > 1 ? 560 : 460,
          confirmButtonColor: '#38512F'
        });
      }

      return alMenosUnoOk;
    } finally {
      this.generandoDocumentosPaso8 = false;
      this.progresoDocumentosPaso8 = '';
      this.cursoGenerandoPaso8Nombre = '';
    }
  }

  private async ejecutarGeneracionPaso8(
    payload: any,
    cursoLabel: string,
    indice: number,
    total: number,
    suprimirModal = false
  ): Promise<{ ok: boolean; constancias: number; dc3: number; fallidos: number; duracion: number; dc3Error?: string }> {
    const vacio = { ok: false, constancias: 0, dc3: 0, fallidos: 0, duracion: 0 };
    if (!this.cursoId) {
      return vacio;
    }

    const token = localStorage.getItem('auth_token');
    const url = `${environment.apiUrl}/cursos-programados/${this.cursoId}/generar-constancias-v2`;
    const cursoPrefix = total > 1 ? `[${indice}/${total}] ${cursoLabel}` : cursoLabel;

    this.progresoDocumentosPaso8 = `${cursoPrefix}: Preparando...`;

    const swalProgressHtml = (mensaje: string, pct: number) => `
      <div style="text-align:left; padding: 0 4px;">
        <p style="margin:0 0 10px; font-size:0.88rem; color:#555;">${mensaje}</p>
        <div style="background:#e9ecef; border-radius:999px; height:6px; overflow:hidden;">
          <div id="swal-prog-bar" style="
            height:100%; width:${pct}%;
            background: linear-gradient(90deg,#38512F,#6a9a5b);
            border-radius:999px;
            transition: width 0.4s ease;
          "></div>
        </div>
        <p style="margin:6px 0 0; font-size:0.75rem; color:#aaa; text-align:right;">${pct}%</p>
      </div>`;

    Swal.fire({
      title: total > 1 ? `Generando documentos (${indice}/${total})` : 'Generando documentos...',
      html: swalProgressHtml(this.progresoDocumentosPaso8, 0),
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      width: 360,
      customClass: { popup: 'swal-prog-popup' }
    });

    return await new Promise<{ ok: boolean; constancias: number; dc3: number; fallidos: number; duracion: number; dc3Error?: string }>((resolve) => {
      let finalizado = false;

      const finalizar = (resultado: { ok: boolean; constancias: number; dc3: number; fallidos: number; duracion: number; dc3Error?: string }) => {
        if (finalizado) return;
        finalizado = true;
        resolve(resultado);
      };

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      }).then(async (response) => {
        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => '');
          Swal.close();
          if (!suprimirModal) {
            await Swal.fire({
              title: 'Error',
              text: errText || 'No se pudo iniciar la generación de documentos.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
          return finalizar(vacio);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        const processStream = (): void => {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              if (!finalizado) {
                Swal.close();
                if (!suprimirModal) {
                  await Swal.fire({
                    title: 'Proceso incompleto',
                    text: 'La conexión terminó antes de recibir el resultado final.',
                    icon: 'warning',
                    confirmButtonColor: '#38512F'
                  });
                }
                finalizar(vacio);
              }
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.substring(7).trim();
              } else if (line.startsWith('data: ') && currentEvent) {
                try {
                  const data = JSON.parse(line.substring(6));

                  if (currentEvent === 'progress') {
                    const mensajeBase = data?.mensaje || 'Procesando...';
                    this.progresoDocumentosPaso8 = cursoPrefix ? `${cursoPrefix}: ${mensajeBase}` : mensajeBase;
                    const pct = Math.min(100, Math.max(0, Number(data?.pct || 0)));
                    const bar = document.getElementById('swal-prog-bar');
                    if (bar) {
                      bar.style.width = `${pct}%`;
                      const container = bar.closest('.swal2-html-container');
                      if (container) {
                        const texts = container.querySelectorAll('p');
                        if (texts[0]) texts[0].textContent = this.progresoDocumentosPaso8;
                        if (texts[1]) texts[1].textContent = `${pct}%`;
                      }
                    } else {
                      Swal.update({ html: swalProgressHtml(this.progresoDocumentosPaso8, pct) });
                    }
                  }

                  if (currentEvent === 'done') {
                    Swal.close();
                    const constanciasOk = Number(data?.constancias?.exitosos || 0);
                    const dc3Ok = Number(data?.dc3?.exitosos || 0);
                    const fallidos = Number(data?.fallidos || 0);
                    const duracion = Number(data?.duracion || 0);
                    const dc3Error = data?.dc3?.error ? String(data.dc3.error) : undefined;

                    if (data?.success) {
                      this.documentosGeneradosPaso8 = true;
                    }

                    finalizar({ ok: !!data?.success, constancias: constanciasOk, dc3: dc3Ok, fallidos, duracion, dc3Error });
                    return;
                  }

                  if (currentEvent === 'error') {
                    Swal.close();
                    if (!suprimirModal) {
                      await Swal.fire({
                        title: cursoLabel ? `Error · ${cursoLabel}` : 'Error',
                        text: data?.message || 'Error al generar documentos',
                        icon: 'error',
                        confirmButtonColor: '#38512F'
                      });
                    }
                    finalizar(vacio);
                    return;
                  }
                } catch (e) { }

                currentEvent = '';
              }
            }

            processStream();
          }).catch(async () => {
            Swal.close();
            if (!suprimirModal) {
              await Swal.fire({
                title: 'Error',
                text: 'No se pudo leer el progreso de generación.',
                icon: 'error',
                confirmButtonColor: '#38512F'
              });
            }
            finalizar(vacio);
          });
        };

        processStream();
      }).catch(async () => {
        Swal.close();
        if (!suprimirModal) {
          await Swal.fire({
            title: 'Error de conexión',
            text: 'No se pudo conectar con el servidor para generar documentos.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
        finalizar(vacio);
      });
    });
  }

  async descargarZipDocumentosPaso8(): Promise<void> {
    if (!this.cursoId || this.descargandoZipPaso8) {
      return;
    }

    const modoColaboradoras = this.usaEmpresasColaboradorasPaso8;
    const cursosSeleccionados = modoColaboradoras
      ? [{
        id: this.obtenerCursoCatalogoIdActual() || 0,
        nombre: this.nombreCurso || 'Empresas colaboradoras',
        esActual: true
      }]
      : this.obtenerCursosPaso8Seleccionados();

    if (cursosSeleccionados.length === 0) {
      await Swal.fire({
        title: modoColaboradoras ? 'Sin curso base' : 'Selecciona un curso',
        text: modoColaboradoras
          ? 'No se pudo identificar el curso programado para descargar los PDFs.'
          : 'Debes seleccionar al menos un curso para descargar los PDFs.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const descargarDc3 = this.totalDc3Paso8 > 0;
    const totalArchivos = cursosSeleccionados.length * (descargarDc3 ? 2 : 1);

    this.descargandoZipPaso8 = true;
    Swal.fire({
      title: 'Preparando ZIP...',
      html: `<div style="text-align:left; padding:0 4px;">
               <p style="margin:0 0 10px; font-size:0.88rem; color:#555;">Descargando PDFs...</p>
               <div style="background:#e9ecef; border-radius:999px; height:6px; overflow:hidden;">
                 <div id="swal-zip-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#38512F,#6a9a5b); border-radius:999px; transition:width 0.3s;"></div>
               </div>
               <p style="margin:6px 0 0; font-size:0.75rem; color:#aaa; text-align:right;">0/${totalArchivos}</p>
             </div>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      width: 360
    });

    const actualizarProgreso = (completados: number, detalle: string) => {
      const bar = document.getElementById('swal-zip-bar');
      const container = bar?.closest('.swal2-html-container');
      if (bar) bar.style.width = `${Math.round((completados / totalArchivos) * 100)}%`;
      if (container) {
        const texts = container.querySelectorAll('p');
        if (texts[0]) texts[0].textContent = detalle;
        if (texts[1]) texts[1].textContent = `${completados}/${totalArchivos}`;
      }
    };

    const zip = new JSZip();
    let completados = 0;
    const errores: string[] = [];
    const fecha = new Date().toISOString().split('T')[0];

    try {
      for (const curso of cursosSeleccionados) {
        const carpetaNombre = String(curso.nombre)
          .replace(/[<>:"/\\|?*]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 80);
        const folder = zip.folder(carpetaNombre)!;

        // Constancias PDF
        try {
          const blob = await firstValueFrom(
            this.backendServices.descargarConstanciasCombinadasPdf(this.cursoId, curso.esActual ? undefined : curso.id)
          );
          folder.file(`Constancias_${fecha}.pdf`, blob);
        } catch {
          errores.push(`Constancias — ${curso.nombre}`);
        }
        completados++;
        actualizarProgreso(completados, `Constancias: ${curso.nombre}`);

        // DC-3 PDF
        if (descargarDc3) {
          try {
            const blob = await firstValueFrom(
              this.backendServices.descargarDc3CombinadosPdf(this.cursoId, curso.esActual ? undefined : curso.id)
            );
            folder.file(`DC3_${fecha}.pdf`, blob);
          } catch {
            errores.push(`DC-3 — ${curso.nombre}`);
          }
          completados++;
          actualizarProgreso(completados, `DC-3: ${curso.nombre}`);
        }
      }

      // Generar ZIP y descargar
      actualizarProgreso(totalArchivos, 'Empaquetando ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      Swal.close();

      const nombreZip = `Documentos_${fecha}.zip`;
      this.descargarBlobPaso8(zipBlob, nombreZip);

      try {
        await firstValueFrom(this.backendServices.registrarDescargaConstanciasDc3(this.cursoId, {
          origen: 'timeline_curso_zip',
          detalle: `cursos:${cursosSeleccionados.length}`
        }));
      } catch {
        // No bloquear la descarga del usuario si falla el registro.
      }

      if (errores.length > 0) {
        await Swal.fire({
          title: 'ZIP con incidencias',
          html: `<p>Algunos archivos no se pudieron obtener:</p>
                 <ul style="text-align:left; padding-left:1.1rem;">${errores.map((e) => `<li style="font-size:0.88rem;">${e}</li>`).join('')}</ul>`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
      } else {
        await Swal.fire({
          title: 'ZIP descargado',
          html: `<p style="font-size:0.95rem; color:#374151; margin:0 0 4px;">
                   <strong>${cursosSeleccionados.length}</strong> ${cursosSeleccionados.length === 1 ? 'carpeta' : 'carpetas'} dentro del ZIP
                 </p>
                 <p style="font-size:0.82rem; color:#6b7280; margin:0;">${nombreZip}</p>`,
          icon: 'success',
          confirmButtonColor: '#38512F'
        });
      }
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo generar el ZIP.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoZipPaso8 = false;
    }
  }

  private construirNombreArchivoPaso8(tipo: 'constancias' | 'dc3', curso: CursoSeleccionadoPaso8): string {
    const fecha = new Date().toISOString().split('T')[0];
    const cursoSeguro = String(curso?.nombre || `curso_${curso.id}`)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const prefijo = tipo === 'constancias' ? 'Constancias' : 'DC3';
    return `${prefijo}_${cursoSeguro || 'curso'}_${fecha}.pdf`;
  }

  private descargarBlobPaso8(blob: Blob, nombreArchivo: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  async descargarConstanciasCombinadasPaso8(curso?: CursoSeleccionadoPaso8): Promise<void> {
    if (!this.cursoId || this.descargandoConstanciasCombinadasPaso8) {
      return;
    }

    const cursoInfo: CursoSeleccionadoPaso8 = curso || {
      id: this.obtenerCursoCatalogoIdActual() || 0,
      nombre: this.nombreCurso || `Curso ${this.cursoId}`,
      esActual: true
    };

    this.descargandoConstanciasCombinadasPaso8 = true;
    Swal.fire({
      title: 'Preparando PDF...',
      text: 'Descargando constancias consolidadas',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const blob = await firstValueFrom(
        this.backendServices.descargarConstanciasCombinadasPdf(this.cursoId, cursoInfo.esActual ? undefined : cursoInfo.id)
      );
      Swal.close();

      this.descargarBlobPaso8(blob, this.construirNombreArchivoPaso8('constancias', cursoInfo));

      await Swal.fire({
        title: 'PDF descargado',
        text: 'Se descargó un solo archivo con todas las constancias.',
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el PDF consolidado de constancias.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoConstanciasCombinadasPaso8 = false;
    }
  }

  async descargarDc3CombinadosPaso8(curso?: CursoSeleccionadoPaso8): Promise<void> {
    if (!this.cursoId || this.descargandoDc3CombinadosPaso8) {
      return;
    }

    const cursoInfo: CursoSeleccionadoPaso8 = curso || {
      id: this.obtenerCursoCatalogoIdActual() || 0,
      nombre: this.nombreCurso || `Curso ${this.cursoId}`,
      esActual: true
    };

    this.descargandoDc3CombinadosPaso8 = true;
    Swal.fire({
      title: 'Preparando PDF...',
      text: 'Descargando DC-3 consolidados',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const blob = await firstValueFrom(
        this.backendServices.descargarDc3CombinadosPdf(this.cursoId, cursoInfo.esActual ? undefined : cursoInfo.id)
      );
      Swal.close();

      this.descargarBlobPaso8(blob, this.construirNombreArchivoPaso8('dc3', cursoInfo));

      await Swal.fire({
        title: 'PDF descargado',
        text: 'Se descargó un solo archivo con todos los DC-3.',
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el PDF consolidado de DC-3.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoDc3CombinadosPaso8 = false;
    }
  }

  private getInformeFinalFileName(): string {
    const fecha = new Date().toISOString().split('T')[0];
    return `Informe_Final_${(this.nombreCurso || 'Curso').replace(/[^a-zA-Z0-9]+/g, '_')}_${fecha}.xlsx`;
  }

  private descargarBlobInformeFinal(blob: Blob): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.getInformeFinalFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private async generarYDescargarInformeFinal(): Promise<boolean> {
    if (!this.cursoId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo identificar el curso programado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    this.guardarInformeFinalBorradorLocal(true);
    const payload = this.construirPayloadInformeFinal();

    Swal.fire({
      title: 'Generando informe final...',
      text: 'Aplicando datos al formato SP-F-11',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const blob = await firstValueFrom(this.backendServices.generarInformeFinalExcel(this.cursoId, payload));
      Swal.close();
      this.descargarBlobInformeFinal(blob);
      return true;
    } catch (err: any) {
      Swal.close();
      let errorMsg = 'No se pudo generar el informe final.';
      if (err?.error instanceof Blob) {
        try {
          const text = await err.error.text();
          const json = JSON.parse(text);
          if (json.message) errorMsg = json.message;
        } catch (e) { }
      } else if (err?.error?.message) {
        errorMsg = err.error.message;
      }

      await Swal.fire({
        title: 'Error',
        text: errorMsg,
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
  }

  private async generarYSubirInformeFinalADrive(): Promise<boolean> {
    if (!this.cursoId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo identificar el curso programado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    this.guardarInformeFinalBorradorLocal(true);
    const payload = this.construirPayloadInformeFinal();

    Swal.fire({
      title: 'Generando informes...',
      text: 'Guardando Informe Final e Informe Fotográfico en Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      // Generar Informe Final e Informe Fotográfico en paralelo
      const informeFinalPromise = firstValueFrom(this.backendServices.generarInformeFinalEnDrive(this.cursoId, payload));
      const informeFotoPromise = this.fotosEvidenciaSubidas.length > 0
        ? firstValueFrom(this.backendServices.generarInformeFotografico(this.cursoId)).catch(err => {
            console.warn('Informe fotográfico falló (no bloquea):', err?.error?.message || err);
            return null;
          })
        : Promise.resolve(null);

      const [response, responseFoto] = await Promise.all([informeFinalPromise, informeFotoPromise]);
      Swal.close();

      if (!response?.success) {
        await Swal.fire({
          title: 'Error',
          text: response?.message || 'No se pudo subir el informe final a Drive.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return false;
      }

      const archivo = response?.archivo || {};
      this.informeFinalArchivoDrive = {
        id: this.informeFinalArchivoDrive?.id || null,
        nombre: archivo?.nombre || this.getInformeFinalFileName(),
        url: archivo?.url || '',
        drive_file_id: archivo?.drive_file_id || null,
        fecha: new Date().toISOString()
      };

      const archivoPdf = response?.archivo_pdf || {};
      if (archivoPdf?.drive_file_id || archivoPdf?.url) {
        this.informeFinalPdfArchivoDrive = {
          id: this.informeFinalPdfArchivoDrive?.id || null,
          nombre: archivoPdf?.nombre || 'Informe_Final.pdf',
          url: archivoPdf?.url || '',
          drive_file_id: archivoPdf?.drive_file_id || null,
          fecha: new Date().toISOString()
        };
      }

      if (responseFoto?.success && responseFoto?.archivo) {
        this.informeFotograficoArchivo = responseFoto.archivo;
        const editorFotoUrl = this.resolverUrlEdicionInformeFotografico(
          responseFoto.archivo?.drive_file_id,
          responseFoto.archivo?.url || ''
        );
        if (editorFotoUrl) {
          this.informeFotograficoEditorRawUrl = editorFotoUrl;
          this.informeFotograficoEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorFotoUrl);
        }
      }

      const archivoPdfFoto = responseFoto?.archivo_pdf || {};
      if (archivoPdfFoto?.drive_file_id || archivoPdfFoto?.url) {
        this.informeFotograficoPdfArchivoDrive = {
          id: this.informeFotograficoPdfArchivoDrive?.id || null,
          nombre: archivoPdfFoto?.nombre || 'Informe_Fotografico.pdf',
          url: archivoPdfFoto?.url || '',
          drive_file_id: archivoPdfFoto?.drive_file_id || null,
          fecha: new Date().toISOString()
        };
      }

      const editorUrl = this.resolverUrlEdicionInforme(
        archivo?.drive_file_id,
        archivo?.editor_url || archivo?.url || ''
      );
      if (editorUrl) {
        this.informeFinalEditorRawUrl = editorUrl;
        this.informeFinalEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
      }

      this.cargarDocumentosProgramado();

      return true;
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo subir el informe final a Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
  }

  private async confirmarCompletarPaso7ConAccion(): Promise<boolean> {
    const result = await Swal.fire({
      title: '¿Completar este paso?',
      html: `<p>Se marcará <strong>"Informe final"</strong> como completado y continuarás al siguiente paso.</p>
             <p class="text-muted small mb-0">Se generará el informe final y el informe fotográfico en Drive. ¿También deseas descargar el Excel?</p>`,
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Subir y descargar',
      denyButtonText: 'Solo subir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      denyButtonColor: '#768D6B',
      cancelButtonColor: '#6c757d'
    });

    if (result.isConfirmed || result.isDenied) {
      const subido = await this.generarYSubirInformeFinalADrive();
      if (!subido) return false;

      if (result.isConfirmed) {
        const descargado = await this.generarYDescargarInformeFinal();
        if (!descargado) return false;
        const fotoMsg = this.informeFotograficoArchivo ? '<br><small class="text-muted">El informe fotográfico también se generó correctamente.</small>' : '';
        await Swal.fire({
          title: 'Informes generados',
          html: `<p class="mb-0">El informe final se subió a Drive y se descargó en tu equipo.${fotoMsg}</p>`,
          icon: 'success',
          confirmButtonColor: '#38512F'
        });
      } else {
        const fotoMsg = this.informeFotograficoArchivo ? '<br><small class="text-muted">El informe fotográfico también se generó correctamente.</small>' : '';
        await Swal.fire({
          title: 'Informes guardados',
          html: `<p class="mb-0">El informe final se subió correctamente a Drive.${fotoMsg}</p>`,
          icon: 'success',
          confirmButtonColor: '#38512F'
        });
      }
      return true;
    }

    return false;
  }

  generarFormatoInformeFinal(): void {
    this.generarYDescargarInformeFinal();
  }

  async renovarInformeFinal(): Promise<void> {
    this.guardarInformeFinalBorradorLocal(true);
    await this.guardarInformeFinalYHabilitarEdicion();
  }

  async guardarInformeFinalYHabilitarEdicion(): Promise<void> {
    const ok = await this.generarYSubirInformeFinalADrive();
    if (!ok) return;

    this.informeFinalEditorVisible = true;
    this.informeFotograficoEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.verificarCuentaGoogleDrive();

    await Swal.fire({
      title: 'Informe renovado',
      html: '<p class="mb-0">El informe se actualizó en Google Sheets. Ya puedes ajustarlo en el editor integrado.</p>',
      icon: 'success',
      confirmButtonColor: '#38512F'
    });
  }

  async actualizarInformeFinalSoloSubir(): Promise<void> {
    const subido = await this.generarYSubirInformeFinalADrive();
    if (!subido) return;

    const fotoMsg = this.informeFotograficoArchivo
      ? '<br><small class="text-muted">El informe fotográfico también se generó correctamente.</small>'
      : '';

    await Swal.fire({
      title: 'Informes guardados',
      html: `<p class="mb-0">El informe final se actualizó correctamente en Drive.${fotoMsg}</p>`,
      icon: 'success',
      confirmButtonColor: '#38512F'
    });
  }

  async abrirMenuDescargaInforme(): Promise<void> {
    if (this.descargandoInformeDesdeMenu) {
      return;
    }
    await this.mostrarSelectorTipoInforme();
  }

  private async mostrarSelectorTipoInforme(): Promise<void> {
    await Swal.fire({
      title: 'Descargar informe',
      html: `
        <div class="download-options">
          <button type="button" class="download-card" data-value="informe_final" aria-pressed="false">
            <div class="download-card__icon"><i class="fas fa-file-alt"></i></div>
            <div class="download-card__title">Informe Final</div>
            <div class="download-card__desc">Documento unificado con calificaciones y evidencias.</div>
          </button>
          <button type="button" class="download-card" data-value="informe_fotografico" aria-pressed="false">
            <div class="download-card__icon"><i class="fas fa-camera-retro"></i></div>
            <div class="download-card__title">Informe Fotográfico</div>
            <div class="download-card__desc">Presentación con las imágenes del curso.</div>
          </button>
        </div>
        <div class="download-modal-actions">
          <button type="button" class="download-action-btn download-action-btn--cancel" data-action="cancelar">
            Cancelar
          </button>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: false,
      showCloseButton: false,
      width: '720px',
      customClass: { popup: 'swal2-custom-download' },
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        const popup = Swal.getPopup();
        if (!popup) return;
        const cancelButton = popup.querySelector('[data-action="cancelar"]');
        const cards = Array.from(popup.querySelectorAll('.download-card')) as HTMLElement[];
        let navegando = false;

        cancelButton?.addEventListener('click', () => {
          if (navegando) {
            return;
          }
          navegando = true;
          Swal.close();
        });

        cards.forEach((c: any) => {
          c.addEventListener('click', () => {
            if (navegando) {
              return;
            }
            navegando = true;
            cards.forEach((x: any) => x.classList.remove('selected'));
            c.classList.add('selected');
            const valor = c.dataset.value;
            if (!valor) {
              return;
            }
            Swal.close();
            setTimeout(() => {
              void this.mostrarSelectorFormatoInforme(valor === 'informe_final');
            }, 120);
          });
        });
      },
    });
  }

  private async mostrarSelectorFormatoInforme(esInformeFinal: boolean): Promise<void> {
    const titulo = esInformeFinal ? 'Formato del Informe Final' : 'Formato del Informe Fotográfico';

    const formatos = esInformeFinal
      ? `
        <button type="button" class="download-card" data-value="pdf">
          <div class="download-card__icon"><i class="fas fa-file-pdf"></i></div>
          <div class="download-card__title">PDF</div>
          <div class="download-card__desc">Formato listo para imprimir y archivar.</div>
        </button>
        <button type="button" class="download-card" data-value="excel">
          <div class="download-card__icon"><i class="fas fa-file-excel"></i></div>
          <div class="download-card__title">Excel</div>
          <div class="download-card__desc">Hoja de cálculo editable.</div>
        </button>
      `
      : `
        <button type="button" class="download-card" data-value="pdf">
          <div class="download-card__icon"><i class="fas fa-file-pdf"></i></div>
          <div class="download-card__title">PDF</div>
          <div class="download-card__desc">Versión para impresión.</div>
        </button>
        <button type="button" class="download-card" data-value="powerpoint">
          <div class="download-card__icon"><i class="fas fa-file-powerpoint"></i></div>
          <div class="download-card__title">PowerPoint</div>
          <div class="download-card__desc">Presentación descargable.</div>
        </button>
      `;

    const formatoHtml = `
      <div class="download-options download-options--formats">
        ${formatos}
      </div>
      <div class="download-modal-actions">
        <button type="button" class="download-action-btn download-action-btn--back" data-action="regresar">
          <i class="fas fa-arrow-left mr-1"></i>Regresar
        </button>
      </div>
    `;

    await Swal.fire({
      title: titulo,
      html: formatoHtml,
      showConfirmButton: false,
      showCancelButton: false,
      showCloseButton: false,
      width: '640px',
      customClass: { popup: 'swal2-custom-format' },
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        const popup = Swal.getPopup();
        if (!popup) return;
        const backButton = popup.querySelector('[data-action="regresar"]');
        const cards = Array.from(popup.querySelectorAll('.download-card')) as HTMLElement[];
        let navegando = false;
        backButton?.addEventListener('click', () => {
          if (navegando) {
            return;
          }
          navegando = true;
          Swal.close();
          setTimeout(() => {
            void this.mostrarSelectorTipoInforme();
          }, 120);
        });
        cards.forEach((c: any) => {
          c.addEventListener('click', () => {
            if (navegando) {
              return;
            }
            navegando = true;
            cards.forEach((x: any) => x.classList.remove('selected'));
            c.classList.add('selected');
            const formato = c.dataset.value;
            if (!formato) {
              return;
            }
            Swal.close();
            setTimeout(() => {
              void this.ejecutarDescargaInforme(esInformeFinal, formato);
            }, 120);
          });
        });
      },
    });
  }

  private async ejecutarDescargaInforme(esInformeFinal: boolean, formato: string): Promise<void> {
    this.descargandoInformeDesdeMenu = true;

    try {
      if (esInformeFinal) {
        if (formato === 'excel') {
          await this.descargarInformeFinalExcelDesdeMenu();
        } else {
          await this.descargarInformeFinalPdfDesdeMenu();
        }
      } else {
        if (formato === 'powerpoint') {
          await this.descargarInformeFotograficoPowerPointDesdeMenu();
        } else {
          await this.descargarInformeFotograficoPdfDesdeMenu();
        }
      }
    } finally {
      this.descargandoInformeDesdeMenu = false;
    }
  }

  private async descargarInformeFinalExcelDesdeMenu(): Promise<void> {
    const preparado = await this.asegurarInformeFinalEnDrive();
    if (!preparado) {
      return;
    }

    const driveFileId = this.obtenerDriveFileId(this.informeFinalArchivoDrive);
    if (!driveFileId) {
      await this.generarYDescargarInformeFinal();
      return;
    }

    const params = new URLSearchParams({ format: 'xlsx' });
    if (this.googleDriveEmail) {
      params.set('authuser', this.googleDriveEmail);
    }
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(driveFileId)}/export?${params.toString()}`;
    this.descargarDesdeUrl(exportUrl);
  }

  private async refrescarPdfOficialInformeFinalEnDrive(): Promise<boolean> {
    if (!this.cursoId) {
      return false;
    }

    const driveFileIdInforme = this.obtenerDriveFileId(this.informeFinalArchivoDrive);
    if (!driveFileIdInforme) {
      return false;
    }

    Swal.fire({
      title: 'Actualizando PDF... ',
      text: 'Generando versión oficial con los últimos cambios del Excel',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const response: any = await firstValueFrom(this.backendServices.refrescarInformeFinalPdfOficial(this.cursoId));
      if (!response?.success) {
        throw new Error(response?.message || 'No se pudo actualizar el PDF oficial del Informe Final.');
      }

      const archivoPdf = response?.archivo_pdf || {};
      if (!archivoPdf?.drive_file_id && !archivoPdf?.url) {
        throw new Error('No se recibió archivo PDF oficial actualizado.');
      }

      this.informeFinalPdfArchivoDrive = {
        id: this.informeFinalPdfArchivoDrive?.id || null,
        nombre: archivoPdf?.nombre || 'Informe_Final.pdf',
        url: archivoPdf?.url || '',
        drive_file_id: archivoPdf?.drive_file_id || null,
        fecha: new Date().toISOString()
      };

      Swal.close();
      return true;
    } catch (err: any) {
      Swal.close();
      console.warn('No se pudo refrescar el PDF oficial del informe final:', err?.error?.message || err?.message || err);
      return false;
    }
  }

  private async descargarInformeFinalPdfDesdeMenu(): Promise<void> {
    const preparado = await this.asegurarInformeFinalEnDrive();
    if (!preparado) {
      return;
    }

    const driveFileId = this.obtenerDriveFileId(this.informeFinalArchivoDrive);
    if (!driveFileId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se encontró el archivo de Informe Final en Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const pdfRefrescado = await this.refrescarPdfOficialInformeFinalEnDrive();

    const drivePdfFileId = this.obtenerDriveFileId(this.informeFinalPdfArchivoDrive);
    if (drivePdfFileId) {
      Swal.fire({
        title: 'Preparando PDF... ',
        text: 'Descargando informe final actualizado guardado en el sistema',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      try {
        const blob = await firstValueFrom(
          this.backendServices.descargarArchivoDrive(
            drivePdfFileId,
            this.informeFinalPdfArchivoDrive?.nombre || 'Informe_Final.pdf'
          )
        );
        Swal.close();
        this.descargarBlobPdf(blob, this.informeFinalPdfArchivoDrive?.nombre || 'Informe_Final');
        return;
      } catch (err: any) {
        Swal.close();
        console.warn('No se pudo descargar el PDF oficial guardado; se usará conversión en línea:', err?.error?.message || err);
      }
    }

    if (!pdfRefrescado) {
      console.warn('Se usará conversión en línea porque no fue posible refrescar el PDF oficial.');
    }

    Swal.fire({
      title: 'Preparando PDF...',
      text: 'Convirtiendo Informe Final a PDF',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const blob = await firstValueFrom(
        this.backendServices.imprimirArchivoDriveComoPDF(
          driveFileId,
          this.informeFinalArchivoDrive?.nombre || 'Informe_Final'
        )
      );
      Swal.close();
      this.descargarBlobPdf(blob, this.informeFinalArchivoDrive?.nombre || 'Informe_Final');
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el Informe Final en PDF.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  private async asegurarInformeFotograficoPdfEnDrive(force = false): Promise<boolean> {
    if (!this.cursoId) {
      return false;
    }

    const driveFileIdInforme = this.obtenerDriveFileId(this.informeFotograficoArchivo);
    if (!driveFileIdInforme) {
      return false;
    }

    if (!force && this.obtenerDriveFileId(this.informeFotograficoPdfArchivoDrive)) {
      return true;
    }

    Swal.fire({
      title: force ? 'Actualizando PDF...' : 'Preparando PDF...',
      text: force
        ? 'Regenerando PDF oficial del Informe Fotográfico'
        : 'Generando PDF oficial del Informe Fotográfico en Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const response: any = await firstValueFrom(
        this.backendServices.asegurarInformeFotograficoPdfOficial(
          this.cursoId,
          force,
          driveFileIdInforme
        )
      );
      if (!response?.success) {
        throw new Error(response?.message || 'No se pudo asegurar el PDF del Informe Fotográfico.');
      }

      const archivoPdf = response?.archivo_pdf || {};
      if (!archivoPdf?.drive_file_id && !archivoPdf?.url) {
        throw new Error('No se recibió archivo PDF del Informe Fotográfico.');
      }

      this.informeFotograficoPdfArchivoDrive = {
        id: this.informeFotograficoPdfArchivoDrive?.id || null,
        nombre: archivoPdf?.nombre || 'Informe_Fotografico.pdf',
        url: archivoPdf?.url || '',
        drive_file_id: archivoPdf?.drive_file_id || null,
        fecha: new Date().toISOString()
      };

      Swal.close();
      return true;
    } catch (err: any) {
      Swal.close();
      console.warn('No se pudo asegurar el PDF del informe fotográfico:', err?.error?.message || err?.message || err);
      return false;
    }
  }

  private async descargarInformeFotograficoPdfDesdeMenu(): Promise<void> {
    const preparado = await this.asegurarInformeFotograficoEnDrive();
    if (!preparado) {
      return;
    }

    const slidesDriveFileId = this.obtenerDriveFileId(this.informeFotograficoArchivo);
    if (!slidesDriveFileId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se encontró el archivo de Informe Fotográfico en Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const pdfAsegurado = await this.asegurarInformeFotograficoPdfEnDrive(false);
    const drivePdfFileId = this.obtenerDriveFileId(this.informeFotograficoPdfArchivoDrive);

    if (!pdfAsegurado || !drivePdfFileId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo preparar el PDF del Informe Fotográfico en Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    Swal.fire({
      title: 'Preparando PDF...',
      text: 'Descargando PDF del Informe Fotográfico',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const blob = await firstValueFrom(
        this.backendServices.descargarArchivoDrive(
          drivePdfFileId,
          this.informeFotograficoPdfArchivoDrive?.nombre || 'Informe_Fotografico.pdf'
        )
      );
      Swal.close();
      this.descargarBlobPdf(blob, this.informeFotograficoPdfArchivoDrive?.nombre || 'Informe_Fotografico');
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el Informe Fotográfico en PDF.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  private async descargarInformeFotograficoPowerPointDesdeMenu(): Promise<void> {
    const preparado = await this.asegurarInformeFotograficoEnDrive();
    if (!preparado) {
      return;
    }

    const driveFileId = this.obtenerDriveFileId(this.informeFotograficoArchivo);
    if (!driveFileId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se encontró el archivo de Informe Fotográfico en Drive.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const params = new URLSearchParams();
    if (this.googleDriveEmail) {
      params.set('authuser', this.googleDriveEmail);
    }
    const exportUrl = `https://docs.google.com/presentation/d/${encodeURIComponent(driveFileId)}/export/pptx${params.toString() ? `?${params.toString()}` : ''}`;
    this.descargarDesdeUrl(exportUrl);
  }

  private async asegurarInformeFinalEnDrive(): Promise<boolean> {
    if (this.obtenerDriveFileId(this.informeFinalArchivoDrive)) {
      return true;
    }
    return this.generarYSubirInformeFinalADrive();
  }

  private async asegurarInformeFotograficoEnDrive(): Promise<boolean> {
    if (this.obtenerDriveFileId(this.informeFotograficoArchivo)) {
      return true;
    }

    if (!this.cursoId) {
      await Swal.fire({
        title: 'Error',
        text: 'No se pudo identificar el curso programado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    Swal.fire({
      title: 'Generando Informe Fotográfico...',
      text: 'Preparando archivo en Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const response = await firstValueFrom(this.backendServices.generarInformeFotografico(this.cursoId));
      Swal.close();

      if (!response?.success || !response?.archivo) {
        await Swal.fire({
          title: 'Error',
          text: response?.message || 'No se pudo generar el Informe Fotográfico.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return false;
      }

      this.informeFotograficoArchivo = response.archivo;

      const archivoPdf = response?.archivo_pdf || {};
      if (archivoPdf?.drive_file_id || archivoPdf?.url) {
        this.informeFotograficoPdfArchivoDrive = {
          id: this.informeFotograficoPdfArchivoDrive?.id || null,
          nombre: archivoPdf?.nombre || 'Informe_Fotografico.pdf',
          url: archivoPdf?.url || '',
          drive_file_id: archivoPdf?.drive_file_id || null,
          fecha: new Date().toISOString()
        };
      }

      this.cargarDocumentosProgramado();
      return true;
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo generar el Informe Fotográfico.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
  }

  private obtenerDriveFileId(doc: any): string {
    const directId = String(doc?.drive_file_id || '').trim();
    if (directId) {
      return directId;
    }
    return this.extraerDriveFileIdDesdeUrl(String(doc?.url || ''));
  }

  private descargarDesdeUrl(url: string): void {
    if (!url) {
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async generarInformeFotografico(): Promise<void> {
    if (!this.cursoId || this.generandoInformeFotografico) return;

    const confirm = await Swal.fire({
      title: 'Informe Fotográfico',
      html: '<p>Se generará un PDF con las fotos de evidencia del curso usando la plantilla de Google Slides.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F'
    });

    if (!confirm.isConfirmed) return;

    this.generandoInformeFotografico = true;
    Swal.fire({
      title: 'Generando Informe Fotográfico...',
      html: 'Procesando imágenes y creando presentación PDF',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const response = await firstValueFrom(this.backendServices.generarInformeFotografico(this.cursoId));
      Swal.close();
      this.generandoInformeFotografico = false;

      if (response?.success) {
        this.informeFotograficoArchivo = response.archivo;

        const archivoPdf = response?.archivo_pdf || {};
        if (archivoPdf?.drive_file_id || archivoPdf?.url) {
          this.informeFotograficoPdfArchivoDrive = {
            id: this.informeFotograficoPdfArchivoDrive?.id || null,
            nombre: archivoPdf?.nombre || 'Informe_Fotografico.pdf',
            url: archivoPdf?.url || '',
            drive_file_id: archivoPdf?.drive_file_id || null,
            fecha: new Date().toISOString()
          };
        }

        this.cargarDocumentosProgramado();
        await Swal.fire({
          title: 'Informe Fotográfico generado',
          html: `<p class="mb-0">El archivo se guardó en Drive: <strong>${response.archivo?.nombre || 'informe_fotografico'}</strong>${archivoPdf?.nombre ? `<br><small class="text-muted">PDF oficial: ${archivoPdf.nombre}</small>` : ''}</p>`,
          icon: 'success',
          confirmButtonColor: '#38512F'
        });
      } else {
        await Swal.fire({
          title: 'Error',
          text: response?.message || 'No se pudo generar el informe fotográfico.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    } catch (err: any) {
      Swal.close();
      this.generandoInformeFotografico = false;
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo generar el informe fotográfico.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    }
  }

  verificarCuentaGoogleDrive(): void {
    this.googleDriveAuthCargando = true;
    this.googleDriveAuthError = null;
    this.backendServices.obtenerEstadoAuthDrive().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.googleDriveAuthCargando = false;
        this.googleDriveAuthOk = !!res?.ok;
        this.googleDriveEmail = res?.email || null;
        this.googleDriveNombre = res?.nombre || null;
        this.googleDriveAuthMethod = res?.authMethod || '';
        this.googleDriveAuthError = res?.ok ? null : (res?.lastError || 'No se pudo verificar la cuenta de Google.');
        this.refrescarUrlsEditoresDrive();
      },
      error: () => {
        this.googleDriveAuthCargando = false;
        this.googleDriveAuthOk = false;
        this.googleDriveAuthError = 'No se pudo conectar al servidor para verificar Google Drive.';
      }
    });
  }

  cambiarCuentaGoogleSheets(): void {
    const driveFileId = this.informeFinalArchivoDrive?.drive_file_id;
    if (!driveFileId) return;
    // Abrir Google Sheets en nueva pestaña con selector de cuenta
    const url = `https://accounts.google.com/AccountChooser?continue=https://docs.google.com/spreadsheets/d/${encodeURIComponent(driveFileId)}/edit`;
    window.open(url, '_blank', 'noopener');
  }

  cambiarCuentaGoogleSlides(): void {
    const driveFileId = this.informeFotograficoArchivo?.drive_file_id;
    if (!driveFileId) return;
    const url = `https://accounts.google.com/AccountChooser?continue=https://docs.google.com/presentation/d/${encodeURIComponent(driveFileId)}/edit`;
    window.open(url, '_blank', 'noopener');
  }

  toggleEditorInformeFinal(): void {
    if (!this.informeFinalArchivoDrive?.drive_file_id && !this.informeFinalArchivoDrive?.url) {
      return;
    }

    if (!this.informeFinalEditorUrl) {
      const editorUrl = this.resolverUrlEdicionInforme(
        this.informeFinalArchivoDrive?.drive_file_id,
        this.informeFinalArchivoDrive?.url
      );
      if (!editorUrl) return;
      this.informeFinalEditorRawUrl = editorUrl;
      this.informeFinalEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
    }

    this.informeFinalEditorVisible = !this.informeFinalEditorVisible;
    if (this.informeFinalEditorVisible) this.informeFotograficoEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.sincronizarBloqueoScrollEditor();
    if (this.informeFinalEditorVisible) this.verificarCuentaGoogleDrive();
    if (this.informeFinalEditorVisible) {
      this.limpiarRestauracionScrollEditorPendiente();
      this.actualizarAnclaScrollEditor();
    }
  }

  abrirInformeFinalEnNuevaPestana(): void {
    const url = this.informeFinalEditorRawUrl || this.resolverUrlEdicionInforme(
      this.informeFinalArchivoDrive?.drive_file_id,
      this.informeFinalArchivoDrive?.url
    );
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  get informeFinalEditorDisponible(): boolean {
    return !!(this.informeFinalArchivoDrive?.drive_file_id || this.informeFinalArchivoDrive?.url);
  }

  toggleEditorInformeFotografico(): void {
    if (!this.informeFotograficoArchivo?.drive_file_id && !this.informeFotograficoArchivo?.url) {
      return;
    }

    if (!this.informeFotograficoEditorUrl) {
      const editorUrl = this.resolverUrlEdicionInformeFotografico(
        this.informeFotograficoArchivo?.drive_file_id,
        this.informeFotograficoArchivo?.url
      );
      if (!editorUrl) return;
      this.informeFotograficoEditorRawUrl = editorUrl;
      this.informeFotograficoEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl);
    }

    this.informeFotograficoEditorVisible = !this.informeFotograficoEditorVisible;
    if (this.informeFotograficoEditorVisible) this.informeFinalEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.sincronizarBloqueoScrollEditor();
    if (this.informeFotograficoEditorVisible) this.verificarCuentaGoogleDrive();
    if (this.informeFotograficoEditorVisible) {
      this.limpiarRestauracionScrollEditorPendiente();
      this.actualizarAnclaScrollEditor();
    }
  }

  abrirInformeFotograficoEnNuevaPestana(): void {
    const url = this.informeFotograficoEditorRawUrl || this.resolverUrlEdicionInformeFotografico(
      this.informeFotograficoArchivo?.drive_file_id,
      this.informeFotograficoArchivo?.url
    );
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  get informeFotograficoEditorDisponible(): boolean {
    return !!(this.informeFotograficoArchivo?.drive_file_id || this.informeFotograficoArchivo?.url);
  }

  get editorIntegradoPantallaCompletaVisible(): boolean {
    return this.checklistEditorVisible || this.informeFinalEditorVisible || this.informeFotograficoEditorVisible;
  }

  get editorIntegradoTituloActivo(): string {
    if (this.checklistEditorVisible) {
      return 'Editor integrado (Google Sheets)';
    }
    return this.informeFotograficoEditorVisible
      ? 'Editor integrado (Google Slides)'
      : 'Editor integrado (Google Sheets)';
  }

  get editorIntegradoSubtituloActivo(): string {
    if (this.checklistEditorVisible) {
      return 'Checklist SP-F-08';
    }
    return this.informeFotograficoEditorVisible
      ? 'Informe fotográfico'
      : 'Informe final';
  }

  get editorIntegradoIconoActivo(): string {
    return this.informeFotograficoEditorVisible ? 'fa-images' : 'fa-table';
  }

  get editorIntegradoUrlActiva(): SafeResourceUrl | null {
    if (this.checklistEditorVisible) {
      return this.checklistEditorUrl;
    }
    if (this.informeFotograficoEditorVisible) {
      return this.informeFotograficoEditorUrl;
    }
    if (this.informeFinalEditorVisible) {
      return this.informeFinalEditorUrl;
    }
    return null;
  }

  abrirEditorIntegradoActivoEnNuevaPestana(): void {
    if (this.checklistEditorVisible) {
      this.abrirChecklistEnNuevaPestana();
      return;
    }
    if (this.informeFotograficoEditorVisible) {
      this.abrirInformeFotograficoEnNuevaPestana();
      return;
    }
    this.abrirInformeFinalEnNuevaPestana();
  }

  cerrarEditorIntegradoPaso7(): void {
    this.checklistEditorVisible = false;
    this.informeFinalEditorVisible = false;
    this.informeFotograficoEditorVisible = false;
    this.sincronizarPantallaCompletaEditorIntegrado();
    this.limpiarRestauracionScrollEditorPendiente();
  }

  @HostListener('document:keydown.escape')
  onEscapeCerrarEditorIntegrado(): void {
    if (!this.editorIntegradoPantallaCompletaVisible) {
      return;
    }
    this.cerrarEditorIntegradoPaso7();
  }

  private sincronizarPantallaCompletaEditorIntegrado(): void {
    if (this.editorIntegradoPantallaCompletaVisible) {
      this.bloquearScrollPaginaPorEditorIntegrado();
      return;
    }
    this.liberarScrollPaginaPorEditorIntegrado();
  }

  private bloquearScrollPaginaPorEditorIntegrado(): void {
    if (this.editorPantallaCompletaScrollBloqueado) {
      this.activarModoDedicadoEditorLayout();
      return;
    }

    this.editorPantallaCompletaOverflowHtmlPrevio = document.documentElement.style.overflow;
    this.editorPantallaCompletaOverflowBodyPrevio = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    this.activarModoDedicadoEditorLayout();
    this.editorPantallaCompletaScrollBloqueado = true;
  }

  private liberarScrollPaginaPorEditorIntegrado(): void {
    if (!this.editorPantallaCompletaScrollBloqueado) {
      this.desactivarModoDedicadoEditorLayout();
      return;
    }

    document.documentElement.style.overflow = this.editorPantallaCompletaOverflowHtmlPrevio;
    document.body.style.overflow = this.editorPantallaCompletaOverflowBodyPrevio;
    this.desactivarModoDedicadoEditorLayout();
    this.editorPantallaCompletaScrollBloqueado = false;
  }

  private activarModoDedicadoEditorLayout(): void {
    document.documentElement.classList.add(this.editorModoDedicadoClase);
    document.body.classList.add(this.editorModoDedicadoClase);
  }

  private desactivarModoDedicadoEditorLayout(): void {
    document.documentElement.classList.remove(this.editorModoDedicadoClase);
    document.body.classList.remove(this.editorModoDedicadoClase);
  }

  onEditorMouseEnter(): void {
    // Guardamos ancla de scroll para poder restaurarla si el foco externo (captura de pantalla)
    // regresa y el navegador desplaza la página al inicio.
    this.actualizarAnclaScrollEditor();
  }

  onEditorMouseLeave(): void {
    // Se mantiene sin acción para evitar parpadeos/saltos al salir del iframe.
  }

  /**
   * Se ejecuta al enfocar el contenedor del editor.
   * Evitamos forzar scrollTo/bloqueo para no saltar al inicio de la página.
   */
  onEditorFocusIn(): void {
    this.actualizarAnclaScrollEditor();
  }

  onEditorIframeLoad(): void {
    this.limpiarRestauracionScrollEditorPendiente();
    this.actualizarAnclaScrollEditor();
  }

  private activarBloqueoScrollPagina(): void {
    // No-op intencional: se conserva para compatibilidad con llamadas existentes.
    // El bloqueo global de scroll rompía la navegación vertical del editor integrado.
  }

  private desactivarBloqueoScrollPagina(): void {
    const habiaBloqueo = this.bloqueoScrollEditorActivo
      || document.body.style.position === 'fixed'
      || document.documentElement.style.overflow === 'hidden'
      || document.body.style.overflow === 'hidden';

    if (!habiaBloqueo) {
      return;
    }

    document.documentElement.style.overflow = this.overflowHtmlPrevio;
    document.body.style.overflow = this.overflowBodyPrevio;
    document.body.style.position = this.bodyPositionPrevio;
    document.body.style.top = this.bodyTopPrevio;
    document.body.style.width = this.bodyWidthPrevio;
    // No restauramos posición con scrollTo para evitar saltos inesperados de la interfaz.
    this.bloqueoScrollEditorActivo = false;
  }

  private resolverUrlEdicionInforme(driveFileId?: string, fallbackUrl?: string): string {
    const fileId = String(driveFileId || '').trim() || this.extraerDriveFileIdDesdeUrl(fallbackUrl || '');
    if (!fileId) return '';
    const params = new URLSearchParams({ usp: 'sharing' });
    if (this.googleDriveEmail) params.set('authuser', this.googleDriveEmail);
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit?${params.toString()}`;
  }

  private resolverUrlEdicionInformeFotografico(driveFileId?: string, fallbackUrl?: string): string {
    const fileId = String(driveFileId || '').trim() || this.extraerDriveFileIdDesdeUrl(fallbackUrl || '');
    if (!fileId) return '';
    const params = new URLSearchParams({ usp: 'sharing' });
    if (this.googleDriveEmail) params.set('authuser', this.googleDriveEmail);
    return `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/edit?${params.toString()}`;
  }

  private refrescarUrlsEditoresDrive(): void {
    if (this.informeFinalArchivoDrive?.drive_file_id || this.informeFinalArchivoDrive?.url) {
      const sheetUrl = this.resolverUrlEdicionInforme(
        this.informeFinalArchivoDrive?.drive_file_id,
        this.informeFinalArchivoDrive?.url
      );
      if (sheetUrl) {
        this.informeFinalEditorRawUrl = sheetUrl;
        this.informeFinalEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(sheetUrl);
      }
    }

    if (this.informeFotograficoArchivo?.drive_file_id || this.informeFotograficoArchivo?.url) {
      const slidesUrl = this.resolverUrlEdicionInformeFotografico(
        this.informeFotograficoArchivo?.drive_file_id,
        this.informeFotograficoArchivo?.url
      );
      if (slidesUrl) {
        this.informeFotograficoEditorRawUrl = slidesUrl;
        this.informeFotograficoEditorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(slidesUrl);
      }
    }
  }

  private extraerDriveFileIdDesdeUrl(url: string): string {
    const raw = String(url || '').trim();
    if (!raw) return '';

    const fromD = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fromD?.[1]) return fromD[1];

    const fromIdQuery = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fromIdQuery?.[1]) return fromIdQuery[1];

    return '';
  }

  /**
   * Obtiene la etiqueta del estatus para mostrar
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

  // ── Columnas dinámicas de calificación (paso 8) ─────────────────────────
  get paso8TablaTieneDiag(): boolean {
    return this.participantesAsistentesPaso8.some(
      (a: any) => a.calificacionDiag !== null && a.calificacionDiag !== undefined && a.calificacionDiag !== ''
    );
  }
  get paso8TablaTienePractica(): boolean {
    return this.participantesAsistentesPaso8.some(
      (a: any) => a.calificacionPractica !== null && a.calificacionPractica !== undefined && a.calificacionPractica !== ''
    );
  }
  get paso8TablaTieneEscrita(): boolean {
    return this.participantesAsistentesPaso8.some(
      (a: any) => a.calificacionTeorica !== null && a.calificacionTeorica !== undefined && a.calificacionTeorica !== ''
    );
  }

  // ── Colores pastel por empresa colaboradora ──────────────────────────────
  readonly paso8EmpresaPaleta = [
    { bg: 'rgba(194,209,178,0.32)', border: '#C2D1B2', text: '#38512F' },
    { bg: 'rgba(118,141,107,0.22)', border: '#768D6B', text: '#3d5530' },
    { bg: 'rgba(100,155,220,0.20)', border: '#7aaae0', text: '#1a3a6a' },
    { bg: 'rgba(210,145,85,0.22)',  border: '#d49060', text: '#6a3010' },
    { bg: 'rgba(175,115,200,0.22)', border: '#b880d8', text: '#5a1a6a' },
    { bg: 'rgba(100,195,175,0.22)', border: '#68c8b0', text: '#1a5a4a' },
    { bg: 'rgba(215,195,85,0.22)',  border: '#d4c250', text: '#5a4a10' },
    { bg: 'rgba(220,110,125,0.22)', border: '#dc7882', text: '#7a1a22' },
  ];

  getPaso8EmpresaColor(empresaId: number | null | undefined): { bg: string; border: string; text: string } {
    if (!empresaId) return { bg: 'transparent', border: 'transparent', text: 'inherit' };
    const idx = this.empresasColaboradorasPaso8.findIndex((e: any) => e.empresa_id === empresaId);
    if (idx < 0) return { bg: 'transparent', border: 'transparent', text: 'inherit' };
    return this.paso8EmpresaPaleta[idx % this.paso8EmpresaPaleta.length];
  }

  numeroCursosPaso8(alumno: any): number {
    const ids: number[] = alumno.cursos_doc_ids
      ?? (alumno.curso_documento_id != null ? [alumno.curso_documento_id] : []);
    return ids.length;
  }

  nombresCursosPaso8Tooltip(alumno: any): string {
    const ids: number[] = alumno.cursos_doc_ids
      ?? (alumno.curso_documento_id != null ? [Number(alumno.curso_documento_id)] : []);
    if (!ids.length) return 'Sin cursos asignados';
    return ids.map((id: number) => {
      if (id === this.cursoCatalogoIdActual) return this.nombreCurso ?? `Curso ${id}`;
      const c = this.listaCursosDisponibles.find((x: any) => x.id === id);
      return c?.nombre ?? `Curso ${id}`;
    }).join('\n');
  }

  // ── Modal de asignación colaboradora ────────────────────────────────────
  abrirModalColaboradoraPaso8(alumno: any): void {
    this.alumnoModalPaso8 = alumno;
    this.empresaModalSeleccionadaPaso8 = alumno.empresa_documento_id ?? null;
    this.cursosModalSeleccionadosPaso8 = alumno.cursos_doc_ids
      ? [...alumno.cursos_doc_ids]
      : (alumno.curso_documento_id != null ? [Number(alumno.curso_documento_id)] : []);
    document.body.classList.add('paso8-colab-modal-open');
  }

  cerrarModalColaboradoraPaso8(): void {
    this.alumnoModalPaso8 = null;
    document.body.classList.remove('paso8-colab-modal-open');
  }

  getLogoEmpresaColaboradora(empresa: EmpresaColaboradoraDoc): string | null {
    return this.backendServices.resolverUrlDrivePreview(empresa.logo_url) ?? null;
  }

  toggleCursoModalPaso8(cursoId: number): void {
    const id = Number(cursoId);
    const idx = this.cursosModalSeleccionadosPaso8.indexOf(id);
    if (idx >= 0) {
      this.cursosModalSeleccionadosPaso8.splice(idx, 1);
    } else {
      this.cursosModalSeleccionadosPaso8.push(id);
    }
  }

  cursosModalEsSeleccionadoPaso8(cursoId: number): boolean {
    return this.cursosModalSeleccionadosPaso8.includes(Number(cursoId));
  }

  guardarModalColaboradoraPaso8(): void {
    const alumno = this.alumnoModalPaso8;
    if (!alumno) return;
    const empresaAnterior = alumno.empresa_documento_id;
    alumno.empresa_documento_id = this.empresaModalSeleccionadaPaso8;
    alumno.cursos_doc_ids = [...this.cursosModalSeleccionadosPaso8];
    alumno.curso_documento_id = this.cursosModalSeleccionadosPaso8[0] ?? null;
    if (alumno.empresa_documento_id !== empresaAnterior) {
      this.onAsignacionEmpresaColaboradoraChange(alumno, alumno.empresa_documento_id);
    } else if (alumno.cursos_doc_ids.length > 0) {
      alumno.curso_documento_id = alumno.cursos_doc_ids[0];
      this.onAsignacionCursoColaboradoraChange(alumno, alumno.curso_documento_id);
    }
    this.programarGuardadoColaboradorasPaso8();
    this.cerrarModalColaboradoraPaso8();
  }
}
