import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { SidebarService } from 'src/app/services/sidebar.service';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { NotificacionesService } from 'src/app/services/notificaciones.service';
import { HistorialPendientesService } from 'src/app/services/historial-pendientes.service';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import { Subject, interval } from 'rxjs';
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
  avisoSaliendo = false;

  private destroy$ = new Subject<void>();
  private avisoAccionPendiente: 'cerrar' | 'revisar' | null = null;
  private avisoSalidaTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly NOTIF_REFRESH_MS = 60 * 1000;

  constructor(
    public sidebarService: SidebarService,
    private authService: AuthService,
    private router: Router,
    private backendServices: BackendServices,
    private notificacionesService: NotificacionesService,
    private historialPendientes: HistorialPendientesService,
    private sgcDashboardCache: SgcDashboardCacheService
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
    });

    this.cargarNotificaciones();
    this.cargarAvisosCambio();
    interval(AdminLayoutComponent.NOTIF_REFRESH_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cargarNotificaciones();
        this.cargarAvisosCambio();
      });

    // Precarga dashboard Centro SGC en idle mientras el usuario navega
    this.sgcDashboardCache.prefetchEnSegundoPlano();
  }

  ngOnDestroy() {
    this.limpiarSalidaAviso();
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

  private actualizarFlagsRuta(url: string): void {
    const path = (url || '').split('?')[0];
    this.esProteccionCivil = path.startsWith('/proteccion-civil');
    this.esSistemaGestionCalidad = path.startsWith('/sistema-gestion-calidad');
    this.esControlProyectos = path.startsWith('/control-proyectos') || path.startsWith('/control-oficios');
    this.esSensores = path.startsWith('/sensores');
    this.esRecursosHumanos = path.startsWith('/recursos-humanos');
    this.esDisenoInnovacion = path.startsWith('/diseno-innovacion');
    this.esMantenimiento = path.startsWith('/mantenimiento');
    this.ocultarFooter = path.startsWith('/correo');
  }

}
