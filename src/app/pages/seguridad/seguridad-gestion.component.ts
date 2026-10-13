import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { environment } from 'src/environments/environment';
import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';
import { SEG_NORMATIVAS_CATEGORIAS } from './seguridad-normativas.catalog';
import { construirHtmlPuntoLectura, ImagenPuntoLite } from './seguridad-punto-lectura.util';

interface Responsable {
  empleado_id: number;
  nombre: string;
  puesto: string;
}

interface DocumentoItem {
  id: number;
  requisito_id: number | null;
  nombre_original: string;
  tamano: number;
  subido_por: string | null;
  creado_en: string | null;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  anio?: number | null;
}

interface CategoriaAvance {
  categoria_id: string;
  prefijo: string;
  titulo: string;
  descripcion?: string;
  avance: number;
  puntos_asignados: number;
  puntos_con_evidencia: number;
  documentos: number;
  normativas: number;
}

interface EmpresaResumen {
  empresa_id: number;
  empresa_nombre: string;
  avance: number;
  puntos_asignados: number;
  puntos_con_evidencia: number;
  documentos: number;
  normativas: number;
  normativas_cerradas?: number;
  normativas_abiertas?: number;
  /** Última publicación o cambio en la gestión de normativas de la empresa. */
  ultima_gestion?: string | null;
  categorias: CategoriaAvance[];
  logo?: string | null;
}

interface AsignacionResumen {
  id: number;
  empresa_id: number;
  empresa_nombre: string;
  normativa_id: number;
  codigo: string;
  titulo: string;
  categoria_id: string;
  avance: number;
  puntos_asignados: number;
  documentos: number;
  puntos_con_evidencia: number;
  imagen_portada?: string | null;
  responsables: Responsable[];
  categoria?: CategoriaAvance;
}

interface AccionesPunto {
  preventiva: { conservar: boolean; mejorar: boolean; actualizar: boolean };
  correctiva: { complementar: boolean; corregir: boolean; realizar: boolean };
}

interface AccionScoreOpcion {
  score: 100 | 80 | 60 | 40 | 20 | 0;
  etiqueta: string;
  grupo: 'preventiva' | 'correctiva';
  detalle: string;
}

interface PuntoGestion {
  id: number;
  numero_item: number | null;
  punto_norma: string;
  descripcion: string;
  descripcion_html?: string | null;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  accion_score: number | null;
  acciones: AccionesPunto;
  fecha_inicio: string | null;
  fecha_terminacion: string | null;
  evidencia_requerida?: string | null;
  observaciones: string | null;
  indicador_avance: number | null;
  responsable: 'Empresa' | 'Cliente';
  formato_nombre: string | null;
  formato_archivo: string | null;
  formato_nombre_archivo?: string | null;
  ultima_evidencia: string | null;
  estado: 'cumple' | 'parcial' | 'no_cumple';
  imagenes: ImagenPuntoLite[];
  documentos: DocumentoItem[];
}

/** Opciones de acción (plantilla Excel). */
const ACCIONES_SCORE: AccionScoreOpcion[] = [
  { score: 100, etiqueta: 'Conservar', grupo: 'preventiva', detalle: 'Acción preventiva · mantener lo existente' },
  { score: 80, etiqueta: 'Mejorar', grupo: 'preventiva', detalle: 'Acción preventiva · mejorar condiciones' },
  { score: 60, etiqueta: 'Actualizar', grupo: 'preventiva', detalle: 'Acción preventiva · actualizar documentación o instalaciones' },
  { score: 40, etiqueta: 'Complementar', grupo: 'correctiva', detalle: 'Acción correctiva · complementar lo faltante' },
  { score: 20, etiqueta: 'Corregir', grupo: 'correctiva', detalle: 'Acción correctiva · corregir hallazgos' },
  { score: 0, etiqueta: 'Realizar', grupo: 'correctiva', detalle: 'Acción correctiva · realizar desde cero' }
];

interface ResumenResponsables {
  cerrados_empresa: number;
  abiertos_empresa: number;
  cerrados_cliente: number;
  abiertos_cliente: number;
}

interface ResumenGeneralEmpresa {
  normativas: number;
  puntos: number;
  puntos_cerrados: number;
  cerradas: number;
  abiertas: number;
  archivos: number;
  avance: number;
}

interface ResumenNormativaFoco {
  avance: number;
  puntos_total: number;
  cerrados: number;
  abiertos: number;
  cerrados_empresa: number;
  cerrados_cliente: number;
  abiertos_empresa: number;
  abiertos_cliente: number;
  archivos: number;
}

interface DetalleGestion {
  asignacion: AsignacionResumen & {
    publicado_por: string | null;
    publicado_en: string | null;
  };
  puntos: PuntoGestion[];
  documentos_generales: DocumentoItem[];
}

type VistaGestion = 'empresas' | 'empresa' | 'normativa' | 'punto';

@Component({
  selector: 'app-seguridad-gestion',
  templateUrl: './seguridad-gestion.component.html',
  styleUrls: ['./seguridad.shared.scss', './seguridad-gestion.component.scss']
})
export class SeguridadGestionComponent implements OnInit, OnDestroy {
  vista: VistaGestion = 'empresas';
  cargando = true;
  error: string | null = null;

  empresas: EmpresaResumen[] = [];
  busqueda = '';
  busquedaNorma = '';
  /** Filtro de chips de normativas en el panel expandido del tablero. */
  busquedaTableroNorma = '';
  anioEvidencia = new Date().getFullYear();
  readonly aniosEvidencia = [
    new Date().getFullYear() - 1,
    new Date().getFullYear(),
    new Date().getFullYear() + 1
  ];

  /** Empresa seleccionada en el tablero (abre el panel de detalle en su fila). */
  empresaSeleccionada: EmpresaResumen | null = null;
  /** Asignaciones de la empresa abierta en el tablero (vista empresas). */
  asignacionesTablero: AsignacionResumen[] = [];
  cargandoTablero = false;
  /** Desglose Empresa/Cliente del tablero (modo General). */
  resumenTableroResp: ResumenResponsables = {
    cerrados_empresa: 0,
    abiertos_empresa: 0,
    cerrados_cliente: 0,
    abiertos_cliente: 0
  };
  /** Reinicia la animación del anillo al seleccionar empresa. */
  tableroRingAnim = 0;
  readonly empCols = 3;

  empresa: EmpresaResumen | null = null;
  categoriasEmpresa: CategoriaAvance[] = [];
  asignaciones: AsignacionResumen[] = [];
  categoriaFiltro: string | null = null;

  /** `general` = resumen de todas; `normativa` = detalle de la seleccionada. */
  panelModo: 'general' | 'normativa' = 'general';

  /** Normativa seleccionada en el picker (null = General). */
  normativaFoco: AsignacionResumen | null = null;

  /** Gráficos del panel superior (vista empresa). */
  chartAvance: any = {};
  chartEstado: any = {};
  chartDesempeno: any = {};
  chartsListos = false;

  detalle: DetalleGestion | null = null;
  cargandoDetalle = false;
  /** Scroll a restaurar al elegir normativa/general (evita salto al top). */
  private scrollAncla: number | null = null;
  busquedaPunto = '';
  /** Filtro Cumple / Pendiente (sin parcial). */
  filtroEstadoPunto: 'todos' | 'cumple' | 'pendiente' = 'todos';
  /** Filtro por responsable del requisito. */
  filtroResponsablePunto: 'todos' | 'Empresa' | 'Cliente' = 'todos';
  /** Capítulos colapsados (clave ausente = abierto). */
  private capitulosCerrados = new Set<string>();
  private capitulosInicializados = false;
  puntoActivo: PuntoGestion | null = null;
  subiendo = false;
  guardandoPunto = false;
  lecturaHtml: SafeHtml | null = null;
  imagenesSobrantes: ImagenPuntoLite[] = [];
  imagenAbierta: string | null = null;
  /** Borrador de observaciones en la ficha del punto. */
  observacionesDraft = '';
  /** Miniaturas blob locales (evidencias sin Drive / fallback). */
  private thumbsBlob = new Map<number, string>();
  /** Cache de URLs seguras para iframes (evita recargas en cada CD). */
  private previewUrlCache = new Map<string, SafeResourceUrl>();
  /** Miniatura blob del formato guía (PDF) para preview estable. */
  private formatoPreviewBlob: string | null = null;
  /** Drive thumbnails que fallaron → fallback a iframe. */
  private driveThumbFallidos = new Set<number>();
  readonly categorias = SEG_NORMATIVAS_CATEGORIAS;
  readonly accionesScore = ACCIONES_SCORE;
  readonly mesesInicio = [
    { valor: 1, etiqueta: 'Enero' }, { valor: 2, etiqueta: 'Febrero' },
    { valor: 3, etiqueta: 'Marzo' }, { valor: 4, etiqueta: 'Abril' },
    { valor: 5, etiqueta: 'Mayo' }, { valor: 6, etiqueta: 'Junio' },
    { valor: 7, etiqueta: 'Julio' }, { valor: 8, etiqueta: 'Agosto' },
    { valor: 9, etiqueta: 'Septiembre' }, { valor: 10, etiqueta: 'Octubre' },
    { valor: 11, etiqueta: 'Noviembre' }, { valor: 12, etiqueta: 'Diciembre' }
  ];
  readonly aniosInicio: number[] = (() => {
    const y = new Date().getFullYear();
    const lista: number[] = [];
    for (let i = y - 3; i <= y + 2; i++) lista.push(i);
    return lista;
  })();
  private logosEmpresa = new Map<number, string | null>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private preview: DocumentPreviewService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(() => this.sincronizarRuta());
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.vista !== 'empresa') return;
      this.aplicarCategoriaQuery();
      if (!this.cargando && this.asignaciones.length) {
        this.aplicarNormaQuery();
        this.sincronizarNormativaFoco();
      }
    });
  }

  ngOnDestroy(): void {
    this.limpiarThumbsBlob();
    this.limpiarFormatoPreviewBlob();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get empresasFiltradas(): EmpresaResumen[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.empresas;
    return this.empresas.filter((e) =>
      e.empresa_nombre.toLowerCase().includes(q)
      || e.categorias.some((c) => c.titulo.toLowerCase().includes(q) || c.prefijo.toLowerCase().includes(q))
    );
  }

  alCambiarBusquedaEmpresa(): void {
    if (!this.empresaSeleccionada) return;
    const id = this.empresaSeleccionada.empresa_id;
    if (!this.empresasFiltradas.some((e) => e.empresa_id === id)) {
      this.cerrarTableroEmpresa();
    }
  }

  private cerrarTableroEmpresa(): void {
    this.empresaSeleccionada = null;
    this.asignacionesTablero = [];
    this.cargandoTablero = false;
    this.busquedaTableroNorma = '';
    this.resumenTableroResp = {
      cerrados_empresa: 0,
      abiertos_empresa: 0,
      cerrados_cliente: 0,
      abiertos_cliente: 0
    };
    this.panelModo = 'general';
    this.normativaFoco = null;
    if (this.vista === 'empresas') {
      this.detalle = null;
      this.cargandoDetalle = false;
    }
  }

  get indiceEmpresaSeleccionada(): number {
    if (!this.empresaSeleccionada) return -1;
    return this.empresasFiltradas.findIndex((e) => e.empresa_id === this.empresaSeleccionada!.empresa_id);
  }

  /** Empresas de filas anteriores a la de la selección. */
  get empresasAntesFila(): EmpresaResumen[] {
    const i = this.indiceEmpresaSeleccionada;
    if (i < 0) return [];
    const rowStart = Math.floor(i / this.empCols) * this.empCols;
    return this.empresasFiltradas.slice(0, rowStart);
  }

  /** Otras empresas de la misma fila (sin la seleccionada). */
  get peersFilaSeleccion(): EmpresaResumen[] {
    const i = this.indiceEmpresaSeleccionada;
    if (i < 0) return [];
    const rowStart = Math.floor(i / this.empCols) * this.empCols;
    return this.empresasFiltradas
      .slice(rowStart, rowStart + this.empCols)
      .filter((e) => e.empresa_id !== this.empresaSeleccionada!.empresa_id);
  }

  /** Empresas de filas posteriores a la de la selección. */
  get empresasDespuesFila(): EmpresaResumen[] {
    const i = this.indiceEmpresaSeleccionada;
    if (i < 0) return [];
    const rowStart = Math.floor(i / this.empCols) * this.empCols;
    return this.empresasFiltradas.slice(rowStart + this.empCols);
  }

  get puntosFiltrados(): PuntoGestion[] {
    const q = this.busquedaPunto.trim().toLowerCase();
    let lista = this.detalle?.puntos || [];
    if (this.filtroEstadoPunto === 'cumple') {
      lista = lista.filter((p) => p.estado === 'cumple');
    } else if (this.filtroEstadoPunto === 'pendiente') {
      lista = lista.filter((p) => p.estado !== 'cumple');
    }
    if (this.filtroResponsablePunto === 'Empresa' || this.filtroResponsablePunto === 'Cliente') {
      lista = lista.filter((p) => p.responsable === this.filtroResponsablePunto);
    }
    if (!q) return lista;
    return lista.filter((p) =>
      p.punto_norma.toLowerCase().includes(q)
      || p.descripcion.toLowerCase().includes(q)
      || (p.tipo_evidencia || '').toLowerCase().includes(q)
      || (p.periodicidad || '').toLowerCase().includes(q)
      || (p.observaciones || '').toLowerCase().includes(q)
      || (p.evidencia_requerida || '').toLowerCase().includes(q)
      || String(p.numero_item ?? '').includes(q)
      || p.responsable.toLowerCase().includes(q)
      || this.etiquetaAccionActiva(p).toLowerCase().includes(q)
    );
  }

  get asignacionesFiltradasEmpresa(): AsignacionResumen[] {
    let lista = this.asignaciones;
    if (this.categoriaFiltro) {
      lista = lista.filter((a) => a.categoria_id === this.categoriaFiltro);
    }
    const q = this.busquedaNorma.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((a) =>
      a.codigo.toLowerCase().includes(q)
      || a.titulo.toLowerCase().includes(q)
      || a.responsables.some((r) => r.nombre.toLowerCase().includes(q))
    );
  }

  get bloquesCapitulo(): { clave: string; titulo: string; puntos: PuntoGestion[] }[] {
    const mapa = new Map<string, PuntoGestion[]>();
    for (const p of this.puntosFiltrados) {
      const clave = p.punto_norma.split('.').filter(Boolean)[0] || 'General';
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave)!.push(p);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => {
        if (a[0] === 'General') return 1;
        if (b[0] === 'General') return -1;
        return a[0].localeCompare(b[0], 'es', { numeric: true });
      })
      .map(([clave, puntos]) => ({
        clave,
        titulo: clave === 'General' ? 'General' : `Capítulo ${clave}`,
        puntos
      }));
  }

  private inicializarCapitulosColapsados(): void {
    if (this.capitulosInicializados) return;
    this.capitulosInicializados = true;
    // Todos los capítulos abiertos al entrar: evita lista vacía por colapso/animación.
    this.capitulosCerrados.clear();
  }

  capituloAbierto(clave: string): boolean {
    return !this.capitulosCerrados.has(clave);
  }

  toggleCapitulo(clave: string, event?: Event): void {
    event?.stopPropagation();
    if (this.capitulosCerrados.has(clave)) this.capitulosCerrados.delete(clave);
    else this.capitulosCerrados.add(clave);
  }

  seleccionarFiltroEstado(estado: 'todos' | 'cumple' | 'pendiente'): void {
    this.filtroEstadoPunto = this.filtroEstadoPunto === estado ? 'todos' : estado;
  }

  seleccionarFiltroResponsable(resp: 'todos' | 'Empresa' | 'Cliente'): void {
    this.filtroResponsablePunto = this.filtroResponsablePunto === resp ? 'todos' : resp;
  }

  contarPorResponsable(tipo: 'Empresa' | 'Cliente'): number {
    return (this.detalle?.puntos || []).filter((p) => p.responsable === tipo).length;
  }

  private sincronizarRuta(): void {
    const params = this.route.snapshot.paramMap;
    const empresaId = Number(params.get('empresaId') || 0);
    const asignacionId = Number(params.get('id') || 0);
    const requisitoId = Number(params.get('requisitoId') || 0);

    if (asignacionId > 0 && requisitoId > 0) {
      this.vista = 'punto';
      this.cargarDetalle(asignacionId, requisitoId);
      return;
    }
    if (asignacionId > 0) {
      this.vista = 'normativa';
      this.puntoActivo = null;
      this.cargarDetalle(asignacionId);
      return;
    }
    if (empresaId > 0) {
      this.vista = 'empresa';
      this.detalle = null;
      this.puntoActivo = null;
      this.aplicarCategoriaQuery();
      this.cargarEmpresa(empresaId);
      return;
    }
    this.vista = 'empresas';
    this.empresa = null;
    this.detalle = null;
    this.puntoActivo = null;
    this.cargarEmpresas();
  }

  private aplicarCategoriaQuery(): void {
    const cat = this.route.snapshot.queryParamMap.get('categoria');
    this.categoriaFiltro = cat || null;
  }

  /** Si la URL trae ?norma=, enfoca esa asignación en el panel de empresa. */
  private aplicarNormaQuery(): void {
    if (this.vista !== 'empresa' || !this.asignaciones.length) return;
    const normaId = Number(this.route.snapshot.queryParamMap.get('norma') || 0);
    if (!(normaId > 0)) return;
    const item = this.asignaciones.find((a) => a.id === normaId);
    if (!item) return;
    if (this.panelModo === 'normativa' && this.normativaFoco?.id === item.id) return;
    this.seleccionarNormativaFoco(item);
  }

  cargarEmpresas(): void {
    this.cargando = true;
    this.error = null;
    forkJoin({
      gestion: this.backend.listarEmpresasGestionSeguridad(),
      empresas: this.backend.obtenerEmpresas().pipe(catchError(() => of({ empresas: [] })))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ gestion, empresas }: any) => {
          this.logosEmpresa.clear();
          for (const e of empresas?.empresas || []) {
            const id = Number(e.empresa_id);
            if (id > 0) this.logosEmpresa.set(id, e.logo || e.logo_url || null);
          }
          this.empresas = (gestion?.empresas || []).map((emp: EmpresaResumen) => ({
            ...emp,
            logo: this.logosEmpresa.get(emp.empresa_id) || null
          }));
          if (this.empresaSeleccionada) {
            const still = this.empresas.find((e) => e.empresa_id === this.empresaSeleccionada!.empresa_id);
            if (still) this.empresaSeleccionada = still;
            else this.cerrarTableroEmpresa();
          }
          this.cargando = false;
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se pudo cargar la gestión de empresas.';
          this.empresas = [];
          this.cerrarTableroEmpresa();
          this.cargando = false;
        }
      });
  }

  cargarEmpresa(empresaId: number): void {
    this.cargando = true;
    this.error = null;
    this.asignaciones = [];
    this.normativaFoco = null;
    this.detalle = null;
    this.panelModo = 'general';
    forkJoin({
      det: this.backend.obtenerEmpresaGestionSeguridad(empresaId),
      empresas: this.backend.obtenerEmpresas().pipe(catchError(() => of({ empresas: [] })))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ det, empresas }: any) => {
          for (const e of empresas?.empresas || []) {
            const id = Number(e.empresa_id);
            if (id > 0) this.logosEmpresa.set(id, e.logo || e.logo_url || null);
          }
          const res = det;
          this.empresa = res?.empresa
            ? {
              ...res.empresa,
              logo: this.logosEmpresa.get(res.empresa.empresa_id) || null
            }
            : null;
          this.categoriasEmpresa = res?.categorias || [];
          this.asignaciones = res?.asignaciones || [];
          this.cargando = false;
          this.panelModo = 'general';
          this.normativaFoco = null;
          this.aplicarNormaQuery();
          this.actualizarGraficosEmpresa();
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la empresa.';
          this.empresa = null;
          this.asignaciones = [];
          this.normativaFoco = null;
          this.detalle = null;
          this.panelModo = 'general';
          this.chartsListos = false;
          this.cargando = false;
        }
      });
  }

  private sincronizarNormativaFoco(): void {
    if (this.panelModo === 'general') {
      this.normativaFoco = null;
      return;
    }
    const lista = this.asignacionesFiltradasEmpresa;
    if (!lista.length) {
      this.seleccionarPanelGeneral();
      return;
    }
    const actual = this.normativaFoco
      ? lista.find((a) => a.id === this.normativaFoco!.id)
      : null;
    if (!actual) {
      this.seleccionarNormativaFoco(lista[0]);
      return;
    }
    this.normativaFoco = actual;
  }

  resumenGeneralDe(emp: EmpresaResumen | null): ResumenGeneralEmpresa {
    if (!emp) {
      return { normativas: 0, puntos: 0, puntos_cerrados: 0, cerradas: 0, abiertas: 0, archivos: 0, avance: 0 };
    }
    const cerradas = emp.normativas_cerradas ?? this.asignaciones.filter((a) => a.avance >= 100).length;
    const abiertas = emp.normativas_abiertas ?? Math.max(0, emp.normativas - cerradas);
    return {
      normativas: emp.normativas,
      puntos: emp.puntos_asignados,
      puntos_cerrados: emp.puntos_con_evidencia,
      cerradas,
      abiertas,
      archivos: emp.documentos,
      avance: emp.avance
    };
  }

  get resumenGeneralEmpresa(): ResumenGeneralEmpresa {
    if (this.vista === 'empresa' && this.empresa) {
      const cerradas = this.asignaciones.filter((a) => a.avance >= 100).length;
      return {
        normativas: this.empresa.normativas,
        puntos: this.empresa.puntos_asignados,
        puntos_cerrados: this.empresa.puntos_con_evidencia,
        cerradas,
        abiertas: Math.max(0, this.asignaciones.length - cerradas),
        archivos: this.empresa.documentos,
        avance: this.empresa.avance
      };
    }
    return this.resumenGeneralDe(this.empresaSeleccionada);
  }

  get resumenNormativaFoco(): ResumenNormativaFoco | null {
    const foco = this.normativaFoco;
    if (!foco) return null;
    const pts = this.detalle?.asignacion?.id === foco.id ? this.detalle.puntos : [];
    if (!pts.length) {
      return {
        avance: foco.avance,
        puntos_total: foco.puntos_asignados,
        cerrados: foco.puntos_con_evidencia,
        abiertos: Math.max(0, foco.puntos_asignados - foco.puntos_con_evidencia),
        cerrados_empresa: 0,
        cerrados_cliente: 0,
        abiertos_empresa: 0,
        abiertos_cliente: 0,
        archivos: foco.documentos
      };
    }
    let cerradosEmpresa = 0;
    let cerradosCliente = 0;
    let abiertosEmpresa = 0;
    let abiertosCliente = 0;
    for (const p of pts) {
      const esCliente = p.responsable === 'Cliente';
      const cerrado = p.estado === 'cumple';
      if (cerrado) {
        if (esCliente) cerradosCliente += 1;
        else cerradosEmpresa += 1;
      } else if (esCliente) {
        abiertosCliente += 1;
      } else {
        abiertosEmpresa += 1;
      }
    }
    const cerrados = cerradosEmpresa + cerradosCliente;
    const abiertos = abiertosEmpresa + abiertosCliente;
    const total = pts.length;
    return {
      avance: total ? Math.round((cerrados / total) * 100) : foco.avance,
      puntos_total: total,
      cerrados,
      abiertos,
      cerrados_empresa: cerradosEmpresa,
      cerrados_cliente: cerradosCliente,
      abiertos_empresa: abiertosEmpresa,
      abiertos_cliente: abiertosCliente,
      archivos: foco.documentos
    };
  }

  cargarDetalle(id: number, requisitoId?: number): void {
    this.cargando = false;
    // Solo pantalla de carga al abrir la vista normativa/punto.
    // En tablero o vista empresa el resumen ya se muestra; el detalle llega en segundo plano.
    const cargaDisruptiva = this.vista === 'normativa' || this.vista === 'punto';
    this.cargandoDetalle = cargaDisruptiva;
    this.error = null;
    this.backend.obtenerGestionSeguridadAsignacion(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.capitulosInicializados = false;
          this.capitulosCerrados.clear();
          this.detalle = {
            asignacion: res.asignacion,
            puntos: (res?.puntos || []).map((p: any) => this.mapearPunto(p)),
            documentos_generales: res?.documentos_generales || []
          };
          this.inicializarCapitulosColapsados();
          this.precargarThumbsEvidencias(this.detalle.puntos);
          if (requisitoId) {
            this.puntoActivo = this.detalle.puntos.find((p) => p.id === requisitoId) || null;
            if (!this.puntoActivo) {
              this.error = 'No se encontró el punto de la normativa.';
              this.lecturaHtml = null;
              this.observacionesDraft = '';
              this.limpiarFormatoPreviewBlob();
            } else {
              this.observacionesDraft = this.puntoActivo.observaciones || '';
              this.prepararLecturaPunto(this.puntoActivo);
            }
          } else {
            this.puntoActivo = null;
            this.lecturaHtml = null;
            this.observacionesDraft = '';
            this.limpiarFormatoPreviewBlob();
          }
          this.cargandoDetalle = false;
          if (this.vista === 'empresa' || this.vista === 'empresas') {
            if (this.vista === 'empresa') this.actualizarGraficosEmpresa();
            this.liberarScrollAncla();
          } else {
            this.scrollAncla = null;
          }
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la normativa asignada.';
          this.detalle = null;
          this.puntoActivo = null;
          this.cargandoDetalle = false;
          if (this.vista === 'empresa' || this.vista === 'empresas') {
            if (this.vista === 'empresa') this.actualizarGraficosEmpresa();
            this.liberarScrollAncla();
          } else {
            this.scrollAncla = null;
          }
        }
      });
  }

  private mapearPunto(p: any): PuntoGestion {
    const accionesRaw = p?.acciones || {};
    const prev = accionesRaw.preventiva || {};
    const corr = accionesRaw.correctiva || {};
    const score = p.accion_score != null && p.accion_score !== ''
      ? Number(p.accion_score)
      : null;
    const acciones = score != null && !Number.isNaN(score)
      ? this.accionesDesdeScore(score)
      : {
        preventiva: {
          conservar: !!prev.conservar,
          mejorar: !!prev.mejorar,
          actualizar: !!prev.actualizar
        },
        correctiva: {
          complementar: !!corr.complementar,
          corregir: !!corr.corregir,
          realizar: !!corr.realizar
        }
      };
    return {
      id: Number(p.id),
      numero_item: p.numero_item != null && p.numero_item !== '' ? Number(p.numero_item) : null,
      punto_norma: String(p.punto_norma || '').trim(),
      descripcion: String(p.descripcion || '').trim(),
      descripcion_html: p.descripcion_html || null,
      tipo_evidencia: p.tipo_evidencia || null,
      periodicidad: p.periodicidad || null,
      accion_score: score != null && !Number.isNaN(score) ? score : this.pesoDesdeAcciones(acciones),
      acciones,
      fecha_inicio: p.fecha_inicio || null,
      fecha_terminacion: p.fecha_terminacion || p.ultima_evidencia || null,
      evidencia_requerida: p.evidencia_requerida || null,
      observaciones: p.observaciones || null,
      indicador_avance: p.indicador_avance != null && p.indicador_avance !== ''
        ? Number(p.indicador_avance)
        : null,
      responsable: p.responsable === 'Cliente' ? 'Cliente' : 'Empresa',
      formato_nombre: p.formato_nombre || null,
      formato_archivo: p.formato_archivo || null,
      formato_nombre_archivo: p.formato_nombre_archivo || null,
      ultima_evidencia: p.ultima_evidencia || null,
      estado: p.estado === 'cumple' ? 'cumple' : (p.estado === 'parcial' ? 'parcial' : 'no_cumple'),
      imagenes: Array.isArray(p.imagenes)
        ? p.imagenes.map((img: any) => ({
          id: Number(img.id),
          ruta: String(img.ruta || ''),
          nombre: String(img.nombre || '')
        })).filter((img: ImagenPuntoLite) => !!img.ruta)
        : [],
      documentos: p.documentos || []
    };
  }

  private accionesDesdeScore(score: number): AccionesPunto {
    return {
      preventiva: {
        conservar: score === 100,
        mejorar: score === 80,
        actualizar: score === 60
      },
      correctiva: {
        complementar: score === 40,
        corregir: score === 20,
        realizar: score === 0
      }
    };
  }

  private pesoDesdeAcciones(a: AccionesPunto): number | null {
    if (a?.preventiva?.conservar) return 100;
    if (a?.preventiva?.mejorar) return 80;
    if (a?.preventiva?.actualizar) return 60;
    if (a?.correctiva?.complementar) return 40;
    if (a?.correctiva?.corregir) return 20;
    if (a?.correctiva?.realizar) return 0;
    return null;
  }

  private aplicarDetalleActualizado(res: any, requisitoId?: number): void {
    this.detalle = {
      asignacion: res.asignacion,
      puntos: (res?.puntos || []).map((p: any) => this.mapearPunto(p)),
      documentos_generales: res?.documentos_generales || []
    };
    this.precargarThumbsEvidencias(this.detalle.puntos);
    const id = requisitoId || this.puntoActivo?.id;
    if (id) {
      this.puntoActivo = this.detalle.puntos.find((p) => p.id === id) || null;
      if (this.puntoActivo) {
        this.observacionesDraft = this.puntoActivo.observaciones || '';
        this.prepararLecturaPunto(this.puntoActivo);
      }
    }
  }

  logoEmpresa(empresaId: number): string | null {
    const raw = this.logosEmpresa.get(empresaId);
    return raw ? this.backend.resolverUrlDrivePreview(raw) : null;
  }

  inicialesEmpresa(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return 'E';
    const a = partes[0][0] || '';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || '');
    return (a + b).toUpperCase();
  }

  urlPortada(item: { imagen_portada?: string | null }): string | null {
    const ruta = item?.imagen_portada;
    if (!ruta) return null;
    return this.urlArchivo(ruta);
  }

  urlArchivo(ruta: string | null | undefined): string | null {
    if (!ruta) return null;
    if (/^https?:/i.test(ruta)) return ruta;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  }

  categoriaLabel(id: string): string {
    return this.categorias.find((c) => c.id === id)?.prefijo || id;
  }

  contarNormasEmpresa(categoriaId: string): number {
    if (!categoriaId) return this.asignaciones.length;
    return this.asignaciones.filter((a) => a.categoria_id === categoriaId).length;
  }

  seleccionarCategoriaFiltro(id: string): void {
    if (!this.empresa) return;
    const next = this.categoriaFiltro === id ? null : (id || null);
    this.router.navigate(['/seguridad/gestion/empresa', this.empresa.empresa_id], {
      queryParams: next ? { categoria: next } : {}
    });
  }

  alCambiarBusquedaNorma(): void {
    if (this.vista === 'empresa') this.sincronizarNormativaFoco();
  }

  seleccionarEmpresaTablero(emp: EmpresaResumen, event?: Event): void {
    event?.stopPropagation();
    if (this.empresaSeleccionada?.empresa_id === emp.empresa_id) {
      this.cerrarTableroEmpresa();
      return;
    }
    this.empresaSeleccionada = emp;
    this.panelModo = 'general';
    this.normativaFoco = null;
    this.detalle = null;
    this.tableroRingAnim += 1;
    this.cargarAsignacionesTablero(emp.empresa_id);
  }

  private cargarAsignacionesTablero(empresaId: number): void {
    this.cargandoTablero = true;
    this.asignacionesTablero = [];
    this.resumenTableroResp = {
      cerrados_empresa: 0,
      abiertos_empresa: 0,
      cerrados_cliente: 0,
      abiertos_cliente: 0
    };
    this.backend.obtenerEmpresaGestionSeguridad(empresaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          if (this.empresaSeleccionada?.empresa_id !== empresaId) return;
          this.asignacionesTablero = res?.asignaciones || [];
          if (res?.empresa) {
            this.empresaSeleccionada = {
              ...this.empresaSeleccionada!,
              ...res.empresa,
              logo: this.logosEmpresa.get(empresaId) || this.empresaSeleccionada!.logo || null
            };
          }
          this.cargandoTablero = false;
          this.cargarResumenResponsablesTablero(empresaId, this.asignacionesTablero);
        },
        error: () => {
          if (this.empresaSeleccionada?.empresa_id !== empresaId) return;
          this.asignacionesTablero = [];
          this.cargandoTablero = false;
        }
      });
  }

  private cargarResumenResponsablesTablero(empresaId: number, normas: AsignacionResumen[]): void {
    if (!normas.length) return;
    const peticiones = normas.map((n) =>
      this.backend.obtenerGestionSeguridadAsignacion(n.id).pipe(catchError(() => of(null)))
    );
    forkJoin(peticiones)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resultados: any[]) => {
          if (this.empresaSeleccionada?.empresa_id !== empresaId) return;
          const acc: ResumenResponsables = {
            cerrados_empresa: 0,
            abiertos_empresa: 0,
            cerrados_cliente: 0,
            abiertos_cliente: 0
          };
          for (const res of resultados) {
            for (const p of res?.puntos || []) {
              const esCliente = String(p.responsable || '') === 'Cliente';
              const cerrado = p.estado === 'cumple' || (Array.isArray(p.documentos) && p.documentos.length > 0);
              if (cerrado) {
                if (esCliente) acc.cerrados_cliente += 1;
                else acc.cerrados_empresa += 1;
              } else if (esCliente) {
                acc.abiertos_cliente += 1;
              } else {
                acc.abiertos_empresa += 1;
              }
            }
          }
          this.resumenTableroResp = acc;
        }
      });
  }

  trackByEmpresaId(_: number, emp: EmpresaResumen): number {
    return emp.empresa_id;
  }

  seleccionarPanelGeneral(): void {
    this.anclarScroll();
    this.panelModo = 'general';
    this.normativaFoco = null;
    this.detalle = null;
    this.cargandoDetalle = false;
    if (this.vista === 'empresa') this.actualizarGraficosEmpresa();
    this.liberarScrollAncla();
  }

  seleccionarNormativaFoco(item: AsignacionResumen): void {
    this.anclarScroll();
    this.panelModo = 'normativa';
    this.normativaFoco = item;
    // Actualiza con resumen inmediato para no colapsar el layout ni saltar el scroll.
    if (this.vista === 'empresa') this.actualizarGraficosEmpresa();
    if (this.detalle?.asignacion?.id === item.id) {
      this.liberarScrollAncla();
      return;
    }
    // Mantén el detalle previo hasta que llegue el nuevo (evita parpadeo en blanco).
    if (this.scrollAncla != null) {
      const y = this.scrollAncla;
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: 'auto' }));
    }
    this.cargarDetalle(item.id);
  }

  /** Guarda el scroll actual antes de refrescar el panel de gráficos. */
  private anclarScroll(): void {
    this.scrollAncla = window.scrollY || document.documentElement.scrollTop || 0;
  }

  /** Restaura el scroll anclado (doble rAF por si ApexCharts ajusta altura). */
  private liberarScrollAncla(): void {
    if (this.scrollAncla == null) return;
    const y = this.scrollAncla;
    this.scrollAncla = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: 'auto' });
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: 'auto' }));
    });
  }

  /** Reconstruye los 3 gráficos del encabezado (vista empresa). */
  actualizarGraficosEmpresa(): void {
    if (this.vista !== 'empresa' || !this.empresa) {
      this.chartsListos = false;
      return;
    }
    if (this.panelModo === 'normativa' && this.normativaFoco) {
      this.construirGraficosNormativa();
    } else {
      this.construirGraficosGeneral();
    }
    this.chartsListos = true;
  }

  private construirGraficosGeneral(): void {
    const rg = this.resumenGeneralEmpresa;
    const avance = rg.avance || 0;
    const cerradas = rg.cerradas || 0;
    const abiertas = rg.abiertas || 0;
    this.chartAvance = {
      series: [avance],
      chart: {
        type: 'radialBar',
        height: 252,
        sparkline: { enabled: true },
        fontFamily: 'inherit',
        animations: { enabled: true, speed: 650, animateGradually: { enabled: true, delay: 80 } }
      },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135,
          hollow: { size: '62%', margin: 8, background: 'transparent' },
          track: {
            background: 'rgba(148, 163, 184, 0.22)',
            strokeWidth: '97%',
            margin: 4,
            dropShadow: { enabled: false }
          },
          dataLabels: {
            name: { show: true, fontSize: '11px', color: '#64748b', offsetY: 22, fontWeight: 700 },
            value: {
              show: true,
              fontSize: '28px',
              fontWeight: 800,
              color: '#0f172a',
              offsetY: -12,
              formatter: (val: number) => `${Math.round(val)}%`
            }
          }
        }
      },
      colors: [this.colorAnillo(avance)],
      labels: ['Avance general'],
      stroke: { lineCap: 'round' },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'horizontal',
          shadeIntensity: 0.35,
          gradientToColors: [this.colorAnilloClaro(avance)],
          inverseColors: false,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100]
        }
      }
    };

    const estadoSeries = [cerradas, abiertas];
    const estadoTotal = cerradas + abiertas;
    this.chartEstado = {
      series: estadoTotal ? estadoSeries : [0, 1],
      chart: {
        type: 'donut',
        height: 252,
        fontFamily: 'inherit',
        animations: { enabled: true, speed: 650 }
      },
      labels: ['Cerradas', 'Abiertas'],
      colors: ['#0f766e', '#be123c'],
      legend: {
        position: 'bottom',
        fontSize: '11px',
        fontWeight: 700,
        labels: { colors: '#475569' },
        markers: { width: 9, height: 9, radius: 10, offsetX: -2 },
        itemMargin: { horizontal: 10, vertical: 2 }
      },
      dataLabels: {
        enabled: !!estadoTotal,
        formatter: (val: number) => `${Math.round(val)}%`,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          donut: {
            size: '72%',
            background: 'transparent',
            labels: {
              show: true,
              name: { show: true, fontSize: '11px', fontWeight: 700, color: '#64748b', offsetY: -2 },
              value: { show: true, fontSize: '22px', fontWeight: 800, color: '#0f172a', offsetY: 4 },
              total: {
                show: true,
                showAlways: true,
                label: 'Normativas',
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                formatter: () => String(rg.normativas || 0)
              }
            }
          }
        }
      },
      stroke: { width: 3, colors: ['#fff'] },
      tooltip: {
        y: {
          formatter: (_val: number, opts: any) => {
            if (!estadoTotal) return '0';
            return `${opts.w.config.series[opts.seriesIndex]} normativa(s)`;
          }
        }
      }
    };

    const normas = this.asignaciones.slice().sort((a, b) =>
      a.codigo.localeCompare(b.codigo, 'es', { numeric: true })
    );
    const cats = this.categoriasEmpresa.length
      ? this.categoriasEmpresa
      : [];
    const usarGrupos = cats.length > 0 && normas.length > 6;
    const categorias = usarGrupos
      ? cats.map((c) => c.prefijo)
      : (normas.length ? normas.map((n) => this.codigoCorto(n.codigo)) : ['Sin datos']);
    const datos = usarGrupos
      ? cats.map((c) => c.avance)
      : (normas.length ? normas.map((n) => n.avance) : [0]);

    this.chartDesempeno = {
      series: [{ name: 'Avance', data: datos }],
      chart: {
        type: usarGrupos ? 'bar' : 'area',
        height: 252,
        toolbar: { show: false },
        fontFamily: 'inherit',
        zoom: { enabled: false },
        animations: { enabled: true, speed: 650 }
      },
      colors: ['#9f1239'],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: usarGrupos ? 0 : 3 },
      fill: usarGrupos
        ? { type: 'solid', opacity: 1 }
        : {
          type: 'gradient',
          gradient: {
            shadeIntensity: 0.55,
            opacityFrom: 0.55,
            opacityTo: 0.04,
            stops: [0, 85, 100]
          }
        },
      plotOptions: usarGrupos
        ? {
          bar: {
            borderRadius: 6,
            columnWidth: '48%',
            distributed: true,
            borderRadiusApplication: 'end'
          }
        }
        : {},
      xaxis: {
        categories: categorias,
        labels: {
          style: { fontSize: '10px', colors: '#64748b', fontWeight: 700 },
          rotate: categorias.length > 4 ? -35 : 0,
          hideOverlappingLabels: true
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        min: 0,
        max: 100,
        tickAmount: 4,
        labels: {
          style: { fontSize: '10px', colors: '#94a3b8', fontWeight: 600 },
          formatter: (v: number) => `${Math.round(v)}%`
        }
      },
      grid: {
        borderColor: 'rgba(226, 232, 240, 0.9)',
        strokeDashArray: 4,
        padding: { left: 8, right: 8 }
      },
      legend: { show: false },
      tooltip: {
        theme: 'light',
        y: { formatter: (v: number) => `${Math.round(v)}%` }
      }
    };
  }

  private construirGraficosNormativa(): void {
    const rn = this.resumenNormativaFoco;
    const avance = rn?.avance ?? this.normativaFoco?.avance ?? 0;
    const cerrados = rn?.cerrados ?? 0;
    const abiertos = rn?.abiertos ?? 0;
    const totalPts = rn?.puntos_total ?? this.normativaFoco?.puntos_asignados ?? 0;

    this.chartAvance = {
      series: [avance],
      chart: {
        type: 'radialBar',
        height: 252,
        sparkline: { enabled: true },
        fontFamily: 'inherit',
        animations: { enabled: true, speed: 650 }
      },
      plotOptions: {
        radialBar: {
          startAngle: -135,
          endAngle: 135,
          hollow: { size: '62%', margin: 8, background: 'transparent' },
          track: {
            background: 'rgba(148, 163, 184, 0.22)',
            strokeWidth: '97%',
            margin: 4
          },
          dataLabels: {
            name: { show: true, fontSize: '11px', color: '#64748b', offsetY: 22, fontWeight: 700 },
            value: {
              show: true,
              fontSize: '28px',
              fontWeight: 800,
              color: '#0f172a',
              offsetY: -12,
              formatter: (val: number) => `${Math.round(val)}%`
            }
          }
        }
      },
      colors: [this.colorAnillo(avance)],
      labels: ['Avance NOM'],
      stroke: { lineCap: 'round' },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'horizontal',
          shadeIntensity: 0.35,
          gradientToColors: [this.colorAnilloClaro(avance)],
          inverseColors: false,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100]
        }
      }
    };

    const ptsTotal = cerrados + abiertos;
    this.chartEstado = {
      series: ptsTotal ? [cerrados, abiertos] : [0, 1],
      chart: {
        type: 'donut',
        height: 252,
        fontFamily: 'inherit',
        animations: { enabled: true, speed: 650 }
      },
      labels: ['Cerrados', 'Abiertos'],
      colors: ['#0f766e', '#c2410c'],
      legend: {
        position: 'bottom',
        fontSize: '11px',
        fontWeight: 700,
        labels: { colors: '#475569' },
        markers: { width: 9, height: 9, radius: 10, offsetX: -2 },
        itemMargin: { horizontal: 10, vertical: 2 }
      },
      dataLabels: {
        enabled: !!ptsTotal,
        formatter: (val: number) => `${Math.round(val)}%`,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] },
        dropShadow: { enabled: false }
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: { show: true, fontSize: '11px', fontWeight: 700, color: '#64748b', offsetY: -2 },
              value: { show: true, fontSize: '22px', fontWeight: 800, color: '#0f172a', offsetY: 4 },
              total: {
                show: true,
                showAlways: true,
                label: 'Puntos',
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                formatter: () => String(totalPts)
              }
            }
          }
        }
      },
      stroke: { width: 3, colors: ['#fff'] }
    };

    const ce = rn?.cerrados_empresa ?? 0;
    const ae = rn?.abiertos_empresa ?? 0;
    const cc = rn?.cerrados_cliente ?? 0;
    const ac = rn?.abiertos_cliente ?? 0;
    this.chartDesempeno = {
      series: [
        { name: 'Cerrados', data: [ce, cc] },
        { name: 'Abiertos', data: [ae, ac] }
      ],
      chart: {
        type: 'bar',
        height: 252,
        stacked: true,
        toolbar: { show: false },
        fontFamily: 'inherit',
        animations: { enabled: true, speed: 650 }
      },
      colors: ['#0f766e', '#be123c'],
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 6,
          barHeight: '48%',
          borderRadiusApplication: 'end'
        }
      },
      dataLabels: { enabled: false },
      xaxis: {
        categories: ['Empresa', 'Cliente'],
        labels: { style: { fontSize: '11px', colors: '#64748b', fontWeight: 700 } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: { labels: { style: { fontSize: '11px', colors: '#334155', fontWeight: 700 } } },
      grid: {
        borderColor: 'rgba(226, 232, 240, 0.9)',
        strokeDashArray: 4,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } }
      },
      legend: {
        position: 'bottom',
        fontSize: '11px',
        fontWeight: 700,
        labels: { colors: '#475569' },
        markers: { width: 9, height: 9, radius: 10, offsetX: -2 },
        itemMargin: { horizontal: 10, vertical: 2 }
      },
      tooltip: { theme: 'light', y: { formatter: (v: number) => `${v} pts` } }
    };
  }

  /** Lista de normativas del panel expandido (tablero) o de la vista empresa. */
  get normativasPanel(): AsignacionResumen[] {
    const lista = this.vista === 'empresas' ? this.asignacionesTablero : this.asignaciones;
    const q = this.busquedaTableroNorma.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((a) =>
      a.codigo.toLowerCase().includes(q)
      || this.codigoCorto(a.codigo).toLowerCase().includes(q)
    );
  }

  trackByAsignacionId(_: number, item: AsignacionResumen): number {
    return item.id;
  }

  trackByPuntoId(_: number, punto: PuntoGestion): number {
    return punto.id;
  }

  trackByCapitulo(_: number, bloque: { clave: string }): string {
    return bloque.clave;
  }

  prepararLecturaPunto(punto: PuntoGestion): void {
    const { html, sobrantes } = construirHtmlPuntoLectura(punto, (r) => this.urlArchivo(r));
    this.lecturaHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    this.imagenesSobrantes = sobrantes;
    this.imagenAbierta = null;
    this.precargarFormatoPreview(punto);
  }

  private limpiarFormatoPreviewBlob(): void {
    if (this.formatoPreviewBlob) {
      try { URL.revokeObjectURL(this.formatoPreviewBlob); } catch { /* ignore */ }
      this.formatoPreviewBlob = null;
    }
  }

  private precargarFormatoPreview(punto: PuntoGestion): void {
    this.limpiarFormatoPreviewBlob();
    if (!this.esFormatoPdf(punto)) return;
    const url = this.urlPlantilla(punto);
    if (!url || /drive\.google\.com/i.test(url)) return;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        const typed = blob.type ? blob : new Blob([blob], { type: 'application/pdf' });
        this.formatoPreviewBlob = URL.createObjectURL(typed);
        this.cdr.markForCheck();
      })
      .catch(() => { /* fallback a URL directa */ });
  }

  alClicDescripcion(ev: MouseEvent): void {
    const img = (ev.target as HTMLElement | null)?.closest?.('img');
    if (img instanceof HTMLImageElement && img.src) this.imagenAbierta = img.src;
  }

  nombreFormatoVisible(punto: PuntoGestion): string {
    return punto.formato_nombre_archivo || punto.formato_nombre || 'Formato guía';
  }

  esPreviewImagen(ruta: string | null | undefined): boolean {
    const ext = String(ruta || '').split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  }

  esPreviewPdf(ruta: string | null | undefined): boolean {
    return String(ruta || '').toLowerCase().endsWith('.pdf');
  }

  abrirVisorFormato(event: Event, punto: PuntoGestion): void {
    event.preventDefault();
    event.stopPropagation();
    const url = this.urlPlantilla(punto);
    if (!url) return;
    const nombre = this.nombreFormatoVisible(punto);
    const ext = (punto.formato_archivo || nombre).split('.').pop()?.toLowerCase() || '';
    const tipoHint = ['pdf'].includes(ext)
      ? 'pdf' as const
      : (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
        ? 'imagen' as const
        : (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext) ? 'office' as const : undefined));
    this.preview.abrir({
      nombre,
      archivo_nombre: nombre,
      etiqueta: 'FORMATO',
      tema: 'seguridad',
      urlLocal: url,
      tipoHint
    });
  }

  /** URL embebible (Drive preview o archivo local) para miniatura. */
  urlPreviewEmbebido(url: string | null | undefined): SafeResourceUrl | null {
    if (!url) return null;
    const key = `local:${url}`;
    let safe = this.previewUrlCache.get(key);
    if (!safe) {
      safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.previewUrlCache.set(key, safe);
    }
    return safe;
  }

  /** Ajusta PDF embebido a ancho de página (evita zoom excesivo / franja negra). */
  private urlPdfFit(url: string): string {
    const base = url.split('#')[0];
    return `${base}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`;
  }

  urlPreviewDrive(fileId: string | null | undefined): SafeResourceUrl | null {
    if (!fileId) return null;
    const key = `drive:${fileId}`;
    let safe = this.previewUrlCache.get(key);
    if (!safe) {
      safe = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
      );
      this.previewUrlCache.set(key, safe);
    }
    return safe;
  }

  /** Miniatura de Drive (más fiable que iframe escalado). */
  previewThumbDrive(doc: DocumentoItem): string | null {
    if (!doc.drive_file_id || this.driveThumbFallidos.has(doc.id)) return null;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(doc.drive_file_id)}&sz=w1600`;
  }

  onDriveThumbError(doc: DocumentoItem, event: Event): void {
    this.driveThumbFallidos.add(doc.id);
    this.onThumbError(event);
    this.cdr.markForCheck();
  }

  urlPreviewFormato(punto: PuntoGestion): SafeResourceUrl | null {
    if (this.formatoPreviewBlob) {
      return this.urlPreviewEmbebido(this.urlPdfFit(this.formatoPreviewBlob));
    }
    const url = this.urlPlantilla(punto);
    if (!url) return null;
    if (this.esFormatoPdf(punto)) {
      return this.urlPreviewEmbebido(this.urlPdfFit(url));
    }
    return this.urlPreviewEmbebido(url);
  }

  esFormatoPdf(punto: PuntoGestion): boolean {
    const nombre = punto.formato_archivo || punto.formato_nombre_archivo || '';
    return String(nombre).toLowerCase().endsWith('.pdf');
  }

  esPdfDocumento(doc: DocumentoItem): boolean {
    return this.etiquetaTipoArchivo(doc.nombre_original) === 'PDF';
  }

  /** Preview local (blob) de evidencia PDF vía iframe FitH. */
  previewBlobPdfEvidencia(doc: DocumentoItem): SafeResourceUrl | null {
    const blob = this.thumbsBlob.get(doc.id);
    if (!blob || !this.esPdfDocumento(doc)) return null;
    return this.urlPreviewEmbebido(this.urlPdfFit(blob));
  }

  esFormatoOffice(punto: PuntoGestion): boolean {
    const ext = String(punto.formato_archivo || punto.formato_nombre_archivo || '')
      .split('.').pop()?.toLowerCase() || '';
    return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
  }

  iconoCategoria(id: string): string {
    return SEG_NORMATIVAS_CATEGORIAS.find((c) => c.id === id)?.iconClass || 'fas fa-book';
  }

  /** Porcentaje de cierre: cerrados / (cerrados + abiertos). */
  pctCerradosAbiertos(cerrados: number, abiertos: number): number {
    const c = Number(cerrados) || 0;
    const a = Number(abiertos) || 0;
    const total = c + a;
    return total ? Math.round((c / total) * 100) : 0;
  }

  /** Etiqueta corta para chips: NOM-001-STPS-2008 → NOM-001 */
  codigoCorto(codigo: string): string {
    const raw = String(codigo || '').trim();
    const m = raw.match(/^(NOM-\d+(?:-\d+)?)/i);
    return m ? m[1].toUpperCase() : (raw || 'NOM');
  }

  colorAvance(pct: number): string {
    if (pct >= 80) return 'ok';
    if (pct >= 40) return 'mid';
    return 'low';
  }

  colorAnillo(pct: number): string {
    const t = this.colorAvance(pct);
    if (t === 'ok') return '#0f766e';
    if (t === 'mid') return '#c2410c';
    return '#b91c1c';
  }

  /** Tono claro del anillo para degradados en gráficos. */
  colorAnilloClaro(pct: number): string {
    const t = this.colorAvance(pct);
    if (t === 'ok') return '#2dd4bf';
    if (t === 'mid') return '#fb923c';
    return '#f43f5e';
  }

  /** Anillo fino (menos invasivo) con pista suave. */
  anilloStyle(pct: number): { [key: string]: string } {
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = this.colorAnillo(pct);
    return {
      background: `conic-gradient(${color} ${n * 3.6}deg, rgba(226, 232, 240, 0.55) 0deg)`
    };
  }

  /**
   * Avance del punto por cumplimiento (evidencias).
   * El nivel de acción (100–0) no interviene aquí: solo se guarda.
   */
  avancePunto(punto: PuntoGestion): number {
    if (punto.estado === 'cumple') return 100;
    if (punto.estado === 'parcial') return 50;
    return 0;
  }

  etiquetaTipoArchivo(nombre: string | null | undefined): string {
    const ext = String(nombre || '').split('.').pop()?.toLowerCase() || '';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'EXCEL';
    if (['doc', 'docx'].includes(ext)) return 'WORD';
    if (['ppt', 'pptx'].includes(ext)) return 'PPT';
    if (ext === 'pdf') return 'PDF';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'IMAGEN';
    if (ext === 'zip') return 'ZIP';
    return ext ? ext.toUpperCase() : 'ARCHIVO';
  }

  /** Vista embebida Drive (iframe) para evidencias. */
  previewDriveEvidencia(doc: DocumentoItem): SafeResourceUrl | null {
    return this.urlPreviewDrive(doc.drive_file_id || undefined);
  }

  /** Blob URL cacheada (fallback si no hay Drive). */
  thumbBlobEvidencia(doc: DocumentoItem): string | null {
    return this.thumbsBlob.get(doc.id) || null;
  }

  private limpiarThumbsBlob(): void {
    for (const url of this.thumbsBlob.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    this.thumbsBlob.clear();
  }

  private precargarThumbsEvidencias(puntos: PuntoGestion[]): void {
    this.limpiarThumbsBlob();
    this.driveThumbFallidos.clear();
    for (const p of puntos) {
      for (const doc of p.documentos || []) {
        if (doc.drive_file_id) continue;
        const tipo = this.etiquetaTipoArchivo(doc.nombre_original);
        if (tipo !== 'PDF' && tipo !== 'IMAGEN') continue;
        this.backend.descargarDocumentoSeguridadAsignacion(doc.id)
          .pipe(takeUntil(this.destroy$), catchError(() => of(null)))
          .subscribe((blob) => {
            if (!blob) return;
            const mime = tipo === 'PDF'
              ? 'application/pdf'
              : (blob.type || 'image/jpeg');
            const typed = blob.type ? blob : new Blob([blob], { type: mime });
            this.thumbsBlob.set(doc.id, URL.createObjectURL(typed));
          });
      }
    }
  }

  onThumbError(event: Event): void {
    const el = event.target as HTMLElement | null;
    if (el) el.style.display = 'none';
  }

  abrirVisorEvidencia(doc: DocumentoItem, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const nombre = doc.nombre_original || 'Evidencia';
    const ext = nombre.split('.').pop()?.toLowerCase() || '';
    const office = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
    const tipoHint = office
      ? 'office' as const
      : (ext === 'pdf' ? 'pdf' as const : (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? 'imagen' as const : undefined));

    // Preferir blob autenticado (más fiable que iframe anónimo de Drive).
    this.backend.descargarDocumentoSeguridadAsignacion(doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.preview.abrir({
            nombre,
            archivo_nombre: nombre,
            archivoBlob: blob,
            archivo_url: doc.drive_file_id || undefined,
            previewUrl: doc.drive_file_id
              ? `https://drive.google.com/file/d/${doc.drive_file_id}/preview`
              : undefined,
            etiqueta: 'EVIDENCIA',
            tema: 'seguridad',
            tipoHint
          });
        },
        error: () => {
          if (doc.drive_file_id) {
            this.preview.abrir({
              nombre,
              archivo_nombre: nombre,
              archivo_url: doc.drive_file_id,
              previewUrl: `https://drive.google.com/file/d/${doc.drive_file_id}/preview`,
              etiqueta: 'EVIDENCIA',
              tema: 'seguridad',
              tipoHint
            });
            return;
          }
          Swal.fire({
            icon: 'error',
            title: 'No se pudo abrir',
            text: 'Intente descargar el archivo.',
            confirmButtonColor: '#b91c1c'
          });
        }
      });
  }

  pesoAccionSeleccionada(punto: PuntoGestion): number | null {
    if (punto.accion_score != null) return Number(punto.accion_score);
    return this.pesoDesdeAcciones(punto.acciones);
  }

  opcionAccion(score: number | null | undefined): AccionScoreOpcion | null {
    if (score == null) return null;
    return ACCIONES_SCORE.find((o) => o.score === Number(score)) || null;
  }

  etiquetaAccionActiva(punto: PuntoGestion): string {
    const op = this.opcionAccion(this.pesoAccionSeleccionada(punto));
    return op ? `${op.etiqueta} · ${op.score}` : 'Sin acción';
  }

  tipoAccionGrupo(punto: PuntoGestion): 'preventiva' | 'correctiva' | null {
    return this.opcionAccion(this.pesoAccionSeleccionada(punto))?.grupo || null;
  }

  fechaIsoCorta(iso: string | null | undefined): string {
    if (!iso) return '—';
    const raw = String(iso).slice(0, 10);
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Solo mes y año (fecha de inicio). */
  fechaMesAnio(iso: string | null | undefined): string {
    if (!iso) return '—';
    const raw = String(iso).slice(0, 10);
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  mesInicioDe(punto: PuntoGestion): number | null {
    if (!punto.fecha_inicio) return null;
    const m = String(punto.fecha_inicio).slice(5, 7);
    const n = Number(m);
    return n >= 1 && n <= 12 ? n : null;
  }

  anioInicioDe(punto: PuntoGestion): number | null {
    if (!punto.fecha_inicio) return null;
    const y = Number(String(punto.fecha_inicio).slice(0, 4));
    return y > 0 ? y : null;
  }

  seleccionarAccion(punto: PuntoGestion, score: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.detalle || this.guardandoPunto) return;
    if (punto.accion_score === score) return;
    this.guardarCamposPunto(punto.id, { accion_score: score });
  }

  alCambiarInicioMes(punto: PuntoGestion, mes: number | string): void {
    const m = Number(mes);
    const y = this.anioInicioDe(punto) || new Date().getFullYear();
    if (!m) {
      this.guardarCamposPunto(punto.id, { fecha_inicio: null });
      return;
    }
    this.guardarCamposPunto(punto.id, {
      fecha_inicio: `${y}-${String(m).padStart(2, '0')}`
    });
  }

  alCambiarInicioAnio(punto: PuntoGestion, anio: number | string): void {
    const y = Number(anio);
    const m = this.mesInicioDe(punto) || (new Date().getMonth() + 1);
    if (!y) {
      this.guardarCamposPunto(punto.id, { fecha_inicio: null });
      return;
    }
    this.guardarCamposPunto(punto.id, {
      fecha_inicio: `${y}-${String(m).padStart(2, '0')}`
    });
  }

  guardarObservaciones(): void {
    if (!this.puntoActivo || !this.detalle || this.guardandoPunto) return;
    const texto = (this.observacionesDraft || '').trim();
    if (texto === (this.puntoActivo.observaciones || '').trim()) return;
    this.guardarCamposPunto(this.puntoActivo.id, { observaciones: texto || null });
  }

  private guardarCamposPunto(
    requisitoId: number,
    datos: {
      accion_score?: number | null;
      fecha_inicio?: string | null;
      observaciones?: string | null;
    }
  ): void {
    if (!this.detalle) return;
    this.guardandoPunto = true;
    this.backend.actualizarPuntoGestionSeguridad(this.detalle.asignacion.id, requisitoId, datos)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.guardandoPunto = false;
          this.aplicarDetalleActualizado(res, requisitoId);
        },
        error: (err: any) => {
          this.guardandoPunto = false;
          Swal.fire({
            icon: 'error',
            title: 'No se guardó',
            text: err?.error?.message || 'Intente de nuevo.',
            confirmButtonColor: '#b91c1c'
          });
        }
      });
  }

  /** Retraso escalonado para animaciones de entrada (ms). */
  retrasoEntrada(index: number, base = 45): string {
    return `${Math.min(index, 14) * base}ms`;
  }

  get totalesEmpresas(): { empresas: number; normativas: number; avance: number } {
    const empresas = this.empresas.length;
    const normativas = this.empresas.reduce((s, e) => s + e.normativas, 0);
    const ptsA = this.empresas.reduce((s, e) => s + e.puntos_asignados, 0);
    const ptsE = this.empresas.reduce((s, e) => s + e.puntos_con_evidencia, 0);
    const avance = ptsA ? Math.round((ptsE / ptsA) * 100) : 0;
    return { empresas, normativas, avance };
  }

  conteoEstadosPuntos(): { cumple: number; pendiente: number } {
    const pts = this.detalle?.puntos || [];
    const cumple = pts.filter((p) => p.estado === 'cumple').length;
    return {
      cumple,
      pendiente: Math.max(0, pts.length - cumple)
    };
  }

  resumenBloque(puntos: PuntoGestion[]): string {
    const cumple = puntos.filter((p) => p.estado === 'cumple').length;
    const parcial = puntos.filter((p) => p.estado === 'parcial').length;
    const pend = puntos.length - cumple - parcial;
    if (cumple === puntos.length && puntos.length) return 'Completo';
    if (!cumple && !parcial) return 'Pendiente';
    return `${cumple} ok · ${parcial} parcial · ${pend} pend.`;
  }

  etiquetaEstado(estado: string): string {
    if (estado === 'cumple') return 'Cumple';
    return 'No cumple';
  }

  fechaCorta(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fechaGestionEmpresa(emp: EmpresaResumen | null | undefined): string {
    return this.fechaCorta(emp?.ultima_gestion);
  }

  abrirEmpresa(emp: EmpresaResumen, event?: Event): void {
    event?.stopPropagation();
    this.empresaSeleccionada = emp;
    this.panelModo = 'general';
    this.normativaFoco = null;
    this.router.navigate(['/seguridad/gestion/empresa', emp.empresa_id], { queryParams: {} });
  }

  /** Desde el tablero: entra a la empresa y deja enfocada la NOM elegida. */
  abrirEmpresaConNorma(emp: EmpresaResumen, norma?: AsignacionResumen | null, event?: Event): void {
    event?.stopPropagation();
    this.empresaSeleccionada = emp;
    const normaId = norma?.id || this.normativaFoco?.id || 0;
    this.router.navigate(
      ['/seguridad/gestion/empresa', emp.empresa_id],
      { queryParams: normaId > 0 ? { norma: normaId } : {} }
    );
  }

  abrirNormativa(item: AsignacionResumen): void {
    this.router.navigate(['/seguridad/gestion', item.id]);
  }

  abrirNormativaFoco(): void {
    if (!this.normativaFoco) return;
    this.abrirNormativa(this.normativaFoco);
  }

  abrirPunto(punto: PuntoGestion): void {
    if (!this.detalle) return;
    this.router.navigate(['/seguridad/gestion', this.detalle.asignacion.id, 'punto', punto.id]);
  }

  volver(): void {
    if (this.vista === 'punto' && this.detalle) {
      this.router.navigate(['/seguridad/gestion', this.detalle.asignacion.id]);
      return;
    }
    if (this.vista === 'normativa' && this.detalle) {
      // No forzar filtro de categoría: al regresar deben verse todas las normativas.
      this.categoriaFiltro = null;
      this.busquedaNorma = '';
      this.panelModo = 'general';
      this.normativaFoco = null;
      this.router.navigate(
        ['/seguridad/gestion/empresa', this.detalle.asignacion.empresa_id],
        { queryParams: {} }
      );
      return;
    }
    this.router.navigate(['/seguridad/gestion']);
  }

  urlPlantilla(punto: PuntoGestion): string | null {
    return this.urlArchivo(punto.formato_archivo);
  }

  subir(requisitoId: number | null, event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    if (!archivos.length || !this.detalle) return;

    this.subiendo = true;
    const peticiones = archivos.map((archivo) =>
      this.backend.subirDocumentoSeguridadAsignacion(
        this.detalle!.asignacion.id,
        archivo,
        requisitoId,
        this.anioEvidencia
      ).pipe(catchError((err) => of({ __error: err, archivo: archivo.name })))
    );

    forkJoin(peticiones)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resultados: any[]) => {
          this.subiendo = false;
          const errores = resultados.filter((r) => r?.__error);
          const ok = resultados.length - errores.length;
          if (ok > 0) {
            const reqId = this.puntoActivo?.id;
            this.cargarDetalle(this.detalle!.asignacion.id, reqId);
          }
          if (errores.length) {
            const detalle = errores
              .map((e) => `${e.archivo}: ${e.__error?.error?.message || 'error'}`)
              .join('\n');
            Swal.fire({
              icon: ok ? 'warning' : 'error',
              title: ok ? `Se subieron ${ok}, fallaron ${errores.length}` : 'No se cargaron los archivos',
              text: detalle,
              confirmButtonColor: '#b91c1c'
            });
          } else {
            Swal.fire({
              icon: 'success',
              title: ok === 1 ? 'Evidencia cargada' : `${ok} evidencias cargadas`,
              text: `Guardadas en Drive · Normativas ${this.anioEvidencia}`,
              timer: 1800,
              showConfirmButton: false
            });
          }
        },
        error: (err: any) => {
          this.subiendo = false;
          Swal.fire({
            icon: 'error',
            title: 'No se cargó el archivo',
            text: err?.error?.message || 'Intente con PDF, Word, Excel, imagen o ZIP (máx. 25 MB).',
            confirmButtonColor: '#b91c1c'
          });
        }
      });
  }

  descargar(doc: DocumentoItem): void {
    if (doc.drive_web_view_link) {
      window.open(doc.drive_web_view_link, '_blank', 'noopener');
      return;
    }
    this.backend.descargarDocumentoSeguridadAsignacion(doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.nombre_original || 'documento';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'No se pudo descargar', confirmButtonColor: '#b91c1c' });
        }
      });
  }

  eliminarDoc(doc: DocumentoItem): void {
    Swal.fire({
      title: 'Quitar documento',
      text: doc.nombre_original,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c'
    }).then((r) => {
      if (!r.isConfirmed || !this.detalle) return;
      this.backend.eliminarDocumentoSeguridadAsignacion(doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => this.cargarDetalle(this.detalle!.asignacion.id, this.puntoActivo?.id),
          error: (err: any) => Swal.fire({
            icon: 'error',
            title: 'No se quitó',
            text: err?.error?.message || 'Intente de nuevo.',
            confirmButtonColor: '#b91c1c'
          })
        });
    });
  }

  peso(bytes: number): string {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  get categoriaActivaMeta(): CategoriaAvance | null {
    if (!this.categoriaFiltro) return null;
    return this.categoriasEmpresa.find((c) => c.categoria_id === this.categoriaFiltro) || null;
  }
}
