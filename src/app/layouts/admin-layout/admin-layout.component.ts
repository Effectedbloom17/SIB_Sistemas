import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { SidebarService } from 'src/app/services/sidebar.service';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { NotificacionesService } from 'src/app/services/notificaciones.service';
import { HistorialPendientesService } from 'src/app/services/historial-pendientes.service';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import { ConnectivityService } from 'src/app/services/connectivity.service';
import { Subject, interval, fromEvent } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';

@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss']
})
export class AdminLayoutComponent implements OnInit, OnDestroy {

  sidebarVisible = true;
  esDoctor = false;
  esProteccionCivil = false;
  esSistemaGestionCalidad = false;
  esControlProyectos = false;
  esSensores = false;
  esRecursosHumanos = false;
  esDisenoInnovacion = false;
  esMantenimiento = false;
  /** En correo el footer global compite con la ventana de redacción; se oculta. */
  ocultarFooter = false;
  avisosCambio: Array<{
    id: number;
    cambioId: number;
    tipo?: string;
    mensaje: string;
    empresaId: number | null;
    folio: string;
    nombreProyecto: string;
    solicitadoPor?: string;
    resueltoPor?: string;
    estatus?: string;
  }> = [];
  avisosFirma: Array<{
    id: number;
    solicitudId: number;
    tipo: string;
    codigo: string;
    nombreDocumento: string;
    solicitadoPor: string;
    resueltoPor: string;
    mensaje: string;
    ruta: string;
  }> = [];
  avisosResolutivo: Array<{
    id: number;
    resolutivoId: number;
    tipo: string;
    mensaje: string;
    empresaId: number | null;
    nombreEmpresa: string;
    nombreAsignacion: string;
    responsableNombre: string;
    diasRestantes: number | null;
    ruta: string;
  }> = [];
  avisoSaliendo = false;
  avisoFirmaSaliendo = false;
  avisoResolutivoSaliendo = false;
  /** Banner global: sin conexión a internet. */
  sinConexion = false;

  private destroy$ = new Subject<void>();
  private avisoAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoFirmaAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoResolutivoAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoSalidaTimer: ReturnType<typeof setTimeout> | null = null;
  private avisoFirmaSalidaTimer: ReturnType<typeof setTimeout> | null = null;
  private avisoResolutivoSalidaTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly NOTIF_REFRESH_MS = 12 * 1000;

  constructor(
    public sidebarService: SidebarService,
    private authService: AuthService,
    private router: Router,
    private backendServices: BackendServices,
    private notificacionesService: NotificacionesService,
    private historialPendientes: HistorialPendientesService,
    private sgcDashboardCache: SgcDashboardCacheService,
    private connectivity: ConnectivityService
  ) { }

  ngOnInit() {
    this.sidebarService.sidebarVisible$.pipe(takeUntil(this.destroy$)).subscribe(
      visible => this.sidebarVisible = visible
    );
    const rol = this.authService.getRol()?.toLowerCase();
    this.esDoctor = rol === 'doctor';
    // Ocultar sidebar para doctores
    if (this.esDoctor) {
      this.sidebarService.hideSidebar();
    }

    // Detectar rutas para tema / layout
    this.actualizarFlagsRuta(this.router.url);
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((e: NavigationEnd) => {
      this.actualizarFlagsRuta(e.urlAfterRedirects);
      this.cargarNotificaciones();
      this.cargarAvisosCambio();
      this.cargarAvisosFirma();
      this.cargarAvisosResolutivo();
    });

    this.cargarNotificaciones();
    this.cargarAvisosCambio();
    this.cargarAvisosFirma();
    this.cargarAvisosResolutivo();
    interval(AdminLayoutComponent.NOTIF_REFRESH_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cargarNotificaciones();
        this.cargarAvisosCambio();
        this.cargarAvisosFirma();
        this.cargarAvisosResolutivo();
      });

    if (typeof document !== 'undefined') {
      fromEvent(document, 'visibilitychange')
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (document.visibilityState === 'visible') {
            this.cargarAvisosFirma();
            this.cargarAvisosCambio();
            this.cargarAvisosResolutivo();
            this.cargarNotificaciones();
          }
        });
    }

    this.sinConexion = this.connectivity.isOffline;
    this.connectivity.online$
      .pipe(takeUntil(this.destroy$))
      .subscribe((online) => {
        this.sinConexion = !online;
      });

    // Precarga dashboard Centro SGC en idle mientras el usuario navega
    this.sgcDashboardCache.prefetchEnSegundoPlano();
  }

  ngOnDestroy() {
    this.limpiarSalidaAviso();
    this.limpiarSalidaAvisoFirma();
    this.limpiarSalidaAvisoResolutivo();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private cargarNotificaciones(): void {
    this.backendServices.obtenerNotificaciones().subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notificacionesService.setNotifPersonales(res.notificaciones || []);
        }
      },
      error: () => {} // silencioso
    });
    this.historialPendientes.refrescar();
  }

  get avisoCambioActual(): typeof this.avisosCambio[number] | null {
    return this.avisosCambio[0] || null;
  }

  cerrarAvisoCambio(): void {
    this.iniciarSalidaAviso('cerrar');
  }

  revisarAvisoCambio(): void {
    this.iniciarSalidaAviso('revisar');
  }

  alTerminarAnimacionAviso(event: AnimationEvent): void {
    if (event.animationName !== 'cp-aviso-subir' || event.target !== event.currentTarget) return;
    this.completarSalidaAviso();
  }

  private iniciarSalidaAviso(accion: 'cerrar' | 'revisar'): void {
    if (this.avisoSaliendo || !this.avisoCambioActual) return;
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.ejecutarAccionAviso(accion);
      return;
    }
    this.avisoAccionPendiente = accion;
    this.avisoSaliendo = true;
    this.avisoSalidaTimer = setTimeout(() => this.completarSalidaAviso(), 700);
  }

  private completarSalidaAviso(): void {
    const accion = this.avisoAccionPendiente;
    if (!accion) return;
    this.limpiarSalidaAviso();
    this.ejecutarAccionAviso(accion);
  }

  private limpiarSalidaAviso(): void {
    if (this.avisoSalidaTimer) {
      clearTimeout(this.avisoSalidaTimer);
      this.avisoSalidaTimer = null;
    }
    this.avisoAccionPendiente = null;
    this.avisoSaliendo = false;
  }

  private ejecutarAccionAviso(accion: 'cerrar' | 'revisar'): void {
    const aviso = this.avisoCambioActual;
    if (!aviso) return;
    this.avisosCambio = this.avisosCambio.filter((item) => item.id !== aviso.id);
    this.backendServices.descartarAvisoCambioControlProyecto(aviso.id).subscribe({ error: () => {} });
    if (accion === 'cerrar') return;
    if (aviso.tipo === 'respuesta') {
      this.router.navigate(['/control-proyectos'], {
        queryParams: {
          cambioFolio: aviso.folio || null,
          cambioEmpresaId: aviso.empresaId || null,
          cambioId: aviso.cambioId || null,
          solicitudes: null
        }
      });
      return;
    }
    this.router.navigate(['/control-proyectos'], {
      queryParams: { solicitudes: 1 }
    });
  }

  tituloAvisoCambio(aviso: { tipo?: string }): string {
    if (aviso?.tipo === 'respuesta') return 'Tu solicitud fue atendida';
    if (aviso?.tipo === 'recordatorio_urgente') return 'La fecha de compromiso está cerca';
    if (aviso?.tipo === 'recordatorio') return 'Solicitud pendiente de revisión';
    return 'Hay una solicitud por revisar';
  }

  leadAvisoCambio(aviso: { tipo?: string }): string {
    if (aviso?.tipo === 'respuesta') return 'Ya puedes consultar el estatus de tu petición.';
    if (aviso?.tipo === 'recordatorio_urgente') return 'Sigue sin atenderse y la fecha está próxima.';
    if (aviso?.tipo === 'recordatorio') return 'Sigue en espera de autorización o rechazo.';
    return 'Revísala para autorizarla o rechazarla.';
  }

  proyectoAviso(aviso: { nombreProyecto?: string }): string {
    const nombre = String(aviso?.nombreProyecto || '').replace(/\s+/g, ' ').trim();
    if (!nombre) return 'Proyecto';
    if (nombre.length <= 68) return nombre;
    const corte = nombre.slice(0, 68);
    const espacio = corte.lastIndexOf(' ');
    return `${(espacio > 36 ? corte.slice(0, espacio) : corte).trim()}…`;
  }

  resolutorAviso(aviso: { resueltoPor?: string; mensaje?: string }): string {
    const directo = String(aviso?.resueltoPor || '').trim();
    if (directo) return directo;
    const coincidencia = String(aviso?.mensaje || '').match(/respondida por ([^.]+)\./i);
    return coincidencia?.[1]?.trim() || '';
  }

  etiquetaResolutor(aviso: { estatus?: string }): string {
    if (aviso?.estatus === 'aprobado') return 'Aprobó';
    if (aviso?.estatus === 'no_aprobado') return 'No aprobó';
    return 'Respondió';
  }

  get avisoFirmaActual(): typeof this.avisosFirma[number] | null {
    return this.avisosFirma[0] || null;
  }

  cerrarAvisoFirma(): void {
    this.iniciarSalidaAvisoFirma('cerrar');
  }

  revisarAvisoFirma(): void {
    this.iniciarSalidaAvisoFirma('revisar');
  }

  alTerminarAnimacionAvisoFirma(event: AnimationEvent): void {
    if (event.animationName !== 'cp-aviso-subir' || event.target !== event.currentTarget) return;
    this.completarSalidaAvisoFirma();
  }

  tituloAvisoFirma(aviso: { tipo?: string }): string {
    if (aviso?.tipo === 'aprobada') return 'La firma fue aprobada';
    if (aviso?.tipo === 'rechazada') return 'La firma fue rechazada';
    return 'Tienes una firma por autorizar';
  }

  leadAvisoFirma(aviso: { tipo?: string; mensaje?: string }): string {
    if (aviso?.mensaje) return String(aviso.mensaje);
    if (aviso?.tipo === 'aprobada') return 'Ya puedes imprimir el documento autorizado.';
    if (aviso?.tipo === 'rechazada') return 'La solicitud no quedó autorizada.';
    return 'Revísala para aprobarla o rechazarla.';
  }

  mascotaAvisoFirma(aviso: { tipo?: string }): string {
    if (aviso?.tipo === 'aprobada') return 'assets/img/Biznaguita/Biznaga_firma_autorizada.png';
    if (aviso?.tipo === 'rechazada') return 'assets/img/Biznaguita/Biznaga_firma_rechazada.png';
    if (aviso?.tipo === 'solicitud') return 'assets/img/Biznaguita/Biznaga_solicitud_firma.png';
    return 'assets/img/Biznaguita/mascota-biznaga.png';
  }

  private iniciarSalidaAvisoFirma(accion: 'cerrar' | 'revisar'): void {
    if (this.avisoFirmaSaliendo || !this.avisoFirmaActual) return;
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.ejecutarAccionAvisoFirma(accion);
      return;
    }
    this.avisoFirmaAccionPendiente = accion;
    this.avisoFirmaSaliendo = true;
    this.avisoFirmaSalidaTimer = setTimeout(() => this.completarSalidaAvisoFirma(), 700);
  }

  private completarSalidaAvisoFirma(): void {
    const accion = this.avisoFirmaAccionPendiente;
    if (!accion) return;
    this.limpiarSalidaAvisoFirma();
    this.ejecutarAccionAvisoFirma(accion);
  }

  private limpiarSalidaAvisoFirma(): void {
    if (this.avisoFirmaSalidaTimer) {
      clearTimeout(this.avisoFirmaSalidaTimer);
      this.avisoFirmaSalidaTimer = null;
    }
    this.avisoFirmaAccionPendiente = null;
    this.avisoFirmaSaliendo = false;
  }

  private ejecutarAccionAvisoFirma(accion: 'cerrar' | 'revisar'): void {
    const aviso = this.avisoFirmaActual;
    if (!aviso) return;
    this.avisosFirma = this.avisosFirma.filter((item) => item.id !== aviso.id);
    this.backendServices.descartarAvisoFirmaSgc(aviso.id).subscribe({ error: () => {} });
    if (accion === 'cerrar') return;
    const ruta = String(aviso.ruta || '/sistema-gestion-calidad/firmas').trim();
    this.router.navigateByUrl(ruta.startsWith('/') ? ruta : `/${ruta}`);
  }

  private cargarAvisosFirma(): void {
    if (!this.authService.getUsername()) {
      this.avisosFirma = [];
      return;
    }
    this.backendServices.listarAvisosFirmaSgc().subscribe({
      next: (res: any) => {
        if (this.avisoFirmaSaliendo) return;
        this.avisosFirma = Array.isArray(res?.avisos) ? res.avisos : [];
      },
      error: () => {
        // Si el backend aún no tiene la tabla/ruta, no bloquear el resto del layout.
      }
    });
  }

  private cargarAvisosCambio(): void {
    if (!this.authService.getUsername()) {
      this.avisosCambio = [];
      return;
    }
    this.backendServices.listarAvisosCambiosControlProyecto().subscribe({
      next: (res: any) => {
        if (this.avisoSaliendo) return;
        this.avisosCambio = Array.isArray(res?.avisos) ? res.avisos : [];
      },
      error: () => {}
    });
  }

  get avisoResolutivoActual(): typeof this.avisosResolutivo[number] | null {
    return this.avisosResolutivo[0] || null;
  }

  cerrarAvisoResolutivo(): void {
    this.iniciarSalidaAvisoResolutivo('cerrar');
  }

  revisarAvisoResolutivo(): void {
    this.iniciarSalidaAvisoResolutivo('revisar');
  }

  alTerminarAnimacionAvisoResolutivo(event: AnimationEvent): void {
    if (event.animationName !== 'cp-aviso-subir' || event.target !== event.currentTarget) return;
    this.completarSalidaAvisoResolutivo();
  }

  tituloAvisoResolutivo(aviso: { tipo?: string; diasRestantes?: number | null }): string {
    const dias = aviso?.diasRestantes;
    if (aviso?.tipo === 'urgente_seguimiento') return 'Seguimiento de resolutivo PIPC';
    if (aviso?.tipo === 'urgente_ingreso' || (dias != null && dias > 0 && dias <= 20)) {
      return 'Resolutivo PIPC por vencer';
    }
    return 'Recordatorio de resolutivo PIPC';
  }

  leadAvisoResolutivo(aviso: { mensaje?: string }): string {
    return String(aviso?.mensaje || 'Revisa el resolutivo en Atención de Resolutivos.');
  }

  etiquetaDiasResolutivo(aviso: { diasRestantes?: number | null }): string {
    const dias = aviso?.diasRestantes;
    if (dias == null || Number.isNaN(Number(dias))) return 'Sin fecha';
    const n = Number(dias);
    if (n <= 0) {
      const atraso = Math.abs(n);
      return atraso === 0 ? 'Vence hoy' : `${atraso}d de atraso`;
    }
    return n === 1 ? 'Falta 1 día' : `Faltan ${n} días`;
  }

  /** Preventivo = 40-21 días; urgente = 20-1 días (sin vencidos). */
  mascotaAvisoResolutivo(aviso?: { tipo?: string }): string {
    const tipo = String(aviso?.tipo || '');
    if (tipo === 'ventana_diaria') {
      return 'assets/img/Biznaguita/biznaga_aviso_preventivo_reloj.png';
    }
    if (tipo === 'urgente_ingreso' || tipo === 'urgente_seguimiento') {
      return 'assets/img/Biznaguita/biznaga_aviso_urgente_papeles.png';
    }
    return 'assets/img/Biznaguita/mascota-biznaga.png';
  }

  private iniciarSalidaAvisoResolutivo(accion: 'cerrar' | 'revisar'): void {
    if (this.avisoResolutivoSaliendo || !this.avisoResolutivoActual) return;
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.ejecutarAccionAvisoResolutivo(accion);
      return;
    }
    this.avisoResolutivoAccionPendiente = accion;
    this.avisoResolutivoSaliendo = true;
    this.avisoResolutivoSalidaTimer = setTimeout(() => this.completarSalidaAvisoResolutivo(), 700);
  }

  private completarSalidaAvisoResolutivo(): void {
    const accion = this.avisoResolutivoAccionPendiente;
    if (!accion) return;
    this.limpiarSalidaAvisoResolutivo();
    this.ejecutarAccionAvisoResolutivo(accion);
  }

  private limpiarSalidaAvisoResolutivo(): void {
    if (this.avisoResolutivoSalidaTimer) {
      clearTimeout(this.avisoResolutivoSalidaTimer);
      this.avisoResolutivoSalidaTimer = null;
    }
    this.avisoResolutivoAccionPendiente = null;
    this.avisoResolutivoSaliendo = false;
  }

  private ejecutarAccionAvisoResolutivo(accion: 'cerrar' | 'revisar'): void {
    const aviso = this.avisoResolutivoActual;
    if (!aviso) return;
    this.avisosResolutivo = this.avisosResolutivo.filter((item) => item.id !== aviso.id);
    this.backendServices.descartarAvisoResolutivoPipc(aviso.id).subscribe({ error: () => {} });
    if (accion === 'cerrar') return;
    const ruta = String(aviso.ruta || '/proteccion-civil').trim();
    this.router.navigateByUrl(ruta.startsWith('/') ? ruta : `/${ruta}`);
  }

  private cargarAvisosResolutivo(): void {
    if (!this.authService.getUsername()) {
      this.avisosResolutivo = [];
      return;
    }
    this.backendServices.listarAvisosResolutivosPipc().subscribe({
      next: (res: any) => {
        if (this.avisoResolutivoSaliendo) return;
        this.avisosResolutivo = Array.isArray(res?.avisos) ? res.avisos : [];
      },
      error: () => {
        // Backend sin tablas/ruta aún: no bloquear el layout.
      }
    });
  }

  private actualizarFlagsRuta(url: string): void {
    const path = (url || '').split('?')[0];
    this.esProteccionCivil = path.startsWith('/proteccion-civil');
    this.esSistemaGestionCalidad = path.startsWith('/sistema-gestion-calidad');
    this.esControlProyectos = path.startsWith('/control-proyectos') || path.startsWith('/control-oficios');
    this.esSensores = path.startsWith('/sensores');
    this.esRecursosHumanos = path.startsWith('/recursos-humanos');
    this.esDisenoInnovacion = path.startsWith('/diseno-innovacion');
    this.esMantenimiento = path.startsWith('/mantenimiento');
    this.ocultarFooter = path.startsWith('/correo') || path.startsWith('/diagramas');
  }

}
