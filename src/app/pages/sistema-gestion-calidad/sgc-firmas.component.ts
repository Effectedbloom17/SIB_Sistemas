import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { cifrarFirma, descifrarFirma, imagenAPngBase64 } from './sgc-firma-crypto';
import {
  olvidarClaveFirma,
  leerInfoConfianzaFirma,
  recuperarClaveFirma,
  recordarClaveFirma
} from './sgc-firma-device-trust';
import {
  SgcDocCatalogoItem,
  catalogoDocumentosFallback,
  etiquetaDocumentoCatalogo,
  filtrarDocumentosCatalogo
} from './sgc-solicitud-documentos.util';

type VistaFirmas = 'mi-firma' | 'solicitar' | 'pendientes' | 'mias' | 'historial' | 'zonas';

interface UsuarioFirma {
  id: number;
  nombre: string;
  username: string;
  puesto: string;
  rol: string;
}

interface ZonaFirma {
  zona_id: number;
  codigo_formato: string;
  tipo_formato: string;
  clave_zona: string;
  etiqueta: string;
  pagina: number | null;
  pos_x: number | null;
  pos_y: number | null;
  ancho: number | null;
  alto: number | null;
  rol_responsable: string;
  usuario_responsable_id: number | null;
  firmas_requeridas: number;
  origen: string;
  confianza: string;
  notas: string;
  activo: boolean;
  posicion_pendiente: boolean;
}

interface FirmanteSolicitud {
  firmante_id: number;
  usuario_id: number;
  zona_id: number;
  rol_etiqueta: string;
  estado: string;
  observacion: string;
  nombre: string;
  tiene_imagen?: boolean;
  decidido_at?: string | null;
}

interface SolicitudFirma {
  solicitud_id: number;
  codigo: string;
  nombre_documento: string;
  tipo_documento: string;
  registro_clave: string;
  version_etiqueta: string;
  version_sistema: string;
  contenido_resumen: string;
  contenido_hash: string;
  estado: string;
  solicitante_id: number;
  nombre_solicitante: string;
  ruta_documento: string;
  created_at: string;
  firmantes: FirmanteSolicitud[];
  auditoria?: Array<{
    auditoria_id: number;
    accion: string;
    detalle: string;
    nombre: string;
    created_at: string;
    contenido_hash: string;
  }>;
}

interface FilaFirmante {
  usuarioId: number | null;
  zonaId: number;
  rol: string;
}

@Component({
  selector: 'app-sgc-firmas',
  templateUrl: './sgc-firmas.component.html',
  styleUrls: ['./sgc-firmas.component.scss']
})
export class SgcFirmasComponent implements OnInit, OnDestroy {
  vista: VistaFirmas = 'pendientes';
  puedeConfigurar = false;
  usuarioId = 0;

  cargando = false;
  guardando = false;
  error = '';
  aviso = '';

  catalogo: SgcDocCatalogoItem[] = [];
  busquedaDoc = '';
  documento: SgcDocCatalogoItem | null = null;
  version = '';
  registroClave = '';
  resumen = '';
  rutaDocumento = '';
  autosizeTick = 0;

  usuarios: UsuarioFirma[] = [];
  filtroUsuario = '';
  zonasDocumento: ZonaFirma[] = [];
  filasFirmante: FilaFirmante[] = [{ usuarioId: null, zonaId: 0, rol: '' }];
  filaActiva = 0;

  solicitudes: SolicitudFirma[] = [];
  detalle: SolicitudFirma | null = null;
  solicitudAbierta = 0;
  observacion = '';
  motivoInvalidar = '';

  zonas: ZonaFirma[] = [];
  zonaEdit: ZonaFirma | null = null;
  zonaForm = this.zonaFormVacio();
  zonaNueva = this.zonaNuevaVacia();
  estadoFirma: {
    tieneFirma: boolean;
    estado: string;
    actualizada?: string | null;
    creada?: string | null;
    tamano?: number | null;
  } | null = null;
  archivoFirma: File | null = null;
  vistaPreviaFirma: SafeUrl | null = null;
  firmaDesbloqueada: SafeUrl | null = null;
  passwordFirma = '';
  passwordFirma2 = '';
  passwordAprobar = '';
  recordarFirmaDispositivo = true;
  confianzaFirmaActiva = false;
  confianzaFirmaHasta: number | null = null;
  nombreArchivoFirma = '';
  arrastrandoFirma = false;
  verClaveFirma = false;
  verClaveFirma2 = false;
  private arrastreFirma = 0;

  private destroy$ = new Subject<void>();
  private solicitudQuery = 0;

  @ViewChild('firmaPng') firmaPng?: ElementRef<HTMLInputElement>;
  private firmaObjectUrl = '';

  constructor(
    private backend: BackendServices,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.puedeConfigurar = this.auth.puedeGestionarDelegacionesSgc();
    this.usuarioId = Number(this.auth.getUsuarioId() || 0);
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const vista = String(params.get('vista') || '');
      if (vista === 'solicitar') {
        this.vista = 'pendientes';
      } else if (this.esVista(vista)) {
        this.vista = vista;
      }
      this.solicitudQuery = Number(params.get('solicitud') || 0);
      const codigo = String(params.get('codigo') || '').trim();
      const ruta = String(params.get('ruta') || '').trim();
      if (ruta.startsWith('/sistema-gestion-calidad')) this.rutaDocumento = ruta;
      if (codigo) {
        this.busquedaDoc = codigo;
      }
      this.cargarLista();
      this.cargarEstadoFirma();
    });
    this.cargarCatalogo();
    this.cargarUsuarios();
    this.refrescarConfianzaFirma();
  }

  ngOnDestroy(): void {
    if (this.firmaObjectUrl) URL.revokeObjectURL(this.firmaObjectUrl);
    this.destroy$.next();
    this.destroy$.complete();
  }

  elegirImagenFirma(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.aplicarArchivoFirma(input.files?.[0] || null, input);
  }

  alEntrarFirma(event: DragEvent): void {
    event.preventDefault();
    this.arrastreFirma += 1;
    this.arrastrandoFirma = true;
  }

  alMantenerFirma(event: DragEvent): void {
    event.preventDefault();
  }

  alSalirFirma(event: DragEvent): void {
    event.preventDefault();
    this.arrastreFirma = Math.max(0, this.arrastreFirma - 1);
    this.arrastrandoFirma = this.arrastreFirma > 0;
  }

  soltarFirma(event: DragEvent): void {
    event.preventDefault();
    this.arrastreFirma = 0;
    this.arrastrandoFirma = false;
    this.aplicarArchivoFirma(event.dataTransfer?.files?.[0] || null);
  }

  private ocultarFirma(): void {
    this.firmaDesbloqueada = null;
    this.vistaPreviaFirma = null;
    if (this.firmaObjectUrl) {
      URL.revokeObjectURL(this.firmaObjectUrl);
      this.firmaObjectUrl = '';
    }
  }

  etiquetaEstadoFirma(): string {
    if (!this.estadoFirma) return 'Consultando';
    if (this.estadoFirma.tieneFirma) return 'Activa';
    if (this.estadoFirma.estado === 'revocada') return 'Revocada';
    return 'Sin firma';
  }

  tamanoUi(bytes?: number | null): string {
    const n = Number(bytes || 0);
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  private aplicarArchivoFirma(file: File | null, input?: HTMLInputElement): void {
    this.error = '';
    if (!file) return;
    const esPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    if (!esPng) {
      this.error = 'La firma tiene que ser un PNG.';
      if (input) input.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.error = 'La imagen debe pesar menos de 2 MB.';
      if (input) input.value = '';
      return;
    }
    this.archivoFirma = file;
    this.nombreArchivoFirma = file.name;
    if (this.firmaObjectUrl) URL.revokeObjectURL(this.firmaObjectUrl);
    this.firmaObjectUrl = URL.createObjectURL(file);
    this.vistaPreviaFirma = this.sanitizer.bypassSecurityTrustUrl(this.firmaObjectUrl);
  }

  registrarFirma(): void {
    this.error = '';
    this.aviso = '';
    if (!this.archivoFirma) {
      this.error = 'Selecciona la imagen de tu firma.';
      return;
    }
    if (this.passwordFirma.length < 8) {
      this.error = 'La contraseña de la firma debe tener al menos 8 caracteres.';
      return;
    }
    if (this.passwordFirma !== this.passwordFirma2) {
      this.error = 'Las contraseñas no coinciden.';
      return;
    }
    this.guardando = true;
    const tamano = this.archivoFirma.size;
    this.archivoFirma.arrayBuffer().then((bytes) => cifrarFirma(bytes, this.passwordFirma)).then((paquete) => {
      this.backend.guardarFirmaPersonalSgc({ ...paquete, tamano }).pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          this.guardando = false;
          this.estadoFirma = res?.firma || this.estadoFirma;
          this.passwordFirma = '';
          this.passwordFirma2 = '';
          this.archivoFirma = null;
          this.nombreArchivoFirma = '';
          this.ocultarFirma();
          if (this.firmaPng?.nativeElement) this.firmaPng.nativeElement.value = '';
          this.aviso = 'Firma cifrada y guardada. La imagen ya no se muestra.';
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'No se pudo guardar la firma.';
        }
      });
    }).catch(() => {
      this.guardando = false;
      this.error = 'No se pudo cifrar la imagen en este navegador.';
    });
  }

  revocarFirma(): void {
    this.guardando = true;
    this.error = '';
    this.backend.revocarFirmaPersonalSgc().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.guardando = false;
        this.estadoFirma = res?.firma || { tieneFirma: false, estado: 'revocada' };
        this.ocultarFirma();
        this.vistaPreviaFirma = null;
        this.archivoFirma = null;
        this.nombreArchivoFirma = '';
        olvidarClaveFirma(this.usuarioId);
        this.refrescarConfianzaFirma();
        this.aviso = 'Firma revocada. El archivo cifrado se retiró de Drive.';
      },
      error: (err) => {
        this.guardando = false;
        this.error = err?.error?.message || 'No se pudo revocar la firma.';
      }
    });
  }

  get documentosFiltrados(): SgcDocCatalogoItem[] {
    return filtrarDocumentosCatalogo(this.catalogo, this.busquedaDoc, 8);
  }

  get usuariosFiltrados(): UsuarioFirma[] {
    const q = this.filtroUsuario.trim().toLowerCase();
    const base = this.usuarios;
    if (!q) return base.slice(0, 12);
    return base.filter((u) => `${u.nombre} ${u.username} ${u.puesto}`.toLowerCase().includes(q)).slice(0, 12);
  }

  get pendientesCount(): number {
    return this.vista === 'pendientes' ? this.solicitudes.length : 0;
  }

  cambiarVista(vista: VistaFirmas): void {
    this.vista = vista;
    this.error = '';
    this.aviso = '';
    this.detalle = null;
    this.solicitudAbierta = 0;
    if (vista === 'zonas') {
      this.cargarZonasTodas();
      return;
    }
    if (vista === 'mi-firma') {
      this.cargarEstadoFirma();
      return;
    }
    this.cargarLista();
  }

  etiquetaDoc(doc: SgcDocCatalogoItem): string {
    return etiquetaDocumentoCatalogo(doc);
  }

  elegirDocumento(doc: SgcDocCatalogoItem): void {
    this.documento = doc;
    this.busquedaDoc = '';
    this.version = doc.versionVigente || this.version;
    this.cargarZonasDocumento(doc.codigo);
  }

  quitarDocumento(): void {
    this.documento = null;
    this.zonasDocumento = [];
    this.filasFirmante = [{ usuarioId: null, zonaId: 0, rol: '' }];
  }

  agregarFila(): void {
    this.filasFirmante = [...this.filasFirmante, { usuarioId: null, zonaId: 0, rol: '' }];
  }

  quitarFila(index: number): void {
    this.filasFirmante = this.filasFirmante.filter((_, i) => i !== index);
    if (!this.filasFirmante.length) this.agregarFila();
  }

  asignarUsuario(usuario: UsuarioFirma): void {
    const index = Math.min(this.filaActiva, this.filasFirmante.length - 1);
    const filas = [...this.filasFirmante];
    filas[index] = { ...filas[index], usuarioId: usuario.id, rol: filas[index].rol || usuario.puesto };
    this.filasFirmante = filas;
    this.filtroUsuario = '';
  }

  enviarSolicitud(): void {
    this.error = '';
    this.aviso = '';
    if (!this.documento?.codigo) {
      this.error = 'Selecciona un documento del SGC.';
      return;
    }
    this.guardando = true;
    this.backend.crearSolicitudFirmaSgc({
      codigo: this.documento.codigo,
      nombreDocumento: this.documento.nombreDocumento,
      tipoDocumento: this.documento.tipoDocumento || '',
      version: this.version,
      registroClave: this.registroClave,
      resumen: this.resumen,
      rutaDocumento: this.rutaDocumento,
      firmantes: this.filasFirmante
        .filter((f) => f.usuarioId)
        .map((f) => ({ usuarioId: f.usuarioId, zonaId: f.zonaId || 0, rol: f.rol }))
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.guardando = false;
        this.aviso = `Solicitud #${res?.solicitud?.solicitud_id || ''} registrada. Los firmantes la verán en su bandeja y en la campana.`;
        this.resumen = '';
        this.vista = 'mias';
        this.cargarLista();
      },
      error: (err) => {
        this.guardando = false;
        this.error = err?.error?.message || 'No se pudo crear la solicitud.';
      }
    });
  }

  abrir(solicitud: SolicitudFirma): void {
    if (this.solicitudAbierta === solicitud.solicitud_id) {
      this.solicitudAbierta = 0;
      this.detalle = null;
      return;
    }
    this.solicitudAbierta = solicitud.solicitud_id;
    this.detalle = solicitud;
    this.observacion = '';
    this.motivoInvalidar = '';
    this.backend.obtenerSolicitudFirmaSgc(solicitud.solicitud_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res?.solicitud) this.detalle = res.solicitud;
        },
        error: (err) => {
          this.error = err?.error?.message || 'No se pudo abrir la solicitud.';
        }
      });
  }

  olvidarFirmaDispositivo(): void {
    olvidarClaveFirma(this.usuarioId);
    this.passwordAprobar = '';
    this.refrescarConfianzaFirma();
    this.aviso = 'Este dispositivo ya no recuerda la contraseña de tu firma.';
  }

  aprobar(solicitud: SolicitudFirma): void {
    this.error = '';
    this.guardando = true;
    const seguir = (password: string) => {
      if (!password || password.length < 8) {
        this.guardando = false;
        this.error = 'Escribe la contraseña de tu firma para autorizar e imprimir.';
        return;
      }
      this.backend.obtenerFirmaCifradaSgc().pipe(takeUntil(this.destroy$)).subscribe({
        next: (res) => {
          descifrarFirma(res?.paquete, password).then((blob) => imagenAPngBase64(blob)).then((firmaPng) => {
            this.backend.aprobarSolicitudFirmaSgc(solicitud.solicitud_id, this.observacion, firmaPng)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: (respuesta) => {
                  const guardar = this.recordarFirmaDispositivo
                    ? recordarClaveFirma(this.usuarioId, password)
                    : Promise.resolve();
                  Promise.resolve(guardar).finally(() => {
                    this.guardando = false;
                    this.passwordAprobar = '';
                    this.refrescarConfianzaFirma();
                    this.aviso = 'Autorización registrada. Ya se puede imprimir el documento con tu firma.';
                    this.detalle = respuesta?.solicitud || null;
                    this.cargarLista();
                  });
                },
                error: (err) => {
                  this.guardando = false;
                  this.error = err?.error?.message || 'No se pudo aprobar.';
                }
              });
          }).catch(() => {
            this.guardando = false;
            olvidarClaveFirma(this.usuarioId);
            this.refrescarConfianzaFirma();
            this.error = 'La contraseña no abre tu firma.';
          });
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'Registra tu firma PNG en Mis firmas antes de autorizar.';
        }
      });
    };

    if (this.passwordAprobar.length >= 8) {
      seguir(this.passwordAprobar);
      return;
    }
    recuperarClaveFirma(this.usuarioId).then((guardada) => {
      if (guardada) {
        seguir(guardada);
        return;
      }
      this.guardando = false;
      this.error = 'Escribe la contraseña de tu firma para autorizar e imprimir.';
    });
  }

  rechazar(solicitud: SolicitudFirma): void {
    this.guardando = true;
    this.error = '';
    this.backend.rechazarSolicitudFirmaSgc(solicitud.solicitud_id, this.observacion)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.guardando = false;
          this.aviso = 'Solicitud rechazada.';
          this.solicitudAbierta = 0;
          this.detalle = null;
          this.cargarLista();
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'No se pudo rechazar.';
        }
      });
  }

  invalidar(solicitud: SolicitudFirma): void {
    this.guardando = true;
    this.error = '';
    this.backend.invalidarSolicitudFirmaSgc(solicitud.solicitud_id, this.motivoInvalidar)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.guardando = false;
          this.aviso = 'La autorización quedó invalidada y ya no aplica a una versión nueva.';
          this.cargarLista();
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'No se pudo invalidar.';
        }
      });
  }

  puedeDecidir(solicitud: SolicitudFirma | null): boolean {
    if (!solicitud) return false;
    if (!['pendiente', 'parcial'].includes(solicitud.estado)) return false;
    return (solicitud.firmantes || []).some(
      (f) => f.usuario_id === this.usuarioId && f.estado === 'pendiente'
    );
  }

  puedeInvalidar(solicitud: SolicitudFirma | null): boolean {
    if (!solicitud) return false;
    if (!['pendiente', 'parcial', 'autorizada'].includes(solicitud.estado)) return false;
    return this.puedeConfigurar || solicitud.solicitante_id === this.usuarioId;
  }

  editarZona(zona: ZonaFirma): void {
    this.zonaEdit = zona;
    this.zonaForm = {
      pagina: zona.pagina ?? '',
      posX: zona.pos_x ?? '',
      posY: zona.pos_y ?? '',
      ancho: zona.ancho ?? '',
      alto: zona.alto ?? '',
      rolResponsable: zona.rol_responsable || '',
      firmasRequeridas: zona.firmas_requeridas || 1,
      notas: zona.notas || '',
      activo: zona.activo
    };
    this.autosizeTick += 1;
  }

  guardarZona(): void {
    if (!this.zonaEdit) return;
    this.guardando = true;
    this.error = '';
    this.backend.guardarZonaFirmaSgc(this.zonaEdit.zona_id, this.vacioANull(this.zonaForm))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.guardando = false;
          this.aviso = 'Zona actualizada. Si faltan coordenadas, la firma no se inserta en el documento.';
          this.zonaEdit = null;
          this.cargarZonasTodas();
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'No se pudo guardar la zona.';
        }
      });
  }

  crearZona(): void {
    this.guardando = true;
    this.error = '';
    this.backend.crearZonaFirmaSgc(this.vacioANull(this.zonaNueva))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.guardando = false;
          this.aviso = 'Zona agregada. Sin coordenadas queda pendiente de colocación manual.';
          this.zonaNueva = this.zonaNuevaVacia();
          this.cargarZonasTodas();
        },
        error: (err) => {
          this.guardando = false;
          this.error = err?.error?.message || 'No se pudo crear la zona.';
        }
      });
  }

  estadoLabel(estado: string): string {
    const map: Record<string, string> = {
      pendiente: 'Pendiente',
      parcial: 'Parcial',
      autorizada: 'Autorizada',
      rechazada: 'Rechazada',
      invalidada: 'Invalidada',
      aprobada: 'Aprobada'
    };
    return map[estado] || estado;
  }

  confianzaLabel(valor: string): string {
    const map: Record<string, string> = {
      identificado: 'Espacio identificado, sin coordenada',
      pendiente: 'Pendiente de configuración',
      configurada: 'Coordenadas configuradas'
    };
    return map[valor] || valor;
  }

  fechaUi(valor?: string): string {
    if (!valor) return '—';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor).slice(0, 16);
    return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  fechaConfianzaUi(): string {
    if (!this.confianzaFirmaHasta) return '—';
    return new Date(this.confianzaFirmaHasta).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  huellaCorta(hash?: string): string {
    return String(hash || '').slice(0, 12);
  }

  nombreUsuario(id: number | null): string {
    if (!id) return 'Sin asignar';
    return this.usuarios.find((u) => u.id === id)?.nombre || `Usuario ${id}`;
  }

  trackSolicitud(_i: number, item: SolicitudFirma): number {
    return item.solicitud_id;
  }

  private cargarCatalogo(): void {
    this.backend.obtenerCatalogoDocumentosSgcSolicitud()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const lista = Array.isArray(res?.documentos) ? res.documentos : [];
          this.catalogo = lista.length ? lista : catalogoDocumentosFallback();
          this.precargarDocumento();
        },
        error: () => {
          this.catalogo = catalogoDocumentosFallback();
          this.precargarDocumento();
        }
      });
  }

  private precargarDocumento(): void {
    if (!this.documento?.codigo) return;
    const hit = this.catalogo.find(
      (d) => d.codigo.toUpperCase() === this.documento!.codigo.toUpperCase()
    );
    if (!hit) return;
    this.documento = hit;
    if (!this.version) this.version = hit.versionVigente || '';
  }

  private cargarUsuarios(): void {
    this.backend.listarUsuariosFirmaSgc()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.usuarios = res?.usuarios || []; },
        error: () => { this.usuarios = []; }
      });
  }

  private cargarZonasDocumento(codigo: string): void {
    this.backend.listarZonasFirmaSgc(codigo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zonasDocumento = res?.zonas || [];
          this.prepararFilas();
        },
        error: () => {
          this.zonasDocumento = [];
        }
      });
  }

  private prepararFilas(): void {
    const identificadas = this.zonasDocumento.filter((z) => z.activo && z.confianza === 'identificado');
    if (!identificadas.length) {
      this.filasFirmante = [{ usuarioId: null, zonaId: 0, rol: '' }];
      return;
    }
    const filas: FilaFirmante[] = [];
    for (const zona of identificadas) {
      const n = Math.max(1, Number(zona.firmas_requeridas) || 1);
      for (let i = 0; i < n; i += 1) {
        filas.push({
          usuarioId: zona.usuario_responsable_id,
          zonaId: zona.zona_id,
          rol: zona.rol_responsable || zona.etiqueta
        });
      }
    }
    this.filasFirmante = filas;
  }

  private refrescarConfianzaFirma(): void {
    const info = leerInfoConfianzaFirma(this.usuarioId);
    this.confianzaFirmaActiva = info.activo;
    this.confianzaFirmaHasta = info.hasta;
    if (info.activo) this.recordarFirmaDispositivo = true;
  }

  private cargarEstadoFirma(): void {
    this.backend.obtenerFirmaPersonalSgc().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.estadoFirma = res?.firma || { tieneFirma: false, estado: 'sin_firma' }; },
      error: () => { this.estadoFirma = { tieneFirma: false, estado: 'sin_firma' }; }
    });
    this.refrescarConfianzaFirma();
  }

  private cargarLista(): void {
    if (this.vista === 'zonas') {
      this.cargarZonasTodas();
      return;
    }
    if (this.vista === 'mi-firma' || this.vista === 'solicitar') return;
    const vistaApi = this.vista === 'mias' ? 'mias' : this.vista;
    this.cargando = true;
    this.error = '';
    this.backend.listarSolicitudesFirmaSgc(vistaApi)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.solicitudes = res?.solicitudes || [];
          this.cargando = false;
          if (this.solicitudQuery) {
            const hit = this.solicitudes.find((s) => s.solicitud_id === this.solicitudQuery);
            if (hit) this.abrir(hit);
            this.solicitudQuery = 0;
          }
        },
        error: (err) => {
          this.cargando = false;
          this.solicitudes = [];
          this.error = err?.error?.message || 'No se pudieron cargar las solicitudes. Si acabas de actualizar el servidor, reinícialo.';
        }
      });
  }

  private cargarZonasTodas(): void {
    this.cargando = true;
    this.backend.listarZonasFirmaSgc()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zonas = res?.zonas || [];
          this.cargando = false;
        },
        error: (err) => {
          this.cargando = false;
          this.error = err?.error?.message || 'No se pudieron cargar las zonas.';
        }
      });
  }

  private esVista(valor: string): valor is VistaFirmas {
    return ['mi-firma', 'solicitar', 'pendientes', 'mias', 'historial', 'zonas'].includes(valor);
  }

  private zonaFormVacio() {
    return {
      pagina: '' as number | '',
      posX: '' as number | '',
      posY: '' as number | '',
      ancho: '' as number | '',
      alto: '' as number | '',
      rolResponsable: '',
      firmasRequeridas: 1,
      notas: '',
      activo: true
    };
  }

  private zonaNuevaVacia() {
    return {
      codigo: '',
      clave: '',
      etiqueta: '',
      tipoFormato: 'Formato',
      pagina: '' as number | '',
      posX: '' as number | '',
      posY: '' as number | '',
      ancho: '' as number | '',
      alto: '' as number | '',
      rolResponsable: '',
      firmasRequeridas: 1,
      notas: ''
    };
  }

  private vacioANull(form: Record<string, unknown>): Record<string, unknown> {
    const copia: Record<string, unknown> = { ...form };
    for (const clave of ['pagina', 'posX', 'posY', 'ancho', 'alto']) {
      if (copia[clave] === '' || copia[clave] == null) copia[clave] = null;
    }
    return copia;
  }
}
