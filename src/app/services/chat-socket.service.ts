import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from 'src/environments/environment';
import { AuthService } from './auth.service';
import { ChatConversacionActualizada, ChatMensaje } from './chat-empresas-api.service';

/**
 * Conexión Socket.io del chat (Mesa de Ayuda).
 * Los eventos se reinyectan en NgZone para que Angular actualice la vista.
 */
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private socket: Socket | null = null;
  private hiloActivo: number | null = null;
  private readonly mensaje$ = new Subject<ChatMensaje>();
  private readonly conversacionActualizada$ = new Subject<ChatConversacionActualizada>();
  private readonly estado$ = new Subject<boolean>();
  private readonly error$ = new Subject<string>();

  constructor(
    private auth: AuthService,
    private ngZone: NgZone
  ) {}

  onMensaje(): Observable<ChatMensaje> {
    return this.mensaje$.asObservable();
  }

  onConversacionActualizada(): Observable<ChatConversacionActualizada> {
    return this.conversacionActualizada$.asObservable();
  }

  onEstado(): Observable<boolean> {
    return this.estado$.asObservable();
  }

  onError(): Observable<string> {
    return this.error$.asObservable();
  }

  get conectado(): boolean {
    return !!this.socket?.connected;
  }

  connect(): void {
    if (this.socket?.connected) {
      this.estado$.next(true);
      return;
    }

    // Si quedó un socket a medias, limpia antes de recrear
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const token = this.auth.getToken();
    if (!token) {
      this.error$.next('No hay token de sesión para Socket.io');
      this.estado$.next(false);
      return;
    }

    this.socket = io(environment.socketUrl, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1200
    });

    this.socket.on('connect', () => {
      this.ngZone.run(() => {
        this.estado$.next(true);
        // Re-unir al hilo abierto tras reconnect
        if (this.hiloActivo) {
          this.socket?.emit('chat:join', { conversacionId: this.hiloActivo });
        }
      });
    });

    this.socket.on('disconnect', () => {
      this.ngZone.run(() => this.estado$.next(false));
    });

    this.socket.on('chat:mensaje', (payload: ChatMensaje) => {
      this.ngZone.run(() => this.mensaje$.next(payload));
    });

    this.socket.on('chat:conversacion_actualizada', (payload: ChatConversacionActualizada) => {
      this.ngZone.run(() => this.conversacionActualizada$.next(payload));
    });

    this.socket.on('chat:error', (payload: { message?: string }) => {
      this.ngZone.run(() => {
        this.error$.next(payload?.message || 'Error de chat en tiempo real');
      });
    });

    this.socket.on('connect_error', (err) => {
      this.ngZone.run(() => {
        this.estado$.next(false);
        this.error$.next(err?.message || 'No se pudo conectar al chat en tiempo real');
      });
    });
  }

  disconnect(): void {
    this.hiloActivo = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.estado$.next(false);
  }

  joinConversacion(conversacionId: number): void {
    this.hiloActivo = conversacionId;
    if (this.socket?.connected) {
      this.socket.emit('chat:join', { conversacionId });
    }
  }

  leaveConversacion(conversacionId: number): void {
    if (this.hiloActivo === conversacionId) {
      this.hiloActivo = null;
    }
    this.socket?.emit('chat:leave', { conversacionId });
  }

  enviarMensaje(payload: {
    cuerpo: string;
    conversacionId?: number;
    empresaId?: number;
  }): Promise<{ success: boolean; mensaje?: ChatMensaje; message?: string }> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve({ success: false, message: 'Socket no conectado' });
        return;
      }
      this.socket.emit('chat:enviar', payload, (ack: any) => {
        this.ngZone.run(() => {
          resolve(ack || { success: false, message: 'Sin respuesta del servidor' });
        });
      });
    });
  }
}
