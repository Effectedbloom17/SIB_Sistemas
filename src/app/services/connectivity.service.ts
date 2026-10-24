import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Estado de conectividad del navegador (online/offline).
 * Usado para avisar al usuario y diferir guardados al servidor.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  private readonly onlineSubject = new BehaviorSubject<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  readonly online$: Observable<boolean> = this.onlineSubject.asObservable();

  private readonly onOnline = () => this.ngZone.run(() => this.onlineSubject.next(true));
  private readonly onOffline = () => this.ngZone.run(() => this.onlineSubject.next(false));
  private readonly onFocus = () => {
    const actual = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    if (actual !== this.onlineSubject.value) {
      this.ngZone.run(() => this.onlineSubject.next(actual));
    }
  };

  constructor(private ngZone: NgZone) {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('focus', this.onFocus);
  }

  get isOnline(): boolean {
    return this.onlineSubject.value;
  }

  get isOffline(): boolean {
    return !this.onlineSubject.value;
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('focus', this.onFocus);
  }
}
