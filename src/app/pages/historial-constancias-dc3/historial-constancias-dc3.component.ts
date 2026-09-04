import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

@Component({
  selector: 'app-historial-constancias-dc3',
  templateUrl: './historial-constancias-dc3.component.html',
  styleUrls: ['./historial-constancias-dc3.component.scss']
})
export class HistorialConstanciasDc3Component implements OnInit {
  terminoBusqueda = '';
  buscando = false;
  error = '';
  resultados: any[] = [];
  descargandoKey = '';
  ejemploSeleccionado: 'dc3' | 'constancia' | 'id' | '' = '';

  readonly ejemploFolioDc3 = '15-DC3-160326-451';
  readonly ejemploFolioConstancia = '15-C-160326-451';

  constructor(
    private backendServices: BackendServices,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const q = String(this.route.snapshot.queryParamMap.get('q')
      || this.route.snapshot.queryParamMap.get('folio')
      || '').trim();
    if (q) {
      this.terminoBusqueda = q;
      window.setTimeout(() => this.buscar(), 80);
    }
  }

  async buscar(): Promise<void> {
    const termino = this.normalizarBusqueda(this.terminoBusqueda || '');
    this.terminoBusqueda = termino;
    this.error = '';

    if (!termino) {
      this.resultados = [];
      return;
    }

    this.buscando = true;
    try {
      const res = await firstValueFrom(this.backendServices.buscarHistorialConstanciasDc3(termino));
      if (res?.success) {
        this.resultados = Array.isArray(res.resultados) ? res.resultados : [];
        if (this.resultados.length === 0) {
          this.error = 'No se encontraron resultados con ese criterio.';
        }
      } else {
        this.resultados = [];
        this.error = res?.message || 'No se pudo consultar el historial.';
      }
    } catch (err: any) {
      this.resultados = [];
      this.error = err?.error?.message || 'Error consultando historial de constancias/DC-3.';
    } finally {
      this.buscando = false;
    }
  }

  aplicarEjemplo(tipo: 'dc3' | 'constancia' | 'id'): void {
    this.ejemploSeleccionado = tipo;

    if (tipo === 'dc3') {
      this.terminoBusqueda = this.ejemploFolioDc3;
      window.setTimeout(() => this.buscar(), 120);
      return;
    }

    if (tipo === 'constancia') {
      this.terminoBusqueda = this.ejemploFolioConstancia;
      window.setTimeout(() => this.buscar(), 120);
      return;
    }

    this.terminoBusqueda = '451';
    window.setTimeout(() => this.buscar(), 120);
  }

  onTerminoChange(valor: string): void {
    this.terminoBusqueda = this.normalizarBusqueda(valor);
  }

  private normalizarBusqueda(valor: string): string {
    const texto = (valor || '').trim().replace(/\s{2,}/g, ' ');
    if (!texto) return '';

    if (this.pareceFolio(texto)) {
      return texto
        .toUpperCase()
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '');
    }

    return texto;
  }

  private pareceFolio(valor: string): boolean {
    return /-|dc3|\bC\b|^BRT|^\d{1,3}/i.test(valor);
  }

  limpiar(): void {
    this.terminoBusqueda = '';
    this.resultados = [];
    this.error = '';
  }

  async descargar(item: any, tipo: 'constancia' | 'dc3'): Promise<void> {
    const key = `${tipo}_${item?.inscripcion_id || tipo}`;
    this.descargandoKey = key;

    try {
      await this.descargarDocumento(item, tipo);
    } catch (err: any) {
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el archivo solicitado.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoKey = '';
    }
  }

  async descargarAmbos(item: any): Promise<void> {
    const key = `ambos_${item?.inscripcion_id || 'documento'}`;
    this.descargandoKey = key;

    const tipos: Array<'constancia' | 'dc3'> = [];
    if (item?.constancia?.disponible) tipos.push('constancia');
    if (item?.dc3?.disponible) tipos.push('dc3');

    if (!tipos.length) {
      this.descargandoKey = '';
      return;
    }

    try {
      const zip = new JSZip();
      const errores: string[] = [];

      for (const tipo of tipos) {
        try {
          const doc = tipo === 'constancia' ? item?.constancia : item?.dc3;
          const nombreArchivo = String(doc?.nombre_archivo || `${tipo}_${item?.inscripcion_id || 'documento'}.pdf`);
          const blob = await this.obtenerBlobDocumento(item, tipo);
          zip.file(nombreArchivo, blob);
        } catch {
          errores.push(tipo === 'constancia' ? 'Constancia' : 'DC-3');
        }
      }

      if (errores.length === tipos.length) {
        await Swal.fire({
          title: 'Error',
          text: 'No se pudieron obtener los documentos para empaquetar.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const nombreBase = this.nombreZipDocumentos(item);
      this.descargarBlob(zipBlob, `${nombreBase}.zip`);

      if (errores.length) {
        await Swal.fire({
          title: 'Descarga parcial',
          text: `El ZIP se generó sin: ${errores.join(', ')}.`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
      }
    } catch (err: any) {
      await Swal.fire({
        title: 'Error',
        text: err?.error?.message || 'No se pudo generar el archivo ZIP.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoKey = '';
    }
  }

  private async obtenerBlobDocumento(item: any, tipo: 'constancia' | 'dc3'): Promise<Blob> {
    const doc = tipo === 'constancia' ? item?.constancia : item?.dc3;
    const driveId = String(doc?.drive_file_id || '').trim();
    if (!driveId) {
      throw new Error('Documento no disponible');
    }

    const nombreArchivo = String(doc?.nombre_archivo || `${tipo}_${item?.inscripcion_id || 'documento'}.pdf`);
    return firstValueFrom(
      this.backendServices.descargarArchivoHistorialConstanciasDc3(driveId, nombreArchivo)
    );
  }

  private nombreZipDocumentos(item: any): string {
    const nombre = String(item?.empleado_nombre || 'participante')
      .replace(/[<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 40);
    const id = String(item?.inscripcion_id || 'documento');
    return `Constancia_DC3_${nombre}_${id}`;
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private async descargarDocumento(item: any, tipo: 'constancia' | 'dc3'): Promise<void> {
    const doc = tipo === 'constancia' ? item?.constancia : item?.dc3;
    const nombreArchivo = String(doc?.nombre_archivo || `${tipo}_${item?.inscripcion_id || 'documento'}.pdf`);
    const blob = await this.obtenerBlobDocumento(item, tipo);
    this.descargarBlob(blob, nombreArchivo);
  }
}
