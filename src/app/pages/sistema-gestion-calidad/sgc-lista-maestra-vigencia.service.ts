import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';

/**
 * Vigencia desde SGC-F-01: los no vigentes se ocultan en Centro SGC
 * y en la lista maestra (salvo superadmin, que puede gestionarlos).
 * Siguen en Formatos / BD / Drive.
 */
@Injectable({ providedIn: 'root' })
export class SgcListaMaestraVigenciaService {
  private readonly noVigentes$ = new BehaviorSubject<Set<string>>(new Set());
  private cargando = false;
  private ultimaCarga = 0;

  constructor(private backend: BackendServices) {}

  get codigosNoVigentes(): Set<string> {
    return this.noVigentes$.value;
  }

  watchNoVigentes(): Observable<Set<string>> {
    return this.noVigentes$.asObservable();
  }

  /** Visible en Centro SGC (capítulos / plantillas interactivas). */
  esVisibleEnCentro(codigo: string): boolean {
    const c = String(codigo || '').trim().toUpperCase();
    if (!c) return true;
    return !this.noVigentes$.value.has(c);
  }

  filtrarPlantillasCentro<T extends { codigo?: string }>(plantillas: T[]): T[] {
    return (plantillas || []).filter((p) => this.esVisibleEnCentro(p.codigo || ''));
  }

  refrescar(forzar = false): Observable<string[]> {
    const ahora = Date.now();
    if (!forzar && this.cargando) {
      return of([...this.noVigentes$.value]);
    }
    if (!forzar && this.ultimaCarga && ahora - this.ultimaCarga < 15000) {
      return of([...this.noVigentes$.value]);
    }
    this.cargando = true;
    return this.backend.listarCodigosNoVigentesSgcF01().pipe(
      map((res: any) => {
        const lista = Array.isArray(res?.codigos)
          ? res.codigos
          : Array.isArray(res?.datos?.codigos)
            ? res.datos.codigos
            : [];
        return lista
          .map((c: unknown) => String(c || '').trim().toUpperCase())
          .filter(Boolean);
      }),
      tap((codigos) => {
        this.noVigentes$.next(new Set(codigos));
        this.ultimaCarga = Date.now();
        this.cargando = false;
      }),
      catchError(() => {
        this.cargando = false;
        return of([...this.noVigentes$.value]);
      })
    );
  }

  /** Actualiza cache local tras editar en F-01 (sin esperar GET). */
  aplicarEstadoLocal(codigo: string, vigente: boolean): void {
    const c = String(codigo || '').trim().toUpperCase();
    if (!c) return;
    const next = new Set(this.noVigentes$.value);
    if (vigente === false) {
      next.add(c);
    } else {
      next.delete(c);
    }
    this.noVigentes$.next(next);
  }
}
