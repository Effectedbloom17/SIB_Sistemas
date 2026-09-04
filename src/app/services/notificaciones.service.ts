import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private _alertas = new BehaviorSubject<any[]>([]);
  readonly alertas$ = this._alertas.asObservable();

  private _notifPersonales = new BehaviorSubject<any[]>([]);
  readonly notifPersonales$ = this._notifPersonales.asObservable();

  setAlertas(alertas: any[]) {
    this._alertas.next(alertas || []);
  }

  setNotifPersonales(notifs: any[]) {
    this._notifPersonales.next(notifs || []);
  }

  descartarPersonal(id: number | string) {
    const actuales = this._notifPersonales.value.filter(n => String(n.notif_id) !== String(id));
    this._notifPersonales.next(actuales);
  }

  descartarAlertaItem(alertaIndex: number, itemIndex: number) {
    const alertas = [...this._alertas.value];
    if (!alertas[alertaIndex] || !Array.isArray(alertas[alertaIndex].items)) {
      return;
    }

    const items = [...alertas[alertaIndex].items];
    if (itemIndex < 0 || itemIndex >= items.length) {
      return;
    }

    items.splice(itemIndex, 1);
    if (items.length === 0) {
      alertas.splice(alertaIndex, 1);
    } else {
      alertas[alertaIndex] = {
        ...alertas[alertaIndex],
        items,
        resumen: `${items.length} elemento(s)`
      };
    }

    this._alertas.next(alertas);
  }

  get totalItems(): number {
    return this._alertas.value.reduce((sum, a) => sum + (a.items?.length || 0), 0)
      + this._notifPersonales.value.length;
  }
}
