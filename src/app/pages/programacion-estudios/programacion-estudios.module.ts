import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from '../../guards/role.guard';
import { ProgramacionEstudiosComponent } from './programacion-estudios.component';

const routes: Routes = [
  {
    path: '',
    component: ProgramacionEstudiosComponent,
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
  declarations: [ProgramacionEstudiosComponent]
})
export class ProgramacionEstudiosModule {}
