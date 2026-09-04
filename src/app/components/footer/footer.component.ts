import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

// OnPush: componente estático (solo muestra el año actual). Nunca depende de estado
// mutable ni de @Input cambiantes, por lo que evitar su revisión en cada ciclo es seguro.
@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FooterComponent implements OnInit {
  currentYear: number = new Date().getFullYear();

  constructor() { }

  ngOnInit() {
  }

}
