import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';

export interface TicketEvidencia {
  evidencia_id: number;
  descripcion?: string;
  mime?: string;
}

export interface TicketItem {
  ticket_id: number;
  area: string;
  descripcion: string;
  usuario_id: number;
  estado: 'abierto' | 'en_progreso' | 'cerrado' | string;
  prioridad?: 'critica' | 'urgente' | 'prioritaria' | 'normal' | 'no_prioritaria' | string;
  tipo?: 'falla' | 'sugerencia' | string;
  publicado_version?: string | null;
  created_at: string;
  updated_at?: string;
  autor_nombre?: string;
  autor_usuario?: string;
  evidencias?: TicketEvidencia[];
}

type FiltroEstado = '' | 'abierto' | 'en_progreso' | 'cerrado';

@Component({
  selector: 'app-tickets',
  templateUrl: './tickets.component.html',
  styleUrls: ['./tickets.component.scss']
})
export class TicketsComponent implements OnInit, OnDestroy {
  tickets: TicketItem[] = [];
  cargando = false;
  error: string | null = null;
  filtroEstado: FiltroEstado = '';
  busqueda = '';
  expandidoId: number | null = null;
  seleccionadoId: number | null = null;
  actualizandoId: number | null = null;
  paginaActual = 1;
  readonly ticketsPorPagina = 9;
  evidenciasUrl: Record<string, string> = {};
  evidenciasSafe: Record<string, SafeUrl> = {};
  evidenciasError: Record<string, boolean> = {};
  private evidenciasCargando: Record<string, boolean> = {};
  errorEstado: string | null = null;

  readonly opcionesEstatus: Array<{ valor: 'abierto' | 'en_progreso' | 'cerrado'; label: string }> = [
    { valor: 'abierto', label: 'No realizado' },
    { valor: 'en_progreso', label: 'En desarrollo' },
    { valor: 'cerrado', label: 'Realizado' }
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    this.limpiarEvidenciasUrl();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get ticketsFiltrados(): TicketItem[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.tickets;
    return this.tickets.filter((t) => {
      const autor = this.autorLabel(t).toLowerCase();
      return (
        String(t.ticket_id).includes(q) ||
        (t.area || '').toLowerCase().includes(q) ||
        (t.descripcion || '').toLowerCase().includes(q) ||
        this.tipoLabel(t.tipo).toLowerCase().includes(q) ||
        autor.includes(q) ||
        this.estadoLabel(t.estado).toLowerCase().includes(q)
      );
    });
  }

  get total(): number {
    return this.ticketsFiltrados.length;
  }

  get noRealizados(): number {
    return this.ticketsFiltrados.filter((t) => t.estado === 'abierto').length;
  }

  get enDesarrollo(): number {
    return this.ticketsFiltrados.filter((t) => t.estado === 'en_progreso').length;
  }

  get realizados(): number {
    return this.ticketsFiltrados.filter((t) => t.estado === 'cerrado').length;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.ticketsFiltrados.length / this.ticketsPorPagina));
  }

  get ticketsPaginados(): TicketItem[] {
    const inicio = (this.paginaActual - 1) * this.ticketsPorPagina;
    return this.ticketsFiltrados.slice(inicio, inicio + this.ticketsPorPagina);
  }

  get paginasDisponibles(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, index) => index + 1);
  }

  get rangoPagina(): { desde: number; hasta: number } {
    if (!this.ticketsFiltrados.length) return { desde: 0, hasta: 0 };
    const desde = (this.paginaActual - 1) * this.ticketsPorPagina + 1;
    return {
      desde,
      hasta: Math.min(desde + this.ticketsPorPagina - 1, this.ticketsFiltrados.length)
    };
  }

  get ticketsAgrupados(): Array<{ etiqueta: string; tickets: TicketItem[] }> {
    const grupos: Array<{ etiqueta: string; tickets: TicketItem[] }> = [];
    for (const ticket of this.ticketsPaginados) {
      const etiqueta = this.etiquetaGrupo(ticket.created_at);
      const actual = grupos[grupos.length - 1];
      if (actual && actual.etiqueta === etiqueta) {
        actual.tickets.push(ticket);
      } else {
        grupos.push({ etiqueta, tickets: [ticket] });
      }
    }
    return grupos;
  }

  cargar(): void {
    this.cargando = true;
    this.error = null;
    this.backend.obtenerTickets(this.filtroEstado || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.tickets = res?.tickets || [];
          this.paginaActual = 1;
          this.expandidoId = null;
          this.seleccionadoId = null;
          this.cargando = false;
        },
        error: (err) => {
          this.cargando = false;
          this.error = err?.error?.message || 'No se pudieron cargar los tickets';
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
    this.seleccionadoId = null;
  }

  cambiarPagina(pagina: number): void {
    const siguiente = Math.min(Math.max(1, pagina), this.totalPaginas);
    if (siguiente === this.paginaActual) return;
    this.paginaActual = siguiente;
    this.expandidoId = null;
    this.seleccionadoId = null;
  }

  setEstado(ticket: TicketItem, estado: 'abierto' | 'en_progreso' | 'cerrado'): void {
    if (!ticket?.ticket_id || ticket.estado === estado || this.actualizandoId != null) {
      return;
    }
    this.actualizandoId = ticket.ticket_id;
    this.errorEstado = null;
    this.backend.actualizarTicket(ticket.ticket_id, estado)
      .pipe(
        finalize(() => {
          this.actualizandoId = null;
          this.cdr.detectChanges();
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          const original = this.tickets.find((t) => t.ticket_id === ticket.ticket_id);
          if (original) {
            original.estado = estado;
            original.updated_at = new Date().toISOString();
          }
          ticket.estado = estado;
          ticket.updated_at = new Date().toISOString();
          if (this.filtroEstado && this.filtroEstado !== estado) {
            this.tickets = this.tickets.filter((t) => t.ticket_id !== ticket.ticket_id);
            this.paginaActual = Math.min(this.paginaActual, this.totalPaginas);
            this.expandidoId = null;
            this.seleccionadoId = null;
          }
        },
        error: (err) => {
          this.errorEstado = err?.error?.message || 'No se pudo actualizar el estatus. Intenta de nuevo.';
        }
      });
  }

  onEstatusChange(ticket: TicketItem, event: Event): void {
    event.stopPropagation();
    const select = event.target as HTMLSelectElement;
    const estado = select.value as 'abierto' | 'en_progreso' | 'cerrado';
    this.setEstado(ticket, estado);
  }

  seleccionarTicket(ticket: TicketItem): void {
    if (this.expandidoId === ticket.ticket_id) {
      this.expandidoId = null;
      this.seleccionadoId = null;
      return;
    }
    this.expandidoId = ticket.ticket_id;
    this.seleccionadoId = ticket.ticket_id;
    this.errorEstado = null;
    this.cargarEvidenciasTicket(ticket);
  }

  tituloLista(ticket: TicketItem): string {
    return `${this.tipoLabel(ticket.tipo)} · ${ticket.area || 'General'}`;
  }

  snippetTicket(ticket: TicketItem): string {
    const texto = String(ticket.descripcion || '').replace(/\s+/g, ' ').trim();
    if (!texto) return this.autorLabel(ticket);
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

  private etiquetaGrupo(valor?: string): string {
    if (!valor) return 'Anteriores';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return 'Anteriores';
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    const inicioTicket = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
    const dias = Math.round((inicioHoy - inicioTicket) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
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

  prioridadLabel(prioridad?: string): string {
    const map: Record<string, string> = {
      critica: 'Crítica',
      urgente: 'Urgente',
      prioritaria: 'Prioritaria',
      normal: 'Normal',
      no_prioritaria: 'No prioritaria'
    };
    return map[String(prioridad || 'normal')] || 'Normal';
  }

  tipoLabel(tipo?: string): string {
    return String(tipo || '').toLowerCase() === 'falla' ? 'Falla' : 'Sugerencia de mejora';
  }

  evidenciaSrc(ticketId: number, evidenciaId: number): SafeUrl | null {
    return this.evidenciasSafe[`${ticketId}-${evidenciaId}`] || null;
  }

  evidenciaFallida(ticketId: number, evidenciaId: number): boolean {
    return !!this.evidenciasError[`${ticketId}-${evidenciaId}`];
  }

  abrirEvidencia(ticketId: number, evidenciaId: number): void {
    const url = this.evidenciasUrl[`${ticketId}-${evidenciaId}`];
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  }

  private cargarEvidenciasTicket(ticket: TicketItem | null): void {
    if (!ticket?.ticket_id || !ticket.evidencias?.length) return;
    for (const ev of ticket.evidencias) {
      const key = `${ticket.ticket_id}-${ev.evidencia_id}`;
      if (this.evidenciasUrl[key] || this.evidenciasCargando[key]) continue;
      this.evidenciasCargando[key] = true;
      this.evidenciasError[key] = false;
      this.backend.obtenerEvidenciaTicket(ticket.ticket_id, ev.evidencia_id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (blob) => {
            if (!blob || blob.size === 0 || (blob.type && blob.type.includes('json'))) {
              this.evidenciasError[key] = true;
              delete this.evidenciasCargando[key];
              this.cdr.markForCheck();
              return;
            }
            const blobUrl = URL.createObjectURL(blob);
            this.evidenciasUrl[key] = blobUrl;
            this.evidenciasSafe[key] = this.sanitizer.bypassSecurityTrustUrl(blobUrl);
            delete this.evidenciasCargando[key];
            this.cdr.markForCheck();
          },
          error: () => {
            this.evidenciasError[key] = true;
            delete this.evidenciasCargando[key];
            this.cdr.markForCheck();
          }
        });
    }
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

  private limpiarEvidenciasUrl(): void {
    Object.values(this.evidenciasUrl).forEach((url) => URL.revokeObjectURL(url));
    this.evidenciasUrl = {};
    this.evidenciasSafe = {};
    this.evidenciasError = {};
    this.evidenciasCargando = {};
  }

  private fechaPedidoUi(valor?: string): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  }

  autorLabel(ticket: TicketItem): string {
    const nombre = String(ticket.autor_nombre || '').trim();
    if (nombre) return nombre;
    if (ticket.autor_usuario) return String(ticket.autor_usuario);
    return `Usuario #${ticket.usuario_id}`;
  }

  areaIcon(area: string): string {
    const map: Record<string, string> = {
      'Capacitación': 'fa-graduation-cap',
      'Protección Civil': 'fa-shield-alt',
      'SGC': 'fa-certificate',
      'Recursos Humanos': 'fa-id-badge',
      'Médicos': 'fa-user-md',
      'Ambiental': 'fa-tree',
      'Control de Proyectos': 'fa-project-diagram',
      'Control de Oficios': 'fa-folder-open',
      'Diseño e Innovación': 'fa-drafting-compass',
      'Mantenimiento': 'fa-tools',
      'General': 'fa-lightbulb'
    };
    return map[area] || 'fa-ticket-alt';
  }

  trackByTicketId(_i: number, t: TicketItem): number {
    return t.ticket_id;
  }

  trackByGrupo(_i: number, grupo: { etiqueta: string }): string {
    return grupo.etiqueta;
  }

  trackByEvidenciaId(_i: number, ev: TicketEvidencia): number {
    return ev.evidencia_id;
  }
}
