import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppLanguage = 'es' | 'en';

@Injectable({
  providedIn: 'root'
})
export class LanguageService {
  private readonly storageKey = 'biznaga_language';

  private readonly langSubject = new BehaviorSubject<AppLanguage>(this.getSavedLanguage());
  public readonly currentLanguage$ = this.langSubject.asObservable();

  get currentLanguage(): AppLanguage {
    return this.langSubject.value;
  }

  /**
   * Llamar una vez al inicializar la app.
   * Si hay cookie residual de inglés pero el idioma guardado es español, la limpia y recarga.
   */
  initialize(): void {
    const saved = this.getSavedLanguage();
    const hasEnCookie = this.readCookie('googtrans')?.includes('/en');

    if (saved === 'es' && hasEnCookie) {
      const reloadGuardKey = 'biznaga_lang_cookie_cleanup';
      this.deleteCookie();
      // Evita bucle infinito si la cookie de Google Translate no se puede borrar.
      if (!sessionStorage.getItem(reloadGuardKey)) {
        sessionStorage.setItem(reloadGuardKey, '1');
        window.location.reload();
        return;
      }
    }

    if (saved === 'en' && !hasEnCookie) {
      // Usuario tenía inglés pero perdió la cookie (p. ej. borró cookies): reescribir.
      this.writeCookie('/es/en');
    }

    this.langSubject.next(saved);
  }

  toggleLanguage(): void {
    const next: AppLanguage = this.currentLanguage === 'es' ? 'en' : 'es';
    this.applyAndReload(next);
  }

  private applyAndReload(language: AppLanguage): void {
    localStorage.setItem(this.storageKey, language);
    this.langSubject.next(language);

    if (language === 'en') {
      this.writeCookie('/es/en');
    } else {
      this.deleteCookie();
    }

    window.location.reload();
  }

  private getSavedLanguage(): AppLanguage {
    return localStorage.getItem(this.storageKey) === 'en' ? 'en' : 'es';
  }

  private readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private writeCookie(value: string): void {
    const base = `googtrans=${encodeURIComponent(value)};path=/`;
    document.cookie = base;
    // Para dominios con subdominio (p.ej. app.biznaga.com)
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      document.cookie = `${base};domain=.${parts.slice(-2).join('.')}`;
    }
  }

  private deleteCookie(): void {
    const expired = `googtrans=;path=/;max-age=0`;
    document.cookie = expired;
    const hostname = window.location.hostname;
    document.cookie = `${expired};domain=${hostname}`;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      document.cookie = `${expired};domain=.${parts.slice(-2).join('.')}`;
    }
  }
}
