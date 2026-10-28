import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from '../../guards/role.guard';
import { AudiometriaComponent } from './audiometria.component';

const routes: Routes = [
  {
    path: '',
    component: AudiometriaComponent,
    canActivate: [RoleGuard],
    data: { roles: ['administrador', 'doctor'] }
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [AudiometriaComponent]
})
export class AudiometriaModule {}
