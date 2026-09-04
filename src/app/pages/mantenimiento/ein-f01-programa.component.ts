import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
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
export class EinF01ProgramaComponent implements OnInit, OnDestroy {
  readonly meses = MESES_EIN_F01;
  readonly semanas = SEMANAS_POR_MES;

  meta: EinF01Meta = metaInicialEinF01();
  filas: InfraestructuraFila[] = [];
  guardadoLocal = false;
  mensajeEstado = '';
  guardandoDrive = false;
  editorDriveAbierto = false;
  editorDriveCargando = false;
  driveSpreadsheetId = '';
  excelWebViewLink = '';
  editorDriveUrlSafe: SafeResourceUrl | '' = '';
  kpiCards: MtKpiCard[] = [];
  programadosPorMes: number[] = Array(12).fill(0);
  maxProgramadosMes = 1;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDriveSave = false;
  private abrirEditorTrasGuardar = false;

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
    const panel = (this.route.snapshot.queryParamMap.get('panel') || '').toLowerCase();
    if (panel === 'bitacora' || panel === 'solicitudes' || panel === 'solicitud' || panel === 'f02' || panel === 'f03') {
      this.abrirYScroll('f03');
    } else if (panel === 'reportes' || panel === 'reporte' || panel === 'f04') {
      this.abrirYScroll('f04');
    }
  }

  ngOnDestroy(): void {
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
    if (this.pendingDriveSave) {
      this.programarAutoGuardadoDrive();
    }
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
    this.actualizarEditorDriveUrl(this.excelWebViewLink);
    this.editorDriveCargando = true;
    document.body.classList.add('mt-drive-editor-open');
    document.body.style.overflow = 'hidden';
    this.editorDriveAbierto = true;
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

  get totalInternos(): number {
    return this.filas.filter(f => f.tipo === 'Int').length;
  }

  get totalExternos(): number {
    return this.filas.filter(f => f.tipo === 'Ext').length;
  }

  get activosSinPrograma(): number {
    return this.filas.filter(f => !Object.values(f.programado).some(v => v === 'P')).length;
  }

  get coberturaPct(): number {
    if (!this.filas.length) {
      return 0;
    }
    const conProg = this.filas.length - this.activosSinPrograma;
    return Math.round((conProg / this.filas.length) * 100);
  }

  toggleSeccion(id: MtSeccionId): void {
    this.seccionAbierta[id] = !this.seccionAbierta[id];
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
    this.despuesDeCambio();
    this.flash('Programa restablecido al ejemplo EIN-F-01.');
  }

  trackByFila(_: number, fila: InfraestructuraFila): string {
    return fila.id;
  }

  alturaBarraMes(mes: number): number {
    const n = this.programadosPorMes[mes] || 0;
    if (!this.maxProgramadosMes) {
      return 8;
    }
    return Math.max(8, Math.round((n / this.maxProgramadosMes) * 100));
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
    for (const fila of this.filas) {
      for (const [key, estado] of Object.entries(fila.programado)) {
        if (estado !== 'P' && estado !== 'reservado') {
          continue;
        }
        const m = Number(key.split('-')[0]?.replace('m', ''));
        if (m >= 0 && m < 12) {
          porMes[m] += estado === 'P' ? 1 : 0;
        }
      }
    }
    this.programadosPorMes = porMes;
    this.maxProgramadosMes = Math.max(1, ...porMes);

    const cobertura = this.coberturaPct;
    const sinProg = this.activosSinPrograma;
    const maxIdx = porMes.indexOf(Math.max(...porMes));
    const maxVal = porMes[maxIdx] || 0;

    this.kpiCards = [
      {
        titulo: 'Cobertura del programa',
        valor: `${cobertura}%`,
        subtitulo: `${this.filas.length - sinProg} de ${this.filas.length} con agenda`,
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
      },
      {
        titulo: sinProg > 0 ? 'Sin programar' : 'Mes con más carga',
        valor: sinProg > 0 ? String(sinProg) : (maxVal > 0 ? this.meses[maxIdx].slice(0, 3) : '—'),
        subtitulo: sinProg > 0
          ? 'Activos sin semana P'
          : (maxVal > 0 ? `${maxVal} programaciones` : 'Sin carga'),
        icono: sinProg > 0 ? 'fa-exclamation-circle' : 'fa-chart-bar',
        color: sinProg > 0 ? '#dc2626' : '#0369a1',
        gradiente: sinProg > 0
          ? 'linear-gradient(135deg, #b91c1c 0%, #f87171 100%)'
          : 'linear-gradient(135deg, #0c4a6e 0%, #38bdf8 100%)',
        estado: sinProg === 0 ? 'verde' : sinProg <= 3 ? 'amarillo' : 'rojo'
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

  private persistir(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ meta: this.meta, filas: this.filas }));
      this.guardadoLocal = true;
      this.flash('Cambios guardados en este navegador.');
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
