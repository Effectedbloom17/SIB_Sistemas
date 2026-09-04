import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';

export interface InventarioItem {
  id: number;
  descripcion: string;
  tipo: string;
  tamano: string;
  material: string;
  cantidad: number;
  notas: string;
  activo: boolean;
  imagenDocumentoId: number | null;
  imagenSignId: number | null;
  imagenOrigen: 'repositorio' | 'catalogo' | null;
  imagenNombreArchivo: string | null;
  imagenMimeType: string | null;
  imagenDriveFileId: string | null;
  imagenWebViewLink: string | null;
  imagenCarpetaRelativa: string;
  creadoPor: string | null;
  actualizadoPor: string | null;
  fechaCreacion: string;
  fechaActualizacion: string;
}

interface InventarioForm {
  descripcion: string;
  tipo: string;
  tamano: string;
  material: string;
  cantidad: number | null;
  notas: string;
}

interface RepoDocItem {
  id: number;
  titulo: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  driveFileId: string;
  carpetaRelativa?: string;
}

interface RepoCarpetaItem {
  ruta: string;
  nombre: string;
  cantidad: number;
}

type ImagenModo = 'ninguna' | 'repositorio' | 'catalogo' | 'subir';

interface CatalogSignItem {
  id: number;
  nombreSenal: string;
  descripcion: string;
  categoria: string;
  clasificacion: string | null;
  nombreArchivo: string;
  mimeType: string;
}

@Component({
  selector: 'app-innovacion-inventario',
  templateUrl: './innovacion-inventario.component.html',
  styleUrls: ['./innovacion-inventario.component.scss']
})
export class InnovacionInventarioComponent implements OnInit, OnDestroy {
  etiquetaRolUsuario = '';
  items: InventarioItem[] = [];
  itemsFiltrados: InventarioItem[] = [];
  busqueda = '';
  filtroMaterial = '';
  verInactivos = false;
  cargandoLista = false;
  errorLista: string | null = null;
  guardando = false;
  importandoExcel = false;
  desactivandoInventario = false;
  /** Modo para elegir filas a desactivar/borrar con «Eliminar inventario». */
  modoSeleccion = false;
  modoSeleccionAccion: 'desactivar' | 'borrar' = 'desactivar';
  idsSeleccionados = new Set<number>();
  mostrarPanelEliminar = false;
  borrandoDefinitivo = false;

  mostrarModal = false;
  editandoId: number | null = null;
  itemEnEdicion: InventarioItem | null = null;
  form: InventarioForm = this.formVacio();

  /** Asociación de imagen en el formulario. */
  imagenModo: ImagenModo = 'ninguna';
  imagenDocumentoId: number | null = null;
  imagenSignId: number | null = null;
  imagenNombreArchivo: string | null = null;
  imagenDriveFileId: string | null = null;
  imagenPreviewUrl: string | null = null;
  archivoPendiente: File | null = null;
  archivoPendientePreview: string | null = null;

  /** Navegador del repositorio (solo imágenes). */
  mostrarRepoPicker = false;
  repoCargando = false;
  repoError: string | null = null;
  repoDocumentos: RepoDocItem[] = [];
  repoCarpetasRegistradas: { ruta: string; nombre: string }[] = [];
  repoCarpetaActual = '';
  repoCarpetasVista: RepoCarpetaItem[] = [];
  repoImagenesVista: RepoDocItem[] = [];
  repoBusqueda = '';
  /** IDs de documentos del picker en descarga (expuesto al template). */
  repoMiniaturas: Record<number, string | null> = {};
  repoCargandoMap: Record<number, boolean> = {};
  private readonly repoMiniaturaUrls = new Map<number, string>();

  /** Selector del catálogo de señalización. */
  mostrarCatalogoPicker = false;
  catalogoCargando = false;
  catalogoError: string | null = null;
  catalogoImportandoId: number | null = null;
  catalogoSigns: CatalogSignItem[] = [];
  catalogoSignsFiltrados: CatalogSignItem[] = [];
  catalogoBusqueda = '';
  catalogoFiltroCategoria: 'all' | 'biznaga' | 'iso' = 'all';
  catalogoMiniaturas: Record<number, string | null> = {};
  private readonly catalogoMiniaturaUrls = new Map<number, string>();
  private readonly catalogoCargandoSet = new Set<number>();

  /** Miniaturas de la tabla de inventario. */
  miniaturasTabla: Record<number, string | null> = {};
  private readonly miniaturaTablaUrls = new Map<number, string>();
  private readonly miniaturasCargando = new Set<number>();

  readonly tamanosSugeridos = ['20cm x 20cm', '20cm x 25cm', '30cm x 30cm', '40cm x 40cm'];
  readonly materialesBase = ['Trovicel', 'Acrílico'];
  readonly tiposClasificacion = [
    'Advertencia',
    'Obligación',
    'Prohibición',
    'Equipo contra incendios',
    'Condición segura',
    'Personalizado'
  ];
  private readonly MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  /** Evita que clics rápidos en +/- se pisen entre sí. */
  private readonly cantidadPendiente = new Map<number, number>();
  private readonly cantidadTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private backend: BackendServices
  ) {}

  ngOnInit(): void {
    this.initEtiquetaRol();
    this.cargarLista();
  }

  ngOnDestroy(): void {
    for (const t of this.cantidadTimers.values()) {
      clearTimeout(t);
    }
    this.cantidadTimers.clear();
    this.limpiarPreviewLocal();
    this.limpiarRepoMiniaturas();
    this.limpiarCatalogoMiniaturas();
    this.limpiarMiniaturasTabla();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get totalPiezas(): number {
    return this.itemsFiltrados.reduce((acc, item) => acc + (Number(item.cantidad) || 0), 0);
  }

  get totalTipos(): number {
    return this.itemsFiltrados.length;
  }

  get totalActivos(): number {
    return this.items.filter((i) => i.activo !== false).length;
  }

  get totalRegistros(): number {
    return this.items.length;
  }

  get esSuperAdmin(): boolean {
    return this.authService.esRoot();
  }

  get cantidadSeleccionada(): number {
    return this.idsSeleccionados.size;
  }

  get todosActivosFiltradosSeleccionados(): boolean {
    const candidatos = this.itemsSeleccionables;
    return candidatos.length > 0 && candidatos.every((i) => this.idsSeleccionados.has(i.id));
  }

  get itemsSeleccionables(): InventarioItem[] {
    if (this.modoSeleccionAccion === 'borrar') {
      return this.itemsFiltrados;
    }
    return this.itemsFiltrados.filter((i) => i.activo !== false);
  }

  get etiquetaModoSeleccion(): string {
    return this.modoSeleccionAccion === 'borrar' ? 'Borrado definitivo' : 'Desactivar';
  }

  get materialesDisponibles(): string[] {
    const set = new Set<string>(this.materialesBase);
    for (const item of this.items) {
      if (item.material) {
        set.add(item.material);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  get resumenPorMaterial(): { material: string; cantidad: number }[] {
    const map = new Map<string, number>();
    for (const item of this.itemsFiltrados) {
      const key = item.material || 'Sin material';
      map.set(key, (map.get(key) || 0) + (Number(item.cantidad) || 0));
    }
    return Array.from(map.entries())
      .map(([material, cantidad]) => ({ material, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.material.localeCompare(b.material, 'es'));
  }

  get tituloModal(): string {
    return this.editandoId ? 'Editar señalización' : 'Registro de inventario';
  }

  get subtituloModal(): string {
    return this.editandoId
      ? 'Actualice datos, cantidad e imagen asociada'
      : 'Nueva señal · Capture datos y asocie una imagen del repositorio o súbala';
  }

  get tituloSeccionModal(): string {
    return this.editandoId ? 'Datos del registro' : 'Datos de la señalización';
  }

  get tieneImagenSeleccionada(): boolean {
    return !!(this.imagenDocumentoId || this.imagenSignId || this.archivoPendiente);
  }

  tieneImagenItem(item: InventarioItem): boolean {
    return !!(item?.imagenDocumentoId || item?.imagenSignId);
  }

  get etiquetaImagenActual(): string {
    if (this.archivoPendiente) {
      return this.archivoPendiente.name;
    }
    return this.imagenNombreArchivo || 'Imagen asociada';
  }

  get previewActivaUrl(): string | null {
    return this.archivoPendientePreview || this.imagenPreviewUrl;
  }

  get migasRepo(): { etiqueta: string; ruta: string }[] {
    const ruta = this.normalizarRuta(this.repoCarpetaActual);
    if (!ruta) {
      return [];
    }
    const partes = ruta.split('/');
    const migas: { etiqueta: string; ruta: string }[] = [];
    let acum = '';
    for (const parte of partes) {
      acum = acum ? `${acum}/${parte}` : parte;
      migas.push({ etiqueta: parte, ruta: acum });
    }
    return migas;
  }

  get etiquetaRepoActual(): string {
    if (!this.repoCarpetaActual) {
      return 'Repositorio';
    }
    return this.repoCarpetaActual.split('/').pop() || this.repoCarpetaActual;
  }

  cargarLista(): void {
    this.cargandoLista = true;
    this.errorLista = null;
    this.backend.listarInnovacionInventario({ incluirInactivos: this.verInactivos })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.limpiarMiniaturasTabla();
          this.items = (Array.isArray(res?.items) ? res.items : []).map((it: InventarioItem) => ({
            ...it,
            activo: it.activo !== false
          }));
          this.aplicarFiltro();
          this.cargandoLista = false;
          this.precargarMiniaturasTabla();
        },
        error: (err) => {
          this.cargandoLista = false;
          this.errorLista = err?.error?.message || err?.message || 'No se pudo cargar el inventario.';
        }
      });
  }

  onToggleVerInactivos(): void {
    this.verInactivos = !this.verInactivos;
    this.cargarLista();
  }

  aplicarFiltro(): void {
    const q = this.busqueda.trim().toLowerCase();
    const mat = this.filtroMaterial.trim().toLowerCase();
    this.itemsFiltrados = this.items.filter((item) => {
      if (mat && (item.material || '').toLowerCase() !== mat) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = [
        item.descripcion,
        item.tipo,
        item.tamano,
        item.material,
        item.notas,
        item.imagenNombreArchivo,
        String(item.cantidad)
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    if (this.modoSeleccion) {
      const visibles = new Set(this.itemsFiltrados.map((i) => i.id));
      this.idsSeleccionados = new Set(
        Array.from(this.idsSeleccionados).filter((id) => visibles.has(id))
      );
    }
  }

  /** Texto de material tal cual (el CSS hace el wrap por palabras). */
  formatoMaterial(material: string): string {
    const t = String(material || '').trim();
    return t || '—';
  }

  /** Texto de tipo tal cual (evita cortar palabras a la mitad). */
  formatoTipo(tipo: string): string {
    const t = String(tipo || '').trim();
    return t || '—';
  }

  estaSeleccionado(id: number): boolean {
    return this.idsSeleccionados.has(id);
  }

  toggleSeleccion(item: InventarioItem, event?: Event): void {
    event?.stopPropagation();
    if (this.modoSeleccionAccion === 'desactivar' && item.activo === false) {
      return;
    }
    const next = new Set(this.idsSeleccionados);
    if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      next.add(item.id);
    }
    this.idsSeleccionados = next;
  }

  toggleSeleccionarTodosFiltrados(event?: Event): void {
    event?.stopPropagation();
    const candidatos = this.itemsSeleccionables;
    if (!candidatos.length) {
      return;
    }
    const next = new Set(this.idsSeleccionados);
    if (this.todosActivosFiltradosSeleccionados) {
      for (const item of candidatos) {
        next.delete(item.id);
      }
    } else {
      for (const item of candidatos) {
        next.add(item.id);
      }
    }
    this.idsSeleccionados = next;
  }

  cancelarModoSeleccion(): void {
    this.modoSeleccion = false;
    this.modoSeleccionAccion = 'desactivar';
    this.idsSeleccionados = new Set();
  }

  cerrarPanelEliminar(): void {
    this.mostrarPanelEliminar = false;
  }

  iniciarModoSeleccion(accion: 'desactivar' | 'borrar'): void {
    this.mostrarPanelEliminar = false;
    this.modoSeleccion = true;
    this.modoSeleccionAccion = accion;
    this.idsSeleccionados = new Set();
    if (accion === 'desactivar' && this.verInactivos) {
      this.verInactivos = false;
      this.cargarLista();
    } else if (accion === 'borrar' && !this.verInactivos) {
      this.verInactivos = true;
      this.cargarLista();
    }
  }

  onFilaClick(item: InventarioItem, event?: Event): void {
    if (this.modoSeleccion) {
      this.toggleSeleccion(item, event);
      return;
    }
    this.abrirEditar(item);
  }

  abrirCrear(): void {
    this.editandoId = null;
    this.itemEnEdicion = null;
    this.form = this.formVacio();
    this.resetImagenForm();
    this.mostrarModal = true;
  }

  abrirEditar(item: InventarioItem): void {
    this.editandoId = item.id;
    this.itemEnEdicion = item;
    this.form = {
      descripcion: item.descripcion || '',
      tipo: item.tipo || '',
      tamano: item.tamano || '',
      material: item.material || '',
      cantidad: item.cantidad,
      notas: item.notas || ''
    };
    this.resetImagenForm();
    if (item.imagenSignId) {
      this.imagenModo = 'catalogo';
      this.imagenSignId = item.imagenSignId;
      this.imagenDocumentoId = null;
      this.imagenNombreArchivo = item.imagenNombreArchivo;
      this.imagenDriveFileId = item.imagenDriveFileId;
      this.cargarPreviewAsociada(item);
    } else if (item.imagenDocumentoId) {
      this.imagenModo = 'repositorio';
      this.imagenDocumentoId = item.imagenDocumentoId;
      this.imagenSignId = null;
      this.imagenNombreArchivo = item.imagenNombreArchivo;
      this.imagenDriveFileId = item.imagenDriveFileId;
      this.cargarPreviewAsociada(item);
    }
    this.mostrarModal = true;
  }

  cerrarModal(): void {
    if (this.guardando) {
      return;
    }
    this.mostrarModal = false;
    this.mostrarRepoPicker = false;
    this.mostrarCatalogoPicker = false;
    this.editandoId = null;
    this.itemEnEdicion = null;
    this.form = this.formVacio();
    this.resetImagenForm();
  }

  seleccionarModoImagen(modo: ImagenModo): void {
    if (this.guardando || this.catalogoImportandoId) {
      return;
    }
    this.imagenModo = modo;
    if (modo === 'repositorio') {
      this.limpiarArchivoPendiente();
      this.mostrarCatalogoPicker = false;
      this.abrirRepoPicker();
    } else if (modo === 'catalogo') {
      this.limpiarArchivoPendiente();
      this.mostrarRepoPicker = false;
      this.abrirCatalogoPicker();
    } else if (modo === 'subir') {
      this.mostrarRepoPicker = false;
      this.mostrarCatalogoPicker = false;
    } else {
      this.mostrarRepoPicker = false;
      this.mostrarCatalogoPicker = false;
      this.quitarImagen();
    }
  }

  abrirRepoPicker(): void {
    this.mostrarRepoPicker = true;
    this.mostrarCatalogoPicker = false;
    this.repoCarpetaActual = '';
    this.repoBusqueda = '';
    this.cargarRepositorio();
  }

  cerrarRepoPicker(): void {
    this.mostrarRepoPicker = false;
  }

  abrirCatalogoPicker(): void {
    this.mostrarCatalogoPicker = true;
    this.mostrarRepoPicker = false;
    this.catalogoBusqueda = '';
    this.catalogoFiltroCategoria = 'all';
    this.cargarCatalogoSigns();
  }

  cerrarCatalogoPicker(): void {
    this.mostrarCatalogoPicker = false;
  }

  cargarCatalogoSigns(): void {
    this.catalogoCargando = true;
    this.catalogoError = null;
    this.backend.listarInnovacionSigns()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const raw = Array.isArray(res?.signs) ? res.signs : [];
          this.catalogoSigns = raw
            .map((s: any) => ({
              id: Number(s.id),
              nombreSenal: String(s.nombreSenal || s.nombre_senal || '').trim(),
              descripcion: String(s.descripcion || '').trim(),
              categoria: String(s.categoria || 'biznaga').toLowerCase(),
              clasificacion: s.clasificacion || null,
              nombreArchivo: String(s.nombreArchivo || s.nombre_archivo || ''),
              mimeType: String(s.mimeType || s.mime_type || '')
            }))
            .filter((s: CatalogSignItem) => Number.isFinite(s.id) && s.id > 0)
            .filter((s: CatalogSignItem) => this.esMimeImagenCatalogo(s.mimeType, s.nombreArchivo));
          this.aplicarFiltroCatalogo();
          this.catalogoCargando = false;
        },
        error: (err) => {
          this.catalogoCargando = false;
          this.catalogoError = err?.error?.message || err?.message || 'No se pudo cargar el catálogo.';
        }
      });
  }

  aplicarFiltroCatalogo(): void {
    const q = this.catalogoBusqueda.trim().toLowerCase();
    const cat = this.catalogoFiltroCategoria;
    this.catalogoSignsFiltrados = this.catalogoSigns.filter((s) => {
      if (cat !== 'all' && s.categoria !== cat) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = [
        s.nombreSenal,
        s.descripcion,
        s.clasificacion,
        s.nombreArchivo,
        s.categoria
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    this.precargarCatalogoMiniaturas(this.catalogoSignsFiltrados.slice(0, 48));
  }

  setFiltroCatalogoCategoria(cat: 'all' | 'biznaga' | 'iso'): void {
    this.catalogoFiltroCategoria = cat;
    this.aplicarFiltroCatalogo();
  }

  async seleccionarImagenCatalogo(sign: CatalogSignItem): Promise<void> {
    if (this.guardando || this.catalogoImportandoId) {
      return;
    }
    this.catalogoImportandoId = sign.id;
    try {
      const blob = await firstValueFrom(this.backend.descargarInnovacionSignArchivo(sign.id));
      if (!blob || !blob.size) {
        throw new Error('El archivo del catálogo está vacío.');
      }
      const mime = blob.type || sign.mimeType || this.mimeDesdeNombre(sign.nombreArchivo);
      if (!this.esMimeImagenCatalogo(mime, sign.nombreArchivo)) {
        throw new Error('Solo se pueden asociar imágenes del catálogo (JPG, PNG, WEBP, GIF o SVG).');
      }

      this.limpiarArchivoPendiente();
      this.imagenModo = 'catalogo';
      this.imagenSignId = sign.id;
      this.imagenDocumentoId = null;
      this.imagenNombreArchivo = sign.nombreArchivo || sign.nombreSenal || 'Señal';
      this.imagenDriveFileId = null;
      this.mostrarCatalogoPicker = false;
      this.imagenPreviewUrl = await this.blobADataUrlSeguro(blob);
    } catch (err: any) {
      Swal.fire(
        'Error',
        err?.error?.message || err?.message || 'No se pudo usar la imagen del catálogo.',
        'error'
      );
    } finally {
      this.catalogoImportandoId = null;
    }
  }

  private esMimeImagenCatalogo(mime: string, nombre: string): boolean {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.startsWith('image/')) {
      return true;
    }
    return /\.(jpe?g|png|webp|gif|svg)$/i.test(n);
  }

  private precargarCatalogoMiniaturas(signs: CatalogSignItem[]): void {
    for (const sign of signs) {
      if (!sign?.id || this.catalogoMiniaturas[sign.id] || this.catalogoCargandoSet.has(sign.id)) {
        continue;
      }
      this.catalogoCargandoSet.add(sign.id);
      this.backend.descargarInnovacionSignArchivo(sign.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (blob) => {
            this.catalogoCargandoSet.delete(sign.id);
            try {
              const url = await this.blobADataUrlSeguro(blob);
              this.catalogoMiniaturas = { ...this.catalogoMiniaturas, [sign.id]: url || null };
            } catch {
              this.catalogoMiniaturas = { ...this.catalogoMiniaturas, [sign.id]: null };
            }
          },
          error: () => {
            this.catalogoCargandoSet.delete(sign.id);
            this.catalogoMiniaturas = { ...this.catalogoMiniaturas, [sign.id]: null };
          }
        });
    }
  }

  private limpiarCatalogoMiniaturas(): void {
    this.catalogoMiniaturaUrls.clear();
    this.catalogoMiniaturas = {};
    this.catalogoCargandoSet.clear();
  }

  trackByCatalogSign(_: number, sign: CatalogSignItem): number {
    return sign.id;
  }

  cargarRepositorio(): void {
    this.repoCargando = true;
    this.repoError = null;
    this.backend.listarSgcDocumentacionExtra()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const docs: RepoDocItem[] = Array.isArray(res?.documentos) ? res.documentos : [];
          this.repoDocumentos = docs;
          this.repoCarpetasRegistradas = Array.isArray(res?.carpetas)
            ? res.carpetas.map((c: any) => ({
                ruta: this.normalizarRuta(c.ruta || c.nombre || ''),
                nombre: c.nombre || String(c.ruta || '').split('/').pop() || ''
              }))
            : [];
          this.aplicarVistaRepo();
          this.repoCargando = false;
        },
        error: (err) => {
          this.repoCargando = false;
          this.repoError = err?.error?.message || err?.message || 'No se pudo cargar el repositorio.';
        }
      });
  }

  aplicarVistaRepo(): void {
    const actual = this.normalizarRuta(this.repoCarpetaActual);
    const q = this.repoBusqueda.trim().toLowerCase();
    const imagenes = this.repoDocumentos.filter((d) => this.esImagenDoc(d));

    if (q) {
      this.repoCarpetasVista = [];
      this.repoImagenesVista = imagenes.filter((d) =>
        (d.nombreArchivo || d.titulo || '').toLowerCase().includes(q)
        || this.normalizarRuta(d.carpetaRelativa).toLowerCase().includes(q)
      );
      this.precargarRepoMiniaturas(this.repoImagenesVista);
      return;
    }

    this.repoCarpetasVista = this.obtenerCarpetasHijasRepo(actual, imagenes);
    this.repoImagenesVista = imagenes.filter(
      (d) => this.normalizarRuta(d.carpetaRelativa) === actual
    );
    this.precargarRepoMiniaturas(this.repoImagenesVista);
  }

  private obtenerCarpetasHijasRepo(rutaPadre: string, imagenes: RepoDocItem[]): RepoCarpetaItem[] {
    const actual = this.normalizarRuta(rutaPadre);
    const mapa = new Map<string, number>();

    for (const doc of imagenes) {
      const ruta = this.normalizarRuta(doc.carpetaRelativa);
      if (!ruta) {
        continue;
      }
      let resto = '';
      if (!actual) {
        resto = ruta;
      } else if (ruta === actual || !ruta.startsWith(actual + '/')) {
        continue;
      } else {
        resto = ruta.slice(actual.length + 1);
      }
      const nombre = resto.split('/')[0];
      if (!nombre) {
        continue;
      }
      mapa.set(nombre, (mapa.get(nombre) || 0) + 1);
    }

    for (const reg of this.repoCarpetasRegistradas) {
      const ruta = this.normalizarRuta(reg.ruta);
      if (!ruta) {
        continue;
      }
      let resto = '';
      if (!actual) {
        resto = ruta;
      } else if (ruta === actual || !ruta.startsWith(actual + '/')) {
        continue;
      } else {
        resto = ruta.slice(actual.length + 1);
      }
      const hijaNombre = resto.split('/')[0];
      if (!hijaNombre) {
        continue;
      }
      if (!mapa.has(hijaNombre)) {
        mapa.set(hijaNombre, 0);
      }
    }

    return Array.from(mapa.entries())
      .map(([nombre, cantidad]) => ({
        nombre,
        ruta: actual ? `${actual}/${nombre}` : nombre,
        cantidad
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  entrarCarpetaRepo(ruta: string): void {
    this.repoCarpetaActual = this.normalizarRuta(ruta);
    this.repoBusqueda = '';
    this.aplicarVistaRepo();
  }

  irARaizRepo(): void {
    this.entrarCarpetaRepo('');
  }

  irAMigaRepo(ruta: string): void {
    this.entrarCarpetaRepo(ruta);
  }

  subirNivelRepo(): void {
    const actual = this.normalizarRuta(this.repoCarpetaActual);
    if (!actual.includes('/')) {
      this.irARaizRepo();
      return;
    }
    this.entrarCarpetaRepo(actual.slice(0, actual.lastIndexOf('/')));
  }

  seleccionarImagenRepo(doc: RepoDocItem): void {
    this.limpiarArchivoPendiente();
    this.imagenModo = 'repositorio';
    this.imagenDocumentoId = doc.id;
    this.imagenSignId = null;
    this.imagenNombreArchivo = doc.nombreArchivo || doc.titulo || 'Imagen';
    this.imagenDriveFileId = doc.driveFileId || null;
    this.mostrarRepoPicker = false;

    const thumb = this.repoMiniaturas[doc.id];
    if (thumb) {
      this.imagenPreviewUrl = thumb;
      return;
    }
    this.cargarPreviewDocumento(doc.id, (url) => {
      this.imagenPreviewUrl = url;
    });
  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] || null;
    if (input) {
      input.value = '';
    }
    if (!file) {
      return;
    }
    if (!this.esArchivoImagen(file)) {
      Swal.fire('Archivo no válido', 'Solo se permiten imágenes JPG, PNG, WEBP, GIF o SVG.', 'warning');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      Swal.fire('Archivo muy grande', 'El tamaño máximo es 12 MB.', 'warning');
      return;
    }

    this.limpiarArchivoPendiente();
    this.imagenDocumentoId = null;
    this.imagenSignId = null;
    this.imagenNombreArchivo = file.name;
    this.imagenDriveFileId = null;
    this.imagenPreviewUrl = null;
    this.imagenModo = 'subir';
    this.mostrarRepoPicker = false;
    this.mostrarCatalogoPicker = false;
    this.archivoPendiente = file;

    const reader = new FileReader();
    reader.onload = () => {
      this.archivoPendientePreview = typeof reader.result === 'string' ? reader.result : null;
    };
    reader.readAsDataURL(file);
  }

  quitarImagen(): void {
    this.limpiarArchivoPendiente();
    if (this.imagenPreviewUrl && this.imagenPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imagenPreviewUrl);
    }
    this.imagenDocumentoId = null;
    this.imagenSignId = null;
    this.imagenNombreArchivo = null;
    this.imagenDriveFileId = null;
    this.imagenPreviewUrl = null;
    this.imagenModo = 'ninguna';
    this.mostrarRepoPicker = false;
    this.mostrarCatalogoPicker = false;
  }

  async guardar(): Promise<void> {
    const descripcion = (this.form.descripcion || '').trim();
    const tamano = (this.form.tamano || '').trim();
    const material = (this.form.material || '').trim();
    const cantidad = Number(this.form.cantidad);

    if (!descripcion) {
      Swal.fire('Descripción requerida', 'Indique el nombre de la señalización.', 'warning');
      return;
    }
    if (!tamano) {
      Swal.fire('Tamaño requerido', 'Indique el tamaño de la señalización.', 'warning');
      return;
    }
    if (!material) {
      Swal.fire('Material requerido', 'Indique el material.', 'warning');
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad < 0 || !Number.isInteger(cantidad)) {
      Swal.fire('Cantidad inválida', 'La cantidad debe ser un entero mayor o igual a cero.', 'warning');
      return;
    }

    this.guardando = true;
    try {
      let imagenDocumentoId: number | null = this.imagenDocumentoId;
      let imagenSignId: number | null = this.imagenSignId;

      if (this.archivoPendiente) {
        const base64 = await this.archivoABase64(this.archivoPendiente);
        const resSubida = await firstValueFrom(
          this.backend.subirImagenInnovacionInventario({
            nombre_archivo: this.archivoPendiente.name,
            mime_type: this.archivoPendiente.type || this.mimeDesdeNombre(this.archivoPendiente.name),
            archivo_base64: base64
          })
        );
        const doc = resSubida?.documento;
        if (!doc?.id) {
          throw new Error('No se recibió el documento de imagen subido.');
        }
        imagenDocumentoId = Number(doc.id);
        imagenSignId = null;
        this.imagenDocumentoId = imagenDocumentoId;
        this.imagenSignId = null;
        this.imagenNombreArchivo = doc.nombreArchivo || this.archivoPendiente.name;
        this.imagenDriveFileId = doc.driveFileId || null;
        this.limpiarArchivoPendiente();
      }

    const payload = {
      descripcion,
      tipo: (this.form.tipo || '').trim() || null,
      tamano,
      material,
      cantidad,
      notas: (this.form.notas || '').trim() || null,
      imagenDocumentoId,
      imagenSignId
    };

      if (this.editandoId) {
        await firstValueFrom(this.backend.actualizarInnovacionInventario(this.editandoId, payload));
        await Swal.fire('Actualizado', 'El registro se actualizó correctamente.', 'success');
      } else {
        await firstValueFrom(this.backend.crearInnovacionInventario(payload));
        await Swal.fire('Registrado', 'Señalización agregada al inventario.', 'success');
      }
      this.guardando = false;
      this.cerrarModal();
      this.cargarLista();
    } catch (err: any) {
      this.guardando = false;
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo guardar.', 'error');
    }
  }

  async ajustarCantidad(item: InventarioItem, delta: number, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const id = item.id;
    const base = this.cantidadPendiente.has(id)
      ? (this.cantidadPendiente.get(id) as number)
      : (Number(item.cantidad) || 0);
    const nueva = Math.max(0, base + delta);
    if (nueva === (Number(item.cantidad) || 0) && !this.cantidadPendiente.has(id)) {
      return;
    }

    // Actualización optimista inmediata (un clic = un cambio visible).
    this.cantidadPendiente.set(id, nueva);
    this.items = this.items.map((it) => (it.id === id ? { ...it, cantidad: nueva } : it));
    this.aplicarFiltro();

    const prevTimer = this.cantidadTimers.get(id);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }
    const timer = setTimeout(() => {
      void this.persistirCantidad(id);
    }, 280);
    this.cantidadTimers.set(id, timer);
  }

  private async persistirCantidad(id: number): Promise<void> {
    this.cantidadTimers.delete(id);
    const cantidad = this.cantidadPendiente.get(id);
    if (cantidad == null) {
      return;
    }
    try {
      const res = await firstValueFrom(
        this.backend.actualizarInnovacionInventario(id, { cantidad })
      );
      const actualizado = res?.item as InventarioItem | undefined;
      // Solo limpia pendiente si no hubo clics nuevos mientras guardaba.
      if (this.cantidadPendiente.get(id) === cantidad) {
        this.cantidadPendiente.delete(id);
      }
      if (actualizado) {
        const pendiente = this.cantidadPendiente.get(id);
        this.items = this.items.map((it) => {
          if (it.id !== id) {
            return it;
          }
          return {
            ...it,
            ...actualizado,
            cantidad: pendiente != null ? pendiente : actualizado.cantidad
          };
        });
        this.aplicarFiltro();
      }
    } catch (err: any) {
      this.cantidadPendiente.delete(id);
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo actualizar la cantidad.', 'error');
      this.cargarLista();
    }
  }

  onClickImportarExcel(): void {
    if (this.importandoExcel) {
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        void this.importarExcel(file);
      }
    };
    input.click();
  }

  private async importarExcel(file: File): Promise<void> {
    if (!/\.(xlsx|xls)$/i.test(file.name || '')) {
      Swal.fire('Archivo no válido', 'Seleccione un Excel (.xlsx).', 'warning');
      return;
    }
    this.importandoExcel = true;
    try {
      const base64 = await this.archivoABase64(file);
      const res = await firstValueFrom(
        this.backend.importarExcelInnovacionInventario({
          nombre_archivo: file.name,
          archivo_base64: base64
        })
      );
      const creados = Number(res?.creados) || 0;
      const omitidos = Number(res?.omitidos) || 0;
      const errores = Array.isArray(res?.errores) ? res.errores : [];
      let html = `<p class="mb-2">Filas registradas: <strong>${creados}</strong>`;
      if (omitidos) {
        html += ` · Omitidas: <strong>${omitidos}</strong>`;
      }
      html += `</p>
        <p class="text-muted mb-2" style="font-size:0.85rem">
          Cada fila del Excel se inserta tal cual (incluidas las que solo difieren en observaciones).
        </p>`;
      if (errores.length) {
        const detalle = errores
          .slice(0, 8)
          .map((e: any) => `Fila ${e.fila}: ${this.escaparHtml(e.error || '')}`)
          .join('<br>');
        html += `<p class="text-muted mb-0" style="font-size:0.85rem">${detalle}</p>`;
      }
      await Swal.fire({
        icon: errores.length ? 'warning' : 'success',
        title: 'Importación completada',
        html
      });
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo importar el Excel.', 'error');
    } finally {
      this.importandoExcel = false;
    }
  }

  async eliminarDesdeModal(): Promise<void> {
    if (!this.itemEnEdicion) {
      return;
    }
    const item = this.itemEnEdicion;
    await this.eliminar(item);
  }

  async eliminar(item: InventarioItem): Promise<void> {
    const confirmacion = await Swal.fire({
      title: '¿Desactivar del inventario?',
      html: `<p class="mb-1"><strong>${this.escaparHtml(item.descripcion)}</strong></p>
             <p class="text-muted mb-0">${this.escaparHtml(item.tamano)} · ${this.escaparHtml(item.material)}</p>
             <p class="text-muted mt-2 mb-0" style="font-size:0.85rem">El registro no se borra: queda desactivado y puedes reactivarlo después.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#71717a'
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    try {
      await firstValueFrom(this.backend.eliminarInnovacionInventario(item.id));
      this.cerrarModal();
      await Swal.fire('Desactivado', 'El registro quedó fuera del inventario activo.', 'success');
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo desactivar.', 'error');
    }
  }

  async reactivar(item: InventarioItem, event?: Event): Promise<void> {
    event?.stopPropagation();
    try {
      await firstValueFrom(this.backend.reactivarInnovacionInventario(item.id));
      await Swal.fire('Reactivado', 'El registro volvió al inventario activo.', 'success');
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo reactivar.', 'error');
    }
  }

  async onClickEliminarInventario(): Promise<void> {
    if (this.desactivandoInventario || this.borrandoDefinitivo) {
      return;
    }
    if (this.modoSeleccion) {
      this.cancelarModoSeleccion();
      return;
    }
    if (this.totalRegistros <= 0 && this.totalActivos <= 0) {
      Swal.fire('Inventario vacío', 'No hay registros para gestionar.', 'info');
      return;
    }
    this.mostrarPanelEliminar = true;
  }

  async confirmarDesactivarSeleccion(): Promise<void> {
    if (this.desactivandoInventario) {
      return;
    }
    const ids = Array.from(this.idsSeleccionados);
    if (!ids.length) {
      Swal.fire('Sin selección', 'Marca al menos un registro activo.', 'info');
      return;
    }
    const confirmacion = await Swal.fire({
      title: '¿Desactivar selección?',
      html: `<p class="mb-2">Se desactivarán <strong>${ids.length}</strong> registro(s).</p>
             <p class="text-muted mb-0" style="font-size:0.85rem">
               Quedan fuera del inventario activo; puedes reactivarlos después.
             </p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Desactivar selección',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#71717a'
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    this.desactivandoInventario = true;
    try {
      const res = await firstValueFrom(this.backend.desactivarSeleccionInnovacionInventario(ids));
      this.cancelarModoSeleccion();
      await Swal.fire(
        'Registros desactivados',
        `Se desactivaron ${res?.desactivados ?? ids.length} registro(s).`,
        'success'
      );
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo desactivar la selección.', 'error');
    } finally {
      this.desactivandoInventario = false;
    }
  }

  async desactivarTodosDesdePanel(): Promise<void> {
    this.mostrarPanelEliminar = false;
    const activos = this.totalActivos;
    if (activos <= 0) {
      Swal.fire('Sin registros activos', 'No hay registros activos para desactivar.', 'info');
      return;
    }
    await this.confirmarDesactivarTodos(activos);
  }

  async desactivarTodosDesdeSeleccion(): Promise<void> {
    if (this.desactivandoInventario) {
      return;
    }
    const activos = this.totalActivos;
    if (activos <= 0) {
      Swal.fire('Sin registros activos', 'No hay registros activos para desactivar.', 'info');
      return;
    }
    await this.confirmarDesactivarTodos(activos);
  }

  private async confirmarDesactivarTodos(activos: number): Promise<void> {
    const confirmacion = await Swal.fire({
      title: '¿Desactivar todo el inventario?',
      html: `<p class="mb-2">Se <strong>desactivarán ${activos} registro(s)</strong> activos.</p>
             <p class="text-muted mb-0" style="font-size:0.85rem">
               No se borran de la base de datos. Puedes volver a verlos con «Ver desactivados».
             </p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Desactivar todo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#71717a'
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    this.desactivandoInventario = true;
    try {
      const res = await firstValueFrom(this.backend.desactivarTodoInnovacionInventario());
      this.cancelarModoSeleccion();
      await Swal.fire(
        'Inventario desactivado',
        `Se desactivaron ${res?.desactivados ?? activos} registro(s).`,
        'success'
      );
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo desactivar el inventario.', 'error');
    } finally {
      this.desactivandoInventario = false;
    }
  }

  async confirmarBorrarSeleccion(): Promise<void> {
    if (!this.esSuperAdmin || this.borrandoDefinitivo) {
      return;
    }
    const ids = Array.from(this.idsSeleccionados);
    if (!ids.length) {
      Swal.fire('Sin selección', 'Marca al menos un registro.', 'info');
      return;
    }
    const confirmacion = await Swal.fire({
      title: '¿Borrar definitivamente?',
      html: `<p class="mb-2">Se <strong>eliminarán de la base de datos</strong> ${ids.length} registro(s).</p>
             <p class="text-danger mb-0" style="font-size:0.85rem">
               Esta acción no se puede deshacer.
             </p>`,
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: 'Borrar definitivamente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#7f1d1d',
      cancelButtonColor: '#71717a',
      input: 'text',
      inputPlaceholder: 'Escribe BORRAR para confirmar',
      inputValidator: (value) => {
        if (String(value || '').trim().toUpperCase() !== 'BORRAR') {
          return 'Escribe BORRAR para continuar';
        }
        return null;
      }
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    this.borrandoDefinitivo = true;
    try {
      const res = await firstValueFrom(this.backend.borrarDefinitivoSeleccionInnovacionInventario(ids));
      this.cancelarModoSeleccion();
      await Swal.fire(
        'Eliminado',
        `Se borraron ${res?.eliminados ?? ids.length} registro(s) de la base de datos.`,
        'success'
      );
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo borrar la selección.', 'error');
    } finally {
      this.borrandoDefinitivo = false;
    }
  }

  async borrarTodosDefinitivoDesdePanel(): Promise<void> {
    if (!this.esSuperAdmin || this.borrandoDefinitivo) {
      return;
    }
    this.mostrarPanelEliminar = false;
    const confirmacion = await Swal.fire({
      title: '¿Borrar TODO el inventario?',
      html: `<p class="mb-2">Se eliminarán <strong>todos</strong> los registros de la base de datos (activos y desactivados).</p>
             <p class="text-danger mb-0" style="font-size:0.85rem">Esta acción no se puede deshacer.</p>`,
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: 'Borrar todo definitivamente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#7f1d1d',
      cancelButtonColor: '#71717a',
      input: 'text',
      inputPlaceholder: 'Escribe BORRAR TODO para confirmar',
      inputValidator: (value) => {
        if (String(value || '').trim().toUpperCase() !== 'BORRAR TODO') {
          return 'Escribe BORRAR TODO para continuar';
        }
        return null;
      }
    });
    if (!confirmacion.isConfirmed) {
      return;
    }
    this.borrandoDefinitivo = true;
    try {
      const res = await firstValueFrom(this.backend.borrarDefinitivoTodoInnovacionInventario());
      this.cancelarModoSeleccion();
      await Swal.fire(
        'Inventario eliminado',
        `Se borraron ${res?.eliminados ?? 0} registro(s) de la base de datos.`,
        'success'
      );
      this.cargarLista();
    } catch (err: any) {
      Swal.fire('Error', err?.error?.message || err?.message || 'No se pudo borrar el inventario.', 'error');
    } finally {
      this.borrandoDefinitivo = false;
    }
  }

  urlMiniaturaTabla(item: InventarioItem): string | null {
    if (!item?.id) {
      return null;
    }
    return this.miniaturasTabla[item.id] ?? null;
  }

  onErrorMiniaturaTabla(itemId: number): void {
    if (!itemId) {
      return;
    }
    const prev = this.miniaturaTablaUrls.get(itemId);
    if (prev) {
      URL.revokeObjectURL(prev);
      this.miniaturaTablaUrls.delete(itemId);
    }
    this.miniaturasTabla = { ...this.miniaturasTabla, [itemId]: null };
  }

  trackById(_index: number, item: InventarioItem): number {
    return item.id;
  }

  trackByRepoDoc(_index: number, doc: RepoDocItem): number {
    return doc.id;
  }

  trackByRepoCarpeta(_index: number, carpeta: RepoCarpetaItem): string {
    return carpeta.ruta;
  }

  private formVacio(): InventarioForm {
    return {
      descripcion: '',
      tipo: '',
      tamano: '20cm x 25cm',
      material: 'Trovicel',
      cantidad: 1,
      notas: ''
    };
  }

  get etiquetaOrigenImagen(): string {
    if (this.archivoPendiente) {
      return 'Se subirá a la raíz del repositorio al guardar';
    }
    if (this.imagenSignId) {
      return `Catálogo de señalización · ID señal ${this.imagenSignId}`;
    }
    if (this.imagenDocumentoId) {
      return `Vinculada al repositorio · ID ${this.imagenDocumentoId}`;
    }
    return '';
  }

  private resetImagenForm(): void {
    if (this.imagenPreviewUrl && this.imagenPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imagenPreviewUrl);
    }
    this.limpiarArchivoPendiente();
    this.imagenModo = 'ninguna';
    this.imagenDocumentoId = null;
    this.imagenSignId = null;
    this.imagenNombreArchivo = null;
    this.imagenDriveFileId = null;
    this.imagenPreviewUrl = null;
    this.mostrarRepoPicker = false;
    this.mostrarCatalogoPicker = false;
    this.catalogoImportandoId = null;
    this.repoError = null;
    this.catalogoError = null;
  }

  private limpiarArchivoPendiente(): void {
    this.archivoPendiente = null;
    this.archivoPendientePreview = null;
  }

  private limpiarPreviewLocal(): void {
    this.limpiarArchivoPendiente();
    if (this.imagenPreviewUrl && this.imagenPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imagenPreviewUrl);
    }
    this.imagenPreviewUrl = null;
  }

  private cargarPreviewAsociada(item: InventarioItem): void {
    if (!this.tieneImagenItem(item)) {
      return;
    }
    this.backend.miniaturaInnovacionInventario(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const dataUrl = String(res?.dataUrl || '');
          if (dataUrl.startsWith('data:image')) {
            this.imagenPreviewUrl = dataUrl;
          }
        },
        error: () => { /* sin preview */ }
      });
  }

  private cargarPreviewDocumento(docId: number, onOk: (url: string) => void): void {
    this.backend.miniaturaDocumentoInnovacionInventario(docId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const dataUrl = String(res?.dataUrl || '');
          if (dataUrl.startsWith('data:image')) {
            onOk(dataUrl);
          }
        },
        error: () => {
          // Fallback: descarga completa → data URL
          this.backend.descargarDocumentoImagenInnovacionInventario(docId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: async (blob) => {
                try {
                  const url = await this.blobADataUrlSeguro(blob);
                  if (url) {
                    onOk(url);
                  }
                } catch {
                  /* ignore */
                }
              },
              error: () => { /* sin preview */ }
            });
        }
      });
  }

  private precargarMiniaturasTabla(): void {
    for (const item of this.items) {
      if (!this.tieneImagenItem(item)) {
        continue;
      }
      const itemId = item.id;
      if (this.miniaturasTabla[itemId] || this.miniaturasCargando.has(itemId)) {
        continue;
      }
      this.miniaturasCargando.add(itemId);
      this.backend.miniaturaInnovacionInventario(itemId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.miniaturasCargando.delete(itemId);
            const dataUrl = String(res?.dataUrl || '');
            if (!dataUrl.startsWith('data:image')) {
              this.miniaturasTabla = { ...this.miniaturasTabla, [itemId]: null };
              return;
            }
            this.miniaturasTabla = { ...this.miniaturasTabla, [itemId]: dataUrl };
          },
          error: () => {
            // Fallback blob → data URL
            this.backend.descargarImagenInnovacionInventario(itemId)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: async (blob) => {
                  this.miniaturasCargando.delete(itemId);
                  try {
                    const url = await this.blobADataUrlSeguro(blob);
                    this.miniaturasTabla = {
                      ...this.miniaturasTabla,
                      [itemId]: url || null
                    };
                  } catch {
                    this.miniaturasTabla = { ...this.miniaturasTabla, [itemId]: null };
                  }
                },
                error: () => {
                  this.miniaturasCargando.delete(itemId);
                  this.miniaturasTabla = { ...this.miniaturasTabla, [itemId]: null };
                }
              });
          }
        });
    }
  }

  private precargarRepoMiniaturas(docs: RepoDocItem[]): void {
    for (const doc of docs) {
      if (this.repoMiniaturas[doc.id] || this.repoCargandoMap[doc.id]) {
        continue;
      }
      this.repoCargandoMap = { ...this.repoCargandoMap, [doc.id]: true };
      this.backend.miniaturaDocumentoInnovacionInventario(doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            const cargando = { ...this.repoCargandoMap };
            delete cargando[doc.id];
            this.repoCargandoMap = cargando;
            const dataUrl = String(res?.dataUrl || '');
            this.repoMiniaturas = {
              ...this.repoMiniaturas,
              [doc.id]: dataUrl.startsWith('data:image') ? dataUrl : null
            };
          },
          error: () => {
            this.backend.descargarDocumentoImagenInnovacionInventario(doc.id)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: async (blob) => {
                  const cargando = { ...this.repoCargandoMap };
                  delete cargando[doc.id];
                  this.repoCargandoMap = cargando;
                  try {
                    const url = await this.blobADataUrlSeguro(blob);
                    this.repoMiniaturas = { ...this.repoMiniaturas, [doc.id]: url || null };
                  } catch {
                    this.repoMiniaturas = { ...this.repoMiniaturas, [doc.id]: null };
                  }
                },
                error: () => {
                  const cargando = { ...this.repoCargandoMap };
                  delete cargando[doc.id];
                  this.repoCargandoMap = cargando;
                  this.repoMiniaturas = { ...this.repoMiniaturas, [doc.id]: null };
                }
              });
          }
        });
    }
  }

  private async blobADataUrlSeguro(blob: Blob | null): Promise<string | null> {
    if (!blob || blob.size === 0) {
      return null;
    }
    if (blob.type && /json|text|html/i.test(blob.type)) {
      return null;
    }
    // Detecta JSON de error disfrazado de blob.
    if (blob.size < 2048) {
      try {
        const texto = await blob.slice(0, 64).text();
        if (/^\s*[\{\[]/.test(texto)) {
          return null;
        }
      } catch {
        /* continue */
      }
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.startsWith('data:') ? result : null);
      };
      reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      reader.readAsDataURL(blob);
    });
  }

  private limpiarRepoMiniaturas(): void {
    this.repoMiniaturaUrls.clear();
    this.repoMiniaturas = {};
    this.repoCargandoMap = {};
  }

  private limpiarMiniaturasTabla(): void {
    this.miniaturaTablaUrls.clear();
    this.miniaturasTabla = {};
    this.miniaturasCargando.clear();
  }

  private esImagenDoc(doc: RepoDocItem): boolean {
    const m = (doc.mimeType || '').toLowerCase();
    const n = (doc.nombreArchivo || '').toLowerCase();
    if (m.startsWith('image/')) {
      return true;
    }
    return /\.(jpe?g|png|webp|gif|svg)$/i.test(n);
  }

  private esArchivoImagen(file: File): boolean {
    if (file.type && this.MIME_IMAGEN.includes(file.type.toLowerCase())) {
      return true;
    }
    return /\.(jpe?g|png|webp|gif|svg)$/i.test(file.name || '');
  }

  private mimeDesdeNombre(nombre: string): string {
    const n = (nombre || '').toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.gif')) return 'image/gif';
    if (n.endsWith('.svg')) return 'image/svg+xml';
    return 'image/jpeg';
  }

  private archivoABase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        if (!base64) {
          reject(new Error('No se pudo leer el archivo.'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  private normalizarRuta(ruta: string | null | undefined): string {
    return String(ruta || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s && s !== '.' && s !== '..')
      .join('/');
  }

  private initEtiquetaRol(): void {
    const roles = this.authService.getRoles();
    const principal = (this.authService.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      this.etiquetaRolUsuario = principal === 'root' ? 'Super administrador' : 'Administrador';
    } else if (roles.some(r => r === 'innovacion')) {
      this.etiquetaRolUsuario = 'Diseño e Innovación';
    } else {
      this.etiquetaRolUsuario = 'Usuario';
    }
  }

  private escaparHtml(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
