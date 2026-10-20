import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from 'src/environments/environment';
import { AuthService } from './auth.service';

export interface DiagramaCambioVivo {
  diagramaId: number;
  patch?: any;
  xml?: string;
  checksum?: string | null;
  usuarioId?: number | null;
  nombre?: string;
}

export interface DiagramaPresenciaViva {
  diagramaId: number;
  usuarios: Array<{ id: number; nombre: string }>;
}

/**
 * Canal en vivo de Diagramas. Usa el mismo Socket.io del sistema, con su propia conexión,
 * para no cortar el chat si se cierra este apartado.
 */
@Injectable({ providedIn: 'root' })
export class DiagramasSocketService {
  private socket: Socket | null = null;
  private diagramaActivo: number | null = null;
  private readonly cambio$ = new Subject<DiagramaCambioVivo>();
  private readonly presencia$ = new Subject<DiagramaPresenciaViva>();
  private readonly estado$ = new Subject<boolean>();

  constructor(
    private auth: AuthService,
    private ngZone: NgZone
  ) {}

  onCambio(): Observable<DiagramaCambioVivo> {
    return this.cambio$.asObservable();
  }

  onPresencia(): Observable<DiagramaPresenciaViva> {
    return this.presencia$.asObservable();
  }

  onEstado(): Observable<boolean> {
    return this.estado$.asObservable();
  }

  get conectado(): boolean {
    return !!this.socket?.connected;
  }

  connect(): void {
    if (this.socket?.connected) {
      this.estado$.next(true);
      return;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    const token = this.auth.getToken();
    if (!token) {
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
        if (this.diagramaActivo) {
          this.socket?.emit('diagramas:entrar', { diagramaId: this.diagramaActivo });
        }
      });
    });

    this.socket.on('disconnect', () => {
      this.ngZone.run(() => this.estado$.next(false));
    });

    this.socket.on('diagramas:cambio', (payload: DiagramaCambioVivo) => {
      this.ngZone.run(() => this.cambio$.next(payload));
    });

    this.socket.on('diagramas:presencia', (payload: DiagramaPresenciaViva) => {
      this.ngZone.run(() => this.presencia$.next(payload));
    });

    this.socket.on('connect_error', () => {
      this.ngZone.run(() => this.estado$.next(false));
    });
  }

  entrar(diagramaId: number): void {
    this.connect();
    this.diagramaActivo = diagramaId;
    if (this.socket?.connected) {
      this.socket.emit('diagramas:entrar', { diagramaId });
    }
  }

  salir(diagramaId: number): void {
    if (this.diagramaActivo === diagramaId) {
      this.diagramaActivo = null;
    }
    this.socket?.emit('diagramas:salir', { diagramaId });
  }

  emitirCambio(cambio: DiagramaCambioVivo): void {
    if (!this.socket?.connected || !cambio?.diagramaId) return;
    this.socket.emit('diagramas:cambio', cambio);
  }

  disconnect(): void {
    if (this.diagramaActivo) {
      this.socket?.emit('diagramas:salir', { diagramaId: this.diagramaActivo });
      this.diagramaActivo = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.estado$.next(false);
  }
}
