import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';
import {
  SGC_FORMATOS_CATEGORIAS,
  SGC_FORMATOS_DESCARGA_CATALOG,
  SgcFormatoCategoria,
  SgcFormatoDescarga,
  SgcFormatoTipo,
  etiquetaTipoFormato,
  iconoTipoFormato
} from './sgc-formatos-descarga.catalog';

@Component({
  selector: 'app-sgc-formatos-descarga',
  templateUrl: './sgc-formatos-descarga.component.html',
  styleUrls: [
    './sgc-capitulos-panel.component.scss',
    './sgc-formatos-descarga.component.scss'
  ]
})
export class SgcFormatosDescargaComponent implements OnInit, OnDestroy {
  readonly categorias = SGC_FORMATOS_CATEGORIAS;
  documentos: SgcFormatoDescarga[] = SGC_FORMATOS_DESCARGA_CATALOG.map((d) => ({ ...d }));
  readonly etiquetaTipo = etiquetaTipoFormato;
  readonly iconoTipo = iconoTipoFormato;

  busqueda = '';
  filtroTipo: SgcFormatoTipo | 'todos' = 'todos';
  categoriaSeleccionada: SgcFormatoCategoria = SGC_FORMATOS_CATEGORIAS[0];
  documentosFiltrados: SgcFormatoDescarga[] = [];
  buscando = false;
  descargandoId: string | null = null;
  reemplazandoId: string | null = null;
  desactivandoId: string | null = null;
  eliminandoId: string | null = null;
  mostrarModalSubir = false;
  subiendoFormato = false;
  subirCodigo = '';
  subirNombre = '';
  subirCategoriaId = '';
  subirArchivo: File | null = null;
  subirError = '';
  subirArrastrando = false;
  mostrarVisor = false;
  visorCargando = false;
  visorError: string | null = null;
  documentoActivo: SgcFormatoDescarga | null = null;
  previewBlob: Blob | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Preparando vista previa…';
  visorLento = false;
  paginaDocs = 1;
  readonly DOCS_POR_PAGINA = 6;

  @ViewChild('inputReemplazo') inputReemplazo?: ElementRef<HTMLInputElement>;
  private docPendienteReemplazo: SgcFormatoDescarga | null = null;
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

  /** Solo root o Calidad (sergio56 / calidad — Ing. Sergio Luis Guzmán Vigueras). */
  get puedeReemplazarFormatos(): boolean {
    return this.auth.puedeGestionarPlantillasSgcCapitulos();
  }

  /** Solo administradores y root pueden subir formatos nuevos. */
  get puedeSubirFormatos(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  /** Administradores y root pueden desactivar formatos del listado. */
  get puedeDesactivarFormatos(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  /** Solo super administrador (root) puede borrar definitivamente cualquier formato. */
  get puedeEliminarFormatos(): boolean {
    return this.auth.esRoot();
  }

  puedeEliminarFormato(_doc: SgcFormatoDescarga): boolean {
    return this.puedeEliminarFormatos;
  }

  get puedeConfirmarSubida(): boolean {
    return !!(
      String(this.subirCodigo || '').trim()
      && String(this.subirNombre || '').trim()
      && String(this.subirCategoriaId || '').trim()
      && this.subirArchivo
      && !this.subiendoFormato
    );
  }

  get nombreArchivoFinalSubida(): string {
    if (!this.subirArchivo) return String(this.subirNombre || '').trim();
    const ext = this.extensionArchivoSubido;
    const base = String(this.subirNombre || '').trim();
    return ext ? `${base}${ext}` : base;
  }

  get extensionArchivoSubido(): string {
    const nombre = this.subirArchivo?.name || '';
    const idx = nombre.lastIndexOf('.');
    return idx > 0 ? nombre.slice(idx) : '';
  }

  get nombreDocumentoSubido(): string {
    return this.subirArchivo?.name || '';
  }

  get iconoArchivoSubido(): string {
    const ext = this.nombreDocumentoSubido.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xls' || ext === 'xlsx') return 'fas fa-file-excel';
    if (ext === 'ppt' || ext === 'pptx') return 'fas fa-file-powerpoint';
    if (ext === 'pdf') return 'fas fa-file-pdf';
    return 'fas fa-file-word';
  }

  get tipoArchivoSubido(): string {
    const ext = this.nombreDocumentoSubido.split('.').pop()?.toLowerCase() || '';
    if (ext === 'xls' || ext === 'xlsx') return 'Excel';
    if (ext === 'ppt' || ext === 'pptx') return 'PowerPoint';
    if (ext === 'pdf') return 'PDF';
    return 'Word';
  }

  get tamanoArchivoSubido(): string {
    const bytes = this.subirArchivo?.size || 0;
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.mostrarModalSubir && !this.subiendoFormato) {
      event.preventDefault();
      this.cerrarModalSubir();
      return;
    }
    if (this.mostrarVisor) {
      event.preventDefault();
      this.cerrarVisor();
    }
  }

  ngOnInit(): void {
    this.cargarActivosDrive();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const capId = params.get('cap') || params.get('cat');
      const cat = this.categorias.find(c => c.id === capId);
      if (cat && cat.id !== this.categoriaSeleccionada.id) {
        this.categoriaSeleccionada = cat;
        this.paginaDocs = 1;
      } else if (cat) {
        this.categoriaSeleccionada = cat;
      }
      const tipo = params.get('tipo');
      if (tipo === 'word' || tipo === 'excel' || tipo === 'pptx' || tipo === 'todos') {
        this.filtroTipo = tipo;
      }
      const codigo = String(params.get('codigo') || '').trim();
      this.codigoPendienteVisor = codigo || null;
      this.aplicarFiltro();
      this.intentarAbrirVisorDesdeBusqueda();
    });
  }

  /** Administradores y root pueden descargar el PDF desde el visor. */
  get puedeDescargarPdfVisor(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  ngOnDestroy(): void {
    this.visorSub?.unsubscribe();
    this.liberarPreviewBlob();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private cargarActivosDrive(): void {
    this.backend.obtenerFormatosDescargaActivosSgc().subscribe({
      next: (resp: any) => {
        const mapa = new Map<string, any>();
        const desactivados = new Set<string>();
        if (resp?.success && Array.isArray(resp.desactivados)) {
          for (const row of resp.desactivados) {
            const key = String(row?.catalog_key || row || '').trim();
            if (key) desactivados.add(key);
          }
        }
        if (resp?.success && Array.isArray(resp.activos)) {
          for (const row of resp.activos) {
            if (row?.catalog_key) mapa.set(String(row.catalog_key), row);
          }
        }
        this.documentos = SGC_FORMATOS_DESCARGA_CATALOG
          .filter((base) => !desactivados.has(base.id))
          .map((base) => {
          const act = mapa.get(base.id);
          if (!act) return { ...base, versionActual: 1, esSubido: false };
          return {
            ...base,
            driveFileId: act.drive_file_id_actual || base.driveFileId,
            nombreArchivo: act.nombre_archivo || base.nombreArchivo,
            versionActual: Number(act.version_actual || 1),
            fechaUltimaActualizacion: act.fecha_actualizacion || null,
            actualizadoPorNombre: act.actualizado_por_nombre || null,
            esSubido: false
          };
        });
        if (resp?.success && Array.isArray(resp.subidos)) {
          for (const row of resp.subidos) {
            const doc = this.mapearFormatoSubido(row, mapa);
            if (!this.documentos.some((d) => d.id === doc.id)) {
              this.documentos.push(doc);
            }
          }
        }
        this.aplicarFiltro();
        this.intentarAbrirVisorDesdeBusqueda();
        if (this.mostrarVisor && this.documentoActivo) {
          const actualizado = this.documentos.find((d) => d.id === this.documentoActivo!.id);
          if (actualizado && actualizado.driveFileId !== this.documentoActivo.driveFileId) {
            void this.abrirVisor(actualizado);
          }
        }
      },
      error: () => {
        /* Catálogo estático sigue disponible sin overrides */
        this.intentarAbrirVisorDesdeBusqueda();
      }
    });
  }

  private mapearFormatoSubido(row: any, mapaActivos: Map<string, any>): SgcFormatoDescarga {
    const catalogKey = String(row?.catalog_key || '').trim();
    const act = mapaActivos.get(catalogKey);
    const ext = String(row?.nombre_archivo || '').split('.').pop()?.toLowerCase() || '';
    let tipo: SgcFormatoTipo = 'word';
    const tipoDb = String(row?.tipo_archivo || '').toLowerCase();
    if (tipoDb === 'excel' || tipoDb === 'word' || tipoDb === 'pptx' || tipoDb === 'pdf') {
      tipo = tipoDb as SgcFormatoTipo;
    } else if (ext === 'xls' || ext === 'xlsx') {
      tipo = 'excel';
    } else if (ext === 'ppt' || ext === 'pptx') {
      tipo = 'pptx';
    } else if (ext === 'pdf') {
      tipo = 'pdf';
    }
    return {
      id: catalogKey,
      codigo: String(row?.codigo || '').trim(),
      titulo: String(row?.titulo || '').trim(),
      driveFileId: String(act?.drive_file_id_actual || row?.drive_file_id || '').trim(),
      categoriaId: String(row?.categoria_id || 'capitulo-7').trim(),
      nombreArchivo: String(act?.nombre_archivo || row?.nombre_archivo || '').trim(),
      tipo,
      versionActual: Number(act?.version_actual || 1),
      fechaUltimaActualizacion: act?.fecha_actualizacion || row?.fecha_subida_mexico || null,
      actualizadoPorNombre: act?.actualizado_por_nombre || row?.subido_por_nombre || null,
      esSubido: true
    };
  }

  abrirModalSubir(): void {
    if (!this.puedeSubirFormatos) return;
    this.subirCodigo = '';
    this.subirNombre = '';
    this.subirCategoriaId = this.categoriaSeleccionada?.id || this.categorias[0]?.id || '';
    this.subirArchivo = null;
    this.subirError = '';
    this.subirArrastrando = false;
    this.mostrarModalSubir = true;
  }

  cerrarModalSubir(): void {
    if (this.subiendoFormato) return;
    this.mostrarModalSubir = false;
    this.subirError = '';
    this.subirArchivo = null;
    this.subirNombre = '';
    this.subirCodigo = '';
    this.subirArrastrando = false;
  }

  private nombreSinExtension(nombreArchivo: string): string {
    const base = String(nombreArchivo || '').trim();
    const idx = base.lastIndexOf('.');
    return idx > 0 ? base.slice(0, idx) : base;
  }

  /**
   * Detecta códigos al inicio del nombre: SGC-F-19, EIN-F-04, SGC-PO-01, SGC-I-00, EIN-MAN, etc.
   */
  private extraerCodigoDesdeNombre(nombreSinExt: string): string {
    const texto = String(nombreSinExt || '').trim();
    if (!texto) return '';

    const patronCatalogo = /^([A-Z]{2,5}-(?:F|PO|I|DI|MAN)(?:-\d{1,3})?)(?:\s|$|[\-–—])/i;
    const matchCatalogo = texto.match(patronCatalogo) || texto.match(/^([A-Z]{2,5}-(?:F|PO|I|DI|MAN)(?:-\d{1,3})?)/i);
    if (matchCatalogo?.[1]) {
      return matchCatalogo[1].toUpperCase();
    }

    const primerToken = (texto.split(/\s+/)[0] || '').trim();
    if (/^[A-Z]{2,5}-[A-Z]{2,3}(?:-\d{1,3})?$/i.test(primerToken)) {
      return primerToken.toUpperCase();
    }

    return '';
  }

  private autocompletarDatosDesdeArchivo(file: File): void {
    const sinExt = this.nombreSinExtension(file.name);
    this.subirNombre = sinExt;
    this.subirCodigo = this.extraerCodigoDesdeNombre(sinExt);
  }

  private buscarFormatoPorCodigo(codigo: string): SgcFormatoDescarga | null {
    const normalizado = String(codigo || '').trim().toLowerCase();
    if (!normalizado) return null;
    return this.documentos.find((d) => d.codigo.trim().toLowerCase() === normalizado) || null;
  }

  private mensajeCodigoDuplicado(doc: SgcFormatoDescarga): string {
    return `Ya existe un formato con el código ${doc.codigo} (${doc.titulo}). Cambia el código para poder subir este archivo.`;
  }

  private validarArchivoSubida(file: File): string | null {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const okExt = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
    if (!okExt) return 'Solo se permiten Word, Excel, PowerPoint o PDF.';
    const MAX_SIZE = 40 * 1024 * 1024;
    if (file.size > MAX_SIZE) return 'El archivo no puede superar 40 MB.';
    return null;
  }

  private asignarArchivoSubida(file: File | null, input?: HTMLInputElement): void {
    this.subirError = '';
    if (!file) {
      this.subirArchivo = null;
      return;
    }
    const error = this.validarArchivoSubida(file);
    if (error) {
      this.subirArchivo = null;
      this.subirNombre = '';
      this.subirCodigo = '';
      this.subirError = error;
      if (input) input.value = '';
    } else {
      this.subirArchivo = file;
      this.autocompletarDatosDesdeArchivo(file);
    }
  }

  onArchivoSubidaSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.asignarArchivoSubida(input.files?.[0] || null, input);
  }

  onDragOverSubida(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.subiendoFormato) this.subirArrastrando = true;
  }

  onDragLeaveSubida(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.subirArrastrando = false;
  }

  onDropSubida(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.subirArrastrando = false;
    if (this.subiendoFormato) return;
    const file = event.dataTransfer?.files?.[0] || null;
    this.asignarArchivoSubida(file);
  }

  quitarArchivoSubida(input?: HTMLInputElement): void {
    this.subirArchivo = null;
    this.subirNombre = '';
    this.subirCodigo = '';
    this.subirError = '';
    if (input) input.value = '';
  }

  confirmarSubidaFormato(): void {
    if (!this.puedeConfirmarSubida) return;

    const codigo = String(this.subirCodigo || '').trim();
    const duplicado = this.buscarFormatoPorCodigo(codigo);
    if (duplicado) {
      this.subirError = this.mensajeCodigoDuplicado(duplicado);
      void Swal.fire({
        icon: 'warning',
        title: 'Código ya registrado',
        text: this.subirError,
        confirmButtonColor: '#0f766e'
      });
      return;
    }

    const nombreFinal = this.nombreArchivoFinalSubida;
    const formData = new FormData();
    formData.append('archivo', this.subirArchivo!);
    formData.append('codigo', String(this.subirCodigo || '').trim());
    formData.append('titulo', nombreFinal);
    formData.append('nombre_archivo', nombreFinal);
    formData.append('categoria_id', String(this.subirCategoriaId || '').trim());

    this.subiendoFormato = true;
    this.subirError = '';

    this.backend.subirFormatoDescargaSgc(formData).subscribe({
      next: (resp: any) => {
        this.subiendoFormato = false;
        if (resp?.success) {
          const doc = this.mapearFormatoSubido(resp, new Map([[resp.catalog_key, resp]]));
          if (!this.documentos.some((d) => d.id === doc.id)) {
            this.documentos.push(doc);
          }
          const cat = this.categorias.find((c) => c.id === doc.categoriaId);
          if (cat) {
            this.categoriaSeleccionada = cat;
          }
          this.aplicarFiltro();
          this.cerrarModalSubir();
          Swal.fire({
            icon: 'success',
            title: 'Formato subido',
            html: `<p>${resp.message || 'Listo.'}</p>
                   <p class="small text-muted mb-0">Por: <strong>${resp.subido_por || '—'}</strong><br>
                   Fecha/hora (México): <strong>${resp.fecha_subida_mexico || '—'}</strong></p>`,
            confirmButtonColor: '#0f766e'
          });
        } else {
          this.subirError = resp?.message || 'No se pudo subir el formato.';
        }
      },
      error: (err) => {
        this.subiendoFormato = false;
        this.subirError = err?.error?.message || err?.message || 'Error al subir el archivo';
        if (err?.status === 409 || err?.error?.message?.includes('Ya existe un formato')) {
          void Swal.fire({
            icon: 'warning',
            title: 'Código ya registrado',
            text: this.subirError,
            confirmButtonColor: '#0f766e'
          });
        }
      }
    });
  }

  seleccionarCategoria(cat: SgcFormatoCategoria): void {
    this.categoriaSeleccionada = cat;
    this.busqueda = '';
    this.paginaDocs = 1;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cap: cat.id, cat: null, codigo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.aplicarFiltro();
  }

  esCategoriaActiva(cat: SgcFormatoCategoria): boolean {
    return this.categoriaSeleccionada.id === cat.id && !this.buscando;
  }

  setFiltroTipo(tipo: SgcFormatoTipo | 'todos'): void {
    this.filtroTipo = tipo;
    this.paginaDocs = 1;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tipo: tipo === 'todos' ? null : tipo },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.aplicarFiltro();
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    this.buscando = q.length > 0;
    let list = this.documentos.slice();
    if (!this.buscando) {
      list = list.filter(d => d.categoriaId === this.categoriaSeleccionada.id);
    }
    if (this.filtroTipo !== 'todos') {
      list = list.filter(d => d.tipo === this.filtroTipo);
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

  numeroCategoria(catId: string): number {
    return this.categorias.find(c => c.id === catId)?.numero ?? 0;
  }

  get documentosPaginados(): SgcFormatoDescarga[] {
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

  trackByCategoria(_i: number, cat: SgcFormatoCategoria): string {
    return cat.id;
  }

  trackById(_i: number, doc: SgcFormatoDescarga): string {
    return doc.id;
  }

  async desactivarFormato(doc: SgcFormatoDescarga, event?: Event): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.puedeDesactivarFormatos || this.desactivandoId || this.eliminandoId) return;

    const confirm = await Swal.fire({
      title: '¿Desactivar formato?',
      html: `<p>Se ocultará <strong>${doc.codigo}</strong> — ${doc.titulo} del listado.</p>
             <p class="text-muted small mb-0">${doc.esSubido
               ? 'El archivo permanece en Drive; un super administrador puede eliminarlo definitivamente.'
               : 'El archivo en Drive no se borra; solo deja de mostrarse en Formatos oficiales.'}</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#b45309',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;

    this.desactivandoId = doc.id;
    this.backend.desactivarFormatoDescargaSgc(doc.id, doc.codigo).subscribe({
      next: (resp: any) => {
        this.desactivandoId = null;
        if (resp?.success) {
          this.documentos = this.documentos.filter((d) => d.id !== doc.id);
          if (this.documentoActivo?.id === doc.id) {
            this.cerrarVisor();
          }
          this.aplicarFiltro();
          Swal.fire({
            icon: 'success',
            title: 'Formato desactivado',
            text: resp.message || 'Ya no aparecerá en el listado.',
            confirmButtonColor: '#0f766e'
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo desactivar',
            text: resp?.message || 'Error desconocido',
            confirmButtonColor: '#0f766e'
          });
        }
      },
      error: (err) => {
        this.desactivandoId = null;
        Swal.fire({
          icon: 'error',
          title: 'No se pudo desactivar',
          text: err?.error?.message || err?.message || 'Error al desactivar el formato',
          confirmButtonColor: '#0f766e'
        });
      }
    });
  }

  async eliminarFormato(doc: SgcFormatoDescarga, event?: Event): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.puedeEliminarFormato(doc) || this.eliminandoId || this.desactivandoId) return;

    const confirm = await Swal.fire({
      title: '¿Eliminar definitivamente?',
      html: `<p>Se borrará <strong>${doc.codigo}</strong> — ${doc.titulo}.</p>
             <p class="text-danger small mb-0"><strong>Esta acción no se puede deshacer.</strong>
             Se eliminará del listado y se borrarán los archivos asociados en Drive.</p>`,
      icon: 'error',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;

    this.eliminandoId = doc.id;
    this.backend.eliminarFormatoDescargaSgc(doc.id, doc.codigo, doc.driveFileId).subscribe({
      next: (resp: any) => {
        this.eliminandoId = null;
        if (resp?.success) {
          this.documentos = this.documentos.filter((d) => d.id !== doc.id);
          if (this.documentoActivo?.id === doc.id) {
            this.cerrarVisor();
          }
          this.aplicarFiltro();
          Swal.fire({
            icon: 'success',
            title: 'Formato eliminado',
            text: resp.message || 'El formato fue borrado definitivamente.',
            confirmButtonColor: '#0f766e'
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'No se pudo eliminar',
            text: resp?.message || 'Error desconocido',
            confirmButtonColor: '#0f766e'
          });
        }
      },
      error: (err) => {
        this.eliminandoId = null;
        Swal.fire({
          icon: 'error',
          title: 'No se pudo eliminar',
          text: err?.error?.message || err?.message || 'Error al eliminar el formato',
          confirmButtonColor: '#0f766e'
        });
      }
    });
  }

  solicitarReemplazo(doc: SgcFormatoDescarga, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.puedeReemplazarFormatos || this.reemplazandoId) return;
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

    const confirm = await Swal.fire({
      title: '¿Reemplazar formato?',
      html: `<p>Se subirá la nueva versión de <strong>${doc.codigo}</strong> — ${doc.titulo}.</p>
             <p class="text-muted small mb-0">El archivo actual se conservará en Drive con sufijo <strong>_0N</strong> (p. ej. _02, _03). Quedará registro de quién y cuándo (horario México).</p>`,
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
    formData.append('catalog_key', doc.id);
    formData.append('codigo', doc.codigo);
    formData.append('titulo', doc.titulo);
    formData.append('drive_file_id', doc.driveFileId);
    formData.append('nombre_archivo', doc.nombreArchivo);

    this.reemplazandoId = doc.id;
    Swal.fire({
      title: 'Actualizando formato…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    this.backend.reemplazarFormatoDescargaSgc(formData).subscribe({
      next: (resp: any) => {
        this.reemplazandoId = null;
        input.value = '';
        if (resp?.success) {
          const idx = this.documentos.findIndex(d => d.id === doc.id);
          if (idx >= 0) {
            this.documentos[idx] = {
              ...this.documentos[idx],
              driveFileId: resp.drive_file_id_actual || this.documentos[idx].driveFileId,
              nombreArchivo: resp.nombre_archivo || this.documentos[idx].nombreArchivo,
              versionActual: Number(resp.version_actual || this.documentos[idx].versionActual || 1),
              fechaUltimaActualizacion: resp.fecha_hora_mexico || null,
              actualizadoPorNombre: resp.actualizado_por || null
            };
            this.aplicarFiltro();
          }
          Swal.fire({
            icon: 'success',
            title: 'Formato actualizado',
            html: `<p>${resp.message || 'Listo.'}</p>
                   <p class="small text-muted mb-0">Por: <strong>${resp.actualizado_por || '—'}</strong><br>
                   Fecha/hora (México): <strong>${resp.fecha_hora_mexico || '—'}</strong></p>`,
            confirmButtonColor: '#0f766e'
          });
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

  async abrirVisor(doc: SgcFormatoDescarga): Promise<void> {
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
      this.backend.imprimirArchivoDriveComoPDFEventos(
        doc.driveFileId,
        doc.nombreArchivo,
        doc.tipo === 'excel'
      ),
      'Convirtiendo el formato a PDF en el servidor…'
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

  /** Abre el visor si el buscador global llegó con `?codigo=`. */
  private intentarAbrirVisorDesdeBusqueda(): void {
    const codigo = String(this.codigoPendienteVisor || '').trim();
    if (!codigo) {
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
    this.visorError = mensaje || 'No se pudo preparar la vista previa. Puedes descargar el formato.';
  }

  descargarPdfVisor(): void {
    if (!this.puedeDescargarPdfVisor || !this.documentoActivo) {
      return;
    }
    const base = (this.documentoActivo.nombreArchivo || this.documentoActivo.codigo).replace(/\.[^.]+$/, '');
    const nombre = `${base}.pdf`;
    if (this.previewBlob) {
      const url = URL.createObjectURL(this.previewBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  async descargar(doc: SgcFormatoDescarga, event?: Event): Promise<void> {
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
        throw new Error(await this.extraerMensajeJsonBlob(blob, 'No se pudo descargar el formato.'));
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
        text: await this.mensajeErrorBlob(err, 'No se pudo descargar el formato desde Drive.'),
        confirmButtonColor: '#15a596'
      });
    } finally {
      this.descargandoId = null;
    }
  }
}
