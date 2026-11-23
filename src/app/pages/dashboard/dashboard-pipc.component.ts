import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';

interface EmpresaPipc {
  empresa_id: number;
  estado: string;
  documentos_totales: number;
  documentos_completos: number;
  ciclo_cerrado: boolean;
  pipc_documento_id: number;
  pasos_completados: string[];
  logo: string | null;
  logo_url: string | null;
  nombre_empresa: string;
}

interface ResolutivoPipc {
  resolutivo_id: number;
  item?: string | number | null;
  empresa_id?: number | null;
  nombre_empresa?: string;
  nombre_asignacion?: string;
  tipo_tramite?: string;
  responsable?: string;
  responsable_usuario_id?: number | null;
  responsable_registro?: string;
  responsable_registro_usuario_id?: number | null;
  encargado_nombre?: string;
  encargado_usuario_id?: number | null;
  estatus: string;
  fecha_aprobacion?: string;
  fecha_vencimiento?: string;
  municipio?: string;
  estado?: string;
  dias_hasta_contacto?: number | null;
  origen?: string;
}

interface CargaItem {
  id: number;
  empresa: string;
  tipo: string;
  lugar: string;
  estatus: string;
  color: string;
  fecha: string;
  dias: number;
  diasValor: string;
  diasTexto: string;
  empresaId: number | null;
  inicio: Date | null;
  fin: Date | null;
}

interface CargaPersona {
  responsable: string;
  sinResponsable: boolean;
  total: number;
  items: CargaItem[];
}

interface GanttBarra {
  left: number;
  width: number;
  color: string;
  extremo: 'unico' | 'inicio' | 'fin';
}

interface GanttFila {
  id: string;
  etiqueta: string;
  detalle: string;
  logoUrl: string | null;
  iniciales: string;
  dias: string;
  color: string;
  colorDias: string | null;
  titulo: string;
  barras: GanttBarra[];
}

interface IndicadorTiempo {
  modo: 'restante' | 'vencido' | 'tramite' | 'sin_fecha';
  dias: number;
  valor: string;
  unidad: string;
  titulo: string;
  subtitulo: string;
}

@Component({
  selector: 'app-dashboard-pipc',
  templateUrl: './dashboard-pipc.component.html',
  styleUrls: ['./dashboard-pipc.component.scss']
})
export class DashboardPipcComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private empresas: EmpresaPipc[] = [];
  private logos = new Map<string, { logo: string | null; logo_url: string | null }>();
  private resolutivosCarga: ResolutivoPipc[] = [];

  cargando = true;
  error = false;
  anio = new Date().getFullYear();
  cargandoResolutivos = false;
  vencimientoListo = false;
  plazoCards: { label: string; count: number; hint: string; color: string }[] = [];
  vencimientoChart: any = {};
  tipoChart: any = {};
  estatusTotal = 0;

  filtroEstatus: string | null = null;
  soloAsignados = false;
  busquedaEmpleado = '';
  menuAyudaAbierto = false;
  sugerenciasEmpleado: string[] = [];
  tienePipcPropios = false;
  readonly filtrosColor = [
    { estatus: 'Vigentes', label: 'Vigentes', color: '#2dce89' },
    { estatus: 'Próximo a vencer', label: 'Próximo a vencer', color: '#fb6340' },
    { estatus: 'Vencido', label: 'Vencidos', color: '#f5365c' },
    { estatus: 'En tramite', label: 'En trámite', color: '#5e72e4' }
  ];
  cargaKpis = { total: 0, personas: 0, proximos: 0, vencidos: 0 };
  ganttVistaAnual = false;
  ganttMeses: { etiqueta: string; anioOffset: number }[] = [];
  ganttAnios: { anio: number; columna: string }[] = [];
  ganttFilas: GanttFila[] = [];
  ganttHoyPct: number | null = null;

  private readonly estatusOrder = ['En tramite', 'Vigentes', 'Próximo a vencer', 'Vencido'];
  private readonly estatusConfig: Record<string, { label: string; color: string }> = {
    Vigentes: { label: 'Vigentes', color: '#2dce89' },
    'Próximo a vencer': { label: 'Próximo a vencer', color: '#fb6340' },
    Vencido: { label: 'Vencidos', color: '#f5365c' },
    'En tramite': { label: 'En trámite', color: '#5e72e4' }
  };
  private readonly plazoMeta = [
    { key: 'Vigentes', label: 'Vigentes', hint: 'Les falta tiempo', color: '#2dce89' },
    { key: 'Próximo a vencer', label: 'Próximo a vencer', hint: 'Se acercan', color: '#fb6340' },
    { key: 'Vencido', label: 'Vencidos', hint: 'Ya pasó la fecha', color: '#f5365c' },
    { key: 'En tramite', label: 'En trámite', hint: 'Todavía sin fecha', color: '#5e72e4' }
  ];

  constructor(
    private backend: BackendServices,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.aplicarVentanaGantt();
    this.cargar();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get puedeVerResolutivos(): boolean {
    return this.auth.esEncargadoProteccionCivil();
  }

  get puedeAbrirControl(): boolean {
    return this.auth.puedeVerControlResolutivosPipc();
  }

  get esAdmin(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  get mostrarAtencion(): boolean {
    return this.esAdmin || this.tienePipcPropios;
  }

  get empresasUnicas(): EmpresaPipc[] {
    const vistos = new Set<number>();
    const lista: EmpresaPipc[] = [];
    for (const empresa of this.empresas) {
      const id = Number(empresa.empresa_id);
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      lista.push(empresa);
    }
    return lista;
  }

  get totalEmpresas(): number {
    return this.empresasUnicas.length;
  }

  get totalEstados(): number {
    return new Set(
      this.empresasUnicas.map((e) => (e.estado || '').trim().toLowerCase()).filter(Boolean)
    ).size;
  }

  get totalDocumentos(): number {
    return this.empresasUnicas.reduce((acc, e) => acc + (Number(e.documentos_totales) || 0), 0);
  }

  get documentosCompletos(): number {
    return this.empresasUnicas.reduce((acc, e) => acc + (Number(e.documentos_completos) || 0), 0);
  }

  get documentosPendientes(): number {
    return Math.max(this.totalDocumentos - this.documentosCompletos, 0);
  }

  get cumplimiento(): number {
    if (!this.totalDocumentos) return 0;
    return Math.round((this.documentosCompletos / this.totalDocumentos) * 100);
  }

  get cargaFiltroActivo(): boolean {
    return !!this.filtroEstatus || this.soloAsignados || !!this.busquedaEmpleado.trim();
  }

  get etiquetaBotonGantt(): string {
    return this.ganttVistaAnual
      ? `Sep ${this.anio} – Mar ${this.anio + 1}`
      : `Nov ${this.anio} – Nov ${this.anio + 1}`;
  }

  get textoRangoGantt(): string {
    const rango = this.ganttVistaAnual
      ? `Noviembre ${this.anio} a noviembre ${this.anio + 1}`
      : `Septiembre ${this.anio} a marzo ${this.anio + 1}`;
    return `${rango}. El tramo sólido ya pasó de hoy; el claro es lo que falta.`;
  }

  reintentar(): void {
    this.cargar();
  }

  limpiarFiltrosCarga(): void {
    this.filtroEstatus = null;
    this.soloAsignados = false;
    this.busquedaEmpleado = '';
    this.menuAyudaAbierto = false;
    this.armarVistaCarga();
  }

  buscarEmpleado(valor: string): void {
    this.busquedaEmpleado = String(valor || '');
    this.menuAyudaAbierto = true;
    this.armarVistaCarga();
  }

  abrirMenuAyuda(): void {
    this.menuAyudaAbierto = true;
    this.actualizarSugerencias();
  }

  cerrarMenuAyuda(): void {
    this.menuAyudaAbierto = false;
  }

  elegirEmpleado(nombre: string): void {
    this.busquedaEmpleado = nombre;
    this.menuAyudaAbierto = false;
    this.armarVistaCarga();
  }

  teclaBusqueda(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      this.menuAyudaAbierto = false;
      return;
    }
    if (evento.key === 'Enter' && this.sugerenciasEmpleado.length) {
      evento.preventDefault();
      this.elegirEmpleado(this.sugerenciasEmpleado[0]);
    }
  }

  alternarSoloAsignados(): void {
    this.soloAsignados = !this.soloAsignados;
    this.armarVistaCarga();
  }

  alternarEstatusCarga(estatus: string): void {
    this.filtroEstatus = this.filtroEstatus === estatus ? null : estatus;
    this.armarVistaCarga();
  }

  alternarVistaGantt(): void {
    this.ganttVistaAnual = !this.ganttVistaAnual;
    this.aplicarVentanaGantt();
    this.armarVistaCarga();
  }

  trackByGanttFila(_index: number, fila: GanttFila): string {
    return fila.id;
  }

  ocultarLogoGantt(fila: GanttFila): void {
    fila.logoUrl = null;
  }

  private cargar(): void {
    this.cargando = true;
    this.error = false;
    this.cargandoResolutivos = this.puedeVerResolutivos;
    const empresas$ = this.backend.obtenerEmpresasProteccionCivil().pipe(catchError(() => of(null)));
    const resolutivos$ = this.puedeVerResolutivos
      ? this.backend.obtenerEstadisticasResolutivosPipc(this.anio).pipe(catchError(() => of(null)))
      : of(null);

    forkJoin([empresas$, resolutivos$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([empresasRes, resolutivosRes]) => {
        if (!empresasRes?.success) {
          this.error = true;
          this.cargando = false;
          this.cargandoResolutivos = false;
          return;
        }
        this.empresas = (empresasRes.empresas || [])
          .map((empresa: any) => this.normalizarEmpresa(empresa))
          .filter((empresa: EmpresaPipc) => this.tieneGestion(empresa));
        this.empresas.forEach((empresa) => this.registrarLogo(empresa));
        if (resolutivosRes?.success && resolutivosRes.estadisticas) {
          this.armarResolutivos(resolutivosRes.estadisticas);
        } else if (this.puedeVerResolutivos) {
          this.estatusTotal = 0;
          this.vencimientoListo = false;
          this.resolutivosCarga = [];
          this.armarVistaCarga();
        }
        this.cargando = false;
        this.cargandoResolutivos = false;
      });
  }

  private normalizarEmpresa(empresa: any): EmpresaPipc {
    return {
      empresa_id: Number(empresa?.empresa_id) || 0,
      estado: String(empresa?.estado || '').trim(),
      documentos_totales: Number(empresa?.documentos_totales) || 0,
      documentos_completos: Number(empresa?.documentos_completos) || 0,
      ciclo_cerrado: !!(empresa?.ciclo_cerrado || empresa?.ciclo_cerrado_at),
      pipc_documento_id: Number(empresa?.pipc_documento_id) || 0,
      pasos_completados: this.pasos(empresa?.pasos_completados),
      logo: empresa?.logo || null,
      logo_url: empresa?.logo_url || null,
      nombre_empresa: String(empresa?.nombre_empresa || '').trim()
    };
  }

  private pasos(raw: unknown): string[] {
    let valor: unknown = raw;
    if (typeof raw === 'string' && raw.trim()) {
      try { valor = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(valor)) return [];
    return valor.map((paso) => String(paso || '').trim()).filter(Boolean);
  }

  private tieneGestion(empresa: EmpresaPipc): boolean {
    if (empresa.ciclo_cerrado) return false;
    if (empresa.pipc_documento_id > 0) return true;
    if (empresa.documentos_totales > 0) return true;
    return empresa.pasos_completados.length > 0;
  }

  private registrarLogo(empresa: EmpresaPipc): void {
    if (!empresa.logo && !empresa.logo_url) return;
    const dato = { logo: empresa.logo, logo_url: empresa.logo_url };
    if (empresa.empresa_id > 0) this.logos.set(`id:${empresa.empresa_id}`, dato);
    if (empresa.nombre_empresa) this.logos.set(`nom:${empresa.nombre_empresa.toLowerCase()}`, dato);
  }

  private logoDe(empresaId: number | null, nombre: string): string | null {
    const dato = (empresaId ? this.logos.get(`id:${empresaId}`) : null)
      || this.logos.get(`nom:${nombre.trim().toLowerCase()}`);
    return dato ? this.backend.resolverUrlDrivePreview(dato.logo || dato.logo_url) : null;
  }

  private armarResolutivos(estadisticas: any): void {
    const distribucion = Array.isArray(estadisticas.distribucion) ? estadisticas.distribucion : [];
    const total = Number(estadisticas.total || 0);
    this.estatusTotal = total;
    const counts = new Map(this.estatusOrder.map((estatus) => {
      const item = distribucion.find((row: any) => row.estatus === estatus);
      return [estatus, Number(item?.total || 0)] as [string, number];
    }));
    this.plazoCards = this.plazoMeta.map((meta) => ({
      label: meta.label,
      hint: meta.hint,
      color: meta.color,
      count: counts.get(meta.key) || 0
    }));

    const carga = Array.isArray(estadisticas.carga) ? estadisticas.carga : (estadisticas.atencion?.resolutivos || []);
    this.resolutivosCarga = carga;
    this.armarVistaCarga();
    this.armarVencimiento(estadisticas);
  }

  private armarVencimiento(estadisticas: any): void {
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const serieMes = Array.isArray(estadisticas?.vencimientos_por_mes) && estadisticas.vencimientos_por_mes.length
      ? estadisticas.vencimientos_por_mes
      : this.vencimientosDesdeCarga();
    const categorias = (serieMes.length ? serieMes : meses.map((mes, idx) => ({ mes: idx + 1, mes_label: mes, total: 0 })))
      .map((item: any) => item.mes_label || meses[(Number(item.mes) || 1) - 1]);
    const datos = (serieMes.length ? serieMes : meses.map(() => ({ total: 0 })))
      .map((item: any) => Number(item.total) || 0);

    this.vencimientoChart = {
      series: [{ name: 'Vencen', data: datos }],
      chart: { type: 'line', height: 230, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif', zoom: { enabled: false } },
      colors: ['#64748b'],
      stroke: { curve: 'smooth', width: 3 },
      markers: { size: 4, strokeWidth: 0 },
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: { borderColor: '#eef1f4', strokeDashArray: 4, padding: { top: 8, right: 8, bottom: 0, left: 8 } },
      xaxis: { categories: categorias, labels: { style: { colors: '#94a3b8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (val: number) => String(Math.round(val)) } },
      tooltip: { theme: 'light', y: { formatter: (val: number) => `${val} resolutivo${val === 1 ? '' : 's'}` } }
    };

    const tipos = (Array.isArray(estadisticas?.por_tipo) && estadisticas.por_tipo.length
      ? estadisticas.por_tipo
      : this.tiposDesdeCarga()
    ).filter((item: any) => String(item?.tipo || '').trim() && String(item.tipo).trim() !== 'Sin tipo');
    const serieDe = (campo: string) => tipos.map((item: any) => Number(item[campo]) || 0);
    this.tipoChart = {
      series: [
        { name: 'Vigentes', data: serieDe('vigentes') },
        { name: 'Próximo a vencer', data: serieDe('proximo') },
        { name: 'Vencidos', data: serieDe('vencido') },
        { name: 'En trámite', data: serieDe('tramite') }
      ],
      chart: { type: 'bar', height: 230, stacked: true, toolbar: { show: false }, fontFamily: 'Open Sans, sans-serif' },
      colors: ['#2dce89', '#fb6340', '#f5365c', '#5e72e4'],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '46%' } },
      dataLabels: { enabled: false },
      legend: { show: true, position: 'bottom', fontSize: '11px', markers: { width: 8, height: 8, radius: 8 } },
      grid: { borderColor: '#eef1f4', strokeDashArray: 4, padding: { top: 8, right: 8, bottom: 0, left: 4 } },
      xaxis: {
        categories: tipos.map((item: any) => String(item.tipo).trim()),
        labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 600 }, trim: true },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (val: number) => String(Math.round(val)) } },
      tooltip: { theme: 'light' }
    };
    this.vencimientoListo = true;
  }

  private vencimientosDesdeCarga(): { mes: number; mes_label: string; total: number }[] {
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const serie = meses.map((mes_label, idx) => ({ mes: idx + 1, mes_label, total: 0 }));
    for (const item of this.resolutivosCarga) {
      const fecha = this.parseFechaMx(item.fecha_vencimiento);
      if (!fecha || fecha.getFullYear() !== this.anio) continue;
      serie[fecha.getMonth()].total += 1;
    }
    return serie;
  }

  private tiposDesdeCarga(): { tipo: string; vigentes: number; proximo: number; vencido: number; tramite: number }[] {
    const mapa = new Map<string, { tipo: string; vigentes: number; proximo: number; vencido: number; tramite: number }>();
    for (const item of this.resolutivosCarga) {
      const tipo = (item.tipo_tramite || '').trim();
      if (!tipo) continue;
      if (!mapa.has(tipo)) mapa.set(tipo, { tipo, vigentes: 0, proximo: 0, vencido: 0, tramite: 0 });
      const bucket = mapa.get(tipo)!;
      if (item.estatus === 'Vigentes') bucket.vigentes += 1;
      else if (item.estatus === 'Próximo a vencer') bucket.proximo += 1;
      else if (item.estatus === 'Vencido') bucket.vencido += 1;
      else bucket.tramite += 1;
    }
    return [...mapa.values()];
  }

  private armarVistaCarga(): void {
    const personal = this.fuentePersonal();
    this.tienePipcPropios = personal.length > 0;
    const buscada = this.esAdmin
      ? personal.filter((item) => this.coincideBusqueda(item))
      : personal;
    const fuente = buscada.filter((item) => this.pasaFiltro(item));
    const personas = this.agrupar(fuente);
    const baseKpi = this.esAdmin ? this.resolutivosCarga : personal;
    const todas = this.agrupar(baseKpi);
    this.cargaKpis = {
      total: baseKpi.length,
      personas: todas.filter((p) => !p.sinResponsable).length,
      proximos: baseKpi.filter((r) => r.estatus === 'Próximo a vencer').length,
      vencidos: baseKpi.filter((r) => r.estatus === 'Vencido').length
    };
    this.armarGantt(personas);
    if (this.menuAyudaAbierto) this.actualizarSugerencias();
  }

  private actualizarSugerencias(): void {
    const consulta = this.normalizar(this.busquedaEmpleado);
    const nombres = this.personasConPipc();
    this.sugerenciasEmpleado = consulta
      ? nombres.filter((nombre) => this.normalizar(nombre).includes(consulta))
      : nombres;
  }

  private personasConPipc(): string[] {
    const vistos = new Map<string, string>();
    for (const item of this.resolutivosCarga) {
      for (const nombre of this.nombresDe(item)) {
        const clave = this.normalizar(nombre);
        if (!clave || vistos.has(clave)) continue;
        vistos.set(clave, nombre);
      }
    }
    return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
  }

  private fuentePersonal(): ResolutivoPipc[] {
    if (this.esAdmin) return this.resolutivosCarga;
    const id = this.miUsuarioId();
    const nombre = this.miNombre();
    return this.resolutivosCarga.filter((item) => this.esDeLaPersona(item, id, nombre));
  }

  private pasaFiltro(item: ResolutivoPipc): boolean {
    if (this.filtroEstatus && item.estatus !== this.filtroEstatus) return false;
    if (this.esAdmin && this.soloAsignados && this.responsable(item.responsable) === 'Sin asignar') return false;
    return true;
  }

  private coincideBusqueda(item: ResolutivoPipc): boolean {
    const consulta = this.normalizar(this.busquedaEmpleado);
    if (!consulta) return true;
    return this.nombresDe(item).some((nombre) => this.normalizar(nombre).includes(consulta));
  }

  private esDeLaPersona(item: ResolutivoPipc, usuarioId: number, nombre: string): boolean {
    if (usuarioId && this.idsDe(item).includes(usuarioId)) return true;
    const usuario = this.normalizar(this.auth.usuarioActualValue?.username);
    if (usuario && this.nombresDe(item).some((guardado) => this.normalizar(guardado) === usuario)) return true;
    return this.nombresDe(item).some((guardado) => this.nombrePertenece(guardado, nombre));
  }

  private idsDe(item: ResolutivoPipc): number[] {
    return [item.responsable_usuario_id, item.encargado_usuario_id, item.responsable_registro_usuario_id]
      .map((id) => Number(id) || 0)
      .filter((id) => id > 0);
  }

  private nombresDe(item: ResolutivoPipc): string[] {
    return [item.responsable, item.encargado_nombre, item.responsable_registro]
      .map((nombre) => String(nombre || '').trim())
      .filter((nombre) => nombre && this.normalizar(nombre) !== 'sin asignar');
  }

  private miUsuarioId(): number {
    const usuario = this.auth.usuarioActualValue;
    return Number(usuario?.id || usuario?.usuario_id || 0) || 0;
  }

  private miNombre(): string {
    const usuario = this.auth.usuarioActualValue;
    const completo = [usuario?.nombre, usuario?.apellido_paterno || usuario?.apellido, usuario?.apellido_materno]
      .map((parte) => String(parte || '').trim())
      .filter(Boolean)
      .join(' ');
    return completo || String(usuario?.username || '').trim();
  }

  private normalizar(valor?: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private nombrePertenece(almacenado: string, persona: string): boolean {
    const nombre = this.normalizar(almacenado);
    const yo = this.normalizar(persona);
    if (!nombre || !yo || nombre === 'sin asignar') return false;
    if (nombre === yo) return true;
    const palabrasYo = yo.split(' ').filter((palabra) => palabra.length > 2);
    const palabrasNombre = nombre.split(' ');
    return palabrasYo.length >= 2 && palabrasYo.every((palabra) => palabrasNombre.includes(palabra));
  }

  private agrupar(lista: ResolutivoPipc[]): CargaPersona[] {
    const mapa = new Map<string, CargaPersona>();
    for (const item of lista) {
      const responsable = this.responsable(item.responsable);
      if (!mapa.has(responsable)) {
        mapa.set(responsable, { responsable, sinResponsable: responsable === 'Sin asignar', total: 0, items: [] });
      }
      const persona = mapa.get(responsable)!;
      persona.total += 1;
      const ind = this.indicador(item);
      const lugar = [item.municipio, item.estado].filter(Boolean).join(', ');
      persona.items.push({
        id: item.resolutivo_id,
        empresa: (item.nombre_empresa || 'Sin empresa').trim(),
        tipo: (item.tipo_tramite || '').trim(),
        lugar,
        estatus: item.estatus,
        color: this.estatusConfig[item.estatus]?.color || '#8898aa',
        fecha: item.fecha_vencimiento || 'Sin fecha',
        dias: ind.dias,
        diasValor: ind.valor === '…' || ind.valor === '—' ? 'Sin fecha' : ind.valor,
        diasTexto: [ind.titulo, ind.valor, ind.unidad].filter(Boolean).join(' '),
        empresaId: Number(item.empresa_id) || null,
        inicio: this.parseFechaMx(item.fecha_aprobacion),
        fin: this.parseFechaMx(item.fecha_vencimiento)
      });
    }
    return [...mapa.values()];
  }

  private armarGantt(personas: CargaPersona[]): void {
    this.ganttHoyPct = this.porcentajeHoy();
    const filas: GanttFila[] = [];
    for (const persona of personas) {
      for (const item of persona.items) {
        const limites = this.limites(item);
        const detalle = [item.tipo, item.lugar].filter(Boolean).join(' · ');
        filas.push({
          id: `pipc:${item.id}`,
          etiqueta: item.empresa,
          detalle,
          logoUrl: this.logoDe(item.empresaId, item.empresa),
          iniciales: this.iniciales(item.empresa),
          dias: this.etiquetaDias(item),
          color: item.color,
          colorDias: item.diasValor === 'Sin fecha' ? null : item.color,
          titulo: [item.empresa, detalle, item.diasTexto, this.estatusConfig[item.estatus]?.label || item.estatus].filter(Boolean).join(' · '),
          barras: limites ? this.barras(limites.inicio, limites.fin, item.color) : []
        });
      }
    }
    this.ganttFilas = filas;
  }

  private etiquetaDias(item: CargaItem): string {
    if (item.diasValor === 'Sin fecha') return 'Sin fecha';
    const n = Number(item.diasValor);
    if (!Number.isFinite(n)) return item.diasValor;
    return n === 1 ? '1 Día' : `${n} Días`;
  }

  private iniciales(nombre: string): string {
    const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
    return (nombre || '??').substring(0, 2).toUpperCase();
  }

  private responsable(valor?: string): string {
    return String(valor || '').trim() || 'Sin asignar';
  }

  private indicador(item: ResolutivoPipc): IndicadorTiempo {
    const dias = item.dias_hasta_contacto;
    if (item.estatus === 'Vencido') {
      const atraso = dias == null ? 0 : Math.max(0, Math.abs(dias) - 40);
      return {
        modo: 'vencido', dias: atraso, valor: dias == null ? '—' : String(atraso),
        unidad: atraso === 1 ? 'día' : 'días', titulo: 'Vencido hace', subtitulo: ''
      };
    }
    if (dias == null) {
      return { modo: item.estatus === 'En tramite' ? 'tramite' : 'sin_fecha', dias: 0, valor: item.estatus === 'En tramite' ? '…' : '—', unidad: '', titulo: '', subtitulo: '' };
    }
    const faltan = dias + 40;
    if (faltan <= 0) {
      const atraso = Math.abs(faltan);
      return { modo: 'vencido', dias: atraso, valor: String(atraso), unidad: atraso === 1 ? 'día' : 'días', titulo: 'Vencido hace', subtitulo: '' };
    }
    return { modo: 'restante', dias: faltan, valor: String(faltan), unidad: faltan === 1 ? 'día' : 'días', titulo: 'Faltan', subtitulo: '' };
  }

  private parseFechaMx(valor?: string): Date | null {
    const match = String(valor || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  }

  private ventana(): { t0: number; t1: number } {
    return this.ganttVistaAnual
      ? { t0: new Date(this.anio, 10, 1).getTime(), t1: new Date(this.anio + 1, 11, 1).getTime() }
      : { t0: new Date(this.anio, 8, 1).getTime(), t1: new Date(this.anio + 1, 3, 1).getTime() };
  }

  private aplicarVentanaGantt(): void {
    const cortos = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const desde = this.ganttVistaAnual ? new Date(this.anio, 10, 1) : new Date(this.anio, 8, 1);
    const hasta = this.ganttVistaAnual ? new Date(this.anio + 1, 10, 1) : new Date(this.anio + 1, 2, 1);
    const meses: { etiqueta: string; anioOffset: number }[] = [];
    const cursor = new Date(desde);
    while (cursor.getTime() <= hasta.getTime()) {
      meses.push({ etiqueta: cortos[cursor.getMonth()], anioOffset: cursor.getFullYear() - this.anio });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    this.ganttMeses = meses;
    const grupos: { anio: number; columna: string }[] = [];
    meses.forEach((mes, indice) => {
      const anioMes = this.anio + mes.anioOffset;
      const previo = grupos[grupos.length - 1];
      if (!previo || previo.anio !== anioMes) grupos.push({ anio: anioMes, columna: `${indice + 1} / ${indice + 2}` });
      else previo.columna = `${previo.columna.split(' / ')[0]} / ${indice + 2}`;
    });
    this.ganttAnios = grupos;
  }

  private limites(item: CargaItem): { inicio: Date; fin: Date } | null {
    const finReal = item.fin || item.inicio;
    if (!item.inicio && !finReal) return null;
    const hasta = finReal || item.inicio!;
    let desde = item.inicio;
    if (!desde) {
      const { t0 } = this.ventana();
      desde = hasta.getTime() < t0 ? hasta : new Date(t0);
    }
    return { inicio: desde, fin: hasta };
  }

  private geometria(inicio: Date | null, fin: Date | null): { left: number; width: number } | null {
    if (!inicio && !fin) return null;
    const { t0, t1 } = this.ventana();
    const span = t1 - t0;
    let desde = inicio || fin!;
    let hasta = fin || inicio!;
    if (desde.getTime() > hasta.getTime()) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
    const aMs = desde.getTime();
    const bMs = hasta.getTime() + 86400000;
    if (bMs <= t0) return { left: 0, width: 2.2 };
    if (aMs >= t1) return { left: 97.8, width: 2.2 };
    const left = Math.max(0, ((aMs - t0) / span) * 100);
    const right = Math.min(100, ((bMs - t0) / span) * 100);
    const width = Math.max(2.2, right - left);
    return { left: Math.round(left * 100) / 100, width: Math.round(Math.min(width, 100 - left) * 100) / 100 };
  }

  private barras(inicio: Date, fin: Date, color: string): GanttBarra[] {
    const base = this.geometria(inicio, fin);
    if (!base) return [];
    const hoy = this.ganttHoyPct;
    const claro = this.colorClaro(color);
    const finBarra = base.left + base.width;
    if (hoy == null || finBarra <= hoy) return [{ ...base, color, extremo: 'unico' }];
    if (base.left >= hoy) return [{ ...base, color: claro, extremo: 'unico' }];
    const anchoPasado = Math.round((hoy - base.left) * 100) / 100;
    const anchoFuturo = Math.round(Math.min(finBarra - hoy, 100 - hoy) * 100) / 100;
    return [
      { left: base.left, width: Math.max(0.8, anchoPasado), color, extremo: 'inicio' },
      { left: Math.round(hoy * 100) / 100, width: Math.max(0.8, anchoFuturo), color: claro, extremo: 'fin' }
    ];
  }

  private colorClaro(hex: string): string {
    const n = hex.replace('#', '');
    if (n.length !== 6) return hex;
    const canal = (inicio: number) => parseInt(n.slice(inicio, inicio + 2), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.62);
    return `rgb(${mix(canal(0))}, ${mix(canal(2))}, ${mix(canal(4))})`;
  }

  private porcentajeHoy(): number | null {
    const ms = Date.now();
    const { t0, t1 } = this.ventana();
    if (ms < t0 || ms >= t1) return null;
    return Math.round(Math.min(100, Math.max(0, ((ms - t0) / (t1 - t0)) * 100)) * 100) / 100;
  }
}
