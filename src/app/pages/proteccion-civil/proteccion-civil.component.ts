import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis
} from 'ng-apexcharts';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { PcVisorDocumentoRequest } from '../proteccion-civil-revisar-documentos/proteccion-civil-revisar-documentos.component';

interface ArchivoPC {
  archivo_id: number | null;
  documento_id?: number;
  drive_file_id: string;
  nombre_archivo: string;
  mime_type?: string | null;
  orden?: number;
  fecha_subida?: string | null;
}

interface PcDocExtraItem {
  id: number;
  empresaId: number;
  titulo: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  driveFileId: string;
  /** Ruta bajo Documentación Extra. Vacío = raíz. */
  carpetaRelativa?: string;
  webViewLink?: string | null;
  subidoPor?: string | null;
  fechaSubida: string;
}

interface PcDocExtraPendiente {
  file: File;
  /** Destino relativo bajo Documentación Extra ('' = raíz). */
  carpetaRelativa: string;
  /** Texto mostrado en la cola de subida. */
  etiqueta: string;
}

interface PcDocExtraCarpetaVista {
  nombre: string;
  ruta: string;
  cantidad: number;
}

type PcExtraMiniaturaModo = 'imagen' | 'icono';

interface PcExtraMiniaturaEstado {
  modo: PcExtraMiniaturaModo;
  /** URL para <img> (thumbnail Drive o blob). */
  urlStr: string | null;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

interface DocumentoPC {
  documento_id: number;
  documento_padre_id?: number | null;
  catalogo_documento_id?: number | null;
  nombre_documento: string;
  especificacion: string;
  obligatorio: boolean;
  visible_empresa?: boolean | number;
  estatus: 'pendiente' | 'aprobado' | 'rechazado' | 'revision';
  archivo_url: string | null;
  nombre_archivo: string | null;
  comentarios: string | null;
  fecha_subida: string | null;
  subdocumentos?: DocumentoPC[];
  archivos?: ArchivoPC[];
  tipo_entrada?: 'archivo' | 'texto';
  valor_texto?: string | null;
  autollenado?: boolean;
}

interface EmpresaPC {
  empresa_id: number;
  nombre_empresa: string;
  rfc: string;
  estado: string;
  ciudad: string;
  codigo_postal?: string;
  logo?: string | null;
  logo_url?: string | null;
  documentos_completos: number;
  documentos_totales: number;
  pasos_completados?: string[];
  ciclo_cerrado?: boolean;
  responsable_pipc_usuario_id?: number | null;
  responsable_pipc_nombre?: string | null;
}

interface DocumentoCatalogo {
  id: number;
  nombre: string;
  tipo: string;
  disponible: boolean;
  archivo_url?: string;
}

type SeccionEmpresaDocumentos = 'archivos' | 'texto' | 'autollenado';

type ResolutivosChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis | ApexYAxis[];
  dataLabels: ApexDataLabels;
  fill: ApexFill;
  stroke: ApexStroke;
  tooltip: ApexTooltip;
  grid: ApexGrid;
  colors: string[];
  plotOptions: ApexPlotOptions;
  legend: ApexLegend;
};

interface ResolutivoEstatusCard {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
  icono: string;
}

type PasoCentroOperacionesId = 'asignar' | 'recorrido' | 'documentacion' | 'oficio' | 'observaciones' | 'resolutivo' | 'finalizar';

type PcWorkflowClave = string;

interface PcPipcAsignadoOps {
  documento_id: number;
  catalogo_documento_id?: number | null;
  nombre_documento: string;
  clave_oficio: string;
  clave_obs_1: string;
  clave_obs_2: string;
  clave_fecha_obs: string;
  clave_resolutivo_pipc: string;
  clave_resolutivo_factibilidad: string;
  clave_resolutivo_otms: string;
  /** Compat */
  clave_obs?: string;
  clave_resolutivo?: string;
}

interface PcResolutivoTipoUi {
  tipo: 'pipc' | 'factibilidad' | 'otms';
  label: string;
  claveKey: 'clave_resolutivo_pipc' | 'clave_resolutivo_factibilidad' | 'clave_resolutivo_otms';
}

interface PasoCentroOperaciones {
  id: PasoCentroOperacionesId;
  nombre: string;
  descripcion: string;
  icono: string;
  orden: number;
}

interface PcWorkflowArchivo {
  documento_id: number;
  nombre_documento?: string;
  estatus?: string;
  archivo_url?: string | null;
  nombre_archivo?: string | null;
  fecha_subida?: string | null;
  clave_workflow?: string | null;
}

@Component({
  selector: 'app-proteccion-civil',
  templateUrl: './proteccion-civil.component.html',
  styleUrls: ['./proteccion-civil.component.scss']
})
export class ProteccionCivilComponent implements OnInit, OnDestroy {
  readonly acceptedPcFileTypes: string = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.xls,.xlsx,.ppt,.pptx';
  /** Límite de subida en Protección Civil (debe coincidir con MAX_PC_UPLOAD_MB del backend). */
  readonly maxPcFileMb = 50;
  private readonly maxPcFileBytes = this.maxPcFileMb * 1024 * 1024;
  /** Documentación Extra: archivos pesados (coincide con MAX_PC_EXTRA_UPLOAD_MB del backend). */
  readonly maxPcExtraFileMb = 512;
  private readonly maxPcExtraFileBytes = this.maxPcExtraFileMb * 1024 * 1024;
  private readonly allowedPcMimeTypes: string[] = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];
  private readonly allowedPcExtensions: string[] = [
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.xls', '.xlsx', '.ppt', '.pptx'
  ];


  // Estado de la vista
  vistaActual: 'empresas' | 'menuDocumentos' | 'asignarDocumentos' | 'revisarDocumentos' | 'subirDocumentos' | 'catalogo' | 'detalleDocumento' = 'empresas';

  /** Paso activo en el stepper del centro de operaciones (vista menú admin). */
  pasoOperacionesSeleccionado: PasoCentroOperacionesId = 'asignar';
  opsPasosCompletados: PasoCentroOperacionesId[] = [];
  opsPuedeCompletar: Partial<Record<PasoCentroOperacionesId, boolean>> = {};
  opsObservacionesOmitible = false;
  opsPipcCobertura: { total_catalogo: number; total_asignadas: number; todas_asignadas: boolean } | null = null;
  opsPipcAsignados: PcPipcAsignadoOps[] = [];
  opsFechasWorkflow: Record<string, string> = {};
  opsRefreshAsignaciones = 0;
  opsRefreshRecorrido = 0;
  opsCargandoEstado = false;
  opsCicloCerrado = false;
  opsArchivosWorkflow: Partial<Record<PcWorkflowClave, PcWorkflowArchivo>> = {};
  opsFechaIngresoTramite = '';
  opsFechaOficioObservaciones = '';
  opsFechaAprobacionPipc = '';
  opsFechaAprobacionFactibilidad = '';
  opsFechaAprobacionOtms = '';
  opsSubiendoWorkflow: PcWorkflowClave | null = null;
  opsGuardandoFecha: string | null = null;
  opsOficioPreviewClave: PcWorkflowClave | null = null;
  opsObsPreviewClave: PcWorkflowClave | null = null;
  readonly opsResolutivoTipos: PcResolutivoTipoUi[] = [
    { tipo: 'pipc', label: 'PIPC', claveKey: 'clave_resolutivo_pipc' },
    { tipo: 'factibilidad', label: 'Factibilidad', claveKey: 'clave_resolutivo_factibilidad' },
    { tipo: 'otms', label: 'OTMS', claveKey: 'clave_resolutivo_otms' }
  ];
  /** Pestaña activa en el paso Documentación del centro de operaciones. */
  opsDocumentacionTab: 'carga' | 'revision' = 'carga';
  
  // Empresas
  empresas: EmpresaPC[] = [];
  empresasFiltradas: EmpresaPC[] = [];
  empresasRecientesIds: number[] = [];
  private readonly PC_EMPRESAS_RECIENTES_MAX = 6;
  private readonly PC_EMPRESAS_RECIENTES_KEY = 'pc_empresas_recientes';
  empresaSeleccionada: EmpresaPC | null = null;
  cargandoEmpresas: boolean = false;
  textoBusquedaEmpresa: string = '';

  // Filtros de ubicación (se pueblan dinámicamente desde la BD)
  estados: string[] = [];
  estadoSeleccionado: string = '';
  municipios: string[] = [];
  municipioSeleccionado: string = '';

  // Documentos de la empresa seleccionada
  documentos: DocumentoPC[] = [];
  cargandoDocumentos: boolean = false;

  // Documentación Extra (fuera del checklist PIPC)
  pcDocsExtra: PcDocExtraItem[] = [];
  cargandoPcDocsExtra = false;
  subiendoPcDocsExtra = false;
  errorPcDocsExtra: string | null = null;
  pcDocsExtraSeleccionados: PcDocExtraPendiente[] = [];
  /** Carpetas nuevas que se están creando en la subida actual (nombres relativos al destino). */
  pcDocsExtraCarpetasEnSubida: string[] = [];
  eliminandoPcDocsExtraCarpeta = false;
  dragOverPcDocsExtra = false;
  /** Carpetas abiertas en acordeón (ruta relativa). '__raiz__' = Documentación extra suelta. */
  pcDocsExtraCarpetasExpandidas = new Set<string>();
  readonly pcDocsExtraClaveRaiz = '__raiz__';
  private pcDocsExtraRaizInicializada = false;
  pcDocsExtraMiniaturas: Record<number, PcExtraMiniaturaEstado> = {};
  private readonly pcExtraMiniaturaObjectUrls = new Map<number, string>();
  private readonly pcExtraDestroy$ = new Subject<void>();
  private documentoIdPendienteVisor: number | null = null;
  private recolectandoDropPcExtra = false;

  // Modal de comentarios
  mostrarModalComentario: boolean = false;
  documentoComentario: DocumentoPC | null = null;
  nuevoComentario: string = '';
  guardandoComentario: boolean = false;

  // Modal de agregar documento
  mostrarModalAgregar: boolean = false;
  nuevoDocumento = {
    nombre_documento: '',
    especificacion: '',
    obligatorio: true
  };
  guardandoDocumento: boolean = false;

  // Modal de visualizar archivo
  mostrarModalVisualizador: boolean = false;
  urlArchivoActual: string = '';
  nombreArchivoActual: string = '';
  cargandoVisualizador: boolean = false;
  documentoVisualizadorId: number | null = null;
  /** Si el visor muestra un ítem de Documentación Extra (no del checklist). */
  pcDocExtraVisualizadorId: number | null = null;

  // Upload de archivo
  archivoSeleccionado: File | null = null;
  subiendoArchivo: boolean = false;

  // Control de dropdown de estatus
  dropdownAbierto: number | null = null;
  dropdownPosition = { top: 0, left: 0 };
  private botonDropdownActivo: HTMLElement | null = null;

  // Catálogo de documentos
  catalogoDocumentos: DocumentoCatalogo[] = [];
  catalogoDocumentosFiltrados: DocumentoCatalogo[] = [];
  textoBusquedaCatalogo: string = '';
  documentoSeleccionado: DocumentoCatalogo | null = null;
  mostrarModalDetalle: boolean = false;
  
  // Doble lista - Categorías y filtrado
  tiposCatalogo: string[] = [];
  tipoSeleccionado: string = 'Todos';
  mostrarModalVisualizadorCatalogo: boolean = false;

  // =====================================================
  // VISTA EMPRESA: Propiedades para usuarios de empresa
  // =====================================================
  esUsuarioEmpresa: boolean = false;
  nombreEmpresaUsuario: string = '';
  misDocumentos: DocumentoPC[] = [];
  cargandoMisDocumentos: boolean = false;
  
  // Stepper de documentos (admin subirDocumentos y empresa)
  docActivoSubir: DocumentoPC | null = null;
  docActivoEmpresa: DocumentoPC | null = null;

  // Filtro de estado (Pendientes/Aprobados/Rechazados)
  estadoFiltroEmpresa: 'pendiente' | 'aprobado' | 'rechazado' = 'pendiente';
  estadoFiltroSubir: 'pendiente' | 'aprobado' | 'rechazado' = 'pendiente';
  seccionEmpresaActiva: SeccionEmpresaDocumentos = 'archivos';
  seccionSubirActiva: SeccionEmpresaDocumentos = 'archivos';
  busquedaEmpresa: string = '';
  busquedaSubir: string = '';
  filtroEntregaEmpresa: 'todos' | 'entregados' | 'faltantes' = 'todos';
  filtroEntregaSubir: 'todos' | 'entregados' | 'faltantes' = 'todos';
  generandoListadoEstatusPdf = false;
  subdocFocusEmpresa: DocumentoPC | null = null;
  subdocFocusSubir: DocumentoPC | null = null;
  dragOverDocId: number | null = null;
  private autollenadoOriginalEmpresa: Map<number, string> = new Map<number, string>();
  private autollenadoEditandoEmpresa: Set<number> = new Set<number>();
  private textoEditandoEmpresa: Set<number> = new Set<number>();
  private autollenadoOriginalSubir: Map<number, string> = new Map<number, string>();
  private autollenadoEditandoSubir: Set<number> = new Set<number>();
  private textoEditandoSubir: Set<number> = new Set<number>();

  esRootUser = false;

  resolutivosAnio = new Date().getFullYear();
  cargandoResolutivosEstadisticas = false;
  resolutivosChartsReady = false;
  resolutivosChartOptions!: Partial<ResolutivosChartOptions>;
  resolutivosEstatusCards: ResolutivoEstatusCard[] = [];
  resolutivosEstatusResumen = { total: 0 };
  resolutivosActividadResumen = {
    totalAnio: 0,
    promedioMensual: 0,
    variacionMensual: 0
  };

  private readonly resolutivosEstatusConfig: Record<string, { label: string; color: string; icono: string }> = {
    Vigentes: { label: 'Vigentes', color: '#2dce89', icono: 'fa-check-circle' },
    'Próximo a vencer': { label: 'Próximo a vencer', color: '#fb6340', icono: 'fa-exclamation-circle' },
    Vencido: { label: 'Vencido', color: '#f5365c', icono: 'fa-times-circle' },
    'En tramite': { label: 'En trámite', color: '#5e72e4', icono: 'fa-hourglass-half' }
  };
  private readonly resolutivosEstatusOrder = ['En tramite', 'Vigentes', 'Próximo a vencer', 'Vencido'];

  // Actualizar posición del dropdown al hacer scroll
  @HostListener('window:scroll', ['$event'])
  onScroll(): void {
    if (this.dropdownAbierto !== null && this.botonDropdownActivo) {
      this.actualizarPosicionDropdown();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarOverlaysPc(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.dropdownAbierto !== null) {
      event.preventDefault();
      this.dropdownAbierto = null;
      return;
    }
    if (this.mostrarModalVisualizador) {
      event.preventDefault();
      this.cerrarVisualizador();
      return;
    }
    if (this.mostrarModalVisualizadorCatalogo) {
      event.preventDefault();
      this.cerrarModalVisualizadorCatalogo();
    }
  }

  private actualizarPosicionDropdown(): void {
    if (this.botonDropdownActivo) {
      const rect = this.botonDropdownActivo.getBoundingClientRect();
      this.dropdownPosition = {
        top: rect.bottom + 5,
        left: rect.left + (rect.width / 2) - 90
      };
    }
  }

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer
  ) {
    this.initResolutivosCharts();
  }

  ngOnInit(): void {
    // Detectar si el usuario es de tipo empresa
    this.esUsuarioEmpresa = this.authService.esUsuarioEmpresa();

    if (this.esUsuarioEmpresa && !this.authService.empresaTieneServicioProteccionCivil()) {
      Swal.fire({
        icon: 'info',
        title: 'Servicio no habilitado',
        text: 'Tu empresa no tiene habilitado el servicio de Protección Civil.',
        confirmButtonColor: '#38512F'
      }).then(() => this.router.navigate(['/home']));
      return;
    }
    
    if (this.esUsuarioEmpresa) {
      // Si es usuario empresa, cargar solo sus documentos
      this.nombreEmpresaUsuario = this.authService.getUsername();
      this.cargarMisDocumentos();
    } else {
      // Si es admin/coordinador, cargar lista de empresas
      this.esRootUser = this.authService.esRoot();
      this.cargarEmpresasRecientesDesdeStorage();
      this.cargarEmpresas();
      if (this.puedeVerGraficaActividadResolutivosPipc) {
        this.cargarEstadisticasResolutivos();
      }
    }
    this.inicializarCatalogoDocumentos();
    this.route.queryParamMap.pipe(takeUntil(this.pcExtraDestroy$)).subscribe((params) => {
      const documentoId = Number(params.get('documentoId'));
      const empresaId = Number(params.get('empresaId'));
      this.documentoIdPendienteVisor =
        Number.isFinite(documentoId) && documentoId > 0 ? documentoId : null;
      if (!this.documentoIdPendienteVisor || this.esUsuarioEmpresa) {
        return;
      }
      if (
        this.empresaSeleccionada
        && Number(this.empresaSeleccionada.empresa_id) === empresaId
        && this.documentos.length
      ) {
        this.intentarAbrirDocumentoDesdeBusqueda();
        return;
      }
      if (this.empresas.length) {
        this.aplicarEstadoDesdeRuta();
      }
    });
  }

  ngOnDestroy(): void {
    this.limpiarMiniaturasPcExtra();
    this.pcExtraDestroy$.next();
    this.pcExtraDestroy$.complete();
  }

  // =====================================================
  // VISTA EMPRESA: Métodos para usuarios de empresa
  // =====================================================

  cargarMisDocumentos(): void {
    this.cargandoMisDocumentos = true;
    this.docActivoEmpresa = null;
    const empresaId = this.authService.getEmpresaId();
    
    
    if (empresaId) {
      this.backendService.obtenerDocumentosProteccionCivil(empresaId).subscribe(
        (response: any) => {
          if (response.success) {
            this.misDocumentos = response.documentos || [];
            // Usar nombre de empresa del backend si está disponible
            if (response.nombre_empresa) {
              this.nombreEmpresaUsuario = response.nombre_empresa;
            }
            // Aplanar subdocumentos para que la empresa los vea como lista
            this.misDocumentos = this.aplanarDocumentosEmpresa(this.misDocumentos);
            this.misDocumentos = this.ordenarDocumentosEmpresa(this.misDocumentos);
          }
          // Set first rejected doc (or first overall) as active
          const primerRechazado = this.misDocumentos.find(d => this.esDocRechazadoReal(d));
          this.docActivoEmpresa = primerRechazado ?? this.misDocumentos[0] ?? null;
          this.normalizarEstadoFiltroEmpresa();
          this.normalizarSeccionEmpresaActiva();
          this.normalizarSubdocFocusEmpresa();
          this.cargandoMisDocumentos = false;
        },
        (error) => {
          console.error('Error al cargar mis documentos:', error);
          this.misDocumentos = [];
          this.cargandoMisDocumentos = false;
        }
      );
    } else {
      this.misDocumentos = [];
      this.cargandoMisDocumentos = false;
    }
  }

  /**
   * Aplanar la jerarquía padre-hijos en una lista plana para la vista de empresa.
   * Si un padre tiene subdocumentos, se muestran los subdocumentos; si no, el padre.
   */
  private aplanarDocumentosEmpresa(documentos: DocumentoPC[]): DocumentoPC[] {
    const resultado: DocumentoPC[] = [];
    for (const doc of documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        // Agregar el padre como encabezado
        resultado.push(doc);
      } else {
        resultado.push(doc);
      }
    }
    return resultado;
  }

  // ── Helpers para estado real considerando subdocumentos ──
  private esDocAprobadoReal(doc: DocumentoPC): boolean {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      const reales = this.filtrarSubdocsReales(doc.subdocumentos);
      return reales.length > 0 && reales.every(s => s.estatus === 'aprobado');
    }
    return doc.estatus === 'aprobado';
  }

  private esDocRechazadoReal(doc: DocumentoPC): boolean {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      return this.filtrarSubdocsReales(doc.subdocumentos).some(s => s.estatus === 'rechazado');
    }
    return doc.estatus === 'rechazado';
  }

  /** Sort: rejected first, then pending, then approved */
  private ordenarDocumentosEmpresa(docs: DocumentoPC[]): DocumentoPC[] {
    return [...docs].sort((a, b) => {
      const orden = (d: DocumentoPC) =>
        this.esDocRechazadoReal(d) ? 0 : this.esDocAprobadoReal(d) ? 2 : 1;
      return orden(a) - orden(b);
    });
  }

  // ── Contadores basados en archivos individuales (subdocumentos) ──

  private filtrarSubdocsReales(subdocs: DocumentoPC[]): DocumentoPC[] {
    return subdocs.filter(s => !this.esSubtituloOperativo(s.nombre_documento));
  }

  get totalArchivosIndividuales(): number {
    let count = 0;
    for (const doc of this.misDocumentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).length;
      } else {
        count++;
      }
    }
    return count;
  }

  // Calcular progreso de mis documentos (basado en archivos individuales)
  get progresoMisDocumentos(): number {
    const total = this.totalArchivosIndividuales;
    if (total === 0) return 0;
    return Math.round((this.documentosAprobados / total) * 100);
  }

  get documentosAprobados(): number {
    let count = 0;
    for (const doc of this.misDocumentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'aprobado').length;
      } else {
        if (doc.estatus === 'aprobado') count++;
      }
    }
    return count;
  }

  get documentosPendientes(): number {
    let count = 0;
    for (const doc of this.misDocumentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'pendiente').length;
      } else {
        if (doc.estatus === 'pendiente') count++;
      }
    }
    return count;
  }

  get documentosEnRevision(): number {
    let count = 0;
    for (const doc of this.misDocumentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'revision').length;
      } else {
        if (doc.estatus === 'revision') count++;
      }
    }
    return count;
  }

  get documentosRechazados(): number {
    let count = 0;
    for (const doc of this.misDocumentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += doc.subdocumentos.filter(s => s.estatus === 'rechazado').length;
      } else {
        if (doc.estatus === 'rechazado') count++;
      }
    }
    return count;
  }

  private porcentajeEstatusEmpresa(cantidad: number): number {
    const total = this.totalArchivosIndividuales;
    if (!total) return 0;
    return Math.round((cantidad / total) * 100);
  }

  get porcentajeAprobadosEmpresa(): number {
    return this.porcentajeEstatusEmpresa(this.documentosAprobados);
  }

  get porcentajePendientesEmpresa(): number {
    return this.porcentajeEstatusEmpresa(this.documentosPendientes);
  }

  get porcentajeRechazadosEmpresa(): number {
    return this.porcentajeEstatusEmpresa(this.documentosRechazados);
  }

  // =====================================================
  // STEPPER: Navegación de documentos
  // =====================================================

  seleccionarDocSubir(doc: DocumentoPC): void {
    this.docActivoSubir = doc;
    this.busquedaSubir = '';
    this.normalizarEstadoFiltroSubir();
    this.normalizarSeccionSubirActiva();
    this.normalizarSubdocFocusSubir();
  }

  private esElementoCompletadoParaStepper(doc: DocumentoPC): boolean {
    if (doc.tipo_entrada === 'texto') {
      const tieneTexto = !!String(doc.valor_texto || '').trim();
      return doc.estatus === 'aprobado' || (doc.estatus === 'revision' && tieneTexto);
    }
    return doc.estatus === 'aprobado' || (doc.estatus === 'revision' && !!doc.nombre_archivo);
  }

  private esElementoAprobadoParaStepper(doc: DocumentoPC): boolean {
    return doc.estatus === 'aprobado';
  }

  private esElementoEnRevisionParaStepper(doc: DocumentoPC): boolean {
    if (doc.estatus !== 'revision') return false;
    if (doc.tipo_entrada === 'texto') {
      return !!String(doc.valor_texto || '').trim();
    }
    return !!doc.nombre_archivo;
  }

  private evaluarGrupoStepper(doc: DocumentoPC, evaluador: (d: DocumentoPC) => boolean, modo: 'every' | 'some'): boolean {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      return modo === 'every'
        ? doc.subdocumentos.every(evaluador)
        : doc.subdocumentos.some(evaluador);
    }
    return evaluador(doc);
  }

  /** Stepper: todos los elementos aprobados (icono de éxito). */
  esDocStepperAprobado(doc: DocumentoPC): boolean {
    return this.evaluarGrupoStepper(doc, d => this.esElementoAprobadoParaStepper(d), 'every');
  }

  /** Stepper: enviado y en revisión, sin pendientes ni rechazos activos. */
  esDocStepperEnRevision(doc: DocumentoPC): boolean {
    if (this.esDocStepperAprobado(doc)) return false;
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      const subs = doc.subdocumentos;
      const tieneRevision = subs.some(s => this.esElementoEnRevisionParaStepper(s));
      const tienePendiente = subs.some(s =>
        s.estatus === 'pendiente' ||
        (s.estatus === 'rechazado' && !this.esElementoCompletadoParaStepper(s))
      );
      return tieneRevision && !tienePendiente;
    }
    return this.esElementoEnRevisionParaStepper(doc);
  }

  esDocSubirCompletado(doc: DocumentoPC): boolean {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      return doc.subdocumentos.every(sub => this.esElementoCompletadoParaStepper(sub));
    }
    return this.esElementoCompletadoParaStepper(doc);
  }

  getProgresoSubirStepper(): number {
    if (this.documentos.length === 0) return 0;
    const completados = this.documentos.filter(d => this.esDocSubirCompletado(d)).length;
    return Math.round((completados / this.documentos.length) * 100);
  }

  seleccionarDocEmpresa(doc: DocumentoPC): void {
    this.docActivoEmpresa = doc;
    this.busquedaEmpresa = '';
    this.normalizarEstadoFiltroEmpresa();
    this.normalizarSeccionEmpresaActiva();
    this.normalizarSubdocFocusEmpresa();
  }

  esDocEmpresaCompletado(doc: DocumentoPC): boolean {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      return doc.subdocumentos.every(sub => this.esElementoCompletadoParaStepper(sub));
    }
    return this.esElementoCompletadoParaStepper(doc);
  }

  getProgresoEmpresaStepper(): number {
    if (this.misDocumentos.length === 0) return 0;
    const completados = this.misDocumentos.filter(d => this.esDocEmpresaCompletado(d)).length;
    return Math.round((completados / this.misDocumentos.length) * 100);
  }

  // =====================================================
  // FILTRO DE ESTADO: Pendientes / Aprobados / Rechazados
  // =====================================================

  private coincideFiltro(estatus: string, filtro: 'pendiente' | 'aprobado' | 'rechazado'): boolean {
    if (filtro === 'pendiente') return estatus === 'pendiente' || estatus === 'revision';
    return estatus === filtro;
  }

  private aplicarCambioFiltroSinSalto(action: () => void, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      target?.blur();
    }

    const scrollYActual =
      window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

    action();

    requestAnimationFrame(() => {
      const scrollYDespues =
        window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      if (Math.abs(scrollYDespues - scrollYActual) > 4) {
        window.scrollTo({ top: scrollYActual, left: 0, behavior: 'auto' });
      }
    });
  }

  // --- Vista Empresa ---
  setEstadoFiltroEmpresa(estado: 'pendiente' | 'aprobado' | 'rechazado', event?: Event): void {
    this.aplicarCambioFiltroSinSalto(() => {
      this.estadoFiltroEmpresa = estado;
      this.normalizarEstadoFiltroEmpresa();
      this.normalizarSeccionEmpresaActiva();
      this.normalizarSubdocFocusEmpresa();
    }, event);
  }

  get mostrarFiltroEmpresaAprobado(): boolean {
    return this.totalAprobadosEmpresa > 0;
  }

  get mostrarFiltroEmpresaRechazado(): boolean {
    return this.totalRechazadosEmpresa > 0;
  }

  private normalizarEstadoFiltroEmpresa(): void {
    if (this.estadoFiltroEmpresa === 'aprobado' && this.totalAprobadosEmpresa === 0) {
      this.estadoFiltroEmpresa = 'pendiente';
    }
    if (this.estadoFiltroEmpresa === 'rechazado' && this.totalRechazadosEmpresa === 0) {
      this.estadoFiltroEmpresa = 'pendiente';
    }
    if (!this.tieneContenidoFiltroEmpresa(this.estadoFiltroEmpresa)) {
      if (this.totalPendientesEmpresa > 0) {
        this.estadoFiltroEmpresa = 'pendiente';
      } else if (this.totalAprobadosEmpresa > 0) {
        this.estadoFiltroEmpresa = 'aprobado';
      } else if (this.totalRechazadosEmpresa > 0) {
        this.estadoFiltroEmpresa = 'rechazado';
      }
    }
  }

  private tieneContenidoFiltroEmpresa(filtro: 'pendiente' | 'aprobado' | 'rechazado'): boolean {
    if (filtro === 'pendiente') return this.totalPendientesEmpresa > 0;
    if (filtro === 'aprobado') return this.totalAprobadosEmpresa > 0;
    return this.totalRechazadosEmpresa > 0;
  }

  private esSubtituloOperativo(nombre: string): boolean {
    const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return n === 'fisico' || n === 'usb' || n === 'presentar';
  }

  get subdocsEmpresaFiltrados(): DocumentoPC[] {
    if (!this.docActivoEmpresa) return [];
    const subdocs = this.docActivoEmpresa.subdocumentos || [];
    return subdocs
      .filter(s => !this.esSubtituloOperativo(s.nombre_documento))
      .filter(s => this.coincideFiltro(s.estatus, this.estadoFiltroEmpresa));
  }

  private get subdocsEmpresaFiltradosBase(): DocumentoPC[] {
    if (!this.docActivoEmpresa) return [];
    const subdocs = this.docActivoEmpresa.subdocumentos || [];
    return subdocs
      .filter(s => !this.esSubtituloOperativo(s.nombre_documento))
      .filter(s => this.coincideFiltro(s.estatus, this.estadoFiltroEmpresa));
  }

  get subdocsEmpresaArchivosFiltrados(): DocumentoPC[] {
    return this.subdocsEmpresaFiltradosBase.filter(s => s.tipo_entrada !== 'texto');
  }

  get subdocsEmpresaTextoFiltrados(): DocumentoPC[] {
    return this.subdocsEmpresaFiltradosBase.filter(s => s.tipo_entrada === 'texto' && (!s.autollenado || s.estatus === 'aprobado'));
  }

  get subdocsEmpresaAutollenadoFiltrados(): DocumentoPC[] {
    return this.subdocsEmpresaFiltradosBase.filter(s => s.tipo_entrada === 'texto' && !!s.autollenado && s.estatus !== 'aprobado');
  }

  get tieneSubdocsEmpresaFiltrados(): boolean {
    return this.subdocsEmpresaMaestroBase.length > 0;
  }

  setSeccionEmpresaActiva(seccion: SeccionEmpresaDocumentos): void {
    this.normalizarSeccionEmpresaActiva(seccion);
  }

  private obtenerSeccionesEmpresaConContenido(): SeccionEmpresaDocumentos[] {
    const disponibles: SeccionEmpresaDocumentos[] = [];
    if (this.subdocsEmpresaArchivosFiltrados.length > 0) disponibles.push('archivos');
    if (this.subdocsEmpresaTextoFiltrados.length > 0) disponibles.push('texto');
    if (this.subdocsEmpresaAutollenadoFiltrados.length > 0) disponibles.push('autollenado');
    return disponibles;
  }

  private normalizarSeccionEmpresaActiva(preferida?: SeccionEmpresaDocumentos): void {
    const disponibles = this.obtenerSeccionesEmpresaConContenido();
    if (disponibles.length === 0) return;

    if (preferida && disponibles.includes(preferida)) {
      this.seccionEmpresaActiva = preferida;
      return;
    }

    if (!disponibles.includes(this.seccionEmpresaActiva)) {
      this.seccionEmpresaActiva = disponibles[0];
    }
  }

  estaEditandoAutollenadoEmpresa(doc: DocumentoPC): boolean {
    return this.autollenadoEditandoEmpresa.has(doc.documento_id);
  }

  activarEdicionAutollenadoEmpresa(doc: DocumentoPC): void {
    const docId = doc.documento_id;
    this.autollenadoOriginalEmpresa.set(docId, String(doc.valor_texto || ''));
    this.autollenadoEditandoEmpresa.add(docId);
  }

  cancelarEdicionAutollenadoEmpresa(doc: DocumentoPC): void {
    const docId = doc.documento_id;
    if (this.autollenadoOriginalEmpresa.has(docId)) {
      doc.valor_texto = this.autollenadoOriginalEmpresa.get(docId) || '';
    }
    this.autollenadoOriginalEmpresa.delete(docId);
    this.autollenadoEditandoEmpresa.delete(docId);
  }

  confirmarAutollenadoEmpresa(doc: DocumentoPC): void {
    if (!String(doc.valor_texto || '').trim()) {
      Swal.fire({
        icon: 'info',
        title: 'Sin dato autollenado',
        text: 'No hay un valor para confirmar en este campo.',
        confirmButtonColor: '#d97248'
      });
      return;
    }
    this.guardarTextoEmpresa(doc, 'confirmado');
  }

  enviarCambioAutollenadoEmpresa(doc: DocumentoPC): void {
    if (!String(doc.valor_texto || '').trim()) {
      Swal.fire({
        icon: 'warning',
        title: 'Campo vacío',
        text: 'Captura un valor para enviarlo a revisión.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const docId = doc.documento_id;
    const valorOriginal = String(this.autollenadoOriginalEmpresa.get(docId) || '').trim();
    const valorActual = String(doc.valor_texto || '').trim();
    if (valorActual === valorOriginal) {
      this.guardarTextoEmpresa(doc, 'confirmado');
      return;
    }

    this.guardarTextoEmpresa(doc, 'cambio');
  }

  estaBloqueadoTextoEmpresa(doc: DocumentoPC): boolean {
    if (doc.tipo_entrada !== 'texto') return false;
    const tieneTexto = !!String(doc.valor_texto || '').trim();
    if (!tieneTexto) return false;

    if (doc.autollenado) {
      return !this.estaEditandoAutollenadoEmpresa(doc);
    }

    return !this.textoEditandoEmpresa.has(doc.documento_id);
  }

  activarEdicionTextoEmpresa(doc: DocumentoPC): void {
    if (doc.tipo_entrada !== 'texto' || doc.autollenado) return;
    this.textoEditandoEmpresa.add(doc.documento_id);
  }

  get docEmpresaCoincidefiltro(): boolean {
    if (!this.docActivoEmpresa) return false;
    return this.coincideFiltro(this.docActivoEmpresa.estatus, this.estadoFiltroEmpresa);
  }

  get totalPendientesEmpresa(): number {
    if (!this.docActivoEmpresa) return 0;
    const subdocs = this.docActivoEmpresa.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'pendiente' || s.estatus === 'revision').length;
    }
    return (this.docActivoEmpresa.estatus === 'pendiente' || this.docActivoEmpresa.estatus === 'revision') ? 1 : 0;
  }

  get totalAprobadosEmpresa(): number {
    if (!this.docActivoEmpresa) return 0;
    const subdocs = this.docActivoEmpresa.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'aprobado').length;
    }
    return this.docActivoEmpresa.estatus === 'aprobado' ? 1 : 0;
  }

  get totalRechazadosEmpresa(): number {
    if (!this.docActivoEmpresa) return 0;
    const subdocs = this.docActivoEmpresa.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'rechazado').length;
    }
    return this.docActivoEmpresa.estatus === 'rechazado' ? 1 : 0;
  }

  // --- Vista Admin Subir ---
  setEstadoFiltroSubir(estado: 'pendiente' | 'aprobado' | 'rechazado', event?: Event): void {
    this.aplicarCambioFiltroSinSalto(() => {
      this.estadoFiltroSubir = estado;
      this.normalizarEstadoFiltroSubir();
      this.normalizarSeccionSubirActiva();
      this.normalizarSubdocFocusSubir();
    }, event);
  }

  private filtrarSubdocsPorBusqueda(subdocs: DocumentoPC[], busqueda: string): DocumentoPC[] {
    const q = (busqueda || '').trim().toLowerCase();
    if (!q) return subdocs;
    return subdocs.filter(s =>
      (s.nombre_documento || '').toLowerCase().includes(q) ||
      (s.especificacion || '').toLowerCase().includes(q) ||
      (s.nombre_archivo || '').toLowerCase().includes(q) ||
      String(s.valor_texto || '').toLowerCase().includes(q) ||
      this.getArchivosDocumento(s).some((a) => (a.nombre_archivo || '').toLowerCase().includes(q))
    );
  }

  get subdocsEmpresaArchivosBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsEmpresaArchivosFiltrados, this.busquedaEmpresa);
  }

  get subdocsEmpresaTextoBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsEmpresaTextoFiltrados, this.busquedaEmpresa);
  }

  get subdocsEmpresaAutollenadoBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsEmpresaAutollenadoFiltrados, this.busquedaEmpresa);
  }

  get subdocsSubirArchivosBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsSubirArchivosFiltrados, this.busquedaSubir);
  }

  get subdocsSubirTextoBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsSubirTextoFiltrados, this.busquedaSubir);
  }

  get subdocsSubirAutollenadoBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsSubirAutollenadoFiltrados, this.busquedaSubir);
  }

  get totalSubdocsEmpresaBusqueda(): number {
    return this.subdocsEmpresaMaestroBusqueda.length;
  }

  get totalSubdocsSubirBusqueda(): number {
    return this.subdocsSubirMaestroBusqueda.length;
  }

  private obtenerListaSubdocsVisiblesEmpresa(): DocumentoPC[] {
    return this.subdocsEmpresaMaestroBusqueda;
  }

  private obtenerListaSubdocsVisiblesSubir(): DocumentoPC[] {
    return this.subdocsSubirMaestroBusqueda;
  }

  normalizarSubdocFocusEmpresa(): void {
    const visibles = this.obtenerListaSubdocsVisiblesEmpresa();
    if (visibles.length === 0) {
      this.subdocFocusEmpresa = null;
      return;
    }
    if (!this.subdocFocusEmpresa || !visibles.some(s => s.documento_id === this.subdocFocusEmpresa!.documento_id)) {
      const pendiente = visibles.find(s => s.estatus === 'pendiente' || s.estatus === 'rechazado' || s.estatus === 'revision');
      this.subdocFocusEmpresa = pendiente ?? visibles[0];
    }
  }

  normalizarSubdocFocusSubir(): void {
    const visibles = this.obtenerListaSubdocsVisiblesSubir();
    if (visibles.length === 0) {
      this.subdocFocusSubir = null;
      return;
    }
    if (!this.subdocFocusSubir || !visibles.some(s => s.documento_id === this.subdocFocusSubir!.documento_id)) {
      const pendiente = visibles.find(s => s.estatus === 'pendiente' || s.estatus === 'rechazado' || s.estatus === 'revision');
      this.subdocFocusSubir = pendiente ?? visibles[0];
    }
  }

  onBusquedaEmpresaChange(): void {
    this.normalizarSubdocFocusEmpresa();
  }

  onBusquedaSubirChange(): void {
    this.normalizarSubdocFocusSubir();
  }

  seleccionarSubdocFocusEmpresa(subdoc: DocumentoPC): void {
    this.subdocFocusEmpresa = subdoc;
  }

  seleccionarSubdocFocusSubir(subdoc: DocumentoPC): void {
    this.subdocFocusSubir = subdoc;
  }

  irAlSiguientePendienteEmpresa(): void {
    const pendientes = this.obtenerListaSubdocsVisiblesEmpresa()
      .filter(s => s.estatus === 'pendiente' || s.estatus === 'rechazado' || s.estatus === 'revision');
    if (pendientes.length === 0) return;
    const idx = this.subdocFocusEmpresa
      ? pendientes.findIndex(s => s.documento_id === this.subdocFocusEmpresa!.documento_id)
      : -1;
    this.subdocFocusEmpresa = pendientes[(idx + 1) % pendientes.length];
  }

  irAlSiguientePendienteSubir(): void {
    const pendientes = this.obtenerListaSubdocsVisiblesSubir()
      .filter(s => s.estatus === 'pendiente' || s.estatus === 'rechazado' || s.estatus === 'revision');
    if (pendientes.length === 0) return;
    const idx = this.subdocFocusSubir
      ? pendientes.findIndex(s => s.documento_id === this.subdocFocusSubir!.documento_id)
      : -1;
    this.subdocFocusSubir = pendientes[(idx + 1) % pendientes.length];
  }

  onDragOverUpload(event: DragEvent, docId: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverDocId = docId;
  }

  onDragLeaveUpload(event: DragEvent): void {
    event.preventDefault();
    this.dragOverDocId = null;
  }

  onDropArchivo(event: DragEvent, doc: DocumentoPC): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverDocId = null;
    const files = Array.from(event.dataTransfer?.files || []) as File[];
    if (files.length) {
      this.validarYSubirArchivos(files, doc);
    }
  }

  getIconoTipoSubdoc(subdoc: DocumentoPC): string {
    if (subdoc.tipo_entrada === 'texto') {
      return subdoc.autollenado ? 'fa-magic' : 'fa-pen-alt';
    }
    return 'fa-file-alt';
  }

  esSubdocEntregado(subdoc: DocumentoPC): boolean {
    return subdoc.estatus === 'aprobado';
  }

  getEtiquetaEntregaSubdoc(subdoc: DocumentoPC): 'Sí' | 'No' {
    return this.esSubdocEntregado(subdoc) ? 'Sí' : 'No';
  }

  getClaseEntregaSubdoc(subdoc: DocumentoPC): string {
    return this.esSubdocEntregado(subdoc) ? 'is-yes' : 'is-no';
  }

  getIconoEntregaSubdoc(subdoc: DocumentoPC): string {
    return this.esSubdocEntregado(subdoc) ? 'fa-check-circle' : 'fa-times-circle';
  }

  getObservacionEntregaSubdoc(subdoc: DocumentoPC): string {
    if (this.esSubdocEntregado(subdoc)) {
      return subdoc.fecha_subida ? `Autorizado · ${subdoc.fecha_subida}` : 'Autorizado';
    }
    if (subdoc.estatus === 'revision') return 'En revisión';
    if (subdoc.estatus === 'rechazado') return 'Rechazado';
    if (this.subdocTieneEntrega(subdoc)) return 'Pendiente de autorización';
    return 'Sin entregar';
  }

  private filtrarSubdocsPorEntrega(
    subdocs: DocumentoPC[],
    filtro: 'todos' | 'entregados' | 'faltantes'
  ): DocumentoPC[] {
    if (filtro === 'entregados') {
      return subdocs.filter(s => this.esSubdocEntregado(s));
    }
    if (filtro === 'faltantes') {
      return subdocs.filter(s => !this.esSubdocEntregado(s));
    }
    return subdocs;
  }

  get subdocsEmpresaMaestroBase(): DocumentoPC[] {
    if (!this.docActivoEmpresa) return [];
    return this.filtrarSubdocsReales(this.docActivoEmpresa.subdocumentos || []);
  }

  get subdocsEmpresaMaestroFiltrados(): DocumentoPC[] {
    return this.filtrarSubdocsPorEntrega(this.subdocsEmpresaMaestroBase, this.filtroEntregaEmpresa);
  }

  get subdocsEmpresaMaestroBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsEmpresaMaestroFiltrados, this.busquedaEmpresa);
  }

  get totalEntregadosEmpresaMaestro(): number {
    return this.subdocsEmpresaMaestroBase.filter(s => this.esSubdocEntregado(s)).length;
  }

  get totalFaltantesEmpresaMaestro(): number {
    return this.subdocsEmpresaMaestroBase.filter(s => !this.esSubdocEntregado(s)).length;
  }

  get subdocsSubirMaestroBase(): DocumentoPC[] {
    if (!this.docActivoSubir) return [];
    return this.filtrarSubdocsReales(this.docActivoSubir.subdocumentos || []);
  }

  get subdocsSubirMaestroFiltrados(): DocumentoPC[] {
    return this.filtrarSubdocsPorEntrega(this.subdocsSubirMaestroBase, this.filtroEntregaSubir);
  }

  get subdocsSubirMaestroBusqueda(): DocumentoPC[] {
    return this.filtrarSubdocsPorBusqueda(this.subdocsSubirMaestroFiltrados, this.busquedaSubir);
  }

  get totalEntregadosSubirMaestro(): number {
    return this.subdocsSubirMaestroBase.filter(s => this.esSubdocEntregado(s)).length;
  }

  get totalFaltantesSubirMaestro(): number {
    return this.subdocsSubirMaestroBase.filter(s => !this.esSubdocEntregado(s)).length;
  }

  setFiltroEntregaEmpresa(filtro: 'todos' | 'entregados' | 'faltantes', event?: Event): void {
    this.aplicarCambioFiltroSinSalto(() => {
      this.filtroEntregaEmpresa = filtro;
      this.normalizarSubdocFocusEmpresa();
    }, event);
  }

  setFiltroEntregaSubir(filtro: 'todos' | 'entregados' | 'faltantes', event?: Event): void {
    this.aplicarCambioFiltroSinSalto(() => {
      this.filtroEntregaSubir = filtro;
      this.normalizarSubdocFocusSubir();
    }, event);
  }

  setFiltroEntrega(contexto: 'empresa' | 'subir', filtro: 'todos' | 'entregados' | 'faltantes', event?: Event): void {
    if (contexto === 'subir') {
      this.setFiltroEntregaSubir(filtro, event);
      return;
    }
    this.setFiltroEntregaEmpresa(filtro, event);
  }

  seleccionarSubdocEnChecklist(subdoc: DocumentoPC, contexto: 'empresa' | 'subir'): void {
    if (contexto === 'subir') {
      this.seleccionarSubdocFocusSubir(subdoc);
      return;
    }
    this.seleccionarSubdocFocusEmpresa(subdoc);
  }

  obtenerIndiceMaestroSubdoc(subdoc: DocumentoPC, contexto: 'empresa' | 'subir'): number {
    const base = contexto === 'subir' ? this.subdocsSubirMaestroBase : this.subdocsEmpresaMaestroBase;
    const idx = base.findIndex(s => s.documento_id === subdoc.documento_id);
    return idx >= 0 ? idx + 1 : 0;
  }

  descargarListadoEstatusPdf(contexto: 'empresa' | 'subir'): void {
    const padre = contexto === 'subir' ? this.docActivoSubir : this.docActivoEmpresa;
    if (!padre?.documento_id) return;

    this.generandoListadoEstatusPdf = true;
    this.backendService.descargarListadoEstatusPipcPdf(padre.documento_id).subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = `Listado_${(padre.nombre_documento || 'PIPC').replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`;
        enlace.click();
        URL.revokeObjectURL(url);
        this.generandoListadoEstatusPdf = false;
      },
      error: () => {
        this.generandoListadoEstatusPdf = false;
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo generar el listado maestro en PDF.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  getClaseEstatusSubdoc(estatus: string): string {
    switch (estatus) {
      case 'aprobado': return 'is-approved';
      case 'rechazado': return 'is-rejected';
      case 'revision': return 'is-review';
      default: return 'is-pending';
    }
  }

  getEtiquetaEstatusSubdoc(estatus: string): string {
    switch (estatus) {
      case 'aprobado': return 'Aprobado';
      case 'rechazado': return 'Rechazado';
      case 'revision': return 'En revisión';
      default: return 'Pendiente';
    }
  }

  esSubdocArchivo(subdoc: DocumentoPC): boolean {
    return subdoc.tipo_entrada !== 'texto';
  }

  esDocumentoSoloInterno(subdoc: DocumentoPC): boolean {
    return subdoc.visible_empresa === 0 || subdoc.visible_empresa === false;
  }

  esDocumentoSolicitadoEmpresa(subdoc: DocumentoPC): boolean {
    return !this.esDocumentoSoloInterno(subdoc);
  }

  /** El encargado PC puede subir cualquier requisito (colchón); la empresa solo los suyos. */
  puedeCargarEncargadoPc(_subdoc: DocumentoPC): boolean {
    return !this.esUsuarioEmpresa;
  }

  subdocTieneEntrega(subdoc: DocumentoPC): boolean {
    if (subdoc.tipo_entrada === 'texto') {
      return !!String(subdoc.valor_texto || '').trim();
    }
    return this.getArchivosDocumento(subdoc).length > 0;
  }

  getArchivosDocumento(doc: DocumentoPC | null | undefined): ArchivoPC[] {
    if (!doc) return [];
    if (Array.isArray(doc.archivos) && doc.archivos.length > 0) {
      return doc.archivos.filter((a) => !!a && !!(a.drive_file_id || a.nombre_archivo));
    }
    if (doc.archivo_url || doc.nombre_archivo) {
      return [{
        archivo_id: null,
        documento_id: doc.documento_id,
        drive_file_id: doc.archivo_url || '',
        nombre_archivo: doc.nombre_archivo || 'archivo',
        fecha_subida: doc.fecha_subida
      }];
    }
    return [];
  }

  /** Se pueden agregar más archivos mientras el requisito no esté aprobado. */
  puedeAgregarArchivosAlRequisito(doc: DocumentoPC | null | undefined): boolean {
    return !!doc && doc.estatus !== 'aprobado';
  }

  /** Un solo archivo ya entregado/aprobado: ocupa todo el ancho del panel. */
  esPreviewArchivoUnicoCompleto(doc: DocumentoPC | null | undefined): boolean {
    return !!doc && doc.estatus === 'aprobado' && this.getArchivosDocumento(doc).length === 1;
  }

  marcarRequisitoEntregado(doc: DocumentoPC): void {
    if (!this.getArchivosDocumento(doc).length) {
      Swal.fire('Sin archivos', 'Sube al menos un archivo antes de marcar como entregado.', 'info');
      return;
    }
    this.cambiarEstatus(doc, 'aprobado');
  }

  private sincronizarCamposLegacyDesdeArchivos(doc: DocumentoPC): void {
    const archivos = this.getArchivosDocumento(doc);
    doc.archivos = archivos;
    if (!archivos.length) {
      doc.archivo_url = null;
      doc.nombre_archivo = null;
      doc.fecha_subida = null;
      return;
    }
    const principal = archivos[archivos.length - 1];
    doc.archivo_url = principal.drive_file_id || null;
    doc.nombre_archivo = principal.nombre_archivo || null;
    doc.fecha_subida = principal.fecha_subida || doc.fecha_subida;
  }

  getDrivePreviewUrlById(driveFileId: string | null | undefined): string {
    return driveFileId ? `https://drive.google.com/file/d/${driveFileId}/preview` : '';
  }

  getEtiquetaNavSubir(subdoc: DocumentoPC): string {
    if (this.esDocumentoSolicitadoEmpresa(subdoc) && !this.subdocTieneEntrega(subdoc)) {
      return 'Empresa';
    }
    return this.getEtiquetaEstatusSubdoc(subdoc.estatus);
  }

  getClaseNavSubir(subdoc: DocumentoPC): string {
    if (this.esDocumentoSolicitadoEmpresa(subdoc) && !this.subdocTieneEntrega(subdoc)) {
      return 'is-awaiting';
    }
    return this.getClaseEstatusSubdoc(subdoc.estatus);
  }

  get mostrarFiltroSubirAprobado(): boolean {
    return this.totalAprobadosSubir > 0;
  }

  get mostrarFiltroSubirRechazado(): boolean {
    return this.totalRechazadosSubir > 0;
  }

  private normalizarEstadoFiltroSubir(): void {
    if (this.estadoFiltroSubir === 'aprobado' && this.totalAprobadosSubir === 0) {
      this.estadoFiltroSubir = 'pendiente';
    }
    if (this.estadoFiltroSubir === 'rechazado' && this.totalRechazadosSubir === 0) {
      this.estadoFiltroSubir = 'pendiente';
    }
  }

  get subdocsSubirFiltradosBase(): DocumentoPC[] {
    if (!this.docActivoSubir) return [];
    const subdocs = this.docActivoSubir.subdocumentos || [];
    return subdocs
      .filter(s => !this.esSubtituloOperativo(s.nombre_documento))
      .filter(s => this.coincideFiltro(s.estatus, this.estadoFiltroSubir));
  }

  get subdocsSubirArchivosFiltrados(): DocumentoPC[] {
    return this.subdocsSubirFiltradosBase.filter(s => s.tipo_entrada !== 'texto');
  }

  get subdocsSubirTextoFiltrados(): DocumentoPC[] {
    return this.subdocsSubirFiltradosBase.filter(s => s.tipo_entrada === 'texto' && (!s.autollenado || s.estatus === 'aprobado'));
  }

  get subdocsSubirAutollenadoFiltrados(): DocumentoPC[] {
    return this.subdocsSubirFiltradosBase.filter(s => s.tipo_entrada === 'texto' && !!s.autollenado && s.estatus !== 'aprobado');
  }

  get tieneSubdocsSubirFiltrados(): boolean {
    return this.subdocsSubirMaestroBase.length > 0;
  }

  setSeccionSubirActiva(seccion: SeccionEmpresaDocumentos): void {
    this.normalizarSeccionSubirActiva(seccion);
  }

  private obtenerSeccionesSubirConContenido(): SeccionEmpresaDocumentos[] {
    const disponibles: SeccionEmpresaDocumentos[] = [];
    if (this.subdocsSubirArchivosFiltrados.length > 0) disponibles.push('archivos');
    if (this.subdocsSubirTextoFiltrados.length > 0) disponibles.push('texto');
    if (this.subdocsSubirAutollenadoFiltrados.length > 0) disponibles.push('autollenado');
    return disponibles;
  }

  private normalizarSeccionSubirActiva(preferida?: SeccionEmpresaDocumentos): void {
    const disponibles = this.obtenerSeccionesSubirConContenido();
    if (disponibles.length === 0) return;

    if (preferida && disponibles.includes(preferida)) {
      this.seccionSubirActiva = preferida;
      return;
    }

    if (!disponibles.includes(this.seccionSubirActiva)) {
      this.seccionSubirActiva = disponibles[0];
    }
  }

  estaEditandoAutollenadoSubir(doc: DocumentoPC): boolean {
    return this.autollenadoEditandoSubir.has(doc.documento_id);
  }

  activarEdicionAutollenadoSubir(doc: DocumentoPC): void {
    const docId = doc.documento_id;
    this.autollenadoOriginalSubir.set(docId, String(doc.valor_texto || ''));
    this.autollenadoEditandoSubir.add(docId);
  }

  cancelarEdicionAutollenadoSubir(doc: DocumentoPC): void {
    const docId = doc.documento_id;
    if (this.autollenadoOriginalSubir.has(docId)) {
      doc.valor_texto = this.autollenadoOriginalSubir.get(docId) || '';
    }
    this.autollenadoOriginalSubir.delete(docId);
    this.autollenadoEditandoSubir.delete(docId);
  }

  confirmarAutollenadoSubir(doc: DocumentoPC): void {
    if (!String(doc.valor_texto || '').trim()) {
      Swal.fire({
        icon: 'info',
        title: 'Sin dato autollenado',
        text: 'No hay un valor para confirmar en este campo.',
        confirmButtonColor: '#d97248'
      });
      return;
    }
    this.guardarTextoEmpresa(doc, 'confirmado');
  }

  enviarCambioAutollenadoSubir(doc: DocumentoPC): void {
    if (!String(doc.valor_texto || '').trim()) {
      Swal.fire({
        icon: 'warning',
        title: 'Campo vacío',
        text: 'Captura un valor para enviarlo a revisión.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const docId = doc.documento_id;
    const valorOriginal = String(this.autollenadoOriginalSubir.get(docId) || '').trim();
    const valorActual = String(doc.valor_texto || '').trim();
    if (valorActual === valorOriginal) {
      this.guardarTextoEmpresa(doc, 'confirmado');
      return;
    }

    this.guardarTextoEmpresa(doc, 'cambio');
  }

  estaBloqueadoTextoSubir(doc: DocumentoPC): boolean {
    if (doc.tipo_entrada !== 'texto') return false;
    const tieneTexto = !!String(doc.valor_texto || '').trim();
    if (!tieneTexto) return false;

    if (doc.autollenado) {
      return !this.estaEditandoAutollenadoSubir(doc);
    }

    return !this.textoEditandoSubir.has(doc.documento_id);
  }

  activarEdicionTextoSubir(doc: DocumentoPC): void {
    if (doc.tipo_entrada !== 'texto' || doc.autollenado) return;
    this.textoEditandoSubir.add(doc.documento_id);
  }

  get docSubirCoincideFiltro(): boolean {
    if (!this.docActivoSubir) return false;
    return this.coincideFiltro(this.docActivoSubir.estatus, this.estadoFiltroSubir);
  }

  private get totalArchivosIndividualesSubir(): number {
    let count = 0;
    for (const doc of this.documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).length;
      } else {
        count++;
      }
    }
    return count;
  }

  private get totalAprobadosIndividualesSubir(): number {
    let count = 0;
    for (const doc of this.documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'aprobado').length;
      } else if (doc.estatus === 'aprobado') {
        count++;
      }
    }
    return count;
  }

  private get totalPendientesIndividualesSubir(): number {
    let count = 0;
    for (const doc of this.documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'pendiente' || s.estatus === 'revision').length;
      } else if (doc.estatus === 'pendiente' || doc.estatus === 'revision') {
        count++;
      }
    }
    return count;
  }

  private get totalRechazadosIndividualesSubir(): number {
    let count = 0;
    for (const doc of this.documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos).filter(s => s.estatus === 'rechazado').length;
      } else if (doc.estatus === 'rechazado') {
        count++;
      }
    }
    return count;
  }

  get totalPendientesSubir(): number {
    if (!this.docActivoSubir) return 0;
    const subdocs = this.docActivoSubir.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'pendiente' || s.estatus === 'revision').length;
    }
    return (this.docActivoSubir.estatus === 'pendiente' || this.docActivoSubir.estatus === 'revision') ? 1 : 0;
  }

  get totalAprobadosSubir(): number {
    if (!this.docActivoSubir) return 0;
    const subdocs = this.docActivoSubir.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'aprobado').length;
    }
    return this.docActivoSubir.estatus === 'aprobado' ? 1 : 0;
  }

  get totalRechazadosSubir(): number {
    if (!this.docActivoSubir) return 0;
    const subdocs = this.docActivoSubir.subdocumentos;
    if (subdocs && subdocs.length > 0) {
      return this.filtrarSubdocsReales(subdocs).filter(s => s.estatus === 'rechazado').length;
    }
    return this.docActivoSubir.estatus === 'rechazado' ? 1 : 0;
  }

  // Helper: empresa_id efectivo (empresa seleccionada o empresa del usuario logueado)
  private getEmpresaIdActual(): number | null {
    if (this.esUsuarioEmpresa) {
      return this.authService.getEmpresaId();
    }
    return this.empresaSeleccionada ? this.empresaSeleccionada.empresa_id : null;
  }

  // Getters para la vista admin (basados en el array 'documentos' de la empresa seleccionada)
  get progresoDocumentos(): number {
    const total = this.totalArchivosIndividualesSubir;
    if (total === 0) return 0;
    return Math.round((this.totalAprobadosIndividualesSubir / total) * 100);
  }

  get contadorAprobados(): number {
    return this.totalAprobadosIndividualesSubir;
  }

  get contadorPendientes(): number {
    return this.totalPendientesIndividualesSubir;
  }

  get contadorEnRevision(): number {
    return this.documentos.filter(d => d.estatus === 'revision').length;
  }

  get contadorRechazados(): number {
    return this.totalRechazadosIndividualesSubir;
  }

  get contadorTotalDocumentosSubir(): number {
    return this.totalArchivosIndividualesSubir;
  }

  /** Hay documentos pendientes de carga o rechazados que corregir (vista empresa). */
  get requiereAccionSubirDocumentosEmpresa(): boolean {
    return this.documentosPendientes > 0 || this.documentosRechazados > 0;
  }

  /** Muestra la tarjeta de gestión de documentos mientras existan asignaciones (consulta, reemplazo, carga). */
  get mostrarSeccionSubirDocumentosEmpresa(): boolean {
    if (this.cargandoMisDocumentos) return false;
    return this.misDocumentos.length > 0;
  }

  get tituloSeccionDocumentosEmpresa(): string {
    return this.requiereAccionSubirDocumentosEmpresa ? 'Subir Documentos' : 'Mis documentos';
  }

  get subtituloSeccionDocumentosEmpresa(): string {
    return this.requiereAccionSubirDocumentosEmpresa
      ? 'Sube los archivos solicitados para completar tu documentación.'
      : 'Consulta lo que subiste y reemplaza archivos cuando lo necesites.';
  }

  /** Hay documentos pendientes de carga o rechazados que corregir (admin). */
  get requiereAccionSubirDocumentosAdmin(): boolean {
    return this.contadorPendientes > 0 || this.contadorRechazados > 0;
  }

  /** Muestra la vista admin de subida (en centro de operaciones siempre que haya asignación). */
  get mostrarSeccionSubirDocumentosAdmin(): boolean {
    if (this.cargandoDocumentos || this.documentos.length === 0) return false;
    if (this.vistaActual === 'menuDocumentos' && this.pasoOperacionesSeleccionado === 'documentacion') {
      return true;
    }
    return this.requiereAccionSubirDocumentosAdmin;
  }

  /** Panel Documentación Extra debajo del checklist de subida. */
  get mostrarDocumentacionExtraPc(): boolean {
    if (!this.getEmpresaIdActual()) return false;
    if (this.vistaActual === 'menuDocumentos' && this.pasoOperacionesSeleccionado === 'documentacion') {
      return this.opsDocumentacionTab === 'carga';
    }
    return this.vistaActual === 'subirDocumentos';
  }

  /** Opción del menú de empresa: visible si aún faltan documentos por completar. */
  get mostrarOpcionSubirDocumentosEnMenu(): boolean {
    if (!this.empresaSeleccionada) return false;
    if (this.documentos.length > 0) {
      return this.requiereAccionSubirDocumentosAdmin;
    }
    const totales = Number(this.empresaSeleccionada.documentos_totales) || 0;
    const completos = Number(this.empresaSeleccionada.documentos_completos) || 0;
    return totales > 0 && completos < totales;
  }

  // =====================================================
  // GESTIÓN DE EMPRESAS
  // =====================================================

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendService.obtenerEmpresasProteccionCivil().subscribe(
      (response: any) => {
        if (response.success) {
          this.empresas = response.empresas;
          this.empresasFiltradas = [...this.empresas];
          this.extraerEstadosDeBD();
          this.cargarEmpresasRecientesDesdeStorage();
          this.aplicarEstadoDesdeRuta();
        }
        this.cargandoEmpresas = false;
      },
      (error) => {
        console.error('Error al cargar empresas:', error);
        this.cargandoEmpresas = false;
        // Fallback: cargar empresas normales si no existe el endpoint específico
        this.cargarEmpresasFallback();
      }
    );
  }

  cargarEmpresasFallback(): void {
    this.backendService.obtenerEmpresas().subscribe(
      (response: any) => {
        if (response.success) {
          this.empresas = response.empresas.map((e: any) => ({
            empresa_id: e.empresa_id,
            nombre_empresa: e.nombre_empresa,
            rfc: e.rfc,
            estado: e.estado || '',
            ciudad: e.ciudad || '',
            codigo_postal: e.codigo_postal || '',
            logo: e.logo || null,
            logo_url: e.logo_url || e.logo || null,
            documentos_completos: 0,
            documentos_totales: 0,
            pasos_completados: [],
            ciclo_cerrado: false
          }));
          this.empresasFiltradas = [...this.empresas];
          this.extraerEstadosDeBD();
          this.cargarEmpresasRecientesDesdeStorage();
          this.aplicarEstadoDesdeRuta();
        }
      },
      (error) => {
        console.error('Error al cargar empresas (fallback):', error);
        Swal.fire('Error', 'No se pudieron cargar las empresas', 'error');
      }
    );
  }

  filtrarEmpresas(): void {
    let resultado = [...this.empresas];

    // Filtrar por texto de búsqueda
    if (this.textoBusquedaEmpresa && this.textoBusquedaEmpresa.trim()) {
      const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
      resultado = resultado.filter(e =>
        e.nombre_empresa.toLowerCase().includes(texto) ||
        e.rfc.toLowerCase().includes(texto)
      );
    }

    // Filtrar por estado
    if (this.estadoSeleccionado && this.estadoSeleccionado.trim()) {
      resultado = resultado.filter(e =>
        e.estado && e.estado.trim().toLowerCase() === this.estadoSeleccionado.trim().toLowerCase()
      );
    }

    // Filtrar por municipio (ciudad)
    if (this.municipioSeleccionado && this.municipioSeleccionado.trim()) {
      resultado = resultado.filter(e =>
        e.ciudad && e.ciudad.trim().toLowerCase() === this.municipioSeleccionado.trim().toLowerCase()
      );
    }

    this.empresasFiltradas = resultado;
  }

  /** Extrae los estados y municipios únicos directamente de las empresas cargadas de la BD */
  extraerEstadosDeBD(): void {
    this.estados = [...new Set(this.empresas.map(e => e.estado).filter(Boolean))].sort();
  }

  onEstadoChange(): void {
    if (this.estadoSeleccionado) {
      this.municipios = [...new Set(
        this.empresas
          .filter(e => e.estado === this.estadoSeleccionado)
          .map(e => e.ciudad)
          .filter(Boolean)
      )].sort();
      if (this.municipioSeleccionado && !this.municipios.includes(this.municipioSeleccionado)) {
        this.municipioSeleccionado = '';
      }
    } else {
      this.municipios = [];
      this.municipioSeleccionado = '';
    }

    this.filtrarEmpresas();
  }

  limpiarFiltros(): void {
    this.textoBusquedaEmpresa = '';
    this.estadoSeleccionado = '';
    this.municipioSeleccionado = '';
    this.municipios = [];
    this.empresasFiltradas = [...this.empresas];
  }

  limpiarActividadReciente(): void {
    this.empresasRecientesIds = [];
    try {
      localStorage.removeItem(this.claveEmpresasRecientesStorage());
    } catch {
      // Modo privado o storage bloqueado.
    }
  }

  get totalEmpresasDashboard(): number {
    return this.empresasFiltradas.length;
  }

  get totalEstadosDashboard(): number {
    const estadosUnicos = new Set(
      this.empresasFiltradas
        .map((e) => (e.estado || '').trim().toLowerCase())
        .filter((estado) => !!estado)
    );
    return estadosUnicos.size;
  }

  get archivosPendientesDashboard(): number {
    return this.empresasFiltradas.reduce((acumulado, empresa) => {
      const totales = Number(empresa.documentos_totales) || 0;
      const completos = Number(empresa.documentos_completos) || 0;
      return acumulado + Math.max(totales - completos, 0);
    }, 0);
  }

  get cumplimientoPromedioDashboard(): number {
    const totalAsignados = this.empresasFiltradas.reduce((acumulado, empresa) => {
      return acumulado + (Number(empresa.documentos_totales) || 0);
    }, 0);

    if (totalAsignados === 0) {
      return 0;
    }

    const totalCompletados = this.empresasFiltradas.reduce((acumulado, empresa) => {
      return acumulado + (Number(empresa.documentos_completos) || 0);
    }, 0);

    return Math.round((totalCompletados / totalAsignados) * 100);
  }

  get totalDocumentosAsignados(): number {
    return this.empresasFiltradas.reduce((acc, e) => acc + (Number(e.documentos_totales) || 0), 0);
  }

  get empresasSinDocumentos(): number {
    return this.empresasFiltradas.filter(e => (Number(e.documentos_totales) || 0) === 0).length;
  }

  get empresasActividadReciente(): EmpresaPC[] {
    const porId = new Map(this.empresas.map((empresa) => [Number(empresa.empresa_id), empresa]));
    return this.empresasRecientesIds
      .map((id) => porId.get(id))
      .filter((empresa): empresa is EmpresaPC => !!empresa);
  }

  get empresasFiltradasResto(): EmpresaPC[] {
    const recientes = new Set(this.empresasRecientesIds);
    return this.empresasFiltradas.filter((empresa) => !recientes.has(Number(empresa.empresa_id)));
  }

  get hayActividadRecienteEmpresas(): boolean {
    return !this.cargandoEmpresas && this.empresasActividadReciente.length > 0;
  }

  private claveEmpresasRecientesStorage(): string {
    const usuario = this.authService.getUsuario();
    const userId = Number(usuario?.id || this.authService.getUsuarioId() || 0);
    if (userId > 0) {
      return `${this.PC_EMPRESAS_RECIENTES_KEY}_empleado_${userId}`;
    }

    const identificador = String(
      usuario?.correo || usuario?.usuario || this.authService.getUsername() || ''
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_');

    return identificador
      ? `${this.PC_EMPRESAS_RECIENTES_KEY}_empleado_${identificador}`
      : `${this.PC_EMPRESAS_RECIENTES_KEY}_empleado_anonimo`;
  }

  private cargarEmpresasRecientesDesdeStorage(): void {
    try {
      const raw = localStorage.getItem(this.claveEmpresasRecientesStorage());
      const parsed = raw ? JSON.parse(raw) : [];
      this.empresasRecientesIds = Array.isArray(parsed)
        ? parsed.map((id) => Number(id)).filter((id) => id > 0).slice(0, this.PC_EMPRESAS_RECIENTES_MAX)
        : [];
    } catch {
      this.empresasRecientesIds = [];
    }
  }

  private registrarEmpresaReciente(empresaId: number): void {
    const id = Number(empresaId);
    if (!id) {
      return;
    }

    const actualizadas = [id, ...this.empresasRecientesIds.filter((item) => item !== id)]
      .slice(0, this.PC_EMPRESAS_RECIENTES_MAX);
    this.empresasRecientesIds = actualizadas;

    try {
      localStorage.setItem(this.claveEmpresasRecientesStorage(), JSON.stringify(actualizadas));
    } catch {
      // Sin espacio o modo privado: la sesión actual sigue funcionando.
    }
  }

  private readonly pasosCentroOperacionesDef: PasoCentroOperaciones[] = [
    { id: 'asignar', nombre: 'Asignar documentos', descripcion: '', icono: 'fa-tasks', orden: 1 },
    { id: 'recorrido', nombre: 'Reporte de Recorrido', descripcion: 'Opcional: SP-F-02 por cada PIPC asignado', icono: 'fa-route', orden: 2 },
    { id: 'documentacion', nombre: 'Subir documentación', descripcion: '', icono: 'fa-cloud-upload-alt', orden: 3 },
    { id: 'oficio', nombre: 'Oficio de Ingreso', descripcion: 'Oficio y fecha por cada PIPC asignado', icono: 'fa-file-signature', orden: 4 },
    { id: 'observaciones', nombre: 'Observaciones', descripcion: 'Opcional: 2 oficios y fecha por PIPC', icono: 'fa-comment-dots', orden: 5 },
    { id: 'resolutivo', nombre: 'Resolutivo', descripcion: 'PIPC, Factibilidad y OTMS por cada PIPC', icono: 'fa-gavel', orden: 6 },
    { id: 'finalizar', nombre: 'Finalizar', descripcion: 'Cierra el ciclo y permite nueva asignación', icono: 'fa-flag-checkered', orden: 7 }
  ];

  /** Pasos que sí cuentan para el 100% del trámite. Recorrido y observaciones son opcionales. */
  private readonly pcPasosRequeridosTramite: PasoCentroOperacionesId[] = ['asignar', 'documentacion', 'oficio', 'resolutivo'];
  private readonly pcPasosTramitePendientes: Array<{ id: PasoCentroOperacionesId; label: string; opcional: boolean }> = [
    { id: 'recorrido', label: 'Reporte de Recorrido', opcional: true },
    { id: 'oficio', label: 'Oficio de Ingreso', opcional: false },
    { id: 'observaciones', label: 'Observaciones', opcional: true },
    { id: 'resolutivo', label: 'Resolutivo', opcional: false }
  ];
  private readonly pcPasosProcesoIds: PasoCentroOperacionesId[] = [
    'asignar', 'recorrido', 'documentacion', 'oficio', 'observaciones', 'resolutivo', 'finalizar'
  ];

  get pasosCentroOperaciones(): PasoCentroOperaciones[] {
    return this.pasosCentroOperacionesDef;
  }

  isOpsPasoCompletado(id: PasoCentroOperacionesId): boolean {
    return this.opsPasosCompletados.includes(id);
  }

  isOpsPasoMarcadoCompleto(id: PasoCentroOperacionesId): boolean {
    if (id === 'asignar') {
      return this.opsPasoAsignarCompleto;
    }
    return this.isOpsPasoCompletado(id);
  }

  seleccionarPasoOperaciones(id: PasoCentroOperacionesId): void {
    this.pasoOperacionesSeleccionado = id;
    this.asegurarPasoOperacionesSeleccionadoValido();
    if (!this.empresaSeleccionada) {
      return;
    }
    if (id === 'documentacion') {
      this.cargarDocumentosEmpresa(this.empresaSeleccionada.empresa_id);
      this.cargarPcDocumentacionExtra();
    }
  }

  seleccionarTabDocumentacionOps(tab: 'carga' | 'revision'): void {
    this.opsDocumentacionTab = tab;
    if (tab === 'carga') {
      this.busquedaSubir = '';
      this.normalizarSubdocFocusSubir();
      this.cargarPcDocumentacionExtra();
    }
  }

  /** Documentos/subdocs en estatus revision (entregados por la empresa). */
  get entregasEnRevisionAdmin(): number {
    let count = 0;
    for (const doc of this.documentos) {
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        count += this.filtrarSubdocsReales(doc.subdocumentos)
          .filter(s => !this.esDocumentoSoloInterno(s))
          .filter(s => s.estatus === 'revision').length;
      } else if (!this.esDocumentoSoloInterno(doc) && doc.estatus === 'revision') {
        count++;
      }
    }
    return count;
  }

  onRevisionCentroOpsActualizada(): void {
    if (!this.empresaSeleccionada) return;
    this.cargarDocumentosEmpresa(this.empresaSeleccionada.empresa_id);
    this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
  }

  getPorcentajeProgresoOperaciones(): number {
    const total = this.pasosCentroOperacionesDef.length;
    if (total <= 1) return 0;
    const completados = this.opsPasosCompletados.length;
    return (completados / (total - 1)) * 100;
  }

  get opsProgresoCentroPorcentaje(): number {
    const total = this.pcPasosRequeridosTramite.length;
    if (!total) return 0;
    const completados = this.pcPasosRequeridosTramite.filter((paso) => this.isOpsPasoRequeridoCompleto(paso)).length;
    return Math.round((completados / total) * 100);
  }

  private isOpsPasoRequeridoCompleto(paso: PasoCentroOperacionesId): boolean {
    if (paso === 'documentacion') {
      return this.isOpsPasoCompletado('documentacion') || this.docsSeleccionadosCompletos;
    }
    return this.isOpsPasoMarcadoCompleto(paso);
  }

  get docsSeleccionadosCompletos(): boolean {
    if (!this.empresaSeleccionada) return false;
    return this.getProgresoDocumentos(this.empresaSeleccionada) === 100;
  }

  get opsPendientesTramite(): Array<{ id: PasoCentroOperacionesId; label: string; opcional: boolean }> {
    return this.pcPasosTramitePendientes.filter((item) => !this.isOpsPasoCompletado(item.id));
  }

  get opsMostrarPendientesTramite(): boolean {
    return this.docsSeleccionadosCompletos
      && this.opsPendientesTramite.some((item) => !item.opcional)
      && !this.opsCicloCerrado;
  }

  get opsTextoPendientesTramite(): string {
    return this.formatearPendientesTramite(this.opsPendientesTramite);
  }

  get opsEmpresaUbicacion(): string {
    if (!this.empresaSeleccionada) return '';
    return [this.empresaSeleccionada.ciudad, this.empresaSeleccionada.estado]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  get opsPasoSeleccionadoData(): PasoCentroOperaciones | undefined {
    return this.pasosCentroOperacionesDef.find((p) => p.id === this.pasoOperacionesSeleccionado);
  }

  cargarCentroOperaciones(empresaId: number, onLoaded?: () => void): void {
    this.opsCargandoEstado = true;
    this.backendService.obtenerCentroOperacionesPC(empresaId).subscribe({
      next: (resp: any) => {
        if (resp?.success) {
          this.opsPasosCompletados = (resp.ciclo?.pasos_completados || []) as PasoCentroOperacionesId[];
          this.opsCicloCerrado = !!resp.ciclo?.ciclo_cerrado;
          this.opsFechaIngresoTramite = this.formatFechaInput(resp.ciclo?.fecha_ingreso_tramite);
          this.opsFechaOficioObservaciones = this.formatFechaInput(resp.ciclo?.fecha_oficio_observaciones);
          this.opsFechaAprobacionPipc = this.formatFechaInput(resp.ciclo?.fecha_aprobacion_pipc);
          this.opsFechaAprobacionFactibilidad = this.formatFechaInput(resp.ciclo?.fecha_aprobacion_factibilidad);
          this.opsFechaAprobacionOtms = this.formatFechaInput(resp.ciclo?.fecha_aprobacion_otms);
          this.opsFechasWorkflow = {};
          const fechasWf = resp.ciclo?.fechas_workflow || {};
          if (fechasWf && typeof fechasWf === 'object') {
            for (const [k, v] of Object.entries(fechasWf)) {
              this.opsFechasWorkflow[k] = this.formatFechaInput(v as string);
            }
          }
          this.opsArchivosWorkflow = resp.archivos_workflow || {};
          this.opsPuedeCompletar = resp.puede_completar || {};
          this.opsObservacionesOmitible = !!resp.observaciones_omitible;
          this.opsPipcCobertura = resp.pipc_cobertura || null;
          this.opsPipcAsignados = (Array.isArray(resp.pipc_asignados) ? resp.pipc_asignados : []).map((p: any) => {
            const id = Number(p.documento_id);
            return {
              ...p,
              clave_oficio: p.clave_oficio || `ops_oficio_${id}`,
              clave_obs_1: p.clave_obs_1 || p.clave_obs || `ops_obs1_${id}`,
              clave_obs_2: p.clave_obs_2 || `ops_obs2_${id}`,
              clave_fecha_obs: p.clave_fecha_obs || `ops_obs_${id}`,
              clave_resolutivo_pipc: p.clave_resolutivo_pipc || p.clave_resolutivo || `ops_resolutivo_pipc_${id}`,
              clave_resolutivo_factibilidad: p.clave_resolutivo_factibilidad || `ops_resolutivo_factibilidad_${id}`,
              clave_resolutivo_otms: p.clave_resolutivo_otms || `ops_resolutivo_otms_${id}`
            } as PcPipcAsignadoOps;
          });
          // Migración suave de fechas globales → por PIPC (solo en UI local)
          if (this.opsFechaIngresoTramite) {
            for (const pipc of this.opsPipcAsignados) {
              if (!this.opsFechasWorkflow[pipc.clave_oficio]) {
                this.opsFechasWorkflow[pipc.clave_oficio] = this.opsFechaIngresoTramite;
              }
            }
          }
          if (this.opsFechaOficioObservaciones) {
            for (const pipc of this.opsPipcAsignados) {
              if (!this.opsFechasWorkflow[pipc.clave_fecha_obs]) {
                this.opsFechasWorkflow[pipc.clave_fecha_obs] = this.opsFechaOficioObservaciones;
              }
            }
          }
          this.asegurarPreviewsWorkflow();
        }
        this.opsCargandoEstado = false;
        this.asegurarPasoOperacionesSeleccionadoValido();
        onLoaded?.();
      },
      error: () => {
        this.opsCargandoEstado = false;
      }
    });
  }

  private formatFechaInput(valor: string | null | undefined): string {
    if (!valor) return '';
    const s = String(valor);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().substring(0, 10);
  }

  /** Completo con ≥1 PIPC asignado; no bloquea seguir gestionando. */
  get opsPasoAsignarCompleto(): boolean {
    return Number(this.opsPipcCobertura?.total_asignadas || 0) > 0
      || this.isOpsPasoCompletado('asignar')
      || this.opsPipcAsignados.length > 0;
  }

  /** Mantener hint de “agregar requisitos” (omite correo) sin impedir gestión. */
  get opsPasoAsignarBloqueado(): boolean {
    return this.opsPasoAsignarCompleto;
  }

  get opsPasoAsignarEtiqueta(): 'COMPLETADO' | 'PENDIENTE' {
    if (this.pasoOperacionesSeleccionado === 'asignar') {
      return this.opsPasoAsignarCompleto ? 'COMPLETADO' : 'PENDIENTE';
    }
    return this.isOpsPasoCompletado(this.pasoOperacionesSeleccionado) ? 'COMPLETADO' : 'PENDIENTE';
  }

  onAsignacionGuardadaCentroOps(): void {
    if (!this.empresaSeleccionada) return;
    const empresaId = this.empresaSeleccionada.empresa_id;
    this.opsRefreshAsignaciones += 1;
    this.opsRefreshRecorrido += 1;
    this.cargarDocumentosEmpresa(empresaId);
    this.cargarCentroOperaciones(empresaId, () => {
      if (this.opsPasoAsignarCompleto && !this.isOpsPasoCompletado('asignar')) {
        this.completarPasoOperaciones('asignar', true);
      }
      if (this.opsPasoAsignarCompleto && !this.isOpsPasoCompletado('documentacion')
          && this.pasoOperacionesSeleccionado === 'asignar') {
        this.seleccionarPasoOperaciones('documentacion');
      }
    });
  }

  onRecorridoActualizadoCentroOps(): void {
    if (!this.empresaSeleccionada) return;
    const empresaId = this.empresaSeleccionada.empresa_id;
    this.cargarCentroOperaciones(empresaId);
  }

  onResponsablePipcActualizado(event: { usuario_id: number | null; nombre: string | null }): void {
    if (!this.empresaSeleccionada) return;

    const empresaId = this.empresaSeleccionada.empresa_id;
    this.empresaSeleccionada = {
      ...this.empresaSeleccionada,
      responsable_pipc_usuario_id: event?.usuario_id ?? null,
      responsable_pipc_nombre: event?.nombre ?? null
    };

    const idx = this.empresas.findIndex((e) => e.empresa_id === empresaId);
    if (idx >= 0) {
      this.empresas[idx] = {
        ...this.empresas[idx],
        responsable_pipc_usuario_id: event?.usuario_id ?? null,
        responsable_pipc_nombre: event?.nombre ?? null
      };
      this.empresas = [...this.empresas];
    }
  }

  solicitarDesbloqueoPasoAsignar(): void {
    this.desbloquearPasoOperaciones('asignar');
  }

  completarPasoOperaciones(paso: PasoCentroOperacionesId, silencioso = false): void {
    if (!this.empresaSeleccionada) return;
    this.backendService.completarPasoCentroOperacionesPC(this.empresaSeleccionada.empresa_id, paso).subscribe({
      next: (resp: any) => {
        if (resp?.success) {
          this.opsPasosCompletados = resp.pasos_completados || [];
          this.cargarCentroOperaciones(this.empresaSeleccionada!.empresa_id);
          if (!silencioso) {
            Swal.fire({ icon: 'success', title: 'Paso completado', timer: 1400, showConfirmButton: false });
          }
          this.avanzarAlSiguientePasoOps(paso);
        }
      },
      error: (err) => {
        Swal.fire({
          icon: 'warning',
          title: 'No se puede completar',
          text: err?.error?.message || 'Revisa los requisitos del paso.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  private avanzarAlSiguientePasoOps(pasoActual: PasoCentroOperacionesId): void {
    const idx = this.pasosCentroOperacionesDef.findIndex((p) => p.id === pasoActual);
    const siguiente = this.pasosCentroOperacionesDef[idx + 1];
    if (siguiente) {
      this.seleccionarPasoOperaciones(siguiente.id);
    }
  }

  desbloquearPasoOperaciones(paso: PasoCentroOperacionesId): void {
    if (!this.empresaSeleccionada) return;
    this.backendService.desbloquearPasoCentroOperacionesPC(this.empresaSeleccionada.empresa_id, paso).subscribe({
      next: (resp: any) => {
        if (resp?.success) {
          this.opsPasosCompletados = resp.pasos_completados || [];
        }
      }
    });
  }

  private readonly camposFechaResolutivoOps = new Set([
    'fecha_aprobacion_pipc',
    'fecha_aprobacion_factibilidad',
    'fecha_aprobacion_otms'
  ]);

  private esCampoFechaResolutivoDinamico(campo: string): boolean {
    return /^fecha_resolutivo_(pipc|factibilidad|otms)_\d+$/.test(campo)
      || /^fecha_resolutivo_\d+$/.test(campo);
  }

  fechaOficioCampo(pipc: PcPipcAsignadoOps): string {
    return `fecha_oficio_${pipc.documento_id}`;
  }

  fechaObsCampo(pipc: PcPipcAsignadoOps): string {
    return `fecha_obs_${pipc.documento_id}`;
  }

  fechaResolutivoTipoCampo(pipc: PcPipcAsignadoOps, tipo: PcResolutivoTipoUi['tipo']): string {
    return `fecha_resolutivo_${tipo}_${pipc.documento_id}`;
  }

  getFechaWorkflow(clave: string): string {
    return this.opsFechasWorkflow[clave] || '';
  }

  claveResolutivoDePipc(pipc: PcPipcAsignadoOps, tipoUi: PcResolutivoTipoUi): string {
    return pipc[tipoUi.claveKey];
  }

  /** Corrige mojibake típico (auditorÃ­a → auditoría) al mostrar nombres. */
  nombreArchivoLegible(nombre: string | null | undefined): string {
    const original = String(nombre || '').trim();
    if (!original) return '';
    if (/Ã.|Â./.test(original)) {
      try {
        const bytes = new Uint8Array([...original].map((ch) => ch.charCodeAt(0) & 0xff));
        const reparado = new TextDecoder('utf-8').decode(bytes);
        if (reparado && reparado !== original) return reparado;
      } catch { /* ignore */ }
    }
    return original;
  }

  guardarFechaCentroOps(campo: string, valor: string): void {
    if (!this.empresaSeleccionada) return;
    const valorNorm = (valor || '').trim();
    if (!valorNorm && campo === 'fecha_ingreso_tramite') return;

    this.opsGuardandoFecha = campo;
    this.backendService.guardarFechaCentroOperacionesPC(this.empresaSeleccionada.empresa_id, campo, valorNorm).subscribe({
      next: (resp: any) => {
        this.opsGuardandoFecha = null;
        if (campo === 'fecha_ingreso_tramite') this.opsFechaIngresoTramite = valorNorm;
        if (campo === 'fecha_oficio_observaciones') this.opsFechaOficioObservaciones = valorNorm;
        if (campo === 'fecha_aprobacion_pipc') this.opsFechaAprobacionPipc = valorNorm;
        if (campo === 'fecha_aprobacion_factibilidad') this.opsFechaAprobacionFactibilidad = valorNorm;
        if (campo === 'fecha_aprobacion_otms') this.opsFechaAprobacionOtms = valorNorm;

        let m = campo.match(/^fecha_oficio_(\d+)$/);
        if (m) this.opsFechasWorkflow[`ops_oficio_${m[1]}`] = valorNorm;
        m = campo.match(/^fecha_obs_(\d+)$/);
        if (m) this.opsFechasWorkflow[`ops_obs_${m[1]}`] = valorNorm;
        m = campo.match(/^fecha_resolutivo_(pipc|factibilidad|otms)_(\d+)$/);
        if (m) this.opsFechasWorkflow[`ops_resolutivo_${m[1]}_${m[2]}`] = valorNorm;

        this.cargarCentroOperaciones(this.empresaSeleccionada!.empresa_id);
        const syncFecha =
          this.camposFechaResolutivoOps.has(campo) || this.esCampoFechaResolutivoDinamico(campo);
        if (syncFecha && (resp?.resolutivos_sincronizados ?? 0) === 0) {
          this.intentarSincronizarResolutivosOps();
        }
      },
      error: (err) => {
        this.opsGuardandoFecha = null;
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: err?.error?.message || 'No se pudo guardar la fecha.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  /** Persiste en pc_control_resolutivos los slots con archivo + fechas completas */
  private intentarSincronizarResolutivosOps(): void {
    if (!this.empresaSeleccionada) return;
    this.backendService.sincronizarResolutivosCentroOperacionesPC(this.empresaSeleccionada.empresa_id).subscribe({
      error: (err) => {
        console.warn('[PC-OPS] Sync resolutivos:', err?.error?.message || err);
      }
    });
  }

  onArchivoWorkflowSeleccionado(event: Event, clave: PcWorkflowClave): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.empresaSeleccionada) return;

    const doc = this.opsArchivosWorkflow[clave];
    if (!doc?.documento_id) return;

    if (!this.esArchivoPermitidoPC(file)) {
      input.value = '';
      Swal.fire({
        icon: 'error',
        title: 'Archivo no permitido',
        text: 'Cámbialo por uno de los formatos aceptados: imágenes, PDF, Excel (XLS/XLSX) o PowerPoint (PPT/PPTX).',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    if (file.size > this.maxPcFileBytes) {
      input.value = '';
      Swal.fire({
        icon: 'error',
        title: 'Archivo muy pesado',
        text: `El archivo supera el tamaño máximo de ${this.maxPcFileMb} MB. Prueba con uno más ligero o comprímelo.`,
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const formData = new FormData();
    formData.append('archivo', file);
    formData.append('documento_id', String(doc.documento_id));
    formData.append('empresa_id', String(this.empresaSeleccionada.empresa_id));

    this.opsSubiendoWorkflow = clave;
    Swal.fire({
      title: 'Subiendo archivo...',
      html: 'Se está subiendo el archivo, espere unos segundos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendService.subirArchivoProteccionCivil(formData).subscribe({
      next: (resp: any) => {
        Swal.close();
        this.opsSubiendoWorkflow = null;
        input.value = '';
        if (resp?.success && doc) {
          const actual = this.opsArchivosWorkflow[clave] || doc;
          this.opsArchivosWorkflow[clave] = {
            ...actual,
            archivo_url: resp.url || resp.drive_file_id || actual.archivo_url,
            nombre_archivo: resp.nombre_archivo || file.name,
            fecha_subida: new Date().toISOString()
          };
        } else if (!resp?.success) {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo subir',
            text: this.traducirErrorSubidaPC(null, resp?.message),
            confirmButtonColor: '#d97248'
          });
          return;
        }
        this.cargarCentroOperaciones(this.empresaSeleccionada!.empresa_id);
        if (this.pasoOperacionesSeleccionado === 'documentacion') {
          this.cargarDocumentosEmpresa(this.empresaSeleccionada!.empresa_id);
        }
        if (String(clave).startsWith('ops_resolutivo_')) {
          this.intentarSincronizarResolutivosOps();
        }
      },
      error: (error) => {
        Swal.close();
        this.opsSubiendoWorkflow = null;
        input.value = '';
        Swal.fire({
          icon: 'error',
          title: 'No se pudo subir',
          text: this.traducirErrorSubidaPC(error),
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  estaSubiendoWorkflow(clave?: PcWorkflowClave): boolean {
    if (!clave) return this.opsSubiendoWorkflow !== null;
    return this.opsSubiendoWorkflow === clave;
  }

  estaSubiendoEnPasoWorkflow(): boolean {
    return this.opsSubiendoWorkflow !== null;
  }

  tieneWorkflowArchivo(clave: PcWorkflowClave): boolean {
    const a = this.opsArchivosWorkflow[clave];
    return !!(a?.archivo_url || a?.nombre_archivo);
  }

  workflowArchivoAComoDoc(clave: PcWorkflowClave): DocumentoPC {
    const a = this.opsArchivosWorkflow[clave];
    return {
      documento_id: a?.documento_id || 0,
      nombre_documento: a?.nombre_documento || '',
      nombre_archivo: a?.nombre_archivo || null,
      archivo_url: a?.archivo_url || null,
      especificacion: '',
      obligatorio: false,
      estatus: (a?.estatus as DocumentoPC['estatus']) || 'aprobado',
      comentarios: null,
      fecha_subida: a?.fecha_subida || null
    };
  }

  visualizarWorkflowArchivo(clave: PcWorkflowClave): void {
    this.visualizarDocumento(this.workflowArchivoAComoDoc(clave));
  }

  private etiquetaWorkflowArchivo(clave: PcWorkflowClave): string {
    const pipc = this.opsPipcAsignados.find(
      (p) =>
        p.clave_oficio === clave ||
        p.clave_obs_1 === clave ||
        p.clave_obs_2 === clave ||
        p.clave_resolutivo_pipc === clave ||
        p.clave_resolutivo_factibilidad === clave ||
        p.clave_resolutivo_otms === clave
    );
    if (pipc) {
      if (clave === pipc.clave_oficio) return `Oficio de ingreso — ${pipc.nombre_documento}`;
      if (clave === pipc.clave_obs_1) return `Observaciones 1 — ${pipc.nombre_documento}`;
      if (clave === pipc.clave_obs_2) return `Observaciones 2 — ${pipc.nombre_documento}`;
      if (clave === pipc.clave_resolutivo_pipc) return `Resolutivo PIPC — ${pipc.nombre_documento}`;
      if (clave === pipc.clave_resolutivo_factibilidad) return `Resolutivo Factibilidad — ${pipc.nombre_documento}`;
      if (clave === pipc.clave_resolutivo_otms) return `Resolutivo OTMS — ${pipc.nombre_documento}`;
    }
    return this.opsArchivosWorkflow[clave]?.nombre_documento || clave;
  }

  eliminarArchivoWorkflow(clave: PcWorkflowClave): void {
    if (!this.empresaSeleccionada || !this.tieneWorkflowArchivo(clave)) return;
    const doc = this.opsArchivosWorkflow[clave];
    if (!doc?.documento_id) return;

    const nombreArchivo = doc.nombre_archivo || this.etiquetaWorkflowArchivo(clave);
    Swal.fire({
      title: '¿Eliminar documento?',
      html: `<p>Se eliminará el archivo <strong>${nombreArchivo}</strong> de <strong>${this.etiquetaWorkflowArchivo(clave)}</strong>.</p><p class="text-muted small mb-0">Podrás volver a subir uno nuevo después.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      Swal.fire({
        title: 'Eliminando...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
      });

      this.backendService.eliminarArchivoProteccionCivil(
        this.empresaSeleccionada!.empresa_id,
        doc.documento_id
      ).subscribe({
        next: (resp: any) => {
          Swal.close();
          if (resp?.success) {
            this.cargarCentroOperaciones(this.empresaSeleccionada!.empresa_id, () => {
              this.asegurarPreviewsWorkflow();
            });
            Swal.fire({
              icon: 'success',
              title: 'Documento eliminado',
              timer: 1800,
              showConfirmButton: false
            });
          } else {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: resp?.message || 'No se pudo eliminar el documento.',
              confirmButtonColor: '#d97248'
            });
          }
        },
        error: () => {
          Swal.close();
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo eliminar el documento.',
            confirmButtonColor: '#d97248'
          });
        }
      });
    });
  }

  seleccionarOficioPreview(clave: PcWorkflowClave): void {
    this.opsOficioPreviewClave = clave;
  }

  seleccionarObsPreview(clave: PcWorkflowClave): void {
    this.opsObsPreviewClave = clave;
  }

  private asegurarPreviewsWorkflow(): void {
    if (this.opsPipcAsignados.length) {
      const oficios = this.opsPipcAsignados.map((p) => p.clave_oficio);
      if (!this.opsOficioPreviewClave || !oficios.includes(this.opsOficioPreviewClave)) {
        const conArchivo = oficios.find((c) => this.tieneWorkflowArchivo(c));
        this.opsOficioPreviewClave = conArchivo || oficios[0];
      }
      const obs = this.opsPipcAsignados.flatMap((p) => [p.clave_obs_1, p.clave_obs_2]);
      if (!this.opsObsPreviewClave || !obs.includes(this.opsObsPreviewClave)) {
        const conArchivo = obs.find((c) => this.tieneWorkflowArchivo(c));
        this.opsObsPreviewClave = conArchivo || obs[0];
      }
    } else {
      this.opsOficioPreviewClave = 'ops_oficio_ingreso';
      this.opsObsPreviewClave = 'ops_observacion_1';
    }
  }

  get opsObservacionesIniciadas(): boolean {
    if (this.opsPipcAsignados.length) {
      return this.opsPipcAsignados.some(
        (p) =>
          this.tieneWorkflowArchivo(p.clave_obs_1) ||
          this.tieneWorkflowArchivo(p.clave_obs_2) ||
          !!this.getFechaWorkflow(p.clave_fecha_obs)
      );
    }
    return !!(
      this.opsArchivosWorkflow.ops_observacion_1?.archivo_url ||
      this.opsArchivosWorkflow.ops_observacion_2?.archivo_url ||
      this.opsFechaOficioObservaciones
    );
  }

  trackByPipcAsignado(_index: number, pipc: PcPipcAsignadoOps): number {
    return pipc.documento_id;
  }

  async cerrarCicloCentroOperaciones(): Promise<void> {
    if (!this.empresaSeleccionada) return;

    const faltantes = ['asignar', 'documentacion', 'oficio', 'resolutivo'].filter(
      (p) => !this.isOpsPasoCompletado(p as PasoCentroOperacionesId)
    );
    if (faltantes.length) {
      await Swal.fire({
        icon: 'warning',
        title: 'No se puede finalizar',
        html: '<p>Completa los pasos obligatorios: Asignar, Subir documentación, Oficio de Ingreso y Resolutivo.</p>',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const result = await Swal.fire({
      title: '¿Finalizar ciclo PIPC?',
      text: 'El expediente se guardará en Historial PC y podrás iniciar un nuevo trámite para esta empresa.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#2dce89',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, finalizar'
    });

    if (!result.isConfirmed) return;

    this.backendService.cerrarCicloCentroOperacionesPC(this.empresaSeleccionada.empresa_id).subscribe({
      next: async (resp: any) => {
        if (resp?.success) {
          await Swal.fire({
            icon: 'success',
            title: 'Ciclo finalizado',
            text: resp.message || 'Ya puedes iniciar una nueva asignación.',
            confirmButtonColor: '#d97248'
          });
          this.opsPasosCompletados = [];
          this.pasoOperacionesSeleccionado = 'asignar';
          this.cargarEmpresas();
          this.cargarCentroOperaciones(this.empresaSeleccionada!.empresa_id);
          this.cargarDocumentosEmpresa(this.empresaSeleccionada!.empresa_id);
        }
      },
      error: (err) => {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: err?.error?.message || 'No se pudo cerrar el ciclo.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  private estaEnSubirDocumentosOperaciones(): boolean {
    return (this.vistaActual === 'menuDocumentos' && this.pasoOperacionesSeleccionado === 'documentacion')
      || this.vistaActual === 'subirDocumentos';
  }

  private asegurarPasoOperacionesSeleccionadoValido(): void {
    const pasos = this.pasosCentroOperaciones;
    if (!pasos.some((paso) => paso.id === this.pasoOperacionesSeleccionado)) {
      this.pasoOperacionesSeleccionado = pasos[0]?.id ?? 'asignar';
    }
  }

  seleccionarEmpresa(empresa: EmpresaPC): void {
    this.registrarEmpresaReciente(empresa.empresa_id);
    this.empresaSeleccionada = empresa;
    this.pcDocsExtraCarpetasExpandidas = new Set();
    this.pcDocsExtraSeleccionados = [];
    this.pcDocsExtraRaizInicializada = false;
    this.limpiarMiniaturasPcExtra();
    this.pasoOperacionesSeleccionado = 'asignar';
    this.vistaActual = 'menuDocumentos';
    this.cargarCentroOperaciones(empresa.empresa_id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        vista: 'menuDocumentos',
        empresaId: empresa.empresa_id
      },
      queryParamsHandling: 'merge'
    });
  }

  irAAsignarDocumentos(): void {
    if (!this.empresaSeleccionada) return;
    this.router.navigate(['/proteccion-civil/empresas', this.empresaSeleccionada.empresa_id, 'asignar-documentos']);
  }

  irARevisarDocumentos(): void {
    if (!this.empresaSeleccionada) return;
    this.vistaActual = 'revisarDocumentos';
    this.cargarDocumentosEmpresa(this.empresaSeleccionada.empresa_id);
  }

  irARevisarDocumentosRuta(): void {
    if (!this.empresaSeleccionada) return;
    this.router.navigate([
      '/proteccion-civil/empresas',
      this.empresaSeleccionada.empresa_id,
      'revisar-documentos'
    ]);
  }

  irAHistorialDocumentos(): void {
    if (!this.empresaSeleccionada) return;
    this.router.navigate([
      '/proteccion-civil/empresas',
      this.empresaSeleccionada.empresa_id,
      'historial-documentos'
    ]);
  }

  irASubirDocumentos(): void {
    if (!this.empresaSeleccionada) return;
    this.vistaActual = 'menuDocumentos';
    this.pasoOperacionesSeleccionado = 'documentacion';
    this.cargarDocumentosEmpresa(this.empresaSeleccionada.empresa_id);
    this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
    this.cargarPcDocumentacionExtra();
  }

  volverAMenuDocumentos(): void {
    this.vistaActual = 'menuDocumentos';
    this.documentos = [];
  }

  volverAEmpresas(): void {
    this.vistaActual = 'empresas';
    this.empresaSeleccionada = null;
    this.documentos = [];
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        vista: null,
        empresaId: null,
        paso: null,
        documentoId: null
      },
      queryParamsHandling: 'merge'
    });
    this.cargarEmpresas(); // Recargar para actualizar conteos
    if (this.puedeVerGraficaActividadResolutivosPipc) {
      this.cargarEstadisticasResolutivos();
    }
  }

  private aplicarEstadoDesdeRuta(): void {
    const vista = this.route.snapshot.queryParamMap.get('vista');
    const empresaIdParam = this.route.snapshot.queryParamMap.get('empresaId');
    const paso = this.route.snapshot.queryParamMap.get('paso');
    const documentoIdParam = this.route.snapshot.queryParamMap.get('documentoId');
    const empresaId = empresaIdParam ? Number(empresaIdParam) : null;
    const documentoId = documentoIdParam ? Number(documentoIdParam) : null;
    if (Number.isFinite(documentoId) && documentoId > 0) {
      this.documentoIdPendienteVisor = documentoId;
    }

    const abrirEmpresa = empresaId && (vista === 'menuDocumentos' || this.documentoIdPendienteVisor);
    if (abrirEmpresa) {
      const empresa = this.empresas.find((item) => Number(item.empresa_id) === empresaId);
      if (empresa) {
        this.registrarEmpresaReciente(empresaId);
        this.empresaSeleccionada = empresa;
        this.pasoOperacionesSeleccionado =
          paso === 'documentacion' || this.documentoIdPendienteVisor ? 'documentacion' : 'asignar';
        this.vistaActual = 'menuDocumentos';
        this.cargarCentroOperaciones(empresaId);
        if (paso === 'documentacion' || this.documentoIdPendienteVisor) {
          this.cargarDocumentosEmpresa(empresaId);
        }
        this.asegurarPasoOperacionesSeleccionadoValido();
      }
    }
  }

  private intentarAbrirDocumentoDesdeBusqueda(): void {
    const id = this.documentoIdPendienteVisor;
    if (!id) {
      return;
    }
    const docEncontrado = this.encontrarDocumentoPcPorId(id);
    if (!docEncontrado) {
      return;
    }
    let doc = docEncontrado;
    if (!doc.archivo_url && !doc.nombre_archivo && doc.subdocumentos?.length) {
      const conArchivo = doc.subdocumentos.find((s) => s.archivo_url || s.nombre_archivo);
      if (conArchivo) {
        doc = conArchivo;
      }
    }
    this.documentoIdPendienteVisor = null;
    this.visualizarDocumento(doc);
  }

  private encontrarDocumentoPcPorId(id: number): DocumentoPC | null {
    const cola = [...(this.documentos || [])];
    while (cola.length) {
      const actual = cola.shift()!;
      if (Number(actual.documento_id) === id) {
        return actual;
      }
      if (actual.subdocumentos?.length) {
        cola.push(...actual.subdocumentos);
      }
    }
    return null;
  }

  // =====================================================
  // GESTIÓN DE DOCUMENTOS
  // =====================================================

  cargarDocumentosEmpresa(empresaId: number): void {
    this.cargandoDocumentos = true;
    this.docActivoSubir = null;
    this.backendService.obtenerDocumentosProteccionCivil(empresaId).subscribe(
      (response: any) => {
        if (response.success) {
          this.documentos = this.ordenarDocumentosEmpresa(response.documentos || []);
        }
        const primerRechazado = this.documentos.find(d => this.esDocRechazadoReal(d));
        const primerConSubdocs = this.documentos.find(d => (d.subdocumentos?.length || 0) > 0);
        this.docActivoSubir = primerRechazado ?? primerConSubdocs ?? this.documentos[0] ?? null;
        this.normalizarEstadoFiltroSubir();
        this.normalizarSeccionSubirActiva();
        this.normalizarSubdocFocusSubir();
        this.cargandoDocumentos = false;
        this.intentarAbrirDocumentoDesdeBusqueda();
        if (
          this.vistaActual === 'menuDocumentos'
          && this.pasoOperacionesSeleccionado === 'documentacion'
          && this.entregasEnRevisionAdmin > 0
        ) {
          this.opsDocumentacionTab = 'revision';
        }
        if (this.vistaActual === 'menuDocumentos') {
          this.cargarCentroOperaciones(empresaId);
        }
        if (this.estaEnSubirDocumentosOperaciones() && !this.requiereAccionSubirDocumentosAdmin) {
          this.asegurarPasoOperacionesSeleccionadoValido();
        }
        if (this.mostrarDocumentacionExtraPc) {
          this.cargarPcDocumentacionExtra();
        }
      },
      (error) => {
        console.error('Error al cargar documentos:', error);
        this.cargandoDocumentos = false;
        this.docActivoSubir = null;
      }
    );
  }

  // =====================================================
  // DOCUMENTACIÓN EXTRA (fuera del checklist PIPC)
  // =====================================================

  /** Carpetas de primer nivel (raíz de Documentación Extra). */
  get pcDocsExtraCarpetasRaiz(): PcDocExtraCarpetaVista[] {
    return this.carpetasHijasPcExtra('');
  }

  /** Archivos sueltos en la raíz. */
  get pcDocsExtraArchivosRaiz(): PcDocExtraItem[] {
    return this.archivosEnCarpetaPcExtra('');
  }

  get pcDocsExtraHayContenido(): boolean {
    return this.pcDocsExtra.length > 0;
  }

  carpetasHijasPcExtra(rutaPadre: string): PcDocExtraCarpetaVista[] {
    const actual = this.normalizarRutaPcExtra(rutaPadre);
    const mapa = new Map<string, number>();
    for (const doc of this.pcDocsExtra) {
      const ruta = this.normalizarRutaPcExtra(doc.carpetaRelativa);
      if (!ruta) {
        continue;
      }
      let resto = '';
      if (!actual) {
        resto = ruta;
      } else if (ruta === actual || !ruta.startsWith(actual + '/')) {
        continue;
      } else {
        resto = ruta.slice(actual.length + 1);
      }
      const nombre = resto.split('/')[0];
      if (!nombre) {
        continue;
      }
      mapa.set(nombre, (mapa.get(nombre) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .map(([nombre, cantidad]) => ({
        nombre,
        ruta: actual ? `${actual}/${nombre}` : nombre,
        cantidad
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  archivosEnCarpetaPcExtra(rutaPadre: string): PcDocExtraItem[] {
    const actual = this.normalizarRutaPcExtra(rutaPadre);
    return this.pcDocsExtra.filter(
      d => this.normalizarRutaPcExtra(d.carpetaRelativa) === actual
    );
  }

  private normalizarRutaPcExtra(ruta: string | null | undefined): string {
    return String(ruta || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(s => s.trim())
      .filter(s => s && s !== '.' && s !== '..')
      .join('/');
  }

  private unirRutaPcExtra(base: string, relativa: string): string {
    const a = this.normalizarRutaPcExtra(base);
    const b = this.normalizarRutaPcExtra(relativa);
    if (!a) {
      return b;
    }
    if (!b) {
      return a;
    }
    return `${a}/${b}`;
  }

  private dirnameRutaPcExtra(ruta: string): string {
    const n = this.normalizarRutaPcExtra(ruta);
    if (!n.includes('/')) {
      return '';
    }
    return n.slice(0, n.lastIndexOf('/'));
  }

  estaCarpetaExpandidaPcExtra(ruta: string): boolean {
    const r = ruta === this.pcDocsExtraClaveRaiz ? this.pcDocsExtraClaveRaiz : this.normalizarRutaPcExtra(ruta);
    return this.pcDocsExtraCarpetasExpandidas.has(r);
  }

  toggleCarpetaPcDocsExtra(ruta: string): void {
    const r = ruta === this.pcDocsExtraClaveRaiz ? this.pcDocsExtraClaveRaiz : this.normalizarRutaPcExtra(ruta);
    if (!r) {
      return;
    }
    if (this.pcDocsExtraCarpetasExpandidas.has(r)) {
      this.pcDocsExtraCarpetasExpandidas.delete(r);
    } else {
      this.pcDocsExtraCarpetasExpandidas.add(r);
      if (r === this.pcDocsExtraClaveRaiz) {
        this.precargarMiniaturasPcExtra(this.pcDocsExtraArchivosRaiz);
      } else {
        this.precargarMiniaturasPcExtra(this.archivosEnCarpetaPcExtra(r));
      }
    }
    this.pcDocsExtraCarpetasExpandidas = new Set(this.pcDocsExtraCarpetasExpandidas);
  }

  cargarPcDocumentacionExtra(): void {
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId) {
      this.pcDocsExtra = [];
      return;
    }
    this.cargandoPcDocsExtra = true;
    this.errorPcDocsExtra = null;
    this.backendService.listarPcDocumentacionExtra(empresaId).subscribe({
      next: (res: any) => {
        this.pcDocsExtra = Array.isArray(res?.documentos) ? res.documentos : [];
        this.cargandoPcDocsExtra = false;
        if (
          this.pcDocsExtraArchivosRaiz.length &&
          !this.pcDocsExtraRaizInicializada
        ) {
          this.pcDocsExtraCarpetasExpandidas.add(this.pcDocsExtraClaveRaiz);
          this.pcDocsExtraCarpetasExpandidas = new Set(this.pcDocsExtraCarpetasExpandidas);
          this.pcDocsExtraRaizInicializada = true;
        }
        this.precargarMiniaturasPcExtra(this.pcDocsExtraArchivosRaiz);
        for (const ruta of this.pcDocsExtraCarpetasExpandidas) {
          if (ruta === this.pcDocsExtraClaveRaiz) {
            continue;
          }
          this.precargarMiniaturasPcExtra(this.archivosEnCarpetaPcExtra(ruta));
        }
      },
      error: (err) => {
        this.errorPcDocsExtra = err?.error?.message || err?.message || 'No se pudo cargar la documentación extra.';
        this.cargandoPcDocsExtra = false;
      }
    });
  }

  onPcDocsExtraElegidos(event: Event, destinoBase: string = ''): void {
    const input = event.target as HTMLInputElement;
    const pendientes = this.construirPendientesPcDocsExtra(input.files, false, destinoBase);
    input.value = '';
    void this.confirmarYSubirPcDocsExtra(pendientes, destinoBase);
  }

  onPcDocsExtraCarpetaElegida(event: Event, destinoBase: string = ''): void {
    const input = event.target as HTMLInputElement;
    const pendientes = this.construirPendientesPcDocsExtra(input.files, true, destinoBase);
    input.value = '';
    void this.confirmarYSubirPcDocsExtra(pendientes, destinoBase);
  }

  onDragOverPcDocsExtra(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverPcDocsExtra = true;
  }

  onDragLeavePcDocsExtra(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverPcDocsExtra = false;
  }

  onDropPcDocsExtra(event: DragEvent, destinoBase: string = ''): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverPcDocsExtra = false;
    void this.agregarPcDocsExtraDesdeDrop(event.dataTransfer, destinoBase);
  }

  private async agregarPcDocsExtraDesdeDrop(
    dt: DataTransfer | null,
    destinoBase: string = ''
  ): Promise<void> {
    if (!dt || this.recolectandoDropPcExtra) {
      return;
    }
    this.recolectandoDropPcExtra = true;
    try {
      const items = dt.items;
      const entries: any[] = [];
      if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
          const entry = (items[i] as any).webkitGetAsEntry?.();
          if (entry) {
            entries.push(entry);
          }
        }
      }
      if (entries.length) {
        const pendientes: PcDocExtraPendiente[] = [];
        const base = this.normalizarRutaPcExtra(destinoBase);
        for (const entry of entries) {
          await this.recorrerEntryPcExtra(entry, base, pendientes);
        }
        await this.confirmarYSubirPcDocsExtra(pendientes, base);
        return;
      }
      const pendientes = this.construirPendientesPcDocsExtra(dt.files, false, destinoBase);
      await this.confirmarYSubirPcDocsExtra(pendientes, destinoBase);
    } finally {
      this.recolectandoDropPcExtra = false;
    }
  }

  private recorrerEntryPcExtra(
    entry: any,
    basePath: string,
    out: PcDocExtraPendiente[]
  ): Promise<void> {
    if (!entry) {
      return Promise.resolve();
    }
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file(
          (file: File) => {
            if (file && file.size > 0) {
              const carpetaRelativa = this.normalizarRutaPcExtra(basePath);
              const etiqueta = carpetaRelativa
                ? `${carpetaRelativa}/${file.name}`
                : file.name;
              out.push({ file, carpetaRelativa, etiqueta });
            }
            resolve();
          },
          () => resolve()
        );
      });
    }
    if (entry.isDirectory) {
      const dirPath = this.unirRutaPcExtra(basePath, entry.name);
      const reader = entry.createReader();
      return this.leerTodosLosEntriesPcExtra(reader).then(async (hijos) => {
        for (const hijo of hijos) {
          await this.recorrerEntryPcExtra(hijo, dirPath, out);
        }
      });
    }
    return Promise.resolve();
  }

  private leerTodosLosEntriesPcExtra(reader: any): Promise<any[]> {
    return new Promise((resolve) => {
      const acumulados: any[] = [];
      const leerLote = () => {
        reader.readEntries(
          (lote: any[]) => {
            if (!lote || lote.length === 0) {
              resolve(acumulados);
              return;
            }
            acumulados.push(...lote);
            leerLote();
          },
          () => resolve(acumulados)
        );
      };
      leerLote();
    });
  }

  /**
   * @param desdeCarpeta true si viene de webkitdirectory (respeta webkitRelativePath).
   * @param destinoBase carpeta destino bajo Documentación Extra ('' = raíz).
   */
  private construirPendientesPcDocsExtra(
    lista: FileList | null,
    desdeCarpeta: boolean,
    destinoBase: string = ''
  ): PcDocExtraPendiente[] {
    if (!lista || lista.length === 0) {
      return [];
    }
    const pendientes: PcDocExtraPendiente[] = [];
    const baseActual = this.normalizarRutaPcExtra(destinoBase);

    for (const file of Array.from(lista)) {
      if (!file || file.size <= 0) {
        continue;
      }
      let carpetaRelativa = baseActual;
      let etiqueta = file.name;

      if (desdeCarpeta) {
        const rel = String((file as any).webkitRelativePath || '').replace(/\\/g, '/');
        if (rel && rel.includes('/')) {
          const dirRel = this.dirnameRutaPcExtra(rel);
          carpetaRelativa = this.unirRutaPcExtra(baseActual, dirRel);
          etiqueta = this.unirRutaPcExtra(baseActual, rel) || rel;
        } else {
          etiqueta = carpetaRelativa ? `${carpetaRelativa}/${file.name}` : file.name;
        }
      } else if (carpetaRelativa) {
        etiqueta = `${carpetaRelativa}/${file.name}`;
      }

      pendientes.push({ file, carpetaRelativa, etiqueta });
    }
    return pendientes;
  }

  private formatoExtensionPcExtra(nombre: string): string {
    const partes = String(nombre || '').split('.');
    if (partes.length < 2) {
      return '—';
    }
    const ext = partes.pop() || '';
    return ext ? `.${ext.toLowerCase()}` : '—';
  }

  private escapeHtmlPcExtra(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Nombres de carpetas nuevas que se crearán con esta subida. */
  private detectarCarpetasNuevasPcExtra(
    pendientes: PcDocExtraPendiente[],
    destinoBase: string = ''
  ): string[] {
    const base = this.normalizarRutaPcExtra(destinoBase);
    const nombres = new Set<string>();
    for (const p of pendientes) {
      const ruta = this.normalizarRutaPcExtra(p.carpetaRelativa);
      let resto = '';
      if (!base) {
        resto = ruta;
      } else if (ruta === base) {
        continue;
      } else if (ruta.startsWith(base + '/')) {
        resto = ruta.slice(base.length + 1);
      } else {
        continue;
      }
      const top = resto.split('/')[0];
      if (top) {
        nombres.add(top);
      }
    }
    return Array.from(nombres);
  }

  /**
   * Aviso del sistema (estilo Swal) con listado antes de subir.
   */
  private async confirmarYSubirPcDocsExtra(
    pendientes: PcDocExtraPendiente[],
    destinoBase: string = ''
  ): Promise<void> {
    if (!pendientes.length || this.subiendoPcDocsExtra) {
      return;
    }

    const rechazados: string[] = [];
    const validos: PcDocExtraPendiente[] = [];
    for (const p of pendientes) {
      if (p.file.size > this.maxPcExtraFileBytes) {
        rechazados.push(`${p.etiqueta} (máx. ${this.maxPcExtraFileMb} MB)`);
        continue;
      }
      validos.push(p);
    }

    if (!validos.length) {
      this.errorPcDocsExtra = rechazados.length
        ? `Archivos demasiado pesados: ${rechazados.join(', ')}`
        : 'No hay archivos válidos para subir.';
      await Swal.fire({
        icon: 'warning',
        title: 'Subir Documentos',
        text: this.errorPcDocsExtra,
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const n = validos.length;
    const carpetasNuevas = this.detectarCarpetasNuevasPcExtra(validos, destinoBase);
    let avisoHtml = '';
    if (carpetasNuevas.length === 1) {
      avisoHtml = `Se va a crear la carpeta <strong>${this.escapeHtmlPcExtra(carpetasNuevas[0])}</strong> y se van a subir <strong>${n}</strong> documento${n !== 1 ? 's' : ''}.`;
    } else if (carpetasNuevas.length > 1) {
      const lista = carpetasNuevas.map(c => `«${this.escapeHtmlPcExtra(c)}»`).join(', ');
      avisoHtml = `Se van a crear las carpetas <strong>${lista}</strong> y se van a subir <strong>${n}</strong> documento${n !== 1 ? 's' : ''}.`;
    } else {
      avisoHtml = `Se van a subir <strong>${n}</strong> documento${n !== 1 ? 's' : ''}.`;
    }

    const filas = validos.map(p => {
      const nombre = this.escapeHtmlPcExtra(p.file.name);
      const ruta = p.carpetaRelativa
        ? `<div style="font-size:0.72rem;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtmlPcExtra(p.carpetaRelativa)}</div>`
        : '';
      const formato = this.escapeHtmlPcExtra(this.formatoExtensionPcExtra(p.file.name));
      const tamano = this.escapeHtmlPcExtra(this.formatearTamanoPcExtra(p.file.size));
      return `
        <li style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:0.5rem;align-items:center;padding:0.45rem 0;border-bottom:1px solid #eee;font-size:0.82rem;text-align:left;">
          <div style="min-width:0;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${nombre}">${nombre}</div>
            ${ruta}
          </div>
          <span style="color:#8a5a3c;background:#f8ebe3;border-radius:999px;padding:0.15rem 0.55rem;font-size:0.72rem;font-weight:600;white-space:nowrap;">${formato}</span>
          <span style="color:#888;white-space:nowrap;font-size:0.78rem;">${tamano}</span>
        </li>`;
    }).join('');

    const result = await Swal.fire({
      icon: 'info',
      title: 'Subir Documentos',
      html: `
        <p style="margin:0 0 0.75rem;text-align:left;color:#555;">
          ${avisoHtml}
        </p>
        <ul style="list-style:none;margin:0;padding:0 0.25rem;max-height:260px;overflow:auto;border:1px solid #eee;border-radius:10px;background:#fafafa;">
          ${filas}
        </ul>
        ${rechazados.length
          ? `<p style="margin:0.65rem 0 0;font-size:0.78rem;color:#856404;text-align:left;">Se omitirán por tamaño: ${this.escapeHtmlPcExtra(rechazados.join(', '))}</p>`
          : ''}
      `,
      showCancelButton: true,
      focusConfirm: true,
      confirmButtonText: 'Subir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#6c757d',
      width: 560
    });

    if (!result.isConfirmed) {
      return;
    }

    this.pcDocsExtraSeleccionados = validos;
    this.pcDocsExtraCarpetasEnSubida = carpetasNuevas;
    await this.ejecutarSubidaPcDocumentacionExtra(carpetasNuevas, destinoBase);
  }

  quitarPcDocExtraSeleccionado(index: number): void {
    if (this.subiendoPcDocsExtra) {
      return;
    }
    this.pcDocsExtraSeleccionados.splice(index, 1);
  }

  limpiarPcDocsExtraSeleccionados(): void {
    if (this.subiendoPcDocsExtra) {
      return;
    }
    this.pcDocsExtraSeleccionados = [];
    this.errorPcDocsExtra = null;
  }

  /** Botón de cola pendiente: vuelve a mostrar el aviso con listado. */
  async subirPcDocumentacionExtra(): Promise<void> {
    if (!this.pcDocsExtraSeleccionados.length || this.subiendoPcDocsExtra) {
      return;
    }
    await this.confirmarYSubirPcDocsExtra([...this.pcDocsExtraSeleccionados]);
  }

  private async ejecutarSubidaPcDocumentacionExtra(
    carpetasAExpandir: string[] = [],
    destinoBase: string = ''
  ): Promise<void> {
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId || !this.pcDocsExtraSeleccionados.length || this.subiendoPcDocsExtra) {
      return;
    }
    this.subiendoPcDocsExtra = true;
    this.errorPcDocsExtra = null;
    try {
      const payload = this.pcDocsExtraSeleccionados.map(p => ({
        file: p.file,
        carpetaRelativa: p.carpetaRelativa
      }));
      const hayArchivosRaiz = payload.some(p => !this.normalizarRutaPcExtra(p.carpetaRelativa));
      const res = await firstValueFrom(
        this.backendService.subirPcDocumentacionExtra(empresaId, payload)
      );
      const errores: { nombre?: string; error?: string }[] = Array.isArray(res?.errores) ? res.errores : [];
      const exitosos = Number(res?.exitosos) || 0;
      if (exitosos > 0) {
        for (const nombre of carpetasAExpandir) {
          const ruta = this.unirRutaPcExtra(destinoBase, nombre);
          if (ruta) {
            this.pcDocsExtraCarpetasExpandidas.add(ruta);
          }
        }
        if (hayArchivosRaiz) {
          this.pcDocsExtraCarpetasExpandidas.add(this.pcDocsExtraClaveRaiz);
        }
        this.pcDocsExtraCarpetasExpandidas = new Set(this.pcDocsExtraCarpetasExpandidas);
        this.cargarPcDocumentacionExtra();
      }
      if (errores.length && exitosos === 0) {
        this.errorPcDocsExtra = errores.map(e => e.error || e.nombre).join('; ');
        await Swal.fire({
          icon: 'error',
          title: 'No se pudieron subir',
          text: this.errorPcDocsExtra || 'Error al subir la documentación extra.',
          confirmButtonColor: '#d97248'
        });
      } else if (errores.length) {
        this.pcDocsExtraSeleccionados = [];
        await Swal.fire({
          icon: 'warning',
          title: 'Subida parcial',
          text: `${exitosos} archivo(s) subido(s). Fallaron: ${errores.map(e => e.nombre).join(', ')}`,
          confirmButtonColor: '#d97248'
        });
      } else {
        this.pcDocsExtraSeleccionados = [];
        await Swal.fire({
          icon: 'success',
          title: 'Subir Documentos',
          text: res?.message || `${exitosos} archivo(s) guardado(s) correctamente.`,
          timer: 1800,
          showConfirmButton: false
        });
      }
    } catch (err: any) {
      this.errorPcDocsExtra = err?.error?.message || err?.message || 'No se pudo subir la documentación extra.';
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: this.errorPcDocsExtra || 'Error al subir.',
        confirmButtonColor: '#d97248'
      });
    } finally {
      this.subiendoPcDocsExtra = false;
      this.pcDocsExtraCarpetasEnSubida = [];
    }
  }

  descargarPcDocExtra(doc: PcDocExtraItem, event?: Event): void {
    event?.stopPropagation();
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId || !doc?.id) {
      return;
    }
    this.backendService.descargarPcDocumentacionExtra(empresaId, doc.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.nombreArchivo || 'documento';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: async (err) => {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo descargar',
          text: err?.error?.message || err?.message || 'Error al descargar el archivo.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  async eliminarPcDocExtra(doc: PcDocExtraItem, event?: Event): Promise<void> {
    event?.stopPropagation();
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId || !doc?.id) {
      return;
    }
    const confirmacion = await Swal.fire({
      icon: 'warning',
      title: 'Eliminar documento',
      text: `¿Eliminar "${doc.nombreArchivo}" de Documentación Extra?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d9534f',
      cancelButtonColor: '#6c757d'
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    try {
      await firstValueFrom(this.backendService.eliminarPcDocumentacionExtra(empresaId, doc.id));
      this.revocarMiniaturaPcExtra(doc.id);
      this.pcDocsExtra = this.pcDocsExtra.filter(d => d.id !== doc.id);
      await Swal.fire({
        icon: 'success',
        title: 'Eliminado',
        timer: 1200,
        showConfirmButton: false
      });
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo eliminar',
        text: err?.error?.message || err?.message || 'Error al eliminar.',
        confirmButtonColor: '#d97248'
      });
    }
  }

  async eliminarPcDocsExtraCarpeta(carpeta: PcDocExtraCarpetaVista, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId || !carpeta?.ruta || this.eliminandoPcDocsExtraCarpeta || this.subiendoPcDocsExtra) {
      return;
    }

    const n = carpeta.cantidad || 0;
    const nombre = this.escapeHtmlPcExtra(carpeta.nombre);
    const confirmacion = await Swal.fire({
      icon: 'warning',
      title: '¿Borrar carpeta?',
      html: `
        <p style="text-align:left;margin:0 0 0.5rem;color:#555;">
          Se eliminará la carpeta <strong>${nombre}</strong>
          ${n > 0 ? ` y sus <strong>${n}</strong> archivo${n !== 1 ? 's' : ''}` : ''}
          (incluye subcarpetas).
        </p>
        <p style="text-align:left;margin:0;color:#a94442;font-weight:600;">
          La información se perderá de Google Drive y de la base de datos. Esta acción no se puede deshacer.
        </p>
      `,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d9534f',
      cancelButtonColor: '#6c757d'
    });
    if (!confirmacion.isConfirmed) {
      return;
    }

    this.eliminandoPcDocsExtraCarpeta = true;
    Swal.fire({
      title: 'Eliminando carpeta…',
      text: 'Borrando en Drive y en la base de datos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const res = await firstValueFrom(
        this.backendService.eliminarPcDocumentacionExtraCarpeta(empresaId, carpeta.ruta)
      );
      const ruta = this.normalizarRutaPcExtra(carpeta.ruta);
      const idsARevocar = this.pcDocsExtra
        .filter(d => {
          const r = this.normalizarRutaPcExtra(d.carpetaRelativa);
          return r === ruta || r.startsWith(ruta + '/');
        })
        .map(d => d.id);
      for (const id of idsARevocar) {
        this.revocarMiniaturaPcExtra(id);
      }
      this.pcDocsExtra = this.pcDocsExtra.filter(d => {
        const r = this.normalizarRutaPcExtra(d.carpetaRelativa);
        return r !== ruta && !r.startsWith(ruta + '/');
      });
      for (const key of Array.from(this.pcDocsExtraCarpetasExpandidas)) {
        if (key === ruta || key.startsWith(ruta + '/')) {
          this.pcDocsExtraCarpetasExpandidas.delete(key);
        }
      }
      this.pcDocsExtraCarpetasExpandidas = new Set(this.pcDocsExtraCarpetasExpandidas);
      await Swal.fire({
        icon: 'success',
        title: 'Carpeta eliminada',
        text: res?.message || 'Se borraron los registros de Drive y de la base de datos.',
        timer: 1600,
        showConfirmButton: false
      });
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo borrar la carpeta',
        text: err?.error?.message || err?.message || 'Error al eliminar la carpeta.',
        confirmButtonColor: '#d97248'
      });
    } finally {
      this.eliminandoPcDocsExtraCarpeta = false;
    }
  }

  formatearTamanoPcExtra(bytes: number | null | undefined): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) {
      return '—';
    }
    if (n < 1024) {
      return `${n} B`;
    }
    if (n < 1024 * 1024) {
      return `${(n / 1024).toFixed(1)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatearFechaPcExtra(fecha: string | null | undefined): string {
    if (!fecha) {
      return '';
    }
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) {
      return String(fecha);
    }
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  iconoTipoPcExtra(mimeType: string | null | undefined, nombre: string): string {
    const mime = String(mimeType || '').toLowerCase();
    const ext = String(nombre || '').toLowerCase().split('.').pop() || '';
    if (mime.includes('pdf') || ext === 'pdf') return 'fa-file-pdf text-danger';
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)) {
      return 'fa-file-image text-info';
    }
    if (mime.includes('sheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) {
      return 'fa-file-excel text-success';
    }
    if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return 'fa-file-word text-primary';
    if (mime.includes('powerpoint') || mime.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
      return 'fa-file-powerpoint text-warning';
    }
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || ['zip', 'rar', '7z'].includes(ext)) {
      return 'fa-file-archive text-secondary';
    }
    return 'fa-file-alt text-muted';
  }

  claseTilePcExtra(mime: string | null | undefined, nombre: string): string {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'pc-extra-tile--pdf';
    if (m.includes('csv') || n.endsWith('.csv')) return 'pc-extra-tile--csv';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'pc-extra-tile--excel';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif|bmp|tif|tiff)$/.test(n)) return 'pc-extra-tile--imagen';
    return 'pc-extra-tile--otro';
  }

  etiquetaTipoPcExtra(mime: string | null | undefined, nombre: string): string {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
    if (m.includes('csv') || n.endsWith('.csv')) return 'CSV';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'Excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'Word';
    if (m.includes('powerpoint') || m.includes('presentation') || /\.pptx?$/.test(n)) return 'PPT';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif|bmp|tif|tiff)$/.test(n)) return 'Imagen';
    return 'Archivo';
  }

  modoMiniaturaPcExtra(doc: PcDocExtraItem): PcExtraMiniaturaModo {
    const m = String(doc.mimeType || '').toLowerCase();
    const n = String(doc.nombreArchivo || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'imagen';
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tif|tiff)$/.test(n)) return 'imagen';
    return 'icono';
  }

  miniaturaPcExtra(doc: PcDocExtraItem): PcExtraMiniaturaEstado {
    return (
      this.pcDocsExtraMiniaturas[doc.id] || {
        modo: 'icono',
        urlStr: null,
        cargando: false,
        error: false,
        reintento: 0
      }
    );
  }

  private urlThumbnailDrive(driveFileId: string, cacheBust = 0): string {
    const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w400`;
    return cacheBust ? `${base}&t=${cacheBust}` : base;
  }

  private precargarMiniaturasPcExtra(docs: PcDocExtraItem[]): void {
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId) {
      return;
    }
    for (const doc of docs) {
      const modo = this.modoMiniaturaPcExtra(doc);
      if (modo === 'icono') {
        this.actualizarMiniaturaPcExtra(doc.id, {
          modo: 'icono',
          urlStr: null,
          cargando: false,
          error: false,
          reintento: 0
        });
        continue;
      }
      const prev = this.pcDocsExtraMiniaturas[doc.id];
      if (prev?.urlStr || prev?.cargando) {
        continue;
      }
      if (doc.driveFileId) {
        this.actualizarMiniaturaPcExtra(doc.id, {
          modo: 'imagen',
          urlStr: this.urlThumbnailDrive(doc.driveFileId),
          cargando: false,
          error: false,
          reintento: 0
        });
        continue;
      }
      // Sin Drive: descarga blob solo para imágenes razonables
      this.actualizarMiniaturaPcExtra(doc.id, {
        modo: 'imagen',
        urlStr: null,
        cargando: true,
        error: false,
        reintento: 0
      });
      this.backendService
        .descargarPcDocumentacionExtra(empresaId, doc.id)
        .pipe(takeUntil(this.pcExtraDestroy$))
        .subscribe({
          next: (blob) => {
            const url = URL.createObjectURL(blob);
            this.pcExtraMiniaturaObjectUrls.set(doc.id, url);
            this.actualizarMiniaturaPcExtra(doc.id, {
              modo: 'imagen',
              urlStr: url,
              cargando: false,
              error: false,
              reintento: 0
            });
          },
          error: () => {
            this.actualizarMiniaturaPcExtra(doc.id, {
              modo: 'icono',
              urlStr: null,
              cargando: false,
              error: true,
              reintento: 0
            });
          }
        });
    }
  }

  onErrorMiniaturaPcExtra(doc: PcDocExtraItem, event?: Event): void {
    event?.stopPropagation();
    const empresaId = this.getEmpresaIdActual();
    const prev = this.miniaturaPcExtra(doc);
    if (!doc?.driveFileId || !empresaId) {
      this.actualizarMiniaturaPcExtra(doc.id, {
        modo: 'icono',
        urlStr: null,
        cargando: false,
        error: true,
        reintento: prev.reintento
      });
      return;
    }
    if (prev.reintento >= 1) {
      this.actualizarMiniaturaPcExtra(doc.id, {
        modo: 'icono',
        urlStr: null,
        cargando: false,
        error: true,
        reintento: prev.reintento
      });
      return;
    }
    this.actualizarMiniaturaPcExtra(doc.id, {
      modo: 'imagen',
      urlStr: null,
      cargando: true,
      error: false,
      reintento: prev.reintento + 1
    });
    this.backendService
      .prepararVistaPcDocumentacionExtra(empresaId, doc.id)
      .pipe(takeUntil(this.pcExtraDestroy$))
      .subscribe({
        next: () => {
          this.actualizarMiniaturaPcExtra(doc.id, {
            modo: 'imagen',
            urlStr: this.urlThumbnailDrive(doc.driveFileId, Date.now()),
            cargando: false,
            error: false,
            reintento: prev.reintento + 1
          });
        },
        error: () => {
          this.actualizarMiniaturaPcExtra(doc.id, {
            modo: 'imagen',
            urlStr: this.urlThumbnailDrive(doc.driveFileId, Date.now()),
            cargando: false,
            error: false,
            reintento: prev.reintento + 1
          });
        }
      });
  }

  private actualizarMiniaturaPcExtra(id: number, estado: PcExtraMiniaturaEstado): void {
    this.pcDocsExtraMiniaturas = { ...this.pcDocsExtraMiniaturas, [id]: estado };
  }

  private revocarMiniaturaPcExtra(id: number): void {
    const url = this.pcExtraMiniaturaObjectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.pcExtraMiniaturaObjectUrls.delete(id);
    }
    const copia = { ...this.pcDocsExtraMiniaturas };
    delete copia[id];
    this.pcDocsExtraMiniaturas = copia;
  }

  private limpiarMiniaturasPcExtra(): void {
    for (const url of this.pcExtraMiniaturaObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.pcExtraMiniaturaObjectUrls.clear();
    this.pcDocsExtraMiniaturas = {};
  }

  trackByPcDocExtraId(_index: number, doc: PcDocExtraItem): number {
    return doc.id;
  }

  trackByPcDocExtraCarpeta(_index: number, carpeta: PcDocExtraCarpetaVista): string {
    return carpeta.ruta;
  }

  mostrarDocumentosEjemplo(): void {
    // Documentos de ejemplo basados en la imagen del usuario
    this.documentos = [
      { documento_id: 1, nombre_documento: 'CURP Actualizada', especificacion: 'Descarga el formato aquí', obligatorio: true, estatus: 'aprobado', archivo_url: null, nombre_archivo: 'curp.pdf', comentarios: null, fecha_subida: null },
      { documento_id: 2, nombre_documento: 'Acta de Nacimiento', especificacion: 'En caso de no tenerla tramitala aquí', obligatorio: true, estatus: 'aprobado', archivo_url: null, nombre_archivo: 'acta.pdf', comentarios: null, fecha_subida: null },
      { documento_id: 3, nombre_documento: 'Certificado de Bachillerato legalizado', especificacion: 'Si el certificado es de una Universidad Autónoma, legalizarlo en la instancia correspondiente', obligatorio: true, estatus: 'revision', archivo_url: null, nombre_archivo: 'certificado.jpg', comentarios: 'SE REQUIERE ESCANEO', fecha_subida: null },
      { documento_id: 4, nombre_documento: 'Escaneo de Reverso Certificado de Bachillerato', especificacion: 'Si no hay información al reverso, escanearlo de todos modos', obligatorio: true, estatus: 'revision', archivo_url: null, nombre_archivo: 'certificado_r.jpg', comentarios: 'SE REQUIERE ESCANEO', fecha_subida: null },
      { documento_id: 5, nombre_documento: 'Carta de Autenticidad del Certificado de Bachillerato', especificacion: 'Si el certificado no tiene código QR, deberá solicitarse en el bachillerato de origen', obligatorio: true, estatus: 'aprobado', archivo_url: null, nombre_archivo: 'carta.pdf', comentarios: null, fecha_subida: null },
      { documento_id: 6, nombre_documento: 'Firma escaneada', especificacion: 'En una hoja blanca colocar su firma autógrafa legible y de buen tamaño', obligatorio: true, estatus: 'aprobado', archivo_url: null, nombre_archivo: 'firma.jpg', comentarios: null, fecha_subida: null },
      { documento_id: 7, nombre_documento: 'Foto Digital', especificacion: 'Archivo del estudio Fotográfico', obligatorio: true, estatus: 'aprobado', archivo_url: null, nombre_archivo: 'foto.jpg', comentarios: null, fecha_subida: null },
      { documento_id: 8, nombre_documento: 'Equivalencia de estudios', especificacion: 'En caso de haber estudiado en dos instituciones de la EMS', obligatorio: false, estatus: 'pendiente', archivo_url: null, nombre_archivo: null, comentarios: null, fecha_subida: null },
    ];
  }

  // =====================================================
  // ACCIONES SOBRE DOCUMENTOS
  // =====================================================

  visualizarDocumento(doc: DocumentoPC): void {
    if (!doc.archivo_url && !doc.nombre_archivo) {
      Swal.fire('Sin archivo', 'Este documento aún no tiene archivo cargado', 'info');
      return;
    }
    this.pcDocExtraVisualizadorId = null;
    this.nombreArchivoActual = doc.nombre_archivo || doc.nombre_documento;
    this.mostrarModalVisualizador = true;
    this.cargandoVisualizador = true;
    this.documentoVisualizadorId = doc.documento_id;
    document.body.classList.add('visor-fullscreen-open');

    // Usar preview de Google Drive directamente con iframe (como el catálogo)
    if (doc.archivo_url) {
      this.urlArchivoActual = `https://drive.google.com/file/d/${doc.archivo_url}/preview`;
      this.cargandoVisualizador = false;
    } else {
      // Fallback: descargar como blob si no hay drive file ID
      this.backendService.descargarArchivoProteccionCivil(doc.documento_id).subscribe(
        (blob: Blob) => {
          this.urlArchivoActual = URL.createObjectURL(blob);
          this.cargandoVisualizador = false;
        },
        (error) => {
          console.error('Error al descargar archivo de PC:', error);
          this.cargandoVisualizador = false;
          Swal.fire('Error', 'No se pudo cargar el archivo desde Google Drive', 'error');
          this.cerrarVisualizador();
        }
      );
    }
  }

  /** Abre el mismo visor integrado para un archivo de Documentación Extra. */
  visualizarPcDocExtra(doc: PcDocExtraItem, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id) {
      Swal.fire('Sin archivo', 'Este documento no tiene un archivo para previsualizar', 'info');
      return;
    }
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId) {
      return;
    }

    this.documentoVisualizadorId = null;
    this.pcDocExtraVisualizadorId = doc.id;
    this.nombreArchivoActual = doc.nombreArchivo || doc.titulo || 'documento';
    this.mostrarModalVisualizador = true;
    this.cargandoVisualizador = true;
    this.urlArchivoActual = '';
    document.body.classList.add('visor-fullscreen-open');

    this.backendService.prepararVistaPcDocumentacionExtra(empresaId, doc.id).subscribe({
      next: (res: any) => {
        const previewUrl = res?.previewUrl
          || this.getDrivePreviewUrlById(res?.documento?.driveFileId || doc.driveFileId);
        if (previewUrl) {
          this.urlArchivoActual = previewUrl;
          this.cargandoVisualizador = false;
          return;
        }
        this.backendService.descargarPcDocumentacionExtra(empresaId, doc.id).subscribe({
          next: (blob) => {
            this.urlArchivoActual = URL.createObjectURL(blob);
            this.cargandoVisualizador = false;
          },
          error: () => {
            this.cargandoVisualizador = false;
            Swal.fire('Error', 'No se pudo cargar el archivo desde Google Drive', 'error');
            this.cerrarVisualizador();
          }
        });
      },
      error: () => {
        // Fallback: intentar preview directo o descarga
        if (doc.driveFileId) {
          this.urlArchivoActual = this.getDrivePreviewUrlById(doc.driveFileId);
          this.cargandoVisualizador = false;
          return;
        }
        this.cargandoVisualizador = false;
        Swal.fire('Error', 'No se pudo preparar la vista previa', 'error');
        this.cerrarVisualizador();
      }
    });
  }

  private refrescarDocumentosTrasRevisionAdmin(): void {
    if (!this.empresaSeleccionada) return;
    if (this.vistaActual === 'menuDocumentos' && this.pasoOperacionesSeleccionado === 'documentacion') {
      this.cargarDocumentosEmpresa(this.empresaSeleccionada.empresa_id);
      this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
    }
  }

  /** Visor compartido desde la pestaña Revisión embebida en centro de operaciones. */
  visualizarDocumentoDesdeRevision(solicitud: PcVisorDocumentoRequest): void {
    this.visualizarDocumento({
      documento_id: solicitud.documento_id,
      nombre_documento: solicitud.nombre_documento || solicitud.nombre_archivo,
      nombre_archivo: solicitud.nombre_archivo,
      archivo_url: solicitud.archivo_url,
      especificacion: '',
      obligatorio: false,
      estatus: 'revision',
      comentarios: null,
      fecha_subida: null
    });
  }

  onVisualizadorIframeLoad(): void {
    this.cargandoVisualizador = false;
  }

  descargarArchivoPC(doc: DocumentoPC): void {
    if (!doc.archivo_url) {
      Swal.fire('Sin archivo', 'Este documento no tiene un archivo para descargar', 'info');
      return;
    }

    this.backendService.descargarArchivoProteccionCivil(doc.documento_id).subscribe(
      (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.nombre_archivo || doc.nombre_documento;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      (error) => {
        console.error('Error al descargar archivo:', error);
        Swal.fire('Error', 'No se pudo descargar el archivo', 'error');
      }
    );
  }

  cerrarVisualizador(): void {
    if (this.urlArchivoActual && this.urlArchivoActual.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(this.urlArchivoActual);
      } catch {
        // ignore
      }
    }
    this.mostrarModalVisualizador = false;
    this.urlArchivoActual = '';
    this.nombreArchivoActual = '';
    this.cargandoVisualizador = false;
    this.documentoVisualizadorId = null;
    this.pcDocExtraVisualizadorId = null;
    document.body.classList.remove('visor-fullscreen-open');
    if (this.route.snapshot.queryParamMap.has('documentoId')) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { documentoId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  getDrivePreviewUrl(doc: DocumentoPC): string {
    return this.getDrivePreviewUrlById(doc.archivo_url);
  }

  getWorkflowPreviewUrl(clave: PcWorkflowClave): string {
    return this.getDrivePreviewUrl(this.workflowArchivoAComoDoc(clave));
  }

  descargarDesdeVisor(): void {
    if (this.pcDocExtraVisualizadorId) {
      const empresaId = this.getEmpresaIdActual();
      if (!empresaId) {
        return;
      }
      this.backendService.descargarPcDocumentacionExtra(empresaId, this.pcDocExtraVisualizadorId).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = this.nombreArchivoActual || 'documento';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        error: () => {
          Swal.fire('Error', 'No se pudo descargar el archivo', 'error');
        }
      });
      return;
    }

    if (!this.documentoVisualizadorId) return;
    this.backendService.descargarArchivoProteccionCivil(this.documentoVisualizadorId).subscribe(
      (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.nombreArchivoActual || 'documento';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      (error) => {
        console.error('Error al descargar:', error);
        Swal.fire('Error', 'No se pudo descargar el archivo', 'error');
      }
    );
  }

  cambiarEstatus(doc: DocumentoPC, nuevoEstatus: 'pendiente' | 'aprobado' | 'rechazado'): void {
    if (!this.empresaSeleccionada) return;

    if (nuevoEstatus === 'rechazado') {
      // Rechazar: pedir comentario obligatorio
      Swal.fire({
        title: '<i class="fas fa-times-circle text-danger"></i> Rechazar documento',
        html: `<p class="mb-2">Documento: <strong>${doc.nombre_documento}</strong></p><p class="text-muted small">Escribe el motivo del rechazo (obligatorio):</p>`,
        input: 'textarea',
        inputPlaceholder: 'Ej: El documento está incompleto, falta firma...',
        inputAttributes: { 'aria-label': 'Motivo del rechazo' },
        inputValidator: (value) => {
          if (!value || !value.trim()) {
            return 'Debes escribir un motivo de rechazo';
          }
          return null;
        },
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '<i class="fas fa-times mr-1"></i> Rechazar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed && result.value) {
          const comentario = result.value.trim();
          this.backendService.actualizarEstatusDocumentoPC(
            this.empresaSeleccionada!.empresa_id, doc.documento_id, 'rechazado'
          ).subscribe(
            (response: any) => {
              if (response.success) {
                doc.estatus = 'rechazado';
                doc.comentarios = comentario;
                // Guardar comentario
                this.backendService.guardarComentarioDocumentoPC(
                  this.empresaSeleccionada!.empresa_id, doc.documento_id, comentario
                ).subscribe();
                this.refrescarDocumentosTrasRevisionAdmin();
                Swal.fire({
                  icon: 'error',
                  title: 'Documento rechazado',
                  html: `<p><strong>${doc.nombre_documento}</strong> fue rechazado.</p><p class="text-muted small">Motivo: ${comentario}</p>`,
                  confirmButtonColor: '#d97248'
                });
              }
            },
            (error) => {
              console.error('Error al rechazar:', error);
              Swal.fire('Error', 'No se pudo rechazar el documento', 'error');
            }
          );
        }
      });
    } else if (nuevoEstatus === 'aprobado') {
      // Aprobar: confirmación simple con popup de éxito
      Swal.fire({
        title: '<i class="fas fa-check-circle text-success"></i> Aprobar documento',
        html: `<p>¿Aprobar <strong>${doc.nombre_documento}</strong>?</p>`,
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '<i class="fas fa-check mr-1"></i> Aprobar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          this.backendService.actualizarEstatusDocumentoPC(
            this.empresaSeleccionada!.empresa_id, doc.documento_id, 'aprobado'
          ).subscribe(
            (response: any) => {
              if (response.success) {
                doc.estatus = 'aprobado';
                this.refrescarDocumentosTrasRevisionAdmin();
                Swal.fire({
                  icon: 'success',
                  title: '¡Documento aprobado!',
                  html: `<p><strong>${doc.nombre_documento}</strong> ha sido aprobado exitosamente.</p>`,
                  confirmButtonColor: '#d97248',
                  timer: 2500,
                  timerProgressBar: true
                });
              }
            },
            (error) => {
              console.error('Error al aprobar:', error);
              Swal.fire('Error', 'No se pudo aprobar el documento', 'error');
            }
          );
        }
      });
    } else {
      // Pendiente: confirmación simple
      Swal.fire({
        title: '¿Cambiar a pendiente?',
        text: `El documento "${doc.nombre_documento}" pasará a estado: PENDIENTE`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d97248',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, cambiar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (result.isConfirmed) {
          this.backendService.actualizarEstatusDocumentoPC(
            this.empresaSeleccionada!.empresa_id, doc.documento_id, 'pendiente'
          ).subscribe(
            (response: any) => {
              if (response.success) {
                doc.estatus = 'pendiente';
                Swal.fire({ icon: 'success', title: 'Actualizado', text: 'Estatus cambiado a pendiente', confirmButtonColor: '#d97248', timer: 2000, timerProgressBar: true });
              }
            },
            (error) => {
              console.error('Error al cambiar estatus:', error);
              Swal.fire('Error', 'No se pudo cambiar el estatus', 'error');
            }
          );
        }
      });
    }
  }

  // Cambiar estatus usando el ID del documento
  cambiarEstatusById(docId: number, nuevoEstatus: 'pendiente' | 'aprobado' | 'rechazado'): void {
    this.cerrarDropdown(); // Cerrar dropdown primero
    const doc = this.documentos.find(d => d.documento_id === docId);
    if (doc) {
      this.cambiarEstatus(doc, nuevoEstatus);
    }
  }

  // =====================================================
  // GESTIÓN DE COMENTARIOS
  // =====================================================

  abrirModalComentario(doc: DocumentoPC): void {
    this.documentoComentario = doc;
    this.nuevoComentario = doc.comentarios || '';
    this.mostrarModalComentario = true;
  }

  cerrarModalComentario(): void {
    this.mostrarModalComentario = false;
    this.documentoComentario = null;
    this.nuevoComentario = '';
  }

  guardarComentario(): void {
    if (!this.documentoComentario || !this.empresaSeleccionada) return;

    this.guardandoComentario = true;
    this.backendService.guardarComentarioDocumentoPC(
      this.empresaSeleccionada.empresa_id,
      this.documentoComentario.documento_id,
      this.nuevoComentario
    ).subscribe(
      (response: any) => {
        if (response.success) {
          this.documentoComentario!.comentarios = this.nuevoComentario;
          Swal.fire('Guardado', 'Comentario guardado correctamente', 'success');
        }
        this.guardandoComentario = false;
        this.cerrarModalComentario();
      },
      (error) => {
        console.error('Error al guardar comentario:', error);
        // Guardar localmente como fallback
        this.documentoComentario!.comentarios = this.nuevoComentario;
        this.guardandoComentario = false;
        this.cerrarModalComentario();
        Swal.fire('Guardado', 'Comentario guardado (modo local)', 'success');
      }
    );
  }

  // =====================================================
  // AGREGAR DOCUMENTO
  // =====================================================

  abrirModalAgregar(): void {
    this.nuevoDocumento = {
      nombre_documento: '',
      especificacion: '',
      obligatorio: true
    };
    this.mostrarModalAgregar = true;
  }

  cerrarModalAgregar(): void {
    this.mostrarModalAgregar = false;
  }

  agregarDocumento(): void {
    if (!this.nuevoDocumento.nombre_documento.trim()) {
      Swal.fire('Error', 'El nombre del documento es requerido', 'error');
      return;
    }
    if (!this.empresaSeleccionada) return;

    this.guardandoDocumento = true;
    this.backendService.agregarDocumentoProteccionCivil(
      this.empresaSeleccionada.empresa_id,
      this.nuevoDocumento
    ).subscribe(
      (response: any) => {
        if (response.success) {
          // Agregar a la lista local
          const nuevoDoc: DocumentoPC = {
            documento_id: response.documento_id || Date.now(),
            nombre_documento: this.nuevoDocumento.nombre_documento,
            especificacion: this.nuevoDocumento.especificacion,
            obligatorio: this.nuevoDocumento.obligatorio,
            estatus: 'pendiente',
            archivo_url: null,
            nombre_archivo: null,
            comentarios: null,
            fecha_subida: null
          };
          this.documentos.push(nuevoDoc);
          Swal.fire('Agregado', 'Documento agregado correctamente', 'success');
        }
        this.guardandoDocumento = false;
        this.cerrarModalAgregar();
      },
      (error) => {
        console.error('Error al agregar documento:', error);
        // Agregar localmente como fallback
        const nuevoDoc: DocumentoPC = {
          documento_id: Date.now(),
          nombre_documento: this.nuevoDocumento.nombre_documento,
          especificacion: this.nuevoDocumento.especificacion,
          obligatorio: this.nuevoDocumento.obligatorio,
          estatus: 'pendiente',
          archivo_url: null,
          nombre_archivo: null,
          comentarios: null,
          fecha_subida: null
        };
        this.documentos.push(nuevoDoc);
        this.guardandoDocumento = false;
        this.cerrarModalAgregar();
        Swal.fire('Agregado', 'Documento agregado (modo local)', 'success');
      }
    );
  }

  /** SP-F-29: solo root o administrador (no usuario con únicamente proteccion_civil). */
  get puedeVerControlResolutivosPipc(): boolean {
    return !this.esUsuarioEmpresa && this.authService.puedeVerControlResolutivosPipc();
  }

  /** Carga directa (autoaprobado): solo administradores; el perfil PC usa Revisión. */
  get puedeUsarCargaDirectaDocumentacion(): boolean {
    return !this.esUsuarioEmpresa && this.authService.esAdministradorOSuperior();
  }

  /** Gráfica de actividad: visible para admin y encargados PC. */
  get puedeVerGraficaActividadResolutivosPipc(): boolean {
    return !this.esUsuarioEmpresa && this.authService.esEncargadoProteccionCivil();
  }

  // =====================================================
  // ELIMINAR DOCUMENTO
  // =====================================================

  get puedeEliminarGrupoDocumentos(): boolean {
    return !this.esUsuarioEmpresa && this.authService.esAdministradorOSuperior();
  }

  get puedeEliminarAsignacionIndividualSubdoc(): boolean {
    return !this.esUsuarioEmpresa && this.authService.esEncargadoProteccionCivil();
  }

  esPlantillaPipcAsignada(doc: DocumentoPC | null | undefined): boolean {
    if (!doc) return false;
    return Number(doc.catalogo_documento_id || 0) > 0;
  }

  cancelarPlantillaPipcCompleta(doc: DocumentoPC): void {
    if (!this.puedeEliminarAsignacionIndividualSubdoc || !this.empresaSeleccionada || !this.esPlantillaPipcAsignada(doc)) {
      return;
    }

    const total = this.contarElementosGrupoDocumento(doc);
    Swal.fire({
      title: '<i class="fas fa-exclamation-triangle text-danger"></i> Cancelar plantilla PIPC',
      html: `
        <p>¿Cancelar la asignación completa de <strong>${doc.nombre_documento}</strong>?</p>
        <p class="text-muted small mb-1">Se eliminarán ${total} registro(s) (plantilla y requisitos).</p>
        <p class="text-muted small mb-0">La plantilla quedará disponible de nuevo en <strong>Asignar documentos</strong>.</p>
      `,
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, cancelar plantilla',
      cancelButtonText: 'No'
    }).then((result) => {
      if (result.isConfirmed) {
        this.aplicarEliminacionGrupoDocumento(
          doc,
          `${doc.nombre_documento} fue cancelada y ya puede reasignarse en Asignar documentos.`
        );
      }
    });
  }

  reabrirDocumentoSubdoc(subdoc: DocumentoPC): void {
    if (!this.puedeEliminarAsignacionIndividualSubdoc || !this.empresaSeleccionada) return;
    if (subdoc.estatus !== 'aprobado') return;

    Swal.fire({
      title: '<i class="fas fa-undo text-warning"></i> Reabrir documento',
      html: `
        <p>¿Reabrir <strong>${subdoc.nombre_documento}</strong>?</p>
        <p class="text-muted small mb-0">Volverá a <strong>faltantes</strong>. Podrás borrar archivos erróneos y subirlos de nuevo. Los archivos actuales se conservan hasta que los elimines.</p>
      `,
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-undo mr-1"></i> Sí, reabrir',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.backendService.actualizarEstatusDocumentoPC(
        this.empresaSeleccionada!.empresa_id,
        subdoc.documento_id,
        'pendiente'
      ).subscribe(
        (response: any) => {
          if (!response?.success) {
            Swal.fire('Error', 'No se pudo reabrir el documento', 'error');
            return;
          }
          subdoc.estatus = 'pendiente';
          this.estadoFiltroSubir = 'pendiente';
          this.filtroEntregaSubir = 'faltantes';
          this.normalizarEstadoFiltroSubir();
          this.normalizarSeccionSubirActiva();
          this.refrescarDocumentosTrasRevisionAdmin();
          Swal.fire({
            icon: 'success',
            title: 'Documento reabierto',
            text: 'Ya está en faltantes. Puedes eliminar archivos y subir otros.',
            confirmButtonColor: '#d97248',
            timer: 2500,
            timerProgressBar: true
          });
        },
        (error) => {
          console.error('Error al reabrir documento:', error);
          Swal.fire('Error', 'No se pudo reabrir el documento', 'error');
        }
      );
    });
  }

  borrarAsignacionIndividualSubdoc(subdoc: DocumentoPC): void {
    if (!this.puedeEliminarAsignacionIndividualSubdoc || !this.empresaSeleccionada) return;

    Swal.fire({
      title: '<i class="fas fa-exclamation-triangle text-danger"></i> Borrar requisito',
      html: `<p>¿Eliminar <strong>${subdoc.nombre_documento}</strong>?</p><p class="text-muted small">Solo se quita este requisito. La plantilla PIPC seguirá asignada. Para liberar la plantilla completa use <strong>Cancelar plantilla PIPC</strong>.</p>`,
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, borrar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendService.cancelarAsignacionDocumentoPC(
          this.empresaSeleccionada!.empresa_id,
          subdoc.documento_id
        ).subscribe(
          (response: any) => {
            this.aplicarEliminacionSubdocLocal(subdoc, !!response?.padre_eliminado);
            this.opsRefreshAsignaciones += 1;
            if (this.empresaSeleccionada) {
              this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
            }
            const mensaje = response?.padre_eliminado
              ? 'Se eliminó el último requisito y la plantilla PIPC quedó liberada en Asignar documentos.'
              : `<strong>${subdoc.nombre_documento}</strong> ya no forma parte de la asignación.`;
            Swal.fire({
              icon: 'success',
              title: 'Requisito eliminado',
              html: mensaje,
              confirmButtonColor: '#d97248',
              timer: 2800,
              timerProgressBar: true
            });
          },
          (error) => {
            console.error('Error al borrar asignación individual:', error);
            const msg = error?.error?.message || 'No se pudo borrar la asignación.';
            Swal.fire({ icon: 'error', title: 'Error', text: msg, confirmButtonColor: '#d97248' });
          }
        );
      }
    });
  }

  private aplicarEliminacionSubdocLocal(subdoc: DocumentoPC, padreEliminado = false): void {
    const padre = this.docActivoSubir;
    if (!padre?.subdocumentos) return;

    padre.subdocumentos = padre.subdocumentos.filter(s => s.documento_id !== subdoc.documento_id);

    const docEnLista = this.documentos.find(d => d.documento_id === padre.documento_id);
    if (docEnLista?.subdocumentos) {
      docEnLista.subdocumentos = docEnLista.subdocumentos.filter(s => s.documento_id !== subdoc.documento_id);
    }

    if (padreEliminado || this.filtrarSubdocsReales(padre.subdocumentos).length === 0) {
      this.documentos = this.documentos.filter(d => d.documento_id !== padre.documento_id);
      const primerRechazado = this.documentos.find(d => this.esDocRechazadoReal(d));
      this.docActivoSubir = primerRechazado ?? this.documentos[0] ?? null;
    }

    this.normalizarEstadoFiltroSubir();
    this.normalizarSeccionSubirActiva();
    this.normalizarSubdocFocusSubir();
  }

  private contarElementosGrupoDocumento(doc: DocumentoPC): number {
    if (doc.subdocumentos && doc.subdocumentos.length > 0) {
      return 1 + this.filtrarSubdocsReales(doc.subdocumentos).length;
    }
    return 1;
  }

  private aplicarEliminacionGrupoDocumento(doc: DocumentoPC, mensajeExito?: string): void {
    if (!this.empresaSeleccionada) return;

    this.backendService.eliminarDocumentoProteccionCivil(
      this.empresaSeleccionada.empresa_id,
      doc.documento_id
    ).subscribe(
      (response: any) => {
        if (response.success) {
          this.documentos = this.documentos.filter(d => d.documento_id !== doc.documento_id);
          const primerRechazado = this.documentos.find(d => this.esDocRechazadoReal(d));
          this.docActivoSubir = primerRechazado ?? this.documentos[0] ?? null;
          this.normalizarEstadoFiltroSubir();
          this.normalizarSeccionSubirActiva();
          this.opsRefreshAsignaciones += 1;
          if (this.empresaSeleccionada) {
            this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
          }
          Swal.fire({
            icon: 'success',
            title: 'Asignación eliminada',
            text: mensajeExito || response.message || 'El grupo de documentos fue eliminado correctamente.',
            confirmButtonColor: '#d97248'
          });
        }
      },
      (error) => {
        console.error('Error al eliminar documento:', error);
        const msg = error?.error?.message || 'No se pudo eliminar la asignación. Intente de nuevo.';
        Swal.fire({ icon: 'error', title: 'Error', text: msg, confirmButtonColor: '#d97248' });
      }
    );
  }

  eliminarGrupoDocumento(doc: DocumentoPC): void {
    if (!this.puedeEliminarGrupoDocumentos || !this.empresaSeleccionada) return;

    const total = this.contarElementosGrupoDocumento(doc);
    const detalleHijos = total > 1
      ? `<p class="text-muted small mb-0">Incluye ${total - 1} documento(s) hijo(s) además del grupo principal.</p>`
      : '';

    Swal.fire({
      title: '¿Eliminar asignación completa?',
      html: `
        <p>Se eliminará <strong>${doc.nombre_documento}</strong> y todos los documentos asociados (${total} en total).</p>
        ${detalleHijos}
        <p class="text-danger small mb-0"><strong>Esta acción no se puede deshacer.</strong></p>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, eliminar todo',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.aplicarEliminacionGrupoDocumento(doc);
      }
    });
  }

  eliminarDocumento(doc: DocumentoPC): void {
    Swal.fire({
      title: '¿Eliminar documento?',
      text: `Esta acción eliminará "${doc.nombre_documento}" permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.aplicarEliminacionGrupoDocumento(doc, 'El documento ha sido eliminado');
      }
    });
  }

  private esDocumentoPadreAsignacion(doc: DocumentoPC): boolean {
    return !!(doc.subdocumentos && doc.subdocumentos.length > 0);
  }

  private obtenerPadreDeSubdoc(subdoc: DocumentoPC): DocumentoPC | null {
    for (const doc of this.documentos) {
      if (doc.subdocumentos?.some(s => s.documento_id === subdoc.documento_id)) {
        return doc;
      }
    }
    return null;
  }

  private resolverAsignacionPadre(docEntregado: DocumentoPC): DocumentoPC | null {
    const padre = this.obtenerPadreDeSubdoc(docEntregado);
    if (padre) return padre;
    if (this.esDocumentoPadreAsignacion(docEntregado)) return docEntregado;
    if (this.documentos.some(d => d.documento_id === docEntregado.documento_id)) {
      return docEntregado;
    }
    return null;
  }

  /** SP-F-29 modal deshabilitado: el resolutivo se gestiona en el nodo del centro de operaciones. */
  private async verificarResolutivoTrasEntrega(_docEntregado: DocumentoPC): Promise<boolean> {
    return true;
  }

  // =====================================================
  // GUARDAR TEXTO (tipo_entrada = 'texto')
  // =====================================================

  guardarTextoEmpresa(doc: DocumentoPC, modo: 'manual' | 'confirmado' | 'cambio' = 'manual'): void {
    const texto = (doc.valor_texto || '').trim();
    const docId = doc.documento_id;

    const limpiarEstadoAutollenado = (): void => {
      this.autollenadoOriginalEmpresa.delete(docId);
      this.autollenadoEditandoEmpresa.delete(docId);
    };

    this.backendService.guardarTextoDocumentoPC(docId, texto).subscribe(
      async (resp: any) => {
        if (resp?.estatus) {
          doc.estatus = resp.estatus;
        } else {
          doc.estatus = texto ? 'revision' : 'pendiente';
        }
        this.normalizarEstadoFiltroEmpresa();
        this.normalizarSeccionEmpresaActiva();
        this.normalizarEstadoFiltroSubir();
        this.normalizarSeccionSubirActiva();

        if (doc.autollenado) {
          limpiarEstadoAutollenado();
          this.autollenadoOriginalSubir.delete(docId);
          this.autollenadoEditandoSubir.delete(docId);
        } else {
          if (texto) {
            this.textoEditandoEmpresa.delete(docId);
            this.textoEditandoSubir.delete(docId);
          } else {
            this.textoEditandoEmpresa.add(docId);
            this.textoEditandoSubir.add(docId);
          }
        }

        const resolutivoOk = doc.estatus === 'aprobado'
          ? await this.verificarResolutivoTrasEntrega(doc)
          : true;

        if (modo === 'confirmado') {
          Swal.fire({
            icon: resolutivoOk ? 'success' : 'info',
            title: doc.estatus === 'aprobado' && resolutivoOk ? 'Dato aprobado' : (resolutivoOk ? 'Dato enviado' : 'SP-F-29 pendiente'),
            text: !resolutivoOk
              ? 'Completa el control de resolutivos para finalizar la asignación.'
              : doc.estatus === 'aprobado'
                ? 'No hubo cambios en el autollenado y se aprobó automáticamente.'
                : 'El dato se guardó y quedó en revisión.',
            confirmButtonColor: '#d97248',
            timer: 1800,
            timerProgressBar: true
          });
          return;
        }

        if (modo === 'cambio') {
          Swal.fire({
            icon: resolutivoOk ? 'success' : 'info',
            title: doc.estatus === 'aprobado' && resolutivoOk ? 'Dato aprobado' : (resolutivoOk ? 'Cambio enviado' : 'SP-F-29 pendiente'),
            text: !resolutivoOk
              ? 'Completa el control de resolutivos para finalizar la asignación.'
              : doc.estatus === 'aprobado'
                ? 'No se detectaron cambios y el dato se aprobó automáticamente.'
                : 'Se realizó el cambio y quedó en espera de verificación.',
            confirmButtonColor: '#d97248',
            timer: 1900,
            timerProgressBar: true
          });
          return;
        }

        Swal.fire({
          icon: 'success',
          title: texto ? 'Texto guardado' : 'Valor limpiado',
          confirmButtonColor: '#d97248',
          timer: 1500,
          timerProgressBar: true
        });
      },
      (err: any) => {
        console.error('Error al guardar texto:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar el texto.', confirmButtonColor: '#d97248' });
      }
    );
  }

  // =====================================================
  // SUBIR ARCHIVO
  // =====================================================

  private esArchivoPermitidoPC(file: File): boolean {
    const nombre = String(file?.name || '').toLowerCase();
    const extension = nombre.includes('.') ? `.${nombre.split('.').pop()}` : '';
    const mime = String(file?.type || '').toLowerCase();
    return this.allowedPcExtensions.includes(extension) || this.allowedPcMimeTypes.includes(mime);
  }

  /**
   * Traduce errores de subida a mensajes claros para el usuario (sin jerga técnica).
   */
  private traducirErrorSubidaPC(error: any, mensajeServidor?: string): string {
    const status = Number(error?.status);
    const rawMsg = String(
      mensajeServidor
      || error?.error?.message
      || error?.message
      || ''
    ).trim();
    const raw = rawMsg.toLowerCase();
    const errorName = String(error?.name || '').toLowerCase();

    if (
      status === 0
      || errorName.includes('timeout')
      || /timeout|timed out|network|failed to fetch|err_network|err_connection|err_internet|unknown error|progress event/i.test(raw + ' ' + errorName)
    ) {
      return 'Se perdió la conexión por un momento. Revisa tu internet e inténtalo de nuevo.';
    }

    if (
      status === 413
      || /file too large|limit_file_size|demasiado pesado|supera el tamaño|too large|entity too large|payload too large/i.test(raw)
    ) {
      return `El archivo es demasiado pesado. El tamaño máximo permitido es ${this.maxPcFileMb} MB. Prueba con uno más ligero o comprímelo.`;
    }

    if (status === 401 || status === 403 || /no autorizado|unauthorized|forbidden|sesión|permiso/i.test(raw)) {
      return 'Tu sesión expiró o no tienes permiso para subir este documento. Vuelve a iniciar sesión e inténtalo de nuevo.';
    }

    if (status === 404 || /no encontrado|not found/i.test(raw)) {
      return 'No encontramos el documento al que intentas subir el archivo. Recarga la página e inténtalo de nuevo.';
    }

    if (/no permitido|tipo de archivo|formato|mimetype|file type|extensi[oó]n|cambialo por uno/i.test(raw)) {
      return 'Ese tipo de archivo no está permitido. Usa PDF, imagen, Excel o PowerPoint.';
    }

    if (/drive|almacenamiento|guardar el archivo/i.test(raw)) {
      return 'No se pudo guardar el archivo en el almacenamiento. Espera un momento e inténtalo de nuevo.';
    }

    if (/texto|endpoint de texto/i.test(raw)) {
      return 'Este apartado pide texto, no un archivo. Escribe la información en el campo correspondiente.';
    }

    if (/no se recibi[oó]|no se proporcion[oó]|no file|empty file/i.test(raw)) {
      return 'No se recibió el archivo. Selecciónalo otra vez e inténtalo de nuevo.';
    }

    // Mensaje del servidor ya en lenguaje sencillo (sin códigos técnicos)
    if (rawMsg && !/ECONN|ENOTFOUND|ETIMEDOUT|status code|multer|stack|at Object|Unexpected token|SyntaxError|HTTP/i.test(rawMsg)) {
      return rawMsg;
    }

    if (status >= 500) {
      return 'Hubo un problema al guardar el archivo. Inténtalo de nuevo en unos minutos.';
    }

    return 'No se pudo subir el archivo. Inténtalo de nuevo.';
  }

  onArchivoSeleccionado(event: any, doc: DocumentoPC): void {
    const files = Array.from(event?.target?.files || []) as File[];
    if (!files.length) return;
    this.validarYSubirArchivos(files, doc);
    // Permitir volver a elegir el mismo archivo después de un error
    try { event.target.value = ''; } catch { /* ignore */ }
  }

  private validarYSubirArchivo(file: File, doc: DocumentoPC): void {
    this.validarYSubirArchivos([file], doc);
  }

  private validarYSubirArchivos(files: File[], doc: DocumentoPC): void {
    const validos: File[] = [];
    for (const file of files) {
      if (!this.esArchivoPermitidoPC(file)) {
        Swal.fire({
          icon: 'error',
          title: 'Archivo no permitido',
          text: `"${file.name}" no es un formato aceptado. Usa imágenes, PDF, Excel (XLS/XLSX) o PowerPoint (PPT/PPTX).`,
          confirmButtonColor: '#d97248'
        });
        return;
      }
      if (file.size > this.maxPcFileBytes) {
        Swal.fire({
          icon: 'error',
          title: 'Archivo muy pesado',
          text: `"${file.name}" supera el tamaño máximo de ${this.maxPcFileMb} MB.`,
          confirmButtonColor: '#d97248'
        });
        return;
      }
      validos.push(file);
    }
    if (!validos.length) return;
    this.subirArchivos(validos, doc);
  }

  private subirArchivos(files: File[], doc: DocumentoPC): void {
    const empresaId = this.getEmpresaIdActual();
    if (!empresaId) return;

    this.subiendoArchivo = true;
    const total = files.length;
    Swal.fire({
      title: total > 1 ? `Subiendo ${total} archivos...` : 'Subiendo archivo...',
      html: total > 1
        ? 'Se están subiendo los archivos, espere unos segundos.'
        : 'Se está subiendo el archivo, espere unos segundos.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    const subirUno = (index: number): void => {
      if (index >= files.length) {
        this.subiendoArchivo = false;
        Swal.close();
        this.finalizarSubidaExitosa(doc, total);
        return;
      }

      const file = files[index];
      const formData = new FormData();
      formData.append('archivo', file);
      formData.append('empresa_id', empresaId.toString());
      formData.append('documento_id', doc.documento_id.toString());

      this.backendService.subirArchivoProteccionCivil(formData).subscribe(
        (response: any) => {
          if (!response?.success) {
            this.subiendoArchivo = false;
            Swal.close();
            Swal.fire({
              icon: 'error',
              title: 'No se pudo subir',
              text: this.traducirErrorSubidaPC(null, response?.message),
              confirmButtonColor: '#d97248'
            });
            return;
          }
          this.aplicarRespuestaSubidaArchivo(doc, response, file.name);
          subirUno(index + 1);
        },
        (error) => {
          console.error('Error al subir archivo:', error);
          this.subiendoArchivo = false;
          Swal.close();
          Swal.fire({
            icon: 'error',
            title: 'No se pudo subir',
            text: this.traducirErrorSubidaPC(error),
            confirmButtonColor: '#d97248'
          });
        }
      );
    };

    subirUno(0);
  }

  private aplicarRespuestaSubidaArchivo(doc: DocumentoPC, response: any, fallbackName: string): void {
    if (Array.isArray(response.archivos)) {
      doc.archivos = response.archivos;
    } else {
      const lista = this.getArchivosDocumento(doc).slice();
      lista.push({
        archivo_id: response.archivo_id || null,
        documento_id: doc.documento_id,
        drive_file_id: response.url || response.drive_file_id || '',
        nombre_archivo: response.nombre_archivo || fallbackName,
        fecha_subida: new Date().toISOString()
      });
      doc.archivos = lista;
    }
    this.sincronizarCamposLegacyDesdeArchivos(doc);
    if (response.estatus) {
      doc.estatus = response.estatus;
    } else if (doc.estatus === 'pendiente' || doc.estatus === 'rechazado') {
      doc.estatus = 'revision';
    }
  }

  private async finalizarSubidaExitosa(doc: DocumentoPC, total: number): Promise<void> {
    this.normalizarEstadoFiltroSubir();
    this.normalizarSeccionSubirActiva();

    const resolutivoOk = doc.estatus === 'aprobado'
      ? await this.verificarResolutivoTrasEntrega(doc)
      : true;

    if (doc.estatus === 'aprobado' && resolutivoOk) {
      this.estadoFiltroSubir = 'aprobado';
    } else if (!resolutivoOk) {
      this.estadoFiltroSubir = 'pendiente';
    }

    const plural = total > 1;
    Swal.fire({
      icon: resolutivoOk ? 'success' : 'info',
      title: resolutivoOk ? 'Subido' : 'SP-F-29 pendiente',
      text: !resolutivoOk
        ? 'Completa el control de resolutivos para finalizar la asignación PIPC.'
        : (plural
          ? 'Archivos cargados. Puedes agregar más o marcar el requisito como entregado.'
          : 'Archivo cargado. Puedes agregar más o marcar el requisito como entregado.'),
      confirmButtonColor: '#d97248'
    });
    if (this.vistaActual === 'menuDocumentos' && this.empresaSeleccionada) {
      this.cargarCentroOperaciones(this.empresaSeleccionada.empresa_id);
    }
    if (!this.esUsuarioEmpresa && this.estaEnSubirDocumentosOperaciones() && !this.requiereAccionSubirDocumentosAdmin) {
      this.asegurarPasoOperacionesSeleccionadoValido();
    }
  }

  subirArchivo(file: File, doc: DocumentoPC): void {
    this.subirArchivos([file], doc);
  }

  // =====================================================
  // ELIMINAR ARCHIVO (sin eliminar la asignación del documento)
  // =====================================================

  eliminarArchivo(doc: DocumentoPC): void {
    if (!this.getArchivosDocumento(doc).length) return;

    Swal.fire({
      title: '¿Eliminar archivos?',
      text: 'Esto eliminará todos los archivos del requerimiento, pero mantendrá la asignación.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        const empresaId = this.getEmpresaIdActual();
        if (!empresaId) return;

        this.backendService.eliminarArchivoProteccionCivil(
          empresaId,
          doc.documento_id
        ).subscribe(
          (response: any) => {
            if (response.success) {
              doc.archivos = [];
              doc.nombre_archivo = null;
              doc.archivo_url = null;
              doc.fecha_subida = null;
              doc.estatus = 'pendiente';
              Swal.fire('Eliminado', 'Los archivos han sido eliminados', 'success');
            }
          },
          (error) => {
            console.error('Error al eliminar archivo:', error);
            doc.archivos = [];
            doc.nombre_archivo = null;
            doc.archivo_url = null;
            doc.fecha_subida = null;
            doc.estatus = 'pendiente';
            Swal.fire('Eliminado', 'Archivos eliminados (modo local)', 'success');
          }
        );
      }
    });
  }

  eliminarArchivoEspecifico(doc: DocumentoPC, archivo: ArchivoPC, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!archivo?.archivo_id) {
      // Legacy sin id: eliminar todos (comportamiento anterior)
      this.eliminarArchivo(doc);
      return;
    }

    Swal.fire({
      title: '¿Eliminar archivo?',
      text: `Se eliminará "${archivo.nombre_archivo}" de este requerimiento.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;
      const empresaId = this.getEmpresaIdActual();
      if (!empresaId) return;

      this.backendService.eliminarArchivoEspecificoProteccionCivil(
        empresaId,
        doc.documento_id,
        archivo.archivo_id as number
      ).subscribe(
        (response: any) => {
          if (!response?.success) return;
          doc.archivos = Array.isArray(response.archivos) ? response.archivos : this.getArchivosDocumento(doc).filter(
            (a) => a.archivo_id !== archivo.archivo_id
          );
          this.sincronizarCamposLegacyDesdeArchivos(doc);
          if (response.estatus) {
            doc.estatus = response.estatus;
          } else if (!doc.archivos?.length) {
            doc.estatus = 'pendiente';
          }
          Swal.fire('Eliminado', 'El archivo ha sido eliminado', 'success');
        },
        (error) => {
          console.error('Error al eliminar archivo:', error);
          Swal.fire('Error', 'No se pudo eliminar el archivo', 'error');
        }
      );
    });
  }

  visualizarArchivoDeRequisito(doc: DocumentoPC, archivo: ArchivoPC): void {
    this.visualizarDocumento({
      ...doc,
      archivo_url: archivo.drive_file_id || null,
      nombre_archivo: archivo.nombre_archivo || doc.nombre_archivo,
      fecha_subida: archivo.fecha_subida || doc.fecha_subida
    });
  }

  // =====================================================
  // UTILIDADES
  // =====================================================

  getIniciales(nombre: string): string {
    if (!nombre) return '??';
    const palabras = nombre.split(' ');
    if (palabras.length >= 2) {
      return (palabras[0][0] + palabras[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  getColorAvatar(index: number): string {
    const colores = ['bg-gradient-success', 'bg-gradient-info', 'bg-gradient-primary', 'bg-gradient-warning', 'bg-gradient-danger'];
    return colores[index % colores.length];
  }

  getLogoEmpresaUrl(empresa: EmpresaPC): string | null {
    return this.backendService.resolverUrlDrivePreview(empresa?.logo || empresa?.logo_url);
  }

  onLogoError(empresa: EmpresaPC): void {
    if (!empresa) return;
    empresa.logo = null;
    empresa.logo_url = null;
  }

  getEstatusClass(estatus: string): string {
    switch (estatus) {
      case 'aprobado': return 'badge-success';
      case 'rechazado': return 'badge-danger';
      default: return 'badge-secondary'; // pendiente
    }
  }

  getEstatusIcon(estatus: string): string {
    switch (estatus) {
      case 'aprobado': return 'fa-check-circle';
      case 'rechazado': return 'fa-times-circle';
      case 'revision': return 'fa-search';
      default: return 'fa-hourglass-half'; // pendiente
    }
  }

  getEstatusTexto(estatus: string): string {
    switch (estatus) {
      case 'aprobado': return 'APROBADO';
      case 'rechazado': return 'RECHAZADO';
      case 'revision': return 'EN REVISION';
      default: return 'PENDIENTE';
    }
  }

  getProgresoDocumentos(empresa: EmpresaPC): number {
    if (!empresa.documentos_totales) return 0;
    return Math.round((empresa.documentos_completos / empresa.documentos_totales) * 100);
  }

  documentosCompletosEmpresa(empresa: EmpresaPC): boolean {
    return this.getProgresoDocumentos(empresa) === 100;
  }

  getPasosProcesoEmpresa(empresa: EmpresaPC): PasoCentroOperacionesId[] {
    const raw = Array.isArray(empresa?.pasos_completados) ? empresa.pasos_completados : [];
    const pasos = raw.filter((paso): paso is PasoCentroOperacionesId =>
      this.pcPasosProcesoIds.includes(paso as PasoCentroOperacionesId)
    );
    const unicos = Array.from(new Set(pasos));
    if ((Number(empresa.documentos_totales) || 0) > 0 && !unicos.includes('asignar')) {
      unicos.push('asignar');
    }
    if (this.documentosCompletosEmpresa(empresa) && !unicos.includes('documentacion')) {
      unicos.push('documentacion');
    }
    return unicos;
  }

  getProgresoProceso(empresa: EmpresaPC): number {
    if (empresa?.ciclo_cerrado) return 100;
    const pasos = this.getPasosProcesoEmpresa(empresa);
    const done = this.pcPasosRequeridosTramite.filter((paso) => pasos.includes(paso)).length;
    return Math.round((done / this.pcPasosRequeridosTramite.length) * 100);
  }

  isProcesoCompleto(empresa: EmpresaPC): boolean {
    if (empresa?.ciclo_cerrado) return true;
    const pasos = this.getPasosProcesoEmpresa(empresa);
    return this.pcPasosRequeridosTramite.every((paso) => pasos.includes(paso));
  }

  getPendientesTramite(empresa: EmpresaPC): Array<{ id: PasoCentroOperacionesId; label: string; opcional: boolean }> {
    const pasos = this.getPasosProcesoEmpresa(empresa);
    return this.pcPasosTramitePendientes.filter((item) => !pasos.includes(item.id));
  }

  getTextoPendientesTramite(empresa: EmpresaPC): string {
    return this.formatearPendientesTramite(this.getPendientesTramite(empresa));
  }

  private formatearPendientesTramite(
    pendientes: Array<{ label: string; opcional: boolean }>
  ): string {
    if (!pendientes.length) return '';
    const requeridos = pendientes.filter((item) => !item.opcional).map((item) => item.label);
    const opcionales = pendientes.filter((item) => item.opcional).map((item) => `${item.label} (opcional)`);
    const partes: string[] = [];
    if (requeridos.length) {
      partes.push(`Falta ${this.unirListaEs(requeridos)}`);
    }
    if (opcionales.length) {
      partes.push(opcionales.join(', '));
    }
    return partes.join('. ');
  }

  private unirListaEs(items: string[]): string {
    if (items.length <= 1) return items[0] || '';
    return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
  }

  // Control del dropdown de estatus
  toggleDropdown(docId: number, event?: MouseEvent): void {
    if (this.dropdownAbierto === docId) {
      this.dropdownAbierto = null;
      this.botonDropdownActivo = null;
    } else {
      this.dropdownAbierto = docId;
      // Guardar referencia al botón y calcular posición
      if (event) {
        // Buscar el botón padre si el click fue en un elemento hijo (icono)
        let button = event.target as HTMLElement;
        while (button && !button.classList.contains('estatus-btn')) {
          button = button.parentElement as HTMLElement;
        }
        this.botonDropdownActivo = button;
        this.actualizarPosicionDropdown();
      }
    }
  }

  cerrarDropdown(): void {
    this.dropdownAbierto = null;
    this.botonDropdownActivo = null;
  }

  // =====================================================
  // GESTIÓN DE CATÁLOGO DE DOCUMENTOS
  // =====================================================

  inicializarCatalogoDocumentos(): void {
    this.catalogoDocumentos = [
      { id: 1, nombre: 'Constancia uso suelo', tipo: 'Legal', disponible: true },
      { id: 2, nombre: 'Dicta Impacto Amb Tiza', tipo: 'Ambiental', disponible: true },
      { id: 3, nombre: 'Documentos Base', tipo: 'General', disponible: true },
      { id: 4, nombre: 'Documentación básica', tipo: 'General', disponible: true },
      { id: 5, nombre: 'Documentos pendientes', tipo: 'General', disponible: true },
      { id: 6, nombre: 'Estudio VYR', tipo: 'Técnico', disponible: true },
      { id: 7, nombre: 'Estudio VYR Estado', tipo: 'Técnico', disponible: true },
      { id: 8, nombre: 'MIA Estado', tipo: 'Ambiental', disponible: true },
      { id: 9, nombre: 'MIA Estatal', tipo: 'Ambiental', disponible: true },
      { id: 10, nombre: 'NOM-030', tipo: 'Normativa', disponible: true },
      { id: 11, nombre: 'LAE Estatal', tipo: 'Legal', disponible: true },
      { id: 12, nombre: 'LAE Hidalgo', tipo: 'Legal', disponible: true },
      { id: 13, nombre: 'Lic. US Mineral Reforma', tipo: 'Legal', disponible: true },
      { id: 14, nombre: 'Licencia de construcción', tipo: 'Legal', disponible: true },
      { id: 15, nombre: 'Licencia de uso de suelo', tipo: 'Legal', disponible: true },
      { id: 16, nombre: 'Licencia uso suelo Tiza', tipo: 'Legal', disponible: true },
      { id: 17, nombre: 'Permiso Transportista 1', tipo: 'Operativo', disponible: true },
      { id: 18, nombre: 'PC Municipio', tipo: 'Protección Civil', disponible: true },
      { id: 19, nombre: 'PIPC Tizayuca', tipo: 'Protección Civil', disponible: true },
      { id: 20, nombre: 'PIPC Ciudad de México', tipo: 'Protección Civil', disponible: true },
      { id: 21, nombre: 'PIPC Edo. México', tipo: 'Protección Civil', disponible: true },
      { id: 22, nombre: 'PIPC Hidalgo Edo.', tipo: 'Protección Civil', disponible: true },
      { id: 23, nombre: 'PIPC Mineral Reforma', tipo: 'Protección Civil', disponible: true },
      { id: 24, nombre: 'PIPC Municipio', tipo: 'Protección Civil', disponible: true },
      { id: 25, nombre: 'PT2', tipo: 'Técnico', disponible: true },
      { id: 26, nombre: 'Residuo peligroso', tipo: 'Ambiental', disponible: true },
      { id: 27, nombre: 'Residuos Manejo Especial', tipo: 'Ambiental', disponible: true },
      { id: 28, nombre: 'Riesgo incendio', tipo: 'Seguridad', disponible: true },
      { id: 29, nombre: 'RME-AGUA', tipo: 'Ambiental', disponible: true },
      { id: 30, nombre: 'RPBI Transporte', tipo: 'Sanitario', disponible: true }
    ];
    this.catalogoDocumentosFiltrados = [...this.catalogoDocumentos];
    
    // Extraer tipos únicos para el panel de categorías
    const tiposUnicos = [...new Set(this.catalogoDocumentos.map(doc => doc.tipo))];
    this.tiposCatalogo = ['Todos', ...tiposUnicos.sort()];
    this.tipoSeleccionado = 'Todos';
  }

  abrirCatalogoDocumentos(): void {
    this.vistaActual = 'catalogo';
    this.textoBusquedaCatalogo = '';
    this.catalogoDocumentosFiltrados = [...this.catalogoDocumentos];
  }

  cerrarCatalogoDocumentos(): void {
    this.vistaActual = 'empresas';
    this.textoBusquedaCatalogo = '';
  }

  filtrarCatalogo(): void {
    let documentosFiltrados = [...this.catalogoDocumentos];
    
    // Filtrar por tipo seleccionado
    if (this.tipoSeleccionado !== 'Todos') {
      documentosFiltrados = documentosFiltrados.filter(doc => doc.tipo === this.tipoSeleccionado);
    }
    
    // Filtrar por búsqueda de texto
    if (this.textoBusquedaCatalogo && this.textoBusquedaCatalogo.trim()) {
      const texto = this.textoBusquedaCatalogo.toLowerCase().trim();
      documentosFiltrados = documentosFiltrados.filter(doc =>
        doc.nombre.toLowerCase().includes(texto) ||
        doc.tipo.toLowerCase().includes(texto)
      );
    }
    
    this.catalogoDocumentosFiltrados = documentosFiltrados;
  }
  
  seleccionarTipoCatalogo(tipo: string): void {
    this.tipoSeleccionado = tipo;
    this.filtrarCatalogo();
  }
  
  contarDocumentosPorTipo(tipo: string): number {
    if (tipo === 'Todos') {
      return this.catalogoDocumentos.length;
    }
    return this.catalogoDocumentos.filter(doc => doc.tipo === tipo).length;
  }

  visualizarDocumentoCatalogo(doc: DocumentoCatalogo): void {
    this.documentoSeleccionado = { ...doc };
    this.mostrarModalVisualizadorCatalogo = true;
  }
  
  cerrarModalVisualizadorCatalogo(): void {
    this.mostrarModalVisualizadorCatalogo = false;
    this.documentoSeleccionado = null;
  }

  cerrarModalDetalle(): void {
    this.mostrarModalDetalle = false;
    this.documentoSeleccionado = null;
  }

  guardarNombreDocumento(): void {
    if (!this.documentoSeleccionado || !this.documentoSeleccionado.nombre.trim()) {
      Swal.fire('Error', 'El nombre no puede estar vacío', 'error');
      return;
    }

    const docIndex = this.catalogoDocumentos.findIndex(d => d.id === this.documentoSeleccionado!.id);
    if (docIndex !== -1) {
      this.catalogoDocumentos[docIndex].nombre = this.documentoSeleccionado.nombre;
      
      // Actualizar filtrados también
      const filterIndex = this.catalogoDocumentosFiltrados.findIndex(d => d.id === this.documentoSeleccionado!.id);
      if (filterIndex !== -1) {
        this.catalogoDocumentosFiltrados[filterIndex].nombre = this.documentoSeleccionado.nombre;
      }

      Swal.fire({
        icon: 'success',
        title: 'Nombre actualizado',
        showConfirmButton: false,
        timer: 1500
      });
    }
  }

  volverACatalogo(): void {
    this.vistaActual = 'catalogo';
    this.documentoSeleccionado = null;
  }

  abrirModalAgregarDocumentoCatalogo(): void {
    Swal.fire({
      title: 'Agregar Nuevo Documento',
      html: `
        <div class="text-left">
          <div class="form-group">
            <label class="font-weight-bold">Nombre del Documento</label>
            <input type="text" class="form-control" id="nombreDocumento" placeholder="Ej: Licencia de Funcionamiento">
          </div>
          <div class="form-group">
            <label class="font-weight-bold">Archivo (opcional)</label>
            <div class="custom-file">
              <input type="file" class="custom-file-input" id="archivoDocumento" accept=".pdf,.jpg,.jpeg,.png">
              <label class="custom-file-label" for="archivoDocumento">Seleccionar archivo...</label>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Agregar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombreInput = document.getElementById('nombreDocumento') as HTMLInputElement;
        const archivoInput = document.getElementById('archivoDocumento') as HTMLInputElement;
        
        const nombre = nombreInput?.value.trim();
        const archivo = archivoInput?.files?.[0];
        
        if (!nombre) {
          Swal.showValidationMessage('El nombre es obligatorio');
          return false;
        }
        return { nombre, archivo };
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const nuevoId = Math.max(...this.catalogoDocumentos.map(d => d.id), 0) + 1;
        const nuevoDoc: DocumentoCatalogo = {
          id: nuevoId,
          nombre: result.value.nombre,
          tipo: 'General',
          disponible: result.value.archivo ? true : false
        };
        this.catalogoDocumentos.push(nuevoDoc);
        this.catalogoDocumentosFiltrados.push(nuevoDoc); // Add to filtered list too
        Swal.fire('Agregado', 'El documento ha sido agregado al catálogo', 'success');
      }
    });
  }

  reemplazarDocumentoCatalogo(doc: DocumentoCatalogo): void {
    Swal.fire({
      title: 'Reemplazar documento',
      html: `
        <div class="text-left">
          <p>Estás a punto de reemplazar: <strong>${doc.nombre}</strong></p>
          <div class="custom-file mt-3">
            <input type="file" class="custom-file-input" id="archivoReemplazo" accept=".pdf,.jpg,.jpeg,.png">
            <label class="custom-file-label" for="archivoReemplazo">Seleccionar archivo...</label>
          </div>
          <small class="text-muted mt-2 d-block">Formatos permitidos: PDF, JPG, PNG (Máx. ${this.maxPcFileMb} MB)</small>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-sync-alt mr-1"></i> Reemplazar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const input = document.getElementById('archivoReemplazo') as HTMLInputElement;
        const label = document.querySelector('.custom-file-label') as HTMLElement;
        if (input && label) {
          input.addEventListener('change', (e: any) => {
            const fileName = e.target.files[0]?.name || 'Seleccionar archivo...';
            label.textContent = fileName;
          });
        }
      },
      preConfirm: () => {
        const input = document.getElementById('archivoReemplazo') as HTMLInputElement;
        const file = input?.files?.[0];
        if (!file) {
          Swal.showValidationMessage('Debes seleccionar un archivo');
          return false;
        }
        // Validar tamaño
        if (file.size > this.maxPcFileBytes) {
          Swal.showValidationMessage(`El archivo no puede superar los ${this.maxPcFileMb} MB`);
          return false;
        }
        return file;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        // Aquí iría la lógica para subir el archivo al servidor
        Swal.fire({
          title: '¡Documento reemplazado!',
          html: `
            <div class="text-center">
              <i class="fas fa-check-circle fa-3x mb-3" style="color: #d97248;"></i>
              <p>El documento <strong>${doc.nombre}</strong> ha sido reemplazado exitosamente.</p>
              <p class="text-muted">Archivo: ${result.value.name}</p>
            </div>
          `,
          icon: 'success',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  eliminarDocumentoCatalogo(doc: DocumentoCatalogo): void {
    Swal.fire({
      title: '¿Eliminar documento?',
      html: `
        <div class="text-center">
          <i class="fas fa-exclamation-triangle fa-3x text-warning mb-3"></i>
          <p>Estás a punto de eliminar: <strong>${doc.nombre}</strong></p>
          <p class="text-danger"><strong>Esta acción no se puede deshacer.</strong></p>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        // Eliminar del array local
        this.catalogoDocumentos = this.catalogoDocumentos.filter(d => d.id !== doc.id);
        this.catalogoDocumentosFiltrados = this.catalogoDocumentosFiltrados.filter(d => d.id !== doc.id);
        
        // Aquí iría la llamada al backend para eliminar del servidor
        Swal.fire({
          title: '¡Eliminado!',
          html: `
            <div class="text-center">
              <i class="fas fa-check-circle fa-3x mb-3" style="color: #d97248;"></i>
              <p>El documento <strong>${doc.nombre}</strong> ha sido eliminado del catálogo.</p>
            </div>
          `,
          icon: 'success',
          confirmButtonColor: '#d97248',
          timer: 2000
        });
      }
    });
  }

  descargarDocumentoCatalogo(doc: DocumentoCatalogo): void {
    if (!doc.disponible) {
      Swal.fire('No disponible', 'Este documento aún no está disponible para descarga', 'info');
      return;
    }
    // Aquí podrías implementar la lógica para descargar el documento
    // Por ahora mostramos un mensaje informativo
    Swal.fire({
      title: 'Descargando documento',
      html: `
        <div class="text-center">
          <i class="fas fa-download fa-3x mb-3" style="color: #d97248;"></i>
          <p>Preparando descarga de: <strong>${doc.nombre}</strong></p>
          <p class="text-muted">La funcionalidad de descarga estará disponible próximamente.</p>
        </div>
      `,
      icon: 'info',
      confirmButtonColor: '#d97248',
      confirmButtonText: 'Entendido'
    });
  }

  // =====================================================
  // ESTADÍSTICAS RESOLUTIVOS PIPC (GRÁFICOS)
  // =====================================================

  private initResolutivosCharts(): void {
    this.resolutivosChartOptions = {
      series: [],
      chart: {
        type: 'bar',
        height: 380,
        stacked: true,
        toolbar: { show: false },
        fontFamily: 'Open Sans, sans-serif',
        redrawOnParentResize: true,
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 800,
          animateGradually: { enabled: true, delay: 120 },
          dynamicAnimation: { enabled: true, speed: 350 }
        }
      },
      colors: this.resolutivosEstatusOrder.map((key) => this.resolutivosEstatusConfig[key]?.color || '#8898aa'),
      plotOptions: {
        bar: {
          columnWidth: '54%',
          borderRadius: 6,
          borderRadiusApplication: 'end',
          borderRadiusWhenStacked: 'last'
        }
      },
      dataLabels: { enabled: false },
      fill: { type: 'solid', opacity: 0.95 },
      stroke: { width: 0, colors: ['transparent'] },
      xaxis: {
        categories: [],
        labels: { style: { colors: '#8898aa', fontSize: '12px', fontWeight: 600 } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          style: { colors: '#8898aa', fontSize: '11px' },
          formatter: (val: number) => Math.round(val).toString()
        },
        min: 0,
        forceNiceScale: true
      },
      grid: {
        borderColor: '#f0f0f0',
        strokeDashArray: 5,
        padding: { top: -8, right: 8, bottom: 0, left: 4 },
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } }
      },
      legend: {
        position: 'bottom',
        horizontalAlign: 'center',
        fontSize: '12px',
        fontWeight: 600,
        offsetY: 8,
        itemMargin: { horizontal: 14, vertical: 4 },
        markers: { width: 10, height: 10, radius: 3 } as any
      },
      tooltip: {
        shared: true,
        intersect: false,
        theme: 'light',
        style: { fontSize: '12px' },
        y: {
          formatter: (val: number) => `${val} resolutivo${val !== 1 ? 's' : ''}`
        }
      }
    };
  }

  cargarEstadisticasResolutivos(anio: number = this.resolutivosAnio): void {
    if (!this.puedeVerGraficaActividadResolutivosPipc) return;

    this.cargandoResolutivosEstadisticas = true;
    this.resolutivosChartsReady = false;
    this.backendService.obtenerEstadisticasResolutivosPipc(anio).subscribe({
      next: (response: any) => {
        if (response?.success && response.estadisticas) {
          this.actualizarGraficosResolutivos(response.estadisticas);
        } else {
          this.limpiarGraficosResolutivos();
        }
        this.cargandoResolutivosEstadisticas = false;
      },
      error: () => {
        this.limpiarGraficosResolutivos();
        this.cargandoResolutivosEstadisticas = false;
      }
    });
  }

  private limpiarGraficosResolutivos(): void {
    this.resolutivosEstatusCards = [];
    this.resolutivosEstatusResumen = { total: 0 };
    this.resolutivosActividadResumen = { totalAnio: 0, promedioMensual: 0, variacionMensual: 0 };
    this.resolutivosChartOptions = {
      ...this.resolutivosChartOptions,
      series: this.resolutivosEstatusOrder.map((estatus) => ({
        name: this.resolutivosEstatusConfig[estatus]?.label || estatus,
        data: []
      })),
      xaxis: { ...this.resolutivosChartOptions.xaxis, categories: [] }
    };
    this.resolutivosChartsReady = true;
  }

  private actualizarGraficosResolutivos(estadisticas: any): void {
    const porMes = Array.isArray(estadisticas.por_mes) ? estadisticas.por_mes : [];
    const labels = porMes.map((item: any) => item.mes_label);
    const series = this.resolutivosEstatusOrder.map((estatus) => ({
      name: this.resolutivosEstatusConfig[estatus]?.label || estatus,
      data: porMes.map((mes: any) => {
        const match = (mes.por_estatus || []).find((row: any) => row.estatus === estatus);
        return Number(match?.total || 0);
      })
    }));

    this.resolutivosChartOptions = {
      ...this.resolutivosChartOptions,
      series,
      colors: this.resolutivosEstatusOrder.map((key) => this.resolutivosEstatusConfig[key]?.color || '#8898aa'),
      xaxis: { ...this.resolutivosChartOptions.xaxis, categories: labels }
    };

    this.resolutivosActividadResumen = {
      totalAnio: Number(estadisticas.total_anio || 0),
      promedioMensual: Number(estadisticas.promedio_mensual || 0),
      variacionMensual: Number(estadisticas.variacion_mensual || 0)
    };

    const distribucion = Array.isArray(estadisticas.distribucion) ? estadisticas.distribucion : [];
    const total = Number(estadisticas.total || 0);
    this.resolutivosEstatusResumen = { total };

    this.resolutivosEstatusCards = this.resolutivosEstatusOrder
      .map((estatus) => {
        const item = distribucion.find((row: any) => row.estatus === estatus);
        const count = Number(item?.total || 0);
        const cfg = this.resolutivosEstatusConfig[estatus];
        return {
          key: estatus,
          label: cfg.label,
          count,
          pct: total > 0 ? +((count * 100) / total).toFixed(1) : 0,
          color: cfg.color,
          icono: cfg.icono
        };
      })
      .filter((card) => card.count > 0 || total > 0);

    this.resolutivosChartsReady = true;
  }

  getResolutivosDeltaClass(valor: number): string {
    if (valor > 0) return 'pc-resolutivos-delta--up';
    if (valor < 0) return 'pc-resolutivos-delta--down';
    return 'pc-resolutivos-delta--neutral';
  }

  formatResolutivosDelta(valor: number): string {
    const num = Number(valor || 0);
    if (num > 0) return `+${num}%`;
    if (num < 0) return `${num}%`;
    return '0%';
  }

}
