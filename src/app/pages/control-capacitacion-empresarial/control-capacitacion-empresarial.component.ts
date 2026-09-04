import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { formatearFechaHoraDescargaMexico, obtenerFechaHoyLocal } from 'src/app/utils/fecha.util';

export interface RegistroControlCapacitacion {
  no: number;
  programado_id?: number;
  empresa_id?: number;
  empresa: string;
  nombre_curso: string;
  dia: string;
  fecha: string;
  fecha_inicio?: string;
  horario: string;
  horas: number | null;
  modalidad: string;
  instructor: string;
  lugar: string;
  numero_participantes: number;
  acreditaciones: string;
  estatus_acreditaciones: string;
  rfc: string;
  email_representante: string;
  observaciones: string;
  ultima_descarga_constancias_por?: string | null;
  ultima_descarga_constancias_fecha?: string | null;
}

@Component({
  selector: 'app-control-capacitacion-empresarial',
  templateUrl: './control-capacitacion-empresarial.component.html',
  styleUrls: ['./control-capacitacion-empresarial.component.scss']
})
export class ControlCapacitacionEmpresarialComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private readonly FILTROS_STORAGE_PREFIX = 'control-capacitacion-filtros';

  anioActual = new Date().getFullYear();
  esRootUser = false;

  // Documento oficial (Drive / PDF / editor)
  descargandoControl = false;
  descargandoControlExcel = false;
  controlExcelGenerado = false;
  controlExcelUltimaActualizacion: string | null = null;
  controlExcelFileId: string | null = null;
  mostrarControlEditorPantallaCompleta = false;
  controlVisorCargando = false;
  private autoUpdateIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly AUTO_UPDATE_MS = 60 * 60 * 1000;
  private readonly AUTO_UPDATE_STORAGE_KEY = 'controlExcelLastAutoGen';

  // Tabla
  loadingRegistros = true;
  registrosBD: RegistroControlCapacitacion[] = [];
  registrosFiltrados: RegistroControlCapacitacion[] = [];
  empresasUnicas: { id: number; nombre: string }[] = [];
  historialDescargasSeleccionado: RegistroControlCapacitacion | null = null;

  // Filtros
  textoBusqueda = '';
  filtroEmpresa = '';
  /** Formato YYYY-MM (input type="month") */
  filtroMes = '';
  filtroEstatus = '';
  filtroDescarga = '';

  readonly opcionesEstatus = [
    { value: '', label: 'Todos los estatus' },
    { value: 'Entregadas', label: 'Entregadas' },
    { value: 'Generadas', label: 'Generadas' },
    { value: 'No realizadas', label: 'No realizadas' }
  ];

  readonly opcionesDescarga = [
    { value: '', label: 'Todas las descargas' },
    { value: 'descargados', label: 'Documentos descargados' },
    { value: 'no_descargados', label: 'No descargados' }
  ];

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.esAdministradorOSuperior() && !this.authService.tieneRol('control_documental')) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.esRootUser = this.authService.esRoot();
    this.restaurarEstadoFiltros();
    this.cargarRegistros();
    this.cargarEstadoControlExcelDrive(this.anioActual);

    this.autoUpdateIntervalId = setInterval(() => {
      this.cargarEstadoControlExcelDrive(this.anioActual);
    }, this.AUTO_UPDATE_MS);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.autoUpdateIntervalId) {
      clearInterval(this.autoUpdateIntervalId);
      this.autoUpdateIntervalId = null;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  private getStorageKeyFiltros(): string {
    const usuarioId = this.authService.getUsuarioId() || 'anon';
    return `${this.FILTROS_STORAGE_PREFIX}-${usuarioId}`;
  }

  private guardarEstadoFiltros(): void {
    try {
      sessionStorage.setItem(this.getStorageKeyFiltros(), JSON.stringify({
        textoBusqueda: this.textoBusqueda,
        filtroEmpresa: this.filtroEmpresa,
        filtroMes: this.filtroMes,
        filtroEstatus: this.filtroEstatus,
        filtroDescarga: this.filtroDescarga
      }));
    } catch (_) { /* sessionStorage no disponible */ }
  }

  private restaurarEstadoFiltros(): void {
    try {
      const raw = sessionStorage.getItem(this.getStorageKeyFiltros());
      if (!raw) return;
      const estado = JSON.parse(raw);
      this.textoBusqueda = typeof estado.textoBusqueda === 'string' ? estado.textoBusqueda : '';
      this.filtroEmpresa = estado.filtroEmpresa != null ? String(estado.filtroEmpresa) : '';
      const mesGuardado = estado.filtroMes ?? estado.filtroFecha;
      this.filtroMes = this.normalizarFiltroMes(typeof mesGuardado === 'string' ? mesGuardado : '');
      this.filtroEstatus = typeof estado.filtroEstatus === 'string' ? estado.filtroEstatus : '';
      this.filtroDescarga = typeof estado.filtroDescarga === 'string' ? estado.filtroDescarga : '';
    } catch (_) { /* estado corrupto */ }
  }

  cargarRegistros(): void {
    this.loadingRegistros = true;
    this.backendService.obtenerRegistrosControlCapacitacion(this.anioActual)
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.registrosBD = ((res?.registros || []) as RegistroControlCapacitacion[])
            .map((r, i) => ({ ...r, no: i + 1 }));
          this.construirEmpresasUnicas();
          this.filtrarRegistros();
          this.loadingRegistros = false;
        },
        () => {
          this.registrosBD = [];
          this.registrosFiltrados = [];
          this.loadingRegistros = false;
        }
      );
  }

  private construirEmpresasUnicas(): void {
    const map = new Map<number, string>();
    this.registrosBD.forEach((r) => {
      if (r.empresa_id && r.empresa) {
        map.set(r.empresa_id, r.empresa);
      }
    });
    this.empresasUnicas = Array.from(map.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  filtrarRegistros(): void {
    let resultado = [...this.registrosBD];

    if (this.filtroEmpresa) {
      resultado = resultado.filter((r) => String(r.empresa_id) === this.filtroEmpresa);
    }

    if (this.filtroMes) {
      resultado = resultado.filter((r) => this.registroCoincideMes(r.fecha, this.filtroMes));
    }

    if (this.filtroEstatus) {
      resultado = resultado.filter((r) => r.estatus_acreditaciones === this.filtroEstatus);
    }

    if (this.filtroDescarga) {
      resultado = resultado.filter((r) => {
        const descargado = this.registroTieneDescarga(r);
        if (this.filtroDescarga === 'descargados') return descargado;
        if (this.filtroDescarga === 'no_descargados') return !descargado;
        return true;
      });
    }

    if (this.textoBusqueda && this.textoBusqueda.trim()) {
      const texto = this.textoBusqueda.toLowerCase().trim();
      resultado = resultado.filter((r) =>
        (r.nombre_curso && r.nombre_curso.toLowerCase().includes(texto)) ||
        (r.empresa && r.empresa.toLowerCase().includes(texto)) ||
        (r.instructor && r.instructor.toLowerCase().includes(texto))
      );
    }

    // Conservar el "No" original de cada registro (asignado al cargar la lista
    // base), para que el número siga perteneciendo a la misma empresa/curso
    // aunque se apliquen filtros.
    this.registrosFiltrados = resultado;
    this.guardarEstadoFiltros();
  }

  private normalizarFiltroMes(valor: string): string {
    if (!valor) return '';
    if (/^\d{4}-\d{2}$/.test(valor)) return valor;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.slice(0, 7);
    return '';
  }

  private registroCoincideMes(fechaDisplay: string, mesInput: string): boolean {
    const mes = this.normalizarFiltroMes(mesInput);
    if (!mes) return true;
    const [anioFiltro, mesFiltro] = mes.split('-');
    const partes = String(fechaDisplay || '').trim().split('/');
    if (partes.length !== 3) return false;
    const [, mesRegistro, anioRegistro] = partes;
    return mesRegistro === mesFiltro && anioRegistro === anioFiltro;
  }

  limpiarFiltros(): void {
    this.textoBusqueda = '';
    this.filtroEmpresa = '';
    this.filtroMes = '';
    this.filtroEstatus = '';
    this.filtroDescarga = '';
    this.filtrarRegistros();
  }

  get hayFiltrosActivos(): boolean {
    return !!(this.textoBusqueda || this.filtroEmpresa || this.filtroMes || this.filtroEstatus || this.filtroDescarga);
  }

  private registroTieneDescarga(registro: RegistroControlCapacitacion): boolean {
    const por = String(registro?.ultima_descarga_constancias_por || '').trim();
    const fecha = String(registro?.ultima_descarga_constancias_fecha || '').trim();
    return !!(por || fecha);
  }

  get hayRegistrosBase(): boolean {
    return this.registrosBD.length > 0;
  }

  get hayRegistrosFiltrados(): boolean {
    return this.registrosFiltrados.length > 0;
  }

  trackByRegistro(_index: number, row: RegistroControlCapacitacion): string | number {
    // Clave estable para que Angular reutilice las filas al filtrar (evita el
    // colapso de la tabla y el salto de scroll en cada tecla/selección).
    if (row.programado_id != null) return row.programado_id;
    return `${row.empresa_id ?? ''}|${row.nombre_curso}|${row.fecha}|${row.horario}`;
  }

  claseEstatus(estatus: string): string {
    const val = (estatus || '').toLowerCase();
    if (val === 'entregadas') return 'estatus--entregadas';
    if (val === 'generadas') return 'estatus--generadas';
    return 'estatus--no-realizadas';
  }

  // ——— Documento oficial (misma lógica que dashboard) ———

  cargarEstadoControlExcelDrive(anio: number = this.anioActual): void {
    this.backendService.obtenerEstadoControlCapacitacionExcelDrive(anio)
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.controlExcelGenerado = !!res?.success && !!res?.exists;
          this.controlExcelUltimaActualizacion = res?.file?.modifiedTime || null;
          const nuevoFileId = res?.file?.id || null;
          if (nuevoFileId && nuevoFileId !== this.controlExcelFileId) {
            this.controlVisorCargando = true;
          }
          this.controlExcelFileId = nuevoFileId;
          this.checkAndMaybeAutoUpdateControl();
        },
        () => {
          this.controlExcelGenerado = false;
          this.controlExcelUltimaActualizacion = null;
          this.controlExcelFileId = null;
          this.controlVisorCargando = false;
        }
      );
  }

  descargarControlCapacitacionPdf(): void {
    if (this.descargandoControl) return;
    this.descargandoControl = true;

    this.backendService.descargarControlCapacitacionPdf()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (blob: Blob) => {
          const fecha = obtenerFechaHoyLocal();
          const nombreArchivo = `control-capacitacion-empresarial-${fecha}.pdf`;
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = nombreArchivo;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
          this.descargandoControl = false;
        },
        () => {
          this.descargandoControl = false;
          Swal.fire({
            title: 'Error',
            text: 'No se pudo generar el PDF del Control de Capacitación Empresarial',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      );
  }

  descargarControlCapacitacionExcel(showAlert: boolean = true): void {
    if (this.descargandoControlExcel) return;
    this.descargandoControlExcel = true;

    try {
      localStorage.setItem(this.AUTO_UPDATE_STORAGE_KEY, String(Date.now()));
    } catch (_) { /* ignore */ }

    this.backendService.guardarControlCapacitacionExcelDrive(this.anioActual)
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.descargandoControlExcel = false;
          this.controlExcelGenerado = true;
          this.controlExcelUltimaActualizacion = res?.file?.modifiedTime || new Date().toISOString();
          this.controlExcelFileId = res?.file?.id || null;

          if (showAlert) {
            const actionTxt = res?.action === 'actualizado' ? 'actualizado' : 'generado';
            Swal.fire({
              title: 'Listo',
              text: `El Control de Capacitación Empresarial fue ${actionTxt} en Drive.`,
              icon: 'success',
              confirmButtonColor: '#38512F'
            });
          }

          this.cargarEstadoControlExcelDrive();
          this.cargarRegistros();
        },
        () => {
          this.descargandoControlExcel = false;
          if (showAlert) {
            Swal.fire({
              title: 'Error',
              text: 'No se pudo guardar el Control de Capacitación Empresarial en Drive',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        }
      );
  }

  private checkAndMaybeAutoUpdateControl(force: boolean = false): void {
    try {
      const now = Date.now();
      const lastClient = Number(localStorage.getItem(this.AUTO_UPDATE_STORAGE_KEY) || '0');
      const lastModified = this.controlExcelUltimaActualizacion
        ? new Date(this.controlExcelUltimaActualizacion).getTime()
        : 0;
      const ageMs = lastModified ? (now - lastModified) : Infinity;
      const needsUpdate = force || (!lastModified || ageMs >= this.AUTO_UPDATE_MS);
      const clientThrottled = (now - lastClient) < this.AUTO_UPDATE_MS;

      if (needsUpdate && !clientThrottled && !this.descargandoControlExcel) {
        try { localStorage.setItem(this.AUTO_UPDATE_STORAGE_KEY, String(now)); } catch (_) {}
        this.descargarControlCapacitacionExcel(false);
      }
    } catch (e) {
      console.error('Error en verificación automática del control Excel', e);
    }
  }

  toggleControlEditorPantallaCompleta(): void {
    if (!this.controlExcelFileId) {
      Swal.fire({
        title: 'Sin archivo',
        text: 'Primero genera el Control de Capacitación Empresarial para poder abrir el editor integrado.',
        icon: 'info',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.mostrarControlEditorPantallaCompleta = !this.mostrarControlEditorPantallaCompleta;
    if (this.mostrarControlEditorPantallaCompleta) {
      this.controlVisorCargando = true;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  get controlExcelEmbedUrl(): string {
    if (!this.controlExcelFileId) return '';
    return `https://docs.google.com/spreadsheets/d/${this.controlExcelFileId}/edit?usp=sharing`;
  }

  onControlIframeLoad(): void {
    this.controlVisorCargando = false;
  }

  abrirHistorialDescargas(registro: RegistroControlCapacitacion): void {
    this.historialDescargasSeleccionado = registro;
  }

  cerrarHistorialDescargas(): void {
    this.historialDescargasSeleccionado = null;
  }

  formatearFechaDescarga(valor?: string | null): string {
    return formatearFechaHoraDescargaMexico(valor);
  }
}
