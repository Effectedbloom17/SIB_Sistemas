import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import {
  resolverDestinoFormatoSistema,
  tooltipDestinoFormato
} from './sgc-formato-navegacion.catalog';
import {
  resolverPlantillaCentroSgcPorCodigo,
  tipoIconoPlantilla
} from './sgc-formatos.catalog';
import {
  resolverPlantillaDriveId,
  resolverSistemaDriveIdFijo
} from './sgc-plantillas-drive.ids';
import { TIPO_SOLICITUD_LABELS } from './sgc-solicitud-documentos.util';

/** Responsable por defecto de cambios a la Lista Maestra SGC. */
export const RESPONSABLE_LISTA_MAESTRA_SGC = 'Ing. Sergio Luis Guzmán Vigueras';

export type PasoFlujoSgc = 'revision' | 'formato' | 'lista_maestra' | 'notificar' | 'cerrado';
type FiltroGestion = 'todos' | 'autorizar' | 'gestion' | 'completadas';
type AccionGestion =
  | 'autorizar'
  | 'declinar'
  | 'borrar'
  | 'reemplazar'
  | 'formato'
  | 'lista'
  | 'cerrar'
  | 'regresar';
type TipoArchivoGestion = 'pdf' | 'excel' | 'word' | 'pptx' | 'otro';

export interface SgcSolicitudDocumentoItem {
  solicitud_id: number;
  usuario_id: number;
  nombre_documento: string;
  codigo: string;
  version_actual: string;
  tipo_documento: string;
  tipo_solicitud: 'creacion' | 'modificacion' | 'eliminacion' | string;
  tipo_solicitud_label?: string;
  motivo: string;
  estado: 'abierto' | 'en_progreso' | 'cerrado' | string;
  paso_flujo: PasoFlujoSgc;
  paso_flujo_label?: string;
  formato_listo?: boolean;
  lista_maestra_listo?: boolean;
  version_nueva?: string;
  fecha_revision_nueva?: string | null;
  drive_file_id?: string;
  catalog_key?: string;
  notas_cambio?: string;
  activo?: boolean;
  declinado?: boolean;
  notificar_sistemas?: boolean | null;
  ticket_sistemas_id?: number | null;
  nombre_solicitante: string;
  puesto_solicitante: string;
  fecha_solicitud?: string;
  created_at: string;
  updated_at?: string;
  autorizado_at?: string | null;
  autor_nombre?: string;
  autor_usuario?: string;
}

interface DocumentoMaestroSgc {
  codigo?: string;
  area?: string;
  tipo?: string;
  especie?: string;
  versionVigente?: string;
  fechaRevision?: string;
  nombreDocumento?: string;
  responsable?: string;
}

interface FormatoDescargaContexto {
  origen?: string;
  catalog_key?: string;
  codigo?: string;
  titulo?: string;
  nombre_archivo?: string;
  drive_file_id_actual?: string;
  plantilla_drive_file_id?: string;
  sistema_drive_file_id?: string;
  version_actual?: number;
}

interface PropuestaGestion {
  versionNueva?: string;
  versionAnterior?: string;
  fechaRevisionNueva?: string;
  fechaHoyMexico?: string;
  desactivar?: boolean;
}

interface ContextoGestion {
  solicitud: SgcSolicitudDocumentoItem;
  documentoMaestro: DocumentoMaestroSgc | null;
  formatoDescarga: FormatoDescargaContexto | null;
  propuesta: PropuestaGestion;
}

interface ListaMaestraForm {
  codigo: string;
  area: string;
  tipo: string;
  especie: string;
  versionVigente: string;
  fechaRevision: string;
  fechaSolicitud: string;
  nombreDocumento: string;
  responsable: string;
}

@Component({
  selector: 'app-sgc-solicitud-documentos',
  templateUrl: './sgc-solicitud-documentos.component.html',
  styleUrls: ['./sgc-solicitud-documentos.component.scss']
})
export class SgcSolicitudDocumentosComponent implements OnInit, OnDestroy {
  solicitudes: SgcSolicitudDocumentoItem[] = [];
  cargando = false;
  error: string | null = null;
  filtroEstado: FiltroGestion = 'todos';
  busqueda = '';
  expandidoId: number | null = null;
  seleccionadoId: number | null = null;
  paginaActual = 1;
  readonly solicitudesPorPagina = 9;

  contexto: ContextoGestion | null = null;
  cargandoContextoId: number | null = null;
  accionId: number | null = null;
  accionActual: AccionGestion | null = null;
  errorGestion: string | null = null;
  mensajeGestion: string | null = null;
  archivoNuevo: File | null = null;
  editorAbierto = false;
  editorUrl: SafeResourceUrl | null = null;
  editorCargando = false;
  editorEsPlantilla = false;
  visorDocumentoAbierto = false;
  visorDocumentoUrl: SafeResourceUrl | null = null;
  visorCargando = false;
  miniaturaError = false;
  notificarSeleccion: boolean | null = null;
  descripcionSistemas = '';
  listaMaestraForm: ListaMaestraForm = this.crearListaMaestraVacia();

  readonly filtros: Array<{ valor: FiltroGestion; label: string }> = [
    { valor: 'todos', label: 'Todos' },
    { valor: 'autorizar', label: 'Por autorizar' },
    { valor: 'gestion', label: 'En gestión' },
    { valor: 'completadas', label: 'Completadas' }
  ];

  readonly pasos = [
    { numero: 1, titulo: 'Autorización', corto: 'Autorización' },
    { numero: 2, titulo: 'Revisión', corto: 'Revisión' },
    { numero: 3, titulo: 'Cambio en la Lista maestra', corto: 'Lista maestra' },
    { numero: 4, titulo: 'Notificar a Sistemas', corto: 'Notificar' }
  ];

  private readonly destroy$ = new Subject<void>();
  private bodyOverflowAnterior = '';

  constructor(
    private backend: BackendServices,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    document.body.classList.remove('sgc-editor-open');
    document.body.style.overflow = this.bodyOverflowAnterior;
    this.destroy$.next();
    this.destroy$.complete();
  }

  get solicitudesFiltradas(): SgcSolicitudDocumentoItem[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.solicitudes.filter((solicitud) => {
      const coincideFiltro =
        this.filtroEstado === 'todos'
        || (this.filtroEstado === 'autorizar'
          && (solicitud.paso_flujo === 'revision' || solicitud.estado === 'abierto'))
        || (this.filtroEstado === 'gestion' && solicitud.estado === 'en_progreso')
        || (this.filtroEstado === 'completadas' && solicitud.estado === 'cerrado');
      if (!coincideFiltro) return false;
      if (!q) return true;
      return [
        solicitud.solicitud_id, solicitud.codigo, solicitud.nombre_documento,
        solicitud.motivo, this.tipoSolicitudLabel(solicitud.tipo_solicitud),
        this.autorLabel(solicitud), this.puestoLabel(solicitud), this.estadoLabel(solicitud.estado, solicitud),
        this.pasoLabel(solicitud.paso_flujo)
      ].some((valor) => String(valor || '').toLowerCase().includes(q));
    });
  }

  get totalSolicitudes(): number {
    return this.solicitudes.length;
  }

  get porAutorizar(): number {
    return this.solicitudes.filter(
      (s) => s.paso_flujo === 'revision' || s.estado === 'abierto'
    ).length;
  }

  get enGestion(): number {
    return this.solicitudes.filter((s) => s.estado === 'en_progreso').length;
  }

  get completadas(): number {
    return this.solicitudes.filter((s) => s.estado === 'cerrado').length;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.solicitudesFiltradas.length / this.solicitudesPorPagina));
  }

  get solicitudesPaginadas(): SgcSolicitudDocumentoItem[] {
    const inicio = (this.paginaActual - 1) * this.solicitudesPorPagina;
    return this.solicitudesFiltradas.slice(inicio, inicio + this.solicitudesPorPagina);
  }

  get paginasDisponibles(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, index) => index + 1);
  }

  get rangoPagina(): { desde: number; hasta: number } {
    if (!this.solicitudesFiltradas.length) return { desde: 0, hasta: 0 };
    const desde = (this.paginaActual - 1) * this.solicitudesPorPagina + 1;
    return {
      desde,
      hasta: Math.min(desde + this.solicitudesPorPagina - 1, this.solicitudesFiltradas.length)
    };
  }

  get solicitudesAgrupadas(): Array<{ etiqueta: string; solicitudes: SgcSolicitudDocumentoItem[] }> {
    const grupos: Array<{ etiqueta: string; solicitudes: SgcSolicitudDocumentoItem[] }> = [];
    for (const solicitud of this.solicitudesPaginadas) {
      const etiqueta = this.etiquetaGrupo(solicitud.created_at);
      const actual = grupos[grupos.length - 1];
      if (actual && actual.etiqueta === etiqueta) actual.solicitudes.push(solicitud);
      else grupos.push({ etiqueta, solicitudes: [solicitud] });
    }
    return grupos;
  }

  get solicitudActiva(): SgcSolicitudDocumentoItem | null {
    return this.contexto?.solicitud || null;
  }

  /** Archivo con datos (sistema) para vista previa — nunca la plantilla vacía. */
  get driveFileIdActivo(): string {
    const fmt = this.contexto?.formatoDescarga;
    const codigo = this.codigoDocumentoActivo;
    return String(
      fmt?.sistema_drive_file_id
      || resolverSistemaDriveIdFijo(codigo)
      || fmt?.drive_file_id_actual
      || this.contexto?.solicitud?.drive_file_id
      || ''
    ).trim();
  }

  /** Plantilla maestra (estructura) para Modificación menor. */
  get driveFileIdPlantilla(): string {
    const fmt = this.contexto?.formatoDescarga;
    const codigo = this.codigoDocumentoActivo;
    const plantilla = String(
      fmt?.plantilla_drive_file_id
      || resolverPlantillaDriveId(codigo)
      || ''
    ).trim();
    // Evitar usar el archivo sistema si por error viene el mismo ID.
    if (plantilla && plantilla !== this.driveFileIdActivo) {
      return plantilla;
    }
    return plantilla || resolverPlantillaDriveId(codigo);
  }

  get miniaturaDocumentoUrl(): string {
    return this.driveFileIdActivo
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(this.driveFileIdActivo)}&sz=w640`
      : '';
  }

  get driveDownloadUrl(): string {
    return this.driveFileIdActivo
      ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(this.driveFileIdActivo)}`
      : '';
  }

  get editorSubtitulo(): string {
    const codigo = this.solicitudActiva?.codigo || this.contexto?.formatoDescarga?.codigo || 'Documento';
    const nombre = this.solicitudActiva?.nombre_documento
      || this.contexto?.formatoDescarga?.titulo
      || 'Formato SGC';
    const tipo = this.tipoArchivoGestion === 'excel'
      ? 'Excel'
      : this.tipoArchivoGestion === 'word'
        ? 'Word'
        : this.tipoArchivoGestion === 'pptx'
          ? 'PowerPoint'
          : 'Documento';
    return this.editorEsPlantilla
      ? `${codigo} · ${nombre} · Plantilla ${tipo}`
      : `${codigo} · ${nombre}`;
  }

  get origenDocumentoLabel(): string {
    const origen = String(this.contexto?.formatoDescarga?.origen || '').toLowerCase();
    if (origen === 'formato_interactivo') return 'Formato interactivo';
    if (origen === 'formato_descarga') return 'Formato de descarga';
    if (origen.includes('instructivo')) return 'Instructivo';
    if (origen.includes('procedimiento')) return 'Procedimiento';
    return origen ? origen.replace(/_/g, ' ') : 'Documento solicitado';
  }

  /** Código activo de la solicitud (para ligar a Centro SGC). */
  get codigoDocumentoActivo(): string {
    return String(
      this.contexto?.formatoDescarga?.codigo
      || this.contexto?.solicitud?.codigo
      || this.listaMaestraForm?.codigo
      || ''
    ).trim();
  }

  /** Destino del formato dinámico (Centro SGC u otra área). */
  get destinoFormatoSistema() {
    return resolverDestinoFormatoSistema(
      this.codigoDocumentoActivo,
      this.authService.esSuperusuario()
    );
  }

  /** True si el documento tiene formato dinámico en el sistema. */
  get tieneFormatoSistema(): boolean {
    return !!this.destinoFormatoSistema;
  }

  get tooltipIrFormatoSistema(): string {
    return tooltipDestinoFormato(this.destinoFormatoSistema) || 'Ir al formato en el sistema';
  }

  /** Abre el formato dinámico (Centro SGC, Capacitación, PC, Mantenimiento, …). */
  irAlFormatoSistema(): void {
    const dest = this.destinoFormatoSistema;
    if (!dest) {
      this.errorGestion = 'Este documento no tiene formato dinámico en el sistema.';
      return;
    }
    const solicitudId = this.solicitudActiva?.solicitud_id;
    void this.router.navigate([dest.ruta], {
      queryParams: {
        ...(dest.queryParams || {}),
        ...(solicitudId ? { fromSolicitud: String(solicitudId) } : {})
      }
    });
  }

  get esSuperAdmin(): boolean {
    return this.authService.esRoot();
  }

  /** Clasificación real del archivo (PDF / Office) para reglas del wizard. */
  get tipoArchivoGestion(): TipoArchivoGestion {
    return this.detectarTipoArchivoGestion();
  }

  get esDocumentoPdf(): boolean {
    return this.tipoArchivoGestion === 'pdf';
  }

  get esDocumentoOffice(): boolean {
    return ['excel', 'word', 'pptx'].includes(this.tipoArchivoGestion);
  }

  get tipoArchivoActivo(): 'PDF' | 'Sheet' | 'Doc' {
    const tipo = this.tipoArchivoGestion;
    if (tipo === 'excel') return 'Sheet';
    if (tipo === 'word') return 'Doc';
    return 'PDF';
  }

  get iconoArchivoActivo(): string {
    const tipo = this.tipoArchivoGestion;
    if (tipo === 'excel') return 'fa-file-excel';
    if (tipo === 'word') return 'fa-file-word';
    if (tipo === 'pptx') return 'fa-file-powerpoint';
    return 'fa-file-pdf';
  }

  get formularioListaValido(): boolean {
    const f = this.listaMaestraForm;
    const fechaSolicitudOk = !this.esSuperAdmin || !!f.fechaSolicitud;
    return !!(f.codigo.trim() && f.area.trim() && f.tipo.trim() && f.especie.trim()
      && f.versionVigente.trim() && f.fechaRevision && f.nombreDocumento.trim()
      && f.responsable.trim() && fechaSolicitudOk);
  }

  cargar(): void {
    this.cargando = true;
    this.error = null;
    this.backend.obtenerSolicitudesDocumentosSgc()
      .pipe(
        finalize(() => {
          this.cargando = false;
          this.cdr.detectChanges();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          this.solicitudes = (res?.solicitudes || []).map(
            (s: SgcSolicitudDocumentoItem) => ({ ...s, paso_flujo: s.paso_flujo || 'revision' })
          );
          this.paginaActual = 1;
        },
        error: (err) => {
          this.error = this.mensajeError(err, 'No se pudieron cargar las solicitudes');
        }
      });
  }

  cambiarFiltroEstado(estado: FiltroGestion): void {
    this.filtroEstado = estado;
    this.paginaActual = 1;
    this.cerrarPanel();
  }

  onBusquedaChange(): void {
    this.paginaActual = 1;
    this.cerrarPanel();
  }

  cambiarPagina(pagina: number): void {
    const siguiente = Math.min(Math.max(1, pagina), this.totalPaginas);
    if (siguiente === this.paginaActual) return;
    this.paginaActual = siguiente;
    this.cerrarPanel();
  }

  seleccionarSolicitud(solicitud: SgcSolicitudDocumentoItem): void {
    if (this.expandidoId === solicitud.solicitud_id) {
      this.cerrarPanel();
      return;
    }
    this.expandidoId = solicitud.solicitud_id;
    this.seleccionadoId = solicitud.solicitud_id;
    this.contexto = null;
    this.limpiarMensajes();
    this.cargarContexto(solicitud.solicitud_id);
  }

  cargarContexto(id: number, conservarMensaje = false): void {
    this.cargandoContextoId = id;
    if (!conservarMensaje) this.limpiarMensajes();
    this.backend.obtenerContextoSolicitudDocumentoSgc(id)
      .pipe(
        finalize(() => {
          this.cargandoContextoId = null;
          this.cdr.detectChanges();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => this.aplicarContexto({
          solicitud: { ...res.solicitud, paso_flujo: res.solicitud?.paso_flujo || 'revision' },
          documentoMaestro: res.documentoMaestro || null,
          formatoDescarga: res.formatoDescarga || null,
          propuesta: res.propuesta || {}
        }),
        error: (err) => {
          this.errorGestion = this.mensajeError(err, 'No se pudo cargar el contexto de gestión');
        }
      });
  }

  autorizarCambio(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'revision') return;
    this.iniciarAccion(solicitud.solicitud_id, 'autorizar');
    this.backend.autorizarSolicitudDocumentoSgc(solicitud.solicitud_id)
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => {
          const msg = this.esEliminacion(res?.solicitud || solicitud)
            ? 'Cambio autorizado. Continúa desactivando el documento en la Lista Maestra.'
            : 'Cambio autorizado. Continúa con la revisión del formato.';
          this.actualizarTrasAccion(res?.solicitud, msg);
        },
        error: (err) => this.gestionarError(err, 'No se pudo autorizar el cambio')
      });
  }

  declinarCambio(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'revision') return;
    if (!window.confirm('¿Declinar este cambio? La solicitud se cerrará sin avanzar el flujo.')) {
      return;
    }
    this.iniciarAccion(solicitud.solicitud_id, 'declinar');
    this.backend.declinarSolicitudDocumentoSgc(solicitud.solicitud_id)
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => {
          this.actualizarTrasAccion(res?.solicitud, res?.message || 'Cambio declinado.');
          this.cerrarPanel();
          this.cargar();
        },
        error: (err) => this.gestionarError(err, 'No se pudo declinar el cambio')
      });
  }

  borrarCambio(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || !this.esSuperAdmin) return;
    if (!window.confirm('¿Desactivar esta solicitud? No se borrará el registro, solo se marcará como inactiva.')) {
      return;
    }
    this.iniciarAccion(solicitud.solicitud_id, 'borrar');
    this.backend.desactivarSolicitudDocumentoSgc(solicitud.solicitud_id)
      .pipe(this.finalizarAccion())
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.cargar();
        },
        error: (err) => this.gestionarError(err, 'No se pudo desactivar la solicitud')
      });
  }

  /**
   * Modificación menor: abre el editor integrado con la PLANTILLA
   * (mismo diseño que Centro SGC → Abrir editor integrado).
   */
  abrirModificacionMenor(): void {
    const plantillaId = this.driveFileIdPlantilla;
    if (plantillaId) {
      this.abrirEditorIntegrado(plantillaId, true);
      return;
    }
    if (!this.driveFileIdActivo) {
      this.errorGestion = 'No hay plantilla ni archivo de Drive asociado a este documento.';
      return;
    }
    this.abrirEditorIntegrado(this.driveFileIdActivo, false);
  }

  /** Salta la revisión de formato y avanza directo a Lista maestra. */
  irDirectoListaMaestra(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'formato') return;
    this.iniciarAccion(solicitud.solicitud_id, 'formato');
    this.backend.marcarFormatoListoSolicitudDocumentoSgc(solicitud.solicitud_id, {
      catalogKey: this.contexto?.formatoDescarga?.catalog_key || solicitud.catalog_key,
      driveFileId: this.driveFileIdActivo,
      versionNueva: this.contexto?.propuesta?.versionNueva,
      fechaRevisionNueva: this.contexto?.propuesta?.fechaRevisionNueva
    })
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud,
          'Sin cambios de formato. Continúa con la Lista Maestra.'
        ),
        error: (err) => this.gestionarError(err, 'No se pudo avanzar a Lista Maestra')
      });
  }

  seleccionarArchivo(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.archivoNuevo = input.files?.length ? input.files[0] : null;
    this.errorGestion = null;
  }

  reemplazarFormato(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || !this.archivoNuevo || solicitud.paso_flujo !== 'formato') return;
    const formato = this.contexto?.formatoDescarga;
    const formData = new FormData();
    formData.append('archivo', this.archivoNuevo);
    this.agregarFormData(formData, 'catalog_key', formato?.catalog_key || solicitud.catalog_key);
    this.agregarFormData(formData, 'codigo', solicitud.codigo || formato?.codigo);
    this.agregarFormData(formData, 'titulo', solicitud.nombre_documento || formato?.titulo);
    this.agregarFormData(formData, 'drive_file_id',
      formato?.drive_file_id_actual || solicitud.drive_file_id);
    this.agregarFormData(formData, 'nombre_archivo',
      formato?.nombre_archivo || this.archivoNuevo.name);

    this.iniciarAccion(solicitud.solicitud_id, 'reemplazar');
    this.backend.reemplazarFormatoSolicitudDocumentoSgc(solicitud.solicitud_id, formData)
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => {
          this.archivoNuevo = null;
          this.actualizarTrasAccion(
            res?.solicitud,
            res?.message || 'Formato reemplazado. Continúa con la Lista Maestra.'
          );
        },
        error: (err) => this.gestionarError(err, 'No se pudo reemplazar el formato')
      });
  }

  abrirEditorIntegrado(fileId?: string, esPlantilla = false): void {
    const id = String(fileId || this.driveFileIdPlantilla || this.driveFileIdActivo || '').trim();
    if (!id) {
      this.errorGestion = 'Este documento no tiene un archivo de Drive asociado.';
      return;
    }
    this.editorEsPlantilla = esPlantilla;
    this.editorCargando = true;
    this.editorUrl = null;
    this.editorAbierto = true;
    this.bodyOverflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sgc-editor-open');

    this.backend.asegurarAccesoEditorDrive(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.montarEditorUrl(id, true),
        error: () => this.montarEditorUrl(id, true)
      });
  }

  cerrarEditor(): void {
    this.editorAbierto = false;
    this.editorUrl = null;
    this.editorCargando = false;
    this.editorEsPlantilla = false;
    document.body.style.overflow = this.bodyOverflowAnterior;
    document.body.classList.remove('sgc-editor-open');
  }

  onEditorIframeLoad(): void {
    this.editorCargando = false;
  }

  abrirVisorDocumento(): void {
    // Vista previa: archivo sistema (con información), no la plantilla.
    const id = this.driveFileIdActivo;
    if (!id) {
      this.errorGestion = 'El documento todavía no tiene un archivo de Drive asociado.';
      return;
    }
    this.visorCargando = true;
    this.visorDocumentoUrl = null;
    this.visorDocumentoAbierto = true;
    this.bloquearScroll();

    this.backend.asegurarAccesoEditorDrive(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.montarVisorUrl(id),
        error: () => this.montarVisorUrl(id)
      });
  }

  cerrarVisorDocumento(): void {
    this.visorDocumentoAbierto = false;
    this.visorDocumentoUrl = null;
    this.visorCargando = false;
    this.restaurarScroll();
  }

  onVisorIframeLoad(): void {
    this.visorCargando = false;
  }

  onErrorMiniatura(): void {
    this.miniaturaError = true;
  }

  regresarPaso(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || !['formato', 'lista_maestra', 'notificar'].includes(solicitud.paso_flujo)) return;
    this.iniciarAccion(solicitud.solicitud_id, 'regresar');
    this.backend.regresarPasoSolicitudDocumentoSgc(solicitud.solicitud_id)
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud,
          res?.message || 'Se regresó al paso anterior correctamente.'
        ),
        error: (err) => this.gestionarError(err, 'No se pudo regresar al paso anterior')
      });
  }

  continuarDesdeEditor(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'formato') return;
    this.iniciarAccion(solicitud.solicitud_id, 'formato');
    this.backend.marcarFormatoListoSolicitudDocumentoSgc(solicitud.solicitud_id, {
      catalogKey: this.contexto?.formatoDescarga?.catalog_key || solicitud.catalog_key,
      driveFileId: this.driveFileIdActivo || this.driveFileIdPlantilla,
      versionNueva: this.contexto?.propuesta?.versionNueva,
      fechaRevisionNueva: this.contexto?.propuesta?.fechaRevisionNueva
    })
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => {
          if (this.editorAbierto) this.cerrarEditor();
          this.actualizarTrasAccion(
            res?.solicitud, 'Formato confirmado. Continúa con la Lista Maestra.'
          );
        },
        error: (err) => this.gestionarError(err, 'No se pudo confirmar el formato')
      });
  }

  guardarListaMaestra(): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'lista_maestra' || !this.formularioListaValido) {
      this.errorGestion = 'Completa todos los campos de la Lista Maestra.';
      return;
    }
    const esBaja = this.esEliminacion(solicitud);
    const payload: Record<string, unknown> = {
      ...this.listaMaestraForm,
      vigente: !esBaja
    };
    if (this.esSuperAdmin && this.listaMaestraForm.fechaSolicitud) {
      payload.fechaSolicitud = this.listaMaestraForm.fechaSolicitud;
    } else {
      delete payload.fechaSolicitud;
    }
    this.iniciarAccion(solicitud.solicitud_id, 'lista');
    this.backend.actualizarListaMaestraSolicitudDocumentoSgc(
      solicitud.solicitud_id,
      payload
    )
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud,
          res?.message || (esBaja
            ? 'Documento desactivado en la Lista Maestra.'
            : 'Lista Maestra actualizada.')
        ),
        error: (err) => this.gestionarError(err, 'No se pudo actualizar la Lista Maestra')
      });
  }

  seleccionarNotificacion(valor: boolean): void {
    this.notificarSeleccion = valor;
    this.errorGestion = null;
    if (!valor) this.descripcionSistemas = '';
  }

  cerrarSolicitud(notificar: boolean): void {
    const solicitud = this.solicitudActiva;
    if (!solicitud || solicitud.paso_flujo !== 'notificar') return;
    if (notificar && !this.descripcionSistemas.trim()) {
      this.errorGestion = 'Describe el cambio que debe atender el encargado de Sistemas.';
      return;
    }
    this.iniciarAccion(solicitud.solicitud_id, 'cerrar');
    this.backend.cerrarSolicitudDocumentoSgc(solicitud.solicitud_id, {
      notificar,
      descripcion: notificar ? this.descripcionSistemas.trim() : undefined
    })
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud, res?.message || 'Solicitud completada correctamente.'
        ),
        error: (err) => this.gestionarError(err, 'No se pudo cerrar la solicitud')
      });
  }

  pasoActual(solicitud: SgcSolicitudDocumentoItem): number {
    if (solicitud.paso_flujo === 'revision') return 1;
    if (solicitud.paso_flujo === 'formato') return 2;
    if (solicitud.paso_flujo === 'lista_maestra') return 3;
    return 4;
  }

  pasoCompletado(solicitud: SgcSolicitudDocumentoItem, numero: number): boolean {
    if (solicitud.paso_flujo === 'cerrado') return true;
    return numero < this.pasoActual(solicitud);
  }

  pasoBloqueado(solicitud: SgcSolicitudDocumentoItem, numero: number): boolean {
    return solicitud.paso_flujo !== 'cerrado' && numero > this.pasoActual(solicitud);
  }

  pasoActivo(solicitud: SgcSolicitudDocumentoItem, numero: number): boolean {
    return solicitud.paso_flujo !== 'cerrado' && numero === this.pasoActual(solicitud);
  }

  estaProcesando(accion?: AccionGestion): boolean {
    return this.accionId != null && (!accion || this.accionActual === accion);
  }

  tituloLista(solicitud: SgcSolicitudDocumentoItem): string {
    const nombre = String(solicitud.nombre_documento || '').trim() || 'Documento';
    const codigo = String(solicitud.codigo || '').trim();
    const doc = codigo ? `${nombre} (${codigo})` : nombre;
    return `Solicitud de cambio #${solicitud.solicitud_id} - ${this.tipoSolicitudLabel(solicitud.tipo_solicitud)} · ${doc}`;
  }

  get resumenCierre(): {
    nombre: string;
    codigo: string;
    version: string;
    tipoDocumento: string;
    tipoSolicitud: string;
    motivo: string;
    solicitante: string;
    puesto: string;
    fechaSolicitud: string;
    horaSolicitud: string;
    ticketId: number | null;
  } {
    const s = this.contexto?.solicitud;
    const maestro = this.contexto?.documentoMaestro;
    const propuesta = this.contexto?.propuesta;
    const nombreRaw = String(
      maestro?.nombreDocumento || s?.nombre_documento || this.contexto?.formatoDescarga?.titulo || '—'
    ).trim();
    return {
      nombre: this.formatearNombreResumen(nombreRaw),
      codigo: maestro?.codigo || s?.codigo || this.contexto?.formatoDescarga?.codigo || '—',
      version: String(
        maestro?.versionVigente
        || s?.version_nueva
        || propuesta?.versionNueva
        || s?.version_actual
        || '—'
      ),
      tipoDocumento: maestro?.especie || s?.tipo_documento || this.origenDocumentoLabel || '—',
      tipoSolicitud: this.tipoSolicitudLabel(s?.tipo_solicitud),
      motivo: String(s?.motivo || '').trim() || 'Sin motivo registrado.',
      solicitante: s ? this.autorLabel(s) : '—',
      puesto: s ? this.puestoLabel(s) : '',
      fechaSolicitud: this.fechaUi(s?.fecha_solicitud || s?.created_at),
      horaSolicitud: this.horaMexicoUi(s?.created_at || s?.fecha_solicitud),
      ticketId: s?.solicitud_id ?? null
    };
  }

  esEliminacion(solicitud?: SgcSolicitudDocumentoItem | null): boolean {
    return String(solicitud?.tipo_solicitud || '').toLowerCase() === 'eliminacion';
  }

  horaMexicoUi(valor?: string | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
  }

  fechaHoraMexicoUi(valor?: string | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return this.fechaUi(valor);
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
  }

  private formatearNombreResumen(nombre: string): string {
    const limpio = String(nombre || '').replace(/\s+/g, ' ').trim();
    if (!limpio || limpio === '—') return limpio || '—';
    // Inserta saltos cada ~28 chars en límites de palabra para evitar el corte por ellipsis.
    if (limpio.length <= 28) return limpio;
    const palabras = limpio.split(' ');
    const lineas: string[] = [];
    let actual = '';
    for (const palabra of palabras) {
      const candidato = actual ? `${actual} ${palabra}` : palabra;
      if (candidato.length > 28 && actual) {
        lineas.push(actual);
        actual = palabra;
      } else {
        actual = candidato;
      }
    }
    if (actual) lineas.push(actual);
    return lineas.join('\n');
  }

  snippetSolicitud(solicitud: SgcSolicitudDocumentoItem): string {
    const texto = String(solicitud.motivo || '').replace(/\s+/g, ' ').trim();
    if (!texto) return this.autorLabel(solicitud);
    return texto.length > 110 ? `${texto.slice(0, 107)}…` : texto;
  }

  estadoLabel(estado: string, solicitud?: SgcSolicitudDocumentoItem | null): string {
    if (solicitud?.declinado) return 'Declinada';
    const map: Record<string, string> = {
      abierto: 'Por autorizar',
      en_progreso: 'En gestión',
      cerrado: 'Completada'
    };
    return map[estado] || estado;
  }

  pasoLabel(paso?: PasoFlujoSgc): string {
    const map: Record<string, string> = {
      revision: 'Autorización',
      formato: 'Revisión',
      lista_maestra: 'Cambio en la Lista maestra',
      notificar: 'Notificar a Sistemas',
      cerrado: 'Cerrado'
    };
    return map[paso || 'revision'];
  }

  tipoSolicitudLabel(tipo?: string): string {
    const key = String(tipo || 'modificacion').toLowerCase() as keyof typeof TIPO_SOLICITUD_LABELS;
    return TIPO_SOLICITUD_LABELS[key] || solicitudTipoFallback(tipo);
  }

  autorLabel(solicitud: SgcSolicitudDocumentoItem): string {
    const nombre = String(solicitud?.autor_nombre || solicitud?.nombre_solicitante || '').trim();
    if (nombre) return nombre;
    return String(solicitud?.autor_usuario || 'Solicitante').trim() || 'Solicitante';
  }

  puestoLabel(solicitud?: SgcSolicitudDocumentoItem | null): string {
    return String(solicitud?.puesto_solicitante || '').trim();
  }

  tiempoRelativo(valor?: string): string {
    if (!valor) return '—';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '—';
    const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
    if (minutos < 1) return 'Ahora';
    if (minutos < 60) return `Hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'Ayer';
    if (dias < 7) return `Hace ${dias} días`;
    return this.fechaUi(valor);
  }

  fechaUi(valor?: string | null): string {
    if (!valor) return '—';
    const raw = String(valor).slice(0, 10);
    const partes = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (partes) return `${partes[3]}/${partes[2]}/${partes[1]}`;
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return raw;
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(d);
  }

  trackBySolicitudId(_index: number, solicitud: SgcSolicitudDocumentoItem): number {
    return solicitud?.solicitud_id || _index;
  }

  trackByGrupo(_index: number, grupo: { etiqueta: string }): string {
    return grupo.etiqueta;
  }

  private aplicarContexto(contexto: ContextoGestion): void {
    this.contexto = contexto;
    this.miniaturaError = false;
    this.sincronizarSolicitud(contexto.solicitud);
    this.listaMaestraForm = this.crearListaMaestraForm(contexto);
    this.notificarSeleccion = contexto.solicitud.notificar_sistemas ?? null;
    this.descripcionSistemas = contexto.solicitud.notas_cambio || '';
  }

  private crearListaMaestraForm(contexto: ContextoGestion): ListaMaestraForm {
    const maestro = contexto.documentoMaestro || {};
    const solicitud = contexto.solicitud;
    const propuesta = contexto.propuesta || {};
    const versionBase = propuesta.versionAnterior || solicitud.version_actual || maestro.versionVigente || '';
    const versionForm = this.esEliminacion(solicitud)
      ? (versionBase || propuesta.versionNueva || solicitud.version_nueva || '')
      : (propuesta.versionNueva || solicitud.version_nueva || solicitud.version_actual || '');
    return {
      codigo: maestro.codigo || solicitud.codigo || '',
      area: maestro.area || '',
      tipo: maestro.tipo || 'Interno',
      especie: maestro.especie || solicitud.tipo_documento || '',
      versionVigente: versionForm,
      fechaRevision: this.fechaInput(
        propuesta.fechaRevisionNueva || solicitud.fecha_revision_nueva || propuesta.fechaHoyMexico
      ),
      fechaSolicitud: this.fechaInput(solicitud.fecha_solicitud || solicitud.created_at),
      nombreDocumento: maestro.nombreDocumento || solicitud.nombre_documento || '',
      // Siempre Sergio por defecto; el campo permanece editable para casos excepcionales.
      responsable: RESPONSABLE_LISTA_MAESTRA_SGC
    };
  }

  private crearListaMaestraVacia(): ListaMaestraForm {
    return {
      codigo: '', area: '', tipo: 'Interno', especie: '', versionVigente: '',
      fechaRevision: '', fechaSolicitud: '', nombreDocumento: '',
      responsable: RESPONSABLE_LISTA_MAESTRA_SGC
    };
  }

  private actualizarTrasAccion(solicitud: SgcSolicitudDocumentoItem | undefined, _mensaje?: string): void {
    if (solicitud) this.sincronizarSolicitud(solicitud);
    this.mensajeGestion = null;
    this.errorGestion = null;
    const id = solicitud?.solicitud_id || this.seleccionadoId;
    if (id) this.cargarContexto(id, true);
  }

  private sincronizarSolicitud(actualizada: SgcSolicitudDocumentoItem): void {
    const index = this.solicitudes.findIndex((s) => s.solicitud_id === actualizada.solicitud_id);
    if (index >= 0) {
      this.solicitudes[index] = {
        ...this.solicitudes[index], ...actualizada,
        paso_flujo: actualizada.paso_flujo || 'revision'
      };
      this.solicitudes = [...this.solicitudes];
    }
    if (this.contexto?.solicitud?.solicitud_id === actualizada.solicitud_id) {
      this.contexto = {
        ...this.contexto,
        solicitud: { ...this.contexto.solicitud, ...actualizada }
      };
    }
  }

  private iniciarAccion(id: number, accion: AccionGestion): void {
    this.accionId = id;
    this.accionActual = accion;
    this.limpiarMensajes();
  }

  private finalizarAccion<T>() {
    return (source: Observable<T>) => source.pipe(
      finalize(() => {
        this.accionId = null;
        this.accionActual = null;
        this.cdr.detectChanges();
      }),
      takeUntil(this.destroy$)
    );
  }

  private gestionarError(error: any, fallback: string): void {
    this.errorGestion = this.mensajeError(error, fallback);
  }

  private mensajeError(error: any, fallback: string): string {
    return error?.error?.message || error?.message || fallback;
  }

  private agregarFormData(formData: FormData, clave: string, valor?: string): void {
    const limpio = String(valor || '').trim();
    if (limpio) formData.append(clave, limpio);
  }

  private fechaInput(valor?: string | null): string {
    if (!valor) return '';
    const raw = String(valor).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  private etiquetaGrupo(valor?: string): string {
    if (!valor) return 'Anteriores';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return 'Anteriores';
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    const inicioItem = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
    const dias = Math.round((inicioHoy - inicioItem) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    return this.fechaUi(valor);
  }

  private limpiarMensajes(): void {
    this.errorGestion = null;
    this.mensajeGestion = null;
  }

  private cerrarPanel(): void {
    this.expandidoId = null;
    this.seleccionadoId = null;
    this.contexto = null;
    this.archivoNuevo = null;
    this.limpiarMensajes();
    if (this.editorAbierto) this.cerrarEditor();
    if (this.visorDocumentoAbierto) this.cerrarVisorDocumento();
  }

  private detectarTipoArchivoGestion(): TipoArchivoGestion {
    const formato = this.contexto?.formatoDescarga;
    const codigo = String(
      this.solicitudActiva?.codigo || formato?.codigo || this.codigoDocumentoActivo || ''
    ).trim();
    const plantillaCentro = resolverPlantillaCentroSgcPorCodigo(
      codigo,
      this.authService.esSuperusuario()
    )?.plantilla;
    if (plantillaCentro) {
      const icono = tipoIconoPlantilla(plantillaCentro);
      if (icono === 'excel' || icono === 'word' || icono === 'pdf') {
        return icono;
      }
    }

    const descriptor = [
      formato?.origen,
      formato?.nombre_archivo,
      formato?.titulo,
      plantillaCentro?.nombre,
      this.solicitudActiva?.tipo_documento,
      this.solicitudActiva?.nombre_documento
    ].join(' ').toLowerCase();

    if (/\.pptx?\b|powerpoint|presentaci[oó]n/.test(descriptor)) return 'pptx';
    if (/\.xlsx?\b|\.xls\b|excel|sheet|hoja de c[aá]lculo/.test(descriptor)) return 'excel';
    if (/\.docx?\b|\.doc\b|word|documento de texto/.test(descriptor)) return 'word';
    if (/\.pdf\b|instructivo|procedimiento/.test(descriptor) || String(formato?.origen || '').includes('instructivo')
      || String(formato?.origen || '').includes('procedimiento')) {
      return 'pdf';
    }
    // Formatos interactivos sin extensión clara: por defecto Excel (Sheets).
    if (String(formato?.origen || '').toLowerCase() === 'formato_interactivo') {
      return 'excel';
    }
    return 'otro';
  }

  private montarEditorUrl(id: string, modoEdicion: boolean): void {
    const tipo = this.tipoArchivoGestion;
    const modo = modoEdicion ? 'edit?usp=sharing' : 'preview';
    let url: string;
    if (tipo === 'excel') {
      url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/${modo}`;
    } else if (tipo === 'word') {
      url = `https://docs.google.com/document/d/${encodeURIComponent(id)}/${modo}`;
    } else {
      // PDF / PPT / binarios: preview de Drive (evita el error de Google Docs).
      url = `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
    }
    this.editorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    // Si el iframe no dispara load (bloqueado), no dejar el spinner infinito.
    window.setTimeout(() => {
      if (this.editorAbierto) this.editorCargando = false;
    }, 4500);
  }

  private montarVisorUrl(id: string): void {
    const tipo = this.tipoArchivoGestion;
    let url: string;
    if (tipo === 'excel') {
      // Mismo patrón que Centro SGC (archivos sistema Sheets).
      url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    } else if (tipo === 'word') {
      // Docs nativos (sistema). /preview falla con frecuencia en iframe; edit+sharing es estable.
      url = `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    } else if (tipo === 'pdf' || tipo === 'pptx') {
      // Proxy backend evita muro de login / errores de embed en PDF.
      url = this.backend.obtenerUrlDrivePreview(id);
    } else {
      url = `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
    }
    this.visorDocumentoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    window.setTimeout(() => {
      if (this.visorDocumentoAbierto) this.visorCargando = false;
    }, 4500);
  }

  private bloquearScroll(): void {
    this.bodyOverflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sgc-editor-open');
  }

  private restaurarScroll(): void {
    document.body.style.overflow = this.bodyOverflowAnterior;
    document.body.classList.remove('sgc-editor-open');
  }
}

function solicitudTipoFallback(tipo?: string): string {
  const raw = String(tipo || '').trim();
  if (!raw) return 'Modificación';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
