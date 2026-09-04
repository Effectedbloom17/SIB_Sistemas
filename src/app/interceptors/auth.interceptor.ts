import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService) {}

  private debeAdjuntarToken(url: string): boolean {
    const apiBase = String(environment.apiUrl || '').trim();

    if (!url) return false;
    if (url.startsWith('/api/')) return true;
    if (apiBase && url.startsWith(apiBase)) return true;

    return false;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.authService.getToken();
    const adjuntarToken = !!(token && this.debeAdjuntarToken(req.url));

    const outgoing = adjuntarToken
      ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
      : req;

    return next.handle(outgoing).pipe(
      catchError((error: HttpErrorResponse) => {
        if (adjuntarToken && error?.status === 401) {
          this.authService.logout();
        }
        return throwError(() => error);
      })
    );
  }
}
