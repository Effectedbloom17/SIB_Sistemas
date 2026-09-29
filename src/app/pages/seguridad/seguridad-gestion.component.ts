import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

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
}

interface PuntoGestion {
  id: number;
  punto_norma: string;
  descripcion: string;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  cap: string;
  sec: string;
  documentos: DocumentoItem[];
}

interface AsignacionResumen {
  id: number;
  empresa_id: number;
  empresa_nombre: string;
  normativa_id: number;
  codigo: string;
  titulo: string;
  puntos_asignados: number;
  documentos: number;
  puntos_con_evidencia: number;
  responsables: Responsable[];
}

interface DetalleGestion {
  asignacion: AsignacionResumen & {
    publicado_por: string | null;
    publicado_en: string | null;
  };
  puntos: PuntoGestion[];
  documentos_generales: DocumentoItem[];
}

@Component({
  selector: 'app-seguridad-gestion',
  templateUrl: './seguridad-gestion.component.html',
  styleUrls: ['./seguridad.shared.scss', './seguridad-gestion.component.scss']
})
export class SeguridadGestionComponent implements OnInit, OnDestroy {
  cargando = true;
  error: string | null = null;
  asignaciones: AsignacionResumen[] = [];
  empresas: { empresa_id: number; nombre_empresa: string }[] = [];
  empresaFiltro: number | null = null;
  busqueda = '';

  detalle: DetalleGestion | null = null;
  cargandoDetalle = false;
  busquedaPunto = '';
  capituloAbierto: string | null = null;
  seccionesAbiertas = new Set<string>();
  subiendo: string | null = null;

  esDetalle = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((q) => {
      if (this.route.snapshot.paramMap.get('id')) return;
      const empresa = Number(q.get('empresa') || 0);
      this.empresaFiltro = empresa > 0 ? empresa : null;
      this.cargarLista();
    });
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = Number(params.get('id') || 0);
      this.esDetalle = id > 0;
      if (id > 0) this.cargarDetalle(id);
      else this.detalle = null;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get gruposEmpresa(): { empresa_id: number; nombre: string; items: AsignacionResumen[] }[] {
    const q = this.busqueda.trim().toLowerCase();
    const filtradas = this.asignaciones.filter((a) => {
      if (this.empresaFiltro && a.empresa_id !== this.empresaFiltro) return false;
      if (!q) return true;
      return a.codigo.toLowerCase().includes(q)
        || a.titulo.toLowerCase().includes(q)
        || a.empresa_nombre.toLowerCase().includes(q)
        || a.responsables.some((r) => r.nombre.toLowerCase().includes(q));
    });
    const mapa = new Map<number, { empresa_id: number; nombre: string; items: AsignacionResumen[] }>();
    for (const item of filtradas) {
      if (!mapa.has(item.empresa_id)) {
        mapa.set(item.empresa_id, { empresa_id: item.empresa_id, nombre: item.empresa_nombre, items: [] });
      }
      mapa.get(item.empresa_id)!.items.push(item);
    }
    return Array.from(mapa.values());
  }

  avance(item: { puntos_asignados: number; puntos_con_evidencia: number }): number {
    if (!item.puntos_asignados) return 0;
    return Math.round((item.puntos_con_evidencia / item.puntos_asignados) * 100);
  }

  cargarLista(): void {
    this.cargando = true;
    this.error = null;
    this.backend.listarGestionSeguridadAsignacion()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.asignaciones = res?.asignaciones || [];
          const vistas = new Map<number, string>();
          this.asignaciones.forEach((a) => vistas.set(a.empresa_id, a.empresa_nombre));
          this.empresas = Array.from(vistas.entries())
            .map(([empresa_id, nombre_empresa]) => ({ empresa_id, nombre_empresa }))
            .sort((a, b) => a.nombre_empresa.localeCompare(b.nombre_empresa, 'es'));
          this.cargando = false;
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se pudo cargar la gestión.';
          this.cargando = false;
        }
      });
  }

  elegirEmpresa(id: number | null): void {
    this.router.navigate(['/seguridad/gestion'], {
      queryParams: id ? { empresa: id } : {}
    });
  }

  abrir(item: AsignacionResumen): void {
    this.router.navigate(['/seguridad/gestion', item.id]);
  }

  volver(): void {
    this.router.navigate(['/seguridad/gestion'], {
      queryParams: this.empresaFiltro ? { empresa: this.empresaFiltro } : {}
    });
  }

  cargarDetalle(id: number): void {
    this.cargando = false;
    this.cargandoDetalle = true;
    this.error = null;
    this.detalle = null;
    this.capituloAbierto = null;
    this.busquedaPunto = '';
    this.backend.obtenerGestionSeguridadAsignacion(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const puntos = (res?.puntos || []).map((p: any) => this.etiquetar(p));
          this.detalle = {
            asignacion: res.asignacion,
            puntos,
            documentos_generales: res?.documentos_generales || []
          };
          this.cargandoDetalle = false;
        },
        error: (err: any) => {
          this.error = err?.error?.message || 'No se encontró la normativa asignada.';
          this.detalle = null;
          this.cargandoDetalle = false;
        }
      });
  }

  private etiquetar(raw: any): PuntoGestion {
    const punto = String(raw.punto_norma || '').trim();
    const partes = punto.split('.').filter(Boolean);
    return {
      id: Number(raw.id),
      punto_norma: punto,
      descripcion: String(raw.descripcion || '').trim(),
      tipo_evidencia: raw.tipo_evidencia || null,
      periodicidad: raw.periodicidad || null,
      cap: partes[0] || 'General',
      sec: partes.length >= 2 ? `${partes[0]}.${partes[1]}` : (punto || 'General'),
      documentos: raw.documentos || []
    };
  }

  capitulos(): { clave: string; total: number; conEvidencia: number }[] {
    const mapa = new Map<string, { clave: string; total: number; conEvidencia: number }>();
    for (const p of this.detalle?.puntos || []) {
      let cap = mapa.get(p.cap);
      if (!cap) {
        cap = { clave: p.cap, total: 0, conEvidencia: 0 };
        mapa.set(p.cap, cap);
      }
      cap.total += 1;
      if (p.documentos.length) cap.conEvidencia += 1;
    }
    return Array.from(mapa.values()).sort((a, b) => {
      if (a.clave === 'General') return 1;
      if (b.clave === 'General') return -1;
      return a.clave.localeCompare(b.clave, 'es', { numeric: true });
    });
  }

  secciones(): { clave: string; puntos: PuntoGestion[]; abierto: boolean }[] {
    if (!this.capituloAbierto || !this.detalle) return [];
    const mapa = new Map<string, PuntoGestion[]>();
    for (const p of this.detalle.puntos.filter((x) => x.cap === this.capituloAbierto)) {
      if (!mapa.has(p.sec)) mapa.set(p.sec, []);
      mapa.get(p.sec)!.push(p);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
      .map(([clave, puntos]) => ({ clave, puntos, abierto: this.seccionesAbiertas.has(clave) }));
  }

  abrirCapitulo(clave: string): void {
    this.capituloAbierto = clave;
    const primera = this.detalle?.puntos.find((p) => p.cap === clave);
    this.seccionesAbiertas = new Set(primera ? [primera.sec] : []);
  }

  toggleSeccion(clave: string): void {
    if (this.seccionesAbiertas.has(clave)) this.seccionesAbiertas.delete(clave);
    else this.seccionesAbiertas.add(clave);
  }

  resultados(): PuntoGestion[] {
    const q = this.busquedaPunto.trim().toLowerCase();
    if (!this.detalle || q.length < 2) return [];
    return this.detalle.puntos.filter((p) =>
      p.punto_norma.toLowerCase().includes(q) ||
      p.descripcion.toLowerCase().includes(q)
    ).slice(0, 60);
  }

  subir(requisitoId: number | null, event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo || !this.detalle) return;
    const clave = String(requisitoId || 'general');
    this.subiendo = clave;
    this.backend.subirDocumentoSeguridadAsignacion(this.detalle.asignacion.id, archivo, requisitoId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.subiendo = null;
          this.cargarDetalle(this.detalle!.asignacion.id);
        },
        error: (err: any) => {
          this.subiendo = null;
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
          next: () => this.cargarDetalle(this.detalle!.asignacion.id),
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
      text: `${this.detalle.asignacion.codigo} dejará de mostrarse para esta empresa. Los archivos se conservan en el servidor, pero no estarán visibles.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Retirar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c'
    }).then((r) => {
      if (!r.isConfirmed || !this.detalle) return;
      this.backend.archivarSeguridadAsignacion(this.detalle.asignacion.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => this.volver(),
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
}
