import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from '../../guards/role.guard';

import { AdminCursosComponent } from '../admin-cursos/admin-cursos.component';
import { CursosbizComponent } from '../cursosbiz/cursosbiz.component';
import { CursoActivoComponent } from '../curso-activo/curso-activo.component';
import { AsigCursoComponent } from '../asig-curso/asig-curso.component';
import { GestionarCursoComponent } from '../gestionar-curso/gestionar-curso.component';
import { TimelineCursoComponent } from '../timeline-curso/timeline-curso.component';
import { InformacionGeneralComponent } from '../informacion-general/informacion-general.component';
import { ListaAsistenciaComponent } from '../lista-asistencia/lista-asistencia.component';
import { GeneracionDiplomAsComponent } from '../generacion-diplomas/generacion-diplomas.component';
import { HistorialCursosComponent } from '../historial-cursos/historial-cursos.component';
import { HistorialConstanciasDc3Component } from '../historial-constancias-dc3/historial-constancias-dc3.component';
import { ControlCapacitacionEmpresarialComponent } from '../control-capacitacion-empresarial/control-capacitacion-empresarial.component';

import { NgApexchartsModule } from 'ng-apexcharts';

const routes: Routes = [
    {
        path: 'admin-cursos',
        component: AdminCursosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'control_documental'] }
    },
    {
        path: 'cursosbiz/:categoria',
        component: CursosbizComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'doctor', 'coordinador', 'consulta', 'control_documental'] }
    },
    {
        path: 'curso-activos',
        component: CursoActivoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'empresa', 'control_documental'] }
    },
    {
        path: 'asig-curso',
        component: AsigCursoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'control_documental'] }
    },
    {
        path: 'gestionar-curso',
        component: GestionarCursoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'empresa', 'control_documental'] }
    },
    {
        path: 'timeline-curso',
        component: TimelineCursoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['instructor', 'administrador', 'empresa', 'control_documental'] }
    },
    {
        path: 'informacion-general/:id',
        component: InformacionGeneralComponent
    },
    {
        path: 'lista-asistencia/:id',
        component: ListaAsistenciaComponent
    },
    {
        path: 'generacion-diplomas',
        component: GeneracionDiplomAsComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'control_documental'] }
    },
    {
        path: 'historial-cursos',
        component: HistorialCursosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'empresa', 'coordinador', 'consulta', 'sgc', 'control_documental'] }
    },
    {
        path: 'control-capacitacion',
        component: ControlCapacitacionEmpresarialComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'control_documental'] }
    },
    {
        path: 'historial-constancias-dc3',
        component: HistorialConstanciasDc3Component,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'instructor', 'control_documental'] }
    }
];

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        NgbModule,
        NgApexchartsModule,
        ComponentsModule,
        RouterModule.forChild(routes)
    ],
    declarations: [
        AdminCursosComponent,
        CursosbizComponent,
        CursoActivoComponent,
        AsigCursoComponent,
        GestionarCursoComponent,
        TimelineCursoComponent,
        InformacionGeneralComponent,
        ListaAsistenciaComponent,
        GeneracionDiplomAsComponent,
        HistorialCursosComponent,
        HistorialConstanciasDc3Component,
        ControlCapacitacionEmpresarialComponent
    ]
})
export class CursosModule {}
