import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

export interface FormDraftEnvelope<T = unknown> {
  v: 1;
  key: string;
  updatedAt: string;
  datos: T;
}

const PREFIX = 'biznaga.draft.v1';

/**
 * Borradores locales (localStorage) para no perder trabajo al refrescar o perder red.
 * Clave típica: sgc:{slug}:{userId}.
 */
@Injectable({ providedIn: 'root' })
export class FormDraftService {
  constructor(private auth: AuthService) {}

  claveSgc(slug: string, extra = ''): string {
    const uid = this.auth.getUsuarioId()
      || this.auth.getUsername()
      || 'anon';
    const ext = String(extra || '').trim();
    return `sgc:${String(slug || '').toLowerCase()}:${uid}${ext ? ':' + ext : ''}`;
  }

  guardar<T>(clave: string, datos: T): void {
    if (!clave || typeof localStorage === 'undefined') {
      return;
    }
    try {
      const envelope: FormDraftEnvelope<T> = {
        v: 1,
        key: clave,
        updatedAt: new Date().toISOString(),
        datos
      };
      localStorage.setItem(this.storageKey(clave), JSON.stringify(envelope));
    } catch (err) {
      console.warn('[FormDraft] No se pudo guardar borrador local:', err);
    }
  }

  leer<T = unknown>(clave: string): FormDraftEnvelope<T> | null {
    if (!clave || typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(this.storageKey(clave));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as FormDraftEnvelope<T>;
      if (!parsed || parsed.v !== 1 || parsed.datos == null) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  limpiar(clave: string): void {
    if (!clave || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.removeItem(this.storageKey(clave));
    } catch {
      /* ignore */
    }
  }

  private storageKey(clave: string): string {
    return `${PREFIX}:${clave}`;
  }
}
