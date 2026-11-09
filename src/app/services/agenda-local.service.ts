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

export interface AgendaPaginaLocal {
  id?: number | null;
  clientUuid: string;
  titulo: string;
  observaciones: string;
  orden: number;
  eliminado?: boolean;
  updatedAtMs: number;
}

export interface AgendaActividadLocal {
  id?: number | null;
  clientUuid: string;
  paginaUuid: string | null;
  titulo: string;
  descripcion: string;
  estatusClave: string;
  prioridad: 'alta' | 'normal' | 'baja';
  fechaLimite: string | null;
  posX: number;
  posY: number;
  ancho: number;
  /** ID del diagrama en Comunicación → Diagramas (draw.io). */
  diagramaId: number | null;
  orden: number;
  eliminado?: boolean;
  updatedAtMs: number;
}

interface AgendaCache {
  actividades: AgendaActividadLocal[];
  estatus: AgendaEstatusLocal[];
  paginas: AgendaPaginaLocal[];
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
  private static readonly PREFIX = 'biznaga.agenda.v2:';

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
      let estatus = Array.isArray(parsed?.estatus) ? parsed.estatus : [];
      let paginas = (Array.isArray(parsed?.paginas) ? parsed.paginas : []).map((p: any) => this.normalizarPagina(p));
      let actividades = (Array.isArray(parsed?.actividades) ? parsed.actividades : []).map((a: any) => this.normalizarActividad(a));
      let persistir = false;
      if (!estatus.length) {
        estatus = this.estatusDefault();
        persistir = true;
      }
      if (!paginas.length) {
        const legado = typeof parsed?.observaciones?.texto === 'string' ? parsed.observaciones.texto : '';
        paginas = this.paginaDefault(legado);
        persistir = true;
      }
      const paginaUuid = paginas.find((p: AgendaPaginaLocal) => !p.eliminado)?.clientUuid || null;
      actividades = actividades.map((a: AgendaActividadLocal) => ({
        ...a,
        paginaUuid: a.paginaUuid || paginaUuid
      }));
      const cache: AgendaCache = {
        actividades,
        estatus,
        paginas,
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
        paginas: cache.paginas || [],
        lastSyncAt: cache.lastSyncAt ?? null
      }));
    } catch (e) {
      console.warn('[agenda] No se pudo guardar en localStorage:', e);
    }
  }

  aplicarSnapshotServidor(payload: {
    actividades?: AgendaActividadLocal[];
    estatus?: AgendaEstatusLocal[];
    paginas?: AgendaPaginaLocal[];
    archivados?: {
      actividades?: AgendaActividadLocal[];
      estatus?: AgendaEstatusLocal[];
      paginas?: AgendaPaginaLocal[];
    };
    eliminados?: { actividades?: string[]; estatus?: string[]; paginas?: string[] };
    serverTimeMs?: number;
  }): AgendaCache {
    const local = this.leer();
    const serverMs = payload.serverTimeMs || Date.now();
    const localActs = new Map((local.actividades || []).map((a) => [a.clientUuid, a]));
    const localPags = new Map((local.paginas || []).map((p) => [p.clientUuid, p]));
    const localEsts = new Map((local.estatus || []).map((e) => [e.clientUuid, e]));

    const actsMap = new Map<string, AgendaActividadLocal>();
    for (const a of payload.actividades || []) {
      if (!a?.clientUuid) continue;
      actsMap.set(a.clientUuid, this.normalizarActividad({ ...a, eliminado: false }));
    }
    for (const a of payload.archivados?.actividades || []) {
      if (!a?.clientUuid || actsMap.has(a.clientUuid)) continue;
      const prev = localActs.get(a.clientUuid);
      // Preferir datos locales más ricos si el servidor solo mandó uuid legacy
      const base = prev && prev.titulo && !a.titulo ? { ...a, titulo: prev.titulo, descripcion: prev.descripcion || a.descripcion } : a;
      actsMap.set(a.clientUuid, this.normalizarActividad({ ...base, eliminado: true }));
    }
    for (const uuid of payload.eliminados?.actividades || []) {
      if (!uuid || actsMap.has(uuid)) continue;
      const prev = localActs.get(uuid);
      actsMap.set(uuid, this.normalizarActividad({
        ...(prev || {}),
        clientUuid: uuid,
        eliminado: true,
        updatedAtMs: Math.max(prev?.updatedAtMs || 0, serverMs)
      }));
    }

    const estsMap = new Map<string, AgendaEstatusLocal>();
    for (const e of payload.estatus || []) {
      if (!e?.clientUuid) continue;
      estsMap.set(e.clientUuid, { ...e, eliminado: false });
    }
    for (const e of payload.archivados?.estatus || []) {
      if (!e?.clientUuid || estsMap.has(e.clientUuid)) continue;
      estsMap.set(e.clientUuid, { ...e, eliminado: true });
    }
    for (const uuid of payload.eliminados?.estatus || []) {
      if (!uuid || estsMap.has(uuid)) continue;
      const prev = localEsts.get(uuid);
      if (prev) estsMap.set(uuid, { ...prev, eliminado: true, updatedAtMs: Math.max(prev.updatedAtMs || 0, serverMs) });
    }
    const porClave = new Map<string, AgendaEstatusLocal>();
    for (const e of estsMap.values()) {
      if (e.eliminado) continue;
      const prev = porClave.get(e.clave);
      if (!prev || (e.updatedAtMs || 0) >= (prev.updatedAtMs || 0)) porClave.set(e.clave, e);
    }
    const estatusActivos = Array.from(porClave.values());
    const estatusArch = Array.from(estsMap.values()).filter((e) => e.eliminado);
    const estatusUnicos = [...estatusActivos, ...estatusArch];

    const pagsMap = new Map<string, AgendaPaginaLocal>();
    for (const p of payload.paginas || []) {
      if (!p?.clientUuid) continue;
      const prev = localPags.get(p.clientUuid);
      if (prev && (prev.updatedAtMs || 0) > (p.updatedAtMs || 0)) {
        pagsMap.set(p.clientUuid, this.normalizarPagina({ ...prev, eliminado: false }));
      } else {
        pagsMap.set(p.clientUuid, this.normalizarPagina({ ...p, eliminado: false }));
      }
    }
    for (const p of payload.archivados?.paginas || []) {
      if (!p?.clientUuid || pagsMap.has(p.clientUuid)) continue;
      const prev = localPags.get(p.clientUuid);
      const base = prev && (!p.observaciones && prev.observaciones) ? { ...p, observaciones: prev.observaciones, titulo: p.titulo || prev.titulo } : p;
      pagsMap.set(p.clientUuid, this.normalizarPagina({ ...base, eliminado: true }));
    }
    for (const uuid of payload.eliminados?.paginas || []) {
      if (!uuid || pagsMap.has(uuid)) continue;
      const prev = localPags.get(uuid);
      pagsMap.set(uuid, this.normalizarPagina({
        ...(prev || { titulo: 'Hoja', observaciones: '', orden: 0 }),
        clientUuid: uuid,
        eliminado: true,
        updatedAtMs: Math.max(prev?.updatedAtMs || 0, serverMs)
      }));
    }
    let pags = Array.from(pagsMap.values());
    if (!pags.some((p) => !p.eliminado)) {
      pags = [...pags, ...this.paginaDefault()];
    }

    const cache: AgendaCache = {
      actividades: Array.from(actsMap.values()),
      estatus: estatusUnicos.length ? estatusUnicos : this.estatusDefault(),
      paginas: pags,
      lastSyncAt: serverMs
    };
    this.guardar(cache);
    return cache;
  }

  payloadParaSync(cache?: AgendaCache) {
    const c = cache || this.leer();
    return {
      actividades: (c.actividades || []).map((a) => ({ ...a })),
      estatus: (c.estatus || []).map((e) => ({ ...e })),
      paginas: (c.paginas || []).map((p) => ({ ...p }))
    };
  }

  actividadesActivas(cache?: AgendaCache): AgendaActividadLocal[] {
    const c = cache || this.leer();
    return (c.actividades || []).filter((a) => !a.eliminado);
  }

  actividadesArchivadas(cache?: AgendaCache): AgendaActividadLocal[] {
    const c = cache || this.leer();
    return (c.actividades || [])
      .filter((a) => !!a.eliminado)
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  paginasActivas(cache?: AgendaCache): AgendaPaginaLocal[] {
    const c = cache || this.leer();
    return (c.paginas || [])
      .filter((p) => !p.eliminado)
      .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo, 'es'));
  }

  paginasArchivadas(cache?: AgendaCache): AgendaPaginaLocal[] {
    const c = cache || this.leer();
    return (c.paginas || [])
      .filter((p) => !!p.eliminado)
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  estatusActivos(cache?: AgendaCache): AgendaEstatusLocal[] {
    const c = cache || this.leer();
    return (c.estatus || [])
      .filter((e) => !e.eliminado)
      .sort((a, b) => (a.orden - b.orden) || a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }

  private normalizarActividad(a: any): AgendaActividadLocal {
    return {
      id: a?.id ?? null,
      clientUuid: a?.clientUuid || this.nuevoUuid(),
      paginaUuid: a?.paginaUuid || a?.pagina_uuid || null,
      titulo: a?.titulo || '',
      descripcion: a?.descripcion || '',
      estatusClave: a?.estatusClave || a?.estatus_clave || 'pendiente',
      prioridad: a?.prioridad || 'normal',
      fechaLimite: a?.fechaLimite || null,
      posX: Number.isFinite(Number(a?.posX ?? a?.pos_x)) ? Number(a?.posX ?? a?.pos_x) : 40,
      posY: Number.isFinite(Number(a?.posY ?? a?.pos_y)) ? Number(a?.posY ?? a?.pos_y) : 40,
      ancho: Number.isFinite(Number(a?.ancho)) ? Number(a.ancho) : 320,
      diagramaId: (() => {
        const n = Number(a?.diagramaId ?? a?.diagrama_id);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(),
      orden: Number(a?.orden) || 0,
      eliminado: !!a?.eliminado,
      updatedAtMs: Number(a?.updatedAtMs) || Date.now()
    };
  }

  private cacheVacio(): AgendaCache {
    return {
      actividades: [],
      estatus: [],
      paginas: [],
      lastSyncAt: null
    };
  }

  private cacheVacioConDefaults(): AgendaCache {
    return {
      actividades: [],
      estatus: this.estatusDefault(),
      paginas: this.paginaDefault(),
      lastSyncAt: null
    };
  }

  private estatusDefault(): AgendaEstatusLocal[] {
    const ms = this.ahoraMs();
    return ESTATUS_DEFAULT.map((e, i) => ({
      ...e,
      clientUuid: this.nuevoUuid(),
      updatedAtMs: ms + i
    }));
  }

  private paginaDefault(observaciones = ''): AgendaPaginaLocal[] {
    return [{
      clientUuid: this.nuevoUuid(),
      titulo: 'Hoja 1',
      observaciones: observaciones || '',
      orden: 10,
      eliminado: false,
      updatedAtMs: this.ahoraMs()
    }];
  }

  private normalizarPagina(p: any): AgendaPaginaLocal {
    return {
      id: p?.id ?? null,
      clientUuid: p?.clientUuid || this.nuevoUuid(),
      titulo: p?.titulo || 'Hoja',
      observaciones: typeof p?.observaciones === 'string' ? p.observaciones : '',
      orden: Number(p?.orden) || 0,
      eliminado: !!p?.eliminado,
      updatedAtMs: Number(p?.updatedAtMs) || Date.now()
    };
  }
}
