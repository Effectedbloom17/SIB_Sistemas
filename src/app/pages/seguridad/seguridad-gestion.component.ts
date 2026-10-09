import { Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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

interface PuntoGestion {
  id: number;
  numero_item: number | null;
  punto_norma: string;
  descripcion: string;
  descripcion_html?: string | null;
  aplica: boolean | null;
  tipo_evidencia: string | null;
  periodicidad: string | null;
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

/** Pesos de la plantilla Excel (acción preventiva / correctiva). */
const ACCION_PESOS = {
  conservar: 100,
  mejorar: 80,
  actualizar: 60,
  complementar: 40,
  corregir: 20,
  realizar: 0
} as const;

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

  detalle: DetalleGestion | null = null;
  cargandoDetalle = false;
  busquedaPunto = '';
  puntoActivo: PuntoGestion | null = null;
  subiendo = false;
  lecturaHtml: SafeHtml | null = null;
  imagenesSobrantes: ImagenPuntoLite[] = [];
  imagenAbierta: string | null = null;

  readonly categorias = SEG_NORMATIVAS_CATEGORIAS;
  private logosEmpresa = new Map<number, string | null>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private preview: DocumentPreviewService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(() => this.sincronizarRuta());
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.vista !== 'empresa') return;
      this.aplicarCategoriaQuery();
      if (!this.cargando && this.asignaciones.length) this.sincronizarNormativaFoco();
    });
  }

  ngOnDestroy(): void {
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
    const lista = this.detalle?.puntos || [];
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

  get bloquesCapitulo(): { clave: string; puntos: PuntoGestion[] }[] {
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
      .map(([clave, puntos]) => ({ clave, puntos }));
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
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la empresa.';
          this.empresa = null;
          this.asignaciones = [];
          this.normativaFoco = null;
          this.detalle = null;
          this.panelModo = 'general';
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
    this.cargandoDetalle = true;
    this.error = null;
    this.backend.obtenerGestionSeguridadAsignacion(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.detalle = {
            asignacion: res.asignacion,
            puntos: (res?.puntos || []).map((p: any) => this.mapearPunto(p)),
            documentos_generales: res?.documentos_generales || []
          };
          if (requisitoId) {
            this.puntoActivo = this.detalle.puntos.find((p) => p.id === requisitoId) || null;
            if (!this.puntoActivo) {
              this.error = 'No se encontró el punto de la normativa.';
              this.lecturaHtml = null;
            } else {
              this.prepararLecturaPunto(this.puntoActivo);
            }
          } else {
            this.puntoActivo = null;
            this.lecturaHtml = null;
          }
          this.cargandoDetalle = false;
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la normativa asignada.';
          this.detalle = null;
          this.puntoActivo = null;
          this.cargandoDetalle = false;
        }
      });
  }

  private mapearPunto(p: any): PuntoGestion {
    const accionesRaw = p?.acciones || {};
    const prev = accionesRaw.preventiva || {};
    const corr = accionesRaw.correctiva || {};
    return {
      id: Number(p.id),
      numero_item: p.numero_item != null && p.numero_item !== '' ? Number(p.numero_item) : null,
      punto_norma: String(p.punto_norma || '').trim(),
      descripcion: String(p.descripcion || '').trim(),
      descripcion_html: p.descripcion_html || null,
      aplica: p.aplica == null ? null : !!p.aplica,
      tipo_evidencia: p.tipo_evidencia || null,
      periodicidad: p.periodicidad || null,
      acciones: {
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
      },
      fecha_inicio: p.fecha_inicio || null,
      fecha_terminacion: p.fecha_terminacion || null,
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
    this.panelModo = 'general';
    this.normativaFoco = null;
    this.detalle = null;
    this.cargandoDetalle = false;
  }

  seleccionarNormativaFoco(item: AsignacionResumen): void {
    this.panelModo = 'normativa';
    this.normativaFoco = item;
    if (this.detalle?.asignacion?.id === item.id) return;
    this.cargarDetalle(item.id);
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

  prepararLecturaPunto(punto: PuntoGestion): void {
    const { html, sobrantes } = construirHtmlPuntoLectura(punto, (r) => this.urlArchivo(r));
    this.lecturaHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    this.imagenesSobrantes = sobrantes;
    this.imagenAbierta = null;
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
    this.preview.abrir({
      nombre: this.nombreFormatoVisible(punto),
      archivo_nombre: this.nombreFormatoVisible(punto),
      etiqueta: 'FORMATO',
      tema: 'seguridad',
      urlLocal: url
    });
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

  /** Anillo fino (menos invasivo) con pista suave. */
  anilloStyle(pct: number): { [key: string]: string } {
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = this.colorAnillo(pct);
    return {
      background: `conic-gradient(${color} ${n * 3.6}deg, rgba(226, 232, 240, 0.55) 0deg)`
    };
  }

  etiquetaAplica(aplica: boolean | null | undefined): string {
    if (aplica === true) return 'Aplica';
    if (aplica === false) return 'No aplica';
    return '—';
  }

  /** Indicador de avance del punto (plantilla o derivado del estado/evidencias). */
  avancePunto(punto: PuntoGestion): number {
    if (punto.indicador_avance != null && !Number.isNaN(Number(punto.indicador_avance))) {
      return Math.max(0, Math.min(100, Number(punto.indicador_avance)));
    }
    if (punto.estado === 'cumple') return 100;
    if (punto.estado === 'parcial') return 50;
    const peso = this.pesoAccionSeleccionada(punto);
    return peso != null ? peso : 0;
  }

  pesoAccionSeleccionada(punto: PuntoGestion): number | null {
    const a = punto.acciones;
    if (a?.preventiva?.conservar) return ACCION_PESOS.conservar;
    if (a?.preventiva?.mejorar) return ACCION_PESOS.mejorar;
    if (a?.preventiva?.actualizar) return ACCION_PESOS.actualizar;
    if (a?.correctiva?.complementar) return ACCION_PESOS.complementar;
    if (a?.correctiva?.corregir) return ACCION_PESOS.corregir;
    if (a?.correctiva?.realizar) return ACCION_PESOS.realizar;
    return null;
  }

  etiquetaAccionActiva(punto: PuntoGestion): string {
    const a = punto.acciones;
    if (a?.preventiva?.conservar) return 'Conservar · 100';
    if (a?.preventiva?.mejorar) return 'Mejorar · 80';
    if (a?.preventiva?.actualizar) return 'Actualizar · 60';
    if (a?.correctiva?.complementar) return 'Complementar · 40';
    if (a?.correctiva?.corregir) return 'Corregir · 20';
    if (a?.correctiva?.realizar) return 'Realizar · 0';
    return 'Sin acción';
  }

  tipoAccionGrupo(punto: PuntoGestion): 'preventiva' | 'correctiva' | null {
    const a = punto.acciones;
    if (a?.preventiva?.conservar || a?.preventiva?.mejorar || a?.preventiva?.actualizar) {
      return 'preventiva';
    }
    if (a?.correctiva?.complementar || a?.correctiva?.corregir || a?.correctiva?.realizar) {
      return 'correctiva';
    }
    return null;
  }

  fechaIsoCorta(iso: string | null | undefined): string {
    if (!iso) return '—';
    const raw = String(iso).slice(0, 10);
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
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

  conteoEstadosPuntos(): { cumple: number; parcial: number; no_cumple: number } {
    const pts = this.detalle?.puntos || [];
    return {
      cumple: pts.filter((p) => p.estado === 'cumple').length,
      parcial: pts.filter((p) => p.estado === 'parcial').length,
      no_cumple: pts.filter((p) => p.estado === 'no_cumple').length
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
    if (estado === 'parcial') return 'Parcial';
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

  abrirEmpresa(emp: EmpresaResumen): void {
    this.empresaSeleccionada = emp;
    this.router.navigate(['/seguridad/gestion/empresa', emp.empresa_id]);
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
      this.router.navigate(['/seguridad/gestion/empresa', this.detalle.asignacion.empresa_id], {
        queryParams: this.detalle.asignacion.categoria_id
          ? { categoria: this.detalle.asignacion.categoria_id }
          : {}
      });
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

  archivar(): void {
    if (!this.detalle) return;
    Swal.fire({
      title: 'Retirar de la gestión',
      text: `${this.detalle.asignacion.codigo} dejará de mostrarse para esta empresa.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Retirar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c'
    }).then((r) => {
      if (!r.isConfirmed || !this.detalle) return;
      const empresaId = this.detalle.asignacion.empresa_id;
      this.backend.archivarSeguridadAsignacion(this.detalle.asignacion.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => this.router.navigate(['/seguridad/gestion/empresa', empresaId]),
          error: (err: any) => Swal.fire({
            icon: 'error',
            title: 'No se retiró',
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
