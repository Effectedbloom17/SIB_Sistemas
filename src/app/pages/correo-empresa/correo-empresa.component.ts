import { Component } from '@angular/core';
import { CorreoComponent } from '../correo/correo.component';

@Component({
  selector: 'app-correo-empresa',
  templateUrl: '../correo/correo.component.html',
  styleUrls: ['../correo/correo.component.scss', './correo-empresa.component.scss']
})
export class CorreoEmpresaComponent extends CorreoComponent {
  modoEmpresa = true;
}
