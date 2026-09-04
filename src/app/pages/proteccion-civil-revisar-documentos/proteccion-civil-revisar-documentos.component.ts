import { Component, OnInit, OnDestroy, HostListener, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';
import { BackendServices } from '../../services/backend.services';

type EstadoSubRequisito = 'pendiente' | 'aprobado' | 'rechazado' | 'revision';
type EstadoFiltro = 'pendiente' | 'aprobado' | 'rechazado';
type PreviewModo = 'imagen' | 'pdf' | 'embed';

interface ArchivoPlano {
  subRequisito: SubRequisitoRevision;
  documentoPadre: DocumentoRevision;
}

interface ArchivoEntregado {
  id: string;
  nombre: string;
  fechaEntrega: string;
  driveFileId?: string;
}

interface ComentarioHistorial {
  id: string;
  autor: string;
  fecha: string;
  texto: string;
  accion: 'comentario' | 'aprobado' | 'rechazado';
}

interface SubRequisitoRevision {
  id: string;
  nombre: string;
  estado: EstadoSubRequisito;
  archivos: ArchivoEntregado[];
  comentarioActual: string;
  historialComentarios: ComentarioHistorial[];
  tipo_entrada: 'archivo' | 'texto';
  valor_texto: string;
}

interface DocumentoRevision {
  id: string;
  nombre: string;
  fechaAsignacion: string;
  expandido: boolean;
  aprobadoFinal: boolean;
  subRequisitos: SubRequisitoRevision[];
}

/** Payload compartido con el visor de proteccion-civil (Carga directa / empresa). */
export interface PcVisorDocumentoRequest {
  documento_id: number;
  nombre_archivo: string;
  archivo_url: string | null;
  nombre_documento?: string;
}

@Component({
  selector: 'app-proteccion-civil-revisar-documentos',
  templateUrl: './proteccion-civil-revisar-documentos.component.html',
  styleUrls: ['./proteccion-civil-revisar-documentos.component.scss']
})
export class ProteccionCivilRevisarDocumentosComponent implements OnInit, OnDestroy, OnChanges {
  @Input() embebido = false;
  /** Dentro del nodo Documentación del centro de operaciones (layout compacto). */
  @Input() embebidoHub = false;
  @Input() empresaIdEmbebida: number | null = null;
  /** Abre el visor del componente padre (evita recorte por overflow del hub). */
  @Output() solicitarVisor = new EventEmitter<PcVisorDocumentoRequest>();
  @Output() revisionActualizada = new EventEmitter<void>();

  empresaId: number | null = null;
  estadoFiltro: EstadoFiltro = 'pendiente';
  documentos: DocumentoRevision[] = [];
  cargando = false;
  procesandoAccion = false;
  mostrarFormularioRechazo = false;
  /** Visor local solo en ruta standalone (!embebido). */
  mostrarVisorLocal = false;
  urlVisorLocal = '';
  nombreVisorLocal = '';
  cargandoVisorLocal = false;
  documentoVisorLocalId: number | null = null;

  // Stepper: documento padre seleccionado
  documentoSeleccionadoId: string | null = null;

  // Workspace de revisión
  busquedaRevision = '';
  archivoFocus: ArchivoPlano | null = null;
  urlPreview = '';
  nombrePreview = '';
  cargandoPreview = false;
  previewModo: PreviewModo | null = null;
  previewError = false;
  private previewBlobCache = new Map<string, string>();
  private previewLoadToken = 0;
  private previewTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Menú de tres puntitos
  menuAbiertoId: string | null = null;
  menuPosition = { top: 0, left: 0 };
  menuAnchoPx: number = 300;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backendService: BackendServices
  ) {}

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.menuAbiertoId) {
      this.menuAbiertoId = null;
      return;
    }
    if (this.mostrarVisorLocal) {
      this.cerrarVisorLocal();
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.menuAbiertoId = null;
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.cerrarMenu();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.cerrarMenu();
  }

  ngOnInit(): void {
    this.resolverEmpresaId();
    this.cargarDocumentosDesdeBackend();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.embebido) {
      return;
    }
    if (changes['empresaIdEmbebida'] && this.empresaIdEmbebida) {
      this.resolverEmpresaId();
      this.cargarDocumentosDesdeBackend();
    }
  }

  private resolverEmpresaId(): void {
    if (this.embebido && this.empresaIdEmbebida) {
      this.empresaId = Number(this.empresaIdEmbebida);
      return;
    }
    const idParam = this.route.snapshot.paramMap.get('id');
    this.empresaId = idParam ? Number(idParam) : null;
  }

  ngOnDestroy(): void {
    this.cancelarPreviewTimeout();
    document.body.classList.remove('visor-fullscreen-open');
    this.previewBlobCache.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    this.previewBlobCache.clear();
    this.limpiarPreviewUrl();
  }

  cargarDocumentosDesdeBackend(): void {
    if (!this.empresaId) {
      this.documentos = [];
      return;
    }
    this.cargando = true;
    this.backendService.obtenerDocumentosProteccionCivil(this.empresaId).subscribe(
      (resp: any) => {
        this.cargando = false;
        if (resp.success && resp.documentos) {
          this.documentos = this.mapearDocumentosDesdeBackend(resp.documentos);
          // Auto-seleccionar primer documento
          if (this.documentos.length > 0) {
            this.documentoSeleccionadoId = this.documentos[0].id;
            this.seleccionarPrimerArchivoVisible();
          }
        } else {
          this.documentos = [];
        }
      },
      (err: any) => {
        this.cargando = false;
        console.error('Error al cargar documentos:', err);
        this.documentos = [];
      }
    );
  }

  private esSubtituloOperativo(nombre: string): boolean {
    const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return n === 'fisico' || n === 'usb' || n === 'presentar';
  }

  /** Solo requisitos marcados como visibles para la empresa (solicitados a la empresa). */
  private esRequisitoSolicitadoEmpresa(doc: any): boolean {
    return doc?.visible_empresa !== 0 && doc?.visible_empresa !== false;
  }

  private mapearDocumentosDesdeBackend(docs: any[]): DocumentoRevision[] {
    return docs
      .map((doc: any, index: number) => {
        const subReqs: SubRequisitoRevision[] = [];

        if (doc.subdocumentos && doc.subdocumentos.length > 0) {
          doc.subdocumentos
            .filter((sub: any) => !this.esSubtituloOperativo(sub.nombre_documento))
            .filter((sub: any) => this.esRequisitoSolicitadoEmpresa(sub))
            .forEach((sub: any) => {
              subReqs.push(this.mapearSubRequisito(sub));
            });
        } else if (this.esRequisitoSolicitadoEmpresa(doc)) {
          subReqs.push(this.mapearSubRequisito(doc));
        }

        return {
          id: String(doc.documento_id),
          nombre: doc.nombre_documento || 'Sin nombre',
          fechaAsignacion: doc.fecha_creacion ? doc.fecha_creacion.substring(0, 10) : '',
          expandido: index === 0,
          aprobadoFinal: doc.estatus === 'aprobado',
          subRequisitos: subReqs
        } as DocumentoRevision;
      })
      .filter((doc) => doc.subRequisitos.length > 0);
  }

  private mapearSubRequisito(sub: any): SubRequisitoRevision {
    const archivos: ArchivoEntregado[] = [];
    if (Array.isArray(sub.archivos) && sub.archivos.length > 0) {
      for (const archivo of sub.archivos) {
        if (!archivo) continue;
        archivos.push({
          id: String(archivo.archivo_id || `${sub.documento_id}-${archivos.length}`),
          nombre: archivo.nombre_archivo || 'archivo',
          fechaEntrega: archivo.fecha_subida ? String(archivo.fecha_subida).substring(0, 10) : '',
          driveFileId: archivo.drive_file_id || null
        });
      }
    } else if (sub.nombre_archivo) {
      archivos.push({
        id: String(sub.documento_id),
        nombre: sub.nombre_archivo,
        fechaEntrega: sub.fecha_subida ? sub.fecha_subida.substring(0, 10) : '',
        driveFileId: sub.archivo_url || null
      });
    }

    const historial: ComentarioHistorial[] = [];
    if (sub.comentarios) {
      historial.push({
        id: `cmt-${sub.documento_id}`,
        autor: 'Administrador',
        fecha: sub.fecha_actualizacion ? sub.fecha_actualizacion.substring(0, 16).replace('T', ' ') : '',
        texto: sub.comentarios,
        accion: 'comentario'
      });
    }

    let estado: EstadoSubRequisito = 'pendiente';
    if (sub.estatus === 'aprobado') estado = 'aprobado';
    else if (sub.estatus === 'rechazado') estado = 'rechazado';
    else if (sub.estatus === 'revision') estado = 'revision';

    return {
      id: String(sub.documento_id),
      nombre: sub.nombre_documento || 'Sin nombre',
      estado,
      archivos,
      comentarioActual: '',
      historialComentarios: historial,
      tipo_entrada: sub.tipo_entrada === 'texto' ? 'texto' : 'archivo',
      valor_texto: sub.valor_texto || ''
    };
  }

  // =====================================================
  // STEPPER: Navegación de documentos padre
  // =====================================================

  get documentoSeleccionado(): DocumentoRevision | null {
    if (!this.documentoSeleccionadoId) return null;
    return this.documentos.find(d => d.id === this.documentoSeleccionadoId) || null;
  }

  seleccionarDocumento(doc: DocumentoRevision): void {
    this.documentoSeleccionadoId = doc.id;
    this.busquedaRevision = '';
    this.seleccionarPrimerArchivoVisible();
  }

  esDocumentoCompletado(doc: DocumentoRevision): boolean {
    return doc.subRequisitos.length > 0 && doc.subRequisitos.every(s => s.estado === 'aprobado');
  }

  esDocumentoRechazado(doc: DocumentoRevision): boolean {
    return doc.subRequisitos.some(s => s.estado === 'rechazado') && !this.esDocumentoCompletado(doc);
  }

  getProgresoStepper(): number {
    if (this.documentos.length === 0) return 0;
    const completados = this.documentos.filter(d => this.esDocumentoCompletado(d)).length;
    return Math.round((completados / this.documentos.length) * 100);
  }

  // =====================================================
  // FILTRO: Archivos planos del documento seleccionado
  // =====================================================

  get archivosPlanos(): ArchivoPlano[] {
    const resultado: ArchivoPlano[] = [];
    for (const doc of this.documentos) {
      for (const sub of doc.subRequisitos) {
        resultado.push({ subRequisito: sub, documentoPadre: doc });
      }
    }
    return resultado;
  }

  get archivosFiltrados(): ArchivoPlano[] {
    const doc = this.documentoSeleccionado;
    if (!doc) return [];
    return doc.subRequisitos
      .filter(s => {
        if (this.estadoFiltro === 'pendiente') {
          return s.estado === 'pendiente' || s.estado === 'revision';
        }
        if (s.estado !== this.estadoFiltro) return false;
        return this.tieneContenidoEntregado(s);
      })
      .map(s => ({ subRequisito: s, documentoPadre: doc }));
  }

  get archivosFiltradosBusqueda(): ArchivoPlano[] {
    const term = (this.busquedaRevision || '').trim().toLowerCase();
    if (!term) return this.archivosFiltrados;
    return this.archivosFiltrados.filter(item => this.coincideBusquedaRevision(item, term));
  }

  get archivosBusquedaArchivo(): ArchivoPlano[] {
    return this.archivosFiltradosBusqueda.filter(a => a.subRequisito.tipo_entrada !== 'texto');
  }

  get archivosBusquedaTexto(): ArchivoPlano[] {
    return this.archivosFiltradosBusqueda.filter(a => a.subRequisito.tipo_entrada === 'texto');
  }

  get indicePreviewActual(): number {
    if (!this.archivoFocus) return -1;
    return this.archivosFiltradosBusqueda.findIndex(
      a => a.subRequisito.id === this.archivoFocus!.subRequisito.id
    );
  }

  get totalPendientes(): number {
    const doc = this.documentoSeleccionado;
    if (!doc) return 0;
    return doc.subRequisitos.filter(s => s.estado === 'pendiente' || s.estado === 'revision').length;
  }

  get totalAprobados(): number {
    const doc = this.documentoSeleccionado;
    if (!doc) return 0;
    return doc.subRequisitos.filter(s => s.estado === 'aprobado' && this.tieneContenidoEntregado(s)).length;
  }

  get totalRechazados(): number {
    const doc = this.documentoSeleccionado;
    if (!doc) return 0;
    return doc.subRequisitos.filter(s => s.estado === 'rechazado' && this.tieneContenidoEntregado(s)).length;
  }

  get totalAprobadosGlobal(): number {
    return this.archivosPlanos.filter(a => a.subRequisito.estado === 'aprobado').length;
  }

  volver(): void {
    this.router.navigate(['/proteccion-civil'], {
      queryParams: {
        vista: 'menuDocumentos',
        empresaId: this.empresaId || undefined
      }
    });
  }

  cancelarAsignacion(doc: DocumentoRevision): void {
    if (!this.empresaId) return;

    Swal.fire({
      title: '<i class="fas fa-exclamation-triangle text-danger"></i> Cancelar asignación',
      html: `<p>¿Estás seguro de cancelar la asignación de <strong>${doc.nombre}</strong>?</p><p class="text-muted small">Se eliminarán el documento y todos sus sub-requisitos de esta empresa. Esta acción no se puede deshacer.</p>`,
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, cancelar asignación',
      cancelButtonText: 'No, mantener'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendService.cancelarAsignacionDocumentoPC(this.empresaId!, doc.id).subscribe(
          (resp: any) => {
            // Eliminar del array local
            this.documentos = this.documentos.filter(d => d.id !== doc.id);
            // Si el eliminado era el seleccionado, seleccionar el primero disponible
            if (this.documentoSeleccionadoId === doc.id) {
              this.documentoSeleccionadoId = this.documentos.length > 0 ? this.documentos[0].id : null;
            }
            Swal.fire({
              icon: 'success',
              title: 'Asignación cancelada',
              html: `<strong>${doc.nombre}</strong> ha sido eliminado.`,
              confirmButtonColor: '#d97248',
              timer: 2500,
              timerProgressBar: true
            });
          },
          (err: any) => {
            console.error('Error al cancelar asignación:', err);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cancelar la asignación.', confirmButtonColor: '#d97248' });
          }
        );
      }
    });
  }

  private obtenerPadreDeSub(subRequisito: SubRequisitoRevision): DocumentoRevision | null {
    return this.documentos.find(d => d.subRequisitos.some(s => s.id === subRequisito.id)) || null;
  }

  private async todosAsignacionesCompletasConResolutivo(): Promise<boolean> {
    if (!this.empresaId) return false;
    const completadas = this.documentos.filter(d => this.esDocumentoCompletado(d));
    if (!completadas.length) return false;

    try {
      const resp: any = await firstValueFrom(this.backendService.listarResolutivosPC(this.empresaId));
      const registrados = new Set(
        (resp?.resolutivos || [])
          .map((r: any) => String(r.documento_asignacion_pc_id || ''))
          .filter(Boolean)
      );
      return completadas.every(d => registrados.has(String(d.id)));
    } catch {
      return false;
    }
  }

  /** True si aprobar este sub-requisito completaría la asignación padre. */
  private completariaAsignacionSiSeAprueba(padre: DocumentoRevision, sub: SubRequisitoRevision): boolean {
    if (sub.estado === 'aprobado') return false;
    return padre.subRequisitos.every(s => s.id === sub.id || s.estado === 'aprobado');
  }

  /** Modal SP-F-29 deshabilitado: resolutivo en centro de operaciones. */
  private async registrarResolutivoAsignacionSiPendiente(_padre: DocumentoRevision): Promise<boolean> {
    return true;
  }

  private async intentarAutoFinalizarRevision(): Promise<void> {
    if (!this.empresaId) return;
    const todoAprobado = this.documentos.length > 0 &&
      this.documentos.every(d => d.subRequisitos.every(s => s.estado === 'aprobado'));
    if (!todoAprobado) return;

    const conResolutivo = await this.todosAsignacionesCompletasConResolutivo();
    if (!conResolutivo) return;

    this.autoFinalizarRevision();
  }

  private autoFinalizarRevision(): void {
    if (!this.empresaId) return;
    this.backendService.finalizarRevisionPC(this.empresaId).subscribe(
      () => {
        // Vaciar lista localmente — muestra estado vacío sin recargar
        this.documentos = [];
        this.documentoSeleccionadoId = null;
      },
      (err: any) => {
        console.error('Error en auto-finalizar revisión:', err);
        // Si falla, recargar igualmente para mostrar estado real
        this.cargarDocumentosDesdeBackend();
      }
    );
  }

  finalizarRevision(): void {
    if (!this.empresaId) return;

    const aprobados = this.totalAprobadosGlobal;
    const rechazados = this.archivosPlanos.filter(a => a.subRequisito.estado === 'rechazado').length;

    Swal.fire({
      title: '<i class="fas fa-flag-checkered" style="color: #d97248;"></i> Finalizar revisión',
      html: `<p>Se eliminarán <strong>${aprobados}</strong> documento(s) aprobado(s) de la asignación.</p>` +
            (rechazados > 0 ? `<p>Se conservarán <strong>${rechazados}</strong> documento(s) rechazado(s) para que la empresa los corrija.</p>` : '') +
            `<p class="text-muted small">Los documentos aprobados ya fueron copiados al historial.</p>`,
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-flag-checkered mr-1"></i> Finalizar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendService.finalizarRevisionPC(this.empresaId!).subscribe(
          (resp: any) => {
            Swal.fire({
              icon: 'success',
              title: 'Revisión finalizada',
              html: resp.message || 'Documentos aprobados eliminados correctamente.',
              confirmButtonColor: '#d97248'
            }).then(() => {
              // Recargar documentos desde backend
              this.cargarDocumentosDesdeBackend();
            });
          },
          (err: any) => {
            console.error('Error al finalizar revisión:', err);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo finalizar la revisión.', confirmButtonColor: '#d97248' });
          }
        );
      }
    });
  }

  setEstadoFiltro(estado: EstadoFiltro): void {
    this.estadoFiltro = estado;
    this.seleccionarPrimerArchivoVisible();
  }

  onBusquedaRevisionChange(): void {
    const lista = this.archivosFiltradosBusqueda;
    if (!lista.length) {
      this.archivoFocus = null;
      this.limpiarPreviewUrl();
      this.urlPreview = '';
      this.nombrePreview = '';
      return;
    }
    if (!this.archivoFocus || !lista.some(a => a.subRequisito.id === this.archivoFocus!.subRequisito.id)) {
      this.seleccionarArchivoRevision(lista[0]);
    }
  }

  seleccionarArchivoRevision(item: ArchivoPlano): void {
    this.archivoFocus = item;
    this.cerrarPanelRechazo();
    this.cerrarVisorLocal();
  }

  abrirDocumentoEnVisor(item?: ArchivoPlano, archivoIndex = 0): void {
    const foco = item || this.archivoFocus;
    if (!foco) return;
    const sub = foco.subRequisito;
    if (sub.tipo_entrada === 'texto' || sub.archivos.length === 0) return;

    const solicitud = this.aSolicitudVisor(foco, archivoIndex);
    this.cerrarPanelRechazo();

    if (this.embebido) {
      this.solicitarVisor.emit(solicitud);
      return;
    }

    this.abrirVisorLocal(solicitud);
  }

  getDrivePreviewUrlArchivo(archivo: ArchivoEntregado): string {
    if (!archivo.driveFileId) return '';
    return this.getDrivePreviewUrl(archivo.driveFileId);
  }

  private aSolicitudVisor(item: ArchivoPlano, archivoIndex = 0): PcVisorDocumentoRequest {
    const idx = Math.max(0, Math.min(archivoIndex, item.subRequisito.archivos.length - 1));
    const archivo = item.subRequisito.archivos[idx];
    return {
      documento_id: Number(item.subRequisito.id),
      nombre_archivo: archivo.nombre,
      archivo_url: archivo.driveFileId || null,
      nombre_documento: item.subRequisito.nombre
    };
  }

  private abrirVisorLocal(solicitud: PcVisorDocumentoRequest): void {
    this.nombreVisorLocal = solicitud.nombre_archivo || solicitud.nombre_documento || '';
    this.documentoVisorLocalId = solicitud.documento_id;
    this.mostrarVisorLocal = true;
    this.cargandoVisorLocal = true;
    document.body.classList.add('visor-fullscreen-open');

    if (solicitud.archivo_url) {
      this.urlVisorLocal = this.getDrivePreviewUrl(solicitud.archivo_url);
      this.cargandoVisorLocal = false;
      return;
    }

    this.backendService.descargarArchivoProteccionCivil(solicitud.documento_id).subscribe(
      (blob: Blob) => {
        this.urlVisorLocal = URL.createObjectURL(blob);
        this.cargandoVisorLocal = false;
      },
      (error) => {
        console.error('Error al cargar archivo de PC:', error);
        this.cargandoVisorLocal = false;
        Swal.fire('Error', 'No se pudo cargar el archivo desde Google Drive', 'error');
        this.cerrarVisorLocal();
      }
    );
  }

  cerrarVisorLocal(): void {
    this.mostrarVisorLocal = false;
    if (this.urlVisorLocal.startsWith('blob:')) {
      URL.revokeObjectURL(this.urlVisorLocal);
    }
    this.urlVisorLocal = '';
    this.nombreVisorLocal = '';
    this.cargandoVisorLocal = false;
    this.documentoVisorLocalId = null;
    document.body.classList.remove('visor-fullscreen-open');
  }

  descargarDesdeVisorLocal(): void {
    if (!this.documentoVisorLocalId) return;
    this.backendService.descargarArchivoProteccionCivil(this.documentoVisorLocalId).subscribe(
      (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.nombreVisorLocal || 'documento';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      () => {
        Swal.fire('Error', 'No se pudo descargar el archivo', 'error');
      }
    );
  }

  togglePanelRechazo(): void {
    this.mostrarFormularioRechazo = !this.mostrarFormularioRechazo;
    if (this.mostrarFormularioRechazo) {
      this.cerrarVisorLocal();
    }
    if (!this.mostrarFormularioRechazo && this.archivoFocus) {
      this.archivoFocus.subRequisito.comentarioActual = '';
    }
  }

  cerrarPanelRechazo(): void {
    this.mostrarFormularioRechazo = false;
    if (this.archivoFocus) {
      this.archivoFocus.subRequisito.comentarioActual = '';
    }
  }

  motivoRechazoValido(subRequisito: SubRequisitoRevision): boolean {
    return !!(subRequisito.comentarioActual || '').trim();
  }

  confirmarRechazoSubRequisito(subRequisito: SubRequisitoRevision): void {
    if (!this.empresaId || this.procesandoAccion) return;
    const texto = (subRequisito.comentarioActual || '').trim();
    if (!texto) return;

    this.procesandoAccion = true;
    this.realizarRechazo(subRequisito, texto);
  }

  seleccionarPrimerArchivoVisible(): void {
    const lista = this.archivosFiltradosBusqueda;
    if (lista.length > 0) {
      this.seleccionarArchivoRevision(lista[0]);
    } else {
      this.archivoFocus = null;
      this.limpiarPreviewUrl();
      this.urlPreview = '';
      this.nombrePreview = '';
      this.cargandoPreview = false;
    }
  }

  irAlSiguientePendienteRevision(): void {
    const doc = this.documentoSeleccionado;
    if (!doc) return;

    const pendientes = doc.subRequisitos.filter(
      s => (s.estado === 'pendiente' || s.estado === 'revision') && this.tieneContenidoEntregado(s)
    );
    if (pendientes.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Sin pendientes',
        text: 'No hay documentos cargados pendientes de revisión en este grupo.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    if (this.estadoFiltro !== 'pendiente') {
      this.estadoFiltro = 'pendiente';
    }

    const pendientesPlano = pendientes.map(s => ({ subRequisito: s, documentoPadre: doc }));
    const actualId = this.archivoFocus?.subRequisito.id;
    let index = pendientesPlano.findIndex(p => p.subRequisito.id === actualId);
    index = index < 0 ? 0 : (index + 1) % pendientesPlano.length;
    this.busquedaRevision = '';
    this.seleccionarArchivoRevision(pendientesPlano[index]);
  }

  navegarPreview(direccion: 'prev' | 'next'): void {
    const lista = this.archivosFiltradosBusqueda;
    const index = this.indicePreviewActual;
    if (index === -1 || lista.length === 0) return;

    const nuevoIndex = direccion === 'next' ? index + 1 : index - 1;
    if (nuevoIndex >= 0 && nuevoIndex < lista.length) {
      this.seleccionarArchivoRevision(lista[nuevoIndex]);
    }
  }

  puedeNavegarPreview(direccion: 'prev' | 'next'): boolean {
    const index = this.indicePreviewActual;
    if (index === -1) return false;
    return direccion === 'next'
      ? index < this.archivosFiltradosBusqueda.length - 1
      : index > 0;
  }

  getClaseEstatusRevision(estado: EstadoSubRequisito): string {
    switch (estado) {
      case 'aprobado': return 'is-approved';
      case 'rechazado': return 'is-rejected';
      case 'revision': return 'is-review';
      default: return 'is-pending';
    }
  }

  getEtiquetaEstatusRevision(estado: EstadoSubRequisito): string {
    switch (estado) {
      case 'aprobado': return 'Aprobado';
      case 'rechazado': return 'Rechazado';
      case 'revision': return 'En revisión';
      default: return 'Pendiente';
    }
  }

  private notificarRevisionActualizada(): void {
    if (this.embebido) {
      this.revisionActualizada.emit();
    }
  }

  getEtiquetaNavRevision(item: ArchivoPlano): string {
    if (item.subRequisito.estado === 'pendiente' && !this.tieneContenidoEntregado(item.subRequisito)) {
      return 'Sin entrega';
    }
    return this.getEtiquetaEstatusRevision(item.subRequisito.estado);
  }

  getClaseEstatusNavRevision(item: ArchivoPlano): string {
    if (item.subRequisito.estado === 'pendiente' && !this.tieneContenidoEntregado(item.subRequisito)) {
      return 'is-awaiting';
    }
    return this.getClaseEstatusRevision(item.subRequisito.estado);
  }

  puedeGestionarRevision(sub: SubRequisitoRevision): boolean {
    return this.tieneContenidoEntregado(sub);
  }

  ultimoComentarioRechazo(sub: SubRequisitoRevision): string {
    const rechazo = sub.historialComentarios.find(h => h.accion === 'rechazado');
    return rechazo ? rechazo.texto : '';
  }

  onPreviewMediaLoad(): void {
    this.cancelarPreviewTimeout();
    this.cargandoPreview = false;
    this.previewError = false;
  }

  onPreviewError(): void {
    this.cancelarPreviewTimeout();
    this.cargandoPreview = false;
    this.previewError = true;
  }

  onPreviewIframeLoad(): void {
    this.onPreviewMediaLoad();
  }

  private cargarPreview(item: ArchivoPlano): void {
    const loadToken = ++this.previewLoadToken;
    this.cancelarPreviewTimeout();
    this.urlPreview = '';
    this.nombrePreview = '';
    this.previewModo = null;
    this.previewError = false;
    this.cargandoPreview = false;

    const sub = item.subRequisito;

    if (sub.tipo_entrada === 'texto') {
      this.nombrePreview = sub.nombre;
      return;
    }

    if (sub.archivos.length === 0) {
      return;
    }

    const archivo = sub.archivos[0];
    this.nombrePreview = archivo.nombre;

    if (archivo.driveFileId) {
      this.previewModo = 'embed';
      this.urlPreview = this.getDrivePreviewUrl(archivo.driveFileId);
      this.cargandoPreview = false;
      this.previewError = false;
      return;
    }

    const modo = this.detectarPreviewModo(archivo.nombre);

    const cached = this.previewBlobCache.get(archivo.id);
    if (cached) {
      this.previewModo = modo;
      this.urlPreview = cached;
      return;
    }

    this.cargarPreviewBlob(archivo, modo, loadToken);
  }

  private cargarPreviewBlob(archivo: ArchivoEntregado, modo: PreviewModo, loadToken: number): void {
    const cached = this.previewBlobCache.get(archivo.id);
    if (cached) {
      this.previewModo = modo;
      this.urlPreview = cached;
      this.cargandoPreview = false;
      return;
    }

    this.previewModo = modo;
    this.cargandoPreview = true;
    this.iniciarPreviewTimeout(120000);

    const docId = Number(archivo.id);
    this.backendService.vistaPreviaArchivoProteccionCivil(docId).subscribe({
      next: async (blob: Blob) => {
        if (loadToken !== this.previewLoadToken) {
          return;
        }
        if (!this.esBlobVistaPreviaValido(blob)) {
          this.cargandoPreview = false;
          this.previewError = true;
          this.cancelarPreviewTimeout();
          return;
        }
        try {
          const modoFinal = await this.resolverModoDesdeBlob(blob, archivo.nombre);
          const previewUrl = await this.crearUrlVistaPrevia(blob, archivo.nombre, modoFinal);
          if (loadToken !== this.previewLoadToken) {
            if (previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(previewUrl);
            }
            return;
          }
          this.previewBlobCache.set(archivo.id, previewUrl);
          this.previewModo = modoFinal;
          this.urlPreview = previewUrl;
          this.previewError = false;
          this.cargandoPreview = false;
          this.cancelarPreviewTimeout();
        } catch (e) {
          console.error('Error al preparar vista previa:', e);
          this.cargandoPreview = false;
          this.previewError = true;
          this.cancelarPreviewTimeout();
        }
      },
      error: (err: any) => {
        if (loadToken !== this.previewLoadToken) {
          return;
        }
        console.error('Error al cargar vista previa:', err);
        this.cargandoPreview = false;
        this.previewError = true;
        this.cancelarPreviewTimeout();
      }
    });
  }

  private esBlobVistaPreviaValido(blob: Blob | null | undefined): boolean {
    if (!blob || blob.size === 0) {
      return false;
    }
    const type = (blob.type || '').toLowerCase();
    return !type.includes('application/json') && !type.includes('text/html');
  }

  private async resolverModoDesdeBlob(blob: Blob, nombreArchivo: string): Promise<PreviewModo> {
    const porNombre = this.detectarPreviewModo(nombreArchivo);
    const type = (blob.type || '').toLowerCase();

    if (porNombre === 'imagen' || type.startsWith('image/')) {
      return 'imagen';
    }

    const firmado = await this.sniffMimeDesdeBlob(blob);
    if (firmado?.startsWith('image/')) {
      return 'imagen';
    }
    if (firmado === 'application/pdf' || type === 'application/pdf') {
      return 'pdf';
    }
    if (porNombre === 'pdf') {
      return 'pdf';
    }
    return porNombre;
  }

  private async sniffMimeDesdeBlob(blob: Blob): Promise<string | null> {
    const buf = await blob.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return 'image/jpeg';
    }
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return 'image/png';
    }
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return 'image/gif';
    }
    if (b.length >= 12) {
      const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
      const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (riff === 'RIFF' && webp === 'WEBP') {
        return 'image/webp';
      }
    }
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
      return 'application/pdf';
    }
    return null;
  }

  private async crearUrlVistaPrevia(blob: Blob, nombreArchivo: string, modo: PreviewModo): Promise<string> {
    const typedBlob = this.tiparBlobVistaPrevia(blob, nombreArchivo, modo);
    if (modo === 'imagen') {
      return this.blobImagenADataUrl(typedBlob);
    }
    return URL.createObjectURL(typedBlob);
  }

  private blobImagenADataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(blob);
    });
  }

  private tiparBlobVistaPrevia(blob: Blob, nombreArchivo: string, modo: PreviewModo): Blob {
    const ext = (nombreArchivo || '').split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      jfif: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp'
    };
    const mime =
      (blob.type && blob.type !== 'application/octet-stream' ? blob.type : '') ||
      mimeMap[ext] ||
      (modo === 'imagen' ? 'image/jpeg' : modo === 'pdf' ? 'application/pdf' : '');
    if (!mime || blob.type === mime) {
      return blob;
    }
    return new Blob([blob], { type: mime });
  }

  private detectarPreviewModo(nombreArchivo: string): PreviewModo {
    const ext = (nombreArchivo || '').split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
      return 'imagen';
    }
    return 'pdf';
  }

  private iniciarPreviewTimeout(ms = 25000): void {
    this.cancelarPreviewTimeout();
    this.previewTimeoutId = setTimeout(() => {
      if (this.cargandoPreview) {
        this.cargandoPreview = false;
        this.previewError = true;
      }
    }, ms);
  }

  private cancelarPreviewTimeout(): void {
    if (this.previewTimeoutId) {
      clearTimeout(this.previewTimeoutId);
      this.previewTimeoutId = null;
    }
  }

  private limpiarPreviewUrl(): void {
    // Las URLs en caché se liberan en ngOnDestroy.
  }

  tieneContenidoEntregado(sub: SubRequisitoRevision): boolean {
    if (sub.tipo_entrada === 'texto') {
      return !!(sub.valor_texto || '').trim();
    }
    return sub.archivos.length > 0;
  }

  getDrivePreviewUrl(driveFileId: string): string {
    return `https://drive.google.com/file/d/${driveFileId}/preview`;
  }

  private coincideBusquedaRevision(item: ArchivoPlano, term: string): boolean {
    const sub = item.subRequisito;
    const nombre = (sub.nombre || '').toLowerCase();
    const texto = (sub.valor_texto || '').toLowerCase();
    const archivo = sub.archivos.length > 0 ? (sub.archivos[0].nombre || '').toLowerCase() : '';
    return nombre.includes(term) || texto.includes(term) || archivo.includes(term);
  }

  private avanzarTrasAccion(subRequisito: SubRequisitoRevision): void {
    const lista = this.archivosFiltradosBusqueda.filter(a => a.subRequisito.id !== subRequisito.id);
    if (lista.length > 0) {
      this.seleccionarArchivoRevision(lista[0]);
    } else {
      this.archivoFocus = null;
      this.limpiarPreviewUrl();
      this.urlPreview = '';
      this.nombrePreview = '';
    }
  }

  esFiltroActivo(estado: EstadoFiltro): boolean {
    return this.estadoFiltro === estado;
  }

  trackByArchivoPlano(index: number, item: ArchivoPlano): string {
    return item.subRequisito.id;
  }

  toggleMenu(subRequisitoId: string, event: MouseEvent, tipo: 'padre' | 'item' = 'item'): void {
    event.stopPropagation();

    if (this.menuAbiertoId === subRequisitoId) {
      this.cerrarMenu();
      return;
    }

    // Menú del documento padre: anclado al botón (evita desfase por transform en pc-view-enter-content).
    if (tipo === 'padre') {
      this.menuAbiertoId = subRequisitoId;
      return;
    }

    const trigger = event.currentTarget as HTMLElement;
    if (!trigger) {
      this.menuAbiertoId = subRequisitoId;
      return;
    }

    const viewportPadding = 10;
    const menuWidth = 320;
    const menuHeight = 320;
    const rect = trigger.getBoundingClientRect();

    let left = rect.right - menuWidth;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding));

    let top = rect.top - 8;

    if (top < viewportPadding) {
      top = rect.bottom + 8;
    }

    if (top + menuHeight > window.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    }

    this.menuPosition = { top: Math.round(top), left: Math.round(left) };
    this.menuAnchoPx = menuWidth;
    this.menuAbiertoId = subRequisitoId;
  }

  get menuFlotanteStyle(): { [key: string]: string } {
    return {
      position: 'fixed',
      top: `${this.menuPosition.top}px`,
      left: `${this.menuPosition.left}px`,
      width: `${this.menuAnchoPx}px`,
      zIndex: '9999'
    };
  }

  cerrarMenu(): void {
    this.menuAbiertoId = null;
  }

  guardarComentarioSubRequisito(subRequisito: SubRequisitoRevision): void {
    const texto = (subRequisito.comentarioActual || '').trim();
    if (!texto) {
      return;
    }

    if (!this.empresaId) return;
    const docId = Number(subRequisito.id);

    this.backendService.guardarComentarioDocumentoPC(this.empresaId, docId, texto).subscribe(
      () => {
        subRequisito.historialComentarios.unshift({
          id: `cmt-${Date.now()}-${subRequisito.id}`,
          autor: 'Administrador',
          fecha: this.fechaActualTexto(),
          texto,
          accion: 'comentario'
        });
        subRequisito.comentarioActual = '';
      },
      (err: any) => {
        console.error('Error al guardar comentario:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar el comentario.', confirmButtonColor: '#d97248' });
      }
    );
  }

  aprobarSubRequisito(subRequisito: SubRequisitoRevision): void {
    if (!this.empresaId) return;
    this.cerrarPanelRechazo();
    const docId = Number(subRequisito.id);
    const texto = 'Sub-requisito aprobado en revisión administrativa.';

    Swal.fire({
      title: '<i class="fas fa-check-circle text-success"></i> Aprobar sub-requisito',
      html: `<p>¿Aprobar <strong>${subRequisito.nombre}</strong>?</p>`,
      showCancelButton: true,
      confirmButtonColor: '#28a745',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-check mr-1"></i> Aprobar',
      cancelButtonText: 'Cancelar'
    }).then(async (result) => {
      if (!result.isConfirmed) return;

      const padre = this.obtenerPadreDeSub(subRequisito);
      const completariaAsignacion = padre && this.completariaAsignacionSiSeAprueba(padre, subRequisito);

      if (completariaAsignacion && padre) {
        const registrado = await this.registrarResolutivoAsignacionSiPendiente(padre);
        if (!registrado) return;
      }

      this.backendService.actualizarEstatusDocumentoPC(this.empresaId!, docId, 'aprobado').subscribe(
        async () => {
          subRequisito.estado = 'aprobado';
          subRequisito.historialComentarios.unshift({
            id: `apr-${Date.now()}-${subRequisito.id}`,
            autor: 'Administrador',
            fecha: this.fechaActualTexto(),
            texto,
            accion: 'aprobado'
          });
          subRequisito.comentarioActual = '';

          this.avanzarTrasAccion(subRequisito);

          if (completariaAsignacion) {
            await this.intentarAutoFinalizarRevision();
            this.notificarRevisionActualizada();
            return;
          }

          this.notificarRevisionActualizada();
          Swal.fire({
            icon: 'success',
            title: '¡Aprobado!',
            html: `<strong>${subRequisito.nombre}</strong> ha sido aprobado.`,
            confirmButtonColor: '#d97248',
            timer: 2500,
            timerProgressBar: true
          });
        },
        (err: any) => {
          console.error('Error al aprobar:', err);
          Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo aprobar el sub-requisito.', confirmButtonColor: '#d97248' });
        }
      );
    });
  }

  private realizarRechazo(subRequisito: SubRequisitoRevision, texto: string): void {
    const docId = Number(subRequisito.id);
    this.backendService.actualizarEstatusDocumentoPC(this.empresaId!, docId, 'rechazado').subscribe(
      () => {
        subRequisito.estado = 'rechazado';
        this.backendService.guardarComentarioDocumentoPC(this.empresaId!, docId, texto).subscribe();

        subRequisito.historialComentarios.unshift({
          id: `rej-${Date.now()}-${subRequisito.id}`,
          autor: 'Administrador',
          fecha: this.fechaActualTexto(),
          texto,
          accion: 'rechazado'
        });
        subRequisito.comentarioActual = '';
        this.cerrarPanelRechazo();
        this.avanzarTrasAccion(subRequisito);
        this.notificarRevisionActualizada();

        Swal.fire({
          icon: 'error',
          title: 'Documento rechazado',
          html: `<p><strong>${subRequisito.nombre}</strong> fue rechazado.</p><p class="text-muted small">Motivo: ${texto}</p>`,
          confirmButtonColor: '#d97248'
        });
      },
      (err: any) => {
        console.error('Error al rechazar:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo rechazar el sub-requisito.', confirmButtonColor: '#d97248' });
      },
      () => {
        this.procesandoAccion = false;
      }
    );
  }

  descargarArchivo(archivo: ArchivoEntregado): void {
    const docId = Number(archivo.id);
    this.backendService.descargarArchivoProteccionCivil(docId).subscribe(
      (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = archivo.nombre || 'archivo';
        a.click();
        URL.revokeObjectURL(url);
      },
      (err: any) => {
        console.error('Error al descargar archivo:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo descargar el archivo.', confirmButtonColor: '#d97248' });
      }
    );
  }

  getEstadoSubRequisitoClase(estado: EstadoSubRequisito): string {
    switch (estado) {
      case 'aprobado':
        return 'badge-success';
      case 'rechazado':
        return 'badge-danger';
      default:
        return 'badge-warning';
    }
  }

  getEstadoSubRequisitoTexto(estado: EstadoSubRequisito): string {
    switch (estado) {
      case 'aprobado':
        return 'Aprobado';
      case 'rechazado':
        return 'Rechazado';
      default:
        return 'Pendiente';
    }
  }

  trackByDocumento(index: number, documento: DocumentoRevision): string {
    return documento.id;
  }

  trackBySubRequisito(index: number, subRequisito: SubRequisitoRevision): string {
    return subRequisito.id;
  }

  trackByArchivo(index: number, archivo: ArchivoEntregado): string {
    return archivo.id;
  }

  getAccionBadgeClase(accion: ComentarioHistorial['accion']): string {
    if (accion === 'aprobado') return 'badge-success';
    if (accion === 'rechazado') return 'badge-danger';
    return 'badge-info';
  }

  borrarAsignacionIndividual(item: ArchivoPlano): void {
    if (!this.empresaId) return;
    const subId = Number(item.subRequisito.id);

    Swal.fire({
      title: '<i class="fas fa-exclamation-triangle text-danger"></i> Borrar asignación',
      html: `<p>¿Eliminar <strong>${item.subRequisito.nombre}</strong>?</p><p class="text-muted small">Se eliminará este sub-requisito individual. Esta acción no se puede deshacer.</p>`,
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash-alt mr-1"></i> Sí, borrar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendService.cancelarAsignacionDocumentoPC(this.empresaId!, subId).subscribe(
          () => {
            // Quitar del array local del documento padre
            const padre = item.documentoPadre;
            padre.subRequisitos = padre.subRequisitos.filter(s => s.id !== item.subRequisito.id);
            // Si el padre quedó sin hijos, eliminarlo también
            if (padre.subRequisitos.length === 0) {
              this.documentos = this.documentos.filter(d => d.id !== padre.id);
              if (this.documentoSeleccionadoId === padre.id) {
                this.documentoSeleccionadoId = this.documentos.length > 0 ? this.documentos[0].id : null;
              }
            }
            this.seleccionarPrimerArchivoVisible();
            Swal.fire({
              icon: 'success',
              title: 'Asignación eliminada',
              html: `<strong>${item.subRequisito.nombre}</strong> ha sido eliminado.`,
              confirmButtonColor: '#d97248',
              timer: 2500,
              timerProgressBar: true
            });
          },
          (err: any) => {
            console.error('Error al borrar asignación individual:', err);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo borrar la asignación.', confirmButtonColor: '#d97248' });
          }
        );
      }
    });
  }

  private fechaActualTexto(): string {
    const ahora = new Date();
    return ahora.toLocaleString('es-MX');
  }
}
