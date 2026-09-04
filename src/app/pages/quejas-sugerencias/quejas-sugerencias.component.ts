import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';

export interface OpinionItem {
  opinion_id: number;
  folio: string;
  tipo: 'opinion' | 'sugerencia' | string;
  descripcion: string;
  cliente?: string | null;
  empresa_id?: number | null;
  usuario_id: number;
  estado: 'abierto' | 'en_progreso' | 'cerrado' | string;
  created_at: string;
  updated_at?: string;
  autor_nombre?: string;
  autor_usuario?: string;
}

type FiltroEstado = '' | 'abierto' | 'en_progreso' | 'cerrado';

@Component({
  selector: 'app-quejas-sugerencias',
  templateUrl: './quejas-sugerencias.component.html',
  styleUrls: ['./quejas-sugerencias.component.scss']
})
export class QuejasSugerenciasComponent implements OnInit, OnDestroy {
  opiniones: OpinionItem[] = [];
  cargando = false;
  error: string | null = null;
  filtroEstado: FiltroEstado = '';
  busqueda = '';
  expandidoId: number | null = null;
  actualizandoId: number | null = null;
  paginaActual = 1;
  readonly opinionesPorPagina = 9;
  errorEstado: string | null = null;

  esEmpresa = false;
  puedeConsultar = false;
  empresaNombre = '';

  enviando = false;
  errorEnvio: string | null = null;
  folioGenerado: string | null = null;
  descripcion = '';

  readonly opcionesEstatus: Array<{ valor: 'abierto' | 'en_progreso' | 'cerrado'; label: string }> = [
    { valor: 'abierto', label: 'No realizado' },
    { valor: 'en_progreso', label: 'En desarrollo' },
    { valor: 'cerrado', label: 'Realizado' }
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.esEmpresa = this.authService.esUsuarioEmpresa();
    this.puedeConsultar = !this.esEmpresa && this.authService.esAdministradorOSuperior();
    const empresaId = this.authService.getEmpresaId();
    if (this.esEmpresa && empresaId) {
      this.backend.obtenerEmpresa(empresaId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.empresaNombre = res?.empresa?.nombre_empresa || '';
          },
          error: () => {
            this.empresaNombre = '';
          }
        });
    }
    if (this.puedeConsultar) {
      this.cargar();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get opinionesFiltradas(): OpinionItem[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.opiniones;
    return this.opiniones.filter((o) => {
      const autor = this.autorLabel(o).toLowerCase();
      return (
        String(o.opinion_id).includes(q) ||
        (o.folio || '').toLowerCase().includes(q) ||
        (o.descripcion || '').toLowerCase().includes(q) ||
        (o.cliente || '').toLowerCase().includes(q) ||
        this.tipoLabel(o.tipo).toLowerCase().includes(q) ||
        autor.includes(q) ||
        this.estadoLabel(o.estado).toLowerCase().includes(q)
      );
    });
  }

  get total(): number {
    return this.opinionesFiltradas.length;
  }

  get noRealizados(): number {
    return this.opinionesFiltradas.filter((o) => o.estado === 'abierto').length;
  }

  get enDesarrollo(): number {
    return this.opinionesFiltradas.filter((o) => o.estado === 'en_progreso').length;
  }

  get realizados(): number {
    return this.opinionesFiltradas.filter((o) => o.estado === 'cerrado').length;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.opinionesFiltradas.length / this.opinionesPorPagina));
  }

  get opinionesPaginadas(): OpinionItem[] {
    const inicio = (this.paginaActual - 1) * this.opinionesPorPagina;
    return this.opinionesFiltradas.slice(inicio, inicio + this.opinionesPorPagina);
  }

  get paginasDisponibles(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, index) => index + 1);
  }

  get rangoPagina(): { desde: number; hasta: number } {
    if (!this.opinionesFiltradas.length) return { desde: 0, hasta: 0 };
    const desde = (this.paginaActual - 1) * this.opinionesPorPagina + 1;
    return {
      desde,
      hasta: Math.min(desde + this.opinionesPorPagina - 1, this.opinionesFiltradas.length)
    };
  }

  get opinionesAgrupadas(): Array<{ etiqueta: string; opiniones: OpinionItem[] }> {
    const grupos: Array<{ etiqueta: string; opiniones: OpinionItem[] }> = [];
    for (const opinion of this.opinionesPaginadas) {
      const etiqueta = this.etiquetaGrupo(opinion.created_at);
      const actual = grupos[grupos.length - 1];
      if (actual && actual.etiqueta === etiqueta) {
        actual.opiniones.push(opinion);
      } else {
        grupos.push({ etiqueta, opiniones: [opinion] });
      }
    }
    return grupos;
  }

  get descripcionOk(): boolean {
    return !!this.descripcion.trim();
  }

  get formularioValido(): boolean {
    return this.descripcionOk;
  }

  cargar(): void {
    this.cargando = true;
    this.error = null;
    this.backend.obtenerOpiniones(this.filtroEstado || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.opiniones = res?.opiniones || [];
          this.paginaActual = 1;
          this.expandidoId = null;
          this.cargando = false;
        },
        error: (err) => {
          this.cargando = false;
          this.error = err?.error?.message || 'No se pudieron cargar las opiniones';
        }
      });
  }

  cambiarFiltroEstado(estado: FiltroEstado): void {
    this.filtroEstado = estado;
    this.paginaActual = 1;
    this.cargar();
  }

  onBusquedaChange(): void {
    this.paginaActual = 1;
    this.expandidoId = null;
  }

  cambiarPagina(pagina: number): void {
    const siguiente = Math.min(Math.max(1, pagina), this.totalPaginas);
    if (siguiente === this.paginaActual) return;
    this.paginaActual = siguiente;
    this.expandidoId = null;
  }

  enviar(): void {
    if (this.enviando || !this.formularioValido) {
      return;
    }
    this.enviando = true;
    this.errorEnvio = null;

    this.backend.crearOpinion({
      tipo: 'opinion',
      descripcion: this.descripcion.trim()
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.enviando = false;
          if (res?.success) {
            this.folioGenerado = res?.opinion?.folio || null;
            this.descripcion = '';
          } else {
            this.errorEnvio = res?.message || 'No se pudo registrar la opinión. Intenta de nuevo.';
          }
        },
        error: (err) => {
          this.enviando = false;
          this.errorEnvio = err?.error?.message || 'No se pudo registrar la opinión. Intenta de nuevo.';
        }
      });
  }

  registrarOtra(): void {
    this.descripcion = '';
    this.folioGenerado = null;
    this.errorEnvio = null;
  }

  setEstado(opinion: OpinionItem, estado: 'abierto' | 'en_progreso' | 'cerrado'): void {
    if (!this.puedeConsultar || !opinion?.opinion_id || opinion.estado === estado || this.actualizandoId != null) {
      return;
    }
    this.actualizandoId = opinion.opinion_id;
    this.errorEstado = null;
    this.backend.actualizarOpinion(opinion.opinion_id, estado)
      .pipe(
        finalize(() => {
          this.actualizandoId = null;
          this.cdr.detectChanges();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          const original = this.opiniones.find((o) => o.opinion_id === opinion.opinion_id);
          if (original) {
            original.estado = estado;
            original.updated_at = new Date().toISOString();
          }
          opinion.estado = estado;
          opinion.updated_at = new Date().toISOString();
          if (this.filtroEstado && this.filtroEstado !== estado) {
            this.opiniones = this.opiniones.filter((o) => o.opinion_id !== opinion.opinion_id);
            this.paginaActual = Math.min(this.paginaActual, this.totalPaginas);
            this.expandidoId = null;
          }
        },
        error: (err) => {
          this.errorEstado = err?.error?.message || 'No se pudo actualizar el estatus. Intenta de nuevo.';
        }
      });
  }

  onEstatusChange(opinion: OpinionItem, event: Event): void {
    event.stopPropagation();
    const select = event.target as HTMLSelectElement;
    const estado = select.value as 'abierto' | 'en_progreso' | 'cerrado';
    this.setEstado(opinion, estado);
  }

  seleccionarOpinion(opinion: OpinionItem): void {
    if (this.expandidoId === opinion.opinion_id) {
      this.expandidoId = null;
      return;
    }
    this.expandidoId = opinion.opinion_id;
    this.errorEstado = null;
  }

  tituloLista(opinion: OpinionItem): string {
    const cliente = (opinion.cliente || '').trim();
    return cliente
      ? `${this.tipoLabel(opinion.tipo)} · ${cliente}`
      : this.tipoLabel(opinion.tipo);
  }

  snippetOpinion(opinion: OpinionItem): string {
    const texto = String(opinion.descripcion || '').replace(/\s+/g, ' ').trim();
    if (!texto) return this.autorLabel(opinion);
    return texto.length > 110 ? `${texto.slice(0, 107)}…` : texto;
  }

  tiempoRelativo(valor?: string): string {
    if (!valor) return '—';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '—';
    const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
    if (minutos < 1) return 'Ahora';
    if (minutos < 60) return `Hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'Ayer';
    if (dias < 7) return `Hace ${dias} días`;
    return this.fechaPedidoUi(valor);
  }

  estadoLabel(estado: string): string {
    const map: Record<string, string> = {
      abierto: 'No realizado',
      en_progreso: 'En desarrollo',
      cerrado: 'Realizado'
    };
    return map[estado] || estado;
  }

  tipoLabel(tipo?: string): string {
    return String(tipo || '').toLowerCase() === 'sugerencia' ? 'Sugerencia' : 'Opinión';
  }

  fechaHoraUi(valor?: string): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return this.fechaPedidoUi(valor);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()} ${hours}:${mins}`;
  }

  autorLabel(opinion: OpinionItem): string {
    const nombre = String(opinion.autor_nombre || '').trim();
    if (nombre) return nombre;
    if (opinion.autor_usuario) return String(opinion.autor_usuario);
    return `Usuario #${opinion.usuario_id}`;
  }

  trackByOpinionId(_i: number, o: OpinionItem): number {
    return o.opinion_id;
  }

  trackByGrupo(_i: number, grupo: { etiqueta: string }): string {
    return grupo.etiqueta;
  }

  private etiquetaGrupo(valor?: string): string {
    if (!valor) return 'Anteriores';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return 'Anteriores';
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    const inicioItem = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
    const dias = Math.round((inicioHoy - inicioItem) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    return this.fechaPedidoUi(valor);
  }

  private fechaPedidoUi(valor?: string): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  }
}
