import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { ComponentsModule } from 'src/app/components/components.module';
import { RoleGuard } from 'src/app/guards/role.guard';
import { DisenoInnovacionComponent } from './diseno-innovacion.component';
import { SgcDocumentacionExtraComponent } from '../sistema-gestion-calidad/sgc-documentacion-extra.component';
import { InnovacionInventarioComponent } from './innovacion-inventario.component';

const routes: Routes = [
  {
    path: '',
    component: DisenoInnovacionComponent,
    canActivate: [RoleGuard],
    data: { roles: ['root', 'administrador', 'innovacion'] }
  },
  {
    path: 'repositorio',
    component: SgcDocumentacionExtraComponent,
    canActivate: [RoleGuard],
    data: { roles: ['root', 'administrador', 'innovacion', 'sgc'] }
  },
  {
    path: 'inventario',
    component: InnovacionInventarioComponent,
    canActivate: [RoleGuard],
    data: { roles: ['root', 'administrador', 'innovacion'] }
  }
];

@NgModule({
  imports: [CommonModule, FormsModule, ComponentsModule, RouterModule.forChild(routes)],
  declarations: [DisenoInnovacionComponent, SgcDocumentacionExtraComponent, InnovacionInventarioComponent]
})
export class DisenoInnovacionModule {}
