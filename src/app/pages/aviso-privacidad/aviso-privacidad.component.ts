import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';

@Component({
  selector: 'app-aviso-privacidad',
  templateUrl: './aviso-privacidad.component.html',
  styleUrls: ['./aviso-privacidad.component.scss']
})
export class AvisoPrivacidadComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  cargando = true;
  error = '';
  avisoNombre = 'SGC-F-23 Aviso de privacidad de datos personales (Biznaga)';
  avisoUrlSafe: SafeResourceUrl | null = null;

  constructor(
    private backendService: BackendServices,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.cargarAvisoPrivacidad();
  }

  cargarAvisoPrivacidad(): void {
    this.cargando = true;
    this.error = '';
    this.avisoUrlSafe = null;

    this.backendService.obtenerAvisoPrivacidadEmpresa().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        const previewUrl = String(response?.previewUrl || '').trim();
        const driveFileId = String(response?.driveFileId || '').trim();
        const urlFinal = previewUrl || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/preview` : '');

        if (!urlFinal) {
          this.cargando = false;
          this.error = 'No se encontró la URL del aviso de privacidad.';
          return;
        }

        this.avisoNombre = response?.nombre || this.avisoNombre;
        this.avisoUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(urlFinal);
      },
      error: (err) => {
        this.cargando = false;
        this.error = err?.error?.message || 'No se pudo cargar el aviso de privacidad.';
      }
    });
  }

  onIframeLoad(): void {
    this.cargando = false;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
