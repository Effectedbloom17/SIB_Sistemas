import { Component, OnInit, HostListener } from '@angular/core';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { environment } from 'src/environments/environment';
import { firstValueFrom, forkJoin } from 'rxjs';
import Swal from 'sweetalert2';
import { ORGANIGRAMA_BIZNAGA_GRUPOS } from '../recursos-humanos/organigrama-biznaga.catalog';

@Component({
  selector: 'app-gestion-usuarios',
  templateUrl: './gestion-usuarios.component.html',
  styleUrls: ['./gestion-usuarios.component.scss']
})
export class GestionUsuariosComponent implements OnInit {

  usuarios: any[] = [];
  usuariosFiltrados: any[] = []; // Usuarios filtrados para mostrar en la tabla
  usuariosInternos: any[] = []; // Admins, instructores, consulta
  usuariosInternosFiltrados: any[] = [];
  usuariosEmpresas: any[] = []; // Usuarios de empresas
  usuariosEmpresasFiltrados: any[] = [];
  roles: any[] = [];
  rolesDisponibles: any[] = []; // Roles que se pueden asignar según permisos
  areasTematicas: any[] = []; // Áreas temáticas disponibles para instructores
  cargando: boolean = false;
  esRoot: boolean = false;
  esAdministrador: boolean = false;
  areasDropdownAbierto: number | null = null; // ID del usuario cuyo dropdown está abierto
  areasDropdownPosition: { top: number; left: number } = { top: 0, left: 0 };
  areasDropdownArriba: boolean = false;
  areasDropdownBtnRef: HTMLElement | null = null; // Referencia al botón que abrió el dropdown
  textoBusqueda: string = ''; // Texto de búsqueda internos
  textoBusquedaEmpresas: string = ''; // Texto de búsqueda empresas
  seccionActiva: 'internos' | 'empresas' = 'internos'; // Tab activa (Administradores por defecto)

  constructor(
    private backendService: BackendServices,
    private authService: AuthService
  ) { }

  /**
   * Cierra el dropdown de áreas al hacer clic fuera
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.areas-dropdown-container') && !target.closest('.areas-dropdown-fixed')) {
      this.areasDropdownAbierto = null;
      this.areasDropdownBtnRef = null;
    }
  }

  /**
   * Reposiciona el dropdown de áreas al hacer scroll para que siga al botón
   */
  @HostListener('window:scroll')
  onWindowScroll() {
    if (this.areasDropdownAbierto !== null && this.areasDropdownBtnRef) {
      this.recalcularPosicionDropdown();
    }
  }

  // trackBy: evita re-render completo de las tablas de usuarios al filtrar/buscar.
  trackByUsuarioId(_index: number, usuario: any): any {
    if (usuario?.es_empresa_colaboradora_sin_usuario) {
      return `colab-${usuario.empresa_id}`;
    }
    return usuario?.usuario_id ?? usuario?.id ?? _index;
  }

  ngOnInit(): void {
    this.esRoot = this.authService.esSuperusuario();
    this.esAdministrador = this.authService.esAdministrador();
    this.cargarUsuarios();
    this.cargarRoles();
    this.cargarAreasTematicas();
  }

  /**
   * Carga las áreas temáticas para asignar a instructores
   */
  cargarAreasTematicas() {
    this.backendService.obtenerAreas().subscribe(
      (response: any) => {
        if (response.success) {
          this.areasTematicas = response.areas;
        }
      },
      (error) => {
        console.error('Error al cargar áreas temáticas:', error);
      }
    );
  }

  cargarUsuarios() {
    this.cargando = true;
    const usuarioActual = this.authService.getUsername(); // Obtener usuario logueado

    forkJoin({
      usuarios: this.backendService.obtenerUsuarios(),
      empresas: this.backendService.obtenerEmpresas()
    }).subscribe({
      next: ({ usuarios: response, empresas: respuestaEmpresas }: any) => {
        if (response.success) {
          this.usuarios = response.usuarios;
          this.usuariosFiltrados = [...this.usuarios];

          // Separar usuarios en internos (admin, instructor, consulta) y empresas
          // Excluir al usuario actual de la lista de internos
          this.usuariosInternos = this.usuarios.filter(u => {
            const rol = u.rol?.toLowerCase();
            const esInterno = rol !== 'empresa' && rol !== 'usuario empresa';
            const noEsUsuarioActual = u.username !== usuarioActual;
            return esInterno && noEsUsuarioActual;
          });

          this.usuariosEmpresas = this.usuarios.filter(u => {
            const rol = u.rol?.toLowerCase();
            return rol === 'empresa' || rol === 'usuario empresa';
          });

          if (respuestaEmpresas?.success) {
            const colaboradorasSinUsuario = this.construirEmpresasColaboradorasSinUsuario(
              respuestaEmpresas.empresas || [],
              this.usuariosEmpresas
            );
            this.usuariosEmpresas = [...this.usuariosEmpresas, ...colaboradorasSinUsuario];
            this.usuariosEmpresas.sort((a, b) =>
              String(a.nombre_empresa || '').localeCompare(String(b.nombre_empresa || ''), 'es', { sensitivity: 'base' })
            );
          }

          // Ordenar usuarios internos: administradores primero, luego instructores
          this.usuariosInternos.sort((a, b) => {
            const rolA = a.rol?.toLowerCase() || '';
            const rolB = b.rol?.toLowerCase() || '';

            // Prioridad: administrador > instructor > doctor > consulta/otros
            const prioridades: { [key: string]: number } = {
              'administrador': 1,
              'instructor': 2,
              'doctor': 3,
              'consulta': 4,
              'solo consulta': 4
            };

            const prioridadA = prioridades[rolA] || 99;
            const prioridadB = prioridades[rolB] || 99;

            return prioridadA - prioridadB;
          });

          this.usuariosInternosFiltrados = [...this.usuariosInternos];
          this.usuariosEmpresasFiltrados = [...this.usuariosEmpresas];
        }
        this.cargando = false;
      },
      error: (error) => {
        console.error('Error:', error);
        this.cargando = false;
        Swal.fire('Error', 'No se pudieron cargar los usuarios', 'error');
      }
    });
  }

  /**
   * Empresas colaboradoras registradas sin usuario propio (acceso vía empresa principal).
   */
  private construirEmpresasColaboradorasSinUsuario(empresas: any[], usuariosEmpresa: any[]): any[] {
    const idsConUsuario = new Set(
      usuariosEmpresa.map((u) => Number(u.empresa_id)).filter((id) => id > 0)
    );
    const mapaEmpresas = new Map(
      empresas.map((e) => [Number(e.empresa_id), e])
    );
    const mapaUsuarioPorEmpresaId = new Map(
      usuariosEmpresa.map((u) => [Number(u.empresa_id), u])
    );

    return empresas
      .filter((empresa) => {
        const empresaId = Number(empresa?.empresa_id || 0);
        const colaboradorId = Number(empresa?.colaborador || 0);
        return empresaId > 0 && colaboradorId > 0 && !idsConUsuario.has(empresaId);
      })
      .map((empresa) => {
        const parentId = Number(empresa.colaborador);
        const parentUsuario = mapaUsuarioPorEmpresaId.get(parentId);
        const parentEmpresa = mapaEmpresas.get(parentId);
        const nombrePrincipal = parentEmpresa?.nombre_empresa || parentUsuario?.nombre_empresa || 'empresa principal';
        const usernamePrincipal = parentUsuario?.username || '';

        return {
          id: null,
          usuario_id: null,
          empresa_id: empresa.empresa_id,
          nombre_empresa: empresa.nombre_empresa,
          empresa_logo: empresa.logo,
          empresa_colaborador: empresa.colaborador,
          empresa_principal_nombre: nombrePrincipal,
          servicio_proteccion_civil: empresa.servicio_proteccion_civil,
          rol: 'empresa',
          es_empresa_colaboradora_sin_usuario: true,
          username: usernamePrincipal || '—',
          acceso_compartido_label: usernamePrincipal
            ? `Vía ${usernamePrincipal}`
            : `Vía ${nombrePrincipal}`,
          nombre: String(empresa.contacto_nombre || parentUsuario?.nombre || '').trim(),
          apellido: '',
          email: empresa.usuario_email || empresa.email || empresa.contacto_email || parentUsuario?.email || '',
          empresa_email: empresa.email,
          empresa_contacto_email: empresa.contacto_email,
          empresa_puesto: empresa.puesto
        };
      });
  }

  /**
   * Filtra usuarios internos por nombre, usuario, email o rol
   */
  filtrarUsuarios() {
    if (!this.textoBusqueda || this.textoBusqueda.trim() === '') {
      this.usuariosInternosFiltrados = [...this.usuariosInternos];
    } else {
      const filtro = this.textoBusqueda.toLowerCase();
      this.usuariosInternosFiltrados = this.usuariosInternos.filter(u =>
        (u.username && u.username.toLowerCase().includes(filtro)) ||
        (u.nombre && u.nombre.toLowerCase().includes(filtro)) ||
        (u.apellido && u.apellido.toLowerCase().includes(filtro)) ||
        (u.email && u.email.toLowerCase().includes(filtro)) ||
        (u.rol && u.rol.toLowerCase().includes(filtro))
      );
    }
  }

  /**
   * Filtra usuarios de empresas por nombre de empresa, usuario, nombre o email
   */
  filtrarUsuariosEmpresas() {
    if (!this.textoBusquedaEmpresas || this.textoBusquedaEmpresas.trim() === '') {
      this.usuariosEmpresasFiltrados = [...this.usuariosEmpresas];
    } else {
      const filtro = this.textoBusquedaEmpresas.toLowerCase();
      this.usuariosEmpresasFiltrados = this.usuariosEmpresas.filter(u =>
        (u.nombre_empresa && u.nombre_empresa.toLowerCase().includes(filtro)) ||
        (u.username && u.username.toLowerCase().includes(filtro)) ||
        (u.acceso_compartido_label && u.acceso_compartido_label.toLowerCase().includes(filtro)) ||
        (u.empresa_principal_nombre && u.empresa_principal_nombre.toLowerCase().includes(filtro)) ||
        (u.nombre && u.nombre.toLowerCase().includes(filtro)) ||
        (u.apellido && u.apellido.toLowerCase().includes(filtro)) ||
        (u.email && u.email.toLowerCase().includes(filtro))
      );
    }
  }

  /**
   * Cambia la sección activa (internos o empresas)
   */
  cambiarSeccion(seccion: 'internos' | 'empresas') {
    this.seccionActiva = seccion;
  }

  private generarSugerenciasPassword(total: number = 3, length: number = 14): string[] {
    const sugerencias = new Set<string>();
    while (sugerencias.size < total) {
      sugerencias.add(this.generarPasswordSegura(length));
    }
    return Array.from(sugerencias);
  }

  private generarPasswordSegura(length: number): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;
    const finalLength = Math.max(8, length);

    const base: string[] = [
      upper[this.randomIndex(upper.length)],
      lower[this.randomIndex(lower.length)],
      digits[this.randomIndex(digits.length)],
      upper[this.randomIndex(upper.length)]
    ];

    while (base.length < finalLength) {
      base.push(all[this.randomIndex(all.length)]);
    }

    for (let i = base.length - 1; i > 0; i--) {
      const j = this.randomIndex(i + 1);
      const temp = base[i];
      base[i] = base[j];
      base[j] = temp;
    }

    return base.join('');
  }

  private randomIndex(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoApi?.getRandomValues) {
      const array = new Uint32Array(1);
      cryptoApi.getRandomValues(array);
      return array[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  getLogoEmpresaPreviewUrl(logoRaw: any): string {
    return this.backendService.resolverUrlDrivePreview(logoRaw) || '';
  }

  getFotoUsuarioUrl(usuario: any): string | null {
    return this.backendService.resolverUrlDrivePreview(usuario?.foto_drive_id || usuario?.foto_url);
  }

  onFotoUsuarioError(usuario: any): void {
    usuario.foto_drive_id = null;
    usuario.foto_url = null;
  }

  cargarRoles() {
    this.backendService.obtenerRoles().subscribe(
      (response: any) => {
        if (response.success) {
          this.roles = response.roles;
          /**
           * PERMISOS DE ASIGNACIÓN DE ROLES:
           * - root: puede asignar 'administrador', 'instructor', 'consulta'
           * - administrador: solo puede asignar 'instructor', 'consulta'
           * - Nunca se puede asignar el rol 'root' ni 'empresa' (empresa se crea desde mis-empresas)
           */
          const esRoot = this.authService.esSuperusuario();
          const esAdmin = this.authService.esAdministrador();

          this.rolesDisponibles = this.roles.filter(rol => {
            const nombreRol = rol.nombre_rol?.toLowerCase();

            // Nunca mostrar el rol 'root' para asignar
            if (nombreRol === 'root') return false;

            // Nunca mostrar el rol 'empresa' (se crea desde mis-empresas)
            if (nombreRol === 'empresa' || nombreRol === 'usuario empresa') return false;

            // Solo root puede asignar 'administrador'
            if (nombreRol === 'administrador' && !esRoot) return false;

            // Administrador puede asignar roles operativos (no root)
            if (esAdmin && !esRoot) {
              return nombreRol === 'instructor' || nombreRol === 'doctor' || nombreRol === 'consulta' || nombreRol === 'solo consulta' || nombreRol === 'proteccion_civil' || nombreRol === 'sgc' || nombreRol === 'ambiental' || nombreRol === 'control_documental' || nombreRol === 'innovacion' || nombreRol === 'rrhh' || nombreRol === 'mantenimiento';
            }

            // Root puede asignar todo lo que pasó los filtros anteriores
            return true;
          });
        }
      },
      (error) => {
        console.error('Error al cargar roles:', error);
      }
    );
  }

  /**
   * Modal para crear nuevo usuario
   * 
   * VERIFICACIÓN DE BASE DE DATOS:
   * Tabla: usuario (username, nombre, apellido, email, telefono, clave, rol_id)
   * Backend: POST /api/usuarios
   * Acepta: username*, email, clave*, nombre, apellido, telefono, rol_id
   * 
   * PERMISOS:
   * - Root: puede crear administradores, instructores y solo consulta
   * - Administrador: puede crear instructores y solo consulta
   * - Otros roles: no pueden crear usuarios
   * 
   * Restricciones: 
   * - No permite rol_id = 1 (root)
   * - Contraseña mínimo 8 caracteres
   * - Se hashea automáticamente con bcrypt
   */
  async abrirFormularioNuevo() {
    // Verificar permisos: solo root y administrador pueden crear usuarios
    if (!this.esRoot && !this.esAdministrador) {
      Swal.fire({
        title: 'Acceso Denegado',
        text: 'No tiene permisos para crear usuarios',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Verificar que hay roles disponibles
    if (this.rolesDisponibles.length === 0) {
      Swal.fire({
        title: 'Sin Roles Disponibles',
        text: 'No hay roles disponibles para asignar. Contacte al administrador.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // IDs de todas las áreas temáticas (se auto-asignan a los instructores)
    const todasLasAreasIds = this.areasTematicas.map((a: any) => a.area_id);

    const htmlForm = `
      <style>
        /* ============================================================
           NUEVO USUARIO — Diseño profesional Biznaga
        ============================================================ */

        .eu-container { text-align: left; font-family: 'Open Sans', sans-serif; }

        /* Sección card */
        .eu-section {
          background: #fff; border-radius: 10px; margin-bottom: 0.85rem;
          border: 1px solid #e9ecef; overflow: visible;
        }
        .eu-section-header {
          display: flex; align-items: center; gap: 0.55rem;
          padding: 0.6rem 1rem; background: linear-gradient(90deg, rgba(56,81,47,0.06) 0%, rgba(118,141,107,0.03) 100%);
          border-bottom: 1px solid #e9ecef;
          border-left: 3px solid #38512F;
        }
        .eu-section-header i { font-size: 0.7rem; color: #38512F; }
        .eu-section-header span {
          font-size: 0.68rem; font-weight: 700; color: #38512F;
          text-transform: uppercase; letter-spacing: 0.8px;
        }
        .eu-section-header .eu-section-badge {
          margin-left: auto; font-size: 0.65rem; font-weight: 700;
          color: #768D6B; background: rgba(118,141,107,0.12);
          border-radius: 10px; padding: 0.1rem 0.5rem;
        }
        .eu-section-body { padding: 0.85rem 1rem; }

        /* Grid */
        .eu-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.65rem; }
        .eu-row:last-child { margin-bottom: 0; }
        .eu-row.eu-row-single { grid-template-columns: 1fr; }
        @media (max-width: 500px) { .eu-row { grid-template-columns: 1fr; } }

        /* Campos */
        .eu-field { display: flex; flex-direction: column; }
        .eu-field label {
          font-size: 0.68rem; font-weight: 700; color: #6c757d;
          text-transform: uppercase; letter-spacing: 0.5px;
          margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.3rem;
        }
        .eu-field label i { color: #38512F; font-size: 0.65rem; }

        /* Input con icono integrado */
        .eu-input-wrap { position: relative; display: flex; align-items: center; }
        .eu-input-wrap .eu-input-icon {
          position: absolute; left: 0.65rem; color: #adb5bd;
          font-size: 0.75rem; pointer-events: none; transition: color 0.2s;
          z-index: 1;
        }
        .eu-input-wrap input, .eu-input-wrap select {
          width: 100%; padding: 0.5rem 0.65rem 0.5rem 2rem;
          font-size: 0.82rem; color: #32325d;
          border: 1.5px solid #dee2e6; border-radius: 7px;
          outline: none; transition: all 0.2s; background: #fff;
          font-family: 'Open Sans', sans-serif;
        }
        .eu-input-wrap input:focus, .eu-input-wrap select:focus {
          border-color: #38512F;
          box-shadow: 0 0 0 3px rgba(56,81,47,0.1);
        }
        .eu-input-wrap input:focus ~ .eu-input-icon,
        .eu-input-wrap select:focus ~ .eu-input-icon { color: #38512F; }
        .eu-input-wrap input:focus + .eu-input-icon,
        .eu-input-wrap select:focus + .eu-input-icon { color: #38512F; }
        .eu-input-wrap .eu-eye-btn {
          position: absolute;
          right: 0.55rem;
          border: none;
          background: transparent;
          color: #768D6B;
          font-size: 0.8rem;
          padding: 0.2rem;
          cursor: pointer;
          line-height: 1;
        }
        .eu-input-wrap .eu-eye-btn:hover { color: #38512F; }
        .eu-input-wrap input.with-eye { padding-right: 2rem; }

        /* Select */
        .eu-select-wrap { position: relative; }
        .eu-select-wrap select { appearance: none; padding-right: 2rem; }
        .eu-select-wrap::after {
          content: '\\f078'; font-family: 'Font Awesome 5 Free'; font-weight: 900;
          position: absolute; right: 0.7rem; top: 50%; transform: translateY(-50%);
          font-size: 0.6rem; color: #adb5bd; pointer-events: none;
        }

        /* Campo de cargo extra */
        #swal-cargo-otro { display: none; margin-top: 0.45rem; }
        #swal-cargo-otro input { width: 100%; padding: 0.45rem 0.65rem; font-size: 0.82rem;
          border: 1.5px solid #dee2e6; border-radius: 7px; outline: none; transition: all 0.2s; }
        #swal-cargo-otro input:focus { border-color: #38512F; box-shadow: 0 0 0 3px rgba(56,81,47,0.1); }

        /* Áreas */
        .eu-areas { display: none; }
        .eu-areas.visible { display: block; animation: euFadeIn 0.25s ease; }
        .eu-tags-wrap {
          display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0.65rem;
          background: #f8f9fa; border-radius: 8px; max-height: 130px; overflow-y: auto;
        }
        .eu-tags-wrap::-webkit-scrollbar { width: 4px; }
        .eu-tags-wrap::-webkit-scrollbar-thumb { background: #C2D1B2; border-radius: 2px; }
        .area-tag {
          display: inline-flex; align-items: center; gap: 0.3rem;
          padding: 0.28rem 0.65rem; border-radius: 20px;
          border: 1.5px solid #dee2e6; background: #fff; cursor: pointer;
          font-size: 0.72rem; font-weight: 600; color: #495057;
          transition: all 0.2s ease; user-select: none;
        }
        .area-tag:hover { border-color: #768D6B; color: #38512F; background: rgba(56,81,47,0.05); }
        .area-tag input { display: none; }
        .area-tag .tag-check { font-size: 0.5rem; color: transparent; transition: all 0.2s; }
        .area-tag.selected { background: linear-gradient(135deg, #38512F, #5a7456); border-color: #38512F; color: #fff; }
        .area-tag.selected .tag-check { color: rgba(255,255,255,0.9); }
        .eu-areas-count { font-size: 0.68rem; color: #768D6B; font-weight: 600; margin-left: auto; }
        ${this.getEuModalAnimations()}
        ${this.getRolPickerStyles()}

        /* Firma dropzone */
        #firma-dropzone {
          border: 2px dashed #C2D1B2; border-radius: 9px;
          padding: 1.1rem; text-align: center; cursor: pointer;
          transition: all 0.3s ease; background: #f8f9fa;
        }
        #firma-dropzone:hover { border-color: #768D6B; background: rgba(56,81,47,0.04); }

        /* Password match indicator */
        .pw-status {
          display: flex; align-items: center; gap: 0.4rem;
          padding: 0.4rem 0.65rem; border-radius: 6px;
          font-size: 0.72rem; font-weight: 600; margin-top: 0.5rem;
        }
        .pw-status.pw-ok { background: rgba(56,81,47,0.08); color: #38512F; }
        .pw-status.pw-error { background: rgba(245,54,92,0.08); color: #f5365c; }
        .pw-status i { font-size: 0.7rem; }
        .password-suggestions { margin-top: 0.55rem; }
        .password-suggestions__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: nowrap;
          gap: 0.6rem;
          margin-bottom: 0.35rem;
        }
        .password-suggestions__header small {
          font-size: 0.65rem;
          color: #6c7a6f;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.45px;
          white-space: nowrap;
        }
        .password-suggestions__refresh {
          border: none;
          background: transparent;
          color: #38512F;
          font-size: 0.68rem;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.2rem;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .password-suggestions__refresh:hover { color: #2c3f25; }
        .password-suggestions__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.32rem;
        }
        .password-suggestions__chip {
          border: 1px solid #c8d4c2;
          border-radius: 999px;
          background: #f3f7f1;
          color: #2f4630;
          font-size: 0.67rem;
          font-weight: 600;
          padding: 0.22rem 0.56rem;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .password-suggestions__chip:hover {
          background: #38512F;
          color: #fff;
          border-color: #38512F;
        }

        /* Credenciales extra */
        #cred-extra-edit-container {
          display: none;
          margin-top: 0.5rem;
          padding: 0.55rem;
          border-radius: 8px;
          border: 1px solid rgba(118,141,107,0.25);
          background: rgba(118,141,107,0.06);
        }
        .cred-extra-toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.74rem;
          font-weight: 700;
          color: #38512F;
          cursor: pointer;
        }
        .cred-extra-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 0.45rem;
          margin-bottom: 0.45rem;
        }
        .cred-extra-add-btn {
          border: 1px solid #38512F;
          border-radius: 7px;
          background: #fff;
          color: #38512F;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.45rem 0.7rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .cred-extra-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .cred-extra-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border-radius: 999px;
          background: rgba(15,76,129,0.12);
          color: #0F4C81;
          padding: 0.2rem 0.55rem;
          font-size: 0.68rem;
          font-weight: 700;
        }
        .cred-extra-chip button {
          border: none;
          background: transparent;
          color: #0F4C81;
          font-size: 0.64rem;
          padding: 0;
          line-height: 1;
          cursor: pointer;
        }

        @keyframes euFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        /* ===== Layout una columna ===== */
        .eu-layout { display: flex; flex-direction: column; gap: 0.65rem; min-height: 0; text-align: left; }
        .eu-right { display: flex; flex-direction: column; gap: 0.65rem; }
        .eu-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        @media (max-width: 640px) { .eu-media-grid { grid-template-columns: 1fr; } }
        .eu-combo { position: relative; }
        .eu-combo-control {
          display: flex; align-items: center; gap: 0.45rem;
          min-height: 42px; padding: 0 0.7rem;
          border-radius: 9px; background: #fff;
          border: 1.5px solid #dee2e6; cursor: text;
        }
        .eu-combo.is-open .eu-combo-control, .eu-combo-control:focus-within {
          border-color: #38512F; box-shadow: 0 0 0 3px rgba(56,81,47,0.1);
        }
        .eu-combo-icon { color: #38512F; font-size: 0.75rem; }
        .eu-combo-control input { flex: 1; border: none; outline: none; background: transparent; font-size: 0.84rem; color: #32325d; min-width: 0; }
        .eu-combo-clear, .eu-combo-chevron { color: #adb5bd; background: none; border: none; cursor: pointer; }
        @keyframes euComboDropIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes euComboOptionIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .eu-combo-dropdown {
          display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 30;
          max-height: 240px; overflow-y: auto; padding: 0.4rem;
          background: #fff; border: 1px solid #e2e8de; border-radius: 12px;
          box-shadow: 0 16px 36px rgba(15,23,42,0.14);
          transform-origin: top center;
        }
        .eu-combo.is-open .eu-combo-dropdown {
          display: block;
          animation: euComboDropIn 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .eu-combo-chevron { transition: transform 0.22s ease; display: inline-flex; }
        .eu-combo.is-open .eu-combo-chevron { transform: rotate(180deg); }
        .eu-combo.is-open .eu-combo-option {
          animation: euComboOptionIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .eu-combo-group-label { margin: 0.25rem 0.45rem 0.35rem; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #8a9684; }
        .eu-combo-option { width: 100%; display: flex; align-items: center; gap: 0.55rem; border: none; background: transparent; text-align: left; cursor: pointer; padding: 0.45rem 0.5rem; border-radius: 10px; }
        .eu-combo-option:hover, .eu-combo-option.is-selected { background: rgba(56,81,47,0.08); }
        .eu-combo-option-icon { width: 1.6rem; height: 1.6rem; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(56,81,47,0.1); color: #38512F; font-size: 0.65rem; flex-shrink: 0; }
        .eu-combo-option-title { font-size: 0.78rem; font-weight: 700; }
        .eu-combo-option-meta { font-size: 0.64rem; color: #7b8676; }
        .eu-combo-check { color: #38512F; font-size: 0.7rem; }
        .eu-combo-empty { display: flex; align-items: center; gap: 0.4rem; padding: 0.7rem 0.5rem; color: #8a9684; font-size: 0.78rem; }
        .eu-media-section { background: #fff; border-radius: 10px; border: 1px solid #e9ecef; overflow: hidden; }
        .eu-media-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.48rem 0.85rem; background: linear-gradient(90deg, rgba(56,81,47,0.06) 0%, rgba(118,141,107,0.03) 100%); border-bottom: 1px solid #e9ecef; border-left: 3px solid #38512F; }
        .eu-media-header i { font-size: 0.67rem; color: #38512F; }
        .eu-media-header span { font-size: 0.67rem; font-weight: 700; color: #38512F; text-transform: uppercase; letter-spacing: 0.8px; }
        .eu-media-header .eu-badge { margin-left: auto; font-size: 0.6rem; font-weight: 700; color: #768D6B; background: rgba(118,141,107,0.12); border-radius: 10px; padding: 0.08rem 0.42rem; }
        .eu-media-body { padding: 0.6rem; }
        .eu-dropzone { border: 2px dashed #C2D1B2; border-radius: 9px; padding: 0.8rem 0.6rem; text-align: center; cursor: pointer; transition: all 0.25s ease; background: #f8f9fa; min-height: 82px; display: flex; align-items: center; justify-content: center; flex-direction: column; }
        .eu-dropzone:hover { border-color: #768D6B; background: rgba(56,81,47,0.04); }
        .eu-dropzone .dz-icon { font-size: 1.5rem; color: #C2D1B2; margin-bottom: 0.28rem; }
        .eu-dropzone p { font-size: 0.69rem; color: #8898aa; margin: 0; font-weight: 600; }
        .eu-dropzone small { font-size: 0.61rem; color: #adb5bd; margin-top: 0.08rem; display: block; }
        .eu-dz-preview { display: none; flex-direction: column; align-items: center; }
        .eu-dz-preview img { max-height: 75px; max-width: 100%; border-radius: 6px; border: 1px solid #dee2e6; object-fit: contain; }
        .eu-preview-name { font-size: 0.67rem; color: #38512F; margin: 0.18rem 0 0; font-weight: 600; word-break: break-word; }
        .eu-remove-btn { background: none; border: none; color: #f5365c; font-size: 0.65rem; cursor: pointer; margin-top: 0.12rem; }
        #credential-container {
          display: none;
          margin-top: 0.5rem;
          padding: 0.55rem;
          border-radius: 8px;
          border: 1px solid rgba(118,141,107,0.25);
          background: rgba(118,141,107,0.06);
        }
        .cred-extra-toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.74rem;
          font-weight: 700;
          color: #38512F;
          cursor: pointer;
        }
        .cred-extra-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 0.45rem;
          margin-bottom: 0.45rem;
        }
        .cred-extra-add-btn {
          border: 1px solid #38512F;
          border-radius: 7px;
          background: #fff;
          color: #38512F;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.45rem 0.7rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .cred-extra-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .cred-extra-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border-radius: 999px;
          background: rgba(15,76,129,0.12);
          color: #0F4C81;
          padding: 0.2rem 0.55rem;
          font-size: 0.68rem;
          font-weight: 700;
        }
        .cred-extra-chip button {
          border: none;
          background: transparent;
          color: #0F4C81;
          font-size: 0.64rem;
          padding: 0;
          line-height: 1;
          cursor: pointer;
        }
      </style>

      <div class="eu-layout">
        <div class="eu-right" id="eu-right">

          <!-- NIVEL DE ACCESO -->
          <div class="eu-section">
            <div class="eu-section-header">
              <i class="fas fa-layer-group"></i>
              <span>Nivel de Acceso</span>
            </div>
            <div class="eu-section-body">
              <div class="eu-row eu-row-single">
                <div class="eu-field">
                  <label><i class="ni ni-single-02"></i> Usuario de Acceso *</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon ni ni-single-02"></i>
                    <input id="swal-username" type="text" placeholder="usuario123" autocomplete="off">
                  </div>
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-shield-alt"></i> Roles del Sistema *</label>
                <div id="roles-checkboxes" class="roles-picker">
                  ${this.buildRolTagsHtml()}
                </div>
              </div>
            </div>
          </div>

          <div class="eu-section">
            <div class="eu-section-header">
              <i class="fas fa-sitemap"></i>
              <span>Organigrama Biznaga</span>
            </div>
            <div class="eu-section-body">
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-id-badge"></i> Puesto en el organigrama</label>
                  ${this.buildOrganigramaComboboxHtml('')}
                </div>
                <div class="eu-field">
                  <label><i class="fas fa-building"></i> Área/Departamento</label>
                  ${this.buildAreaDepartamentoComboboxHtml('')}
                </div>
              </div>
            </div>
          </div>

          <!-- INFORMACIÓN PERSONAL -->
          <div class="eu-section">
            <div class="eu-section-header">
              <i class="fas fa-user"></i>
              <span>Información Personal</span>
            </div>
            <div class="eu-section-body">
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-graduation-cap"></i> Cargo / Título</label>
                  <div class="eu-input-wrap eu-select-wrap">
                    <i class="eu-input-icon fas fa-graduation-cap"></i>
                    <select id="swal-cargo">
                      <option value="">-- Sin --</option>
                      <option value="Ing.">Ing.</option>
                      <option value="Mtro.">Mtro.</option>
                      <option value="Mtra.">Mtra.</option>
                      <option value="Dr.">Dr.</option>
                      <option value="Dra.">Dra.</option>
                      <option value="Lic.">Lic.</option>
                      <option value="Prof.">Prof.</option>
                      <option value="C.">C.</option>
                      <option value="Otro">Otro (escribir)</option>
                    </select>
                  </div>
                  <div id="swal-cargo-otro">
                    <div class="eu-input-wrap">
                      <i class="eu-input-icon fas fa-pen"></i>
                      <input id="swal-cargo-otro-input" type="text" placeholder="Especifique cargo o título">
                    </div>
                  </div>
                </div>
                <div class="eu-field">
                  <label><i class="fas fa-user-edit"></i> Nombre *</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-user"></i>
                    <input id="swal-nombre" type="text" placeholder="Nombre(s)">
                  </div>
                </div>
              </div>
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-user-edit"></i> Apellido(s)</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-user"></i>
                    <input id="swal-apellido" type="text" placeholder="Apellido(s)">
                  </div>
                </div>
                <div class="eu-field" id="curp-container" style="display:none;">
                  <label><i class="fas fa-id-card"></i> CURP <span style="font-size:0.62rem;color:#768D6B;">(Instructor)</span></label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-id-card"></i>
                    <input id="swal-curp" type="text" placeholder="18 caracteres" maxlength="18" style="text-transform: uppercase;">
                  </div>
                </div>
                <div class="eu-field" id="cedula-container" style="display:none;">
                  <label><i class="fas fa-user-md"></i> Cédula Médica * <span style="font-size:0.62rem;color:#768D6B;">(7-8 dígitos)</span></label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-user-md"></i>
                    <input id="swal-cedula" type="text" placeholder="Ej: 1234567" maxlength="8">
                  </div>
                </div>
              </div>
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-envelope"></i> Email</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-envelope"></i>
                    <input id="swal-email" type="email" placeholder="correo@ejemplo.com">
                  </div>
                </div>
                <div class="eu-field">
                  <label><i class="fas fa-phone"></i> Teléfono</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-phone"></i>
                    <input id="swal-telefono" type="text" placeholder="(000) 000-0000">
                  </div>
                </div>
              </div>
              <div class="eu-row" style="grid-template-columns: 1fr;">
                <div class="eu-field">
                  <label><i class="fas fa-paper-plane"></i> Envío de credenciales</label>
                  <label class="cred-extra-toggle">
                    <input id="swal-credenciales-extra-toggle" type="checkbox">
                    ¿Enviar credenciales a otros correos?
                  </label>
                  <div id="credential-container">
                    <div class="cred-extra-row">
                      <div class="eu-input-wrap">
                        <i class="eu-input-icon fas fa-envelope-open-text"></i>
                        <input id="swal-credenciales-extra-input" type="email" placeholder="correo.adicional@ejemplo.com">
                      </div>
                      <button type="button" id="swal-credenciales-extra-add" class="cred-extra-add-btn">
                        <i class="fas fa-plus"></i> Añadir
                      </button>
                    </div>
                    <div id="swal-credenciales-extra-list" class="cred-extra-list"></div>
                    <input id="swal-credenciales-extra-json" type="hidden" value="[]">
                    <small style="font-size:0.64rem;color:#6c7a6f;">Puedes agregar uno o varios correos para recibir copia de las credenciales.</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SEGURIDAD -->
          <div class="eu-section">
            <div class="eu-section-header">
              <i class="fas fa-lock"></i>
              <span>Seguridad</span>
            </div>
            <div class="eu-section-body">
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-key"></i> Contraseña *</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-key"></i>
                    <input id="swal-password" class="with-eye" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password">
                    <button type="button" id="toggle-password-new" class="eu-eye-btn" aria-label="Mostrar u ocultar contraseña">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
                <div class="eu-field">
                  <label><i class="fas fa-check-circle"></i> Confirmar *</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-check-circle"></i>
                    <input id="swal-password-confirm" class="with-eye" type="password" placeholder="Repetir contraseña" autocomplete="new-password">
                    <button type="button" id="toggle-password-confirm-new" class="eu-eye-btn" aria-label="Mostrar u ocultar confirmación de contraseña">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div id="password-suggestions" class="password-suggestions">
                <div class="password-suggestions__header">
                  <small>Sugerencias seguras</small>
                  <button type="button" id="password-suggestions-refresh" class="password-suggestions__refresh">
                    <i class="fas fa-sync-alt"></i> Regenerar
                  </button>
                </div>
                <div id="password-suggestions-chips" class="password-suggestions__chips"></div>
              </div>
              <div id="password-match-hint" class="pw-status pw-error" style="display: none;">
                <i class="fas fa-exclamation-triangle"></i> Las contraseñas no coinciden
              </div>
              <div id="password-ok-hint" class="pw-status pw-ok" style="display: none;">
                <i class="fas fa-check-circle"></i> Las contraseñas coinciden correctamente
              </div>
            </div>
          </div>

            </div>
          </div>

          <div class="eu-section">
            <div class="eu-section-header">
              <i class="fas fa-id-card"></i>
              <span>Fotografía y Firma Digital</span>
            </div>
            <div class="eu-section-body">
              <div class="eu-media-grid">
                <div id="foto-section" class="eu-media-section">
                  <div class="eu-media-header">
                    <i class="fas fa-camera"></i>
                    <span>Fotografía</span>
                    <span class="eu-badge">JPG · PNG</span>
                  </div>
                  <div class="eu-media-body">
                    <div id="foto-dropzone" class="eu-dropzone">
                      <input id="swal-foto" type="file" accept="image/jpeg,image/png,image/webp" style="display: none;">
                      <div id="foto-placeholder">
                        <i class="fas fa-cloud-upload-alt dz-icon"></i>
                        <p>Clic o arrastra la foto</p>
                        <small>Opcional</small>
                      </div>
                      <div id="foto-preview" class="eu-dz-preview">
                        <img id="foto-preview-img" src="" alt="Foto">
                        <p id="foto-filename" class="eu-preview-name"></p>
                        <button type="button" id="foto-remove" class="eu-remove-btn"><i class="fas fa-trash-alt"></i> Quitar</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div id="firma-section" class="eu-media-section">
                  <div class="eu-media-header">
                    <i class="fas fa-signature"></i>
                    <span id="firma-section-title">Firma Digital <em id="firma-new-required" style="display:none;color:#e11d48;">*</em></span>
                    <span class="eu-badge">JPG · WebP</span>
                  </div>
                  <div class="eu-media-body">
                    <div id="firma-dropzone" class="eu-dropzone">
                      <input id="swal-firma" type="file" accept="image/jpeg,image/png,image/webp" style="display: none;">
                      <div id="firma-placeholder">
                        <i class="fas fa-cloud-upload-alt dz-icon"></i>
                        <p>Clic o arrastra la imagen</p>
                        <small id="firma-new-hint">Opcional</small>
                      </div>
                      <div id="firma-preview" class="eu-dz-preview">
                        <img id="firma-preview-img" src="" alt="Firma">
                        <p id="firma-filename" class="eu-preview-name"></p>
                        <button type="button" id="firma-remove" class="eu-remove-btn"><i class="fas fa-trash-alt"></i> Quitar</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div><!-- end eu-right -->

      </div><!-- end eu-layout -->
    `;

    const { value: formValues } = await Swal.fire({
      title: '<i class="fas fa-user-plus" style="color: #38512F;"></i> Nuevo Usuario',
      html: htmlForm,
      width: '720px',
      padding: '1.5rem',
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-save"></i> Crear Usuario',
      cancelButtonText: '<i class="fas fa-times"></i> Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      didOpen: () => {
        const rolCheckboxes = document.querySelectorAll('#roles-checkboxes .rol-check') as NodeListOf<HTMLInputElement>;
        const curpContainer = document.getElementById('curp-container');
        const curpInput = document.getElementById('swal-curp') as HTMLInputElement;
        const cedulaContainer = document.getElementById('cedula-container');
        const cedulaInput = document.getElementById('swal-cedula') as HTMLInputElement;

        // Cargo select: mostrar campo "Otro"
        const cargoSelect = document.getElementById('swal-cargo') as HTMLSelectElement;
        const cargoOtroContainer = document.getElementById('swal-cargo-otro') as HTMLElement;
        const cargoOtroInput = document.getElementById('swal-cargo-otro-input') as HTMLInputElement;
        const emailPrincipalInput = document.getElementById('swal-email') as HTMLInputElement;
        const credExtraToggle = document.getElementById('swal-credenciales-extra-toggle') as HTMLInputElement;
        const credExtraContainer = document.getElementById('credential-container') as HTMLElement;
        const credExtraInput = document.getElementById('swal-credenciales-extra-input') as HTMLInputElement;
        const credExtraAddBtn = document.getElementById('swal-credenciales-extra-add') as HTMLButtonElement;
        const credExtraList = document.getElementById('swal-credenciales-extra-list') as HTMLElement;
        const credExtraJson = document.getElementById('swal-credenciales-extra-json') as HTMLInputElement;
        const correosExtraCredenciales: string[] = [];

        const normalizarCorreo = (correo = '') => String(correo || '').trim().toLowerCase();
        const esEmailValido = (correo = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarCorreo(correo));
        const mostrarValidacionTemporal = (mensaje: string) => {
          Swal.showValidationMessage(mensaje);
          setTimeout(() => Swal.resetValidationMessage(), 2600);
        };

        const actualizarCorreosExtraJson = () => {
          if (credExtraJson) {
            credExtraJson.value = JSON.stringify(correosExtraCredenciales);
          }
        };

        const renderCorreosExtra = () => {
          if (!credExtraList) return;
          credExtraList.innerHTML = correosExtraCredenciales
            .map((correo) => `
              <span class="cred-extra-chip">
                ${correo}
                <button type="button" data-correo="${correo}" aria-label="Quitar correo">
                  <i class="fas fa-times"></i>
                </button>
              </span>
            `)
            .join('');
          actualizarCorreosExtraJson();
        };

        const agregarCorreoExtra = () => {
          const correo = normalizarCorreo(credExtraInput?.value || '');
          const correoPrincipal = normalizarCorreo(emailPrincipalInput?.value || '');

          if (!correo) return;

          if (!esEmailValido(correo)) {
            mostrarValidacionTemporal('Ingrese un correo adicional válido');
            return;
          }

          if (correoPrincipal && correo === correoPrincipal) {
            mostrarValidacionTemporal('El correo adicional no puede ser igual al correo principal');
            return;
          }

          if (correosExtraCredenciales.includes(correo)) {
            mostrarValidacionTemporal('Ese correo adicional ya fue agregado');
            return;
          }

          correosExtraCredenciales.push(correo);
          if (credExtraInput) credExtraInput.value = '';
          renderCorreosExtra();
        };

        if (credExtraToggle && credExtraContainer) {
          credExtraToggle.addEventListener('change', () => {
            credExtraContainer.style.display = credExtraToggle.checked ? 'block' : 'none';
            if (!credExtraToggle.checked) {
              correosExtraCredenciales.length = 0;
              if (credExtraInput) credExtraInput.value = '';
              renderCorreosExtra();
            }
          });
        }

        credExtraAddBtn?.addEventListener('click', (event) => {
          event.preventDefault();
          agregarCorreoExtra();
        });

        credExtraInput?.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            agregarCorreoExtra();
          }
        });

        credExtraList?.addEventListener('click', (event) => {
          const target = event.target as HTMLElement;
          const button = target.closest('button[data-correo]') as HTMLButtonElement | null;
          if (!button) return;
          const correo = normalizarCorreo(button.getAttribute('data-correo') || '');
          const idx = correosExtraCredenciales.indexOf(correo);
          if (idx >= 0) {
            correosExtraCredenciales.splice(idx, 1);
            renderCorreosExtra();
          }
        });

        renderCorreosExtra();

        cargoSelect.addEventListener('change', () => {
          if (cargoSelect.value === 'Otro') {
            cargoOtroContainer.style.display = 'block';
            cargoOtroInput?.focus();
          } else {
            cargoOtroContainer.style.display = 'none';
            if (cargoOtroInput) cargoOtroInput.value = '';
          }
        });

        // Helper: configurar dropzone
        const setupDropzone = (
          dropzoneId: string, inputId: string,
          placeholderId: string, previewId: string,
          previewImgId: string, filenameId: string, removeBtnId: string
        ) => {
          const dropzone = document.getElementById(dropzoneId);
          const input = document.getElementById(inputId) as HTMLInputElement;
          const placeholder = document.getElementById(placeholderId);
          const preview = document.getElementById(previewId);
          const previewImg = document.getElementById(previewImgId) as HTMLImageElement;
          const filename = document.getElementById(filenameId);
          const removeBtn = document.getElementById(removeBtnId);
          if (!dropzone || !input) return;

          const showPreview = (file: File) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              if (previewImg) previewImg.src = e.target?.result as string;
              if (placeholder) placeholder.style.display = 'none';
              if (preview) (preview as HTMLElement).style.display = 'flex';
              if (filename) filename.textContent = file.name;
              dropzone.style.borderColor = '#38512F';
              dropzone.style.background = 'rgba(56,81,47,0.05)';
            };
            reader.readAsDataURL(file);
          };

          dropzone.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).id !== removeBtnId && !(e.target as HTMLElement).closest(`#${removeBtnId}`)) {
              input.click();
            }
          });
          input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) showPreview(file);
          });
          dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#38512F';
            dropzone.style.background = 'rgba(56,81,47,0.08)';
          });
          dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#C2D1B2';
            dropzone.style.background = '#f8f9fa';
          });
          dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = (e as DragEvent).dataTransfer?.files[0];
            if (file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
              const dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;
              showPreview(file);
            }
          });
          if (removeBtn) {
            removeBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              input.value = '';
              if (placeholder) placeholder.style.display = 'flex';
              if (preview) (preview as HTMLElement).style.display = 'none';
              dropzone.style.borderColor = '#C2D1B2';
              dropzone.style.background = '#f8f9fa';
            });
          }
        };

        setupDropzone('foto-dropzone', 'swal-foto', 'foto-placeholder', 'foto-preview', 'foto-preview-img', 'foto-filename', 'foto-remove');
        setupDropzone('firma-dropzone', 'swal-firma', 'firma-placeholder', 'firma-preview', 'firma-preview-img', 'firma-filename', 'firma-remove');

        // Helper para obtener roles seleccionados
        const getSelectedRoles = (): string[] => {
          return Array.from(rolCheckboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-nombre') || '');
        };

        // Toggle columna izquierda según roles seleccionados (multi-rol)
        const toggleByRoles = () => {
          const roles = getSelectedRoles();
          const tieneInstructor = roles.includes('instructor');
          const tieneDoctor = roles.includes('doctor');
          const firmaObligatoria = this.requiereFirmaObligatoria(roles);
          const reqMark = document.getElementById('firma-new-required');
          const firmaHint = document.getElementById('firma-new-hint');
          if (reqMark) reqMark.style.display = firmaObligatoria ? 'inline' : 'none';
          if (firmaHint) firmaHint.textContent = firmaObligatoria
            ? 'Obligatoria para Instructor y Doctor'
            : 'Opcional';

          // CURP para instructor, Cédula para doctor (mostrar ambos si ambos roles seleccionados)
          if (curpContainer) {
            curpContainer.style.display = tieneInstructor ? 'block' : 'none';
            if (!tieneInstructor && curpInput) curpInput.value = '';
          }
          if (cedulaContainer) {
            cedulaContainer.style.display = tieneDoctor ? 'block' : 'none';
            if (!tieneDoctor && cedulaInput) cedulaInput.value = '';
          }
          // Filtrar solo dígitos en cédula
          if (cedulaInput) {
            cedulaInput.oninput = (e) => {
              const inp = e.target as HTMLInputElement;
              inp.value = inp.value.replace(/[^0-9]/g, '');
            };
          }
        };

        this.bindOrganigramaCombobox();
        this.bindAreaDepartamentoCombobox();
        this.bindRolTags('roles-checkboxes', null, () => toggleByRoles());
        toggleByRoles();

        // Validación en tiempo real de contraseñas
        const passwordInput = document.getElementById('swal-password') as HTMLInputElement;
        const confirmInput = document.getElementById('swal-password-confirm') as HTMLInputElement;
        const hintError = document.getElementById('password-match-hint');
        const hintOk = document.getElementById('password-ok-hint');
        const togglePasswordNew = document.getElementById('toggle-password-new');
        const togglePasswordConfirmNew = document.getElementById('toggle-password-confirm-new');
        const passwordSuggestionsChips = document.getElementById('password-suggestions-chips');
        const passwordSuggestionsRefresh = document.getElementById('password-suggestions-refresh');

        const bindPasswordToggle = (btn: HTMLElement | null, input: HTMLInputElement | null) => {
          if (!btn || !input) return;
          btn.addEventListener('click', () => {
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            const icon = btn.querySelector('i');
            if (icon) {
              icon.classList.toggle('fa-eye', !isHidden);
              icon.classList.toggle('fa-eye-slash', isHidden);
            }
          });
        };

        bindPasswordToggle(togglePasswordNew as HTMLElement, passwordInput);
        bindPasswordToggle(togglePasswordConfirmNew as HTMLElement, confirmInput);

        const validatePasswords = () => {
          const pass = passwordInput.value;
          const confirm = confirmInput.value;
          if (confirm.length === 0) {
            hintError!.style.display = 'none';
            hintOk!.style.display = 'none';
            confirmInput.style.borderColor = '';
          } else if (pass === confirm && pass.length >= 8) {
            hintError!.style.display = 'none';
            hintOk!.style.display = 'block';
            confirmInput.style.borderColor = '#38512F';
          } else {
            hintError!.style.display = 'block';
            hintOk!.style.display = 'none';
            confirmInput.style.borderColor = '#f5365c';
          }
        };

        const renderPasswordSuggestions = () => {
          if (!passwordSuggestionsChips) return;
          const suggestions = this.generarSugerenciasPassword();
          passwordSuggestionsChips.innerHTML = suggestions.map((sugerencia) => `
            <button
              type="button"
              class="password-suggestions__chip"
              data-password="${sugerencia}">
              ${sugerencia}
            </button>
          `).join('');

          const suggestionButtons = passwordSuggestionsChips.querySelectorAll('.password-suggestions__chip') as NodeListOf<HTMLButtonElement>;
          suggestionButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
              const password = btn.dataset.password || '';
              passwordInput.value = password;
              confirmInput.value = password;
              validatePasswords();
            });
          });
        };

        passwordSuggestionsRefresh?.addEventListener('click', (event) => {
          event.preventDefault();
          renderPasswordSuggestions();
        });

        renderPasswordSuggestions();

        passwordInput.addEventListener('input', validatePasswords);
        confirmInput.addEventListener('input', validatePasswords);
      },
      preConfirm: () => {
        const username = (document.getElementById('swal-username') as HTMLInputElement).value;
        const cargoSelect = document.getElementById('swal-cargo') as HTMLSelectElement;
        const cargoOtroInput = document.getElementById('swal-cargo-otro-input') as HTMLInputElement;
        let cargo = cargoSelect.value;
        if (cargo === 'Otro') cargo = cargoOtroInput?.value.trim() || '';
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement).value;
        const apellido = (document.getElementById('swal-apellido') as HTMLInputElement).value;
        const email = (document.getElementById('swal-email') as HTMLInputElement).value;
        const telefono = (document.getElementById('swal-telefono') as HTMLInputElement).value;
        const credExtraToggle = (document.getElementById('swal-credenciales-extra-toggle') as HTMLInputElement);
        const credExtraInput = (document.getElementById('swal-credenciales-extra-input') as HTMLInputElement);
        const credExtraJson = (document.getElementById('swal-credenciales-extra-json') as HTMLInputElement);

        const normalizarCorreo = (correo = '') => String(correo || '').trim().toLowerCase();
        const esEmailValido = (correo = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarCorreo(correo));

        let correosExtrasCredenciales: string[] = [];
        try {
          const parsed = JSON.parse(credExtraJson?.value || '[]');
          if (Array.isArray(parsed)) {
            correosExtrasCredenciales = parsed
              .map((correo: any) => normalizarCorreo(String(correo || '')))
              .filter((correo: string, index: number, arr: string[]) => correo && arr.indexOf(correo) === index);
          }
        } catch (_) {
          correosExtrasCredenciales = [];
        }

        const correoPendiente = normalizarCorreo(credExtraInput?.value || '');
        const correoPrincipal = normalizarCorreo(email);
        if (correoPendiente) {
          if (!esEmailValido(correoPendiente)) {
            Swal.showValidationMessage('El correo adicional no tiene un formato válido');
            return false;
          }
          if (correoPrincipal && correoPendiente === correoPrincipal) {
            Swal.showValidationMessage('El correo adicional no puede ser igual al correo principal');
            return false;
          }
          if (!correosExtrasCredenciales.includes(correoPendiente)) {
            correosExtrasCredenciales.push(correoPendiente);
          }
        }

        if (credExtraToggle?.checked && correosExtrasCredenciales.length === 0) {
          Swal.showValidationMessage('Agregue al menos un correo adicional para enviar credenciales');
          return false;
        }

        // Multi-rol: obtener roles seleccionados de checkboxes
        const rolesChecked = document.querySelectorAll('#roles-checkboxes .rol-check:checked') as NodeListOf<HTMLInputElement>;
        const selectedRolIds = Array.from(rolesChecked).map(cb => parseInt(cb.value));
        const selectedRolNombres = Array.from(rolesChecked).map(cb => cb.getAttribute('data-nombre') || '');
        // Rol principal: el primero seleccionado
        const rol_id = selectedRolIds.length > 0 ? String(selectedRolIds[0]) : '';
        // Roles adicionales (todos menos el primero)
        const rolesAdicionales = selectedRolNombres.slice(1);

        const password = (document.getElementById('swal-password') as HTMLInputElement).value;
        const passwordConfirm = (document.getElementById('swal-password-confirm') as HTMLInputElement).value;

        // Para instructor: auto-seleccionar TODAS las áreas temáticas
        let areas_ids: number[] = [];
        let instructorData: any = null;

        if (selectedRolNombres.includes('instructor')) {
          areas_ids = [...todasLasAreasIds]; // Se asignan TODAS las áreas automáticamente
          const curp = (document.getElementById('swal-curp') as HTMLInputElement).value;
          instructorData = { curp: curp?.trim() || null };
        }
        if (selectedRolNombres.includes('doctor')) {
          const cedulaMedica = (document.getElementById('swal-cedula') as HTMLInputElement).value;
          instructorData = instructorData || {};
          instructorData.cedula_medica = cedulaMedica?.trim() || null;
        }

        // Validaciones básicas
        if (!username || username.trim() === '') {
          Swal.showValidationMessage('El username es obligatorio');
          return false;
        }
        if (!nombre || nombre.trim() === '') {
          Swal.showValidationMessage('El nombre es obligatorio');
          return false;
        }
        if (selectedRolIds.length === 0) {
          Swal.showValidationMessage('Debe seleccionar al menos un rol');
          return false;
        }

        const todosLosRoles = selectedRolNombres;
        const esInstructorSel = todosLosRoles.includes('instructor');
        const esDoctorSel = todosLosRoles.includes('doctor');

        const firmaFileInput = document.getElementById('swal-firma') as HTMLInputElement;
        const fotoFileInput = document.getElementById('swal-foto') as HTMLInputElement;
        const firmaFile = firmaFileInput?.files?.[0] || null;
        const fotoFile = fotoFileInput?.files?.[0] || null;
        const organigrama = String((document.getElementById('swal-organigrama') as HTMLInputElement)?.value || '').trim();
        const area_departamento = String((document.getElementById('swal-area-departamento') as HTMLInputElement)?.value || '').trim();

        if (this.requiereFirmaObligatoria(todosLosRoles) && !firmaFile) {
          Swal.showValidationMessage('La firma digital es obligatoria para Instructor y Doctor');
          return false;
        }

        // Cédula obligatoria para doctor
        if (esDoctorSel) {
          if (!instructorData?.cedula_medica || instructorData.cedula_medica === '') {
            Swal.showValidationMessage('La cédula médica es obligatoria para el rol de doctor');
            return false;
          }
          const cedulaPattern = /^[0-9]{7,8}$/;
          if (!cedulaPattern.test(instructorData.cedula_medica)) {
            Swal.showValidationMessage('La cédula médica debe tener 7 u 8 dígitos numéricos');
            return false;
          }
        }

        // CURP opcional para instructor, pero si se llena debe tener 18 caracteres
        if (esInstructorSel && instructorData?.curp && instructorData.curp.length !== 18) {
          Swal.showValidationMessage('El CURP debe tener exactamente 18 caracteres');
          return false;
        }

        if (!password || password.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener mínimo 8 caracteres');
          return false;
        }
        if (password !== passwordConfirm) {
          Swal.showValidationMessage('Las contraseñas no coinciden');
          return false;
        }

        const nombreCompleto = cargo && cargo !== '' ? `${cargo} ${nombre.trim()}` : nombre.trim();

        return {
          username: username.trim(),
          nombre: nombreCompleto,
          apellido: apellido.trim(),
          email: email.trim(),
          telefono: telefono.trim(),
          rol_id: parseInt(rol_id),
          roles_adicionales: rolesAdicionales.join(','),
          organigrama,
          area_departamento,
          credenciales_correos_extra: correosExtrasCredenciales,
          clave: password,
          areas: areas_ids,
          instructor: instructorData,
          firmaFile,
          fotoFile
        };
      }
    });

    if (formValues) {
      this.guardarUsuario(formValues);
    }
  }



  guardarUsuario(datos: any) {
    // Si hay firma (instructor, doctor o administrador), enviar como FormData
    let payload: any;
    if (datos.firmaFile || datos.fotoFile) {
      const formData = new FormData();
      formData.append('username', datos.username);
      formData.append('nombre', datos.nombre);
      formData.append('apellido', datos.apellido);
      formData.append('email', datos.email);
      formData.append('telefono', datos.telefono);
      formData.append('rol_id', datos.rol_id.toString());
      formData.append('clave', datos.clave);
      if (datos.organigrama !== undefined) {
        formData.append('organigrama', datos.organigrama || '');
      }
      if (datos.area_departamento !== undefined) {
        formData.append('area_departamento', datos.area_departamento || '');
      }
      if (datos.roles_adicionales) {
        formData.append('roles_adicionales', datos.roles_adicionales);
      }
      if (Array.isArray(datos.credenciales_correos_extra) && datos.credenciales_correos_extra.length > 0) {
        formData.append('credenciales_correos_extra', JSON.stringify(datos.credenciales_correos_extra));
      }
      if (datos.areas && datos.areas.length > 0) {
        formData.append('areas', JSON.stringify(datos.areas));
      }
      if (datos.instructor) {
        formData.append('instructor', JSON.stringify(datos.instructor));
      }
      if (datos.firmaFile) formData.append('firma', datos.firmaFile);
      if (datos.fotoFile) formData.append('foto', datos.fotoFile);
      payload = formData;
    } else {
      payload = datos;
    }

    Swal.fire({
      title: 'Creando usuario...',
      text: 'Por favor espera un momento',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendService.crearUsuario(payload).subscribe({
      next: (response: any) => {
        if (response.success) {
          Swal.fire({
            title: '¡Creado!',
            text: 'Usuario creado exitosamente',
            icon: 'success',
            confirmButtonColor: '#38512F'
          });
          this.cargarUsuarios();
        } else {
          Swal.fire({
            title: 'Error',
            text: response.message || 'No se pudo crear el usuario',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      },
      error: (error) => {
        console.error('Error:', error);
        Swal.fire({
          title: 'Error',
          text: error.error?.message || 'Error de conexión',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  /**
   * Abre/cierra el dropdown de áreas para un usuario específico
   * Usa position: fixed para evitar clipping por overflow: hidden del card
   */
  toggleAreasDropdown(usuarioId: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.areasDropdownAbierto === usuarioId) {
      this.areasDropdownAbierto = null;
      this.areasDropdownBtnRef = null;
      return;
    }

    this.areasDropdownBtnRef = event.currentTarget as HTMLElement;
    this.areasDropdownAbierto = usuarioId;
    this.recalcularPosicionDropdown();
  }

  private recalcularPosicionDropdown(): void {
    if (!this.areasDropdownBtnRef) return;
    const rect = this.areasDropdownBtnRef.getBoundingClientRect();
    const dropdownHeight = 220;
    const espacioAbajo = window.innerHeight - rect.bottom;
    const espacioArriba = rect.top;

    this.areasDropdownArriba = espacioAbajo < dropdownHeight && espacioArriba > dropdownHeight;

    if (this.areasDropdownArriba) {
      this.areasDropdownPosition = {
        top: rect.top - dropdownHeight - 8,
        left: rect.left
      };
    } else {
      let topPos = rect.bottom + 8;
      if (topPos + dropdownHeight > window.innerHeight - 10) {
        topPos = window.innerHeight - dropdownHeight - 10;
      }
      this.areasDropdownPosition = {
        top: topPos,
        left: rect.left
      };
    }
  }

  /**
   * Convierte el string de áreas separadas por coma en un array
   */
  getAreasArray(areasString: string): string[] {
    if (!areasString) return [];
    return areasString.split(',').map(area => area.trim()).filter(area => area.length > 0);
  }

  getRolDisplayName(rolNombre: string, descripcion?: string): string {
    const nombre = (rolNombre || '').toLowerCase().trim();
    const desc = (descripcion || '').toLowerCase().trim();
    if (nombre === 'sgc' || desc.includes('sistema de gestión de calidad') || desc.includes('sistema de gestion de calidad')) {
      return 'SGC';
    }
    if (nombre === 'control_documental') {
      return 'Control Documental';
    }
    if (nombre === 'innovacion') {
      return 'Diseño e Innovación';
    }
    if (nombre === 'rrhh') {
      return 'RRHH';
    }
    if (nombre === 'mantenimiento') {
      return 'Mantenimiento';
    }
    if (descripcion) return descripcion;
    return rolNombre || '';
  }

  getRolClass(rol: string): string {
    switch (rol?.toLowerCase()) {
      case 'root': return 'badge-danger';
      case 'administrador': return 'badge-warning';
      case 'instructor': return 'badge-info';
      case 'doctor': return 'badge-doctor'; // Badge azul claro personalizado
      case 'empresa': return 'badge-success';
      case 'usuario empresa': return 'badge-success';
      case 'consulta': return 'badge-secondary';
      case 'solo consulta': return 'badge-secondary';
      case 'proteccion_civil': return 'badge-pc';
      case 'sgc': return 'badge-sgc';
      case 'ambiental': return 'badge-ambiental';
      case 'control_documental': return 'badge-info';
      case 'innovacion': return 'badge-innovacion';
      case 'rrhh': return 'badge-rrhh';
      case 'mantenimiento': return 'badge-mantenimiento';
      default: return 'badge-secondary';
    }
  }

  private getRolTagIcon(rol: string): string {
    switch (rol?.toLowerCase()) {
      case 'root': return 'fa-user-shield';
      case 'administrador': return 'fa-user-cog';
      case 'instructor': return 'fa-chalkboard-teacher';
      case 'doctor': return 'fa-user-md';
      case 'empresa':
      case 'usuario empresa': return 'fa-building';
      case 'consulta':
      case 'solo consulta': return 'fa-eye';
      case 'proteccion_civil': return 'fa-shield-alt';
      case 'sgc': return 'fa-award';
      case 'ambiental': return 'fa-leaf';
      case 'control_documental': return 'fa-folder-open';
      case 'innovacion': return 'fa-drafting-compass';
      case 'rrhh': return 'fa-user-tie';
      case 'mantenimiento': return 'fa-tools';
      default: return 'fa-user-tag';
    }
  }

  private getRolTagClass(rol: string): string {
    switch (rol?.toLowerCase()) {
      case 'root': return 'rol-tag--root';
      case 'administrador': return 'rol-tag--admin';
      case 'instructor': return 'rol-tag--instructor';
      case 'doctor': return 'rol-tag--doctor';
      case 'empresa':
      case 'usuario empresa': return 'rol-tag--empresa';
      case 'consulta':
      case 'solo consulta': return 'rol-tag--consulta';
      case 'proteccion_civil': return 'rol-tag--pc';
      case 'sgc': return 'rol-tag--sgc';
      case 'ambiental': return 'rol-tag--ambiental';
      case 'control_documental': return 'rol-tag--instructor';
      case 'innovacion': return 'rol-tag--innovacion';
      case 'rrhh': return 'rol-tag--rrhh';
      case 'mantenimiento': return 'rol-tag--mantenimiento';
      default: return 'rol-tag--default';
    }
  }

  private getEuModalAnimations(): string {
    return `
        @keyframes euSectionIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes rolTagIn {
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes rolTagPop {
          0% { transform: scale(1); }
          45% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        @keyframes rolDotIn {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes euComboDropIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes euComboOptionIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
    `;
  }

  private getRolPickerStyles(): string {
    return `
        .roles-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          padding: 0.4rem;
          background: rgba(194, 209, 178, 0.14);
          border: 1px solid rgba(194, 209, 178, 0.45);
          border-radius: 8px;
          font-family: 'Open Sans', sans-serif;
        }
        .eu-section-badge {
          margin-left: auto;
          font-size: 0.62rem;
          font-weight: 600;
          color: #768D6B;
          background: rgba(118, 141, 107, 0.14);
          border-radius: 999px;
          padding: 0.1rem 0.45rem;
          letter-spacing: 0;
          text-transform: none;
          transition: all 0.25s ease;
        }
        .rol-tag {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 0.32rem;
          padding: 0.26rem 0.52rem 0.26rem 0.38rem;
          border-radius: 999px;
          border: 1px solid #d5dfd0;
          background: #fff;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
          user-select: none;
          font-family: 'Open Sans', sans-serif;
          line-height: 1.2;
          animation: rolTagIn 0.3s ease backwards;
        }
        .rol-tag:hover {
          border-color: #C2D1B2;
          background: rgba(248, 250, 247, 1);
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(56, 81, 47, 0.08);
        }
        .rol-tag--pop { animation: rolTagPop 0.28s ease; }
        .rol-tag input { display: none; }
        .rol-tag .rol-icon-wrap {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.58rem;
          color: #768D6B;
          background: rgba(118, 141, 107, 0.14);
          flex-shrink: 0;
          transition: background 0.22s ease, color 0.22s ease, transform 0.22s ease;
        }
        .rol-tag .rol-name {
          font-size: 0.71rem;
          font-weight: 600;
          color: #525f7f;
          letter-spacing: 0;
          white-space: nowrap;
          transition: color 0.2s ease;
        }
        .rol-tag.selected {
          border-color: #768D6B;
          background: rgba(56, 81, 47, 0.07);
          box-shadow: 0 0 0 1px rgba(56, 81, 47, 0.06);
        }
        .rol-tag.selected::after {
          content: '';
          position: absolute;
          top: 4px;
          right: 4px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #38512F;
          animation: rolDotIn 0.22s ease;
        }
        .rol-tag.selected .rol-icon-wrap {
          background: #38512F;
          color: #fff;
          transform: scale(1.05);
        }
        .rol-tag.selected .rol-name {
          color: #38512F;
          font-weight: 700;
        }
        .rol-tag--admin .rol-icon-wrap { color: #8a7d5e; background: rgba(138, 125, 94, 0.12); }
        .rol-tag--instructor .rol-icon-wrap { color: #5f8a7e; background: rgba(95, 138, 126, 0.12); }
        .rol-tag--doctor .rol-icon-wrap { color: #6e7f96; background: rgba(110, 127, 150, 0.12); }
        .rol-tag--pc .rol-icon-wrap { color: #9a7568; background: rgba(154, 117, 104, 0.12); }
        .rol-tag--sgc .rol-icon-wrap { color: #4f7a74; background: rgba(79, 122, 116, 0.12); }
        .rol-tag--ambiental .rol-icon-wrap { color: #4d7a57; background: rgba(77, 122, 87, 0.12); }
        .rol-tag--innovacion .rol-icon-wrap { color: #6b5b95; background: rgba(107, 91, 149, 0.12); }
        .rol-tag--rrhh .rol-icon-wrap { color: #9d174d; background: rgba(219, 39, 119, 0.12); }
        .rol-tag--mantenimiento .rol-icon-wrap { color: #b45309; background: rgba(245, 158, 11, 0.15); }
        .rol-tag--consulta .rol-icon-wrap { color: #8898aa; background: rgba(136, 152, 170, 0.1); }
        .rol-tag--empresa .rol-icon-wrap { color: #5f8a6e; background: rgba(95, 138, 110, 0.12); }
        .rol-tag--root .rol-icon-wrap { color: #9a6b72; background: rgba(154, 107, 114, 0.12); }
        .rol-tag.selected .rol-icon-wrap { color: #fff; background: #38512F; }
    `;
  }

  private readonly organigramaBiznagaGrupos = ORGANIGRAMA_BIZNAGA_GRUPOS;
  private readonly areasDepartamentoUsuario = ['Seguridad', 'Innovación', 'Administración'] as const;

  private requiereFirmaObligatoria(roles: string[]): boolean {
    const set = new Set((roles || []).map(r => String(r || '').toLowerCase().trim()));
    return set.has('instructor') || set.has('doctor');
  }

  private buildAreaDepartamentoComboboxHtml(selected = ''): string {
    const valor = String(selected || '').trim();
    const opciones = this.areasDepartamentoUsuario.map(area => {
      const activo = area === valor ? ' is-selected' : '';
      return `<button type="button" class="eu-combo-option${activo}" data-value="${area.replace(/"/g, '&quot;')}" role="option">
          <span class="eu-combo-option-icon"><i class="fas fa-building"></i></span>
          <span class="eu-combo-option-body">
            <span class="eu-combo-option-title">${area}</span>
          </span>
          <i class="fas fa-check eu-combo-check"${activo ? '' : ' style="display:none;"'}></i>
        </button>`;
    }).join('');

    return `
      <div class="eu-combo" id="area-departamento-combo">
        <div class="eu-combo-control" id="area-departamento-combo-control">
          <span class="eu-combo-icon"><i class="fas fa-search"></i></span>
          <input id="swal-area-departamento-search" type="text" placeholder="Buscar área o departamento..."
                 value="${valor.replace(/"/g, '&quot;')}" autocomplete="off" spellcheck="false">
          <button type="button" class="eu-combo-clear" id="area-departamento-combo-clear" ${valor ? '' : 'style="display:none;"'} aria-label="Limpiar área">
            <i class="fas fa-times"></i>
          </button>
          <span class="eu-combo-chevron"><i class="fas fa-chevron-down"></i></span>
        </div>
        <input type="hidden" id="swal-area-departamento" value="${valor.replace(/"/g, '&quot;')}">
        <div class="eu-combo-dropdown" id="area-departamento-dropdown" role="listbox">
          <button type="button" class="eu-combo-option" data-value="" role="option">
            <span class="eu-combo-option-icon"><i class="fas fa-ban"></i></span>
            <span class="eu-combo-option-body">
              <span class="eu-combo-option-title">Sin área asignada</span>
              <span class="eu-combo-option-meta">No pertenece a un área/departamento</span>
            </span>
          </button>
          ${opciones}
          <div class="eu-combo-empty" id="area-departamento-empty" style="display:none;">
            <i class="fas fa-search"></i>
            <span>No hay áreas que coincidan</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindAreaDepartamentoCombobox(): void {
    const combo = document.getElementById('area-departamento-combo');
    const control = document.getElementById('area-departamento-combo-control');
    const input = document.getElementById('swal-area-departamento-search') as HTMLInputElement | null;
    const hidden = document.getElementById('swal-area-departamento') as HTMLInputElement | null;
    const dropdown = document.getElementById('area-departamento-dropdown');
    const clearBtn = document.getElementById('area-departamento-combo-clear');
    const emptyState = document.getElementById('area-departamento-empty');
    if (!combo || !control || !input || !hidden || !dropdown) return;

    const syncChecks = (valor: string) => {
      dropdown.querySelectorAll('.eu-combo-option').forEach((btn) => {
        const option = btn as HTMLElement;
        const match = (option.getAttribute('data-value') || '') === valor;
        option.classList.toggle('is-selected', match);
        const check = option.querySelector('.eu-combo-check') as HTMLElement | null;
        if (check) check.style.display = match ? '' : 'none';
      });
    };

    const setValor = (valor: string) => {
      hidden.value = valor;
      input.value = valor;
      if (clearBtn) clearBtn.style.display = valor ? '' : 'none';
      syncChecks(valor);
      combo.classList.remove('is-open');
    };

    const filtrar = () => {
      const q = input.value.trim().toLowerCase();
      let visibles = 0;
      dropdown.querySelectorAll('.eu-combo-option').forEach((btn) => {
        const option = btn as HTMLElement;
        const texto = (option.getAttribute('data-value') || '').toLowerCase();
        const esVacio = !texto;
        const match = esVacio
          ? (!q || 'sin área asignada'.includes(q) || 'sin area asignada'.includes(q))
          : (!q || texto.includes(q));
        option.style.display = match ? '' : 'none';
        if (match) visibles++;
      });
      if (emptyState) emptyState.style.display = visibles === 0 ? 'flex' : 'none';
    };

    const abrir = () => {
      const yaAbierto = combo.classList.contains('is-open');
      combo.classList.add('is-open');
      if (!yaAbierto) {
        dropdown.querySelectorAll('.eu-combo-option').forEach((opt, i) => {
          const el = opt as HTMLElement;
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
          el.style.animationDelay = `${Math.min(i, 16) * 0.03}s`;
        });
      }
      filtrar();
    };

    control.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('#area-departamento-combo-clear')) return;
      abrir();
      input.focus();
    });
    input.addEventListener('focus', abrir);
    input.addEventListener('input', () => {
      hidden.value = '';
      if (clearBtn) clearBtn.style.display = input.value ? '' : 'none';
      abrir();
    });
    clearBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setValor('');
      input.focus();
      abrir();
    });
    dropdown.addEventListener('click', (ev) => {
      const option = (ev.target as HTMLElement).closest('.eu-combo-option') as HTMLElement | null;
      if (!option) return;
      setValor(option.getAttribute('data-value') || '');
    });
    document.addEventListener('click', (ev) => {
      if (!combo.contains(ev.target as Node)) {
        combo.classList.remove('is-open');
        if (!hidden.value) input.value = '';
        else input.value = hidden.value;
      }
    });
    syncChecks(hidden.value);
  }

  private buildOrganigramaComboboxHtml(selected = ''): string {
    const valor = String(selected || '').trim();
    const gruposHtml = this.organigramaBiznagaGrupos.map(grupo => {
      const opciones = grupo.puestos.map(puesto => {
        const activo = puesto === valor ? ' is-selected' : '';
        return `<button type="button" class="eu-combo-option${activo}" data-value="${puesto.replace(/"/g, '&quot;')}" role="option">
          <span class="eu-combo-option-icon"><i class="fas fa-id-badge"></i></span>
          <span class="eu-combo-option-body">
            <span class="eu-combo-option-title">${puesto}</span>
          </span>
          <i class="fas fa-check eu-combo-check"${activo ? '' : ' style="display:none;"'}></i>
        </button>`;
      }).join('');
      return `<div class="eu-combo-group">
        <p class="eu-combo-group-label">${grupo.grupo}</p>
        ${opciones}
      </div>`;
    }).join('');

    return `
      <div class="eu-combo" id="organigrama-combo">
        <div class="eu-combo-control" id="organigrama-combo-control">
          <span class="eu-combo-icon"><i class="fas fa-search"></i></span>
          <input id="swal-organigrama-search" type="text" placeholder="Buscar puesto en el organigrama..."
                 value="${valor.replace(/"/g, '&quot;')}" autocomplete="off" spellcheck="false">
          <button type="button" class="eu-combo-clear" id="organigrama-combo-clear" ${valor ? '' : 'style="display:none;"'} aria-label="Limpiar puesto">
            <i class="fas fa-times"></i>
          </button>
          <span class="eu-combo-chevron"><i class="fas fa-chevron-down"></i></span>
        </div>
        <input type="hidden" id="swal-organigrama" value="${valor.replace(/"/g, '&quot;')}">
        <div class="eu-combo-dropdown" id="organigrama-dropdown" role="listbox">
          <button type="button" class="eu-combo-option" data-value="" role="option">
            <span class="eu-combo-option-icon"><i class="fas fa-ban"></i></span>
            <span class="eu-combo-option-body">
              <span class="eu-combo-option-title">Sin puesto asignado</span>
              <span class="eu-combo-option-meta">No aparece en el organigrama Biznaga</span>
            </span>
          </button>
          ${gruposHtml}
          <div class="eu-combo-empty" id="organigrama-empty" style="display:none;">
            <i class="fas fa-search"></i>
            <span>No hay puestos que coincidan</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindOrganigramaCombobox(): void {
    const combo = document.getElementById('organigrama-combo');
    const control = document.getElementById('organigrama-combo-control');
    const input = document.getElementById('swal-organigrama-search') as HTMLInputElement | null;
    const hidden = document.getElementById('swal-organigrama') as HTMLInputElement | null;
    const dropdown = document.getElementById('organigrama-dropdown');
    const clearBtn = document.getElementById('organigrama-combo-clear');
    const emptyState = document.getElementById('organigrama-empty');
    if (!combo || !control || !input || !hidden || !dropdown) return;

    const syncChecks = (valor: string) => {
      dropdown.querySelectorAll('.eu-combo-option').forEach((btn) => {
        const option = btn as HTMLElement;
        const match = (option.getAttribute('data-value') || '') === valor;
        option.classList.toggle('is-selected', match);
        const check = option.querySelector('.eu-combo-check') as HTMLElement | null;
        if (check) check.style.display = match ? '' : 'none';
      });
    };

    const setValor = (valor: string) => {
      hidden.value = valor;
      input.value = valor;
      if (clearBtn) clearBtn.style.display = valor ? '' : 'none';
      syncChecks(valor);
      combo.classList.remove('is-open');
    };

    const filtrar = () => {
      const q = input.value.trim().toLowerCase();
      let visibles = 0;
      dropdown.querySelectorAll('.eu-combo-group').forEach((grupoEl) => {
        const grupo = grupoEl as HTMLElement;
        let grupoVisible = 0;
        grupo.querySelectorAll('.eu-combo-option').forEach((btn) => {
          const option = btn as HTMLElement;
          const texto = (option.getAttribute('data-value') || '').toLowerCase();
          const match = !q || texto.includes(q);
          option.style.display = match ? '' : 'none';
          if (match) {
            grupoVisible++;
            visibles++;
          }
        });
        grupo.style.display = grupoVisible > 0 ? '' : 'none';
      });
      const sinPuesto = dropdown.querySelector('.eu-combo-option[data-value=""]') as HTMLElement | null;
      if (sinPuesto) {
        const mostrarVacio = !q || 'sin puesto asignado'.includes(q);
        sinPuesto.style.display = mostrarVacio ? '' : 'none';
        if (mostrarVacio) visibles++;
      }
      if (emptyState) emptyState.style.display = visibles === 0 ? 'flex' : 'none';
    };

    const abrir = () => {
      const yaAbierto = combo.classList.contains('is-open');
      combo.classList.add('is-open');
      if (!yaAbierto) {
        dropdown.querySelectorAll('.eu-combo-option').forEach((opt, i) => {
          const el = opt as HTMLElement;
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
          el.style.animationDelay = `${Math.min(i, 16) * 0.03}s`;
        });
      }
      filtrar();
    };

    control.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('#organigrama-combo-clear')) return;
      abrir();
      input.focus();
    });
    input.addEventListener('focus', abrir);
    input.addEventListener('input', () => {
      hidden.value = '';
      if (clearBtn) clearBtn.style.display = input.value ? '' : 'none';
      abrir();
    });
    clearBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setValor('');
      input.focus();
      abrir();
    });
    dropdown.addEventListener('click', (ev) => {
      const option = (ev.target as HTMLElement).closest('.eu-combo-option') as HTMLElement | null;
      if (!option) return;
      setValor(option.getAttribute('data-value') || '');
    });
    document.addEventListener('click', (ev) => {
      if (!combo.contains(ev.target as Node)) {
        combo.classList.remove('is-open');
        if (!hidden.value) input.value = '';
        else input.value = hidden.value;
      }
    });
    syncChecks(hidden.value);
  }

  private getEditUserModalStyles(): string {
    return `
        .eu-modal-popup {
          padding: 0 !important;
          border-radius: 20px !important;
          background: #f7faf6 !important;
          overflow: hidden !important;
          display: flex !important;
          flex-direction: column !important;
          max-height: 92vh !important;
          height: min(92vh, 900px) !important;
          width: min(820px, calc(100vw - 1.5rem)) !important;
          border: 1px solid rgba(255,255,255,0.65) !important;
          box-shadow: 0 0 0 1px rgba(15,23,42,0.04), 0 28px 80px rgba(15,23,42,0.28), 0 8px 24px rgba(56,81,47,0.14) !important;
        }
        .eu-modal-popup .swal2-header { display: none !important; padding: 0 !important; }
        .eu-modal-popup .swal2-html-container,
        .eu-modal-popup .eu-modal-html {
          margin: 0 !important;
          padding: 0 !important;
          text-align: left !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          display: block !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          max-height: none !important;
        }
        .eu-modal-popup .swal2-title { display: none !important; }
        .eu-modal-popup .swal2-actions {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.65rem;
          margin: 0 !important;
          padding: 0.85rem 1.45rem 1.15rem !important;
          border-top: 1px solid rgba(56,81,47,0.1);
          background: transparent;
        }
        .eu-modal-popup .swal2-validation-message {
          margin: 0 1.45rem 0.4rem !important;
          border-radius: 10px;
          background: #fff5f5;
          color: #9b1c1c;
        }
        .eu-modal-cancel, .eu-modal-confirm {
          border-radius: 999px !important;
          font-weight: 700 !important;
          font-size: 0.86rem !important;
          padding: 0.62rem 1.15rem !important;
          display: inline-flex !important;
          align-items: center;
          gap: 0.4rem;
          box-shadow: none !important;
        }
        .eu-modal-cancel {
          background: #fff !important;
          color: #1f2937 !important;
          border: 1.5px solid #d7ddd3 !important;
        }
        .eu-modal-confirm {
          background: linear-gradient(135deg, #38512F 0%, #5a7456 100%) !important;
          color: #fff !important;
          border: none !important;
        }
        .eu-hero {
          position: sticky;
          top: 0;
          z-index: 5;
          flex-shrink: 0;
          overflow: hidden;
          color: #fff;
        }
        .eu-hero-bg {
          position: absolute; inset: 0;
          background: linear-gradient(135deg, rgba(56,81,47,0.96) 0%, rgba(90,116,86,0.9) 48%, rgba(45,66,40,0.97) 100%);
        }
        .eu-hero-bg::after {
          content: '';
          position: absolute; inset: 0;
          background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
          opacity: 0.55;
        }
        .eu-hero-content {
          position: relative; z-index: 1;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 0.9rem;
          padding: 1.25rem 1.45rem 1.15rem;
          text-align: left;
        }
        .eu-hero-badge {
          width: 3.1rem; height: 3.1rem; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.16);
          border: 1px solid rgba(255,255,255,0.28);
          backdrop-filter: blur(8px);
          font-size: 1.15rem;
          color: #fff;
          flex-shrink: 0;
        }
        .eu-hero-text {
          flex: 1;
          min-width: 0;
          text-align: left !important;
        }
        .eu-modal-popup h2.eu-hero-title,
        .eu-hero-title {
          margin: 0 !important;
          font-size: 1.22rem !important;
          font-weight: 800 !important;
          letter-spacing: -0.02em;
          color: #ffffff !important;
          text-align: left !important;
          display: flex !important;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          line-height: 1.2;
        }
        .eu-hero-rol {
          display: inline-flex;
          align-items: center;
          padding: 0.16rem 0.52rem;
          border-radius: 999px;
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #fff;
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.28);
          flex-shrink: 0;
        }
        .eu-hero-subtitle { margin: 0.28rem 0 0; font-size: 0.8rem; color: rgba(255,255,255,0.92); text-align: left; word-break: break-word; }
        .eu-hero-close {
          width: 2.3rem; height: 2.3rem; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.35);
          background: rgba(255,255,255,0.14);
          color: #fff; cursor: pointer;
          margin-left: auto;
          flex-shrink: 0;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .eu-hero-close:hover { background: rgba(255,255,255,0.26); transform: rotate(90deg); }
        .eu-body {
          position: relative;
          overflow: visible;
          padding: 1rem 1.45rem 1.1rem;
          text-align: left;
          font-family: 'Open Sans', sans-serif;
        }
        .eu-modal-popup .swal2-html-container::-webkit-scrollbar,
        .eu-body::-webkit-scrollbar { width: 6px; }
        .eu-modal-popup .swal2-html-container::-webkit-scrollbar-thumb,
        .eu-body::-webkit-scrollbar-thumb { background: #c5d0bf; border-radius: 999px; }
        .eu-body-deco { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .eu-body-deco::before, .eu-body-deco::after {
          content: ''; position: absolute; background-color: #38512F; opacity: 0.08; filter: blur(2.5px);
          mask-repeat: no-repeat; mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-size: contain;
        }
        .eu-body-deco::before {
          bottom: 0; left: 0; width: min(220px, 38%); height: min(220px, 42%);
          mask-image: url('/assets/img/img_deco/Fondo_cir_inf_izq.png');
          -webkit-mask-image: url('/assets/img/img_deco/Fondo_cir_inf_izq.png');
          mask-position: bottom left; -webkit-mask-position: bottom left;
        }
        .eu-body-deco::after {
          top: 0; right: 0; width: min(200px, 36%); height: min(200px, 40%);
          mask-image: url('/assets/img/img_deco/Fondo_cir_sup_der.png');
          -webkit-mask-image: url('/assets/img/img_deco/Fondo_cir_sup_der.png');
          mask-position: top right; -webkit-mask-position: top right;
        }
        .eu-inner { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 0.95rem; }
        .eu-user-header {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.7rem 0.85rem; border-radius: 14px;
          background: rgba(255,255,255,0.78);
          border: 1px solid rgba(56,81,47,0.12);
        }
        .eu-avatar {
          flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #38512F, #5a7456); color: #fff; font-weight: 700; font-size: 0.9rem;
        }
        .eu-username { font-weight: 800; font-size: 0.95rem; color: #1A1A1A; }
        .eu-rol-badge {
          display: inline-block; padding: 0.12rem 0.48rem; border-radius: 999px; font-size: 0.58rem;
          font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #fff; margin-left: 0.35rem;
        }
        .eu-card { position: relative; padding: 0 0 0.15rem; }
        .eu-card-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
          margin-bottom: 0.85rem; padding-bottom: 0.7rem; border-bottom: 1px solid rgba(56,81,47,0.1);
        }
        .eu-card-eyebrow {
          margin: 0; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase;
          color: #8a9684; font-weight: 700;
        }
        .eu-card-title { margin: 0.18rem 0 0; font-size: 1.02rem; font-weight: 800; color: #1f2a1c; }
        .eu-card-hero {
          width: 2.35rem; height: 2.35rem; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #38512F, #5a7456); color: #fff; flex-shrink: 0;
        }
        .eu-card-head-meta {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          flex-shrink: 0;
        }
        .eu-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; margin-bottom: 0.7rem; }
        .eu-row:last-child { margin-bottom: 0; }
        .eu-row.eu-row-single { grid-template-columns: 1fr; }
        @media (max-width: 560px) { .eu-row { grid-template-columns: 1fr; } }
        .eu-field { display: flex; flex-direction: column; gap: 0.32rem; }
        .eu-field label, .eu-field-label {
          font-size: 0.74rem; font-weight: 700; color: #4b5648;
          display: flex; align-items: center; gap: 0.38rem;
        }
        .eu-field label i, .eu-field-label i { color: #38512F; font-size: 0.72rem; width: 1rem; text-align: center; }
        .eu-field em, .eu-req { color: #e11d48; font-style: normal; font-weight: 700; }
        .eu-input-wrap {
          position: relative; display: flex; align-items: stretch;
          border-radius: 12px; background: rgba(255,255,255,0.94);
          border: 1.5px solid #e2e8de; box-shadow: 0 2px 10px rgba(15,23,42,0.04);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .eu-input-wrap:focus-within {
          border-color: #38512F; box-shadow: 0 0 0 3px rgba(56,81,47,0.1);
        }
        .eu-input-wrap .eu-input-icon {
          position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%);
          color: #9aa894; font-size: 0.72rem; pointer-events: none; z-index: 1;
        }
        .eu-input-wrap input, .eu-input-wrap select {
          width: 100%; padding: 0.72rem 0.8rem 0.72rem 2.05rem;
          font-size: 0.86rem; color: #1f2937; border: none; outline: none; background: transparent;
          font-family: 'Open Sans', sans-serif; border-radius: 12px;
        }
        .eu-input-wrap .eu-eye-btn {
          position: absolute; right: 0.55rem; top: 50%; transform: translateY(-50%);
          border: none; background: transparent; color: #768D6B; font-size: 0.78rem; cursor: pointer;
        }
        .eu-input-wrap input.with-eye { padding-right: 2rem; }
        .eu-select-wrap select { appearance: none; padding-right: 1.9rem; }
        .eu-select-wrap::after {
          content: '\\f078'; font-family: 'Font Awesome 5 Free'; font-weight: 900;
          position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%);
          font-size: 0.58rem; color: #9aa894; pointer-events: none;
        }
        .eu-combo { position: relative; }
        .eu-combo-control {
          display: flex; align-items: center; gap: 0.45rem;
          min-height: 46px; padding: 0 0.7rem;
          border-radius: 12px; background: rgba(255,255,255,0.94);
          border: 1.5px solid #e2e8de; box-shadow: 0 2px 10px rgba(15,23,42,0.04);
          cursor: text; transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .eu-combo.is-open .eu-combo-control, .eu-combo-control:focus-within {
          border-color: #38512F; box-shadow: 0 0 0 3px rgba(56,81,47,0.1);
        }
        .eu-combo-icon { color: #38512F; font-size: 0.78rem; }
        .eu-combo-control input {
          flex: 1; border: none; outline: none; background: transparent;
          font-size: 0.86rem; color: #1f2937; min-width: 0;
        }
        .eu-combo-clear, .eu-combo-chevron { color: #8a9684; background: none; border: none; cursor: pointer; }
        .eu-combo-dropdown {
          display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20;
          max-height: 260px; overflow-y: auto; padding: 0.4rem;
          background: #fff; border: 1px solid #e2e8de; border-radius: 14px;
          box-shadow: 0 16px 36px rgba(15,23,42,0.14);
          transform-origin: top center;
        }
        .eu-combo.is-open .eu-combo-dropdown {
          display: block;
          animation: euComboDropIn 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .eu-combo-chevron { transition: transform 0.22s ease; display: inline-flex; }
        .eu-combo.is-open .eu-combo-chevron { transform: rotate(180deg); }
        .eu-combo.is-open .eu-combo-option {
          animation: euComboOptionIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .eu-combo-group { padding: 0.15rem 0 0.35rem; }
        .eu-combo-group-label {
          margin: 0.25rem 0.45rem 0.35rem; font-size: 0.62rem; font-weight: 800;
          letter-spacing: 0.07em; text-transform: uppercase; color: #8a9684;
        }
        .eu-combo-option {
          width: 100%; display: flex; align-items: center; gap: 0.55rem;
          border: none; background: transparent; text-align: left; cursor: pointer;
          padding: 0.48rem 0.5rem; border-radius: 10px; color: #1f2937;
        }
        .eu-combo-option:hover, .eu-combo-option.is-selected { background: rgba(56,81,47,0.08); }
        .eu-combo-option-icon {
          width: 1.7rem; height: 1.7rem; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(56,81,47,0.1); color: #38512F; font-size: 0.68rem; flex-shrink: 0;
        }
        .eu-combo-option-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .eu-combo-option-title { font-size: 0.8rem; font-weight: 700; }
        .eu-combo-option-meta { font-size: 0.66rem; color: #7b8676; }
        .eu-combo-check { color: #38512F; font-size: 0.7rem; }
        .eu-combo-empty {
          display: flex; align-items: center; gap: 0.4rem; padding: 0.7rem 0.5rem;
          color: #8a9684; font-size: 0.78rem;
        }
        .eu-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        @media (max-width: 560px) { .eu-media-grid { grid-template-columns: 1fr; } }
        .eu-media-section {
          background: rgba(255,255,255,0.88); border-radius: 14px;
          border: 1px solid rgba(56,81,47,0.12); overflow: hidden;
        }
        .eu-media-header {
          display: flex; align-items: center; gap: 0.45rem; padding: 0.5rem 0.75rem;
          background: rgba(56,81,47,0.05); border-bottom: 1px solid #eef2ea;
        }
        .eu-media-header i { font-size: 0.72rem; color: #38512F; }
        .eu-media-header span { font-size: 0.72rem; font-weight: 800; color: #38512F; text-transform: uppercase; letter-spacing: 0.5px; }
        .eu-media-header .eu-badge {
          margin-left: auto; font-size: 0.58rem; font-weight: 700; color: #768D6B;
          background: rgba(118,141,107,0.14); border-radius: 999px; padding: 0.08rem 0.42rem;
        }
        .eu-media-body { padding: 0.65rem; }
        .eu-dropzone {
          border: 1.5px dashed #C2D1B2; border-radius: 12px; padding: 0.85rem 0.55rem; text-align: center;
          cursor: pointer; transition: border-color 0.22s ease, background 0.22s ease; background: #fafbf9;
          min-height: 92px; display: flex; align-items: center; justify-content: center; flex-direction: column;
        }
        .eu-dropzone:hover { border-color: #768D6B; background: rgba(56,81,47,0.04); }
        .eu-dropzone .dz-icon { font-size: 1.35rem; color: #C2D1B2; margin-bottom: 0.2rem; }
        .eu-dropzone p { font-size: 0.74rem; color: #6b7280; margin: 0; font-weight: 700; }
        .eu-dropzone small { font-size: 0.64rem; color: #9aa894; margin-top: 0.08rem; display: block; }
        .eu-dz-preview { display: none; flex-direction: column; align-items: center; }
        .eu-dz-preview img { max-height: 72px; max-width: 100%; border-radius: 8px; border: 1px solid #dee2e6; object-fit: contain; }
        .eu-preview-name { font-size: 0.66rem; color: #38512F; margin: 0.18rem 0 0; font-weight: 600; word-break: break-word; }
        .eu-remove-btn { background: none; border: none; color: #f5365c; font-size: 0.64rem; cursor: pointer; margin-top: 0.1rem; }
        .eu-footnote {
          margin: 0.15rem 0 0; font-size: 0.72rem; color: #6b7280;
          display: flex; align-items: center; gap: 0.35rem;
        }
        .eu-pc-card {
          display: flex; align-items: center; justify-content: space-between; gap: 0.8rem;
          padding: 0.7rem 0.85rem; border: 1px solid #d8e5cf; border-radius: 12px;
          background: linear-gradient(135deg, #f9fcf7 0%, #f3f8f0 100%);
        }
        .eu-pc-title { display: flex; align-items: center; gap: 0.32rem; font-size: 0.82rem; font-weight: 700; color: #2f4630; }
        .eu-pc-copy small { display: block; color: #6b7c70; font-size: 0.67rem; line-height: 1.28; }
        .eu-pc-toggle-wrap { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
        .eu-pc-status { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; border-radius: 999px; padding: 0.12rem 0.44rem; }
        .eu-pc-status.on { color: #21653f; background: #d9f4e4; }
        .eu-pc-status.off { color: #856404; background: #fff5cc; }
        .eu-switch { position: relative; width: 44px; height: 24px; display: inline-block; margin: 0; }
        .eu-switch input { opacity: 0; width: 0; height: 0; }
        .eu-switch-slider { position: absolute; inset: 0; border-radius: 999px; background: #d6dbd2; transition: all 0.2s ease; cursor: pointer; }
        .eu-switch-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: all 0.2s ease; }
        .eu-switch input:checked + .eu-switch-slider { background: linear-gradient(135deg, #38512F 0%, #5a7456 100%); }
        .eu-switch input:checked + .eu-switch-slider::before { transform: translateX(20px); }
        .eu-pwd-toggle {
          display: flex; align-items: center; gap: 0.45rem; padding: 0.55rem 0.75rem;
          background: #fff; border: 1.5px solid #e2e8de; border-radius: 12px; cursor: pointer;
          font-size: 0.8rem; color: #4b5648; font-weight: 700;
        }
        .eu-pwd-toggle:hover { border-color: #C2D1B2; color: #38512F; }
        .eu-pwd-fields { display: none; margin-top: 0.55rem; }
        .eu-pwd-fields.visible { display: block; }
        .eu-pwd-hint { font-size: 0.7rem; margin-top: 0.22rem; }
        .password-suggestions { margin-top: 0.55rem; }
        .password-suggestions__header { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.35rem; }
        .password-suggestions__header small { font-size: 0.65rem; color: #6c7a6f; font-weight: 700; text-transform: uppercase; letter-spacing: 0.45px; }
        .password-suggestions__refresh { border: none; background: transparent; color: #38512F; font-size: 0.68rem; font-weight: 700; cursor: pointer; }
        .password-suggestions__chips { display: flex; flex-wrap: wrap; gap: 0.32rem; }
        .password-suggestions__chip {
          border: 1px solid #c8d4c2; border-radius: 999px; background: #f3f7f1; color: #2f4630;
          font-size: 0.67rem; font-weight: 600; padding: 0.22rem 0.56rem; cursor: pointer;
        }
        .password-suggestions__chip:hover { background: #38512F; color: #fff; border-color: #38512F; }
        .cred-extra-wrapper {
          margin-top: 0.65rem; padding: 0.65rem 0.75rem 0.75rem; border-radius: 12px;
          border: 1px solid rgba(56,81,47,0.16); background: rgba(56,81,47,0.04);
        }
        .cred-extra-header { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px dashed rgba(56,81,47,0.2); margin-bottom: 0.45rem; }
        .cred-extra-title { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #38512F; }
        .cred-extra-toggle-group { display: inline-flex; align-items: center; gap: 0.4rem; }
        .cred-extra-label { font-size: 0.67rem; font-weight: 700; color: #5b6b59; }
        .cred-switch { position: relative; width: 38px; height: 20px; display: inline-block; margin: 0; }
        .cred-switch input { opacity: 0; width: 0; height: 0; }
        .cred-switch-slider { position: absolute; inset: 0; border-radius: 999px; background: #d6dbd2; cursor: pointer; }
        .cred-switch-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: all 0.2s ease; }
        .cred-switch input:checked + .cred-switch-slider { background: linear-gradient(135deg, #38512F 0%, #5a7456 100%); }
        .cred-switch input:checked + .cred-switch-slider::before { transform: translateX(18px); }
        #cred-extra-edit-container { display: none; margin-top: 0.45rem; padding: 0.5rem; border-radius: 10px; border: 1px solid rgba(118,141,107,0.2); background: #fff; }
        .cred-extra-row { display: grid; grid-template-columns: 1fr auto; gap: 0.45rem; margin-bottom: 0.45rem; }
        .cred-extra-add-btn {
          border: none; border-radius: 10px; background: linear-gradient(135deg, #38512F 0%, #5a7456 100%);
          color: #fff; font-size: 0.72rem; font-weight: 700; padding: 0.5rem 0.85rem; cursor: pointer;
        }
        .cred-extra-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .cred-extra-chip { display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px; background: rgba(56,81,47,0.1); color: #38512F; padding: 0.2rem 0.55rem; font-size: 0.68rem; font-weight: 700; }
        .cred-extra-chip button { border: none; background: transparent; color: #38512F; font-size: 0.64rem; cursor: pointer; }
        .cred-extra-help { display: block; font-size: 0.64rem; color: #6c7a6f; margin-top: 0.2rem; }
        ${this.getEuModalAnimations()}
        ${this.getRolPickerStyles()}
        .roles-picker { background: rgba(255,255,255,0.72); border-radius: 12px; padding: 0.55rem; }
    `;
  }

  private pulseRolTag(tag: HTMLElement): void {
    tag.classList.remove('rol-tag--pop');
    void tag.offsetWidth;
    tag.classList.add('rol-tag--pop');
  }

  private updateRolesCountBadge(containerId: string, badgeId: string): void {
    const count = document.querySelectorAll(`#${containerId} .rol-check:checked`).length;
    const badge = document.getElementById(badgeId);
    if (badge) {
      badge.textContent = count === 0 ? 'Ninguno' : count === 1 ? '1 rol' : `${count} roles`;
    }
  }

  private bindRolTags(containerId: string, badgeId: string | null, onChange?: () => void): void {
    const tags = document.querySelectorAll(`#${containerId} .rol-tag`) as NodeListOf<HTMLElement>;
    tags.forEach(tag => {
      tag.addEventListener('click', (ev) => {
        ev.preventDefault();
        const cb = tag.querySelector('.rol-check') as HTMLInputElement;
        cb.checked = !cb.checked;
        tag.classList.toggle('selected', cb.checked);
        this.pulseRolTag(tag);
        if (badgeId) this.updateRolesCountBadge(containerId, badgeId);
        onChange?.();
      });
    });
    if (badgeId) this.updateRolesCountBadge(containerId, badgeId);
  }

  private buildRolTagsHtml(selectedRoles: string[] = []): string {
    return this.rolesDisponibles.map((rol, index) => {
      const rolNombre = rol.nombre_rol?.toLowerCase() || '';
      const seleccionado = selectedRoles.includes(rolNombre);
      const icon = this.getRolTagIcon(rolNombre);
      const colorClass = this.getRolTagClass(rolNombre);
      const desc = this.getRolDisplayName(rolNombre, rol.descripcion || rol.nombre_rol);
      return `<label class="rol-tag ${colorClass}${seleccionado ? ' selected' : ''}" data-rol-id="${rol.rol_id}" data-nombre="${rolNombre}" style="animation-delay:${(index * 0.035).toFixed(3)}s">
        <input type="checkbox" class="rol-check" value="${rol.rol_id}" data-nombre="${rolNombre}"${seleccionado ? ' checked' : ''}>
        <span class="rol-icon-wrap"><i class="fas ${icon}"></i></span>
        <span class="rol-name">${desc}</span>
      </label>`;
    }).join('');
  }

  /**
   * Obtiene todos los roles de un usuario (principal + adicionales)
   */
  getTodosLosRoles(usuario: any): string[] {
    const roles: string[] = [usuario.rol || ''];
    if (usuario.roles_adicionales) {
      usuario.roles_adicionales.split(',').map((r: string) => r.trim()).filter(Boolean).forEach((r: string) => {
        if (!roles.map((x: string) => x.toLowerCase()).includes(r.toLowerCase())) {
          roles.push(r);
        }
      });
    }
    return roles;
  }

  /**
   * Determina si el usuario actual puede editar a otro usuario
   * - Root puede editar a todos (excepto a sí mismo en ciertos casos)
   * - Administrador puede editar a instructores, consulta y usuarios de empresa
   * - Nadie puede editar al root
   */
  puedeEditar(usuario: any): boolean {
    const rolUsuario = usuario.rol?.toLowerCase();

    // Root puede editar a todos
    if (this.esRoot) return true;

    // Nadie más puede editar al root
    if (rolUsuario === 'root') return false;

    // Administrador puede editar instructores, doctores, consulta y usuarios de empresa
    if (this.esAdministrador) {
      return rolUsuario === 'instructor'
        || rolUsuario === 'doctor'
        || rolUsuario === 'consulta'
        || rolUsuario === 'solo consulta'
        || rolUsuario === 'empresa'
        || rolUsuario === 'usuario empresa';
    }

    return false;
  }

  async editarUsuario(usuario: any) {
    if (usuario?.es_empresa_colaboradora_sin_usuario) {
      return this.editarEmpresaColaboradora(usuario);
    }

    const esRoot = this.authService.esSuperusuario();
    const puedeResetearPassword = esRoot || this.authService.esAdministrador();
    const rolUsuario = usuario.rol?.toLowerCase() || '';
    const esUsuarioEmpresa = rolUsuario === 'empresa' || rolUsuario === 'usuario empresa';

    let empresasPrincipales: any[] = [];
    let datosEmpresa: any = {};
    if (esUsuarioEmpresa) {
      try {
        const respuestaEmpresas = await firstValueFrom(this.backendService.obtenerEmpresas());
        if (respuestaEmpresas?.success) {
          const empresaActualId = Number(usuario.empresa_id || 0);
          empresasPrincipales = (respuestaEmpresas.empresas || []).filter((empresa: any) => {
            const empresaId = Number(empresa?.empresa_id || 0);
            return empresaId > 0 && !empresa?.colaborador && empresaId !== empresaActualId;
          });
        }
      } catch (_) {
        empresasPrincipales = [];
      }

      const empresaIdObjetivo = Number(usuario.empresa_id || 0);
      if (empresaIdObjetivo > 0) {
        try {
          const respuestaEmpresa = await firstValueFrom(this.backendService.obtenerEmpresa(empresaIdObjetivo));
          if (respuestaEmpresa?.success && respuestaEmpresa.empresa) {
            datosEmpresa = respuestaEmpresa.empresa;
          }
        } catch (_) {
          datosEmpresa = {};
        }
      }
    }

    const escAttr = (valor: unknown) => String(valor ?? '').replace(/"/g, '&quot;');
    const nombreEmpresaActual = escAttr(datosEmpresa.nombre_empresa || usuario.nombre_empresa || '');
    const rfcEmpresaActual = escAttr(datosEmpresa.rfc || '');
    const razonSocialEmpresaActual = escAttr(datosEmpresa.razon_social || '');
    const cpEmpresaActual = escAttr(datosEmpresa.codigo_postal || '');
    const direccionEmpresaActual = escAttr(datosEmpresa.direccion || '');
    const estadoEmpresaActual = escAttr(datosEmpresa.estado || '');
    const ciudadEmpresaActual = escAttr(datosEmpresa.ciudad || '');

    const esEmpresaColaboradoraActual = Boolean(usuario.empresa_colaborador);
    const empresaColaboradorActual = Number(usuario.empresa_colaborador || 0) || null;
    const opcionesEmpresasPrincipalesHtml = empresasPrincipales
      .map((empresa: any) => {
        const empresaId = Number(empresa.empresa_id);
        const selected = empresaColaboradorActual === empresaId ? 'selected' : '';
        return `<option value="${empresaId}" ${selected}>${empresa.nombre_empresa}</option>`;
      })
      .join('');

    // Construir lista completa de roles del usuario
    const rolesUsuario: string[] = [rolUsuario];
    if (usuario.roles_adicionales) {
      usuario.roles_adicionales.split(',').map((r: string) => r.trim().toLowerCase()).filter(Boolean).forEach((r: string) => {
        if (!rolesUsuario.includes(r)) rolesUsuario.push(r);
      });
    }

    // Para usuarios empresa, usar el email de empresa como fallback si usuario.email está vacío
    const emailEfectivo = usuario.email || usuario.empresa_contacto_email || usuario.empresa_email || '';
    const puestoEmpresaEfectivo = String(usuario.empresa_puesto || usuario.puesto_contacto || '').trim();

    // Parsear las áreas actuales del instructor (vienen como "2,3,4" del GET)
    const areasActuales: number[] = usuario.areas_ids
      ? String(usuario.areas_ids).split(',').map((id: string) => parseInt(id.trim())).filter((n: number) => !isNaN(n))
      : [];

    // Badge de rol para el header
    const rolBadgeColors: Record<string, string> = {
      'root': '#dc3545', 'administrador': '#ffc107', 'instructor': '#17a2b8',
      'doctor': '#6f42c1', 'consulta': '#6c757d', 'solo consulta': '#6c757d', 'empresa': '#28a745',
      'innovacion': '#7c3aed', 'ambiental': '#15803d', 'sgc': '#0d9488', 'proteccion_civil': '#fb6340',
      'control_documental': '#17a2b8', 'rrhh': '#db2777', 'mantenimiento': '#d97706'
    };
    const rolColor = rolBadgeColors[rolUsuario] || '#6c757d';

    // Indicador de firma actual en la columna izq
    const firmaActualHtml = usuario.firma_drive_id
      ? `<div style="margin-top:0.4rem;text-align:center;">
           <p style="font-size:0.62rem;color:#8898aa;margin:0 0 0.25rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Actual</p>
           <img src="${environment.apiUrl}/firma-doctor/${usuario.firma_drive_id}"
                style="max-height:52px;max-width:95%;border:1px solid #dee2e6;border-radius:6px;padding:3px;background:#fff;display:block;margin:0 auto;"
                onerror="this.parentNode.innerHTML='<span style=\\'font-size:0.65rem;color:#dc3545;\\'><i class=\\'fas fa-exclamation-circle\\'></i> No disponible</span>'">
         </div>`
      : `<p style="font-size:0.65rem;color:#8a9684;margin:0.3rem 0 0;text-align:center;">Sin firma registrada</p>`;

    // Indicador de foto actual en la columna izq
    const fotoActualPreviewUrl = this.backendService.resolverUrlDrivePreview(usuario.foto_drive_id || usuario.foto_url);
    const fotoActualHtml = fotoActualPreviewUrl
      ? `<div style="margin-top:0.4rem;text-align:center;">
           <p style="font-size:0.62rem;color:#8898aa;margin:0 0 0.25rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Actual</p>
           <img src="${fotoActualPreviewUrl}"
                style="max-height:60px;max-width:95%;border:1px solid #dee2e6;border-radius:6px;padding:3px;background:#fff;display:block;margin:0 auto;object-fit:cover;"
                onerror="this.parentNode.innerHTML='<span style=\\'font-size:0.65rem;color:#dc3545;\\'><i class=\\'fas fa-exclamation-circle\\'></i> No disponible</span>'">
         </div>`
      : '';

        const logoEmpresaPreviewUrl = this.getLogoEmpresaPreviewUrl(usuario.empresa_logo);
        const logoEmpresaActualHtml = logoEmpresaPreviewUrl
       ? `<div style="margin-top:0.4rem;text-align:center;">
         <p style="font-size:0.62rem;color:#8898aa;margin:0 0 0.25rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Actual</p>
         <img src="${logoEmpresaPreviewUrl}"
           style="max-height:72px;max-width:95%;border:1px solid #dee2e6;border-radius:6px;padding:3px;background:#fff;display:block;margin:0 auto;object-fit:contain;"
           onerror="this.parentNode.innerHTML='<span style=\\'font-size:0.65rem;color:#dc3545;\\'><i class=\\'fas fa-exclamation-circle\\'></i> No disponible</span>'">
          </div>`
       : `<p style="font-size:0.65rem;color:#f5365c;margin:0.3rem 0 0;text-align:center;"><i class="fas fa-exclamation-triangle"></i> Sin logo</p>`;

    const htmlForm = `
      <style>${this.getEditUserModalStyles()}</style>

      <header class="eu-hero">
        <div class="eu-hero-bg"></div>
        <div class="eu-hero-content">
          <div class="eu-hero-badge"><i class="fas fa-user-edit"></i></div>
          <div class="eu-hero-text">
            <h2 class="eu-hero-title">
              ${usuario.username || ''}
              <span class="eu-hero-rol" style="background:${rolColor};">${this.getRolDisplayName(rolUsuario, usuario.rol)}</span>
            </h2>
            <p class="eu-hero-subtitle">${emailEfectivo || 'Sin email'}</p>
          </div>
          <button type="button" class="eu-hero-close" id="eu-edit-close" aria-label="Cerrar">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </header>

      <div class="eu-body">
        <div class="eu-body-deco" aria-hidden="true"></div>
        <div class="eu-inner">

          ${esUsuarioEmpresa ? `
          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Empresa</p>
                <h3 class="eu-card-title">Datos de la empresa</h3>
              </div>
              <div class="eu-card-hero"><i class="fas fa-id-card"></i></div>
            </header>
            <div class="eu-row">
              <div class="eu-field">
                <label><i class="fas fa-building"></i> Nombre de la empresa <em>*</em></label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-building"></i>
                  <input id="swal-nombre-empresa" type="text" value="${nombreEmpresaActual}" placeholder="Razón social o nombre comercial" autocomplete="off">
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-file-invoice"></i> RFC <em>*</em></label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-file-invoice"></i>
                  <input id="swal-rfc-empresa" type="text" value="${rfcEmpresaActual}" placeholder="RFC (12-13 caracteres)" maxlength="13" autocomplete="off" style="text-transform:uppercase;">
                </div>
              </div>
            </div>
            <div class="eu-row eu-row-single">
              <div class="eu-field">
                <label><i class="fas fa-briefcase"></i> Razón social</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-briefcase"></i>
                  <input id="swal-razon-social-empresa" type="text" value="${razonSocialEmpresaActual}" placeholder="Razón social (opcional)" autocomplete="off">
                </div>
              </div>
            </div>
            <div class="eu-row">
              <div class="eu-field">
                <label><i class="fas fa-mail-bulk"></i> Código postal</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-mail-bulk"></i>
                  <input id="swal-cp-empresa" type="text" value="${cpEmpresaActual}" placeholder="00000" maxlength="5" inputmode="numeric" autocomplete="postal-code">
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-map"></i> Estado</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-map"></i>
                  <input id="swal-estado-empresa" type="text" value="${estadoEmpresaActual}" placeholder="Estado" autocomplete="address-level1">
                </div>
              </div>
            </div>
            <div class="eu-row">
              <div class="eu-field">
                <label><i class="fas fa-city"></i> Ciudad / Municipio</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-city"></i>
                  <input id="swal-ciudad-empresa" type="text" value="${ciudadEmpresaActual}" placeholder="Municipio o ciudad" autocomplete="address-level2">
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-road"></i> Dirección</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-road"></i>
                  <input id="swal-direccion-empresa" type="text" value="${direccionEmpresaActual}" placeholder="Calle, número, colonia" autocomplete="street-address">
                </div>
              </div>
            </div>
          </section>

          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Empresa</p>
                <h3 class="eu-card-title">Protección Civil y colaboración</h3>
              </div>
              <div class="eu-card-hero"><i class="fas fa-building"></i></div>
            </header>
            <div class="eu-pc-card">
              <div class="eu-pc-copy">
                <div class="eu-pc-title"><i class="fas fa-shield-alt"></i> Servicio de Protección Civil</div>
              </div>
              <div class="eu-pc-toggle-wrap">
                <span id="swal-pc-status" class="eu-pc-status"></span>
                <label class="eu-switch" aria-label="Servicio de Protección Civil">
                  <input id="swal-servicio-proteccion-civil" type="checkbox" ${Number(usuario.empresa_servicio_proteccion_civil ?? 1) === 1 ? 'checked' : ''}>
                  <span class="eu-switch-slider"></span>
                </label>
              </div>
            </div>
            <div class="eu-pc-card" style="margin-top:0.65rem;">
              <div class="eu-pc-copy">
                <div class="eu-pc-title"><i class="fas fa-handshake"></i> Es empresa colaboradora</div>
                <small>Asocia esta empresa a una empresa principal (ej. PEAK1 depende de PEAK).</small>
              </div>
              <div class="eu-pc-toggle-wrap">
                <label class="eu-switch" aria-label="Es empresa colaboradora">
                  <input id="swal-es-empresa-colaboradora" type="checkbox" ${esEmpresaColaboradoraActual ? 'checked' : ''}>
                  <span class="eu-switch-slider"></span>
                </label>
              </div>
            </div>
            <div id="swal-colaborador-empresa-wrap" class="eu-row eu-row-single" style="margin-top:0.65rem;${esEmpresaColaboradoraActual ? '' : 'display:none;'}">
              <div class="eu-field">
                <label><i class="fas fa-building"></i> Empresa principal <em>*</em></label>
                <div class="eu-input-wrap eu-select-wrap">
                  <i class="eu-input-icon fas fa-building"></i>
                  <select id="swal-empresa-colaborador-padre">
                    <option value="">Seleccione una empresa</option>
                    ${opcionesEmpresasPrincipalesHtml}
                  </select>
                </div>
              </div>
            </div>
          </section>
          ` : ''}

          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Datos generales</p>
                <h3 class="eu-card-title">Información personal</h3>
              </div>
              <div class="eu-card-hero"><i class="fas fa-user"></i></div>
            </header>
            <div class="eu-row">
              <div class="eu-field">
                <label><i class="fas fa-user-edit"></i> Nombre <em>*</em></label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-user"></i>
                  <input id="swal-nombre" type="text" value="${usuario.nombre || ''}" placeholder="Nombre(s)" autocomplete="off">
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-user"></i> Apellido</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-user"></i>
                  <input id="swal-apellido" type="text" value="${usuario.apellido || ''}" placeholder="Apellido(s)" autocomplete="off">
                </div>
              </div>
            </div>
            <div class="eu-row">
              <div class="eu-field">
                <label><i class="fas fa-envelope"></i> Email</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-envelope"></i>
                  <input id="swal-email" type="text" value="${emailEfectivo}" placeholder="correo@ejemplo.com" autocomplete="off">
                </div>
              </div>
              <div class="eu-field">
                <label><i class="fas fa-phone"></i> Teléfono</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-phone"></i>
                  <input id="swal-telefono" type="text" value="${usuario.telefono || ''}" placeholder="(000) 000-0000" autocomplete="off">
                </div>
              </div>
            </div>
            ${esUsuarioEmpresa ? `
            <div class="eu-row eu-row-single">
              <div class="eu-field">
                <label><i class="fas fa-briefcase"></i> Puesto</label>
                <div class="eu-input-wrap">
                  <i class="eu-input-icon fas fa-briefcase"></i>
                  <input id="swal-puesto-empresa" type="text" value="${puestoEmpresaEfectivo}" placeholder="Puesto del contacto" autocomplete="off">
                </div>
              </div>
            </div>
            ` : ''}
          </section>

          ${!esUsuarioEmpresa ? `
          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Acceso al sistema</p>
                <h3 class="eu-card-title">Roles del sistema</h3>
              </div>
              <div class="eu-card-head-meta">
                <span class="eu-section-badge" id="roles-count-edit">${rolesUsuario.length} ${rolesUsuario.length === 1 ? 'rol' : 'roles'}</span>
                <div class="eu-card-hero"><i class="fas fa-shield-alt"></i></div>
              </div>
            </header>
            <div id="roles-checkboxes-edit" class="roles-picker">
              ${this.buildRolTagsHtml(rolesUsuario)}
            </div>
          </section>

          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Estructura organizacional</p>
                <h3 class="eu-card-title">Organigrama Biznaga</h3>
              </div>
              <div class="eu-card-hero"><i class="fas fa-sitemap"></i></div>
            </header>
            <div class="eu-row">
              <div class="eu-field">
                <span class="eu-field-label"><i class="fas fa-id-badge"></i> Puesto en el organigrama</span>
                ${this.buildOrganigramaComboboxHtml(usuario.organigrama || '')}
              </div>
              <div class="eu-field">
                <span class="eu-field-label"><i class="fas fa-building"></i> Área/Departamento</span>
                ${this.buildAreaDepartamentoComboboxHtml(usuario.area_departamento || '')}
              </div>
            </div>
          </section>
          ` : ''}

          ${puedeResetearPassword ? `
          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Seguridad</p>
                <h3 class="eu-card-title">Cambiar contraseña</h3>
              </div>
              <div class="eu-card-hero"><i class="fas fa-lock"></i></div>
            </header>
            <div class="eu-pwd-toggle" id="pwd-toggle-btn">
              <i class="fas fa-key"></i> Cambiar contraseña
              <i class="fas fa-chevron-down" style="margin-left:auto;font-size:0.6rem;transition:transform 0.2s;"></i>
            </div>
            <div id="pwd-fields" class="eu-pwd-fields">
              <div class="eu-row">
                <div class="eu-field">
                  <label><i class="fas fa-key"></i> Nueva Contraseña</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-key"></i>
                    <input id="swal-password" class="with-eye" type="text" placeholder="Mín. 8 caracteres" autocomplete="off"
                           style="-webkit-text-security:disc;text-security:disc;" data-lpignore="true" data-1p-ignore>
                    <button type="button" id="toggle-password-edit" class="eu-eye-btn" aria-label="Mostrar u ocultar nueva contraseña">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
                <div class="eu-field">
                  <label><i class="fas fa-check-circle"></i> Confirmar</label>
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-check-circle"></i>
                    <input id="swal-password-confirm" class="with-eye" type="text" placeholder="Repetir contraseña" autocomplete="off"
                           style="-webkit-text-security:disc;text-security:disc;" data-lpignore="true" data-1p-ignore>
                    <button type="button" id="toggle-password-confirm-edit" class="eu-eye-btn" aria-label="Mostrar u ocultar confirmación de contraseña">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div class="password-suggestions">
                <div class="password-suggestions__header">
                  <small>Sugerencias seguras</small>
                  <button type="button" id="password-suggestions-refresh-edit" class="password-suggestions__refresh">
                    <i class="fas fa-sync-alt"></i> Regenerar
                  </button>
                </div>
                <div id="password-suggestions-chips-edit" class="password-suggestions__chips"></div>
              </div>
              <div id="password-match-hint-edit" class="eu-pwd-hint" style="display:none;color:#f5365c;">
                <i class="fas fa-exclamation-triangle"></i> Las contraseñas no coinciden
              </div>
              <div id="password-ok-hint-edit" class="eu-pwd-hint" style="display:none;color:#38512F;">
                <i class="fas fa-check-circle"></i> Las contraseñas coinciden
              </div>
            </div>
            <div id="cred-extra-wrapper-edit" class="cred-extra-wrapper" style="display:none;">
              <div class="cred-extra-header">
                <div class="cred-extra-title">
                  <i class="fas fa-paper-plane"></i>
                  <span>Envío de credenciales</span>
                </div>
                <div class="cred-extra-toggle-group">
                  <span class="cred-extra-label">¿Enviar credenciales a otros correos?</span>
                  <label class="cred-switch" aria-label="Enviar credenciales a otros correos">
                    <input id="swal-credenciales-extra-toggle-edit" type="checkbox">
                    <span class="cred-switch-slider"></span>
                  </label>
                </div>
              </div>
              <div id="cred-extra-edit-container">
                <div class="cred-extra-row">
                  <div class="eu-input-wrap">
                    <i class="eu-input-icon fas fa-envelope-open-text"></i>
                    <input id="swal-credenciales-extra-input-edit" type="email" placeholder="correo.adicional@ejemplo.com">
                  </div>
                  <button type="button" id="swal-credenciales-extra-add-edit" class="cred-extra-add-btn">
                    <i class="fas fa-plus"></i> Añadir
                  </button>
                </div>
                <div id="swal-credenciales-extra-list-edit" class="cred-extra-list"></div>
                <input id="swal-credenciales-extra-json-edit" type="hidden" value="[]">
                <small class="cred-extra-help">Puedes agregar uno o varios correos para recibir copia de las credenciales.</small>
              </div>
            </div>
          </section>
          ` : ''}

          <section class="eu-card">
            <header class="eu-card-head">
              <div>
                <p class="eu-card-eyebrow">Identidad visual</p>
                <h3 class="eu-card-title">${esUsuarioEmpresa ? 'Logo de la empresa' : 'Fotografía y firma digital'}</h3>
              </div>
              <div class="eu-card-hero"><i class="fas ${esUsuarioEmpresa ? 'fa-image' : 'fa-camera'}"></i></div>
            </header>

            ${esUsuarioEmpresa ? `
            <div class="eu-media-section">
              <div class="eu-media-header">
                <i class="fas fa-image"></i>
                <span>Logo Empresa</span>
                <span class="eu-badge">JPG · PNG</span>
              </div>
              <div class="eu-media-body">
                ${logoEmpresaActualHtml}
                <div id="logo-dropzone-edit" class="eu-dropzone" style="margin-top:${logoEmpresaPreviewUrl ? '0.45rem' : '0'};">
                  <input id="swal-logo-edit" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;">
                  <div id="logo-placeholder-edit">
                    <i class="fas fa-cloud-upload-alt dz-icon"></i>
                    <p>${logoEmpresaPreviewUrl ? 'Cambiar logo' : 'Clic o arrastra el logo'}</p>
                    <small>Opcional</small>
                  </div>
                  <div id="logo-preview-edit" class="eu-dz-preview">
                    <img id="logo-preview-img-edit" src="" alt="Logo Empresa">
                    <p id="logo-filename-edit" class="eu-preview-name"></p>
                    <button type="button" id="logo-remove-edit" class="eu-remove-btn"><i class="fas fa-trash-alt"></i> Quitar</button>
                  </div>
                </div>
              </div>
            </div>
            ` : `
            <div class="eu-media-grid">
              <div class="eu-media-section">
                <div class="eu-media-header">
                  <i class="fas fa-camera"></i>
                  <span>Fotografía</span>
                  <span class="eu-badge">JPG · PNG</span>
                </div>
                <div class="eu-media-body">
                  ${fotoActualHtml}
                  <div id="foto-dropzone-edit" class="eu-dropzone" style="margin-top:${usuario.foto_drive_id ? '0.45rem' : '0'};">
                    <input id="swal-foto-edit" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;">
                    <div id="foto-placeholder-edit">
                      <i class="fas fa-cloud-upload-alt dz-icon"></i>
                      <p>${usuario.foto_drive_id ? 'Cambiar foto' : 'Clic o arrastra la foto'}</p>
                      <small>Opcional</small>
                    </div>
                    <div id="foto-preview-edit" class="eu-dz-preview">
                      <img id="foto-preview-img-edit" src="" alt="Foto">
                      <p id="foto-filename-edit" class="eu-preview-name"></p>
                      <button type="button" id="foto-remove-edit" class="eu-remove-btn"><i class="fas fa-trash-alt"></i> Quitar</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="eu-media-section">
                <div class="eu-media-header">
                  <i class="fas fa-signature"></i>
                  <span>Firma Digital <em id="firma-edit-required" style="display:none;">*</em></span>
                  <span class="eu-badge">JPG · WebP</span>
                </div>
                <div class="eu-media-body">
                  ${firmaActualHtml}
                  <div id="firma-dropzone-edit" class="eu-dropzone" style="margin-top:${usuario.firma_drive_id ? '0.45rem' : '0'};">
                    <input id="swal-firma-edit" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;">
                    <div id="firma-placeholder-edit">
                      <i class="fas fa-cloud-upload-alt dz-icon"></i>
                      <p>${usuario.firma_drive_id ? 'Cambiar firma' : 'Clic o arrastra la imagen'}</p>
                      <small id="firma-edit-hint">Opcional</small>
                    </div>
                    <div id="firma-preview-edit" class="eu-dz-preview">
                      <img id="firma-preview-img-edit" src="" alt="Firma">
                      <p id="firma-filename-edit" class="eu-preview-name"></p>
                      <button type="button" id="firma-remove-edit" class="eu-remove-btn"><i class="fas fa-trash-alt"></i> Quitar</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            `}

            <p class="eu-footnote"><i class="fas fa-info-circle"></i> Los campos marcados con <em>*</em> son obligatorios. La fotografía es opcional. La firma digital es obligatoria para Instructor y Doctor.</p>
          </section>

        </div>
      </div>
    `;

    const { value: formValues } = await Swal.fire({
      title: '',
      html: htmlForm,
      width: '720px',
      padding: 0,
      backdrop: 'rgba(15, 23, 42, 0.42)',
      focusConfirm: false,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      showCancelButton: true,
      heightAuto: false,
      confirmButtonText: '<i class="fas fa-check"></i> Guardar',
      cancelButtonText: '<i class="fas fa-times"></i> Cancelar',
      buttonsStyling: false,
      customClass: {
        popup: 'eu-modal-popup',
        htmlContainer: 'eu-modal-html',
        actions: 'eu-modal-actions',
        confirmButton: 'eu-modal-confirm',
        cancelButton: 'eu-modal-cancel',
        validationMessage: 'eu-modal-validation'
      },
      didOpen: () => {
        const popup = Swal.getPopup();
        const html = Swal.getHtmlContainer();
        const actions = Swal.getActions();
        if (popup && html) {
          const actionsH = actions ? actions.offsetHeight : 0;
          html.style.maxHeight = `${Math.max(280, popup.clientHeight - actionsH)}px`;
          html.style.overflowY = 'auto';
          html.style.textAlign = 'left';
        }

        // ── Helper: obtener roles seleccionados en edición ──
        const getSelectedRolesEdit = (): string[] => {
          const checked = document.querySelectorAll('#roles-checkboxes-edit .rol-check:checked') as NodeListOf<HTMLInputElement>;
          return Array.from(checked).map(cb => cb.getAttribute('data-nombre') || '');
        };

        // ── Firma obligatoria solo para instructor y doctor ──
        const toggleByRolesEdit = () => {
          const roles = esUsuarioEmpresa ? [] : getSelectedRolesEdit();
          const firmaObligatoria = this.requiereFirmaObligatoria(roles);
          const reqMark = document.getElementById('firma-edit-required');
          const firmaHint = document.getElementById('firma-edit-hint');
          if (reqMark) reqMark.style.display = firmaObligatoria ? 'inline' : 'none';
          if (firmaHint) firmaHint.textContent = firmaObligatoria && !usuario.firma_drive_id
            ? 'Obligatoria para Instructor y Doctor'
            : 'Opcional';
        };

        document.getElementById('eu-edit-close')?.addEventListener('click', () => Swal.close());
        if (!esUsuarioEmpresa) {
          this.bindOrganigramaCombobox();
          this.bindAreaDepartamentoCombobox();
        }

        // ── Configurar checkboxes de roles ──
        if (!esUsuarioEmpresa) {
          this.bindRolTags('roles-checkboxes-edit', 'roles-count-edit', () => toggleByRolesEdit());
          toggleByRolesEdit();
        }

        // ── Helper: setup genérico de dropzone ──
        const setupDz = (
          dzId: string, inputId: string, placeholderId: string,
          previewId: string, previewImgId: string, filenameId: string, removeBtnId: string
        ) => {
          const dz = document.getElementById(dzId);
          const inp = document.getElementById(inputId) as HTMLInputElement;
          const placeholder = document.getElementById(placeholderId);
          const preview = document.getElementById(previewId);
          const previewImg = document.getElementById(previewImgId) as HTMLImageElement;
          const filename = document.getElementById(filenameId);
          const removeBtn = document.getElementById(removeBtnId);
          if (!dz || !inp) return;

          const showPreview = (file: File) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (previewImg) previewImg.src = ev.target?.result as string;
              if (placeholder) placeholder.style.display = 'none';
              if (preview) (preview as HTMLElement).style.display = 'flex';
              if (filename) filename.textContent = file.name;
              dz.style.borderColor = '#38512F';
              dz.style.background = 'rgba(56,81,47,0.05)';
            };
            reader.readAsDataURL(file);
          };

          dz.addEventListener('click', (ev) => {
            if ((ev.target as HTMLElement).id !== removeBtnId && !(ev.target as HTMLElement).closest(`#${removeBtnId}`)) {
              inp.click();
            }
          });
          inp.addEventListener('change', () => { if (inp.files?.[0]) showPreview(inp.files[0]); });
          dz.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            dz.style.borderColor = '#38512F';
            dz.style.background = 'rgba(56,81,47,0.08)';
          });
          dz.addEventListener('dragleave', () => {
            dz.style.borderColor = '#C2D1B2';
            dz.style.background = '#f8f9fa';
          });
          dz.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const file = (ev as DragEvent).dataTransfer?.files[0];
            if (file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
              const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files;
              showPreview(file);
            }
          });
          if (removeBtn) {
            removeBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              inp.value = '';
              if (placeholder) placeholder.style.display = 'flex';
              if (preview) (preview as HTMLElement).style.display = 'none';
              dz.style.borderColor = '#C2D1B2';
              dz.style.background = '#f8f9fa';
            });
          }
        };

        // Inicializar dropzones
        setupDz('foto-dropzone-edit', 'swal-foto-edit', 'foto-placeholder-edit', 'foto-preview-edit', 'foto-preview-img-edit', 'foto-filename-edit', 'foto-remove-edit');
        setupDz('firma-dropzone-edit', 'swal-firma-edit', 'firma-placeholder-edit', 'firma-preview-edit', 'firma-preview-img-edit', 'firma-filename-edit', 'firma-remove-edit');
        if (esUsuarioEmpresa) {
          setupDz('logo-dropzone-edit', 'swal-logo-edit', 'logo-placeholder-edit', 'logo-preview-edit', 'logo-preview-img-edit', 'logo-filename-edit', 'logo-remove-edit');

          const rfcEmpresaInput = document.getElementById('swal-rfc-empresa') as HTMLInputElement | null;
          rfcEmpresaInput?.addEventListener('input', () => {
            rfcEmpresaInput.value = rfcEmpresaInput.value.toUpperCase();
          });

          const servicioProteccionCivilInput = document.getElementById('swal-servicio-proteccion-civil') as HTMLInputElement | null;
          const servicioProteccionCivilStatus = document.getElementById('swal-pc-status');
          const actualizarEstadoServicioPC = () => {
            if (!servicioProteccionCivilInput || !servicioProteccionCivilStatus) return;
            const activo = servicioProteccionCivilInput.checked;
            servicioProteccionCivilStatus.textContent = activo ? 'Activo' : 'Inactivo';
            servicioProteccionCivilStatus.classList.toggle('on', activo);
            servicioProteccionCivilStatus.classList.toggle('off', !activo);
          };
          actualizarEstadoServicioPC();
          servicioProteccionCivilInput?.addEventListener('change', actualizarEstadoServicioPC);

          const esEmpresaColaboradoraInput = document.getElementById('swal-es-empresa-colaboradora') as HTMLInputElement | null;
          const colaboradorEmpresaWrap = document.getElementById('swal-colaborador-empresa-wrap');
          const actualizarVisibilidadColaborador = () => {
            if (!esEmpresaColaboradoraInput || !colaboradorEmpresaWrap) return;
            colaboradorEmpresaWrap.style.display = esEmpresaColaboradoraInput.checked ? '' : 'none';
          };
          actualizarVisibilidadColaborador();
          esEmpresaColaboradoraInput?.addEventListener('change', actualizarVisibilidadColaborador);
        }

        // ── Toggle contraseña colapsable ──
        if (puedeResetearPassword) {
          const pwdToggle = document.getElementById('pwd-toggle-btn');
          const pwdFields = document.getElementById('pwd-fields');
          pwdToggle?.addEventListener('click', () => {
            pwdFields?.classList.toggle('visible');
            const chevron = pwdToggle.querySelector('.fa-chevron-down') as HTMLElement;
            if (chevron) chevron.style.transform = pwdFields?.classList.contains('visible') ? 'rotate(180deg)' : '';
          });

          const passwordInput = document.getElementById('swal-password') as HTMLInputElement;
          const confirmInput = document.getElementById('swal-password-confirm') as HTMLInputElement;
          const hintError = document.getElementById('password-match-hint-edit');
          const hintOk = document.getElementById('password-ok-hint-edit');
          const togglePasswordEdit = document.getElementById('toggle-password-edit');
          const togglePasswordConfirmEdit = document.getElementById('toggle-password-confirm-edit');
          const passwordSuggestionsChipsEdit = document.getElementById('password-suggestions-chips-edit');
          const passwordSuggestionsRefreshEdit = document.getElementById('password-suggestions-refresh-edit');
          const emailPrincipalInput = document.getElementById('swal-email') as HTMLInputElement;
          const credExtraToggle = document.getElementById('swal-credenciales-extra-toggle-edit') as HTMLInputElement;
          const credExtraWrapper = document.getElementById('cred-extra-wrapper-edit') as HTMLElement;
          const credExtraContainer = document.getElementById('cred-extra-edit-container') as HTMLElement;
          const credExtraInput = document.getElementById('swal-credenciales-extra-input-edit') as HTMLInputElement;
          const credExtraAddBtn = document.getElementById('swal-credenciales-extra-add-edit') as HTMLButtonElement;
          const credExtraList = document.getElementById('swal-credenciales-extra-list-edit') as HTMLElement;
          const credExtraJson = document.getElementById('swal-credenciales-extra-json-edit') as HTMLInputElement;
          const correosExtraCredenciales: string[] = [];

          const normalizarCorreo = (correo = '') => String(correo || '').trim().toLowerCase();
          const esEmailValido = (correo = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarCorreo(correo));
          const mostrarValidacionTemporal = (mensaje: string) => {
            Swal.showValidationMessage(mensaje);
            setTimeout(() => Swal.resetValidationMessage(), 2600);
          };

          const actualizarCorreosExtraJson = () => {
            if (credExtraJson) {
              credExtraJson.value = JSON.stringify(correosExtraCredenciales);
            }
          };

          const renderCorreosExtra = () => {
            if (!credExtraList) return;
            credExtraList.innerHTML = correosExtraCredenciales
              .map((correo) => `
                <span class="cred-extra-chip">
                  ${correo}
                  <button type="button" data-correo="${correo}" aria-label="Quitar correo">
                    <i class="fas fa-times"></i>
                  </button>
                </span>
              `)
              .join('');
            actualizarCorreosExtraJson();
          };

          const agregarCorreoExtra = () => {
            const correo = normalizarCorreo(credExtraInput?.value || '');
            const correoPrincipal = normalizarCorreo(emailPrincipalInput?.value || '');

            if (!correo) return;

            if (!esEmailValido(correo)) {
              mostrarValidacionTemporal('Ingrese un correo adicional válido');
              return;
            }

            if (correoPrincipal && correo === correoPrincipal) {
              mostrarValidacionTemporal('El correo adicional no puede ser igual al correo principal');
              return;
            }

            if (correosExtraCredenciales.includes(correo)) {
              mostrarValidacionTemporal('Ese correo adicional ya fue agregado');
              return;
            }

            correosExtraCredenciales.push(correo);
            if (credExtraInput) credExtraInput.value = '';
            renderCorreosExtra();
          };

          const resetCredExtraState = () => {
            if (credExtraToggle) credExtraToggle.checked = false;
            if (credExtraContainer) credExtraContainer.style.display = 'none';
            correosExtraCredenciales.length = 0;
            if (credExtraInput) credExtraInput.value = '';
            renderCorreosExtra();
          };

          const shouldShowCredExtras = () => {
            const hasPassword = Boolean(passwordInput?.value || confirmInput?.value);
            return hasPassword;
          };

          const updateCredExtraVisibility = () => {
            if (!credExtraWrapper) return;
            const shouldShow = shouldShowCredExtras();
            credExtraWrapper.style.display = shouldShow ? 'block' : 'none';
            if (!shouldShow) {
              resetCredExtraState();
            }
          };

          if (credExtraToggle && credExtraContainer) {
            credExtraToggle.addEventListener('change', () => {
              credExtraContainer.style.display = credExtraToggle.checked ? 'block' : 'none';
              if (!credExtraToggle.checked) {
                correosExtraCredenciales.length = 0;
                if (credExtraInput) credExtraInput.value = '';
                renderCorreosExtra();
              }
            });
          }

          credExtraAddBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            agregarCorreoExtra();
          });

          credExtraInput?.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              agregarCorreoExtra();
            }
          });

          credExtraList?.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const button = target.closest('button[data-correo]') as HTMLButtonElement | null;
            if (!button) return;
            const correo = normalizarCorreo(button.getAttribute('data-correo') || '');
            const idx = correosExtraCredenciales.indexOf(correo);
            if (idx >= 0) {
              correosExtraCredenciales.splice(idx, 1);
              renderCorreosExtra();
            }
          });

          renderCorreosExtra();
          updateCredExtraVisibility();

          const bindPasswordToggle = (btn: HTMLElement | null, input: HTMLInputElement | null) => {
            if (!btn || !input) return;
            btn.addEventListener('click', () => {
              const isHidden = input.style.getPropertyValue('-webkit-text-security') === 'disc';
              input.style.setProperty('-webkit-text-security', isHidden ? 'none' : 'disc');
              input.style.setProperty('text-security', isHidden ? 'none' : 'disc');
              const icon = btn.querySelector('i');
              if (icon) {
                icon.classList.toggle('fa-eye', !isHidden);
                icon.classList.toggle('fa-eye-slash', isHidden);
              }
            });
          };

          bindPasswordToggle(togglePasswordEdit as HTMLElement, passwordInput);
          bindPasswordToggle(togglePasswordConfirmEdit as HTMLElement, confirmInput);

          if (passwordInput && confirmInput) {
            const validatePwd = () => {
              const p = passwordInput.value, c = confirmInput.value;
              if (!p && !c) { hintError!.style.display = 'none'; hintOk!.style.display = 'none'; }
              else if (p === c && p.length >= 8) { hintError!.style.display = 'none'; hintOk!.style.display = 'block'; }
              else if (c.length > 0) { hintError!.style.display = 'block'; hintOk!.style.display = 'none'; }
            };

            const renderPasswordSuggestionsEdit = () => {
              if (!passwordSuggestionsChipsEdit) return;
              const suggestions = this.generarSugerenciasPassword();
              passwordSuggestionsChipsEdit.innerHTML = suggestions.map((sugerencia) => `
                <button
                  type="button"
                  class="password-suggestions__chip"
                  data-password="${sugerencia}">
                  ${sugerencia}
                </button>
              `).join('');

              const suggestionButtons = passwordSuggestionsChipsEdit.querySelectorAll('.password-suggestions__chip') as NodeListOf<HTMLButtonElement>;
              suggestionButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                  const password = btn.dataset.password || '';
                  passwordInput.value = password;
                  confirmInput.value = password;
                  validatePwd();
                  updateCredExtraVisibility();
                });
              });
            };

            passwordSuggestionsRefreshEdit?.addEventListener('click', (event) => {
              event.preventDefault();
              renderPasswordSuggestionsEdit();
            });

            renderPasswordSuggestionsEdit();

            passwordInput.addEventListener('input', () => {
              validatePwd();
              updateCredExtraVisibility();
            });
            confirmInput.addEventListener('input', () => {
              validatePwd();
              updateCredExtraVisibility();
            });
          }

        }
      },
      preConfirm: async () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement).value;
        const apellido = (document.getElementById('swal-apellido') as HTMLInputElement).value;
        const email = (document.getElementById('swal-email') as HTMLInputElement).value;
        const telefono = (document.getElementById('swal-telefono') as HTMLInputElement).value;
        const password = puedeResetearPassword ? (document.getElementById('swal-password') as HTMLInputElement)?.value : null;
        const passwordConfirm = puedeResetearPassword ? (document.getElementById('swal-password-confirm') as HTMLInputElement)?.value : null;
        const credExtraToggle = puedeResetearPassword
          ? (document.getElementById('swal-credenciales-extra-toggle-edit') as HTMLInputElement | null)
          : null;
        const credExtraInput = puedeResetearPassword
          ? (document.getElementById('swal-credenciales-extra-input-edit') as HTMLInputElement | null)
          : null;
        const credExtraJson = puedeResetearPassword
          ? (document.getElementById('swal-credenciales-extra-json-edit') as HTMLInputElement | null)
          : null;
        const servicioProteccionCivil = esUsuarioEmpresa
          ? (document.getElementById('swal-servicio-proteccion-civil') as HTMLInputElement | null)?.checked
          : undefined;
        const puestoEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-puesto-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const esEmpresaColaboradora = esUsuarioEmpresa
          ? (document.getElementById('swal-es-empresa-colaboradora') as HTMLInputElement | null)?.checked
          : undefined;
        const empresaColaboradorPadre = esUsuarioEmpresa
          ? (document.getElementById('swal-empresa-colaborador-padre') as HTMLSelectElement | null)?.value
          : undefined;
        const nombreEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-nombre-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const rfcEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-rfc-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const razonSocialEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-razon-social-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const cpEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-cp-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const estadoEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-estado-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const ciudadEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-ciudad-empresa') as HTMLInputElement | null)?.value
          : undefined;
        const direccionEmpresa = esUsuarioEmpresa
          ? (document.getElementById('swal-direccion-empresa') as HTMLInputElement | null)?.value
          : undefined;

        // Obtener roles seleccionados
        let rol_id: string;
        let selectedRolNombres: string[] = [];
        let rolesAdicionales = '';
        if (esUsuarioEmpresa) {
          rol_id = String(usuario.rol_id);
          selectedRolNombres = ['empresa'];
        } else {
          const rolesChecked = document.querySelectorAll('#roles-checkboxes-edit .rol-check:checked') as NodeListOf<HTMLInputElement>;
          const selectedRolIds = Array.from(rolesChecked).map(cb => parseInt(cb.value));
          selectedRolNombres = Array.from(rolesChecked).map(cb => cb.getAttribute('data-nombre') || '');
          if (selectedRolIds.length === 0) {
            Swal.showValidationMessage('Debe seleccionar al menos un rol');
            return false;
          }
          rol_id = String(selectedRolIds[0]);
          rolesAdicionales = selectedRolNombres.slice(1).join(',');
        }
        const esInstructorSel = selectedRolNombres.includes('instructor');

        // Para instructores, asignar todas las áreas temáticas por defecto
        let areas_ids: number[] = [];
        if (esInstructorSel) {
          const todasLasAreasIds = Array.from(new Set(
            this.areasTematicas
              .map((area: any) => Number(area?.area_id))
              .filter((areaId: number) => !isNaN(areaId) && areaId > 0)
          ));
          areas_ids = todasLasAreasIds.length > 0 ? todasLasAreasIds : [...areasActuales];

          if (areas_ids.length === 0) {
            Swal.showValidationMessage('No se pudieron cargar las áreas temáticas para asignar al instructor');
            return false;
          }
        }

        // Obtener archivos si se subieron
        let firmaFile: File | null = null;
        let fotoFile: File | null = null;
        let logoFile: File | null = null;
        if (!esUsuarioEmpresa) {
          firmaFile = (document.getElementById('swal-firma-edit') as HTMLInputElement)?.files?.[0] || null;
          fotoFile  = (document.getElementById('swal-foto-edit')  as HTMLInputElement)?.files?.[0] || null;
        }
        if (esUsuarioEmpresa) {
          logoFile = (document.getElementById('swal-logo-edit') as HTMLInputElement)?.files?.[0] || null;
        }
        const organigrama = !esUsuarioEmpresa
          ? String((document.getElementById('swal-organigrama') as HTMLInputElement)?.value || '').trim()
          : undefined;
        const area_departamento = !esUsuarioEmpresa
          ? String((document.getElementById('swal-area-departamento') as HTMLInputElement)?.value || '').trim()
          : undefined;

        // Validaciones
        if (!nombre || nombre.trim() === '') {
          Swal.showValidationMessage('El nombre es obligatorio');
          return false;
        }
        if (esUsuarioEmpresa) {
          const nombreEmpresaTrim = String(nombreEmpresa || '').trim();
          const rfcEmpresaTrim = String(rfcEmpresa || '').trim().toUpperCase();
          if (!nombreEmpresaTrim) {
            Swal.showValidationMessage('El nombre de la empresa es obligatorio');
            return false;
          }
          if (!rfcEmpresaTrim || rfcEmpresaTrim.length < 12 || rfcEmpresaTrim.length > 13) {
            Swal.showValidationMessage('El RFC debe tener entre 12 y 13 caracteres');
            return false;
          }
        }
        if (esUsuarioEmpresa && esEmpresaColaboradora && !empresaColaboradorPadre) {
          Swal.showValidationMessage('Seleccione la empresa principal para la empresa colaboradora');
          return false;
        }
        if (!esUsuarioEmpresa && this.requiereFirmaObligatoria(selectedRolNombres) && !usuario.firma_drive_id && !firmaFile) {
          Swal.showValidationMessage('La firma digital es obligatoria para Instructor y Doctor');
          return false;
        }
        if (password && password.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener mínimo 8 caracteres');
          return false;
        }
        if (password && password !== passwordConfirm) {
          Swal.showValidationMessage('Las contraseñas no coinciden');
          return false;
        }

        const normalizarCorreo = (correo = '') => String(correo || '').trim().toLowerCase();
        const esEmailValido = (correo = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarCorreo(correo));
        const correoOriginal = normalizarCorreo(emailEfectivo || '');
        const correoActual = normalizarCorreo(email || '');
        const huboCambioCorreo = correoActual !== '' && correoActual !== correoOriginal;
        const hayCambioPassword = Boolean(password && String(password).trim());
        const usarUpdateParaPassword = hayCambioPassword && huboCambioCorreo;
        let correosExtrasCredenciales: string[] = [];

        try {
          const parsed = JSON.parse(credExtraJson?.value || '[]');
          if (Array.isArray(parsed)) {
            correosExtrasCredenciales = parsed
              .map((correo: any) => normalizarCorreo(String(correo || '')))
              .filter((correo: string, index: number, arr: string[]) => correo && arr.indexOf(correo) === index);
          }
        } catch (_) {
          correosExtrasCredenciales = [];
        }

        const correoPendiente = normalizarCorreo(credExtraInput?.value || '');
        const correoPrincipal = normalizarCorreo(email);
        if (correoPendiente) {
          if (!esEmailValido(correoPendiente)) {
            Swal.showValidationMessage('El correo adicional no tiene un formato válido');
            return false;
          }
          if (correoPrincipal && correoPendiente === correoPrincipal) {
            Swal.showValidationMessage('El correo adicional no puede ser igual al correo principal');
            return false;
          }
          if (!correosExtrasCredenciales.includes(correoPendiente)) {
            correosExtrasCredenciales.push(correoPendiente);
          }
        }

        if (credExtraToggle?.checked) {
          if (!hayCambioPassword && !huboCambioCorreo) {
            Swal.showValidationMessage('No hay cambios de credenciales para enviar');
            return false;
          }
          if (correosExtrasCredenciales.length === 0) {
            Swal.showValidationMessage('Agregue al menos un correo adicional para enviar credenciales');
            return false;
          }
        }

        const correosExtrasParaEnvio = credExtraToggle?.checked ? correosExtrasCredenciales : [];

        const datos: any = {
          nombre: nombre.trim(),
          apellidos: apellido.trim(),
          email: email.trim(),
          telefono: telefono.trim(),
          rol_id,
          roles_adicionales: rolesAdicionales
        };
        if (!esUsuarioEmpresa && organigrama !== undefined) {
          datos.organigrama = organigrama;
        }
        if (!esUsuarioEmpresa && area_departamento !== undefined) {
          datos.area_departamento = area_departamento;
        }
        if (esUsuarioEmpresa && servicioProteccionCivil !== undefined) {
          datos.servicio_proteccion_civil = servicioProteccionCivil ? 1 : 0;
        }
        if (esUsuarioEmpresa && puestoEmpresa !== undefined) {
          datos.empresa_puesto = puestoEmpresa.trim();
        }
        if (esUsuarioEmpresa && esEmpresaColaboradora !== undefined) {
          datos.empresa_colaborador = esEmpresaColaboradora && empresaColaboradorPadre
            ? empresaColaboradorPadre
            : '';
        }
        if (esInstructorSel) datos.areas = areas_ids;
        if (firmaFile) datos.firmaFile = firmaFile;
        if (fotoFile)  datos.fotoFile  = fotoFile;
        if (logoFile)  datos.logoFile  = logoFile;
        if (puedeResetearPassword && usarUpdateParaPassword) datos.nueva_password = password;
        if (huboCambioCorreo && correosExtrasParaEnvio.length > 0) {
          datos.credenciales_correos_extra = correosExtrasParaEnvio;
        }

        try {
          if (puedeResetearPassword && hayCambioPassword && !usarUpdateParaPassword) {
            const respuestaPassword = await firstValueFrom(
              this.backendService.resetearPassword(usuario.id, password, correosExtrasParaEnvio)
            );
            if (!respuestaPassword?.success) {
              Swal.showValidationMessage(respuestaPassword?.message || 'No se pudo cambiar la contraseña');
              return false;
            }
          }

          const payloadActualizacion = this.prepararPayloadActualizacionUsuario(datos);
          const respuestaActualizacion = await firstValueFrom(this.backendService.actualizarUsuario(usuario.id, payloadActualizacion));

          if (!respuestaActualizacion?.success) {
            Swal.showValidationMessage(respuestaActualizacion?.message || 'No se pudo actualizar el usuario');
            return false;
          }

          if (esUsuarioEmpresa && Number(usuario.empresa_id || 0) > 0) {
            const payloadEmpresa: Record<string, string> = {
              nombre_empresa: String(nombreEmpresa || '').trim(),
              rfc: String(rfcEmpresa || '').trim().toUpperCase(),
              razon_social: String(razonSocialEmpresa || '').trim(),
              codigo_postal: String(cpEmpresa || '').trim(),
              estado: String(estadoEmpresa || '').trim(),
              ciudad: String(ciudadEmpresa || '').trim(),
              direccion: String(direccionEmpresa || '').trim()
            };

            const respuestaEmpresa = await firstValueFrom(
              this.backendService.actualizarEmpresa(Number(usuario.empresa_id), payloadEmpresa)
            );
            if (!respuestaEmpresa?.success) {
              Swal.showValidationMessage(respuestaEmpresa?.message || 'No se pudieron actualizar los datos de la empresa');
              return false;
            }
          }

          return {
            success: true,
            message: respuestaActualizacion?.message || 'Usuario actualizado correctamente'
          };
        } catch (error: any) {
          const mensajeApi = error?.error?.message || error?.message || 'Error al actualizar el usuario';
          const esCorreoDuplicado = error?.status === 409 || /correo|email/i.test(String(mensajeApi || ''));
          Swal.showValidationMessage(esCorreoDuplicado
            ? (mensajeApi || 'Ese correo ya se encuentra asociado a otra cuenta.')
            : mensajeApi
          );
          return false;
        }
      }
    });

    if (formValues?.success) {
      Swal.fire({
        title: '¡Actualizado!',
        text: formValues.message || 'Usuario actualizado correctamente',
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
      this.cargarUsuarios();
    }
  }

  private prepararPayloadActualizacionUsuario(datos: any): any {
    const datosSinPassword = { ...datos };

    let payload: any = datosSinPassword;

    if (datosSinPassword.firmaFile || datosSinPassword.fotoFile || datosSinPassword.logoFile) {
      const formData = new FormData();
      formData.append('nombre', datosSinPassword.nombre || '');
      formData.append('apellidos', datosSinPassword.apellidos || '');
      formData.append('email', datosSinPassword.email || '');
      formData.append('telefono', datosSinPassword.telefono || '');
      formData.append('rol_id', String(datosSinPassword.rol_id || ''));
      if (datosSinPassword.organigrama !== undefined) {
        formData.append('organigrama', datosSinPassword.organigrama || '');
      }
      if (datosSinPassword.area_departamento !== undefined) {
        formData.append('area_departamento', datosSinPassword.area_departamento || '');
      }
      if (datosSinPassword.roles_adicionales !== undefined) {
        formData.append('roles_adicionales', datosSinPassword.roles_adicionales);
      }
      if (datosSinPassword.areas !== undefined) {
        formData.append('areas', JSON.stringify(datosSinPassword.areas));
      }
      if (datosSinPassword.servicio_proteccion_civil !== undefined) {
        formData.append('servicio_proteccion_civil', String(datosSinPassword.servicio_proteccion_civil));
      }
      if (datosSinPassword.empresa_puesto !== undefined) {
        formData.append('empresa_puesto', datosSinPassword.empresa_puesto);
      }
      if (datosSinPassword.empresa_colaborador !== undefined) {
        formData.append('empresa_colaborador', String(datosSinPassword.empresa_colaborador));
      }
      if (datosSinPassword.credenciales_correos_extra !== undefined) {
        const extras = datosSinPassword.credenciales_correos_extra;
        formData.append('credenciales_correos_extra', Array.isArray(extras) ? JSON.stringify(extras) : String(extras));
      }
      if (datosSinPassword.nueva_password !== undefined) {
        formData.append('nueva_password', String(datosSinPassword.nueva_password));
      }
      if (datosSinPassword.firmaFile) formData.append('firma', datosSinPassword.firmaFile);
      if (datosSinPassword.fotoFile) formData.append('foto', datosSinPassword.fotoFile);
      if (datosSinPassword.logoFile) formData.append('logo', datosSinPassword.logoFile);
      payload = formData;
    }

    return payload;
  }

  async editarEmpresaColaboradora(entrada: any) {
    let empresasPrincipales: any[] = [];
    try {
      const respuestaEmpresas = await firstValueFrom(this.backendService.obtenerEmpresas());
      if (respuestaEmpresas?.success) {
        const empresaActualId = Number(entrada.empresa_id || 0);
        empresasPrincipales = (respuestaEmpresas.empresas || []).filter((empresa: any) => {
          const empresaId = Number(empresa?.empresa_id || 0);
          return empresaId > 0 && !empresa?.colaborador && empresaId !== empresaActualId;
        });
      }
    } catch (_) {
      empresasPrincipales = [];
    }

    const colaboradorActual = Number(entrada.empresa_colaborador || 0) || null;
    const opcionesEmpresasPrincipalesHtml = empresasPrincipales
      .map((empresa: any) => {
        const empresaId = Number(empresa.empresa_id);
        const selected = colaboradorActual === empresaId ? 'selected' : '';
        return `<option value="${empresaId}" ${selected}>${empresa.nombre_empresa}</option>`;
      })
      .join('');
    const servicioPcActivo = Boolean(Number(entrada.servicio_proteccion_civil));

    const resultado = await Swal.fire({
      title: 'Editar empresa colaboradora',
      html: `
        <div style="text-align:left;font-family:'Open Sans',sans-serif;">
          <p style="font-size:0.82rem;color:#6c757d;margin:0 0 0.75rem;">
            <strong>${entrada.nombre_empresa || 'Empresa'}</strong><br>
            <span style="font-size:0.75rem;">Acceso compartido: ${entrada.acceso_compartido_label || 'empresa principal'}</span>
          </p>
          <label style="display:block;font-size:0.68rem;font-weight:700;color:#6c757d;text-transform:uppercase;margin-bottom:0.25rem;">Empresa principal</label>
          <select id="swal-colab-padre" class="swal2-input" style="width:100%;margin:0 0 0.75rem;padding:0.45rem 0.6rem;">
            <option value="">Seleccione empresa principal</option>
            ${opcionesEmpresasPrincipalesHtml}
          </select>
          <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.82rem;color:#2f4630;cursor:pointer;">
            <input type="checkbox" id="swal-colab-pc" ${servicioPcActivo ? 'checked' : ''}>
            Servicio de Protección Civil
          </label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2',
      focusConfirm: false,
      preConfirm: () => {
        const empresaColaboradorPadre = (document.getElementById('swal-colab-padre') as HTMLSelectElement)?.value;
        const servicioProteccionCivil = (document.getElementById('swal-colab-pc') as HTMLInputElement)?.checked;
        if (!empresaColaboradorPadre) {
          Swal.showValidationMessage('Seleccione la empresa principal');
          return false;
        }
        return { empresaColaboradorPadre, servicioProteccionCivil };
      }
    });

    if (!resultado.isConfirmed || !resultado.value) {
      return;
    }

    const { empresaColaboradorPadre, servicioProteccionCivil } = resultado.value;
    try {
      const respuesta = await firstValueFrom(
        this.backendService.actualizarEmpresa(Number(entrada.empresa_id), {
          colaborador: empresaColaboradorPadre,
          servicio_proteccion_civil: servicioProteccionCivil ? 1 : 0
        })
      );
      if (respuesta?.success) {
        Swal.fire({
          title: 'Actualizado',
          text: 'Empresa colaboradora actualizada correctamente',
          icon: 'success',
          confirmButtonColor: '#38512F'
        });
        this.cargarUsuarios();
      } else {
        Swal.fire('Error', respuesta?.message || 'No se pudo actualizar la empresa', 'error');
      }
    } catch (error) {
      console.error('Error al actualizar empresa colaboradora:', error);
      Swal.fire('Error', 'No se pudo actualizar la empresa colaboradora', 'error');
    }
  }

  eliminarUsuario(usuario: any) {
    // Solo root puede eliminar usuarios
    if (!this.esRoot) {
      Swal.fire({
        title: 'Acceso Denegado',
        text: 'Solo el usuario root puede eliminar usuarios',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (usuario?.es_empresa_colaboradora_sin_usuario) {
      Swal.fire({
        title: '¿Eliminar empresa colaboradora?',
        html: `¿Está seguro de ocultar la empresa <strong>${usuario.nombre_empresa}</strong>?<br><small class="text-muted">No se elimina el usuario de la empresa principal.</small>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#f5365c',
        cancelButtonColor: '#A8A9A2',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
      }).then((result) => {
        if (!result.isConfirmed) {
          return;
        }
        this.backendService.eliminarEmpresa(Number(usuario.empresa_id)).subscribe({
          next: (res: any) => {
            if (res.success) {
              Swal.fire({
                title: '¡Eliminado!',
                text: 'Empresa colaboradora eliminada correctamente',
                icon: 'success',
                confirmButtonColor: '#38512F'
              });
              this.cargarUsuarios();
            } else {
              Swal.fire('Error', res.message || 'No se pudo eliminar', 'error');
            }
          },
          error: () => Swal.fire('Error', 'Error al eliminar la empresa colaboradora', 'error')
        });
      });
      return;
    }

    Swal.fire({
      title: '¿Eliminar usuario?',
      html: `¿Está seguro de eliminar el usuario <strong>${usuario.username}</strong>?<br><small class="text-muted">Esta acción no se puede deshacer.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        // Validar que el ID existe
        if (!usuario.id) {
          console.error('❌ Error: usuario.id es undefined', usuario);
          Swal.fire({
            title: 'Error',
            text: 'ID de usuario no válido',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
          return;
        }

        Swal.fire({
          title: 'Eliminando usuario...',
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => Swal.showLoading()
        });

        this.backendService.eliminarUsuario(usuario.id).subscribe({
          next: (res: any) => {
            if (res.success) {
              Swal.fire({
                title: '¡Eliminado!',
                text: 'Usuario eliminado correctamente',
                icon: 'success',
                confirmButtonColor: '#38512F'
              });
              this.cargarUsuarios();
            } else {
              Swal.fire({
                title: 'Error',
                text: res.message || 'No se pudo eliminar',
                icon: 'error',
                confirmButtonColor: '#38512F'
              });
            }
          },
          error: (err) => {
            console.error('❌ Error al eliminar usuario:', err);
            console.error('URL intentada:', err.url);
            Swal.fire({
              title: 'Error',
              text: 'Error al eliminar el usuario',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        });
      }
    });
  }
}
