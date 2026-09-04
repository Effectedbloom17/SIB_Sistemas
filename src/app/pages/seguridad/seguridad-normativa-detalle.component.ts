import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import Swal from 'sweetalert2';
import DOMPurify from 'dompurify';
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
  responsable: string | null;
  indicador_avance: number | null;
  evidencia_requerida: string | null;
  observaciones: string | null;
  orden: number;
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
  mostrarHistorial = true;

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
      (r.responsable || '').toLowerCase().includes(q)
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
      edicion_normativa: 'Edición normativa',
      edicion_requisito: 'Edición requisito'
    };
    return map[accion] || accion;
  }

  async editarNormativa(): Promise<void> {
    if (!this.normativa || !this.puedeAdministrar) return;
    const result = await Swal.fire({
      title: 'Editar normativa',
      input: 'textarea',
      inputLabel: `Título (${this.normativa.codigo})`,
      inputValue: this.normativa.titulo,
      inputAttributes: { rows: '3' },
      showCancelButton: true,
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v?.trim() ? 'El título es obligatorio' : null)
    });
    if (!result.isConfirmed || !result.value) return;

    this.backend.actualizarSeguridadNormativa(this.normativa.id, { titulo: result.value.trim() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          Swal.fire({ icon: 'success', title: 'Guardado', timer: 1200, showConfirmButton: false });
          this.recargar();
        },
        error: (err) => Swal.fire('Error', err?.error?.message || 'No se pudo guardar.', 'error')
      });
  }

  async editarRequisito(r: SegRequisito, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.normativa || !this.puedeAdministrar) return;

    const html = `
      <div class="seg-swal-form text-left">
        <label class="seg-swal-label">Descripción</label>
        <textarea id="seg-desc" class="swal2-textarea" rows="4">${this.escapeAttr(r.descripcion || '')}</textarea>
        <label class="seg-swal-label">Tipo evidencia</label>
        <input id="seg-tipo" class="swal2-input" value="${this.escapeAttr(r.tipo_evidencia || '')}">
        <label class="seg-swal-label">Periodicidad</label>
        <input id="seg-per" class="swal2-input" value="${this.escapeAttr(r.periodicidad || '')}">
        <label class="seg-swal-label">Responsable</label>
        <input id="seg-resp" class="swal2-input" value="${this.escapeAttr(r.responsable || '')}">
        <label class="seg-swal-label">Observaciones</label>
        <textarea id="seg-obs" class="swal2-textarea" rows="2">${this.escapeAttr(r.observaciones || '')}</textarea>
      </div>`;

    const result = await Swal.fire({
      title: `Editar punto ${r.punto_norma || r.id}`,
      html,
      showCancelButton: true,
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const desc = (document.getElementById('seg-desc') as HTMLTextAreaElement)?.value?.trim();
        if (!desc) {
          Swal.showValidationMessage('La descripción es obligatoria');
          return false;
        }
        return {
          descripcion: desc,
          tipo_evidencia: (document.getElementById('seg-tipo') as HTMLInputElement)?.value?.trim() || null,
          periodicidad: (document.getElementById('seg-per') as HTMLInputElement)?.value?.trim() || null,
          responsable: (document.getElementById('seg-resp') as HTMLInputElement)?.value?.trim() || null,
          observaciones: (document.getElementById('seg-obs') as HTMLTextAreaElement)?.value?.trim() || null
        };
      }
    });

    if (!result.isConfirmed || !result.value) return;

    this.backend.actualizarSeguridadRequisito(this.normativa.id, r.id, result.value)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          Swal.fire({ icon: 'success', title: 'Requisito actualizado', timer: 1200, showConfirmButton: false });
          this.recargar();
        },
        error: (err) => Swal.fire('Error', err?.error?.message || 'No se pudo guardar.', 'error')
      });
  }

  private escapeAttr(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
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
