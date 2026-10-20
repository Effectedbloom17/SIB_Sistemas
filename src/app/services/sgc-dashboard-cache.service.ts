import { Injectable } from '@angular/core';
import { Observable, of, Subject, Subscriber } from 'rxjs';
import { shareReplay, finalize } from 'rxjs/operators';
import { BackendServices } from './backend.services';
import { AuthService } from './auth.service';

interface CacheEntry {
  anio: number;
  payload: any;
  ts: number;
  /** true mientras faltan los bloques de Google Forms. */
  parcial?: boolean;
}

/**
 * Cache + prefetch del dashboard Centro SGC.
 * Carga en 2 fases: core (BD, rápido) → encuestas (Google Forms).
 * Así KPIs y gráficas locales aparecen de inmediato.
 */
@Injectable({ providedIn: 'root' })
export class SgcDashboardCacheService {
  private static readonly TTL_MS = 5 * 60 * 1000;
  private static readonly STALE_MS = 30 * 60 * 1000;
  private cache: CacheEntry | null = null;
  private inflight: Observable<any> | null = null;
  private inflightAnio: number | null = null;
  private prefetchProgramado = false;

  readonly actualizado$ = new Subject<CacheEntry>();

  constructor(
    private backend: BackendServices,
    private auth: AuthService
  ) {}

  get anioActual(): number {
    return new Date().getFullYear();
  }

  /** Snapshot síncrono si el cache sigue usable (fresco o stale). */
  peek(anio?: number, permitirStale = true): any | null {
    const y = anio || this.anioActual;
    if (!this.cache || this.cache.anio !== y) {
      return null;
    }
    const age = Date.now() - this.cache.ts;
    if (age <= SgcDashboardCacheService.TTL_MS) {
      return this.cache.payload;
    }
    if (permitirStale && age <= SgcDashboardCacheService.STALE_MS && !this.cache.parcial) {
      return this.cache.payload;
    }
    return null;
  }

  /** Indica si hay una petición en curso para ese año. */
  estaCargando(anio?: number): boolean {
    const y = anio || this.anioActual;
    return !!this.inflight && this.inflightAnio === y;
  }

  /**
   * Obtiene el dashboard: cache → in-flight → red en 2 fases (core + encuestas).
   * Emite al menos una vez con el core; una segunda vez al fusionar encuestas.
   * @param refrescar fuerza red y reemplaza cache (también en backend)
   * @param opts.ignorarCacheLocal salta el peek local (soft refresh / SWR backend)
   */
  obtener(
    anio?: number,
    refrescar = false,
    opts: { ignorarCacheLocal?: boolean } = {}
  ): Observable<any> {
    const y = anio || this.anioActual;

    if (!refrescar && !opts.ignorarCacheLocal) {
      const cached = this.peek(y, true);
      if (cached?.success && !cached.parcial) {
        return of(cached);
      }
      if (this.inflight && this.inflightAnio === y) {
        return this.inflight;
      }
    }

    if (this.inflight && this.inflightAnio === y && !refrescar) {
      return this.inflight;
    }

    this.inflightAnio = y;
    const softSwr = !!opts.ignorarCacheLocal && !refrescar;
    this.inflight = new Observable<any>((subscriber) => {
      if (softSwr) {
        // Renovación en fondo: un solo request aprovecha SWR del backend.
        this.cargarCompleto(y, false, subscriber);
      } else {
        this.cargarEnDosFases(y, refrescar, subscriber);
      }
    }).pipe(
      finalize(() => {
        this.inflight = null;
        this.inflightAnio = null;
      }),
      shareReplay(1)
    );

    return this.inflight;
  }

  private guardarYEmitir(
    y: number,
    payload: any,
    subscriber: Subscriber<any>
  ): void {
    if (!payload?.success) {
      return;
    }
    const normalizado = {
      ...payload,
      parcial: !!payload.parcial,
      success: true
    };
    this.cache = {
      anio: y,
      payload: normalizado,
      ts: Date.now(),
      parcial: !!normalizado.parcial
    };
    this.actualizado$.next(this.cache);
    subscriber.next(normalizado);
  }

  /** Request único (modo completo) — ideal con caché SWR del backend. */
  private cargarCompleto(
    y: number,
    refrescar: boolean,
    subscriber: Subscriber<any>
  ): void {
    this.backend.obtenerDashboardSgc(y, refrescar, 'completo').subscribe({
      next: (full) => {
        this.guardarYEmitir(y, { ...full, parcial: false, fase: 'completo' }, subscriber);
        subscriber.complete();
      },
      error: (err) => {
        if (this.cache?.anio === y) {
          subscriber.next(this.cache.payload);
          subscriber.complete();
          return;
        }
        subscriber.error(err);
      }
    });
  }

  private cargarEnDosFases(
    y: number,
    refrescar: boolean,
    subscriber: Subscriber<any>
  ): void {
    this.backend.obtenerDashboardSgc(y, refrescar, 'core').subscribe({
      next: (coreRes) => {
        if (!coreRes?.success) {
          this.cargarCompleto(y, refrescar, subscriber);
          return;
        }

        // Backend puede devolver el dashboard completo desde caché SWR.
        const yaCompleto = coreRes.fase === 'completo'
          || coreRes.parcial === false
          || !!coreRes.satisfaccionCapacitacion
          || (Array.isArray(coreRes.satisfaccionCiclos) && coreRes.satisfaccionCiclos.length > 0);

        if (yaCompleto) {
          this.guardarYEmitir(
            y,
            { ...coreRes, success: true, parcial: false, fase: 'completo' },
            subscriber
          );
          subscriber.complete();
          return;
        }

        const corePayload = {
          ...coreRes,
          success: true,
          parcial: true,
          fase: 'core'
        };
        this.guardarYEmitir(y, corePayload, subscriber);

        this.backend.obtenerDashboardSgc(y, refrescar, 'encuestas').subscribe({
          next: (encRes) => {
            const completo = this.fusionarEncuestas(corePayload, encRes);
            this.guardarYEmitir(y, completo, subscriber);
            subscriber.complete();
          },
          error: () => {
            // Core ya visible; no fallar toda la pantalla por Forms.
            this.guardarYEmitir(
              y,
              { ...corePayload, parcial: false, encuestasError: true },
              subscriber
            );
            subscriber.complete();
          }
        });
      },
      error: (err) => {
        if (this.cache?.anio === y) {
          subscriber.next(this.cache.payload);
          subscriber.complete();
          return;
        }
        this.cargarCompleto(y, refrescar, subscriber);
      }
    });
  }

  private fusionarEncuestas(core: any, encuestas: any): any {
    if (!encuestas?.success && !encuestas?.satisfaccionCapacitacion && !encuestas?.satisfaccionCiclos) {
      return { ...core, parcial: false, fase: 'completo' };
    }
    return {
      ...core,
      satisfaccionCapacitacion: encuestas.satisfaccionCapacitacion ?? core.satisfaccionCapacitacion,
      satisfaccionCurso: encuestas.satisfaccionCurso ?? core.satisfaccionCurso,
      satisfaccionCiclos: encuestas.satisfaccionCiclos ?? core.satisfaccionCiclos ?? [],
      satisfaccion: encuestas.satisfaccion ?? encuestas.satisfaccionCurso ?? core.satisfaccion,
      parcial: false,
      fase: 'completo',
      success: true
    };
  }

  /** Invalida cache (tras guardar histórico, etc.). */
  invalidar(anio?: number): void {
    if (!anio || this.cache?.anio === anio) {
      this.cache = null;
    }
  }

  /**
   * Prefetch temprano tras login / layout admin.
   * Usa modo completo para calentar caché backend (SWR) y local.
   */
  prefetchEnSegundoPlano(anio?: number): void {
    if (this.prefetchProgramado) {
      return;
    }
    if (!this.puedeAccederSgc()) {
      return;
    }
    const y = anio || this.anioActual;
    const cached = this.peek(y, true);
    if ((cached && !cached.parcial) || this.estaCargando(y)) {
      return;
    }

    this.prefetchProgramado = true;
    const lanzar = () => {
      this.prefetchProgramado = false;
      if (!this.puedeAccederSgc()) {
        return;
      }
      if (this.estaCargando(y)) {
        return;
      }
      const actual = this.peek(y, true);
      if (actual && !actual.parcial) {
        return;
      }
      // Completo: llena caché del servidor para la siguiente visita instantánea.
      this.backend.obtenerDashboardSgc(y, false, 'completo').subscribe({
        next: (res) => {
          if (!res?.success) return;
          const payload = { ...res, success: true, parcial: false, fase: 'completo' };
          this.cache = { anio: y, payload, ts: Date.now(), parcial: false };
          this.actualizado$.next(this.cache);
        },
        error: () => { /* silencioso */ }
      });
    };

    // Arranque casi inmediato (antes se esperaba idle ~4s).
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === 'function') {
      ric(lanzar, { timeout: 800 });
    } else {
      window.setTimeout(lanzar, 400);
    }
  }

  private puedeAccederSgc(): boolean {
    if (!this.auth.isLoggedIn()) {
      return false;
    }
    const roles = (this.auth.getRoles() || []).map((r) => String(r).toLowerCase());
    const principal = String(this.auth.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      return true;
    }
    if (roles.includes('sgc') || roles.includes('root') || roles.includes('administrador')) {
      return true;
    }
    return this.auth.esEditorSgcDelegado();
  }
}
