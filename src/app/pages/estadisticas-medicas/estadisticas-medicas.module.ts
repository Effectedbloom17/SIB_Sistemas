import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from '../../guards/role.guard';

import { EstadisticasMedicasComponent } from './estadisticas-medicas.component';

const routes: Routes = [
    {
        path: '',
        component: EstadisticasMedicasComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'doctor'] }
    }
];

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgApexchartsModule,
        ComponentsModule,
        RouterModule.forChild(routes)
    ],
    declarations: [
        EstadisticasMedicasComponent
    ]
})
export class EstadisticasMedicasModule {}
