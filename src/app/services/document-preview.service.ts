import { Injectable } from '@angular/core';
import { HttpEvent } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
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
  /** Evidencia SGC-F-29: descarga autenticada por id de documento. */
  sgcF29EvidenciaId?: number;
  /** Evidencia SGC-F-14: descarga autenticada por id de documento. */
  sgcF14EvidenciaId?: number;
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
  /** Descarga autenticada evidencias SGC-F-29 */
  sgcF29EvidenciaId: number;
  /** Descarga autenticada evidencias SGC-F-14 */
  sgcF14EvidenciaId: number;
  pdfBlob: Blob | null;
  progreso: number;
  etiquetaCarga: string;
  lento: boolean;
}

@Injectable({ providedIn: 'root' })
export class DocumentPreviewService {

  private stateSubject = new BehaviorSubject<PreviewState>(this.getDefaultState());
  state$ = this.stateSubject.asObservable();

  private currentState: PreviewState = this.getDefaultState();
  private cargaSub?: Subscription;
  /** Evita bucles infinitos en la cadena de fallbacks de PDF. */
  private pdfFallbackNivel = 0;

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
      sgcF29EvidenciaId: 0,
      sgcF14EvidenciaId: 0,
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
      sgcF29EvidenciaId: Number(doc.sgcF29EvidenciaId) || 0,
      sgcF14EvidenciaId: Number(doc.sgcF14EvidenciaId) || 0,
      pdfBlob: null,
      progreso: 4,
      etiquetaCarga: 'Solicitando documento…',
      lento: false
    };

    this.cargaSub?.unsubscribe();
    this.pdfFallbackNivel = 0;

    // Preview URL explícita (p. ej. Google Sheets embebido). No aplicar a PDF/imagen SGC.
    if (doc.previewUrl && tipo === 'office') {
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

    // Evidencias SGC-F-14 / F-29: descarga autenticada (mismo camino confiable que procedimientos).
    const evidF14Id = this.currentState.sgcF14EvidenciaId || 0;
    const evidF29Id = this.currentState.sgcF29EvidenciaId || 0;
    if (evidF14Id > 0 || evidF29Id > 0) {
      this.emit();
      this.cargarEvidenciaSgc({
        formato: evidF14Id > 0 ? 'f14' : 'f29',
        evidenciaId: evidF14Id > 0 ? evidF14Id : evidF29Id,
        driveFileId,
        tipo,
        nombre: this.currentState.nombre
      });
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

  /**
   * Carga evidencias SGC-F-14 / F-29 con cadena autenticada:
   * 1) endpoint de evidencia (caché local)
   * 2) /drive/:id/imprimir-pdf (mismo camino que procedimientos)
   * 3) /drive/:id/descargar
   * No usa iframe de Drive (falla con archivos privados).
   */
  private cargarEvidenciaSgc(opts: {
    formato: 'f14' | 'f29';
    evidenciaId: number;
    driveFileId: string;
    tipo: PreviewState['tipo'];
    nombre: string;
  }): void {
    const { formato, evidenciaId, driveFileId, tipo, nombre } = opts;

    if (tipo === 'pdf') {
      const evidReq$ = formato === 'f14'
        ? this.backendServices.descargarArchivoEvidenciaSgcF14Eventos(evidenciaId)
        : this.backendServices.descargarArchivoEvidenciaSgcF29Eventos(evidenciaId);
      const drivePdfReq$ = driveFileId
        ? this.backendServices.imprimirArchivoDriveComoPDFEventos(driveFileId, nombre || 'evidencia.pdf')
        : null;
      // 1) API evidencia (caché local) → 2) Drive imprimir-pdf (mismo camino que procedimientos)
      if (drivePdfReq$) {
        this.cargarPdfConProgreso(evidReq$, {
          fallbackRequest$: drivePdfReq$,
          etiqueta: 'Descargando evidencia…'
        });
      } else {
        this.cargarPdfConProgreso(evidReq$, { etiqueta: 'Descargando evidencia…' });
      }
      return;
    }

    if (tipo === 'imagen') {
      this.cargarImagenEvidenciaSgc(formato, evidenciaId, driveFileId);
      return;
    }

    // Office u otros: iframe Drive solo si hay fileId (Office sí suele embeberse).
    if (driveFileId) {
      this.usarFallbackDrivePreview(driveFileId);
      return;
    }
    this.currentState.error = true;
    this.currentState.cargando = false;
    this.emit();
  }

  private cargarImagenEvidenciaSgc(
    formato: 'f14' | 'f29',
    evidenciaId: number,
    driveFileId: string
  ): void {
    const req$ = formato === 'f14'
      ? this.backendServices.descargarArchivoEvidenciaSgcF14(evidenciaId)
      : this.backendServices.descargarArchivoEvidenciaSgcF29(evidenciaId);

    this.cargaSub?.unsubscribe();
    this.cargaSub = req$.subscribe({
      next: async (blob) => {
        try {
          await this.aplicarImagenBlob(blob);
        } catch {
          if (driveFileId) {
            this.cargarImagenDesdeDrive(driveFileId);
          } else {
            this.marcarErrorCarga();
          }
        }
      },
      error: () => {
        if (driveFileId) {
          this.cargarImagenDesdeDrive(driveFileId);
        } else {
          this.marcarErrorCarga();
        }
      }
    });
  }

  private cargarImagenDesdeDrive(driveFileId: string): void {
    this.currentState.etiquetaCarga = 'Descargando imagen desde Drive…';
    this.emit();
    this.cargaSub?.unsubscribe();
    this.cargaSub = this.backendServices.descargarArchivoDrive(driveFileId, this.currentState.nombre).subscribe({
      next: async (blob) => {
        try {
          await this.aplicarImagenBlob(blob);
        } catch {
          this.marcarErrorCarga();
        }
      },
      error: () => this.marcarErrorCarga()
    });
  }

  private async aplicarImagenBlob(blob: Blob): Promise<void> {
    if (!blob || blob.size < 8 || (blob.type && blob.type.includes('json'))) {
      throw new Error('Respuesta inválida');
    }
    const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const typed = new Blob([buffer], { type: mime });
    if (this.currentState.urlDocumento && this.currentState.urlDocumento.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentState.urlDocumento);
    }
    this.currentState.urlDocumento = URL.createObjectURL(typed);
    this.currentState.tipo = 'imagen';
    this.currentState.cargando = false;
    this.currentState.error = false;
    this.emit();
  }

  private marcarErrorCarga(): void {
    this.currentState.error = true;
    this.currentState.cargando = false;
    this.emit();
  }

  private cargarPdfConProgreso(
    request$: Observable<HttpEvent<Blob>>,
    opciones?: {
      fallbackRequest$?: Observable<HttpEvent<Blob>>;
      fallbackDriveId?: string;
      etiqueta?: string;
    }
  ): void {
    this.cargaSub?.unsubscribe();
    this.cargaSub = this.pdfPreviewLoader
      .observar(request$, opciones?.etiqueta || 'Descargando documento…')
      .subscribe(state => {
        this.currentState.progreso = state.pct;
        this.currentState.etiquetaCarga = state.etiqueta;
        this.currentState.lento = state.lento;
        if (state.error) {
          this.intentarSiguienteFallbackPdf(opciones);
          return;
        }
        if (state.blob) {
          const typed = state.blob.type && state.blob.type.includes('pdf')
            ? state.blob
            : new Blob([state.blob], { type: 'application/pdf' });
          this.aplicarPdfBlob(typed);
          return;
        }
        this.emit();
      });
  }

  private intentarSiguienteFallbackPdf(opciones?: {
    fallbackRequest$?: Observable<HttpEvent<Blob>>;
    fallbackDriveId?: string;
  }): void {
    this.pdfFallbackNivel += 1;
    if (this.pdfFallbackNivel > 3) {
      this.marcarErrorCarga();
      return;
    }
    if (opciones?.fallbackRequest$) {
      this.currentState.etiquetaCarga = 'Reintentando descarga…';
      this.currentState.progreso = Math.max(8, this.currentState.progreso);
      this.emit();
      this.cargarPdfConProgreso(opciones.fallbackRequest$, {
        fallbackDriveId: opciones.fallbackDriveId,
        etiqueta: 'Descargando evidencia…'
      });
      return;
    }
    const driveId = String(opciones?.fallbackDriveId || this.currentState.driveFileId || '').trim();
    if (driveId && this.pdfFallbackNivel <= 2) {
      this.currentState.etiquetaCarga = 'Obteniendo PDF desde Drive…';
      this.emit();
      this.cargarPdfConProgreso(
        this.backendServices.imprimirArchivoDriveComoPDFEventos(driveId, this.currentState.nombre || 'documento.pdf'),
        { etiqueta: 'Descargando desde Drive…' }
      );
      return;
    }
    this.marcarErrorCarga();
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
    this.pdfFallbackNivel = 0;
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
    this.pdfFallbackNivel = 0;
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
    // Si falló el canvas PDF, reintentar por Drive autenticado (no iframe).
    const driveId = String(
      this.currentState.driveFileId
      || this.currentState.rrhhColaboradorFileId
      || ''
    ).trim();
    if (driveId && this.currentState.tipo === 'pdf' && this.pdfFallbackNivel < 3) {
      if (this.currentState.urlDocumento.startsWith('blob:')) {
        URL.revokeObjectURL(this.currentState.urlDocumento);
      }
      this.currentState.pdfBlob = null;
      this.currentState.cargando = true;
      this.currentState.error = false;
      this.currentState.etiquetaCarga = 'Reintentando vista previa…';
      this.emit();
      this.pdfFallbackNivel += 1;
      this.cargarPdfConProgreso(
        this.backendServices.imprimirArchivoDriveComoPDFEventos(driveId, this.currentState.nombre || 'documento.pdf'),
        { etiqueta: 'Descargando desde Drive…' }
      );
      return;
    }
    this.marcarErrorCarga();
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

    if (state.sgcF29EvidenciaId > 0) {
      this.backendServices.descargarArchivoEvidenciaSgcF29(state.sgcF29EvidenciaId).subscribe({
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
        error: () => console.error('Error descargando evidencia SGC-F-29')
      });
      return;
    }

    if (state.sgcF14EvidenciaId > 0) {
      this.backendServices.descargarArchivoEvidenciaSgcF14(state.sgcF14EvidenciaId).subscribe({
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
        error: () => console.error('Error descargando evidencia SGC-F-14')
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
