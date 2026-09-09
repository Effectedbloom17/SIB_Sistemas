import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { DocumentPreviewService, PreviewState } from '../../services/document-preview.service';

@Component({
  selector: 'app-document-preview',
  templateUrl: './document-preview.component.html',
  styleUrls: ['./document-preview.component.scss']
})
export class DocumentPreviewComponent implements OnInit, OnDestroy {
  state: PreviewState = {
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

  private sub: Subscription;

  constructor(public previewService: DocumentPreviewService) {}

  ngOnInit(): void {
    this.sub = this.previewService.state$.subscribe(s => {
      this.state = s;
    });
  }

  ngOnDestroy(): void {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  getIconoTipo(): string {
    if (this.state.etiqueta && /excel|sheet|hoja/i.test(this.state.etiqueta + ' ' + this.state.nombre)) {
      return 'fas fa-file-excel';
    }
    switch (this.state.tipo) {
      case 'pdf': return 'fas fa-file-pdf';
      case 'imagen': return 'fas fa-file-image';
      case 'office': return 'fas fa-file-excel';
      default: return 'fas fa-file-alt';
    }
  }

  getEtiquetaTipo(): string {
    if (this.state.etiqueta) return this.state.etiqueta;
    switch (this.state.tipo) {
      case 'pdf': return 'Documento PDF';
      case 'imagen': return 'Imagen';
      case 'office': return 'Documento Office';
      default: return 'Documento';
    }
  }

  getPdfCanvasTema(): 'oscuro' | 'claro' | 'oliva' | 'naranja' {
    if (this.state.tema === 'pc') {
      return 'naranja';
    }
    return 'oscuro';
  }
}
