import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from 'src/app/guards/role.guard';
import { SensoresComponent } from './sensores.component';

const routes: Routes = [
  {
    path: '',
    component: SensoresComponent,
    canActivate: [RoleGuard],
    // Acceso: root (bypass) e iot. No administrador.
    data: { roles: ['iot'] }
  }
];

@NgModule({
  imports: [
    CommonModule,
    RouterModule.forChild(routes)
  ],
  declarations: [SensoresComponent]
})
export class SensoresModule {}
