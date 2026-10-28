import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { SGC_CAPITULOS_CATALOG } from './sgc-formatos.catalog';

GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';

interface UsuarioFirma {
  id: number;
  nombre: string;
  username?: string;
  puesto: string;
}

interface FirmanteDoc {
  usuario_id: number;
  estado: string;
  tiene_imagen?: boolean;
  nombre?: string;
}

interface SolicitudDoc {
  solicitud_id: number;
  estado: string;
  firma_consumida?: boolean;
  firmantes: FirmanteDoc[];
}

@Component({
  selector: 'app-sgc-pedir-firma',
  template: `
    <div class="sgc-pedir" (click)="$event.stopPropagation()">
      <ng-container *ngIf="solicitud?.estado === 'autorizada' && !otraSolicitud; else pedir">
        <div class="sgc-pedir__sello" *ngIf="!solicitud?.firma_consumida">
          <i class="fas fa-check-circle" aria-hidden="true"></i>
          <strong>Firma aplicada y protegida</strong>
          <span>La imagen no está disponible en esta vista.</span>
          <span *ngIf="nombresFirmantes">Autorizó {{ nombresFirmantes }}</span>
        </div>
        <div class="sgc-pedir__sello" *ngIf="solicitud?.firma_consumida">
          <i class="fas fa-check-circle" aria-hidden="true"></i>
          <strong>Firma utilizada</strong>
          <span>Esta solicitud ya se imprimió. La firma sigue guardada para usarla en otra.</span>
        </div>
        <p class="sgc-pedir__err" *ngIf="error">{{ error }}</p>
        <button type="button" class="sgc-pedir__btn" *ngIf="!solicitud?.firma_consumida" [disabled]="enviando" (click)="imprimir()">
          <i class="fas fa-print" aria-hidden="true"></i>
          {{ enviando ? 'Preparando la impresión…' : 'Imprimir documento' }}
        </button>
        <button type="button" class="sgc-pedir__enviar" *ngIf="solicitud?.firma_consumida" (click)="otraSolicitud = true">
          Solicitar otra firma
        </button>
      </ng-container>
      <ng-template #pedir>
        <p class="sgc-pedir__ok" *ngIf="enEspera">
          Solicitud enviada a {{ nombresFirmantes || 'el firmante' }}. En espera de autorización.
        </p>
        <div class="sgc-pedir__panel" *ngIf="!enEspera">
          <label>
            <span>Quién debe firmar</span>
            <input type="search" [(ngModel)]="busqueda" placeholder="Nombre o usuario" (input)="elegido = null" />
          </label>
          <ul *ngIf="busqueda.trim() && !elegido">
            <li *ngFor="let usuario of usuariosFiltrados">
              <button type="button" (click)="elegir(usuario)">
                {{ usuario.nombre }}
                <small *ngIf="usuario.username"> · {{ usuario.username }}</small>
              </button>
            </li>
          </ul>
          <p class="sgc-pedir__elegido" *ngIf="elegido">{{ elegido.nombre }}</p>
          <p class="sgc-pedir__ok" *ngIf="aviso">{{ aviso }}</p>
          <p class="sgc-pedir__err" *ngIf="error">{{ error }}</p>
          <button type="button" class="sgc-pedir__enviar" [disabled]="enviando" (click)="enviar()">
            {{ enviando ? 'Enviando…' : 'Enviar solicitud' }}
          </button>
        </div>
      </ng-template>
      <span class="sgc-pedir__estado" [attr.data-estado]="claveEstado">{{ etiquetaEstado }}</span>
    </div>

    <div #modalFirma class="sgc-pedir__modal" *ngIf="vistaPreviaAbierta" (click)="cerrarVistaPrevia()">
      <div class="sgc-pedir__modal-card" (click)="$event.stopPropagation()" role="dialog" aria-labelledby="sgcFirmaPreviewTitulo">
        <header>
          <div>
            <h3 id="sgcFirmaPreviewTitulo">Vista previa protegida</h3>
            <p>La firma se ve difuminada aquí para evitar copias. Al imprimir saldrá clara y legible.</p>
          </div>
          <button type="button" class="sgc-pedir__modal-x" (click)="cerrarVistaPrevia()" aria-label="Cerrar">×</button>
        </header>
        <div class="sgc-pedir__modal-pages">
          <img *ngFor="let src of paginasDifuminadas" [src]="src" alt="Página con firma protegida" />
        </div>
        <footer>
          <button type="button" class="sgc-pedir__modal-cancel" (click)="cerrarVistaPrevia()">Cancelar</button>
          <button type="button" class="sgc-pedir__btn" [disabled]="enviando || !paginasNitidas.length" (click)="confirmarImpresion()">
            <i class="fas fa-print" aria-hidden="true"></i>
            {{ enviando ? 'Abriendo impresión…' : 'Imprimir con firma legible' }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; max-width: none; overflow: visible; }
    .sgc-pedir { margin-top: .55rem; width: 100%; max-width: none; }
    .sgc-pedir__sello { width: 100%; box-sizing: border-box; }
    .sgc-pedir__btn, .sgc-pedir__enviar {
      border: 0;
      border-radius: 999px;
      background: #0e8f82;
      color: #fff;
      font-weight: 700;
      padding: .4rem .85rem;
    }
    .sgc-pedir__btn:disabled { opacity: .55; }
    .sgc-pedir__sello {
      margin: 0 0 .7rem;
      padding: .95rem .8rem;
      border: 1px solid #d7ebe7;
      border-radius: 14px;
      background: #f4fbf9;
      text-align: center;
    }
    .sgc-pedir__sello i { color: #12ad9d; font-size: 1.2rem; }
    .sgc-pedir__sello strong { display: block; margin-top: .3rem; color: #172033; }
    .sgc-pedir__sello span { display: block; color: #64748b; font-size: .82rem; }
    .sgc-pedir__panel {
      margin-top: .35rem;
      padding: .75rem;
      border: 1px solid #d7ebe7;
      border-radius: 12px;
      background: #fff;
    }
    .sgc-pedir__panel p, .sgc-pedir > p { margin: 0 0 .45rem; color: #64748b; font-size: .86rem; }
    .sgc-pedir label { display: flex; flex-direction: column; gap: .2rem; margin-bottom: .45rem; font-size: .75rem; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .sgc-pedir input { border: 1px solid #d7ebe7; border-radius: 10px; padding: .45rem .6rem; font-weight: 500; text-transform: none; color: #172033; }
    .sgc-pedir ul { list-style: none; margin: 0 0 .45rem; padding: 0; border: 1px solid #d7ebe7; border-radius: 10px; max-height: 160px; overflow: auto; }
    .sgc-pedir li button { width: 100%; text-align: left; background: #fff; border: 0; border-bottom: 1px solid #d7ebe7; padding: .45rem .6rem; }
    .sgc-pedir__ok { color: #067647 !important; }
    .sgc-pedir__err { color: #b42318 !important; }
    .sgc-pedir__elegido { color: #0e8f82 !important; font-weight: 700; }
    .sgc-pedir__estado {
      display: inline-flex;
      align-items: center;
      margin-top: .55rem;
      padding: .2rem .65rem;
      border-radius: 999px;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .02em;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .sgc-pedir__estado[data-estado='pendiente'] {
      background: #fee2e2; color: #991b1b; border-color: #fca5a5;
    }
    .sgc-pedir__estado[data-estado='enviada'] {
      background: #fff7ed; color: #9a3412; border-color: #fdba74;
    }
    .sgc-pedir__estado[data-estado='autorizada'] {
      background: #dcfce7; color: #166534; border-color: #86efac;
    }
    .sgc-pedir__estado[data-estado='utilizada'] {
      background: #e0f2fe; color: #075985; border-color: #7dd3fc;
    }
    .sgc-pedir__estado[data-estado='rechazada'] {
      background: #fef2f2; color: #b91c1c; border-color: #fecaca;
    }
    .sgc-pedir__modal {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      background: rgba(15, 23, 42, .55);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: .75rem;
      box-sizing: border-box;
    }
    .sgc-pedir__modal-card {
      width: min(920px, 100%);
      height: min(82vh, 860px);
      max-height: 82vh;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, .28);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
    }
    .sgc-pedir__modal-card header,
    .sgc-pedir__modal-card footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .8rem;
      padding: .85rem 1rem;
      background: #fff;
    }
    .sgc-pedir__modal-card header {
      align-items: flex-start;
      border-bottom: 1px solid #e2e8f0;
    }
    .sgc-pedir__modal-card footer {
      border-top: 1px solid #e2e8f0;
      justify-content: flex-end;
      flex-wrap: wrap;
      box-shadow: 0 -8px 24px rgba(15, 23, 42, .06);
      position: relative;
      z-index: 2;
    }
    .sgc-pedir__modal-card h3 { margin: 0; font-size: 1.05rem; color: #172033; }
    .sgc-pedir__modal-card header p { margin: .25rem 0 0; color: #64748b; font-size: .86rem; }
    .sgc-pedir__modal-x {
      border: 0;
      background: transparent;
      font-size: 1.5rem;
      line-height: 1;
      color: #64748b;
      padding: 0 .2rem;
    }
    .sgc-pedir__modal-pages {
      min-height: 0;
      overflow: auto;
      padding: 1rem;
      background: #eef2f7;
      display: grid;
      gap: .85rem;
      align-content: start;
    }
    .sgc-pedir__modal-pages img {
      width: 100%;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
    }
    .sgc-pedir__modal-cancel {
      border: 1px solid #d7ebe7;
      background: #fff;
      color: #0e8f82;
      border-radius: 999px;
      font-weight: 700;
      padding: .55rem 1rem;
    }
    .sgc-pedir__modal-card footer .sgc-pedir__btn {
      padding: .55rem 1.1rem;
      font-size: .95rem;
    }
  `]
})
export class SgcPedirFirmaComponent implements OnInit, OnDestroy {
  private modalEnBody: HTMLElement | null = null;

  @ViewChild('modalFirma')
  set modalFirma(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (!el) {
      this.modalEnBody = null;
      return;
    }
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
    this.modalEnBody = el;
  }
  enviando = false;
  aviso = '';
  error = '';
  busqueda = '';
  codigo = '';
  nombre = '';
  solicitud: SolicitudDoc | null = null;
  otraSolicitud = false;
  elegido: UsuarioFirma | null = null;
  vistaPreviaAbierta = false;
  paginasDifuminadas: string[] = [];
  paginasNitidas: string[] = [];
  private solicitudImpresionId = 0;
  private usuarios: UsuarioFirma[] = [];
  private marcoImpresion: HTMLIFrameElement | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private backend: BackendServices
  ) {}

  ngOnInit(): void {
    const aplicar = () => {
      let cursor: ActivatedRoute | null = this.route;
      let slug = '';
      while (cursor) {
        slug = slug || String(cursor.snapshot.paramMap.get('codigo') || '');
        cursor = cursor.parent;
      }
      const slugNorm = slug.toLowerCase();
      for (const cap of Object.values(SGC_CAPITULOS_CATALOG)) {
        const hit = cap.plantillas.find((p) => String(p.previewSlug || '').toLowerCase() === slugNorm);
        if (hit) {
          this.codigo = hit.codigo;
          this.nombre = hit.titulo;
          this.consultar();
          return;
        }
      }
      this.codigo = slug.toUpperCase();
      this.nombre = slug;
      this.consultar();
    };
    aplicar();
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(() => aplicar());
    this.cargarUsuarios();
    interval(15000).pipe(takeUntil(this.destroy$)).subscribe(() => this.consultar());
  }

  ngOnDestroy(): void {
    this.marcoImpresion?.remove();
    this.modalEnBody?.remove();
    this.modalEnBody = null;
    this.cerrarVistaPrevia();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get claveEstado(): string {
    if (!this.solicitud || this.otraSolicitud) return 'pendiente';
    if (this.solicitud.estado === 'rechazada') return 'rechazada';
    if (this.solicitud.estado === 'autorizada' && this.solicitud.firma_consumida) return 'utilizada';
    if (this.solicitud.estado === 'autorizada') return 'autorizada';
    if (this.solicitud.estado === 'pendiente' || this.solicitud.estado === 'parcial') return 'enviada';
    return 'pendiente';
  }

  get etiquetaEstado(): string {
    switch (this.claveEstado) {
      case 'enviada': return 'Solicitud enviada';
      case 'autorizada': return 'Autorizada';
      case 'utilizada': return 'Firma utilizada';
      case 'rechazada': return 'Rechazada';
      default: return 'Pendiente de firma';
    }
  }

  get usuariosFiltrados(): UsuarioFirma[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return [];
    return this.usuarios
      .filter((u) => `${u.nombre} ${u.username || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  get enEspera(): boolean {
    return this.solicitud?.estado === 'pendiente' || this.solicitud?.estado === 'parcial';
  }

  get nombresFirmantes(): string {
    return (this.solicitud?.firmantes || [])
      .filter((f) => f.estado === 'aprobada' || f.estado === 'pendiente')
      .map((f) => f.nombre)
      .filter(Boolean)
      .join(', ');
  }

  get listaParaImprimir(): boolean {
    const firmantes = (this.solicitud?.firmantes || []).filter((f) => f.estado === 'aprobada');
    return this.solicitud?.estado === 'autorizada' && firmantes.length > 0 && firmantes.every((f) => !!f.tiene_imagen);
  }

  elegir(usuario: UsuarioFirma): void {
    this.elegido = usuario;
    this.busqueda = '';
  }

  enviar(): void {
    this.error = '';
    this.aviso = '';
    if (!this.usuarios.length) this.cargarUsuarios();
    if (!this.codigo) {
      this.error = 'No se identificó el formato.';
      return;
    }
    if (!this.elegido) {
      this.error = 'Elige el usuario que debe firmar.';
      return;
    }
    const ruta = this.rutaActual();
    if (!ruta) {
      this.error = 'No se identificó el documento abierto.';
      return;
    }
    this.enviando = true;
    this.backend.crearSolicitudFirmaSgc({
      codigo: this.codigo,
      nombreDocumento: this.nombre || this.codigo,
      tipoDocumento: 'Formato',
      version: this.codigo,
      resumen: `Autorización de firma del documento ${this.codigo}.`,
      origen: 'version-firmada',
      rutaDocumento: ruta,
      firmantes: [{ usuarioId: this.elegido.id, zonaId: 0, rol: 'Firmante' }]
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.enviando = false;
        this.otraSolicitud = false;
        this.aviso = 'Solicitud enviada para este documento.';
        this.consultar();
      },
      error: (err) => {
        this.enviando = false;
        this.error = err?.error?.message || 'No se pudo enviar la solicitud.';
      }
    });
  }

  imprimir(): void {
    this.error = '';
    if (!this.solicitud || this.solicitud.firma_consumida) return;
    if (!this.listaParaImprimir) {
      this.error = 'Esta autorización no guardó el PNG. Hay que aprobarla otra vez en Firmas, con la contraseña de la firma.';
      return;
    }
    const solicitudId = this.solicitud.solicitud_id;
    this.enviando = true;
    this.backend.descargarPdfFirmadoSgc(solicitudId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        this.prepararVistaPrevia(blob, solicitudId).then(() => {
          this.enviando = false;
        }).catch(() => {
          this.enviando = false;
          this.error = 'No se pudo preparar la vista previa del documento.';
        });
      },
      error: (err) => {
        this.enviando = false;
        this.leerError(err);
      }
    });
  }

  cerrarVistaPrevia(): void {
    this.vistaPreviaAbierta = false;
    this.paginasDifuminadas = [];
    this.paginasNitidas = [];
    this.solicitudImpresionId = 0;
  }

  confirmarImpresion(): void {
    if (!this.paginasNitidas.length || !this.solicitudImpresionId) return;
    const solicitudId = this.solicitudImpresionId;
    const nitidas = [...this.paginasNitidas];
    this.cerrarVistaPrevia();
    this.enviando = true;
    this.enviarAImpresora(nitidas).then(() => {
      this.enviando = false;
      this.backend.consumirFirmaSgc(solicitudId).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => this.consultar(),
        error: () => this.consultar()
      });
    }).catch(() => {
      this.enviando = false;
      this.error = 'No se pudo abrir la impresión del documento.';
    });
  }

  private async prepararVistaPrevia(blob: Blob, solicitudId: number): Promise<void> {
    const { nitidas, difuminadas } = await this.renderizarPaginas(blob);
    this.paginasNitidas = nitidas;
    this.paginasDifuminadas = difuminadas;
    this.solicitudImpresionId = solicitudId;
    this.vistaPreviaAbierta = true;
  }

  private async renderizarPaginas(blob: Blob): Promise<{ nitidas: string[]; difuminadas: string[] }> {
    const data = new Uint8Array(await blob.arrayBuffer());
    let pdf;
    try {
      pdf = await getDocument({ data }).promise;
    } catch {
      pdf = await getDocument({ data, disableWorker: true } as never).promise;
    }
    const nitidas: string[] = [];
    const difuminadas: string[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const pagina = await pdf.getPage(n);
      const viewport = pagina.getViewport({ scale: 1.5 });
      const lienzo = document.createElement('canvas');
      lienzo.width = viewport.width;
      lienzo.height = viewport.height;
      const ctx = lienzo.getContext('2d');
      if (!ctx) throw new Error('lienzo');
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      if (this.lienzoEnBlanco(lienzo)) continue;
      nitidas.push(lienzo.toDataURL('image/png'));
      const copia = document.createElement('canvas');
      copia.width = lienzo.width;
      copia.height = lienzo.height;
      const ctxCopia = copia.getContext('2d');
      if (!ctxCopia) throw new Error('copia');
      ctxCopia.drawImage(lienzo, 0, 0);
      this.protegerZonaFirma(copia);
      difuminadas.push(copia.toDataURL('image/png'));
    }
    if (!nitidas.length) throw new Error('vacio');
    return { nitidas, difuminadas };
  }

  private async enviarAImpresora(paginas: string[]): Promise<void> {
    if (this.marcoImpresion) this.marcoImpresion.remove();
    const marco = document.createElement('iframe');
    marco.setAttribute('title', 'Impresión del documento');
    marco.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(marco);
    this.marcoImpresion = marco;
    const doc = marco.contentDocument;
    if (!doc) throw new Error('marco');
    const cuerpo = paginas.map((src) => `<img src="${src}" alt="">`).join('');
    doc.open();
    doc.write(`<!doctype html><html><head><title>Imprimir documento</title>
      <style>
        @page { margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        img { display: block; width: 100%; height: auto; break-after: page; page-break-after: always; }
        img:last-of-type { break-after: auto; page-break-after: auto; }
      </style></head><body>${cuerpo}</body></html>`);
    doc.close();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    marco.contentWindow?.focus();
    marco.contentWindow?.print();
  }

  /** Solo para la vista previa en pantalla: no se usa en la impresión. */
  private protegerZonaFirma(lienzo: HTMLCanvasElement): void {
    const ctx = lienzo.getContext('2d');
    if (!ctx) return;
    const alto = Math.max(48, Math.floor(lienzo.height * 0.2));
    const y0 = lienzo.height - alto;
    const bloque = Math.max(6, Math.floor(lienzo.width / 120));
    const muestra = ctx.getImageData(0, y0, lienzo.width, alto);
    const out = ctx.createImageData(lienzo.width, alto);
    for (let y = 0; y < alto; y += bloque) {
      for (let x = 0; x < lienzo.width; x += bloque) {
        const i = ((y * lienzo.width) + x) * 4;
        const r = muestra.data[i];
        const g = muestra.data[i + 1];
        const b = muestra.data[i + 2];
        const a = muestra.data[i + 3];
        for (let dy = 0; dy < bloque && y + dy < alto; dy += 1) {
          for (let dx = 0; dx < bloque && x + dx < lienzo.width; dx += 1) {
            const j = (((y + dy) * lienzo.width) + (x + dx)) * 4;
            out.data[j] = r;
            out.data[j + 1] = g;
            out.data[j + 2] = b;
            out.data[j + 3] = a;
          }
        }
      }
    }
    ctx.putImageData(out, 0, y0);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#0e8f82';
    ctx.font = `bold ${Math.max(12, Math.floor(lienzo.width / 42))}px sans-serif`;
    ctx.translate(lienzo.width * 0.55, lienzo.height - alto * 0.45);
    ctx.rotate(-0.22);
    ctx.fillText('FIRMA PROTEGIDA', 0, 0);
    ctx.restore();
  }

  private lienzoEnBlanco(lienzo: HTMLCanvasElement): boolean {
    const ctx = lienzo.getContext('2d');
    if (!ctx) return false;
    const pasoX = Math.max(8, Math.floor(lienzo.width / 40));
    const pasoY = Math.max(8, Math.floor(lienzo.height / 40));
    let claros = 0;
    let total = 0;
    for (let y = 0; y < lienzo.height; y += pasoY) {
      const fila = ctx.getImageData(0, y, lienzo.width, 1).data;
      for (let x = 0; x < fila.length; x += pasoX * 4) {
        total += 1;
        if (fila[x] > 248 && fila[x + 1] > 248 && fila[x + 2] > 248) claros += 1;
      }
    }
    return total > 0 && claros / total > 0.985;
  }

  private leerError(err: { error?: Blob | { message?: string } }): void {
    const cuerpo = err?.error;
    if (cuerpo instanceof Blob) {
      cuerpo.text().then((texto) => {
        try {
          this.error = JSON.parse(texto)?.message || 'No se pudo imprimir el PDF del documento.';
        } catch (_error) {
          this.error = 'No se pudo imprimir el PDF del documento.';
        }
      });
      return;
    }
    this.error = cuerpo?.message || 'No se pudo imprimir el PDF del documento.';
  }

  private consultar(despues?: () => void): void {
    if (!this.codigo) return;
    this.backend.consultarFirmaDocumentoSgc(this.codigo, this.rutaActual()).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.solicitud = res?.solicitud || null;
        if (despues) despues();
      },
      error: () => {
        this.solicitud = null;
        this.enviando = false;
      }
    });
  }

  private rutaActual(): string {
    const hash = (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '');
    const [path, query = ''] = hash.split('?');
    if (!path.startsWith('/sistema-gestion-calidad')) return '';
    const folio = new URLSearchParams(query).get('folio') || '';
    return folio ? `${path}?folio=${folio}` : path;
  }

  private cargarUsuarios(): void {
    this.backend.listarUsuariosFirmaSgc().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.usuarios = res?.usuarios || []; },
      error: () => { this.usuarios = []; }
    });
  }
}
