import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Location } from '@angular/common';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';

type Jurisdiccion = 'General' | 'Municipal' | 'Estatal';

interface CatalogoDocumento {
  id: string;
  documento_id?: number;
  nombre: string;
  jurisdiccion: Jurisdiccion;
  fechaActualizacion: string | null;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  drive_download_link?: string | null;
  mime_type?: string | null;
  hoja_nombre?: string | null;
  archivo_maestro_nombre?: string | null;
  es_hoja_workbook?: boolean;
  subdocumentos?: CatalogoDocumento[];
}

interface CatalogoCategoria {
  id: string;
  nombre: string;
  archivo_maestro?: ArchivoMaestroPipc | null;
  documentos: CatalogoDocumento[];
}

interface ArchivoMaestroPipc {
  nombre: string;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  mime_type?: string | null;
  fechaActualizacion: string | null;
  total_hojas: number;
  es_consolidado?: boolean;
}

interface CatalogoFila {
  id: string;
  documento_id?: number;
  nombre: string;
  jurisdiccion: Jurisdiccion;
  tieneSubdocumentos: boolean;
  esHojaWorkbook: boolean;
  hojaNombre: string | null;
  archivoMaestroNombre: string | null;
  fechaActualizacion: string | null;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  drive_download_link?: string | null;
  mime_type?: string | null;
}

@Component({
  selector: 'app-proteccion-civil-catalogo',
  templateUrl: './proteccion-civil-catalogo.component.html',
  styleUrls: ['./proteccion-civil-catalogo.component.scss']
})
export class ProteccionCivilCatalogoComponent implements OnInit {
  readonly acceptedPcFileTypes: string = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.xls,.xlsx,.ppt,.pptx';
  readonly acceptedCatalogoNuevoDocumentoTypes: string = '.xlsx';
  private readonly allowedPcMimeTypes: string[] = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];
  private readonly allowedPcExtensions: string[] = [
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.xls', '.xlsx', '.ppt', '.pptx'
  ];

  categorias: CatalogoCategoria[] = [];
  categoriaActivaId: string = '';
  categoriaSeleccionadaParaSubidaId: string = '';
  nombreNuevoDocumentoPendiente: string = '';
  mostrarModalNuevoDocumento = false;
  nuevoDocumentoCategoriaId = '';
  nuevoDocumentoNombre = '';
  nuevoDocumentoArchivo: File | null = null;
  nuevoDocumentoError = '';
  textoBusqueda: string = '';
  menuAbiertoId: string | null = null;
  menuDocActual: CatalogoFila | null = null;
  menuPosition = { top: 0, left: 0 };
  menuCategoriaAbiertoId: string | null = null;
  menuCategoriaActual: CatalogoCategoria | null = null;
  menuCategoriaPosition = { top: 0, left: 0 };
  cargandoCatalogo: boolean = false;

  // Editor integrado (Google Sheets / Drive)
  editorIntegradoVisible = false;
  editorIntegradoUrl: SafeResourceUrl | null = null;
  editorIntegradoUrlRaw = '';
  editorIntegradoTitulo = '';
  editorIntegradoSubtitulo = '';
  cargandoEditor = false;
  filaEditorActual: CatalogoFila | null = null;

  // Reemplazo de archivo
  filaParaReemplazar: CatalogoFila | null = null;
  reemplazandoDocumento: boolean = false;
  subiendoNuevoDocumento: boolean = false;
  gestionandoCategorias: boolean = false;
  esRootUser = false;

  @ViewChild('fileInputReemplazar') fileInputReemplazar!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputNuevoDocumento') fileInputNuevoDocumento!: ElementRef<HTMLInputElement>;

  constructor(
    private location: Location,
    private backendService: BackendServices,
    private sanitizer: DomSanitizer,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.esRootUser = this.authService.esRoot();
    this.cargarCatalogo();
  }

  get categoriaActiva(): CatalogoCategoria | null {
    return this.categorias.find((categoria) => categoria.id === this.categoriaActivaId) || null;
  }

  get esCategoriaPipc(): boolean {
    return this.categoriaActivaId === 'pipc';
  }

  get archivoMaestroPipc(): ArchivoMaestroPipc | null {
    return this.categoriaActiva?.archivo_maestro || null;
  }

  get hojasPipc(): CatalogoFila[] {
    if (!this.esCategoriaPipc) {
      return [];
    }

    const hojas = this.filasCategoriaActiva.filter((fila) => fila.esHojaWorkbook);
    return hojas.length ? hojas : this.filasCategoriaActiva;
  }

  get filasCategoriaActiva(): CatalogoFila[] {
    if (!this.categoriaActiva) {
      return [];
    }

    const todasLasFilas = this.aplanarDocumentos(this.categoriaActiva.documentos);
    const filtro = this.textoBusqueda.trim().toLowerCase();

    if (!filtro) {
      return todasLasFilas;
    }

    return todasLasFilas.filter((fila) =>
      fila.nombre.toLowerCase().includes(filtro) ||
      (fila.hojaNombre || '').toLowerCase().includes(filtro) ||
      (fila.archivoMaestroNombre || '').toLowerCase().includes(filtro) ||
      fila.jurisdiccion.toLowerCase().includes(filtro) ||
      (fila.fechaActualizacion || '').toLowerCase().includes(filtro)
    );
  }

  setCategoriaActiva(categoriaId: string): void {
    this.categoriaActivaId = categoriaId;
    this.textoBusqueda = '';
  }

  contarDocumentosCategoria(categoria: CatalogoCategoria): number {
    return this.aplanarDocumentos(categoria.documentos).length;
  }

  limpiarBusqueda(): void {
    this.textoBusqueda = '';
  }

  private esArchivoPermitidoPC(file: File): boolean {
    const nombre = String(file?.name || '').toLowerCase();
    const extension = nombre.includes('.') ? `.${nombre.split('.').pop()}` : '';
    const mime = String(file?.type || '').toLowerCase();
    return this.allowedPcExtensions.includes(extension) || this.allowedPcMimeTypes.includes(mime);
  }

  private esArchivoExcelNuevoCatalogo(file: File): boolean {
    const nombre = String(file?.name || '').toLowerCase();
    const extension = nombre.includes('.') ? `.${nombre.split('.').pop()}` : '';
    const mime = String(file?.type || '').toLowerCase();
    if (extension !== '.xlsx') return false;

    return mime === ''
      || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mime === 'application/vnd.ms-excel'
      || mime === 'application/octet-stream';
  }

  abrirVisorMaestro(): void {
    const maestro = this.archivoMaestroPipc;
    if (!maestro?.drive_file_id) {
      Swal.fire('Sin archivo', 'Aún no hay archivo maestro PIPC en Drive.', 'info');
      return;
    }

    this.abrirVisor({
      id: 'maestro-pipc',
      nombre: maestro.nombre,
      jurisdiccion: 'General',
      tieneSubdocumentos: true,
      esHojaWorkbook: false,
      hojaNombre: null,
      archivoMaestroNombre: maestro.nombre,
      fechaActualizacion: maestro.fechaActualizacion,
      drive_file_id: maestro.drive_file_id,
      drive_web_view_link: maestro.drive_web_view_link || null,
      mime_type: maestro.mime_type || null
    });
  }

  abrirEnDriveMaestro(): void {
    const maestro = this.archivoMaestroPipc;
    if (!maestro) {
      return;
    }

    this.abrirEnDrive({
      id: 'maestro-pipc',
      nombre: maestro.nombre,
      jurisdiccion: 'General',
      tieneSubdocumentos: true,
      esHojaWorkbook: false,
      hojaNombre: null,
      archivoMaestroNombre: maestro.nombre,
      fechaActualizacion: maestro.fechaActualizacion,
      drive_file_id: maestro.drive_file_id,
      drive_web_view_link: maestro.drive_web_view_link || null,
      mime_type: maestro.mime_type || null
    });
  }

  descargarMaestro(): void {
    const primeraHoja = this.hojasPipc[0];
    if (!primeraHoja?.documento_id) {
      Swal.fire('Sin archivo', 'No se puede descargar el archivo maestro.', 'info');
      return;
    }
    this.descargarDocumento(primeraHoja);
  }

  editarMaestroEnSheets(): void {
    const primeraHoja = this.hojasPipc.find((hoja) => hoja.documento_id && hoja.drive_file_id);
    if (primeraHoja) {
      this.abrirEditorIntegrado(primeraHoja);
      return;
    }

    const maestro = this.archivoMaestroPipc;
    if (!maestro?.drive_file_id) {
      Swal.fire('Sin archivo', 'No se encontró el identificador del archivo en Drive.', 'error');
      return;
    }

    this.abrirEditorIntegrado({
      id: 'maestro-pipc',
      nombre: maestro.nombre,
      jurisdiccion: 'General',
      tieneSubdocumentos: true,
      esHojaWorkbook: false,
      hojaNombre: null,
      archivoMaestroNombre: maestro.nombre,
      fechaActualizacion: maestro.fechaActualizacion,
      drive_file_id: maestro.drive_file_id,
      drive_web_view_link: maestro.drive_web_view_link || null,
      mime_type: maestro.mime_type || null
    });
  }

  ubicacionDesdeHoja(fila: CatalogoFila): string {
    const nombre = String(fila.hojaNombre || fila.nombre || '').replace(/^PIPC\s+/i, '').trim();
    return nombre || fila.nombre;
  }

  editarHoja(fila: CatalogoFila): void {
    this.abrirEditorIntegrado(fila);
  }

  abrirEditorIntegradoHoja(fila: CatalogoFila): void {
    this.abrirEditorIntegrado(fila);
  }

  sincronizarAsignacionesHoja(fila: CatalogoFila): void {
    if (!fila.documento_id) {
      Swal.fire('Error', 'Este documento no tiene ID válido.', 'error');
      return;
    }

    Swal.fire({
      title: '¿Sincronizar asignaciones?',
      html: 'Se actualizará el tipo de entrada (texto o archivo) en requisitos <strong>pendientes</strong> según el catálogo.<br><small class="text-muted">Los documentos ya subidos no se modifican.</small>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Sincronizar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      Swal.fire({
        title: 'Sincronizando...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      this.backendService.sincronizarAsignacionesDesdeCatalogoPC(fila.documento_id!).subscribe({
        next: (response: any) => {
          Swal.fire('Listo', response?.message || 'Sincronización completada.', 'success');
        },
        error: (err: any) => {
          const mensaje = err?.error?.message || 'No se pudo sincronizar las asignaciones.';
          Swal.fire('Error', mensaje, 'error');
        }
      });
    });
  }

  abrirVisor(fila: CatalogoFila): void {
    this.abrirEditorIntegrado(fila);
  }

  abrirEditorIntegrado(fila: CatalogoFila, soloVista = false): void {
    if (!fila.drive_file_id) {
      Swal.fire('Sin archivo', 'Este documento aún no tiene archivo en Drive.', 'info');
      return;
    }

    this.filaEditorActual = fila;
    this.editorIntegradoTitulo = 'Editor integrado (Google Sheets)';
    this.editorIntegradoSubtitulo = fila.esHojaWorkbook
      ? `${fila.archivoMaestroNombre || 'Archivo PIPC'} · ${fila.hojaNombre || fila.nombre}`
      : (fila.hojaNombre || fila.nombre);
    this.cargandoEditor = true;
    this.editorIntegradoVisible = true;
    this.editorIntegradoUrl = null;
    this.editorIntegradoUrlRaw = '';
    this.bloquearScrollPaginaEditor();

    const modo = soloVista && !this.esDocumentoExcel(fila) ? 'preview' : 'edit';

    if (fila.documento_id) {
      this.backendService.obtenerUrlEditorCatalogoPC(fila.documento_id, modo).subscribe({
        next: (response: any) => {
          if (!response?.success || !response.url) {
            this.cargandoEditor = false;
            this.editorIntegradoVisible = false;
            this.liberarScrollPaginaEditor();
            Swal.fire('Sin vista', response?.message || 'No se pudo abrir el editor.', 'info');
            return;
          }
          this.editorIntegradoTitulo = modo === 'preview'
            ? 'Vista previa del documento'
            : 'Editor integrado (Google Sheets)';
          if (response.titulo) {
            this.editorIntegradoSubtitulo = response.titulo;
          }
          this.editorIntegradoUrlRaw = response.url;
          this.editorIntegradoUrl = null;
          setTimeout(() => {
            this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(response.url);
          }, 0);
        },
        error: (err: any) => {
          this.cargandoEditor = false;
          this.editorIntegradoVisible = false;
          this.liberarScrollPaginaEditor();
          const mensaje = err?.error?.message || 'No se pudo abrir el editor integrado.';
          Swal.fire('Error', mensaje, 'error');
        }
      });
      return;
    }

    const url = this.construirUrlEditorDrive(fila, modo === 'preview' ? 'preview' : 'edit');
    if (!url) {
      this.cargandoEditor = false;
      this.editorIntegradoVisible = false;
      this.liberarScrollPaginaEditor();
      Swal.fire('Sin vista', 'No se pudo abrir el editor para este archivo.', 'info');
      return;
    }
    this.editorIntegradoUrlRaw = url;
    this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private construirUrlEditorDrive(fila: CatalogoFila, modo: 'edit' | 'preview'): string {
    const id = String(fila.drive_file_id || '').trim();
    if (!id) {
      return '';
    }

    const mime = String(fila.mime_type || '').toLowerCase();
    if (modo === 'edit') {
      if (mime === 'application/vnd.google-apps.document') {
        return `https://docs.google.com/document/d/${id}/edit`;
      }
      if (mime === 'application/vnd.google-apps.presentation') {
        return `https://docs.google.com/presentation/d/${id}/edit`;
      }
      return `https://docs.google.com/spreadsheets/d/${id}/edit`;
    }

    if (mime === 'application/vnd.google-apps.spreadsheet') {
      return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    }
    if (mime === 'application/vnd.google-apps.document') {
      return `https://docs.google.com/document/d/${id}/preview`;
    }
    if (mime === 'application/vnd.google-apps.presentation') {
      return `https://docs.google.com/presentation/d/${id}/preview`;
    }
    return `https://drive.google.com/file/d/${id}/preview`;
  }

  abrirEditorEnNuevaPestana(): void {
    if (!this.editorIntegradoUrlRaw) {
      return;
    }
    window.open(this.editorIntegradoUrlRaw, '_blank', 'noopener');
  }

  cerrarEditorIntegrado(): void {
    this.editorIntegradoVisible = false;
    this.editorIntegradoUrl = null;
    this.editorIntegradoUrlRaw = '';
    this.editorIntegradoTitulo = '';
    this.editorIntegradoSubtitulo = '';
    this.filaEditorActual = null;
    this.cargandoEditor = false;
    this.liberarScrollPaginaEditor();
    this.cargarCatalogo(undefined, false);
  }

  onEditorIframeLoad(): void {
    this.cargandoEditor = false;
  }

  @HostListener('document:keydown.escape')
  onEscapeCerrarEditor(): void {
    if (!this.editorIntegradoVisible) {
      return;
    }
    this.cerrarEditorIntegrado();
  }

  private bloquearScrollPaginaEditor(): void {
    document.body.style.overflow = 'hidden';
  }

  private liberarScrollPaginaEditor(): void {
    document.body.style.overflow = '';
  }

  private esDocumentoExcel(fila: CatalogoFila | null): boolean {
    if (!fila) return false;
    const mime = String(fila.mime_type || '').toLowerCase();
    const nombre = String(fila.nombre || '').toLowerCase();

    return mime.includes('spreadsheet') || mime.includes('ms-excel') || /\.xlsx?$/.test(nombre);
  }

  descargarEditorActual(): void {
    if (!this.filaEditorActual) {
      return;
    }
    this.descargarDocumento(this.filaEditorActual);
  }

  volver(): void {
    this.location.back();
  }

  cargarCatalogo(categoriaPreferidaId?: string, mostrarLoader: boolean = true): void {
    this.cargandoCatalogo = true;

    this.backendService.obtenerCatalogoProteccionCivil().subscribe(
      (response: any) => {
        const categoriaPrevia = categoriaPreferidaId || this.categoriaActivaId;
        if (response?.success && Array.isArray(response.categorias)) {
          this.categorias = response.categorias.map((cat: any) => ({
            id: String(cat.id || cat.slug || ''),
            nombre: String(cat.nombre || ''),
            archivo_maestro: cat.archivo_maestro || null,
            documentos: (cat.documentos || []).map((doc: any) => ({
              id: String(doc.id || doc.documento_id),
              documento_id: Number(doc.documento_id || 0),
              nombre: String(doc.nombre || ''),
              jurisdiccion: (doc.jurisdiccion || 'General') as Jurisdiccion,
              fechaActualizacion: doc.fechaActualizacion || null,
              drive_file_id: doc.drive_file_id || null,
              drive_web_view_link: doc.drive_web_view_link || null,
              drive_download_link: doc.drive_download_link || null,
              mime_type: doc.mime_type || null,
              hoja_nombre: doc.hoja_nombre || null,
              archivo_maestro_nombre: doc.archivo_maestro_nombre || null,
              es_hoja_workbook: !!doc.es_hoja_workbook,
              subdocumentos: []
            }))
          })).map((categoria) => {
            if (categoria.id !== 'pipc') {
              return categoria;
            }
            const hojas = categoria.documentos.filter((doc) => doc.es_hoja_workbook || doc.hoja_nombre);
            return hojas.length ? { ...categoria, documentos: hojas } : categoria;
          });
        } else {
          this.categorias = this.construirCatalogoVacio();
        }

        const existeCategoriaPrevia = this.categorias.some((c) => c.id === categoriaPrevia);
        this.categoriaActivaId = existeCategoriaPrevia ? categoriaPrevia : (this.categorias[0]?.id || '');
        this.cargandoCatalogo = false;
      },
      (error) => {
        console.error('Error al cargar catálogo de Protección Civil:', error);
        this.categorias = this.construirCatalogoVacio();
        this.categoriaActivaId = this.categorias[0]?.id || '';
        this.cargandoCatalogo = false;
      }
    );
  }

  verEditarDocumento(fila: CatalogoFila): void {
    this.reemplazarDocumento(fila);
  }

  abrirEnDrive(fila: CatalogoFila): void {
    const urlDrive = fila.drive_web_view_link || (fila.drive_file_id ? `https://drive.google.com/file/d/${fila.drive_file_id}/view` : '');
    if (!urlDrive) {
      Swal.fire('Sin archivo', 'Este documento aún no tiene archivo en Drive.', 'info');
      return;
    }
    window.open(urlDrive, '_blank', 'noopener');
  }

  reemplazarDocumento(fila: CatalogoFila): void {
    if (!fila.documento_id) {
      Swal.fire('Error', 'Este documento no tiene ID válido.', 'error');
      return;
    }
    this.filaParaReemplazar = fila;
    this.fileInputReemplazar.nativeElement.value = '';
    this.fileInputReemplazar.nativeElement.click();
  }

  get esNuevoDocumentoPipc(): boolean {
    return this.nuevoDocumentoCategoriaId === 'pipc';
  }

  get puedeConfirmarNuevoDocumento(): boolean {
    const nombreOk = !!String(this.nuevoDocumentoNombre || '').trim();
    const categoriaOk = !!this.nuevoDocumentoCategoriaId;
    if (!nombreOk || !categoriaOk || this.subiendoNuevoDocumento) {
      return false;
    }
    if (this.esNuevoDocumentoPipc) {
      return true;
    }
    return !!this.nuevoDocumentoArchivo;
  }

  async iniciarSubidaNuevoDocumento(): Promise<void> {
    if (!this.categorias.length) {
      Swal.fire('Sin categorías', 'No hay categorías disponibles para subir documentos.', 'info');
      return;
    }

    this.nuevoDocumentoCategoriaId = this.categoriaActivaId || this.categorias[0].id;
    this.nuevoDocumentoNombre = '';
    this.nuevoDocumentoArchivo = null;
    this.nuevoDocumentoError = '';
    this.nombreNuevoDocumentoPendiente = '';
    this.mostrarModalNuevoDocumento = true;
  }

  cerrarModalNuevoDocumento(): void {
    if (this.subiendoNuevoDocumento) {
      return;
    }
    this.mostrarModalNuevoDocumento = false;
    this.nuevoDocumentoError = '';
    this.nuevoDocumentoArchivo = null;
    this.nuevoDocumentoNombre = '';
  }

  onCategoriaNuevoDocumentoChange(): void {
    this.nuevoDocumentoError = '';
    if (this.esNuevoDocumentoPipc) {
      this.nuevoDocumentoArchivo = null;
    }
  }

  onArchivoNuevoDocumentoModal(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.nuevoDocumentoError = '';

    if (!file) {
      this.nuevoDocumentoArchivo = null;
      return;
    }

    if (!this.esArchivoExcelNuevoCatalogo(file)) {
      this.nuevoDocumentoArchivo = null;
      this.nuevoDocumentoError = 'Solo se permiten archivos Excel .xlsx.';
      input.value = '';
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      this.nuevoDocumentoArchivo = null;
      this.nuevoDocumentoError = 'El archivo no puede superar 10 MB.';
      input.value = '';
      return;
    }

    this.nuevoDocumentoArchivo = file;
  }

  quitarArchivoNuevoDocumentoModal(): void {
    this.nuevoDocumentoArchivo = null;
    this.nuevoDocumentoError = '';
    if (this.fileInputNuevoDocumento?.nativeElement) {
      this.fileInputNuevoDocumento.nativeElement.value = '';
    }
  }

  confirmarModalNuevoDocumento(): void {
    const categoriaId = String(this.nuevoDocumentoCategoriaId || '').trim();
    const nombre = String(this.nuevoDocumentoNombre || '').trim();
    const categoria = this.categorias.find((cat) => cat.id === categoriaId);

    this.nuevoDocumentoError = '';

    if (!categoria) {
      this.nuevoDocumentoError = 'Selecciona una categoría válida.';
      return;
    }
    if (!nombre) {
      this.nuevoDocumentoError = 'Ingresa el nombre del archivo.';
      return;
    }

    if (categoriaId === 'pipc') {
      this.mostrarModalNuevoDocumento = false;
      this.doCrearFormatoDesdePlantilla(categoriaId, nombre);
      return;
    }

    if (!this.nuevoDocumentoArchivo) {
      this.nuevoDocumentoError = 'Selecciona un archivo Excel .xlsx.';
      return;
    }

    this.mostrarModalNuevoDocumento = false;
    this.doSubirNuevoDocumento(categoriaId, this.nuevoDocumentoArchivo, nombre);
  }

  onNuevoArchivoSeleccionado(event: Event): void {
    // Compatibilidad con input oculto legado (ya no se usa en el flujo principal).
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const categoriaId = this.categoriaSeleccionadaParaSubidaId;
    const categoria = this.categorias.find((cat) => cat.id === categoriaId);
    const nombrePreferido = String(this.nombreNuevoDocumentoPendiente || '').trim();

    if (!categoria) {
      Swal.fire('Categoría inválida', 'Primero selecciona una categoría válida.', 'warning');
      return;
    }

    if (!this.esArchivoExcelNuevoCatalogo(file)) {
      Swal.fire('Archivo no permitido', 'En "Subir nuevo documento" solo se permiten archivos Excel .xlsx.', 'error');
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      Swal.fire('Archivo muy grande', 'El archivo no puede superar 10 MB.', 'warning');
      return;
    }

    const nombreMostrar = nombrePreferido || file.name;

    Swal.fire({
      title: 'Subir nuevo documento',
      html: `¿Deseas subir <strong>${nombreMostrar}</strong> a la categoría <strong>${categoria.nombre}</strong>?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Sí, subir',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.doSubirNuevoDocumento(categoria.id, file, nombrePreferido);
      }
    });
  }

  doCrearFormatoDesdePlantilla(categoriaId: string, nombre: string): void {
    this.subiendoNuevoDocumento = true;
    Swal.fire({
      title: 'Creando formato...',
      text: 'Copiando plantilla en Google Drive y registrando en el catálogo.',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.backendService.crearDocumentoCatalogoDesdePlantillaPC({
      categoria_id: categoriaId,
      nombre
    }).subscribe({
      next: (response: any) => {
        this.subiendoNuevoDocumento = false;
        this.categoriaActivaId = categoriaId;
        const nombreCreado = response?.documento?.nombre || `PIPC ${nombre}`;
        Swal.fire('¡Creado!', `Se agregó <strong>${nombreCreado}</strong> al catálogo y a Drive.`, 'success');
        this.cargarCatalogo(categoriaId, false);
      },
      error: (err: any) => {
        this.subiendoNuevoDocumento = false;
        const mensaje = err?.error?.message || 'No se pudo crear el formato desde la plantilla.';
        Swal.fire('Error', mensaje, 'error');
      }
    });
  }

  doSubirNuevoDocumento(categoriaId: string, file: File, nombrePreferido = ''): void {
    this.subiendoNuevoDocumento = true;
    const formData = new FormData();
    formData.append('archivo', file);
    formData.append('categoria_id', categoriaId);
    if (nombrePreferido) {
      formData.append('nombre', nombrePreferido);
    }

    Swal.fire({
      title: 'Subiendo archivo...',
      text: 'Guardando documento en el sistema y en Google Drive.',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.backendService.subirDocumentoCatalogoPC(formData).subscribe({
      next: (_response: any) => {
        this.subiendoNuevoDocumento = false;
        this.categoriaActivaId = categoriaId;
        this.nombreNuevoDocumentoPendiente = '';
        Swal.fire('¡Subido!', 'El documento se subió correctamente al catálogo.', 'success');
        this.cargarCatalogo(categoriaId, false);
      },
      error: (err: any) => {
        this.subiendoNuevoDocumento = false;
        const mensaje = err?.error?.message || 'No se pudo subir el documento. Inténtalo de nuevo.';
        Swal.fire('Error', mensaje, 'error');
      }
    });
  }

  async agregarCategoria(): Promise<void> {
    if (!this.esRootUser) {
      Swal.fire('Sin permiso', 'Solo el superadministrador puede agregar categorías.', 'warning');
      return;
    }

    const resultado = await Swal.fire({
      title: 'Agregar categoría',
      input: 'text',
      inputLabel: 'Nombre de la categoría',
      inputPlaceholder: 'Ej. 4. Dictámenes especiales',
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#aaa',
      inputValidator: (value) => {
        if (!String(value || '').trim()) {
          return 'Ingresa un nombre de categoría.';
        }
        return null;
      }
    });

    if (!resultado.isConfirmed) return;

    const nombre = String(resultado.value || '').trim();
    if (!nombre) return;

    this.gestionandoCategorias = true;
    this.backendService.crearCategoriaCatalogoPC(nombre).subscribe({
      next: (response: any) => {
        this.gestionandoCategorias = false;
        const nuevaCategoriaId = String(response?.categoria?.slug || response?.categoria?.id || '');
        Swal.fire('Categoría creada', 'La categoría se creó correctamente.', 'success');
        this.cargarCatalogo(nuevaCategoriaId || undefined, false);
      },
      error: (err: any) => {
        this.gestionandoCategorias = false;
        const mensaje = err?.error?.message || 'No se pudo crear la categoría.';
        Swal.fire('Error', mensaje, 'error');
      }
    });
  }

  async cambiarNombreCategoria(categoria: CatalogoCategoria): Promise<void> {
    const resultado = await Swal.fire({
      title: 'Cambiar nombre de categoría',
      input: 'text',
      inputLabel: 'Nuevo nombre',
      inputPlaceholder: 'Ej. 2. Opinión Técnica',
      inputValue: categoria.nombre,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#aaa',
      inputValidator: (value) => {
        if (!String(value || '').trim()) {
          return 'Ingresa un nombre de categoría.';
        }
        return null;
      }
    });

    if (!resultado.isConfirmed) return;

    const nombre = String(resultado.value || '').trim();
    if (!nombre || nombre === categoria.nombre) return;

    this.gestionandoCategorias = true;
    this.backendService.actualizarCategoriaCatalogoPC(categoria.id, nombre).subscribe({
      next: () => {
        this.gestionandoCategorias = false;
        Swal.fire('Categoría actualizada', 'El nombre se cambió correctamente.', 'success');
        this.cargarCatalogo(categoria.id, false);
      },
      error: (err: any) => {
        this.gestionandoCategorias = false;
        const mensaje = err?.error?.message || 'No se pudo cambiar el nombre de la categoría.';
        Swal.fire('Error', mensaje, 'error');
      }
    });
  }

  quitarCategoria(categoria: CatalogoCategoria): void {
    const totalDocs = this.contarDocumentosCategoria(categoria);

    Swal.fire({
      title: 'Quitar categoría',
      html: `¿Deseas quitar la categoría <strong>${categoria.nombre}</strong>?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar',
      footer: totalDocs > 0 ? 'Esta categoría tiene documentos y no se podrá quitar hasta vaciarla.' : ''
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.gestionandoCategorias = true;
      this.backendService.eliminarCategoriaCatalogoPC(categoria.id).subscribe({
        next: () => {
          this.gestionandoCategorias = false;
          Swal.fire('Categoría quitada', 'La categoría fue quitada correctamente.', 'success');
          this.cargarCatalogo(undefined, false);
        },
        error: (err: any) => {
          this.gestionandoCategorias = false;
          const mensaje = err?.error?.message || 'No se pudo quitar la categoría.';
          Swal.fire('Error', mensaje, 'error');
        }
      });
    });
  }

  quitarCategoriaActiva(): void {
    if (!this.categoriaActiva) {
      Swal.fire('Sin categoría', 'Selecciona una categoría para quitar.', 'info');
      return;
    }
    this.quitarCategoria(this.categoriaActiva);
  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.filaParaReemplazar) return;

    if (!this.esArchivoPermitidoPC(file)) {
      Swal.fire('Archivo no permitido', 'Cámbialo por uno de los formatos aceptados: imágenes, PDF, XLS/XLSX o PowerPoint (PPT/PPTX).', 'error');
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      Swal.fire('Archivo muy grande', 'El archivo no puede superar 10 MB.', 'warning');
      return;
    }

    const fila = this.filaParaReemplazar;
    Swal.fire({
      title: 'Reemplazar archivo',
      html: `¿Deseas reemplazar <strong>${fila.nombre}</strong> con el archivo <em>${file.name}</em>?<br><small class="text-muted">Se conservará el mismo nombre en Google Drive y se actualizará la fecha.</small>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Sí, reemplazar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.doReemplazarDocumento(fila, file);
      }
    });
  }

  doReemplazarDocumento(fila: CatalogoFila, file: File): void {
    if (!fila.documento_id) return;
    this.reemplazandoDocumento = true;
    const formData = new FormData();
    formData.append('archivo', file);

    Swal.fire({
      title: 'Subiendo archivo...',
      text: 'Por favor espere mientras se actualiza el archivo en Google Drive.',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.backendService.reemplazarArchivoCatalogoPC(fila.documento_id, formData).subscribe({
      next: (_response: any) => {
        this.reemplazandoDocumento = false;
        Swal.fire('¡Reemplazado!', 'El archivo fue actualizado correctamente en Google Drive.', 'success');
        this.cargarCatalogo(undefined, false);
      },
      error: (_err: any) => {
        this.reemplazandoDocumento = false;
        Swal.fire('Error', 'No se pudo reemplazar el archivo. Inténtalo de nuevo.', 'error');
      }
    });
  }

  descargarDocumento(fila: CatalogoFila): void {
    if (!fila.documento_id) {
      Swal.fire('Sin archivo', 'No se puede descargar este documento.', 'info');
      return;
    }

    this.backendService.descargarArchivoCatalogoProteccionCivil(fila.documento_id).subscribe(
      (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = `${fila.nombre}`;
        enlace.click();
        window.URL.revokeObjectURL(url);
      },
      (error) => {
        console.error('Error al descargar documento de catálogo:', error);
        Swal.fire('Error', 'No se pudo descargar el documento.', 'error');
      }
    );
  }

  eliminarDocumento(fila: CatalogoFila): void {
    if (!fila.documento_id) {
      Swal.fire('Error', 'Este documento no tiene ID válido.', 'error');
      return;
    }
    Swal.fire({
      title: '¿Eliminar documento?',
      html: `Se eliminará <strong>${fila.nombre}</strong> del catálogo <u>y de Google Drive</u> permanentemente.<br><small class="text-muted">Esta acción no se puede deshacer.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;
      Swal.fire({
        title: 'Eliminando...',
        text: 'Borrando archivo de Google Drive y catálogo.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });
      this.backendService.eliminarDocumentoCatalogoPC(fila.documento_id!).subscribe({
        next: () => {
          Swal.fire('¡Eliminado!', `"${fila.nombre}" fue eliminado del catálogo y Google Drive.`, 'success');
          this.cargarCatalogo(undefined, false);
        },
        error: () => {
          Swal.fire('Error', 'No se pudo eliminar el documento. Inténtalo de nuevo.', 'error');
        }
      });
    });
  }

  toggleMenu(fila: CatalogoFila, event: MouseEvent): void {
    event.stopPropagation();
    this.menuCategoriaAbiertoId = null;
    this.menuCategoriaActual = null;

    if (this.menuAbiertoId === fila.id) {
      this.cerrarMenus();
      return;
    }

    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const menuHeight = 180;
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight;

    this.menuPosition = {
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: rect.right - menuWidth
    };

    if (this.menuPosition.left < 8) {
      this.menuPosition.left = 8;
    }

    this.menuDocActual = fila;
    this.menuAbiertoId = fila.id;
  }

  toggleCategoriaMenu(categoria: CatalogoCategoria, event: MouseEvent): void {
    event.stopPropagation();
    this.menuAbiertoId = null;
    this.menuDocActual = null;

    if (this.menuCategoriaAbiertoId === categoria.id) {
      this.menuCategoriaAbiertoId = null;
      this.menuCategoriaActual = null;
      return;
    }

    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const menuHeight = 128;
    const menuWidth = 210;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight;

    this.menuCategoriaPosition = {
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth)
    };

    this.menuCategoriaActual = categoria;
    this.menuCategoriaAbiertoId = categoria.id;
  }

  @HostListener('document:click')
  cerrarMenus(): void {
    this.menuAbiertoId = null;
    this.menuDocActual = null;
    this.menuCategoriaAbiertoId = null;
    this.menuCategoriaActual = null;
  }

  trackByCategoria(index: number, categoria: CatalogoCategoria): string {
    return categoria.id;
  }

  trackByFila(index: number, fila: CatalogoFila): string {
    return fila.id;
  }

  private aplanarDocumentos(documentos: CatalogoDocumento[]): CatalogoFila[] {
    return documentos.flatMap((documento) => {
      const fila: CatalogoFila = {
        id: documento.id,
        documento_id: documento.documento_id,
        nombre: documento.nombre,
        jurisdiccion: documento.jurisdiccion,
        tieneSubdocumentos: true,
        esHojaWorkbook: !!documento.es_hoja_workbook || !!documento.hoja_nombre,
        hojaNombre: documento.hoja_nombre || null,
        archivoMaestroNombre: documento.archivo_maestro_nombre || null,
        fechaActualizacion: documento.fechaActualizacion,
        drive_file_id: documento.drive_file_id || null,
        drive_web_view_link: documento.drive_web_view_link || null,
        drive_download_link: documento.drive_download_link || null,
        mime_type: documento.mime_type || null
      };

      const subfilas = documento.subdocumentos?.length ? this.aplanarDocumentos(documento.subdocumentos) : [];
      return [fila, ...subfilas];
    });
  }

  private construirCatalogoVacio(): CatalogoCategoria[] {
    return [
      {
        id: 'pipc',
        nombre: '1. Programa Interno de Protección Civil (PIPC)',
        documentos: []
      },
      {
        id: 'opinion_tecnica',
        nombre: '2. Opinión Técnica',
        documentos: []
      },
      {
        id: 'uso_suelo',
        nombre: '3. Uso de Suelo',
        documentos: []
      }
    ];
  }
}
