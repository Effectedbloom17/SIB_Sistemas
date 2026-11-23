import {
  AfterViewChecked,
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';
import {
  EinF01Meta,
  EstadoCeldaPrograma,
  InfraestructuraFila,
  MESES_EIN_F01,
  SEMANAS_POR_MES,
  claveSemana,
  filasSemillaEinF01,
  metaInicialEinF01,
  normalizarProgramado
} from './ein-f01-programa.catalog';
import {
  STORAGE_KEY_F01_DRIVE,
  EIN_F01_TEMPLATE_ID,
  cargarDriveState,
  guardarDriveState
} from './mantenimiento-excel-sync.catalog';
import { exportarProgramaInfraestructuraPdf } from './ein-f01-programa-pdf';

const STORAGE_KEY = 'biznaga:ein-f01:programa';
const COLLAPSE_KEY = 'biznaga:ein-f01:secciones';

export type MtSeccionId = 'f01' | 'f03' | 'f04';

export interface MtKpiCard {
  titulo: string;
  valor: string;
  subtitulo: string;
  icono: string;
  color: string;
  gradiente: string;
  estado?: 'verde' | 'amarillo' | 'rojo' | 'neutro';
}

@Component({
  selector: 'app-ein-f01-programa',
  templateUrl: './ein-f01-programa.component.html',
  styleUrls: ['./ein-f01-programa.component.scss', './mantenimiento-drive.shared.scss']
})
export class EinF01ProgramaComponent implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy {
  @ViewChildren('respTextarea') respTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;
  @ViewChildren('infraTextarea') infraTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

  readonly meses = MESES_EIN_F01;
  readonly semanas = SEMANAS_POR_MES;

  meta: EinF01Meta = metaInicialEinF01();
  filas: InfraestructuraFila[] = [];
  guardadoLocal = false;
  mensajeEstado = '';
  guardandoDrive = false;
  exportandoPdf = false;
  editorDriveAbierto = false;
  editorDriveCargando = false;
  driveSpreadsheetId = '';
  excelWebViewLink = '';
  editorDriveUrlSafe: SafeResourceUrl | '' = '';
  kpiCards: MtKpiCard[] = [];
  /**
   * Programas de infraestructura con actividad por mes (máx. 1 por fila/mes,
   * sin importar cuántas semanas estén marcadas).
   */
  marcadosPorMes: number[] = Array(12).fill(0);
  /** Programas del mes solo con P (pendientes). */
  programadosPPorMes: number[] = Array(12).fill(0);
  /** Programas del mes realizados (solo verde). */
  realizadosPorMes: number[] = Array(12).fill(0);
  maxMarcadosMes = 1;
  /** Totales anuales del panorama (suma de programas por mes). */
  totalProgramasAnio = 0;
  totalProgramasPAnio = 0;
  totalProgramasRealAnio = 0;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDriveSave = false;
  private abrirEditorTrasGuardar = false;
  private pendingTextareaResize = false;
  private textareasSub: { unsubscribe(): void } | null = null;
  ejemploInterno = true;
  ejemploCursor = false;
  ejemploPresion = false;
  private demoActiva = false;
  private demoTimer: ReturnType<typeof setTimeout> | null = null;

  /** true = expandido */
  seccionAbierta: Record<MtSeccionId, boolean> = {
    f01: true,
    f03: true,
    f04: true
  };

  constructor(
    private route: ActivatedRoute,
    private backend: BackendServices,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.cargar();
    this.cargarDrive();
    this.cargarColapso();
    this.recalcularIndicadores();
    this.pendingTextareaResize = true;
    this.cargarDesdeExcel();
    this.iniciarDemoInterno();
    const panel = (this.route.snapshot.queryParamMap.get('panel') || '').toLowerCase();
    if (panel === 'bitacora' || panel === 'solicitudes' || panel === 'solicitud' || panel === 'f02' || panel === 'f03') {
      this.abrirYScroll('f03');
    } else if (panel === 'reportes' || panel === 'reporte' || panel === 'f04') {
      this.abrirYScroll('f04');
    }
  }

  ngAfterViewChecked(): void {
    if (!this.pendingTextareaResize) {
      return;
    }
    if (!this.respTextareas?.length && !this.infraTextareas?.length) {
      return;
    }
    this.pendingTextareaResize = false;
    this.ajustarTodosTextareasCelda();
  }

  ngAfterViewInit(): void {
    const onTextareasChange = () => this.programarAjusteTextareas();
    const subResp = this.respTextareas?.changes.subscribe(onTextareasChange);
    const subInfra = this.infraTextareas?.changes.subscribe(onTextareasChange);
    this.textareasSub = {
      unsubscribe(): void {
        subResp?.unsubscribe();
        subInfra?.unsubscribe();
      }
    };
    this.programarAjusteTextareas();
  }

  alternarEjemploInterno(): void {
    this.detenerDemoInterno();
    this.ejemploCursor = false;
    this.ejemploPresion = false;
    this.ejemploInterno = !this.ejemploInterno;
  }

  private iniciarDemoInterno(): void {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    this.demoActiva = true;
    this.pasoDemoInterno();
  }

  private detenerDemoInterno(): void {
    this.demoActiva = false;
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }
  }

  private pasoDemoInterno(): void {
    if (!this.demoActiva) {
      return;
    }
    this.ejemploCursor = false;
    this.ejemploPresion = false;
    this.demoTimer = setTimeout(() => {
      if (!this.demoActiva) {
        return;
      }
      this.ejemploCursor = true;
      this.demoTimer = setTimeout(() => {
        if (!this.demoActiva) {
          return;
        }
        this.ejemploPresion = true;
        this.demoTimer = setTimeout(() => {
          if (!this.demoActiva) {
            return;
          }
          this.ejemploInterno = !this.ejemploInterno;
          this.demoTimer = setTimeout(() => {
            if (!this.demoActiva) {
              return;
            }
            this.ejemploPresion = false;
            this.demoTimer = setTimeout(() => {
              if (!this.demoActiva) {
                return;
              }
              this.ejemploCursor = false;
              this.demoTimer = setTimeout(() => this.pasoDemoInterno(), 800);
            }, 1100);
          }, 420);
        }, 180);
      }, 520);
    }, 360);
  }

  ngOnDestroy(): void {
    this.detenerDemoInterno();
    this.textareasSub?.unsubscribe();
    this.textareasSub = null;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    if (this.pendingDriveSave) {
      this.guardarInformacionDrive(true);
    }
    document.body.classList.remove('mt-drive-editor-open');
    document.body.style.overflow = '';
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    this.persistir();
  }

  guardarInformacionDrive(silencioso = false): void {
    if (this.guardandoDrive) {
      return;
    }
    if (this.editorDriveAbierto && silencioso) {
      return;
    }
    this.persistir();
    this.guardandoDrive = true;
    this.backend.guardarProgramaMantenimientoF01({
      meta: this.meta,
      filas: this.filas,
      anio: this.meta.anio,
      spreadsheetId: EIN_F01_TEMPLATE_ID,
      nombreArchivo: `EIN-F-01 Programa ${this.meta.anio}`
    }).subscribe({
      next: (res) => {
        this.guardandoDrive = false;
        this.pendingDriveSave = false;
        const reporte = res?.reporte;
        this.driveSpreadsheetId = EIN_F01_TEMPLATE_ID;
        this.excelWebViewLink = reporte?.webViewLink || this.urlDocumentoEinF01();
        if (reporte?.driveFileId) {
          guardarDriveState(STORAGE_KEY_F01_DRIVE, {
            driveFileId: EIN_F01_TEMPLATE_ID,
            webViewLink: this.excelWebViewLink,
            nombre: reporte.nombre,
            templateId: EIN_F01_TEMPLATE_ID
          });
        }
        if (!silencioso) {
          this.flash(reporte?.hoja
            ? `Información guardada en la hoja ${reporte.hoja}.`
            : 'Información guardada en Excel/Drive.');
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

  async exportarPdf(): Promise<void> {
    if (this.exportandoPdf) {
      return;
    }
    this.exportandoPdf = true;
    try {
      const res = await firstValueFrom(this.backend.leerProgramaMantenimientoF01());
      const programa = res?.programa;
      const filas = Array.isArray(programa?.filas) ? programa.filas : [];
      if (!filas.length) {
        this.flash('La plantilla de Excel no tiene filas para exportar.');
        return;
      }
      const meta = { ...this.meta, ...(programa.meta || {}) };
      await exportarProgramaInfraestructuraPdf(meta, filas);
      this.flash('PDF generado desde la plantilla de Excel.');
    } catch (err: any) {
      if (err?.status === 404) {
        this.flash('Reinicia el backend para leer la plantilla de Excel.');
        return;
      }
      const mensaje = typeof err?.error?.message === 'string' ? err.error.message : '';
      this.flash(mensaje || 'No se pudo leer la plantilla de Excel.');
    } finally {
      this.exportandoPdf = false;
    }
  }

  abrirEditorIntegrado(): void {
    if (this.editorDriveAbierto || this.guardandoDrive) {
      return;
    }
    this.cancelarAutoGuardadoDrive();
    this.driveSpreadsheetId = EIN_F01_TEMPLATE_ID;
    if (!this.excelWebViewLink) {
      this.excelWebViewLink = this.urlDocumentoEinF01();
    }
    this.mostrarEditorIntegrado();
  }

  cerrarEditorIntegrado(): void {
    this.editorDriveAbierto = false;
    this.editorDriveCargando = false;
    document.body.classList.remove('mt-drive-editor-open');
    document.body.style.overflow = '';
    this.cancelarAutoGuardadoDrive();
    this.pendingDriveSave = false;
    this.cargarDesdeExcel();
  }

  onEditorIframeLoad(): void {
    this.editorDriveCargando = false;
  }

  private mostrarEditorIntegrado(): void {
    this.excelWebViewLink = this.excelWebViewLink || this.urlDocumentoEinF01();
    if (!this.excelWebViewLink) {
      this.flash('No se pudo abrir el editor integrado.');
      return;
    }
    this.cancelarAutoGuardadoDrive();
    this.editorDriveCargando = true;
    document.body.classList.add('mt-drive-editor-open');
    document.body.style.overflow = 'hidden';
    this.editorDriveAbierto = true;
    this.editorDriveUrlSafe = '';
    const fileId = String(this.driveSpreadsheetId || EIN_F01_TEMPLATE_ID || '').trim();
    const montar = () => {
      if (!this.editorDriveAbierto) return;
      this.actualizarEditorDriveUrl(this.excelWebViewLink);
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

  get totalProgramados(): number {
    return this.filas.reduce(
      (acc, f) => acc + Object.values(f.programado).filter(v => v === 'P').length,
      0
    );
  }

  /** Semanas en verde (realizadas); no incluyen las marcadas solo con P. */
  get totalRealizados(): number {
    return this.filas.reduce(
      (acc, f) => acc + Object.values(f.programado).filter(v => v === 'reservado').length,
      0
    );
  }

  /** Semanas marcadas en el programa (realizadas + programadas P). */
  get totalMarcados(): number {
    return this.filas.reduce(
      (acc, f) =>
        acc + Object.values(f.programado).filter(v => v === 'reservado' || v === 'P').length,
      0
    );
  }

  get totalInternos(): number {
    return this.filas.filter(f => f.tipo === 'Int').length;
  }

  get totalExternos(): number {
    return this.filas.filter(f => f.tipo === 'Ext').length;
  }

  /**
   * Cobertura = realizados (verde) / total marcado (verde + P).
   * Las celdas con "P" están solo programadas y no suman al numerador.
   */
  get coberturaPct(): number {
    const total = this.totalMarcados;
    if (!total) {
      return 0;
    }
    return Math.round((this.totalRealizados / total) * 100);
  }

  toggleSeccion(id: MtSeccionId): void {
    this.seccionAbierta[id] = !this.seccionAbierta[id];
    if (id === 'f01' && this.seccionAbierta.f01) {
      this.programarAjusteTextareas();
    }
    this.persistirColapso();
  }

  abrirYScroll(id: MtSeccionId): void {
    this.seccionAbierta[id] = true;
    this.persistirColapso();
    setTimeout(() => {
      document.getElementById(`mt-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  irASolicitud(): void {
    this.abrirYScroll('f03');
  }

  irAReporteF04(): void {
    this.abrirYScroll('f04');
  }

  estadoCelda(fila: InfraestructuraFila, mesIdx: number, semanaIdx: number): EstadoCeldaPrograma | null {
    return fila.programado[claveSemana(mesIdx, semanaIdx)] || null;
  }

  celdaMarcada(fila: InfraestructuraFila, mesIdx: number, semanaIdx: number): boolean {
    return !!this.estadoCelda(fila, mesIdx, semanaIdx);
  }

  alternarCelda(fila: InfraestructuraFila, mesIdx: number, semanaIdx: number): void {
    const key = claveSemana(mesIdx, semanaIdx);
    const actual = fila.programado[key];
    const programado = { ...fila.programado };
    if (!actual) {
      programado[key] = 'reservado';
    } else if (actual === 'reservado') {
      programado[key] = 'P';
    } else {
      delete programado[key];
    }
    fila.programado = programado;
    this.despuesDeCambio();
  }

  alternarTipo(fila: InfraestructuraFila): void {
    fila.tipo = fila.tipo === 'Ext' ? 'Int' : 'Ext';
    this.despuesDeCambio();
  }

  etiquetaTipo(fila: InfraestructuraFila): string {
    return fila.tipo === 'Ext' ? 'Ext' : 'Int';
  }

  onMetaChange(): void {
    this.meta.periodo = `Enero - Diciembre ${this.meta.anio}`;
    this.despuesDeCambio();
  }

  onCampoFilaChange(): void {
    this.persistir();
  }

  ajustarTextareaCelda(el: HTMLTextAreaElement | null | undefined): void {
    if (!el) {
      return;
    }
    // Forzar recálculo real del scrollHeight (si no, se queda en min-height y recorta).
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }

  private programarAjusteTextareas(): void {
    this.pendingTextareaResize = true;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.ajustarTodosTextareasCelda();
      this.pendingTextareaResize = false;
    }, 0);
  }

  private ajustarTextareasDeLista(
    lista: QueryList<ElementRef<HTMLTextAreaElement>> | undefined
  ): void {
    const refs = lista?.toArray() || [];
    refs.forEach(ref => {
      const el = (ref as ElementRef<HTMLTextAreaElement>).nativeElement
        || (ref as unknown as HTMLTextAreaElement);
      this.ajustarTextareaCelda(el);
    });
  }

  private ajustarTodosTextareasCelda(): void {
    const tieneRefs = !!(this.respTextareas?.length || this.infraTextareas?.length);
    if (tieneRefs) {
      this.ajustarTextareasDeLista(this.infraTextareas);
      this.ajustarTextareasDeLista(this.respTextareas);
      return;
    }
    document
      .querySelectorAll<HTMLTextAreaElement>('#mt-sec-f01 textarea.mt-cell-textarea--auto')
      .forEach(el => this.ajustarTextareaCelda(el));
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.programarAjusteTextareas();
  }

  agregarFila(): void {
    this.filas = [
      ...this.filas,
      {
        id: `fila-${Date.now()}`,
        infraestructura: 'Nueva infraestructura',
        responsable: this.meta.administrador || '',
        tipo: 'Int',
        programado: {}
      }
    ];
    this.programarAjusteTextareas();
    this.despuesDeCambio();
  }

  async eliminarFila(id: string): Promise<void> {
    const fila = this.filas.find(f => f.id === id);
    const nombre = (fila?.infraestructura || 'este apartado').trim();
    const result = await Swal.fire({
      title: '¿Eliminar apartado?',
      text: `Se quitará "${nombre}" del programa EIN-F-01. ¿Está seguro?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      cancelButtonColor: '#8898aa',
      reverseButtons: true
    });
    if (!result.isConfirmed) {
      return;
    }
    this.filas = this.filas.filter(f => f.id !== id);
    this.despuesDeCambio();
  }

  reiniciarEjemplo(): void {
    this.meta = metaInicialEinF01(this.meta.anio || 2026);
    this.filas = filasSemillaEinF01();
    this.programarAjusteTextareas();
    this.despuesDeCambio();
    this.flash('Programa restablecido al ejemplo EIN-F-01.');
  }

  trackByFila(_: number, fila: InfraestructuraFila): string {
    return fila.id;
  }

  alturaBarraMes(mes: number): number {
    const n = this.marcadosPorMes[mes] || 0;
    if (!n || !this.maxMarcadosMes) {
      return 0;
    }
    return Math.max(6, Math.round((n / this.maxMarcadosMes) * 100));
  }

  tituloBarraMes(mes: number): string {
    const total = this.marcadosPorMes[mes] || 0;
    const prog = this.programadosPPorMes[mes] || 0;
    const real = this.realizadosPorMes[mes] || 0;
    const nombre = this.meses[mes] || '';
    if (!total) {
      return `${nombre}: sin programas`;
    }
    return `${nombre}: ${total} programa${total === 1 ? '' : 's'} · Programados ${prog} · Realizados ${real}`;
  }

  private despuesDeCambio(): void {
    this.recalcularIndicadores();
    this.persistir();
    this.programarAutoGuardadoDrive();
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

  private cargandoExcel = false;

  private async cargarDesdeExcel(): Promise<void> {
    if (this.cargandoExcel) {
      return;
    }
    this.cargandoExcel = true;
    this.mensajeEstado = 'Cargando plantilla de Excel…';
    try {
      const res = await firstValueFrom(this.backend.leerProgramaMantenimientoF01());
      const programa = res?.programa;
      const filas = Array.isArray(programa?.filas) ? programa.filas : [];
      if (!filas.length) {
        this.flash('La plantilla de Excel no tiene filas.');
        return;
      }
      if (this.pendingDriveSave) {
        if (this.mensajeEstado === 'Cargando plantilla de Excel…') {
          this.mensajeEstado = '';
        }
        return;
      }
      const anio = Number(programa?.meta?.anio || programa?.anio) || this.meta.anio;
      this.meta = { ...metaInicialEinF01(anio), ...(programa.meta || {}) };
      this.filas = filas.map((fila: InfraestructuraFila, i: number) => ({
        id: String(fila?.id || `excel-${i + 1}`),
        infraestructura: String(fila?.infraestructura || ''),
        responsable: String(fila?.responsable || ''),
        tipo: fila?.tipo === 'Ext' ? 'Ext' : 'Int',
        programado: normalizarProgramado(fila?.programado as Record<string, unknown>)
      }));
      this.recalcularIndicadores();
      this.persistir(false);
      this.cancelarAutoGuardadoDrive();
      this.pendingDriveSave = false;
      this.programarAjusteTextareas();
      this.flash('Programa cargado desde Excel.');
    } catch (err: any) {
      if (err?.status === 404) {
        this.flash('Reinicia el backend para cargar la plantilla de Excel en pantalla.');
        return;
      }
      const mensaje = typeof err?.error?.message === 'string' ? err.error.message : '';
      this.flash(mensaje || 'No se pudo leer la plantilla de Excel.');
    } finally {
      this.cargandoExcel = false;
    }
  }

  private cargarDrive(): void {
    this.driveSpreadsheetId = EIN_F01_TEMPLATE_ID;
    const st = cargarDriveState(STORAGE_KEY_F01_DRIVE);
    const linkGuardado = st.webViewLink && (
      st.driveFileId === EIN_F01_TEMPLATE_ID || st.templateId === EIN_F01_TEMPLATE_ID
    );
    this.excelWebViewLink = linkGuardado ? st.webViewLink! : this.urlDocumentoEinF01();
    if (st.driveFileId && st.driveFileId !== EIN_F01_TEMPLATE_ID) {
      guardarDriveState(STORAGE_KEY_F01_DRIVE, {
        driveFileId: EIN_F01_TEMPLATE_ID,
        webViewLink: this.excelWebViewLink,
        templateId: EIN_F01_TEMPLATE_ID
      });
    }
  }

  private urlDocumentoEinF01(): string {
    return `https://docs.google.com/spreadsheets/d/${EIN_F01_TEMPLATE_ID}/edit`;
  }

  private recalcularIndicadores(): void {
    const porMes = Array(12).fill(0);
    const porMesP = Array(12).fill(0);
    const porMesReal = Array(12).fill(0);

    // 1 programa por infraestructura/mes, aunque tenga varias semanas marcadas.
    for (const fila of this.filas) {
      const porMesEstado: Array<{ tieneP: boolean; tieneReal: boolean }> = Array.from(
        { length: 12 },
        () => ({ tieneP: false, tieneReal: false })
      );
      for (const [key, estado] of Object.entries(fila.programado)) {
        if (estado !== 'P' && estado !== 'reservado') {
          continue;
        }
        const m = Number(key.split('-')[0]?.replace('m', ''));
        if (m < 0 || m >= 12) {
          continue;
        }
        if (estado === 'P') {
          porMesEstado[m].tieneP = true;
        } else {
          porMesEstado[m].tieneReal = true;
        }
      }
      for (let m = 0; m < 12; m++) {
        const { tieneP, tieneReal } = porMesEstado[m];
        if (!tieneP && !tieneReal) {
          continue;
        }
        porMes[m] += 1;
        // Si aún queda alguna semana en P, el programa del mes cuenta como programado.
        if (tieneP) {
          porMesP[m] += 1;
        } else {
          porMesReal[m] += 1;
        }
      }
    }

    this.marcadosPorMes = porMes;
    this.programadosPPorMes = porMesP;
    this.realizadosPorMes = porMesReal;
    this.maxMarcadosMes = Math.max(1, ...porMes);
    this.totalProgramasAnio = porMes.reduce((a, b) => a + b, 0);
    this.totalProgramasPAnio = porMesP.reduce((a, b) => a + b, 0);
    this.totalProgramasRealAnio = porMesReal.reduce((a, b) => a + b, 0);

    const cobertura = this.coberturaPct;
    const realizados = this.totalRealizados;
    const marcados = this.totalMarcados;
    const soloP = this.totalProgramados;

    this.kpiCards = [
      {
        titulo: 'Cobertura del programa',
        valor: `${cobertura}%`,
        subtitulo: marcados
          ? `${realizados} de ${marcados} realizados · ${soloP} en P`
          : 'Sin semanas marcadas',
        icono: 'fa-check-double',
        color: '#334155',
        gradiente: 'linear-gradient(135deg, #1e293b 0%, #64748b 100%)',
        estado: cobertura >= 80 ? 'verde' : cobertura >= 50 ? 'amarillo' : 'rojo'
      },
      {
        titulo: 'Programados',
        valor: String(this.totalProgramados),
        subtitulo: `Semanas marcadas · ${this.meta.anio}`,
        icono: 'fa-calendar-check',
        color: '#0f766e',
        gradiente: 'linear-gradient(135deg, #0f766e 0%, #2dd4bf 100%)',
        estado: this.totalProgramados > 0 ? 'verde' : 'amarillo'
      },
      {
        titulo: 'Activos',
        valor: String(this.filas.length),
        subtitulo: 'En el programa EIN-F-01',
        icono: 'fa-server',
        color: '#475569',
        gradiente: 'linear-gradient(135deg, #334155 0%, #94a3b8 100%)'
      },
      {
        titulo: 'Internos',
        valor: String(this.totalInternos),
        subtitulo: 'Tipo Int',
        icono: 'fa-building',
        color: '#16a34a',
        gradiente: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)'
      },
      {
        titulo: 'Externos',
        valor: String(this.totalExternos),
        subtitulo: 'Tipo Ext',
        icono: 'fa-handshake',
        color: '#ca8a04',
        gradiente: 'linear-gradient(135deg, #a16207 0%, #facc15 100%)'
      }
    ];
  }

  private cargar(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.meta && Array.isArray(data?.filas)) {
          this.meta = { ...metaInicialEinF01(), ...data.meta };
          this.filas = data.filas.map((fila: InfraestructuraFila) => ({
            ...fila,
            programado: normalizarProgramado(fila.programado as Record<string, unknown>)
          }));
          this.guardadoLocal = true;
          return;
        }
      }
    } catch {
      /* ignore */
    }
    this.meta = metaInicialEinF01();
    this.filas = filasSemillaEinF01();
  }

  private cargarColapso(): void {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (!raw) {
        return;
      }
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        (['f01', 'f03', 'f04'] as MtSeccionId[]).forEach(id => {
          if (typeof data[id] === 'boolean') {
            this.seccionAbierta[id] = data[id];
          }
        });
        // Migración: sección f02 → f03
        if (typeof data.f02 === 'boolean' && typeof data.f03 !== 'boolean') {
          this.seccionAbierta.f03 = data.f02;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private persistirColapso(): void {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(this.seccionAbierta));
    } catch {
      /* ignore */
    }
  }

  private persistir(_avisar = true): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ meta: this.meta, filas: this.filas }));
      this.guardadoLocal = true;
      // Sin aviso "Cambios guardados en este navegador": el guardado local es silencioso.
    } catch {
      this.flash('No se pudo guardar localmente.');
    }
  }

  private flash(msg: string): void {
    this.mensajeEstado = msg;
    setTimeout(() => {
      if (this.mensajeEstado === msg) {
        this.mensajeEstado = '';
      }
    }, 2200);
  }
}
