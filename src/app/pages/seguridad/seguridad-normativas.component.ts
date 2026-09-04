import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import {
  SEG_NORMATIVAS_CATEGORIAS,
  SegNormativaCategoria,
  SegNormativaResumen
} from './seguridad-normativas.catalog';

@Component({
  selector: 'app-seguridad-normativas',
  templateUrl: './seguridad-normativas.component.html',
  styleUrls: ['./seguridad.shared.scss', './seguridad-normativas.component.scss']
})
export class SeguridadNormativasComponent implements OnInit, OnDestroy {
  readonly categorias = SEG_NORMATIVAS_CATEGORIAS;

  normativas: SegNormativaResumen[] = [];
  normativasFiltradas: SegNormativaResumen[] = [];
  busqueda = '';
  categoriaActiva = '';
  cargando = false;
  importando = false;
  error: string | null = null;
  vistaCompacta = true;

  @ViewChild('inputImportar') inputImportar?: ElementRef<HTMLInputElement>;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private router: Router
  ) {}

  get puedeImportar(): boolean {
    return this.auth.esAdministradorOSuperior();
  }

  get totalNormativas(): number {
    return this.normativas.length;
  }

  get totalRequisitos(): number {
    return this.normativas.reduce((sum, n) => sum + (n.total_requisitos || 0), 0);
  }

  ngOnInit(): void {
    this.cargarCatalogo();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargarCatalogo(): void {
    this.cargando = true;
    this.error = null;
    this.backend.listarSeguridadNormativas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.normativas = res?.normativas || [];
          this.aplicarFiltro();
          this.cargando = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'No se pudo cargar el catálogo.';
          this.cargando = false;
        }
      });
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    this.normativasFiltradas = this.normativas.filter((n) => {
      if (this.categoriaActiva && n.categoria_id !== this.categoriaActiva) return false;
      if (!q) return true;
      return (
        n.codigo.toLowerCase().includes(q) ||
        n.titulo.toLowerCase().includes(q) ||
        String(n.numero || '').includes(q)
      );
    });
  }

  seleccionarCategoria(id: string): void {
    this.categoriaActiva = this.categoriaActiva === id ? '' : id;
    this.aplicarFiltro();
  }

  contarPorCategoria(id: string): number {
    return this.normativas.filter((n) => n.categoria_id === id).length;
  }

  categoriaLabel(id: string): string {
    return this.categorias.find((c) => c.id === id)?.prefijo || id;
  }

  abrirDetalle(normativa: SegNormativaResumen): void {
    this.router.navigate(['/seguridad/normativas', normativa.id]);
  }

  abrirSelectorImportar(): void {
    this.inputImportar?.nativeElement?.click();
  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls'].includes(ext || '')) {
      Swal.fire('Formato no válido', 'Seleccione un archivo Excel (.xlsx o .xls).', 'warning');
      return;
    }

    this.importando = true;
    this.backend.importarSeguridadNormativa(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.importando = false;
          Swal.fire({
            icon: 'success',
            title: 'Importación exitosa',
            text: res?.message || 'Normativa importada.',
            confirmButtonColor: '#b91c1c'
          });
          this.cargarCatalogo();
        },
        error: (err) => {
          this.importando = false;
          Swal.fire({
            icon: 'error',
            title: 'Error al importar',
            text: err?.error?.message || 'No se pudo procesar la plantilla.',
            confirmButtonColor: '#b91c1c'
          });
        }
      });
  }

  trackById(_: number, item: SegNormativaResumen): number {
    return item.id;
  }
}
