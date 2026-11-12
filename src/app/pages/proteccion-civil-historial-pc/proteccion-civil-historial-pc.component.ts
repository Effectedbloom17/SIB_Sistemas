import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';
import { PdfThumbnailService } from 'src/app/services/pdf-thumbnail.service';

interface MiniaturaHistorialPc {
  urlStr: string | null;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

interface EmpresaHistorialPc {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
  estado?: string;
  ciudad?: string;
  logo?: string | null;
  logo_url?: string | null;
  total_ciclos: number;
  total_documentos: number;
  ultima_fecha?: string | Date | null;
}

interface CicloHistorialPc {
  operacion_id: number;
  empresa_id: number;
  fecha_inicio?: string | Date | null;
  fecha_cierre?: string | Date | null;
  fecha_ingreso_tramite?: string | Date | null;
  fecha_vencimiento?: string | Date | null;
  pipc_titulos: string[];
  resumen: Record<string, number>;
  es_legacy?: boolean;
}

interface ItemHistorialPc {
  item_id: number;
  apartado: string;
  tipo_item: 'archivo' | 'texto' | string;
  pipc_titulo?: string;
  nombre_documento: string;
  nombre_archivo?: string;
  valor_texto?: string | null;
  drive_file_id?: string | null;
  mime_type?: string | null;
  tamano_bytes?: number | null;
  grupo_titulo?: string;
  fecha_referencia?: string | Date | null;
}

interface SeccionHistorialPc {
  key: string;
  nombre: string;
  icono: string;
  color: string;
}

@Component({
  selector: 'app-proteccion-civil-historial-pc',
  templateUrl: './proteccion-civil-historial-pc.component.html',
  styleUrls: ['./proteccion-civil-historial-pc.component.scss']
})
export class ProteccionCivilHistorialPcComponent implements OnInit, OnDestroy {
  readonly secciones: SeccionHistorialPc[] = [
    { key: 'documentacion', nombre: 'Documentación', icono: 'fa-folder-open', color: '#2563eb' },
    { key: 'oficios', nombre: 'Oficios de Ingreso', icono: 'fa-file-signature', color: '#c0581e' },
    { key: 'observaciones', nombre: 'Observaciones', icono: 'fa-comments', color: '#7c3aed' },
    { key: 'resolutivos', nombre: 'Resolutivos', icono: 'fa-stamp', color: '#dc2626' },
    { key: 'extra', nombre: 'Documentación Extra', icono: 'fa-archive', color: '#0f766e' }
  ];

  readonly meses = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' }
  ];

  modoVisual: 'normal' | 'compacto' = 'normal';
  /** En móvil Compacto no aplica: se fuerza Normal y se oculta el toggle. */
  esVistaMovil = false;
  vista: 'lista' | 'detalle' = 'lista';
  cargando = false;
  cargandoCiclos = false;
  cargandoDetalle = false;

  empresas: EmpresaHistorialPc[] = [];
  empresasFiltradas: EmpresaHistorialPc[] = [];
  empresaSeleccionada: EmpresaHistorialPc | null = null;
  seguimientoAbierto = false;
  reabriendoCiclo = false;
  seguimientosPipc: Array<{
    resolutivoId: number;
    nombreAsignacion: string;
    acciones: string;
    username: string;
    nombreUsuario: string;
    gestionadoEn: string;
  }> = [];
  textoBusquedaEmpresa = '';
  estadoSeleccionado = '';
  municipioSeleccionado = '';
  estados: string[] = [];
  municipios: string[] = [];

  ciclos: CicloHistorialPc[] = [];
  ciclosFiltrados: CicloHistorialPc[] = [];
  cicloSeleccionado: CicloHistorialPc | null = null;
  anoSeleccionado = 0;
  mesSeleccionado = 0;
  anosDisponibles: number[] = [];

  items: ItemHistorialPc[] = [];
  seccionActiva = 'documentacion';
  filtroTexto = '';
  seccionFiltro = 'todos';

  empresasPageSize = 6;
  ciclosPageSize = 5;
  empresasCurrentPage = 1;
  ciclosCurrentPage = 1;

  mostrarVisor = false;
  visorNombre = '';
  visorUrl = '';
  visorTexto = '';
  visorEsTexto = false;
  visorDriveId = '';
  visorIcono = 'fa-file';
  visorEsImagen = false;
  visorUsaZoom = false;
  visorModoPdf = false;
  visorCargando = false;
  previewBlobVisor: Blob | null = null;
  visorError: string | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Preparando vista previa…';
  visorLento = false;
  private visorSeq = 0;
  private visorSub?: Subscription;
  private visorBlobUrl: string | null = null;
  zoomVisor = 100;
  readonly zoomVisorMin = 25;
  readonly zoomVisorMax = 300;
  readonly zoomVisorPaso = 25;

  miniaturas: Record<number, MiniaturaHistorialPc> = {};
  private readonly miniaturaObjectUrls = new Map<number, string>();
  private miniaturaSubs: Subscription[] = [];
  private miniaturaCola: ItemHistorialPc[] = [];
  private miniaturasEnVuelo = 0;
  private readonly miniaturaConcurrency = 2;

  private deepLinkEmpresaId: number | null = null;
  private deepLinkOperacionId: number | null = null;
  private routeSub?: Subscription;

  constructor(
    private backendService: BackendServices,
    private pdfPreviewLoader: PdfPreviewLoaderService,
    private pdfThumbnail: PdfThumbnailService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.actualizarVistaMovil();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const empresaId = Number(params.get('empresaId') || 0) || null;
      const operacionId = Number(params.get('operacionId') || 0) || null;
      this.deepLinkEmpresaId = empresaId;
      this.deepLinkOperacionId = operacionId;
      if (!this.empresas.length) {
        this.cargarEmpresas();
      } else if (empresaId) {
        this.aplicarDeepLinkSiPendiente();
      }
    });
  }

  @HostListener('window:resize')
  onVentanaResize(): void {
    this.actualizarVistaMovil();
  }

  private actualizarVistaMovil(): void {
    const movil = typeof window !== 'undefined' && window.innerWidth <= 767;
    this.esVistaMovil = movil;
    if (movil && this.modoVisual === 'compacto') {
      this.modoVisual = 'normal';
    }
  }

  ngOnDestroy(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.limpiarMiniaturas();
    this.revocarVisorBlob();
    document.body.classList.remove('visor-fullscreen-open');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.seguimientoAbierto) {
      this.seguimientoAbierto = false;
      return;
    }
    if (this.mostrarVisor) {
      this.cerrarVisor();
    }
  }

  @HostListener('document:click', ['$event'])
  cerrarSeguimientoSiClicFuera(event: MouseEvent): void {
    if (!this.seguimientoAbierto) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.pc-hist-seguimiento')) return;
    this.seguimientoAbierto = false;
  }

  alternarSeguimiento(event: Event): void {
    event.stopPropagation();
    this.seguimientoAbierto = !this.seguimientoAbierto;
  }

  async reabrirCicloPipc(): Promise<void> {
    if (!this.puedeReabrirCiclo || this.reabriendoCiclo || !this.empresaSeleccionada || !this.cicloSeleccionado) {
      return;
    }

    const result = await Swal.fire({
      title: '¿Reabrir PIPC?',
      html: '<p>El trámite volverá a <strong>PIPC Activos</strong> para darle seguimiento. Cuando termines podrás cerrarlo otra vez desde ahí.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#c0581e',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-undo mr-1"></i> Sí, reabrir',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

    this.reabriendoCiclo = true;
    const empresaId = this.empresaSeleccionada.empresa_id;
    const operacionId = this.cicloSeleccionado.operacion_id;
    this.backendService.reabrirCicloCentroOperacionesPC(empresaId, operacionId).subscribe({
      next: async (resp: any) => {
        this.reabriendoCiclo = false;
        if (!resp?.success) {
          await Swal.fire({
            icon: 'error',
            title: 'No se pudo reabrir',
            text: resp?.message || 'Intenta de nuevo.',
            confirmButtonColor: '#c0581e'
          });
          return;
        }
        await Swal.fire({
          icon: 'success',
          title: 'PIPC reabierto',
          text: resp?.message || 'Ya puedes continuar el seguimiento.',
          confirmButtonColor: '#c0581e',
          timer: 1800,
          timerProgressBar: true
        });
        this.router.navigate(['/proteccion-civil'], {
          queryParams: { vista: 'menuDocumentos', empresaId }
        });
      },
      error: async (err) => {
        this.reabriendoCiclo = false;
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo reabrir',
          text: err?.error?.message || 'Intenta de nuevo.',
          confirmButtonColor: '#c0581e'
        });
      }
    });
  }

  textoFechaSeguimiento(valor: string): string {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    const fecha = new Date(texto.replace(' ', 'T'));
    if (Number.isNaN(fecha.getTime())) return texto;
    return fecha.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private cargarSeguimientosPipc(empresaId: number): void {
    this.seguimientoAbierto = false;
    this.seguimientosPipc = [];
    this.backendService.listarSeguimientosResolutivosPipc(empresaId).subscribe({
      next: (resp: any) => {
        this.seguimientosPipc = Array.isArray(resp?.seguimientos) ? resp.seguimientos : [];
      },
      error: () => {
        this.seguimientosPipc = [];
      }
    });
  }

  get empresasPageSizeActual(): number {
    return this.modoVisual === 'compacto' ? 9 : 6;
  }

  get ciclosPageSizeActual(): number {
    return this.modoVisual === 'compacto' ? 8 : 5;
  }

  get totalEmpresasPages(): number {
    return Math.max(1, Math.ceil(this.empresasFiltradas.length / this.empresasPageSizeActual));
  }

  get empresasPageNumbers(): number[] {
    return Array.from({ length: this.totalEmpresasPages }, (_, i) => i + 1);
  }

  get empresasVisibles(): EmpresaHistorialPc[] {
    const start = (this.empresasCurrentPage - 1) * this.empresasPageSizeActual;
    return this.empresasFiltradas.slice(start, start + this.empresasPageSizeActual);
  }

  get totalCiclosPages(): number {
    return Math.max(1, Math.ceil(this.ciclosFiltrados.length / this.ciclosPageSizeActual));
  }

  get ciclosPageNumbers(): number[] {
    return Array.from({ length: this.totalCiclosPages }, (_, i) => i + 1);
  }

  get ciclosVisibles(): CicloHistorialPc[] {
    const start = (this.ciclosCurrentPage - 1) * this.ciclosPageSizeActual;
    return this.ciclosFiltrados.slice(start, start + this.ciclosPageSizeActual);
  }

  get tituloPrincipal(): string {
    if (this.vista === 'detalle') {
      return this.empresaSeleccionada?.nombre_empresa || 'Expediente del trámite';
    }
    return 'Seleccionar empresa con trámites finalizados';
  }

  get totalCiclosEnLista(): number {
    return this.empresasFiltradas.reduce((acc, e) => acc + Number(e.total_ciclos || 0), 0);
  }

  get totalArchivos(): number {
    return this.items.length;
  }

  get itemsFiltrados(): ItemHistorialPc[] {
    const q = this.filtroTexto.trim().toLowerCase();
    return this.items.filter((item) => {
      if (this.seccionFiltro !== 'todos' && item.apartado !== this.seccionFiltro) {
        return false;
      }
      if (!q) return true;
      // Buscar por nombre de asignación/requisito (no depender del filename subido).
      return [
        item.nombre_documento,
        item.pipc_titulo,
        item.grupo_titulo,
        item.valor_texto
      ].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  get seccionesConDatos(): SeccionHistorialPc[] {
    const base = this.seccionFiltro === 'todos'
      ? this.secciones
      : this.secciones.filter((s) => s.key === this.seccionFiltro);
    return base.filter((s) => this.contarApartado(s.key, true) > 0);
  }

  get seccionActivaObj(): SeccionHistorialPc | undefined {
    return this.secciones.find((s) => s.key === this.seccionActiva);
  }

  get itemsSeccionActiva(): ItemHistorialPc[] {
    return this.itemsDeApartado(this.seccionActiva);
  }

  get gruposSeccionActiva(): Array<{ titulo: string; pipc?: string | null; archivos: ItemHistorialPc[] }> {
    return this.gruposDeApartado(this.seccionActiva);
  }

  get esSeccionCompacta(): boolean {
    return this.esSeccionCompactaKey(this.seccionActiva);
  }

  get puedeReabrirCiclo(): boolean {
    const opId = Number(this.cicloSeleccionado?.operacion_id || 0);
    return !!this.empresaSeleccionada && !!this.cicloSeleccionado && opId > 0 && !this.cicloSeleccionado.es_legacy;
  }

  itemsDeApartado(apartado: string): ItemHistorialPc[] {
    return this.itemsFiltrados.filter((i) => i.apartado === apartado);
  }

  textosDeApartado(apartado: string): ItemHistorialPc[] {
    return this.itemsDeApartado(apartado).filter((i) => i.tipo_item === 'texto');
  }

  archivosDeApartado(apartado: string): ItemHistorialPc[] {
    return this.itemsDeApartado(apartado).filter((i) => i.tipo_item !== 'texto');
  }

  esSeccionCompactaKey(apartado: string): boolean {
    return ['oficios', 'observaciones', 'resolutivos'].includes(apartado);
  }

  gruposDeApartado(apartado: string): Array<{ titulo: string; pipc?: string | null; archivos: ItemHistorialPc[] }> {
    const items = this.archivosDeApartado(apartado);
    if (apartado === 'documentacion' || apartado === 'extra') {
      const map = new Map<string, { titulo: string; pipc?: string | null; archivos: ItemHistorialPc[] }>();
      for (const item of items) {
        const requisito = String(item.nombre_documento || 'Documento').trim() || 'Documento';
        const pipc = item.pipc_titulo || null;
        const key = `${pipc || ''}::${requisito}`;
        if (!map.has(key)) {
          map.set(key, { titulo: requisito, pipc, archivos: [] });
        }
        map.get(key)!.archivos.push(item);
      }
      return [...map.values()].sort((a, b) => {
        const pa = String(a.pipc || '').localeCompare(String(b.pipc || ''), 'es');
        if (pa !== 0) return pa;
        return a.titulo.localeCompare(b.titulo, 'es');
      });
    }

    const map = new Map<string, ItemHistorialPc[]>();
    for (const item of items) {
      const titulo = item.grupo_titulo || item.pipc_titulo || item.nombre_documento || 'Documentos';
      if (!map.has(titulo)) map.set(titulo, []);
      map.get(titulo)!.push(item);
    }
    return [...map.entries()].map(([titulo, archivos]) => ({ titulo, archivos }));
  }

  onFiltroTextoChange(): void {
    this.asegurarSeccionActivaVisible();
    this.precargarMiniaturasVisibles();
  }

  private inicializarSeccionActiva(): void {
    const primera = this.secciones.find((s) => this.contarApartado(s.key, false) > 0);
    this.seccionActiva = primera?.key || 'documentacion';
  }

  private asegurarSeccionActivaVisible(): void {
    const visibles = this.seccionesConDatos.map((s) => s.key);
    if (!visibles.length) return;
    if (!visibles.includes(this.seccionActiva)) {
      this.seccionActiva = visibles[0];
    }
  }

  cargarEmpresas(): void {
    this.cargando = true;
    this.backendService.obtenerEmpresasHistorialPC().subscribe({
      next: (resp: any) => {
        this.empresas = Array.isArray(resp?.empresas) ? resp.empresas : [];
        this.estados = [...new Set(this.empresas.map((e) => e.estado).filter(Boolean) as string[])].sort();
        this.filtrarEmpresas();
        this.cargando = false;
        this.aplicarDeepLinkSiPendiente();
      },
      error: () => {
        this.empresas = [];
        this.empresasFiltradas = [];
        this.cargando = false;
      }
    });
  }

  private aplicarDeepLinkSiPendiente(): void {
    const empresaId = this.deepLinkEmpresaId;
    if (!empresaId || !this.empresas.length) return;
    const empresa = this.empresas.find((e) => Number(e.empresa_id) === empresaId);
    if (!empresa) return;
    if (!this.empresaSeleccionada || Number(this.empresaSeleccionada.empresa_id) !== empresaId) {
      this.empresaSeleccionada = empresa;
      this.cicloSeleccionado = null;
      this.vista = 'lista';
      this.cargarCiclos(true);
      return;
    }
    if (this.deepLinkOperacionId && this.ciclos.length) {
      this.abrirCicloDeepLink();
    }
  }

  private abrirCicloDeepLink(): void {
    const operacionId = this.deepLinkOperacionId;
    if (!operacionId) return;
    const ciclo = this.ciclos.find((c) => Number(c.operacion_id) === operacionId);
    if (ciclo) {
      this.deepLinkOperacionId = null;
      this.deepLinkEmpresaId = null;
      this.abrirDetalleCiclo(ciclo);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { empresaId: null, operacionId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  filtrarEmpresas(): void {
    const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
    this.empresasFiltradas = this.empresas.filter((empresa) => {
      const coincideTexto = !texto
        || empresa.nombre_empresa.toLowerCase().includes(texto)
        || String(empresa.rfc || '').toLowerCase().includes(texto);
      const coincideEstado = !this.estadoSeleccionado || empresa.estado === this.estadoSeleccionado;
      const coincideMunicipio = !this.municipioSeleccionado || empresa.ciudad === this.municipioSeleccionado;
      return coincideTexto && coincideEstado && coincideMunicipio;
    });
    this.empresasCurrentPage = 1;
    this.actualizarMunicipios();
  }

  onEstadoChange(): void {
    this.municipioSeleccionado = '';
    this.filtrarEmpresas();
  }

  private actualizarMunicipios(): void {
    const base = this.estadoSeleccionado
      ? this.empresas.filter((e) => e.estado === this.estadoSeleccionado)
      : this.empresas;
    this.municipios = [...new Set(base.map((e) => e.ciudad).filter(Boolean) as string[])].sort();
  }

  seleccionarEmpresa(empresa: EmpresaHistorialPc): void {
    this.empresaSeleccionada = empresa;
    this.cicloSeleccionado = null;
    this.vista = 'lista';
    this.anoSeleccionado = 0;
    this.mesSeleccionado = 0;
    this.cargarCiclos();
    this.enfocarPanelCiclosEnMovil();
  }

  private enfocarPanelCiclosEnMovil(): void {
    if (!this.esVistaMovil || typeof document === 'undefined') {
      return;
    }
    setTimeout(() => {
      document.querySelector('.courses-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  limpiarSeleccionEmpresa(): void {
    this.empresaSeleccionada = null;
    this.ciclos = [];
    this.ciclosFiltrados = [];
    this.cicloSeleccionado = null;
    this.vista = 'lista';
  }

  cargarCiclos(desdeDeepLink = false): void {
    if (!this.empresaSeleccionada) return;
    this.cargandoCiclos = true;
    this.backendService.obtenerCiclosHistorialPC(this.empresaSeleccionada.empresa_id).subscribe({
      next: (resp: any) => {
        this.ciclos = Array.isArray(resp?.ciclos) ? resp.ciclos : [];
        this.anosDisponibles = [...new Set(
          this.ciclos
            .map((c) => new Date(c.fecha_cierre || c.fecha_inicio || 0).getFullYear())
            .filter((y) => y > 1970)
        )].sort((a, b) => b - a);
        this.filtrarCiclos();
        this.completarVigenciaSiFalta();
        this.cargandoCiclos = false;
        if (desdeDeepLink || this.deepLinkOperacionId) {
          this.abrirCicloDeepLink();
        }
      },
      error: () => {
        this.ciclos = [];
        this.ciclosFiltrados = [];
        this.cargandoCiclos = false;
      }
    });
  }

  filtrarCiclos(): void {
    this.ciclosFiltrados = this.ciclos.filter((ciclo) => {
      const fecha = new Date(ciclo.fecha_cierre || ciclo.fecha_inicio || 0);
      if (this.anoSeleccionado && fecha.getFullYear() !== this.anoSeleccionado) return false;
      if (this.mesSeleccionado && fecha.getMonth() + 1 !== this.mesSeleccionado) return false;
      return true;
    });
    this.ciclosCurrentPage = 1;
  }

  abrirDetalleCiclo(ciclo: CicloHistorialPc): void {
    if (!this.empresaSeleccionada) return;
    this.cicloSeleccionado = ciclo;
    this.vista = 'detalle';
    this.filtroTexto = '';
    this.seccionFiltro = 'todos';
    this.cargandoDetalle = true;
    this.cargarSeguimientosPipc(this.empresaSeleccionada.empresa_id);
    this.backendService.obtenerDetalleCicloHistorialPC(
      this.empresaSeleccionada.empresa_id,
      ciclo.operacion_id
    ).subscribe({
      next: (resp: any) => {
        this.items = Array.isArray(resp?.items) ? resp.items : [];
        if (resp?.ciclo) {
          this.cicloSeleccionado = {
            ...ciclo,
            ...resp.ciclo,
            fecha_vencimiento: resp.ciclo.fecha_vencimiento || ciclo.fecha_vencimiento || null
          };
        }
        this.inicializarSeccionActiva();
        this.cargandoDetalle = false;
        this.precargarMiniaturasVisibles();
      },
      error: () => {
        this.items = [];
        this.cargandoDetalle = false;
      }
    });
  }

  volverALista(): void {
    this.vista = 'lista';
    this.cicloSeleccionado = null;
    this.items = [];
    this.limpiarMiniaturas();
    this.seguimientoAbierto = false;
    this.seguimientosPipc = [];
    this.cerrarVisor();
  }

  setSeccionActiva(key: string): void {
    this.seccionActiva = key;
    this.precargarMiniaturasVisibles();
  }

  contarApartado(key: string, filtrado: boolean): number {
    const fuente = filtrado ? this.itemsFiltrados : this.items;
    return fuente.filter((i) => i.apartado === key).length;
  }

  contarArchivosApartado(key: string): number {
    return this.archivosDeApartado(key).length;
  }

  contarTextosApartado(key: string): number {
    return this.textosDeApartado(key).length;
  }

  cambiarModoVisual(modo: 'normal' | 'compacto'): void {
    if (this.esVistaMovil) {
      modo = 'normal';
    }
    this.modoVisual = modo;
  }

  irPaginaEmpresas(page: number): void {
    this.empresasCurrentPage = page;
  }

  irPaginaCiclos(page: number): void {
    this.ciclosCurrentPage = page;
  }

  trackByEmpresaId(_i: number, e: EmpresaHistorialPc): number {
    return e.empresa_id;
  }

  trackByCicloId(_i: number, c: CicloHistorialPc): number {
    return c.operacion_id;
  }

  getInicialesEmpresa(nombre: string): string {
    if (!nombre) return 'EM';
    const palabras = nombre.trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) {
      return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  getLogoEmpresaUrl(empresa: EmpresaHistorialPc): string | null {
    return this.backendService.resolverUrlDrivePreview(empresa?.logo || empresa?.logo_url);
  }

  onLogoError(empresa: EmpresaHistorialPc): void {
    empresa.logo = null;
    empresa.logo_url = null;
  }

  estadoVigencia(ciclo: CicloHistorialPc | null): 'vigente' | 'proximo' | 'urgente' | 'vencido' | 'sin_fecha' {
    const dias = this.diasParaVencer(ciclo);
    if (dias == null) return 'sin_fecha';
    if (dias <= 0) return 'vencido';
    if (dias <= 20) return 'urgente';
    if (dias <= 40) return 'proximo';
    return 'vigente';
  }

  textoDiasVigencia(ciclo: CicloHistorialPc | null): string {
    const dias = this.diasParaVencer(ciclo);
    if (dias == null) return 'Sin fecha';
    if (dias < 0) {
      const n = Math.abs(dias);
      return n === 1 ? 'Venció hace 1 día' : `Venció hace ${n} días`;
    }
    if (dias === 0) return 'Vence hoy';
    if (dias === 1) return 'Falta 1 día';
    return `Faltan ${dias} días`;
  }

  etiquetaVigencia(ciclo: CicloHistorialPc | null): string {
    switch (this.estadoVigencia(ciclo)) {
      case 'vencido': return 'Vencido';
      case 'urgente': return 'Por vencer';
      case 'proximo': return 'Próximo a vencer';
      case 'vigente': return 'Vigente';
      default: return '';
    }
  }

  private diasParaVencer(ciclo: CicloHistorialPc | null): number | null {
    const fv = this.parseFechaCalendario(ciclo?.fecha_vencimiento);
    if (!fv) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((fv.getTime() - hoy.getTime()) / 86400000);
  }

  private parseFechaCalendario(valor?: string | Date | null): Date | null {
    if (!valor) return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
    }
    const s = String(valor).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const mx = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (mx) return new Date(Number(mx[3]), Number(mx[2]) - 1, Number(mx[1]));
    return null;
  }

  private isoDesdeFecha(valor?: string | Date | null): string | null {
    const fecha = this.parseFechaCalendario(valor);
    if (!fecha) return null;
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private normalizarNombrePipc(valor?: string | null): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** El ciclo más reciente usa la fecha oficial del control de resolutivos. */
  private completarVigenciaSiFalta(): void {
    const empresaId = this.empresaSeleccionada?.empresa_id;
    const reciente = this.ciclos.find((c) => !c.es_legacy);
    if (!empresaId || !reciente) return;
    this.backendService.listarResolutivosPC(empresaId).subscribe({
      next: (resp: any) => this.aplicarVencimientoDesdeResolutivos(reciente, resp?.resolutivos || []),
      error: () => {}
    });
  }

  private aplicarVencimientoDesdeResolutivos(ciclo: CicloHistorialPc, resolutivos: any[]): void {
    const pipc = (resolutivos || []).filter((row) => {
      const tipo = String(row?.tipo_tramite || '').toLowerCase();
      return (!tipo || tipo === 'pipc') && row?.fecha_vencimiento;
    });
    const titulos = new Set((ciclo.pipc_titulos || []).map((t) => this.normalizarNombrePipc(t)).filter(Boolean));
    let elegidos = pipc;
    if (titulos.size) {
      const porNombre = pipc.filter((row) => titulos.has(this.normalizarNombrePipc(row.nombre_asignacion)));
      if (porNombre.length) elegidos = porNombre;
    }
    const fechas = elegidos
      .map((row) => this.isoDesdeFecha(row.fecha_vencimiento))
      .filter((fecha): fecha is string => !!fecha)
      .sort();
    if (fechas.length) ciclo.fecha_vencimiento = fechas[0];
  }

  tituloCiclo(ciclo: CicloHistorialPc): string {
    if (ciclo.es_legacy) return 'Historial previo de documentos';
    const titulos = (ciclo.pipc_titulos || []).filter(Boolean);
    if (titulos.length) return titulos.join(' · ');
    return `Trámite PIPC #${ciclo.operacion_id}`;
  }

  formatFecha(valor?: string | Date | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  formatFechaCorta(valor?: string | Date | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }

  getNombreArchivoResaltado(nombreArchivo: string): string {
    const nombreSeguro = String(nombreArchivo || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const termino = this.filtroTexto.trim();
    if (!termino) {
      return nombreSeguro;
    }
    const escapado = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return nombreSeguro.replace(new RegExp(`(${escapado})`, 'gi'), '<mark>$1</mark>');
  }

  colorArchivo(mime?: string | null, nombre?: string): string {
    const t = `${mime || ''} ${nombre || ''}`.toLowerCase();
    if (t.includes('pdf')) return '#dc2626';
    if (t.includes('sheet') || t.includes('xls')) return '#067647';
    if (t.includes('word') || t.includes('doc')) return '#2563eb';
    if (t.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(t)) return '#7c3aed';
    if (t.includes('texto')) return '#c0581e';
    return '#64748b';
  }

  iconoArchivo(item: ItemHistorialPc): string {
    if (item.tipo_item === 'texto') return 'fa-align-left';
    const m = String(item.mime_type || '').toLowerCase();
    const n = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'fa-file-pdf';
    if (m.includes('csv') || n.endsWith('.csv')) return 'fa-file-csv';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'fa-file-excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'fa-file-word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'fa-file-powerpoint';
    if (m.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'fa-file-image';
    return 'fa-file-alt';
  }

  claseTileArchivo(item: ItemHistorialPc): string {
    const m = String(item.mime_type || '').toLowerCase();
    const n = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'history-repo-tile--pdf';
    if (m.includes('csv') || n.endsWith('.csv')) return 'history-repo-tile--csv';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'history-repo-tile--excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'history-repo-tile--word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'history-repo-tile--ppt';
    if (m.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'history-repo-tile--imagen';
    return 'history-repo-tile--otro';
  }

  etiquetaTipoArchivo(item: ItemHistorialPc): string {
    const m = String(item.mime_type || '').toLowerCase();
    const n = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
    if (m.includes('csv') || n.endsWith('.csv')) return 'CSV';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'Excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'Word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'PowerPoint';
    if (m.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'Imagen';
    return 'Archivo';
  }

  abrirItemEnDrive(item: ItemHistorialPc, event?: Event): void {
    event?.stopPropagation();
    if (!item.drive_file_id) return;
    window.open(`https://drive.google.com/file/d/${item.drive_file_id}/view`, '_blank');
  }

  miniatura(item: ItemHistorialPc): MiniaturaHistorialPc {
    return this.miniaturas[item.item_id] || {
      urlStr: null,
      cargando: false,
      error: false,
      reintento: 0
    };
  }

  onErrorMiniatura(item: ItemHistorialPc, event?: Event): void {
    event?.stopPropagation();
    const prev = this.miniatura(item);
    if (!item.drive_file_id) {
      this.marcarMiniaturaError(item.item_id);
      return;
    }
    if (prev.reintento >= 2) {
      this.marcarMiniaturaError(item.item_id);
      return;
    }
    this.actualizarMiniatura(item.item_id, {
      urlStr: null,
      cargando: true,
      error: false,
      reintento: prev.reintento + 1
    });
    this.encolarMiniatura(item, true);
  }

  onLoadMiniatura(item: ItemHistorialPc): void {
    const prev = this.miniatura(item);
    if (prev.cargando || prev.error) {
      this.actualizarMiniatura(item.item_id, {
        ...prev,
        cargando: false,
        error: false
      });
    }
  }

  private precargarMiniaturasVisibles(): void {
    const archivos = this.esSeccionCompacta
      ? this.archivosDeApartado(this.seccionActiva)
      : this.gruposSeccionActiva.flatMap((g) => g.archivos);
    for (const item of archivos) {
      this.asegurarMiniatura(item);
    }
  }

  private asegurarMiniatura(item: ItemHistorialPc): void {
    if (!item || item.tipo_item === 'texto' || !item.drive_file_id) return;
    const prev = this.miniaturas[item.item_id];
    if (prev?.urlStr || prev?.cargando) return;

    // Primero thumbnail de Drive (rápido); si falla, onErrorMiniatura baja el archivo.
    this.actualizarMiniatura(item.item_id, {
      urlStr: this.urlThumbnailDrive(item.drive_file_id),
      cargando: false,
      error: false,
      reintento: 0
    });
  }

  private encolarMiniatura(item: ItemHistorialPc, prioritario: boolean): void {
    if (prioritario) {
      this.miniaturaCola.unshift(item);
    } else {
      this.miniaturaCola.push(item);
    }
    this.procesarColaMiniaturas();
  }

  private procesarColaMiniaturas(): void {
    while (this.miniaturasEnVuelo < this.miniaturaConcurrency && this.miniaturaCola.length) {
      const item = this.miniaturaCola.shift();
      if (!item) break;
      this.miniaturasEnVuelo += 1;
      this.cargarMiniaturaItem(item);
    }
  }

  private cargarMiniaturaItem(item: ItemHistorialPc): void {
    const driveId = String(item.drive_file_id || '').trim();
    const nombre = item.nombre_archivo || item.nombre_documento || 'archivo';
    if (!driveId) {
      this.marcarMiniaturaError(item.item_id);
      this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
      this.procesarColaMiniaturas();
      return;
    }

    if (this.esArchivoPdf(item)) {
      const sub = this.backendService.descargarArchivoDrive(driveId, nombre).subscribe({
        next: async (blob) => {
          try {
            if (!blob || blob.size < 20) throw new Error('blob vacío');
            const typed = blob.type === 'application/pdf'
              ? blob
              : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
            const thumb = await this.pdfThumbnail.renderizarPrimeraPagina(typed, 480);
            this.aplicarBlobMiniatura(item.item_id, thumb);
          } catch {
            this.actualizarMiniatura(item.item_id, {
              urlStr: this.urlThumbnailDrive(driveId, Date.now()),
              cargando: false,
              error: false,
              reintento: this.miniatura(item).reintento
            });
          } finally {
            this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
            this.procesarColaMiniaturas();
          }
        },
        error: () => {
          this.actualizarMiniatura(item.item_id, {
            urlStr: this.urlThumbnailDrive(driveId, Date.now()),
            cargando: false,
            error: false,
            reintento: this.miniatura(item).reintento
          });
          this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
          this.procesarColaMiniaturas();
        }
      });
      this.miniaturaSubs.push(sub);
      return;
    }

    const sub = this.backendService.descargarArchivoDrive(driveId, nombre).subscribe({
      next: (blob) => {
        if (!blob || blob.size < 20) {
          this.marcarMiniaturaError(item.item_id);
        } else {
          const mime = blob.type?.startsWith('image/')
            ? blob.type
            : this.inferirMimeImagen(nombre);
          const imageBlob = blob.type?.startsWith('image/')
            ? blob
            : new Blob([blob], { type: mime });
          this.aplicarBlobMiniatura(item.item_id, imageBlob);
        }
        this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
        this.procesarColaMiniaturas();
      },
      error: () => {
        this.marcarMiniaturaError(item.item_id);
        this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
        this.procesarColaMiniaturas();
      }
    });
    this.miniaturaSubs.push(sub);
  }

  private aplicarBlobMiniatura(itemId: number, blob: Blob): void {
    const prevUrl = this.miniaturaObjectUrls.get(itemId);
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      this.miniaturaObjectUrls.delete(itemId);
    }
    const url = URL.createObjectURL(blob);
    this.miniaturaObjectUrls.set(itemId, url);
    this.actualizarMiniatura(itemId, {
      urlStr: url,
      cargando: false,
      error: false,
      reintento: this.miniaturas[itemId]?.reintento || 0
    });
  }

  private marcarMiniaturaError(itemId: number): void {
    this.actualizarMiniatura(itemId, {
      urlStr: null,
      cargando: false,
      error: true,
      reintento: this.miniaturas[itemId]?.reintento || 0
    });
  }

  private actualizarMiniatura(itemId: number, estado: MiniaturaHistorialPc): void {
    this.miniaturas = { ...this.miniaturas, [itemId]: estado };
  }

  private urlThumbnailDrive(driveFileId: string, cacheBust = 0): string {
    const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w400`;
    return cacheBust ? `${base}&t=${cacheBust}` : base;
  }

  private esArchivoOffice(item: ItemHistorialPc): boolean {
    const m = String(item.mime_type || '').toLowerCase();
    const n = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    return m.includes('word') || m.includes('sheet') || m.includes('excel')
      || m.includes('presentation') || m.includes('powerpoint')
      || /\.(docx?|xlsx?|pptx?|csv)$/.test(n);
  }

  private limpiarMiniaturas(): void {
    for (const sub of this.miniaturaSubs) {
      sub.unsubscribe();
    }
    this.miniaturaSubs = [];
    this.miniaturaCola = [];
    this.miniaturasEnVuelo = 0;
    for (const url of this.miniaturaObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.miniaturaObjectUrls.clear();
    this.miniaturas = {};
  }

  formatearTamano(bytes?: number | null): string {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  abrirItem(item: ItemHistorialPc, event?: Event): void {
    event?.stopPropagation();
    this.visorNombre = item.tipo_item === 'texto'
      ? item.nombre_documento
      : (item.nombre_archivo || item.nombre_documento);
    this.visorIcono = this.iconoArchivo(item);
    this.visorDriveId = item.drive_file_id || '';
    this.zoomVisor = 100;
    this.revocarVisorBlob();
    if (item.tipo_item === 'texto') {
      this.visorEsTexto = true;
      this.visorEsImagen = false;
      this.visorModoPdf = false;
      this.visorUsaZoom = false;
      this.visorCargando = false;
      this.visorError = null;
      this.visorTexto = item.valor_texto || '';
      this.visorUrl = '';
      this.mostrarVisor = true;
      document.body.classList.add('visor-fullscreen-open');
      return;
    }
    if (!item.drive_file_id) return;
    this.visorEsTexto = false;
    this.visorTexto = '';
    this.visorEsImagen = this.esArchivoImagen(item);
    this.visorModoPdf = !this.visorEsImagen;
    this.visorUsaZoom = this.visorEsImagen;
    this.previewBlobVisor = null;
    this.visorError = null;
    this.visorProgreso = 4;
    this.visorEtiqueta = 'Preparando vista previa…';
    this.visorLento = false;
    this.visorCargando = true;
    this.mostrarVisor = true;
    document.body.classList.add('visor-fullscreen-open');
    void this.prepararUrlVisor(item);
  }

  private revocarVisorBlob(): void {
    if (this.visorBlobUrl) {
      URL.revokeObjectURL(this.visorBlobUrl);
      this.visorBlobUrl = null;
    }
  }

  private inferirMimeImagen(nombre: string): string {
    const ext = String(nombre || '').toLowerCase().split('.').pop() || '';
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tif: 'image/tiff',
      tiff: 'image/tiff'
    };
    return map[ext] || 'image/png';
  }

  private async prepararUrlVisor(item: ItemHistorialPc): Promise<void> {
    const driveId = String(item.drive_file_id || '').trim();
    if (!driveId) {
      this.visorCargando = false;
      return;
    }

    if (this.visorEsImagen) {
      const seq = ++this.visorSeq;
      this.visorSub?.unsubscribe();
      const nombre = item.nombre_archivo || item.nombre_documento || 'imagen.png';
      this.visorSub = this.backendService.descargarArchivoDrive(driveId, nombre).subscribe({
        next: (blob) => {
          if (seq !== this.visorSeq) return;
          const mime = blob?.type?.startsWith('image/')
            ? blob.type
            : this.inferirMimeImagen(nombre);
          const imageBlob = blob?.type?.startsWith('image/')
            ? blob
            : new Blob([blob], { type: mime });
          this.revocarVisorBlob();
          this.visorBlobUrl = URL.createObjectURL(imageBlob);
          this.visorUrl = this.visorBlobUrl;
          this.visorCargando = false;
          this.visorError = null;
        },
        error: () => {
          if (seq !== this.visorSeq) return;
          this.visorError = 'No se pudo cargar la imagen. Intenta descargarla o abrirla en Drive.';
          this.visorCargando = false;
          this.visorUrl = '';
        }
      });
      return;
    }

    const seq = ++this.visorSeq;
    this.visorSub?.unsubscribe();
    const nombre = item.nombre_archivo || item.nombre_documento || 'documento.pdf';
    const esPdf = this.esArchivoPdf(item);
    const request$ = esPdf
      ? this.backendService.descargarArchivoDriveEventos(driveId, nombre)
      : this.backendService.imprimirArchivoDriveComoPDFEventos(driveId, nombre);

    this.visorSub = this.pdfPreviewLoader.observar(
      request$,
      esPdf ? 'Descargando documento…' : 'Convirtiendo el documento a PDF…'
    ).subscribe(state => {
      if (seq !== this.visorSeq) {
        return;
      }
      this.visorProgreso = state.pct;
      this.visorEtiqueta = state.etiqueta;
      this.visorLento = state.lento;
      if (state.error) {
        this.visorError = state.error;
        this.visorCargando = false;
        return;
      }
      if (state.blob) {
        this.previewBlobVisor = state.blob;
        this.visorCargando = false;
      }
    });
  }

  private esArchivoImagen(item: ItemHistorialPc): boolean {
    const mime = String(item.mime_type || '').toLowerCase();
    const nombre = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    const ext = nombre.includes('.') ? nombre.split('.').pop() || '' : '';
    return mime.startsWith('image/')
      || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext);
  }

  private esArchivoPdf(item: ItemHistorialPc): boolean {
    const mime = String(item.mime_type || '').toLowerCase();
    const nombre = String(item.nombre_archivo || item.nombre_documento || '').toLowerCase();
    return mime.includes('pdf') || nombre.endsWith('.pdf');
  }

  abrirVisorEnNuevaPestana(): void {
    if (!this.visorDriveId) return;
    window.open(`https://drive.google.com/file/d/${this.visorDriveId}/view`, '_blank');
  }

  descargarVisor(): void {
    if (!this.visorDriveId) return;
    window.open(`https://drive.google.com/uc?export=download&id=${this.visorDriveId}`, '_blank');
  }

  descargarItem(item: ItemHistorialPc, event?: Event): void {
    event?.stopPropagation();
    if (!item.drive_file_id) return;
    window.open(`https://drive.google.com/uc?export=download&id=${item.drive_file_id}`, '_blank');
  }

  onVisorLoad(): void {
    this.visorCargando = false;
  }

  onVisorImageError(): void {
    this.visorCargando = false;
    this.visorError = 'No se pudo mostrar la imagen. Intenta descargarla o abrirla en Drive.';
  }

  ajustarZoomVisor(delta: number): void {
    this.zoomVisor = Math.min(this.zoomVisorMax, Math.max(this.zoomVisorMin, this.zoomVisor + delta));
  }

  resetZoomVisor(): void {
    this.zoomVisor = 100;
  }

  onWheelZoomVisor(event: WheelEvent): void {
    if (!this.visorUsaZoom || (!event.ctrlKey && !event.metaKey)) {
      return;
    }
    event.preventDefault();
    this.ajustarZoomVisor(event.deltaY > 0 ? -this.zoomVisorPaso : this.zoomVisorPaso);
  }

  cerrarVisor(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    this.mostrarVisor = false;
    this.revocarVisorBlob();
    this.visorUrl = '';
    this.visorTexto = '';
    this.visorDriveId = '';
    this.visorEsImagen = false;
    this.visorEsTexto = false;
    this.visorModoPdf = false;
    this.visorUsaZoom = false;
    this.previewBlobVisor = null;
    this.visorError = null;
    this.visorCargando = false;
    this.visorProgreso = 0;
    this.visorLento = false;
    this.zoomVisor = 100;
    document.body.classList.remove('visor-fullscreen-open');
  }

  onFiltroSeccionChange(): void {
    if (this.seccionFiltro !== 'todos') {
      this.seccionActiva = this.seccionFiltro;
    }
    this.asegurarSeccionActivaVisible();
    this.precargarMiniaturasVisibles();
  }

  limpiarBusqueda(): void {
    this.filtroTexto = '';
    this.seccionFiltro = 'todos';
    this.asegurarSeccionActivaVisible();
    this.precargarMiniaturasVisibles();
  }
}
