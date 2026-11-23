import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from 'src/app/guards/role.guard';
import { ResidentesComponent } from './residentes.component';
import { ColaboradoresComponent } from './colaboradores.component';
import { RegistrosRhComponent } from './registros-rh.component';
import { RiesgosPsicosocialesComponent } from './riesgos-psicosociales.component';

/** Residentes y expediente documental: solo gestión RRHH. */
const RRHH_GESTION_ROLES = ['root', 'administrador', 'rrhh'];

const routes: Routes = [
    {
        path: '',
        redirectTo: 'colaboradores',
        pathMatch: 'full'
    },
    {
        path: 'residentes',
        component: ResidentesComponent,
        canActivate: [RoleGuard],
        data: { roles: RRHH_GESTION_ROLES }
    },
    {
        path: 'registros',
        component: RegistrosRhComponent,
        canActivate: [RoleGuard],
        data: { registrosRh: true }
    },
    {
        // De momento solo superadministrador (root).
        path: 'riesgos-psicosociales',
        component: RiesgosPsicosocialesComponent,
        canActivate: [RoleGuard],
        data: { roles: ['root'], riesgosPsicosociales: true }
    },
    {
        path: 'colaboradores/expediente/:id',
        component: ColaboradoresComponent,
        canActivate: [RoleGuard],
        data: { roles: RRHH_GESTION_ROLES }
    },
    {
        // Organigrama: todos los perfiles internos excepto empresa (RoleGuard).
        path: 'colaboradores',
        component: ColaboradoresComponent,
        canActivate: [RoleGuard]
    }
];

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        NgApexchartsModule,
        ComponentsModule,
        RouterModule.forChild(routes)
    ],
    declarations: [
        ResidentesComponent,
        ColaboradoresComponent,
        RegistrosRhComponent,
        RiesgosPsicosocialesComponent
    ]
})
export class RecursosHumanosModule {}
