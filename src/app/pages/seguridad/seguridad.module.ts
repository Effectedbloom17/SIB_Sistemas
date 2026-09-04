import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from 'src/app/guards/role.guard';
import { SeguridadNormativasComponent } from './seguridad-normativas.component';
import { SeguridadNormativaDetalleComponent } from './seguridad-normativa-detalle.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'normativas',
    pathMatch: 'full'
  },
  {
    path: 'normativas',
    component: SeguridadNormativasComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'normativas/:id',
    component: SeguridadNormativaDetalleComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [
    SeguridadNormativasComponent,
    SeguridadNormativaDetalleComponent
  ]
})
export class SeguridadModule {}
