import { Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, firstValueFrom, of } from 'rxjs';
import { catchError, concatMap, mergeMap, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfThumbnailService } from 'src/app/services/pdf-thumbnail.service';

export interface EmpresaRepoItem {
  id: number;
  titulo: string;
  descripcion: string;
  categoria: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  driveFileId: string;
  carpetaRelativa?: string;
  subidoPor: string | null;
  fechaSubida: string;
  fechaActualizacion: string;
}

export interface EmpresaRepoCarpeta {
  id?: number;
  ruta: string;
  nombre: string;
  cantidad: number;
}

type VistaPreview = 'pdf' | 'imagen' | 'office' | 'icono';
type MiniaturaModo = 'imagen' | 'icono';

interface MiniaturaEstado {
  modo: MiniaturaModo;
  urlStr: string | null;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

@Component({
  selector: 'app-empresa-repositorio',
  templateUrl: './empresa-repositorio.component.html',
  styleUrls: ['./empresa-repositorio.component.scss']
})
export class EmpresaRepositorioComponent implements OnInit, OnDestroy {
  empresaId = 0;
  empresa: any = null;
  puedeAdministrar = false;
  /** Solo administrador o root pueden abrir el editor integrado de Office. */
  puedeEditorIntegrado = false;
  etiquetaRolUsuario = '';
  documentos: EmpresaRepoItem[] = [];
  /** Carpetas registradas (incluye vacías). */
  carpetasRegistradas: { ruta: string; nombre: string }[] = [];
  carpetasVista: EmpresaRepoCarpeta[] = [];
  documentosVista: EmpresaRepoItem[] = [];
  busqueda = '';
  cargandoLista = false;
  errorLista: string | null = null;

  /** Vista de archivos: cuadrícula o tabla. */
  vistaArchivos: 'grid' | 'lista' = 'grid';
  /** Zona de arrastre para subir archivos desde el escritorio. */
  dropzoneActiva = false;

  /** Ruta de la carpeta actual ('' = raíz). */
  carpetaActual = '';
  moviendo = false;
  dragDocId: number | null = null;
  dropTargetRuta: string | null = null;

  miniaturas: Record<number, MiniaturaEstado> = {};

  mostrarSubida = false;
  subiendo = false;
  errorSubida: string | null = null;
  archivosSeleccionados: File[] = [];
  progresoActual = 0;
  progresoTotal = 0;
  progresoNombre = '';

  mostrarVisor = false;
  visorCargando = false;
  visorError: string | null = null;
  documentoActivo: EmpresaRepoItem | null = null;
  previewModo: VistaPreview = 'icono';
  previewUrlSafe: SafeResourceUrl | null = null;
  previewBlob: Blob | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Cargando documento…';
  visorLento = false;
  editorUrlCruda: string | null = null;
  mostrarEditorIntegrado = false;
  editorIntegradoCargando = false;
  editorIntegradoUrlSafe: SafeResourceUrl | null = null;
  private previewObjectUrl: string | null = null;
  private readonly miniaturaObjectUrls = new Map<number, string>();

  private readonly destroy$ = new Subject<void>();
  private readonly miniaturaQueue$ = new Subject<EmpresaRepoItem>();
  private docIdPendienteVisor: number | null = null;
  /** Archivos por petición al servidor (evita payloads enormes). */
  private readonly TAMANO_LOTE_SUBIDA = 8;
  private readonly CONCURRENCIA_LECTURA = 4;

  constructor(
    private authService: AuthService,
    private backend: BackendServices,
    private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private pdfThumbnail: PdfThumbnailService,
    private ngZone: NgZone
  ) {}

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarVisor(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.mostrarEditorIntegrado) {
      event.preventDefault();
      this.cerrarEditorIntegrado();
      return;
    }
    if (!this.mostrarVisor) {
      return;
    }
    event.preventDefault();
    this.cerrarVisor();
  }

  ngOnInit(): void {
    this.puedeAdministrar = this.authService.puedeEscribirRepositorioEmpresa();
    this.puedeEditorIntegrado = this.authService.esAdministradorOSuperior();
    this.miniaturaQueue$
      .pipe(
        mergeMap((doc) => this.cargarMiniaturaDoc$(doc), 2),
        takeUntil(this.destroy$)
      )
      .subscribe((resultado) => {
        this.ngZone.run(() => this.aplicarResultadoMiniatura(resultado));
      });
    this.initEtiquetaRol();
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const id = Number(params.get('id'));
      this.empresaId = Number.isFinite(id) && id > 0 ? id : 0;
      if (this.empresaId) {
        this.cargarLista();
      }
    });
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const docId = Number(params.get('doc'));
      this.docIdPendienteVisor = Number.isFinite(docId) && docId > 0 ? docId : null;
      this.intentarAbrirVisorDesdeBusqueda();
    });
  }

  ngOnDestroy(): void {
    this.revocarPreviewUrl();
    this.limpiarMiniaturas();
    this.setEditorBodyState(false);
    this.destroy$.next();
    this.destroy$.complete();
  }

  get migasCarpeta(): { etiqueta: string; ruta: string }[] {
    const ruta = this.normalizarRuta(this.carpetaActual);
    if (!ruta) {
      return [];
    }
    const partes = ruta.split('/');
    const migas: { etiqueta: string; ruta: string }[] = [];
    let acum = '';
    for (const parte of partes) {
      acum = acum ? `${acum}/${parte}` : parte;
      migas.push({ etiqueta: parte, ruta: acum });
    }
    return migas;
  }

  get etiquetaCarpetaActual(): string {
    if (!this.carpetaActual) {
      return 'Repositorio Empresarial';
    }
    return this.carpetaActual.split('/').pop() || this.carpetaActual;
  }

  get totalBytesUsados(): number {
    return this.documentos.reduce((acc, d) => acc + (Number(d.tamanoBytes) || 0), 0);
  }

  get totalDocumentos(): number {
    return this.documentos.length;
  }

  get totalCarpetasRegistradas(): number {
    return this.carpetasRegistradas.length;
  }

  get conteoDocumentos(): number {
    return this.documentos.filter(d => this.esTipoDocumento(d) && !this.esTipoPdf(d)).length;
  }

  get conteoPdf(): number {
    return this.documentos.filter(d => this.esTipoPdf(d)).length;
  }

  get conteoImagenes(): number {
    return this.documentos.filter(d => this.esTipoImagen(d)).length;
  }

  /** Barra visual de uso (sin cuota; escala suave según volumen). */
  get porcentajeUsoVisual(): number {
    const bytes = this.totalBytesUsados;
    if (bytes <= 0) {
      return 6;
    }
    const mb = bytes / (1024 * 1024);
    return Math.min(92, Math.max(12, Math.round(18 + Math.log10(mb + 1) * 28)));
  }

  /** Vista de la carpeta en la que estamos (para eliminar desde el header). */
  get carpetaActualVista(): EmpresaRepoCarpeta | null {
    const ruta = this.normalizarRuta(this.carpetaActual);
    if (!ruta) {
      return null;
    }
    const cantidad = this.documentos.filter(d => {
      const r = this.normalizarRuta(d.carpetaRelativa);
      return r === ruta || r.startsWith(ruta + '/');
    }).length;
    return {
      nombre: this.etiquetaCarpetaActual,
      ruta,
      cantidad
    };
  }

  get logoEmpresaUrl(): string | null {
    return this.backend.resolverUrlDrivePreview(this.empresa?.logo || this.empresa?.logo_url);
  }

  get inicialesEmpresa(): string {
    const nombre = String(this.empresa?.nombre_empresa || '').trim();
    if (!nombre) return '??';
    const palabras = nombre.split(' ').filter(Boolean);
    if (palabras.length >= 2) {
      return (palabras[0][0] + palabras[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  get ubicacionEmpresa(): string {
    const partes = [
      this.empresa?.ciudad,
      this.empresa?.estado,
      this.empresa?.codigo_postal ? `CP ${this.empresa.codigo_postal}` : ''
    ].filter(Boolean);
    return partes.join(', ') || '';
  }

  onLogoFichaError(): void {
    if (this.empresa) {
      this.empresa.logo = null;
      this.empresa.logo_url = null;
    }
  }

  volverAlDirectorio(): void {
    this.router.navigate(['/mis-empresas']);
  }

  private initEtiquetaRol(): void {
    const etiquetas: Record<string, string> = {
      root: 'Super administrador',
      administrador: 'Administrador',
      proteccion_civil: 'Protección Civil',
      sgc: 'SGC',
      ambiental: 'Ambiental',
      rrhh: 'RRHH'
    };
    const principal = (this.authService.getRol() || '').toLowerCase();
    const roles = (this.authService.getRoles() || []).map((r) => String(r).toLowerCase());
    const clave = etiquetas[principal]
      ? principal
      : (roles.find((r) => !!etiquetas[r]) || principal);
    this.etiquetaRolUsuario = etiquetas[clave] || 'Consulta';
  }

  cargarLista(): void {
    if (!this.empresaId) {
      return;
    }
    this.cargandoLista = true;
    this.errorLista = null;
    this.limpiarMiniaturas();
    this.backend
      .listarEmpresaRepositorio(this.empresaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.empresa = res?.empresa || this.empresa;
          this.documentos = Array.isArray(res?.documentos) ? res.documentos : [];
          this.carpetasRegistradas = Array.isArray(res?.carpetas)
            ? res.carpetas.map((c: any) => ({
                ruta: this.normalizarRuta(c.ruta || c.nombre || ''),
                nombre: c.nombre || String(c.ruta || '').split('/').pop() || ''
              }))
            : [];
          this.aplicarFiltro();
          this.cargandoLista = false;
          this.intentarAbrirVisorDesdeBusqueda();
        },
        error: err => {
          this.errorLista = err?.error?.message || err?.message || 'No se pudo cargar la documentación.';
          this.cargandoLista = false;
        }
      });
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    const actual = this.normalizarRuta(this.carpetaActual);

    if (q) {
      // Búsqueda global: muestra archivos que coincidan (sin navegación de carpetas).
      this.carpetasVista = [];
      this.documentosVista = this.documentos.filter(
        d =>
          d.nombreArchivo.toLowerCase().includes(q) ||
          (d.titulo || '').toLowerCase().includes(q) ||
          this.normalizarRuta(d.carpetaRelativa).toLowerCase().includes(q)
      );
      this.precargarMiniaturas(this.documentosVista);
      return;
    }

    this.carpetasVista = this.obtenerCarpetasHijas(actual);
    this.documentosVista = this.documentos.filter(
      d => this.normalizarRuta(d.carpetaRelativa) === actual
    );
    this.precargarMiniaturas(this.documentosVista);
  }

  setVistaArchivos(vista: 'grid' | 'lista'): void {
    this.vistaArchivos = vista;
  }

  tamanoCarpeta(carpeta: EmpresaRepoCarpeta): number {
    const ruta = this.normalizarRuta(carpeta.ruta);
    return this.documentos
      .filter(d => {
        const r = this.normalizarRuta(d.carpetaRelativa);
        return r === ruta || r.startsWith(ruta + '/');
      })
      .reduce((acc, d) => acc + (Number(d.tamanoBytes) || 0), 0);
  }

  private esTipoImagen(doc: EmpresaRepoItem): boolean {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    return m.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg)$/.test(n);
  }

  private esTipoPdf(doc: EmpresaRepoItem): boolean {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    return m.includes('pdf') || n.endsWith('.pdf');
  }

  private esTipoDocumento(doc: EmpresaRepoItem): boolean {
    if (this.esTipoImagen(doc)) {
      return false;
    }
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    return (
      m.includes('pdf') ||
      n.endsWith('.pdf') ||
      m.includes('csv') ||
      n.endsWith('.csv') ||
      this.esTipoOffice(doc) ||
      m.includes('text') ||
      /\.(txt|rtf)$/.test(n)
    );
  }

  private esTipoOffice(doc: EmpresaRepoItem): boolean {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    return (
      m.includes('sheet') ||
      m.includes('excel') ||
      /\.xlsx?$/.test(n) ||
      m.includes('word') ||
      /\.docx?$/.test(n) ||
      m.includes('presentation') ||
      m.includes('powerpoint') ||
      /\.pptx?$/.test(n)
    );
  }

  onDropzoneDragOver(event: DragEvent): void {
    if (!this.puedeAdministrar) {
      return;
    }
    if (this.dragDocId != null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dropzoneActiva = true;
  }

  onDropzoneDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dropzoneActiva = false;
  }

  onDropzoneDrop(event: DragEvent): void {
    if (!this.puedeAdministrar) {
      return;
    }
    if (this.dragDocId != null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dropzoneActiva = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }
    this.abrirPanelSubida();
    this.agregarArchivos(files);
  }

  private obtenerCarpetasHijas(rutaPadre: string): EmpresaRepoCarpeta[] {
    const actual = this.normalizarRuta(rutaPadre);
    const mapa = new Map<string, number>();

    for (const doc of this.documentos) {
      const ruta = this.normalizarRuta(doc.carpetaRelativa);
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

    for (const reg of this.carpetasRegistradas) {
      const ruta = this.normalizarRuta(reg.ruta);
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
      const hijaNombre = resto.split('/')[0];
      if (!hijaNombre) {
        continue;
      }
      if (!mapa.has(hijaNombre)) {
        mapa.set(hijaNombre, 0);
      }
    }

    return Array.from(mapa.entries())
      .map(([nombre, cantidad]) => ({
        nombre,
        ruta: actual ? `${actual}/${nombre}` : nombre,
        cantidad
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  normalizarRuta(ruta: string | null | undefined): string {
    return String(ruta || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(s => s.trim())
      .filter(s => s && s !== '.' && s !== '..')
      .join('/');
  }

  entrarCarpeta(ruta: string): void {
    this.carpetaActual = this.normalizarRuta(ruta);
    this.busqueda = '';
    this.aplicarFiltro();
  }

  irARaiz(): void {
    this.entrarCarpeta('');
  }

  irAMiga(ruta: string): void {
    this.entrarCarpeta(ruta);
  }

  subirNivel(): void {
    const actual = this.normalizarRuta(this.carpetaActual);
    if (!actual.includes('/')) {
      this.irARaiz();
      return;
    }
    this.entrarCarpeta(actual.slice(0, actual.lastIndexOf('/')));
  }

  async crearCarpeta(): Promise<void> {
    if (!this.puedeAdministrar) {
      return;
    }
    const { value: nombre } = await Swal.fire({
      title: 'Nueva carpeta',
      input: 'text',
      inputLabel: this.carpetaActual
        ? `Se creará dentro de «${this.etiquetaCarpetaActual}»`
        : 'Se creará en la raíz del repositorio',
      inputPlaceholder: 'Ej. Contratos, Fiscal, Contactos…',
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      inputValidator: value => {
        const n = String(value || '').trim();
        if (!n) {
          return 'Escribe un nombre para la carpeta.';
        }
        if (/[/\\?%*:|"<>]/.test(n)) {
          return 'El nombre no puede contener caracteres especiales.';
        }
        return null;
      }
    });

    if (!nombre) {
      return;
    }

    try {
      await firstValueFrom(
        this.backend
          .crearEmpresaRepositorioCarpeta(this.empresaId, {
            nombre: String(nombre).trim(),
            carpeta_padre: this.carpetaActual || undefined
          })
          .pipe(takeUntil(this.destroy$))
      );
      this.cargarLista();
      Swal.fire('Listo', `Carpeta «${String(nombre).trim()}» creada.`, 'success');
    } catch (err: any) {
      Swal.fire(
        'Error',
        err?.error?.message || err?.message || 'No se pudo crear la carpeta.',
        'error'
      );
    }
  }

  eliminarCarpetaActual(): void {
    if (!this.puedeAdministrar) {
      return;
    }
    const carpeta = this.carpetaActualVista;
    if (!carpeta) {
      return;
    }
    this.eliminarCarpeta(carpeta);
  }

  eliminarCarpeta(carpeta: EmpresaRepoCarpeta, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeAdministrar) {
      return;
    }
    if (carpeta.cantidad > 0) {
      Swal.fire(
        'Carpeta con archivos',
        'Mueve o elimina los documentos de la carpeta antes de borrarla.',
        'info'
      );
      return;
    }

    Swal.fire({
      title: '¿Eliminar carpeta?',
      html: `<p class="mb-0">Se eliminará la carpeta <strong>${this.escapeHtml(carpeta.nombre)}</strong>.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d'
    }).then(result => {
      if (!result.isConfirmed) {
        return;
      }
      this.backend
        .eliminarEmpresaRepositorioCarpeta(this.empresaId, carpeta.ruta)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            if (this.carpetaActual === carpeta.ruta || this.carpetaActual.startsWith(carpeta.ruta + '/')) {
              const padre = carpeta.ruta.includes('/')
                ? carpeta.ruta.slice(0, carpeta.ruta.lastIndexOf('/'))
                : '';
              this.entrarCarpeta(padre);
            }
            this.cargarLista();
            Swal.fire('Eliminada', 'La carpeta se eliminó correctamente.', 'success');
          },
          error: err => {
            Swal.fire(
              'Error',
              err?.error?.message || err?.message || 'No se pudo eliminar la carpeta.',
              'error'
            );
          }
        });
    });
  }

  onDragStartDoc(event: DragEvent, doc: EmpresaRepoItem): void {
    if (!this.puedeAdministrar) {
      event.preventDefault();
      return;
    }
    this.dragDocId = doc.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(doc.id));
    }
  }

  onDragEndDoc(): void {
    this.dragDocId = null;
    this.dropTargetRuta = null;
  }

  onDragOverCarpeta(event: DragEvent, ruta: string): void {
    if (this.dragDocId == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropTargetRuta = ruta;
  }

  onDragLeaveCarpeta(event: DragEvent, ruta: string): void {
    event.preventDefault();
    if (this.dropTargetRuta === ruta) {
      this.dropTargetRuta = null;
    }
  }

  onDropEnCarpeta(event: DragEvent, rutaDestino: string): void {
    event.preventDefault();
    event.stopPropagation();
    const idRaw = event.dataTransfer?.getData('text/plain') || String(this.dragDocId || '');
    const id = parseInt(idRaw, 10);
    this.dragDocId = null;
    this.dropTargetRuta = null;
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    void this.moverDocumentoA(id, rutaDestino);
  }

  onDragOverRaiz(event: DragEvent): void {
    if (this.dragDocId == null || !this.carpetaActual) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropTargetRuta = this.rutaPadreActual;
  }

  onDropEnRaiz(event: DragEvent): void {
    if (!this.carpetaActual) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const idRaw = event.dataTransfer?.getData('text/plain') || String(this.dragDocId || '');
    const id = parseInt(idRaw, 10);
    this.dragDocId = null;
    this.dropTargetRuta = null;
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    void this.moverDocumentoA(id, this.rutaPadreActual);
  }

  /** Carpeta padre de la ruta actual ('' = raíz del repositorio). */
  get rutaPadreActual(): string {
    const actual = this.normalizarRuta(this.carpetaActual);
    if (!actual) {
      return '';
    }
    if (!actual.includes('/')) {
      return '';
    }
    return actual.slice(0, actual.lastIndexOf('/'));
  }

  private async moverDocumentoA(id: number, carpetaRelativa: string): Promise<void> {
    if (this.moviendo) {
      return;
    }
    const doc = this.documentos.find(d => d.id === id);
    if (!doc) {
      return;
    }
    const destino = this.normalizarRuta(carpetaRelativa);
    if (this.normalizarRuta(doc.carpetaRelativa) === destino) {
      return;
    }

    const destinoEtiqueta = destino
      ? destino.split('/').pop() || destino
      : 'Raíz del repositorio';
    const nombreArchivo = this.escapeHtml(doc.nombreArchivo);
    const destinoSeguro = this.escapeHtml(destinoEtiqueta);

    this.moviendo = true;
    void Swal.fire({
      title: 'Moviendo archivo…',
      html: `<p class="mb-1">Se está pasando <strong>${nombreArchivo}</strong></p>
             <div class="fm-alert-destino"><i class="fas fa-folder"></i> Destino: <strong>${destinoSeguro}</strong></div>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'swal2-fm-alert swal2-fm-alert--repo' },
      didOpen: () => {
        Swal.showLoading();
      }
    });

    try {
      await firstValueFrom(
        this.backend.moverEmpresaRepositorio(this.empresaId, id, destino).pipe(takeUntil(this.destroy$))
      );
      this.cargarLista();
      await Swal.fire({
        icon: 'success',
        title: 'Archivo movido',
        html: `<p class="mb-1"><strong>${nombreArchivo}</strong> se movió correctamente.</p>
               <div class="fm-alert-destino"><i class="fas fa-check"></i> Destino: <strong>${destinoSeguro}</strong></div>`,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#38512F',
        timer: 3200,
        timerProgressBar: true,
        customClass: { popup: 'swal2-fm-alert swal2-fm-alert--repo' }
      });
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo mover',
        text: err?.error?.message || err?.message || 'No se pudo mover el documento.',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#38512F',
        customClass: { popup: 'swal2-fm-alert swal2-fm-alert--repo' }
      });
    } finally {
      this.moviendo = false;
    }
  }

  miniatura(doc: EmpresaRepoItem): MiniaturaEstado {
    return (
      this.miniaturas[doc.id] || {
        modo: this.modoMiniatura(doc),
        urlStr: null,
        cargando: this.modoMiniatura(doc) !== 'icono',
        error: false,
        reintento: 0
      }
    );
  }

  abrirPanelSubida(): void {
    if (!this.puedeAdministrar) {
      return;
    }
    this.mostrarSubida = true;
    this.errorSubida = null;
    this.archivosSeleccionados = [];
    this.progresoActual = 0;
    this.progresoTotal = 0;
    this.progresoNombre = '';
  }

  cerrarPanelSubida(): void {
    if (this.subiendo) {
      return;
    }
    this.mostrarSubida = false;
  }

  onArchivoElegido(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.agregarArchivos(input.files);
    input.value = '';
  }

  /** Selección de carpeta (webkitdirectory): agrega todos los archivos que contiene. */
  onCarpetaElegida(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.agregarArchivos(input.files);
    input.value = '';
  }

  private agregarArchivos(lista: FileList | null): void {
    if (!lista || lista.length === 0) {
      return;
    }
    this.errorSubida = null;
    const nuevos = Array.from(lista).filter(f => f.size > 0 || f.name);
    // Evita duplicados por nombre + tamaño.
    for (const file of nuevos) {
      const yaExiste = this.archivosSeleccionados.some(
        f => f.name === file.name && f.size === file.size
      );
      if (!yaExiste) {
        this.archivosSeleccionados.push(file);
      }
    }
  }

  quitarArchivo(index: number): void {
    if (this.subiendo) {
      return;
    }
    this.archivosSeleccionados.splice(index, 1);
  }

  limpiarSeleccion(): void {
    if (this.subiendo) {
      return;
    }
    this.archivosSeleccionados = [];
    this.errorSubida = null;
  }

  async enviarDocumento(): Promise<void> {
    if (!this.archivosSeleccionados.length || this.subiendo) {
      return;
    }
    this.subiendo = true;
    this.errorSubida = null;
    this.progresoTotal = this.archivosSeleccionados.length;
    this.progresoActual = 0;
    this.progresoNombre = 'Preparando archivos…';

    const archivos = [...this.archivosSeleccionados];
    const fallidos: string[] = [];
    const carpetaDestino = this.normalizarRuta(this.carpetaActual);

    try {
      const payloads = await this.prepararPayloads(archivos, fallidos, carpetaDestino, (nombre) => {
        this.progresoNombre = nombre;
      });
      this.progresoActual = fallidos.length;

      const lotes = this.dividirEnLotes(payloads, this.TAMANO_LOTE_SUBIDA);
      for (const lote of lotes) {
        if (!lote.length) {
          continue;
        }
        this.progresoNombre = lote[0].nombre_archivo;
        try {
          const res = await firstValueFrom(
            this.backend.subirEmpresaRepositorioLote(this.empresaId, lote).pipe(takeUntil(this.destroy$))
          );
          const erroresLote: { nombre?: string }[] = Array.isArray(res?.errores) ? res.errores : [];
          for (const err of erroresLote) {
            if (err?.nombre) {
              fallidos.push(err.nombre);
            }
          }
        } catch {
          for (const item of lote) {
            fallidos.push(item.nombre_archivo);
          }
        }
        this.progresoActual = Math.min(this.progresoActual + lote.length, this.progresoTotal);
      }
    } finally {
      this.progresoActual = this.progresoTotal;
      this.finalizarSubida(fallidos);
    }
  }

  private dividirEnLotes<T>(items: T[], tamano: number): T[][] {
    const lotes: T[][] = [];
    for (let i = 0; i < items.length; i += tamano) {
      lotes.push(items.slice(i, i + tamano));
    }
    return lotes;
  }

  private async prepararPayloads(
    archivos: File[],
    fallidos: string[],
    carpetaRelativa: string,
    onProgreso?: (nombre: string) => void
  ): Promise<{ nombre_archivo: string; mime_type: string; archivo_base64: string; carpeta_relativa?: string }[]> {
    const payloads: {
      nombre_archivo: string;
      mime_type: string;
      archivo_base64: string;
      carpeta_relativa?: string;
    }[] = [];
    let indice = 0;

    const worker = async (): Promise<void> => {
      while (indice < archivos.length) {
        const i = indice++;
        const file = archivos[i];
        onProgreso?.(file.name);
        try {
          const base64 = await this.archivoABase64(file);
          if (!base64) {
            fallidos.push(file.name);
          } else {
            payloads.push({
              nombre_archivo: file.name,
              mime_type: file.type,
              archivo_base64: base64,
              ...(carpetaRelativa ? { carpeta_relativa: carpetaRelativa } : {})
            });
          }
        } catch {
          fallidos.push(file.name);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.CONCURRENCIA_LECTURA, archivos.length) },
      () => worker()
    );
    await Promise.all(workers);
    return payloads;
  }

  private archivoABase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultado = String(reader.result || '');
        const base64 = resultado.includes(',') ? resultado.split(',')[1] : '';
        resolve(base64 || '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private finalizarSubida(fallidos: string[]): void {
    this.subiendo = false;
    this.progresoNombre = '';
    const total = this.progresoTotal;
    const exitosos = total - fallidos.length;

    if (fallidos.length === 0) {
      this.mostrarSubida = false;
      this.archivosSeleccionados = [];
      this.cargarLista();
      Swal.fire(
        'Listo',
        total === 1 ? 'Documento subido correctamente.' : `${exitosos} documentos subidos correctamente.`,
        'success'
      );
      return;
    }

    // Conserva en la lista solo los que fallaron para poder reintentar.
    this.archivosSeleccionados = this.archivosSeleccionados.filter(f => fallidos.includes(f.name));
    const listaFallidos = fallidos.length > 8
      ? `${fallidos.slice(0, 8).join(', ')} y ${fallidos.length - 8} más`
      : fallidos.join(', ');
    this.errorSubida =
      `No se pudieron subir ${fallidos.length} de ${total} archivo(s): ${listaFallidos}. Puedes reintentar con «Subir».`;
    if (exitosos > 0) {
      this.cargarLista();
    }
  }

  abrirDocumento(doc: EmpresaRepoItem): void {
    this.cerrarEditorIntegrado();
    this.documentoActivo = doc;
    this.mostrarVisor = true;
    this.visorCargando = true;
    this.visorError = null;
    this.previewModo = this.modoVistaCompleta(doc);
    this.revocarPreviewUrl();
    this.previewUrlSafe = null;
    this.previewBlob = null;
    this.editorUrlCruda = null;
    this.visorProgreso = 8;
    this.visorEtiqueta = 'Cargando documento…';
    this.visorLento = false;

    if (this.previewModo === 'icono') {
      this.visorCargando = false;
      return;
    }

    if (this.previewModo === 'office') {
      this.prepararVistaOffice(doc);
      return;
    }

    // El visor siempre usa el archivo original servido por nuestra API autenticada.
    const mimeHint = this.previewModo === 'pdf'
      ? 'application/pdf'
      : (String(doc.mimeType || '').startsWith('image/') ? doc.mimeType : 'image/jpeg');
    this.cargarBlobDocumento(doc.id, (url: string, blob?: Blob) => {
      this.previewObjectUrl = url;
      this.previewBlob = this.previewModo === 'pdf' && blob ? blob : null;
      this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.visorCargando = false;
      this.visorProgreso = 96;
    }, () => {
      this.visorError = 'No se pudo cargar la vista previa.';
      this.visorCargando = false;
    }, mimeHint || undefined);
  }

  private prepararVistaOffice(doc: EmpresaRepoItem): void {
    const aplicarUrls = (previewUrl: string | null, editorUrl: string | null) => {
      if (!previewUrl) {
        this.visorError = 'No se pudo cargar la vista previa.';
        this.visorCargando = false;
        return;
      }
      this.editorUrlCruda = this.normalizarUrlEmbedEditor(editorUrl);
      this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(previewUrl);
      this.visorCargando = false;
    };

    this.backend
      .prepararVistaEmpresaRepositorio(this.empresaId, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const previewUrl = res?.previewUrl || this.resolverUrlPreview(doc);
          const editorUrl = res?.editorUrl || this.resolverUrlEditor(doc);
          aplicarUrls(previewUrl, editorUrl);
        },
        error: () => {
          aplicarUrls(this.resolverUrlPreview(doc), this.resolverUrlEditor(doc));
        }
      });
  }

  abrirEditorIntegrado(): void {
    const doc = this.documentoActivo;
    if (!doc || !this.puedeEditorIntegrado || this.previewModo !== 'office') {
      return;
    }

    const mime = String(doc.mimeType || '').toLowerCase();
    const esNativoGoogle = mime === 'application/vnd.google-apps.document'
      || mime === 'application/vnd.google-apps.spreadsheet'
      || mime === 'application/vnd.google-apps.presentation';
    const esExcelOffice = mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mime === 'application/vnd.ms-excel'
      || /\.xlsx?$/i.test(String(doc.nombreArchivo || ''));

    // Word/PPT binarios: Drive (nueva pestaña). Excel se convierte a Sheet nativo.
    if (!esNativoGoogle && !esExcelOffice) {
      const url = this.normalizarUrlEmbedEditor(this.editorUrlCruda || this.resolverUrlEditor(doc));
      if (!url) {
        Swal.fire('Sin editor', 'No se pudo abrir el editor integrado para este archivo.', 'info');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    this.editorIntegradoUrlSafe = null;
    this.editorIntegradoCargando = true;
    this.mostrarEditorIntegrado = true;
    this.setEditorBodyState(true);

    if (esNativoGoogle) {
      const url = this.normalizarUrlEmbedEditor(this.editorUrlCruda || this.resolverUrlEditor(doc));
      if (!url) {
        this.cerrarEditorIntegrado();
        Swal.fire('Sin editor', 'No se pudo abrir el editor integrado para este archivo.', 'info');
        return;
      }
      this.editorUrlCruda = url;
      this.editorIntegradoUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      return;
    }

    this.backend
      .asegurarEditorEmpresaRepositorio(this.empresaId, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const actualizado = res?.documento as EmpresaRepoItem | undefined;
          if (actualizado?.id) {
            this.aplicarDocumentoActualizadoTrasEditor(actualizado);
          }
          const url = this.normalizarUrlEmbedEditor(
            res?.editorUrl
            || this.editorUrlCruda
            || (this.documentoActivo ? this.resolverUrlEditor(this.documentoActivo) : null)
          );
          if (!url) {
            this.cerrarEditorIntegrado();
            Swal.fire('Sin editor', 'No se pudo preparar el Google Sheet para edición.', 'info');
            return;
          }
          this.editorUrlCruda = url;
          // Tras convertir XLSX → Sheet, refrescar también la vista previa (el binario original ya no existe).
          const previewUrl = res?.previewUrl
            || (this.documentoActivo ? this.resolverUrlPreview(this.documentoActivo) : null);
          if (previewUrl) {
            this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(previewUrl);
          }
          this.editorIntegradoUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        },
        error: (err) => {
          this.cerrarEditorIntegrado();
          const mensaje = err?.error?.message || 'No se pudo abrir el editor integrado.';
          Swal.fire('Error', mensaje, 'error');
        }
      });
  }

  private aplicarDocumentoActualizadoTrasEditor(doc: EmpresaRepoItem): void {
    const idx = this.documentos.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      this.documentos[idx] = { ...this.documentos[idx], ...doc };
    }
    if (this.documentoActivo?.id === doc.id) {
      this.documentoActivo = { ...this.documentoActivo, ...doc };
    }
    const idxVista = this.documentosVista.findIndex((d) => d.id === doc.id);
    if (idxVista >= 0) {
      this.documentosVista[idxVista] = { ...this.documentosVista[idxVista], ...doc };
    }
  }

  cerrarEditorIntegrado(): void {
    this.mostrarEditorIntegrado = false;
    this.editorIntegradoCargando = false;
    this.editorIntegradoUrlSafe = null;
    this.setEditorBodyState(false);
  }

  onEditorIntegradoLoad(): void {
    this.editorIntegradoCargando = false;
  }

  onVisorOfficeLoad(): void {
    this.visorCargando = false;
  }

  get tituloEditorIntegrado(): string {
    return 'Editor integrado del formato';
  }

  get subtituloEditorIntegrado(): string {
    const doc = this.documentoActivo;
    if (!doc) {
      return '';
    }
    const nombre = String(doc.titulo || doc.nombreArchivo || 'Documento').trim();
    const mime = String(doc.mimeType || '').toLowerCase();
    if (mime.includes('spreadsheet') || /\.xlsx?$/i.test(doc.nombreArchivo || '')) {
      return `${nombre} · Excel = historial visual · Corrige solo si hay errores de registro`;
    }
    if (mime.includes('document') || /\.docx?$/i.test(doc.nombreArchivo || '')) {
      return `${nombre} · Documento en Google Drive`;
    }
    if (mime.includes('presentation') || /\.pptx?$/i.test(doc.nombreArchivo || '')) {
      return `${nombre} · Presentación en Google Drive`;
    }
    return nombre;
  }

  get syncEditorIntegrado(): string | null {
    const raw = this.documentoActivo?.fechaActualizacion || this.documentoActivo?.fechaSubida || null;
    if (!raw) {
      return null;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return null;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  get tituloVisorDocumento(): string {
    if (this.previewModo === 'office') {
      return 'Vista previa del documento';
    }
    return 'Visor integrado de documento';
  }

  get puedeAbrirEditorActivo(): boolean {
    return !!(
      this.puedeEditorIntegrado
      && this.documentoActivo
      && this.previewModo === 'office'
      && (this.editorUrlCruda || this.resolverUrlEditor(this.documentoActivo) || this.documentoActivo.driveFileId)
    );
  }

  private resolverUrlPreview(doc: EmpresaRepoItem): string | null {
    const id = String(doc.driveFileId || '').trim();
    if (!id) {
      return null;
    }
    // Office binario: siempre Drive preview (Sheets/Docs /preview falla en iframe).
    return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
  }

  private resolverUrlEditor(doc: EmpresaRepoItem): string | null {
    const id = String(doc.driveFileId || '').trim();
    if (!id) {
      return null;
    }
    const mime = String(doc.mimeType || '').toLowerCase();
    if (mime === 'application/vnd.google-apps.document') {
      return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    }
    if (mime === 'application/vnd.google-apps.spreadsheet') {
      return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    }
    if (mime === 'application/vnd.google-apps.presentation') {
      return `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    }
    // XLSX/DOCX/PPTX: Drive view (no forzar editor nativo de Google sobre binarios).
    return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
  }

  /** URL de editor apta para iframe (misma lógica que SGC). */
  private normalizarUrlEmbedEditor(url: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url);
      if (u.hostname.includes('docs.google.com') && /\/spreadsheets\//i.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\/preview\/?$/i, '/edit');
        u.searchParams.delete('rm');
        u.searchParams.delete('widget');
        u.searchParams.delete('headers');
        if (!u.searchParams.has('usp')) {
          u.searchParams.set('usp', 'sharing');
        }
        return u.toString();
      }
      if (u.hostname.includes('docs.google.com') && /\/(document|presentation)\//i.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\/preview\/?$/i, '/edit');
        if (!u.searchParams.has('usp')) {
          u.searchParams.set('usp', 'sharing');
        }
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  private setEditorBodyState(abierto: boolean): void {
    document.body.classList.toggle('mt-drive-editor-open', abierto);
    document.body.style.overflow = abierto ? 'hidden' : '';
  }

  cerrarVisor(): void {
    this.cerrarEditorIntegrado();
    this.mostrarVisor = false;
    this.documentoActivo = null;
    this.editorUrlCruda = null;
    this.revocarPreviewUrl();
    this.quitarDocDeRuta();
  }

  private intentarAbrirVisorDesdeBusqueda(): void {
    const id = this.docIdPendienteVisor;
    if (!id || !this.documentos.length) {
      return;
    }
    const doc = this.documentos.find((d) => Number(d.id) === id);
    if (!doc) {
      return;
    }
    if (this.mostrarVisor && this.documentoActivo?.id === doc.id) {
      this.docIdPendienteVisor = null;
      return;
    }
    this.docIdPendienteVisor = null;
    this.entrarCarpeta(doc.carpetaRelativa || '');
    this.abrirDocumento(doc);
  }

  private quitarDocDeRuta(): void {
    if (!this.route.snapshot.queryParamMap.has('doc')) {
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { doc: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  descargarDocumento(doc: EmpresaRepoItem, event?: Event): void {
    event?.stopPropagation();
    this.backend
      .descargarEmpresaRepositorio(this.empresaId, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.nombreArchivo;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          Swal.fire('Error', 'No se pudo descargar el archivo.', 'error');
        }
      });
  }

  descargarActivo(): void {
    const doc = this.documentoActivo;
    if (!doc) {
      return;
    }
    this.descargarDocumento(doc);
  }

  eliminarDocumento(doc: EmpresaRepoItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeAdministrar) {
      return;
    }

    Swal.fire({
      title: '¿Eliminar documento?',
      html: `<p class="mb-0">Se eliminará <strong>${this.escapeHtml(doc.nombreArchivo)}</strong> del repositorio y de Google Drive.<br>Esta acción no se puede deshacer.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d'
    }).then(result => {
      if (!result.isConfirmed) {
        return;
      }
      this.backend
        .eliminarEmpresaRepositorio(this.empresaId, doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.revocarMiniatura(doc.id);
            if (this.documentoActivo?.id === doc.id) {
              this.cerrarVisor();
            }
            this.cargarLista();
            Swal.fire('Eliminado', 'El documento se eliminó correctamente.', 'success');
          },
          error: err => {
            Swal.fire(
              'Error',
              err?.error?.message || err?.message || 'No se pudo eliminar el documento.',
              'error'
            );
          }
        });
    });
  }

  private escapeHtml(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  iconoTipo(mime: string, nombre: string): string {
    const m = (mime || '').toLowerCase();
    const n = (nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'fa-file-pdf';
    if (m.includes('csv') || n.endsWith('.csv')) return 'fa-file-csv';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'fa-file-excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'fa-file-word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'fa-file-powerpoint';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'fa-file-image';
    return 'fa-file-alt';
  }

  claseTile(mime: string, nombre: string): string {
    const m = (mime || '').toLowerCase();
    const n = (nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'sgc-extra-tile--pdf';
    if (m.includes('csv') || n.endsWith('.csv')) return 'sgc-extra-tile--csv';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'sgc-extra-tile--excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'sgc-extra-tile--word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'sgc-extra-tile--ppt';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'sgc-extra-tile--imagen';
    return 'sgc-extra-tile--otro';
  }

  etiquetaTipo(mime: string, nombre: string): string {
    const m = (mime || '').toLowerCase();
    const n = (nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
    if (m.includes('csv') || n.endsWith('.csv')) return 'CSV';
    if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return 'Excel';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'Word';
    if (m.includes('presentation') || m.includes('powerpoint') || /\.pptx?$/.test(n)) return 'PowerPoint';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'Imagen';
    return 'Archivo';
  }

  formatearTamano(bytes: number | null): string {
    if (bytes == null || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatearFecha(iso: string): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return iso;
    }
  }

  trackById(_: number, d: EmpresaRepoItem): number {
    return d.id;
  }

  trackByRuta(_: number, c: EmpresaRepoCarpeta): string {
    return c.ruta;
  }

  modoVistaCompleta(doc: EmpresaRepoItem): VistaPreview {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'imagen';
    if (this.esTipoOffice(doc) && doc.driveFileId) return 'office';
    return 'icono';
  }

  /** Miniaturas del grid: imágenes, PDF y Office con Drive ID. */
  modoMiniatura(doc: EmpresaRepoItem): MiniaturaModo {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'imagen';
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg)$/.test(n)) return 'imagen';
    if (this.esTipoOffice(doc) && doc.driveFileId) return 'imagen';
    return 'icono';
  }

  private urlThumbnailDrive(driveFileId: string, cacheBust = 0): string {
    const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w400`;
    return cacheBust ? `${base}&t=${cacheBust}` : base;
  }

  private precargarMiniaturas(docs: EmpresaRepoItem[]): void {
    for (const doc of docs) {
      const modo = this.modoMiniatura(doc);
      if (modo === 'icono') {
        this.actualizarMiniatura(doc.id, {
          modo,
          urlStr: null,
          cargando: false,
          error: false,
          reintento: 0
        });
        continue;
      }
      const prev = this.miniaturas[doc.id];
      if (prev?.urlStr || prev?.cargando) {
        continue;
      }
      if (this.esTipoOffice(doc) && doc.driveFileId) {
        this.actualizarMiniatura(doc.id, {
          modo: 'imagen',
          urlStr: this.urlThumbnailDrive(doc.driveFileId),
          cargando: false,
          error: false,
          reintento: 0
        });
        continue;
      }
      this.actualizarMiniatura(doc.id, {
        modo: 'imagen',
        urlStr: null,
        cargando: true,
        error: false,
        reintento: 0
      });
      this.miniaturaQueue$.next(doc);
    }
  }

  private cargarMiniaturaDoc$(doc: EmpresaRepoItem) {
    if (this.esPdf(doc)) {
      return this.backend.descargarEmpresaRepositorio(this.empresaId, doc.id).pipe(
        concatMap(async (blob) => {
          if (!blob || blob.size < 20 || (blob.type && /json|text|html/i.test(blob.type))) {
            return { docId: doc.id, blob: null as Blob | null };
          }
          try {
            const typed = blob.type === 'application/pdf'
              ? blob
              : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
            const thumb = await this.pdfThumbnail.renderizarPrimeraPagina(typed, 480);
            return { docId: doc.id, blob: thumb };
          } catch {
            return { docId: doc.id, blob: null as Blob | null };
          }
        }),
        catchError(() => of({ docId: doc.id, blob: null as Blob | null }))
      );
    }

    // Imágenes: endpoint de miniatura (data URL) con fallback a blob completo
    return this.backend.miniaturaEmpresaRepositorio(this.empresaId, doc.id).pipe(
      concatMap(async (res) => {
        const dataUrl = String(res?.dataUrl || '');
        if (dataUrl.startsWith('data:image')) {
          return { docId: doc.id, blob: null as Blob | null, dataUrl };
        }
        try {
          const fileBlob = await firstValueFrom(
            this.backend.descargarEmpresaRepositorio(this.empresaId, doc.id).pipe(takeUntil(this.destroy$))
          );
          if (!fileBlob || fileBlob.size < 20) {
            return { docId: doc.id, blob: null as Blob | null };
          }
          return { docId: doc.id, blob: fileBlob };
        } catch {
          return { docId: doc.id, blob: null as Blob | null };
        }
      }),
      catchError(() =>
        this.backend.descargarEmpresaRepositorio(this.empresaId, doc.id).pipe(
          concatMap((fileBlob) => of({
            docId: doc.id,
            blob: fileBlob && fileBlob.size >= 20 ? fileBlob : null
          })),
          catchError(() => of({ docId: doc.id, blob: null as Blob | null }))
        )
      )
    );
  }

  private aplicarResultadoMiniatura(resultado: {
    docId: number;
    blob?: Blob | null;
    dataUrl?: string;
  }): void {
    const prevUrl = this.miniaturaObjectUrls.get(resultado.docId);
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      this.miniaturaObjectUrls.delete(resultado.docId);
    }

    if (resultado.dataUrl && resultado.dataUrl.startsWith('data:image')) {
      this.actualizarMiniatura(resultado.docId, {
        modo: 'imagen',
        urlStr: resultado.dataUrl,
        cargando: false,
        error: false,
        reintento: 0
      });
      return;
    }

    if (!resultado.blob || resultado.blob.size < 20) {
      this.marcarMiniaturaConError(resultado.docId);
      return;
    }

    const url = URL.createObjectURL(resultado.blob);
    this.miniaturaObjectUrls.set(resultado.docId, url);
    this.actualizarMiniatura(resultado.docId, {
      modo: 'imagen',
      urlStr: url,
      cargando: false,
      error: false,
      reintento: 0
    });
  }

  private marcarMiniaturaConError(id: number): void {
    this.actualizarMiniatura(id, {
      modo: 'icono',
      urlStr: null,
      cargando: false,
      error: true,
      reintento: 0
    });
  }

  private esPdf(doc: EmpresaRepoItem): boolean {
    const mime = (doc.mimeType || '').toLowerCase();
    const nombre = (doc.nombreArchivo || '').toLowerCase();
    return mime.includes('pdf') || nombre.endsWith('.pdf');
  }

  onErrorMiniatura(doc: EmpresaRepoItem, event?: Event): void {
    event?.stopPropagation();
    const prev = this.miniatura(doc);
    if (this.esTipoOffice(doc) && doc.driveFileId && prev.reintento < 2) {
      this.actualizarMiniatura(doc.id, {
        modo: 'imagen',
        urlStr: null,
        cargando: true,
        error: false,
        reintento: prev.reintento + 1
      });
      this.backend
        .prepararVistaEmpresaRepositorio(this.empresaId, doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.actualizarMiniatura(doc.id, {
              modo: 'imagen',
              urlStr: this.urlThumbnailDrive(doc.driveFileId, Date.now()),
              cargando: false,
              error: false,
              reintento: prev.reintento + 1
            });
          },
          error: () => {
            this.actualizarMiniatura(doc.id, {
              modo: 'imagen',
              urlStr: this.urlThumbnailDrive(doc.driveFileId, Date.now()),
              cargando: false,
              error: false,
              reintento: prev.reintento + 1
            });
          }
        });
      return;
    }
    // Si falló un thumbnail de Drive, intentar blob autenticado una vez.
    if (prev.reintento < 2 && prev.urlStr && String(prev.urlStr).includes('drive.google.com')) {
      this.actualizarMiniatura(doc.id, {
        modo: 'imagen',
        urlStr: null,
        cargando: true,
        error: false,
        reintento: prev.reintento + 1
      });
      this.cargarBlobDocumento(
        doc.id,
        url => {
          const prevUrl = this.miniaturaObjectUrls.get(doc.id);
          if (prevUrl) {
            URL.revokeObjectURL(prevUrl);
          }
          this.miniaturaObjectUrls.set(doc.id, url);
          this.actualizarMiniatura(doc.id, {
            modo: 'imagen',
            urlStr: url,
            cargando: false,
            error: false,
            reintento: prev.reintento + 1
          });
        },
        () => this.marcarMiniaturaConError(doc.id)
      );
      return;
    }
    this.marcarMiniaturaConError(doc.id);
  }

  private cargarBlobDocumento(
    id: number,
    onOk: (url: string, blob?: Blob) => void,
    onError: () => void,
    mimeHint?: string
  ): void {
    this.backend
      .descargarEmpresaRepositorio(this.empresaId, id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async blob => {
          try {
            if (!blob || blob.size === 0 || (blob.type && /json|text|html/i.test(blob.type))) {
              onError();
              return;
            }
            let typed = blob;
            if (mimeHint && blob.type !== mimeHint) {
              const buffer = await blob.arrayBuffer();
              typed = new Blob([buffer], { type: mimeHint });
            }
            onOk(URL.createObjectURL(typed), typed);
          } catch {
            onError();
          }
        },
        error: () => onError()
      });
  }

  private actualizarMiniatura(id: number, estado: MiniaturaEstado): void {
    this.miniaturas = { ...this.miniaturas, [id]: estado };
  }

  private revocarMiniatura(id: number): void {
    const url = this.miniaturaObjectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.miniaturaObjectUrls.delete(id);
    }
    const copia = { ...this.miniaturas };
    delete copia[id];
    this.miniaturas = copia;
  }

  private limpiarMiniaturas(): void {
    for (const url of this.miniaturaObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.miniaturaObjectUrls.clear();
    this.miniaturas = {};
  }

  private revocarPreviewUrl(): void {
    if (this.previewObjectUrl) {
      const activoId = this.documentoActivo?.id;
      const cached = activoId != null ? this.miniaturaObjectUrls.get(activoId) : null;
      if (this.previewObjectUrl !== cached) {
        URL.revokeObjectURL(this.previewObjectUrl);
      }
      this.previewObjectUrl = null;
    }
    this.previewUrlSafe = null;
    this.previewBlob = null;
  }
}
