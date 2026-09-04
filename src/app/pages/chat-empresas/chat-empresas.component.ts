import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, interval, of } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import {
  ChatConversacion,
  ChatEmpresasApiService,
  ChatMensaje
} from 'src/app/services/chat-empresas-api.service';
import { ChatSocketService } from 'src/app/services/chat-socket.service';

/**
 * Mesa de Ayuda — chat empresa ↔ administración (estilo WhatsApp Web).
 */
@Component({
  selector: 'app-chat-empresas',
  templateUrl: './chat-empresas.component.html',
  styleUrls: ['./chat-empresas.component.scss']
})
export class ChatEmpresasComponent implements OnInit, OnDestroy {
  @ViewChild('mensajesScroll') mensajesScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('inputMensaje') inputMensaje?: ElementRef<HTMLInputElement>;

  esAdmin = false;
  esEmpresa = false;

  conversaciones: ChatConversacion[] = [];
  conversacionActiva: ChatConversacion | null = null;
  mensajes: ChatMensaje[] = [];

  busqueda = '';
  soloNoLeidos = false;
  borrador = '';

  cargandoLista = false;
  cargandoMensajes = false;
  enviando = false;
  socketOk = false;

  errorLista: string | null = null;
  errorMensajes: string | null = null;
  errorEnvio: string | null = null;

  private readonly destroy$ = new Subject<void>();
  private busquedaTimer: ReturnType<typeof setTimeout> | null = null;
  private hiloSocketActual: number | null = null;

  constructor(
    private chatApi: ChatEmpresasApiService,
    private chatSocket: ChatSocketService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private backend: BackendServices
  ) {}

  ngOnInit(): void {
    this.esAdmin = this.auth.esAdministradorOSuperior() || this.auth.tieneAlgunRol(['root', 'administrador']);
    this.esEmpresa = this.auth.esUsuarioEmpresa();
    if (this.esAdmin) {
      this.esEmpresa = false;
    }

    this.chatSocket.connect();
    this.socketOk = this.chatSocket.conectado;

    this.chatSocket.onEstado()
      .pipe(takeUntil(this.destroy$))
      .subscribe((ok) => {
        this.socketOk = ok;
      });

    this.chatSocket.onMensaje()
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => this.aplicarMensajeEnVivo(msg));

    this.chatSocket.onConversacionActualizada()
      .pipe(takeUntil(this.destroy$))
      .subscribe((upd) => this.aplicarPreviewEnVivo(upd));

    this.chatSocket.onError()
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => {
        console.warn('[ChatSocket]', msg);
        this.socketOk = this.chatSocket.conectado;
      });

    this.cargarConversaciones(true);

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const c = Number(params.get('c') || 0);
      if (c > 0) {
        this.abrirPorId(c);
      }
    });

    // Respaldo: sincroniza mensajes del hilo abierto cada 4s si el socket falla
    interval(4000)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => {
          if (!this.conversacionActiva || this.enviando || this.cargandoMensajes) {
            return of(null);
          }
          const afterId = this.mensajes.length
            ? this.mensajes[this.mensajes.length - 1].mensaje_id
            : 0;
          return this.chatApi
            .listarMensajes(this.conversacionActiva.conversacion_id, afterId || undefined)
            .pipe(catchError(() => of(null)));
        })
      )
      .subscribe((res) => {
        if (!res?.success || !Array.isArray(res.mensajes)) {
          return;
        }
        for (const msg of res.mensajes as ChatMensaje[]) {
          this.aplicarMensajeEnVivo(msg);
        }
      });
  }

  ngOnDestroy(): void {
    if (this.hiloSocketActual) {
      this.chatSocket.leaveConversacion(this.hiloSocketActual);
    }
    this.chatSocket.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.busquedaTimer) {
      clearTimeout(this.busquedaTimer);
    }
  }

  onBusquedaChange(): void {
    if (this.busquedaTimer) {
      clearTimeout(this.busquedaTimer);
    }
    this.busquedaTimer = setTimeout(() => this.cargarConversaciones(false), 280);
  }

  toggleSoloNoLeidos(): void {
    this.soloNoLeidos = !this.soloNoLeidos;
    this.cargarConversaciones(false);
  }

  cargarConversaciones(autoAbrir: boolean): void {
    this.cargandoLista = true;
    this.errorLista = null;

    this.chatApi
      .listarConversaciones({
        q: this.busqueda.trim() || undefined,
        soloNoLeidos: this.soloNoLeidos || undefined
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoLista = false;
          if (!res?.success) {
            this.errorLista = res?.message || 'No se pudieron cargar las conversaciones.';
            return;
          }
          this.conversaciones = res.conversaciones || [];

          if (this.conversacionActiva) {
            const still = this.conversaciones.find(
              (c) => c.conversacion_id === this.conversacionActiva!.conversacion_id
            );
            if (still) {
              this.conversacionActiva = still;
            }
          } else if (autoAbrir && this.esEmpresa && this.conversaciones.length) {
            this.seleccionarConversacion(this.conversaciones[0]);
          }
        },
        error: (err) => {
          this.cargandoLista = false;
          this.errorLista = err?.error?.message || 'No se pudieron cargar las conversaciones.';
        }
      });
  }

  abrirPorId(conversacionId: number): void {
    const found = this.conversaciones.find((c) => c.conversacion_id === conversacionId);
    if (found) {
      this.seleccionarConversacion(found);
      return;
    }
    this.conversacionActiva = {
      conversacion_id: conversacionId,
      empresa_id: 0,
      nombre_empresa: 'Conversación',
      estado: 'abierta',
      ultimo_mensaje_at: null,
      ultimo_mensaje: '',
      ultimo_emisor_tipo: null,
      no_leidos: 0
    };
    this.hiloSocketActual = conversacionId;
    this.chatSocket.joinConversacion(conversacionId);
    this.cargarMensajes(true);
  }

  seleccionarConversacion(conv: ChatConversacion): void {
    if (this.conversacionActiva?.conversacion_id === conv.conversacion_id) {
      return;
    }

    if (this.hiloSocketActual) {
      this.chatSocket.leaveConversacion(this.hiloSocketActual);
    }

    this.conversacionActiva = conv;
    this.mensajes = [];
    this.errorMensajes = null;
    this.hiloSocketActual = conv.conversacion_id;
    this.chatSocket.joinConversacion(conv.conversacion_id);
    this.cargarMensajes(true);

    setTimeout(() => this.inputMensaje?.nativeElement?.focus(), 80);
  }

  cargarMensajes(marcarLeido: boolean): void {
    if (!this.conversacionActiva) {
      return;
    }
    this.cargandoMensajes = true;
    this.errorMensajes = null;
    const id = this.conversacionActiva.conversacion_id;

    this.chatApi
      .listarMensajes(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoMensajes = false;
          if (!res?.success) {
            this.errorMensajes = res?.message || 'No se pudieron cargar los mensajes.';
            return;
          }
          if (res.conversacion) {
            this.conversacionActiva = {
              ...(this.conversacionActiva as ChatConversacion),
              ...res.conversacion,
              no_leidos: this.conversacionActiva?.no_leidos || 0
            };
          }
          this.mensajes = res.mensajes || [];
          this.scrollAlFinal();
          if (marcarLeido) {
            this.marcarLeidos();
          }
        },
        error: (err) => {
          this.cargandoMensajes = false;
          this.errorMensajes = err?.error?.message || 'No se pudieron cargar los mensajes.';
        }
      });
  }

  async enviar(): Promise<void> {
    const texto = this.borrador.trim();
    if (!texto || this.enviando) {
      return;
    }

    if (!this.conversacionActiva && !this.esEmpresa) {
      this.errorEnvio = 'Selecciona una conversación a la izquierda.';
      return;
    }

    this.enviando = true;
    this.errorEnvio = null;

    const payload: { cuerpo: string; conversacionId?: number } = { cuerpo: texto };
    if (this.conversacionActiva?.conversacion_id) {
      payload.conversacionId = this.conversacionActiva.conversacion_id;
    }

    if (this.chatSocket.conectado) {
      const ack = await this.chatSocket.enviarMensaje(payload);
      this.enviando = false;
      if (!ack?.success) {
        this.enviarPorRest(payload);
        return;
      }
      this.borrador = '';
      if (ack.mensaje) {
        this.aplicarMensajeEnVivo(ack.mensaje);
        this.aplicarPreviewEnVivo({
          conversacion_id: ack.mensaje.conversacion_id,
          empresa_id: ack.mensaje.empresa_id || this.conversacionActiva?.empresa_id || 0,
          ultimo_mensaje: ack.mensaje.cuerpo,
          ultimo_emisor_tipo: ack.mensaje.emisor_tipo,
          ultimo_mensaje_at: ack.mensaje.created_at,
          mensaje: ack.mensaje
        });
        if (!this.conversacionActiva) {
          this.conversacionActiva = {
            conversacion_id: ack.mensaje.conversacion_id,
            empresa_id: ack.mensaje.empresa_id || 0,
            nombre_empresa: 'Mi empresa',
            estado: 'abierta',
            ultimo_mensaje_at: ack.mensaje.created_at,
            ultimo_mensaje: ack.mensaje.cuerpo,
            ultimo_emisor_tipo: ack.mensaje.emisor_tipo,
            no_leidos: 0
          };
          this.hiloSocketActual = ack.mensaje.conversacion_id;
          this.chatSocket.joinConversacion(ack.mensaje.conversacion_id);
          this.cargarConversaciones(false);
        }
      }
      return;
    }

    this.enviarPorRest(payload);
  }

  private enviarPorRest(payload: { cuerpo: string; conversacionId?: number }): void {
    this.enviando = true;
    this.chatApi
      .enviarMensaje(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.enviando = false;
          if (!res?.success) {
            this.errorEnvio = res?.message || 'No se pudo enviar el mensaje.';
            return;
          }
          this.borrador = '';
          const msg = res.mensaje as ChatMensaje;
          if (msg) {
            this.aplicarMensajeEnVivo(msg);
            if (!this.conversacionActiva && msg.conversacion_id) {
              this.conversacionActiva = {
                conversacion_id: msg.conversacion_id,
                empresa_id: msg.empresa_id || 0,
                nombre_empresa: 'Mi empresa',
                estado: 'abierta',
                ultimo_mensaje_at: msg.created_at,
                ultimo_mensaje: msg.cuerpo,
                ultimo_emisor_tipo: msg.emisor_tipo,
                no_leidos: 0
              };
              this.hiloSocketActual = msg.conversacion_id;
              this.chatSocket.joinConversacion(msg.conversacion_id);
            }
          }
          this.cargarConversaciones(false);
        },
        error: (err) => {
          this.enviando = false;
          this.errorEnvio = err?.error?.message || 'No se pudo enviar el mensaje.';
        }
      });
  }

  onEnterEnviar(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.enviar();
    }
  }

  private aplicarMensajeEnVivo(msg: ChatMensaje): void {
    if (!msg?.mensaje_id) {
      return;
    }
    if (this.conversacionActiva?.conversacion_id !== Number(msg.conversacion_id)) {
      return;
    }
    if (this.mensajes.some((m) => m.mensaje_id === msg.mensaje_id)) {
      return;
    }
    this.mensajes = [...this.mensajes, msg];
    this.scrollAlFinal();
    this.marcarLeidos();
  }

  private aplicarPreviewEnVivo(upd: {
    conversacion_id: number;
    empresa_id: number;
    ultimo_mensaje: string;
    ultimo_emisor_tipo: 'empresa' | 'admin';
    ultimo_mensaje_at: string;
    mensaje?: ChatMensaje;
  }): void {
    const cid = Number(upd.conversacion_id);
    const idx = this.conversaciones.findIndex((c) => c.conversacion_id === cid);
    const activa = this.conversacionActiva?.conversacion_id === cid;

    if (activa && upd.mensaje) {
      this.aplicarMensajeEnVivo(upd.mensaje);
    }

    if (idx >= 0) {
      const prev = this.conversaciones[idx];
      const noLeidos =
        activa || upd.ultimo_emisor_tipo === (this.esAdmin ? 'admin' : 'empresa')
          ? prev.no_leidos
          : (prev.no_leidos || 0) + 1;

      const updated: ChatConversacion = {
        ...prev,
        ultimo_mensaje: upd.ultimo_mensaje,
        ultimo_emisor_tipo: upd.ultimo_emisor_tipo,
        ultimo_mensaje_at: upd.ultimo_mensaje_at,
        no_leidos: noLeidos
      };
      const rest = this.conversaciones.filter((_, i) => i !== idx);
      this.conversaciones = [updated, ...rest];
      if (activa) {
        this.conversacionActiva = updated;
      }
    } else {
      this.cargarConversaciones(false);
    }
  }

  marcarLeidos(): void {
    if (!this.conversacionActiva) {
      return;
    }
    const id = this.conversacionActiva.conversacion_id;
    this.chatApi
      .marcarLeidos(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.conversaciones = this.conversaciones.map((c) =>
            c.conversacion_id === id ? { ...c, no_leidos: 0 } : c
          );
          if (this.conversacionActiva?.conversacion_id === id) {
            this.conversacionActiva = { ...this.conversacionActiva, no_leidos: 0 };
          }
        },
        error: () => undefined
      });
  }

  esMio(msg: ChatMensaje): boolean {
    return this.esAdmin ? msg.emisor_tipo === 'admin' : msg.emisor_tipo === 'empresa';
  }

  /** URL del logo de la empresa (Drive / pública). Si no hay, null → se muestran iniciales. */
  logoEmpresaUrl(conv: ChatConversacion | null | undefined): string | null {
    if (!conv?.logo) {
      return null;
    }
    return this.backend.resolverUrlDrivePreview(conv.logo);
  }

  onLogoError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (img) {
      img.style.display = 'none';
    }
  }

  iniciales(nombre: string): string {
    const parts = String(nombre || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  formatearFecha(valor: string | null | undefined): string {
    if (!valor) {
      return '';
    }
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    return d.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private scrollAlFinal(): void {
    setTimeout(() => {
      const el = this.mensajesScroll?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 40);
  }
}
