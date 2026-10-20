import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DiagramasService, DiagramaDetalle, DiagramaResumen } from 'src/app/services/diagramas.service';
import { DiagramasSocketService } from 'src/app/services/diagramas-socket.service';
import { AuthService } from 'src/app/services/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

const EDITOR_ORIGEN = 'https://embed.diagrams.net';
const XML_VACIO = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

type EstadoGuardado = 'listo' | 'pendiente' | 'guardando' | 'guardado' | 'error';

interface Presente {
  id: number;
  nombre: string;
  inicial: string;
  color: string;
  soyYo: boolean;
}

const COLORES_PRESENCIA = ['#0f766e', '#b45309', '#1d4ed8', '#be185d', '#6d28d9', '#b91c1c'];

@Component({
  selector: 'app-diagramas',
  templateUrl: './diagramas.component.html',
  styleUrls: ['./diagramas.component.scss']
})
export class DiagramasComponent implements OnInit, OnDestroy {
  @ViewChild('marco') marco?: ElementRef<HTMLIFrameElement>;

  diagramas: DiagramaResumen[] = [];
  busqueda = '';
  cargando = false;
  error: string | null = null;

  creando = false;
  tituloNuevo = '';
  creandoAhora = false;

  editando = false;
  diagramaId: number | null = null;
  tituloEdicion = '';
  xmlActual = XML_VACIO;
  urlEditor: SafeResourceUrl | null = null;
  editorListo = false;
  errorEditor: string | null = null;
  estadoGuardado: EstadoGuardado = 'listo';
  mensajeGuardado = '';
  presentes: Presente[] = [];
  enVivo = false;

  private rev = 0;
  private readonly fin$ = new Subject<void>();
  private ecosPendientes = 0;
  private ultimoChecksumRemoto: string | null = null;
  private xmlRemoto = '';
  private pendienteXml: string | null = null;
  private colaGuardado: { id: number; xml: string } | null = null;
  private timerGuardado: ReturnType<typeof setTimeout> | null = null;
  private timerInit: ReturnType<typeof setTimeout> | null = null;
  private guardadoEnCurso = false;

  constructor(
    private diagramasService: DiagramasService,
    private diagramasSocket: DiagramasSocketService,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    window.addEventListener('message', this.onMensaje);
    this.diagramasSocket.onEstado().pipe(takeUntil(this.fin$)).subscribe((conectado) => {
      this.enVivo = conectado;
    });
    this.diagramasSocket.onPresencia().pipe(takeUntil(this.fin$)).subscribe((evento) => {
      if (!this.editando || evento?.diagramaId !== this.diagramaId) return;
      this.presentes = this.mapearPresentes(evento.usuarios || []);
    });
    this.diagramasSocket.onCambio().pipe(takeUntil(this.fin$)).subscribe((evento) => {
      this.aplicarCambioRemoto(evento);
    });
    this.cargar();
  }

  ngOnDestroy(): void {
    if (this.diagramaId) this.diagramasSocket.salir(this.diagramaId);
    this.diagramasSocket.disconnect();
    this.fin$.next();
    this.fin$.complete();
    window.removeEventListener('message', this.onMensaje);
    this.cancelarTimers();
    this.flushGuardado();
  }

  get diagramasVisibles(): DiagramaResumen[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.diagramas;
    return this.diagramas.filter((d) => String(d.titulo || '').toLowerCase().includes(q));
  }

  get etiquetaGuardado(): string {
    if (this.estadoGuardado === 'guardando') return 'Guardando…';
    if (this.estadoGuardado === 'pendiente') return 'Cambios sin guardar';
    if (this.estadoGuardado === 'guardado') return 'Guardado en el SIB';
    if (this.estadoGuardado === 'error') return this.mensajeGuardado || 'No se pudo guardar';
    return this.enVivo ? 'Listo para editar' : 'Sin conexión en vivo';
  }

  get textoPresentes(): string {
    if (!this.presentes.length) return '';
    if (this.presentes.length === 1 && this.presentes[0].soyYo) return 'Solo tú';
    const otros = this.presentes.filter((persona) => !persona.soyYo).length;
    if (!otros) return 'Solo tú';
    return otros === 1 ? '1 persona más' : `${otros} personas más`;
  }

  cargar(): void {
    this.cargando = true;
    this.error = null;
    this.diagramasService.listar().subscribe({
      next: (res) => {
        this.diagramas = res?.diagramas || [];
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.error = this.mensajeError(err, 'No se pudieron cargar los diagramas');
      }
    });
  }

  abrirFormulario(): void {
    this.creando = true;
    this.tituloNuevo = '';
    this.error = null;
  }

  cancelarFormulario(): void {
    this.creando = false;
    this.tituloNuevo = '';
  }

  crear(): void {
    const titulo = this.tituloNuevo.trim();
    if (!titulo || this.creandoAhora) return;
    this.creandoAhora = true;
    this.error = null;
    this.diagramasService.crear(titulo).subscribe({
      next: (res) => {
        this.creandoAhora = false;
        this.creando = false;
        this.tituloNuevo = '';
        const diagrama = res?.diagrama;
        if (diagrama) {
          this.ponerEnLista(diagrama);
          this.mostrarEditor(diagrama);
        }
      },
      error: (err) => {
        this.creandoAhora = false;
        this.error = this.mensajeError(err, 'No se pudo crear el diagrama');
      }
    });
  }

  abrir(item: DiagramaResumen): void {
    if (this.editando && this.diagramaId === item.diagrama_id) return;
    this.flushGuardado();
    this.error = null;
    this.diagramasService.obtener(item.diagrama_id).subscribe({
      next: (res) => {
        if (res?.diagrama) this.mostrarEditor(res.diagrama);
      },
      error: (err) => {
        this.error = this.mensajeError(err, 'No se pudo abrir el diagrama');
      }
    });
  }

  cerrarEditor(): void {
    if (this.diagramaId) this.diagramasSocket.salir(this.diagramaId);
    this.flushGuardado();
    this.editando = false;
    this.diagramaId = null;
    this.presentes = [];
    this.urlEditor = null;
    this.editorListo = false;
    this.errorEditor = null;
    this.ecosPendientes = 0;
    this.ultimoChecksumRemoto = null;
    this.xmlRemoto = '';
    this.cancelarTimers();
    this.cargar();
  }

  guardarTitulo(): void {
    const id = this.diagramaId;
    const titulo = this.tituloEdicion.trim();
    if (!id || !titulo) return;
    const previo = this.diagramas.find((d) => d.diagrama_id === id);
    if (previo && previo.titulo === titulo) return;
    this.diagramasService.actualizar(id, { titulo }).subscribe({
      next: (res) => {
        if (res?.diagrama) this.ponerEnLista(res.diagrama);
      },
      error: (err) => {
        this.estadoGuardado = 'error';
        this.mensajeGuardado = this.mensajeError(err, 'No se pudo renombrar el diagrama');
      }
    });
  }

  reintentarEditor(): void {
    if (!this.diagramaId) return;
    this.errorEditor = null;
    this.editorListo = false;
    this.rev += 1;
    this.urlEditor = this.construirUrl();
    this.armarEsperaInit();
  }

  eliminar(item: DiagramaResumen, event?: Event): void {
    event?.stopPropagation();
    const ok = window.confirm(`¿Eliminar el diagrama "${item.titulo}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    this.diagramasService.eliminar(item.diagrama_id).subscribe({
      next: () => {
        this.diagramas = this.diagramas.filter((d) => d.diagrama_id !== item.diagrama_id);
        if (this.diagramaId === item.diagrama_id) this.cerrarEditor();
      },
      error: (err) => {
        this.error = this.mensajeError(err, 'No se pudo eliminar el diagrama');
      }
    });
  }

  fecha(valor?: string): string {
    if (!valor) return '';
    const normalizada = String(valor).includes('T') ? String(valor) : String(valor).replace(' ', 'T');
    const fecha = new Date(normalizada);
    if (Number.isNaN(fecha.getTime())) return String(valor);
    return fecha.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  trackById(_index: number, item: DiagramaResumen): number {
    return item.diagrama_id;
  }

  private mostrarEditor(diagrama: DiagramaDetalle): void {
    if (this.diagramaId && this.diagramaId !== diagrama.diagrama_id) {
      this.diagramasSocket.salir(this.diagramaId);
    }
    this.diagramaId = diagrama.diagrama_id;
    this.diagramasSocket.entrar(diagrama.diagrama_id);
    this.tituloEdicion = diagrama.titulo || '';
    this.xmlActual = diagrama.xml || XML_VACIO;
    this.pendienteXml = null;
    this.editorListo = false;
    this.errorEditor = null;
    this.estadoGuardado = 'listo';
    this.mensajeGuardado = '';
    this.rev += 1;
    this.urlEditor = this.construirUrl();
    this.editando = true;
    this.ponerEnLista(diagrama);
    this.armarEsperaInit();
  }

  private construirUrl(): SafeResourceUrl {
    const url = `${EDITOR_ORIGEN}/?embed=1&proto=json&spin=1&lang=es&libraries=1&ui=atlas&rev=${this.rev}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private armarEsperaInit(): void {
    if (this.timerInit) clearTimeout(this.timerInit);
    this.timerInit = setTimeout(() => {
      if (this.editando && !this.editorListo) {
        this.errorEditor = 'El editor de diagrams.net no respondió. Revisa la conexión e inténtalo de nuevo.';
      }
    }, 20000);
  }

  private onMensaje = (event: MessageEvent): void => {
    const marco = this.marco?.nativeElement?.contentWindow;
    if (!marco || event.source !== marco || event.origin !== EDITOR_ORIGEN || typeof event.data !== 'string') {
      return;
    }

    let msg: { event?: string; xml?: string; exit?: boolean };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    this.zone.run(() => {
      if (msg.event === 'init') {
        this.editorListo = true;
        this.errorEditor = null;
        marco.postMessage(JSON.stringify({
          action: 'load',
          xml: this.xmlActual || XML_VACIO,
          autosave: 1,
          diffSync: true,
          title: `${this.tituloEdicion || 'diagrama'}.drawio`
        }), EDITOR_ORIGEN);
        return;
      }

      if (msg.event === 'patch' && (msg as { checksumMismatch?: boolean }).checksumMismatch && this.xmlRemoto) {
        this.ecosPendientes += 1;
        marco.postMessage(JSON.stringify({ action: 'merge', xml: this.xmlRemoto }), EDITOR_ORIGEN);
        return;
      }

      if ((msg.event === 'save' || msg.event === 'autosave') && typeof msg.xml === 'string' && msg.xml) {
        const checksum = (msg as { checksum?: string }).checksum || null;
        if (this.esEcoRemoto(checksum)) {
          this.xmlActual = msg.xml;
          if (msg.exit) this.cerrarEditor();
          return;
        }
        this.xmlActual = msg.xml;
        this.programarGuardado(msg.xml, msg.event === 'save');
        this.publicarCambio(msg);
        if (msg.exit) this.cerrarEditor();
        return;
      }

      if (msg.event === 'exit') {
        this.cerrarEditor();
      }
    });
  };

  private programarGuardado(xml: string, inmediato: boolean): void {
    this.pendienteXml = xml;
    this.estadoGuardado = 'pendiente';
    if (this.timerGuardado) clearTimeout(this.timerGuardado);
    if (inmediato) {
      this.flushGuardado();
      return;
    }
    this.timerGuardado = setTimeout(() => this.flushGuardado(), 900);
  }

  private flushGuardado(): void {
    if (this.timerGuardado) {
      clearTimeout(this.timerGuardado);
      this.timerGuardado = null;
    }
    const id = this.diagramaId;
    const xml = this.pendienteXml;
    if (!id || xml == null) return;
    this.pendienteXml = null;
    if (this.guardadoEnCurso) {
      this.colaGuardado = { id, xml };
      return;
    }
    this.enviarXml(id, xml);
  }

  private enviarXml(id: number, xml: string): void {
    this.guardadoEnCurso = true;
    this.estadoGuardado = 'guardando';
    this.diagramasService.actualizar(id, { xml }).subscribe({
      next: () => {
        this.guardadoEnCurso = false;
        this.estadoGuardado = 'guardado';
        this.mensajeGuardado = '';
        this.continuarGuardado();
      },
      error: (err) => {
        this.guardadoEnCurso = false;
        this.estadoGuardado = 'error';
        this.mensajeGuardado = this.mensajeError(err, 'No se pudo guardar el diagrama');
        if (this.colaGuardado) {
          this.continuarGuardado();
          return;
        }
        if (this.diagramaId === id && this.pendienteXml == null) {
          this.pendienteXml = xml;
        }
      }
    });
  }

  private continuarGuardado(): void {
    if (this.pendienteXml != null && this.diagramaId) {
      const id = this.diagramaId;
      const xml = this.pendienteXml;
      this.pendienteXml = null;
      this.colaGuardado = { id, xml };
    }
    if (!this.colaGuardado || this.guardadoEnCurso) return;
    const siguiente = this.colaGuardado;
    this.colaGuardado = null;
    this.enviarXml(siguiente.id, siguiente.xml);
  }

  private publicarCambio(msg: { xml?: string; checksum?: string; patch?: unknown }): void {
    if (!this.diagramaId || !this.enVivo) return;
    const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : null;
    const xml = typeof msg.xml === 'string' && msg.xml.length <= 700_000 ? msg.xml : '';
    if (!patch && !xml) return;
    this.diagramasSocket.emitirCambio({
      diagramaId: this.diagramaId,
      patch,
      xml,
      checksum: msg.checksum || null
    });
  }

  private aplicarCambioRemoto(evento: { diagramaId?: number; patch?: unknown; xml?: string; checksum?: string | null }): void {
    if (!this.editando || !evento || evento.diagramaId !== this.diagramaId || !this.editorListo) return;
    const marco = this.marco?.nativeElement?.contentWindow;
    if (!marco) return;
    this.xmlRemoto = typeof evento.xml === 'string' ? evento.xml : '';
    this.ultimoChecksumRemoto = evento.checksum || null;
    this.ecosPendientes += 1;
    window.setTimeout(() => {
      if (this.ecosPendientes > 0) this.ecosPendientes -= 1;
    }, 1500);
    if (evento.patch && typeof evento.patch === 'object') {
      marco.postMessage(JSON.stringify({
        action: 'patch',
        patch: evento.patch,
        checksum: evento.checksum || undefined
      }), EDITOR_ORIGEN);
      return;
    }
    if (this.xmlRemoto) {
      marco.postMessage(JSON.stringify({ action: 'merge', xml: this.xmlRemoto }), EDITOR_ORIGEN);
    }
  }

  private esEcoRemoto(checksum: string | null): boolean {
    if (this.ecosPendientes <= 0) return false;
    if (this.ultimoChecksumRemoto && checksum && checksum !== this.ultimoChecksumRemoto) {
      return false;
    }
    this.ecosPendientes -= 1;
    return true;
  }

  private mapearPresentes(usuarios: Array<{ id: number; nombre: string }>): Presente[] {
    const yo = Number(this.authService.usuarioActualValue?.id || this.authService.usuarioActualValue?.usuario_id || 0);
    return usuarios.map((usuario) => {
      const nombre = usuario.nombre || 'Usuario';
      const inicial = nombre.trim().charAt(0).toUpperCase() || '?';
      return {
        id: usuario.id,
        nombre,
        inicial,
        color: COLORES_PRESENCIA[Math.abs(usuario.id) % COLORES_PRESENCIA.length],
        soyYo: usuario.id === yo
      };
    });
  }

  private ponerEnLista(diagrama: DiagramaResumen): void {
    const resto = this.diagramas.filter((d) => d.diagrama_id !== diagrama.diagrama_id);
    this.diagramas = [{ ...diagrama }, ...resto];
  }

  private cancelarTimers(): void {
    if (this.timerGuardado) clearTimeout(this.timerGuardado);
    if (this.timerInit) clearTimeout(this.timerInit);
    this.timerGuardado = null;
    this.timerInit = null;
  }

  private mensajeError(err: any, fallback: string): string {
    const status = Number(err?.status || 0);
    if (status === 404) {
      return 'El servidor todavía no tiene el apartado de diagramas. Reinicia el backend y vuelve a entrar.';
    }
    return err?.error?.message || fallback;
  }
}
