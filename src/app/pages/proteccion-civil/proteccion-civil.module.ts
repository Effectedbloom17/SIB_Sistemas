import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from '../../guards/role.guard';
import { NgApexchartsModule } from 'ng-apexcharts';

import { ProteccionCivilComponent } from './proteccion-civil.component';
import { ProteccionCivilAsignarDocumentosComponent } from '../proteccion-civil-asignar-documentos/proteccion-civil-asignar-documentos.component';
import { ProteccionCivilCatalogoComponent } from '../proteccion-civil-catalogo/proteccion-civil-catalogo.component';
import { ProteccionCivilRevisarDocumentosComponent } from '../proteccion-civil-revisar-documentos/proteccion-civil-revisar-documentos.component';
import { ProteccionCivilHistorialDocumentosComponent } from '../proteccion-civil-historial-documentos/proteccion-civil-historial-documentos.component';
import { ProteccionCivilHistorialPcComponent } from '../proteccion-civil-historial-pc/proteccion-civil-historial-pc.component';
import { ControlResolutivosPipcComponent } from '../control-resolutivos-pipc/control-resolutivos-pipc.component';
import { ProteccionCivilReporteRecorridoComponent } from '../proteccion-civil-reporte-recorrido/proteccion-civil-reporte-recorrido.component';
import { AutoResizeTextareaDirective } from '../proteccion-civil-reporte-recorrido/auto-resize-textarea.directive';

const routes: Routes = [
    {
        path: '',
        component: ProteccionCivilComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'empresa', 'proteccion_civil'] }
    },
    {
        path: 'empresas/:id/asignar-documentos',
        component: ProteccionCivilAsignarDocumentosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'proteccion_civil'] }
    },
    {
        path: 'catalogo',
        component: ProteccionCivilCatalogoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'proteccion_civil'] }
    },
    {
        path: 'empresas/:id/revisar-documentos',
        component: ProteccionCivilRevisarDocumentosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'proteccion_civil'] }
    },
    {
        path: 'control-resolutivos',
        component: ControlResolutivosPipcComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador'] }
    },
    {
        path: 'historial-pc',
        component: ProteccionCivilHistorialPcComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'proteccion_civil'] }
    },
    {
        path: 'historial-documentos',
        component: ProteccionCivilHistorialDocumentosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'empresa', 'proteccion_civil'] }
    },
    {
        path: 'empresas/:id/historial-documentos',
        component: ProteccionCivilHistorialDocumentosComponent,
        canActivate: [RoleGuard],
        data: { roles: ['administrador', 'empresa', 'proteccion_civil'] }
    }
];

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        NgbModule,
        ComponentsModule,
        NgApexchartsModule,
        RouterModule.forChild(routes)
    ],
    declarations: [
        ProteccionCivilComponent,
        ProteccionCivilAsignarDocumentosComponent,
        ProteccionCivilCatalogoComponent,
        ProteccionCivilRevisarDocumentosComponent,
        ProteccionCivilHistorialDocumentosComponent,
        ProteccionCivilHistorialPcComponent,
        ControlResolutivosPipcComponent,
        ProteccionCivilReporteRecorridoComponent,
        AutoResizeTextareaDirective
    ]
})
export class ProteccionCivilModule {}
