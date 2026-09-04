import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { BackendServices } from './backend.services';

export interface CorreoSugerido {
  email: string;
  nombre?: string | null;
  origen?: 'usuario' | 'personal' | string;
  foto_drive_id?: string | null;
  foto_url?: string | null;
  avatar_url?: string | null;
  empresa_logo?: string | null;
  empresa_nombre?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class CorreoSugerenciasService {
  private correosSugeridos: CorreoSugerido[] = [];
  private correosSugeridosIndex = new Set<string>();
  private correosPersonalesPendientes = new Set<string>();
  private cargando = false;
  private cargado = false;

  constructor(private backendService: BackendServices) {}

  cargar(limit: number = 250): Observable<CorreoSugerido[]> {
    if (this.cargado) {
      return of(this.correosSugeridos);
    }

    if (this.cargando) {
      return of(this.correosSugeridos);
    }

    this.cargando = true;
    return this.backendService.obtenerCorreosSugeridos(limit).pipe(
      tap(
        (data: any) => {
          this.cargando = false;
          if (data?.success && Array.isArray(data.sugerencias)) {
            this.correosSugeridos = data.sugerencias;
            this.actualizarIndice();
            this.cargado = true;
          }
        },
        () => {
          this.cargando = false;
          this.correosSugeridos = [];
          this.actualizarIndice();
        }
      ),
      map(() => this.correosSugeridos)
    );
  }

  filtrar(texto: string, excluir: string[] = []): CorreoSugerido[] {
    const termino = this.normalizarTexto(texto);
    const seleccionados = new Set(excluir.map((correo) => this.normalizarCorreo(correo)));

    return (this.correosSugeridos || []).filter((item) => {
      const email = this.normalizarCorreo(item.email);
      if (!email || seleccionados.has(email)) {
        return false;
      }
      if (!termino) {
        return true;
      }
      const nombre = this.normalizarTexto(item.nombre || '');
      return email.includes(termino) || nombre.includes(termino);
    });
  }

  getCorreoAvatarUrl(sugerencia: CorreoSugerido): string | null {
    if (!sugerencia) {
      return null;
    }
    return this.backendService.resolverUrlDrivePreview(
      sugerencia.foto_drive_id || sugerencia.foto_url || sugerencia.avatar_url || sugerencia.empresa_logo
    );
  }

  getCorreoIniciales(sugerencia: CorreoSugerido): string {
    const base = String(sugerencia?.nombre || sugerencia?.empresa_nombre || sugerencia?.email || '').trim();
    if (!base) {
      return '?';
    }
    const partes = base.split(/[\s\n]+/).filter(Boolean);
    const letras = partes.slice(0, 2).map((parte) => parte.charAt(0).toUpperCase());
    return letras.join('') || base.charAt(0).toUpperCase();
  }

  onCorreoAvatarError(sugerencia: CorreoSugerido): void {
    if (!sugerencia) {
      return;
    }
    sugerencia.foto_drive_id = null;
    sugerencia.foto_url = null;
    sugerencia.avatar_url = null;
    sugerencia.empresa_logo = null;
  }

  guardarPersonalSiNuevo(correo: string): void {
    const normalizado = this.normalizarCorreo(correo);
    if (!normalizado || this.correosSugeridosIndex.has(normalizado)) {
      return;
    }
    if (this.correosPersonalesPendientes.has(normalizado)) {
      return;
    }

    this.correosPersonalesPendientes.add(normalizado);
    this.backendService.guardarCorreosPersonales([normalizado]).subscribe(
      (data: any) => {
        this.correosPersonalesPendientes.delete(normalizado);
        if (data?.success) {
          const correos = Array.isArray(data.correos_personales)
            ? data.correos_personales
            : [normalizado];
          this.agregarCorreosPersonales(correos);
        }
      },
      () => {
        this.correosPersonalesPendientes.delete(normalizado);
      }
    );
  }

  estiloDropdownFijo(anchor: HTMLElement, maxHeight: number = 240, zIndex: number = 1300): Record<string, string> {
    const rect = anchor.getBoundingClientRect();
    const espacioInferior = window.innerHeight - rect.bottom - 12;
    const altura = Math.max(120, Math.min(maxHeight, espacioInferior));

    return {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 260)}px`,
      maxHeight: `${altura}px`,
      zIndex: String(zIndex)
    };
  }

  validarEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  private agregarCorreosPersonales(correos: string[]): void {
    correos.forEach((correo) => {
      const normalizado = this.normalizarCorreo(correo);
      if (!normalizado || this.correosSugeridosIndex.has(normalizado)) {
        return;
      }
      this.correosSugeridosIndex.add(normalizado);
      this.correosSugeridos.push({
        email: normalizado,
        nombre: null,
        origen: 'personal'
      });
    });
  }

  private actualizarIndice(): void {
    this.correosSugeridosIndex = new Set(
      (this.correosSugeridos || []).map((item) => this.normalizarCorreo(item.email))
    );
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '').toLowerCase().trim();
  }

  private normalizarCorreo(correo: string): string {
    return String(correo || '').trim().toLowerCase();
  }
}
