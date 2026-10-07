import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  logo?: string | null;
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

interface ImagenPunto {
  id: number;
  ruta: string;
  nombre: string;
}

interface PuntoNorma {
  id: number;
  punto_norma: string;
  descripcion: string;
  descripcion_html: string | null;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  evidencia_requerida: string | null;
  formato_nombre: string | null;
  imagenes: ImagenPunto[];
  cap: string;
  sec: string;
}

interface CapituloVista {
  clave: string;
  total: number;
  seleccionados: number;
}

interface PayloadAsignacion {
  paso: number;
  vista?: string;
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
  readonly pasos = ['Asignación', 'Puntos', 'Resumen'];

  @ViewChild('empBox') empBox?: ElementRef<HTMLElement>;
  @ViewChild('anclaEmpresa') anclaEmpresa?: ElementRef<HTMLElement>;
  @ViewChild('anclaNormas') anclaNormas?: ElementRef<HTMLElement>;
  @ViewChild('anclaResp') anclaResp?: ElementRef<HTMLElement>;

  paso = 0;
  /** Paso más alto ya alcanzado en el borrador. No cambia la vista al elegir empresa. */
  progreso = 0;
  bloqueActivo: 'empresa' | 'normas' | 'resp' = 'empresa';
  listaEmpresasAbierta = false;
  empresaColapsada = false;
  empresas: EmpresaOpcion[] = [];
  empresasFiltradas: EmpresaOpcion[] = [];
  busquedaEmpresa = '';
  empresa: EmpresaOpcion | null = null;
  cargandoEmpresas = true;

  catalogo: SegNormativaResumen[] = [];
  catalogoFiltrado: SegNormativaResumen[] = [];
  busquedaNorma = '';
  categoriaActiva = '';
  cargandoCatalogo = true;
  normas: NormaAsignada[] = [];
  publicadasIds = new Set<number>();

  usuarios: EmpleadoOpcion[] = [];
  usuariosFiltrados: EmpleadoOpcion[] = [];
  cargandoUsuarios = false;
  busquedaUsuario = '';
  normaFocoId: number | null = null;

  normaActivaId: number | null = null;
  puntosCache = new Map<number, PuntoNorma[]>();
  cargandoPuntos = false;
  errorPuntos: string | null = null;
  busquedaPunto = '';
  filtroEvidencia: '' | 'documental' | 'fisico' = '';
  puntoEnfoque: PuntoNorma | null = null;
  /** Id del punto fijado con clic. Mientras exista, el hover solo remarca y no cambia el detalle. */
  puntoFijadoId: number | null = null;
  puntoHoverId: number | null = null;
  fichaAnim = 0;
  fichaMovil = false;
  imagenAbierta: string | null = null;
  lecturaHtml: SafeHtml | null = null;
  imagenesSobrantes: ImagenPunto[] = [];
  resumenNormaId: number | null = null;
  resumenGrupos: Array<{ clave: string; puntos: PuntoNorma[] }> = [];
  resumenPuntoId: number | null = null;
  resumenFloatTip: {
    top: number;
    left: number;
    width: number;
    flecha: number;
    titulo: string;
    texto: string;
  } | null = null;
  readonly usaHover = typeof window !== 'undefined'
    && !!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  capitulosAbiertos = new Set<string>();

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
    private router: Router,
    private ngZone: NgZone,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.cargarEmpresas();
    this.cargarCatalogo();
    this.cargarUsuarios();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flush();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click', ['$event'])
  cerrarBuscadorEmpresa(ev: MouseEvent): void {
    const caja = this.empBox?.nativeElement;
    const nodo = ev.target as Node | null;
    if (!caja || !nodo || caja.contains(nodo)) return;
    this.listaEmpresasAbierta = false;
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

  nombreCorto(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes[1]}`;
  }

  iconoCategoria(id: string): string {
    return this.categorias.find((c) => c.id === id)?.iconClass || 'fas fa-book';
  }

  urlPortada(item: SegNormativaResumen): string | null {
    const ruta = item.imagen_portada;
    if (!ruta) return null;
    if (/^https?:/i.test(ruta)) return ruta;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  }

  abrirBuscadorEmpresa(): void {
    this.listaEmpresasAbierta = true;
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
            estado: e.estado || '',
            logo: e.logo || e.logo_url || null
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
    this.empresasFiltradas = !q
      ? [...this.empresas]
      : this.empresas.filter((e) =>
        e.nombre_empresa.toLowerCase().includes(q) ||
        (e.rfc || '').toLowerCase().includes(q) ||
        (e.ciudad || '').toLowerCase().includes(q)
      );
  }

  logoEmpresa(empresa: EmpresaOpcion): string | null {
    return this.backend.resolverUrlDrivePreview(empresa.logo);
  }

  seleccionarEmpresa(empresa: EmpresaOpcion): void {
    if (this.empresa?.empresa_id === empresa.empresa_id) {
      this.listaEmpresasAbierta = false;
      return;
    }
    this.flush();
    this.empresa = empresa;
    this.paso = 0;
    this.listaEmpresasAbierta = false;
    this.busquedaEmpresa = '';
    this.filtrarEmpresas();
    this.reiniciarTrabajo();
    this.empresaColapsada = true;
    this.bloqueActivo = 'normas';
    this.cargarEstado(empresa.empresa_id);
  }

  irBloque(bloque: 'empresa' | 'normas' | 'resp'): void {
    if (bloque === 'normas' && !this.empresa) return;
    if (bloque === 'resp' && !this.normas.length) return;
    this.bloqueActivo = bloque;
    if (bloque === 'empresa') this.empresaColapsada = false;
    this.desplazarAlBloque(bloque);
  }

  expandirEmpresa(): void {
    this.empresaColapsada = false;
    this.bloqueActivo = 'empresa';
    this.desplazarAlBloque('empresa');
  }

  copiarDesdeFoco(): void {
    const norma = this.normaEnFoco();
    if (norma) this.copiarResponsables(norma);
  }

  limpiarEmpresa(): void {
    this.flush();
    this.empresa = null;
    this.busquedaEmpresa = '';
    this.reiniciarTrabajo();
    this.paso = 0;
    this.progreso = 0;
    this.bloqueActivo = 'empresa';
    this.empresaColapsada = false;
  }

  private reiniciarTrabajo(): void {
    this.normas = [];
    this.publicadasIds = new Set();
    this.normaFocoId = null;
    this.normaActivaId = null;
    this.capitulosAbiertos = new Set();
    this.busquedaPunto = '';
    this.avisoRecuperado = '';
    this.estadoGuardado = 'limpio';
    this.guardadoPor = '';
    this.guardadoEn = null;
    this.sucio = false;
  }

  private cargarUsuarios(): void {
    this.cargandoUsuarios = true;
    this.backend.obtenerUsuarios().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        const lista = Array.isArray(res?.usuarios) ? res.usuarios : [];
        this.usuarios = lista
          .filter((u: any) => {
            const rol = String(u?.rol || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            return rol !== 'empresa' && rol !== 'usuario empresa';
          })
          .map((u: any) => ({
            empleado_id: Number(u.id || u.usuario_id || 0),
            nombre: [u.nombre, u.apellido, u.apellido_paterno, u.apellido_materno]
              .map((p: any) => String(p || '').trim()).filter(Boolean).join(' ') || String(u.username || u.email || '').trim(),
            puesto: String(u.rol || u.area_departamento || '').trim()
          }))
          .filter((u: EmpleadoOpcion) => u.empleado_id > 0 && !!u.nombre)
          .sort((a: EmpleadoOpcion, b: EmpleadoOpcion) => a.nombre.localeCompare(b.nombre, 'es'));
        this.filtrarUsuarios();
        this.cargandoUsuarios = false;
        this.limpiarResponsablesAjenos();
      },
      error: () => {
        this.usuarios = [];
        this.usuariosFiltrados = [];
        this.cargandoUsuarios = false;
      }
    });
  }

  filtrarUsuarios(): void {
    const q = this.busquedaUsuario.trim().toLowerCase();
    this.usuariosFiltrados = !q
      ? [...this.usuarios]
      : this.usuarios.filter((u) =>
        u.nombre.toLowerCase().includes(q) || u.puesto.toLowerCase().includes(q)
      );
  }

  private limpiarResponsablesAjenos(): void {
    if (!this.usuarios.length || !this.normas.length) return;
    const validos = new Set(this.usuarios.map((u) => u.empleado_id));
    let quito = false;
    for (const norma of this.normas) {
      const siguientes = norma.empleados.filter((e) => validos.has(e.empleado_id));
      if (siguientes.length !== norma.empleados.length) {
        norma.empleados = siguientes;
        quito = true;
      }
    }
    if (quito && !this.aplicando) this.marcarCambio();
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
          this.enfocarAsignacion();
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
        this.enfocarAsignacion();
      },
      error: () => {
        if (token !== this.cargaToken) return;
        const local = this.leerLocal(empresaId);
        if (local) {
          this.aplicando = true;
          this.aplicarPayload(local.payload);
          this.aplicando = false;
          this.avisoRecuperado = 'Se recuperó el avance guardado en este equipo.';
          this.enfocarAsignacion();
          if (local.pendienteServidor) this.marcarCambio();
        } else {
          this.enfocarAsignacion();
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
          if (this.normaFocoId === item.id) this.normaFocoId = this.normas[0]?.normativa_id || null;
          this.marcarCambio();
        });
        return;
      }
      this.normas = this.normas.filter((n) => n.normativa_id !== item.id);
      if (this.normaActivaId === item.id) this.normaActivaId = this.normas[0]?.normativa_id || null;
      if (this.normaFocoId === item.id) this.normaFocoId = this.normas[0]?.normativa_id || null;
    } else {
      const norma = this.nuevaNorma(item);
      this.normas = [...this.normas, norma];
      this.normaFocoId = item.id;
      this.marcarCambio();
      this.pedirResponsable(norma);
      return;
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

  enfocarNorma(norma: NormaAsignada): void {
    this.normaFocoId = norma.normativa_id;
  }

  normaEnFoco(): NormaAsignada | null {
    return this.normas.find((n) => n.normativa_id === this.normaFocoId) || this.normas[0] || null;
  }

  usuarioAsignado(norma: NormaAsignada | null, usuarioId: number): boolean {
    return !!norma?.empleados.some((e) => e.empleado_id === usuarioId);
  }

  alternarUsuario(usuario: EmpleadoOpcion): void {
    const norma = this.normaEnFoco();
    if (!norma) return;
    if (this.usuarioAsignado(norma, usuario.empleado_id)) {
      this.quitarResponsable(norma, usuario.empleado_id);
      return;
    }
    norma.empleados = [{
      empleado_id: usuario.empleado_id,
      nombre: usuario.nombre,
      puesto: usuario.puesto
    }];
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
    this.filtroEvidencia = '';
    this.puntoEnfoque = null;
    this.puntoFijadoId = null;
    this.puntoHoverId = null;
    this.fichaAnim = 0;
    this.fichaMovil = false;
    this.imagenAbierta = null;
    this.lecturaHtml = null;
    this.imagenesSobrantes = [];
    this.capitulosAbiertos = new Set();
    this.errorPuntos = null;
    if (this.puntosCache.has(norma.normativa_id)) {
      this.abrirPrimerCapitulo(norma);
      return;
    }
    this.cargandoPuntos = true;
    this.backend.listarPuntosSeguridadAsignacion(norma.normativa_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const puntos = (res?.puntos || []).map((p: any) => this.etiquetarPunto(p));
          this.puntosCache.set(norma.normativa_id, puntos);
          this.cargandoPuntos = false;
          this.abrirPrimerCapitulo(norma);
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
      descripcion_html: raw.descripcion_html ? String(raw.descripcion_html) : null,
      tipo_evidencia: raw.tipo_evidencia || null,
      periodicidad: raw.periodicidad || null,
      evidencia_requerida: raw.evidencia_requerida || null,
      formato_nombre: raw.formato_nombre || null,
      imagenes: Array.isArray(raw.imagenes)
        ? raw.imagenes.map((img: any) => ({
          id: Number(img.id),
          ruta: String(img.ruta || ''),
          nombre: String(img.nombre || '')
        })).filter((img: ImagenPunto) => !!img.ruta)
        : [],
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

  puntosDeCapitulo(norma: NormaAsignada, clave: string): PuntoNorma[] {
    return (this.puntosCache.get(norma.normativa_id) || []).filter((p) => p.cap === clave);
  }

  capituloAbierto(clave: string): boolean {
    return this.capitulosAbiertos.has(clave);
  }

  totalPuntosNorma(norma: NormaAsignada): number {
    return norma.total_requisitos || this.puntosCache.get(norma.normativa_id)?.length || 0;
  }

  porcentajePuntos(norma: NormaAsignada): number {
    const total = this.totalPuntosNorma(norma);
    if (!total) return 0;
    return Math.min(100, (norma.requisito_ids.length / total) * 100);
  }

  grupoMarcado(norma: NormaAsignada, puntos: PuntoNorma[]): boolean {
    return puntos.length > 0 && puntos.every((p) => norma.requisito_ids.includes(p.id));
  }

  tonoEvidencia(tipo: string | null): string {
    const t = (tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const documental = t.includes('DOCUMENTAL');
    const fisico = t.includes('FISICO');
    if (documental && fisico) return 'mixto';
    if (fisico) return 'fisico';
    if (documental) return 'documental';
    return 'otro';
  }

  etiquetaEvidencia(tipo: string | null): string {
    const tono = this.tonoEvidencia(tipo);
    if (tono === 'documental') return 'Documental';
    if (tono === 'fisico') return 'Físico';
    if (tono === 'mixto') return 'Doc. o físico';
    const limpio = String(tipo || '').trim();
    return limpio.length > 16 ? `${limpio.slice(0, 14).trim()}…` : limpio;
  }

  tonosDisponibles(): string[] {
    const set = new Set<string>();
    for (const punto of this.puntosActivos) {
      const tono = this.tonoEvidencia(punto.tipo_evidencia);
      if (tono === 'mixto' || tono === 'documental') set.add('documental');
      if (tono === 'mixto' || tono === 'fisico') set.add('fisico');
    }
    return Array.from(set);
  }

  puntosFiltrados(puntos: PuntoNorma[]): PuntoNorma[] {
    if (!this.filtroEvidencia) return puntos;
    return puntos.filter((punto) => {
      const tono = this.tonoEvidencia(punto.tipo_evidencia);
      if (this.filtroEvidencia === 'documental') return tono === 'documental' || tono === 'mixto';
      return tono === 'fisico' || tono === 'mixto';
    });
  }

  puntosCapituloVisibles(norma: NormaAsignada, clave: string): PuntoNorma[] {
    return this.puntosFiltrados(this.puntosDeCapitulo(norma, clave));
  }

  hayPuntosVisibles(norma: NormaAsignada): boolean {
    return this.puntosFiltrados(this.puntosCache.get(norma.normativa_id) || []).length > 0;
  }

  private cargarDetalle(punto: PuntoNorma): void {
    const mismo = this.puntoEnfoque?.id === punto.id && this.lecturaHtml != null;
    this.puntoEnfoque = punto;
    if (mismo) return;
    this.pintarLectura(punto);
    this.fichaAnim += 1;
  }

  trackByPuntoId(_i: number, punto: PuntoNorma): number {
    return punto.id;
  }

  trackByCapClave(_i: number, cap: CapituloVista): string {
    return cap.clave;
  }

  onPillEnter(punto: PuntoNorma): void {
    if (!this.usaHover) return;
    if (this.puntoHoverId !== punto.id) this.puntoHoverId = punto.id;
    // Con un punto fijado, el hover solo remarca; no cambia la descripción.
    if (this.puntoFijadoId != null) return;
    if (this.puntoEnfoque?.id === punto.id && this.lecturaHtml != null) return;
    try {
      this.cargarDetalle(punto);
    } catch {
      this.puntoEnfoque = punto;
      this.lecturaHtml = this.sanitizer.bypassSecurityTrustHtml(
        this.escaparHtml(punto.descripcion || 'Sin descripción').replace(/\n/g, '<br>')
      );
      this.imagenesSobrantes = punto.imagenes || [];
      this.fichaAnim += 1;
    }
  }

  onPillLeave(): void {
    if (this.puntoHoverId == null) return;
    this.puntoHoverId = null;
  }

  pulsarPunto(_norma: NormaAsignada, punto: PuntoNorma, ev?: Event): void {
    if (ev instanceof PointerEvent && ev.button !== 0) return;
    ev?.preventDefault();
    ev?.stopPropagation();
    // Clic fija el detalle; otro clic en el mismo punto lo libera para volver a previsualizar.
    if (this.puntoFijadoId === punto.id) {
      this.puntoFijadoId = null;
      return;
    }
    this.puntoFijadoId = punto.id;
    this.puntoHoverId = null;
    this.puntoEnfoque = punto;
    try {
      this.cargarDetalle(punto);
    } catch {
      this.lecturaHtml = this.sanitizer.bypassSecurityTrustHtml(
        this.escaparHtml(punto.descripcion || 'Sin descripción').replace(/\n/g, '<br>')
      );
      this.imagenesSobrantes = punto.imagenes || [];
      this.fichaAnim += 1;
    }
    this.imagenAbierta = null;
    if (!this.usaHover) this.fichaMovil = true;
  }

  irACapitulo(clave: string): void {
    const nodo = document.getElementById(`pto-cap-${clave}`);
    const tablero = nodo?.closest('.pto-board') as HTMLElement | null;
    if (!nodo || !tablero) return;
    const destino = nodo.getBoundingClientRect().top - tablero.getBoundingClientRect().top + tablero.scrollTop - 40;
    tablero.scrollTo({ top: Math.max(0, destino), behavior: 'smooth' });
  }

  cerrarFicha(): void {
    this.fichaMovil = false;
    this.imagenAbierta = null;
  }

  alClicDescripcion(ev: MouseEvent): void {
    const img = (ev.target as HTMLElement | null)?.closest?.('img');
    if (img instanceof HTMLImageElement && img.src) this.imagenAbierta = img.src;
  }

  private pintarLectura(punto: PuntoNorma): void {
    const usadas = new Set<number>();
    const origen = punto.descripcion_html
      || this.escaparHtml(punto.descripcion || 'Sin descripción').replace(/\n/g, '<br>');
    const doc = new DOMParser().parseFromString(origen, 'text/html');
    doc.body.querySelectorAll('span.seg-ref').forEach((span) => {
      const img = this.tomarImagen(punto, usadas, span.getAttribute('data-nombre'), span.getAttribute('data-src'));
      span.replaceWith(img ? this.nodoImagen(doc, punto, img) : doc.createTextNode(''));
    });
    this.incrustarMenciones(doc, punto, usadas);
    this.lecturaHtml = this.sanitizer.bypassSecurityTrustHtml(this.serializarSeguro(doc.body));
    this.imagenesSobrantes = punto.imagenes.filter((img) => !usadas.has(img.id));
  }

  private incrustarMenciones(doc: Document, punto: PuntoNorma, usadas: Set<number>): void {
    for (const img of punto.imagenes) {
      if (usadas.has(img.id)) continue;
      const token = img.nombre.replace(/\.[^.]+$/, '').trim();
      if (token.length < 3) continue;
      const nodo = this.buscarTexto(doc.body, token);
      if (!nodo?.textContent) continue;
      const idx = nodo.textContent.toLowerCase().indexOf(token.toLowerCase());
      if (idx < 0) continue;
      const padre = nodo.parentNode;
      if (!padre) continue;
      const frag = doc.createDocumentFragment();
      const antes = nodo.textContent.slice(0, idx);
      const despues = nodo.textContent.slice(idx + token.length);
      if (antes) frag.appendChild(doc.createTextNode(antes));
      frag.appendChild(this.nodoImagen(doc, punto, img));
      if (despues) frag.appendChild(doc.createTextNode(despues));
      padre.replaceChild(frag, nodo);
      usadas.add(img.id);
    }
  }

  private buscarTexto(raiz: Node, token: string): Text | null {
    const pila = Array.from(raiz.childNodes);
    const q = token.toLowerCase();
    while (pila.length) {
      const nodo = pila.shift();
      if (!nodo) continue;
      if (nodo.nodeType === Node.TEXT_NODE && (nodo.textContent || '').toLowerCase().includes(q)) return nodo as Text;
      pila.unshift(...Array.from(nodo.childNodes));
    }
    return null;
  }

  private tomarImagen(punto: PuntoNorma, usadas: Set<number>, nombre: string | null, src: string | null): ImagenPunto | null {
    const limpio = (nombre || '').trim().toLowerCase();
    const ruta = (src || '').trim();
    const hallada = punto.imagenes.find((img) => {
      if (usadas.has(img.id)) return false;
      if (limpio && img.nombre.trim().toLowerCase() === limpio) return true;
      return !!ruta && (img.ruta === ruta || img.ruta.endsWith(ruta) || ruta.endsWith(img.ruta));
    }) || punto.imagenes.find((img) => !usadas.has(img.id) && !nombre && !src);
    if (!hallada) return null;
    usadas.add(hallada.id);
    return hallada;
  }

  private nodoImagen(doc: Document, punto: PuntoNorma, img: ImagenPunto): HTMLImageElement {
    const el = doc.createElement('img');
    el.className = 'pto-inline';
    el.src = this.urlArchivo(img.ruta) || '';
    el.alt = img.nombre || punto.punto_norma || 'Imagen del punto';
    return el;
  }

  private serializarSeguro(raiz: Node): string {
    let out = '';
    raiz.childNodes.forEach((nodo) => {
      if (nodo.nodeType === Node.TEXT_NODE) {
        out += this.escaparHtml(nodo.textContent || '');
        return;
      }
      if (!(nodo instanceof HTMLElement)) return;
      const tag = nodo.tagName;
      if (tag === 'BR') { out += '<br>'; return; }
      if (tag === 'IMG' && nodo.classList.contains('pto-inline')) {
        const src = nodo.getAttribute('src') || '';
        if (!src) return;
        out += `<img class="pto-inline" src="${this.escaparHtml(src)}" alt="${this.escaparHtml(nodo.getAttribute('alt') || '')}">`;
        return;
      }
      const mapa: Record<string, string> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u' };
      if (mapa[tag]) {
        out += `<${mapa[tag]}>${this.serializarSeguro(nodo)}</${mapa[tag]}>`;
        return;
      }
      if ((tag === 'P' || tag === 'DIV') && out && !out.endsWith('<br>')) out += '<br>';
      out += this.serializarSeguro(nodo);
    });
    return out.replace(/(^|<br>)(\s*)([a-zA-Z]\))/g, '$1$2<strong>$3</strong>');
  }

  urlArchivo(ruta: string | null | undefined): string | null {
    if (!ruta) return null;
    if (/^https?:/i.test(ruta)) return ruta;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  }

  private abrirPrimerCapitulo(norma: NormaAsignada): void {
    const caps = this.capitulos(norma);
    const primero = caps.find((c) => c.clave !== 'General') || caps[0];
    this.capitulosAbiertos = new Set(primero ? [primero.clave] : []);
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
      (p.tipo_evidencia || '').toLowerCase().includes(q) ||
      (p.formato_nombre || '').toLowerCase().includes(q)
    ).slice(0, 80);
  }

  totalCoincidencias(norma: NormaAsignada): number {
    const q = this.busquedaPunto.trim().toLowerCase();
    if (q.length < 2) return 0;
    const puntos = this.puntosCache.get(norma.normativa_id) || [];
    return puntos.filter((p) =>
      p.punto_norma.toLowerCase().includes(q) ||
      p.descripcion.toLowerCase().includes(q) ||
      (p.tipo_evidencia || '').toLowerCase().includes(q) ||
      (p.formato_nombre || '').toLowerCase().includes(q)
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
    this.progreso = Math.max(this.progreso, destino);
    this.persistirPaso();
    if (destino === 1 && this.normas.length) {
      this.abrirNormaPuntos(this.normaActiva || this.normas[0]);
    }
    if (destino === 2) this.prepararResumen();
  }

  siguiente(): void {
    if (!this.pasoValido(this.paso)) {
      this.avisarPaso(this.paso);
      return;
    }
    this.paso = Math.min(2, this.paso + 1);
    this.progreso = Math.max(this.progreso, this.paso);
    this.persistirPaso();
    if (this.paso === 1 && this.normas.length) {
      this.abrirNormaPuntos(this.normaActiva || this.normas[0]);
    }
    if (this.paso === 2) this.prepararResumen();
  }

  anterior(): void {
    this.paso = Math.max(0, this.paso - 1);
    this.persistirPaso();
  }

  private persistirPaso(): void {
    if (this.empresa) this.marcarCambio();
  }

  private pasoValido(indice: number): boolean {
    if (indice === 0) {
      return !!this.empresa
        && this.normas.length > 0
        && this.normas.every((n) => n.empleados.length === 1);
    }
    if (indice === 1) return this.normas.every((n) => n.requisito_ids.length > 0);
    return true;
  }

  private avisarPaso(indice: number): void {
    let text = 'Revise la selección.';
    if (indice === 0) {
      if (!this.empresa) text = 'Seleccione la empresa.';
      else if (!this.normas.length) text = 'Seleccione al menos una normativa.';
      else text = 'Cada normativa necesita un responsable. La misma persona puede quedar en varias.';
    } else if (indice === 1) {
      text = 'Marque al menos un punto en cada normativa seleccionada.';
    }
    Swal.fire({
      icon: 'info',
      title: 'Falta completar la asignación',
      text,
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
      for (let i = 0; i <= 1; i++) {
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
                this.router.navigate(['/seguridad/gestion/empresa', this.empresa.empresa_id]);
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
      vista: 'compacta',
      normas: this.normas.map((n) => ({
        normativa_id: n.normativa_id,
        empleados: n.empleados.map((e) => ({ ...e })),
        requisito_ids: [...n.requisito_ids]
      }))
    };
  }

  consultaResp: Record<number, string> = {};

  escribirResp(norma: NormaAsignada, valor: string): void {
    this.consultaResp = { ...this.consultaResp, [norma.normativa_id]: valor };
    this.enfocarNorma(norma);
  }

  sugerenciasResp(norma: NormaAsignada): EmpleadoOpcion[] {
    const q = (this.consultaResp[norma.normativa_id] || '').trim().toLowerCase();
    if (!q) return [];
    return this.usuarios.filter((u) =>
      !norma.empleados.some((e) => e.empleado_id === u.empleado_id) &&
      (u.nombre.toLowerCase().includes(q) || (u.puesto || '').toLowerCase().includes(q))
    ).slice(0, 6);
  }

  elegirResponsable(norma: NormaAsignada, usuario: EmpleadoOpcion): void {
    this.enfocarNorma(norma);
    this.alternarUsuario(usuario);
    this.consultaResp = { ...this.consultaResp, [norma.normativa_id]: '' };
  }

  private pedirResponsable(norma: NormaAsignada): void {
    const disponibles = this.usuarios.filter((u) => !norma.empleados.some((e) => e.empleado_id === u.empleado_id));
    const lista = disponibles.map((u) => `
      <button type="button" class="asig-resp-pick" data-id="${u.empleado_id}">
        <span class="asig-resp-pick__av">${this.escaparHtml(this.iniciales(u.nombre))}</span>
        <span class="asig-resp-pick__txt">
          <strong>${this.escaparHtml(u.nombre)}</strong>
          <small>${this.escaparHtml(u.puesto || 'Responsable')}</small>
        </span>
      </button>
    `).join('');
    const vacio = this.cargandoUsuarios
      ? 'Cargando responsables del sistema…'
      : 'No hay responsables disponibles en el sistema.';

    Swal.fire({
      title: norma.codigo,
      html: `
        <p class="asig-resp-lead">Elige al responsable disponible</p>
        <div class="asig-resp-alert">
          ${disponibles.length
            ? `<input type="search" class="asig-resp-q" placeholder="Buscar por nombre o puesto…" aria-label="Filtrar responsables">
               <div class="asig-resp-list">${lista}</div>
               <p class="asig-resp-none" hidden>Nadie coincide con esa búsqueda.</p>`
            : `<p class="asig-resp-none">${vacio}</p>`}
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Después',
      buttonsStyling: false,
      width: 460,
      customClass: {
        popup: 'asig-resp-popup',
        title: 'asig-resp-title',
        htmlContainer: 'asig-resp-html',
        cancelButton: 'asig-resp-later'
      },
      didOpen: () => {
        const root = Swal.getHtmlContainer();
        if (!root) return;
        const input = root.querySelector('.asig-resp-q') as HTMLInputElement | null;
        const botones = Array.from(root.querySelectorAll('.asig-resp-pick')) as HTMLButtonElement[];
        const aviso = root.querySelector('.asig-resp-none') as HTMLElement | null;
        const filtrar = () => {
          const q = (input?.value || '').trim().toLowerCase();
          let visibles = 0;
          botones.forEach((btn) => {
            const texto = (btn.textContent || '').toLowerCase();
            const ok = !q || texto.includes(q);
            btn.hidden = !ok;
            if (ok) visibles += 1;
          });
          if (aviso && botones.length) aviso.hidden = visibles > 0;
        };
        input?.addEventListener('input', filtrar);
        botones.forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = Number(btn.dataset['id']);
            const usuario = this.usuarios.find((u) => u.empleado_id === id);
            if (!usuario) return;
            this.ngZone.run(() => {
              this.elegirResponsable(norma, usuario);
              Swal.close();
            });
          });
        });
        input?.focus();
      }
    });
  }

  private escaparHtml(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private enfocarAsignacion(): void {
    this.paso = 0;
    if (this.normas.length && !this.normaFocoId) this.normaFocoId = this.normas[0].normativa_id;
  }

  private desplazarAlBloque(bloque: 'empresa' | 'normas' | 'resp'): void {
    window.setTimeout(() => {
      const ancla = bloque === 'empresa'
        ? this.anclaEmpresa
        : bloque === 'normas'
          ? this.anclaNormas
          : this.anclaResp;
      const el = ancla?.nativeElement;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'smooth' });
    }, 90);
  }

  private aplicarPayload(payload: PayloadAsignacion | null | undefined): void {
    const normas = Array.isArray(payload?.normas) ? payload!.normas : [];
    this.progreso = Math.max(this.progreso, this.pasoDesdePayload(payload));
    this.paso = 0;
    this.normas = normas.map((item) => {
      const cat = this.catalogo.find((c) => c.id === Number(item.normativa_id));
      return {
        normativa_id: Number(item.normativa_id),
        codigo: cat?.codigo || `Norma ${item.normativa_id}`,
        titulo: cat?.titulo || 'Normativa del catálogo',
        categoria_id: cat?.categoria_id || '',
        total_requisitos: cat?.total_requisitos || item.requisito_ids?.length || 0,
        empleados: (item.empleados || []).slice(0, 1).map((e) => ({
          empleado_id: Number(e.empleado_id),
          nombre: e.nombre || `Empleado ${e.empleado_id}`,
          puesto: e.puesto || ''
        })),
        requisito_ids: (item.requisito_ids || []).map((id) => Number(id)).filter((id) => id > 0)
      };
    }).filter((n) => n.normativa_id > 0);
    if (this.normas.length) this.normaFocoId = this.normas[0].normativa_id;
    this.limpiarResponsablesAjenos();
  }

  private pasoDesdePayload(payload: PayloadAsignacion | null | undefined): number {
    const n = Math.max(0, Number(payload?.paso) || 0);
    if (payload?.vista === 'compacta') return Math.min(2, n);
    if (n <= 2) return 0;
    if (n === 3) return 1;
    return 2;
  }

  resumenCorto(texto: string): string {
    const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpio) return 'Sin descripción';
    const frase = limpio.split(/(?<=\.)\s/)[0];
    const base = frase.length < limpio.length && frase.length <= 140 ? frase : limpio;
    return base.length > 120 ? `${base.slice(0, 117).trim()}…` : base;
  }

  /** Una idea corta de lo que pide el punto. El texto completo vive en Normativas. */
  resumenPunto(texto: string): string {
    let limpio = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpio) return 'Sin descripción';
    limpio = limpio.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const frase = (limpio.split(/(?<=\.)\s/)[0] || limpio).replace(/[.]+$/, '').trim();
    const coma = frase.split(',')[0].trim();
    const base = coma.length >= 28 && coma.length < frase.length ? coma : frase;
    const max = 72;
    if (base.length <= max) return base;
    const recorte = base.slice(0, max + 1);
    const espacio = recorte.lastIndexOf(' ');
    return `${(espacio > 28 ? recorte.slice(0, espacio) : base.slice(0, max)).trim()}…`;
  }

  resumenCapitulos(norma: NormaAsignada): Array<{ clave: string; puntos: PuntoNorma[] }> {
    const marcados = new Set(norma.requisito_ids);
    const puntos = (this.puntosCache.get(norma.normativa_id) || []).filter((p) => marcados.has(p.id));
    const mapa = new Map<string, PuntoNorma[]>();
    for (const punto of puntos) {
      if (!mapa.has(punto.cap)) mapa.set(punto.cap, []);
      mapa.get(punto.cap)!.push(punto);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => {
        if (a[0] === 'General') return 1;
        if (b[0] === 'General') return -1;
        return a[0].localeCompare(b[0], 'es', { numeric: true });
      })
      .map(([clave, lista]) => ({ clave, puntos: lista }));
  }

  portadaNorma(norma: NormaAsignada): string | null {
    const item = this.catalogo.find((c) => c.id === norma.normativa_id);
    return item ? this.urlPortada(item) : null;
  }

  get normaResumen(): NormaAsignada | null {
    if (this.resumenNormaId == null) return null;
    return this.normas.find((n) => n.normativa_id === this.resumenNormaId) || null;
  }

  tipResumen(norma: NormaAsignada): string {
    const titulo = (norma.titulo || '').trim();
    if (!titulo) return 'Sin descripción disponible.';
    if (titulo.length <= 160) return titulo;
    const corte = titulo.slice(0, 161);
    const espacio = corte.lastIndexOf(' ');
    return `${(espacio > 90 ? corte.slice(0, espacio) : titulo.slice(0, 160)).trim()}…`;
  }

  tipPuntoResumen(punto: PuntoNorma): string {
    const texto = (punto.descripcion || 'Sin descripción.').replace(/\s+/g, ' ').trim();
    if (texto.length <= 180) return texto;
    const corte = texto.slice(0, 181);
    const espacio = corte.lastIndexOf(' ');
    return `${(espacio > 100 ? corte.slice(0, espacio) : texto.slice(0, 180)).trim()}…`;
  }

  trackResumenCap = (_: number, grupo: { clave: string }): string => grupo.clave;
  trackResumenPunto = (_: number, punto: PuntoNorma): number => punto.id;

  ubicarTipCard(norma: NormaAsignada, ev?: Event): void {
    if (!this.usaHover || this.resumenPuntoId != null) return;
    const nodo = (ev?.currentTarget as HTMLElement | null) || null;
    if (!nodo) return;
    this.mostrarFloatTip(nodo, norma.codigo, this.tipResumen(norma), 288);
  }

  soltarTipCard(): void {
    if (this.resumenPuntoId != null) return;
    this.resumenFloatTip = null;
  }

  abrirResumen(norma: NormaAsignada): void {
    if (this.resumenNormaId === norma.normativa_id) return;
    this.resumenNormaId = norma.normativa_id;
    this.resumenPuntoId = null;
    this.resumenFloatTip = null;
    this.refrescarResumenGrupos();
  }

  previsualizarPuntoResumen(punto: PuntoNorma, ev?: Event): void {
    if (!this.usaHover || this.resumenPuntoId != null) return;
    const nodo = (ev?.currentTarget as HTMLElement | null) || null;
    if (!nodo) return;
    this.mostrarFloatTip(nodo, punto.punto_norma || 'Punto', this.tipPuntoResumen(punto), 320);
  }

  soltarPuntoResumen(): void {
    if (!this.usaHover || this.resumenPuntoId != null) return;
    this.resumenFloatTip = null;
  }

  seleccionarPuntoResumen(punto: PuntoNorma, ev?: Event): void {
    ev?.preventDefault();
    ev?.stopPropagation();
    const nodo = (ev?.currentTarget as HTMLElement | null) || null;
    if (this.resumenPuntoId === punto.id) {
      this.resumenPuntoId = null;
      this.resumenFloatTip = null;
      return;
    }
    this.resumenPuntoId = punto.id;
    if (nodo) {
      this.mostrarFloatTip(nodo, punto.punto_norma || 'Punto', this.tipPuntoResumen(punto), 320);
    }
  }

  private mostrarFloatTip(ancla: HTMLElement, titulo: string, texto: string, anchoMax: number): void {
    const rect = ancla.getBoundingClientRect();
    const margen = 14;
    const width = Math.min(anchoMax, window.innerWidth - margen * 2);
    const centro = rect.left + rect.width / 2;
    let left = centro - width / 2;
    if (left < margen) left = margen;
    if (left + width > window.innerWidth - margen) left = window.innerWidth - margen - width;
    const flecha = Math.max(16, Math.min(width - 16, centro - left));
    this.resumenFloatTip = {
      top: Math.max(margen, rect.top - 8),
      left,
      width,
      flecha,
      titulo,
      texto
    };
  }

  private refrescarResumenGrupos(): void {
    const norma = this.normaResumen;
    this.resumenGrupos = norma ? this.resumenCapitulos(norma) : [];
  }

  private prepararResumen(): void {
    this.precargarPuntos();
    this.resumenPuntoId = null;
    this.resumenFloatTip = null;
    if (this.resumenNormaId == null || !this.normas.some((n) => n.normativa_id === this.resumenNormaId)) {
      this.resumenNormaId = this.normas[0]?.normativa_id ?? null;
    }
    this.refrescarResumenGrupos();
  }

  totalCapitulosMarcados(): number {
    return this.normas.reduce((sum, norma) => sum + this.resumenCapitulos(norma).length, 0);
  }

  private precargarPuntos(): void {
    for (const norma of this.normas) {
      if (this.puntosCache.has(norma.normativa_id)) continue;
      this.backend.listarPuntosSeguridadAsignacion(norma.normativa_id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res: any) => {
            const puntos = (res?.puntos || []).map((p: any) => this.etiquetarPunto(p));
            this.puntosCache.set(norma.normativa_id, puntos);
            if (this.paso === 2 && this.resumenNormaId === norma.normativa_id) {
              this.refrescarResumenGrupos();
            }
          }
        });
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
