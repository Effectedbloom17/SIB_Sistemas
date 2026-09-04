import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { RoleGuard } from 'src/app/guards/role.guard';
import { ControlProyectosComponent } from './control-proyectos.component';

const routes: Routes = [
  {
    path: '',
    component: ControlProyectosComponent,
    canActivate: [RoleGuard]
    // Acceso: todos los roles autenticados excepto empresa (ver RoleGuard)
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    NgxEchartsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [ControlProyectosComponent]
})
export class ControlProyectosModule {}
