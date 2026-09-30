import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import Swal from 'sweetalert2';
import DOMPurify from 'dompurify';
import { environment } from 'src/environments/environment';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { SEG_NORMATIVAS_CATEGORIAS, SegNormativaResumen } from './seguridad-normativas.catalog';

interface SegRequisito {
  id: number;
  numero_item: number | null;
  punto_norma: string | null;
  descripcion: string | null;
  descripcion_html: string | null;
  tipo_evidencia: string | null;
  periodicidad: string | null;
  evidencia_requerida: string | null;
  observaciones: string | null;
  formato_nombre: string | null;
  formato_archivo: string | null;
  formato_nombre_archivo: string | null;
  orden: number;
}

interface EditorPunto {
  id: number;
  punto_norma: string;
  descripcion: string;
  tipo_evidencia: string;
  periodicidad: string;
  evidencia_requerida: string;
  observaciones: string;
  formato_nombre: string;
  formato_archivo: string | null;
  formato_nombre_archivo: string | null;
  archivo: File | null;
  quitarFormato: boolean;
}

interface EditorFicha {
  titulo: string;
  preview: string | null;
  archivo: File | null;
  quitar: boolean;
}

interface SegResumen {
  total: number;
  documentales: number;
  fisicos: number;
  con_periodicidad: number;
}

interface SegHistorial {
  id: number;
  accion: string;
  campo: string | null;
  detalle: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  usuario_nombre: string;
  usuario_perfil: string | null;
  creado_en: string;
  requisito_id: number | null;
}

@Component({
  selector: 'app-seguridad-normativa-detalle',
  templateUrl: './seguridad-normativa-detalle.component.html',
  styleUrls: ['./seguridad.shared.scss', './seguridad-normativa-detalle.component.scss']
})
export class SeguridadNormativaDetalleComponent implements OnInit, OnDestroy {
  normativa: SegNormativaResumen | null = null;
  requisitos: SegRequisito[] = [];
  requisitosFiltrados: SegRequisito[] = [];
  resumen: SegResumen | null = null;
  historial: SegHistorial[] = [];
  busqueda = '';
  cargando = false;
  error: string | null = null;
  requisitoExpandido: number | null = null;
  mostrarHistorial = false;
  editor: EditorPunto | null = null;
  ficha: EditorFicha | null = null;
  guardandoPunto = false;
  guardandoFicha = false;
  readonly tiposBase = ['DOCUMENTAL', 'FISICO', 'DOCUMENTAL Y FISICO'];
  readonly periodicidades = ['ANUAL', 'SEMESTRAL', 'TRIMESTRAL', 'MENSUAL', 'UNICA', 'PERMANENTE'];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backend: BackendServices,
    private auth: AuthService
  ) {}

  get puedeAdministrar(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  get categoriaLabel(): string {
    if (!this.normativa) return '';
    const cat = SEG_NORMATIVAS_CATEGORIAS.find((c) => c.id === this.normativa?.categoria_id);
    return cat ? `NOM ${cat.prefijo}` : this.normativa.categoria_id;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap((params) => {
        const id = parseInt(params.get('id') || '', 10);
        this.cargando = true;
        this.error = null;
        return this.backend.obtenerSeguridadNormativa(id);
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.normativa = res.normativa;
        this.requisitos = res.requisitos || [];
        this.resumen = res.resumen || null;
        this.historial = res.historial || [];
        this.aplicarFiltro();
        this.cargando = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'No se pudo cargar la normativa.';
        this.cargando = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  volver(): void {
    this.router.navigate(['/seguridad/normativas']);
  }

  recargar(): void {
    if (!this.normativa) return;
    this.cargando = true;
    this.backend.obtenerSeguridadNormativa(this.normativa.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.normativa = res.normativa;
          this.requisitos = res.requisitos || [];
          this.resumen = res.resumen || null;
          this.historial = res.historial || [];
          this.aplicarFiltro();
          this.cargando = false;
        },
        error: () => { this.cargando = false; }
      });
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) {
      this.requisitosFiltrados = [...this.requisitos];
      return;
    }
    this.requisitosFiltrados = this.requisitos.filter((r) =>
      (r.punto_norma || '').toLowerCase().includes(q) ||
      (r.descripcion || '').toLowerCase().includes(q) ||
      (r.evidencia_requerida || '').toLowerCase().includes(q) ||
      (r.formato_nombre || '').toLowerCase().includes(q)
    );
  }

  toggleExpandir(id: number): void {
    this.requisitoExpandido = this.requisitoExpandido === id ? null : id;
  }

  textoRequisitoHtml(r: SegRequisito): string {
    if (r.descripcion_html) {
      return DOMPurify.sanitize(r.descripcion_html, {
        ALLOWED_TAGS: ['strong', 'em', 'u', 'b', 'i', 'br', 'p', 'span'],
        ALLOWED_ATTR: []
      });
    }
    const plain = r.descripcion || 'Sin descripción';
    return DOMPurify.sanitize(plain.replace(/\n/g, '<br>'));
  }

  etiquetaAccion(accion: string): string {
    const map: Record<string, string> = {
      importacion: 'Importación',
      reimportacion: 'Reimportación',
      edicion_normativa: 'Ficha',
      edicion_requisito: 'Punto'
    };
    return map[accion] || accion;
  }

  etiquetaCampo(campo: string | null): string {
    const map: Record<string, string> = {
      titulo: 'Título',
      punto_norma: 'Punto',
      descripcion: 'Descripción',
      tipo_evidencia: 'Tipo de evidencia',
      periodicidad: 'Periodicidad',
      evidencia_requerida: 'Evidencia requerida',
      observaciones: 'Observaciones',
      formato_nombre: 'Formato guía',
      formato_archivo: 'Archivo de formato',
      imagen_portada: 'Portada'
    };
    return (campo && map[campo]) || campo || '';
  }

  urlArchivo(ruta: string | null | undefined): string | null {
    if (!ruta) return null;
    if (/^https?:/i.test(ruta)) return ruta;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  }

  tiposDisponibles(actual: string): string[] {
    const extra = actual && !this.tiposBase.includes(actual) ? [actual] : [];
    return [...this.tiposBase, ...extra];
  }

  abrirFicha(): void {
    if (!this.normativa || !this.puedeAdministrar) return;
    this.ficha = {
      titulo: this.normativa.titulo,
      preview: this.urlArchivo(this.normativa.imagen_portada),
      archivo: null,
      quitar: false
    };
  }

  cerrarFicha(): void {
    if (this.guardandoFicha) return;
    this.ficha = null;
  }

  onPortada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.ficha) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      Swal.fire('Imagen no válida', 'Use JPG, PNG o WebP (máximo 6 MB).', 'warning');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      Swal.fire('Imagen muy grande', 'La portada no puede pasar de 6 MB.', 'warning');
      return;
    }
    this.ficha.archivo = file;
    this.ficha.quitar = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (this.ficha) this.ficha.preview = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  }

  quitarPortada(): void {
    if (!this.ficha) return;
    this.ficha.archivo = null;
    this.ficha.preview = null;
    this.ficha.quitar = true;
  }

  guardarFicha(): void {
    if (!this.ficha || !this.normativa || this.guardandoFicha) return;
    const titulo = this.ficha.titulo.trim();
    if (!titulo) return;
    const ficha = this.ficha;
    const normativa = this.normativa;
    this.guardandoFicha = true;

    const seguir = () => {
      if (ficha.archivo) {
        this.backend.subirImagenSeguridadNormativa(normativa.id, ficha.archivo)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => this.cerrarTrasFicha(),
            error: (err) => this.falloFicha(err)
          });
        return;
      }
      if (ficha.quitar && normativa.imagen_portada) {
        this.backend.quitarImagenSeguridadNormativa(normativa.id)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => this.cerrarTrasFicha(),
            error: (err) => this.falloFicha(err)
          });
        return;
      }
      this.cerrarTrasFicha();
    };

    if (titulo === normativa.titulo) {
      seguir();
      return;
    }
    this.backend.actualizarSeguridadNormativa(normativa.id, { titulo })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => seguir(),
        error: (err) => this.falloFicha(err)
      });
  }

  abrirEditor(r: SegRequisito, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeAdministrar) return;
    this.editor = {
      id: r.id,
      punto_norma: r.punto_norma || '',
      descripcion: r.descripcion || '',
      tipo_evidencia: r.tipo_evidencia || '',
      periodicidad: r.periodicidad || '',
      evidencia_requerida: r.evidencia_requerida || '',
      observaciones: r.observaciones || '',
      formato_nombre: r.formato_nombre || '',
      formato_archivo: r.formato_archivo,
      formato_nombre_archivo: r.formato_nombre_archivo,
      archivo: null,
      quitarFormato: false
    };
  }

  cerrarEditor(): void {
    if (this.guardandoPunto) return;
    this.editor = null;
  }

  onFormato(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editor) return;
    if (!/\.(pdf|docx?|xlsx?)$/i.test(file.name)) {
      Swal.fire('Formato no válido', 'Ligue un PDF, Word o Excel.', 'warning');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      Swal.fire('Archivo muy grande', 'La plantilla no puede pasar de 15 MB.', 'warning');
      return;
    }
    this.editor.archivo = file;
    this.editor.quitarFormato = false;
    if (!this.editor.formato_nombre.trim()) {
      this.editor.formato_nombre = file.name.replace(/\.[^.]+$/, '');
    }
  }

  quitarFormatoEditor(): void {
    if (!this.editor) return;
    this.editor.archivo = null;
    this.editor.quitarFormato = true;
  }

  guardarPunto(): void {
    if (!this.editor || !this.normativa || this.guardandoPunto) return;
    const ed = this.editor;
    if (!ed.punto_norma.trim() || !ed.descripcion.trim()) return;
    this.guardandoPunto = true;
    const quitar = ed.quitarFormato && !ed.archivo;
    this.backend.actualizarSeguridadRequisito(this.normativa.id, ed.id, {
      punto_norma: ed.punto_norma.trim(),
      descripcion: ed.descripcion.trim(),
      tipo_evidencia: ed.tipo_evidencia.trim() || null,
      periodicidad: ed.periodicidad.trim() || null,
      evidencia_requerida: ed.evidencia_requerida.trim() || null,
      observaciones: ed.observaciones.trim() || null,
      formato_nombre: quitar ? null : (ed.formato_nombre.trim() || null),
      quitar_formato: quitar
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (!ed.archivo || !this.normativa) {
          this.cerrarTrasPunto();
          return;
        }
        this.backend.subirFormatoSeguridadRequisito(
          this.normativa.id,
          ed.id,
          ed.archivo,
          ed.formato_nombre.trim()
        ).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => this.cerrarTrasPunto(),
          error: (err) => this.falloPunto(err)
        });
      },
      error: (err) => this.falloPunto(err)
    });
  }

  private cerrarTrasFicha(): void {
    this.guardandoFicha = false;
    this.ficha = null;
    this.recargar();
  }

  private falloFicha(err: any): void {
    this.guardandoFicha = false;
    Swal.fire('Error', err?.error?.message || 'No se pudo guardar la ficha.', 'error');
  }

  private cerrarTrasPunto(): void {
    this.guardandoPunto = false;
    this.editor = null;
    this.recargar();
  }

  private falloPunto(err: any): void {
    this.guardandoPunto = false;
    Swal.fire('Error', err?.error?.message || 'No se pudo guardar el punto.', 'error');
  }

  async eliminarNormativa(): Promise<void> {
    if (!this.normativa || !this.puedeAdministrar) return;
    const result = await Swal.fire({
      title: '¿Eliminar normativa?',
      text: `Se eliminará ${this.normativa.codigo} y todos sus requisitos.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

    this.backend.eliminarSeguridadNormativa(this.normativa.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          Swal.fire({ icon: 'success', title: 'Eliminada', timer: 1500, showConfirmButton: false });
          this.volver();
        },
        error: (err) => {
          Swal.fire('Error', err?.error?.message || 'No se pudo eliminar.', 'error');
        }
      });
  }

  trackById(_: number, item: SegRequisito): number {
    return item.id;
  }

  iconoTipo(tipo: string | null): string {
    const t = (tipo || '').toUpperCase();
    if (t.includes('DOCUMENTAL') && t.includes('FISICO')) return 'fa-layer-group';
    if (t.includes('DOCUMENTAL')) return 'fa-file-alt';
    if (t.includes('FISICO') || t.includes('FÍSICO')) return 'fa-hard-hat';
    return 'fa-tag';
  }
}

