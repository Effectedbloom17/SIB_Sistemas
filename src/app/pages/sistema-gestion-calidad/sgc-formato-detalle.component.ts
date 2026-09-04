import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from 'src/app/services/auth.service';
import {
  CapituloFormatoConfig,
  PlantillaFormato,
  SGC_CAPITULOS_CATALOG
} from './sgc-formatos.catalog';
import { SgcListaMaestraVigenciaService } from './sgc-lista-maestra-vigencia.service';

export type TipoPlantillaExt = 'excel' | 'word' | 'pdf' | 'otro';

@Component({
  selector: 'app-sgc-formato-detalle',
  templateUrl: './sgc-formato-detalle.component.html',
  styleUrls: ['./sgc-formato-detalle.component.scss']
})
export class SgcFormatoDetalleComponent implements OnInit, OnDestroy {
  etiquetaRolUsuario = '';
  config: CapituloFormatoConfig | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private vigenciaSgc: SgcListaMaestraVigenciaService
  ) {}

  ngOnInit(): void {
    this.initEtiquetaRol();
    this.vigenciaSgc.refrescar().pipe(takeUntil(this.destroy$)).subscribe();

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(pm => {
      const slug = (pm.get('capitulo') || '').toLowerCase();
      const cfg = SGC_CAPITULOS_CATALOG[slug];
      if (!cfg) {
        this.router.navigate(['/sistema-gestion-calidad'], {
          fragment: 'sgc-capitulos-panel'
        });
        return;
      }
      this.config = cfg;
    });
  }

  get plantillasVisibles(): PlantillaFormato[] {
    return this.vigenciaSgc.filtrarPlantillasCentro(this.config?.plantillas || []);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get tituloCapitulo(): string {
    if (!this.config) {
      return '';
    }
    return `Capítulo ${this.config.numero}. ${this.config.titulo}`;
  }

  private initEtiquetaRol(): void {
    const roles = this.authService.getRoles();
    const principal = (this.authService.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      this.etiquetaRolUsuario = principal === 'root' ? 'Super administrador' : 'Administrador';
    } else if (roles.some(r => r === 'sgc')) {
      this.etiquetaRolUsuario = 'SGC';
    } else {
      this.etiquetaRolUsuario = 'Usuario';
    }
  }

  tipoPlantilla(nombre: string): TipoPlantillaExt {
    const n = nombre.toLowerCase();
    if (n.endsWith('.xlsx') || n.endsWith('.xls')) {
      return 'excel';
    }
    if (n.endsWith('.docx') || n.endsWith('.doc')) {
      return 'word';
    }
    if (n.endsWith('.pdf')) {
      return 'pdf';
    }
    return 'otro';
  }

  metaFormato(p: PlantillaFormato): string {
    const tipo = this.tipoPlantilla(p.nombre);
    const tipoLabel =
      tipo === 'excel' ? 'Hoja de cálculo' :
      tipo === 'word' ? 'Documento Word' :
      tipo === 'pdf' ? 'Documento PDF' : 'Documento';
    const modo = p.previewMode === 'form' ? 'Formulario interactivo' : 'Vista integrada';
    return `${tipoLabel} · ${modo}`;
  }

  tipoBadge(p: PlantillaFormato): string {
    const tipo = this.tipoPlantilla(p.nombre);
    if (tipo === 'excel') return 'Excel';
    if (tipo === 'word') return 'Word';
    if (tipo === 'pdf') return 'PDF';
    return 'Documento';
  }

  modoBadge(p: PlantillaFormato): string {
    return p.previewMode === 'form' ? 'Interactivo' : 'Integrado';
  }

  trackByCodigo(_: number, p: PlantillaFormato): string {
    return p.codigo;
  }
}
