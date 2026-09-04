import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from '../../components/components.module';
import { AmbientalComponent } from './ambiental.component';
import { AmbientalTramiteArchivosPanelComponent } from './ambiental-tramite-archivos-panel.component';
import { AmbientalControlTramitesComponent } from './ambiental-control-tramites.component';

const routes: Routes = [
    {
        path: '',
        component: AmbientalComponent
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
        AmbientalComponent,
        AmbientalTramiteArchivosPanelComponent,
        AmbientalControlTramitesComponent
    ]
})
export class AmbientalModule {}
