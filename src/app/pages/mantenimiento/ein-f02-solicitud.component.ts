import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  Renderer2,
  ViewChild,
  ViewChildren
} from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import {
  EIN_F03_META,
  EinF02Solicitud,
  asegurarIdSerie,
  cargarSolicitudesLocal,
  esRegistroForms,
  formatearFechaCorta,
  generarIdSerie,
  guardarSolicitudesLocal,
  parseFechaIso,
  sincronizarCasosDesdeForms
} from './ein-f02-solicitud.catalog';
import {
  EIN_F03_TEMPLATE_ID,
  STORAGE_KEY_F03_DRIVE,
  cargarDriveState,
  guardarDriveState
} from './mantenimiento-excel-sync.catalog';

@Component({
  selector: 'app-ein-f02-solicitud',
  templateUrl: './ein-f02-solicitud.component.html',
  styleUrls: ['./ein-f01-programa.component.scss', './ein-f02-solicitud.component.scss', './mantenimiento-drive.shared.scss']
})
export class EinF02SolicitudComponent implements OnInit, AfterViewChecked, OnDestroy {
  @Input() embebido = false;
  @Output() cerrar = new EventEmitter<void>();
  @ViewChildren('obsTextarea') obsTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;
  @ViewChild('editorPortal') editorPortal?: ElementRef<HTMLElement>;

  filas: EinF02Solicitud[] = [];
  mensajeEstado = '';
  guardadoLocal = false;
  guardandoDrive = false;
  sincronizandoForms = false;
  editorDriveAbierto = false;
  editorDriveCargando = false;
  excelWebViewLink = '';
  driveSpreadsheetId = '';
  editorDriveUrlSafe: SafeResourceUrl | '' = '';
  private pendingTextareaResize = false;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDriveSave = false;
  private abrirEditorTrasGuardar = false;
  private editorMontadoEnBody = false;

  readonly meta = EIN_F03_META;

  constructor(
    private auth: AuthService,
    private backend: BackendServices,
    private router: Router,
    private sanitizer: DomSanitizer,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    this.cargar();
    this.cargarDrive();
    this.sincronizarDesdeForms();
  }

  ngAfterViewChecked(): void {
    if (!this.pendingTextareaResize) {
      return;
    }
    this.pendingTextareaResize = false;
    this.ajustarTodosTextareas();
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.persistir();
    if (this.pendingDriveSave) {
      this.guardarInformacionDrive(true);
    }
    document.body.style.overflow = '';
    this.setEditorBodyState(false);
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    this.persistir();
  }

  get filasBitacora(): EinF02Solicitud[] {
    return this.filas.filter(esRegistroForms);
  }

  guardarInformacionDrive(silencioso = false): void {
    if (this.editorDriveAbierto && silencioso) {
      return;
    }
    const filas = this.filasBitacora;
    if (!filas.length) {
      if (!silencioso) {
        this.flash('Sincroniza desde Forms para llenar la bitácora.');
      }
      return;
    }

    for (const f of filas) {
      if (!f.idSerie?.trim()) {
        f.idSerie = generarIdSerie(
          filas.filter(x => x.id !== f.id),
          parseFechaIso(f.fechaSolicitud) || new Date()
        );
      }
      if (!f.tipoMantenimiento) {
        f.tipoMantenimiento = 'Correctivo';
      }
    }

    this.persistir();
    this.guardandoDrive = true;
    const filasPayload = filas.map((f, idx) => ({
      no: idx + 1,
      tipoInfraestructura: f.tipoInfraestructura,
      idSerie: f.idSerie,
      tipoMantenimiento: f.tipoMantenimiento,
      internoExterno: f.internoExterno || 'Interno',
      actividades: f.descripcionProblema,
      responsable: f.responsableMantenimiento,
      fechaRealizado: f.fechaRealizado,
      observaciones: f.observacionesBitacora
    }));

    this.backend.guardarBitacoraMantenimientoF03Global({
      folio: 'EIN-F-03',
      filas: filasPayload,
      spreadsheetId: EIN_F03_TEMPLATE_ID,
      nombreArchivo: 'EIN-F-03 Bitácora de mantenimiento'
    }).subscribe({
      next: (res) => {
        this.guardandoDrive = false;
        this.pendingDriveSave = false;
        const reporte = res?.reporte;
        this.driveSpreadsheetId = EIN_F03_TEMPLATE_ID;
        this.excelWebViewLink = reporte?.webViewLink || this.urlDocumentoEinF03();
        if (reporte?.driveFileId) {
          for (const f of filas) {
            f.bitacoraDriveFileId = EIN_F03_TEMPLATE_ID;
            f.bitacoraWebViewLink = this.excelWebViewLink;
          }
          guardarDriveState(STORAGE_KEY_F03_DRIVE, {
            driveFileId: EIN_F03_TEMPLATE_ID,
            webViewLink: this.excelWebViewLink,
            nombre: reporte.nombre,
            templateId: EIN_F03_TEMPLATE_ID
          });
          this.persistir();
        }
        if (!silencioso) {
          this.flash('Información guardada en Excel/Drive.');
        }
        if (this.abrirEditorTrasGuardar) {
          this.abrirEditorTrasGuardar = false;
          this.mostrarEditorIntegrado();
        }
      },
      error: (err) => {
        this.guardandoDrive = false;
        this.abrirEditorTrasGuardar = false;
        if (!silencioso) {
          this.flash(err?.error?.message || 'No se pudo guardar en Drive.');
        }
      }
    });
  }

  abrirEditorIntegrado(): void {
    if (this.editorDriveAbierto || this.guardandoDrive) {
      return;
    }
    this.cancelarAutoGuardadoDrive();
    this.driveSpreadsheetId = EIN_F03_TEMPLATE_ID;
    if (!this.excelWebViewLink) {
      this.excelWebViewLink = this.urlDocumentoEinF03();
    }
    if (this.filasBitacora.length) {
      this.abrirEditorTrasGuardar = true;
      this.flash('Preparando Excel en Drive…');
      this.guardarInformacionDrive(false);
      return;
    }
    this.mostrarEditorIntegrado();
  }

  cerrarEditorIntegrado(): void {
    this.editorDriveAbierto = false;
    this.editorDriveCargando = false;
    this.editorMontadoEnBody = false;
    this.setEditorBodyState(false);
    if (this.pendingDriveSave) {
      this.programarAutoGuardadoDrive();
    }
  }

  onEditorIframeLoad(): void {
    this.editorDriveCargando = false;
  }

  private mostrarEditorIntegrado(): void {
    this.excelWebViewLink = this.excelWebViewLink || this.urlDocumentoEinF03();
    if (!this.excelWebViewLink) {
      this.flash('No se pudo abrir el editor integrado.');
      return;
    }
    this.cancelarAutoGuardadoDrive();
    this.actualizarEditorDriveUrl(this.excelWebViewLink);
    this.editorDriveCargando = true;
    this.setEditorBodyState(true);
    this.editorDriveAbierto = true;
    setTimeout(() => this.montarEditorEnBody(), 0);
  }

  private setEditorBodyState(abierto: boolean): void {
    document.body.classList.toggle('mt-drive-editor-open', abierto);
    document.body.style.overflow = abierto ? 'hidden' : '';
  }

  private montarEditorEnBody(): void {
    const el = this.editorPortal?.nativeElement;
    if (!el || this.editorMontadoEnBody || el.parentElement === document.body) {
      return;
    }
    this.renderer.appendChild(document.body, el);
    this.editorMontadoEnBody = true;
  }

  private actualizarEditorDriveUrl(url: string): void {
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

  onCampoChange(fila?: EinF02Solicitud): void {
    if (fila) {
      fila.actualizadoEn = new Date().toISOString();
    }
    this.persistir();
    this.programarAutoGuardadoDrive();
  }

  alternarInternoExterno(fila: EinF02Solicitud): void {
    const actual = fila.internoExterno || 'Interno';
    fila.internoExterno = actual === 'Interno' ? 'Externo' : 'Interno';
    this.onCampoChange(fila);
  }

  esInterno(fila: EinF02Solicitud): boolean {
    return (fila.internoExterno || 'Interno') === 'Interno';
  }

  etiquetaInternoExterno(fila: EinF02Solicitud): string {
    return this.esInterno(fila) ? 'Int' : 'Ext';
  }

  ajustarTextarea(el: HTMLTextAreaElement | null | undefined): void {
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  onObservacionesInput(fila: EinF02Solicitud, el: HTMLTextAreaElement): void {
    this.onCampoChange(fila);
    this.ajustarTextarea(el);
  }

  etiquetaTipoMantenimiento(fila: EinF02Solicitud): string {
    if (fila.tipoMantenimiento === 'Preventivo') {
      return 'Preventivo';
    }
    if (fila.tipoMantenimiento === 'Correctivo') {
      return 'Correctivo';
    }
    return '—';
  }

  formatearFecha(iso: string): string {
    return formatearFechaCorta(iso) || iso || '—';
  }

  irAReporteF04(fila?: EinF02Solicitud): void {
    if (fila?.folio) {
      this.router.navigate(['/mantenimiento/reporte', fila.folio]);
      return;
    }
    this.router.navigate(['/mantenimiento/programa-infraestructura'], {
      queryParams: { panel: 'reportes' }
    });
  }

  irAPrograma(): void {
    if (this.embebido) {
      this.cerrar.emit();
      return;
    }
    this.router.navigate(['/mantenimiento/programa-infraestructura']);
  }

  trackByFila(_: number, f: EinF02Solicitud): string {
    return f.id;
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
        const { lista, nuevos, eliminados } = sincronizarCasosDesdeForms(this.filas, casos);
        this.filas = lista;
        this.persistir();
        this.pendingTextareaResize = true;
        this.programarAutoGuardadoDrive();
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

  private programarAutoGuardadoDrive(): void {
    if (this.editorDriveAbierto) {
      return;
    }
    this.pendingDriveSave = true;
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      this.guardarInformacionDrive(true);
    }, 2500);
  }

  private cancelarAutoGuardadoDrive(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  private ajustarTodosTextareas(): void {
    this.obsTextareas?.forEach(ref => this.ajustarTextarea(ref.nativeElement));
  }

  private cargarDrive(): void {
    this.driveSpreadsheetId = EIN_F03_TEMPLATE_ID;
    const st = cargarDriveState(STORAGE_KEY_F03_DRIVE);
    const linkGuardado = st.webViewLink && (
      st.driveFileId === EIN_F03_TEMPLATE_ID || st.templateId === EIN_F03_TEMPLATE_ID
    );
    this.excelWebViewLink = linkGuardado ? st.webViewLink! : this.urlDocumentoEinF03();
    if (st.driveFileId && st.driveFileId !== EIN_F03_TEMPLATE_ID) {
      guardarDriveState(STORAGE_KEY_F03_DRIVE, {
        driveFileId: EIN_F03_TEMPLATE_ID,
        webViewLink: this.excelWebViewLink,
        templateId: EIN_F03_TEMPLATE_ID
      });
    }
  }

  private urlDocumentoEinF03(): string {
    return `https://docs.google.com/spreadsheets/d/${EIN_F03_TEMPLATE_ID}/edit`;
  }

  private cargar(): void {
    this.filas = cargarSolicitudesLocal();
    for (const f of this.filas) {
      if (esRegistroForms(f)) {
        asegurarIdSerie(f, this.filas);
        f.bitacoraDriveFileId = EIN_F03_TEMPLATE_ID;
        f.bitacoraWebViewLink = this.urlDocumentoEinF03();
      }
    }
    this.guardadoLocal = this.filas.length > 0;
    this.pendingTextareaResize = true;
  }

  private persistir(): void {
    this.guardadoLocal = guardarSolicitudesLocal(this.filas);
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
