import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { ConnectivityService } from 'src/app/services/connectivity.service';
import { DiagramasService, DiagramaDetalle, DiagramaResumen } from 'src/app/services/diagramas.service';
import {
  AgendaActividadLocal,
  AgendaEstatusLocal,
  AgendaLocalService,
  AgendaPaginaLocal
} from 'src/app/services/agenda-local.service';

interface EstatusForm {
  etiqueta: string;
  color: string;
  esFinal: boolean;
}

type EstadoGrafico = 'listo' | 'pendiente' | 'guardando' | 'guardado' | 'error';

interface PreviewGrafico {
  loading: boolean;
  error: string | null;
  /** Data URI PNG/SVG para mostrar en la libreta */
  imgUrl: string | null;
}

const EDITOR_ORIGEN = 'https://embed.diagrams.net';
const XML_VACIO = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const EXPORT_URL = `${EDITOR_ORIGEN}/?embed=1&proto=json&spin=0&ui=min&libraries=0&noSaveBtn=1&noExitBtn=1`;

const ICONOS_ESTATUS: Record<string, string> = {
  pendiente: 'fa-clock',
  en_proceso: 'fa-play',
  pendiente_revision: 'fa-search',
  pendiente_correo: 'fa-envelope',
  pendiente_cliente: 'fa-user-clock',
  pospuesto: 'fa-pause',
  completado: 'fa-check',
  no_completado: 'fa-times'
};

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.component.html',
  styleUrls: ['./agenda.component.scss']
})
export class AgendaComponent implements OnInit, OnDestroy {
  @ViewChild('marcoGrafico') marcoGrafico?: ElementRef<HTMLIFrameElement>;
  @ViewChild('marcoExport') marcoExport?: ElementRef<HTMLIFrameElement>;

  private destroy$ = new Subject<void>();
  private guardarDebounce$ = new Subject<{ uuid: string; valor: string }>();
  private obsDebounce$ = new Subject<string>();

  actividades: AgendaActividadLocal[] = [];
  actividadesArchivo: AgendaActividadLocal[] = [];
  estatus: AgendaEstatusLocal[] = [];
  paginas: AgendaPaginaLocal[] = [];
  paginasArchivo: AgendaPaginaLocal[] = [];
  paginaActivaUuid: string | null = null;
  observacionesHoja = '';
  filtroEstatus = '';
  busqueda = '';
  cargando = false;
  sincronizando = false;
  online = true;
  pendienteSync = false;
  errorCarga: string | null = null;
  esRoot = false;

  seleccionadaUuid: string | null = null;
  menuEstatusUuid: string | null = null;
  menuFiltroAbierto = false;
  /** Vista virtual "General" (todas las actividades) delante de las hojas específicas. */
  vistaGeneral = true;
  /** Panel colapsable de actividades completadas (solo hojas específicas). */
  completadasAbiertas = false;
  /** Campo del pager: número de hoja visible (1 = General). */
  saltoHoja = '1';
  giroHoja: 'next' | 'prev' | null = null;
  private giroTimer: ReturnType<typeof setTimeout> | null = null;

  nuevaActividadTitulo = '';
  nuevaActividadEstatus = 'pendiente';

  mostrarPanelEstatus = false;
  mostrarPanelArchivo = false;
  mostrarPanelDiagramas = false;
  vinculandoActividadUuid: string | null = null;
  catalogoDiagramas: DiagramaResumen[] = [];
  busquedaDiagrama = '';
  cargandoDiagramas = false;
  editandoEstatusUuid: string | null = null;
  formEstatus: EstatusForm = this.formEstatusVacio();

  /** Editor de gráficos embebido (diagrams.net) dentro de Agenda */
  editandoGrafico = false;
  graficoId: number | null = null;
  graficoTitulo = '';
  graficoUrl: SafeResourceUrl | null = null;
  graficoEstado: EstadoGrafico = 'listo';
  graficoMensaje = '';
  graficoError: string | null = null;
  private graficoXml = XML_VACIO;
  private graficoXmlPendiente: string | null = null;
  private graficoRev = 0;
  private graficoEditorListo = false;
  private graficoTimerInit: ReturnType<typeof setTimeout> | null = null;
  private graficoTimerSave: ReturnType<typeof setTimeout> | null = null;
  private graficoGuardando = false;
  private graficoCola: { id: number; xml: string } | null = null;
  /** Vistas previas de diagramas en la libreta (id → estado). */
  readonly previews = new Map<number, PreviewGrafico>();
  /** Iframe oculto para exportar PNG (diagrams.net). */
  exportUrl: SafeResourceUrl | null = null;
  private exportListo = false;
  private exportOcupado = false;
  private exportEsperandoLoad = false;
  private exportCola: Array<{ id: number; xml: string }> = [];
  private exportActualId: number | null = null;
  private exportRev = 1;
  private exportTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private backend: BackendServices,
    private local: AgendaLocalService,
    private connectivity: ConnectivityService,
    private auth: AuthService,
    private diagramasService: DiagramasService,
    private sanitizer: DomSanitizer,
    private zone: NgZone
  ) {
    this.exportUrl = this.crearUrlExport(this.exportRev);
  }

  private crearUrlExport(rev: number): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(`${EXPORT_URL}&rev=${rev}`);
  }

  ngOnInit(): void {
    this.esRoot = this.auth.esRoot();
    this.online = this.connectivity.isOnline;
    this.refrescarDesdeLocal();
    window.addEventListener('message', this.onMensajeGrafico);

    this.connectivity.online$
      .pipe(takeUntil(this.destroy$))
      .subscribe((online) => {
        const estabaOffline = !this.online;
        this.online = online;
        if (online && (estabaOffline || this.pendienteSync)) {
          void this.sincronizar();
        }
      });

    this.guardarDebounce$
      .pipe(debounceTime(400), takeUntil(this.destroy$))
      .subscribe((ev) => void this.aplicarEdicionTitulo(ev.uuid, ev.valor));

    this.obsDebounce$
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe((texto) => void this.guardarObservaciones(texto));

    void this.sincronizar(true);
  }

  ngOnDestroy(): void {
    if (this.giroTimer) clearTimeout(this.giroTimer);
    if (this.exportTimer) clearTimeout(this.exportTimer);
    window.removeEventListener('message', this.onMensajeGrafico);
    this.flushGuardadoGrafico();
    this.cancelarTimersGrafico();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get etiquetaEstadoGrafico(): string {
    if (this.graficoEstado === 'guardando') return 'Guardando…';
    if (this.graficoEstado === 'pendiente') return 'Cambios sin guardar';
    if (this.graficoEstado === 'guardado') return 'Guardado';
    if (this.graficoEstado === 'error') return this.graficoMensaje || 'Error al guardar';
    return 'Listo';
  }

  @HostListener('document:click')
  onDocClick(): void {
    this.menuEstatusUuid = null;
    this.menuFiltroAbierto = false;
  }

  get etiquetaFiltroEstatus(): string {
    if (!this.filtroEstatus) return 'Todos los estatus';
    return this.etiquetaEstatus(this.filtroEstatus);
  }

  toggleMenuFiltro(ev: Event): void {
    ev.stopPropagation();
    this.menuEstatusUuid = null;
    this.menuFiltroAbierto = !this.menuFiltroAbierto;
  }

  seleccionarFiltroEstatus(clave: string): void {
    this.filtroEstatus = clave || '';
    this.menuFiltroAbierto = false;
  }

  get paginaActiva(): AgendaPaginaLocal | null {
    if (this.vistaGeneral) return null;
    return this.paginas.find((p) => p.clientUuid === this.paginaActivaUuid) || this.paginas[0] || null;
  }

  /** Índice en la navegación: 0 = General, 1..n = hojas específicas. */
  get indicePagina(): number {
    if (this.vistaGeneral) return 0;
    const i = this.paginas.findIndex((p) => p.clientUuid === this.paginaActivaUuid);
    return i < 0 ? 1 : i + 1;
  }

  get totalHojasVista(): number {
    return this.paginas.length + 1;
  }

  get tituloHojaActual(): string {
    if (this.vistaGeneral) return 'General';
    return this.paginaActiva?.titulo || 'Hoja';
  }

  /** Actividades de la vista actual (General = todas; hoja = solo esa). Las completadas van al panel izquierdo salvo filtro explícito. */
  get actividadesEnHoja(): AgendaActividadLocal[] {
    const q = this.busqueda.trim().toLowerCase();
    const filtroCompletado = !!(this.filtroEstatus && this.esCompletado(this.filtroEstatus));
    return this.actividadesDeVista()
      .filter((a) => {
        if (this.esCompletado(a.estatusClave) && !filtroCompletado) return false;
        if (this.filtroEstatus && a.estatusClave !== this.filtroEstatus) return false;
        if (!q) return true;
        return a.titulo.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo, 'es'));
  }

  /** Resumen: actividades activas (no completadas) de la vista. */
  get resumenHoja(): AgendaActividadLocal[] {
    return this.actividadesDeVista()
      .filter((a) => !this.esCompletado(a.estatusClave))
      .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo, 'es'));
  }

  /** Completadas de la vista actual (General o hoja específica). */
  get actividadesCompletadas(): AgendaActividadLocal[] {
    return this.actividadesDeVista()
      .filter((a) => this.esCompletado(a.estatusClave))
      .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo, 'es'));
  }

  private actividadesDeVista(): AgendaActividadLocal[] {
    if (this.vistaGeneral) return [...this.actividades];
    const pid = this.paginaActiva?.clientUuid;
    if (!pid) return [];
    return this.actividades.filter((a) => a.paginaUuid === pid);
  }

  tituloPaginaDe(actividad: AgendaActividadLocal): string {
    if (!actividad?.paginaUuid) return 'Sin hoja';
    return this.paginas.find((p) => p.clientUuid === actividad.paginaUuid)?.titulo
      || this.paginasArchivo.find((p) => p.clientUuid === actividad.paginaUuid)?.titulo
      || 'Hoja';
  }

  esCompletado(clave: string): boolean {
    if (clave === 'completado') return true;
    const e = this.estatus.find((x) => x.clave === clave);
    const etiqueta = (e?.etiqueta || '').toLowerCase();
    return !!e?.esFinal && etiqueta.includes('completado') && !etiqueta.includes('no ');
  }

  get contadores(): { total: number; abiertas: number; finales: number } {
    const finales = new Set(this.estatus.filter((e) => e.esFinal).map((e) => e.clave));
    let abiertas = 0;
    let fin = 0;
    for (const a of this.actividades) {
      if (finales.has(a.estatusClave)) fin += 1;
      else abiertas += 1;
    }
    return { total: this.actividades.length, abiertas, finales: fin };
  }

  get fechaHoy(): string {
    return new Date().toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  iconoEstatus(clave: string): string {
    if (ICONOS_ESTATUS[clave]) return ICONOS_ESTATUS[clave];
    const e = this.estatus.find((x) => x.clave === clave);
    if (e?.esFinal) return 'fa-flag-checkered';
    return 'fa-tag';
  }

  colorEstatus(clave: string): string {
    return this.estatus.find((e) => e.clave === clave)?.color || '#64748B';
  }

  etiquetaEstatus(clave: string): string {
    return this.estatus.find((e) => e.clave === clave)?.etiqueta || clave;
  }

  refrescarDesdeLocal(): void {
    const cache = this.local.leer();
    this.actividades = this.local.actividadesActivas(cache);
    this.actividadesArchivo = this.local.actividadesArchivadas(cache);
    this.estatus = this.local.estatusActivos(cache);
    this.paginas = this.local.paginasActivas(cache);
    this.paginasArchivo = this.local.paginasArchivadas(cache);
    if (!this.paginaActivaUuid || !this.paginas.some((p) => p.clientUuid === this.paginaActivaUuid)) {
      this.paginaActivaUuid = this.paginas[0]?.clientUuid || null;
      if (!this.paginaActivaUuid) this.vistaGeneral = true;
    }
    this.observacionesHoja = this.vistaGeneral ? '' : (this.paginaActiva?.observaciones || '');
    this.syncSaltoHoja();
    this.pendienteSync = !cache.lastSyncAt || this.actividades.some((a) => !a.id);
    if (!this.nuevaActividadEstatus || !this.estatus.some((e) => e.clave === this.nuevaActividadEstatus)) {
      this.nuevaActividadEstatus = this.estatus.find((e) => !e.esFinal)?.clave || this.estatus[0]?.clave || 'pendiente';
    }
    setTimeout(() => {
      this.ajustarAltosTitulos();
      this.syncPreviewsHoja();
    }, 0);
  }

  previewDe(diagramaId: number | null | undefined): PreviewGrafico | null {
    if (!diagramaId) return null;
    if (!this.previews.has(diagramaId)) {
      Promise.resolve().then(() => this.ensurePreview(diagramaId));
      return null;
    }
    return this.previews.get(diagramaId) || null;
  }

  ensurePreview(diagramaId: number, xmlForzado?: string | null): void {
    if (!diagramaId) return;
    const existente = this.previews.get(diagramaId);
    if (existente && !xmlForzado && (existente.loading || existente.imgUrl)) return;

    this.previews.set(diagramaId, {
      loading: true,
      error: null,
      imgUrl: existente?.imgUrl || null
    });

    if (xmlForzado) {
      this.encolarExport(diagramaId, xmlForzado);
      return;
    }

    this.diagramasService.obtener(diagramaId).subscribe({
      next: (res) => {
        const xml = res?.diagrama?.xml || XML_VACIO;
        this.encolarExport(diagramaId, xml);
      },
      error: (err) => {
        const pv = this.previews.get(diagramaId);
        if (!pv) return;
        pv.loading = false;
        pv.error = err?.error?.message || 'No se pudo cargar el gráfico';
      }
    });
  }

  private syncPreviewsHoja(): void {
    for (const a of this.actividadesEnHoja) {
      if (a.diagramaId) this.ensurePreview(a.diagramaId);
    }
  }

  private invalidarPreview(diagramaId: number | null, xml?: string | null): void {
    if (!diagramaId) return;
    this.previews.delete(diagramaId);
    this.ensurePreview(diagramaId, xml || null);
  }

  private encolarExport(id: number, xml: string): void {
    this.exportCola = this.exportCola.filter((q) => q.id !== id);
    this.exportCola.push({ id, xml: xml || XML_VACIO });
    this.procesarColaExport();
  }

  private procesarColaExport(): void {
    if (this.exportOcupado || !this.exportCola.length) return;
    if (!this.exportListo) return;
    const marco = this.marcoExport?.nativeElement?.contentWindow;
    if (!marco) return;

    const job = this.exportCola.shift()!;
    this.exportOcupado = true;
    this.exportEsperandoLoad = true;
    this.exportActualId = job.id;
    if (this.exportTimer) clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => {
      this.fallarExportActual('Tiempo de espera al generar la vista previa');
    }, 25000);

    marco.postMessage(JSON.stringify({
      action: 'load',
      xml: job.xml,
      autosave: 0,
      fit: 1
    }), EDITOR_ORIGEN);
  }

  private pedirPngExport(): void {
    const marco = this.marcoExport?.nativeElement?.contentWindow;
    if (!marco) return;
    this.exportEsperandoLoad = false;
    marco.postMessage(JSON.stringify({
      action: 'export',
      format: 'png',
      width: 640,
      border: 12,
      background: '#ffffff',
      shadow: false,
      size: 'diagram'
    }), EDITOR_ORIGEN);
  }

  private fallarExportActual(mensaje: string): void {
    const id = this.exportActualId;
    if (this.exportTimer) {
      clearTimeout(this.exportTimer);
      this.exportTimer = null;
    }
    this.exportOcupado = false;
    this.exportEsperandoLoad = false;
    this.exportActualId = null;
    if (id != null) {
      const pv = this.previews.get(id);
      if (pv) {
        pv.loading = false;
        pv.error = mensaje;
      }
    }
    this.procesarColaExport();
  }

  private completarExport(dataUri: string): void {
    const id = this.exportActualId;
    if (this.exportTimer) {
      clearTimeout(this.exportTimer);
      this.exportTimer = null;
    }
    this.exportOcupado = false;
    this.exportEsperandoLoad = false;
    this.exportActualId = null;
    if (id != null) {
      const pv = this.previews.get(id);
      if (pv) {
        pv.loading = false;
        pv.error = null;
        pv.imgUrl = dataUri;
      }
    }
    this.procesarColaExport();
  }

  private ajustarAltosTitulos(): void {
    document.querySelectorAll<HTMLTextAreaElement>('.agenda-entry__title').forEach((el) => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    });
  }

  get totalArchivados(): number {
    return this.actividadesArchivo.length + this.paginasArchivo.length;
  }

  async sincronizar(silencioso = false): Promise<void> {
    if (!this.online) {
      this.pendienteSync = true;
      return;
    }
    if (this.sincronizando) return;
    this.sincronizando = true;
    if (!silencioso) this.cargando = true;
    this.errorCarga = null;
    try {
      const cache = this.local.leer();
      const payload = this.local.payloadParaSync(cache);
      const res: any = await firstValueFrom(this.backend.sincronizarAgenda(payload));
      if (res?.success) {
        this.local.aplicarSnapshotServidor(res);
        this.refrescarDesdeLocal();
        this.pendienteSync = false;
      } else {
        throw new Error(res?.message || 'No se pudo sincronizar');
      }
    } catch (err: any) {
      this.errorCarga = err?.error?.message || err?.message || 'Sin conexión con el servidor; se usa copia local.';
      this.pendienteSync = true;
      this.refrescarDesdeLocal();
    } finally {
      this.sincronizando = false;
      this.cargando = false;
    }
  }

  async agregarActividad(): Promise<void> {
    const titulo = this.nuevaActividadTitulo.trim();
    const paginaDestino = this.vistaGeneral
      ? (this.paginas[0] || null)
      : this.paginaActiva;
    if (!titulo || !paginaDestino) return;

    const cache = this.local.leer();
    const uuid = this.local.nuevoUuid();
    const enHoja = (cache.actividades || []).filter(
      (a) => !a.eliminado && a.paginaUuid === paginaDestino.clientUuid
    );
    const estatusClave = this.estatus.some((e) => e.clave === this.nuevaActividadEstatus)
      ? this.nuevaActividadEstatus
      : (this.estatus.find((e) => !e.esFinal)?.clave || 'pendiente');

    const item: AgendaActividadLocal = {
      id: null,
      clientUuid: uuid,
      paginaUuid: paginaDestino.clientUuid,
      titulo: titulo.slice(0, 255),
      descripcion: '',
      estatusClave,
      prioridad: 'normal',
      fechaLimite: null,
      posX: 0,
      posY: 0,
      ancho: 0,
      diagramaId: null,
      orden: (enHoja.length + 1) * 10,
      eliminado: false,
      updatedAtMs: this.local.ahoraMs()
    };

    cache.actividades = [...(cache.actividades || []), item];
    this.local.guardar(cache);
    this.nuevaActividadTitulo = '';
    this.refrescarDesdeLocal();
    this.seleccionadaUuid = uuid;
    this.pendienteSync = true;
    await this.intentarSyncRapido();
    setTimeout(() => {
      const el = document.querySelector(`[data-nota-uuid="${uuid}"] .agenda-entry__title`) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      el.select();
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }, 40);
  }

  seleccionarNota(uuid: string, ev?: Event): void {
    ev?.stopPropagation();
    this.seleccionadaUuid = uuid;
  }

  toggleMenuEstatus(ev: Event, uuid: string): void {
    ev.stopPropagation();
    this.menuEstatusUuid = this.menuEstatusUuid === uuid ? null : uuid;
  }

  onTituloChange(item: AgendaActividadLocal, valor: string): void {
    this.guardarDebounce$.next({ uuid: item.clientUuid, valor });
  }

  ajustarAltoTitulo(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  onObservacionesChange(valor: string): void {
    if (this.vistaGeneral) return;
    this.observacionesHoja = valor;
    this.obsDebounce$.next(valor);
  }

  enfocarNota(uuid: string): void {
    this.seleccionadaUuid = uuid;
    setTimeout(() => {
      const el = document.querySelector(`[data-nota-uuid="${uuid}"] .agenda-entry__title`) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }, 30);
  }

  private async aplicarEdicionTitulo(uuid: string, valor: string): Promise<void> {
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === uuid);
    if (idx < 0) return;
    // Conserva saltos de línea (\n); solo limpia extremos
    const limpio = String(valor || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').slice(0, 255);
    if (cache.actividades[idx].titulo === limpio) return;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      titulo: limpio,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  private async guardarObservaciones(texto: string): Promise<void> {
    if (this.vistaGeneral || !this.paginaActivaUuid) return;
    const cache = this.local.leer();
    const idx = (cache.paginas || []).findIndex((p) => p.clientUuid === this.paginaActivaUuid);
    if (idx < 0) return;
    cache.paginas[idx] = {
      ...cache.paginas[idx],
      observaciones: String(texto || '').slice(0, 20000),
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async cambiarEstatus(item: AgendaActividadLocal, nuevaClave: string, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    this.menuEstatusUuid = null;
    if (!nuevaClave || nuevaClave === item.estatusClave) return;
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === item.clientUuid);
    if (idx < 0) return;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      estatusClave: nuevaClave,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async eliminarActividad(item: AgendaActividadLocal, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    const conf = await Swal.fire({
      icon: 'question',
      title: '¿Desactivar esta actividad?',
      text: `“${item.titulo || 'Sin título'}” se archivará. Un superadministrador puede reactivarla.`,
      showCancelButton: true,
      confirmButtonText: 'Desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!conf.isConfirmed) return;
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === item.clientUuid);
    if (idx < 0) return;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      eliminado: true,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    if (this.seleccionadaUuid === item.clientUuid) this.seleccionadaUuid = null;
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  private animarGiro(dir: 'next' | 'prev'): void {
    if (this.giroTimer) clearTimeout(this.giroTimer);
    this.giroHoja = dir;
    this.giroTimer = setTimeout(() => {
      this.giroHoja = null;
      this.giroTimer = null;
    }, 220);
  }

  toggleCompletadas(ev?: Event): void {
    ev?.stopPropagation();
    this.completadasAbiertas = !this.completadasAbiertas;
  }

  private syncSaltoHoja(): void {
    this.saltoHoja = String(this.indicePagina + 1);
  }

  /** Salta a la hoja N (1 = General, 2 = primera específica, …). */
  irANumeroHoja(valor?: string | number, dirHint: 'next' | 'prev' | null = null): void {
    const raw = valor != null ? String(valor) : this.saltoHoja;
    const n = Math.floor(Number(String(raw).replace(/[^\d]/g, '')));
    if (!Number.isFinite(n) || n < 1) {
      this.syncSaltoHoja();
      return;
    }
    const destino = Math.min(n, this.totalHojasVista);
    const actual = this.indicePagina + 1;
    if (destino === actual) {
      this.syncSaltoHoja();
      return;
    }
    const dir = dirHint || (destino > actual ? 'next' : 'prev');
    if (destino === 1) {
      this.irVistaGeneral(dir);
      return;
    }
    const pagina = this.paginas[destino - 2];
    if (pagina) this.irPagina(pagina.clientUuid, dir);
    else this.syncSaltoHoja();
  }

  onSaltoHojaEnter(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.irANumeroHoja(this.saltoHoja);
  }

  onSaltoHojaBlur(): void {
    this.irANumeroHoja(this.saltoHoja);
  }

  irVistaGeneral(dir: 'next' | 'prev' | null = null): void {
    if (this.vistaGeneral) {
      this.syncSaltoHoja();
      return;
    }
    if (dir) this.animarGiro(dir);
    this.vistaGeneral = true;
    this.completadasAbiertas = false;
    this.seleccionadaUuid = null;
    this.menuEstatusUuid = null;
    this.observacionesHoja = '';
    this.syncSaltoHoja();
    setTimeout(() => {
      this.ajustarAltosTitulos();
      this.syncPreviewsHoja();
    }, 40);
  }

  irPagina(uuid: string, dir: 'next' | 'prev' | null = null): void {
    if (!this.vistaGeneral && uuid === this.paginaActivaUuid) {
      this.syncSaltoHoja();
      return;
    }
    if (dir) this.animarGiro(dir);
    this.vistaGeneral = false;
    this.completadasAbiertas = false;
    this.paginaActivaUuid = uuid;
    this.seleccionadaUuid = null;
    this.menuEstatusUuid = null;
    this.observacionesHoja = this.paginas.find((p) => p.clientUuid === uuid)?.observaciones || '';
    this.syncSaltoHoja();
    setTimeout(() => {
      this.ajustarAltosTitulos();
      this.syncPreviewsHoja();
    }, 40);
  }

  paginaAnterior(): void {
    const i = this.indicePagina;
    if (i <= 0) return;
    if (i === 1) {
      this.irVistaGeneral('prev');
      return;
    }
    this.irPagina(this.paginas[i - 2].clientUuid, 'prev');
  }

  paginaSiguiente(): void {
    const i = this.indicePagina;
    if (i >= this.totalHojasVista - 1) return;
    if (this.vistaGeneral) {
      if (this.paginas[0]) this.irPagina(this.paginas[0].clientUuid, 'next');
      return;
    }
    this.irPagina(this.paginas[i].clientUuid, 'next');
  }

  async crearPagina(): Promise<void> {
    const cache = this.local.leer();
    const n = (cache.paginas || []).filter((p) => !p.eliminado).length + 1;
    const pagina: AgendaPaginaLocal = {
      clientUuid: this.local.nuevoUuid(),
      titulo: `Hoja ${n}`,
      observaciones: '',
      orden: n * 10,
      eliminado: false,
      updatedAtMs: this.local.ahoraMs()
    };
    cache.paginas = [...(cache.paginas || []), pagina];
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.vistaGeneral = false;
    this.paginaActivaUuid = pagina.clientUuid;
    this.observacionesHoja = '';
    this.syncSaltoHoja();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async renombrarPaginaActual(): Promise<void> {
    if (this.vistaGeneral || !this.paginaActiva) return;
    await this.renombrarPagina(this.paginaActiva);
  }

  async renombrarPagina(pagina: AgendaPaginaLocal): Promise<void> {
    const { value } = await Swal.fire({
      title: 'Nombre de la hoja',
      input: 'text',
      inputValue: pagina.titulo,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v || !v.trim() ? 'Escribe un nombre' : null)
    });
    if (!value) return;
    const cache = this.local.leer();
    const idx = (cache.paginas || []).findIndex((p) => p.clientUuid === pagina.clientUuid);
    if (idx < 0) return;
    cache.paginas[idx] = {
      ...cache.paginas[idx],
      titulo: String(value).trim().slice(0, 120),
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async eliminarPagina(pagina: AgendaPaginaLocal): Promise<void> {
    if (this.paginas.length <= 1) {
      await Swal.fire({ icon: 'info', title: 'No se puede desactivar', text: 'Debes conservar al menos una hoja activa.' });
      return;
    }
    const enUso = this.actividades.some((a) => a.paginaUuid === pagina.clientUuid);
    const conf = await Swal.fire({
      icon: 'warning',
      title: '¿Desactivar hoja?',
      text: enUso
        ? `“${pagina.titulo}” y sus actividades/notas se archivarán. Un superadministrador puede reactivarlas.`
        : `“${pagina.titulo}” se archivará con sus notas. Se puede reactivar después.`,
      showCancelButton: true,
      confirmButtonText: 'Desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!conf.isConfirmed) return;
    const cache = this.local.leer();
    const ms = this.local.ahoraMs();
    cache.paginas = (cache.paginas || []).map((p) =>
      p.clientUuid === pagina.clientUuid ? { ...p, eliminado: true, updatedAtMs: ms } : p
    );
    cache.actividades = (cache.actividades || []).map((a) =>
      a.paginaUuid === pagina.clientUuid ? { ...a, eliminado: true, updatedAtMs: ms } : a
    );
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  abrirArchivo(): void {
    if (!this.esRoot) return;
    this.mostrarPanelArchivo = true;
  }

  cerrarArchivo(): void {
    this.mostrarPanelArchivo = false;
  }

  get catalogoDiagramasFiltrado(): DiagramaResumen[] {
    const q = this.busquedaDiagrama.trim().toLowerCase();
    if (!q) return this.catalogoDiagramas;
    return this.catalogoDiagramas.filter((d) => String(d.titulo || '').toLowerCase().includes(q));
  }

  async gestionarGrafico(item: AgendaActividadLocal, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    if (!this.online) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin conexión',
        text: 'Los gráficos usan el editor de Diagramas; se necesita internet.'
      });
      return;
    }

    if (item.diagramaId) {
      const conf = await Swal.fire({
        icon: 'question',
        title: 'Gráfico vinculado',
        text: `Esta actividad ya tiene un diagrama (#${item.diagramaId}).`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Abrir editor',
        denyButtonText: 'Desvincular',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#2563eb',
        denyButtonColor: '#64748b'
      });
      if (conf.isConfirmed) {
        await this.abrirEditorGrafico(item.diagramaId);
      } else if (conf.isDenied) {
        await this.vincularDiagramaAActividad(item.clientUuid, null);
      }
      return;
    }

    const conf = await Swal.fire({
      icon: 'question',
      title: 'Agregar gráfico',
      text: 'Se abre el editor aquí mismo, sin salir de Agenda.',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Crear nuevo',
      denyButtonText: 'Vincular existente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb'
    });
    if (conf.isConfirmed) {
      await this.crearDiagramaParaActividad(item);
    } else if (conf.isDenied) {
      this.abrirSelectorDiagramas(item.clientUuid);
    }
  }

  private async abrirEditorGrafico(diagramaId: number): Promise<void> {
    try {
      const res = await firstValueFrom(this.diagramasService.obtener(diagramaId));
      if (!res?.diagrama) throw new Error('Diagrama no encontrado');
      this.mostrarEditorGrafico(res.diagrama);
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo abrir el gráfico',
        text: err?.error?.message || err?.message || 'Intenta de nuevo'
      });
    }
  }

  private async crearDiagramaParaActividad(item: AgendaActividadLocal): Promise<void> {
    const titulo = (item.titulo || '').trim() || `Agenda · ${this.paginaActiva?.titulo || 'Hoja'}`;
    try {
      const res = await firstValueFrom(this.diagramasService.crear(titulo.slice(0, 180)));
      const diagrama = res?.diagrama;
      const id = Number(diagrama?.diagrama_id);
      if (!diagrama || !id) throw new Error('No se obtuvo el ID del diagrama');
      await this.vincularDiagramaAActividad(item.clientUuid, id);
      this.mostrarEditorGrafico(diagrama);
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo crear el gráfico',
        text: err?.error?.message || err?.message || 'Intenta de nuevo'
      });
    }
  }

  abrirSelectorDiagramas(actividadUuid: string): void {
    this.vinculandoActividadUuid = actividadUuid;
    this.busquedaDiagrama = '';
    this.mostrarPanelDiagramas = true;
    this.cargandoDiagramas = true;
    this.catalogoDiagramas = [];
    this.diagramasService.listar().subscribe({
      next: (res) => {
        this.catalogoDiagramas = res?.diagramas || [];
        this.cargandoDiagramas = false;
      },
      error: () => {
        this.cargandoDiagramas = false;
        this.catalogoDiagramas = [];
      }
    });
  }

  cerrarSelectorDiagramas(): void {
    this.mostrarPanelDiagramas = false;
    this.vinculandoActividadUuid = null;
    this.busquedaDiagrama = '';
  }

  async elegirDiagramaExistente(d: DiagramaResumen): Promise<void> {
    if (!this.vinculandoActividadUuid) return;
    const uuid = this.vinculandoActividadUuid;
    const id = Number(d.diagrama_id);
    this.cerrarSelectorDiagramas();
    await this.vincularDiagramaAActividad(uuid, id);
    await this.abrirEditorGrafico(id);
  }

  cerrarEditorGrafico(): void {
    const idCerrado = this.graficoId;
    const xmlCerrado = this.graficoXml;
    this.flushGuardadoGrafico();
    this.cancelarTimersGrafico();
    this.editandoGrafico = false;
    this.graficoId = null;
    this.graficoUrl = null;
    this.graficoEditorListo = false;
    this.graficoError = null;
    this.graficoXmlPendiente = null;
    this.graficoCola = null;
    // Refrescar miniatura en la libreta con el XML recién editado
    this.invalidarPreview(idCerrado, xmlCerrado);
  }

  editarGraficoDesdePreview(diagramaId: number, ev?: Event): void {
    ev?.stopPropagation();
    void this.abrirEditorGrafico(diagramaId);
  }

  guardarTituloGrafico(): void {
    const id = this.graficoId;
    const titulo = this.graficoTitulo.trim();
    if (!id || !titulo) return;
    this.diagramasService.actualizar(id, { titulo }).subscribe({
      error: (err) => {
        this.graficoEstado = 'error';
        this.graficoMensaje = err?.error?.message || 'No se pudo renombrar';
      }
    });
  }

  reintentarEditorGrafico(): void {
    if (!this.graficoId) return;
    this.graficoError = null;
    this.graficoEditorListo = false;
    this.graficoRev += 1;
    this.graficoUrl = this.construirUrlGrafico();
    this.armarEsperaInitGrafico();
  }

  private mostrarEditorGrafico(diagrama: DiagramaDetalle): void {
    this.flushGuardadoGrafico();
    this.graficoId = diagrama.diagrama_id;
    this.graficoTitulo = diagrama.titulo || '';
    this.graficoXml = diagrama.xml || XML_VACIO;
    this.graficoXmlPendiente = null;
    this.graficoEditorListo = false;
    this.graficoError = null;
    this.graficoEstado = 'listo';
    this.graficoMensaje = '';
    this.graficoRev += 1;
    this.graficoUrl = this.construirUrlGrafico();
    this.editandoGrafico = true;
    this.armarEsperaInitGrafico();
  }

  private construirUrlGrafico(): SafeResourceUrl {
    const url = `${EDITOR_ORIGEN}/?embed=1&proto=json&spin=1&lang=es&libraries=1&ui=atlas&rev=${this.graficoRev}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private armarEsperaInitGrafico(): void {
    if (this.graficoTimerInit) clearTimeout(this.graficoTimerInit);
    this.graficoTimerInit = setTimeout(() => {
      if (this.editandoGrafico && !this.graficoEditorListo) {
        this.graficoError = 'El editor no respondió. Revisa la conexión e inténtalo de nuevo.';
      }
    }, 20000);
  }

  private onMensajeGrafico = (event: MessageEvent): void => {
    if (event.origin !== EDITOR_ORIGEN || typeof event.data !== 'string') return;

    let msg: { event?: string; xml?: string; data?: string; exit?: boolean };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const exportWin = this.marcoExport?.nativeElement?.contentWindow;
    if (exportWin && event.source === exportWin) {
      this.zone.run(() => {
        if (msg.event === 'init') {
          exportWin.postMessage(JSON.stringify({
            action: 'load',
            xml: XML_VACIO,
            autosave: 0
          }), EDITOR_ORIGEN);
          return;
        }
        if (msg.event === 'load') {
          if (!this.exportListo) {
            this.exportListo = true;
            this.procesarColaExport();
            return;
          }
          if (this.exportEsperandoLoad && this.exportActualId != null) {
            this.pedirPngExport();
          }
          return;
        }
        if (msg.event === 'export' && typeof msg.data === 'string' && msg.data) {
          this.completarExport(msg.data);
          return;
        }
      });
      return;
    }

    const marco = this.marcoGrafico?.nativeElement?.contentWindow;
    if (!marco || event.source !== marco) return;

    this.zone.run(() => {
      if (msg.event === 'init') {
        this.graficoEditorListo = true;
        this.graficoError = null;
        if (this.graficoTimerInit) {
          clearTimeout(this.graficoTimerInit);
          this.graficoTimerInit = null;
        }
        marco.postMessage(JSON.stringify({
          action: 'load',
          xml: this.graficoXml || XML_VACIO,
          autosave: 1,
          title: `${this.graficoTitulo || 'agenda'}.drawio`
        }), EDITOR_ORIGEN);
        return;
      }

      if ((msg.event === 'save' || msg.event === 'autosave') && typeof msg.xml === 'string' && msg.xml) {
        this.graficoXml = msg.xml;
        this.programarGuardadoGrafico(msg.xml, msg.event === 'save');
        if (msg.exit) this.cerrarEditorGrafico();
        return;
      }

      if (msg.event === 'exit') {
        this.cerrarEditorGrafico();
      }
    });
  };

  private programarGuardadoGrafico(xml: string, inmediato: boolean): void {
    this.graficoXmlPendiente = xml;
    this.graficoEstado = 'pendiente';
    if (this.graficoTimerSave) clearTimeout(this.graficoTimerSave);
    if (inmediato) {
      this.flushGuardadoGrafico();
      return;
    }
    this.graficoTimerSave = setTimeout(() => this.flushGuardadoGrafico(), 900);
  }

  private flushGuardadoGrafico(): void {
    if (this.graficoTimerSave) {
      clearTimeout(this.graficoTimerSave);
      this.graficoTimerSave = null;
    }
    const id = this.graficoId;
    const xml = this.graficoXmlPendiente;
    if (!id || xml == null) return;
    this.graficoXmlPendiente = null;
    if (this.graficoGuardando) {
      this.graficoCola = { id, xml };
      return;
    }
    this.enviarXmlGrafico(id, xml);
  }

  private enviarXmlGrafico(id: number, xml: string): void {
    this.graficoGuardando = true;
    this.graficoEstado = 'guardando';
    this.diagramasService.actualizar(id, { xml }).subscribe({
      next: () => {
        this.graficoGuardando = false;
        this.graficoEstado = 'guardado';
        this.graficoMensaje = '';
        this.continuarGuardadoGrafico();
      },
      error: (err) => {
        this.graficoGuardando = false;
        this.graficoEstado = 'error';
        this.graficoMensaje = err?.error?.message || 'No se pudo guardar el gráfico';
        if (this.graficoCola) {
          this.continuarGuardadoGrafico();
          return;
        }
        if (this.graficoId === id && this.graficoXmlPendiente == null) {
          this.graficoXmlPendiente = xml;
        }
      }
    });
  }

  private continuarGuardadoGrafico(): void {
    if (this.graficoXmlPendiente != null && this.graficoId) {
      this.graficoCola = { id: this.graficoId, xml: this.graficoXmlPendiente };
      this.graficoXmlPendiente = null;
    }
    if (!this.graficoCola || this.graficoGuardando) return;
    const siguiente = this.graficoCola;
    this.graficoCola = null;
    this.enviarXmlGrafico(siguiente.id, siguiente.xml);
  }

  private cancelarTimersGrafico(): void {
    if (this.graficoTimerInit) {
      clearTimeout(this.graficoTimerInit);
      this.graficoTimerInit = null;
    }
    if (this.graficoTimerSave) {
      clearTimeout(this.graficoTimerSave);
      this.graficoTimerSave = null;
    }
  }

  private async vincularDiagramaAActividad(uuid: string, diagramaId: number | null): Promise<void> {
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === uuid);
    if (idx < 0) return;
    const previo = cache.actividades[idx].diagramaId;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      diagramaId,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    if (diagramaId) this.ensurePreview(diagramaId);
    if (previo && previo !== diagramaId) {
      const sigueUsado = this.actividades.some((a) => a.diagramaId === previo);
      if (!sigueUsado) this.previews.delete(previo);
    }
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async reactivarActividad(item: AgendaActividadLocal): Promise<void> {
    if (!this.esRoot) return;
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === item.clientUuid);
    if (idx < 0) return;
    const paginaActiva = (cache.paginas || []).find(
      (p) => p.clientUuid === cache.actividades[idx].paginaUuid && !p.eliminado
    );
    let paginaUuid = cache.actividades[idx].paginaUuid;
    if (!paginaActiva) {
      paginaUuid = this.paginas[0]?.clientUuid || paginaUuid;
    }
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      paginaUuid,
      eliminado: false,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async reactivarPagina(pagina: AgendaPaginaLocal): Promise<void> {
    if (!this.esRoot) return;
    const cache = this.local.leer();
    const ms = this.local.ahoraMs();
    cache.paginas = (cache.paginas || []).map((p) =>
      p.clientUuid === pagina.clientUuid ? { ...p, eliminado: false, updatedAtMs: ms } : p
    );
    // Reactivar también las actividades de esa hoja que estaban archivadas con ella
    cache.actividades = (cache.actividades || []).map((a) =>
      a.paginaUuid === pagina.clientUuid ? { ...a, eliminado: false, updatedAtMs: ms } : a
    );
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.vistaGeneral = false;
    this.paginaActivaUuid = pagina.clientUuid;
    this.observacionesHoja = pagina.observaciones || '';
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  abrirGestionEstatus(): void {
    this.menuFiltroAbierto = false;
    this.editandoEstatusUuid = null;
    this.formEstatus = this.formEstatusVacio();
    this.mostrarPanelEstatus = true;
  }

  editarEstatus(e: AgendaEstatusLocal): void {
    this.editandoEstatusUuid = e.clientUuid;
    this.formEstatus = { etiqueta: e.etiqueta, color: e.color, esFinal: !!e.esFinal };
    this.mostrarPanelEstatus = true;
  }

  cerrarPanelEstatus(): void {
    this.mostrarPanelEstatus = false;
    this.editandoEstatusUuid = null;
  }

  async guardarEstatus(): Promise<void> {
    const etiqueta = (this.formEstatus.etiqueta || '').trim();
    if (!etiqueta) {
      await Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Ponle un nombre al estatus.' });
      return;
    }
    const cache = this.local.leer();
    const ms = this.local.ahoraMs();
    const uuid = this.editandoEstatusUuid || this.local.nuevoUuid();
    const existente = (cache.estatus || []).find((e) => e.clientUuid === uuid);
    const clave = existente?.clave || this.claveDesdeEtiqueta(etiqueta);
    const item: AgendaEstatusLocal = {
      id: existente?.id ?? null,
      clientUuid: uuid,
      clave,
      etiqueta: etiqueta.slice(0, 100),
      color: this.formEstatus.color || '#64748B',
      orden: existente?.orden ?? ((cache.estatus || []).filter((e) => !e.eliminado).length + 1) * 10,
      esFinal: !!this.formEstatus.esFinal,
      eliminado: false,
      updatedAtMs: ms
    };
    cache.estatus = [...(cache.estatus || []).filter((e) => e.clientUuid !== uuid), item];
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.editandoEstatusUuid = null;
    this.formEstatus = this.formEstatusVacio();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async eliminarEstatus(e: AgendaEstatusLocal): Promise<void> {
    const enUso = this.actividades.some((a) => a.estatusClave === e.clave);
    if (enUso) {
      await Swal.fire({ icon: 'info', title: 'Estatus en uso', text: 'Hay actividades con este estatus.' });
      return;
    }
    if (this.estatus.length <= 1) {
      await Swal.fire({ icon: 'info', title: 'No se puede eliminar', text: 'Debes conservar al menos un estatus.' });
      return;
    }
    const conf = await Swal.fire({
      icon: 'question',
      title: '¿Eliminar estatus?',
      text: e.etiqueta,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!conf.isConfirmed) return;
    const cache = this.local.leer();
    const idx = (cache.estatus || []).findIndex((x) => x.clientUuid === e.clientUuid);
    if (idx < 0) return;
    cache.estatus[idx] = { ...cache.estatus[idx], eliminado: true, updatedAtMs: this.local.ahoraMs() };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  trackByUuid(_: number, item: { clientUuid: string }): string {
    return item.clientUuid;
  }

  trackByDiagramaId(_: number, item: DiagramaResumen): number {
    return item.diagrama_id;
  }

  private async intentarSyncRapido(): Promise<void> {
    if (!this.online) return;
    await this.sincronizar(true);
  }

  private claveDesdeEtiqueta(etiqueta: string): string {
    const base = etiqueta
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    let clave = base || `estatus_${Date.now()}`;
    const usadas = new Set(this.estatus.map((e) => e.clave));
    if (!usadas.has(clave)) return clave;
    let i = 2;
    while (usadas.has(`${clave}_${i}`)) i += 1;
    return `${clave}_${i}`;
  }

  private formEstatusVacio(): EstatusForm {
    return { etiqueta: '', color: '#2D5BFF', esFinal: false };
  }
}
