import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { SidebarService } from 'src/app/services/sidebar.service';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { NotificacionesService } from 'src/app/services/notificaciones.service';
import { HistorialPendientesService } from 'src/app/services/historial-pendientes.service';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import { ConnectivityService } from 'src/app/services/connectivity.service';
import { AvisoPopupItem, AvisosPopupService } from 'src/app/services/avisos-popup.service';
import { biznaguitaAsset, onBiznaguitaAssetError } from 'src/app/utils/biznaguita-assets';
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
  avisosCambio: AvisoPopupItem[] = [];
  avisosFirma: AvisoPopupItem[] = [];
  avisosResolutivo: AvisoPopupItem[] = [];
  avisoSaliendo = false;
  avisoFirmaSaliendo = false;
  avisoResolutivoSaliendo = false;
  /** Banner global: sin conexión a internet. */
  sinConexion = false;

  private destroy$ = new Subject<void>();
  private avisoAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoFirmaAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoResolutivoAccionPendiente: 'cerrar' | 'revisar' | 'aceptar_todas' | null = null;
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
    private connectivity: ConnectivityService,
    private avisosPopup: AvisosPopupService
  ) { }

  ngOnInit() {
    this.sidebarService.sidebarVisible$.pipe(takeUntil(this.destroy$)).subscribe(
      visible => this.sidebarVisible = visible
    );
    const rol = this.authService.getRol()?.toLowerCase();
    this.esDoctor = rol === 'doctor';
    if (this.esDoctor) {
      this.sidebarService.hideSidebar();
    }

    this.actualizarFlagsRuta(this.router.url);
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((e: NavigationEnd) => {
      this.actualizarFlagsRuta(e.urlAfterRedirects);
      this.cargarNotificaciones();
      this.avisosPopup.sincronizarTrasLoginSiNecesario();
    });

    this.avisosPopup.firma$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.avisosFirma = this.avisosPopup.firmaPopup;
    });
    this.avisosPopup.resolutivo$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.avisosResolutivo = this.avisosPopup.resolutivoPopup;
    });
    this.avisosPopup.cambio$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.avisosCambio = this.avisosPopup.cambioPopup;
    });

    this.cargarNotificaciones();
    // Primera carga de la sesión: reactiva silenciados y reenvía PC vigentes.
    this.avisosPopup.sincronizarTrasLoginSiNecesario();
    interval(AdminLayoutComponent.NOTIF_REFRESH_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cargarNotificaciones();
        this.avisosPopup.refrescar();
      });

    if (typeof document !== 'undefined') {
      fromEvent(document, 'visibilitychange')
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (document.visibilityState === 'visible') {
            this.avisosPopup.refrescar();
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
      error: () => {}
    });
    this.historialPendientes.refrescar();
  }

  get avisoCambioActual(): AvisoPopupItem | null {
    return this.avisosCambio[0] || null;
  }

  get avisoFirmaActual(): AvisoPopupItem | null {
    return this.avisosFirma[0] || null;
  }

  get avisoResolutivoActual(): AvisoPopupItem | null {
    return this.avisosResolutivo[0] || null;
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
    this.avisosPopup.bloqueoCambio = true;
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
    this.avisosPopup.bloqueoCambio = false;
  }

  private ejecutarAccionAviso(accion: 'cerrar' | 'revisar'): void {
    const aviso = this.avisoCambioActual;
    if (!aviso) return;
    if (accion === 'cerrar') {
      this.avisosPopup.silenciar(aviso);
      return;
    }
    this.avisosPopup.ir(aviso);
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
    if (aviso?.tipo === 'aprobada') return biznaguitaAsset('biznaga_firma_autorizada.png');
    if (aviso?.tipo === 'rechazada') return biznaguitaAsset('biznaga_firma_rechazada.png');
    if (aviso?.tipo === 'solicitud') return biznaguitaAsset('biznaga_solicitud_firma.png');
    return biznaguitaAsset('mascota-biznaga.png');
  }

  onErrorMascotaBiznaguita(event: Event, fileName: string): void {
    onBiznaguitaAssetError(event, fileName);
  }

  archivoMascotaFirma(aviso: { tipo?: string }): string {
    if (aviso?.tipo === 'aprobada') return 'biznaga_firma_autorizada.png';
    if (aviso?.tipo === 'rechazada') return 'biznaga_firma_rechazada.png';
    if (aviso?.tipo === 'solicitud') return 'biznaga_solicitud_firma.png';
    return 'mascota-biznaga.png';
  }

  archivoMascotaResolutivo(aviso?: { tipo?: string }): string {
    const tipo = String(aviso?.tipo || '');
    if (tipo === 'ventana_diaria') return 'biznaga_aviso_preventivo_reloj.png';
    if (tipo === 'urgente_ingreso' || tipo === 'urgente_seguimiento') {
      return 'biznaga_aviso_urgente_papeles.png';
    }
    return 'mascota-biznaga.png';
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
    this.avisosPopup.bloqueoFirma = true;
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
    this.avisosPopup.bloqueoFirma = false;
  }

  private ejecutarAccionAvisoFirma(accion: 'cerrar' | 'revisar'): void {
    const aviso = this.avisoFirmaActual;
    if (!aviso) return;
    if (accion === 'cerrar') {
      this.avisosPopup.silenciar(aviso);
      return;
    }
    this.avisosPopup.ir(aviso);
  }

  cerrarAvisoResolutivo(): void {
    this.iniciarSalidaAvisoResolutivo('cerrar');
  }

  revisarAvisoResolutivo(): void {
    this.iniciarSalidaAvisoResolutivo('revisar');
  }

  aceptarTodosAvisosResolutivo(): void {
    this.iniciarSalidaAvisoResolutivo('aceptar_todas');
  }

  alTerminarAnimacionAvisoResolutivo(event: AnimationEvent): void {
    if (event.animationName !== 'cp-aviso-subir' || event.target !== event.currentTarget) return;
    this.completarSalidaAvisoResolutivo();
  }

  tituloAvisoResolutivo(aviso: { tipo?: string; diasRestantes?: number | null }): string {
    const dias = aviso?.diasRestantes;
    if (aviso?.tipo === 'urgente_seguimiento') return 'Seguimiento urgente de resolutivo';
    if (aviso?.tipo === 'urgente_ingreso' || (dias != null && dias > 0 && dias <= 20)) {
      return 'Atención: resolutivo por vencer';
    }
    return 'Atención: resolutivo próximo a vencer';
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

  /** Solo Marisol, Leonel y ROOT ven el recuadro de responsable. */
  mostrarResponsableAvisoResolutivo(): boolean {
    const user = String(this.authService.getUsername() || '').trim().toLowerCase();
    if (user === 'marisol12' || user === 'leonel58' || user === 'root') return true;
    return this.authService.tieneRol('root');
  }

  tipoResolutivoAviso(aviso: { tipoResolutivo?: string; nombreAsignacion?: string }): string {
    const directo = String(aviso?.tipoResolutivo || '').trim();
    if (directo) return directo;
    const raw = String(aviso?.nombreAsignacion || '').trim().toLowerCase();
    if (raw.includes('factib')) return 'Factibilidad';
    if (raw.includes('otms')) return 'OTMS';
    return 'PIPC';
  }

  logoEmpresaAvisoResolutivo(aviso: { logoEmpresa?: string }): string | null {
    const raw = String(aviso?.logoEmpresa || '').trim();
    if (!raw) return null;
    return this.backendServices.resolverUrlDrivePreview(raw);
  }

  inicialesEmpresaAvisoResolutivo(aviso: { nombreEmpresa?: string }): string {
    const nombre = String(aviso?.nombreEmpresa || 'EM').trim();
    const partes = nombre.split(/\s+/).filter(Boolean);
    if (partes.length >= 2) {
      return `${partes[0].charAt(0)}${partes[1].charAt(0)}`.toUpperCase();
    }
    return nombre.slice(0, 2).toUpperCase() || 'EM';
  }

  onLogoEmpresaAvisoError(aviso: AvisoPopupItem): void {
    if (aviso) aviso.logoEmpresa = '';
  }

  mascotaAvisoResolutivo(aviso?: { tipo?: string }): string {
    return biznaguitaAsset(this.archivoMascotaResolutivo(aviso));
  }

  mascotaAvisoCambio(): string {
    return biznaguitaAsset('mascota-biznaga.png');
  }

  private iniciarSalidaAvisoResolutivo(accion: 'cerrar' | 'revisar' | 'aceptar_todas'): void {
    if (this.avisoResolutivoSaliendo || !this.avisoResolutivoActual) return;
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.ejecutarAccionAvisoResolutivo(accion);
      return;
    }
    this.avisoResolutivoAccionPendiente = accion;
    this.avisoResolutivoSaliendo = true;
    this.avisosPopup.bloqueoResolutivo = true;
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
    this.avisosPopup.bloqueoResolutivo = false;
  }

  private ejecutarAccionAvisoResolutivo(accion: 'cerrar' | 'revisar' | 'aceptar_todas'): void {
    const aviso = this.avisoResolutivoActual;
    if (!aviso) return;
    if (accion === 'aceptar_todas') {
      this.avisosPopup.silenciarTodosResolutivo();
      return;
    }
    if (accion === 'cerrar') {
      this.avisosPopup.silenciar(aviso);
      return;
    }
    this.avisosPopup.ir(aviso);
  }

  private actualizarFlagsRuta(url: string): void {
    const path = (url || '').split('?')[0];
    this.esProteccionCivil = path.startsWith('/proteccion-civil');
    this.esSistemaGestionCalidad = path.startsWith('/sistema-gestion-calidad');
    this.esControlProyectos = path.startsWith('/control-proyectos')
      || path.startsWith('/control-oficios')
      || path.startsWith('/agenda');
    this.esSensores = path.startsWith('/sensores');
    this.esRecursosHumanos = path.startsWith('/recursos-humanos');
    this.esDisenoInnovacion = path.startsWith('/diseno-innovacion');
    this.esMantenimiento = path.startsWith('/mantenimiento');
    this.ocultarFooter = path.startsWith('/correo') || path.startsWith('/diagramas');
  }

}
