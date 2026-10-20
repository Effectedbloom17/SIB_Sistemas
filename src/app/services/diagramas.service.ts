import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

export interface DiagramaResumen {
  diagrama_id: number;
  titulo: string;
  created_at?: string;
  updated_at?: string;
  autor_nombre?: string;
  editor_nombre?: string;
}

export interface DiagramaDetalle extends DiagramaResumen {
  xml: string;
}

@Injectable({
  providedIn: 'root'
})
export class DiagramasService {
  private readonly baseUrl = `${environment.apiUrl}/diagramas`;

  constructor(private http: HttpClient) {}

  listar(): Observable<{ success: boolean; diagramas: DiagramaResumen[] }> {
    return this.http.get<{ success: boolean; diagramas: DiagramaResumen[] }>(this.baseUrl);
  }

  obtener(id: number): Observable<{ success: boolean; diagrama: DiagramaDetalle }> {
    return this.http.get<{ success: boolean; diagrama: DiagramaDetalle }>(`${this.baseUrl}/${id}`);
  }

  crear(titulo: string): Observable<{ success: boolean; diagrama: DiagramaDetalle }> {
    return this.http.post<{ success: boolean; diagrama: DiagramaDetalle }>(this.baseUrl, { titulo });
  }

  actualizar(id: number, cambios: { titulo?: string; xml?: string }): Observable<{ success: boolean; diagrama: DiagramaDetalle }> {
    return this.http.put<{ success: boolean; diagrama: DiagramaDetalle }>(`${this.baseUrl}/${id}`, cambios);
  }

  eliminar(id: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/${id}`);
  }
}
