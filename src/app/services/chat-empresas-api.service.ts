import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

/** Modelos del Chat Empresas — úsalos en el componente. */
export interface ChatConversacion {
  conversacion_id: number;
  empresa_id: number;
  nombre_empresa: string;
  logo?: string | null;
  estado: 'abierta' | 'cerrada' | string;
  ultimo_mensaje_at: string | null;
  ultimo_mensaje: string;
  ultimo_emisor_tipo: 'empresa' | 'admin' | null;
  no_leidos: number;
  created_at?: string;
}

export interface ChatMensaje {
  mensaje_id: number;
  conversacion_id: number;
  empresa_id?: number;
  emisor_tipo: 'empresa' | 'admin';
  emisor_usuario_id: number;
  emisor_nombre?: string;
  cuerpo: string;
  leido_destinatario?: boolean;
  created_at: string;
}

export interface ChatConversacionActualizada {
  conversacion_id: number;
  empresa_id: number;
  ultimo_mensaje: string;
  ultimo_emisor_tipo: 'empresa' | 'admin';
  ultimo_mensaje_at: string;
  mensaje?: ChatMensaje;
}

/**
 * Capa HTTP del Chat Empresas.
 * CONECTAR AQUÍ tus llamadas REST (lista, historial, envío, leídos).
 * El tiempo real va por ChatSocketService.
 */
@Injectable({ providedIn: 'root' })
export class ChatEmpresasApiService {
  // CONECTAR AQUÍ: base del API (environment.apiUrl ya incluye /api)
  private readonly base = `${environment.apiUrl}/chat-empresas`;

  constructor(private http: HttpClient) {}

  /** Lista de conversaciones (admin: todas; empresa: la suya). */
  listarConversaciones(opts?: { q?: string; soloNoLeidos?: boolean }): Observable<any> {
    const params: string[] = [];
    if (opts?.q) params.push(`q=${encodeURIComponent(opts.q)}`);
    if (opts?.soloNoLeidos) params.push('soloNoLeidos=1');
    const q = params.length ? `?${params.join('&')}` : '';
    return this.http.get(`${this.base}/conversaciones${q}`);
  }

  /** Historial de un hilo. */
  listarMensajes(conversacionId: number, afterId?: number): Observable<any> {
    const q = afterId ? `?afterId=${encodeURIComponent(String(afterId))}` : '';
    return this.http.get(`${this.base}/conversaciones/${conversacionId}/mensajes${q}`);
  }

  /** Guarda mensaje por REST (también emite por Socket.io en el backend). */
  enviarMensaje(payload: {
    cuerpo: string;
    conversacionId?: number;
    empresaId?: number;
  }): Observable<any> {
    return this.http.post(`${this.base}/mensajes`, payload);
  }

  marcarLeidos(conversacionId: number): Observable<any> {
    return this.http.post(`${this.base}/conversaciones/${conversacionId}/leidos`, {});
  }

  actualizarEstado(conversacionId: number, estado: 'abierta' | 'cerrada'): Observable<any> {
    return this.http.patch(`${this.base}/conversaciones/${conversacionId}`, { estado });
  }
}
