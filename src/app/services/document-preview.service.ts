import { Injectable } from '@angular/core';
import { HttpEvent } from '@angular/common/http';
import { Observable, Subject, Subscription } from 'rxjs';
import { BackendServices } from './backend.services';
import { PdfPreviewLoaderService } from './pdf-preview-loader.service';

export type DocumentPreviewTema = 'default' | 'rrhh' | 'pc';

export interface DocumentPreviewData {
  nombre: string;
  archivo_nombre?: string;
  archivo_url?: string;       // Drive file ID
  documento_id?: number;
  curso_id?: number;
  /** Tema visual del visor (p. ej. rosa RRHH). */
  tema?: DocumentPreviewTema;
  /** URL directa del iframe (Sheets preview, Drive preview, etc.). */
  previewUrl?: string;
  /** URL para abrir/editar en Google. */
  editorUrl?: string;
  /** Etiqueta del encabezado (reemplaza la automática por tipo). */
  etiqueta?: string;
  /**
   * Expediente RRHH: descarga el archivo por API autenticada
   * (evita fallos de iframe/blob y permisos de Drive embebido).
   */
  rrhhColaboradorFileId?: string;
  /** Fuerza el tipo si el nombre no trae extensión clara. */
  tipoHint?: 'pdf' | 'imagen' | 'office' | 'otro';
}

export interface PreviewState {
  visible: boolean;
  nombre: string;
  cargando: boolean;
  error: boolean;
  tipo: 'pdf' | 'imagen' | 'office' | 'otro';
  urlDocumento: string;
  urlGoogleViewer: string;
  urlGoogleEditor: string;
  driveFileId: string;
  documentoId: number;
  cursoId: number;
  tema: DocumentPreviewTema;
  etiqueta: string;
  /** Descarga autenticada RRHH colaboradores */
  rrhhColaboradorFileId: string;
  pdfBlob: Blob | null;
  progreso: number;
  etiquetaCarga: string;
  lento: boolean;
}

@Injectable({ providedIn: 'root' })
export class DocumentPreviewService {

  private stateSubject = new Subject<PreviewState>();
  state$ = this.stateSubject.asObservable();

  private currentState: PreviewState = this.getDefaultState();
  private cargaSub?: Subscription;

  constructor(
    private backendServices: BackendServices,
    private pdfPreviewLoader: PdfPreviewLoaderService
  ) {}

  private getDefaultState(): PreviewState {
    return {
      visible: false,
      nombre: '',
      cargando: false,
      error: false,
      tipo: 'otro',
      urlDocumento: '',
      urlGoogleViewer: '',
      urlGoogleEditor: '',
      driveFileId: '',
      documentoId: 0,
      cursoId: 0,
      tema: 'default',
      etiqueta: '',
      rrhhColaboradorFileId: '',
      pdfBlob: null,
      progreso: 0,
      etiquetaCarga: 'Preparando vista previa…',
      lento: false
    };
  }

  /**
   * Abre el modal de previsualización de un documento.
   * Detecta automáticamente el tipo (PDF, imagen, Office) y usa Drive preview nativo para Office.
   */
  abrir(doc: DocumentPreviewData): void {
    const driveFileId = doc.archivo_url || '';
    const ext = (doc.archivo_nombre || '').split('.').pop()?.toLowerCase() || '';
    const officeExts = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
    const tema: DocumentPreviewTema =
      doc.tema === 'rrhh' ? 'rrhh'
      : doc.tema === 'pc' ? 'pc'
      : 'default';

    let tipo: PreviewState['tipo'] = 'otro';
    if (doc.tipoHint === 'pdf' || doc.tipoHint === 'imagen' || doc.tipoHint === 'office') {
      tipo = doc.tipoHint;
    } else if (ext === 'pdf') {
      tipo = 'pdf';
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      tipo = 'imagen';
    } else if ((officeExts.includes(ext) && driveFileId) || doc.previewUrl) {
      tipo = 'office';
    }

    this.currentState = {
      visible: true,
      nombre: doc.nombre || 'Documento',
      cargando: true,
      error: false,
      tipo,
      urlDocumento: '',
      urlGoogleViewer: '',
      urlGoogleEditor: doc.editorUrl || '',
      driveFileId,
      documentoId: doc.documento_id || 0,
      cursoId: doc.curso_id || 0,
      tema,
      etiqueta: doc.etiqueta || '',
      rrhhColaboradorFileId: String(doc.rrhhColaboradorFileId || '').trim(),
      pdfBlob: null,
      progreso: 4,
      etiquetaCarga: 'Solicitando documento…',
      lento: false
    };

    this.cargaSub?.unsubscribe();

    // Preview URL explícita (p. ej. Google Sheets embebido)
    if (doc.previewUrl) {
      this.currentState.tipo = 'office';
      this.currentState.urlGoogleViewer = doc.previewUrl;
      this.currentState.urlDocumento = doc.previewUrl;
      if (!this.currentState.urlGoogleEditor && driveFileId) {
        this.currentState.urlGoogleEditor = `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
      }
      this.currentState.cargando = false;
      this.emit();
      return;
    }

    // Expediente RRHH: blob autenticado (PDF/imagen)
    const rrhhId = this.currentState.rrhhColaboradorFileId || '';
    if (rrhhId && (tipo === 'pdf' || tipo === 'imagen')) {
      this.currentState.driveFileId = rrhhId;
      this.emit();
      this.backendServices.descargarRrhhColaboradorArchivo(rrhhId, doc.archivo_nombre || doc.nombre).subscribe({
        next: async (blob) => {
          try {
            if (!blob || blob.size < 8 || (blob.type && blob.type.includes('json'))) {
              throw new Error('Respuesta inválida');
            }
            const mime = tipo === 'pdf'
              ? 'application/pdf'
              : (blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg');
            const buffer = await blob.arrayBuffer();
            const typed = new Blob([buffer], { type: mime });
            if (tipo === 'pdf') {
              this.aplicarPdfBlob(typed);
            } else {
              this.currentState.urlDocumento = URL.createObjectURL(typed);
              this.currentState.cargando = false;
              this.currentState.error = false;
              this.emit();
            }
          } catch {
            this.usarFallbackDrivePreview(rrhhId);
          }
        },
        error: () => this.usarFallbackDrivePreview(rrhhId)
      });
      return;
    }

    // Para archivos Office → usar visor/editor nativo de Google Drive
    if (tipo === 'office' && driveFileId) {
      this.currentState.urlGoogleViewer = `https://drive.google.com/file/d/${driveFileId}/preview`;
      this.currentState.urlDocumento = this.currentState.urlGoogleViewer;
      this.currentState.cargando = false;

      if (['docx', 'doc'].includes(ext)) {
        this.currentState.urlGoogleEditor = `https://docs.google.com/document/d/${driveFileId}/edit`;
      } else if (['xlsx', 'xls'].includes(ext)) {
        this.currentState.urlGoogleEditor = `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
      } else if (['pptx', 'ppt'].includes(ext)) {
        this.currentState.urlGoogleEditor = `https://docs.google.com/presentation/d/${driveFileId}/edit`;
      }

      this.emit();
      return;
    }

    // Para PDF e imágenes → descargar blob del backend
    if (doc.curso_id && doc.documento_id) {
      this.emit();
      if (tipo === 'pdf') {
        this.cargarPdfConProgreso(
          this.backendServices.descargarArchivoDocumentoEventos(doc.curso_id, doc.documento_id)
        );
        return;
      }
      this.backendServices.descargarArchivoDocumento(doc.curso_id, doc.documento_id).subscribe({
        next: async (blob) => {
          try {
            const mime = blob?.type && blob.type.startsWith('image/') ? blob.type : 'application/octet-stream';
            const buffer = await blob.arrayBuffer();
            const typed = new Blob([buffer], { type: mime });
            this.currentState.urlDocumento = URL.createObjectURL(typed);
            this.currentState.cargando = false;
            this.emit();
          } catch {
            this.currentState.error = true;
            this.currentState.cargando = false;
            this.emit();
          }
        },
        error: () => {
          this.currentState.error = true;
          this.currentState.cargando = false;
          this.emit();
        }
      });
    } else {
      // Sin curso_id/documento_id, intentar con Drive directo
      if (driveFileId && tipo === 'pdf') {
        this.emit();
        this.cargarPdfConProgreso(
          this.backendServices.imprimirArchivoDriveComoPDFEventos(driveFileId, doc.nombre || 'documento.pdf')
        );
        return;
      }
      if (driveFileId) {
        this.currentState.urlGoogleViewer = `https://drive.google.com/file/d/${driveFileId}/preview`;
        this.currentState.urlDocumento = this.currentState.urlGoogleViewer;
        this.currentState.tipo = 'office'; // Forzar iframe de Drive
        this.currentState.cargando = false;
      } else {
        this.currentState.error = true;
        this.currentState.cargando = false;
      }
      this.emit();
    }
  }

  private cargarPdfConProgreso(request$: Observable<HttpEvent<Blob>>): void {
    this.cargaSub?.unsubscribe();
    this.cargaSub = this.pdfPreviewLoader.observar(request$, 'Descargando documento…').subscribe(state => {
      this.currentState.progreso = state.pct;
      this.currentState.etiquetaCarga = state.etiqueta;
      this.currentState.lento = state.lento;
      if (state.error) {
        this.currentState.error = true;
        this.currentState.cargando = false;
        this.emit();
        return;
      }
      if (state.blob) {
        this.aplicarPdfBlob(state.blob);
        return;
      }
      this.emit();
    });
  }

  private aplicarPdfBlob(blob: Blob): void {
    if (this.currentState.urlDocumento && this.currentState.urlDocumento.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentState.urlDocumento);
    }
    this.currentState.pdfBlob = blob;
    this.currentState.urlDocumento = URL.createObjectURL(blob);
    this.currentState.tipo = 'pdf';
    this.currentState.cargando = false;
    this.currentState.error = false;
    this.currentState.progreso = 96;
    this.currentState.etiquetaCarga = 'Preparando páginas…';
    this.emit();
  }

  private usarFallbackDrivePreview(fileId: string): void {
    this.currentState.urlGoogleViewer = `https://drive.google.com/file/d/${fileId}/preview`;
    this.currentState.urlDocumento = this.currentState.urlGoogleViewer;
    this.currentState.tipo = 'office';
    this.currentState.cargando = false;
    this.currentState.error = false;
    this.emit();
  }

  cerrar(): void {
    this.cargaSub?.unsubscribe();
    this.cargaSub = undefined;
    // Revocar blob URL si existe
    if (this.currentState.urlDocumento && this.currentState.urlDocumento.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentState.urlDocumento);
    }
    this.currentState = this.getDefaultState();
    this.emit();
  }

  onLoad(): void {
    this.currentState.cargando = false;
    this.emit();
  }

  onError(): void {
    // Si falló el blob PDF, intentar Drive preview antes de marcar error
    if (
      this.currentState.rrhhColaboradorFileId
      && this.currentState.tipo === 'pdf'
      && this.currentState.urlDocumento.startsWith('blob:')
    ) {
      const id = this.currentState.rrhhColaboradorFileId;
      if (this.currentState.urlDocumento.startsWith('blob:')) {
        URL.revokeObjectURL(this.currentState.urlDocumento);
      }
      this.usarFallbackDrivePreview(id);
      return;
    }
    this.currentState.cargando = false;
    this.currentState.error = true;
    this.emit();
  }

  abrirEnGoogleEditor(): void {
    if (this.currentState.urlGoogleEditor) {
      window.open(this.currentState.urlGoogleEditor, '_blank');
    }
  }

  abrirEnDrive(): void {
    const id = this.currentState.driveFileId || this.currentState.rrhhColaboradorFileId;
    if (!id) {
      return;
    }
    if (this.currentState.urlGoogleEditor) {
      window.open(this.currentState.urlGoogleEditor, '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(`https://drive.google.com/file/d/${id}/view`, '_blank', 'noopener,noreferrer');
  }

  descargar(): void {
    const state = this.currentState;

    if (state.pdfBlob) {
      // Ya tenemos el blob
      const link = document.createElement('a');
      link.href = state.urlDocumento && state.urlDocumento.startsWith('blob:')
        ? state.urlDocumento
        : URL.createObjectURL(state.pdfBlob);
      link.download = state.nombre.endsWith('.pdf') ? state.nombre : `${state.nombre}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    if (state.urlDocumento && state.urlDocumento.startsWith('blob:')) {
      // Ya tenemos el blob
      const link = document.createElement('a');
      link.href = state.urlDocumento;
      link.download = state.nombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    if (state.rrhhColaboradorFileId) {
      this.backendServices.descargarRrhhColaboradorArchivo(state.rrhhColaboradorFileId, state.nombre, true).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = state.nombre;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 100);
        },
        error: () => console.error('Error descargando documento RRHH')
      });
      return;
    }

    // Descargar desde backend
    if (state.cursoId && state.documentoId) {
      this.backendServices.descargarArchivoDocumento(state.cursoId, state.documentoId).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = state.nombre;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 100);
        },
        error: () => {
          console.error('Error descargando documento');
        }
      });
      return;
    }

    // Sheets / Drive: exportar o abrir editor
    if (state.driveFileId && state.tipo === 'office') {
      window.open(
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(state.driveFileId)}/export?format=xlsx`,
        '_blank',
        'noopener,noreferrer'
      );
      return;
    }
    if (state.urlGoogleEditor) {
      window.open(state.urlGoogleEditor, '_blank', 'noopener,noreferrer');
    }
  }

  private emit(): void {
    this.stateSubject.next({ ...this.currentState });
  }
}
