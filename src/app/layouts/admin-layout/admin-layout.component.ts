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

  private destroy$ = new Subject<void>();
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
    });

    this.cargarNotificaciones();
    interval(AdminLayoutComponent.NOTIF_REFRESH_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.cargarNotificaciones());

    // Precarga dashboard Centro SGC en idle mientras el usuario navega
    this.sgcDashboardCache.prefetchEnSegundoPlano();
  }

  ngOnDestroy() {
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
