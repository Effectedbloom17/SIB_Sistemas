import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import Swal from 'sweetalert2';
import DOMPurify from 'dompurify';
import { environment } from 'src/environments/environment';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';
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
  imagenes?: SegImagenRef[];
}

interface SegImagenRef {
  id: number;
  ruta: string;
  nombre: string;
}

interface EditorImagen {
  clave: string;
  id: number | null;
  nombre: string;
  preview: string;
  archivo: File | null;
  quitar: boolean;
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
  descripcion_html: string;
  archivo: File | null;
  quitarFormato: boolean;
  imagenes: EditorImagen[];
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
  previewRef: { src: string; nombre: string; x: number; y: number } | null = null;
  luzRef: { src: string; nombre: string } | null = null;
  private refArrastrada: HTMLElement | null = null;
  readonly tiposBase = ['DOCUMENTAL', 'FISICO', 'DOCUMENTAL Y FISICO'];
  readonly periodicidades = ['ANUAL', 'SEMESTRAL', 'TRIMESTRAL', 'MENSUAL', 'UNICA', 'PERMANENTE'];

  @ViewChild('prosa') prosa?: ElementRef<HTMLElement>;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backend: BackendServices,
    private auth: AuthService,
    private preview: DocumentPreviewService
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

  seleccionarPunto(r: SegRequisito): void {
    if (this.puedeAdministrar) {
      this.abrirEditor(r);
      return;
    }
    this.toggleExpandir(r.id);
  }

  textoRequisitoHtml(r: SegRequisito): string {
    const base = r.descripcion_html
      ? r.descripcion_html
      : this.escaparHtml(r.descripcion || 'Sin descripción').replace(/\n/g, '<br>');
    return DOMPurify.sanitize(this.vincularReferencias(this.marcarIncisos(base), r.imagenes || []), {
      ALLOWED_TAGS: ['strong', 'em', 'u', 'b', 'i', 'br', 'p', 'span'],
      ALLOWED_ATTR: ['class', 'data-clave', 'data-nombre', 'data-src']
    });
  }

  htmlDescripcion(texto: string): string {
    const marcado = this.marcarIncisos(this.escaparHtml(texto || '').replace(/\n/g, '<br>'));
    return DOMPurify.sanitize(marcado, {
      ALLOWED_TAGS: ['strong', 'em', 'u', 'b', 'i', 'br'],
      ALLOWED_ATTR: []
    });
  }

  onProsaInput(el: HTMLElement): void {
    this.sincronizarProsa(el);
  }

  onProsaPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const texto = event.clipboardData?.getData('text/plain') || '';
    if (!texto) return;
    document.execCommand('insertText', false, texto);
  }

  formatearProsa(el: HTMLElement): void {
    this.sincronizarProsa(el);
  }

  private pintarProsa(): void {
    const el = this.prosa?.nativeElement;
    if (!el || !this.editor) return;
    const base = this.editor.descripcion_html
      || this.escaparHtml(this.editor.descripcion || '').replace(/\n/g, '<br>');
    el.innerHTML = DOMPurify.sanitize(this.vincularReferencias(this.marcarIncisos(base), []), {
      ALLOWED_TAGS: ['strong', 'em', 'u', 'b', 'i', 'br', 'p', 'span'],
      ALLOWED_ATTR: ['class', 'data-clave', 'data-nombre', 'data-src']
    });
    el.querySelectorAll('.seg-ref').forEach((nodo) => {
      const ref = nodo as HTMLElement;
      ref.setAttribute('contenteditable', 'false');
      ref.setAttribute('draggable', 'true');
      ref.title = 'Arrastra para colocar la referencia en el texto';
      ref.style.color = '#1d4ed8';
      ref.style.fontStyle = 'italic';
      ref.style.fontWeight = '650';
      ref.style.cursor = 'grab';
    });
  }

  private sincronizarProsa(el: HTMLElement, forzar = false): void {
    if (!this.editor || (this.guardandoPunto && !forzar)) return;
    this.editor.descripcion = this.textoPlano(el);
    this.editor.descripcion_html = this.htmlDesdeEditor(el);
  }

  private htmlDesdeEditor(el: HTMLElement): string {
    const partes: string[] = [];
    const mapa: Record<string, string> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u' };
    const recorrer = (nodo: Node) => {
      if (nodo.nodeType === Node.TEXT_NODE) {
        partes.push(this.escaparHtml((nodo.textContent || '').replace(/\u00a0/g, ' ')));
        return;
      }
      if (!(nodo instanceof HTMLElement)) return;
      const tag = nodo.tagName;
      if (tag === 'BR') {
        partes.push('<br>');
        return;
      }
      if (tag === 'SPAN' && nodo.classList.contains('seg-ref')) {
        const clave = this.escaparHtml(nodo.getAttribute('data-clave') || '');
        const nombre = this.escaparHtml(nodo.getAttribute('data-nombre') || '');
        const srcCruda = nodo.getAttribute('data-src') || '';
        const src = srcCruda && !srcCruda.startsWith('data:') ? ` data-src="${this.escaparHtml(srcCruda)}"` : '';
        const visible = this.escaparHtml(nodo.textContent || '');
        partes.push(`<span class="seg-ref" data-clave="${clave}" data-nombre="${nombre}"${src}>${visible}</span>`);
        return;
      }
      const nombre = mapa[tag];
      const bloque = tag === 'DIV' || tag === 'P';
      if (bloque && partes.length && !partes[partes.length - 1].endsWith('<br>')) partes.push('<br>');
      if (nombre) partes.push(`<${nombre}>`);
      nodo.childNodes.forEach(recorrer);
      if (nombre) partes.push(`</${nombre}>`);
    };
    el.childNodes.forEach(recorrer);
    return partes.join('').replace(/^(<br>)+|(<br>)+$/g, '').replace(/(<br>){3,}/g, '<br><br>');
  }

  private textoPlano(el: HTMLElement): string {
    const partes: string[] = [];
    const recorrer = (nodo: Node) => {
      if (nodo.nodeType === Node.TEXT_NODE) {
        partes.push((nodo.textContent || '').replace(/\u00a0/g, ' '));
        return;
      }
      if (!(nodo instanceof HTMLElement)) return;
      if (nodo.tagName === 'BR') {
        partes.push('\n');
        return;
      }
      const bloque = nodo.tagName === 'DIV' || nodo.tagName === 'P';
      if (bloque && partes.length && !partes[partes.length - 1].endsWith('\n')) partes.push('\n');
      nodo.childNodes.forEach(recorrer);
    };
    el.childNodes.forEach(recorrer);
    return partes.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }

  private marcarIncisos(html: string): string {
    return html.replace(/(^|<br\s*\/?>|\n)(\s*)([a-zA-Z]\))/gi, '$1$2<strong>$3</strong>');
  }

  private escaparHtml(texto: string): string {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
      imagen_portada: 'Portada',
      imagen_referencia: 'Imagen de referencia'
    };
    return (campo && map[campo]) || campo || '';
  }

  abrirVisorFormato(
    event: Event,
    nombre: string | null | undefined,
    ruta: string | null | undefined,
    archivo?: File | null
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const archivoNombre = (archivo?.name || nombre || 'formato').trim();
    const base = {
      nombre: archivoNombre,
      archivo_nombre: archivoNombre,
      etiqueta: 'FORMATO',
      tema: 'seguridad' as const
    };
    if (archivo) {
      this.preview.abrir({ ...base, archivoBlob: archivo });
      return;
    }
    const url = this.urlArchivo(ruta);
    if (!url) return;
    this.preview.abrir({ ...base, urlLocal: url });
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
      descripcion_html: r.descripcion_html || '',
      archivo: null,
      quitarFormato: false,
      imagenes: (r.imagenes || []).map((img) => ({
        clave: `srv-${img.id}`,
        id: img.id,
        nombre: img.nombre,
        preview: this.urlArchivo(img.ruta) || '',
        archivo: null,
        quitar: false
      }))
    };
    setTimeout(() => this.pintarProsa());
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
    const visible = file.name.replace(/\.[^.]+$/, '').trim() || file.name;
    this.editor.formato_nombre = visible.slice(0, 200);
  }

  quitarArchivoNuevo(): void {
    if (!this.editor) return;
    const actual = this.requisitos.find((r) => r.id === this.editor?.id);
    this.editor.archivo = null;
    this.editor.formato_nombre = actual?.formato_nombre || '';
  }

  quitarFormatoEditor(): void {
    if (!this.editor) return;
    this.editor.archivo = null;
    this.editor.quitarFormato = true;
  }

  imagenesVisibles(ed: EditorPunto): EditorImagen[] {
    return ed.imagenes.filter((img) => !img.quitar);
  }

  onImagenes(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!this.editor || !files.length) return;
    const cupo = 8 - this.imagenesVisibles(this.editor).length;
    if (cupo <= 0) {
      Swal.fire('Límite de imágenes', 'Cada punto admite hasta 8 imágenes de referencia.', 'warning');
      return;
    }
    const lote = files.slice(0, cupo);
    if (files.length > cupo) {
      Swal.fire('Límite de imágenes', `Solo se agregaron ${cupo}. El máximo es 8.`, 'warning');
    }
    for (const file of lote) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
        Swal.fire('Imagen no válida', 'Use JPG, PNG o WebP (máximo 6 MB).', 'warning');
        continue;
      }
      if (file.size > 6 * 1024 * 1024) {
        Swal.fire('Imagen muy grande', 'Cada imagen no puede pasar de 6 MB.', 'warning');
        continue;
      }
      const item: EditorImagen = {
        clave: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        id: null,
        nombre: file.name,
        preview: '',
        archivo: file,
        quitar: false
      };
      this.editor.imagenes.push(item);
      this.insertarReferencia(item);
      const reader = new FileReader();
      reader.onload = () => { item.preview = String(reader.result || ''); };
      reader.readAsDataURL(file);
    }
  }

  quitarImagenEditor(img: EditorImagen): void {
    if (!this.editor) return;
    this.prosa?.nativeElement.querySelectorAll(`.seg-ref[data-clave="${img.clave}"]`).forEach((nodo) => nodo.remove());
    const prosa = this.prosa?.nativeElement;
    if (prosa) this.sincronizarProsa(prosa);
    if (img.id) {
      img.quitar = true;
      return;
    }
    this.editor.imagenes = this.editor.imagenes.filter((item) => item.clave !== img.clave);
  }

  etiquetaCorta(nombre: string): string {
    const base = nombre.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (base.length <= 25) return base;
    return `${base.slice(0, 25).trimEnd()}...`;
  }

  verReferencia(event: MouseEvent, imagenes?: SegImagenRef[]): void {
    const span = (event.target as HTMLElement).closest?.('.seg-ref') as HTMLElement | null;
    if (!span) {
      this.previewRef = null;
      return;
    }
    const src = this.resolverSrc(span, imagenes);
    if (!src) {
      this.previewRef = null;
      return;
    }
    const rect = span.getBoundingClientRect();
    let x = rect.left;
    let y = rect.bottom + 8;
    if (x + 236 > window.innerWidth) x = Math.max(8, window.innerWidth - 244);
    if (y + 180 > window.innerHeight) y = Math.max(8, rect.top - 168);
    this.previewRef = {
      src,
      nombre: (span.getAttribute('data-nombre') || span.textContent || '').replace(/\.[^.]+$/, ''),
      x,
      y
    };
  }

  abrirReferencia(event: MouseEvent, imagenes?: SegImagenRef[]): void {
    const span = (event.target as HTMLElement).closest?.('.seg-ref') as HTMLElement | null;
    if (!span) return;
    event.preventDefault();
    event.stopPropagation();
    const src = this.resolverSrc(span, imagenes);
    if (!src) return;
    this.previewRef = null;
    this.luzRef = {
      src,
      nombre: (span.getAttribute('data-nombre') || span.textContent || '').replace(/\.[^.]+$/, '')
    };
  }

  ocultarReferencia(): void {
    this.previewRef = null;
  }

  cerrarLuz(): void {
    this.luzRef = null;
  }

  alArrastrarReferencia(event: DragEvent): void {
    const span = (event.target as HTMLElement).closest?.('.seg-ref') as HTMLElement | null;
    if (!span) return;
    this.refArrastrada = span;
    event.dataTransfer?.setData('text/plain', span.getAttribute('data-clave') || 'ref');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  alPasarReferencia(event: DragEvent): void {
    if (!this.refArrastrada) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  alSoltarReferencia(event: DragEvent): void {
    event.preventDefault();
    const span = this.refArrastrada;
    const prosa = this.prosa?.nativeElement;
    this.refArrastrada = null;
    if (!span || !prosa) return;
    const punto = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (punto && prosa.contains(punto.startContainer)) {
      punto.insertNode(span);
    }
    this.sincronizarProsa(prosa, true);
  }

  private insertarReferencia(img: EditorImagen): void {
    const el = this.prosa?.nativeElement;
    if (!el) return;
    const span = document.createElement('span');
    span.className = 'seg-ref';
    span.contentEditable = 'false';
    span.draggable = true;
    span.title = 'Arrastra para colocar la referencia en el texto';
    span.style.color = '#1d4ed8';
    span.style.fontStyle = 'italic';
    span.style.fontWeight = '650';
    span.style.cursor = 'grab';
    span.setAttribute('data-clave', img.clave);
    span.setAttribute('data-nombre', img.nombre);
    span.textContent = this.etiquetaCorta(img.nombre);
    const sel = window.getSelection();
    const dentro = !!(sel && sel.rangeCount && sel.anchorNode && el.contains(sel.anchorNode));
    if (dentro && sel) {
      const range = sel.getRangeAt(0);
      range.collapse(false);
      range.insertNode(document.createTextNode(' '));
      range.collapse(false);
      range.insertNode(span);
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      if (el.textContent && !/\s$/.test(el.textContent)) el.appendChild(document.createTextNode(' '));
      el.appendChild(span);
    }
    this.sincronizarProsa(el);
  }

  private resolverSrc(span: HTMLElement, imagenes?: SegImagenRef[]): string | null {
    const clave = span.getAttribute('data-clave') || '';
    const local = this.editor?.imagenes.find((img) => img.clave === clave && !img.quitar);
    if (local?.preview) return local.preview;
    const directa = span.getAttribute('data-src');
    if (directa && !directa.startsWith('data:')) return this.urlArchivo(directa);
    const nombre = span.getAttribute('data-nombre') || '';
    const hallada = (imagenes || []).find((img) => img.nombre === nombre);
    return hallada ? this.urlArchivo(hallada.ruta) : null;
  }

  private vincularReferencias(html: string, imagenes: SegImagenRef[]): string {
    if (!imagenes.length) return html;
    return html.replace(/<span class="seg-ref"([^>]*)>/gi, (full, attrs: string) => {
      if (/\sdata-src=/.test(attrs)) return full;
      const nombre = /data-nombre="([^"]*)"/i.exec(attrs)?.[1] || '';
      const hallada = imagenes.find((img) => img.nombre === nombre);
      if (!hallada?.ruta) return full;
      return `<span class="seg-ref"${attrs} data-src="${this.escaparHtml(hallada.ruta)}">`;
    });
  }

  private enlazarReferenciasGuardadas(ed: EditorPunto, imagenes: SegImagenRef[]): boolean {
    const el = this.prosa?.nativeElement;
    if (!el || !imagenes.length) return false;
    let cambio = false;
    el.querySelectorAll('.seg-ref').forEach((nodo) => {
      const span = nodo as HTMLElement;
      const clave = span.getAttribute('data-clave') || '';
      if (!clave.startsWith('new-')) return;
      const item = ed.imagenes.find((img) => img.clave === clave);
      const nombre = item?.nombre || span.getAttribute('data-nombre') || '';
      const guardada = imagenes.find((img) => img.nombre === nombre);
      if (!guardada) return;
      span.setAttribute('data-clave', `srv-${guardada.id}`);
      span.setAttribute('data-nombre', guardada.nombre);
      span.setAttribute('data-src', guardada.ruta);
      cambio = true;
    });
    if (cambio) this.sincronizarProsa(el, true);
    return cambio;
  }

  guardarPunto(): void {
    if (!this.editor || !this.normativa || this.guardandoPunto) return;
    const ed = this.editor;
    const prosa = this.prosa?.nativeElement;
    if (prosa) this.sincronizarProsa(prosa);
    if (!ed.punto_norma.trim() || !ed.descripcion.trim()) return;
    this.guardandoPunto = true;
    const quitar = ed.quitarFormato && !ed.archivo;
    this.backend.actualizarSeguridadRequisito(this.normativa.id, ed.id, {
      punto_norma: ed.punto_norma.trim(),
      descripcion: ed.descripcion.trim(),
      descripcion_html: ed.descripcion_html,
      tipo_evidencia: ed.tipo_evidencia.trim() || null,
      periodicidad: ed.periodicidad.trim() || null,
      evidencia_requerida: ed.evidencia_requerida.trim() || null,
      observaciones: ed.observaciones.trim() || null,
      formato_nombre: quitar ? null : (ed.formato_nombre.trim() || null),
      quitar_formato: quitar
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.persistirImagenes(ed),
      error: (err) => this.falloPunto(err)
    });
  }

  private persistirImagenes(ed: EditorPunto): void {
    if (!this.normativa) return;
    const normativaId = this.normativa.id;
    const quitar = ed.imagenes.filter((img) => img.quitar && img.id);
    const nuevas = ed.imagenes.filter((img) => img.archivo && !img.quitar).map((img) => img.archivo as File);
    const tareas = [
      ...quitar.map((img) => this.backend.quitarImagenReferenciaSeguridad(normativaId, ed.id, img.id as number)),
      ...(nuevas.length ? [this.backend.subirImagenesReferenciaSeguridad(normativaId, ed.id, nuevas)] : [])
    ];
    if (!tareas.length) {
      this.persistirFormato(ed);
      return;
    }
    forkJoin(tareas).pipe(takeUntil(this.destroy$)).subscribe({
      next: (lista) => {
        const enriquecido = [...lista].reverse().find((item: any) => item?.requisito?.imagenes);
        const cambio = enriquecido
          ? this.enlazarReferenciasGuardadas(ed, enriquecido.requisito.imagenes)
          : false;
        if (!cambio || !this.normativa) {
          this.persistirFormato(ed);
          return;
        }
        this.backend.actualizarSeguridadRequisito(this.normativa.id, ed.id, {
          descripcion: ed.descripcion,
          descripcion_html: ed.descripcion_html
        }).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => this.persistirFormato(ed),
          error: (err) => this.falloPunto(err)
        });
      },
      error: (err) => this.falloPunto(err)
    });
  }

  private persistirFormato(ed: EditorPunto): void {
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

