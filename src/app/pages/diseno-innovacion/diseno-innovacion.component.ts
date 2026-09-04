import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfThumbnailService } from 'src/app/services/pdf-thumbnail.service';

export type VistaDisenoInnovacion = 'catalogo' | 'historial';
export type ModoVistaCatalogo = 'grid' | 'lista';
export type CategoriaSign = 'biznaga' | 'iso';
export type CategoriaFiltro = 'all' | CategoriaSign;
export type TipoCotizacion = 'produccion' | 'cliente';
export type ModoRegistro = 'individual' | 'carpeta';
export type FormaSenal =
  | 'circular'
  | 'rectangular'
  | 'cuadrada'
  | 'hexagonal'
  | 'octogonal'
  | 'personalizado';
export type ClasificacionSign =
  | 'advertencia'
  | 'obligacion'
  | 'prohibicion'
  | 'equipo_incendios'
  | 'condicion_segura'
  | 'personalizado';

export interface InnovacionSignItem {
  id: number;
  apartadoOficial: number | null;
  categoria: CategoriaSign;
  nombreSenal: string;
  descripcion: string;
  clasificacion: string | null;
  costoUnitario: number | null;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  subidoPor: string | null;
  fechaSubida: string;
  actualizadoPor: string | null;
  fechaActualizacion: string;
}

export interface CotLineaForm {
  uid: string;
  signId: number | null;
  forma: FormaSenal;
  formaPersonalizadoTexto: string;
  distanciaM: number | null;
  largoCm: number | null;
  anchoCm: number | null;
  cantidad: number;
  materiales: Record<string, boolean>;
  notas: string;
  costoUnitario: number | null;
}

export interface InnovacionCotizacionProyectoItem {
  id: number;
  folio: string;
  empresaId: number | null;
  empresaNombre: string;
  nombreProyecto: string;
  fechaCotizacion: string;
  tipoCotizacion: TipoCotizacion;
  subtotal: number;
  iva: number;
  totalNeto: number;
  driveFileId: string | null;
  webViewLink: string | null;
  creadoPor: string | null;
  fechaCreacion: string;
  activo?: boolean;
  desactivadoPor?: string | null;
  fechaDesactivacion?: string | null;
  lineas: Array<{
    id: number;
    orden: number;
    signId: number;
    nombreSenal: string;
    clasificacion: string | null;
    forma: string;
    formaPersonalizadoTexto?: string | null;
    distanciaVisualizacionM?: number | null;
    largoCm?: number | null;
    anchoCm?: number | null;
    tamanoTexto: string;
    materiales: string[];
    cantidad: number;
    costoUnitario: number;
    subtotal: number;
    notas?: string | null;
  }>;
}

export interface EmpresaOpcion {
  id: number;
  nombre: string;
}

export interface InnovacionCotizacionItem {
  id: number;
  signId: number;
  tipoCotizacion: TipoCotizacion;
  cotizacionOrigenId: number | null;
  signNombreSenal: string;
  signDescripcion: string;
  signNombreArchivo: string;
  forma: FormaSenal;
  aristasPersonalizado: number | null;
  formaPersonalizadoTexto: string | null;
  distanciaVisualizacionM: number | null;
  largoCm: number;
  anchoCm: number;
  areaCm2: number | null;
  cantidad: number;
  materiales: string[];
  notas: string | null;
  esMixta: boolean;
  creadoPor: string | null;
  fechaCreacion: string;
}

export interface InnovacionMaterialItem {
  id: number;
  slug: string;
  label: string;
  activo: boolean;
}

interface CategoriaOpcion {
  id: CategoriaFiltro;
  label: string;
  icon: string;
}

interface MiniaturaEstado {
  url: SafeResourceUrl | null;
  cargando: boolean;
  error: boolean;
}

@Component({
  selector: 'app-diseno-innovacion',
  templateUrl: './diseno-innovacion.component.html',
  styleUrls: ['./diseno-innovacion.component.scss']
})
export class DisenoInnovacionComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private miniaturaObjectUrls = new Map<number, string>();

  readonly categoriasFiltro: CategoriaOpcion[] = [
    { id: 'all', label: 'Todas', icon: 'fa-th' },
    { id: 'biznaga', label: 'Biznaga', icon: 'fa-leaf' },
    { id: 'iso', label: 'ISO', icon: 'fa-certificate' }
  ];

  readonly categorias: { id: CategoriaSign; label: string }[] = [
    { id: 'biznaga', label: 'Biznaga' },
    { id: 'iso', label: 'ISO' }
  ];

  readonly formas: { id: FormaSenal; label: string }[] = [
    { id: 'circular', label: 'Circular' },
    { id: 'rectangular', label: 'Rectangular' },
    { id: 'cuadrada', label: 'Cuadrada' },
    { id: 'hexagonal', label: 'Hexagonal' },
    { id: 'octogonal', label: 'Octogonal' },
    { id: 'personalizado', label: 'Personalizado' }
  ];

  readonly clasificaciones: { id: ClasificacionSign; label: string; color: string }[] = [
    { id: 'advertencia', label: 'Advertencia', color: '#f59e0b' },
    { id: 'obligacion', label: 'Obligación', color: '#2563eb' },
    { id: 'prohibicion', label: 'Prohibición', color: '#e5e7eb' },
    { id: 'equipo_incendios', label: 'Equipo contra incendios', color: '#dc2626' },
    { id: 'condicion_segura', label: 'Condición segura', color: '#16a34a' },
    { id: 'personalizado', label: 'Personalizado', color: '#6b7280' }
  ];

  vistaActiva: VistaDisenoInnovacion = 'catalogo';
  modoVistaCatalogo: ModoVistaCatalogo = 'grid';
  categoriaFiltro: CategoriaFiltro = 'all';
  clasificacionFiltro: ClasificacionSign | 'all' = 'all';

  signs: InnovacionSignItem[] = [];
  signsFiltrados: InnovacionSignItem[] = [];
  cotizaciones: InnovacionCotizacionItem[] = [];
  cotizacionesProyecto: InnovacionCotizacionProyectoItem[] = [];
  tipoHistorial: TipoCotizacion = 'produccion';
  materialesOpciones: InnovacionMaterialItem[] = [];
  miniaturas: Record<number, MiniaturaEstado> = {};
  empresas: EmpresaOpcion[] = [];

  cargandoSigns = false;
  cargandoHistorial = false;
  cargandoMateriales = false;
  descargandoExcelCotizaciones = false;
  errorSigns: string | null = null;
  errorHistorial: string | null = null;
  busquedaCatalogo = '';

  signAccion: InnovacionSignItem | null = null;
  eliminandoSignId: number | null = null;

  mostrarVisorSign = false;
  visorSignCargando = false;
  visorSignError: string | null = null;
  signVisor: InnovacionSignItem | null = null;
  visorSignUrl: SafeResourceUrl | null = null;
  private visorSignObjectUrl: string | null = null;
  private visorSignRequestId = 0;

  mostrarRegistro = false;
  registroModo: ModoRegistro = 'individual';
  registroNombreSenal = '';
  registroDescripcion = '';
  registroCategoria: CategoriaSign = 'biznaga';
  registroArchivo: File | null = null;
  registroPreviewUrl: SafeUrl | null = null;
  private registroPreviewObjectUrl: string | null = null;
  registroArchivosCarpeta: File[] = [];
  registroArchivosOmitidos = 0;
  guardandoRegistro = false;

  editandoSign: InnovacionSignItem | null = null;
  editNombreSenal = '';
  editClasificacion: ClasificacionSign | '' = '';
  editCostoUnitario: number | null = null;
  editCategoria: CategoriaSign = 'biznaga';
  editArchivo: File | null = null;
  editPreviewUrl: SafeUrl | null = null;
  private editPreviewObjectUrl: string | null = null;
  guardandoEdicion = false;

  mostrarCotizacion = false;
  signSeleccionado: InnovacionSignItem | null = null;
  cotPaso: 1 | 2 | 3 = 1;
  previewCotizacionUrl: SafeResourceUrl | null = null;
  cargandoPreviewCotizacion = false;
  errorPreviewCotizacion = false;
  private previewCotizacionObjectUrl: string | null = null;
  cotLayoutImagen: 'cuadrado' | 'vertical' | 'horizontal' = 'cuadrado';
  previewImagenAspectRatio: string | null = null;

  cotEmpresaId: number | null = null;
  cotEmpresaNombre = '';
  cotNombreProyecto = '';
  cotFecha = '';
  cotFolio = '';
  cotTipo: TipoCotizacion = 'produccion';
  cotLineas: CotLineaForm[] = [];
  cotizacionOrigenId: number | null = null;
  cotProyectoEditandoId: number | null = null;
  mostrarDropdownEmpresa = false;
  desactivandoCotizacion = false;
  nuevoMaterialNombre = '';
  guardandoMaterial = false;
  ultimoCampoTamaño: 'largo' | 'ancho' = 'largo';
  guardandoCotizacion = false;
  cargandoEmpresas = false;
  cargandoFolio = false;
  lineasColapsadas = new Set<string>();

  morphActivo = false;
  morphStyle: Record<string, string> = {};
  panelFlotanteStyle: Record<string, string> = {};
  panelLado: 'left' | 'right' = 'right';
  panelModoDesktop = false;

  private readonly MORPH_DURATION_MS = 360;
  private readonly PANEL_BREAKPOINT_DESKTOP = 992;
  private readonly PANEL_ANCHO_BASE = 240;
  private readonly BORRADOR_COTIZACION_KEY = 'di_cotizacion_borrador_v1';
  private morphTimeout: ReturnType<typeof setTimeout> | null = null;
  private panelPositionTimeout: ReturnType<typeof setTimeout> | null = null;
  private borradorCotizacionTimeout: ReturnType<typeof setTimeout> | null = null;
  private costoSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  private costoSyncPendiente = new Map<number, number>();

  constructor(
    private backend: BackendServices,
    private sanitizer: DomSanitizer,
    private pdfThumbnail: PdfThumbnailService
  ) {}

  ngOnInit(): void {
    this.actualizarModoPanel();
    this.cargarMateriales();
    this.cargarSigns();
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
    if (this.borradorCotizacionTimeout) {
      clearTimeout(this.borradorCotizacionTimeout);
      this.borradorCotizacionTimeout = null;
    }
    if (this.costoSyncTimeout) {
      clearTimeout(this.costoSyncTimeout);
      this.costoSyncTimeout = null;
    }
    this.limpiarMiniaturas();
    this.revocarRegistroPreview();
    this.revocarEditPreview();
    this.revocarPreviewCotizacion();
    this.revocarVisorSign();
    this.destroy$.next();
    this.destroy$.complete();
  }

  seleccionarModoVistaCatalogo(modo: ModoVistaCatalogo): void {
    if (this.modoVistaCatalogo === modo) {
      return;
    }
    this.modoVistaCatalogo = modo;
  }

  seleccionarVista(vista: VistaDisenoInnovacion): void {
    this.vistaActiva = vista;
    if (vista === 'catalogo') {
      this.cargarSigns();
    }
    if (vista === 'historial') {
      this.cargarHistorial();
    }
    if (vista !== 'catalogo') {
      this.cerrarRegistro();
      this.cerrarSeleccionSign();
    }
  }

  volverAlCatalogo(): void {
    this.seleccionarVista('catalogo');
  }

  seleccionarCategoriaFiltro(cat: CategoriaFiltro): void {
    this.categoriaFiltro = cat;
    this.aplicarFiltroCatalogo();
  }

  cargarMateriales(): void {
    this.cargandoMateriales = true;
    this.backend
      .listarInnovacionMateriales()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.materialesOpciones = Array.isArray(res?.materiales) ? res.materiales : [];
          this.sincronizarCheckboxesMateriales();
          this.cargandoMateriales = false;
        },
        error: () => {
          this.materialesOpciones = [
            { id: 1, slug: 'trovicel', label: 'Trovicel', activo: true },
            { id: 2, slug: 'fotoluminiscente', label: 'Impresión fotoluminiscente', activo: true }
          ];
          this.sincronizarCheckboxesMateriales();
          this.cargandoMateriales = false;
        }
      });
  }

  sincronizarCheckboxesMateriales(): void {
    for (const linea of this.cotLineas) {
      const next: Record<string, boolean> = {};
      for (const m of this.materialesOpciones) {
        next[m.slug] = linea.materiales[m.slug] ?? false;
      }
      linea.materiales = next;
    }
  }

  private crearMaterialesVacios(): Record<string, boolean> {
    const next: Record<string, boolean> = {};
    for (const m of this.materialesOpciones) {
      next[m.slug] = false;
    }
    return next;
  }

  private crearLineaCotizacionVacia(sign?: InnovacionSignItem | null): CotLineaForm {
    return {
      uid: `linea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      signId: sign?.id ?? null,
      forma: 'rectangular',
      formaPersonalizadoTexto: '',
      distanciaM: null,
      largoCm: null,
      anchoCm: null,
      cantidad: 1,
      materiales: this.crearMaterialesVacios(),
      notas: '',
      costoUnitario: sign?.costoUnitario ?? null
    };
  }

  async agregarMaterial(): Promise<void> {
    const label = this.nuevoMaterialNombre.trim();
    if (!label || this.guardandoMaterial) {
      return;
    }
    this.guardandoMaterial = true;
    try {
      const res = await firstValueFrom(
        this.backend.crearInnovacionMaterial({ label }).pipe(takeUntil(this.destroy$))
      );
      const material = res?.material as InnovacionMaterialItem | undefined;
      if (material) {
        this.materialesOpciones = [...this.materialesOpciones, material].sort((a, b) =>
          a.label.localeCompare(b.label, 'es')
        );
        for (const linea of this.cotLineas) {
          linea.materiales = { ...linea.materiales, [material.slug]: false };
        }
      } else {
        this.cargarMateriales();
      }
      this.nuevoMaterialNombre = '';
      Swal.fire('Material agregado', 'Ya está disponible para futuras cotizaciones.', 'success');
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo guardar el material.', 'error');
    } finally {
      this.guardandoMaterial = false;
    }
  }

  cargarSigns(): void {
    this.cargandoSigns = true;
    this.errorSigns = null;
    this.limpiarMiniaturas();
    this.backend
      .listarInnovacionSigns()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.signs = (Array.isArray(res?.signs) ? res.signs : []).map(s => ({
            ...s,
            categoria: (s.categoria === 'iso' ? 'iso' : 'biznaga') as CategoriaSign,
            nombreSenal: s.nombreSenal || s.nombre_senal || '',
            clasificacion: s.clasificacion ?? null,
            costoUnitario:
              s.costoUnitario != null
                ? Number(s.costoUnitario)
                : s.costo_unitario != null
                  ? Number(s.costo_unitario)
                  : null
          }));
          this.aplicarFiltroCatalogo();
          this.cargandoSigns = false;
        },
        error: err => {
          this.errorSigns = err?.error?.message || err?.message || 'No se pudo cargar el catálogo.';
          this.cargandoSigns = false;
        }
      });
  }

  cargarHistorial(): void {
    this.cargandoHistorial = true;
    this.errorHistorial = null;

    const cotizaciones$ = this.backend.listarInnovacionCotizaciones().pipe(takeUntil(this.destroy$));
    const proyectos$ = this.backend
      .listarInnovacionCotizacionesProyecto()
      .pipe(takeUntil(this.destroy$));

    Promise.all([
      firstValueFrom(cotizaciones$).catch(err => ({ __error: err, cotizaciones: [] })),
      firstValueFrom(proyectos$).catch(err => ({ __error: err, cotizaciones: [] }))
    ]).then(([resCot, resProy]) => {
      const errCot = (resCot as any)?.__error;
      const errProy = (resProy as any)?.__error;

      this.cotizaciones = (Array.isArray((resCot as any)?.cotizaciones)
        ? (resCot as any).cotizaciones
        : []
      ).map((c: any) => ({
        ...c,
        tipoCotizacion: c.tipoCotizacion === 'cliente' ? 'cliente' : 'produccion',
        cotizacionOrigenId: c.cotizacionOrigenId != null ? Number(c.cotizacionOrigenId) : null,
        signNombreSenal: c.signNombreSenal || c.sign_nombre_senal || ''
      }));

      this.cotizacionesProyecto = (Array.isArray((resProy as any)?.proyectos)
        ? (resProy as any).proyectos
        : Array.isArray((resProy as any)?.cotizaciones)
          ? (resProy as any).cotizaciones
          : []
      ).map((p: any) => this.mapearCotizacionProyecto(p));

      this.precargarMiniaturasHistorial();
      this.cargandoHistorial = false;

      if (errCot && errProy) {
        this.errorHistorial =
          errCot?.error?.message ||
          errCot?.message ||
          errProy?.error?.message ||
          errProy?.message ||
          'No se pudo cargar el historial.';
      }
    });
  }

  private mapearCotizacionProyecto(p: any): InnovacionCotizacionProyectoItem {
    return {
      id: Number(p.id),
      folio: p.folio || '',
      empresaId: p.empresaId != null ? Number(p.empresaId) : p.empresa_id != null ? Number(p.empresa_id) : null,
      empresaNombre: p.empresaNombre || p.empresa_nombre || '',
      nombreProyecto: p.nombreProyecto || p.nombre_proyecto || '',
      fechaCotizacion: p.fechaCotizacion || p.fecha_cotizacion || '',
      tipoCotizacion: p.tipoCotizacion === 'cliente' || p.tipo_cotizacion === 'cliente' ? 'cliente' : 'produccion',
      subtotal: Number(p.subtotal ?? 0),
      iva: Number(p.iva ?? 0),
      totalNeto: Number(p.totalNeto ?? p.total_neto ?? 0),
      driveFileId: p.driveFileId || p.drive_file_id || null,
      webViewLink: p.webViewLink || p.web_view_link || null,
      creadoPor: p.creadoPor || p.creado_por || null,
      fechaCreacion: p.fechaCreacion || p.fecha_creacion || '',
      activo: p.activo == null ? true : p.activo === true || Number(p.activo) === 1,
      desactivadoPor: p.desactivadoPor || p.desactivado_por || null,
      fechaDesactivacion: p.fechaDesactivacion || p.desactivado_at || null,
      lineas: (Array.isArray(p.lineas) ? p.lineas : []).map((l: any, idx: number) => ({
        id: Number(l.id ?? idx),
        orden: Number(l.orden ?? idx + 1),
        signId: Number(l.signId ?? l.sign_id ?? 0),
        nombreSenal: l.nombreSenal || l.nombre_senal || '',
        clasificacion: l.clasificacion ?? null,
        forma: l.forma || '',
        formaPersonalizadoTexto: l.formaPersonalizadoTexto ?? l.forma_personalizado_texto ?? null,
        distanciaVisualizacionM:
          l.distanciaVisualizacionM != null
            ? Number(l.distanciaVisualizacionM)
            : l.distancia_visualizacion_m != null
              ? Number(l.distancia_visualizacion_m)
              : null,
        largoCm: l.largoCm != null ? Number(l.largoCm) : l.largo_cm != null ? Number(l.largo_cm) : null,
        anchoCm: l.anchoCm != null ? Number(l.anchoCm) : l.ancho_cm != null ? Number(l.ancho_cm) : null,
        tamanoTexto: l.tamanoTexto || l.tamano_texto || '',
        materiales: Array.isArray(l.materiales)
          ? l.materiales
          : typeof l.materiales_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(l.materiales_json);
                } catch {
                  return [];
                }
              })()
            : [],
        cantidad: Number(l.cantidad ?? 0),
        costoUnitario: Number(l.costoUnitario ?? l.costo_unitario ?? 0),
        subtotal: Number(l.subtotal ?? 0),
        notas: l.notas ?? null
      }))
    };
  }

  signsPorCategoria(cat: CategoriaSign): InnovacionSignItem[] {
    return this.signsFiltrados.filter(s => (s.categoria || 'biznaga') === cat);
  }

  get signsVisibles(): InnovacionSignItem[] {
    if (this.categoriaFiltro === 'all') {
      return this.signsFiltrados;
    }
    return this.signsPorCategoria(this.categoriaFiltro);
  }

  get totalSignsCatalogo(): number {
    return this.signsFiltrados.length;
  }

  get cotizacionesFiltradas(): InnovacionCotizacionItem[] {
    return this.cotizaciones.filter(c => c.tipoCotizacion === this.tipoHistorial);
  }

  totalCotizacionesTipo(tipo: TipoCotizacion): number {
    return this.cotizaciones.filter(c => c.tipoCotizacion === tipo).length;
  }

  seleccionarTipoHistorial(tipo: TipoCotizacion): void {
    this.tipoHistorial = tipo;
  }

  get countBiznaga(): number {
    return this.signsPorCategoria('biznaga').length;
  }

  get countIso(): number {
    return this.signsPorCategoria('iso').length;
  }

  aplicarFiltroCatalogo(): void {
    const q = this.busquedaCatalogo.trim().toLowerCase();
    const clasif = this.clasificacionFiltro;
    this.signsFiltrados = this.signs.filter(s => {
      if (clasif !== 'all' && (s.clasificacion || '') !== clasif) {
        return false;
      }
      if (!q) {
        return true;
      }
      const nombre = (s.nombreSenal || '').toLowerCase();
      const desc = (s.descripcion || '').toLowerCase();
      const clasifLabel = this.etiquetaClasificacion(s.clasificacion).toLowerCase();
      return (
        nombre.includes(q) ||
        desc.includes(q) ||
        clasifLabel.includes(q) ||
        s.nombreArchivo.toLowerCase().includes(q)
      );
    });
    if (
      this.signAccion &&
      !this.signsFiltrados.some(s => s.id === this.signAccion!.id)
    ) {
      this.cerrarSeleccionSign();
    }
    this.precargarMiniaturas(this.signsFiltrados);
  }

  seleccionarSignCatalogo(sign: InnovacionSignItem): void {
    if (this.signAccion?.id === sign.id) {
      return;
    }

    const origenRect = this.obtenerRectTarjetaSign(sign.id);
    this.signAccion = sign;
    this.programarRecalculoPanel();
    this.animarMorphHaciaPanel(origenRect);
  }

  esSignSeleccionado(sign: InnovacionSignItem): boolean {
    return this.signAccion?.id === sign.id;
  }

  esSignDesenfocado(sign: InnovacionSignItem): boolean {
    if (!this.signAccion) {
      return false;
    }
    return sign.id !== this.signAccion.id;
  }

  cerrarSeleccionSign(): void {
    this.signAccion = null;
    this.panelFlotanteStyle = {};
  }

  elegirAccionEditar(): void {
    if (!this.signAccion) {
      return;
    }
    const sign = this.signAccion;
    this.cerrarSeleccionSign();
    this.abrirEdicion(sign);
  }

  elegirAccionVisualizar(): void {
    if (!this.signAccion) {
      return;
    }
    const sign = this.signAccion;
    this.cerrarSeleccionSign();
    this.abrirVisorSign(sign);
  }

  abrirVisorSign(sign: InnovacionSignItem): void {
    this.revocarVisorSign();
    this.signVisor = sign;
    this.mostrarVisorSign = true;
    this.visorSignCargando = true;
    this.visorSignError = null;
    const requestId = ++this.visorSignRequestId;

    this.backend
      .descargarInnovacionSignArchivo(sign.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          if (requestId !== this.visorSignRequestId || !this.mostrarVisorSign) {
            return;
          }
          this.visorSignObjectUrl = URL.createObjectURL(blob);
          this.visorSignUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.visorSignObjectUrl);
          this.visorSignCargando = false;
        },
        error: async err => {
          if (requestId !== this.visorSignRequestId || !this.mostrarVisorSign) {
            return;
          }
          this.visorSignError = await this.extraerMensajeErrorBlob(err);
          this.visorSignCargando = false;
        }
      });
  }

  cerrarVisorSign(): void {
    this.visorSignRequestId++;
    this.mostrarVisorSign = false;
    this.signVisor = null;
    this.visorSignCargando = false;
    this.visorSignError = null;
    this.revocarVisorSign();
  }

  descargarSignVisor(): void {
    const sign = this.signVisor;
    if (!sign) {
      return;
    }
    if (this.visorSignObjectUrl) {
      this.dispararDescarga(this.visorSignObjectUrl, sign.nombreArchivo);
      return;
    }
    this.backend
      .descargarInnovacionSignArchivo(sign.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          this.dispararDescarga(url, sign.nombreArchivo);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => Swal.fire('Error', 'No se pudo descargar el archivo.', 'error')
      });
  }

  elegirAccionCotizacion(): void {
    if (!this.signAccion) {
      return;
    }
    const sign = this.signAccion;
    this.cerrarSeleccionSign();
    this.abrirCotizacion(sign);
  }

  async elegirAccionEliminar(): Promise<void> {
    const sign = this.signAccion;
    if (!sign || this.eliminandoSignId != null) {
      return;
    }

    const confirmacion = await Swal.fire({
      title: '¿Eliminar señalización?',
      text: `Se eliminará "${this.nombreSign(sign)}", su archivo en Drive y sus cotizaciones relacionadas. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
      reverseButtons: true
    });
    if (!confirmacion.isConfirmed) {
      return;
    }

    this.eliminandoSignId = sign.id;
    try {
      await firstValueFrom(
        this.backend.eliminarInnovacionSign(sign.id).pipe(takeUntil(this.destroy$))
      );
      this.cerrarSeleccionSign();
      await Swal.fire('Eliminado', 'La señalización se eliminó de la base de datos y de Drive.', 'success');
      this.cargarSigns();
    } catch (err: any) {
      Swal.fire(
        'No se pudo eliminar',
        err?.error?.message || err?.message || 'No fue posible eliminar la señalización.',
        'error'
      );
    } finally {
      this.eliminandoSignId = null;
    }
  }

  abrirRegistro(categoria: CategoriaSign = 'biznaga'): void {
    this.mostrarRegistro = true;
    this.registroModo = 'individual';
    this.registroNombreSenal = '';
    this.registroDescripcion = '';
    this.registroCategoria = categoria;
    this.registroArchivosCarpeta = [];
    this.registroArchivosOmitidos = 0;
    this.quitarArchivoRegistro();
  }

  cerrarRegistro(): void {
    if (this.guardandoRegistro) {
      return;
    }
    this.mostrarRegistro = false;
    this.registroNombreSenal = '';
    this.registroDescripcion = '';
    this.registroArchivosCarpeta = [];
    this.registroArchivosOmitidos = 0;
    this.quitarArchivoRegistro();
  }

  seleccionarModoRegistro(modo: ModoRegistro): void {
    if (this.guardandoRegistro || this.registroModo === modo) {
      return;
    }
    this.registroModo = modo;
    this.registroArchivosCarpeta = [];
    this.registroArchivosOmitidos = 0;
    this.quitarArchivoRegistro();
  }

  onCarpetaRegistro(event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    const permitidos = archivos.filter(file => this.esArchivoPermitido(file));
    this.registroArchivosOmitidos = archivos.length - permitidos.length;
    this.registroArchivosCarpeta = permitidos;
    if (!permitidos.length && archivos.length) {
      Swal.fire('Sin documentos compatibles', 'La carpeta no contiene archivos JPG, JPEG, PNG o PDF.', 'warning');
    }
  }

  onArchivoRegistro(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!this.esArchivoPermitido(file)) {
      Swal.fire('Formato no válido', 'Use JPG, JPEG, PNG o PDF.', 'warning');
      return;
    }
    this.revocarRegistroPreview();
    this.registroArchivo = file;
    if (this.esImagen(file)) {
      this.registroPreviewObjectUrl = URL.createObjectURL(file);
      this.registroPreviewUrl = this.sanitizer.bypassSecurityTrustUrl(this.registroPreviewObjectUrl);
    }
  }

  quitarArchivoRegistro(): void {
    this.revocarRegistroPreview();
    this.registroArchivo = null;
  }

  async guardarRegistro(): Promise<void> {
    if (this.registroModo === 'carpeta') {
      await this.guardarCarpetaRegistro();
      return;
    }
    if (this.guardandoRegistro) {
      return;
    }
    if (!this.registroArchivo) {
      Swal.fire('Archivo requerido', 'Seleccione una imagen o PDF.', 'warning');
      return;
    }
    if (!this.registroNombreSenal.trim()) {
      Swal.fire('Nombre requerido', 'Agregue el nombre de la señal.', 'warning');
      return;
    }
    if (!this.registroDescripcion.trim()) {
      Swal.fire('Descripción requerida', 'Agregue una descripción para la señalización.', 'warning');
      return;
    }

    this.guardandoRegistro = true;
    Swal.fire({
      title: 'Guardando señalización',
      text: 'Estamos registrando la información y cargando el archivo.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });
    try {
      const base64 = await this.archivoABase64(this.registroArchivo);
      await firstValueFrom(
        this.backend
          .crearInnovacionSign({
            categoria: this.registroCategoria,
            nombre_senal: this.registroNombreSenal.trim(),
            descripcion: this.registroDescripcion.trim(),
            nombre_archivo: this.registroArchivo.name,
            mime_type: this.registroArchivo.type || this.mimeDesdeNombre(this.registroArchivo.name),
            archivo_base64: base64
          })
          .pipe(takeUntil(this.destroy$))
      );

      Swal.close();
      this.guardandoRegistro = false;
      this.cerrarRegistro();
      this.cargarSigns();
      await Swal.fire('Guardado', 'Señalización registrada correctamente.', 'success');
    } catch (err: any) {
      Swal.close();
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo guardar.', 'error');
    } finally {
      this.guardandoRegistro = false;
    }
  }

  private async guardarCarpetaRegistro(): Promise<void> {
    if (this.guardandoRegistro) {
      return;
    }
    if (!this.registroArchivosCarpeta.length) {
      Swal.fire('Carpeta requerida', 'Seleccione una carpeta con imágenes o documentos PDF.', 'warning');
      return;
    }

    this.guardandoRegistro = true;
    const total = this.registroArchivosCarpeta.length;
    let guardados = 0;
    const fallidos: string[] = [];
    Swal.fire({
      title: 'Subiendo carpeta',
      html: `Preparando ${total} documento(s)…`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    for (let indice = 0; indice < total; indice++) {
      const archivo = this.registroArchivosCarpeta[indice];
      Swal.update({
        html: `Subiendo <strong>${indice + 1} de ${total}</strong><br><small>${archivo.name}</small>`
      });
      try {
        const base64 = await this.archivoABase64(archivo);
        await firstValueFrom(
          this.backend
            .crearInnovacionSign({
              categoria: this.registroCategoria,
              nombre_senal: this.nombreDesdeArchivo(archivo.name),
              descripcion: '',
              nombre_archivo: archivo.name,
              mime_type: archivo.type || this.mimeDesdeNombre(archivo.name),
              archivo_base64: base64,
              permitir_incompleto: true
            })
            .pipe(takeUntil(this.destroy$))
        );
        guardados++;
      } catch {
        fallidos.push(archivo.name);
      }
    }

    Swal.close();
    this.guardandoRegistro = false;
    if (guardados > 0) {
      this.cerrarRegistro();
      this.cargarSigns();
    }
    if (!fallidos.length) {
      await Swal.fire(
        'Carpeta registrada',
        `${guardados} documento(s) se subieron correctamente. El nombre se tomó de cada archivo; complete después la descripción desde Editar.`,
        'success'
      );
      return;
    }
    await Swal.fire({
      title: guardados ? 'Carga completada parcialmente' : 'No se pudo cargar la carpeta',
      html: `${guardados} documento(s) guardado(s).<br>${fallidos.length} archivo(s) no pudieron subirse.`,
      icon: guardados ? 'warning' : 'error'
    });
  }

  abrirEdicion(sign: InnovacionSignItem): void {
    this.editandoSign = sign;
    this.editNombreSenal = sign.nombreSenal || sign.descripcion;
    this.editClasificacion = this.normalizarClasificacion(sign.clasificacion);
    this.editCostoUnitario = sign.costoUnitario;
    this.editCategoria = sign.categoria || 'biznaga';
    this.editArchivo = null;
    this.revocarEditPreview();
  }

  cerrarEdicion(): void {
    if (this.guardandoEdicion) {
      return;
    }
    this.editandoSign = null;
    this.editNombreSenal = '';
    this.editClasificacion = '';
    this.editCostoUnitario = null;
    this.editArchivo = null;
    this.revocarEditPreview();
  }

  onArchivoEdicion(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!this.esArchivoPermitido(file)) {
      Swal.fire('Formato no válido', 'Use JPG, JPEG, PNG o PDF.', 'warning');
      return;
    }
    this.revocarEditPreview();
    this.editArchivo = file;
    if (this.esImagen(file)) {
      this.editPreviewObjectUrl = URL.createObjectURL(file);
      this.editPreviewUrl = this.sanitizer.bypassSecurityTrustUrl(this.editPreviewObjectUrl);
    }
  }

  async guardarEdicion(): Promise<void> {
    if (!this.editandoSign || this.guardandoEdicion) {
      return;
    }
    if (!this.editNombreSenal.trim()) {
      Swal.fire('Nombre requerido', 'El nombre de señal no puede estar vacío.', 'warning');
      return;
    }
    if (!this.editClasificacion) {
      Swal.fire('Clasificación requerida', 'Seleccione una clasificación.', 'warning');
      return;
    }

    this.guardandoEdicion = true;
    try {
      const payload: {
        nombre_senal: string;
        clasificacion: ClasificacionSign;
        costo_unitario: number | null;
        categoria: CategoriaSign;
        nombre_archivo?: string;
        mime_type?: string;
        archivo_base64?: string;
      } = {
        nombre_senal: this.editNombreSenal.trim(),
        clasificacion: this.editClasificacion,
        costo_unitario: this.editCostoUnitario,
        categoria: this.editCategoria
      };

      if (this.editArchivo) {
        payload.nombre_archivo = this.editArchivo.name;
        payload.mime_type = this.editArchivo.type || this.mimeDesdeNombre(this.editArchivo.name);
        payload.archivo_base64 = await this.archivoABase64(this.editArchivo);
      }

      await firstValueFrom(
        this.backend
          .actualizarInnovacionSign(this.editandoSign.id, payload)
          .pipe(takeUntil(this.destroy$))
      );

      Swal.fire('Actualizado', 'El registro se actualizó correctamente.', 'success');
      this.cerrarEdicion();
      this.cargarSigns();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo actualizar.', 'error');
    } finally {
      this.guardandoEdicion = false;
    }
  }

  seleccionarSignCotizacion(sign: InnovacionSignItem): void {
    this.abrirCotizacion(sign);
  }

  abrirCotizacion(sign: InnovacionSignItem): void {
    this.abrirCotizacionProyecto();
    if (this.cotLineas.length) {
      this.cotLineas[0].signId = sign.id;
      this.cotLineas[0].costoUnitario = sign.costoUnitario;
    }
    this.signSeleccionado = sign;
    this.cargarPreviewCotizacion(sign.id);
  }

  abrirCotizacionProyecto(): void {
    this.mostrarCotizacion = true;
    this.signSeleccionado = null;
    this.cotProyectoEditandoId = null;
    this.mostrarDropdownEmpresa = false;
    const restaurado = this.restaurarBorradorCotizacion();
    if (!restaurado) {
      this.resetFormCotizacion();
    }
    this.cargarEmpresasCotizacion();
    if (!this.cotFolio) {
      this.cargarFolioCotizacion();
    }
  }

  editarCotizacionProyecto(proyecto: InnovacionCotizacionProyectoItem): void {
    if (!proyecto?.id) {
      return;
    }
    this.mostrarCotizacion = true;
    this.signSeleccionado = null;
    this.mostrarDropdownEmpresa = false;
    this.limpiarBorradorCotizacion();
    this.resetFormCotizacion();
    this.cotProyectoEditandoId = proyecto.id;
    this.cargarEmpresasCotizacion();

    Swal.fire({
      title: 'Cargando cotización',
      text: 'Preparando la edición…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.backend
      .obtenerInnovacionCotizacionProyecto(proyecto.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          Swal.close();
          const raw = res?.proyecto || res;
          const p = this.mapearCotizacionProyecto(raw || proyecto);
          this.aplicarCotizacionProyectoAlFormulario(p);
        },
        error: () => {
          Swal.close();
          this.aplicarCotizacionProyectoAlFormulario(proyecto);
        }
      });
  }

  private aplicarCotizacionProyectoAlFormulario(p: InnovacionCotizacionProyectoItem): void {
    this.cotProyectoEditandoId = p.id;
    this.cotEmpresaId = p.empresaId;
    this.cotEmpresaNombre = p.empresaNombre || '';
    this.cotNombreProyecto = p.nombreProyecto || '';
    this.cotFecha = this.normalizarFechaIso(p.fechaCotizacion) || this.fechaHoyIso();
    this.cotFolio = p.folio || '';
    this.cotTipo = p.tipoCotizacion === 'cliente' ? 'cliente' : 'produccion';
    this.cotPaso = 1;
    this.cotizacionOrigenId = null;

    const lineas = (p.lineas || []).map(l => {
      const materiales = this.crearMaterialesVacios();
      for (const slug of l.materiales || []) {
        materiales[slug] = true;
      }
      let largo = l.largoCm != null ? Number(l.largoCm) : null;
      let ancho = l.anchoCm != null ? Number(l.anchoCm) : null;
      if ((largo == null || ancho == null) && l.tamanoTexto) {
        const m = String(l.tamanoTexto).match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
        if (m) {
          largo = largo ?? Number(m[1]);
          ancho = ancho ?? Number(m[2]);
        }
      }
      return {
        uid: `linea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        signId: l.signId || null,
        forma: (l.forma || 'rectangular') as FormaSenal,
        formaPersonalizadoTexto: String(l.formaPersonalizadoTexto || ''),
        distanciaM: l.distanciaVisualizacionM != null ? Number(l.distanciaVisualizacionM) : null,
        largoCm: largo,
        anchoCm: ancho,
        cantidad: Number(l.cantidad || 1),
        materiales,
        notas: String(l.notas || ''),
        costoUnitario: l.costoUnitario != null ? Number(l.costoUnitario) : null
      } as CotLineaForm;
    });

    this.cotLineas = lineas.length ? lineas : [this.crearLineaCotizacionVacia()];
    this.lineasColapsadas = new Set();
    const signIds = this.cotLineas.map(l => l.signId).filter((id): id is number => !!id);
    const signs = this.signs.filter(s => signIds.includes(s.id));
    if (signs.length) {
      this.precargarMiniaturas(signs);
    }
    if (this.cotLineas[0]?.signId) {
      this.cargarPreviewCotizacion(this.cotLineas[0].signId);
    }
  }

  private normalizarFechaIso(valor: string | Date | null | undefined): string {
    if (!valor) {
      return '';
    }
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return valor.toISOString().slice(0, 10);
    }
    const s = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  get empresasFiltradas(): EmpresaOpcion[] {
    const q = this.cotEmpresaNombre.trim().toLowerCase();
    if (!q) {
      return this.empresas;
    }
    return this.empresas.filter(e => e.nombre.toLowerCase().includes(q));
  }

  get puedeUsarEmpresaNueva(): boolean {
    const q = this.cotEmpresaNombre.trim();
    if (!q) {
      return false;
    }
    return !this.empresas.some(e => e.nombre.toLowerCase() === q.toLowerCase());
  }

  inicialesEmpresa(nombre: string): string {
    const partes = String(nombre || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!partes.length) {
      return 'EM';
    }
    if (partes.length === 1) {
      return partes[0].slice(0, 2).toUpperCase();
    }
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  abrirDropdownEmpresa(): void {
    this.mostrarDropdownEmpresa = true;
  }

  cerrarDropdownEmpresa(): void {
    this.mostrarDropdownEmpresa = false;
  }

  onEmpresaBusquedaChange(texto: string): void {
    this.cotEmpresaNombre = texto;
    const match = this.empresas.find(
      e => e.nombre.toLowerCase() === String(texto || '').trim().toLowerCase()
    );
    this.cotEmpresaId = match ? match.id : null;
    this.mostrarDropdownEmpresa = true;
    this.programarGuardadoBorradorCotizacion();
  }

  seleccionarEmpresaCotizacion(emp: EmpresaOpcion): void {
    this.cotEmpresaId = emp.id;
    this.cotEmpresaNombre = emp.nombre;
    this.mostrarDropdownEmpresa = false;
    this.programarGuardadoBorradorCotizacion();
  }

  confirmarEmpresaNueva(): void {
    const nombre = this.cotEmpresaNombre.trim();
    if (!nombre) {
      return;
    }
    this.cotEmpresaId = null;
    this.cotEmpresaNombre = nombre;
    this.mostrarDropdownEmpresa = false;
    this.programarGuardadoBorradorCotizacion();
  }

  limpiarEmpresaCotizacion(event?: Event): void {
    event?.stopPropagation();
    this.cotEmpresaId = null;
    this.cotEmpresaNombre = '';
    this.mostrarDropdownEmpresa = true;
    this.programarGuardadoBorradorCotizacion();
  }

  async desactivarCotizacionProyectoActual(): Promise<void> {
    if (!this.cotProyectoEditandoId || this.desactivandoCotizacion || this.guardandoCotizacion) {
      return;
    }
    const folio = this.cotFolio || String(this.cotProyectoEditandoId);
    const result = await Swal.fire({
      title: '¿Desactivar cotización?',
      html: `<p class="mb-0">La cotización <strong>${this.escapeHtml(folio)}</strong> se ocultará del historial, pero permanecerá guardada en la base de datos.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b45309',
      cancelButtonColor: '#6c757d'
    });
    if (!result.isConfirmed) {
      return;
    }

    this.desactivandoCotizacion = true;
    try {
      await firstValueFrom(
        this.backend
          .desactivarInnovacionCotizacionProyecto(this.cotProyectoEditandoId)
          .pipe(takeUntil(this.destroy$))
      );
      this.limpiarBorradorCotizacion();
      this.resetFormCotizacion();
      this.mostrarCotizacion = false;
      this.signSeleccionado = null;
      this.revocarPreviewCotizacion();
      this.seleccionarVista('historial');
      this.cargarHistorial();
      await Swal.fire(
        'Desactivada',
        'La cotización ya no aparece en el historial. El registro se conserva en la base de datos.',
        'success'
      );
    } catch (err: any) {
      Swal.fire(
        'Error',
        err?.error?.message || err?.message || 'No se pudo desactivar la cotización.',
        'error'
      );
    } finally {
      this.desactivandoCotizacion = false;
    }
  }

  agregarLineaCotizacion(): void {
    // Colapsa las líneas previas para liberar espacio vertical.
    for (const linea of this.cotLineas) {
      this.lineasColapsadas.add(linea.uid);
    }
    const nueva = this.crearLineaCotizacionVacia();
    this.cotLineas = [...this.cotLineas, nueva];
    this.lineasColapsadas.delete(nueva.uid);
    this.lineasColapsadas = new Set(this.lineasColapsadas);
    this.programarGuardadoBorradorCotizacion();
  }

  eliminarLineaCotizacion(uid: string, event?: Event): void {
    event?.stopPropagation();
    if (this.cotLineas.length <= 1) {
      return;
    }
    const linea = this.cotLineas.find(l => l.uid === uid);
    const nombre = linea ? this.tituloLineaCotizacion(linea, this.cotLineas.indexOf(linea)) : 'esta señalización';
    Swal.fire({
      title: '¿Quitar señalización?',
      html: `<p class="mb-0">Se quitará <strong>${this.escapeHtml(nombre)}</strong> de la cotización.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d'
    }).then(result => {
      if (!result.isConfirmed) {
        return;
      }
      this.cotLineas = this.cotLineas.filter(l => l.uid !== uid);
      this.lineasColapsadas.delete(uid);
      this.lineasColapsadas = new Set(this.lineasColapsadas);
      this.programarGuardadoBorradorCotizacion();
    });
  }

  tituloLineaCotizacion(linea: CotLineaForm, index: number): string {
    const nombre = this.nombreSignPorId(linea.signId);
    if (nombre && nombre !== '—') {
      return nombre;
    }
    return `Señalización ${index + 1}`;
  }

  resumenLineaColapsada(linea: CotLineaForm): string {
    const partes: string[] = [];
    if (linea.forma) {
      partes.push(this.etiquetaForma(linea.forma));
    }
    if (linea.largoCm != null && linea.anchoCm != null) {
      partes.push(`${linea.largoCm}×${linea.anchoCm} cm`);
    }
    if (linea.cantidad) {
      partes.push(`×${linea.cantidad}`);
    }
    return partes.join(' · ');
  }

  estaLineaColapsada(uid: string): boolean {
    return this.lineasColapsadas.has(uid);
  }

  toggleLineaColapsada(uid: string): void {
    if (this.lineasColapsadas.has(uid)) {
      this.lineasColapsadas.delete(uid);
    } else {
      this.lineasColapsadas.add(uid);
    }
    this.lineasColapsadas = new Set(this.lineasColapsadas);
  }

  onSignLineaChange(linea: CotLineaForm): void {
    const sign = this.signs.find(s => s.id === linea.signId);
    linea.costoUnitario = sign?.costoUnitario ?? null;
    if (sign) {
      this.precargarMiniaturas([sign]);
      if (this.cotLineas[0]?.uid === linea.uid) {
        this.signSeleccionado = sign;
        this.cargarPreviewCotizacion(sign.id);
      }
    }
    this.programarGuardadoBorradorCotizacion();
  }

  onCostoUnitarioLineaChange(linea: CotLineaForm): void {
    this.programarGuardadoBorradorCotizacion();
    const signId = Number(linea.signId);
    if (!Number.isFinite(signId) || signId <= 0) {
      return;
    }
    const costo = linea.costoUnitario == null || linea.costoUnitario === ('' as any)
      ? null
      : Number(linea.costoUnitario);
    if (costo != null && (!Number.isFinite(costo) || costo < 0)) {
      return;
    }
    this.costoSyncPendiente.set(signId, costo ?? 0);
    if (this.costoSyncTimeout) {
      clearTimeout(this.costoSyncTimeout);
    }
    this.costoSyncTimeout = setTimeout(() => {
      void this.sincronizarCostosUnitariosPendientes();
    }, 700);
  }

  private async sincronizarCostosUnitariosPendientes(): Promise<void> {
    const pendientes = Array.from(this.costoSyncPendiente.entries());
    this.costoSyncPendiente.clear();
    for (const [signId, costo] of pendientes) {
      try {
        await firstValueFrom(
          this.backend
            .actualizarInnovacionSign(signId, { costo_unitario: costo })
            .pipe(takeUntil(this.destroy$))
        );
        const idx = this.signs.findIndex(s => s.id === signId);
        if (idx >= 0) {
          this.signs[idx] = { ...this.signs[idx], costoUnitario: costo };
        }
        for (const linea of this.cotLineas) {
          if (linea.signId === signId && Number(linea.costoUnitario) !== costo) {
            // No sobreescribir si el usuario ya cambió otra vez.
            continue;
          }
          if (linea.signId === signId) {
            linea.costoUnitario = costo;
          }
        }
      } catch (err) {
        console.warn('[DI-COT] No se pudo actualizar costo unitario en BD:', err);
      }
    }
  }

  onEmpresaCotizacionChange(): void {
    const empresa = this.empresas.find(e => e.id === this.cotEmpresaId);
    this.cotEmpresaNombre = empresa?.nombre || this.cotEmpresaNombre;
    this.programarGuardadoBorradorCotizacion();
  }

  private payloadCotizacionProyecto() {
    return {
      empresa_id: this.cotEmpresaId,
      empresa_nombre: this.cotEmpresaNombre.trim(),
      nombre_proyecto: this.cotNombreProyecto.trim(),
      fecha_cotizacion: this.cotFecha,
      tipo_cotizacion: this.cotTipo,
      lineas: this.cotLineas.map(linea => ({
        sign_id: Number(linea.signId),
        forma: linea.forma,
        forma_personalizado_texto:
          linea.forma === 'personalizado' ? linea.formaPersonalizadoTexto.trim() : undefined,
        distancia_visualizacion_m: linea.distanciaM,
        largo_cm: Number(linea.largoCm),
        ancho_cm: Number(linea.anchoCm),
        cantidad: Number(linea.cantidad),
        materiales: this.materialesSeleccionadosLinea(linea),
        costo_unitario: linea.costoUnitario != null ? Number(linea.costoUnitario) : 0,
        notas: linea.notas.trim() || null
      }))
    };
  }

  seleccionarTipoCotizacion(tipo: TipoCotizacion): void {
    this.cotTipo = tipo;
    this.programarGuardadoBorradorCotizacion();
  }

  programarGuardadoBorradorCotizacion(): void {
    if (this.borradorCotizacionTimeout) {
      clearTimeout(this.borradorCotizacionTimeout);
    }
    this.borradorCotizacionTimeout = setTimeout(() => {
      this.guardarBorradorCotizacion();
    }, 350);
  }

  private guardarBorradorCotizacion(): void {
    if (this.cotProyectoEditandoId) {
      return;
    }
    if (!this.mostrarCotizacion && !this.hayDatosBorradorCotizacion()) {
      return;
    }
    try {
      const payload = {
        cotPaso: this.cotPaso,
        cotEmpresaId: this.cotEmpresaId,
        cotEmpresaNombre: this.cotEmpresaNombre,
        cotNombreProyecto: this.cotNombreProyecto,
        cotFecha: this.cotFecha,
        cotFolio: this.cotFolio,
        cotTipo: this.cotTipo,
        cotizacionOrigenId: this.cotizacionOrigenId,
        lineasColapsadas: Array.from(this.lineasColapsadas),
        cotLineas: this.cotLineas,
        guardadoEn: new Date().toISOString()
      };
      localStorage.setItem(this.BORRADOR_COTIZACION_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota */
    }
  }

  private hayDatosBorradorCotizacion(): boolean {
    return !!(
      this.cotEmpresaId ||
      this.cotEmpresaNombre.trim() ||
      this.cotNombreProyecto.trim() ||
      this.cotLineas.some(l => l.signId || l.largoCm || l.anchoCm || l.notas.trim())
    );
  }

  private restaurarBorradorCotizacion(): boolean {
    try {
      const raw = localStorage.getItem(this.BORRADOR_COTIZACION_KEY);
      if (!raw) {
        return false;
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        return false;
      }
      this.cotPaso = data.cotPaso === 2 || data.cotPaso === 3 ? data.cotPaso : 1;
      this.cotEmpresaId = data.cotEmpresaId != null ? Number(data.cotEmpresaId) : null;
      this.cotEmpresaNombre = String(data.cotEmpresaNombre || '');
      this.cotNombreProyecto = String(data.cotNombreProyecto || '');
      this.cotFecha = String(data.cotFecha || this.fechaHoyIso());
      this.cotFolio = String(data.cotFolio || '');
      this.cotTipo = data.cotTipo === 'cliente' ? 'cliente' : 'produccion';
      this.cotizacionOrigenId = data.cotizacionOrigenId != null ? Number(data.cotizacionOrigenId) : null;
      const lineas = Array.isArray(data.cotLineas) ? data.cotLineas : [];
      this.cotLineas = lineas.length
        ? lineas.map((l: any) => ({
            uid: String(l.uid || `linea-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
            signId: l.signId != null ? Number(l.signId) : null,
            forma: (l.forma || 'rectangular') as FormaSenal,
            formaPersonalizadoTexto: String(l.formaPersonalizadoTexto || ''),
            distanciaM: l.distanciaM != null ? Number(l.distanciaM) : null,
            largoCm: l.largoCm != null ? Number(l.largoCm) : null,
            anchoCm: l.anchoCm != null ? Number(l.anchoCm) : null,
            cantidad: Number(l.cantidad || 1),
            materiales: { ...this.crearMaterialesVacios(), ...(l.materiales || {}) },
            notas: String(l.notas || ''),
            costoUnitario: l.costoUnitario != null ? Number(l.costoUnitario) : null
          }))
        : [this.crearLineaCotizacionVacia()];
      this.lineasColapsadas = new Set(
        Array.isArray(data.lineasColapsadas) ? data.lineasColapsadas.map(String) : []
      );
      return true;
    } catch {
      return false;
    }
  }

  private limpiarBorradorCotizacion(): void {
    try {
      localStorage.removeItem(this.BORRADOR_COTIZACION_KEY);
    } catch {
      /* ignore */
    }
  }

  private escapeHtml(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  irPasoCotizacion(n: 1 | 2 | 3): void {
    if (n === this.cotPaso || this.guardandoCotizacion) {
      return;
    }
    if (n > this.cotPaso) {
      if (n >= 2 && !this.validarPaso1Cotizacion()) {
        return;
      }
      if (n >= 3 && !this.validarPaso2Cotizacion()) {
        return;
      }
    }
    this.cotPaso = n;
    if (n === 3) {
      this.precargarMiniaturasCotizacionLineas();
    }
    this.programarGuardadoBorradorCotizacion();
  }

  private precargarMiniaturasCotizacionLineas(): void {
    const ids = new Set(
      this.cotLineas.map(l => l.signId).filter((id): id is number => id != null && id > 0)
    );
    const docs = this.signs.filter(s => ids.has(s.id));
    if (docs.length) {
      this.precargarMiniaturas(docs);
    }
  }

  volverPasoCotizacion(): void {
    if (this.guardandoCotizacion) {
      return;
    }
    if (this.cotPaso > 1) {
      this.cotPaso = (this.cotPaso - 1) as 1 | 2 | 3;
    }
  }

  avanzarPasoCotizacion(): void {
    if (this.cotPaso === 1) {
      this.irPasoCotizacion(2);
    } else if (this.cotPaso === 2) {
      this.irPasoCotizacion(3);
    }
  }

  copiarCotizacion(cotizacion: InnovacionCotizacionItem): void {
    const sign =
      this.signs.find(item => item.id === cotizacion.signId) ||
      ({
        id: cotizacion.signId,
        apartadoOficial: null,
        categoria: 'biznaga',
        nombreSenal: cotizacion.signNombreSenal,
        descripcion: cotizacion.signDescripcion,
        clasificacion: null,
        costoUnitario: null,
        nombreArchivo: cotizacion.signNombreArchivo,
        mimeType: cotizacion.signNombreArchivo.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        tamanoBytes: null,
        subidoPor: null,
        fechaSubida: '',
        actualizadoPor: null,
        fechaActualizacion: ''
      } as InnovacionSignItem);

    this.abrirCotizacionProyecto();
    this.cotTipo = cotizacion.tipoCotizacion === 'produccion' ? 'cliente' : 'produccion';
    this.cotizacionOrigenId = cotizacion.id;
    const linea = this.cotLineas[0] || this.crearLineaCotizacionVacia(sign);
    linea.signId = sign.id;
    linea.forma = cotizacion.forma;
    linea.formaPersonalizadoTexto = cotizacion.formaPersonalizadoTexto || '';
    linea.distanciaM = cotizacion.distanciaVisualizacionM;
    linea.largoCm = cotizacion.largoCm;
    linea.anchoCm = cotizacion.anchoCm;
    linea.cantidad = cotizacion.cantidad;
    linea.notas = cotizacion.notas || '';
    linea.costoUnitario = sign.costoUnitario;
    for (const key of Object.keys(linea.materiales)) {
      linea.materiales[key] = cotizacion.materiales.includes(key);
    }
    this.cotLineas = [linea];
    this.signSeleccionado = sign;
    this.cotPaso = 2;
    this.cargarPreviewCotizacion(sign.id);
  }

  cerrarCotizacion(): void {
    if (this.guardandoCotizacion) {
      return;
    }
    this.guardarBorradorCotizacion();
    this.mostrarCotizacion = false;
    this.signSeleccionado = null;
    this.revocarPreviewCotizacion();
  }

  resetFormCotizacion(): void {
    this.cotPaso = 1;
    this.cotTipo = 'produccion';
    this.cotizacionOrigenId = null;
    this.cotProyectoEditandoId = null;
    this.mostrarDropdownEmpresa = false;
    this.cotLayoutImagen = 'cuadrado';
    this.previewImagenAspectRatio = null;
    this.cotEmpresaId = null;
    this.cotEmpresaNombre = '';
    this.cotNombreProyecto = '';
    this.cotFecha = this.fechaHoyIso();
    this.cotFolio = '';
    this.cotLineas = [this.crearLineaCotizacionVacia()];
    this.lineasColapsadas = new Set();
    this.ultimoCampoTamaño = 'largo';
    this.revocarPreviewCotizacion();
  }

  private fechaHoyIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private cargarEmpresasCotizacion(): void {
    this.cargandoEmpresas = true;
    this.backend
      .obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          const lista = Array.isArray(res) ? res : Array.isArray(res?.empresas) ? res.empresas : [];
          this.empresas = lista
            .map((e: any) => ({
              id: Number(e.empresa_id ?? e.id ?? 0),
              nombre: String(e.nombre_empresa ?? e.nombre ?? '').trim()
            }))
            .filter((e: EmpresaOpcion) => e.id > 0 && e.nombre)
            .sort((a: EmpresaOpcion, b: EmpresaOpcion) => a.nombre.localeCompare(b.nombre, 'es'));
          this.cargandoEmpresas = false;
        },
        error: () => {
          this.empresas = [];
          this.cargandoEmpresas = false;
        }
      });
  }

  private cargarFolioCotizacion(): void {
    this.cargandoFolio = true;
    this.backend
      .obtenerSiguienteFolioCotizacionProyecto()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.cotFolio = res?.folio || res?.siguienteFolio || '';
          this.cargandoFolio = false;
        },
        error: () => {
          this.cotFolio = '';
          this.cargandoFolio = false;
        }
      });
  }

  onFormaLineaChange(linea: CotLineaForm): void {
    this.programarGuardadoBorradorCotizacion();
    if (!this.formaMantieneProporcion(linea.forma)) {
      return;
    }
    if (linea.largoCm != null) {
      linea.anchoCm = this.calcularAnchoDesdeLargo(linea.forma, linea.largoCm);
    } else if (linea.anchoCm != null) {
      linea.largoCm = this.calcularLargoDesdeAncho(linea.forma, linea.anchoCm);
    }
  }

  onLargoLineaChange(linea: CotLineaForm): void {
    this.ultimoCampoTamaño = 'largo';
    this.programarGuardadoBorradorCotizacion();
    if (linea.largoCm == null || linea.largoCm <= 0) {
      return;
    }
    if (this.formaMantieneProporcion(linea.forma)) {
      linea.anchoCm = this.calcularAnchoDesdeLargo(linea.forma, linea.largoCm);
    }
  }

  onAnchoLineaChange(linea: CotLineaForm): void {
    this.ultimoCampoTamaño = 'ancho';
    this.programarGuardadoBorradorCotizacion();
    if (linea.anchoCm == null || linea.anchoCm <= 0) {
      return;
    }
    if (this.formaMantieneProporcion(linea.forma)) {
      linea.largoCm = this.calcularLargoDesdeAncho(linea.forma, linea.anchoCm);
    }
  }

  onDistanciaLineaChange(linea: CotLineaForm): void {
    this.programarGuardadoBorradorCotizacion();
    if (linea.distanciaM == null || linea.distanciaM <= 0) {
      return;
    }
    const areaMin = (linea.distanciaM * linea.distanciaM) / 2000;
    if (!this.formaMantieneProporcion(linea.forma)) {
      const relacionActual =
        linea.largoCm && linea.anchoCm
          ? linea.largoCm / linea.anchoCm
          : linea.forma === 'rectangular'
            ? 2
            : 1;
      linea.largoCm = Math.round(Math.sqrt(areaMin * relacionActual) * 10) / 10;
      linea.anchoCm = Math.round(Math.sqrt(areaMin / relacionActual) * 10) / 10;
      return;
    }
    const largo = this.dimensionDesdeArea(linea.forma, areaMin, 'largo');
    linea.largoCm = Math.round(largo * 10) / 10;
    this.onLargoLineaChange(linea);
  }

  areaMinimaLinea(linea: CotLineaForm): number | null {
    if (linea.distanciaM == null || linea.distanciaM <= 0) {
      return null;
    }
    return Math.round(((linea.distanciaM * linea.distanciaM) / 2000) * 100) / 100;
  }

  areaActualLinea(linea: CotLineaForm): number | null {
    if (linea.largoCm == null || linea.anchoCm == null) {
      return null;
    }
    return Math.round(linea.largoCm * linea.anchoCm * 100) / 100;
  }

  cumpleAreaMinimaLinea(linea: CotLineaForm): boolean {
    const min = this.areaMinimaLinea(linea);
    const actual = this.areaActualLinea(linea);
    if (min == null || actual == null) {
      return true;
    }
    return actual >= min;
  }

  materialesSeleccionadosLinea(linea: CotLineaForm): string[] {
    return Object.entries(linea.materiales)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  subtotalLinea(linea: CotLineaForm): number {
    const costo = Number(linea.costoUnitario ?? 0);
    const cant = Number(linea.cantidad ?? 0);
    return Math.round(costo * cant * 100) / 100;
  }

  get cotResumenSubtotal(): number {
    return Math.round(this.cotLineas.reduce((acc, l) => acc + this.subtotalLinea(l), 0) * 100) / 100;
  }

  get cotResumenIva(): number {
    return Math.round(this.cotResumenSubtotal * 0.16 * 100) / 100;
  }

  get cotResumenTotal(): number {
    return Math.round((this.cotResumenSubtotal + this.cotResumenIva) * 100) / 100;
  }

  nombreSignPorId(signId: number | null): string {
    if (signId == null) {
      return '—';
    }
    const sign = this.signs.find(s => s.id === signId);
    return sign ? this.nombreSign(sign) : `Señal #${signId}`;
  }

  etiquetaClasificacion(clasificacion: string | null | undefined): string {
    if (!clasificacion) {
      return '—';
    }
    return this.clasificaciones.find(c => c.id === clasificacion)?.label || clasificacion;
  }

  colorClasificacion(clasificacion: string | null | undefined): string {
    if (!clasificacion) {
      return '#6b7280';
    }
    return this.clasificaciones.find(c => c.id === clasificacion)?.color || '#6b7280';
  }

  textoClaroClasificacion(clasificacion: string | null | undefined): boolean {
    return clasificacion !== 'prohibicion';
  }

  private normalizarClasificacion(valor: string | null | undefined): ClasificacionSign | '' {
    if (!valor) {
      return '';
    }
    return this.clasificaciones.some(c => c.id === valor) ? (valor as ClasificacionSign) : '';
  }

  formatearMoneda(valor: number | null | undefined): string {
    const n = Number(valor ?? 0);
    return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  materialesTexto(materiales: string[]): string {
    if (!materiales?.length) {
      return '—';
    }
    return materiales.map(m => this.etiquetaMaterial(m)).join(', ');
  }

  trackByUid(_: number, item: { uid: string }): string {
    return item.uid;
  }

  volverSeleccionCotizacion(): void {
    this.cerrarCotizacion();
  }

  formaMantieneProporcion(forma: FormaSenal): boolean {
    return ['circular', 'cuadrada', 'hexagonal', 'octogonal'].includes(forma);
  }

  calcularAnchoDesdeLargo(forma: FormaSenal, largo: number): number {
    switch (forma) {
      case 'cuadrada':
      case 'circular':
        return Math.round(largo * 10) / 10;
      case 'rectangular':
        return Math.round((largo / 2) * 10) / 10;
      case 'hexagonal':
        return Math.round(largo * (Math.sqrt(3) / 2) * 10) / 10;
      case 'octogonal':
        return Math.round(largo * 0.8284 * 10) / 10;
      default:
        return Math.round(largo * 10) / 10;
    }
  }

  calcularLargoDesdeAncho(forma: FormaSenal, ancho: number): number {
    switch (forma) {
      case 'cuadrada':
      case 'circular':
        return Math.round(ancho * 10) / 10;
      case 'rectangular':
        return Math.round(ancho * 2 * 10) / 10;
      case 'hexagonal':
        return Math.round((ancho * 2) / Math.sqrt(3) * 10) / 10;
      case 'octogonal':
        return Math.round((ancho / 0.8284) * 10) / 10;
      default:
        return Math.round(ancho * 10) / 10;
    }
  }

  dimensionDesdeArea(forma: FormaSenal, area: number, tipo: 'largo' | 'ancho'): number {
    switch (forma) {
      case 'cuadrada':
        return Math.sqrt(area);
      case 'circular':
        return 2 * Math.sqrt(area / Math.PI);
      case 'rectangular':
        return tipo === 'largo' ? Math.sqrt(area * 2) : Math.sqrt(area / 2);
      case 'hexagonal':
        return Math.sqrt((4 * area) / (3 * Math.sqrt(3)));
      case 'octogonal':
        return 2 * Math.sqrt(area / (2 * (1 + Math.sqrt(2))));
      default:
        return Math.sqrt(area);
    }
  }

  get previewAspectRatio(): string {
    const primera = this.cotLineas[0];
    const l = primera?.largoCm || 2;
    const a = primera?.anchoCm || 1;
    return `${l} / ${a}`;
  }

  get previewStageAspectRatio(): string {
    return this.previewAspectRatio;
  }

  onPreviewCotizacionImagenLoad(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img?.naturalWidth || !img.naturalHeight) {
      return;
    }
    this.clasificarLayoutPreviewImagen(img.naturalWidth, img.naturalHeight);
  }

  get previewClipPath(): string {
    const forma = this.cotLineas[0]?.forma || 'rectangular';
    return this.clipPathForma(forma);
  }

  clipPathForma(forma: FormaSenal | string): string {
    switch (forma) {
      case 'circular':
        return 'circle(50% at 50% 50%)';
      case 'cuadrada':
      case 'rectangular':
      case 'personalizado':
        return 'inset(0)';
      case 'hexagonal':
        return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      case 'octogonal':
        return 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
      default:
        return 'inset(0)';
    }
  }

  aspectRatioCotizacion(c: InnovacionCotizacionItem): string {
    const largo = c.largoCm || 1;
    const ancho = c.anchoCm || 1;
    return `${largo} / ${ancho}`;
  }

  tamanoCotizacion(c: InnovacionCotizacionItem): string {
    return `${c.largoCm} × ${c.anchoCm} cm`;
  }

  tamanoCotizacionLineas(c: InnovacionCotizacionItem): { medidas: string; unidad: string } {
    return {
      medidas: `${c.largoCm} × ${c.anchoCm}`,
      unidad: 'cm'
    };
  }

  creadorCotizacionLineas(c: InnovacionCotizacionItem): string[] {
    const nombre = c.creadoPor?.trim();
    if (!nombre) {
      return ['—'];
    }
    const tokens = nombre.split(/\s+/);
    if (tokens.length <= 2) {
      return [nombre];
    }
    const mitad = Math.ceil(tokens.length / 2);
    return [tokens.slice(0, mitad).join(' '), tokens.slice(mitad).join(' ')];
  }

  fechaCotizacionLineas(iso: string): { principal: string; anio: string } {
    if (!iso) {
      return { principal: '—', anio: '' };
    }
    try {
      const fecha = new Date(iso);
      return {
        principal: fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
        anio: fecha.toLocaleDateString('es-MX', { year: 'numeric' })
      };
    } catch {
      return { principal: iso, anio: '' };
    }
  }

  materialesSeleccionados(): string[] {
    const primera = this.cotLineas[0];
    return primera ? this.materialesSeleccionadosLinea(primera) : [];
  }

  etiquetaMaterial(id: string): string {
    return this.materialesOpciones.find(m => m.slug === id)?.label || id;
  }

  etiquetaForma(forma: string): string {
    return this.formas.find(f => f.id === forma)?.label || forma;
  }

  etiquetaCategoria(cat: string): string {
    return this.categorias.find(c => c.id === cat)?.label || cat;
  }

  etiquetaTipoCotizacion(tipo: TipoCotizacion): string {
    return tipo === 'cliente' ? 'Cliente' : 'Producción';
  }

  tipoCotizacionDestino(cotizacion: InnovacionCotizacionItem): TipoCotizacion {
    return cotizacion.tipoCotizacion === 'produccion' ? 'cliente' : 'produccion';
  }

  private validarPaso1Cotizacion(): boolean {
    const nombreEmpresa = this.cotEmpresaNombre.trim();
    if (!nombreEmpresa) {
      Swal.fire('Empresa requerida', 'Seleccione o escriba el nombre de la empresa.', 'warning');
      return false;
    }
    if (!this.cotEmpresaId) {
      const match = this.empresas.find(e => e.nombre.toLowerCase() === nombreEmpresa.toLowerCase());
      if (match) {
        this.cotEmpresaId = match.id;
        this.cotEmpresaNombre = match.nombre;
      }
    }
    if (!this.cotNombreProyecto.trim()) {
      Swal.fire('Proyecto requerido', 'Indique el nombre del proyecto.', 'warning');
      return false;
    }
    if (!this.cotFecha) {
      Swal.fire('Fecha requerida', 'Indique la fecha de cotización.', 'warning');
      return false;
    }
    if (!this.cotFolio.trim()) {
      Swal.fire('Folio requerido', 'Espere a que se genere el folio o reintente.', 'warning');
      return false;
    }
    return true;
  }

  private validarPaso2Cotizacion(): boolean {
    for (let i = 0; i < this.cotLineas.length; i++) {
      const linea = this.cotLineas[i];
      const n = i + 1;
      if (!linea.signId) {
        Swal.fire('Señalización requerida', `Seleccione la señalización en la línea ${n}.`, 'warning');
        return false;
      }
      if (!linea.forma) {
        Swal.fire('Forma requerida', `Seleccione la forma en la línea ${n}.`, 'warning');
        return false;
      }
      if (linea.forma === 'personalizado' && !linea.formaPersonalizadoTexto.trim()) {
        Swal.fire('Forma requerida', `Describa la forma personalizada en la línea ${n}.`, 'warning');
        return false;
      }
      if (linea.largoCm == null || linea.anchoCm == null || linea.largoCm <= 0 || linea.anchoCm <= 0) {
        Swal.fire('Tamaño requerido', `Indique largo y ancho válidos en la línea ${n}.`, 'warning');
        return false;
      }
      if (!linea.cantidad || linea.cantidad <= 0) {
        Swal.fire('Cantidad inválida', `La cantidad debe ser mayor a cero en la línea ${n}.`, 'warning');
        return false;
      }
      if (!this.materialesSeleccionadosLinea(linea).length) {
        Swal.fire('Material requerido', `Seleccione al menos un material en la línea ${n}.`, 'warning');
        return false;
      }
    }
    return true;
  }

  async guardarCotizacion(): Promise<void> {
    if (this.guardandoCotizacion) {
      return;
    }
    if (!this.validarPaso1Cotizacion() || !this.validarPaso2Cotizacion()) {
      return;
    }

    const editando = !!this.cotProyectoEditandoId;
    this.guardandoCotizacion = true;
    Swal.fire({
      title: editando ? 'Actualizando cotización' : 'Guardando cotización',
      text: editando
        ? 'Estamos actualizando la cotización de proyecto.'
        : 'Estamos registrando la cotización de proyecto.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });
    try {
      const payload = this.payloadCotizacionProyecto();
      if (editando && this.cotProyectoEditandoId) {
        await firstValueFrom(
          this.backend
            .actualizarInnovacionCotizacionProyecto(this.cotProyectoEditandoId, payload)
            .pipe(takeUntil(this.destroy$))
        );
      } else {
        await firstValueFrom(
          this.backend.crearInnovacionCotizacionProyecto(payload).pipe(takeUntil(this.destroy$))
        );
      }

      Swal.close();
      this.guardandoCotizacion = false;
      this.limpiarBorradorCotizacion();
      this.tipoHistorial = this.cotTipo;
      this.resetFormCotizacion();
      this.mostrarCotizacion = false;
      this.signSeleccionado = null;
      this.revocarPreviewCotizacion();
      this.seleccionarVista('historial');
      await Swal.fire(
        editando ? 'Cotización actualizada' : 'Cotización guardada',
        editando
          ? 'Los cambios se guardaron en el historial.'
          : 'La cotización de proyecto se registró en el historial.',
        'success'
      );
    } catch (err: any) {
      Swal.close();
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo guardar la cotización.', 'error');
    } finally {
      this.guardandoCotizacion = false;
    }
  }

  miniatura(sign: InnovacionSignItem): MiniaturaEstado {
    return (
      this.miniaturas[sign.id] || {
        url: null,
        cargando: this.esImagenMime(sign.mimeType, sign.nombreArchivo) || this.esPdf(sign),
        error: false
      }
    );
  }

  miniaturaPorSignId(signId: number): MiniaturaEstado {
    return (
      this.miniaturas[signId] || {
        url: null,
        cargando: false,
        error: false
      }
    );
  }

  esPdf(sign: InnovacionSignItem): boolean {
    const m = (sign.mimeType || '').toLowerCase();
    const n = (sign.nombreArchivo || '').toLowerCase();
    return m.includes('pdf') || n.endsWith('.pdf');
  }

  formatearFecha(iso: string): string {
    return this.formatearFechaCorta(iso);
  }

  formatearFechaCorta(iso: string): string {
    if (!iso) {
      return '—';
    }
    try {
      return new Date(iso).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return iso;
    }
  }

  nombreSign(sign: InnovacionSignItem): string {
    return sign.nombreSenal?.trim() || sign.descripcion || sign.nombreArchivo;
  }

  esRegistroIncompleto(sign: InnovacionSignItem): boolean {
    return !sign.nombreSenal?.trim() || !sign.descripcion?.trim();
  }

  textoDatosFaltantes(sign: InnovacionSignItem): string {
    const faltantes = [
      !sign.nombreSenal?.trim() ? 'nombre' : '',
      !sign.descripcion?.trim() ? 'descripción' : ''
    ].filter(Boolean);
    return `Faltan datos por registrar: complete ${faltantes.join(' y ')} desde Editar`;
  }

  nombreCotizacion(c: InnovacionCotizacionItem): string {
    return c.signNombreSenal?.trim() || c.signDescripcion || c.signNombreArchivo;
  }

  trackById(_: number, item: { id: number }): number {
    return item.id;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.mostrarDropdownEmpresa) {
      this.cerrarDropdownEmpresa();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeVisor(event: KeyboardEvent): void {
    if (this.mostrarDropdownEmpresa) {
      this.cerrarDropdownEmpresa();
      return;
    }
    if (!this.mostrarVisorSign) {
      return;
    }
    event.preventDefault();
    this.cerrarVisorSign();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.actualizarModoPanel();
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
    if (!this.panelModoDesktop || !this.signAccion) {
      this.panelFlotanteStyle = {};
      return;
    }
    this.panelPositionTimeout = setTimeout(() => {
      this.actualizarPosicionPanel();
    }, 0);
  }

  private actualizarPosicionPanel(): void {
    if (!this.panelModoDesktop || !this.signAccion || typeof document === 'undefined') {
      this.panelFlotanteStyle = {};
      return;
    }

    const contenedor = document.querySelector('.di-catalog-focus-layout') as HTMLElement | null;
    const tarjeta = document.querySelector(
      `.di-product-card[data-sign-id="${this.signAccion.id}"]`
    ) as HTMLElement | null;
    const panel = document.querySelector('.di-sign-editor-panel') as HTMLElement | null;

    if (!contenedor || !tarjeta) {
      this.panelFlotanteStyle = {};
      return;
    }

    const cardRect = tarjeta.getBoundingClientRect();
    const gap = 12;
    const panelWidth = Math.round(
      Math.max(220, Math.min(this.PANEL_ANCHO_BASE, window.innerWidth - 24))
    );

    const espacioDerecha = window.innerWidth - cardRect.right;
    const espacioIzquierda = cardRect.left;
    const abrirADerecha = espacioDerecha >= panelWidth + gap || espacioDerecha >= espacioIzquierda;
    this.panelLado = abrirADerecha ? 'right' : 'left';

    let left = abrirADerecha
      ? cardRect.right + gap
      : cardRect.left - panelWidth - gap;

    left = Math.min(Math.max(left, 12), Math.max(window.innerWidth - panelWidth - 12, 12));

    const panelHeight = Math.max(Number(panel?.offsetHeight || 0), 160);
    let top = cardRect.top;
    const topMaxByViewport = Math.max(window.innerHeight - panelHeight - 12, 12);
    top = Math.min(Math.max(top, 12), topMaxByViewport);

    this.panelFlotanteStyle = {
      width: `${panelWidth}px`,
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`
    };
  }

  private obtenerRectTarjetaSign(signId: number): DOMRect | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const tarjeta = document.querySelector(`.di-product-card[data-sign-id="${signId}"]`) as HTMLElement | null;
    return tarjeta ? tarjeta.getBoundingClientRect() : null;
  }

  private obtenerRectPanelSign(): DOMRect | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const panel = document.querySelector('.di-sign-editor-panel') as HTMLElement | null;
    return panel ? panel.getBoundingClientRect() : null;
  }

  private construirMorphStyle(rect: DOMRect, opacity: number): Record<string, string> {
    return {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      opacity: `${opacity}`
    };
  }

  private animarMorphHaciaPanel(origenRect: DOMRect | null): void {
    if (!origenRect) {
      return;
    }
    setTimeout(() => {
      const destinoRect = this.obtenerRectPanelSign();
      if (!destinoRect) {
        return;
      }
      this.dispararMorph(origenRect, destinoRect);
    }, 30);
  }

  private dispararMorph(origenRect: DOMRect, destinoRect: DOMRect): void {
    if (this.morphTimeout) {
      clearTimeout(this.morphTimeout);
      this.morphTimeout = null;
    }

    this.morphActivo = true;
    this.morphStyle = this.construirMorphStyle(origenRect, 0.92);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.morphStyle = this.construirMorphStyle(destinoRect, 0);
      });
    });

    this.morphTimeout = setTimeout(() => {
      this.morphActivo = false;
    }, this.MORPH_DURATION_MS + 40);
  }

  private esArchivoPermitido(file: File): boolean {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'pdf'].includes(ext);
  }

  private esImagen(file: File): boolean {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return (file.type || '').startsWith('image/') || ['jpg', 'jpeg', 'png'].includes(ext);
  }

  private mimeDesdeNombre(nombre: string): string {
    const ext = nombre.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      return 'application/pdf';
    }
    if (ext === 'png') {
      return 'image/png';
    }
    if (['jpg', 'jpeg'].includes(ext)) {
      return 'image/jpeg';
    }
    return '';
  }

  private nombreDesdeArchivo(nombre: string): string {
    return String(nombre || '')
      .replace(/\.[^.]+$/, '')
      .trim()
      .slice(0, 255) || 'Señalización';
  }

  private esImagenMime(mime: string, nombre: string): boolean {
    const m = (mime || '').toLowerCase();
    const n = (nombre || '').toLowerCase();
    return m.startsWith('image/') || /\.(jpe?g|png)$/i.test(n);
  }

  private archivoABase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultado = String(reader.result || '');
        resolve(resultado.includes(',') ? resultado.split(',')[1] : resultado);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private precargarMiniaturasHistorial(): void {
    const idsLegacy = this.cotizaciones.map(c => c.signId).filter(id => id > 0);
    const idsProyecto = this.cotizacionesProyecto.flatMap(p =>
      (p.lineas || []).map(l => l.signId).filter(id => id > 0)
    );
    const signIds = [...new Set([...idsLegacy, ...idsProyecto])];
    const signsHistorial: InnovacionSignItem[] = signIds.map(id => {
      const cached = this.signs.find(s => s.id === id);
      if (cached) {
        return cached;
      }
      const cot = this.cotizaciones.find(c => c.signId === id);
      const lineaProy = this.cotizacionesProyecto
        .flatMap(p => p.lineas || [])
        .find(l => l.signId === id);
      return {
        id,
        apartadoOficial: null,
        categoria: 'biznaga' as CategoriaSign,
        nombreSenal: cot?.signNombreSenal || lineaProy?.nombreSenal || '',
        descripcion: cot?.signDescripcion || '',
        clasificacion: lineaProy?.clasificacion || null,
        costoUnitario: null,
        nombreArchivo: cot?.signNombreArchivo || '',
        mimeType: '',
        tamanoBytes: null,
        subidoPor: null,
        fechaSubida: '',
        actualizadoPor: null,
        fechaActualizacion: ''
      };
    });
    this.precargarMiniaturas(signsHistorial);
  }

  descargarExcelCotizaciones(): void {
    if (this.descargandoExcelCotizaciones) {
      return;
    }
    this.descargandoExcelCotizaciones = true;
    this.backend
      .exportarExcelCotizacionesProyecto()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          const fecha = new Date().toISOString().slice(0, 10);
          this.dispararDescarga(url, `Cotizaciones_Senalizacion_${fecha}.xlsx`);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          this.descargandoExcelCotizaciones = false;
        },
        error: async err => {
          this.descargandoExcelCotizaciones = false;
          const mensaje = await this.extraerMensajeErrorBlob(err);
          Swal.fire('Error', mensaje || 'No se pudo descargar el Excel de cotizaciones.', 'error');
        }
      });
  }

  private precargarMiniaturas(docs: InnovacionSignItem[]): void {
    for (const doc of docs) {
      const esPdf = this.esPdf(doc);
      if (!this.esImagenMime(doc.mimeType, doc.nombreArchivo) && !esPdf) {
        this.actualizarMiniatura(doc.id, { url: null, cargando: false, error: false });
        continue;
      }
      const prev = this.miniaturas[doc.id];
      if (prev?.url || prev?.cargando) {
        continue;
      }
      this.actualizarMiniatura(doc.id, { url: null, cargando: true, error: false });
      this.backend
        .descargarInnovacionSignArchivo(doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async blob => {
            try {
              const previewBlob = esPdf
                ? await this.pdfThumbnail.renderizarPrimeraPagina(blob)
                : blob;
              const url = URL.createObjectURL(previewBlob);
              this.miniaturaObjectUrls.set(doc.id, url);
              this.actualizarMiniatura(doc.id, {
                url: this.sanitizer.bypassSecurityTrustResourceUrl(url),
                cargando: false,
                error: false
              });
            } catch {
              this.actualizarMiniatura(doc.id, { url: null, cargando: false, error: true });
            }
          },
          error: () => {
            this.actualizarMiniatura(doc.id, { url: null, cargando: false, error: true });
          }
        });
    }
  }

  private clasificarLayoutPreviewImagen(width: number, height: number): void {
    if (!width || !height) {
      this.cotLayoutImagen = 'cuadrado';
      this.previewImagenAspectRatio = null;
      return;
    }
    const ratio = width / height;
    this.previewImagenAspectRatio = `${width} / ${height}`;
    if (ratio > 1.3) {
      this.cotLayoutImagen = 'horizontal';
    } else if (ratio < 0.85) {
      this.cotLayoutImagen = 'vertical';
    } else {
      this.cotLayoutImagen = 'cuadrado';
    }
  }

  private cargarPreviewCotizacion(id: number): void {
    this.revocarPreviewCotizacion();
    this.cotLayoutImagen = 'cuadrado';
    this.previewImagenAspectRatio = null;
    this.cargandoPreviewCotizacion = true;
    this.errorPreviewCotizacion = false;
    this.backend
      .descargarInnovacionSignArchivo(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async blob => {
          try {
            const previewBlob = this.signSeleccionado && this.esPdf(this.signSeleccionado)
              ? await this.pdfThumbnail.renderizarPrimeraPagina(blob, 1000)
              : blob;
            this.previewCotizacionObjectUrl = URL.createObjectURL(previewBlob);
            this.previewCotizacionUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
              this.previewCotizacionObjectUrl
            );
            this.cargandoPreviewCotizacion = false;
          } catch {
            this.cargandoPreviewCotizacion = false;
            this.errorPreviewCotizacion = true;
            Swal.fire('Error', 'No se pudo generar la vista previa del PDF.', 'error');
          }
        },
        error: async err => {
          this.cargandoPreviewCotizacion = false;
          this.errorPreviewCotizacion = true;
          const detalle = await this.extraerMensajeErrorBlob(err);
          Swal.fire('Archivo no disponible', detalle, 'error');
        }
      });
  }

  private async extraerMensajeErrorBlob(err: any): Promise<string> {
    const fallback = 'No se pudo cargar la imagen de la señalización.';
    const cuerpo = err?.error;
    if (!(cuerpo instanceof Blob)) {
      return cuerpo?.message || err?.message || fallback;
    }
    try {
      const texto = await cuerpo.text();
      const json = JSON.parse(texto);
      return json?.message || fallback;
    } catch {
      return fallback;
    }
  }

  private actualizarMiniatura(id: number, estado: MiniaturaEstado): void {
    this.miniaturas = { ...this.miniaturas, [id]: estado };
  }

  private limpiarMiniaturas(): void {
    for (const url of this.miniaturaObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.miniaturaObjectUrls.clear();
    this.miniaturas = {};
  }

  private revocarRegistroPreview(): void {
    if (this.registroPreviewObjectUrl) {
      URL.revokeObjectURL(this.registroPreviewObjectUrl);
      this.registroPreviewObjectUrl = null;
    }
    this.registroPreviewUrl = null;
  }

  private revocarEditPreview(): void {
    if (this.editPreviewObjectUrl) {
      URL.revokeObjectURL(this.editPreviewObjectUrl);
      this.editPreviewObjectUrl = null;
    }
    this.editPreviewUrl = null;
  }

  private revocarPreviewCotizacion(): void {
    if (this.previewCotizacionObjectUrl) {
      URL.revokeObjectURL(this.previewCotizacionObjectUrl);
      this.previewCotizacionObjectUrl = null;
    }
    this.previewCotizacionUrl = null;
    this.cargandoPreviewCotizacion = false;
    this.errorPreviewCotizacion = false;
    this.cotLayoutImagen = 'cuadrado';
    this.previewImagenAspectRatio = null;
  }

  private revocarVisorSign(): void {
    if (this.visorSignObjectUrl) {
      URL.revokeObjectURL(this.visorSignObjectUrl);
      this.visorSignObjectUrl = null;
    }
    this.visorSignUrl = null;
  }

  private dispararDescarga(url: string, nombreArchivo: string): void {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo || 'senalizacion';
    enlace.click();
  }
}
