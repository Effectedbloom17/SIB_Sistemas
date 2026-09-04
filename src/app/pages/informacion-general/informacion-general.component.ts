import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BackendServices } from 'src/app/services/backend.services';
import { DocumentPreviewService } from 'src/app/services/document-preview.service';
import { AuthService } from 'src/app/services/auth.service';
import JSZip from 'jszip';
import Swal from 'sweetalert2';
import {
  ApexChart,
  ApexDataLabels,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexStroke,
  ApexTooltip
} from 'ng-apexcharts';
import { firstValueFrom, Subscription } from 'rxjs';
import { parsearFechaSoloDia } from 'src/app/utils/fecha.util';
import { PdfPreviewLoaderService } from 'src/app/services/pdf-preview-loader.service';

type EncuestaPieChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  colors: string[];
  legend: ApexLegend;
  dataLabels: ApexDataLabels;
  stroke: ApexStroke;
  tooltip: ApexTooltip;
};

type DocumentoBasicoClave = 'diagnostico' | 'final';

interface DocumentoBasicoConfig {
  clave: DocumentoBasicoClave;
  nombre: string;
  descripcion: string;
  tipo_aceptado: string;
}

interface Documento {
  documento_id: number;
  curso_id: number;
  documento_nombre: string;  // Campo de la vista v_documentos_curso
  nombre?: string;  // Compatibilidad con respuestas del backend
  descripcion?: string;
  tipo_aceptado: string;
  archivo_nombre?: string;
  archivo_url?: string;
  fecha_subida?: Date;
  tamano?: string;
  estado: string;
}

interface HistorialCurso {
  programado_id: number;
  nombreCurso: string;
  empresa: string;
  empresaId?: number | null;
  fechaCurso: Date;
  lugar: string;
  participantes: number;
  estado: string;
  instructor: string;
  modalidad: string;
  documentos: any[];
  expandido?: boolean;
  carpetasDrive?: any[] | null;
  seccionesHistorial?: HistorialSeccion[];
  cargandoDrive?: boolean;
}

interface HistorialArchivo {
  id: string;
  nombre: string;
  mimeType: string;
  size?: string | number | null;
  fechaModificacion?: Date | string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  driveFileId?: string | null;
  descripcion?: string | null;
  tipoDocumento?: string | null;
  source: 'drive' | 'db';
}

interface HistorialSeccion {
  key: string;
  nombre: string;
  icono: string;
  color: string;
  orden: number;
  archivos: HistorialArchivo[];
  folderId?: string | null;
  source: 'drive' | 'db' | 'mixed';
}

interface HistorialCategoria {
  key: string;
  label: string;
  icon: string;
  color: string;
  order: number;
  aliases: string[];
}

interface HistorialSubseccionGrupo {
  key: string;
  titulo: string;
  archivos: HistorialArchivo[];
}

@Component({
  selector: 'app-informacion-general',
  templateUrl: './informacion-general.component.html',
  styleUrls: ['./informacion-general.component.scss']
})
export class InformacionGeneralComponent implements OnInit, OnDestroy {
  cursoId: number;
  cursoNombre: string = '';
  categoriaOrigen: string = 'seguridad';
  origenVista: string = '';
  documentos: Documento[] = [];
  loading: boolean = false;
  
  // Modal de gestión de documentos requeridos
  mostrarModalDocumento: boolean = false;
  aplicarATodosLosCursos: boolean = false;
  documentoForm: any = {
    nombre: '',
    descripcion: '',
    tipo_aceptado: 'PDF,DOCX'
  };

  // Modal de vista previa de documentos (delegado al servicio global)
  
  // Categorías de archivo agrupadas
  categoriasArchivo = [
    { nombre: 'PDF', icono: 'fa-file-pdf', color: '#f5365c', formatos: ['PDF'], checked: true },
    { nombre: 'Word', icono: 'fa-file-word', color: '#2b6cb0', formatos: ['DOC', 'DOCX'], checked: true },
    { nombre: 'Excel', icono: 'fa-file-excel', color: '#27AE60', formatos: ['XLS', 'XLSX'], checked: false },
    { nombre: 'PowerPoint', icono: 'fa-file-powerpoint', color: '#d97706', formatos: ['PPT', 'PPTX'], checked: false },
    { nombre: 'Imágenes', icono: 'fa-file-image', color: '#8b5cf6', formatos: ['JPG', 'PNG'], checked: false },
    { nombre: 'Comprimidos', icono: 'fa-file-archive', color: '#6b7280', formatos: ['ZIP', 'RAR'], checked: false },
  ];

  readonly documentosBasicosCurso: DocumentoBasicoConfig[] = [
    {
      clave: 'diagnostico',
      nombre: 'Evaluacion Diagnostico',
      descripcion: 'Evaluacion inicial para medir conocimientos previos del curso',
      tipo_aceptado: 'PDF,DOC,DOCX'
    },
    {
      clave: 'final',
      nombre: 'Evaluacion Final',
      descripcion: 'Evaluacion final para medir cierre y aprovechamiento del curso',
      tipo_aceptado: 'PDF,DOC,DOCX'
    }
  ];
  
  // Historial de cursos
  vistaActual: 'documentos' | 'historial' | 'historial-detalle' = 'documentos';
  historialCursos: HistorialCurso[] = [];
  historialFiltrado: HistorialCurso[] = [];
  anosFiltro: number[] = [];
  anoSeleccionado: number = 0;
  filtroNombreHistorial: string = '';
  filtroDocumentoHistorial: string = '';
  seccionFiltroHistorial: string = 'todos';
  seccionActivaHistorial: string | null = null;
  mostrarConstanciasIndividuales: boolean = false;
  mostrarDc3Individuales: boolean = false;
  descargandoZipIndividuales: boolean = false;
  loadingHistorial: boolean = false;
  cursoSeleccionado: HistorialCurso | null = null;
  esPerfilEmpresa: boolean = false;
  esPerfilAdmin: boolean = false;
  reabrirCapacitacionEnProceso: boolean = false;
  private vistaInicial: 'documentos' | 'historial' = 'documentos';
  private programadoAutoAbrirId: number | null = null;
  private empresaIdContexto: number | null = null;
  private historialCursosCargando: Promise<void> | null = null;

  // Entrega de documentos (SP-F-03) en historial
  entregaDocHistorialArchivo: File | null = null;
  entregaDocHistorialSubiendo: boolean = false;
  entregaDocHistorialArrastrando: boolean = false;
  mostrarModalEntregaDocHistorial: boolean = false;
  entregaDocHistorialCursosRelacionados: HistorialCurso[] = [];
  entregaDocHistorialSeleccionados: { [programadoId: number]: boolean } = {};
  entregaDocHistorialEliminandoId: number | null = null;
  cursosEmpresaEntregaDoc: HistorialCurso[] = [];
  private cursosEmpresaEntregaDocCargando: Promise<void> | null = null;
  private readonly entregaDocDescripcion = 'entrega_documentos_spf03_firmado';
  private readonly entregaDocTipo = 'otro';

  private readonly categoriasHistorial: HistorialCategoria[] = [
    {
      key: 'listas_asistencia',
      label: 'Listas Asistencia',
      icon: 'fa-clipboard-list',
      color: '#38512F',
      order: 10,
      aliases: ['listas_asistencia', 'lista_asistencia', 'lista_asistencia_oficial', 'lista_asistencia_fisica']
    },
    {
      key: 'informe_final',
      label: 'Informe Final',
      icon: 'fa-file-alt',
      color: '#2563eb',
      order: 20,
      aliases: ['informe_final', 'informe_final_oficial', 'informe_final_pdf_oficial', 'informe_fotografico', 'informe_fotografico_pdf_oficial']
    },
    {
      key: 'examenes_diagnostico',
      label: 'Examenes Diagnostico',
      icon: 'fa-file-alt',
      color: '#0f766e',
      order: 30,
      aliases: ['examenes_diagnostico', 'examen_diagnostico', 'diagnostico', 'examen_diagnostico_inicial']
    },
    {
      key: 'evidencias',
      label: 'Evidencias',
      icon: 'fa-camera',
      color: '#7c3aed',
      order: 40,
      aliases: ['evidencias', 'foto_evidencia', 'fotografia', 'foto']
    },
    {
      key: 'evaluaciones_finales',
      label: 'Evaluaciones Finales',
      icon: 'fa-pen-alt',
      color: '#d97706',
      order: 50,
      aliases: ['evaluaciones_finales', 'evaluacion_resuelta', 'evaluacion_final', 'evaluaciones']
    },
    {
      key: 'encuesta_resultados',
      label: 'Resultados de Encuesta',
      icon: 'fa-poll',
      color: '#5e72e4',
      order: 60,
      aliases: ['encuesta_resultados', 'encuesta_resultados_cierre', 'encuesta_metricas_cierre', 'encuesta']
    },
    {
      key: 'dc3',
      label: 'DC-3',
      icon: 'fa-file-signature',
      color: '#dc2626',
      order: 70,
      aliases: ['dc_3', 'dc3', 'dc3_lote_programado', 'dc3_inscripcion']
    },
    {
      key: 'constancias',
      label: 'Constancias',
      icon: 'fa-certificate',
      color: '#059669',
      order: 80,
      aliases: ['constancias', 'constancia', 'constancia_inscripcion']
    },
    {
      key: 'checklist_verificacion',
      label: 'Checklist Verificacion',
      icon: 'fa-clipboard-check',
      color: '#f59e0b',
      order: 90,
      aliases: ['checklist_verificacion', 'checklist_verificacion_spf08', 'checklist', 'spf08']
    },
    {
      key: 'general',
      label: 'General',
      icon: 'fa-folder',
      color: '#64748b',
      order: 100,
      aliases: ['general']
    },
    {
      key: 'otros',
      label: 'Anexos',
      icon: 'fa-folder-open',
      color: '#6b7280',
      order: 999,
      aliases: ['otro', 'otros', 'anexos', 'acuse', 'otros_documentos']
    }
  ];

  // Dropdown menu flotante
  menuAbiertoId: number | null = null;
  menuDocActual: Documento | null = null;
  menuPosition: { top: number; left: number } = { top: 0, left: 0 };

  // Detalle dashboard
  carpetasExpandidas: { [nombre: string]: boolean } = {};
  detalleEncuestaStats: any = null;
  loadingDetalleEncuesta: boolean = false;
  mostrarVisorHistorial: boolean = false;
  urlVisorHistorial: string = '';
  nombreVisorHistorial: string = '';
  cargandoVisorHistorial: boolean = false;
  archivoVisorHistorial: HistorialArchivo | null = null;
  esImagenVisorHistorial: boolean = false;
  visorHistorialModoPdf = false;
  previewBlobHistorial: Blob | null = null;
  visorHistorialError: string | null = null;
  visorHistorialProgreso = 0;
  visorHistorialEtiqueta = 'Preparando vista previa…';
  visorHistorialLento = false;
  private visorHistorialSeq = 0;
  private visorHistorialSub?: Subscription;
  zoomVisorHistorial: number = 100;
  readonly zoomVisorMin = 25;
  readonly zoomVisorMax = 300;
  readonly zoomVisorPaso = 25;
  mostrarEditorDocumentoWord: boolean = false;
  urlEditorDocumentoWord: string = '';
  nombreEditorDocumentoWord: string = '';
  cargandoEditorDocumentoWord: boolean = false;
  mostrarEditorExcelHistorial: boolean = false;
  urlEditorExcelHistorial: string = '';
  nombreEditorExcelHistorial: string = '';
  tituloEditorExcelHistorial: string = 'Editor integrado (Google Sheets)';
  subtituloEditorExcelHistorial: string = '';
  cargandoEditorExcelHistorial: boolean = false;

  detalleEncuestaPieOptions: { [key: number]: Partial<EncuestaPieChartOptions> } = {};
  private readonly encuestaPalette: string[] = [
    '#5e72e4', '#2dce89', '#11cdef', '#fb6340', '#8965e0',
    '#f3a4b5', '#172b4d', '#38512F', '#C2D1B2', '#d97706'
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private backendService: BackendServices,
    private documentPreview: DocumentPreviewService,
    private authService: AuthService,
    private pdfPreviewLoader: PdfPreviewLoaderService
  ) {}

  ngOnInit() {
    this.cursoId = +this.route.snapshot.params['id'];
    this.cursoNombre = this.route.snapshot.queryParams['nombre'] || 'Curso';
    this.categoriaOrigen = this.route.snapshot.queryParams['categoria'] || 'seguridad';
    this.origenVista = this.route.snapshot.queryParams['origen'] || '';
    const vistaParam = String(this.route.snapshot.queryParams['vista'] || '').toLowerCase();
    this.vistaInicial = (vistaParam === 'historial' || this.origenVista === 'historial-cursos')
      ? 'historial'
      : 'documentos';
    this.programadoAutoAbrirId = this.route.snapshot.queryParams['programado_id']
      ? Number(this.route.snapshot.queryParams['programado_id'])
      : null;
    const empresaIdParam = Number(this.route.snapshot.queryParams['empresa_id']);
    this.empresaIdContexto = Number.isFinite(empresaIdParam) && empresaIdParam > 0
      ? empresaIdParam
      : null;
    this.esPerfilEmpresa = this.authService.esUsuarioEmpresa();
    this.esPerfilAdmin = this.authService.esAdministradorOSuperior()
      || this.authService.tieneRol('control_documental');
    this.generarAnosFiltro();
    this.cargarDocumentos();
    this.cambiarVista(this.vistaInicial);
  }
  get documentosPrincipales(): Documento[] {
    return this.obtenerDocumentosPrincipalesUnicos();
  }

  get documentosComplementarios(): Documento[] {
    const idsPrincipales = new Set(
      this.obtenerDocumentosPrincipalesUnicos().map((doc) => doc.documento_id)
    );

    return this.documentos.filter((doc) => !idsPrincipales.has(doc.documento_id));
  }

  get documentosBasicosFaltantes(): string[] {
    return this.documentosBasicosCurso
      .filter((item) => !this.existeDocumentoBasicoPorClave(item.clave))
      .map((item) => item.nombre);
  }

  private obtenerDocumentosPrincipalesUnicos(): Documento[] {
    const documentosPorClave = new Map<DocumentoBasicoClave, Documento>();

    for (const doc of this.documentos) {
      const nombre = String(doc?.documento_nombre || doc?.nombre || '');
      const clave = this.obtenerClaveDocumentoBasico(nombre);
      if (!clave) {
        continue;
      }

      const actual = documentosPorClave.get(clave);
      if (!actual || this.debeReemplazarDocumentoPrincipal(actual, doc)) {
        documentosPorClave.set(clave, doc);
      }
    }

    return this.documentosBasicosCurso
      .map((item) => documentosPorClave.get(item.clave))
      .filter((doc): doc is Documento => !!doc);
  }

  private debeReemplazarDocumentoPrincipal(actual: Documento, candidato: Documento): boolean {
    const actualSubido = actual.estado === 'Subido';
    const candidatoSubido = candidato.estado === 'Subido';

    if (actualSubido !== candidatoSubido) {
      return candidatoSubido;
    }

    const fechaActual = actual.fecha_subida ? new Date(actual.fecha_subida).getTime() : 0;
    const fechaCandidato = candidato.fecha_subida ? new Date(candidato.fecha_subida).getTime() : 0;
    if (fechaActual !== fechaCandidato) {
      return fechaCandidato > fechaActual;
    }

    return Number(candidato.documento_id || 0) > Number(actual.documento_id || 0);
  }

  private existeDocumentoBasicoPorClave(clave: DocumentoBasicoClave): boolean {
    return this.documentos.some((doc) => {
      const nombreActual = String(doc.documento_nombre || doc.nombre || '');
      return this.obtenerClaveDocumentoBasico(nombreActual) === clave;
    });
  }

  private obtenerClaveDocumentoBasico(nombreDocumento: string | null | undefined): DocumentoBasicoClave | null {
    const nombreBase = this.normalizarTexto(nombreDocumento);
    const esEvaluacionOExamen = nombreBase.includes('evaluacion') || nombreBase.includes('examen');

    if (esEvaluacionOExamen && nombreBase.includes('diagnostico')) {
      return 'diagnostico';
    }

    if (esEvaluacionOExamen && nombreBase.includes('final')) {
      return 'final';
    }

    return null;
  }

  private obtenerNombreDocumentoBasico(clave: DocumentoBasicoClave): string {
    const doc = this.documentosBasicosCurso.find((item) => item.clave === clave);
    return doc?.nombre || 'Documento basico';
  }

  private puedeCrearDocumentoBasico(nombreDocumento: string): boolean {
    const claveBasico = this.obtenerClaveDocumentoBasico(nombreDocumento);

    if (!claveBasico || this.aplicarATodosLosCursos) {
      return true;
    }

    if (this.existeDocumentoBasicoPorClave(claveBasico)) {
      Swal.fire({
        icon: 'info',
        title: 'Documento basico ya asignado',
        text: `Ya existe ${this.obtenerNombreDocumentoBasico(claveBasico)} en esta capacitacion.`,
        confirmButtonColor: '#38512F'
      });
      return false;
    }

    return true;
  }

  async agregarBasicosDelCurso(): Promise<void> {
    if (this.loading) {
      return;
    }

    const faltantes = this.documentosBasicosFaltantes;
    if (!faltantes.length) {
      await Swal.fire({
        icon: 'info',
        title: 'Basicos ya configurados',
        text: 'El curso ya cuenta con Evaluacion Diagnostico y Evaluacion Final.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const confirmacion = await Swal.fire({
      icon: 'question',
      title: 'Agregar basicos del curso',
      html: `Se agregaran automaticamente:<br><strong>${faltantes.join('</strong><br><strong>')}</strong>`,
      showCancelButton: true,
      confirmButtonText: 'Agregar basicos',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2'
    });

    if (!confirmacion.isConfirmed) {
      return;
    }

    this.loading = true;
    const resultado = await this.crearDocumentosBasicos(false);
    this.loading = false;
    this.cargarDocumentos();

    if (resultado.creados > 0 && resultado.errores === 0) {
      await Swal.fire({
        icon: 'success',
        title: 'Basicos agregados',
        text: `Se agregaron ${resultado.creados} documento(s) basico(s) al curso.${resultado.omitidos > 0 ? ` ${resultado.omitidos} ya estaban asignado(s).` : ''}`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (resultado.creados === 0 && resultado.omitidos > 0 && resultado.errores === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin cambios',
        text: 'Los documentos basicos ya estaban configurados en este curso.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (resultado.creados > 0 && resultado.errores > 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Carga parcial',
        text: `Se agregaron ${resultado.creados} documento(s), ${resultado.omitidos} ya existian y ${resultado.errores} no se pudieron crear.`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    await Swal.fire({
      icon: 'error',
      title: 'No se pudieron agregar',
      text: 'Ocurrio un error al crear los documentos basicos.',
      confirmButtonColor: '#38512F'
    });
  }

  async agregarBasicosATodosLosCursos(): Promise<void> {
    if (this.loading) {
      return;
    }

    const confirmacion = await Swal.fire({
      icon: 'question',
      title: 'Agregar basicos a todos los cursos',
      html: `Esta accion agregara o intentara agregar:<br><strong>${this.documentosBasicosCurso.map((d) => d.nombre).join('</strong><br><strong>')}</strong><br><br>en todos los cursos del sistema.`,
      showCancelButton: true,
      confirmButtonText: 'Agregar en todos',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#A8A9A2'
    });

    if (!confirmacion.isConfirmed) {
      return;
    }

    this.loading = true;
    const resultado = await this.crearDocumentosBasicos(true);
    this.loading = false;
    this.cargarDocumentos();

    if ((resultado.creados > 0 || resultado.omitidos > 0) && resultado.errores === 0) {
      await Swal.fire({
        icon: 'success',
        title: 'Operacion completada',
        text: `Basicos creados: ${resultado.creados}. Ya existentes: ${resultado.omitidos}.`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if ((resultado.creados > 0 || resultado.omitidos > 0) && resultado.errores > 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Operacion parcial',
        text: `Basicos creados: ${resultado.creados}. Ya existentes: ${resultado.omitidos}. Errores: ${resultado.errores}.`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    await Swal.fire({
      icon: 'error',
      title: 'No se pudo completar',
      text: 'No fue posible aplicar los documentos basicos a todos los cursos.',
      confirmButtonColor: '#38512F'
    });
  }

  private async crearDocumentosBasicos(aplicarATodos: boolean): Promise<{ creados: number; omitidos: number; errores: number }> {
    let creados = 0;
    let omitidos = 0;
    let errores = 0;

    for (const docBase of this.documentosBasicosCurso) {
      if (!aplicarATodos && this.existeDocumentoBasicoPorClave(docBase.clave)) {
        continue;
      }

      try {
        const response: any = await firstValueFrom(
          this.backendService.crearDocumentoRequerido(this.cursoId, {
            nombre: docBase.nombre,
            descripcion: docBase.descripcion,
            tipo_aceptado: docBase.tipo_aceptado,
            aplicar_a_todos: aplicarATodos
          })
        );

        if (aplicarATodos) {
          creados += Number(response?.cursos_afectados || 0);
          omitidos += Number(response?.cursos_omitidos || 0);
          if (!response?.success) {
            const erroresRespuesta = Number(response?.errores || 1);
            errores += Number.isFinite(erroresRespuesta) && erroresRespuesta > 0 ? erroresRespuesta : 1;
          }
          continue;
        }

        if (response?.success) {
          if (response?.skipped) {
            omitidos += 1;
          } else {
            creados += 1;
          }
        } else {
          errores += 1;
        }
      } catch (error) {
        console.error('Error al crear documento basico:', error);
        errores += 1;
      }
    }

    return { creados, omitidos, errores };
  }


  cargarDocumentos() {
    this.loading = true;
    this.backendService.obtenerDocumentosCurso(this.cursoId).subscribe(
      (response: any) => {
        if (response.success) {
          this.documentos = response.documentos;
        }
        this.loading = false;
      },
      (error) => {
        console.error('Error al cargar documentos:', error);
        this.documentos = [];
        this.loading = false;
      }
    );
  }

  getDocumentosSubidosCount(): number {
    return this.documentos.filter((doc) => doc.estado === 'Subido').length;
  }

  getDocumentosPendientesCount(): number {
    return this.documentos.filter((doc) => doc.estado !== 'Subido').length;
  }

  getPorcentajeDocumentosCompletados(): number {
    if (!this.documentos.length) {
      return 0;
    }

    return Math.round((this.getDocumentosSubidosCount() / this.documentos.length) * 100);
  }

  volverACursos() {
    if (this.origenVista === 'historial-cursos') {
      this.router.navigate(['/historial-cursos']);
      return;
    }

    this.router.navigate(['/cursosbiz', this.categoriaOrigen]);
  }

  // =====================================
  // GESTIÓN DE DOCUMENTOS REQUERIDOS
  // =====================================

  abrirModalNuevoDocumento() {
    // Resetear categorías a valores por defecto
    this.categoriasArchivo.forEach(cat => {
      cat.checked = (cat.nombre === 'PDF' || cat.nombre === 'Word');
    });

    this.documentoForm = {
      nombre: '',
      descripcion: '',
      tipo_aceptado: 'PDF,DOCX'
    };
    this.aplicarATodosLosCursos = false;
    this.mostrarModalDocumento = true;
  }

  obtenerTiposSeleccionados(): string {
    return this.categoriasArchivo
      .filter(cat => cat.checked)
      .flatMap(cat => cat.formatos)
      .join(',');
  }

  guardarDocumentoRequerido() {
    // Obtener tipos seleccionados
    const tiposSeleccionados = this.obtenerTiposSeleccionados();
    
    if (!this.documentoForm.nombre || !tiposSeleccionados) {
      Swal.fire({
        icon: 'warning',
        title: 'Datos incompletos',
        text: 'El nombre y al menos un tipo de archivo son requeridos',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (!this.puedeCrearDocumentoBasico(this.documentoForm.nombre)) {
      return;
    }

    const nuevoDocumento = {
      nombre: this.documentoForm.nombre,
      descripcion: this.documentoForm.descripcion || '',
      tipo_aceptado: tiposSeleccionados,
      aplicar_a_todos: this.aplicarATodosLosCursos
    };

    this.loading = true;
    this.backendService.crearDocumentoRequerido(
      this.cursoId,
      nuevoDocumento
    ).subscribe(
      (response: any) => {
        if (response.success) {
          const cursosCreados = Number(response?.cursos_afectados || 0);
          const cursosOmitidos = Number(response?.cursos_omitidos || 0);
          const mensaje = this.aplicarATodosLosCursos
            ? `Documento procesado en ${cursosCreados} curso(s).${cursosOmitidos > 0 ? ` ${cursosOmitidos} ya lo tenian.` : ''}`
            : (response?.skipped ? 'El documento basico ya estaba asignado en este curso.' : 'Documento creado correctamente');

          Swal.fire({
            icon: response?.skipped ? 'info' : 'success',
            title: response?.skipped ? 'Sin cambios' : 'Documento creado',
            text: mensaje,
            confirmButtonColor: '#38512F',
            timer: 2000
          });
          this.cargarDocumentos();
          this.cerrarModalDocumento();
        }
        this.loading = false;
      },
      (error) => {
        console.error('Error al crear documento:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo crear el documento requerido',
          confirmButtonColor: '#38512F'
        });
        this.loading = false;
      }
    );
  }

  cerrarModalDocumento() {
    this.mostrarModalDocumento = false;
    this.documentoForm = {
      nombre: '',
      descripcion: '',
      tipo_aceptado: 'PDF,DOCX'
    };
  }

  // =====================================
  // SUBIDA DE ARCHIVOS
  // =====================================

  subirArchivo(documento: Documento) {
    // Crear un input file temporal
    const input = document.createElement('input');
    input.type = 'file';
    
    // Configurar tipos aceptados según el documento
    const tiposAceptados = documento.tipo_aceptado.split(',').map(t => '.' + t.toLowerCase()).join(',');
    input.accept = tiposAceptados;
    
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        this.procesarArchivo(file, documento);
      }
    };
    
    input.click();
  }

  procesarArchivo(file: File, documento: Documento) {
    // Validar tamaño (máx 10MB)
    if (file.size > 10 * 1024 * 1024) {
      Swal.fire({
        icon: 'error',
        title: 'Archivo muy grande',
        text: 'El archivo no debe superar los 10 MB',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Validar extensión
    const extension = file.name.split('.').pop()?.toUpperCase();
    if (!documento.tipo_aceptado.includes(extension || '')) {
      Swal.fire({
        icon: 'error',
        title: 'Tipo de archivo no permitido',
        text: `Solo se aceptan: ${documento.tipo_aceptado}`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.loading = true;

    this.abrirModalProgresoArchivo(
      'Subiendo archivo...',
      `Documento: ${documento.documento_nombre || documento.nombre || 'Archivo'}`
    );

    this.backendService.subirArchivoDocumentoConProgreso(
      this.cursoId,
      documento.documento_id,
      file
    ).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = Number(event.total || file.size || 1);
          const porcentaje = (Number(event.loaded || 0) / total) * 100;
          this.actualizarModalProgresoArchivo(porcentaje);
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.actualizarModalProgresoArchivo(100);
          if (event.body?.success) {
            Swal.fire({
              icon: 'success',
              title: '¡Archivo subido!',
              text: 'El documento se ha subido a Google Drive correctamente',
              confirmButtonColor: '#38512F',
              timer: 2000
            });
            this.cargarDocumentos();
          }
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error al subir archivo:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error al subir',
          text: 'No se pudo subir el archivo',
          confirmButtonColor: '#38512F'
        });
        this.loading = false;
      }
    });
  }

  formatearTamano(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private abrirModalProgresoArchivo(titulo: string, subtitulo: string): void {
    Swal.fire({
      title: titulo,
      html: `
        <p style="margin-bottom: 0.65rem; color: #475569; font-size: 0.92rem;">${subtitulo}</p>
        <div style="width: 100%; background: #e2e8f0; border-radius: 999px; overflow: hidden; height: 12px;">
          <div id="upload-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38512F 0%, #6d8a67 100%); transition: width 0.2s ease;"></div>
        </div>
        <p id="upload-progress-text" style="margin-top: 0.6rem; margin-bottom: 0; font-weight: 700; color: #38512F;">0%</p>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false
    });
  }

  private actualizarModalProgresoArchivo(porcentaje: number): void {
    const porcentajeSeguro = Math.max(0, Math.min(100, Math.round(porcentaje)));
    const fill = document.getElementById('upload-progress-fill');
    const texto = document.getElementById('upload-progress-text');

    if (fill) {
      fill.style.width = `${porcentajeSeguro}%`;
    }
    if (texto) {
      texto.textContent = `${porcentajeSeguro}%`;
    }
  }

  previsualizarDocumento(doc: Documento) {
    if (doc.estado === 'Pendiente' || doc.estado !== 'Subido') {
      Swal.fire({
        icon: 'info',
        title: 'Archivo no disponible',
        text: 'Este documento aún no ha sido subido',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.documentPreview.abrir({
      nombre: doc.documento_nombre || doc.nombre || 'Documento',
      archivo_nombre: doc.archivo_nombre,
      archivo_url: doc.archivo_url,
      documento_id: doc.documento_id,
      curso_id: doc.curso_id
    });
  }

  descargarDocumento(doc: Documento) {
    if (doc.estado === 'Pendiente') {
      Swal.fire({
        icon: 'info',
        title: 'Archivo no disponible',
        text: 'Este documento aún no ha sido subido',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.backendService.descargarArchivoDocumento(this.cursoId, doc.documento_id).subscribe({
      next: (blob) => {
        this.descargarDesdeBlob(blob, doc.archivo_nombre || 'documento');
        Swal.fire({
          icon: 'success',
          title: 'Descarga iniciada',
          text: `Descargando ${doc.archivo_nombre}`,
          confirmButtonColor: '#38512F',
          timer: 1500,
          showConfirmButton: false
        });
      },
      error: () => {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo descargar el documento',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  eliminarDocumento(doc: Documento) {
    const nombreDocumento = doc.documento_nombre || doc.nombre || 'este documento';
    
    Swal.fire({
      title: '¿Eliminar documento?',
      html: `
        <p>Se eliminará "<strong>${nombreDocumento}</strong>" ${doc.archivo_nombre ? 'y su archivo subido' : ''}</p>
        <div class="custom-control custom-checkbox mt-3 mb-3" style="text-align: left;">
          <input type="checkbox" class="custom-control-input" id="eliminarTodos">
          <label class="custom-control-label" for="eliminarTodos" style="font-weight: 600; color: #dc3545;">
            <i class="fas fa-exclamation-triangle mr-1"></i>
            Eliminar de <strong>todos los cursos</strong> que tengan este documento
          </label>
        </div>
        <hr style="border-top: 1px solid #dee2e6;">
        <div class="form-group text-left mt-3 mb-0">
          <label style="font-weight: 600; color: #1A1A1A; font-size: 0.9rem;">
            <i class="fas fa-lock mr-2" style="color: #38512F;"></i>
            Confirma tu contraseña para continuar:
          </label>
          <input type="password" id="passwordConfirm" class="form-control" placeholder="Ingresa tu contraseña" 
                 style="border: 2px solid #dee2e6; border-radius: 8px; padding: 0.6rem;">
          <small class="form-text text-muted mt-2">
            <i class="fas fa-shield-alt mr-1"></i>
            Por seguridad, debes confirmar tu identidad antes de eliminar
          </small>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      preConfirm: () => {
        const checkbox = document.getElementById('eliminarTodos') as HTMLInputElement;
        const passwordInput = document.getElementById('passwordConfirm') as HTMLInputElement;
        const password = passwordInput?.value;
        
        if (!password) {
          Swal.showValidationMessage('Debes ingresar tu contraseña');
          return false;
        }
        
        return {
          eliminarTodos: checkbox?.checked || false,
          password: password
        };
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const { eliminarTodos, password } = result.value;
        this.loading = true;
        
        // Verificar contraseña primero
        this.backendService.verificarPassword(password).subscribe(
          (authResponse: any) => {
            if (!authResponse.success) {
              Swal.fire({
                icon: 'error',
                title: 'Contraseña incorrecta',
                text: 'La contraseña ingresada no es correcta',
                confirmButtonColor: '#38512F'
              });
              this.loading = false;
              return;
            }
            
            // Si la contraseña es correcta, proceder con la eliminación
            this.backendService.eliminarDocumentoCurso(
              this.cursoId,
              doc.documento_id,
              eliminarTodos
            ).subscribe(
              (response: any) => {
                if (response.success) {
                  const mensaje = eliminarTodos 
                    ? `Documento eliminado de ${response.cursos_afectados || 'todos los'} cursos`
                    : 'El documento ha sido eliminado';
                  
                  Swal.fire({
                    icon: 'success',
                    title: 'Eliminado',
                    text: mensaje,
                    confirmButtonColor: '#38512F',
                    timer: 2000
                  });
                  this.cargarDocumentos();
                }
                this.loading = false;
              },
              (error) => {
                console.error('Error al eliminar documento:', error);
                Swal.fire({
                  icon: 'error',
                  title: 'Error',
                  text: 'No se pudo eliminar el documento',
                  confirmButtonColor: '#38512F'
                });
                this.loading = false;
              }
            );
          },
          (error) => {
            console.error('Error al verificar contraseña:', error);
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'No se pudo verificar la contraseña',
              confirmButtonColor: '#38512F'
            });
            this.loading = false;
          }
        );
      }
    });
  }

  // Ver archivo en Google Drive
  verEnDrive(doc: Documento) {
    this.backendService.obtenerUrlDrive(this.cursoId, doc.documento_id).subscribe(
      (response: any) => {
        if (response.success && response.url_drive) {
          window.open(response.url_drive, '_blank');
          
          Swal.fire({
            icon: 'success',
            title: 'Abriendo Google Drive',
            text: 'Se abrirá el archivo en Google Drive',
            confirmButtonColor: '#38512F',
            timer: 1500,
            showConfirmButton: false
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo obtener la URL de Google Drive',
            confirmButtonColor: '#38512F'
          });
        }
      },
      (error) => {
        console.error('Error al obtener URL de Google Drive:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo conectar con Google Drive',
          confirmButtonColor: '#38512F'
        });
      }
    );
  }

  // Reemplazar archivo existente
  reemplazarArchivo(documento: Documento) {
    Swal.fire({
      title: '¿Reemplazar archivo?',
      html: `
        <p>El archivo actual "<strong>${documento.archivo_nombre}</strong>" será reemplazado.</p>
        <p class="text-warning"><i class="fas fa-exclamation-triangle mr-1"></i>Esta acción no se puede deshacer</p>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, reemplazar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        // Crear input file temporal
        const input = document.createElement('input');
        input.type = 'file';
        
        const tiposAceptados = documento.tipo_aceptado.split(',').map(t => '.' + t.toLowerCase()).join(',');
        input.accept = tiposAceptados;
        
        input.onchange = (e: any) => {
          const file = e.target.files[0];
          if (file) {
            this.procesarReemplazo(file, documento);
          }
        };
        
        input.click();
      }
    });
  }

  procesarReemplazo(file: File, documento: Documento) {
    // Validar tamaño
    if (file.size > 10 * 1024 * 1024) {
      Swal.fire({
        icon: 'error',
        title: 'Archivo muy grande',
        text: 'El archivo no debe superar los 10 MB',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Validar extensión
    const extension = file.name.split('.').pop()?.toUpperCase();
    if (!documento.tipo_aceptado.includes(extension || '')) {
      Swal.fire({
        icon: 'error',
        title: 'Tipo de archivo no permitido',
        text: `Solo se aceptan: ${documento.tipo_aceptado}`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.loading = true;

    this.abrirModalProgresoArchivo(
      'Actualizando archivo...',
      `Documento: ${documento.documento_nombre || documento.nombre || 'Archivo'}`
    );

    this.backendService.reemplazarArchivoDocumentoConProgreso(
      this.cursoId,
      documento.documento_id,
      file
    ).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = Number(event.total || file.size || 1);
          const porcentaje = (Number(event.loaded || 0) / total) * 100;
          this.actualizarModalProgresoArchivo(porcentaje);
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.actualizarModalProgresoArchivo(100);
          if (event.body?.success) {
            Swal.fire({
              icon: 'success',
              title: '¡Archivo reemplazado!',
              text: 'El documento se ha actualizado correctamente en Google Drive',
              confirmButtonColor: '#38512F',
              timer: 2000
            });
            this.cargarDocumentos();
          }
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error al reemplazar archivo:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error al reemplazar',
          text: 'No se pudo reemplazar el archivo',
          confirmButtonColor: '#38512F'
        });
        this.loading = false;
      }
    });
  }

  // Cambiar archivo por seguridad (corrección de errores)
  cambiarArchivo(documento: Documento) {
    Swal.fire({
      title: '¿Cambiar archivo por seguridad?',
      html: `
        <p>¿Te equivocaste en el documento subido? Puedes cambiar "<strong>${documento.archivo_nombre}</strong>" por el correcto.</p>
        <div class="alert alert-info mt-3 mb-0">
          <i class="fas fa-shield-alt mr-2"></i>
          <strong>Seguridad:</strong> El archivo anterior será eliminado y reemplazado por el nuevo
        </div>
        <p class="text-warning mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>Esta acción no se puede deshacer</p>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, cambiar archivo',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        // Crear input file temporal
        const input = document.createElement('input');
        input.type = 'file';

        const tiposAceptados = documento.tipo_aceptado.split(',').map(t => '.' + t.toLowerCase()).join(',');
        input.accept = tiposAceptados;

        input.onchange = (e: any) => {
          const file = e.target.files[0];
          if (file) {
            this.procesarCambioArchivo(file, documento);
          }
        };

        input.click();
      }
    });
  }

  procesarCambioArchivo(file: File, documento: Documento) {
    // Validar tamaño
    if (file.size > 10 * 1024 * 1024) {
      Swal.fire({
        icon: 'error',
        title: 'Archivo muy grande',
        text: 'El archivo no debe superar los 10 MB',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Validar extensión
    const extension = file.name.split('.').pop()?.toUpperCase();
    if (!documento.tipo_aceptado.includes(extension || '')) {
      Swal.fire({
        icon: 'error',
        title: 'Tipo de archivo no permitido',
        text: `Solo se aceptan: ${documento.tipo_aceptado}`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.loading = true;

    this.abrirModalProgresoArchivo(
      'Cambiando archivo por seguridad...',
      `Documento: ${documento.documento_nombre || documento.nombre || 'Archivo'}`
    );

    this.backendService.reemplazarArchivoDocumentoConProgreso(
      this.cursoId,
      documento.documento_id,
      file
    ).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = Number(event.total || file.size || 1);
          const porcentaje = (Number(event.loaded || 0) / total) * 100;
          this.actualizarModalProgresoArchivo(porcentaje);
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.actualizarModalProgresoArchivo(100);
          if (event.body?.success) {
            Swal.fire({
              icon: 'success',
              title: '¡Archivo cambiado por seguridad!',
              text: 'El documento se ha actualizado correctamente',
              confirmButtonColor: '#38512F',
              timer: 2500
            });
            this.cargarDocumentos();
          }
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error al cambiar archivo:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error al cambiar archivo',
          text: 'No se pudo cambiar el archivo. Inténtalo de nuevo.',
          confirmButtonColor: '#38512F'
        });
        this.loading = false;
      }
    });
  }

  // Eliminar solo el archivo (mantener el documento)
  eliminarSoloArchivo(doc: Documento) {
    Swal.fire({
      title: '¿Eliminar solo el archivo?',
      html: `
        <p>Se eliminará el archivo "<strong>${doc.archivo_nombre}</strong>" de Google Drive</p>
        <p class="text-info"><i class="fas fa-info-circle mr-1"></i>El documento quedará disponible para subir un nuevo archivo</p>
        <div class="alert alert-warning mt-3 mb-0">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          <strong>Nota:</strong> Esta acción no se puede deshacer
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ffc107',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar archivo',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.loading = true;

        this.backendService.eliminarSoloArchivoDocumento(
          this.cursoId,
          doc.documento_id
        ).subscribe(
          (response: any) => {
            if (response.success) {
              Swal.fire({
                icon: 'success',
                title: 'Archivo eliminado',
                text: 'El archivo se ha eliminado. Puedes subir uno nuevo cuando lo necesites.',
                confirmButtonColor: '#38512F',
                timer: 2500
              });
              this.cargarDocumentos();
            }
            this.loading = false;
          },
          (error) => {
            console.error('Error al eliminar archivo:', error);
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'No se pudo eliminar el archivo',
              confirmButtonColor: '#38512F'
            });
            this.loading = false;
          }
        );
      }
    });
  }

  getIconoTipo(tipo: string): string {
    switch(tipo.toUpperCase()) {
      case 'PDF': return 'fa-file-pdf';
      case 'DOC':
      case 'DOCX': return 'fa-file-word';
      case 'XLS':
      case 'XLSX': return 'fa-file-excel';
      default: return 'fa-file';
    }
  }

  getColorTipo(tipo: string): string {
    switch(tipo.toUpperCase()) {
      case 'PDF': return '#f5365c';
      case 'DOC':
      case 'DOCX': return '#2b6cb0';
      case 'XLS':
      case 'XLSX': return '#27AE60';
      default: return '#A8A9A2';
    }
  }

  private obtenerExtensionArchivoDocumento(doc: Documento): string {
    const nombreArchivo = String(doc?.archivo_nombre || '').trim().toLowerCase();
    if (!nombreArchivo.includes('.')) {
      return '';
    }

    return nombreArchivo.split('.').pop() || '';
  }

  esDocumentoWordSubido(doc: Documento): boolean {
    if (!doc || doc.estado !== 'Subido') {
      return false;
    }

    const ext = this.obtenerExtensionArchivoDocumento(doc);
    return ext === 'doc' || ext === 'docx';
  }

  esDocumentoPdfSubido(doc: Documento): boolean {
    if (!doc || doc.estado !== 'Subido') {
      return false;
    }

    return this.obtenerExtensionArchivoDocumento(doc) === 'pdf';
  }

  abrirEditorIntegradoDocumento(doc: Documento) {
    if (!this.esDocumentoWordSubido(doc)) {
      Swal.fire({
        icon: 'info',
        title: 'Edicion no disponible',
        text: 'El editor integrado solo esta disponible para archivos Word.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.cargandoEditorDocumentoWord = true;
    this.mostrarEditorDocumentoWord = true;
    this.nombreEditorDocumentoWord = doc.archivo_nombre || doc.documento_nombre || doc.nombre || 'Documento Word';
    this.urlEditorDocumentoWord = '';

    this.backendService.obtenerUrlDrive(this.cursoId, doc.documento_id).subscribe(
      (response: any) => {
        const driveFileId = this.extraerDriveFileId(response?.drive_file_id || doc.archivo_url || '');
        const urlEditor = this.construirUrlEditorWord(response?.url_drive, driveFileId);

        if (!urlEditor) {
          this.cerrarEditorDocumentoWord();
          Swal.fire({
            icon: 'error',
            title: 'No se pudo abrir el editor',
            text: 'No fue posible resolver la URL de edicion para este documento Word.',
            confirmButtonColor: '#38512F'
          });
          return;
        }

        this.urlEditorDocumentoWord = urlEditor;
      },
      (error) => {
        console.error('Error al abrir editor integrado Word:', error);
        this.cerrarEditorDocumentoWord();
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'No se pudo abrir el editor integrado de Word.',
          confirmButtonColor: '#38512F'
        });
      }
    );
  }

  private construirUrlEditorWord(urlDrive?: string | null, driveFileId?: string | null): string | null {
    const id = String(driveFileId || '').trim();
    if (id) {
      return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
    }

    const base = String(urlDrive || '').trim();
    if (!base) {
      return null;
    }

    return base.includes('/view') ? base.replace('/view', '/edit') : base;
  }

  abrirEditorDocumentoWordEnNuevaPestana() {
    if (!this.urlEditorDocumentoWord) {
      return;
    }
    window.open(this.urlEditorDocumentoWord, '_blank');
  }

  onEditorDocumentoWordLoad() {
    this.cargandoEditorDocumentoWord = false;
  }

  cerrarEditorDocumentoWord() {
    this.mostrarEditorDocumentoWord = false;
    this.urlEditorDocumentoWord = '';
    this.nombreEditorDocumentoWord = '';
    this.cargandoEditorDocumentoWord = false;
  }

  async abrirEditorExcelHistorial(archivo: HistorialArchivo, event?: Event) {
    event?.stopPropagation();

    if (!this.esExcelEditableHistorial(archivo)) {
      Swal.fire({
        icon: 'info',
        title: 'Edición no disponible',
        text: 'No se encontró el archivo Excel en Drive para abrirlo en el editor.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const driveIdInicial = archivo.driveFileId
      || this.extraerDriveFileId(archivo.webViewLink || archivo.webContentLink || archivo.id);

    if (!driveIdInicial) {
      Swal.fire({
        icon: 'error',
        title: 'No se pudo abrir el editor',
        text: 'No fue posible resolver el archivo en Drive.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    Swal.fire({
      title: 'Preparando editor...',
      text: 'Abriendo Google Sheets con herramientas de edición',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      try {
        await firstValueFrom(this.backendService.asegurarAccesoPublicoDrive(driveIdInicial));
      } catch {
        // Continuar: el editor puede funcionar con la sesión de Google del usuario.
      }

      const response: any = await firstValueFrom(
        this.backendService.asegurarGoogleSheetDrive(driveIdInicial, {
          nombre: String(archivo.nombre || '').replace(/\.xlsx$/i, ''),
          programado_id: this.cursoSeleccionado?.programado_id || null
        })
      );

      if (!response?.success || !response?.fileId) {
        throw new Error(response?.message || 'No se pudo preparar el Google Sheet.');
      }

      const driveId = String(response.fileId).trim();
      const editorUrl = String(response.editorUrl || '').trim()
        || this.construirUrlEditorExcelHistorial(driveId, response.webViewLink);

      if (!editorUrl) {
        throw new Error('No fue posible resolver la URL de edición.');
      }

      this.actualizarArchivoHistorialTrasConversion(archivo, {
        driveFileId: driveId,
        mimeType: response.mimeType || 'application/vnd.google-apps.spreadsheet',
        webViewLink: response.webViewLink || editorUrl,
        nombre: response.nombre || archivo.nombre
      });

      this.cargandoEditorExcelHistorial = true;
      this.mostrarEditorExcelHistorial = true;
      this.nombreEditorExcelHistorial = archivo.nombre || 'Excel';
      this.tituloEditorExcelHistorial = 'Editor integrado (Google Sheets)';
      this.subtituloEditorExcelHistorial = this.obtenerSubtituloEditorExcelHistorial(archivo);
      this.urlEditorExcelHistorial = editorUrl;
      document.body.classList.add('visor-fullscreen-open');
      Swal.close();
    } catch (err: any) {
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'No se pudo abrir el editor',
        text: err?.error?.message || err?.message || 'No fue posible preparar el editor de Google Sheets.',
        confirmButtonColor: '#38512F'
      });
    }
  }

  private esInformeFinalExcelHistorial(archivo: HistorialArchivo): boolean {
    const meta = this.obtenerTextoArchivoNormalizado(archivo);
    return archivo.descripcion === 'informe_final_oficial'
      || meta.includes('informe_final_oficial')
      || (meta.includes('informe_final') && this.esArchivoExcel(archivo) && !meta.includes('pdf'));
  }

  private obtenerSubtituloEditorExcelHistorial(archivo: HistorialArchivo): string {
    const curso = this.cursoSeleccionado?.nombreCurso || 'Curso';
    if (this.esInformeFinalExcelHistorial(archivo)) {
      return `Informe final · ${curso}`;
    }
    if (this.esDc3Consolidado(archivo)) {
      return `DC-3 consolidado · ${curso}`;
    }
    return archivo.nombre || curso;
  }

  private actualizarArchivoHistorialTrasConversion(
    archivo: HistorialArchivo,
    datos: { driveFileId: string; mimeType: string; webViewLink: string; nombre?: string }
  ): void {
    const idAnterior = String(archivo.driveFileId || archivo.id || '').trim();

    archivo.id = datos.driveFileId;
    archivo.driveFileId = datos.driveFileId;
    archivo.mimeType = datos.mimeType;
    archivo.webViewLink = datos.webViewLink;
    archivo.webContentLink = `https://drive.google.com/uc?export=download&id=${datos.driveFileId}`;
    if (datos.nombre) {
      archivo.nombre = datos.nombre;
    }

    const docs = this.cursoSeleccionado?.documentos || [];
    for (const doc of docs) {
      const docId = this.extraerDriveFileId(doc?.drive_file_id || doc?.archivo_url);
      if (docId && idAnterior && docId === idAnterior) {
        doc.drive_file_id = datos.driveFileId;
        doc.archivo_url = datos.webViewLink;
        if (datos.nombre) {
          doc.nombre_archivo = datos.nombre;
        }
      }
    }

    for (const carpeta of this.cursoSeleccionado?.carpetasDrive || []) {
      for (const item of carpeta?.archivos || []) {
        if (String(item?.id || '') === idAnterior) {
          item.id = datos.driveFileId;
          item.mimeType = datos.mimeType;
          item.webViewLink = datos.webViewLink;
          item.webContentLink = `https://drive.google.com/uc?export=download&id=${datos.driveFileId}`;
          if (datos.nombre) {
            item.nombre = datos.nombre;
          }
        }
      }
    }

    if (this.cursoSeleccionado) {
      this.cursoSeleccionado.seccionesHistorial = this.construirSeccionesHistorial(
        this.cursoSeleccionado.carpetasDrive || [],
        this.cursoSeleccionado.documentos || []
      );
    }
  }

  private construirUrlEditorExcelHistorial(
    driveFileId?: string | null,
    fallbackUrl?: string | null
  ): string | null {
    const id = String(driveFileId || '').trim() || this.extraerDriveFileId(fallbackUrl || '');
    if (!id) {
      return null;
    }
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`;
  }

  abrirEditorExcelHistorialEnNuevaPestana() {
    if (!this.urlEditorExcelHistorial) {
      return;
    }
    window.open(this.urlEditorExcelHistorial, '_blank', 'noopener');
  }

  onEditorExcelHistorialLoad() {
    this.cargandoEditorExcelHistorial = false;
  }

  cerrarEditorExcelHistorial() {
    this.mostrarEditorExcelHistorial = false;
    this.urlEditorExcelHistorial = '';
    this.nombreEditorExcelHistorial = '';
    this.tituloEditorExcelHistorial = 'Editor integrado (Google Sheets)';
    this.subtituloEditorExcelHistorial = '';
    this.cargandoEditorExcelHistorial = false;
    document.body.classList.remove('visor-fullscreen-open');
  }

  // ==================== HISTORIAL DE CURSOS ====================
  
  cambiarVista(vista: 'documentos' | 'historial' | 'historial-detalle') {
    this.vistaActual = vista;
    if (vista === 'documentos' && this.documentos.length === 0) {
      this.cargarDocumentos();
    }
    if (vista === 'historial' && this.historialCursos.length === 0) {
      this.cargarHistorialCursos();
    }
    if (vista !== 'historial-detalle') {
      this.cursoSeleccionado = null;
      this.destruirEncuestaPieCharts();
    }
  }

  // Dropdown menu flotante
  toggleMenu(doc: Documento, event: MouseEvent) {
    event.stopPropagation();

    if (this.menuAbiertoId === doc.documento_id) {
      this.cerrarMenus();
      return;
    }

    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();

    // Calcular si hay espacio abajo, si no, abrir hacia arriba
    const menuHeight = 200; // alto aprox del dropdown
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight;

    this.menuPosition = {
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: rect.right - 200 // 200 = ancho aprox del dropdown
    };

    // Asegurar que no se salga por la izquierda
    if (this.menuPosition.left < 8) {
      this.menuPosition.left = 8;
    }

    this.menuDocActual = doc;
    this.menuAbiertoId = doc.documento_id;
  }

  @HostListener('document:click')
  cerrarMenus() {
    this.menuAbiertoId = null;
    this.menuDocActual = null;
  }

  /**
   * Esc cierra editores/visores fullscreen (mismo efecto que «Volver al formulario»).
   * Si el foco está dentro del iframe de Drive, el evento no llega a la app.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarOverlaysInfoGeneral(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }
    if (this.mostrarEditorExcelHistorial) {
      event.preventDefault();
      this.cerrarEditorExcelHistorial();
      return;
    }
    if (this.mostrarEditorDocumentoWord) {
      event.preventDefault();
      this.cerrarEditorDocumentoWord();
      return;
    }
    if (this.mostrarVisorHistorial) {
      event.preventDefault();
      this.cerrarVisorHistorial();
    }
  }

  getColorEstadoHistorial(estado: string): string {
    switch (estado) {
      case 'Completado': return '#059669';
      case 'En Curso': return '#3b82f6';
      case 'Cancelado': return '#dc3545';
      default: return '#9ca3af';
    }
  }

  generarAnosFiltro() {
    const anoActual = new Date().getFullYear();
    for (let ano = 2015; ano <= anoActual; ano++) {
      this.anosFiltro.push(ano);
    }
    this.anosFiltro.reverse(); // Mostrar del más reciente al más antiguo
  }

  cargarHistorialCursos(): Promise<void> {
    this.loadingHistorial = true;

    const promesa = firstValueFrom(this.backendService.obtenerHistorialCompletados(this.cursoId))
      .then((response: any) => {
        if (response?.success) {
          this.historialCursos = (response.historial || [])
            .map((h: any) => this.mapearItemHistorialCurso(h))
            .filter(Boolean) as HistorialCurso[];
        } else {
          this.historialCursos = [];
        }
        this.filtrarPorAno();
        this.intentarAutoAbrirCursoHistorial();
      })
      .catch((error) => {
        console.error('Error al cargar historial:', error);
        this.historialCursos = [];
        this.historialFiltrado = [];
      })
      .finally(() => {
        this.loadingHistorial = false;
        this.historialCursosCargando = null;
      });

    this.historialCursosCargando = promesa;
    return promesa;
  }

  private mapearItemHistorialCurso(h: any): HistorialCurso | null {
    const fechaCurso = parsearFechaSoloDia(h?.fecha_inicio);
    if (!fechaCurso) {
      return null;
    }

    return {
      programado_id: Number(h.programado_id),
      nombreCurso: h.nombre_curso || this.cursoNombre || 'Curso',
      empresa: h.nombre_empresa || '-',
      empresaId: h.empresa_id != null ? Number(h.empresa_id) : null,
      fechaCurso,
      lugar: [h.ciudad, h.estado].filter(Boolean).join(', ') || h.ubicacion || '-',
      participantes: h.total_participantes || 0,
      estado: 'Completado',
      instructor: h.instructor_nombre || '-',
      modalidad: h.modalidad || '-',
      documentos: (h.documentos || []).map((doc: any) => ({
        ...doc,
        documento_prog_id: doc.documento_prog_id ?? doc.documentoProgId ?? null
      })),
      expandido: false,
      carpetasDrive: null,
      cargandoDrive: false
    };
  }

  private obtenerEmpresaIdEntregaDocContexto(): number | null {
    const empresaId = this.cursoSeleccionado?.empresaId ?? this.empresaIdContexto;
    const normalizado = Number(empresaId);
    return Number.isFinite(normalizado) && normalizado > 0 ? normalizado : null;
  }

  cargarCursosEmpresaEntregaDoc(forzar = false): Promise<void> {
    const empresaId = this.obtenerEmpresaIdEntregaDocContexto();
    if (!empresaId) {
      this.cursosEmpresaEntregaDoc = [];
      return Promise.resolve();
    }

    if (!forzar && this.cursosEmpresaEntregaDoc.length > 0) {
      return Promise.resolve();
    }

    if (this.cursosEmpresaEntregaDocCargando) {
      return this.cursosEmpresaEntregaDocCargando;
    }

    const promesa = firstValueFrom(this.backendService.obtenerCursosImpartidosEmpresa(empresaId))
      .then((response: any) => {
        if (response?.success) {
          this.cursosEmpresaEntregaDoc = (response.historial || [])
            .map((h: any) => this.mapearItemHistorialCurso(h))
            .filter(Boolean) as HistorialCurso[];
        } else {
          this.cursosEmpresaEntregaDoc = [];
        }
      })
      .catch((error) => {
        console.error('Error al cargar cursos de empresa para anexos:', error);
        this.cursosEmpresaEntregaDoc = [];
      })
      .finally(() => {
        this.cursosEmpresaEntregaDocCargando = null;
      });

    this.cursosEmpresaEntregaDocCargando = promesa;
    return promesa;
  }

  private async asegurarCursosEmpresaEntregaDocCargados(): Promise<void> {
    await this.cargarCursosEmpresaEntregaDoc(true);
  }

  private async asegurarHistorialCursosCargado(): Promise<void> {
    if (this.historialCursosCargando) {
      await this.historialCursosCargando;
      return;
    }
    if (this.historialCursos.length === 0 && !this.loadingHistorial) {
      await this.cargarHistorialCursos();
    }
  }

  private intentarAutoAbrirCursoHistorial() {
    if (!this.programadoAutoAbrirId || !this.historialCursos.length) {
      return;
    }

    const cursoObjetivo = this.historialCursos.find((curso) => curso.programado_id === this.programadoAutoAbrirId);
    if (!cursoObjetivo) {
      return;
    }

    this.programadoAutoAbrirId = null;
    this.abrirDetalleCurso(cursoObjetivo);
  }

  abrirDetalleCurso(curso: HistorialCurso) {
    this.cursoSeleccionado = curso;
    this.cursosEmpresaEntregaDoc = [];
    this.vistaActual = 'historial-detalle';
    this.filtroDocumentoHistorial = '';
    this.seccionFiltroHistorial = 'todos';
    this.seccionActivaHistorial = null;
    this.mostrarConstanciasIndividuales = false;
    this.mostrarDc3Individuales = false;
    this.carpetasExpandidas = {};
    this.detalleEncuestaStats = null;
    curso.seccionesHistorial = this.construirSeccionesHistorial(curso.carpetasDrive || [], curso.documentos || []);
    this.sincronizarSeccionActivaHistorial(curso);
    this.expandirSeccionesIniciales(curso.seccionesHistorial);

    // Cargar documentos de Drive si no se han cargado
    if (!curso.carpetasDrive) {
      curso.cargandoDrive = true;
      this.backendService.obtenerDocumentosDrive(curso.programado_id).subscribe(
        (response: any) => {
          if (response.success) {
            curso.carpetasDrive = response.carpetas || [];
          } else {
            curso.carpetasDrive = [];
          }
          curso.seccionesHistorial = this.construirSeccionesHistorial(curso.carpetasDrive, curso.documentos || []);
          this.carpetasExpandidas = {};
          this.sincronizarSeccionActivaHistorial(curso);
          this.expandirSeccionesIniciales(curso.seccionesHistorial);
          curso.cargandoDrive = false;
        },
        (error) => {
          console.error('Error al cargar documentos de Drive:', error);
          curso.carpetasDrive = [];
          curso.seccionesHistorial = this.construirSeccionesHistorial([], curso.documentos || []);
          this.carpetasExpandidas = {};
          this.sincronizarSeccionActivaHistorial(curso);
          this.expandirSeccionesIniciales(curso.seccionesHistorial);
          curso.cargandoDrive = false;
        }
      );
    }

    // Cargar estadísticas de encuesta para el detalle
    this.cargarDetalleEncuestaStats(curso.programado_id);
  }

  cargarDetalleEncuestaStats(programadoId: number) {
    this.loadingDetalleEncuesta = true;
    this.detalleEncuestaStats = null;
    this.destruirEncuestaPieCharts();

    this.backendService.obtenerEncuestaStatsProgramado(programadoId, Date.now()).subscribe({
      next: (response: any) => {
        if (response.success && response.preguntas) {
          this.detalleEncuestaStats = response;
          this.detalleEncuestaPieOptions = this.construirPieOptionsPorPreguntas(response.preguntas, 110);
        }
        this.loadingDetalleEncuesta = false;
      },
      error: () => {
        this.loadingDetalleEncuesta = false;
      }
    });
  }

  volverAlHistorial() {
    this.cerrarVisorHistorial();
    this.volverACursos();
  }

  async reabrirCapacitacion(): Promise<void> {
    if (!this.esPerfilAdmin || !this.cursoSeleccionado || this.reabrirCapacitacionEnProceso) {
      return;
    }

    const programadoId = this.cursoSeleccionado.programado_id;
    const confirmacion = await Swal.fire({
      title: '¿Reabrir capacitación?',
      html: `<p>El curso volverá a estatus <strong>En curso</strong> y se desmarcará el paso de finalización.</p>
             <p class="text-muted small mb-0">Podrás completarlo nuevamente desde el timeline del curso.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      confirmButtonText: 'Sí, reabrir',
      cancelButtonText: 'Cancelar'
    });

    if (!confirmacion.isConfirmed) {
      return;
    }

    this.reabrirCapacitacionEnProceso = true;

    try {
      const progresoRes: any = await firstValueFrom(
        this.backendService.obtenerProgresoCurso(programadoId)
      );

      let pasosCompletados: number[] = [];
      if (progresoRes?.success && Array.isArray(progresoRes.pasosCompletados)) {
        pasosCompletados = progresoRes.pasosCompletados
          .map((paso: unknown) => Number(paso))
          .filter((paso: number) => Number.isFinite(paso) && paso >= 1 && paso <= 10);
      }

      pasosCompletados = pasosCompletados.filter((paso) => paso !== 10);

      const [progresoSave, estatusSave]: any[] = await Promise.all([
        firstValueFrom(this.backendService.guardarProgresoCurso(programadoId, pasosCompletados)),
        firstValueFrom(this.backendService.actualizarEstatusCurso(programadoId, 'en_curso'))
      ]);

      if (!progresoSave?.success || !estatusSave?.success) {
        throw new Error(
          progresoSave?.message || estatusSave?.message || 'No se pudo reabrir la capacitación'
        );
      }

      this.historialCursos = this.historialCursos.filter(
        (curso) => curso.programado_id !== programadoId
      );
      this.aplicarFiltros();
      this.cursoSeleccionado = null;
      this.vistaActual = 'historial';

      await Swal.fire({
        title: 'Capacitación reabierta',
        text: 'El curso está nuevamente en curso. Puedes gestionarlo desde Cursos activos o el timeline.',
        icon: 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (error: any) {
      Swal.fire(
        'Error',
        error?.message || 'Ocurrió un error al reabrir la capacitación',
        'error'
      );
    } finally {
      this.reabrirCapacitacionEnProceso = false;
    }
  }

  setSeccionActivaHistorial(seccionKey: string) {
    if (this.seccionActivaHistorial !== seccionKey) {
      this.mostrarConstanciasIndividuales = false;
      this.mostrarDc3Individuales = false;
    }
    this.seccionActivaHistorial = seccionKey;
    this.carpetasExpandidas[seccionKey] = false;
  }

  getSeccionActivaHistorial(curso: HistorialCurso | null): HistorialSeccion | null {
    const secciones = this.getSeccionesFiltradasHistorial(curso);
    if (!secciones.length) {
      return null;
    }

    const activa = secciones.find((seccion) => seccion.key === this.seccionActivaHistorial);
    return activa || secciones[0];
  }

  getArchivosSeccionActivaHistorial(curso: HistorialCurso | null): HistorialArchivo[] {
    const seccion = this.getSeccionActivaHistorial(curso);
    return seccion ? this.obtenerArchivosFiltradosSeccion(seccion) : [];
  }

  getArchivosVisiblesSeccionActivaHistorial(curso: HistorialCurso | null): HistorialArchivo[] {
    const seccion = this.getSeccionActivaHistorial(curso);
    if (!seccion) {
      return [];
    }

    const archivos = this.obtenerArchivosFiltradosSeccion(seccion);
    if (this.esCarpetaExpandida(seccion.key)) {
      return archivos;
    }
    return archivos.slice(0, 8);
  }

  getGruposArchivosSeccionActivaHistorial(curso: HistorialCurso | null): HistorialSubseccionGrupo[] {
    const seccion = this.getSeccionActivaHistorial(curso);
    if (!seccion) {
      return [];
    }

    const usarTodosLosArchivos = seccion.key === 'constancias' || seccion.key === 'dc3';
    const archivos = usarTodosLosArchivos
      ? this.obtenerArchivosFiltradosSeccion(seccion)
      : this.getArchivosVisiblesSeccionActivaHistorial(curso);

    const grupos = this.construirGruposArchivosSeccion(seccion, archivos);
    return this.obtenerGruposVisiblesPorSeccion(seccion, grupos);
  }

  getArchivosOcultosSeccionActivaHistorial(curso: HistorialCurso | null): number {
    if (this.esSeccionConstanciasActiva(curso) || this.esSeccionDc3Activa(curso)) {
      return 0;
    }

    const total = this.getArchivosSeccionActivaHistorial(curso).length;
    const visibles = this.getArchivosVisiblesSeccionActivaHistorial(curso).length;
    return Math.max(total - visibles, 0);
  }

  esSeccionConstanciasActiva(curso: HistorialCurso | null): boolean {
    return this.getSeccionActivaHistorial(curso)?.key === 'constancias';
  }

  toggleConstanciasIndividuales() {
    this.mostrarConstanciasIndividuales = !this.mostrarConstanciasIndividuales;
  }

  getTotalConstanciasIndividuales(curso: HistorialCurso | null): number {
    const seccion = this.getSeccionActivaHistorial(curso);
    if (!seccion || seccion.key !== 'constancias') {
      return 0;
    }

    const grupos = this.construirGruposArchivosSeccion(seccion, this.obtenerArchivosFiltradosSeccion(seccion));
    const grupoIndividuales = grupos.find((grupo) => grupo.key === 'constancias-individuales');
    return grupoIndividuales?.archivos.length || 0;
  }

  debeMostrarToggleConstancias(curso: HistorialCurso | null): boolean {
    return this.esSeccionConstanciasActiva(curso) && this.getTotalConstanciasIndividuales(curso) > 0;
  }

  esSeccionDc3Activa(curso: HistorialCurso | null): boolean {
    return this.getSeccionActivaHistorial(curso)?.key === 'dc3';
  }

  toggleDc3Individuales() {
    this.mostrarDc3Individuales = !this.mostrarDc3Individuales;
  }

  getTotalDc3Individuales(curso: HistorialCurso | null): number {
    const seccion = this.getSeccionActivaHistorial(curso);
    if (!seccion || seccion.key !== 'dc3') {
      return 0;
    }

    const grupos = this.construirGruposArchivosSeccion(seccion, this.obtenerArchivosFiltradosSeccion(seccion));
    const grupoIndividuales = grupos.find((grupo) => grupo.key === 'dc3-individuales');
    return grupoIndividuales?.archivos.length || 0;
  }

  debeMostrarToggleDc3(curso: HistorialCurso | null): boolean {
    return this.esSeccionDc3Activa(curso) && this.getTotalDc3Individuales(curso) > 0;
  }

  async descargarZipIndividuales(tipo: 'constancias' | 'dc3' | 'ambos'): Promise<void> {
    const curso = this.cursoSeleccionado;
    if (!curso || this.descargandoZipIndividuales) {
      return;
    }

    const titulos: Record<'constancias' | 'dc3' | 'ambos', string> = {
      constancias: 'Constancias individuales',
      dc3: 'DC-3 individuales',
      ambos: 'DC-3 y Constancias por empleado'
    };

    const constancias = this.obtenerArchivosIndividualesHistorial(curso, 'constancias');
    const dc3 = this.obtenerArchivosIndividualesHistorial(curso, 'dc3');

    const archivosPlanos = tipo === 'constancias'
      ? constancias
      : (tipo === 'dc3' ? dc3 : []);

    if (tipo !== 'ambos' && archivosPlanos.length === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin archivos',
        text: `No hay ${titulos[tipo]} para descargar.`,
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (tipo === 'ambos' && constancias.length === 0 && dc3.length === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin archivos',
        text: 'No hay constancias ni DC-3 individuales para descargar.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.descargandoZipIndividuales = true;
    const totalEstimado = tipo === 'ambos'
      ? (constancias.length + dc3.length)
      : archivosPlanos.length;

    Swal.fire({
      title: 'Generando ZIP...',
      html: `Empaquetando ${titulos[tipo]}<br><small>0 / ${totalEstimado}</small>`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const zip = new JSZip();
      const nombresUsados = new Set<string>();
      let completados = 0;
      let fallidos = 0;

      const actualizarProgreso = () => {
        const contenedor = Swal.getHtmlContainer();
        if (contenedor) {
          contenedor.innerHTML =
            `Empaquetando ${titulos[tipo]}<br><small>${completados} / ${totalEstimado}` +
            `${fallidos ? ` · ${fallidos} con error` : ''}</small>`;
        }
      };

      const descargarYAgregar = async (archivo: HistorialArchivo, rutaZip: string) => {
        const driveId = archivo.driveFileId
          || this.extraerDriveFileId(archivo.webContentLink || archivo.webViewLink || archivo.id);
        if (!driveId) {
          fallidos += 1;
          completados += 1;
          actualizarProgreso();
          return;
        }

        try {
          const blob = await firstValueFrom(
            this.backendService.descargarArchivoDrive(driveId, archivo.nombre || 'archivo')
          );
          zip.file(rutaZip, blob);
        } catch {
          fallidos += 1;
        } finally {
          completados += 1;
          actualizarProgreso();
        }
      };

      if (tipo === 'ambos') {
        const grupos = this.emparejarConstanciasYDc3PorEmpleado(constancias, dc3);
        const carpetasUsadas = new Set<string>();

        for (const grupo of grupos) {
          let carpetaBase = this.sanitizarNombreZip(grupo.nombreCarpeta || 'empleado');
          let carpeta = carpetaBase;
          let idx = 2;
          while (carpetasUsadas.has(carpeta.toLowerCase())) {
            carpeta = `${carpetaBase}_${idx}`;
            idx += 1;
          }
          carpetasUsadas.add(carpeta.toLowerCase());

          const nombresEnCarpeta = new Set<string>();
          if (grupo.constancia) {
            const nombre = this.asegurarNombreZipUnico(
              grupo.constancia.nombre || 'Constancia.pdf',
              nombresEnCarpeta
            );
            await descargarYAgregar(grupo.constancia, `${carpeta}/${nombre}`);
          }
          if (grupo.dc3) {
            const nombre = this.asegurarNombreZipUnico(
              grupo.dc3.nombre || 'DC-3.pdf',
              nombresEnCarpeta
            );
            await descargarYAgregar(grupo.dc3, `${carpeta}/${nombre}`);
          }
        }
      } else {
        for (const archivo of archivosPlanos) {
          const nombre = this.asegurarNombreZipUnico(archivo.nombre || 'archivo.pdf', nombresUsados);
          await descargarYAgregar(archivo, nombre);
        }
      }

      const entradas = Object.keys(zip.files).filter((ruta) => !zip.files[ruta].dir);
      if (entradas.length === 0) {
        throw new Error('No se pudo descargar ningún archivo para el ZIP.');
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const fecha = new Date().toISOString().slice(0, 10);
      const nombreCurso = this.sanitizarNombreZip(curso.nombreCurso || `curso_${curso.programado_id}`)
        .substring(0, 50);
      const nombresZip: Record<'constancias' | 'dc3' | 'ambos', string> = {
        constancias: `Constancias_Individuales_${nombreCurso}_${fecha}.zip`,
        dc3: `DC3_Individuales_${nombreCurso}_${fecha}.zip`,
        ambos: `DC3_y_Constancias_${nombreCurso}_${fecha}.zip`
      };

      this.descargarDesdeBlob(zipBlob, nombresZip[tipo]);
      Swal.close();

      if (fallidos > 0) {
        await Swal.fire({
          icon: 'warning',
          title: 'ZIP con incidencias',
          text: `Se empaquetaron ${entradas.length} archivo(s). ${fallidos} no se pudieron descargar.`,
          confirmButtonColor: '#38512F'
        });
      }
    } catch (err: any) {
      Swal.close();
      await Swal.fire({
        icon: 'error',
        title: 'Error al descargar',
        text: err?.message || 'No se pudo generar el ZIP.',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.descargandoZipIndividuales = false;
    }
  }

  private obtenerArchivosIndividualesHistorial(
    curso: HistorialCurso,
    seccionKey: 'constancias' | 'dc3'
  ): HistorialArchivo[] {
    const seccion = (curso.seccionesHistorial || []).find((s) => s.key === seccionKey);
    if (!seccion) {
      return [];
    }

    const grupos = this.construirGruposArchivosSeccion(
      seccion,
      this.obtenerArchivosFiltradosSeccion(seccion)
    );
    const claveGrupo = seccionKey === 'constancias' ? 'constancias-individuales' : 'dc3-individuales';
    return grupos.find((g) => g.key === claveGrupo)?.archivos || [];
  }

  private emparejarConstanciasYDc3PorEmpleado(
    constancias: HistorialArchivo[],
    dc3: HistorialArchivo[]
  ): Array<{ nombreCarpeta: string; constancia?: HistorialArchivo; dc3?: HistorialArchivo }> {
    const mapa = new Map<string, { nombreCarpeta: string; constancia?: HistorialArchivo; dc3?: HistorialArchivo }>();

    const asegurar = (clave: string, nombreCarpeta: string) => {
      if (!mapa.has(clave)) {
        mapa.set(clave, { nombreCarpeta });
      }
      return mapa.get(clave)!;
    };

    for (const archivo of constancias) {
      const clave = this.obtenerClaveEmparejamientoArchivo(archivo);
      const entry = asegurar(clave, this.obtenerNombreCarpetaEmpleado(archivo));
      entry.constancia = archivo;
      if (!entry.nombreCarpeta || entry.nombreCarpeta.startsWith('archivo_')) {
        entry.nombreCarpeta = this.obtenerNombreCarpetaEmpleado(archivo);
      }
    }

    for (const archivo of dc3) {
      const clave = this.obtenerClaveEmparejamientoArchivo(archivo);
      const entry = asegurar(clave, this.obtenerNombreCarpetaEmpleado(archivo));
      entry.dc3 = archivo;
      if (!entry.nombreCarpeta || entry.nombreCarpeta.startsWith('archivo_')) {
        entry.nombreCarpeta = this.obtenerNombreCarpetaEmpleado(archivo);
      }
    }

    return Array.from(mapa.values());
  }

  private obtenerClaveEmparejamientoArchivo(archivo: HistorialArchivo): string {
    const desc = String(archivo.descripcion || '');
    const matchIns = desc.match(/^(?:constancia|dc3)_inscripcion_(\d+)/i);
    if (matchIns) {
      return `ins:${matchIns[1]}`;
    }

    return `nom:${this.normalizarTexto(this.obtenerNombreBaseEmparejamiento(archivo.nombre || ''))}`;
  }

  private obtenerNombreBaseEmparejamiento(nombreArchivo: string): string {
    let base = String(nombreArchivo || '').replace(/\.[^.]+$/, '');
    base = base.replace(/_dc3$/i, '');
    return base;
  }

  private obtenerNombreCarpetaEmpleado(archivo: HistorialArchivo): string {
    const base = this.obtenerNombreBaseEmparejamiento(archivo.nombre || '');
    const limpio = this.sanitizarNombreZip(base);
    return limpio || `archivo_${String(archivo.driveFileId || archivo.id || 'sin_nombre').slice(0, 12)}`;
  }

  private sanitizarNombreZip(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .trim();
  }

  private asegurarNombreZipUnico(nombreOriginal: string, usados: Set<string>): string {
    const base = this.sanitizarNombreZip(nombreOriginal) || 'archivo.pdf';
    if (!usados.has(base.toLowerCase())) {
      usados.add(base.toLowerCase());
      return base;
    }

    const punto = base.lastIndexOf('.');
    const stem = punto > 0 ? base.slice(0, punto) : base;
    const ext = punto > 0 ? base.slice(punto) : '';
    let idx = 2;
    let candidato = `${stem}_${idx}${ext}`;
    while (usados.has(candidato.toLowerCase())) {
      idx += 1;
      candidato = `${stem}_${idx}${ext}`;
    }
    usados.add(candidato.toLowerCase());
    return candidato;
  }

  getNombreArchivoResaltado(nombreArchivo: string): string {
    const nombreSeguro = this.escaparHtml(String(nombreArchivo || ''));
    const terminos = this.obtenerTerminosBusqueda();

    if (!terminos.length) {
      return nombreSeguro;
    }

    const patron = terminos
      .map((termino) => this.escaparRegex(termino))
      .join('|');

    if (!patron) {
      return nombreSeguro;
    }

    const regex = new RegExp(`(${patron})`, 'gi');
    return nombreSeguro.replace(regex, '<mark>$1</mark>');
  }

  onBusquedaDocumentosHistorialChange() {
    if (this.filtroDocumentoHistorial.trim()) {
      this.mostrarConstanciasIndividuales = true;
      this.mostrarDc3Individuales = true;
    }
    this.ajustarSeccionActivaPorBusqueda();
  }

  onFiltroSeccionHistorialChange() {
    this.ajustarSeccionActivaPorBusqueda();
  }

  toggleCarpeta(nombre: string) {
    this.carpetasExpandidas[nombre] = !this.carpetasExpandidas[nombre];
  }

  esCarpetaExpandida(nombre: string): boolean {
    return !!this.carpetasExpandidas[nombre];
  }

  getArchivosVisibles(seccion: HistorialSeccion): HistorialArchivo[] {
    if (this.esCarpetaExpandida(seccion.key)) {
      return seccion.archivos;
    }
    return seccion.archivos.slice(0, 3);
  }

  getSeccionesDisponiblesHistorial(curso: HistorialCurso | null): HistorialSeccion[] {
    const clavesOcultasPerfilEmpresa = new Set([
      'evaluaciones_finales',
      'checklist_verificacion',
      'evidencias',
      'encuesta_resultados',
      'resultados-encuesta'
    ]);

    return (curso?.seccionesHistorial || []).filter((seccion) =>
      this.obtenerArchivosVisiblesSeccion(seccion).length > 0 &&
      (!this.esPerfilEmpresa || !clavesOcultasPerfilEmpresa.has(seccion.key))
    );
  }

  getSeccionesFiltradasHistorial(curso: HistorialCurso | null): HistorialSeccion[] {
    const secciones = this.getSeccionesDisponiblesHistorial(curso);
    const claveSeccion = this.seccionFiltroHistorial;

    return secciones
      .filter((seccion) => claveSeccion === 'todos' || seccion.key === claveSeccion)
      .filter((seccion) => this.obtenerArchivosFiltradosSeccion(seccion).length > 0);
  }

  getArchivosVisiblesFiltrados(seccion: HistorialSeccion): HistorialArchivo[] {
    const archivos = this.obtenerArchivosFiltradosSeccion(seccion);
    if (this.esCarpetaExpandida(seccion.key)) {
      return archivos;
    }
    return archivos.slice(0, 3);
  }

  getTotalArchivosFiltradosSeccion(seccion: HistorialSeccion): number {
    return this.obtenerArchivosFiltradosSeccion(seccion).length;
  }

  getTotalArchivosFiltradosHistorial(curso: HistorialCurso | null): number {
    return this.getSeccionesFiltradasHistorial(curso)
      .reduce((total, seccion) => total + this.obtenerArchivosFiltradosSeccion(seccion).length, 0);
  }

  limpiarBusquedaDocumentosHistorial() {
    this.filtroDocumentoHistorial = '';
    this.seccionFiltroHistorial = 'todos';
    this.mostrarConstanciasIndividuales = false;
    this.mostrarDc3Individuales = false;
    this.sincronizarSeccionActivaHistorial(this.cursoSeleccionado);
  }

  private readonly seccionesOcultarExcelHistorial = new Set(['dc3', 'constancias']);

  private debeOcultarExcelEnHistorial(seccion: HistorialSeccion, archivo: HistorialArchivo): boolean {
    if (!this.seccionesOcultarExcelHistorial.has(seccion.key)) {
      return false;
    }
    if (!this.esArchivoExcel(archivo)) {
      return false;
    }
    // En DC-3 sí mostrar el Excel consolidado (debajo del PDF consolidado).
    if (seccion.key === 'dc3' && this.esDc3Consolidado(archivo)) {
      return false;
    }
    return true;
  }

  private obtenerArchivosVisiblesSeccion(seccion: HistorialSeccion): HistorialArchivo[] {
    return seccion.archivos.filter((archivo) => !this.debeOcultarExcelEnHistorial(seccion, archivo));
  }

  private obtenerArchivosFiltradosSeccion(seccion: HistorialSeccion): HistorialArchivo[] {
    const archivosVisibles = this.obtenerArchivosVisiblesSeccion(seccion);
    const filtro = this.normalizarTexto(this.filtroDocumentoHistorial);
    if (!filtro) {
      return archivosVisibles;
    }

    return archivosVisibles.filter((archivo) => {
      const nombre = this.normalizarTexto(archivo.nombre);
      const mime = this.normalizarTexto(archivo.mimeType || '');
      const fecha = this.normalizarTexto(String(archivo.fechaModificacion || ''));
      return nombre.includes(filtro) || mime.includes(filtro) || fecha.includes(filtro);
    });
  }

  private sincronizarSeccionActivaHistorial(curso: HistorialCurso | null) {
    const secciones = this.getSeccionesFiltradasHistorial(curso);
    if (!secciones.length) {
      this.seccionActivaHistorial = null;
      return;
    }

    const existeActiva = secciones.some((seccion) => seccion.key === this.seccionActivaHistorial);
    if (!existeActiva) {
      this.seccionActivaHistorial = secciones[0].key;
    }
  }

  private ajustarSeccionActivaPorBusqueda() {
    if (this.filtroDocumentoHistorial.trim()) {
      const seccionesConCoincidencia = this.getSeccionesFiltradasHistorial(this.cursoSeleccionado);
      if (seccionesConCoincidencia.length) {
        this.seccionActivaHistorial = seccionesConCoincidencia[0].key;
      } else {
        this.seccionActivaHistorial = null;
      }
      return;
    }

    this.sincronizarSeccionActivaHistorial(this.cursoSeleccionado);
  }

  private obtenerTerminosBusqueda(): string[] {
    return (this.filtroDocumentoHistorial || '')
      .trim()
      .split(/\s+/)
      .filter((termino) => termino.length >= 2);
  }

  private escaparRegex(valor: string): string {
    return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private escaparHtml(valor: string): string {
    return valor
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getTotalArchivosHistorial(curso: HistorialCurso | null): number {
    return (curso?.seccionesHistorial || []).reduce(
      (total, seccion) => total + this.obtenerArchivosVisiblesSeccion(seccion).length,
      0
    );
  }

  getUltimaActualizacionHistorial(curso: HistorialCurso | null): Date | null {
    const timestamps = (curso?.seccionesHistorial || [])
      .flatMap((seccion) => seccion.archivos)
      .map((archivo) => archivo.fechaModificacion ? new Date(archivo.fechaModificacion) : null)
      .filter((fecha): fecha is Date => !!fecha && !isNaN(fecha.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    return timestamps[0] || null;
  }

  private expandirSeccionesIniciales(secciones: HistorialSeccion[] = []) {
    secciones.slice(0, 2).forEach((seccion) => {
      this.carpetasExpandidas[seccion.key] = true;
    });
  }

  private construirGruposArchivosSeccion(
    seccion: HistorialSeccion,
    archivos: HistorialArchivo[]
  ): HistorialSubseccionGrupo[] {
    if (!archivos.length) {
      return [];
    }

    switch (seccion.key) {
      case 'listas_asistencia':
        return this.agruparListasAsistencia(archivos);
      case 'informe_final':
        return this.agruparInformes(archivos);
      case 'examenes_diagnostico':
      case 'evaluaciones_finales':
        return this.agruparEvaluaciones(archivos, seccion.key);
      case 'constancias':
        return this.agruparConstancias(archivos);
      case 'dc3':
        return this.agruparDc3(archivos);
      default:
        return [
          {
            key: `${seccion.key}-general`,
            titulo: seccion.nombre,
            archivos
          }
        ];
    }
  }

  private obtenerGruposVisiblesPorSeccion(
    seccion: HistorialSeccion,
    grupos: HistorialSubseccionGrupo[]
  ): HistorialSubseccionGrupo[] {
    if (seccion.key === 'constancias') {
      return this.filtrarGruposGeneralesEIndividuales(
        grupos,
        'constancias-consolidadas',
        'constancias-individuales',
        this.mostrarConstanciasIndividuales
      );
    }

    if (seccion.key === 'dc3') {
      return this.filtrarGruposGeneralesEIndividuales(
        grupos,
        'dc3-consolidados',
        'dc3-individuales',
        this.mostrarDc3Individuales
      );
    }

    return grupos;
  }

  private filtrarGruposGeneralesEIndividuales(
    grupos: HistorialSubseccionGrupo[],
    claveGenerales: string,
    claveIndividuales: string,
    mostrarIndividuales: boolean
  ): HistorialSubseccionGrupo[] {
    const grupoGenerales = grupos.filter((grupo) => grupo.key === claveGenerales);
    const grupoIndividuales = grupos.filter((grupo) => grupo.key === claveIndividuales);

    if (this.filtroDocumentoHistorial.trim() || mostrarIndividuales) {
      return [...grupoGenerales, ...grupoIndividuales].filter((grupo) => grupo.archivos.length > 0);
    }

    if (grupoGenerales.length) {
      return grupoGenerales;
    }

    return grupoIndividuales;
  }

  private agruparListasAsistencia(archivos: HistorialArchivo[]): HistorialSubseccionGrupo[] {
    const grupos = [
      { key: 'lista-fisica', titulo: 'Lista de asistencia fisica', archivos: [] as HistorialArchivo[] },
      { key: 'lista-digital', titulo: 'Lista de asistencia digital (Excel)', archivos: [] as HistorialArchivo[] },
      { key: 'lista-otros', titulo: 'Otros archivos de asistencia', archivos: [] as HistorialArchivo[] }
    ];

    for (const archivo of archivos) {
      const nombre = this.obtenerTextoArchivoNormalizado(archivo);
      const esDigital = this.esArchivoExcel(archivo)
        || nombre.includes('digital')
        || nombre.includes('excel');
      const esFisica = this.esArchivoImagenOPdf(archivo)
        || nombre.includes('fisica')
        || nombre.includes('firmada');

      if (esDigital) {
        grupos[1].archivos.push(archivo);
      } else if (esFisica) {
        grupos[0].archivos.push(archivo);
      } else {
        grupos[2].archivos.push(archivo);
      }
    }

    const gruposDepurados = this.depurarGrupos(grupos);

    if (this.esPerfilEmpresa) {
      return gruposDepurados.filter((grupo) => grupo.key === 'lista-fisica');
    }

    return gruposDepurados;
  }

  private agruparInformes(archivos: HistorialArchivo[]): HistorialSubseccionGrupo[] {
    const grupos = [
      { key: 'informe-final', titulo: 'Informe Final', archivos: [] as HistorialArchivo[] },
      { key: 'informe-fotografico', titulo: 'Informe Fotografico', archivos: [] as HistorialArchivo[] }
    ];

    for (const archivo of archivos) {
      const nombre = this.obtenerTextoArchivoNormalizado(archivo);
      const esFotografico = nombre.includes('fotografico')
        || nombre.includes('fotografias')
        || nombre.includes('fotos')
        || nombre.includes('informe_foto')
        || archivo.descripcion === 'informe_fotografico'
        || archivo.descripcion === 'informe_fotografico_pdf_oficial'
        || archivo.tipoDocumento === 'informe_fotografico'
        || (
          this.esPresentacionGoogleHistorial(archivo)
          && nombre.includes('informe')
          && !nombre.includes('informe_final')
        );

      if (esFotografico) {
        grupos[1].archivos.push(archivo);
      } else {
        grupos[0].archivos.push(archivo);
      }
    }

    return this.depurarGrupos(grupos).map((grupo) => ({
      ...grupo,
      archivos: this.ordenarArchivosPdfAntesQueExcel(grupo.archivos)
    }));
  }

  private agruparEvaluaciones(
    archivos: HistorialArchivo[],
    seccionKey: string
  ): HistorialSubseccionGrupo[] {
    const grupos = [
      { key: 'eval-diagnostica', titulo: 'Evaluacion Diagnostica', archivos: [] as HistorialArchivo[] },
      { key: 'eval-final', titulo: 'Evaluacion Final', archivos: [] as HistorialArchivo[] }
    ];

    for (const archivo of archivos) {
      const nombre = this.obtenerTextoArchivoNormalizado(archivo);
      const esDiagnostica = nombre.includes('diagnostico')
        || nombre.includes('diagnostica')
        || nombre.includes('inicial')
        || seccionKey === 'examenes_diagnostico';
      const esFinal = nombre.includes('final')
        || nombre.includes('cierre')
        || seccionKey === 'evaluaciones_finales';

      if (esDiagnostica && !esFinal) {
        grupos[0].archivos.push(archivo);
      } else if (esFinal && !esDiagnostica) {
        grupos[1].archivos.push(archivo);
      } else if (seccionKey === 'examenes_diagnostico') {
        grupos[0].archivos.push(archivo);
      } else {
        grupos[1].archivos.push(archivo);
      }
    }

    return this.depurarGrupos(grupos);
  }

  private agruparConstancias(archivos: HistorialArchivo[]): HistorialSubseccionGrupo[] {
    const grupos = [
      { key: 'constancias-consolidadas', titulo: 'Constancias Generales', archivos: [] as HistorialArchivo[] },
      { key: 'constancias-individuales', titulo: 'Constancias individuales', archivos: [] as HistorialArchivo[] }
    ];

    for (const archivo of archivos) {
      const nombre = this.obtenerTextoArchivoNormalizado(archivo);
      const esConsolidado = nombre.includes('lote')
        || nombre.includes('consolidado')
        || nombre.includes('masivo')
        || nombre.includes('general')
        || nombre.includes('unidas')
        || nombre.includes('unido')
        || nombre.includes('compilado')
        || nombre.includes('todas_las_constancias');

      if (esConsolidado) {
        grupos[0].archivos.push(archivo);
      } else {
        grupos[1].archivos.push(archivo);
      }
    }

    return this.depurarGrupos(grupos);
  }

  private agruparDc3(archivos: HistorialArchivo[]): HistorialSubseccionGrupo[] {
    const grupos = [
      { key: 'dc3-consolidados', titulo: 'DC-3 Generales', archivos: [] as HistorialArchivo[] },
      { key: 'dc3-individuales', titulo: 'DC-3 individuales', archivos: [] as HistorialArchivo[] }
    ];

    for (const archivo of archivos) {
      if (this.esDc3Consolidado(archivo)) {
        grupos[0].archivos.push(archivo);
      } else {
        grupos[1].archivos.push(archivo);
      }
    }

    return this.depurarGrupos(grupos).map((grupo) => ({
      ...grupo,
      archivos: this.ordenarArchivosPdfAntesQueExcel(grupo.archivos)
    }));
  }

  private ordenarArchivosPdfAntesQueExcel(archivos: HistorialArchivo[]): HistorialArchivo[] {
    return [...archivos].sort((a, b) => {
      const pesoA = this.obtenerPesoOrdenHistorial(a);
      const pesoB = this.obtenerPesoOrdenHistorial(b);
      if (pesoA !== pesoB) {
        return pesoA - pesoB;
      }
      const fechaA = a.fechaModificacion ? new Date(a.fechaModificacion).getTime() : 0;
      const fechaB = b.fechaModificacion ? new Date(b.fechaModificacion).getTime() : 0;
      return fechaB - fechaA;
    });
  }

  private obtenerPesoOrdenHistorial(archivo: HistorialArchivo): number {
    if (this.esArchivoPdfHistorial(archivo)) {
      return 0;
    }
    if (this.esArchivoExcel(archivo)) {
      return 1;
    }
    return 2;
  }

  private esDc3Consolidado(archivo: HistorialArchivo): boolean {
    const nombre = this.obtenerTextoArchivoNormalizado(archivo);
    const meta = this.normalizarTexto(
      [archivo.descripcion, archivo.tipoDocumento].filter(Boolean).join(' ')
    );

    if (meta.includes('dc3_inscripcion')) {
      return false;
    }

    if (
      meta.includes('dc3_lote')
      || meta.includes('lote_programado')
      || meta.includes('lote_pdf')
      || meta.includes('lote_excel')
    ) {
      return true;
    }

    return nombre.includes('lote')
      || nombre.includes('consolidado')
      || nombre.includes('masivo')
      || nombre.includes('general')
      || nombre.includes('unidas')
      || nombre.includes('unido')
      || nombre.includes('compilado')
      || nombre.includes('combinado');
  }

  private depurarGrupos(grupos: HistorialSubseccionGrupo[]): HistorialSubseccionGrupo[] {
    const visibles = grupos.filter((grupo) => grupo.archivos.length > 0);
    return visibles.length ? visibles : grupos;
  }

  private obtenerTextoArchivoNormalizado(archivo: HistorialArchivo): string {
    return this.normalizarTexto([
      archivo.nombre,
      archivo.descripcion,
      archivo.tipoDocumento,
      archivo.mimeType
    ].filter(Boolean).join(' '));
  }

  private esArchivoExcel(archivo: HistorialArchivo): boolean {
    const mime = String(archivo.mimeType || '').toLowerCase();
    const extension = String(archivo.nombre || '').split('.').pop()?.toLowerCase() || '';
    const meta = this.normalizarTexto(
      [archivo.descripcion, archivo.tipoDocumento, archivo.nombre].filter(Boolean).join(' ')
    );
    return mime.includes('sheet')
      || mime.includes('excel')
      || mime.includes('csv')
      || mime === 'application/vnd.google-apps.spreadsheet'
      || ['xls', 'xlsx', 'csv'].includes(extension)
      || meta.includes('informe_final_oficial')
      || meta.includes('lote_excel')
      || meta.includes('dc3_lote_excel');
  }

  esExcelEditableHistorial(archivo: HistorialArchivo): boolean {
    return this.esArchivoExcel(archivo) && !!(
      archivo.driveFileId
      || this.extraerDriveFileId(archivo.webViewLink || archivo.webContentLink || archivo.id)
    );
  }

  private esArchivoImagenOPdf(archivo: HistorialArchivo): boolean {
    const mime = String(archivo.mimeType || '').toLowerCase();
    const extension = String(archivo.nombre || '').split('.').pop()?.toLowerCase() || '';
    return mime.includes('image')
      || mime.includes('pdf')
      || ['jpg', 'jpeg', 'png', 'pdf'].includes(extension);
  }

  private esArchivoImagenHistorial(archivo: HistorialArchivo): boolean {
    const mime = String(archivo.mimeType || '').toLowerCase();
    const extension = String(archivo.nombre || '').split('.').pop()?.toLowerCase() || '';
    return mime.startsWith('image/')
      || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(extension);
  }

  private construirSeccionesHistorial(carpetasDrive: any[] = [], documentosBd: any[] = []): HistorialSeccion[] {
    const secciones = new Map<string, HistorialSeccion>();

    for (const carpeta of carpetasDrive || []) {
      const categoria = this.obtenerCategoriaHistorial(carpeta?.nombre);
      const seccion = this.obtenerOCrearSeccionHistorial(secciones, categoria, carpeta?.folderId, 'drive');

      for (const archivo of carpeta?.archivos || []) {
        this.agregarArchivoHistorial(seccion, {
          id: String(archivo.id || `${categoria.key}-${archivo.nombre}`),
          nombre: archivo.nombre || 'Archivo',
          mimeType: archivo.mimeType || this.inferirMimeTypePorNombre(archivo.nombre),
          size: archivo.size,
          fechaModificacion: archivo.fechaModificacion,
          webViewLink: archivo.webViewLink,
          webContentLink: archivo.webContentLink,
          driveFileId: archivo.id,
          source: 'drive'
        });
      }
    }

    for (const documento of documentosBd || []) {
      const categoria = this.obtenerCategoriaHistorial(
        documento?.descripcion,
        documento?.tipo_documento,
        documento?.nombre_archivo
      );
      const driveFileId = this.extraerDriveFileId(documento?.drive_file_id || documento?.archivo_url);
      const seccion = this.obtenerOCrearSeccionHistorial(secciones, categoria, null, 'db');

      this.agregarArchivoHistorial(seccion, {
        id: String(driveFileId || documento?.documento_prog_id || `${categoria.key}-${documento?.nombre_archivo}`),
        nombre: documento?.nombre_archivo || categoria.label,
        mimeType: this.inferirMimeTypePorNombre(
          documento?.nombre_archivo,
          documento?.tipo_documento,
          documento?.descripcion
        ),
        size: null,
        fechaModificacion: documento?.fecha_subida,
        webViewLink: driveFileId
          ? this.construirWebViewLinkHistorial(driveFileId, documento?.descripcion, documento?.nombre_archivo)
          : documento?.archivo_url,
        webContentLink: driveFileId ? `https://drive.google.com/uc?export=download&id=${driveFileId}` : documento?.archivo_url,
        driveFileId,
        descripcion: documento?.descripcion,
        tipoDocumento: documento?.tipo_documento,
        source: 'db'
      });
    }

    const seccionesOrdenadas = Array.from(secciones.values())
      .map((seccion) => ({
        ...seccion,
        archivos: seccion.archivos.sort((a, b) => {
          const fechaA = a.fechaModificacion ? new Date(a.fechaModificacion).getTime() : 0;
          const fechaB = b.fechaModificacion ? new Date(b.fechaModificacion).getTime() : 0;
          return fechaB - fechaA;
        })
      }))
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

    return this.eliminarDuplicadosEntreSecciones(seccionesOrdenadas);
  }

  private eliminarDuplicadosEntreSecciones(secciones: HistorialSeccion[]): HistorialSeccion[] {
    const clavesArchivos = new Set<string>();

    return secciones
      .map((seccion) => {
        const archivosUnicos = seccion.archivos.filter((archivo) => {
          const claveBase = (archivo.driveFileId || '').trim();
          const claveNombre = this.normalizarTexto(archivo.nombre || archivo.id || '');
          const clave = claveBase ? `id:${claveBase}` : `nombre:${claveNombre}`;

          if (!claveBase && !claveNombre) {
            return true;
          }

          if (clavesArchivos.has(clave)) {
            return false;
          }

          clavesArchivos.add(clave);
          return true;
        });

        return {
          ...seccion,
          archivos: archivosUnicos
        };
      })
      .filter((seccion) => seccion.archivos.length > 0);
  }

  private obtenerOCrearSeccionHistorial(
    secciones: Map<string, HistorialSeccion>,
    categoria: HistorialCategoria,
    folderId: string | null,
    source: 'drive' | 'db'
  ): HistorialSeccion {
    const existente = secciones.get(categoria.key);
    if (existente) {
      if (folderId && !existente.folderId) {
        existente.folderId = folderId;
      }
      if (existente.source !== source) {
        existente.source = 'mixed';
      }
      return existente;
    }

    const nuevaSeccion: HistorialSeccion = {
      key: categoria.key,
      nombre: categoria.label,
      icono: categoria.icon,
      color: categoria.color,
      orden: categoria.order,
      archivos: [],
      folderId,
      source
    };

    secciones.set(categoria.key, nuevaSeccion);
    return nuevaSeccion;
  }

  private agregarArchivoHistorial(seccion: HistorialSeccion, archivo: HistorialArchivo) {
    const nombreNormalizado = this.normalizarTexto(archivo.nombre);
    const existente = seccion.archivos.find((item) => {
      if (item.driveFileId && archivo.driveFileId) {
        return item.driveFileId === archivo.driveFileId;
      }
      return this.normalizarTexto(item.nombre) === nombreNormalizado;
    });

    if (existente) {
      existente.webViewLink = existente.webViewLink || archivo.webViewLink;
      existente.webContentLink = existente.webContentLink || archivo.webContentLink;
      existente.driveFileId = existente.driveFileId || archivo.driveFileId;
      existente.fechaModificacion = existente.fechaModificacion || archivo.fechaModificacion;
      existente.mimeType = existente.mimeType || archivo.mimeType;
      existente.size = existente.size || archivo.size;
      existente.descripcion = existente.descripcion || archivo.descripcion;
      existente.tipoDocumento = existente.tipoDocumento || archivo.tipoDocumento;
      if (existente.source !== archivo.source) {
        existente.source = 'drive';
      }
      return;
    }

    seccion.archivos.push(archivo);
  }

  private obtenerCategoriaHistorial(...valores: Array<string | null | undefined>): HistorialCategoria {
    const normalizado = this.normalizarTexto(valores.filter(Boolean).join(' '));
    const categoria = this.categoriasHistorial.find((item) =>
      item.aliases.some((alias) => normalizado.includes(alias))
    );

    return categoria || this.categoriasHistorial[this.categoriasHistorial.length - 1];
  }

  private normalizarTexto(valor: string | null | undefined): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private inferirMimeTypePorNombre(
    nombreArchivo?: string,
    tipoDocumento?: string,
    descripcion?: string
  ): string {
    const extension = (nombreArchivo || '').split('.').pop()?.toLowerCase();
    const meta = this.normalizarTexto([descripcion, tipoDocumento, nombreArchivo].filter(Boolean).join(' '));

    if (
      meta.includes('informe_final_oficial')
      || meta.includes('lote_excel')
      || meta.includes('dc3_lote_excel')
      || (meta.includes('excel') && !meta.includes('pdf'))
    ) {
      return 'application/vnd.google-apps.spreadsheet';
    }

    switch (extension) {
      case 'pdf': return 'application/pdf';
      case 'doc': return 'application/msword';
      case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'xls': return 'application/vnd.ms-excel';
      case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'ppt': return 'application/vnd.ms-powerpoint';
      case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'json': return 'application/json';
      default:
        if (tipoDocumento === 'encuesta') return 'application/json';
        return 'application/octet-stream';
    }
  }

  private construirWebViewLinkHistorial(
    driveFileId: string,
    descripcion?: string | null,
    nombreArchivo?: string | null
  ): string {
    const meta = this.normalizarTexto([descripcion, nombreArchivo].filter(Boolean).join(' '));
    if (
      meta.includes('informe_final_oficial')
      || meta.includes('lote_excel')
      || meta.includes('dc3_lote_excel')
    ) {
      return `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
    }
    return `https://drive.google.com/file/d/${driveFileId}/view`;
  }

  private extraerDriveFileId(valor?: string | null): string | null {
    const texto = String(valor || '').trim();
    if (!texto) return null;
    if (/^[a-zA-Z0-9_-]{20,}$/.test(texto)) {
      return texto;
    }

    const patrones = [
      /\/d\/([a-zA-Z0-9_-]{20,})/i,
      /[?&]id=([a-zA-Z0-9_-]{20,})/i,
      /\/file\/d\/([a-zA-Z0-9_-]{20,})/i,
      /\/uc\?(?:[^#]*&)?id=([a-zA-Z0-9_-]{20,})/i
    ];

    for (const patron of patrones) {
      const match = texto.match(patron);
      if (match?.[1]) {
        return match[1];
      }
    }

    if (/drive\.google\.com|docs\.google\.com|googleusercontent\.com/i.test(texto)) {
      const match = texto.match(/[-\w]{20,}/);
      return match ? match[0] : null;
    }

    return null;
  }

  getIconoArchivoDrive(mimeType: string): string {
    if (!mimeType) return 'fa-file';
    if (mimeType.includes('pdf')) return 'fa-file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'fa-file-excel';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'fa-file-powerpoint';
    if (mimeType.includes('image')) return 'fa-file-image';
    if (mimeType.includes('json')) return 'fa-file-code';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) return 'fa-file-archive';
    return 'fa-file';
  }

  getColorArchivoDrive(mimeType: string): string {
    if (!mimeType) return '#A8A9A2';
    if (mimeType.includes('pdf')) return '#f5365c';
    if (mimeType.includes('word') || mimeType.includes('document')) return '#2b6cb0';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return '#27AE60';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '#d97706';
    if (mimeType.includes('image')) return '#8b5cf6';
    if (mimeType.includes('json')) return '#5e72e4';
    return '#A8A9A2';
  }

  async abrirArchivoHistorial(archivo: HistorialArchivo, event?: Event) {
    event?.stopPropagation();

    // Excel/Sheets: mismo editor integrado de Google Sheets que en timeline-curso
    if (this.esArchivoExcel(archivo)) {
      await this.abrirEditorExcelHistorial(archivo, event);
      return;
    }

    const driveId = archivo.driveFileId || this.extraerDriveFileId(archivo.webViewLink || archivo.webContentLink || archivo.id);
    if (!driveId) {
      if (archivo.webViewLink) {
        window.open(archivo.webViewLink, '_blank');
        return;
      }

      Swal.fire({
        icon: 'info',
        title: 'Vista previa no disponible',
        text: 'No se pudo resolver la vista previa de este archivo.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    try {
      await firstValueFrom(this.backendService.asegurarAccesoPublicoDrive(driveId));
    } catch {
      // Si falla, el proxy del servidor sigue disponible para PDF/imágenes.
    }

    const mime = String(archivo.mimeType || '').toLowerCase();
    const esImagen = this.esArchivoImagenHistorial(archivo);
    const proxyUrl = this.backendService.resolverUrlDrivePreview(driveId);

    this.archivoVisorHistorial = archivo;
    this.nombreVisorHistorial = archivo.nombre;
    this.esImagenVisorHistorial = esImagen;
    this.visorHistorialModoPdf = !esImagen;
    this.zoomVisorHistorial = 100;
    this.visorHistorialError = null;
    this.previewBlobHistorial = null;
    this.visorHistorialProgreso = 4;
    this.visorHistorialEtiqueta = 'Preparando vista previa…';
    this.visorHistorialLento = false;
    this.cargandoVisorHistorial = true;
    this.mostrarVisorHistorial = true;
    document.body.classList.add('visor-fullscreen-open');

    if (esImagen) {
      this.urlVisorHistorial = proxyUrl || `https://drive.google.com/file/d/${driveId}/preview`;
      return;
    }

    const seq = ++this.visorHistorialSeq;
    this.visorHistorialSub?.unsubscribe();
    const esPdf = this.esArchivoPdfHistorial(archivo);
    const request$ = esPdf
      ? this.backendService.descargarArchivoDriveEventos(driveId, archivo.nombre || 'documento.pdf')
      : this.backendService.imprimirArchivoDriveComoPDFEventos(driveId, archivo.nombre || 'documento.pdf');

    this.visorHistorialSub = this.pdfPreviewLoader.observar(
      request$,
      esPdf ? 'Descargando documento…' : 'Convirtiendo el documento a PDF…'
    ).subscribe(state => {
      if (seq !== this.visorHistorialSeq) {
        return;
      }
      this.visorHistorialProgreso = state.pct;
      this.visorHistorialEtiqueta = state.etiqueta;
      this.visorHistorialLento = state.lento;
      if (state.error) {
        this.visorHistorialError = state.error;
        this.cargandoVisorHistorial = false;
        return;
      }
      if (state.blob) {
        this.previewBlobHistorial = state.blob;
        this.cargandoVisorHistorial = false;
      }
    });
  }

  private esInformeFotograficoHistorial(archivo: HistorialArchivo): boolean {
    const texto = this.obtenerTextoArchivoNormalizado(archivo);
    return archivo.descripcion === 'informe_fotografico'
      || archivo.descripcion === 'informe_fotografico_pdf_oficial'
      || archivo.tipoDocumento === 'informe_fotografico'
      || texto.includes('informe_fotografico')
      || texto.includes('informe fotografico');
  }

  private esArchivoPdfHistorial(archivo: HistorialArchivo): boolean {
    if (archivo.descripcion === 'informe_fotografico') {
      return false;
    }

    const mime = String(archivo.mimeType || '').toLowerCase();
    if (this.esInformeFotograficoHistorial(archivo) && mime !== 'application/pdf') {
      return false;
    }

    const nombre = String(archivo.nombre || '').toLowerCase();
    return mime === 'application/pdf'
      || (nombre.endsWith('.pdf') && archivo.descripcion === 'informe_fotografico_pdf_oficial')
      || archivo.descripcion === 'informe_fotografico_pdf_oficial'
      || archivo.descripcion === 'informe_final_pdf_oficial';
  }

  private esPresentacionGoogleHistorial(archivo: HistorialArchivo): boolean {
    const mime = String(archivo.mimeType || '').toLowerCase();
    const nombre = String(archivo.nombre || '').toLowerCase();
    return mime === 'application/vnd.google-apps.presentation'
      || mime.includes('presentation')
      || mime.includes('powerpoint')
      || nombre.endsWith('.ppt')
      || nombre.endsWith('.pptx');
  }

  private esPresentacionInformeFotograficoHistorial(archivo: HistorialArchivo): boolean {
    if (archivo.descripcion === 'informe_fotografico_pdf_oficial') {
      return false;
    }

    if (!this.esInformeFotograficoHistorial(archivo)) {
      return false;
    }

    const mime = String(archivo.mimeType || '').toLowerCase();
    if (mime === 'application/pdf') {
      return false;
    }

    if (archivo.descripcion === 'informe_fotografico') {
      return true;
    }

    if (this.esPresentacionGoogleHistorial(archivo)) {
      return true;
    }

    return mime === 'application/octet-stream' || mime === 'application/vnd.google-apps.presentation';
  }

  private asegurarExtensionDescarga(nombreBase: string, extension: string): string {
    const base = String(nombreBase || 'archivo')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_\u00C0-\u024F]+/g, '_')
      .trim() || 'archivo';
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    return `${base}${ext}`;
  }

  private async recargarDocumentosHistorialCurso(curso: HistorialCurso, archivoPdf?: any): Promise<void> {
    if (archivoPdf?.drive_file_id || archivoPdf?.nombre) {
      const yaExiste = (curso.documentos || []).some((doc) => doc.descripcion === 'informe_fotografico_pdf_oficial');
      if (!yaExiste) {
        curso.documentos = [
          ...(curso.documentos || []),
          {
            documento_prog_id: null,
            tipo_documento: 'informe_fotografico',
            nombre_archivo: archivoPdf?.nombre || 'Informe_Fotografico.pdf',
            archivo_url: archivoPdf?.url || '',
            drive_file_id: archivoPdf?.drive_file_id || null,
            descripcion: 'informe_fotografico_pdf_oficial',
            fecha_subida: new Date().toISOString()
          }
        ];
      }
    }

    try {
      const response: any = await firstValueFrom(this.backendService.obtenerDocumentosDrive(curso.programado_id));
      if (response?.success) {
        curso.carpetasDrive = response.carpetas || [];
      }
    } catch {
      // Si falla la recarga de Drive, al menos conservar el PDF en BD local del curso.
    }

    curso.seccionesHistorial = this.construirSeccionesHistorial(curso.carpetasDrive || [], curso.documentos || []);
    this.sincronizarSeccionActivaHistorial(curso);
  }

  private async descargarInformeFotograficoPresentacionHistorial(destino: HistorialArchivo): Promise<void> {
    const programadoId = Number(this.cursoSeleccionado?.programado_id || 0);
    const slidesDriveFileId = destino.driveFileId
      || this.extraerDriveFileId(destino.webContentLink || destino.webViewLink || destino.id);

    if (!programadoId || !slidesDriveFileId) {
      throw new Error('No se encontró el curso o la presentación del Informe Fotográfico.');
    }

    const response: any = await firstValueFrom(
      this.backendService.asegurarInformeFotograficoPdfOficial(programadoId, false, slidesDriveFileId)
    );

    if (!response?.success) {
      throw new Error(response?.message || 'No se pudo verificar el PDF del Informe Fotográfico.');
    }

    const archivoPdf = response?.archivo_pdf || {};
    const pdfYaExistia = !response?.generado;

    if (pdfYaExistia) {
      const blob = await firstValueFrom(
        this.backendService.descargarArchivoDrive(slidesDriveFileId, destino.nombre || 'Informe_Fotografico')
      );
      const nombrePpt = this.asegurarExtensionDescarga(destino.nombre || 'Informe_Fotografico', '.pptx');
      this.descargarDesdeBlob(blob, nombrePpt);
      return;
    }

    const drivePdfFileId = archivoPdf?.drive_file_id || null;
    if (!drivePdfFileId) {
      throw new Error('No se recibió el PDF generado del Informe Fotográfico.');
    }

    if (this.cursoSeleccionado) {
      await this.recargarDocumentosHistorialCurso(this.cursoSeleccionado, archivoPdf);
    }

    const blob = await firstValueFrom(
      this.backendService.descargarArchivoDrive(
        drivePdfFileId,
        archivoPdf?.nombre || 'Informe_Fotografico.pdf'
      )
    );
    this.descargarBlobPdf(blob, archivoPdf?.nombre || 'Informe_Fotografico');
  }

  async descargarArchivoHistorial(archivo?: HistorialArchivo, event?: Event) {
    event?.stopPropagation();

    const destino = archivo || this.archivoVisorHistorial;
    if (!destino) return;

    const driveId = destino.driveFileId || this.extraerDriveFileId(destino.webContentLink || destino.webViewLink || destino.id);
    if (!driveId) {
      Swal.fire({
        icon: 'info',
        title: 'Descarga no disponible',
        text: 'No se encontró el archivo en Drive para descargarlo.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const descargarPresentacionInformeFoto = this.esPresentacionInformeFotograficoHistorial(destino);
    const descargarExcelXlsx = this.esArchivoExcel(destino);

    Swal.fire({
      title: descargarPresentacionInformeFoto
        ? 'Preparando descarga...'
        : (descargarExcelXlsx ? 'Descargando Excel...' : 'Descargando archivo...'),
      text: descargarPresentacionInformeFoto
        ? 'Verificando PDF del Informe Fotográfico'
        : (descargarExcelXlsx ? 'Exportando en formato .xlsx' : (destino.nombre || 'Preparando descarga')),
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      if (descargarPresentacionInformeFoto) {
        await this.descargarInformeFotograficoPresentacionHistorial(destino);
      } else if (descargarExcelXlsx) {
        await this.descargarExcelHistorialComoXlsx(destino, driveId);
      } else if (this.esArchivoPdfHistorial(destino)) {
        const blob = await firstValueFrom(
          this.backendService.descargarArchivoDrive(driveId, destino.nombre || 'archivo')
        );
        this.descargarBlobPdf(blob, destino.nombre || 'archivo');
      } else {
        const blob = await firstValueFrom(
          this.backendService.descargarArchivoDrive(driveId, destino.nombre || 'archivo')
        );
        this.descargarDesdeBlob(blob, destino.nombre || 'archivo');
      }
      Swal.close();
    } catch (err: any) {
      Swal.close();

      if (descargarPresentacionInformeFoto) {
        await Swal.fire({
          icon: 'error',
          title: 'Error al preparar Informe Fotográfico',
          text: err?.error?.message || err?.message || 'No se pudo generar ni descargar el Informe Fotográfico.',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (descargarExcelXlsx) {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(driveId)}/export?format=xlsx`;
        window.open(exportUrl, '_blank', 'noopener');
        await Swal.fire({
          icon: 'info',
          title: 'Descarga en Drive',
          text: 'Se abrió la exportación .xlsx desde Google Sheets.',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const urlDirecta = destino.webContentLink
        || (driveId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}` : null)
        || destino.webViewLink
        || (driveId ? `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view` : null);

      if (urlDirecta) {
        window.open(urlDirecta, '_blank');
        await Swal.fire({
          icon: 'info',
          title: 'Descarga en Drive',
          text: 'No se pudo descargar desde el servidor. Se abrió la descarga directa en Google Drive.',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err?.error?.message || 'No se pudo descargar el archivo.',
        confirmButtonColor: '#38512F'
      });
    }
  }

  private async descargarExcelHistorialComoXlsx(destino: HistorialArchivo, driveId: string): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.backendService.descargarArchivoDrive(driveId, destino.nombre || 'archivo.xlsx')
      );
      const nombreXlsx = this.asegurarExtensionDescarga(destino.nombre || 'archivo', '.xlsx');
      this.descargarDesdeBlob(blob, nombreXlsx);
      return;
    } catch {
      // Fallback: exportación nativa de Google Sheets a xlsx
    }

    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(driveId)}/export?format=xlsx`;
    const response = await fetch(exportUrl, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('No se pudo exportar el Excel a .xlsx');
    }
    const blob = await response.blob();
    const nombreXlsx = this.asegurarExtensionDescarga(destino.nombre || 'archivo', '.xlsx');
    this.descargarDesdeBlob(blob, nombreXlsx);
  }

  abrirEnDriveHistorial() {
    if (!this.archivoVisorHistorial) return;

    const driveId = this.archivoVisorHistorial.driveFileId
      || this.extraerDriveFileId(this.archivoVisorHistorial.webViewLink || this.archivoVisorHistorial.id);

    if (driveId) {
      window.open(`https://drive.google.com/file/d/${driveId}/view`, '_blank');
      return;
    }

    if (this.archivoVisorHistorial.webViewLink) {
      window.open(this.archivoVisorHistorial.webViewLink, '_blank');
    }
  }

  cerrarVisorHistorial() {
    this.visorHistorialSeq += 1;
    this.visorHistorialSub?.unsubscribe();

    if (this.urlVisorHistorial.startsWith('blob:')) {
      URL.revokeObjectURL(this.urlVisorHistorial);
    }

    this.mostrarVisorHistorial = false;
    this.urlVisorHistorial = '';
    this.nombreVisorHistorial = '';
    this.cargandoVisorHistorial = false;
    this.archivoVisorHistorial = null;
    this.esImagenVisorHistorial = false;
    this.visorHistorialModoPdf = false;
    this.previewBlobHistorial = null;
    this.visorHistorialError = null;
    this.visorHistorialProgreso = 0;
    this.visorHistorialLento = false;
    this.zoomVisorHistorial = 100;
    document.body.classList.remove('visor-fullscreen-open');
  }

  onVisorHistorialLoad() {
    this.cargandoVisorHistorial = false;
  }

  ajustarZoomVisorHistorial(delta: number): void {
    this.zoomVisorHistorial = Math.min(
      this.zoomVisorMax,
      Math.max(this.zoomVisorMin, this.zoomVisorHistorial + delta)
    );
  }

  resetZoomVisorHistorial(): void {
    this.zoomVisorHistorial = 100;
  }

  onWheelZoomVisorHistorial(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const paso = event.deltaY > 0 ? -this.zoomVisorPaso : this.zoomVisorPaso;
    this.ajustarZoomVisorHistorial(paso);
  }

  formatearTamanoDrive(bytes: string | number): string {
    const b = Number(bytes);
    if (!b || isNaN(b)) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  filtrarPorAno() {
    this.aplicarFiltros();
  }

  filtrarPorNombre() {
    this.aplicarFiltros();
  }

  aplicarFiltros() {
    let resultado = [...this.historialCursos];
    
    // Filtro por año
    if (this.anoSeleccionado !== 0) {
      resultado = resultado.filter(curso =>
        curso.fechaCurso?.getFullYear() === this.anoSeleccionado
      );
    }
    
    // Filtro por nombre/empresa/lugar
    if (this.filtroNombreHistorial && this.filtroNombreHistorial.trim() !== '') {
      const filtro = this.filtroNombreHistorial.toLowerCase();
      resultado = resultado.filter(curso => 
        curso.empresa.toLowerCase().includes(filtro) ||
        curso.lugar.toLowerCase().includes(filtro)
      );
    }
    
    this.historialFiltrado = resultado;
  }

  verDetallesCurso(curso: HistorialCurso) {
    this.abrirDetalleCurso(curso);
  }

  private descargarDesdeBlob(blob: Blob, nombre: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  private descargarBlobPdf(blob: Blob, nombreBase: string): void {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    const nombre = (nombreBase || 'documento')
      .toString()
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_\u00C0-\u024F]+/g, '_');
    link.href = url;
    link.download = `${nombre}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private destruirEncuestaPieCharts() {
    this.detalleEncuestaPieOptions = {};
  }

  private construirPieOptionsPorPreguntas(preguntas: any[], size: number): { [key: number]: Partial<EncuestaPieChartOptions> } {
    const options: { [key: number]: Partial<EncuestaPieChartOptions> } = {};

    (preguntas || []).forEach((pregunta: any, idx: number) => {
      if (pregunta?.type !== 'choice' || !(pregunta.options || []).length) return;

      const labels = (pregunta.options || []).map((op: any) => op.label || 'Opción');
      const series = (pregunta.options || []).map((op: any) => Number(op.count || 0));
      const colors = labels.map((_: string, i: number) => this.encuestaPalette[i % this.encuestaPalette.length]);

      options[idx] = {
        series,
        chart: {
          type: 'pie',
          height: size,
          width: size,
          sparkline: { enabled: true }
        },
        labels,
        colors,
        legend: { show: false },
        dataLabels: { enabled: false },
        stroke: { width: 0 },
        tooltip: {
          y: {
            formatter: (value: number, opts?: any) => {
              const total = series.reduce((acc, val) => acc + Number(val || 0), 0);
              const pct = total > 0 ? ((Number(value || 0) / total) * 100).toFixed(1) : '0';
              const label = opts?.w?.globals?.labels?.[opts.dataPointIndex] || 'Opción';
              return `${label}: ${value} (${pct}%)`;
            }
          }
        }
      };
    });

    return options;
  }

  getEncuestaColor(index: number): string {
    return this.encuestaPalette[index % this.encuestaPalette.length];
  }

  // ── Entrega de documentos (SP-F-03) en historial ──

  private esDocumentoEntregaDoc(documento: any): boolean {
    if (!documento) return false;
    const descripcion = String(documento?.descripcion || '').trim().toLowerCase();

    if (descripcion === 'entrega_documentos_spf03_firmado'
      || descripcion === 'entrega_documentos_spf03_generado') {
      return true;
    }

    const tipo = String(documento?.tipo_documento || '').toLowerCase();
    const nombre = String(documento?.nombre_archivo || '').toLowerCase();

    return descripcion.includes('entrega_documentos_spf03')
      || tipo === 'entrega_documentos'
      || nombre.includes('sp_f_03')
      || nombre.includes('sp-f-03')
      || nombre.includes('sp f 03')
      || nombre.includes('spf03');
  }

  tieneEntregaDocumentos(curso: HistorialCurso | null): boolean {
    if (!curso) return false;
    const docs = curso.documentos || [];
    return docs.some((d: any) => this.esDocumentoEntregaDoc(d));
  }

  private obtenerCursosRelacionadosEntregaDoc(): HistorialCurso[] {
    if (!this.cursoSeleccionado) return [];

    const fuente = this.cursosEmpresaEntregaDoc.length
      ? this.cursosEmpresaEntregaDoc
      : this.historialCursos;

    return fuente
      .filter((curso) => curso.programado_id !== this.cursoSeleccionado?.programado_id)
      .sort((a, b) => b.fechaCurso.getTime() - a.fechaCurso.getTime());
  }

  iniciarSubidaEntregaDocHistorial(): void {
    if (!this.entregaDocHistorialArchivo || !this.cursoSeleccionado) return;
    void this.procesarInicioSubidaEntregaDocHistorial();
  }

  private async procesarInicioSubidaEntregaDocHistorial(): Promise<void> {
    await this.asegurarHistorialCursosCargado();
    await this.asegurarCursosEmpresaEntregaDocCargados();

    const relacionados = this.obtenerCursosRelacionadosEntregaDoc();
    const relacionadosDisponibles = relacionados
      .filter((curso) => !this.tieneEntregaDocumentos(curso));

    if (!relacionadosDisponibles.length) {
      this.subirEntregaDocHistorial([]);
      return;
    }

    Swal.fire({
      title: '¿Este anexo aplica a mas cursos?',
      text: 'Si aplica a mas cursos de la misma empresa, puedes vincularlo para evitar duplicados.',
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Seleccionar cursos',
      denyButtonText: 'Solo este curso',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#38512F',
      denyButtonColor: '#6c757d'
    }).then((result) => {
      if (result.isConfirmed) {
        this.abrirModalEntregaDocHistorial();
      } else if (result.isDenied) {
        this.subirEntregaDocHistorial([]);
      }
    });
  }

  abrirModalEntregaDocHistorial(): void {
    void this.cargarCursosEmpresaEntregaDoc(true).then(() => {
      this.entregaDocHistorialCursosRelacionados = this.obtenerCursosRelacionadosEntregaDoc();
      this.entregaDocHistorialSeleccionados = {};
      this.mostrarModalEntregaDocHistorial = true;
    });
  }

  cerrarModalEntregaDocHistorial(): void {
    this.mostrarModalEntregaDocHistorial = false;
    this.entregaDocHistorialCursosRelacionados = [];
    this.entregaDocHistorialSeleccionados = {};
  }

  seleccionarTodosCursosEntregaDocHistorial(): void {
    const seleccion: { [programadoId: number]: boolean } = {};
    this.entregaDocHistorialCursosRelacionados.forEach((curso) => {
      if (!this.tieneEntregaDocumentos(curso)) {
        seleccion[curso.programado_id] = true;
      }
    });
    this.entregaDocHistorialSeleccionados = seleccion;
  }

  limpiarSeleccionCursosEntregaDocHistorial(): void {
    this.entregaDocHistorialSeleccionados = {};
  }

  toggleCursoEntregaDocHistorial(curso: HistorialCurso, event: Event): void {
    if (this.tieneEntregaDocumentos(curso)) return;
    const input = event.target as HTMLInputElement;
    this.entregaDocHistorialSeleccionados = {
      ...this.entregaDocHistorialSeleccionados,
      [curso.programado_id]: input.checked
    };
  }

  getEntregaDocHistorialSeleccionadosCount(): number {
    return Object.values(this.entregaDocHistorialSeleccionados)
      .filter(Boolean)
      .length;
  }

  private getEntregaDocHistorialSeleccionadosIds(): number[] {
    return Object.keys(this.entregaDocHistorialSeleccionados)
      .filter((id) => this.entregaDocHistorialSeleccionados[Number(id)])
      .map((id) => Number(id));
  }

  confirmarSubidaEntregaDocHistorial(): void {
    const seleccionados = this.getEntregaDocHistorialSeleccionadosIds();
    this.subirEntregaDocHistorial(seleccionados);
  }

  onDragOverEntregaDocHistorial(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.entregaDocHistorialArrastrando = true;
  }

  onDragLeaveEntregaDocHistorial(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.entregaDocHistorialArrastrando = false;
  }

  onDropEntregaDocHistorial(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.entregaDocHistorialArrastrando = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.entregaDocHistorialArchivo = file;
    }
  }

  onEntregaDocHistorialSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.entregaDocHistorialArchivo = input.files[0];
    }
  }

  onAgregarEntregaDocHistorialSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.confirmarAgregarEntregaDocHistorial(file);
      input.value = '';
    }
  }

  confirmarAgregarEntregaDocHistorial(file: File): void {
    const yaTiene = this.tieneEntregaDocumentos(this.cursoSeleccionado);

    Swal.fire({
      title: yaTiene ? '¿Agregar otro anexo SP-F-03?' : '¿Subir anexo SP-F-03?',
      html: yaTiene
        ? '<p>El archivo anterior se conservará en Drive y en <strong>Anexos</strong>. El nuevo se agregará como documento adicional.</p>'
        : '<p>Se guardará en la carpeta <strong>Anexos</strong> del expediente del curso.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: yaTiene ? 'Sí, agregar' : 'Sí, subir',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.entregaDocHistorialArchivo = file;
        this.iniciarSubidaEntregaDocHistorial();
      }
    });
  }

  getEntregaDocumentosHistorial(curso: HistorialCurso | null): any[] {
    if (!curso?.documentos?.length) return [];

    return [...curso.documentos]
      .filter((doc) => this.esDocumentoEntregaDoc(doc))
      .sort((a, b) => {
        const fechaA = a.fecha_subida ? new Date(a.fecha_subida).getTime() : 0;
        const fechaB = b.fecha_subida ? new Date(b.fecha_subida).getTime() : 0;
        return fechaB - fechaA;
      });
  }

  eliminarEntregaDocHistorial(documento: any): void {
    const documentoProgId = Number(documento?.documento_prog_id);
    if (!this.cursoSeleccionado || !Number.isFinite(documentoProgId) || documentoProgId <= 0) {
      Swal.fire({
        title: 'No se puede eliminar',
        text: 'No se encontró el identificador del documento. Recarga la vista e intenta de nuevo.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const nombre = documento?.nombre_archivo || 'este anexo';

    Swal.fire({
      title: '¿Eliminar anexo SP-F-03?',
      html: `<p>Se eliminará <strong>${nombre}</strong> de Google Drive y de la base de datos.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.entregaDocHistorialEliminandoId = documentoProgId;
      firstValueFrom(this.backendService.eliminarDocumentoCursoProgramado(documentoProgId))
        .then(() => {
          this.removerEntregaDocDeCurso(this.cursoSeleccionado, documentoProgId);
          Swal.fire({
            title: 'Anexo eliminado',
            text: 'El archivo fue eliminado de Drive y del sistema.',
            icon: 'success',
            confirmButtonColor: '#38512F'
          });
        })
        .catch((err: any) => {
          Swal.fire({
            title: 'Error al eliminar',
            text: err?.error?.message || 'No se pudo eliminar el anexo.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        })
        .finally(() => {
          this.entregaDocHistorialEliminandoId = null;
        });
    });
  }

  private removerEntregaDocDeCurso(curso: HistorialCurso | null, documentoProgId: number): void {
    if (!curso) return;

    const docs = Array.isArray(curso.documentos) ? curso.documentos : [];
    curso.documentos = docs.filter((doc) => Number(doc?.documento_prog_id) !== documentoProgId);

    if (curso.seccionesHistorial) {
      curso.seccionesHistorial = this.construirSeccionesHistorial(
        curso.carpetasDrive || [],
        curso.documentos
      );
      this.sincronizarSeccionActivaHistorial(curso);
    }
  }

  cancelarEntregaDocHistorial(): void {
    this.entregaDocHistorialArchivo = null;
  }

  async subirEntregaDocHistorial(programadoIdsExtra: number[] = []): Promise<void> {
    if (!this.entregaDocHistorialArchivo || !this.cursoSeleccionado) return;

    const MAX_MB = 10;
    if (this.entregaDocHistorialArchivo.size > MAX_MB * 1024 * 1024) {
      Swal.fire({
        title: 'Archivo demasiado grande',
        text: `El archivo supera ${MAX_MB} MB.`,
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.entregaDocHistorialSubiendo = true;
    const programadoId = this.cursoSeleccionado.programado_id;
    const file = this.entregaDocHistorialArchivo;
    const descripcion = this.entregaDocDescripcion;
    const tipoDocumento = this.entregaDocTipo;
    const extraIds = (programadoIdsExtra || [])
      .filter((id) => Number.isFinite(id))
      .map((id) => Number(id))
      .filter((id) => id && id !== programadoId);
    const modoAgregar = this.tieneEntregaDocumentos(this.cursoSeleccionado);

    Swal.fire({
      title: 'Subiendo documento...',
      text: 'Guardando en Drive',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    let vinculoError: string | null = null;
    let vinculados = 0;
    let omitidos = 0;

    try {
      const res: any = await firstValueFrom(
        this.backendService.subirDocumentoCursoProgramado(
          programadoId,
          tipoDocumento,
          file,
          descripcion,
          modoAgregar ? { modo: 'agregar' } : undefined
        )
      );

      const nuevo: any = {
        documento_prog_id: res?.archivo?.documento_prog_id || res?.archivo?.id || null,
        descripcion,
        tipo_documento: tipoDocumento,
        nombre_archivo: res?.archivo?.nombre || file.name,
        archivo_url: res?.archivo?.url || '',
        drive_file_id: res?.archivo?.drive_file_id || null,
        fecha_subida: new Date().toISOString()
      };

      this.registrarEntregaDocEnCurso(this.cursoSeleccionado, nuevo, !modoAgregar);

      if (extraIds.length) {
        try {
          const payload = {
            programadoIds: extraIds,
            driveFileId: nuevo.drive_file_id,
            archivoUrl: nuevo.archivo_url,
            nombreArchivo: nuevo.nombre_archivo,
            descripcion,
            tipoDocumento
          };

          const vinculacion: any = await firstValueFrom(
            this.backendService.vincularEntregaDocumentosProgramados(programadoId, payload)
          );

          vinculados = Number(vinculacion?.vinculados || 0);
          omitidos = Number(vinculacion?.omitidos || 0);

          const vinculadosIds = Array.isArray(vinculacion?.vinculadosIds)
            ? vinculacion.vinculadosIds
            : extraIds;

          this.registrarEntregaDocEnCursos(vinculadosIds, nuevo);
        } catch (linkErr: any) {
          vinculoError = linkErr?.error?.message || 'No se pudieron vincular los cursos adicionales.';
        }
      }

      let successText = modoAgregar
        ? 'El anexo SP-F-03 fue agregado correctamente.'
        : 'La Entrega de Documentos (SP-F-03) fue registrada correctamente.';
      if (extraIds.length && !vinculoError) {
        const vinculadosTexto = vinculados || Math.max(extraIds.length - omitidos, 0);
        successText += ` Se vinculo a ${vinculadosTexto} curso(s) adicional(es).`;
        if (omitidos > 0) {
          successText += ` ${omitidos} ya tenian anexo.`;
        }
      }
      if (vinculoError) {
        successText += ` El archivo se subio, pero no se pudo vincular: ${vinculoError}`;
      }

      this.entregaDocHistorialArchivo = null;
      this.cerrarModalEntregaDocHistorial();

      Swal.fire({
        title: '¡Documento subido!',
        text: successText,
        icon: vinculoError ? 'warning' : 'success',
        confirmButtonColor: '#38512F'
      });
    } catch (err: any) {
      Swal.fire({
        title: 'Error al subir',
        text: err?.error?.message || 'No se pudo subir el documento.',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
    } finally {
      this.entregaDocHistorialSubiendo = false;
    }
  }

  private registrarEntregaDocEnCurso(curso: HistorialCurso | null, documento: any, reemplazar: boolean) {
    if (!curso) return;

    const docs = Array.isArray(curso.documentos) ? curso.documentos : [];
    const filtrados = reemplazar
      ? docs.filter((doc) => !this.esDocumentoEntregaDoc(doc))
      : docs;

    curso.documentos = [...filtrados, documento];

    if (curso.seccionesHistorial) {
      curso.seccionesHistorial = this.construirSeccionesHistorial(
        curso.carpetasDrive || [],
        curso.documentos
      );
      this.sincronizarSeccionActivaHistorial(curso);
    }
  }

  private registrarEntregaDocEnCursos(programadoIds: number[], documento: any) {
    const ids = new Set((programadoIds || []).map((id) => Number(id)).filter(Boolean));
    if (!ids.size) return;

    const actualizarLista = (cursos: HistorialCurso[]) => {
      cursos.forEach((curso) => {
        if (ids.has(curso.programado_id)) {
          this.registrarEntregaDocEnCurso(curso, documento, false);
        }
      });
    };

    actualizarLista(this.historialCursos);
    actualizarLista(this.cursosEmpresaEntregaDoc);
  }

  formatearTamanoEntregaDoc(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  ngOnDestroy() {
    this.destruirEncuestaPieCharts();
    this.cerrarVisorHistorial();
    this.cerrarEditorDocumentoWord();
  }
}

