import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from '../../components/components.module';
import { RoleGuard } from '../../guards/role.guard';
import { SistemaGestionCalidadComponent } from './sistema-gestion-calidad.component';
import { SgcFormatoDetalleComponent } from './sgc-formato-detalle.component';
import { SgcPlantillaPreviewComponent } from './sgc-plantilla-preview.component';
import { SgcCapitulosComponent } from './sgc-capitulos.component';
import { SgcCapitulosPanelComponent } from './sgc-capitulos-panel.component';
import { SgcProcedimientosComponent } from './sgc-procedimientos.component';
import { SgcInstructivosComponent } from './sgc-instructivos.component';
import { SgcFormatosDescargaComponent } from './sgc-formatos-descarga.component';
import { SgcNormativasComponent } from './sgc-normativas.component';
import { SgcSolicitudDocumentosComponent } from './sgc-solicitud-documentos.component';

const routes: Routes = [
  {
    path: '',
    component: SistemaGestionCalidadComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'procedimientos',
    component: SgcProcedimientosComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'instructivos',
    component: SgcInstructivosComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'formatos',
    component: SgcFormatosDescargaComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'normativas',
    component: SgcNormativasComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'solicitud-documentos',
    component: SgcSolicitudDocumentosComponent,
    canActivate: [RoleGuard],
    data: { roles: ['root'] }
  },
  {
    path: 'capitulos',
    component: SgcCapitulosComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'documentacion-extra',
    redirectTo: '/diseno-innovacion/repositorio',
    pathMatch: 'full'
  },
  {
    path: ':capitulo/plantilla/:codigo',
    component: SgcPlantillaPreviewComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: ':capitulo',
    component: SgcCapitulosComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
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
    SistemaGestionCalidadComponent,
    SgcCapitulosComponent,
    SgcCapitulosPanelComponent,
    SgcFormatoDetalleComponent,
    SgcPlantillaPreviewComponent,
    SgcProcedimientosComponent,
    SgcInstructivosComponent,
    SgcFormatosDescargaComponent,
    SgcNormativasComponent,
    SgcSolicitudDocumentosComponent
  ]
})
export class SistemaGestionCalidadModule {}
