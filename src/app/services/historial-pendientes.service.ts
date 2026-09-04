import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, Subject, of } from 'rxjs';

import { catchError, map, tap } from 'rxjs/operators';

import { BackendServices } from './backend.services';

import { AuthService } from './auth.service';



export interface HistorialPendienteItem {

  programado_id: number;

  curso_id: number;

  empresa_id: number;

  nombre_curso: string;

  nombre_empresa: string;

  historial_finalizado_at?: string | null;

  updated_at?: string | null;

}



@Injectable({ providedIn: 'root' })

export class HistorialPendientesService {

  private readonly _items = new BehaviorSubject<HistorialPendienteItem[]>([]);

  private readonly _animIncremento = new Subject<void>();



  readonly items$ = this._items.asObservable();

  readonly count$: Observable<number> = this.items$.pipe(map((items) => items.length));

  readonly animIncremento$ = this._animIncremento.asObservable();



  constructor(

    private backend: BackendServices,

    private auth: AuthService

  ) {}



  get items(): HistorialPendienteItem[] {

    return this._items.value;

  }



  get count(): number {

    return this._items.value.length;

  }



  /** Perfiles con acceso a historial y alertas de cursos finalizados. */
  puedeVerIndicador(): boolean {
    return this.auth.puedeGestionarHistorialPendientes();
  }



  /** Añade de inmediato un curso recién finalizado (antes de que responda el API). */

  registrarPendienteLocal(item: Partial<HistorialPendienteItem>): void {

    if (!this.puedeVerIndicador()) {

      return;

    }

    const programadoId = Number(item?.programado_id || 0);

    if (!programadoId) {

      return;

    }

    const actuales = this._items.value;

    if (actuales.some((i) => Number(i.programado_id) === programadoId)) {

      return;

    }

    const nuevo: HistorialPendienteItem = {

      programado_id: programadoId,

      curso_id: Number(item.curso_id || 0),

      empresa_id: Number(item.empresa_id || 0),

      nombre_curso: String(item.nombre_curso || 'Curso finalizado').trim(),

      nombre_empresa: String(item.nombre_empresa || 'Empresa').trim(),

      historial_finalizado_at: item.historial_finalizado_at || new Date().toISOString(),

      updated_at: item.updated_at || new Date().toISOString()

    };

    this._items.next([nuevo, ...actuales]);

  }



  refrescar(): Observable<HistorialPendienteItem[]> {

    if (!this.puedeVerIndicador()) {

      this._items.next([]);

      return of([]);

    }

    return this.backend.obtenerHistorialPendientes().pipe(

      map((res: any) => (res?.success && Array.isArray(res.items) ? res.items : [])),

      tap((items) => this._items.next(this.fusionarItems(items, this._items.value))),

      catchError(() => of(this._items.value))

    );

  }



  /** Dispara animación +1 en el menú Historial de cursos. */

  dispararAnimacionIncremento(): void {

    if (!this.puedeVerIndicador()) {

      return;

    }

    this._animIncremento.next();

  }



  /** Marca consultado en BD (solo para el admin actual) y quita el ítem local. */

  marcarConsultado(programadoId: number): void {

    const id = Number(programadoId);

    if (!id || !this.puedeVerIndicador()) {

      return;

    }

    const actuales = this._items.value.filter((i) => Number(i.programado_id) !== id);

    this._items.next(actuales);

    this.backend.marcarHistorialConsultado(id).subscribe({

      error: () => {

        this.refrescar().subscribe();

      }

    });

  }



  private fusionarItems(

    servidor: HistorialPendienteItem[],

    locales: HistorialPendienteItem[]

  ): HistorialPendienteItem[] {

    const mapa = new Map<number, HistorialPendienteItem>();

    for (const item of servidor) {

      const id = Number(item?.programado_id || 0);

      if (id > 0) {

        mapa.set(id, item);

      }

    }

    for (const item of locales) {

      const id = Number(item?.programado_id || 0);

      if (id > 0 && !mapa.has(id)) {

        mapa.set(id, item);

      }

    }

    return Array.from(mapa.values()).sort((a, b) => {

      const fa = new Date(a.historial_finalizado_at || a.updated_at || 0).getTime();

      const fb = new Date(b.historial_finalizado_at || b.updated_at || 0).getTime();

      return fb - fa;

    });

  }

}


