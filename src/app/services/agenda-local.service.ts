import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

export interface AgendaEstatusLocal {
  id?: number | null;
  clientUuid: string;
  clave: string;
  etiqueta: string;
  color: string;
  orden: number;
  esFinal: boolean;
  eliminado?: boolean;
  updatedAtMs: number;
}

export interface AgendaActividadLocal {
  id?: number | null;
  clientUuid: string;
  titulo: string;
  descripcion: string;
  estatusClave: string;
  prioridad: 'alta' | 'normal' | 'baja';
  fechaLimite: string | null;
  orden: number;
  eliminado?: boolean;
  updatedAtMs: number;
}

interface AgendaCache {
  actividades: AgendaActividadLocal[];
  estatus: AgendaEstatusLocal[];
  lastSyncAt: number | null;
}

const ESTATUS_DEFAULT: Omit<AgendaEstatusLocal, 'clientUuid' | 'updatedAtMs'>[] = [
  { clave: 'pendiente', etiqueta: 'Pendiente', color: '#64748B', orden: 10, esFinal: false },
  { clave: 'en_proceso', etiqueta: 'En proceso', color: '#2D5BFF', orden: 20, esFinal: false },
  { clave: 'pendiente_revision', etiqueta: 'Pendiente de revisión', color: '#F59E0B', orden: 30, esFinal: false },
  { clave: 'pendiente_correo', etiqueta: 'Pendiente de respuesta de correo', color: '#8B5CF6', orden: 40, esFinal: false },
  { clave: 'pendiente_cliente', etiqueta: 'Esperando cliente', color: '#06B6D4', orden: 50, esFinal: false },
  { clave: 'pospuesto', etiqueta: 'Pospuesto', color: '#94A3B8', orden: 60, esFinal: false },
  { clave: 'completado', etiqueta: 'Completado', color: '#10B981', orden: 70, esFinal: true },
  { clave: 'no_completado', etiqueta: 'No completado', color: '#EF4444', orden: 80, esFinal: true }
];

@Injectable({ providedIn: 'root' })
export class AgendaLocalService {
  private static readonly PREFIX = 'biznaga.agenda.v1:';

  constructor(private auth: AuthService) {}

  nuevoUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  ahoraMs(): number {
    return Date.now();
  }

  private storageKey(): string | null {
    const uid = this.auth.getUsuarioId() ?? this.auth.getUsuario()?.id ?? this.auth.getUsuario()?.usuario_id;
    if (uid == null) return null;
    return `${AgendaLocalService.PREFIX}${uid}`;
  }

  leer(): AgendaCache {
    const key = this.storageKey();
    if (!key || typeof localStorage === 'undefined') {
      return this.cacheVacio();
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        const cache = this.cacheVacioConDefaults();
        this.guardar(cache);
        return cache;
      }
      const parsed = JSON.parse(raw);
      const actividades = Array.isArray(parsed?.actividades) ? parsed.actividades : [];
      let estatus = Array.isArray(parsed?.estatus) ? parsed.estatus : [];
      let persistir = false;
      if (!estatus.length) {
        estatus = this.estatusDefault();
        persistir = true;
      }
      const cache: AgendaCache = {
        actividades,
        estatus,
        lastSyncAt: parsed?.lastSyncAt ?? null
      };
      if (persistir) this.guardar(cache);
      return cache;
    } catch {
      const cache = this.cacheVacioConDefaults();
      this.guardar(cache);
      return cache;
    }
  }

  guardar(cache: AgendaCache): void {
    const key = this.storageKey();
    if (!key || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify({
        actividades: cache.actividades || [],
        estatus: cache.estatus || [],
        lastSyncAt: cache.lastSyncAt ?? null
      }));
    } catch (e) {
      console.warn('[agenda] No se pudo guardar en localStorage:', e);
    }
  }

  /**
   * Tras un sync exitoso, la BD es la fuente de verdad.
   * Conservamos en local solo filas activas del servidor (+ eliminados marcados
   * por UUID para no resucitarlas en el próximo push).
   */
  aplicarSnapshotServidor(payload: {
    actividades?: AgendaActividadLocal[];
    estatus?: AgendaEstatusLocal[];
    eliminados?: { actividades?: string[]; estatus?: string[] };
    serverTimeMs?: number;
  }): AgendaCache {
    const serverMs = payload.serverTimeMs || Date.now();
    const acts = (payload.actividades || [])
      .filter((a) => a?.clientUuid && !a.eliminado)
      .map((a) => ({ ...a, eliminado: false }));
    for (const uuid of payload.eliminados?.actividades || []) {
      if (!uuid || acts.some((a) => a.clientUuid === uuid)) continue;
      acts.push({
        clientUuid: uuid,
        titulo: '(eliminado)',
        descripcion: '',
        estatusClave: 'pendiente',
        prioridad: 'normal',
        fechaLimite: null,
        orden: 0,
        eliminado: true,
        updatedAtMs: serverMs
      });
    }

    const ests = (payload.estatus || [])
      .filter((e) => e?.clientUuid && !e.eliminado)
      .map((e) => ({ ...e, eliminado: false }));
    // Evitar claves duplicadas si el servidor devolviera rarezas
    const porClave = new Map<string, AgendaEstatusLocal>();
    for (const e of ests) {
      const prev = porClave.get(e.clave);
      if (!prev || (e.updatedAtMs || 0) >= (prev.updatedAtMs || 0)) {
        porClave.set(e.clave, e);
      }
    }
    const estatusUnicos = Array.from(porClave.values());
    for (const uuid of payload.eliminados?.estatus || []) {
      if (!uuid || estatusUnicos.some((e) => e.clientUuid === uuid)) continue;
      estatusUnicos.push({
        clientUuid: uuid,
        clave: `eliminado_${uuid.slice(0, 8)}`,
        etiqueta: 'Eliminado',
        color: '#64748B',
        orden: 9999,
        esFinal: false,
        eliminado: true,
        updatedAtMs: serverMs
      });
    }

    const cache: AgendaCache = {
      actividades: acts,
      estatus: estatusUnicos,
      lastSyncAt: serverMs
    };
    this.guardar(cache);
    return cache;
  }

  payloadParaSync(cache?: AgendaCache): { actividades: AgendaActividadLocal[]; estatus: AgendaEstatusLocal[] } {
    const c = cache || this.leer();
    return {
      actividades: (c.actividades || []).map((a) => ({ ...a })),
      estatus: (c.estatus || []).map((e) => ({ ...e }))
    };
  }

  actividadesActivas(cache?: AgendaCache): AgendaActividadLocal[] {
    const c = cache || this.leer();
    return (c.actividades || [])
      .filter((a) => !a.eliminado)
      .sort((a, b) => (a.orden - b.orden) || (b.updatedAtMs - a.updatedAtMs));
  }

  estatusActivos(cache?: AgendaCache): AgendaEstatusLocal[] {
    const c = cache || this.leer();
    return (c.estatus || [])
      .filter((e) => !e.eliminado)
      .sort((a, b) => (a.orden - b.orden) || a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }

  private cacheVacio(): AgendaCache {
    return { actividades: [], estatus: [], lastSyncAt: null };
  }

  private cacheVacioConDefaults(): AgendaCache {
    return { actividades: [], estatus: this.estatusDefault(), lastSyncAt: null };
  }

  private estatusDefault(): AgendaEstatusLocal[] {
    const ms = this.ahoraMs();
    return ESTATUS_DEFAULT.map((e, i) => ({
      ...e,
      clientUuid: this.nuevoUuid(),
      updatedAtMs: ms + i
    }));
  }
}
