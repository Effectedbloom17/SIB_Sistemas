import { HttpEventType } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';
import { PdfThumbnailService } from 'src/app/services/pdf-thumbnail.service';
import { UploadSourceChooserService } from 'src/app/services/upload-source-chooser.service';
import { lanzarImpresionEnSistema } from 'src/app/utils/in-app-print.util';
import {
  SgcDocCatalogoItem,
  catalogoDocumentosFallback,
  filtrarDocumentosCatalogo
} from '../sistema-gestion-calidad/sgc-solicitud-documentos.util';

interface MiniaturaEstado {
  urlStr: string | null;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

interface CarpetaItem {
  id: string;
  nombre: string;
  items?: number;
  archivos?: number;
  carpetas?: number;
  webViewLink?: string;
}

interface ArchivoItem {
  id: string;
  nombre: string;
  tipo: 'pdf' | 'imagen' | 'documento' | 'gdrive' | 'otro';
  mimeType: string;
  tamano?: number | null;
  tamanoLabel: string | null;
  modificado: string | null;
  webViewLink: string;
  yaEnDestino?: boolean;
  esAtajo?: boolean;
  targetId?: string;
}

interface MigaItem {
  id: string;
  nombre: string;
}

type VistaRegistros = 'lista' | 'cuadricula';
type FiltroTipoRegistros = 'todos' | 'pdf' | 'documentos' | 'imagenes';

@Component({
  selector: 'app-registros-rh',
  templateUrl: './registros-rh.component.html',
  styleUrls: ['./colaboradores.component.scss', './registros-rh.component.scss']
})
export class RegistrosRhComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('hubFileInput') hubFileInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private readonly vistaKey = 'biznaga.rrhh.registros.vista';

  cargando = false;
  subiendo = false;
  subiendoHub = false;
  creandoCarpeta = false;
  errorCarga = '';
  mensajeOk = '';
  busquedaDoc = '';
  carpetaUrl = '';
  carpetaRaizId = '';
  carpetaActualId = '';
  carpetaActualNombre = 'Registros Recursos Humanos';
  esRaiz = true;
  migas: MigaItem[] = [];
  carpetas: CarpetaItem[] = [];
  archivos: ArchivoItem[] = [];
  carpetasSugeridas: string[] = [];
  mostrarNuevaCarpeta = false;
  nombreNuevaCarpeta = '';
  dropOverBody = false;
  dropOverHub = false;
  totalesRaiz = { archivos: 0, carpetas: 0, items: 0, bytes: 0 };
  totalesNivel = { archivos: 0, carpetas: 0, items: 0, bytes: 0 };
  miniaturas: Record<string, MiniaturaEstado> = {};
  vista: VistaRegistros = 'lista';
  filtroTipo: FiltroTipoRegistros = 'todos';
  progresoSubida = 0;
  subiendoNombre = '';
  private readonly cuotaBytes = 100 * 1024 * 1024;
  private readonly miniaturaObjectUrls = new Map<string, string>();
  private miniaturaCola: ArchivoItem[] = [];
  private miniaturasEnVuelo = 0;
  private readonly maxMiniaturasParalelas = 2;

  ligarAbierto = false;
  ligarQuery = '';
  ligarBuscando = false;
  ligarCatalogo: SgcDocCatalogoItem[] = [];
  ligarCatalogoListo = false;
  ligarResultados: SgcDocCatalogoItem[] = [];
  ligarProcesandoId = '';

  ngOnInit(): void {
    try {
      const guardada = localStorage.getItem(this.vistaKey);
      if (guardada === 'lista' || guardada === 'cuadricula') {
        this.vista = guardada;
      }
    } catch { /* ignore */ }
    this.cargarContenido();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.limpiarMiniaturas();
  }

  constructor(
    private backend: BackendServices,
    private documentPreview: DocumentPreviewService,
    private pdfThumbnail: PdfThumbnailService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private uploadSourceChooser: UploadSourceChooserService
  ) {}

  cambiarVista(valor: VistaRegistros): void {
    this.vista = valor;
    try { localStorage.setItem(this.vistaKey, valor); } catch { /* ignore */ }
  }

  get carpetasFiltradas(): CarpetaItem[] {
    if (this.filtroTipo !== 'todos') return [];
    const q = this.busquedaDoc.trim().toLowerCase();
    if (!q) return this.carpetas;
    return this.carpetas.filter((c) => c.nombre.toLowerCase().includes(q));
  }

  get archivosFiltrados(): ArchivoItem[] {
    const q = this.busquedaDoc.trim().toLowerCase();
    return this.archivos.filter((a) => {
      if (this.filtroTipo === 'pdf' && this.claseTipo(a) !== 'pdf') return false;
      if (this.filtroTipo === 'imagenes' && this.claseTipo(a) !== 'imagen') return false;
      if (this.filtroTipo === 'documentos') {
        const c = this.claseTipo(a);
        if (c === 'pdf' || c === 'imagen') return false;
      }
      if (!q) return true;
      return a.nombre.toLowerCase().includes(q);
    });
  }

  get vacio(): boolean {
    return !this.cargando && !this.carpetasFiltradas.length && !this.archivosFiltrados.length;
  }

  get totalBytesUsados(): number {
    return Number(this.totalesRaiz.bytes) || Number(this.totalesNivel.bytes)
      || this.archivos.reduce((acc, a) => acc + (Number(a.tamano) || 0), 0);
  }

  get porcentajeUsoVisual(): number {
    const pct = (this.totalBytesUsados / this.cuotaBytes) * 100;
    if (!this.totalBytesUsados) return 0;
    return Math.min(100, Math.max(6, pct));
  }

  get conteoPdf(): number {
    return this.archivos.filter((a) => this.claseTipo(a) === 'pdf').length;
  }

  get conteoDocumentos(): number {
    return this.archivos.filter((a) => {
      const c = this.claseTipo(a);
      return c !== 'pdf' && c !== 'imagen';
    }).length;
  }

  get conteoImagenes(): number {
    return this.archivos.filter((a) => this.claseTipo(a) === 'imagen').length;
  }

  setFiltroTipo(valor: FiltroTipoRegistros): void {
    this.filtroTipo = valor;
  }

  formatearTamanoBytes(bytes: number): string {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  puedeRenombrar(doc: ArchivoItem): boolean {
    return !doc?.esAtajo;
  }

  cargarContenido(carpetaId?: string | null, forzar = false): void {
    this.cargando = true;
    this.errorCarga = '';
    this.backend.listarRrhhRegistros(carpetaId || undefined, forzar)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.cargando = false;
          this.aplicarPayload(res);
        },
        error: (err) => {
          this.cargando = false;
          this.errorCarga = err?.error?.message || err?.message || 'No se pudo cargar la carpeta.';
        }
      });
  }

  private aplicarPayload(res: any): void {
    this.carpetaUrl = res?.carpetaUrl || '';
    this.carpetaRaizId = res?.carpetaRaizId || '';
    this.carpetaActualId = res?.carpetaActual?.id || '';
    this.carpetaActualNombre = res?.carpetaActual?.nombre || 'Registros Recursos Humanos';
    this.esRaiz = !!res?.carpetaActual?.esRaiz;
    this.migas = Array.isArray(res?.migas) ? res.migas : [];
    this.carpetas = Array.isArray(res?.carpetas) ? res.carpetas : [];
    this.archivos = Array.isArray(res?.archivos) ? res.archivos : [];
    this.carpetasSugeridas = Array.isArray(res?.carpetasSugeridas) ? res.carpetasSugeridas : [];
    const tr = res?.totalesRaiz || res?.totales || {};
    const tn = res?.totales || {};
    const bytesNivel = Number(tn.bytes) || this.archivos.reduce((acc, a) => acc + (Number(a.tamano) || 0), 0);
    this.totalesNivel = {
      archivos: Number(tn.archivos) || this.archivos.length,
      carpetas: Number(tn.carpetas) || this.carpetas.length,
      items: Number(tn.items) || (this.archivos.length + this.carpetas.length),
      bytes: bytesNivel
    };
    this.totalesRaiz = {
      archivos: Number(tr.archivos) || this.totalesNivel.archivos,
      carpetas: Number(tr.carpetas) || this.totalesNivel.carpetas,
      items: Number(tr.items) || this.totalesNivel.items,
      bytes: Number(tr.bytes) || this.totalesNivel.bytes
    };
    this.precargarMiniaturas(this.archivos);
  }

  miniatura(doc: ArchivoItem): MiniaturaEstado {
    return this.miniaturas[doc?.id] || {
      urlStr: null,
      cargando: false,
      error: false,
      reintento: 0
    };
  }

  private driveIdDe(doc: ArchivoItem): string {
    return String(doc?.targetId || doc?.id || '').trim();
  }

  private precargarMiniaturas(docs: ArchivoItem[]): void {
    const idsVivos = new Set((docs || []).map((d) => d.id));
    for (const id of Object.keys(this.miniaturas)) {
      if (!idsVivos.has(id)) this.limpiarMiniaturaId(id);
    }

    for (const doc of (docs || []).slice(0, 48)) {
      if (!doc?.id) continue;
      const clase = this.claseTipo(doc);
      if (!['pdf', 'imagen', 'word', 'excel', 'ppt'].includes(clase)) continue;
      const prev = this.miniaturas[doc.id];
      if (prev?.urlStr || prev?.cargando) continue;

      this.actualizarMiniatura(doc.id, {
        urlStr: null,
        cargando: true,
        error: false,
        reintento: 0
      });
      this.encolarMiniatura(doc, false);
    }
  }

  onLoadMiniatura(doc: ArchivoItem): void {
    const prev = this.miniatura(doc);
    if (prev.cargando || prev.error) {
      this.actualizarMiniatura(doc.id, { ...prev, cargando: false, error: false });
    }
  }

  onErrorMiniatura(doc: ArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id) return;
    const prev = this.miniatura(doc);
    if (prev.reintento >= 2) {
      this.marcarMiniaturaError(doc.id);
      return;
    }
    this.actualizarMiniatura(doc.id, {
      urlStr: null,
      cargando: true,
      error: false,
      reintento: prev.reintento + 1
    });
    this.encolarMiniatura(doc, true);
  }

  private encolarMiniatura(doc: ArchivoItem, prioritario: boolean): void {
    if (!doc?.id) return;
    const ya = this.miniaturaCola.some((d) => d.id === doc.id);
    if (!ya) {
      if (prioritario) this.miniaturaCola.unshift(doc);
      else this.miniaturaCola.push(doc);
    }
    this.bombeaColaMiniaturas();
  }

  private bombeaColaMiniaturas(): void {
    while (this.miniaturasEnVuelo < this.maxMiniaturasParalelas && this.miniaturaCola.length) {
      const doc = this.miniaturaCola.shift();
      if (!doc) break;
      this.cargarMiniaturaLocal(doc);
    }
  }

  private cargarMiniaturaLocal(doc: ArchivoItem): void {
    if (!doc?.id) {
      this.bombeaColaMiniaturas();
      return;
    }
    this.miniaturasEnVuelo += 1;
    const clase = this.claseTipo(doc);

    // 1) Miniatura autenticada del backend (PDF/Office/imagen vía Drive thumbnailLink)
    this.backend.obtenerMiniaturaRrhhRegistro(doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          if (blob && blob.size >= 40 && !/json|text|html/i.test(blob.type || '')) {
            void this.aplicarBlobMiniatura(doc.id, blob).finally(() => {
              this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
              this.bombeaColaMiniaturas();
            });
            return;
          }
          this.fallbackMiniaturaLocal(doc, clase);
        },
        error: () => this.fallbackMiniaturaLocal(doc, clase)
      });
  }

  private fallbackMiniaturaLocal(doc: ArchivoItem, clase: string): void {
    if (clase === 'pdf') {
      this.backend.descargarRrhhRegistroArchivo(doc.id, doc.nombre, false)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (blob) => { void this.renderPdfThumb(doc, blob); },
          error: () => {
            this.marcarMiniaturaError(doc.id);
            this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
            this.bombeaColaMiniaturas();
          }
        });
      return;
    }

    if (clase === 'imagen') {
      this.backend.descargarRrhhRegistroArchivo(doc.id, doc.nombre, false)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (blob) => {
            if (blob && blob.size >= 20 && !/json|text|html/i.test(blob.type || '')) {
              void this.aplicarBlobMiniatura(doc.id, blob).finally(() => {
                this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
                this.bombeaColaMiniaturas();
              });
            } else {
              this.marcarMiniaturaError(doc.id);
              this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
              this.bombeaColaMiniaturas();
            }
          },
          error: () => {
            this.marcarMiniaturaError(doc.id);
            this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
            this.bombeaColaMiniaturas();
          }
        });
      return;
    }

    this.marcarMiniaturaError(doc.id);
    this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
    this.bombeaColaMiniaturas();
  }

  private async renderPdfThumb(doc: ArchivoItem, blob: Blob): Promise<void> {
    try {
      if (!blob || blob.size < 40 || /json|text|html/i.test(blob.type || '')) {
        throw new Error('blob inválido');
      }
      const typed = blob.type === 'application/pdf'
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
      const thumb = await this.pdfThumbnail.renderizarPrimeraPagina(typed, 480);
      await new Promise<void>((resolve) => {
        this.ngZone.run(() => {
          void this.aplicarBlobMiniatura(doc.id, thumb).finally(resolve);
        });
      });
    } catch {
      this.ngZone.run(() => this.marcarMiniaturaError(doc.id));
    } finally {
      this.ngZone.run(() => {
        this.miniaturasEnVuelo = Math.max(0, this.miniaturasEnVuelo - 1);
        this.bombeaColaMiniaturas();
      });
    }
  }

  /** Convierte blob → data URL (Angular no lo marca unsafe como blob:). */
  private blobADataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('FileReader'));
      reader.readAsDataURL(blob);
    });
  }

  private async aplicarBlobMiniatura(docId: string, blob: Blob): Promise<void> {
    const prevUrl = this.miniaturaObjectUrls.get(docId);
    if (prevUrl) {
      try { URL.revokeObjectURL(prevUrl); } catch { /* ignore */ }
      this.miniaturaObjectUrls.delete(docId);
    }
    let url: string;
    try {
      url = await this.blobADataUrl(blob);
    } catch {
      url = URL.createObjectURL(blob);
      this.miniaturaObjectUrls.set(docId, url);
    }
    this.actualizarMiniatura(docId, {
      urlStr: url,
      cargando: false,
      error: false,
      reintento: this.miniaturas[docId]?.reintento || 0
    });
  }

  private marcarMiniaturaError(docId: string): void {
    const reintento = this.miniaturas[docId]?.reintento || 0;
    const prevUrl = this.miniaturaObjectUrls.get(docId);
    if (prevUrl) {
      try { URL.revokeObjectURL(prevUrl); } catch { /* ignore */ }
      this.miniaturaObjectUrls.delete(docId);
    }
    this.actualizarMiniatura(docId, {
      urlStr: null,
      cargando: false,
      error: true,
      reintento
    });
  }

  private actualizarMiniatura(docId: string, estado: MiniaturaEstado): void {
    this.miniaturas = { ...this.miniaturas, [docId]: estado };
    this.cdr.markForCheck();
  }

  private limpiarMiniaturaId(docId: string, quitarEstado = true): void {
    const prevUrl = this.miniaturaObjectUrls.get(docId);
    if (prevUrl) {
      try { URL.revokeObjectURL(prevUrl); } catch { /* ignore */ }
      this.miniaturaObjectUrls.delete(docId);
    }
    if (quitarEstado) {
      const copia = { ...this.miniaturas };
      delete copia[docId];
      this.miniaturas = copia;
    }
  }

  private limpiarMiniaturas(): void {
    for (const url of this.miniaturaObjectUrls.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    this.miniaturaObjectUrls.clear();
    this.miniaturaCola = [];
    this.miniaturasEnVuelo = 0;
    this.miniaturas = {};
  }

  entrarCarpeta(carpeta: CarpetaItem): void {
    this.busquedaDoc = '';
    this.cargarContenido(carpeta.id);
  }

  irAMiga(miga: MigaItem): void {
    this.cargarContenido(miga.id);
  }

  irARaiz(): void {
    this.cargarContenido(null, true);
  }

  regresarNivel(): void {
    if (this.migas.length < 2) {
      this.irARaiz();
      return;
    }
    const padre = this.migas[this.migas.length - 2];
    this.cargarContenido(padre.id);
  }

  abrirEnDrive(): void {
    const url = this.carpetaUrl
      || (this.carpetaActualId
        ? `https://drive.google.com/drive/folders/${this.carpetaActualId}`
        : '');
    if (url) window.open(url, '_blank', 'noopener');
  }

  abrirDialogoNuevaCarpeta(): void {
    this.mostrarNuevaCarpeta = true;
    this.nombreNuevaCarpeta = '';
  }

  crearCarpeta(): void {
    const nombre = this.nombreNuevaCarpeta.trim();
    if (!nombre || this.creandoCarpeta) return;
    this.creandoCarpeta = true;
    this.backend.crearCarpetaRrhhRegistros(this.carpetaActualId, nombre)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.creandoCarpeta = false;
          this.mostrarNuevaCarpeta = false;
          this.mensajeOk = `Carpeta «${nombre}» creada.`;
          this.cargarContenido(this.carpetaActualId, true);
        },
        error: (err) => {
          this.creandoCarpeta = false;
          this.errorCarga = err?.error?.message || 'No se pudo crear la carpeta.';
        }
      });
  }

  crearCarpetasSugeridas(): void {
    this.creandoCarpeta = true;
    this.backend.crearCarpetasSugeridasRrhhRegistros(this.carpetaActualId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.creandoCarpeta = false;
          const n = res?.total ?? res?.creadas?.length ?? 0;
          this.mensajeOk = n ? `Se crearon ${n} carpetas.` : 'Las carpetas sugeridas ya existían.';
          this.cargarContenido(this.carpetaActualId, true);
        },
        error: (err) => {
          this.creandoCarpeta = false;
          this.errorCarga = err?.error?.message || 'No se pudieron crear las carpetas.';
        }
      });
  }

  async dispararSubida(): Promise<void> {
    await this.iniciarSubidaConChooser('panel');
  }

  async dispararSubidaHub(): Promise<void> {
    await this.iniciarSubidaConChooser('hub');
  }

  private async iniciarSubidaConChooser(origenZona: 'panel' | 'hub'): Promise<void> {
    const origen = await this.uploadSourceChooser.elegir({
      titulo: '¿Cómo quieres agregar el archivo?',
      subtitulo: 'Elige si lo tomas de tu galería/archivos o si lo pegas desde el portapapeles.'
    });
    if (!origen) {
      return;
    }
    if (origen === 'galeria') {
      if (origenZona === 'hub') {
        this.hubFileInput?.nativeElement?.click();
      } else {
        this.fileInput?.nativeElement?.click();
      }
      return;
    }
    const files = await this.uploadSourceChooser.esperarPegado({
      titulo: 'Pega el archivo',
      subtitulo: 'Copia el documento o imagen y pégalo con Ctrl+V.'
    });
    if (!files?.length) {
      return;
    }
    const carpetaId = origenZona === 'hub'
      ? (this.carpetaRaizId || this.carpetaActualId)
      : this.carpetaActualId;
    this.subirArchivos(files, carpetaId, origenZona);
  }

  toggleLigar(): void {
    this.ligarAbierto = !this.ligarAbierto;
    if (!this.ligarAbierto) {
      this.ligarQuery = '';
      this.ligarResultados = [];
      this.ligarBuscando = false;
      this.ligarProcesandoId = '';
      return;
    }
    this.cargarCatalogoLigar();
    this.filtrarLigar();
  }

  private cargarCatalogoLigar(): void {
    if (this.ligarCatalogoListo && this.ligarCatalogo.length) return;
    this.ligarCatalogo = catalogoDocumentosFallback();
    this.ligarBuscando = true;
    this.backend.obtenerCatalogoDocumentosSgcSolicitud()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const docs = Array.isArray(res?.documentos) ? res.documentos : [];
          if (docs.length) this.ligarCatalogo = docs;
          this.ligarCatalogoListo = true;
          this.ligarBuscando = false;
          this.filtrarLigar();
        },
        error: () => {
          this.ligarCatalogoListo = true;
          this.ligarBuscando = false;
          this.filtrarLigar();
        }
      });
  }

  onLigarQueryChange(valor: string): void {
    this.ligarQuery = valor;
    this.filtrarLigar();
  }

  private filtrarLigar(): void {
    this.ligarResultados = filtrarDocumentosCatalogo(this.ligarCatalogo, this.ligarQuery, 14);
  }

  trackByLigarDoc(_index: number, doc: SgcDocCatalogoItem): string {
    return `${doc.codigo || ''}-${doc.nombreDocumento || ''}`;
  }

  confirmarLigar(doc: SgcDocCatalogoItem): void {
    const codigo = String(doc?.codigo || '').trim();
    const nombreDocumento = String(doc?.nombreDocumento || '').trim();
    if ((!codigo && !nombreDocumento) || this.ligarProcesandoId) return;
    this.ligarProcesandoId = codigo || nombreDocumento;
    this.errorCarga = '';
    const destino = this.carpetaRaizId || this.carpetaActualId || '';
    this.backend.ligarRrhhRegistro({
      codigo,
      nombreDocumento,
      parentId: destino
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.ligarProcesandoId = '';
          this.mensajeOk = res?.mensaje
            || (res?.ligado ? 'Documento ligado sin duplicar.' : 'Documento ligado.');
          this.cargarContenido(this.carpetaActualId, true);
        },
        error: (err) => {
          this.ligarProcesandoId = '';
          this.errorCarga = err?.error?.message
            || `No se pudo ligar «${nombreDocumento || codigo}».`;
        }
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input?.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    this.subirArchivos(files, this.carpetaActualId, 'panel');
  }

  onHubFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input?.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    this.subirArchivos(files, this.carpetaRaizId || this.carpetaActualId, 'hub');
  }

  private subirArchivos(
    files: File[],
    parentId: string,
    origen: 'panel' | 'hub' = 'panel'
  ): void {
    if (origen === 'hub') {
      if (this.subiendoHub) return;
      this.subiendoHub = true;
    } else {
      if (this.subiendo) return;
      this.subiendo = true;
    }
    this.errorCarga = '';
    this.progresoSubida = 0;
    this.subiendoNombre = files.length === 1 ? files[0].name : `${files.length} archivos`;
    let pendientes = files.length;
    let ok = 0;
    let ligados = 0;
    let subidos = 0;
    let progresoAcum = 0;

    files.forEach((file) => {
      this.backend.subirArchivoRrhhRegistros(parentId || '', file)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (event: any) => {
            if (event?.type === HttpEventType.UploadProgress) {
              const total = Number(event.total) || file.size || 1;
              const loaded = Number(event.loaded) || 0;
              const frac = Math.min(1, loaded / total);
              // Promedio simple entre archivos concurrentes
              progresoAcum = Math.max(progresoAcum, frac);
              this.progresoSubida = Math.round(
                ((ok + progresoAcum) / Math.max(files.length, 1)) * 100
              );
              return;
            }
            if (event?.type !== HttpEventType.Response) return;
            const res = event.body || {};
            ok += 1;
            if (res?.ligado || res?.accion === 'ligado' || res?.accion === 'existente') {
              ligados += 1;
            } else {
              subidos += 1;
            }
            pendientes -= 1;
            this.progresoSubida = Math.round((ok / Math.max(files.length, 1)) * 100);
            if (pendientes <= 0) {
              this.subiendo = false;
              this.subiendoHub = false;
              this.progresoSubida = 100;
              this.mensajeOk = this.mensajeResultadoSubida(ok, subidos, ligados);
              this.cargarContenido(this.carpetaActualId, true);
              setTimeout(() => {
                this.progresoSubida = 0;
                this.subiendoNombre = '';
              }, 700);
            }
          },
          error: (err) => {
            pendientes -= 1;
            this.errorCarga = err?.error?.message || `No se pudo procesar «${file.name}».`;
            if (pendientes <= 0) {
              this.subiendo = false;
              this.subiendoHub = false;
              this.progresoSubida = 0;
              this.subiendoNombre = '';
              if (ok) this.cargarContenido(this.carpetaActualId, true);
            }
          }
        });
    });
  }

  private mensajeResultadoSubida(ok: number, subidos: number, ligados: number): string {
    if (ok === 1) {
      if (ligados) return 'Archivo ya existía: se ligó sin volver a subirlo.';
      return 'Archivo subido.';
    }
    const partes: string[] = [];
    if (subidos) partes.push(`${subidos} subido${subidos === 1 ? '' : 's'}`);
    if (ligados) partes.push(`${ligados} ligado${ligados === 1 ? '' : 's'} (ya existían)`);
    return partes.length ? partes.join(' · ') : `${ok} archivos procesados.`;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dropOverBody = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dropOverBody = false;
  }

  onHubDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropOverHub = true;
  }

  onHubDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropOverHub = false;
  }

  onHubDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropOverHub = false;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (!files.length) return;
    this.subirArchivos(files, this.carpetaRaizId || this.carpetaActualId, 'hub');
  }

  onHubPaste(files: File[]): void {
    if (!files?.length) return;
    this.subirArchivos(files, this.carpetaRaizId || this.carpetaActualId, 'hub');
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropOverBody = false;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length) this.subirArchivos(files, this.carpetaActualId, 'panel');
  }

  onPanelPaste(files: File[]): void {
    if (!files?.length) return;
    this.subirArchivos(files, this.carpetaActualId, 'panel');
  }

  abrirDocumento(doc: ArchivoItem): void {
    if (!doc?.id) return;
    const clase = this.claseTipo(doc);
    const ext = this.extensionDe(doc.nombre);

    if (clase === 'imagen') {
      this.documentPreview.abrir({
        nombre: doc.nombre,
        archivo_nombre: doc.nombre,
        archivo_url: doc.id,
        rrhhRegistrosFileId: doc.id,
        tipoHint: 'imagen',
        tema: 'rrhh',
        etiqueta: `Imagen${doc.tamanoLabel ? ' · ' + doc.tamanoLabel : ''} · Registros RH`,
        editorUrl: doc.webViewLink || undefined
      });
      return;
    }

    if (clase === 'pdf') {
      this.documentPreview.abrir({
        nombre: doc.nombre,
        archivo_nombre: doc.nombre,
        archivo_url: doc.id,
        rrhhRegistrosFileId: doc.id,
        tipoHint: 'pdf',
        tema: 'rrhh',
        etiqueta: `PDF${doc.tamanoLabel ? ' · ' + doc.tamanoLabel : ''} · Registros RH`,
        editorUrl: doc.webViewLink || undefined
      });
      return;
    }

    // Word / Excel / PowerPoint: vista previa en el sistema (conversión a PDF vía Drive)
    // y acceso al original en Drive desde el visor.
    if (['word', 'excel', 'ppt'].includes(clase) || ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'].includes(ext)) {
      this.documentPreview.abrir({
        nombre: doc.nombre,
        archivo_nombre: doc.nombre,
        archivo_url: doc.id,
        tipoHint: 'pdf',
        tema: 'rrhh',
        etiqueta: `Vista previa · ${this.etiquetaTipo(doc)}${doc.tamanoLabel ? ' · ' + doc.tamanoLabel : ''}`,
        editorUrl: doc.webViewLink
          || `https://drive.google.com/file/d/${doc.id}/view`
      });
      return;
    }

    window.open(doc.webViewLink || `https://drive.google.com/file/d/${doc.id}/view`, '_blank', 'noopener');
  }

  eliminarItem(tipo: 'carpeta' | 'archivo', id: string, nombre: string, event?: Event): void {
    event?.stopPropagation();
    void Swal.fire({
      icon: 'warning',
      title: tipo === 'carpeta' ? 'Eliminar carpeta' : 'Eliminar archivo',
      text: `¿Eliminar «${nombre}»?`,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#9d174d'
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.backend.eliminarItemRrhhRegistros(id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.mensajeOk = `«${nombre}» eliminado.`;
            this.cargarContenido(this.carpetaActualId, true);
          },
          error: (err) => {
            this.errorCarga = err?.error?.message || 'No se pudo eliminar.';
          }
        });
    });
  }

  descargarDocumento(doc: ArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id) return;
    this.backend.descargarRrhhRegistroArchivo(doc.id, doc.nombre, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.nombre || 'documento';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        },
        error: () => {
          this.errorCarga = `No se pudo descargar «${doc.nombre}».`;
        }
      });
  }

  imprimirDocumento(doc: ArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id) return;
    const clase = this.claseTipo(doc);
    const esPdf = clase === 'pdf';
    const esImagen = clase === 'imagen';
    const driveId = this.driveIdDe(doc);

    void Swal.fire({
      title: 'Preparando impresión…',
      text: 'Un momento, esto puede tardar unos segundos…',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const source$ = (esPdf || esImagen)
      ? this.backend.descargarRrhhRegistroArchivo(doc.id, doc.nombre, false)
      : driveId
        ? this.backend.imprimirArchivoDriveComoPDF(driveId, doc.nombre)
        : this.backend.descargarRrhhRegistroArchivo(doc.id, doc.nombre, false);

    source$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        Swal.close();
        if (!blob || blob.size < 20 || /json|text|html/i.test(blob.type || '')) {
          this.errorCarga = `No se pudo preparar «${doc.nombre}» para imprimir.`;
          return;
        }
        const tipo = esImagen
          ? (blob.type || doc.mimeType || 'image/png')
          : 'application/pdf';
        lanzarImpresionEnSistema(new Blob([blob], { type: tipo }), esImagen);
      },
      error: () => {
        Swal.close();
        this.errorCarga = `No se pudo preparar «${doc.nombre}» para imprimir.`;
      }
    });
  }

  renombrarDocumento(doc: ArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id || !this.puedeRenombrar(doc)) return;
    void Swal.fire({
      title: 'Renombrar archivo',
      input: 'text',
      inputValue: doc.nombre,
      inputPlaceholder: 'Nuevo nombre',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#9d174d',
      inputValidator: (valor) => {
        const v = String(valor || '').trim();
        if (!v) return 'El nombre no puede estar vacío';
        return null;
      }
    }).then((r) => {
      if (!r.isConfirmed) return;
      const nombre = String(r.value || '').trim();
      if (!nombre || nombre === doc.nombre) return;
      this.backend.renombrarRrhhRegistro(doc.id, nombre)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.mensajeOk = `Renombrado a «${nombre}».`;
            this.cargarContenido(this.carpetaActualId, true);
          },
          error: (err) => {
            this.errorCarga = err?.error?.message || 'No se pudo renombrar.';
          }
        });
    });
  }

  iconoArchivo(doc: ArchivoItem): string {
    const clase = this.claseTipo(doc);
    if (clase === 'pdf') return 'fa-file-pdf';
    if (clase === 'imagen') return 'fa-file-image';
    if (clase === 'excel') return 'fa-file-excel';
    if (clase === 'ppt') return 'fa-file-powerpoint';
    if (clase === 'word') return 'fa-file-word';
    return 'fa-file-alt';
  }

  claseTipo(doc: ArchivoItem): string {
    const ext = this.extensionDe(doc.nombre);
    const mime = String(doc.mimeType || '').toLowerCase();
    if (doc.tipo === 'pdf' || ext === 'pdf' || mime.includes('pdf')) return 'pdf';
    if (doc.tipo === 'imagen' || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'imagen';
    if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('sheet') || mime.includes('excel')) return 'excel';
    if (['ppt', 'pptx'].includes(ext) || mime.includes('presentation')) return 'ppt';
    if (['doc', 'docx', 'rtf', 'txt'].includes(ext) || mime.includes('word') || mime.includes('msword')) return 'word';
    if (doc.tipo === 'documento') return 'word';
    return 'otro';
  }

  etiquetaTipo(doc: ArchivoItem): string {
    const ext = this.extensionDe(doc.nombre).toUpperCase();
    if (ext) return ext;
    const clase = this.claseTipo(doc);
    if (clase === 'imagen') return 'IMG';
    if (clase === 'pdf') return 'PDF';
    return 'DOC';
  }

  formatearFecha(valor: string | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  private extensionDe(nombre: string): string {
    const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
}
