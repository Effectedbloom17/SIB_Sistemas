/**
 * VERSIONADO: La version se lee de package.json y se muestra en el sidebar.
 * Al hacer cambios al proyecto, actualizar "version" en package.json (semver):
 *   - patch (x.x.1): bug fixes, ajustes menores
 *   - minor (x.1.0): funcionalidad nueva
 *   - major (1.0.0): cambios que rompen compatibilidad
 */
import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SidebarService } from 'src/app/services/sidebar.service';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { HistorialPendientesService } from 'src/app/services/historial-pendientes.service';
import packageJson from '../../../../package.json';
import { SGC_CAPITULOS_ORDEN } from '../../pages/sistema-gestion-calidad/sgc-formatos.catalog';

declare interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
    roles?: string[]; // Roles que pueden ver este item (vacío = todos)
    beta?: boolean;   // Muestra badge BETA junto al título
    bottomSection?: boolean; // Muestra el item separado al fondo del menú
    iconFa?: string;  // Icono Font Awesome (ej. fa-tree) en lugar de Nucleo
}

// Sección del menú lateral: agrupa items bajo un encabezado opcional.
// Si title es undefined, los items se muestran sin encabezado (sueltos).
declare interface MenuSection {
    title?: string;
    items: RouteInfo[];
}

// Orden y agrupación del menú principal. Cada grupo lista los paths que lo
// componen; un grupo sin title agrupa items sueltos (sin encabezado).
// Los items se renderizan en este orden, respetando el filtrado por rol.
const MENU_GROUPS: { title?: string; paths: string[] }[] = [
    { title: 'Gestión de empresas', paths: ['/mis-empresas', '/empleados-empresa', '/chat-empresas'] },
    { title: 'Capacitación', paths: ['/home', '/control-capacitacion', '/asig-curso', '/curso-activos', '/historial-cursos', '/historial-constancias-dc3'] },
    { title: 'Protección Civil', paths: ['/proteccion-civil', '/proteccion-civil/control-resolutivos', '/proteccion-civil/historial-pc'] },
    { title: 'Médicos', paths: ['/expedientes-medicos', '/estadisticas-medicas'] },
    { title: 'SGC', paths: ['/sistema-gestion-calidad', '/sistema-gestion-calidad/procedimientos', '/sistema-gestion-calidad/instructivos', '/sistema-gestion-calidad/formatos', '/sistema-gestion-calidad/normativas', '/sistema-gestion-calidad/solicitud-documentos'] },
    { title: 'Seguridad', paths: ['/seguridad/normativas'] },
    { title: 'Recursos Humanos', paths: ['/recursos-humanos/residentes', '/recursos-humanos/colaboradores'] },
    { title: 'Ambiental', paths: ['/ambiental', '/control-tramites'] },
    { title: 'Control de Proyectos', paths: ['/control-proyectos', '/control-oficios'] },
    { title: 'Sensorización', paths: ['/sensores'] },
    { title: 'Diseño e Innovación', paths: ['/diseno-innovacion', '/diseno-innovacion/repositorio', '/diseno-innovacion/inventario'] },
    { title: 'Mantenimiento', paths: ['/mantenimiento/programa-infraestructura', '/mantenimiento/solicitud'] },
    { title: 'Comunicación', paths: ['/calendario', '/quejas-sugerencias', '/correo', '/correo-empresa', '/tickets'] },
];

// Menú completo con roles permitidos
// Si roles está vacío o no existe, todos los usuarios autenticados lo ven
// El rol 'root' siempre ve todo
// El rol 'empresa' ve cursos activos e historial, sin acceso a calendario
export const ROUTES: RouteInfo[] = [
    { path: '/home', title: 'Categoría de\nCursos',  icon: 'ni-briefcase-24', class: '', roles: ['root', 'administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'control_documental'] },
    { path: '/mis-empresas', title: 'Empresas',  icon:'ni-building', class: '' }, // Todos excepto empresa (filtro en filterMenuByRole)
    { path: '/asig-curso', title: 'Asignación de\ncursos',  icon:'ni-books', class: '', roles: ['root', 'administrador', 'instructor', 'control_documental'] },
    { path: '/curso-activos', title: 'Cursos activos',  icon:'ni-button-play', class: '', roles: ['root', 'administrador', 'instructor', 'empresa', 'control_documental'] },
    { path: '/empleados-empresa', title: 'Empleados',  icon:'ni-badge', class: '', roles: ['empresa', 'administrador', 'control_documental'] },
    { path: '/chat-empresas', title: 'Asesoría y\nSoporte',  icon: '', iconFa: 'fa-comments', class: '', roles: ['root', 'administrador', 'empresa'] },
    { path: '/historial-cursos', title: 'Historial de cursos',  icon:'ni-single-copy-04', class: '', roles: ['root', 'administrador', 'instructor', 'empresa', 'coordinador', 'consulta', 'sgc', 'control_documental'] },
    { path: '/control-capacitacion', title: 'Control de\nCapacitación',  icon:'ni-paper-diploma', class: '', roles: ['administrador', 'control_documental'] },
    { path: '/historial-constancias-dc3', title: 'Constancias/DC-3',  icon:'ni-archive-2', class: '', roles: ['root', 'administrador', 'instructor', 'control_documental'] },
    { path: '/calendario', title: 'Calendario',  icon:'ni-calendar-grid-58', class: '', roles: ['root', 'administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'control_documental'] },
    { path: '/quejas-sugerencias', title: 'Opiniones y\nSugerencias',  icon:'ni-chat-round', class: '', roles: ['root', 'administrador', 'empresa'] },
    { path: '/correo', title: 'Correo',  icon:'ni-email-83', class: '', roles: ['root', 'administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'doctor', 'sgc', 'ambiental', 'innovacion', 'control_documental', 'rrhh'] },
    { path: '/correo-empresa', title: 'Correo\nEmpresarial',  icon:'ni-building', class: '', roles: ['root', 'administrador'] },
    { path: '/tickets', title: 'Tickets',  icon:'ni-tag', class: '', roles: ['root'] },
    { path: '/gestion-usuarios', title: 'Gestión de\nusuarios',  icon:'ni-circle-08', class: '', roles: ['root', 'administrador'], bottomSection: true },
    { path: '/aviso-privacidad', title: 'Aviso de\nprivacidad',  icon:'ni-circle-08', class: '', roles: ['empresa'], bottomSection: true },
    { path: '/proteccion-civil', title: 'Protección\nCivil',  icon:'ni-badge', class: '', roles: ['root', 'administrador', 'empresa', 'proteccion_civil'] },
    { path: '/proteccion-civil/control-resolutivos', title: 'Control de\nResolutivos',  icon:'ni-paper-diploma', class: '', roles: ['administrador'] },
    { path: '/proteccion-civil/historial-pc', title: 'Historial PC',  icon:'ni-archive-2', class: '', roles: ['administrador', 'proteccion_civil'] },
  { path: '/expedientes-medicos', title: 'Expedientes\nMédicos',  icon:'ni-archive-2', class: '', roles: ['root', 'administrador', 'doctor'] },
    { path: '/estadisticas-medicas', title: 'Estadisticas\nMedias', icon:'ni-chart-bar-32', class: '', roles: ['root', 'administrador', 'doctor'] },
    { path: '/sistema-gestion-calidad', title: 'Centro SGC',  icon:'ni-chart-pie-35', class: '' },
    { path: '/sistema-gestion-calidad/procedimientos', title: 'Procedimientos', icon: 'ni-single-copy-04', class: '' },
    { path: '/sistema-gestion-calidad/instructivos', title: 'Instructivos', icon: '', iconFa: 'fa-list-alt', class: '' },
    { path: '/sistema-gestion-calidad/formatos', title: 'Formatos', icon: '', iconFa: 'fa-file-download', class: '' },
    { path: '/sistema-gestion-calidad/normativas', title: 'Normativas', icon: '', iconFa: 'fa-file-pdf', class: '' },
    { path: '/sistema-gestion-calidad/solicitud-documentos', title: 'Solicitud de\nDocumentos', icon: '', iconFa: 'fa-file-signature', class: '', roles: ['root'] },
    { path: '/seguridad/normativas', title: 'Normativas', icon: '', iconFa: 'fa-clipboard-check', class: '' },
    { path: '/recursos-humanos/residentes', title: 'Residentes', icon: '', iconFa: 'fa-user-friends', class: '', roles: ['root', 'administrador', 'rrhh'] },
    { path: '/recursos-humanos/colaboradores', title: 'Colaboradores', icon: '', iconFa: 'fa-id-badge', class: '', roles: ['root', 'administrador', 'rrhh'] },
    { path: '/control-proyectos', title: 'Control de avance\nde proyectos', icon: '', iconFa: 'fa-project-diagram', class: '' }, // Todos excepto empresa (filtro en filterMenuByRole)
    { path: '/sensores', title: 'Sensores', icon: '', iconFa: 'fa-tint', class: '', roles: ['root', 'iot'] },
    { path: '/ambiental', title: 'Ambiental', icon: '', iconFa: 'fa-tree', class: '', roles: ['root', 'administrador', 'ambiental'] },
    { path: '/control-tramites', title: 'Control de\nTrámites', icon: '', iconFa: 'fa-clipboard-list', class: '', roles: ['root', 'administrador', 'ambiental'] },
    { path: '/control-oficios', title: 'Control de\nOficios', icon: '', iconFa: 'fa-folder-open', class: '' },
    { path: '/diseno-innovacion', title: 'Proyectos\nSeñalización', icon: '', iconFa: 'fa-drafting-compass', class: '', roles: ['root', 'administrador', 'innovacion'] },
    { path: '/diseno-innovacion/repositorio', title: 'Repositorio', icon: '', iconFa: 'fa-folder-open', class: '', roles: ['root', 'administrador', 'innovacion', 'sgc'] },
    { path: '/diseno-innovacion/inventario', title: 'Inventario', icon: '', iconFa: 'fa-boxes', class: '', roles: ['root', 'administrador', 'innovacion'] },
    { path: '/mantenimiento/programa-infraestructura', title: 'Programa\ninfraestructura', icon: '', iconFa: 'fa-industry', class: '', roles: ['root', 'administrador', 'mantenimiento'] },
    { path: '/mantenimiento/solicitud', title: 'Solicitud de\nmantenimiento', icon: '', iconFa: 'fa-file-signature', class: '' },
];

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();
  public menuSections: MenuSection[] = [];
  public menuItems: RouteInfo[] = [];
  /** Menú categorizado para administrador/root o perfiles con más de 2 roles. */
  public useGroupedMenu = false;
  public bottomMenuItems: RouteInfo[] = [];
  public isCollapsed = true;
  public sidebarVisible = true;
  public appVersion: string = packageJson.version;
  /** True cuando el servidor reporta una versión distinta a la cargada en esta pestaña. */
  public nuevaVersionDisponible = false;
  public logoRoute: string = '/dashboard';
  /** Cursos finalizados pendientes de consulta (admins). */
  public historialPendientesCount = 0;
  public mostrarPopHistorial = false;
  public historialBadgePulse = false;

  /** Grupos del menú fijados (abiertos) por el usuario. Se persiste en localStorage. */
  public expandedGroups = new Set<string>();
  /** URL actual, usada para auto-abrir el grupo que contiene la ruta activa. */
  private currentUrl = '';
  private static readonly EXPANDED_GROUPS_STORAGE_KEY = 'biznaga:sidebar:expandedGroups';
  /** Intervalo de verificación de versión (5 minutos). */
  private static readonly VERSION_CHECK_MS = 5 * 60 * 1000;

  /** Referencias estables: evitar objetos nuevos en el template (congela Angular). */
  private static readonly ROUTER_LINK_EXACT = { exact: true };
  private static readonly ROUTER_LINK_PREFIX = { exact: false };
  private readonly routerLinkActiveOptionsByPath = new Map<string, { exact: boolean }>(
    ['/proteccion-civil', '/home', '/dashboard', '/sistema-gestion-calidad', '/diseno-innovacion', '/sensores', '/mantenimiento'].map(
      (path) => [path, SidebarComponent.ROUTER_LINK_EXACT] as [string, { exact: boolean }]
    )
  );
  private readonly sgcCapituloSlugs = SGC_CAPITULOS_ORDEN.map(c => c.slug);

  constructor(
    private router: Router,
    public sidebarService: SidebarService,
    private authService: AuthService,
    private backendService: BackendServices,
    private historialPendientes: HistorialPendientesService
  ) { }

  ngOnInit() {
    // Restaurar grupos fijados por el usuario
    this.loadExpandedGroups();
    this.currentUrl = this.router.url;

    // Filtrar menú basado en rol del usuario
    this.refreshMenu();
    
    this.router.events.pipe(takeUntil(this.destroy$)).subscribe((event) => {
      this.isCollapsed = true;
      this.currentUrl = this.router.url;
      // En móvil, cerrar sidebar al navegar
      if (window.innerWidth < 768) {
        this.sidebarService.hideSidebar();
      }
   });

   // Suscribirse al estado del sidebar
   this.sidebarService.sidebarVisible$.pipe(takeUntil(this.destroy$)).subscribe(
     visible => this.sidebarVisible = visible
   );
   
   // Actualizar menú cuando cambie el usuario
   this.authService.usuarioActual.pipe(takeUntil(this.destroy$)).subscribe(() => {
     this.refreshMenu();
     this.historialPendientes.refrescar();
   });

   this.historialPendientes.count$.pipe(takeUntil(this.destroy$)).subscribe((n) => {
     this.historialPendientesCount = n;
   });

   this.historialPendientes.animIncremento$.pipe(takeUntil(this.destroy$)).subscribe(() => {
     this.mostrarPopHistorial = true;
     this.historialBadgePulse = true;
     window.setTimeout(() => {
       this.mostrarPopHistorial = false;
       this.historialBadgePulse = false;
     }, 1700);
   });

   this.iniciarChequeoVersion();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.verificarNuevaVersion();
  }

  /** Recarga forzada para obtener el bundle de la nueva versión. */
  actualizarPagina(): void {
    window.location.reload();
  }

  private iniciarChequeoVersion(): void {
    this.verificarNuevaVersion();
    interval(SidebarComponent.VERSION_CHECK_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.verificarNuevaVersion());
  }

  private verificarNuevaVersion(): void {
    this.backendService.obtenerVersionApp().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const remota = String(res?.version || '').trim();
        if (!remota) {
          return;
        }
        this.nuevaVersionDisponible = this.esVersionMayor(remota, this.appVersion);
      },
      error: () => {
        // Silencioso: no interrumpir la UI si el chequeo falla
      }
    });
  }

  /** Compara semver (major.minor.patch). True si `remota` es estrictamente mayor que `local`. */
  private esVersionMayor(remota: string, local: string): boolean {
    const parse = (v: string): number[] =>
      v.replace(/^v/i, '').split('.').map(p => parseInt(p, 10) || 0);
    const a = parse(remota);
    const b = parse(local);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  private refreshMenu(): void {
    const allItems = this.filterMenuByRole();
    const mainItems = allItems.filter(i => !i.bottomSection);
    this.useGroupedMenu = this.debeUsarMenuAgrupado();

    if (this.useGroupedMenu) {
      this.menuSections = this.buildMenuSections(mainItems);
      this.menuItems = [];
    } else {
      this.menuItems = this.orderMainMenuItems(mainItems);
      this.menuSections = [];
    }

    this.bottomMenuItems = allItems.filter(i => i.bottomSection);
    this.logoRoute = this.calcularLogoRoute();
  }

  /**
   * Lista plana: orden específico para perfil empresa; Calendario y Correo al final.
   */
  private orderMainMenuItems(items: RouteInfo[]): RouteInfo[] {
    // Perfil empresa: orden fijo pedido por UX
    if (this.authService.esUsuarioEmpresa()) {
      const ordenEmpresa = [
        '/curso-activos',
        '/empleados-empresa',
        '/historial-cursos',
        '/chat-empresas',
        '/proteccion-civil',
        '/quejas-sugerencias'
      ];
      const byPath = new Map(items.map((item) => [item.path, item]));
      const ordered: RouteInfo[] = [];
      for (const path of ordenEmpresa) {
        const item = byPath.get(path);
        if (item) {
          ordered.push(item);
          byPath.delete(path);
        }
      }
      for (const item of items) {
        if (byPath.has(item.path)) {
          ordered.push(item);
          byPath.delete(item.path);
        }
      }
      return ordered;
    }

    const calendarioPath = '/calendario';
    const correoPath = '/correo';
    const calendarioItem = items.find(item => item.path === calendarioPath);
    const correoItem = items.find(item => item.path === correoPath);

    if (!calendarioItem && !correoItem) {
      return items;
    }

    const withoutPinned = items.filter(item => item.path !== calendarioPath && item.path !== correoPath);

    if (calendarioItem && correoItem) {
      return [...withoutPinned, calendarioItem, correoItem];
    }

    if (calendarioItem) {
      return [...withoutPinned, calendarioItem];
    }

    return [...withoutPinned, correoItem as RouteInfo];
  }

  /**
   * Menú categorizado por áreas para todos los perfiles internos.
   * Perfil empresa sigue en lista plana (pocas pantallas).
   */
  private debeUsarMenuAgrupado(): boolean {
    if (this.authService.esUsuarioEmpresa()) {
      return false;
    }
    return true;
  }

  private rolesUnicosUsuario(): string[] {
    const fromList = this.authService.getRoles().map((role) => String(role || '').toLowerCase().trim()).filter(Boolean);
    if (fromList.length) {
      return [...new Set(fromList)];
    }
    const unico = String(this.authService.getRol() || '').toLowerCase().trim();
    return unico ? [unico] : [];
  }

  /**
   * Agrupa los items del menú principal en secciones (con encabezado opcional)
   * respetando el orden y la agrupación definidos en MENU_GROUPS.
   * Solo se incluyen las secciones que tengan al menos un item visible.
   * Cualquier item no contemplado en MENU_GROUPS se añade al final sin encabezado.
   */
  private buildMenuSections(items: RouteInfo[]): MenuSection[] {
    const itemsByPath = new Map(items.map(item => [item.path, item]));
    const sections: MenuSection[] = [];

    for (const group of MENU_GROUPS) {
      const groupItems = group.paths
        .map(path => itemsByPath.get(path))
        .filter((item): item is RouteInfo => !!item);

      if (groupItems.length > 0) {
        sections.push({ title: group.title, items: groupItems });
      }
    }

    // Red de seguridad: items visibles que no estén listados en ningún grupo
    const coveredPaths = new Set(MENU_GROUPS.flatMap(group => group.paths));
    const leftovers = items.filter(item => !coveredPaths.has(item.path));
    if (leftovers.length > 0) {
      sections.push({ items: leftovers });
    }

    return sections;
  }

  /**
   * Indica si un grupo debe mostrarse abierto: cuando el usuario lo fijó
   * o cuando contiene la ruta actualmente activa. Los grupos sin encabezado
   * (items sueltos) siempre se muestran.
   */
  isGroupOpen(section: MenuSection): boolean {
    if (!section.title) {
      return true;
    }
    return this.expandedGroups.has(section.title) || this.isGroupActive(section);
  }

  /** True si alguno de los items del grupo corresponde a la ruta activa. */
  isGroupActive(section: MenuSection): boolean {
    return section.items.some(item => this.isPathActive(item.path));
  }

  private isPathActive(path: string): boolean {
    if (!this.currentUrl) {
      return false;
    }
    return this.currentUrl === path || this.currentUrl.startsWith(path + '/');
  }

  /** Fija/desfija un grupo (clic en el encabezado) y persiste el estado. */
  toggleGroup(title: string | undefined, event?: Event): void {
    if (!title) {
      return;
    }
    event?.preventDefault();
    if (this.expandedGroups.has(title)) {
      this.expandedGroups.delete(title);
    } else {
      this.expandedGroups.add(title);
    }
    this.saveExpandedGroups();
  }

  private loadExpandedGroups(): void {
    try {
      const raw = localStorage.getItem(SidebarComponent.EXPANDED_GROUPS_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as string[];
        if (Array.isArray(stored)) {
          this.expandedGroups = new Set(stored);
        }
      }
    } catch {
      // localStorage no disponible o JSON inválido: se ignora
    }
  }

  private saveExpandedGroups(): void {
    try {
      localStorage.setItem(
        SidebarComponent.EXPANDED_GROUPS_STORAGE_KEY,
        JSON.stringify([...this.expandedGroups])
      );
    } catch {
      // localStorage no disponible: se ignora
    }
  }

  /**
   * Filtra el menú según los roles del usuario (soporta multi-rol)
   * El rol 'root' ve todos los items
   */
  private filterMenuByRole(): RouteInfo[] {
    const userRoles = this.authService.getRoles();
    const userRole = this.authService.getRol()?.toLowerCase();
    
    return ROUTES.filter(item => {
      if (item.path === '/proteccion-civil') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        if (esEmpresa && !this.authService.empresaTieneServicioProteccionCivil()) {
          return false;
        }
      }

      if (item.path === '/control-capacitacion' || item.path === '/proteccion-civil/control-resolutivos') {
        if (item.path === '/control-capacitacion') {
          if (!this.authService.esAdministradorOSuperior() && !this.authService.tieneRol('control_documental')) {
            return false;
          }
        } else if (!this.authService.esAdministradorOSuperior()) {
          return false;
        }
      }

      // Aviso de privacidad solo aplica para perfil empresa
      if (item.path === '/aviso-privacidad') {
        return userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
      }

      // Correo personal no aplica para perfil empresa
      if (item.path === '/correo') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        if (esEmpresa) {
          return false;
        }
      }

      // Mis empresas: todos los perfiles excepto empresa (ver y registrar)
      if (item.path === '/mis-empresas') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        return !esEmpresa;
      }

      // Solicitud de Documentos SGC: solo root o perfil Calidad (Sergio)
      if (item.path === '/sistema-gestion-calidad/solicitud-documentos') {
        return this.authService.puedeGestionarDelegacionesSgc();
      }

      // Centro SGC, Procedimientos, Instructivos, Formatos y Normativas: todos los perfiles excepto empresa
      if (item.path === '/sistema-gestion-calidad'
        || item.path === '/sistema-gestion-calidad/procedimientos'
        || item.path === '/sistema-gestion-calidad/instructivos'
        || item.path === '/sistema-gestion-calidad/formatos'
        || item.path === '/sistema-gestion-calidad/normativas') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        return !esEmpresa;
      }

      // Seguridad · Normativas: todos los perfiles excepto empresa
      if (item.path === '/seguridad/normativas' || item.path.startsWith('/seguridad/')) {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        return !esEmpresa;
      }

      // Recursos Humanos (datos sensibles): solo root, administrador y rrhh
      if (item.path === '/recursos-humanos/residentes' || item.path.startsWith('/recursos-humanos/')) {
        return userRoles.some(role => ['root', 'administrador', 'rrhh'].includes(role.toLowerCase()))
          || ['root', 'administrador', 'rrhh'].includes(String(userRole || '').toLowerCase());
      }

      // Capítulos SGC queda integrado en Centro SGC (ruta principal)
      if (item.path === '/sistema-gestion-calidad/capitulos') {
        return false;
      }

      // Control de Proyectos y Control de Oficios: todos los perfiles excepto empresa
      if (item.path === '/control-proyectos' || item.path === '/control-oficios') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        return !esEmpresa;
      }

      // Solicitud de mantenimiento (Forms EIN-F-02): todos excepto empresa
      if (item.path === '/mantenimiento/solicitud') {
        const esEmpresa = userRoles.some(role => role.toLowerCase() === 'empresa') || userRole === 'empresa';
        return !esEmpresa;
      }

      // Si no tiene roles definidos, todos pueden verlo
      if (!item.roles || item.roles.length === 0) {
        return true;
      }
      // El rol root siempre ve todo
      if (userRole === 'root' || userRoles.includes('root')) {
        return true;
      }
      // Verificar si alguno de los roles del usuario coincide con los roles del item
      return item.roles.some(role =>
        userRoles.includes(role.toLowerCase()) || role.toLowerCase() === userRole
      );
    });
  }

  /**
   * Evita que /proteccion-civil quede activo al entrar en rutas hijas (p. ej. control-resolutivos).
   */
  getRouterLinkActiveOptions(path: string): { exact: boolean } {
    return this.routerLinkActiveOptionsByPath.get(path) ?? SidebarComponent.ROUTER_LINK_PREFIX;
  }

  isLinkActive(menuItem: RouteInfo): boolean {
    const path = menuItem.path;
    if (path === '/sistema-gestion-calidad/procedimientos') {
      return this.currentUrl.startsWith('/sistema-gestion-calidad/procedimientos');
    }
    if (path === '/sistema-gestion-calidad/instructivos') {
      return this.currentUrl.startsWith('/sistema-gestion-calidad/instructivos');
    }
    if (path === '/sistema-gestion-calidad/formatos') {
      return this.currentUrl.startsWith('/sistema-gestion-calidad/formatos');
    }
    if (path === '/sistema-gestion-calidad/normativas') {
      return this.currentUrl.startsWith('/sistema-gestion-calidad/normativas');
    }
    if (path === '/sistema-gestion-calidad/solicitud-documentos') {
      return this.currentUrl.startsWith('/sistema-gestion-calidad/solicitud-documentos');
    }
    if (path === '/seguridad/normativas') {
      return this.currentUrl.startsWith('/seguridad');
    }
    if (path === '/sistema-gestion-calidad') {
      return this.isSgcSectionActive();
    }
    const opts = this.getRouterLinkActiveOptions(path);
    if (opts.exact) {
      return this.currentUrl === path || this.currentUrl === `${path}/`;
    }
    return this.isPathActive(path);
  }

  private isSgcSectionActive(): boolean {
    const url = this.currentUrl;
    if (url === '/sistema-gestion-calidad' || url.startsWith('/sistema-gestion-calidad?')) {
      return true;
    }
    if (url.startsWith('/sistema-gestion-calidad/capitulos')) {
      return true;
    }
    return this.sgcCapituloSlugs.some(
      slug => url === `/sistema-gestion-calidad/${slug}` || url.startsWith(`/sistema-gestion-calidad/${slug}/`)
    );
  }

  private calcularLogoRoute(): string {
    const rol = this.authService.getRol()?.toLowerCase();
    if (rol === 'proteccion_civil') return '/proteccion-civil';
    if (rol === 'sgc') return '/sistema-gestion-calidad';
    if (rol === 'ambiental') return '/ambiental';
    if (rol === 'iot') return '/sensores';
    if (rol === 'rrhh') return '/recursos-humanos/colaboradores';
    if (rol === 'empresa') return '/curso-activos';
    if (rol === 'control_documental') return '/historial-cursos';
    return '/dashboard';
  }

  closeSidebar() {
    if (window.innerWidth < 768) {
      this.sidebarService.hideSidebar();
    }
  }

  isMobile(): boolean {
    return window.innerWidth < 768;
  }
}
