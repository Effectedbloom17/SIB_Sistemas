import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgxEchartsModule } from 'ngx-echarts';
import { ComponentsModule } from 'src/app/components/components.module';
import { RoleGuard } from 'src/app/guards/role.guard';
import { ControlProyectosComponent } from './control-proyectos.component';
import { ControlProyectosRepositorioComponent } from './control-proyectos-repositorio.component';

const routes: Routes = [
  {
    path: 'repositorio',
    component: ControlProyectosRepositorioComponent,
    canActivate: [RoleGuard]
  },
  {
    path: '',
    component: ControlProyectosComponent,
    canActivate: [RoleGuard]
    // Acceso: todos los roles autenticados; empresa entra en modo consulta (ver RoleGuard)
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ComponentsModule,
    DragDropModule,
    NgxEchartsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [
    ControlProyectosComponent,
    ControlProyectosRepositorioComponent
  ]
})
export class ControlProyectosModule {}
