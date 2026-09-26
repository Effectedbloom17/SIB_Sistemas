import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges
} from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackendServices } from 'src/app/services/backend.services';
import { CorreoSugerido, CorreoSugerenciasService } from 'src/app/services/correo-sugerencias.service';
import Swal from 'sweetalert2';

export type EnvioDocumentoCorreoCampo = 'para' | 'cc' | 'cco';

interface CampoCorreoEstado {
  seleccionados: string[];
  input: string;
  filtrados: CorreoSugerido[];
  dropdownVisible: boolean;
}

@Component({
  selector: 'app-envio-documento-correo',
  templateUrl: './envio-documento-correo.component.html',
  styleUrls: ['./envio-documento-correo.component.scss']
})
export class EnvioDocumentoCorreoComponent implements OnChanges, OnDestroy {
  @Input() visible = false;
  /** Asunto prefijado (editable). */
  @Input() asunto = '';
  /** Nombre del PDF adjunto. */
  @Input() nombreAdjunto = 'documento.pdf';
  /** Texto corto del cuerpo (plain). */
  @Input() mensaje = '';
  /** Título de la ventana flotante. */
  @Input() tituloVentana = 'Envío por correo';
  /** Función que genera el PDF a adjuntar. */
  @Input() pdfLoader: (() => Observable<Blob>) | null = null;
  /** API de correo: personal o empresa. */
  @Input() apiBase: 'correo' | 'correo-empresa' = 'correo';

  @Output() cerrado = new EventEmitter<void>();
  @Output() enviado = new EventEmitter<void>();

  campoPara: CampoCorreoEstado = this.crearCampo();
  campoCc: CampoCorreoEstado = this.crearCampo();
  campoCco: CampoCorreoEstado = this.crearCampo();
  mostrarCc = false;
  mostrarCco = false;
  asuntoEdit = '';
  mensajeEdit = '';
  enviando = false;
  error = '';
  minimizado = false;
  progreso = 0;
  etapa = '';

  private destroy$ = new Subject<void>();

  constructor(
    private backend: BackendServices,
    private correoSugerencias: CorreoSugerenciasService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.abrir();
    }
    if (changes['asunto'] && this.visible) {
      this.asuntoEdit = String(this.asunto || '').trim();
    }
    if (changes['mensaje'] && this.visible) {
      this.mensajeEdit = String(this.mensaje || '').trim();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible && !this.enviando) {
      this.cerrar();
    }
  }

  get tituloMostrado(): string {
    return (this.asuntoEdit || '').trim() || this.tituloVentana || 'Mensaje nuevo';
  }

  cerrar(): void {
    if (this.enviando) {
      return;
    }
    this.visible = false;
    this.cerrado.emit();
  }

  minimizar(): void {
    this.minimizado = !this.minimizado;
  }

  mostrarCampoCc(): void {
    this.mostrarCc = true;
  }

  mostrarCampoCco(): void {
    this.mostrarCco = true;
  }

  getCorreoAvatarUrl(sugerencia: CorreoSugerido): string | null {
    return this.correoSugerencias.getCorreoAvatarUrl(sugerencia);
  }

  getCorreoIniciales(sugerencia: CorreoSugerido): string {
    return this.correoSugerencias.getCorreoIniciales(sugerencia);
  }

  onCorreoAvatarError(sugerencia: CorreoSugerido): void {
    this.correoSugerencias.onCorreoAvatarError(sugerencia);
  }

  onCampoInput(campo: EnvioDocumentoCorreoCampo, valor: string): void {
    const estado = this.obtenerCampo(campo);
    estado.input = valor;
    this.actualizarFiltro(campo);
  }

  onCampoKeydown(campo: EnvioDocumentoCorreoCampo, event: KeyboardEvent): void {
    const estado = this.obtenerCampo(campo);
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === 'Tab') {
      if (estado.input.trim()) {
        event.preventDefault();
        this.agregarDesdeTexto(campo, estado.input);
      }
      return;
    }
    if (event.key === 'Backspace' && !estado.input && estado.seleccionados.length) {
      event.preventDefault();
      this.eliminarCorreo(campo, estado.seleccionados[estado.seleccionados.length - 1]);
    }
  }

  onCampoBlur(campo: EnvioDocumentoCorreoCampo): void {
    const estado = this.obtenerCampo(campo);
    setTimeout(() => {
      if (estado.input.trim()) {
        this.agregarDesdeTexto(campo, estado.input);
      }
      estado.dropdownVisible = false;
    }, 160);
  }

  seleccionarSugerido(campo: EnvioDocumentoCorreoCampo, sugerencia: CorreoSugerido): void {
    if (!sugerencia?.email) {
      return;
    }
    this.agregarCorreo(campo, sugerencia.email);
  }

  eliminarCorreo(campo: EnvioDocumentoCorreoCampo, correo: string): void {
    const estado = this.obtenerCampo(campo);
    const target = this.normalizar(correo);
    estado.seleccionados = estado.seleccionados.filter((c) => this.normalizar(c) !== target);
    this.actualizarFiltro(campo);
  }

  enviar(): void {
    if (this.enviando) {
      return;
    }
    this.error = '';

    if (this.campoPara.input.trim()) {
      this.agregarDesdeTexto('para', this.campoPara.input);
    }
    if (this.campoCc.input.trim()) {
      this.agregarDesdeTexto('cc', this.campoCc.input);
    }
    if (this.campoCco.input.trim()) {
      this.agregarDesdeTexto('cco', this.campoCco.input);
    }

    const para = [...this.campoPara.seleccionados];
    const cc = [...this.campoCc.seleccionados];
    const cco = [...this.campoCco.seleccionados];

    if (!para.length) {
      this.error = 'Indica al menos un correo destinatario.';
      return;
    }

    const invalidos = [...para, ...cc, ...cco].filter((c) => !this.correoSugerencias.validarEmail(c));
    if (invalidos.length) {
      this.error = `Correo no válido: ${invalidos.join(', ')}`;
      return;
    }

    const asunto = String(this.asuntoEdit || '').trim();
    if (!asunto) {
      this.error = 'El asunto no puede quedar vacío.';
      return;
    }

    if (!this.pdfLoader) {
      this.error = 'No hay generador de PDF configurado.';
      return;
    }

    this.enviando = true;
    this.error = '';
    void this.prepararPdfYEnviar(para, cc, cco, asunto);
  }

  /**
   * 1) Verifica el PDF.
   * 2) Si falla, vuelve a verificarlo sin avisar.
   * 3) Si vuelve a fallar, lo genera otra vez (misma función que Generar PDF).
   * 4) Solo entonces, si sigue sin un PDF válido, el correo no sale.
   */
  private async prepararPdfYEnviar(
    para: string[],
    cc: string[],
    cco: string[],
    asunto: string
  ): Promise<void> {
    const etapas = [
      { inicio: 8, fin: 28, texto: 'Verificando el PDF…' },
      { inicio: 34, fin: 54, texto: 'Reintentando la verificación del PDF…' },
      { inicio: 60, fin: 78, texto: 'Generando el PDF…' }
    ];

    let pdf: Blob | null = null;
    for (const etapa of etapas) {
      this.setProgreso(etapa.inicio, etapa.texto);
      try {
        const blob = await this.cargarPdf();
        this.setProgreso(etapa.fin - 6, 'Revisando que el archivo sea un PDF…');
        if (await this.esPdfBlob(blob)) {
          this.setProgreso(etapa.fin, 'PDF listo.');
          pdf = blob;
          break;
        }
      } catch {
        // El siguiente paso lo intenta otra vez.
      }
    }

    if (!pdf) {
      this.falloEnvio('No se pudo generar el PDF. El correo no se envió. Guarda la información e inténtalo de nuevo.');
      return;
    }

    await this.enviarConAdjunto(pdf, para, cc, cco, asunto);
  }

  private cargarPdf(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.pdfLoader) {
        reject(new Error('sin generador'));
        return;
      }
      this.pdfLoader()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (blob) => resolve(blob),
          error: (err) => reject(err)
        });
    });
  }

  private async enviarConAdjunto(
    blob: Blob,
    para: string[],
    cc: string[],
    cco: string[],
    asunto: string
  ): Promise<void> {
    try {
      const nombre = String(this.nombreAdjunto || 'documento.pdf').replace(/[\\/:*?"<>|]+/g, '_');
      this.setProgreso(82, 'Preparando el archivo para el correo…');
      const base64 = await this.blobABase64(blob);
      if (!base64 || base64.length < 80) {
        this.falloEnvio('No se pudo preparar el PDF. El correo no se envió.');
        return;
      }
      const mensaje = String(this.mensajeEdit || '').trim()
        || `Se adjunta el documento «${nombre}».`;
      const html = `<p>${this.escaparHtml(mensaje).replace(/\n/g, '<br>')}</p>`;

      para.forEach((c) => this.correoSugerencias.guardarPersonalSiNuevo(c));
      cc.forEach((c) => this.correoSugerencias.guardarPersonalSiNuevo(c));
      cco.forEach((c) => this.correoSugerencias.guardarPersonalSiNuevo(c));

      this.setProgreso(86, 'Enviando el correo…');
      this.backend.enviarCorreoPerfilConProgreso({
        destinatario: para.join(', '),
        cc: cc.length ? cc.join(', ') : undefined,
        cco: cco.length ? cco.join(', ') : undefined,
        asunto,
        mensaje,
        html,
        requiereAdjunto: true,
        adjuntos: [{
          nombre,
          contentType: 'application/pdf',
          contenidoBase64: base64
        }]
      }, this.apiBase)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              const avance = event.loaded / event.total;
              this.setProgreso(86 + avance * 10, 'Enviando el correo…');
              return;
            }
            if (event.type === HttpEventType.Response) {
              const body: any = event.body;
              if (!body || body.success === false || body.adjuntosIncluidos < 1) {
                this.falloEnvio(body?.message || 'El correo no se envió: el archivo no quedó adjunto.');
                return;
              }
              this.setProgreso(100, 'Correo enviado.');
              this.enviando = false;
              this.enviado.emit();
              this.visible = false;
              void Swal.fire({
                icon: 'success',
                title: 'Correo enviado',
                text: 'El PDF se envió correctamente.',
                timer: 2200,
                showConfirmButton: false
              });
              this.cerrado.emit();
            }
          },
          error: (err) => {
            this.falloEnvio(err?.error?.message || 'No se pudo enviar el correo.');
          }
        });
    } catch {
      this.falloEnvio('No se pudo preparar el adjunto PDF.');
    }
  }

  private setProgreso(valor: number, etapa: string): void {
    this.progreso = Math.max(0, Math.min(100, Math.round(valor)));
    this.etapa = etapa;
    this.cdr.detectChanges();
  }

  private falloEnvio(mensaje: string): void {
    this.enviando = false;
    this.progreso = 0;
    this.etapa = '';
    this.error = mensaje;
    this.cdr.detectChanges();
  }

  private abrir(): void {
    this.minimizado = false;
    this.error = '';
    this.enviando = false;
    this.progreso = 0;
    this.etapa = '';
    this.mostrarCc = false;
    this.mostrarCco = false;
    this.campoPara = this.crearCampo();
    this.campoCc = this.crearCampo();
    this.campoCco = this.crearCampo();
    this.asuntoEdit = String(this.asunto || '').trim();
    this.mensajeEdit = String(this.mensaje || '').trim();
    this.correoSugerencias.cargar().pipe(takeUntil(this.destroy$)).subscribe();
  }

  private crearCampo(): CampoCorreoEstado {
    return {
      seleccionados: [],
      input: '',
      filtrados: [],
      dropdownVisible: false
    };
  }

  private obtenerCampo(campo: EnvioDocumentoCorreoCampo): CampoCorreoEstado {
    if (campo === 'cc') return this.campoCc;
    if (campo === 'cco') return this.campoCco;
    return this.campoPara;
  }

  private todosSeleccionados(): string[] {
    return [
      ...this.campoPara.seleccionados,
      ...this.campoCc.seleccionados,
      ...this.campoCco.seleccionados
    ];
  }

  private actualizarFiltro(campo: EnvioDocumentoCorreoCampo): void {
    const estado = this.obtenerCampo(campo);
    estado.filtrados = this.correoSugerencias.filtrar(estado.input, this.todosSeleccionados()).slice(0, 8);
    estado.dropdownVisible = !!(estado.input.trim() && estado.filtrados.length);
  }

  private agregarDesdeTexto(campo: EnvioDocumentoCorreoCampo, texto: string): void {
    const partes = String(texto || '')
      .split(/[,;\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    partes.forEach((p) => this.agregarCorreo(campo, p));
    const estado = this.obtenerCampo(campo);
    estado.input = '';
    this.actualizarFiltro(campo);
  }

  private agregarCorreo(campo: EnvioDocumentoCorreoCampo, correo: string): void {
    const limpio = String(correo || '').trim();
    if (!limpio) {
      return;
    }
    const estado = this.obtenerCampo(campo);
    const key = this.normalizar(limpio);
    if (estado.seleccionados.some((c) => this.normalizar(c) === key)) {
      estado.input = '';
      this.actualizarFiltro(campo);
      return;
    }
    if (!this.correoSugerencias.validarEmail(limpio)) {
      this.error = `Correo no válido: ${limpio}`;
      return;
    }
    this.error = '';
    estado.seleccionados = [...estado.seleccionados, limpio];
    estado.input = '';
    this.actualizarFiltro(campo);
  }

  private normalizar(correo: string): string {
    return String(correo || '').trim().toLowerCase();
  }

  private escaparHtml(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async esPdfBlob(blob: Blob): Promise<boolean> {
    if (!blob || blob.size < 128) {
      return false;
    }
    const tipo = String(blob.type || '').toLowerCase();
    if (tipo.includes('json') || tipo.includes('html') || tipo.startsWith('text/')) {
      return false;
    }
    try {
      const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (bytes.length < 5) {
        return false;
      }
      const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
      return header === '%PDF-';
    } catch {
      return false;
    }
  }

  private blobABase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  }
}
