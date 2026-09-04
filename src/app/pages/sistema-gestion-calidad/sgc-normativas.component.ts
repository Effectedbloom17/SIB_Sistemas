import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';
import {
  SGC_NORMATIVAS_CATALOG,
  SGC_NORMATIVAS_CATEGORIAS,
  SgcNormativaCategoria,
  SgcNormativaDoc
} from './sgc-normativas.catalog';

@Component({
  selector: 'app-sgc-normativas',
  templateUrl: './sgc-normativas.component.html',
  styleUrls: [
    './sgc-capitulos-panel.component.scss',
    './sgc-formatos-descarga.component.scss'
  ]
})
export class SgcNormativasComponent implements OnInit, OnDestroy {
  readonly categorias = SGC_NORMATIVAS_CATEGORIAS;
  documentos: SgcNormativaDoc[] = SGC_NORMATIVAS_CATALOG.map((d) => ({ ...d }));
  documentosFiltrados: SgcNormativaDoc[] = [];

  busqueda = '';
  categoriaSeleccionada: SgcNormativaCategoria = SGC_NORMATIVAS_CATEGORIAS[0];
  buscando = false;
  cargandoLista = false;
  errorLista: string | null = null;
  descargandoId: string | null = null;
  reemplazandoId: string | null = null;
  mostrarVisor = false;
  visorCargando = false;
  visorError: string | null = null;
  documentoActivo: SgcNormativaDoc | null = null;
  previewBlob: Blob | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Preparando vista previa…';
  visorLento = false;
  paginaDocs = 1;
  readonly DOCS_POR_PAGINA = 6;

  @ViewChild('inputReemplazo') inputReemplazo?: ElementRef<HTMLInputElement>;
  private docPendienteReemplazo: SgcNormativaDoc | null = null;
  private visorSub?: Subscription;
  private visorSeq = 0;
  private codigoPendienteVisor: string | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private pdfPreviewLoader: PdfPreviewLoaderService
  ) {}

  get totalDocumentos(): number {
    return this.documentos.length;
  }

  get categoriasVisibles(): SgcNormativaCategoria[] {
    if (this.cargandoLista || !this.documentos.length) {
      return this.categorias;
    }
    return this.categorias.filter(
      (c) => this.contarPorCategoria(c.id) > 0 || c.id === this.categoriaSeleccionada.id
    );
  }

  get puedeReemplazar(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.mostrarVisor) {
      event.preventDefault();
      this.cerrarVisor();
    }
  }

  ngOnInit(): void {
    this.cargarLista();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const catId = params.get('cat');
      const cat = this.categorias.find(c => c.id === catId);
      if (cat && cat.id !== this.categoriaSeleccionada.id) {
        this.categoriaSeleccionada = cat;
        this.paginaDocs = 1;
      } else if (cat) {
        this.categoriaSeleccionada = cat;
      }
      const codigo = String(params.get('codigo') || '').trim();
      this.codigoPendienteVisor = codigo || null;
      this.aplicarFiltro();
      this.intentarAbrirVisorDesdeBusqueda();
    });
  }

  get puedeDescargarPdfVisor(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  ngOnDestroy(): void {
    this.visorSub?.unsubscribe();
    this.liberarPreviewBlob();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private cargarLista(): void {
    const tieneCatalogo = this.documentos.length > 0;
    this.cargandoLista = !tieneCatalogo;
    this.errorLista = null;
    this.backend.listarSgcNormativas().pipe(takeUntil(this.destroy$)).subscribe({
      next: (resp: any) => {
        this.cargandoLista = false;
        if (resp?.success && Array.isArray(resp.documentos) && resp.documentos.length) {
          this.documentos = resp.documentos.map((d: any) => this.mapear(d));
        } else if (!this.documentos.length) {
          this.documentos = SGC_NORMATIVAS_CATALOG.map((d) => ({ ...d }));
        }
        if (this.contarPorCategoria(this.categoriaSeleccionada.id) === 0) {
          const conDocs = this.categorias.find((c) => this.contarPorCategoria(c.id) > 0);
          if (conDocs) this.categoriaSeleccionada = conDocs;
        }
        this.aplicarFiltro();
        this.intentarAbrirVisorDesdeBusqueda();
        if (this.mostrarVisor && this.documentoActivo) {
          const actualizado = this.documentos.find((d) => d.id === this.documentoActivo!.id);
          if (actualizado) {
            void this.abrirVisor(actualizado);
          }
        }
      },
      error: () => {
        this.cargandoLista = false;
        this.errorLista = null;
        if (!this.documentos.length) {
          this.documentos = SGC_NORMATIVAS_CATALOG.map((d) => ({ ...d }));
        }
        this.aplicarFiltro();
        this.intentarAbrirVisorDesdeBusqueda();
      }
    });
  }

  private mapear(d: any): SgcNormativaDoc {
    return {
      id: String(d.id || d.driveFileId || d.drive_file_id || ''),
      codigo: String(d.codigo || ''),
      titulo: String(d.titulo || d.codigo || ''),
      driveFileId: String(d.driveFileId || d.drive_file_id || d.id || ''),
      categoriaId: String(d.categoriaId || d.categoria_id || 'otras'),
      nombreArchivo: String(d.nombreArchivo || d.nombre_archivo || `${d.codigo || 'normativa'}.pdf`),
      mimeType: d.mimeType || d.mime_type || 'application/pdf',
      tamanoBytes: d.tamanoBytes != null ? Number(d.tamanoBytes) : d.tamano_bytes != null ? Number(d.tamano_bytes) : null,
      fechaModificacion: d.fechaModificacion || d.fecha_modificacion || null,
      autoridad: d.autoridad || null,
      anio: d.anio != null ? Number(d.anio) : null,
      numero: d.numero != null ? Number(d.numero) : undefined
    };
  }

  seleccionarCategoria(cat: SgcNormativaCategoria): void {
    this.categoriaSeleccionada = cat;
    this.busqueda = '';
    this.paginaDocs = 1;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cat: cat.id, codigo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.aplicarFiltro();
  }

  esCategoriaActiva(cat: SgcNormativaCategoria): boolean {
    return this.categoriaSeleccionada.id === cat.id && !this.buscando;
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    this.buscando = q.length > 0;
    let list = this.documentos.slice();
    if (!this.buscando) {
      list = list.filter(d => d.categoriaId === this.categoriaSeleccionada.id);
    }
    if (this.buscando) {
      list = list.filter(d => {
        const hay = `${d.codigo} ${d.titulo} ${d.nombreArchivo} ${this.nombreCategoria(d.categoriaId)}`.toLowerCase();
        return hay.includes(q);
      });
    }
    this.documentosFiltrados = list;
    const maxPag = Math.max(1, Math.ceil(list.length / this.DOCS_POR_PAGINA));
    if (this.paginaDocs > maxPag) this.paginaDocs = maxPag;
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
    this.aplicarFiltro();
  }

  contarPorCategoria(catId: string): number {
    return this.documentos.filter(d => d.categoriaId === catId).length;
  }

  nombreCategoria(catId: string): string {
    return this.categorias.find(c => c.id === catId)?.titulo || catId;
  }

  get documentosPaginados(): SgcNormativaDoc[] {
    const start = (this.paginaDocs - 1) * this.DOCS_POR_PAGINA;
    return this.documentosFiltrados.slice(start, start + this.DOCS_POR_PAGINA);
  }

  get totalPaginasDocs(): number {
    return Math.max(1, Math.ceil(this.documentosFiltrados.length / this.DOCS_POR_PAGINA));
  }

  get paginasDocs(): number[] {
    return Array.from({ length: this.totalPaginasDocs }, (_, i) => i + 1);
  }

  get mostrarPaginacionDocs(): boolean {
    return this.documentosFiltrados.length > this.DOCS_POR_PAGINA;
  }

  get rangoDocsEtiqueta(): string {
    if (!this.documentosFiltrados.length) return '0';
    const start = (this.paginaDocs - 1) * this.DOCS_POR_PAGINA + 1;
    const end = Math.min(this.paginaDocs * this.DOCS_POR_PAGINA, this.documentosFiltrados.length);
    return `${start}–${end} de ${this.documentosFiltrados.length}`;
  }

  irPaginaDocs(pagina: number): void {
    const max = this.totalPaginasDocs;
    this.paginaDocs = Math.min(max, Math.max(1, pagina));
  }

  trackByCategoria(_i: number, cat: SgcNormativaCategoria): string {
    return cat.id;
  }

  trackById(_i: number, doc: SgcNormativaDoc): string {
    return doc.id;
  }

  tamanoEtiqueta(doc: SgcNormativaDoc): string {
    const bytes = Number(doc.tamanoBytes || 0);
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  solicitarReemplazo(doc: SgcNormativaDoc, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.puedeReemplazar || this.reemplazandoId) return;
    this.docPendienteReemplazo = doc;
    const input = this.inputReemplazo?.nativeElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async onArchivoReemplazoSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const doc = this.docPendienteReemplazo;
    this.docPendienteReemplazo = null;
    if (!file || !doc) return;

    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!esPdf) {
      input.value = '';
      await Swal.fire({
        icon: 'error',
        title: 'Archivo no permitido',
        text: 'Solo se puede reemplazar con un PDF.',
        confirmButtonColor: '#0f766e'
      });
      return;
    }

    const confirm = await Swal.fire({
      title: '¿Reemplazar normativa?',
      html: `<p>Se actualizará el PDF de <strong>${doc.codigo}</strong>.</p>
             <p class="text-muted small mb-0">El archivo anterior se sustituye en Drive conservando el mismo nombre.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#0f766e',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, reemplazar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) {
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('archivo', file);

    this.reemplazandoId = doc.id;
    Swal.fire({
      title: 'Actualizando normativa…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    this.backend.reemplazarSgcNormativa(doc.driveFileId, formData).subscribe({
      next: (resp: any) => {
        this.reemplazandoId = null;
        input.value = '';
        if (resp?.success && resp.documento) {
          const actualizado = this.mapear(resp.documento);
          const idx = this.documentos.findIndex(d => d.id === doc.id || d.driveFileId === doc.driveFileId);
          if (idx >= 0) {
            this.documentos[idx] = actualizado;
          }
          this.aplicarFiltro();
          Swal.fire({
            icon: 'success',
            title: 'Normativa actualizada',
            text: resp.message || 'El PDF se reemplazó correctamente.',
            confirmButtonColor: '#0f766e'
          });
          if (this.mostrarVisor && this.documentoActivo?.id === doc.id) {
            void this.abrirVisor(actualizado);
          }
        } else {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo reemplazar',
            text: resp?.message || 'Error desconocido',
            confirmButtonColor: '#0f766e'
          });
        }
      },
      error: (err) => {
        this.reemplazandoId = null;
        input.value = '';
        Swal.fire({
          icon: 'error',
          title: 'No se pudo reemplazar',
          text: err?.error?.message || err?.message || 'Error al subir el archivo',
          confirmButtonColor: '#0f766e'
        });
      }
    });
  }

  async abrirVisor(doc: SgcNormativaDoc): Promise<void> {
    const seq = ++this.visorSeq;
    this.visorSub?.unsubscribe();
    this.liberarPreviewBlob();
    this.documentoActivo = doc;
    this.visorCargando = true;
    this.visorError = null;
    this.previewBlob = null;
    this.mostrarVisor = true;
    this.visorProgreso = 4;
    this.visorEtiqueta = 'Solicitando documento…';
    this.visorLento = false;

    this.visorSub = this.pdfPreviewLoader.observar(
      this.backend.descargarArchivoDriveEventos(doc.driveFileId, doc.nombreArchivo),
      'Cargando el PDF desde Drive…'
    ).pipe(takeUntil(this.destroy$)).subscribe(state => {
      if (seq !== this.visorSeq) {
        return;
      }
      this.visorProgreso = state.pct;
      this.visorEtiqueta = state.etiqueta;
      this.visorLento = state.lento;
      if (state.error) {
        this.visorCargando = false;
        this.visorError = state.error;
        return;
      }
      if (state.blob) {
        this.previewBlob = state.blob;
        this.visorCargando = false;
      }
    });
  }

  private async extraerMensajeJsonBlob(blob: Blob, fallback: string): Promise<string> {
    try {
      const texto = await blob.text();
      const parsed = JSON.parse(texto);
      return parsed?.message || parsed?.error || fallback;
    } catch {
      return fallback;
    }
  }

  private async mensajeErrorBlob(err: any, fallback: string): Promise<string> {
    if (err?.error instanceof Blob) {
      return this.extraerMensajeJsonBlob(err.error, err?.message || fallback);
    }
    if (typeof err?.error === 'string') {
      try {
        return JSON.parse(err.error)?.message || err.error;
      } catch {
        return err.error;
      }
    }
    return err?.error?.message || err?.message || fallback;
  }

  cerrarVisor(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    this.mostrarVisor = false;
    this.visorCargando = false;
    this.visorError = null;
    this.documentoActivo = null;
    this.previewBlob = null;
    this.visorProgreso = 0;
    this.visorLento = false;
    this.liberarPreviewBlob();
    this.quitarCodigoDeRuta();
  }

  private intentarAbrirVisorDesdeBusqueda(): void {
    const codigo = String(this.codigoPendienteVisor || '').trim();
    if (!codigo || !this.documentos.length) {
      return;
    }
    const doc = this.documentos.find(
      (d) => d.codigo.toLowerCase() === codigo.toLowerCase()
    );
    if (!doc) {
      return;
    }
    if (this.mostrarVisor && this.documentoActivo?.codigo.toLowerCase() === codigo.toLowerCase()) {
      this.codigoPendienteVisor = null;
      return;
    }
    this.codigoPendienteVisor = null;
    const cat = this.categorias.find((c) => c.id === doc.categoriaId);
    if (cat) {
      this.categoriaSeleccionada = cat;
      this.paginaDocs = 1;
      this.aplicarFiltro();
    }
    void this.abrirVisor(doc);
  }

  private quitarCodigoDeRuta(): void {
    if (!this.route.snapshot.queryParamMap.has('codigo')) {
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { codigo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private liberarPreviewBlob(): void {
    this.previewBlob = null;
  }

  onErrorVisor(mensaje?: string): void {
    this.visorCargando = false;
    this.visorError = mensaje || 'No se pudo preparar la vista previa. Puedes descargar el PDF.';
  }

  descargarPdfVisor(): void {
    if (!this.puedeDescargarPdfVisor || !this.documentoActivo) {
      return;
    }
    if (this.previewBlob) {
      const url = URL.createObjectURL(this.previewBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.documentoActivo.nombreArchivo || `${this.documentoActivo.codigo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  async descargar(doc: SgcNormativaDoc, event?: Event): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.descargandoId) {
      return;
    }

    this.descargandoId = doc.id;
    try {
      const blob = await firstValueFrom(
        this.backend.descargarArchivoDrive(doc.driveFileId, doc.nombreArchivo)
      );
      if (!blob || blob.size === 0) {
        throw new Error('El archivo descargado está vacío.');
      }
      if (blob.type && blob.type.includes('application/json')) {
        throw new Error(await this.extraerMensajeJsonBlob(blob, 'No se pudo descargar la normativa.'));
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nombreArchivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Descarga no disponible',
        text: await this.mensajeErrorBlob(err, 'No se pudo descargar el PDF desde Drive.'),
        confirmButtonColor: '#15a596'
      });
    } finally {
      this.descargandoId = null;
    }
  }
}
