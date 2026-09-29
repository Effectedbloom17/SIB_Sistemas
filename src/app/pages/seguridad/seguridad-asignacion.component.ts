import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { environment } from 'src/environments/environment';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { SEG_NORMATIVAS_CATEGORIAS, SegNormativaResumen } from './seguridad-normativas.catalog';

interface EmpresaOpcion {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
  ciudad?: string;
  estado?: string;
}

interface EmpleadoOpcion {
  empleado_id: number;
  nombre: string;
  puesto: string;
}

interface ResponsableAsignado {
  empleado_id: number;
  nombre: string;
  puesto: string;
}

interface NormaAsignada {
  normativa_id: number;
  codigo: string;
  titulo: string;
  categoria_id: string;
  total_requisitos: number;
  empleados: ResponsableAsignado[];
  requisito_ids: number[];
}

interface PuntoNorma {
  id: number;
  punto_norma: string;
  descripcion: string;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  cap: string;
  sec: string;
}

interface CapituloVista {
  clave: string;
  total: number;
  seleccionados: number;
}

interface SeccionVista {
  clave: string;
  puntos: PuntoNorma[];
  seleccionados: number;
  abierto: boolean;
}

interface PayloadAsignacion {
  paso: number;
  normas: Array<{
    normativa_id: number;
    empleados: ResponsableAsignado[];
    requisito_ids: number[];
  }>;
}

interface BorradorLocal {
  pendienteServidor: boolean;
  savedAt: number;
  payload: PayloadAsignacion;
}

type EstadoGuardado = 'limpio' | 'pendiente' | 'guardando' | 'guardado' | 'error';

@Component({
  selector: 'app-seguridad-asignacion',
  templateUrl: './seguridad-asignacion.component.html',
  styleUrls: ['./seguridad.shared.scss', './seguridad-asignacion.component.scss']
})
export class SeguridadAsignacionComponent implements OnInit, OnDestroy {
  readonly categorias = SEG_NORMATIVAS_CATEGORIAS;
  readonly pasos = ['Empresa', 'Normativas', 'Responsables', 'Puntos', 'Publicar'];

  paso = 0;
  empresas: EmpresaOpcion[] = [];
  empresasFiltradas: EmpresaOpcion[] = [];
  busquedaEmpresa = '';
  mostrarDropdownEmpresa = false;
  empresa: EmpresaOpcion | null = null;
  cargandoEmpresas = true;

  catalogo: SegNormativaResumen[] = [];
  catalogoFiltrado: SegNormativaResumen[] = [];
  busquedaNorma = '';
  categoriaActiva = '';
  cargandoCatalogo = true;
  normas: NormaAsignada[] = [];
  publicadasIds = new Set<number>();

  empleados: EmpleadoOpcion[] = [];
  cargandoEmpleados = false;
  comboRespId: number | null = null;
  busquedaResp: Record<number, string> = {};

  normaActivaId: number | null = null;
  puntosCache = new Map<number, PuntoNorma[]>();
  cargandoPuntos = false;
  errorPuntos: string | null = null;
  busquedaPunto = '';
  capituloAbierto: string | null = null;
  seccionesAbiertas = new Set<string>();

  estadoGuardado: EstadoGuardado = 'limpio';
  guardadoPor = '';
  guardadoEn: string | null = null;
  avisoRecuperado = '';
  publicando = false;

  private readonly destroy$ = new Subject<void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sucio = false;
  private enVuelo = false;
  private cargaToken = 0;
  private aplicando = false;

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.cargarEmpresas();
    this.cargarCatalogo();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flush();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:beforeunload')
  alSalir(): void {
    if (!this.empresa || (this.estadoGuardado === 'guardado' && !this.sucio && !this.enVuelo)) return;
    this.persistirLocal(true);
    const token = this.auth.getToken();
    if (!token) return;
    fetch(`${environment.apiUrl}/seguridad/asignacion/borrador`, {
      method: 'PUT',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        empresa_id: this.empresa.empresa_id,
        payload: this.armarPayload()
      })
    }).catch(() => undefined);
  }

  get normaActiva(): NormaAsignada | null {
    return this.normas.find((n) => n.normativa_id === this.normaActivaId) || null;
  }

  get puntosActivos(): PuntoNorma[] {
    if (!this.normaActivaId) return [];
    return this.puntosCache.get(this.normaActivaId) || [];
  }

  get textoGuardado(): string {
    if (this.estadoGuardado === 'guardando' || this.estadoGuardado === 'pendiente') return 'Guardando avance…';
    if (this.estadoGuardado === 'error') return 'Sin conexión. El avance sigue en este equipo.';
    if (this.estadoGuardado === 'guardado' && this.guardadoEn) {
      const hora = new Date(this.guardadoEn);
      const hh = Number.isNaN(hora.getTime())
        ? ''
        : hora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      return hh ? `Avance guardado ${hh}` : 'Avance guardado';
    }
    return 'El avance se guarda solo';
  }

  iniciales(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).slice(0, 2);
    return partes.map((p) => p.charAt(0)).join('').toUpperCase() || 'E';
  }

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backend.obtenerEmpresas().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        const lista = Array.isArray(res?.empresas) ? res.empresas : [];
        this.empresas = lista
          .map((e: any) => ({
            empresa_id: Number(e.empresa_id),
            nombre_empresa: String(e.nombre_empresa || '').trim(),
            rfc: e.rfc || '',
            ciudad: e.ciudad || '',
            estado: e.estado || ''
          }))
          .filter((e: EmpresaOpcion) => e.empresa_id > 0 && e.nombre_empresa)
          .sort((a: EmpresaOpcion, b: EmpresaOpcion) => a.nombre_empresa.localeCompare(b.nombre_empresa, 'es'));
        this.filtrarEmpresas();
        this.cargandoEmpresas = false;
      },
      error: () => {
        this.empresas = [];
        this.empresasFiltradas = [];
        this.cargandoEmpresas = false;
      }
    });
  }

  cargarCatalogo(): void {
    this.cargandoCatalogo = true;
    this.backend.listarSeguridadNormativas().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.catalogo = res?.normativas || [];
        this.aplicarFiltroNormas();
        this.cargandoCatalogo = false;
        this.hidratarNormasSeleccionadas();
      },
      error: () => {
        this.catalogo = [];
        this.cargandoCatalogo = false;
      }
    });
  }

  filtrarEmpresas(): void {
    const q = this.busquedaEmpresa.trim().toLowerCase();
    const base = !q
      ? this.empresas
      : this.empresas.filter((e) =>
        e.nombre_empresa.toLowerCase().includes(q) ||
        (e.rfc || '').toLowerCase().includes(q) ||
        (e.ciudad || '').toLowerCase().includes(q)
      );
    this.empresasFiltradas = base.slice(0, 40);
  }

  mostrarEmpresas(): void {
    this.mostrarDropdownEmpresa = true;
    this.filtrarEmpresas();
  }

  ocultarDropdownEmpresa(): void {
    setTimeout(() => { this.mostrarDropdownEmpresa = false; }, 180);
  }

  seleccionarEmpresa(empresa: EmpresaOpcion): void {
    if (this.empresa?.empresa_id === empresa.empresa_id) {
      this.mostrarDropdownEmpresa = false;
      return;
    }
    this.flush();
    this.empresa = empresa;
    this.busquedaEmpresa = empresa.nombre_empresa;
    this.mostrarDropdownEmpresa = false;
    this.reiniciarTrabajo();
    this.cargarEmpleados(empresa.empresa_id);
    this.cargarEstado(empresa.empresa_id);
  }

  limpiarEmpresa(): void {
    this.flush();
    this.empresa = null;
    this.busquedaEmpresa = '';
    this.reiniciarTrabajo();
    this.paso = 0;
  }

  private reiniciarTrabajo(): void {
    this.normas = [];
    this.publicadasIds = new Set();
    this.empleados = [];
    this.normaActivaId = null;
    this.capituloAbierto = null;
    this.busquedaPunto = '';
    this.avisoRecuperado = '';
    this.estadoGuardado = 'limpio';
    this.guardadoPor = '';
    this.guardadoEn = null;
    this.sucio = false;
  }

  private cargarEmpleados(empresaId: number): void {
    this.cargandoEmpleados = true;
    this.backend.obtenerEmpleadosPorEmpresa(empresaId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        if (this.empresa?.empresa_id !== empresaId) return;
        const lista = Array.isArray(res?.empleados) ? res.empleados : [];
        this.empleados = lista
          .filter((e: any) => e.activo === 1 || e.activo === true || e.activo === '1' || e.activo === undefined || e.activo === null)
          .map((e: any) => ({
            empleado_id: Number(e.empleado_id),
            nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ').trim(),
            puesto: String(e.puesto || '').trim()
          }))
          .filter((e: EmpleadoOpcion) => e.empleado_id > 0 && e.nombre)
          .sort((a: EmpleadoOpcion, b: EmpleadoOpcion) => a.nombre.localeCompare(b.nombre, 'es'));
        this.cargandoEmpleados = false;
      },
      error: () => {
        if (this.empresa?.empresa_id !== empresaId) return;
        this.empleados = [];
        this.cargandoEmpleados = false;
      }
    });
  }

  private cargarEstado(empresaId: number): void {
    const token = ++this.cargaToken;
    this.backend.obtenerEstadoSeguridadAsignacion(empresaId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        if (token !== this.cargaToken || this.empresa?.empresa_id !== empresaId) return;
        this.publicadasIds = new Set((res?.publicada_ids || []).map((id: any) => Number(id)));
        const local = this.leerLocal(empresaId);
        this.aplicando = true;
        if (local?.pendienteServidor) {
          this.aplicarPayload(local.payload);
          this.avisoRecuperado = 'Se recuperó el avance que no había llegado al servidor.';
          this.aplicando = false;
          this.marcarCambio();
          return;
        }
        if (res?.borrador?.payload) {
          this.aplicarPayload(res.borrador.payload);
          this.guardadoPor = res.borrador.actualizado_por || '';
          this.guardadoEn = res.borrador.updated_at || null;
          this.estadoGuardado = 'guardado';
          this.avisoRecuperado = 'Continuamos con el borrador guardado de esta empresa.';
        } else if (res?.publicada?.normas?.length) {
          this.aplicarPayload(res.publicada);
          this.estadoGuardado = 'guardado';
          this.avisoRecuperado = 'Esta empresa ya tiene normativas en gestión. Puede ajustarlas y volver a publicar.';
        }
        this.aplicando = false;
      },
      error: () => {
        if (token !== this.cargaToken) return;
        const local = this.leerLocal(empresaId);
        if (local) {
          this.aplicando = true;
          this.aplicarPayload(local.payload);
          this.aplicando = false;
          this.avisoRecuperado = 'Se recuperó el avance guardado en este equipo.';
          if (local.pendienteServidor) this.marcarCambio();
        }
      }
    });
  }

  aplicarFiltroNormas(): void {
    const q = this.busquedaNorma.trim().toLowerCase();
    this.catalogoFiltrado = this.catalogo.filter((n) => {
      if (this.categoriaActiva && n.categoria_id !== this.categoriaActiva) return false;
      if (!q) return true;
      return n.codigo.toLowerCase().includes(q) || n.titulo.toLowerCase().includes(q);
    });
  }

  seleccionarCategoria(id: string): void {
    this.categoriaActiva = this.categoriaActiva === id ? '' : id;
    this.aplicarFiltroNormas();
  }

  contarPorCategoria(id: string): number {
    return this.catalogo.filter((n) => n.categoria_id === id).length;
  }

  estaSeleccionada(id: number): boolean {
    return this.normas.some((n) => n.normativa_id === id);
  }

  toggleNorma(item: SegNormativaResumen): void {
    const idx = this.normas.findIndex((n) => n.normativa_id === item.id);
    if (idx >= 0) {
      const norma = this.normas[idx];
      const tieneTrabajo = norma.empleados.length > 0 || norma.requisito_ids.length > 0;
      if (tieneTrabajo) {
        Swal.fire({
          title: `Quitar ${item.codigo}`,
          text: 'Se perderán los responsables y puntos marcados de esta normativa en el borrador.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Quitar',
          cancelButtonText: 'Cancelar',
          confirmButtonColor: '#b91c1c'
        }).then((r) => {
          if (!r.isConfirmed) return;
          this.normas = this.normas.filter((n) => n.normativa_id !== item.id);
          if (this.normaActivaId === item.id) this.normaActivaId = this.normas[0]?.normativa_id || null;
          this.marcarCambio();
        });
        return;
      }
      this.normas = this.normas.filter((n) => n.normativa_id !== item.id);
      if (this.normaActivaId === item.id) this.normaActivaId = this.normas[0]?.normativa_id || null;
    } else {
      this.normas = [...this.normas, this.nuevaNorma(item)];
    }
    this.marcarCambio();
  }

  seleccionarVisibles(): void {
    const ids = new Set(this.normas.map((n) => n.normativa_id));
    const agregar = this.catalogoFiltrado
      .filter((n) => !ids.has(n.id))
      .map((n) => this.nuevaNorma(n));
    this.normas = [...this.normas, ...agregar];
    this.marcarCambio();
  }

  private nuevaNorma(item: SegNormativaResumen): NormaAsignada {
    return {
      normativa_id: item.id,
      codigo: item.codigo,
      titulo: item.titulo,
      categoria_id: item.categoria_id,
      total_requisitos: item.total_requisitos || 0,
      empleados: [],
      requisito_ids: []
    };
  }

  empleadosFiltrados(norma: NormaAsignada): EmpleadoOpcion[] {
    const q = String(this.busquedaResp[norma.normativa_id] || '').trim().toLowerCase();
    const tomados = new Set(norma.empleados.map((e) => e.empleado_id));
    return this.empleados
      .filter((e) => !tomados.has(e.empleado_id))
      .filter((e) => !q || e.nombre.toLowerCase().includes(q) || e.puesto.toLowerCase().includes(q))
      .slice(0, 25);
  }

  abrirResp(norma: NormaAsignada): void {
    if (norma.empleados.length >= 2) return;
    this.comboRespId = norma.normativa_id;
  }

  cerrarResp(): void {
    setTimeout(() => { this.comboRespId = null; }, 180);
  }

  agregarResponsable(norma: NormaAsignada, empleado: EmpleadoOpcion): void {
    if (norma.empleados.length >= 2) return;
    if (norma.empleados.some((e) => e.empleado_id === empleado.empleado_id)) return;
    norma.empleados = [...norma.empleados, {
      empleado_id: empleado.empleado_id,
      nombre: empleado.nombre,
      puesto: empleado.puesto
    }];
    this.busquedaResp[norma.normativa_id] = '';
    this.comboRespId = null;
    this.marcarCambio();
  }

  quitarResponsable(norma: NormaAsignada, empleadoId: number): void {
    norma.empleados = norma.empleados.filter((e) => e.empleado_id !== empleadoId);
    this.marcarCambio();
  }

  copiarResponsables(origen: NormaAsignada): void {
    if (!origen.empleados.length) return;
    this.normas.forEach((norma) => {
      if (norma.normativa_id === origen.normativa_id) return;
      norma.empleados = origen.empleados.map((e) => ({ ...e }));
    });
    this.marcarCambio();
  }

  abrirNormaPuntos(norma: NormaAsignada): void {
    this.normaActivaId = norma.normativa_id;
    this.busquedaPunto = '';
    this.capituloAbierto = null;
    this.seccionesAbiertas.clear();
    this.errorPuntos = null;
    if (this.puntosCache.has(norma.normativa_id)) return;
    this.cargandoPuntos = true;
    this.backend.listarPuntosSeguridadAsignacion(norma.normativa_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const puntos = (res?.puntos || []).map((p: any) => this.etiquetarPunto(p));
          this.puntosCache.set(norma.normativa_id, puntos);
          this.cargandoPuntos = false;
        },
        error: (err: any) => {
          this.errorPuntos = err?.error?.message || 'No se pudieron cargar los puntos.';
          this.cargandoPuntos = false;
        }
      });
  }

  private etiquetarPunto(raw: any): PuntoNorma {
    const punto = String(raw.punto_norma || '').trim();
    const partes = punto.split('.').filter(Boolean);
    return {
      id: Number(raw.id),
      punto_norma: punto,
      descripcion: String(raw.descripcion || '').trim(),
      tipo_evidencia: raw.tipo_evidencia || null,
      periodicidad: raw.periodicidad || null,
      cap: partes[0] || 'General',
      sec: partes.length >= 2 ? `${partes[0]}.${partes[1]}` : (punto || 'General')
    };
  }

  estaPunto(norma: NormaAsignada | null, id: number): boolean {
    return !!norma?.requisito_ids.includes(id);
  }

  togglePunto(norma: NormaAsignada, id: number): void {
    if (norma.requisito_ids.includes(id)) {
      norma.requisito_ids = norma.requisito_ids.filter((x) => x !== id);
    } else {
      norma.requisito_ids = [...norma.requisito_ids, id];
    }
    this.marcarCambio();
  }

  capitulos(norma: NormaAsignada): CapituloVista[] {
    const puntos = this.puntosCache.get(norma.normativa_id) || [];
    const mapa = new Map<string, CapituloVista>();
    for (const p of puntos) {
      let cap = mapa.get(p.cap);
      if (!cap) {
        cap = { clave: p.cap, total: 0, seleccionados: 0 };
        mapa.set(p.cap, cap);
      }
      cap.total += 1;
      if (norma.requisito_ids.includes(p.id)) cap.seleccionados += 1;
    }
    return Array.from(mapa.values()).sort((a, b) => {
      if (a.clave === 'General') return 1;
      if (b.clave === 'General') return -1;
      return a.clave.localeCompare(b.clave, 'es', { numeric: true });
    });
  }

  seccionesCapitulo(norma: NormaAsignada): SeccionVista[] {
    if (!this.capituloAbierto) return [];
    const puntos = (this.puntosCache.get(norma.normativa_id) || [])
      .filter((p) => p.cap === this.capituloAbierto);
    const mapa = new Map<string, PuntoNorma[]>();
    for (const p of puntos) {
      if (!mapa.has(p.sec)) mapa.set(p.sec, []);
      mapa.get(p.sec)!.push(p);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
      .map(([clave, lista]) => ({
        clave,
        puntos: lista,
        seleccionados: lista.filter((p) => norma.requisito_ids.includes(p.id)).length,
        abierto: this.seccionesAbiertas.has(clave)
      }));
  }

  puntosDelCapitulo(norma: NormaAsignada): PuntoNorma[] {
    if (!this.capituloAbierto) return [];
    return (this.puntosCache.get(norma.normativa_id) || [])
      .filter((p) => p.cap === this.capituloAbierto);
  }

  toggleSeccion(clave: string): void {
    if (this.seccionesAbiertas.has(clave)) this.seccionesAbiertas.delete(clave);
    else this.seccionesAbiertas.add(clave);
  }

  abrirCapitulo(clave: string): void {
    this.capituloAbierto = clave;
    const primera = (this.puntosCache.get(this.normaActivaId || 0) || [])
      .find((p) => p.cap === clave);
    this.seccionesAbiertas = new Set(primera ? [primera.sec] : []);
  }

  volverCapitulos(): void {
    this.capituloAbierto = null;
    this.seccionesAbiertas.clear();
  }

  toggleGrupo(norma: NormaAsignada, puntos: PuntoNorma[]): void {
    if (!puntos.length) return;
    const todos = puntos.every((p) => norma.requisito_ids.includes(p.id));
    const ids = new Set(puntos.map((p) => p.id));
    if (todos) {
      norma.requisito_ids = norma.requisito_ids.filter((id) => !ids.has(id));
    } else {
      const actual = new Set(norma.requisito_ids);
      puntos.forEach((p) => actual.add(p.id));
      norma.requisito_ids = Array.from(actual);
    }
    this.marcarCambio();
  }

  seleccionarTodosPuntos(norma: NormaAsignada): void {
    const puntos = this.puntosCache.get(norma.normativa_id) || [];
    if (puntos.length > 80) {
      Swal.fire({
        title: `Marcar ${puntos.length} puntos`,
        text: 'Puede dejar marcada toda la norma y después quitar capítulos que no apliquen.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Marcar todos',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#b91c1c'
      }).then((r) => {
        if (!r.isConfirmed) return;
        norma.requisito_ids = puntos.map((p) => p.id);
        this.marcarCambio();
      });
      return;
    }
    norma.requisito_ids = puntos.map((p) => p.id);
    this.marcarCambio();
  }

  limpiarPuntos(norma: NormaAsignada): void {
    norma.requisito_ids = [];
    this.marcarCambio();
  }

  resultadosBusqueda(norma: NormaAsignada): PuntoNorma[] {
    const q = this.busquedaPunto.trim().toLowerCase();
    if (q.length < 2) return [];
    const puntos = this.puntosCache.get(norma.normativa_id) || [];
    return puntos.filter((p) =>
      p.punto_norma.toLowerCase().includes(q) ||
      p.descripcion.toLowerCase().includes(q) ||
      (p.tipo_evidencia || '').toLowerCase().includes(q)
    ).slice(0, 80);
  }

  totalCoincidencias(norma: NormaAsignada): number {
    const q = this.busquedaPunto.trim().toLowerCase();
    if (q.length < 2) return 0;
    const puntos = this.puntosCache.get(norma.normativa_id) || [];
    return puntos.filter((p) =>
      p.punto_norma.toLowerCase().includes(q) ||
      p.descripcion.toLowerCase().includes(q) ||
      (p.tipo_evidencia || '').toLowerCase().includes(q)
    ).length;
  }

  irAPaso(destino: number): void {
    if (destino === this.paso) return;
    if (destino < this.paso) {
      this.paso = destino;
      this.persistirPaso();
      return;
    }
    for (let i = this.paso; i < destino; i++) {
      if (!this.pasoValido(i)) {
        this.paso = i;
        this.avisarPaso(i);
        return;
      }
    }
    this.paso = destino;
    this.persistirPaso();
    if (destino === 3 && this.normas.length && !this.normaActivaId) {
      this.abrirNormaPuntos(this.normas[0]);
    }
  }

  siguiente(): void {
    if (!this.pasoValido(this.paso)) {
      this.avisarPaso(this.paso);
      return;
    }
    this.paso = Math.min(4, this.paso + 1);
    this.persistirPaso();
    if (this.paso === 3 && this.normas.length) {
      this.abrirNormaPuntos(this.normaActiva || this.normas[0]);
    }
  }

  anterior(): void {
    this.paso = Math.max(0, this.paso - 1);
    this.persistirPaso();
  }

  private persistirPaso(): void {
    if (this.empresa) this.marcarCambio();
  }

  private pasoValido(indice: number): boolean {
    if (indice === 0) return !!this.empresa;
    if (indice === 1) return this.normas.length > 0;
    if (indice === 2) return this.normas.every((n) => n.empleados.length >= 1 && n.empleados.length <= 2);
    if (indice === 3) return this.normas.every((n) => n.requisito_ids.length > 0);
    return true;
  }

  private avisarPaso(indice: number): void {
    const mensajes = [
      'Seleccione la empresa a la que se aplicarán las normativas.',
      'Seleccione al menos una normativa del catálogo.',
      'Cada normativa necesita de 1 a 2 responsables. Una persona puede cubrir varias.',
      'Marque al menos un punto en cada normativa seleccionada.'
    ];
    Swal.fire({
      icon: 'info',
      title: 'Falta un paso',
      text: mensajes[indice] || 'Revise la selección.',
      confirmButtonColor: '#b91c1c'
    });
  }

  normasSinResponsable(): number {
    return this.normas.filter((n) => n.empleados.length < 1).length;
  }

  normasSinPuntos(): number {
    return this.normas.filter((n) => n.requisito_ids.length < 1).length;
  }

  totalPuntosMarcados(): number {
    return this.normas.reduce((sum, n) => sum + n.requisito_ids.length, 0);
  }

  publicar(): void {
    if (!this.empresa || this.publicando) return;
    for (let i = 0; i <= 3; i++) {
      if (!this.pasoValido(i)) {
        this.paso = i;
        this.avisarPaso(i);
        return;
      }
    }
    const retiradas = [...this.publicadasIds].filter((id) => !this.normas.some((n) => n.normativa_id === id)).length;
    const extra = retiradas
      ? ` Se retirarán ${retiradas} normativa(s) que ya estaban en gestión y quedaron fuera.`
      : '';
    Swal.fire({
      title: 'Publicar en Gestión de Normativas',
      text: `Se asignarán ${this.normas.length} normativa(s) a ${this.empresa.nombre_empresa}.${extra}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Publicar',
      cancelButtonText: 'Seguir editando',
      confirmButtonColor: '#b91c1c'
    }).then((r) => {
      if (!r.isConfirmed || !this.empresa) return;
      this.publicando = true;
      this.backend.publicarSeguridadAsignacion(this.empresa.empresa_id, this.armarPayload())
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.publicando = false;
            this.borrarLocal(this.empresa!.empresa_id);
            this.sucio = false;
            this.estadoGuardado = 'guardado';
            Swal.fire({
              icon: 'success',
              title: 'Asignación publicada',
              text: 'Ya puede cargar documentos en Gestión de Normativas.',
              confirmButtonText: 'Ir a gestión',
              showCancelButton: true,
              cancelButtonText: 'Quedarme aquí',
              confirmButtonColor: '#b91c1c'
            }).then((go) => {
              if (go.isConfirmed && this.empresa) {
                this.router.navigate(['/seguridad/gestion'], {
                  queryParams: { empresa: this.empresa.empresa_id }
                });
              }
            });
          },
          error: (err: any) => {
            this.publicando = false;
            Swal.fire({
              icon: 'error',
              title: 'No se publicó',
              text: err?.error?.message || 'Revise responsables y puntos.',
              confirmButtonColor: '#b91c1c'
            });
          }
        });
    });
  }

  private marcarCambio(): void {
    if (this.aplicando || !this.empresa) return;
    this.sucio = true;
    this.estadoGuardado = 'pendiente';
    this.persistirLocal(true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 700);
  }

  private armarPayload(): PayloadAsignacion {
    return {
      paso: this.paso,
      normas: this.normas.map((n) => ({
        normativa_id: n.normativa_id,
        empleados: n.empleados.map((e) => ({ ...e })),
        requisito_ids: [...n.requisito_ids]
      }))
    };
  }

  private aplicarPayload(payload: PayloadAsignacion | null | undefined): void {
    const normas = Array.isArray(payload?.normas) ? payload!.normas : [];
    this.paso = Math.max(0, Math.min(4, Number(payload?.paso) || 0));
    this.normas = normas.map((item) => {
      const cat = this.catalogo.find((c) => c.id === Number(item.normativa_id));
      return {
        normativa_id: Number(item.normativa_id),
        codigo: cat?.codigo || `Norma ${item.normativa_id}`,
        titulo: cat?.titulo || 'Normativa del catálogo',
        categoria_id: cat?.categoria_id || '',
        total_requisitos: cat?.total_requisitos || item.requisito_ids?.length || 0,
        empleados: (item.empleados || []).slice(0, 2).map((e) => ({
          empleado_id: Number(e.empleado_id),
          nombre: e.nombre || `Empleado ${e.empleado_id}`,
          puesto: e.puesto || ''
        })),
        requisito_ids: (item.requisito_ids || []).map((id) => Number(id)).filter((id) => id > 0)
      };
    }).filter((n) => n.normativa_id > 0);
    if (this.paso >= 3 && this.normas.length) {
      this.abrirNormaPuntos(this.normas[0]);
    }
  }

  private hidratarNormasSeleccionadas(): void {
    this.normas = this.normas.map((n) => {
      const cat = this.catalogo.find((c) => c.id === n.normativa_id);
      if (!cat) return n;
      return {
        ...n,
        codigo: cat.codigo,
        titulo: cat.titulo,
        categoria_id: cat.categoria_id,
        total_requisitos: cat.total_requisitos || n.total_requisitos
      };
    });
  }

  private claveLocal(empresaId: number): string {
    return `sib.seg.asignacion.${empresaId}`;
  }

  private persistirLocal(pendiente: boolean): void {
    if (!this.empresa) return;
    const data: BorradorLocal = {
      pendienteServidor: pendiente,
      savedAt: Date.now(),
      payload: this.armarPayload()
    };
    try {
      localStorage.setItem(this.claveLocal(this.empresa.empresa_id), JSON.stringify(data));
    } catch {
      /* cuota llena: el servidor sigue siendo el respaldo */
    }
  }

  private leerLocal(empresaId: number): BorradorLocal | null {
    try {
      const raw = localStorage.getItem(this.claveLocal(empresaId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.payload) return null;
      return data as BorradorLocal;
    } catch {
      return null;
    }
  }

  private borrarLocal(empresaId: number): void {
    localStorage.removeItem(this.claveLocal(empresaId));
  }

  private flush(): void {
    if (!this.empresa || !this.sucio || this.enVuelo) return;
    this.sucio = false;
    this.enVuelo = true;
    this.estadoGuardado = 'guardando';
    const empresaId = this.empresa.empresa_id;
    this.backend.guardarBorradorSeguridadAsignacion(empresaId, this.armarPayload())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.enVuelo = false;
          if (this.empresa?.empresa_id !== empresaId) return;
          if (this.sucio) {
            this.flush();
            return;
          }
          this.persistirLocal(false);
          this.guardadoEn = res?.updated_at || new Date().toISOString();
          this.guardadoPor = res?.actualizado_por || '';
          this.estadoGuardado = 'guardado';
        },
        error: () => {
          this.enVuelo = false;
          this.sucio = true;
          this.persistirLocal(true);
          if (this.empresa?.empresa_id === empresaId) this.estadoGuardado = 'error';
        }
      });
  }
}
