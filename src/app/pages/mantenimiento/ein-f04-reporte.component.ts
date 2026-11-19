import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, SecurityContext, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { HttpEventType } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { UploadSourceChooserService } from 'src/app/services/upload-source-chooser.service';
import {
  EIN_F04_META,
  EinF02Evidencia,
  EinF02Solicitud,
  EinF04TipoMantenimiento,
  areaDesdeRol,
  cargarSolicitudesLocal,
  conservarReportesManuales,
  crearSolicitudVacia,
  encontrarSolicitudPorClave,
  esRegistroForms,
  formatearFechaCorta,
  fusionarSolicitudes,
  guardarSolicitudesLocal,
  puestoDesdeRol,
  sincronizarCasosDesdeForms,
  soloActivos
} from './ein-f02-solicitud.catalog';
import { EinF04WordImportResult, importarEinF04DesdeDocx } from './ein-f04-word-import';
import {
  EinF04PptxImportPack,
  importarEinF04DesdePptx,
  liberarPreviewsPptx
} from './ein-f04-pptx-import';

/** Alineado con el límite de multer en backend (`evidencias`, 12). */
const MAX_EVIDENCIAS = 12;

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
  @ViewChild('inputWordImport') inputWordImport?: ElementRef<HTMLInputElement>;
  @ViewChild('inputFormatoImport') inputFormatoImport?: ElementRef<HTMLInputElement>;
  @ViewChild('inputPptxImport') inputPptxImport?: ElementRef<HTMLInputElement>;
  @ViewChild('pptxWizardRoot') pptxWizardRoot?: ElementRef<HTMLElement>;

  solicitudes: EinF02Solicitud[] = [];
  seleccionada: EinF02Solicitud | null = null;
  vista: 'archivero' | 'editor' = 'archivero';
  filtro = '';
  mensajeEstado = '';
  guardadoLocal = false;
  generandoReporte = false;
  importandoWord = false;
  importandoFormatos = false;
  pptxWizard: EinF04PptxImportPack | null = null;
  pptxSlideActiva = 0;
  /** blob: URLs requieren bypass; Angular las marca unsafe en [src]. */
  private pptxPreviewSafe = new Map<string, SafeUrl>();
  private fotosImportPorSolicitud = new Map<string, File[]>();
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
  /** Hash del payload sincronizado en Word/Drive por folio (para detectar cambios sin guardar). */
  private hashesGuardadosDrive = new Map<string, string>();
  private syncServidorTimer: ReturnType<typeof setTimeout> | null = null;
  private claveAbrirPendiente: string | null = null;
  /** Evita que Forms recree vacíos antes de recuperar lo del servidor. */
  private catalogoServidorListo = false;
  /** Reintentos de anclar scroll arriba tras autosize / llegada de datos. */
  private scrollArribaTimers: ReturnType<typeof setTimeout>[] = [];
  /** Marca de tiempo al abrir el editor; sirve para re-anclar tras sync del servidor. */
  private editorAbiertoEn = 0;

  lightboxAbierto = false;
  lightboxUrl = '';
  lightboxNombre = '';
  /** Incrementar al abrir/editar para que el textarea de descripción se ajuste al contenido. */
  descripcionAutosizeTick = 0;

  readonly meta = EIN_F04_META;
  readonly tipos: EinF04TipoMantenimiento[] = ['Preventivo', 'Correctivo'];

  constructor(
    private auth: AuthService,
    private backend: BackendServices,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private uploadSourceChooser: UploadSourceChooserService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cargar();
    this.cargarUsuariosSistema();

    const folioRoute = this.route.snapshot.paramMap.get('folio');
    const folioQuery = this.route.snapshot.queryParamMap.get('folio');
    const idQuery = this.route.snapshot.queryParamMap.get('id');

    if ((folioQuery || idQuery) && this.embebido) {
      this.router.navigate(['/mantenimiento/reporte', idQuery || folioQuery]);
      return;
    }

    if (folioRoute) {
      this.claveAbrirPendiente = folioRoute;
      this.scrollAlInicio();
      this.intentarAbrirPorClave(folioRoute);
      setTimeout(() => {
        if (!this.destruido) {
          this.intentarAbrirPorClave(folioRoute);
        }
      }, 900);
    } else if (!this.embebido && this.route.snapshot.queryParamMap.get('nueva') === '1') {
      this.nuevoReporte();
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  /** True mientras se resuelve el folio de la URL y aún no hay editor. */
  get cargandoReportePorRuta(): boolean {
    return !this.embebido
      && !!this.claveAbrirPendiente
      && !(this.vista === 'editor' && this.seleccionada);
  }

  /** Perfiles con gestión de mantenimiento (sidebar EIN). */
  get puedeGestionarReportes(): boolean {
    return this.auth.tieneAlgunRol(['root', 'administrador', 'mantenimiento']);
  }

  /** Solo superadministrador puede borrar reportes del archivero. */
  get esSuperAdmin(): boolean {
    return this.auth.esRoot();
  }

  get slideWizardActiva() {
    return this.pptxWizard?.slides?.[this.pptxSlideActiva] || null;
  }

  get pptxSlidesIncluidas(): number {
    return (this.pptxWizard?.slides || []).filter(s => s.incluir).length;
  }

  private destruido = false;
  usuariosSistema: string[] = [];
  guiaSolicitanteAbierta = false;
  private guiaSolicitanteTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this.destruido = true;
    this.limpiarTimersScrollArriba();
    if (this.guiaSolicitanteTimer) {
      clearTimeout(this.guiaSolicitanteTimer);
      this.guiaSolicitanteTimer = null;
    }
    if (this.syncServidorTimer) {
      clearTimeout(this.syncServidorTimer);
      this.syncServidorTimer = null;
    }
    this.cerrarWizardPptx();
    this.limpiarPreviewsPendientes();
    this.setEditorBodyState(false);
  }

  get solicitudesForms(): EinF02Solicitud[] {
    return soloActivos(fusionarSolicitudes(this.solicitudes, [])).filter(s => esRegistroForms(s));
  }

  get solicitudesManuales(): EinF02Solicitud[] {
    return soloActivos(fusionarSolicitudes(this.solicitudes, [])).filter(s => !esRegistroForms(s));
  }

  get reportesActivosFiltrados(): EinF02Solicitud[] {
    return this.filtrarReportes(soloActivos(fusionarSolicitudes(this.solicitudes, [])));
  }

  /** Correctivos arriba en el archivero (incluye sin tipo). */
  get reportesCorrectivosFiltrados(): EinF02Solicitud[] {
    return this.reportesActivosFiltrados.filter(s => s.tipoMantenimiento !== 'Preventivo');
  }

  /** Preventivos abajo en el archivero. */
  get reportesPreventivosFiltrados(): EinF02Solicitud[] {
    return this.reportesActivosFiltrados.filter(s => s.tipoMantenimiento === 'Preventivo');
  }

  esDeForms(sol: EinF02Solicitud | null | undefined): boolean {
    return esRegistroForms(sol as EinF02Solicitud);
  }

  /** Descripción del problema (prioridad) para la tarjeta del archivero. */
  resumenTarjeta(s: EinF02Solicitud): string {
    const problema = String(s.descripcionProblema || '').trim();
    if (problema) {
      return problema;
    }
    const gestion = String(s.descripcionMantenimientoRealizado || '').trim();
    if (gestion) {
      return gestion;
    }
    const infra = String(s.tipoInfraestructura || s.ubicacion || '').trim();
    if (infra) {
      return infra;
    }
    return '';
  }

  get solicitantesGuia(): string[] {
    const q = String(this.seleccionada?.nombreSolicitante || '').trim().toLowerCase();
    const base = this.usuariosSistema;
    if (!q) {
      return base;
    }
    const filtrados = base.filter(nombre => nombre.toLowerCase().includes(q));
    return filtrados.length ? filtrados : base;
  }

  abrirGuiaSolicitante(): void {
    if (this.guiaSolicitanteTimer) {
      clearTimeout(this.guiaSolicitanteTimer);
      this.guiaSolicitanteTimer = null;
    }
    this.guiaSolicitanteAbierta = true;
  }

  cerrarGuiaSolicitante(): void {
    if (this.guiaSolicitanteTimer) {
      clearTimeout(this.guiaSolicitanteTimer);
    }
    this.guiaSolicitanteTimer = setTimeout(() => {
      this.guiaSolicitanteAbierta = false;
      this.guiaSolicitanteTimer = null;
    }, 160);
  }

  elegirSolicitante(nombre: string): void {
    if (!this.seleccionada) {
      return;
    }
    this.seleccionada.nombreSolicitante = nombre;
    this.guiaSolicitanteAbierta = false;
    this.onCampoChange();
  }

  private cargarUsuariosSistema(): void {
    this.backend.obtenerUsuarios().subscribe({
      next: (res: any) => {
        if (this.destruido) {
          return;
        }
        const lista = Array.isArray(res?.usuarios) ? res.usuarios : [];
        const nombres = new Set<string>();
        for (const u of lista) {
          const rol = String(u?.rol || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
          if (rol === 'empresa' || rol === 'usuario empresa') {
            continue;
          }
          const nombre = [u?.nombre, u?.apellido]
            .map((p: unknown) => String(p || '').trim())
            .filter(Boolean)
            .join(' ');
          if (nombre) {
            nombres.add(nombre);
          }
        }
        this.usuariosSistema = Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'));
      },
      error: () => {
        this.usuariosSistema = [];
      }
    });
  }

  private filtrarReportes(base: EinF02Solicitud[]): EinF02Solicitud[] {
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
        s.descripcionMantenimientoRealizado,
        s.tipoMantenimiento,
        s.tipoInfraestructura,
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

  /** Indica si la vista actual tiene cambios locales no reflejados en Word/Drive. */
  get tieneCambiosSinGuardarEnVista(): boolean {
    return !!this.seleccionada && this.tieneCambiosSinGuardarDrive(this.seleccionada);
  }

  nuevoReporte(): void {
    const sol = crearSolicitudVacia(this.solicitudes, this.defaultsUsuario);
    this.solicitudes = [sol, ...this.solicitudes];
    this.persistir();
    this.abrirRegistro(sol);
    this.flash(`Nuevo reporte ${sol.folio}`);
  }

  /** Abre el reporte en página dedicada (por id único; evita abrir otro con el mismo folio). */
  abrirRegistro(sol: EinF02Solicitud): void {
    const clave = sol?.id || sol?.folio;
    if (!clave) {
      return;
    }
    this.claveAbrirPendiente = clave;
    this.router.navigate(['/mantenimiento/reporte', clave]);
  }

  private intentarAbrirPorClave(clave: string): void {
    const found = encontrarSolicitudPorClave(soloActivos(this.solicitudes), clave);
    if (found) {
      this.abrirEditorLocal(found);
      if (found.id === this.claveAbrirPendiente || found.folio === this.claveAbrirPendiente) {
        this.claveAbrirPendiente = null;
      }
    }
  }

  abrirEditorLocal(sol: EinF02Solicitud): void {
    if (!Array.isArray(sol.evidencias)) {
      sol.evidencias = [];
    }
    // Deduplicar evidencias por driveFileId (evita contar/enviar la misma foto dos veces).
    sol.evidencias = this.deduplicarEvidencias(sol.evidencias);
    this.limpiarFotosPendientes();
    this.seleccionada = sol;
    this.vista = 'editor';
    const importadas = this.fotosImportPorSolicitud.get(sol.id);
    if (importadas?.length) {
      this.agregarFotosPendientes(importadas);
      this.fotosImportPorSolicitud.delete(sol.id);
    }
    this.descripcionAutosizeTick += 1;
    this.asegurarSnapshotDrive(sol);
    this.editorAbiertoEn = Date.now();
    // Anclar arriba al abrir: la info superior llega/asize después y si no, la lectura queda de abajo hacia arriba.
    this.scrollAlInicio(true);
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
    if (!this.seleccionada) {
      return;
    }
    this.abrirRegistro(this.seleccionada);
  }

  sincronizarDesdeForms(forzar = false): void {
    if (!forzar && !this.catalogoServidorListo) {
      // Esperar catálogo compartido para no recrear reportes vacíos encima de los llenos.
      return;
    }
    this.sincronizandoForms = true;
    this.backend.obtenerEstadisticasFormsMantenimientoF02().subscribe({
      next: (res) => {
        if (this.destruido) {
          return;
        }
        this.sincronizandoForms = false;
        const casos = Array.isArray(res?.casos) ? res.casos : [];
        if (!casos.length) {
          return;
        }
        const base = fusionarSolicitudes(
          this.inyectarSeleccionadaEnLista(
            conservarReportesManuales(this.solicitudes, cargarSolicitudesLocal())
          ),
          cargarSolicitudesLocal()
        );
        const { lista, nuevos, eliminados } = sincronizarCasosDesdeForms(base, casos);
        this.solicitudes = fusionarSolicitudes(lista, base);
        this.persistir();
        if (this.seleccionada) {
          if (this.seleccionada.activo !== false) {
            this.descripcionAutosizeTick += 1;
            if (this.vista === 'editor' && Date.now() - this.editorAbiertoEn < 2800) {
              this.scrollAlInicio(true);
            }
          } else {
            this.seleccionada = null;
            this.vista = 'archivero';
          }
        }
        if (this.claveAbrirPendiente) {
          this.intentarAbrirPorClave(this.claveAbrirPendiente);
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

  abrirSelectorWord(): void {
    if (this.importandoWord || this.importandoFormatos || this.generandoReporte || this.editorDriveAbierto) {
      return;
    }
    this.inputWordImport?.nativeElement?.click();
  }

  abrirSelectorPptx(): void {
    if (this.importandoWord || this.importandoFormatos || this.generandoReporte || this.editorDriveAbierto) {
      return;
    }
    this.inputPptxImport?.nativeElement?.click();
  }

  abrirSelectorFormatos(): void {
    if (this.importandoWord || this.importandoFormatos || this.generandoReporte) {
      return;
    }
    this.inputFormatoImport?.nativeElement?.click();
  }

  async onFormatoArchiveroSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0] || null;
    input.value = '';
    if (!archivo) {
      return;
    }
    const nombre = String(archivo.name || '').toLowerCase();
    if (nombre.endsWith('.pptx')
      || archivo.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      await this.abrirWizardPptx(archivo);
      return;
    }
    if (nombre.endsWith('.docx')
      || archivo.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      await this.importarWordComoNuevoReporte(archivo);
      return;
    }
    await Swal.fire({
      icon: 'warning',
      title: 'Formato no soportado',
      text: 'Selecciona un Word (.docx) o PowerPoint (.pptx).',
      confirmButtonColor: '#1e293b'
    });
  }

  async onPptxSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0] || null;
    input.value = '';
    if (!archivo) {
      return;
    }
    await this.abrirWizardPptx(archivo, !!this.seleccionada);
  }

  async onWordSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0] || null;
    input.value = '';
    if (!archivo || !this.seleccionada) {
      return;
    }
    await this.importarWordAlReporte(archivo);
  }

  cerrarWizardPptx(): void {
    this.setWizardBodyState(false);
    liberarPreviewsPptx(this.pptxWizard);
    this.pptxPreviewSafe.clear();
    this.pptxWizard = null;
    this.pptxSlideActiva = 0;
  }

  /** Previews del wizard PPTX (blob:) sanitizadas para <img [src]>. */
  previewPptx(src: string): SafeUrl {
    const key = String(src || '');
    const cached = this.pptxPreviewSafe.get(key);
    if (cached) {
      return cached;
    }
    const safe = this.sanitizer.bypassSecurityTrustUrl(key);
    this.pptxPreviewSafe.set(key, safe);
    return safe;
  }

  seleccionarSlideWizard(idx: number): void {
    if (!this.pptxWizard?.slides?.length) {
      return;
    }
    this.pptxSlideActiva = Math.max(0, Math.min(idx, this.pptxWizard.slides.length - 1));
  }

  toggleSlideIncluir(idx: number): void {
    const slide = this.pptxWizard?.slides?.[idx];
    if (slide) {
      slide.incluir = !slide.incluir;
    }
  }

  private async abrirWizardPptx(archivo: File, aplicarASeleccionado = false): Promise<void> {
    this.importandoFormatos = true;
    try {
      const pack = await importarEinF04DesdePptx(archivo);
      this.cerrarWizardPptx();
      this.pptxWizard = pack;
      this.pptxSlideActiva = Math.max(0, pack.slides.findIndex(s => s.incluir));
      // Sacarlo del stacking context de .mt-main-wrap (debajo del sidebar).
      this.cdr.detectChanges();
      this.attachWizardToBody();
      setTimeout(() => this.attachWizardToBody(), 50);
      if (aplicarASeleccionado && this.seleccionada && pack.slides.filter(s => s.incluir).length === 1) {
        const unica = pack.slides.find(s => s.incluir);
        if (unica) {
          const conf = await Swal.fire({
            icon: 'question',
            title: '¿Importar diapositiva?',
            text: 'Se aplicarán los datos de la única diapositiva útil al reporte actual.',
            showCancelButton: true,
            confirmButtonText: 'Importar',
            cancelButtonText: 'Revisar',
            confirmButtonColor: '#1e293b'
          });
          if (conf.isConfirmed) {
            this.aplicarParsedASolicitud(this.seleccionada, unica.parsed);
            this.cerrarWizardPptx();
            this.flash('Diapositiva importada al reporte.');
          }
        }
      }
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo leer el PowerPoint',
        text: err?.message || 'Revisa que el archivo sea un .pptx válido.',
        confirmButtonColor: '#1e293b'
      });
    } finally {
      this.importandoFormatos = false;
    }
  }

  async confirmarWizardPptx(): Promise<void> {
    if (!this.pptxWizard) {
      return;
    }
    const incluidas = this.pptxWizard.slides.filter(s => s.incluir);
    if (!incluidas.length) {
      this.flash('Marca al menos una diapositiva para importar.');
      return;
    }

    if (this.seleccionada && this.vista === 'editor' && incluidas.length === 1) {
      this.aplicarParsedASolicitud(this.seleccionada, incluidas[0].parsed);
      this.cerrarWizardPptx();
      this.flash('Diapositiva aplicada al reporte abierto.');
      return;
    }

    const creados: EinF02Solicitud[] = [];
    let lista = [...this.solicitudes];
    for (const slide of incluidas) {
      const sol = crearSolicitudVacia(lista, this.defaultsUsuario);
      this.aplicarParsedASolicitud(sol, slide.parsed, false);
      if (!sol.nombreSolicitante?.trim() && slide.parsed.nombreSolicitante) {
        sol.nombreSolicitante = slide.parsed.nombreSolicitante;
      }
      if (!sol.descripcionProblema?.trim() && slide.parsed.descripcionMantenimientoRealizado) {
        sol.descripcionProblema = slide.parsed.descripcionMantenimientoRealizado.slice(0, 280);
      }
      lista = [sol, ...lista];
      creados.push(sol);
    }
    this.solicitudes = lista;
    this.persistir();
    this.cerrarWizardPptx();

    await Swal.fire({
      icon: 'success',
      title: 'Formatos importados',
      html: `Se crearon <strong>${creados.length}</strong> reporte(s) desde el PowerPoint.`
        + '<br>Ábrelos en el archivero para revisarlos y guardar el Word en Drive.',
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#1e293b'
    });

    if (creados.length === 1 && !this.embebido) {
      this.abrirRegistro(creados[0]);
    } else {
      this.flash(`${creados.length} reporte(s) listos en el archivero.`);
    }
  }

  private async importarWordComoNuevoReporte(archivo: File): Promise<void> {
    this.importandoFormatos = true;
    try {
      const parsed = await importarEinF04DesdeDocx(archivo);
      const sol = crearSolicitudVacia(this.solicitudes, this.defaultsUsuario);
      this.aplicarParsedASolicitud(sol, parsed, false);
      if (parsed.nombreSolicitante) {
        sol.nombreSolicitante = parsed.nombreSolicitante;
      }
      if (!sol.descripcionProblema?.trim() && parsed.descripcionMantenimientoRealizado) {
        sol.descripcionProblema = parsed.descripcionMantenimientoRealizado.slice(0, 280);
      }
      this.solicitudes = [sol, ...this.solicitudes];
      this.persistir();
      await Swal.fire({
        icon: 'success',
        title: 'Word importado',
        html: `Se creó el reporte <strong>${sol.folio}</strong> con los datos del Word.`,
        confirmButtonText: 'Abrir',
        confirmButtonColor: '#1e293b'
      });
      this.abrirRegistro(sol);
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo importar',
        text: err?.message || 'Revisa que el archivo sea un .docx EIN-F-04 válido.',
        confirmButtonColor: '#1e293b'
      });
    } finally {
      this.importandoFormatos = false;
    }
  }

  private aplicarParsedASolicitud(
    sol: EinF02Solicitud,
    parsed: EinF04WordImportResult,
    conFotosPendientes = true
  ): void {
    if (parsed.tipoMantenimiento) {
      sol.tipoMantenimiento = parsed.tipoMantenimiento;
    }
    if (parsed.fechaSolicitud && !esRegistroForms(sol)) {
      sol.fechaSolicitud = parsed.fechaSolicitud;
    }
    if (parsed.fechaRealizado) {
      sol.fechaRealizado = parsed.fechaRealizado;
    }
    if (parsed.responsableMantenimiento) {
      sol.responsableMantenimiento = parsed.responsableMantenimiento;
    }
    if (parsed.descripcionMantenimientoRealizado) {
      sol.descripcionMantenimientoRealizado = parsed.descripcionMantenimientoRealizado;
    }
    if (parsed.nombreSolicitante && !esRegistroForms(sol) && !sol.nombreSolicitante?.trim()) {
      sol.nombreSolicitante = parsed.nombreSolicitante;
    }
    sol.actualizadoEn = new Date().toISOString();
    if (parsed.imagenes?.length) {
      if (conFotosPendientes && this.seleccionada?.id === sol.id) {
        this.agregarFotosPendientes(parsed.imagenes);
      } else {
        const prev = this.fotosImportPorSolicitud.get(sol.id) || [];
        this.fotosImportPorSolicitud.set(sol.id, [...prev, ...parsed.imagenes]);
      }
    }
    this.descripcionAutosizeTick += 1;
    if (this.seleccionada?.id === sol.id) {
      this.onCampoChange();
    }
  }

  private async importarWordAlReporte(archivo: File): Promise<void> {
    if (!this.seleccionada) {
      return;
    }
    const sol = this.seleccionada;
    const tieneDatos = !!(
      sol.descripcionMantenimientoRealizado?.trim()
      || sol.responsableMantenimiento?.trim()
      || sol.fechaRealizado?.trim()
      || sol.tipoMantenimiento
    );

    if (tieneDatos) {
      const conf = await Swal.fire({
        icon: 'question',
        title: '¿Importar Word?',
        html: 'Se reemplazarán los campos del reporte con lo leído del Word '
          + '(tipo, fechas, responsable y descripción). '
          + 'Las fotos del documento se agregarán como evidencias pendientes.',
        showCancelButton: true,
        confirmButtonText: 'Importar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1e293b'
      });
      if (!conf.isConfirmed) {
        return;
      }
    }

    this.importandoWord = true;
    try {
      const parsed = await importarEinF04DesdeDocx(archivo);
      this.aplicarParsedASolicitud(sol, parsed, true);

      const resumen = parsed.camposAplicados.join(', ');
      const avisoExtra = parsed.avisos.length
        ? `<br><small class="text-muted">${parsed.avisos.slice(0, 3).join(' · ')}</small>`
        : '';
      await Swal.fire({
        icon: parsed.avisos.length ? 'info' : 'success',
        title: 'Word importado',
        html: `Se aplicó: <strong>${resumen}</strong>.${avisoExtra}`
          + (parsed.imagenes.length
            ? `<br><br>${parsed.imagenes.length} imagen(es) listas como evidencia. Pulsa «Subir a Drive» si quieres guardarlas.`
            : ''),
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#1e293b'
      });
      this.flash('Información importada desde Word.');
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'No se pudo importar',
        text: err?.message || 'Revisa que el archivo sea un .docx EIN-F-04 válido.',
        confirmButtonColor: '#1e293b'
      });
    } finally {
      this.importandoWord = false;
    }
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
    // Persistir catálogo (BD) con el objeto vivo del editor; Drive es aparte.
    sol.actualizadoEn = new Date().toISOString();
    this.persistir(true);
    this.generandoReporte = true;
    const solViva = this.seleccionada?.id === sol.id ? this.seleccionada : sol;
    this.backend.generarReporteMantenimientoF04(solViva.folio, this.payloadReporteF04(solViva)).subscribe({
      next: (res) => {
        this.generandoReporte = false;
        const reporte = res?.reporte;
        const actual = this.seleccionada?.id === sol.id ? this.seleccionada : sol;
        const desdeCatalogo = res?.solicitud;
        if (desdeCatalogo && actual) {
          if (desdeCatalogo.reporteDriveFileId) {
            actual.reporteDriveFileId = desdeCatalogo.reporteDriveFileId;
          }
          if (desdeCatalogo.reporteWebViewLink) {
            actual.reporteWebViewLink = desdeCatalogo.reporteWebViewLink;
          }
        }
        if (reporte?.driveFileId) {
          actual.reporteDriveFileId = reporte.driveFileId;
          actual.reporteWebViewLink = reporte.webViewLink || actual.reporteWebViewLink;
          actual.actualizadoEn = new Date().toISOString();
          this.persistir(true);
          this.marcarSincronizadoDrive(actual);
        }
        this.flash('Información guardada en catálogo y Word/Drive.');
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
      descripcionProblema: sol.descripcionProblema,
      tipoInfraestructura: sol.tipoInfraestructura,
      evidencias: sol.evidencias || [],
      tipoMantenimiento: sol.tipoMantenimiento,
      fechaSolicitud: sol.fechaSolicitud,
      fechaRealizado: sol.fechaRealizado,
      responsable: sol.responsableMantenimiento,
      responsableMantenimiento: sol.responsableMantenimiento,
      nombreSolicitante: sol.nombreSolicitante,
      nombreArchivo: sol.folio,
      reporteDriveFileId: sol.reporteDriveFileId
    };
  }

  async abrirSelectorEvidencias(): Promise<void> {
    if (this.subiendoEvidencias) {
      return;
    }
    const origen = await this.uploadSourceChooser.elegir({
      titulo: '¿Cómo quieres agregar la evidencia?',
      subtitulo: 'Puedes elegir fotos de tu galería o pegar una imagen copiada.',
      etiquetaGaleria: 'Desde mi galería',
      etiquetaPegar: 'Pegar imagen'
    });
    if (!origen) {
      return;
    }
    if (origen === 'galeria') {
      this.inputEvidencias?.nativeElement?.click();
      return;
    }
    const files = await this.uploadSourceChooser.esperarPegado({
      titulo: 'Pega la evidencia',
      subtitulo: 'Copia una imagen y pégala con Ctrl+V.'
    });
    if (!files?.length) {
      return;
    }
    this.agregarFotosPendientes(files);
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

  onPasteFotos(files: File[]): void {
    if (this.subiendoEvidencias || !files?.length) {
      return;
    }
    this.agregarFotosPendientes(files);
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
            const combinadas = [...(this.seleccionada.evidencias || []), ...nuevas];
            this.seleccionada.evidencias = this.deduplicarEvidencias(combinadas).slice(0, MAX_EVIDENCIAS);
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

  async abrirEditorIntegradoF04(sol?: EinF02Solicitud, event?: Event): Promise<void> {
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

    target.evidencias = this.deduplicarEvidencias(target.evidencias || []);
    this.asegurarSnapshotDrive(target);

    const tieneWord = !!(target.reporteDriveFileId || target.reporteWebViewLink);
    if (!tieneWord) {
      await Swal.fire({
        icon: 'info',
        title: 'Word aún no generado',
        html: 'Usa <strong>Guardar información</strong> para generar el Word en Drive. '
          + 'El editor integrado solo abre el documento ya guardado; no sustituye ese botón.',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    if (this.tieneCambiosSinGuardarDrive(target)) {
      const result = await Swal.fire({
        icon: 'warning',
        title: 'Cambios sin guardar',
        html: 'Hay cambios en el sistema que <strong>no se han guardado</strong> con «Guardar información». '
          + 'El Word puede verse diferente a lo que muestra el sistema.<br><br>'
          + '¿Abrir el editor con la versión guardada en Drive?',
        showCancelButton: true,
        confirmButtonText: 'Abrir de todos modos',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
      });
      if (!result.isConfirmed) {
        return;
      }
    }

    this.mostrarEditorIntegradoF04(target);
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
    if (!document.body.classList.contains('mt-pptx-wizard-open')) {
      document.body.style.overflow = abierto ? 'hidden' : '';
    }
  }

  /** El modal vive dentro de .mt-main-wrap (z-index 5); hay que montarlo en body. */
  private attachWizardToBody(): void {
    const el = this.pptxWizardRoot?.nativeElement;
    if (!el || !this.pptxWizard) {
      return;
    }
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
    // Inline por si el encapsulado no aplica al mover el nodo (sidebar z-index 1050).
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '100050';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    this.setWizardBodyState(true);
  }

  private setWizardBodyState(abierto: boolean): void {
    document.body.classList.toggle('mt-pptx-wizard-open', abierto);
    if (abierto) {
      document.body.style.overflow = 'hidden';
      return;
    }
    if (!document.body.classList.contains('mt-drive-editor-open')) {
      document.body.style.overflow = '';
    }
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
    this.editorDriveCargando = true;
    this.setEditorBodyState(true);
    this.editorDriveAbierto = true;
    this.editorDriveUrlSafe = '';
    const fileId = String(sol.reporteDriveFileId || '').trim();
    const montar = () => {
      if (!this.editorDriveAbierto) return;
      this.actualizarEditorDriveUrlF04(url);
    };
    if (!fileId) {
      montar();
      return;
    }
    this.backend.asegurarAccesoEditorDrive(fileId).subscribe({
      next: () => montar(),
      error: () => montar()
    });
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
          this.marcarSincronizadoDrive(sol);
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

  async eliminarReporte(sol: EinF02Solicitud, event?: Event): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    if (!sol || !this.esSuperAdmin) {
      return;
    }
    const tipo = sol.tipoMantenimiento === 'Preventivo' ? 'preventivo' : 'correctivo';
    const result = await Swal.fire({
      icon: 'warning',
      title: '¿Ocultar formato?',
      html:
        `Se ocultará el reporte <strong>${tipo}</strong> del archivero y de la bitácora F-03.`
        + '<br><small>Solo superadministrador puede hacer esto.</small>',
      showCancelButton: true,
      confirmButtonText: 'Ocultar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b45309',
      reverseButtons: true
    });
    if (!result.isConfirmed) {
      return;
    }
    sol.activo = false;
    sol.actualizadoEn = new Date().toISOString();
    const disco = cargarSolicitudesLocal().map(s =>
      s.id === sol.id ? { ...s, activo: false, actualizadoEn: sol.actualizadoEn } : s
    );
    if (!disco.some(s => s.id === sol.id)) {
      disco.push({ ...sol, activo: false });
    }
    // Conservar también otros ocultos/llenos del disco al persistir.
    const fusionDisco = fusionarSolicitudes(disco, this.solicitudes.map(s =>
      s.id === sol.id ? { ...s, activo: false, actualizadoEn: sol.actualizadoEn } : s
    ));
    guardarSolicitudesLocal(fusionDisco);
    this.solicitudes = fusionDisco;
    this.guardadoLocal = true;
    this.backend.desactivarSolicitudMantenimiento(sol.id).subscribe({
      error: () => {
        /* local ya quedó desactivado; el próximo sync reintentará */
      }
    });
    if (this.seleccionada?.id === sol.id) {
      this.volverArchivero();
    }
    window.dispatchEvent(new CustomEvent('biznaga:ein-f02:cambio', {
      detail: { eliminadoId: sol.id, desactivadoId: sol.id }
    }));
    this.flash('Formato oculto del archivero.');
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

  private deduplicarEvidencias(lista: EinF02Evidencia[]): EinF02Evidencia[] {
    const out: EinF02Evidencia[] = [];
    const keys = new Set<string>();
    for (const ev of lista || []) {
      const key = String(ev?.driveFileId || ev?.url || ev?.webViewLink || '').trim();
      if (!key || keys.has(key)) {
        continue;
      }
      keys.add(key);
      out.push(ev);
    }
    return out;
  }

  private hashPayloadDrive(sol: EinF02Solicitud): string {
    const payload = this.payloadReporteF04(sol);
    try {
      return JSON.stringify(payload);
    } catch {
      return String(Date.now());
    }
  }

  private marcarSincronizadoDrive(sol: EinF02Solicitud): void {
    if (!sol?.folio) {
      return;
    }
    this.hashesGuardadosDrive.set(sol.folio, this.hashPayloadDrive(sol));
  }

  private asegurarSnapshotDrive(sol: EinF02Solicitud): void {
    if (!sol?.folio || this.hashesGuardadosDrive.has(sol.folio)) {
      return;
    }
    // Si ya existe Word en Drive, asumir sincronizado hasta que el usuario edite.
    if (sol.reporteDriveFileId || sol.reporteWebViewLink) {
      this.marcarSincronizadoDrive(sol);
    }
  }

  private tieneCambiosSinGuardarDrive(sol: EinF02Solicitud): boolean {
    if (!sol?.folio) {
      return false;
    }
    const prev = this.hashesGuardadosDrive.get(sol.folio);
    if (prev == null) {
      return false;
    }
    return prev !== this.hashPayloadDrive(sol);
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
    // Incluye inactivos en memoria para que Forms no los vuelva a crear.
    this.solicitudes = fusionarSolicitudes([], cargarSolicitudesLocal());
    this.guardadoLocal = this.solicitudes.length > 0;
    this.cargarDesdeServidor();
  }

  private cargarDesdeServidor(): void {
    this.backend.listarSolicitudesMantenimiento(true).subscribe({
      next: (res) => {
        if (this.destruido) {
          return;
        }
        const remoto = Array.isArray(res?.solicitudes) ? res.solicitudes : [];
        // Incluye ediciones vivas del editor para que el remoto vacío no las borre.
        const local = this.inyectarSeleccionadaEnLista(
          conservarReportesManuales(this.solicitudes, cargarSolicitudesLocal())
        );
        const fusion = fusionarSolicitudes(local, remoto);
        this.solicitudes = fusion;
        this.reasignarSeleccionadaTrasFusion();
        this.guardadoLocal = guardarSolicitudesLocal(this.solicitudes);
        this.catalogoServidorListo = true;
        this.desactivarDuplicadosForms(remoto, fusion);
        const pendientesSubir = soloActivos(fusion).filter(s =>
          !remoto.some((r: any) => r?.id === s.id)
        );
        if (pendientesSubir.length) {
          this.programarSyncServidor(true);
        }
        if (this.claveAbrirPendiente) {
          this.intentarAbrirPorClave(this.claveAbrirPendiente);
        } else if (this.seleccionada && this.vista === 'editor') {
          this.descripcionAutosizeTick += 1;
          // Si el catálogo llegó justo al abrir, re-anclar para no quedar a media página.
          if (Date.now() - this.editorAbiertoEn < 2800) {
            this.scrollAlInicio(true);
          }
        }
        this.sincronizarDesdeForms(true);
      },
      error: () => {
        /* sin servidor: se sigue con localStorage y luego Forms */
        this.catalogoServidorListo = true;
        this.sincronizarDesdeForms(true);
      }
    });
  }

  /** Oculta en BD cascarones vacíos de Forms que duplicaban un reporte ya gestionado. */
  private desactivarDuplicadosForms(remoto: any[], fusion: EinF02Solicitud[]): void {
    const kept = new Set(fusion.map(s => s.id));
    const formsKept = new Set(
      fusion
        .map(s => String(s.formsResponseId || '').trim())
        .filter(Boolean)
    );
    for (const raw of remoto || []) {
      const id = String(raw?.id || '').trim();
      const rid = String(raw?.formsResponseId || '').trim();
      if (!id || !rid || kept.has(id) || !formsKept.has(rid)) {
        continue;
      }
      if (raw?.activo === false || raw?.activo === 0) {
        continue;
      }
      this.backend.desactivarSolicitudMantenimiento(id).subscribe({ error: () => { /* silent */ } });
    }
  }

  /**
   * `fusionarSolicitudes` clona objetos; si no reinyectamos `seleccionada`,
   * el editor sigue mutando una copia huérfana y el catálogo/BD nunca reciben
   * los cambios (Drive sí, porque lee el objeto vivo).
   */
  private inyectarSeleccionadaEnLista(lista: EinF02Solicitud[]): EinF02Solicitud[] {
    if (!this.seleccionada?.id) {
      return lista || [];
    }
    const out = [...(lista || [])];
    const idx = out.findIndex(s => s.id === this.seleccionada!.id);
    if (idx >= 0) {
      out[idx] = this.seleccionada;
    } else {
      out.unshift(this.seleccionada);
    }
    return out;
  }

  private reasignarSeleccionadaTrasFusion(): void {
    if (!this.seleccionada) {
      return;
    }
    const refreshed =
      encontrarSolicitudPorClave(this.solicitudes, this.seleccionada.id)
      || encontrarSolicitudPorClave(this.solicitudes, this.seleccionada.folio);
    if (refreshed) {
      this.seleccionada = refreshed;
    }
  }

  private persistir(inmediatoServidor = false): void {
    const disco = cargarSolicitudesLocal();
    const memoria = this.inyectarSeleccionadaEnLista(
      conservarReportesManuales(this.solicitudes, disco)
    );
    this.solicitudes = fusionarSolicitudes(memoria, disco);
    this.reasignarSeleccionadaTrasFusion();
    this.guardadoLocal = guardarSolicitudesLocal(this.solicitudes);
    if (!this.guardadoLocal) {
      this.flash('No se pudo guardar localmente.');
    }
    this.programarSyncServidor(inmediatoServidor);
  }

  private programarSyncServidor(inmediato = false): void {
    if (this.syncServidorTimer) {
      clearTimeout(this.syncServidorTimer);
      this.syncServidorTimer = null;
    }
    const run = () => {
      this.syncServidorTimer = null;
      if (this.destruido) {
        return;
      }
      const payload = cargarSolicitudesLocal();
      if (!payload.length) {
        return;
      }
      this.backend.guardarSolicitudesMantenimiento(payload).subscribe({
        error: () => {
          /* reintento en el próximo persistir */
        }
      });
    };
    if (inmediato) {
      run();
      return;
    }
    this.syncServidorTimer = setTimeout(run, 600);
  }

  private flash(msg: string): void {
    this.mensajeEstado = msg;
    setTimeout(() => {
      if (this.mensajeEstado === msg) {
        this.mensajeEstado = '';
      }
    }, 2800);
  }

  /** Lleva el viewport al inicio del reporte (hero / toolbar), no a media página. */
  private scrollAlInicio(conReintentos = false): void {
    const run = () => {
      if (this.destruido) {
        return;
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const ancla = document.getElementById('mt-f04-top');
      if (ancla) {
        ancla.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    };
    run();
    if (!conReintentos) {
      return;
    }
    this.limpiarTimersScrollArriba();
    // Tras pintar editor, autosize de textareas y fusión del servidor.
    for (const ms of [0, 80, 220, 500]) {
      this.scrollArribaTimers.push(setTimeout(run, ms));
    }
  }

  private limpiarTimersScrollArriba(): void {
    for (const t of this.scrollArribaTimers) {
      clearTimeout(t);
    }
    this.scrollArribaTimers = [];
  }
}

