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
  titulo?: string;
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
  vistaPeriodo: 'semana' | 'mes' = 'mes';
  periodoSeleccionado = '';
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

  readonly anioGrafico = new Date().getFullYear();
  indiceEvolucion = 0;
  graficasEvolucion: any[] = [];
  evolucionAutoActiva = true;
  evolucionPausada = false;
  evolucionSegundos = 8;
  evolucionProgreso = 0;
  private evolucionTimer: ReturnType<typeof setInterval> | null = null;
  private evolucionTranscurrido = 0;
  private readonly intervaloEvolucionMs = 8000;
  private readonly tickEvolucionMs = 100;
  private readonly mesesGrafico = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  private readonly seriesEvolucion: Array<{ nombre: string; estado: string; color: string }> = [
    { nombre: 'No realizados', estado: 'abierto', color: '#c05621' },
    { nombre: 'En desarrollo', estado: 'en_progreso', color: '#3b5bdb' },
    { nombre: 'Realizados', estado: 'cerrado', color: '#2f9e44' }
  ];

  tipoChart: any = null;
  fotosRotas: Record<number, boolean> = {};
  private fichaUsuario = new Map<number, { puesto: string; foto: string }>();

  readonly opcionesPrioridad: Array<{ valor: string; label: string }> = [
    { valor: 'critica', label: 'Crítica' },
    { valor: 'urgente', label: 'Urgente' },
    { valor: 'prioritaria', label: 'Prioritaria' },
    { valor: 'normal', label: 'Normal' },
    { valor: 'no_prioritaria', label: 'No prioritaria' }
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {
    this.sincronizarGrafico();
  }

  ngOnInit(): void {
    this.cargar();
    this.cargarFichas();
    this.iniciarEvolucion();
  }

  ngOnDestroy(): void {
    this.detenerEvolucion();
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
        (t.titulo || '').toLowerCase().includes(q) ||
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

  get fallas(): number {
    return this.ticketsFiltrados.filter((t) => this.esFalla(t.tipo)).length;
  }

  get sugerencias(): number {
    return this.ticketsFiltrados.filter((t) => !this.esFalla(t.tipo)).length;
  }

  get resumenEvolucion(): Array<{ titulo: string; icono: string; color: string; gradiente: string; subtitulo: string }> {
    const pct = (n: number) => (this.total ? Math.round((n / this.total) * 100) : 0);
    return [
      {
        titulo: 'No realizados',
        icono: 'fa-clock',
        color: '#c05621',
        gradiente: 'linear-gradient(135deg, #c2410c 0%, #fb923c 100%)',
        subtitulo: `${pct(this.noRealizados)}% del total`
      },
      {
        titulo: 'En desarrollo',
        icono: 'fa-cog',
        color: '#3b5bdb',
        gradiente: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)',
        subtitulo: `${pct(this.enDesarrollo)}% del total`
      },
      {
        titulo: 'Realizados',
        icono: 'fa-check-circle',
        color: '#2f9e44',
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)',
        subtitulo: `${pct(this.realizados)}% del total`
      }
    ];
  }

  get tarjetasCarrusel(): Array<{ titulo: string; valor: number; subtitulo: string; icono: string; color: string; gradiente: string }> {
    const pct = (n: number) => (this.total ? Math.round((n / this.total) * 100) : 0);
    return [
      {
        titulo: 'No realizados',
        valor: this.noRealizados,
        subtitulo: `${pct(this.noRealizados)}% en vista`,
        icono: 'fa-clock',
        color: '#c05621',
        gradiente: 'linear-gradient(135deg, #c2410c 0%, #fb923c 100%)'
      },
      {
        titulo: 'En desarrollo',
        valor: this.enDesarrollo,
        subtitulo: `${pct(this.enDesarrollo)}% en vista`,
        icono: 'fa-cog',
        color: '#3b5bdb',
        gradiente: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)'
      },
      {
        titulo: 'Realizados',
        valor: this.realizados,
        subtitulo: `${pct(this.realizados)}% en vista`,
        icono: 'fa-check-circle',
        color: '#2f9e44',
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      }
    ];
  }

  get tarjetasResumen(): Array<{ titulo: string; valor: number; subtitulo: string; icono: string; color: string; gradiente: string }> {
    const pct = (n: number) => (this.total ? Math.round((n / this.total) * 100) : 0);
    return [
      {
        titulo: 'En vista',
        valor: this.total,
        subtitulo: `tickets · ${this.anioGrafico}`,
        icono: 'fa-eye',
        color: '#0f766e',
        gradiente: 'linear-gradient(135deg, #0f766e 0%, #2dd4bf 100%)'
      },
      {
        titulo: 'Fallas',
        valor: this.fallas,
        subtitulo: `${pct(this.fallas)}% del total`,
        icono: 'fa-exclamation-triangle',
        color: '#e11d48',
        gradiente: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)'
      },
      {
        titulo: 'Sugerencias',
        valor: this.sugerencias,
        subtitulo: `${pct(this.sugerencias)}% del total`,
        icono: 'fa-lightbulb',
        color: '#d97706',
        gradiente: 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)'
      }
    ];
  }

  get tarjetasFila(): Array<{ titulo: string; valor: number; subtitulo: string; icono: string; color: string; gradiente: string }> {
    const [enVista, fallas, sugerencias] = this.tarjetasResumen;
    return [enVista, ...this.tarjetasCarrusel, fallas, sugerencias];
  }

  get leyendaTipo(): Array<{ label: string; total: number; pct: number; tono: string; detalle: string }> {
    const base = this.total || 0;
    const pct = (n: number) => (base ? Math.round((n / base) * 100) : 0);
    const detalle = (n: number) => {
      const unidad = n === 1 ? 'ticket' : 'tickets';
      return `${n} ${unidad} · ${pct(n)}%`;
    };
    return [
      { label: 'Fallas', total: this.fallas, pct: pct(this.fallas), tono: 'falla', detalle: detalle(this.fallas) },
      { label: 'Sugerencias', total: this.sugerencias, pct: pct(this.sugerencias), tono: 'sugerencia', detalle: detalle(this.sugerencias) }
    ];
  }

  get porcentajeDominante(): number {
    if (!this.total) return 0;
    return Math.round((Math.max(this.fallas, this.sugerencias) / this.total) * 100);
  }

  get colorDominante(): string {
    return this.fallas > this.sugerencias ? '#e11d48' : '#16a34a';
  }

  get topSolicitantes(): Array<{ id: number; nombre: string; puesto: string; foto: string; iniciales: string; total: number }> {
    const mapa = new Map<number, { id: number; nombre: string; puesto: string; foto: string; iniciales: string; total: number }>();
    for (const ticket of this.tickets) {
      const id = Number(ticket.usuario_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const actual = mapa.get(id);
      if (actual) {
        actual.total += 1;
        continue;
      }
      const ficha = this.fichaUsuario.get(id);
      const nombre = this.autorLabel(ticket);
      mapa.set(id, {
        id,
        nombre,
        puesto: ficha?.puesto || 'Sin puesto',
        foto: ficha?.foto || '',
        iniciales: this.inicialesDe(nombre),
        total: 1
      });
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 3);
  }

  marcarFotoRota(id: number): void {
    this.fotosRotas = { ...this.fotosRotas, [id]: true };
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

  get ticketAbierto(): TicketItem | null {
    if (this.expandidoId == null) return null;
    return this.ticketsFiltrados.find((t) => t.ticket_id === this.expandidoId) || null;
  }

  get opcionesPeriodo(): Array<{ valor: string; etiqueta: string }> {
    const vistos = new Map<string, number>();
    for (const ticket of this.ticketsFiltrados) {
      const clave = this.clavePeriodo(ticket.created_at);
      if (!clave) continue;
      const tiempo = new Date(ticket.created_at).getTime();
      const previo = vistos.get(clave);
      if (previo == null || tiempo > previo) vistos.set(clave, tiempo);
    }
    return [...vistos.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([valor]) => ({
        valor,
        etiqueta: this.vistaPeriodo === 'mes' ? this.etiquetaMesClave(valor) : this.etiquetaSemanaClave(valor)
      }));
  }

  get periodoActivo(): string {
    const opciones = this.opcionesPeriodo;
    if (opciones.some((op) => op.valor === this.periodoSeleccionado)) return this.periodoSeleccionado;
    return opciones[0]?.valor || '';
  }

  readonly columnasTicketsBase: Array<{ id: 'abierto' | 'en_progreso' | 'cerrado'; titulo: string }> = [
    { id: 'abierto', titulo: 'No realizados' },
    { id: 'en_progreso', titulo: 'En desarrollo' },
    { id: 'cerrado', titulo: 'Realizados' }
  ];

  get columnasTickets(): Array<{ id: 'abierto' | 'en_progreso' | 'cerrado'; titulo: string }> {
    if (!this.filtroEstado) return this.columnasTicketsBase;
    return this.columnasTicketsBase.filter((col) => col.id === this.filtroEstado);
  }

  ticketsDeColumna(estado: string): TicketItem[] {
    return this.ticketsVisibles.filter((ticket) => ticket.estado === estado);
  }

  get ticketsVisibles(): TicketItem[] {
    const periodo = this.periodoActivo;
    const lista = this.ticketsFiltrados.filter((ticket) => !periodo || this.clavePeriodo(ticket.created_at) === periodo);
    return lista.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  elegirPeriodo(valor: string): void {
    this.periodoSeleccionado = valor;
    this.expandidoId = null;
  }

  alternarPeriodo(): void {
    this.vistaPeriodo = this.vistaPeriodo === 'semana' ? 'mes' : 'semana';
    this.periodoSeleccionado = '';
    this.expandidoId = null;
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
          this.sincronizarGrafico();
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
    this.sincronizarGrafico();
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
    this.backend.actualizarTicket(ticket.ticket_id, { estado })
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
          this.sincronizarGrafico();
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

  onPrioridadChange(ticket: TicketItem, event: Event): void {
    event.stopPropagation();
    const select = event.target as HTMLSelectElement;
    const prioridad = select.value;
    if (!ticket?.ticket_id || (ticket.prioridad || 'normal') === prioridad || this.actualizandoId != null) {
      return;
    }
    this.actualizandoId = ticket.ticket_id;
    this.errorEstado = null;
    this.backend.actualizarTicket(ticket.ticket_id, { prioridad })
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
            original.prioridad = prioridad;
            original.updated_at = new Date().toISOString();
          }
          ticket.prioridad = prioridad;
          ticket.updated_at = new Date().toISOString();
        },
        error: (err) => {
          select.value = ticket.prioridad || 'normal';
          this.errorEstado = err?.error?.message || 'No se pudo actualizar la prioridad. Intenta de nuevo.';
        }
      });
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

  tituloTicket(ticket: TicketItem): string {
    const titulo = String(ticket.titulo || '').trim();
    if (titulo) return titulo;
    return `${this.tipoLabel(ticket.tipo)} #${ticket.ticket_id}`;
  }

  snippetTicket(ticket: TicketItem): string {
    const texto = String(ticket.descripcion || '').replace(/\s+/g, ' ').trim();
    if (!texto) return 'Sin descripción';
    return texto.length > 90 ? `${texto.slice(0, 87)}…` : texto;
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

  private clavePeriodo(valor?: string): string {
    const fecha = new Date(valor || '');
    if (Number.isNaN(fecha.getTime())) return '';
    if (this.vistaPeriodo === 'mes') return `${fecha.getFullYear()}-${fecha.getMonth()}`;
    const inicio = this.inicioSemana(fecha);
    return `${inicio.getFullYear()}-${inicio.getMonth()}-${inicio.getDate()}`;
  }

  private inicioSemana(fecha: Date): Date {
    const dia = fecha.getDay();
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - (dia === 0 ? 6 : dia - 1));
  }

  private etiquetaMesClave(clave: string): string {
    const [anio, mes] = clave.split('-').map(Number);
    const fecha = new Date(anio, mes, 1);
    const texto = fecha.toLocaleDateString('es-MX', { month: 'long' });
    const mismoMesOtroAnio = this.ticketsFiltrados.some((ticket) => {
      const otra = this.clavePeriodo(ticket.created_at);
      return !!otra && otra !== clave && otra.endsWith(`-${mes}`);
    });
    const nombre = texto.charAt(0).toUpperCase() + texto.slice(1);
    return mismoMesOtroAnio ? `${nombre} ${anio}` : nombre;
  }

  private etiquetaSemanaClave(clave: string): string {
    const [anio, mes, dia] = clave.split('-').map(Number);
    const inicio = new Date(anio, mes, dia);
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 6);
    const corto = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `${corto(inicio)} al ${corto(fin)}`;
  }

  private etiquetaSemana(valor?: string): string {
    const fecha = new Date(valor || '');
    if (Number.isNaN(fecha.getTime())) return 'Sin fecha';
    const dia = fecha.getDay();
    const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - (dia === 0 ? 6 : dia - 1));
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 6);
    const corto = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `Semana del ${corto(inicio)} al ${corto(fin)} ${fin.getFullYear()}`;
  }

  private etiquetaMes(valor?: string): string {
    const fecha = new Date(valor || '');
    if (Number.isNaN(fecha.getTime())) return 'Sin fecha';
    const texto = fecha.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
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

  prioridadClave(prioridad?: string): string {
    const clave = String(prioridad || 'normal').toLowerCase();
    return this.opcionesPrioridad.some((op) => op.valor === clave) ? clave : 'normal';
  }

  prioridadLabel(prioridad?: string): string {
    const clave = this.prioridadClave(prioridad);
    return this.opcionesPrioridad.find((op) => op.valor === clave)?.label || 'Normal';
  }

  tipoLabel(tipo?: string): string {
    return this.esFalla(tipo) ? 'Falla' : 'Sugerencia de mejora';
  }

  mostrarEvolucion(indice: number): void {
    if (indice < 0 || indice >= this.seriesEvolucion.length) return;
    this.indiceEvolucion = indice;
    this.reiniciarEvolucion();
  }

  pausarEvolucion(): void {
    this.evolucionPausada = true;
  }

  reanudarEvolucion(): void {
    this.evolucionPausada = false;
  }

  toggleEvolucionAuto(): void {
    this.evolucionAutoActiva = !this.evolucionAutoActiva;
    if (this.evolucionAutoActiva) {
      this.evolucionTranscurrido = 0;
      this.actualizarRelojEvolucion();
    }
  }

  private iniciarEvolucion(): void {
    this.detenerEvolucion();
    this.evolucionTranscurrido = 0;
    this.actualizarRelojEvolucion();
    this.evolucionTimer = setInterval(() => {
      if (!this.evolucionAutoActiva || this.evolucionPausada) return;
      this.evolucionTranscurrido += this.tickEvolucionMs;
      if (this.evolucionTranscurrido >= this.intervaloEvolucionMs) {
        this.indiceEvolucion = (this.indiceEvolucion + 1) % this.seriesEvolucion.length;
        this.evolucionTranscurrido = 0;
      }
      this.actualizarRelojEvolucion();
      this.cdr.detectChanges();
    }, this.tickEvolucionMs);
  }

  private actualizarRelojEvolucion(): void {
    this.evolucionProgreso = Math.min(100, (this.evolucionTranscurrido / this.intervaloEvolucionMs) * 100);
    this.evolucionSegundos = Math.max(1, Math.ceil((this.intervaloEvolucionMs - this.evolucionTranscurrido) / 1000));
  }

  private reiniciarEvolucion(): void {
    this.iniciarEvolucion();
  }

  private detenerEvolucion(): void {
    if (!this.evolucionTimer) return;
    clearInterval(this.evolucionTimer);
    this.evolucionTimer = null;
  }

  private sincronizarGrafico(): void {
    const porEstado: Record<string, number[]> = {
      abierto: Array(12).fill(0),
      en_progreso: Array(12).fill(0),
      cerrado: Array(12).fill(0)
    };
    const fallasMes = Array(12).fill(0);
    const sugerenciasMes = Array(12).fill(0);
    for (const ticket of this.ticketsFiltrados) {
      const fecha = new Date(ticket.created_at);
      if (Number.isNaN(fecha.getTime()) || fecha.getFullYear() !== this.anioGrafico) continue;
      const serie = porEstado[ticket.estado];
      if (serie) serie[fecha.getMonth()] += 1;
      if (this.esFalla(ticket.tipo)) fallasMes[fecha.getMonth()] += 1;
      else sugerenciasMes[fecha.getMonth()] += 1;
    }
    this.graficasEvolucion = this.seriesEvolucion.map((serie) =>
      this.graficaMensual(serie.nombre, porEstado[serie.estado], serie.color)
    );
    if (this.indiceEvolucion >= this.graficasEvolucion.length) this.indiceEvolucion = 0;
    this.tipoChart = this.graficaTipos(fallasMes, sugerenciasMes);
  }

  private graficaTipos(fallas: number[], sugerencias: number[]): any {
    return {
      series: [
        { name: 'Fallas', data: fallas },
        { name: 'Sugerencias', data: sugerencias }
      ],
      chart: {
        type: 'line',
        height: 132,
        fontFamily: 'inherit',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 700 }
      },
      colors: ['#9ca3af', '#d4e157'],
      stroke: { curve: 'straight', width: 2.5 },
      markers: { size: 4, strokeWidth: 0, hover: { size: 6 } },
      dataLabels: {
        enabled: true,
        offsetY: -7,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#64748b', '#65a30d'] },
        background: { enabled: false, dropShadow: { enabled: false } },
        formatter: (val: number) => (Number(val) > 0 ? `${Math.round(Number(val))}` : '')
      },
      xaxis: {
        categories: this.mesesGrafico,
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        min: 0,
        labels: { show: false }
      },
      grid: {
        borderColor: '#e5e7eb',
        strokeDashArray: 0,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
        padding: { left: 8, right: 8, top: 18, bottom: 0 }
      },
      legend: { show: false },
      tooltip: { y: { formatter: (val: number) => `${Math.round(val)}` } }
    };
  }

  private cargarFichas(): void {
    this.backend.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const rows = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const mapa = new Map<number, { puesto: string; foto: string }>();
          for (const usuario of rows) {
            const puesto = String(usuario?.organigrama || usuario?.empresa_puesto || usuario?.area_departamento || '').trim();
            mapa.set(Number(usuario.id), {
              puesto,
              foto: String(usuario?.foto_url || '').trim()
            });
          }
          this.fichaUsuario = mapa;
          this.cdr.markForCheck();
        },
        error: () => {}
      });
  }

  private inicialesDe(nombre: string): string {
    const partes = String(nombre || '').split(/\s+/).filter(Boolean);
    const letras = partes.slice(0, 2).map((parte) => parte.charAt(0).toUpperCase());
    return letras.join('') || '??';
  }

  private graficaMensual(nombre: string, data: number[], color: string): any {
    return {
      series: [{ name: nombre, type: 'area', data }],
      chart: {
        type: 'area',
        height: 280,
        fontFamily: 'inherit',
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 800,
          animateGradually: { enabled: true, delay: 120 },
          dynamicAnimation: { enabled: true, speed: 700 }
        }
      },
      colors: [color],
      stroke: { curve: 'smooth', width: 3 },
      fill: {
        type: 'gradient',
        gradient: { shade: 'light', type: 'vertical', opacityFrom: 0.45, opacityTo: 0.04, stops: [0, 90, 100] }
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: this.mesesGrafico,
        labels: { style: { colors: '#94a3b8', fontSize: '11px' } }
      },
      yaxis: {
        min: 0,
        forceNiceScale: true,
        labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (val: number) => `${Math.round(val)}` }
      },
      grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
      legend: { show: true, position: 'bottom', fontSize: '12px', labels: { colors: '#475569' } },
      tooltip: { y: { formatter: (val: number) => `${Math.round(val)}` } }
    };
  }

  private esFalla(tipo?: string): boolean {
    return String(tipo || '').toLowerCase() === 'falla';
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

  inicialesAutor(ticket: TicketItem): string {
    const partes = this.autorLabel(ticket).split(/\s+/).filter(Boolean);
    const letras = `${partes[0]?.charAt(0) || ''}${partes[1]?.charAt(0) || ''}`;
    return (letras || 'U').toUpperCase();
  }

  prioridadIcono(prioridad?: string): string {
    const valor = String(prioridad || 'normal');
    if (valor === 'critica' || valor === 'urgente' || valor === 'prioritaria') return 'fa-arrow-up';
    if (valor === 'no_prioritaria') return 'fa-arrow-down';
    return 'fa-minus';
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

  trackByTarjeta(_i: number, card: { titulo: string }): string {
    return card.titulo;
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
