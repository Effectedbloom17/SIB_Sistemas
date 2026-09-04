import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { TIPO_SOLICITUD_LABELS } from './sgc-solicitud-documentos.util';

/** Responsable por defecto de cambios a la Lista Maestra SGC. */
export const RESPONSABLE_LISTA_MAESTRA_SGC = 'Ing. Sergio Luis Guzmán Vigueras';

export type PasoFlujoSgc = 'revision' | 'formato' | 'lista_maestra' | 'notificar' | 'cerrado';
type FiltroGestion = 'todos' | 'autorizar' | 'gestion' | 'completadas';
type AccionGestion = 'autorizar' | 'reemplazar' | 'formato' | 'lista' | 'cerrar' | 'regresar';

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
  notificar_sistemas?: boolean | null;
  ticket_sistemas_id?: number | null;
  nombre_solicitante: string;
  puesto_solicitante: string;
  fecha_solicitud?: string;
  created_at: string;
  updated_at?: string;
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
  version_actual?: number;
}

interface PropuestaGestion {
  versionNueva?: string;
  versionAnterior?: string;
  fechaRevisionNueva?: string;
  fechaHoyMexico?: string;
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
  visorDocumentoAbierto = false;
  visorDocumentoUrl: SafeResourceUrl | null = null;
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
    { numero: 1, titulo: 'Revisión y autorización', corto: 'Revisión' },
    { numero: 2, titulo: 'Lista Maestra', corto: 'Lista Maestra' },
    { numero: 3, titulo: 'Notificar a Sistemas', corto: 'Notificar' }
  ];

  private readonly destroy$ = new Subject<void>();
  private bodyOverflowAnterior = '';

  constructor(
    private backend: BackendServices,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
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
        this.autorLabel(solicitud), this.puestoLabel(solicitud), this.estadoLabel(solicitud.estado),
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

  get driveFileIdActivo(): string {
    return String(
      this.contexto?.formatoDescarga?.drive_file_id_actual
      || this.contexto?.solicitud?.drive_file_id
      || ''
    ).trim();
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

  get origenDocumentoLabel(): string {
    const origen = String(this.contexto?.formatoDescarga?.origen || '').toLowerCase();
    if (origen === 'formato_interactivo') return 'Formato interactivo';
    if (origen === 'formato_descarga') return 'Formato de descarga';
    if (origen.includes('instructivo')) return 'Instructivo';
    if (origen.includes('procedimiento')) return 'Procedimiento';
    return origen ? origen.replace(/_/g, ' ') : 'Documento solicitado';
  }

  get tipoArchivoActivo(): 'PDF' | 'Sheet' | 'Doc' {
    return this.detectarTipoArchivo();
  }

  get iconoArchivoActivo(): string {
    const tipo = this.tipoArchivoActivo;
    return tipo === 'PDF' ? 'fa-file-pdf' : tipo === 'Sheet' ? 'fa-file-excel' : 'fa-file-word';
  }

  get formularioListaValido(): boolean {
    const f = this.listaMaestraForm;
    return !!(f.codigo.trim() && f.area.trim() && f.tipo.trim() && f.especie.trim()
      && f.versionVigente.trim() && f.fechaRevision && f.nombreDocumento.trim()
      && f.responsable.trim());
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
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud, 'Cambio autorizado. Ahora actualiza el formato.'
        ),
        error: (err) => this.gestionarError(err, 'No se pudo autorizar el cambio')
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

  abrirEditorIntegrado(): void {
    const id = this.driveFileIdActivo;
    if (!id) {
      this.errorGestion = 'Este documento no tiene un archivo de Drive asociado.';
      return;
    }
    const tipo = this.detectarTipoArchivo();
    const url = tipo === 'Sheet'
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`
      : tipo === 'PDF'
        ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`
        : `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit?usp=sharing`;
    this.editorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.editorAbierto = true;
    this.bodyOverflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sgc-editor-open');
  }

  cerrarEditor(): void {
    this.editorAbierto = false;
    this.editorUrl = null;
    document.body.style.overflow = this.bodyOverflowAnterior;
    document.body.classList.remove('sgc-editor-open');
  }

  abrirVisorDocumento(): void {
    const id = this.driveFileIdActivo;
    if (!id) {
      this.errorGestion = 'El documento todavía no tiene un archivo de Drive asociado.';
      return;
    }
    const tipo = this.detectarTipoArchivo();
    const url = tipo === 'Sheet'
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/preview`
      : tipo === 'Doc'
        ? `https://docs.google.com/document/d/${encodeURIComponent(id)}/preview`
        : `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
    this.visorDocumentoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.visorDocumentoAbierto = true;
    this.bloquearScroll();
  }

  cerrarVisorDocumento(): void {
    this.visorDocumentoAbierto = false;
    this.visorDocumentoUrl = null;
    this.restaurarScroll();
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
      driveFileId: this.driveFileIdActivo,
      versionNueva: this.contexto?.propuesta?.versionNueva,
      fechaRevisionNueva: this.contexto?.propuesta?.fechaRevisionNueva
    })
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => {
          this.cerrarEditor();
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
    this.iniciarAccion(solicitud.solicitud_id, 'lista');
    this.backend.actualizarListaMaestraSolicitudDocumentoSgc(
      solicitud.solicitud_id, { ...this.listaMaestraForm, vigente: true }
    )
      .pipe(this.finalizarAccion())
      .subscribe({
        next: (res) => this.actualizarTrasAccion(
          res?.solicitud, res?.message || 'Lista Maestra actualizada.'
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
    if (solicitud.paso_flujo === 'revision' || solicitud.paso_flujo === 'formato') return 1;
    if (solicitud.paso_flujo === 'lista_maestra') return 2;
    return 3;
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
    const doc = solicitud.codigo || solicitud.nombre_documento || 'Documento';
    return `Ticket #${solicitud.solicitud_id} - ${this.tipoSolicitudLabel(solicitud.tipo_solicitud)} · ${doc}`;
  }

  get resumenCierre(): {
    nombre: string;
    codigo: string;
    version: string;
    tipoDocumento: string;
    tipoSolicitud: string;
    motivo: string;
  } {
    const s = this.contexto?.solicitud;
    const maestro = this.contexto?.documentoMaestro;
    const propuesta = this.contexto?.propuesta;
    return {
      nombre: maestro?.nombreDocumento || s?.nombre_documento || this.contexto?.formatoDescarga?.titulo || '—',
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
      motivo: String(s?.motivo || '').trim() || 'Sin motivo registrado.'
    };
  }

  snippetSolicitud(solicitud: SgcSolicitudDocumentoItem): string {
    const texto = String(solicitud.motivo || '').replace(/\s+/g, ' ').trim();
    if (!texto) return this.autorLabel(solicitud);
    return texto.length > 110 ? `${texto.slice(0, 107)}…` : texto;
  }

  estadoLabel(estado: string): string {
    const map: Record<string, string> = {
      abierto: 'Por autorizar',
      en_progreso: 'En gestión',
      cerrado: 'Completada'
    };
    return map[estado] || estado;
  }

  pasoLabel(paso?: PasoFlujoSgc): string {
    const map: Record<string, string> = {
      revision: 'Revisión', formato: 'Cambio de formato',
      lista_maestra: 'Lista Maestra', notificar: 'Notificar a Sistemas', cerrado: 'Cerrado'
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
    return {
      codigo: maestro.codigo || solicitud.codigo || '',
      area: maestro.area || '',
      tipo: maestro.tipo || 'Interno',
      especie: maestro.especie || solicitud.tipo_documento || '',
      versionVigente: propuesta.versionNueva || solicitud.version_nueva || solicitud.version_actual || '',
      fechaRevision: this.fechaInput(
        propuesta.fechaRevisionNueva || solicitud.fecha_revision_nueva || propuesta.fechaHoyMexico
      ),
      nombreDocumento: maestro.nombreDocumento || solicitud.nombre_documento || '',
      // Siempre Sergio por defecto; el campo permanece editable para casos excepcionales.
      responsable: RESPONSABLE_LISTA_MAESTRA_SGC
    };
  }

  private crearListaMaestraVacia(): ListaMaestraForm {
    return {
      codigo: '', area: '', tipo: 'Interno', especie: '', versionVigente: '',
      fechaRevision: '', nombreDocumento: '', responsable: RESPONSABLE_LISTA_MAESTRA_SGC
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

  private detectarTipoArchivo(): 'PDF' | 'Sheet' | 'Doc' {
    const formato = this.contexto?.formatoDescarga;
    const origen = String(formato?.origen || '').toLowerCase();
    const codigo = String(this.solicitudActiva?.codigo || formato?.codigo || '');
    const descriptor = [
      origen,
      this.solicitudActiva?.tipo_documento,
      formato?.nombre_archivo,
      formato?.titulo
    ].join(' ').toLowerCase();

    if (origen === 'formato_interactivo'
      || /-F-\d+/i.test(codigo)
      || /sheet|hoja|excel|xlsx?|csv/.test(descriptor)) {
      return 'Sheet';
    }
    if (origen.includes('instructivo')
      || origen.includes('procedimiento')
      || /pdf|powerpoint|presentaci[oó]n|pptx?/.test(descriptor)) {
      return 'PDF';
    }
    return 'Doc';
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
