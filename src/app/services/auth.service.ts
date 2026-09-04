import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Usuario {
  usuario_id: number;
  username: string;
  nombre?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  email?: string;
  rol_id?: number;
  rol_nombre?: string;
  roles?: string[];  // Array de roles (multi-rol)
  telefono?: string;
  permisos?: string;
  empresa_id?: number;
  empresa_servicio_proteccion_civil?: number;
  instructor_id?: number;
  foto_drive_id?: string;
  sgc_editor_delegado?: boolean;
  // Alias para compatibilidad hacia atrás
  id?: number;
  apellido?: string;
  rol?: string;
}

// Roles del sistema
export type RolUsuario = 'Administrador' | 'Coordinador' | 'Instructor' | 'Doctor' | 'Empresa' | 'Usuario';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private usuarioActualSubject: BehaviorSubject<Usuario | null>;
  public usuarioActual: Observable<Usuario | null>;
  private readonly STORAGE_KEY = 'currentUser';
  private readonly SESSION_EXPIRY_KEY = 'sessionExpiry';
  private readonly TOKEN_KEY = 'auth_token';
  private readonly SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos
  /** Cache en memoria: usuario delegado en al menos un formato SGC. */
  private editorSgcDelegado = false;
  /** Formatos concretos en los que el usuario está delegado como editor. */
  private formatosSgcDelegados = new Set<string>();

  constructor() {
    // Intenta recuperar el usuario del localStorage al iniciar (sesión persistente en el dispositivo)
    const storedUser = this.getStoredUser();
    this.editorSgcDelegado = !!storedUser?.sgc_editor_delegado;
    this.usuarioActualSubject = new BehaviorSubject<Usuario | null>(storedUser);
    this.usuarioActual = this.usuarioActualSubject.asObservable();
    
    // Verificar expiración de sesión
    this.checkSessionExpiry();
  }

  /**
   * Obtiene el valor actual del usuario logueado
   */
  public get usuarioActualValue(): Usuario | null {
    return this.usuarioActualSubject.value;
  }

  /**
   * Guarda el usuario después de un login exitoso
   * Solo guarda información NO sensible (sin contraseña)
   */
  public setUsuario(usuario: any): void {
    // Crear objeto limpio sin información sensible
    // Compatible con la nueva estructura de la BD
    // Construir array de roles: si el backend envía 'roles' array usarlo, si no, derivar del rol único
    let rolesArray: string[] = [];
    if (Array.isArray(usuario.roles) && usuario.roles.length > 0) {
      rolesArray = usuario.roles.map((r: string) => r.toLowerCase());
    } else {
      const rolPrimario = (usuario.rol_nombre || usuario.rol || '').toLowerCase();
      if (rolPrimario) rolesArray = [rolPrimario];
    }

    const usuarioSeguro: Usuario = {
      usuario_id: usuario.usuario_id || usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      apellido_paterno: usuario.apellido_paterno || usuario.apellido,
      apellido_materno: usuario.apellido_materno,
      email: usuario.email,
      rol_id: usuario.rol_id,
      rol_nombre: usuario.rol_nombre || usuario.rol,
      roles: rolesArray,
      telefono: usuario.telefono,
      permisos: usuario.permisos,
      empresa_id: usuario.empresa_id,
      empresa_servicio_proteccion_civil: Number(usuario.empresa_servicio_proteccion_civil ?? 1),
      instructor_id: usuario.instructor_id,
      foto_drive_id: usuario.foto_drive_id || null,
      sgc_editor_delegado: !!usuario.sgc_editor_delegado,
      // Aliases para compatibilidad
      id: usuario.usuario_id || usuario.id,
      apellido: usuario.apellido_paterno || usuario.apellido,
      rol: usuario.rol_nombre || usuario.rol
    };

    this.editorSgcDelegado = !!usuarioSeguro.sgc_editor_delegado;

    // Guardar en localStorage para que la sesión persista en el dispositivo
    // entre reinicios del navegador (se limpia al cerrar sesión)
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(usuarioSeguro));
    
    // Establecer tiempo de expiración de sesión
    const expiry = Date.now() + this.SESSION_DURATION;
    localStorage.setItem(this.SESSION_EXPIRY_KEY, expiry.toString());
    
    // Notificar a los suscriptores
    this.usuarioActualSubject.next(usuarioSeguro);
  }

  /**
   * Guarda el JWT en localStorage (persistente en el dispositivo)
   */
  public setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  /**
   * Retorna el JWT guardado, o null si no existe
   */
  public getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Obtiene el nombre completo del usuario
   */
  public getNombreCompleto(): string {
    const usuario = this.usuarioActualValue;
    if (!usuario) return 'Usuario';

    const partes = [usuario.nombre, usuario.apellido_paterno, usuario.apellido_materno].filter(Boolean);
    
    if (partes.length > 0) {
      return partes.join(' ');
    }
    
    return usuario.username;
  }

  /**
   * Obtiene el nombre de usuario
   */
  public getUsername(): string {
    const usuario = this.usuarioActualValue;
    return usuario?.username || 'Usuario';
  }

  /**
   * Obtiene el ID de empresa asociado al usuario (para usuarios de empresa)
   */
  public getEmpresaId(): number | null {
    const usuario = this.usuarioActualValue;
    return usuario?.empresa_id || null;
  }

  /**
   * Obtiene el ID de instructor asociado al usuario (para usuarios instructor)
   */
  public getInstructorId(): number | null {
    const usuario = this.usuarioActualValue;
    return usuario?.instructor_id || null;
  }

  /**
   * Verifica si el usuario es de tipo empresa
   */
  public esUsuarioEmpresa(): boolean {
    return this.tieneRol('empresa');
  }

  /** Encargado de Protección Civil (puede eliminar asignaciones completas de documentos). */
  public esEncargadoProteccionCivil(): boolean {
    return this.tieneAlgunRol(['root', 'administrador', 'proteccion_civil']);
  }

  /** SP-F-29 Control de resolutivos: solo root o administrador (no perfil PC exclusivo). */
  public puedeVerControlResolutivosPipc(): boolean {
    return this.esAdministradorOSuperior();
  }

  public empresaTieneServicioProteccionCivil(): boolean {
    const usuario = this.usuarioActualValue;
    if (!usuario) return true;
    return Number(usuario.empresa_servicio_proteccion_civil ?? 1) === 1;
  }

  /**
   * Cierra la sesión del usuario
   */
  public logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem(this.SESSION_EXPIRY_KEY);
    localStorage.removeItem(this.TOKEN_KEY);
    // Limpiar también residuos de sesiones anteriores guardadas en sessionStorage
    sessionStorage.removeItem(this.STORAGE_KEY);
    sessionStorage.removeItem(this.SESSION_EXPIRY_KEY);
    sessionStorage.removeItem(this.TOKEN_KEY);
    this.editorSgcDelegado = false;
    this.formatosSgcDelegados.clear();
    this.usuarioActualSubject.next(null);
  }

  /**
   * Verifica si hay un usuario logueado
   */
  public isLoggedIn(): boolean {
    // Verificar expiración de sesión
    if (this.isSessionExpired()) {
      this.logout();
      return false;
    }
    return this.usuarioActualValue !== null;
  }

  /**
   * Verifica si la sesión ha expirado
   */
  private isSessionExpired(): boolean {
    const expiry = localStorage.getItem(this.SESSION_EXPIRY_KEY);
    if (!expiry) return true;
    return Date.now() > parseInt(expiry, 10);
  }

  /**
   * Verifica la expiración de sesión al cargar
   */
  private checkSessionExpiry(): void {
    if (this.isSessionExpired() && this.usuarioActualSubject.value) {
      this.logout();
    }
  }

  /**
   * Renueva el tiempo de sesión
   */
  public renewSession(): void {
    if (this.isLoggedIn()) {
      const expiry = Date.now() + this.SESSION_DURATION;
      localStorage.setItem(this.SESSION_EXPIRY_KEY, expiry.toString());
    }
  }

  /**
   * Obtiene el usuario almacenado del localStorage
   * Privado - solo para uso interno
   */
  private getStoredUser(): Usuario | null {
    try {
      const userJson = localStorage.getItem(this.STORAGE_KEY);
      if (userJson) {
        return JSON.parse(userJson) as Usuario;
      }
    } catch (error) {
      console.error('Error al recuperar usuario del storage:', error);
      localStorage.removeItem(this.STORAGE_KEY);
    }
    return null;
  }

  /**
   * Obtiene el rol principal del usuario actual
   */
  public getRol(): string | undefined {
    return this.usuarioActualValue?.rol;
  }

  /**
   * Obtiene todos los roles del usuario actual (multi-rol)
   */
  public getRoles(): string[] {
    return this.usuarioActualValue?.roles || [];
  }

  /**
   * Obtiene el ID del usuario actual
   */
  public getUsuarioId(): number | undefined {
    return this.usuarioActualValue?.id || this.usuarioActualValue?.usuario_id;
  }

  /**
   * Verifica si el usuario tiene un rol específico (busca en todos sus roles)
   */
  public tieneRol(rol: string): boolean {
    const userRoles = this.getRoles();
    if (userRoles.length > 0) {
      return userRoles.some(r => r.toLowerCase() === rol.toLowerCase());
    }
    // Fallback al rol único
    const userRole = this.usuarioActualValue?.rol?.toLowerCase();
    return userRole === rol.toLowerCase();
  }

  /**
   * Verifica si el usuario tiene alguno de los roles especificados (busca en todos sus roles)
   */
  public tieneAlgunRol(roles: string[]): boolean {
    const userRoles = this.getRoles();
    if (userRoles.length > 0) {
      return roles.some(r => userRoles.includes(r.toLowerCase()));
    }
    // Fallback al rol único
    const userRole = this.usuarioActualValue?.rol?.toLowerCase();
    if (!userRole) return false;
    return roles.some(r => r.toLowerCase() === userRole);
  }

  /**
   * Verifica si el usuario es Administrador (rol: administrador)
   */
  public esAdministrador(): boolean {
    return this.tieneRol('administrador');
  }

  /**
   * Verifica si el usuario es Super Administrador (rol: root)
   * Tiene acceso total al sistema
   */
  public esRoot(): boolean {
    return this.tieneRol('root');
  }

  private normalizarFormatoSgc(plantillaSlug?: string): string {
    return String(plantillaSlug || '').toLowerCase().trim().replace(/_/g, '-');
  }

  /**
   * Edición de formatos en Capítulos SGC (Guardar / Actualizar plantilla / editor Excel).
   * Super administrador (root) o perfil de calidad:
   * - desarrollo: sergio56
   * - producción: calidad
   * (Ing. Sergio Luis Guzmán Vigueras)
   *
   * También usuarios delegados por root/calidad para ese formato concreto.
   *
   * Excepción por formato:
   * - ATH-F-08: también mafer295 (Lic. María Fernanda Becerra Hernández)
   */
  public puedeGestionarPlantillasSgcCapitulos(plantillaSlug?: string): boolean {
    if (this.esRoot()) {
      return true;
    }
    const username = String(this.getUsername() || '').toLowerCase().trim();
    const permitido = environment.production ? 'calidad' : 'sergio56';
    if (username === permitido) {
      return true;
    }
    // Aceptar ambos usernames por si el entorno no coincide con NODE_ENV del front.
    if (username === 'sergio56' || username === 'calidad') {
      return true;
    }
    const slug = this.normalizarFormatoSgc(plantillaSlug);
    if (slug === 'ath-f-08' && username === 'mafer295') {
      return true;
    }
    return !!slug && this.formatosSgcDelegados.has(slug);
  }

  /** Solo root o perfil calidad pueden asignar/quitar editores delegados SGC. */
  public puedeGestionarDelegacionesSgc(): boolean {
    if (this.esRoot()) {
      return true;
    }
    const username = String(this.getUsername() || '').toLowerCase().trim();
    return username === 'sergio56' || username === 'calidad';
  }

  /** Actualiza el flag de delegación SGC (p. ej. tras consultar /mi-permiso). */
  public setEditorSgcDelegado(valor: boolean): void {
    this.editorSgcDelegado = !!valor;
    const actual = this.usuarioActualSubject.value;
    if (actual) {
      const actualizado = { ...actual, sgc_editor_delegado: this.editorSgcDelegado };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(actualizado));
      this.usuarioActualSubject.next(actualizado);
    }
  }

  /** Marca si el usuario puede editar un formato SGC concreto (delegación por plantilla). */
  public setEditorSgcFormato(plantillaSlug: string, permitido: boolean): void {
    const slug = this.normalizarFormatoSgc(plantillaSlug);
    if (!slug) {
      return;
    }
    if (permitido) {
      this.formatosSgcDelegados.add(slug);
    } else {
      this.formatosSgcDelegados.delete(slug);
    }
  }

  public esEditorSgcDelegado(): boolean {
    return this.editorSgcDelegado;
  }

  public esEditorSgcFormato(plantillaSlug?: string): boolean {
    const slug = this.normalizarFormatoSgc(plantillaSlug);
    return !!slug && this.formatosSgcDelegados.has(slug);
  }

  /**
   * Perfiles con acceso a Historial de cursos y alertas de capacitaciones finalizadas.
   */
  public puedeGestionarHistorialPendientes(): boolean {
    return this.tieneAlgunRol([
      'root',
      'administrador',
      'instructor',
      'empresa',
      'coordinador',
      'consulta',
      'sgc',
      'control_documental'
    ]);
  }

  /**
   * Verifica si el usuario es Administrador o superior (root)
   */
  public esAdministradorOSuperior(): boolean {
    return this.tieneAlgunRol(['root', 'administrador']);
  }

  /**
   * Roles que pueden subir y gestionar el repositorio documental de empresas.
   */
  public puedeEscribirRepositorioEmpresa(): boolean {
    return this.tieneAlgunRol([
      'root',
      'administrador',
      'proteccion_civil',
      'sgc',
      'ambiental',
      'rrhh'
    ]);
  }

  /**
   * Verifica si el usuario es Instructor (tiene el rol instructor)
   */
  public esInstructor(): boolean {
    return this.tieneRol('instructor');
  }

  /**
   * Verifica si el usuario es Doctor (tiene el rol doctor)
   */
  public esDoctor(): boolean {
    return this.tieneRol('doctor');
  }

  /**
   * Verifica si el usuario es representante de Empresa (rol: empresa)
   */
  public esEmpresa(): boolean {
    return this.tieneRol('empresa');
  }

  /**
   * Verifica si el usuario es superusuario (root)
   * Los superusuarios tienen acceso total al sistema
   */
  public esSuperusuario(): boolean {
    return this.tieneRol('root');
  }

  /**
   * Verifica si el usuario tiene acceso a una funcionalidad
   * Los superusuarios (root) siempre tienen acceso
   */
  public tieneAcceso(rolesPermitidos: string[]): boolean {
    if (this.esSuperusuario()) return true;
    return this.tieneAlgunRol(rolesPermitidos);
  }

  /**
   * Obtiene los permisos del usuario (si existen)
   */
  public getPermisos(): string[] {
    const permisos = this.usuarioActualValue?.permisos;
    if (!permisos) return [];
    try {
      return JSON.parse(permisos);
    } catch {
      return permisos.split(',').map(p => p.trim());
    }
  }

  /**
   * Verifica si el usuario tiene un permiso específico
   */
  public tienePermiso(permiso: string): boolean {
    // Superusuarios tienen todos los permisos
    if (this.esSuperusuario()) return true;
    return this.getPermisos().includes(permiso);
  }

  /**
   * Obtiene los datos completos del usuario actual
   * Devuelve un objeto con propiedades normalizadas
   */
  public getUsuario(): any {
    const usuario = this.usuarioActualValue;
    if (!usuario) return null;
    
    // Devolver objeto con propiedades normalizadas para el perfil
    return {
      id: usuario.id || usuario.usuario_id,
      usuario: usuario.username,
      nombre: usuario.nombre || '',
      apellidos: usuario.apellido_paterno || usuario.apellido || '',
      correo: usuario.email || '',
      telefono: usuario.telefono || '',
      rol_nombre: usuario.rol_nombre || usuario.rol || '',
      estado: 'activo',
      fecha_creacion: null // No tenemos este dato en la sesión
    };
  }
}
