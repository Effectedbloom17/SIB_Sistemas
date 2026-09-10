import { Component, ElementRef, HostBinding, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import DOMPurify from 'dompurify';
import { Observable, Subject, of, timer } from 'rxjs';
import { catchError, takeUntil, timeout } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { SgcDashboardCacheService } from 'src/app/services/sgc-dashboard-cache.service';
import { environment } from 'src/environments/environment';
import { DG_F07_PROCESOS, DgF07ProcesoDef } from './sgc-dg-f07.procesos';
import {
  CapituloFormatoConfig,
  PlantillaFormato,
  SGC_CAPITULOS_CATALOG
} from './sgc-formatos.catalog';
import {
  clonarCatalogoSgcF01,
  esDocumentoExternoSgcF01 as esDocExternoCatalogo,
  ordenarComoExcelSgcF01,
  seccionIdParaEspecie,
  SGC_F01_SECCIONES
} from './sgc-f-01.catalog';
import { SgcListaMaestraVigenciaService } from './sgc-lista-maestra-vigencia.service';
import {
  areaDePuesto,
  puestoCanonicoOrganigrama
} from '../recursos-humanos/organigrama-biznaga.catalog';

interface AthF02ExperienciaFila {
  enQue: string;
  tiempo: string;
}

interface AthF02RelacionFila {
  actor: string;
  motivo: string;
}

interface AthF02ReqItem {
  activo: boolean;
  detalle: string;
}

interface AthF02Escolaridad {
  primaria: boolean;
  secundaria: boolean;
  bachillerato: boolean;
  tecnico: boolean;
  tsu: boolean;
  licenciatura: boolean;
  licenciaturaEn: string;
  especialidad: boolean;
  especialidadEn: string;
  maestria: boolean;
  maestriaEn: string;
  otro: boolean;
  otroDetalle: string;
}

interface AthF02Requerimientos {
  computadora: AthF02ReqItem;
  software: AthF02ReqItem;
  informacion: AthF02ReqItem;
  herramientas: AthF02ReqItem;
  uniformes: AthF02ReqItem;
  otros: AthF02ReqItem;
}

interface AthF02PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink: string | null;
  previewUrl?: string | null;
  fechaSubida: string | null;
}

interface AthF02Perfil {
  id: string;
  puesto: string;
  areaDepartamento: string;
  puestoAlQueReporta: string;
  puestosQueLeReportan: string;
  objetivo: string;
  funciones: string[];
  edad: '' | 'minima' | 'maxima' | 'indistinto';
  edadMinima: string;
  edadMaxima: string;
  edadIndistinto: boolean;
  sexo: '' | 'masculino' | 'femenino' | 'indistinto';
  estadoCivil: '' | 'soltero' | 'casado' | 'indistinto';
  escNivel: '' | 'primaria' | 'secundaria' | 'bachillerato' | 'tecnico' | 'tsu' | 'licenciatura' | 'especialidad' | 'maestria' | 'otro';
  esc: AthF02Escolaridad;
  experiencia: AthF02ExperienciaFila;
  experiencias: AthF02ExperienciaFila[];
  experienciaIzq: AthF02ExperienciaFila[];
  experienciaDer: AthF02ExperienciaFila[];
  formacionCompetenciasTecnicas: string;
  habilidadesBlandas: string;
  conocimientoEquipoOperacion: string;
  requerimientos: AthF02Requerimientos;
  relacionesInternas: AthF02RelacionFila[];
  relacionesExternas: AthF02RelacionFila[];
  pdfFirmado: AthF02PdfFirmado | null;
  nombreHoja?: string;
}

interface AthF02FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  perfiles: AthF02Perfil[];
  perfilActivoId: string | null;
}

interface AthF09PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink: string | null;
  previewUrl?: string | null;
  fechaSubida: string | null;
}

interface AthF09PresupuestoItem {
  descripcion: string;
  costoUnitario: number | null;
  importe: number | null;
}

interface AthF09Cotizacion {
  id: string;
  folio: string;
  folioBase: string;
  folioAnterior?: string | null;
  empresa: string;
  aceptada: boolean;
  driveFileId: string | null;
  nombreArchivo: string | null;
  fechaCreacion: string;
  pdfFirmado: AthF09PdfFirmado | null;
  borrador?: boolean;
  lugar: string;
  fechaCarta: string;
  destinatario: string;
  atencion: string;
  terminos: string[];
  entregables: string[];
  presupuestoIntro: string;
  presupuestoItems: AthF09PresupuestoItem[];
  notas: string[];
  subtotal: number | null;
  iva: number | null;
  total: number | null;
}

interface AthF09FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  cotizaciones: AthF09Cotizacion[];
  cotizacionActivaId: string | null;
}

interface AthF11Competencia {
  id: string;
  grupo: 'tecnicas' | 'organizacionales' | 'interpersonales' | 'personales';
  titulo: string;
  descripcion: string;
  calificacion: number | null;
}

interface AthF11PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink: string | null;
  previewUrl?: string | null;
  fechaSubida: string | null;
}

interface AthF11EmpleadoCatalogo {
  id: string;
  nombreCompleto: string;
  puesto: string;
  areaDepartamento: string;
  noEmpleado: string;
}

interface AthF11Evaluacion {
  id: string;
  folio: string;
  nombreCompleto: string;
  puesto: string;
  areaDepartamento: string;
  noEmpleado: string;
  fechaIngreso: string;
  periodoEvaluado: string;
  evaluador: string;
  usuarioId: string | null;
  competencias: AthF11Competencia[];
  observaciones: string;
  promedioGeneral: number | null;
  fortalezas: string;
  areasOportunidad: string;
  planMejora: string;
  comentariosEvaluador: string;
  fechaEvaluacion: string;
  driveFileId: string | null;
  nombreArchivo: string | null;
  pdfFirmado: AthF11PdfFirmado | null;
  fechaCreacion: string;
  borrador?: boolean;
}

interface AthF11FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  evaluaciones: AthF11Evaluacion[];
  evaluacionActivaId: string | null;
}

interface DgF05Fila {
  parteInteresada: string;
  tipo: '' | 'Interno' | 'Externo';
  necesidadesParte: string;
  necesidadesOrg: string;
  influencia: '' | 'Alta' | 'Media' | 'Baja';
  razon: string;
  seguimiento: string;
}

type DgF04Seccion = 'fortalezas' | 'oportunidades' | 'debilidades' | 'amenazas';

interface DgF04Fila {
  factor: string;
  responsable: string;
  seguimiento: string;
  probabilidad: string;
  consecuencia: string;
  resultado: string;
}

interface DgF04SeccionConfig {
  key: DgF04Seccion;
  titulo: string;
  subtitulo: string;
  icon: string;
  colFactor: string;
}

interface DgF02PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink: string | null;
  previewUrl?: string | null;
  fechaSubida: string;
}

interface DgF01ImagenMapa {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink: string | null;
  fechaActualizacion: string | null;
}

interface DgF01Form {
  codigo: string;
  revision: string;
  fechaRevision: string;
  imagenMapa: DgF01ImagenMapa | null;
  pdfFirmado: DgF02PdfFirmado | null;
}

interface DgF02Form {
  empresa: string;
  fechaElaboracion: string;
  alcance: string;
  requisitosNoAplicables: string;
  pdfFirmado: DgF02PdfFirmado | null;
}

interface SgcF18Fila {
  nombre: string;
  emite: string;
  fechaVigor: string;
  documento: string;
  vigencia: string;
  responsable: string;
  observaciones: string;
}

interface SgcPo01Form {
  empresa: string;
  fechaElaboracion: string;
  revision: string;
  politica: string;
  firmante: string;
  cargoFirmante: string;
  pdfFirmado: DgF02PdfFirmado | null;
}

interface SgcF11Fila {
  operacion: string;
  etapa: string;
  modoFalla: string;
  causas: string;
  ocurrencia: string;
  efecto: string;
  severidad: string;
  controlesPreventivos: string;
  controlesDeteccion: string;
  deteccion: string;
  rpn: string;
  acciones: string;
  responsable: string;
  fechaCompromiso: string;
  resultado: string;
  severidadPost: string;
  ocurrenciaPost: string;
  deteccionPost: string;
  rpnPost: string;
}

interface SgcF12Fila {
  actividad: string;
  asignacion: string;
  recursos: string;
  fechaCompromiso: string;
  verificacion: string;
}

interface SgcF02Fila {
  nombreDocumento: string;
  codigo: string;
  versionActual: string;
  tipoDocumento: string;
  tipoSolicitud: string;
  motivo: string;
}

interface SgcF02UsuarioCatalogo {
  nombre: string;
  puesto: string;
  area: string;
}

type SgcF02DocComboCampo = 'nombre' | 'codigo';

interface SgcF01Documento {
  area: string;
  tipoDocumento: string;
  especie: string;
  codigo: string;
  versionVigente: string;
  fechaRevision: string;
  nombreDocumento: string;
  responsable: string;
  /** true = vigente (fila verde); false = no vigente (fila rosa). No se elimina. */
  vigente?: boolean;
  fuenteVersion?: 'sistema' | 'catalogo';
  enSistema?: boolean;
}

interface SgcF01FormData {
  revision: string;
  fechaRevision: string;
  documentos: SgcF01Documento[];
}

interface SgcF01GrupoVista {
  id: string;
  titulo: string;
  documentos: SgcF01Documento[];
}

interface SgcF02Solicitud {
  id: string;
  fechaSolicitud: string;
  nombreSolicitante: string;
  puestoSolicitante: string;
  areaDepartamento: string;
  filas: SgcF02Fila[];
  solicita: string;
  autoriza: string;
}

interface SgcF02FormData {
  revision: string;
  fechaRevision: string;
  solicitudes: SgcF02Solicitud[];
  solicitudActivaId: string | null;
}

interface SgcF02DocFisico {
  id: string;
  nombre: string;
  mimeType: string | null;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  tipo: 'pdf' | 'imagen' | 'otro';
}

interface SgcF04AccionesInmediatas {
  correccion: boolean;
  analisisCausas: boolean;
  separacion: boolean;
  contencion: boolean;
  devolucion: boolean;
  informarCliente: boolean;
  suspension: boolean;
  autorizacionConcesion: boolean;
}

interface SgcF04Normas {
  iso9001: boolean;
  iso14001: boolean;
  iso45001: boolean;
}

interface SgcF04FilaCorreccion {
  descripcion: string;
  responsable: string;
  fecha: string;
}

interface SgcF04FilaCorrectiva {
  no: number;
  acciones: string;
  responsable: string;
  fecha: string;
}

interface SgcF04FilaResultado {
  no: number;
  descripcion: string;
  verifico: string;
}

interface SgcF04PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink?: string | null;
  previewUrl?: string | null;
  fechaSubida?: string | null;
}

type SgcF04ComboCampo =
  | 'reportaNombre'
  | 'reportaPuesto'
  | 'reportaEmpresa'
  | 'registraNombre'
  | 'registraPuesto'
  | 'registraEmpresa'
  | 'verifico';

/** Un reporte individual del archivero SGC-F-04. */
interface SgcF04Reporte {
  id: string;
  fecha: string;
  folio: string;
  fuente: string;
  fuenteDetalle: string;
  normas: SgcF04Normas;
  origenArea: string;
  reportaNombre: string;
  reportaPuesto: string;
  reportaEmpresa: string;
  registraNombre: string;
  registraPuesto: string;
  registraEmpresa: string;
  registraNc: string;
  descripcionNc: string;
  accionesInmediatas: SgcF04AccionesInmediatas;
  maximaAutoridadNombre: string;
  maximaAutoridadPuesto: string;
  accionesCorreccion: SgcF04FilaCorreccion[];
  causas: string[];
  accionesCorrectivas: SgcF04FilaCorrectiva[];
  resultados: SgcF04FilaResultado[];
  fechaCierre: string;
  pdfFirmado: SgcF04PdfFirmado | null;
}

/** Contenedor del formato: meta de plantilla + archivero de reportes. */
interface SgcF04FormData {
  revision: string;
  fechaRevision: string;
  reportes: SgcF04Reporte[];
}

interface SgcF22PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink?: string;
  previewUrl?: string;
  fechaSubida?: string | null;
}

interface SgcF22Reporte {
  id: string;
  folio: string;
  fechaSuceso: string;
  empresaAfectada: string;
  nombreClienteProveedor: string;
  nombreBien: string;
  descripcionSuceso: string;
  accionesBiznaga: string;
  nombreFirma: string;
  pdfFirmado: SgcF22PdfFirmado | null;
}

interface SgcF22FormData {
  revision: string;
  fechaRevision: string;
  reportes: SgcF22Reporte[];
  reporteActivoId?: string | null;
}

interface DgF03Form {
  empresa: string;
  fechaElaboracion: string;
  revision: string;
  objetivos: string;
  firmante: string;
  cargoFirmante: string;
  pdfFirmado: DgF02PdfFirmado | null;
}

interface DgF08Form {
  empresa: string;
  fechaElaboracion: string;
  revision: string;
  mision: string;
  vision: string;
  valores: string;
  codigoTrabajoEquipo: string;
  firmante: string;
  cargoFirmante: string;
  pdfFirmado: DgF02PdfFirmado | null;
}

interface DgF07ProcesoForm {
  nombreProceso: string;
  responsable: string;
  objetivo: string;
  procesoAnterior: string;
  procesoSiguiente: string;
  entradas: string;
  salidas: string;
  recursos: string;
  criteriosMetodos: string;
  indicadores: string;
}

interface SgcF06Auditor {
  nombre: string;
  puesto: string;
  tiempoEmpresa: string;
  escolaridad: string;
  cursoAuditoresInternos: string;
  calificacionCurso: number | null;
  nivelObjetividad: string;
  desempeno: string;
  promedio: number | null;
  auditoriasRealizadas: number | string;
}

interface SgcF06Resumen {
  activos: number;
  acreditados: number;
  enEntrenamiento: number;
}

interface SgcF06CalificacionOpcion {
  valor: number;
  descripcion: string;
}

const SGC_F06_OBJETIVIDAD_OPCIONES: SgcF06CalificacionOpcion[] = [
  {
    valor: 10,
    descripcion: 'Excelente nivel de objetividad e imparcialidad durante la auditoría'
  },
  {
    valor: 9,
    descripcion: 'Buen nivel de objetividad e imparcialidad durante la auditoría'
  },
  {
    valor: 8,
    descripcion: 'Mediano nivel de objetividad e imparcialidad, pero puede mejorar'
  },
  {
    valor: 7,
    descripcion: 'Bajo nivel de objetividad e imparcialidad, necesita capacitación adicional'
  },
  {
    valor: 0,
    descripcion: 'Nula objetividad e imparcialidad durante la auditoría'
  }
];

const SGC_F06_DESEMPENO_OPCIONES: SgcF06CalificacionOpcion[] = [
  {
    valor: 10,
    descripcion: 'El auditor se desenvuelve de manera excelente: muestra control sobre la auditoría'
  },
  {
    valor: 9,
    descripcion: 'El auditor muestra gran potencial para llevar a cabo más auditorías'
  },
  {
    valor: 8,
    descripcion: 'El auditor muestra compromiso con la auditoría sin embargo, se muestra inseguro'
  },
  {
    valor: 7,
    descripcion: 'El auditor muestra deficiencias notables durante la auditoría, necesita capacitación adicional'
  },
  {
    valor: 0,
    descripcion: 'El auditor no tiene control sobre la auditoría, no muestra compromiso y tiene muchas deficiencias'
  }
];

interface SgcF07MesKey {
  key: string;
  label: string;
}

interface SgcF07Calendario {
  enero: string[];
  febrero: string[];
  marzo: string[];
  abril: string[];
  mayo: string[];
  junio: string[];
  julio: string[];
  agosto: string[];
  septiembre: string[];
  octubre: string[];
  noviembre: string[];
  diciembre: string[];
}

interface SgcF07AuditoriaItem {
  noAudi: string;
  tipoAuditoria: string;
  alcance: string;
  objetivo: string;
  criterios: string;
  equipoAuditor: string;
  auditorLider: string;
  metodoAuditoria: string;
  fecha: string;
  calendario: SgcF07Calendario;
}

interface SgcF07FooterData {
  comentariosTitulo: string;
  comentariosDetalle: string;
  notaPrograma: string;
  firmaEjecutivo: string;
  firmaDireccion: string;
}

interface SgcF07FormData {
  empresa: string;
  fechaElaboracion: string;
  auditorias: SgcF07AuditoriaItem[];
  footer: SgcF07FooterData;
}

interface SgcF08AgendaItem {
  actividad: string;
  fecha: string;
  hora: string;
  areaDepto: string;
  criterio: string;
  auditado: string;
  auditor: string;
}

interface SgcF08FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  auditoriaNo: string;
  fechaElaboracionInforme: string;
  fechaInicio: string;
  fechaTermino: string;
  fechaEntregaInforme: string;
  empresa: string;
  ubicacion: string;
  criteriosAuditoria: string;
  alcanceAuditoria: string;
  objetivoAuditoria: string;
  auditorLider: string;
  metodoAuditoria: string;
  equipoAuditor: string;
  numObservadores: string;
  numInterpretes: string;
  numGuias: string;
  agenda: SgcF08AgendaItem[];
  roles: string[];
}

interface SgcF14ProyectoItem {
  folio: string;
  nombreProyecto: string;
  responsable: string;
  prioridad: string;
  estatus: string;
  avance: string;
}

interface SgcF14FormData {
  fechaElaboracion: string;
  proyectos: SgcF14ProyectoItem[];
}

interface SgcF25ActividadItem {
  noContrato: string;
  cliente: string;
  actividad: string;
  descripcion: string;
  fechaCompromiso: string;
  responsables: string;
  categorias: boolean[];
}

interface SgcF25FormData {
  fechaElaboracion: string;
  revision: string;
  fechaRevision: string;
  actividades: SgcF25ActividadItem[];
}

interface SgcF29ProveedorItem {
  id: string;
  proveedor: string;
  referencia: string;
  /** Fecha de esta evaluación concreta (ISO yyyy-mm-dd). */
  fecha: string;
  entregaTiempo: string;
  entregaDomicilio: string;
  precio: string;
  pagoTransferencia: string;
  servicio: string;
  calidad: string;
  calificacion: string;
}

interface SgcF29GrupoVista {
  clave: string;
  proveedor: string;
  indices: number[];
  multiple: boolean;
}

interface SgcF29EvidenciaDoc {
  id: number;
  evaluacionId: string;
  titulo: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  webViewLink: string | null;
  fechaSubida: string;
}

interface SgcF29FormData {
  fechaElaboracion: string;
  periodoEvaluacion: string;
  fechaEvaluacion: string;
  proveedores: SgcF29ProveedorItem[];
}

type SgcF28CriterioTipo =
  | 'precio'
  | 'imagen'
  | 'liga_compra'
  | 'dimensiones'
  | 'caracteristicas'
  | 'metodo_pago'
  | 'requiere_cotizacion_previa'
  | 'modelo'
  | 'material';

type SgcF28Moneda = 'MXN' | 'USD' | 'EUR' | '-';
type SgcF28Resultado = '' | 'Viable' | 'Descartado';

interface SgcF28ImagenValor {
  driveFileId: string | null;
  base64: string | null;
  dataUrl: string | null;
  mimeType: string;
  nombreArchivo: string;
}

interface SgcF28ValorProveedor {
  texto: string;
  numero: number | null;
  moneda: SgcF28Moneda;
  imagen: SgcF28ImagenValor | null;
}

interface SgcF28Criterio {
  id: string;
  tipo: SgcF28CriterioTipo;
  etiqueta: string;
  valores: SgcF28ValorProveedor[];
}

interface SgcF28Proveedor {
  nombre: string;
  procesoProductoServicio: string;
  fechaCotizacion: string;
  resultado: SgcF28Resultado;
  observaciones: string;
}

interface SgcF28Comparativa {
  id: string;
  nombreCotizacion: string;
  fechaCreacion: string;
  proveedores: SgcF28Proveedor[];
  criterios: SgcF28Criterio[];
}

interface SgcF28FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  comparativas: SgcF28Comparativa[];
  comparativaActivaId: string | null;
  catalogoCriterios: Array<{ tipo: SgcF28CriterioTipo; etiqueta: string }>;
}

interface SpF02ImagenCampo {
  driveFileId?: string;
  nombreArchivo?: string;
  mimeType?: string;
  previewUrl?: string;
  thumbDataUrl?: string;
  dataUrl?: string;
}

interface SpF02Item {
  problema: string;
  problemaImagenes: SpF02ImagenCampo[];
  acciones: string;
  responsable: string;
  fechaCompromiso: string;
  estatus: string;
  observaciones: string;
  observacionesImagenes: SpF02ImagenCampo[];
}

interface SpF02Reporte {
  id: string;
  folio: string;
  nombreEmpresa: string;
  fecha: string;
  proposito: string;
  hora: string;
  asistentes: string;
  modalidad: string;
  consultores: string;
  proxVisita: string;
  ultimaRevision: string;
  items: SpF02Item[];
  nombreHoja: string;
}

interface SpF02FormData {
  revision: string;
  fechaElaboracion: string;
  fechaRevision: string;
  reportes: SpF02Reporte[];
  reporteActivoId: string | null;
}

interface SgcF05RegistroItem {
  folio: string;
  fuente: string;
  fechaInicio: string;
  fechaCierre: string;
  area: string;
  cliente: string;
  descripcion: string;
  accion: string;
  estatus: string;
}

interface SgcF05FormData {
  fechaElaboracion: string;
  registros: SgcF05RegistroItem[];
}

type AthF08Resultado = '' | 'A' | 'NA';

interface AthF08Acreditaciones {
  dc3: boolean;
  diploma: boolean;
  examen: boolean;
  otro: boolean;
}

interface AthF08Curso {
  nombre: string;
  fecha: string;
  acreditaciones: AthF08Acreditaciones;
}

interface AthF08Colaborador {
  nombre: string;
  resultados: AthF08Resultado[];
}

interface AthF08FormData {
  fecha: string;
  revision: string;
  fechaRevision: string;
  cursos: AthF08Curso[];
  colaboradores: AthF08Colaborador[];
}

/** Marca de verificación SGC-F-09: C = Cumple, NC = No cumple, O = Observación. */
type SgcF09Marca = '' | 'C' | 'NC' | 'O';

interface SgcF09Requisito {
  id: string;
  seccion: string;
  requisito: string;
  descripcion: string;
  preguntas: string;
  evidencias: string;
  marca: SgcF09Marca;
  hallazgo: string;
}

interface SgcF09FormData {
  revision: string;
  fechaRevision: string;
  fecha: string;
  nombreAuditor: string;
  norma9001: boolean;
  norma45001: boolean;
  norma14001: boolean;
  requisitos: SgcF09Requisito[];
}

type SgcF10Clasificacion = '' | 'OP' | 'NC_MENOR' | 'NC_MAYOR';

interface SgcF10Hallazgo {
  id: string;
  clausula: string;
  clasificacion: SgcF10Clasificacion;
  descripcion: string;
  procesos: string;
  /** Auditor responsable del hallazgo */
  auditorId: number | null;
  auditor: string;
  /** Fecha de adición al informe (YYYY-MM-DD) */
  fechaAdicion: string;
}

type SgcF10OrdenHallazgos = 'manual' | 'auditor_asc' | 'clausula_asc' | 'fecha_asc' | 'fecha_desc';

interface SgcF10HallazgoVista {
  hallazgo: SgcF10Hallazgo;
  index: number;
  num: number;
}

interface SgcF10FormData {
  revision: string;
  fechaRevision: string;
  fechaElaboracion: string;
  auditoriaNo: string;
  fechasAuditoria: string;
  ubicaciones: string;
  empresaId: number | null;
  empresa: string;
  domicilio: string;
  objetivos: string;
  criterios: string;
  alcance: string;
  auditorLiderId: number | null;
  auditorLider: string;
  auditorLiderFirmaDriveId: string;
  auditoresIds: number[];
  auditores: string;
  participantesIds: number[];
  participantes: string;
  otrosParticipantesIds: number[];
  otrosParticipantes: string;
  clausulaNorma: string;
  hallazgos: SgcF10Hallazgo[];
  conclusiones: string;
  firmaAuditorLider: string;
  firmaDireccionGeneralId: number | null;
  firmaDireccionGeneral: string;
  firmaDireccionGeneralFirmaDriveId: string;
}

interface SgcF10UsuarioOpt {
  id: number;
  nombre: string;
  firmaDriveId: string;
}

interface SgcF10EmpresaOpt {
  empresaId: number;
  nombre: string;
  direccion: string;
  ubicacion: string;
}

interface SgcF15Indicador {
  objetivo: string;
  indicador: string;
  responsable: string;
  meta: string;
  real: string;
  metaValor: number;
  realValor: number;
  semaforo: 'ok' | 'warning' | 'risk';
  tendencia: 'up' | 'down' | 'stable';
  analisis: string;
  accion: string;
}

interface SgcF15Serie {
  nombre: string;
  meta: number;
  real: number;
}

interface SgcF16Asistente {
  nombre: string;
  puesto: string;
  firma: string;
}

interface SgcF16PersonaOpt {
  id: string;
  nombre: string;
  puesto: string;
}

interface SgcF16AgendaItem {
  descripcion: string;
}

interface SgcF16Compromiso {
  descripcion: string;
  responsable: string;
  fechaCompromiso: string;
  estatus: string;
  observaciones: string;
}

interface SgcF16PdfFirmado {
  driveFileId: string;
  nombreArchivo: string;
  webViewLink?: string;
  previewUrl?: string;
  fechaSubida?: string | null;
}

interface SgcF16Minuta {
  id: string;
  folio: string;
  fechaVisita: string;
  /** Entrada opcional (HH:mm). */
  horaInicio: string;
  /** Finalización (HH:mm); la que siempre se registra. */
  horaFin: string;
  /** Texto listo para Excel, p. ej. "3:32 pm" o "11:00 am - 2:30 pm". */
  hora: string;
  lugar: string;
  asunto: string;
  notasTomadasPor: string;
  asistentes: SgcF16Asistente[];
  agenda: SgcF16AgendaItem[];
  compromisos: SgcF16Compromiso[];
  pdfFirmado: SgcF16PdfFirmado | null;
}

interface SgcF16FormData {
  fechaElaboracion: string;
  revision: string;
  fechaRevision: string;
  minutas: SgcF16Minuta[];
  minutaActivaId?: string | null;
}

type DgF06DocTipo = 'objetivos' | 'indicadores';
type DgF06MesKey = 'ENE' | 'FEB' | 'MAR' | 'ABR' | 'MAY' | 'JUN' | 'JUL' | 'AGO' | 'SEP' | 'OCT' | 'NOV' | 'DIC';
type DgF06ResultadoEstado = '' | 'ok' | 'risk';

interface DgF06MesResultado {
  mes: DgF06MesKey;
  valor: string;
  estado: DgF06ResultadoEstado;
}

interface DgF06Fila {
  id: string;
  no: number;
  proceso: string;
  acciones: string;
  recursos: string;
  responsable: string;
  fechaCompromiso: string;
  indicador: string;
  operacion: string;
  meta: string;
  freqMedicion: string;
  freqAnalisis: string;
  resultados: DgF06MesResultado[];
}

interface DgF06Documento {
  id: string;
  anio: number;
  tipo: DgF06DocTipo;
  titulo: string;
  hojaExcel: string;
  filas: DgF06Fila[];
}

interface DgF06AnioGrupo {
  anio: number;
  documentos: DgF06Documento[];
}

interface DgF06FormData {
  revision: string;
  fechaRevision: string;
  documentos: DgF06Documento[];
}

@Component({
  selector: 'app-sgc-plantilla-preview',
  templateUrl: './sgc-plantilla-preview.component.html',
  styleUrls: ['./sgc-plantilla-preview.component.scss']
})
export class SgcPlantillaPreviewComponent implements OnInit, OnDestroy {
  /** Formatos SGC en solo lectura (sin Guardar / Actualizar; Excel en preview). */
  @HostBinding('class.sgc-preview--solo-lectura')
  get esPlantillaSoloLectura(): boolean {
    return !this.puedeGestionarPlantillasSgc;
  }

  @HostBinding('class.sgc-preview--dg-f-01')
  get esDgF01(): boolean {
    return this.plantillaSlug === 'dg-f-01';
  }

  @HostBinding('class.sgc-preview--dg-f-02')
  get esDgF02(): boolean {
    return this.plantillaSlug === 'dg-f-02';
  }

  @HostBinding('class.sgc-preview--dg-f-05')
  get esDgF05(): boolean {
    return this.plantillaSlug === 'dg-f-05' || this.plantillaSlug === 'sgc-f-07'
      || this.plantillaSlug === 'sgc-f-08' || this.plantillaSlug === 'sgc-f-14' || this.plantillaSlug === 'sgc-f-25' || this.plantillaSlug === 'sgc-f-16'
      || this.plantillaSlug === 'sgc-f-29'
      || this.plantillaSlug === 'sgc-f-28'
      || this.plantillaSlug === 'sp-f-02'
      || this.plantillaSlug === 'sgc-f-05' || this.plantillaSlug === 'ath-f-02' || this.plantillaSlug === 'ath-f-08'
      || this.plantillaSlug === 'ath-f-09'
      || this.plantillaSlug === 'ath-f-11';
  }

  @HostBinding('class.sgc-preview--ath-f-02')
  get esAthF02(): boolean {
    return this.plantillaSlug === 'ath-f-02';
  }

  @HostBinding('class.sgc-preview--ath-f-09')
  get esAthF09(): boolean {
    return this.plantillaSlug === 'ath-f-09';
  }

  @HostBinding('class.sgc-preview--ath-f-11')
  get esAthF11(): boolean {
    return this.plantillaSlug === 'ath-f-11';
  }

  @HostBinding('class.sgc-preview--dg-f-04')
  get esDgF04(): boolean {
    return this.plantillaSlug === 'dg-f-04';
  }

  @HostBinding('class.sgc-preview--dg-f-07')
  get esDgF07(): boolean {
    return this.plantillaSlug === 'dg-f-07';
  }

  @HostBinding('class.sgc-preview--sgc-f-18')
  get esSgcF18(): boolean {
    return this.plantillaSlug === 'sgc-f-18';
  }

  @HostBinding('class.sgc-preview--sgc-po-01')
  get esSgcPo01(): boolean {
    return this.plantillaSlug === 'sgc-po-01';
  }

  @HostBinding('class.sgc-preview--dg-f-08')
  get esDgF08(): boolean {
    return this.plantillaSlug === 'dg-f-08';
  }

  @HostBinding('class.sgc-preview--sgc-f-06')
  get esSgcF06(): boolean {
    return this.plantillaSlug === 'sgc-f-06';
  }

  @HostBinding('class.sgc-preview--sgc-f-11')
  get esSgcF11(): boolean {
    return this.plantillaSlug === 'sgc-f-11';
  }

  @HostBinding('class.sgc-preview--sgc-f-12')
  get esSgcF12(): boolean {
    return this.plantillaSlug === 'sgc-f-12';
  }

  @HostBinding('class.sgc-preview--sgc-f-01')
  get esSgcF01(): boolean {
    return this.plantillaSlug === 'sgc-f-01';
  }

  @HostBinding('class.sgc-preview--sgc-f-02')
  get esSgcF02(): boolean {
    return this.plantillaSlug === 'sgc-f-02';
  }

  @HostBinding('class.sgc-preview--sgc-f-04')
  get esSgcF04(): boolean {
    return this.plantillaSlug === 'sgc-f-04';
  }

  @HostBinding('class.sgc-preview--sgc-f-22')
  get esSgcF22(): boolean {
    return this.plantillaSlug === 'sgc-f-22';
  }

  @HostBinding('class.sgc-preview--sgc-f-28')
  get esSgcF28(): boolean {
    return this.plantillaSlug === 'sgc-f-28';
  }

  @HostBinding('class.sgc-preview--sp-f-02')
  get esSpF02(): boolean {
    return this.plantillaSlug === 'sp-f-02';
  }

  @HostBinding('class.sgc-preview--dg-f-03')
  get esDgF03(): boolean {
    return this.plantillaSlug === 'dg-f-03';
  }

  @HostBinding('class.sgc-preview--metodologia-amef')
  get esMetodologiaAmef(): boolean {
    return this.plantillaSlug === 'metodologia-amef';
  }

  etiquetaRolUsuario = '';
  config: CapituloFormatoConfig | null = null;
  plantilla: PlantillaFormato | null = null;
  capituloSlug = '';
  plantillaSlug = '';
  embedPreviewUrl: SafeResourceUrl | null = null;

  private readonly destroy$ = new Subject<void>();

  athF02Form: AthF02FormData = this.crearAthF02FormVacio();
  athF02Vista: 'archivero' | 'editor' = 'archivero';
  athF02Busqueda = '';
  athF02PerfilActivo: AthF02Perfil | null = null;
  athF02Cargando = false;
  athF02Guardando = false;
  athF02Listo = false;
  athF02CambiosPendientes = false;
  athF02IgnorarAutoSave = false;
  athF02UltimaSync: string | null = null;
  athF02DriveFileId: string | null = null;
  athF02EditorUrl: string | null = null;
  athF02EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarAthF02Editor = false;
  athF02ContenidoModificado = false;
  athF02EditorCargando = false;
  athF02ActualizandoPlantilla = false;
  athF02SubiendoPdf = false;
  private athF02EditorIframeListo = false;
  dgF01Form = this.crearDgF01Vacio();

  athF09Form: AthF09FormData = this.crearAthF09FormVacio();
  athF09Vista: 'archivero' | 'editor' = 'archivero';
  athF09Busqueda = '';
  athF09CotizacionActiva: AthF09Cotizacion | null = null;
  athF09Cargando = false;
  athF09Guardando = false;
  athF09Listo = false;
  athF09CambiosPendientes = false;
  athF09IgnorarAutoSave = false;
  athF09UltimaSync: string | null = null;
  athF09DriveFileId: string | null = null;
  athF09EditorUrl: string | null = null;
  athF09EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarAthF09Editor = false;
  athF09ContenidoModificado = false;
  athF09EditorCargando = false;
  athF09ActualizandoPlantilla = false;
  athF09SubiendoPdf = false;
  athF09SiguienteFolio = 'SC-26-001';
  private athF09EditorIframeListo = false;
  private athF09PdfPendiente: { base64: string; nombre: string } | null = null;

  athF11Form: AthF11FormData = this.crearAthF11FormVacio();
  athF11Vista: 'archivero' | 'editor' = 'archivero';
  athF11Busqueda = '';
  athF11EvaluacionActiva: AthF11Evaluacion | null = null;
  athF11Cargando = false;
  athF11Guardando = false;
  athF11Listo = false;
  athF11CambiosPendientes = false;
  athF11IgnorarAutoSave = false;
  athF11UltimaSync: string | null = null;
  athF11DriveFileId: string | null = null;
  athF11EditorUrl: string | null = null;
  athF11EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarAthF11Editor = false;
  athF11ContenidoModificado = false;
  athF11EditorCargando = false;
  athF11ActualizandoPlantilla = false;
  athF11SubiendoPdf = false;
  athF11DescargandoPdf = false;
  athF11SiguienteFolio = 'ED-26-001';
  athF11EmpleadosCatalogo: AthF11EmpleadoCatalogo[] = [];
  athF11NombreComboAbierto = false;
  athF11NombreComboQuery = '';
  athF11EvaluadorComboAbierto = false;
  athF11EvaluadorComboQuery = '';
  private athF11EditorIframeListo = false;

  athF11SeccionesIntro = [
    { num: 1, titulo: 'Objetivo de la evaluación', texto: 'Medir de manera objetiva el rendimiento de los colaboradores, fortalecer el desarrollo del talento humano, mejorar la productividad y asegurar la alineación del desempeño individual con los objetivos estratégicos de la empresa.' },
    { num: 2, titulo: 'Alcance', texto: 'La evaluación de desempeño aplica para personal de nuevo ingreso, personal operativo y administrativo y mandos medios. El proceso de evaluación se realizará de forma anual, a partir de la última evaluación.' },
    { num: 3, titulo: 'Modelo de evaluación propuesto', texto: 'Se propone un modelo de evaluación por competencias, el cual permite evaluar no solo los resultados obtenidos, sino también las habilidades, actitudes y comportamientos que los colaboradores demuestran en el desempeño de sus funciones.' },
    { num: 4, titulo: 'Competencias a evaluar', texto: 'Competencias técnicas (dominio del puesto y calidad), organizacionales (cultura y objetivos de Biznaga), interpersonales (relación con compañeros y áreas) y personales (actitudes clave para el crecimiento organizacional).' },
    { num: 5, titulo: 'Resultados de la evaluación', texto: 'La evaluación permitirá identificar fortalezas individuales, áreas de oportunidad, necesidades de capacitación y oportunidades de desarrollo. Se obtendrá un resultado cuantitativo acompañado de observaciones cualitativas.' },
    { num: 6, titulo: 'Retroalimentación y seguimiento', texto: 'Una vez concluida la evaluación, el jefe inmediato brindará retroalimentación al colaborador, se establecerán planes de mejora y compromisos. Recursos Humanos dará seguimiento a los acuerdos establecidos.' },
    { num: 7, titulo: 'Beneficios para Biznaga', texto: 'Evaluaciones objetivas y estandarizadas, mejora continua del desempeño, fortalecimiento del talento interno, mejor toma de decisiones en capacitación y promoción, y mejora del clima organizacional.' },
    { num: 8, titulo: 'Conclusión', texto: 'La implementación de esta evaluación del desempeño por competencias permitirá a Biznaga contar con una herramienta estratégica que impulse el desarrollo del talento humano y contribuya al cumplimiento de los objetivos organizacionales.' }
  ];
  athF11Escala = [
    { etiqueta: 'Malo', valor: 6 },
    { etiqueta: 'Bajo', valor: 7 },
    { etiqueta: 'Regular', valor: 8 },
    { etiqueta: 'Bueno', valor: 9 },
    { etiqueta: 'Excelente', valor: 10 }
  ];
  athF11GruposLabel: Record<AthF11Competencia['grupo'], string> = {
    tecnicas: 'COMPETENCIAS TÉCNICAS',
    organizacionales: 'COMPETENCIAS ORGANIZACIONALES',
    interpersonales: 'COMPETENCIAS INTERPERSONALES',
    personales: 'COMPETENCIAS PERSONALES'
  };
  athF11GruposOrden: AthF11Competencia['grupo'][] = [
    'tecnicas', 'organizacionales', 'interpersonales', 'personales'
  ];

  dgF02Form = this.crearDgF02Vacio();
  dgF04Form = this.crearDgF04Vacio();
  dgF05Form = this.crearDgF05Vacio();
  sgcF18Form = this.crearSgcF18Vacio();
  sgcPo01Form = this.crearSgcPo01Vacio();
  dgF08Form = this.crearDgF08Vacio();
  sgcF11Form = this.crearSgcF11Vacio();
  sgcF12Form = this.crearSgcF12Vacio();
  sgcF01Form: SgcF01FormData = this.crearSgcF01Vacio();
  sgcF01Busqueda = '';
  /** Filtro por id de sección Excel (procedimientos, formatos, …) o vacío = todas. */
  sgcF01FiltroSeccion = '';
  /** Filas ya filtradas (cache) — no usar getters que recreen arrays en cada CD. */
  sgcF01FilasVista: SgcF01Documento[] = this.sgcF01Form.documentos.slice();
  /** Grupos por sección Excel (orden fijo del catálogo). */
  sgcF01GruposVista: SgcF01GrupoVista[] = [];
  sgcF01Resumen: { total: number; vinculados: number; actualizadosDesdeSistema: number } | null = {
    total: this.sgcF01Form.documentos.length,
    vinculados: 0,
    actualizadosDesdeSistema: 0
  };
  readonly sgcF01SeccionesFiltro = SGC_F01_SECCIONES.map((s) => ({ id: s.id, titulo: s.titulo }));
  sgcF01EditorAbierto = false;
  sgcF01EditorCerrando = false;
  sgcF01EditorGuardando = false;
  sgcF01EditorDoc: SgcF01Documento | null = null;
  sgcF01EditorForm: SgcF01Documento = this.crearDocumentoSgcF01Vacio();
  private sgcF01EditorCerrarTimer: ReturnType<typeof setTimeout> | null = null;
  sgcF02Form: SgcF02FormData = this.crearSgcF02Vacio();
  sgcF02SolicitudActiva: SgcF02Solicitud | null = null;
  sgcF02Vista: 'lista' | 'editor' = 'lista';
  sgcF02Busqueda = '';
  sgcF02UsuariosCatalogo: SgcF02UsuarioCatalogo[] = [];
  sgcF02DocsCatalogo: SgcF01Documento[] = [];
  sgcF02SolicitanteComboAbierto = false;
  sgcF02SolicitanteComboQuery = '';
  sgcF02DocComboAbierto: { fila: number; campo: SgcF02DocComboCampo } | null = null;
  sgcF02DocComboQuery = '';
  sgcF02DocsFisicos: SgcF02DocFisico[] = [];
  sgcF02DocsFisicosCargando = false;
  sgcF02DocsFisicosSubiendo = false;
  sgcF02DocsFisicosArrastrando = false;
  sgcF02VisorDoc: SgcF02DocFisico | null = null;
  sgcF02VisorUrlSafe: SafeResourceUrl | null = null;
  sgcF02VisorCargando = false;
  sgcF02VisorError: string | null = null;
  sgcF02MiniaturasError = new Set<string>();
  sgcF02ReemplazarDocId: string | null = null;
  @ViewChild('sgcF02ReemplazarInput') sgcF02ReemplazarInput?: ElementRef<HTMLInputElement>;
  readonly sgcF02TiposDocumento: string[] = [
    'Procedimiento',
    'Instructivo',
    'Formato',
    'Manual',
    'Política',
    'Registro',
    'Otro'
  ];
  readonly sgcF02TiposSolicitud: string[] = [
    'Alta',
    'Baja',
    'Modificación',
    'Actualización'
  ];
  sgcF04Form: SgcF04FormData = this.crearSgcF04Vacio();
  sgcF04ReporteActivo: SgcF04Reporte | null = null;
  sgcF04Busqueda = '';
  sgcF04Vista: 'archivero' | 'editor' = 'archivero';
  sgcF04ArchivoExpandidoId: string | null = null;
  private sgcF04FolioPendiente: string | null = null;
  sgcF04SubiendoPdf = false;
  mostrarSgcF04PdfViewer = false;
  sgcF04PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF04PdfCargando = false;
  sgcF22Form: SgcF22FormData = this.crearSgcF22Vacio();
  sgcF22ReporteActivo: SgcF22Reporte | null = null;
  sgcF22Busqueda = '';
  sgcF22Vista: 'archivero' | 'editor' = 'archivero';
  private sgcF22FolioPendiente: string | null = null;
  sgcF22SubiendoPdf = false;
  mostrarSgcF22PdfViewer = false;
  sgcF22PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF22PdfCargando = false;
  readonly sgcF04Fuentes: string[] = [
    'AUDITORÍA',
    'PROCESO',
    'QUEJA',
    'SERVICIO NO CONFORME',
    'OTRO'
  ];
  readonly sgcF04AccionesInmediatasOpts: {
    key: keyof SgcF04AccionesInmediatas;
    label: string;
    icon: string;
  }[] = [
    { key: 'correccion', label: 'Corrección', icon: 'fa-wrench' },
    { key: 'analisisCausas', label: 'Análisis de las causas', icon: 'fa-search' },
    { key: 'separacion', label: 'Separación', icon: 'fa-unlink' },
    { key: 'contencion', label: 'Contención', icon: 'fa-shield-alt' },
    { key: 'devolucion', label: 'Devolución', icon: 'fa-undo' },
    { key: 'informarCliente', label: 'Informar al cliente', icon: 'fa-comments' },
    { key: 'suspension', label: 'Suspensión de provisión de productos o servicios', icon: 'fa-pause-circle' },
    { key: 'autorizacionConcesion', label: 'Obtención de autorización para su aceptación bajo concesión', icon: 'fa-file-signature' }
  ];
  sgcF04CatalogoNombres: string[] = [];
  sgcF04CatalogoPuestos: string[] = [];
  sgcF04CatalogoEmpresas: string[] = [];
  sgcF04ComboCampo: SgcF04ComboCampo | null = null;
  sgcF04ComboFila: number | null = null;
  sgcF04ComboQuery = '';
  readonly sgcF04ComboCtx = {
    reportaNombre: {
      campo: 'reportaNombre' as const,
      inputName: 'sgcF04_repNom',
      placeholder: 'Escribir nombre…',
      hintVacio: 'Escribe el nombre; no hace falta que esté dado de alta.',
      iconoOpcion: 'fa-user',
      iconoCrear: 'fa-user-plus'
    },
    reportaPuesto: {
      campo: 'reportaPuesto' as const,
      inputName: 'sgcF04_repPuesto',
      placeholder: 'Escribir puesto…',
      hintVacio: 'Escribe el puesto; puede ser interno o externo.',
      iconoOpcion: 'fa-id-badge',
      iconoCrear: 'fa-plus'
    },
    reportaEmpresa: {
      campo: 'reportaEmpresa' as const,
      inputName: 'sgcF04_repEmp',
      placeholder: 'Escribir empresa…',
      hintVacio: 'Escribe la empresa; puede ser cliente o externa.',
      iconoOpcion: 'fa-building',
      iconoCrear: 'fa-plus'
    },
    registraNombre: {
      campo: 'registraNombre' as const,
      inputName: 'sgcF04_regNom',
      placeholder: 'Escribir nombre…',
      hintVacio: 'Escribe el nombre; no hace falta que esté dado de alta.',
      iconoOpcion: 'fa-user',
      iconoCrear: 'fa-user-plus'
    },
    registraPuesto: {
      campo: 'registraPuesto' as const,
      inputName: 'sgcF04_regPuesto',
      placeholder: 'Escribir puesto…',
      hintVacio: 'Escribe el puesto; puede ser interno o externo.',
      iconoOpcion: 'fa-id-badge',
      iconoCrear: 'fa-plus'
    },
    registraEmpresa: {
      campo: 'registraEmpresa' as const,
      inputName: 'sgcF04_regEmp',
      placeholder: 'Escribir empresa…',
      hintVacio: 'Escribe la empresa; puede ser BIZNAGA o externa.',
      iconoOpcion: 'fa-building',
      iconoCrear: 'fa-plus'
    }
  };
  dgF03Form = this.crearDgF03Vacio();
  itemsObjetivosDgF03: string[] = [''];
  sgcF06Resumen: SgcF06Resumen = {
    activos: 6,
    acreditados: 4,
    enEntrenamiento: 2
  };
  readonly sgcF07Meses: SgcF07MesKey[] = [
    { key: 'enero', label: 'Enero' },
    { key: 'febrero', label: 'Febrero' },
    { key: 'marzo', label: 'Marzo' },
    { key: 'abril', label: 'Abril' },
    { key: 'mayo', label: 'Mayo' },
    { key: 'junio', label: 'Junio' },
    { key: 'julio', label: 'Julio' },
    { key: 'agosto', label: 'Agosto' },
    { key: 'septiembre', label: 'Septiembre' },
    { key: 'octubre', label: 'Octubre' },
    { key: 'noviembre', label: 'Noviembre' },
    { key: 'diciembre', label: 'Diciembre' }
  ];
  sgcF06Auditores: SgcF06Auditor[] = [];
  readonly sgcF06ObjetividadOpciones = SGC_F06_OBJETIVIDAD_OPCIONES;
  readonly sgcF06DesempenoOpciones = SGC_F06_DESEMPENO_OPCIONES;
  sgcF07Form: SgcF07FormData = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2026-01-01',
    auditorias: [],
    footer: {
      comentariosTitulo: 'Comentarios:',
      comentariosDetalle: '',
      notaPrograma: '',
      firmaEjecutivo: 'Ejecutivo JR SGVC',
      firmaDireccion: 'Dirección General'
    }
  };
  sgcF07Cargando = false;
  sgcF07Guardando = false;
  sgcF07Listo = false;
  sgcF07CambiosPendientes = false;
  sgcF07IgnorarAutoSave = false;
  sgcF07AuditoriaSeleccionadaIndex = 0;
  sgcF07Busqueda = '';
  sgcF07UltimaSync: string | null = null;
  sgcF07DriveFileId: string | null = null;
  sgcF07EditorUrl: string | null = null;
  sgcF07EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF07Editor = false;
  sgcF07ContenidoModificado = false;
  sgcF07EditorCargando = false;
  sgcF07ActualizandoPlantilla = false;
  private sgcF07EditorIframeListo = false;
  sgcF08Form: SgcF08FormData = this.crearSgcF08FormVacio();
  sgcF08Cargando = false;
  sgcF08Guardando = false;
  sgcF08Listo = false;
  sgcF08CambiosPendientes = false;
  sgcF08IgnorarAutoSave = false;
  sgcF08UltimaSync: string | null = null;
  sgcF08DriveFileId: string | null = null;
  sgcF08EditorUrl: string | null = null;
  sgcF08EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF08Editor = false;
  sgcF08ContenidoModificado = false;
  sgcF08EditorCargando = false;
  sgcF08ActualizandoPlantilla = false;
  private sgcF08EditorIframeListo = false;

  private static readonly SGC_F10_AUDITORIA_ACTUAL = '3';
  private readonly sgcF10AuditoriaActual = '3';
  readonly sgcF10Clasificaciones: Array<{
    value: SgcF10Clasificacion;
    label: string;
    icon: string;
  }> = [
    { value: '', label: 'Sin clasificar', icon: 'fa-circle' },
    { value: 'OP', label: 'OP · Oportunidad de mejora', icon: 'fa-lightbulb' },
    { value: 'NC_MENOR', label: 'NC Menor · No conformidad menor', icon: 'fa-exclamation-triangle' },
    { value: 'NC_MAYOR', label: 'NC Mayor · No conformidad mayor', icon: 'fa-times-circle' }
  ];
  sgcF10Form: SgcF10FormData = this.crearSgcF10FormVacio();
  sgcF10Cargando = false;
  sgcF10Guardando = false;
  sgcF10GuardandoHistorico = false;
  sgcF10Listo = false;
  sgcF10CambiosPendientes = false;
  sgcF10IgnorarAutoSave = false;
  sgcF10UltimaSync: string | null = null;
  sgcF10DriveFileId: string | null = null;
  sgcF10EditorUrl: string | null = null;
  sgcF10ActualizandoPlantilla = false;
  sgcF10Historial: Array<{
    id: number;
    auditoriaNo: string;
    fechasAuditoria?: string;
    totalHallazgos?: number;
    totalNc?: number;
    totalOp?: number;
    driveFileId?: string | null;
    editorUrl?: string | null;
  }> = [];
  sgcF10Empresas: SgcF10EmpresaOpt[] = [];
  sgcF10Usuarios: SgcF10UsuarioOpt[] = [];
  sgcF10PickAuditores = '';
  sgcF10PickParticipantes = '';
  sgcF10PickOtros = '';
  sgcF10ComboAbierto: 'lider' | 'auditores' | 'participantes' | 'otros' | null = null;
  sgcF10ComboQuery = '';
  sgcF10ClasifAbierto: number | null = null;
  /** Índice del hallazgo en modo edición; el resto queda bloqueado para evitar cambios accidentales. */
  sgcF10HallazgoEditandoIdx: number | null = null;
  sgcF10OrdenHallazgos: SgcF10OrdenHallazgos = 'manual';
  sgcF10FiltroAuditor = '';
  sgcF10FiltroClausula = '';
  mostrarSgcF10Editor = false;
  sgcF10EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF10EditorCargando = false;
  private sgcF10EditorIframeListo = false;
  mostrarSgcF10HallazgoEditor = false;
  sgcF10HallazgoEditorIdx: number | null = null;
  sgcF10HallazgoFmtBold = false;
  sgcF10HallazgoFmtItalic = false;
  private sgcF10HallazgoEditorBorrador = '';
  private sgcF10HallazgoRangoGuardado: Range | null = null;
  @ViewChild('sgcF10HallazgoRichEditor') sgcF10HallazgoRichEditor?: ElementRef<HTMLDivElement>;
  readonly sgcF14Prioridades: string[] = ['Inmediato', 'Mediano plazo', 'Largo plazo'];
  readonly sgcF14Estatus: string[] = ['Concluido', 'En proceso', 'No iniciado'];
  sgcF14Form: SgcF14FormData = this.crearSgcF14FormVacio();
  sgcF14Responsables: string[] = [];
  sgcF14Cargando = false;
  sgcF14Guardando = false;
  sgcF14Listo = false;
  sgcF14CambiosPendientes = false;
  sgcF14IgnorarAutoSave = false;
  sgcF14UltimaSync: string | null = null;
  sgcF14DriveFileId: string | null = null;
  sgcF14EditorUrl: string | null = null;
  sgcF14EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF14Editor = false;
  sgcF14ContenidoModificado = false;
  sgcF14EditorCargando = false;
  sgcF14ActualizandoPlantilla = false;
  private sgcF14EditorIframeListo = false;

  readonly sgcF25Categorias: { id: number; label: string }[] = [
    { id: 1, label: 'Requisito legal o reglamentario' },
    { id: 2, label: 'Consecuencia potencial no deseada asociada a los productos o servicios' },
    { id: 3, label: 'Naturaleza, uso y vida útil de los productos y servicios' },
    { id: 4, label: 'Requisito del cliente' },
    { id: 5, label: 'Retroalimentación del cliente' }
  ];
  readonly sgcF25Actividades: string[] = [
    'Garantía',
    'Obligaciones contractuales',
    'Servicio de mantenimiento',
    'Reciclaje',
    'Disposición final',
    'Otra'
  ];
  sgcF25Form: SgcF25FormData = this.crearSgcF25FormVacio();
  sgcF25Cargando = false;
  sgcF25Guardando = false;
  sgcF25Listo = false;
  sgcF25CambiosPendientes = false;
  sgcF25IgnorarAutoSave = false;
  sgcF25UltimaSync: string | null = null;
  sgcF25DriveFileId: string | null = null;
  sgcF25EditorUrl: string | null = null;
  sgcF25EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF25Editor = false;
  sgcF25ContenidoModificado = false;
  sgcF25EditorCargando = false;
  sgcF25ActualizandoPlantilla = false;
  private sgcF25EditorIframeListo = false;
  readonly sgcF16Estatus: string[] = ['Pendiente', 'En proceso', 'Cumplido'];
  sgcF16Form: SgcF16FormData = this.crearSgcF16FormVacio();
  sgcF16Cargando = false;
  sgcF16Guardando = false;
  sgcF16Listo = false;
  sgcF16CambiosPendientes = false;
  sgcF16IgnorarAutoSave = false;
  sgcF16UltimaSync: string | null = null;
  sgcF16DriveFileId: string | null = null;
  sgcF16EditorUrl: string | null = null;
  sgcF16EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF16Editor = false;
  sgcF16ContenidoModificado = false;
  sgcF16EditorCargando = false;
  sgcF16ActualizandoPlantilla = false;
  sgcF16Vista: 'archivero' | 'editor' = 'archivero';
  sgcF16MinutaActiva: SgcF16Minuta | null = null;
  sgcF16Busqueda = '';
  sgcF16DescargandoPdf = false;
  sgcF16SubiendoPdf = false;
  mostrarSgcF16PdfViewer = false;
  sgcF16PdfCargando = false;
  sgcF16PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF16PersonasCatalogo: SgcF16PersonaOpt[] = [];
  sgcF16AsistComboAbierto: number | null = null;
  sgcF16AsistComboCampo: 'nombre' | 'puesto' | null = null;
  sgcF16AsistComboQuery = '';
  private sgcF16EditorIframeListo = false;
  /** Escala oficial SGC-F-29 (imagen de criterios). */
  readonly sgcF29Puntajes: Array<{
    valor: string;
    criterio: string;
    entrega: string;
    entregaDomicilio: string;
    precio: string;
    pagoTransferencia: string;
    servicio: string;
    calidad: string;
  }> = [
    {
      valor: '0',
      criterio: 'Pésimo',
      entrega: 'Del total de entregas nunca se realizó a tiempo',
      entregaDomicilio: 'Nunca se realizó entrega a domicilio',
      precio: 'Muy alto',
      pagoTransferencia: 'No acepta pago por transferencia',
      servicio: 'Nunca se atendió para resolver los problemas',
      calidad: 'La calidad del producto nunca fue aceptada'
    },
    {
      valor: '25',
      criterio: 'Malo',
      entrega: 'Del total de entregas casi nunca se realizó a tiempo',
      entregaDomicilio: 'Casi nunca se realizó entrega a domicilio',
      precio: 'Alto',
      pagoTransferencia: 'Casi nunca acepta pago por transferencia',
      servicio: 'Casi nunca se atendió para resolver los problemas',
      calidad: 'La calidad del producto casi nunca fue aceptada'
    },
    {
      valor: '50',
      criterio: 'Regular',
      entrega: 'Del total de entregas algunas veces se realizó a tiempo',
      entregaDomicilio: 'Algunas veces se realizó entrega a domicilio',
      precio: 'Regular',
      pagoTransferencia: 'Algunas veces acepta pago por transferencia',
      servicio: 'Algunas veces se atendió para resolver los problemas',
      calidad: 'La calidad del producto algunas veces fue aceptada'
    },
    {
      valor: '75',
      criterio: 'Bueno',
      entrega: 'Del total de entregas casi siempre se realizó a tiempo',
      entregaDomicilio: 'Casi siempre se realizó entrega a domicilio',
      precio: 'Bueno',
      pagoTransferencia: 'Casi siempre acepta pago por transferencia',
      servicio: 'Casi siempre se atendió para resolver los problemas',
      calidad: 'La calidad del producto casi siempre fue aceptada'
    },
    {
      valor: '100',
      criterio: 'Muy Bueno',
      entrega: 'Del total de entregas siempre se realizó a tiempo',
      entregaDomicilio: 'Siempre se realizó entrega a domicilio',
      precio: 'Muy bueno',
      pagoTransferencia: 'Siempre acepta pago por transferencia',
      servicio: 'Siempre se atendió para resolver los problemas',
      calidad: 'La calidad del producto siempre fue aceptada'
    }
  ];

  /** Filas demo 3–12 para completar la plantilla de 12 proveedores. */
  readonly sgcF29ProveedoresDemoExtra: Array<Omit<SgcF29ProveedorItem, 'calificacion' | 'id' | 'referencia' | 'fecha'>> = [
    {
      proveedor: 'Distribuidora del Norte SA',
      entregaTiempo: '75',
      entregaDomicilio: '100',
      precio: '50',
      pagoTransferencia: '100',
      servicio: '75',
      calidad: '75'
    },
    {
      proveedor: 'Químicos Industriales MX',
      entregaTiempo: '50',
      entregaDomicilio: '75',
      precio: '75',
      pagoTransferencia: '100',
      servicio: '50',
      calidad: '75'
    },
    {
      proveedor: 'ServiExtintores del Centro',
      entregaTiempo: '100',
      entregaDomicilio: '75',
      precio: '50',
      pagoTransferencia: '75',
      servicio: '100',
      calidad: '75'
    },
    {
      proveedor: 'Papelería Corporativa Luna',
      entregaTiempo: '75',
      entregaDomicilio: '50',
      precio: '100',
      pagoTransferencia: '100',
      servicio: '75',
      calidad: '50'
    },
    {
      proveedor: 'TecnoLab Instrumentos',
      entregaTiempo: '50',
      entregaDomicilio: '50',
      precio: '25',
      pagoTransferencia: '75',
      servicio: '75',
      calidad: '100'
    },
    {
      proveedor: 'Limpieza Total Express',
      entregaTiempo: '100',
      entregaDomicilio: '100',
      precio: '75',
      pagoTransferencia: '100',
      servicio: '100',
      calidad: '75'
    },
    {
      proveedor: 'Seguridad Integral Bajío',
      entregaTiempo: '75',
      entregaDomicilio: '75',
      precio: '50',
      pagoTransferencia: '75',
      servicio: '50',
      calidad: '50'
    },
    {
      proveedor: 'Refacciones Automotrices Rey',
      entregaTiempo: '25',
      entregaDomicilio: '50',
      precio: '75',
      pagoTransferencia: '50',
      servicio: '25',
      calidad: '50'
    },
    {
      proveedor: 'Ambiental Soluciones Verde',
      entregaTiempo: '100',
      entregaDomicilio: '75',
      precio: '50',
      pagoTransferencia: '100',
      servicio: '75',
      calidad: '100'
    },
    {
      proveedor: 'Comercializadora Atlas',
      entregaTiempo: '50',
      entregaDomicilio: '25',
      precio: '100',
      pagoTransferencia: '75',
      servicio: '50',
      calidad: '75'
    }
  ];
  readonly sgcF29Meses: Array<{ valor: string; etiqueta: string; corto: string }> = [
    { valor: '01', etiqueta: 'Enero', corto: 'Ene' },
    { valor: '02', etiqueta: 'Febrero', corto: 'Feb' },
    { valor: '03', etiqueta: 'Marzo', corto: 'Mar' },
    { valor: '04', etiqueta: 'Abril', corto: 'Abr' },
    { valor: '05', etiqueta: 'Mayo', corto: 'May' },
    { valor: '06', etiqueta: 'Junio', corto: 'Jun' },
    { valor: '07', etiqueta: 'Julio', corto: 'Jul' },
    { valor: '08', etiqueta: 'Agosto', corto: 'Ago' },
    { valor: '09', etiqueta: 'Septiembre', corto: 'Sep' },
    { valor: '10', etiqueta: 'Octubre', corto: 'Oct' },
    { valor: '11', etiqueta: 'Noviembre', corto: 'Nov' },
    { valor: '12', etiqueta: 'Diciembre', corto: 'Dic' }
  ];
  sgcF29PeriodoMesInicio = '';
  sgcF29PeriodoMesFin = '';
  sgcF29PeriodoAnio = String(new Date().getFullYear());
  sgcF29Form: SgcF29FormData = this.crearSgcF29FormVacio();
  sgcF29Cargando = false;
  sgcF29Guardando = false;
  sgcF29Listo = false;
  sgcF29CambiosPendientes = false;
  sgcF29IgnorarAutoSave = false;
  sgcF29UltimaSync: string | null = null;
  sgcF29DriveFileId: string | null = null;
  sgcF29EditorUrl: string | null = null;
  sgcF29EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF29Editor = false;
  sgcF29ContenidoModificado = false;
  sgcF29EditorCargando = false;
  sgcF29ActualizandoPlantilla = false;
  private sgcF29EditorIframeListo = false;
  /** Criterio cuyo tip de puntaje está abierto (tap en móvil/tablet). */
  sgcF29TipAbierto: string | null = null;
  sgcF29EvidenciasModalAbierto = false;
  sgcF29EvidenciasIdx: number | null = null;
  sgcF29EvidenciasCargando = false;
  sgcF29EvidenciasSubiendo = false;
  sgcF29EvidenciasDocs: SgcF29EvidenciaDoc[] = [];
  sgcF29EvidenciasFiltro: 'todo' | 'pdf' | 'docs' | 'img' = 'todo';
  sgcF29EvidenciasBusqueda = '';
  sgcF29EvidenciasConteos: Record<string, number> = {};
  sgcF29EvidenciasVista: 'grid' | 'lista' = 'grid';
  sgcF29EvidenciasDragDepth = 0;
  /** Claves de grupos de proveedor expandidos en la tabla. */
  sgcF29GruposExpandidos: Record<string, boolean> = {};
  sgcF06TipAbierto: string | null = null;

  readonly sgcF28TiposCriterio: Array<{ tipo: SgcF28CriterioTipo; etiqueta: string }> = [
    { tipo: 'precio', etiqueta: 'Precio' },
    { tipo: 'imagen', etiqueta: 'Imagen' },
    { tipo: 'liga_compra', etiqueta: 'Liga de Compra' },
    { tipo: 'dimensiones', etiqueta: 'Dimensiones' },
    { tipo: 'caracteristicas', etiqueta: 'Características' },
    { tipo: 'metodo_pago', etiqueta: 'Método de Pago' },
    { tipo: 'requiere_cotizacion_previa', etiqueta: 'Requiere Cotización Previa' },
    { tipo: 'modelo', etiqueta: 'Modelo' },
    { tipo: 'material', etiqueta: 'Material' }
  ];
  readonly sgcF28Monedas: Array<{ valor: SgcF28Moneda; etiqueta: string }> = [
    { valor: 'MXN', etiqueta: 'MXN ($)' },
    { valor: 'USD', etiqueta: 'USD (US$)' },
    { valor: 'EUR', etiqueta: 'EUR (€)' },
    { valor: '-', etiqueta: '— (nulo)' }
  ];
  readonly sgcF28Resultados: SgcF28Resultado[] = ['Viable', 'Descartado'];
  sgcF28Form: SgcF28FormData = this.crearSgcF28Vacio();
  sgcF28ComparativaActiva: SgcF28Comparativa | null = null;
  sgcF28Vista: 'archivero' | 'editor' = 'archivero';
  sgcF28Busqueda = '';
  sgcF28Cargando = false;
  sgcF28Guardando = false;
  sgcF28Listo = false;
  sgcF28CambiosPendientes = false;
  sgcF28IgnorarAutoSave = false;
  sgcF28UltimaSync: string | null = null;
  sgcF28DriveFileId: string | null = null;
  sgcF28EditorUrl: string | null = null;
  sgcF28EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF28Editor = false;
  sgcF28ContenidoModificado = false;
  sgcF28EditorCargando = false;
  sgcF28ActualizandoPlantilla = false;
  private sgcF28EditorIframeListo = false;
  sgcF28NuevoTipo: SgcF28CriterioTipo = 'precio';
  sgcF28NuevaEtiqueta = '';
  sgcF28MostrarAddCriterio = false;
  /** Por defecto solo 3 columnas; 4–5 se expanden bajo demanda o si ya tienen datos. */
  sgcF28ExpandirProveedores = false;
  sgcF28DragCriterioFrom: number | null = null;
  /** Índices estables para *ngFor (no recrear arrays en cada CD). */
  readonly sgcF28Indices3: number[] = [0, 1, 2];
  readonly sgcF28Indices5: number[] = [0, 1, 2, 3, 4];
  sgcF28IndicesVisibles: number[] = this.sgcF28Indices3;

  readonly spF02Estatus: string[] = ['Abierto', 'Cerrado'];
  readonly spF02Modalidades: string[] = ['Presencial', 'Virtual', 'Híbrida'];
  readonly spF02MaxImagenesPorCampo = 3;
  spF02Form: SpF02FormData = this.crearSpF02Vacio();
  spF02Vista: 'archivero' | 'editor' = 'archivero';
  spF02Busqueda = '';
  spF02ReporteActivo: SpF02Reporte | null = null;
  spF02Cargando = false;
  spF02Guardando = false;
  spF02Listo = false;
  spF02CambiosPendientes = false;
  spF02IgnorarAutoSave = false;
  spF02UltimaSync: string | null = null;
  spF02DriveFileId: string | null = null;
  spF02EditorUrl: string | null = null;
  spF02EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSpF02Editor = false;
  spF02ContenidoModificado = false;
  spF02EditorCargando = false;
  spF02ActualizandoPlantilla = false;
  private spF02EditorIframeListo = false;
  private spF02SubiendoImagenKey: string | null = null;

  readonly sgcF05Fuentes: string[] = [
    'Queja de cliente',
    'Auditoría interna',
    'Auditoría externa',
    'Encuestas de clima laboral',
    'Encuestas de satisfacción',
    'Análisis de indicadores',
    'Producto o servicio no conforme',
    'Revisión por la dirección',
    'Derivada de un proceso',
    'Otro'
  ];
  readonly sgcF05Areas: string[] = [
    'Administración',
    'Sistema de Gestión de Calidad',
    'Recursos Humanos',
    'Capacitación',
    'Protección Civil',
    'Sistemas',
    'Diseño e Innovación',
    'Ambiental',
    'Otros'
  ];
  readonly sgcF05Acciones: string[] = ['Corrección', 'Acción correctiva', 'Tratamiento para producto o servicio nc'];
  readonly sgcF05Estatus: string[] = ['Abierta', 'Cerrada'];
  sgcF05Form: SgcF05FormData = this.crearSgcF05FormVacio();
  sgcF05Expandida: number | null = null;
  sgcF05FiltroEstatus: '' | 'Abierta' | 'Cerrada' = '';
  sgcF05Busqueda = '';
  sgcF05Cargando = false;
  sgcF05Guardando = false;
  sgcF05Listo = false;
  sgcF05CambiosPendientes = false;
  sgcF05IgnorarAutoSave = false;
  sgcF05UltimaSync: string | null = null;
  sgcF05DriveFileId: string | null = null;
  sgcF05EditorUrl: string | null = null;
  sgcF05EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF05Editor = false;
  sgcF05ContenidoModificado = false;
  sgcF05EditorCargando = false;
  sgcF05ActualizandoPlantilla = false;
  private sgcF05EditorIframeListo = false;
  readonly athF08MaxCursos = 20;
  readonly athF08MaxColaboradores = 20;
  readonly athF08ResultadoOpciones: AthF08Resultado[] = ['', 'A', 'NA'];
  athF08Form: AthF08FormData = this.crearAthF08FormVacio();
  athF08CursosCatalogo: string[] = [];
  athF08ColaboradoresCatalogo: string[] = [];
  athF08CursoComboAbierto: number | null = null;
  athF08CursoComboQuery = '';
  athF08ColabComboAbierto: number | null = null;
  athF08ColabComboQuery = '';
  athF08Cargando = false;
  athF08Guardando = false;
  athF08Listo = false;
  athF08CambiosPendientes = false;
  athF08IgnorarAutoSave = false;
  athF08UltimaSync: string | null = null;
  athF08DriveFileId: string | null = null;
  athF08EditorUrl: string | null = null;
  athF08EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarAthF08Editor = false;
  athF08ContenidoModificado = false;
  athF08EditorCargando = false;
  athF08ActualizandoPlantilla = false;
  private athF08EditorIframeListo = false;
  sgcF09Form: SgcF09FormData = this.crearSgcF09FormVacio();
  /** Grupos cacheados — no usar getter que recree arrays en cada CD (congela la vista). */
  sgcF09Grupos: Array<{ seccion: string; items: SgcF09Requisito[] }> = this.agruparRequisitosSgcF09(
    this.sgcF09Form.requisitos
  );
  sgcF09DriveFileId: string | null = null;
  sgcF09EditorUrl: string | null = null;
  sgcF09EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarSgcF09Editor = false;
  sgcF09EditorCargando = false;
  private sgcF09EditorIframeListo = false;
  sgcF15Indicadores: SgcF15Indicador[] = [
    {
      objetivo: 'Impulsar ventas recurrentes',
      indicador: 'Índice de renovación anual',
      responsable: 'Dirección comercial',
      meta: '92 %',
      real: '89 %',
      metaValor: 92,
      realValor: 89,
      semaforo: 'warning',
      tendencia: 'up',
      analisis: 'Los clientes renovaron contratos estratégicos, pero tres cuentas siguen en negociación.',
      accion: 'Completar visitas de valor con los clientes críticos antes del 30 de junio.'
    },
    {
      objetivo: 'Reducir tiempos de respuesta',
      indicador: 'Tiempo promedio de atención a requerimientos',
      responsable: 'Operaciones',
      meta: '48 h',
      real: '44 h',
      metaValor: 48,
      realValor: 44,
      semaforo: 'ok',
      tendencia: 'down',
      analisis: 'La automatización de SP-F-05 redujo los cuellos de botella.',
      accion: 'Extender la plantilla digital al equipo de soporte remoto.'
    },
    {
      objetivo: 'Aumentar la satisfacción del cliente',
      indicador: 'Encuesta post-servicio',
      responsable: 'Coordinación de experiencia',
      meta: '95 ptos',
      real: '91 ptos',
      metaValor: 95,
      realValor: 91,
      semaforo: 'warning',
      tendencia: 'stable',
      analisis: 'Los proyectos presenciales obtuvieron calificaciones altas; los virtuales requieren mejoras.',
      accion: 'Actualizar plantillas y guiones de seguimiento para cursos virtuales.'
    },
    {
      objetivo: 'Mejorar la competencia interna',
      indicador: 'Plan de capacitación cumplido',
      responsable: 'Talento humano',
      meta: '100 %',
      real: '78 %',
      metaValor: 100,
      realValor: 78,
      semaforo: 'risk',
      tendencia: 'up',
      analisis: 'Las sesiones presenciales se reprogramaron por rotación de personal clave.',
      accion: 'Migrar 3 módulos críticos a modalidad virtual durante junio.'
    }
  ];
  sgcF15Series: SgcF15Serie[] = [
    { nombre: 'Q1', meta: 95, real: 91 },
    { nombre: 'Q2', meta: 95, real: 93 },
    { nombre: 'Q3', meta: 95, real: 0 },
    { nombre: 'Q4', meta: 95, real: 0 }
  ];
  readonly dgF06Meses: DgF06MesKey[] = [
    'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
  ];
  dgF06Form: DgF06FormData = this.crearDgF06FormVacio();
  dgF06Vista: 'archivero' | 'documento' = 'archivero';
  dgF06AnioExpandido: number | null = null;
  dgF06DocActivo: DgF06Documento | null = null;
  dgF06Busqueda = '';
  dgF06AniosVista: DgF06AnioGrupo[] = this.agruparAniosDgF06(this.dgF06Form.documentos);
  dgF06DriveFileId: string | null = null;
  dgF06EditorUrl: string | null = null;
  dgF06EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  mostrarDgF06Editor = false;
  dgF06EditorCargando = false;
  private dgF06EditorIframeListo = false;
  metodologiaAmefCargando = false;
  metodologiaAmefImportando = false;
  metodologiaAmefUltimaSync: string | null = null;
  metodologiaAmefDriveFileId: string | null = null;
  metodologiaAmefEditorUrl: string | null = null;
  metodologiaAmefEditorEmbedUrlSafe: SafeResourceUrl | null = null;
  private metodologiaAmefScrollAncla = 0;
  private metodologiaAmefIframeEnUso = false;
  private metodologiaAmefRestaurandoScroll = false;
  /** Alineado al límite JSON del servidor (512 MB) considerando codificación base64 (~75%). */
  private static readonly MAX_PDF_SGC_MB = 384;
  private static readonly MAX_PDF_SGC_BYTES = SgcPlantillaPreviewComponent.MAX_PDF_SGC_MB * 1024 * 1024;
  readonly etiquetaMaxPdfSgc = `${SgcPlantillaPreviewComponent.MAX_PDF_SGC_MB} MB`;

  readonly dgF04ProbRiesgo = ['A', 'B', 'C', 'D', 'E'];
  readonly dgF04ConsRiesgo = ['1', '2', '3', '4', '5'];
  readonly dgF04ProbOportunidad = ['1', '2', '3'];
  readonly dgF04ConsOportunidad = ['1', '2', '3'];

  dgF04AyudaSeccion: DgF04Seccion | null = null;

  readonly dgF04CriteriosProbRiesgo = [
    { nivel: 'A', descriptor: 'Casi Certeza', descripcion: 'Se espera que ocurra en la mayoría de las circunstancias.' },
    { nivel: 'B', descriptor: 'Probable', descripcion: 'Probablemente ocurra en la mayoría de las circunstancias.' },
    { nivel: 'C', descriptor: 'Posible', descripcion: 'Podría ocurrir en algún momento.' },
    { nivel: 'D', descriptor: 'Improbable', descripcion: 'Puede ocurrir en algún momento.' },
    { nivel: 'E', descriptor: 'Raro', descripcion: 'Puede ocurrir solo en circunstancias excepcionales.' }
  ];

  readonly dgF04CriteriosConsRiesgo = [
    { nivel: '1', descriptor: 'Insignificante', descripcion: 'Sin daños ni pérdidas financieras para la organización.' },
    { nivel: '2', descriptor: 'Menor', descripcion: 'Pérdida financiera pequeña para la empresa.' },
    { nivel: '3', descriptor: 'Moderado', descripcion: 'Pérdida financiera promedio; incremento en precios de venta.' },
    { nivel: '4', descriptor: 'Mayor', descripcion: 'Pérdida financiera alta; genera pérdida de clientes.' },
    { nivel: '5', descriptor: 'Catastrófico', descripcion: 'Pérdida financiera enorme; daño a la marca.' }
  ];

  readonly dgF04MatrizRiesgoFilas = [
    { nivel: 'A', fila: ['H', 'H', 'E', 'E', 'E'] },
    { nivel: 'B', fila: ['M', 'H', 'H', 'E', 'E'] },
    { nivel: 'C', fila: ['L', 'M', 'H', 'E', 'E'] },
    { nivel: 'D', fila: ['L', 'L', 'M', 'H', 'E'] },
    { nivel: 'E', fila: ['L', 'L', 'M', 'H', 'H'] }
  ];

  readonly dgF04LeyendaRiesgo = [
    { codigo: 'E', texto: 'Riesgo extremo; requiere acción inmediata.' },
    { codigo: 'H', texto: 'Riesgo alto; necesita atención de la alta gerencia.' },
    { codigo: 'M', texto: 'Riesgo moderado; debe especificarse responsabilidad gerencial.' },
    { codigo: 'L', texto: 'Riesgo bajo; administrar mediante procedimientos de rutina.' }
  ];

  readonly dgF04CriteriosProbOportunidad = [
    { nivel: '3', descriptor: 'Alta', descripcion: 'Podría ocurrir en el corto plazo.' },
    { nivel: '2', descriptor: 'Media', descripcion: 'Podría ocurrir a mediano plazo.' },
    { nivel: '1', descriptor: 'Baja', descripcion: 'Sólo podría ocurrir en casos especiales.' }
  ];

  readonly dgF04CriteriosConsOportunidad = [
    { nivel: '3', descriptor: 'Alta', descripcion: 'Tendría altos efectos positivos en la organización.' },
    { nivel: '2', descriptor: 'Media', descripcion: 'Tendría efectos medianos positivos en la organización.' },
    { nivel: '1', descriptor: 'Baja', descripcion: 'Tendría efectos bajos en la organización.' }
  ];

  /** Filas de matriz oportunidad: probabilidad 3→1 (como en Excel). */
  readonly dgF04ProbOportunidadDesc = [
    { nivel: '3', descriptor: 'Alta', fila: ['B', 'A', 'A'] },
    { nivel: '2', descriptor: 'Media', fila: ['C', 'B', 'A'] },
    { nivel: '1', descriptor: 'Baja', fila: ['C', 'C', 'B'] }
  ];

  readonly dgF04LeyendaOportunidad = [
    { codigo: 'A', texto: 'Perseguir la oportunidad.' },
    { codigo: 'B', texto: 'Aceptar la oportunidad con condiciones.' },
    { codigo: 'C', texto: 'Declinar la intención de alcanzarla por bajos beneficios.' }
  ];

  readonly dgF04Secciones: DgF04SeccionConfig[] = [
    {
      key: 'fortalezas',
      titulo: 'Fortalezas',
      subtitulo: 'Factores internos · Lo que la empresa hace bien',
      icon: 'fa-shield-alt',
      colFactor: 'Fortalezas'
    },
    {
      key: 'oportunidades',
      titulo: 'Oportunidades',
      subtitulo: 'Factores externos · Elementos que podrían aprovecharse a nuestro favor',
      icon: 'fa-lightbulb',
      colFactor: 'Oportunidades'
    },
    {
      key: 'debilidades',
      titulo: 'Debilidades',
      subtitulo: 'Factores internos · Desempeño deficiente o carencias',
      icon: 'fa-exclamation-triangle',
      colFactor: 'Debilidades'
    },
    {
      key: 'amenazas',
      titulo: 'Amenazas',
      subtitulo: 'Factores externos · Peligros o inconvenientes para la organización',
      icon: 'fa-bolt',
      colFactor: 'Amenazas'
    }
  ];
  readonly dgF07Procesos = DG_F07_PROCESOS;
  dgF07ProcesoActivoSlug = DG_F07_PROCESOS[0]?.slug ?? '';
  dgF07Forms: Record<string, DgF07ProcesoForm> = this.crearDgF07Forms();
  dgF07Busqueda = '';
  dgF07PanelBusquedaAbierto = false;

  dgF07Cargando = false;
  dgF07Guardando = false;
  dgF07CambiosPendientes = false;
  dgF07DriveFileId: string | null = null;
  dgF07EditorUrl: string | null = null;
  dgF07EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF07UltimaSync: string | null = null;
  dgF07FormMontado = true;
  mostrarDgF07Editor = false;
  dgF07EditorCargando = false;
  dgF07ActualizandoPlantilla = false;

  @ViewChild('dgF07TabsScroll') dgF07TabsScroll?: ElementRef<HTMLElement>;
  @ViewChild('amefSlidesFrame') amefSlidesFrame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('dgF02AlcanceEditor') dgF02AlcanceEditor?: ElementRef<HTMLDivElement>;
  @ViewChild('dgF02RequisitosEditor') dgF02RequisitosEditor?: ElementRef<HTMLDivElement>;

  dgF01Cargando = false;
  dgF01Guardando = false;
  dgF01SubiendoImagen = false;
  dgF01SubiendoPdf = false;
  dgF01UltimaSync: string | null = null;
  dgF01MapaPreviewUrl: string | null = null;
  dgF01ImagenVersion: number | null = null;
  dgF01ErrorImagen: string | null = null;
  private dgF01ImagenRespaldoUrl: string | null = null;
  mostrarDgF01PdfViewer = false;
  dgF01PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF01PdfCargando = false;
  dgF01PdfVistaUrlSafe: SafeResourceUrl | null = null;
  dgF01PdfVistaCargando = false;

  dgF02Cargando = false;
  dgF02Guardando = false;
  dgF02SubiendoPdf = false;
  dgF02UltimaSync: string | null = null;
  dgF02ContenidoModificado = false;
  mostrarDgF02PdfViewer = false;
  dgF02PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF02PdfCargando = false;

  dgF04Cargando = false;
  dgF04Guardando = false;
  dgF04DriveFileId: string | null = null;
  dgF04EditorUrl: string | null = null;
  dgF04EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF04UltimaSync: string | null = null;
  dgF04FechaOriginal: string | null = null;
  dgF04ContenidoModificado = false;
  mostrarDgF04Editor = false;
  dgF04EditorCargando = false;
  dgF04ActualizandoPlantilla = false;

  dgF05Cargando = false;
  dgF05Guardando = false;
  dgF05DriveFileId: string | null = null;
  dgF05EditorUrl: string | null = null;
  dgF05EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF05UltimaSync: string | null = null;
  dgF05FechaOriginal: string | null = null;
  dgF05ContenidoModificado = false;
  mostrarDgF05Editor = false;
  dgF05EditorCargando = false;

  /** Super admin (root), perfil calidad (sergio56 / calidad), editores delegados del formato o excepciones (p. ej. ATH-F-08 → mafer295). */
  private editoresFormatoVersion = 0;
  readonly MAX_AVATARES_EDITORES_FORMATO = 3;
  puedeGestionarDelegacionesSgc = false;
  cargandoEditoresFormato = false;
  guardandoEditoresFormato = false;
  menuEditoresFormatoAbierto = false;
  menuEditoresFormatoStyle: { top: string; left: string } | null = null;
  busquedaEditoresFormato = '';
  candidatosEditoresFormato: Array<{
    usuario_id: number;
    username: string;
    nombre: string;
    apellido: string;
    email?: string;
    rol?: string;
  }> = [];
  idsEditoresFormato = new Set<number>();

  get puedeGestionarPlantillasSgc(): boolean {
    void this.editoresFormatoVersion;
    return this.authService.puedeGestionarPlantillasSgcCapitulos(this.plantillaSlug);
  }

  /** Solo superadmin (root) ve y gestiona documentos no vigentes en SGC-F-01. */
  get esSuperAdminSgcF01(): boolean {
    return this.authService.esRoot();
  }

  /** Puede cambiar vigencia / desactivar / reactivar en F-01. */
  get puedeGestionarVigenciaSgcF01(): boolean {
    return this.puedeGestionarPlantillasSgc && this.esSuperAdminSgcF01;
  }

  get editoresFormatoVisibles(): Array<{
    usuario_id: number;
    nombre: string;
    username: string;
  }> {
    return this.candidatosEditoresFormato
      .filter((u) => this.esEditorFormatoFijo(u) || this.idsEditoresFormato.has(Number(u.usuario_id)))
      .map((u) => ({
        usuario_id: Number(u.usuario_id),
        nombre: this.nombreEditorFormato(u),
        username: String(u.username || '')
      }));
  }

  nombresEditoresFormatoOcultos(): string {
    return this.editoresFormatoVisibles
      .slice(this.MAX_AVATARES_EDITORES_FORMATO)
      .map((e) => e.nombre)
      .join(', ');
  }

  get candidatosEditoresFormatoFiltrados() {
    const q = this.busquedaEditoresFormato.trim().toLowerCase();
    const candidatos = this.candidatosEditoresFormato.filter((u) => !this.esEditorFormatoFijo(u));
    if (!q) {
      return candidatos;
    }
    return candidatos.filter((u) => {
      const nombre = `${u.nombre || ''} ${u.apellido || ''}`.toLowerCase();
      return nombre.includes(q)
        || String(u.username || '').toLowerCase().includes(q)
        || String(u.email || '').toLowerCase().includes(q)
        || String(u.rol || '').toLowerCase().includes(q);
    });
  }

  get editoresFormatoFijos() {
    return this.candidatosEditoresFormato.filter((u) => this.esEditorFormatoFijo(u));
  }

  private refrescarPermisoEditorSgcDelegado(): void {
    const formato = String(this.plantillaSlug || '').toLowerCase().trim();
    this.backendService.obtenerMiPermisoEditorSgc(formato || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            return;
          }
          this.authService.setEditorSgcDelegado(!!res.sgc_editor_delegado);
          if (typeof res.puede_gestionar_delegaciones === 'boolean') {
            this.puedeGestionarDelegacionesSgc = res.puede_gestionar_delegaciones;
          } else {
            this.puedeGestionarDelegacionesSgc = this.authService.puedeGestionarDelegacionesSgc();
          }
          if (formato) {
            this.authService.setEditorSgcFormato(formato, !!res.puede_gestionar_plantillas);
            this.editoresFormatoVersion++;
          }
          if (this.puedeGestionarDelegacionesSgc && formato) {
            this.cargarEditoresFormato();
          }
        },
        error: () => {
          this.puedeGestionarDelegacionesSgc = this.authService.puedeGestionarDelegacionesSgc();
          if (this.puedeGestionarDelegacionesSgc && formato) {
            this.cargarEditoresFormato();
          }
        }
      });
  }

  nombreEditorFormato(u: { nombre?: string; apellido?: string; username?: string }): string {
    const nombre = `${u.nombre || ''} ${u.apellido || ''}`.trim();
    return nombre || u.username || 'Usuario';
  }

  esEditorFormatoFijo(u: { username?: string; rol?: string }): boolean {
    const username = String(u?.username || '').toLowerCase().trim();
    const rol = String(u?.rol || '').toLowerCase().trim();
    return rol === 'root' || username === 'sergio56' || username === 'calidad';
  }

  colorAvatarEditorFormato(nombre: string): string {
    const paleta = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#059669', '#4f46e5'];
    const texto = String(nombre || 'Sin asignar');
    let hash = 0;
    for (let i = 0; i < texto.length; i++) {
      hash = texto.charCodeAt(i) + ((hash << 5) - hash);
    }
    return paleta[Math.abs(hash) % paleta.length];
  }

  inicialesEditorFormato(nombre: string): string {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) {
      return '–';
    }
    const primera = partes[0].charAt(0);
    const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (primera + ultima).toUpperCase();
  }

  cargarEditoresFormato(): void {
    const formato = String(this.plantillaSlug || '').toLowerCase().trim();
    if (!formato || !this.puedeGestionarDelegacionesSgc) {
      return;
    }
    this.cargandoEditoresFormato = true;
    this.backendService.obtenerEditoresDelegadosSgc(formato)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cargandoEditoresFormato = false;
          if (!res?.success) {
            return;
          }
          this.candidatosEditoresFormato = Array.isArray(res.candidatos) ? res.candidatos : [];
          const ids = (Array.isArray(res.usuario_ids) ? res.usuario_ids : [])
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id) && id > 0)
            .filter((id: number) => {
              const candidato = this.candidatosEditoresFormato.find((u) => Number(u.usuario_id) === id);
              return !candidato || !this.esEditorFormatoFijo(candidato);
            });
          this.idsEditoresFormato = new Set(ids);
        },
        error: () => {
          this.cargandoEditoresFormato = false;
        }
      });
  }

  toggleMenuEditoresFormato(event: Event): void {
    event.stopPropagation();
    if (!this.puedeGestionarDelegacionesSgc) {
      return;
    }
    if (this.menuEditoresFormatoAbierto) {
      this.cerrarMenuEditoresFormato();
      return;
    }
    if (!this.candidatosEditoresFormato.length && !this.cargandoEditoresFormato) {
      this.cargarEditoresFormato();
    }
    this.busquedaEditoresFormato = '';
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 270;
    const menuApproxHeight = 340;
    const gap = 6;
    let top = (rect?.bottom || 0) + gap;
    let left = Math.max(8, (rect?.left || 0) - 40);

    if (rect && top + menuApproxHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuApproxHeight - gap);
    }
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }

    this.menuEditoresFormatoAbierto = true;
    this.menuEditoresFormatoStyle = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`
    };
  }

  cerrarMenuEditoresFormato(): void {
    this.menuEditoresFormatoAbierto = false;
    this.menuEditoresFormatoStyle = null;
    this.busquedaEditoresFormato = '';
  }

  estaEditorFormatoSeleccionado(usuarioId: number): boolean {
    return this.idsEditoresFormato.has(Number(usuarioId));
  }

  toggleEditorFormato(usuarioId: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeGestionarDelegacionesSgc || this.guardandoEditoresFormato) {
      return;
    }
    const id = Number(usuarioId);
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    if (this.idsEditoresFormato.has(id)) {
      this.idsEditoresFormato.delete(id);
    } else {
      this.idsEditoresFormato.add(id);
    }
    this.idsEditoresFormato = new Set(this.idsEditoresFormato);
    this.guardarEditoresFormato();
  }

  private guardarEditoresFormato(): void {
    const formato = String(this.plantillaSlug || '').toLowerCase().trim();
    if (!formato || !this.puedeGestionarDelegacionesSgc) {
      return;
    }
    const ids = Array.from(this.idsEditoresFormato).filter((id) => {
      const candidato = this.candidatosEditoresFormato.find((u) => Number(u.usuario_id) === id);
      return !candidato || !this.esEditorFormatoFijo(candidato);
    });
    this.guardandoEditoresFormato = true;
    this.backendService.guardarEditoresDelegadosSgc(formato, ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.guardandoEditoresFormato = false;
          if (!res?.success) {
            void Swal.fire({
              icon: 'error',
              title: 'No se guardaron los permisos',
              text: res?.message || 'Intente de nuevo.',
              confirmButtonColor: '#15a596'
            });
            this.cargarEditoresFormato();
            return;
          }
          const guardados = (Array.isArray(res.usuario_ids) ? res.usuario_ids : ids)
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id) && id > 0);
          this.idsEditoresFormato = new Set(guardados);
        },
        error: (err) => {
          this.guardandoEditoresFormato = false;
          void Swal.fire({
            icon: 'error',
            title: 'Error al guardar permisos',
            text: err?.error?.message || 'No se pudieron guardar los editores del formato.',
            confirmButtonColor: '#15a596'
          });
          this.cargarEditoresFormato();
        }
      });
  }

  @HostListener('document:click')
  onDocumentClickCerrarEditoresFormato(): void {
    if (this.menuEditoresFormatoAbierto) {
      this.cerrarMenuEditoresFormato();
    }
  }

  dgF05ActualizandoPlantilla = false;

  sgcF06Cargando = false;
  sgcF06Guardando = false;
  sgcF06DriveFileId: string | null = null;
  sgcF06EditorUrl: string | null = null;
  sgcF06EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF06UltimaSync: string | null = null;
  sgcF06ContenidoModificado = false;
  sgcF06CambiosPendientes = false;
  mostrarSgcF06Editor = false;
  sgcF06EditorCargando = false;
  sgcF06ActualizandoPlantilla = false;

  sgcF18Cargando = false;
  sgcF18Guardando = false;
  sgcF18DriveFileId: string | null = null;
  sgcF18EditorUrl: string | null = null;
  sgcF18EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF18UltimaSync: string | null = null;
  sgcF18ContenidoModificado = false;
  mostrarSgcF18Editor = false;
  sgcF18EditorCargando = false;
  sgcF18ActualizandoPlantilla = false;

  sgcF11Cargando = false;
  sgcF11Guardando = false;
  sgcF11DriveFileId: string | null = null;
  sgcF11EditorUrl: string | null = null;
  sgcF11EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF11UltimaSync: string | null = null;
  sgcF11ContenidoModificado = false;
  mostrarSgcF11Editor = false;
  sgcF11EditorCargando = false;
  sgcF11ActualizandoPlantilla = false;

  sgcF12Cargando = false;
  sgcF12Guardando = false;
  sgcF12DriveFileId: string | null = null;
  sgcF12EditorUrl: string | null = null;
  sgcF12EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF12UltimaSync: string | null = null;
  sgcF12ContenidoModificado = false;
  sgcF12CambiosPendientes = false;
  mostrarSgcF12Editor = false;
  sgcF12EditorCargando = false;
  sgcF12ActualizandoPlantilla = false;

  sgcF02Cargando = false;
  sgcF02Guardando = false;
  sgcF02DriveFileId: string | null = null;
  sgcF02EditorUrl: string | null = null;
  sgcF02EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF02UltimaSync: string | null = null;
  sgcF02ContenidoModificado = false;
  sgcF02CambiosPendientes = false;
  mostrarSgcF02Editor = false;
  sgcF02EditorCargando = false;
  sgcF02ActualizandoPlantilla = false;

  sgcF01Cargando = false;
  sgcF01Guardando = false;
  sgcF01DriveFileId: string | null = null;
  sgcF01UltimaSync: string | null = null;
  sgcF01ContenidoModificado = false;
  sgcF01CambiosPendientes = false;
  sgcF01ActualizandoPlantilla = false;

  sgcF04Cargando = false;
  sgcF04Guardando = false;
  sgcF04DriveFileId: string | null = null;
  sgcF04EditorUrl: string | null = null;
  sgcF04EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF04UltimaSync: string | null = null;
  sgcF04ContenidoModificado = false;
  sgcF04CambiosPendientes = false;
  mostrarSgcF04Editor = false;
  sgcF04EditorCargando = false;
  sgcF04ActualizandoPlantilla = false;

  sgcF22Cargando = false;
  sgcF22Guardando = false;
  sgcF22DriveFileId: string | null = null;
  sgcF22EditorUrl: string | null = null;
  sgcF22EditorEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcF22UltimaSync: string | null = null;
  sgcF22ContenidoModificado = false;
  sgcF22CambiosPendientes = false;
  mostrarSgcF22Editor = false;
  sgcF22EditorCargando = false;
  sgcF22ActualizandoPlantilla = false;

  dgF03Cargando = false;
  dgF03Guardando = false;
  dgF03SubiendoPdf = false;
  dgF03UltimaSync: string | null = null;
  dgF03ContenidoModificado = false;
  dgF03FechaOriginal: string | null = null;
  mostrarDgF03PdfViewer = false;
  dgF03PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF03PdfCargando = false;


  sgcPo01Cargando = false;
  sgcPo01Guardando = false;
  sgcPo01SubiendoPdf = false;
  sgcPo01UltimaSync: string | null = null;
  sgcPo01ContenidoModificado = false;
  sgcPo01FechaOriginal: string | null = null;
  mostrarSgcPo01PdfViewer = false;
  sgcPo01PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  sgcPo01PdfCargando = false;

  dgF08Cargando = false;
  dgF08Guardando = false;
  dgF08SubiendoPdf = false;
  dgF08UltimaSync: string | null = null;
  dgF08ContenidoModificado = false;
  mostrarDgF08PdfViewer = false;
  dgF08PdfEmbedUrlSafe: SafeResourceUrl | null = null;
  dgF08PdfCargando = false;

  descargandoPlantillaPdf = false;
  dgF01CambiosPendientes = false;
  dgF02CambiosPendientes = false;
  sgcPo01CambiosPendientes = false;
  dgF08CambiosPendientes = false;
  dgF03CambiosPendientes = false;

  private readonly inactivitySaveMs = 30 * 60 * 1000;
  private inactivitySaveTimer: number | null = null;

  private dgF01IgnorarAutoSave = false;
  private dgF01Listo = false;
  private dgF02IgnorarAutoSave = false;
  private dgF02Listo = false;
  private dgF04SaveTimer: number | null = null;
  dgF04CambiosPendientes = false;
  dgF05CambiosPendientes = false;
  sgcF18CambiosPendientes = false;
  sgcF11CambiosPendientes = false;
  private dgF04IgnorarAutoSave = false;
  private dgF04Listo = false;
  private dgF04EditorIframeListo = false;
  private dgF05IgnorarAutoSave = false;
  private dgF05Listo = false;
  private dgF05EditorIframeListo = false;
  private dgF07IgnorarAutoSave = false;
  private dgF07Listo = false;
  private dgF07EditorIframeListo = false;
  private sgcF06Listo = false;
  private sgcF06EditorIframeListo = false;
  private sgcF18IgnorarAutoSave = false;
  private sgcF18Listo = false;
  private sgcF18EditorIframeListo = false;
  private sgcF11IgnorarAutoSave = false;
  private sgcF11Listo = false;
  private sgcF11EditorIframeListo = false;
  private sgcF12IgnorarAutoSave = false;
  private sgcF12Listo = false;
  private sgcF12EditorIframeListo = false;
  private sgcF01IgnorarAutoSave = false;
  private sgcF01Listo = false;
  private sgcF02IgnorarAutoSave = false;
  private sgcF02Listo = false;
  private sgcF02EditorIframeListo = false;
  private sgcF04IgnorarAutoSave = false;
  private sgcF04Listo = false;
  private sgcF04EditorIframeListo = false;
  private sgcF22IgnorarAutoSave = false;
  private sgcF22Listo = false;
  private sgcF22EditorIframeListo = false;
  private dgF03IgnorarAutoSave = false;
  private dgF03Listo = false;
  private sgcPo01IgnorarAutoSave = false;
  private sgcPo01Listo = false;
  private dgF08IgnorarAutoSave = false;
  private dgF08Listo = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private backendService: BackendServices,
    private sgcDashboardCache: SgcDashboardCacheService,
    private host: ElementRef<HTMLElement>,
    private sgcVigenciaLista: SgcListaMaestraVigenciaService
  ) {}

  ngOnInit(): void {
    this.initEtiquetaRol();
    this.reiniciarTemporizadorInactividadSgc();
    this.puedeGestionarDelegacionesSgc = this.authService.puedeGestionarDelegacionesSgc();

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(pm => {
      const capitulo = (pm.get('capitulo') || '').toLowerCase();
      const codigo = (pm.get('codigo') || '').toLowerCase();
      const cfg = SGC_CAPITULOS_CATALOG[capitulo];
      if (!cfg) {
        void this.router.navigate(['/sistema-gestion-calidad'], {
          fragment: 'sgc-capitulos-panel'
        });
        return;
      }
      const plantillaEncontrada = this.buscarPlantillaPorPreviewSlug(cfg, codigo);
      if (!plantillaEncontrada) {
        void this.router.navigate(['/sistema-gestion-calidad', capitulo]);
        return;
      }
      // Al cambiar de formato dentro de la misma vista, guardar cambios pendientes.
      if (this.plantillaSlug && this.plantillaSlug !== codigo) {
        this.guardarAlSalirSgc();
      }
      this.capituloSlug = capitulo;
      this.plantillaSlug = codigo;
      this.config = cfg;
      this.plantilla = plantillaEncontrada;
      this.embedPreviewUrl = this.resolverEmbedUrl(plantillaEncontrada);
      this.cerrarMenuEditoresFormato();
      this.idsEditoresFormato = new Set();
      this.candidatosEditoresFormato = [];
      this.refrescarPermisoEditorSgcDelegado();

      if (codigo !== 'metodologia-amef') {
        this.liberarScrollMetodologiaAmef();
      }

      if (codigo !== 'dg-f-01') {
        this.revocarDgF01PreviewUrl();
        this.dgF01MapaPreviewUrl = null;
      }
      if (codigo === 'dg-f-01') {
        this.cargarDgF01DesdeServidor();
      }
      if (codigo === 'dg-f-02') {
        this.cargarDgF02DesdeServidor();
      }
      if (codigo === 'dg-f-04') {
        this.cargarDgF04DesdeServidor();
      }
      if (codigo === 'dg-f-05') {
        this.cargarDgF05DesdeServidor();
      }
      if (codigo === 'sgc-f-07') {
        this.cargarSgcF07DesdeServidor();
      }
      if (codigo === 'sgc-f-08') {
        this.cargarSgcF08DesdeServidor();
      }
      if (codigo === 'sgc-f-09') {
        this.prepararEditorSgcF09(plantillaEncontrada);
      }
      if (codigo === 'dg-f-06') {
        this.prepararEditorDgF06(plantillaEncontrada);
        this.refrescarAniosDgF06();
        if (this.dgF06AnioExpandido == null && this.dgF06AniosVista.length) {
          this.dgF06AnioExpandido = this.dgF06AniosVista[0].anio;
        }
      }
      if (codigo === 'sgc-f-10') {
        this.cargarCatalogosSgcF10();
        this.cargarSgcF10DesdeServidor();
      }
      if (codigo === 'sgc-f-14') {
        this.cargarResponsablesSgcF14();
        this.cargarSgcF14DesdeServidor();
      }
      if (codigo === 'sgc-f-25') {
        this.cargarSgcF25DesdeServidor();
      }
      if (codigo === 'sgc-f-16') {
        this.cargarCatalogoPersonasSgcF16();
        this.cargarSgcF16DesdeServidor();
      }
      if (codigo === 'sgc-f-29') {
        this.cargarSgcF29DesdeServidor();
      }
      if (codigo === 'sgc-f-28') {
        this.cargarSgcF28DesdeServidor();
      }
      if (codigo === 'sp-f-02') {
        this.cargarSpF02DesdeServidor();
      }
      if (codigo === 'ath-f-02') {
        this.cargarAthF02DesdeServidor();
      }
      if (codigo === 'ath-f-09') {
        this.cargarAthF09DesdeServidor();
      }
      if (codigo === 'ath-f-11') {
        this.cargarCatalogoEmpleadosAthF11();
        this.cargarAthF11DesdeServidor();
      }
      if (codigo === 'sgc-f-05') {
        this.cargarSgcF05DesdeServidor();
      }
      if (codigo === 'ath-f-08') {
        this.cargarCatalogoCursosAthF08();
        this.cargarCatalogoColaboradoresAthF08();
        this.cargarAthF08DesdeServidor();
      }
      if (codigo === 'dg-f-07') {
        this.cargarDgF07DesdeServidor();
      }
      if (codigo === 'sgc-f-06') {
        this.cargarSgcF06DesdeServidor();
      }
      if (codigo === 'sgc-f-18') {
        this.cargarSgcF18DesdeServidor();
      }
      if (codigo === 'sgc-po-01') {
        this.cargarSgcPo01DesdeServidor();
      }
      if (codigo === 'dg-f-08') {
        this.cargarDgF08DesdeServidor();
      }
      if (codigo === 'sgc-f-11') {
        this.cargarSgcF11DesdeServidor();
      }
      if (codigo === 'sgc-f-12') {
        this.cargarSgcF12DesdeServidor();
      }
      if (codigo === 'sgc-f-01') {
        this.cargarSgcF01DesdeServidor();
      }
      if (codigo === 'sgc-f-02') {
        this.cargarCatalogosSgcF02();
        this.cargarSgcF02DesdeServidor();
      }
      if (codigo === 'sgc-f-04') {
        this.cargarCatalogosSgcF04();
        this.cargarSgcF04DesdeServidor();
      }
      if (codigo === 'sgc-f-22') {
        this.cargarSgcF22DesdeServidor();
      }
      if (codigo === 'dg-f-03') {
        this.cargarDgF03DesdeServidor();
      }
      if (codigo === 'metodologia-amef') {
        this.cargarMetodologiaAmefDesdeServidor();
      }
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((qm) => {
      const folio = (qm.get('folio') || '').trim();
      this.sgcF04FolioPendiente = folio || null;
      this.sgcF22FolioPendiente = folio || null;
      if (this.plantillaSlug === 'sgc-f-04' && this.sgcF04Listo && folio) {
        this.intentarAbrirReporteSgcF04PorFolio(folio);
      }
      if (this.plantillaSlug === 'sgc-f-22' && this.sgcF22Listo && folio) {
        this.intentarAbrirReporteSgcF22PorFolio(folio);
      }
    });
  }

  ngOnDestroy(): void {
    this.detenerTemporizadorInactividadSgc();
    this.guardarAlSalirSgc();
    this.revocarDgF01PreviewUrl();
    this.cancelarAutoSaveDgF04();
    this.liberarScrollMetodologiaAmef();
    if (this.sgcF01EditorCerrarTimer) {
      clearTimeout(this.sgcF01EditorCerrarTimer);
      this.sgcF01EditorCerrarTimer = null;
    }
    this.marcarBodyEditorSgcF01(false);
    this.marcarBodyAyudaDgF04(false);
    this.destroy$.next();
    this.destroy$.complete();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  get tituloCapitulo(): string {
    if (!this.config) {
      return '';
    }
    return `Capítulo ${this.config.numero}. ${this.config.titulo}`;
  }

  get dgF07FormActivo(): DgF07ProcesoForm | null {
    return this.dgF07Forms[this.dgF07ProcesoActivoSlug] ?? null;
  }

  get dgF07ProcesosBusqueda(): DgF07ProcesoDef[] {
    const q = this.normalizarBusquedaDgF07(this.dgF07Busqueda);
    if (!q) {
      return [];
    }
    return this.dgF07Procesos.filter(p => this.coincideBusquedaDgF07(p, q));
  }

  get esFormatoTablaSgc(): boolean {
    return this.plantillaSlug === 'dg-f-04' || this.plantillaSlug === 'dg-f-05'
      || this.plantillaSlug === 'dg-f-07' || this.plantillaSlug === 'sgc-f-18'
      || this.plantillaSlug === 'sgc-f-11' || this.plantillaSlug === 'sgc-f-12' || this.plantillaSlug === 'sgc-f-01'
      || this.plantillaSlug === 'sgc-f-02'
      || this.plantillaSlug === 'sgc-f-04'
      || this.plantillaSlug === 'sgc-f-22'
      || this.plantillaSlug === 'sgc-f-06' || this.plantillaSlug === 'sgc-f-07'
      || this.plantillaSlug === 'sgc-f-08' || this.plantillaSlug === 'sgc-f-09'
      || this.plantillaSlug === 'sgc-f-10' || this.plantillaSlug === 'sgc-f-15'
      || this.plantillaSlug === 'sgc-f-16' || this.plantillaSlug === 'dg-f-06'
      || this.plantillaSlug === 'sgc-f-14' || this.plantillaSlug === 'sgc-f-25' || this.plantillaSlug === 'sgc-f-16' || this.plantillaSlug === 'sgc-f-29' || this.plantillaSlug === 'sgc-f-28' || this.plantillaSlug === 'sp-f-02' || this.plantillaSlug === 'sgc-f-05'
      || this.plantillaSlug === 'ath-f-08';
  }

  get esFormatoSlidesEmbed(): boolean {
    return this.plantillaSlug === 'metodologia-amef';
  }

  /** Vista sin hero: tablas (F04/F05/F07) o documento compacto (F01/F02). */
  get esFormatoVistaCompacta(): boolean {
    return this.esFormatoTablaSgc || this.esFormatoVistaDocumento || this.esFormatoSlidesEmbed;
  }

  /** Documentos tipo hoja (mapa de procesos, alcance). */
  get esFormatoVistaDocumento(): boolean {
    return this.plantillaSlug === 'dg-f-01' || this.plantillaSlug === 'dg-f-02'
      || this.plantillaSlug === 'sgc-po-01' || this.plantillaSlug === 'dg-f-08'
      || this.plantillaSlug === 'dg-f-03';
  }

  get dgF01MapaUrl(): string | null {
    return this.dgF01MapaPreviewUrl;
  }

  get esFormatoConDriveSync(): boolean {
    return this.plantillaSlug === 'dg-f-04' || this.plantillaSlug === 'dg-f-05'
      || this.plantillaSlug === 'dg-f-07' || this.plantillaSlug === 'sgc-f-06' || this.plantillaSlug === 'sgc-f-07'
      || this.plantillaSlug === 'sgc-f-08'
      || this.plantillaSlug === 'sgc-f-09'
      || this.plantillaSlug === 'sgc-f-10'
      || this.plantillaSlug === 'sgc-f-18'
      || this.plantillaSlug === 'sgc-f-11' || this.plantillaSlug === 'sgc-f-12' || this.plantillaSlug === 'sgc-f-01'
      || this.plantillaSlug === 'sgc-f-02'
      || this.plantillaSlug === 'sgc-f-04'
      || this.plantillaSlug === 'sgc-f-22'
      || this.plantillaSlug === 'sgc-f-14' || this.plantillaSlug === 'sgc-f-25' || this.plantillaSlug === 'sgc-f-16' || this.plantillaSlug === 'sgc-f-29' || this.plantillaSlug === 'sgc-f-28' || this.plantillaSlug === 'sp-f-02' || this.plantillaSlug === 'sgc-f-05'
      || this.plantillaSlug === 'ath-f-02'
      || this.plantillaSlug === 'ath-f-08'
      || this.plantillaSlug === 'ath-f-09'
      || this.plantillaSlug === 'ath-f-11'
      || this.plantillaSlug === 'dg-f-06';
  }

  get driveSyncGuardando(): boolean {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04Guardando;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05Guardando;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07Guardando;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06Guardando;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07Guardando;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08Guardando;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10Guardando || this.sgcF10GuardandoHistorico;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18Guardando;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11Guardando;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12Guardando;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01Guardando;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02Guardando;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04Guardando;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22Guardando;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14Guardando;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25Guardando;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16Guardando;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29Guardando;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28Guardando;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02Guardando;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02Guardando;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05Guardando;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08Guardando;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09Guardando;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11Guardando;
    return false;
  }

  get driveSyncUltimaSync(): string | null {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04UltimaSync;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05UltimaSync;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07UltimaSync;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06UltimaSync;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07UltimaSync;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08UltimaSync;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10UltimaSync;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18UltimaSync;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11UltimaSync;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12UltimaSync;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01UltimaSync;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02UltimaSync;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04UltimaSync;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22UltimaSync;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14UltimaSync;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25UltimaSync;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16UltimaSync;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29UltimaSync;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28UltimaSync;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02UltimaSync;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02UltimaSync;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05UltimaSync;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08UltimaSync;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09UltimaSync;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11UltimaSync;
    return null;
  }

  get driveSyncCargando(): boolean {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04Cargando;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05Cargando;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07Cargando;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06Cargando;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07Cargando;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08Cargando;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10Cargando;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18Cargando;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11Cargando;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12Cargando;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01Cargando;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02Cargando;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04Cargando;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22Cargando;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14Cargando;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25Cargando;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16Cargando;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29Cargando;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28Cargando;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02Cargando;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02Cargando;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05Cargando;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08Cargando;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09Cargando;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11Cargando;
    return false;
  }

  get driveSyncActualizandoPlantilla(): boolean {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04ActualizandoPlantilla;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05ActualizandoPlantilla;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28ActualizandoPlantilla;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02ActualizandoPlantilla;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02ActualizandoPlantilla;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05ActualizandoPlantilla;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08ActualizandoPlantilla;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09ActualizandoPlantilla;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11ActualizandoPlantilla;
    return false;
  }

  get driveSyncDriveFileId(): string | null {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04DriveFileId;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05DriveFileId;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07DriveFileId;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06DriveFileId;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07DriveFileId;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08DriveFileId;
    if (this.plantillaSlug === 'sgc-f-09') return this.sgcF09DriveFileId;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10DriveFileId;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18DriveFileId;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11DriveFileId;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12DriveFileId;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01DriveFileId;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02DriveFileId;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04DriveFileId;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22DriveFileId;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14DriveFileId;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25DriveFileId;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16DriveFileId;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29DriveFileId;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28DriveFileId;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02DriveFileId;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02DriveFileId;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05DriveFileId;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08DriveFileId;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09DriveFileId;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11DriveFileId;
    if (this.plantillaSlug === 'dg-f-06') return this.dgF06DriveFileId;
    return null;
  }

  get driveSyncCambiosPendientes(): boolean {
    if (this.plantillaSlug === 'dg-f-04') return this.dgF04CambiosPendientes;
    if (this.plantillaSlug === 'dg-f-05') return this.dgF05CambiosPendientes;
    if (this.plantillaSlug === 'dg-f-07') return this.dgF07CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-06') return this.sgcF06CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-07') return this.sgcF07CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-08') return this.sgcF08CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-10') return this.sgcF10CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-18') return this.sgcF18CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-11') return this.sgcF11CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-12') return this.sgcF12CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-01') return this.sgcF01CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-02') return this.sgcF02CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-04') return this.sgcF04CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-22') return this.sgcF22CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-14') return this.sgcF14CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-25') return this.sgcF25CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-16') return this.sgcF16CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-29') return this.sgcF29CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-28') return this.sgcF28CambiosPendientes;
    if (this.plantillaSlug === 'sp-f-02') return this.spF02CambiosPendientes;
    if (this.plantillaSlug === 'ath-f-02') return this.athF02CambiosPendientes;
    if (this.plantillaSlug === 'sgc-f-05') return this.sgcF05CambiosPendientes;
    if (this.plantillaSlug === 'ath-f-08') return this.athF08CambiosPendientes;
    if (this.plantillaSlug === 'ath-f-09') return this.athF09CambiosPendientes;
    if (this.plantillaSlug === 'ath-f-11') return this.athF11CambiosPendientes;
    return false;
  }

  /** Cambios pendientes del formato SGC activo (Drive + Word + mapa). */
  get hayCambiosPendientesSgc(): boolean {
    if (this.esFormatoConDriveSync) {
      return this.driveSyncCambiosPendientes;
    }
    if (this.plantillaSlug === 'dg-f-01') return this.dgF01CambiosPendientes;
    if (this.plantillaSlug === 'dg-f-02') return this.dgF02CambiosPendientes;
    if (this.plantillaSlug === 'sgc-po-01') return this.sgcPo01CambiosPendientes;
    if (this.plantillaSlug === 'dg-f-08') return this.dgF08CambiosPendientes;
    if (this.plantillaSlug === 'dg-f-03') return this.dgF03CambiosPendientes;
    return false;
  }

  get editorDriveSyncAbierto(): boolean {
    if (this.plantillaSlug === 'dg-f-04') return this.mostrarDgF04Editor;
    if (this.plantillaSlug === 'dg-f-05') return this.mostrarDgF05Editor;
    if (this.plantillaSlug === 'dg-f-07') return this.mostrarDgF07Editor;
    if (this.plantillaSlug === 'sgc-f-06') return this.mostrarSgcF06Editor;
    if (this.plantillaSlug === 'sgc-f-07') return this.mostrarSgcF07Editor;
    if (this.plantillaSlug === 'sgc-f-08') return this.mostrarSgcF08Editor;
    if (this.plantillaSlug === 'sgc-f-09') return this.mostrarSgcF09Editor;
    if (this.plantillaSlug === 'sgc-f-18') return this.mostrarSgcF18Editor;
    if (this.plantillaSlug === 'sgc-f-11') return this.mostrarSgcF11Editor;
    if (this.plantillaSlug === 'sgc-f-12') return this.mostrarSgcF12Editor;
    if (this.plantillaSlug === 'sgc-f-02') return this.mostrarSgcF02Editor;
    if (this.plantillaSlug === 'sgc-f-04') return this.mostrarSgcF04Editor;
    if (this.plantillaSlug === 'sgc-f-22') return this.mostrarSgcF22Editor;
    if (this.plantillaSlug === 'sgc-f-14') return this.mostrarSgcF14Editor;
    if (this.plantillaSlug === 'sgc-f-25') return this.mostrarSgcF25Editor;
    if (this.plantillaSlug === 'sgc-f-16') return this.mostrarSgcF16Editor;
    if (this.plantillaSlug === 'sgc-f-10') return this.mostrarSgcF10Editor;
    if (this.plantillaSlug === 'sgc-f-29') return this.mostrarSgcF29Editor;
    if (this.plantillaSlug === 'sgc-f-28') return this.mostrarSgcF28Editor;
    if (this.plantillaSlug === 'sp-f-02') return this.mostrarSpF02Editor;
    if (this.plantillaSlug === 'ath-f-02') return this.mostrarAthF02Editor;
    if (this.plantillaSlug === 'sgc-f-05') return this.mostrarSgcF05Editor;
    if (this.plantillaSlug === 'ath-f-08') return this.mostrarAthF08Editor;
    if (this.plantillaSlug === 'ath-f-09') return this.mostrarAthF09Editor;
    if (this.plantillaSlug === 'ath-f-11') return this.mostrarAthF11Editor;
    if (this.plantillaSlug === 'dg-f-06') return this.mostrarDgF06Editor;
    return false;
  }

  /**
   * URL del iframe de Drive: edición completa o solo preview según permiso.
   * Evita /edit (y popups a Drive) para usuarios sin gestión de plantillas.
   */
  private urlIframeDriveSegunPermiso(editorUrl: string | null, previewUrl?: string | null): string | null {
    if (!this.puedeGestionarPlantillasSgc) {
      if (previewUrl) {
        return previewUrl;
      }
      if (!editorUrl) {
        return null;
      }
      return editorUrl.replace(/\/edit(?:\?[^#]*)?/i, '/preview');
    }
    return this.normalizarUrlEmbedSheets(editorUrl);
  }

  /** URL de Sheets apta para iframe (sin rm=minimal: deja el editor en blanco). */
  private normalizarUrlEmbedSheets(url: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url);
      if (u.hostname.includes('docs.google.com') && /\/spreadsheets\//i.test(u.pathname)) {
        // Forzar ruta /edit limpia.
        u.pathname = u.pathname.replace(/\/preview\/?$/i, '/edit');
        if (!/\/edit\/?$/i.test(u.pathname) && !u.pathname.includes('/edit')) {
          // ok
        }
        u.searchParams.delete('rm');
        u.searchParams.delete('widget');
        u.searchParams.delete('headers');
        if (!u.searchParams.has('usp')) {
          u.searchParams.set('usp', 'sharing');
        }
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  /** Arma URL de editor desde driveFileId si falta editorUrl. */
  private resolverUrlEditorDrive(editorUrl: string | null, driveFileId: string | null): string | null {
    if (editorUrl) {
      return this.normalizarUrlEmbedSheets(editorUrl);
    }
    const id = String(driveFileId || '').trim();
    if (!id) {
      return null;
    }
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`;
  }

  get tituloEditorIntegrado(): string {
    return this.puedeGestionarPlantillasSgc
      ? 'Editor integrado del formato'
      : 'Vista previa del formato';
  }

  /** Guarda el formato activo (manual, inactividad o salida). */
  guardarInformacionActual(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.esFormatoConDriveSync) {
      this.guardarInformacionDriveSync();
      return;
    }
    if (this.plantillaSlug === 'dg-f-01') {
      this.guardarInformacionDgF01();
      return;
    }
    if (this.plantillaSlug === 'dg-f-02' || this.plantillaSlug === 'sgc-po-01'
      || this.plantillaSlug === 'dg-f-08' || this.plantillaSlug === 'dg-f-03') {
      this.guardarInformacionDocumentoWord();
    }
  }

  @HostListener('window:beforeunload')
  onBeforeUnloadSgc(): void {
    this.guardarAlSalirSgc();
  }

  /**
   * Esc cierra overlays (tips/combos) y, si no hay, el editor integrado / visor PDF.
   * Nota: si el foco está dentro del iframe de Drive, el teclado no llega a la app.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscapeCerrarOverlaysSgc(event: KeyboardEvent): void {
    if (Swal.isVisible()) {
      return;
    }

    if (this.dgF04AyudaSeccion) {
      event.preventDefault();
      this.cerrarAyudaDgF04();
      return;
    }

    if (this.sgcF02VisorDoc) {
      event.preventDefault();
      this.cerrarVisorDocumentoFisicoSgcF02();
      return;
    }

    if (this.sgcF06TipAbierto) {
      event.preventDefault();
      this.cerrarTipSgcF06();
      return;
    }
    if (this.sgcF29TipAbierto) {
      event.preventDefault();
      this.cerrarTipSgcF29();
      return;
    }
    if (this.athF08CursoComboAbierto !== null || this.athF08ColabComboAbierto !== null) {
      event.preventDefault();
      this.cerrarComboCursoAthF08(true);
      this.cerrarComboColabAthF08(true);
      return;
    }
    if (this.athF11NombreComboAbierto || this.athF11EvaluadorComboAbierto) {
      event.preventDefault();
      this.cerrarCombosAthF11();
      return;
    }
    if (this.sgcF16AsistComboAbierto !== null) {
      event.preventDefault();
      this.cerrarComboAsistSgcF16();
      return;
    }
    if (this.sgcF04ComboCampo) {
      event.preventDefault();
      this.cerrarComboSgcF04(true);
      return;
    }
    if (this.sgcF10ComboAbierto || this.sgcF10ClasifAbierto !== null) {
      event.preventDefault();
      this.cerrarComboSgcF10();
      this.cerrarClasifSgcF10();
      return;
    }
    if (this.mostrarSgcF10HallazgoEditor) {
      event.preventDefault();
      this.cerrarEditorHallazgoSgcF10(false);
      return;
    }
    if (this.sgcF10HallazgoEditandoIdx !== null) {
      event.preventDefault();
      this.cerrarEdicionHallazgoSgcF10();
      return;
    }
    if (this.dgF07PanelBusquedaAbierto) {
      event.preventDefault();
      this.dgF07PanelBusquedaAbierto = false;
      return;
    }

    if (this.editorDriveSyncAbierto) {
      event.preventDefault();
      this.toggleEditorDriveSync();
      return;
    }
    if (this.mostrarDgF02PdfViewer) {
      event.preventDefault();
      this.toggleDgF02PdfViewer();
      return;
    }
    if (this.mostrarDgF01PdfViewer) {
      event.preventDefault();
      this.toggleDgF01PdfViewer();
      return;
    }
    if (this.mostrarDgF08PdfViewer) {
      event.preventDefault();
      this.toggleDgF08PdfViewer();
      return;
    }
    if (this.mostrarDgF03PdfViewer) {
      event.preventDefault();
      this.toggleDgF03PdfViewer();
    }
  }

  @HostListener('document:pointerdown')
  @HostListener('document:keydown')
  @HostListener('document:input')
  onActividadUsuarioSgc(): void {
    this.reiniciarTemporizadorInactividadSgc();
  }

  private reiniciarTemporizadorInactividadSgc(): void {
    this.detenerTemporizadorInactividadSgc();
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    this.inactivitySaveTimer = window.setTimeout(() => {
      this.inactivitySaveTimer = null;
      // No auto-guardar mientras el editor integrado está abierto (actividad en iframe no se detecta).
      if (this.editorDriveSyncAbierto) {
        this.reiniciarTemporizadorInactividadSgc();
        return;
      }
      if (!this.hayCambiosPendientesSgc || this.driveSyncGuardando
        || this.dgF01Guardando || this.dgF02Guardando || this.sgcPo01Guardando
        || this.dgF08Guardando || this.dgF03Guardando) {
        this.reiniciarTemporizadorInactividadSgc();
        return;
      }
      this.guardarInformacionActual();
      this.reiniciarTemporizadorInactividadSgc();
    }, this.inactivitySaveMs);
  }

  private detenerTemporizadorInactividadSgc(): void {
    if (this.inactivitySaveTimer !== null) {
      window.clearTimeout(this.inactivitySaveTimer);
      this.inactivitySaveTimer = null;
    }
  }

  /**
   * Guarda al salir/recargar sin cancelar la petición con destroy$.
   * Misma semántica que «Guardar información».
   */
  private guardarAlSalirSgc(): void {
    if (!this.puedeGestionarPlantillasSgc || !this.hayCambiosPendientesSgc) {
      return;
    }
    const req$ = this.obtenerRequestGuardadoActualSgc();
    if (!req$) {
      return;
    }
    req$.subscribe({ next: () => {}, error: () => {} });
  }

  /** Siempre empuja formulario → Excel/BD (nunca pull desde Drive). */
  private obtenerRequestGuardadoActualSgc(): Observable<any> | null {
    const slug = this.plantillaSlug;
    if (slug === 'dg-f-04') {
      return this.backendService.guardarDgF04Formato(this.dgF04Form, false);
    }
    if (slug === 'dg-f-05') {
      return this.backendService.guardarDgF05Formato(this.dgF05Form, false);
    }
    if (slug === 'dg-f-07') {
      return this.backendService.guardarDgF07Formato({ procesos: this.dgF07Forms }, false);
    }
    if (slug === 'sgc-f-06') {
      return this.backendService.guardarSgcF06Formato(this.obtenerDatosSgcF06ParaGuardar(), false);
    }
    if (slug === 'sgc-f-07') {
      return this.backendService.guardarSgcF07Formato(this.sgcF07Form, false);
    }
    if (slug === 'sgc-f-08') {
      return this.backendService.guardarSgcF08Formato(this.sgcF08Form, false);
    }
    if (slug === 'sgc-f-10') {
      return this.backendService.guardarSgcF10Formato(this.sgcF10Form, false);
    }
    if (slug === 'sgc-f-14') {
      return this.backendService.guardarSgcF14Formato(this.sgcF14Form, false);
    }
    if (slug === 'sgc-f-25') {
      if (!this.sgcF25Listo || this.sgcF25Cargando) {
        return null;
      }
      return this.backendService.guardarSgcF25Formato(this.sgcF25Form, false);
    }
    if (slug === 'sgc-f-16') {
      return this.backendService.guardarSgcF16Formato(this.sgcF16Form, false);
    }
    if (slug === 'sgc-f-29') {
      return this.backendService.guardarSgcF29Formato(this.sgcF29Form, false);
    }
    if (slug === 'sgc-f-28') {
      return this.backendService.guardarSgcF28Formato(this.sgcF28Form, false);
    }
    if (slug === 'sp-f-02') {
      return this.backendService.guardarSpF02Formato(this.spF02Form, false);
    }
    if (slug === 'ath-f-02') {
      return this.backendService.guardarAthF02Formato(
        { ...this.athF02Form, perfilActivoId: this.athF02PerfilActivo?.id || this.athF02Form.perfilActivoId },
        false
      );
    }
    if (slug === 'ath-f-09') {
      return this.backendService.guardarAthF09Formato(
        { ...this.athF09Form, cotizacionActivaId: this.athF09CotizacionActiva?.id || this.athF09Form.cotizacionActivaId },
        false
      );
    }
    if (slug === 'ath-f-11') {
      return this.backendService.guardarAthF11Formato(
        { ...this.athF11Form, evaluacionActivaId: this.athF11EvaluacionActiva?.id || this.athF11Form.evaluacionActivaId },
        false
      );
    }
    if (slug === 'sgc-f-05') {
      return this.backendService.guardarSgcF05Formato(this.sgcF05Form, false);
    }
    if (slug === 'ath-f-08') {
      return this.backendService.guardarAthF08Formato(this.athF08Form, false);
    }
    if (slug === 'sgc-f-18') {
      return this.backendService.guardarSgcF18Formato(this.sgcF18Form, false);
    }
    if (slug === 'sgc-f-11') {
      return this.backendService.guardarSgcF11Formato(this.sgcF11Form, false);
    }
    if (slug === 'sgc-f-12') {
      return this.backendService.guardarSgcF12Formato(this.sgcF12Form, false);
    }
    if (slug === 'sgc-f-01') {
      if (!this.sgcF01Listo || this.sgcF01Cargando) {
        return null;
      }
      return this.backendService.guardarSgcF01Formato(this.sgcF01Form, false);
    }
    if (slug === 'sgc-f-02') {
      return this.backendService.guardarSgcF02Formato(this.sgcF02Form, false);
    }
    if (slug === 'sgc-f-04') {
      return this.backendService.guardarSgcF04Formato(this.sgcF04Form, false);
    }
    if (slug === 'sgc-f-22') {
      return this.backendService.guardarSgcF22Formato(this.sgcF22Form, false);
    }
    if (slug === 'dg-f-01') {
      return this.backendService.guardarDgF01Formato(this.dgF01Form);
    }
    if (slug === 'dg-f-02') {
      return this.backendService.guardarDgF02Formato(this.dgF02Form);
    }
    if (slug === 'sgc-po-01') {
      return this.backendService.guardarSgcPo01Formato(this.sgcPo01Form);
    }
    if (slug === 'dg-f-08') {
      return this.backendService.guardarDgF08Formato(this.dgF08Form);
    }
    if (slug === 'dg-f-03') {
      return this.backendService.guardarDgF03Formato(this.dgF03Form);
    }
    return null;
  }

  guardarInformacionDriveSync(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    // El sistema es la fuente de verdad: siempre empuja formulario → Excel (nunca pull).
    if (this.plantillaSlug === 'dg-f-04') {
      this.persistirDgF04();
      return;
    }
    if (this.plantillaSlug === 'dg-f-05') {
      this.persistirDgF05();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-06') {
      this.persistirSgcF06();
      return;
    }
    if (this.plantillaSlug === 'dg-f-07') {
      this.persistirDgF07();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-07') {
      this.persistirSgcF07();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-08') {
      this.persistirSgcF08();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-09') {
      // Maqueta en pantalla + editor Drive; persistencia de captura pendiente.
      return;
    }
    if (this.plantillaSlug === 'dg-f-06') {
      // Archivero anual + editor Drive; persistencia de captura pendiente.
      return;
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      this.persistirSgcF10();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-14') {
      this.persistirSgcF14();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-25') {
      this.persistirSgcF25();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-16') {
      this.persistirSgcF16();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-29') {
      this.persistirSgcF29();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-28') {
      this.persistirSgcF28();
      return;
    }
    if (this.plantillaSlug === 'sp-f-02') {
      this.persistirSpF02();
      return;
    }
    if (this.plantillaSlug === 'ath-f-02') {
      this.persistirAthF02();
      return;
    }
    if (this.plantillaSlug === 'ath-f-09') {
      this.persistirAthF09();
      return;
    }
    if (this.plantillaSlug === 'ath-f-11') {
      this.persistirAthF11();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-05') {
      // Solo lectura en pantalla: la bitácora se sincroniza desde SGC-F-04 / Actualizar plantilla.
      return;
    }
    if (this.plantillaSlug === 'ath-f-08') {
      this.persistirAthF08();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-18') {
      this.persistirSgcF18();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-11') {
      this.persistirSgcF11();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-12') {
      this.persistirSgcF12();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-01') {
      this.persistirSgcF01();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-02') {
      this.persistirSgcF02();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-04') {
      this.persistirSgcF04();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-22') {
      this.persistirSgcF22();
    }
  }

  get dgF04IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-04') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Los cambios de formato o de datos generan hojas de respaldo sin borrar versiones anteriores.';
  }

  get dgF05IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-05') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Los cambios de formato o de datos generan hojas de respaldo sin borrar versiones anteriores.';
  }

  get dgF07IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-07') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. También se guarda tras 30 min sin actividad o al salir de la pantalla. El Excel es representación visual e historial; el formulario del sistema es la fuente de verdad.';
  }

  get dgF01IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-01') {
      return '';
    }
    return 'Muestra el PDF firmado más reciente del mapa de procesos. Actualízalo en «Versión firmada»; las versiones anteriores se conservan en Drive.';
  }

  get dgF02IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-02') {
      return '';
    }
    return 'Edita el alcance y los requisitos no aplicables directamente en el sistema. Usa «Guardar información» para conservar cambios (también tras 30 min sin actividad o al salir). Al final puedes subir la versión firmada en PDF.';
  }

  get sgcPo01IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-po-01') {
      return '';
    }
    return 'Edita la política de calidad directamente en el sistema. Usa «Guardar información» para conservar cambios (también tras 30 min sin actividad o al salir). Al final puedes subir la versión firmada en PDF.';
  }

  get dgF08IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-08') {
      return '';
    }
    return 'Edita misión, visión, valores y código de trabajo en equipo. Usa «Guardar información» para conservar cambios (también tras 30 min sin actividad o al salir). Al final puedes subir la versión firmada en PDF.';
  }

  get sgcF18IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-18') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Los cambios de formato o de datos generan hojas de respaldo sin borrar versiones anteriores.';
  }

  get sgcF11IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-11') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. El RPN se calcula al editar ocurrencia, severidad y detección.';
  }

  get sgcF12IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-12') {
      return '';
    }
    return 'Notificación de cambios al SGC. Usa «Guardar información» para conservar el plan de trabajo y el historial en Excel.';
  }

  get sgcF01IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-01') {
      return '';
    }
    return 'Tronco del SGC: la versión vigente y la fecha de revisión se rescatan de los formatos ya cargados en el sistema. Usa «Actualizar versiones» para refrescar; «Guardar información» conserva cambios al listado.';
  }

  get sgcF02IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-02') {
      return '';
    }
    return 'Una tarjeta por solicitante (todos sus documentos van juntos). Al guardar se persiste en BD y se crea/actualiza una hoja Excel con su nombre. Abajo puedes subir y consultar la documentación física (PDF/JPG).';
  }

  get sgcF02SolicitudesVista(): SgcF02Solicitud[] {
    const q = String(this.sgcF02Busqueda || '').trim().toLowerCase();
    const lista = Array.isArray(this.sgcF02Form.solicitudes) ? this.sgcF02Form.solicitudes : [];
    if (!q) {
      return lista;
    }
    return lista.filter((s) => {
      const blob = [
        s.nombreSolicitante,
        s.puestoSolicitante,
        s.areaDepartamento,
        s.fechaSolicitud
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }

  inicialesSgcF02(nombre: string): string {
    const partes = String(nombre || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!partes.length) {
      return '?';
    }
    if (partes.length === 1) {
      return partes[0].slice(0, 2).toUpperCase();
    }
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  contarDocsSgcF02(sol: SgcF02Solicitud): number {
    return (sol?.filas || []).filter((f) =>
      !!(f.nombreDocumento || f.codigo || f.versionActual || f.tipoDocumento || f.tipoSolicitud || f.motivo)
    ).length;
  }

  formatearTamanoSgcF02(bytes: number | null | undefined): string {
    const n = Number(bytes || 0);
    if (!n || n < 0) {
      return '—';
    }
    if (n < 1024) {
      return `${n} B`;
    }
    if (n < 1024 * 1024) {
      return `${(n / 1024).toFixed(1)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  get sgcF04IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-04') {
      return '';
    }
    return 'Archivero de reportes de no conformidad (Rev 02). Crea, busca y edita cada NC con folio NC-DDMMAA-NN. Al cerrar, sube la versión firmada en PDF. Usa «Guardar información» para conservar el archivero y el historial en Excel.';
  }

  get sgcF22IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-22') {
      return '';
    }
    return 'Archivero de reportes de daño o pérdida de propiedad del cliente o proveedor. Crea, busca y edita cada reporte con folio DP-DDMMAA-NN. Al cerrar, sube la versión firmada en PDF. Usa «Guardar información» para conservar el archivero y el historial en Excel.';
  }

  get sgcF06IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-06') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Los cambios de formato o de datos generan hojas de respaldo sin borrar versiones anteriores.';
  }

  get sgcF07IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-07') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Los cambios de formato o de datos generan hojas de respaldo sin borrar versiones anteriores.';
  }

  get sgcF08IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-08') {
      return '';
    }
    return 'Usa «Guardar información» para conservar cambios y el historial en Excel. Al guardar se crea una hoja SGCF08-MMAA con la versión nueva; la hoja anterior queda como respaldo.';
  }

  get sgcF09IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-09') {
      return '';
    }
    return 'Lista de verificación de auditoría (ISO 9001 · 9.2). Marca C, NC u O por requisito y describe el hallazgo en el cuadro de observaciones.';
  }

  get sgcF09Resumen(): { total: number; c: number; nc: number; o: number; pendientes: number } {
    const requisitos = this.sgcF09Form?.requisitos || [];
    let c = 0;
    let nc = 0;
    let o = 0;
    for (const r of requisitos) {
      if (r.marca === 'C') {
        c += 1;
      } else if (r.marca === 'NC') {
        nc += 1;
      } else if (r.marca === 'O') {
        o += 1;
      }
    }
    const total = requisitos.length;
    return { total, c, nc, o, pendientes: total - c - nc - o };
  }

  get sgcF10IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-10') {
      return '';
    }
    return 'Completa el informe con datos de la auditoría, hallazgos y conclusiones. «Guardar información» conserva el borrador; «Guardar Histórico» cierra el informe como registro inmutable (BD + Word) y abre uno nuevo.';
  }

  get sgcF15IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-15') {
      return '';
    }
    return 'Análisis y evaluación de indicadores del SGC. Combina la vista de tablero con gráficas de tendencia trimestral.';
  }

  get sgcF16IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-16') {
      return '';
    }
    return 'Captura la visita con fecha, hora, lugar y asunto. Registra asistentes, agenda y compromisos; usa «Guardar información» para conservarlos en el sistema y en Drive.';
  }

  get dgF06IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-06') {
      return '';
    }
    return 'Archivero anual del cuadro de mando (ISO 9001 · 6.2). Cada año guarda dos hojas: Objetivos de calidad e Indicadores de calidad. Abre un documento para capturar resultados mes a mes.';
  }

  get dgF03IntroLead(): string {
    if (this.plantillaSlug !== 'dg-f-03') {
      return '';
    }
    return 'Edita los objetivos de calidad directamente en el sistema. Usa «Guardar información» para conservar cambios (también tras 30 min sin actividad o al salir). Al final puedes subir la versión firmada en PDF.';
  }

  get metodologiaAmefIntroLead(): string {
    if (this.plantillaSlug !== 'metodologia-amef') {
      return '';
    }
    return 'Consulta y edita la metodología AMEF con el diseño original del formato. Todo ocurre aquí, en Biznaga — sin salir del sistema.';
  }

  get introLeadFormato(): string {
    if (this.plantillaSlug === 'dg-f-01') {
      return this.dgF01IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-02') {
      return this.dgF02IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-04') {
      return this.dgF04IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-05') {
      return this.dgF05IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-07') {
      return this.dgF07IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-18') {
      return this.sgcF18IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-11') {
      return this.sgcF11IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-12') {
      return this.sgcF12IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-01') {
      return this.sgcF01IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-02') {
      return this.sgcF02IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-04') {
      return this.sgcF04IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-22') {
      return this.sgcF22IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-06') {
      return this.sgcF06IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-07') {
      return this.sgcF07IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-08') {
      return this.sgcF08IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-14') {
      return this.sgcF14IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-25') {
      return this.sgcF25IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-29') {
      return this.sgcF29IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-28') {
      return this.sgcF28IntroLead;
    }
    if (this.plantillaSlug === 'sp-f-02') {
      return this.spF02IntroLead;
    }
    if (this.plantillaSlug === 'ath-f-02') {
      return this.athF02IntroLead;
    }
    if (this.plantillaSlug === 'ath-f-09') {
      return this.athF09IntroLead;
    }
    if (this.plantillaSlug === 'ath-f-11') {
      return this.athF11IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-05') {
      return this.sgcF05IntroLead;
    }
    if (this.plantillaSlug === 'ath-f-08') {
      return this.athF08IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-09') {
      return this.sgcF09IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      return this.sgcF10IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-15') {
      return this.sgcF15IntroLead;
    }
    if (this.plantillaSlug === 'sgc-f-16') {
      return this.sgcF16IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-06') {
      return this.dgF06IntroLead;
    }
    if (this.plantillaSlug === 'sgc-po-01') {
      return this.sgcPo01IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-08') {
      return this.dgF08IntroLead;
    }
    if (this.plantillaSlug === 'dg-f-03') {
      return this.dgF03IntroLead;
    }
    if (this.plantillaSlug === 'metodologia-amef') {
      return this.metodologiaAmefIntroLead;
    }
    if (this.plantilla?.previewMode === 'form') {
      return 'Maqueta interactiva alineada al formato. Los campos son editables; la sincronización con Google Drive será un siguiente paso.';
    }
    return 'Vista del documento original alojado en Google Drive, integrada en el sistema.';
  }

  formatearUltimaSync(valor: string | null): string {
    if (!valor) {
      return '';
    }
    const texto = valor.trim();
    const formatearSoloFecha = (d: Date): string => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };
    const matchConHora = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/);
    if (matchConHora) {
      const [, dd, mm, yyyy] = matchConHora;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return formatearSoloFecha(d);
    }
    const matchIso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matchIso) {
      const [, yyyy, mm, dd] = matchIso;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return formatearSoloFecha(d);
    }
    const d = new Date(texto);
    if (Number.isNaN(d.getTime())) {
      return texto.split(' ')[0] || texto;
    }
    return formatearSoloFecha(d);
  }

  formatearFechaDgF02(fecha: string | null | undefined): string {
    if (!fecha) {
      return '—';
    }
    const texto = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      const [yyyy, mm, dd] = texto.split('-');
      return `${Number(dd)}/${Number(mm)}/${yyyy}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
      return texto;
    }
    const d = new Date(texto.includes('T') ? texto : `${texto}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return texto;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${Number(dd)}/${Number(mm)}/${yyyy}`;
  }

  hrefPlantillaDrive(p: PlantillaFormato | null): string {
    if (this.plantillaSlug === 'metodologia-amef' && this.metodologiaAmefEditorUrl) {
      return this.metodologiaAmefEditorUrl;
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      if (this.sgcF10EditorUrl) {
        return this.sgcF10EditorUrl;
      }
      if (p?.driveFileId) {
        return `https://docs.google.com/document/d/${p.driveFileId}/edit?usp=sharing`;
      }
    }
    if (this.plantillaSlug === 'sgc-f-09') {
      if (this.sgcF09EditorUrl) {
        return this.sgcF09EditorUrl;
      }
      if (p?.driveFileId || this.sgcF09DriveFileId) {
        const id = p?.driveFileId || this.sgcF09DriveFileId;
        return `https://docs.google.com/document/d/${id}/edit?usp=sharing`;
      }
    }
    if (!p?.driveFileId) {
      return this.config?.carpetaDrive ?? '#';
    }
    return `https://drive.google.com/file/d/${p.driveFileId}/view?usp=drive_link`;
  }

  trackByExpIdx(i: number): number {
    return i;
  }

  trackByRelIdx(i: number): number {
    return i;
  }

  trackByIdx(i: number): number {
    return i;
  }

  /** Filas del textarea según saltos de línea (vista compacta DG-F-05). */
  filasTexto(texto: string): number {
    if (!texto?.trim()) {
      return 1;
    }
    return Math.max(1, texto.split('\n').length);
  }

  /** Filas estimando soft-wrap para evitar scroll vertical en celdas. */
  filasTextoAjustadas(texto: string, charsPorLinea = 28, max = 5): number {
    if (!texto?.trim()) {
      return 1;
    }
    let total = 0;
    for (const linea of String(texto).split('\n')) {
      total += Math.max(1, Math.ceil(Math.max(linea.length, 1) / charsPorLinea));
    }
    return Math.min(max, Math.max(1, total));
  }

  /** Textareas compactos del encabezado SGC-F-12. */
  filasTextoSgcF12(texto: string | null | undefined, minimo = 2): number {
    return Math.max(minimo, this.filasTexto(String(texto || '')));
  }

  /** Normaliza fechas libres al formato ISO requerido por input type="date". */
  normalizarFechaIsoSgcF12(valor: string | null | undefined): string {
    const texto = String(valor || '').trim();
    if (!texto) {
      return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      return texto;
    }
    const match = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      let year = match[3];
      if (year.length === 2) {
        year = `20${year}`;
      }
      return `${year}-${month}-${day}`;
    }
    return texto;
  }

  private normalizarFormularioSgcF12<T extends {
    fecha?: string;
    fechaRevision?: string;
    planTrabajo?: string;
    filas?: SgcF12Fila[];
  }>(form: T): T {
    const filas = Array.isArray(form.filas)
      ? form.filas.map((fila) => ({
          ...fila,
          fechaCompromiso: this.normalizarFechaIsoSgcF12(fila.fechaCompromiso)
        }))
      : form.filas;
    return {
      ...form,
      fecha: this.normalizarFechaIsoSgcF12(form.fecha),
      fechaRevision: this.normalizarFechaIsoSgcF12(form.fechaRevision),
      filas
    };
  }

  /** Altura uniforme de textareas en la misma fila. */
  filasTextoFila(fila: DgF05Fila): number {
    return Math.max(
      1,
      this.filasTexto(fila.parteInteresada),
      this.filasTexto(fila.necesidadesParte),
      this.filasTexto(fila.necesidadesOrg),
      this.filasTexto(fila.razon),
      this.filasTexto(fila.seguimiento)
    );
  }

  /**
   * Ajusta la altura de un textarea a su contenido real (incluyendo el texto
   * que se parte por ajuste de línea), de modo que la información nunca se corte.
   */
  autosizeTextarea(target: EventTarget | HTMLTextAreaElement | null): void {
    const el = target as HTMLTextAreaElement | null;
    if (!el || el.tagName !== 'TEXTAREA') {
      return;
    }
    // Quita límites previos que en algunos dispositivos dejan el texto “bloqueado”.
    el.style.maxHeight = 'none';
    el.style.overflowY = 'hidden';
    el.style.height = 'auto';
    const alto = Math.max(el.scrollHeight, el.clientHeight || 0);
    el.style.height = `${alto}px`;
    // Si por algún motivo no alcanzó, deja scroll como red de seguridad.
    el.style.overflowY = el.scrollHeight > el.clientHeight + 2 ? 'auto' : 'hidden';
  }

  /** Recalcula la altura de todos los textareas de la tabla DG-F-05. */
  private autosizeDgF05Textareas(): void {
    window.setTimeout(() => {
      const nodos = this.host.nativeElement.querySelectorAll<HTMLTextAreaElement>(
        '.dg-f05-table textarea.dg-f05-field--textarea'
      );
      nodos.forEach((el) => this.autosizeTextarea(el));
    });
  }

  claseSemaforo(estado: 'ok' | 'warning' | 'risk'): string {
    if (estado === 'ok') {
      return 'sgc-status-badge--ok';
    }
    if (estado === 'warning') {
      return 'sgc-status-badge--warning';
    }
    return 'sgc-status-badge--risk';
  }

  calificacionClass(valor: number | null | undefined): string {
    const n = typeof valor === 'number' ? valor : Number(valor ?? NaN);
    if (Number.isFinite(n)) {
      if (n >= 9) {
        return 'sgc-f06-score--alto';
      }
      if (n >= 8) {
        return 'sgc-f06-score--medio';
      }
      return 'sgc-f06-score--bajo';
    }
    return 'sgc-f06-score--neutral';
  }

  cursoAuditoresClass(valor: string): string {
    const estado = String(valor || '').trim().toLowerCase();
    if (estado === 'aprobado') {
      return 'sgc-f06-curso--aprobado';
    }
    if (estado === 'no aprobado') {
      return 'sgc-f06-curso--reprobado';
    }
    return 'sgc-f06-curso--neutral';
  }

  descripcionObjetividadSgcF06(valor: string | number | null | undefined): string {
    const numero = Number(valor);
    const opcion = SGC_F06_OBJETIVIDAD_OPCIONES.find((item) => item.valor === numero);
    return opcion?.descripcion || '';
  }

  descripcionDesempenoSgcF06(valor: string | number | null | undefined): string {
    const numero = Number(valor);
    const opcion = SGC_F06_DESEMPENO_OPCIONES.find((item) => item.valor === numero);
    return opcion?.descripcion || '';
  }

  onSgcF06CalificacionChange(auditor: SgcF06Auditor): void {
    this.recalcularAuditorSgcF06(auditor);
    this.onSgcF06Editado();
  }

  nivelAuditorClass(nivel: string): string {
    const estado = this.normalizarEstadoSgcF06(nivel);
    if (estado === 'acreditado') {
      return 'sgc-chip--success';
    }
    if (estado === 'entrenamiento' || estado === 'condicional') {
      return 'sgc-chip--warning';
    }
    return 'sgc-chip--muted';
  }

  private normalizarEstadoSgcF06(valor: string): string {
    return String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z]/g, '');
  }

  semaforoPorRiesgo(riesgo: 'Alto' | 'Medio' | 'Bajo'): 'ok' | 'warning' | 'risk' {
    if (riesgo === 'Alto') {
      return 'risk';
    }
    if (riesgo === 'Medio') {
      return 'warning';
    }
    return 'ok';
  }

  agregarAuditoriaSgcF07(): void {
    this.sgcF07Form.auditorias.push(this.crearAuditoriaVaciaSgcF07(this.sgcF07Form.auditorias.length + 1));
    this.sgcF07AuditoriaSeleccionadaIndex = this.sgcF07Form.auditorias.length - 1;
    this.marcarCambiosSgcF07();
  }

  seleccionarAuditoriaSgcF07(index: number): void {
    if (index < 0 || index >= this.sgcF07Form.auditorias.length) {
      return;
    }
    this.sgcF07AuditoriaSeleccionadaIndex = index;
  }

  get sgcF07AuditoriaActiva(): SgcF07AuditoriaItem | null {
    const auditorias = this.sgcF07Form.auditorias;
    if (!auditorias.length) {
      return null;
    }
    return auditorias[this.sgcF07AuditoriaSeleccionadaIndex] ?? auditorias[0];
  }

  get sgcF07AuditoriasFiltradas(): Array<{ auditoria: SgcF07AuditoriaItem; index: number }> {
    const termino = (this.sgcF07Busqueda || '').trim().toLowerCase();
    const items = this.sgcF07Form.auditorias.map((auditoria, index) => ({ auditoria, index }));
    if (!termino) {
      return items;
    }
    return items.filter(({ auditoria, index }) => {
      const numero = String(index + 1);
      const fecha = String(auditoria.fecha || '').toLowerCase();
      return numero.includes(termino) || fecha.includes(termino);
    });
  }

  limpiarBusquedaSgcF07(): void {
    this.sgcF07Busqueda = '';
  }

  trackBySgcF07AuditoriaFiltro(_index: number, item: { auditoria: SgcF07AuditoriaItem; index: number }): number {
    return item.index;
  }

  sgcF07SemanasMarcadas(auditoria: SgcF07AuditoriaItem): number {
    let total = 0;
    this.sgcF07Meses.forEach((mes) => {
      const semanas = auditoria?.calendario?.[mes.key as keyof SgcF07Calendario];
      if (Array.isArray(semanas)) {
        total += semanas.filter((valor) => valor === 'X').length;
      }
    });
    return total;
  }

  toggleSgcF07Calendario(auditoria: SgcF07AuditoriaItem, mesKey: string, semanaIndex: number): void {
    const calendario = auditoria.calendario || this.crearCalendarioVacioSgcF07();
    auditoria.calendario = calendario;
    const semanas = calendario[mesKey as keyof SgcF07Calendario];
    if (!Array.isArray(semanas)) {
      return;
    }
    semanas[semanaIndex] = semanas[semanaIndex] === 'X' ? '' : 'X';
    this.marcarCambiosSgcF07();
  }

  sgcF07SemanaMarcada(auditoria: SgcF07AuditoriaItem, mesKey: string, semanaIndex: number): boolean {
    const semanas = auditoria?.calendario?.[mesKey as keyof SgcF07Calendario];
    return Array.isArray(semanas) && semanas[semanaIndex] === 'X';
  }

  private crearCalendarioVacioSgcF07(): SgcF07Calendario {
    return {
      enero: ['', '', '', ''],
      febrero: ['', '', '', ''],
      marzo: ['', '', '', ''],
      abril: ['', '', '', ''],
      mayo: ['', '', '', ''],
      junio: ['', '', '', ''],
      julio: ['', '', '', ''],
      agosto: ['', '', '', ''],
      septiembre: ['', '', '', ''],
      octubre: ['', '', '', ''],
      noviembre: ['', '', '', ''],
      diciembre: ['', '', '', '']
    };
  }

  private crearAuditoriaVaciaSgcF07(numero: number): SgcF07AuditoriaItem {
    return {
      noAudi: String(numero),
      tipoAuditoria: '',
      alcance: '',
      objetivo: '',
      criterios: '',
      equipoAuditor: '',
      auditorLider: '',
      metodoAuditoria: '',
      fecha: '',
      calendario: this.crearCalendarioVacioSgcF07()
    };
  }

  private normalizarAuditoriasSgcF07(lista: any): SgcF07AuditoriaItem[] {
    if (!Array.isArray(lista) || !lista.length) {
      return [this.crearAuditoriaVaciaSgcF07(1)];
    }
    return lista.map((item, index) => {
      const calendario = this.crearCalendarioVacioSgcF07();
      if (item?.calendario && typeof item.calendario === 'object') {
        this.sgcF07Meses.forEach((mes) => {
          const origen = item.calendario[mes.key];
          if (Array.isArray(origen)) {
            calendario[mes.key as keyof SgcF07Calendario] = origen
              .slice(0, 4)
              .map((valor: unknown) => (String(valor || '').trim().toUpperCase() === 'X' ? 'X' : ''));
          }
        });
      } else {
        if (item?.semana1) calendario.enero[0] = 'X';
        if (item?.semana2) calendario.enero[1] = 'X';
        if (item?.semana3) calendario.enero[2] = 'X';
        if (item?.semana4) calendario.enero[3] = 'X';
      }
      return {
        noAudi: String(item?.noAudi || index + 1),
        tipoAuditoria: String(item?.tipoAuditoria || ''),
        alcance: String(item?.alcance || ''),
        objetivo: String(item?.objetivo || ''),
        criterios: String(item?.criterios || ''),
        equipoAuditor: String(item?.equipoAuditor || ''),
        auditorLider: String(item?.auditorLider || ''),
        metodoAuditoria: String(item?.metodoAuditoria || ''),
        fecha: String(item?.fecha || ''),
        calendario
      };
    });
  }

  private normalizarFooterSgcF07(footer: any): SgcF07FooterData {
    const actual = this.sgcF07Form?.footer;
    return {
      comentariosTitulo: String(
        footer?.comentariosTitulo
        ?? actual?.comentariosTitulo
        ?? 'Comentarios:'
      ).trim() || 'Comentarios:',
      comentariosDetalle: String(
        footer?.comentariosDetalle
        ?? actual?.comentariosDetalle
        ?? ''
      ).trim(),
      notaPrograma: String(
        footer?.notaPrograma
        ?? actual?.notaPrograma
        ?? ''
      ).trim(),
      firmaEjecutivo: String(
        footer?.firmaEjecutivo
        ?? actual?.firmaEjecutivo
        ?? 'Ejecutivo JR SGVC'
      ).trim() || 'Ejecutivo JR SGVC',
      firmaDireccion: String(
        footer?.firmaDireccion
        ?? actual?.firmaDireccion
        ?? 'Dirección General'
      ).trim() || 'Dirección General'
    };
  }

  eliminarAuditoriaSgcF07(index: number): void {
    if (this.sgcF07Form.auditorias.length > 1) {
      this.sgcF07Form.auditorias.splice(index, 1);
      this.sgcF07Form.auditorias.forEach((a, i) => {
        a.noAudi = String(i + 1);
      });
      this.asegurarAuditoriaActivaSgcF07();
      this.marcarCambiosSgcF07();
    }
  }

  onSgcF07Editado(): void {
    if (!this.sgcF07Listo || this.sgcF07IgnorarAutoSave) {
      return;
    }
    this.sgcF07CambiosPendientes = true;
  }

  toggleSgcF07Editor(): void {
    if (!this.sgcF07DriveFileId) {
      return;
    }

    const abrir = !this.mostrarSgcF07Editor;
    this.mostrarSgcF07Editor = abrir;

    if (abrir) {
      this.sgcF07EditorIframeListo = false;
      this.sgcF07EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF07(this.resolverUrlEditorDrive(this.sgcF07EditorUrl, this.sgcF07DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF07IframeLoad(): void {
    if (this.sgcF07EditorIframeListo) {
      return;
    }
    this.sgcF07EditorIframeListo = true;
    this.sgcF07EditorCargando = false;
  }

  actualizarPlantillaSgcF07(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF07ActualizandoPlantilla) {
      return;
    }

    if (this.mostrarSgcF07Editor) {
      this.mostrarSgcF07Editor = false;
      this.sgcF07EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }

    this.sgcF07ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF07()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF07ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF07(res, false, false, true);
        },
        error: () => {
          this.sgcF07ActualizandoPlantilla = false;
        }
      });
  }

  private marcarCambiosSgcF07(): void {
    this.onSgcF07Editado();
  }

  private cargarSgcF07DesdeServidor(): void {
    this.sgcF07Cargando = true;
    this.sgcF07Listo = false;
    this.backendService.cargarSgcF07Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF07(res),
        error: () => {
          this.sgcF07Cargando = false;
          this.sgcF07Listo = true;
        }
      });
  }

  private sincronizarSgcF07DesdeDrive(): void {
    this.sgcF07Guardando = true;
    this.backendService.sincronizarSgcF07DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF07Guardando = false;
          this.sgcF07CambiosPendientes = false;
          this.aplicarEstadoSgcF07(res, false, false);
        },
        error: () => {
          this.sgcF07Guardando = false;
        }
      });
  }

  private persistirSgcF07(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF07Listo || this.sgcF07Guardando) {
      return;
    }
    this.sgcF07Guardando = true;
    const editorAbierto = this.mostrarSgcF07Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF07Formato(this.sgcF07Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF07Guardando = false;
          this.sgcF07CambiosPendientes = false;
          this.aplicarEstadoSgcF07(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF07Guardando = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF07(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF07Editor && this.sgcF07EditorEmbedUrlSafe && this.sgcF07EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF07EditorUrl = null;
      this.sgcF07EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF07EditorUrl === url && this.sgcF07EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF07EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF07EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF07(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF07Cargando = false;
      }
      this.sgcF07Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF07Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF07IgnorarAutoSave = true;
      this.sgcF07Listo = false;
      const d = res.datos;
      this.sgcF07Form = {
        empresa: d.empresa ?? this.sgcF07Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.sgcF07Form.fechaElaboracion,
        auditorias: this.normalizarAuditoriasSgcF07(d.auditorias),
        footer: this.normalizarFooterSgcF07(d.footer)
      };
      this.asegurarAuditoriaActivaSgcF07();
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF07IgnorarAutoSave = true;
      this.sgcF07Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF07DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF07Editor)) {
        this.fijarEditorEmbedUrlSgcF07(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF07UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF07ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF07IgnorarAutoSave = false;
      this.sgcF07Listo = true;
      if (!bloquearFormulario) {
        this.sgcF07CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF07Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private asegurarAuditoriaActivaSgcF07(): void {
    const total = this.sgcF07Form.auditorias.length;
    if (!total) {
      this.sgcF07AuditoriaSeleccionadaIndex = 0;
      return;
    }
    if (this.sgcF07AuditoriaSeleccionadaIndex < 0 || this.sgcF07AuditoriaSeleccionadaIndex >= total) {
      this.sgcF07AuditoriaSeleccionadaIndex = total - 1;
    }
  }

  private crearSgcF08FormVacio(): SgcF08FormData {
    return {
      revision: '00',
      fechaRevision: '',
      fechaElaboracion: '',
      auditoriaNo: '',
      fechaElaboracionInforme: '',
      fechaInicio: '',
      fechaTermino: '',
      fechaEntregaInforme: '',
      empresa: '',
      ubicacion: '',
      criteriosAuditoria: '',
      alcanceAuditoria: '',
      objetivoAuditoria: '',
      auditorLider: '',
      metodoAuditoria: 'En sitio',
      equipoAuditor: '',
      numObservadores: '0',
      numInterpretes: '0',
      numGuias: '0',
      agenda: [],
      roles: []
    };
  }

  private normalizarAgendaSgcF08(items: SgcF08AgendaItem[] | undefined): SgcF08AgendaItem[] {
    if (!Array.isArray(items) || !items.length) {
      return [];
    }
    return items.map((item) => {
      const criterio = String(item?.criterio || '').trim();
      let auditado = String(item?.auditado || '').trim();
      let auditor = String(item?.auditor || '').trim();
      if (criterio && auditado === criterio) {
        auditado = '';
      }
      if (criterio && auditor === criterio) {
        auditor = '';
      }
      return {
        actividad: String(item?.actividad || '').trim(),
        fecha: String(item?.fecha || '').trim(),
        hora: String(item?.hora || '').trim(),
        areaDepto: String(item?.areaDepto || '').trim(),
        criterio,
        auditado,
        auditor
      };
    });
  }

  private normalizarSgcF08Form(datos: Partial<SgcF08FormData> | null | undefined): SgcF08FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    return {
      revision: String(base.revision || '00').trim().padStart(2, '0'),
      fechaRevision: String(base.fechaRevision || '2025-01-14').trim(),
      fechaElaboracion: String(base.fechaElaboracion || base.fechaRevision || '2025-01-14').trim(),
      auditoriaNo: String(base.auditoriaNo || '').trim(),
      fechaElaboracionInforme: String(base.fechaElaboracionInforme || '').trim(),
      fechaInicio: String(base.fechaInicio || '').trim(),
      fechaTermino: String(base.fechaTermino || '').trim(),
      fechaEntregaInforme: String(base.fechaEntregaInforme || '').trim(),
      empresa: String(base.empresa || '').trim(),
      ubicacion: String(base.ubicacion || '').trim(),
      criteriosAuditoria: String(base.criteriosAuditoria || '').trim(),
      alcanceAuditoria: String(base.alcanceAuditoria || '').trim(),
      objetivoAuditoria: String(base.objetivoAuditoria || '').trim(),
      auditorLider: String(base.auditorLider || '').trim(),
      metodoAuditoria: String(base.metodoAuditoria || 'En sitio').trim(),
      equipoAuditor: String(base.equipoAuditor || '').trim(),
      numObservadores: String(base.numObservadores ?? '0').trim(),
      numInterpretes: String(base.numInterpretes ?? '0').trim(),
      numGuias: String(base.numGuias ?? '0').trim(),
      agenda: this.normalizarAgendaSgcF08(base.agenda),
      roles: Array.isArray(base.roles) ? base.roles.map((r) => String(r || '').trim()).filter(Boolean) : []
    };
  }

  private cargarSgcF08DesdeServidor(): void {
    this.sgcF08Cargando = true;
    this.sgcF08Listo = false;
    this.backendService.cargarSgcF08Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF08(res),
        error: () => {
          this.sgcF08Cargando = false;
          this.sgcF08Listo = true;
        }
      });
  }

  onSgcF08Editado(): void {
    if (!this.sgcF08Listo || this.sgcF08IgnorarAutoSave) {
      return;
    }
    this.sgcF08CambiosPendientes = true;
  }

  private crearFilaAgendaSgcF08Vacia(): SgcF08AgendaItem {
    return {
      actividad: '',
      fecha: '',
      hora: '',
      areaDepto: '',
      criterio: '',
      auditado: '',
      auditor: ''
    };
  }

  agregarFilaAgendaSgcF08(): void {
    this.sgcF08Form.agenda.push(this.crearFilaAgendaSgcF08Vacia());
    this.onSgcF08Editado();
  }

  quitarFilaAgendaSgcF08(index: number): void {
    if (this.sgcF08Form.agenda.length <= 1) {
      return;
    }
    this.sgcF08Form.agenda.splice(index, 1);
    this.onSgcF08Editado();
  }

  private sincronizarSgcF08DesdeDrive(): void {
    if (this.sgcF08Guardando) {
      return;
    }
    this.sgcF08Guardando = true;
    this.backendService.sincronizarSgcF08DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF08Guardando = false;
          this.aplicarEstadoSgcF08(res, false, false);
        },
        error: () => {
          this.sgcF08Guardando = false;
        }
      });
  }

  private persistirSgcF08(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF08Listo || this.sgcF08Guardando) {
      return;
    }
    this.sgcF08Guardando = true;
    const editorAbierto = this.mostrarSgcF08Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF08Formato(this.sgcF08Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF08Guardando = false;
          this.aplicarEstadoSgcF08(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF08Guardando = false;
        }
      });
  }

  toggleSgcF08Editor(): void {
    if (!this.sgcF08DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF08Editor;
    this.mostrarSgcF08Editor = abrir;
    if (abrir) {
      this.sgcF08EditorIframeListo = false;
      this.sgcF08EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF08(this.resolverUrlEditorDrive(this.sgcF08EditorUrl, this.sgcF08DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF08IframeLoad(): void {
    if (this.sgcF08EditorIframeListo) {
      return;
    }
    this.sgcF08EditorIframeListo = true;
    this.sgcF08EditorCargando = false;
  }

  actualizarPlantillaSgcF08(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF08ActualizandoPlantilla) {
      return;
    }
    this.sgcF08ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF08()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF08ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF08(res, false, false, true);
        },
        error: () => {
          this.sgcF08ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF08(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF08Editor && this.sgcF08EditorEmbedUrlSafe && this.sgcF08EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF08EditorUrl = null;
      this.sgcF08EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF08EditorUrl === url && this.sgcF08EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF08EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF08EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF08(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF08Cargando = false;
      }
      this.sgcF08Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF08Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF08IgnorarAutoSave = true;
      this.sgcF08Listo = false;
      this.sgcF08Form = this.normalizarSgcF08Form(res.datos);
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF08IgnorarAutoSave = true;
      this.sgcF08Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF08DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF08Editor)) {
        this.fijarEditorEmbedUrlSgcF08(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF08UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF08ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF08IgnorarAutoSave = false;
      this.sgcF08Listo = true;
      if (!bloquearFormulario) {
        this.sgcF08CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF08Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  sgcF08LabelAgenda(item: SgcF08AgendaItem): string {
    if (item.actividad) {
      return item.actividad;
    }
    if (item.criterio && item.criterio.length > 60) {
      return item.criterio.slice(0, 60) + '…';
    }
    return item.criterio || item.fecha || `Actividad ${item.auditor || ''}`.trim();
  }

  // ===================== SGC-F-10 · Informe de auditoría =====================

  get totalHallazgosSgcF10(): number {
    return Array.isArray(this.sgcF10Form?.hallazgos) ? this.sgcF10Form.hallazgos.length : 0;
  }

  get sgcF10FirmaLiderUrl(): string | null {
    const driveId = String(this.sgcF10Form?.auditorLiderFirmaDriveId || '').trim();
    if (!driveId) {
      return null;
    }
    return `${environment.apiUrl}/firma-doctor/${encodeURIComponent(driveId)}`;
  }

  get sgcF10FirmaDgUrl(): string | null {
    const driveId = String(this.sgcF10Form?.firmaDireccionGeneralFirmaDriveId || '').trim();
    if (!driveId) {
      return null;
    }
    return `${environment.apiUrl}/firma-doctor/${encodeURIComponent(driveId)}`;
  }

  private fechaHoyDisplaySgcF10(): string {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${m}/${d.getFullYear()}`;
  }

  private crearSgcF10FormVacio(): SgcF10FormData {
    return {
      revision: '00',
      fechaRevision: '2025-01-14',
      fechaElaboracion: '2025-01-14',
      auditoriaNo: this.sgcF10AuditoriaActual,
      fechasAuditoria: this.fechaHoyDisplaySgcF10(),
      ubicaciones: '',
      empresaId: null,
      empresa: '',
      domicilio: '',
      objetivos: '',
      criterios: '',
      alcance: '',
      auditorLiderId: null,
      auditorLider: '',
      auditorLiderFirmaDriveId: '',
      auditoresIds: [],
      auditores: '',
      participantesIds: [],
      participantes: '',
      otrosParticipantesIds: [],
      otrosParticipantes: '',
      clausulaNorma: '',
      hallazgos: [this.crearHallazgoSgcF10Vacio()],
      conclusiones: '',
      firmaAuditorLider: '',
      firmaDireccionGeneralId: null,
      firmaDireccionGeneral: '',
      firmaDireccionGeneralFirmaDriveId: ''
    };
  }

  private crearHallazgoSgcF10Vacio(): SgcF10Hallazgo {
    return {
      id: this.nuevoIdHallazgoSgcF10(),
      clausula: '',
      clasificacion: '',
      descripcion: '',
      procesos: '',
      auditorId: null,
      auditor: '',
      fechaAdicion: this.fechaHoyIsoSgcF10()
    };
  }

  private nuevoIdHallazgoSgcF10(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private fechaHoyIsoSgcF10(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private normalizarClasificacionSgcF10(raw: unknown): SgcF10Clasificacion {
    const valor = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (valor === 'OP' || valor === 'OPORTUNIDAD' || valor === 'OPORTUNIDAD_DE_MEJORA') {
      return 'OP';
    }
    if (valor === 'NC_MENOR' || valor === 'NC-MENOR' || valor === 'NCMENOR') {
      return 'NC_MENOR';
    }
    if (valor === 'NC_MAYOR' || valor === 'NC-MAYOR' || valor === 'NCMAYOR') {
      return 'NC_MAYOR';
    }
    return '';
  }

  private normalizarIdsSgcF10(raw: unknown): number[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  private normalizarHallazgosSgcF10(
    items: SgcF10Hallazgo[] | undefined,
    clausulaHeredada = '',
    fechaFallback = ''
  ): SgcF10Hallazgo[] {
    const fechaBase = /^\d{4}-\d{2}-\d{2}$/.test(String(fechaFallback || '').trim())
      ? String(fechaFallback).trim()
      : this.fechaHoyIsoSgcF10();
    if (!Array.isArray(items) || !items.length) {
      const vacio = this.crearHallazgoSgcF10Vacio();
      vacio.clausula = String(clausulaHeredada || '').trim();
      vacio.fechaAdicion = fechaBase;
      return [vacio];
    }
    return items.map((item, idx) => {
      const auditorIdRaw = Number((item as SgcF10Hallazgo)?.auditorId);
      const auditorId = Number.isFinite(auditorIdRaw) && auditorIdRaw > 0 ? auditorIdRaw : null;
      let auditor = String((item as SgcF10Hallazgo)?.auditor || '').trim();
      if (auditorId && !auditor) {
        const nombre = this.nombreUsuarioSgcF10(auditorId);
        auditor = nombre.startsWith('#') ? '' : nombre;
      }
      let fechaAdicion = String((item as SgcF10Hallazgo)?.fechaAdicion || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaAdicion)) {
        fechaAdicion = fechaBase;
      }
      return {
        id: String((item as SgcF10Hallazgo)?.id || '').trim() || this.nuevoIdHallazgoSgcF10(),
        clausula: String(item?.clausula || (idx === 0 ? clausulaHeredada : '') || '').trim(),
        clasificacion: this.normalizarClasificacionSgcF10((item as SgcF10Hallazgo)?.clasificacion),
        descripcion: String(item?.descripcion || '').trim(),
        procesos: String(item?.procesos || '').trim(),
        auditorId,
        auditor,
        fechaAdicion
      };
    });
  }

  private normalizarSgcF10Form(datos: Partial<SgcF10FormData> | null | undefined): SgcF10FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    const empresaIdNum = Number(base.empresaId);
    const liderIdNum = Number(base.auditorLiderId);
    return {
      revision: String(base.revision || '00').trim().padStart(2, '0'),
      fechaRevision: String(base.fechaRevision || '2025-01-14').trim(),
      fechaElaboracion: String(base.fechaElaboracion || base.fechaRevision || '2025-01-14').trim(),
      auditoriaNo: String(base.auditoriaNo || '').trim() || this.sgcF10AuditoriaActual,
      fechasAuditoria: String(base.fechasAuditoria || '').trim() || this.fechaHoyDisplaySgcF10(),
      ubicaciones: String(base.ubicaciones || '').trim(),
      empresaId: Number.isFinite(empresaIdNum) && empresaIdNum > 0 ? empresaIdNum : null,
      empresa: String(base.empresa || '').trim(),
      domicilio: String(base.domicilio || '').trim(),
      objetivos: String(base.objetivos || '').trim(),
      criterios: String(base.criterios || '').trim(),
      alcance: String(base.alcance || '').trim(),
      auditorLiderId: Number.isFinite(liderIdNum) && liderIdNum > 0 ? liderIdNum : null,
      auditorLider: String(base.auditorLider || '').trim(),
      auditorLiderFirmaDriveId: String(base.auditorLiderFirmaDriveId || '').trim(),
      auditoresIds: this.normalizarIdsSgcF10(base.auditoresIds),
      auditores: String(base.auditores || '').trim(),
      participantesIds: this.normalizarIdsSgcF10(base.participantesIds),
      participantes: String(base.participantes || '').trim(),
      otrosParticipantesIds: this.normalizarIdsSgcF10(base.otrosParticipantesIds),
      otrosParticipantes: String(base.otrosParticipantes || '').trim(),
      clausulaNorma: String(base.clausulaNorma || '').trim(),
      hallazgos: this.normalizarHallazgosSgcF10(
        base.hallazgos,
        String(base.clausulaNorma || '').trim(),
        String(base.fechaElaboracion || base.fechaRevision || '').trim()
      ),
      conclusiones: String(base.conclusiones || '').trim(),
      firmaAuditorLider: String(base.firmaAuditorLider || '').trim(),
      firmaDireccionGeneralId: (() => {
        const n = Number(base.firmaDireccionGeneralId);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      firmaDireccionGeneral: String(base.firmaDireccionGeneral || '').trim(),
      firmaDireccionGeneralFirmaDriveId: String(base.firmaDireccionGeneralFirmaDriveId || '').trim()
    };
  }

  private cargarCatalogosSgcF10(): void {
    this.backendService.obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const lista: any[] = Array.isArray(res?.empresas) ? res.empresas : [];
          this.sgcF10Empresas = lista
            .map((e: any) => {
              const ciudad = String(e?.ciudad || '').trim();
              const estado = String(e?.estado || '').trim();
              const ubicacion = [ciudad, estado].filter(Boolean).join(', ');
              return {
                empresaId: Number(e?.empresa_id),
                nombre: String(e?.nombre_empresa || '').trim(),
                direccion: String(e?.direccion || '').trim(),
                ubicacion
              } as SgcF10EmpresaOpt;
            })
            .filter((e) => Number.isFinite(e.empresaId) && e.empresaId > 0 && !!e.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
          this.sincronizarRefsSgcF10DesdeCatalogos();
        },
        error: () => {
          this.sgcF10Empresas = [];
        }
      });

    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          this.sgcF10Usuarios = usuarios
            .filter((u: any) => {
              const rol = String(u?.rol || '').toLowerCase();
              return rol !== 'empresa' && rol !== 'usuario empresa';
            })
            .map((u: any) => {
              const nombre = `${String(u?.nombre || '').trim()} ${String(u?.apellido || '').trim()}`.trim()
                || String(u?.username || '').trim();
              return {
                id: Number(u?.id),
                nombre,
                firmaDriveId: String(u?.firma_drive_id || '').trim()
              } as SgcF10UsuarioOpt;
            })
            .filter((u) => Number.isFinite(u.id) && u.id > 0 && !!u.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
          this.sincronizarRefsSgcF10DesdeCatalogos();
        },
        error: () => {
          this.sgcF10Usuarios = [];
        }
      });
  }

  private sincronizarRefsSgcF10DesdeCatalogos(): void {
    if (!this.sgcF10Form) {
      return;
    }
    if (!this.sgcF10Form.empresaId && this.sgcF10Form.empresa) {
      const match = this.sgcF10Empresas.find(
        (e) => e.nombre.toLowerCase() === this.sgcF10Form.empresa.toLowerCase()
      );
      if (match) {
        this.sgcF10Form.empresaId = match.empresaId;
      }
    }
    if (this.sgcF10Form.auditorLiderId) {
      const match = this.sgcF10Usuarios.find((u) => u.id === this.sgcF10Form.auditorLiderId);
      if (match) {
        this.sgcF10Form.auditorLider = match.nombre;
        this.sgcF10Form.auditorLiderFirmaDriveId = match.firmaDriveId;
        this.sgcF10Form.firmaAuditorLider = match.nombre;
      }
    } else if (this.sgcF10Form.auditorLider) {
      const match = this.buscarUsuarioPorNombreSgcF10(this.sgcF10Form.auditorLider);
      if (match) {
        this.sgcF10Form.auditorLiderId = match.id;
        this.sgcF10Form.auditorLiderFirmaDriveId = match.firmaDriveId;
        this.sgcF10Form.firmaAuditorLider = match.nombre;
      }
    }
    if (!this.sgcF10Form.firmaDireccionGeneralId && this.sgcF10Form.firmaDireccionGeneral) {
      const match = this.buscarUsuarioPorNombreSgcF10(this.sgcF10Form.firmaDireccionGeneral);
      if (match) {
        this.sgcF10Form.firmaDireccionGeneralId = match.id;
        this.sgcF10Form.firmaDireccionGeneralFirmaDriveId = match.firmaDriveId;
      }
    }

    (['auditores', 'participantes', 'otros'] as const).forEach((campo) => {
      const nombres = this.listaNombresSgcF10(campo);
      if (nombres.length) {
        this.sincronizarIdsDesdeNombresSgcF10(campo);
        return;
      }
      const ids = campo === 'auditores'
        ? this.sgcF10Form.auditoresIds
        : campo === 'participantes'
          ? this.sgcF10Form.participantesIds
          : this.sgcF10Form.otrosParticipantesIds;
      if (ids.length) {
        this.fijarListaNombresSgcF10(
          campo,
          ids.map((id) => this.nombreUsuarioSgcF10(id)).filter((n) => !n.startsWith('#'))
        );
      }
    });
  }

  nombreUsuarioSgcF10(id: number): string {
    return this.sgcF10Usuarios.find((u) => u.id === id)?.nombre || `#${id}`;
  }

  listaNombresSgcF10(campo: 'auditores' | 'participantes' | 'otros'): string[] {
    const texto = campo === 'auditores'
      ? this.sgcF10Form.auditores
      : campo === 'participantes'
        ? this.sgcF10Form.participantes
        : this.sgcF10Form.otrosParticipantes;
    return String(texto || '')
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  puedeRegistrarNombreLibreSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros'): boolean {
    const q = String(this.sgcF10ComboQuery || '').trim();
    if (!q) {
      return false;
    }
    const qNorm = q.toLowerCase();
    if (campo === 'lider') {
      return !this.sgcF10Usuarios.some((u) => u.nombre.toLowerCase() === qNorm);
    }
    const yaAgregado = this.listaNombresSgcF10(campo).some((n) => n.toLowerCase() === qNorm);
    if (yaAgregado) {
      return false;
    }
    return !this.sgcF10Usuarios.some((u) => u.nombre.toLowerCase() === qNorm);
  }

  usuariosDisponiblesSgcF10(campo: 'auditores' | 'participantes' | 'otros'): SgcF10UsuarioOpt[] {
    const nombresActuales = new Set(
      this.listaNombresSgcF10(campo).map((n) => n.toLowerCase())
    );
    return this.sgcF10Usuarios.filter((u) => !nombresActuales.has(u.nombre.toLowerCase()));
  }

  textoComboSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros'): string {
    if (this.sgcF10ComboAbierto === campo) {
      return this.sgcF10ComboQuery;
    }
    if (campo === 'lider') {
      return this.sgcF10Form.auditorLider || '';
    }
    return '';
  }

  usuariosFiltradosSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros'): SgcF10UsuarioOpt[] {
    const base = campo === 'lider'
      ? this.sgcF10Usuarios
      : this.usuariosDisponiblesSgcF10(campo);
    const q = (this.sgcF10ComboAbierto === campo
      ? this.sgcF10ComboQuery
      : this.textoComboSgcF10(campo)
    ).trim().toLowerCase();
    if (!q) {
      return base.slice(0, 40);
    }
    return base.filter((u) => u.nombre.toLowerCase().includes(q)).slice(0, 40);
  }

  abrirComboSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros'): void {
    this.sgcF10ComboAbierto = campo;
    this.sgcF10ComboQuery = campo === 'lider' ? (this.sgcF10Form.auditorLider || '') : '';
  }

  onFiltroComboSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros', valor: string): void {
    this.sgcF10ComboAbierto = campo;
    this.sgcF10ComboQuery = valor;
    if (campo === 'lider') {
      // Mientras escribe, el nombre libre se refleja; la firma/id se resuelven al confirmar.
      this.sgcF10Form.auditorLider = valor;
      this.sgcF10Form.firmaAuditorLider = valor.trim();
      const match = this.buscarUsuarioPorNombreSgcF10(valor);
      if (match) {
        this.sgcF10Form.auditorLiderId = match.id;
        this.sgcF10Form.auditorLiderFirmaDriveId = match.firmaDriveId || '';
      } else {
        this.sgcF10Form.auditorLiderId = null;
        this.sgcF10Form.auditorLiderFirmaDriveId = '';
      }
      this.onSgcF10Editado();
    }
  }

  cerrarComboSgcF10(): void {
    if (this.sgcF10ComboAbierto === 'lider') {
      this.confirmarAuditorLiderLibreSgcF10();
    }
    this.sgcF10ComboAbierto = null;
    this.sgcF10ComboQuery = '';
  }

  limpiarComboSgcF10(campo: 'lider' | 'auditores' | 'participantes' | 'otros', event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (campo === 'lider') {
      this.onAuditorLiderSgcF10Change(null);
      this.sgcF10ComboQuery = '';
      this.sgcF10ComboAbierto = campo;
      return;
    }
    this.sgcF10ComboQuery = '';
    this.sgcF10ComboAbierto = campo;
  }

  seleccionarUsuarioComboSgcF10(
    campo: 'lider' | 'auditores' | 'participantes' | 'otros',
    userId: number
  ): void {
    if (campo === 'lider') {
      this.onAuditorLiderSgcF10Change(userId);
      this.cerrarComboSgcF10();
      return;
    }
    const usuario = this.sgcF10Usuarios.find((u) => u.id === userId);
    if (!usuario) {
      return;
    }
    this.agregarNombreSgcF10(campo, usuario.nombre);
    this.sgcF10ComboQuery = '';
    this.sgcF10ComboAbierto = campo;
  }

  registrarNombreLibreSgcF10(
    campo: 'lider' | 'auditores' | 'participantes' | 'otros',
    event?: Event
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
    const nombre = String(this.sgcF10ComboQuery || '').trim();
    if (!nombre) {
      return;
    }
    if (campo === 'lider') {
      this.aplicarAuditorLiderLibreSgcF10(nombre);
      this.cerrarComboSgcF10();
      return;
    }
    this.agregarNombreSgcF10(campo, nombre);
    this.sgcF10ComboQuery = '';
    this.sgcF10ComboAbierto = campo;
  }

  onComboSgcF10Keydown(
    campo: 'lider' | 'auditores' | 'participantes' | 'otros',
    event: KeyboardEvent
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarComboSgcF10();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const q = String(this.sgcF10ComboQuery || '').trim();
      if (!q) {
        return;
      }
      const exacto = this.usuariosFiltradosSgcF10(campo)
        .find((u) => u.nombre.toLowerCase() === q.toLowerCase());
      if (exacto) {
        this.seleccionarUsuarioComboSgcF10(campo, exacto.id);
        return;
      }
      this.registrarNombreLibreSgcF10(campo);
    }
  }

  private buscarUsuarioPorNombreSgcF10(nombre: string): SgcF10UsuarioOpt | undefined {
    const q = String(nombre || '').trim().toLowerCase();
    if (!q) {
      return undefined;
    }
    return this.sgcF10Usuarios.find((u) => u.nombre.toLowerCase() === q);
  }

  private confirmarAuditorLiderLibreSgcF10(): void {
    const nombre = String(this.sgcF10ComboQuery || this.sgcF10Form.auditorLider || '').trim();
    this.aplicarAuditorLiderLibreSgcF10(nombre);
  }

  private aplicarAuditorLiderLibreSgcF10(nombreRaw: string): void {
    const nombre = String(nombreRaw || '').trim();
    if (!nombre) {
      this.onAuditorLiderSgcF10Change(null);
      return;
    }
    const match = this.buscarUsuarioPorNombreSgcF10(nombre);
    if (match) {
      this.onAuditorLiderSgcF10Change(match.id);
      return;
    }
    this.sgcF10Form.auditorLiderId = null;
    this.sgcF10Form.auditorLider = nombre;
    this.sgcF10Form.auditorLiderFirmaDriveId = '';
    this.sgcF10Form.firmaAuditorLider = nombre;
    this.onSgcF10Editado();
  }

  onEmpresaSgcF10Change(empresaIdRaw: string | number | null): void {
    const empresaId = Number(empresaIdRaw);
    if (!Number.isFinite(empresaId) || empresaId <= 0) {
      this.sgcF10Form.empresaId = null;
      this.onSgcF10Editado();
      return;
    }
    const empresa = this.sgcF10Empresas.find((e) => e.empresaId === empresaId);
    this.sgcF10Form.empresaId = empresaId;
    if (empresa) {
      this.sgcF10Form.empresa = empresa.nombre;
      this.sgcF10Form.ubicaciones = empresa.ubicacion || this.sgcF10Form.ubicaciones;
      this.sgcF10Form.domicilio = empresa.direccion || this.sgcF10Form.domicilio;
    }
    this.onSgcF10Editado();
  }

  onAuditorLiderSgcF10Change(userIdRaw: string | number | null): void {
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      this.sgcF10Form.auditorLiderId = null;
      this.sgcF10Form.auditorLider = '';
      this.sgcF10Form.auditorLiderFirmaDriveId = '';
      this.sgcF10Form.firmaAuditorLider = '';
      this.onSgcF10Editado();
      return;
    }
    const usuario = this.sgcF10Usuarios.find((u) => u.id === userId);
    this.sgcF10Form.auditorLiderId = userId;
    this.sgcF10Form.auditorLider = usuario?.nombre || '';
    this.sgcF10Form.auditorLiderFirmaDriveId = usuario?.firmaDriveId || '';
    this.sgcF10Form.firmaAuditorLider = usuario?.nombre || '';
    this.sgcF10ComboQuery = usuario?.nombre || '';
    this.onSgcF10Editado();
  }

  onFirmaDgSgcF10Change(userIdRaw: string | number | null): void {
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      this.sgcF10Form.firmaDireccionGeneralId = null;
      this.sgcF10Form.firmaDireccionGeneral = '';
      this.sgcF10Form.firmaDireccionGeneralFirmaDriveId = '';
      this.onSgcF10Editado();
      return;
    }
    const usuario = this.sgcF10Usuarios.find((u) => u.id === userId);
    this.sgcF10Form.firmaDireccionGeneralId = userId;
    this.sgcF10Form.firmaDireccionGeneral = usuario?.nombre || '';
    this.sgcF10Form.firmaDireccionGeneralFirmaDriveId = usuario?.firmaDriveId || '';
    this.onSgcF10Editado();
  }

  private sincronizarIdsDesdeNombresSgcF10(campo: 'auditores' | 'participantes' | 'otros'): void {
    const nombres = this.listaNombresSgcF10(campo);
    const ids = nombres
      .map((nombre) => this.buscarUsuarioPorNombreSgcF10(nombre)?.id)
      .filter((id): id is number => Number.isFinite(id as number) && (id as number) > 0);
    if (campo === 'auditores') this.sgcF10Form.auditoresIds = ids;
    if (campo === 'participantes') this.sgcF10Form.participantesIds = ids;
    if (campo === 'otros') this.sgcF10Form.otrosParticipantesIds = ids;
  }

  private fijarListaNombresSgcF10(campo: 'auditores' | 'participantes' | 'otros', nombres: string[]): void {
    const unicos: string[] = [];
    const vistos = new Set<string>();
    for (const nombre of nombres) {
      const limpio = String(nombre || '').trim();
      if (!limpio) continue;
      const key = limpio.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      unicos.push(limpio);
    }
    const texto = unicos.join('\n');
    if (campo === 'auditores') this.sgcF10Form.auditores = texto;
    if (campo === 'participantes') this.sgcF10Form.participantes = texto;
    if (campo === 'otros') this.sgcF10Form.otrosParticipantes = texto;
    this.sincronizarIdsDesdeNombresSgcF10(campo);
  }

  agregarNombreSgcF10(campo: 'auditores' | 'participantes' | 'otros', nombreRaw: string): void {
    const nombre = String(nombreRaw || '').trim();
    if (!nombre) {
      return;
    }
    const actuales = this.listaNombresSgcF10(campo);
    if (actuales.some((n) => n.toLowerCase() === nombre.toLowerCase())) {
      return;
    }
    this.fijarListaNombresSgcF10(campo, [...actuales, nombre]);
    this.onSgcF10Editado();
  }

  /** @deprecated preferir agregarNombreSgcF10; se mantiene por compatibilidad. */
  agregarPersonaSgcF10(campo: 'auditores' | 'participantes' | 'otros', userIdRaw: string): void {
    const userId = Number(userIdRaw);
    const usuario = this.sgcF10Usuarios.find((u) => u.id === userId);
    if (!usuario) {
      return;
    }
    this.agregarNombreSgcF10(campo, usuario.nombre);
  }

  quitarPersonaSgcF10(campo: 'auditores' | 'participantes' | 'otros', index: number): void {
    const actuales = this.listaNombresSgcF10(campo);
    if (index < 0 || index >= actuales.length) {
      return;
    }
    actuales.splice(index, 1);
    this.fijarListaNombresSgcF10(campo, actuales);
    this.onSgcF10Editado();
  }

  private cargarSgcF10DesdeServidor(): void {
    this.sgcF10Cargando = true;
    this.sgcF10Listo = false;
    this.backendService.cargarSgcF10Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF10(res),
        error: () => {
          this.sgcF10Cargando = false;
          this.sgcF10Listo = true;
        }
      });
  }

  onSgcF10Editado(): void {
    if (!this.sgcF10Listo || this.sgcF10IgnorarAutoSave) {
      return;
    }
    this.sgcF10CambiosPendientes = true;
  }

  agregarHallazgoSgcF10(): void {
    // Cada apartado agrupa una cláusula con su hallazgo; se clona la estructura del #1 vacía.
    this.cerrarClasifSgcF10();
    this.sgcF10Form.hallazgos.push(this.crearHallazgoSgcF10Vacio());
    this.sgcF10HallazgoEditandoIdx = this.sgcF10Form.hallazgos.length - 1;
    this.onSgcF10Editado();
    this.autosizeTextareasSgcF10();
  }

  quitarHallazgoSgcF10(index: number): void {
    if (this.sgcF10Form.hallazgos.length <= 1) {
      void Swal.fire({
        icon: 'info',
        title: 'No se puede borrar',
        text: 'Debe permanecer al menos un hallazgo en el informe.',
        confirmButtonColor: '#15a596'
      });
      return;
    }
    const hallazgo = this.sgcF10Form.hallazgos[index];
    const etiqueta = String(hallazgo?.clausula || '').trim() || `Hallazgo ${index + 1}`;
    void Swal.fire({
      icon: 'warning',
      title: '¿Estás seguro de borrar este hallazgo?',
      html: `<p class="mb-0">Se eliminará <strong>${this.escaparHtmlSgcF10(etiqueta)}</strong> del informe. Esta acción no se puede deshacer desde aquí.</p>`,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: 'Sí, borrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b'
    }).then((result) => {
      if (!result.isConfirmed) {
        return;
      }
      this.ejecutarBorradoHallazgoSgcF10(index);
    });
  }

  private escaparHtmlSgcF10(texto: string): string {
    return String(texto || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private ejecutarBorradoHallazgoSgcF10(index: number): void {
    if (index < 0 || index >= this.sgcF10Form.hallazgos.length || this.sgcF10Form.hallazgos.length <= 1) {
      return;
    }
    this.cerrarClasifSgcF10();
    if (this.sgcF10HallazgoEditorIdx === index) {
      this.cerrarEditorHallazgoSgcF10();
    } else if (this.sgcF10HallazgoEditorIdx != null && this.sgcF10HallazgoEditorIdx > index) {
      this.sgcF10HallazgoEditorIdx -= 1;
    }
    const editandoId = this.sgcF10HallazgoEditandoIdx != null
      ? this.sgcF10Form.hallazgos[this.sgcF10HallazgoEditandoIdx]?.id
      : null;
    this.sgcF10Form.hallazgos.splice(index, 1);
    if (editandoId) {
      const nuevoIdx = this.sgcF10Form.hallazgos.findIndex((h) => h.id === editandoId);
      this.sgcF10HallazgoEditandoIdx = nuevoIdx >= 0 ? nuevoIdx : null;
    } else {
      this.sgcF10HallazgoEditandoIdx = null;
    }
    this.onSgcF10Editado();
  }

  estaEditandoHallazgoSgcF10(index: number): boolean {
    return this.sgcF10HallazgoEditandoIdx === index;
  }

  get sgcF10AuditoresHallazgoOpts(): SgcF10UsuarioOpt[] {
    const ids = new Set<number>();
    const salida: SgcF10UsuarioOpt[] = [];
    const agregar = (id: number | null | undefined, nombreFallback = '') => {
      const n = Number(id);
      if (!Number.isFinite(n) || n <= 0 || ids.has(n)) {
        return;
      }
      ids.add(n);
      const u = this.sgcF10Usuarios.find((x) => x.id === n);
      salida.push(u || { id: n, nombre: nombreFallback || `#${n}`, firmaDriveId: '' });
    };
    agregar(this.sgcF10Form.auditorLiderId, this.sgcF10Form.auditorLider);
    (this.sgcF10Form.auditoresIds || []).forEach((id) => agregar(id));
    this.sgcF10Usuarios.forEach((u) => agregar(u.id, u.nombre));
    return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  }

  get sgcF10HallazgosVista(): SgcF10HallazgoVista[] {
    const filtroAuditor = String(this.sgcF10FiltroAuditor || '').trim().toLowerCase();
    const filtroClausula = String(this.sgcF10FiltroClausula || '').trim().toLowerCase();
    let items = this.sgcF10Form.hallazgos.map((hallazgo, index) => ({ hallazgo, index, num: index + 1 }));

    if (filtroAuditor) {
      items = items.filter(({ hallazgo }) => {
        const nombre = String(hallazgo.auditor || '').trim().toLowerCase();
        const id = hallazgo.auditorId != null ? String(hallazgo.auditorId) : '';
        return nombre.includes(filtroAuditor) || id === filtroAuditor;
      });
    }
    if (filtroClausula) {
      items = items.filter(({ hallazgo }) =>
        String(hallazgo.clausula || '').toLowerCase().includes(filtroClausula)
      );
    }

    return items.map((item, i) => ({ ...item, num: i + 1 }));
  }

  get sgcF10HayFiltroHallazgos(): boolean {
    return !!(String(this.sgcF10FiltroAuditor || '').trim() || String(this.sgcF10FiltroClausula || '').trim());
  }

  trackByHallazgoVistaSgcF10(_: number, item: SgcF10HallazgoVista): string {
    return item.hallazgo.id || String(item.index);
  }

  onOrdenHallazgosSgcF10Change(orden: SgcF10OrdenHallazgos): void {
    if (!orden || orden === 'manual') {
      this.sgcF10OrdenHallazgos = 'manual';
      return;
    }

    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const items = this.sgcF10Form.hallazgos.map((hallazgo, index) => ({ hallazgo, index }));
    switch (orden) {
      case 'auditor_asc':
        items.sort((a, b) =>
          collator.compare(a.hallazgo.auditor || 'zzz', b.hallazgo.auditor || 'zzz')
          || (a.index - b.index)
        );
        break;
      case 'clausula_asc':
        items.sort((a, b) =>
          collator.compare(a.hallazgo.clausula || 'zzz', b.hallazgo.clausula || 'zzz')
          || (a.index - b.index)
        );
        break;
      case 'fecha_asc':
        items.sort((a, b) =>
          String(a.hallazgo.fechaAdicion || '').localeCompare(String(b.hallazgo.fechaAdicion || ''))
          || (a.index - b.index)
        );
        break;
      case 'fecha_desc':
        items.sort((a, b) =>
          String(b.hallazgo.fechaAdicion || '').localeCompare(String(a.hallazgo.fechaAdicion || ''))
          || (a.index - b.index)
        );
        break;
      default:
        this.sgcF10OrdenHallazgos = 'manual';
        return;
    }

    const editandoId = this.sgcF10HallazgoEditandoIdx != null
      ? this.sgcF10Form.hallazgos[this.sgcF10HallazgoEditandoIdx]?.id
      : null;
    this.sgcF10Form.hallazgos = items.map((v) => v.hallazgo);
    if (editandoId) {
      const nuevoIdx = this.sgcF10Form.hallazgos.findIndex((h) => h.id === editandoId);
      this.sgcF10HallazgoEditandoIdx = nuevoIdx >= 0 ? nuevoIdx : null;
    }
    this.sgcF10OrdenHallazgos = 'manual';
    this.onSgcF10Editado();
  }

  limpiarFiltrosHallazgosSgcF10(): void {
    this.sgcF10FiltroAuditor = '';
    this.sgcF10FiltroClausula = '';
  }

  onAuditorHallazgoSgcF10Change(index: number, auditorId: number | null): void {
    const hallazgo = this.sgcF10Form.hallazgos[index];
    if (!hallazgo || !this.estaEditandoHallazgoSgcF10(index)) {
      return;
    }
    const idNum = Number(auditorId);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      hallazgo.auditorId = null;
      hallazgo.auditor = '';
      this.onSgcF10Editado();
      return;
    }
    const opt = this.sgcF10AuditoresHallazgoOpts.find((u) => u.id === idNum)
      || this.sgcF10Usuarios.find((u) => u.id === idNum);
    hallazgo.auditorId = idNum;
    hallazgo.auditor = opt?.nombre || this.nombreUsuarioSgcF10(idNum);
    this.onSgcF10Editado();
  }

  formatearFechaHallazgoSgcF10(iso: string | null | undefined): string {
    const s = String(iso || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return s || '—';
    }
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  iniciarEdicionHallazgoSgcF10(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.sgcF10Form.hallazgos[index]) {
      return;
    }
    this.cerrarClasifSgcF10();
    this.cerrarComboSgcF10();
    this.sgcF10HallazgoEditandoIdx = index;
    this.autosizeTextareasSgcF10();
  }

  cerrarEdicionHallazgoSgcF10(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.cerrarClasifSgcF10();
    this.sgcF10HallazgoEditandoIdx = null;
  }

  opcionClasifSgcF10(valor: SgcF10Clasificacion | string | null | undefined) {
    const key = this.normalizarClasificacionSgcF10(valor);
    return this.sgcF10Clasificaciones.find((o) => o.value === key) || this.sgcF10Clasificaciones[0];
  }

  abrirClasifSgcF10(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.estaEditandoHallazgoSgcF10(index)) {
      return;
    }
    this.cerrarComboSgcF10();
    this.sgcF10ClasifAbierto = this.sgcF10ClasifAbierto === index ? null : index;
  }

  cerrarClasifSgcF10(): void {
    this.sgcF10ClasifAbierto = null;
  }

  seleccionarClasifSgcF10(index: number, valor: SgcF10Clasificacion, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.estaEditandoHallazgoSgcF10(index)) {
      return;
    }
    const hallazgo = this.sgcF10Form.hallazgos[index];
    if (!hallazgo) {
      return;
    }
    hallazgo.clasificacion = valor;
    this.sgcF10ClasifAbierto = null;
    this.onSgcF10Editado();
  }

  onTextoAutosizeSgcF10(event: Event): void {
    this.autosizeTextarea(event.target);
    this.onSgcF10Editado();
  }

  get sgcF10HallazgoEditorClausula(): string {
    const idx = this.sgcF10HallazgoEditorIdx;
    if (idx == null) {
      return '';
    }
    return String(this.sgcF10Form.hallazgos[idx]?.clausula || '').trim();
  }

  get sgcF10HallazgoEditorClasifLabel(): string {
    const idx = this.sgcF10HallazgoEditorIdx;
    if (idx == null) {
      return '';
    }
    const clasif = this.sgcF10Form.hallazgos[idx]?.clasificacion;
    if (!clasif) {
      return '';
    }
    return this.opcionClasifSgcF10(clasif).label;
  }

  hallazgoDescripcionTieneContenido(html: string | null | undefined): boolean {
    return !!this.htmlATextoPlanoHallazgoSgcF10(html).trim();
  }

  htmlSeguroHallazgoSgcF10(html: string | null | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.sanitizarHtmlHallazgoSgcF10(html));
  }

  abrirEditorHallazgoSgcF10(index: number): void {
    if (!this.sgcF10Form.hallazgos[index]) {
      return;
    }
    if (!this.estaEditandoHallazgoSgcF10(index)) {
      this.iniciarEdicionHallazgoSgcF10(index);
    }
    this.cerrarComboSgcF10();
    this.cerrarClasifSgcF10();
    this.sgcF10HallazgoEditorIdx = index;
    this.sgcF10HallazgoEditorBorrador = this.sanitizarHtmlHallazgoSgcF10(
      this.sgcF10Form.hallazgos[index].descripcion
    );
    this.mostrarSgcF10HallazgoEditor = true;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => this.poblarEditorHallazgoModalSgcF10(), 0);
  }

  aplicarFormatoHallazgoSgcF10(event: Event, comando: 'bold' | 'italic'): void {
    // pointerdown/mousedown: evitar que el botón robe el foco y pierda la selección.
    event.preventDefault();
    event.stopPropagation();

    const editor = this.sgcF10HallazgoRichEditor?.nativeElement;
    if (!editor) {
      return;
    }

    this.restaurarSeleccionEditorHallazgo(editor);

    const aplicado = document.execCommand(comando, false);
    if (!aplicado) {
      this.toggleFormatoManualHallazgo(editor, comando);
    }

    this.onHallazgoEditorInputSgcF10();
    this.refrescarEstadoToolbarHallazgo();
  }

  onSeleccionEditorHallazgoSgcF10(): void {
    this.guardarSeleccionEditorHallazgo();
    this.refrescarEstadoToolbarHallazgo();
  }

  onHallazgoEditorInputSgcF10(): void {
    const editor = this.sgcF10HallazgoRichEditor?.nativeElement;
    if (!editor) {
      return;
    }
    this.sgcF10HallazgoEditorBorrador = this.sanitizarHtmlHallazgoSgcF10(editor.innerHTML);
    this.guardarSeleccionEditorHallazgo();
    this.refrescarEstadoToolbarHallazgo();
  }

  onTecladoEditorHallazgoSgcF10(event: KeyboardEvent): void {
    const key = String(event.key || '').toLowerCase();
    const conMod = event.ctrlKey || event.metaKey;
    if (!conMod) {
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      this.aplicarFormatoHallazgoSgcF10(event, 'bold');
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      this.aplicarFormatoHallazgoSgcF10(event, 'italic');
    }
  }

  private guardarSeleccionEditorHallazgo(): void {
    const editor = this.sgcF10HallazgoRichEditor?.nativeElement;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) {
      return;
    }
    const rango = sel.getRangeAt(0);
    if (!editor.contains(rango.commonAncestorContainer)) {
      return;
    }
    this.sgcF10HallazgoRangoGuardado = rango.cloneRange();
  }

  private restaurarSeleccionEditorHallazgo(editor: HTMLDivElement): void {
    const sel = window.getSelection();
    if (!sel) {
      return;
    }

    let rango: Range | null = null;
    if (sel.rangeCount > 0) {
      const actual = sel.getRangeAt(0);
      if (editor.contains(actual.commonAncestorContainer)) {
        rango = actual.cloneRange();
      }
    }
    if (!rango && this.sgcF10HallazgoRangoGuardado
      && editor.contains(this.sgcF10HallazgoRangoGuardado.commonAncestorContainer)) {
      rango = this.sgcF10HallazgoRangoGuardado.cloneRange();
    }

    editor.focus();
    if (rango) {
      sel.removeAllRanges();
      sel.addRange(rango);
      this.sgcF10HallazgoRangoGuardado = rango.cloneRange();
    }
  }

  private refrescarEstadoToolbarHallazgo(): void {
    try {
      this.sgcF10HallazgoFmtBold = !!document.queryCommandState('bold');
      this.sgcF10HallazgoFmtItalic = !!document.queryCommandState('italic');
    } catch {
      this.sgcF10HallazgoFmtBold = false;
      this.sgcF10HallazgoFmtItalic = false;
    }
  }

  private toggleFormatoManualHallazgo(editor: HTMLDivElement, comando: 'bold' | 'italic'): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const rango = sel.getRangeAt(0);
    if (!editor.contains(rango.commonAncestorContainer) || rango.collapsed) {
      return;
    }
    const tag = comando === 'bold' ? 'strong' : 'em';
    try {
      const wrapper = document.createElement(tag);
      rango.surroundContents(wrapper);
      sel.removeAllRanges();
      const nuevo = document.createRange();
      nuevo.selectNodeContents(wrapper);
      sel.addRange(nuevo);
    } catch {
      // Selección que cruza nodos: no forzar.
    }
  }

  aplicarEditorHallazgoSgcF10(): void {
    const idx = this.sgcF10HallazgoEditorIdx;
    if (idx == null || !this.sgcF10Form.hallazgos[idx]) {
      this.cerrarEditorHallazgoSgcF10(false);
      return;
    }
    this.onHallazgoEditorInputSgcF10();
    this.sgcF10Form.hallazgos[idx].descripcion = this.sgcF10HallazgoEditorBorrador;
    this.onSgcF10Editado();
    this.cerrarEditorHallazgoSgcF10(false);
  }

  cerrarEditorHallazgoSgcF10(_desdeBackdrop = false): void {
    if (!this.mostrarSgcF10HallazgoEditor) {
      return;
    }
    this.mostrarSgcF10HallazgoEditor = false;
    this.sgcF10HallazgoEditorIdx = null;
    this.sgcF10HallazgoEditorBorrador = '';
    this.sgcF10HallazgoRangoGuardado = null;
    this.sgcF10HallazgoFmtBold = false;
    this.sgcF10HallazgoFmtItalic = false;
    if (!this.mostrarSgcF10Editor) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  private poblarEditorHallazgoModalSgcF10(): void {
    const editor = this.sgcF10HallazgoRichEditor?.nativeElement;
    if (!editor) {
      return;
    }
    editor.innerHTML = this.aHtmlHallazgoSgcF10(this.sgcF10HallazgoEditorBorrador);
    editor.focus();
    this.refrescarEstadoToolbarHallazgo();
  }

  private aHtmlHallazgoSgcF10(texto: string | null | undefined): string {
    const val = String(texto || '').trim();
    if (!val) {
      return '';
    }
    if (val.includes('<')) {
      return this.sanitizarHtmlHallazgoSgcF10(val);
    }
    return val
      .split(/\n\n+/)
      .map((parrafo) => `<p>${parrafo.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  private sanitizarHtmlHallazgoSgcF10(html: string | null | undefined): string {
    return DOMPurify.sanitize(String(html || ''), {
      ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'br', 'p', 'div'],
      ALLOWED_ATTR: []
    });
  }

  private htmlATextoPlanoHallazgoSgcF10(html: string | null | undefined): string {
    const texto = String(html || '');
    if (!texto.includes('<')) {
      return texto.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    return texto
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<\/div>\s*<div[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private autosizeTextareasSgcF10(): void {
    const aplicar = () => {
      const nodos = this.host.nativeElement.querySelectorAll<HTMLTextAreaElement>(
        'textarea.sgc-f-10-autosize'
      );
      nodos.forEach((el) => this.autosizeTextarea(el));
    };
    // Dos pases: tras paint y tras layout estable (móvil/zoom).
    window.setTimeout(aplicar, 0);
    window.setTimeout(aplicar, 180);
  }

  private persistirSgcF10(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF10Listo || this.sgcF10Guardando || this.sgcF10GuardandoHistorico) {
      return;
    }
    this.sgcF10Guardando = true;
    this.backendService.guardarSgcF10Formato(this.sgcF10Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF10Guardando = false;
          this.aplicarEstadoSgcF10(res);
        },
        error: () => {
          this.sgcF10Guardando = false;
        }
      });
  }

  async guardarHistoricoSgcF10(): Promise<void> {
    if (!this.puedeGestionarPlantillasSgc || this.sgcF10GuardandoHistorico || this.sgcF10Guardando) {
      return;
    }
    const auditoriaNo = String(this.sgcF10Form?.auditoriaNo || '').trim() || '—';
    const confirmacion = await Swal.fire({
      icon: 'warning',
      title: '¿Guardar Histórico?',
      html:
        `<p>Se cerrará la <strong>Auditoría No. ${auditoriaNo}</strong> como registro inmutable.</p>`
        + '<p>Se archivará el Word en Drive y se abrirá un <strong>nuevo informe</strong> vacío para la siguiente auditoría.</p>'
        + '<p class="mb-0"><small>Esta acción no se puede deshacer desde el formulario.</small></p>',
      showCancelButton: true,
      confirmButtonText: 'Sí, guardar histórico',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1e3a5f',
      cancelButtonColor: '#6b7280',
      reverseButtons: true
    });
    if (!confirmacion.isConfirmed) {
      return;
    }

    this.sgcF10GuardandoHistorico = true;
    this.backendService.guardarHistoricoSgcF10Formato(this.sgcF10Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF10GuardandoHistorico = false;
          this.sgcDashboardCache.invalidar();
          this.aplicarEstadoSgcF10(res);
          void Swal.fire({
            icon: 'success',
            title: 'Histórico guardado',
            text: res?.mensajeHistorico
              || `Auditoría No. ${auditoriaNo} archivada. Ya puedes capturar la siguiente.`,
            confirmButtonColor: '#15a596'
          });
        },
        error: (err) => {
          this.sgcF10GuardandoHistorico = false;
          const msg = err?.error?.error || err?.error?.message || err?.message || 'No se pudo guardar el histórico.';
          void Swal.fire({
            icon: 'error',
            title: 'Error al guardar histórico',
            text: msg,
            confirmButtonColor: '#15a596'
          });
        }
      });
  }

  actualizarPlantillaSgcF10(): void {
    if (!this.puedeGestionarPlantillasSgc || this.sgcF10ActualizandoPlantilla) {
      return;
    }
    this.sgcF10ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF10()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF10ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF10(res);
        },
        error: () => {
          this.sgcF10ActualizandoPlantilla = false;
        }
      });
  }

  private aplicarEstadoSgcF10(res: any): void {
    if (!res?.success) {
      this.sgcF10Cargando = false;
      this.sgcF10Listo = true;
      return;
    }

    if (res.datos) {
      this.sgcF10IgnorarAutoSave = true;
      this.sgcF10Listo = false;
      this.sgcF10Form = this.normalizarSgcF10Form(res.datos);
      this.sgcF10HallazgoEditandoIdx = null;
      this.sgcF10OrdenHallazgos = 'manual';
      this.sgcF10FiltroAuditor = '';
      this.sgcF10FiltroClausula = '';
      this.cerrarClasifSgcF10();
      this.sincronizarRefsSgcF10DesdeCatalogos();
    }

    if (Array.isArray(res.historial)) {
      this.sgcF10Historial = res.historial.map((h: any) => ({
        id: Number(h?.id) || 0,
        auditoriaNo: String(h?.auditoriaNo || ''),
        fechasAuditoria: String(h?.fechasAuditoria || ''),
        totalHallazgos: Number(h?.totalHallazgos) || 0,
        totalNc: Number(h?.totalNc) || 0,
        totalOp: Number(h?.totalOp) || 0,
        driveFileId: h?.driveFileId || null,
        editorUrl: h?.editorUrl || null
      }));
    }

    this.sgcF10DriveFileId = res.driveFileId || this.sgcF10DriveFileId || null;
    this.sgcF10EditorUrl = res.editorUrl || this.sgcF10EditorUrl || null;
    this.sgcF10UltimaSync = res.ultimaSyncDrive || null;
    if (this.mostrarSgcF10Editor) {
      this.fijarEditorEmbedUrlSgcF10(
        this.sgcF10EditorUrl || `https://docs.google.com/document/d/${this.sgcF10DriveFileId}/edit?usp=sharing`,
        true
      );
    }

    window.setTimeout(() => {
      this.sgcF10IgnorarAutoSave = false;
      this.sgcF10Listo = true;
      this.sgcF10CambiosPendientes = false;
      this.sgcF10Cargando = false;
      this.autosizeTextareasSgcF10();
    }, 350);
  }

  toggleSgcF10Editor(): void {
    if (!this.sgcF10DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF10Editor;
    this.mostrarSgcF10Editor = abrir;
    if (abrir) {
      this.sgcF10EditorIframeListo = false;
      this.sgcF10EditorCargando = true;
      const url = this.sgcF10EditorUrl
        || `https://docs.google.com/document/d/${encodeURIComponent(this.sgcF10DriveFileId)}/edit?usp=sharing`;
      this.fijarEditorEmbedUrlSgcF10(url, true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF10IframeLoad(): void {
    if (this.sgcF10EditorIframeListo) {
      return;
    }
    this.sgcF10EditorIframeListo = true;
    this.sgcF10EditorCargando = false;
  }

  private fijarEditorEmbedUrlSgcF10(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF10Editor && this.sgcF10EditorEmbedUrlSafe && this.sgcF10EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF10EditorUrl = null;
      this.sgcF10EditorEmbedUrlSafe = null;
      return;
    }
    this.sgcF10EditorUrl = url;
    const previewUrl = url.replace(/\/edit(?:\?[^#]*)?/i, '/preview');
    const embedUrl = this.urlIframeDriveSegunPermiso(url, previewUrl);
    this.sgcF10EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  // ===================== SGC-F-14 · Bitácora de proyectos de mejora =====================

  private crearSgcF14FormVacio(): SgcF14FormData {
    return {
      fechaElaboracion: '',
      proyectos: []
    };
  }

  private crearFilaProyectoSgcF14Vacia(): SgcF14ProyectoItem {
    return {
      folio: '',
      nombreProyecto: '',
      responsable: '',
      prioridad: '',
      estatus: '',
      avance: ''
    };
  }

  private normalizarProyectosSgcF14(items: SgcF14ProyectoItem[] | undefined): SgcF14ProyectoItem[] {
    if (!Array.isArray(items) || !items.length) {
      return [];
    }
    return items.map((item) => ({
      folio: String(item?.folio || '').trim(),
      nombreProyecto: String(item?.nombreProyecto || '').trim(),
      responsable: String(item?.responsable || '').trim(),
      prioridad: String(item?.prioridad || '').trim(),
      estatus: String(item?.estatus || '').trim(),
      avance: this.normalizarAvanceSgcF14(item?.avance)
    }));
  }

  private normalizarAvanceSgcF14(valor: unknown): string {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) {
      return '';
    }
    let n = Number(crudo);
    if (!Number.isFinite(n)) {
      return '';
    }
    if (n > 0 && n <= 1) {
      n = n * 100;
    }
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return String(n);
  }

  private normalizarSgcF14Form(datos: Partial<SgcF14FormData> | null | undefined): SgcF14FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    return {
      fechaElaboracion: String(base.fechaElaboracion || '').trim(),
      proyectos: this.normalizarProyectosSgcF14(base.proyectos)
    };
  }

  /** Genera un folio con la nomenclatura PM-DDMMAA-NN para el renglón indicado. */
  generarFolioSgcF14(index: number): void {
    const fila = this.sgcF14Form.proyectos[index];
    if (!fila) {
      return;
    }
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const aa = String(hoy.getFullYear()).slice(-2);
    const fechaTag = `${dd}${mm}${aa}`;
    const consecutivo = this.siguienteConsecutivoSgcF14(fechaTag, index);
    fila.folio = `PM-${fechaTag}-${String(consecutivo).padStart(2, '0')}`;
    this.onSgcF14Editado();
  }

  private siguienteConsecutivoSgcF14(fechaTag: string, indexActual: number): number {
    let maximo = 0;
    this.sgcF14Form.proyectos.forEach((p, i) => {
      if (i === indexActual) {
        return;
      }
      const match = String(p.folio || '').match(/^PM-(\d{6})-(\d{1,})$/i);
      if (match && match[1] === fechaTag) {
        const consecutivo = parseInt(match[2], 10);
        if (Number.isFinite(consecutivo) && consecutivo > maximo) {
          maximo = consecutivo;
        }
      }
    });
    return maximo + 1;
  }

  private cargarResponsablesSgcF14(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const nombres: string[] = usuarios
            .filter((u: any) => {
              const rol = String(u?.rol || '').toLowerCase();
              return rol !== 'empresa' && rol !== 'usuario empresa';
            })
            .map((u: any) => {
              const nombre = `${String(u?.nombre || '').trim()} ${String(u?.apellido || '').trim()}`.trim();
              return nombre || String(u?.username || '').trim();
            })
            .filter((nombre: string) => !!nombre);
          this.sgcF14Responsables = Array.from(new Set<string>(nombres))
            .sort((a, b) => a.localeCompare(b, 'es'));
        },
        error: () => {
          this.sgcF14Responsables = [];
        }
      });
  }

  private cargarSgcF14DesdeServidor(): void {
    this.sgcF14Cargando = true;
    this.sgcF14Listo = false;
    this.backendService.cargarSgcF14Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF14(res),
        error: () => {
          this.sgcF14Cargando = false;
          this.sgcF14Listo = true;
        }
      });
  }

  onSgcF14Editado(): void {
    if (!this.sgcF14Listo || this.sgcF14IgnorarAutoSave) {
      return;
    }
    this.sgcF14CambiosPendientes = true;
  }

  agregarFilaProyectoSgcF14(): void {
    this.sgcF14Form.proyectos.push(this.crearFilaProyectoSgcF14Vacia());
    this.onSgcF14Editado();
  }

  quitarFilaProyectoSgcF14(index: number): void {
    if (this.sgcF14Form.proyectos.length <= 1) {
      this.sgcF14Form.proyectos.splice(0, 1, this.crearFilaProyectoSgcF14Vacia());
    } else {
      this.sgcF14Form.proyectos.splice(index, 1);
    }
    this.onSgcF14Editado();
  }

  private sincronizarSgcF14DesdeDrive(): void {
    if (this.sgcF14Guardando) {
      return;
    }
    this.sgcF14Guardando = true;
    this.backendService.sincronizarSgcF14DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF14Guardando = false;
          this.aplicarEstadoSgcF14(res, false, false);
        },
        error: () => {
          this.sgcF14Guardando = false;
        }
      });
  }

  private persistirSgcF14(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF14Listo || this.sgcF14Guardando) {
      return;
    }
    this.sgcF14Guardando = true;
    const editorAbierto = this.mostrarSgcF14Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF14Formato(this.sgcF14Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF14Guardando = false;
          this.aplicarEstadoSgcF14(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF14Guardando = false;
        }
      });
  }

  toggleSgcF14Editor(): void {
    if (!this.sgcF14DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF14Editor;
    this.mostrarSgcF14Editor = abrir;
    if (abrir) {
      this.sgcF14EditorIframeListo = false;
      this.sgcF14EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF14(this.resolverUrlEditorDrive(this.sgcF14EditorUrl, this.sgcF14DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF14IframeLoad(): void {
    if (this.sgcF14EditorIframeListo) {
      return;
    }
    this.sgcF14EditorIframeListo = true;
    this.sgcF14EditorCargando = false;
  }

  actualizarPlantillaSgcF14(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF14ActualizandoPlantilla) {
      return;
    }
    this.sgcF14ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF14()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF14ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF14(res, false, false, true);
        },
        error: () => {
          this.sgcF14ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF14(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF14Editor && this.sgcF14EditorEmbedUrlSafe && this.sgcF14EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF14EditorUrl = null;
      this.sgcF14EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF14EditorUrl === url && this.sgcF14EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF14EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF14EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF14(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF14Cargando = false;
      }
      this.sgcF14Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF14Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF14IgnorarAutoSave = true;
      this.sgcF14Listo = false;
      this.sgcF14Form = this.normalizarSgcF14Form(res.datos);
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF14IgnorarAutoSave = true;
      this.sgcF14Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF14DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF14Editor)) {
        this.fijarEditorEmbedUrlSgcF14(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF14UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF14ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF14IgnorarAutoSave = false;
      this.sgcF14Listo = true;
      if (!bloquearFormulario) {
        this.sgcF14CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF14Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  get sgcF14IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-14') {
      return '';
    }
    return 'Registra los proyectos de mejora con su folio (PM-DDMMAA-NN), responsable, prioridad, estatus y avance. Usa «Guardar información» para conservar los cambios y reflejarlos en el Excel de Drive.';
  }

  // ===================== SGC-F-25 · Actividades posteriores a la entrega =====================

  private crearSgcF25FormVacio(): SgcF25FormData {
    return {
      fechaElaboracion: '',
      revision: '00',
      fechaRevision: '',
      actividades: []
    };
  }

  private crearFilaActividadSgcF25Vacia(): SgcF25ActividadItem {
    return {
      noContrato: '',
      cliente: '',
      actividad: '',
      descripcion: '',
      fechaCompromiso: '',
      responsables: '',
      categorias: [false, false, false, false, false]
    };
  }

  private normalizarCategoriasSgcF25(raw: unknown): boolean[] {
    const base = Array.isArray(raw) ? raw : [];
    return [0, 1, 2, 3, 4].map((i) => !!base[i]);
  }

  private normalizarActividadesSgcF25(items: SgcF25ActividadItem[] | undefined): SgcF25ActividadItem[] {
    const normalizarClave = (valor: string): string => String(valor || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return (Array.isArray(items) ? items : []).map((item) => {
      const actividadCruda = String(item?.actividad || '').trim();
      const clave = normalizarClave(actividadCruda);
      const actividad = this.sgcF25Actividades.find(
        (op) => normalizarClave(op) === clave
      ) || '';
      return {
        noContrato: String(item?.noContrato || '').trim(),
        cliente: String(item?.cliente || '').trim(),
        actividad,
        descripcion: String(item?.descripcion || '').trim(),
        fechaCompromiso: String(item?.fechaCompromiso || '').trim().slice(0, 10),
        responsables: String(item?.responsables || '').trim(),
        categorias: this.normalizarCategoriasSgcF25(item?.categorias)
      };
    });
  }

  private normalizarSgcF25Form(datos: Partial<SgcF25FormData> | null | undefined): SgcF25FormData {
    const base = datos || {};
    return {
      fechaElaboracion: String(base.fechaElaboracion || '').trim(),
      revision: String(base.revision || '00').trim().padStart(2, '0'),
      fechaRevision: String(base.fechaRevision || '').trim(),
      actividades: this.normalizarActividadesSgcF25(base.actividades)
    };
  }

  private cargarSgcF25DesdeServidor(): void {
    this.sgcF25Cargando = true;
    this.sgcF25Listo = false;
    this.backendService.cargarSgcF25Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF25(res),
        error: () => {
          this.sgcF25Cargando = false;
          this.sgcF25Listo = true;
        }
      });
  }

  onSgcF25Editado(): void {
    if (!this.sgcF25Listo || this.sgcF25IgnorarAutoSave) {
      return;
    }
    this.sgcF25CambiosPendientes = true;
  }

  toggleCategoriaSgcF25(index: number, catIndex: number): void {
    const fila = this.sgcF25Form.actividades[index];
    if (!fila) {
      return;
    }
    const cats = this.normalizarCategoriasSgcF25(fila.categorias);
    cats[catIndex] = !cats[catIndex];
    fila.categorias = cats;
    this.onSgcF25Editado();
  }

  agregarFilaActividadSgcF25(): void {
    this.sgcF25Form.actividades.push(this.crearFilaActividadSgcF25Vacia());
    this.onSgcF25Editado();
  }

  quitarFilaActividadSgcF25(index: number): void {
    if (this.sgcF25Form.actividades.length <= 1) {
      this.sgcF25Form.actividades.splice(0, 1, this.crearFilaActividadSgcF25Vacia());
    } else {
      this.sgcF25Form.actividades.splice(index, 1);
    }
    this.onSgcF25Editado();
  }

  private sincronizarSgcF25DesdeDrive(): void {
    if (this.sgcF25Guardando) {
      return;
    }
    this.sgcF25Guardando = true;
    this.backendService.sincronizarSgcF25DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF25Guardando = false;
          this.aplicarEstadoSgcF25(res, false, false);
        },
        error: () => {
          this.sgcF25Guardando = false;
        }
      });
  }

  private persistirSgcF25(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF25Listo || this.sgcF25Guardando) {
      return;
    }
    this.sgcF25Guardando = true;
    const editorAbierto = this.mostrarSgcF25Editor;
    this.backendService.guardarSgcF25Formato(this.sgcF25Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF25Guardando = false;
          this.aplicarEstadoSgcF25(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF25Guardando = false;
        }
      });
  }

  toggleSgcF25Editor(): void {
    if (!this.sgcF25DriveFileId) {
      return;
    }

    const abrir = !this.mostrarSgcF25Editor;
    this.mostrarSgcF25Editor = abrir;

    if (abrir) {
      this.sgcF25EditorIframeListo = false;
      this.sgcF25EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF25(
        this.resolverUrlEditorDrive(this.sgcF25EditorUrl, this.sgcF25DriveFileId),
        true
      );
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      // Permiso por enlace en segundo plano; no recargar el iframe (evita el modal de Google).
      this.backendService.asegurarAccesoSgcF25()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            if (res?.driveFileId) {
              this.sgcF25DriveFileId = res.driveFileId;
            }
            if (res?.editorUrl && !this.sgcF25EditorUrl) {
              this.sgcF25EditorUrl = res.editorUrl;
            }
          },
          error: () => { /* ignore */ }
        });
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF25IframeLoad(): void {
    if (this.sgcF25EditorIframeListo) {
      return;
    }
    this.sgcF25EditorIframeListo = true;
    this.sgcF25EditorCargando = false;
  }

  actualizarPlantillaSgcF25(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF25ActualizandoPlantilla) {
      return;
    }
    this.sgcF25ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF25()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF25ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF25(res, false, false, true);
        },
        error: () => {
          this.sgcF25ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF25(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF25Editor && this.sgcF25EditorEmbedUrlSafe && this.sgcF25EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF25EditorUrl = null;
      this.sgcF25EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF25EditorUrl === url && this.sgcF25EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF25EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF25EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF25(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF25Cargando = false;
      }
      this.sgcF25Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF25Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF25IgnorarAutoSave = true;
      this.sgcF25Listo = false;
      this.sgcF25Form = this.normalizarSgcF25Form(res.datos);
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF25IgnorarAutoSave = true;
      this.sgcF25Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF25DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF25Editor)) {
        this.fijarEditorEmbedUrlSgcF25(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF25UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF25ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF25IgnorarAutoSave = false;
      this.sgcF25Listo = true;
      if (!bloquearFormulario) {
        this.sgcF25CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF25Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  get sgcF25IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-25') {
      return '';
    }
    return 'Registra las actividades posteriores a la entrega y marca las categorías aplicables (1–5). Usa «Guardar información» para sincronizar con el Excel de Drive.';
  }

  // ===================== SGC-F-16 · Minuta =====================

  private crearSgcF16FormVacio(): SgcF16FormData {
    return {
      fechaElaboracion: '',
      revision: '00',
      fechaRevision: '',
      minutas: [],
      minutaActivaId: null
    };
  }

  private nuevoIdSgcF16(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `mn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private crearAsistenteSgcF16Vacio(): SgcF16Asistente {
    return { nombre: '', puesto: '', firma: '' };
  }

  private crearAgendaSgcF16Vacia(): SgcF16AgendaItem {
    return { descripcion: '' };
  }

  private crearCompromisoSgcF16Vacio(): SgcF16Compromiso {
    return {
      descripcion: '',
      responsable: '',
      fechaCompromiso: '',
      estatus: 'Pendiente',
      observaciones: ''
    };
  }

  private crearMinutaSgcF16Vacia(): SgcF16Minuta {
    return {
      id: this.nuevoIdSgcF16(),
      folio: '',
      fechaVisita: '',
      horaInicio: '',
      horaFin: '',
      hora: '',
      lugar: '',
      asunto: '',
      notasTomadasPor: '',
      asistentes: [this.crearAsistenteSgcF16Vacio(), this.crearAsistenteSgcF16Vacio()],
      agenda: [this.crearAgendaSgcF16Vacia(), this.crearAgendaSgcF16Vacia()],
      compromisos: [this.crearCompromisoSgcF16Vacio(), this.crearCompromisoSgcF16Vacio()],
      pdfFirmado: null
    };
  }

  private sanitizarPdfSgcF16(raw: any): SgcF16PdfFirmado | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) {
      return null;
    }
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-16 Minuta firmada.pdf').trim()
        || 'SGC-F-16 Minuta firmada.pdf',
      webViewLink: raw.webViewLink || raw.web_view_link || null,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  private normalizarHora24SgcF16(valor: string | null | undefined): string {
    const t = String(valor || '').trim();
    if (!t) {
      return '';
    }
    let m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
      const h = Math.min(23, Math.max(0, Number(m[1])));
      const min = Math.min(59, Math.max(0, Number(m[2])));
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    m = t.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)$/i);
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2]);
      const esPm = /^p/i.test(m[3].replace(/\s/g, ''));
      if (esPm && h < 12) {
        h += 12;
      }
      if (!esPm && h === 12) {
        h = 0;
      }
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return '';
  }

  private parsearRangoHoraSgcF16(texto: string | null | undefined): { horaInicio: string; horaFin: string } {
    const raw = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return { horaInicio: '', horaFin: '' };
    }
    const partes = raw.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2) {
      return {
        horaInicio: this.normalizarHora24SgcF16(partes[0]),
        horaFin: this.normalizarHora24SgcF16(partes[1])
      };
    }
    return { horaInicio: '', horaFin: this.normalizarHora24SgcF16(raw) };
  }

  private formatearHoraAmPmSgcF16(hhmm: string): string {
    const n = this.normalizarHora24SgcF16(hhmm);
    if (!n) {
      return '';
    }
    const [hs, ms] = n.split(':').map(Number);
    const sufijo = hs >= 12 ? 'pm' : 'am';
    let h12 = hs % 12;
    if (h12 === 0) {
      h12 = 12;
    }
    return `${h12}:${String(ms).padStart(2, '0')} ${sufijo}`;
  }

  /** Sincroniza `hora` (texto Excel) desde entrada/finalización. */
  onHoraSgcF16Editada(): void {
    const min = this.sgcF16MinutaActiva;
    if (!min) {
      return;
    }
    const inicio = this.normalizarHora24SgcF16(min.horaInicio);
    const fin = this.normalizarHora24SgcF16(min.horaFin);
    min.horaInicio = inicio;
    min.horaFin = fin;
    if (inicio && fin) {
      min.hora = `${this.formatearHoraAmPmSgcF16(inicio)} - ${this.formatearHoraAmPmSgcF16(fin)}`;
    } else if (fin) {
      min.hora = this.formatearHoraAmPmSgcF16(fin);
    } else if (inicio) {
      min.hora = this.formatearHoraAmPmSgcF16(inicio);
    } else {
      min.hora = '';
    }
    this.onSgcF16Editado();
  }

  private normalizarMinutaSgcF16(datos: Partial<SgcF16Minuta> | any | null | undefined): SgcF16Minuta {
    const base = this.crearMinutaSgcF16Vacia();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    const asistentes = Array.isArray(datos.asistentes) && datos.asistentes.length
      ? datos.asistentes.map((item: any) => ({
          nombre: String(item?.nombre || '').trim(),
          puesto: String(item?.puesto || '').trim(),
          firma: String(item?.firma || '').trim()
        }))
      : base.asistentes;
    const agenda = Array.isArray(datos.agenda) && datos.agenda.length
      ? datos.agenda.map((item: any) => ({ descripcion: String(item?.descripcion || '').trim() }))
      : base.agenda;
    const compromisos = Array.isArray(datos.compromisos) && datos.compromisos.length
      ? datos.compromisos.map((item: any) => ({
          descripcion: String(item?.descripcion || '').replace(/\r\n/g, '\n').trim(),
          responsable: String(item?.responsable || '').replace(/\r\n/g, '\n').trim(),
          fechaCompromiso: String(item?.fechaCompromiso || '').trim(),
          estatus: String(item?.estatus || 'Pendiente').trim() || 'Pendiente',
          observaciones: String(item?.observaciones || '').replace(/\r\n/g, '\n').trim()
        }))
      : base.compromisos;

    let horaInicio = this.normalizarHora24SgcF16(datos.horaInicio || datos.hora_inicio || '');
    let horaFin = this.normalizarHora24SgcF16(datos.horaFin || datos.hora_fin || '');
    if (!horaInicio && !horaFin) {
      const parsed = this.parsearRangoHoraSgcF16(datos.hora);
      horaInicio = parsed.horaInicio;
      horaFin = parsed.horaFin;
    } else if (!horaFin && datos.hora) {
      const parsed = this.parsearRangoHoraSgcF16(datos.hora);
      if (parsed.horaInicio && parsed.horaFin) {
        horaInicio = horaInicio || parsed.horaInicio;
        horaFin = parsed.horaFin;
      } else {
        horaFin = parsed.horaFin || this.normalizarHora24SgcF16(datos.hora);
      }
    }
    let hora = '';
    if (horaInicio && horaFin) {
      hora = `${this.formatearHoraAmPmSgcF16(horaInicio)} - ${this.formatearHoraAmPmSgcF16(horaFin)}`;
    } else if (horaFin) {
      hora = this.formatearHoraAmPmSgcF16(horaFin);
    } else if (horaInicio) {
      hora = this.formatearHoraAmPmSgcF16(horaInicio);
    }

    return {
      id: String(datos.id || base.id).trim() || base.id,
      folio: String(datos.folio || '').trim().toUpperCase(),
      fechaVisita: String(datos.fechaVisita || '').trim(),
      horaInicio,
      horaFin,
      hora,
      lugar: String(datos.lugar || '').trim(),
      asunto: String(datos.asunto || '').trim(),
      notasTomadasPor: String(datos.notasTomadasPor || '').trim(),
      asistentes,
      agenda,
      compromisos,
      pdfFirmado: this.sanitizarPdfSgcF16(datos.pdfFirmado)
    };
  }

  private normalizarSgcF16Form(datos: Partial<SgcF16FormData> | any | null | undefined): SgcF16FormData {
    const base = this.crearSgcF16FormVacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    let minutasRaw: any[] = [];
    if (Array.isArray(datos.minutas)) {
      minutasRaw = datos.minutas;
    } else if (
      datos.fechaVisita || datos.asunto || datos.hora || datos.lugar
      || datos.notasTomadasPor || datos.asistentes || datos.agenda || datos.compromisos
    ) {
      // Migración legacy: formulario plano → una minuta.
      minutasRaw = [datos];
    }
    const minutas = minutasRaw.map((m) => this.normalizarMinutaSgcF16(m));
    const minutaActivaId = String(datos.minutaActivaId || '').trim() || null;
    return {
      fechaElaboracion: String(datos.fechaElaboracion || '').trim(),
      revision: String(datos.revision || '00').trim() || '00',
      fechaRevision: String(datos.fechaRevision || '').trim(),
      minutas,
      minutaActivaId: minutaActivaId && minutas.some((m) => m.id === minutaActivaId)
        ? minutaActivaId
        : (minutas[0]?.id || null)
    };
  }

  /** Filas mínimas para textareas de SGC-F-16 (compromisos con saltos). */
  filasTextoSgcF16(texto: string | null | undefined, minimo = 2): number {
    return Math.max(minimo, this.filasTextoAjustadas(String(texto || ''), 26, 8));
  }

  private normalizarTextoSgcF16(valor: string | null | undefined): string {
    return String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  trackBySgcF16Persona(_: number, item: SgcF16PersonaOpt): string {
    return item?.id || `${item?.nombre || ''}|${item?.puesto || ''}`;
  }

  private cargarCatalogoPersonasSgcF16(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const mapa = new Map<string, SgcF16PersonaOpt>();
          for (const u of usuarios) {
            const rol = String(u?.rol || '').toLowerCase();
            if (rol === 'empresa' || rol === 'usuario empresa') {
              continue;
            }
            const nombre = `${String(u?.nombre || '').trim()} ${String(u?.apellido || '').trim()}`.trim()
              || String(u?.username || '').trim();
            if (!nombre) {
              continue;
            }
            const puesto = String(u?.organigrama || u?.empresa_puesto || '').trim();
            const id = String(u?.id || `${nombre}|${puesto}`);
            const key = this.normalizarTextoSgcF16(`${nombre}|${puesto}`);
            if (!mapa.has(key)) {
              mapa.set(key, { id, nombre, puesto });
            }
          }
          this.sgcF16PersonasCatalogo = Array.from(mapa.values())
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        },
        error: () => {
          this.sgcF16PersonasCatalogo = [];
        }
      });
  }

  get opcionesAsistSgcF16(): SgcF16PersonaOpt[] {
    const query = this.normalizarTextoSgcF16(this.sgcF16AsistComboQuery);
    const campo = this.sgcF16AsistComboCampo || 'nombre';
    const base = this.sgcF16PersonasCatalogo;
    if (!query) {
      return base.slice(0, 40);
    }
    return base
      .filter((p) => {
        const nombre = this.normalizarTextoSgcF16(p.nombre);
        const puesto = this.normalizarTextoSgcF16(p.puesto);
        if (campo === 'puesto') {
          return puesto.includes(query) || nombre.includes(query);
        }
        return nombre.includes(query) || puesto.includes(query);
      })
      .slice(0, 40);
  }

  get textoLibreAsistSgcF16(): string {
    const q = String(this.sgcF16AsistComboQuery || '').trim();
    if (!q) {
      return '';
    }
    const campo = this.sgcF16AsistComboCampo || 'nombre';
    const existe = this.sgcF16PersonasCatalogo.some((p) => {
      const valor = campo === 'puesto' ? p.puesto : p.nombre;
      return this.normalizarTextoSgcF16(valor) === this.normalizarTextoSgcF16(q);
    });
    return existe ? '' : q;
  }

  textoComboAsistSgcF16(index: number, campo: 'nombre' | 'puesto'): string {
    if (this.sgcF16AsistComboAbierto === index && this.sgcF16AsistComboCampo === campo) {
      return this.sgcF16AsistComboQuery;
    }
    const item = this.sgcF16MinutaActiva?.asistentes?.[index];
    return String(item?.[campo] || '');
  }

  abrirComboAsistSgcF16(index: number, campo: 'nombre' | 'puesto'): void {
    this.sgcF16AsistComboAbierto = index;
    this.sgcF16AsistComboCampo = campo;
    this.sgcF16AsistComboQuery = String(this.sgcF16MinutaActiva?.asistentes?.[index]?.[campo] || '');
  }

  onFiltroAsistSgcF16(index: number, campo: 'nombre' | 'puesto', valor: string): void {
    this.sgcF16AsistComboAbierto = index;
    this.sgcF16AsistComboCampo = campo;
    this.sgcF16AsistComboQuery = valor;
  }

  seleccionarAsistSgcF16(index: number, opt: SgcF16PersonaOpt): void {
    const item = this.sgcF16MinutaActiva?.asistentes?.[index];
    if (!item || !opt) {
      return;
    }
    item.nombre = String(opt.nombre || '').trim();
    if (opt.puesto) {
      item.puesto = String(opt.puesto).trim();
    }
    this.cerrarComboAsistSgcF16();
    this.onSgcF16Editado();
  }

  usarTextoLibreAsistSgcF16(index: number, campo: 'nombre' | 'puesto'): void {
    const item = this.sgcF16MinutaActiva?.asistentes?.[index];
    if (!item) {
      return;
    }
    const texto = String(this.sgcF16AsistComboQuery || '').trim();
    item[campo] = texto;
    this.cerrarComboAsistSgcF16();
    this.onSgcF16Editado();
  }

  confirmarTextoAsistSgcF16(index: number, campo: 'nombre' | 'puesto'): void {
    if (this.sgcF16AsistComboAbierto !== index || this.sgcF16AsistComboCampo !== campo) {
      return;
    }
    const item = this.sgcF16MinutaActiva?.asistentes?.[index];
    if (!item) {
      this.cerrarComboAsistSgcF16();
      return;
    }
    const texto = String(this.sgcF16AsistComboQuery || '').trim();
    item[campo] = texto;
    this.cerrarComboAsistSgcF16();
    this.onSgcF16Editado();
  }

  limpiarAsistSgcF16(index: number, campo: 'nombre' | 'puesto', event?: Event): void {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const item = this.sgcF16MinutaActiva?.asistentes?.[index];
    if (!item) {
      return;
    }
    item[campo] = '';
    if (this.sgcF16AsistComboAbierto === index && this.sgcF16AsistComboCampo === campo) {
      this.sgcF16AsistComboQuery = '';
    }
    this.onSgcF16Editado();
  }

  onComboAsistSgcF16Keydown(index: number, campo: 'nombre' | 'puesto', event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarComboAsistSgcF16();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primera = this.opcionesAsistSgcF16[0];
      if (primera) {
        this.seleccionarAsistSgcF16(index, primera);
      } else {
        this.usarTextoLibreAsistSgcF16(index, campo);
      }
    }
  }

  private cerrarComboAsistSgcF16(): void {
    this.sgcF16AsistComboAbierto = null;
    this.sgcF16AsistComboCampo = null;
    this.sgcF16AsistComboQuery = '';
  }

  get sgcF16Resumen(): { asistentes: number; agenda: number; compromisos: number; pendientes: number } {
    const min = this.sgcF16MinutaActiva;
    const asistentes = (min?.asistentes || []).filter((a) => a.nombre || a.puesto).length;
    const agenda = (min?.agenda || []).filter((a) => a.descripcion).length;
    const compromisos = (min?.compromisos || []).filter((c) => c.descripcion || c.responsable).length;
    const pendientes = (min?.compromisos || []).filter((c) =>
      (c.descripcion || c.responsable) && String(c.estatus || '').toLowerCase() !== 'cumplido'
    ).length;
    return { asistentes, agenda, compromisos, pendientes };
  }

  get sgcF16MinutasVista(): SgcF16Minuta[] {
    const q = this.sgcF16Busqueda.trim().toLowerCase();
    const lista = [...(this.sgcF16Form.minutas || [])].sort((a, b) => {
      const fa = String(a.fechaVisita || '');
      const fb = String(b.fechaVisita || '');
      return fb.localeCompare(fa) || String(b.folio || '').localeCompare(String(a.folio || ''));
    });
    if (!q) {
      return lista;
    }
    return lista.filter((m) =>
      [m.folio, m.asunto, m.lugar, m.fechaVisita, m.notasTomadasPor]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  minutaCerradaSgcF16(minuta: SgcF16Minuta | null | undefined): boolean {
    return !!minuta?.pdfFirmado?.driveFileId;
  }

  formatearFechaCortaSgcF16(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    return String(iso);
  }

  claseEstatusSgcF16(estatus: string): string {
    const t = String(estatus || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t === 'cumplido') {
      return 'sgc-f-16-estatus--ok';
    }
    if (t === 'en proceso') {
      return 'sgc-f-16-estatus--proceso';
    }
    return 'sgc-f-16-estatus--pendiente';
  }

  onSgcF16Editado(): void {
    if (!this.sgcF16Listo || this.sgcF16IgnorarAutoSave) {
      return;
    }
    this.sgcF16CambiosPendientes = true;
  }

  /** Genera folio MN-DDMMAA-NN contra todas las minutas del archivero. */
  generarFolioSgcF16(): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    const baseFecha = this.sgcF16MinutaActiva.fechaVisita || new Date().toISOString().slice(0, 10);
    const d = new Date(`${baseFecha}T12:00:00`);
    const fecha = Number.isNaN(d.getTime()) ? new Date() : d;
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const aa = String(fecha.getFullYear()).slice(-2);
    const fechaTag = `${dd}${mm}${aa}`;
    if (!this.sgcF16MinutaActiva.fechaVisita) {
      this.sgcF16MinutaActiva.fechaVisita = `${fecha.getFullYear()}-${mm}-${dd}`;
    }
    let maximo = 0;
    (this.sgcF16Form.minutas || []).forEach((m) => {
      if (m.id === this.sgcF16MinutaActiva?.id) {
        return;
      }
      const match = String(m.folio || '').match(/^MN-(\d{6})-(\d{1,})$/i);
      if (match && match[1] === fechaTag) {
        const n = parseInt(match[2], 10);
        if (Number.isFinite(n) && n > maximo) {
          maximo = n;
        }
      }
    });
    this.sgcF16MinutaActiva.folio = `MN-${fechaTag}-${String(maximo + 1).padStart(2, '0')}`;
    this.onSgcF16Editado();
  }

  nuevaMinutaSgcF16(): void {
    const minuta = this.crearMinutaSgcF16Vacia();
    const hoy = new Date();
    minuta.fechaVisita = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(hoy);
    this.sgcF16Form.minutas = [minuta, ...(this.sgcF16Form.minutas || [])];
    this.sgcF16MinutaActiva = minuta;
    this.sgcF16Form.minutaActivaId = minuta.id;
    this.sgcF16Vista = 'editor';
    this.cerrarComboAsistSgcF16();
    this.generarFolioSgcF16();
    this.onSgcF16Editado();
  }

  abrirMinutaSgcF16(minuta: SgcF16Minuta): void {
    this.sgcF16MinutaActiva = minuta;
    this.sgcF16Form.minutaActivaId = minuta?.id || null;
    this.sgcF16Vista = 'editor';
    this.cerrarComboAsistSgcF16();
  }

  volverArchiveroSgcF16(): void {
    this.sgcF16Vista = 'archivero';
    this.sgcF16MinutaActiva = null;
    this.sgcF16Form.minutaActivaId = null;
    this.cerrarComboAsistSgcF16();
    if (this.mostrarSgcF16PdfViewer) {
      this.toggleSgcF16PdfViewer();
    }
  }

  eliminarMinutaSgcF16(minuta: SgcF16Minuta, event?: Event): void {
    event?.stopPropagation();
    if (!confirm(`¿Eliminar la minuta ${minuta.folio || 'sin folio'}?`)) {
      return;
    }
    this.sgcF16Form.minutas = (this.sgcF16Form.minutas || []).filter((m) => m.id !== minuta.id);
    if (this.sgcF16MinutaActiva?.id === minuta.id) {
      this.volverArchiveroSgcF16();
    }
    this.onSgcF16Editado();
  }

  agregarAsistenteSgcF16(): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    this.sgcF16MinutaActiva.asistentes.push(this.crearAsistenteSgcF16Vacio());
    this.onSgcF16Editado();
  }

  quitarAsistenteSgcF16(index: number): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    if (this.sgcF16MinutaActiva.asistentes.length <= 1) {
      this.sgcF16MinutaActiva.asistentes.splice(0, 1, this.crearAsistenteSgcF16Vacio());
    } else {
      this.sgcF16MinutaActiva.asistentes.splice(index, 1);
    }
    this.onSgcF16Editado();
  }

  agregarAgendaSgcF16(): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    this.sgcF16MinutaActiva.agenda.push(this.crearAgendaSgcF16Vacia());
    this.onSgcF16Editado();
  }

  quitarAgendaSgcF16(index: number): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    if (this.sgcF16MinutaActiva.agenda.length <= 1) {
      this.sgcF16MinutaActiva.agenda.splice(0, 1, this.crearAgendaSgcF16Vacia());
    } else {
      this.sgcF16MinutaActiva.agenda.splice(index, 1);
    }
    this.onSgcF16Editado();
  }

  agregarCompromisoSgcF16(): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    this.sgcF16MinutaActiva.compromisos.push(this.crearCompromisoSgcF16Vacio());
    this.onSgcF16Editado();
  }

  quitarCompromisoSgcF16(index: number): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    if (this.sgcF16MinutaActiva.compromisos.length <= 1) {
      this.sgcF16MinutaActiva.compromisos.splice(0, 1, this.crearCompromisoSgcF16Vacio());
    } else {
      this.sgcF16MinutaActiva.compromisos.splice(index, 1);
    }
    this.onSgcF16Editado();
  }

  private cargarSgcF16DesdeServidor(): void {
    this.sgcF16Cargando = true;
    this.sgcF16Listo = false;
    this.sgcF16Vista = 'archivero';
    this.backendService.cargarSgcF16Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF16(res),
        error: () => {
          this.sgcF16Cargando = false;
          this.sgcF16Listo = true;
        }
      });
  }

  private persistirSgcF16(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF16Listo || this.sgcF16Guardando) {
      return;
    }
    this.sgcF16Guardando = true;
    const editorAbierto = this.mostrarSgcF16Editor;
    const activa = this.sgcF16MinutaActiva;
    this.backendService.guardarSgcF16Formato(
      { ...this.sgcF16Form, minutaActivaId: activa?.id || null },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF16Guardando = false;
          this.aplicarEstadoSgcF16(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF16Guardando = false;
        }
      });
  }

  descargarPdfSgcF16(): void {
    if (this.sgcF16DescargandoPdf) {
      return;
    }
    this.sgcF16DescargandoPdf = true;
    this.backendService.descargarPdfSgcF16()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.sgcF16DescargandoPdf = false;
          const url = URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = 'SGC-F-16 Minuta.pdf';
          enlace.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.sgcF16DescargandoPdf = false;
        }
      });
  }

  onSeleccionarPdfSgcF16(event: Event): void {
    if (!this.sgcF16MinutaActiva) {
      return;
    }
    const folio = this.sgcF16MinutaActiva.folio || 'sin-folio';
    this.procesarPdfDocumento(
      event,
      `SGC-F-16 ${folio}.pdf`,
      (base64, nombre) => this.subirPdfFirmadoSgcF16(base64, nombre)
    );
  }

  private subirPdfFirmadoSgcF16(pdfBase64: string, nombreArchivo: string): void {
    if (this.sgcF16SubiendoPdf || !this.sgcF16MinutaActiva) {
      return;
    }
    this.sgcF16SubiendoPdf = true;
    this.backendService.subirPdfFirmadoSgcF16(pdfBase64, nombreArchivo, this.sgcF16MinutaActiva.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF16SubiendoPdf = false;
          this.aplicarEstadoSgcF16(res);
          if (this.sgcF16MinutaActiva && res?.pdfFirmado) {
            this.sgcF16MinutaActiva.pdfFirmado = this.sanitizarPdfSgcF16(res.pdfFirmado);
          }
        },
        error: () => {
          this.sgcF16SubiendoPdf = false;
        }
      });
  }

  toggleSgcF16PdfViewer(): void {
    const id = this.sgcF16MinutaActiva?.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }
    const abrir = !this.mostrarSgcF16PdfViewer;
    this.mostrarSgcF16PdfViewer = abrir;
    if (abrir) {
      this.sgcF16PdfCargando = true;
      const url = this.sgcF16MinutaActiva?.pdfFirmado?.previewUrl
        || `https://drive.google.com/file/d/${id}/preview`;
      this.sgcF16PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.sgcF16PdfEmbedUrlSafe = null;
    this.sgcF16PdfCargando = false;
  }

  onSgcF16PdfIframeLoad(): void {
    this.sgcF16PdfCargando = false;
  }

  toggleSgcF16Editor(): void {
    if (!this.sgcF16DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF16Editor;
    this.mostrarSgcF16Editor = abrir;
    if (abrir) {
      this.sgcF16EditorIframeListo = false;
      this.sgcF16EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF16(this.resolverUrlEditorDrive(this.sgcF16EditorUrl, this.sgcF16DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF16IframeLoad(): void {
    if (this.sgcF16EditorIframeListo) {
      return;
    }
    this.sgcF16EditorIframeListo = true;
    this.sgcF16EditorCargando = false;
  }

  actualizarPlantillaSgcF16(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF16ActualizandoPlantilla) {
      return;
    }
    this.sgcF16ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF16()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF16ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF16(res, false, false, true);
        },
        error: () => {
          this.sgcF16ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF16(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF16Editor && this.sgcF16EditorEmbedUrlSafe && this.sgcF16EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF16EditorUrl = null;
      this.sgcF16EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF16EditorUrl === url && this.sgcF16EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF16EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF16EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private sincronizarMinutaActivaSgcF16(activoId: string | null, conservarEditorSiExiste: boolean): void {
    if (!activoId) {
      this.sgcF16MinutaActiva = null;
      this.sgcF16Form.minutaActivaId = null;
      if (!conservarEditorSiExiste) {
        this.sgcF16Vista = 'archivero';
      }
      return;
    }
    const encontrada = (this.sgcF16Form.minutas || []).find((m) => m.id === activoId) || null;
    this.sgcF16MinutaActiva = encontrada;
    this.sgcF16Form.minutaActivaId = encontrada?.id || null;
    if (conservarEditorSiExiste && encontrada) {
      this.sgcF16Vista = 'editor';
    } else {
      this.sgcF16Vista = 'archivero';
      if (!encontrada) {
        this.sgcF16MinutaActiva = null;
        this.sgcF16Form.minutaActivaId = null;
      } else if (!conservarEditorSiExiste) {
        this.sgcF16MinutaActiva = null;
        this.sgcF16Form.minutaActivaId = null;
      }
    }
  }

  private aplicarEstadoSgcF16(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF16Cargando = false;
      }
      this.sgcF16Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF16Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;
    const activoId = this.sgcF16MinutaActiva?.id || null;
    const conservarEditor = this.sgcF16Vista === 'editor' && !!activoId;

    if (!bloquearFormulario && res.datos) {
      this.sgcF16IgnorarAutoSave = true;
      this.sgcF16Listo = false;
      this.sgcF16Form = this.normalizarSgcF16Form(res.datos);
      this.sincronizarMinutaActivaSgcF16(activoId, conservarEditor);
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF16IgnorarAutoSave = true;
      this.sgcF16Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF16DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF16Editor)) {
        this.fijarEditorEmbedUrlSgcF16(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF16UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF16ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF16IgnorarAutoSave = false;
      this.sgcF16Listo = true;
      if (!bloquearFormulario) {
        this.sgcF16CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF16Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  // ===================== SGC-F-29 · Evaluación de proveedores =====================

  private crearSgcF29FormVacio(): SgcF29FormData {
    return {
      fechaElaboracion: '',
      periodoEvaluacion: '',
      fechaEvaluacion: this.fechaHoyIsoLocalSgcF29(),
      proveedores: []
    };
  }

  private fechaHoyIsoLocalSgcF29(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  }

  private formatearFechaIsoSgcF29(valor: unknown): string {
    const crudo = String(valor || '').trim();
    if (!crudo) {
      return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(crudo)) {
      return crudo;
    }
    const m = crudo.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      let y = m[3];
      if (y.length === 2) {
        y = `20${y}`;
      }
      return `${y}-${mo}-${d}`;
    }
    return '';
  }

  etiquetaFechaCortaSgcF29(iso: string): string {
    const v = this.formatearFechaIsoSgcF29(iso);
    if (!v) {
      return '—';
    }
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }

  private etiquetaMesSgcF29(valor: string): string {
    const mes = this.sgcF29Meses.find((m) => m.valor === String(valor));
    return mes?.etiqueta || '';
  }

  private resolverValorMesSgcF29(texto: string): string {
    const t = String(texto || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!t) {
      return '';
    }
    const hit = this.sgcF29Meses.find((m) => {
      const et = m.etiqueta.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const co = m.corto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return t === et || t === co || t.startsWith(co);
    });
    return hit?.valor || '';
  }

  private sincronizarSelectsPeriodoSgcF29(periodo: string): void {
    this.sgcF29PeriodoAnio = String(new Date().getFullYear());
    const texto = String(periodo || '').trim();
    if (!texto) {
      this.sgcF29PeriodoMesInicio = '';
      this.sgcF29PeriodoMesFin = '';
      return;
    }
    const anioMatch = texto.match(/(20\d{2})/);
    if (anioMatch) {
      this.sgcF29PeriodoAnio = anioMatch[1];
    }
    const sinAnio = texto.replace(/(20\d{2})/g, '').trim();
    const partes = sinAnio.split(/\s*[-–—aA]\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2) {
      this.sgcF29PeriodoMesInicio = this.resolverValorMesSgcF29(partes[0]);
      this.sgcF29PeriodoMesFin = this.resolverValorMesSgcF29(partes[1]);
    } else if (partes.length === 1) {
      this.sgcF29PeriodoMesInicio = this.resolverValorMesSgcF29(partes[0]);
      this.sgcF29PeriodoMesFin = this.sgcF29PeriodoMesInicio;
    } else {
      this.sgcF29PeriodoMesInicio = '';
      this.sgcF29PeriodoMesFin = '';
    }
  }

  private componerPeriodoEvaluacionSgcF29(): string {
    const inicio = this.etiquetaMesSgcF29(this.sgcF29PeriodoMesInicio);
    const fin = this.etiquetaMesSgcF29(this.sgcF29PeriodoMesFin);
    const anio = this.sgcF29PeriodoAnio || String(new Date().getFullYear());
    if (!inicio && !fin) {
      return '';
    }
    if (inicio && fin) {
      return `${inicio} – ${fin} ${anio}`;
    }
    return `${inicio || fin} ${anio}`;
  }

  onPeriodoMesesSgcF29Change(): void {
    this.sgcF29Form.periodoEvaluacion = this.componerPeriodoEvaluacionSgcF29();
    this.sgcF29Form.fechaEvaluacion = this.fechaHoyIsoLocalSgcF29();
    this.onSgcF29Editado();
  }

  get etiquetaFechaEvaluacionSgcF29(): string {
    const iso = this.sgcF29Form?.fechaEvaluacion || this.fechaHoyIsoLocalSgcF29();
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) {
      return iso;
    }
    return `${d}/${m}/${y}`;
  }

  private crearFilaProveedorSgcF29Vacia(): SgcF29ProveedorItem {
    return {
      id: this.generarIdEvaluacionSgcF29(),
      proveedor: '',
      referencia: '',
      fecha: this.fechaHoyIsoLocalSgcF29(),
      entregaTiempo: '',
      entregaDomicilio: '',
      precio: '',
      pagoTransferencia: '',
      servicio: '',
      calidad: '',
      calificacion: ''
    };
  }

  private generarIdEvaluacionSgcF29(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `f29-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private criteriosPuntajeSgcF29(fila: SgcF29ProveedorItem): string[] {
    return [
      fila.entregaTiempo,
      fila.entregaDomicilio,
      fila.precio,
      fila.pagoTransferencia,
      fila.servicio,
      fila.calidad
    ];
  }

  private parsearPuntajeSgcF29(valor: unknown): string {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) {
      return '';
    }
    let n = Number(crudo);
    if (!Number.isFinite(n)) {
      return '';
    }
    if (n > 0 && n <= 1) {
      n = n * 100;
    }
    n = Math.round(n);
    const permitidos = [0, 25, 50, 75, 100];
    if (permitidos.includes(n)) {
      return String(n);
    }
    let mejor = 0;
    let dist = Math.abs(n - 0);
    for (const p of permitidos) {
      const d = Math.abs(n - p);
      if (d < dist) {
        dist = d;
        mejor = p;
      }
    }
    return String(mejor);
  }

  etiquetaPuntajeSgcF29(valor: string): string {
    const item = this.sgcF29Puntajes.find((p) => p.valor === String(valor));
    return item ? `${item.valor}% · ${item.criterio}` : (valor ? `${valor}%` : '—');
  }

  descripcionCriterioSgcF29(
    campo: 'entrega' | 'entregaDomicilio' | 'precio' | 'pagoTransferencia' | 'servicio' | 'calidad',
    valor: string
  ): string {
    const item = this.sgcF29Puntajes.find((p) => p.valor === String(valor));
    if (!item) {
      return '';
    }
    return item[campo];
  }

  tituloColumnaCriterioSgcF29(
    campo: 'entrega' | 'entregaDomicilio' | 'precio' | 'pagoTransferencia' | 'servicio' | 'calidad'
  ): string {
    return this.sgcF29Puntajes
      .map((p) => `${p.valor}% (${p.criterio}): ${p[campo]}`)
      .join('\n');
  }

  toggleTipSgcF06(campo: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.sgcF06TipAbierto = this.sgcF06TipAbierto === campo ? null : campo;
  }

  cerrarTipSgcF06(): void {
    this.sgcF06TipAbierto = null;
  }

  toggleTipSgcF29(campo: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.sgcF29TipAbierto = this.sgcF29TipAbierto === campo ? null : campo;
  }

  cerrarTipSgcF29(): void {
    this.sgcF29TipAbierto = null;
  }

  recalcularCalificacionSgcF29(index: number): void {
    const fila = this.sgcF29Form.proveedores[index];
    if (!fila) {
      return;
    }
    fila.entregaTiempo = this.parsearPuntajeSgcF29(fila.entregaTiempo);
    fila.entregaDomicilio = this.parsearPuntajeSgcF29(fila.entregaDomicilio);
    fila.precio = this.parsearPuntajeSgcF29(fila.precio);
    fila.pagoTransferencia = this.parsearPuntajeSgcF29(fila.pagoTransferencia);
    fila.servicio = this.parsearPuntajeSgcF29(fila.servicio);
    fila.calidad = this.parsearPuntajeSgcF29(fila.calidad);
    const vals = this.criteriosPuntajeSgcF29(fila)
      .map((v) => this.parsearPuntajeSgcF29(v))
      .filter((v) => v !== '')
      .map(Number);
    fila.calificacion = vals.length
      ? String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))
      : '';
    this.onSgcF29Editado();
  }

  calificacionReprobadaSgcF29(valor: string): boolean {
    // El promedio puede ser cualquier entero (p. ej. 83); no usar parsearPuntajeSgcF29,
    // que redondea a la escala de criterios 0/25/50/75/100 y marcaría 83 como 75 (rojo).
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    const n = Number(crudo);
    return Number.isFinite(n) && n > 0 && n < 80;
  }

  private normalizarSgcF29Form(datos: Partial<SgcF29FormData> | null | undefined): SgcF29FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    const items = Array.isArray(base.proveedores) ? base.proveedores : [];
    const fechaHoy = this.fechaHoyIsoLocalSgcF29();
    const form: SgcF29FormData = {
      fechaElaboracion: String(base.fechaElaboracion || '').trim(),
      periodoEvaluacion: String(base.periodoEvaluacion || '').trim(),
      fechaEvaluacion: fechaHoy,
      proveedores: items.map((item) => {
        const fila: SgcF29ProveedorItem = {
          id: String(item?.id || '').trim() || this.generarIdEvaluacionSgcF29(),
          proveedor: String(item?.proveedor || '').trim(),
          referencia: String(item?.referencia || '').trim(),
          fecha: this.formatearFechaIsoSgcF29(item?.fecha) || fechaHoy,
          entregaTiempo: this.parsearPuntajeSgcF29(item?.entregaTiempo),
          entregaDomicilio: this.parsearPuntajeSgcF29(item?.entregaDomicilio),
          precio: this.parsearPuntajeSgcF29(item?.precio),
          pagoTransferencia: this.parsearPuntajeSgcF29(item?.pagoTransferencia),
          servicio: this.parsearPuntajeSgcF29(item?.servicio),
          calidad: this.parsearPuntajeSgcF29(item?.calidad),
          calificacion: ''
        };
        const vals = this.criteriosPuntajeSgcF29(fila)
          .filter((v) => v !== '')
          .map(Number);
        if (vals.length) {
          fila.calificacion = String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
        }
        return fila;
      })
    };
    this.sincronizarSelectsPeriodoSgcF29(form.periodoEvaluacion);
    if (!form.periodoEvaluacion && (this.sgcF29PeriodoMesInicio || this.sgcF29PeriodoMesFin)) {
      form.periodoEvaluacion = this.componerPeriodoEvaluacionSgcF29();
    }
    return form;
  }

  /** Completa filas 3–12 con proveedores demo (una sola vez al cargar si faltan). */
  private sembrarProveedoresExtraSgcF29SiFaltan(): void {
    const actuales = this.sgcF29Form?.proveedores || [];
    if (actuales.length === 0 || actuales.length >= 12) {
      return;
    }
    const faltan = 12 - actuales.length;
    const extras = this.sgcF29ProveedoresDemoExtra.slice(0, faltan).map((demo) => {
      const fila: SgcF29ProveedorItem = {
        ...this.crearFilaProveedorSgcF29Vacia(),
        ...demo,
        calificacion: ''
      };
      const vals = this.criteriosPuntajeSgcF29(fila)
        .filter((v) => v !== '')
        .map(Number);
      fila.calificacion = vals.length
        ? String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))
        : '';
      return fila;
    });
    this.sgcF29Form.proveedores = [...actuales, ...extras];
    this.sgcF29CambiosPendientes = true;
  }

  private cargarSgcF29DesdeServidor(): void {
    this.sgcF29Cargando = true;
    this.sgcF29Listo = false;
    this.backendService.cargarSgcF29Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF29(res),
        error: () => {
          this.sgcF29Cargando = false;
          this.sgcF29Listo = true;
        }
      });
  }

  onSgcF29Editado(): void {
    if (!this.sgcF29Listo || this.sgcF29IgnorarAutoSave) {
      return;
    }
    this.sgcF29CambiosPendientes = true;
  }

  agregarFilaProveedorSgcF29(): void {
    if (this.sgcF29Form.proveedores.length >= 12) {
      return;
    }
    this.sgcF29Form.proveedores.push(this.crearFilaProveedorSgcF29Vacia());
    this.onSgcF29Editado();
  }

  get sgcF29GruposVista(): SgcF29GrupoVista[] {
    const lista = this.sgcF29Form?.proveedores || [];
    const orden: string[] = [];
    const mapa = new Map<string, number[]>();
    lista.forEach((fila, idx) => {
      const nombre = String(fila.proveedor || '').trim();
      const clave = nombre
        ? nombre.toLowerCase()
        : `__idx_${idx}`;
      if (!mapa.has(clave)) {
        mapa.set(clave, []);
        orden.push(clave);
      }
      mapa.get(clave)!.push(idx);
    });
    return orden.map((clave) => {
      const indices = mapa.get(clave) || [];
      const primero = lista[indices[0]];
      return {
        clave,
        proveedor: primero?.proveedor || '',
        indices,
        multiple: indices.length > 1
      };
    });
  }

  toggleGrupoSgcF29(clave: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.sgcF29GruposExpandidos = {
      ...this.sgcF29GruposExpandidos,
      [clave]: !this.sgcF29GruposExpandidos[clave]
    };
  }

  esGrupoExpandidoSgcF29(clave: string): boolean {
    return !!this.sgcF29GruposExpandidos[clave];
  }

  filaSgcF29(index: number): SgcF29ProveedorItem | null {
    return this.sgcF29Form.proveedores[index] || null;
  }

  promedioGrupoSgcF29(indices: number[]): string {
    const vals = indices
      .map((i) => Number(this.sgcF29Form.proveedores[i]?.calificacion))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!vals.length) {
      return '';
    }
    return String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
  }

  onNombreGrupoSgcF29Change(grupo: SgcF29GrupoVista, nombre: string): void {
    const limpio = String(nombre || '');
    for (const idx of grupo.indices) {
      const fila = this.sgcF29Form.proveedores[idx];
      if (fila) {
        fila.proveedor = limpio;
      }
    }
    this.onSgcF29Editado();
  }

  /** Nueva evaluación del mismo proveedor (otro contrato/servicio). */
  reevaluarProveedorSgcF29(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.sgcF29Form.proveedores.length >= 12) {
      return;
    }
    const origen = this.sgcF29Form.proveedores[index];
    if (!origen?.proveedor?.trim()) {
      return;
    }
    const n = this.conteoEvaluacionesProveedorSgcF29(origen.proveedor);
    const nueva = this.crearFilaProveedorSgcF29Vacia();
    nueva.proveedor = origen.proveedor.trim();
    nueva.referencia = `Evaluación ${n + 1}`;
    nueva.fecha = this.fechaHoyIsoLocalSgcF29();
    this.sgcF29Form.proveedores.splice(index + 1, 0, nueva);
    const clave = nueva.proveedor.toLowerCase();
    this.sgcF29GruposExpandidos = { ...this.sgcF29GruposExpandidos, [clave]: true };
    this.onSgcF29Editado();
  }

  reevaluarGrupoSgcF29(grupo: SgcF29GrupoVista, event?: Event): void {
    const ultimo = grupo.indices[grupo.indices.length - 1];
    this.reevaluarProveedorSgcF29(ultimo, event);
  }

  conteoEvaluacionesProveedorSgcF29(nombre: string): number {
    const clave = String(nombre || '').trim().toLowerCase();
    if (!clave) {
      return 0;
    }
    return (this.sgcF29Form.proveedores || []).filter(
      (p) => String(p.proveedor || '').trim().toLowerCase() === clave
    ).length;
  }

  etiquetaEvaluacionSgcF29(fila: SgcF29ProveedorItem, index: number): string {
    if (fila.referencia?.trim()) {
      return fila.referencia.trim();
    }
    const total = this.conteoEvaluacionesProveedorSgcF29(fila.proveedor);
    if (total <= 1) {
      return '';
    }
    const clave = String(fila.proveedor || '').trim().toLowerCase();
    let n = 0;
    for (let i = 0; i <= index; i++) {
      const p = this.sgcF29Form.proveedores[i];
      if (String(p?.proveedor || '').trim().toLowerCase() === clave) {
        n++;
      }
    }
    return `Evaluación ${n}`;
  }

  quitarFilaProveedorSgcF29(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.sgcF29Form.proveedores.length <= 1) {
      this.sgcF29Form.proveedores.splice(0, 1, this.crearFilaProveedorSgcF29Vacia());
    } else {
      this.sgcF29Form.proveedores.splice(index, 1);
    }
    this.onSgcF29Editado();
  }

  abrirEvidenciasSgcF29(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const fila = this.sgcF29Form.proveedores[index];
    if (!fila) {
      return;
    }
    if (!fila.id) {
      fila.id = this.generarIdEvaluacionSgcF29();
      this.onSgcF29Editado();
    }
    if (!fila.fecha) {
      fila.fecha = this.fechaHoyIsoLocalSgcF29();
    }
    this.sgcF29EvidenciasIdx = index;
    this.sgcF29EvidenciasModalAbierto = true;
    this.sgcF29EvidenciasFiltro = 'todo';
    this.sgcF29EvidenciasBusqueda = '';
    this.cargarEvidenciasSgcF29();
  }

  cerrarEvidenciasSgcF29(): void {
    this.sgcF29EvidenciasModalAbierto = false;
    this.sgcF29EvidenciasIdx = null;
    this.sgcF29EvidenciasDocs = [];
    this.sgcF29EvidenciasCargando = false;
    this.sgcF29EvidenciasSubiendo = false;
  }

  get sgcF29EvidenciasFila(): SgcF29ProveedorItem | null {
    if (this.sgcF29EvidenciasIdx == null) {
      return null;
    }
    return this.sgcF29Form.proveedores[this.sgcF29EvidenciasIdx] || null;
  }

  get sgcF29EvidenciasDocsFiltrados(): SgcF29EvidenciaDoc[] {
    const q = this.sgcF29EvidenciasBusqueda.trim().toLowerCase();
    return (this.sgcF29EvidenciasDocs || []).filter((d) => {
      if (q && !String(d.nombreArchivo || d.titulo || '').toLowerCase().includes(q)) {
        return false;
      }
      const mime = String(d.mimeType || '').toLowerCase();
      if (this.sgcF29EvidenciasFiltro === 'pdf') {
        return mime.includes('pdf');
      }
      if (this.sgcF29EvidenciasFiltro === 'img') {
        return mime.startsWith('image/');
      }
      if (this.sgcF29EvidenciasFiltro === 'docs') {
        return !mime.includes('pdf') && !mime.startsWith('image/');
      }
      return true;
    });
  }

  get sgcF29EvidenciasTotalBytes(): number {
    return (this.sgcF29EvidenciasDocs || []).reduce((s, d) => s + (d.tamanoBytes || 0), 0);
  }

  conteoTipoEvidenciaSgcF29(tipo: 'todo' | 'pdf' | 'docs' | 'img'): number {
    const docs = this.sgcF29EvidenciasDocs || [];
    if (tipo === 'todo') return docs.length;
    return docs.filter((d) => {
      const mime = String(d.mimeType || '').toLowerCase();
      if (tipo === 'pdf') return mime.includes('pdf');
      if (tipo === 'img') return mime.startsWith('image/');
      return !mime.includes('pdf') && !mime.startsWith('image/');
    }).length;
  }

  conteoEvidenciasFilaSgcF29(fila: SgcF29ProveedorItem): number {
    if (!fila?.id) return 0;
    return this.sgcF29EvidenciasConteos[fila.id] || 0;
  }

  private refrescarConteosEvidenciasSgcF29(): void {
    const ids = (this.sgcF29Form.proveedores || []).map((p) => p.id).filter(Boolean);
    if (!ids.length) {
      this.sgcF29EvidenciasConteos = {};
      return;
    }
    this.backendService.contarEvidenciasSgcF29(ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF29EvidenciasConteos = res?.conteos || {};
        },
        error: () => { /* silencioso */ }
      });
  }

  private cargarEvidenciasSgcF29(): void {
    const fila = this.sgcF29EvidenciasFila;
    if (!fila?.id) {
      return;
    }
    this.sgcF29EvidenciasCargando = true;
    this.backendService.listarEvidenciasSgcF29(fila.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF29EvidenciasCargando = false;
          this.sgcF29EvidenciasDocs = Array.isArray(res?.documentos) ? res.documentos : [];
          this.sgcF29EvidenciasConteos = {
            ...this.sgcF29EvidenciasConteos,
            [fila.id]: this.sgcF29EvidenciasDocs.length
          };
        },
        error: () => {
          this.sgcF29EvidenciasCargando = false;
          this.sgcF29EvidenciasDocs = [];
        }
      });
  }

  onEvidenciasInputSgcF29(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input?.files ? Array.from(input.files) : [];
    input.value = '';
    void this.subirArchivosEvidenciaSgcF29(files);
  }

  onEvidenciasDropSgcF29(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.sgcF29EvidenciasDragDepth = 0;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    void this.subirArchivosEvidenciaSgcF29(files);
  }

  onEvidenciasDragOverSgcF29(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onEvidenciasDragEnterSgcF29(event: DragEvent): void {
    event.preventDefault();
    this.sgcF29EvidenciasDragDepth++;
  }

  onEvidenciasDragLeaveSgcF29(event: DragEvent): void {
    event.preventDefault();
    this.sgcF29EvidenciasDragDepth = Math.max(0, this.sgcF29EvidenciasDragDepth - 1);
  }

  private async subirArchivosEvidenciaSgcF29(files: File[]): Promise<void> {
    const fila = this.sgcF29EvidenciasFila;
    if (!fila?.id || !files.length || this.sgcF29EvidenciasSubiendo) {
      return;
    }
    this.sgcF29EvidenciasSubiendo = true;
    try {
      const archivos: Array<{ nombre_archivo: string; mime_type?: string; archivo_base64: string }> = [];
      for (const file of files.slice(0, 20)) {
        const base64 = await this.archivoABase64SgcF29(file);
        if (!base64) continue;
        archivos.push({
          nombre_archivo: file.name,
          mime_type: file.type || undefined,
          archivo_base64: base64
        });
      }
      if (!archivos.length) {
        this.sgcF29EvidenciasSubiendo = false;
        return;
      }
      this.backendService.subirEvidenciasLoteSgcF29({
        evaluacion_id: fila.id,
        proveedor: fila.proveedor,
        referencia: fila.referencia,
        archivos
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.sgcF29EvidenciasSubiendo = false;
          this.cargarEvidenciasSgcF29();
        },
        error: () => {
          this.sgcF29EvidenciasSubiendo = false;
        }
      });
    } catch {
      this.sgcF29EvidenciasSubiendo = false;
    }
  }

  private archivoABase64SgcF29(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultado = String(reader.result || '');
        const base64 = resultado.includes(',') ? resultado.split(',')[1] : '';
        resolve(base64 || '');
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  eliminarEvidenciaSgcF29(doc: SgcF29EvidenciaDoc, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!doc?.id || this.sgcF29EvidenciasSubiendo) {
      return;
    }
    this.backendService.eliminarEvidenciaSgcF29(doc.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.cargarEvidenciasSgcF29(),
        error: () => { /* silencioso */ }
      });
  }

  abrirArchivoEvidenciaSgcF29(doc: SgcF29EvidenciaDoc, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (doc?.webViewLink) {
      window.open(doc.webViewLink, '_blank', 'noopener');
      return;
    }
    if (doc?.id) {
      window.open(this.backendService.urlArchivoEvidenciaSgcF29(doc.id), '_blank', 'noopener');
    }
  }

  formatearTamanoSgcF29(bytes: number | null | undefined): string {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  iconoMimeEvidenciaSgcF29(mime: string): string {
    const m = String(mime || '').toLowerCase();
    if (m.includes('pdf')) return 'fa-file-pdf';
    if (m.startsWith('image/')) return 'fa-file-image';
    if (m.includes('sheet') || m.includes('excel')) return 'fa-file-excel';
    if (m.includes('word')) return 'fa-file-word';
    if (m.includes('powerpoint') || m.includes('presentation')) return 'fa-file-powerpoint';
    return 'fa-file';
  }

  private sincronizarSgcF29DesdeDrive(): void {
    if (this.sgcF29Guardando) {
      return;
    }
    this.sgcF29Guardando = true;
    this.backendService.sincronizarSgcF29DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF29Guardando = false;
          this.aplicarEstadoSgcF29(res, false, false);
        },
        error: () => {
          this.sgcF29Guardando = false;
        }
      });
  }

  private persistirSgcF29(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF29Listo || this.sgcF29Guardando) {
      return;
    }
    this.sgcF29Form.periodoEvaluacion = this.componerPeriodoEvaluacionSgcF29();
    this.sgcF29Form.fechaEvaluacion = this.fechaHoyIsoLocalSgcF29();
    this.sgcF29Guardando = true;
    const editorAbierto = this.mostrarSgcF29Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF29Formato(this.sgcF29Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF29Guardando = false;
          this.aplicarEstadoSgcF29(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF29Guardando = false;
        }
      });
  }

  toggleSgcF29Editor(): void {
    if (!this.sgcF29DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF29Editor;
    this.mostrarSgcF29Editor = abrir;
    if (abrir) {
      this.sgcF29EditorIframeListo = false;
      this.sgcF29EditorCargando = true;
      const url = this.resolverUrlEditorDrive(this.sgcF29EditorUrl, this.sgcF29DriveFileId);
      this.fijarEditorEmbedUrlSgcF29(url, true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF29IframeLoad(): void {
    if (this.sgcF29EditorIframeListo) {
      return;
    }
    this.sgcF29EditorIframeListo = true;
    this.sgcF29EditorCargando = false;
  }

  actualizarPlantillaSgcF29(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF29ActualizandoPlantilla) {
      return;
    }
    this.sgcF29ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF29()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF29ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF29(res, false, false, true);
        },
        error: () => {
          this.sgcF29ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF29(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF29Editor && this.sgcF29EditorEmbedUrlSafe && this.sgcF29EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF29EditorUrl = null;
      this.sgcF29EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF29EditorUrl === url && this.sgcF29EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF29EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF29EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF29(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF29Cargando = false;
      }
      this.sgcF29Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF29Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    let sembrarExtras = false;
    if (!bloquearFormulario && res.datos) {
      this.sgcF29IgnorarAutoSave = true;
      this.sgcF29Form = this.normalizarSgcF29Form(res.datos);
      // Si solo quedan 1–2 filas (p. ej. se borraron 3–12), reponer demo y persistir.
      sembrarExtras = !sincronizacionSilenciosa
        && this.sgcF29Form.proveedores.length > 0
        && this.sgcF29Form.proveedores.length <= 2;
      if (sembrarExtras) {
        this.sembrarProveedoresExtraSgcF29SiFaltan();
      }
      setTimeout(() => {
        this.sgcF29IgnorarAutoSave = false;
      }, 0);
    }

    this.sgcF29DriveFileId = res.driveFileId || null;
    this.sgcF29UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF29ContenidoModificado = !!res.contenidoModificado;
    if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF29Editor)) {
      this.fijarEditorEmbedUrlSgcF29(res.editorUrl, forzarActualizacionDrive);
    }

    this.sgcF29Listo = true;
    this.sgcF29CambiosPendientes = sembrarExtras;
    if (!sincronizacionSilenciosa) {
      this.sgcF29Cargando = false;
    }
    if (!bloquearFormulario) {
      this.refrescarConteosEvidenciasSgcF29();
    }
  }

  get sgcF29IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-29') {
      return '';
    }
    return 'Evalúa proveedores en el formulario del sistema. El Excel es representación visual e historial (bitácora). Usa «Guardar información» para volcar al Excel; el editor integrado solo sirve para corregir errores puntuales en el archivo.';
  }

  // ===================== SGC-F-28 · Comparativa de proveedores =====================

  private nuevoIdSgcF28(): string {
    try {
      return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `f28-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    } catch {
      return `f28-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
  }

  private fechaHoyIsoLocalSgcF28(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  }

  private crearValorSgcF28(tipo: SgcF28CriterioTipo = 'caracteristicas'): SgcF28ValorProveedor {
    return { texto: '', numero: null, moneda: 'MXN', imagen: null };
  }

  private crearProveedorSgcF28Vacio(): SgcF28Proveedor {
    return {
      nombre: '',
      procesoProductoServicio: '',
      fechaCotizacion: '',
      resultado: '',
      observaciones: ''
    };
  }

  private crearCriterioSgcF28(tipo: SgcF28CriterioTipo, etiqueta?: string): SgcF28Criterio {
    const def = this.sgcF28TiposCriterio.find((t) => t.tipo === tipo);
    return {
      id: this.nuevoIdSgcF28(),
      tipo,
      etiqueta: String(etiqueta || def?.etiqueta || 'Criterio').trim(),
      valores: Array.from({ length: 5 }, () => this.crearValorSgcF28(tipo))
    };
  }

  private crearComparativaSgcF28Vacia(): SgcF28Comparativa {
    return {
      id: this.nuevoIdSgcF28(),
      nombreCotizacion: '',
      fechaCreacion: this.fechaHoyIsoLocalSgcF28(),
      proveedores: Array.from({ length: 5 }, () => this.crearProveedorSgcF28Vacio()),
      criterios: []
    };
  }

  private crearSgcF28Vacio(): SgcF28FormData {
    return {
      revision: '00',
      fechaRevision: '2025-01-23',
      fechaElaboracion: this.fechaHoyIsoLocalSgcF28(),
      comparativas: [],
      comparativaActivaId: null,
      catalogoCriterios: []
    };
  }

  private normalizarImagenSgcF28(raw: any): SgcF28ImagenValor | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const driveFileId = String(raw.driveFileId || '').trim() || null;
    const base64 = String(raw.base64 || '').trim() || null;
    const dataUrl = String(raw.dataUrl || raw.previewUrl || '').trim() || null;
    if (!driveFileId && !base64 && !dataUrl) {
      return null;
    }
    return {
      driveFileId,
      base64,
      dataUrl,
      mimeType: String(raw.mimeType || 'image/jpeg'),
      nombreArchivo: String(raw.nombreArchivo || 'imagen.jpg')
    };
  }

  private normalizarValorSgcF28(raw: any, tipo: SgcF28CriterioTipo): SgcF28ValorProveedor {
    const base = this.crearValorSgcF28(tipo);
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    let numero: number | null = raw.numero == null || raw.numero === '' ? null : Number(raw.numero);
    if (numero !== null && !Number.isFinite(numero)) {
      numero = null;
    }
    const moneda = (raw.moneda === '-' || String(raw.moneda || '').trim() === '-')
      ? '-' as SgcF28Moneda
      : (['MXN', 'USD', 'EUR'].includes(String(raw.moneda || '').toUpperCase())
        ? String(raw.moneda).toUpperCase()
        : 'MXN') as SgcF28Moneda;
    return {
      texto: String(raw.texto || '').trim(),
      numero,
      moneda,
      imagen: tipo === 'imagen' ? this.normalizarImagenSgcF28(raw.imagen) : null
    };
  }

  private normalizarComparativaSgcF28(raw: any): SgcF28Comparativa {
    const base = this.crearComparativaSgcF28Vacia();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    const proveedoresRaw = Array.isArray(raw.proveedores) ? raw.proveedores : [];
    const proveedores = Array.from({ length: 5 }, (_, i) => {
      const p = proveedoresRaw[i] || {};
      const res = String(p.resultado || '').trim();
      return {
        nombre: String(p.nombre || '').trim(),
        procesoProductoServicio: String(p.procesoProductoServicio || '').trim(),
        fechaCotizacion: String(p.fechaCotizacion || '').trim(),
        resultado: (res === 'Viable' || res === 'Descartado' ? res : '') as SgcF28Resultado,
        observaciones: String(p.observaciones || '').trim()
      };
    });
    const criterios = Array.isArray(raw.criterios)
      ? raw.criterios.map((c: any) => {
          const tipo = (this.sgcF28TiposCriterio.find((t) => t.tipo === c?.tipo)?.tipo
            || 'caracteristicas') as SgcF28CriterioTipo;
          const valoresRaw = Array.isArray(c?.valores) ? c.valores : [];
          return {
            id: String(c?.id || this.nuevoIdSgcF28()),
            tipo,
            etiqueta: String(c?.etiqueta || this.etiquetaTipoSgcF28(tipo)).trim(),
            valores: Array.from({ length: 5 }, (_, i) => this.normalizarValorSgcF28(valoresRaw[i], tipo))
          } as SgcF28Criterio;
        })
      : [];
    return {
      id: String(raw.id || this.nuevoIdSgcF28()),
      nombreCotizacion: String(raw.nombreCotizacion || '').trim(),
      fechaCreacion: String(raw.fechaCreacion || this.fechaHoyIsoLocalSgcF28()).trim(),
      proveedores,
      criterios
    };
  }

  private normalizarSgcF28Form(datos: Partial<SgcF28FormData> | null | undefined): SgcF28FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    const comparativas = Array.isArray(base.comparativas)
      ? base.comparativas.map((c) => this.normalizarComparativaSgcF28(c))
      : [];
    let activa = String(base.comparativaActivaId || '').trim() || null;
    if (activa && !comparativas.some((c) => c.id === activa)) {
      activa = comparativas[0]?.id || null;
    }
    return {
      revision: String(base.revision || '00').trim() || '00',
      fechaRevision: String(base.fechaRevision || '2025-01-23').trim(),
      fechaElaboracion: String(base.fechaElaboracion || this.fechaHoyIsoLocalSgcF28()).trim(),
      comparativas,
      comparativaActivaId: activa,
      catalogoCriterios: Array.isArray(base.catalogoCriterios)
        ? base.catalogoCriterios.map((c: any) => ({
            tipo: (this.sgcF28TiposCriterio.find((t) => t.tipo === c?.tipo)?.tipo
              || 'caracteristicas') as SgcF28CriterioTipo,
            etiqueta: String(c?.etiqueta || '').trim()
          })).filter((c) => !!c.etiqueta)
        : []
    };
  }

  etiquetaTipoSgcF28(tipo: SgcF28CriterioTipo): string {
    return this.sgcF28TiposCriterio.find((t) => t.tipo === tipo)?.etiqueta || 'Criterio';
  }

  placeholderValorSgcF28(tipo: SgcF28CriterioTipo): string {
    switch (tipo) {
      case 'dimensiones':
        return 'Ej. 140 × 40 × 45 cm';
      case 'caracteristicas':
        return 'Describe características…';
      case 'metodo_pago':
        return 'Ej. Transferencia, crédito 30 días';
      case 'requiere_cotizacion_previa':
        return 'Sí / No / Condiciones';
      case 'modelo':
        return 'Modelo o SKU';
      case 'material':
        return 'Material o acabado';
      case 'liga_compra':
        return 'https://tienda.com/producto';
      case 'precio':
        return '0.00';
      default:
        return 'Escribe el valor…';
    }
  }

  iconoTipoSgcF28(tipo: SgcF28CriterioTipo): string {
    const map: Record<SgcF28CriterioTipo, string> = {
      precio: 'fa-dollar-sign',
      imagen: 'fa-image',
      liga_compra: 'fa-link',
      dimensiones: 'fa-expand',
      caracteristicas: 'fa-list',
      metodo_pago: 'fa-credit-card',
      requiere_cotizacion_previa: 'fa-file-alt',
      modelo: 'fa-cube',
      material: 'fa-th'
    };
    return map[tipo] || 'fa-tag';
  }

  formatearFechaCortaSgcF28(iso: string | null | undefined): string {
    const f = String(iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(f)) {
      return f || '—';
    }
    const [y, m, d] = f.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  conteoProveedoresSgcF28(comp: SgcF28Comparativa | null | undefined): number {
    if (!comp?.proveedores?.length) {
      return 0;
    }
    return comp.proveedores.filter((p) => !!(p.nombre || '').trim()).length;
  }

  get sgcF28ColspanMatriz(): number {
    return 1 + this.sgcF28IndicesVisibles.length;
  }

  private actualizarIndicesVisiblesSgcF28(): void {
    this.sgcF28IndicesVisibles = this.sgcF28ExpandirProveedores
      ? this.sgcF28Indices5
      : this.sgcF28Indices3;
  }

  /** Garantiza 5 proveedores y 5 valores por criterio (evita celdas rotas / thrashing). */
  private asegurarEstructuraComparativaSgcF28(comp: SgcF28Comparativa | null): void {
    if (!comp) {
      return;
    }
    if (!Array.isArray(comp.proveedores)) {
      comp.proveedores = [];
    }
    while (comp.proveedores.length < 5) {
      comp.proveedores.push(this.crearProveedorSgcF28Vacio());
    }
    if (comp.proveedores.length > 5) {
      comp.proveedores = comp.proveedores.slice(0, 5);
    }
    if (!Array.isArray(comp.criterios)) {
      comp.criterios = [];
    }
    for (const crit of comp.criterios) {
      if (!crit || typeof crit !== 'object') {
        continue;
      }
      if (!Array.isArray(crit.valores)) {
        crit.valores = [];
      }
      while (crit.valores.length < 5) {
        crit.valores.push(this.crearValorSgcF28(crit.tipo || 'caracteristicas'));
      }
      if (crit.valores.length > 5) {
        crit.valores = crit.valores.slice(0, 5);
      }
      // No borrar dataUrl/base64: se necesitan para preview hasta que Drive responda.
    }
  }

  private proveedorSlotTieneDatosSgcF28(comp: SgcF28Comparativa, index: number): boolean {
    const p = comp.proveedores?.[index];
    if (!p) {
      return false;
    }
    if ((p.nombre || '').trim() || (p.procesoProductoServicio || '').trim()
      || (p.fechaCotizacion || '').trim() || (p.resultado || '').trim()
      || (p.observaciones || '').trim()) {
      return true;
    }
    return (comp.criterios || []).some((c) => {
      const v = c.valores?.[index];
      if (!v) {
        return false;
      }
      if (c.tipo === 'precio') {
        return v.numero != null && Number.isFinite(Number(v.numero));
      }
      if (c.tipo === 'imagen') {
        return !!v.imagen;
      }
      return !!(v.texto || '').trim();
    });
  }

  private sincronizarExpansionProveedoresSgcF28(comp: SgcF28Comparativa | null): void {
    // Solo actualiza índices visibles; nunca fuerza expandir 4–5 (solo el botón).
    if (!comp) {
      this.sgcF28ExpandirProveedores = false;
    }
    this.actualizarIndicesVisiblesSgcF28();
  }

  toggleProveedoresExtraSgcF28(): void {
    this.sgcF28ExpandirProveedores = !this.sgcF28ExpandirProveedores;
    this.actualizarIndicesVisiblesSgcF28();
  }

  trackByCriterioSgcF28(_index: number, crit: SgcF28Criterio): string {
    return crit?.id || String(_index);
  }

  trackByCriterioIdSgcF28(_index: number, comp: SgcF28Comparativa): string {
    return comp?.id || String(_index);
  }

  tonoTarjetaSgcF28(comp: SgcF28Comparativa, index: number): string {
    const resultados = (comp?.proveedores || []).map((p) => p?.resultado).filter(Boolean);
    if (resultados.includes('Viable')) {
      return 'viable';
    }
    if (resultados.includes('Descartado')) {
      return 'descartado';
    }
    const tones = ['coral', 'amber', 'mint'];
    return tones[index % tones.length];
  }

  onMonedaPrecioSgcF28(valor: SgcF28ValorProveedor, moneda: SgcF28Moneda): void {
    if (!valor) {
      return;
    }
    valor.moneda = moneda;
    if (moneda === '-') {
      valor.numero = null;
    }
    this.onSgcF28Editado();
  }

  setResultadoSgcF28(proveedor: SgcF28Proveedor, valor: SgcF28Resultado): void {
    if (!proveedor) {
      return;
    }
    proveedor.resultado = proveedor.resultado === valor ? '' : valor;
    this.onSgcF28Editado();
  }

  get sgcF28IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-28') {
      return '';
    }
    return 'Compara hasta 5 proveedores por cotización (3 visibles por defecto). Cada «nombre de cotización» genera su propia hoja en Excel. Agrega criterios tipados y reordénalos arrastrando la fila.';
  }

  get sgcF28ComparativasVista(): SgcF28Comparativa[] {
    const q = String(this.sgcF28Busqueda || '').trim().toLowerCase();
    const lista = this.sgcF28Form.comparativas || [];
    if (!q) {
      return lista;
    }
    return lista.filter((c) => {
      const nombre = (c.nombreCotizacion || '').toLowerCase();
      const provs = (c.proveedores || []).map((p) => p.nombre).join(' ').toLowerCase();
      return nombre.includes(q) || provs.includes(q);
    });
  }

  private sincronizarComparativaActivaSgcF28(): void {
    const id = this.sgcF28Form.comparativaActivaId;
    this.sgcF28ComparativaActiva = (this.sgcF28Form.comparativas || []).find((c) => c.id === id) || null;
    this.asegurarEstructuraComparativaSgcF28(this.sgcF28ComparativaActiva);
  }

  onSgcF28Editado(): void {
    if (this.sgcF28IgnorarAutoSave || !this.sgcF28Listo) {
      return;
    }
    this.sgcF28CambiosPendientes = true;
  }

  nuevaComparativaSgcF28(): void {
    const comp = this.crearComparativaSgcF28Vacia();
    this.asegurarEstructuraComparativaSgcF28(comp);
    this.sgcF28Form.comparativas = [comp, ...(this.sgcF28Form.comparativas || [])];
    this.sgcF28Form.comparativaActivaId = comp.id;
    this.sgcF28ComparativaActiva = comp;
    this.sgcF28ExpandirProveedores = false;
    this.actualizarIndicesVisiblesSgcF28();
    this.sgcF28Vista = 'editor';
    this.onSgcF28Editado();
  }

  abrirComparativaSgcF28(comp: SgcF28Comparativa): void {
    if (!comp) {
      return;
    }
    try {
      this.asegurarEstructuraComparativaSgcF28(comp);
      this.sgcF28Form.comparativaActivaId = comp.id;
      this.sgcF28ComparativaActiva = comp;
      // Siempre inicia en 3 columnas; 4–5 solo con el botón.
      this.sgcF28ExpandirProveedores = false;
      this.actualizarIndicesVisiblesSgcF28();
      this.sgcF28DragCriterioFrom = null;
      this.sgcF28MostrarAddCriterio = false;
      this.sgcF28Vista = 'editor';
    } catch (err) {
      console.error('[SGC-F-28] Error al abrir comparativa', err);
      this.sgcF28Vista = 'archivero';
      this.sgcF28ComparativaActiva = null;
    }
  }

  volverArchiveroSgcF28(): void {
    this.sgcF28Vista = 'archivero';
    this.sgcF28MostrarAddCriterio = false;
    this.sgcF28DragCriterioFrom = null;
  }

  eliminarComparativaSgcF28(comp: SgcF28Comparativa, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!confirm(`¿Eliminar la comparativa «${comp.nombreCotizacion || 'sin nombre'}»?`)) {
      return;
    }
    this.sgcF28Form.comparativas = (this.sgcF28Form.comparativas || []).filter((c) => c.id !== comp.id);
    if (this.sgcF28Form.comparativaActivaId === comp.id) {
      this.sgcF28Form.comparativaActivaId = this.sgcF28Form.comparativas[0]?.id || null;
      this.sincronizarComparativaActivaSgcF28();
    }
    if (!this.sgcF28Form.comparativas.length) {
      this.sgcF28Vista = 'archivero';
      this.sgcF28ComparativaActiva = null;
    }
    this.onSgcF28Editado();
  }

  onTipoNuevoCriterioSgcF28Change(): void {
    this.sgcF28NuevaEtiqueta = this.etiquetaTipoSgcF28(this.sgcF28NuevoTipo);
  }

  private registrarCatalogoCriterioSgcF28(criterio: SgcF28Criterio): void {
    const etiqueta = String(criterio.etiqueta || '').trim();
    if (!etiqueta) {
      return;
    }
    const key = `${criterio.tipo}::${etiqueta.toLowerCase()}`;
    const existe = (this.sgcF28Form.catalogoCriterios || []).some(
      (c) => `${c.tipo}::${c.etiqueta.toLowerCase()}` === key
    );
    if (!existe) {
      this.sgcF28Form.catalogoCriterios = [
        ...(this.sgcF28Form.catalogoCriterios || []),
        { tipo: criterio.tipo, etiqueta }
      ];
    }
  }

  /** Agrega el criterio ya en la matriz, con selector de tipo en la fila. */
  agregarCriterioDirectoSgcF28(): void {
    const comp = this.sgcF28ComparativaActiva;
    if (!comp) {
      return;
    }
    const criterio = this.crearCriterioSgcF28('precio');
    comp.criterios = [...(comp.criterios || []), criterio];
    this.registrarCatalogoCriterioSgcF28(criterio);
    this.sgcF28MostrarAddCriterio = false;
    this.onSgcF28Editado();
  }

  /** @deprecated flujo anterior del composer superior */
  abrirAddCriterioSgcF28(): void {
    this.agregarCriterioDirectoSgcF28();
  }

  cancelarAddCriterioSgcF28(): void {
    this.sgcF28MostrarAddCriterio = false;
  }

  aplicarCriterioCatalogoSgcF28(item: { tipo: SgcF28CriterioTipo; etiqueta: string }): void {
    const comp = this.sgcF28ComparativaActiva;
    if (!comp) {
      return;
    }
    const criterio = this.crearCriterioSgcF28(item.tipo, item.etiqueta);
    comp.criterios = [...(comp.criterios || []), criterio];
    this.registrarCatalogoCriterioSgcF28(criterio);
    this.onSgcF28Editado();
  }

  confirmarAddCriterioSgcF28(): void {
    this.agregarCriterioDirectoSgcF28();
  }

  onTipoCriterioSgcF28Change(crit: SgcF28Criterio, tipoNuevo: SgcF28CriterioTipo): void {
    const tipoPrev = crit.tipo;
    if (tipoPrev === tipoNuevo) {
      return;
    }
    const etiquetaDefaultPrev = this.etiquetaTipoSgcF28(tipoPrev);
    const etiquetaEraDefault = !crit.etiqueta
      || crit.etiqueta.trim().toLowerCase() === etiquetaDefaultPrev.toLowerCase();
    crit.tipo = tipoNuevo;
    if (etiquetaEraDefault) {
      crit.etiqueta = this.etiquetaTipoSgcF28(tipoNuevo);
    }
    crit.valores = Array.from({ length: 5 }, () => this.crearValorSgcF28(tipoNuevo));
    this.registrarCatalogoCriterioSgcF28(crit);
    this.onSgcF28Editado();
  }

  onCritDragStartSgcF28(event: DragEvent, index: number): void {
    this.sgcF28DragCriterioFrom = index;
    try {
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    } catch {
      // ignore
    }
  }

  onCritDragOverSgcF28(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const row = (event.currentTarget as HTMLElement);
    if (row) {
      row.classList.add('is-drag-over');
    }
  }

  onCritDragLeaveSgcF28(event: DragEvent): void {
    const row = event.currentTarget as HTMLElement;
    row?.classList.remove('is-drag-over');
  }

  onCritDropSgcF28(event: DragEvent, toIndex: number): void {
    event.preventDefault();
    const row = event.currentTarget as HTMLElement;
    row?.classList.remove('is-drag-over');
    const comp = this.sgcF28ComparativaActiva;
    const from = this.sgcF28DragCriterioFrom;
    this.sgcF28DragCriterioFrom = null;
    if (!comp || from == null || from === toIndex) {
      return;
    }
    if (from < 0 || toIndex < 0 || from >= comp.criterios.length || toIndex >= comp.criterios.length) {
      return;
    }
    const lista = [...comp.criterios];
    const [moved] = lista.splice(from, 1);
    lista.splice(toIndex, 0, moved);
    // Nueva referencia + sincroniza etiqueta con tipo (evita desfase visual tras DnD).
    comp.criterios = lista.map((c) => ({
      ...c,
      etiqueta: this.etiquetaTipoSgcF28(c.tipo),
      valores: [...(c.valores || [])]
    }));
    this.onSgcF28Editado();
  }

  onCritDragEndSgcF28(): void {
    this.sgcF28DragCriterioFrom = null;
  }

  eliminarCriterioSgcF28(index: number): void {
    const comp = this.sgcF28ComparativaActiva;
    if (!comp) {
      return;
    }
    comp.criterios = (comp.criterios || []).filter((_, i) => i !== index);
    this.onSgcF28Editado();
  }

  onLigaCompraSgcF28(valor: SgcF28ValorProveedor): void {
    const t = String(valor.texto || '').trim();
    if (!t) {
      this.onSgcF28Editado();
      return;
    }
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        valor.texto = '';
      }
    } catch {
      valor.texto = '';
    }
    this.onSgcF28Editado();
  }

  previewImagenSgcF28(imagen: SgcF28ImagenValor | null): string | null {
    if (!imagen) {
      return null;
    }
    if ((imagen as any)._previewBroken && !imagen.dataUrl && !imagen.base64) {
      return null;
    }
    // Priorizar preview local (siempre visible tras subir).
    if (imagen.dataUrl) {
      return imagen.dataUrl;
    }
    if (imagen.base64) {
      return imagen.base64.startsWith('data:')
        ? imagen.base64
        : `data:${imagen.mimeType || 'image/jpeg'};base64,${imagen.base64}`;
    }
    if (imagen.driveFileId) {
      return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(imagen.driveFileId)}`;
    }
    return null;
  }

  private comprimirImagenSgcF28(file: File, maxLado = 1200, calidad = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const src = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxLado / Math.max(w, h, 1));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(src);
              return;
            }
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/jpeg', calidad));
          } catch {
            resolve(src);
          }
        };
        img.onerror = () => reject(new Error('Imagen inválida'));
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  onSeleccionarImagenSgcF28(event: Event, valor: SgcF28ValorProveedor): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      alert('Solo se permiten archivos de imagen.');
      input.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert('La imagen no debe superar 8 MB.');
      input.value = '';
      return;
    }
    this.comprimirImagenSgcF28(file).then((dataUrl) => {
      valor.imagen = {
        driveFileId: null,
        base64: null,
        dataUrl,
        mimeType: 'image/jpeg',
        nombreArchivo: (file.name || 'imagen.jpg').replace(/\.\w+$/, '.jpg')
      };
      this.onSgcF28Editado();
    }).catch(() => {
      alert('No se pudo procesar la imagen. Intenta con otro archivo.');
    });
    input.value = '';
  }

  quitarImagenSgcF28(valor: SgcF28ValorProveedor): void {
    valor.imagen = null;
    this.onSgcF28Editado();
  }

  /** Si falla la miniatura de Drive, oculta el marco roto y deja re-subir/ver placeholder. */
  onPreviewImagenErrorSgcF28(valor: SgcF28ValorProveedor): void {
    if (!valor?.imagen) {
      return;
    }
    if (valor.imagen.dataUrl || valor.imagen.base64) {
      return;
    }
    (valor.imagen as any)._previewBroken = true;
  }

  claseResultadoSgcF28(resultado: SgcF28Resultado): string {
    if (resultado === 'Viable') {
      return 'sgc-f-28-resultado--viable';
    }
    if (resultado === 'Descartado') {
      return 'sgc-f-28-resultado--descartado';
    }
    return '';
  }

  private fijarEditorEmbedUrlSgcF28(editorUrl: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF28Editor && this.sgcF28EditorEmbedUrlSafe && this.sgcF28EditorUrl === editorUrl) {
      return;
    }
    if (!editorUrl) {
      this.sgcF28EditorUrl = null;
      this.sgcF28EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF28EditorUrl === editorUrl && this.sgcF28EditorEmbedUrlSafe) {
      return;
    }
    // Misma ruta que F-29: sin rm=minimal para conservar menú/barra de Sheets.
    const url = this.resolverUrlEditorDrive(editorUrl, this.sgcF28DriveFileId);
    this.sgcF28EditorUrl = url || editorUrl;
    const embedUrl = this.urlIframeDriveSegunPermiso(this.sgcF28EditorUrl);
    this.sgcF28EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  toggleSgcF28Editor(): void {
    if (this.mostrarSgcF28Editor) {
      this.mostrarSgcF28Editor = false;
      this.sgcF28EditorCargando = false;
      this.sincronizarSgcF28DesdeDrive();
      return;
    }
    const url = this.resolverUrlEditorDrive(this.sgcF28EditorUrl, this.sgcF28DriveFileId);
    this.fijarEditorEmbedUrlSgcF28(url, true);
    this.mostrarSgcF28Editor = true;
    this.sgcF28EditorCargando = true;
    this.sgcF28EditorIframeListo = false;
  }

  onSgcF28IframeLoad(): void {
    this.sgcF28EditorIframeListo = true;
    this.sgcF28EditorCargando = false;
  }

  actualizarPlantillaSgcF28(): void {
    if (this.sgcF28ActualizandoPlantilla) {
      return;
    }
    this.sgcF28ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF28().subscribe({
      next: (res) => {
        this.aplicarEstadoSgcF28(res, false, false, true);
        this.sgcF28ActualizandoPlantilla = false;
      },
      error: () => {
        this.sgcF28ActualizandoPlantilla = false;
      }
    });
  }

  private cargarSgcF28DesdeServidor(): void {
    this.sgcF28Cargando = true;
    this.backendService.cargarSgcF28Formato().subscribe({
      next: (res) => this.aplicarEstadoSgcF28(res),
      error: () => {
        this.sgcF28Cargando = false;
        this.sgcF28Listo = true;
      }
    });
  }

  private sincronizarSgcF28DesdeDrive(): void {
    this.backendService.sincronizarSgcF28DesdeDrive().subscribe({
      next: (res) => this.aplicarEstadoSgcF28(res, false, true, true),
      error: () => { /* silencioso */ }
    });
  }

  private persistirSgcF28(): void {
    if (this.sgcF28Guardando || !this.sgcF28Listo) {
      return;
    }
    this.sgcF28Guardando = true;
    this.backendService.guardarSgcF28Formato(this.sgcF28Form, false).subscribe({
      next: (res) => {
        this.aplicarEstadoSgcF28(res, true, false, true);
        this.sgcF28CambiosPendientes = false;
        this.sgcF28Guardando = false;
      },
      error: () => {
        this.sgcF28Guardando = false;
      }
    });
  }

  private aplicarEstadoSgcF28(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF28Cargando = false;
      }
      this.sgcF28Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF28Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF28IgnorarAutoSave = true;
      const activaAntes = this.sgcF28Form.comparativaActivaId;
      const vistaAntes = this.sgcF28Vista;
      this.sgcF28Form = this.normalizarSgcF28Form(res.datos);
      if (activaAntes && this.sgcF28Form.comparativas.some((c) => c.id === activaAntes)) {
        this.sgcF28Form.comparativaActivaId = activaAntes;
      }
      this.sincronizarComparativaActivaSgcF28();
      // No auto-expandir proveedores 4–5 tras guardar/cargar.
      this.actualizarIndicesVisiblesSgcF28();
      if (vistaAntes === 'editor' && this.sgcF28ComparativaActiva) {
        this.sgcF28Vista = 'editor';
      }
      setTimeout(() => {
        this.sgcF28IgnorarAutoSave = false;
      }, 0);
    } else if (conservarEdicion) {
      this.sincronizarComparativaActivaSgcF28();
      this.actualizarIndicesVisiblesSgcF28();
    }

    this.sgcF28DriveFileId = res.driveFileId || null;
    this.sgcF28UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF28ContenidoModificado = !!res.contenidoModificado;
    if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF28Editor)) {
      this.fijarEditorEmbedUrlSgcF28(res.editorUrl, forzarActualizacionDrive);
    }

    this.sgcF28Listo = true;
    if (!sincronizacionSilenciosa) {
      this.sgcF28Cargando = false;
    }
  }

  get spF02IntroLead(): string {
    if (this.plantillaSlug !== 'sp-f-02') {
      return '';
    }
    return 'Archivero de reportes de visitas. Crea, busca y edita cada visita con folio SPF02-MMAA. Usa «Guardar información» para conservar el archivero y sincronizar con Excel en Drive.';
  }

  get spF02ReportesVista(): SpF02Reporte[] {
    const q = this.spF02Busqueda.trim().toLowerCase();
    const lista = [...(this.spF02Form.reportes || [])].sort((a, b) => {
      const fa = String(a.fecha || '');
      const fb = String(b.fecha || '');
      return fb.localeCompare(fa) || String(b.folio || '').localeCompare(String(a.folio || ''));
    });
    if (!q) {
      return lista;
    }
    return lista.filter((r) =>
      [r.folio, r.nombreEmpresa, r.proposito, r.asistentes, r.consultores, r.modalidad, r.fecha]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  get spF02ResumenActivo(): { total: number; abiertos: number; cerrados: number; avance: number } {
    const items = (this.spF02ReporteActivo?.items || []).filter((i) => this.itemSpF02TieneContenido(i));
    const total = items.length;
    const cerrados = items.filter((i) => i.estatus === 'Cerrado').length;
    const abiertos = total - cerrados;
    const avance = total ? Math.round((cerrados / total) * 100) : 0;
    return { total, abiertos, cerrados, avance };
  }

  resumenReporteSpF02(reporte: SpF02Reporte | null | undefined): { total: number; abiertos: number; cerrados: number; avance: number } {
    const items = (reporte?.items || []).filter((i) => this.itemSpF02TieneContenido(i));
    const total = items.length;
    const cerrados = items.filter((i) => i.estatus === 'Cerrado').length;
    const abiertos = total - cerrados;
    const avance = total ? Math.round((cerrados / total) * 100) : 0;
    return { total, abiertos, cerrados, avance };
  }

  reporteCompletoSpF02(reporte: SpF02Reporte | null | undefined): boolean {
    const resumen = this.resumenReporteSpF02(reporte);
    return resumen.total > 0 && resumen.avance === 100;
  }

  nuevoReporteSpF02(): void {
    const reporte = this.crearSpF02ReporteVacio();
    this.spF02Form.reportes = [reporte, ...(this.spF02Form.reportes || [])];
    this.spF02Form.reporteActivoId = reporte.id;
    this.spF02ReporteActivo = reporte;
    this.spF02Vista = 'editor';
    this.onSpF02Editado();
  }

  abrirReporteSpF02(reporte: SpF02Reporte): void {
    this.spF02Form.reporteActivoId = reporte.id;
    this.spF02ReporteActivo = reporte;
    this.spF02Vista = 'editor';
  }

  volverArchiveroSpF02(): void {
    this.spF02Vista = 'archivero';
    this.spF02ReporteActivo = null;
    this.spF02Form.reporteActivoId = null;
    if (this.mostrarSpF02Editor) {
      this.toggleSpF02Editor();
    }
  }

  eliminarReporteSpF02(reporte: SpF02Reporte, event?: Event): void {
    event?.stopPropagation();
    const etiqueta = reporte.folio || reporte.nombreEmpresa || 'sin folio';
    if (!confirm(`¿Eliminar el reporte de visita ${etiqueta}?`)) {
      return;
    }
    this.spF02Form.reportes = (this.spF02Form.reportes || []).filter((r) => r.id !== reporte.id);
    if (this.spF02ReporteActivo?.id === reporte.id) {
      this.volverArchiveroSpF02();
    }
    this.onSpF02Editado();
  }

  private crearSpF02ItemVacio(): SpF02Item {
    return {
      problema: '',
      problemaImagenes: [],
      acciones: '',
      responsable: '',
      fechaCompromiso: '',
      estatus: 'Abierto',
      observaciones: '',
      observacionesImagenes: []
    };
  }

  private normalizarImagenesSpF02(
    raw: Partial<SpF02Item> | null | undefined,
    plural: 'problemaImagenes' | 'observacionesImagenes',
    singular: 'problemaImagen' | 'observacionesImagen'
  ): SpF02ImagenCampo[] {
    const out: SpF02ImagenCampo[] = [];
    const arr = Array.isArray(raw?.[plural]) ? raw[plural] : [];
    for (const img of arr) {
      const limpia = this.normalizarImagenSpF02(img);
      if (limpia && !out.some((x) => x.driveFileId === limpia.driveFileId)) {
        out.push(limpia);
      }
    }
    const legacy = this.normalizarImagenSpF02((raw as any)?.[singular]);
    if (legacy && !out.some((x) => x.driveFileId === legacy.driveFileId)) {
      out.unshift(legacy);
    }
    return out.slice(0, this.spF02MaxImagenesPorCampo);
  }

  private normalizarImagenSpF02(raw: Partial<SpF02ImagenCampo> | null | undefined): SpF02ImagenCampo | null {
    const driveFileId = String(raw?.driveFileId || '').trim();
    if (!driveFileId) {
      return null;
    }
    return {
      driveFileId,
      nombreArchivo: String(raw?.nombreArchivo || 'imagen.jpg').trim(),
      mimeType: String(raw?.mimeType || 'image/jpeg').trim(),
      previewUrl: raw?.previewUrl,
      thumbDataUrl: String(raw?.thumbDataUrl || '').trim() || undefined,
      dataUrl: raw?.dataUrl
    };
  }

  itemSpF02TieneContenido(item: SpF02Item | null | undefined): boolean {
    if (!item) {
      return false;
    }
    return !!(item.problema || item.acciones || item.responsable || item.fechaCompromiso || item.observaciones
      || (item.problemaImagenes || []).length
      || (item.observacionesImagenes || []).length
      || (item.estatus && item.estatus !== 'Abierto'));
  }

  imagenesCampoSpF02(item: SpF02Item, campo: 'problema' | 'observaciones'): SpF02ImagenCampo[] {
    return campo === 'problema'
      ? (item.problemaImagenes || [])
      : (item.observacionesImagenes || []);
  }

  puedeAgregarImagenSpF02(item: SpF02Item, campo: 'problema' | 'observaciones'): boolean {
    return this.imagenesCampoSpF02(item, campo).length < this.spF02MaxImagenesPorCampo;
  }

  previewImagenSpF02(imagen: SpF02ImagenCampo | null | undefined): string | null {
    if (!imagen) {
      return null;
    }
    if (imagen.thumbDataUrl) {
      return imagen.thumbDataUrl;
    }
    if (imagen.dataUrl) {
      return imagen.dataUrl;
    }
    if (imagen.driveFileId) {
      return this.backendService.obtenerUrlDrivePreview(imagen.driveFileId);
    }
    if (imagen.previewUrl) {
      return imagen.previewUrl;
    }
    return null;
  }

  subiendoImagenSpF02(index: number, campo: 'problema' | 'observaciones'): boolean {
    const prefix = `${index}-${campo}-`;
    return !!this.spF02SubiendoImagenKey?.startsWith(prefix);
  }

  onSeleccionarImagenSpF02(
    event: Event,
    item: SpF02Item,
    index: number,
    campo: 'problema' | 'observaciones'
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      input.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      input.value = '';
      return;
    }
    if (!this.puedeAgregarImagenSpF02(item, campo)) {
      input.value = '';
      return;
    }

    const slot = this.imagenesCampoSpF02(item, campo).length;
    const key = `${index}-${campo}-${slot}`;
    this.spF02SubiendoImagenKey = key;

    this.comprimirImagenSpF02(file).then((dataUrl) => {
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const nombreArchivo = (file.name || 'imagen.jpg').replace(/\.\w+$/, '.jpg');
      this.backendService.subirImagenSpF02({
        campo,
        item_index: index,
        slot_index: slot,
        reporte_folio: this.spF02ReporteActivo?.folio || '',
        imagen_base64: base64,
        mime_type: 'image/jpeg',
        nombre_archivo: nombreArchivo
      }).subscribe({
        next: (resp) => {
          this.spF02SubiendoImagenKey = null;
          const imagen: SpF02ImagenCampo = {
            driveFileId: resp?.imagen?.driveFileId,
            nombreArchivo: resp?.imagen?.nombreArchivo || nombreArchivo,
            mimeType: resp?.imagen?.mimeType || 'image/jpeg',
            previewUrl: resp?.imagen?.previewUrl,
            thumbDataUrl: resp?.imagen?.thumbDataUrl,
            dataUrl: resp?.imagen?.thumbDataUrl || dataUrl
          };
          const lista = campo === 'problema' ? item.problemaImagenes : item.observacionesImagenes;
          if (campo === 'problema') {
            item.problemaImagenes = [...lista, imagen];
          } else {
            item.observacionesImagenes = [...lista, imagen];
          }
          this.onSpF02Editado();
        },
        error: () => {
          this.spF02SubiendoImagenKey = null;
        }
      });
    }).catch(() => {
      this.spF02SubiendoImagenKey = null;
    });

    input.value = '';
  }

  quitarImagenSpF02(item: SpF02Item, campo: 'problema' | 'observaciones', slotIndex: number): void {
    if (campo === 'problema') {
      item.problemaImagenes = (item.problemaImagenes || []).filter((_, i) => i !== slotIndex);
    } else {
      item.observacionesImagenes = (item.observacionesImagenes || []).filter((_, i) => i !== slotIndex);
    }
    this.sincronizarReporteActivoEnFormSpF02();
    this.onSpF02Editado();
  }

  private comprimirImagenSpF02(file: File, maxLado = 1200, calidad = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const src = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxLado / Math.max(w, h, 1));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(src);
              return;
            }
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(canvas.toDataURL('image/jpeg', calidad));
          } catch {
            resolve(src);
          }
        };
        img.onerror = () => reject(new Error('Imagen inválida'));
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  private crearSpF02Vacio(): SpF02FormData {
    return {
      revision: '00',
      fechaElaboracion: '2021-08-05',
      fechaRevision: '2021-08-05',
      reportes: [],
      reporteActivoId: null
    };
  }

  private nuevoIdSpF02(): string {
    return `sp02-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private folioSpF02(fechaIso?: string): string {
    const iso = (fechaIso || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()))
      .slice(0, 10);
    const m = iso.match(/^(\d{4})-(\d{2})/);
    if (!m) {
      return 'SPF02-0000';
    }
    return `SPF02-${m[2]}${m[1].slice(-2)}`;
  }

  private crearSpF02ReporteVacio(): SpF02Reporte {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    return {
      id: this.nuevoIdSpF02(),
      folio: this.folioSpF02(hoy),
      nombreEmpresa: '',
      fecha: hoy,
      proposito: '',
      hora: '',
      asistentes: '',
      modalidad: 'Presencial',
      consultores: '',
      proxVisita: '',
      ultimaRevision: hoy,
      items: [this.crearSpF02ItemVacio()],
      nombreHoja: ''
    };
  }

  private normalizarSpF02Item(raw: Partial<SpF02Item> | null | undefined): SpF02Item {
    const estatusRaw = String(raw?.estatus || 'Abierto').trim();
    const estatusNorm = /cerrad/i.test(estatusRaw) ? 'Cerrado' : 'Abierto';
    return {
      problema: String(raw?.problema || '').replace(/\r\n/g, '\n').trim(),
      problemaImagenes: this.normalizarImagenesSpF02(raw, 'problemaImagenes', 'problemaImagen'),
      acciones: String(raw?.acciones || '').replace(/\r\n/g, '\n').trim(),
      responsable: String(raw?.responsable || '').replace(/\r\n/g, '\n').trim(),
      fechaCompromiso: String(raw?.fechaCompromiso || '').trim(),
      estatus: this.spF02Estatus.includes(estatusNorm) ? estatusNorm : 'Abierto',
      observaciones: String(raw?.observaciones || '').replace(/\r\n/g, '\n').trim(),
      observacionesImagenes: this.normalizarImagenesSpF02(raw, 'observacionesImagenes', 'observacionesImagen')
    };
  }

  private normalizarSpF02Reporte(raw: Partial<SpF02Reporte> | null | undefined): SpF02Reporte {
    const items = Array.isArray(raw?.items) && raw.items.length
      ? raw.items.map((i) => this.normalizarSpF02Item(i))
      : [this.crearSpF02ItemVacio()];
    const modalidad = String(raw?.modalidad || '').trim();
    const fecha = String(raw?.fecha || '').trim();
    return {
      id: String(raw?.id || '').trim() || this.nuevoIdSpF02(),
      folio: this.folioSpF02(fecha),
      nombreEmpresa: String(raw?.nombreEmpresa || '').trim(),
      fecha,
      proposito: String(raw?.proposito || '').trim(),
      hora: String(raw?.hora || '').trim(),
      asistentes: String(raw?.asistentes || '').trim(),
      modalidad: this.spF02Modalidades.includes(modalidad) ? modalidad : modalidad,
      consultores: String(raw?.consultores || '').trim(),
      proxVisita: String(raw?.proxVisita || '').trim(),
      ultimaRevision: String(raw?.ultimaRevision || '').trim(),
      items,
      nombreHoja: String(raw?.nombreHoja || '').trim()
    };
  }

  private normalizarSpF02Form(datos: Partial<SpF02FormData> | null | undefined): SpF02FormData {
    const reportes = Array.isArray(datos?.reportes)
      ? datos.reportes.map((r) => this.normalizarSpF02Reporte(r))
      : [];
    const activo = datos?.reporteActivoId && reportes.some((r) => r.id === datos.reporteActivoId)
      ? String(datos.reporteActivoId)
      : (reportes[0]?.id || null);
    return {
      revision: String(datos?.revision || '00').trim() || '00',
      fechaElaboracion: String(datos?.fechaElaboracion || '').trim(),
      fechaRevision: String(datos?.fechaRevision || '').trim(),
      reportes,
      reporteActivoId: activo
    };
  }

  private sincronizarReporteActivoSpF02(): void {
    const id = this.spF02Form.reporteActivoId;
    this.spF02ReporteActivo = (this.spF02Form.reportes || []).find((r) => r.id === id) || null;
  }

  private ensureReporteActivoSpF02(forceCreate = false): void {
    if (this.spF02Vista === 'archivero' && !forceCreate) {
      this.sincronizarReporteActivoSpF02();
      return;
    }
    if (!(this.spF02Form.reportes || []).length) {
      if (!forceCreate) {
        this.spF02ReporteActivo = null;
        this.spF02Form.reporteActivoId = null;
        return;
      }
      const reporte = this.crearSpF02ReporteVacio();
      this.spF02Form.reportes = [reporte];
      this.spF02Form.reporteActivoId = reporte.id;
    } else if (!this.spF02Form.reporteActivoId) {
      this.spF02Form.reporteActivoId = this.spF02Form.reportes[0].id;
    }
    this.sincronizarReporteActivoSpF02();
    if (!this.spF02ReporteActivo && forceCreate) {
      const reporte = this.crearSpF02ReporteVacio();
      this.spF02Form.reportes = [reporte];
      this.spF02Form.reporteActivoId = reporte.id;
      this.spF02ReporteActivo = reporte;
    }
  }

  private sincronizarReporteActivoEnFormSpF02(): void {
    const activo = this.spF02ReporteActivo;
    if (!activo) {
      return;
    }
    const idx = (this.spF02Form.reportes || []).findIndex((r) => r.id === activo.id);
    if (idx >= 0) {
      this.spF02Form.reportes[idx] = activo;
    }
  }

  /** Conserva imágenes locales si el servidor no las devuelve (sync desde Excel). */
  private fusionarImagenesReporteActivoSpF02(datos: Partial<SpF02FormData>): void {
    const activo = this.spF02ReporteActivo;
    if (!activo) {
      return;
    }
    const remoto = (datos.reportes || []).find((r) => r.id === activo.id);
    if (!remoto) {
      return;
    }
    activo.items = (activo.items || []).map((item, i) => {
      const remItem = remoto.items?.[i];
      if (!remItem) {
        return item;
      }
      return {
        ...item,
        problemaImagenes: (remItem.problemaImagenes || []).length
          ? remItem.problemaImagenes
          : (item.problemaImagenes || []),
        observacionesImagenes: (remItem.observacionesImagenes || []).length
          ? remItem.observacionesImagenes
          : (item.observacionesImagenes || [])
      };
    });
    this.sincronizarReporteActivoEnFormSpF02();
  }

  onSpF02Editado(): void {
    if (this.spF02IgnorarAutoSave || !this.spF02Listo) {
      return;
    }
    if (this.spF02ReporteActivo) {
      this.spF02ReporteActivo.folio = this.folioSpF02(this.spF02ReporteActivo.fecha);
      this.sincronizarReporteActivoEnFormSpF02();
    }
    this.spF02CambiosPendientes = true;
  }

  agregarItemSpF02(): void {
    if (!this.spF02ReporteActivo) {
      return;
    }
    this.spF02ReporteActivo.items = [...(this.spF02ReporteActivo.items || []), this.crearSpF02ItemVacio()];
    this.onSpF02Editado();
  }

  quitarItemSpF02(index: number): void {
    if (!this.spF02ReporteActivo) {
      return;
    }
    if (this.spF02ReporteActivo.items.length <= 1) {
      this.spF02ReporteActivo.items.splice(0, 1, this.crearSpF02ItemVacio());
    } else {
      this.spF02ReporteActivo.items.splice(index, 1);
    }
    this.onSpF02Editado();
  }

  claseEstatusSpF02(estatus: string): string {
    if (estatus === 'Cerrado') {
      return 'sp-f-02-estatus--cerrado';
    }
    return 'sp-f-02-estatus--abierto';
  }

  formatearFechaCortaSpF02(valor: string | null | undefined): string {
    const iso = String(valor || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return valor || '—';
    }
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  private fijarEditorEmbedUrlSpF02(editorUrl: string | null, forzar = false): void {
    if (!forzar && this.mostrarSpF02Editor && this.spF02EditorEmbedUrlSafe && this.spF02EditorUrl === editorUrl) {
      return;
    }
    if (!editorUrl) {
      this.spF02EditorUrl = null;
      this.spF02EditorEmbedUrlSafe = null;
      return;
    }
    const url = this.resolverUrlEditorDrive(editorUrl, this.spF02DriveFileId);
    this.spF02EditorUrl = url || editorUrl;
    const embedUrl = this.urlIframeDriveSegunPermiso(this.spF02EditorUrl);
    this.spF02EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  toggleSpF02Editor(): void {
    if (this.mostrarSpF02Editor) {
      this.mostrarSpF02Editor = false;
      this.spF02EditorCargando = false;
      // El formulario es la fuente de verdad; no sobrescribir con lectura de Excel al cerrar.
      return;
    }
    const url = this.resolverUrlEditorDrive(this.spF02EditorUrl, this.spF02DriveFileId);
    this.fijarEditorEmbedUrlSpF02(url, true);
    this.mostrarSpF02Editor = true;
    this.spF02EditorCargando = true;
    this.spF02EditorIframeListo = false;
  }

  onSpF02IframeLoad(): void {
    this.spF02EditorIframeListo = true;
    this.spF02EditorCargando = false;
  }

  actualizarPlantillaSpF02(): void {
    if (this.spF02ActualizandoPlantilla) {
      return;
    }
    this.spF02ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSpF02().subscribe({
      next: (res) => {
        this.aplicarEstadoSpF02(res, false, false, true);
        this.spF02ActualizandoPlantilla = false;
      },
      error: () => {
        this.spF02ActualizandoPlantilla = false;
      }
    });
  }

  private cargarSpF02DesdeServidor(): void {
    this.spF02Cargando = true;
    this.backendService.cargarSpF02Formato().subscribe({
      next: (res) => this.aplicarEstadoSpF02(res),
      error: () => {
        this.spF02Cargando = false;
        this.spF02Vista = 'archivero';
        this.spF02ReporteActivo = null;
        this.spF02Listo = true;
      }
    });
  }

  private sincronizarSpF02DesdeDrive(): void {
    this.backendService.sincronizarSpF02DesdeDrive().subscribe({
      next: (res) => this.aplicarEstadoSpF02(res, false, true, true),
      error: () => { /* silencioso */ }
    });
  }

  private persistirSpF02(): void {
    if (this.spF02Guardando || !this.spF02Listo) {
      return;
    }
    this.spF02Guardando = true;
    this.sincronizarReporteActivoEnFormSpF02();
    this.backendService.guardarSpF02Formato(
      { ...this.spF02Form, reporteActivoId: this.spF02ReporteActivo?.id || this.spF02Form.reporteActivoId },
      false
    ).subscribe({
      next: (res) => {
        this.aplicarEstadoSpF02(res, true, false, true);
        this.spF02CambiosPendientes = false;
        this.spF02Guardando = false;
      },
      error: () => {
        this.spF02Guardando = false;
      }
    });
  }

  private aplicarEstadoSpF02(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.spF02Cargando = false;
      }
      this.spF02Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSpF02Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;
    const activoId = this.spF02ReporteActivo?.id || this.spF02Form.reporteActivoId || null;

    if (!bloquearFormulario && res.datos) {
      this.spF02IgnorarAutoSave = true;
      this.spF02Form = this.normalizarSpF02Form(res.datos);
      if (activoId && this.spF02Form.reportes.some((r) => r.id === activoId)) {
        this.spF02Form.reporteActivoId = activoId;
      } else {
        this.spF02Form.reporteActivoId = null;
      }
      this.spF02ReporteActivo = activoId
        ? this.spF02Form.reportes.find((r) => r.id === activoId) || null
        : null;
      if (!this.spF02ReporteActivo && this.spF02Vista === 'editor') {
        this.spF02Vista = 'archivero';
      }
      setTimeout(() => {
        this.spF02IgnorarAutoSave = false;
      }, 0);
    } else if (conservarEdicion && res.datos) {
      if (sincronizacionSilenciosa) {
        this.fusionarImagenesReporteActivoSpF02(res.datos);
      }
      this.sincronizarReporteActivoEnFormSpF02();
    } else if (conservarEdicion) {
      this.sincronizarReporteActivoEnFormSpF02();
    }

    this.spF02DriveFileId = res.driveFileId || null;
    this.spF02UltimaSync = res.ultimaSyncDrive || null;
    this.spF02ContenidoModificado = !!res.contenidoModificado;
    if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSpF02Editor)) {
      this.fijarEditorEmbedUrlSpF02(res.editorUrl, forzarActualizacionDrive);
    }

    this.spF02Listo = true;
    if (this.spF02Vista === 'editor' && !conservarEdicion) {
      this.ensureReporteActivoSpF02(true);
    }
    if (!sincronizacionSilenciosa) {
      this.spF02Cargando = false;
    }
  }

  private crearSgcF05FormVacio(): SgcF05FormData {
    return {
      fechaElaboracion: '',
      registros: []
    };
  }

  private crearFilaRegistroSgcF05Vacia(): SgcF05RegistroItem {
    return {
      folio: '',
      fuente: '',
      fechaInicio: '',
      fechaCierre: '',
      area: '',
      cliente: '',
      descripcion: '',
      accion: '',
      estatus: ''
    };
  }

  private normalizarRegistrosSgcF05(items: SgcF05RegistroItem[] | undefined): SgcF05RegistroItem[] {
    if (!Array.isArray(items) || !items.length) {
      return [];
    }
    return items.map((item) => ({
      folio: String(item?.folio || '').trim(),
      fuente: String(item?.fuente || '').trim(),
      fechaInicio: String(item?.fechaInicio || '').trim(),
      fechaCierre: String(item?.fechaCierre || '').trim(),
      area: String(item?.area || '').trim(),
      cliente: String(item?.cliente || '').trim(),
      descripcion: String(item?.descripcion || '').trim(),
      accion: String(item?.accion || '').trim(),
      estatus: String(item?.estatus || '').trim()
    }));
  }

  private normalizarSgcF05Form(datos: Partial<SgcF05FormData> | null | undefined): SgcF05FormData {
    const base = datos && typeof datos === 'object' ? datos : {};
    return {
      fechaElaboracion: String(base.fechaElaboracion || '').trim(),
      registros: this.normalizarRegistrosSgcF05(base.registros)
    };
  }

  /** Genera un folio con la nomenclatura NC-DDMMAA-NN para el renglón indicado. */
  generarFolioSgcF05(index: number): void {
    const fila = this.sgcF05Form.registros[index];
    if (!fila) {
      return;
    }
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const aa = String(hoy.getFullYear()).slice(-2);
    const fechaTag = `${dd}${mm}${aa}`;
    const consecutivo = this.siguienteConsecutivoSgcF05(fechaTag, index);
    fila.folio = `NC-${fechaTag}-${String(consecutivo).padStart(2, '0')}`;
    this.onSgcF05Editado();
  }

  private siguienteConsecutivoSgcF05(fechaTag: string, indexActual: number): number {
    let maximo = 0;
    this.sgcF05Form.registros.forEach((r, i) => {
      if (i === indexActual) {
        return;
      }
      const match = String(r.folio || '').match(/^NC-(\d{6})-(\d{1,})$/i);
      if (match && match[1] === fechaTag) {
        const consecutivo = parseInt(match[2], 10);
        if (Number.isFinite(consecutivo) && consecutivo > maximo) {
          maximo = consecutivo;
        }
      }
    });
    return maximo + 1;
  }

  /** Total de no conformidades con estatus abierto (para el resumen del panel). */
  get sgcF05TotalAbiertas(): number {
    return this.sgcF05Form.registros
      .filter((r) => String(r.estatus || '').toLowerCase() === 'abierta').length;
  }

  get sgcF05TotalCerradas(): number {
    return this.sgcF05Form.registros
      .filter((r) => String(r.estatus || '').toLowerCase() === 'cerrada').length;
  }

  /** Registros visibles según el filtro de estatus y el buscador, conservando su índice real. */
  get sgcF05RegistrosVista(): { registro: SgcF05RegistroItem; index: number }[] {
    const q = this.sgcF05Busqueda.trim().toLowerCase();
    return this.sgcF05Form.registros
      .map((registro, index) => ({ registro, index }))
      .filter(({ registro }) => {
        if (this.sgcF05FiltroEstatus && registro.estatus !== this.sgcF05FiltroEstatus) {
          return false;
        }
        if (!q) {
          return true;
        }
        return [registro.folio, registro.fuente, registro.area, registro.cliente, registro.descripcion, registro.accion]
          .some((valor) => String(valor || '').toLowerCase().includes(q));
      });
  }

  trackBySgcF05 = (_: number, item: { index: number }): number => item.index;

  /** Desde la bitácora SGC-F-05 abre el reporte SGC-F-04 del folio indicado. */
  irAReporteDesdeSgcF05(folio: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const folioNorm = String(folio || '').trim();
    if (!folioNorm) {
      return;
    }
    void this.router.navigate(
      ['/sistema-gestion-calidad', 'capitulo-10', 'plantilla', 'sgc-f-04'],
      {
        queryParams: { folio: folioNorm, cap: 'capitulo-10' }
      }
    );
  }

  fijarFiltroSgcF05(estatus: '' | 'Abierta' | 'Cerrada'): void {
    this.sgcF05FiltroEstatus = this.sgcF05FiltroEstatus === estatus ? '' : estatus;
    this.sgcF05Expandida = null;
  }

  toggleExpandirSgcF05(index: number): void {
    this.sgcF05Expandida = this.sgcF05Expandida === index ? null : index;
  }

  /**
   * Al cerrar una NC se registra automáticamente la fecha de cierre;
   * al reabrirla se limpia porque la NC vuelve a estar pendiente.
   */
  onSgcF05EstatusCambiado(registro: SgcF05RegistroItem, estatus: string): void {
    const cerrada = String(estatus || '').toLowerCase() === 'cerrada';
    if (cerrada && !registro.fechaCierre) {
      // Fecha de México (evita desfase UTC al cerrar de noche).
      registro.fechaCierre = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } else if (!cerrada) {
      registro.fechaCierre = '';
    }
  }

  formatearFechaCortaSgcF05(iso: string): string {
    const limpio = String(iso || '').trim();
    const m = limpio.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      return limpio || '—';
    }
    return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  }

  private cargarSgcF05DesdeServidor(): void {
    this.sgcF05Cargando = true;
    this.sgcF05Listo = false;
    this.backendService.cargarSgcF05Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF05(res),
        error: () => {
          this.sgcF05Cargando = false;
          this.sgcF05Listo = true;
        }
      });
  }

  onSgcF05Editado(): void {
    // La bitácora se alimenta desde SGC-F-04; no hay guardado manual de filas.
    return;
  }

  agregarFilaRegistroSgcF05(): void {
    // Limpiar filtros para que la fila nueva sea visible y quede expandida.
    this.sgcF05FiltroEstatus = '';
    this.sgcF05Busqueda = '';
    this.sgcF05Form.registros.push(this.crearFilaRegistroSgcF05Vacia());
    this.sgcF05Expandida = this.sgcF05Form.registros.length - 1;
    this.onSgcF05Editado();
  }

  quitarFilaRegistroSgcF05(index: number): void {
    if (this.sgcF05Form.registros.length <= 1) {
      this.sgcF05Form.registros.splice(0, 1, this.crearFilaRegistroSgcF05Vacia());
      this.sgcF05Expandida = null;
    } else {
      this.sgcF05Form.registros.splice(index, 1);
      if (this.sgcF05Expandida === index) {
        this.sgcF05Expandida = null;
      } else if (this.sgcF05Expandida !== null && this.sgcF05Expandida > index) {
        this.sgcF05Expandida -= 1;
      }
    }
    this.onSgcF05Editado();
  }

  private sincronizarSgcF05DesdeDrive(): void {
    if (this.sgcF05Guardando) {
      return;
    }
    this.sgcF05Guardando = true;
    this.backendService.sincronizarSgcF05DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF05Guardando = false;
          this.aplicarEstadoSgcF05(res, false, false);
        },
        error: () => {
          this.sgcF05Guardando = false;
        }
      });
  }

  private persistirSgcF05(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF05Listo || this.sgcF05Guardando) {
      return;
    }
    this.sgcF05Guardando = true;
    const editorAbierto = this.mostrarSgcF05Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF05Formato(this.sgcF05Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF05Guardando = false;
          this.aplicarEstadoSgcF05(res, editorAbierto, false, false);
        },
        error: () => {
          this.sgcF05Guardando = false;
        }
      });
  }

  toggleSgcF05Editor(): void {
    if (!this.sgcF05DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF05Editor;
    this.mostrarSgcF05Editor = abrir;
    if (abrir) {
      this.sgcF05EditorIframeListo = false;
      this.sgcF05EditorCargando = true;
      this.fijarEditorEmbedUrlSgcF05(this.resolverUrlEditorDrive(this.sgcF05EditorUrl, this.sgcF05DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF05IframeLoad(): void {
    if (this.sgcF05EditorIframeListo) {
      return;
    }
    this.sgcF05EditorIframeListo = true;
    this.sgcF05EditorCargando = false;
  }

  actualizarPlantillaSgcF05(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF05ActualizandoPlantilla) {
      return;
    }
    this.sgcF05ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF05()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF05ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF05(res, false, false, true);
        },
        error: () => {
          this.sgcF05ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlSgcF05(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF05Editor && this.sgcF05EditorEmbedUrlSafe && this.sgcF05EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF05EditorUrl = null;
      this.sgcF05EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF05EditorUrl === url && this.sgcF05EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF05EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF05EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF05(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF05Cargando = false;
      }
      this.sgcF05Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF05Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF05IgnorarAutoSave = true;
      this.sgcF05Listo = false;
      this.sgcF05Form = this.normalizarSgcF05Form(res.datos);
      if (this.sgcF05Expandida !== null && this.sgcF05Expandida >= this.sgcF05Form.registros.length) {
        this.sgcF05Expandida = null;
      }
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF05IgnorarAutoSave = true;
      this.sgcF05Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF05DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF05Editor)) {
        this.fijarEditorEmbedUrlSgcF05(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF05UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF05ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF05IgnorarAutoSave = false;
      this.sgcF05Listo = true;
      if (!bloquearFormulario) {
        this.sgcF05CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.sgcF05Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  get sgcF05IntroLead(): string {
    if (this.plantillaSlug !== 'sgc-f-05') {
      return '';
    }
    return 'Registra las no conformidades con su folio (NC-DDMMAA-NN), fuente, fechas, área, cliente, descripción, acción y estatus. Usa «Guardar información» para conservar los cambios y reflejarlos en el Excel de Drive.';
  }

  private crearAthF08ResultadosVacios(): AthF08Resultado[] {
    return Array.from({ length: this.athF08MaxCursos }, () => '' as AthF08Resultado);
  }

  private crearAthF08AcreditacionesVacias(): AthF08Acreditaciones {
    return { dc3: false, diploma: false, examen: false, otro: false };
  }

  private crearAthF08CursoVacio(): AthF08Curso {
    return {
      nombre: '',
      fecha: '',
      acreditaciones: this.crearAthF08AcreditacionesVacias()
    };
  }

  private crearAthF08ColaboradorVacio(): AthF08Colaborador {
    return { nombre: '', resultados: this.crearAthF08ResultadosVacios() };
  }

  private crearAthF08FormVacio(): AthF08FormData {
    return {
      fecha: '',
      revision: '00',
      fechaRevision: '2026-02-09',
      cursos: [this.crearAthF08CursoVacio()],
      colaboradores: [this.crearAthF08ColaboradorVacio()]
    };
  }

  private normalizarResultadoAthF08(valor: unknown): AthF08Resultado {
    const limpio = String(valor || '').trim().toUpperCase();
    if (limpio === 'A' || limpio === 'APROBADO') return 'A';
    if (limpio === 'NA' || limpio === 'N/A' || limpio === 'NO APROBADO') return 'NA';
    return '';
  }

  private normalizarAthF08Curso(raw: any): AthF08Curso {
    if (typeof raw === 'string') {
      return {
        nombre: raw.trim(),
        fecha: '',
        acreditaciones: this.crearAthF08AcreditacionesVacias()
      };
    }
    return {
      nombre: String(raw?.nombre || '').trim(),
      fecha: String(raw?.fecha || '').trim().slice(0, 10),
      acreditaciones: {
        dc3: !!raw?.acreditaciones?.dc3,
        diploma: !!raw?.acreditaciones?.diploma,
        examen: !!raw?.acreditaciones?.examen,
        otro: !!raw?.acreditaciones?.otro
      }
    };
  }

  private normalizarAthF08Form(raw: any): AthF08FormData {
    const base = this.crearAthF08FormVacio();
    const cursosRaw = Array.isArray(raw?.cursos) ? raw.cursos : [];
    const colsRaw = Array.isArray(raw?.colaboradores) ? raw.colaboradores : [];

    const cursosCompactos: AthF08Curso[] = [];
    const indicesOriginales: number[] = [];
    cursosRaw.forEach((c: any, idx: number) => {
      const curso = this.normalizarAthF08Curso(c);
      if (!(curso.nombre || curso.fecha
        || curso.acreditaciones.dc3 || curso.acreditaciones.diploma
        || curso.acreditaciones.examen || curso.acreditaciones.otro)) {
        return;
      }
      cursosCompactos.push(curso);
      indicesOriginales.push(idx);
    });
    const cursos = cursosCompactos.slice(0, this.athF08MaxCursos);

    const colaboradores = colsRaw
      .map((c: any) => {
        const resultadosRaw = Array.isArray(c?.resultados) ? c.resultados : [];
        return {
          nombre: String(c?.nombre || '').trim(),
          resultados: Array.from({ length: this.athF08MaxCursos }, (_, i) => {
            const origen = indicesOriginales.length ? indicesOriginales[i] : i;
            if (origen === undefined) {
              return '' as AthF08Resultado;
            }
            return this.normalizarResultadoAthF08(resultadosRaw[origen]);
          })
        } as AthF08Colaborador;
      })
      .filter((c: AthF08Colaborador) => c.nombre || c.resultados.some((r) => !!r));

    return {
      fecha: String(raw?.fecha || '').trim().slice(0, 10),
      revision: String(raw?.revision || base.revision).trim().padStart(2, '0').slice(0, 2),
      fechaRevision: String(raw?.fechaRevision || base.fechaRevision).trim().slice(0, 10),
      cursos: cursos.length ? cursos : [this.crearAthF08CursoVacio()],
      colaboradores: colaboradores.length ? colaboradores : [this.crearAthF08ColaboradorVacio()]
    };
  }

  /** Índices de cursos con nombre (columnas visibles en la matriz). */
  get cursosActivosIndicesAthF08(): number[] {
    return (this.athF08Form.cursos || [])
      .map((curso, idx) => ({ curso, idx }))
      .filter((item) => !!String(item.curso?.nombre || '').trim())
      .map((item) => item.idx);
  }

  metricasColaboradorAthF08(col: AthF08Colaborador): { total: number; aprobadas: number; eficacia: number | null } {
    let total = 0;
    let aprobadas = 0;
    for (const idx of this.cursosActivosIndicesAthF08) {
      const r = col?.resultados?.[idx];
      if (!r) continue;
      // A o NA suman al total de capacitaciones.
      total += 1;
      // Solo A suma a capacitaciones aprobadas.
      if (r === 'A') {
        aprobadas += 1;
      }
    }
    return {
      total,
      aprobadas,
      eficacia: total > 0 ? Math.round((aprobadas / total) * 1000) / 10 : null
    };
  }

  get athF08EficaciaGeneral(): number | null {
    let total = 0;
    let aprobadas = 0;
    for (const col of this.athF08Form.colaboradores || []) {
      const m = this.metricasColaboradorAthF08(col);
      total += m.total;
      aprobadas += m.aprobadas;
    }
    if (total <= 0) return null;
    return Math.round((aprobadas / total) * 1000) / 10;
  }

  etiquetaCursoAthF08(index: number): string {
    const curso = this.athF08Form.cursos[index];
    const nombre = String(curso?.nombre || '').trim();
    return nombre || `Curso ${index + 1}`;
  }

  agregarCursoAthF08(): void {
    if (this.athF08Form.cursos.length >= this.athF08MaxCursos) {
      return;
    }
    this.athF08Form.cursos.push(this.crearAthF08CursoVacio());
    this.onAthF08Editado();
  }

  quitarCursoAthF08(index: number): void {
    if (this.athF08Form.cursos.length <= 1) {
      this.athF08Form.cursos.splice(0, 1, this.crearAthF08CursoVacio());
      for (const col of this.athF08Form.colaboradores) {
        col.resultados = this.crearAthF08ResultadosVacios();
      }
    } else {
      this.athF08Form.cursos.splice(index, 1);
      for (const col of this.athF08Form.colaboradores) {
        col.resultados.splice(index, 1);
        while (col.resultados.length < this.athF08MaxCursos) {
          col.resultados.push('');
        }
      }
    }
    this.onAthF08Editado();
  }

  private cargarCatalogoCursosAthF08(): void {
    this.backendService.cursos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const rows: any[] = Array.isArray(res) ? res : (Array.isArray(res?.cursos) ? res.cursos : []);
          const nombres = rows
            .map((c: any) => String(c?.nombre_curso || c?.nombre || '').trim())
            .filter((nombre: string) => !!nombre);
          this.athF08CursosCatalogo = Array.from(new Set<string>(nombres))
            .sort((a, b) => a.localeCompare(b, 'es'));
        },
        error: () => {
          this.athF08CursosCatalogo = [];
        }
      });
  }

  private cargarCatalogoColaboradoresAthF08(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const nombres = usuarios
            .filter((u: any) => !this.esPerfilEmpresaAthF08(u))
            .map((u: any) => this.nombreColaboradorAthF08(u))
            .filter((nombre: string) => !!nombre);
          this.athF08ColaboradoresCatalogo = Array.from(new Set<string>(nombres))
            .sort((a, b) => a.localeCompare(b, 'es'));
        },
        error: () => {
          this.athF08ColaboradoresCatalogo = [];
        }
      });
  }

  private esPerfilEmpresaAthF08(usuario: any): boolean {
    const rol = String(usuario?.rol || '').toLowerCase().trim();
    if (rol === 'empresa' || rol === 'usuario empresa') {
      return true;
    }
    const adicionales = String(usuario?.roles_adicionales || '')
      .toLowerCase()
      .split(/[,;|]/)
      .map((r) => r.trim())
      .filter(Boolean);
    return adicionales.includes('empresa') || adicionales.includes('usuario empresa');
  }

  private nombreColaboradorAthF08(usuario: any): string {
    const nombre = this.quitarCargoAthF08(String(usuario?.nombre || '').trim());
    const apellido = String(usuario?.apellido || '').trim();
    const completo = `${nombre} ${apellido}`.trim();
    return completo || String(usuario?.username || '').trim();
  }

  private quitarCargoAthF08(nombre: string): string {
    return String(nombre || '')
      .replace(/^(Ing\.?|Mtro\.?|Mtra\.?|Dr\.?|Dra\.?|Doc\.?|Lic\.?|Prof\.?|Arq\.?|Q\.?\s*F\.?\s*B\.?|C\.)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  get cursosFiltradosAthF08(): string[] {
    return this.filtrarCatalogoAthF08(
      this.athF08CursosCatalogo,
      this.athF08CursoComboQuery,
      this.athF08CursoComboAbierto === null
        ? ''
        : String(this.athF08Form.cursos[this.athF08CursoComboAbierto]?.nombre || '').trim()
    );
  }

  get colaboradoresFiltradosAthF08(): string[] {
    return this.filtrarCatalogoAthF08(
      this.athF08ColaboradoresCatalogo,
      this.athF08ColabComboQuery,
      this.athF08ColabComboAbierto === null
        ? ''
        : String(this.athF08Form.colaboradores[this.athF08ColabComboAbierto]?.nombre || '').trim()
    );
  }

  /** Texto tipado que no está en catálogo: permite registrar externos. */
  get textoLibreCursoAthF08(): string {
    const q = String(this.athF08CursoComboQuery || '').trim();
    if (!q) {
      return '';
    }
    const existe = this.athF08CursosCatalogo.some(
      (n) => this.normalizarTextoAthF08(n) === this.normalizarTextoAthF08(q)
    );
    return existe ? '' : q;
  }

  get textoLibreColabAthF08(): string {
    const q = String(this.athF08ColabComboQuery || '').trim();
    if (!q) {
      return '';
    }
    const existe = this.athF08ColaboradoresCatalogo.some(
      (n) => this.normalizarTextoAthF08(n) === this.normalizarTextoAthF08(q)
    );
    return existe ? '' : q;
  }

  private filtrarCatalogoAthF08(catalogo: string[], queryRaw: string, seleccionActual: string): string[] {
    const query = this.normalizarTextoAthF08(queryRaw);
    const base = [...catalogo];
    if (seleccionActual && !base.some((n) => this.normalizarTextoAthF08(n) === this.normalizarTextoAthF08(seleccionActual))) {
      base.unshift(seleccionActual);
    }
    if (!query) {
      return base;
    }
    return base.filter((nombre) => this.normalizarTextoAthF08(nombre).includes(query));
  }

  textoComboCursoAthF08(index: number): string {
    if (this.athF08CursoComboAbierto === index) {
      return this.athF08CursoComboQuery;
    }
    return String(this.athF08Form.cursos[index]?.nombre || '');
  }

  textoComboColabAthF08(index: number): string {
    if (this.athF08ColabComboAbierto === index) {
      return this.athF08ColabComboQuery;
    }
    return String(this.athF08Form.colaboradores[index]?.nombre || '');
  }

  abrirComboCursoAthF08(index: number): void {
    this.cerrarComboColabAthF08(true);
    this.athF08CursoComboAbierto = index;
    this.athF08CursoComboQuery = String(this.athF08Form.cursos[index]?.nombre || '');
  }

  abrirComboColabAthF08(index: number): void {
    this.cerrarComboCursoAthF08(true);
    this.athF08ColabComboAbierto = index;
    this.athF08ColabComboQuery = String(this.athF08Form.colaboradores[index]?.nombre || '');
  }

  onFiltroCursoAthF08(index: number, valor: string): void {
    this.athF08CursoComboAbierto = index;
    this.athF08CursoComboQuery = valor;
  }

  onFiltroColabAthF08(index: number, valor: string): void {
    this.athF08ColabComboAbierto = index;
    this.athF08ColabComboQuery = valor;
  }

  seleccionarCursoAthF08(index: number, nombre: string): void {
    const curso = this.athF08Form.cursos[index];
    if (!curso) {
      return;
    }
    curso.nombre = String(nombre || '').trim();
    this.athF08CursoComboAbierto = null;
    this.athF08CursoComboQuery = '';
    this.onAthF08Editado();
  }

  seleccionarColabAthF08(index: number, nombre: string): void {
    const col = this.athF08Form.colaboradores[index];
    if (!col) {
      return;
    }
    col.nombre = String(nombre || '').trim();
    this.athF08ColabComboAbierto = null;
    this.athF08ColabComboQuery = '';
    this.onAthF08Editado();
  }

  /** Confirma el texto tipado (catálogo o externo). */
  confirmarTextoCursoAthF08(index: number): void {
    if (this.athF08CursoComboAbierto !== index) {
      return;
    }
    const texto = String(this.athF08CursoComboQuery || '').trim();
    if (!texto) {
      this.cerrarComboCursoAthF08(true);
      return;
    }
    this.seleccionarCursoAthF08(index, texto);
  }

  confirmarTextoColabAthF08(index: number): void {
    if (this.athF08ColabComboAbierto !== index) {
      return;
    }
    const texto = String(this.athF08ColabComboQuery || '').trim();
    if (!texto) {
      this.cerrarComboColabAthF08(true);
      return;
    }
    this.seleccionarColabAthF08(index, texto);
  }

  limpiarCursoAthF08(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const curso = this.athF08Form.cursos[index];
    if (!curso) {
      return;
    }
    curso.nombre = '';
    this.athF08CursoComboQuery = '';
    this.athF08CursoComboAbierto = index;
    this.onAthF08Editado();
  }

  limpiarColabAthF08(index: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const col = this.athF08Form.colaboradores[index];
    if (!col) {
      return;
    }
    col.nombre = '';
    this.athF08ColabComboQuery = '';
    this.athF08ColabComboAbierto = index;
    this.onAthF08Editado();
  }

  onComboCursoAthF08Keydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cerrarComboCursoAthF08(true);
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primero = this.cursosFiltradosAthF08[0];
      if (primero && !this.textoLibreCursoAthF08) {
        this.seleccionarCursoAthF08(index, primero);
        return;
      }
      this.confirmarTextoCursoAthF08(index);
    }
  }

  onComboColabAthF08Keydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cerrarComboColabAthF08(true);
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primero = this.colaboradoresFiltradosAthF08[0];
      if (primero && !this.textoLibreColabAthF08) {
        this.seleccionarColabAthF08(index, primero);
        return;
      }
      this.confirmarTextoColabAthF08(index);
    }
  }

  private cerrarComboCursoAthF08(descartar = false): void {
    if (!descartar && this.athF08CursoComboAbierto !== null) {
      const idx = this.athF08CursoComboAbierto;
      const texto = String(this.athF08CursoComboQuery || '').trim();
      const curso = this.athF08Form.cursos[idx];
      if (curso && texto && texto !== String(curso.nombre || '').trim()) {
        curso.nombre = texto;
        this.onAthF08Editado();
      } else if (curso && !texto) {
        // Mantener valor previo si vaciaron el filtro sin limpiar explícitamente.
      }
    }
    this.athF08CursoComboAbierto = null;
    this.athF08CursoComboQuery = '';
  }

  private cerrarComboColabAthF08(descartar = false): void {
    if (!descartar && this.athF08ColabComboAbierto !== null) {
      const idx = this.athF08ColabComboAbierto;
      const texto = String(this.athF08ColabComboQuery || '').trim();
      const col = this.athF08Form.colaboradores[idx];
      if (col && texto && texto !== String(col.nombre || '').trim()) {
        col.nombre = texto;
        this.onAthF08Editado();
      }
    }
    this.athF08ColabComboAbierto = null;
    this.athF08ColabComboQuery = '';
  }

  private normalizarTextoAthF08(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private cargarAthF08DesdeServidor(): void {
    this.athF08Cargando = true;
    this.athF08Listo = false;
    this.backendService.cargarAthF08Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF08(res),
        error: () => {
          this.athF08Cargando = false;
          this.athF08Listo = true;
        }
      });
  }

  onAthF08Editado(): void {
    if (!this.athF08Listo || this.athF08IgnorarAutoSave) {
      return;
    }
    this.athF08CambiosPendientes = true;
  }

  agregarColaboradorAthF08(): void {
    if (this.athF08Form.colaboradores.length >= this.athF08MaxColaboradores) {
      return;
    }
    this.athF08Form.colaboradores.push(this.crearAthF08ColaboradorVacio());
    this.onAthF08Editado();
  }

  quitarColaboradorAthF08(index: number): void {
    if (this.athF08Form.colaboradores.length <= 1) {
      this.athF08Form.colaboradores.splice(0, 1, this.crearAthF08ColaboradorVacio());
    } else {
      this.athF08Form.colaboradores.splice(index, 1);
    }
    this.onAthF08Editado();
  }

  private sincronizarAthF08DesdeDrive(): void {
    if (this.athF08Guardando) {
      return;
    }
    this.athF08Guardando = true;
    this.backendService.sincronizarAthF08DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF08Guardando = false;
          this.aplicarEstadoAthF08(res, false, false);
        },
        error: () => {
          this.athF08Guardando = false;
        }
      });
  }

  private persistirAthF08(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.athF08Listo || this.athF08Guardando) {
      return;
    }
    this.athF08Guardando = true;
    const editorAbierto = this.mostrarAthF08Editor;
    const editorActivo = false;
    this.backendService.guardarAthF08Formato(this.athF08Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF08Guardando = false;
          this.aplicarEstadoAthF08(res, editorAbierto, false, false);
        },
        error: () => {
          this.athF08Guardando = false;
        }
      });
  }

  toggleAthF08Editor(): void {
    if (!this.athF08DriveFileId) {
      return;
    }
    const abrir = !this.mostrarAthF08Editor;
    this.mostrarAthF08Editor = abrir;
    if (abrir) {
      this.athF08EditorIframeListo = false;
      this.athF08EditorCargando = true;
      this.fijarEditorEmbedUrlAthF08(this.resolverUrlEditorDrive(this.athF08EditorUrl, this.athF08DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onAthF08IframeLoad(): void {
    if (this.athF08EditorIframeListo) {
      return;
    }
    this.athF08EditorIframeListo = true;
    this.athF08EditorCargando = false;
  }

  actualizarPlantillaAthF08(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.athF08ActualizandoPlantilla) {
      return;
    }
    this.athF08ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaAthF08()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF08ActualizandoPlantilla = false;
          this.aplicarEstadoAthF08(res, false, false, true);
        },
        error: () => {
          this.athF08ActualizandoPlantilla = false;
        }
      });
  }

  private fijarEditorEmbedUrlAthF08(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarAthF08Editor && this.athF08EditorEmbedUrlSafe && this.athF08EditorUrl === url) {
      return;
    }
    if (!url) {
      this.athF08EditorUrl = null;
      this.athF08EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.athF08EditorUrl === url && this.athF08EditorEmbedUrlSafe) {
      return;
    }
    this.athF08EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.athF08EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private contarNombresAthF08(datos: AthF08FormData | null | undefined): { cursos: number; colaboradores: number } {
    const cursos = (datos?.cursos || []).filter((c) => !!String(c?.nombre || '').trim()).length;
    const colaboradores = (datos?.colaboradores || [])
      .filter((c) => !!String(c?.nombre || '').trim()).length;
    return { cursos, colaboradores };
  }

  /**
   * Evita que un sync incompleto (p. ej. catálogo desalineado en Drive)
   * borre nombres que el usuario aún tiene en pantalla.
   */
  private fusionarAthF08PreferirLocal(
    local: AthF08FormData,
    remoto: AthF08FormData
  ): AthF08FormData {
    const loc = this.contarNombresAthF08(local);
    const rem = this.contarNombresAthF08(remoto);
    const preferirCursosLocal = loc.cursos >= rem.cursos;
    const preferirColabLocal = loc.colaboradores >= rem.colaboradores;
    const cursosBase = preferirCursosLocal ? local.cursos : remoto.cursos;
    const cursosAlt = preferirCursosLocal ? remoto.cursos : local.cursos;
    const maxCursos = Math.max(cursosBase.length, cursosAlt.length, 1);
    const cursos = Array.from({ length: maxCursos }, (_, i) => {
      const a = cursosBase[i] || this.crearAthF08CursoVacio();
      const b = cursosAlt[i] || this.crearAthF08CursoVacio();
      return {
        nombre: String(a.nombre || b.nombre || '').trim(),
        fecha: String(a.fecha || b.fecha || '').trim().slice(0, 10),
        acreditaciones: {
          dc3: !!(a.acreditaciones?.dc3 || b.acreditaciones?.dc3),
          diploma: !!(a.acreditaciones?.diploma || b.acreditaciones?.diploma),
          examen: !!(a.acreditaciones?.examen || b.acreditaciones?.examen),
          otro: !!(a.acreditaciones?.otro || b.acreditaciones?.otro)
        }
      } as AthF08Curso;
    }).filter((c) => c.nombre || c.fecha
      || c.acreditaciones.dc3 || c.acreditaciones.diploma
      || c.acreditaciones.examen || c.acreditaciones.otro);

    return {
      fecha: String(local.fecha || remoto.fecha || '').trim().slice(0, 10),
      revision: String(remoto.revision || local.revision || '00').trim().padStart(2, '0').slice(0, 2),
      fechaRevision: String(remoto.fechaRevision || local.fechaRevision || '').trim().slice(0, 10),
      cursos: cursos.length ? cursos.slice(0, this.athF08MaxCursos) : [this.crearAthF08CursoVacio()],
      colaboradores: preferirColabLocal
        ? (local.colaboradores?.length ? local.colaboradores : [this.crearAthF08ColaboradorVacio()])
        : (remoto.colaboradores?.length ? remoto.colaboradores : [this.crearAthF08ColaboradorVacio()])
    };
  }

  private aplicarEstadoAthF08(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.athF08Cargando = false;
      }
      this.athF08Listo = true;
      return;
    }

    const editorAbierto = this.mostrarAthF08Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;
    let conservarDatosLocalesMasCompletos = false;

    if (!bloquearFormulario && res.datos) {
      this.athF08IgnorarAutoSave = true;
      this.athF08Listo = false;
      const remoto = this.normalizarAthF08Form(res.datos);
      const loc = this.contarNombresAthF08(this.athF08Form);
      const rem = this.contarNombresAthF08(remoto);
      if (loc.cursos > rem.cursos || loc.colaboradores > rem.colaboradores) {
        this.athF08Form = this.fusionarAthF08PreferirLocal(this.athF08Form, remoto);
        conservarDatosLocalesMasCompletos = true;
      } else {
        this.athF08Form = remoto;
      }
    } else if (!editorAbierto && !conservarEdicion) {
      this.athF08IgnorarAutoSave = true;
      this.athF08Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.athF08DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarAthF08Editor)) {
        this.fijarEditorEmbedUrlAthF08(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.athF08UltimaSync = res.ultimaSyncDrive || null;
    this.athF08ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.athF08IgnorarAutoSave = false;
      this.athF08Listo = true;
      if (!bloquearFormulario) {
        // Si protegimos datos locales más completos, marcar pendiente para re-guardar a Drive.
        this.athF08CambiosPendientes = conservarDatosLocalesMasCompletos;
      }
      if (!sincronizacionSilenciosa) {
        this.athF08Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  get athF08IntroLead(): string {
    if (this.plantillaSlug !== 'ath-f-08') {
      return '';
    }
    return 'Registra colaboradores y resultados (A / NA). Los cursos del catálogo definen las columnas de la matriz; fecha y acreditación van por curso. Totales y eficacia se calculan solos.';
  }

  trackBySgcF09Id(_index: number, item: SgcF09Requisito): string {
    return item?.id || String(_index);
  }

  trackBySgcF09Seccion(_index: number, grupo: { seccion: string }): string {
    return grupo?.seccion || String(_index);
  }

  private prepararEditorSgcF09(plantilla: PlantillaFormato): void {
    const id = String(plantilla?.driveFileId || '').trim();
    this.sgcF09DriveFileId = id || null;
    this.sgcF09EditorUrl = id
      ? `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit?usp=sharing`
      : null;
    if (this.mostrarSgcF09Editor && this.sgcF09EditorUrl) {
      this.fijarEditorEmbedUrlSgcF09(this.sgcF09EditorUrl, true);
    }
  }

  toggleSgcF09Editor(): void {
    if (!this.sgcF09DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF09Editor;
    this.mostrarSgcF09Editor = abrir;
    if (abrir) {
      this.sgcF09EditorIframeListo = false;
      this.sgcF09EditorCargando = true;
      const url = this.sgcF09EditorUrl
        || `https://docs.google.com/document/d/${encodeURIComponent(this.sgcF09DriveFileId)}/edit?usp=sharing`;
      this.fijarEditorEmbedUrlSgcF09(url, true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF09IframeLoad(): void {
    if (this.sgcF09EditorIframeListo) {
      return;
    }
    this.sgcF09EditorIframeListo = true;
    this.sgcF09EditorCargando = false;
  }

  private fijarEditorEmbedUrlSgcF09(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarSgcF09Editor && this.sgcF09EditorEmbedUrlSafe && this.sgcF09EditorUrl === url) {
      return;
    }
    if (!url) {
      this.sgcF09EditorUrl = null;
      this.sgcF09EditorEmbedUrlSafe = null;
      return;
    }
    this.sgcF09EditorUrl = url;
    const previewUrl = url.replace(/\/edit(?:\?[^#]*)?/i, '/preview');
    const embedUrl = this.urlIframeDriveSegunPermiso(url, previewUrl);
    this.sgcF09EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private agruparRequisitosSgcF09(
    requisitos: SgcF09Requisito[]
  ): Array<{ seccion: string; items: SgcF09Requisito[] }> {
    const grupos: Array<{ seccion: string; items: SgcF09Requisito[] }> = [];
    const mapa = new Map<string, SgcF09Requisito[]>();
    for (const item of requisitos || []) {
      const key = item.seccion || 'Sin sección';
      let lista = mapa.get(key);
      if (!lista) {
        lista = [];
        mapa.set(key, lista);
        grupos.push({ seccion: key, items: lista });
      }
      lista.push(item);
    }
    return grupos;
  }

  private refrescarGruposSgcF09(): void {
    this.sgcF09Grupos = this.agruparRequisitosSgcF09(this.sgcF09Form?.requisitos || []);
  }

  // ===================== DG-F-06 · Cuadro de mando (archivero anual) =====================

  private crearDgF06FormVacio(): DgF06FormData {
    const anioActual = new Date().getFullYear();
    const anios = [anioActual, anioActual - 1];
    const documentos: DgF06Documento[] = [];
    for (const anio of anios) {
      documentos.push(this.crearDocumentoDgF06(anio, 'objetivos'));
      documentos.push(this.crearDocumentoDgF06(anio, 'indicadores'));
    }
    return {
      revision: '00',
      fechaRevision: '2025-01-21',
      documentos
    };
  }

  private crearDocumentoDgF06(anio: number, tipo: DgF06DocTipo): DgF06Documento {
    const esObjetivos = tipo === 'objetivos';
    const titulo = esObjetivos
      ? `Objetivos de calidad ${anio}`
      : `Indicadores de calidad ${anio}`;
    const hojaExcel = esObjetivos
      ? `Objetivos de calidad ${anio}`
      : `Indicadores de proceso ${anio}`;
    return {
      id: `dg-f06-${tipo}-${anio}`,
      anio,
      tipo,
      titulo,
      hojaExcel,
      filas: esObjetivos
        ? this.crearFilasObjetivosDgF06(anio)
        : this.crearFilasIndicadoresDgF06(anio)
    };
  }

  private crearResultadosVaciosDgF06(): DgF06MesResultado[] {
    return this.dgF06Meses.map((mes) => ({ mes, valor: '', estado: '' as DgF06ResultadoEstado }));
  }

  private crearFilasObjetivosDgF06(anio: number): DgF06Fila[] {
    const seed: Array<Omit<DgF06Fila, 'id' | 'resultados'>> = [
      {
        no: 1,
        proceso: 'Lograr la satisfacción de nuestros clientes',
        acciones: '• Seguimiento a encuestas\n• Atención a quejas\n• Mejora de servicio',
        recursos: '• Humanos\n• Tecnológico\n• Tiempo',
        responsable: 'Dirección General',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Satisfacción del cliente',
        operacion: '% personas que respondieron positivamente / total de respuestas',
        meta: 'Mayor o igual a 90%',
        freqMedicion: 'Mensual',
        freqAnalisis: 'Trimestral'
      },
      {
        no: 2,
        proceso: 'Mantener la competencia del personal',
        acciones: '• Programa de capacitación\n• Evaluación de eficacia',
        recursos: '• Humanos\n• Material didáctico',
        responsable: 'Gerente de Admón y Talento Humano',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Eficacia de la capacitación',
        operacion: 'Evaluaciones aprobadas / evaluaciones aplicadas',
        meta: 'Mayor o igual a 90%',
        freqMedicion: 'Por curso',
        freqAnalisis: 'Semestral'
      },
      {
        no: 3,
        proceso: 'Cumplir el programa de auditorías internas',
        acciones: '• Ejecutar SGC-F-07\n• Seguimiento a hallazgos',
        recursos: '• Auditores internos\n• Tiempo',
        responsable: 'Ejecutivo de Sistemas de Gestión',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Cumplimiento del programa de auditoría',
        operacion: 'Auditorías realizadas / programadas',
        meta: '100%',
        freqMedicion: 'Semestral',
        freqAnalisis: 'Anual'
      }
    ];
    return seed.map((fila, idx) => ({
      ...fila,
      id: `dg-f06-obj-${anio}-${idx + 1}`,
      resultados: this.crearResultadosVaciosDgF06()
    }));
  }

  private crearFilasIndicadoresDgF06(anio: number): DgF06Fila[] {
    const seed: Array<Omit<DgF06Fila, 'id' | 'resultados'>> = [
      {
        no: 1,
        proceso: 'Satisfacción del cliente',
        acciones: '• Aplicar encuesta\n• Análisis de comentarios',
        recursos: '• Tiempo\n• Formularios',
        responsable: 'Ejecutivo de Sistemas de Gestión y Capacitación',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Quejas del cliente',
        operacion: 'No aplica',
        meta: '0 quejas',
        freqMedicion: 'Mensual',
        freqAnalisis: 'Mensual'
      },
      {
        no: 2,
        proceso: 'Competencia y capacitación',
        acciones: '• Evaluar eficacia de cursos\n• Seguimiento a DC-3',
        recursos: '• Humanos\n• Tecnológico',
        responsable: 'Gerente de Administración y Talento Humano',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Eficacia de la capacitación',
        operacion: 'Aprobados / evaluados × 100',
        meta: 'Mayor o igual a 90%',
        freqMedicion: 'Por curso',
        freqAnalisis: 'Semestral'
      },
      {
        no: 3,
        proceso: 'Proveeduría externa',
        acciones: '• Evaluación de proveedores\n• Reevaluación anual',
        recursos: '• Tiempo\n• Registros',
        responsable: 'Gerente de Administración y Talento Humano',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Evaluación de proveedores',
        operacion: 'Nivel de riesgo según matriz',
        meta: 'Nivel de riesgo NULO',
        freqMedicion: 'Anual',
        freqAnalisis: 'Anual'
      },
      {
        no: 4,
        proceso: 'Ambiente para la operación de los procesos',
        acciones: '• Monitoreo de condiciones\n• Acciones correctivas',
        recursos: '• Humanos\n• Equipo de medición',
        responsable: 'Ejecutivo de Sistemas de Gestión',
        fechaCompromiso: `Diciembre de ${anio}`,
        indicador: 'Ambiente de operación',
        operacion: 'Clasificación de hallazgos',
        meta: 'Sin condiciones de riesgo alto',
        freqMedicion: 'Mensual',
        freqAnalisis: 'Trimestral'
      }
    ];
    return seed.map((fila, idx) => {
      const resultados = this.crearResultadosVaciosDgF06();
      if (anio === new Date().getFullYear() && idx === 0) {
        resultados[0] = { mes: 'ENE', valor: '0', estado: 'ok' };
        resultados[1] = { mes: 'FEB', valor: '0', estado: 'ok' };
        resultados[2] = { mes: 'MAR', valor: '1', estado: 'risk' };
      }
      return {
        ...fila,
        id: `dg-f06-ind-${anio}-${idx + 1}`,
        resultados
      };
    });
  }

  private agruparAniosDgF06(documentos: DgF06Documento[]): DgF06AnioGrupo[] {
    const mapa = new Map<number, DgF06Documento[]>();
    for (const doc of documentos || []) {
      const lista = mapa.get(doc.anio) || [];
      lista.push(doc);
      mapa.set(doc.anio, lista);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([anio, docs]) => ({
        anio,
        documentos: docs.slice().sort((a, b) => {
          if (a.tipo === b.tipo) {
            return 0;
          }
          return a.tipo === 'objetivos' ? -1 : 1;
        })
      }));
  }

  private refrescarAniosDgF06(): void {
    const q = this.dgF06Busqueda.trim().toLowerCase();
    const docs = (this.dgF06Form?.documentos || []).filter((d) => {
      if (!q) {
        return true;
      }
      return d.titulo.toLowerCase().includes(q)
        || String(d.anio).includes(q)
        || d.tipo.includes(q);
    });
    this.dgF06AniosVista = this.agruparAniosDgF06(docs);
  }

  onBusquedaDgF06(): void {
    this.refrescarAniosDgF06();
  }

  toggleAnioDgF06(anio: number): void {
    this.dgF06AnioExpandido = this.dgF06AnioExpandido === anio ? null : anio;
  }

  abrirDocumentoDgF06(doc: DgF06Documento): void {
    this.dgF06DocActivo = doc;
    this.dgF06Vista = 'documento';
  }

  volverArchiveroDgF06(): void {
    this.dgF06Vista = 'archivero';
    this.dgF06DocActivo = null;
  }

  agregarAnioDgF06(): void {
    const anios = this.dgF06Form.documentos.map((d) => d.anio);
    const nuevo = anios.length ? Math.max(...anios) + 1 : new Date().getFullYear();
    if (anios.includes(nuevo)) {
      return;
    }
    this.dgF06Form.documentos.unshift(this.crearDocumentoDgF06(nuevo, 'objetivos'));
    this.dgF06Form.documentos.unshift(this.crearDocumentoDgF06(nuevo, 'indicadores'));
    this.dgF06AnioExpandido = nuevo;
    this.refrescarAniosDgF06();
  }

  etiquetaTipoDgF06(tipo: DgF06DocTipo): string {
    return tipo === 'objetivos' ? 'Objetivos de calidad' : 'Indicadores de calidad';
  }

  iconoTipoDgF06(tipo: DgF06DocTipo): string {
    return tipo === 'objetivos' ? 'fa-bullseye' : 'fa-chart-bar';
  }

  trackByDgF06Anio(_i: number, g: DgF06AnioGrupo): number {
    return g.anio;
  }

  trackByDgF06Doc(_i: number, d: DgF06Documento): string {
    return d.id;
  }

  trackByDgF06Fila(_i: number, f: DgF06Fila): string {
    return f.id;
  }

  trackByDgF06Mes(_i: number, r: DgF06MesResultado): string {
    return r.mes;
  }

  conteoEstadoDgF06(fila: DgF06Fila, estado: DgF06ResultadoEstado): number {
    if (!fila?.resultados?.length) {
      return 0;
    }
    return fila.resultados.filter((r) => (r.estado || '') === estado).length;
  }

  cicloEstadoResultadoDgF06(r: DgF06MesResultado): void {
    if (!r) {
      return;
    }
    if (!r.estado) {
      r.estado = 'ok';
    } else if (r.estado === 'ok') {
      r.estado = 'risk';
    } else {
      r.estado = '';
    }
  }

  private prepararEditorDgF06(plantilla: PlantillaFormato): void {
    const id = String(plantilla?.driveFileId || '').trim();
    this.dgF06DriveFileId = id || null;
    this.dgF06EditorUrl = id
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?usp=sharing`
      : null;
    if (this.mostrarDgF06Editor && this.dgF06EditorUrl) {
      this.fijarEditorEmbedUrlDgF06(this.dgF06EditorUrl, true);
    }
  }

  toggleDgF06Editor(): void {
    if (!this.dgF06DriveFileId) {
      return;
    }
    const abrir = !this.mostrarDgF06Editor;
    this.mostrarDgF06Editor = abrir;
    if (abrir) {
      this.dgF06EditorIframeListo = false;
      this.dgF06EditorCargando = true;
      const url = this.dgF06EditorUrl
        || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.dgF06DriveFileId)}/edit?usp=sharing`;
      this.fijarEditorEmbedUrlDgF06(url, true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onDgF06IframeLoad(): void {
    if (this.dgF06EditorIframeListo) {
      return;
    }
    this.dgF06EditorIframeListo = true;
    this.dgF06EditorCargando = false;
  }

  private fijarEditorEmbedUrlDgF06(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarDgF06Editor && this.dgF06EditorEmbedUrlSafe && this.dgF06EditorUrl === url) {
      return;
    }
    if (!url) {
      this.dgF06EditorUrl = null;
      this.dgF06EditorEmbedUrlSafe = null;
      return;
    }
    this.dgF06EditorUrl = url;
    const previewUrl = url.replace(/\/edit(?:\?[^#]*)?/i, '/preview');
    const embedUrl = this.urlIframeDriveSegunPermiso(url, previewUrl);
    this.dgF06EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private crearSgcF09FormVacio(): SgcF09FormData {
    return {
      revision: '00',
      fechaRevision: '2025-01-14',
      fecha: '',
      nombreAuditor: '',
      norma9001: true,
      norma45001: false,
      norma14001: false,
      requisitos: this.crearRequisitosSgcF09Base()
    };
  }

  private crearRequisitosSgcF09Base(): SgcF09Requisito[] {
    const base: Array<Omit<SgcF09Requisito, 'id' | 'marca' | 'hallazgo'>> = [
      {
        seccion: 'Contexto de la organización',
        requisito: '4.1',
        descripcion: 'Comprensión de la organización y de su contexto.',
        preguntas:
          '¿Se determinan las cuestiones internas y externas? ¿Con qué frecuencia? ¿Quiénes participan? ¿Cómo se da seguimiento?',
        evidencias: 'FODA, lluvia de ideas, CANVAS, PEST, 5 fuerzas de Porter.'
      },
      {
        seccion: 'Contexto de la organización',
        requisito: '4.2',
        descripcion: 'Comprensión de las necesidades y expectativas de las partes interesadas.',
        preguntas:
          '¿Quiénes son las partes interesadas? ¿Dónde se documentan sus necesidades y expectativas?',
        evidencias: 'Lista maestra de partes interesadas, procedimiento.'
      },
      {
        seccion: 'Contexto de la organización',
        requisito: '4.3',
        descripcion: 'Determinación del alcance del sistema de gestión de la calidad.',
        preguntas:
          '¿Dónde está documentado el alcance? ¿Dónde está disponible? ¿Cuáles son las exclusiones?',
        evidencias: 'Manual, formato, certificado.'
      },
      {
        seccion: 'Contexto de la organización',
        requisito: '4.4',
        descripcion: 'Sistema de gestión de la calidad y sus procesos.',
        preguntas:
          '¿Se han determinado los procesos necesarios? ¿Cómo se gestionan entradas, salidas, controles e indicadores?',
        evidencias: 'Mapa de procesos, fichas de proceso, indicadores.'
      },
      {
        seccion: 'Liderazgo',
        requisito: '5.1',
        descripcion: 'Liderazgo y compromiso.',
        preguntas:
          '¿Cómo demuestra la alta dirección liderazgo y compromiso con el SGC? ¿Se comunican la importancia y los resultados?',
        evidencias: 'Actas de revisión, comunicados, evidencias de participación.'
      },
      {
        seccion: 'Liderazgo',
        requisito: '5.2',
        descripcion: 'Política.',
        preguntas:
          '¿Existe política de calidad? ¿Está disponible, se comunica y se mantiene como información documentada?',
        evidencias: 'SGC-PO-01, difusión, registros de comunicación.'
      },
      {
        seccion: 'Liderazgo',
        requisito: '5.3',
        descripcion: 'Roles, responsabilidades y autoridades en la organización.',
        preguntas:
          '¿Están definidos y comunicados los roles, responsabilidades y autoridades del SGC?',
        evidencias: 'Organigrama, descripciones de puesto, matriz RACI.'
      },
      {
        seccion: 'Planificación',
        requisito: '6.1',
        descripcion: 'Acciones para abordar riesgos y oportunidades.',
        preguntas:
          '¿Se determinan riesgos y oportunidades? ¿Qué acciones se planifican y cómo se evalúa su eficacia?',
        evidencias: 'Matriz de riesgos, planes de acción, seguimiento.'
      },
      {
        seccion: 'Planificación',
        requisito: '6.2',
        descripcion: 'Objetivos de la calidad y planificación para lograrlos.',
        preguntas:
          '¿Hay objetivos medibles? ¿Quién es responsable? ¿Qué recursos y plazos se definen?',
        evidencias: 'Objetivos de calidad, tablero de indicadores, planes.'
      },
      {
        seccion: 'Apoyo',
        requisito: '7.1',
        descripcion: 'Recursos.',
        preguntas:
          '¿Se determinan y proporcionan los recursos necesarios (personas, infraestructura, ambiente, seguimiento)?',
        evidencias: 'Presupuestos, inventarios, mantenimiento, calibración.'
      },
      {
        seccion: 'Apoyo',
        requisito: '7.2',
        descripcion: 'Competencia.',
        preguntas:
          '¿Cómo se determina la competencia requerida? ¿Se mantiene información documentada como evidencia?',
        evidencias: 'Matriz de competencia, DC-3, evaluaciones, capacitación.'
      },
      {
        seccion: 'Apoyo',
        requisito: '7.5',
        descripcion: 'Información documentada.',
        preguntas:
          '¿Cómo se controla la creación, actualización y control de la información documentada?',
        evidencias: 'SGC-F-01, SGC-F-02, SGC-F-03, control de registros.'
      },
      {
        seccion: 'Operación',
        requisito: '8.1',
        descripcion: 'Planificación y control operacional.',
        preguntas:
          '¿Se planifican, implementan y controlan los procesos necesarios para cumplir los requisitos?',
        evidencias: 'Planes de trabajo, instructivos, registros operativos.'
      },
      {
        seccion: 'Operación',
        requisito: '8.2',
        descripcion: 'Requisitos para los productos y servicios.',
        preguntas:
          '¿Cómo se determinan y revisan los requisitos del cliente? ¿Cómo se comunica con el cliente?',
        evidencias: 'Cotizaciones, contratos, bitácoras de atención, quejas.'
      },
      {
        seccion: 'Operación',
        requisito: '8.5',
        descripcion: 'Producción y provisión del servicio.',
        preguntas:
          '¿Existen controles para la provisión del servicio? ¿Cómo se identifica y se preserva el producto/servicio?',
        evidencias: 'Procedimientos operativos, checklists, registros de servicio.'
      },
      {
        seccion: 'Evaluación del desempeño',
        requisito: '9.1',
        descripcion: 'Seguimiento, medición, análisis y evaluación.',
        preguntas:
          '¿Qué se mide? ¿Con qué frecuencia? ¿Cómo se analiza y evalúa el desempeño y la satisfacción del cliente?',
        evidencias: 'Cuadro de mando, encuestas, análisis de indicadores.'
      },
      {
        seccion: 'Evaluación del desempeño',
        requisito: '9.2',
        descripcion: 'Auditoría interna.',
        preguntas:
          '¿Se planifica y realiza el programa de auditoría? ¿Se reportan resultados y se dan seguimientos?',
        evidencias: 'SGC-F-07, SGC-F-08, SGC-F-09, SGC-F-10, evidencias de seguimiento.'
      },
      {
        seccion: 'Evaluación del desempeño',
        requisito: '9.3',
        descripcion: 'Revisión por la dirección.',
        preguntas:
          '¿Se realiza la revisión por la dirección? ¿Se consideran entradas y salidas requeridas por la norma?',
        evidencias: 'Acta de revisión por la dirección, acuerdos y seguimiento.'
      },
      {
        seccion: 'Mejora',
        requisito: '10.2',
        descripcion: 'No conformidad y acción correctiva.',
        preguntas:
          '¿Cómo se reaccionan ante NC? ¿Se analiza causa, se implementan acciones y se verifica eficacia?',
        evidencias: 'SGC-F-04, SGC-F-05, análisis de causa raíz, evidencias de cierre.'
      },
      {
        seccion: 'Mejora',
        requisito: '10.3',
        descripcion: 'Mejora continua.',
        preguntas:
          '¿Cómo se determina e implementa la mejora continua del SGC?',
        evidencias: 'Planes de mejora, proyectos Kaizen, resultados de indicadores.'
      }
    ];

    return base.map((item, index) => ({
      ...item,
      id: `sgc-f09-${item.requisito.replace(/\./g, '-')}-${index}`,
      marca: '' as SgcF09Marca,
      hallazgo: ''
    }));
  }

  iconoTendencia(tendencia: 'up' | 'down' | 'stable'): string {
    if (tendencia === 'up') {
      return 'fa-arrow-trend-up';
    }
    if (tendencia === 'down') {
      return 'fa-arrow-trend-down';
    }
    return 'fa-minus';
  }

  indicadorAvance(indicador: SgcF15Indicador): number {
    return this.porcentajeAvance(indicador.meta, indicador.real);
  }

  porcentajeAvance(meta: string, real: string): number {
    const metaNum = this.valorNumerico(meta);
    const realNum = this.valorNumerico(real);
    if (metaNum <= 0) {
      return Math.min(100, realNum);
    }
    return Math.min(120, Math.round((realNum / metaNum) * 100));
  }

  anchoSerieMeta(valor: number): number {
    return Math.min(100, Math.max(0, valor));
  }

  anchoSerieReal(meta: number, real: number): number {
    if (meta <= 0) {
      return Math.min(100, real);
    }
    return Math.min(120, Math.max(0, (real / meta) * 100));
  }

  private valorNumerico(valor: string | number): number {
    if (typeof valor === 'number') {
      return valor;
    }
    const normalizado = Number(String(valor || '').replace(/[^0-9.]/g, ''));
    if (Number.isFinite(normalizado)) {
      return normalizado;
    }
    return 0;
  }

  esDgF04SeccionOportunidades(seccion: DgF04Seccion): boolean {
    return seccion === 'oportunidades';
  }

  abrirAyudaDgF04(seccion: DgF04Seccion, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.dgF04AyudaSeccion = seccion;
    this.marcarBodyAyudaDgF04(true);
  }

  cerrarAyudaDgF04(): void {
    this.dgF04AyudaSeccion = null;
    this.marcarBodyAyudaDgF04(false);
  }

  private marcarBodyAyudaDgF04(abierto: boolean): void {
    document.body.classList.toggle('dg-f04-ayuda-open', abierto);
    if (abierto) {
      document.body.style.overflow = 'hidden';
    } else if (
      !document.body.classList.contains('dg-f04-ayuda-open')
      && !document.body.classList.contains('sgc-f01-ed-open')
    ) {
      document.body.style.overflow = '';
    }
  }

  tituloAyudaDgF04(seccion: DgF04Seccion): string {
    if (seccion === 'oportunidades') {
      return 'Criterios para la gestión de oportunidades';
    }
    if (seccion === 'fortalezas') {
      return 'Criterios de evaluación · Fortalezas';
    }
    if (seccion === 'debilidades') {
      return 'Criterios Debilidades · Amenazas';
    }
    return 'Criterios Debilidades · Amenazas';
  }

  leadAyudaDgF04(seccion: DgF04Seccion): string {
    if (seccion === 'oportunidades') {
      return 'Use probabilidad e impacto (1–3) para decidir si perseguir, aceptar o declinar la oportunidad.';
    }
    if (seccion === 'fortalezas') {
      return 'Guía de probabilidad e impacto para el registro de factores internos positivos.';
    }
    return 'Medidas cualitativas de probabilidad e impacto y matriz de riesgos para el registro.';
  }

  etiquetaConsOportunidadDgF04(nivel: string): string {
    const map: Record<string, string> = { '1': 'Baja', '2': 'Media', '3': 'Alta' };
    return map[String(nivel)] || '';
  }

  opcionesProbabilidadDgF04(seccion: DgF04Seccion): string[] {
    return this.esDgF04SeccionOportunidades(seccion) ? this.dgF04ProbOportunidad : this.dgF04ProbRiesgo;
  }

  opcionesConsecuenciaDgF04(seccion: DgF04Seccion): string[] {
    return this.esDgF04SeccionOportunidades(seccion) ? this.dgF04ConsOportunidad : this.dgF04ConsRiesgo;
  }

  onDgF04MatrizChange(fila: DgF04Fila, seccion: DgF04Seccion): void {
    fila.resultado = this.calcularResultadoDgF04(fila, seccion);
    this.onDgF04Editado();
  }

  calcularResultadoDgF04(fila: DgF04Fila, seccion: DgF04Seccion): string {
    const prob = String(fila.probabilidad || '').trim().toUpperCase();
    const cons = Number(String(fila.consecuencia || '').trim());
    if (!prob || !cons) {
      return '';
    }

    if (this.esDgF04SeccionOportunidades(seccion)) {
      const probNum = Number(prob);
      if (![1, 2, 3].includes(probNum) || ![1, 2, 3].includes(cons)) {
        return '';
      }
      const matriz: Record<number, Record<number, string>> = {
        3: { 1: 'B', 2: 'A', 3: 'A' },
        2: { 1: 'C', 2: 'B', 3: 'A' },
        1: { 1: 'C', 2: 'C', 3: 'B' }
      };
      const etiquetas: Record<string, string> = {
        A: 'A - Perseguir la oportunidad.',
        B: 'B - Aceptar la oportunidad con condiciones.',
        C: 'C - Declinar la intención de alcanzarla por bajos beneficios.'
      };
      const codigo = matriz[probNum]?.[cons] || '';
      return codigo ? (etiquetas[codigo] || codigo) : '';
    }

    const matriz: Record<string, Record<number, string>> = {
      A: { 1: 'H', 2: 'H', 3: 'E', 4: 'E', 5: 'E' },
      B: { 1: 'M', 2: 'H', 3: 'H', 4: 'E', 5: 'E' },
      C: { 1: 'L', 2: 'M', 3: 'H', 4: 'E', 5: 'E' },
      D: { 1: 'L', 2: 'L', 3: 'M', 4: 'H', 5: 'E' },
      E: { 1: 'L', 2: 'L', 3: 'M', 4: 'H', 5: 'H' }
    };
    const etiquetas: Record<string, string> = {
      E: 'E - Riesgo extremo; requiere acción inmediata',
      H: 'H - Riesgo alto; necesita atención de la alta gerencia',
      M: 'M - Riesgo moderado; debe especificarse responsabilidad gerencial',
      L: 'L - Riesgo bajo; administrar mediante procedimientos de rutina'
    };
    const codigo = matriz[prob]?.[cons] || '';
    return codigo ? (etiquetas[codigo] || codigo) : '';
  }

  claseResultadoDgF04(resultado: string): string {
    const codigo = String(resultado || '').trim().charAt(0).toUpperCase();
    if (!codigo) {
      return '';
    }
    if (codigo === 'E') {
      return 'dg-f04-resultado--extremo';
    }
    if (codigo === 'H') {
      return 'dg-f04-resultado--alto';
    }
    if (codigo === 'M') {
      return 'dg-f04-resultado--moderado';
    }
    if (codigo === 'L') {
      return 'dg-f04-resultado--bajo';
    }
    if (codigo === 'A') {
      return 'dg-f04-resultado--oportunidad-a';
    }
    if (codigo === 'B') {
      return 'dg-f04-resultado--oportunidad-b';
    }
    if (codigo === 'C') {
      return 'dg-f04-resultado--oportunidad-c';
    }
    return '';
  }

  getFilasDgF04(seccion: DgF04Seccion): DgF04Fila[] {
    return this.dgF04Form[seccion];
  }

  agregarFilaDgF04(seccion: DgF04Seccion): void {
    this.dgF04Form[seccion].push(this.crearFilaDgF04Vacia());
    this.onDgF04Editado();
  }

  quitarFilaDgF04(seccion: DgF04Seccion, index: number): void {
    if (this.dgF04Form[seccion].length <= 1) {
      return;
    }
    this.dgF04Form[seccion].splice(index, 1);
    this.onDgF04Editado();
  }

  onDgF04Editado(): void {
    if (!this.dgF04Listo || this.dgF04IgnorarAutoSave) {
      return;
    }
    this.dgF04CambiosPendientes = true;
  }

  onDgF02Editado(): void {
    if (!this.dgF02Listo || this.dgF02IgnorarAutoSave) {
      return;
    }
    this.dgF02CambiosPendientes = true;
  }

  onDgF02RichInput(campo: 'alcance' | 'requisitos'): void {
    if (!this.dgF02Listo || this.dgF02IgnorarAutoSave) {
      return;
    }
    this.sincronizarDgF02CampoDesdeEditor(campo);
    this.dgF02CambiosPendientes = true;
  }

  aplicarFormatoDgF02(event: MouseEvent, comando: 'bold', campo: 'alcance' | 'requisitos'): void {
    event.preventDefault();
    const editor = campo === 'alcance'
      ? this.dgF02AlcanceEditor?.nativeElement
      : this.dgF02RequisitosEditor?.nativeElement;
    if (!editor) {
      return;
    }
    editor.focus();
    document.execCommand(comando, false);
    this.onDgF02RichInput(campo);
  }

  onDgF01Editado(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF01Listo || this.dgF01IgnorarAutoSave) {
      return;
    }
    this.dgF01CambiosPendientes = true;
  }

  onSeleccionarImagenDgF01(event: Event): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) {
      return;
    }
    if (!archivo.type.startsWith('image/')) {
      this.dgF01ErrorImagen = 'Solo se permiten archivos de imagen (JPG, PNG, WebP, etc.).';
      return;
    }
    if (archivo.size > 12 * 1024 * 1024) {
      this.dgF01ErrorImagen = 'La imagen no puede superar 12 MB.';
      return;
    }

    this.dgF01ErrorImagen = null;
    this.dgF01ImagenRespaldoUrl = this.dgF01MapaPreviewUrl;

    const previewLocal = URL.createObjectURL(archivo);
    this.establecerPreviewImagenDgF01(previewLocal);

    const lector = new FileReader();
    lector.onload = () => {
      const resultado = lector.result;
      if (typeof resultado !== 'string') {
        return;
      }
      const base64 = resultado.split(',')[1] || '';
      if (!base64) {
        this.dgF01ErrorImagen = 'No se pudo leer la imagen seleccionada.';
        this.restaurarImagenDgF01Respaldo();
        return;
      }
      this.subirImagenMapaDgF01(base64, archivo.type);
    };
    lector.readAsDataURL(archivo);
  }

  private restaurarImagenDgF01Respaldo(): void {
    if (this.dgF01ImagenRespaldoUrl) {
      this.establecerPreviewImagenDgF01(this.dgF01ImagenRespaldoUrl);
    }
  }

  filasTextoDgF02(texto: string): number {
    if (!texto?.trim()) {
      return 6;
    }
    return Math.max(6, texto.split('\n').length + 1);
  }

  onSeleccionarPdfDgF02(event: Event): void {
    this.procesarPdfDocumento(
      event,
      'DG-F-02 Alcance.pdf',
      (base64, nombre) => this.subirPdfFirmadoDgF02(base64, nombre)
    );
  }

  onSeleccionarPdfDgF01(event: Event): void {
    this.procesarPdfDocumento(
      event,
      'DG-F-01 Mapa de procesos.pdf',
      (base64, nombre) => this.subirPdfFirmadoDgF01(base64, nombre)
    );
  }

  toggleDgF01PdfViewer(): void {
    const id = this.dgF01Form.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }

    const abrir = !this.mostrarDgF01PdfViewer;
    this.mostrarDgF01PdfViewer = abrir;

    if (abrir) {
      this.dgF01PdfCargando = true;
      const url = `https://drive.google.com/file/d/${id}/preview`;
      this.dgF01PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.dgF01PdfEmbedUrlSafe = null;
    this.dgF01PdfCargando = false;
  }

  onDgF01PdfIframeLoad(): void {
    this.dgF01PdfCargando = false;
  }

  onDgF01PdfVistaLoad(): void {
    this.dgF01PdfVistaCargando = false;
  }

  private actualizarVistaPdfDgF01(): void {
    const id = this.dgF01Form.pdfFirmado?.driveFileId;
    if (!id) {
      this.dgF01PdfVistaUrlSafe = null;
      this.dgF01PdfVistaCargando = false;
      return;
    }

    const preview = this.dgF01Form.pdfFirmado?.previewUrl
      || `https://drive.google.com/file/d/${id}/preview`;
    this.dgF01PdfVistaCargando = true;
    this.dgF01PdfVistaUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(preview);
  }

  toggleDgF02PdfViewer(): void {
    const id = this.dgF02Form.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }

    const abrir = !this.mostrarDgF02PdfViewer;
    this.mostrarDgF02PdfViewer = abrir;

    if (abrir) {
      this.dgF02PdfCargando = true;
      const url = `https://drive.google.com/file/d/${id}/preview`;
      this.dgF02PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.dgF02PdfEmbedUrlSafe = null;
    this.dgF02PdfCargando = false;
  }

  onDgF02PdfIframeLoad(): void {
    this.dgF02PdfCargando = false;
  }

  guardarInformacionDgF01(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    this.persistirDgF01();
  }

  guardarInformacionDocumentoWord(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.plantillaSlug === 'dg-f-02') {
      this.persistirDgF02();
      return;
    }
    if (this.plantillaSlug === 'sgc-po-01') {
      this.persistirSgcPo01();
      return;
    }
    if (this.plantillaSlug === 'dg-f-08') {
      this.persistirDgF08();
      return;
    }
    if (this.plantillaSlug === 'dg-f-03') {
      this.persistirDgF03();
    }
  }

  private revocarDgF01PreviewUrl(): void {
    if (this.dgF01MapaPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.dgF01MapaPreviewUrl);
    }
  }

  private cargarDgF01DesdeServidor(): void {
    this.dgF01Cargando = true;
    this.dgF01Listo = false;
    this.backendService.cargarDgF01Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF01(res),
        error: () => {
          this.dgF01Cargando = false;
          this.dgF01Listo = true;
          this.actualizarVistaPdfDgF01();
        }
      });
  }

  private cargarSgcF06DesdeServidor(): void {
    this.sgcF06Cargando = true;
    this.sgcF06Listo = false;
    this.backendService.cargarSgcF06Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF06(res),
        error: () => {
          this.sgcF06Cargando = false;
          this.sgcF06Listo = true;
        }
      });
  }

  onSgcF06Editado(): void {
    if (!this.sgcF06Listo) {
      return;
    }
    this.sgcF06Auditores.forEach((auditor) => this.recalcularAuditorSgcF06(auditor));
    this.sgcF06CambiosPendientes = true;
  }

  agregarAuditorSgcF06(): void {
    this.sgcF06Auditores.push({
      nombre: '',
      puesto: '',
      tiempoEmpresa: '',
      escolaridad: '',
      cursoAuditoresInternos: '',
      calificacionCurso: null,
      nivelObjetividad: '',
      desempeno: '',
      promedio: null,
      auditoriasRealizadas: 0
    });
    this.onSgcF06Editado();
  }

  eliminarAuditorSgcF06(index: number): void {
    if (this.sgcF06Auditores.length > 1) {
      this.sgcF06Auditores.splice(index, 1);
      this.onSgcF06Editado();
    }
  }

  private sincronizarSgcF06DesdeDrive(): void {
    if (this.sgcF06Guardando) {
      return;
    }
    this.sgcF06Guardando = true;
    this.backendService.sincronizarSgcF06DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF06Guardando = false;
          this.aplicarEstadoSgcF06(res, false, false);
        },
        error: () => {
          this.sgcF06Guardando = false;
        }
      });
  }

  private persistirSgcF06(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF06Listo || this.sgcF06Guardando) {
      return;
    }
    this.sgcF06Guardando = true;
    const editorAbierto = this.mostrarSgcF06Editor;
    const editorActivo = false;
    const payload = this.obtenerDatosSgcF06ParaGuardar();
    this.backendService.guardarSgcF06Formato(payload, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF06Guardando = false;
          this.aplicarEstadoSgcF06(res, editorAbierto, false, false);
          if (res?.success && res.datos?.auditores) {
            const auditores = this.normalizarAuditoresSgcF06(res.datos.auditores);
            this.sgcF06Auditores = auditores;
          }
        },
        error: () => {
          this.sgcF06Guardando = false;
        }
      });
  }

  toggleSgcF06Editor(): void {
    if (!this.sgcF06DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF06Editor;
    this.mostrarSgcF06Editor = abrir;
    if (abrir) {
      this.sgcF06EditorIframeListo = false;
      this.sgcF06EditorCargando = true;
      this.fijarSgcF06EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF06EditorUrl, this.sgcF06DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF06IframeLoad(): void {
    if (this.sgcF06EditorIframeListo) {
      return;
    }
    this.sgcF06EditorIframeListo = true;
    this.sgcF06EditorCargando = false;
  }

  private actualizarPlantillaSgcF06(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF06ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF06Editor) {
      this.mostrarSgcF06Editor = false;
      this.sgcF06EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    this.sgcF06ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF06()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF06ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF06(res, false, false, true);
        },
        error: () => {
          this.sgcF06ActualizandoPlantilla = false;
        }
      });
  }

  private aplicarEstadoSgcF06(
    res: any,
    conservarDatos = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF06Cargando = false;
      }
      this.sgcF06Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF06Editor && !forzarActualizacionDrive;

    if (!conservarDatos && res.datos) {
      const auditores = this.normalizarAuditoresSgcF06(res.datos.auditores);
      this.sgcF06Auditores = auditores;
      this.sgcF06Resumen = this.normalizarResumenSgcF06(res.datos.resumen, auditores);
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF06DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF06Editor)) {
        this.fijarSgcF06EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF06UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF06ContenidoModificado = !!res.contenidoModificado;
    this.sgcF06CambiosPendientes = false;

    window.setTimeout(() => {
      this.sgcF06Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF06Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private obtenerDatosSgcF06ParaGuardar() {
    const auditores = this.prepararAuditoresParaGuardarSgcF06();
    return {
      resumen: this.normalizarResumenSgcF06(this.sgcF06Resumen, auditores),
      auditores
    };
  }

  private prepararAuditoresParaGuardarSgcF06(): SgcF06Auditor[] {
    return this.sgcF06Auditores.map((auditor) => {
      const recalculado = this.recalcularAuditorSgcF06({ ...auditor });
      if (!this.auditorSgcF06TieneContenido(recalculado)) {
        return {
          nombre: '',
          puesto: '',
          tiempoEmpresa: '',
          escolaridad: '',
          cursoAuditoresInternos: '',
          calificacionCurso: null,
          nivelObjetividad: '',
          desempeno: '',
          promedio: null,
          auditoriasRealizadas: 0
        };
      }
      return {
        ...recalculado,
        cursoAuditoresInternos: this.normalizarCursoSgcF06(recalculado.cursoAuditoresInternos),
        auditoriasRealizadas: Number(recalculado.auditoriasRealizadas) || 0
      };
    });
  }

  private auditorSgcF06TieneContenido(auditor: SgcF06Auditor): boolean {
    return !!(
      String(auditor?.nombre || '').trim()
      || String(auditor?.puesto || '').trim()
      || auditor?.calificacionCurso != null
      || String(auditor?.nivelObjetividad ?? '').trim() !== ''
      || String(auditor?.desempeno ?? '').trim() !== ''
      || String(auditor?.cursoAuditoresInternos ?? '').trim() !== ''
      || (Number(auditor?.auditoriasRealizadas) || 0) > 0
    );
  }

  private normalizarCursoSgcF06(valor: string | null | undefined): string {
    const estado = String(valor || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (estado === 'aprobado' || estado === 'a') {
      return 'Aprobado';
    }
    if (
      estado === 'no aprobado'
      || estado === 'reprobado'
      || estado === 'na'
      || estado === 'n/a'
    ) {
      return 'No aprobado';
    }
    return '';
  }

  private recalcularAuditorSgcF06(auditor: SgcF06Auditor): SgcF06Auditor {
    const calif = this.valorNumericoSgcF06(auditor.calificacionCurso);
    const nivel = this.valorNumericoSgcF06(auditor.nivelObjetividad);
    const desempeno = this.valorNumericoSgcF06(auditor.desempeno);
    let promedio: number | null = null;
    if (calif !== null && nivel !== null && desempeno !== null) {
      promedio = Math.round(((calif + nivel + desempeno) / 3) * 10) / 10;
    }
    auditor.promedio = promedio;
    auditor.cursoAuditoresInternos = this.normalizarCursoSgcF06(auditor.cursoAuditoresInternos);
    return auditor;
  }

  private valorNumericoSgcF06(valor: string | number | null | undefined): number | null {
    if (valor === null || valor === undefined || valor === '') {
      return null;
    }
    const numero = Number(String(valor).replace(',', '.').trim());
    return Number.isFinite(numero) ? numero : null;
  }

  private normalizarResumenSgcF06(resumen: Partial<SgcF06Resumen> | undefined, auditores: SgcF06Auditor[]): SgcF06Resumen {
    const base = resumen && typeof resumen === 'object' ? resumen : {};
    const activos = Number(base.activos);
    const acreditados = Number(base.acreditados);
    const enEntrenamiento = Number(base.enEntrenamiento);
    const auditoresCalculados = auditores.map((auditor) => this.recalcularAuditorSgcF06({ ...auditor }));
    const conContenido = auditoresCalculados.filter((auditor) => this.auditorSgcF06TieneContenido(auditor));
    const calculados = {
      activos: conContenido.length,
      acreditados: conContenido.filter((a) => a.cursoAuditoresInternos === 'Aprobado').length,
      enEntrenamiento: conContenido.filter((a) => a.cursoAuditoresInternos === 'No aprobado').length
    };
    return {
      activos: Number.isFinite(activos) ? activos : calculados.activos,
      acreditados: Number.isFinite(acreditados) ? acreditados : calculados.acreditados,
      enEntrenamiento: Number.isFinite(enEntrenamiento) ? enEntrenamiento : calculados.enEntrenamiento
    };
  }

  private normalizarAuditoresSgcF06(lista: any): SgcF06Auditor[] {
    if (!Array.isArray(lista)) {
      return [];
    }
    const auditores = lista.map((item) => {
      const auditor: SgcF06Auditor = {
        nombre: String(item?.nombre || '').trim(),
        puesto: String(item?.puesto || item?.rol || '').trim(),
        tiempoEmpresa: String(item?.tiempoEmpresa || item?.experiencia || '').trim(),
        escolaridad: String(item?.escolaridad || '').trim(),
        cursoAuditoresInternos: this.normalizarCursoSgcF06(
          item?.cursoAuditoresInternos || item?.cursoAuditores || ''
        ),
        calificacionCurso:
          item?.calificacionCurso === null || item?.calificacionCurso === undefined
            ? null
            : Number(item?.calificacionCurso),
        nivelObjetividad: String(item?.nivelObjetividad ?? item?.nivel ?? '').trim(),
        desempeno: String(item?.desempeno ?? '').trim(),
        promedio:
          item?.promedio === null || item?.promedio === undefined ? null : Number(item?.promedio),
        auditoriasRealizadas: Number(
          item?.auditoriasRealizadas ?? item?.auditorias ?? item?.auditoriasRealizadasNumero ?? 0
        ) || 0
      };
      return this.recalcularAuditorSgcF06(auditor);
    });

    if (auditores.length === 10) {
      return auditores;
    }

    return auditores.filter((auditor) => this.auditorSgcF06TieneContenido(auditor));
  }

  private fijarSgcF06EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF06EditorUrl = null;
      this.sgcF06EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF06EditorUrl === url && this.sgcF06EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF06EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF06EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private cargarPreviewImagenDgF01(version: number | string | null, fallbackAsset = false): void {
    this.backendService.obtenerImagenDgF01Mapa(version)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          if (!this.esBlobImagenValido(blob)) {
            this.usarFallbackImagenDgF01(fallbackAsset, version);
            return;
          }
          this.establecerPreviewImagenDgF01(URL.createObjectURL(blob));
        },
        error: () => {
          this.usarFallbackImagenDgF01(fallbackAsset, version);
        }
      });
  }

  private establecerPreviewImagenDgF01(url: string | null): void {
    if (!url) {
      return;
    }
    if (this.dgF01MapaPreviewUrl?.startsWith('blob:') && this.dgF01MapaPreviewUrl !== url) {
      URL.revokeObjectURL(this.dgF01MapaPreviewUrl);
    }
    this.dgF01MapaPreviewUrl = url;
  }

  private esBlobImagenValido(blob: Blob): boolean {
    if (!blob || blob.size < 512) {
      return false;
    }
    const type = String(blob.type || '');
    return !type || type.startsWith('image/') || type === 'application/octet-stream';
  }

  private usarFallbackImagenDgF01(fallbackAsset: boolean, version: number | string | null): void {
    if (!fallbackAsset || !this.plantilla?.imagenVistaAssetPath) {
      return;
    }
    const bust = version != null && version !== '' ? `?v=${encodeURIComponent(String(version))}` : '';
    this.establecerPreviewImagenDgF01(`${this.plantilla.imagenVistaAssetPath}${bust}`);
  }

  private persistirDgF01(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF01Listo || this.dgF01Guardando) {
      return;
    }
    this.dgF01Guardando = true;
    this.backendService.guardarDgF01Formato(this.dgF01Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF01Guardando = false;
          this.dgF01CambiosPendientes = false;
          this.aplicarEstadoDgF01(res, true);
        },
        error: () => {
          this.dgF01Guardando = false;
        }
      });
  }

  private subirImagenMapaDgF01(imagenBase64: string, mimeType: string): void {
    if (!this.puedeGestionarPlantillasSgc || this.dgF01SubiendoImagen) {
      return;
    }
    this.dgF01SubiendoImagen = true;
    this.backendService.subirImagenMapaDgF01(imagenBase64, mimeType)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF01SubiendoImagen = false;
          this.dgF01ErrorImagen = null;
          this.dgF01ImagenRespaldoUrl = null;
          this.aplicarEstadoDgF01(res, true);
          if (res?.imagenDataUrl) {
            this.establecerPreviewImagenDgF01(res.imagenDataUrl);
          }
        },
        error: (err) => {
          this.dgF01SubiendoImagen = false;
          this.dgF01ErrorImagen = err?.error?.message || err?.error?.error || 'No se pudo subir la imagen a Google Drive.';
          this.restaurarImagenDgF01Respaldo();
        }
      });
  }

  private aplicarEstadoDgF01(res: any, conservarEdicion = false): void {
    if (!res?.success) {
      this.dgF01Cargando = false;
      this.dgF01Listo = true;
      return;
    }

    if (!conservarEdicion && res.datos) {
      this.dgF01IgnorarAutoSave = true;
      this.dgF01Listo = false;
      const d = res.datos;
      this.dgF01Form = {
        codigo: d.codigo ?? this.dgF01Form.codigo,
        revision: d.revision ?? this.dgF01Form.revision,
        fechaRevision: d.fechaRevision ?? this.dgF01Form.fechaRevision,
        imagenMapa: d.imagenMapa ?? this.dgF01Form.imagenMapa,
        pdfFirmado: d.pdfFirmado ?? res.pdfFirmado ?? this.dgF01Form.pdfFirmado
      };
    }

    this.dgF01UltimaSync = res.ultimaSyncDrive || null;
    this.dgF01ImagenVersion = res.imagenVersion ?? this.dgF01ImagenVersion;
    this.actualizarVistaPdfDgF01();

    setTimeout(() => {
      this.dgF01IgnorarAutoSave = false;
      this.dgF01Listo = true;
      this.dgF01Cargando = false;
    }, 0);
  }

  private cargarDgF02DesdeServidor(): void {
    this.dgF02Cargando = true;
    this.dgF02Listo = false;
    this.backendService.cargarDgF02Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF02(res),
        error: () => {
          this.dgF02Cargando = false;
          this.dgF02Listo = true;
        }
      });
  }

  private persistirDgF02(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF02Listo || this.dgF02Guardando) {
      return;
    }
    this.sincronizarDgF02FormDesdeEditores();
    this.dgF02Guardando = true;
    this.backendService.guardarDgF02Formato(this.dgF02Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF02Guardando = false;
          this.dgF02CambiosPendientes = false;
          this.aplicarEstadoDgF02(res);
        },
        error: () => {
          this.dgF02Guardando = false;
        }
      });
  }

  private subirPdfFirmadoDgF02(pdfBase64: string, nombreArchivo: string): void {
    if (this.dgF02SubiendoPdf) {
      return;
    }
    this.dgF02SubiendoPdf = true;
    this.backendService.subirPdfFirmadoDgF02(pdfBase64, nombreArchivo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF02SubiendoPdf = false;
          this.aplicarEstadoDgF02(res);
          this.finalizarSubidaPdfSgc(!!res?.success, nombreArchivo);
        },
        error: () => {
          this.dgF02SubiendoPdf = false;
          this.finalizarSubidaPdfSgc(false);
        }
      });
  }

  private subirPdfFirmadoDgF01(pdfBase64: string, nombreArchivo: string): void {
    if (this.dgF01SubiendoPdf) {
      return;
    }
    this.dgF01SubiendoPdf = true;
    this.backendService.subirPdfFirmadoDgF01(pdfBase64, nombreArchivo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF01SubiendoPdf = false;
          this.aplicarEstadoDgF01(res);
          this.finalizarSubidaPdfSgc(!!res?.success, nombreArchivo);
        },
        error: () => {
          this.dgF01SubiendoPdf = false;
          this.finalizarSubidaPdfSgc(false);
        }
      });
  }

  private aplicarEstadoDgF02(res: any): void {
    if (!res?.success) {
      this.dgF02Cargando = false;
      this.dgF02Listo = true;
      return;
    }

    if (res.datos) {
      this.dgF02IgnorarAutoSave = true;
      this.dgF02Listo = false;
      const d = res.datos;
      this.dgF02Form = {
        empresa: d.empresa ?? this.dgF02Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.dgF02Form.fechaElaboracion,
        alcance: d.alcance ?? this.dgF02Form.alcance,
        requisitosNoAplicables: d.requisitosNoAplicables ?? this.dgF02Form.requisitosNoAplicables,
        pdfFirmado: d.pdfFirmado ?? res.pdfFirmado ?? this.dgF02Form.pdfFirmado
      };
    }

    this.dgF02UltimaSync = res.ultimaSyncDrive || null;
    this.dgF02ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.dgF02IgnorarAutoSave = false;
      this.dgF02Listo = true;
      this.dgF02Cargando = false;
      this.poblarEditoresDgF02();
    }, 350);
  }

  private sincronizarDgF02FormDesdeEditores(): void {
    this.sincronizarDgF02CampoDesdeEditor('alcance');
    this.sincronizarDgF02CampoDesdeEditor('requisitos');
  }

  private sincronizarDgF02CampoDesdeEditor(campo: 'alcance' | 'requisitos'): void {
    const editor = campo === 'alcance'
      ? this.dgF02AlcanceEditor?.nativeElement
      : this.dgF02RequisitosEditor?.nativeElement;
    if (!editor) {
      return;
    }
    const html = this.sanitizarHtmlDgF02(editor.innerHTML);
    if (campo === 'alcance') {
      this.dgF02Form.alcance = html;
    } else {
      this.dgF02Form.requisitosNoAplicables = html;
    }
  }

  private poblarEditoresDgF02(): void {
    if (this.plantillaSlug !== 'dg-f-02') {
      return;
    }
    const alcanceEl = this.dgF02AlcanceEditor?.nativeElement;
    const reqEl = this.dgF02RequisitosEditor?.nativeElement;
    if (alcanceEl) {
      alcanceEl.innerHTML = this.aHtmlDgF02(this.dgF02Form.alcance);
    }
    if (reqEl) {
      reqEl.innerHTML = this.aHtmlDgF02(this.dgF02Form.requisitosNoAplicables);
    }
  }

  private aHtmlDgF02(texto: string | null | undefined): string {
    const val = String(texto || '').trim();
    if (!val) {
      return '';
    }
    if (val.includes('<')) {
      return this.sanitizarHtmlDgF02(val);
    }
    return val
      .split(/\n\n+/)
      .map((parrafo) => `<p>${parrafo.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  private sanitizarHtmlDgF02(html: string): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['b', 'strong', 'br', 'p', 'div'],
      ALLOWED_ATTR: []
    });
  }

  private cancelarAutoSaveDgF04(): void {
    if (this.dgF04SaveTimer !== null) {
      window.clearTimeout(this.dgF04SaveTimer);
      this.dgF04SaveTimer = null;
    }
  }

  toggleDgF04Editor(): void {
    if (!this.dgF04DriveFileId) {
      return;
    }

    const abrir = !this.mostrarDgF04Editor;

    if (abrir) {
      if (this.dgF04Guardando) {
        return;
      }
      this.abrirPanelEditorDgF04();
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.mostrarDgF04Editor = false;
  }

  private abrirPanelEditorDgF04(): void {
    this.mostrarDgF04Editor = true;
    this.dgF04EditorIframeListo = false;
    this.dgF04EditorCargando = true;
    this.fijarEditorEmbedUrlDgF04(this.resolverUrlEditorDrive(this.dgF04EditorUrl, this.dgF04DriveFileId), true);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private persistirDgF04Inmediato(alExito?: () => void): void {
    if (!this.puedeGestionarPlantillasSgc) {
      alExito?.();
      return;
    }
    if (!this.dgF04Listo || this.dgF04Guardando) {
      alExito?.();
      return;
    }
    this.cancelarAutoSaveDgF04();
    this.dgF04Guardando = true;
    this.backendService.guardarDgF04Formato(this.dgF04Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF04Guardando = false;
          this.dgF04CambiosPendientes = false;
          this.aplicarEstadoDgF04(res, false, false, false);
          alExito?.();
        },
        error: () => {
          this.dgF04Guardando = false;
          alExito?.();
        }
      });
  }

  onDgF04IframeLoad(): void {
    if (this.dgF04EditorIframeListo) {
      return;
    }
    this.dgF04EditorIframeListo = true;
    this.dgF04EditorCargando = false;
  }

  actualizarPlantillaDgF04(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.dgF04ActualizandoPlantilla) {
      return;
    }

    if (this.mostrarDgF04Editor) {
      this.mostrarDgF04Editor = false;
      this.dgF04EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }

    this.dgF04ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaDgF04()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF04ActualizandoPlantilla = false;
          this.aplicarEstadoDgF04(res, false, false, true);
        },
        error: () => {
          this.dgF04ActualizandoPlantilla = false;
        }
      });
  }

  trackByDgF04Seccion(_: number, sec: DgF04SeccionConfig): string {
    return sec.key;
  }

  trackByDgF07Slug(_: number, p: { slug: string }): string {
    return p.slug;
  }

  seleccionarProcesoDgF07(slug: string): void {
    this.dgF07ProcesoActivoSlug = slug;
    this.dgF07Busqueda = '';
    this.dgF07PanelBusquedaAbierto = false;
    window.setTimeout(() => this.scrollDgF07TabActivo(), 0);
  }

  abrirBusquedaDgF07(): void {
    this.dgF07PanelBusquedaAbierto = true;
  }

  onBusquedaDgF07Keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.dgF07PanelBusquedaAbierto = false;
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const primero = this.dgF07ProcesosBusqueda[0];
    if (primero) {
      this.seleccionarProcesoDgF07(primero.slug);
    }
  }

  private normalizarBusquedaDgF07(texto: string): string {
    return (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private coincideBusquedaDgF07(proceso: DgF07ProcesoDef, consulta: string): boolean {
    const campos = [proceso.etiqueta, proceso.nombreProceso, proceso.slug.replace(/-/g, ' ')];
    return campos.some(campo => this.normalizarBusquedaDgF07(campo).includes(consulta));
  }

  @HostListener('document:click', ['$event'])
  cerrarBusquedaDgF07SiFuera(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.sgcF06TipAbierto && !target?.closest('.sgc-f-06-table__col--nivel, .sgc-f-06-table__col--desempeno')) {
      this.cerrarTipSgcF06();
    }
    if (this.sgcF29TipAbierto && !target?.closest('.sgc-f-29-table__col--score')) {
      this.cerrarTipSgcF29();
    }
    if (target && !target.closest('.ath-f-08-combo')) {
      if (this.athF08CursoComboAbierto !== null) {
        this.cerrarComboCursoAthF08();
      }
      if (this.athF08ColabComboAbierto !== null) {
        this.cerrarComboColabAthF08();
      }
      if (this.sgcF16AsistComboAbierto !== null) {
        this.cerrarComboAsistSgcF16();
      }
    }
    if (this.sgcF04ComboCampo && target && !target.closest('.sgc-f-04-combo')) {
      this.cerrarComboSgcF04();
    }
    if (target && !target.closest('.sgc-f-02-combo')) {
      if (this.sgcF02SolicitanteComboAbierto) {
        this.cerrarComboSolicitanteSgcF02();
      }
      if (this.sgcF02DocComboAbierto) {
        this.cerrarComboDocSgcF02();
      }
    }
    if (this.sgcF10ComboAbierto && target && !target.closest('.sgc-f-10-combo')) {
      this.cerrarComboSgcF10();
    }
    if (this.sgcF10ClasifAbierto !== null && target && !target.closest('.sgc-f-10-clasif')) {
      this.cerrarClasifSgcF10();
    }
    if (this.plantillaSlug !== 'dg-f-07' || !this.dgF07PanelBusquedaAbierto) {
      return;
    }
    if (!target?.closest('.dg-f07-nav__search-wrap')) {
      this.dgF07PanelBusquedaAbierto = false;
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDownMetodologiaAmef(event: MouseEvent): void {
    if (!this.esMetodologiaAmef) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.amef-slides-shell')) {
      this.activarScrollGuardMetodologiaAmef();
      return;
    }
    this.liberarScrollMetodologiaAmef();
  }

  @HostListener('window:blur')
  onWindowBlurMetodologiaAmef(): void {
    if (!this.esMetodologiaAmef) {
      return;
    }
    this.activarScrollGuardMetodologiaAmef();
    this.programarRestauracionScrollMetodologiaAmef();
  }

  @HostListener('window:focus')
  onWindowFocusMetodologiaAmef(): void {
    if (!this.esMetodologiaAmef) {
      return;
    }
    window.setTimeout(() => {
      if (!this.esIframeAmefActivo()) {
        this.liberarScrollMetodologiaAmef();
      }
    }, 0);
  }

  @HostListener('window:scroll')
  onWindowScrollMetodologiaAmef(): void {
    if (!this.esMetodologiaAmef || !this.metodologiaAmefIframeEnUso || this.metodologiaAmefRestaurandoScroll) {
      return;
    }
    const current = this.obtenerScrollVentana();
    if (Math.abs(current - this.metodologiaAmefScrollAncla) <= 3) {
      return;
    }
    if (this.esIframeAmefActivo()) {
      this.restaurarScrollMetodologiaAmefSiSalto();
      return;
    }
    this.metodologiaAmefScrollAncla = current;
  }

  onAmefSlidesShellPointerDown(): void {
    if (!this.esMetodologiaAmef) {
      return;
    }
    this.activarScrollGuardMetodologiaAmef();
  }

  private obtenerScrollVentana(): number {
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  private esIframeAmefActivo(): boolean {
    const iframe = this.amefSlidesFrame?.nativeElement;
    return !!iframe && document.activeElement === iframe;
  }

  private activarScrollGuardMetodologiaAmef(): void {
    this.metodologiaAmefScrollAncla = this.obtenerScrollVentana();
    this.metodologiaAmefIframeEnUso = true;
  }

  private liberarScrollMetodologiaAmef(): void {
    this.metodologiaAmefIframeEnUso = false;
    this.metodologiaAmefRestaurandoScroll = false;
  }

  private programarRestauracionScrollMetodologiaAmef(): void {
    [0, 50, 150, 300].forEach((delay) => {
      window.setTimeout(() => this.restaurarScrollMetodologiaAmefSiSalto(), delay);
    });
  }

  private restaurarScrollMetodologiaAmefSiSalto(): void {
    if (!this.esMetodologiaAmef || !this.metodologiaAmefIframeEnUso || this.metodologiaAmefRestaurandoScroll) {
      return;
    }
    const current = this.obtenerScrollVentana();
    if (Math.abs(current - this.metodologiaAmefScrollAncla) <= 3) {
      return;
    }
    this.metodologiaAmefRestaurandoScroll = true;
    window.scrollTo({ top: this.metodologiaAmefScrollAncla, left: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
      this.metodologiaAmefRestaurandoScroll = false;
    });
  }

  private scrollDgF07TabActivo(): void {
    const container = this.dgF07TabsScroll?.nativeElement;
    if (!container) {
      return;
    }
    const active = container.querySelector('.dg-f07-nav__tab--active') as HTMLElement | null;
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  agregarFilaDgF05(): void {
    this.dgF05Form.filas.push(this.crearFilaDgF05Vacia());
    this.onDgF05Editado();
    this.autosizeDgF05Textareas();
  }

  quitarFilaDgF05(index: number): void {
    if (this.dgF05Form.filas.length <= 1) {
      return;
    }
    this.dgF05Form.filas.splice(index, 1);
    this.onDgF05Editado();
    this.autosizeDgF05Textareas();
  }

  @HostListener('window:resize')
  onWindowResizeDgF05(): void {
    if (this.plantillaSlug === 'dg-f-05') {
      this.autosizeDgF05Textareas();
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      this.autosizeTextareasSgcF10();
    }
  }

  onDgF05Editado(): void {
    if (!this.dgF05Listo || this.dgF05IgnorarAutoSave) {
      return;
    }
    this.dgF05CambiosPendientes = true;
  }

  toggleDgF05Editor(): void {
    if (!this.dgF05DriveFileId) {
      return;
    }

    const abrir = !this.mostrarDgF05Editor;
    this.mostrarDgF05Editor = abrir;

    if (abrir) {
      this.dgF05EditorIframeListo = false;
      this.dgF05EditorCargando = true;
      this.fijarEditorEmbedUrl(this.resolverUrlEditorDrive(this.dgF05EditorUrl, this.dgF05DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onDgF05IframeLoad(): void {
    if (this.dgF05EditorIframeListo) {
      return;
    }
    this.dgF05EditorIframeListo = true;
    this.dgF05EditorCargando = false;
  }

  actualizarPlantillaDgF05(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.dgF05ActualizandoPlantilla) {
      return;
    }

    const editorAbierto = this.mostrarDgF05Editor;
    if (editorAbierto) {
      this.mostrarDgF05Editor = false;
      this.dgF05EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }

    this.dgF05ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaDgF05()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF05ActualizandoPlantilla = false;
          this.aplicarEstadoDgF05(res, false, false, true);
        },
        error: () => {
          this.dgF05ActualizandoPlantilla = false;
        }
      });
  }

  onDgF07Editado(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF07Listo || this.dgF07IgnorarAutoSave) {
      return;
    }
    this.dgF07CambiosPendientes = true;
    this.reiniciarTemporizadorInactividadSgc();
  }

  toggleEditorDriveSync(): void {
    if (this.plantillaSlug === 'dg-f-04') {
      this.toggleDgF04Editor();
      return;
    }
    if (this.plantillaSlug === 'dg-f-05') {
      this.toggleDgF05Editor();
      return;
    }
    if (this.plantillaSlug === 'dg-f-07') {
      this.toggleDgF07Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-06') {
      this.toggleSgcF06Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-07') {
      this.toggleSgcF07Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-08') {
      this.toggleSgcF08Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-09') {
      this.toggleSgcF09Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      this.toggleSgcF10Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-14') {
      this.toggleSgcF14Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-25') {
      this.toggleSgcF25Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-16') {
      this.toggleSgcF16Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-29') {
      this.toggleSgcF29Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-28') {
      this.toggleSgcF28Editor();
      return;
    }
    if (this.plantillaSlug === 'sp-f-02') {
      this.toggleSpF02Editor();
      return;
    }
    if (this.plantillaSlug === 'ath-f-02') {
      this.toggleAthF02Editor();
      return;
    }
    if (this.plantillaSlug === 'ath-f-09') {
      this.toggleAthF09Editor();
      return;
    }
    if (this.plantillaSlug === 'ath-f-11') {
      this.toggleAthF11Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-05') {
      this.toggleSgcF05Editor();
      return;
    }
    if (this.plantillaSlug === 'ath-f-08') {
      this.toggleAthF08Editor();
      return;
    }
    if (this.plantillaSlug === 'dg-f-06') {
      this.toggleDgF06Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-18') {
      this.toggleSgcF18Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-11') {
      this.toggleSgcF11Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-12') {
      this.toggleSgcF12Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-02') {
      this.toggleSgcF02Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-04') {
      this.toggleSgcF04Editor();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-22') {
      this.toggleSgcF22Editor();
    }
  }

  actualizarPlantillaDriveSync(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.plantillaSlug === 'dg-f-04') {
      this.actualizarPlantillaDgF04();
      return;
    }
    if (this.plantillaSlug === 'dg-f-05') {
      this.actualizarPlantillaDgF05();
      return;
    }
    if (this.plantillaSlug === 'dg-f-07') {
      this.actualizarPlantillaDgF07();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-06') {
      this.actualizarPlantillaSgcF06();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-07') {
      this.actualizarPlantillaSgcF07();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-08') {
      this.actualizarPlantillaSgcF08();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-10') {
      this.actualizarPlantillaSgcF10();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-14') {
      this.actualizarPlantillaSgcF14();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-25') {
      this.actualizarPlantillaSgcF25();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-16') {
      this.actualizarPlantillaSgcF16();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-29') {
      this.actualizarPlantillaSgcF29();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-28') {
      this.actualizarPlantillaSgcF28();
      return;
    }
    if (this.plantillaSlug === 'sp-f-02') {
      this.actualizarPlantillaSpF02();
      return;
    }
    if (this.plantillaSlug === 'ath-f-02') {
      this.actualizarPlantillaAthF02();
      return;
    }
    if (this.plantillaSlug === 'ath-f-09') {
      this.actualizarPlantillaAthF09();
      return;
    }
    if (this.plantillaSlug === 'ath-f-11') {
      this.actualizarPlantillaAthF11();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-05') {
      this.actualizarPlantillaSgcF05();
      return;
    }
    if (this.plantillaSlug === 'ath-f-08') {
      this.actualizarPlantillaAthF08();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-18') {
      this.actualizarPlantillaSgcF18();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-11') {
      this.actualizarPlantillaSgcF11();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-12') {
      this.actualizarPlantillaSgcF12();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-01') {
      this.actualizarPlantillaSgcF01();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-02') {
      this.actualizarPlantillaSgcF02();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-04') {
      this.actualizarPlantillaSgcF04();
      return;
    }
    if (this.plantillaSlug === 'sgc-f-22') {
      this.actualizarPlantillaSgcF22();
    }
  }

  toggleDgF07Editor(): void {
    if (!this.dgF07DriveFileId) {
      return;
    }

    const abrir = !this.mostrarDgF07Editor;
    this.mostrarDgF07Editor = abrir;

    if (abrir) {
      this.dgF07EditorIframeListo = false;
      this.dgF07EditorCargando = true;
      this.fijarEditorEmbedUrlDgF07(this.resolverUrlEditorDrive(this.dgF07EditorUrl, this.dgF07DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onDgF07IframeLoad(): void {
    if (this.dgF07EditorIframeListo) {
      return;
    }
    this.dgF07EditorIframeListo = true;
    this.dgF07EditorCargando = false;
  }

  actualizarPlantillaDgF07(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.dgF07ActualizandoPlantilla) {
      return;
    }

    if (this.mostrarDgF07Editor) {
      this.mostrarDgF07Editor = false;
      this.dgF07EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }

    this.dgF07ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaDgF07()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF07ActualizandoPlantilla = false;
          this.aplicarEstadoDgF07(res, false, false, true);
        },
        error: () => {
          this.dgF07ActualizandoPlantilla = false;
        }
      });
  }

  filasTextoDgF07Io(proc: DgF07ProcesoForm): number {
    const entradas = this.filasTexto(proc.entradas);
    const salidas = this.filasTexto(proc.salidas);
    return Math.max(entradas, salidas, 4);
  }

  private cargarDgF04DesdeServidor(): void {
    this.dgF04Cargando = true;
    this.dgF04Listo = false;
    this.backendService.cargarDgF04Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF04(res),
        error: () => {
          this.dgF04Cargando = false;
          this.dgF04Listo = true;
        }
      });
  }

  private sincronizarDgF04DesdeDrive(): void {
    this.dgF04Guardando = true;
    this.backendService.sincronizarDgF04DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF04Guardando = false;
          this.dgF04CambiosPendientes = false;
          this.aplicarEstadoDgF04(res, false, false);
        },
        error: () => {
          this.dgF04Guardando = false;
        }
      });
  }

  private persistirDgF04(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF04Listo || this.dgF04Guardando) {
      return;
    }
    this.dgF04Guardando = true;
    const editorAbierto = this.mostrarDgF04Editor;
    const editorActivo = false;
    this.backendService.guardarDgF04Formato(this.dgF04Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF04Guardando = false;
          this.dgF04CambiosPendientes = false;
          this.aplicarEstadoDgF04(res, editorAbierto, false, false);
        },
        error: () => {
          this.dgF04Guardando = false;
        }
      });
  }

  private fijarEditorEmbedUrlDgF04(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarDgF04Editor && this.dgF04EditorEmbedUrlSafe && this.dgF04EditorUrl === url) {
      return;
    }
    if (!url) {
      this.dgF04EditorUrl = null;
      this.dgF04EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.dgF04EditorUrl === url && this.dgF04EditorEmbedUrlSafe) {
      return;
    }
    this.dgF04EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.dgF04EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private normalizarFilaDgF04(fila: DgF04Fila, seccion?: DgF04Seccion): DgF04Fila {
    const probabilidad = String(fila?.probabilidad || '').trim();
    const consecuencia = String(fila?.consecuencia || '').trim();
    const normalizada: DgF04Fila = {
      factor: String(fila?.factor || '').trim(),
      responsable: String(fila?.responsable || '').trim(),
      seguimiento: String(fila?.seguimiento || '').trim(),
      probabilidad,
      consecuencia,
      resultado: String(fila?.resultado || '').trim()
    };
    if (seccion && probabilidad && consecuencia) {
      normalizada.resultado = this.calcularResultadoDgF04(normalizada, seccion);
    }
    return normalizada;
  }

  private aplicarEstadoDgF04(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.dgF04Cargando = false;
      }
      this.dgF04Listo = true;
      return;
    }

    const editorAbierto = this.mostrarDgF04Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.dgF04IgnorarAutoSave = true;
      this.dgF04Listo = false;
      const d = res.datos;
      this.dgF04Form = {
        empresa: d.empresa ?? this.dgF04Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.dgF04Form.fechaElaboracion,
        fortalezas: Array.isArray(d.fortalezas)
          ? d.fortalezas.map((f: DgF04Fila) => this.normalizarFilaDgF04(f, 'fortalezas'))
          : this.dgF04Form.fortalezas,
        oportunidades: Array.isArray(d.oportunidades)
          ? d.oportunidades.map((f: DgF04Fila) => this.normalizarFilaDgF04(f, 'oportunidades'))
          : this.dgF04Form.oportunidades,
        debilidades: Array.isArray(d.debilidades)
          ? d.debilidades.map((f: DgF04Fila) => this.normalizarFilaDgF04(f, 'debilidades'))
          : this.dgF04Form.debilidades,
        amenazas: Array.isArray(d.amenazas)
          ? d.amenazas.map((f: DgF04Fila) => this.normalizarFilaDgF04(f, 'amenazas'))
          : this.dgF04Form.amenazas,
        autorizo: d.autorizo ?? this.dgF04Form.autorizo
      };
    } else if (!editorAbierto && !conservarEdicion) {
      this.dgF04IgnorarAutoSave = true;
      this.dgF04Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.dgF04DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarDgF04Editor)) {
        this.fijarEditorEmbedUrlDgF04(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.dgF04UltimaSync = res.ultimaSyncDrive || null;
    this.dgF04FechaOriginal = res.fechaElaboracionOriginal || null;
    this.dgF04ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.dgF04IgnorarAutoSave = false;
      this.dgF04Listo = true;
      if (!bloquearFormulario) {
        this.dgF04CambiosPendientes = false;
      }
      if (!sincronizacionSilenciosa) {
        this.dgF04Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private cargarDgF05DesdeServidor(): void {
    this.dgF05Cargando = true;
    this.dgF05Listo = false;
    this.backendService.cargarDgF05Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF05(res),
        error: () => {
          this.dgF05Cargando = false;
          this.dgF05Listo = true;
        }
      });
  }

  private sincronizarDgF05DesdeDrive(): void {
    this.dgF05Guardando = true;
    this.backendService.sincronizarDgF05DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF05Guardando = false;
          this.dgF05CambiosPendientes = false;
          this.aplicarEstadoDgF05(res, false, false);
        },
        error: () => {
          this.dgF05Guardando = false;
        }
      });
  }

  private persistirDgF05(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF05Listo || this.dgF05Guardando) {
      return;
    }
    this.dgF05Guardando = true;
    const editorAbierto = this.mostrarDgF05Editor;
    const editorActivo = false;
    this.backendService.guardarDgF05Formato(this.dgF05Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF05Guardando = false;
          this.dgF05CambiosPendientes = false;
          this.aplicarEstadoDgF05(res, editorAbierto, false, false);
        },
        error: () => {
          this.dgF05Guardando = false;
        }
      });
  }

  private fijarEditorEmbedUrl(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarDgF05Editor && this.dgF05EditorEmbedUrlSafe && this.dgF05EditorUrl === url) {
      return;
    }
    if (!url) {
      this.dgF05EditorUrl = null;
      this.dgF05EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.dgF05EditorUrl === url && this.dgF05EditorEmbedUrlSafe) {
      return;
    }
    this.dgF05EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.dgF05EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoDgF05(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.dgF05Cargando = false;
      }
      this.dgF05Listo = true;
      return;
    }

    const editorAbierto = this.mostrarDgF05Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.dgF05IgnorarAutoSave = true;
      this.dgF05Listo = false;
      this.dgF05Form = {
        empresa: res.datos.empresa ?? this.dgF05Form.empresa,
        fechaElaboracion: res.datos.fechaElaboracion ?? this.dgF05Form.fechaElaboracion,
        filas: Array.isArray(res.datos.filas)
          ? res.datos.filas.map((f: DgF05Fila) => this.normalizarFilaDgF05(f))
          : this.dgF05Form.filas,
        elaboro: res.datos.elaboro ?? this.dgF05Form.elaboro,
        autorizo: res.datos.autorizo ?? this.dgF05Form.autorizo
      };
    } else if (!editorAbierto && !conservarEdicion) {
      this.dgF05IgnorarAutoSave = true;
      this.dgF05Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.dgF05DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarDgF05Editor)) {
        this.fijarEditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.dgF05UltimaSync = res.ultimaSyncDrive || null;
    this.dgF05FechaOriginal = res.fechaElaboracionOriginal || null;
    this.dgF05ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.dgF05IgnorarAutoSave = false;
      this.dgF05Listo = true;
      if (!sincronizacionSilenciosa) {
        this.dgF05Cargando = false;
      }
      this.autosizeDgF05Textareas();
    }, editorAbierto ? 0 : 350);
  }

  private cargarDgF07DesdeServidor(): void {
    this.dgF07Cargando = true;
    this.dgF07Listo = false;
    this.backendService.cargarDgF07Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF07(res),
        error: () => {
          this.dgF07Cargando = false;
          this.dgF07Listo = true;
        }
      });
  }

  private sincronizarDgF07DesdeDrive(): void {
    this.dgF07Guardando = true;
    this.backendService.sincronizarDgF07DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF07Guardando = false;
          this.aplicarEstadoDgF07(res, false, false);
        },
        error: () => {
          this.dgF07Guardando = false;
        }
      });
  }

  private persistirDgF07(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF07Listo || this.dgF07Guardando) {
      return;
    }
    this.dgF07Guardando = true;
    const editorAbierto = this.mostrarDgF07Editor;
    const editorActivo = false;
    this.backendService.guardarDgF07Formato({ procesos: this.dgF07Forms }, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF07Guardando = false;
          this.dgF07CambiosPendientes = false;
          // Conservar lo que el usuario está editando; solo actualizar sync/Drive.
          this.aplicarEstadoDgF07(res, true, true);
        },
        error: () => {
          this.dgF07Guardando = false;
        }
      });
  }

  private fijarEditorEmbedUrlDgF07(url: string | null, forzar = false): void {
    if (!forzar && this.mostrarDgF07Editor && this.dgF07EditorEmbedUrlSafe && this.dgF07EditorUrl === url) {
      return;
    }
    if (!url) {
      this.dgF07EditorUrl = null;
      this.dgF07EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.dgF07EditorUrl === url && this.dgF07EditorEmbedUrlSafe) {
      return;
    }
    this.dgF07EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.dgF07EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoDgF07(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.dgF07Cargando = false;
      }
      this.dgF07Listo = true;
      return;
    }

    const editorAbierto = this.mostrarDgF07Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos?.procesos) {
      this.dgF07IgnorarAutoSave = true;
      this.dgF07Listo = false;
      this.dgF07FormMontado = false;
      this.dgF07Forms = this.procesosDesdeServidorDgF07(res.datos.procesos);
    }

    const nuevoDriveId = res.driveFileId || null;
    if (nuevoDriveId) {
      this.dgF07DriveFileId = nuevoDriveId;
      if (res.editorUrl) {
        this.fijarEditorEmbedUrlDgF07(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.dgF07UltimaSync = res.ultimaSyncDrive || null;

    const finalizar = (): void => {
      if (!bloquearFormulario && res.datos?.procesos) {
        this.dgF07FormMontado = true;
      }
      this.dgF07IgnorarAutoSave = false;
      this.dgF07Listo = true;
      if (!sincronizacionSilenciosa) {
        this.dgF07Cargando = false;
      }
    };

    if (sincronizacionSilenciosa) {
      finalizar();
      return;
    }

    window.setTimeout(finalizar, editorAbierto ? 0 : 350);
  }

  private procesosDesdeServidorDgF07(procesos: Record<string, DgF07ProcesoForm>): Record<string, DgF07ProcesoForm> {
    const base = this.crearDgF07Forms();
    const resultado: Record<string, DgF07ProcesoForm> = {};

    for (const p of DG_F07_PROCESOS) {
      const remoto = procesos[p.slug];
      if (!remoto) {
        resultado[p.slug] = base[p.slug];
        continue;
      }
      resultado[p.slug] = {
        nombreProceso: remoto.nombreProceso ?? '',
        responsable: remoto.responsable ?? '',
        objetivo: remoto.objetivo ?? '',
        procesoAnterior: remoto.procesoAnterior ?? '',
        procesoSiguiente: remoto.procesoSiguiente ?? '',
        entradas: remoto.entradas ?? '',
        salidas: remoto.salidas ?? '',
        recursos: remoto.recursos ?? '',
        criteriosMetodos: remoto.criteriosMetodos ?? '',
        indicadores: remoto.indicadores ?? ''
      };
    }

    return resultado;
  }

  private resolverEmbedUrl(p: PlantillaFormato): SafeResourceUrl | null {
    if (p.previewMode !== 'embed' || !p.driveFileId) {
      return null;
    }
    const url = `https://drive.google.com/file/d/${p.driveFileId}/preview`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private crearAthF02FormVacio(): AthF02FormData {
    return {
      revision: '00',
      fechaRevision: '2025-07-10',
      fechaElaboracion: '2025-07-10',
      perfiles: [],
      perfilActivoId: null
    };
  }

  private filasExpAthF02(): AthF02ExperienciaFila[] {
    return [
      { enQue: '', tiempo: '' },
      { enQue: '', tiempo: '' },
      { enQue: '', tiempo: '' },
      { enQue: '', tiempo: '' }
    ];
  }

  private expAthF02Vacia(): AthF02ExperienciaFila {
    return { enQue: '', tiempo: '' };
  }

  readonly athF02MaxExperiencias = 4;

  private readonly athF02FuncionesDefecto: string[] = [
    'Conocer los procesos que se llevan a cabo dentro de laboratorio.',
    'Establecer estrategias y procedimientos de carácter técnico para el desarrollo de las actividades en el laboratorio',
    'Revisar y verificar, los resultados de los análisis realizados.',
    'Supervisar la correcta aplicación de los métodos de prueba, procedimientos e instructivos técnicos.',
    'Supervisar los controles de calidad de los diferentes análisis que se realizan.',
    'Vigilar que se lleven a cabo los sistemas de control de calidad, tanto internos como externos.',
    'Atender en forma directa las reclamaciones y sugerencias que se formulen en la prestación del servicio y coadyuvar en la resolución',
    'Conocer, cumplir y aplicar la normatividad vigente.',
    'Establecer conforme a la normatividad, los criterios para la toma y análisis de muestras.',
    'Vigilar y supervisar el apego a la normatividad sanitaria el desecho de material y muestras ya analizadas.',
    'Realizar las notificaciones a epidemiología estatal, de acuerdo a lo establecido a la NOM 017.',
    'Vigilar el uso adecuado del uniforme y equipo de seguridad para el personal.',
    'Informar deterioros, descomposturas de aparatos, instrumentos, equipos, utensilios, accesorios, así como en las instalaciones eléctricas, hidráulicas y de drenaje.',
    'Informar y solicitar oportunamente los requerimientos de material o insumos.',
    'Mantener en óptimas condiciones el material y los equipos del laboratorio.',
    'Mantener completa su plantilla de personal para el logro de metas del área.',
    'Dar seguimiento a los procesos de Recursos Humanos para el cumplimiento de reglamento Interior de Trabajo, reclutamiento, capacitación, administración de personal y desarrollo de los colaboradores del área bajo su cargo.',
    'Participar activamente en el sistema de gestión de calidad de la institución.',
    'Proponer acciones de mejora o correctivas que ayuden a mejorar el logro de los objetivos.',
    'Participar de forma efectiva en los procesos de comunicación con las diferentes áreas de interacción.',
    'Participar en eventos y demás acciones de la institución.',
    'Generar los reportes e información requerida por la institución.',
    'Asistir a las juntas, capacitaciones y demás actividades convocadas por la institución.',
    'Seguir con las políticas, procedimientos y protocolos establecidos por la institución para el desempeño de sus funciones.',
    'Cumplir con las políticas y reglamentos establecidos por la institución.',
    'Seguir con las políticas, procedimientos y protocolos normativos en materia de seguridad e higiene establecidos.'
  ];

  readonly athF02EscNiveles: ReadonlyArray<{ key: AthF02Perfil['escNivel']; label: string }> = [
    { key: 'primaria', label: 'Primaria' },
    { key: 'secundaria', label: 'Secundaria' },
    { key: 'bachillerato', label: 'Bachillerato' },
    { key: 'tecnico', label: 'Técnico' },
    { key: 'tsu', label: 'TSU' },
    { key: 'licenciatura', label: 'Licenciatura' },
    { key: 'especialidad', label: 'Especialidad' },
    { key: 'maestria', label: 'Maestría' },
    { key: 'otro', label: 'Otro' }
  ];

  readonly athF02ReqItems: ReadonlyArray<{
    key: keyof AthF02Requerimientos;
    label: string;
    detalleLabel: string;
  }> = [
    { key: 'computadora', label: 'Computadora u ordenador', detalleLabel: '¿Cuál?' },
    { key: 'software', label: 'Software', detalleLabel: '¿Cuál?' },
    { key: 'informacion', label: 'Información', detalleLabel: '¿Cuál?' },
    { key: 'herramientas', label: 'Herramientas o equipos', detalleLabel: '¿Cuáles?' },
    { key: 'uniformes', label: 'Uniformes', detalleLabel: 'Cantidad:' },
    { key: 'otros', label: 'Otros', detalleLabel: '¿Cuáles?' }
  ];

  private filasRelAthF02(): AthF02RelacionFila[] {
    return [
      { actor: '', motivo: '' },
      { actor: '', motivo: '' },
      { actor: '', motivo: '' },
      { actor: '', motivo: '' }
    ];
  }

  private reqAthF02Vacio(): AthF02ReqItem {
    return { activo: false, detalle: '' };
  }

  private escAthF02Vacia(): AthF02Escolaridad {
    return {
      primaria: false,
      secundaria: false,
      bachillerato: false,
      tecnico: false,
      tsu: false,
      licenciatura: false,
      licenciaturaEn: '',
      especialidad: false,
      especialidadEn: '',
      maestria: false,
      maestriaEn: '',
      otro: false,
      otroDetalle: ''
    };
  }

  private nuevoIdAthF02(): string {
    return `ath02-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private crearAthF02PerfilVacio(): AthF02Perfil {
    return {
      id: this.nuevoIdAthF02(),
      puesto: '',
      areaDepartamento: '',
      puestoAlQueReporta: '',
      puestosQueLeReportan: '',
      objetivo: '',
      funciones: [...this.athF02FuncionesDefecto],
      edad: '',
      edadMinima: '',
      edadMaxima: '',
      edadIndistinto: false,
      sexo: '',
      estadoCivil: '',
      escNivel: '',
      esc: this.escAthF02Vacia(),
      experiencia: this.expAthF02Vacia(),
      experiencias: [{ enQue: '', tiempo: '' }],
      experienciaIzq: this.filasExpAthF02(),
      experienciaDer: this.filasExpAthF02(),
      formacionCompetenciasTecnicas: '',
      habilidadesBlandas: '',
      conocimientoEquipoOperacion: '',
      requerimientos: {
        computadora: this.reqAthF02Vacio(),
        software: this.reqAthF02Vacio(),
        informacion: this.reqAthF02Vacio(),
        herramientas: this.reqAthF02Vacio(),
        uniformes: this.reqAthF02Vacio(),
        otros: this.reqAthF02Vacio()
      },
      relacionesInternas: this.filasRelAthF02(),
      relacionesExternas: this.filasRelAthF02(),
      pdfFirmado: null,
      nombreHoja: ''
    };
  }

  private normalizarOpcionAthF02<T extends string>(valor: unknown, opciones: readonly T[]): T {
    const t = String(valor || '').trim().toLowerCase();
    if (!t) {
      return opciones[0];
    }
    for (const op of opciones) {
      if (op && t === op) {
        return op;
      }
    }
    return opciones[0];
  }

  private normalizarEscAthF02(raw: Partial<AthF02Escolaridad> | null | undefined): AthF02Escolaridad {
    const base = this.escAthF02Vacia();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    return {
      primaria: !!raw.primaria,
      secundaria: !!raw.secundaria,
      bachillerato: !!raw.bachillerato,
      tecnico: !!raw.tecnico,
      tsu: !!raw.tsu,
      licenciatura: !!raw.licenciatura,
      licenciaturaEn: String(raw.licenciaturaEn || (raw as any).licText || '').trim(),
      especialidad: !!raw.especialidad,
      especialidadEn: String(raw.especialidadEn || (raw as any).espText || '').trim(),
      maestria: !!raw.maestria,
      maestriaEn: String(raw.maestriaEn || (raw as any).maestText || '').trim(),
      otro: !!raw.otro,
      otroDetalle: String(raw.otroDetalle || '').trim()
    };
  }

  private sanitizarPdfAthF02(raw: any): AthF02PdfFirmado | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) {
      return null;
    }
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'ATH-F-02 firmado.pdf').trim(),
      webViewLink: raw.webViewLink || raw.web_view_link || null,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  private conFilasMinimasAthF02<T>(lista: T[] | null | undefined, minimo: number, factory: () => T): T[] {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) {
      out.push(factory());
    }
    return out;
  }

  private resolverEscNivelAthF02(
    raw: Partial<AthF02Perfil> | null | undefined,
    esc: AthF02Escolaridad
  ): AthF02Perfil['escNivel'] {
    const explicit = String(raw?.escNivel || (raw as any)?.esc_nivel || '').trim().toLowerCase();
    const opciones: AthF02Perfil['escNivel'][] = [
      'primaria', 'secundaria', 'bachillerato', 'tecnico', 'tsu',
      'licenciatura', 'especialidad', 'maestria', 'otro'
    ];
    if (explicit && opciones.includes(explicit as AthF02Perfil['escNivel'])) {
      return explicit as AthF02Perfil['escNivel'];
    }
    for (const op of opciones) {
      if (op && esc[op]) {
        return op;
      }
    }
    return '';
  }

  private resolverExperienciaAthF02(raw: Partial<AthF02Perfil> | null | undefined): AthF02ExperienciaFila {
    const list = this.resolverExperienciasAthF02(raw);
    return list[0] || this.expAthF02Vacia();
  }

  private resolverExperienciasAthF02(raw: Partial<AthF02Perfil> | null | undefined): AthF02ExperienciaFila[] {
    const fromArray = Array.isArray(raw?.experiencias)
      ? raw!.experiencias!.map((f) => ({
        enQue: String((f as any)?.enQue || (f as any)?.en_que || '').trim(),
        tiempo: String((f as any)?.tiempo || '').trim()
      }))
      : [];
    if (fromArray.length) {
      return this.conFilasMinimasAthF02(fromArray, 1, () => this.expAthF02Vacia()).slice(0, this.athF02MaxExperiencias);
    }
    const single = this.resolverExperienciaAthF02(raw);
    if (single.enQue || single.tiempo) {
      return [single];
    }
    const izq = Array.isArray(raw?.experienciaIzq) ? raw!.experienciaIzq! : [];
    const der = Array.isArray(raw?.experienciaDer) ? raw!.experienciaDer! : [];
    const merged = [...izq, ...der].map((f) => ({
      enQue: String((f as any)?.enQue || (f as any)?.en_que || '').trim(),
      tiempo: String((f as any)?.tiempo || '').trim()
    })).filter((f) => f.enQue || f.tiempo);
    return merged.length
      ? this.conFilasMinimasAthF02(merged, 1, () => this.expAthF02Vacia()).slice(0, this.athF02MaxExperiencias)
      : [{ enQue: '', tiempo: '' }];
  }

  private normalizarAthF02Perfil(raw: Partial<AthF02Perfil> | null | undefined): AthF02Perfil {
    const base = this.crearAthF02PerfilVacio();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    const req = raw.requerimientos && typeof raw.requerimientos === 'object' ? raw.requerimientos : {};
    const normReq = (key: keyof AthF02Requerimientos): AthF02ReqItem => {
      const item = (req as any)[key];
      return {
        activo: !!item?.activo,
        detalle: String(item?.detalle || '').trim()
      };
    };
    const funcionesRaw = Array.isArray(raw.funciones)
      ? raw.funciones.map((f) => {
        if (typeof f === 'string') {
          return String(f).trim();
        }
        return String((f as any)?.texto || (f as any)?.descripcion || '').trim();
      }).filter(Boolean)
      : [];
    const esc = this.normalizarEscAthF02(raw.esc || (raw as any).escolaridad);
    const escNivel = this.resolverEscNivelAthF02(raw, esc);
    const experiencias = this.resolverExperienciasAthF02(raw);
    const experiencia = experiencias[0] || this.expAthF02Vacia();
    const edadLegacy = this.normalizarOpcionAthF02(raw.edad, ['', 'minima', 'maxima', 'indistinto']);
    const edadIndistinto = !!(raw.edadIndistinto || (raw as any).edad_indistinto)
      || edadLegacy === 'indistinto';
    const edadMinima = edadIndistinto
      ? ''
      : String(raw.edadMinima || (raw as any).edad_minima || (edadLegacy === 'minima' ? '' : '')).trim();
    const edadMaxima = edadIndistinto
      ? ''
      : String(raw.edadMaxima || (raw as any).edad_maxima || (edadLegacy === 'maxima' ? '' : '')).trim();
    return {
      ...base,
      id: String(raw.id || '').trim() || this.nuevoIdAthF02(),
      puesto: String(raw.puesto || '').trim(),
      areaDepartamento: String(raw.areaDepartamento || (raw as any).area_departamento || '').trim(),
      puestoAlQueReporta: String(raw.puestoAlQueReporta || (raw as any).puesto_al_que_reporta || '').trim(),
      puestosQueLeReportan: String(raw.puestosQueLeReportan || (raw as any).puestos_que_le_reportan || '').trim(),
      objetivo: String(raw.objetivo || '').trim(),
      funciones: funcionesRaw.length ? funcionesRaw : [''],
      edad: edadIndistinto ? 'indistinto' : '',
      edadMinima,
      edadMaxima,
      edadIndistinto,
      sexo: this.normalizarOpcionAthF02(raw.sexo, ['', 'masculino', 'femenino', 'indistinto']),
      estadoCivil: this.normalizarOpcionAthF02(raw.estadoCivil || (raw as any).estado_civil, ['', 'soltero', 'casado', 'indistinto']),
      escNivel,
      esc,
      experiencia,
      experiencias,
      experienciaIzq: experiencias,
      experienciaDer: this.filasExpAthF02(),
      formacionCompetenciasTecnicas: String(
        raw.formacionCompetenciasTecnicas || (raw as any).formacion_competencias_tecnicas || ''
      ).trim(),
      habilidadesBlandas: String(raw.habilidadesBlandas || (raw as any).habilidades_blandas || '').trim(),
      conocimientoEquipoOperacion: String(
        raw.conocimientoEquipoOperacion || (raw as any).conocimiento_equipo_operacion || ''
      ).trim(),
      requerimientos: {
        computadora: normReq('computadora'),
        software: normReq('software'),
        informacion: normReq('informacion'),
        herramientas: normReq('herramientas'),
        uniformes: normReq('uniformes'),
        otros: normReq('otros')
      },
      relacionesInternas: this.conFilasMinimasAthF02(
        (Array.isArray(raw.relacionesInternas) ? raw.relacionesInternas : []).map((r) => ({
          actor: String((r as any)?.actor || '').trim(),
          motivo: String((r as any)?.motivo || '').trim()
        })),
        4,
        () => ({ actor: '', motivo: '' })
      ),
      relacionesExternas: this.conFilasMinimasAthF02(
        (Array.isArray(raw.relacionesExternas) ? raw.relacionesExternas : []).map((r) => ({
          actor: String((r as any)?.actor || '').trim(),
          motivo: String((r as any)?.motivo || '').trim()
        })),
        4,
        () => ({ actor: '', motivo: '' })
      ),
      pdfFirmado: this.sanitizarPdfAthF02(raw.pdfFirmado || (raw as any).pdf_firmado),
      nombreHoja: String(raw.nombreHoja || (raw as any).nombre_hoja || '').trim()
    };
  }

  private esPerfilLegacyAthF02(base: any): boolean {
    return !Array.isArray(base?.perfiles)
      && !!(base?.puesto || base?.areaDepartamento || base?.objetivo || base?.funciones);
  }

  private normalizarAthF02Form(datos: Partial<AthF02FormData> | any | null | undefined): AthF02FormData {
    const base = this.crearAthF02FormVacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    let perfilesRaw: Partial<AthF02Perfil>[] = [];
    if (Array.isArray(datos.perfiles)) {
      perfilesRaw = datos.perfiles;
    } else if (this.esPerfilLegacyAthF02(datos)) {
      perfilesRaw = [datos];
    }
    const perfiles = perfilesRaw.map((p) => this.normalizarAthF02Perfil(p));
    const perfilActivoId = datos.perfilActivoId || datos.perfil_activo_id
      ? String(datos.perfilActivoId || datos.perfil_activo_id)
      : (perfiles[0]?.id || null);
    return {
      revision: String(datos.revision || base.revision).trim() || base.revision,
      fechaRevision: String(datos.fechaRevision || base.fechaRevision).trim() || base.fechaRevision,
      fechaElaboracion: String(datos.fechaElaboracion || base.fechaElaboracion).trim() || base.fechaElaboracion,
      perfiles,
      perfilActivoId: perfilActivoId && perfiles.some((p) => p.id === perfilActivoId)
        ? perfilActivoId
        : (perfiles[0]?.id || null)
    };
  }

  get athF02IntroLead(): string {
    if (this.plantillaSlug !== 'ath-f-02') {
      return '';
    }
    return 'Archivero de perfiles de puesto. Crea, busca y edita cada descripción con su hoja en Excel. Usa «Guardar información» para sincronizar con Drive.';
  }

  get athF02PerfilesVista(): AthF02Perfil[] {
    const q = this.athF02Busqueda.trim().toLowerCase();
    const lista = [...(this.athF02Form.perfiles || [])].sort((a, b) =>
      String(a.puesto || '').localeCompare(String(b.puesto || ''), 'es')
    );
    if (!q) {
      return lista;
    }
    return lista.filter((p) =>
      [p.puesto, p.areaDepartamento, p.puestoAlQueReporta, p.objetivo]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  nuevoPerfilAthF02(): void {
    const perfil = this.crearAthF02PerfilVacio();
    this.athF02Form.perfiles = [perfil, ...(this.athF02Form.perfiles || [])];
    this.athF02Form.perfilActivoId = perfil.id;
    this.athF02PerfilActivo = perfil;
    this.athF02Vista = 'editor';
    this.onAthF02Editado();
  }

  abrirPerfilAthF02(perfil: AthF02Perfil): void {
    this.athF02Form.perfilActivoId = perfil.id;
    this.athF02PerfilActivo = perfil;
    this.athF02Vista = 'editor';
  }

  volverArchiveroAthF02(): void {
    this.athF02Vista = 'archivero';
    this.athF02PerfilActivo = null;
    this.athF02Form.perfilActivoId = null;
    if (this.mostrarAthF02Editor) {
      this.toggleAthF02Editor();
    }
  }

  eliminarPerfilAthF02(perfil: AthF02Perfil, event?: Event): void {
    event?.stopPropagation();
    const etiqueta = perfil.puesto || perfil.areaDepartamento || 'sin puesto';
    if (!confirm(`¿Eliminar el perfil de puesto «${etiqueta}»?`)) {
      return;
    }
    this.athF02Form.perfiles = (this.athF02Form.perfiles || []).filter((p) => p.id !== perfil.id);
    if (this.athF02PerfilActivo?.id === perfil.id) {
      this.volverArchiveroAthF02();
    }
    this.onAthF02Editado();
  }

  agregarFuncionAthF02(): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    this.athF02PerfilActivo.funciones = [...(this.athF02PerfilActivo.funciones || []), ''];
    this.onAthF02Editado();
  }

  quitarFuncionAthF02(index: number): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    if (this.athF02PerfilActivo.funciones.length <= 1) {
      this.athF02PerfilActivo.funciones = [''];
    } else {
      this.athF02PerfilActivo.funciones.splice(index, 1);
    }
    this.onAthF02Editado();
  }

  agregarExperienciaAthF02(): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    if ((this.athF02PerfilActivo.experiencias || []).length >= this.athF02MaxExperiencias) {
      return;
    }
    this.athF02PerfilActivo.experiencias = [...(this.athF02PerfilActivo.experiencias || []), this.expAthF02Vacia()];
    this.onAthF02Editado();
  }

  quitarExperienciaAthF02(index: number): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    const lista = [...(this.athF02PerfilActivo.experiencias || [])];
    if (lista.length <= 1) {
      this.athF02PerfilActivo.experiencias = [this.expAthF02Vacia()];
    } else {
      lista.splice(index, 1);
      this.athF02PerfilActivo.experiencias = lista;
    }
    this.onAthF02Editado();
  }

  onAthF02EdadIndistintoChange(activo: boolean): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    this.athF02PerfilActivo.edadIndistinto = activo;
    if (activo) {
      this.athF02PerfilActivo.edadMinima = '';
      this.athF02PerfilActivo.edadMaxima = '';
      this.athF02PerfilActivo.edad = 'indistinto';
    } else {
      this.athF02PerfilActivo.edad = '';
    }
    this.onAthF02Editado();
  }

  onAthF02EdadValorChange(): void {
    if (!this.athF02PerfilActivo || this.athF02PerfilActivo.edadIndistinto) {
      return;
    }
    this.athF02PerfilActivo.edad = '';
    this.onAthF02Editado();
  }

  private prepararAthF02PerfilParaBackend(perfil: AthF02Perfil): void {
    if (!perfil.experiencias?.length) {
      perfil.experiencias = [{ ...perfil.experiencia }];
    }
    perfil.experiencia = perfil.experiencias[0] || this.expAthF02Vacia();
    perfil.experienciaIzq = [...perfil.experiencias];
    perfil.experienciaDer = this.filasExpAthF02();
    const boolKeys: Array<'primaria' | 'secundaria' | 'bachillerato' | 'tecnico' | 'tsu' | 'licenciatura' | 'especialidad' | 'maestria' | 'otro'> = [
      'primaria', 'secundaria', 'bachillerato', 'tecnico', 'tsu',
      'licenciatura', 'especialidad', 'maestria', 'otro'
    ];
    boolKeys.forEach((key) => {
      perfil.esc[key] = perfil.escNivel === key;
    });
    perfil.edad = perfil.edadIndistinto ? 'indistinto' : '';
  }

  private sincronizarPerfilActivoEnFormAthF02(): void {
    const activo = this.athF02PerfilActivo;
    if (!activo) {
      return;
    }
    this.prepararAthF02PerfilParaBackend(activo);
    const idx = (this.athF02Form.perfiles || []).findIndex((p) => p.id === activo.id);
    if (idx >= 0) {
      this.athF02Form.perfiles[idx] = activo;
    }
  }

  private sincronizarPerfilActivoAthF02(): void {
    const id = this.athF02Form.perfilActivoId;
    this.athF02PerfilActivo = (this.athF02Form.perfiles || []).find((p) => p.id === id) || null;
  }

  onAthF02Editado(): void {
    if (this.athF02IgnorarAutoSave || !this.athF02Listo) {
      return;
    }
    if (this.athF02PerfilActivo) {
      this.sincronizarPerfilActivoEnFormAthF02();
    }
    this.athF02CambiosPendientes = true;
  }

  onSeleccionarPdfAthF02(event: Event): void {
    if (!this.athF02PerfilActivo) {
      return;
    }
    const puesto = (this.athF02PerfilActivo.puesto || 'perfil').replace(/[^\w\s-]/g, '').trim() || 'perfil';
    this.procesarPdfDocumento(
      event,
      `ATH-F-02 ${puesto}.pdf`,
      (base64, nombre) => this.subirPdfFirmadoAthF02(base64, nombre)
    );
  }

  private subirPdfFirmadoAthF02(pdfBase64: string, nombreArchivo: string): void {
    if (this.athF02SubiendoPdf || !this.athF02PerfilActivo) {
      return;
    }
    this.athF02SubiendoPdf = true;
    this.backendService.subirPdfFirmadoAthF02(pdfBase64, nombreArchivo, this.athF02PerfilActivo.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF02SubiendoPdf = false;
          this.aplicarEstadoAthF02(res);
          if (this.athF02PerfilActivo && res?.pdfFirmado) {
            this.athF02PerfilActivo.pdfFirmado = this.sanitizarPdfAthF02(res.pdfFirmado);
            this.sincronizarPerfilActivoEnFormAthF02();
          }
        },
        error: () => {
          this.athF02SubiendoPdf = false;
        }
      });
  }

  private fijarEditorEmbedUrlAthF02(editorUrl: string | null, forzar = false): void {
    if (!forzar && this.mostrarAthF02Editor && this.athF02EditorEmbedUrlSafe && this.athF02EditorUrl === editorUrl) {
      return;
    }
    if (!editorUrl) {
      this.athF02EditorUrl = null;
      this.athF02EditorEmbedUrlSafe = null;
      return;
    }
    const url = this.resolverUrlEditorDrive(editorUrl, this.athF02DriveFileId);
    this.athF02EditorUrl = url || editorUrl;
    const embedUrl = this.urlIframeDriveSegunPermiso(this.athF02EditorUrl);
    this.athF02EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  toggleAthF02Editor(): void {
    if (this.mostrarAthF02Editor) {
      this.mostrarAthF02Editor = false;
      this.athF02EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      return;
    }
    const url = this.resolverUrlEditorDrive(this.athF02EditorUrl, this.athF02DriveFileId);
    this.fijarEditorEmbedUrlAthF02(url, true);
    this.mostrarAthF02Editor = true;
    this.athF02EditorCargando = true;
    this.athF02EditorIframeListo = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  onAthF02IframeLoad(): void {
    this.athF02EditorIframeListo = true;
    this.athF02EditorCargando = false;
  }

  actualizarPlantillaAthF02(): void {
    if (this.athF02ActualizandoPlantilla) {
      return;
    }
    this.athF02ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaAthF02()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF02(res, false, false, true);
          this.athF02ActualizandoPlantilla = false;
        },
        error: () => {
          this.athF02ActualizandoPlantilla = false;
        }
      });
  }

  private cargarAthF02DesdeServidor(): void {
    this.athF02Cargando = true;
    this.backendService.cargarAthF02Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF02(res),
        error: () => {
          this.athF02Cargando = false;
          this.athF02Vista = 'archivero';
          this.athF02PerfilActivo = null;
          this.athF02Listo = true;
        }
      });
  }

  private sincronizarAthF02DesdeDrive(): void {
    this.backendService.sincronizarAthF02DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF02(res, false, true, true)
      });
  }

  private persistirAthF02(): void {
    if (this.athF02Guardando || !this.athF02Listo) {
      return;
    }
    this.athF02Guardando = true;
    this.sincronizarPerfilActivoEnFormAthF02();
    this.backendService.guardarAthF02Formato(
      { ...this.athF02Form, perfilActivoId: this.athF02PerfilActivo?.id || this.athF02Form.perfilActivoId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF02(res, true, false, true);
          this.athF02CambiosPendientes = false;
          this.athF02Guardando = false;
        },
        error: () => {
          this.athF02Guardando = false;
        }
      });
  }

  private aplicarEstadoAthF02(
    res: any,
    conservarEdicion = false,
    desdeDrive = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res) {
      if (!desdeDrive) {
        this.athF02Cargando = false;
      }
      this.athF02Listo = true;
      return;
    }

    const editorAbierto = this.mostrarAthF02Editor && !forzarActualizacionDrive;
    const activoId = this.athF02PerfilActivo?.id || this.athF02Form.perfilActivoId || null;

    if (res.datos) {
      this.athF02IgnorarAutoSave = true;
      this.athF02Form = this.normalizarAthF02Form(res.datos);
      if (activoId && this.athF02Form.perfiles.some((p) => p.id === activoId)) {
        this.athF02Form.perfilActivoId = activoId;
      } else {
        this.athF02Form.perfilActivoId = null;
      }
      this.athF02PerfilActivo = activoId
        ? this.athF02Form.perfiles.find((p) => p.id === activoId) || null
        : null;
      if (!this.athF02PerfilActivo && this.athF02Vista === 'editor') {
        this.athF02Vista = 'archivero';
      }
      setTimeout(() => {
        this.athF02IgnorarAutoSave = false;
      }, 0);
      this.sincronizarPerfilActivoEnFormAthF02();
    } else {
      this.sincronizarPerfilActivoEnFormAthF02();
    }

    this.athF02DriveFileId = res.driveFileId || null;
    this.athF02UltimaSync = res.ultimaSyncDrive || null;
    this.athF02ContenidoModificado = !!res.contenidoModificado;
    if (res.editorUrl && (forzarActualizacionDrive || !editorAbierto)) {
      this.fijarEditorEmbedUrlAthF02(res.editorUrl, forzarActualizacionDrive);
    }

    this.athF02Listo = true;
    if (!conservarEdicion) {
      this.athF02Cargando = false;
    }
  }

  private crearAthF09PresupuestoItemVacio(): AthF09PresupuestoItem {
    return { descripcion: '', costoUnitario: null, importe: null };
  }

  private sanitizarPresupuestoItemAthF09(raw: any): AthF09PresupuestoItem {
    const base = raw && typeof raw === 'object' ? raw : {};
    const costo = base.costoUnitario ?? base.costo_unitario;
    const importe = base.importe;
    return {
      descripcion: String(base.descripcion || '').trim(),
      costoUnitario: costo === '' || costo == null ? null : Number(costo),
      importe: importe === '' || importe == null ? null : Number(importe)
    };
  }

  private recalcularTotalesPresupuestoAthF09(cot: AthF09Cotizacion): void {
    let subtotal = 0;
    for (const row of cot.presupuestoItems || []) {
      if (row.importe != null && !Number.isNaN(row.importe)) {
        subtotal += row.importe;
      }
    }
    cot.subtotal = subtotal > 0 ? Math.round(subtotal * 100) / 100 : null;
    cot.iva = cot.subtotal != null ? Math.round(cot.subtotal * 0.16 * 100) / 100 : null;
    cot.total = cot.subtotal != null
      ? Math.round((cot.subtotal + (cot.iva || 0)) * 100) / 100
      : null;
  }

  formatearFechaRevAthF09(iso: string | null | undefined): string {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return `${m[3]}-${m[2]}-${m[1].slice(-2)}`;
  }

  formatearFechaCartaAthF09(iso: string | null | undefined): string {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const dia = Number(m[3]);
    const mes = meses[Number(m[2]) - 1] || '';
    return `${dia} de ${mes} de ${m[1]}`;
  }

  textoCartaAthF09(cot: AthF09Cotizacion): string {
    const lugar = (cot.lugar || 'Pachuca, Hidalgo').trim();
    const fecha = this.formatearFechaCartaAthF09(cot.fechaCarta);
    return fecha ? `${lugar}, a ${fecha}.` : `${lugar}.`;
  }

  agregarTerminoAthF09(): void {
    if (!this.athF09CotizacionActiva) return;
    this.athF09CotizacionActiva.terminos = [
      ...(this.athF09CotizacionActiva.terminos || []),
      `Término ${(this.athF09CotizacionActiva.terminos?.length || 0) + 1}.`
    ];
    this.onAthF09Editado();
  }

  quitarTerminoAthF09(index: number): void {
    if (!this.athF09CotizacionActiva?.terminos?.length) return;
    this.athF09CotizacionActiva.terminos = this.athF09CotizacionActiva.terminos.filter((_, i) => i !== index);
    if (!this.athF09CotizacionActiva.terminos.length) {
      this.athF09CotizacionActiva.terminos = ['Término 1.'];
    }
    this.onAthF09Editado();
  }

  agregarEntregableAthF09(): void {
    if (!this.athF09CotizacionActiva) return;
    this.athF09CotizacionActiva.entregables = [
      ...(this.athF09CotizacionActiva.entregables || []),
      `Entregable ${(this.athF09CotizacionActiva.entregables?.length || 0) + 1}.`
    ];
    this.onAthF09Editado();
  }

  quitarEntregableAthF09(index: number): void {
    if (!this.athF09CotizacionActiva?.entregables?.length) return;
    this.athF09CotizacionActiva.entregables = this.athF09CotizacionActiva.entregables.filter((_, i) => i !== index);
    if (!this.athF09CotizacionActiva.entregables.length) {
      this.athF09CotizacionActiva.entregables = ['Entregable 1.'];
    }
    this.onAthF09Editado();
  }

  agregarPresupuestoItemAthF09(): void {
    if (!this.athF09CotizacionActiva) return;
    this.athF09CotizacionActiva.presupuestoItems = [
      ...(this.athF09CotizacionActiva.presupuestoItems || []),
      this.crearAthF09PresupuestoItemVacio()
    ];
    this.onAthF09Editado();
  }

  quitarPresupuestoItemAthF09(index: number): void {
    if (!this.athF09CotizacionActiva?.presupuestoItems?.length) return;
    this.athF09CotizacionActiva.presupuestoItems =
      this.athF09CotizacionActiva.presupuestoItems.filter((_, i) => i !== index);
    if (!this.athF09CotizacionActiva.presupuestoItems.length) {
      this.athF09CotizacionActiva.presupuestoItems = [this.crearAthF09PresupuestoItemVacio()];
    }
    this.recalcularTotalesPresupuestoAthF09(this.athF09CotizacionActiva);
    this.onAthF09Editado();
  }

  onPresupuestoItemAthF09Change(index: number): void {
    if (!this.athF09CotizacionActiva) return;
    const row = this.athF09CotizacionActiva.presupuestoItems[index];
    if (!row) return;
    if (row.costoUnitario != null && !Number.isNaN(row.costoUnitario)) {
      row.importe = Math.round(row.costoUnitario * 100) / 100;
    }
    this.recalcularTotalesPresupuestoAthF09(this.athF09CotizacionActiva);
    this.sincronizarCotizacionActivaEnFormAthF09();
    this.onAthF09Editado();
  }

  formatearMonedaAthF09(valor: number | null | undefined): string {
    if (valor == null || Number.isNaN(valor)) return '—';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2
    }).format(valor);
  }

  private crearAthF09FormVacio(): AthF09FormData {
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      revision: '02',
      fechaRevision: '2026-08-27',
      fechaElaboracion: hoy,
      cotizaciones: [],
      cotizacionActivaId: null
    };
  }

  private nuevoIdAthF09(): string {
    return `ath09-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private normalizarFolioBaseAthF09(folio: string): string {
    const limpio = String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = limpio.match(/SC-\d{2}-\d{3}$/);
    if (m) return m[0];
    const conPrefijo = limpio.match(/^[A-Z0-9]{2,4}-(SC-\d{2}-\d{3})$/);
    if (conPrefijo) return conPrefijo[1];
    return '';
  }

  private extraerInicialesEmpresaAthF09(nombre: string): string {
    const limpio = String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .trim();
    if (!limpio) return '';
    const palabras = limpio.split(/\s+/).filter(Boolean);
    const stop = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SA', 'CV', 'SRL', 'SC']);
    const base = palabras.filter((p) => !stop.has(p));
    const siglas = (base.length ? base : palabras).map((p) => p[0]).join('').slice(0, 3);
    if (siglas.length >= 3) return siglas;
    return (base[0] || palabras[0] || '').slice(0, 3).padEnd(3, 'X');
  }

  folioAceptadoAthF09(folioBase: string, empresa: string): string {
    const base = this.normalizarFolioBaseAthF09(folioBase);
    if (!base) return '';
    const ini = this.extraerInicialesEmpresaAthF09(empresa);
    return ini ? `${ini}-${base}` : base;
  }

  private folioTienePrefijoEmpresaAthF09(folio: string): boolean {
    return /^[A-Z0-9]{2,4}-SC-\d{2}-\d{3}$/.test(
      String(folio || '').trim().toUpperCase().replace(/\s+/g, '')
    );
  }

  /** Pendiente sin PDF o sin folio AAA-SC-YY-NNN; Aceptada con PDF firmado y prefijo de empresa. */
  private actualizarEstatusAutomaticoAthF09(cot?: AthF09Cotizacion | null): void {
    const c = cot || this.athF09CotizacionActiva;
    if (!c) return;

    const folioNorm = String(c.folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const tienePdf = !!c.pdfFirmado?.driveFileId;
    const conPrefijo = this.folioTienePrefijoEmpresaAthF09(folioNorm);
    const empresa = String(c.empresa || '').trim();

    if (tienePdf && conPrefijo && empresa) {
      c.aceptada = true;
      if (c.folioBase && !conPrefijo) {
        const esperado = this.folioAceptadoAthF09(c.folioBase, empresa);
        if (esperado) c.folio = esperado;
      }
    } else {
      c.aceptada = false;
      if (c.folioBase) {
        c.folio = c.folioBase;
      }
    }
  }

  private generarFolioSugeridoAthF09(cotizaciones: AthF09Cotizacion[] = []): string {
    const yy = String(new Date().getFullYear()).slice(-2);
    let max = 0;
    for (const c of cotizaciones) {
      for (const f of [c.folio, c.folioBase]) {
        const m = String(f || '').toUpperCase().match(/SC-(\d{2})-(\d{3})$/);
        if (m && m[1] === yy) {
          max = Math.max(max, Number(m[2]));
        }
      }
    }
    return `SC-${yy}-${String(max + 1).padStart(3, '0')}`;
  }

  private normalizarSaltosAthF09(texto: unknown): string {
    return String(texto || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private sanitizarPdfAthF09(raw: any): AthF09PdfFirmado | null {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'Cotización firmada.pdf').trim(),
      webViewLink: raw.webViewLink || raw.web_view_link || null,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  private inferirAceptadaAthF09(cot: Pick<AthF09Cotizacion, 'folio' | 'empresa' | 'pdfFirmado'>): boolean {
    const folio = String(cot.folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const empresa = String(cot.empresa || '').trim();
    return !!cot.pdfFirmado?.driveFileId
      && !!empresa
      && this.folioTienePrefijoEmpresaAthF09(folio);
  }

  private normalizarAthF09Cotizacion(raw: Partial<AthF09Cotizacion> | null | undefined): AthF09Cotizacion {
    const base = this.crearAthF09CotizacionVacia();
    if (!raw || typeof raw !== 'object') return base;
    const folioIngresado = String(raw.folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const folioBase = this.normalizarFolioBaseAthF09(String(raw.folioBase || folioIngresado || ''));
    const empresa = String(raw.empresa || '').trim();
    const pdfFirmado = this.sanitizarPdfAthF09(raw.pdfFirmado || (raw as any).pdf_firmado);
    let folioFinal = folioIngresado || folioBase;
    const folioBaseFinal = folioBase || this.normalizarFolioBaseAthF09(folioFinal);
    const aceptada = this.inferirAceptadaAthF09({
      folio: folioFinal,
      empresa,
      pdfFirmado
    });
    if (aceptada) {
      if (!this.folioTienePrefijoEmpresaAthF09(folioFinal) && folioBaseFinal) {
        folioFinal = this.folioAceptadoAthF09(folioBaseFinal, empresa) || folioFinal;
      }
    } else if (folioBaseFinal) {
      folioFinal = folioBaseFinal;
    }
    const resultado: AthF09Cotizacion = {
      id: String(raw.id || '').trim() || this.nuevoIdAthF09(),
      folio: folioFinal,
      folioBase: folioBaseFinal,
      folioAnterior: raw.folioAnterior || null,
      empresa,
      aceptada,
      driveFileId: String(raw.driveFileId || (raw as any).drive_file_id || '').trim() || null,
      nombreArchivo: String(raw.nombreArchivo || (raw as any).nombre_archivo || '').trim() || null,
      fechaCreacion: String(raw.fechaCreacion || (raw as any).fecha_creacion || new Date().toISOString().slice(0, 10)),
      pdfFirmado,
      borrador: raw.borrador !== false && !raw.driveFileId && !(raw as any).drive_file_id,
      lugar: String(raw.lugar || 'Pachuca, Hidalgo').trim() || 'Pachuca, Hidalgo',
      fechaCarta: String(raw.fechaCarta || (raw as any).fecha_carta || new Date().toISOString().slice(0, 10)),
      destinatario: String(raw.destinatario || '').trim(),
      atencion: String(raw.atencion || '').trim(),
      terminos: Array.isArray(raw.terminos) && raw.terminos.length
        ? raw.terminos.map((t) => this.normalizarSaltosAthF09(t)).filter(Boolean)
        : ['Término 1.', 'Término 2.', 'Término 3.'],
      entregables: Array.isArray(raw.entregables) && raw.entregables.length
        ? raw.entregables.map((t) => this.normalizarSaltosAthF09(t)).filter(Boolean)
        : ['Entregable 1.', 'Entregable 2.', 'Entregable 3.'],
      presupuestoIntro: String(raw.presupuestoIntro || (raw as any).presupuesto_intro
        || 'El presupuesto de ejecución del trabajo solicitado será de la siguiente forma:').trim(),
      presupuestoItems: Array.isArray(raw.presupuestoItems || (raw as any).presupuesto_items)
        && (raw.presupuestoItems || (raw as any).presupuesto_items).length
        ? (raw.presupuestoItems || (raw as any).presupuesto_items).map((r: any) => this.sanitizarPresupuestoItemAthF09(r))
        : [this.crearAthF09PresupuestoItemVacio(), this.crearAthF09PresupuestoItemVacio(), this.crearAthF09PresupuestoItemVacio()],
      notas: Array.isArray(raw.notas) ? raw.notas.map((n) => String(n || '').trim()).filter(Boolean) : [],
      subtotal: raw.subtotal != null ? Number(raw.subtotal) : null,
      iva: raw.iva != null ? Number(raw.iva) : null,
      total: raw.total != null ? Number(raw.total) : null
    };
    this.recalcularTotalesPresupuestoAthF09(resultado);
    return resultado;
  }

  private crearAthF09CotizacionVacia(folioSugerido?: string): AthF09Cotizacion {
    const folioBase = folioSugerido || this.generarFolioSugeridoAthF09(this.athF09Form?.cotizaciones || []);
    const cot: AthF09Cotizacion = {
      id: this.nuevoIdAthF09(),
      folio: folioBase,
      folioBase,
      empresa: '',
      aceptada: false,
      driveFileId: null,
      nombreArchivo: null,
      fechaCreacion: new Date().toISOString().slice(0, 10),
      pdfFirmado: null,
      borrador: true,
      lugar: 'Pachuca, Hidalgo',
      fechaCarta: new Date().toISOString().slice(0, 10),
      destinatario: '',
      atencion: '',
      terminos: ['Término 1.', 'Término 2.', 'Término 3.'],
      entregables: ['Entregable 1.', 'Entregable 2.', 'Entregable 3.'],
      presupuestoIntro: 'El presupuesto de ejecución del trabajo solicitado será de la siguiente forma:',
      presupuestoItems: [
        this.crearAthF09PresupuestoItemVacio(),
        this.crearAthF09PresupuestoItemVacio(),
        this.crearAthF09PresupuestoItemVacio()
      ],
      notas: [],
      subtotal: null,
      iva: null,
      total: null
    };
    this.recalcularTotalesPresupuestoAthF09(cot);
    return cot;
  }

  private normalizarAthF09Form(datos: Partial<AthF09FormData> | any | null | undefined): AthF09FormData {
    const base = this.crearAthF09FormVacio();
    if (!datos || typeof datos !== 'object') return base;
    const cotizaciones = (Array.isArray(datos.cotizaciones) ? datos.cotizaciones : [])
      .map((c) => this.normalizarAthF09Cotizacion(c));
    const activoId = datos.cotizacionActivaId || datos.cotizacion_activa_id
      ? String(datos.cotizacionActivaId || datos.cotizacion_activa_id)
      : null;
    return {
      revision: String(datos.revision || base.revision).trim() || base.revision,
      fechaRevision: String(datos.fechaRevision || base.fechaRevision).trim() || base.fechaRevision,
      fechaElaboracion: String(datos.fechaElaboracion || base.fechaElaboracion).trim() || base.fechaElaboracion,
      cotizaciones,
      cotizacionActivaId: activoId && cotizaciones.some((c) => c.id === activoId)
        ? activoId
        : (cotizaciones[0]?.id || null)
    };
  }

  get athF09IntroLead(): string {
    if (this.plantillaSlug !== 'ath-f-09') return '';
    return 'Archivero de cotizaciones. Crea un registro desde la plantilla Rev 2, asigna folio SC-YY-NNN y sincroniza el Word en Drive. Al subir el PDF firmado podrás marcar la aceptación con folio de proyecto.';
  }

  get athF09CotizacionesVista(): AthF09Cotizacion[] {
    const q = this.athF09Busqueda.trim().toLowerCase();
    const lista = [...(this.athF09Form.cotizaciones || [])].sort((a, b) => {
      const fa = String(a.folio || a.folioBase || '');
      const fb = String(b.folio || b.folioBase || '');
      return fb.localeCompare(fa, 'es');
    });
    if (!q) return lista;
    return lista.filter((c) =>
      [c.folio, c.folioBase, c.empresa, c.destinatario, c.nombreArchivo]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  nuevoCotizacionAthF09(): void {
    const cot = this.crearAthF09CotizacionVacia(this.athF09SiguienteFolio || undefined);
    this.athF09Form.cotizaciones = [cot, ...(this.athF09Form.cotizaciones || [])];
    this.athF09Form.cotizacionActivaId = cot.id;
    this.athF09CotizacionActiva = cot;
    this.athF09Vista = 'editor';
    this.onAthF09Editado();
  }

  abrirCotizacionAthF09(cot: AthF09Cotizacion): void {
    this.athF09Form.cotizacionActivaId = cot.id;
    this.athF09CotizacionActiva = cot;
    this.actualizarEstatusAutomaticoAthF09(cot);
    this.athF09Vista = 'editor';
    this.actualizarDriveActivoAthF09(cot);
  }

  volverArchiveroAthF09(): void {
    this.athF09Vista = 'archivero';
    this.athF09CotizacionActiva = null;
    this.athF09Form.cotizacionActivaId = null;
    if (this.mostrarAthF09Editor) {
      this.toggleAthF09Editor();
    }
  }

  eliminarCotizacionAthF09(cot: AthF09Cotizacion, event?: Event): void {
    event?.stopPropagation();
    const etiqueta = cot.folio || cot.folioBase || 'sin folio';
    if (!confirm(`¿Eliminar la cotización «${etiqueta}» del archivero?`)) return;
    this.athF09Form.cotizaciones = (this.athF09Form.cotizaciones || []).filter((c) => c.id !== cot.id);
    if (this.athF09CotizacionActiva?.id === cot.id) {
      this.volverArchiveroAthF09();
    }
    this.onAthF09Editado();
  }

  onAthF09FolioChange(): void {
    if (!this.athF09CotizacionActiva) return;
    const folio = String(this.athF09CotizacionActiva.folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const base = this.normalizarFolioBaseAthF09(folio);
    if (base) {
      this.athF09CotizacionActiva.folioBase = base;
    }
    this.actualizarEstatusAutomaticoAthF09();
    this.sincronizarCotizacionActivaEnFormAthF09();
    this.onAthF09Editado();
  }

  onAthF09EmpresaChange(): void {
    if (!this.athF09CotizacionActiva) return;
    this.actualizarEstatusAutomaticoAthF09();
    this.sincronizarCotizacionActivaEnFormAthF09();
    this.onAthF09Editado();
  }

  private sincronizarCotizacionActivaEnFormAthF09(): void {
    if (!this.athF09CotizacionActiva) return;
    const idx = (this.athF09Form.cotizaciones || []).findIndex((c) => c.id === this.athF09CotizacionActiva?.id);
    if (idx >= 0) {
      this.athF09Form.cotizaciones[idx] = { ...this.athF09CotizacionActiva };
    }
    this.athF09Form.cotizacionActivaId = this.athF09CotizacionActiva.id;
  }

  private actualizarDriveActivoAthF09(cot?: AthF09Cotizacion | null): void {
    const activa = cot || this.athF09CotizacionActiva;
    this.athF09DriveFileId = activa?.driveFileId || null;
    const editorUrl = activa?.driveFileId
      ? `https://docs.google.com/document/d/${activa.driveFileId}/edit?usp=sharing`
      : null;
    this.fijarEditorEmbedUrlAthF09(editorUrl, true);
  }

  onAthF09Editado(): void {
    if (this.athF09IgnorarAutoSave || !this.athF09Listo) return;
    if (this.athF09CotizacionActiva) {
      this.actualizarEstatusAutomaticoAthF09();
      this.sincronizarCotizacionActivaEnFormAthF09();
    }
    this.athF09CambiosPendientes = true;
  }

  onSeleccionarPdfAthF09(event: Event): void {
    if (!this.athF09CotizacionActiva) return;
    const folio = (this.athF09CotizacionActiva.folio || this.athF09CotizacionActiva.folioBase || 'cotizacion')
      .replace(/[^\w\s-]/g, '').trim();
    this.procesarPdfDocumento(
      event,
      `${folio} firmado.pdf`,
      (base64, nombre) => this.confirmarFolioYSubirPdfAthF09(base64, nombre)
    );
  }

  private async confirmarFolioYSubirPdfAthF09(pdfBase64: string, nombreArchivo: string): Promise<void> {
    if (!this.athF09CotizacionActiva) return;
    const cot = this.athF09CotizacionActiva;
    const folioBase = cot.folioBase || this.normalizarFolioBaseAthF09(cot.folio);
    const sugerido = this.folioAceptadoAthF09(folioBase, cot.empresa) || folioBase;

    const resultado = await Swal.fire({
      icon: 'question',
      title: 'Cotización aceptada',
      html:
        '<p>Al subir el PDF firmado se registrará la <strong>aceptación</strong> de la cotización.</p>'
        + '<p class="mb-0">Confirma o ajusta el folio del proyecto:</p>',
      input: 'text',
      inputValue: sugerido,
      inputAttributes: { autocapitalize: 'characters', 'aria-label': 'Folio del proyecto' },
      showCancelButton: true,
      confirmButtonText: 'Subir PDF y actualizar folio',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#15a596',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
      inputValidator: (value) => {
        if (!String(value || '').trim()) {
          return 'Indica el folio del proyecto';
        }
        return null;
      }
    });

    if (!resultado.isConfirmed) return;
    this.subirPdfFirmadoAthF09(pdfBase64, nombreArchivo, String(resultado.value || '').trim().toUpperCase());
  }

  private subirPdfFirmadoAthF09(pdfBase64: string, nombreArchivo: string, folioPropuesto: string): void {
    if (this.athF09SubiendoPdf || !this.athF09CotizacionActiva) return;
    this.athF09SubiendoPdf = true;
    this.backendService.subirPdfFirmadoAthF09(
      pdfBase64,
      nombreArchivo,
      this.athF09CotizacionActiva.id,
      folioPropuesto
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF09SubiendoPdf = false;
          this.aplicarEstadoAthF09(res);
          if (this.athF09CotizacionActiva && res?.pdfFirmado) {
            this.athF09CotizacionActiva.pdfFirmado = this.sanitizarPdfAthF09(res.pdfFirmado);
            if (res.folioActualizado) {
              this.athF09CotizacionActiva.folio = res.folioActualizado;
            }
            this.actualizarEstatusAutomaticoAthF09();
            this.sincronizarCotizacionActivaEnFormAthF09();
          }
        },
        error: () => {
          this.athF09SubiendoPdf = false;
        }
      });
  }

  private fijarEditorEmbedUrlAthF09(editorUrl: string | null, forzar = false): void {
    if (!forzar && this.mostrarAthF09Editor && this.athF09EditorEmbedUrlSafe && this.athF09EditorUrl === editorUrl) {
      return;
    }
    if (!editorUrl) {
      this.athF09EditorUrl = null;
      this.athF09EditorEmbedUrlSafe = null;
      return;
    }
    const url = this.resolverUrlEditorDrive(editorUrl, this.athF09DriveFileId);
    this.athF09EditorUrl = url || editorUrl;
    const embedUrl = this.urlIframeDriveSegunPermiso(this.athF09EditorUrl);
    this.athF09EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  toggleAthF09Editor(): void {
    if (this.mostrarAthF09Editor) {
      this.mostrarAthF09Editor = false;
      this.athF09EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      return;
    }
    if (!this.athF09CotizacionActiva?.driveFileId) {
      void Swal.fire({
        icon: 'info',
        title: 'Documento pendiente',
        text: 'Guarda la cotización primero para generar el Word en Drive y poder abrir el editor.',
        confirmButtonColor: '#15a596'
      });
      return;
    }
    const url = this.resolverUrlEditorDrive(this.athF09EditorUrl, this.athF09DriveFileId);
    this.fijarEditorEmbedUrlAthF09(url, true);
    this.mostrarAthF09Editor = true;
    this.athF09EditorCargando = true;
    this.athF09EditorIframeListo = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  onAthF09IframeLoad(): void {
    this.athF09EditorIframeListo = true;
    this.athF09EditorCargando = false;
  }

  actualizarPlantillaAthF09(): void {
    if (this.athF09ActualizandoPlantilla) return;
    this.athF09ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaAthF09()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.athF09ActualizandoPlantilla = false;
          void Swal.fire({
            icon: 'success',
            title: 'Plantilla verificada',
            text: 'La plantilla maestra ATH-F-09 está disponible para nuevas cotizaciones.',
            confirmButtonColor: '#15a596'
          });
        },
        error: () => {
          this.athF09ActualizandoPlantilla = false;
        }
      });
  }

  private cargarAthF09DesdeServidor(): void {
    this.athF09Cargando = true;
    this.backendService.cargarAthF09Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF09(res),
        error: () => {
          this.athF09Cargando = false;
          this.athF09Vista = 'archivero';
          this.athF09CotizacionActiva = null;
          this.athF09Listo = true;
        }
      });
  }

  private sincronizarAthF09DesdeDrive(): void {
    this.backendService.sincronizarAthF09DesdeDrive(this.athF09CotizacionActiva?.id || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF09(res, false, true, true)
      });
  }

  private persistirAthF09(): void {
    if (this.athF09Guardando || !this.athF09Listo) return;
    this.athF09Guardando = true;
    this.sincronizarCotizacionActivaEnFormAthF09();
    if (this.athF09CotizacionActiva) {
      this.athF09CotizacionActiva.borrador = false;
    }
    this.backendService.guardarAthF09Formato(
      { ...this.athF09Form, cotizacionActivaId: this.athF09CotizacionActiva?.id || this.athF09Form.cotizacionActivaId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF09(res, true, false, true);
          this.athF09CambiosPendientes = false;
          this.athF09Guardando = false;
        },
        error: () => {
          this.athF09Guardando = false;
        }
      });
  }

  private aplicarEstadoAthF09(
    res: any,
    conservarEdicion = false,
    desdeDrive = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res) {
      if (!desdeDrive) this.athF09Cargando = false;
      this.athF09Listo = true;
      return;
    }

    const editorAbierto = this.mostrarAthF09Editor && !forzarActualizacionDrive;
    const activoId = this.athF09CotizacionActiva?.id || this.athF09Form.cotizacionActivaId || null;

    if (res.datos) {
      this.athF09IgnorarAutoSave = true;
      this.athF09Form = this.normalizarAthF09Form(res.datos);
      if (activoId && this.athF09Form.cotizaciones.some((c) => c.id === activoId)) {
        this.athF09Form.cotizacionActivaId = activoId;
      } else {
        this.athF09Form.cotizacionActivaId = null;
      }
      this.athF09CotizacionActiva = activoId
        ? this.athF09Form.cotizaciones.find((c) => c.id === activoId) || null
        : null;
      if (!this.athF09CotizacionActiva && this.athF09Vista === 'editor') {
        this.athF09Vista = 'archivero';
      }
      setTimeout(() => {
        this.athF09IgnorarAutoSave = false;
      }, 0);
      this.sincronizarCotizacionActivaEnFormAthF09();
    }

    if (res.siguienteFolioSugerido) {
      this.athF09SiguienteFolio = res.siguienteFolioSugerido;
    } else {
      this.athF09SiguienteFolio = this.generarFolioSugeridoAthF09(this.athF09Form.cotizaciones);
    }

    this.athF09UltimaSync = res.ultimaSyncDrive || null;
    this.athF09ContenidoModificado = !!res.contenidoModificado;
    this.actualizarDriveActivoAthF09(this.athF09CotizacionActiva);
    if (res.editorUrl && (forzarActualizacionDrive || !editorAbierto)) {
      this.fijarEditorEmbedUrlAthF09(res.editorUrl, forzarActualizacionDrive);
    }

    this.athF09Listo = true;
    if (!conservarEdicion) {
      this.athF09Cargando = false;
    }
  }

  private crearCompetenciasAthF11Defecto(): AthF11Competencia[] {
    return [
      { id: 'conocimiento_puesto', grupo: 'tecnicas', titulo: 'Conocimiento del puesto', descripcion: 'Aplica los conocimientos y habilidades requeridas para su función.', calificacion: null },
      { id: 'calidad_precision', grupo: 'tecnicas', titulo: 'Calidad y precisión del trabajo', descripcion: 'Cumple con estándares, reduce errores y mantiene orden.', calificacion: null },
      { id: 'responsabilidad_compromiso', grupo: 'organizacionales', titulo: 'Responsabilidad y compromiso', descripcion: 'Cumple normas, políticas internas y responsabilidades asignadas.', calificacion: null },
      { id: 'orientacion_resultados', grupo: 'organizacionales', titulo: 'Orientación a resultados', descripcion: 'Enfoca sus actividades al logro de objetivos y metas del área.', calificacion: null },
      { id: 'trabajo_equipo', grupo: 'interpersonales', titulo: 'Trabajo en equipo', descripcion: 'Colabora de manera efectiva y mantiene relaciones laborales positivas.', calificacion: null },
      { id: 'comunicacion_efectiva', grupo: 'interpersonales', titulo: 'Comunicación efectiva', descripcion: 'Expresa ideas con claridad y escucha activamente.', calificacion: null },
      { id: 'iniciativa_proactividad', grupo: 'personales', titulo: 'Iniciativa y proactividad', descripcion: 'Propone mejoras y actúa sin supervisión constante.', calificacion: null },
      { id: 'adaptabilidad_cambio', grupo: 'personales', titulo: 'Adaptabilidad al cambio', descripcion: 'Se ajusta positivamente a nuevos procesos o situaciones.', calificacion: null }
    ];
  }

  private crearAthF11FormVacio(): AthF11FormData {
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      revision: '00',
      fechaRevision: '2026-03-04',
      fechaElaboracion: hoy,
      evaluaciones: [],
      evaluacionActivaId: null
    };
  }

  private nuevoIdAthF11(): string {
    return `ath11-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private fechaHoyIsoAthF11(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private normalizarFolioAthF11(folio: string): string {
    const limpio = String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = limpio.match(/^ED-\d{2}-\d{3}$/);
    return m ? m[0] : limpio;
  }

  private generarFolioSugeridoAthF11(evaluaciones: AthF11Evaluacion[] = []): string {
    const yy = String(new Date().getFullYear()).slice(-2);
    let max = 0;
    for (const ev of evaluaciones) {
      const m = String(ev.folio || '').toUpperCase().match(/^ED-(\d{2})-(\d{3})$/);
      if (m && m[1] === yy) {
        max = Math.max(max, Number(m[2]));
      }
    }
    return `ED-${yy}-${String(max + 1).padStart(3, '0')}`;
  }

  private normalizarSaltosAthF11(texto: unknown): string {
    return String(texto || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private sanitizarCalificacionAthF11(raw: unknown): number | null {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    if (![6, 7, 8, 9, 10].includes(n)) return null;
    return n;
  }

  private normalizarCompetenciasAthF11(raw: unknown): AthF11Competencia[] {
    const mapa = new Map<string, any>();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const id = String(item?.id || '').trim();
        if (id) mapa.set(id, item);
      }
    }
    return this.crearCompetenciasAthF11Defecto().map((def) => {
      const found = mapa.get(def.id) || {};
      return {
        ...def,
        calificacion: this.sanitizarCalificacionAthF11(found.calificacion ?? found.score)
      };
    });
  }

  calcularPromedioAthF11(competencias: AthF11Competencia[] | null | undefined): number | null {
    const vals = (competencias || [])
      .map((c) => c.calificacion)
      .filter((n): n is number => n != null && !Number.isNaN(n));
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.round(avg * 100) / 100;
  }

  formatearPromedioAthF11(valor: number | null | undefined): string {
    if (valor == null || Number.isNaN(Number(valor))) return '—';
    return Number(valor).toFixed(2);
  }

  setCalificacionAthF11(compId: string, valor: number | null): void {
    if (!this.athF11EvaluacionActiva) return;
    const id = String(compId || '').trim();
    const comp = (this.athF11EvaluacionActiva.competencias || []).find((c) => c.id === id);
    if (!comp) return;
    comp.calificacion = this.sanitizarCalificacionAthF11(valor);
    this.athF11EvaluacionActiva.promedioGeneral = this.calcularPromedioAthF11(this.athF11EvaluacionActiva.competencias);
    this.onAthF11Editado();
  }

  esCalificacionAthF11(comp: AthF11Competencia | null | undefined, valor: number): boolean {
    if (!comp) return false;
    const actual = this.sanitizarCalificacionAthF11(comp.calificacion);
    return actual != null && actual === Number(valor);
  }

  nivelPromedioAthF11(valor: number | null | undefined): 'feliz' | 'preocupada' | 'triste' | null {
    if (valor == null || valor === undefined || Number.isNaN(Number(valor))) return null;
    const n = Number(valor);
    if (n >= 8.5) return 'feliz';
    if (n >= 8) return 'preocupada';
    return 'triste';
  }

  ariaPromedioAthF11(valor: number | null | undefined): string {
    const mood = this.nivelPromedioAthF11(valor);
    if (mood === 'feliz') return 'Desempeño destacado';
    if (mood === 'preocupada') return 'Desempeño aceptable con área de atención';
    if (mood === 'triste') return 'Desempeño por debajo del umbral';
    return '';
  }

  competenciasPorGrupoAthF11(grupo: AthF11Competencia['grupo']): AthF11Competencia[] {
    const lista = this.athF11EvaluacionActiva?.competencias || [];
    return lista.filter((c) => c.grupo === grupo);
  }

  formatearFechaRevAthF11(iso: string | null | undefined): string {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return `${m[3]}-${m[2]}-${m[1].slice(-2)}`;
  }

  private normalizarAthF11Evaluacion(raw: Partial<AthF11Evaluacion> | null | undefined): AthF11Evaluacion {
    const base = this.crearAthF11EvaluacionVacia();
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    const competencias = this.normalizarCompetenciasAthF11(raw.competencias);
    const promedioManual = (raw as any).promedioGeneral ?? (raw as any).promedio_general;
    const promedioCalc = this.calcularPromedioAthF11(competencias);
    // Si hay calificaciones, el promedio siempre se recalcula desde ellas (evita nodos vacíos con promedio viejo).
    const promedioGeneral = promedioCalc != null
      ? promedioCalc
      : (promedioManual === '' || promedioManual == null
        ? null
        : (Number.isNaN(Number(promedioManual)) ? null : Number(promedioManual)));
    const fechaIso = (v: unknown, fallback = '') => {
      const s = String(v || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      return fallback;
    };
    return {
      id: String(raw.id || '').trim() || this.nuevoIdAthF11(),
      folio: this.normalizarFolioAthF11(String(raw.folio || '')),
      nombreCompleto: String(raw.nombreCompleto || (raw as any).nombre_completo || '').trim(),
      puesto: String(raw.puesto || '').trim(),
      areaDepartamento: String(raw.areaDepartamento || (raw as any).area_departamento || '').trim(),
      noEmpleado: String(raw.noEmpleado || (raw as any).no_empleado || '').trim(),
      fechaIngreso: fechaIso(raw.fechaIngreso || (raw as any).fecha_ingreso),
      periodoEvaluado: String(raw.periodoEvaluado || (raw as any).periodo_evaluado || '').trim(),
      evaluador: String(raw.evaluador || '').trim(),
      usuarioId: String(raw.usuarioId || (raw as any).usuario_id || '').trim() || null,
      competencias,
      observaciones: this.normalizarSaltosAthF11(raw.observaciones),
      promedioGeneral,
      fortalezas: this.normalizarSaltosAthF11(raw.fortalezas),
      areasOportunidad: this.normalizarSaltosAthF11(raw.areasOportunidad || (raw as any).areas_oportunidad),
      planMejora: this.normalizarSaltosAthF11(raw.planMejora || (raw as any).plan_mejora),
      comentariosEvaluador: this.normalizarSaltosAthF11(raw.comentariosEvaluador || (raw as any).comentarios_evaluador),
      fechaEvaluacion: fechaIso(raw.fechaEvaluacion || (raw as any).fecha_evaluacion, this.fechaHoyIsoAthF11()),
      driveFileId: String(raw.driveFileId || (raw as any).drive_file_id || '').trim() || null,
      nombreArchivo: String(raw.nombreArchivo || (raw as any).nombre_archivo || '').trim() || null,
      pdfFirmado: this.sanitizarPdfAthF11(raw.pdfFirmado || (raw as any).pdf_firmado),
      fechaCreacion: fechaIso(raw.fechaCreacion || (raw as any).fecha_creacion, this.fechaHoyIsoAthF11()),
      borrador: (raw as any).borrador !== false && !(raw.driveFileId || (raw as any).drive_file_id)
    };
  }

  private crearAthF11EvaluacionVacia(folioSugerido?: string): AthF11Evaluacion {
    const hoy = this.fechaHoyIsoAthF11();
    const folio = folioSugerido || this.generarFolioSugeridoAthF11(this.athF11Form?.evaluaciones || []);
    return {
      id: this.nuevoIdAthF11(),
      folio,
      nombreCompleto: '',
      puesto: '',
      areaDepartamento: '',
      noEmpleado: '',
      fechaIngreso: '',
      periodoEvaluado: '',
      evaluador: '',
      usuarioId: null,
      competencias: this.crearCompetenciasAthF11Defecto(),
      observaciones: '',
      promedioGeneral: null,
      fortalezas: '',
      areasOportunidad: '',
      planMejora: '',
      comentariosEvaluador: '',
      fechaEvaluacion: hoy,
      driveFileId: null,
      nombreArchivo: null,
      pdfFirmado: null,
      fechaCreacion: hoy,
      borrador: true
    };
  }

  private normalizarAthF11Form(datos: Partial<AthF11FormData> | any | null | undefined): AthF11FormData {
    const base = this.crearAthF11FormVacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    const evaluaciones = (Array.isArray(datos.evaluaciones) ? datos.evaluaciones : [])
      .map((e: any) => this.normalizarAthF11Evaluacion(e));
    const activoId = datos.evaluacionActivaId || datos.evaluacion_activa_id
      ? String(datos.evaluacionActivaId || datos.evaluacion_activa_id)
      : (evaluaciones[0]?.id || null);
    return {
      revision: String(datos.revision || base.revision).trim() || base.revision,
      fechaRevision: String(datos.fechaRevision || base.fechaRevision).trim() || base.fechaRevision,
      fechaElaboracion: String(datos.fechaElaboracion || base.fechaElaboracion).trim() || base.fechaElaboracion,
      evaluaciones,
      evaluacionActivaId: activoId && evaluaciones.some((e) => e.id === activoId)
        ? activoId
        : (evaluaciones[0]?.id || null)
    };
  }

  get athF11IntroLead(): string {
    if (this.plantillaSlug !== 'ath-f-11') return '';
    return 'Archivero de evaluaciones de desempeño. Busca al colaborador, completa la evaluación y sincroniza el documento en Drive.';
  }

  get athF11EvaluacionesVista(): AthF11Evaluacion[] {
    const q = this.athF11Busqueda.trim().toLowerCase();
    const lista = [...(this.athF11Form.evaluaciones || [])].sort((a, b) => {
      const fa = String(a.fechaCreacion || a.nombreCompleto || '');
      const fb = String(b.fechaCreacion || b.nombreCompleto || '');
      return fb.localeCompare(fa, 'es');
    });
    if (!q) return lista;
    return lista.filter((e) =>
      [e.nombreCompleto, e.evaluador, e.puesto, e.areaDepartamento, e.noEmpleado, e.periodoEvaluado, e.nombreArchivo]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  private cargarCatalogoEmpleadosAthF11(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const mapa = new Map<string, AthF11EmpleadoCatalogo>();
          for (const u of usuarios) {
            if (this.esPerfilEmpresaAthF11(u)) continue;
            const item = this.mapearEmpleadoCatalogoAthF11(u);
            if (!item.nombreCompleto) continue;
            const key = this.normalizarTextoAthF11(item.nombreCompleto);
            if (!mapa.has(key)) mapa.set(key, item);
          }
          this.athF11EmpleadosCatalogo = Array.from(mapa.values())
            .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
        },
        error: () => {
          this.athF11EmpleadosCatalogo = [];
        }
      });
  }

  private esPerfilEmpresaAthF11(usuario: any): boolean {
    const rol = String(usuario?.rol || '').toLowerCase().trim();
    if (rol === 'empresa' || rol === 'usuario empresa') return true;
    const adicionales = String(usuario?.roles_adicionales || '')
      .toLowerCase()
      .split(/[,;|]/)
      .map((r) => r.trim())
      .filter(Boolean);
    return adicionales.includes('empresa') || adicionales.includes('usuario empresa');
  }

  private mapearEmpleadoCatalogoAthF11(usuario: any): AthF11EmpleadoCatalogo {
    const nombre = this.quitarCargoAthF11(String(usuario?.nombre || '').trim());
    const apellido = String(usuario?.apellido || '').trim();
    const nombreCompleto = `${nombre} ${apellido}`.trim() || String(usuario?.username || '').trim();
    const organigrama = String(usuario?.organigrama || '').trim();
    const puesto = puestoCanonicoOrganigrama(organigrama) || organigrama;
    const areaBd = String(usuario?.area_departamento || usuario?.areaDepartamento || '').trim();
    const areaDepartamento = areaBd || areaDePuesto(puesto) || '';
    return {
      id: String(usuario?.id || usuario?.usuario_id || '').trim(),
      nombreCompleto,
      puesto,
      areaDepartamento,
      noEmpleado: String(usuario?.username || usuario?.no_empleado || '').trim()
    };
  }

  private quitarCargoAthF11(nombre: string): string {
    return String(nombre || '')
      .replace(/^(Ing\.?|Mtro\.?|Mtra\.?|Dr\.?|Dra\.?|Doc\.?|Lic\.?|Prof\.?|Arq\.?|Q\.?\s*F\.?\s*B\.?|C\.)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizarTextoAthF11(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  get empleadosFiltradosAthF11(): AthF11EmpleadoCatalogo[] {
    const query = this.normalizarTextoAthF11(this.athF11NombreComboQuery);
    if (!query) return this.athF11EmpleadosCatalogo.slice(0, 40);
    return this.athF11EmpleadosCatalogo
      .filter((e) =>
        [e.nombreCompleto, e.puesto, e.areaDepartamento, e.noEmpleado]
          .some((v) => this.normalizarTextoAthF11(v).includes(query))
      )
      .slice(0, 40);
  }

  get evaluadoresFiltradosAthF11(): AthF11EmpleadoCatalogo[] {
    const query = this.normalizarTextoAthF11(this.athF11EvaluadorComboQuery);
    if (!query) return this.athF11EmpleadosCatalogo.slice(0, 40);
    return this.athF11EmpleadosCatalogo
      .filter((e) => this.normalizarTextoAthF11(e.nombreCompleto).includes(query))
      .slice(0, 40);
  }

  get textoLibreNombreAthF11(): string {
    const q = String(this.athF11NombreComboQuery || '').trim();
    if (!q) return '';
    const existe = this.athF11EmpleadosCatalogo.some(
      (e) => this.normalizarTextoAthF11(e.nombreCompleto) === this.normalizarTextoAthF11(q)
    );
    return existe ? '' : q;
  }

  get textoLibreEvaluadorAthF11(): string {
    const q = String(this.athF11EvaluadorComboQuery || '').trim();
    if (!q) return '';
    const existe = this.athF11EmpleadosCatalogo.some(
      (e) => this.normalizarTextoAthF11(e.nombreCompleto) === this.normalizarTextoAthF11(q)
    );
    return existe ? '' : q;
  }

  textoComboNombreAthF11(): string {
    if (this.athF11NombreComboAbierto) return this.athF11NombreComboQuery;
    return String(this.athF11EvaluacionActiva?.nombreCompleto || '');
  }

  textoComboEvaluadorAthF11(): string {
    if (this.athF11EvaluadorComboAbierto) return this.athF11EvaluadorComboQuery;
    return String(this.athF11EvaluacionActiva?.evaluador || '');
  }

  abrirComboNombreAthF11(): void {
    this.athF11EvaluadorComboAbierto = false;
    this.athF11NombreComboAbierto = true;
    this.athF11NombreComboQuery = String(this.athF11EvaluacionActiva?.nombreCompleto || '');
  }

  abrirComboEvaluadorAthF11(): void {
    this.athF11NombreComboAbierto = false;
    this.athF11EvaluadorComboAbierto = true;
    this.athF11EvaluadorComboQuery = String(this.athF11EvaluacionActiva?.evaluador || '');
  }

  cerrarCombosAthF11(): void {
    this.athF11NombreComboAbierto = false;
    this.athF11EvaluadorComboAbierto = false;
  }

  onNombreComboInputAthF11(valor: string): void {
    if (!this.athF11EvaluacionActiva) return;
    this.athF11NombreComboQuery = valor;
    this.athF11EvaluacionActiva.nombreCompleto = valor;
    this.athF11EvaluacionActiva.usuarioId = null;
    this.onAthF11Editado();
  }

  onEvaluadorComboInputAthF11(valor: string): void {
    if (!this.athF11EvaluacionActiva) return;
    this.athF11EvaluadorComboQuery = valor;
    this.athF11EvaluacionActiva.evaluador = valor;
    this.onAthF11Editado();
  }

  seleccionarEmpleadoAthF11(emp: AthF11EmpleadoCatalogo): void {
    if (!this.athF11EvaluacionActiva || !emp) return;
    this.athF11EvaluacionActiva.nombreCompleto = emp.nombreCompleto;
    this.athF11EvaluacionActiva.usuarioId = emp.id || null;
    this.athF11EvaluacionActiva.puesto = emp.puesto || this.athF11EvaluacionActiva.puesto;
    this.athF11EvaluacionActiva.areaDepartamento = emp.areaDepartamento || this.athF11EvaluacionActiva.areaDepartamento;
    this.athF11NombreComboQuery = emp.nombreCompleto;
    this.athF11NombreComboAbierto = false;
    this.onAthF11Editado();
  }

  seleccionarNombreLibreAthF11(nombre: string): void {
    if (!this.athF11EvaluacionActiva) return;
    const limpio = String(nombre || '').trim();
    this.athF11EvaluacionActiva.nombreCompleto = limpio;
    this.athF11EvaluacionActiva.usuarioId = null;
    this.athF11NombreComboQuery = limpio;
    this.athF11NombreComboAbierto = false;
    this.onAthF11Editado();
  }

  limpiarNombreAthF11(): void {
    if (!this.athF11EvaluacionActiva) return;
    this.athF11EvaluacionActiva.nombreCompleto = '';
    this.athF11EvaluacionActiva.usuarioId = null;
    this.athF11NombreComboQuery = '';
    this.onAthF11Editado();
  }

  seleccionarEvaluadorAthF11(emp: AthF11EmpleadoCatalogo): void {
    if (!this.athF11EvaluacionActiva || !emp) return;
    this.athF11EvaluacionActiva.evaluador = emp.nombreCompleto;
    this.athF11EvaluadorComboQuery = emp.nombreCompleto;
    this.athF11EvaluadorComboAbierto = false;
    this.onAthF11Editado();
  }

  seleccionarEvaluadorLibreAthF11(nombre: string): void {
    if (!this.athF11EvaluacionActiva) return;
    const limpio = String(nombre || '').trim();
    this.athF11EvaluacionActiva.evaluador = limpio;
    this.athF11EvaluadorComboQuery = limpio;
    this.athF11EvaluadorComboAbierto = false;
    this.onAthF11Editado();
  }

  limpiarEvaluadorAthF11(): void {
    if (!this.athF11EvaluacionActiva) return;
    this.athF11EvaluacionActiva.evaluador = '';
    this.athF11EvaluadorComboQuery = '';
    this.onAthF11Editado();
  }

  nuevoEvaluacionAthF11(): void {
    const ev = this.crearAthF11EvaluacionVacia(this.athF11SiguienteFolio || undefined);
    this.athF11Form.evaluaciones = [ev, ...(this.athF11Form.evaluaciones || [])];
    this.athF11Form.evaluacionActivaId = ev.id;
    this.athF11EvaluacionActiva = ev;
    this.athF11Vista = 'editor';
    this.onAthF11Editado();
  }

  abrirEvaluacionAthF11(ev: AthF11Evaluacion): void {
    this.athF11Form.evaluacionActivaId = ev.id;
    this.athF11EvaluacionActiva = ev;
    this.athF11Vista = 'editor';
    this.actualizarDriveActivoAthF11(ev);
  }

  volverArchiveroAthF11(): void {
    this.athF11Vista = 'archivero';
    this.athF11EvaluacionActiva = null;
    this.athF11Form.evaluacionActivaId = null;
    if (this.mostrarAthF11Editor) {
      this.toggleAthF11Editor();
    }
  }

  eliminarEvaluacionAthF11(ev: AthF11Evaluacion, event?: Event): void {
    event?.stopPropagation();
    const etiqueta = ev.nombreCompleto || ev.evaluador || 'sin nombre';
    if (!confirm(`¿Eliminar la evaluación de «${etiqueta}» del archivero?`)) return;
    this.athF11Form.evaluaciones = (this.athF11Form.evaluaciones || []).filter((e) => e.id !== ev.id);
    if (this.athF11EvaluacionActiva?.id === ev.id) {
      this.volverArchiveroAthF11();
    }
    this.onAthF11Editado();
  }

  private sincronizarEvaluacionActivaEnFormAthF11(): void {
    if (!this.athF11EvaluacionActiva) return;
    const idx = (this.athF11Form.evaluaciones || []).findIndex((e) => e.id === this.athF11EvaluacionActiva?.id);
    if (idx >= 0) {
      this.athF11Form.evaluaciones[idx] = { ...this.athF11EvaluacionActiva };
    }
    this.athF11Form.evaluacionActivaId = this.athF11EvaluacionActiva.id;
  }

  private actualizarDriveActivoAthF11(ev?: AthF11Evaluacion | null): void {
    const activa = ev || this.athF11EvaluacionActiva;
    this.athF11DriveFileId = activa?.driveFileId || null;
    const editorUrl = activa?.driveFileId
      ? `https://docs.google.com/document/d/${activa.driveFileId}/edit?usp=sharing`
      : null;
    this.fijarEditorEmbedUrlAthF11(editorUrl, true);
  }

  onAthF11Editado(): void {
    if (this.athF11IgnorarAutoSave || !this.athF11Listo) return;
    if (this.athF11EvaluacionActiva) {
      this.sincronizarEvaluacionActivaEnFormAthF11();
    }
    this.athF11CambiosPendientes = true;
  }

  private sanitizarPdfAthF11(raw: any): AthF11PdfFirmado | null {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'Evaluación firmada.pdf').trim(),
      webViewLink: raw.webViewLink || raw.web_view_link || null,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  onSeleccionarPdfAthF11(event: Event): void {
    if (!this.athF11EvaluacionActiva) return;
    const folio = (this.athF11EvaluacionActiva.folio || 'evaluacion').replace(/[^\w-]/g, '') || 'evaluacion';
    this.procesarPdfDocumento(
      event,
      `${folio} firmado.pdf`,
      (base64, nombre) => this.subirPdfFirmadoAthF11(base64, nombre)
    );
  }

  descargarPdfAthF11(): void {
    if (this.athF11DescargandoPdf || !this.athF11EvaluacionActiva) {
      return;
    }
    this.sincronizarEvaluacionActivaEnFormAthF11();
    const evaluacionId = this.athF11EvaluacionActiva.id;
    const nombreLocal = String(
      this.athF11EvaluacionActiva.nombreCompleto
      || this.athF11EvaluacionActiva.evaluador
      || this.athF11EvaluacionActiva.folio
      || 'evaluacion'
    ).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'evaluacion';

    const lanzarDescarga = () => {
      this.athF11DescargandoPdf = true;
      this.backendService.descargarPdfAthF11(evaluacionId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (blob) => {
            this.athF11DescargandoPdf = false;
            const url = URL.createObjectURL(blob);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = `ATH-F-11 ${nombreLocal}.pdf`;
            enlace.click();
            URL.revokeObjectURL(url);
          },
          error: () => {
            this.athF11DescargandoPdf = false;
          }
        });
    };

    if (!this.athF11CambiosPendientes) {
      lanzarDescarga();
      return;
    }

    if (this.athF11Guardando) {
      return;
    }
    this.athF11Guardando = true;
    this.backendService.guardarAthF11Formato(
      { ...this.athF11Form, evaluacionActivaId: evaluacionId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF11(res, true, false, true);
          this.athF11CambiosPendientes = false;
          this.athF11Guardando = false;
          lanzarDescarga();
        },
        error: () => {
          this.athF11Guardando = false;
        }
      });
  }

  private subirPdfFirmadoAthF11(pdfBase64: string, nombreArchivo: string): void {
    if (this.athF11SubiendoPdf || !this.athF11EvaluacionActiva) return;
    this.athF11SubiendoPdf = true;
    this.backendService.subirPdfFirmadoAthF11(pdfBase64, nombreArchivo, this.athF11EvaluacionActiva.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.athF11SubiendoPdf = false;
          this.aplicarEstadoAthF11(res);
          if (this.athF11EvaluacionActiva && res?.pdfFirmado) {
            this.athF11EvaluacionActiva.pdfFirmado = this.sanitizarPdfAthF11(res.pdfFirmado);
            this.sincronizarEvaluacionActivaEnFormAthF11();
          }
        },
        error: () => {
          this.athF11SubiendoPdf = false;
        }
      });
  }

  private fijarEditorEmbedUrlAthF11(editorUrl: string | null, forzar = false): void {
    if (!forzar && this.mostrarAthF11Editor && this.athF11EditorEmbedUrlSafe && this.athF11EditorUrl === editorUrl) {
      return;
    }
    if (!editorUrl) {
      this.athF11EditorUrl = null;
      this.athF11EditorEmbedUrlSafe = null;
      return;
    }
    const url = this.resolverUrlEditorDrive(editorUrl, this.athF11DriveFileId);
    this.athF11EditorUrl = url || editorUrl;
    const embedUrl = this.urlIframeDriveSegunPermiso(this.athF11EditorUrl);
    this.athF11EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  toggleAthF11Editor(): void {
    if (this.mostrarAthF11Editor) {
      this.mostrarAthF11Editor = false;
      this.athF11EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      return;
    }

    const abrirEditor = () => {
      const driveId = this.athF11EvaluacionActiva?.driveFileId || this.athF11DriveFileId;
      if (!driveId) {
        void Swal.fire({
          icon: 'warning',
          title: 'Sin documento en Drive',
          text: 'No se pudo generar el Word de esta evaluación. Intenta guardar de nuevo.',
          confirmButtonColor: '#15a596'
        });
        return;
      }
      this.athF11DriveFileId = driveId;
      const url = this.resolverUrlEditorDrive(this.athF11EditorUrl, driveId);
      this.fijarEditorEmbedUrlAthF11(url, true);
      this.mostrarAthF11Editor = true;
      this.athF11EditorCargando = true;
      this.athF11EditorIframeListo = false;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    };

    if (this.athF11EvaluacionActiva?.driveFileId) {
      abrirEditor();
      return;
    }

    if (!this.athF11EvaluacionActiva || this.athF11Guardando) {
      return;
    }

    // Aún no hay Doc: guardar para materializarlo y luego abrir.
    this.athF11EvaluacionActiva.borrador = false;
    this.sincronizarEvaluacionActivaEnFormAthF11();
    this.athF11Guardando = true;
    this.backendService.guardarAthF11Formato(
      { ...this.athF11Form, evaluacionActivaId: this.athF11EvaluacionActiva.id },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF11(res, true, false, true);
          this.athF11CambiosPendientes = false;
          this.athF11Guardando = false;
          abrirEditor();
        },
        error: () => {
          this.athF11Guardando = false;
        }
      });
  }

  onAthF11IframeLoad(): void {
    this.athF11EditorIframeListo = true;
    this.athF11EditorCargando = false;
  }

  actualizarPlantillaAthF11(): void {
    if (this.athF11ActualizandoPlantilla) return;
    this.athF11ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaAthF11()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.athF11ActualizandoPlantilla = false;
          void Swal.fire({
            icon: 'success',
            title: 'Plantilla verificada',
            text: 'La plantilla maestra ATH-F-11 está disponible para nuevas evaluaciones.',
            confirmButtonColor: '#15a596'
          });
        },
        error: () => {
          this.athF11ActualizandoPlantilla = false;
        }
      });
  }

  private cargarAthF11DesdeServidor(): void {
    this.athF11Cargando = true;
    this.backendService.cargarAthF11Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF11(res),
        error: () => {
          this.athF11Cargando = false;
          this.athF11Vista = 'archivero';
          this.athF11EvaluacionActiva = null;
          this.athF11Listo = true;
        }
      });
  }

  private sincronizarAthF11DesdeDrive(): void {
    this.backendService.sincronizarAthF11DesdeDrive(this.athF11EvaluacionActiva?.id || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoAthF11(res, false, true, true)
      });
  }

  private persistirAthF11(): void {
    if (this.athF11Guardando || !this.athF11Listo) return;
    this.athF11Guardando = true;
    if (this.athF11EvaluacionActiva) {
      this.athF11EvaluacionActiva.borrador = false;
    }
    this.sincronizarEvaluacionActivaEnFormAthF11();
    this.backendService.guardarAthF11Formato(
      { ...this.athF11Form, evaluacionActivaId: this.athF11EvaluacionActiva?.id || this.athF11Form.evaluacionActivaId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoAthF11(res, true, false, true);
          this.athF11CambiosPendientes = false;
          this.athF11Guardando = false;
        },
        error: () => {
          this.athF11Guardando = false;
        }
      });
  }

  private aplicarEstadoAthF11(
    res: any,
    conservarEdicion = false,
    desdeDrive = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res) {
      if (!desdeDrive) this.athF11Cargando = false;
      this.athF11Listo = true;
      return;
    }

    const editorAbierto = this.mostrarAthF11Editor && !forzarActualizacionDrive;
    const activoId = this.athF11EvaluacionActiva?.id || this.athF11Form.evaluacionActivaId || null;

    if (res.datos) {
      this.athF11IgnorarAutoSave = true;
      this.athF11Form = this.normalizarAthF11Form(res.datos);
      if (activoId && this.athF11Form.evaluaciones.some((e) => e.id === activoId)) {
        this.athF11Form.evaluacionActivaId = activoId;
      } else {
        this.athF11Form.evaluacionActivaId = null;
      }
      this.athF11EvaluacionActiva = activoId
        ? this.athF11Form.evaluaciones.find((e) => e.id === activoId) || null
        : null;
      if (!this.athF11EvaluacionActiva && this.athF11Vista === 'editor') {
        this.athF11Vista = 'archivero';
      }
      setTimeout(() => {
        this.athF11IgnorarAutoSave = false;
      }, 0);
      this.sincronizarEvaluacionActivaEnFormAthF11();
    }

    if (res.siguienteFolioSugerido) {
      this.athF11SiguienteFolio = res.siguienteFolioSugerido;
    } else {
      this.athF11SiguienteFolio = this.generarFolioSugeridoAthF11(this.athF11Form.evaluaciones);
    }

    this.athF11UltimaSync = res.ultimaSyncDrive || null;
    this.athF11ContenidoModificado = !!res.contenidoModificado;
    this.actualizarDriveActivoAthF11(this.athF11EvaluacionActiva);
    if (res.editorUrl && (forzarActualizacionDrive || !editorAbierto)) {
      this.fijarEditorEmbedUrlAthF11(res.editorUrl, forzarActualizacionDrive);
    }

    this.athF11Listo = true;
    if (!conservarEdicion) {
      this.athF11Cargando = false;
    }
  }

  private crearDgF01Vacio(): DgF01Form {
    return {
      codigo: 'DG-F-01',
      revision: '00',
      fechaRevision: '20-01-25',
      imagenMapa: null,
      pdfFirmado: null
    };
  }

  private crearDgF02Vacio(): DgF02Form {
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2025-07-17',
      alcance:
        'El alcance del Sistema de Gestión de Calidad de Biznaga Risk and Tech comprende el servicio de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión; desde la firma de la cotización o contrato hasta la entrega del proyecto finalizado.',
      requisitosNoAplicables: '',
      pdfFirmado: null
    };
  }

  private crearFilaDgF04Vacia(): DgF04Fila {
    return {
      factor: '',
      responsable: '',
      seguimiento: '',
      probabilidad: '',
      consecuencia: '',
      resultado: ''
    };
  }

  private crearDgF04Vacio() {
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2025-07-17',
      fortalezas: [
        { factor: 'Competencia del personal', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' },
        { factor: 'Infraestructura', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' },
        { factor: '8 años en el mercado', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' },
        { factor: 'Adaptabilidad / Flexibilidad', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' },
        { factor: 'Alcance y cobertura geográfica', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' },
        { factor: 'Cumplimiento legal', responsable: 'NA', seguimiento: 'NA', probabilidad: '', consecuencia: '', resultado: '' }
      ] as DgF04Fila[],
      oportunidades: [
        {
          factor: 'Convenios con universidades para desarroyo de proyectos internos',
          responsable: 'Leonel Pérez',
          seguimiento: 'Concretar convenios con universidades (Carta de aceptación de estancia)',
          probabilidad: '3',
          consecuencia: '2',
          resultado: 'A - Perseguir la oportunidad.'
        },
        {
          factor: 'Socios estratégicos de servicios complementarios',
          responsable: 'Leonel Pérez',
          seguimiento: 'Crear una cartera de socios estratégicos',
          probabilidad: '3',
          consecuencia: '3',
          resultado: 'A - Perseguir la oportunidad.'
        },
        {
          factor: 'Convocatorias gubernamentales y licitaciones',
          responsable: 'Alta Dirección',
          seguimiento: 'Participar en licitaciones regularmente (listado de licitaciones en activo)',
          probabilidad: '2',
          consecuencia: '2',
          resultado: 'B - Aceptar la oportunidad con condiciones.'
        },
        {
          factor: 'Pertenecer a asociaciones empresariales',
          responsable: 'Alta Dirección',
          seguimiento: 'Registro de CANACINTRA',
          probabilidad: '3',
          consecuencia: '2',
          resultado: 'A - Perseguir la oportunidad.'
        },
        {
          factor: 'Certificaciones nacionales e internacionales',
          responsable: 'Sergio Guzmán',
          seguimiento:
            'Implementación del SGC y buscar la certificación como Unidad Verificadora',
          probabilidad: '3',
          consecuencia: '3',
          resultado: 'A - Perseguir la oportunidad.'
        }
      ] as DgF04Fila[],
      debilidades: [
        {
          factor: 'Resguardo de información',
          responsable: 'Leonel Pérez',
          seguimiento: 'Renta de un sistema de almacenamiento para información (NUBE)',
          probabilidad: 'B',
          consecuencia: '3',
          resultado: 'H - Riesgo alto; necesita atención de la alta gerencia'
        },
        {
          factor: 'Seguimiento al cliente',
          responsable: 'Sergio Guzmán',
          seguimiento: 'Implementación del SGC',
          probabilidad: 'C',
          consecuencia: '2',
          resultado: 'M - Riesgo moderado; debe especificarse responsabilidad gerencial'
        },
        {
          factor: 'Tiempo de respuesta',
          responsable: 'Sergio Guzmán',
          seguimiento: 'Implementación del SGC',
          probabilidad: 'C',
          consecuencia: '3',
          resultado: 'H - Riesgo alto; necesita atención de la alta gerencia'
        },
        {
          factor: 'Seguimiento de cartera de cobro',
          responsable: 'Rozana Reyes',
          seguimiento:
            'Reuniones semanales entre Dirección General y Gerente de Administración y Talento Humano',
          probabilidad: 'B',
          consecuencia: '2',
          resultado: 'H - Riesgo alto; necesita atención de la alta gerencia'
        },
        {
          factor: 'Control de proyectos',
          responsable: 'Marisol Santillán',
          seguimiento: 'Implemetar el formato "Control de proyectos Biznaga"',
          probabilidad: 'C',
          consecuencia: '4',
          resultado: 'E - Riesgo extremo; requiere acción inmediata'
        }
      ] as DgF04Fila[],
      amenazas: [
        {
          factor: 'Mayor competencia en el estado',
          responsable: 'Gerencias / Ejec de Sist. De Gest y Ca.',
          seguimiento:
            'Capacitación de nuestro personal, nuevos proyectos y certificaciones',
          probabilidad: 'A',
          consecuencia: '3',
          resultado: 'E - Riesgo extremo; requiere acción inmediata'
        },
        {
          factor:
            'Innovación de herramientas tecnológicas para capacitación y control de proyectos',
          responsable: 'Leonel Pérez',
          seguimiento: 'Plan de acción',
          probabilidad: 'A',
          consecuencia: '4',
          resultado: 'E - Riesgo extremo; requiere acción inmediata'
        },
        {
          factor:
            'Cambios frecuentes de requisitos para entrega de trámites y proyectos ante instancias de gobierno',
          responsable: 'Sergio Guzmán',
          seguimiento:
            'Comunicación con el cliente e instancias gubernamentales (Integrar al SGC)',
          probabilidad: 'B',
          consecuencia: '2',
          resultado: 'H - Riesgo alto; necesita atención de la alta gerencia'
        }
      ] as DgF04Fila[],
      autorizo: 'Dirección General'
    };
  }

  private crearFilaDgF05Vacia(): DgF05Fila {
    return {
      parteInteresada: '',
      tipo: '',
      necesidadesParte: '',
      necesidadesOrg: '',
      influencia: '',
      razon: '',
      seguimiento: ''
    };
  }

  /** Línea en blanco al inicio y al final (columnas de necesidades). */
  private espaciadoNecesidades(texto: string): string {
    const contenido = String(texto || '')
      .replace(/\r\n/g, '\n')
      .replace(/\|/g, '\n')
      .trim();
    if (!contenido) {
      return '';
    }
    return `\n${contenido}\n`;
  }

  private normalizarFilaDgF05(fila: DgF05Fila): DgF05Fila {
    return {
      ...fila,
      necesidadesParte: this.espaciadoNecesidades(fila.necesidadesParte),
      necesidadesOrg: this.espaciadoNecesidades(fila.necesidadesOrg)
    };
  }

  private crearDgF05Vacio() {
    const nec = (texto: string) => this.espaciadoNecesidades(texto);
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2025-07-17',
      filas: [
        {
          parteInteresada: 'Colaboradores',
          tipo: 'Interno' as const,
          necesidadesParte: nec(
            'Ambiente de trabajo sano y seguro.\nEquipo necesario para desarrollar su trabajo.\nCapacitación.\nReconocimiento.\nRetroalimentación de su trabajo.'
          ),
          necesidadesOrg: nec(
            'Alto rendimiento\nCompromiso con la empresa\nLealtad\nIntegridad\nResponsabilidad'
          ),
          influencia: 'Alta' as const,
          razon: 'Necesarios para cumplir el objetivo central de la empresa.',
          seguimiento:
            'Encuesta de ambiente de trabajo, descripciones de puesto, programas de capacitación.'
        },
        {
          parteInteresada: 'Clientes',
          tipo: 'Externo' as const,
          necesidadesParte: nec(
            'Servicio de calidad\nPropuestas de valor\nSoluciones innovadoras\nFlexibilidad\nRelación costo-beneficio'
          ),
          necesidadesOrg: nec('Cliente confiable\nBuena comunicación\nBuena relación comercial'),
          influencia: 'Alta' as const,
          razon: 'Porque son los que compran nuestros servicios y soluciones.',
          seguimiento:
            'Comunicación con clientes (8.2), SGC, encuestas de satisfacción y atención a quejas.'
        },
        {
          parteInteresada: 'Proveedores',
          tipo: 'Externo' as const,
          necesidadesParte: nec(
            'Certeza en los pagos\nIncremento de volumen de compra\nBuena relación a largo plazo\nRetroalimentación'
          ),
          necesidadesOrg: nec(
            'Entregas confiables\nPrecios competitivos\nBuen aliado estratégico\nConfiabilidad del proceso'
          ),
          influencia: 'Alta' as const,
          razon: 'Es la fuente de insumos para llevar a cabo el objetivo de la organización.',
          seguimiento: 'Órdenes de compra claras, encuesta de satisfacción de proveedores (8.4).'
        },
        {
          parteInteresada: 'Autoridades',
          tipo: 'Externo' as const,
          necesidadesParte: nec('Cumplimiento normativo aplicable.'),
          necesidadesOrg: nec(
            'Comunicación efectiva\nServicios de calidad\nAsesoría y capacitación\nGarantizar el estado de derecho'
          ),
          influencia: 'Alta' as const,
          razon: 'Para trabajar dentro del marco legal.',
          seguimiento: 'Tablero de requisitos legales y reglamentarios.'
        },
        {
          parteInteresada: 'Propietarios o socios',
          tipo: 'Interno' as const,
          necesidadesParte: nec(
            'Buenos resultados\nIncremento de cartera de clientes\nClientes satisfechos\nSGC eficaz'
          ),
          necesidadesOrg: nec('Apertura al diálogo\nBuena comunicación entre niveles\nRespaldo\nConfianza'),
          influencia: 'Alta' as const,
          razon: 'Son la columna estratégica de la organización.',
          seguimiento: 'Indicadores, encuestas, juntas de revisión por dirección y auditorías.'
        }
      ] as DgF05Fila[],
      elaboro: 'Alta dirección',
      autorizo: 'Directora General'
    };
  }

  private crearDgF07Forms(): Record<string, DgF07ProcesoForm> {
    const forms: Record<string, DgF07ProcesoForm> = {};
    for (const p of DG_F07_PROCESOS) {
      forms[p.slug] = {
        nombreProceso: p.nombreProceso,
        responsable: p.responsable,
        objetivo: p.objetivo,
        procesoAnterior: p.procesoAnterior,
        procesoSiguiente: p.procesoSiguiente,
        entradas: p.entradas.join('\n'),
        salidas: p.salidas.join('\n'),
        recursos: p.recursos,
        criteriosMetodos: p.criteriosMetodos,
        indicadores: p.indicadores
      };
    }
    return forms;
  }

  agregarFilaSgcF18(): void {
    this.sgcF18Form.filas.push(this.crearFilaSgcF18Vacia());
    this.onSgcF18Editado();
  }

  quitarFilaSgcF18(index: number): void {
    if (this.sgcF18Form.filas.length <= 1) {
      return;
    }
    this.sgcF18Form.filas.splice(index, 1);
    this.onSgcF18Editado();
  }

  onSgcF18Editado(): void {
    if (!this.sgcF18Listo || this.sgcF18IgnorarAutoSave) {
      return;
    }
    this.sgcF18CambiosPendientes = true;
  }

  toggleSgcF18Editor(): void {
    if (!this.sgcF18DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF18Editor;
    this.mostrarSgcF18Editor = abrir;
    if (abrir) {
      this.sgcF18EditorIframeListo = false;
      this.sgcF18EditorCargando = true;
      this.fijarSgcF18EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF18EditorUrl, this.sgcF18DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF18IframeLoad(): void {
    if (this.sgcF18EditorIframeListo) {
      return;
    }
    this.sgcF18EditorIframeListo = true;
    this.sgcF18EditorCargando = false;
  }

  actualizarPlantillaSgcF18(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF18ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF18Editor) {
      this.mostrarSgcF18Editor = false;
      this.sgcF18EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    this.sgcF18ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF18()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF18ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF18(res, false, false, true);
        },
        error: () => {
          this.sgcF18ActualizandoPlantilla = false;
        }
      });
  }

  onSgcPo01Editado(): void {
    if (!this.sgcPo01Listo || this.sgcPo01IgnorarAutoSave) {
      return;
    }
    this.sgcPo01CambiosPendientes = true;
  }

  onDgF08Editado(): void {
    if (!this.dgF08Listo || this.dgF08IgnorarAutoSave) {
      return;
    }
    this.dgF08CambiosPendientes = true;
  }

  onSeleccionarPdfSgcPo01(event: Event): void {
    this.procesarPdfDocumento(
      event,
      'SGC-PO-01 Politica de calidad_Biznaga.pdf',
      (base64, nombre) => this.subirPdfSgcPo01(base64, nombre)
    );
  }

  onSeleccionarPdfDgF08(event: Event): void {
    this.procesarPdfDocumento(
      event,
      'DG-F-08 Filosofía Biznaga Risk and Tech.pdf',
      (base64, nombre) => this.subirPdfDgF08(base64, nombre)
    );
  }

  abrirPdfFirmadoSgcPo01(): void {
    this.toggleSgcPo01PdfViewer();
  }

  toggleSgcPo01PdfViewer(): void {
    const id = this.sgcPo01Form.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }

    const abrir = !this.mostrarSgcPo01PdfViewer;
    this.mostrarSgcPo01PdfViewer = abrir;

    if (abrir) {
      this.sgcPo01PdfCargando = true;
      const url = `https://drive.google.com/file/d/${id}/preview`;
      this.sgcPo01PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.sgcPo01PdfEmbedUrlSafe = null;
    this.sgcPo01PdfCargando = false;
  }

  onSgcPo01PdfIframeLoad(): void {
    this.sgcPo01PdfCargando = false;
  }

  descargarPlantillaPdfFormato(): void {
    if (this.descargandoPlantillaPdf) {
      return;
    }

    const esPo01 = this.plantillaSlug === 'sgc-po-01';
    const esDgF08 = this.plantillaSlug === 'dg-f-08';
    const esDgF02 = this.plantillaSlug === 'dg-f-02';
    const esDgF03 = this.plantillaSlug === 'dg-f-03';
    if (!esPo01 && !esDgF08 && !esDgF02 && !esDgF03) {
      return;
    }

    const descarga$ = esPo01
      ? this.backendService.descargarPlantillaSgcPo01Pdf()
      : esDgF08
        ? this.backendService.descargarPlantillaDgF08Pdf()
        : esDgF03
          ? this.backendService.descargarPlantillaDgF03Pdf()
          : this.backendService.descargarPlantillaDgF02Pdf();
    const nombreArchivo = esPo01
      ? 'SGC-PO-01 Politica de calidad_Biznaga.pdf'
      : esDgF08
        ? 'DG-F-08 Filosofía Biznaga Risk and Tech.pdf'
        : esDgF03
          ? 'DG-F-03 Objetivos de calidad.pdf'
          : 'DG-F-02 Alcance.pdf';

    this.descargandoPlantillaPdf = true;
    descarga$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.descargandoPlantillaPdf = false;
          const url = URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = nombreArchivo;
          enlace.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.descargandoPlantillaPdf = false;
        }
      });
  }

  toggleDgF08PdfViewer(): void {
    const id = this.dgF08Form.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }

    const abrir = !this.mostrarDgF08PdfViewer;
    this.mostrarDgF08PdfViewer = abrir;

    if (abrir) {
      this.dgF08PdfCargando = true;
      const url = `https://drive.google.com/file/d/${id}/preview`;
      this.dgF08PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.dgF08PdfEmbedUrlSafe = null;
    this.dgF08PdfCargando = false;
  }

  onDgF08PdfIframeLoad(): void {
    this.dgF08PdfCargando = false;
  }

  calcularRpnAmef(ocurrencia: string, severidad: string, deteccion: string): string {
    const o = parseInt(String(ocurrencia || '').trim(), 10);
    const s = parseInt(String(severidad || '').trim(), 10);
    const d = parseInt(String(deteccion || '').trim(), 10);
    if (Number.isNaN(o) || Number.isNaN(s) || Number.isNaN(d)) {
      return '';
    }
    return String(o * s * d);
  }

  /** Normaliza RPN para evitar [object Object] en celdas con fórmula de Excel. */
  normalizarValorRpn(
    valor: unknown,
    ocurrencia = '',
    severidad = '',
    deteccion = ''
  ): string {
    const calculado = this.calcularRpnAmef(
      String(ocurrencia || ''),
      String(severidad || ''),
      String(deteccion || '')
    );
    if (calculado) {
      return calculado;
    }
    if (valor === null || valor === undefined) {
      return '';
    }
    if (typeof valor === 'object') {
      const obj = valor as { result?: unknown; text?: unknown };
      if (obj.result !== undefined && obj.result !== null) {
        return this.normalizarValorRpn(obj.result);
      }
      if (obj.text !== undefined && obj.text !== null) {
        return this.normalizarValorRpn(obj.text);
      }
      return '';
    }
    const texto = String(valor).trim();
    if (!texto || texto === '[object Object]') {
      return '';
    }
    const n = parseInt(texto, 10);
    return Number.isFinite(n) ? String(n) : '';
  }

  formatearRpnDisplay(valor: unknown, ocurrencia = '', severidad = '', deteccion = ''): string | null {
    const rpn = this.normalizarValorRpn(valor, ocurrencia, severidad, deteccion);
    return rpn || null;
  }

  esRpnAlto(rpn: string): boolean {
    const n = parseInt(String(rpn || '').trim(), 10);
    return Number.isFinite(n) && n >= 12;
  }

  onSgcF11FilaRpnEditada(fila: SgcF11Fila): void {
    fila.rpn = this.normalizarValorRpn(fila.rpn, fila.ocurrencia, fila.severidad, fila.deteccion);
    fila.rpnPost = this.normalizarValorRpn(
      fila.rpnPost,
      fila.ocurrenciaPost,
      fila.severidadPost,
      fila.deteccionPost
    );
    this.onSgcF11Editado();
  }

  agregarFilaSgcF11(): void {
    this.sgcF11Form.filas.push(this.crearFilaSgcF11Vacia());
    this.renumerarFilasSgcF11();
    this.onSgcF11Editado();
  }

  quitarFilaSgcF11(index: number): void {
    if (this.sgcF11Form.filas.length <= 1) {
      return;
    }
    this.sgcF11Form.filas.splice(index, 1);
    this.renumerarFilasSgcF11();
    this.onSgcF11Editado();
  }

  onSgcF11Editado(): void {
    if (!this.sgcF11Listo || this.sgcF11IgnorarAutoSave) {
      return;
    }
    this.sgcF11CambiosPendientes = true;
  }

  toggleSgcF11Editor(): void {
    if (!this.sgcF11DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF11Editor;
    this.mostrarSgcF11Editor = abrir;
    if (abrir) {
      this.sgcF11EditorIframeListo = false;
      this.sgcF11EditorCargando = true;
      this.fijarSgcF11EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF11EditorUrl, this.sgcF11DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF11IframeLoad(): void {
    if (this.sgcF11EditorIframeListo) {
      return;
    }
    this.sgcF11EditorIframeListo = true;
    this.sgcF11EditorCargando = false;
  }

  actualizarPlantillaSgcF11(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF11ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF11Editor) {
      this.mostrarSgcF11Editor = false;
      this.sgcF11EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    this.sgcF11ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF11()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF11ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF11(res, false, false, true);
        },
        error: () => {
          this.sgcF11ActualizandoPlantilla = false;
        }
      });
  }

  agregarFilaSgcF12(): void {
    this.sgcF12Form.filas.push(this.crearFilaSgcF12Vacia());
    this.onSgcF12Editado();
  }

  quitarFilaSgcF12(index: number): void {
    if (this.sgcF12Form.filas.length <= 1) {
      return;
    }
    this.sgcF12Form.filas.splice(index, 1);
    this.onSgcF12Editado();
  }

  onSgcF12Editado(): void {
    if (!this.sgcF12Listo || this.sgcF12IgnorarAutoSave) {
      return;
    }
    this.sgcF12CambiosPendientes = true;
  }

  toggleSgcF12Editor(): void {
    if (!this.sgcF12DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF12Editor;
    if (abrir) {
      if (this.sgcF12Guardando) {
        return;
      }
      this.abrirPanelEditorSgcF12();
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.mostrarSgcF12Editor = false;
  }

  private abrirPanelEditorSgcF12(): void {
    this.mostrarSgcF12Editor = true;
    this.sgcF12EditorIframeListo = false;
    this.sgcF12EditorCargando = true;
    this.fijarSgcF12EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF12EditorUrl, this.sgcF12DriveFileId), true);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  private persistirSgcF12Inmediato(alExito?: () => void): void {
    if (!this.puedeGestionarPlantillasSgc) {
      alExito?.();
      return;
    }
    if (!this.sgcF12Listo || this.sgcF12Guardando) {
      alExito?.();
      return;
    }
    this.sgcF12Guardando = true;
    this.backendService.guardarSgcF12Formato(this.sgcF12Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF12Guardando = false;
          this.sgcF12CambiosPendientes = false;
          this.aplicarEstadoSgcF12(res, false, false);
          alExito?.();
        },
        error: () => {
          this.sgcF12Guardando = false;
          alExito?.();
        }
      });
  }

  onSgcF12IframeLoad(): void {
    if (this.sgcF12EditorIframeListo) {
      return;
    }
    this.sgcF12EditorIframeListo = true;
    this.sgcF12EditorCargando = false;
  }

  actualizarPlantillaSgcF12(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF12ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF12Editor) {
      this.mostrarSgcF12Editor = false;
      this.sgcF12EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    this.sgcF12ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF12()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF12ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF12(res, false, false, true);
        },
        error: () => {
          this.sgcF12ActualizandoPlantilla = false;
        }
      });
  }

  agregarFilaSgcF02(): void {
    if (!this.sgcF02SolicitudActiva) {
      return;
    }
    this.sgcF02SolicitudActiva.filas.push(this.crearFilaSgcF02Vacia());
    this.onSgcF02Editado();
  }

  quitarFilaSgcF02(index: number): void {
    if (!this.sgcF02SolicitudActiva) {
      return;
    }
    if (this.sgcF02SolicitudActiva.filas.length <= 1) {
      return;
    }
    this.sgcF02SolicitudActiva.filas.splice(index, 1);
    this.onSgcF02Editado();
  }

  nuevaSolicitudSgcF02(): void {
    const sol = this.crearSolicitudSgcF02Vacia();
    this.sgcF02Form.solicitudes = [sol, ...(this.sgcF02Form.solicitudes || [])];
    this.sgcF02Form.solicitudActivaId = sol.id;
    this.sgcF02SolicitudActiva = sol;
    this.sgcF02Vista = 'editor';
    this.onSgcF02Editado();
  }

  abrirSolicitudSgcF02(sol: SgcF02Solicitud): void {
    this.sgcF02Form.solicitudActivaId = sol.id;
    this.sgcF02SolicitudActiva = sol;
    this.sgcF02Vista = 'editor';
  }

  volverListaSgcF02(): void {
    this.cerrarComboSolicitanteSgcF02(true);
    this.cerrarComboDocSgcF02(true);
    this.sgcF02Vista = 'lista';
    this.sgcF02SolicitudActiva = null;
    this.consolidarSolicitudesSgcF02Local();
    this.sgcF02Form.solicitudes = (this.sgcF02Form.solicitudes || []).filter((s) => {
      const filasConDatos = (s.filas || []).some((f) =>
        !!(f.nombreDocumento || f.codigo || f.versionActual || f.tipoDocumento || f.tipoSolicitud || f.motivo)
      );
      return !!(
        String(s.nombreSolicitante || '').trim()
        || s.puestoSolicitante
        || s.areaDepartamento
        || s.fechaSolicitud
        || filasConDatos
      );
    });
    if (
      this.sgcF02Form.solicitudActivaId
      && !this.sgcF02Form.solicitudes.some((s) => s.id === this.sgcF02Form.solicitudActivaId)
    ) {
      this.sgcF02Form.solicitudActivaId = this.sgcF02Form.solicitudes[0]?.id || null;
    }
  }

  eliminarSolicitudSgcF02(sol: SgcF02Solicitud, event?: Event): void {
    event?.stopPropagation();
    const idx = this.sgcF02Form.solicitudes.findIndex((s) => s.id === sol.id);
    if (idx < 0) {
      return;
    }
    this.sgcF02Form.solicitudes.splice(idx, 1);
    if (this.sgcF02Form.solicitudActivaId === sol.id) {
      this.sgcF02Form.solicitudActivaId = this.sgcF02Form.solicitudes[0]?.id || null;
      this.sgcF02SolicitudActiva = null;
      this.sgcF02Vista = 'lista';
    }
    this.onSgcF02Editado();
  }

  private cargarCatalogosSgcF02(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const mapa = new Map<string, SgcF02UsuarioCatalogo>();
          usuarios.forEach((u: any) => {
            if (this.esPerfilEmpresaAthF08(u)) {
              return;
            }
            const nombre = this.nombreColaboradorAthF08(u);
            if (!nombre) {
              return;
            }
            const clave = this.claveNombreSgcF02(nombre);
            if (!clave || mapa.has(clave)) {
              return;
            }
            mapa.set(clave, {
              nombre,
              puesto: String(
                u?.empresa_puesto || u?.puesto_contacto || u?.puesto || u?.cargo || ''
              ).trim(),
              area: String(
                u?.departamento || u?.area || u?.area_departamento || u?.empresa_area || ''
              ).trim()
            });
          });
          this.sgcF02UsuariosCatalogo = Array.from(mapa.values())
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        },
        error: () => {
          this.sgcF02UsuariosCatalogo = [];
        }
      });

    const aplicarDocs = (docs: SgcF01Documento[]): void => {
      this.sgcF02DocsCatalogo = (docs || [])
        .filter((d) => d && d.vigente !== false && (d.nombreDocumento || d.codigo))
        .slice();
    };

    if (this.sgcF01Form?.documentos?.length) {
      aplicarDocs(this.sgcF01Form.documentos);
    } else {
      aplicarDocs(clonarCatalogoSgcF01());
    }

    this.backendService.cargarSgcF01Formato()
      .pipe(
        timeout(8000),
        takeUntil(this.destroy$),
        catchError(() => of(null))
      )
      .subscribe({
        next: (res) => {
          if (res?.success && Array.isArray(res?.datos?.documentos)) {
            aplicarDocs(this.normalizarFormularioSgcF01(res.datos).documentos);
          }
        }
      });
  }

  get usuariosFiltradosSgcF02(): SgcF02UsuarioCatalogo[] {
    const q = this.normalizarTextoAthF08(this.sgcF02SolicitanteComboQuery);
    const base = this.sgcF02UsuariosCatalogo || [];
    if (!q) {
      return base.slice(0, 40);
    }
    return base
      .filter((u) => {
        const hay = `${u.nombre} ${u.puesto} ${u.area}`;
        return this.normalizarTextoAthF08(hay).includes(q);
      })
      .slice(0, 40);
  }

  get textoLibreSolicitanteSgcF02(): string {
    const q = String(this.sgcF02SolicitanteComboQuery || '').trim();
    if (!q) {
      return '';
    }
    const existe = (this.sgcF02UsuariosCatalogo || []).some(
      (u) => this.claveNombreSgcF02(u.nombre) === this.claveNombreSgcF02(q)
    );
    return existe ? '' : q;
  }

  textoComboSolicitanteSgcF02(): string {
    if (this.sgcF02SolicitanteComboAbierto) {
      return this.sgcF02SolicitanteComboQuery;
    }
    return String(this.sgcF02SolicitudActiva?.nombreSolicitante || '');
  }

  abrirComboSolicitanteSgcF02(): void {
    this.cerrarComboDocSgcF02(true);
    this.sgcF02SolicitanteComboAbierto = true;
    this.sgcF02SolicitanteComboQuery = String(this.sgcF02SolicitudActiva?.nombreSolicitante || '');
  }

  onFiltroSolicitanteSgcF02(valor: string): void {
    this.sgcF02SolicitanteComboAbierto = true;
    this.sgcF02SolicitanteComboQuery = valor;
    if (this.sgcF02SolicitudActiva) {
      this.sgcF02SolicitudActiva.nombreSolicitante = valor;
      this.onSgcF02Editado();
    }
  }

  seleccionarSolicitanteSgcF02(usuario: SgcF02UsuarioCatalogo | string): void {
    if (!this.sgcF02SolicitudActiva) {
      return;
    }
    const item = typeof usuario === 'string'
      ? (this.sgcF02UsuariosCatalogo.find(
        (u) => this.claveNombreSgcF02(u.nombre) === this.claveNombreSgcF02(usuario)
      ) || { nombre: usuario, puesto: '', area: '' })
      : usuario;
    this.sgcF02SolicitudActiva.nombreSolicitante = String(item.nombre || '').trim();
    if (item.puesto) {
      this.sgcF02SolicitudActiva.puestoSolicitante = item.puesto;
    }
    if (item.area) {
      this.sgcF02SolicitudActiva.areaDepartamento = item.area;
    }
    this.sgcF02SolicitanteComboAbierto = false;
    this.sgcF02SolicitanteComboQuery = '';
    this.onSgcF02Editado();
  }

  confirmarSolicitanteSgcF02(): void {
    if (!this.sgcF02SolicitanteComboAbierto) {
      return;
    }
    const texto = String(this.sgcF02SolicitanteComboQuery || '').trim();
    if (!texto) {
      this.cerrarComboSolicitanteSgcF02(true);
      return;
    }
    const exacto = this.usuariosFiltradosSgcF02.find(
      (u) => this.claveNombreSgcF02(u.nombre) === this.claveNombreSgcF02(texto)
    );
    this.seleccionarSolicitanteSgcF02(exacto || texto);
  }

  limpiarSolicitanteSgcF02(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.sgcF02SolicitudActiva) {
      return;
    }
    this.sgcF02SolicitudActiva.nombreSolicitante = '';
    this.sgcF02SolicitanteComboQuery = '';
    this.sgcF02SolicitanteComboAbierto = true;
    this.onSgcF02Editado();
  }

  onComboSolicitanteSgcF02Keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarComboSolicitanteSgcF02(true);
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primero = this.usuariosFiltradosSgcF02[0];
      if (primero && !this.textoLibreSolicitanteSgcF02) {
        this.seleccionarSolicitanteSgcF02(primero);
        return;
      }
      this.confirmarSolicitanteSgcF02();
    }
  }

  private cerrarComboSolicitanteSgcF02(descartar = false): void {
    if (!descartar && this.sgcF02SolicitanteComboAbierto && this.sgcF02SolicitudActiva) {
      const texto = String(this.sgcF02SolicitanteComboQuery || '').trim();
      if (texto && texto !== String(this.sgcF02SolicitudActiva.nombreSolicitante || '').trim()) {
        this.sgcF02SolicitudActiva.nombreSolicitante = texto;
        this.onSgcF02Editado();
      }
    }
    this.sgcF02SolicitanteComboAbierto = false;
    this.sgcF02SolicitanteComboQuery = '';
  }

  get docsFiltradosSgcF02(): SgcF01Documento[] {
    const q = this.normalizarTextoAthF08(this.sgcF02DocComboQuery);
    const campo = this.sgcF02DocComboAbierto?.campo || 'nombre';
    const base = (this.sgcF02DocsCatalogo || []).filter(
      (d) => d.vigente !== false && (d.nombreDocumento || d.codigo)
    );
    if (!q) {
      return base.slice(0, 40);
    }
    const filtrados = base.filter((d) => {
      const hay = [d.nombreDocumento, d.codigo, d.versionVigente, d.especie, d.area].join(' ');
      return this.normalizarTextoAthF08(hay).includes(q);
    });
    // Prioriza coincidencia en el campo que se está editando (código o nombre).
    const score = (d: SgcF01Documento): number => {
      const codigo = this.normalizarTextoAthF08(d.codigo);
      const nombre = this.normalizarTextoAthF08(d.nombreDocumento);
      if (campo === 'codigo') {
        if (codigo === q) return 0;
        if (codigo.startsWith(q)) return 1;
        if (codigo.includes(q)) return 2;
        if (nombre.includes(q)) return 3;
        return 4;
      }
      if (nombre === q) return 0;
      if (nombre.startsWith(q)) return 1;
      if (nombre.includes(q)) return 2;
      if (codigo === q || codigo.startsWith(q)) return 3;
      return 4;
    };
    return filtrados
      .sort((a, b) => score(a) - score(b) || a.nombreDocumento.localeCompare(b.nombreDocumento, 'es'))
      .slice(0, 40);
  }

  get textoLibreDocSgcF02(): string {
    const q = String(this.sgcF02DocComboQuery || '').trim();
    if (!q || !this.sgcF02DocComboAbierto) {
      return '';
    }
    const campo = this.sgcF02DocComboAbierto.campo;
    const existe = (this.sgcF02DocsCatalogo || []).some((d) => {
      const valor = campo === 'codigo' ? d.codigo : d.nombreDocumento;
      return this.normalizarTextoAthF08(valor) === this.normalizarTextoAthF08(q);
    });
    return existe ? '' : q;
  }

  comboDocAbiertoSgcF02(fila: number, campo: SgcF02DocComboCampo): boolean {
    return this.sgcF02DocComboAbierto?.fila === fila && this.sgcF02DocComboAbierto?.campo === campo;
  }

  textoComboDocSgcF02(fila: number, campo: SgcF02DocComboCampo): string {
    if (this.comboDocAbiertoSgcF02(fila, campo)) {
      return this.sgcF02DocComboQuery;
    }
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    if (!row) {
      return '';
    }
    return campo === 'codigo' ? String(row.codigo || '') : String(row.nombreDocumento || '');
  }

  abrirComboDocSgcF02(fila: number, campo: SgcF02DocComboCampo): void {
    this.cerrarComboSolicitanteSgcF02(true);
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    this.sgcF02DocComboQuery = campo === 'codigo'
      ? String(row?.codigo || '')
      : String(row?.nombreDocumento || '');
    this.sgcF02DocComboAbierto = { fila, campo };
  }

  onFiltroDocSgcF02(fila: number, campo: SgcF02DocComboCampo, valor: string): void {
    this.sgcF02DocComboAbierto = { fila, campo };
    this.sgcF02DocComboQuery = valor;
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    if (!row) {
      return;
    }
    if (campo === 'codigo') {
      row.codigo = valor;
    } else {
      row.nombreDocumento = valor;
    }
    this.onSgcF02Editado();
  }

  seleccionarDocSgcF02(fila: number, doc: SgcF01Documento): void {
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    if (!row || !doc) {
      return;
    }
    // Nombre y código son el eje: cualquiera que elijas completa el par + versión.
    row.nombreDocumento = String(doc.nombreDocumento || '').trim();
    row.codigo = String(doc.codigo || '').trim();
    row.versionActual = String(doc.versionVigente || '').trim() || row.versionActual || '00';
    const tipo = this.mapearTipoDocumentoSgcF02(doc.especie);
    if (tipo) {
      row.tipoDocumento = tipo;
    }
    this.sgcF02DocComboAbierto = null;
    this.sgcF02DocComboQuery = '';
    this.onSgcF02Editado();
  }

  /** Busca en F-01 por código o nombre (exacto primero; si no, único filtrado). */
  private resolverDocCatalogoSgcF02(texto: string, campo: SgcF02DocComboCampo): SgcF01Documento | null {
    const q = this.normalizarTextoAthF08(texto);
    if (!q) {
      return null;
    }
    const catalogo = (this.sgcF02DocsCatalogo || []).filter(
      (d) => d.vigente !== false && (d.nombreDocumento || d.codigo)
    );
    const exactoCampo = catalogo.find((d) => {
      const valor = campo === 'codigo' ? d.codigo : d.nombreDocumento;
      return this.normalizarTextoAthF08(valor) === q;
    });
    if (exactoCampo) {
      return exactoCampo;
    }
    const exactoCruzado = catalogo.find((d) => {
      const valor = campo === 'codigo' ? d.nombreDocumento : d.codigo;
      return this.normalizarTextoAthF08(valor) === q;
    });
    if (exactoCruzado) {
      return exactoCruzado;
    }
    const filtrados = this.docsFiltradosSgcF02;
    if (filtrados.length === 1) {
      return filtrados[0];
    }
    return null;
  }

  confirmarDocSgcF02(fila: number, campo: SgcF02DocComboCampo): void {
    if (!this.comboDocAbiertoSgcF02(fila, campo)) {
      return;
    }
    const texto = String(this.sgcF02DocComboQuery || '').trim();
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    if (!row) {
      this.cerrarComboDocSgcF02(true);
      return;
    }
    if (!texto) {
      if (campo === 'codigo') {
        row.codigo = '';
      } else {
        row.nombreDocumento = '';
      }
      this.cerrarComboDocSgcF02(true);
      this.onSgcF02Editado();
      return;
    }
    const match = this.resolverDocCatalogoSgcF02(texto, campo);
    if (match) {
      this.seleccionarDocSgcF02(fila, match);
      return;
    }
    // Texto libre: no pisa el otro campo ni la versión.
    if (campo === 'codigo') {
      row.codigo = texto;
    } else {
      row.nombreDocumento = texto;
    }
    this.sgcF02DocComboAbierto = null;
    this.sgcF02DocComboQuery = '';
    this.onSgcF02Editado();
  }

  limpiarDocCampoSgcF02(fila: number, campo: SgcF02DocComboCampo, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const row = this.sgcF02SolicitudActiva?.filas?.[fila];
    if (!row) {
      return;
    }
    if (campo === 'codigo') {
      row.codigo = '';
    } else {
      row.nombreDocumento = '';
    }
    this.sgcF02DocComboQuery = '';
    this.sgcF02DocComboAbierto = { fila, campo };
    this.onSgcF02Editado();
  }

  onComboDocSgcF02Keydown(fila: number, campo: SgcF02DocComboCampo, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarComboDocSgcF02(true);
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      // Shift+Enter inserta salto de línea en el nombre (sin cerrar el combo).
      if (campo === 'nombre' && event.shiftKey) {
        return;
      }
      event.preventDefault();
      const match = this.resolverDocCatalogoSgcF02(this.sgcF02DocComboQuery, campo)
        || (!this.textoLibreDocSgcF02 ? this.docsFiltradosSgcF02[0] : null);
      if (match) {
        this.seleccionarDocSgcF02(fila, match);
        return;
      }
      this.confirmarDocSgcF02(fila, campo);
    }
  }

  etiquetaDocSgcF02(doc: SgcF01Documento): string {
    const partes = [
      doc.codigo,
      doc.versionVigente ? `v${doc.versionVigente}` : '',
      doc.especie
    ].filter(Boolean);
    return partes.join(' · ');
  }

  private mapearTipoDocumentoSgcF02(especie: string): string {
    const e = String(especie || '').trim();
    if (this.sgcF02TiposDocumento.includes(e)) {
      return e;
    }
    const lower = e.toLowerCase();
    if (lower.includes('polit')) {
      return 'Política';
    }
    if (lower.includes('instruct')) {
      return 'Instructivo';
    }
    if (lower.includes('proced')) {
      return 'Procedimiento';
    }
    if (lower.includes('format')) {
      return 'Formato';
    }
    if (lower.includes('manual')) {
      return 'Manual';
    }
    if (lower.includes('registro')) {
      return 'Registro';
    }
    return '';
  }

  private cerrarComboDocSgcF02(descartar = false): void {
    if (!descartar && this.sgcF02DocComboAbierto) {
      const { fila, campo } = this.sgcF02DocComboAbierto;
      const row = this.sgcF02SolicitudActiva?.filas?.[fila];
      const texto = String(this.sgcF02DocComboQuery || '').trim();
      if (row) {
        if (campo === 'codigo' && texto !== String(row.codigo || '').trim()) {
          row.codigo = texto;
          this.onSgcF02Editado();
        } else if (campo === 'nombre' && texto !== String(row.nombreDocumento || '').trim()) {
          row.nombreDocumento = texto;
          this.onSgcF02Editado();
        }
      }
    }
    this.sgcF02DocComboAbierto = null;
    this.sgcF02DocComboQuery = '';
  }

  private claveNombreSgcF02(nombre: string): string {
    return String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** Una tarjeta / registro BD por persona: fusiona documentos del mismo nombre. */
  private consolidarSolicitudesSgcF02Local(): void {
    const orden: string[] = [];
    const mapa = new Map<string, SgcF02Solicitud>();
    for (const raw of this.sgcF02Form.solicitudes || []) {
      const sol = { ...raw, filas: [...(raw.filas || [])] };
      const clave = this.claveNombreSgcF02(sol.nombreSolicitante);
      const key = clave || `id:${sol.id}`;
      const existente = mapa.get(key);
      if (!existente) {
        orden.push(key);
        mapa.set(key, sol);
        continue;
      }
      const vistos = new Set(
        existente.filas.map((f) =>
          [f.nombreDocumento, f.codigo, f.versionActual, f.tipoDocumento, f.tipoSolicitud, f.motivo]
            .join('|')
            .toLowerCase()
        )
      );
      for (const fila of sol.filas) {
        const k = [fila.nombreDocumento, fila.codigo, fila.versionActual, fila.tipoDocumento, fila.tipoSolicitud, fila.motivo]
          .join('|')
          .toLowerCase();
        const vacia = !fila.nombreDocumento && !fila.codigo && !fila.versionActual
          && !fila.tipoDocumento && !fila.tipoSolicitud && !fila.motivo;
        if (vacia || vistos.has(k)) {
          continue;
        }
        existente.filas.push(fila);
        vistos.add(k);
      }
      if (!existente.fechaSolicitud && sol.fechaSolicitud) {
        existente.fechaSolicitud = sol.fechaSolicitud;
      }
      if (!existente.puestoSolicitante && sol.puestoSolicitante) {
        existente.puestoSolicitante = sol.puestoSolicitante;
      }
      if (!existente.areaDepartamento && sol.areaDepartamento) {
        existente.areaDepartamento = sol.areaDepartamento;
      }
      if ((sol.nombreSolicitante || '').length > (existente.nombreSolicitante || '').length) {
        existente.nombreSolicitante = sol.nombreSolicitante;
      }
    }
    this.sgcF02Form.solicitudes = orden.map((k) => mapa.get(k)!).filter(Boolean);
    if (
      this.sgcF02Form.solicitudActivaId
      && !this.sgcF02Form.solicitudes.some((s) => s.id === this.sgcF02Form.solicitudActivaId)
    ) {
      const activa = this.sgcF02SolicitudActiva;
      const claveActiva = this.claveNombreSgcF02(activa?.nombreSolicitante || '');
      const match = claveActiva
        ? this.sgcF02Form.solicitudes.find((s) => this.claveNombreSgcF02(s.nombreSolicitante) === claveActiva)
        : null;
      this.sgcF02Form.solicitudActivaId = match?.id || this.sgcF02Form.solicitudes[0]?.id || null;
      if (this.sgcF02Vista === 'editor') {
        this.sgcF02SolicitudActiva = this.sgcF02Form.solicitudes.find(
          (s) => s.id === this.sgcF02Form.solicitudActivaId
        ) || null;
      }
    }
  }

  onSgcF02Editado(): void {
    if (!this.sgcF02Listo || this.sgcF02IgnorarAutoSave) {
      return;
    }
    this.sgcF02CambiosPendientes = true;
  }

  cargarDocumentosFisicosSgcF02(): void {
    if (this.sgcF02DocsFisicosCargando) {
      return;
    }
    this.sgcF02DocsFisicosCargando = true;
    this.backendService.listarDocumentosFisicosSgcF02()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF02DocsFisicosCargando = false;
          this.sgcF02DocsFisicos = Array.isArray(res?.archivos) ? res.archivos : [];
        },
        error: () => {
          this.sgcF02DocsFisicosCargando = false;
        }
      });
  }

  onSgcF02DocsDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.sgcF02DocsFisicosArrastrando = true;
  }

  onSgcF02DocsDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.sgcF02DocsFisicosArrastrando = false;
  }

  onSgcF02DocsDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.sgcF02DocsFisicosArrastrando = false;
    const files = Array.from(event.dataTransfer?.files || []);
    this.subirDocumentosFisicosSgcF02(files);
  }

  onSgcF02DocsInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input?.files || []);
    this.subirDocumentosFisicosSgcF02(files);
    if (input) {
      input.value = '';
    }
  }

  private subirDocumentosFisicosSgcF02(files: File[]): void {
    if (!this.puedeGestionarPlantillasSgc || this.sgcF02DocsFisicosSubiendo) {
      return;
    }
    const permitidos = (files || []).filter((f) => {
      const mime = String(f.type || '').toLowerCase();
      const nombre = String(f.name || '').toLowerCase();
      return mime === 'application/pdf'
        || mime === 'image/jpeg'
        || mime === 'image/jpg'
        || /\.pdf$/i.test(nombre)
        || /\.jpe?g$/i.test(nombre);
    });
    if (!permitidos.length) {
      void Swal.fire({
        icon: 'warning',
        title: 'Formato no válido',
        text: 'Solo se permiten archivos PDF, JPG o JPEG.',
        confirmButtonText: 'Entendido'
      });
      return;
    }
    this.sgcF02DocsFisicosSubiendo = true;
    this.backendService.subirDocumentosFisicosSgcF02(permitidos)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF02DocsFisicosSubiendo = false;
          this.sgcF02DocsFisicos = Array.isArray(res?.archivos) ? res.archivos : this.sgcF02DocsFisicos;
          void Swal.fire({
            icon: 'success',
            title: 'Documentación subida',
            text: res?.message || 'Archivos guardados en Documentos Físicos.',
            timer: 2200,
            showConfirmButton: false
          });
        },
        error: (err) => {
          this.sgcF02DocsFisicosSubiendo = false;
          void Swal.fire({
            icon: 'error',
            title: 'No se pudo subir',
            text: err?.error?.message || 'Revisa el archivo e inténtalo de nuevo.',
            confirmButtonText: 'Entendido'
          });
        }
      });
  }

  consultarDocumentoFisicoSgcF02(doc: SgcF02DocFisico): void {
    if (!doc?.id) {
      return;
    }
    this.sgcF02VisorDoc = doc;
    this.sgcF02VisorError = null;
    this.sgcF02VisorCargando = true;
    const preview = `https://drive.google.com/file/d/${encodeURIComponent(doc.id)}/preview`;
    this.sgcF02VisorUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(preview);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  cerrarVisorDocumentoFisicoSgcF02(): void {
    this.sgcF02VisorDoc = null;
    this.sgcF02VisorUrlSafe = null;
    this.sgcF02VisorCargando = false;
    this.sgcF02VisorError = null;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  onSgcF02VisorLoad(): void {
    this.sgcF02VisorCargando = false;
  }

  onSgcF02VisorError(): void {
    this.sgcF02VisorCargando = false;
    this.sgcF02VisorError =
      'No se pudo cargar la vista previa integrada. Puedes abrir el archivo en Google Drive.';
  }

  abrirDocumentoFisicoEnDriveSgcF02(): void {
    const doc = this.sgcF02VisorDoc;
    const url = doc?.webViewLink || (doc?.id ? `https://drive.google.com/file/d/${doc.id}/view` : '');
    if (!url) {
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  urlMiniaturaSgcF02(doc: SgcF02DocFisico, cacheBust = 0): string {
    if (!doc?.id) {
      return '';
    }
    const base = `https://drive.google.com/thumbnail?id=${encodeURIComponent(doc.id)}&sz=w480`;
    return cacheBust ? `${base}&t=${cacheBust}` : base;
  }

  miniaturaSgcF02Fallida(doc: SgcF02DocFisico): boolean {
    return !!doc?.id && this.sgcF02MiniaturasError.has(doc.id);
  }

  onErrorMiniaturaSgcF02(doc: SgcF02DocFisico): void {
    if (doc?.id) {
      this.sgcF02MiniaturasError.add(doc.id);
    }
  }

  etiquetaTipoSgcF02(doc: SgcF02DocFisico): string {
    if (doc?.tipo === 'pdf') {
      return 'PDF';
    }
    if (doc?.tipo === 'imagen') {
      return 'IMG';
    }
    return 'DOC';
  }

  iniciarReemplazoDocumentoFisicoSgcF02(doc: SgcF02DocFisico, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeGestionarPlantillasSgc || !doc?.id) {
      return;
    }
    this.sgcF02ReemplazarDocId = doc.id;
    const input = this.sgcF02ReemplazarInput?.nativeElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  onSgcF02ReemplazarInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0] || null;
    const docId = this.sgcF02ReemplazarDocId;
    this.sgcF02ReemplazarDocId = null;
    if (input) {
      input.value = '';
    }
    if (!file || !docId) {
      return;
    }
    const doc = this.sgcF02DocsFisicos.find((d) => d.id === docId) || this.sgcF02VisorDoc;
    void Swal.fire({
      icon: 'question',
      title: '¿Reemplazar archivo?',
      html: `Se eliminará <strong>${doc?.nombre || 'el archivo actual'}</strong> y se subirá <strong>${file.name}</strong>.`,
      showCancelButton: true,
      confirmButtonText: 'Reemplazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0f766e'
    }).then((result) => {
      if (!result.isConfirmed) {
        return;
      }
      this.sgcF02DocsFisicosSubiendo = true;
      this.backendService.eliminarDocumentoFisicoSgcF02(docId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.backendService.subirDocumentosFisicosSgcF02([file])
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: (res) => {
                  this.sgcF02DocsFisicosSubiendo = false;
                  this.sgcF02DocsFisicos = Array.isArray(res?.archivos) ? res.archivos : this.sgcF02DocsFisicos;
                  this.sgcF02MiniaturasError.clear();
                  const nuevo = Array.isArray(res?.subidos) ? res.subidos[0] : null;
                  if (this.sgcF02VisorDoc?.id === docId && nuevo?.id) {
                    this.consultarDocumentoFisicoSgcF02(nuevo);
                  } else if (this.sgcF02VisorDoc?.id === docId) {
                    this.cerrarVisorDocumentoFisicoSgcF02();
                  }
                  void Swal.fire({
                    icon: 'success',
                    title: 'Archivo reemplazado',
                    timer: 1800,
                    showConfirmButton: false
                  });
                },
                error: (err) => {
                  this.sgcF02DocsFisicosSubiendo = false;
                  this.cargarDocumentosFisicosSgcF02();
                  void Swal.fire({
                    icon: 'error',
                    title: 'No se pudo subir el reemplazo',
                    text: err?.error?.message || 'Inténtalo de nuevo.',
                    confirmButtonText: 'Entendido'
                  });
                }
              });
          },
          error: (err) => {
            this.sgcF02DocsFisicosSubiendo = false;
            void Swal.fire({
              icon: 'error',
              title: 'No se pudo reemplazar',
              text: err?.error?.message || 'Inténtalo de nuevo.',
              confirmButtonText: 'Entendido'
            });
          }
        });
    });
  }

  eliminarDocumentoFisicoSgcF02(doc: SgcF02DocFisico, event?: Event): void {
    event?.stopPropagation();
    if (!this.puedeGestionarPlantillasSgc || !doc?.id) {
      return;
    }
    void Swal.fire({
      icon: 'warning',
      title: 'Eliminar documento',
      text: `¿Eliminar «${doc.nombre}» de Documentos Físicos?`,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c'
    }).then((result) => {
      if (!result.isConfirmed) {
        return;
      }
      this.backendService.eliminarDocumentoFisicoSgcF02(doc.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.sgcF02DocsFisicos = Array.isArray(res?.archivos) ? res.archivos : this.sgcF02DocsFisicos.filter((a) => a.id !== doc.id);
            if (this.sgcF02VisorDoc?.id === doc.id) {
              this.cerrarVisorDocumentoFisicoSgcF02();
            }
          },
          error: (err) => {
            void Swal.fire({
              icon: 'error',
              title: 'No se pudo eliminar',
              text: err?.error?.message || 'Inténtalo de nuevo.',
              confirmButtonText: 'Entendido'
            });
          }
        });
    });
  }

  toggleSgcF02Editor(): void {
    if (!this.sgcF02DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF02Editor;
    if (abrir) {
      if (this.sgcF02Guardando) {
        return;
      }
      this.abrirPanelEditorSgcF02();
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.mostrarSgcF02Editor = false;
  }

  private abrirPanelEditorSgcF02(): void {
    this.mostrarSgcF02Editor = true;
    this.sgcF02EditorIframeListo = false;
    this.sgcF02EditorCargando = true;
    this.fijarSgcF02EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF02EditorUrl, this.sgcF02DriveFileId), true);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  onSgcF02IframeLoad(): void {
    if (this.sgcF02EditorIframeListo) {
      return;
    }
    this.sgcF02EditorIframeListo = true;
    this.sgcF02EditorCargando = false;
  }

  actualizarPlantillaSgcF02(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (this.sgcF02ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF02Editor) {
      this.mostrarSgcF02Editor = false;
      this.sgcF02EditorCargando = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    this.sgcF02ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF02()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF02ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF02(res, false, false, true);
        },
        error: () => {
          this.sgcF02ActualizandoPlantilla = false;
        }
      });
  }

  onDgF03Editado(): void {
    if (!this.dgF03Listo || this.dgF03IgnorarAutoSave) {
      return;
    }
    this.dgF03CambiosPendientes = true;
  }

  onSeleccionarPdfDgF03(event: Event): void {
    this.procesarPdfDocumento(
      event,
      'DG-F-03 Objetivos de calidad.pdf',
      (base64, nombre) => this.subirPdfDgF03(base64, nombre)
    );
  }

  toggleDgF03PdfViewer(): void {
    const id = this.dgF03Form.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }
    const abrir = !this.mostrarDgF03PdfViewer;
    this.mostrarDgF03PdfViewer = abrir;
    if (abrir) {
      this.dgF03PdfCargando = true;
      const url = `https://drive.google.com/file/d/${id}/preview`;
      this.dgF03PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.dgF03PdfEmbedUrlSafe = null;
    this.dgF03PdfCargando = false;
  }

  onDgF03PdfIframeLoad(): void {
    this.dgF03PdfCargando = false;
  }

  onMetodologiaAmefIframeLoad(): void {
    this.metodologiaAmefCargando = false;
    this.activarScrollGuardMetodologiaAmef();
  }

  restaurarMetodologiaAmefDesdePlantilla(): void {
    if (this.metodologiaAmefImportando) {
      return;
    }
    this.metodologiaAmefImportando = true;
    this.backendService.importarMetodologiaAmefDesdePlantilla()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.metodologiaAmefImportando = false;
          this.aplicarEstadoMetodologiaAmef(res, true);
        },
        error: () => {
          this.metodologiaAmefImportando = false;
        }
      });
  }

  private procesarPdfDocumento(
    event: Event,
    nombreArchivo: string,
    subir: (base64: string, nombre: string) => void
  ): void {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) {
      return;
    }
    if (archivo.type !== 'application/pdf') {
      this.alertaPdfSgcInvalido(
        'Archivo no válido',
        'Selecciona un archivo PDF para actualizar el documento.'
      );
      return;
    }
    if (archivo.size > SgcPlantillaPreviewComponent.MAX_PDF_SGC_BYTES) {
      this.alertaPdfSgcInvalido(
        'Archivo muy grande',
        `El PDF no puede superar ${SgcPlantillaPreviewComponent.MAX_PDF_SGC_MB} MB.`
      );
      return;
    }
    this.abrirModalSubidaPdfSgc();
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = lector.result;
      if (typeof resultado !== 'string') {
        this.cerrarModalSubidaPdfSgc();
        return;
      }
      const base64 = resultado.split(',')[1] || '';
      if (base64) {
        subir(base64, nombreArchivo);
      } else {
        this.cerrarModalSubidaPdfSgc();
        this.alertaPdfSgcInvalido(
          'Error de lectura',
          'No se pudo leer el PDF seleccionado.',
          'error'
        );
      }
    };
    lector.onerror = () => {
      this.cerrarModalSubidaPdfSgc();
      this.alertaPdfSgcInvalido(
        'Error de lectura',
        'No se pudo leer el PDF seleccionado.',
        'error'
      );
    };
    lector.readAsDataURL(archivo);
  }

  private abrirModalSubidaPdfSgc(): void {
    Swal.fire({
      title: 'Subiendo documento',
      html: `
        <div class="sgc-pdf-upload-swal">
          <div class="sgc-pdf-upload-swal__icon-wrap" aria-hidden="true">
            <span class="sgc-pdf-upload-swal__ring sgc-pdf-upload-swal__ring--1"></span>
            <span class="sgc-pdf-upload-swal__ring sgc-pdf-upload-swal__ring--2"></span>
            <i class="fas fa-cloud-upload-alt sgc-pdf-upload-swal__icon"></i>
          </div>
          <p class="sgc-pdf-upload-swal__lead">Guardando en Google Drive…</p>
          <p class="sgc-pdf-upload-swal__hint">Por favor espera, no cierres esta ventana.</p>
          <div class="sgc-pdf-upload-swal__bar" role="progressbar" aria-valuetext="Subiendo">
            <span class="sgc-pdf-upload-swal__bar-fill"></span>
          </div>
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'swal2-sgc-pdf-upload' },
      didOpen: () => Swal.showLoading()
    });
  }

  private cerrarModalSubidaPdfSgc(): void {
    Swal.close();
  }

  private alertaPdfSgcInvalido(
    titulo: string,
    texto: string,
    icono: 'warning' | 'error' = 'warning'
  ): void {
    Swal.fire({
      icon: icono,
      title: titulo,
      text: texto,
      confirmButtonColor: '#15a596',
      confirmButtonText: 'OK'
    });
  }

  private finalizarSubidaPdfSgc(exito: boolean, nombreArchivo?: string): void {
    this.cerrarModalSubidaPdfSgc();
    if (exito) {
      Swal.fire({
        icon: 'success',
        title: 'Documento actualizado',
        text: nombreArchivo
          ? `El PDF «${nombreArchivo}» se subió correctamente a Google Drive.`
          : 'El PDF se subió correctamente a Google Drive.',
        confirmButtonColor: '#15a596',
        confirmButtonText: 'OK',
        timer: 4500,
        timerProgressBar: true
      });
      return;
    }
    Swal.fire({
      icon: 'error',
      title: 'No se pudo subir',
      text: 'Ocurrió un problema al enviar el PDF a Google Drive. Intenta de nuevo.',
      confirmButtonColor: '#15a596',
      confirmButtonText: 'OK'
    });
  }

  private subirPdfSgcPo01(base64: string, nombre: string): void {
    if (this.sgcPo01SubiendoPdf) {
      return;
    }
    this.sgcPo01SubiendoPdf = true;
    this.backendService.subirPdfFirmadoSgcPo01(base64, nombre)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcPo01SubiendoPdf = false;
          this.aplicarEstadoSgcPo01(res);
          this.finalizarSubidaPdfSgc(!!res?.success, nombre);
        },
        error: () => {
          this.sgcPo01SubiendoPdf = false;
          this.finalizarSubidaPdfSgc(false);
        }
      });
  }

  private subirPdfDgF08(base64: string, nombre: string): void {
    if (this.dgF08SubiendoPdf) {
      return;
    }
    this.dgF08SubiendoPdf = true;
    this.backendService.subirPdfFirmadoDgF08(base64, nombre)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF08SubiendoPdf = false;
          this.aplicarEstadoDgF08(res);
          this.finalizarSubidaPdfSgc(!!res?.success, nombre);
        },
        error: () => {
          this.dgF08SubiendoPdf = false;
          this.finalizarSubidaPdfSgc(false);
        }
      });
  }

  private subirPdfDgF03(base64: string, nombre: string): void {
    if (this.dgF03SubiendoPdf) {
      return;
    }
    this.dgF03SubiendoPdf = true;
    this.backendService.subirPdfFirmadoDgF03(base64, nombre)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF03SubiendoPdf = false;
          this.aplicarEstadoDgF03(res);
          this.finalizarSubidaPdfSgc(!!res?.success, nombre);
        },
        error: () => {
          this.dgF03SubiendoPdf = false;
          this.finalizarSubidaPdfSgc(false);
        }
      });
  }

  private cargarSgcF11DesdeServidor(): void {
    this.sgcF11Cargando = true;
    this.sgcF11Listo = false;
    this.backendService.cargarSgcF11Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF11(res),
        error: () => {
          this.sgcF11Cargando = false;
          this.sgcF11Listo = true;
        }
      });
  }

  private sincronizarSgcF11DesdeDrive(): void {
    this.sgcF11Guardando = true;
    this.backendService.sincronizarSgcF11DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF11Guardando = false;
          this.sgcF11CambiosPendientes = false;
          this.aplicarEstadoSgcF11(res, false, false);
        },
        error: () => {
          this.sgcF11Guardando = false;
        }
      });
  }

  private persistirSgcF11(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF11Listo || this.sgcF11Guardando) {
      return;
    }
    this.renumerarFilasSgcF11();
    this.sgcF11Guardando = true;
    const editorAbierto = this.mostrarSgcF11Editor;
    const editorActivo = false;
    const payload = this.prepararPayloadSgcF11ParaGuardar();
    this.backendService.guardarSgcF11Formato(payload, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF11Guardando = false;
          this.sgcF11CambiosPendientes = false;
          this.aplicarEstadoSgcF11(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF11Guardando = false;
        }
      });
  }

  private fijarSgcF11EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF11EditorUrl = null;
      this.sgcF11EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF11EditorUrl === url && this.sgcF11EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF11EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF11EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF11(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF11Cargando = false;
      }
      this.sgcF11Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF11Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF11IgnorarAutoSave = true;
      this.sgcF11Listo = false;
      const d = res.datos;
      this.sgcF11Form = {
        revision: d.revision ?? this.sgcF11Form.revision,
        fechaRevision: d.fechaRevision ?? this.sgcF11Form.fechaRevision,
        area: d.area ?? this.sgcF11Form.area,
        departamento: d.departamento ?? this.sgcF11Form.departamento,
        elaboro: d.elaboro ?? this.sgcF11Form.elaboro,
        fechaElaboracion: d.fechaElaboracion ?? this.sgcF11Form.fechaElaboracion,
        proceso: d.proceso ?? this.sgcF11Form.proceso,
        equipoTrabajo: d.equipoTrabajo ?? this.sgcF11Form.equipoTrabajo,
        filas: Array.isArray(d.filas)
          ? this.normalizarFilasSgcF11(d.filas as SgcF11Fila[])
          : this.sgcF11Form.filas
      };
      this.renumerarFilasSgcF11();
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF11IgnorarAutoSave = true;
      this.sgcF11Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF11DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF11Editor)) {
        this.fijarSgcF11EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF11UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF11ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF11IgnorarAutoSave = false;
      this.sgcF11Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF11Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private cargarSgcF12DesdeServidor(): void {
    this.sgcF12Cargando = true;
    this.sgcF12Listo = false;
    this.backendService.cargarSgcF12Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF12(res),
        error: () => {
          this.sgcF12Cargando = false;
          this.sgcF12Listo = true;
        }
      });
  }

  private sincronizarSgcF12DesdeDrive(): void {
    this.sgcF12Guardando = true;
    this.backendService.sincronizarSgcF12DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF12Guardando = false;
          this.sgcF12CambiosPendientes = false;
          this.aplicarEstadoSgcF12(res, false, false);
        },
        error: () => {
          this.sgcF12Guardando = false;
        }
      });
  }

  private persistirSgcF12(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF12Listo || this.sgcF12Guardando) {
      return;
    }
    this.sgcF12Guardando = true;
    const editorAbierto = this.mostrarSgcF12Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF12Formato(this.sgcF12Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF12Guardando = false;
          this.sgcF12CambiosPendientes = false;
          this.aplicarEstadoSgcF12(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF12Guardando = false;
        }
      });
  }

  private fijarSgcF12EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF12EditorUrl = null;
      this.sgcF12EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF12EditorUrl === url && this.sgcF12EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF12EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF12EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF12(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF12Cargando = false;
      }
      this.sgcF12Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF12Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF12IgnorarAutoSave = true;
      this.sgcF12Listo = false;
      const d = res.datos;
      this.sgcF12Form = this.normalizarFormularioSgcF12({
        revision: d.revision ?? this.sgcF12Form.revision,
        fechaRevision: d.fechaRevision ?? this.sgcF12Form.fechaRevision,
        fecha: d.fecha ?? this.sgcF12Form.fecha,
        responsableCambio: d.responsableCambio ?? this.sgcF12Form.responsableCambio,
        queSeVaACambiar: d.queSeVaACambiar ?? this.sgcF12Form.queSeVaACambiar,
        proposito: d.proposito ?? this.sgcF12Form.proposito,
        consecuencias: d.consecuencias ?? this.sgcF12Form.consecuencias,
        planTrabajo: d.planTrabajo ?? this.sgcF12Form.planTrabajo,
        filas: Array.isArray(d.filas) && d.filas.length
          ? d.filas
          : (this.sgcF12Form.filas.length ? this.sgcF12Form.filas : [this.crearFilaSgcF12Vacia()]),
        elaboro: d.elaboro ?? this.sgcF12Form.elaboro,
        reviso: d.reviso ?? this.sgcF12Form.reviso,
        autorizo: d.autorizo ?? this.sgcF12Form.autorizo
      });
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF12IgnorarAutoSave = true;
      this.sgcF12Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF12DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF12Editor)) {
        this.fijarSgcF12EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF12UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF12ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF12IgnorarAutoSave = false;
      this.sgcF12Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF12Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private cargarSgcF01DesdeServidor(): void {
    // Mostrar catálogo local de inmediato (nunca dejar la UI en blanco/colgada).
    if (!this.sgcF01Form.documentos?.length) {
      this.sgcF01Form = this.crearSgcF01Vacio();
    }
    this.refrescarVistaSgcF01();
    this.sgcF01Resumen = {
      total: this.sgcF01Form.documentos.length,
      vinculados: this.sgcF01Form.documentos.filter((d) => d.enSistema).length,
      actualizadosDesdeSistema: 0
    };
    this.sgcF01Listo = true;
    this.sgcF01Cargando = true;

    this.backendService.cargarSgcF01Formato()
      .pipe(
        timeout(8000),
        takeUntil(this.destroy$),
        catchError(() => of(null))
      )
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.aplicarEstadoSgcF01(res);
            return;
          }
          this.sgcF01Cargando = false;
          this.sgcF01Listo = true;
        },
        error: () => {
          this.sgcF01Cargando = false;
          this.sgcF01Listo = true;
        }
      });

    // Red de seguridad: si por cualquier motivo no llega respuesta, quitar spinner.
    timer(9000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.sgcF01Cargando) {
        this.sgcF01Cargando = false;
        this.sgcF01Listo = true;
      }
    });
  }

  private persistirSgcF01(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF01Listo || this.sgcF01Guardando) {
      return;
    }
    this.sgcF01Guardando = true;
    this.backendService.guardarSgcF01Formato(this.sgcF01Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF01Guardando = false;
          this.sgcF01CambiosPendientes = false;
          this.aplicarEstadoSgcF01(res, true);
        },
        error: () => {
          this.sgcF01Guardando = false;
        }
      });
  }

  actualizarVersionesSgcF01(): void {
    if (!this.puedeGestionarPlantillasSgc || this.sgcF01Guardando) {
      return;
    }
    this.sgcF01Cargando = true;
    this.backendService.sincronizarSgcF01DesdeDrive()
      .pipe(
        timeout(8000),
        takeUntil(this.destroy$),
        catchError(() => of(null))
      )
      .subscribe({
        next: (res) => {
          this.sgcF01Cargando = false;
          if (res?.success) {
            this.sgcF01CambiosPendientes = false;
            this.aplicarEstadoSgcF01(res);
            const r = res?.resumen;
            void Swal.fire({
              icon: 'success',
              title: 'Versiones actualizadas',
              text: r
                ? `${r.vinculados || 0} documentos vinculados al sistema.`
                : 'Lista maestra sincronizada.',
              timer: 2200,
              showConfirmButton: false
            });
            return;
          }
          void Swal.fire({
            icon: 'info',
            title: 'Catálogo local',
            text: 'No se pudo refrescar desde el servidor; se mantiene el listado en pantalla.',
            timer: 2500,
            showConfirmButton: false
          });
        },
        error: () => {
          this.sgcF01Cargando = false;
        }
      });
  }

  private actualizarPlantillaSgcF01(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    this.sgcF01ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF01()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF01ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF01(res, true);
        },
        error: () => {
          this.sgcF01ActualizandoPlantilla = false;
        }
      });
  }

  private aplicarEstadoSgcF01(res: any, _sincronizacionSilenciosa = false): void {
    if (!res?.success) {
      this.sgcF01Cargando = false;
      this.sgcF01Listo = true;
      this.refrescarVistaSgcF01();
      return;
    }
    this.sgcF01IgnorarAutoSave = true;
    try {
      const d = res.datos || {};
      this.sgcF01Form = this.normalizarFormularioSgcF01({
        revision: d.revision ?? this.sgcF01Form.revision,
        fechaRevision: d.fechaRevision ?? this.sgcF01Form.fechaRevision,
        documentos: Array.isArray(d.documentos) ? d.documentos : this.sgcF01Form.documentos
      });
      this.sgcF01DriveFileId = res.driveFileId || this.sgcF01DriveFileId;
      this.sgcF01UltimaSync = res.ultimaSyncDrive || this.sgcF01UltimaSync || new Date().toISOString();
      this.sgcF01ContenidoModificado = Boolean(res.contenidoModificado);
      this.sgcF01Resumen = res.resumen || {
        total: this.sgcF01Form.documentos.length,
        vinculados: this.sgcF01Form.documentos.filter((x) => x.enSistema).length,
        actualizadosDesdeSistema: 0
      };
      this.refrescarVistaSgcF01();
    } finally {
      this.sgcF01IgnorarAutoSave = false;
      this.sgcF01Listo = true;
      this.sgcF01Cargando = false;
    }
  }

  onSgcF01Editado(): void {
    if (this.sgcF01IgnorarAutoSave || !this.sgcF01Listo) {
      return;
    }
    this.sgcF01CambiosPendientes = true;
  }

  onSgcF01FiltroChange(busqueda: string | null, seccion: string | null): void {
    if (busqueda !== null) {
      this.sgcF01Busqueda = busqueda;
    }
    if (seccion !== null) {
      this.sgcF01FiltroSeccion = seccion;
    }
    this.refrescarVistaSgcF01();
  }

  trackBySgcF01Codigo(_i: number, doc: SgcF01Documento): string {
    return doc?.codigo || doc?.nombreDocumento || String(_i);
  }

  trackBySgcF01Grupo(_i: number, grupo: SgcF01GrupoVista): string {
    return grupo?.id || String(_i);
  }

  abrirEditorSgcF01(doc: SgcF01Documento, event?: Event): void {
    event?.stopPropagation();
    if (!doc) {
      return;
    }
    if (this.sgcF01EditorCerrarTimer) {
      clearTimeout(this.sgcF01EditorCerrarTimer);
      this.sgcF01EditorCerrarTimer = null;
    }
    this.sgcF01EditorCerrando = false;
    this.sgcF01EditorDoc = doc;
    this.sgcF01EditorForm = {
      area: doc.area || '',
      tipoDocumento: doc.tipoDocumento || 'Interno',
      especie: doc.especie || '',
      codigo: doc.codigo || '',
      versionVigente: doc.versionVigente || '00',
      fechaRevision: this.normalizarFechaInputSgcF01(doc.fechaRevision),
      nombreDocumento: doc.nombreDocumento || '',
      responsable: doc.responsable || '',
      vigente: doc.vigente !== false,
      fuenteVersion: doc.fuenteVersion,
      enSistema: doc.enSistema
    };
    this.sgcF01EditorAbierto = true;
    this.marcarBodyEditorSgcF01(true);
  }

  cerrarEditorSgcF01(): void {
    if (this.sgcF01EditorGuardando || this.sgcF01EditorCerrando || !this.sgcF01EditorAbierto) {
      return;
    }
    this.sgcF01EditorCerrando = true;
    if (this.sgcF01EditorCerrarTimer) {
      clearTimeout(this.sgcF01EditorCerrarTimer);
    }
    this.sgcF01EditorCerrarTimer = setTimeout(() => {
      this.sgcF01EditorAbierto = false;
      this.sgcF01EditorCerrando = false;
      this.sgcF01EditorDoc = null;
      this.sgcF01EditorCerrarTimer = null;
      this.marcarBodyEditorSgcF01(false);
    }, 320);
  }

  private marcarBodyEditorSgcF01(abierto: boolean): void {
    document.body.classList.toggle('sgc-f01-ed-open', abierto);
    if (abierto) {
      document.body.style.overflow = 'hidden';
    } else if (!document.body.classList.contains('sgc-f01-ed-open')) {
      document.body.style.overflow = '';
    }
  }

  esDocumentoExternoSgcF01(doc?: SgcF01Documento | null): boolean {
    return esDocExternoCatalogo(doc);
  }

  guardarEditorSgcF01(): void {
    if (!this.puedeGestionarPlantillasSgc || this.sgcF01EditorGuardando) {
      return;
    }
    const form = this.sgcF01EditorForm;
    const externo = this.esDocumentoExternoSgcF01(form) || this.esDocumentoExternoSgcF01(this.sgcF01EditorDoc);
    if (!externo && !String(form?.codigo || '').trim()) {
      void Swal.fire({ icon: 'warning', title: 'Código requerido', text: 'Indica el código del documento.', timer: 2200, showConfirmButton: false });
      return;
    }
    if (externo && !String(form?.nombreDocumento || '').trim()) {
      void Swal.fire({ icon: 'warning', title: 'Nombre requerido', text: 'Indica el nombre del documento externo.', timer: 2200, showConfirmButton: false });
      return;
    }
    this.persistirDocumentoSgcF01({
      ...form,
      codigo: externo ? '' : String(form.codigo || '').trim().toUpperCase(),
      versionVigente: String(form.versionVigente || '00').trim() || '00',
      fechaRevision: this.normalizarFechaInputSgcF01(form.fechaRevision),
      // Solo superadmin puede cambiar vigencia; el resto conserva el estado actual.
      vigente: this.puedeGestionarVigenciaSgcF01
        ? form.vigente !== false
        : (this.sgcF01EditorDoc?.vigente !== false)
    }, {
      tituloOk: 'Documento actualizado',
      textoOk: null
    });
  }

  /** Soft-delete: marca vigente=false; el registro permanece en BD/Drive (solo superadmin). */
  eliminarRegistroSgcF01(): void {
    if (!this.puedeGestionarVigenciaSgcF01 || this.sgcF01EditorGuardando) {
      return;
    }
    const form = this.sgcF01EditorForm;
    const codigo = String(form?.codigo || '').trim().toUpperCase();
    const etiqueta = codigo || String(form?.nombreDocumento || 'este documento').trim();
    if (!codigo && !String(form?.nombreDocumento || '').trim()) {
      void Swal.fire({ icon: 'warning', title: 'Documento incompleto', text: 'Indica el código o el nombre del documento.', timer: 2200, showConfirmButton: false });
      return;
    }
    void Swal.fire({
      icon: 'warning',
      title: '¿Eliminar registro?',
      html: `Se desactivará <strong>${etiqueta}</strong> (no vigente).<br>
        <small>No se borra de la base de datos ni de Drive; se oculta de la lista maestra y del Centro SGC. Solo el superadmin podrá gestionarlo.</small>`,
      showCancelButton: true,
      confirmButtonText: 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b91c1c',
      cancelButtonColor: '#64748b'
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.persistirDocumentoSgcF01({
        ...form,
        codigo,
        versionVigente: String(form.versionVigente || '00').trim() || '00',
        fechaRevision: this.normalizarFechaInputSgcF01(form.fechaRevision),
        vigente: false
      }, {
        tituloOk: 'Registro desactivado',
        textoOk: `${etiqueta} quedó como no vigente. Se oculta de la lista maestra y del Centro SGC; solo el superadmin puede gestionarlo.`
      });
    });
  }

  /** Reactiva un registro previamente desactivado (vigente=true). */
  reactivarRegistroSgcF01(): void {
    if (!this.puedeGestionarVigenciaSgcF01 || this.sgcF01EditorGuardando) {
      return;
    }
    const form = this.sgcF01EditorForm;
    const codigo = String(form?.codigo || '').trim().toUpperCase();
    const etiqueta = codigo || String(form?.nombreDocumento || 'este documento').trim();
    if (!codigo && !String(form?.nombreDocumento || '').trim()) {
      return;
    }
    void Swal.fire({
      icon: 'question',
      title: '¿Reactivar registro?',
      html: `Se marcará <strong>${etiqueta}</strong> otra vez como vigente y volverá a mostrarse en el Centro SGC.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0f766e',
      cancelButtonColor: '#64748b'
    }).then((r) => {
      if (!r.isConfirmed) return;
      this.persistirDocumentoSgcF01({
        ...form,
        codigo,
        versionVigente: String(form.versionVigente || '00').trim() || '00',
        fechaRevision: this.normalizarFechaInputSgcF01(form.fechaRevision),
        vigente: true
      }, {
        tituloOk: 'Registro reactivado',
        textoOk: `${etiqueta} vuelve a estar vigente en la lista maestra y en el Centro SGC.`
      });
    });
  }

  private persistirDocumentoSgcF01(
    payload: SgcF01Documento,
    mensajes: { tituloOk: string; textoOk: string | null }
  ): void {
    this.sgcF01EditorGuardando = true;
    this.backendService.actualizarDocumentoSgcF01({
      ...payload,
      nombreOriginal: this.sgcF01EditorDoc?.nombreDocumento || payload.nombreDocumento
    })
      .pipe(
        timeout(12000),
        takeUntil(this.destroy$),
        catchError(() => of(null))
      )
      .subscribe({
        next: (res) => {
          this.sgcF01EditorGuardando = false;
          if (res?.success) {
            this.aplicarEstadoSgcF01(res, true);
            this.sgcVigenciaLista.aplicarEstadoLocal(payload.codigo, payload.vigente !== false);
            this.sgcVigenciaLista.refrescar(true).pipe(takeUntil(this.destroy$)).subscribe();
            this.cerrarEditorSgcF01();
            const prop = res?.propagacion;
            const textoFallback = prop?.ok && !prop?.omitido
              ? `${prop.codigo}: rev. ${prop.revision} · ${this.formatearFechaDisplaySgcF01(prop.fechaRevision)} (lista maestra + registro del sistema).`
              : (res.message || 'Cambios guardados en la lista maestra.');
            void Swal.fire({
              icon: 'success',
              title: mensajes.tituloOk,
              text: mensajes.textoOk || textoFallback,
              timer: 2800,
              showConfirmButton: false
            });
            return;
          }
          void Swal.fire({
            icon: 'error',
            title: 'No se pudo guardar',
            text: 'Revisa la conexión e inténtalo de nuevo.',
            timer: 2500,
            showConfirmButton: false
          });
        },
        error: () => {
          this.sgcF01EditorGuardando = false;
        }
      });
  }

  private crearDocumentoSgcF01Vacio(): SgcF01Documento {
    return {
      area: 'SGC',
      tipoDocumento: 'Interno',
      especie: 'Formato',
      codigo: '',
      versionVigente: '00',
      fechaRevision: '',
      nombreDocumento: '',
      responsable: 'Ejecutivo de Sist. Gest. y Cap.',
      vigente: true,
      fuenteVersion: 'catalogo',
      enSistema: false
    };
  }

  private normalizarFechaInputSgcF01(valor: string): string {
    const t = String(valor || '').trim();
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      let y = m[3];
      if (y.length === 2) y = `20${y}`;
      return `${y}-${mo}-${d}`;
    }
    return t.slice(0, 10);
  }

  private refrescarVistaSgcF01(): void {
    const q = String(this.sgcF01Busqueda || '').trim().toLowerCase();
    const seccionFiltro = String(this.sgcF01FiltroSeccion || '').trim();
    const docs = ordenarComoExcelSgcF01(this.sgcF01Form.documentos || []);
    const filtrados = docs.filter((doc) => {
      // No vigentes: ocultos en la lista maestra salvo para superadmin.
      if (doc.vigente === false && !this.esSuperAdminSgcF01) {
        return false;
      }
      if (seccionFiltro) {
        const sid = seccionIdParaEspecie(doc.especie);
        if (sid !== seccionFiltro) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      const blob = [
        doc.codigo,
        doc.nombreDocumento,
        doc.area,
        doc.especie,
        doc.responsable,
        doc.versionVigente,
        doc.tipoDocumento
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
    this.sgcF01FilasVista = filtrados;

    const grupos: SgcF01GrupoVista[] = [];
    for (const sec of SGC_F01_SECCIONES) {
      if (seccionFiltro && sec.id !== seccionFiltro) {
        continue;
      }
      const documentos = filtrados.filter((d) => seccionIdParaEspecie(d.especie) === sec.id);
      if (!documentos.length) {
        continue;
      }
      grupos.push({ id: sec.id, titulo: sec.titulo, documentos });
    }
    const otros = filtrados.filter((d) => seccionIdParaEspecie(d.especie) === 'otros');
    if (otros.length && !seccionFiltro) {
      grupos.push({ id: 'otros', titulo: 'OTROS', documentos: otros });
    }
    this.sgcF01GruposVista = grupos;
  }

  agregarDocumentoSgcF01(): void {
    this.sgcF01Form.documentos = [
      ...(this.sgcF01Form.documentos || []),
      {
        area: 'SGC',
        tipoDocumento: 'Interno',
        especie: 'Formato',
        codigo: '',
        versionVigente: '00',
        fechaRevision: '',
        nombreDocumento: '',
        responsable: 'Ejecutivo de Sist. Gest. y Cap.',
        vigente: true,
        fuenteVersion: 'catalogo',
        enSistema: false
      }
    ];
    this.refrescarVistaSgcF01();
    this.onSgcF01Editado();
  }

  quitarDocumentoSgcF01(indexGlobal: number): void {
    const docs = [...(this.sgcF01Form.documentos || [])];
    if (indexGlobal < 0 || indexGlobal >= docs.length) {
      return;
    }
    docs.splice(indexGlobal, 1);
    this.sgcF01Form.documentos = docs;
    this.refrescarVistaSgcF01();
    this.onSgcF01Editado();
  }

  quitarDocumentoSgcF01PorCodigo(codigo: string): void {
    const code = String(codigo || '').trim().toUpperCase();
    const docs = [...(this.sgcF01Form.documentos || [])];
    const idx = code
      ? docs.findIndex((d) => String(d.codigo || '').toUpperCase() === code)
      : -1;
    if (idx < 0) {
      return;
    }
    this.quitarDocumentoSgcF01(idx);
  }

  formatearFechaDisplaySgcF01(iso: string): string {
    const f = String(iso || '').trim();
    if (!f) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      const [y, m, d] = f.split('-');
      return `${d}-${m}-${y.slice(-2)}`;
    }
    return f;
  }

  private crearSgcF01Vacio(): SgcF01FormData {
    return {
      revision: '00',
      fechaRevision: '2024-08-01',
      documentos: clonarCatalogoSgcF01()
    };
  }

  private normalizarFormularioSgcF01(form: SgcF01FormData): SgcF01FormData {
    const documentos = ordenarComoExcelSgcF01(
      (Array.isArray(form?.documentos) ? form.documentos : []).map((raw: any) => {
        const fila = {
          area: String(raw?.area || '').trim(),
          tipoDocumento: String(raw?.tipoDocumento || 'Interno').trim() || 'Interno',
          especie: String(raw?.especie || '').trim(),
          codigo: String(raw?.codigo || '').trim().toUpperCase(),
          versionVigente: String(raw?.versionVigente || raw?.revision || '00').trim() || '00',
          fechaRevision: String(raw?.fechaRevision || '').trim(),
          nombreDocumento: String(raw?.nombreDocumento || '').trim(),
          responsable: String(raw?.responsable || '').trim(),
          vigente: raw?.vigente !== false && raw?.vigente !== 0 && raw?.vigente !== '0',
          fuenteVersion: raw?.fuenteVersion === 'sistema' ? 'sistema' as const : 'catalogo' as const,
          enSistema: Boolean(raw?.enSistema)
        };
        if (esDocExternoCatalogo(fila)) {
          fila.codigo = '';
        }
        return fila;
      })
    );
    return {
      revision: String(form?.revision || '00').trim() || '00',
      fechaRevision: String(form?.fechaRevision || '').trim(),
      documentos
    };
  }

  private cargarSgcF02DesdeServidor(): void {
    this.sgcF02Cargando = true;
    this.sgcF02Listo = false;
    this.backendService.cargarSgcF02Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.aplicarEstadoSgcF02(res);
          this.cargarDocumentosFisicosSgcF02();
        },
        error: () => {
          this.sgcF02Cargando = false;
          this.sgcF02Listo = true;
        }
      });
  }

  private persistirSgcF02(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF02Listo || this.sgcF02Guardando) {
      return;
    }
    if (this.sgcF02SolicitudActiva) {
      this.sgcF02Form.solicitudActivaId = this.sgcF02SolicitudActiva.id;
    }
    this.consolidarSolicitudesSgcF02Local();
    const incompletas = (this.sgcF02Form.solicitudes || []).filter((s) => {
      const nombre = String(s.nombreSolicitante || '').trim();
      if (nombre) {
        return false;
      }
      const filasConDatos = (s.filas || []).some((f) =>
        !!(f.nombreDocumento || f.codigo || f.versionActual || f.tipoDocumento || f.tipoSolicitud || f.motivo)
      );
      return !!(
        s.puestoSolicitante
        || s.areaDepartamento
        || s.fechaSolicitud
        || filasConDatos
      );
    });
    if (incompletas.length) {
      void Swal.fire({
        icon: 'warning',
        title: 'Falta el nombre del solicitante',
        text: 'Cada solicitud con datos debe tener el nombre del solicitante: se usa para crear su hoja en Excel y unificar registros por persona.',
        confirmButtonText: 'Entendido'
      });
      return;
    }
    this.sgcF02Guardando = true;
    const editorAbierto = this.mostrarSgcF02Editor;
    this.backendService.guardarSgcF02Formato(this.sgcF02Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF02Guardando = false;
          this.sgcF02CambiosPendientes = false;
          this.aplicarEstadoSgcF02(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF02Guardando = false;
        }
      });
  }

  private fijarSgcF02EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF02EditorUrl = null;
      this.sgcF02EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF02EditorUrl === url && this.sgcF02EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF02EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF02EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF02(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF02Cargando = false;
      }
      this.sgcF02Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF02Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF02IgnorarAutoSave = true;
      this.sgcF02Listo = false;
      const d = res.datos;
      this.sgcF02Form = this.normalizarFormularioSgcF02({
        revision: d.revision ?? this.sgcF02Form.revision,
        fechaRevision: d.fechaRevision ?? this.sgcF02Form.fechaRevision,
        solicitudes: Array.isArray(d.solicitudes)
          ? d.solicitudes
          : (this.sgcF02Form.solicitudes || []),
        solicitudActivaId: d.solicitudActivaId ?? this.sgcF02Form.solicitudActivaId
      });
      if (this.sgcF02Vista === 'editor' && this.sgcF02Form.solicitudActivaId) {
        this.sgcF02SolicitudActiva = this.sgcF02Form.solicitudes.find(
          (s) => s.id === this.sgcF02Form.solicitudActivaId
        ) || null;
        if (!this.sgcF02SolicitudActiva) {
          this.sgcF02Vista = 'lista';
        }
      }
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF02IgnorarAutoSave = true;
      this.sgcF02Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF02DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF02Editor)) {
        this.fijarSgcF02EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF02UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF02ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF02IgnorarAutoSave = false;
      this.sgcF02Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF02Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private cargarDgF03DesdeServidor(): void {
    this.dgF03Cargando = true;
    this.dgF03Listo = false;
    this.backendService.cargarDgF03Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF03(res),
        error: () => {
          this.dgF03Cargando = false;
          this.dgF03Listo = true;
        }
      });
  }

  private persistirDgF03(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF03Listo || this.dgF03Guardando) {
      return;
    }
    this.dgF03Guardando = true;
    this.backendService.guardarDgF03Formato(this.dgF03Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF03Guardando = false;
          this.dgF03CambiosPendientes = false;
          this.aplicarEstadoDgF03(res);
        },
        error: () => {
          this.dgF03Guardando = false;
        }
      });
  }

  private aplicarEstadoDgF03(res: any): void {
    if (!res?.success) {
      this.dgF03Cargando = false;
      this.dgF03Listo = true;
      return;
    }
    if (res.datos) {
      this.dgF03IgnorarAutoSave = true;
      this.dgF03Listo = false;
      const d = res.datos;
      this.dgF03Form = {
        empresa: d.empresa ?? this.dgF03Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.dgF03Form.fechaElaboracion,
        revision: d.revision ?? this.dgF03Form.revision,
        objetivos: this.normalizarObjetivosDgF03(d.objetivos),
        firmante: d.firmante ?? this.dgF03Form.firmante,
        cargoFirmante: d.cargoFirmante ?? this.dgF03Form.cargoFirmante,
        pdfFirmado: d.pdfFirmado ?? res.pdfFirmado ?? this.dgF03Form.pdfFirmado
      };
      this.itemsObjetivosDgF03 = this.parseObjetivosAItems(this.dgF03Form.objetivos);
    }
    this.dgF03UltimaSync = res.ultimaSyncDrive || null;
    this.dgF03ContenidoModificado = !!res.contenidoModificado;
    this.dgF03FechaOriginal = res.fechaElaboracionOriginal || null;
    window.setTimeout(() => {
      this.dgF03IgnorarAutoSave = false;
      this.dgF03Listo = true;
      this.dgF03Cargando = false;
    }, 350);
  }

  private cargarMetodologiaAmefDesdeServidor(): void {
    this.metodologiaAmefCargando = true;
    this.backendService.cargarMetodologiaAmefFormato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoMetodologiaAmef(res),
        error: () => {
          this.metodologiaAmefCargando = false;
        }
      });
  }

  private fijarMetodologiaAmefEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.metodologiaAmefEditorUrl = null;
      this.metodologiaAmefEditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.metodologiaAmefEditorUrl === url && this.metodologiaAmefEditorEmbedUrlSafe) {
      return;
    }
    this.metodologiaAmefEditorUrl = url;
    this.metodologiaAmefEditorEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private aplicarEstadoMetodologiaAmef(res: any, forzarRecargaIframe = false): void {
    if (!res?.success) {
      this.metodologiaAmefCargando = false;
      return;
    }
    const editorUrl = res.editorUrl || null;
    const driveId = res.driveFileId || null;
    if (driveId) {
      this.metodologiaAmefDriveFileId = driveId;
    }
    if (editorUrl) {
      this.fijarMetodologiaAmefEmbedUrl(editorUrl, forzarRecargaIframe);
    }
    this.metodologiaAmefUltimaSync = res.ultimaSyncDrive || null;
    if (!editorUrl) {
      this.metodologiaAmefCargando = false;
    }
  }

  private cargarSgcF18DesdeServidor(): void {
    this.sgcF18Cargando = true;
    this.sgcF18Listo = false;
    this.backendService.cargarSgcF18Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF18(res),
        error: () => {
          this.sgcF18Cargando = false;
          this.sgcF18Listo = true;
        }
      });
  }

  private sincronizarSgcF18DesdeDrive(): void {
    this.sgcF18Guardando = true;
    this.backendService.sincronizarSgcF18DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF18Guardando = false;
          this.sgcF18CambiosPendientes = false;
          this.aplicarEstadoSgcF18(res, false, false);
        },
        error: () => {
          this.sgcF18Guardando = false;
        }
      });
  }

  private persistirSgcF18(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF18Listo || this.sgcF18Guardando) {
      return;
    }
    this.sgcF18Guardando = true;
    const editorAbierto = this.mostrarSgcF18Editor;
    const editorActivo = false;
    this.backendService.guardarSgcF18Formato(this.sgcF18Form, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF18Guardando = false;
          this.sgcF18CambiosPendientes = false;
          this.aplicarEstadoSgcF18(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF18Guardando = false;
        }
      });
  }

  private fijarSgcF18EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF18EditorUrl = null;
      this.sgcF18EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF18EditorUrl === url && this.sgcF18EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF18EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF18EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF18(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF18Cargando = false;
      }
      this.sgcF18Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF18Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;

    if (!bloquearFormulario && res.datos) {
      this.sgcF18IgnorarAutoSave = true;
      this.sgcF18Listo = false;
      this.sgcF18Form = {
        revision: res.datos.revision ?? this.sgcF18Form.revision,
        fechaRevision: res.datos.fechaRevision ?? this.sgcF18Form.fechaRevision,
        fechaElaboracion: res.datos.fechaElaboracion ?? this.sgcF18Form.fechaElaboracion,
        fechaRevisionInformacion: res.datos.fechaRevisionInformacion ?? this.sgcF18Form.fechaRevisionInformacion,
        filas: Array.isArray(res.datos.filas) ? res.datos.filas : this.sgcF18Form.filas
      };
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF18IgnorarAutoSave = true;
      this.sgcF18Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF18DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF18Editor)) {
        this.fijarSgcF18EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF18UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF18ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF18IgnorarAutoSave = false;
      this.sgcF18Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF18Cargando = false;
      }
    }, editorAbierto ? 0 : 350);
  }

  private cargarSgcPo01DesdeServidor(): void {
    this.sgcPo01Cargando = true;
    this.sgcPo01Listo = false;
    this.backendService.cargarSgcPo01Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcPo01(res),
        error: () => {
          this.sgcPo01Cargando = false;
          this.sgcPo01Listo = true;
        }
      });
  }

  private persistirSgcPo01(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcPo01Listo || this.sgcPo01Guardando) {
      return;
    }
    this.sgcPo01Guardando = true;
    this.backendService.guardarSgcPo01Formato(this.sgcPo01Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcPo01Guardando = false;
          this.sgcPo01CambiosPendientes = false;
          this.aplicarEstadoSgcPo01(res);
        },
        error: () => {
          this.sgcPo01Guardando = false;
        }
      });
  }

  private aplicarEstadoSgcPo01(res: any): void {
    if (!res?.success) {
      this.sgcPo01Cargando = false;
      this.sgcPo01Listo = true;
      return;
    }
    if (res.datos) {
      this.sgcPo01IgnorarAutoSave = true;
      this.sgcPo01Listo = false;
      const d = res.datos;
      this.sgcPo01Form = {
        empresa: d.empresa ?? this.sgcPo01Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.sgcPo01Form.fechaElaboracion,
        revision: d.revision ?? this.sgcPo01Form.revision,
        politica: d.politica ?? this.sgcPo01Form.politica,
        firmante: d.firmante ?? this.sgcPo01Form.firmante,
        cargoFirmante: d.cargoFirmante ?? this.sgcPo01Form.cargoFirmante,
        pdfFirmado: d.pdfFirmado ?? res.pdfFirmado ?? this.sgcPo01Form.pdfFirmado
      };
    }
    this.sgcPo01UltimaSync = res.ultimaSyncDrive || null;
    this.sgcPo01ContenidoModificado = !!res.contenidoModificado;
    this.sgcPo01FechaOriginal = res.fechaElaboracionOriginal || null;
    window.setTimeout(() => {
      this.sgcPo01IgnorarAutoSave = false;
      this.sgcPo01Listo = true;
      this.sgcPo01Cargando = false;
    }, 350);
  }

  private cargarDgF08DesdeServidor(): void {
    this.dgF08Cargando = true;
    this.dgF08Listo = false;
    this.backendService.cargarDgF08Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoDgF08(res),
        error: () => {
          this.dgF08Cargando = false;
          this.dgF08Listo = true;
        }
      });
  }

  private persistirDgF08(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.dgF08Listo || this.dgF08Guardando) {
      return;
    }
    this.dgF08Guardando = true;
    this.backendService.guardarDgF08Formato(this.dgF08Form)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.dgF08Guardando = false;
          this.dgF08CambiosPendientes = false;
          this.aplicarEstadoDgF08(res);
        },
        error: () => {
          this.dgF08Guardando = false;
        }
      });
  }

  private aplicarEstadoDgF08(res: any): void {
    if (!res?.success) {
      this.dgF08Cargando = false;
      this.dgF08Listo = true;
      return;
    }
    if (res.datos) {
      this.dgF08IgnorarAutoSave = true;
      this.dgF08Listo = false;
      const d = res.datos;
      this.dgF08Form = {
        empresa: d.empresa ?? this.dgF08Form.empresa,
        fechaElaboracion: d.fechaElaboracion ?? this.dgF08Form.fechaElaboracion,
        revision: d.revision ?? this.dgF08Form.revision,
        mision: d.mision ?? this.dgF08Form.mision,
        vision: d.vision ?? this.dgF08Form.vision,
        valores: d.valores ?? this.dgF08Form.valores,
        codigoTrabajoEquipo: d.codigoTrabajoEquipo ?? this.dgF08Form.codigoTrabajoEquipo,
        firmante: d.firmante ?? this.dgF08Form.firmante,
        cargoFirmante: d.cargoFirmante ?? this.dgF08Form.cargoFirmante,
        pdfFirmado: d.pdfFirmado ?? res.pdfFirmado ?? this.dgF08Form.pdfFirmado
      };
    }
    this.dgF08UltimaSync = res.ultimaSyncDrive || null;
    this.dgF08ContenidoModificado = !!res.contenidoModificado;
    window.setTimeout(() => {
      this.dgF08IgnorarAutoSave = false;
      this.dgF08Listo = true;
      this.dgF08Cargando = false;
    }, 350);
  }

  private crearFilaSgcF18Vacia(): SgcF18Fila {
    return {
      nombre: '',
      emite: '',
      fechaVigor: '',
      documento: '',
      vigencia: 'Vigente',
      responsable: '',
      observaciones: ''
    };
  }

  private crearSgcF18Vacio() {
    return {
      revision: '00',
      fechaRevision: '2025-07-03',
      fechaElaboracion: '2025-07-03',
      fechaRevisionInformacion: '',
      filas: [
        {
          nombre: 'ISO 9001:2015 Sistemas de Gestión de Calidad - Requisitos',
          emite: 'Comités Internacionales ISO',
          fechaVigor: '2015',
          documento: 'N/A',
          vigencia: 'Vigente',
          responsable: 'Coordinador del SGC',
          observaciones: ''
        }
      ] as SgcF18Fila[]
    };
  }

  private crearSgcPo01Vacio(): SgcPo01Form {
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2025-07-09',
      revision: '01',
      politica:
        'En Biznaga Risk and Tech brindamos el servicio oportuno y confiable de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión. Cumplimos con todos los requisitos aplicables y mejoramos continuamente nuestro sistema de gestión de calidad para alcanzar la satisfacción de nuestros clientes.',
      firmante: 'Marisol Azucena Santillán Melo',
      cargoFirmante: 'DIRECTORA GENERAL',
      pdfFirmado: null
    };
  }

  private crearDgF08Vacio(): DgF08Form {
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2026-03-17',
      revision: '00',
      mision:
        'Somos una organización líder en consultoría estratégica y de gestión en seguridad industrial, salud ocupacional y de medio ambiente, estamos comprometidos en todo momento con generar procesos de calidad que apoyen al crecimiento de nuestros clientes.',
      vision:
        'Ser ampliamente reconocido a nivel nacional por desarrollar soluciones confiables en consultoría y gestión, para mejorar la vida de las personas dentro de las empresas y contribuir al aumento de la rentabilidad en los procesos productivos de nuestros clientes.',
      valores:
        'CONFIANZA: Soy confiable, cuando actúo de una manera adecuada ante una situación, creando un ambiente de seguridad en mi entorno.\n\nHONESTIDAD: Soy honesto cuando soy congruente entre lo que se pienso y lo que hago, anteponiendo la verdad en mis acciones.\n\nRESPONSABILIDAD: Soy responsable cuando, reconozco y acepto las consecuencias de mis actos, entendiendo que estos no deben afectar de forma negativa a nadie, incluyéndose él mismo.\n\nPERSISTENTE: Soy persistente cuando tengo la firmeza y el carácter suficiente para lograr el propósito de la organización.\n\nCOMPROMISO: Soy comprometido cuando transformo una promesa en realidad, logrando los objetivos de la organización.\n\nDISCIPLINA: Soy disciplinado cuando tengo una actuación ordenada y perseverante, con la finalidad de llegar a un bien común para la empresa.',
      codigoTrabajoEquipo:
        'El trabajo en equipo es el resultado de un grupo de personas con sentido de pertenencia a la empresa, que trabaja para un fin común, compartiendo los mismos valores institucionales, lo cual incluye:\n\n• Colaborar con cada uno de los integrantes en el tiempo y espacio que me corresponde.\n• Tener apertura y respeto por las nuevas ideas sin importar quien las aporte.\n• Con mis actos busco el bien común del equipo.\n• Comparto información relevante para la mejora del grupo.\n• Contagio el sentido de pertenencia.',
      firmante: 'Marisol Azucena Santillán Melo',
      cargoFirmante: 'DIRECTORA GENERAL',
      pdfFirmado: null
    };
  }

  private crearFilaSgcF11Vacia(): SgcF11Fila {
    return {
      operacion: '',
      etapa: '',
      modoFalla: '',
      causas: '',
      ocurrencia: '',
      efecto: '',
      severidad: '',
      controlesPreventivos: '',
      controlesDeteccion: '',
      deteccion: '',
      rpn: '',
      acciones: '',
      responsable: '',
      fechaCompromiso: '',
      resultado: '',
      severidadPost: '',
      ocurrenciaPost: '',
      deteccionPost: '',
      rpnPost: ''
    };
  }

  private normalizarFilaSgcF11(fila: SgcF11Fila): SgcF11Fila {
    return {
      ...fila,
      fechaCompromiso: this.normalizarFechaIsoSgcF12(fila.fechaCompromiso),
      rpn: this.normalizarValorRpn(fila.rpn, fila.ocurrencia, fila.severidad, fila.deteccion),
      rpnPost: this.normalizarValorRpn(
        fila.rpnPost,
        fila.ocurrenciaPost,
        fila.severidadPost,
        fila.deteccionPost
      )
    };
  }

  private normalizarFilasSgcF11(filas: SgcF11Fila[]): SgcF11Fila[] {
    return filas.map((fila) => this.normalizarFilaSgcF11(fila));
  }

  private renumerarFilasSgcF11(): void {
    this.sgcF11Form.filas.forEach((fila, index) => {
      fila.operacion = String(index + 1);
    });
  }

  private fechaCompromisoParaExcel(iso: string): string {
    const normalizada = this.normalizarFechaIsoSgcF12(iso);
    if (!normalizada || !/^\d{4}-\d{2}-\d{2}$/.test(normalizada)) {
      return String(iso || '').trim();
    }
    const [y, m, d] = normalizada.split('-');
    return `${d}/${m}/${y}`;
  }

  private prepararPayloadSgcF11ParaGuardar(): typeof this.sgcF11Form {
    return {
      ...this.sgcF11Form,
      filas: this.sgcF11Form.filas.map((fila) => ({
        ...fila,
        rpn: this.normalizarValorRpn(fila.rpn, fila.ocurrencia, fila.severidad, fila.deteccion),
        rpnPost: this.normalizarValorRpn(
          fila.rpnPost,
          fila.ocurrenciaPost,
          fila.severidadPost,
          fila.deteccionPost
        ),
        fechaCompromiso: this.fechaCompromisoParaExcel(fila.fechaCompromiso)
      }))
    };
  }

  private crearSgcF11Vacio() {
    return {
      revision: '00',
      fechaRevision: '2025-01-16',
      area: '',
      departamento: '',
      elaboro: '',
      fechaElaboracion: '2025-01-16',
      proceso: 'VENTAS',
      equipoTrabajo: '',
      filas: [this.crearFilaSgcF11Vacia()] as SgcF11Fila[]
    };
  }

  private crearFilaSgcF12Vacia(): SgcF12Fila {
    return {
      actividad: '',
      asignacion: '',
      recursos: '',
      fechaCompromiso: '',
      verificacion: ''
    };
  }

  private crearSgcF12Vacio() {
    return {
      revision: '00',
      fechaRevision: '2025-01-17',
      fecha: '',
      responsableCambio: '',
      queSeVaACambiar: '',
      proposito: '',
      consecuencias: '',
      planTrabajo: '',
      filas: [this.crearFilaSgcF12Vacia()] as SgcF12Fila[],
      elaboro: '',
      reviso: '',
      autorizo: ''
    };
  }

  private crearFilaSgcF02Vacia(): SgcF02Fila {
    return {
      nombreDocumento: '',
      codigo: '',
      versionActual: '',
      tipoDocumento: '',
      tipoSolicitud: '',
      motivo: ''
    };
  }

  private nuevoIdSgcF02(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private crearSolicitudSgcF02Vacia(): SgcF02Solicitud {
    return {
      id: this.nuevoIdSgcF02(),
      fechaSolicitud: '',
      nombreSolicitante: '',
      puestoSolicitante: '',
      areaDepartamento: '',
      filas: [this.crearFilaSgcF02Vacia()],
      solicita: '',
      autoriza: ''
    };
  }

  private crearSgcF02Vacio(): SgcF02FormData {
    return {
      revision: '00',
      fechaRevision: '2024-08-01',
      solicitudes: [],
      solicitudActivaId: null
    };
  }

  private normalizarFormularioSgcF02(form: SgcF02FormData): SgcF02FormData {
    const esEtiqueta = (texto: string): boolean => {
      const t = String(texto || '').trim().toUpperCase();
      return t.includes('NOMBRE Y FIRMA')
        || t === 'SOLICITA'
        || t === 'AUTORIZA'
        || t.includes('EJEC. SIST')
        || t.includes('SOLICITANTE');
    };

    const normalizarSolicitud = (raw: any): SgcF02Solicitud => {
      const filasRaw = Array.isArray(raw?.filas) ? raw.filas : [];
      const filasLimpias = filasRaw
        .map((fila: any) => ({
          nombreDocumento: String(fila?.nombreDocumento || '').trim(),
          codigo: String(fila?.codigo || '').trim(),
          versionActual: String(fila?.versionActual || '').trim(),
          tipoDocumento: String(fila?.tipoDocumento || '').trim(),
          tipoSolicitud: String(fila?.tipoSolicitud || '').trim(),
          motivo: String(fila?.motivo || '').trim()
        }))
        .filter((fila: SgcF02Fila) => {
          const vacia = !fila.nombreDocumento && !fila.codigo && !fila.versionActual
            && !fila.tipoDocumento && !fila.tipoSolicitud && !fila.motivo;
          if (vacia) {
            return false;
          }
          return !(
            esEtiqueta(fila.nombreDocumento)
            || esEtiqueta(fila.codigo)
            || esEtiqueta(fila.versionActual)
            || esEtiqueta(fila.motivo)
          );
        });
      return {
        id: String(raw?.id || this.nuevoIdSgcF02()),
        fechaSolicitud: this.normalizarFechaIsoSgcF12(raw?.fechaSolicitud),
        nombreSolicitante: String(raw?.nombreSolicitante || '').trim(),
        puestoSolicitante: String(raw?.puestoSolicitante || '').trim(),
        areaDepartamento: String(raw?.areaDepartamento || '').trim(),
        filas: filasLimpias.length ? filasLimpias : [this.crearFilaSgcF02Vacia()],
        solicita: esEtiqueta(raw?.solicita) ? '' : String(raw?.solicita || '').trim(),
        autoriza: esEtiqueta(raw?.autoriza) ? '' : String(raw?.autoriza || '').trim()
      };
    };

    let solicitudes: SgcF02Solicitud[] = [];
    if (Array.isArray(form?.solicitudes)) {
      solicitudes = form.solicitudes.map(normalizarSolicitud);
    } else if ((form as any)?.nombreSolicitante || Array.isArray((form as any)?.filas)) {
      // Compatibilidad con payload plano legado.
      solicitudes = [normalizarSolicitud(form)];
    }

    // Una solicitud por persona (mismos nombres se fusionan).
    const orden: string[] = [];
    const mapa = new Map<string, SgcF02Solicitud>();
    for (const sol of solicitudes) {
      const clave = this.claveNombreSgcF02(sol.nombreSolicitante) || `id:${sol.id}`;
      const existente = mapa.get(clave);
      if (!existente) {
        orden.push(clave);
        mapa.set(clave, sol);
        continue;
      }
      const vistos = new Set(
        existente.filas.map((f) =>
          [f.nombreDocumento, f.codigo, f.versionActual, f.tipoDocumento, f.tipoSolicitud, f.motivo]
            .join('|')
            .toLowerCase()
        )
      );
      for (const fila of sol.filas) {
        const k = [fila.nombreDocumento, fila.codigo, fila.versionActual, fila.tipoDocumento, fila.tipoSolicitud, fila.motivo]
          .join('|')
          .toLowerCase();
        const vacia = !fila.nombreDocumento && !fila.codigo && !fila.versionActual
          && !fila.tipoDocumento && !fila.tipoSolicitud && !fila.motivo;
        if (!vacia && !vistos.has(k)) {
          existente.filas.push(fila);
          vistos.add(k);
        }
      }
      if (!existente.fechaSolicitud && sol.fechaSolicitud) {
        existente.fechaSolicitud = sol.fechaSolicitud;
      }
      if (!existente.puestoSolicitante && sol.puestoSolicitante) {
        existente.puestoSolicitante = sol.puestoSolicitante;
      }
      if (!existente.areaDepartamento && sol.areaDepartamento) {
        existente.areaDepartamento = sol.areaDepartamento;
      }
    }
    solicitudes = orden.map((k) => mapa.get(k)!).filter(Boolean);

    let solicitudActivaId = String(form?.solicitudActivaId || '').trim() || null;
    if (solicitudActivaId && !solicitudes.some((s) => s.id === solicitudActivaId)) {
      solicitudActivaId = solicitudes[0]?.id || null;
    }

    const revisionMatch = String(form.revision || '').match(/(\d{1,3})\s*$/);
    return {
      revision: revisionMatch
        ? String(parseInt(revisionMatch[1], 10)).padStart(2, '0')
        : '00',
      fechaRevision: this.normalizarFechaIsoSgcF12(form.fechaRevision) || '2024-08-01',
      solicitudes,
      solicitudActivaId
    };
  }

  private crearFilaCorreccionSgcF04Vacia(): SgcF04FilaCorreccion {
    return { descripcion: '', responsable: '', fecha: '' };
  }

  private crearFilaCorrectivaSgcF04Vacia(no = 1): SgcF04FilaCorrectiva {
    return { no, acciones: '', responsable: '', fecha: '' };
  }

  private crearFilaResultadoSgcF04Vacia(no = 1): SgcF04FilaResultado {
    return { no, descripcion: '', verifico: '' };
  }

  private nuevoIdSgcF04(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `nc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private crearReporteSgcF04Vacio(): SgcF04Reporte {
    return {
      id: this.nuevoIdSgcF04(),
      fecha: '',
      folio: '',
      fuente: '',
      fuenteDetalle: '',
      normas: { iso9001: false, iso14001: false, iso45001: false },
      origenArea: '',
      reportaNombre: '',
      reportaPuesto: '',
      reportaEmpresa: '',
      registraNombre: '',
      registraPuesto: '',
      registraEmpresa: '',
      registraNc: '',
      descripcionNc: '',
      accionesInmediatas: {
        correccion: false,
        analisisCausas: false,
        separacion: false,
        contencion: false,
        devolucion: false,
        informarCliente: false,
        suspension: false,
        autorizacionConcesion: false
      },
      maximaAutoridadNombre: 'Marisol A. Santillán Melo',
      maximaAutoridadPuesto: 'Directora General',
      accionesCorreccion: [this.crearFilaCorreccionSgcF04Vacia()],
      causas: ['', '', '', '', ''],
      accionesCorrectivas: [this.crearFilaCorrectivaSgcF04Vacia(1)],
      resultados: [this.crearFilaResultadoSgcF04Vacia(1)],
      fechaCierre: '',
      pdfFirmado: null
    };
  }

  private resolverPersonaRegistraSgcF04(datos: Partial<SgcF04Reporte> | null | undefined): Pick<
    SgcF04Reporte,
    'registraNombre' | 'registraPuesto' | 'registraEmpresa' | 'registraNc'
  > {
    let nombre = String(datos?.registraNombre || '').trim();
    let puesto = String(datos?.registraPuesto || '').trim();
    let empresa = String(datos?.registraEmpresa || '').trim();
    if (!nombre && !puesto && !empresa) {
      const parsed = this.parsearTextoPersonaSgcF04(datos?.registraNc);
      nombre = parsed.nombre;
      puesto = parsed.puesto;
      empresa = parsed.empresa;
    }
    return {
      registraNombre: nombre,
      registraPuesto: puesto,
      registraEmpresa: empresa,
      registraNc: this.componerTextoPersonaSgcF04(nombre, puesto, empresa, datos?.registraNc)
    };
  }

  private componerTextoPersonaSgcF04(
    nombre: string,
    puesto: string,
    empresa: string,
    fallback = ''
  ): string {
    const lineas: string[] = [];
    const n = String(nombre || '').trim();
    const p = String(puesto || '').trim();
    const e = String(empresa || '').trim();
    if (n) lineas.push(`Nombre: ${n}`);
    if (p) lineas.push(`Puesto: ${p}`);
    if (e) lineas.push(`Empresa: ${e}`);
    if (lineas.length) {
      return lineas.join('\n');
    }
    return String(fallback || '').trim();
  }

  private parsearTextoPersonaSgcF04(texto: string | null | undefined): {
    nombre: string;
    puesto: string;
    empresa: string;
  } {
    const raw = String(texto || '').replace(/\r\n/g, '\n').trim();
    const vacio = { nombre: '', puesto: '', empresa: '' };
    if (!raw) {
      return vacio;
    }
    const tomar = (etiqueta: string): string => {
      const m = raw.match(new RegExp(`${etiqueta}\\s*:\\s*(.+)`, 'i'));
      return m ? String(m[1] || '').trim() : '';
    };
    const etiquetado = {
      nombre: tomar('Nombre'),
      puesto: tomar('Puesto'),
      empresa: tomar('Empresa')
    };
    if (etiquetado.nombre || etiquetado.puesto || etiquetado.empresa) {
      return etiquetado;
    }
    const lineas = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lineas.length >= 2) {
      return {
        nombre: lineas[0],
        puesto: lineas[1],
        empresa: lineas[2] || ''
      };
    }
    return { nombre: raw, puesto: '', empresa: '' };
  }

  private crearSgcF04Vacio(): SgcF04FormData {
    return {
      revision: '02',
      fechaRevision: '2026-08-05',
      reportes: []
    };
  }

  private sanitizarPdfSgcF04(raw: any): SgcF04PdfFirmado | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) {
      return null;
    }
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-04 Reporte firmado.pdf').trim(),
      webViewLink: raw.webViewLink || raw.web_view_link || null,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  private normalizarReporteSgcF04(datos: Partial<SgcF04Reporte> | null | undefined): SgcF04Reporte {
    const base = this.crearReporteSgcF04Vacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    const normas = datos.normas || base.normas;
    const acciones = datos.accionesInmediatas || base.accionesInmediatas;
    const correccion = Array.isArray(datos.accionesCorreccion) && datos.accionesCorreccion.length
      ? datos.accionesCorreccion
      : base.accionesCorreccion;
    const causasRaw = Array.isArray(datos.causas) ? datos.causas : base.causas;
    const correctivas = Array.isArray(datos.accionesCorrectivas) && datos.accionesCorrectivas.length
      ? datos.accionesCorrectivas
      : base.accionesCorrectivas;
    const resultados = Array.isArray(datos.resultados) && datos.resultados.length
      ? datos.resultados
      : base.resultados;
    return {
      ...base,
      ...datos,
      id: String(datos.id || base.id),
      normas: {
        iso9001: !!normas.iso9001,
        iso14001: !!normas.iso14001,
        iso45001: !!normas.iso45001
      },
      accionesInmediatas: {
        correccion: !!acciones.correccion,
        analisisCausas: !!acciones.analisisCausas,
        separacion: !!acciones.separacion,
        contencion: !!acciones.contencion,
        devolucion: !!acciones.devolucion,
        informarCliente: !!acciones.informarCliente,
        suspension: !!acciones.suspension,
        autorizacionConcesion: !!acciones.autorizacionConcesion
      },
      accionesCorreccion: correccion.map((f) => ({
        descripcion: String(f?.descripcion || ''),
        responsable: String(f?.responsable || ''),
        fecha: String(f?.fecha || '')
      })),
      causas: causasRaw.length
        ? causasRaw.map((c) => String(c || ''))
        : ['', '', '', '', ''],
      accionesCorrectivas: correctivas.map((f, i) => ({
        no: i + 1,
        acciones: String(f?.acciones || ''),
        responsable: String(f?.responsable || ''),
        fecha: String(f?.fecha || '')
      })),
      resultados: resultados.map((f, i) => ({
        no: i + 1,
        descripcion: String(f?.descripcion || ''),
        verifico: String(f?.verifico || '')
      })),
      maximaAutoridadNombre: String(datos.maximaAutoridadNombre || base.maximaAutoridadNombre),
      maximaAutoridadPuesto: String(datos.maximaAutoridadPuesto || base.maximaAutoridadPuesto),
      pdfFirmado: this.sanitizarPdfSgcF04(datos.pdfFirmado),
      ...this.resolverPersonaRegistraSgcF04(datos)
    };
  }

  private normalizarSgcF04Form(datos: any): SgcF04FormData {
    const base = this.crearSgcF04Vacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    let reportesRaw: any[] = [];
    if (Array.isArray(datos.reportes)) {
      reportesRaw = datos.reportes;
    } else if (datos.folio || datos.descripcionNc || datos.fuente || datos.fecha) {
      // Migración legacy: un solo formulario plano → un reporte.
      reportesRaw = [datos];
    }
    return {
      revision: String(datos.revision || base.revision),
      fechaRevision: String(datos.fechaRevision || base.fechaRevision),
      reportes: reportesRaw.map((r) => this.normalizarReporteSgcF04(r))
    };
  }

  get sgcF04ReportesVista(): SgcF04Reporte[] {
    const q = this.sgcF04Busqueda.trim().toLowerCase();
    const lista = [...this.sgcF04Form.reportes].sort((a, b) => {
      const fa = String(a.fecha || '');
      const fb = String(b.fecha || '');
      return fb.localeCompare(fa) || String(b.folio || '').localeCompare(String(a.folio || ''));
    });
    if (!q) {
      return lista;
    }
    return lista.filter((r) =>
      [r.folio, r.fuente, r.origenArea, r.reportaNombre, r.descripcionNc, r.fecha]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  seleccionarFuenteSgcF04(fuente: string): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    this.sgcF04ReporteActivo.fuente = fuente;
    this.onSgcF04Editado();
  }

  /** Genera folio NC-DDMMAA-NN contra todos los reportes del archivero. */
  generarFolioSgcF04(): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    const baseFecha = this.sgcF04ReporteActivo.fecha || new Date().toISOString().slice(0, 10);
    const d = new Date(`${baseFecha}T12:00:00`);
    const fecha = Number.isNaN(d.getTime()) ? new Date() : d;
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const aa = String(fecha.getFullYear()).slice(-2);
    const fechaTag = `${dd}${mm}${aa}`;
    if (!this.sgcF04ReporteActivo.fecha) {
      this.sgcF04ReporteActivo.fecha = `${fecha.getFullYear()}-${mm}-${dd}`;
    }
    let maximo = 0;
    this.sgcF04Form.reportes.forEach((r) => {
      if (r.id === this.sgcF04ReporteActivo?.id) {
        return;
      }
      const match = String(r.folio || '').match(/^NC-(\d{6})-(\d{1,})$/i);
      if (match && match[1] === fechaTag) {
        const n = parseInt(match[2], 10);
        if (Number.isFinite(n) && n > maximo) {
          maximo = n;
        }
      }
    });
    this.sgcF04ReporteActivo.folio = `NC-${fechaTag}-${String(maximo + 1).padStart(2, '0')}`;
    this.onSgcF04Editado();
  }

  nuevoReporteSgcF04(): void {
    const reporte = this.crearReporteSgcF04Vacio();
    const hoy = new Date();
    reporte.fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(hoy);
    this.sgcF04Form.reportes = [reporte, ...this.sgcF04Form.reportes];
    this.sgcF04ArchivoExpandidoId = null;
    this.sgcF04ReporteActivo = reporte;
    this.sgcF04Vista = 'editor';
    this.generarFolioSgcF04();
    this.onSgcF04Editado();
  }

  abrirReporteSgcF04(reporte: SgcF04Reporte): void {
    this.sgcF04ArchivoExpandidoId = null;
    this.sgcF04ReporteActivo = reporte;
    this.sgcF04Vista = 'editor';
  }

  private intentarAbrirReporteSgcF04PorFolio(folio: string): void {
    const folioNorm = String(folio || '').trim().toUpperCase();
    if (!folioNorm || !this.sgcF04Listo) {
      return;
    }
    const reporte = this.sgcF04Form.reportes.find(
      (r) => String(r.folio || '').trim().toUpperCase() === folioNorm
    );
    if (!reporte) {
      return;
    }
    this.abrirReporteSgcF04(reporte);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { folio: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.sgcF04FolioPendiente = null;
  }

  toggleArchivoSgcF04(reporte: SgcF04Reporte, event?: Event): void {
    event?.stopPropagation?.();
    const id = String(reporte?.id || '');
    if (!id) {
      return;
    }
    this.sgcF04ArchivoExpandidoId = this.sgcF04ArchivoExpandidoId === id ? null : id;
  }

  archivoExpandidoSgcF04(reporte: SgcF04Reporte): boolean {
    return !!reporte?.id && this.sgcF04ArchivoExpandidoId === String(reporte.id);
  }

  volverArchiveroSgcF04(): void {
    this.sgcF04Vista = 'archivero';
    this.sgcF04ReporteActivo = null;
    this.sgcF04ArchivoExpandidoId = null;
    if (this.mostrarSgcF04PdfViewer) {
      this.toggleSgcF04PdfViewer();
    }
  }

  eliminarReporteSgcF04(reporte: SgcF04Reporte, event?: Event): void {
    event?.stopPropagation();
    if (!confirm(`¿Eliminar el reporte ${reporte.folio || 'sin folio'}?`)) {
      return;
    }
    this.sgcF04Form.reportes = this.sgcF04Form.reportes.filter((r) => r.id !== reporte.id);
    if (this.sgcF04ArchivoExpandidoId === String(reporte.id)) {
      this.sgcF04ArchivoExpandidoId = null;
    }
    if (this.sgcF04ReporteActivo?.id === reporte.id) {
      this.volverArchiveroSgcF04();
    }
    this.onSgcF04Editado();
  }

  agregarFilaCorreccionSgcF04(): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    this.sgcF04ReporteActivo.accionesCorreccion.push(this.crearFilaCorreccionSgcF04Vacia());
    this.onSgcF04Editado();
  }

  quitarFilaCorreccionSgcF04(index: number): void {
    if (!this.sgcF04ReporteActivo || this.sgcF04ReporteActivo.accionesCorreccion.length <= 1) {
      return;
    }
    this.sgcF04ReporteActivo.accionesCorreccion.splice(index, 1);
    this.onSgcF04Editado();
  }

  agregarCausaSgcF04(): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    this.sgcF04ReporteActivo.causas.push('');
    this.onSgcF04Editado();
  }

  quitarCausaSgcF04(index: number): void {
    if (!this.sgcF04ReporteActivo || this.sgcF04ReporteActivo.causas.length <= 1) {
      return;
    }
    this.sgcF04ReporteActivo.causas.splice(index, 1);
    this.onSgcF04Editado();
  }

  agregarFilaCorrectivaSgcF04(): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    const no = this.sgcF04ReporteActivo.accionesCorrectivas.length + 1;
    this.sgcF04ReporteActivo.accionesCorrectivas.push(this.crearFilaCorrectivaSgcF04Vacia(no));
    this.renumerarCorrectivasSgcF04();
    this.onSgcF04Editado();
  }

  quitarFilaCorrectivaSgcF04(index: number): void {
    if (!this.sgcF04ReporteActivo || this.sgcF04ReporteActivo.accionesCorrectivas.length <= 1) {
      return;
    }
    this.sgcF04ReporteActivo.accionesCorrectivas.splice(index, 1);
    this.renumerarCorrectivasSgcF04();
    this.onSgcF04Editado();
  }

  private renumerarCorrectivasSgcF04(): void {
    this.sgcF04ReporteActivo?.accionesCorrectivas.forEach((f, i) => {
      f.no = i + 1;
    });
  }

  agregarFilaResultadoSgcF04(): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    const no = this.sgcF04ReporteActivo.resultados.length + 1;
    this.sgcF04ReporteActivo.resultados.push(this.crearFilaResultadoSgcF04Vacia(no));
    this.renumerarResultadosSgcF04();
    this.onSgcF04Editado();
  }

  quitarFilaResultadoSgcF04(index: number): void {
    if (!this.sgcF04ReporteActivo || this.sgcF04ReporteActivo.resultados.length <= 1) {
      return;
    }
    this.sgcF04ReporteActivo.resultados.splice(index, 1);
    this.renumerarResultadosSgcF04();
    this.onSgcF04Editado();
  }

  private renumerarResultadosSgcF04(): void {
    this.sgcF04ReporteActivo?.resultados.forEach((f, i) => {
      f.no = i + 1;
    });
  }

  onSgcF04Editado(): void {
    if (!this.sgcF04Listo || this.sgcF04IgnorarAutoSave) {
      return;
    }
    this.sgcF04CambiosPendientes = true;
  }

  onSeleccionarPdfSgcF04(event: Event): void {
    if (!this.sgcF04ReporteActivo) {
      return;
    }
    const folio = this.sgcF04ReporteActivo.folio || 'sin-folio';
    this.procesarPdfDocumento(
      event,
      `SGC-F-04 ${folio}.pdf`,
      (base64, nombre) => this.subirPdfFirmadoSgcF04(base64, nombre)
    );
  }

  private subirPdfFirmadoSgcF04(pdfBase64: string, nombreArchivo: string): void {
    if (this.sgcF04SubiendoPdf || !this.sgcF04ReporteActivo) {
      return;
    }
    this.sgcF04SubiendoPdf = true;
    this.backendService.subirPdfFirmadoSgcF04(pdfBase64, nombreArchivo, this.sgcF04ReporteActivo.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF04SubiendoPdf = false;
          this.aplicarEstadoSgcF04(res);
          if (this.sgcF04ReporteActivo && res?.pdfFirmado) {
            this.sgcF04ReporteActivo.pdfFirmado = this.sanitizarPdfSgcF04(res.pdfFirmado);
          }
        },
        error: () => {
          this.sgcF04SubiendoPdf = false;
        }
      });
  }

  toggleSgcF04PdfViewer(): void {
    const id = this.sgcF04ReporteActivo?.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }
    const abrir = !this.mostrarSgcF04PdfViewer;
    this.mostrarSgcF04PdfViewer = abrir;
    if (abrir) {
      this.sgcF04PdfCargando = true;
      const url = this.sgcF04ReporteActivo?.pdfFirmado?.previewUrl
        || `https://drive.google.com/file/d/${id}/preview`;
      this.sgcF04PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.sgcF04PdfEmbedUrlSafe = null;
    this.sgcF04PdfCargando = false;
  }

  onSgcF04PdfIframeLoad(): void {
    this.sgcF04PdfCargando = false;
  }

  formatearFechaCortaSgcF04(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    return String(iso);
  }

  resumenDescSgcF04(texto: string, max = 90): string {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) {
      return 'Sin descripción';
    }
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  toggleSgcF04Editor(): void {
    if (!this.sgcF04DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF04Editor;
    if (abrir) {
      if (this.sgcF04Guardando) {
        return;
      }
      this.mostrarSgcF04Editor = true;
      this.sgcF04EditorIframeListo = false;
      this.sgcF04EditorCargando = true;
      this.fijarSgcF04EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF04EditorUrl, this.sgcF04DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.mostrarSgcF04Editor = false;
  }

  onSgcF04IframeLoad(): void {
    if (this.sgcF04EditorIframeListo) {
      return;
    }
    this.sgcF04EditorIframeListo = true;
    this.sgcF04EditorCargando = false;
  }

  actualizarPlantillaSgcF04(): void {
    if (this.sgcF04ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF04Editor) {
      this.mostrarSgcF04Editor = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      this.sgcF04EditorCargando = false;
    }
    this.sgcF04ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF04()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF04ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF04(res, false, false, true);
        },
        error: () => {
          this.sgcF04ActualizandoPlantilla = false;
        }
      });
  }

  private cargarCatalogosSgcF04(): void {
    this.backendService.obtenerUsuarios()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const usuarios: any[] = Array.isArray(res?.usuarios) ? res.usuarios : [];
          const nombres: string[] = [];
          const puestos: string[] = [];
          usuarios.forEach((u: any) => {
            if (this.esPerfilEmpresaAthF08(u)) {
              return;
            }
            const nombre = this.nombreColaboradorAthF08(u);
            if (nombre) {
              nombres.push(nombre);
            }
            const puesto = String(
              u?.empresa_puesto || u?.puesto_contacto || u?.puesto || u?.cargo || ''
            ).trim();
            if (puesto) {
              puestos.push(puesto);
            }
          });
          this.sgcF04CatalogoNombres = Array.from(new Set(nombres))
            .sort((a, b) => a.localeCompare(b, 'es'));
          this.sgcF04CatalogoPuestos = Array.from(new Set(puestos))
            .sort((a, b) => a.localeCompare(b, 'es'));
        },
        error: () => {
          this.sgcF04CatalogoNombres = [];
          this.sgcF04CatalogoPuestos = [];
        }
      });

    this.backendService.obtenerEmpresas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const rows: any[] = Array.isArray(res)
            ? res
            : (Array.isArray(res?.empresas) ? res.empresas : []);
          const nombres = rows
            .map((e: any) => String(e?.nombre_empresa || e?.nombre || '').trim())
            .filter((n: string) => !!n);
          this.sgcF04CatalogoEmpresas = Array.from(new Set(nombres))
            .sort((a, b) => a.localeCompare(b, 'es'));
        },
        error: () => {
          this.sgcF04CatalogoEmpresas = [];
        }
      });
  }

  private catalogoActivoSgcF04(): string[] {
    switch (this.sgcF04ComboCampo) {
      case 'reportaNombre':
      case 'registraNombre':
      case 'verifico':
        return this.sgcF04CatalogoNombres;
      case 'reportaPuesto':
      case 'registraPuesto':
        return this.sgcF04CatalogoPuestos;
      case 'reportaEmpresa':
      case 'registraEmpresa':
        return this.sgcF04CatalogoEmpresas;
      default:
        return [];
    }
  }

  private valorCampoPersonaSgcF04(campo: SgcF04ComboCampo, fila: number | null = null): string {
    const rep = this.sgcF04ReporteActivo;
    if (!rep) {
      return '';
    }
    switch (campo) {
      case 'reportaNombre':
        return String(rep.reportaNombre || '');
      case 'reportaPuesto':
        return String(rep.reportaPuesto || '');
      case 'reportaEmpresa':
        return String(rep.reportaEmpresa || '');
      case 'registraNombre':
        return String(rep.registraNombre || '');
      case 'registraPuesto':
        return String(rep.registraPuesto || '');
      case 'registraEmpresa':
        return String(rep.registraEmpresa || '');
      case 'verifico':
        return String(rep.resultados?.[fila ?? -1]?.verifico || '');
      default:
        return '';
    }
  }

  private valorActualComboSgcF04(): string {
    if (!this.sgcF04ComboCampo) {
      return '';
    }
    return this.valorCampoPersonaSgcF04(this.sgcF04ComboCampo, this.sgcF04ComboFila);
  }

  private aplicarValorComboSgcF04(valor: string, recortar = true): void {
    const rep = this.sgcF04ReporteActivo;
    if (!rep || !this.sgcF04ComboCampo) {
      return;
    }
    const texto = recortar ? String(valor || '').trim() : String(valor || '');
    switch (this.sgcF04ComboCampo) {
      case 'reportaNombre':
        rep.reportaNombre = texto;
        break;
      case 'reportaPuesto':
        rep.reportaPuesto = texto;
        break;
      case 'reportaEmpresa':
        rep.reportaEmpresa = texto;
        break;
      case 'registraNombre':
        rep.registraNombre = texto;
        rep.registraNc = this.componerTextoPersonaSgcF04(
          rep.registraNombre, rep.registraPuesto, rep.registraEmpresa, ''
        );
        break;
      case 'registraPuesto':
        rep.registraPuesto = texto;
        rep.registraNc = this.componerTextoPersonaSgcF04(
          rep.registraNombre, rep.registraPuesto, rep.registraEmpresa, ''
        );
        break;
      case 'registraEmpresa':
        rep.registraEmpresa = texto;
        rep.registraNc = this.componerTextoPersonaSgcF04(
          rep.registraNombre, rep.registraPuesto, rep.registraEmpresa, ''
        );
        break;
      case 'verifico': {
        const fila = this.sgcF04ComboFila;
        if (fila !== null && fila !== undefined && rep.resultados?.[fila]) {
          rep.resultados[fila].verifico = texto;
        }
        break;
      }
    }
    this.onSgcF04Editado();
  }

  get sugerenciasComboSgcF04(): string[] {
    return this.filtrarCatalogoAthF08(
      this.catalogoActivoSgcF04(),
      this.sgcF04ComboQuery,
      this.valorActualComboSgcF04()
    ).slice(0, 40);
  }

  get textoLibreComboSgcF04(): string {
    const q = String(this.sgcF04ComboQuery || '').trim();
    if (!q) {
      return '';
    }
    const existe = this.catalogoActivoSgcF04().some(
      (n) => this.normalizarTextoAthF08(n) === this.normalizarTextoAthF08(q)
    );
    return existe ? '' : q;
  }

  tituloComboSgcF04(): string {
    switch (this.sgcF04ComboCampo) {
      case 'reportaNombre':
      case 'registraNombre':
      case 'verifico':
        return 'Personas';
      case 'reportaPuesto':
      case 'registraPuesto':
        return 'Puestos';
      case 'reportaEmpresa':
      case 'registraEmpresa':
        return 'Empresas';
      default:
        return 'Sugerencias';
    }
  }

  iconoComboSgcF04(): string {
    switch (this.sgcF04ComboCampo) {
      case 'reportaNombre':
      case 'registraNombre':
      case 'verifico':
        return 'fa-user';
      case 'reportaPuesto':
      case 'registraPuesto':
        return 'fa-id-badge';
      case 'reportaEmpresa':
      case 'registraEmpresa':
        return 'fa-building';
      default:
        return 'fa-search';
    }
  }

  comboAbiertoSgcF04(campo: SgcF04ComboCampo, fila: number | null = null): boolean {
    if (this.sgcF04ComboCampo !== campo) {
      return false;
    }
    if (campo === 'verifico') {
      return this.sgcF04ComboFila === fila;
    }
    return true;
  }

  textoComboSgcF04(campo: SgcF04ComboCampo, fila: number | null = null): string {
    if (this.comboAbiertoSgcF04(campo, fila)) {
      return this.sgcF04ComboQuery;
    }
    return this.valorCampoPersonaSgcF04(campo, fila);
  }

  abrirComboSgcF04(campo: SgcF04ComboCampo, fila: number | null = null): void {
    this.sgcF04ComboCampo = campo;
    this.sgcF04ComboFila = fila;
    this.sgcF04ComboQuery = this.valorActualComboSgcF04();
  }

  onFiltroComboSgcF04(campo: SgcF04ComboCampo, valor: string, fila: number | null = null): void {
    this.sgcF04ComboCampo = campo;
    this.sgcF04ComboFila = fila;
    this.sgcF04ComboQuery = valor;
    this.aplicarValorComboSgcF04(valor, false);
  }

  seleccionarComboSgcF04(valor: string): void {
    this.aplicarValorComboSgcF04(valor);
    this.sgcF04ComboCampo = null;
    this.sgcF04ComboFila = null;
    this.sgcF04ComboQuery = '';
  }

  confirmarComboSgcF04(campo: SgcF04ComboCampo, fila: number | null = null): void {
    if (!this.comboAbiertoSgcF04(campo, fila)) {
      return;
    }
    this.aplicarValorComboSgcF04(this.sgcF04ComboQuery);
    this.sgcF04ComboCampo = null;
    this.sgcF04ComboFila = null;
    this.sgcF04ComboQuery = '';
  }

  limpiarComboSgcF04(campo: SgcF04ComboCampo, fila: number | null = null, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.sgcF04ComboCampo = campo;
    this.sgcF04ComboFila = fila;
    this.aplicarValorComboSgcF04('');
    this.sgcF04ComboQuery = '';
    this.sgcF04ComboCampo = campo;
    this.sgcF04ComboFila = fila;
  }

  onComboSgcF04Keydown(campo: SgcF04ComboCampo, event: KeyboardEvent, fila: number | null = null): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cerrarComboSgcF04(true);
      (event.target as HTMLElement)?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const primero = this.sugerenciasComboSgcF04[0];
      if (primero && !this.textoLibreComboSgcF04) {
        this.seleccionarComboSgcF04(primero);
        return;
      }
      this.confirmarComboSgcF04(campo, fila);
    }
  }

  private cerrarComboSgcF04(descartar = false): void {
    if (!descartar && this.sgcF04ComboCampo) {
      this.aplicarValorComboSgcF04(this.sgcF04ComboQuery);
    }
    this.sgcF04ComboCampo = null;
    this.sgcF04ComboFila = null;
    this.sgcF04ComboQuery = '';
  }

  private cargarSgcF04DesdeServidor(): void {
    this.sgcF04Cargando = true;
    this.sgcF04Listo = false;
    this.sgcF04Vista = 'archivero';
    this.sgcF04ReporteActivo = null;
    this.backendService.cargarSgcF04Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF04(res),
        error: () => {
          this.sgcF04Cargando = false;
          this.sgcF04Listo = true;
        }
      });
  }

  private sincronizarSgcF04DesdeDrive(): void {
    if (this.sgcF04Guardando) {
      return;
    }
    this.sgcF04Guardando = true;
    this.backendService.sincronizarSgcF04DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF04Guardando = false;
          this.sgcF04CambiosPendientes = false;
          this.aplicarEstadoSgcF04(res, false, false);
        },
        error: () => {
          this.sgcF04Guardando = false;
        }
      });
  }

  private persistirSgcF04(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF04Listo || this.sgcF04Guardando) {
      return;
    }
    this.sgcF04Guardando = true;
    const editorAbierto = this.mostrarSgcF04Editor;
    const reporteActivoId = this.sgcF04ReporteActivo?.id || null;
    this.backendService.guardarSgcF04Formato(
      { ...this.sgcF04Form, reporteActivoId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF04Guardando = false;
          this.sgcF04CambiosPendientes = false;
          this.aplicarEstadoSgcF04(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF04Guardando = false;
        }
      });
  }

  private fijarSgcF04EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF04EditorUrl = null;
      this.sgcF04EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF04EditorUrl === url && this.sgcF04EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF04EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF04EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF04(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF04Cargando = false;
      }
      this.sgcF04Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF04Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;
    const activoId = this.sgcF04ReporteActivo?.id || null;

    if (!bloquearFormulario && res.datos) {
      this.sgcF04IgnorarAutoSave = true;
      this.sgcF04Listo = false;
      this.sgcF04Form = this.normalizarSgcF04Form(res.datos);
      if (activoId) {
        this.sgcF04ReporteActivo = this.sgcF04Form.reportes.find((r) => r.id === activoId) || null;
        if (!this.sgcF04ReporteActivo && this.sgcF04Vista === 'editor') {
          this.sgcF04Vista = 'archivero';
        }
      }
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF04IgnorarAutoSave = true;
      this.sgcF04Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF04DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF04Editor)) {
        this.fijarSgcF04EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF04UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF04ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF04IgnorarAutoSave = false;
      this.sgcF04Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF04Cargando = false;
      }
      if (this.sgcF04FolioPendiente) {
        this.intentarAbrirReporteSgcF04PorFolio(this.sgcF04FolioPendiente);
      }
    }, editorAbierto ? 0 : 350);
  }

  private nuevoIdSgcF22(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `dp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private crearReporteSgcF22Vacio(): SgcF22Reporte {
    return {
      id: this.nuevoIdSgcF22(),
      folio: '',
      fechaSuceso: '',
      empresaAfectada: '',
      nombreClienteProveedor: '',
      nombreBien: '',
      descripcionSuceso: '',
      accionesBiznaga: '',
      nombreFirma: '',
      pdfFirmado: null
    };
  }

  private crearSgcF22Vacio(): SgcF22FormData {
    return {
      revision: '00',
      fechaRevision: '2025-01-20',
      reportes: [],
      reporteActivoId: null
    };
  }

  private sanitizarPdfSgcF22(raw: any): SgcF22PdfFirmado | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) {
      return null;
    }
    return {
      driveFileId,
      nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-22 Reporte firmado.pdf').trim(),
      webViewLink: raw.webViewLink || raw.web_view_link || undefined,
      previewUrl: raw.previewUrl || `https://drive.google.com/file/d/${driveFileId}/preview`,
      fechaSubida: raw.fechaSubida || raw.fecha_subida || null
    };
  }

  private normalizarReporteSgcF22(datos: Partial<SgcF22Reporte> | null | undefined): SgcF22Reporte {
    const base = this.crearReporteSgcF22Vacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    return {
      ...base,
      ...datos,
      id: String(datos.id || base.id),
      folio: String(datos.folio || '').trim().toUpperCase(),
      fechaSuceso: String(datos.fechaSuceso || ''),
      empresaAfectada: String(datos.empresaAfectada || ''),
      nombreClienteProveedor: String(datos.nombreClienteProveedor || ''),
      nombreBien: String(datos.nombreBien || ''),
      descripcionSuceso: String(datos.descripcionSuceso || ''),
      accionesBiznaga: String(datos.accionesBiznaga || ''),
      nombreFirma: String(datos.nombreFirma || ''),
      pdfFirmado: this.sanitizarPdfSgcF22(datos.pdfFirmado)
    };
  }

  private normalizarSgcF22Form(datos: any): SgcF22FormData {
    const base = this.crearSgcF22Vacio();
    if (!datos || typeof datos !== 'object') {
      return base;
    }
    let reportesRaw: any[] = [];
    if (Array.isArray(datos.reportes)) {
      reportesRaw = datos.reportes;
    } else if (
      datos.folio
      || datos.fechaSuceso
      || datos.empresaAfectada
      || datos.descripcionSuceso
      || datos.nombreBien
    ) {
      reportesRaw = [datos];
    }
    return {
      revision: String(datos.revision || base.revision),
      fechaRevision: String(datos.fechaRevision || base.fechaRevision),
      reportes: reportesRaw.map((r) => this.normalizarReporteSgcF22(r)),
      reporteActivoId: datos.reporteActivoId ? String(datos.reporteActivoId) : null
    };
  }

  get sgcF22ReportesVista(): SgcF22Reporte[] {
    const q = this.sgcF22Busqueda.trim().toLowerCase();
    const lista = [...this.sgcF22Form.reportes].sort((a, b) => {
      const fa = String(a.fechaSuceso || '');
      const fb = String(b.fechaSuceso || '');
      return fb.localeCompare(fa) || String(b.folio || '').localeCompare(String(a.folio || ''));
    });
    if (!q) {
      return lista;
    }
    return lista.filter((r) =>
      [r.folio, r.empresaAfectada, r.nombreClienteProveedor, r.nombreBien]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  get sgcF22ReportesFirmadosCount(): number {
    return (this.sgcF22Form.reportes || []).filter((r) => !!r?.pdfFirmado?.driveFileId).length;
  }

  /** Genera folio DP-DDMMAA-NN contra todos los reportes del archivero. */
  generarFolioSgcF22(): void {
    if (!this.sgcF22ReporteActivo) {
      return;
    }
    const baseFecha = this.sgcF22ReporteActivo.fechaSuceso || new Date().toISOString().slice(0, 10);
    const d = new Date(`${baseFecha}T12:00:00`);
    const fecha = Number.isNaN(d.getTime()) ? new Date() : d;
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const aa = String(fecha.getFullYear()).slice(-2);
    const fechaTag = `${dd}${mm}${aa}`;
    if (!this.sgcF22ReporteActivo.fechaSuceso) {
      this.sgcF22ReporteActivo.fechaSuceso = `${fecha.getFullYear()}-${mm}-${dd}`;
    }
    let maximo = 0;
    this.sgcF22Form.reportes.forEach((r) => {
      if (r.id === this.sgcF22ReporteActivo?.id) {
        return;
      }
      const match = String(r.folio || '').match(/^DP-(\d{6})-(\d{1,})$/i);
      if (match && match[1] === fechaTag) {
        const n = parseInt(match[2], 10);
        if (Number.isFinite(n) && n > maximo) {
          maximo = n;
        }
      }
    });
    this.sgcF22ReporteActivo.folio = `DP-${fechaTag}-${String(maximo + 1).padStart(2, '0')}`;
    this.onSgcF22Editado();
  }

  nuevoReporteSgcF22(): void {
    const reporte = this.crearReporteSgcF22Vacio();
    const hoy = new Date();
    reporte.fechaSuceso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(hoy);
    this.sgcF22Form.reportes = [reporte, ...this.sgcF22Form.reportes];
    this.sgcF22Form.reporteActivoId = reporte.id;
    this.sgcF22ReporteActivo = reporte;
    this.sgcF22Vista = 'editor';
    this.generarFolioSgcF22();
    this.onSgcF22Editado();
  }

  abrirReporteSgcF22(reporte: SgcF22Reporte): void {
    this.sgcF22ReporteActivo = reporte;
    this.sgcF22Form.reporteActivoId = reporte.id;
    this.sgcF22Vista = 'editor';
  }

  private intentarAbrirReporteSgcF22PorFolio(folio: string): void {
    const folioNorm = String(folio || '').trim().toUpperCase();
    if (!folioNorm || !this.sgcF22Listo) {
      return;
    }
    const reporte = this.sgcF22Form.reportes.find(
      (r) => String(r.folio || '').trim().toUpperCase() === folioNorm
    );
    if (!reporte) {
      return;
    }
    this.abrirReporteSgcF22(reporte);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { folio: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.sgcF22FolioPendiente = null;
  }

  volverArchiveroSgcF22(): void {
    this.sgcF22Vista = 'archivero';
    this.sgcF22ReporteActivo = null;
    this.sgcF22Form.reporteActivoId = null;
    if (this.mostrarSgcF22PdfViewer) {
      this.toggleSgcF22PdfViewer();
    }
  }

  eliminarReporteSgcF22(reporte: SgcF22Reporte, event?: Event): void {
    event?.stopPropagation();
    if (!confirm(`¿Eliminar el reporte ${reporte.folio || 'sin folio'}?`)) {
      return;
    }
    this.sgcF22Form.reportes = this.sgcF22Form.reportes.filter((r) => r.id !== reporte.id);
    if (this.sgcF22ReporteActivo?.id === reporte.id) {
      this.volverArchiveroSgcF22();
    }
    this.onSgcF22Editado();
  }

  onSgcF22Editado(): void {
    if (!this.sgcF22Listo || this.sgcF22IgnorarAutoSave) {
      return;
    }
    this.sgcF22CambiosPendientes = true;
  }

  onSeleccionarPdfSgcF22(event: Event): void {
    if (!this.sgcF22ReporteActivo) {
      return;
    }
    const folio = this.sgcF22ReporteActivo.folio || 'sin-folio';
    this.procesarPdfDocumento(
      event,
      `SGC-F-22 ${folio}.pdf`,
      (base64, nombre) => this.subirPdfFirmadoSgcF22(base64, nombre)
    );
  }

  private subirPdfFirmadoSgcF22(pdfBase64: string, nombreArchivo: string): void {
    if (this.sgcF22SubiendoPdf || !this.sgcF22ReporteActivo) {
      return;
    }
    this.sgcF22SubiendoPdf = true;
    const reporteId = this.sgcF22ReporteActivo.id;
    const folio = this.sgcF22ReporteActivo.folio || '';
    const snapshot = { ...this.sgcF22ReporteActivo };

    // Asegura que el reporte exista en BD antes de asociar el PDF.
    this.sgcF22Form.reporteActivoId = reporteId;
    this.backendService.guardarSgcF22Formato(
      { ...this.sgcF22Form, reporteActivoId: reporteId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resGuardar) => {
          this.aplicarEstadoSgcF22(resGuardar, true, true);
          const activo = this.sgcF22ReporteActivo
            || this.sgcF22Form.reportes.find((r) => r.id === reporteId)
            || this.sgcF22Form.reportes.find((r) => String(r.folio || '').toUpperCase() === folio.toUpperCase())
            || snapshot;
          this.sgcF22ReporteActivo = this.normalizarReporteSgcF22(activo);
          this.backendService.subirPdfFirmadoSgcF22(
            pdfBase64,
            nombreArchivo,
            this.sgcF22ReporteActivo.id,
            { folio: this.sgcF22ReporteActivo.folio || folio, reporte: this.sgcF22ReporteActivo }
          )
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (res) => {
                this.sgcF22SubiendoPdf = false;
                this.aplicarEstadoSgcF22(res);
                if (this.sgcF22ReporteActivo && res?.pdfFirmado) {
                  this.sgcF22ReporteActivo.pdfFirmado = this.sanitizarPdfSgcF22(res.pdfFirmado);
                }
                this.finalizarSubidaPdfSgc(!!res?.success, nombreArchivo);
              },
              error: () => {
                this.sgcF22SubiendoPdf = false;
                this.finalizarSubidaPdfSgc(false);
              }
            });
        },
        error: () => {
          // Si el guardado falla, igual intentamos subir con snapshot (upsert en backend).
          this.backendService.subirPdfFirmadoSgcF22(pdfBase64, nombreArchivo, reporteId, {
            folio,
            reporte: snapshot
          })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (res) => {
                this.sgcF22SubiendoPdf = false;
                this.aplicarEstadoSgcF22(res);
                if (this.sgcF22ReporteActivo && res?.pdfFirmado) {
                  this.sgcF22ReporteActivo.pdfFirmado = this.sanitizarPdfSgcF22(res.pdfFirmado);
                }
                this.finalizarSubidaPdfSgc(!!res?.success, nombreArchivo);
              },
              error: () => {
                this.sgcF22SubiendoPdf = false;
                this.finalizarSubidaPdfSgc(false);
              }
            });
        }
      });
  }

  toggleSgcF22PdfViewer(): void {
    const id = this.sgcF22ReporteActivo?.pdfFirmado?.driveFileId;
    if (!id) {
      return;
    }
    const abrir = !this.mostrarSgcF22PdfViewer;
    this.mostrarSgcF22PdfViewer = abrir;
    if (abrir) {
      this.sgcF22PdfCargando = true;
      const url = this.sgcF22ReporteActivo?.pdfFirmado?.previewUrl
        || `https://drive.google.com/file/d/${id}/preview`;
      this.sgcF22PdfEmbedUrlSafe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.sgcF22PdfEmbedUrlSafe = null;
    this.sgcF22PdfCargando = false;
  }

  onSgcF22PdfIframeLoad(): void {
    this.sgcF22PdfCargando = false;
  }

  formatearFechaCortaSgcF22(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    return String(iso);
  }

  resumenDescSgcF22(texto: string, max = 90): string {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) {
      return 'Sin descripción';
    }
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  toggleSgcF22Editor(): void {
    if (!this.sgcF22DriveFileId) {
      return;
    }
    const abrir = !this.mostrarSgcF22Editor;
    if (abrir) {
      if (this.sgcF22Guardando) {
        return;
      }
      this.mostrarSgcF22Editor = true;
      this.sgcF22EditorIframeListo = false;
      this.sgcF22EditorCargando = true;
      this.fijarSgcF22EditorEmbedUrl(this.resolverUrlEditorDrive(this.sgcF22EditorUrl, this.sgcF22DriveFileId), true);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return;
    }
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    this.mostrarSgcF22Editor = false;
  }

  onSgcF22IframeLoad(): void {
    if (this.sgcF22EditorIframeListo) {
      return;
    }
    this.sgcF22EditorIframeListo = true;
    this.sgcF22EditorCargando = false;
  }

  actualizarPlantillaSgcF22(): void {
    if (this.sgcF22ActualizandoPlantilla) {
      return;
    }
    if (this.mostrarSgcF22Editor) {
      this.mostrarSgcF22Editor = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      this.sgcF22EditorCargando = false;
    }
    this.sgcF22ActualizandoPlantilla = true;
    this.backendService.actualizarPlantillaSgcF22()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF22ActualizandoPlantilla = false;
          this.aplicarEstadoSgcF22(res, false, false, true);
        },
        error: () => {
          this.sgcF22ActualizandoPlantilla = false;
        }
      });
  }

  private cargarSgcF22DesdeServidor(): void {
    this.sgcF22Cargando = true;
    this.sgcF22Listo = false;
    this.sgcF22Vista = 'archivero';
    this.sgcF22ReporteActivo = null;
    this.backendService.cargarSgcF22Formato()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.aplicarEstadoSgcF22(res),
        error: () => {
          this.sgcF22Cargando = false;
          this.sgcF22Listo = true;
        }
      });
  }

  private sincronizarSgcF22DesdeDrive(): void {
    if (this.sgcF22Guardando) {
      return;
    }
    this.sgcF22Guardando = true;
    this.backendService.sincronizarSgcF22DesdeDrive()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF22Guardando = false;
          this.sgcF22CambiosPendientes = false;
          this.aplicarEstadoSgcF22(res, false, false);
        },
        error: () => {
          this.sgcF22Guardando = false;
        }
      });
  }

  private persistirSgcF22(): void {
    if (!this.puedeGestionarPlantillasSgc) {
      return;
    }
    if (!this.sgcF22Listo || this.sgcF22Guardando) {
      return;
    }
    this.sgcF22Guardando = true;
    const editorAbierto = this.mostrarSgcF22Editor;
    const reporteActivoId = this.sgcF22ReporteActivo?.id || null;
    this.sgcF22Form.reporteActivoId = reporteActivoId;
    this.backendService.guardarSgcF22Formato(
      { ...this.sgcF22Form, reporteActivoId },
      false
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sgcF22Guardando = false;
          this.sgcF22CambiosPendientes = false;
          this.aplicarEstadoSgcF22(res, editorAbierto, true);
        },
        error: () => {
          this.sgcF22Guardando = false;
        }
      });
  }

  private fijarSgcF22EditorEmbedUrl(url: string | null, forzar = false): void {
    if (!url) {
      this.sgcF22EditorUrl = null;
      this.sgcF22EditorEmbedUrlSafe = null;
      return;
    }
    if (!forzar && this.sgcF22EditorUrl === url && this.sgcF22EditorEmbedUrlSafe) {
      return;
    }
    this.sgcF22EditorUrl = url;
    const embedUrl = this.urlIframeDriveSegunPermiso(url);
    this.sgcF22EditorEmbedUrlSafe = embedUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl)
      : null;
  }

  private aplicarEstadoSgcF22(
    res: any,
    conservarEdicion = false,
    sincronizacionSilenciosa = false,
    forzarActualizacionDrive = false
  ): void {
    if (!res?.success) {
      if (!sincronizacionSilenciosa) {
        this.sgcF22Cargando = false;
      }
      this.sgcF22Listo = true;
      return;
    }

    const editorAbierto = this.mostrarSgcF22Editor && !forzarActualizacionDrive;
    const bloquearFormulario = editorAbierto || conservarEdicion;
    const activoIdActual = this.sgcF22ReporteActivo?.id || null;

    if (!bloquearFormulario && res.datos) {
      this.sgcF22IgnorarAutoSave = true;
      this.sgcF22Listo = false;
      this.sgcF22Form = this.normalizarSgcF22Form(res.datos);
      const activoId = activoIdActual || this.sgcF22Form.reporteActivoId || null;
      if (activoId) {
        this.sgcF22ReporteActivo = this.sgcF22Form.reportes.find((r) => r.id === activoId) || null;
        this.sgcF22Form.reporteActivoId = this.sgcF22ReporteActivo?.id || null;
        if (!this.sgcF22ReporteActivo && this.sgcF22Vista === 'editor') {
          this.sgcF22Vista = 'archivero';
        } else if (this.sgcF22ReporteActivo && activoIdActual) {
          this.sgcF22Vista = 'editor';
        }
      }
    } else if (!editorAbierto && !conservarEdicion) {
      this.sgcF22IgnorarAutoSave = true;
      this.sgcF22Listo = false;
    }

    const nuevoDriveId = res.driveFileId || null;
    if (forzarActualizacionDrive || !editorAbierto) {
      if (nuevoDriveId) {
        this.sgcF22DriveFileId = nuevoDriveId;
      }
      if (res.editorUrl && (forzarActualizacionDrive || !this.mostrarSgcF22Editor)) {
        this.fijarSgcF22EditorEmbedUrl(res.editorUrl, forzarActualizacionDrive);
      }
    }

    this.sgcF22UltimaSync = res.ultimaSyncDrive || null;
    this.sgcF22ContenidoModificado = !!res.contenidoModificado;

    window.setTimeout(() => {
      this.sgcF22IgnorarAutoSave = false;
      this.sgcF22Listo = true;
      if (!sincronizacionSilenciosa) {
        this.sgcF22Cargando = false;
      }
      if (this.sgcF22FolioPendiente) {
        this.intentarAbrirReporteSgcF22PorFolio(this.sgcF22FolioPendiente);
      }
    }, editorAbierto ? 0 : 350);
  }

  private crearDgF03Vacio(): DgF03Form {
    return {
      empresa: 'BIZNAGA RISK AND TECH',
      fechaElaboracion: '2025-07-11',
      revision: '00',
      objetivos: [
        'Lograr la satisfacción de nuestros clientes.',
        'Implementar acciones que permitan mejorar continuamente el desempeño de nuestros procesos.',
        'Mejorar la eficacia de nuestro Sistema de Gestión de Calidad.'
      ].join('\n'),
      firmante: 'Marisol Azucena Santillán Melo',
      cargoFirmante: 'DIRECTORA GENERAL',
      pdfFirmado: null
    };
  }

  private normalizarObjetivosDgF03(raw: unknown): string {
    return this.serializarObjetivosDesdeItems(this.parseObjetivosAItems(String(raw || '')));
  }

  private parseObjetivosAItems(texto: string): string[] {
    const lineas = String(texto || '')
      .replace(/\r\n/g, '\n')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\d+\.\s*/, ''));
    return lineas.length ? lineas : [''];
  }

  private serializarObjetivosDesdeItems(items: string[]): string {
    const limpios = items.map((i) => i.trim()).filter(Boolean);
    if (!limpios.length) {
      return '';
    }
    if (limpios.length === 1) {
      return limpios[0];
    }
    return limpios.map((texto, index) => `${index + 1}. ${texto}`).join('\n\n');
  }

  actualizarLineaObjetivoDgF03(index: number, valor: string): void {
    this.itemsObjetivosDgF03[index] = valor;
    this.dgF03Form.objetivos = this.serializarObjetivosDesdeItems(this.itemsObjetivosDgF03);
    this.onDgF03Editado();
  }

  agregarLineaObjetivoDgF03(): void {
    this.itemsObjetivosDgF03 = [...this.itemsObjetivosDgF03, ''];
    this.dgF03Form.objetivos = this.serializarObjetivosDesdeItems(this.itemsObjetivosDgF03);
    this.onDgF03Editado();
  }

  eliminarLineaObjetivoDgF03(index: number): void {
    if (this.itemsObjetivosDgF03.length <= 1) {
      return;
    }
    this.itemsObjetivosDgF03 = this.itemsObjetivosDgF03.filter((_, i) => i !== index);
    if (!this.itemsObjetivosDgF03.length) {
      this.itemsObjetivosDgF03 = [''];
    }
    this.dgF03Form.objetivos = this.serializarObjetivosDesdeItems(this.itemsObjetivosDgF03);
    this.onDgF03Editado();
  }

  trackByIndex(index: number): number {
    return index;
  }

  private buscarPlantillaPorPreviewSlug(
    cfg: CapituloFormatoConfig,
    slug: string
  ): PlantillaFormato | null {
    const slugNorm = slug.toLowerCase();
    return cfg.plantillas.find(p => p.previewSlug && p.previewSlug.toLowerCase() === slugNorm) ?? null;
  }

  private initEtiquetaRol(): void {
    const principal = (this.authService.getRol() || '').toLowerCase();
    if (principal === 'root' || principal === 'administrador') {
      this.etiquetaRolUsuario = principal === 'root' ? 'Super administrador' : 'Administrador';
    } else if (this.authService.getRoles().some(r => r === 'sgc')) {
      this.etiquetaRolUsuario = 'SGC';
    } else {
      this.etiquetaRolUsuario = 'Usuario';
    }
  }
}
