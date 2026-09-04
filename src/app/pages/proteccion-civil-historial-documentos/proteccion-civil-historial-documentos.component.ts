import { Component, OnInit, Input, OnChanges, SimpleChanges, HostListener, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import { Subscription } from 'rxjs';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';
import { parsearFechaFlexible } from 'src/app/utils/fecha.util';

interface DocumentoAprobado {
  documento_id: number;
  nombre_documento: string;
  nombre_requisito?: string;
  estatus: string;
  nombre_archivo: string;
  archivo_url: string;
  fecha_subida: string;
  comentarios: string | null;
  especificacion: string;
  tipo_entrada?: 'archivo' | 'texto';
  historial_id?: number;
  drive_file_id?: string;
  mime_type?: string;
  fecha_creacion?: string;
  pipc_titulo?: string;
}

interface TextoCapturadoHistorial {
  historial_texto_id: number;
  empresa_id: number;
  documento_id: number;
  documento_padre_id?: number | null;
  nombre_documento_padre?: string | null;
  nombre_campo: string;
  valor_texto: string;
  fecha_captura?: string;
  fecha_creacion?: string;
  fecha_actualizacion?: string;
  pipc_titulo?: string;
}

interface EmpresaHistorial {
  empresa_id: number;
  nombre_empresa: string;
  rfc?: string;
  estado?: string;
  ciudad?: string;
  logo?: string | null;
  logo_url?: string | null;
  total_pipcs: number;
  total_documentos: number;
}

interface PipHistorial {
  titulo: string;
  anio: number;
  fechaReferencia: Date;
  totalDocumentos: number;
  totalTextos: number;
  documentoPadreId?: number;
}

type VistaHistorial = 'empresas' | 'pipcs' | 'documentos';

@Component({
  selector: 'app-proteccion-civil-historial-documentos',
  templateUrl: './proteccion-civil-historial-documentos.component.html',
  styleUrls: ['./proteccion-civil-historial-documentos.component.scss']
})
export class ProteccionCivilHistorialDocumentosComponent implements OnInit, OnChanges, OnDestroy {
  @Input() embebido = false;
  @Input() empresaIdEmbebida: number | null = null;
  readonly acceptedPcFileTypes: string = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.xls,.xlsx,.ppt,.pptx';
  private readonly allowedPcMimeTypes: string[] = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];
  private readonly allowedPcExtensions: string[] = [
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.xls', '.xlsx', '.ppt', '.pptx'
  ];

  vistaActual: VistaHistorial = 'empresas';
  esPerfilEmpresa = false;
  esPerfilAdmin = false;

  empresaId: number | null = null;
  nombreEmpresa: string = '';

  empresas: EmpresaHistorial[] = [];
  empresasFiltradas: EmpresaHistorial[] = [];
  empresaSeleccionada: EmpresaHistorial | null = null;
  textoBusquedaEmpresa = '';
  estadoSeleccionado = '';
  municipioSeleccionado = '';
  estados: string[] = [];
  municipios: string[] = [];

  pipcs: PipHistorial[] = [];
  pipcsFiltrados: PipHistorial[] = [];
  pipcSeleccionado: PipHistorial | null = null;
  anoSeleccionado = 0;
  anosDisponibles: number[] = [];
  textoBusquedaPipc = '';

  documentosAprobados: DocumentoAprobado[] = [];
  documentosPipcDetalle: DocumentoAprobado[] = [];
  textosCapturados: TextoCapturadoHistorial[] = [];
  textosPipcDetalle: TextoCapturadoHistorial[] = [];
  textoBusquedaDocumentos = '';

  cargando = false;
  cargandoEmpresas = false;
  cargandoPipcs = false;
  cargandoDetalle = false;

  mostrarModalDetalle = false;
  documentoSeleccionado: DocumentoAprobado | null = null;

  mostrarVisor = false;
  urlVisor = '';
  nombreVisor = '';
  cargandoVisor = false;
  visorEsImagen = false;
  previewBlobVisor: Blob | null = null;
  visorError: string | null = null;
  visorProgreso = 0;
  visorEtiqueta = 'Preparando vista previa…';
  visorLento = false;
  archivoVisorId: number | null = null;
  documentoVisorActual: DocumentoAprobado | null = null;
  private visorSeq = 0;
  private visorSub?: Subscription;

  private logosRotos = new Set<number>();
  private mapaNombresRequisito = new Map<number, string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backendService: BackendServices,
    private authService: AuthService,
    private pdfPreviewLoader: PdfPreviewLoaderService
  ) {}

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarOverlaysHistorialPc(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.mostrarVisor) {
      event.preventDefault();
      this.cerrarVisor();
      return;
    }
    if (this.mostrarModalDetalle) {
      event.preventDefault();
      this.mostrarModalDetalle = false;
      this.documentoSeleccionado = null;
    }
  }

  ngOnInit(): void {
    this.resolverEmpresaId();
    this.inicializarVistaHistorial();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.embebido) {
      return;
    }
    if (changes['empresaIdEmbebida'] && this.empresaIdEmbebida) {
      this.resolverEmpresaId();
      this.inicializarVistaHistorial();
    }
  }

  private resolverEmpresaId(): void {
    if (this.embebido && this.empresaIdEmbebida) {
      this.empresaId = Number(this.empresaIdEmbebida);
      return;
    }
    const idParam = this.route.snapshot.paramMap.get('id');
    this.empresaId = idParam ? Number(idParam) : null;
  }

  private inicializarVistaHistorial(): void {
    this.esPerfilAdmin = this.authService.esAdministradorOSuperior()
      || this.authService.tieneAlgunRol(['proteccion_civil']);
    this.esPerfilEmpresa = !this.esPerfilAdmin
      && this.authService.esUsuarioEmpresa();

    if (this.esPerfilEmpresa && !this.empresaId) {
      this.empresaId = this.authService.getEmpresaId();
    }

    if (this.embebido && this.empresaId) {
      this.vistaActual = 'pipcs';
      this.cargarPipcsEmpresa();
      return;
    }

    if (this.esPerfilEmpresa) {
      this.vistaActual = 'pipcs';
      this.cargarPipcsEmpresa();
    } else {
      this.cargarEmpresas();
      if (this.empresaId) {
        this.vistaActual = 'pipcs';
      }
    }
  }

  get mostrarSelectorEmpresas(): boolean {
    if (this.embebido) {
      return false;
    }
    return !this.esPerfilEmpresa;
  }

  get tituloPrincipal(): string {
    if (this.vistaActual === 'documentos') {
      return this.pipcSeleccionado?.titulo || 'Documentos aprobados';
    }
    if (this.esPerfilEmpresa) {
      return 'Historial de documentos aprobados';
    }
    return 'Historial de documentos aprobados';
  }

  get totalPipcsVisibles(): number {
    return this.pipcsFiltrados.length;
  }

  get totalDocumentosDetalle(): number {
    return this.documentosPipcDetalle.length + this.textosPipcDetalle.length;
  }

  private esArchivoPermitidoPC(file: File): boolean {
    const nombre = String(file?.name || '').toLowerCase();
    const extension = nombre.includes('.') ? `.${nombre.split('.').pop()}` : '';
    const mime = String(file?.type || '').toLowerCase();
    return this.allowedPcExtensions.includes(extension) || this.allowedPcMimeTypes.includes(mime);
  }

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendService.obtenerEmpresasProteccionCivil().subscribe(
      (resp: any) => {
        const lista = Array.isArray(resp?.empresas) ? resp.empresas : [];
        this.empresas = lista.map((e: any) => ({
          empresa_id: Number(e.empresa_id),
          nombre_empresa: e.nombre_empresa || 'Empresa sin nombre',
          rfc: e.rfc || '',
          estado: e.estado || '',
          ciudad: e.ciudad || '',
          logo: e.logo || null,
          logo_url: e.logo_url || null,
          total_pipcs: 0,
          total_documentos: Number(e.documentos_completos || 0)
        }));
        this.actualizarEstadosDisponibles();
        this.filtrarEmpresas();

        if (this.empresaId) {
          const encontrada = this.empresas.find(e => e.empresa_id === this.empresaId) || null;
          if (encontrada) {
            this.seleccionarEmpresa(encontrada, false);
          } else {
            this.cargarPipcsEmpresa();
          }
        }

        this.cargandoEmpresas = false;
      },
      () => {
        this.empresas = [];
        this.empresasFiltradas = [];
        this.cargandoEmpresas = false;
      }
    );
  }

  filtrarEmpresas(): void {
    const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
    this.empresasFiltradas = this.empresas.filter((empresa) => {
      const coincideTexto = !texto
        || empresa.nombre_empresa.toLowerCase().includes(texto)
        || String(empresa.rfc || '').toLowerCase().includes(texto);
      const coincideEstado = !this.estadoSeleccionado || empresa.estado === this.estadoSeleccionado;
      const coincideMunicipio = !this.municipioSeleccionado || empresa.ciudad === this.municipioSeleccionado;
      return coincideTexto && coincideEstado && coincideMunicipio;
    });
  }

  onEstadoChange(): void {
    this.municipioSeleccionado = '';
    this.actualizarMunicipiosDisponibles();
    this.filtrarEmpresas();
  }

  private actualizarEstadosDisponibles(): void {
    this.estados = [...new Set(this.empresas.map(e => e.estado).filter(Boolean))].sort();
    this.actualizarMunicipiosDisponibles();
  }

  private actualizarMunicipiosDisponibles(): void {
    const base = this.estadoSeleccionado
      ? this.empresas.filter(e => e.estado === this.estadoSeleccionado)
      : this.empresas;
    this.municipios = [...new Set(base.map(e => e.ciudad).filter(Boolean))].sort();
  }

  seleccionarEmpresa(empresa: EmpresaHistorial, cambiarVista = true): void {
    this.empresaSeleccionada = empresa;
    this.empresaId = empresa.empresa_id;
    this.nombreEmpresa = empresa.nombre_empresa;
    this.pipcSeleccionado = null;
    this.vistaActual = cambiarVista ? 'pipcs' : this.vistaActual;
    this.cargarPipcsEmpresa();
  }

  limpiarSeleccionEmpresa(): void {
    this.empresaSeleccionada = null;
    this.empresaId = null;
    this.pipcs = [];
    this.pipcsFiltrados = [];
    this.pipcSeleccionado = null;
    this.vistaActual = 'empresas';
  }

  cargarPipcsEmpresa(): void {
    if (!this.empresaId) return;

    this.cargandoPipcs = true;
    this.cargando = true;
    this.mapaNombresRequisito.clear();

    this.backendService.obtenerHistorialDocumentosPC(this.empresaId).subscribe(
      (histResp: any) => {
        this.backendService.obtenerDocumentosProteccionCivil(this.empresaId!).subscribe(
          (docResp: any) => {
            if (docResp?.nombre_empresa) {
              this.nombreEmpresa = docResp.nombre_empresa;
            }
            this.indexarNombresRequisito(docResp?.documentos || []);
            this.procesarHistorial(histResp, docResp);
            this.cargandoPipcs = false;
            this.cargando = false;
          },
          () => {
            this.procesarHistorial(histResp, null);
            this.cargandoPipcs = false;
            this.cargando = false;
          }
        );
      },
      () => {
        this.backendService.obtenerDocumentosProteccionCivil(this.empresaId!).subscribe(
          (docResp: any) => {
            if (docResp?.nombre_empresa) {
              this.nombreEmpresa = docResp.nombre_empresa;
            }
            this.indexarNombresRequisito(docResp?.documentos || []);
            this.procesarHistorial(null, docResp);
            this.cargandoPipcs = false;
            this.cargando = false;
          },
          () => {
            this.documentosAprobados = [];
            this.textosCapturados = [];
            this.construirPipcs([]);
            this.cargandoPipcs = false;
            this.cargando = false;
          }
        );
      }
    );
  }

  private indexarNombresRequisito(documentos: any[]): void {
    for (const padre of documentos) {
      const tituloPipc = this.obtenerTituloPipcDesdePadre(padre);
      if (Array.isArray(padre.subdocumentos)) {
        for (const sub of padre.subdocumentos) {
          if (sub.documento_id) {
            this.mapaNombresRequisito.set(Number(sub.documento_id), sub.nombre_documento || sub.nombre);
          }
          if (sub.estatus === 'aprobado') {
            // noop - usado al fusionar
          }
        }
      }
      if (padre.documento_id && !padre.documento_padre_id) {
        // padre itself
      }
      if (tituloPipc && padre.documento_id) {
        // map parent id to pipc title for matching
      }
    }
  }

  private procesarHistorial(histResp: any, docResp: any): void {
    const historialMap = new Map<number, any>();
    const textosHistorial = Array.isArray(histResp?.textos) ? histResp.textos : [];

    if (histResp?.success && histResp.documentos) {
      for (const h of histResp.documentos) {
        if (h.documento_id) {
          historialMap.set(Number(h.documento_id), h);
        }
      }
    }

    this.textosCapturados = textosHistorial.map((t: any) => ({
      historial_texto_id: Number(t.historial_texto_id || 0),
      empresa_id: Number(t.empresa_id || this.empresaId || 0),
      documento_id: Number(t.documento_id || 0),
      documento_padre_id: t.documento_padre_id !== undefined ? Number(t.documento_padre_id) : null,
      nombre_documento_padre: String(t.nombre_documento_padre || '').trim() || null,
      nombre_campo: String(t.nombre_campo || '').trim(),
      valor_texto: String(t.valor_texto || '').trim(),
      fecha_captura: String(t.fecha_captura || '').trim(),
      fecha_creacion: t.fecha_creacion,
      fecha_actualizacion: t.fecha_actualizacion,
      pipc_titulo: String(t.nombre_documento_padre || '').trim() || null
    })).filter((t: TextoCapturadoHistorial) => !!t.valor_texto);

    const docMap = new Map<number, DocumentoAprobado>();

    if (docResp?.success) {
      const todos = this.aplanarDocumentos(docResp.documentos || []);
      for (const d of todos.filter(x => x.estatus === 'aprobado' && (x.nombre_archivo || x.tipo_entrada === 'texto'))) {
        const hist = historialMap.get(d.documento_id);
        if (hist) {
          d.historial_id = hist.historial_id;
          d.drive_file_id = hist.drive_file_id;
          d.mime_type = hist.mime_type;
        }
        const pipcTitulo = this.resolverTituloPipcDocumento(d, docResp.documentos || []);
        d.pipc_titulo = pipcTitulo;
        d.nombre_requisito = this.mapaNombresRequisito.get(d.documento_id) || d.nombre_documento;
        if (d.nombre_archivo || d.tipo_entrada !== 'texto') {
          docMap.set(d.documento_id, d);
        }
      }
    }

    if (histResp?.success && histResp.documentos) {
      for (const h of histResp.documentos) {
        const docId = Number(h.documento_id || 0);
        if (docId && docMap.has(docId)) continue;

        const pipcTitulo = String(h.nombre_documento || '').trim();
        docMap.set(docId || Number(h.historial_id), {
          documento_id: docId,
          nombre_documento: pipcTitulo,
          nombre_requisito: h.nombre_archivo || pipcTitulo,
          estatus: 'aprobado',
          nombre_archivo: h.nombre_archivo,
          archivo_url: h.drive_file_id,
          fecha_subida: h.fecha_creacion,
          comentarios: null,
          especificacion: '',
          historial_id: h.historial_id,
          drive_file_id: h.drive_file_id,
          mime_type: h.mime_type,
          fecha_creacion: h.fecha_creacion,
          pipc_titulo: pipcTitulo
        });
      }
    }

    this.documentosAprobados = Array.from(docMap.values())
      .filter(d => !!d.nombre_archivo && d.estatus === 'aprobado');

    this.construirPipcs(this.documentosAprobados);

    if (this.empresaSeleccionada) {
      this.empresaSeleccionada.total_pipcs = this.pipcs.length;
      this.empresaSeleccionada.total_documentos = this.documentosAprobados.length;
    }
  }

  private construirPipcs(documentos: DocumentoAprobado[]): void {
    const grupos = new Map<string, { docs: DocumentoAprobado[]; textos: TextoCapturadoHistorial[] }>();

    for (const doc of documentos) {
      const titulo = String(doc.pipc_titulo || doc.nombre_documento || 'PIPC').trim();
      if (!grupos.has(titulo)) {
        grupos.set(titulo, { docs: [], textos: [] });
      }
      grupos.get(titulo)!.docs.push(doc);
    }

    for (const texto of this.textosCapturados) {
      const titulo = String(texto.pipc_titulo || texto.nombre_documento_padre || 'PIPC').trim();
      if (!grupos.has(titulo)) {
        grupos.set(titulo, { docs: [], textos: [] });
      }
      grupos.get(titulo)!.textos.push(texto);
    }

    this.pipcs = Array.from(grupos.entries()).map(([titulo, grupo]) => {
      const fechas = [
        ...grupo.docs.map(d => this.parseFecha(d.fecha_subida || d.fecha_creacion)),
        ...grupo.textos.map(t => this.parseFecha(t.fecha_captura || t.fecha_creacion))
      ].filter((f): f is Date => !!f);

      const fechaReferencia = fechas.length
        ? new Date(Math.max(...fechas.map(f => f.getTime())))
        : this.parseFechaDesdeTitulo(titulo) || new Date();

      const anioTitulo = this.extraerAnioDesdeTitulo(titulo);
      const anio = anioTitulo || fechaReferencia.getFullYear();

      return {
        titulo,
        anio,
        fechaReferencia,
        totalDocumentos: grupo.docs.length,
        totalTextos: grupo.textos.length,
        documentoPadreId: undefined
      };
    }).sort((a, b) => b.fechaReferencia.getTime() - a.fechaReferencia.getTime());

    this.anosDisponibles = [...new Set(this.pipcs.map(p => p.anio))].sort((a, b) => b - a);
    this.filtrarPipcs();
  }

  filtrarPipcs(): void {
    const texto = this.textoBusquedaPipc.toLowerCase().trim();
    this.pipcsFiltrados = this.pipcs.filter((pipc) => {
      const coincideAno = !this.anoSeleccionado || pipc.anio === this.anoSeleccionado;
      const coincideTexto = !texto || pipc.titulo.toLowerCase().includes(texto);
      return coincideAno && coincideTexto;
    });
  }

  abrirDetallePipc(pipc: PipHistorial): void {
    this.pipcSeleccionado = pipc;
    this.vistaActual = 'documentos';
    this.textoBusquedaDocumentos = '';
    this.cargarDetallePipc(pipc);
  }

  cargarDetallePipc(pipc: PipHistorial): void {
    this.cargandoDetalle = true;
    const titulo = pipc.titulo;

    this.documentosPipcDetalle = this.documentosAprobados
      .filter(d => String(d.pipc_titulo || d.nombre_documento) === titulo)
      .map(d => ({
        ...d,
        nombre_requisito: d.nombre_requisito || d.nombre_archivo || d.nombre_documento
      }));

    this.textosPipcDetalle = this.textosCapturados
      .filter(t => String(t.pipc_titulo || t.nombre_documento_padre || '') === titulo);

    this.filtrarDocumentosDetalle();
    this.cargandoDetalle = false;
  }

  filtrarDocumentosDetalle(): void {
    if (!this.pipcSeleccionado) return;
    const texto = this.textoBusquedaDocumentos.toLowerCase().trim();

    const titulo = this.pipcSeleccionado.titulo;
    let docs = this.documentosAprobados.filter(d => String(d.pipc_titulo || d.nombre_documento) === titulo);
    let textos = this.textosCapturados.filter(t => String(t.pipc_titulo || t.nombre_documento_padre || '') === titulo);

    if (texto) {
      docs = docs.filter(d =>
        String(d.nombre_requisito || '').toLowerCase().includes(texto)
        || String(d.nombre_archivo || '').toLowerCase().includes(texto)
      );
      textos = textos.filter(t =>
        String(t.nombre_campo || '').toLowerCase().includes(texto)
        || String(t.valor_texto || '').toLowerCase().includes(texto)
      );
    }

    this.documentosPipcDetalle = docs.map(d => ({
      ...d,
      nombre_requisito: d.nombre_requisito || d.nombre_archivo || d.nombre_documento
    }));
    this.textosPipcDetalle = textos;
  }

  volverAPipcs(): void {
    this.pipcSeleccionado = null;
    this.vistaActual = 'pipcs';
    this.documentosPipcDetalle = [];
    this.textosPipcDetalle = [];
  }

  volver(): void {
    if (this.vistaActual === 'documentos') {
      this.volverAPipcs();
      return;
    }
    if (this.vistaActual === 'pipcs' && this.mostrarSelectorEmpresas && this.empresaSeleccionada) {
      this.limpiarSeleccionEmpresa();
      return;
    }
    this.router.navigate(['/proteccion-civil'], {
      queryParams: {
        vista: 'menuDocumentos',
        empresaId: this.empresaId || undefined
      }
    });
  }

  private aplanarDocumentos(documentos: any[], pipcTituloPadre?: string): DocumentoAprobado[] {
    const resultado: DocumentoAprobado[] = [];
    for (const doc of documentos) {
      const tituloPadre = pipcTituloPadre || this.obtenerTituloPipcDesdePadre(doc);
      if (doc.subdocumentos && doc.subdocumentos.length > 0) {
        for (const sub of doc.subdocumentos) {
          resultado.push({
            ...sub,
            pipc_titulo: tituloPadre,
            nombre_requisito: sub.nombre_documento
          });
        }
      } else if (doc.documento_padre_id) {
        resultado.push({
          ...doc,
          pipc_titulo: pipcTituloPadre || doc.pipc_titulo,
          nombre_requisito: doc.nombre_documento
        });
      }
    }
    return resultado;
  }

  private resolverTituloPipcDocumento(doc: DocumentoAprobado, padres: any[]): string {
    if (doc.pipc_titulo) return doc.pipc_titulo;

    for (const padre of padres) {
      const subs = Array.isArray(padre.subdocumentos) ? padre.subdocumentos : [];
      const match = subs.find((s: any) => Number(s.documento_id) === Number(doc.documento_id));
      if (match) {
        return this.obtenerTituloPipcDesdePadre(padre);
      }
    }

    return doc.nombre_documento;
  }

  private obtenerTituloPipcDesdePadre(padre: any): string {
    const espec = String(padre?.especificacion || '');
    if (espec.startsWith('carpeta_drive:')) {
      return espec.replace('carpeta_drive:', '').trim();
    }
    return String(padre?.nombre_documento || '').trim();
  }

  private parseFecha(valor?: string | null): Date | null {
    return parsearFechaFlexible(valor);
  }

  private parseFechaDesdeTitulo(titulo: string): Date | null {
    const match = titulo.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (!match) return null;
    const fecha = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return isNaN(fecha.getTime()) ? null : fecha;
  }

  private extraerAnioDesdeTitulo(titulo: string): number | null {
    const match = titulo.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (match) return Number(match[3]);
    const matchAnio = titulo.match(/(?:^|[^\d])(20\d{2})(?:[^\d]|$)/);
    return matchAnio ? Number(matchAnio[1]) : null;
  }

  getLogoEmpresaUrl(empresa: EmpresaHistorial): string | null {
    if (this.logosRotos.has(empresa.empresa_id)) return null;
    return empresa.logo_url || empresa.logo || null;
  }

  onLogoError(empresa: EmpresaHistorial): void {
    this.logosRotos.add(empresa.empresa_id);
  }

  getInicialesEmpresa(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  getIconoTipo(mimeOrExt?: string): string {
    const valor = String(mimeOrExt || '').toLowerCase();
    if (valor.includes('pdf')) return 'fa-file-pdf';
    if (valor.includes('image') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].some(v => valor.includes(v))) return 'fa-file-image';
    if (valor.includes('sheet') || valor.includes('xls')) return 'fa-file-excel';
    if (valor.includes('presentation') || valor.includes('ppt')) return 'fa-file-powerpoint';
    return 'fa-file-alt';
  }

  getColorTipo(mimeOrExt?: string): string {
    const valor = String(mimeOrExt || '').toLowerCase();
    if (valor.includes('pdf')) return 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
    if (valor.includes('image') || ['jpg', 'jpeg', 'png'].some(v => valor.includes(v))) return 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)';
    if (valor.includes('sheet') || valor.includes('xls')) return 'linear-gradient(135deg, #27ae60 0%, #1e8449 100%)';
    if (valor.includes('presentation') || valor.includes('ppt')) return 'linear-gradient(135deg, #e67e22 0%, #d35400 100%)';
    return 'linear-gradient(135deg, #d97248 0%, #e8956d 100%)';
  }

  abrirDetalle(documento: DocumentoAprobado): void {
    this.documentoSeleccionado = documento;
    this.mostrarModalDetalle = true;
  }

  cerrarDetalle(): void {
    this.mostrarModalDetalle = false;
    this.documentoSeleccionado = null;
  }

  ngOnDestroy(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    if (this.urlVisor.startsWith('blob:')) {
      URL.revokeObjectURL(this.urlVisor);
    }
    document.body.classList.remove('visor-fullscreen-open');
  }

  verArchivo(documento: DocumentoAprobado): void {
    const driveRaw = documento.drive_file_id || documento.archivo_url;
    const driveId = driveRaw ? this.backendService.extraerDriveId(driveRaw) || String(driveRaw).trim() : '';
    if (!driveId && !documento.documento_id) return;

    this.nombreVisor = documento.nombre_archivo || documento.nombre_requisito || documento.nombre_documento;
    this.cargandoVisor = true;
    this.mostrarVisor = true;
    this.archivoVisorId = documento.documento_id;
    this.documentoVisorActual = documento;
    this.visorEsImagen = this.esArchivoImagenDoc(documento);
    this.previewBlobVisor = null;
    this.visorError = null;
    this.visorProgreso = 4;
    this.visorEtiqueta = 'Preparando vista previa…';
    this.visorLento = false;
    this.urlVisor = '';
    document.body.classList.add('visor-fullscreen-open');

    if (driveId) {
      this.cargarVisorDesdeDrive(driveId, documento);
      return;
    }

    this.backendService.descargarArchivoProteccionCivil(documento.documento_id).subscribe(
      (blob: Blob) => {
        if (this.esArchivoImagenDoc(documento)) {
          this.urlVisor = URL.createObjectURL(blob);
          this.cargandoVisor = false;
          return;
        }
        this.previewBlobVisor = blob;
        this.cargandoVisor = false;
      },
      () => {
        this.cargandoVisor = false;
        Swal.fire('Error', 'No se pudo abrir el archivo', 'error');
        this.cerrarVisor();
      }
    );
  }

  private cargarVisorDesdeDrive(driveId: string, documento: DocumentoAprobado): void {
    if (this.visorEsImagen) {
      const proxyUrl = this.backendService.resolverUrlDrivePreview(driveId);
      this.urlVisor = proxyUrl || `https://drive.google.com/file/d/${driveId}/preview`;
      return;
    }

    const seq = ++this.visorSeq;
    this.visorSub?.unsubscribe();
    const nombre = documento.nombre_archivo || documento.nombre_requisito || documento.nombre_documento || 'documento.pdf';
    const esPdf = this.esArchivoPdfDoc(documento);
    const request$ = esPdf
      ? this.backendService.descargarArchivoDriveEventos(driveId, nombre)
      : this.backendService.imprimirArchivoDriveComoPDFEventos(driveId, nombre);

    this.visorSub = this.pdfPreviewLoader.observar(
      request$,
      esPdf ? 'Descargando documento…' : 'Convirtiendo el documento a PDF…'
    ).subscribe(state => {
      if (seq !== this.visorSeq) {
        return;
      }
      this.visorProgreso = state.pct;
      this.visorEtiqueta = state.etiqueta;
      this.visorLento = state.lento;
      if (state.error) {
        this.visorError = state.error;
        this.cargandoVisor = false;
        return;
      }
      if (state.blob) {
        this.previewBlobVisor = state.blob;
        this.cargandoVisor = false;
      }
    });
  }

  private esArchivoImagenDoc(documento: DocumentoAprobado): boolean {
    const mime = String(documento.mime_type || '').toLowerCase();
    const nombre = String(documento.nombre_archivo || documento.nombre_documento || '').toLowerCase();
    const ext = nombre.includes('.') ? nombre.split('.').pop() || '' : '';
    return mime.startsWith('image/')
      || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext);
  }

  private esArchivoPdfDoc(documento: DocumentoAprobado): boolean {
    const mime = String(documento.mime_type || '').toLowerCase();
    const nombre = String(documento.nombre_archivo || documento.nombre_documento || '').toLowerCase();
    return mime.includes('pdf') || nombre.endsWith('.pdf');
  }

  cerrarVisor(): void {
    this.visorSeq += 1;
    this.visorSub?.unsubscribe();
    if (this.urlVisor.startsWith('blob:')) {
      URL.revokeObjectURL(this.urlVisor);
    }
    this.mostrarVisor = false;
    this.urlVisor = '';
    this.nombreVisor = '';
    this.cargandoVisor = false;
    this.visorEsImagen = false;
    this.previewBlobVisor = null;
    this.visorError = null;
    this.visorProgreso = 0;
    this.visorLento = false;
    this.archivoVisorId = null;
    this.documentoVisorActual = null;
    document.body.classList.remove('visor-fullscreen-open');
  }

  onVisorIframeLoad(): void {
    this.cargandoVisor = false;
  }

  descargarDesdeVisor(): void {
    if (!this.archivoVisorId) return;
    this.backendService.descargarArchivoProteccionCivil(this.archivoVisorId).subscribe(
      (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.nombreVisor || 'documento';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      () => Swal.fire('Error', 'No se pudo descargar el archivo', 'error')
    );
  }

  reemplazarDesdeVisor(): void {
    if (!this.documentoVisorActual) return;
    this.reemplazarDocumentoHistorial(this.documentoVisorActual);
  }

  eliminarDesdeVisor(): void {
    if (!this.documentoVisorActual) return;
    this.eliminarDocumentoHistorial(this.documentoVisorActual);
  }

  eliminarDocumentoHistorial(documento: DocumentoAprobado): void {
    if (!documento.historial_id) {
      Swal.fire('Info', 'Este documento aún no tiene registro en el historial de Drive', 'info');
      return;
    }

    Swal.fire({
      title: '¿Eliminar del historial?',
      html: `<p>Se eliminará <strong>${documento.nombre_requisito || documento.nombre_documento}</strong> del historial de Google Drive.</p><p class="text-danger"><strong>Esta acción no se puede deshacer.</strong></p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendService.eliminarHistorialDocumentoPC(documento.historial_id!).subscribe(
          (resp: any) => {
            if (resp.success) {
              this.documentosAprobados = this.documentosAprobados.filter(d => d.documento_id !== documento.documento_id);
              this.cerrarDetalle();
              if (this.mostrarVisor) this.cerrarVisor();
              if (this.pipcSeleccionado) {
                this.cargarDetallePipc(this.pipcSeleccionado);
                this.construirPipcs(this.documentosAprobados);
              }
              Swal.fire('Eliminado', 'El documento fue eliminado del historial', 'success');
            }
          },
          () => Swal.fire('Error', 'No se pudo eliminar el documento', 'error')
        );
      }
    });
  }

  reemplazarDocumentoHistorial(documento: DocumentoAprobado): void {
    if (!documento.historial_id) {
      Swal.fire('Info', 'Este documento aún no tiene registro en el historial de Drive', 'info');
      return;
    }

    const inputFile = document.createElement('input');
    inputFile.type = 'file';
    inputFile.accept = this.acceptedPcFileTypes;
    inputFile.click();

    inputFile.onchange = (event: any) => {
      const file = event.target.files[0];
      if (!file) return;

      if (!this.esArchivoPermitidoPC(file)) {
        Swal.fire('Archivo no permitido', 'Cámbialo por uno de los formatos aceptados: imágenes, PDF, XLS/XLSX o PowerPoint (PPT/PPTX).', 'error');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        Swal.fire('Error', 'El archivo no puede superar los 10MB', 'error');
        return;
      }

      Swal.fire({
        title: 'Reemplazando archivo...',
        html: 'Subiendo a Google Drive',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      const formData = new FormData();
      formData.append('archivo', file);

      this.backendService.reemplazarHistorialDocumentoPC(documento.historial_id!, formData).subscribe(
        (resp: any) => {
          Swal.close();
          if (resp.success) {
            documento.nombre_archivo = resp.nombre_archivo;
            documento.drive_file_id = resp.drive_file_id;
            if (this.mostrarVisor && this.documentoVisorActual === documento && resp.drive_file_id) {
              this.nombreVisor = resp.nombre_archivo || documento.nombre_documento;
              this.cargandoVisor = true;
              this.previewBlobVisor = null;
              this.visorError = null;
              this.cargarVisorDesdeDrive(resp.drive_file_id, documento);
            }
            Swal.fire('Reemplazado', 'El archivo fue reemplazado exitosamente', 'success');
          }
        },
        () => {
          Swal.close();
          Swal.fire('Error', 'No se pudo reemplazar el archivo', 'error');
        }
      );
    };
  }

  eliminarTextoCapturado(texto: TextoCapturadoHistorial): void {
    if (!texto.historial_texto_id) return;

    Swal.fire({
      title: '¿Eliminar valor capturado?',
      html: `<p>Se eliminará el valor de <strong>${texto.nombre_campo}</strong>.</p><p class="text-danger"><strong>Esta acción no se puede deshacer.</strong></p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-trash mr-1"></i> Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.backendService.eliminarHistorialTextoPC(texto.historial_texto_id).subscribe(
        (resp: any) => {
          if (resp?.success) {
            this.textosCapturados = this.textosCapturados.filter(t => t.historial_texto_id !== texto.historial_texto_id);
            if (this.pipcSeleccionado) {
              this.cargarDetallePipc(this.pipcSeleccionado);
              this.construirPipcs(this.documentosAprobados);
            }
            Swal.fire('Eliminado', 'El valor capturado fue eliminado del historial.', 'success');
          }
        },
        () => Swal.fire('Error', 'No se pudo eliminar el valor capturado.', 'error')
      );
    });
  }

  descargarArchivo(documento?: DocumentoAprobado): void {
    const doc = documento || this.documentoSeleccionado;
    if (!doc || !doc.documento_id) return;

    this.backendService.descargarArchivoProteccionCivil(doc.documento_id).subscribe(
      (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.nombre_archivo || 'documento';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      () => Swal.fire('Error', 'No se pudo descargar el archivo', 'error')
    );
  }

  trackByDocumento(index: number, documento: DocumentoAprobado): number {
    return documento.documento_id || documento.historial_id || index;
  }

  trackByTexto(index: number, texto: TextoCapturadoHistorial): number {
    return texto.historial_texto_id || texto.documento_id || index;
  }

  trackByPipc(index: number, pipc: PipHistorial): string {
    return pipc.titulo;
  }
}
