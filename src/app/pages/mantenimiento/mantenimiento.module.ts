import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ComponentsModule } from 'src/app/components/components.module';
import { RoleGuard } from 'src/app/guards/role.guard';
import { EinF01ProgramaComponent } from './ein-f01-programa.component';
import { EinF02SolicitudComponent } from './ein-f02-solicitud.component';
import { EinF04ReporteComponent } from './ein-f04-reporte.component';
import { SolicitudMantenimientoFormsComponent } from './solicitud-mantenimiento-forms.component';

const rolesPrograma = ['root', 'administrador', 'mantenimiento'];

const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'programa-infraestructura'
  },
  {
    path: 'programa-infraestructura',
    component: EinF01ProgramaComponent,
    canActivate: [RoleGuard],
    data: { roles: rolesPrograma }
  },
  {
    path: 'solicitud',
    component: SolicitudMantenimientoFormsComponent,
    canActivate: [RoleGuard],
    data: { roles: [] }
  },
  {
    path: 'bitacora',
    component: EinF02SolicitudComponent,
    canActivate: [RoleGuard],
    data: { roles: rolesPrograma }
  },
  {
    path: 'bitacora/:folio',
    redirectTo: 'bitacora',
    pathMatch: 'full'
  },
  {
    path: 'reporte',
    component: EinF04ReporteComponent,
    canActivate: [RoleGuard],
    data: { roles: rolesPrograma }
  },
  {
    path: 'reporte/:folio',
    component: EinF04ReporteComponent,
    canActivate: [RoleGuard],
    data: { roles: rolesPrograma }
  },
  {
    path: 'reporte-f04',
    redirectTo: 'programa-infraestructura',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ComponentsModule,
    NgApexchartsModule,
    RouterModule.forChild(routes)
  ],
  declarations: [
    EinF01ProgramaComponent,
    EinF02SolicitudComponent,
    EinF04ReporteComponent,
    SolicitudMantenimientoFormsComponent
  ]
})
export class MantenimientoModule {}
