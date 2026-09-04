import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';

export interface CtTramite {
  tramite_id: number;
  empresa_id?: number | null;
  empresa_nombre?: string | null;
  item: number;
  oficio: string;
  accion_realizar?: string;
  responsable?: string;
  fecha_vencimiento?: string | null;
  clasificacion?: string | null;
  estatus: 'abierto' | 'cerrado' | string;
  observaciones?: string;
  documento_url?: string | null;
  documento_nombre?: string | null;
  documento_drive_id?: string | null;
  contestacion_url?: string | null;
  contestacion_nombre?: string | null;
  contestacion_drive_id?: string | null;
  tiene_contestacion?: number | boolean | null;
}

export interface CtArchivo {
  id: number;
  tramiteId: number;
  ambito: 'documento' | 'contestacion';
  carpetaRelativa?: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  driveFileId: string;
  webViewLink?: string | null;
  fechaSubida?: string;
}

interface CtCarpetaVista {
  nombre: string;
  ruta: string;
  cantidad: number;
}

type CtAmbito = 'documento' | 'contestacion';

@Component({
  selector: 'app-ambiental-control-tramites',
  templateUrl: './ambiental-control-tramites.component.html',
  styleUrls: ['./ambiental-control-tramites.component.scss']
})
export class AmbientalControlTramitesComponent implements OnInit, OnChanges, OnDestroy {
  @Input() puedeEditar = false;
  @Input() tramiteInicialId: number | null = null;
  @Input() ambitoInicial: CtAmbito = 'documento';
  @Output() editarTramite = new EventEmitter<CtTramite>();

  tramites: CtTramite[] = [];
  tramitesFiltrados: CtTramite[] = [];
  tramiteSeleccionado: CtTramite | null = null;
  busqueda = '';
  cargandoLista = false;
  cargandoArchivos = false;
  errorLista: string | null = null;

  ambitoActivo: CtAmbito = 'documento';
  archivosDocumento: CtArchivo[] = [];
  archivosContestacion: CtArchivo[] = [];
  archivoSeleccionado: CtArchivo | null = null;

  previewUrl: string | null = null;
  previewCargando = false;
  previewError: string | null = null;
  previewComoEmbed = false;
  visorExpandido = false;

  carpetasExpandidas = new Set<string>(['__raiz__']);
  readonly claveRaiz = '__raiz__';
  pageSize = 20;
  pagina = 1;

  private readonly destroy$ = new Subject<void>();

  constructor(private backend: BackendServices) {}

  ngOnInit(): void {
    this.cargarLista();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tramiteInicialId'] && !changes['tramiteInicialId'].firstChange && this.tramiteInicialId) {
      this.ajustarSeleccion();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.body.style.overflow = '';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visorExpandido) {
      this.toggleVisorExpandido();
    }
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.tramitesFiltrados.length / this.pageSize));
  }

  get tramitesPaginados(): CtTramite[] {
    const ini = (this.pagina - 1) * this.pageSize;
    return this.tramitesFiltrados.slice(ini, ini + this.pageSize);
  }

  get archivosActivos(): CtArchivo[] {
    return this.ambitoActivo === 'contestacion'
      ? this.archivosContestacion
      : this.archivosDocumento;
  }

  get carpetasRaiz(): CtCarpetaVista[] {
    return this.carpetasHijas('');
  }

  get archivosRaiz(): CtArchivo[] {
    return this.archivosEn('');
  }

  get tituloAmbito(): string {
    return this.ambitoActivo === 'contestacion' ? 'Contestación' : 'Documento';
  }

  get esImagenPreview(): boolean {
    if (this.previewComoEmbed) return false;
    const nombre = this.archivoSeleccionado?.nombreArchivo?.toLowerCase() || '';
    const mime = this.archivoSeleccionado?.mimeType?.toLowerCase() || '';
    return mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(nombre);
  }

  get esPdfPreview(): boolean {
    const nombre = this.archivoSeleccionado?.nombreArchivo?.toLowerCase() || '';
    const mime = this.archivoSeleccionado?.mimeType?.toLowerCase() || '';
    return mime.includes('pdf') || /\.pdf(\?|$)/i.test(nombre);
  }

  cargarLista(): void {
    this.cargandoLista = true;
    this.errorLista = null;
    this.backend.listarAmbientalTramites({ busqueda: this.busqueda.trim() || undefined })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoLista = false;
          this.tramites = Array.isArray(res?.tramites) ? res.tramites : [];
          this.aplicarFiltroLocal();
          this.ajustarSeleccion();
        },
        error: (err) => {
          this.cargandoLista = false;
          this.errorLista = err?.error?.message || 'No se pudieron cargar los trámites.';
          this.tramites = [];
          this.tramitesFiltrados = [];
        }
      });
  }

  onBusquedaChange(): void {
    this.pagina = 1;
    this.cargarLista();
  }

  seleccionarTramite(t: CtTramite): void {
    if (this.tramiteSeleccionado?.tramite_id === t.tramite_id) return;
    this.tramiteSeleccionado = t;
    this.ambitoActivo = 'documento';
    this.archivoSeleccionado = null;
    this.previewUrl = null;
    this.previewError = null;
    this.visorExpandido = false;
    this.carpetasExpandidas = new Set([this.claveRaiz]);
    this.cargarArchivos(t);
  }

  cambiarAmbito(ambito: CtAmbito): void {
    if (this.ambitoActivo === ambito) return;
    this.ambitoActivo = ambito;
    this.carpetasExpandidas = new Set([this.claveRaiz]);
    this.seleccionarPrimerArchivo();
  }

  seleccionarArchivo(archivo: CtArchivo, ampliar = false): void {
    this.archivoSeleccionado = archivo;
    this.previewComoEmbed = false;
    this.cargarPreview(archivo);
    if (ampliar) {
      this.visorExpandido = true;
      document.body.style.overflow = 'hidden';
    }
  }

  toggleCarpeta(ruta: string): void {
    const r = ruta === this.claveRaiz ? this.claveRaiz : this.norm(ruta);
    if (!r) return;
    if (this.carpetasExpandidas.has(r)) this.carpetasExpandidas.delete(r);
    else this.carpetasExpandidas.add(r);
    this.carpetasExpandidas = new Set(this.carpetasExpandidas);
  }

  estaExpandida(ruta: string): boolean {
    const r = ruta === this.claveRaiz ? this.claveRaiz : this.norm(ruta);
    return this.carpetasExpandidas.has(r);
  }

  carpetasHijas(rutaPadre: string): CtCarpetaVista[] {
    const actual = this.norm(rutaPadre);
    const mapa = new Map<string, number>();
    for (const doc of this.archivosActivos) {
      const ruta = this.norm(doc.carpetaRelativa);
      if (!ruta) continue;
      let resto = '';
      if (!actual) resto = ruta;
      else if (ruta === actual || !ruta.startsWith(actual + '/')) continue;
      else resto = ruta.slice(actual.length + 1);
      const nombre = resto.split('/')[0];
      if (!nombre) continue;
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

  archivosEn(rutaPadre: string): CtArchivo[] {
    const actual = this.norm(rutaPadre);
    return this.archivosActivos.filter(d => this.norm(d.carpetaRelativa) === actual);
  }

  irPagina(pagina: number): void {
    this.pagina = Math.min(Math.max(1, pagina), this.totalPaginas);
  }

  toggleVisorExpandido(): void {
    if (!this.previewUrl) return;
    this.visorExpandido = !this.visorExpandido;
    document.body.style.overflow = this.visorExpandido ? 'hidden' : '';
  }

  onEditar(): void {
    if (this.tramiteSeleccionado && this.puedeEditar) {
      this.editarTramite.emit(this.tramiteSeleccionado);
    }
  }

  abrirEnDrive(): void {
    const id = this.archivoSeleccionado?.driveFileId;
    if (!id) return;
    window.open(`https://drive.google.com/file/d/${id}/view`, '_blank');
  }

  formatearTamano(bytes: number | null | undefined): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  etiquetaTipo(mime: string | null | undefined, nombre: string): string {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'IMG';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'Word';
    return 'Archivo';
  }

  iconoTipo(mime: string | null | undefined, nombre: string): string {
    const t = this.etiquetaTipo(mime, nombre);
    if (t === 'PDF') return 'fa-file-pdf';
    if (t === 'IMG') return 'fa-file-image';
    if (t === 'Word') return 'fa-file-word';
    return 'fa-file-alt';
  }

  etiquetaCarpeta(doc: CtArchivo): string {
    return this.norm(doc.carpetaRelativa) || 'Documentación extra';
  }

  tieneDocumento(t: CtTramite): boolean {
    return !!(t.documento_drive_id || t.documento_nombre || t.documento_url);
  }

  tieneContestacion(t: CtTramite): boolean {
    return !!(Number(t.tiene_contestacion) === 1 || t.contestacion_drive_id || t.contestacion_nombre);
  }

  etiquetaEstatus(estatus: string): string {
    return estatus === 'cerrado' ? 'Cerrado' : 'Abierto';
  }

  trackByTramiteId(_: number, t: CtTramite): number {
    return t.tramite_id;
  }

  trackByArchivoId(_: number, a: CtArchivo): number {
    return a.id;
  }

  trackByRuta(_: number, c: CtCarpetaVista): string {
    return c.ruta;
  }

  private aplicarFiltroLocal(): void {
    this.tramitesFiltrados = [...this.tramites];
    if (this.pagina > this.totalPaginas) this.pagina = 1;
  }

  private ajustarSeleccion(): void {
    if (!this.tramitesFiltrados.length) {
      this.tramiteSeleccionado = null;
      this.archivosDocumento = [];
      this.archivosContestacion = [];
      this.archivoSeleccionado = null;
      this.previewUrl = null;
      return;
    }
    if (this.tramiteInicialId) {
      const indice = this.tramitesFiltrados.findIndex(t => t.tramite_id === this.tramiteInicialId);
      if (indice >= 0) {
        this.pagina = Math.floor(indice / this.pageSize) + 1;
        const tramite = this.tramitesFiltrados[indice];
        this.tramiteInicialId = null;
        this.seleccionarTramite(tramite);
        return;
      }
      this.tramiteInicialId = null;
    }
    if (this.tramiteSeleccionado) {
      const actual = this.tramitesFiltrados.find(t => t.tramite_id === this.tramiteSeleccionado!.tramite_id);
      if (actual) {
        this.tramiteSeleccionado = actual;
        return;
      }
    }
    const primero = this.tramitesPaginados[0] || this.tramitesFiltrados[0];
    this.seleccionarTramite(primero);
  }

  private cargarArchivos(t: CtTramite): void {
    this.cargandoArchivos = true;
    this.archivosDocumento = [];
    this.archivosContestacion = [];
    forkJoin({
      documento: this.backend.listarAmbientalTramiteArchivos(t.tramite_id, 'documento').pipe(
        catchError(() => of({ archivos: [] }))
      ),
      contestacion: this.backend.listarAmbientalTramiteArchivos(t.tramite_id, 'contestacion').pipe(
        catchError(() => of({ archivos: [] }))
      )
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ documento, contestacion }) => {
        this.archivosDocumento = Array.isArray(documento?.archivos) ? documento.archivos : [];
        this.archivosContestacion = Array.isArray(contestacion?.archivos) ? contestacion.archivos : [];
        this.cargandoArchivos = false;
        if (this.ambitoInicial === 'contestacion' && this.archivosContestacion.length) {
          this.ambitoActivo = 'contestacion';
          this.ambitoInicial = 'documento';
        } else if (!this.archivosDocumento.length && this.archivosContestacion.length) {
          this.ambitoActivo = 'contestacion';
        }
        this.seleccionarPrimerArchivo();
      },
      error: () => {
        this.cargandoArchivos = false;
        this.previewError = 'No se pudieron cargar los anexos.';
      }
    });
  }

  private seleccionarPrimerArchivo(): void {
    const lista = this.archivosActivos;
    if (!lista.length) {
      this.archivoSeleccionado = null;
      this.previewUrl = null;
      this.previewError = null;
      return;
    }
    const sueltos = this.archivosEn('');
    const primero = sueltos[0] || lista[0];
    if (sueltos.length) this.carpetasExpandidas.add(this.claveRaiz);
    else if (primero.carpetaRelativa) {
      const top = this.norm(primero.carpetaRelativa).split('/')[0];
      if (top) this.carpetasExpandidas.add(top);
    }
    this.carpetasExpandidas = new Set(this.carpetasExpandidas);
    this.seleccionarArchivo(primero);
  }

  private cargarPreview(archivo: CtArchivo): void {
    if (!this.tramiteSeleccionado || !archivo?.driveFileId) {
      this.previewUrl = null;
      return;
    }
    this.previewCargando = true;
    this.previewError = null;
    this.previewUrl = null;

    const proxyUrl = this.backend.resolverUrlDrivePreview(archivo.driveFileId);
    const driveEmbed = `https://drive.google.com/file/d/${archivo.driveFileId}/preview`;
    const thumbUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(archivo.driveFileId)}&sz=w1600`;

    this.backend.prepararVistaAmbientalTramiteArchivo(this.tramiteSeleccionado.tramite_id, archivo.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.previewCargando = false;
          // Imágenes: proxy del backend (sirve bytes) o miniatura; PDF/otros: iframe Drive o proxy.
          if (this.esImagenPorArchivo(archivo)) {
            this.previewUrl = proxyUrl || res?.thumbnailUrl || thumbUrl;
          } else {
            // El proxy usa el visor PDF nativo y evita el botón externo de Google Drive.
            this.previewUrl = proxyUrl || res?.previewUrl || driveEmbed;
          }
        },
        error: () => {
          this.previewCargando = false;
          this.previewUrl = this.esImagenPorArchivo(archivo)
            ? (proxyUrl || thumbUrl)
            : (proxyUrl || driveEmbed);
        }
      });
  }

  private esImagenPorArchivo(archivo: CtArchivo): boolean {
    const nombre = archivo?.nombreArchivo?.toLowerCase() || '';
    const mime = archivo?.mimeType?.toLowerCase() || '';
    return mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(nombre);
  }

  onPreviewImgError(): void {
    const id = this.archivoSeleccionado?.driveFileId;
    if (!id) {
      this.previewError = 'No se pudo mostrar la imagen.';
      this.previewUrl = null;
      return;
    }
    const thumb = `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
    if (this.previewUrl && !this.previewUrl.includes('thumbnail?')) {
      this.previewUrl = thumb;
      return;
    }
    this.previewComoEmbed = true;
    this.previewUrl = `https://drive.google.com/file/d/${id}/preview`;
  }

  private norm(ruta: string | null | undefined): string {
    return String(ruta || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(s => s.trim())
      .filter(s => s && s !== '.' && s !== '..')
      .join('/');
  }
}
