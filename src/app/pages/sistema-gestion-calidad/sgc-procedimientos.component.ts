import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';
import {
  SGC_PROCEDIMIENTOS_CATALOG,
  SGC_PROCEDIMIENTOS_CATEGORIAS,
  SgcProcedimientoCategoria,
  SgcProcedimientoDoc,
  urlThumbnailDriveProcedimiento
} from './sgc-procedimientos.catalog';

interface MiniaturaEstado {
  urlStr: string;
  cargando: boolean;
  error: boolean;
  reintento: number;
}

@Component({
  selector: 'app-sgc-procedimientos',
  templateUrl: './sgc-procedimientos.component.html',
  styleUrls: ['./sgc-procedimientos.component.scss']
})
export class SgcProcedimientosComponent implements OnInit, OnDestroy {
  readonly categorias = SGC_PROCEDIMIENTOS_CATEGORIAS;

  etiquetaRolUsuario = '';
  puedeGestionar = false;
  busqueda = '';
  categoriaSeleccionada: SgcProcedimientoCategoria = SGC_PROCEDIMIENTOS_CATEGORIAS[0];
  documentos: SgcProcedimientoDoc[] = [];
  documentosFiltrados: SgcProcedimientoDoc[] = [];
  buscando = false;
  cargandoLista = false;
  errorLista: string | null = null;

  miniaturas: Record<string, MiniaturaEstado> = {};

  mostrarVisor = false;
  visorCargando = false;
  visorError: string | null = null;
  documentoActivo: SgcProcedimientoDoc | null = null;
  previewBlob: Blob | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Preparando vista previa…';
  visorLento = false;
  private visorSub?: Subscription;
  private visorSeq = 0;
  private codigoPendienteVisor: string | null = null;

  // ── Subida ──
  mostrarSubida = false;
  subiendo = false;
  errorSubida: string | null = null;
  formCodigo = '';
  formTitulo = '';
  formCategoriaId = 'sp';
  archivoSubida: File | null = null;

  // ── Reemplazo ──
  mostrarReemplazo = false;
  reemplazando = false;
  errorReemplazo: string | null = null;
  documentoReemplazo: SgcProcedimientoDoc | null = null;
  archivoReemplazo: File | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private backend: BackendServices,
    private pdfPreviewLoader: PdfPreviewLoaderService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  get totalDocumentos(): number {
    return this.documentos.length;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarVisor(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.mostrarSubida && !this.subiendo) {
      event.preventDefault();
      this.cerrarPanelSubida();
      return;
    }
    if (this.mostrarReemplazo && !this.reemplazando) {
      event.preventDefault();
      this.cerrarPanelReemplazo();
      return;
    }
    if (!this.mostrarVisor) {
      return;
    }
    event.preventDefault();
    this.cerrarVisor();
  }

  ngOnInit(): void {
    this.initEtiquetaRol();
    this.cargarLista();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const catId = params.get('cat');
      const cat = this.categorias.find(c => c.id === catId);
      if (cat) {
        this.categoriaSeleccionada = cat;
        this.formCategoriaId = cat.id;
      }
      const codigo = String(params.get('codigo') || '').trim();
      this.codigoPendienteVisor = codigo || null;
      this.aplicarFiltro();
      this.intentarAbrirVisorDesdeBusqueda();
    });
  }

  ngOnDestroy(): void {
    this.visorSub?.unsubscribe();
    this.liberarPreviewBlob();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initEtiquetaRol(): void {
    this.puedeGestionar = this.authService.esAdministradorOSuperior();
    const roles = this.authService.getRoles();
    const principal = (this.authService.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      this.etiquetaRolUsuario = principal === 'root' ? 'Super administrador' : 'Administrador';
    } else if (roles.some(r => r === 'sgc')) {
      this.etiquetaRolUsuario = 'SGC';
    } else {
      this.etiquetaRolUsuario = 'Consulta de procedimientos';
    }
  }

  cargarLista(): void {
    this.cargandoLista = true;
    this.errorLista = null;
    this.backend
      .listarSgcProcedimientos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          const lista = Array.isArray(res?.procedimientos) ? res.procedimientos : [];
          this.documentos = lista.map((d: any) => this.mapearApi(d));
          this.cargandoLista = false;
          this.aplicarFiltro();
          this.intentarAbrirVisorDesdeBusqueda();
        },
        error: err => {
          console.warn('[SGC-PROC] API no disponible, usando catálogo local:', err?.message || err);
          this.documentos = [...SGC_PROCEDIMIENTOS_CATALOG];
          this.errorLista = null;
          this.cargandoLista = false;
          this.aplicarFiltro();
          this.intentarAbrirVisorDesdeBusqueda();
        }
      });
  }

  private mapearApi(d: any): SgcProcedimientoDoc {
    return {
      id: d.id != null ? Number(d.id) : undefined,
      codigo: String(d.codigo || ''),
      titulo: String(d.titulo || ''),
      driveFileId: String(d.driveFileId || d.drive_file_id || ''),
      categoriaId: String(d.categoriaId || d.categoria_id || ''),
      nombreArchivo: d.nombreArchivo || d.nombre_archivo || null,
      tamanoBytes: d.tamanoBytes != null ? Number(d.tamanoBytes) : d.tamano_bytes != null ? Number(d.tamano_bytes) : null,
      actualizadoPor: d.actualizadoPor || d.actualizado_por || null,
      fechaActualizacion: d.fechaActualizacion || d.updated_at || null
    };
  }

  seleccionarCategoria(cat: SgcProcedimientoCategoria): void {
    this.categoriaSeleccionada = cat;
    this.busqueda = '';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cat: cat.id, codigo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.aplicarFiltro();
  }

  esCategoriaActiva(cat: SgcProcedimientoCategoria): boolean {
    return this.categoriaSeleccionada.id === cat.id && !this.buscando;
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    this.buscando = q.length > 0;

    if (!q) {
      this.documentosFiltrados = this.documentos.filter(
        d => d.categoriaId === this.categoriaSeleccionada.id
      );
    } else {
      this.documentosFiltrados = this.documentos.filter(
        d =>
          d.codigo.toLowerCase().includes(q) ||
          d.titulo.toLowerCase().includes(q) ||
          this.nombreCategoria(d.categoriaId).toLowerCase().includes(q)
      );
    }
    this.precargarMiniaturas(this.documentosFiltrados);
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
    this.aplicarFiltro();
  }

  contarPorCategoria(catId: string): number {
    return this.documentos.filter(d => d.categoriaId === catId).length;
  }

  nombreCategoria(catId: string): string {
    return this.categorias.find(c => c.id === catId)?.titulo ?? catId;
  }

  colorCategoria(catId: string): { inicio: string; fin: string } {
    const cat = this.categorias.find(c => c.id === catId);
    return { inicio: cat?.colorInicio ?? '#15a596', fin: cat?.colorFin ?? '#0f766e' };
  }

  async abrirDocumento(doc: SgcProcedimientoDoc): Promise<void> {
    const seq = ++this.visorSeq;
    this.visorSub?.unsubscribe();
    this.liberarPreviewBlob();
    this.documentoActivo = doc;
    this.mostrarVisor = true;
    this.visorCargando = true;
    this.visorError = null;
    this.previewBlob = null;
    this.visorProgreso = 4;
    this.visorEtiqueta = 'Solicitando documento…';
    this.visorLento = false;

    this.visorSub = this.pdfPreviewLoader.observar(
      this.backend.imprimirArchivoDriveComoPDFEventos(
        doc.driveFileId,
        doc.nombreArchivo || `${doc.codigo}.pdf`
      ),
      'Convirtiendo el documento a PDF…'
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

  cerrarVisor(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    this.mostrarVisor = false;
    this.documentoActivo = null;
    this.previewBlob = null;
    this.visorError = null;
    this.visorCargando = false;
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
    ) || SGC_PROCEDIMIENTOS_CATALOG.find(
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
      this.formCategoriaId = cat.id;
      this.aplicarFiltro();
    }
    void this.abrirDocumento(doc);
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
    this.visorError =
      mensaje ||
      'No se pudo cargar la vista previa integrada. Intenta de nuevo.';
  }

  descargarPdfVisor(): void {
    if (!this.puedeGestionar || !this.documentoActivo) {
      return;
    }
    const nombre = this.documentoActivo.nombreArchivo || `${this.documentoActivo.codigo}.pdf`;
    if (this.previewBlob) {
      this.dispararDescarga(this.previewBlob, nombre);
      return;
    }
    this.backend.imprimirArchivoDriveComoPDF(this.documentoActivo.driveFileId, nombre).subscribe({
      next: blob => this.dispararDescarga(blob, nombre),
      error: () => {
        Swal.fire({
          icon: 'error',
          title: 'No se pudo descargar',
          text: 'Intenta de nuevo en unos segundos.',
          confirmButtonColor: '#0f766e'
        });
      }
    });
  }

  private dispararDescarga(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre.endsWith('.pdf') ? nombre : `${nombre}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  miniatura(doc: SgcProcedimientoDoc): MiniaturaEstado {
    return (
      this.miniaturas[doc.codigo] ?? {
        urlStr: urlThumbnailDriveProcedimiento(doc.driveFileId),
        cargando: false,
        error: false,
        reintento: 0
      }
    );
  }

  onErrorMiniatura(doc: SgcProcedimientoDoc): void {
    const prev = this.miniaturas[doc.codigo];
    const reintento = (prev?.reintento ?? 0) + 1;
    if (reintento <= 2) {
      this.miniaturas[doc.codigo] = {
        urlStr: urlThumbnailDriveProcedimiento(doc.driveFileId, Date.now()),
        cargando: false,
        error: false,
        reintento
      };
      return;
    }
    this.miniaturas[doc.codigo] = {
      urlStr: '',
      cargando: false,
      error: true,
      reintento
    };
  }

  private precargarMiniaturas(docs: SgcProcedimientoDoc[]): void {
    for (const doc of docs) {
      if (this.miniaturas[doc.codigo]?.urlStr && !this.miniaturas[doc.codigo].error) {
        continue;
      }
      this.miniaturas[doc.codigo] = {
        urlStr: urlThumbnailDriveProcedimiento(doc.driveFileId),
        cargando: false,
        error: false,
        reintento: 0
      };
    }
  }

  private invalidarMiniatura(codigo: string, driveFileId: string): void {
    this.miniaturas[codigo] = {
      urlStr: urlThumbnailDriveProcedimiento(driveFileId, Date.now()),
      cargando: false,
      error: false,
      reintento: 0
    };
  }

  // ── Subida ──────────────────────────────────────────────

  abrirPanelSubida(): void {
    if (!this.puedeGestionar) {
      return;
    }
    this.formCodigo = '';
    this.formTitulo = '';
    this.formCategoriaId = this.buscando ? 'sp' : this.categoriaSeleccionada.id;
    this.archivoSubida = null;
    this.errorSubida = null;
    this.mostrarSubida = true;
  }

  cerrarPanelSubida(): void {
    if (this.subiendo) {
      return;
    }
    this.mostrarSubida = false;
    this.archivoSubida = null;
    this.errorSubida = null;
  }

  onArchivoSubida(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.archivoSubida = file;
    this.errorSubida = null;
    if (file && !this.formTitulo.trim()) {
      const sinExt = file.name.replace(/\.pdf$/i, '').trim();
      const matchCodigo = sinExt.match(/^([A-Za-z]{2,4}-P-\d{2})\s*(.*)$/i);
      if (matchCodigo) {
        if (!this.formCodigo.trim()) {
          this.formCodigo = matchCodigo[1].toUpperCase();
        }
        if (matchCodigo[2]) {
          this.formTitulo = matchCodigo[2].trim();
        }
        const prefijo = matchCodigo[1].split('-')[0].toLowerCase();
        if (this.categorias.some(c => c.id === prefijo)) {
          this.formCategoriaId = prefijo;
        }
      } else if (!this.formTitulo.trim()) {
        this.formTitulo = sinExt;
      }
    }
    input.value = '';
  }

  quitarArchivoSubida(): void {
    this.archivoSubida = null;
  }

  async confirmarSubida(): Promise<void> {
    if (!this.puedeGestionar || this.subiendo) {
      return;
    }
    const codigo = this.formCodigo.trim().toUpperCase();
    const titulo = this.formTitulo.trim();
    if (!codigo || !titulo || !this.archivoSubida) {
      this.errorSubida = 'Completa código, título y selecciona un PDF.';
      return;
    }
    if (!/\.pdf$/i.test(this.archivoSubida.name) && this.archivoSubida.type !== 'application/pdf') {
      this.errorSubida = 'Solo se permiten archivos PDF.';
      return;
    }

    this.subiendo = true;
    this.errorSubida = null;
    try {
      const base64 = await this.leerArchivoBase64(this.archivoSubida);
      const res = await firstValueFrom(
        this.backend.subirSgcProcedimiento({
          codigo,
          titulo,
          categoria_id: this.formCategoriaId,
          nombre_archivo: this.archivoSubida.name,
          mime_type: 'application/pdf',
          archivo_base64: base64
        })
      );
      const doc = this.mapearApi(res?.procedimiento || {});
      this.mostrarSubida = false;
      this.archivoSubida = null;
      await Swal.fire({
        icon: 'success',
        title: 'Procedimiento subido',
        text: `${doc.codigo || codigo} quedó registrado y disponible.`,
        timer: 2200,
        showConfirmButton: false
      });
      this.cargarLista();
      if (doc.categoriaId) {
        const cat = this.categorias.find(c => c.id === doc.categoriaId);
        if (cat) {
          this.seleccionarCategoria(cat);
        }
      }
    } catch (err: any) {
      this.errorSubida = err?.error?.message || err?.message || 'No se pudo subir el procedimiento.';
    } finally {
      this.subiendo = false;
    }
  }

  // ── Reemplazo ───────────────────────────────────────────

  abrirPanelReemplazo(doc: SgcProcedimientoDoc, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.puedeGestionar || !doc.id) {
      if (!doc.id) {
        Swal.fire({
          icon: 'info',
          title: 'Sin registro en BD',
          text: 'Este documento aún no tiene ID en la base. Recarga la página e inténtalo de nuevo.'
        });
      }
      return;
    }
    this.documentoReemplazo = doc;
    this.archivoReemplazo = null;
    this.errorReemplazo = null;
    this.mostrarReemplazo = true;
  }

  cerrarPanelReemplazo(): void {
    if (this.reemplazando) {
      return;
    }
    this.mostrarReemplazo = false;
    this.documentoReemplazo = null;
    this.archivoReemplazo = null;
    this.errorReemplazo = null;
  }

  onArchivoReemplazo(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.archivoReemplazo = input.files?.[0] || null;
    this.errorReemplazo = null;
    input.value = '';
  }

  quitarArchivoReemplazo(): void {
    this.archivoReemplazo = null;
  }

  async confirmarReemplazo(): Promise<void> {
    if (!this.puedeGestionar || this.reemplazando || !this.documentoReemplazo?.id || !this.archivoReemplazo) {
      this.errorReemplazo = 'Selecciona el PDF actualizado.';
      return;
    }
    if (!/\.pdf$/i.test(this.archivoReemplazo.name) && this.archivoReemplazo.type !== 'application/pdf') {
      this.errorReemplazo = 'Solo se permiten archivos PDF.';
      return;
    }

    this.reemplazando = true;
    this.errorReemplazo = null;
    try {
      const base64 = await this.leerArchivoBase64(this.archivoReemplazo);
      const id = this.documentoReemplazo.id;
      const codigo = this.documentoReemplazo.codigo;
      const res = await firstValueFrom(
        this.backend.reemplazarSgcProcedimiento(id, {
          nombre_archivo: this.archivoReemplazo.name,
          mime_type: 'application/pdf',
          archivo_base64: base64
        })
      );
      const actualizado = this.mapearApi(res?.procedimiento || {});
      this.mostrarReemplazo = false;
      this.documentoReemplazo = null;
      this.archivoReemplazo = null;

      const idx = this.documentos.findIndex(d => d.id === id || d.codigo === codigo);
      if (idx >= 0) {
        this.documentos[idx] = { ...this.documentos[idx], ...actualizado };
        this.invalidarMiniatura(this.documentos[idx].codigo, this.documentos[idx].driveFileId);
      }
      this.aplicarFiltro();

      await Swal.fire({
        icon: 'success',
        title: 'Archivo actualizado',
        text: `${codigo} se reemplazó correctamente.`,
        timer: 2200,
        showConfirmButton: false
      });
    } catch (err: any) {
      this.errorReemplazo = err?.error?.message || err?.message || 'No se pudo reemplazar el archivo.';
    } finally {
      this.reemplazando = false;
    }
  }

  private leerArchivoBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  trackByCodigo(_: number, doc: SgcProcedimientoDoc): string {
    return doc.codigo;
  }

  trackByCategoria(_: number, cat: SgcProcedimientoCategoria): string {
    return cat.id;
  }
}
