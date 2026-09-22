import { Component, ElementRef, OnDestroy, OnInit, Renderer2, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

export interface DirectorioPc {
  id: number;
  nombre: string;
  driveFileId: string;
  webViewLink?: string | null;
  editorUrl?: string | null;
  mimeType?: string;
  totalContactos?: number;
  createdAt?: string;
  updatedAt?: string;
  contactos?: Array<{
    id: number;
    dependencia: string;
    telefono: string;
    direccion: string;
    orden: number;
  }>;
}

@Component({
  selector: 'app-proteccion-civil-directorios',
  templateUrl: './proteccion-civil-directorios.component.html',
  styleUrls: ['./proteccion-civil-directorios.component.scss']
})
export class ProteccionCivilDirectoriosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private editorMontadoEnBody = false;

  @ViewChild('editorPortal') editorPortal?: ElementRef<HTMLElement>;

  directorios: DirectorioPc[] = [];
  directoriosFiltrados: DirectorioPc[] = [];
  textoBusqueda = '';
  cargando = true;
  registrando = false;

  editorIntegradoVisible = false;
  editorIntegradoUrl: SafeResourceUrl | null = null;
  editorIntegradoUrlRaw = '';
  editorIntegradoTitulo = 'Editor integrado (Google Docs)';
  editorIntegradoSubtitulo = '';
  cargandoEditor = false;
  directorioEditorActual: DirectorioPc | null = null;

  constructor(
    private backendService: BackendServices,
    private sanitizer: DomSanitizer,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    this.cargarDirectorios();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.liberarScrollPaginaEditor();
  }

  cargarDirectorios(): void {
    this.cargando = true;
    this.backendService.listarDirectoriosPC()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.directorios = Array.isArray(res?.directorios) ? res.directorios : [];
          this.aplicarFiltro();
          this.cargando = false;
        },
        error: () => {
          this.directorios = [];
          this.directoriosFiltrados = [];
          this.cargando = false;
          Swal.fire('Error', 'No se pudieron cargar los directorios.', 'error');
        }
      });
  }

  aplicarFiltro(): void {
    const q = this.textoBusqueda.trim().toLowerCase();
    if (!q) {
      this.directoriosFiltrados = [...this.directorios];
      return;
    }
    this.directoriosFiltrados = this.directorios.filter((d) =>
      String(d.nombre || '').toLowerCase().includes(q)
    );
  }

  limpiarBusqueda(): void {
    this.textoBusqueda = '';
    this.aplicarFiltro();
  }

  async abrirRegistroNuevo(): Promise<void> {
    if (this.registrando) return;

    const result = await Swal.fire({
      title: 'Registrar nuevo directorio',
      html: `
        <p class="text-left mb-2" style="font-size:0.85rem;color:#6c757d;">
          Se duplicará la plantilla y se reemplazará <code>{{tipo_directorio}}</code>
          con el nombre (solo mayúsculas).
        </p>
        <input id="pc-dir-nombre" class="swal2-input" placeholder="EJ. MUNICIPIO DE PACHUCA"
               style="text-transform:uppercase;" autocomplete="off">
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear directorio',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97248',
      focusConfirm: false,
      didOpen: () => {
        const input = document.getElementById('pc-dir-nombre') as HTMLInputElement | null;
        if (!input) return;
        input.addEventListener('input', () => {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = String(input.value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
          if (start != null && end != null) {
            input.setSelectionRange(start, end);
          }
        });
        input.focus();
      },
      preConfirm: () => {
        const input = document.getElementById('pc-dir-nombre') as HTMLInputElement | null;
        const nombre = String(input?.value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (!nombre || nombre.length < 3) {
          Swal.showValidationMessage('Escribe un nombre en mayúsculas (mínimo 3 caracteres).');
          return false;
        }
        return nombre;
      }
    });

    if (!result.isConfirmed || !result.value) return;

    this.registrando = true;
    Swal.fire({
      title: 'Creando directorio…',
      html: 'Duplicando plantilla en Drive y registrando en base de datos.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendService.crearDirectorioPC(String(result.value))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.registrando = false;
          if (!res?.success || !res?.directorio) {
            Swal.fire('Error', res?.message || 'No se pudo crear el directorio.', 'error');
            return;
          }
          Swal.fire({
            icon: 'success',
            title: 'Directorio creado',
            text: res.message || 'Listo. Ya puedes editarlo en el editor integrado.',
            confirmButtonColor: '#d97248'
          }).then(() => {
            this.cargarDirectorios();
            this.abrirEditorIntegrado(res.directorio as DirectorioPc);
          });
        },
        error: (err: any) => {
          this.registrando = false;
          Swal.fire('Error', err?.error?.message || 'No se pudo crear el directorio.', 'error');
        }
      });
  }

  abrirEditorIntegrado(dir: DirectorioPc): void {
    if (!dir?.id && !dir?.driveFileId) {
      Swal.fire('Sin archivo', 'Este directorio no tiene archivo en Drive.', 'info');
      return;
    }

    this.directorioEditorActual = dir;
    this.editorIntegradoTitulo = 'Editor integrado (Google Docs)';
    this.editorIntegradoSubtitulo = dir.nombre;
    this.cargandoEditor = true;
    this.editorIntegradoVisible = true;
    this.editorIntegradoUrl = null;
    this.editorIntegradoUrlRaw = '';
    this.editorMontadoEnBody = false;
    this.bloquearScrollPaginaEditor();
    setTimeout(() => this.montarEditorEnBody(), 0);

    if (dir.id) {
      this.backendService.obtenerUrlEditorDirectorioPC(dir.id, 'edit')
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response: any) => {
            if (!response?.success || !response.url) {
              this.cargandoEditor = false;
              this.cerrarEditorIntegrado(false);
              Swal.fire('Sin vista', response?.message || 'No se pudo abrir el editor.', 'info');
              return;
            }
            if (response.titulo) {
              this.editorIntegradoSubtitulo = response.titulo;
            }
            this.editorIntegradoUrlRaw = response.url;
            this.editorIntegradoUrl = null;
            setTimeout(() => {
              this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(response.url);
              this.montarEditorEnBody();
            }, 0);
          },
          error: (err: any) => {
            this.cargandoEditor = false;
            this.cerrarEditorIntegrado(false);
            Swal.fire('Error', err?.error?.message || 'No se pudo abrir el editor.', 'error');
          }
        });
      return;
    }

    const url = `https://docs.google.com/document/d/${dir.driveFileId}/edit?usp=sharing`;
    this.editorIntegradoUrlRaw = url;
    this.editorIntegradoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  onEditorIframeLoad(): void {
    this.cargandoEditor = false;
  }

  cerrarEditorIntegrado(sincronizar = true): void {
    const actual = this.directorioEditorActual;
    this.editorIntegradoVisible = false;
    this.editorIntegradoUrl = null;
    this.editorIntegradoUrlRaw = '';
    this.editorIntegradoSubtitulo = '';
    this.directorioEditorActual = null;
    this.cargandoEditor = false;
    this.editorMontadoEnBody = false;
    this.liberarScrollPaginaEditor();

    if (sincronizar && actual?.id) {
      this.backendService.sincronizarDirectorioPC(actual.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => this.cargarDirectorios(),
          error: () => this.cargarDirectorios()
        });
    }
  }

  sincronizarManual(dir: DirectorioPc, event?: Event): void {
    event?.stopPropagation();
    if (!dir?.id) return;

    Swal.fire({
      title: 'Sincronizando…',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendService.sincronizarDirectorioPC(dir.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          Swal.fire('Listo', res?.message || 'Contactos sincronizados.', 'success');
          this.cargarDirectorios();
        },
        error: (err: any) => {
          Swal.fire('Error', err?.error?.message || 'No se pudo sincronizar.', 'error');
        }
      });
  }

  eliminarDirectorio(dir: DirectorioPc, event?: Event): void {
    event?.stopPropagation();
    if (!dir?.id) return;

    Swal.fire({
      title: '¿Eliminar directorio?',
      html: `Se quitará <strong>${dir.nombre}</strong> del sistema.<br>
             <small class="text-muted">El archivo en Drive se conserva.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#aaa',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.backendService.eliminarDirectorioPC(dir.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            Swal.fire('Eliminado', 'El directorio se eliminó del sistema.', 'success');
            this.cargarDirectorios();
          },
          error: (err: any) => {
            Swal.fire('Error', err?.error?.message || 'No se pudo eliminar.', 'error');
          }
        });
    });
  }

  abrirEnDrive(dir: DirectorioPc, event?: Event): void {
    event?.stopPropagation();
    const url = dir.webViewLink || dir.editorUrl ||
      (dir.driveFileId ? `https://docs.google.com/document/d/${dir.driveFileId}/edit` : '');
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  trackByDirectorio(_: number, item: DirectorioPc): number {
    return item.id;
  }

  private bloquearScrollPaginaEditor(): void {
    document.body.classList.add('pc-drive-editor-open');
    document.body.style.overflow = 'hidden';
  }

  private liberarScrollPaginaEditor(): void {
    document.body.classList.remove('pc-drive-editor-open');
    document.body.style.overflow = '';
  }

  /** Sacamos el overlay del layout (sidebar/navbar) para que cubra toda la pantalla como SGC. */
  private montarEditorEnBody(): void {
    const el = this.editorPortal?.nativeElement;
    if (!el || this.editorMontadoEnBody || el.parentElement === document.body) {
      return;
    }
    this.renderer.appendChild(document.body, el);
    this.editorMontadoEnBody = true;
  }
}
