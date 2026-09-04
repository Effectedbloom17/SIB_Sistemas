import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

interface DocumentoNode {
  id: string;
  nombre: string;
  seleccionado: boolean;
  visible: boolean;
  subdocumentos?: DocumentoNode[];
  parent?: DocumentoNode;
  drive_file_id?: string | null;
  mime_type?: string | null;
  catalogo_documento_id?: number;
  hoja_nombre?: string | null;
  archivo_maestro_nombre?: string | null;
  es_hoja_workbook?: boolean;
}

interface CategoriaDocumentos {
  id: string;
  titulo: string;
  documentos: DocumentoNode[];
  abierto: boolean;
}

interface ChecklistSegmento {
  id: string;
  titulo: string;
  subtitulo: string;
  icono: string;
  items: ChecklistItemPipc[];
}

interface ChecklistItemPipc {
  id: string;
  categoria: string;
  documento: string;
  especificacion?: string;
  obligatorio?: boolean;
  tipo_entrada?: string;
  necesario: boolean;
  yaAsignado?: boolean;
}

interface PlantillaChecklistState {
  nombre: string;
  cargando: boolean;
  error: string | null;
  items: ChecklistItemPipc[];
}

interface OpcionResponsablePipc {
  id: number;
  nombre: string;
}

@Component({
  selector: 'app-proteccion-civil-asignar-documentos',
  templateUrl: './proteccion-civil-asignar-documentos.component.html',
  styleUrls: ['./proteccion-civil-asignar-documentos.component.scss']
})
export class ProteccionCivilAsignarDocumentosComponent implements OnInit, OnChanges {
  /** De momento solo se muestran plantillas PIPC (sin Uso de Suelo ni otras categorías). */
  private readonly CATEGORIA_PIPC_SLUG = 'pipc';

  @Input() embebido = false;
  @Input() empresaIdEmbebida: number | null = null;
  @Input() nodoBloqueado = false;
  @Input() refreshToken = 0;
  @Output() asignacionGuardada = new EventEmitter<void>();
  @Output() solicitarDesbloqueo = new EventEmitter<void>();
  @Output() responsableActualizado = new EventEmitter<{ usuario_id: number | null; nombre: string | null }>();

  empresaId: number | null = null;
  grupoAbiertoId: string | null = null;
  cargandoCatalogo: boolean = false;
  plantillaActivaId: string | null = null;
  asignacionesActivasNombres = new Set<string>();
  asignacionesActivasCatalogoIds = new Set<number>();
  private requisitosAsignadosPorPlantilla = new Map<string, Set<string>>();
  cargandoAsignacionesActivas = false;

  responsablesOpciones: OpcionResponsablePipc[] = [];
  responsablePipcUsuarioId: number | null = null;
  filtroResponsable = '';
  comboResponsableAbierto = false;
  cargandoResponsable = false;
  guardandoResponsable = false;
  responsableGuardadoOk = false;
  private comboResponsableTimer: ReturnType<typeof setTimeout> | null = null;
  private responsableGuardadoOkTimer: ReturnType<typeof setTimeout> | null = null;
  private responsableCargaSeq = 0;

  categorias: CategoriaDocumentos[] = [];
  checklistsPorPlantilla: Record<string, PlantillaChecklistState> = {};
  segmentosAbiertos: Record<string, boolean> = {};

  private readonly palabrasDocumentoFormal = [
    'acta', 'carátula', 'caratula', 'comprobante', 'diagrama', 'dictamen', 'factura',
    'fotos', 'fotograf', 'ine', 'permiso', 'seguro', 'evidencia', 'planos', 'licencia',
    'certificado', 'poder notarial', 'contrato', 'escritura', 'copia', 'formato',
    'manual', 'programa', 'croquis', 'anexo', 'nombramiento', 'cédula', 'cedula', 'póliza', 'poliza'
  ];

  constructor(
    private route: ActivatedRoute,
    private backendService: BackendServices,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.resolverEmpresaId();
    this.cargarCatalogoDesdeBD();
    this.cargarUsuariosResponsables();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.embebido) {
      return;
    }
    if (changes['empresaIdEmbebida'] && this.empresaIdEmbebida) {
      this.resolverEmpresaId();
      this.cargarCatalogoDesdeBD();
    }
    if (changes['refreshToken'] && !changes['refreshToken'].firstChange) {
      this.cargarContextoEmpresa();
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

  cargarCatalogoDesdeBD(): void {
    this.cargandoCatalogo = true;

    this.backendService.obtenerCatalogoProteccionCivil().subscribe({
      next: (response: any) => {
        if (response?.success && Array.isArray(response.categorias)) {
          this.categorias = response.categorias.map((cat: any) => ({
            id: String(cat.id || cat.slug || ''),
            titulo: String(cat.nombre || ''),
            abierto: false,
            documentos: (cat.documentos || []).map((doc: any): DocumentoNode => ({
              id: String(doc.documento_id || doc.id),
              nombre: String(doc.nombre || ''),
              seleccionado: false,
              visible: true,
              subdocumentos: [],
              drive_file_id: doc.drive_file_id || null,
              mime_type: doc.mime_type || null,
              catalogo_documento_id: doc.documento_id || null,
              hoja_nombre: doc.hoja_nombre || null,
              archivo_maestro_nombre: doc.archivo_maestro_nombre || null,
              es_hoja_workbook: !!doc.es_hoja_workbook
            }))
          })).map((categoria) => {
            if (categoria.id !== this.CATEGORIA_PIPC_SLUG) {
              return categoria;
            }
            const hojas = categoria.documentos.filter((doc) => doc.es_hoja_workbook || doc.hoja_nombre);
            return hojas.length ? { ...categoria, documentos: hojas } : categoria;
          });
        } else {
          this.categorias = [];
        }
        this.vincularPadres();
        this.cargarContextoEmpresa();
        this.cargandoCatalogo = false;
      },
      error: () => {
        this.categorias = [];
        this.vincularPadres();
        this.cargarContextoEmpresa();
        this.cargandoCatalogo = false;
      }
    });
  }

  volver(): void {
    this.router.navigate(['/proteccion-civil'], {
      queryParams: {
        vista: 'menuDocumentos',
        empresaId: this.empresaId || undefined
      }
    });
  }

  get categoriaPipc(): CategoriaDocumentos | null {
    const porSlug = this.categorias.find((categoria) => categoria.id === this.CATEGORIA_PIPC_SLUG);
    if (porSlug) {
      return porSlug;
    }

    return this.categorias.find((categoria) => categoria.titulo.toLowerCase().includes('pipc')) || null;
  }

  get hayDocumentosPipc(): boolean {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return false;
    }
    return this.obtenerHojasCategoria(categoria).length > 0;
  }

  get documentosPipcVisibles(): DocumentoNode[] {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return [];
    }

    const visibles = categoria.documentos.filter((doc) => this.esDocumentoVisible(doc));
    const hojas = visibles.filter((doc) => doc.es_hoja_workbook || doc.hoja_nombre);
    return hojas.length ? hojas : visibles;
  }

  get totalPlantillasCatalogo(): number {
    return this.documentosPipcVisibles.length;
  }

  get totalPlantillasAsignadas(): number {
    return this.documentosPipcVisibles.filter((doc) => this.esRamaYaAsignada(doc)).length;
  }

  get todasPlantillasAsignadas(): boolean {
    return this.totalPlantillasCatalogo > 0
      && this.totalPlantillasAsignadas >= this.totalPlantillasCatalogo;
  }

  get totalSeleccionados(): number {
    const nuevas = this.obtenerHojasSeleccionadas().filter((doc) => !this.esRamaYaAsignada(doc)).length;
    const pendientesRequisitos = this.contarRequisitosPendientesEnPlantillasAsignadas();
    return nuevas + pendientesRequisitos;
  }

  tieneRequisitosPendientesParaAgregar(documento: DocumentoNode): boolean {
    if (!this.esRamaYaAsignada(documento)) {
      return false;
    }
    const checklist = this.checklistsPorPlantilla[documento.id];
    return !!checklist?.items?.some((item) => item.necesario && !item.yaAsignado);
  }

  private contarRequisitosPendientesEnPlantillasAsignadas(): number {
    let total = 0;
    for (const documento of this.documentosPipcVisibles) {
      if (!this.esRamaYaAsignada(documento)) {
        continue;
      }
      const checklist = this.checklistsPorPlantilla[documento.id];
      if (!checklist?.items?.length) {
        continue;
      }
      total += checklist.items.filter((item) => item.necesario && !item.yaAsignado).length;
    }
    return total;
  }

  private obtenerPlantillasParaProcesar(): DocumentoNode[] {
    const nuevas = this.obtenerHojasSeleccionadas().filter((doc) => !this.esRamaYaAsignada(doc));
    const asignadasConPendientes = this.documentosPipcVisibles.filter((doc) => this.tieneRequisitosPendientesParaAgregar(doc));
    const ids = new Set<string>();
    const resultado: DocumentoNode[] = [];
    for (const doc of [...nuevas, ...asignadasConPendientes]) {
      if (ids.has(doc.id)) {
        continue;
      }
      ids.add(doc.id);
      resultado.push(doc);
    }
    return resultado;
  }

  plantillaAsignadaActiva(documento: DocumentoNode): boolean {
    return this.esRamaYaAsignada(documento) && this.plantillaActivaId === documento.id;
  }

  asignarTodos(): void {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return;
    }
    categoria.documentos.forEach((doc) => this.seleccionarRecursivo(doc, true));
  }

  toggleGrupoDocumento(documento: DocumentoNode, level: number): void {
    if (level !== 0 || !this.esGrupoExpandible(documento)) {
      return;
    }

    this.grupoAbiertoId = this.grupoAbiertoId === documento.id ? null : documento.id;
  }

  esGrupoExpandible(documento: DocumentoNode): boolean {
    return !!documento.subdocumentos?.some((subdoc) => this.esDocumentoVisible(subdoc));
  }

  isGrupoAbierto(documento: DocumentoNode): boolean {
    return this.grupoAbiertoId === documento.id;
  }

  toggleCategoria(categoria: CategoriaDocumentos, seleccionado: boolean): void {
    categoria.documentos.forEach((doc) => this.seleccionarRecursivo(doc, seleccionado));
  }

  togglePlantilla(documento: DocumentoNode, seleccionado: boolean): void {
    if (seleccionado && this.esRamaYaAsignada(documento)) {
      return;
    }

    this.toggleDocumento(documento, seleccionado);

    if (seleccionado) {
      this.plantillaActivaId = documento.id;
      this.cargarChecklistPlantilla(documento);
      return;
    }

    if (this.plantillaActivaId === documento.id) {
      const restantes = this.obtenerHojasSeleccionadas();
      this.plantillaActivaId = restantes[0]?.id || null;
    }
  }

  onPlantillaCardClick(documento: DocumentoNode): void {
    if (this.esRamaYaAsignada(documento)) {
      this.plantillaActivaId = documento.id;
      this.cargarChecklistPlantilla(documento);
      return;
    }

    const seleccionado = this.isDocumentoCompleto(documento);
    const esActiva = this.plantillaActivaId === documento.id;

    if (!seleccionado) {
      this.togglePlantilla(documento, true);
      return;
    }

    if (!esActiva) {
      this.plantillaActivaId = documento.id;
      this.cargarChecklistPlantilla(documento);
      return;
    }

    this.togglePlantilla(documento, false);
  }

  activarPlantilla(documento: DocumentoNode): void {
    if (this.esRamaYaAsignada(documento)) {
      this.plantillaActivaId = documento.id;
      this.cargarChecklistPlantilla(documento);
      return;
    }

    if (!documento.seleccionado) {
      this.togglePlantilla(documento, true);
      return;
    }

    this.plantillaActivaId = documento.id;
    this.cargarChecklistPlantilla(documento);
  }

  get plantillasSeleccionadas(): DocumentoNode[] {
    return this.obtenerHojasSeleccionadas();
  }

  get checklistActivo(): PlantillaChecklistState | null {
    if (!this.plantillaActivaId) {
      return null;
    }
    return this.checklistsPorPlantilla[this.plantillaActivaId] || null;
  }

  get checklistSegmentos(): ChecklistSegmento[] {
    const items = this.checklistActivo?.items || [];
    if (!items.length) {
      return [];
    }

    const datos: ChecklistItemPipc[] = [];
    const documentos: ChecklistItemPipc[] = [];
    let pasoADocumentos = false;

    for (const item of items) {
      if (item.tipo_entrada === 'texto') {
        datos.push(item);
        continue;
      }

      if (!pasoADocumentos && !this.esDocumentoFormal(item.documento)) {
        datos.push(item);
      } else {
        pasoADocumentos = true;
        documentos.push(item);
      }
    }

    const segmentos: ChecklistSegmento[] = [];

    if (datos.length) {
      segmentos.push({
        id: 'datos',
        titulo: 'Datos generales',
        subtitulo: 'Información de texto — selecciona lo que solicitarás',
        icono: 'fa-clipboard-list',
        items: datos
      });
    }

    if (documentos.length) {
      segmentos.push({
        id: 'documentos',
        titulo: 'Documentos a solicitar',
        subtitulo: 'Archivos y evidencias — selecciona los necesarios',
        icono: 'fa-file-alt',
        items: documentos
      });
    }

    if (!segmentos.length) {
      return [{
        id: 'todos',
        titulo: 'Requisitos de la plantilla',
        subtitulo: 'Toca cada requisito para marcarlo como necesario',
        icono: 'fa-tasks',
        items
      }];
    }

    return segmentos;
  }

  get checklistNecesariosSi(): number {
    return this.checklistActivo?.items.filter((item) => item.necesario && !item.yaAsignado).length || 0;
  }

  get checklistAsignadosCount(): number {
    return this.checklistActivo?.items.filter((item) => item.yaAsignado).length || 0;
  }

  get checklistAgrupado(): Array<{ categoria: string; items: ChecklistItemPipc[] }> {
    const checklist = this.checklistActivo;
    if (!checklist?.items?.length) {
      return [];
    }

    const gruposMap = new Map<string, ChecklistItemPipc[]>();
    for (const item of checklist.items) {
      const categoria = item.categoria || 'Documentos a solicitar';
      if (!gruposMap.has(categoria)) {
        gruposMap.set(categoria, []);
      }
      gruposMap.get(categoria)!.push(item);
    }

    return Array.from(gruposMap.entries()).map(([categoria, items]) => ({ categoria, items }));
  }

  get checklistRespondidos(): number {
    return this.checklistNecesariosSi;
  }

  get checklistTotal(): number {
    const items = this.checklistActivo?.items || [];
    const pendientes = items.filter((item) => !item.yaAsignado);
    return pendientes.length || items.length;
  }

  get checklistPercent(): number {
    if (this.checklistTotal === 0) {
      return 0;
    }
    return Math.round((this.checklistRespondidos / this.checklistTotal) * 100);
  }

  toggleChecklistItem(item: ChecklistItemPipc): void {
    if (item.yaAsignado) {
      return;
    }
    item.necesario = !item.necesario;
  }

  esItemYaAsignado(item: ChecklistItemPipc): boolean {
    return !!item.yaAsignado;
  }

  segmentoNecesarios(segmento: ChecklistSegmento): number {
    return segmento.items.filter((item) => item.necesario && !item.yaAsignado).length;
  }

  segmentoAsignados(segmento: ChecklistSegmento): number {
    return segmento.items.filter((item) => item.yaAsignado).length;
  }

  segmentoPendientes(segmento: ChecklistSegmento): number {
    return segmento.items.filter((item) => !item.yaAsignado).length;
  }

  isSegmentoAbierto(segmentoId: string): boolean {
    return this.segmentosAbiertos[segmentoId] !== false;
  }

  toggleSegmento(segmentoId: string): void {
    this.segmentosAbiertos[segmentoId] = !this.isSegmentoAbierto(segmentoId);
  }

  trackBySegmento(index: number, segmento: ChecklistSegmento): string {
    return segmento.id;
  }

  trackByChecklistItem(index: number, item: ChecklistItemPipc): string {
    return item.id;
  }

  private esDocumentoFormal(nombre: string): boolean {
    const normalizado = String(nombre || '').toLowerCase();
    return this.palabrasDocumentoFormal.some((palabra) => normalizado.includes(palabra));
  }

  private cargarChecklistPlantilla(documento: DocumentoNode): void {
    const catalogoId = documento.catalogo_documento_id;
    if (!catalogoId) {
      return;
    }

    const existente = this.checklistsPorPlantilla[documento.id];
    if (existente && !existente.error && existente.items.length > 0) {
      this.aplicarEstadoAsignadosChecklist(documento);
      return;
    }

    this.checklistsPorPlantilla[documento.id] = {
      nombre: this.nombrePlantilla(documento),
      cargando: true,
      error: null,
      items: []
    };

    this.backendService.obtenerItemsPlantillaPipc(catalogoId).subscribe({
      next: (response: any) => {
        if (response?.success && Array.isArray(response.items)) {
          this.checklistsPorPlantilla[documento.id] = {
            nombre: response.nombre || this.nombrePlantilla(documento),
            cargando: false,
            error: null,
            items: response.items.map((item: any, index: number): ChecklistItemPipc => ({
              id: String(item.id || index + 1),
              categoria: String(item.categoria || 'Documentos a solicitar'),
              documento: String(item.documento || item.nombre || ''),
              especificacion: item.especificacion || '',
              obligatorio: item.obligatorio !== false,
              tipo_entrada: item.tipo_entrada || 'archivo',
              necesario: true,
              yaAsignado: false
            }))
          };
          this.aplicarEstadoAsignadosChecklist(documento);
          this.segmentosAbiertos = { datos: true, documentos: true, todos: true };
        } else {
          this.checklistsPorPlantilla[documento.id] = {
            nombre: this.nombrePlantilla(documento),
            cargando: false,
            error: response?.message || 'No se pudieron cargar los documentos de la plantilla',
            items: []
          };
        }
      },
      error: () => {
        this.checklistsPorPlantilla[documento.id] = {
          nombre: this.nombrePlantilla(documento),
          cargando: false,
          error: 'Error al leer la plantilla desde el servidor',
          items: []
        };
      }
    });
  }

  toggleDocumento(documento: DocumentoNode, seleccionado: boolean): void {
    if (!documento.visible) {
      return;
    }

    documento.seleccionado = seleccionado;

    if (documento.subdocumentos?.length) {
      documento.subdocumentos.forEach((subdoc) => this.seleccionarRecursivo(subdoc, seleccionado));
    }

    this.sincronizarPadres(documento.parent);
  }

  isCategoriaCompleta(categoria: CategoriaDocumentos): boolean {
    const hojas = this.obtenerHojasCategoria(categoria);
    return hojas.length > 0 && hojas.every((doc) => doc.seleccionado);
  }

  isCategoriaIndeterminada(categoria: CategoriaDocumentos): boolean {
    const hojas = this.obtenerHojasCategoria(categoria);
    if (hojas.length === 0) {
      return false;
    }

    const seleccionadas = hojas.filter((doc) => doc.seleccionado).length;
    return seleccionadas > 0 && seleccionadas < hojas.length;
  }

  isDocumentoCompleto(documento: DocumentoNode): boolean {
    if (!documento.subdocumentos?.length) {
      return documento.seleccionado;
    }

    const hojas = this.obtenerHojasDesde(documento);
    return hojas.length > 0 && hojas.every((doc) => doc.seleccionado);
  }

  isDocumentoIndeterminado(documento: DocumentoNode): boolean {
    if (!documento.subdocumentos?.length) {
      return false;
    }

    const hojas = this.obtenerHojasDesde(documento);
    if (hojas.length === 0) {
      return false;
    }

    const seleccionadas = hojas.filter((doc) => doc.seleccionado).length;
    return seleccionadas > 0 && seleccionadas < hojas.length;
  }

  contadorCategoria(categoria: CategoriaDocumentos): string {
    const hojas = this.obtenerHojasCategoria(categoria);
    const seleccionadas = hojas.filter((doc) => doc.seleccionado).length;
    return `${seleccionadas}/${hojas.length}`;
  }

  esDocumentoVisible(documento: DocumentoNode): boolean {
    return !!documento.visible;
  }

  guardando: boolean = false;

  guardarAsignacion(): void {
    if (!this.empresaId) {
      Swal.fire('Error', 'No se ha seleccionado una empresa', 'error');
      return;
    }

    const plantillasAProcesar = this.obtenerPlantillasParaProcesar();
    const plantillasNuevas = plantillasAProcesar.filter((doc) => !this.esRamaYaAsignada(doc));
    const plantillasActualizar = plantillasAProcesar.filter((doc) => this.esRamaYaAsignada(doc));

    if (plantillasAProcesar.length === 0) {
      Swal.fire(
        'Sin selección',
        'Selecciona una plantilla nueva o abre una ya asignada y marca los requisitos que quieras agregar.',
        'warning'
      );
      return;
    }

    if (plantillasNuevas.length === 0 && plantillasActualizar.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Sin requisitos pendientes',
        html: 'Abre la plantilla ya asignada, marca como <strong>Necesario</strong> el requisito que quieras volver a agregar y guarda.',
        confirmButtonColor: '#d97248'
      });
      return;
    }

    const plantillaChecklistPendiente = plantillasAProcesar.find((doc) => {
      const checklist = this.checklistsPorPlantilla[doc.id];
      return !checklist || checklist.cargando;
    });
    if (plantillaChecklistPendiente) {
      Swal.fire(
        'Checklist en carga',
        `Espera a que termine de cargar el checklist de <b>${this.nombrePlantilla(plantillaChecklistPendiente)}</b>.`,
        'info'
      );
      return;
    }

    const plantillaChecklistError = plantillasAProcesar.find((doc) => {
      const checklist = this.checklistsPorPlantilla[doc.id];
      return !!checklist?.error;
    });
    if (plantillaChecklistError) {
      Swal.fire(
        'Checklist no disponible',
        `No se pudo cargar el checklist de <b>${this.nombrePlantilla(plantillaChecklistError)}</b>. Intenta seleccionar la plantilla de nuevo.`,
        'error'
      );
      return;
    }

    const seleccionados = plantillasAProcesar.map((doc) => {
      const checklist = this.checklistsPorPlantilla[doc.id];
      const esActualizacion = this.esRamaYaAsignada(doc);
      const itemsChecklist = (checklist?.items || []).map((item) => ({
          nombre: item.documento,
          documento: item.documento,
          tipo_entrada: item.tipo_entrada || 'archivo',
          especificacion: item.especificacion || '',
          obligatorio: item.obligatorio !== false,
          necesario: item.necesario,
          yaAsignado: !!item.yaAsignado,
          visible_empresa: item.yaAsignado ? true : item.necesario
        }));

      const itemsNecesarios = esActualizacion
        ? itemsChecklist.filter((item) => !item.yaAsignado && item.necesario)
        : itemsChecklist.filter((item) => item.visible_empresa);

      return {
        catalogo_documento_id: doc.catalogo_documento_id,
        nombre: doc.nombre,
        hoja_nombre: doc.hoja_nombre || null,
        archivo_maestro_nombre: doc.archivo_maestro_nombre || null,
        drive_file_id: doc.drive_file_id,
        mime_type: doc.mime_type,
        items_checklist: itemsChecklist,
        items_necesarios: itemsNecesarios
      };
    });

    const plantillaSinRequisitos = seleccionados.find((doc) => {
      const esXlsx = doc.mime_type?.includes('spreadsheetml') ||
        doc.mime_type?.includes('ms-excel') ||
        /\.xlsx?$/i.test(String(doc.nombre || ''));
      const visibles = (doc.items_necesarios || []);
      return esXlsx && visibles.length === 0;
    });

    if (plantillaSinRequisitos) {
      const nombrePlantilla = String(plantillaSinRequisitos.nombre || '').replace(/\.xlsx?$/i, '').trim();
      const docNode = plantillasAProcesar.find((d) => d.catalogo_documento_id === plantillaSinRequisitos.catalogo_documento_id);
      const checklist = docNode ? this.checklistsPorPlantilla[docNode.id] : null;
      const todosAsignados = checklist?.items?.length
        ? checklist.items.every((item) => item.yaAsignado)
        : false;

      Swal.fire(
        todosAsignados ? 'Todo ya está asignado' : 'Checklist incompleto',
        todosAsignados
          ? `Todos los requisitos de <b>${nombrePlantilla}</b> ya están asignados a esta empresa.`
          : `Marca al menos un requisito pendiente como necesario en la plantilla <b>${nombrePlantilla}</b> antes de guardar.`,
        todosAsignados ? 'info' : 'warning'
      );
      return;
    }

    const totalRequisitos = seleccionados.reduce((acc, doc) => acc + (doc.items_necesarios || []).length, 0);
    const ramasActualizadas = plantillasActualizar.map((doc) => this.nombrePlantilla(doc));
    const ramasNuevas = plantillasNuevas.map((doc) => this.nombrePlantilla(doc));

    const detalleRamas = [
      ramasNuevas.length
        ? `<p class="mb-1"><strong>Nuevas:</strong> ${ramasNuevas.join(', ')}</p>`
        : '',
      ramasActualizadas.length
        ? `<p class="mb-1 text-muted small">Las ramas <strong>${ramasActualizadas.join(', ')}</strong> ya están asignadas; solo se agregarán requisitos faltantes sin crear otro registro en SP-F-29.</p>`
        : ''
    ].filter(Boolean).join('');

    Swal.fire({
      title: '¿Asignar documentos?',
      html: `Se procesarán <b>${seleccionados.length}</b> plantilla(s) con <b>${totalRequisitos}</b> requisito(s) marcados como necesarios.${detalleRamas ? `<div class="mt-2 text-left">${detalleRamas}</div>` : ''}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#d97248',
      cancelButtonColor: '#6c757d',
      confirmButtonText: '<i class="fas fa-check mr-1"></i> Asignar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.guardando = true;

        Swal.fire({
          title: 'Asignando documentos...',
          html: 'Por favor espera un momento mientras procesamos la solicitud.',
          allowOutsideClick: false,
          allowEscapeKey: false,
          showConfirmButton: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });

        this.backendService.asignarDocumentosCatalogo(this.empresaId!, seleccionados, {
          omitir_correo_empresa: this.nodoBloqueado
        }).subscribe({
          next: (response: any) => {
            this.guardando = false;
            Swal.close(); // Cerrar el loading
            
            if (response.success) {
              const actualizadas = Number(response.totalPadresActualizados || 0);
              const nuevas = Number(response.totalPadresNuevos || response.totalPadres || 0);
              this.descargarPdfsAsignacion(Array.isArray(response.pdfs) ? response.pdfs : []);
              Swal.fire({
                title: '¡Documentos asignados!',
                html: `<b>${nuevas}</b> plantilla(s) nueva(s)<br>` +
                  (actualizadas ? `<b>${actualizadas}</b> plantilla(s) actualizada(s)<br>` : '') +
                  `<b>${response.totalHijos || 0}</b> requisito(s) nuevo(s) agregados<br>` +
                  `<small class="text-muted">Se descargaron los listados PDF visibles para la empresa.</small>`,
                icon: 'success',
                confirmButtonColor: '#d97248'
              }).then(() => {
                if (this.embebido) {
                  this.asignacionGuardada.emit();
                  this.cargarContextoEmpresa();
                } else {
                  this.volver();
                }
              });
            } else {
              Swal.fire('Error', response.message || 'No se pudieron asignar los documentos', 'error');
            }
          },
          error: (err) => {
            this.guardando = false;
            console.error('Error al asignar documentos:', err);
            Swal.fire('Error', 'Ocurrió un error al asignar los documentos', 'error');
          }
        });
      }
    });
  }

  trackByDocumento(index: number, documento: DocumentoNode): string {
    return documento.id;
  }

  nombrePlantilla(documento: DocumentoNode): string {
    const base = String(documento.hoja_nombre || documento.nombre || '');
    return base.replace(/^PIPC\s+/i, '').replace(/\.xlsx?$/i, '').trim() || base.replace(/\.xlsx?$/i, '').trim();
  }

  subtituloPlantilla(documento: DocumentoNode): string {
    if (documento.hoja_nombre) {
      return documento.hoja_nombre;
    }
    return this.nombrePlantilla(documento);
  }

  private descargarPdfsAsignacion(pdfs: Array<{ filename?: string; base64?: string; mime_type?: string }>): void {
    if (!pdfs.length) {
      return;
    }

    pdfs.forEach((pdf, index) => {
      if (!pdf?.base64) {
        return;
      }
      const blob = this.base64ToBlob(pdf.base64, pdf.mime_type || 'application/pdf');
      const url = window.URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = pdf.filename || `listado-pipc-${index + 1}.pdf`;
      enlace.click();
      window.URL.revokeObjectURL(url);
    });
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  }

  private seleccionarRecursivo(documento: DocumentoNode, seleccionado: boolean): void {
    if (!documento.visible) {
      return;
    }

    if (!documento.subdocumentos?.length) {
      documento.seleccionado = seleccionado;
      return;
    }

    documento.subdocumentos.forEach((subdoc) => this.seleccionarRecursivo(subdoc, seleccionado));
    const hijosVisibles = documento.subdocumentos.filter((subdoc) => subdoc.visible);
    documento.seleccionado = hijosVisibles.length > 0 && hijosVisibles.every((subdoc) => this.isDocumentoCompleto(subdoc));
  }

  private sincronizarPadres(parent?: DocumentoNode): void {
    if (!parent || !parent.subdocumentos?.length) {
      return;
    }

    const hijosVisibles = parent.subdocumentos.filter((hijo) => hijo.visible);
    parent.seleccionado = hijosVisibles.length > 0 && hijosVisibles.every((hijo) => this.isDocumentoCompleto(hijo));

    this.sincronizarPadres(parent.parent);
  }

  private obtenerHojasCategoria(categoria: CategoriaDocumentos): DocumentoNode[] {
    return categoria.documentos.flatMap((doc) => this.obtenerHojasDesde(doc));
  }

  private obtenerHojasDesde(documento: DocumentoNode): DocumentoNode[] {
    if (!documento.visible) {
      return [];
    }

    if (!documento.subdocumentos?.length) {
      return [documento];
    }

    return documento.subdocumentos.flatMap((subdoc) => this.obtenerHojasDesde(subdoc));
  }

  private obtenerHojasSeleccionadas(): DocumentoNode[] {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return [];
    }
    return this.obtenerHojasCategoria(categoria).filter((doc) => doc.seleccionado);
  }

  private cargarContextoEmpresa(): void {
    this.cargarAsignacionesActivasEmpresa();
    this.cargarResponsablePipcEmpresa();
    this.aplicarVisibilidadDocumentos();
  }

  get responsablesFiltrados(): OpcionResponsablePipc[] {
    const filtro = this.normalizarTexto(this.filtroResponsable);
    if (!filtro) {
      return this.responsablesOpciones;
    }
    return this.responsablesOpciones.filter((op) => this.normalizarTexto(op.nombre).includes(filtro));
  }

  abrirComboResponsable(): void {
    this.comboResponsableAbierto = true;
  }

  cerrarComboResponsableDelayed(): void {
    if (this.comboResponsableTimer) {
      clearTimeout(this.comboResponsableTimer);
    }
    this.comboResponsableTimer = setTimeout(() => {
      this.comboResponsableAbierto = false;
    }, 220);
  }

  onResponsableInput(valor: string): void {
    this.filtroResponsable = valor;
    this.comboResponsableAbierto = true;
    this.responsableGuardadoOk = false;
  }

  onResponsableItemMouseDown(event: MouseEvent, opcion: OpcionResponsablePipc): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarResponsablePipc(opcion);
  }

  seleccionarResponsablePipc(opcion: OpcionResponsablePipc): void {
    if (!opcion?.id || this.guardandoResponsable) {
      return;
    }
    if (this.comboResponsableTimer) {
      clearTimeout(this.comboResponsableTimer);
      this.comboResponsableTimer = null;
    }
    this.comboResponsableAbierto = false;
    this.filtroResponsable = opcion.nombre;
    this.guardarResponsablePipc(opcion.id);
  }

  limpiarResponsablePipc(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.guardandoResponsable) {
      return;
    }
    if (this.comboResponsableTimer) {
      clearTimeout(this.comboResponsableTimer);
      this.comboResponsableTimer = null;
    }
    this.comboResponsableAbierto = false;
    this.filtroResponsable = '';
    this.guardarResponsablePipc(null);
  }

  private cargarUsuariosResponsables(): void {
    this.backendService.obtenerUsuarios().subscribe({
      next: (response: any) => {
        const lista = Array.isArray(response?.usuarios) ? response.usuarios : [];
        this.responsablesOpciones = lista
          .filter((usuario: any) => {
            const rol = this.normalizarTexto(String(usuario?.rol || usuario?.rol_nombre || ''));
            return rol !== 'empresa' && rol !== 'usuario empresa';
          })
          .map((usuario: any) => ({
            id: Number(usuario.id || usuario.usuario_id || 0),
            nombre: this.nombreCompletoUsuario(usuario)
          }))
          .filter((usuario: OpcionResponsablePipc) => usuario.id > 0 && !!usuario.nombre)
          .sort((a: OpcionResponsablePipc, b: OpcionResponsablePipc) => a.nombre.localeCompare(b.nombre, 'es'));
      },
      error: () => {
        this.responsablesOpciones = [];
      }
    });
  }

  private cargarResponsablePipcEmpresa(): void {
    if (!this.empresaId) {
      this.responsablePipcUsuarioId = null;
      this.filtroResponsable = '';
      return;
    }

    if (this.guardandoResponsable) {
      return;
    }

    const seq = ++this.responsableCargaSeq;
    this.cargandoResponsable = true;
    this.backendService.obtenerCentroOperacionesPC(this.empresaId).subscribe({
      next: (response: any) => {
        if (seq !== this.responsableCargaSeq) {
          return;
        }
        this.cargandoResponsable = false;
        if (this.guardandoResponsable) {
          return;
        }
        const ciclo = response?.ciclo || {};
        const usuarioId = Number(ciclo.responsable_pipc_usuario_id || 0) || null;
        const nombre = String(ciclo.responsable_pipc_nombre || '').trim();
        this.responsablePipcUsuarioId = usuarioId;
        this.filtroResponsable = nombre;
      },
      error: () => {
        if (seq !== this.responsableCargaSeq) {
          return;
        }
        this.cargandoResponsable = false;
        if (this.guardandoResponsable) {
          return;
        }
        this.responsablePipcUsuarioId = null;
        this.filtroResponsable = '';
      }
    });
  }

  private guardarResponsablePipc(usuarioId: number | null): void {
    if (!this.empresaId || this.guardandoResponsable) {
      return;
    }

    if (usuarioId === this.responsablePipcUsuarioId) {
      return;
    }

    this.responsableCargaSeq++;
    this.guardandoResponsable = true;
    this.responsableGuardadoOk = false;
    this.backendService.guardarResponsablePipcEmpresa(this.empresaId, usuarioId).subscribe({
      next: (response: any) => {
        if (!response?.success) {
          this.guardandoResponsable = false;
          const actual = this.responsablesOpciones.find((op) => op.id === this.responsablePipcUsuarioId);
          this.filtroResponsable = actual?.nombre || '';
          Swal.fire('Error', response?.message || 'No se pudo guardar el responsable de PIPC', 'error');
          return;
        }

        const idGuardado = Number(response?.responsable_pipc_usuario_id || 0) || null;
        const nombreGuardado = String(response?.responsable_pipc_nombre || '').trim();
        this.responsablePipcUsuarioId = idGuardado;
        this.filtroResponsable = nombreGuardado;
        this.guardandoResponsable = false;
        this.responsableGuardadoOk = true;
        if (this.responsableGuardadoOkTimer) {
          clearTimeout(this.responsableGuardadoOkTimer);
        }
        this.responsableGuardadoOkTimer = setTimeout(() => {
          this.responsableGuardadoOk = false;
        }, 2200);
        this.responsableActualizado.emit({
          usuario_id: idGuardado,
          nombre: nombreGuardado || null
        });
      },
      error: () => {
        this.guardandoResponsable = false;
        const actual = this.responsablesOpciones.find((op) => op.id === this.responsablePipcUsuarioId);
        this.filtroResponsable = actual?.nombre || '';
        Swal.fire('Error', 'No se pudo guardar el responsable de PIPC', 'error');
      }
    });
  }

  private nombreCompletoUsuario(usuario: any): string {
    const partes = [usuario?.nombre, usuario?.apellido, usuario?.apellido_paterno, usuario?.apellido_materno]
      .map((parte) => String(parte || '').trim())
      .filter(Boolean);
    if (partes.length) {
      return partes.join(' ');
    }
    return String(usuario?.username || usuario?.email || '').trim();
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private normalizarNombreRama(nombre: string): string {
    return String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private clavePlantillaDesdeNombre(nombre: string): string {
    const base = String(nombre || '').replace(/\.xlsx?$/i, '').trim();
    const sinPrefijo = base.replace(/^PIPC\s+/i, '').trim() || base;
    return this.normalizarNombreRama(sinPrefijo);
  }

  private clavePlantillaDesdeDocumento(documento: DocumentoNode): string {
    return this.clavePlantillaDesdeNombre(this.nombrePlantilla(documento));
  }

  esRamaYaAsignada(documento: DocumentoNode): boolean {
    const clave = this.clavePlantillaDesdeDocumento(documento);
    if (clave && this.asignacionesActivasNombres.has(clave)) {
      return true;
    }
    const catalogoId = Number(documento.catalogo_documento_id || 0);
    return catalogoId > 0 && this.asignacionesActivasCatalogoIds.has(catalogoId);
  }

  private esSubtituloOperativoNombre(nombre: string): boolean {
    const n = String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return n === 'fisico' || n === 'usb' || n === 'presentar';
  }

  private contarRequisitosReales(subdocumentos: any[] = []): number {
    return subdocumentos.filter((subdoc) => !this.esSubtituloOperativoNombre(String(subdoc?.nombre_documento || ''))).length;
  }

  private cargarAsignacionesActivasEmpresa(): void {
    if (!this.empresaId) {
      this.asignacionesActivasNombres.clear();
      this.asignacionesActivasCatalogoIds.clear();
      this.asignacionesActivasCatalogoIds.clear();
      this.requisitosAsignadosPorPlantilla.clear();
      return;
    }

    this.cargandoAsignacionesActivas = true;
    this.backendService.obtenerDocumentosProteccionCivil(this.empresaId).subscribe({
      next: (response: any) => {
        this.asignacionesActivasNombres.clear();
        this.asignacionesActivasCatalogoIds.clear();
        this.requisitosAsignadosPorPlantilla.clear();
        if (response?.success && Array.isArray(response.documentos)) {
          for (const doc of response.documentos) {
            const catalogoId = Number(doc.catalogo_documento_id || 0);
            if (!catalogoId) {
              continue;
            }

            const totalRequisitos = this.contarRequisitosReales(doc.subdocumentos || []);
            if (totalRequisitos === 0) {
              continue;
            }

            const nombre = String(doc.nombre_documento || '').replace(/\.xlsx?$/i, '').trim();
            const clavePlantilla = this.clavePlantillaDesdeNombre(nombre);
            if (!clavePlantilla) {
              continue;
            }

            this.asignacionesActivasNombres.add(clavePlantilla);
            this.asignacionesActivasCatalogoIds.add(catalogoId);

            const requisitosAsignados = new Set<string>();
            for (const subdoc of doc.subdocumentos || []) {
              if (this.esSubtituloOperativoNombre(String(subdoc.nombre_documento || ''))) {
                continue;
              }
              const nombreRequisito = this.normalizarNombreRama(String(subdoc.nombre_documento || ''));
              if (nombreRequisito) {
                requisitosAsignados.add(nombreRequisito);
              }
            }
            this.requisitosAsignadosPorPlantilla.set(clavePlantilla, requisitosAsignados);
          }
        }
        this.aplicarBloqueoPlantillasAsignadas();
        this.actualizarChecklistsAsignados();
        this.cargandoAsignacionesActivas = false;
      },
      error: () => {
        this.asignacionesActivasNombres.clear();
        this.asignacionesActivasCatalogoIds.clear();
        this.asignacionesActivasCatalogoIds.clear();
        this.requisitosAsignadosPorPlantilla.clear();
        this.cargandoAsignacionesActivas = false;
      }
    });
  }

  private aplicarBloqueoPlantillasAsignadas(): void {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return;
    }

    for (const documento of this.obtenerHojasCategoria(categoria)) {
      if (!this.esRamaYaAsignada(documento)) {
        continue;
      }

      if (documento.seleccionado) {
        this.toggleDocumento(documento, false);
      }
      if (this.plantillaActivaId === documento.id) {
        const disponibles = this.obtenerHojasCategoria(categoria)
          .filter((doc) => doc.seleccionado && !this.esRamaYaAsignada(doc));
        this.plantillaActivaId = disponibles[0]?.id || null;
      }
    }
  }

  private obtenerRequisitosAsignadosPlantilla(documento: DocumentoNode): Set<string> {
    const clave = this.clavePlantillaDesdeDocumento(documento);
    return this.requisitosAsignadosPorPlantilla.get(clave) || new Set<string>();
  }

  private aplicarEstadoAsignadosChecklist(documento: DocumentoNode): void {
    const checklist = this.checklistsPorPlantilla[documento.id];
    if (!checklist?.items?.length) {
      return;
    }

    const asignados = this.obtenerRequisitosAsignadosPlantilla(documento);
    for (const item of checklist.items) {
      const yaAsignado = asignados.has(this.normalizarNombreRama(item.documento));
      item.yaAsignado = yaAsignado;
      if (yaAsignado) {
        item.necesario = false;
      }
    }
  }

  private actualizarChecklistsAsignados(): void {
    const categoria = this.categoriaPipc;
    if (!categoria) {
      return;
    }

    for (const documento of this.obtenerHojasCategoria(categoria)) {
      if (this.checklistsPorPlantilla[documento.id]) {
        this.aplicarEstadoAsignadosChecklist(documento);
      }
    }
  }

  private aplicarVisibilidadDocumentos(): void {
    this.categorias.forEach((categoria) => {
      categoria.documentos.forEach((documento) => this.actualizarVisibilidadRecursiva(documento));
    });

    this.asegurarGrupoAbiertoValido();
  }

  private asegurarGrupoAbiertoValido(): void {
    const categoria = this.categoriaPipc;
    if (!categoria || !this.grupoAbiertoId) {
      return;
    }

    const grupoAbiertoSigueVisible = categoria.documentos.some(
      (documento) => documento.id === this.grupoAbiertoId && this.esDocumentoVisible(documento)
    );

    if (!grupoAbiertoSigueVisible) {
      this.grupoAbiertoId = null;
    }
  }

  private actualizarVisibilidadRecursiva(documento: DocumentoNode): boolean {
    if (!documento.subdocumentos?.length) {
      documento.visible = this.esLeafVisible(documento);
      if (!documento.visible) {
        documento.seleccionado = false;
      }
      return documento.visible;
    }

    const hayHijosVisibles = documento.subdocumentos
      .map((subdoc) => this.actualizarVisibilidadRecursiva(subdoc))
      .some((visible) => visible);

    documento.visible = hayHijosVisibles || this.esLeafVisible(documento);

    if (!documento.visible) {
      documento.seleccionado = false;
    }

    return documento.visible;
  }

  private esLeafVisible(documento: DocumentoNode): boolean {
    return true;
  }

  private vincularPadres(): void {
    this.categorias.forEach((categoria) => {
      categoria.documentos.forEach((doc) => this.asignarPadreRecursivo(doc, undefined));
    });
  }

  private asignarPadreRecursivo(documento: DocumentoNode, parent?: DocumentoNode): void {
    documento.parent = parent;
    documento.subdocumentos?.forEach((subdoc) => this.asignarPadreRecursivo(subdoc, documento));
  }
}
