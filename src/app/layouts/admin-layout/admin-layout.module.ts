import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ClipboardModule } from 'ngx-clipboard';

import { AdminLayoutRoutes } from './admin-layout.routing';
import { ComponentsModule } from '../../components/components.module';
import { DashboardComponent } from '../../pages/dashboard/dashboard.component';
import { UserProfileComponent } from '../../pages/user-profile/user-profile.component';
import { HomeComponent } from '../../pages/home/home.component';
import { CalendarioComponent } from '../../pages/calendario/calendario.component';
import { QuejasSugerenciasComponent } from '../../pages/quejas-sugerencias/quejas-sugerencias.component';
import { ChatEmpresasComponent } from '../../pages/chat-empresas/chat-empresas.component';
import { CorreoComponent } from '../../pages/correo/correo.component';
import { CorreoEmpresaComponent } from '../../pages/correo-empresa/correo-empresa.component';
import { TicketsComponent } from '../../pages/tickets/tickets.component';
import { MisEmpresasComponent } from '../../pages/mis-empresas/mis-empresas.component';
import { GestionUsuariosComponent } from '../../pages/gestion-usuarios/gestion-usuarios.component';
import { AvisoPrivacidadComponent } from '../../pages/aviso-privacidad/aviso-privacidad.component';
import { EmpleadosEmpresaComponent } from '../../pages/empleados-empresa/empleados-empresa.component';
import { EmpresaRepositorioComponent } from '../../pages/empresa-repositorio/empresa-repositorio.component';

import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgApexchartsModule } from 'ng-apexcharts';
import { NgxEchartsModule } from 'ngx-echarts';
import * as echarts from 'echarts';

@NgModule({
  imports: [
    CommonModule,
    RouterModule.forChild(AdminLayoutRoutes),
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    NgbModule,
    NgApexchartsModule,
    NgxEchartsModule.forRoot({ echarts }),
    ClipboardModule,
    ComponentsModule
  ],
  declarations: [
    DashboardComponent,
    UserProfileComponent,
    HomeComponent,
    CalendarioComponent,
    QuejasSugerenciasComponent,
    ChatEmpresasComponent,
    CorreoComponent,
    CorreoEmpresaComponent,
    TicketsComponent,
    MisEmpresasComponent,
    GestionUsuariosComponent,
    AvisoPrivacidadComponent,
    EmpleadosEmpresaComponent,
    EmpresaRepositorioComponent
  ]
})

export class AdminLayoutModule {}
