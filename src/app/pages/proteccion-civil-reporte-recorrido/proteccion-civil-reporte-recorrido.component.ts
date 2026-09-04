import { animate, style, transition, trigger } from '@angular/animations';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, Renderer2, SimpleChanges, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import Swal from 'sweetalert2';

import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';



interface SpF02ImagenCampo {

  driveFileId: string;

  nombreArchivo: string;

  mimeType: string;

  previewUrl?: string;

  thumbDataUrl?: string;

  dataUrl?: string;

}



interface SpF02Item {

  problema: string;

  problemaImagenes: SpF02ImagenCampo[];

  acciones: string;

  responsable: string;

  fechaCompromiso: string;

  estatus: string;

  observaciones: string;

  observacionesImagenes: SpF02ImagenCampo[];

  problemaImagen?: SpF02ImagenCampo | null;

  observacionesImagen?: SpF02ImagenCampo | null;

}



interface SpF02Reporte {

  id: string;

  folio: string;

  nombreEmpresa: string;

  fecha: string;

  proposito: string;

  hora: string;

  asistentes: string;

  modalidad: string;

  consultores: string;

  proxVisita: string;

  ultimaRevision: string;

  items: SpF02Item[];

  nombreHoja?: string;

}



interface PipcRecorridoPdf {
  pdf_id: number | null;
  drive_file_id: string;
  nombre_archivo: string;
  drive_view_url?: string;
  subido_at?: string | null;
}

interface PipcRecorridoRow {

  documento_id: number;

  nombre_documento: string;

  catalogo_documento_id?: number | null;

  reporte: { datos: SpF02Reporte; guardado: boolean; folio?: string; drive_file_id?: string | null } | null;

  pdfs?: PipcRecorridoPdf[];

  pdf?: PipcRecorridoPdf | null;

  completo: boolean;

}

type ModoCapturaRecorrido = 'manual' | 'pdf';



@Component({

  selector: 'app-proteccion-civil-reporte-recorrido',

  templateUrl: './proteccion-civil-reporte-recorrido.component.html',

  styleUrls: ['./proteccion-civil-reporte-recorrido.component.scss'],

  animations: [
    trigger('modoPanel', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(14px) scale(0.985)' }),
        animate('340ms cubic-bezier(0.22, 1, 0.36, 1)', style({ opacity: 1, transform: 'none' }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(-8px) scale(0.99)' }))
      ])
    ])
  ]

})

export class ProteccionCivilReporteRecorridoComponent implements OnInit, OnChanges, OnDestroy {

  @Input() empresaId: number | null = null;

  @Input() nodoBloqueado = false;

  @Input() refreshToken = 0;

  @Output() estadoActualizado = new EventEmitter<void>();

  @Output() pasoCompletado = new EventEmitter<void>();

  @Output() solicitarDesbloqueo = new EventEmitter<void>();



  readonly revision = '00';

  readonly fechaRevision = '2021-06-26';

  readonly estatusOpciones = ['Abierto', 'Cerrado'];

  readonly modalidades = ['Presencial', 'Virtual', 'Híbrida'];

  readonly maxImagenesPorCampo = 3;

  readonly maxPdfMb = 25;



  cargando = false;

  guardando = false;

  subiendoPdfPipcId: number | null = null;

  cambiandoModo = false;

  modoCaptura: ModoCapturaRecorrido = 'manual';

  nombreEmpresa = '';

  pipcs: PipcRecorridoRow[] = [];

  driveFileId: string | null = null;

  editorUrl: string | null = null;

  ultimaSync: string | null = null;

  pipcActivo: PipcRecorridoRow | null = null;

  reporteActivo: SpF02Reporte | null = null;

  cambiosPendientes = false;

  textareaResizeToken = 0;

  subiendoImagenKey: string | null = null;

  editorIntegradoVisible = false;
  editorIntegradoUrl: SafeResourceUrl | null = null;
  editorIntegradoUrlRaw = '';
  cargandoEditor = false;

  @ViewChild('editorOverlay') editorOverlay?: ElementRef<HTMLElement>;
  private editorOverlayParent: HTMLElement | null = null;
  private editorOverlayNextSibling: Node | null = null;

  constructor(
    private backend: BackendServices,
    private sanitizer: DomSanitizer,
    private renderer: Renderer2,
    private documentPreview: DocumentPreviewService
  ) {}

  ngOnDestroy(): void {
    this.cerrarEditorIntegrado(false);
    this.liberarScrollPaginaEditor();
  }

  @HostListener('document:keydown.escape')
  onEscapeCerrarEditor(): void {
    if (this.editorIntegradoVisible) {
      this.cerrarEditorIntegrado();
    }
  }



  ngOnInit(): void {

    this.cargar();

  }



  ngOnChanges(changes: SimpleChanges): void {

    if (changes['empresaId'] || changes['refreshToken']) {

      this.cargar();

    }

  }



  get resumenActivo(): { total: number; abiertos: number; cerrados: number; avance: number } {
    return this.resumenReporte(this.reporteActivo);
  }

  get resumenGlobal(): { total: number; completos: number } {
    return {
      total: this.pipcs.length,
      completos: this.pipcs.filter((p) => p.completo).length
    };
  }

  get esModoManual(): boolean {
    return this.modoCaptura === 'manual';
  }

  get esModoPdf(): boolean {
    return this.modoCaptura === 'pdf';
  }

  get resumenModoLabel(): string {
    return this.esModoPdf ? 'PIPCs con PDF' : 'PIPCs con reporte';
  }

  cargar(): void {
    if (!this.empresaId) {
      return;
    }
    const pipcActivoId = this.pipcActivo?.documento_id ?? null;
    this.cargando = true;
    this.backend.obtenerRecorridoPC(this.empresaId).subscribe({
      next: (resp) => {
        this.nombreEmpresa = resp?.nombre_empresa || '';
        this.pipcs = Array.isArray(resp?.pipcs) ? resp.pipcs : [];
        this.modoCaptura = resp?.modo_captura === 'pdf' ? 'pdf' : 'manual';
        this.cargando = false;

        if (!this.pipcs.length) {
          this.pipcActivo = null;
          this.reporteActivo = null;
          return;
        }

        const previo = pipcActivoId
          ? this.pipcs.find((p) => p.documento_id === pipcActivoId)
          : null;
        this.activarPipcInterno(previo || this.pipcs[0], false);
      },

      error: () => {

        this.cargando = false;

        Swal.fire({

          icon: 'error',

          title: 'Error',

          text: 'No se pudieron cargar los reportes de recorrido.',

          confirmButtonColor: '#d97248'

        });

      }

    });

  }



  datosReportePipc(pipc: PipcRecorridoRow): SpF02Reporte {

    return pipc.reporte?.datos

      ? this.clonarReporte(pipc.reporte.datos)

      : this.crearReporteVacio(pipc);

  }



  resumenReporte(reporte: SpF02Reporte | null | undefined): { total: number; abiertos: number; cerrados: number; avance: number } {

    const items = (reporte?.items || []).filter((i) => this.itemTieneContenido(i));

    const total = items.length;

    const cerrados = items.filter((i) => i.estatus === 'Cerrado').length;

    const abiertos = total - cerrados;

    const avance = total ? Math.round((cerrados / total) * 100) : 0;

    return { total, abiertos, cerrados, avance };

  }



  async seleccionarModoCaptura(modo: ModoCapturaRecorrido): Promise<void> {
    if (this.modoCaptura === modo || this.cambiandoModo || !this.empresaId) {
      return;
    }

    if (this.nodoBloqueado) {
      this.modoCaptura = modo;
      if (this.editorIntegradoVisible) {
        this.cerrarEditorIntegrado();
      }
      return;
    }
    if (this.esModoManual && this.cambiosPendientes) {
      const confirm = await Swal.fire({
        title: 'Cambios sin guardar',
        text: '¿Cambiar a subida PDF sin guardar el reporte manual actual?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d97248',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, continuar',
        cancelButtonText: 'Cancelar'
      });
      if (!confirm.isConfirmed) {
        return;
      }
    }

    this.cambiandoModo = true;
    this.backend.establecerModoRecorridoPC(this.empresaId, modo).subscribe({
      next: () => {
        this.cambiandoModo = false;
        this.modoCaptura = modo;
        this.cambiosPendientes = false;
        if (this.editorIntegradoVisible) {
          this.cerrarEditorIntegrado();
        }
        this.cargar();
      },
      error: (err) => {
        this.cambiandoModo = false;
        Swal.fire({
          icon: 'warning',
          title: 'No se pudo cambiar el modo',
          text: err?.error?.message || 'Intenta de nuevo.',
          confirmButtonColor: '#d97248'
        });
      }
    });
  }

  onPdfSeleccionado(event: Event, pipc: PipcRecorridoRow): void {
    if (!this.empresaId || this.nodoBloqueado) {
      return;
    }

    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input?.files || []);
    input.value = '';
    if (!archivos.length) {
      return;
    }

    const validos: File[] = [];
    for (const file of archivos) {
      const esPdf = String(file.type || '').toLowerCase() === 'application/pdf'
        || String(file.name || '').toLowerCase().endsWith('.pdf');
      if (!esPdf) {
        continue;
      }
      if (file.size > this.maxPdfMb * 1024 * 1024) {
        Swal.fire({
          icon: 'warning',
          title: 'PDF muy grande',
          text: `${file.name} supera ${this.maxPdfMb} MB.`,
          confirmButtonColor: '#d97248'
        });
        continue;
      }
      validos.push(file);
    }

    if (!validos.length) {
      Swal.fire({
        icon: 'warning',
        title: 'Archivo no válido',
        text: 'Solo se permiten archivos PDF.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    this.subirPdfsSecuencial(pipc, validos);
  }

  private subirPdfsSecuencial(pipc: PipcRecorridoRow, archivos: File[]): void {
    if (!this.empresaId) {
      return;
    }

    this.subiendoPdfPipcId = pipc.documento_id;
    let indice = 0;
    let ultimoCompleto = false;

    const subirSiguiente = (): void => {
      if (indice >= archivos.length) {
        this.subiendoPdfPipcId = null;
        this.modoCaptura = 'pdf';
        Swal.fire({
          icon: 'success',
          title: archivos.length > 1 ? 'PDFs subidos' : 'PDF subido',
          text: `${archivos.length} archivo(s) guardados en Google Drive.`,
          timer: 1800,
          showConfirmButton: false
        });
        this.cargar();
        this.estadoActualizado.emit();
        if (ultimoCompleto) {
          this.pasoCompletado.emit();
        }
        return;
      }

      const file = archivos[indice];
      indice += 1;
      this.backend.subirPdfRecorridoPC(this.empresaId!, pipc.documento_id, file).subscribe({
        next: (resp) => {
          ultimoCompleto = !!resp?.recorrido_completo;
          subirSiguiente();
        },
        error: (err) => {
          this.subiendoPdfPipcId = null;
          Swal.fire({
            icon: 'error',
            title: 'No se pudo subir',
            text: err?.error?.message || `No se pudo subir ${file.name}.`,
            confirmButtonColor: '#d97248'
          });
          if (indice > 1) {
            this.cargar();
            this.estadoActualizado.emit();
          }
        }
      });
    };

    subirSiguiente();
  }

  eliminarPdfRecorrido(pipc: PipcRecorridoRow, pdf: PipcRecorridoPdf, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.empresaId || this.nodoBloqueado || !pdf.pdf_id) {
      return;
    }

    Swal.fire({
      title: '¿Eliminar PDF?',
      text: pdf.nombre_archivo,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed || !pdf.pdf_id) {
        return;
      }
      this.subiendoPdfPipcId = pipc.documento_id;
      this.backend.eliminarPdfRecorridoPC(this.empresaId!, pdf.pdf_id).subscribe({
        next: () => {
          this.subiendoPdfPipcId = null;
          this.cargar();
          this.estadoActualizado.emit();
        },
        error: (err) => {
          this.subiendoPdfPipcId = null;
          Swal.fire({
            icon: 'error',
            title: 'No se pudo eliminar',
            text: err?.error?.message || 'Intenta de nuevo.',
            confirmButtonColor: '#d97248'
          });
        }
      });
    });
  }

  pdfsDePipc(pipc: PipcRecorridoRow): PipcRecorridoPdf[] {
    if (Array.isArray(pipc.pdfs) && pipc.pdfs.length) {
      return pipc.pdfs;
    }
    return pipc.pdf ? [pipc.pdf] : [];
  }

  previewUrlPdf(pdf: PipcRecorridoPdf | null | undefined): string {
    if (!pdf?.drive_file_id) {
      return '';
    }
    return this.backend.obtenerUrlDrivePreview(pdf.drive_file_id);
  }

  abrirPdfRecorrido(pdf: PipcRecorridoPdf): void {
    if (!pdf?.drive_file_id) {
      return;
    }
    this.documentPreview.abrir({
      nombre: pdf.nombre_archivo || 'Reporte de recorrido',
      archivo_nombre: pdf.nombre_archivo,
      archivo_url: pdf.drive_file_id,
      tipoHint: 'pdf',
      etiqueta: 'Reporte de recorrido',
      tema: 'pc'
    });
  }

  formatFechaPdf(fecha: string | null | undefined): string {
    if (!fecha) {
      return '';
    }
    const parsed = new Date(fecha);
    if (Number.isNaN(parsed.getTime())) {
      return String(fecha);
    }
    return parsed.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Mexico_City'
    });
  }

  trackByPdf(_i: number, pdf: PipcRecorridoPdf): number | string {
    return pdf.pdf_id || pdf.drive_file_id || _i;
  }

  estaSubiendoPdf(pipc: PipcRecorridoRow): boolean {
    return this.subiendoPdfPipcId === pipc.documento_id;
  }

  async seleccionarPipc(pipc: PipcRecorridoRow): Promise<void> {
    if (this.pipcActivo?.documento_id === pipc.documento_id) {
      return;
    }
    if (!this.nodoBloqueado && this.cambiosPendientes) {
      const confirm = await Swal.fire({
        title: 'Cambios sin guardar',
        text: '¿Cambiar de PIPC sin guardar el reporte actual?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d97248',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, continuar',
        cancelButtonText: 'Cancelar'
      });
      if (!confirm.isConfirmed) {
        return;
      }
    }
    this.activarPipcInterno(pipc, true);
    if (this.editorIntegradoVisible) {
      this.cerrarEditorIntegrado();
    }
  }



  onEditado(): void {

    if (this.reporteActivo) {

      this.reporteActivo.folio = this.folioDesdeFecha(this.reporteActivo.fecha);

      this.reporteActivo.ultimaRevision = this.fechaHoy();

    }

    this.cambiosPendientes = true;

  }



  agregarItem(): void {

    if (!this.reporteActivo) {

      return;

    }

    this.reporteActivo.items = [...this.reporteActivo.items, this.crearItemVacio()];

    this.onEditado();

    this.refrescarTextareas();

  }



  quitarItem(index: number): void {

    if (!this.reporteActivo) {

      return;

    }

    if (this.reporteActivo.items.length <= 1) {

      this.reporteActivo.items = [this.crearItemVacio()];

    } else {

      this.reporteActivo.items.splice(index, 1);

    }

    this.onEditado();

  }



  guardarInformacion(): void {

    if (!this.empresaId || !this.pipcActivo || !this.reporteActivo || this.guardando || this.nodoBloqueado) {

      if (this.nodoBloqueado) {

        this.solicitarDesbloqueo.emit();

      }

      return;

    }

    this.guardando = true;

    this.backend.guardarRecorridoPipcPC(this.empresaId, this.pipcActivo.documento_id, this.reporteActivo).subscribe({

      next: (resp) => {

        this.guardando = false;

        this.cambiosPendientes = false;

        this.ultimaSync = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        if (resp?.drive_file_id) {

          this.driveFileId = resp.drive_file_id;

        }

        if (resp?.editor_url) {
          this.editorUrl = resp.editor_url;
        }

        if (this.editorIntegradoVisible && resp?.editor_url) {
          this.editorIntegradoUrlRaw = resp.editor_url;
          this.editorIntegradoUrl = null;
          this.cargandoEditor = true;
          setTimeout(() => {
            this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(resp.editor_url);
          }, 0);
        }

        Swal.fire({

          icon: 'success',

          title: 'Guardado',

          text: resp?.message || 'Reporte guardado en Protección Civil y sincronizado con Drive.',

          timer: 1800,

          showConfirmButton: false

        });

        this.cargar();

        this.estadoActualizado.emit();

      },

      error: (err) => {

        this.guardando = false;

        Swal.fire({

          icon: 'warning',

          title: 'No se pudo guardar',

          text: err?.error?.message || 'Verifica fecha, propósito y al menos un hallazgo.',

          confirmButtonColor: '#d97248'

        });

      }

    });

  }



  abrirEditorIntegrado(): void {
    const url = this.resolverUrlEditorIntegrado();
    if (!url) {
      Swal.fire({
        icon: 'info',
        title: 'Sin archivo en Drive',
        text: 'Guarda el reporte al menos una vez para generar el Excel en Google Drive.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    this.editorIntegradoUrlRaw = url;
    this.editorIntegradoUrl = null;
    this.cargandoEditor = true;
    this.editorIntegradoVisible = true;
    this.bloquearScrollPaginaEditor();

    setTimeout(() => {
      this.montarEditorEnBody();
      this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }, 0);
  }

  cerrarEditorIntegrado(restaurarDom = true): void {
    if (restaurarDom) {
      this.desmontarEditorDeBody();
    }
    this.editorIntegradoVisible = false;
    this.editorIntegradoUrl = null;
    this.editorIntegradoUrlRaw = '';
    this.cargandoEditor = false;
    this.liberarScrollPaginaEditor();
  }

  onEditorIframeLoad(): void {
    this.cargandoEditor = false;
  }

  private resolverUrlEditorIntegrado(): string | null {
    if (this.editorUrl) {
      return this.editorUrl;
    }
    if (this.driveFileId) {
      return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.driveFileId)}/edit`;
    }
    return null;
  }

  private bloquearScrollPaginaEditor(): void {
    document.body.style.overflow = 'hidden';
  }

  private liberarScrollPaginaEditor(): void {
    document.body.style.overflow = '';
  }

  private montarEditorEnBody(): void {
    const el = this.editorOverlay?.nativeElement;
    if (!el || el.parentElement === document.body) {
      return;
    }
    this.editorOverlayParent = el.parentElement;
    this.editorOverlayNextSibling = el.nextSibling;
    this.renderer.appendChild(document.body, el);
  }

  private desmontarEditorDeBody(): void {
    const el = this.editorOverlay?.nativeElement;
    if (!el || !this.editorOverlayParent) {
      return;
    }
    if (this.editorOverlayNextSibling) {
      this.editorOverlayParent.insertBefore(el, this.editorOverlayNextSibling);
    } else {
      this.editorOverlayParent.appendChild(el);
    }
    this.editorOverlayParent = null;
    this.editorOverlayNextSibling = null;
  }



  claseEstatusSpF02(estatus: string): string {

    return estatus === 'Cerrado' ? 'sp-f-02-estatus--cerrado' : 'sp-f-02-estatus--abierto';

  }



  itemTieneContenido(item: SpF02Item | null | undefined): boolean {

    if (!item) {

      return false;

    }

    return !!(item.problema || item.acciones || item.responsable || item.fechaCompromiso || item.observaciones

      || (item.problemaImagenes || []).length

      || (item.observacionesImagenes || []).length

      || (item.estatus && item.estatus !== 'Abierto'));

  }



  imagenesCampo(item: SpF02Item, campo: 'problema' | 'observaciones'): SpF02ImagenCampo[] {

    return campo === 'problema'

      ? (item.problemaImagenes || [])

      : (item.observacionesImagenes || []);

  }



  puedeAgregarImagen(item: SpF02Item, campo: 'problema' | 'observaciones'): boolean {

    return this.imagenesCampo(item, campo).length < this.maxImagenesPorCampo;

  }



  previewImagen(imagen: SpF02ImagenCampo | null | undefined): string | null {

    if (!imagen) {

      return null;

    }

    if (imagen.thumbDataUrl) {

      return imagen.thumbDataUrl;

    }

    if (imagen.dataUrl) {

      return imagen.dataUrl;

    }

    if (imagen.driveFileId) {

      return this.backend.obtenerUrlDrivePreview(imagen.driveFileId);

    }

    if (imagen.previewUrl) {

      return imagen.previewUrl;

    }

    return null;

  }



  subiendoImagen(index: number, campo: 'problema' | 'observaciones'): boolean {

    const prefix = `${index}-${campo}-`;

    return !!this.subiendoImagenKey?.startsWith(prefix);

  }



  onSeleccionarImagen(

    event: Event,

    item: SpF02Item,

    index: number,

    campo: 'problema' | 'observaciones'

  ): void {

    if (!this.empresaId || !this.pipcActivo || this.nodoBloqueado) {

      if (this.nodoBloqueado) {

        this.solicitarDesbloqueo.emit();

      }

      return;

    }



    const input = event.target as HTMLInputElement;

    const file = input?.files?.[0];

    if (!file) {

      return;

    }

    if (!String(file.type || '').startsWith('image/')) {

      Swal.fire({ icon: 'warning', title: 'Archivo no válido', text: 'Solo se permiten imágenes.', confirmButtonColor: '#d97248' });

      input.value = '';

      return;

    }

    if (file.size > 8 * 1024 * 1024) {

      Swal.fire({ icon: 'warning', title: 'Imagen muy grande', text: 'La imagen no debe superar 8 MB.', confirmButtonColor: '#d97248' });

      input.value = '';

      return;

    }

    if (!this.puedeAgregarImagen(item, campo)) {

      input.value = '';

      return;

    }



    const slot = this.imagenesCampo(item, campo).length;

    const key = `${index}-${campo}-${slot}`;

    this.subiendoImagenKey = key;



    this.comprimirImagen(file).then((dataUrl) => {

      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      const nombreArchivo = (file.name || 'imagen.jpg').replace(/\.\w+$/, '.jpg');

      this.backend.subirImagenRecorridoPC(this.empresaId!, this.pipcActivo!.documento_id, {

        campo,

        item_index: index,

        slot_index: slot,

        reporte_folio: this.reporteActivo?.folio || '',

        imagen_base64: base64,

        mime_type: 'image/jpeg',

        nombre_archivo: nombreArchivo

      }).subscribe({

        next: (resp) => {

          this.subiendoImagenKey = null;

          const imagen: SpF02ImagenCampo = {

            driveFileId: resp?.imagen?.driveFileId,

            nombreArchivo: resp?.imagen?.nombreArchivo || nombreArchivo,

            mimeType: resp?.imagen?.mimeType || 'image/jpeg',

            previewUrl: resp?.imagen?.previewUrl,

            thumbDataUrl: resp?.imagen?.thumbDataUrl,

            dataUrl: resp?.imagen?.thumbDataUrl || dataUrl

          };

          if (campo === 'problema') {

            item.problemaImagenes = [...(item.problemaImagenes || []), imagen];

          } else {

            item.observacionesImagenes = [...(item.observacionesImagenes || []), imagen];

          }

          this.onEditado();

        },

        error: (err) => {

          this.subiendoImagenKey = null;

          Swal.fire({

            icon: 'error',

            title: 'No se pudo subir',

            text: err?.error?.message || 'No se pudo guardar la imagen en Google Drive.',

            confirmButtonColor: '#d97248'

          });

        }

      });

    }).catch(() => {

      this.subiendoImagenKey = null;

      Swal.fire({

        icon: 'error',

        title: 'Error',

        text: 'No se pudo procesar la imagen.',

        confirmButtonColor: '#d97248'

      });

    });



    input.value = '';

  }



  quitarImagen(item: SpF02Item, campo: 'problema' | 'observaciones', slotIndex: number): void {

    if (campo === 'problema') {

      item.problemaImagenes = (item.problemaImagenes || []).filter((_, i) => i !== slotIndex);

    } else {

      item.observacionesImagenes = (item.observacionesImagenes || []).filter((_, i) => i !== slotIndex);

    }

    this.onEditado();

  }



  trackByPipc(_i: number, p: PipcRecorridoRow): number {
    return p.documento_id;
  }



  trackByIdx(i: number): number {

    return i;

  }



  private activarPipcInterno(pipc: PipcRecorridoRow, resetCambios: boolean): void {
    this.pipcActivo = pipc;
    this.reporteActivo = this.datosReportePipc(pipc);
    const driveId = pipc.reporte?.drive_file_id || null;
    this.driveFileId = driveId;
    this.editorUrl = driveId
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(driveId)}/edit`
      : null;
    if (resetCambios) {
      this.cambiosPendientes = false;
    }
    this.refrescarTextareas();
  }



  private refrescarTextareas(): void {

    this.textareaResizeToken += 1;

  }



  private crearItemVacio(): SpF02Item {

    return {

      problema: '',

      problemaImagenes: [],

      acciones: '',

      responsable: '',

      fechaCompromiso: '',

      estatus: 'Abierto',

      observaciones: '',

      observacionesImagenes: []

    };

  }



  private fechaHoy(): string {

    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

  }



  private folioDesdeFecha(fechaIso?: string): string {

    const iso = (fechaIso || this.fechaHoy()).slice(0, 10);

    const m = iso.match(/^(\d{4})-(\d{2})/);

    return m ? `SPF02-${m[2]}${m[1].slice(-2)}` : 'SPF02-0000';

  }



  private nuevoId(): string {

    return `pc-rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  }



  private crearReporteVacio(pipc: PipcRecorridoRow): SpF02Reporte {

    const hoy = this.fechaHoy();

    return {

      id: this.nuevoId(),

      folio: this.folioDesdeFecha(hoy),

      nombreEmpresa: this.nombreEmpresa,

      fecha: hoy,

      proposito: `Recorrido PIPC — ${pipc.nombre_documento}`,

      hora: '',

      asistentes: '',

      modalidad: 'Presencial',

      consultores: '',

      proxVisita: '',

      ultimaRevision: hoy,

      items: [this.crearItemVacio()]

    };

  }



  private clonarReporte(r: SpF02Reporte): SpF02Reporte {

    return {

      ...r,

      items: (r.items || []).map((i) => ({

        ...i,

        problemaImagenes: this.normalizarImagenes(i, 'problemaImagenes', 'problemaImagen'),

        observacionesImagenes: this.normalizarImagenes(i, 'observacionesImagenes', 'observacionesImagen')

      }))

    };

  }



  private normalizarImagenes(
    raw: Partial<SpF02Item> | null | undefined,
    plural: 'problemaImagenes' | 'observacionesImagenes',
    singular: 'problemaImagen' | 'observacionesImagen'
  ): SpF02ImagenCampo[] {
    const src = raw || {};
    const out: SpF02ImagenCampo[] = [];
    const arr = Array.isArray(src[plural]) ? src[plural]! : [];
    for (const img of arr) {
      const limpia = this.normalizarImagen(img);
      if (limpia && !out.some((x) => x.driveFileId === limpia.driveFileId)) {
        out.push(limpia);
      }
    }
    const legacy = this.normalizarImagen(src[singular]);

    if (legacy && !out.some((x) => x.driveFileId === legacy.driveFileId)) {

      out.unshift(legacy);

    }

    return out.slice(0, this.maxImagenesPorCampo);

  }



  private normalizarImagen(raw: Partial<SpF02ImagenCampo> | null | undefined): SpF02ImagenCampo | null {

    const driveFileId = String(raw?.driveFileId || '').trim();

    if (!driveFileId) {

      return null;

    }

    return {

      driveFileId,

      nombreArchivo: String(raw?.nombreArchivo || 'imagen.jpg').trim(),

      mimeType: String(raw?.mimeType || 'image/jpeg').trim(),

      previewUrl: raw?.previewUrl,

      thumbDataUrl: raw?.thumbDataUrl,

      dataUrl: raw?.dataUrl

    };

  }



  private comprimirImagen(file: File, maxLado = 1200, calidad = 0.82): Promise<string> {

    return new Promise((resolve, reject) => {

      const reader = new FileReader();

      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));

      reader.onload = () => {

        const src = String(reader.result || '');

        const img = new Image();

        img.onload = () => {

          try {

            const w = img.naturalWidth || img.width;

            const h = img.naturalHeight || img.height;

            const scale = Math.min(1, maxLado / Math.max(w, h, 1));

            const cw = Math.max(1, Math.round(w * scale));

            const ch = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement('canvas');

            canvas.width = cw;

            canvas.height = ch;

            const ctx = canvas.getContext('2d');

            if (!ctx) {

              resolve(src);

              return;

            }

            ctx.drawImage(img, 0, 0, cw, ch);

            resolve(canvas.toDataURL('image/jpeg', calidad));

          } catch {

            resolve(src);

          }

        };

        img.onerror = () => reject(new Error('Imagen inválida'));

        img.src = src;

      };

      reader.readAsDataURL(file);

    });

  }

}


