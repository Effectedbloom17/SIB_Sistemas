import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from '../../guards/role.guard';

import { ExpedientesMedicosComponent } from './expedientes-medicos.component';

const routes: Routes = [
    {
        path: '',
        component: ExpedientesMedicosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'doctor'] }
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
        ExpedientesMedicosComponent
    ]
})
export class ExpedientesMedicosModule {}
