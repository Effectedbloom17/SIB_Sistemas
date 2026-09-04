import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ROUTES } from '../sidebar/sidebar.component';
import { Location } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { AuthService } from 'src/app/services/auth.service';
import { SidebarService } from 'src/app/services/sidebar.service';
import { BackendServices } from 'src/app/services/backend.services';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import { NgbDropdown } from '@ng-bootstrap/ng-bootstrap';
import { Subject, timer, of } from 'rxjs';
import { takeUntil, filter, debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { LanguageService } from 'src/app/services/language.service';
import { NotificacionesService } from 'src/app/services/notificaciones.service';
import {
  HistorialPendientesService,
  HistorialPendienteItem
} from 'src/app/services/historial-pendientes.service';
import {
  SGC_FORMATOS_DESCARGA_CATALOG,
  SGC_FORMATOS_CATEGORIAS
} from 'src/app/pages/sistema-gestion-calidad/sgc-formatos-descarga.catalog';
import {
  SGC_PROCEDIMIENTOS_CATALOG,
  SGC_PROCEDIMIENTOS_CATEGORIAS
} from 'src/app/pages/sistema-gestion-calidad/sgc-procedimientos.catalog';
import {
  SGC_INSTRUCTIVOS_CATALOG,
  SGC_INSTRUCTIVOS_CATEGORIAS
} from 'src/app/pages/sistema-gestion-calidad/sgc-instructivos.catalog';
import {
  SGC_NORMATIVAS_CATALOG
} from 'src/app/pages/sistema-gestion-calidad/sgc-normativas.catalog';
import {
  SgcDocCatalogoItem,
  TipoSolicitudDocumento,
  TIPO_SOLICITUD_LABELS,
  catalogoDocumentosFallback,
  filtrarDocumentosCatalogo,
  inferirTipoDocumentoDesdeCodigo,
  mapearTipoDocumentoSolicitud,
  resolverDocumentoCatalogo,
  etiquetaDocumentoCatalogo
} from 'src/app/pages/sistema-gestion-calidad/sgc-solicitud-documentos.util';

/** Entrada del buscador global del navbar. */
export interface BusquedaSistemaItem {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: 'apartado' | 'funcion' | 'documento';
  icono: string;
  ruta: string;
  keywords: string[];
  roles?: string[];
  /** Si es true, la ruta abre el visor integrado del archivo. */
  abreVisor?: boolean;
}

/** Pausa IMAP si el buzón no responde; sobrevive recreaciones del navbar (HMR). */
let correoImapBackoffUntilGlobal = 0;

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  public focus;
  public listTitles: any[];
  public location: Location;
  public nombreUsuario: string = 'Usuario';
  public fotoUrl: string | null = null;
  public esDoctor = false;
  public idiomaActual: 'es' | 'en' = 'es';
  notifAbiertas = false;
  isUserMenuOpen = false;

  /** Buscador global (izquierda del perfil). */
  busquedaExpandida = false;
  busquedaQuery = '';
  resultadosBusqueda: BusquedaSistemaItem[] = [];
  resultadoActivo = -1;
  busquedaCargando = false;
  private catalogoBusqueda: BusquedaSistemaItem[] = [];
  private busquedaFijada = false;
  private busquedaQuery$ = new Subject<string>();
  private resultadosRemotos: BusquedaSistemaItem[] = [];
  private resultadosLocales: BusquedaSistemaItem[] = [];
  alertas: any[] = [];
  notifPersonales: any[] = [];
  /** Capacitaciones finalizadas pendientes de revisión (admins). */
  cursosFinalizadosPendientes: HistorialPendienteItem[] = [];
  notifGrupos: Array<{
    key: string;
    titulo: string;
    icono: string;
    color: string;
    items: any[];
    orden: number;
  }> = [];
  /** Áreas colapsadas por el usuario (key de categoría). */
  notifGruposColapsados = new Set<string>();
  mostrarNotificaciones = true;
  mostrarNotificacionCorreo = false;
  correosNoLeidos = 0;
  private correoImapEnVuelo = false;

  /** Funcionamiento del sistema (alta de tickets). */
  funcionamientoAbierto = false;
  areasTicket: string[] = [];
  prioridadesTicket: Array<{ valor: string; label: string }> = [
    { valor: 'critica', label: 'Crítica' },
    { valor: 'urgente', label: 'Urgente' },
    { valor: 'prioritaria', label: 'Prioritaria' },
    { valor: 'normal', label: 'Normal' },
    { valor: 'no_prioritaria', label: 'No prioritaria' }
  ];
  ticketArea = '';
  ticketPrioridad = 'normal';
  ticketTipo = '';
  ticketDescripcion = '';
  enviandoTicket = false;
  ticketEnviadoOk = false;
  ticketError: string | null = null;
  areaMenuAbierto = false;
  prioridadMenuAbierto = false;
  readonly maxEvidencias = 8;
  ticketEvidencias: Array<{ file: File; previewUrl: string; descripcion: string }> = [];

  /** Solicitud de cambios a documentos SGC (navbar). */
  solicitudDocAbierto = false;
  solDocCatalogo: SgcDocCatalogoItem[] = [];
  solDocCatalogoCargado = false;
  solDocComboAbierto = false;
  solDocQuery = '';
  solDocNombre = '';
  solDocCodigo = '';
  solDocVersion = '';
  solDocTipoDocumento = '';
  solDocTipoSolicitud: TipoSolicitudDocumento = 'modificacion';
  solDocMotivo = '';
  enviandoSolDoc = false;
  solDocEnviadoOk = false;
  solDocError: string | null = null;
  readonly solDocTiposOpciones: Array<{ id: TipoSolicitudDocumento; label: string; icon: string }> = [
    { id: 'creacion', label: TIPO_SOLICITUD_LABELS.creacion, icon: 'fa-plus-circle' },
    { id: 'modificacion', label: TIPO_SOLICITUD_LABELS.modificacion, icon: 'fa-edit' },
    { id: 'eliminacion', label: TIPO_SOLICITUD_LABELS.eliminacion, icon: 'fa-trash-alt' }
  ];

  /** Panel Estatus de Tickets (solo tickets del usuario). */
  estatusTicketsAbiertos = false;
  misTickets: Array<{
    ticket_id: number;
    area: string;
    descripcion: string;
    estado?: string;
    prioridad?: string;
    tipo?: string;
    created_at?: string;
    updated_at?: string;
  }> = [];
  cargandoMisTickets = false;

  private static readonly AREA_META: Record<string, { titulo: string; icono: string; color: string; orden: number }> = {
    capacitacion: { titulo: 'Capacitación', icono: 'fa-graduation-cap', color: '#38512F', orden: 1 },
    control_documental: { titulo: 'Control Documental', icono: 'fa-file-alt', color: '#8965e0', orden: 2 },
    pc: { titulo: 'Protección Civil', icono: 'fa-shield-alt', color: '#fb6340', orden: 3 },
    ambiental: { titulo: 'Ambiental', icono: 'fa-tree', color: '#2dce89', orden: 4 },
    general: { titulo: 'General', icono: 'fa-bell', color: '#5e72e4', orden: 9 }
  };

  get totalNotificaciones(): number {
    const alertasCount = this.alertas.reduce((sum, a) => sum + (a.items?.length || 0), 0);
    const personalesSinDup = this.notifPersonales.filter((n) => {
      const t = String(n?.titulo || '').toLowerCase();
      return !t.includes('capacitación finalizada') && !t.includes('capacitacion finalizada');
    }).length;
    return alertasCount + personalesSinDup + this.cursosFinalizadosPendientes.length;
  }

  get hayNotificaciones(): boolean {
    return this.notifGrupos.length > 0
      || this.alertas.length > 0
      || this.cursosFinalizadosPendientes.length > 0;
  }

  get mostrarSolicitudDocumentosNavbar(): boolean {
    return !this.authService.esUsuarioEmpresa();
  }

  get solDocCatalogoFiltrado(): SgcDocCatalogoItem[] {
    return filtrarDocumentosCatalogo(this.solDocCatalogo, this.solDocQuery);
  }

  get solDocFormularioValido(): boolean {
    const tieneDoc = !!(String(this.solDocNombre || '').trim() || String(this.solDocCodigo || '').trim());
    return tieneDoc && !!String(this.solDocMotivo || '').trim() && !this.enviandoSolDoc;
  }
  
  @ViewChild('userDropdown') userDropdown: NgbDropdown;
  @ViewChild('busquedaInput') busquedaInput?: ElementRef<HTMLInputElement>;
  @ViewChild('evidenciaInput') evidenciaInput?: ElementRef<HTMLInputElement>;

  get resultadoActivoId(): string | null {
    return this.resultadoActivo >= 0 ? `global-search-result-${this.resultadoActivo}` : null;
  }

  private buildDrivePreviewUrl(driveId: string, version?: string | number): string | null {
    return this.backendServices.resolverUrlDrivePreview(driveId);
  }

  constructor(
    location: Location,
    private router: Router,
    private authService: AuthService,
    public sidebarService: SidebarService,
    private http: HttpClient,
    private languageService: LanguageService,
    private notificacionesService: NotificacionesService,
    private historialPendientes: HistorialPendientesService,
    private backendServices: BackendServices,
    private cdr: ChangeDetectorRef
  ) {
    this.location = location;
  }
  
  // Cerrar dropdown cuando el usuario hace scroll
  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (this.userDropdown && this.userDropdown.isOpen()) {
      this.userDropdown.close();
    }
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.notifAbiertas = false;
    this.funcionamientoAbierto = false;
    this.estatusTicketsAbiertos = false;
    this.solicitudDocAbierto = false;
    this.solDocComboAbierto = false;
    this.cerrarMenusTicket();
    this.cerrarBusqueda();
  }

  expandirBusqueda(): void {
    this.busquedaExpandida = true;
    this.notifAbiertas = false;
    this.funcionamientoAbierto = false;
    this.estatusTicketsAbiertos = false;
    this.solicitudDocAbierto = false;
  }

  toggleBusqueda(e: Event): void {
    e.stopPropagation();
    if (this.busquedaExpandida && this.busquedaFijada) {
      this.cerrarBusqueda();
      return;
    }
    this.busquedaFijada = true;
    this.expandirBusqueda();
    setTimeout(() => this.busquedaInput?.nativeElement?.focus(), 80);
  }

  colapsarBusquedaSiInactiva(): void {
    if (this.busquedaFijada || this.busquedaQuery.trim()) {
      return;
    }
    const activo = document.activeElement;
    if (activo && this.busquedaInput?.nativeElement === activo) {
      return;
    }
    this.busquedaExpandida = false;
  }

  cerrarBusqueda(): void {
    this.busquedaExpandida = false;
    this.busquedaFijada = false;
    this.busquedaQuery = '';
    this.resultadosBusqueda = [];
    this.resultadosRemotos = [];
    this.resultadosLocales = [];
    this.resultadoActivo = -1;
    this.busquedaCargando = false;
  }

  filtrarBusqueda(): void {
    const raw = String(this.busquedaQuery || '').trim();
    const q = this.normalizarTexto(raw);
    if (!q) {
      this.resultadosBusqueda = [];
      this.resultadosRemotos = [];
      this.resultadosLocales = [];
      this.resultadoActivo = -1;
      this.busquedaCargando = false;
      return;
    }

    const tokens = q.split(/\s+/).filter(Boolean);
    this.resultadosLocales = this.catalogoBusqueda
      .map((item) => ({ item, score: this.puntuarResultado(item, tokens, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.item.titulo.localeCompare(b.item.titulo))
      .slice(0, 8)
      .map((r) => r.item);

    this.combinarResultadosBusqueda();
    this.busquedaQuery$.next(raw);
  }

  private combinarResultadosBusqueda(): void {
    const vistos = new Set<string>();
    const merged: BusquedaSistemaItem[] = [];
    const fuente = [...this.resultadosRemotos, ...this.resultadosLocales];
    const ordenados = [
      ...fuente.filter((item) => item.abreVisor || this.rutaAbreVisor(item.ruta)),
      ...fuente.filter((item) => !(item.abreVisor || this.rutaAbreVisor(item.ruta)))
    ];
    for (const item of ordenados) {
      const key = item.id.startsWith('sgc-fmt-') || item.id.startsWith('sgc-proc-')
        ? item.id
        : (item.ruta || item.id);
      if (vistos.has(key)) continue;
      vistos.add(key);
      merged.push(item);
      if (merged.length >= 12) break;
    }
    this.resultadosBusqueda = merged;
    this.resultadoActivo = merged.length ? 0 : -1;
  }

  private rutaAbreVisor(ruta: string): boolean {
    return /[?&](codigo|doc|documentoId|tramiteId)=/i.test(String(ruta || ''));
  }

  private iniciarBusquedaRemota(): void {
    this.busquedaQuery$.pipe(
      debounceTime(280),
      distinctUntilChanged(),
      switchMap((raw) => {
        const q = String(raw || '').trim();
        if (q.length < 2) {
          this.resultadosRemotos = [];
          this.busquedaCargando = false;
          this.combinarResultadosBusqueda();
          return of({ success: true, resultados: [] });
        }
        this.busquedaCargando = true;
        return this.backendServices.buscarGlobalSistema(q).pipe(
          catchError(() => of({ success: false, resultados: [] }))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe((res) => {
      this.busquedaCargando = false;
      const lista = Array.isArray(res?.resultados) ? res.resultados : [];
      this.resultadosRemotos = lista.map((r: any, idx: number) => {
        const ruta = String(r.ruta || '/');
        return {
          id: String(r.id || `remoto-${idx}`),
          titulo: String(r.titulo || 'Resultado'),
          descripcion: String(r.descripcion || ''),
          tipo: (r.tipo === 'funcion' || r.tipo === 'apartado' ? r.tipo : 'documento') as BusquedaSistemaItem['tipo'],
          icono: String(r.icono || 'fa-search').replace(/^fas\s+/, ''),
          ruta,
          keywords: [],
          abreVisor: this.rutaAbreVisor(ruta)
        };
      });
      this.combinarResultadosBusqueda();
    });
  }

  onBusquedaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarBusqueda();
      this.busquedaInput?.nativeElement?.blur();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.resultadosBusqueda.length) return;
      this.resultadoActivo = (this.resultadoActivo + 1) % this.resultadosBusqueda.length;
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.resultadosBusqueda.length) return;
      this.resultadoActivo = this.resultadoActivo <= 0
        ? this.resultadosBusqueda.length - 1
        : this.resultadoActivo - 1;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.resultadosBusqueda[this.resultadoActivo] || this.resultadosBusqueda[0];
      if (item) {
        this.irAResultado(item, event);
      }
    }
  }

  irAResultado(item: BusquedaSistemaItem, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!item?.ruta) return;
    this.cerrarBusqueda();
    this.router.navigateByUrl(item.ruta);
  }

  tipoBusquedaLabel(item: BusquedaSistemaItem): string {
    if (item?.abreVisor || this.rutaAbreVisor(item?.ruta)) {
      return 'Visor';
    }
    const map: Record<BusquedaSistemaItem['tipo'], string> = {
      apartado: 'Apartado',
      funcion: 'Función',
      documento: 'Documento'
    };
    return map[item?.tipo] || 'Apartado';
  }

  trackByBusquedaId(_index: number, item: BusquedaSistemaItem): string {
    return item?.id || String(_index);
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private puntuarResultado(item: BusquedaSistemaItem, tokens: string[], query: string): number {
    const titulo = this.normalizarTexto(item.titulo);
    const desc = this.normalizarTexto(item.descripcion);
    const keys = this.normalizarTexto((item.keywords || []).join(' '));
    const haystack = `${titulo} ${desc} ${keys}`;

    if (!tokens.every((t) => haystack.includes(t))) {
      return 0;
    }

    let score = 10;
    if (titulo === query) score += 100;
    else if (titulo.startsWith(query)) score += 60;
    else if (titulo.includes(query)) score += 35;
    if (keys.includes(query)) score += 20;
    if (item.tipo === 'apartado') score += 5;
    if (item.abreVisor) score += 18;
    return score;
  }

  private rebuildCatalogoBusqueda(): void {
    const extras: BusquedaSistemaItem[] = [
      {
        id: 'fn-perfil',
        titulo: 'Mi Perfil',
        descripcion: 'Datos de cuenta, foto y preferencias',
        tipo: 'funcion',
        icono: 'fa-user',
        ruta: '/user-profile',
        keywords: ['perfil', 'cuenta', 'usuario', 'foto', 'password', 'contraseña']
      },
      {
        id: 'fn-correo',
        titulo: 'Bandeja de correo',
        descripcion: 'Revisar correos pendientes del sistema',
        tipo: 'funcion',
        icono: 'fa-envelope',
        ruta: '/correo',
        keywords: ['mail', 'inbox', 'mensajes', 'email'],
        roles: ['root', 'administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'doctor', 'sgc', 'ambiental', 'innovacion', 'control_documental']
      },
      {
        id: 'doc-dc3',
        titulo: 'Constancias y DC-3',
        descripcion: 'Buscar constancias y DC-3 generadas por folio',
        tipo: 'documento',
        icono: 'fa-file-alt',
        ruta: '/historial-constancias-dc3',
        keywords: ['dc3', 'dc-3', 'constancia', 'diploma', 'certificado', 'stps', 'folio'],
        roles: ['root', 'administrador', 'control_documental']
      },
      {
        id: 'doc-sgc-centro',
        titulo: 'Centro SGC',
        descripcion: 'Centro del Sistema de Gestión de Calidad',
        tipo: 'apartado',
        icono: 'fa-chart-pie',
        ruta: '/sistema-gestion-calidad',
        keywords: ['sgc', 'calidad', 'centro', 'iso', 'gestion']
      },
      {
        id: 'doc-sgc-formatos',
        titulo: 'Formatos SGC',
        descripcion: 'Descarga de formatos del sistema de gestión',
        tipo: 'documento',
        icono: 'fa-file-download',
        ruta: '/sistema-gestion-calidad/formatos',
        keywords: ['formato', 'plantilla', 'sgc', 'calidad', 'descarga']
      },
      {
        id: 'doc-sgc-normativas',
        titulo: 'Normativas',
        descripcion: 'Normas Oficiales Mexicanas (NOM-STPS) para consultar y descargar',
        tipo: 'documento',
        icono: 'fa-file-pdf',
        ruta: '/sistema-gestion-calidad/normativas',
        keywords: ['normativa', 'nom', 'stps', 'pdf', 'sgc', 'calidad']
      },
      {
        id: 'doc-sgc-procedimientos',
        titulo: 'Procedimientos SGC',
        descripcion: 'Procedimientos documentados del SGC',
        tipo: 'documento',
        icono: 'fa-book',
        ruta: '/sistema-gestion-calidad/procedimientos',
        keywords: ['procedimiento', 'manual', 'sgc', 'calidad']
      },
      {
        id: 'doc-sgc-instructivos',
        titulo: 'Instructivos SGC',
        descripcion: 'Instructivos documentados del SGC',
        tipo: 'documento',
        icono: 'fa-list-alt',
        ruta: '/sistema-gestion-calidad/instructivos',
        keywords: ['instructivo', 'folio', 'cotizacion', 'sgc', 'calidad']
      },
      {
        id: 'fn-tramites',
        titulo: 'Estatus de trámites ambientales',
        descripcion: 'Seguimiento de trámites y oficios ambientales',
        tipo: 'funcion',
        icono: 'fa-clipboard-list',
        ruta: '/control-tramites',
        keywords: ['tramite', 'estatus', 'ambiental', 'oficio', 'seguimiento'],
        roles: ['root', 'administrador', 'ambiental']
      },
        {
        id: 'fn-pc-docs',
        titulo: 'Documentos de Protección Civil',
        descripcion: 'Documentación PC por empresa',
        tipo: 'documento',
        icono: 'fa-shield-alt',
        ruta: '/proteccion-civil',
        keywords: ['pc', 'proteccion civil', 'documento', 'pipc', 'brigada'],
        roles: ['root', 'administrador', 'proteccion_civil']
      },
      {
        id: 'fn-historial-pc',
        titulo: 'Historial PC',
        descripcion: 'Trámites PIPC finalizados y su expediente',
        tipo: 'documento',
        icono: 'fa-history',
        ruta: '/proteccion-civil/historial-pc',
        keywords: ['historial pc', 'pipc', 'tramite', 'oficio', 'resolutivo'],
        roles: ['root', 'administrador', 'proteccion_civil']
      },
      {
        id: 'fn-senalizacion',
        titulo: 'Proyectos de Señalización',
        descripcion: 'Cotizaciones y proyectos de señalización',
        tipo: 'funcion',
        icono: 'fa-drafting-compass',
        ruta: '/diseno-innovacion',
        keywords: ['senalizacion', 'senal', 'cotizacion', 'innovacion', 'folio'],
        roles: ['root', 'administrador', 'innovacion']
      },
      {
        id: 'fn-mantenimiento-ein-f01',
        titulo: 'Programa de mantenimiento a la infraestructura',
        descripcion: 'Formato EIN-F-01 · calendario anual de mantenimiento',
        tipo: 'funcion',
        icono: 'fa-industry',
        ruta: '/mantenimiento/programa-infraestructura',
        keywords: ['mantenimiento', 'infraestructura', 'ein-f-01', 'programa', 'ein'],
        roles: ['root', 'administrador', 'mantenimiento']
      },
      {
        id: 'fn-mantenimiento-ein-f02',
        titulo: 'Solicitud de mantenimiento',
        descripcion: 'Formato EIN-F-02 · solicitudes con folio EIFF02',
        tipo: 'funcion',
        icono: 'fa-file-signature',
        ruta: '/mantenimiento/solicitud',
        keywords: ['solicitud', 'mantenimiento', 'ein-f-02', 'eiff02', 'folio']
      },
      {
        id: 'fn-rrhh-colaboradores',
        titulo: 'Colaboradores RRHH',
        descripcion: 'Expediente documental de colaboradores',
        tipo: 'funcion',
        icono: 'fa-id-badge',
        ruta: '/recursos-humanos/colaboradores',
        keywords: ['rrhh', 'colaborador', 'expediente', 'recursos humanos', 'personal'],
        roles: ['root', 'administrador', 'rrhh']
      },
      {
        id: 'fn-rrhh-residentes',
        titulo: 'Residentes',
        descripcion: 'Registro de residentes de Recursos Humanos',
        tipo: 'funcion',
        icono: 'fa-user-friends',
        ruta: '/recursos-humanos/residentes',
        keywords: ['rrhh', 'residente', 'recursos humanos'],
        roles: ['root', 'administrador', 'rrhh']
      },
      {
        id: 'fn-repositorio',
        titulo: 'Repositorio',
        descripcion: 'Repositorio de documentación e innovación',
        tipo: 'documento',
        icono: 'fa-folder-open',
        ruta: '/diseno-innovacion/repositorio',
        keywords: ['repositorio', 'archivo', 'documento', 'innovacion'],
        roles: ['root', 'administrador', 'innovacion', 'sgc']
      },
      {
        id: 'fn-repositorio-empresarial',
        titulo: 'Repositorio Empresarial',
        descripcion: 'Documentos e información base de cada empresa',
        tipo: 'documento',
        icono: 'fa-building',
        ruta: '/mis-empresas',
        keywords: ['repositorio empresarial', 'expediente empresa', 'documentos empresa', 'carpeta empresa']
      },
      {
        id: 'fn-oficios',
        titulo: 'Control de oficios',
        descripcion: 'Registro y seguimiento de oficios',
        tipo: 'funcion',
        icono: 'fa-folder-open',
        ruta: '/control-oficios',
        keywords: ['oficio', 'documento', 'control documental', 'expediente']
      },
      {
        id: 'fn-proyectos',
        titulo: 'Control de proyectos',
        descripcion: 'Avance y gestión de proyectos',
        tipo: 'funcion',
        icono: 'fa-project-diagram',
        ruta: '/control-proyectos',
        keywords: ['proyecto', 'avance', 'gestion', 'control']
      },
      {
        id: 'fn-calendario',
        titulo: 'Calendario de actividades',
        descripcion: 'Agenda y programación de cursos',
        tipo: 'funcion',
        icono: 'fa-calendar-alt',
        ruta: '/calendario',
        keywords: ['agenda', 'fecha', 'programacion', 'curso'],
        roles: ['root', 'administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'control_documental']
      },
      {
        id: 'fn-tickets',
        titulo: 'Inbox de tickets',
        descripcion: 'Fallas y sugerencias de funcionamiento del sistema',
        tipo: 'funcion',
        icono: 'fa-ticket-alt',
        ruta: '/tickets',
        keywords: ['ticket', 'falla', 'sugerencia', 'mejora', 'funcionamiento'],
        roles: ['root']
      }
    ];

    const categoriasSgc = new Map(SGC_FORMATOS_CATEGORIAS.map((c) => [c.id, c]));
    const formatosSgc: BusquedaSistemaItem[] = (SGC_FORMATOS_DESCARGA_CATALOG || []).map((fmt) => {
      const cat = categoriasSgc.get(fmt.categoriaId);
      const icono = fmt.tipo === 'excel'
        ? 'fa-file-excel'
        : fmt.tipo === 'word'
          ? 'fa-file-word'
          : fmt.tipo === 'pdf'
            ? 'fa-file-pdf'
            : 'fa-file-download';
      return {
        id: `sgc-fmt-${fmt.id}`,
        titulo: `${fmt.codigo} · ${fmt.titulo}`,
        descripcion: cat ? `Formato SGC · ${cat.titulo}` : 'Formato del Sistema de Gestión',
        tipo: 'documento' as const,
        icono,
        ruta: `/sistema-gestion-calidad/formatos?codigo=${encodeURIComponent(fmt.codigo)}&cap=${encodeURIComponent(fmt.categoriaId)}`,
        keywords: [fmt.codigo, fmt.titulo, fmt.nombreArchivo, 'formato', 'sgc', cat?.titulo || ''],
        abreVisor: true
      };
    });

    const catsProc = new Map(SGC_PROCEDIMIENTOS_CATEGORIAS.map((c) => [c.id, c]));
    const procedimientosSgc: BusquedaSistemaItem[] = (SGC_PROCEDIMIENTOS_CATALOG || []).map((proc) => {
      const cat = catsProc.get(proc.categoriaId);
      return {
        id: `sgc-proc-${proc.codigo}`,
        titulo: `${proc.codigo} · ${proc.titulo}`,
        descripcion: cat ? `Procedimiento SGC · ${cat.titulo}` : 'Procedimiento del Sistema de Gestión',
        tipo: 'documento' as const,
        icono: 'fa-file-alt',
        ruta: `/sistema-gestion-calidad/procedimientos?codigo=${encodeURIComponent(proc.codigo)}&cat=${encodeURIComponent(proc.categoriaId)}`,
        keywords: [proc.codigo, proc.titulo, 'procedimiento', 'sgc', cat?.titulo || ''],
        abreVisor: true
      };
    });

    const catsInst = new Map(SGC_INSTRUCTIVOS_CATEGORIAS.map((c) => [c.id, c]));
    const instructivosSgc: BusquedaSistemaItem[] = (SGC_INSTRUCTIVOS_CATALOG || []).map((inst) => {
      const cat = catsInst.get(inst.categoriaId);
      return {
        id: `sgc-inst-${inst.codigo}`,
        titulo: `${inst.codigo} · ${inst.titulo}`,
        descripcion: cat ? `Instructivo SGC · ${cat.titulo}` : 'Instructivo del Sistema de Gestión',
        tipo: 'documento' as const,
        icono: 'fa-list-alt',
        ruta: `/sistema-gestion-calidad/instructivos?codigo=${encodeURIComponent(inst.codigo)}`,
        keywords: [inst.codigo, inst.titulo, 'instructivo', 'sgc', cat?.titulo || ''],
        abreVisor: true
      };
    });

    const normativasSgc: BusquedaSistemaItem[] = (SGC_NORMATIVAS_CATALOG || []).map((nom) => ({
      id: `sgc-nom-${nom.codigo}`,
      titulo: `${nom.codigo} · ${nom.titulo}`,
      descripcion: 'Normativa oficial · NOM-STPS',
      tipo: 'documento' as const,
      icono: 'fa-file-pdf',
      ruta: `/sistema-gestion-calidad/normativas?codigo=${encodeURIComponent(nom.codigo)}&cat=${encodeURIComponent(nom.categoriaId)}`,
      keywords: [nom.codigo, nom.titulo, 'normativa', 'nom', 'stps', 'pdf'],
      abreVisor: true
    }));

    const desdeRutas: BusquedaSistemaItem[] = (ROUTES || []).map((route) => ({
      id: `ruta-${route.path}`,
      titulo: route.title,
      descripcion: this.descripcionApartado(route.path, route.title),
      tipo: 'apartado' as const,
      icono: route.iconFa || this.iconoDesdeNucleo(route.icon) || 'fa-link',
      ruta: route.path,
      keywords: this.keywordsApartado(route.path, route.title),
      roles: route.roles
    }));

    const vistos = new Set<string>();
    this.catalogoBusqueda = [...extras, ...formatosSgc, ...procedimientosSgc, ...instructivosSgc, ...normativasSgc, ...desdeRutas]
      .filter((item) => this.puedeVerItemBusqueda(item))
      .filter((item) => {
        const key = item.id.startsWith('sgc-fmt-') || item.id.startsWith('sgc-proc-') || item.id.startsWith('sgc-inst-') || item.id.startsWith('sgc-nom-')
          ? item.id
          : item.ruta;
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
      });
  }

  private puedeVerItemBusqueda(item: BusquedaSistemaItem): boolean {
    const userRoles = this.authService.getRoles().map((r) => r.toLowerCase());
    const userRole = this.authService.getRol()?.toLowerCase() || '';
    const esEmpresa = userRoles.includes('empresa') || userRole === 'empresa';
    const esRoot = userRole === 'root' || userRoles.includes('root');

    if (item.ruta === '/correo' && esEmpresa) return false;
    if (item.ruta === '/mis-empresas' && esEmpresa) return false;
    if (
      (item.ruta === '/sistema-gestion-calidad'
        || item.ruta.startsWith('/sistema-gestion-calidad/')
        || item.ruta === '/control-proyectos'
        || item.ruta === '/control-oficios')
      && esEmpresa
    ) {
      return false;
    }
    if (item.ruta === '/aviso-privacidad') {
      return esEmpresa;
    }
    if (item.ruta === '/proteccion-civil' && esEmpresa
      && !this.authService.empresaTieneServicioProteccionCivil()) {
      return false;
    }

    if (!item.roles || item.roles.length === 0) {
      return true;
    }
    if (esRoot) {
      return true;
    }
    return item.roles.some((role) =>
      userRoles.includes(role.toLowerCase()) || role.toLowerCase() === userRole
    );
  }

  private descripcionApartado(path: string, title: string): string {
    const map: Record<string, string> = {
      '/home': 'Catálogo y categorías de cursos',
      '/mis-empresas': 'Empresas registradas y su repositorio documental',
      '/asig-curso': 'Asignar cursos a trabajadores',
      '/curso-activos': 'Cursos en progreso',
      '/historial-cursos': 'Historial completo de capacitaciones',
      '/historial-constancias-dc3': 'Constancias y formatos DC-3',
      '/ambiental': 'Módulo ambiental y empresas',
      '/control-tramites': 'Estatus de trámites ambientales',
      '/proteccion-civil': 'Programas y documentos de PC',
      '/proteccion-civil/control-resolutivos': 'Control de resolutivos PIPC',
      '/proteccion-civil/historial-pc': 'Historial de trámites PIPC finalizados',
      '/expedientes-medicos': 'Expedientes clínicos',
      '/sistema-gestion-calidad': 'Centro del Sistema de Gestión de Calidad',
      '/sistema-gestion-calidad/formatos': 'Formatos oficiales para consulta y descarga',
      '/sistema-gestion-calidad/normativas': 'Normas Oficiales Mexicanas (NOM-STPS)',
      '/sistema-gestion-calidad/procedimientos': 'Procedimientos documentados del SGC',
      '/sistema-gestion-calidad/instructivos': 'Instructivos documentados del SGC',
      '/diseno-innovacion': 'Proyectos de señalización',
      '/diseno-innovacion/repositorio': 'Repositorio de archivos de diseño',
      '/diseno-innovacion/inventario': 'Inventario de materiales',
      '/mantenimiento/programa-infraestructura': 'Programa de mantenimiento a la infraestructura',
      '/mantenimiento/solicitud': 'Solicitud de mantenimiento',
      '/gestion-usuarios': 'Alta y permisos de usuarios',
      '/sensores': 'Monitoreo de sensores IoT'
    };
    return map[path] || `Ir a ${title}`;
  }

  private keywordsApartado(path: string, title: string): string[] {
    const base = [title, path.replace(/\//g, ' ')];
    const extra: Record<string, string[]> = {
      '/home': ['cursos', 'categoria', 'capacitacion'],
      '/historial-constancias-dc3': ['dc3', 'constancia', 'diploma'],
      '/control-tramites': ['tramite', 'estatus', 'ambiental'],
      '/ambiental': ['medio ambiente', 'empresa ambiental'],
      '/sistema-gestion-calidad': ['sgc', 'calidad', 'iso'],
      '/sistema-gestion-calidad/formatos': ['formato', 'plantilla'],
      '/sistema-gestion-calidad/normativas': ['normativa', 'nom', 'stps'],
      '/sistema-gestion-calidad/procedimientos': ['procedimiento'],
      '/sistema-gestion-calidad/instructivos': ['instructivo', 'folio'],
      '/control-proyectos': ['proyecto', 'avance'],
      '/control-oficios': ['oficio', 'documento'],
      '/proteccion-civil': ['pc', 'brigada', 'evacuacion'],
      '/proteccion-civil/historial-pc': ['historial', 'pipc', 'tramite', 'pc'],
      '/expedientes-medicos': ['medico', 'clinica', 'salud'],
      '/diseno-innovacion': ['senalizacion', 'diseño', 'innovacion'],
      '/mantenimiento/programa-infraestructura': ['mantenimiento', 'infraestructura', 'ein'],
      '/mantenimiento/solicitud': ['solicitud', 'mantenimiento', 'eiff02'],
      '/correo': ['email', 'mail', 'mensajes'],
      '/tickets': ['falla', 'sugerencia', 'funcionamiento'],
      '/gestion-usuarios': ['usuario', 'rol', 'permiso']
    };
    return [...base, ...(extra[path] || [])];
  }

  private iconoDesdeNucleo(icon?: string): string {
    if (!icon) return 'fa-circle';
    const map: Record<string, string> = {
      'ni-briefcase-24': 'fa-briefcase',
      'ni-building': 'fa-building',
      'ni-books': 'fa-book',
      'ni-button-play': 'fa-play',
      'ni-badge': 'fa-id-badge',
      'ni-single-copy-04': 'fa-copy',
      'ni-paper-diploma': 'fa-certificate',
      'ni-archive-2': 'fa-archive',
      'ni-calendar-grid-58': 'fa-calendar-alt',
      'ni-chat-round': 'fa-comments',
      'ni-email-83': 'fa-envelope',
      'ni-tag': 'fa-tag',
      'ni-circle-08': 'fa-users',
      'ni-chart-bar-32': 'fa-chart-bar',
      'ni-chart-pie-35': 'fa-chart-pie'
    };
    return map[icon] || 'fa-link';
  }

  toggleNotificaciones(e: Event) {
    e.stopPropagation();
    this.funcionamientoAbierto = false;
    this.estatusTicketsAbiertos = false;
    this.solicitudDocAbierto = false;
    this.cerrarBusqueda();
    this.notifAbiertas = !this.notifAbiertas;
  }

  cerrarNotificaciones() {
    this.notifAbiertas = false;
  }

  toggleFuncionamiento(e: Event): void {
    e.stopPropagation();
    this.notifAbiertas = false;
    this.estatusTicketsAbiertos = false;
    this.solicitudDocAbierto = false;
    this.cerrarBusqueda();
    this.funcionamientoAbierto = !this.funcionamientoAbierto;
    if (this.funcionamientoAbierto) {
      this.ticketEnviadoOk = false;
      this.ticketError = null;
      this.cerrarMenusTicket();
    }
  }

  cerrarFuncionamiento(): void {
    this.funcionamientoAbierto = false;
    this.cerrarMenusTicket();
  }

  toggleEstatusTickets(e: Event): void {
    e.stopPropagation();
    this.notifAbiertas = false;
    this.funcionamientoAbierto = false;
    this.solicitudDocAbierto = false;
    this.cerrarBusqueda();
    this.estatusTicketsAbiertos = !this.estatusTicketsAbiertos;
    if (this.estatusTicketsAbiertos) {
      this.cargarMisTickets();
    }
  }

  cerrarEstatusTickets(): void {
    this.estatusTicketsAbiertos = false;
  }

  toggleSolicitudDocumentos(e: Event): void {
    e.stopPropagation();
    this.notifAbiertas = false;
    this.funcionamientoAbierto = false;
    this.estatusTicketsAbiertos = false;
    this.cerrarBusqueda();
    this.solicitudDocAbierto = !this.solicitudDocAbierto;
    if (this.solicitudDocAbierto) {
      this.solDocEnviadoOk = false;
      this.solDocError = null;
      this.cargarCatalogoSolicitudDocumentos();
    }
  }

  cerrarSolicitudDocumentos(): void {
    this.solicitudDocAbierto = false;
    this.solDocComboAbierto = false;
  }

  private cargarCatalogoSolicitudDocumentos(): void {
    if (this.solDocCatalogoCargado && this.solDocCatalogo.length) {
      return;
    }
    this.solDocCatalogo = catalogoDocumentosFallback();
    this.backendServices.obtenerCatalogoDocumentosSgcSolicitud()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const docs = Array.isArray(res?.documentos) ? res.documentos : [];
          if (docs.length) {
            this.solDocCatalogo = docs;
          }
          this.solDocCatalogoCargado = true;
        },
        error: () => {
          // Conserva fallback de Lista Maestra local
          this.solDocCatalogoCargado = true;
        }
      });
  }

  abrirComboSolDoc(): void {
    this.cargarCatalogoSolicitudDocumentos();
    this.solDocComboAbierto = true;
    this.solDocQuery = String(this.solDocNombre || this.solDocCodigo || this.solDocQuery || '').trim();
  }

  onFiltroSolDoc(valor: string): void {
    this.solDocComboAbierto = true;
    this.solDocQuery = valor;
    this.solDocNombre = valor;
    this.solDocCodigo = '';
    this.solDocVersion = '';
    this.solDocTipoDocumento = '';
  }

  seleccionarDocSolDoc(doc: SgcDocCatalogoItem): void {
    this.solDocNombre = String(doc.nombreDocumento || '').trim();
    this.solDocCodigo = String(doc.codigo || '').trim();
    this.solDocVersion = String(doc.versionVigente || '').trim();
    this.solDocTipoDocumento = mapearTipoDocumentoSolicitud(doc.especie, doc.codigo);
    this.solDocComboAbierto = false;
    this.solDocQuery = '';
  }

  confirmarDocSolDoc(): void {
    if (!this.solDocComboAbierto) {
      return;
    }
    const texto = String(this.solDocQuery || '').trim();
    if (!texto) {
      this.solDocComboAbierto = false;
      this.solDocQuery = '';
      return;
    }
    const match = resolverDocumentoCatalogo(this.solDocCatalogo, texto);
    if (match) {
      this.seleccionarDocSolDoc(match);
      return;
    }
    this.solDocNombre = texto;
    this.solDocCodigo = '';
    this.solDocVersion = '';
    this.solDocTipoDocumento = inferirTipoDocumentoDesdeCodigo(texto);
    this.solDocComboAbierto = false;
    this.solDocQuery = '';
  }

  onComboSolDocKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.solDocComboAbierto = false;
      this.solDocQuery = '';
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primero = this.solDocCatalogoFiltrado[0];
      if (primero) {
        this.seleccionarDocSolDoc(primero);
        return;
      }
      this.confirmarDocSolDoc();
    }
  }

  seleccionarTipoSolicitudDoc(tipo: TipoSolicitudDocumento, e: Event): void {
    e.stopPropagation();
    this.solDocTipoSolicitud = tipo;
  }

  trackBySolDocTipo(_index: number, opcion: { id: TipoSolicitudDocumento }): string {
    return opcion.id;
  }

  etiquetaDocSolDoc(doc: SgcDocCatalogoItem): string {
    return etiquetaDocumentoCatalogo(doc);
  }

  enviarSolicitudDocumento(e: Event): void {
    e.stopPropagation();
    if (!this.solDocFormularioValido) {
      return;
    }
    this.enviandoSolDoc = true;
    this.solDocEnviadoOk = false;
    this.solDocError = null;
    this.backendServices.crearSolicitudDocumentoSgc({
      nombreDocumento: this.solDocNombre,
      codigo: this.solDocCodigo,
      versionActual: this.solDocVersion,
      tipoDocumento: this.solDocTipoDocumento,
      tipoSolicitud: this.solDocTipoSolicitud,
      motivo: this.solDocMotivo
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.enviandoSolDoc = false;
          this.solDocEnviadoOk = true;
          this.solDocNombre = '';
          this.solDocCodigo = '';
          this.solDocVersion = '';
          this.solDocTipoDocumento = '';
          this.solDocTipoSolicitud = 'modificacion';
          this.solDocMotivo = '';
          this.solDocQuery = '';
          this.solDocComboAbierto = false;
        },
        error: (err) => {
          this.enviandoSolDoc = false;
          this.solDocError = err?.error?.message || 'No se pudo enviar la solicitud';
        }
      });
  }

  trackBySolDocCatalogo(_index: number, doc: SgcDocCatalogoItem): string {
    return `${doc.codigo || ''}-${doc.nombreDocumento || ''}`;
  }

  toggleAreaMenu(e: Event): void {
    e.stopPropagation();
    this.prioridadMenuAbierto = false;
    this.areaMenuAbierto = !this.areaMenuAbierto;
  }

  togglePrioridadMenu(e: Event): void {
    e.stopPropagation();
    this.areaMenuAbierto = false;
    this.prioridadMenuAbierto = !this.prioridadMenuAbierto;
  }

  seleccionarArea(area: string, e: Event): void {
    e.stopPropagation();
    this.ticketArea = area;
    this.areaMenuAbierto = false;
  }

  seleccionarPrioridad(prioridad: string, e: Event): void {
    e.stopPropagation();
    this.ticketPrioridad = prioridad;
    this.prioridadMenuAbierto = false;
  }

  seleccionarTipo(tipo: 'falla' | 'sugerencia', e: Event): void {
    e.stopPropagation();
    this.ticketTipo = tipo;
  }

  cerrarMenusTicket(): void {
    this.areaMenuAbierto = false;
    this.prioridadMenuAbierto = false;
  }

  abrirSelectorEvidencias(e: Event): void {
    e.stopPropagation();
    this.evidenciaInput?.nativeElement?.click();
  }

  onEvidenciasSeleccionadas(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    const restantes = this.maxEvidencias - this.ticketEvidencias.length;
    for (const file of files.slice(0, Math.max(0, restantes))) {
      if (!this.esImagenEvidencia(file)) continue;
      const reader = new FileReader();
      reader.onload = () => {
        this.ticketEvidencias = [
          ...this.ticketEvidencias,
          {
            file,
            previewUrl: String(reader.result || ''),
            descripcion: ''
          }
        ];
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(file);
    }
    input.value = '';
  }

  private esImagenEvidencia(file: File): boolean {
    const mime = String(file.type || '').toLowerCase();
    if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)) {
      return true;
    }
    const ext = String(file.name || '').toLowerCase().split('.').pop() || '';
    return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  }

  quitarEvidencia(index: number, e: Event): void {
    e.stopPropagation();
    this.ticketEvidencias.splice(index, 1);
    this.ticketEvidencias = [...this.ticketEvidencias];
  }

  trackByEvidenciaIndex(index: number): number {
    return index;
  }

  private limpiarEvidencias(): void {
    this.ticketEvidencias = [];
  }

  enviarTicket(e: Event): void {
    e.stopPropagation();
    const area = String(this.ticketArea || '').trim();
    const prioridad = String(this.ticketPrioridad || '').trim();
    const tipo = String(this.ticketTipo || '').trim();
    const descripcion = String(this.ticketDescripcion || '').trim();
    if (!area || !prioridad || !tipo || !descripcion || this.enviandoTicket) {
      return;
    }
    this.enviandoTicket = true;
    this.ticketEnviadoOk = false;
    this.ticketError = null;
    this.backendServices.crearTicket({
      area,
      descripcion,
      prioridad,
      tipo,
      evidencias: this.ticketEvidencias.map((ev) => ({
        file: ev.file,
        descripcion: ev.descripcion
      }))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.enviandoTicket = false;
          this.ticketEnviadoOk = true;
          this.ticketArea = '';
          this.ticketPrioridad = 'normal';
          this.ticketTipo = '';
          this.ticketDescripcion = '';
          this.limpiarEvidencias();
          this.cargarMisTickets();
        },
        error: (err) => {
          this.enviandoTicket = false;
          this.ticketError = err?.error?.message || 'No se pudo enviar el ticket';
        }
      });
  }

  estatusTicketLabel(estado?: string): string {
    const map: Record<string, string> = {
      abierto: 'No realizado',
      en_progreso: 'En desarrollo',
      cerrado: 'Realizado'
    };
    return map[String(estado || 'abierto')] || 'No realizado';
  }

  tituloTicketEstatus(ticket: { ticket_id?: number; area?: string; tipo?: string }): string {
    const tipo = String(ticket?.tipo || '').toLowerCase() === 'falla'
      ? 'Falla'
      : 'Sugerencia de mejora';
    const area = String(ticket?.area || 'General').trim() || 'General';
    const id = ticket?.ticket_id ? `#${ticket.ticket_id} · ` : '';
    return `${id}${tipo} · ${area}`;
  }

  prioridadTicketLabel(prioridad?: string): string {
    const found = this.prioridadesTicket.find((p) => p.valor === prioridad);
    return found?.label || 'Normal';
  }

  get estatusTicketsBadge(): number {
    return this.misTickets.filter((t) => t.estado !== 'cerrado').length;
  }

  fechaTicketUi(valor?: string): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) {
      const raw = String(valor).slice(0, 10);
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  }

  trackByTicketPendiente(_index: number, ticket: { ticket_id: number }): number {
    return ticket?.ticket_id || _index;
  }

  private cargarMisTickets(): void {
    this.cargandoMisTickets = true;
    this.backendServices.obtenerMisTickets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.misTickets = res?.tickets || [];
          this.cargandoMisTickets = false;
        },
        error: () => {
          this.misTickets = [];
          this.cargandoMisTickets = false;
        }
      });
  }

  getAlertAccentColor(tipo: string): string {
    const map: any = {
      'danger': '#f5365c', 'warning': '#fb6340', 'info': '#5e72e4', 'success': '#2dce89'
    };
    return map[tipo] || '#5e72e4';
  }

  getAreaColor(categoria: string): string {
    return NavbarComponent.AREA_META[categoria]?.color
      || NavbarComponent.AREA_META.general.color;
  }

  getNotifAccentColor(notif: any): string {
    if (notif?.categoria) {
      return this.getAreaColor(String(notif.categoria));
    }
    return this.getAlertAccentColor(notif?.tipo);
  }

  toggleGrupoNotif(key: string, event: Event): void {
    event.stopPropagation();
    if (this.notifGruposColapsados.has(key)) {
      this.notifGruposColapsados.delete(key);
    } else {
      this.notifGruposColapsados.add(key);
    }
    // Forzar detección de cambio del Set
    this.notifGruposColapsados = new Set(this.notifGruposColapsados);
  }

  grupoEstaColapsado(key: string): boolean {
    return this.notifGruposColapsados.has(key);
  }

  private reconstruirGruposNotif(notifs: any[]): void {
    const prevKeys = new Set(this.notifGrupos.map((g) => g.key));
    const buckets = new Map<string, any[]>();
    for (const n of notifs || []) {
      // Evitar duplicar con el panel creativo de cursos finalizados
      const titulo = String(n?.titulo || '').toLowerCase();
      if (titulo.includes('capacitación finalizada') || titulo.includes('capacitacion finalizada')) {
        continue;
      }
      const key = String(n?.categoria || 'general').toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(n);
    }

    this.notifGrupos = Array.from(buckets.entries())
      .map(([key, items]) => {
        const meta = NavbarComponent.AREA_META[key] || NavbarComponent.AREA_META.general;
        return {
          key,
          titulo: meta.titulo,
          icono: meta.icono,
          color: meta.color,
          items,
          orden: meta.orden
        };
      })
      .sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo));

    // Áreas nuevas con muchas notificaciones: colapsadas por defecto
    for (const g of this.notifGrupos) {
      if (!prevKeys.has(g.key) && g.items.length > 4) {
        this.notifGruposColapsados.add(g.key);
      }
    }
    this.notifGruposColapsados = new Set(
      [...this.notifGruposColapsados].filter((k) => this.notifGrupos.some((g) => g.key === k))
    );
  }

  trackByGrupoKey(_i: number, g: { key: string }): string {
    return g.key;
  }

  trackByNotifId(_i: number, n: any): string {
    return String(n?.notif_id ?? _i);
  }

  notifIrAItem(ruta: string, event: Event) {
    event.stopPropagation();
    this.notifAbiertas = false;
    this.navegarNotificacion(ruta);
  }

  descartarNotif(id: number | string, event: Event) {
    event.stopPropagation();
    // Solo notificaciones legacy (numéricas) se pueden descartar manualmente
    if (typeof id !== 'number' && !/^\d+$/.test(String(id))) {
      return;
    }
    const numId = Number(id);
    this.notificacionesService.descartarPersonal(numId);
    this.backendServices.descartarNotificacion(numId).subscribe();
  }

  abrirNotificacion(notif: any, event: Event) {
    event.stopPropagation();
    this.notifAbiertas = false;
    // Operativas (auto): no se eliminan al clic; el sistema las quita al resolverse
    if (!notif?.auto && notif?.notif_id != null && /^\d+$/.test(String(notif.notif_id))) {
      const numId = Number(notif.notif_id);
      this.notificacionesService.descartarPersonal(numId);
      this.backendServices.descartarNotificacion(numId).subscribe();
    }
    const ruta = String(notif?.ruta || '');
    const programadoMatch = ruta.match(/[?&]programado_id=(\d+)/i);
    if (programadoMatch) {
      const programadoId = Number(programadoMatch[1]);
      const item = this.historialPendientes.items.find((i) => Number(i.programado_id) === programadoId);
      if (item) {
        this.abrirCursoFinalizado(item, event);
        return;
      }
    }
    this.navegarNotificacion(ruta);
  }

  abrirCursoFinalizado(item: HistorialPendienteItem, event: Event): void {
    event.stopPropagation();
    this.notifAbiertas = false;
    if (!item?.programado_id || !item?.curso_id) {
      return;
    }
    this.historialPendientes.marcarConsultado(item.programado_id);
    this.router.navigate(['/informacion-general', item.curso_id], {
      queryParams: {
        nombre: item.nombre_curso,
        categoria: 'seguridad',
        origen: 'historial-cursos',
        vista: 'historial',
        programado_id: item.programado_id,
        empresa_id: item.empresa_id
      }
    });
  }

  trackByPendienteId(_i: number, item: HistorialPendienteItem): number {
    return Number(item?.programado_id) || _i;
  }

  inicialesEmpresa(nombre: string): string {
    const parts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return (nombre || 'EM').substring(0, 2).toUpperCase();
  }

  abrirYDescartar(id: number, ruta: string, event: Event) {
    this.abrirNotificacion({ notif_id: id, ruta, auto: false }, event);
  }

  abrirYDescartarAlerta(alertaIndex: number, itemIndex: number, ruta: string, event: Event) {
    event.stopPropagation();
    this.notifAbiertas = false;
    this.navegarNotificacion(ruta);
  }

  private navegarNotificacion(ruta: string | null | undefined): void {
    if (!ruta) return;
    const raw = String(ruta).trim();
    if (!raw) return;
    if (raw.includes('?')) {
      this.router.navigateByUrl(raw);
      return;
    }
    this.router.navigate([raw]);
  }

  ngOnInit() {
    this.listTitles = ROUTES.filter(listTitle => listTitle);
    this.actualizarVisibilidadNotificaciones();
    this.rebuildCatalogoBusqueda();
    this.iniciarBusquedaRemota();

    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      this.actualizarVisibilidadNotificaciones(event.urlAfterRedirects);
      this.cargarCorreosNoLeidos();
    });

    // Suscribirse a las alertas compartidas
    this.notificacionesService.alertas$.pipe(takeUntil(this.destroy$)).subscribe(alertas => {
      this.alertas = alertas;
    });

    // Suscribirse a notificaciones personales
    this.notificacionesService.notifPersonales$.pipe(takeUntil(this.destroy$)).subscribe(notifs => {
      this.notifPersonales = notifs;
      this.reconstruirGruposNotif(notifs);
    });

    this.historialPendientes.items$.pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.cursosFinalizadosPendientes = items || [];
      this.cdr.markForCheck();
    });

    // Obtener nombre del usuario logueado
    this.actualizarNombreUsuario();
    const rol = this.authService.getRol()?.toLowerCase();
    this.esDoctor = rol === 'doctor';

    // Suscribirse a cambios en el usuario
    this.authService.usuarioActual.pipe(takeUntil(this.destroy$)).subscribe(usuario => {
      this.actualizarNombreUsuario();
      const r = this.authService.getRol()?.toLowerCase();
      this.esDoctor = r === 'doctor';
      this.actualizarDisponibilidadCorreo();
      this.cargarCorreosNoLeidos();
      this.actualizarFoto();
      this.rebuildCatalogoBusqueda();
      this.cargarAreasTicket();
    });

    this.idiomaActual = this.languageService.currentLanguage;
    this.languageService.currentLanguage$
      .pipe(takeUntil(this.destroy$))
      .subscribe((lang) => this.idiomaActual = lang);

    this.languageService.initialize();
    this.cargarAreasTicket();
    this.cargarMisTickets();

    timer(60_000, 60_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.cargarCorreosNoLeidos());
  }

  ngOnDestroy() {
    this.limpiarEvidencias();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private areasTicketFallback(): string[] {
    return [
      'Capacitación',
      'Protección Civil',
      'SGC',
      'Recursos Humanos',
      'Médicos',
      'Ambiental',
      'Control de Proyectos',
      'Control de Oficios',
      'Diseño e Innovación',
      'Mantenimiento',
      'General'
    ];
  }

  private cargarAreasTicket(): void {
    this.backendServices.obtenerAreasTickets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.areasTicket = Array.isArray(res?.areas) && res.areas.length
            ? res.areas
            : this.areasTicketFallback();
        },
        error: () => {
          this.areasTicket = this.areasTicketFallback();
        }
      });
  }

  private actualizarNombreUsuario(): void {
    this.nombreUsuario = this.authService.getNombreCompleto();
    this.actualizarFoto();
  }

  private actualizarFoto(): void {
    const usuario = this.authService.usuarioActualValue;
    const driveId = usuario?.foto_drive_id;
    this.fotoUrl = driveId ? this.buildDrivePreviewUrl(driveId) : null;
  }

  abrirCorreo(): void {
    this.notifAbiertas = false;
    this.funcionamientoAbierto = false;
    this.estatusTicketsAbiertos = false;
    this.solicitudDocAbierto = false;
    this.cerrarBusqueda();
    this.router.navigate(['/correo']);
  }

  private actualizarDisponibilidadCorreo(): void {
    const rolesCorreo = [
      'root',
      'administrador',
      'instructor',
      'coordinador',
      'consulta',
      'proteccion_civil',
      'doctor',
      'sgc',
      'ambiental',
      'innovacion',
      'control_documental'
    ];
    this.mostrarNotificacionCorreo = this.authService.tieneAlgunRol(rolesCorreo)
      && !this.authService.tieneRol('empresa');

    if (!this.mostrarNotificacionCorreo) {
      this.correosNoLeidos = 0;
    }
  }

  private cargarCorreosNoLeidos(): void {
    if (!this.mostrarNotificacionCorreo) {
      return;
    }
    if (this.correoImapEnVuelo || Date.now() < correoImapBackoffUntilGlobal) {
      return;
    }

    this.correoImapEnVuelo = true;
    this.backendServices.obtenerCarpetasCorreo()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.correoImapEnVuelo = false;
          correoImapBackoffUntilGlobal = 0;
          const carpetas = Array.isArray(response?.carpetas) ? response.carpetas : [];
          const entrada = carpetas.find((carpeta: any) =>
            String(carpeta?.id || '').toLowerCase() === 'inbox'
          );
          this.correosNoLeidos = Math.max(0, Number(entrada?.noLeidos) || 0);
        },
        error: (err) => {
          this.correoImapEnVuelo = false;
          const status = Number(err?.status || 0);
          const detalle = String(err?.error?.error || err?.message || '');
          const sinConexion = status >= 500
            || /ENOTFOUND|ETIMEDOUT|ECONNABORTED|ECONNREFUSED|getaddrinfo/i.test(detalle);
          if (sinConexion || status === 401) {
            correoImapBackoffUntilGlobal = Date.now() + 10 * 60 * 1000;
          }
        }
      });
  }

  private actualizarVisibilidadNotificaciones(url?: string): void {
    const currentUrl = (url ?? this.router.url ?? '').toLowerCase();
    this.mostrarNotificaciones = !currentUrl.startsWith('/expedientes-medicos') && !currentUrl.startsWith('/estadisticas-medicas');
    if (!this.mostrarNotificaciones) {
      this.notifAbiertas = false;
    }
  }

  getTitle() {
    var titlee = this.location.prepareExternalUrl(this.location.path());
    if (titlee.charAt(0) === '#') {
      titlee = titlee.slice(1);
    }

    if (titlee.includes('/mis-empresas/') && titlee.includes('/repositorio')) {
      return 'Repositorio Empresarial';
    }

    for (var item = 0; item < this.listTitles.length; item++) {
      if (this.listTitles[item].path === titlee) {
        return this.listTitles[item].title;
      }
    }
    return '';
  }

  volverAlInicio() {
    this.router.navigate(['/home']);
  }

  async cambiarPassword() {
    const htmlForm = `
      <style>
        .password-hint { font-size: 0.75rem; margin-top: 0.25rem; display: none; }
        .password-hint.error { color: #f5365c; display: block; }
        .password-hint.success { color: #38512F; display: block; }
        .swal2-input.error-border { border-color: #f5365c !important; }
        .swal2-input.success-border { border-color: #38512F !important; }
      </style>
      <input id="swal-pass-actual" type="password" class="swal2-input" placeholder="Contraseña actual" autocomplete="current-password">
      <input id="swal-pass-nueva" type="password" class="swal2-input" placeholder="Nueva contraseña (mín. 8 caracteres)" autocomplete="new-password">
      <input id="swal-pass-confirmar" type="password" class="swal2-input" placeholder="Confirmar contraseña" autocomplete="new-password">
      <div class="password-hint" id="password-hint">
        <i class="fas fa-exclamation-triangle"></i> Las contraseñas no coinciden
      </div>
      <div class="password-hint" id="password-ok">
        <i class="fas fa-check-circle"></i> Las contraseñas coinciden
      </div>
    `;
    
    const { value: formValues } = await Swal.fire({
      title: '<i class="fas fa-key" style="color: #38512F;"></i> Cambiar Contraseña',
      html: htmlForm,
      width: '500px',
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-check"></i> Cambiar',
      cancelButtonText: '<i class="fas fa-times"></i> Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      didOpen: () => {
        const nuevaInput = document.getElementById('swal-pass-nueva') as HTMLInputElement;
        const confirmarInput = document.getElementById('swal-pass-confirmar') as HTMLInputElement;
        const hintError = document.getElementById('password-hint');
        const hintOk = document.getElementById('password-ok');
        
        const validatePasswords = () => {
          const nueva = nuevaInput.value;
          const confirmar = confirmarInput.value;
          
          if (confirmar.length === 0) {
            hintError!.classList.remove('error');
            hintOk!.classList.remove('success');
            confirmarInput.classList.remove('error-border', 'success-border');
          } else if (nueva === confirmar && nueva.length >= 8) {
            hintError!.classList.remove('error');
            hintOk!.classList.add('success');
            confirmarInput.classList.remove('error-border');
            confirmarInput.classList.add('success-border');
          } else {
            hintError!.classList.add('error');
            hintOk!.classList.remove('success');
            confirmarInput.classList.remove('success-border');
            confirmarInput.classList.add('error-border');
          }
        };
        
        nuevaInput.addEventListener('input', validatePasswords);
        confirmarInput.addEventListener('input', validatePasswords);
      },
      preConfirm: () => {
        const actual = (document.getElementById('swal-pass-actual') as HTMLInputElement).value;
        const nueva = (document.getElementById('swal-pass-nueva') as HTMLInputElement).value;
        const confirmar = (document.getElementById('swal-pass-confirmar') as HTMLInputElement).value;
        
        if (!actual || !nueva || !confirmar) {
          Swal.showValidationMessage('Todos los campos son requeridos');
          return false;
        }
        if (nueva.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener mínimo 8 caracteres');
          return false;
        }
        if (nueva !== confirmar) {
          Swal.showValidationMessage('Las contraseñas no coinciden');
          return false;
        }
        return { password_actual: actual, password_nueva: nueva };
      }
    });

    if (formValues) {
      const userId = this.authService.getUsuarioId();
      this.http.put(`${environment.apiUrl}/usuarios/${userId}/cambiar-password`, formValues)
        .subscribe({
          next: (res: any) => {
            if (res.success) {
              Swal.fire({
                title: '¡Listo!',
                text: 'Contraseña actualizada correctamente',
                icon: 'success',
                confirmButtonColor: '#38512F'
              });
            } else {
              Swal.fire({
                title: 'Error',
                text: res.message || 'No se pudo cambiar la contraseña',
                icon: 'error',
                confirmButtonColor: '#38512F'
              });
            }
          },
          error: () => Swal.fire({
            title: 'Error',
            text: 'Error al conectar con el servidor',
            icon: 'error',
            confirmButtonColor: '#38512F'
          })
        });
    }
  }

  cerrarSesion() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  cambiarIdioma() {
    this.languageService.toggleLanguage();
  }
}
