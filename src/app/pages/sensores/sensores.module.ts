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
    // De momento solo superadministrador (root). Antes: root + iot.
    data: { roles: ['root'] }
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
