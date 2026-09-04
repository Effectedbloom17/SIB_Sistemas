import { Routes } from '@angular/router';

import { DashboardComponent } from '../../pages/dashboard/dashboard.component';
import { UserProfileComponent } from '../../pages/user-profile/user-profile.component';
import { HomeComponent } from '../../pages/home/home.component';
import { CalendarioComponent } from '../../pages/calendario/calendario.component';
import { QuejasSugerenciasComponent } from '../../pages/quejas-sugerencias/quejas-sugerencias.component';
import { ChatEmpresasComponent } from '../../pages/chat-empresas/chat-empresas.component';
import { CorreoComponent } from '../../pages/correo/correo.component';
import { CorreoEmpresaComponent } from '../../pages/correo-empresa/correo-empresa.component';
import { TicketsComponent } from '../../pages/tickets/tickets.component';
import { MisEmpresasComponent } from '../../pages/mis-empresas/mis-empresas.component';
import { GestionUsuariosComponent } from '../../pages/gestion-usuarios/gestion-usuarios.component';
import { AvisoPrivacidadComponent } from '../../pages/aviso-privacidad/aviso-privacidad.component';
import { EmpleadosEmpresaComponent } from '../../pages/empleados-empresa/empleados-empresa.component';
import { EmpresaRepositorioComponent } from '../../pages/empresa-repositorio/empresa-repositorio.component';

// Guards
import { RoleGuard } from 'src/app/guards/role.guard';

/**
 * Roles de la BD:
 * - root: Super Administrador (acceso total - no necesita estar en data.roles)
 * - administrador: Administrador
 * - instructor: Instructor
 * - doctor: Doctor (acceso a expedientes médicos)
 * - empresa: Usuario Empresa
 * - consulta: Solo Consulta
 * - sgc: Sistema de Gestión de Calidad (BD satélite biznaga_sgc)
 * - ambiental: Módulo ambiental (SP-F-15 / SP-F-28)
 * - innovacion: Diseño e Innovación (Cotización Señalización) / Mantenimiento EIN
 * - control_documental: Admin de capacitación / SP-F-03
 * - iot: Sensores IoT (Blynk) — solo root e iot; no administrador
 * - rrhh: Recursos Humanos (Residentes / Colaboradores)
 */
export const AdminLayoutRoutes: Routes = [
    // =====================================================
    // RUTAS DIRECTAS (componentes ligeros, carga inmediata)
    // =====================================================
    { 
        path: 'dashboard',
        component: DashboardComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'coordinador', 'consulta', 'empresa', 'control_documental'] }
    },
    {
        path: 'user-profile',
        component: UserProfileComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'doctor', 'empresa', 'coordinador', 'consulta', 'sgc', 'control_documental'] }
    },
    {
        path: 'calendario',
        component: CalendarioComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'control_documental'] }
    },
    {
        path: 'quejas-sugerencias',
        component: QuejasSugerenciasComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'empresa'] }
    },
    {
        path: 'chat-empresas',
        component: ChatEmpresasComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'empresa'] }
    },
    {
        path: 'tickets',
        component: TicketsComponent,
        canActivate: [RoleGuard],
        data: { roles: ['root'] }
    },
    {
        path: 'correo',
        component: CorreoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'doctor', 'sgc', 'ambiental', 'innovacion', 'control_documental'] }
    },
    {
        path: 'correo-empresa',
        component: CorreoEmpresaComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador'] }
    },
    { 
        path: 'gestion-usuarios',   
        component: GestionUsuariosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador'] }
    },
    { 
        path: 'mis-empresas',    
        component: MisEmpresasComponent,
        canActivate: [RoleGuard]
        // Acceso: todos los roles autenticados excepto empresa (ver RoleGuard)
    },
    {
        path: 'mis-empresas/:id/repositorio',
        component: EmpresaRepositorioComponent,
        canActivate: [RoleGuard]
    },
    {
        path: 'aviso-privacidad',
        component: AvisoPrivacidadComponent,
        canActivate: [RoleGuard],
        data: { roles: ['empresa'] }
    },
    {
        path: 'empleados-empresa',
        component: EmpleadosEmpresaComponent,
        canActivate: [RoleGuard],
        data: { roles: ['empresa', 'administrador', 'control_documental'] }
    },
    { 
        path: 'home',           
        component: HomeComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'coordinador', 'consulta', 'proteccion_civil', 'control_documental'] }
    },

    // =====================================================
    // MODULOS LAZY-LOADED (se descargan solo cuando el usuario navega ahí)
    // =====================================================

    // Cursos: admin-cursos, cursosbiz, curso-activos, asig-curso, gestionar-curso,
    //         timeline-curso, informacion-general, lista-asistencia,
    //         generacion-diplomas, historial-cursos, historial-constancias-dc3
    {
        path: '',
        loadChildren: () => import('../../pages/cursos/cursos.module').then(m => m.CursosModule)
    },

    // Protección Civil: 5 componentes
    {
        path: 'proteccion-civil',
        loadChildren: () => import('../../pages/proteccion-civil/proteccion-civil.module').then(m => m.ProteccionCivilModule)
    },

    // Expedientes Médicos (el más pesado: XLSX + jsPDF + html2canvas + ApexCharts)
    {
        path: 'expedientes-medicos',
        loadChildren: () => import('../../pages/expedientes-medicos/expedientes-medicos.module').then(m => m.ExpedientesMedicosModule)
    },

    {
        path: 'estadisticas-medicas',
        loadChildren: () => import('../../pages/estadisticas-medicas/estadisticas-medicas.module').then(m => m.EstadisticasMedicasModule)
    },

    {
        path: 'sistema-gestion-calidad',
        loadChildren: () => import('../../pages/sistema-gestion-calidad/sistema-gestion-calidad.module').then(m => m.SistemaGestionCalidadModule)
    },

    {
        path: 'seguridad',
        loadChildren: () => import('../../pages/seguridad/seguridad.module').then(m => m.SeguridadModule),
        canActivate: [RoleGuard]
        // Acceso: todos excepto empresa (ver RoleGuard)
    },

    {
        path: 'recursos-humanos',
        loadChildren: () => import('../../pages/recursos-humanos/recursos-humanos.module').then(m => m.RecursosHumanosModule),
        canActivate: [RoleGuard]
        // Acceso: todos excepto empresa (ver RoleGuard)
    },

    {
        path: 'ambiental',
        loadChildren: () => import('../../pages/ambiental/ambiental.module').then(m => m.AmbientalModule),
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'ambiental'] }
    },

    // Visible y accesible para todos los perfiles excepto empresa (ver RoleGuard)
    {
        path: 'control-proyectos',
        loadChildren: () => import('../../pages/control-proyectos/control-proyectos.module').then(m => m.ControlProyectosModule),
        canActivate: [RoleGuard]
    },

    // Sensores IoT (Blynk) — hermana de control-proyectos (NO hija: RoleGuard bypassea /control-proyectos)
    // Acceso: root (bypass) e iot. No administrador.
    {
        path: 'sensores',
        loadChildren: () => import('../../pages/sensores/sensores.module').then(m => m.SensoresModule),
        canActivate: [RoleGuard],
        data: { roles: ['iot'] }
    },

    {
        path: 'diseno-innovacion',
        loadChildren: () => import('../../pages/diseno-innovacion/diseno-innovacion.module').then(m => m.DisenoInnovacionModule)
    },

    // Mantenimiento (EIN-F-01 Programa de mantenimiento a la infraestructura)
    {
        path: 'mantenimiento',
        loadChildren: () => import('../../pages/mantenimiento/mantenimiento.module').then(m => m.MantenimientoModule)
    },

    // Control de Oficios (SP-F-15) — reutiliza el módulo Ambiental en modo "oficios"
    // Visible y accesible para todos los perfiles excepto empresa (ver RoleGuard)
    {
        path: 'control-oficios',
        loadChildren: () => import('../../pages/ambiental/ambiental.module').then(m => m.AmbientalModule),
        canActivate: [RoleGuard]
    },

    // Control de Trámites (SP-F-28 visor) — reutiliza el módulo Ambiental en modo "control-tramites"
    {
        path: 'control-tramites',
        loadChildren: () => import('../../pages/ambiental/ambiental.module').then(m => m.AmbientalModule),
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'ambiental'] }
    }
];
