import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';

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
  vista: 'lista' | 'detalle' = 'lista';
  cargando = false;
  cargandoCiclos = false;
  cargandoDetalle = false;

  empresas: EmpresaHistorialPc[] = [];
  empresasFiltradas: EmpresaHistorialPc[] = [];
  empresaSeleccionada: EmpresaHistorialPc | null = null;
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
  zoomVisor = 100;
  readonly zoomVisorMin = 25;
  readonly zoomVisorMax = 300;
  readonly zoomVisorPaso = 25;

  constructor(
    private backendService: BackendServices,
    private pdfPreviewLoader: PdfPreviewLoaderService
  ) {}

  ngOnInit(): void {
    this.cargarEmpresas();
  }

  ngOnDestroy(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    document.body.classList.remove('visor-fullscreen-open');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mostrarVisor) {
      this.cerrarVisor();
    }
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
      return [
        item.nombre_documento,
        item.nombre_archivo,
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
    return base.filter((s) => this.contarApartado(s.key, true) > 0 || this.contarApartado(s.key, false) > 0);
  }

  get seccionActivaObj(): SeccionHistorialPc | undefined {
    return this.secciones.find((s) => s.key === this.seccionActiva);
  }

  get itemsSeccionActiva(): ItemHistorialPc[] {
    return this.itemsFiltrados.filter((i) => i.apartado === this.seccionActiva);
  }

  get gruposSeccionActiva(): Array<{ titulo: string; archivos: ItemHistorialPc[] }> {
    const map = new Map<string, ItemHistorialPc[]>();
    for (const item of this.itemsSeccionActiva) {
      const titulo = item.grupo_titulo || item.pipc_titulo || item.nombre_documento || 'Documentos';
      if (!map.has(titulo)) map.set(titulo, []);
      map.get(titulo)!.push(item);
    }
    return [...map.entries()].map(([titulo, archivos]) => ({ titulo, archivos }));
  }

  cargarEmpresas(): void {
    this.cargando = true;
    this.backendService.obtenerEmpresasHistorialPC().subscribe({
      next: (resp: any) => {
        this.empresas = Array.isArray(resp?.empresas) ? resp.empresas : [];
        this.estados = [...new Set(this.empresas.map((e) => e.estado).filter(Boolean) as string[])].sort();
        this.filtrarEmpresas();
        this.cargando = false;
      },
      error: () => {
        this.empresas = [];
        this.empresasFiltradas = [];
        this.cargando = false;
      }
    });
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
  }

  limpiarSeleccionEmpresa(): void {
    this.empresaSeleccionada = null;
    this.ciclos = [];
    this.ciclosFiltrados = [];
    this.cicloSeleccionado = null;
    this.vista = 'lista';
  }

  cargarCiclos(): void {
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
        this.cargandoCiclos = false;
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
    this.backendService.obtenerDetalleCicloHistorialPC(
      this.empresaSeleccionada.empresa_id,
      ciclo.operacion_id
    ).subscribe({
      next: (resp: any) => {
        this.items = Array.isArray(resp?.items) ? resp.items : [];
        if (resp?.ciclo) {
          this.cicloSeleccionado = { ...ciclo, ...resp.ciclo };
        }
        const primera = this.secciones.find((s) => this.contarApartado(s.key, false) > 0);
        this.seccionActiva = primera?.key || 'documentacion';
        this.cargandoDetalle = false;
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
    this.cerrarVisor();
  }

  setSeccionActiva(key: string): void {
    this.seccionActiva = key;
  }

  contarApartado(key: string, filtrado: boolean): number {
    const fuente = filtrado ? this.itemsFiltrados : this.items;
    return fuente.filter((i) => i.apartado === key).length;
  }

  cambiarModoVisual(modo: 'normal' | 'compacto'): void {
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
    const t = `${item.mime_type || ''} ${item.nombre_archivo || ''}`.toLowerCase();
    if (t.includes('pdf')) return 'fa-file-pdf';
    if (t.includes('sheet') || t.includes('xls')) return 'fa-file-excel';
    if (t.includes('word') || t.includes('doc')) return 'fa-file-word';
    if (t.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(t)) return 'fa-file-image';
    return 'fa-file';
  }

  formatearTamano(bytes?: number | null): string {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  abrirItem(item: ItemHistorialPc, event?: Event): void {
    event?.stopPropagation();
    this.visorNombre = item.nombre_archivo || item.nombre_documento;
    this.visorIcono = this.iconoArchivo(item);
    this.visorDriveId = item.drive_file_id || '';
    this.zoomVisor = 100;
    if (item.tipo_item === 'texto') {
      this.visorEsTexto = true;
      this.visorEsImagen = false;
      this.visorUsaZoom = false;
      this.visorCargando = false;
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

  private async prepararUrlVisor(item: ItemHistorialPc): Promise<void> {
    const driveId = String(item.drive_file_id || '').trim();
    if (!driveId) {
      this.visorCargando = false;
      return;
    }

    if (this.visorEsImagen) {
      try {
        await firstValueFrom(this.backendService.asegurarAccesoPublicoDrive(driveId));
      } catch {
        // El proxy del servidor sigue disponible para imágenes.
      }
      const proxyUrl = this.backendService.resolverUrlDrivePreview(driveId);
      this.visorUrl = proxyUrl || `https://drive.google.com/file/d/${driveId}/preview`;
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
    this.visorUrl = '';
    this.visorTexto = '';
    this.visorDriveId = '';
    this.visorEsImagen = false;
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

  limpiarBusqueda(): void {
    this.filtroTexto = '';
    this.seccionFiltro = 'todos';
  }

  onFiltroSeccionChange(): void {
    if (this.seccionFiltro !== 'todos') {
      this.seccionActiva = this.seccionFiltro;
    }
  }
}
