import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { RoleGuard } from 'src/app/guards/role.guard';
import { AgendaComponent } from './agenda.component';

const routes: Routes = [
  {
    path: '',
    component: AgendaComponent,
    canActivate: [RoleGuard],
    data: { roles: ['root', 'innovacion'] }
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [AgendaComponent]
})
export class AgendaModule {}
