import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { HttpResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { CorreoSugerido, CorreoSugerenciasService } from 'src/app/services/correo-sugerencias.service';
import {
  partesFechaMexico,
  traducirFechaCorreoMexico,
  traducirFechaDetalleCorreoMexico,
  traducirFechaDetalleLargoMexico,
  traducirFechaListaCorreoMexico
} from 'src/app/utils/fecha.util';
interface CorreoAdjunto {
  indice: number;
  nombre: string;
  contentType?: string;
  size?: number | null;
  contentId?: string | null;
}

interface CorreoCarpeta {
  id: string;
  etiqueta: string;
  icono: string;
  path?: string | null;
  total: number;
  noLeidos: number;
  disponible: boolean;
}

interface CorreoDetalle {
  de: string;
  deNombre: string;
  deCorreo: string;
  responderA: string;
  para: string;
  cc?: string;
  cco?: string;
  fecha: string;
  /** Instantáneo ISO (UTC) para traducir siempre a hora México. */
  fechaIso?: string | null;
  asunto: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  esContestacion?: boolean;
  enviadoPor: string;
  firmadoPor: string;
  seguridad: string;
}

interface ComposeCampoCorreoEstado {
  seleccionados: string[];
  input: string;
  dropdownVisible: boolean;
  dropdownStyle: Record<string, string>;
  filtrados: CorreoSugerido[];
}

type ComposeCampoDestinatario = 'para' | 'cc' | 'cco';

interface CorreoMensaje {
  id: string;
  uid?: number | string | null;
  carpeta?: string;
  remitente: string;
  destinatario: string;
  asunto: string;
  fecha: string;
  fechaDetalle?: string;
  fechaLista?: string;
  fechaOriginal?: string;
  resumen: string;
  leido: boolean;
  favorito?: boolean;
  tieneAdjunto?: boolean;
}

interface CorreoBusqueda {
  id: number;
  termino: string;
  created_at?: string;
}

interface ComposeAdjuntoPendiente {
  id: string;
  file: File;
  nombre: string;
  size: number;
  esImagen?: boolean;
}

interface ComposeBorrador {
  id: string;
  modo: 'float' | 'inline';
  tipoAccion: 'nuevo' | 'responder' | 'reenviar';
  campoPara: ComposeCampoCorreoEstado;
  campoCc: ComposeCampoCorreoEstado;
  campoCco: ComposeCampoCorreoEstado;
  asunto: string;
  mensajeHtml: string;
  /** Cita del mensaje original (colapsada en UI estilo Gmail; se anexa al enviar). */
  citaHtml: string;
  citaExpandida: boolean;
  /** Encabezados de hilo RFC 5322 para que se reconozca como contestación. */
  inReplyTo?: string;
  references?: string;
  adjuntos: ComposeAdjuntoPendiente[];
  minimizado: boolean;
  expandido: boolean;
  formatoAbierto: boolean;
  mostrarCc: boolean;
  mostrarCco: boolean;
  enviando: boolean;
  error: string;
  firmaExpandida: boolean;
  animandoEntrada: boolean;
  soltandoAdjuntos: boolean;
}

type VistaCorreo = 'lista' | 'lectura';

@Component({
  selector: 'app-correo',
  templateUrl: './correo.component.html',
  styleUrls: ['./correo.component.scss']
})
export class CorreoComponent implements OnInit, OnDestroy {
  /** Modo buzón compartido de empresa (contacto@biznaga.com.mx). Subclases lo activan. */
  modoEmpresa = false;
  readonly cuentaEmpresaFija = 'contacto@biznaga.com.mx';

  filtroCorreo = '';
  busquedaAplicada = '';
  busquedasRecientes: CorreoBusqueda[] = [];
  historialBusquedasAbierto = false;
  paginaActual = 1;
  readonly mensajesPorPagina = 50;
  totalResultados = 0;
  totalPaginas = 1;
  mensajeSeleccionado: CorreoMensaje | null = null;
  ultimaActualizacion = this.formatearFecha(new Date());
  cuentaActiva = '';
  cargando = false;
  cargandoCarpetas = false;
  cargandoContenido = false;
  errorCorreo = '';
  errorCarpetas = '';
  mensajeExito = '';
  vistaActiva: VistaCorreo = 'lista';
  carpetaActiva = 'inbox';
  private cargaCorreosToken = 0;
  private iframeBlobUrl: string | null = null;
  private iframeBlobFallbackIntentado = false;
  private readonly diagnosticoRenderCorreo = this.obtenerDiagnosticoRenderCorreoActivo();

  // Buzones del sistema que deben mostrarse con un nombre de remitente amigable
  // para que los destinatarios reconozcan que el correo proviene de la empresa.
  private readonly nombresRemitentePorCorreo: Record<string, string> = {
    'sistema@biznaga.com.mx': 'Biznaga Risk&Tech',
    'contacto@biznaga.com.mx': 'Biznaga Risk&Tech'
  };

  carpetas: CorreoCarpeta[] = [];
  mensajes: CorreoMensaje[] = [];
  adjuntos: CorreoAdjunto[] = [];
  cargandoAdjuntos = false;
  errorAdjuntos = '';
  descargandoAdjuntoId: string | null = null;
  eliminandoCorreo = false;
  accionCorreoEnProceso = false;
  menuAccionesAbierto = false;

  cuerpoHtmlContenido = '';
  cuerpoTextoPlano = '';
  mostrarCuerpoIframe = false;
  /** HTML de la conversación citada (contestaciones), colapsada por defecto. */
  conversacionHtml = '';
  conversacionExpandida = false;
  esContestacionVista = false;
  detalleCorreo: CorreoDetalle | null = null;
  detalleCorreoAbierto = false;

  composiciones: ComposeBorrador[] = [];
  private readonly maxComposiciones = 2;
  private composeAdjuntosTargetId: string | null = null;
  private composeDragDepth = new Map<string, number>();
  composeFirmaHtml: SafeHtml | null = null;
  cargandoComposeFirma = false;

  @ViewChild('inputAdjuntoCompose') inputAdjuntoCompose?: ElementRef<HTMLInputElement>;
  @ViewChild('inputImagenCompose') inputImagenCompose?: ElementRef<HTMLInputElement>;
  @ViewChild('cuerpoIframe') cuerpoIframe?: ElementRef<HTMLIFrameElement>;

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private correoSugerenciasService: CorreoSugerenciasService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    if (this.modoEmpresa) {
      if (!this.authService.esAdministradorOSuperior()) {
        this.router.navigate(['/dashboard']);
        return;
      }
      this.cuentaActiva = this.cuentaEmpresaFija;
    } else {
      if (this.authService.esUsuarioEmpresa()) {
        this.router.navigate(['/curso-activos']);
        return;
      }
      this.cuentaActiva = this.authService.usuarioActualValue?.email || '';
    }

    this.cargarCarpetas(true);
    this.cargarBusquedasRecientes();
    this.correoSugerenciasService.cargar(250).subscribe();
    this.cargarFirmaDigitalCompose();
  }

  protected get correoApiBase(): 'correo' | 'correo-empresa' {
    return this.modoEmpresa ? 'correo-empresa' : 'correo';
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onVentanaCambioCompose(): void {
    this.composiciones.forEach((borrador) => {
      (['para', 'cc', 'cco'] as ComposeCampoDestinatario[]).forEach((campo) => {
        if (this.obtenerCampoCompose(borrador, campo).dropdownVisible) {
          this.actualizarPosicionDropdownCampo(borrador, campo);
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.liberarIframe();
  }

  get carpetasDisponibles(): CorreoCarpeta[] {
    return this.carpetas.length
      ? this.carpetas
      : [
          { id: 'inbox', etiqueta: 'Entrada', icono: 'inbox', total: 0, noLeidos: 0, disponible: true },
          { id: 'drafts', etiqueta: 'Borradores', icono: 'file-alt', total: 0, noLeidos: 0, disponible: true },
          { id: 'sent', etiqueta: 'Enviados', icono: 'paper-plane', total: 0, noLeidos: 0, disponible: true },
          { id: 'spam', etiqueta: 'SPAM', icono: 'exclamation-circle', total: 0, noLeidos: 0, disponible: true },
          { id: 'trash', etiqueta: 'Papelera', icono: 'trash', total: 0, noLeidos: 0, disponible: true },
          { id: 'archive', etiqueta: 'Archivo', icono: 'archive', total: 0, noLeidos: 0, disponible: true }
        ];
  }

  get carpetaActivaInfo(): CorreoCarpeta | undefined {
    return this.carpetasDisponibles.find(carpeta => carpeta.id === this.carpetaActiva);
  }

  get totalMensajesCarpetaActiva(): number {
    if (this.busquedaAplicada) {
      return this.totalResultados;
    }
    const totalCarpeta = this.carpetaActivaInfo?.total;
    if (typeof totalCarpeta === 'number' && totalCarpeta >= 0) {
      return totalCarpeta;
    }
    return this.mensajesFiltrados.length;
  }

  get etiquetaCarpetaActiva(): string {
    return this.carpetaActivaInfo?.etiqueta || 'Bandeja de entrada';
  }

  get remitenteNombreVisible(): string {
    const amistoso = this.nombreAmistosoRemitente(this.remitenteCorreoVisible);
    if (amistoso) {
      return amistoso;
    }
    return this.detalleCorreo?.deNombre || this.parsearRemitente(this.mensajeSeleccionado?.remitente).nombre || 'Sin remitente';
  }

  get remitenteCorreoVisible(): string {
    return this.detalleCorreo?.deCorreo || this.parsearRemitente(this.mensajeSeleccionado?.remitente).correo;
  }

  get remitenteCompletoVisible(): string {
    const correo = this.remitenteCorreoVisible;
    const amistoso = this.nombreAmistosoRemitente(correo);
    if (amistoso && correo) {
      return `${amistoso} <${correo}>`;
    }
    if (this.detalleCorreo?.de) {
      return this.detalleCorreo.de;
    }
    const parsed = this.parsearRemitente(this.mensajeSeleccionado?.remitente);
    if (parsed.nombre && parsed.correo) {
      return `${parsed.nombre} <${parsed.correo}>`;
    }
    return parsed.correo || parsed.nombre || this.mensajeSeleccionado?.remitente || 'Sin remitente';
  }

  remitenteListaVisible(mensaje: CorreoMensaje | null | undefined): string {
    const parsed = this.parsearRemitente(mensaje?.remitente);
    return parsed.nombre || parsed.correo || mensaje?.remitente || 'Sin remitente';
  }

  private nombreAmistosoRemitente(correo: string | null | undefined): string {
    const clave = String(correo || '').trim().toLowerCase();
    return this.nombresRemitentePorCorreo[clave] || '';
  }

  get fechaEncabezadoVisible(): string {
    const instante = this.detalleCorreo?.fechaIso
      || this.mensajeSeleccionado?.fechaOriginal
      || this.detalleCorreo?.fecha
      || this.mensajeSeleccionado?.fechaDetalle
      || this.mensajeSeleccionado?.fecha
      || '';
    return instante ? traducirFechaDetalleCorreoMexico(instante) : '';
  }

  get etiquetaDestinatarioVisible(): string {
    return 'para mi';
  }

  @HostListener('document:click')
  cerrarPanelesExternos(): void {
    this.detalleCorreoAbierto = false;
    this.menuAccionesAbierto = false;
    this.historialBusquedasAbierto = false;
  }

  toggleDetalleCorreo(event: Event): void {
    event.stopPropagation();
    this.menuAccionesAbierto = false;
    this.detalleCorreoAbierto = !this.detalleCorreoAbierto;
  }

  toggleMenuAcciones(event: Event): void {
    event.stopPropagation();
    this.detalleCorreoAbierto = false;
    this.menuAccionesAbierto = !this.menuAccionesAbierto;
  }

  get mensajesNoLeidos(): number {
    if (this.carpetaActiva === 'inbox') {
      return this.carpetaActivaInfo?.noLeidos || this.mensajes.filter(mensaje => !mensaje.leido).length;
    }
    return 0;
  }

  iconoCarpeta(icono: string): string {
    const mapa: Record<string, string> = {
      inbox: 'inbox',
      'file-alt': 'file-alt',
      'paper-plane': 'paper-plane',
      'exclamation-circle': 'exclamation-circle',
      trash: 'trash',
      archive: 'archive'
    };
    return mapa[icono] || 'folder';
  }

  refrescar(): void {
    this.limpiarAlertas();
    this.cargarCorreos(true, true);
  }

  abrirHistorialBusquedas(event: Event): void {
    event.stopPropagation();
    this.historialBusquedasAbierto = this.busquedasRecientes.length > 0;
  }

  buscarCorreos(): void {
    const termino = this.filtroCorreo.trim().replace(/\s+/g, ' ');
    this.filtroCorreo = termino;
    this.busquedaAplicada = termino;
    this.paginaActual = 1;
    this.historialBusquedasAbierto = false;
    this.cargarCorreos();

    if (termino) {
      this.backendService.guardarBusquedaCorreo(termino, this.correoApiBase).subscribe({
        next: (response) => {
          this.busquedasRecientes = Array.isArray(response?.busquedas) ? response.busquedas : [];
        }
      });
    }
  }

  limpiarBusqueda(): void {
    if (!this.filtroCorreo && !this.busquedaAplicada) {
      return;
    }
    this.filtroCorreo = '';
    this.busquedaAplicada = '';
    this.paginaActual = 1;
    this.historialBusquedasAbierto = false;
    this.cargarCorreos();
  }

  usarBusquedaReciente(busqueda: CorreoBusqueda, event: Event): void {
    event.stopPropagation();
    this.filtroCorreo = busqueda.termino;
    this.buscarCorreos();
  }

  eliminarBusquedaReciente(busqueda: CorreoBusqueda, event: Event): void {
    event.stopPropagation();
    this.backendService.eliminarBusquedaCorreo(busqueda.id, this.correoApiBase).subscribe({
      next: () => {
        this.busquedasRecientes = this.busquedasRecientes.filter(item => item.id !== busqueda.id);
        this.historialBusquedasAbierto = this.busquedasRecientes.length > 0;
      }
    });
  }

  borrarHistorialBusquedas(event: Event): void {
    event.stopPropagation();
    this.backendService.borrarBusquedasCorreo(this.correoApiBase).subscribe({
      next: () => {
        this.busquedasRecientes = [];
        this.historialBusquedasAbierto = false;
      }
    });
  }

  cambiarPagina(pagina: number): void {
    const destino = Math.min(Math.max(1, pagina), this.totalPaginas);
    if (destino === this.paginaActual || this.cargando) {
      return;
    }
    this.paginaActual = destino;
    this.cargarCorreos();
  }

  get rangoPaginaInicio(): number {
    return this.totalResultados > 0 ? ((this.paginaActual - 1) * this.mensajesPorPagina) + 1 : 0;
  }

  get rangoPaginaFin(): number {
    return Math.min(this.paginaActual * this.mensajesPorPagina, this.totalResultados);
  }

  private mensajeErrorHttp(error: any, fallback: string): string {
    const backend = error?.error;
    if (typeof backend === 'string' && backend.trim()) {
      return backend.trim();
    }
    if (backend?.message) {
      return String(backend.message);
    }
    if (backend?.error) {
      return String(backend.error);
    }
    if (error?.status) {
      return `${fallback} (HTTP ${error.status})`;
    }
    if (error?.message) {
      return String(error.message);
    }
    return fallback;
  }

  private carpetaDeMensaje(mensaje: CorreoMensaje | null | undefined): string {
    return String(mensaje?.carpeta || this.carpetaActiva || 'inbox').trim().toLowerCase();
  }

  esCampoDestinatarioUnico(campo: ComposeCampoDestinatario): boolean {
    // Estilo Gmail: Para / Cc / Cco permiten varios destinatarios.
    return false;
  }

  onComposeCampoInput(borrador: ComposeBorrador, campo: ComposeCampoDestinatario, valor: string): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    estado.input = valor;

    if (this.esCampoDestinatarioUnico(campo) && estado.seleccionados.length > 0) {
      return;
    }

    if (!this.esCampoDestinatarioUnico(campo) && /[;\n,]/.test(valor)) {
      this.agregarCampoDesdeTexto(borrador, campo, valor, true);
      return;
    }

    const texto = estado.input.trim();
    estado.dropdownVisible = texto.length > 0;
    this.filtrarCorreosCampo(borrador, campo);
    if (estado.dropdownVisible) {
      setTimeout(() => this.actualizarPosicionDropdownCampo(borrador, campo));
    }
  }

  onComposeCampoKeydown(borrador: ComposeBorrador, campo: ComposeCampoDestinatario, event: KeyboardEvent): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    if (event.key === 'Enter' || (!this.esCampoDestinatarioUnico(campo) && event.key === ',')) {
      event.preventDefault();
      this.agregarCampoDesdeTexto(borrador, campo, estado.input, false);
      return;
    }

    if (event.key === 'Backspace' && !estado.input && estado.seleccionados.length > 0) {
      const ultimo = estado.seleccionados[estado.seleccionados.length - 1];
      this.eliminarCampoCorreo(borrador, campo, ultimo);
    }
  }

  onComposeCampoBlur(borrador: ComposeBorrador, campo: ComposeCampoDestinatario): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    if (estado.input) {
      this.agregarCampoDesdeTexto(borrador, campo, estado.input, false);
    }
    setTimeout(() => {
      estado.dropdownVisible = false;
    }, 200);
  }

  seleccionarCampoSugerido(borrador: ComposeBorrador, campo: ComposeCampoDestinatario, sugerencia: CorreoSugerido): void {
    if (!sugerencia?.email) {
      return;
    }
    this.agregarCorreoCampo(borrador, campo, sugerencia.email);
    const estado = this.obtenerCampoCompose(borrador, campo);
    estado.input = '';
    estado.dropdownVisible = false;
    this.filtrarCorreosCampo(borrador, campo);
  }

  eliminarCampoCorreo(borrador: ComposeBorrador, campo: ComposeCampoDestinatario, correo: string): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    const normalizado = this.normalizarCorreoCompose(correo);
    estado.seleccionados = estado.seleccionados.filter(
      (item) => this.normalizarCorreoCompose(item) !== normalizado
    );
    this.filtrarCorreosCampo(borrador, campo);
  }

  private crearCampoCorreoCompose(): ComposeCampoCorreoEstado {
    return {
      seleccionados: [],
      input: '',
      dropdownVisible: false,
      dropdownStyle: {},
      filtrados: []
    };
  }

  private crearBorradorCompose(
    marcarEntrada = false,
    opciones: { modo?: 'float' | 'inline'; tipoAccion?: 'nuevo' | 'responder' | 'reenviar' } = {}
  ): ComposeBorrador {
    return {
      id: `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      modo: opciones.modo || 'float',
      tipoAccion: opciones.tipoAccion || 'nuevo',
      campoPara: this.crearCampoCorreoCompose(),
      campoCc: this.crearCampoCorreoCompose(),
      campoCco: this.crearCampoCorreoCompose(),
      asunto: '',
      mensajeHtml: '',
      citaHtml: '',
      citaExpandida: false,
      adjuntos: [],
      minimizado: false,
      expandido: false,
      formatoAbierto: false,
      mostrarCc: false,
      mostrarCco: false,
      enviando: false,
      error: '',
      firmaExpandida: false,
      animandoEntrada: marcarEntrada,
      soltandoAdjuntos: false
    };
  }

  expandirCitaCompose(borrador: ComposeBorrador): void {
    if (!borrador.citaHtml) {
      return;
    }
    borrador.citaExpandida = true;
    this.cdr.markForCheck();
  }

  colapsarCitaCompose(borrador: ComposeBorrador): void {
    borrador.citaExpandida = false;
    this.cdr.markForCheck();
  }

  citaHtmlSeguro(borrador: ComposeBorrador): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(String(borrador.citaHtml || ''));
  }

  get conversacionHtmlSeguro(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(String(this.conversacionHtml || ''));
  }

  get esVistaContestacion(): boolean {
    if (this.esContestacionVista || this.detalleCorreo?.esContestacion) {
      return true;
    }
    const asunto = String(this.mensajeSeleccionado?.asunto || this.detalleCorreo?.asunto || '');
    return /^(re|rv|res)\s*:/i.test(asunto.trim());
  }

  expandirConversacionLectura(): void {
    if (!this.conversacionHtml) {
      return;
    }
    this.conversacionExpandida = true;
    this.cdr.markForCheck();
    setTimeout(() => this.ajustarAlturaIframeElemento(this.cuerpoIframe?.nativeElement), 50);
  }

  colapsarConversacionLectura(): void {
    this.conversacionExpandida = false;
    this.cdr.markForCheck();
    setTimeout(() => this.ajustarAlturaIframeElemento(this.cuerpoIframe?.nativeElement), 50);
  }

  get borradorInline(): ComposeBorrador | null {
    return this.composiciones.find((item) => item.modo === 'inline') || null;
  }

  get composicionesFloat(): ComposeBorrador[] {
    return this.composiciones.filter((item) => item.modo !== 'inline');
  }

  get iconoComposeInline(): string {
    const tipo = this.borradorInline?.tipoAccion;
    if (tipo === 'reenviar') {
      return 'fa-share';
    }
    if (tipo === 'responder') {
      return 'fa-reply';
    }
    return 'fa-pen';
  }

  private cerrarComposeInline(): void {
    const inline = this.borradorInline;
    if (!inline) {
      return;
    }
    this.composiciones = this.composiciones.filter((item) => item.id !== inline.id);
  }

  convertirInlineAFloat(borrador: ComposeBorrador): void {
    if (borrador.modo !== 'inline') {
      return;
    }
    this.sincronizarEditorCompose(borrador);
    borrador.modo = 'float';
    borrador.minimizado = false;
    borrador.expandido = false;
    this.cdr.detectChanges();
    setTimeout(() => this.enfocarCompose(borrador), 0);
  }

  private obtenerCampoCompose(borrador: ComposeBorrador, campo: ComposeCampoDestinatario): ComposeCampoCorreoEstado {
    if (campo === 'cc') {
      return borrador.campoCc;
    }
    if (campo === 'cco') {
      return borrador.campoCco;
    }
    return borrador.campoPara;
  }

  private filtrarCorreosCampo(borrador: ComposeBorrador, campo: ComposeCampoDestinatario): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    estado.filtrados = this.correoSugerenciasService.filtrar(estado.input, estado.seleccionados);
  }

  private agregarCampoDesdeTexto(
    borrador: ComposeBorrador,
    campo: ComposeCampoDestinatario,
    texto: string,
    mantenerUltimo: boolean
  ): void {
    const estado = this.obtenerCampoCompose(borrador, campo);

    if (this.esCampoDestinatarioUnico(campo)) {
      const candidato = String(texto || '').trim();
      if (!candidato) {
        this.filtrarCorreosCampo(borrador, campo);
        return;
      }
      if (this.correoSugerenciasService.validarEmail(candidato)) {
        this.agregarCorreoCampo(borrador, campo, candidato);
        estado.input = '';
        estado.dropdownVisible = false;
      } else if (!mantenerUltimo) {
        this.filtrarCorreosCampo(borrador, campo);
      }
      return;
    }

    const partes = String(texto || '').split(/[;\n,]/).map((item) => item.trim()).filter(Boolean);
    if (partes.length === 0) {
      this.filtrarCorreosCampo(borrador, campo);
      return;
    }

    let candidatos = partes;
    let ultimo = '';

    if (mantenerUltimo && partes.length > 1) {
      ultimo = partes[partes.length - 1];
      candidatos = partes.slice(0, -1);
    } else if (mantenerUltimo && partes.length === 1 && !this.correoSugerenciasService.validarEmail(partes[0])) {
      this.filtrarCorreosCampo(borrador, campo);
      return;
    }

    candidatos.forEach((correo) => this.agregarCorreoCampo(borrador, campo, correo));
    estado.input = mantenerUltimo ? ultimo : '';
    estado.dropdownVisible = estado.input.trim().length > 0;
    this.filtrarCorreosCampo(borrador, campo);
    if (estado.dropdownVisible) {
      setTimeout(() => this.actualizarPosicionDropdownCampo(borrador, campo));
    }
  }

  private agregarCorreoCampo(borrador: ComposeBorrador, campo: ComposeCampoDestinatario, correo: string): void {
    const estado = this.obtenerCampoCompose(borrador, campo);
    const normalizado = this.normalizarCorreoCompose(correo);
    if (!normalizado || !this.correoSugerenciasService.validarEmail(normalizado)) {
      return;
    }

    if (this.esCampoDestinatarioUnico(campo)) {
      estado.seleccionados = [normalizado];
      estado.input = '';
      estado.dropdownVisible = false;
      this.correoSugerenciasService.guardarPersonalSiNuevo(normalizado);
      return;
    }

    const yaExiste = estado.seleccionados.some(
      (item) => this.normalizarCorreoCompose(item) === normalizado
    );
    if (yaExiste) {
      return;
    }

    estado.seleccionados = [...estado.seleccionados, normalizado];
    this.correoSugerenciasService.guardarPersonalSiNuevo(normalizado);
  }

  private normalizarCorreoCompose(correo: string): string {
    return String(correo || '').trim().toLowerCase();
  }

  private obtenerCorreosCampo(borrador: ComposeBorrador, campo: ComposeCampoDestinatario): string[] {
    const estado = this.obtenerCampoCompose(borrador, campo);
    if (estado.input.trim()) {
      this.agregarCampoDesdeTexto(borrador, campo, estado.input, false);
    }
    return [...estado.seleccionados];
  }

  getCorreoAvatarUrl(sugerencia: CorreoSugerido): string | null {
    return this.correoSugerenciasService.getCorreoAvatarUrl(sugerencia);
  }

  getCorreoIniciales(sugerencia: CorreoSugerido): string {
    return this.correoSugerenciasService.getCorreoIniciales(sugerencia);
  }

  onCorreoAvatarError(sugerencia: CorreoSugerido): void {
    this.correoSugerenciasService.onCorreoAvatarError(sugerencia);
  }

  private actualizarPosicionDropdownCampo(borrador: ComposeBorrador, campo: ComposeCampoDestinatario): void {
    const input = document.querySelector(
      `[data-compose-id="${borrador.id}"] [data-compose-campo="${campo}"]`
    ) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    this.obtenerCampoCompose(borrador, campo).dropdownStyle =
      this.correoSugerenciasService.estiloDropdownFijo(input, 220, 10000);
  }

  estiloComposeFloat(borrador: ComposeBorrador, index: number): Record<string, string> {
    if (borrador.modo === 'inline') {
      return {};
    }
    const floats = this.composicionesFloat;
    const floatIndex = floats.findIndex((item) => item.id === borrador.id);
    const gap = 12;
    const base = 28;
    let offset = base;
    for (let i = floats.length - 1; i > floatIndex; i -= 1) {
      const otro = floats[i];
      const ancho = Math.min(otro.expandido ? 720 : 560, typeof window !== 'undefined' ? window.innerWidth - 32 : 560);
      offset += ancho + gap;
    }
    return { right: `${offset}px` };
  }

  trackComposeById(_index: number, borrador: ComposeBorrador): string {
    return borrador.id;
  }

  abrirRedactar(): void {
    this.limpiarAlertas();
    this.cargarFirmaDigitalCompose();

    if (this.composiciones.length >= this.maxComposiciones) {
      const vacio = this.composiciones.find((item) => !this.composeTieneContenido(item));
      if (vacio) {
        vacio.minimizado = false;
        vacio.expandido = false;
        vacio.error = '';
        this.enfocarCompose(vacio);
        return;
      }
      const actual = this.composiciones[this.composiciones.length - 1];
      actual.minimizado = false;
      actual.animandoEntrada = true;
      setTimeout(() => {
        actual.animandoEntrada = false;
        this.cdr.markForCheck();
      }, 450);
      this.enfocarCompose(actual);
      return;
    }

    const esSegundo = this.composiciones.length > 0;
    if (esSegundo) {
      this.composiciones.forEach((item) => this.sincronizarEditorCompose(item));
    }

    const borrador = this.crearBorradorCompose(esSegundo);
    this.composiciones = [...this.composiciones, borrador];
    this.cdr.detectChanges();

    if (esSegundo) {
      setTimeout(() => {
        borrador.animandoEntrada = false;
        this.cdr.markForCheck();
      }, 450);
    }

    setTimeout(() => {
      this.composiciones.forEach((item) => {
        if (item.id !== borrador.id) {
          this.restaurarEditorCompose(item);
        }
      });
      this.enfocarCompose(borrador);
    });
  }

  cerrarCompose(borrador: ComposeBorrador): void {
    this.composiciones = this.composiciones.filter((item) => item.id !== borrador.id);
    this.composeDragDepth.delete(borrador.id);
    if (this.composeAdjuntosTargetId === borrador.id) {
      this.composeAdjuntosTargetId = null;
    }
  }

  descartarCompose(borrador: ComposeBorrador): void {
    if (this.composeTieneContenido(borrador)) {
      const confirmar = window.confirm('¿Descartar este borrador?');
      if (!confirmar) {
        return;
      }
    }
    this.cerrarCompose(borrador);
  }

  minimizarCompose(borrador: ComposeBorrador): void {
    if (!borrador.minimizado) {
      this.sincronizarEditorCompose(borrador);
    }
    borrador.minimizado = !borrador.minimizado;
    if (borrador.minimizado) {
      borrador.expandido = false;
      borrador.formatoAbierto = false;
      borrador.soltandoAdjuntos = false;
      this.composeDragDepth.set(borrador.id, 0);
    } else {
      setTimeout(() => this.restaurarEditorCompose(borrador));
    }
  }

  expandirCompose(borrador: ComposeBorrador): void {
    borrador.expandido = !borrador.expandido;
    if (borrador.expandido) {
      borrador.minimizado = false;
      setTimeout(() => this.restaurarEditorCompose(borrador));
    }
  }

  toggleFormatoCompose(borrador: ComposeBorrador): void {
    borrador.formatoAbierto = !borrador.formatoAbierto;
  }

  mostrarCampoCc(borrador: ComposeBorrador): void {
    borrador.mostrarCc = true;
  }

  mostrarCampoCco(borrador: ComposeBorrador): void {
    borrador.mostrarCco = true;
  }

  toggleFirmaCompose(borrador: ComposeBorrador, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    borrador.firmaExpandida = !borrador.firmaExpandida;
  }

  onFirmaMouseEnter(borrador: ComposeBorrador): void {
    if (this.dispositivoConHover()) {
      borrador.firmaExpandida = true;
    }
  }

  onFirmaMouseLeave(borrador: ComposeBorrador): void {
    if (this.dispositivoConHover()) {
      borrador.firmaExpandida = false;
    }
  }

  private dispositivoConHover(): boolean {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  adjuntarArchivosCompose(borrador: ComposeBorrador): void {
    this.composeAdjuntosTargetId = borrador.id;
    this.inputAdjuntoCompose?.nativeElement?.click();
  }

  onComposeDragEnter(event: DragEvent, borrador: ComposeBorrador): void {
    if (!this.puedeSoltarAdjuntosCompose(event, borrador)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const depth = (this.composeDragDepth.get(borrador.id) || 0) + 1;
    this.composeDragDepth.set(borrador.id, depth);
    borrador.soltandoAdjuntos = true;
  }

  onComposeDragOver(event: DragEvent, borrador: ComposeBorrador): void {
    if (!this.puedeSoltarAdjuntosCompose(event, borrador)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    borrador.soltandoAdjuntos = true;
  }

  onComposeDragLeave(event: DragEvent, borrador: ComposeBorrador): void {
    event.preventDefault();
    event.stopPropagation();
    const depth = Math.max(0, (this.composeDragDepth.get(borrador.id) || 0) - 1);
    this.composeDragDepth.set(borrador.id, depth);
    if (depth === 0) {
      borrador.soltandoAdjuntos = false;
    }
  }

  onComposeDrop(event: DragEvent, borrador: ComposeBorrador): void {
    event.preventDefault();
    event.stopPropagation();
    this.composeDragDepth.set(borrador.id, 0);
    borrador.soltandoAdjuntos = false;

    if (borrador.minimizado || borrador.enviando) {
      return;
    }

    const archivos = Array.from(event.dataTransfer?.files || []);
    if (!archivos.length) {
      return;
    }

    borrador.error = '';
    this.agregarArchivosCompose(borrador, archivos);
  }

  private puedeSoltarAdjuntosCompose(event: DragEvent, borrador: ComposeBorrador): boolean {
    if (borrador.minimizado || borrador.enviando) {
      return false;
    }
    const types = event.dataTransfer?.types;
    if (!types) {
      return false;
    }
    return Array.from(types as ArrayLike<string>).includes('Files');
  }

  insertarImagenCompose(borrador: ComposeBorrador): void {
    this.composeAdjuntosTargetId = borrador.id;
    this.inputImagenCompose?.nativeElement?.click();
  }

  insertarEnlaceCompose(borrador: ComposeBorrador): void {
    const url = window.prompt('URL del enlace:', 'https://');
    if (!url?.trim()) {
      return;
    }
    this.aplicarFormatoComando(borrador, 'createLink', url.trim());
  }

  aplicarFormatoComando(borrador: ComposeBorrador, comando: string, valor?: string): void {
    const editor = this.obtenerEditorCompose(borrador);
    if (!editor) {
      return;
    }
    editor.focus();
    document.execCommand(comando, false, valor || '');
  }

  onAdjuntosSeleccionados(event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    const borrador = this.obtenerBorradorAdjuntosTarget();
    if (!borrador) {
      return;
    }
    this.agregarArchivosCompose(borrador, archivos);
  }

  onImagenSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';

    const borrador = this.obtenerBorradorAdjuntosTarget();
    if (!borrador) {
      return;
    }

    const imagenes = archivos.filter(archivo => archivo.type.startsWith('image/'));
    if (!imagenes.length) {
      borrador.error = 'Selecciona un archivo de imagen valido.';
      return;
    }

    borrador.error = '';
    this.agregarArchivosCompose(borrador, imagenes, true);
  }

  private obtenerBorradorAdjuntosTarget(): ComposeBorrador | null {
    if (this.composeAdjuntosTargetId) {
      return this.composiciones.find((item) => item.id === this.composeAdjuntosTargetId) || null;
    }
    return this.composiciones[this.composiciones.length - 1] || null;
  }

  private agregarArchivosCompose(borrador: ComposeBorrador, archivos: File[], marcarComoImagen = false): void {
    archivos.forEach((file) => {
      borrador.adjuntos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        nombre: file.name,
        size: file.size,
        esImagen: marcarComoImagen || file.type.startsWith('image/')
      });
    });
  }

  quitarAdjuntoCompose(borrador: ComposeBorrador, id: string): void {
    borrador.adjuntos = borrador.adjuntos.filter(adjunto => adjunto.id !== id);
  }

  private enfocarCompose(borrador: ComposeBorrador, preferirPara = false): void {
    if (preferirPara || (borrador.modo === 'inline' && borrador.tipoAccion === 'reenviar')) {
      const root = document.querySelector(`[data-compose-id="${borrador.id}"]`);
      const para = root?.querySelector('input[data-compose-campo="para"]') as HTMLInputElement | null;
      if (para) {
        para.focus();
        return;
      }
    }
    const editor = this.obtenerEditorCompose(borrador);
    editor?.focus();
  }

  private scrollComposeInlineIntoView(): void {
    const el = document.querySelector('.correo-compose-inline') as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  abrirLista(): void {
    this.vistaActiva = 'lista';
    this.mensajeSeleccionado = null;
    this.detalleCorreo = null;
    this.detalleCorreoAbierto = false;
    this.menuAccionesAbierto = false;
    this.cerrarComposeInline();
    this.liberarIframe();
    this.limpiarAdjuntos();
  }

  cambiarCarpeta(carpetaId: string): void {
    const carpeta = this.carpetasDisponibles.find(item => item.id === carpetaId);
    if (!carpeta?.disponible) {
      return;
    }
    if (this.carpetaActiva === carpetaId && this.vistaActiva === 'lista') {
      return;
    }
    this.carpetaActiva = carpetaId;
    this.mensajes = [];
    this.filtroCorreo = '';
    this.busquedaAplicada = '';
    this.paginaActual = 1;
    this.abrirLista();
    this.cargarCorreos(false, true);
  }

  seleccionarMensaje(mensaje: CorreoMensaje): void {
    this.vistaActiva = 'lectura';
    this.mensajeSeleccionado = mensaje;
    this.limpiarAlertas();
    this.detalleCorreo = null;
    this.detalleCorreoAbierto = false;
    this.menuAccionesAbierto = false;
    this.cerrarComposeInline();
    if (!mensaje.leido) {
      mensaje.leido = true;
      this.actualizarConteoNoLeidosLocal(-1);
    }
    this.limpiarAdjuntos();
    this.cargarVistaMensaje(mensaje);
    this.cargarAdjuntos(mensaje);
  }

  get mensajesFiltrados(): CorreoMensaje[] {
    return this.mensajes;
  }

  enviarMensaje(borrador: ComposeBorrador): void {
    const destinatarios = this.obtenerCorreosCampo(borrador, 'para');
    const destinatario = destinatarios.join(', ');
    const correosCc = this.obtenerCorreosCampo(borrador, 'cc');
    const correosCco = this.obtenerCorreosCampo(borrador, 'cco');
    const asunto = borrador.asunto.trim();
    const mensajeUsuario = this.obtenerTextoEditorCompose(borrador);
    const html = this.obtenerHtmlEditorCompose(borrador);
    const mensaje = this.obtenerTextoEnvioCompose(borrador, mensajeUsuario);

    borrador.error = '';
    this.mensajeExito = '';

    if (destinatarios.length === 0) {
      borrador.error = 'Indica al menos un correo destinatario.';
      return;
    }

    const invalidosPara = destinatarios.filter((correo) => !this.correoSugerenciasService.validarEmail(correo));
    const invalidosCc = correosCc.filter((correo) => !this.correoSugerenciasService.validarEmail(correo));
    const invalidosCco = correosCco.filter((correo) => !this.correoSugerenciasService.validarEmail(correo));
    if (invalidosPara.length > 0) {
      borrador.error = `Correo destinatario no valido(s): ${invalidosPara.join(', ')}`;
      return;
    }
    if (invalidosCc.length > 0) {
      borrador.error = `Correo CC no valido(s): ${invalidosCc.join(', ')}`;
      return;
    }
    if (invalidosCco.length > 0) {
      borrador.error = `Correo CCO no valido(s): ${invalidosCco.join(', ')}`;
      return;
    }
    if (!asunto) {
      borrador.error = 'El asunto es obligatorio.';
      return;
    }
    if (!mensajeUsuario) {
      borrador.error = 'Escribe el contenido del mensaje.';
      return;
    }

    borrador.enviando = true;

    this.prepararAdjuntosParaEnvio(borrador)
      .then((adjuntos) => {
        this.backendService.enviarCorreoPerfil({
          destinatario,
          asunto,
          mensaje,
          html,
          cc: correosCc.length ? correosCc.join(', ') : undefined,
          cco: correosCco.length ? correosCco.join(', ') : undefined,
          inReplyTo: borrador.inReplyTo || undefined,
          references: borrador.references || undefined,
          adjuntos
        }, this.correoApiBase).subscribe({
          next: (response) => {
            borrador.enviando = false;
            this.cerrarCompose(borrador);
            const viaDescarga = Array.isArray(response?.adjuntosViaDescarga)
              ? response.adjuntosViaDescarga
              : (Array.isArray(response?.adjuntosViaDrive) ? response.adjuntosViaDrive : []);
            this.mensajeExito = response?.message || 'Correo enviado correctamente.';

            if (viaDescarga.length) {
              const fechaTexto = String(
                response?.adjuntosFechaExpiracionTexto
                || viaDescarga[0]?.fechaExpiracionTexto
                || ''
              ).trim();
              const avisoLocal = response?.adjuntosUrlLocal === true
                ? `<p style="margin:10px 0 0;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e3a8a;text-align:left;font-size:13px;">
                    Nota: este envío se hizo en entorno local. El destinatario externo no podrá descargar hasta desplegar en producción
                    (o configurar <code>PUBLIC_API_URL</code> con una URL pública).
                  </p>`
                : '';
              Swal.fire({
                icon: 'info',
                title: 'Correo enviado',
                html: `
                  <p style="margin:0 0 10px;">Tu mensaje se envió correctamente.</p>
                  <p style="margin:0;padding:10px 12px;background:#f3faf6;border:1px solid #d7e0da;border-radius:8px;color:#345246;text-align:left;">
                    <strong>Aviso:</strong> los documentos compartidos mediante este correo estarán disponibles para descarga
                    ${fechaTexto ? `hasta el <strong>${fechaTexto}</strong>` : 'durante el periodo de vigencia'}.
                    Una vez transcurrida esa fecha, los enlaces dejarán de estar disponibles.
                  </p>
                  ${avisoLocal}
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#1f6b4a'
              });
            } else {
              Swal.fire({
                icon: 'success',
                title: 'Correo enviado',
                text: 'Tu mensaje se envió correctamente.',
                timer: 2800,
                showConfirmButton: false
              });
            }

            this.carpetaActiva = 'sent';
            this.cargarCarpetas(false);
            this.cargarCorreos();
          },
          error: (error) => {
            borrador.enviando = false;
            const mensajeErr = error?.error?.message || 'No se pudo enviar el correo.';
            borrador.error = mensajeErr;
            Swal.fire({
              icon: 'error',
              title: 'Error al enviar',
              text: mensajeErr,
              confirmButtonText: 'Entendido'
            });
          }
        });
      })
      .catch(() => {
        borrador.enviando = false;
        borrador.error = 'No se pudieron procesar los archivos adjuntos.';
      });
  }

  ajustarAlturaIframe(event: Event): void {
    const iframe = event.target as HTMLIFrameElement | null;
    if (iframe) {
      this.registrarDiagnosticoRender('iframe_load', {
        usaSrcdoc: iframe.hasAttribute('srcdoc'),
        usaBlob: String(iframe.src || '').startsWith('blob:')
      });
      this.ajustarAlturaIframeElemento(iframe);
    }
  }

  private ajustarAlturaIframeElemento(iframe: HTMLIFrameElement): void {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        iframe.style.height = '160px';
        iframe.style.minHeight = '80px';
        return;
      }

      const altura = Math.max(
        doc.body?.scrollHeight || 0,
        doc.body?.offsetHeight || 0,
        doc.documentElement?.scrollHeight || 0,
        doc.documentElement?.offsetHeight || 0,
        80
      );
      iframe.style.height = `${altura + 16}px`;
      iframe.style.minHeight = '80px';
    } catch (_error) {
      iframe.style.height = '160px';
      iframe.style.minHeight = '80px';
    }
  }

  formatearBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
      return '';
    }

    const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
    let valor = Math.max(0, bytes);
    let indice = 0;

    while (valor >= 1024 && indice < unidades.length - 1) {
      valor /= 1024;
      indice += 1;
    }

    const decimales = valor >= 10 || indice === 0 ? 0 : 1;
    return `${valor.toFixed(decimales)} ${unidades[indice]}`;
  }

  obtenerTipoArchivo(nombre: string | null | undefined): string {
    const limpio = String(nombre || '').trim().toLowerCase();
    const extension = limpio.includes('.') ? limpio.split('.').pop() || '' : '';
    const mapa: Record<string, string> = {
      pdf: 'PDF',
      xls: 'Excel',
      xlsx: 'Excel',
      csv: 'CSV',
      doc: 'Word',
      docx: 'Word',
      ppt: 'PowerPoint',
      pptx: 'PowerPoint',
      png: 'Imagen',
      jpg: 'Imagen',
      jpeg: 'Imagen',
      gif: 'Imagen',
      webp: 'Imagen',
      txt: 'Texto',
      zip: 'ZIP',
      rar: 'RAR',
      '7z': '7z'
    };

    return mapa[extension] || 'Documento';
  }

  descargarAdjunto(adjunto: CorreoAdjunto): void {
    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      this.errorAdjuntos = 'No se pudo identificar el correo para descargar adjuntos.';
      return;
    }

    const descargaId = `${mensaje.uid}-${adjunto.indice}`;
    this.descargandoAdjuntoId = descargaId;
    this.errorAdjuntos = '';

    this.backendService.descargarAdjuntoCorreo(mensaje.uid, adjunto.indice, this.carpetaDeMensaje(mensaje), this.correoApiBase).subscribe({
      next: (response: HttpResponse<Blob>) => {
        if (this.descargandoAdjuntoId === descargaId) {
          this.descargandoAdjuntoId = null;
        }
        const blob = response.body;
        if (!blob) {
          this.errorAdjuntos = 'No se pudo descargar el adjunto.';
          return;
        }

        const nombreArchivo = this.obtenerNombreArchivoDescarga(response, adjunto);
        this.descargarBlob(blob, nombreArchivo);
      },
      error: (error) => {
        if (this.descargandoAdjuntoId === descargaId) {
          this.descargandoAdjuntoId = null;
        }
        this.errorAdjuntos = error?.error?.message || 'No se pudo descargar el adjunto.';
      }
    });
  }

  eliminarMensaje(confirmar = true): void {
    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      this.errorCorreo = 'No se pudo identificar el correo a eliminar.';
      return;
    }

    if (confirmar) {
      const aceptar = window.confirm(`¿Eliminar este correo de ${this.etiquetaCarpetaActiva}?`);
      if (!aceptar) {
        return;
      }
    }

    this.eliminandoCorreo = true;
    this.accionCorreoEnProceso = true;
    this.errorCorreo = '';
    this.mensajeExito = '';
    this.menuAccionesAbierto = false;

    this.backendService.eliminarCorreo(mensaje.uid, this.carpetaDeMensaje(mensaje), this.correoApiBase).subscribe({
      next: () => {
        this.eliminandoCorreo = false;
        this.accionCorreoEnProceso = false;
        this.mensajes = this.mensajes.filter(item => item.uid !== mensaje.uid);
        this.mensajeSeleccionado = null;
        this.limpiarAdjuntos();
        this.liberarIframe();
        this.mensajeExito = 'Correo eliminado correctamente.';
        this.cargarCarpetas(false);
        this.abrirLista();
      },
      error: (error) => {
        this.eliminandoCorreo = false;
        this.accionCorreoEnProceso = false;
        this.errorCorreo = error?.error?.message || 'No se pudo eliminar el correo.';
      }
    });
  }

  archivarMensaje(): void {
    this.ejecutarAccionMensaje('archivar', 'Correo archivado correctamente.');
  }

  marcarComoSpam(): void {
    this.ejecutarAccionMensaje('spam', 'Correo movido a SPAM.');
  }

  marcarComoNoLeido(): void {
    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      return;
    }

    this.menuAccionesAbierto = false;
    this.accionCorreoEnProceso = true;
    this.errorCorreo = '';
    this.mensajeExito = '';

    this.backendService.accionCorreo(mensaje.uid, this.carpetaDeMensaje(mensaje), 'no_leido', undefined, this.correoApiBase).subscribe({
      next: () => {
        this.accionCorreoEnProceso = false;
        mensaje.leido = false;
        if (this.mensajeSeleccionado) {
          this.mensajeSeleccionado.leido = false;
        }
        this.mensajeExito = 'Correo marcado como no leido.';
        this.actualizarConteoNoLeidosLocal(-1);
        this.cargarCarpetas(false);
      },
      error: (error) => {
        this.accionCorreoEnProceso = false;
        this.errorCorreo = error?.error?.message || 'No se pudo marcar el correo como no leido.';
      }
    });
  }

  toggleFavorito(event: Event): void {
    event.stopPropagation();

    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      return;
    }

    const nuevoEstado = !mensaje.favorito;
    this.accionCorreoEnProceso = true;
    this.errorCorreo = '';

    this.backendService.accionCorreo(mensaje.uid, this.carpetaDeMensaje(mensaje), 'favorito', nuevoEstado, this.correoApiBase).subscribe({
      next: () => {
        this.accionCorreoEnProceso = false;
        mensaje.favorito = nuevoEstado;
        if (this.mensajeSeleccionado) {
          this.mensajeSeleccionado.favorito = nuevoEstado;
        }
      },
      error: (error) => {
        this.accionCorreoEnProceso = false;
        this.errorCorreo = error?.error?.message || 'No se pudo actualizar el favorito.';
      }
    });
  }

  responderMensaje(): void {
    this.menuAccionesAbierto = false;
    const destinatario = this.detalleCorreo?.responderA || this.remitenteCorreoVisible;
    const asunto = this.mensajeSeleccionado?.asunto || '';
    const messageId = String(this.detalleCorreo?.messageId || '').trim();
    const referencesPrevias = String(this.detalleCorreo?.references || '').trim();
    const references = [referencesPrevias, messageId].filter(Boolean).join(' ').trim();
    // Estilo Gmail: editor vacío para el mensaje nuevo; la cita queda colapsada en "..."
    // y se anexa al enviar para conservar el hilo (original + contestaciones).
    this.abrirRedactarConContexto({
      destinatario,
      asunto: this.prefijarAsunto(asunto, 'Re:'),
      mensajeHtml: '',
      citaHtml: this.construirCitaRespuestaHtml(),
      inReplyTo: messageId || undefined,
      references: references || undefined,
      modo: 'inline',
      tipoAccion: 'responder'
    });
  }

  reenviarMensaje(): void {
    this.menuAccionesAbierto = false;
    const asunto = this.mensajeSeleccionado?.asunto || '';
    const borrador = this.abrirRedactarConContexto({
      destinatario: '',
      asunto: this.prefijarAsunto(asunto, 'Fwd:'),
      mensajeHtml: this.construirCitaReenvioHtml(),
      modo: 'inline',
      tipoAccion: 'reenviar'
    });

    if (borrador) {
      void this.cargarAdjuntosAlReenvio(borrador);
    }
  }

  imprimirMensaje(): void {
    this.menuAccionesAbierto = false;
    window.print();
  }

  private ejecutarAccionMensaje(accion: string, mensajeExito: string): void {
    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      this.errorCorreo = 'No se pudo identificar el correo.';
      return;
    }

    this.menuAccionesAbierto = false;
    this.accionCorreoEnProceso = true;
    this.errorCorreo = '';
    this.mensajeExito = '';

    this.backendService.accionCorreo(mensaje.uid, this.carpetaDeMensaje(mensaje), accion, undefined, this.correoApiBase).subscribe({
      next: () => {
        this.accionCorreoEnProceso = false;
        this.mensajes = this.mensajes.filter(item => item.uid !== mensaje.uid);
        this.mensajeSeleccionado = null;
        this.limpiarAdjuntos();
        this.liberarIframe();
        this.mensajeExito = mensajeExito;
        this.cargarCarpetas(false);
        this.abrirLista();
      },
      error: (error) => {
        this.accionCorreoEnProceso = false;
        this.errorCorreo = error?.error?.message || 'No se pudo completar la accion del correo.';
      }
    });
  }

  private abrirRedactarConContexto(opciones: {
    destinatario: string;
    asunto: string;
    mensajeHtml: string;
    citaHtml?: string;
    inReplyTo?: string;
    references?: string;
    modo?: 'float' | 'inline';
    tipoAccion?: 'nuevo' | 'responder' | 'reenviar';
  }): ComposeBorrador | null {
    this.limpiarAlertas();
    this.cargarFirmaDigitalCompose();

    const modo = opciones.modo || 'inline';
    const tipoAccion = opciones.tipoAccion || 'nuevo';
    const citaHtml = String(opciones.citaHtml || '');
    const inReplyTo = String(opciones.inReplyTo || '').trim();
    const references = String(opciones.references || '').trim();

    if (modo === 'inline') {
      this.cerrarComposeInline();
      const borrador = this.crearBorradorCompose(false, { modo: 'inline', tipoAccion });
      if (opciones.destinatario) {
        this.agregarCampoDesdeTexto(borrador, 'para', opciones.destinatario, false);
      }
      borrador.asunto = opciones.asunto;
      borrador.citaHtml = citaHtml;
      borrador.citaExpandida = false;
      borrador.inReplyTo = inReplyTo || undefined;
      borrador.references = references || undefined;
      this.composiciones = [...this.composiciones, borrador];
      this.cdr.detectChanges();

      setTimeout(() => {
        this.establecerContenidoEditorCompose(borrador, opciones.mensajeHtml);
        this.enfocarCompose(borrador, tipoAccion === 'reenviar');
        this.scrollComposeInlineIntoView();
      }, 0);

      return borrador;
    }

    let borrador: ComposeBorrador | null = null;
    const floats = this.composicionesFloat;
    const esSegundo = floats.length > 0 && this.composiciones.length < this.maxComposiciones;

    if (this.composiciones.length < this.maxComposiciones) {
      if (esSegundo) {
        this.composiciones.forEach((item) => this.sincronizarEditorCompose(item));
      }
      borrador = this.crearBorradorCompose(esSegundo, { modo: 'float', tipoAccion });
      this.composiciones = [...this.composiciones, borrador];
    } else {
      borrador = this.composiciones.find((item) => item.modo === 'float' && !this.composeTieneContenido(item))
        || floats[floats.length - 1]
        || this.composiciones[this.composiciones.length - 1]
        || null;
      if (!borrador) {
        return null;
      }
      borrador.modo = 'float';
      borrador.tipoAccion = tipoAccion;
      borrador.campoPara = this.crearCampoCorreoCompose();
      borrador.campoCc = this.crearCampoCorreoCompose();
      borrador.campoCco = this.crearCampoCorreoCompose();
      borrador.adjuntos = [];
      borrador.mensajeHtml = '';
      borrador.citaHtml = '';
      borrador.citaExpandida = false;
      borrador.inReplyTo = undefined;
      borrador.references = undefined;
      borrador.error = '';
      borrador.minimizado = false;
      borrador.expandido = false;
      borrador.formatoAbierto = false;
      borrador.mostrarCc = false;
      borrador.mostrarCco = false;
      borrador.firmaExpandida = false;
      const editor = this.obtenerEditorCompose(borrador);
      if (editor) {
        editor.innerHTML = '';
      }
    }

    if (opciones.destinatario) {
      this.agregarCampoDesdeTexto(borrador, 'para', opciones.destinatario, false);
    }
    borrador.asunto = opciones.asunto;
    borrador.citaHtml = citaHtml;
    borrador.citaExpandida = false;
    borrador.inReplyTo = inReplyTo || undefined;
    borrador.references = references || undefined;
    this.cdr.detectChanges();

    setTimeout(() => {
      if (!borrador) {
        return;
      }
      this.establecerContenidoEditorCompose(borrador, opciones.mensajeHtml);
      this.enfocarCompose(borrador);
    }, 0);

    return borrador;
  }

  private cargarFirmaDigitalCompose(): void {
    if (this.modoEmpresa) {
      this.composeFirmaHtml = null;
      this.cargandoComposeFirma = false;
      return;
    }

    if (this.composeFirmaHtml || this.cargandoComposeFirma) {
      return;
    }

    this.cargandoComposeFirma = true;
    this.backendService.obtenerFirmaDigitalCorreo(this.correoApiBase).subscribe({
      next: (response) => {
        this.cargandoComposeFirma = false;
        const html = String(response?.html || '').trim();
        this.composeFirmaHtml = html
          ? this.sanitizer.bypassSecurityTrustHtml(html)
          : null;
      },
      error: () => {
        this.cargandoComposeFirma = false;
        this.composeFirmaHtml = null;
      }
    });
  }

  private composeTieneContenido(borrador: ComposeBorrador): boolean {
    return Boolean(
      borrador.campoPara.seleccionados.length
      || borrador.campoPara.input.trim()
      || borrador.campoCc.seleccionados.length
      || borrador.campoCc.input.trim()
      || borrador.campoCco.seleccionados.length
      || borrador.campoCco.input.trim()
      || borrador.asunto.trim()
      || this.obtenerTextoEditorCompose(borrador)
      || borrador.adjuntos.length
    );
  }

  private obtenerEditorCompose(borrador: ComposeBorrador): HTMLDivElement | null {
    return document.querySelector(
      `.correo-compose-editor[data-compose-id="${borrador.id}"]`
    ) as HTMLDivElement | null;
  }

  private obtenerTextoEditorCompose(borrador: ComposeBorrador): string {
    const editor = this.obtenerEditorCompose(borrador);
    return String(editor?.innerText || borrador.mensajeHtml || '').trim();
  }

  private obtenerTextoEnvioCompose(borrador: ComposeBorrador, mensajeUsuario: string): string {
    const cita = String(borrador.citaHtml || '').trim();
    if (!cita) {
      return mensajeUsuario;
    }
    const citaTexto = this.extraerTextoPlanoDesdeHtml(cita);
    if (!citaTexto) {
      return mensajeUsuario;
    }
    return `${mensajeUsuario}\n\n${citaTexto}`;
  }

  private obtenerHtmlEditorCompose(borrador: ComposeBorrador): string {
    const editor = this.obtenerEditorCompose(borrador);
    let html = String(editor?.innerHTML || borrador.mensajeHtml || '').trim();
    if (!html || html === '<br>') {
      html = '';
    }

    const cita = String(borrador.citaHtml || '').trim();
    if (cita) {
      // Conserva el hilo: contestación nueva arriba + mensaje citado debajo (como Gmail).
      const bloqueCita = [
        '<div style="margin-top:18px;padding-top:12px;border-top:1px solid #dadce0;color:#3c4043;font-size:12.5px;line-height:1.45;">',
        cita,
        '</div>'
      ].join('');
      html = html ? `${html}${bloqueCita}` : bloqueCita;
    }

    if (!html) {
      return '';
    }
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#1A1A1A;">${html}</div>`;
  }

  private sincronizarEditorCompose(borrador: ComposeBorrador): void {
    const editor = this.obtenerEditorCompose(borrador);
    if (!editor) {
      return;
    }
    const html = editor.innerHTML.trim();
    borrador.mensajeHtml = html && html !== '<br>' ? html : '';
  }

  private restaurarEditorCompose(borrador: ComposeBorrador): void {
    const editor = this.obtenerEditorCompose(borrador);
    if (!editor || !borrador.mensajeHtml) {
      return;
    }
    if (!editor.innerText.trim() && !editor.querySelector('img, a, ul, ol')) {
      editor.innerHTML = borrador.mensajeHtml;
    }
  }

  private establecerContenidoEditorCompose(borrador: ComposeBorrador, contenido: string): void {
    // Evitar espacios/indentación heredados de plantillas.
    const html = String(contenido || '').replace(/^\s+|\s+$/g, '');
    borrador.mensajeHtml = html;
    const aplicar = (intento = 0) => {
      const editor = this.obtenerEditorCompose(borrador);
      if (!editor) {
        if (intento < 8) {
          setTimeout(() => aplicar(intento + 1), 40);
        }
        return;
      }
      editor.innerHTML = html || '<br>';
      // Limpia nodos de texto iniciales con solo espacios/saltos.
      while (editor.firstChild && editor.firstChild.nodeType === Node.TEXT_NODE) {
        const texto = String(editor.firstChild.textContent || '');
        if (!texto.trim()) {
          editor.removeChild(editor.firstChild);
          continue;
        }
        editor.firstChild.textContent = texto.replace(/^[\s\u00A0]+/, '');
        break;
      }
      borrador.mensajeHtml = editor.innerHTML;
      this.cdr.markForCheck();
    };
    aplicar();
  }

  private prepararAdjuntosParaEnvio(borrador: ComposeBorrador): Promise<Array<{ nombre: string; contentType: string; contenidoBase64: string }>> {
    if (!borrador.adjuntos.length) {
      return Promise.resolve([]);
    }

    const lecturas = borrador.adjuntos.map((adjunto) => new Promise<{ nombre: string; contentType: string; contenidoBase64: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultado = String(reader.result || '');
        const base64 = resultado.includes(',') ? resultado.split(',')[1] : resultado;
        resolve({
          nombre: adjunto.nombre,
          contentType: adjunto.file.type || 'application/octet-stream',
          contenidoBase64: base64
        });
      };
      reader.onerror = () => reject(new Error('No se pudo leer un adjunto'));
      reader.readAsDataURL(adjunto.file);
    }));

    return Promise.all(lecturas);
  }

  private prefijarAsunto(asunto: string, prefijo: string): string {
    const limpio = String(asunto || '').trim();
    if (!limpio) {
      return prefijo;
    }
    const regex = new RegExp(`^${prefijo.replace(':', '\\:')}\\s*`, 'i');
    if (regex.test(limpio)) {
      return limpio;
    }
    return `${prefijo} ${limpio}`;
  }

  private escaparHtmlCompose(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private obtenerCuerpoHtmlParaCita(): string {
    if (this.cuerpoHtmlContenido) {
      const doc = this.parsearHtmlSeguro(this.cuerpoHtmlContenido);
      if (doc?.body) {
        this.normalizarFirmasEnDocumento(doc);
        // Tomar el cuerpo tal cual del correo original, sin rediseñar.
        return String(doc.body.innerHTML || '').replace(/^\s+|\s+$/g, '');
      }
      return String(this.cuerpoHtmlContenido).replace(/^\s+|\s+$/g, '');
    }

    const texto = String(this.cuerpoTextoPlano || this.mensajeSeleccionado?.resumen || '').trim();
    if (!texto) {
      return '';
    }
    return this.escaparHtmlCompose(texto).replace(/\r?\n/g, '<br>');
  }

  /** Evita que firmas citadas en contestaciones se reenvíen a tamaño nativo enorme. */
  private normalizarFirmasEnDocumento(doc: Document): void {
    const estiloFirma = 'max-width:520px;width:100%;height:auto;display:block;border:0;';
    const imagenes = Array.from(doc.querySelectorAll('img'));
    for (const img of imagenes) {
      const alt = String(img.getAttribute('alt') || '');
      const src = String(img.getAttribute('src') || '');
      const marcada = img.getAttribute('data-firma-biznaga') === '1';
      const esFirma = marcada
        || /^firma digital$/i.test(alt.trim())
        || /cid:[^"']*firma/i.test(src)
        || /firma-biznaga/i.test(src);
      if (!esFirma) {
        continue;
      }
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.setAttribute('alt', 'Firma digital');
      img.setAttribute('data-firma-biznaga', '1');
      img.setAttribute('style', estiloFirma);
    }
  }

  private construirBloqueCitaHtml(titulo: string, filasMeta: Array<{ etiqueta: string; valor: string }>): string {
    const metaLineas = filasMeta
      .filter((fila) => String(fila.valor || '').trim())
      .map((fila) => {
        const etiqueta = this.escaparHtmlCompose(String(fila.etiqueta || '').trim());
        const valor = this.escaparHtmlCompose(String(fila.valor || '').replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, ''));
        return `${etiqueta}: ${valor}`;
      })
      .join('<br>');

    const cuerpo = this.obtenerCuerpoHtmlParaCita();
    const partes: string[] = [
      this.escaparHtmlCompose(titulo),
      metaLineas
    ];

    // Sin espacios/indentación de plantilla: el editor tiene white-space:pre-wrap
    // y cualquier tab/espacio inicial se vería como un "TAB" antes de "De:".
    let html = partes.filter(Boolean).join('<br>');
    if (cuerpo) {
      html += `<br><br>${cuerpo}`;
    }
    return html;
  }

  private construirCitaRespuestaHtml(): string {
    // Al responder, se cita el mensaje actual completo. Si ese mensaje ya traía
    // contestaciones anteriores, quedan anidadas y se ven en orden cronológico inverso
    // (lo nuevo arriba, el original más abajo), como en Gmail.
    return this.construirBloqueCitaHtml('---------- Mensaje original ----------', [
      { etiqueta: 'De', valor: this.remitenteCompletoVisible },
      { etiqueta: 'Fecha', valor: this.fechaEncabezadoVisible },
      { etiqueta: 'Asunto', valor: this.mensajeSeleccionado?.asunto || '' }
    ]);
  }

  private construirCitaReenvioHtml(): string {
    const destinatario = this.detalleCorreo?.para
      || this.mensajeSeleccionado?.destinatario
      || this.cuentaActiva
      || '';
    return this.construirBloqueCitaHtml('---------- Mensaje reenviado ----------', [
      { etiqueta: 'De', valor: this.remitenteCompletoVisible },
      { etiqueta: 'Fecha', valor: this.fechaEncabezadoVisible },
      { etiqueta: 'Para', valor: destinatario },
      { etiqueta: 'Asunto', valor: this.mensajeSeleccionado?.asunto || '' }
    ]);
  }

  private async asegurarListaAdjuntosParaReenvio(): Promise<CorreoAdjunto[]> {
    if (this.adjuntos.length > 0) {
      return this.adjuntos;
    }

    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.backendService.obtenerAdjuntosCorreo(
          mensaje.uid,
          this.carpetaDeMensaje(mensaje),
          this.correoApiBase
        )
      );
      const lista = Array.isArray(response?.adjuntos) ? response.adjuntos as CorreoAdjunto[] : [];
      this.adjuntos = lista;
      return lista;
    } catch {
      return [];
    }
  }

  private async cargarAdjuntosAlReenvio(borrador: ComposeBorrador): Promise<void> {
    const mensaje = this.mensajeSeleccionado;
    if (!mensaje?.uid) {
      return;
    }

    const lista = await this.asegurarListaAdjuntosParaReenvio();
    if (!lista.length) {
      return;
    }

    borrador.error = 'Preparando adjuntos del mensaje original...';
    this.cdr.markForCheck();

    const adjuntosNuevos: ComposeAdjuntoPendiente[] = [];
    let fallidos = 0;

    for (const adjunto of lista) {
      try {
        const response = await firstValueFrom(
          this.backendService.descargarAdjuntoCorreo(
            mensaje.uid,
            adjunto.indice,
            this.carpetaDeMensaje(mensaje),
            this.correoApiBase
          )
        );
        const blob = response.body;
        if (!blob) {
          fallidos += 1;
          continue;
        }

        const nombre = this.obtenerNombreArchivoDescarga(response, adjunto);
        const tipo = adjunto.contentType || blob.type || 'application/octet-stream';
        const file = new File([blob], nombre, { type: tipo });
        adjuntosNuevos.push({
          id: `fwd-${Date.now()}-${adjunto.indice}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          nombre,
          size: file.size,
          esImagen: /^image\//i.test(tipo)
        });
      } catch {
        fallidos += 1;
      }
    }

    // Evitar pisar adjuntos que el usuario haya agregado mientras cargábamos.
    borrador.adjuntos = [...borrador.adjuntos, ...adjuntosNuevos];

    if (fallidos > 0 && adjuntosNuevos.length === 0) {
      borrador.error = 'No se pudieron cargar los adjuntos del mensaje original.';
    } else if (fallidos > 0) {
      borrador.error = `Se reenviaron ${adjuntosNuevos.length} adjunto(s); ${fallidos} no se pudieron cargar.`;
    } else {
      borrador.error = '';
    }

    this.cdr.detectChanges();
  }

  private cargarCarpetas(cargarMensajes: boolean): void {
    this.cargandoCarpetas = true;

    this.backendService.obtenerCarpetasCorreo(this.correoApiBase).subscribe({
      next: (response) => {
        this.cargandoCarpetas = false;
        this.cuentaActiva = response?.cuenta || this.cuentaActiva;
        this.aplicarCarpetas(Array.isArray(response?.carpetas) ? response.carpetas : []);
        this.errorCarpetas = '';

        if (cargarMensajes) {
          this.cargarCorreos(false, false);
        }
      },
      error: (error) => {
        this.cargandoCarpetas = false;
        this.errorCarpetas = this.mensajeErrorHttp(error, 'No se pudieron cargar las carpetas del buzon.');
        if (cargarMensajes) {
          this.cargarCorreos(false, true);
        }
      }
    });
  }

  private cargarBusquedasRecientes(): void {
    this.backendService.obtenerBusquedasCorreo(this.correoApiBase).subscribe({
      next: (response) => {
        this.busquedasRecientes = Array.isArray(response?.busquedas) ? response.busquedas : [];
      },
      error: () => {
        this.busquedasRecientes = [];
      }
    });
  }

  private aplicarCarpetas(carpetas: CorreoCarpeta[]): void {
    if (!Array.isArray(carpetas) || !carpetas.length) {
      return;
    }

    const mapa = new Map(carpetas.map(carpeta => [carpeta.id, { ...carpeta }]));
    this.carpetas = this.carpetasDisponibles.map(carpetaBase => {
      const remota = mapa.get(carpetaBase.id);
      return remota ? { ...carpetaBase, ...remota } : carpetaBase;
    });
  }

  private sincronizarConteoCarpetaActiva(total: number, noLeidos?: number): void {
    if (!this.carpetas.length) {
      return;
    }

    this.carpetas = this.carpetas.map(carpeta => {
      if (carpeta.id !== this.carpetaActiva) {
        return carpeta;
      }

      return {
        ...carpeta,
        total: Number.isFinite(total) ? Number(total) : carpeta.total,
        noLeidos: typeof noLeidos === 'number' ? noLeidos : carpeta.noLeidos
      };
    });
  }

  private actualizarConteoNoLeidosLocal(delta: number): void {
    if (!delta || this.carpetaActiva !== 'inbox') {
      return;
    }

    this.carpetas = this.carpetas.map(carpeta => {
      if (carpeta.id !== 'inbox') {
        return carpeta;
      }

      const actual = Number(carpeta.noLeidos || 0);
      return {
        ...carpeta,
        noLeidos: Math.max(0, actual + delta)
      };
    });
  }

  private cargarVistaMensaje(mensaje: CorreoMensaje): void {
    if (!mensaje?.uid) {
      return;
    }

    const carpetaOrigen = this.carpetaDeMensaje(mensaje);
    this.cargandoContenido = true;
    this.errorCorreo = '';
    this.liberarIframe();

    // Una sola peticion (/vista) trae cuerpo + detalle y marca como leido en IMAP,
    // evitando abrir varias conexiones IMAP al abrir un correo.
    this.cargarVistaCorreoCompleta(mensaje, carpetaOrigen);
  }

  private cargarVistaCorreoCompleta(mensaje: CorreoMensaje, carpetaOrigen: string, errorPrevio?: any): void {
    this.backendService.obtenerVistaCorreo(mensaje.uid, carpetaOrigen, this.correoApiBase).subscribe({
      next: (response) => {
        if (this.mensajeSeleccionado?.uid !== mensaje.uid) {
          return;
        }

        this.cargandoContenido = false;
        this.detalleCorreo = this.traducirDetalleCorreo(response?.detalle || null);

        const html = String(response?.html || '').trim();
        if (html) {
          this.mostrarHtmlCorreo(html);
          return;
        }

        if (mensaje.resumen) {
          this.mostrarTextoPlano(mensaje.resumen);
          return;
        }

        this.errorCorreo = this.mensajeErrorHttp(errorPrevio, 'No se pudo cargar el contenido del correo.');
      },
      error: (error) => {
        if (this.mensajeSeleccionado?.uid !== mensaje.uid) {
          return;
        }
        this.cargandoContenido = false;
        if (mensaje.resumen) {
          this.mostrarTextoPlano(mensaje.resumen);
          this.errorCorreo = '';
          return;
        }
        this.errorCorreo = this.mensajeErrorHttp(errorPrevio || error, 'No se pudo cargar el contenido del correo.');
      }
    });
  }

  private mostrarTextoPlano(texto: string): void {
    this.cuerpoTextoPlano = String(texto || '').trim();
    this.cuerpoHtmlContenido = '';
    this.conversacionHtml = '';
    this.conversacionExpandida = false;
    this.esContestacionVista = false;
    this.mostrarCuerpoIframe = false;
    this.registrarDiagnosticoRender('render_texto_plano', {
      longitudTexto: this.cuerpoTextoPlano.length
    });
    this.cdr.detectChanges();
  }

  private mostrarHtmlCorreo(html: string): void {
    const contenidoHtml = String(html || '').trim();
    const textoPlanoExtraido = this.extraerTextoPlanoDesdeHtml(contenidoHtml);

    if (this.esHtmlGeneradoDesdeTextoPlano(contenidoHtml, textoPlanoExtraido)) {
      this.mostrarTextoPlano(textoPlanoExtraido);
      return;
    }

    const partes = this.separarConversacionHtml(contenidoHtml);
    this.cuerpoHtmlContenido = partes.principal;
    this.conversacionHtml = partes.conversacion;
    this.conversacionExpandida = false;
    this.esContestacionVista = partes.esContestacion
      || Boolean(this.detalleCorreo?.esContestacion)
      || Boolean(this.detalleCorreo?.inReplyTo)
      || /^(re|rv|res)\s*:/i.test(String(this.mensajeSeleccionado?.asunto || this.detalleCorreo?.asunto || '').trim());
    this.cuerpoTextoPlano = '';
    this.mostrarCuerpoIframe = true;
    this.registrarDiagnosticoRender('render_html_iframe', {
      longitudHtml: this.cuerpoHtmlContenido.length,
      longitudConversacion: this.conversacionHtml.length,
      esContestacion: this.esContestacionVista
    });
    this.cdr.detectChanges();
    setTimeout(() => this.actualizarIframeContenido(), 0);
  }

  /**
   * Separa el mensaje nuevo de la conversación citada (Gmail/Outlook/Biznaga)
   * para mostrarla minimizada al inicio, como en redactar.
   */
  private separarConversacionHtml(html: string): { principal: string; conversacion: string; esContestacion: boolean } {
    const doc = this.parsearHtmlSeguro(html);
    if (!doc?.body) {
      return { principal: html, conversacion: '', esContestacion: false };
    }

    const cuerpo = doc.body;

    // 1) Contenedores típicos de cita (Gmail / Outlook / Yahoo).
    const candidatos = Array.from(
      cuerpo.querySelectorAll(
        [
          'blockquote',
          '.gmail_quote',
          '.gmail_extra',
          '.gmail_quote_container',
          '.yahoo_quoted',
          '#divRplyFwdMsg',
          'div[class*="gmail_quote"]'
        ].join(',')
      )
    ) as HTMLElement[];

    let corte: Node | null = candidatos.find((nodo) => cuerpo.contains(nodo)) || null;

    // 2) Marcadores de texto en HTML plano (citas Biznaga / "escribió:").
    if (!corte) {
      corte = this.buscarNodoInicioConversacion(cuerpo);
    }

    if (!corte) {
      return { principal: html, conversacion: '', esContestacion: false };
    }

    const padre = (corte.parentNode as HTMLElement | null) || cuerpo;
    const hijos = Array.from(padre.childNodes);
    const idx = hijos.indexOf(corte as ChildNode);
    if (idx < 0) {
      return { principal: html, conversacion: '', esContestacion: false };
    }

    // Si el corte es el primer hijo con contenido del body (o wrapper único),
    // no hay "mensaje nuevo" separable: dejar el HTML intacto.
    if (padre === cuerpo || padre.parentElement === cuerpo) {
      const antes = hijos.slice(0, idx).some((n) => String(n.textContent || '').trim());
      if (!antes && (padre === cuerpo || cuerpo.children.length <= 1)) {
        // Puede ser que el mensaje nuevo y la cita vivan en el mismo wrapper:
        // intentar cortar por marcador interno.
        const corteInterno = this.partirWrapperPorMarcador(padre, idx === 0 ? padre : null);
        if (corteInterno) {
          return corteInterno;
        }
      }
    }

    const conversacionNodes = hijos.slice(idx);
    for (const nodo of conversacionNodes) {
      padre.removeChild(nodo);
    }

    const principalTrim = String(cuerpo.innerHTML || '').trim();
    const conversacionDoc = document.implementation.createHTMLDocument('');
    const wrap = conversacionDoc.createElement('div');
    for (const nodo of conversacionNodes) {
      wrap.appendChild(conversacionDoc.importNode(nodo, true));
    }
    const conversacionHtml = String(wrap.innerHTML || '').trim();
    const textoPrincipal = this.extraerTextoPlanoDesdeHtml(`<html><body>${principalTrim}</body></html>`).trim();

    if (!conversacionHtml) {
      return { principal: html, conversacion: '', esContestacion: false };
    }
    if (!textoPrincipal) {
      return { principal: html, conversacion: '', esContestacion: true };
    }

    return {
      principal: this.reemplazarCuerpoEnDocumento(html, principalTrim),
      conversacion: conversacionHtml,
      esContestacion: true
    };
  }

  private esTextoMarcadorConversacion(texto: string): boolean {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) {
      return false;
    }
    return /mensaje original|mensaje reenviado|forwarded message|original message/i.test(t)
      || /\bescribi[oó]\s*:/i.test(t)
      || /\bwrote\s*:/i.test(t)
      || /^-{5,}\s*mensaje\s+(original|reenviado)/i.test(t)
      || (/^_{5,}/.test(t) && /mensaje/i.test(t));
  }

  private buscarNodoInicioConversacion(raiz: HTMLElement): Node | null {
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let actual: Node | null = walker.nextNode();
    while (actual) {
      if (actual.nodeType === Node.TEXT_NODE) {
        const texto = String(actual.textContent || '');
        if (this.esTextoMarcadorConversacion(texto)
          || /----------\s*mensaje\s+original\s*----------/i.test(texto)
          || /----------\s*mensaje\s+reenviado\s*----------/i.test(texto)) {
          return actual;
        }
      } else if (actual.nodeType === Node.ELEMENT_NODE) {
        const el = actual as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === 'br') {
          actual = walker.nextNode();
          continue;
        }
        // Solo nodos "hoja" de texto corto con el marcador (evitar el wrapper completo).
        if (el.children.length === 0) {
          const texto = String(el.textContent || '');
          if (this.esTextoMarcadorConversacion(texto)) {
            return el;
          }
        }
      }
      actual = walker.nextNode();
    }
    return null;
  }

  private partirWrapperPorMarcador(
    _padre: HTMLElement,
    wrapper: HTMLElement | null
  ): { principal: string; conversacion: string; esContestacion: boolean } | null {
    if (!wrapper) {
      return null;
    }
    const hijos = Array.from(wrapper.childNodes);
    let idxMarcador = -1;
    for (let i = 0; i < hijos.length; i += 1) {
      const n = hijos[i];
      const texto = String(n.textContent || '');
      if (this.esTextoMarcadorConversacion(texto)
        || /----------\s*mensaje\s+(original|reenviado)\s*----------/i.test(texto)) {
        idxMarcador = i;
        break;
      }
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.classList?.contains('gmail_attr') || (/\bescribi[oó]\s*:/i.test(texto) && texto.length < 220)) {
          idxMarcador = i;
          break;
        }
      }
    }
    if (idxMarcador <= 0) {
      return null;
    }

    const principalNodes = hijos.slice(0, idxMarcador);
    const conversacionNodes = hijos.slice(idxMarcador);

    const principalWrap = document.createElement('div');
    for (const n of principalNodes) {
      principalWrap.appendChild(n.cloneNode(true));
    }
    const conversacionWrap = document.createElement('div');
    for (const n of conversacionNodes) {
      conversacionWrap.appendChild(n.cloneNode(true));
    }

    const principalTrim = String(principalWrap.innerHTML || '').trim();
    const conversacionHtml = String(conversacionWrap.innerHTML || '').trim();
    const textoPrincipal = this.extraerTextoPlanoDesdeHtml(`<html><body>${principalTrim}</body></html>`).trim();
    if (!textoPrincipal || !conversacionHtml) {
      return null;
    }

    const doc = wrapper.ownerDocument;
    const htmlBase = doc?.documentElement
      ? ('<!DOCTYPE html>' + doc.documentElement.outerHTML)
      : '';

    return {
      principal: this.reemplazarCuerpoEnDocumento(htmlBase || principalTrim, principalTrim),
      conversacion: conversacionHtml,
      esContestacion: true
    };
  }

  private reemplazarCuerpoEnDocumento(htmlOriginal: string, nuevoCuerpoInner: string): string {
    const doc = this.parsearHtmlSeguro(htmlOriginal);
    if (!doc?.body) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px 36px 20px 24px;font-family:'Century Gothic',CenturyGothic,AppleGothic,'URW Gothic L',sans-serif;font-size:14px;line-height:1.65;color:#1A1A1A;">${nuevoCuerpoInner}</body></html>`;
    }
    doc.body.innerHTML = nuevoCuerpoInner;
    return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  }

  private parsearHtmlSeguro(html: string): Document | null {
    const contenido = String(html || '').trim();
    if (!contenido) {
      return null;
    }

    try {
      return new DOMParser().parseFromString(contenido, 'text/html');
    } catch (_error) {
      return null;
    }
  }

  private extraerTextoPlanoDesdeHtml(html: string): string {
    const doc = this.parsearHtmlSeguro(html);
    if (doc?.body) {
      return String(doc.body.innerText || doc.body.textContent || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private esHtmlGeneradoDesdeTextoPlano(html: string, textoPlano = ''): boolean {
    const contenido = String(html || '').trim();
    if (!contenido) {
      return false;
    }

    const texto = String(textoPlano || this.extraerTextoPlanoDesdeHtml(contenido)).trim();
    if (!texto) {
      return false;
    }

    const doc = this.parsearHtmlSeguro(contenido);
    if (!doc?.body) {
      return false;
    }

    if (doc.body.querySelector('img,table,video,audio,iframe,svg,canvas,form,input,button,style,blockquote,ul,ol,li,h1,h2,h3,h4,h5,h6,a')) {
      return false;
    }

    const hijosBody = Array.from(doc.body.children);
    if (hijosBody.length !== 1 || hijosBody[0].tagName.toLowerCase() !== 'div') {
      return false;
    }

    const contenedor = hijosBody[0] as HTMLElement;
    const estiloContenedor = String(contenedor.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    const usaPlantillaBiznaga = estiloContenedor.includes('centurygothic')
      || (estiloContenedor.includes('font-family:arial') && estiloContenedor.includes('line-height:1.6'));
    if (!usaPlantillaBiznaga) {
      return false;
    }

    const elementosInternos = Array.from(contenedor.querySelectorAll('*'));
    const soloSaltosYTexto = elementosInternos.every((elemento) => elemento.tagName.toLowerCase() === 'br');
    if (!soloSaltosYTexto) {
      return false;
    }

    return true;
  }

  private parsearRemitente(remitente: string | null | undefined): { nombre: string; correo: string } {
    const texto = String(remitente || '').trim();
    if (!texto) {
      return { nombre: '', correo: '' };
    }

    let nombre = '';
    let correo = '';

    const matchAngulos = texto.match(/^(.+?)\s*<([^>]+)>$/);
    if (matchAngulos) {
      nombre = matchAngulos[1].replace(/^["']|["']$/g, '').trim();
      correo = matchAngulos[2].trim();
    } else if (texto.includes('@')) {
      correo = texto.replace(/^<|>$/g, '').trim();
    } else {
      nombre = texto;
    }

    const amistoso = this.nombreAmistosoRemitente(correo);
    if (amistoso) {
      nombre = amistoso;
    }

    return { nombre, correo };
  }

  private liberarIframe(): void {
    this.cuerpoHtmlContenido = '';
    this.cuerpoTextoPlano = '';
    this.conversacionHtml = '';
    this.conversacionExpandida = false;
    this.esContestacionVista = false;
    this.mostrarCuerpoIframe = false;
    this.iframeBlobFallbackIntentado = false;
    this.liberarIframeBlob();
    if (this.cuerpoIframe?.nativeElement) {
      this.cuerpoIframe.nativeElement.removeAttribute('srcdoc');
      this.cuerpoIframe.nativeElement.src = 'about:blank';
    }
  }

  private liberarIframeBlob(): void {
    if (!this.iframeBlobUrl) {
      return;
    }
    URL.revokeObjectURL(this.iframeBlobUrl);
    this.iframeBlobUrl = null;
  }

  private actualizarIframeContenido(): void {
    const iframe = this.cuerpoIframe?.nativeElement;
    if (!iframe || !this.cuerpoHtmlContenido) {
      return;
    }

    this.iframeBlobFallbackIntentado = false;
    this.liberarIframeBlob();
    iframe.removeAttribute('src');
    iframe.srcdoc = this.cuerpoHtmlContenido;
    this.registrarDiagnosticoRender('iframe_srcdoc_asignado', {
      longitudHtml: this.cuerpoHtmlContenido.length
    });

    // Safari/WebKit a veces no dispara load con blob:; srcdoc + reintentos asegura altura visible.
    const ajustar = () => this.ajustarAlturaIframeElemento(iframe);
    setTimeout(ajustar, 0);
    setTimeout(ajustar, 120);
    setTimeout(ajustar, 400);
    setTimeout(() => this.intentarRecuperacionRenderIframe(iframe), 220);
    setTimeout(() => this.intentarRecuperacionRenderIframe(iframe), 650);
  }

  private intentarRecuperacionRenderIframe(iframe: HTMLIFrameElement): void {
    if (!this.mostrarCuerpoIframe || !this.cuerpoHtmlContenido || !iframe) {
      return;
    }

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    const textoVisible = String(doc?.body?.innerText || doc?.body?.textContent || '').trim();
    const tieneNodos = Boolean(doc?.body?.childElementCount);
    this.registrarDiagnosticoRender('verificacion_iframe', {
      longitudTextoVisible: textoVisible.length,
      tieneNodos,
      fallbackBlobIntentado: this.iframeBlobFallbackIntentado
    });
    if (textoVisible || tieneNodos) {
      return;
    }

    if (!this.iframeBlobFallbackIntentado) {
      this.iframeBlobFallbackIntentado = true;
      try {
        this.liberarIframeBlob();
        const htmlBlob = new Blob([this.cuerpoHtmlContenido], { type: 'text/html;charset=utf-8' });
        this.iframeBlobUrl = URL.createObjectURL(htmlBlob);
        iframe.removeAttribute('srcdoc');
        iframe.src = this.iframeBlobUrl;
        this.registrarDiagnosticoRender('fallback_blob_aplicado', {
          longitudHtml: this.cuerpoHtmlContenido.length
        });
        setTimeout(() => this.ajustarAlturaIframeElemento(iframe), 180);
        return;
      } catch (_error) {
        this.registrarDiagnosticoRender('fallback_blob_error');
        // continuar con fallback de texto.
      }
    }

    const textoFallback = this.extraerTextoPlanoDesdeHtml(this.cuerpoHtmlContenido);
    if (textoFallback) {
      this.registrarDiagnosticoRender('fallback_texto_aplicado', {
        longitudTexto: textoFallback.length
      });
      this.mostrarTextoPlano(textoFallback);
    }
  }

  private obtenerDiagnosticoRenderCorreoActivo(): boolean {
    try {
      const valor = String(localStorage.getItem('correo_debug_render') || '').trim().toLowerCase();
      return valor === '1' || valor === 'true' || valor === 'on';
    } catch (_error) {
      return false;
    }
  }

  private registrarDiagnosticoRender(evento: string, extra: Record<string, any> = {}): void {
    if (!this.diagnosticoRenderCorreo) {
      return;
    }

    const mensaje = this.mensajeSeleccionado;
    console.log('[CORREO_RENDER_DEBUG]', {
      evento,
      uid: mensaje?.uid ?? null,
      carpeta: mensaje?.carpeta || this.carpetaActiva,
      timestamp: new Date().toISOString(),
      ...extra
    });
  }

  private traducirDetalleCorreo(detalle: CorreoDetalle | null): CorreoDetalle | null {
    if (!detalle) {
      return null;
    }

    const instante = detalle.fechaIso
      || this.mensajeSeleccionado?.fechaOriginal
      || detalle.fecha
      || null;

    return {
      ...detalle,
      fecha: instante
        ? traducirFechaDetalleLargoMexico(instante)
        : (detalle.fecha || ''),
      fechaIso: detalle.fechaIso || this.mensajeSeleccionado?.fechaOriginal || null
    };
  }

  private formatearFecha(date: Date): string {
    const p = partesFechaMexico(date);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  }

  private limpiarAlertas(): void {
    this.errorCorreo = '';
    this.errorCarpetas = '';
    this.mensajeExito = '';
  }

  private cargarCorreos(limpiarErrores = true, incluirCarpetas = false): void {
    if (!this.cuentaActiva) {
      this.errorCorreo = 'Tu perfil no tiene un correo configurado.';
      this.mensajes = [];
      return;
    }

    this.cargando = true;
    if (limpiarErrores) {
      this.errorCorreo = '';
    }

    const token = ++this.cargaCorreosToken;
    const carpetaSolicitada = this.carpetaActiva;

    const paginaSolicitada = this.paginaActual;
    const busquedaSolicitada = this.busquedaAplicada;
    this.backendService.obtenerCorreosPerfil(
      this.mensajesPorPagina,
      carpetaSolicitada,
      incluirCarpetas,
      this.correoApiBase,
      paginaSolicitada,
      busquedaSolicitada
    ).subscribe({
      next: (response) => {
        if (token !== this.cargaCorreosToken) {
          return;
        }

        const carpetaRespuesta = String(response?.carpeta?.id || '').trim().toLowerCase();
        if (carpetaRespuesta && carpetaRespuesta !== carpetaSolicitada) {
          this.cargando = false;
          this.errorCorreo = `El servidor devolvio la carpeta "${carpetaRespuesta}" en lugar de "${carpetaSolicitada}".`;
          return;
        }

        this.cargando = false;
        this.cuentaActiva = response?.cuenta || this.cuentaActiva;

        if (incluirCarpetas && Array.isArray(response?.carpetas) && response.carpetas.length) {
          this.aplicarCarpetas(response.carpetas);
          this.errorCarpetas = '';
        }

        this.mensajes = Array.isArray(response?.mensajes)
          ? response.mensajes.map((mensaje: any) => this.normalizarMensaje(mensaje, carpetaSolicitada))
          : [];
        this.mensajeSeleccionado = null;
        this.vistaActiva = 'lista';
        this.liberarIframe();
        this.limpiarAdjuntos();
        this.ultimaActualizacion = this.formatearFecha(new Date());
        this.carpetaActiva = carpetaRespuesta || carpetaSolicitada;

        this.totalResultados = Math.max(0, Number(response?.total) || 0);
        this.totalPaginas = Math.max(1, Number(response?.totalPaginas) || 1);
        this.paginaActual = Math.min(
          this.totalPaginas,
          Math.max(1, Number(response?.pagina) || paginaSolicitada)
        );

        const totalCarpeta = Number(response?.totalCarpeta ?? response?.total);
        const noLeidosCarpeta = this.carpetaActiva === 'inbox'
          ? this.mensajes.filter(mensaje => !mensaje.leido).length
          : undefined;
        this.sincronizarConteoCarpetaActiva(
          Number.isFinite(totalCarpeta) ? totalCarpeta : this.mensajes.length,
          noLeidosCarpeta
        );
      },
      error: (error) => {
        if (token !== this.cargaCorreosToken) {
          return;
        }

        this.cargando = false;
        this.mensajes = [];
        this.mensajeSeleccionado = null;
        this.vistaActiva = 'lista';
        this.liberarIframe();
        this.limpiarAdjuntos();
        this.errorCorreo = this.mensajeErrorHttp(error, 'No se pudieron obtener los correos.');
      }
    });
  }

  private limpiarAdjuntos(): void {
    this.adjuntos = [];
    this.cargandoAdjuntos = false;
    this.errorAdjuntos = '';
    this.descargandoAdjuntoId = null;
  }

  private cargarAdjuntos(mensaje: CorreoMensaje): void {
    const uid = mensaje.uid;
    if (!uid) {
      this.errorAdjuntos = 'No se pudo identificar el correo para cargar adjuntos.';
      return;
    }

    this.cargandoAdjuntos = true;
    this.errorAdjuntos = '';

    this.backendService.obtenerAdjuntosCorreo(uid, this.carpetaDeMensaje(mensaje), this.correoApiBase).subscribe({
      next: (response) => {
        if (this.mensajeSeleccionado?.uid !== uid) {
          return;
        }
        this.cargandoAdjuntos = false;
        this.adjuntos = Array.isArray(response?.adjuntos) ? response.adjuntos : [];
        if (this.adjuntos.length > 0) {
          this.mensajeSeleccionado.tieneAdjunto = true;
          const indice = this.mensajes.findIndex((item) => item.uid === uid);
          if (indice >= 0) {
            this.mensajes[indice].tieneAdjunto = true;
          }
        }
      },
      error: (error) => {
        if (this.mensajeSeleccionado?.uid !== uid) {
          return;
        }
        this.cargandoAdjuntos = false;
        this.adjuntos = [];
        this.errorAdjuntos = error?.error?.message || 'No se pudieron cargar los adjuntos.';
      }
    });
  }

  private normalizarMensaje(mensaje: any, carpetaFallback = this.carpetaActiva): CorreoMensaje {
    const fechaOriginal = mensaje?.fecha ? String(mensaje.fecha) : '';

    return {
      id: String(mensaje?.id || mensaje?.uid || Date.now()),
      uid: mensaje?.uid ?? null,
      carpeta: String(mensaje?.carpeta || carpetaFallback || 'inbox').trim().toLowerCase(),
      remitente: mensaje?.remitente || 'Sin remitente',
      destinatario: mensaje?.destinatario || this.cuentaActiva,
      asunto: mensaje?.asunto || '(Sin asunto)',
      fecha: this.formatearFechaCorreo(fechaOriginal),
      fechaDetalle: this.formatearFechaDetalle(fechaOriginal),
      fechaLista: this.formatearFechaLista(fechaOriginal),
      fechaOriginal,
      resumen: mensaje?.resumen || '',
      leido: Boolean(mensaje?.leido),
      favorito: Boolean(mensaje?.favorito),
      tieneAdjunto: Boolean(mensaje?.tieneAdjunto)
    };
  }

  private obtenerNombreArchivoDescarga(response: HttpResponse<Blob>, adjunto: CorreoAdjunto): string {
    const contentDisposition = response.headers.get('content-disposition') || '';
    const matchUtf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (matchUtf8?.[1]) {
      try {
        return decodeURIComponent(matchUtf8[1]);
      } catch (_error) {
        // Ignorar errores de decodificacion y usar fallback.
      }
    }

    const match = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) {
      return match[1];
    }

    return adjunto?.nombre || `adjunto-${adjunto.indice + 1}`;
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = nombreArchivo;
    anchor.rel = 'noopener';
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  private formatearFechaCorreo(fecha: string | null | undefined): string {
    return traducirFechaCorreoMexico(fecha);
  }

  private formatearFechaDetalle(fecha: string | null | undefined): string {
    return traducirFechaDetalleCorreoMexico(fecha);
  }

  private formatearFechaLista(fecha: string | null | undefined): string {
    return traducirFechaListaCorreoMexico(fecha);
  }
}
