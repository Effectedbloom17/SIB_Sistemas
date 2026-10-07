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

interface PuntoGestion {
  id: number;
  punto_norma: string;
  descripcion: string;
  descripcion_html?: string | null;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  evidencia_requerida?: string | null;
  formato_nombre: string | null;
  formato_archivo: string | null;
  formato_nombre_archivo?: string | null;
  ultima_evidencia: string | null;
  estado: 'cumple' | 'parcial' | 'no_cumple';
  imagenes: ImagenPuntoLite[];
  documentos: DocumentoItem[];
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
  anioEvidencia = new Date().getFullYear();
  readonly aniosEvidencia = [
    new Date().getFullYear() - 1,
    new Date().getFullYear(),
    new Date().getFullYear() + 1
  ];

  empresa: EmpresaResumen | null = null;
  categoriasEmpresa: CategoriaAvance[] = [];
  asignaciones: AsignacionResumen[] = [];
  categoriaFiltro: string | null = null;

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
      if (this.vista === 'empresa') this.aplicarCategoriaQuery();
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

  get puntosFiltrados(): PuntoGestion[] {
    const q = this.busquedaPunto.trim().toLowerCase();
    const lista = this.detalle?.puntos || [];
    if (!q) return lista;
    return lista.filter((p) =>
      p.punto_norma.toLowerCase().includes(q)
      || p.descripcion.toLowerCase().includes(q)
      || (p.tipo_evidencia || '').toLowerCase().includes(q)
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
          this.cargando = false;
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se pudo cargar la gestión de empresas.';
          this.empresas = [];
          this.cargando = false;
        }
      });
  }

  cargarEmpresa(empresaId: number): void {
    this.cargando = true;
    this.error = null;
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
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la empresa.';
          this.empresa = null;
          this.asignaciones = [];
          this.cargando = false;
        }
      });
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
    return {
      id: Number(p.id),
      punto_norma: String(p.punto_norma || '').trim(),
      descripcion: String(p.descripcion || '').trim(),
      descripcion_html: p.descripcion_html || null,
      tipo_evidencia: p.tipo_evidencia || null,
      periodicidad: p.periodicidad || null,
      evidencia_requerida: p.evidencia_requerida || null,
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

  colorAvance(pct: number): string {
    if (pct >= 80) return 'ok';
    if (pct >= 40) return 'mid';
    return 'low';
  }

  colorAnillo(pct: number): string {
    const t = this.colorAvance(pct);
    if (t === 'ok') return '#0d9488';
    if (t === 'mid') return '#ea580c';
    return '#dc2626';
  }

  anilloStyle(pct: number): { [key: string]: string } {
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = this.colorAnillo(pct);
    return {
      background: `conic-gradient(${color} ${n * 3.6}deg, rgba(226, 232, 240, 0.95) 0deg)`
    };
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

  etiquetaEstado(estado: string): string {
    if (estado === 'cumple') return 'Cumple';
    if (estado === 'parcial') return 'Parcial';
    return 'No cumple';
  }

  fechaCorta(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  abrirEmpresa(emp: EmpresaResumen): void {
    this.router.navigate(['/seguridad/gestion/empresa', emp.empresa_id]);
  }

  abrirNormativa(item: AsignacionResumen): void {
    this.router.navigate(['/seguridad/gestion', item.id]);
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
