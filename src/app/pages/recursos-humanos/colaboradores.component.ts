import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, from, of } from 'rxjs';
import { catchError, concatMap, mergeMap, takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';
import {
  ORGANIGRAMA_COLUMNAS,
  ORGANIGRAMA_DIRECCION,
  ORGANIGRAMA_PUESTOS_LAYOUT,
  OrganigramaColumna,
  areaDePuesto,
  normalizarTextoPuesto,
  puestoCanonicoOrganigrama
} from './organigrama-biznaga.catalog';

export interface ColaboradorItem {
  id: string;
  nombre: string;
  iniciales: string;
  carpetas?: number;
  archivos?: number;
  documentos: number;
  fotoFileId?: string | null;
  fotoUrl?: string | null;
  organigrama?: string | null;
  usuarioId?: number | null;
  email?: string | null;
  telefono?: string | null;
  tieneExpediente?: boolean;
  modificado?: string | null;
  webViewLink?: string;
}

export interface CarpetaItem {
  id: string;
  nombre: string;
  items?: number;
  archivos?: number;
  carpetas?: number;
  modificado?: string | null;
  webViewLink?: string;
}

export interface ArchivoItem {
  id: string;
  nombre: string;
  tipo: 'pdf' | 'imagen';
  mimeType: string;
  tamano: number | null;
  tamanoLabel: string | null;
  modificado: string | null;
  webViewLink: string;
}

export interface MigaItem {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-colaboradores',
  templateUrl: './colaboradores.component.html',
  styleUrls: ['./colaboradores.component.scss']
})
export class ColaboradoresComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private miniaturaQueue$ = new Subject<ArchivoItem>();
  private contenidoSeq = 0;

  cargando = false;
  cargandoContenido = false;
  subiendo = false;
  creandoCarpeta = false;
  moviendo = false;
  estadoOperacion = '';
  errorCarga = '';
  mensajeOk = '';
  busqueda = '';
  busquedaDoc = '';
  carpetaUrl = '';
  totalDocumentos = 0;
  dropOverCarpetaId: string | null = null;
  dropOverBody = false;
  dropOverRegresar = false;
  archivoParaMover: ArchivoItem | null = null;
  dragFileId: string | null = null;

  private uploadLock = false;
  private lastDropKey = '';
  private lastDropAt = 0;
  private readonly DROP_DEDUP_MS = 1500;
  private readonly onAnyScroll = () => {
    if (this.hoverColaborador) this.ocultarFicha();
  };

  readonly orgDireccion = ORGANIGRAMA_DIRECCION;
  readonly orgColumnas: OrganigramaColumna[] = ORGANIGRAMA_COLUMNAS;

  colaboradores: ColaboradorItem[] = [];
  seleccionado: ColaboradorItem | null = null;
  carpetas: CarpetaItem[] = [];
  archivos: ArchivoItem[] = [];
  migas: MigaItem[] = [];
  carpetaActualId: string | null = null;
  carpetaActualNombre = 'Expediente';
  esRaizExpediente = true;

  documentoActivo: ArchivoItem | null = null;
  miniaturas: Record<string, string> = {};
  miniaturasCargando: Record<string, boolean> = {};
  avatares: Record<string, string> = {};

  mostrarNuevaCarpeta = false;
  nombreNuevaCarpeta = '';
  mostrarReescribir = false;
  reescribiendo = false;
  filasReescribir: Array<{ id: string; original: string; nombre: string }> = [];
  vistaExpediente = false;
  hoverColaborador: ColaboradorItem | null = null;
  hoverLeft = 0;
  hoverTop = 0;
  carpetaPuestoAbierta: string | null = null;
  private expedienteIdRuta: string | null = null;

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private documentPreview: DocumentPreviewService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.miniaturaQueue$
      .pipe(
        mergeMap((doc) => this.cargarMiniaturaDoc$(doc), 8),
        takeUntil(this.destroy$)
      )
      .subscribe(({ fileId, blob }) => {
        this.miniaturasCargando = { ...this.miniaturasCargando, [fileId]: false };
        if (!blob || blob.size < 20) return;
        this.revocarUrl(this.miniaturas[fileId]);
        this.miniaturas = { ...this.miniaturas, [fileId]: URL.createObjectURL(blob) };
      });

    document.addEventListener('scroll', this.onAnyScroll, true);
    this.cargar();
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = String(params.get('id') || '').trim();
      this.expedienteIdRuta = id ? decodeURIComponent(id) : null;
      this.vistaExpediente = !!this.expedienteIdRuta;
      if (!this.vistaExpediente) {
        this.resetSeleccionLocal();
        return;
      }
      this.aplicarRutaExpediente();
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onAnyScroll, true);
    this.documentPreview.cerrar();
    Object.values(this.miniaturas).forEach((u) => this.revocarUrl(u));
    Object.values(this.avatares).forEach((u) => this.revocarUrl(u));
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChange(): void {
    if (this.hoverColaborador) this.ocultarFicha();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const tag = ((event.target as HTMLElement)?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (event.key === 'Escape') {
      if (Swal.isVisible()) return;
      if (this.carpetaPuestoAbierta) {
        this.cerrarCarpetaPuesto();
        event.preventDefault();
        return;
      }
      if (this.archivoParaMover) {
        this.cancelarMoverA();
        event.preventDefault();
        return;
      }
      if (this.mostrarReescribir) {
        this.cerrarPanelReescritura();
        return;
      }
      if (this.mostrarNuevaCarpeta) {
        this.mostrarNuevaCarpeta = false;
        return;
      }
      if (this.vistaExpediente) {
        this.volverAlOrganigrama();
        event.preventDefault();
      }
    }
  }

  get colaboradoresFiltrados(): ColaboradorItem[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.colaboradores;
    return this.colaboradores.filter((c) => {
      const puesto = this.puestoDe(c) || '';
      const area = this.areaDe(c) || '';
      const email = String(c.email || '').toLowerCase();
      const telefono = String(c.telefono || '').toLowerCase();
      return c.nombre.toLowerCase().includes(q)
        || puesto.toLowerCase().includes(q)
        || area.toLowerCase().includes(q)
        || email.includes(q)
        || telefono.includes(q);
    });
  }

  get buscando(): boolean {
    return !!this.busqueda.trim();
  }

  get personasFueraDeLayout(): ColaboradorItem[] {
    return this.colaboradoresFiltrados.filter((c) => {
      if (this.esResidente(c)) return false;
      const puesto = this.puestoDe(c);
      return !puesto || !ORGANIGRAMA_PUESTOS_LAYOUT.has(puesto);
    });
  }

  get ocupadosOrganigrama(): number {
    return this.puestosDelLayout.filter((puesto) => this.personasEn(puesto).length > 0).length;
  }

  get vacantesOrganigrama(): number {
    return this.puestosDelLayout.filter((puesto) => this.personasEn(puesto).length === 0).length;
  }

  get personasEnOrganigrama(): number {
    return this.colaboradoresFiltrados.filter((c) => {
      const puesto = this.puestoDe(c);
      return !!puesto && ORGANIGRAMA_PUESTOS_LAYOUT.has(puesto) && !this.esResidente(c);
    }).length;
  }

  private get puestosDelLayout(): string[] {
    return [this.orgDireccion.puesto, ...this.orgColumnas.flatMap((col) => col.nodos.map((nodo) => nodo.puesto))];
  }

  esPuestoDireccion(puesto?: string | null): boolean {
    return puesto === this.orgDireccion.puesto;
  }

  get personasCarpetaAbierta(): ColaboradorItem[] {
    if (!this.carpetaPuestoAbierta) return [];
    return this.personasEn(this.carpetaPuestoAbierta);
  }

  puestoDe(colaborador?: ColaboradorItem | null): string | null {
    return puestoCanonicoOrganigrama(colaborador?.organigrama);
  }

  areaDe(colaborador?: ColaboradorItem | null): string | null {
    return areaDePuesto(colaborador?.organigrama);
  }

  contactoDe(colaborador?: ColaboradorItem | null): { email: string | null; telefono: string | null } {
    return {
      email: String(colaborador?.email || '').trim() || null,
      telefono: String(colaborador?.telefono || '').trim() || null
    };
  }

  mostrarFicha(colaborador: ColaboradorItem, event: Event): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!colaborador || !el) return;
    this.hoverColaborador = colaborador;
    this.posicionarFicha(el);
  }

  ocultarFicha(): void {
    this.hoverColaborador = null;
  }

  private posicionarFicha(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const width = 292;
    const height = 236;
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right + gap;
    let top = r.top + Math.max(0, (r.height - height) / 2);
    if (left + width > vw - 12) left = r.left - width - gap;
    if (left < 12) left = Math.max(12, Math.min(vw - width - 12, r.left));
    if (top + height > vh - 12) top = vh - height - 12;
    if (top < 12) top = 12;
    this.hoverLeft = Math.round(left);
    this.hoverTop = Math.round(top);
  }

  esResidente(colaborador?: ColaboradorItem | null): boolean {
    const puesto = this.puestoDe(colaborador);
    if (puesto === 'Residente') return true;
    return normalizarTextoPuesto(String(colaborador?.organigrama || '')) === 'residente';
  }

  personasEn(puesto: string): ColaboradorItem[] {
    return this.colaboradoresFiltrados.filter((c) => this.puestoDe(c) === puesto);
  }

  abrirCarpetaPuesto(puesto: string, event?: Event): void {
    event?.stopPropagation();
    this.ocultarFicha();
    this.carpetaPuestoAbierta = puesto;
  }

  cerrarCarpetaPuesto(): void {
    this.carpetaPuestoAbierta = null;
  }

  previewsCarpeta(personas: ColaboradorItem[]): ColaboradorItem[] {
    return (personas || []).slice(0, 4);
  }

  mostrarVacante(puesto: string): boolean {
    return !this.buscando && this.personasEn(puesto).length === 0;
  }

  columnaVisible(col: OrganigramaColumna): boolean {
    return col.nodos.some((nodo) => this.personasEn(nodo.puesto).length > 0 || this.mostrarVacante(nodo.puesto));
  }

  tieneExpedienteDrive(colaborador?: ColaboradorItem | null): boolean {
    if (!colaborador) return false;
    if (colaborador.tieneExpediente === false) return false;
    return /^[a-zA-Z0-9_-]{10,}$/.test(String(colaborador.id || ''));
  }

  fotoSrc(colaborador?: ColaboradorItem | null): string | null {
    if (!colaborador) return null;
    if (colaborador.fotoFileId && this.avatares[colaborador.fotoFileId]) {
      return this.avatares[colaborador.fotoFileId];
    }
    const url = String(colaborador.fotoUrl || '').trim();
    if (url && /^(https?:|data:|blob:|\/)/i.test(url)) return url;
    return null;
  }

  trackByColaborador(_index: number, item: ColaboradorItem): string {
    return item.id || `n-${item.usuarioId || item.nombre}`;
  }

  get carpetasFiltradas(): CarpetaItem[] {
    const q = this.busquedaDoc.trim().toLowerCase();
    if (!q) return this.carpetas;
    return this.carpetas.filter((c) => c.nombre.toLowerCase().includes(q));
  }

  get archivosFiltrados(): ArchivoItem[] {
    const q = this.busquedaDoc.trim().toLowerCase();
    if (!q) return this.archivos;
    return this.archivos.filter((a) => a.nombre.toLowerCase().includes(q));
  }

  get vacioExpediente(): boolean {
    return !this.cargandoContenido && !this.carpetas.length && !this.archivos.length;
  }

  get puedeReescribirDocumentos(): boolean {
    return this.auth.esAdministradorOSuperior() || this.auth.tieneRol('rrhh');
  }

  /** Carpeta padre (para Regresar / soltar archivos hacia arriba). */
  get carpetaPadreId(): string | null {
    if (!this.seleccionado || this.esRaizExpediente) return null;
    const visibles = (this.migas || []).filter((m) => m.id !== this.seleccionado?.id);
    if (visibles.length >= 2) {
      return visibles[visibles.length - 2].id;
    }
    return this.seleccionado.id;
  }

  get carpetaPadreNombre(): string {
    if (!this.seleccionado || this.esRaizExpediente) return 'Expediente';
    const visibles = (this.migas || []).filter((m) => m.id !== this.seleccionado?.id);
    if (visibles.length >= 2) {
      return visibles[visibles.length - 2].nombre || 'carpeta anterior';
    }
    return 'Expediente';
  }

  cargar(forzar = false): void {
    this.cargando = true;
    this.errorCarga = '';
    this.backend.listarRrhhColaboradores(forzar).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.colaboradores = Array.isArray(res?.colaboradores) ? res.colaboradores : [];
        this.carpetaUrl = res?.carpetaUrl || '';
        this.totalDocumentos = Number(res?.documentos) || 0;
        this.cargando = false;
        this.cargarAvatares();
        this.aplicarRutaExpediente();
        if (this.seleccionado) {
          const actual = this.colaboradores.find((c) => c.id === this.seleccionado?.id);
          if (actual) this.seleccionado = { ...this.seleccionado, ...actual };
        }
      },
      error: (err) => {
        this.cargando = false;
        this.errorCarga = err?.error?.message || 'No se pudo cargar el directorio de colaboradores.';
      }
    });
  }

  seleccionar(colaborador: ColaboradorItem): void {
    if (!colaborador?.id) return;
    this.ocultarFicha();
    this.cerrarCarpetaPuesto();
    void this.router.navigate(['/recursos-humanos/colaboradores/expediente', colaborador.id]);
  }

  private aplicarRutaExpediente(): void {
    const id = this.expedienteIdRuta;
    if (!id || this.cargando) return;
    const encontrado = this.colaboradores.find((c) => c.id === id);
    if (!encontrado) {
      this.seleccionado = null;
      this.errorCarga = 'No se encontró el colaborador solicitado.';
      return;
    }
    this.abrirExpedienteLocal(encontrado);
  }

  private abrirExpedienteLocal(colaborador: ColaboradorItem): void {
    if (this.seleccionado?.id === colaborador.id && this.vistaExpediente) return;
    this.seleccionado = colaborador;
    this.busquedaDoc = '';
    this.cerrarPreview();
    this.mostrarNuevaCarpeta = false;
    this.errorCarga = '';
    this.mensajeOk = '';
    this.carpetas = [];
    this.archivos = [];
    this.migas = [];
    if (!this.tieneExpedienteDrive(colaborador)) {
      this.cargandoContenido = false;
      this.esRaizExpediente = true;
      this.carpetaActualId = null;
      this.carpetaActualNombre = 'Expediente';
      return;
    }
    this.cargarContenido(colaborador.id, colaborador.id);
  }

  private resetSeleccionLocal(): void {
    this.seleccionado = null;
    this.cerrarPreview();
    this.mostrarNuevaCarpeta = false;
    this.carpetas = [];
    this.archivos = [];
    this.migas = [];
    this.errorCarga = '';
  }

  volverAlOrganigrama(): void {
    this.resetSeleccionLocal();
    void this.router.navigate(['/recursos-humanos/colaboradores']);
  }

  entrarCarpeta(carpeta: CarpetaItem): void {
    if (!this.seleccionado) return;
    this.cerrarPreview();
    this.cargarContenido(this.seleccionado.id, carpeta.id);
  }

  irAMiga(miga: MigaItem): void {
    if (!this.seleccionado) return;
    this.cerrarPreview();
    this.cargarContenido(this.seleccionado.id, miga.id);
  }

  irARaizExpediente(): void {
    if (!this.seleccionado) return;
    this.cerrarPreview();
    this.cargarContenido(this.seleccionado.id, this.seleccionado.id);
  }

  /** Regresa a la carpeta padre (o a la raíz del expediente). */
  regresarNivel(): void {
    if (!this.seleccionado || this.esRaizExpediente) return;
    const visibles = (this.migas || []).filter((m) => m.id !== this.seleccionado?.id);
    if (visibles.length >= 2) {
      this.irAMiga(visibles[visibles.length - 2]);
      return;
    }
    this.irARaizExpediente();
  }

  recargarContenido(): void {
    if (!this.seleccionado) {
      this.cargar(true);
      return;
    }
    if (!this.tieneExpedienteDrive(this.seleccionado)) return;
    this.cargarContenido(this.seleccionado.id, this.carpetaActualId || this.seleccionado.id, true);
  }

  private cargarContenido(colaboradorId: string, carpetaId: string, forzar = false): void {
    const seq = ++this.contenidoSeq;
    this.cargandoContenido = true;
    this.errorCarga = '';
    this.backend
      .listarRrhhColaboradorContenido(colaboradorId, carpetaId, forzar)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          if (seq !== this.contenidoSeq) return;
          this.carpetas = Array.isArray(res?.carpetas) ? res.carpetas : [];
          this.archivos = Array.isArray(res?.archivos) ? res.archivos : [];
          this.migas = Array.isArray(res?.migas) ? res.migas : [];
          this.carpetaActualId = res?.carpetaActual?.id || carpetaId;
          this.carpetaActualNombre = res?.carpetaActual?.nombre || 'Expediente';
          this.esRaizExpediente = !!res?.carpetaActual?.esRaiz;
          if (res?.colaborador) {
            this.seleccionado = { ...(this.seleccionado as ColaboradorItem), ...res.colaborador };
          }
          this.cargandoContenido = false;
          this.encolarMiniaturas(this.archivos);
          this.restaurarBorradorReescritura();
        },
        error: (err) => {
          if (seq !== this.contenidoSeq) return;
          this.cargandoContenido = false;
          this.carpetas = [];
          this.archivos = [];
          this.errorCarga = err?.error?.message || 'No se pudo abrir el expediente.';
        }
      });
  }

  abrirDocumento(doc: ArchivoItem): void {
    if (!doc?.id) return;
    this.documentoActivo = doc;
    this.documentPreview.abrir({
      nombre: doc.nombre,
      archivo_nombre: doc.nombre,
      archivo_url: doc.id,
      rrhhColaboradorFileId: doc.id,
      tipoHint: doc.tipo === 'pdf' ? 'pdf' : 'imagen',
      tema: 'rrhh',
      etiqueta: doc.tipo === 'pdf'
        ? `PDF${doc.tamanoLabel ? ' · ' + doc.tamanoLabel : ''} · Expediente`
        : `Imagen${doc.tamanoLabel ? ' · ' + doc.tamanoLabel : ''} · Expediente`,
      editorUrl: doc.webViewLink || undefined
    });
  }

  cerrarPreview(): void {
    this.documentoActivo = null;
    this.documentPreview.cerrar();
  }

  abrirEnDrive(url?: string | null): void {
    const destino = url
      || this.documentoActivo?.webViewLink
      || (this.carpetaActualId ? `https://drive.google.com/drive/folders/${this.carpetaActualId}` : '')
      || this.seleccionado?.webViewLink
      || this.carpetaUrl;
    if (!destino) return;
    window.open(destino, '_blank', 'noopener,noreferrer');
  }

  abrirDialogoNuevaCarpeta(): void {
    this.mostrarReescribir = false;
    this.nombreNuevaCarpeta = '';
    this.mostrarNuevaCarpeta = true;
  }

  abrirReescribirDocumentos(): void {
    if (!this.puedeReescribirDocumentos) return;
    this.mostrarNuevaCarpeta = false;
    const lista = this.archivos.length ? this.archivos : this.archivosFiltrados;
    if (!lista.length) {
      this.errorCarga = 'No hay archivos en esta carpeta para reescribir.';
      return;
    }
    this.errorCarga = '';
    this.filasReescribir = this.construirFilasReescribir(lista);
    this.mostrarReescribir = true;
    this.persistirBorradorReescritura();
  }

  cerrarPanelReescritura(): void {
    this.mostrarReescribir = false;
    this.persistirBorradorReescritura();
  }

  trackByFilaReescribir(_index: number, fila: { id: string }): string {
    return fila.id;
  }

  filaEstaModificada(fila: { original: string; nombre: string }): boolean {
    return this.nombreBaseArchivo(fila.original) !== String(fila.nombre || '').trim();
  }

  private nombreBaseArchivo(nombre: string): string {
    return String(nombre || '').replace(/\.[^.]+$/, '');
  }

  private claveBorradorReescritura(): string | null {
    const colab = this.seleccionado?.id;
    const carpeta = this.carpetaActualId || this.seleccionado?.id;
    if (!colab || !carpeta) return null;
    return `biznaga.rrhh.rewrite:${colab}:${carpeta}`;
  }

  private leerBorradorReescritura(): { open?: boolean; nombres?: Record<string, string> } | null {
    const clave = this.claveBorradorReescritura();
    if (!clave) return null;
    try {
      const raw = localStorage.getItem(clave);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  persistirBorradorReescritura(): void {
    const clave = this.claveBorradorReescritura();
    if (!clave || !this.puedeReescribirDocumentos) return;
    const nombres: Record<string, string> = {};
    for (const fila of this.filasReescribir) {
      nombres[fila.id] = String(fila.nombre || '').trim();
    }
    try {
      localStorage.setItem(clave, JSON.stringify({
        open: this.mostrarReescribir,
        nombres
      }));
    } catch { /* ignore quota */ }
  }

  private borrarBorradorReescritura(): void {
    const clave = this.claveBorradorReescritura();
    if (!clave) return;
    try { localStorage.removeItem(clave); } catch { /* ignore */ }
  }

  private construirFilasReescribir(lista: ArchivoItem[]): Array<{ id: string; original: string; nombre: string }> {
    const drafts = this.leerBorradorReescritura()?.nombres || {};
    return lista.map((a) => ({
      id: a.id,
      original: a.nombre,
      nombre: drafts[a.id] != null && String(drafts[a.id]).trim()
        ? String(drafts[a.id]).trim()
        : this.nombreBaseArchivo(a.nombre)
    }));
  }

  private restaurarBorradorReescritura(): void {
    if (!this.puedeReescribirDocumentos || !this.archivos.length) return;
    const draft = this.leerBorradorReescritura();
    if (!draft) return;
    this.filasReescribir = this.construirFilasReescribir(this.archivos);
    if (draft.open) {
      this.mostrarNuevaCarpeta = false;
      this.mostrarReescribir = true;
    }
  }

  guardarReescrituraDocumentos(): void {
    if (!this.seleccionado || this.reescribiendo || !this.puedeReescribirDocumentos) return;
    const payload = this.filasReescribir
      .map((f) => ({ id: f.id, nombre: String(f.nombre || '').trim() }))
      .filter((f) => f.id && f.nombre);
    if (!payload.length) {
      this.errorCarga = 'Escribe al menos un nombre.';
      return;
    }
    this.reescribiendo = true;
    this.errorCarga = '';
    this.estadoOperacion = 'Actualizando nombres en Drive…';
    this.backend
      .reescribirRrhhColaboradorArchivos(this.seleccionado.id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.reescribiendo = false;
          this.estadoOperacion = '';
          this.mostrarReescribir = false;
          this.borrarBorradorReescritura();
          this.mensajeOk = res?.message || 'Nombres actualizados en Drive.';
          this.recargarContenido();
        },
        error: (err) => {
          this.reescribiendo = false;
          this.estadoOperacion = '';
          this.errorCarga = err?.error?.message || 'No se pudieron guardar los nombres en Drive.';
        }
      });
  }

  crearCarpeta(): void {
    if (!this.seleccionado || this.creandoCarpeta) return;
    const nombre = this.nombreNuevaCarpeta.trim();
    if (!nombre) {
      this.errorCarga = 'Escribe el nombre de la carpeta.';
      return;
    }
    this.creandoCarpeta = true;
    this.errorCarga = '';
    this.backend
      .crearRrhhColaboradorCarpeta(this.seleccionado.id, {
        nombre,
        parentId: this.carpetaActualId || this.seleccionado.id
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.creandoCarpeta = false;
          this.mostrarNuevaCarpeta = false;
          this.mensajeOk = res?.message || 'Carpeta creada.';
          this.recargarContenido();
        },
        error: (err) => {
          this.creandoCarpeta = false;
          this.errorCarga = err?.error?.message || 'No se pudo crear la carpeta.';
        }
      });
  }

  crearCarpetasSugeridas(): void {
    if (!this.seleccionado) return;
    this.creandoCarpeta = true;
    this.backend.crearRrhhColaboradorCarpetasSugeridas(this.seleccionado.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.creandoCarpeta = false;
        this.mensajeOk = res?.message || 'Carpetas listas.';
        this.cargarContenido(this.seleccionado!.id, this.seleccionado!.id, true);
      },
      error: (err) => {
        this.creandoCarpeta = false;
        this.errorCarga = err?.error?.message || 'No se pudieron crear las carpetas sugeridas.';
      }
    });
  }

  dispararSubida(): void {
    this.fileInput?.nativeElement?.click();
  }

  onArchivosSeleccionados(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input?.files || []);
    input.value = '';
    if (!files.length || !this.seleccionado) return;
    this.subirArchivos(files, this.carpetaActualId || this.seleccionado.id);
  }

  onDragOver(event: DragEvent, carpetaId?: string | null): void {
    event.preventDefault();
    event.stopPropagation();
    const tipos = Array.from(event.dataTransfer?.types || []);
    const esInterno = !!this.dragFileId || tipos.includes('application/x-rrhh-file') || tipos.includes('text/plain');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = esInterno && (carpetaId || this.dropOverRegresar) ? 'move' : 'copy';
    }
    if (carpetaId) {
      this.dropOverCarpetaId = carpetaId;
      this.dropOverBody = false;
      this.dropOverRegresar = false;
    } else {
      this.dropOverBody = true;
      this.dropOverRegresar = false;
    }
  }

  onDragOverRegresar(event: DragEvent): void {
    if (this.esRaizExpediente || !this.carpetaPadreId) return;
    event.preventDefault();
    event.stopPropagation();
    const tipos = Array.from(event.dataTransfer?.types || []);
    const esInterno = !!this.dragFileId || tipos.includes('application/x-rrhh-file') || tipos.includes('text/plain');
    if (!esInterno) return;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropOverRegresar = true;
    this.dropOverCarpetaId = null;
    this.dropOverBody = false;
  }

  onDragLeave(event: DragEvent, carpetaId?: string | null): void {
    event.preventDefault();
    event.stopPropagation();
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;
    if (related && current && current.contains(related)) {
      return;
    }
    if (carpetaId && this.dropOverCarpetaId === carpetaId) {
      this.dropOverCarpetaId = null;
    }
    if (!carpetaId) {
      this.dropOverBody = false;
    }
  }

  onDragLeaveRegresar(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as Node | null;
    if (related && current && current.contains(related)) return;
    this.dropOverRegresar = false;
  }

  onDrop(event: DragEvent, carpetaId?: string | null): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropOverCarpetaId = null;
    this.dropOverBody = false;
    this.dropOverRegresar = false;
    if (!this.seleccionado || this.uploadLock || this.subiendo || this.moviendo) return;

    const destinoId = carpetaId || this.carpetaActualId || this.seleccionado.id;
    const internoId = this.dragFileId
      || event.dataTransfer?.getData('application/x-rrhh-file')
      || event.dataTransfer?.getData('text/plain');

    // Arrastre interno: solo mover (nunca subir, evita duplicados)
    if (internoId && /^[a-zA-Z0-9_-]{10,}$/.test(internoId)) {
      this.dragFileId = null;
      this.moverArchivoInterno(internoId, destinoId);
      return;
    }

    // Si el arrastre salió de una tarjeta del expediente, no tratar files del SO
    if (this.dragFileId) {
      this.dragFileId = null;
      return;
    }

    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;

    const dedupKey = `${destinoId}|${files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join(',')}`;
    const ahora = Date.now();
    if (dedupKey === this.lastDropKey && ahora - this.lastDropAt < this.DROP_DEDUP_MS) {
      return;
    }
    this.lastDropKey = dedupKey;
    this.lastDropAt = ahora;
    this.subirArchivos(files, destinoId);
  }

  onDropRegresar(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dropOverRegresar = false;
    this.dropOverCarpetaId = null;
    this.dropOverBody = false;
    if (!this.seleccionado || this.esRaizExpediente || !this.carpetaPadreId || this.moviendo) return;

    const internoId = this.dragFileId
      || event.dataTransfer?.getData('application/x-rrhh-file')
      || event.dataTransfer?.getData('text/plain');
    this.dragFileId = null;
    if (internoId && /^[a-zA-Z0-9_-]{10,}$/.test(internoId)) {
      this.moverArchivoInterno(internoId, this.carpetaPadreId);
    }
  }

  onFileDragStart(event: DragEvent, doc: ArchivoItem): void {
    this.dragFileId = doc.id;
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/x-rrhh-file', doc.id);
    event.dataTransfer.setData('text/plain', doc.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  onFileDragEnd(): void {
    this.dragFileId = null;
    this.dropOverCarpetaId = null;
    this.dropOverBody = false;
    this.dropOverRegresar = false;
  }

  abrirMoverA(doc: ArchivoItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.carpetas.length) {
      this.errorCarga = 'No hay carpetas en este nivel. Crea una carpeta primero.';
      return;
    }
    this.archivoParaMover = doc;
  }

  confirmarMoverA(destinoId: string): void {
    if (!this.archivoParaMover || !destinoId) return;
    const id = this.archivoParaMover.id;
    this.archivoParaMover = null;
    this.moverArchivoInterno(id, destinoId);
  }

  cancelarMoverA(): void {
    this.archivoParaMover = null;
  }

  private moverArchivoInterno(itemId: string, destinoId: string): void {
    if (!this.seleccionado || this.moviendo) return;
    const carpetaActual = this.carpetaActualId || this.seleccionado.id;
    if (!destinoId || destinoId === itemId) return;
    if (destinoId === carpetaActual) {
      this.mensajeOk = 'El documento ya está en esta carpeta.';
      return;
    }
    const doc = this.archivos.find((a) => a.id === itemId);
    const nombre = doc?.nombre || 'documento';
    const destinoNombre = destinoId === this.carpetaPadreId
      ? this.carpetaPadreNombre
      : (this.carpetas.find((c) => c.id === destinoId)?.nombre
        || (destinoId === this.seleccionado.id ? 'Expediente' : 'la carpeta'));
    const nombreHtml = this.escapeHtml(nombre);
    const destinoHtml = this.escapeHtml(destinoNombre);

    this.archivos = this.archivos.filter((a) => a.id !== itemId);
    if (this.documentoActivo?.id === itemId) this.cerrarPreview();

    this.moviendo = true;
    this.errorCarga = '';
    this.mensajeOk = '';
    this.estadoOperacion = '';

    void Swal.fire({
      title: 'Moviendo archivo…',
      html: `<p class="mb-1">Se está pasando <strong>${nombreHtml}</strong></p>
             <div class="fm-alert-destino"><i class="fas fa-folder"></i> Destino: <strong>${destinoHtml}</strong></div>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'swal2-fm-alert swal2-fm-alert--rrhh' },
      didOpen: () => Swal.showLoading()
    });

    this.backend
      .moverRrhhColaboradorItem(this.seleccionado.id, itemId, destinoId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          this.moviendo = false;
          this.recargarContenido();
          await Swal.fire({
            icon: 'success',
            title: 'Archivo movido',
            html: `<p class="mb-1"><strong>${nombreHtml}</strong> se movió correctamente.</p>
                   <div class="fm-alert-destino"><i class="fas fa-check"></i> Destino: <strong>${destinoHtml}</strong></div>`,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#db2777',
            timer: 3200,
            timerProgressBar: true,
            customClass: { popup: 'swal2-fm-alert swal2-fm-alert--rrhh' }
          });
        },
        error: async (err) => {
          this.moviendo = false;
          this.recargarContenido();
          await Swal.fire({
            icon: 'error',
            title: 'No se pudo mover',
            text: err?.error?.message || 'No se pudo mover el documento.',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#db2777',
            customClass: { popup: 'swal2-fm-alert swal2-fm-alert--rrhh' }
          });
        }
      });
  }

  private escapeHtml(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private subirArchivos(files: File[], destinoId: string): void {
    if (!this.seleccionado || this.uploadLock) return;
    const validos = files.filter((f) => /\.(pdf|jpe?g|png|webp|gif)$/i.test(f.name) || f.type.startsWith('image/') || f.type === 'application/pdf');
    if (!validos.length) {
      this.errorCarga = 'Solo se permiten PDF, JPG o JPEG.';
      return;
    }

    this.uploadLock = true;
    this.subiendo = true;
    this.errorCarga = '';
    this.mensajeOk = '';
    const total = validos.length;
    let hechos = 0;
    this.estadoOperacion = total === 1
      ? `Subiendo «${validos[0].name}»…`
      : `Subiendo ${total} documento(s)…`;

    from(validos)
      .pipe(
        concatMap((file) => {
          this.estadoOperacion = `Subiendo «${file.name}» (${hechos + 1}/${total})…`;
          return this.backend.subirRrhhColaboradorArchivo(
            this.seleccionado!.id,
            file,
            destinoId
          ).pipe(catchError((err) => {
            this.errorCarga = err?.error?.message || `No se pudo subir ${file.name}`;
            return of(null);
          }));
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) hechos += 1;
        },
        complete: () => {
          this.subiendo = false;
          this.uploadLock = false;
          this.estadoOperacion = '';
          if (!this.errorCarga) {
            this.mensajeOk = hechos === 1
              ? 'Documento subido correctamente.'
              : `${hechos} documentos subidos correctamente.`;
          }
          const destinoDistinto = !!destinoId && destinoId !== this.carpetaActualId;
          if (destinoDistinto && !this.errorCarga && this.seleccionado) {
            this.cargarContenido(this.seleccionado.id, destinoId, true);
          } else {
            this.recargarContenido();
          }
        }
      });
  }

  eliminarItem(tipo: 'carpeta' | 'archivo', id: string, nombre: string, event?: Event): void {
    event?.stopPropagation();
    if (!this.seleccionado || this.moviendo) return;
    const label = tipo === 'carpeta' ? 'carpeta' : 'archivo';
    if (!confirm(`¿Quitar ${label} "${nombre}" del expediente?`)) return;
    this.errorCarga = '';
    this.mensajeOk = '';
    this.estadoOperacion = `Quitando «${nombre}»…`;
    this.backend.eliminarRrhhColaboradorItem(this.seleccionado.id, id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.estadoOperacion = '';
        this.mensajeOk = res?.message
          || (res?.modo === 'desvinculado'
            ? `«${nombre}» se quitó del expediente.`
            : `${label[0].toUpperCase()}${label.slice(1)} eliminado.`);
        if (this.documentoActivo?.id === id) this.cerrarPreview();
        this.recargarContenido();
      },
      error: (err) => {
        this.estadoOperacion = '';
        this.errorCarga = err?.error?.message || 'No se pudo eliminar.';
      }
    });
  }

  fechaCorta(valor?: string | null): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  iconoArchivo(doc: ArchivoItem): string {
    return doc.tipo === 'pdf' ? 'fas fa-file-pdf' : 'fas fa-file-image';
  }

  private cargarAvatares(): void {
    const ids = this.colaboradores
      .map((c) => c.fotoFileId)
      .filter((id): id is string => !!id && !this.avatares[id]);
    if (!ids.length) return;
    from(ids)
      .pipe(
        mergeMap((fileId) =>
          this.backend.miniaturaRrhhColaboradorArchivo(fileId).pipe(
            catchError(() => of(null)),
            concatMap((blob) => of({ fileId, blob }))
          ),
          6
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(({ fileId, blob }) => {
        if (!blob || blob.size < 20) return;
        this.revocarUrl(this.avatares[fileId]);
        this.avatares = { ...this.avatares, [fileId]: URL.createObjectURL(blob) };
      });
  }

  private encolarMiniaturas(docs: ArchivoItem[]): void {
    const loading = { ...this.miniaturasCargando };
    let encolados = 0;
    docs.forEach((d) => {
      if (this.miniaturas[d.id] || loading[d.id]) return;
      loading[d.id] = true;
      encolados += 1;
      this.miniaturaQueue$.next(d);
    });
    if (encolados) {
      this.miniaturasCargando = loading;
    }
  }

  private cargarMiniaturaDoc$(doc: ArchivoItem) {
    return this.backend.miniaturaRrhhColaboradorArchivo(doc.id).pipe(
      catchError(() => of(null)),
      concatMap((blob) => of({ fileId: doc.id, blob }))
    );
  }

  private revocarUrl(url?: string | null): void {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
