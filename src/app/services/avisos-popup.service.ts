import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { BackendServices } from './backend.services';

export type AvisoPopupArea = 'sgc' | 'pc' | 'proyectos';

export interface AvisoPopupItem {
  id: number;
  area: AvisoPopupArea;
  tipo?: string;
  titulo: string;
  resumen: string;
  ruta?: string;
  silenciado?: boolean;
  // Firmas
  solicitudId?: number;
  codigo?: string;
  nombreDocumento?: string;
  solicitadoPor?: string;
  resueltoPor?: string;
  // PC
  resolutivoId?: number;
  empresaId?: number | null;
  nombreEmpresa?: string;
  nombreAsignacion?: string;
  responsableNombre?: string;
  diasRestantes?: number | null;
  // Proyectos
  cambioId?: number;
  folio?: string;
  nombreProyecto?: string;
  estatus?: string;
  mensaje?: string;
}

export const AVISO_AREA_META: Record<AvisoPopupArea, { titulo: string; color: string; orden: number }> = {
  sgc: { titulo: 'SGC', color: '#12ad9d', orden: 1 },
  pc: { titulo: 'Protección Civil', color: '#fb6340', orden: 2 },
  proyectos: { titulo: 'Proyectos', color: '#c2410c', orden: 3 }
};

@Injectable({ providedIn: 'root' })
export class AvisosPopupService {
  /** v5: reenvía PC que se descartaron con «Aceptar todas». */
  private static readonly LOGIN_SYNC_KEY = 'biz_avisos_login_sync_v5';

  private readonly _firma = new BehaviorSubject<AvisoPopupItem[]>([]);
  private readonly _resolutivo = new BehaviorSubject<AvisoPopupItem[]>([]);
  private readonly _cambio = new BehaviorSubject<AvisoPopupItem[]>([]);

  readonly firma$ = this._firma.asObservable();
  readonly resolutivo$ = this._resolutivo.asObservable();
  readonly cambio$ = this._cambio.asObservable();

  /** Evita que un poll pise el estado mientras sale la animación del popup. */
  bloqueoFirma = false;
  bloqueoResolutivo = false;
  bloqueoCambio = false;

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private router: Router
  ) {}

  /** Llamar en logout para que el próximo login reactive/reenvíe avisos. */
  static clearLoginSync(): void {
    try {
      sessionStorage.removeItem(AvisosPopupService.LOGIN_SYNC_KEY);
    } catch {
      // ignore
    }
  }

  get firma(): AvisoPopupItem[] {
    return this._firma.value;
  }

  get resolutivo(): AvisoPopupItem[] {
    return this._resolutivo.value;
  }

  get cambio(): AvisoPopupItem[] {
    return this._cambio.value;
  }

  get firmaPopup(): AvisoPopupItem[] {
    return this.firma.filter((a) => !a.silenciado);
  }

  get resolutivoPopup(): AvisoPopupItem[] {
    return this.resolutivo.filter((a) => !a.silenciado);
  }

  get cambioPopup(): AvisoPopupItem[] {
    return this.cambio.filter((a) => !a.silenciado);
  }

  get todos(): AvisoPopupItem[] {
    return [...this.firma, ...this.resolutivo, ...this.cambio];
  }

  get totalPendientes(): number {
    return this.todos.length;
  }

  /**
   * Al iniciar sesión: reactiva silenciados (Firmas/Proyectos) y reenvía PC vigentes.
   * En la misma sesión del navegador solo refresca (no reenvía en cada poll).
   */
  sincronizarTrasLoginSiNecesario(): void {
    const user = String(this.auth.getUsername() || '').trim().toLowerCase();
    if (!user) {
      this._firma.next([]);
      this._resolutivo.next([]);
      this._cambio.next([]);
      return;
    }

    let yaSync = false;
    try {
      yaSync = sessionStorage.getItem(AvisosPopupService.LOGIN_SYNC_KEY) === user;
    } catch {
      yaSync = false;
    }

    if (yaSync) {
      this.refrescar();
      return;
    }

    forkJoin({
      firma: this.backend.reactivarSilenciadosFirmaSgc().pipe(catchError(() => of({}))),
      cambio: this.backend.reactivarSilenciadosCambioControlProyecto().pipe(catchError(() => of({}))),
      pc: this.backend.reenviarAvisosResolutivosPipc().pipe(catchError(() => of({})))
    }).subscribe({
      next: () => {
        try {
          sessionStorage.setItem(AvisosPopupService.LOGIN_SYNC_KEY, user);
        } catch {
          // ignore
        }
        this.refrescar();
      },
      error: () => this.refrescar()
    });
  }

  refrescar(opciones: { reenviarPc?: boolean } = {}): void {
    if (!this.auth.getUsername()) {
      this._firma.next([]);
      this._resolutivo.next([]);
      this._cambio.next([]);
      return;
    }

    forkJoin({
      firma: this.backend.listarAvisosFirmaSgc('gestor').pipe(
        catchError(() => of(null))
      ),
      resolutivo: this.backend.listarAvisosResolutivosPipc('gestor', !!opciones.reenviarPc).pipe(
        catchError(() => of(null))
      ),
      cambio: this.backend.listarAvisosCambiosControlProyecto('gestor').pipe(
        catchError(() => of(null))
      )
    }).subscribe(({ firma, resolutivo, cambio }) => {
      if (firma && !this.bloqueoFirma) {
        this._firma.next(this.mapFirma(Array.isArray(firma?.avisos) ? firma.avisos : []));
      }
      if (resolutivo && !this.bloqueoResolutivo) {
        this._resolutivo.next(this.mapResolutivo(Array.isArray(resolutivo?.avisos) ? resolutivo.avisos : []));
      }
      if (cambio && !this.bloqueoCambio) {
        this._cambio.next(this.mapCambio(Array.isArray(cambio?.avisos) ? cambio.avisos : []));
      }
    });
  }

  silenciar(item: AvisoPopupItem): void {
    this.quitarLocal(item, { silenciar: true });
    this.apiSilenciar(item).subscribe({ error: () => {} });
  }

  descartar(item: AvisoPopupItem): void {
    this.quitarLocal(item, { silenciar: false });
    this.apiDescartar(item).subscribe({ error: () => {} });
  }

  /** Cierra todos los popups de PC; siguen en el gestor hasta atenderlos. */
  silenciarTodosResolutivo(): void {
    this._resolutivo.next(this.resolutivo.map((item) => ({ ...item, silenciado: true })));
    this.backend.silenciarTodosAvisosResolutivosPipc().subscribe({ error: () => {} });
  }

  abrir(item: AvisoPopupItem): void {
    this.descartar(item);
    this.navegar(item);
  }

  navegar(item: AvisoPopupItem): void {
    if (item.area === 'proyectos') {
      if (item.tipo === 'respuesta') {
        this.router.navigate(['/control-proyectos'], {
          queryParams: {
            cambioFolio: item.folio || null,
            cambioEmpresaId: item.empresaId || null,
            cambioId: item.cambioId || null,
            solicitudes: null
          }
        });
        return;
      }
      this.router.navigate(['/control-proyectos'], { queryParams: { solicitudes: 1 } });
      return;
    }
    const ruta = String(item.ruta || (item.area === 'pc' ? '/proteccion-civil' : '/sistema-gestion-calidad/firmas')).trim();
    this.router.navigateByUrl(ruta.startsWith('/') ? ruta : `/${ruta}`);
  }

  private quitarLocal(item: AvisoPopupItem, opts: { silenciar: boolean }): void {
    const patch = (lista: AvisoPopupItem[]) => {
      if (opts.silenciar) {
        return lista.map((a) => (a.id === item.id && a.area === item.area
          ? { ...a, silenciado: true }
          : a));
      }
      return lista.filter((a) => !(a.id === item.id && a.area === item.area));
    };
    if (item.area === 'sgc') this._firma.next(patch(this.firma));
    else if (item.area === 'pc') this._resolutivo.next(patch(this.resolutivo));
    else this._cambio.next(patch(this.cambio));
  }

  private apiSilenciar(item: AvisoPopupItem) {
    if (item.area === 'sgc') return this.backend.silenciarAvisoFirmaSgc(item.id);
    if (item.area === 'pc') return this.backend.silenciarAvisoResolutivoPipc(item.id);
    return this.backend.silenciarAvisoCambioControlProyecto(item.id);
  }

  private apiDescartar(item: AvisoPopupItem) {
    if (item.area === 'sgc') return this.backend.atenderAvisoFirmaSgc(item.id);
    if (item.area === 'pc') return this.backend.atenderAvisoResolutivoPipc(item.id);
    return this.backend.atenderAvisoCambioControlProyecto(item.id);
  }

  private mapFirma(rows: any[]): AvisoPopupItem[] {
    return (rows || []).map((row) => {
      const tipo = String(row.tipo || 'solicitud');
      const titulo = tipo === 'aprobada'
        ? 'Firma aprobada'
        : tipo === 'rechazada'
          ? 'Firma rechazada'
          : 'Firma por autorizar';
      const doc = String(row.nombreDocumento || row.codigo || 'Documento SGC').trim();
      return {
        id: Number(row.id),
        area: 'sgc' as const,
        tipo,
        titulo,
        resumen: doc,
        ruta: row.ruta || '/sistema-gestion-calidad/firmas',
        silenciado: !!row.silenciado,
        solicitudId: Number(row.solicitudId),
        codigo: row.codigo || '',
        nombreDocumento: row.nombreDocumento || '',
        solicitadoPor: row.solicitadoPor || '',
        resueltoPor: row.resueltoPor || '',
        mensaje: row.mensaje || ''
      };
    });
  }

  private mapResolutivo(rows: any[]): AvisoPopupItem[] {
    return (rows || []).map((row) => {
      const dias = row.diasRestantes;
      const tipo = String(row.tipo || 'ventana_diaria');
      let titulo = 'Recordatorio resolutivo PIPC';
      if (tipo === 'urgente_seguimiento') titulo = 'Seguimiento resolutivo PIPC';
      else if (tipo === 'urgente_ingreso' || (dias != null && dias > 0 && dias <= 20)) {
        titulo = 'Resolutivo PIPC por vencer';
      }
      const empresa = String(row.nombreEmpresa || 'Empresa').trim();
      const asignacion = String(row.nombreAsignacion || '').trim();
      return {
        id: Number(row.id),
        area: 'pc' as const,
        tipo,
        titulo,
        resumen: asignacion ? `${empresa} · ${asignacion}` : empresa,
        ruta: row.ruta || '/proteccion-civil',
        silenciado: !!row.silenciado,
        resolutivoId: Number(row.resolutivoId),
        empresaId: row.empresaId == null ? null : Number(row.empresaId),
        nombreEmpresa: row.nombreEmpresa || '',
        nombreAsignacion: row.nombreAsignacion || '',
        responsableNombre: row.responsableNombre || '',
        diasRestantes: dias == null ? null : Number(dias),
        mensaje: row.mensaje || ''
      };
    });
  }

  private mapCambio(rows: any[]): AvisoPopupItem[] {
    return (rows || []).map((row) => {
      const tipo = String(row.tipo || 'revision');
      const titulo = tipo === 'respuesta'
        ? 'Solicitud de cambio atendida'
        : tipo === 'recordatorio_urgente'
          ? 'Cambio: fecha de compromiso cerca'
          : tipo === 'recordatorio'
            ? 'Cambio pendiente de revisión'
            : 'Solicitud de cambio por revisar';
      const proyecto = String(row.nombreProyecto || 'Proyecto').replace(/\s+/g, ' ').trim();
      const folio = String(row.folio || '').trim();
      return {
        id: Number(row.id),
        area: 'proyectos' as const,
        tipo,
        titulo,
        resumen: folio ? `${folio} · ${proyecto}` : proyecto,
        silenciado: !!row.silenciado,
        cambioId: Number(row.cambioId),
        empresaId: row.empresaId == null ? null : Number(row.empresaId),
        folio: row.folio || '',
        nombreProyecto: row.nombreProyecto || '',
        solicitadoPor: row.solicitadoPor || '',
        resueltoPor: row.resueltoPor || '',
        estatus: row.estatus || '',
        mensaje: row.mensaje || ''
      };
    });
  }
}
