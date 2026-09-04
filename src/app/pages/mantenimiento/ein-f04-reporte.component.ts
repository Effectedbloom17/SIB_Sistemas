import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, SecurityContext, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { HttpEventType } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import {
  EIN_F04_META,
  EinF02Evidencia,
  EinF02Solicitud,
  EinF04TipoMantenimiento,
  areaDesdeRol,
  cargarSolicitudesLocal,
  crearSolicitudVacia,
  formatearFechaCorta,
  guardarSolicitudesLocal,
  puestoDesdeRol,
  sincronizarCasosDesdeForms
} from './ein-f02-solicitud.catalog';

const MAX_EVIDENCIAS = 20;

@Component({
  selector: 'app-ein-f04-reporte',
  templateUrl: './ein-f04-reporte.component.html',
  styleUrls: ['./ein-f02-solicitud.component.scss', './ein-f04-reporte.component.scss', './mantenimiento-drive.shared.scss']
})
export class EinF04ReporteComponent implements OnInit, OnDestroy {
  @Input() embebido = false;
  @Output() cerrar = new EventEmitter<void>();
  @ViewChild('inputEvidencias') inputEvidencias?: ElementRef<HTMLInputElement>;
  @ViewChild('inputPdfFirmado') inputPdfFirmado?: ElementRef<HTMLInputElement>;

  solicitudes: EinF02Solicitud[] = [];
  seleccionada: EinF02Solicitud | null = null;
  vista: 'archivero' | 'editor' = 'archivero';
  filtro = '';
  mensajeEstado = '';
  guardadoLocal = false;
  generandoReporte = false;
  subiendoEvidencias = false;
  progresoSubida = 0;
  arrastrandoFotos = false;
  sincronizandoForms = false;
  subiendoPdfFirmado = false;
  editorDriveAbierto = false;
  editorDriveCargando = false;
  editorDriveUrlSafe: SafeResourceUrl | '' = '';

  fotosPendientes: File[] = [];
  private previewPendientes = new Map<File, SafeUrl>();

  lightboxAbierto = false;
  lightboxUrl = '';
  lightboxNombre = '';

  readonly meta = EIN_F04_META;
  readonly tipos: EinF04TipoMantenimiento[] = ['Preventivo', 'Correctivo'];

  constructor(
    private auth: AuthService,
    private backend: BackendServices,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.cargar();
    this.sincronizarDesdeForms();

    const folioRoute = this.route.snapshot.paramMap.get('folio');
    const folioQuery = this.route.snapshot.queryParamMap.get('folio');

    if (folioQuery && this.embebido) {
      this.router.navigate(['/mantenimiento/reporte', folioQuery]);
      return;
    }

    if (folioRoute) {
      const open = () => {
        const found = this.solicitudes.find(s => s.folio === folioRoute);
        if (found) {
          this.abrirEditorLocal(found);
        }
      };
      open();
      setTimeout(open, 800);
    } else if (!this.embebido && this.route.snapshot.queryParamMap.get('nueva') === '1') {
      this.nuevoReporte();
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  ngOnDestroy(): void {
    this.limpiarPreviewsPendientes();
    this.setEditorBodyState(false);
  }

  get solicitudesForms(): EinF02Solicitud[] {
    return this.solicitudes.filter(s => !!String(s.formsResponseId || '').trim());
  }

  get solicitudesFiltradas(): EinF02Solicitud[] {
    const base = this.solicitudesForms;
    const q = this.filtro.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter(s =>
      [
        s.folio,
        s.nombreSolicitante,
        s.area,
        s.descripcionProblema,
        s.tipoMantenimiento,
        s.responsableMantenimiento,
        s.idSerie
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }

  get defaultsUsuario(): { nombreSolicitante: string; puesto: string; area: string } {
    const rol = this.auth.getRol() || '';
    return {
      nombreSolicitante: this.auth.getNombreCompleto(),
      puesto: puestoDesdeRol(rol),
      area: areaDesdeRol(rol)
    };
  }

  get totalEvidencias(): number {
    return this.seleccionada?.evidencias?.length || 0;
  }

  nuevoReporte(): void {
    const sol = crearSolicitudVacia(this.solicitudes, this.defaultsUsuario);
    this.solicitudes = [sol, ...this.solicitudes];
    this.persistir();
    this.abrirRegistro(sol);
    this.flash(`Nuevo reporte ${sol.folio}`);
  }

  /** Abre el reporte en página dedicada */
  abrirRegistro(sol: EinF02Solicitud): void {
    if (!sol?.folio) {
      return;
    }
    this.router.navigate(['/mantenimiento/reporte', sol.folio]);
  }

  abrirEditorLocal(sol: EinF02Solicitud): void {
    if (!Array.isArray(sol.evidencias)) {
      sol.evidencias = [];
    }
    this.limpiarFotosPendientes();
    this.seleccionada = sol;
    this.vista = 'editor';
  }

  /** @deprecated usar abrirRegistro */
  abrirEditor(sol: EinF02Solicitud): void {
    this.abrirRegistro(sol);
  }

  volverArchivero(): void {
    this.limpiarFotosPendientes();
    // Si estamos en ruta dedicada /reporte/:folio, volver al programa completo
    if (!this.embebido) {
      this.router.navigate(['/mantenimiento/programa-infraestructura'], {
        queryParams: { panel: 'reportes' }
      });
      return;
    }
    this.vista = 'archivero';
    this.seleccionada = null;
  }

  abrirEnPaginaCompleta(): void {
    if (!this.seleccionada?.folio) {
      return;
    }
    this.router.navigate(['/mantenimiento/reporte', this.seleccionada.folio]);
  }

  sincronizarDesdeForms(): void {
    this.sincronizandoForms = true;
    this.backend.obtenerEstadisticasFormsMantenimientoF02().subscribe({
      next: (res) => {
        this.sincronizandoForms = false;
        const casos = Array.isArray(res?.casos) ? res.casos : [];
        if (!casos.length) {
          return;
        }
        const { lista, nuevos, eliminados } = sincronizarCasosDesdeForms(this.solicitudes, casos);
        this.solicitudes = lista;
        this.persistir();
        if (this.seleccionada) {
          const refreshed = lista.find(s => s.id === this.seleccionada!.id);
          if (refreshed) {
            this.seleccionada = refreshed;
          } else {
            this.seleccionada = null;
            this.vista = 'archivero';
          }
        }
        const partes: string[] = [];
        if (nuevos) {
          partes.push(`${nuevos} nuevo(s)`);
        }
        if (eliminados) {
          partes.push(`${eliminados} obsoleto(s) retirado(s)`);
        }
        if (partes.length) {
          this.flash(`Sync Forms: ${partes.join(' · ')}.`);
        }
      },
      error: () => {
        this.sincronizandoForms = false;
      }
    });
  }

  onSeleccionarPdfFirmado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.seleccionada) {
      return;
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      this.flash('Solo se acepta PDF.');
      return;
    }
    this.subiendoPdfFirmado = true;
    const folio = this.seleccionada.folio;
    this.backend.subirPdfFirmadoMantenimientoF04(folio, file).subscribe({
      next: (res) => {
        this.subiendoPdfFirmado = false;
        if (this.seleccionada && res?.pdf) {
          this.seleccionada.pdfFirmado = {
            driveFileId: res.pdf.driveFileId,
            nombreArchivo: res.pdf.nombreArchivo,
            webViewLink: res.pdf.webViewLink,
            fechaSubida: res.pdf.fechaSubida
          };
          this.onCampoChange();
          this.flash('PDF firmado subido a Drive.');
        }
      },
      error: (err) => {
        this.subiendoPdfFirmado = false;
        this.flash(err?.error?.message || 'No se pudo subir el PDF firmado.');
      }
    });
  }

  formatearFechaFirmado(iso?: string): string {
    if (!iso) {
      return '';
    }
    return formatearFechaCorta(iso.includes('T') ? iso.slice(0, 10) : iso) || iso;
  }

  onCampoChange(): void {
    if (!this.seleccionada) {
      return;
    }
    this.seleccionada.actualizadoEn = new Date().toISOString();
    this.persistir();
  }

  guardarInformacionF04(): void {
    if (this.editorDriveAbierto) {
      this.flash('Cierra el editor integrado antes de guardar en Drive.');
      return;
    }
    if (!this.seleccionada) {
      return;
    }
    const sol = this.seleccionada;
    if (!sol.tipoMantenimiento) {
      sol.tipoMantenimiento = 'Correctivo';
    }
    if (!sol.fechaRealizado?.trim()) {
      this.flash('Indica la fecha en que se realizó el mantenimiento.');
      return;
    }
    if (!sol.responsableMantenimiento?.trim()) {
      this.flash('Indica el responsable que realizó el mantenimiento.');
      return;
    }
    this.onCampoChange();
    this.generandoReporte = true;
    this.backend.generarReporteMantenimientoF04(sol.folio, this.payloadReporteF04(sol)).subscribe({
      next: (res) => {
        this.generandoReporte = false;
        const reporte = res?.reporte;
        if (reporte?.driveFileId) {
          sol.reporteDriveFileId = reporte.driveFileId;
          sol.reporteWebViewLink = reporte.webViewLink || sol.reporteWebViewLink;
          this.persistir();
        }
        this.flash('Información guardada en Word/Drive.');
      },
      error: (err) => {
        this.generandoReporte = false;
        this.flash(err?.error?.message || 'No se pudo guardar en Drive.');
      }
    });
  }

  private payloadReporteF04(sol: EinF02Solicitud): Record<string, unknown> {
    return {
      descripcionMantenimientoRealizado: sol.descripcionMantenimientoRealizado,
      evidencias: sol.evidencias || [],
      tipoMantenimiento: sol.tipoMantenimiento,
      fechaSolicitud: sol.fechaSolicitud,
      fechaRealizado: sol.fechaRealizado,
      responsable: sol.responsableMantenimiento,
      nombreSolicitante: sol.nombreSolicitante,
      nombreArchivo: sol.folio,
      reporteDriveFileId: sol.reporteDriveFileId
    };
  }

  abrirSelectorEvidencias(): void {
    if (this.subiendoEvidencias) {
      return;
    }
    this.inputEvidencias?.nativeElement?.click();
  }

  onDragOverFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = true;
  }

  onDragLeaveFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = false;
  }

  onDropFotos(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrastrandoFotos = false;
    if (this.subiendoEvidencias) {
      return;
    }
    this.agregarFotosPendientes(Array.from(event.dataTransfer?.files || []));
  }

  onEvidenciasSeleccionadas(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    this.agregarFotosPendientes(files);
  }

  agregarFotosPendientes(files: File[]): void {
    const imagenes = files.filter(f => /^image\/(jpeg|png|webp)$/i.test(f.type));
    if (!imagenes.length) {
      this.flash('Solo se permiten imágenes JPG, PNG o WebP.');
      return;
    }
    const yaSubidas = this.seleccionada?.evidencias?.length || 0;
    let capacidad = MAX_EVIDENCIAS - yaSubidas - this.fotosPendientes.length;
    if (capacidad <= 0) {
      this.flash(`Máximo ${MAX_EVIDENCIAS} evidencias por reporte.`);
      return;
    }
    const keys = new Set(this.fotosPendientes.map(f => `${f.name}__${f.size}__${f.lastModified}`));
    for (const file of imagenes) {
      if (capacidad <= 0) {
        break;
      }
      const key = `${file.name}__${file.size}__${file.lastModified}`;
      if (keys.has(key)) {
        continue;
      }
      this.fotosPendientes.push(file);
      keys.add(key);
      capacidad -= 1;
    }
  }

  quitarFotoPendiente(index: number): void {
    const foto = this.fotosPendientes[index];
    if (foto) {
      this.limpiarPreviewFoto(foto);
    }
    this.fotosPendientes.splice(index, 1);
  }

  limpiarFotosPendientes(): void {
    this.limpiarPreviewsPendientes();
    this.fotosPendientes = [];
  }

  getFotoPreview(foto: File): SafeUrl {
    const existing = this.previewPendientes.get(foto);
    if (existing) {
      return existing;
    }
    const url = this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(foto));
    this.previewPendientes.set(foto, url);
    return url;
  }

  formatearTamano(bytes: number): string {
    if (!bytes || bytes <= 0) {
      return '0 B';
    }
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) {
      return `${(bytes / mb).toFixed(2)} MB`;
    }
    return `${Math.ceil(bytes / kb)} KB`;
  }

  subirFotosPendientes(): void {
    if (!this.seleccionada || this.subiendoEvidencias || !this.fotosPendientes.length) {
      return;
    }
    this.subiendoEvidencias = true;
    this.progresoSubida = 0;
    const folio = this.seleccionada.folio;
    const lote = [...this.fotosPendientes];

    this.backend.subirEvidenciasMantenimiento(folio, lote).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total || 0;
          this.progresoSubida = total
            ? Math.min(99, Math.round((100 * event.loaded) / total))
            : Math.min(90, this.progresoSubida + 5);
          return;
        }
        if (event.type === HttpEventType.Response) {
          this.progresoSubida = 100;
          this.subiendoEvidencias = false;
          const res = (event.body || {}) as { evidencias?: EinF02Evidencia[] };
          const nuevas: EinF02Evidencia[] = Array.isArray(res.evidencias) ? res.evidencias : [];
          if (this.seleccionada && this.seleccionada.folio === folio) {
            this.seleccionada.evidencias = [...(this.seleccionada.evidencias || []), ...nuevas];
            this.onCampoChange();
          }
          this.limpiarFotosPendientes();
          this.flash(nuevas.length === 1 ? 'Evidencia subida.' : `${nuevas.length} evidencias subidas.`);
          setTimeout(() => {
            this.progresoSubida = 0;
          }, 800);
        }
      },
      error: (err) => {
        this.subiendoEvidencias = false;
        this.progresoSubida = 0;
        this.flash(err?.error?.message || 'No se pudieron subir las evidencias.');
      }
    });
  }

  urlPreviewEvidencia(ev: EinF02Evidencia): string {
    if (ev.driveFileId) {
      return this.backend.obtenerUrlDrivePreview(ev.driveFileId);
    }
    return ev.url || '';
  }

  urlHrefEvidencia(ev: EinF02Evidencia): string {
    return ev.webViewLink || ev.url || (ev.driveFileId
      ? `https://drive.google.com/file/d/${ev.driveFileId}/view`
      : '#');
  }

  abrirLightbox(ev: EinF02Evidencia): void {
    this.lightboxUrl = this.urlPreviewEvidencia(ev);
    this.lightboxNombre = ev.nombre || 'Evidencia';
    this.lightboxAbierto = true;
  }

  cerrarLightbox(): void {
    this.lightboxAbierto = false;
    this.lightboxUrl = '';
    this.lightboxNombre = '';
  }

  quitarEvidencia(ev: EinF02Evidencia): void {
    if (!this.seleccionada || !ev?.driveFileId) {
      return;
    }
    this.backend.eliminarEvidenciaMantenimiento(ev.driveFileId).subscribe({
      next: () => this.quitarLocal(ev),
      error: () => this.quitarLocal(ev)
    });
  }

  abrirEditorIntegradoF04(sol?: EinF02Solicitud, event?: Event): void {
    event?.stopPropagation();
    const target = sol || this.seleccionada;
    if (!target) {
      return;
    }
    if (!target.descripcionMantenimientoRealizado?.trim()) {
      this.flash('Completa la breve descripción del mantenimiento realizado.');
      return;
    }
    if (!target.tipoMantenimiento) {
      target.tipoMantenimiento = 'Correctivo';
    }
    if (!target.fechaRealizado?.trim() || !target.responsableMantenimiento?.trim()) {
      this.flash('Indica fecha realizada y responsable antes de abrir el Word.');
      return;
    }

    if (target.reporteWebViewLink || target.reporteDriveFileId) {
      this.mostrarEditorIntegradoF04(target);
      return;
    }

    this.generandoReporte = true;
    this.backend.generarReporteMantenimientoF04(target.folio, this.payloadReporteF04(target)).subscribe({
      next: (res) => {
        this.generandoReporte = false;
        const reporte = res?.reporte;
        if (reporte?.driveFileId) {
          target.reporteDriveFileId = reporte.driveFileId;
          target.reporteWebViewLink = reporte.webViewLink;
          this.persistir();
        }
        this.mostrarEditorIntegradoF04(target);
      },
      error: (err) => {
        this.generandoReporte = false;
        this.flash(err?.error?.message || 'No se pudo generar el Word en Drive.');
      }
    });
  }

  cerrarEditorIntegradoF04(): void {
    this.editorDriveAbierto = false;
    this.editorDriveCargando = false;
    this.editorDriveUrlSafe = '';
    this.setEditorBodyState(false);
  }

  onEditorIframeLoadF04(): void {
    this.editorDriveCargando = false;
  }

  private actualizarEditorDriveUrlF04(url: string): void {
    const next = String(url || '').trim();
    if (!next) {
      this.editorDriveUrlSafe = '';
      return;
    }
    const current = this.editorDriveUrlSafe
      ? (this.editorDriveUrlSafe as { changingThisBreaksApplicationSecurity?: string }).changingThisBreaksApplicationSecurity
      : '';
    if (current === next) {
      return;
    }
    this.editorDriveUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(next);
  }

  private setEditorBodyState(abierto: boolean): void {
    document.body.classList.toggle('mt-drive-editor-open', abierto);
    document.body.style.overflow = abierto ? 'hidden' : '';
  }

  private mostrarEditorIntegradoF04(sol: EinF02Solicitud): void {
    const url = sol.reporteWebViewLink ||
      (sol.reporteDriveFileId
        ? `https://docs.google.com/document/d/${sol.reporteDriveFileId}/edit?usp=sharing`
        : '');
    if (!url) {
      this.flash('No se pudo abrir el editor integrado.');
      return;
    }
    this.actualizarEditorDriveUrlF04(url);
    this.editorDriveCargando = true;
    this.setEditorBodyState(true);
    this.editorDriveAbierto = true;
  }

  descargarPdfF04(): void {
    if (this.editorDriveAbierto) {
      this.flash('Cierra el editor integrado antes de descargar el PDF.');
      return;
    }
    if (!this.seleccionada) {
      return;
    }
    const sol = this.seleccionada;
    if (!sol.descripcionMantenimientoRealizado?.trim()) {
      this.flash('Falta la breve descripción del mantenimiento realizado.');
      return;
    }
    if (!sol.tipoMantenimiento) {
      sol.tipoMantenimiento = 'Correctivo';
    }
    if (!sol.fechaRealizado?.trim()) {
      this.flash('Indica la fecha en que se realizó el mantenimiento.');
      return;
    }
    if (!sol.responsableMantenimiento?.trim()) {
      this.flash('Indica el responsable que realizó el mantenimiento.');
      return;
    }

    this.onCampoChange();
    this.generandoReporte = true;
    this.backend.descargarPdfReporteMantenimientoF04(sol.folio, this.payloadReporteF04(sol)).subscribe({
      next: (res) => {
        this.generandoReporte = false;
        const blob = res.body;
        if (!blob) {
          this.flash('No se recibió el PDF.');
          return;
        }
        const driveId = res.headers.get('X-Reporte-Drive-Id');
        const webLink = res.headers.get('X-Reporte-WebViewLink');
        if (driveId) {
          sol.reporteDriveFileId = driveId;
        }
        if (webLink) {
          sol.reporteWebViewLink = webLink;
        }
        if (driveId || webLink) {
          this.persistir();
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `EIN-F-04 ${sol.folio}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        this.flash('PDF descargado.');
      },
      error: async (err) => {
        this.generandoReporte = false;
        let msg = 'No se pudo generar el PDF.';
        if (err?.error instanceof Blob) {
          try {
            const text = await err.error.text();
            const parsed = JSON.parse(text);
            msg = parsed?.message || msg;
          } catch {
            /* ignore */
          }
        } else if (err?.error?.message) {
          msg = err.error.message;
        }
        this.flash(msg);
      }
    });
  }

  /** @deprecated usar descargarPdfF04 */
  generarReporteF04(): void {
    this.descargarPdfF04();
  }

  eliminarReporte(sol: EinF02Solicitud, event?: Event): void {
    event?.stopPropagation();
    this.solicitudes = this.solicitudes.filter(s => s.id !== sol.id);
    if (this.seleccionada?.id === sol.id) {
      this.volverArchivero();
    }
    this.persistir();
    this.flash('Registro eliminado.');
  }

  irABitacoraF03(_sol?: EinF02Solicitud): void {
    this.router.navigate(['/mantenimiento/programa-infraestructura'], {
      queryParams: { panel: 'bitacora' }
    });
  }

  irAPrograma(): void {
    if (this.embebido) {
      this.vista = 'archivero';
      this.seleccionada = null;
      this.cerrar.emit();
      return;
    }
    this.router.navigate(['/mantenimiento/programa-infraestructura'], {
      queryParams: { panel: 'reportes' }
    });
  }

  formatearFecha(iso: string): string {
    return formatearFechaCorta(iso);
  }

  trackBySol(_: number, s: EinF02Solicitud): string {
    return s.id;
  }

  trackByEv(_: number, e: EinF02Evidencia): string {
    return e.driveFileId;
  }

  trackByFile(_: number, f: File): string {
    return `${f.name}__${f.size}__${f.lastModified}`;
  }

  private quitarLocal(ev: EinF02Evidencia): void {
    if (!this.seleccionada) {
      return;
    }
    this.seleccionada.evidencias = (this.seleccionada.evidencias || []).filter(
      e => e.driveFileId !== ev.driveFileId
    );
    this.onCampoChange();
    this.flash('Evidencia eliminada.');
  }

  private limpiarPreviewFoto(foto: File): void {
    const preview = this.previewPendientes.get(foto);
    if (preview) {
      const previewUrl = this.sanitizer.sanitize(SecurityContext.URL, preview);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      this.previewPendientes.delete(foto);
    }
  }

  private limpiarPreviewsPendientes(): void {
    this.previewPendientes.forEach((_, foto) => this.limpiarPreviewFoto(foto));
    this.previewPendientes.clear();
  }

  private cargar(): void {
    this.solicitudes = cargarSolicitudesLocal();
    this.guardadoLocal = this.solicitudes.length > 0;
  }

  private persistir(): void {
    this.guardadoLocal = guardarSolicitudesLocal(this.solicitudes);
    if (!this.guardadoLocal) {
      this.flash('No se pudo guardar localmente.');
    }
  }

  private flash(msg: string): void {
    this.mensajeEstado = msg;
    setTimeout(() => {
      if (this.mensajeEstado === msg) {
        this.mensajeEstado = '';
      }
    }, 2800);
  }
}

