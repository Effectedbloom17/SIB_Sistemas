import { Injectable } from '@angular/core';
import { Observable, of, Subject } from 'rxjs';
import { shareReplay, tap, catchError, finalize } from 'rxjs/operators';
import { BackendServices } from './backend.services';
import { AuthService } from './auth.service';

interface CacheEntry {
  anio: number;
  payload: any;
  ts: number;
}

/**
 * Cache + prefetch del dashboard Centro SGC.
 * Permite precargar en segundo plano (p. ej. al entrar al layout admin)
 * para que al abrir /sistema-gestion-calidad los gráficos ya tengan datos.
 */
@Injectable({ providedIn: 'root' })
export class SgcDashboardCacheService {
  private static readonly TTL_MS = 3 * 60 * 1000;
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

  /** Snapshot síncrono si el cache sigue vigente. */
  peek(anio?: number): any | null {
    const y = anio || this.anioActual;
    if (!this.cache || this.cache.anio !== y) {
      return null;
    }
    if ((Date.now() - this.cache.ts) > SgcDashboardCacheService.TTL_MS) {
      return null;
    }
    return this.cache.payload;
  }

  /** Indica si hay una petición en curso para ese año. */
  estaCargando(anio?: number): boolean {
    const y = anio || this.anioActual;
    return !!this.inflight && this.inflightAnio === y;
  }

  /**
   * Obtiene el dashboard: cache fresco → in-flight → red.
   * @param refrescar fuerza red y reemplaza cache
   */
  obtener(anio?: number, refrescar = false): Observable<any> {
    const y = anio || this.anioActual;

    if (!refrescar) {
      const cached = this.peek(y);
      if (cached) {
        return of(cached);
      }
      if (this.inflight && this.inflightAnio === y) {
        return this.inflight;
      }
    }

    this.inflightAnio = y;
    this.inflight = this.backend.obtenerDashboardSgc(y, refrescar).pipe(
      tap((res) => {
        if (res?.success) {
          this.cache = { anio: y, payload: res, ts: Date.now() };
          this.actualizado$.next(this.cache);
        }
      }),
      catchError((err) => {
        // Si falla el refresh pero hay cache viejo del mismo año, úsalo.
        if (this.cache?.anio === y) {
          return of(this.cache.payload);
        }
        throw err;
      }),
      finalize(() => {
        this.inflight = null;
        this.inflightAnio = null;
      }),
      shareReplay(1)
    );

    return this.inflight;
  }

  /** Invalida cache (tras guardar histórico, etc.). */
  invalidar(anio?: number): void {
    if (!anio || this.cache?.anio === anio) {
      this.cache = null;
    }
  }

  /**
   * Prefetch en idle tras login / layout admin.
   * No bloquea la UI; se ejecuta con requestIdleCallback o setTimeout.
   */
  prefetchEnSegundoPlano(anio?: number): void {
    if (this.prefetchProgramado) {
      return;
    }
    if (!this.puedeAccederSgc()) {
      return;
    }
    const y = anio || this.anioActual;
    if (this.peek(y) || this.estaCargando(y)) {
      return;
    }

    this.prefetchProgramado = true;
    const lanzar = () => {
      this.prefetchProgramado = false;
      if (!this.puedeAccederSgc()) {
        return;
      }
      if (this.peek(y) || this.estaCargando(y)) {
        return;
      }
      this.obtener(y, false).subscribe({
        next: () => { /* cache lista */ },
        error: () => { /* silencioso */ }
      });
    };

    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === 'function') {
      ric(lanzar, { timeout: 4000 });
    } else {
      window.setTimeout(lanzar, 1800);
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
