import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, concatMap, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfThumbnailService } from 'src/app/services/pdf-thumbnail.service';

interface CpRepoArchivo {
  id: string;
  nombre: string;
  mimeType?: string;
  size?: number | null;
  modifiedTime?: string | null;
  webViewLink?: string;
}

interface CpMiniatura {
  url: string | null;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

type PreviewModo = 'pdf' | 'imagen' | 'office' | 'icono';
type FiltroTipo = 'todo' | 'pdf' | 'docs' | 'imagenes';

@Component({
  selector: 'app-control-proyectos-repositorio',
  templateUrl: './control-proyectos-repositorio.component.html',
  styleUrls: ['./control-proyectos-repositorio.component.scss']
})
export class ControlProyectosRepositorioComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private miniaturaObjectUrls = new Map<string, string>();
  miniaturas: Record<string, CpMiniatura> = {};

  empresaId: number | null = null;
  empresaNombre = '';
  folio = '';
  nombreProyecto = '';
  actividadId: number | null = null;
  actividadNombre = '';

  archivos: CpRepoArchivo[] = [];
  cargando = false;
  errorCarga = '';
  busqueda = '';
  filtroTipo: FiltroTipo = 'todo';
  vistaArchivos: 'grid' | 'lista' = 'grid';
  subiendo = false;
  puedeEscribir = true;

  mostrarVisor = false;
  documentoActivo: CpRepoArchivo | null = null;
  previewModo: PreviewModo = 'icono';
  visorCargando = false;
  visorError: string | null = null;
  previewUrlSafe: SafeResourceUrl | null = null;
  previewBlob: Blob | null = null;
  usarIframePdf = false;
  private previewObjectUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backend: BackendServices,
    private auth: AuthService,
    private sanitizer: DomSanitizer,
    private pdfThumbnail: PdfThumbnailService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.puedeEscribir = !this.auth.esUsuarioEmpresa();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const empresaId = Number(params.get('empresaId') || 0);
      this.empresaId = Number.isInteger(empresaId) && empresaId > 0 ? empresaId : null;
      this.empresaNombre = String(params.get('empresaNombre') || '').trim();
      this.folio = String(params.get('folio') || '').trim();
      this.nombreProyecto = String(params.get('nombreProyecto') || '').trim();
      const actividadId = Number(params.get('actividadId') || 0);
      this.actividadId = Number.isInteger(actividadId) && actividadId > 0 ? actividadId : null;
      this.actividadNombre = String(params.get('actividadNombre') || '').trim();
      if (!this.nombreProyecto && !this.folio) {
        this.errorCarga = 'Falta el proyecto para abrir el repositorio.';
        return;
      }
      this.cargar();
    });
  }

  ngOnDestroy(): void {
    this.revocarPreviewUrl();
    this.limpiarMiniaturas();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get meta() {
    return {
      empresaId: this.empresaId,
      empresaNombre: this.empresaNombre,
      folio: this.folio,
      nombreProyecto: this.nombreProyecto,
      actividadId: this.actividadId,
      actividadNombre: this.actividadNombre || null
    };
  }

  get tituloProyecto(): string {
    if (this.folio && this.nombreProyecto) return `${this.folio} · ${this.nombreProyecto}`;
    return this.nombreProyecto || this.folio || 'Proyecto';
  }

  get tituloActividad(): string {
    if (this.actividadNombre) return this.actividadNombre;
    if (this.actividadId) return `Actividad #${this.actividadId}`;
    return '';
  }

  get tituloRepositorio(): string {
    const act = this.tituloActividad;
    return act ? `${this.tituloProyecto} · ${act}` : this.tituloProyecto;
  }

  get archivosFiltrados(): CpRepoArchivo[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.archivos.filter((a) => {
      if (q && !String(a.nombre || '').toLowerCase().includes(q)) return false;
      const modo = this.clasificar(a);
      if (this.filtroTipo === 'pdf') return modo === 'pdf';
      if (this.filtroTipo === 'imagenes') return modo === 'imagen';
      if (this.filtroTipo === 'docs') return modo === 'office' || modo === 'icono';
      return true;
    });
  }

  get totalBytesUsados(): number {
    return this.archivos.reduce((s, a) => s + (Number(a.size) || 0), 0);
  }

  get conteoPdf(): number {
    return this.archivos.filter((a) => this.clasificar(a) === 'pdf').length;
  }

  get conteoDocumentos(): number {
    return this.archivos.filter((a) => {
      const m = this.clasificar(a);
      return m === 'office' || m === 'icono';
    }).length;
  }

  get conteoImagenes(): number {
    return this.archivos.filter((a) => this.clasificar(a) === 'imagen').length;
  }

  get porcentajeUsoVisual(): number {
    const max = 50 * 1024 * 1024;
    return Math.min(100, Math.round((this.totalBytesUsados / max) * 100));
  }

  cargar(): void {
    this.cargando = true;
    this.errorCarga = '';
    this.limpiarMiniaturas();
    this.backend.listarAdjuntosControlProyectos(this.meta)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargando = false;
          if (!res?.success) {
            this.errorCarga = res?.message || 'No se pudo cargar el repositorio.';
            this.archivos = [];
            return;
          }
          this.archivos = Array.isArray(res.archivos) ? res.archivos : [];
          this.precargarMiniaturas(this.archivos);
        },
        error: (err) => {
          this.cargando = false;
          this.errorCarga = err?.error?.message || 'No se pudo cargar el repositorio.';
          this.archivos = [];
        }
      });
  }

  trackById(_: number, doc: CpRepoArchivo): string {
    return doc.id;
  }

  claseTile(doc: CpRepoArchivo): string {
    const etiqueta = this.etiquetaTipo(doc).toLowerCase();
    if (etiqueta === 'pdf') return 'cp-repo-tile--pdf';
    if (etiqueta === 'excel' || etiqueta === 'csv') return `cp-repo-tile--${etiqueta}`;
    if (etiqueta === 'word') return 'cp-repo-tile--word';
    if (etiqueta === 'powerpoint') return 'cp-repo-tile--ppt';
    if (etiqueta === 'imagen') return 'cp-repo-tile--imagen';
    return '';
  }

  miniaturaDe(doc: CpRepoArchivo): CpMiniatura {
    return this.miniaturas[doc.id] || { url: null, cargando: false, error: false, reintento: 0 };
  }

  private urlThumbnailDrive(fileId: string, cacheBust = 0): string {
    const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w420`;
    return cacheBust ? `${base}&t=${cacheBust}` : base;
  }

  private actualizarMiniatura(id: string, estado: CpMiniatura): void {
    this.ngZone.run(() => {
      this.miniaturas = { ...this.miniaturas, [id]: estado };
    });
  }

  onMiniaturaError(doc: CpRepoArchivo, event?: Event): void {
    event?.stopPropagation();
    const prev = this.miniaturaDe(doc);
    const eraDrive = !!prev.url?.includes('drive.google.com/thumbnail');

    if (eraDrive && prev.reintento < 2) {
      this.actualizarMiniatura(doc.id, {
        url: null,
        cargando: true,
        error: false,
        reintento: prev.reintento + 1
      });
      this.backend.prepararVistaAdjuntoControlProyectos(this.meta, doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.actualizarMiniatura(doc.id, {
              url: this.urlThumbnailDrive(doc.id, Date.now()),
              cargando: false,
              error: false,
              reintento: prev.reintento + 1
            });
          },
          error: () => this.cargarMiniaturaAutenticada(doc, prev.reintento + 1)
        });
      return;
    }

    if (prev.reintento < 3 && (eraDrive || !prev.error)) {
      this.cargarMiniaturaAutenticada(doc, prev.reintento + 1);
      return;
    }

    this.actualizarMiniatura(doc.id, {
      url: null,
      cargando: false,
      error: true,
      reintento: prev.reintento
    });
  }

  private precargarMiniaturas(docs: CpRepoArchivo[]): void {
    for (const doc of docs) {
      const modo = this.clasificar(doc);
      if (modo === 'icono') {
        this.miniaturas[doc.id] = { url: null, cargando: false, error: false, reintento: 0 };
        continue;
      }
      if (modo === 'office') {
        this.miniaturas[doc.id] = {
          url: this.urlThumbnailDrive(doc.id),
          cargando: false,
          error: false,
          reintento: 0
        };
        continue;
      }
      this.cargarMiniaturaAutenticada(doc, 0);
    }
    this.miniaturas = { ...this.miniaturas };
  }

  private cargarMiniaturaAutenticada(doc: CpRepoArchivo, reintento = 0): void {
    const actual = this.miniaturaDe(doc);
    if (actual.cargando && actual.reintento === reintento) {
      return;
    }
    if (actual.url && !actual.url.includes('drive.google.com/thumbnail') && !actual.error) {
      return;
    }
    this.actualizarMiniatura(doc.id, {
      url: null,
      cargando: true,
      error: false,
      reintento
    });
    const modo = this.clasificar(doc);
    this.backend.descargarAdjuntoControlProyectos(this.meta, doc.id)
      .pipe(
        takeUntil(this.destroy$),
        concatMap(async (blob) => {
          if (!blob || blob.size < 20 || /json|html|text\/plain/i.test(blob.type || '')) {
            return null;
          }
          if (modo === 'pdf') {
            try {
              const typed = blob.type === 'application/pdf'
                ? blob
                : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
              return await this.pdfThumbnail.renderizarPrimeraPagina(typed, 480);
            } catch {
              return null;
            }
          }
          if (modo === 'imagen') {
            return blob;
          }
          return null;
        }),
        catchError(() => of(null))
      )
      .subscribe((thumb) => {
        if (!thumb) {
          // Office: último recurso thumbnail de Drive; PDF/imagen ya fallaron el render local
          if (modo === 'office') {
            this.actualizarMiniatura(doc.id, {
              url: this.urlThumbnailDrive(doc.id, Date.now()),
              cargando: false,
              error: false,
              reintento
            });
            return;
          }
          this.actualizarMiniatura(doc.id, {
            url: null,
            cargando: false,
            error: true,
            reintento
          });
          return;
        }
        const prevUrl = this.miniaturaObjectUrls.get(doc.id);
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        const url = URL.createObjectURL(thumb);
        this.miniaturaObjectUrls.set(doc.id, url);
        this.actualizarMiniatura(doc.id, {
          url,
          cargando: false,
          error: false,
          reintento
        });
      });
  }

  private limpiarMiniaturas(): void {
    for (const url of this.miniaturaObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.miniaturaObjectUrls.clear();
    this.miniaturas = {};
  }

  volver(): void {
    this.router.navigate(['/control-proyectos']);
  }

  setFiltro(tipo: FiltroTipo): void {
    this.filtroTipo = tipo;
  }

  setVista(v: 'grid' | 'lista'): void {
    this.vistaArchivos = v;
  }

  onSeleccionarArchivos(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const files = Array.from(input?.files || []);
    if (input) input.value = '';
    if (!files.length || !this.puedeEscribir) return;
    this.subirArchivos(files);
  }

  private subirArchivos(files: File[]): void {
    this.subiendo = true;
    Swal.fire({
      title: 'Subiendo documentos…',
      text: `0 / ${files.length}`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    let idx = 0;
    const siguiente = () => {
      if (idx >= files.length) {
        this.subiendo = false;
        Swal.close();
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: files.length === 1 ? 'Documento subido' : `${files.length} documentos subidos`,
          showConfirmButton: false,
          timer: 2800
        });
        this.cargar();
        return;
      }
      const file = files[idx];
      Swal.update({ text: `${idx + 1} / ${files.length} · ${file.name}` });
      this.backend.subirAdjuntoControlProyectos(this.meta, file)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            if (!res?.success) {
              this.subiendo = false;
              Swal.close();
              Swal.fire('Error', res?.message || `No se pudo subir ${file.name}`, 'error');
              this.cargar();
              return;
            }
            idx += 1;
            siguiente();
          },
          error: (err) => {
            this.subiendo = false;
            Swal.close();
            Swal.fire('Error', err?.error?.message || `No se pudo subir ${file.name}`, 'error');
            this.cargar();
          }
        });
    };
    siguiente();
  }

  eliminar(doc: CpRepoArchivo, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeEscribir || !doc?.id) return;
    Swal.fire({
      title: '¿Eliminar documento?',
      html: `<p class="mb-0">Se eliminará <strong>${this.escapeHtml(doc.nombre)}</strong> de Drive.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#be123c'
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.backend.eliminarAdjuntoControlProyectos({ ...this.meta, fileId: doc.id })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            if (!res?.success) {
              Swal.fire('Error', res?.message || 'No se pudo eliminar', 'error');
              return;
            }
            this.archivos = this.archivos.filter((a) => a.id !== doc.id);
            Swal.fire({
              toast: true,
              position: 'top-end',
              icon: 'success',
              title: 'Documento eliminado',
              showConfirmButton: false,
              timer: 2200
            });
          },
          error: (err) => Swal.fire('Error', err?.error?.message || 'No se pudo eliminar', 'error')
        });
    });
  }

  abrirDocumento(doc: CpRepoArchivo): void {
    this.documentoActivo = doc;
    this.mostrarVisor = true;
    this.visorCargando = true;
    this.visorError = null;
    this.previewModo = this.clasificar(doc);
    this.usarIframePdf = false;
    this.revocarPreviewUrl();
    this.previewUrlSafe = null;
    this.previewBlob = null;

    if (this.previewModo === 'icono') {
      this.visorCargando = false;
      return;
    }

    if (this.previewModo === 'office') {
      this.abrirPreviewDrive(doc);
      return;
    }

    if (this.previewModo === 'pdf') {
      this.backend.descargarAdjuntoControlProyectos(this.meta, doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (blob) => {
            const valido = await this.esBlobPdfValido(blob);
            if (!valido) {
              this.usarIframePdf = true;
              this.abrirPreviewDrive(doc);
              return;
            }
            this.previewObjectUrl = URL.createObjectURL(blob);
            this.previewBlob = blob;
            this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl);
            this.visorCargando = false;
          },
          error: () => {
            this.usarIframePdf = true;
            this.abrirPreviewDrive(doc);
          }
        });
      return;
    }

    this.backend.descargarAdjuntoControlProyectos(this.meta, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          if (!blob || blob.size === 0 || String(blob.type || '').includes('json')) {
            this.visorError = 'No se pudo cargar la vista previa.';
            this.visorCargando = false;
            return;
          }
          this.previewObjectUrl = URL.createObjectURL(blob);
          this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl);
          this.visorCargando = false;
        },
        error: () => {
          this.visorError = 'No se pudo cargar la vista previa.';
          this.visorCargando = false;
        }
      });
  }

  private abrirPreviewDrive(doc: CpRepoArchivo): void {
    this.backend.prepararVistaAdjuntoControlProyectos(this.meta, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const url = res?.previewUrl || `https://drive.google.com/file/d/${doc.id}/preview`;
          this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          this.visorCargando = false;
        },
        error: () => {
          this.previewUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(
            `https://drive.google.com/file/d/${doc.id}/preview`
          );
          this.visorCargando = false;
        }
      });
  }

  private async esBlobPdfValido(blob: Blob | null): Promise<boolean> {
    if (!blob || blob.size < 5) return false;
    const tipo = String(blob.type || '').toLowerCase();
    if (tipo.includes('json') || tipo.includes('html') || tipo.includes('text/plain')) return false;
    try {
      const head = await blob.slice(0, 5).text();
      return head.startsWith('%PDF');
    } catch {
      return tipo.includes('pdf') || tipo === 'application/octet-stream';
    }
  }

  cerrarVisor(): void {
    this.mostrarVisor = false;
    this.documentoActivo = null;
    this.visorError = null;
    this.usarIframePdf = false;
    this.revocarPreviewUrl();
    this.previewUrlSafe = null;
    this.previewBlob = null;
  }

  descargarDocumento(doc: CpRepoArchivo, event?: Event): void {
    event?.stopPropagation();
    if (!doc?.id) return;
    this.backend.descargarAdjuntoControlProyectos(this.meta, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.nombre || 'archivo';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => Swal.fire('Error', err?.error?.message || 'No se pudo descargar', 'error')
      });
  }

  descargarActivo(): void {
    if (!this.documentoActivo) return;
    this.descargarDocumento(this.documentoActivo);
  }

  onVisorOfficeLoad(): void {
    this.visorCargando = false;
  }

  formatearFecha(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return String(iso);
    }
  }

  formatearTamano(bytes: number | null | undefined): string {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  iconoTipo(doc: CpRepoArchivo): string {
    const m = this.clasificar(doc);
    if (m === 'pdf') return 'fa-file-pdf';
    if (m === 'imagen') return 'fa-file-image';
    if (m === 'office') {
      const name = String(doc.nombre || '').toLowerCase();
      if (name.endsWith('.xls') || name.endsWith('.xlsx') || (doc.mimeType || '').includes('sheet')) return 'fa-file-excel';
      if (name.endsWith('.ppt') || name.endsWith('.pptx') || (doc.mimeType || '').includes('presentation')) return 'fa-file-powerpoint';
      return 'fa-file-word';
    }
    return 'fa-file-alt';
  }

  etiquetaTipo(doc: CpRepoArchivo): string {
    const m = this.clasificar(doc);
    if (m === 'pdf') return 'PDF';
    if (m === 'imagen') return 'IMAGEN';
    if (m === 'office') {
      const name = String(doc.nombre || '').toLowerCase();
      if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'EXCEL';
      if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'POWERPOINT';
      if (name.endsWith('.doc') || name.endsWith('.docx')) return 'WORD';
      return 'OFFICE';
    }
    return 'ARCHIVO';
  }

  private clasificar(doc: CpRepoArchivo): PreviewModo {
    const mime = String(doc.mimeType || '').toLowerCase();
    const name = String(doc.nombre || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return 'imagen';
    if (
      mime.includes('word') || mime.includes('excel') || mime.includes('powerpoint')
      || mime.includes('officedocument') || mime.includes('msword') || mime.includes('ms-excel')
      || mime.includes('ms-powerpoint') || mime.includes('presentation') || mime.includes('spreadsheet')
      || /\.(docx?|xlsx?|pptx?)$/i.test(name)
    ) {
      return 'office';
    }
    return 'icono';
  }

  private revocarPreviewUrl(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
  }

  private escapeHtml(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
