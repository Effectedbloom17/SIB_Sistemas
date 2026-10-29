import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { ConnectivityService } from 'src/app/services/connectivity.service';
import {
  AgendaActividadLocal,
  AgendaEstatusLocal,
  AgendaLocalService
} from 'src/app/services/agenda-local.service';

interface ActividadForm {
  titulo: string;
  descripcion: string;
  estatusClave: string;
  prioridad: 'alta' | 'normal' | 'baja';
  fechaLimite: string;
}

interface EstatusForm {
  etiqueta: string;
  color: string;
  esFinal: boolean;
}

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.component.html',
  styleUrls: ['./agenda.component.scss']
})
export class AgendaComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  actividades: AgendaActividadLocal[] = [];
  estatus: AgendaEstatusLocal[] = [];
  filtroEstatus = '';
  busqueda = '';
  cargando = false;
  sincronizando = false;
  online = true;
  pendienteSync = false;
  errorCarga: string | null = null;

  mostrarModalActividad = false;
  editandoUuid: string | null = null;
  form: ActividadForm = this.formVacio();

  mostrarModalEstatus = false;
  editandoEstatusUuid: string | null = null;
  formEstatus: EstatusForm = this.formEstatusVacio();

  constructor(
    private backend: BackendServices,
    private local: AgendaLocalService,
    private connectivity: ConnectivityService
  ) {}

  ngOnInit(): void {
    this.online = this.connectivity.isOnline;
    this.refrescarDesdeLocal();
    this.connectivity.online$
      .pipe(takeUntil(this.destroy$))
      .subscribe((online) => {
        const estabaOffline = !this.online;
        this.online = online;
        if (online && (estabaOffline || this.pendienteSync)) {
          void this.sincronizar();
        }
      });
    void this.sincronizar(true);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get actividadesFiltradas(): AgendaActividadLocal[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.actividades.filter((a) => {
      if (this.filtroEstatus && a.estatusClave !== this.filtroEstatus) return false;
      if (!q) return true;
      return (
        a.titulo.toLowerCase().includes(q)
        || (a.descripcion || '').toLowerCase().includes(q)
        || a.estatusClave.toLowerCase().includes(q)
      );
    });
  }

  get contadores(): { total: number; abiertas: number; finales: number } {
    const finales = new Set(this.estatus.filter((e) => e.esFinal).map((e) => e.clave));
    let abiertas = 0;
    let fin = 0;
    for (const a of this.actividades) {
      if (finales.has(a.estatusClave)) fin += 1;
      else abiertas += 1;
    }
    return { total: this.actividades.length, abiertas, finales: fin };
  }

  etiquetaEstatus(clave: string): string {
    return this.estatus.find((e) => e.clave === clave)?.etiqueta || clave;
  }

  colorEstatus(clave: string): string {
    return this.estatus.find((e) => e.clave === clave)?.color || '#64748B';
  }

  esFinal(clave: string): boolean {
    return !!this.estatus.find((e) => e.clave === clave)?.esFinal;
  }

  refrescarDesdeLocal(): void {
    const cache = this.local.leer();
    this.actividades = this.local.actividadesActivas(cache);
    this.estatus = this.local.estatusActivos(cache);
    this.pendienteSync = !cache.lastSyncAt || this.actividades.some((a) => !a.id);
  }

  async sincronizar(silencioso = false): Promise<void> {
    if (!this.online) {
      this.pendienteSync = true;
      return;
    }
    if (this.sincronizando) return;
    this.sincronizando = true;
    if (!silencioso) this.cargando = true;
    this.errorCarga = null;
    try {
      const cache = this.local.leer();
      const payload = this.local.payloadParaSync(cache);
      const res: any = await firstValueFrom(this.backend.sincronizarAgenda(payload));
      if (res?.success) {
        this.local.aplicarSnapshotServidor(res);
        this.refrescarDesdeLocal();
        this.pendienteSync = false;
      } else {
        throw new Error(res?.message || 'No se pudo sincronizar');
      }
    } catch (err: any) {
      this.errorCarga = err?.error?.message || err?.message || 'Sin conexión con el servidor; se usa copia local.';
      this.pendienteSync = true;
      this.refrescarDesdeLocal();
    } finally {
      this.sincronizando = false;
      this.cargando = false;
    }
  }

  abrirCrear(): void {
    this.editandoUuid = null;
    this.form = this.formVacio();
    if (this.estatus.length) {
      this.form.estatusClave = this.estatus[0].clave;
    }
    this.mostrarModalActividad = true;
  }

  abrirEditar(item: AgendaActividadLocal): void {
    this.editandoUuid = item.clientUuid;
    this.form = {
      titulo: item.titulo,
      descripcion: item.descripcion || '',
      estatusClave: item.estatusClave,
      prioridad: item.prioridad || 'normal',
      fechaLimite: item.fechaLimite || ''
    };
    this.mostrarModalActividad = true;
  }

  cerrarModalActividad(): void {
    this.mostrarModalActividad = false;
    this.editandoUuid = null;
  }

  async guardarActividad(): Promise<void> {
    const titulo = (this.form.titulo || '').trim();
    if (!titulo) {
      await Swal.fire({ icon: 'warning', title: 'Falta el título', text: 'Escribe qué actividad estás gestionando.' });
      return;
    }
    const cache = this.local.leer();
    const ms = this.local.ahoraMs();
    const uuid = this.editandoUuid || this.local.nuevoUuid();
    const existente = (cache.actividades || []).find((a) => a.clientUuid === uuid);
    const item: AgendaActividadLocal = {
      id: existente?.id ?? null,
      clientUuid: uuid,
      titulo: titulo.slice(0, 255),
      descripcion: (this.form.descripcion || '').trim().slice(0, 4000),
      estatusClave: this.form.estatusClave || 'pendiente',
      prioridad: this.form.prioridad || 'normal',
      fechaLimite: this.form.fechaLimite || null,
      orden: existente?.orden ?? ((cache.actividades || []).filter((a) => !a.eliminado).length + 1) * 10,
      eliminado: false,
      updatedAtMs: ms
    };
    const restantes = (cache.actividades || []).filter((a) => a.clientUuid !== uuid);
    restantes.push(item);
    cache.actividades = restantes;
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.cerrarModalActividad();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async cambiarEstatus(item: AgendaActividadLocal, nuevaClave: string): Promise<void> {
    if (!nuevaClave || nuevaClave === item.estatusClave) return;
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === item.clientUuid);
    if (idx < 0) return;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      estatusClave: nuevaClave,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async eliminarActividad(item: AgendaActividadLocal): Promise<void> {
    const conf = await Swal.fire({
      icon: 'question',
      title: '¿Eliminar actividad?',
      text: item.titulo,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!conf.isConfirmed) return;
    const cache = this.local.leer();
    const idx = (cache.actividades || []).findIndex((a) => a.clientUuid === item.clientUuid);
    if (idx < 0) return;
    cache.actividades[idx] = {
      ...cache.actividades[idx],
      eliminado: true,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  abrirGestionEstatus(): void {
    this.editandoEstatusUuid = null;
    this.formEstatus = this.formEstatusVacio();
    this.mostrarModalEstatus = true;
  }

  editarEstatus(e: AgendaEstatusLocal): void {
    this.editandoEstatusUuid = e.clientUuid;
    this.formEstatus = {
      etiqueta: e.etiqueta,
      color: e.color,
      esFinal: !!e.esFinal
    };
    this.mostrarModalEstatus = true;
  }

  cerrarModalEstatus(): void {
    this.mostrarModalEstatus = false;
    this.editandoEstatusUuid = null;
  }

  async guardarEstatus(): Promise<void> {
    const etiqueta = (this.formEstatus.etiqueta || '').trim();
    if (!etiqueta) {
      await Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Ponle un nombre al estatus.' });
      return;
    }
    const cache = this.local.leer();
    const ms = this.local.ahoraMs();
    const uuid = this.editandoEstatusUuid || this.local.nuevoUuid();
    const existente = (cache.estatus || []).find((e) => e.clientUuid === uuid);
    const clave = existente?.clave || this.claveDesdeEtiqueta(etiqueta);
    const item: AgendaEstatusLocal = {
      id: existente?.id ?? null,
      clientUuid: uuid,
      clave,
      etiqueta: etiqueta.slice(0, 100),
      color: this.formEstatus.color || '#64748B',
      orden: existente?.orden ?? ((cache.estatus || []).filter((e) => !e.eliminado).length + 1) * 10,
      esFinal: !!this.formEstatus.esFinal,
      eliminado: false,
      updatedAtMs: ms
    };
    const restantes = (cache.estatus || []).filter((e) => e.clientUuid !== uuid);
    restantes.push(item);
    cache.estatus = restantes;
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.cerrarModalEstatus();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  async eliminarEstatus(e: AgendaEstatusLocal): Promise<void> {
    const enUso = this.actividades.some((a) => a.estatusClave === e.clave);
    if (enUso) {
      await Swal.fire({
        icon: 'info',
        title: 'Estatus en uso',
        text: 'Hay actividades con este estatus. Cámbialas primero o crea otro y reasígnanos.'
      });
      return;
    }
    if (this.estatus.length <= 1) {
      await Swal.fire({ icon: 'info', title: 'No se puede eliminar', text: 'Debes conservar al menos un estatus.' });
      return;
    }
    const conf = await Swal.fire({
      icon: 'question',
      title: '¿Eliminar estatus?',
      text: e.etiqueta,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#EF4444'
    });
    if (!conf.isConfirmed) return;
    const cache = this.local.leer();
    const idx = (cache.estatus || []).findIndex((x) => x.clientUuid === e.clientUuid);
    if (idx < 0) return;
    cache.estatus[idx] = {
      ...cache.estatus[idx],
      eliminado: true,
      updatedAtMs: this.local.ahoraMs()
    };
    this.local.guardar(cache);
    this.refrescarDesdeLocal();
    this.pendienteSync = true;
    await this.intentarSyncRapido();
  }

  private async intentarSyncRapido(): Promise<void> {
    if (!this.online) return;
    await this.sincronizar(true);
  }

  private claveDesdeEtiqueta(etiqueta: string): string {
    const base = etiqueta
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    let clave = base || `estatus_${Date.now()}`;
    const usadas = new Set(this.estatus.map((e) => e.clave));
    if (!usadas.has(clave)) return clave;
    let i = 2;
    while (usadas.has(`${clave}_${i}`)) i += 1;
    return `${clave}_${i}`;
  }

  private formVacio(): ActividadForm {
    return {
      titulo: '',
      descripcion: '',
      estatusClave: 'pendiente',
      prioridad: 'normal',
      fechaLimite: ''
    };
  }

  private formEstatusVacio(): EstatusForm {
    return { etiqueta: '', color: '#2D5BFF', esFinal: false };
  }
}
