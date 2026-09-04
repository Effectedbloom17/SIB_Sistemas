import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

export interface AmbTramArchivoItem {
  id: number;
  tramiteId: number;
  ambito: 'documento' | 'contestacion';
  carpetaRelativa?: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  driveFileId: string;
  fechaSubida?: string;
}

interface AmbPendiente {
  file: File;
  carpetaRelativa: string;
  etiqueta: string;
}

interface AmbCarpetaVista {
  nombre: string;
  ruta: string;
  cantidad: number;
}

@Component({
  selector: 'app-ambiental-tramite-archivos-panel',
  templateUrl: './ambiental-tramite-archivos-panel.component.html',
  styleUrls: ['./ambiental-tramite-archivos-panel.component.scss']
})
export class AmbientalTramiteArchivosPanelComponent implements OnChanges, OnDestroy {
  @Input() tramiteId: number | null = null;
  @Input() ambito: 'documento' | 'contestacion' = 'documento';
  @Input() oficio = '';
  @Input() compact = true;
  @Input() soloResumen = false;
  @Output() archivosCambiaron = new EventEmitter<void>();
  @Output() visorAbiertoChange = new EventEmitter<boolean>();

  readonly claveRaiz = '__raiz__';
  archivos: AmbTramArchivoItem[] = [];
  pendientes: AmbPendiente[] = [];
  cargando = false;
  subiendo = false;
  error: string | null = null;
  dragOver = false;
  carpetasExpandidas = new Set<string>([this.claveRaiz]);
  previewAbierto = false;
  previewCargando = false;
  previewUrl: string | null = null;
  previewNombre = '';
  previewMime = '';
  previewDocumento: AmbTramArchivoItem | null = null;
  previewPendiente: AmbPendiente | null = null;

  private readonly destroy$ = new Subject<void>();
  private recolectandoDrop = false;
  previewObjectUrl: string | null = null;
  private bodyOverflowAnterior = '';

  constructor(private backend: BackendServices) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tramiteId'] || changes['ambito']) {
      this.cargar();
    }
  }

  ngOnDestroy(): void {
    if (this.previewAbierto) document.body.style.overflow = this.bodyOverflowAnterior;
    this.liberarPreview();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.previewAbierto) this.cerrarPreview();
  }

  get carpetasRaiz(): AmbCarpetaVista[] {
    return this.carpetasHijas('');
  }

  get archivosRaiz(): AmbTramArchivoItem[] {
    return this.archivosEn('');
  }

  get hayContenido(): boolean {
    return this.archivos.length > 0;
  }

  get hayPendientes(): boolean {
    return this.pendientes.length > 0;
  }

  get pendientesRaiz(): AmbPendiente[] {
    return this.pendientes.filter(p => !this.norm(p.carpetaRelativa));
  }

  get previewEsImagen(): boolean {
    return String(this.previewMime || '').toLowerCase().startsWith('image/')
      || /\.(jpe?g|png|gif|webp|bmp)$/i.test(this.previewNombre);
  }

  get previewEsPdf(): boolean {
    return String(this.previewMime || '').toLowerCase().includes('pdf')
      || /\.pdf$/i.test(this.previewNombre);
  }

  get tituloAmbito(): string {
    return this.ambito === 'contestacion' ? 'Contestación' : 'Documento';
  }

  get puedeSubir(): boolean {
    return !!this.tramiteId && !!String(this.oficio || '').trim() && !this.subiendo;
  }

  cargar(): void {
    if (!this.tramiteId) {
      this.archivos = [];
      return;
    }
    this.cargando = true;
    this.error = null;
    this.backend.listarAmbientalTramiteArchivos(this.tramiteId, this.ambito)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.archivos = Array.isArray(res?.archivos) ? res.archivos : [];
          this.cargando = false;
          if (this.archivosRaiz.length) {
            this.carpetasExpandidas.add(this.claveRaiz);
            this.carpetasExpandidas = new Set(this.carpetasExpandidas);
          }
        },
        error: (err) => {
          this.error = err?.error?.message || 'No se pudieron cargar los archivos.';
          this.cargando = false;
        }
      });
  }

  carpetasHijas(rutaPadre: string): AmbCarpetaVista[] {
    const actual = this.norm(rutaPadre);
    const mapa = new Map<string, number>();
    for (const doc of this.archivos) {
      const ruta = this.norm(doc.carpetaRelativa);
      if (!ruta) continue;
      let resto = '';
      if (!actual) resto = ruta;
      else if (ruta === actual || !ruta.startsWith(actual + '/')) continue;
      else resto = ruta.slice(actual.length + 1);
      const nombre = resto.split('/')[0];
      if (!nombre) continue;
      mapa.set(nombre, (mapa.get(nombre) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .map(([nombre, cantidad]) => ({
        nombre,
        ruta: actual ? `${actual}/${nombre}` : nombre,
        cantidad
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  archivosEn(rutaPadre: string): AmbTramArchivoItem[] {
    const actual = this.norm(rutaPadre);
    return this.archivos.filter(d => this.norm(d.carpetaRelativa) === actual);
  }

  estaExpandida(ruta: string): boolean {
    const r = ruta === this.claveRaiz ? this.claveRaiz : this.norm(ruta);
    return this.carpetasExpandidas.has(r);
  }

  toggleCarpeta(ruta: string): void {
    const r = ruta === this.claveRaiz ? this.claveRaiz : this.norm(ruta);
    if (!r) return;
    if (this.carpetasExpandidas.has(r)) this.carpetasExpandidas.delete(r);
    else this.carpetasExpandidas.add(r);
    this.carpetasExpandidas = new Set(this.carpetasExpandidas);
  }

  onArchivos(event: Event, destino = ''): void {
    const input = event.target as HTMLInputElement;
    const pendientes = this.construirPendientes(input.files, false, destino);
    input.value = '';
    void this.confirmarYSubir(pendientes, destino);
  }

  quitarPendiente(index: number): void {
    this.pendientes.splice(index, 1);
  }

  quitarPendienteItem(pendiente: AmbPendiente): void {
    const index = this.pendientes.indexOf(pendiente);
    if (index >= 0) this.quitarPendiente(index);
  }

  async subirPendientes(): Promise<boolean> {
    if (!this.pendientes.length) return true;
    if (!this.tramiteId || !String(this.oficio || '').trim()) return false;
    const pendientes = [...this.pendientes];
    this.subiendo = true;
    try {
      const res = await firstValueFrom(
        this.backend.subirAmbientalTramiteArchivos(
          this.tramiteId,
          this.ambito,
          pendientes.map(p => ({ file: p.file, carpetaRelativa: p.carpetaRelativa }))
        )
      );
      const exitosos = Number(res?.exitosos) || 0;
      const nombresFallidos = new Set<string>(
        Array.isArray(res?.errores)
          ? res.errores.map((error: any) => String(error?.nombre || ''))
          : []
      );
      if (exitosos) {
        this.pendientes = pendientes.filter(p => nombresFallidos.has(p.file.name));
        this.cargar();
        this.archivosCambiaron.emit();
      }
      if (nombresFallidos.size) {
        this.error = `No se pudieron subir ${nombresFallidos.size} archivo(s).`;
      }
      return exitosos === pendientes.length;
    } catch (err: any) {
      this.error = err?.error?.message || 'No se pudieron subir los archivos pendientes.';
      return false;
    } finally {
      this.subiendo = false;
    }
  }

  onCarpeta(event: Event, destino = ''): void {
    const input = event.target as HTMLInputElement;
    const pendientes = this.construirPendientes(input.files, true, destino);
    input.value = '';
    void this.confirmarYSubir(pendientes, destino);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
  }

  onDrop(event: DragEvent, destino = ''): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
    void this.desdeDrop(event.dataTransfer, destino);
  }

  etiquetaCarpeta(doc: AmbTramArchivoItem): string {
    const ruta = this.norm(doc.carpetaRelativa);
    return ruta || 'Documentación extra';
  }

  urlMiniatura(doc: AmbTramArchivoItem): string | null {
    return doc?.driveFileId ? this.backend.resolverUrlDrivePreview(doc.driveFileId) : null;
  }

  abrirPreview(doc: AmbTramArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.tramiteId || !doc?.driveFileId) return;
    this.iniciarPreview(doc.nombreArchivo, doc.mimeType);
    this.previewDocumento = doc;
    this.previewCargando = true;

    const proxyUrl = this.backend.resolverUrlDrivePreview(doc.driveFileId);
    if (this.previewEsPdf || this.previewEsImagen) {
      this.previewUrl = proxyUrl;
      this.previewCargando = false;
      return;
    }

    this.backend.prepararVistaAmbientalTramiteArchivo(this.tramiteId, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.previewUrl = res?.previewUrl
            || `https://drive.google.com/file/d/${doc.driveFileId}/preview`;
          this.previewCargando = false;
        },
        error: () => {
          this.previewUrl = null;
          this.previewCargando = false;
        }
      });
  }

  abrirPreviewPendiente(pendiente: AmbPendiente, event?: Event): void {
    event?.stopPropagation();
    if (!pendiente?.file) return;
    this.iniciarPreview(pendiente.file.name, pendiente.file.type);
    this.previewPendiente = pendiente;
    this.previewObjectUrl = URL.createObjectURL(pendiente.file);
    if (this.previewEsPdf || this.previewEsImagen) {
      this.previewUrl = this.previewObjectUrl;
    }
  }

  cerrarPreview(): void {
    this.previewAbierto = false;
    this.visorAbiertoChange.emit(false);
    document.body.style.overflow = this.bodyOverflowAnterior;
    this.liberarPreview();
  }

  descargarDesdePreview(): void {
    if (this.previewDocumento) {
      this.descargar(this.previewDocumento);
      return;
    }
    if (this.previewPendiente && this.previewObjectUrl) {
      const a = document.createElement('a');
      a.href = this.previewObjectUrl;
      a.download = this.previewPendiente.file.name;
      a.click();
    }
  }

  private iniciarPreview(nombre: string, mime: string): void {
    this.liberarPreview();
    this.previewNombre = nombre || 'documento';
    this.previewMime = mime || '';
    this.previewAbierto = true;
    this.visorAbiertoChange.emit(true);
    this.bodyOverflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  private liberarPreview(): void {
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    this.previewObjectUrl = null;
    this.previewUrl = null;
    this.previewNombre = '';
    this.previewMime = '';
    this.previewDocumento = null;
    this.previewPendiente = null;
    this.previewCargando = false;
  }

  ver(doc: AmbTramArchivoItem, event?: Event): void {
    this.abrirPreview(doc, event);
  }

  descargar(doc: AmbTramArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.tramiteId) return;
    this.backend.descargarAmbientalTramiteArchivo(this.tramiteId, doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.nombreArchivo || 'documento';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: async (err) => {
          await Swal.fire({
            icon: 'error',
            title: 'No se pudo descargar',
            text: err?.error?.message || 'Error al descargar.',
            confirmButtonColor: '#38512F'
          });
        }
      });
  }

  async eliminar(doc: AmbTramArchivoItem, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.tramiteId) return;
    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Eliminar archivo',
      text: `¿Eliminar "${doc.nombreArchivo}"?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c0392b',
      cancelButtonColor: '#6b7280'
    });
    if (!conf.isConfirmed) return;
    try {
      await firstValueFrom(this.backend.eliminarAmbientalTramiteArchivo(this.tramiteId, doc.id));
      this.archivos = this.archivos.filter(a => a.id !== doc.id);
      this.archivosCambiaron.emit();
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo eliminar',
        text: err?.error?.message || 'Error al eliminar.',
        confirmButtonColor: '#38512F'
      });
    }
  }

  formatearTamano(bytes: number | null | undefined): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  etiquetaTipo(mime: string | null | undefined, nombre: string): string {
    const m = String(mime || '').toLowerCase();
    const n = String(nombre || '').toLowerCase();
    if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
    if (m.includes('image') || /\.(jpe?g|png|webp|gif)$/.test(n)) return 'IMG';
    if (m.includes('word') || /\.docx?$/.test(n)) return 'Word';
    return 'Archivo';
  }

  iconoTipo(mime: string | null | undefined, nombre: string): string {
    const t = this.etiquetaTipo(mime, nombre);
    if (t === 'PDF') return 'fa-file-pdf';
    if (t === 'IMG') return 'fa-file-image';
    if (t === 'Word') return 'fa-file-word';
    return 'fa-file-alt';
  }

  trackById(_: number, doc: AmbTramArchivoItem): number { return doc.id; }
  trackByRuta(_: number, c: AmbCarpetaVista): string { return c.ruta; }

  private async desdeDrop(dt: DataTransfer | null, destino: string): Promise<void> {
    if (!dt || this.recolectandoDrop) return;
    this.recolectandoDrop = true;
    try {
      const entries: any[] = [];
      if (dt.items?.length) {
        for (let i = 0; i < dt.items.length; i++) {
          const entry = (dt.items[i] as any).webkitGetAsEntry?.();
          if (entry) entries.push(entry);
        }
      }
      if (entries.length) {
        const pendientes: AmbPendiente[] = [];
        const base = this.norm(destino);
        for (const entry of entries) {
          await this.recorrerEntry(entry, base, pendientes);
        }
        await this.confirmarYSubir(pendientes, destino);
        return;
      }
      await this.confirmarYSubir(this.construirPendientes(dt.files, false, destino), destino);
    } finally {
      this.recolectandoDrop = false;
    }
  }

  private recorrerEntry(entry: any, basePath: string, out: AmbPendiente[]): Promise<void> {
    if (!entry) return Promise.resolve();
    if (entry.isFile) {
      return new Promise(resolve => {
        entry.file((file: File) => {
          if (file?.size > 0) {
            const carpetaRelativa = this.norm(basePath);
            out.push({
              file,
              carpetaRelativa,
              etiqueta: carpetaRelativa ? `${carpetaRelativa}/${file.name}` : file.name
            });
          }
          resolve();
        }, () => resolve());
      });
    }
    if (entry.isDirectory) {
      const dirPath = this.unir(basePath, entry.name);
      return this.leerEntries(entry.createReader()).then(async hijos => {
        for (const hijo of hijos) await this.recorrerEntry(hijo, dirPath, out);
      });
    }
    return Promise.resolve();
  }

  private leerEntries(reader: any): Promise<any[]> {
    return new Promise(resolve => {
      const all: any[] = [];
      const leer = () => reader.readEntries((lote: any[]) => {
        if (!lote?.length) { resolve(all); return; }
        all.push(...lote);
        leer();
      }, () => resolve(all));
      leer();
    });
  }

  private construirPendientes(lista: FileList | null, desdeCarpeta: boolean, destino: string): AmbPendiente[] {
    if (!lista?.length) return [];
    const base = this.norm(destino);
    const out: AmbPendiente[] = [];
    for (const file of Array.from(lista)) {
      if (!file?.size) continue;
      let carpetaRelativa = base;
      let etiqueta = file.name;
      if (desdeCarpeta) {
        const rel = String((file as any).webkitRelativePath || '').replace(/\\/g, '/');
        if (rel.includes('/')) {
          const dir = this.dirname(rel);
          carpetaRelativa = this.unir(base, dir);
          etiqueta = this.unir(base, rel) || rel;
        }
      } else if (carpetaRelativa) {
        etiqueta = `${carpetaRelativa}/${file.name}`;
      }
      out.push({ file, carpetaRelativa, etiqueta });
    }
    return out;
  }

  private detectarCarpetasNuevas(pendientes: AmbPendiente[], destino: string): string[] {
    const base = this.norm(destino);
    const set = new Set<string>();
    for (const p of pendientes) {
      const ruta = this.norm(p.carpetaRelativa);
      let resto = '';
      if (!base) resto = ruta;
      else if (ruta === base) continue;
      else if (ruta.startsWith(base + '/')) resto = ruta.slice(base.length + 1);
      else continue;
      const top = resto.split('/')[0];
      if (top) set.add(top);
    }
    return Array.from(set);
  }

  private etiquetaCarpetaPendiente(p: AmbPendiente): string {
    const ruta = this.norm(p.carpetaRelativa);
    return ruta || 'Documentación extra';
  }

  private async confirmarYSubir(pendientes: AmbPendiente[], destino: string): Promise<void> {
    if (!pendientes.length) return;
    if (!this.tramiteId) {
      this.pendientes = [...this.pendientes, ...pendientes];
      return;
    }
    if (!this.puedeSubir) {
      if (!String(this.oficio || '').trim()) {
        await Swal.fire({
          icon: 'warning',
          title: 'Oficio requerido',
          text: 'Indica el oficio del trámite antes de subir archivos.',
          confirmButtonColor: '#38512F'
        });
      }
      return;
    }

    const n = pendientes.length;
    const carpetas = this.detectarCarpetasNuevas(pendientes, destino);
    let aviso = `Se van a subir <strong>${n}</strong> documento${n !== 1 ? 's' : ''}.`;
    if (carpetas.length === 1) {
      aviso = `Se va a crear la carpeta <strong>${this.esc(carpetas[0])}</strong> y se van a subir <strong>${n}</strong> documento${n !== 1 ? 's' : ''}.`;
    } else if (carpetas.length > 1) {
      aviso = `Se van a crear las carpetas <strong>${carpetas.map(c => this.esc(c)).join(', ')}</strong> y se van a subir <strong>${n}</strong> documentos.`;
    }

    const filas = pendientes.map(p => `
      <li style="display:grid;grid-template-columns:minmax(0,1.4fr) auto auto minmax(0,1fr);gap:0.35rem 0.45rem;align-items:center;padding:0.4rem 0.35rem;border-bottom:1px solid #e8eee3;font-size:0.74rem;text-align:left;">
        <div style="min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.esc(p.file.name)}">${this.esc(p.file.name)}</div>
        <span style="color:#38512F;background:#e8f0e3;border-radius:999px;padding:0.1rem 0.45rem;font-size:0.66rem;font-weight:700;">${this.esc(this.ext(p.file.name))}</span>
        <span style="color:#888;font-size:0.7rem;white-space:nowrap;">${this.esc(this.formatearTamano(p.file.size))}</span>
        <span style="min-width:0;color:#5a7456;font-size:0.68rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.esc(this.etiquetaCarpetaPendiente(p))}">
          <i class="fas fa-folder" style="margin-right:0.2rem;opacity:0.8;"></i>${this.esc(this.etiquetaCarpetaPendiente(p))}
        </span>
      </li>`).join('');

    const result = await Swal.fire({
      icon: 'info',
      title: 'Subir Documentos',
      html: `<p style="margin:0 0 0.65rem;text-align:left;color:#555;">${aviso}</p>
             <div style="display:grid;grid-template-columns:minmax(0,1.4fr) auto auto minmax(0,1fr);gap:0.35rem 0.45rem;padding:0.25rem 0.35rem 0.35rem;font-size:0.62rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#7a8a72;text-align:left;">
               <span>Nombre</span><span>Tipo</span><span>Peso</span><span>Carpeta</span>
             </div>
             <ul style="list-style:none;margin:0;padding:0 0.15rem;max-height:240px;overflow:auto;border:1px solid #e8eee3;border-radius:10px;background:#f7faf5;">${filas}</ul>`,
      showCancelButton: true,
      confirmButtonText: 'Subir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6b7280',
      width: 580
    });
    if (!result.isConfirmed) return;

    this.subiendo = true;
    try {
      const res = await firstValueFrom(
        this.backend.subirAmbientalTramiteArchivos(
          this.tramiteId,
          this.ambito,
          pendientes.map(p => ({ file: p.file, carpetaRelativa: p.carpetaRelativa }))
        )
      );
      for (const nombre of carpetas) {
        const ruta = this.unir(destino, nombre);
        if (ruta) this.carpetasExpandidas.add(ruta);
      }
      if (pendientes.some(p => !this.norm(p.carpetaRelativa) || (this.norm(p.carpetaRelativa) === this.norm(destino) && !carpetas.length))) {
        this.carpetasExpandidas.add(destino ? this.norm(destino) : this.claveRaiz);
      }
      if (pendientes.some(p => !this.norm(p.carpetaRelativa))) {
        this.carpetasExpandidas.add(this.claveRaiz);
      }
      this.carpetasExpandidas = new Set(this.carpetasExpandidas);
      this.cargar();
      this.archivosCambiaron.emit();
      const exitosos = Number(res?.exitosos) || 0;
      await Swal.fire({
        icon: exitosos ? 'success' : 'warning',
        title: exitosos ? 'Subida completa' : 'Sin archivos subidos',
        text: res?.message || `${exitosos} archivo(s) guardado(s).`,
        timer: exitosos ? 1600 : undefined,
        showConfirmButton: !exitosos,
        confirmButtonColor: '#38512F'
      });
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err?.error?.message || 'No se pudo subir.',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.subiendo = false;
    }
  }

  private norm(ruta: string | null | undefined): string {
    return String(ruta || '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..').join('/');
  }

  private unir(a: string, b: string): string {
    const x = this.norm(a);
    const y = this.norm(b);
    if (!x) return y;
    if (!y) return x;
    return `${x}/${y}`;
  }

  private dirname(ruta: string): string {
    const n = this.norm(ruta);
    return n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
  }

  private ext(nombre: string): string {
    const p = String(nombre || '').split('.');
    return p.length > 1 ? `.${(p.pop() || '').toLowerCase()}` : '—';
  }

  private esc(v: string): string {
    return String(v || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
