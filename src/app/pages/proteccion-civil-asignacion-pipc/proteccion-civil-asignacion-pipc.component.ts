import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { ProteccionCivilAsignarDocumentosComponent } from '../proteccion-civil-asignar-documentos/proteccion-civil-asignar-documentos.component';

interface EmpresaOpcion {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
  ciudad?: string;
  estado?: string;
  logo?: string | null;
  logo_url?: string | null;
}

interface OpcionResponsable {
  id: number;
  nombre: string;
}

type PestanaAsignacionPipc = 'desplegar' | 'gestion' | 'directorios';

@Component({
  selector: 'app-proteccion-civil-asignacion-pipc',
  templateUrl: './proteccion-civil-asignacion-pipc.component.html',
  styleUrls: ['./proteccion-civil-asignacion-pipc.component.scss']
})
export class ProteccionCivilAsignacionPipcComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @ViewChild(ProteccionCivilAsignarDocumentosComponent)
  asignarDocumentosCmp: ProteccionCivilAsignarDocumentosComponent | null = null;

  pestanaActiva: PestanaAsignacionPipc = 'desplegar';

  empresas: EmpresaOpcion[] = [];
  empresasFiltradas: EmpresaOpcion[] = [];
  busquedaEmpresa = '';
  mostrarDropdownEmpresa = false;
  empresaSeleccionada: EmpresaOpcion | null = null;
  cargandoEmpresas = true;
  refreshAsignacion = 0;
  totalSeleccionadosAsignacion = 0;
  guardandoAsignacionFlag = false;

  responsablesOpciones: OpcionResponsable[] = [];
  responsablesFiltrados: OpcionResponsable[] = [];
  filtroResponsable = '';
  responsablePipcUsuarioId: number | null = null;
  comboResponsableAbierto = false;
  cargandoResponsable = false;
  guardandoResponsable = false;
  responsableGuardadoOk = false;

  private logoErrorIds = new Set<number>();
  private comboResponsableTimer: ReturnType<typeof setTimeout> | null = null;
  private responsableOkTimer: ReturnType<typeof setTimeout> | null = null;
  private responsableCargaSeq = 0;

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const rol = this.authService.getRol();
    if (rol === 'empresa') {
      this.router.navigate(['/proteccion-civil']);
      return;
    }
    this.aplicarPestanaDesdeRuta();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.aplicarPestanaDesdeRuta();
    });
    this.cargarEmpresas();
    this.cargarUsuariosResponsables();
  }

  setPestana(tab: PestanaAsignacionPipc): void {
    this.pestanaActiva = tab;
    const enRutaCatalogo = this.route.snapshot.routeConfig?.path === 'catalogo';
    const tabQuery =
      tab === 'gestion' ? 'gestion' :
      tab === 'directorios' ? 'directorios' :
      null;
    if (enRutaCatalogo) {
      this.router.navigate(['/proteccion-civil/asignacion-pipc'], {
        queryParams: tabQuery ? { tab: tabQuery } : {}
      });
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabQuery },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private aplicarPestanaDesdeRuta(): void {
    const dataTab = String(this.route.snapshot.data?.['tabInicial'] || '').trim().toLowerCase();
    const queryTab = String(this.route.snapshot.queryParamMap.get('tab') || '').trim().toLowerCase();
    const tab = queryTab || dataTab;
    if (tab === 'directorios' || tab === 'directorio') {
      this.pestanaActiva = 'directorios';
      return;
    }
    this.pestanaActiva = tab === 'gestion' || tab === 'catalogo' ? 'gestion' : 'desplegar';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.comboResponsableTimer) clearTimeout(this.comboResponsableTimer);
    if (this.responsableOkTimer) clearTimeout(this.responsableOkTimer);
  }

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendService.obtenerEmpresasProteccionCivil()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          // PIPC Activos agrupa por empresa; aquí también desduplicamos.
          const porId = new Map<number, EmpresaOpcion>();
          for (const e of (res?.empresas || [])) {
            const id = Number(e.empresa_id);
            if (!id || porId.has(id)) continue;
            porId.set(id, {
              empresa_id: id,
              nombre_empresa: String(e.nombre_empresa || '').trim(),
              rfc: e.rfc || '',
              ciudad: e.ciudad || '',
              estado: e.estado || '',
              logo: e.logo || null,
              logo_url: e.logo_url || e.logo || null
            });
          }
          this.empresas = Array.from(porId.values())
            .sort((a, b) => a.nombre_empresa.localeCompare(b.nombre_empresa, 'es'));
          this.filtrarEmpresas();
          this.cargandoEmpresas = false;
        },
        error: () => {
          this.empresas = [];
          this.empresasFiltradas = [];
          this.cargandoEmpresas = false;
        }
      });
  }

  filtrarEmpresas(): void {
    const q = this.busquedaEmpresa.trim().toLowerCase();
    if (!q) {
      this.empresasFiltradas = [...this.empresas].slice(0, 40);
      return;
    }
    this.empresasFiltradas = this.empresas
      .filter((e) =>
        e.nombre_empresa.toLowerCase().includes(q) ||
        (e.rfc || '').toLowerCase().includes(q) ||
        (e.ciudad || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }

  mostrarEmpresas(): void {
    this.mostrarDropdownEmpresa = true;
    this.filtrarEmpresas();
  }

  ocultarDropdownEmpresa(): void {
    setTimeout(() => {
      this.mostrarDropdownEmpresa = false;
    }, 180);
  }

  seleccionarEmpresa(empresa: EmpresaOpcion): void {
    this.logoErrorIds.delete(Number(empresa.empresa_id));
    this.empresaSeleccionada = empresa;
    this.busquedaEmpresa = empresa.nombre_empresa;
    this.mostrarDropdownEmpresa = false;
    this.totalSeleccionadosAsignacion = 0;
    this.guardandoAsignacionFlag = false;
    this.refreshAsignacion++;
    this.cargarResponsableEmpresa(empresa.empresa_id);
  }

  limpiarEmpresa(): void {
    this.empresaSeleccionada = null;
    this.busquedaEmpresa = '';
    this.responsablePipcUsuarioId = null;
    this.filtroResponsable = '';
    this.responsableGuardadoOk = false;
    this.refreshAsignacion++;
  }

  getLogoEmpresaUrl(empresa: EmpresaOpcion | null): string | null {
    if (!empresa) return null;
    const id = Number(empresa.empresa_id);
    if (this.logoErrorIds.has(id)) return null;
    return this.backendService.resolverUrlDrivePreview(empresa.logo_url || empresa.logo);
  }

  onLogoError(empresa: EmpresaOpcion): void {
    this.logoErrorIds.add(Number(empresa.empresa_id));
  }

  get puedeGuardarAsignacion(): boolean {
    return this.totalSeleccionadosAsignacion > 0 && !this.guardandoAsignacionFlag;
  }

  get guardandoAsignacion(): boolean {
    return this.guardandoAsignacionFlag;
  }

  guardarAsignacionDesdeChip(): void {
    this.asignarDocumentosCmp?.guardarAsignacion();
  }

  onEstadoAsignacionCambiado(ev: { totalSeleccionados: number; guardando: boolean }): void {
    this.totalSeleccionadosAsignacion = Number(ev?.totalSeleccionados) || 0;
    this.guardandoAsignacionFlag = !!ev?.guardando;
  }

  onAsignacionGuardada(): void {
    this.totalSeleccionadosAsignacion = 0;
    this.guardandoAsignacionFlag = false;
    this.refreshAsignacion++;
  }

  onResponsableDesdeHijo(ev: { usuario_id: number | null; nombre: string | null }): void {
    this.responsablePipcUsuarioId = ev.usuario_id;
    this.filtroResponsable = ev.nombre || '';
  }

  private cargarUsuariosResponsables(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const lista = Array.isArray(response?.usuarios) ? response.usuarios : [];
          this.responsablesOpciones = lista
            .filter((usuario: any) => {
              const rol = String(usuario?.rol || usuario?.rol_nombre || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
              return rol !== 'empresa' && rol !== 'usuario empresa';
            })
            .map((usuario: any) => ({
              id: Number(usuario.id || usuario.usuario_id || 0),
              nombre: this.nombreCompletoUsuario(usuario)
            }))
            .filter((u: OpcionResponsable) => u.id > 0 && !!u.nombre)
            .sort((a: OpcionResponsable, b: OpcionResponsable) => a.nombre.localeCompare(b.nombre, 'es'));
          this.filtrarResponsables();
        },
        error: () => {
          this.responsablesOpciones = [];
          this.responsablesFiltrados = [];
        }
      });
  }

  private nombreCompletoUsuario(usuario: any): string {
    const partes = [usuario?.nombre, usuario?.apellido, usuario?.apellido_paterno, usuario?.apellido_materno]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    if (partes.length) return partes.join(' ');
    return String(usuario?.username || usuario?.email || '').trim();
  }

  private cargarResponsableEmpresa(empresaId: number): void {
    const seq = ++this.responsableCargaSeq;
    this.cargandoResponsable = true;
    this.responsableGuardadoOk = false;
    this.backendService.obtenerCentroOperacionesPC(empresaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          if (seq !== this.responsableCargaSeq) return;
          this.cargandoResponsable = false;
          const ciclo = response?.ciclo || {};
          const usuarioId = Number(ciclo.responsable_pipc_usuario_id || 0) || null;
          const nombreApi = String(ciclo.responsable_pipc_nombre || '').trim();
          const nombreOpcion = usuarioId
            ? (this.responsablesOpciones.find((op) => op.id === usuarioId)?.nombre || '')
            : '';
          this.responsablePipcUsuarioId = usuarioId;
          this.filtroResponsable = nombreApi || nombreOpcion || '';
          this.filtrarResponsables();
        },
        error: () => {
          if (seq !== this.responsableCargaSeq) return;
          this.cargandoResponsable = false;
          this.responsablePipcUsuarioId = null;
          this.filtroResponsable = '';
        }
      });
  }

  onResponsableInput(valor: string): void {
    this.filtroResponsable = valor;
    this.filtrarResponsables();
    this.comboResponsableAbierto = true;
  }

  filtrarResponsables(): void {
    const q = this.filtroResponsable.trim().toLowerCase();
    if (!q) {
      this.responsablesFiltrados = [...this.responsablesOpciones].slice(0, 40);
      return;
    }
    this.responsablesFiltrados = this.responsablesOpciones
      .filter((op) => op.nombre.toLowerCase().includes(q))
      .slice(0, 40);
  }

  abrirComboResponsable(): void {
    if (!this.empresaSeleccionada) return;
    this.filtrarResponsables();
    this.comboResponsableAbierto = true;
  }

  cerrarComboResponsableDelayed(): void {
    if (this.comboResponsableTimer) clearTimeout(this.comboResponsableTimer);
    this.comboResponsableTimer = setTimeout(() => {
      this.comboResponsableAbierto = false;
      this.restaurarEtiquetaResponsable();
    }, 180);
  }

  seleccionarResponsable(event: MouseEvent, op: OpcionResponsable): void {
    event.preventDefault();
    this.comboResponsableAbierto = false;
    this.filtroResponsable = op.nombre;
    this.guardarResponsable(op.id);
  }

  limpiarResponsable(event: MouseEvent): void {
    event.preventDefault();
    this.filtroResponsable = '';
    this.guardarResponsable(null);
  }

  private restaurarEtiquetaResponsable(): void {
    if (!this.responsablePipcUsuarioId) return;
    const op = this.responsablesOpciones.find((o) => o.id === this.responsablePipcUsuarioId);
    if (op?.nombre) this.filtroResponsable = op.nombre;
  }

  private guardarResponsable(usuarioId: number | null): void {
    if (!this.empresaSeleccionada || this.guardandoResponsable) return;
    this.guardandoResponsable = true;
    this.responsableGuardadoOk = false;
    this.backendService.guardarResponsablePipcEmpresa(this.empresaSeleccionada.empresa_id, usuarioId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.guardandoResponsable = false;
          if (!response?.success) {
            this.restaurarEtiquetaResponsable();
            Swal.fire('Error', response?.message || 'No se pudo guardar el responsable', 'error');
            return;
          }
          this.responsablePipcUsuarioId = Number(response?.responsable_pipc_usuario_id || 0) || null;
          this.filtroResponsable = String(response?.responsable_pipc_nombre || '').trim();
          this.responsableGuardadoOk = true;
          if (this.responsableOkTimer) clearTimeout(this.responsableOkTimer);
          this.responsableOkTimer = setTimeout(() => {
            this.responsableGuardadoOk = false;
          }, 2200);
        },
        error: () => {
          this.guardandoResponsable = false;
          this.restaurarEtiquetaResponsable();
          Swal.fire('Error', 'No se pudo guardar el responsable de PIPC', 'error');
        }
      });
  }
}
