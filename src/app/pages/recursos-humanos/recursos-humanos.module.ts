import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from 'src/app/guards/role.guard';
import { ResidentesComponent } from './residentes.component';
import { ColaboradoresComponent } from './colaboradores.component';

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
        ComponentsModule,
        RouterModule.forChild(routes)
    ],
    declarations: [ResidentesComponent, ColaboradoresComponent]
})
export class RecursosHumanosModule {}
