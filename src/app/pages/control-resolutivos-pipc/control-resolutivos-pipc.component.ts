import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { obtenerFechaHoyLocal } from 'src/app/utils/fecha.util';

export interface RegistroControlResolutivo {
  item: number;
  resolutivo_id?: number;
  empresa_id?: number;
  nombre_empresa: string;
  nombre_asignacion?: string;
  tipo_tramite: string;
  responsable: string;
  fecha_ingreso_tramite: string;
  fecha_oficio_observaciones: string;
  fecha_aprobacion: string;
  fecha_vencimiento: string;
  fecha_contacto_empresa: string;
  municipio: string;
  estado: string;
  estatus: string;
  fecha_ingreso_tramite_iso?: string | null;
  fecha_oficio_observaciones_iso?: string | null;
  fecha_aprobacion_iso?: string | null;
  fecha_vencimiento_iso?: string | null;
  fecha_contacto_empresa_iso?: string | null;
}

interface FormEditarResolutivo {
  resolutivo_id: number;
  empresa_id: number | null;
  nombre_empresa: string;
  tipo_tramite: string;
  responsable: string;
  responsable_usuario_id: number | null;
  fecha_ingreso_tramite: string;
  fecha_oficio_observaciones: string;
  fecha_aprobacion: string;
  fecha_vencimiento: string;
  fecha_contacto_empresa: string;
  municipio: string;
  estado: string;
  estatus: string;
}

interface OpcionEmpresa {
  id: number;
  nombre: string;
  municipio?: string;
  estado?: string;
}

interface OpcionResponsable {
  id: number;
  nombre: string;
}

@Component({
  selector: 'app-control-resolutivos-pipc',
  templateUrl: './control-resolutivos-pipc.component.html',
  styleUrls: ['./control-resolutivos-pipc.component.scss']
})
export class ControlResolutivosPipcComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private readonly FILTROS_STORAGE_PREFIX = 'control-resolutivos-filtros';

  puedeVerControl = false;

  descargandoControl = false;
  descargandoControlExcel = false;
  controlGenerado = false;
  controlUltimaActualizacion: string | null = null;
  controlFileId: string | null = null;
  mostrarControlEditor = false;
  controlVisorCargando = false;

  loadingRegistros = true;
  registrosBD: RegistroControlResolutivo[] = [];
  registrosFiltrados: RegistroControlResolutivo[] = [];
  tiposTramiteUnicos: string[] = [];

  textoBusqueda = '';
  filtroTipoTramite = '';
  filtroFechaIngreso = '';
  filtroEstatus = '';
  filtroFechaAprobacion = '';

  /** Campo de fecha activo para ordenar; vacío = sin orden por fecha */
  ordenCampoFecha: '' | 'fecha_ingreso_tramite' | 'fecha_oficio_observaciones'
    | 'fecha_aprobacion' | 'fecha_vencimiento' | 'fecha_contacto_empresa' = '';
  ordenFechaAsc = true;

  readonly opcionesEstatus = [
    { value: '', label: 'Todos los estatus' },
    { value: 'En tramite', label: 'En trámite' },
    { value: 'Vigentes', label: 'Vigentes' },
    { value: 'Próximo a vencer', label: 'Próximo a vencer' },
    { value: 'Vencido', label: 'Vencido' }
  ];

  readonly opcionesTipoTramite = [
    { value: '', label: 'Tipo de trámite' },
    { value: 'PIPC', label: 'PIPC' },
    { value: 'OTMS', label: 'OTMS' },
    { value: 'Factibilidad', label: 'Factibilidad' }
  ];

  readonly opcionesTipoTramiteEdicion = [
    { value: 'PIPC', label: 'PIPC' },
    { value: 'OTMS', label: 'OTMS' },
    { value: 'Factibilidad', label: 'Factibilidad' },
    { value: 'PIPC EDO', label: 'PIPC EDO' }
  ];

  mostrarModalEditar = false;
  guardandoEdicion = false;
  eliminandoRegistro = false;
  formEditar: FormEditarResolutivo | null = null;

  empresasOpciones: OpcionEmpresa[] = [];
  responsablesOpciones: OpcionResponsable[] = [];
  filtroComboEmpresa = '';
  filtroComboResponsable = '';
  filtroComboTipo = '';
  comboAbierto: '' | 'empresa' | 'responsable' | 'tipo' = '';
  private comboCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.puedeVerControl = this.authService.esAdministradorOSuperior();
    if (!this.puedeVerControl) {
      this.router.navigate(['/proteccion-civil']);
      return;
    }

    this.restaurarEstadoFiltros();
    this.cargarRegistros();
    this.cargarEstadoControlDrive();
    this.cargarCatalogosEdicion();
  }

  ngOnDestroy(): void {
    if (this.comboCloseTimer) clearTimeout(this.comboCloseTimer);
    this.destroy$.next();
    this.destroy$.complete();
    this.liberarBloqueoScroll();
  }

  private getStorageKeyFiltros(): string {
    const usuarioId = this.authService.getUsuarioId() || 'anon';
    return `${this.FILTROS_STORAGE_PREFIX}-${usuarioId}`;
  }

  private guardarEstadoFiltros(): void {
    try {
      sessionStorage.setItem(this.getStorageKeyFiltros(), JSON.stringify({
        textoBusqueda: this.textoBusqueda,
        filtroTipoTramite: this.filtroTipoTramite,
        filtroFechaIngreso: this.filtroFechaIngreso,
        filtroEstatus: this.filtroEstatus,
        filtroFechaAprobacion: this.filtroFechaAprobacion,
        ordenCampoFecha: this.ordenCampoFecha,
        ordenFechaAsc: this.ordenFechaAsc
      }));
    } catch (_) { /* sessionStorage no disponible */ }
  }

  private restaurarEstadoFiltros(): void {
    try {
      const raw = sessionStorage.getItem(this.getStorageKeyFiltros());
      if (!raw) return;
      const estado = JSON.parse(raw);
      this.textoBusqueda = typeof estado.textoBusqueda === 'string' ? estado.textoBusqueda : '';
      this.filtroTipoTramite = typeof estado.filtroTipoTramite === 'string' ? estado.filtroTipoTramite : '';
      this.filtroFechaIngreso = typeof estado.filtroFechaIngreso === 'string' ? estado.filtroFechaIngreso : '';
      this.filtroEstatus = typeof estado.filtroEstatus === 'string' ? estado.filtroEstatus : '';
      this.filtroFechaAprobacion = typeof estado.filtroFechaAprobacion === 'string' ? estado.filtroFechaAprobacion : '';
      const camposFechaValidos = [
        'fecha_ingreso_tramite',
        'fecha_oficio_observaciones',
        'fecha_aprobacion',
        'fecha_vencimiento',
        'fecha_contacto_empresa'
      ];
      this.ordenCampoFecha = camposFechaValidos.includes(estado.ordenCampoFecha) ? estado.ordenCampoFecha : '';
      this.ordenFechaAsc = typeof estado.ordenFechaAsc === 'boolean' ? estado.ordenFechaAsc : true;
    } catch (_) { /* estado corrupto */ }
  }

  cargarRegistros(): void {
    this.loadingRegistros = true;
    this.backendService.obtenerRegistrosControlResolutivos()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.registrosBD = (res?.registros || []) as RegistroControlResolutivo[];
          this.construirTiposTramiteUnicos();
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

  private construirTiposTramiteUnicos(): void {
    const set = new Set<string>();
    this.registrosBD.forEach((r) => {
      if (r.tipo_tramite) set.add(r.tipo_tramite);
    });
    this.tiposTramiteUnicos = Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  filtrarRegistros(): void {
    let resultado = [...this.registrosBD];

    if (this.filtroTipoTramite) {
      resultado = resultado.filter((r) => r.tipo_tramite === this.filtroTipoTramite);
    }

    if (this.filtroFechaIngreso) {
      const fechaDisplay = this.formatFechaInputADisplay(this.filtroFechaIngreso);
      resultado = resultado.filter((r) => r.fecha_ingreso_tramite === fechaDisplay);
    }

    if (this.filtroFechaAprobacion) {
      const fechaDisplay = this.formatFechaInputADisplay(this.filtroFechaAprobacion);
      resultado = resultado.filter((r) => r.fecha_aprobacion === fechaDisplay);
    }

    if (this.filtroEstatus) {
      resultado = resultado.filter((r) => r.estatus === this.filtroEstatus);
    }

    if (this.textoBusqueda && this.textoBusqueda.trim()) {
      const texto = this.textoBusqueda.toLowerCase().trim();
      resultado = resultado.filter((r) =>
        (r.nombre_empresa && r.nombre_empresa.toLowerCase().includes(texto)) ||
        (r.responsable && r.responsable.toLowerCase().includes(texto))
      );
    }

    if (this.ordenCampoFecha) {
      resultado = this.ordenarPorCampoFecha(resultado, this.ordenCampoFecha, this.ordenFechaAsc);
    }

    this.registrosFiltrados = resultado.map((r, i) => ({ ...r, item: i + 1 }));
    this.guardarEstadoFiltros();
  }

  ordenarPorFecha(
    campo: 'fecha_ingreso_tramite' | 'fecha_oficio_observaciones'
      | 'fecha_aprobacion' | 'fecha_vencimiento' | 'fecha_contacto_empresa'
  ): void {
    if (this.ordenCampoFecha === campo) {
      this.ordenFechaAsc = !this.ordenFechaAsc;
    } else {
      this.ordenCampoFecha = campo;
      this.ordenFechaAsc = true;
    }
    this.filtrarRegistros();
  }

  iconoOrdenFecha(campo: string): string {
    if (this.ordenCampoFecha !== campo) return 'fa-sort';
    return this.ordenFechaAsc ? 'fa-sort-up' : 'fa-sort-down';
  }

  private ordenarPorCampoFecha(
    filas: RegistroControlResolutivo[],
    campo: string,
    ascendente: boolean
  ): RegistroControlResolutivo[] {
    return [...filas].sort((a, b) => {
      const ta = this.parseFechaOrden(this.valorFechaRegistro(a, campo));
      const tb = this.parseFechaOrden(this.valorFechaRegistro(b, campo));
      // Sin fecha al final en ambos sentidos
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ascendente ? ta - tb : tb - ta;
    });
  }

  private valorFechaRegistro(row: RegistroControlResolutivo, campo: string): string {
    if (campo === 'fecha_aprobacion' && row.fecha_aprobacion_iso) {
      return row.fecha_aprobacion_iso;
    }
    if (campo === 'fecha_ingreso_tramite' && row.fecha_ingreso_tramite_iso) {
      return row.fecha_ingreso_tramite_iso;
    }
    return String((row as any)[campo] || '');
  }

  /** Acepta yyyy-mm-dd o dd/mm/yyyy; retorna timestamp o null */
  private parseFechaOrden(valor: string): number | null {
    const s = String(valor || '').trim();
    if (!s || s === '—' || s === '-') return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-').map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d).getTime();
    }
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  private formatFechaInputADisplay(fechaInput: string): string {
    if (!fechaInput) return '';
    const [y, m, d] = fechaInput.split('-');
    if (!y || !m || !d) return '';
    return `${d}/${m}/${y}`;
  }

  limpiarFiltros(): void {
    this.textoBusqueda = '';
    this.filtroTipoTramite = '';
    this.filtroFechaIngreso = '';
    this.filtroEstatus = '';
    this.filtroFechaAprobacion = '';
    this.ordenCampoFecha = '';
    this.ordenFechaAsc = true;
    this.filtrarRegistros();
  }

  get hayFiltrosActivos(): boolean {
    return !!(this.textoBusqueda || this.filtroTipoTramite || this.filtroFechaIngreso ||
      this.filtroEstatus || this.filtroFechaAprobacion || this.ordenCampoFecha);
  }

  get hayRegistrosBase(): boolean {
    return this.registrosBD.length > 0;
  }

  get hayRegistrosFiltrados(): boolean {
    return this.registrosFiltrados.length > 0;
  }

  claseEstatus(estatus: string): string {
    const val = (estatus || '').toLowerCase();
    if (val === 'vigentes') return 'estatus--vigentes';
    if (val.includes('próximo') || val.includes('proximo')) return 'estatus--proximo';
    if (val === 'vencido') return 'estatus--vencido';
    return 'estatus--tramite';
  }

  abrirEditarRegistro(row: RegistroControlResolutivo): void {
    if (!row?.resolutivo_id) {
      Swal.fire({
        title: 'Sin ID',
        text: 'Este registro no tiene identificador para editarse.',
        icon: 'warning',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const vencimiento = this.toInputDate(row.fecha_vencimiento_iso || row.fecha_vencimiento);
    this.formEditar = {
      resolutivo_id: Number(row.resolutivo_id),
      empresa_id: row.empresa_id && Number(row.empresa_id) > 0 ? Number(row.empresa_id) : null,
      nombre_empresa: row.nombre_empresa || '',
      tipo_tramite: row.tipo_tramite || '',
      responsable: row.responsable === '—' ? '' : (row.responsable || ''),
      responsable_usuario_id: null,
      fecha_ingreso_tramite: this.toInputDate(row.fecha_ingreso_tramite_iso || row.fecha_ingreso_tramite),
      fecha_oficio_observaciones: this.toInputDate(row.fecha_oficio_observaciones_iso || row.fecha_oficio_observaciones),
      fecha_aprobacion: this.toInputDate(row.fecha_aprobacion_iso || row.fecha_aprobacion),
      fecha_vencimiento: vencimiento,
      fecha_contacto_empresa: this.calcularContactoDesdeVencimiento(vencimiento),
      municipio: row.municipio || '',
      estado: row.estado || '',
      estatus: row.estatus || 'En tramite'
    };

    const matchResp = this.responsablesOpciones.find(
      (r) => this.normalizarTexto(r.nombre) === this.normalizarTexto(this.formEditar!.responsable)
    );
    if (matchResp) this.formEditar.responsable_usuario_id = matchResp.id;

    this.filtroComboEmpresa = this.formEditar.nombre_empresa;
    this.filtroComboResponsable = this.formEditar.responsable;
    this.filtroComboTipo = this.formEditar.tipo_tramite;
    this.comboAbierto = '';
    this.mostrarModalEditar = true;
    this.bloquearScroll();
  }

  cerrarModalEditar(): void {
    if (this.guardandoEdicion || this.eliminandoRegistro) return;
    this.mostrarModalEditar = false;
    this.formEditar = null;
    this.comboAbierto = '';
    this.liberarBloqueoScroll();
  }

  onFechaVencimientoChange(): void {
    if (!this.formEditar) return;
    this.formEditar.fecha_contacto_empresa = this.calcularContactoDesdeVencimiento(
      this.formEditar.fecha_vencimiento
    );
  }

  abrirCombo(cual: 'empresa' | 'responsable' | 'tipo'): void {
    if (this.comboCloseTimer) {
      clearTimeout(this.comboCloseTimer);
      this.comboCloseTimer = null;
    }
    this.comboAbierto = cual;
  }

  cerrarComboDelayed(): void {
    if (this.comboCloseTimer) clearTimeout(this.comboCloseTimer);
    this.comboCloseTimer = setTimeout(() => {
      this.comboAbierto = '';
      this.comboCloseTimer = null;
    }, 160);
  }

  get empresasFiltradas(): OpcionEmpresa[] {
    const q = this.normalizarTexto(this.filtroComboEmpresa);
    if (!q) return this.empresasOpciones.slice(0, 40);
    return this.empresasOpciones
      .filter((e) => this.normalizarTexto(e.nombre).includes(q))
      .slice(0, 40);
  }

  get responsablesFiltrados(): OpcionResponsable[] {
    const q = this.normalizarTexto(this.filtroComboResponsable);
    if (!q) return this.responsablesOpciones.slice(0, 40);
    return this.responsablesOpciones
      .filter((r) => this.normalizarTexto(r.nombre).includes(q))
      .slice(0, 40);
  }

  get tiposFiltrados(): Array<{ value: string; label: string }> {
    const base = [...this.opcionesTipoTramiteEdicion];
    if (this.formEditar?.tipo_tramite
      && !base.some((t) => t.value === this.formEditar!.tipo_tramite)) {
      base.push({ value: this.formEditar.tipo_tramite, label: this.formEditar.tipo_tramite });
    }
    const q = this.normalizarTexto(this.filtroComboTipo);
    if (!q) return base;
    return base.filter((t) => this.normalizarTexto(t.label).includes(q));
  }

  onEmpresaInput(valor: string): void {
    if (!this.formEditar) return;
    this.filtroComboEmpresa = valor;
    this.formEditar.nombre_empresa = valor;
    this.formEditar.empresa_id = null;
    this.abrirCombo('empresa');
  }

  seleccionarEmpresa(op: OpcionEmpresa): void {
    if (!this.formEditar) return;
    this.formEditar.empresa_id = op.id;
    this.formEditar.nombre_empresa = op.nombre;
    this.filtroComboEmpresa = op.nombre;
    if (op.municipio && !this.formEditar.municipio) this.formEditar.municipio = op.municipio;
    if (op.estado && !this.formEditar.estado) this.formEditar.estado = op.estado;
    this.comboAbierto = '';
  }

  onResponsableInput(valor: string): void {
    if (!this.formEditar) return;
    this.filtroComboResponsable = valor;
    this.formEditar.responsable = valor;
    this.formEditar.responsable_usuario_id = null;
    this.abrirCombo('responsable');
  }

  seleccionarResponsable(op: OpcionResponsable): void {
    if (!this.formEditar) return;
    this.formEditar.responsable_usuario_id = op.id;
    this.formEditar.responsable = op.nombre;
    this.filtroComboResponsable = op.nombre;
    this.comboAbierto = '';
  }

  onTipoInput(valor: string): void {
    if (!this.formEditar) return;
    this.filtroComboTipo = valor;
    this.formEditar.tipo_tramite = valor;
    this.abrirCombo('tipo');
  }

  seleccionarTipo(value: string): void {
    if (!this.formEditar) return;
    this.formEditar.tipo_tramite = value;
    this.filtroComboTipo = value;
    this.comboAbierto = '';
  }

  guardarEdicionRegistro(): void {
    if (!this.formEditar || this.guardandoEdicion || this.eliminandoRegistro) return;

    const f = this.formEditar;
    if (!String(f.nombre_empresa || '').trim()) {
      Swal.fire({
        title: 'Dato requerido',
        text: 'El nombre de la empresa es obligatorio.',
        icon: 'warning',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    this.guardandoEdicion = true;
    this.backendService.actualizarRegistroControlResolutivo(f.resolutivo_id, {
      empresa_id: f.empresa_id,
      nombre_empresa: f.nombre_empresa.trim(),
      tipo_tramite: f.tipo_tramite.trim() || null,
      responsable: f.responsable.trim() || '—',
      responsable_usuario_id: f.responsable_usuario_id,
      fecha_ingreso_tramite: f.fecha_ingreso_tramite || null,
      fecha_oficio_observaciones: f.fecha_oficio_observaciones || null,
      fecha_aprobacion: f.fecha_aprobacion || null,
      fecha_vencimiento: f.fecha_vencimiento || null,
      municipio: f.municipio.trim() || null,
      estado: f.estado.trim() || null
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        () => {
          this.guardandoEdicion = false;
          this.cerrarModalEditar();
          this.cargarRegistros();
          Swal.fire({
            title: 'Guardado',
            text: 'El registro del resolutivo se actualizó correctamente.',
            icon: 'success',
            confirmButtonColor: '#d97248',
            timer: 2200,
            showConfirmButton: false
          });
        },
        (err) => {
          this.guardandoEdicion = false;
          Swal.fire({
            title: 'Error',
            text: err?.error?.message || 'No se pudo actualizar el registro.',
            icon: 'error',
            confirmButtonColor: '#d97248'
          });
        }
      );
  }

  private cargarCatalogosEdicion(): void {
    this.backendService.obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          const lista = Array.isArray(res?.empresas) ? res.empresas : (Array.isArray(res) ? res : []);
          this.empresasOpciones = lista
            .map((e: any) => ({
              id: Number(e.empresa_id || e.id || 0),
              nombre: String(e.nombre_empresa || e.nombre || '').trim(),
              municipio: String(e.ciudad || e.municipio || '').trim(),
              estado: String(e.estado || '').trim()
            }))
            .filter((e: OpcionEmpresa) => e.id > 0 && !!e.nombre)
            .sort((a: OpcionEmpresa, b: OpcionEmpresa) => a.nombre.localeCompare(b.nombre, 'es'));
        },
        () => { this.empresasOpciones = []; }
      );

    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          const lista = Array.isArray(res?.usuarios) ? res.usuarios : [];
          this.responsablesOpciones = lista
            .filter((u: any) => {
              const rol = this.normalizarTexto(String(u?.rol || u?.rol_nombre || ''));
              return rol !== 'empresa' && rol !== 'usuario empresa';
            })
            .map((u: any) => ({
              id: Number(u.usuario_id || u.id || 0),
              nombre: this.nombreCompletoUsuario(u)
            }))
            .filter((u: OpcionResponsable) => u.id > 0 && !!u.nombre)
            .sort((a: OpcionResponsable, b: OpcionResponsable) => a.nombre.localeCompare(b.nombre, 'es'));
        },
        () => { this.responsablesOpciones = []; }
      );
  }

  private nombreCompletoUsuario(u: any): string {
    const partes = [u?.nombre, u?.apellido_paterno || u?.apellido, u?.apellido_materno]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    if (partes.length) return partes.join(' ');
    return String(u?.username || u?.correo || '').trim();
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private calcularContactoDesdeVencimiento(fechaVencimiento: string): string {
    if (!fechaVencimiento || !/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento)) return '';
    const [y, m, d] = fechaVencimiento.split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    fecha.setDate(fecha.getDate() - 40);
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  desactivarRegistro(): void {
    if (!this.formEditar || this.guardandoEdicion || this.eliminandoRegistro) return;

    const id = this.formEditar.resolutivo_id;
    const nombre = this.formEditar.nombre_empresa || 'este registro';

    Swal.fire({
      title: '¿Borrar registro?',
      html: `Se desactivará <strong>${this.escapeHtml(nombre)}</strong>.<br><small>No se elimina de la base de datos; solo dejará de mostrarse (activo = 0).</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c0392b',
      cancelButtonColor: '#6b7280'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.eliminandoRegistro = true;
      this.backendService.desactivarRegistroControlResolutivo(id)
        .pipe(takeUntil(this.destroy$))
        .subscribe(
          () => {
            this.eliminandoRegistro = false;
            this.cerrarModalEditar();
            this.cargarRegistros();
            Swal.fire({
              title: 'Registro desactivado',
              text: 'El registro ya no aparece en el listado.',
              icon: 'success',
              confirmButtonColor: '#d97248',
              timer: 2200,
              showConfirmButton: false
            });
          },
          (err) => {
            this.eliminandoRegistro = false;
            Swal.fire({
              title: 'Error',
              text: err?.error?.message || 'No se pudo desactivar el registro.',
              icon: 'error',
              confirmButtonColor: '#d97248'
            });
          }
        );
    });
  }

  private escapeHtml(valor: string): string {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private toInputDate(valor: string | null | undefined): string {
    const s = String(valor || '').trim();
    if (!s || s === '—' || s === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      return `${m[3]}-${mm}-${dd}`;
    }
    return '';
  }

  private bloquearScroll(): void {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private liberarBloqueoScroll(): void {
    if (this.mostrarControlEditor || this.mostrarModalEditar) return;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.classList.remove('visor-fullscreen-open');
  }

  cargarEstadoControlDrive(): void {
    this.backendService.obtenerEstadoControlResolutivosExcelDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.controlGenerado = !!res?.success && !!res?.exists;
          this.controlUltimaActualizacion = res?.file?.modifiedTime || null;
          const nuevoFileId = res?.file?.id || null;
          if (nuevoFileId && nuevoFileId !== this.controlFileId) {
            this.controlVisorCargando = true;
          }
          this.controlFileId = nuevoFileId;
        },
        () => {
          this.controlGenerado = false;
          this.controlUltimaActualizacion = null;
          this.controlFileId = null;
          this.controlVisorCargando = false;
        }
      );
  }

  descargarControlPdf(): void {
    if (this.descargandoControl) return;
    this.descargandoControl = true;

    this.backendService.descargarControlResolutivosPdf()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (blob: Blob) => {
          const fecha = obtenerFechaHoyLocal();
          const nombreArchivo = `control-resolutivos-pipc-${fecha}.pdf`;
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
            text: 'No se pudo generar el PDF del Control de Resolutivos PIPC',
            icon: 'error',
            confirmButtonColor: '#d97248'
          });
        }
      );
  }

  guardarControlExcelEnDrive(): void {
    if (this.descargandoControlExcel) return;
    this.descargandoControlExcel = true;

    this.backendService.guardarControlResolutivosExcelDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (res: any) => {
          this.descargandoControlExcel = false;
          this.controlGenerado = true;
          this.controlUltimaActualizacion = res?.file?.modifiedTime || new Date().toISOString();
          this.controlFileId = res?.file?.id || null;

          const actionTxt = res?.action === 'actualizado' ? 'actualizado' : 'generado';
          Swal.fire({
            title: 'Listo',
            text: `El Control de Resolutivos PIPC fue ${actionTxt} en Drive (${res?.totalRegistros || 0} registros).`,
            icon: 'success',
            confirmButtonColor: '#d97248'
          });

          this.cargarEstadoControlDrive();
          this.cargarRegistros();
        },
        (err) => {
          this.descargandoControlExcel = false;
          Swal.fire({
            title: 'Error',
            text: err?.error?.message || 'No se pudo guardar el Control de Resolutivos PIPC en Drive',
            icon: 'error',
            confirmButtonColor: '#d97248'
          });
        }
      );
  }

  toggleControlEditor(): void {
    if (!this.controlFileId) {
      Swal.fire({
        title: 'Sin archivo',
        text: 'Primero genera el Control de Resolutivos PIPC para poder abrir el editor integrado.',
        icon: 'info',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    this.mostrarControlEditor = !this.mostrarControlEditor;
    if (this.mostrarControlEditor) {
      this.controlVisorCargando = true;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.classList.add('visor-fullscreen-open');
    } else {
      this.liberarBloqueoScroll();
    }
  }

  get controlEmbedUrl(): string {
    if (!this.controlFileId) return '';
    return `https://docs.google.com/spreadsheets/d/${this.controlFileId}/edit?usp=sharing`;
  }

  onControlIframeLoad(): void {
    this.controlVisorCargando = false;
  }
}
