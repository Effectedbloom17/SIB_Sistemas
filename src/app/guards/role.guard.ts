import { Injectable } from '@angular/core';
import { Router, CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Roles con acceso total al sistema (superusuarios) - Deben coincidir con la BD
const SUPERUSER_ROLES = ['root', 'Root', 'ROOT'];

/**
 * Guard para proteger rutas basado en roles de usuario
 * El rol 'root' (Super Administrador) tiene acceso total a todas las rutas
 * 
 * Roles en la BD:
 * - root: Super Administrador (acceso total)
 * - administrador: Administrador
 * - instructor: Instructor  
 * - doctor: Doctor (acceso a expedientes médicos)
 * - empresa: Usuario Empresa
 * - consulta: Solo Consulta
 * - sgc: Sistema de Gestión de Calidad
 * - ambiental: Módulo ambiental
 * - control_documental: Admin de capacitación / Entrega de Documentos SP-F-03
 * - iot: Sensores IoT (Blynk); solo root e iot
 * - rrhh: Recursos Humanos (Residentes / Colaboradores)
 * - mantenimiento: Programa EIN-F-01 (mantenimiento a la infraestructura)
 * 
 * Uso en rutas:
 *   { path: 'admin', component: AdminComponent, canActivate: [RoleGuard], data: { roles: ['administrador'] } }
 */
@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  
  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    // Primero verificar si está autenticado
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Obtener todos los roles del usuario (multi-rol)
    const userRoles = this.authService.getRoles();
    const userRole = this.authService.getRol();

    // Excepción de negocio: correo personal no disponible para perfil empresa
    if (route.routeConfig?.path === 'correo') {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
    }

    // Excepción de negocio: Mis empresas disponible para todos excepto perfil empresa
    if (route.routeConfig?.path === 'mis-empresas' || state.url.includes('/mis-empresas')) {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
      return true;
    }

    // Excepción de negocio: Control de Proyectos y Control de Oficios disponibles para todos excepto perfil empresa
    if (state.url.includes('/control-proyectos') || state.url.includes('/control-oficios')) {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
      return true;
    }

    // Centro SGC completo: visible para todos los perfiles internos, excepto empresa.
    const esSeccionSgcAbierta = state.url.includes('/sistema-gestion-calidad');
    if (esSeccionSgcAbierta) {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
      if (state.url.includes('/sistema-gestion-calidad/solicitud-documentos')) {
        if (!this.authService.puedeGestionarDelegacionesSgc()) {
          this.router.navigate(['/sistema-gestion-calidad']);
          return false;
        }
      }
      return true;
    }

    // Seguridad (catálogo normativas): todos los perfiles internos, excepto empresa.
    if (state.url.includes('/seguridad')) {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
      return true;
    }

    // Programa EIN-F-01 (infraestructura): root, administrador y mantenimiento
    if (state.url.includes('/mantenimiento/programa-infraestructura')
      || state.url.includes('/mantenimiento/bitacora')
      || state.url.includes('/mantenimiento/reporte')) {
      const allowed = ['root', 'administrador', 'mantenimiento'];
      const ok = userRoles.some(r => allowed.includes(r.toLowerCase()))
        || (userRole && allowed.includes(userRole.toLowerCase()));
      if (!ok) {
        this.router.navigate(['/dashboard']);
        return false;
      }
      return true;
    }

    // Solicitud de mantenimiento (Google Forms EIN-F-02): todos excepto empresa
    if (state.url.includes('/mantenimiento/solicitud')) {
      const esEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (esEmpresa) {
        this.router.navigate(['/curso-activos']);
        return false;
      }
      return true;
    }

    // Recursos Humanos (datos sensibles): solo root, administrador y rrhh.
    if (state.url.includes('/recursos-humanos')) {
      const allowed = ['root', 'administrador', 'rrhh'];
      const ok = userRoles.some(r => allowed.includes(r.toLowerCase()))
        || (userRole && allowed.includes(userRole.toLowerCase()));
      if (!ok) {
        this.router.navigate(['/dashboard']);
        return false;
      }
      return true;
    }

    // Excepción de negocio: Aviso de privacidad solo para perfil empresa
    if (route.routeConfig?.path === 'aviso-privacidad') {
      const isEmpresa = userRoles.some(r => r.toLowerCase() === 'empresa') || (userRole && userRole.toLowerCase() === 'empresa');
      if (!isEmpresa) {
        if (userRoles.includes('doctor') || (userRole && userRole.toLowerCase() === 'doctor')) {
          this.router.navigate(['/expedientes-medicos']);
        } else if (userRoles.includes('proteccion_civil') || (userRole && userRole.toLowerCase() === 'proteccion_civil')) {
          this.router.navigate(['/proteccion-civil']);
        } else if (userRoles.includes('sgc') || (userRole && userRole.toLowerCase() === 'sgc')) {
          this.router.navigate(['/sistema-gestion-calidad']);
        } else if (userRoles.includes('ambiental') || (userRole && userRole.toLowerCase() === 'ambiental')) {
          this.router.navigate(['/ambiental']);
        } else if (userRoles.includes('control_documental') || (userRole && userRole.toLowerCase() === 'control_documental')) {
          this.router.navigate(['/historial-cursos']);
        } else if (userRoles.includes('iot') || (userRole && userRole.toLowerCase() === 'iot')) {
          this.router.navigate(['/sensores']);
        } else if (userRoles.includes('rrhh') || (userRole && userRole.toLowerCase() === 'rrhh')) {
          this.router.navigate(['/recursos-humanos/colaboradores']);
        } else if (userRoles.includes('mantenimiento') || (userRole && userRole.toLowerCase() === 'mantenimiento')) {
          this.router.navigate(['/mantenimiento/programa-infraestructura']);
        } else {
          this.router.navigate(['/dashboard']);
        }
        return false;
      }
      return true;
    }

    // Los superusuarios (root) tienen acceso a TODO
    if (userRole && SUPERUSER_ROLES.includes(userRole)) {
      return true;
    }
    if (userRoles.some(r => SUPERUSER_ROLES.map(s => s.toLowerCase()).includes(r.toLowerCase()))) {
      return true;
    }

    // Obtener roles permitidos de la configuración de la ruta
    const allowedRoles = route.data['roles'] as string[];
    
    // Si no hay roles definidos, permitir acceso (solo requiere autenticación)
    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    // Verificar si el usuario tiene alguno de los roles permitidos (multi-rol, case insensitive)
    const hasAccess = userRoles.some(ur =>
      allowedRoles.some(ar => ar.toLowerCase() === ur.toLowerCase())
    );
    if (hasAccess) {
      return true;
    }

    // Fallback: verificar rol principal
    if (userRole) {
      const userRoleLower = userRole.toLowerCase();
      if (allowedRoles.some(role => role.toLowerCase() === userRoleLower)) {
        return true;
      }
    }

    // Usuario no tiene el rol requerido - redirigir según el rol principal
    if (userRoles.includes('empresa') || (userRole && userRole.toLowerCase() === 'empresa')) {
      this.router.navigate(['/curso-activos']);
    } else if (userRoles.includes('doctor') || (userRole && userRole.toLowerCase() === 'doctor')) {
      this.router.navigate(['/expedientes-medicos']);
    } else if (userRoles.includes('proteccion_civil') || (userRole && userRole.toLowerCase() === 'proteccion_civil')) {
      this.router.navigate(['/proteccion-civil']);
    } else if (userRoles.includes('sgc') || (userRole && userRole.toLowerCase() === 'sgc')) {
      this.router.navigate(['/sistema-gestion-calidad']);
    } else if (userRoles.includes('ambiental') || (userRole && userRole.toLowerCase() === 'ambiental')) {
      this.router.navigate(['/ambiental']);
    } else if (userRoles.includes('control_documental') || (userRole && userRole.toLowerCase() === 'control_documental')) {
      this.router.navigate(['/historial-cursos']);
    } else if (userRoles.includes('iot') || (userRole && userRole.toLowerCase() === 'iot')) {
      this.router.navigate(['/sensores']);
    } else if (userRoles.includes('rrhh') || (userRole && userRole.toLowerCase() === 'rrhh')) {
      this.router.navigate(['/recursos-humanos/colaboradores']);
    } else if (userRoles.includes('mantenimiento') || (userRole && userRole.toLowerCase() === 'mantenimiento')) {
      this.router.navigate(['/mantenimiento/programa-infraestructura']);
    } else {
      this.router.navigate(['/dashboard']);
    }
    return false;
  }
}
