import { Component, OnInit, OnDestroy, DoCheck, Renderer2, ElementRef } from '@angular/core';
import { AuthService } from 'src/app/services/auth.service';
import { BackendServices } from 'src/app/services/backend.services';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import {
  fechaSoloDiaATimestamp,
  formatearFechaDdmmaaaa,
  obtenerFechaHoyLocal,
  obtenerFinDiaTimestamp,
  obtenerInicioDiaTimestamp,
  parsearFechaFlexible
} from 'src/app/utils/fecha.util';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

@Component({
  selector: 'app-expedientes-medicos',
  templateUrl: './expedientes-medicos.component.html',
  styleUrls: ['./expedientes-medicos.component.scss']
})
export class ExpedientesMedicosComponent implements OnInit, OnDestroy, DoCheck {

  private mainContentEl: HTMLElement | null = null;
  private ultimaVistaAplicadaScroll: 'empresas' | 'menu' | 'formulario' | 'preview' | 'historial' | '' = '';

  vistaActual: 'empresas' | 'menu' | 'formulario' | 'preview' | 'historial' = 'empresas';
  guardando: boolean = false;
  historiasClinicas: any[] = [];
  historiasFiltradas: any[] = [];
  cargandoHistorial: boolean = false;
  origenPreview: 'formulario' | 'historial' = 'formulario';
  editandoHistoriaId: number | null = null;
  modoEdicionDesdeHistorial: boolean = false;
  folioOrigenEdicion: string = '';

  // Datos del doctor logueado
  esDoctor: boolean = false;
  private esDoctorPrincipal: boolean = false;
  esAdmin: boolean = false;
  firmaUrlDoctor: string = '';
  datosDoctor: any = null;
  historiaActualId: number | null = null;
  /** Vista previa abierta desde historial sin flujo de edición/creación activo */
  historiaSoloLecturaDesdeHistorial: boolean = false;

  // =====================================================
  // EMPRESAS - Selector de empresa
  // =====================================================
  empresas: any[] = [];
  empresasFiltradas: any[] = [];
  empresaSeleccionada: any = null;
  cargandoEmpresas: boolean = false;
  textoBusquedaEmpresa: string = '';
  estadosEmpresa: string[] = [];
  estadoSeleccionadoEmpresa: string = '';
  municipiosEmpresa: string[] = [];
  municipioSeleccionadoEmpresa: string = '';

  // Filtros del historial
  filtroTexto: string = '';
  filtroTipo: string = '';
  filtroFechaDesde: string = '';

  // Ordenamiento
  columnaOrden: string = 'created_at';
  ordenAsc: boolean = false;

  // =====================================================
  // MULTI-STEP WIZARD
  // =====================================================
  pasoActual: number = 1;
  maxPasoAlcanzado: number = 1;

  get esGeneroFemenino(): boolean {
    return String(this.formulario?.genero || '').trim().toLowerCase() === 'femenino';
  }

  get esGeneroMasculino(): boolean {
    return String(this.formulario?.genero || '').trim().toLowerCase() === 'masculino';
  }

  get pasos(): { numero: number; titulo: string; icono: string }[] {
    const base = [
      { numero: 1, titulo: 'Datos Generales', icono: 'fas fa-user' },
      { numero: 2, titulo: 'Ant. Laborales', icono: 'fas fa-briefcase' },
      { numero: 3, titulo: 'Ant. Heredo-Familiares', icono: 'fas fa-dna' },
      { numero: 4, titulo: 'Ant. No Patológicos', icono: 'fas fa-smoking-ban' },
      { numero: 5, titulo: 'Ant. Patológicos', icono: 'fas fa-notes-medical' },
    ];
    if (this.esGeneroFemenino) {
      base.push({ numero: 6, titulo: 'Ant. Gineco-Obstétricos', icono: 'fas fa-female' });
    }
    const offset = this.esGeneroFemenino ? 0 : -1;
    base.push({ numero: 7 + offset, titulo: 'Exploración Física', icono: 'fas fa-stethoscope' });
    base.push({ numero: 8 + offset, titulo: 'Paraclínicos', icono: 'fas fa-vials' });
    base.push({ numero: 9 + offset, titulo: 'Diagnóstico', icono: 'fas fa-clipboard-check' });
    return base;
  }

  get pasoGineco(): number { return 6; }
  get pasoExploracion(): number { return this.esGeneroFemenino ? 7 : 6; }
  get pasoParaclinicos(): number { return this.esGeneroFemenino ? 8 : 7; }
  get pasoDiagnostico(): number { return this.esGeneroFemenino ? 9 : 8; }
  get seccionExploracionNumero(): number { return this.pasoExploracion - 1; }
  get seccionParaclinicosNumero(): number { return this.pasoParaclinicos - 1; }
  get seccionDiagnosticoNumero(): number { return this.pasoDiagnostico - 1; }

  formulario: any = {};
  antecedentesLaborales: any[] = [];
  observacionesLaborales: string = '';
  heredoFamiliares: { [key: string]: boolean } = {};
  heredoFamiliaresMadre: string = '';
  heredoFamiliaresPadre: string = '';
  observacionesHeredoFamiliares: string = '';

  // Paso 4: Antecedentes Personales No Patológicos
  tabaquismo: any = {};
  alcoholismo: any = {};
  otrasDrogas: any = {};
  ejercicio: any = {};
  sueno: any = {};
  tareasDomesticas: string = '';
  actividadesTiempoLibre: string = '';
  tipoSanguineo: string = '';
  vacunas: any = {};
  habitosHigiene: any = {};
  tatuajes: any = {};
  indiceTabaquico: string = '';
  observacionesNoPatologicos: string = '';
  indiceHacinamiento: string = '';
  clasificacionHacinamiento: string = '';

  // Paso 5: Antecedentes Personales Patológicos
  enfermedadesInfantiles: any = {};
  problemasVista: any = {};
  problemasAuditivos: any = {};
  observacionesPatologicos: string = '';
  enfermedades: any = {};
  cirugias: string = '';
  tieneCirugias: boolean = false;
  transfusiones: string = '';
  tieneTransfusiones: boolean = false;
  traumaticos: string = '';
  tieneTraumaticos: boolean = false;
  ingresosHospitalarios: string = '';
  tieneIngresosHospitalarios: boolean = false;

  // Paso 6: Antecedentes Gineco-Obstétricos
  ginecoObstetricos: any = {
    menarca: '',
    ciclo: '',
    fum: '',
    dismenorreaSi: false,
    ivsa: '',
    pSexuales: '',
    gesta: '',
    para: '',
    cesarea: '',
    abortos: '',
    mpf: '',
    fechaPap: '',
    resultado: '',
    observaciones: ''
  };

  // Paso 7: Exploración Física
  exploracionFisica: any = {
    peso: '',
    talla: '',
    imc: '',
    fc: '',
    fr: '',
    glucosa: '',
    taSistolica: '',
    taDiastolica: '',
    ta: '',
    satO2: '',
    temp: '',
    lateralidad: '',
    edadMetabolica: '',
    grasaCorporal: '',
    musculo: '',
    grasaVisceral: '',
    metabolismoBasal: '',
    observaciones: ''
  };

  organosSistemas: any[] = [
    { nombre: 'CABEZA Y CUELLO', descripcion: '', resultado: '', hallazgos: '' },
    { nombre: 'OJOS', descripcion: '(CONJUNTIVAS, CÓRNEAS, MOTILIDAD)', resultado: '', agudVisualOD: '', agudVisualOI: '', agudVisualConCorreccion: false, hallazgos: '' },
    { nombre: 'OÍDOS', descripcion: '(PABELLÓN, CONDUCTO AUDITIVO, TÍMPANO)', resultado: '', hallazgos: '' },
    { nombre: 'NARIZ', descripcion: '(CORNETES, TABIQUE, SENOS PARANASALES)', resultado: '', hallazgos: '' },
    { nombre: 'OROFARINGE', descripcion: '(AMÍGDALAS, MUCOSA, ÚVULA)', resultado: '', hallazgos: '' },
    { nombre: 'TÓRAX', descripcion: '(RUIDOS CARDÍACOS, VENTILACIÓN PULMONAR)', resultado: '', hallazgos: '' },
    { nombre: 'ABDOMEN', descripcion: '(PARED ABDOMINAL, VÍSCERAS, GIORDANO)', resultado: '', hallazgos: '' },
    { nombre: 'EXTREMIDADES', descripcion: '(FUERZA, EDEMA VASCULAR)', resultado: '', hallazgos: '' },
    { nombre: 'NEUROLÓGICO', descripcion: '(COLUMNA, MARCHA, PARESTESIAS)', resultado: '', romberg: '', hallazgos: '' },
    { nombre: 'PIEL', descripcion: '(CICATRICES, TATUAJES, DERMATITIS)', resultado: '', hallazgos: '' }
  ];

  // Paso 8: Paraclínicos
  paraclinicos: any = {
    teleTorax: '',
    columna: '',
    biometria: '',
    clinicaSanguinea: '',
    quimicaS: '',
    audiometria: '',
    espirometria: '',
    resultado: ''
  };

  // Paso 9: Diagnóstico y Tratamiento
  diagnosticos: any[] = [];
  observacionesDiagnostico: string = '';
  personalElaboroHistoria: string = '';
  cedulaProfesional: string = '';
  private ultimoDiagnosticosAutomaticos: Set<string> = new Set<string>();
  private ultimaFirmaObservacionesConsolidadas: string = '';
  private ginecoObservacionesManual: string = '';
  private readonly OBS_GINECO_DISMENORREA = 'Dismenorrea';
  private readonly OBS_GINECO_PAP = 'Realizar papanicolau cada 3 años';

  errores: { [key: string]: string } = {};
  intentoGuardar: boolean = false;

  // =====================================================
  // Campos obligatorios por paso (para validación parcial)
  // TODO: TESTING - se vaciaron los campos obligatorios para pruebas
  camposPorPaso: { [paso: number]: string[] } = {
    1: [],
    2: [], // Antecedentes laborales: validación por filas
    3: [], // Antecedentes heredo-familiares: checkboxes opcionales
    4: [], // Antecedentes no patológicos: opcionales
    5: [], // Antecedentes patológicos: opcionales
    6: [], // Antecedentes gineco-obstétricos: opcionales
    7: [], // Exploración física: opcionales
    8: [], // Paraclínicos: opcionales
    9: [] // Diagnóstico y tratamiento: opcionales
  };

  constructor(
    private authService: AuthService,
    private backendServices: BackendServices,
    private renderer: Renderer2,
    private elRef: ElementRef
  ) { }

  ngOnInit(): void {
    // Aplicar tema azul a toda la página (navbar, footer, contenido)
    this.mainContentEl = this.elRef.nativeElement.closest('.main-content');
    if (this.mainContentEl) {
      this.renderer.addClass(this.mainContentEl, 'doctor-theme');
    }
    this.inicializarFormulario();
    this.cargarDatosDoctor();
    this.cargarEmpresas();
    this.actualizarEstadoScrollPorVista();
  }

  ngDoCheck(): void {
    if (this.vistaActual !== this.ultimaVistaAplicadaScroll) {
      this.actualizarEstadoScrollPorVista();
    }

    this.sincronizarObservacionesDiagnosticoConsolidadas();
  }

  ngOnDestroy(): void {
    // Quitar el tema azul al salir de la página (solo si no es doctor)
    if (this.mainContentEl && !this.esDoctorPrincipal) {
      this.renderer.removeClass(this.mainContentEl, 'doctor-theme');
    }
    this.renderer.removeStyle(document.body, 'overflow');
    this.renderer.removeStyle(document.documentElement, 'overflow');
  }

  private actualizarEstadoScrollPorVista(): void {
    this.ultimaVistaAplicadaScroll = this.vistaActual;
    // Permitir scroll en todas las vistas para que el footer sea visible
    this.renderer.removeStyle(document.body, 'overflow');
    this.renderer.removeStyle(document.documentElement, 'overflow');
  }

  actualizarObservacionesDiagnosticoConsolidadas(): void {
    this.sincronizarObservacionesDiagnosticoConsolidadas(true);
  }

  private sincronizarObservacionesDiagnosticoConsolidadas(forzar: boolean = false): void {
    const firmaActual = this.obtenerFirmaObservacionesConsolidadas();
    if (!forzar && firmaActual === this.ultimaFirmaObservacionesConsolidadas) {
      return;
    }

    this.ultimaFirmaObservacionesConsolidadas = firmaActual;
    this.observacionesDiagnostico = this.construirObservacionesConsolidadas();
    this.ajustarAlturaObservacionesDiagnostico();
  }

  private obtenerFirmaObservacionesConsolidadas(): string {
    return JSON.stringify({
      laborales: this.observacionesLaborales || '',
      heredo: this.observacionesHeredoFamiliares || '',
      noPatologicos: this.observacionesNoPatologicos || '',
      patologicos: this.observacionesPatologicos || '',
      gineco: this.esGeneroFemenino ? (this.ginecoObstetricos?.observaciones || '') : '',
      exploracion: this.exploracionFisica?.observaciones || '',
      paraclinicos: this.paraclinicos?.resultado || ''
    });
  }

  private construirObservacionesConsolidadas(): string {
    const bloques = [
      { seccion: 'Antecedentes Laborales', valor: this.observacionesLaborales },
      { seccion: 'Antecedentes Heredo-Familiares', valor: this.observacionesHeredoFamiliares },
      { seccion: 'Antecedentes No Patológicos', valor: this.observacionesNoPatologicos },
      { seccion: 'Antecedentes Patológicos', valor: this.observacionesPatologicos },
      { seccion: 'Antecedentes Gineco-Obstétricos', valor: this.esGeneroFemenino ? this.ginecoObstetricos?.observaciones : '' },
      { seccion: 'Exploración Física', valor: this.exploracionFisica?.observaciones },
      { seccion: 'Paraclínicos', valor: this.paraclinicos?.resultado }
    ];

    return bloques
      .map((item) => ({
        seccion: item.seccion,
        valor: String(item.valor || '').trim().replace(/\r\n/g, '\n')
      }))
      .filter((item) => !!item.valor)
      .map((item) => `${item.seccion}: ${item.valor}`)
      .join('\n');
  }

  /**
   * Si el usuario es doctor, carga su nombre, cédula y firma desde el backend
   */
  private cargarDatosDoctor(): void {
    const rolPrincipal = this.authService.getRol()?.toLowerCase() || '';
    this.esDoctorPrincipal = rolPrincipal === 'doctor';
    this.esAdmin = this.authService.tieneAlgunRol(['administrador', 'root']);
    this.esDoctor = this.authService.tieneRol('doctor');

    const instructorIdSesion = this.authService.getInstructorId();

    if (this.esDoctor) {
      this.cargarPerfilDoctorPreferente(instructorIdSesion);
      return;
    }

    // Si el usuario es root o administrador, nunca será doctor — no hacer llamada extra.
    if (this.esAdmin || rolPrincipal === 'root' || rolPrincipal === 'administrador' || rolPrincipal === 'super_admin') {
      return;
    }

    // Fallback para sesiones antiguas donde el token no trae roles adicionales.
    const usuarioId = this.authService.getUsuarioId();
    if (!usuarioId) {
      return;
    }

    this.backendServices.obtenerUsuario(usuarioId).subscribe({
      next: (resp: any) => {
        const usuario = resp?.usuario;
        if (!usuario) return;

        const rolUsuario = String(usuario.rol || '').toLowerCase();
        const rolesAdicionales = String(usuario.roles_adicionales || '')
          .split(',')
          .map((r: string) => r.trim().toLowerCase())
          .filter(Boolean);

        const esDoctorPorDB = rolUsuario === 'doctor' || rolesAdicionales.includes('doctor');
        if (!esDoctorPorDB) {
          return;
        }

        this.esDoctor = true;
        const instructorIdDB = Number(usuario.instructor_id || 0) || null;
        this.cargarPerfilDoctorPreferente(instructorIdDB || instructorIdSesion);
      },
      error: () => {
        // Silenciar — si falla, el usuario simplemente no es doctor.
      }
    });
  }

  private cargarPerfilDoctorPreferente(instructorId: number | null): void {
    this.backendServices.obtenerPerfilDoctor().subscribe({
      next: (resp: any) => {
        if (resp?.success && resp.instructor) {
          this.aplicarDatosDoctor(resp.instructor);
          return;
        }
        this.cargarDatosDoctorPorInstructor(instructorId);
      },
      error: (err) => {
        // Permite compatibilidad con APIs que aún no tienen /doctor/perfil.
        console.warn('No se pudo cargar /doctor/perfil, se intentará fallback por instructor.', err);
        this.cargarDatosDoctorPorInstructor(instructorId);
      }
    });
  }

  private cargarDatosDoctorPorInstructor(instructorId: number | null): void {
    if (!instructorId) {
      return;
    }

    this.backendServices.obtenerInstructor(instructorId).subscribe({
      next: (resp: any) => {
        if (resp?.success && resp.instructor) {
          this.aplicarDatosDoctor(resp.instructor);
        }
      },
      error: (err) => {
        console.error('Error al cargar datos del doctor por instructor_id:', err);
      }
    });
  }

  private aplicarDatosDoctor(instructor: any): void {
    this.datosDoctor = instructor;

    // Auto-llenar nombre y cédula (quitar prefijo "Dr." si existe, la plantilla ya lo añade)
    let nombre = [
      instructor?.nombre,
      instructor?.apellido_paterno || instructor?.apellido,
      instructor?.apellido_materno
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/^Dr\.?\s*/i, '')
      .trim();

    if (!nombre) {
      nombre = this.authService.getNombreCompleto().replace(/^Dr\.?\s*/i, '').trim();
    }

    this.personalElaboroHistoria = nombre;
    this.cedulaProfesional = instructor?.cedula_profesional || '';
    this.firmaUrlDoctor = instructor?.firma_url ? this.convertirFirmaAProxy(instructor.firma_url) : '';
  }

  // =====================================================
  // EMPRESAS - Cargar, filtrar y seleccionar
  // =====================================================

  cargarEmpresas(): void {
    this.cargandoEmpresas = true;
    this.backendServices.obtenerEmpresasExpedientes().subscribe({
      next: (resp: any) => {
        if (resp.success) {
          const empresasExpedientes = Array.isArray(resp.empresas) ? resp.empresas : [];
          this.backendServices.obtenerEmpresas().subscribe({
            next: (catalogoResp: any) => {
              const catalogoEmpresas = catalogoResp?.success && Array.isArray(catalogoResp.empresas)
                ? catalogoResp.empresas
                : [];

              this.empresas = this.combinarEmpresasConCatalogo(empresasExpedientes, catalogoEmpresas);
              this.empresasFiltradas = [...this.empresas];
              this.extraerEstadosEmpresa();
              this.cargandoEmpresas = false;
            },
            error: () => {
              this.empresas = this.combinarEmpresasConCatalogo(empresasExpedientes, []);
              this.empresasFiltradas = [...this.empresas];
              this.extraerEstadosEmpresa();
              this.cargandoEmpresas = false;
            }
          });
          return;
        }
        this.cargandoEmpresas = false;
      },
      error: () => {
        this.cargandoEmpresas = false;
        // Fallback: cargar empresas normales
        this.backendServices.obtenerEmpresas().subscribe({
          next: (resp: any) => {
            if (resp.success) {
              this.empresas = resp.empresas.map((e: any) => ({
                empresa_id: e.empresa_id,
                nombre_empresa: e.nombre_empresa,
                rfc: e.rfc,
                logo: e.logo || e.logo_url || null,
                logo_url: e.logo_url || e.logo || null,
                estado: e.estado || '',
                ciudad: e.ciudad || '',
                historias_totales: 0
              }));
              this.empresasFiltradas = [...this.empresas];
              this.extraerEstadosEmpresa();
            }
          }
        });
      }
    });
  }

  private combinarEmpresasConCatalogo(empresasExpedientes: any[], catalogoEmpresas: any[]): any[] {
    const catalogoPorId = new Map<number, any>();

    catalogoEmpresas.forEach((empresa) => {
      if (empresa?.empresa_id) {
        catalogoPorId.set(empresa.empresa_id, empresa);
      }
    });

    return empresasExpedientes.map((empresaExpediente: any) => {
      const empresaCatalogo = catalogoPorId.get(empresaExpediente.empresa_id) || {};
      const logo = empresaExpediente.logo || empresaExpediente.logo_url || empresaCatalogo.logo || empresaCatalogo.logo_url || null;

      return {
        ...empresaCatalogo,
        ...empresaExpediente,
        estado: empresaExpediente.estado || empresaCatalogo.estado || '',
        ciudad: empresaExpediente.ciudad || empresaCatalogo.ciudad || '',
        logo,
        logo_url: empresaExpediente.logo_url || empresaExpediente.logo || empresaCatalogo.logo_url || empresaCatalogo.logo || null
      };
    });
  }

  extraerEstadosEmpresa(): void {
    const set = new Set<string>();
    this.empresas.forEach(e => {
      if (e.estado && e.estado.trim()) set.add(e.estado.trim());
    });
    this.estadosEmpresa = Array.from(set).sort();
  }

  filtrarEmpresas(): void {
    let resultado = [...this.empresas];
    if (this.textoBusquedaEmpresa && this.textoBusquedaEmpresa.trim()) {
      const texto = this.textoBusquedaEmpresa.toLowerCase().trim();
      resultado = resultado.filter(e =>
        e.nombre_empresa.toLowerCase().includes(texto) ||
        e.rfc.toLowerCase().includes(texto)
      );
    }
    if (this.estadoSeleccionadoEmpresa && this.estadoSeleccionadoEmpresa.trim()) {
      resultado = resultado.filter(e =>
        e.estado && e.estado.trim().toLowerCase() === this.estadoSeleccionadoEmpresa.trim().toLowerCase()
      );
    }
    if (this.municipioSeleccionadoEmpresa && this.municipioSeleccionadoEmpresa.trim()) {
      resultado = resultado.filter(e =>
        e.ciudad && e.ciudad.trim().toLowerCase() === this.municipioSeleccionadoEmpresa.trim().toLowerCase()
      );
    }
    this.empresasFiltradas = resultado;
  }

  onEstadoEmpresaChange(): void {
    if (this.estadoSeleccionadoEmpresa) {
      const set = new Set<string>();
      this.empresas.forEach(e => {
        if (e.estado && e.estado.trim().toLowerCase() === this.estadoSeleccionadoEmpresa.trim().toLowerCase()
          && e.ciudad && e.ciudad.trim()) {
          set.add(e.ciudad.trim());
        }
      });
      this.municipiosEmpresa = Array.from(set).sort();
      if (this.municipioSeleccionadoEmpresa && !this.municipiosEmpresa.some(m => m.toLowerCase() === this.municipioSeleccionadoEmpresa.toLowerCase())) {
        this.municipioSeleccionadoEmpresa = '';
      }
    } else {
      this.municipiosEmpresa = [];
      this.municipioSeleccionadoEmpresa = '';
    }
    this.filtrarEmpresas();
  }

  limpiarFiltrosEmpresas(): void {
    this.textoBusquedaEmpresa = '';
    this.estadoSeleccionadoEmpresa = '';
    this.municipioSeleccionadoEmpresa = '';
    this.municipiosEmpresa = [];
    this.filtrarEmpresas();
  }

  seleccionarEmpresa(empresa: any): void {
    this.empresaSeleccionada = empresa;
    this.vistaActual = 'menu';
  }

  volverAEmpresas(): void {
    this.vistaActual = 'empresas';
    this.empresaSeleccionada = null;
    this.cargarEmpresas();
  }

  // =====================================================
  // ESTADÍSTICAS
  // =====================================================


  getInicialesEmpresa(nombre: string): string {
    if (!nombre) return '??';
    const palabras = nombre.split(' ');
    if (palabras.length >= 2) {
      return (palabras[0][0] + palabras[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  getColorAvatarEmpresa(index: number): string {
    const colores = ['bg-gradient-success', 'bg-gradient-info', 'bg-gradient-primary', 'bg-gradient-warning', 'bg-gradient-danger'];
    return colores[index % colores.length];
  }

  getLogoEmpresaUrl(empresa: any = this.empresaSeleccionada): string | null {
    if (!empresa) {
      return null;
    }

    return this.backendServices.resolverUrlDrivePreview(empresa.logo || empresa.logo_url || null);
  }

  onLogoEmpresaError(empresa: any = this.empresaSeleccionada): void {
    if (!empresa) {
      return;
    }

    empresa.logo = null;
    empresa.logo_url = null;
  }

  // =====================================================
  // GETTERS PARA NAVEGACIÓN
  // =====================================================

  get totalPasos(): number {
    return this.pasos.length;
  }

  get esUltimoPaso(): boolean {
    return this.pasoActual === this.totalPasos;
  }

  get progresoPorcentaje(): number {
    if (this.totalPasos <= 1) return 100;
    return ((this.pasoActual - 1) / (this.totalPasos - 1)) * 100;
  }

  // Calcular promedio de sueño automáticamente
  calcularPromedioSueno(): void {
    const min = parseFloat(this.sueno.minimo);
    const max = parseFloat(this.sueno.maximo);
    if (!isNaN(min) && !isNaN(max) && min > 0 && max > 0) {
      this.sueno.promedio = ((min + max) / 2).toFixed(1);
    } else {
      this.sueno.promedio = '';
    }
  }

  // Calcular IMC automáticamente
  calcularIMC(): void {
    const peso = parseFloat(this.exploracionFisica.peso);
    const tallaCm = parseFloat(this.exploracionFisica.talla);

    if (peso > 0 && tallaCm > 0) {
      const tallaM = tallaCm / 100;
      const imc = peso / (tallaM * tallaM);
      this.exploracionFisica.imc = imc.toFixed(2);
      this.aplicarCategoriasIMC(imc);
    } else {
      this.exploracionFisica.imc = '';
      if (this.pasoActual === this.pasoDiagnostico) {
        this.sincronizarDiagnosticosAutomaticos();
      }
    }
  }

  private aplicarCategoriasIMC(_imc: number): void {
    if (this.pasoActual === this.pasoDiagnostico) {
      this.sincronizarDiagnosticosAutomaticos();
    }
  }

  onPresionArterialChange(): void {
    this.actualizarTensionArterialCompuesta();
    this.sincronizarDiagnosticosAutomaticos();
  }

  obtenerCategoriaPresionSistolicaTexto(): string {
    const sistolica = this.obtenerPresionSistolicaNumerica();
    return this.obtenerCategoriaPresionPorSistolica(sistolica);
  }

  obtenerLecturaTensionArterialTexto(): string {
    const sistolica = this.obtenerPresionSistolicaNumerica();
    const diastolica = this.obtenerPresionDiastolicaNumerica();

    if (sistolica !== null && diastolica !== null) {
      return `${sistolica}/${diastolica}`;
    }

    if (sistolica !== null) {
      return `${sistolica}`;
    }

    return String(this.exploracionFisica.ta || '').trim();
  }

  private actualizarTensionArterialCompuesta(): void {
    const lectura = this.obtenerLecturaTensionArterial();

    if (lectura) {
      this.exploracionFisica.ta = `${lectura.pas}/${lectura.pad}`;
      return;
    }

    const sistolicaCapturada = this.extraerNumeroDesdeTexto(this.exploracionFisica.taSistolica);
    this.exploracionFisica.ta = sistolicaCapturada !== null ? `${Math.round(sistolicaCapturada)}` : '';
  }

  // Textos por defecto cuando el resultado es "Normal" para cada órgano/sistema
  private hallazgosNormales: { [index: number]: string } = {
    0: 'Normocefalo, cuello cilindrico sin megalias palpables, traque central desplazable, completa arcos de movilidad',
    1: 'Agudeza Visual, O.D: 20/20, O.I:20/20, Pupilas isocoricas y normoreflecticas',
    2: 'Pabellones auriculares normales, conductos auditivos permeables, membrana timpanica integra, sin abombamiento',
    3: 'Tabique nasal central, no descarga retronasal, mucosa normocromica, no dolor a la palpacion de senos maxilares, etmoidales y frontales',
    4: 'Faringe normocromica, no hipertrofia de amigdalas, uvula central, mucosa oral hidratada',
    5: 'Normolineo, ruidos pulmonares normales sin integrar sindrome pleuropulmonar, precordio ritmico con adecuada frecuencia',
    6: 'Sin masas visibles o palpables, blando, depresible, no doloroso, peristalesis presente y normal, matidez generalizada, rebote negativo, no datos de irritación peritoneal',
    7: 'Eutroficas, reflejos de estiramiento muscular normales, fuerza 5/5 según danies, no datos de compromiso neurovascular distal, llenado capilar inmediato',
    8: 'Glasgow 15 puntos, funciones mentales superiores conservadas, sin datos de liberacion piramidal',
    9: 'Adecuado estado de hidratacion, sin evidencia de dermatitis en zonas visibles'
  };

  onResultadoOrganoChange(index: number): void {
    if (this.organosSistemas[index].resultado === 'Normal') {
      this.organosSistemas[index].hallazgos = this.hallazgosNormales[index] || '';
      // Auto-fill special fields for specific organs
      if (index === 1) {
        this.organosSistemas[1].agudVisualOD = '20/20';
        this.organosSistemas[1].agudVisualOI = '20/20';
        this.organosSistemas[1].agudVisualConCorreccion = false;
      }
      if (index === 8) {
        this.organosSistemas[8].romberg = 'Negativo';
      }
    } else if (this.organosSistemas[index].resultado === 'Anormal') {
      this.organosSistemas[index].hallazgos = '';
      if (index === 1) {
        this.organosSistemas[1].agudVisualOD = '';
        this.organosSistemas[1].agudVisualOI = '';
        this.organosSistemas[1].agudVisualConCorreccion = false;
      }
      if (index === 8) {
        this.organosSistemas[8].romberg = '';
      }
    }
  }

  inicializarFormulario(): void {
    this.formulario = {
      tipoHistoria: 'ingreso',
      fechaElaboracion: new Date().toISOString().split('T')[0],
      matricula: '',
      area: '',
      nombre: '',
      genero: '',
      religion: '',
      escolaridad: '',
      estadoCivil: '',
      edad: '',
      lugarNacimiento: '',
      telefono: '',
      domicilio: '',
      contactoEmergenciaNombre: '',
      contactoEmergenciaTelefono: '',
    };
    this.errores = {};
    this.intentoGuardar = false;
    this.observacionesLaborales = '';
    this.antecedentesLaborales = [];
    this.agregarFilaLaboral();
    this.diagnosticos = [];
    this.agregarDiagnostico();
    this.ultimoDiagnosticosAutomaticos.clear();
    this.observacionesDiagnostico = '';
    this.personalElaboroHistoria = '';
    this.cedulaProfesional = '';
    // Si es doctor, re-llenar con sus datos
    if (this.esDoctor && this.datosDoctor) {
      const nombre = [this.datosDoctor.nombre, this.datosDoctor.apellido_paterno, this.datosDoctor.apellido_materno].filter(Boolean).join(' ').replace(/^Dr\.?\s*/i, '');
      this.personalElaboroHistoria = nombre;
      this.cedulaProfesional = this.datosDoctor.cedula_profesional || '';
    }
    this.observacionesHeredoFamiliares = '';
    this.heredoFamiliares = {
      diabetes: false,
      hipertension: false,
      cancer: false,
      cardiacos: false,
      asma: false,
      alergias: false,
      renales: false,
      convulsiones: false,
      auditivas: false,
      visuales: false
    };
    this.heredoFamiliaresMadre = '';
    this.heredoFamiliaresPadre = '';
    this.tabaquismo = {
      fumo: false,
      fuma: false,
      negado: false,
      cigarros: '',
      intervaloTiempo: '',
      exposicion: ''
    };
    this.indiceTabaquico = '';
    this.alcoholismo = {
      bebio: false,
      bebe: false,
      negado: false,
      unaVez: '',
      tipo: '',
      intervaloTiempo: ''
    };
    this.otrasDrogas = {
      consumio: false,
      consume: false,
      negado: false,
      tipo: '',
      intervaloTiempo: ''
    };
    this.ejercicio = {
      realiza: false,
      tipo: '',
      horasDiaMinutosSemana: '',
      alcanzaRecomendacion: '',
      tiempoPracticarlo: ''
    };
    this.sueno = {
      minimo: '',
      maximo: '',
      promedio: ''
    };
    this.actividadesTiempoLibre = '';
    this.tipoSanguineo = '';
    this.vacunas = {
      sarampion: false,
      rubeola: false,
      influenza: false,
      toxoideTetanico: false,
      covid: false,
      otras: ''
    };
    this.habitosHigiene = {
      banoDiario: '',
      aseoBucal: '',
      comidasAlDia: '',
      desparasitacion: false,
      hacinamiento: false,
      promiscuidad: false,
      zoonosis: false,
      zoonosisAnimal: '',
      perforaciones: false,
      perforacionesZonas: '',
      dormitorios: '',
      habitantes: '',
      psUltimos6Meses: '',
      observacionesVivienda: ''
    };
    this.tatuajes = {
      tiene: false,
      negado: false,
      zona: ''
    };
    this.observacionesNoPatologicos = '';
    this.indiceHacinamiento = '';
    this.clasificacionHacinamiento = '';

    // Paso 5: Antecedentes Patológicos
    this.enfermedadesInfantiles = {
      sarampion: false,
      rubeola: false,
      varicela: false,
      parotiditis: false,
      hepatitis: false,
      covid: false,
      influenza: false,
      otra: ''
    };
    this.problemasVista = {
      tiene: false,
      cual: '',
      usoLentes: false,
      negado: false
    };
    this.problemasAuditivos = {
      tiene: false,
      cual: '',
      usoAudifonos: false,
      negado: false
    };
    this.observacionesPatologicos = '';
    this.enfermedades = {
      congenitas: { tiene: false, cual: '' },
      dentales: { tiene: false, cual: '' },
      endocrinas: { tiene: false, cual: '' },
      pulmonares: { tiene: false, cual: '' },
      cardiovasculares: { tiene: false, cual: '' },
      digestivas: { tiene: false, cual: '' },
      urinarias: { tiene: false, cual: '' },
      musculoEsqueleticas: { tiene: false, cual: '' },
      dermatologicas: { tiene: false, cual: '' },
      infectoContagiosas: { tiene: false, cual: '' },
      psiquiatricas: { tiene: false, cual: '' },
      otrasEnfermedades: { tiene: false, cual: '' },
      alergias: { tiene: false, cual: '' }
    };
    this.cirugias = '';
    this.tieneCirugias = false;
    this.transfusiones = '';
    this.tieneTransfusiones = false;
    this.traumaticos = '';
    this.tieneTraumaticos = false;
    this.ingresosHospitalarios = '';
    this.tieneIngresosHospitalarios = false;

    this.ginecoObstetricos = {
      menarca: '',
      ciclo: '',
      fum: '',
      dismenorreaSi: false,
      ivsa: '',
      pSexuales: '',
      gesta: '',
      para: '',
      cesarea: '',
      abortos: '',
      mpf: '',
      fechaPap: '',
      resultado: '',
      observaciones: ''
    };
    this.ginecoObservacionesManual = '';

    this.exploracionFisica = {
      peso: '',
      talla: '',
      imc: '',
      fc: '',
      fr: '',
      glucosa: '',
      taSistolica: '',
      taDiastolica: '',
      ta: '',
      satO2: '',
      temp: '',
      lateralidad: '',
      edadMetabolica: '',
      grasaCorporal: '',
      musculo: '',
      grasaVisceral: '',
      metabolismoBasal: '',
      observaciones: ''
    };

    this.paraclinicos = {
      teleTorax: '',
      columna: '',
      biometria: '',
      clinicaSanguinea: '',
      quimicaS: '',
      audiometria: '',
      espirometria: '',
      resultado: ''
    };

    // Reset órganos/sistema con valores por defecto (Normal)
    this.organosSistemas = [
      { nombre: 'CABEZA Y CUELLO', descripcion: '', resultado: 'Normal', hallazgos: this.hallazgosNormales[0] },
      { nombre: 'OJOS', descripcion: '(CONJUNTIVAS, CÓRNEAS, MOTILIDAD)', resultado: 'Normal', agudVisualOD: '20/20', agudVisualOI: '20/20', agudVisualConCorreccion: false, hallazgos: this.hallazgosNormales[1] },
      { nombre: 'OÍDOS', descripcion: '(PABELLÓN, CONDUCTO AUDITIVO, TÍMPANO)', resultado: 'Normal', hallazgos: this.hallazgosNormales[2] },
      { nombre: 'NARIZ', descripcion: '(CORNETES, TABIQUE, SENOS PARANASALES)', resultado: 'Normal', hallazgos: this.hallazgosNormales[3] },
      { nombre: 'OROFARINGE', descripcion: '(AMÍGDALAS, MUCOSA, ÚVULA)', resultado: 'Normal', hallazgos: this.hallazgosNormales[4] },
      { nombre: 'TÓRAX', descripcion: '(RUIDOS CARDÍACOS, VENTILACIÓN PULMONAR)', resultado: 'Normal', hallazgos: this.hallazgosNormales[5] },
      { nombre: 'ABDOMEN', descripcion: '(PARED ABDOMINAL, VÍSCERAS, GIORDANO)', resultado: 'Normal', hallazgos: this.hallazgosNormales[6] },
      { nombre: 'EXTREMIDADES', descripcion: '(FUERZA, EDEMA VASCULAR)', resultado: 'Normal', hallazgos: this.hallazgosNormales[7] },
      { nombre: 'NEUROLÓGICO', descripcion: '(COLUMNA, MARCHA, PARESTESIAS)', resultado: 'Normal', romberg: 'Negativo', hallazgos: this.hallazgosNormales[8] },
      { nombre: 'PIEL', descripcion: '(CICATRICES, TATUAJES, DERMATITIS)', resultado: 'Normal', hallazgos: this.hallazgosNormales[9] }
    ];

    this.sincronizarObservacionesDiagnosticoConsolidadas(true);
  }

  // =====================================================
  // ANTECEDENTES LABORALES
  // =====================================================

  agregarFilaLaboral(): void {
    this.antecedentesLaborales.push({
      empresa: '',
      puesto: '',
      tiempo: '',
      eppVisual: false,
      eppAuditivo: false,
      eppRespiratorio: false,
      eppNoAplica: false,
      enfermedadTrabajo: '',
      accidenteTrabajo: ''
    });
  }

  onEppLaboralChange(fila: any, tipo: 'visual' | 'auditivo' | 'respiratorio' | 'noAplica'): void {
    if (tipo === 'noAplica' && fila.eppNoAplica) {
      fila.eppVisual = false;
      fila.eppAuditivo = false;
      fila.eppRespiratorio = false;
      return;
    }

    if (tipo !== 'noAplica' && (fila.eppVisual || fila.eppAuditivo || fila.eppRespiratorio)) {
      fila.eppNoAplica = false;
    }
  }

  onGinecoObservacionesChange(valor: string): void {
    this.ginecoObservacionesManual = this.extraerObservacionesGinecoManualesDesde(valor);
    this.actualizarObservacionesDiagnosticoConsolidadas();
  }

  actualizarObservacionesGinecoObstetricos(): void {
    const auto: string[] = [];
    if (this.ginecoObstetricos?.dismenorreaSi) {
      auto.push(this.OBS_GINECO_DISMENORREA);
    }
    if (this.requierePapanicolau()) {
      auto.push(this.OBS_GINECO_PAP);
    }

    const partes = [...auto];
    const manual = String(this.ginecoObservacionesManual || '').trim();
    if (manual) {
      partes.push(manual);
    }

    this.ginecoObstetricos.observaciones = partes.join('. ');
    this.actualizarObservacionesDiagnosticoConsolidadas();
  }

  private requierePapanicolau(): boolean {
    const fechaPap = String(this.ginecoObstetricos?.fechaPap || '').trim();
    if (!fechaPap) {
      return true;
    }

    const fecha = new Date(`${fechaPap}T00:00:00`);
    if (Number.isNaN(fecha.getTime())) {
      return true;
    }

    const hoy = new Date();
    const diffAnios = (hoy.getTime() - fecha.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return diffAnios > 3;
  }

  private extraerObservacionesGinecoManualesDesde(valor: string): string {
    let texto = String(valor || '').trim();
    [this.OBS_GINECO_DISMENORREA, this.OBS_GINECO_PAP].forEach((fragmento) => {
      texto = texto
        .replace(new RegExp(`\\b${fragmento.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\.?`, 'gi'), '')
        .replace(/\s*\.\s*\./g, '.')
        .trim();
    });

    return texto.replace(/^\.+|\.\s*$/g, '').trim();
  }

  eliminarFilaLaboral(index: number): void {
    if (this.antecedentesLaborales.length > 1) {
      this.antecedentesLaborales.splice(index, 1);
    }
  }

  onNegadoTabaquismoChange(): void {
    this.tabaquismo.negado = !!this.tabaquismo.negado;

    if (this.tabaquismo.negado) {
      this.tabaquismo.fumo = false;
      this.tabaquismo.fuma = false;
      this.tabaquismo.exposicion = 'NEGADO';
    } else if (this.normalizarTexto(this.tabaquismo.exposicion) === 'negado') {
      this.tabaquismo.exposicion = '';
    }

    this.actualizarIndiceTabaquicoDesdeFormulario();
  }

  actualizarIndiceTabaquicoDesdeFormulario(): void {
    if (this.tabaquismo?.negado) {
      this.indiceTabaquico = '';
    } else {
      const indiceCalculado = this.calcularIndiceTabaquicoDesdeHabito();
      this.indiceTabaquico = indiceCalculado !== null ? this.formatearNumero(indiceCalculado, 2) : '';
    }

    if (this.pasoActual === this.pasoDiagnostico) {
      this.sincronizarDiagnosticosAutomaticos();
    }
  }

  onNegadoAlcoholismoChange(): void {
    this.alcoholismo.negado = !!this.alcoholismo.negado;

    if (this.alcoholismo.negado) {
      this.alcoholismo.bebio = false;
      this.alcoholismo.bebe = false;
      this.alcoholismo.unaVez = '';
      this.alcoholismo.tipo = '';
      this.alcoholismo.intervaloTiempo = '';
    }
  }

  onNegadoOtrasDrogasChange(): void {
    this.otrasDrogas.negado = !!this.otrasDrogas.negado;

    if (this.otrasDrogas.negado) {
      this.otrasDrogas.consumio = false;
      this.otrasDrogas.consume = false;
      this.otrasDrogas.tipo = '';
      this.otrasDrogas.intervaloTiempo = '';
    }
  }

  onNegadoTatuajesChange(): void {
    this.tatuajes.negado = !!this.tatuajes.negado;

    if (this.tatuajes.negado) {
      this.tatuajes.tiene = false;
      this.tatuajes.zona = '';
    }
  }

  onTieneTatuajesChange(): void {
    this.tatuajes.tiene = !!this.tatuajes.tiene;

    if (this.tatuajes.tiene && this.tatuajes.negado) {
      this.tatuajes.negado = false;
    }
  }

  onNegadoProblemasVistaChange(): void {
    this.problemasVista.negado = !!this.problemasVista.negado;

    if (this.problemasVista.negado) {
      this.problemasVista.tiene = false;
      this.problemasVista.usoLentes = false;
      this.problemasVista.cual = '';
    }
  }

  onNegadoProblemasAuditivosChange(): void {
    this.problemasAuditivos.negado = !!this.problemasAuditivos.negado;

    if (this.problemasAuditivos.negado) {
      this.problemasAuditivos.tiene = false;
      this.problemasAuditivos.usoAudifonos = false;
      this.problemasAuditivos.cual = '';
    }
  }

  onTipoSanguineoChange(valorTipoSanguineo?: string): void {
    const tipoSeleccionado = this.normalizarTexto(valorTipoSanguineo ?? this.tipoSanguineo);
    const recomendacion = 'Se recomienda realizar análisis de sangre para determinar el tipo sanguíneo.';
    const observacionesActuales = String(this.observacionesNoPatologicos || '').trim();

    if (tipoSeleccionado !== 'desconoce') {
      if (!observacionesActuales) {
        return;
      }

      const recomendacionNormalizada = this.normalizarTexto(recomendacion);
      const lineasFiltradas = observacionesActuales
        .split(/\r?\n/)
        .map((linea) => linea.trim())
        .filter((linea) => !!linea && this.normalizarTexto(linea) !== recomendacionNormalizada);

      this.observacionesNoPatologicos = lineasFiltradas.join('\n');
      return;
    }

    if (!observacionesActuales) {
      this.observacionesNoPatologicos = recomendacion;
      return;
    }

    const recomendacionNormalizada = this.normalizarTexto(recomendacion);
    const yaIncluida = this.normalizarTexto(observacionesActuales).includes(recomendacionNormalizada);

    if (!yaIncluida) {
      this.observacionesNoPatologicos = `${observacionesActuales}\n${recomendacion}`;
    }
  }

  actualizarIndiceHacinamientoVivienda(): void {
    const dormitorios = this.extraerNumeroDesdeTexto(this.habitosHigiene?.dormitorios);
    const habitantes = this.extraerNumeroDesdeTexto(this.habitosHigiene?.habitantes);

    if (dormitorios === null || habitantes === null || dormitorios <= 0 || habitantes < 0) {
      this.indiceHacinamiento = '';
      this.clasificacionHacinamiento = '';
      this.habitosHigiene.hacinamiento = false;
      this.actualizarObservacionHacinamiento('');
      return;
    }

    const indice = habitantes / dormitorios;
    this.indiceHacinamiento = this.formatearNumero(indice, 2);

    if (indice <= 2.4) {
      this.clasificacionHacinamiento = 'Sin hacinamiento';
      this.habitosHigiene.hacinamiento = false;
      this.actualizarObservacionHacinamiento('');
      return;
    }

    if (indice <= 4.9) {
      this.clasificacionHacinamiento = 'Hacinamiento medio';
      this.habitosHigiene.hacinamiento = true;
      this.actualizarObservacionHacinamiento(
        `Índice de hacinamiento: ${this.indiceHacinamiento} | Clasificación: ${this.clasificacionHacinamiento}`
      );
      return;
    }

    this.clasificacionHacinamiento = 'Hacinamiento crítico';
    this.habitosHigiene.hacinamiento = true;
    this.actualizarObservacionHacinamiento(
      `Índice de hacinamiento: ${this.indiceHacinamiento} | Clasificación: ${this.clasificacionHacinamiento}`
    );
  }

  private actualizarObservacionHacinamiento(observacionAutomatica: string): void {
    const observacionesActuales = String(this.observacionesNoPatologicos || '').trim();
    const lineas = observacionesActuales
      ? observacionesActuales.split(/\r?\n/).map((linea) => linea.trim()).filter(Boolean)
      : [];

    const lineasSinHacinamiento = lineas.filter((linea) => {
      const lineaNormalizada = this.normalizarTexto(linea);
      return !lineaNormalizada.startsWith(this.normalizarTexto('Índice de hacinamiento:'))
        && lineaNormalizada !== this.normalizarTexto('Se detecta hacinamiento medio en la vivienda.')
        && lineaNormalizada !== this.normalizarTexto('Se detecta hacinamiento crítico en la vivienda.')
        && lineaNormalizada !== this.normalizarTexto('Se detecta hacinamiento critico en la vivienda.');
    });

    if (observacionAutomatica) {
      const observacionNormalizada = this.normalizarTexto(observacionAutomatica);
      const yaExiste = lineasSinHacinamiento
        .some((linea) => this.normalizarTexto(linea) === observacionNormalizada);

      if (!yaExiste) {
        lineasSinHacinamiento.push(observacionAutomatica);
      }
    }

    this.observacionesNoPatologicos = lineasSinHacinamiento.join('\n');
  }

  onVacunasChange(): void {
    this.sincronizarDiagnosticosAutomaticos();
  }

  actualizarPromiscuidadDesdePSUltimos6Meses(): void {
    const parejasSexuales = this.extraerNumeroDesdeTexto(this.habitosHigiene?.psUltimos6Meses);
    this.habitosHigiene.promiscuidad = parejasSexuales !== null && parejasSexuales > 2;
  }

  actualizarRecomendacionEjercicio(valorMinutosSemana?: any): void {
    const minutosSemana = this.obtenerMinutosSemana(valorMinutosSemana ?? this.ejercicio?.horasDiaMinutosSemana);

    if (minutosSemana === null) {
      this.ejercicio.alcanzaRecomendacion = '';
      return;
    }

    this.ejercicio.alcanzaRecomendacion = minutosSemana >= 150 ? 'Sí' : 'No';
  }

  private obtenerMinutosSemana(valor: any): number | null {
    if (valor === null || valor === undefined) return null;

    const texto = String(valor).trim();
    if (!texto) return null;

    const textoNormalizado = this.normalizarTexto(texto).replace(',', '.');
    const numeros = textoNormalizado.match(/\d+(\.\d+)?/g);
    if (!numeros || !numeros.length) return null;

    // Compatibilidad con datos legacy como "2 hrs / 240 min".
    const minutos = Number(numeros[numeros.length - 1]);
    return Number.isFinite(minutos) ? minutos : null;
  }

  private aplicarDefaultsAntecedentesLaboralesSiVacio(): void {
    const filas = Array.isArray(this.antecedentesLaborales) ? this.antecedentesLaborales : [];

    const hayContenidoEnFilas = filas.some((fila: any) =>
      !!String(fila?.empresa || '').trim() ||
      !!String(fila?.puesto || '').trim() ||
      !!String(fila?.tiempo || '').trim() ||
      !!String(fila?.enfermedadTrabajo || '').trim() ||
      !!String(fila?.accidenteTrabajo || '').trim() ||
      !!fila?.eppVisual ||
      !!fila?.eppAuditivo ||
      !!fila?.eppRespiratorio ||
      !!fila?.eppNoAplica
    );

    const hayObservaciones = !!String(this.observacionesLaborales || '').trim();

    if (hayContenidoEnFilas || hayObservaciones) {
      return;
    }

    if (!this.antecedentesLaborales.length) {
      this.agregarFilaLaboral();
    }

    if (!String(this.observacionesLaborales || '').trim()) {
      this.observacionesLaborales = 'Interrogados y negados';
    }

    const primeraFila = this.antecedentesLaborales[0];
    if (primeraFila && !String(primeraFila.empresa || '').trim()) {
      primeraFila.empresa = 'No';
    }
  }

  // =====================================================
  // DIAGNÓSTICOS
  // =====================================================

  agregarDiagnostico(): void {
    this.diagnosticos.push({ diagnostico: '', recomendacion: '' });
    this.ajustarAlturaDiagnosticos();
  }

  eliminarDiagnostico(index: number): void {
    if (this.diagnosticos.length > 1) {
      this.diagnosticos.splice(index, 1);
      this.ajustarAlturaDiagnosticos();
    }
  }

  autoResize(event: any): void {
    const textarea = event.target;
    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  private ajustarAlturaObservacionesDiagnostico(): void {
    setTimeout(() => {
      const textarea = this.elRef.nativeElement.querySelector('textarea.observaciones-diagnostico-consolidado') as HTMLTextAreaElement | null;
      if (!textarea) {
        return;
      }

      textarea.style.height = 'auto';
      textarea.style.overflowY = 'hidden';
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }

  private ajustarAlturaDiagnosticos(): void {
    setTimeout(() => {
      const textareas = this.elRef.nativeElement.querySelectorAll('textarea.diagnostico-textarea') as NodeListOf<HTMLTextAreaElement>;
      textareas.forEach((textarea) => {
        textarea.style.height = 'auto';
        textarea.style.overflowY = 'hidden';
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    });
  }

  private sincronizarDiagnosticosAutomaticos(): void {
    const diagnosticosAutomaticos = this.construirDiagnosticosAutomaticos();
    const clavesAutomaticasActuales = new Set<string>(
      diagnosticosAutomaticos
        .map((item) => this.obtenerClaveDiagnostico(item))
        .filter((clave): clave is string => !!clave)
    );

    const diagnosticosExistentes = this.diagnosticos
      .filter((item: any) => this.tieneContenidoDiagnostico(item))
      .map((item: any) => ({
        diagnostico: (item.diagnostico || '').trim(),
        recomendacion: (item.recomendacion || '').trim()
      }))
      .filter((item) => {
        const clave = this.obtenerClaveDiagnostico(item);
        if (!clave) return false;

        const eraAutomatico = this.ultimoDiagnosticosAutomaticos.has(clave);
        const sigueAutomatico = clavesAutomaticasActuales.has(clave);

        // Descarta automáticos obsoletos cuando ya no aplican en el formulario.
        return !(eraAutomatico && !sigueAutomatico);
      });

    const combinados: Array<{ diagnostico: string; recomendacion: string }> = [];
    const indicePorClave = new Map<string, number>();

    diagnosticosAutomaticos.forEach((item) => {
      const clave = this.obtenerClaveDiagnostico(item);
      if (!clave || indicePorClave.has(clave)) return;
      combinados.push({ diagnostico: item.diagnostico, recomendacion: item.recomendacion });
      indicePorClave.set(clave, combinados.length - 1);
    });

    diagnosticosExistentes.forEach((registro) => {
      const clave = this.obtenerClaveDiagnostico(registro);
      if (!clave) return;

      const indiceActual = indicePorClave.get(clave);
      if (indiceActual !== undefined) {
        combinados[indiceActual] = registro;
      } else {
        combinados.push(registro);
        indicePorClave.set(clave, combinados.length - 1);
      }
    });

    this.diagnosticos = combinados.length > 0 ? combinados : [{ diagnostico: '', recomendacion: '' }];
    this.ultimoDiagnosticosAutomaticos = clavesAutomaticasActuales;
    this.ajustarAlturaDiagnosticos();
  }

  private construirDiagnosticosAutomaticos(): Array<{ diagnostico: string; recomendacion: string }> {
    const sugeridos: Array<{ diagnostico: string; recomendacion: string }> = [];

    const imc = this.obtenerImcNumerico();
    if (imc !== null) {
      const imcTexto = this.formatearNumero(imc, 2);
      if (imc < 18.5) {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Bajo peso por IMC (${imcTexto} kg/m2)`,
          'Se recomienda evaluación nutricional y seguimiento clínico para identificar la causa del bajo peso.'
        );
      } else if (imc < 25) {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Normopeso por IMC (${imcTexto} kg/m2)`,
          'Mantener plan de alimentación equilibrado, actividad física regular y control periódico de peso.'
        );
      } else if (imc < 30) {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Sobrepeso por IMC (${imcTexto} kg/m2)`,
          'Indicar plan nutricional, actividad física estructurada y reevaluación de IMC en el siguiente control.'
        );
      } else if (imc < 35) {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Obesidad clase I por IMC (${imcTexto} kg/m2)`,
          'Se sugiere manejo multidisciplinario con metas de reducción ponderal y control metabólico.'
        );
      } else if (imc < 40) {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Obesidad clase II por IMC (${imcTexto} kg/m2)`,
          'Manejo multidisciplinario intensivo y vigilancia estrecha de comorbilidades cardiovasculares y metabólicas.'
        );
      } else {
        this.agregarDiagnosticoUnico(
          sugeridos,
          `Obesidad clase III por IMC (${imcTexto} kg/m2)`,
          'Requiere abordaje integral especializado y valoración prioritaria por medicina interna/nutrición.'
        );
      }
    }

    const sistolica = this.obtenerPresionSistolicaNumerica();
    const categoriaTA = this.obtenerCategoriaPresionPorSistolica(sistolica);

    if (sistolica !== null && categoriaTA && categoriaTA !== 'NORMAL') {
      const lecturaTextoBase = this.obtenerLecturaTensionArterialTexto();
      const lecturaTexto = lecturaTextoBase ? `${lecturaTextoBase} mmHg` : `${sistolica} mmHg`;

      this.agregarDiagnosticoUnico(
        sugeridos,
        `Presión arterial ${categoriaTA} (TA ${lecturaTexto})`,
        ''
      );
    }

    const textoEndocrino = this.normalizarTexto(
      `${this.enfermedades?.endocrinas?.cual || ''} ${this.observacionesPatologicos || ''} ${this.paraclinicos.clinicaSanguinea || ''}`
    );
    const mencionaDM1 = /(dm1|diabetes mellitus tipo 1|diabetes tipo 1|insulinodepend|autoinmun)/.test(textoEndocrino);
    const mencionaDM2 = /(dm2|diabetes mellitus tipo 2|diabetes tipo 2|resistencia a la insulina|metformina|metformin)/.test(textoEndocrino);
    const glucosa = this.extraerNumeroDesdeTexto(this.paraclinicos.clinicaSanguinea);
    const a1c = this.extraerA1cDesdeTexto(this.paraclinicos.clinicaSanguinea);
    const cumpleCriterioDiabetes = (glucosa !== null && glucosa >= 126) || (a1c !== null && a1c >= 6.5);

    const evidencias: string[] = [];
    if (glucosa !== null) evidencias.push(`glucosa ${this.formatearNumero(glucosa, 1)} mg/dL`);
    if (a1c !== null) evidencias.push(`HbA1c ${this.formatearNumero(a1c, 1)}%`);
    const sufijoEvidencia = evidencias.length ? ` (${evidencias.join(', ')})` : '';

    if (mencionaDM1) {
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Diabetes mellitus tipo I${sufijoEvidencia}`,
        'Mantener esquema de insulinización, control glucémico estricto y seguimiento por endocrinología.'
      );
    } else if (mencionaDM2 || cumpleCriterioDiabetes) {
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Diabetes mellitus tipo II${sufijoEvidencia}`,
        'Indicar plan de control metabólico con ajuste dietético, actividad física y valoración terapéutica integral.'
      );
    }

    const tieneProblemaVista = !!this.problemasVista?.tiene && !this.problemasVista?.negado;
    const tieneProblemaAuditivo = !!this.problemasAuditivos?.tiene && !this.problemasAuditivos?.negado;
    const usaLentes = !!this.problemasVista?.usoLentes;
    const detalleVista = (this.problemasVista?.cual || '').trim();
    const detalleAuditivo = (this.problemasAuditivos?.cual || '').trim();
    const agudezaOD = (this.organosSistemas?.[1]?.agudVisualOD || '').trim();
    const agudezaOI = (this.organosSistemas?.[1]?.agudVisualOI || '').trim();

    if (tieneProblemaVista) {
      const sufijoVista = detalleVista ? `: ${detalleVista}` : '';
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Problemas de la vista${sufijoVista}`,
        'Valoración oftalmológica y seguimiento periódico en control médico ocupacional.'
      );
    }

    if (tieneProblemaAuditivo) {
      const sufijoAuditivo = detalleAuditivo ? `: ${detalleAuditivo}` : '';
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Problemas auditivos${sufijoAuditivo}`,
        'Valoración audiológica y seguimiento periódico en control médico ocupacional.'
      );
    }

    if (tieneProblemaVista && usaLentes) {
      const detalleAmetropia: string[] = [];
      if (detalleVista) detalleAmetropia.push(detalleVista);
      if (agudezaOD || agudezaOI) {
        const partesAV: string[] = [];
        if (agudezaOD) partesAV.push(`OD ${agudezaOD}`);
        if (agudezaOI) partesAV.push(`OI ${agudezaOI}`);
        detalleAmetropia.push(`agudeza visual ${partesAV.join(', ')}`);
      }
      const sufijoAmetropia = detalleAmetropia.length ? ` (${detalleAmetropia.join('; ')})` : '';
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Ametropía corregida con anteojos${sufijoAmetropia}`,
        'Mantener uso de lentes correctores y vigilancia periódica de agudeza visual en control médico ocupacional.'
      );
    }

    const diagnosticosEnfermedades = this.obtenerDiagnosticosDesdeEnfermedadesSeleccionadas();
    diagnosticosEnfermedades.forEach((item) => {
      this.agregarDiagnosticoUnico(sugeridos, item.diagnostico, item.recomendacion);
    });

    if (this.tabaquismo?.negado) {
      this.indiceTabaquico = '';
    } else {
      const indiceCalculado = this.calcularIndiceTabaquicoDesdeHabito();
      this.indiceTabaquico = indiceCalculado !== null ? this.formatearNumero(indiceCalculado, 2) : '';

      const indiceTab = indiceCalculado;
      const tieneAntecedenteTabaco = !!this.tabaquismo?.fuma || !!this.tabaquismo?.fumo || (indiceTab !== null && indiceTab > 0);

      if (indiceTab !== null && tieneAntecedenteTabaco) {
        const indiceTexto = this.formatearNumero(indiceTab, 2);
        if (indiceTab < 10) {
          this.agregarDiagnosticoUnico(
            sugeridos,
            `Índice tabáquico ${indiceTexto} paquetes-año - Clasificación EPOC: Nulo`,
            'Reforzar mantenimiento de abstinencia o cesación tabáquica y medidas preventivas respiratorias.'
          );
        } else if (indiceTab <= 20) {
          this.agregarDiagnosticoUnico(
            sugeridos,
            `Índice tabáquico ${indiceTexto} paquetes-año - Clasificación EPOC: Riesgo moderado`,
            'Indicar intervención para cesación tabáquica y control clínico respiratorio periódico.'
          );
        } else if (indiceTab <= 40) {
          this.agregarDiagnosticoUnico(
            sugeridos,
            `Índice tabáquico ${indiceTexto} paquetes-año - Clasificación EPOC: Riesgo intenso`,
            'Priorizar cesación tabáquica, evaluación funcional respiratoria y seguimiento médico estrecho.'
          );
        } else {
          this.agregarDiagnosticoUnico(
            sugeridos,
            `Índice tabáquico ${indiceTexto} paquetes-año - Clasificación EPOC: Riesgo alto`,
            'Requiere manejo intensivo de cesación tabáquica y valoración neumológica por alto riesgo respiratorio.'
          );
        }
      }
    }

    const vacunasPendientes = this.obtenerVacunasPendientesEsquema();
    const tieneRegistroAdicional = !!String(this.vacunas?.otras || '').trim();
    const vacunasBaseRegistradas = 5 - vacunasPendientes.length;

    if (vacunasBaseRegistradas === 0 && !tieneRegistroAdicional) {
      this.agregarDiagnosticoUnico(
        sugeridos,
        'Esquema de vacunación no documentado',
        'Se recomienda completar el esquema de vacunación conforme a las guías de prevención vigentes.'
      );
    } else if (vacunasPendientes.length > 0) {
      const pendientesTexto = vacunasPendientes.join(', ');
      this.agregarDiagnosticoUnico(
        sugeridos,
        `Esquema de vacunación incompleto (pendientes: ${pendientesTexto})`,
        'Se recomienda completar el esquema de vacunación conforme a las guías de prevención vigentes y registrar la evidencia inmunológica en expediente.'
      );
    }

    return sugeridos;
  }

  private obtenerDiagnosticosDesdeEnfermedadesSeleccionadas(): Array<{ diagnostico: string; recomendacion: string }> {
    const catalogoEnfermedades = [
      { key: 'congenitas', label: 'Congénitas' },
      { key: 'dentales', label: 'Dentales' },
      { key: 'endocrinas', label: 'Endocrinas' },
      { key: 'pulmonares', label: 'Pulmonares' },
      { key: 'cardiovasculares', label: 'Cardiovasculares' },
      { key: 'digestivas', label: 'Digestivas' },
      { key: 'urinarias', label: 'Urinarias' },
      { key: 'musculoEsqueleticas', label: 'Músculo-Esqueléticas' },
      { key: 'dermatologicas', label: 'Dermatológicas' },
      { key: 'infectoContagiosas', label: 'Infecto-Contagiosas' },
      { key: 'psiquiatricas', label: 'Psiquiátricas' },
      { key: 'alergias', label: 'Alergias' },
      { key: 'otrasEnfermedades', label: 'Otras Enfermedades' }
    ];

    const diagnosticos: Array<{ diagnostico: string; recomendacion: string }> = [];

    catalogoEnfermedades.forEach((item) => {
      const registro = this.enfermedades?.[item.key];
      const seleccionada = !!registro?.tiene;
      const detalle = String(registro?.cual || '').trim();

      if (!seleccionada || !detalle) {
        return;
      }

      diagnosticos.push({
        diagnostico: `${item.label}: ${detalle}`,
        recomendacion: ''
      });
    });

    return diagnosticos;
  }

  private obtenerVacunasPendientesEsquema(): string[] {
    const pendientes: string[] = [];

    if (!this.vacunas?.sarampion) pendientes.push('sarampion');
    if (!this.vacunas?.rubeola) pendientes.push('rubeola');
    if (!this.vacunas?.influenza) pendientes.push('influenza');
    if (!this.vacunas?.toxoideTetanico) pendientes.push('toxoide tetanico');
    if (!this.vacunas?.covid) pendientes.push('covid');

    return pendientes;
  }

  private agregarDiagnosticoUnico(
    lista: Array<{ diagnostico: string; recomendacion: string }>,
    diagnostico: string,
    recomendacion: string
  ): void {
    const registro = {
      diagnostico: (diagnostico || '').trim(),
      recomendacion: (recomendacion || '').trim()
    };
    const clave = this.obtenerClaveDiagnostico(registro);
    if (!clave) return;
    const yaExiste = lista.some((item) => this.obtenerClaveDiagnostico(item) === clave);
    if (!yaExiste) {
      lista.push(registro);
    }
  }

  private obtenerImcNumerico(): number | null {
    const imcCapturado = this.extraerNumeroDesdeTexto(this.exploracionFisica.imc);
    if (imcCapturado !== null && imcCapturado > 0) return imcCapturado;

    const peso = this.extraerNumeroDesdeTexto(this.exploracionFisica.peso);
    const tallaCm = this.extraerNumeroDesdeTexto(this.exploracionFisica.talla);
    if (peso === null || tallaCm === null || tallaCm <= 0) return null;

    const tallaM = tallaCm / 100;
    if (tallaM <= 0) return null;
    return peso / (tallaM * tallaM);
  }

  private obtenerLecturaTensionArterial(): { pas: number; pad: number } | null {
    const textoSistolica = String(this.exploracionFisica.taSistolica || '').trim();
    const textoDiastolica = String(this.exploracionFisica.taDiastolica || '').trim();
    const pas = this.obtenerPresionSistolicaNumerica();
    const pad = this.obtenerPresionDiastolicaNumerica();

    if (textoSistolica || textoDiastolica) {
      if (pas !== null && pad !== null) {
        return { pas, pad };
      }
      return null;
    }

    if (pas !== null && pad !== null) {
      return { pas, pad };
    }

    const lectura = this.descomponerLecturaTensionArterial(this.exploracionFisica.ta);
    if (lectura.pas !== null && lectura.pad !== null) {
      return { pas: lectura.pas, pad: lectura.pad };
    }

    return null;
  }

  private obtenerPresionSistolicaNumerica(): number | null {
    const sistolica = this.extraerNumeroDesdeTexto(this.exploracionFisica.taSistolica);
    if (sistolica !== null) {
      return Math.round(sistolica);
    }

    const lectura = this.descomponerLecturaTensionArterial(this.exploracionFisica.ta);
    return lectura.pas;
  }

  private obtenerPresionDiastolicaNumerica(): number | null {
    const diastolica = this.extraerNumeroDesdeTexto(this.exploracionFisica.taDiastolica);
    if (diastolica !== null) {
      return Math.round(diastolica);
    }

    const lectura = this.descomponerLecturaTensionArterial(this.exploracionFisica.ta);
    return lectura.pad;
  }

  private obtenerCategoriaPresionPorSistolica(sistolica: number | null): string {
    if (sistolica === null) return '';
    if (sistolica < 121) return 'NORMAL';
    if (sistolica <= 129) return 'ELEVADA';
    if (sistolica <= 139) return 'HIPERTENSIÓN ETAPA 1';
    if (sistolica > 180) return 'HIPERTENSIÓN GRAVE / EMERGENCIA HIPERTENSIVA';
    return 'HIPERTENSIÓN ETAPA 2';
  }

  private descomponerLecturaTensionArterial(valor: any): { pas: number | null; pad: number | null } {
    const texto = String(valor || '').trim();
    const match = texto.match(/(\d{2,3})\s*[\/-]\s*(\d{2,3})/);
    if (match) {
      return { pas: Number(match[1]), pad: Number(match[2]) };
    }

    const numeros = texto.match(/\d{2,3}/g);
    if (numeros && numeros.length >= 2) {
      return { pas: Number(numeros[0]), pad: Number(numeros[1]) };
    }

    if (numeros && numeros.length === 1) {
      return { pas: Number(numeros[0]), pad: null };
    }

    return { pas: null, pad: null };
  }

  private calcularIndiceTabaquicoDesdeHabito(): number | null {
    if (this.tabaquismo?.negado) {
      return null;
    }

    const cigarrosPorDia = this.extraerNumeroDesdeTexto(this.tabaquismo?.cigarros);
    const aniosConsumo = this.extraerNumeroDesdeTexto(this.tabaquismo?.intervaloTiempo);

    if (cigarrosPorDia === null || aniosConsumo === null || cigarrosPorDia <= 0 || aniosConsumo <= 0) {
      return null;
    }

    return (cigarrosPorDia / 20) * aniosConsumo;
  }

  private extraerNumeroDesdeTexto(valor: any): number | null {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).replace(',', '.');
    const match = texto.match(/\d+(\.\d+)?/);
    if (!match) return null;
    const numero = Number(match[0]);
    return Number.isFinite(numero) ? numero : null;
  }

  private extraerA1cDesdeTexto(valor: any): number | null {
    const textoOriginal = String(valor || '');
    if (!textoOriginal) return null;

    const textoNormalizado = this.normalizarTexto(textoOriginal);
    const matchA1c = textoNormalizado.match(/(a1c|hba1c|hemoglobina glicosilada)[^\d]*(\d+(\.\d+)?)/);
    if (matchA1c) {
      const numero = Number(matchA1c[2]);
      return Number.isFinite(numero) ? numero : null;
    }

    const matchPorcentaje = textoOriginal.replace(',', '.').match(/(\d+(\.\d+)?)\s*%/);
    if (!matchPorcentaje) return null;
    const numero = Number(matchPorcentaje[1]);
    if (!Number.isFinite(numero) || numero < 3 || numero > 18) return null;
    return numero;
  }

  private formatearNumero(valor: number, decimales: number): string {
    return valor.toFixed(decimales).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  private normalizarTexto(valor: any): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private tieneContenidoDiagnostico(item: any): boolean {
    return !!((item?.diagnostico || '').trim() || (item?.recomendacion || '').trim());
  }

  private obtenerClaveDiagnostico(item: { diagnostico?: string; recomendacion?: string }): string {
    const diagnostico = this.normalizarTexto(item?.diagnostico || '');
    const recomendacion = this.normalizarTexto(item?.recomendacion || '');
    if (diagnostico) return `d:${diagnostico}`;
    if (recomendacion) return `r:${recomendacion}`;
    return '';
  }

  // =====================================================
  // VALIDACIONES EN TIEMPO REAL
  // =====================================================

  validarCampo(campo: string): void {
    delete this.errores[campo];

    switch (campo) {
      case 'tipoHistoria':
        if (!this.formulario.tipoHistoria) {
          this.errores[campo] = 'Seleccione un tipo de historia clínica.';
        }
        break;

      case 'fechaElaboracion':
        if (!this.formulario.fechaElaboracion) {
          this.errores[campo] = 'La fecha de elaboración es obligatoria.';
        }
        break;

      case 'matricula':
        if (!this.formulario.matricula || !this.formulario.matricula.trim()) {
          this.errores[campo] = 'La matrícula es obligatoria.';
        } else if (!/^[a-zA-Z0-9\-]+$/.test(this.formulario.matricula.trim())) {
          this.errores[campo] = 'Solo letras, números y guiones.';
        }
        break;

      case 'area':
        if (!this.formulario.area || !this.formulario.area.trim()) {
          this.errores[campo] = 'El área es obligatoria.';
        } else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(this.formulario.area.trim())) {
          this.errores[campo] = 'Solo se permiten letras.';
        }
        break;

      case 'nombre':
        if (!this.formulario.nombre || !this.formulario.nombre.trim()) {
          this.errores[campo] = 'El nombre es obligatorio.';
        } else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(this.formulario.nombre.trim())) {
          this.errores[campo] = 'Solo se permiten letras y espacios.';
        } else if (this.formulario.nombre.trim().length < 3) {
          this.errores[campo] = 'Mínimo 3 caracteres.';
        }
        break;

      case 'religion':
        if (this.formulario.religion && !/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/.test(this.formulario.religion.trim())) {
          this.errores[campo] = 'Solo se permiten letras.';
        }
        break;

      case 'escolaridad':
        if (!this.formulario.escolaridad) {
          this.errores[campo] = 'Seleccione la escolaridad.';
        }
        break;

      case 'estadoCivil':
        if (!this.formulario.estadoCivil) {
          this.errores[campo] = 'Seleccione el estado civil.';
        }
        break;

      case 'edad':
        const edadVal = this.formulario.edad;
        if (!edadVal && edadVal !== 0) {
          this.errores[campo] = 'La edad es obligatoria.';
        } else {
          const edadNum = Number(edadVal);
          if (isNaN(edadNum) || edadNum < 16 || edadNum > 99) {
            this.errores[campo] = 'Ingrese una edad válida (16-99).';
          }
        }
        break;

      case 'lugarNacimiento':
        if (!this.formulario.lugarNacimiento || !this.formulario.lugarNacimiento.trim()) {
          this.errores[campo] = 'El lugar de nacimiento es obligatorio.';
        }
        break;

      case 'telefono':
        if (!this.formulario.telefono || !this.formulario.telefono.trim()) {
          this.errores[campo] = 'El teléfono es obligatorio.';
        } else if (!/^\d{10}$/.test(this.formulario.telefono.replace(/\s/g, ''))) {
          this.errores[campo] = 'Ingrese 10 dígitos numéricos.';
        }
        break;

      case 'domicilio':
        if (!this.formulario.domicilio || !this.formulario.domicilio.trim()) {
          this.errores[campo] = 'El domicilio es obligatorio.';
        } else if (this.formulario.domicilio.trim().length < 10) {
          this.errores[campo] = 'Ingrese una dirección más completa.';
        }
        break;

      case 'contactoEmergenciaNombre':
        if (!this.formulario.contactoEmergenciaNombre || !this.formulario.contactoEmergenciaNombre.trim()) {
          this.errores[campo] = 'El nombre del contacto es obligatorio.';
        } else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(this.formulario.contactoEmergenciaNombre.trim())) {
          this.errores[campo] = 'Solo se permiten letras y espacios.';
        }
        break;

      case 'contactoEmergenciaTelefono':
        if (!this.formulario.contactoEmergenciaTelefono || !this.formulario.contactoEmergenciaTelefono.trim()) {
          this.errores[campo] = 'El teléfono de contacto es obligatorio.';
        } else if (!/^\d{10}$/.test(this.formulario.contactoEmergenciaTelefono.replace(/\s/g, ''))) {
          this.errores[campo] = 'Ingrese 10 dígitos numéricos.';
        }
        break;
    }
  }

  validarPasoActual(): boolean {
    // TODO: TESTING - validación deshabilitada para pruebas
    return true;
  }

  validarTodo(): boolean {
    // TODO: TESTING - validación deshabilitada para pruebas
    return true;
  }

  // Restringir solo números
  soloNumeros(event: KeyboardEvent): boolean {
    const charCode = event.key;
    if (!/^\d$/.test(charCode) && charCode !== 'Backspace' && charCode !== 'Tab' && charCode !== 'Delete' && charCode !== 'ArrowLeft' && charCode !== 'ArrowRight') {
      event.preventDefault();
      return false;
    }
    return true;
  }

  // Restringir solo números y punto decimal (para peso, talla, temperatura)
  soloNumerosDecimal(event: KeyboardEvent): boolean {
    const charCode = event.key;
    if (!/^[\d.]$/.test(charCode) && charCode !== 'Backspace' && charCode !== 'Tab' && charCode !== 'Delete' && charCode !== 'ArrowLeft' && charCode !== 'ArrowRight') {
      event.preventDefault();
      return false;
    }
    return true;
  }

  // Restringir solo letras
  soloLetras(event: KeyboardEvent): boolean {
    const charCode = event.key;
    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]$/.test(charCode) && charCode !== 'Backspace' && charCode !== 'Tab' && charCode !== 'Delete' && charCode !== 'ArrowLeft' && charCode !== 'ArrowRight') {
      event.preventDefault();
      return false;
    }
    return true;
  }

  // =====================================================
  // NAVEGACIÓN ENTRE PASOS
  // =====================================================

  siguientePaso(): void {
    if (this.validarPasoActual()) {
      if (this.pasoActual < this.totalPasos) {
        this.pasoActual++;
        if (this.pasoActual > this.maxPasoAlcanzado) {
          this.maxPasoAlcanzado = this.pasoActual;
        }
        if (this.pasoActual === this.pasoDiagnostico) {
          this.sincronizarDiagnosticosAutomaticos();
          this.ajustarAlturaObservacionesDiagnostico();
        }
        if (this.pasoActual === this.pasoGineco && this.esGeneroFemenino) {
          this.actualizarObservacionesGinecoObstetricos();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      Swal.fire({
        title: 'Campos incompletos',
        text: 'Revise los campos marcados en rojo antes de continuar.',
        icon: 'warning',
        confirmButtonColor: '#38512F',
        confirmButtonText: 'Entendido'
      });
    }
  }

  pasoAnterior(): void {
    if (this.pasoActual > 1) {
      this.pasoActual--;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  irAPaso(paso: number): void {
    if (paso <= this.maxPasoAlcanzado) {
      this.pasoActual = paso;
      if (this.pasoActual === this.pasoDiagnostico) {
        this.sincronizarDiagnosticosAutomaticos();
        this.ajustarAlturaObservacionesDiagnostico();
      }
      if (this.pasoActual === this.pasoGineco && this.esGeneroFemenino) {
        this.actualizarObservacionesGinecoObstetricos();
      }
    }
  }

  abrirFormulario(): void {
    this.inicializarFormulario();
    this.editandoHistoriaId = null;
    this.modoEdicionDesdeHistorial = false;
    this.folioOrigenEdicion = '';
    this.historiaActualId = null;
    this.historiaSoloLecturaDesdeHistorial = false;
    this.pasoActual = 1;
    this.maxPasoAlcanzado = 1;
    this.vistaActual = 'formulario';
  }

  volverAlMenu(): void {
    Swal.fire({
      title: '¿Salir del formulario?',
      text: 'Los datos no guardados se perderán.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#0f3661',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.vistaActual = 'menu';
      }
    });
  }

  guardarFormulario(): void {
    this.intentoGuardar = true;

    if (!this.validarTodo()) {
      // Ir al primer paso con errores
      for (let paso = 1; paso <= this.totalPasos; paso++) {
        const campos = this.camposPorPaso[paso] || [];
        if (campos.some(c => !!this.errores[c])) {
          this.pasoActual = paso;
          break;
        }
      }
      Swal.fire({
        title: 'Formulario incompleto',
        text: 'Revise los campos marcados en rojo.',
        icon: 'warning',
        confirmButtonColor: '#38512F',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    this.guardarHistoriaClinicaBD();
  }

  // =====================================================
  // VISTA PREVIA (formato Excel)
  // =====================================================

  generarVistaPrevia(origen: 'formulario' | 'historial' = 'formulario'): void {
    this.aplicarDefaultsAntecedentesLaboralesSiVacio();
    this.origenPreview = origen;
    this.historiaSoloLecturaDesdeHistorial = false;
    this.vistaActual = 'preview';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  volverAlFormulario(): void {
    if (this.origenPreview === 'historial') {
      this.vistaActual = 'historial';
    } else {
      this.vistaActual = 'formulario';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  getBotonVolverTexto(): string {
    return this.origenPreview === 'historial' ? 'Volver al Historial' : 'Volver al Formulario';
  }

  imprimirHistoria(): void {
    this.procesarPDFHistoria({ descargarLocal: false, subirDrive: false, imprimirDirecto: true });
  }

  getCheckMark(value: boolean): string {
    return value ? '✓' : '';
  }

  getObservacionesHeredoFamiliares(): string {
    // Si ya hay observaciones escritas, las mostramos
    if (this.observacionesHeredoFamiliares && this.observacionesHeredoFamiliares.trim() !== '') {
      return this.observacionesHeredoFamiliares;
    }
    // Si ningún antecedente fue seleccionado, mostramos el texto por defecto
    const tieneAlgunAntecedente = this.heredoFamiliares['diabetes'] ||
      this.heredoFamiliares['hipertension'] ||
      this.heredoFamiliares['cancer'] ||
      this.heredoFamiliares['cardiacos'] ||
      this.heredoFamiliares['asma'] ||
      this.heredoFamiliares['alergias'] ||
      this.heredoFamiliares['renales'] ||
      this.heredoFamiliares['convulsiones'] ||
      this.heredoFamiliares['auditivas'] ||
      this.heredoFamiliares['visuales'];

    return tieneAlgunAntecedente ? '' : 'Antecedentes heredofamiliares interrogados y negados';
  }

  get folioCompleto(): string {
    const anio = new Date().getFullYear().toString().slice(-2);
    const id = this.historiaActualId ? String(this.historiaActualId).padStart(3, '0') : null;
    return id ? `B-HC-${anio}-${id}` : '—';
  }

  private construirNombrePdfHistoriaClinica(idRegistro: number | null): string {
    const anio = new Date().getFullYear().toString().slice(-2);
    const id = idRegistro ? String(idRegistro) : '0';
    const nombrePaciente = String(this.formulario?.nombre || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Paciente';

    return `${nombrePaciente} B-HC-${anio}-${id}.pdf`;
  }

  // =====================================================
  // DESCARGAR COMO PDF
  // =====================================================
  descargarPDF(): void {
    this.procesarPDFHistoria({ descargarLocal: true, subirDrive: false });
  }

  finalizarYSubirDriveYBD(): void {
    if (this.historiaActualId) {
      this.procesarPDFHistoria({ descargarLocal: false, subirDrive: true, finalizarFlujoAlCompletar: true });
      return;
    }

    if (this.origenPreview === 'historial' || this.historiaSoloLecturaDesdeHistorial) {
      Swal.fire({
        title: 'No se puede finalizar',
        text: 'Esta historia clínica ya existe o no está vinculada. Vuelva a abrirla desde el historial o use Editar para crear una nueva versión.',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.intentoGuardar = true;
    if (!this.validarTodo()) {
      Swal.fire({
        title: 'Formulario incompleto',
        text: 'Revise los campos marcados en rojo antes de finalizar.',
        icon: 'warning',
        confirmButtonColor: '#38512F',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    this.guardando = true;
    const payload = this.construirPayload();
    const esActualizacion = this.esActualizacionDirecta();
    const operacion = esActualizacion
      ? this.backendServices.actualizarHistoriaClinica(this.editandoHistoriaId as number, payload)
      : this.backendServices.guardarHistoriaClinica(payload);

    operacion.subscribe({
      next: (resp: any) => {
        this.guardando = false;
        if (resp.success) {
          this.historiaActualId = resp.id || (esActualizacion ? this.editandoHistoriaId : null);
          if (!esActualizacion && resp.id) {
            this.agregarHistoriaCreadaAlHistorialLocal(resp.id);
          }
          this.editandoHistoriaId = null;
          this.modoEdicionDesdeHistorial = false;
          this.folioOrigenEdicion = '';

          this.procesarPDFHistoria({ descargarLocal: false, subirDrive: true, finalizarFlujoAlCompletar: true });
        }
      },
      error: () => {
        this.guardando = false;
        Swal.fire({
          title: 'Error',
          text: 'No se pudo guardar la historia clínica antes de subir el PDF.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  private cerrarFlujoFinalizacionPreview(): void {
    this.editandoHistoriaId = null;
    this.modoEdicionDesdeHistorial = false;
    this.folioOrigenEdicion = '';
    this.historiaSoloLecturaDesdeHistorial = false;

    if (this.origenPreview === 'historial') {
      this.historiaActualId = null;
      this.verHistorial();
      return;
    }

    this.historiaActualId = null;
    this.pasoActual = 1;
    this.maxPasoAlcanzado = 1;
    this.vistaActual = 'menu';
  }

  private procesarPDFHistoria(opciones: { descargarLocal: boolean; subirDrive: boolean; finalizarFlujoAlCompletar?: boolean; imprimirDirecto?: boolean }): void {
    if (opciones.subirDrive && !this.historiaActualId) {
      Swal.fire({
        icon: 'warning',
        title: 'Guardado requerido',
        text: 'Primero guarda/finaliza la historia clínica para poder subir el PDF a Drive y registrar en BD.',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const element = document.getElementById('historia-clinica-print');
    if (!element) {
      Swal.fire('Error', 'No se encontró el documento para generar el PDF.', 'error');
      return;
    }

    const textoGeneracion = opciones.subirDrive
      ? 'Por favor espera mientras se genera el documento para subirlo a Drive.'
      : (opciones.imprimirDirecto
        ? 'Por favor espera mientras se prepara el documento para impresión.'
        : 'Por favor espera mientras se genera el documento para descargarlo.');

    Swal.fire({
      title: 'Generando PDF...',
      text: textoGeneracion,
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    // Guardar estilos originales del elemento
    const originalMaxWidth = element.style.maxWidth;
    const originalBoxShadow = element.style.boxShadow;
    const originalBorderRadius = element.style.borderRadius;

    // Ajustar temporalmente para captura limpia
    element.style.maxWidth = '210mm';
    element.style.boxShadow = 'none';
    element.style.borderRadius = '0';

    const nombreArchivo = this.construirNombrePdfHistoriaClinica(this.historiaActualId);

    // ── Recopilar puntos de corte seguros (bordes inferiores de cada fila) ──
    const elementRect = element.getBoundingClientRect();
    const rows = element.querySelectorAll('table.hc-table tr');
    const breakPositionsDom: number[] = []; // posiciones en px DOM
    rows.forEach((row: Element) => {
      const bottom = row.getBoundingClientRect().bottom - elementRect.top;
      breakPositionsDom.push(bottom);
    });
    // También agregar el borde inferior de cada tabla completa
    const tables = element.querySelectorAll('table.hc-table');
    tables.forEach((tbl: Element) => {
      const bottom = tbl.getBoundingClientRect().bottom - elementRect.top;
      breakPositionsDom.push(bottom);
    });
    // Ordenar y eliminar duplicados
    const uniqueBreaks = [...new Set(breakPositionsDom)].sort((a, b) => a - b);

    // Cortes forzados solicitados por negocio (inicio de sección específica)
    const forcedBreakMarkers = element.querySelectorAll('.hc-forced-page-break');
    const forcedBreaksDom: number[] = [];
    forcedBreakMarkers.forEach((marker: Element) => {
      const top = marker.getBoundingClientRect().top - elementRect.top;
      if (top > 1) {
        forcedBreaksDom.push(top);
      }
    });

    const captureScale = 3;

    html2canvas(element, {
      scale: captureScale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 0,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight
    }).then(canvas => {
      // Restaurar estilos originales
      element.style.maxWidth = originalMaxWidth;
      element.style.boxShadow = originalBoxShadow;
      element.style.borderRadius = originalBorderRadius;

      const pdf = new jsPDF('p', 'mm', 'letter');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = opciones.imprimirDirecto ? 8 : 5;
      const topSafetyOffset = opciones.imprimirDirecto ? 3 : 0;
      const usableWidth = pageWidth - (margin * 2);
      const usableHeight = pageHeight - (margin * 2) - topSafetyOffset;

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = usableWidth / imgWidth; // mm por px de canvas
      const scaledHeight = imgHeight * ratio;

      // Convertir posiciones DOM → px de canvas
      const canvasBreaks = uniqueBreaks.map(pos => Math.round(pos * captureScale));
      const forcedCanvasBreaks = [...new Set(forcedBreaksDom.map(pos => Math.round(pos * captureScale)))]
        .sort((a, b) => a - b);

      // Si cabe en una página
      if (scaledHeight <= usableHeight) {
        const imgData = canvas.toDataURL('image/jpeg', 0.97);
        pdf.addImage(imgData, 'JPEG', margin, margin + topSafetyOffset, usableWidth, scaledHeight);
      } else {
        // ── Múltiples páginas con corte inteligente ──
        const maxSliceHeight = usableHeight / ratio; // px de canvas que caben por página
        let yOffset = 0;
        let pageNum = 0;

        while (yOffset < imgHeight) {
          const targetEnd = yOffset + maxSliceHeight;
          let sliceEnd: number;
          const nextForcedBreak = forcedCanvasBreaks.find((pos: number) => pos > yOffset + 2);
          const forcedBreakInRange = nextForcedBreak !== undefined && nextForcedBreak <= targetEnd;
          const forcedBreakBeforeImageEnd = nextForcedBreak !== undefined && nextForcedBreak < (imgHeight - 2);

          if (targetEnd >= imgHeight) {
            // Última página: aún respetar cortes forzados si existen
            sliceEnd = forcedBreakBeforeImageEnd ? nextForcedBreak as number : imgHeight;
          } else if (forcedBreakInRange) {
            // Priorizar corte forzado para que la siguiente sección inicie en hoja nueva
            sliceEnd = nextForcedBreak as number;
          } else {
            // Buscar el último punto de corte seguro que quepa en la página
            // pero que llene al menos 25 % de la hoja (evitar páginas muy vacías)
            const minEnd = yOffset + maxSliceHeight * 0.25;
            let bestBreak = -1;
            for (let i = canvasBreaks.length - 1; i >= 0; i--) {
              if (canvasBreaks[i] <= targetEnd && canvasBreaks[i] > minEnd) {
                bestBreak = canvasBreaks[i];
                break;
              }
            }
            sliceEnd = bestBreak > 0 ? bestBreak : targetEnd; // fallback: corte fijo
          }

          // Salvaguarda para evitar bucles infinitos por redondeo
          if (sliceEnd <= yOffset) {
            sliceEnd = Math.min(targetEnd, imgHeight);
            if (sliceEnd <= yOffset) {
              break;
            }
          }

          const sliceHeight = sliceEnd - yOffset;

          // Crear canvas para esta porción
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = imgWidth;
          pageCanvas.height = sliceHeight;
          const ctx = pageCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            ctx.drawImage(canvas, 0, yOffset, imgWidth, sliceHeight, 0, 0, imgWidth, sliceHeight);
          }

          const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.97);
          const pageScaledHeight = sliceHeight * ratio;

          if (pageNum > 0) {
            pdf.addPage();
          }

          pdf.addImage(pageImgData, 'JPEG', margin, margin + topSafetyOffset, usableWidth, pageScaledHeight);
          yOffset = sliceEnd;
          pageNum++;
        }
      }

      if (opciones.imprimirDirecto) {
        try {
          if (typeof (pdf as any).autoPrint === 'function') {
            (pdf as any).autoPrint();
          }

          const pdfBlobUrl = pdf.output('bloburl');
          const printWindow = window.open(pdfBlobUrl, '_blank');
          Swal.close();

          if (!printWindow) {
            Swal.fire({
              icon: 'warning',
              title: 'Ventana bloqueada',
              text: 'Tu navegador bloqueó la ventana de impresión. Permite pop-ups y vuelve a intentar.',
              confirmButtonColor: '#38512F'
            });
          }
        } catch (printErr) {
          console.error('Error al preparar impresión PDF:', printErr);
          Swal.close();
          Swal.fire({
            icon: 'error',
            title: 'Error al imprimir',
            text: 'No se pudo preparar el documento para impresión.',
            confirmButtonColor: '#38512F'
          });
        }
        return;
      }

      if (opciones.descargarLocal) {
        pdf.save(nombreArchivo);
      }

      if (!opciones.subirDrive) {
        Swal.close();
        if (opciones.descargarLocal) {
          Swal.fire({
            icon: 'success',
            title: 'PDF descargado',
            text: `El archivo "${nombreArchivo}" se descargó correctamente.`,
            timer: 2800,
            showConfirmButton: false
          });
        }
        return;
      }

      // ── Subir PDF a Google Drive (carpeta Expedientes_medicos) ──
      Swal.fire({
        title: 'Subiendo a Google Drive...',
        text: 'Guardando expediente médico en la nube.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      // Obtener el PDF como ArrayBuffer y convertir a base64
      const pdfArrayBuffer = pdf.output('arraybuffer');
      const pdfBytes = new Uint8Array(pdfArrayBuffer);
      let binary = '';
      for (let i = 0; i < pdfBytes.length; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
      }
      const pdfBase64 = btoa(binary);

      this.backendServices.subirPdfExpedienteMedico(
        this.historiaActualId as number,
        pdfBase64,
        nombreArchivo
      ).subscribe({
        next: (resp: any) => {
          Swal.close();
          if (resp.success) {
            const nombreArchivoFinal = resp?.nombre_archivo || nombreArchivo;
            if (opciones.finalizarFlujoAlCompletar) {
              Swal.fire({
                icon: 'success',
                title: '¡Finalizado!',
                html: `El archivo "<b>${nombreArchivoFinal}</b>" se subió a Google Drive, se registró en la base de datos y la historia quedó finalizada.`,
                confirmButtonColor: '#38512F',
                confirmButtonText: 'Aceptar'
              }).then(() => {
                this.cerrarFlujoFinalizacionPreview();
              });
            } else if (opciones.descargarLocal) {
              Swal.fire({
                icon: 'success',
                title: 'PDF generado y guardado',
                html: `El archivo "<b>${nombreArchivoFinal}</b>" se descargó y se guardó en Google Drive (Expedientes_medicos).`,
                timer: 3500,
                showConfirmButton: false
              });
            } else {
              Swal.fire({
                icon: 'success',
                title: 'PDF subido',
                html: `El archivo "<b>${nombreArchivoFinal}</b>" se subió a Google Drive y se registró en la base de datos.`,
                timer: 3200,
                showConfirmButton: false
              });
            }
          } else {
            Swal.fire({
              icon: 'warning',
              title: opciones.descargarLocal ? 'PDF descargado' : 'No se pudo finalizar',
              text: opciones.descargarLocal
                ? 'El PDF se descargó pero no se pudo subir a Google Drive.'
                : 'No se pudo subir el PDF a Google Drive. Intenta nuevamente.',
              confirmButtonColor: '#38512F'
            });
          }
        },
        error: (err) => {
          console.error('Error al subir PDF a Drive:', err);
          Swal.close();
          Swal.fire({
            icon: 'warning',
            title: opciones.descargarLocal ? 'PDF descargado' : 'Error de subida',
            text: opciones.descargarLocal
              ? 'El PDF se descargó correctamente pero no se pudo subir a Google Drive.'
              : 'No se pudo subir el PDF a Google Drive y base de datos.',
            confirmButtonColor: '#38512F',
            confirmButtonText: 'Aceptar'
          });
        }
      });
    }).catch(err => {
      // Restaurar estilos en caso de error
      element.style.maxWidth = originalMaxWidth;
      element.style.boxShadow = originalBoxShadow;
      element.style.borderRadius = originalBorderRadius;

      console.error('Error al generar PDF:', err);
      Swal.close();
      Swal.fire('Error', 'Ocurrió un error al generar el PDF. Intenta de nuevo.', 'error');
    });
  }

  // =====================================================
  // DESCARGAR COMO EXCEL (.xlsx) - Legacy
  // =====================================================
  descargarExcel(): void {
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [];
    const merges: XLSX.Range[] = [];
    let r = 0; // current row index
    const C = 12; // total columns A-L

    // Helper: add a row with merges
    const addRow = (cells: { v: string, colspan: number }[]) => {
      const row: any[] = new Array(C).fill('');
      let col = 0;
      for (const cell of cells) {
        row[col] = cell.v;
        if (cell.colspan > 1) {
          merges.push({ s: { r, c: col }, e: { r, c: col + cell.colspan - 1 } });
        }
        col += cell.colspan;
      }
      rows.push(row);
      r++;
    };

    const check = (val: boolean) => val ? '✓' : '';
    const seccionGineco = this.esGeneroFemenino ? 5 : null;
    const seccionExploracion = this.esGeneroFemenino ? 6 : 5;
    const seccionParaclinicos = this.esGeneroFemenino ? 7 : 6;
    const seccionDiagnostico = this.esGeneroFemenino ? 8 : 7;

    // === ENCABEZADO ===
    addRow([
      { v: 'BIZNAGA - Seguridad e Higiene Industrial & Ambiental', colspan: 3 },
      { v: 'H I S T O R I A   C L Í N I C A', colspan: 9 }
    ]);

    // === DATOS GENERALES ===
    addRow([{ v: 'TIPO DE HISTORIA CLÍNICA: ' + this.getTipoHistoriaLabel(this.formulario.tipoHistoria).toUpperCase(), colspan: 12 }]);
    addRow([
      { v: 'FECHA ELABORACIÓN: ' + (this.formulario.fechaElaboracion || ''), colspan: 4 },
      { v: 'MATRÍCULA: ' + (this.formulario.matricula || ''), colspan: 4 },
      { v: 'ÁREA: ' + (this.formulario.area || ''), colspan: 4 }
    ]);
    addRow([
      { v: 'NOMBRE: ' + (this.formulario.nombre || ''), colspan: 8 },
      { v: 'RELIGIÓN: ' + (this.formulario.religion || ''), colspan: 4 }
    ]);
    addRow([
      { v: 'ESCOLARIDAD: ' + (this.formulario.escolaridad || '').toUpperCase(), colspan: 4 },
      { v: 'ESTADO CIVIL: ' + (this.formulario.estadoCivil || '').toUpperCase(), colspan: 4 },
      { v: 'EDAD: ' + (this.formulario.edad || ''), colspan: 4 }
    ]);
    addRow([
      { v: 'LUGAR DE NACIMIENTO: ' + (this.formulario.lugarNacimiento || ''), colspan: 8 },
      { v: 'TELÉFONO: ' + (this.formulario.telefono || ''), colspan: 4 }
    ]);
    addRow([{ v: 'DOMICILIO: ' + (this.formulario.domicilio || ''), colspan: 12 }]);
    addRow([{ v: 'PERSONA Y NO. DE CONTACTO EN CASO DE ACCIDENTE: ' + (this.formulario.contactoEmergenciaNombre || '') + ' — ' + (this.formulario.contactoEmergenciaTelefono || ''), colspan: 12 }]);

    // === 1. ANTECEDENTES LABORALES ===
    addRow([{ v: '1. ANTECEDENTES LABORALES', colspan: 12 }]);
    addRow([
      { v: 'EMPRESA', colspan: 2 }, { v: 'PUESTO', colspan: 2 }, { v: 'TIEMPO', colspan: 1 },
      { v: 'EPP VIS.', colspan: 1 }, { v: 'EPP AUD.', colspan: 1 }, { v: 'EPP RESP.', colspan: 1 },
      { v: 'N/A EPP', colspan: 1 },
      { v: 'ENF. TRABAJO', colspan: 1 }, { v: 'ACC. TRABAJO', colspan: 1 }
    ]);
    for (const fila of this.antecedentesLaborales) {
      addRow([
        { v: fila.empresa || '', colspan: 2 }, { v: fila.puesto || '', colspan: 2 }, { v: fila.tiempo || '', colspan: 1 },
        { v: check(fila.eppVisual), colspan: 1 }, { v: check(fila.eppAuditivo), colspan: 1 }, { v: check(fila.eppRespiratorio), colspan: 1 },
        { v: 'N/A EPP ' + check(fila.eppNoAplica), colspan: 1 },
        { v: fila.enfermedadTrabajo || '', colspan: 1 }, { v: fila.accidenteTrabajo || '', colspan: 1 }
      ]);
    }
    if (this.antecedentesLaborales.length === 0) {
      addRow([{ v: '', colspan: 2 }, { v: '', colspan: 2 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }, { v: '', colspan: 1 }]);
    }
    addRow([{ v: 'OBSERVACIONES: ' + (this.observacionesLaborales || ''), colspan: 12 }]);

    // === 2. ANTECEDENTES HEREDO-FAMILIARES ===
    addRow([{ v: '2. ANTECEDENTES HEREDO-FAMILIARES', colspan: 12 }]);
    addRow([
      { v: 'DIABETES ' + check(this.heredoFamiliares['diabetes']), colspan: 2 },
      { v: 'HIPERTENSIÓN ' + check(this.heredoFamiliares['hipertension']), colspan: 3 },
      { v: 'CÁNCER ' + check(this.heredoFamiliares['cancer']), colspan: 2 },
      { v: 'CARDIACOS ' + check(this.heredoFamiliares['cardiacos']), colspan: 3 },
      { v: 'ASMA ' + check(this.heredoFamiliares['asma']), colspan: 2 }
    ]);
    addRow([
      { v: 'ALERGIAS ' + check(this.heredoFamiliares['alergias']), colspan: 2 },
      { v: 'RENALES ' + check(this.heredoFamiliares['renales']), colspan: 3 },
      { v: 'CONVULSIONES ' + check(this.heredoFamiliares['convulsiones']), colspan: 2 },
      { v: 'AUDITIVAS ' + check(this.heredoFamiliares['auditivas']), colspan: 3 },
      { v: 'VISUALES ' + check(this.heredoFamiliares['visuales']), colspan: 2 }
    ]);
    addRow([{ v: 'OBSERVACIONES: ' + (this.observacionesHeredoFamiliares || ''), colspan: 12 }]);

    // === 3. ANTECEDENTES PERSONALES NO PATOLÓGICOS ===
    addRow([{ v: '3. ANTECEDENTES PERSONALES NO PATOLÓGICOS', colspan: 12 }]);
    // Tabaquismo
    addRow([{ v: 'TABAQUISMO', colspan: 12 }]);
    addRow([
      { v: 'FUMÓ', colspan: 2 }, { v: 'FUMA', colspan: 2 }, { v: 'NEGADO', colspan: 2 },
      { v: 'CIGARROS/DÍA', colspan: 3 }, { v: 'EXPOSICIÓN/AÑOS', colspan: 3 }
    ]);
    addRow([
      { v: check(this.tabaquismo.fumo), colspan: 2 }, { v: check(this.tabaquismo.fuma), colspan: 2 },
      { v: check(this.tabaquismo.negado), colspan: 2 }, { v: this.tabaquismo.cigarros || '', colspan: 3 },
      { v: this.tabaquismo.intervaloTiempo || '', colspan: 3 }
    ]);
    // Alcoholismo
    addRow([{ v: 'ALCOHOLISMO', colspan: 12 }]);
    addRow([
      { v: 'BEBIÓ', colspan: 2 }, { v: 'BEBE', colspan: 2 }, { v: 'NEGADO', colspan: 2 },
      { v: 'FRECUENCIA', colspan: 3 }, { v: 'INTERVALO TIEMPO', colspan: 3 }
    ]);
    addRow([
      { v: check(this.alcoholismo.bebio), colspan: 2 }, { v: check(this.alcoholismo.bebe), colspan: 2 },
      { v: check(this.alcoholismo.negado), colspan: 2 }, { v: this.alcoholismo.unaVez || '', colspan: 3 },
      { v: this.alcoholismo.intervaloTiempo || '', colspan: 3 }
    ]);
    // Otras drogas
    addRow([{ v: 'OTRAS DROGAS', colspan: 12 }]);
    addRow([
      { v: 'CONSUMIÓ', colspan: 2 }, { v: 'CONSUME', colspan: 2 },
      { v: 'NEGADO', colspan: 2 }, { v: 'SUSTANCIA', colspan: 3 }, { v: 'INTERVALO TIEMPO', colspan: 3 }
    ]);
    addRow([
      { v: check(this.otrasDrogas.consumio), colspan: 2 }, { v: check(this.otrasDrogas.consume), colspan: 2 },
      { v: check(this.otrasDrogas.negado), colspan: 2 },
      { v: this.otrasDrogas.tipo || '', colspan: 3 }, { v: this.otrasDrogas.intervaloTiempo || '', colspan: 3 }
    ]);
    // Ejercicio
    addRow([
      { v: 'EJERCICIO', colspan: 2 }, { v: 'TIPO', colspan: 3 },
      { v: 'INTERVALO TIEMPO', colspan: 4 }, { v: 'TIEMPO PRACTICARLO', colspan: 3 }
    ]);
    addRow([
      { v: check(this.ejercicio.realiza), colspan: 2 }, { v: this.ejercicio.tipo || '', colspan: 3 },
      { v: this.ejercicio.intervaloTiempo || '', colspan: 4 }, { v: this.ejercicio.tiempoPracticarlo || '', colspan: 3 }
    ]);
    // Sueño
    addRow([
      { v: 'HORAS DE SUEÑO DIARIAS', colspan: 3 }, { v: 'MÍNIMO', colspan: 3 },
      { v: 'MÁXIMO', colspan: 3 }, { v: 'PROMEDIO', colspan: 3 }
    ]);
    addRow([
      { v: '', colspan: 3 }, { v: this.sueno.minimo || '', colspan: 3 },
      { v: this.sueno.maximo || '', colspan: 3 }, { v: this.sueno.promedio || '', colspan: 3 }
    ]);
    addRow([
      { v: 'ACTIVIDADES EN TIEMPO LIBRE: ' + (this.actividadesTiempoLibre || ''), colspan: 8 },
      { v: 'TIPO SANGUÍNEO: ' + (this.tipoSanguineo || ''), colspan: 4 }
    ]);
    // Vacunas
    addRow([{ v: 'VACUNAS', colspan: 12 }]);
    addRow([
      { v: 'SARAMPIÓN ' + check(this.vacunas.sarampion), colspan: 2 },
      { v: 'RUBÉOLA ' + check(this.vacunas.rubeola), colspan: 3 },
      { v: 'INFLUENZA ' + check(this.vacunas.influenza), colspan: 2 },
      { v: 'TOXOIDE TET. ' + check(this.vacunas.toxoideTetanico), colspan: 3 },
      { v: 'OTRAS: ' + (this.vacunas.otras || ''), colspan: 2 }
    ]);
    // Higiene
    addRow([
      { v: 'HACINAMIENTO ' + check(this.habitosHigiene.hacinamiento), colspan: 3 },
      { v: 'PROMISCUIDAD ' + check(this.habitosHigiene.promiscuidad), colspan: 3 },
      { v: 'ZOONOSIS ' + check(this.habitosHigiene.zoonosis), colspan: 3 },
      { v: 'PERFORACIONES ' + check(this.habitosHigiene.perforaciones), colspan: 3 }
    ]);
    addRow([
      { v: 'TATUAJES: ' + (this.tatuajes.negado ? 'NEGADO' : check(this.tatuajes.tiene)), colspan: 4 },
      { v: 'ZONA(S): ' + (this.tatuajes.negado ? '' : (this.tatuajes.zona || '')), colspan: 8 }
    ]);
    addRow([
      { v: 'BAÑO DIARIO ' + check(this.habitosHigiene.banoDiario), colspan: 3 },
      { v: 'ASEO BUCAL ' + check(this.habitosHigiene.aseoBucal), colspan: 3 },
      { v: 'COMIDAS AL DÍA: ' + (this.habitosHigiene.comidasAlDia || ''), colspan: 3 },
      { v: 'DESPARASITACIÓN (últimos 6 meses) ' + check(this.habitosHigiene.desparasitacion), colspan: 3 }
    ]);
    addRow([{ v: 'OBSERVACIONES: ' + (this.observacionesNoPatologicos || ''), colspan: 12 }]);

    // === 4. ANTECEDENTES PERSONALES PATOLÓGICOS ===
    addRow([{ v: '4. ANTECEDENTES PERSONALES PATOLÓGICOS', colspan: 12 }]);
    addRow([
      { v: 'SARAMPIÓN ' + check(this.enfermedadesInfantiles.sarampion), colspan: 2 },
      { v: 'RUBÉOLA ' + check(this.enfermedadesInfantiles.rubeola), colspan: 2 },
      { v: 'VARICELA ' + check(this.enfermedadesInfantiles.varicela), colspan: 2 },
      { v: 'PAROTIDITIS ' + check(this.enfermedadesInfantiles.parotiditis), colspan: 2 },
      { v: 'HEPATITIS ' + check(this.enfermedadesInfantiles.hepatitis), colspan: 2 },
      { v: 'COVID ' + check(this.enfermedadesInfantiles.covid), colspan: 2 }
    ]);
    addRow([
      { v: 'INFLUENZA ' + check(this.enfermedadesInfantiles.influenza), colspan: 3 },
      { v: 'OTRA: ' + (this.enfermedadesInfantiles.otra || ''), colspan: 9 }
    ]);
    addRow([
      { v: 'PROBLEMAS DE LA VISTA: ' + (this.problemasVista.negado ? 'NEGADO' : check(this.problemasVista.tiene)), colspan: 4 },
      { v: 'CUÁL: ' + (this.problemasVista.negado ? '' : (this.problemasVista.cual || '')), colspan: 4 },
      { v: 'USO DE LENTES ' + (this.problemasVista.negado ? '' : check(this.problemasVista.usoLentes)), colspan: 4 }
    ]);
    addRow([
      { v: 'PROBLEMAS AUDITIVOS: ' + (this.problemasAuditivos.negado ? 'NEGADO' : check(this.problemasAuditivos.tiene)), colspan: 4 },
      { v: 'CUÁL: ' + (this.problemasAuditivos.negado ? '' : (this.problemasAuditivos.cual || '')), colspan: 4 },
      { v: 'USO DE AUDÍFONOS ' + (this.problemasAuditivos.negado ? '' : check(this.problemasAuditivos.usoAudifonos)), colspan: 4 }
    ]);
    addRow([{ v: 'OBSERVACIONES: ' + (this.observacionesPatologicos || ''), colspan: 12 }]);

    // Enfermedades
    addRow([{ v: 'ENFERMEDADES', colspan: 12 }]);
    const enfermedadesList = [
      { key: 'congenitas', label: 'CONGÉNITAS' }, { key: 'dentales', label: 'DENTALES' },
      { key: 'endocrinas', label: 'ENDOCRINAS' }, { key: 'pulmonares', label: 'PULMONARES' },
      { key: 'cardiovasculares', label: 'CARDIOVASCULARES' }, { key: 'digestivas', label: 'DIGESTIVAS' },
      { key: 'urinarias', label: 'URINARIAS' }, { key: 'musculoEsqueleticas', label: 'MÚSCULO-ESQUELÉTICAS' },
      { key: 'dermatologicas', label: 'DERMATOLÓGICAS' }, { key: 'infectoContagiosas', label: 'INFECTO-CONTAGIOSAS' },
      { key: 'psiquiatricas', label: 'PSIQUIÁTRICAS' }, { key: 'otrasEnfermedades', label: 'OTRAS ENFERMEDADES' },
      { key: 'alergias', label: 'ALERGIAS' }
    ];
    for (const enf of enfermedadesList) {
      const enfermedadActiva = !!this.enfermedades[enf.key]?.tiene;
      const detalleEnfermedad = enfermedadActiva
        ? (this.enfermedades[enf.key]?.cual || '')
        : 'Interrogados y Negados';

      addRow([
        { v: enf.label + ' ' + check(enfermedadActiva), colspan: 4 },
        { v: 'CUÁL(ES): ' + detalleEnfermedad, colspan: 8 }
      ]);
    }
    addRow([{ v: 'CIRUGÍAS (TIPO, FECHA, INDICACIÓN): ' + (this.cirugias || ''), colspan: 12 }]);
    addRow([{ v: 'TRANSFUSIONES (FECHA, INDICACIÓN): ' + (this.transfusiones || ''), colspan: 12 }]);
    addRow([{ v: 'TRAUMÁTICOS (ESGUINCE, LUX., FRACT.): ' + (this.traumaticos || ''), colspan: 12 }]);
    addRow([{ v: 'INGRESOS HOSPITALARIOS: ' + (this.ingresosHospitalarios || ''), colspan: 12 }]);

    if (this.esGeneroFemenino) {
      // === 5. ANTECEDENTES GINECO-OBSTÉTRICOS ===
      addRow([{ v: `${seccionGineco}. ANTECEDENTES GINECO-OBSTÉTRICOS`, colspan: 12 }]);
      addRow([
        { v: 'MENARCA', colspan: 3 }, { v: 'CICLO', colspan: 3 },
        { v: 'F.U.M', colspan: 3 }, { v: 'DISMENORREA', colspan: 3 }
      ]);
      addRow([
        { v: this.ginecoObstetricos.menarca || '', colspan: 3 }, { v: this.ginecoObstetricos.ciclo || '', colspan: 3 },
        { v: this.ginecoObstetricos.fum || '', colspan: 3 }, { v: this.ginecoObstetricos.dismenorreaSi ? 'SI' : 'NO', colspan: 3 }
      ]);
      addRow([
        { v: 'IVSA', colspan: 2 }, { v: 'P. SEXUALES', colspan: 2 }, { v: 'GESTA', colspan: 2 },
        { v: 'PARA', colspan: 2 }, { v: 'CESÁREA', colspan: 2 }, { v: 'ABORTOS', colspan: 2 }
      ]);
      addRow([
        { v: this.ginecoObstetricos.ivsa || '', colspan: 2 }, { v: this.ginecoObstetricos.pSexuales || '', colspan: 2 },
        { v: this.ginecoObstetricos.gesta || '', colspan: 2 }, { v: this.ginecoObstetricos.para || '', colspan: 2 },
        { v: this.ginecoObstetricos.cesarea || '', colspan: 2 }, { v: this.ginecoObstetricos.abortos || '', colspan: 2 }
      ]);
      addRow([
        { v: 'M.P.F', colspan: 4 }, { v: 'FECHA PAP', colspan: 4 }, { v: 'RESULTADO', colspan: 4 }
      ]);
      addRow([
        { v: this.ginecoObstetricos.mpf || '', colspan: 4 }, { v: this.ginecoObstetricos.fechaPap || '', colspan: 4 },
        { v: this.ginecoObstetricos.resultado || '', colspan: 4 }
      ]);
      addRow([{ v: 'OBSERVACIONES: ' + (this.ginecoObstetricos.observaciones || ''), colspan: 12 }]);
    }

    // === EXPLORACIÓN FÍSICA ===
    addRow([{ v: `${seccionExploracion}. EXPLORACIÓN FÍSICA`, colspan: 12 }]);
    addRow([
      { v: 'PESO', colspan: 1 }, { v: (this.exploracionFisica.peso || '') + ' Kg', colspan: 1 },
      { v: 'TALLA', colspan: 1 }, { v: (this.exploracionFisica.talla || '') + ' cm', colspan: 1 },
      { v: 'IMC', colspan: 1 }, { v: this.exploracionFisica.imc || '', colspan: 1 },
      { v: 'FC', colspan: 1 }, { v: this.exploracionFisica.fc || '', colspan: 1 },
      { v: 'FR', colspan: 1 }, { v: this.exploracionFisica.fr || '', colspan: 1 },
      { v: 'TA', colspan: 1 }, { v: this.obtenerLecturaTensionArterialTexto() || '', colspan: 1 }
    ]);
    addRow([
      { v: 'TEMP', colspan: 1 }, { v: (this.exploracionFisica.temp || '') + ' °C', colspan: 2 },
      { v: 'LATERALIDAD', colspan: 1 }, { v: this.exploracionFisica.lateralidad || '', colspan: 2 },
      { v: 'SatO2', colspan: 1 }, { v: this.exploracionFisica.satO2 || '', colspan: 2 },
      { v: 'GLUCOSA', colspan: 1 }, { v: this.exploracionFisica.glucosa || '', colspan: 2 }
    ]);
    addRow([{ v: 'OBSERVACIONES: ' + (this.exploracionFisica.observaciones || ''), colspan: 12 }]);
    // Órganos/Sistemas
    addRow([
      { v: 'ÓRGANO/SISTEMA', colspan: 4 }, { v: 'RESULTADO', colspan: 2 }, { v: 'HALLAZGOS', colspan: 6 }
    ]);
    const organosNames = [
      'CABEZA Y CUELLO', 'OJOS (CONJUNT., CÓRNEAS)', 'OÍDOS (PABELLÓN, C. AUD.)',
      'NARIZ (CORNETES, TABIQUE)', 'OROFARINGE (AMÍGD., MUCOSA)',
      'TÓRAX (R. CARDÍACOS, VENT.)', 'ABDOMEN (PARED ABD., VÍSC.)',
      'EXTREMIDADES (FUERZA, EDEMA)', 'NEUROLÓGICO (COL., MARCHA)',
      'PIEL (CICATR., TATUAJES)'
    ];
    for (let i = 0; i < this.organosSistemas.length; i++) {
      const org = this.organosSistemas[i];
      if (i === 1) { // OJOS - special row
        addRow([
          { v: organosNames[i], colspan: 4 }, { v: org.resultado || '', colspan: 2 },
          { v: 'AGUD. VIS.  O.D.: ' + (org.agudVisualOD || '') + '  O.I.: ' + (org.agudVisualOI || '') + (org.agudVisualConCorreccion ? '  Con corrección (anteojos)' : ''), colspan: 6 }
        ]);
      } else if (i === 8) { // NEUROLÓGICO - special row
        addRow([
          { v: organosNames[i], colspan: 4 }, { v: org.resultado || '', colspan: 2 },
          { v: 'ROMBERG: ' + (org.romberg || '') + '  ' + (org.hallazgos || ''), colspan: 6 }
        ]);
      } else {
        addRow([
          { v: organosNames[i], colspan: 4 }, { v: org.resultado || '', colspan: 2 },
          { v: org.hallazgos || '', colspan: 6 }
        ]);
      }
    }

    // === PARACLÍNICOS ===
    addRow([{ v: `${seccionParaclinicos}. PARACLÍNICOS`, colspan: 12 }]);
    const paraclinicosList = [
      { label: 'TELE-TÓRAX', value: this.paraclinicos.teleTorax },
      { label: 'COLUMNA', value: this.paraclinicos.columna },
      { label: 'BIOMETRÍA', value: this.paraclinicos.biometria },
      { label: 'CLÍNICA SANGUÍNEA', value: this.paraclinicos.clinicaSanguinea },
      { label: 'AUDIOMETRÍA', value: this.paraclinicos.audiometria },
      { label: 'ESPIROMETRÍA', value: this.paraclinicos.espirometria }
    ];
    for (const pc of paraclinicosList) {
      addRow([
        { v: pc.label, colspan: 4 },
        { v: pc.value || 'Sin resultado', colspan: 8 }
      ]);
    }
    addRow([{ v: 'OBSERVACIONES: ' + (this.paraclinicos.resultado || ''), colspan: 12 }]);

    // === DIAGNÓSTICO Y TRATAMIENTO ===
    addRow([{ v: `${seccionDiagnostico}. DIAGNÓSTICO Y TRATAMIENTO`, colspan: 12 }]);
    addRow([
      { v: '#', colspan: 1 }, { v: 'DIAGNÓSTICO', colspan: 5 }, { v: 'RECOMENDACIÓN MÉDICA', colspan: 6 }
    ]);
    for (let i = 0; i < this.diagnosticos.length; i++) {
      addRow([
        { v: String(i + 1), colspan: 1 },
        { v: this.diagnosticos[i].diagnostico || '', colspan: 5 },
        { v: this.diagnosticos[i].recomendacion || '', colspan: 6 }
      ]);
    }
    if (this.diagnosticos.length === 0) {
      addRow([{ v: '1', colspan: 1 }, { v: '', colspan: 5 }, { v: '', colspan: 6 }]);
    }
    addRow([{ v: 'OBSERVACIONES: ' + (this.observacionesDiagnostico || ''), colspan: 12 }]);

    // === PERSONAL QUE ELABORÓ ===
    addRow([{ v: 'PERSONAL QUE ELABORÓ LA HISTORIA CLÍNICA:', colspan: 12 }]);
    addRow([{ v: 'Dr. ' + (this.personalElaboroHistoria || ''), colspan: 4 }, { v: 'CED. PROF.: ' + (this.cedulaProfesional || ''), colspan: 4 }, { v: 'FIRMA:', colspan: 4 }]);

    // ===== BUILD WORKSHEET =====
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;

    // Column widths (12 columns, ~7.5 chars each for letter size)
    ws['!cols'] = Array(C).fill({ wch: 9 });

    // Apply styles via cell formatting (border + alignment)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: R, c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        // Ensure all cells are strings
        if (ws[addr].t !== 's') { ws[addr].v = String(ws[addr].v); ws[addr].t = 's'; }
      }
    }

    // Row heights
    ws['!rows'] = rows.map((_, idx) => {
      // Section headers get a bit taller
      const firstCell = rows[idx][0] || '';
      if (typeof firstCell === 'string' && /^\d\. /.test(firstCell)) {
        return { hpt: 20 };
      }
      if (idx === 0) return { hpt: 25 }; // Title
      return { hpt: 16 };
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Historia Clínica');

    // Generate filename
    const nombre = (this.formulario.nombre || 'sin-nombre').replace(/\s+/g, '_');
    const fecha = this.formulario.fechaElaboracion || obtenerFechaHoyLocal();
    const fileName = `Historia_Clinica_${nombre}_${fecha}.xlsx`;

    XLSX.writeFile(wb, fileName);
  }

  // =====================================================
  // GUARDAR HISTORIA CLÍNICA EN BD
  // =====================================================

  private esActualizacionDirecta(): boolean {
    return !!this.editandoHistoriaId && !this.modoEdicionDesdeHistorial;
  }

  private agregarHistoriaCreadaAlHistorialLocal(nuevoId: number): void {
    if (!nuevoId) {
      return;
    }

    const ahoraIso = new Date().toISOString();
    const nuevoRegistro = {
      id: nuevoId,
      nombre: this.formulario?.nombre || '',
      matricula: this.formulario?.matricula || '',
      area: this.formulario?.area || '',
      tipo_historia: this.formulario?.tipoHistoria || '',
      fecha_elaboracion: this.formulario?.fechaElaboracion || ahoraIso.split('T')[0],
      created_at: ahoraIso,
      personal_elaboro: this.personalElaboroHistoria || '',
      empresa_id: this.empresaSeleccionada?.empresa_id || null
    };

    const indiceExistente = this.historiasClinicas.findIndex((historia: any) => Number(historia?.id) === Number(nuevoId));
    if (indiceExistente >= 0) {
      this.historiasClinicas[indiceExistente] = {
        ...this.historiasClinicas[indiceExistente],
        ...nuevoRegistro
      };
    } else {
      this.historiasClinicas = [nuevoRegistro, ...this.historiasClinicas];
    }

    this.aplicarFiltros();
  }

  guardarHistoriaClinicaBD(): void {
    this.aplicarDefaultsAntecedentesLaboralesSiVacio();
    this.actualizarIndiceHacinamientoVivienda();
    this.actualizarPromiscuidadDesdePSUltimos6Meses();
    this.sincronizarObservacionesDiagnosticoConsolidadas(true);
    this.sincronizarDiagnosticosAutomaticos();
    this.actualizarRecomendacionEjercicio();
    this.guardando = true;

    const payload: any = {
      // Paso 1
      tipo_historia: this.formulario.tipoHistoria,
      fecha_elaboracion: this.formulario.fechaElaboracion,
      matricula: this.formulario.matricula,
      area: this.formulario.area,
      nombre: this.formulario.nombre,
      genero: this.formulario.genero,
      religion: this.formulario.religion,
      escolaridad: this.formulario.escolaridad,
      estado_civil: this.formulario.estadoCivil,
      edad: this.formulario.edad,
      lugar_nacimiento: this.formulario.lugarNacimiento,
      telefono: this.formulario.telefono,
      domicilio: this.formulario.domicilio,
      contacto_emergencia_nombre: this.formulario.contactoEmergenciaNombre,
      contacto_emergencia_telefono: this.formulario.contactoEmergenciaTelefono,

      // Paso 2
      observaciones_laborales: this.observacionesLaborales,
      antecedentes_laborales: this.antecedentesLaborales.map(al => ({
        empresa: al.empresa,
        puesto: al.puesto,
        tiempo: al.tiempo,
        epp_visual: al.eppVisual,
        epp_auditivo: al.eppAuditivo,
        epp_respiratorio: al.eppRespiratorio,
        epp_no_aplica: al.eppNoAplica,
        enfermedad_trabajo: al.enfermedadTrabajo,
        accidente_trabajo: al.accidenteTrabajo
      })),

      // Paso 3
      hf_diabetes: this.heredoFamiliares['diabetes'],
      hf_hipertension: this.heredoFamiliares['hipertension'],
      hf_cancer: this.heredoFamiliares['cancer'],
      hf_cardiacos: this.heredoFamiliares['cardiacos'],
      hf_asma: this.heredoFamiliares['asma'],
      hf_alergias: this.heredoFamiliares['alergias'],
      hf_renales: this.heredoFamiliares['renales'],
      hf_convulsiones: this.heredoFamiliares['convulsiones'],
      hf_auditivas: this.heredoFamiliares['auditivas'],
      hf_visuales: this.heredoFamiliares['visuales'],
      observaciones_heredo_familiares: this.observacionesHeredoFamiliares,
      hf_madre: this.heredoFamiliaresMadre,
      hf_padre: this.heredoFamiliaresPadre,

      // Paso 4
      tab_fumo: this.tabaquismo.fumo,
      tab_fuma: this.tabaquismo.fuma,
      tab_cigarros: this.tabaquismo.cigarros,
      tab_intervalo_tiempo: this.tabaquismo.intervaloTiempo,
      tab_exposicion: this.tabaquismo.negado ? 'NEGADO' : '',
      indice_tabaquico: this.indiceTabaquico,
      alc_bebio: this.alcoholismo.bebio,
      alc_bebe: this.alcoholismo.bebe,
      alc_una_vez: this.alcoholismo.negado ? '' : this.alcoholismo.unaVez,
      alc_tipo: this.alcoholismo.negado ? 'NEGADO' : '',
      alc_intervalo_tiempo: this.alcoholismo.negado ? '' : this.alcoholismo.intervaloTiempo,
      drg_consumio: this.otrasDrogas.negado ? false : this.otrasDrogas.consumio,
      drg_consume: this.otrasDrogas.negado ? false : this.otrasDrogas.consume,
      drg_tipo: this.otrasDrogas.negado ? 'NEGADO' : this.otrasDrogas.tipo,
      drg_intervalo_tiempo: this.otrasDrogas.negado ? '' : this.otrasDrogas.intervaloTiempo,
      ej_realiza: this.ejercicio.realiza,
      ej_tipo: this.ejercicio.tipo,
      ej_horas_dia_minutos_semana: this.ejercicio.horasDiaMinutosSemana,
      ej_alcanza_recomendacion: this.ejercicio.alcanzaRecomendacion,
      ej_tiempo_practicarlo: this.ejercicio.tiempoPracticarlo,
      sueno_minimo: this.sueno.minimo,
      sueno_maximo: this.sueno.maximo,
      sueno_promedio: this.sueno.promedio,
      tareas_domesticas: this.tareasDomesticas,
      actividades_tiempo_libre: this.actividadesTiempoLibre,
      tipo_sanguineo: this.tipoSanguineo,
      vac_sarampion: this.vacunas.sarampion,
      vac_rubeola: this.vacunas.rubeola,
      vac_influenza: this.vacunas.influenza,
      vac_toxoide_tetanico: this.vacunas.toxoideTetanico,
      vac_covid: this.vacunas.covid,
      vac_otras: this.vacunas.otras,
      hig_bano_diario: this.habitosHigiene.banoDiario,
      hig_aseo_bucal: this.habitosHigiene.aseoBucal,
      hig_comidas_al_dia: this.habitosHigiene.comidasAlDia,
      hig_desparasitacion: this.habitosHigiene.desparasitacion,
      hig_hacinamiento: this.habitosHigiene.hacinamiento,
      hig_promiscuidad: this.habitosHigiene.promiscuidad,
      hig_zoonosis: this.habitosHigiene.zoonosis,
      hig_zoonosis_animal: this.habitosHigiene.zoonosisAnimal,
      hig_perforaciones: this.habitosHigiene.perforaciones,
      hig_perforaciones_zonas: this.habitosHigiene.perforacionesZonas,
      hig_dormitorios: this.habitosHigiene.dormitorios,
      hig_habitantes: this.habitosHigiene.habitantes,
      hig_ps_ultimos_6_meses: this.habitosHigiene.psUltimos6Meses,
      hig_observaciones_vivienda: this.habitosHigiene.observacionesVivienda,
      tat_tiene: this.tatuajes.negado ? false : this.tatuajes.tiene,
      tat_visible: this.tatuajes.visible,
      tat_zona: this.tatuajes.negado ? 'NEGADO' : this.tatuajes.zona,
      observaciones_no_patologicos: this.observacionesNoPatologicos,

      // Paso 5
      ei_sarampion: this.enfermedadesInfantiles.sarampion,
      ei_rubeola: this.enfermedadesInfantiles.rubeola,
      ei_varicela: this.enfermedadesInfantiles.varicela,
      ei_parotiditis: this.enfermedadesInfantiles.parotiditis,
      ei_hepatitis: this.enfermedadesInfantiles.hepatitis,
      ei_covid: this.enfermedadesInfantiles.covid,
      ei_influenza: this.enfermedadesInfantiles.influenza,
      ei_otra: this.enfermedadesInfantiles.otra,
      pv_tiene: this.problemasVista.negado ? false : this.problemasVista.tiene,
      pv_cual: this.problemasVista.negado ? 'NEGADO' : this.problemasVista.cual,
      pv_uso_lentes: this.problemasVista.negado ? false : this.problemasVista.usoLentes,
      pa_tiene: this.problemasAuditivos.negado ? false : this.problemasAuditivos.tiene,
      pa_cual: this.problemasAuditivos.negado ? 'NEGADO' : this.problemasAuditivos.cual,
      pa_uso_audifonos: this.problemasAuditivos.negado ? false : this.problemasAuditivos.usoAudifonos,
      observaciones_patologicos: this.observacionesPatologicos,
      enf_congenitas: this.enfermedades.congenitas?.tiene,
      enf_congenitas_cual: this.enfermedades.congenitas?.cual,
      enf_dentales: this.enfermedades.dentales?.tiene,
      enf_dentales_cual: this.enfermedades.dentales?.cual,
      enf_endocrinas: this.enfermedades.endocrinas?.tiene,
      enf_endocrinas_cual: this.enfermedades.endocrinas?.cual,
      enf_pulmonares: this.enfermedades.pulmonares?.tiene,
      enf_pulmonares_cual: this.enfermedades.pulmonares?.cual,
      enf_cardiovasculares: this.enfermedades.cardiovasculares?.tiene,
      enf_cardiovasculares_cual: this.enfermedades.cardiovasculares?.cual,
      enf_digestivas: this.enfermedades.digestivas?.tiene,
      enf_digestivas_cual: this.enfermedades.digestivas?.cual,
      enf_urinarias: this.enfermedades.urinarias?.tiene,
      enf_urinarias_cual: this.enfermedades.urinarias?.cual,
      enf_musculo_esqueleticas: this.enfermedades.musculoEsqueleticas?.tiene,
      enf_musculo_esqueleticas_cual: this.enfermedades.musculoEsqueleticas?.cual,
      enf_dermatologicas: this.enfermedades.dermatologicas?.tiene,
      enf_dermatologicas_cual: this.enfermedades.dermatologicas?.cual,
      enf_infecto_contagiosas: this.enfermedades.infectoContagiosas?.tiene,
      enf_infecto_contagiosas_cual: this.enfermedades.infectoContagiosas?.cual,
      enf_psiquiatricas: this.enfermedades.psiquiatricas?.tiene,
      enf_psiquiatricas_cual: this.enfermedades.psiquiatricas?.cual,
      enf_otras: this.enfermedades.otrasEnfermedades?.tiene,
      enf_otras_cual: this.enfermedades.otrasEnfermedades?.cual,
      enf_alergias: this.enfermedades.alergias?.tiene,
      enf_alergias_cual: this.enfermedades.alergias?.cual,
      cirugias: this.cirugias,
      transfusiones: this.transfusiones,
      traumaticos: this.traumaticos,
      ingresos_hospitalarios: this.ingresosHospitalarios,

      // Paso 6
      go_menarca: this.ginecoObstetricos.menarca,
      go_ciclo: this.ginecoObstetricos.ciclo,
      go_fum: this.ginecoObstetricos.fum || null,
      go_dismenorrea: this.ginecoObstetricos.dismenorreaSi ? 'SI' : '',
      go_ivsa: this.ginecoObstetricos.ivsa,
      go_p_sexuales: this.ginecoObstetricos.pSexuales,
      go_gesta: this.ginecoObstetricos.gesta,
      go_para: this.ginecoObstetricos.para,
      go_cesarea: this.ginecoObstetricos.cesarea,
      go_abortos: this.ginecoObstetricos.abortos,
      go_mpf: this.ginecoObstetricos.mpf,
      go_fecha_pap: this.ginecoObstetricos.fechaPap || null,
      go_resultado: this.ginecoObstetricos.resultado,
      go_observaciones: this.ginecoObstetricos.observaciones,

      // Paso 7
      ef_peso: this.exploracionFisica.peso,
      ef_talla: this.exploracionFisica.talla,
      ef_imc: this.exploracionFisica.imc,
      ef_fc: this.exploracionFisica.fc,
      ef_fr: this.exploracionFisica.fr,
      ef_glucosa: this.exploracionFisica.glucosa,
      ef_ta: this.obtenerLecturaTensionArterialTexto(),
      ef_sat_o2: this.exploracionFisica.satO2,
      ef_temp: this.exploracionFisica.temp,
      ef_lateralidad: this.exploracionFisica.lateralidad,
      ef_grasa_corporal: this.exploracionFisica.grasaCorporal,
      ef_musculo: this.exploracionFisica.musculo,
      ef_grasa_visceral: this.exploracionFisica.grasaVisceral,
      ef_edad_metabolica: this.exploracionFisica.edadMetabolica,
      ef_metabolismo_basal: this.exploracionFisica.metabolismoBasal,
      ef_observaciones: this.exploracionFisica.observaciones,
      os_cabeza_cuello_resultado: this.organosSistemas[0].resultado,
      os_cabeza_cuello_hallazgos: this.organosSistemas[0].hallazgos,
      os_ojos_resultado: this.organosSistemas[1].resultado,
      os_ojos_agud_visual_od: this.organosSistemas[1].agudVisualOD,
      os_ojos_agud_visual_oi: this.organosSistemas[1].agudVisualOI,
      os_ojos_agud_visual_con_correccion: !!this.organosSistemas[1].agudVisualConCorreccion,
      os_ojos_hallazgos: this.organosSistemas[1].hallazgos,
      os_oidos_resultado: this.organosSistemas[2].resultado,
      os_oidos_hallazgos: this.organosSistemas[2].hallazgos,
      os_nariz_resultado: this.organosSistemas[3].resultado,
      os_nariz_hallazgos: this.organosSistemas[3].hallazgos,
      os_orofaringe_resultado: this.organosSistemas[4].resultado,
      os_orofaringe_hallazgos: this.organosSistemas[4].hallazgos,
      os_torax_resultado: this.organosSistemas[5].resultado,
      os_torax_hallazgos: this.organosSistemas[5].hallazgos,
      os_abdomen_resultado: this.organosSistemas[6].resultado,
      os_abdomen_hallazgos: this.organosSistemas[6].hallazgos,
      os_extremidades_resultado: this.organosSistemas[7].resultado,
      os_extremidades_hallazgos: this.organosSistemas[7].hallazgos,
      os_neurologico_resultado: this.organosSistemas[8].resultado,
      os_neurologico_romberg: this.organosSistemas[8].romberg,
      os_neurologico_hallazgos: this.organosSistemas[8].hallazgos,
      os_piel_resultado: this.organosSistemas[9].resultado,
      os_piel_hallazgos: this.organosSistemas[9].hallazgos,

      // Paso 8
      pc_tele_torax: this.paraclinicos.teleTorax,
      pc_columna: this.paraclinicos.columna,
      pc_biometria: this.paraclinicos.biometria,
      pc_clinica_sanguinea: this.paraclinicos.clinicaSanguinea,
      pc_glucosa: this.paraclinicos.clinicaSanguinea,
      pc_quimica_s: this.paraclinicos.quimicaS,
      pc_audiometria: this.paraclinicos.audiometria,
      pc_espirometria: this.paraclinicos.espirometria,
      pc_resultado: this.paraclinicos.resultado,

      // Paso 9
      diagnosticos: this.diagnosticos.map((d, i) => ({
        diagnostico: d.diagnostico,
        recomendacion: d.recomendacion
      })),
      observaciones_diagnostico: this.observacionesDiagnostico,
      personal_elaboro: this.personalElaboroHistoria,
      cedula_profesional: this.cedulaProfesional,
      firma_url: this.convertirADriveUrl(this.firmaUrlDoctor) || null,
      instructor_id: this.authService.getInstructorId() || null,
      empresa_id: this.empresaSeleccionada?.empresa_id || null
    };

    const esActualizacion = this.esActualizacionDirecta();
    const operacion = esActualizacion
      ? this.backendServices.actualizarHistoriaClinica(this.editandoHistoriaId as number, payload)
      : this.backendServices.guardarHistoriaClinica(payload);

    operacion.subscribe({
      next: (resp: any) => {
        this.guardando = false;
        if (resp.success) {
          const folioOrigen = this.folioOrigenEdicion;
          this.historiaActualId = resp.id || (esActualizacion ? this.editandoHistoriaId : null);
          if (!esActualizacion && resp.id) {
            this.agregarHistoriaCreadaAlHistorialLocal(resp.id);
          }
          this.editandoHistoriaId = null;
          this.modoEdicionDesdeHistorial = false;
          this.folioOrigenEdicion = '';
          Swal.fire({
            title: esActualizacion ? '¡Actualizado!' : '¡Guardado!',
            text: esActualizacion
              ? 'Historia clínica actualizada correctamente.'
              : (folioOrigen
                ? `Se creó una nueva historia clínica basada en ${folioOrigen} (ID: ${resp.id}).`
                : `Historia clínica guardada correctamente (ID: ${resp.id})`),
            icon: 'success',
            confirmButtonColor: '#38512F',
            confirmButtonText: 'Aceptar'
          });
        }
      },
      error: (err) => {
        this.guardando = false;
        console.error('Error al guardar:', err);
        Swal.fire({
          title: 'Error',
          text: 'No se pudo guardar la historia clínica. Intente de nuevo.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  finalizarHistoriaClinica(): void {
    this.intentoGuardar = true;

    if (!this.validarTodo()) {
      for (let paso = 1; paso <= this.totalPasos; paso++) {
        const campos = this.camposPorPaso[paso] || [];
        if (campos.some(c => !!this.errores[c])) {
          this.pasoActual = paso;
          break;
        }
      }
      Swal.fire({
        title: 'Formulario incompleto',
        text: 'Revise los campos marcados en rojo.',
        icon: 'warning',
        confirmButtonColor: '#38512F',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const esActualizacion = this.esActualizacionDirecta();
    const esClonadoDesdeHistorial = this.modoEdicionDesdeHistorial;

    Swal.fire({
      title: esClonadoDesdeHistorial ? '¿Crear nueva historia clínica editada?' : '¿Finalizar Historia Clínica?',
      text: esClonadoDesdeHistorial
        ? `Se creará una nueva historia clínica con folio nuevo. La historia original (${this.folioOrigenEdicion || 'folio previo'}) no será modificada.`
        : 'La historia clínica se guardará en la base de datos y no se podrá editar después.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#0f3661',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: esClonadoDesdeHistorial ? 'Sí, crear nueva historia' : 'Sí, finalizar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.guardando = true;
        const payload = this.construirPayload();

        const operacion = esActualizacion
          ? this.backendServices.actualizarHistoriaClinica(this.editandoHistoriaId as number, payload)
          : this.backendServices.guardarHistoriaClinica(payload);

        operacion.subscribe({
          next: (resp: any) => {
            this.guardando = false;
            if (resp.success) {
              const origenPreviewDestino: 'formulario' | 'historial' = esClonadoDesdeHistorial ? 'historial' : 'formulario';
              this.historiaActualId = resp.id || (esActualizacion ? this.editandoHistoriaId : null);
              if (!esActualizacion && resp.id) {
                this.agregarHistoriaCreadaAlHistorialLocal(resp.id);
              }
              this.editandoHistoriaId = null;
              this.modoEdicionDesdeHistorial = false;
              this.folioOrigenEdicion = '';
              Swal.fire({
                title: '¡Guardado!',
                text: esClonadoDesdeHistorial
                  ? 'Se creó una nueva historia clínica. Generando vista previa...'
                  : 'Historia clínica guardada correctamente. Generando vista previa...',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
              }).then(() => {
                this.generarVistaPrevia(origenPreviewDestino);
              });
            }
          },
          error: (err) => {
            this.guardando = false;
            Swal.fire({
              title: 'Error',
              text: 'No se pudo guardar. Intente de nuevo.',
              icon: 'error',
              confirmButtonColor: '#38512F'
            });
          }
        });
      }
    });
  }

  guardarYGenerarPreview(): void {
    this.guardando = true;
    const payload = this.construirPayload();
    const esActualizacion = this.esActualizacionDirecta();
    const esClonadoDesdeHistorial = this.modoEdicionDesdeHistorial;
    const origenPreviewDestino: 'formulario' | 'historial' = esClonadoDesdeHistorial ? 'historial' : 'formulario';

    const operacion = esActualizacion
      ? this.backendServices.actualizarHistoriaClinica(this.editandoHistoriaId as number, payload)
      : this.backendServices.guardarHistoriaClinica(payload);

    operacion.subscribe({
      next: (resp: any) => {
        this.guardando = false;
        if (resp.success) {
          this.historiaActualId = resp.id || (esActualizacion ? this.editandoHistoriaId : null);
          if (!esActualizacion && resp.id) {
            this.agregarHistoriaCreadaAlHistorialLocal(resp.id);
          }
          this.editandoHistoriaId = null;
          this.modoEdicionDesdeHistorial = false;
          this.folioOrigenEdicion = '';
          Swal.fire({
            title: esActualizacion ? '¡Actualizado!' : '¡Guardado!',
            text: esActualizacion
              ? 'Historia clínica actualizada. Generando vista previa...'
              : (esClonadoDesdeHistorial
                ? 'Nueva historia clínica creada desde historial. Generando vista previa...'
                : 'Historia clínica guardada. Generando vista previa...'),
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
          }).then(() => {
            this.generarVistaPrevia(origenPreviewDestino);
          });
        }
      },
      error: (err) => {
        this.guardando = false;
        Swal.fire({
          title: 'Error',
          text: 'No se pudo guardar. Intente de nuevo.',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    });
  }

  private construirPayload(): any {
    this.aplicarDefaultsAntecedentesLaboralesSiVacio();
    this.actualizarIndiceHacinamientoVivienda();
    this.actualizarPromiscuidadDesdePSUltimos6Meses();
    this.sincronizarObservacionesDiagnosticoConsolidadas(true);
    this.sincronizarDiagnosticosAutomaticos();
    this.actualizarRecomendacionEjercicio();

    // Reutiliza la misma lógica que guardarHistoriaClinicaBD
    return {
      tipo_historia: this.formulario.tipoHistoria,
      fecha_elaboracion: this.formulario.fechaElaboracion,
      matricula: this.formulario.matricula,
      area: this.formulario.area,
      nombre: this.formulario.nombre,
      genero: this.formulario.genero,
      religion: this.formulario.religion,
      escolaridad: this.formulario.escolaridad,
      estado_civil: this.formulario.estadoCivil,
      edad: this.formulario.edad,
      lugar_nacimiento: this.formulario.lugarNacimiento,
      telefono: this.formulario.telefono,
      domicilio: this.formulario.domicilio,
      contacto_emergencia_nombre: this.formulario.contactoEmergenciaNombre,
      contacto_emergencia_telefono: this.formulario.contactoEmergenciaTelefono,
      observaciones_laborales: this.observacionesLaborales,
      antecedentes_laborales: this.antecedentesLaborales.map(al => ({
        empresa: al.empresa, puesto: al.puesto, tiempo: al.tiempo,
        epp_visual: al.eppVisual, epp_auditivo: al.eppAuditivo, epp_respiratorio: al.eppRespiratorio,
        epp_no_aplica: al.eppNoAplica,
        enfermedad_trabajo: al.enfermedadTrabajo, accidente_trabajo: al.accidenteTrabajo
      })),
      hf_diabetes: this.heredoFamiliares['diabetes'], hf_hipertension: this.heredoFamiliares['hipertension'],
      hf_cancer: this.heredoFamiliares['cancer'], hf_cardiacos: this.heredoFamiliares['cardiacos'],
      hf_asma: this.heredoFamiliares['asma'], hf_alergias: this.heredoFamiliares['alergias'],
      hf_renales: this.heredoFamiliares['renales'], hf_convulsiones: this.heredoFamiliares['convulsiones'],
      hf_auditivas: this.heredoFamiliares['auditivas'], hf_visuales: this.heredoFamiliares['visuales'],
      observaciones_heredo_familiares: this.observacionesHeredoFamiliares,
      hf_madre: this.heredoFamiliaresMadre,
      hf_padre: this.heredoFamiliaresPadre,
      tab_fumo: this.tabaquismo.fumo, tab_fuma: this.tabaquismo.fuma,
      tab_cigarros: this.tabaquismo.cigarros, tab_intervalo_tiempo: this.tabaquismo.intervaloTiempo,
      tab_exposicion: this.tabaquismo.negado ? 'NEGADO' : '',
      indice_tabaquico: this.indiceTabaquico,
      alc_bebio: this.alcoholismo.bebio, alc_bebe: this.alcoholismo.bebe,
      alc_una_vez: this.alcoholismo.negado ? '' : this.alcoholismo.unaVez,
      alc_tipo: this.alcoholismo.negado ? 'NEGADO' : '',
      alc_intervalo_tiempo: this.alcoholismo.negado ? '' : this.alcoholismo.intervaloTiempo,
      drg_consumio: this.otrasDrogas.negado ? false : this.otrasDrogas.consumio,
      drg_consume: this.otrasDrogas.negado ? false : this.otrasDrogas.consume,
      drg_tipo: this.otrasDrogas.negado ? 'NEGADO' : this.otrasDrogas.tipo,
      drg_intervalo_tiempo: this.otrasDrogas.negado ? '' : this.otrasDrogas.intervaloTiempo,
      ej_realiza: this.ejercicio.realiza, ej_tipo: this.ejercicio.tipo,
      ej_horas_dia_minutos_semana: this.ejercicio.horasDiaMinutosSemana,
      ej_alcanza_recomendacion: this.ejercicio.alcanzaRecomendacion,
      ej_tiempo_practicarlo: this.ejercicio.tiempoPracticarlo,
      sueno_minimo: this.sueno.minimo, sueno_maximo: this.sueno.maximo, sueno_promedio: this.sueno.promedio,
      actividades_tiempo_libre: this.actividadesTiempoLibre,
      tipo_sanguineo: this.tipoSanguineo,
      vac_sarampion: this.vacunas.sarampion, vac_rubeola: this.vacunas.rubeola,
      vac_influenza: this.vacunas.influenza, vac_toxoide_tetanico: this.vacunas.toxoideTetanico,
      vac_covid: this.vacunas.covid,
      vac_otras: this.vacunas.otras,
      hig_bano_diario: this.habitosHigiene.banoDiario, hig_aseo_bucal: this.habitosHigiene.aseoBucal,
      hig_comidas_al_dia: this.habitosHigiene.comidasAlDia, hig_desparasitacion: this.habitosHigiene.desparasitacion,
      hig_hacinamiento: this.habitosHigiene.hacinamiento, hig_promiscuidad: this.habitosHigiene.promiscuidad,
      hig_zoonosis: this.habitosHigiene.zoonosis,
      hig_zoonosis_animal: this.habitosHigiene.zoonosisAnimal,
      hig_perforaciones: this.habitosHigiene.perforaciones,
      hig_perforaciones_zonas: this.habitosHigiene.perforacionesZonas,
      hig_dormitorios: this.habitosHigiene.dormitorios,
      hig_habitantes: this.habitosHigiene.habitantes,
      hig_ps_ultimos_6_meses: this.habitosHigiene.psUltimos6Meses,
      hig_observaciones_vivienda: this.habitosHigiene.observacionesVivienda,
      tat_tiene: this.tatuajes.negado ? false : this.tatuajes.tiene,
      tat_zona: this.tatuajes.negado ? 'NEGADO' : this.tatuajes.zona,
      observaciones_no_patologicos: this.observacionesNoPatologicos,
      ei_sarampion: this.enfermedadesInfantiles.sarampion, ei_rubeola: this.enfermedadesInfantiles.rubeola,
      ei_varicela: this.enfermedadesInfantiles.varicela, ei_parotiditis: this.enfermedadesInfantiles.parotiditis,
      ei_hepatitis: this.enfermedadesInfantiles.hepatitis,
      ei_covid: this.enfermedadesInfantiles.covid,
      ei_influenza: this.enfermedadesInfantiles.influenza,
      ei_otra: this.enfermedadesInfantiles.otra,
      pv_tiene: this.problemasVista.negado ? false : this.problemasVista.tiene,
      pv_cual: this.problemasVista.negado ? 'NEGADO' : this.problemasVista.cual,
      pv_uso_lentes: this.problemasVista.negado ? false : this.problemasVista.usoLentes,
      pa_tiene: this.problemasAuditivos.negado ? false : this.problemasAuditivos.tiene,
      pa_cual: this.problemasAuditivos.negado ? 'NEGADO' : this.problemasAuditivos.cual,
      pa_uso_audifonos: this.problemasAuditivos.negado ? false : this.problemasAuditivos.usoAudifonos,
      observaciones_patologicos: this.observacionesPatologicos,
      enf_congenitas: this.enfermedades.congenitas?.tiene, enf_congenitas_cual: this.enfermedades.congenitas?.cual,
      enf_dentales: this.enfermedades.dentales?.tiene, enf_dentales_cual: this.enfermedades.dentales?.cual,
      enf_endocrinas: this.enfermedades.endocrinas?.tiene, enf_endocrinas_cual: this.enfermedades.endocrinas?.cual,
      enf_pulmonares: this.enfermedades.pulmonares?.tiene, enf_pulmonares_cual: this.enfermedades.pulmonares?.cual,
      enf_cardiovasculares: this.enfermedades.cardiovasculares?.tiene, enf_cardiovasculares_cual: this.enfermedades.cardiovasculares?.cual,
      enf_digestivas: this.enfermedades.digestivas?.tiene, enf_digestivas_cual: this.enfermedades.digestivas?.cual,
      enf_urinarias: this.enfermedades.urinarias?.tiene, enf_urinarias_cual: this.enfermedades.urinarias?.cual,
      enf_musculo_esqueleticas: this.enfermedades.musculoEsqueleticas?.tiene, enf_musculo_esqueleticas_cual: this.enfermedades.musculoEsqueleticas?.cual,
      enf_dermatologicas: this.enfermedades.dermatologicas?.tiene, enf_dermatologicas_cual: this.enfermedades.dermatologicas?.cual,
      enf_infecto_contagiosas: this.enfermedades.infectoContagiosas?.tiene, enf_infecto_contagiosas_cual: this.enfermedades.infectoContagiosas?.cual,
      enf_psiquiatricas: this.enfermedades.psiquiatricas?.tiene, enf_psiquiatricas_cual: this.enfermedades.psiquiatricas?.cual,
      enf_otras: this.enfermedades.otrasEnfermedades?.tiene, enf_otras_cual: this.enfermedades.otrasEnfermedades?.cual,
      enf_alergias: this.enfermedades.alergias?.tiene, enf_alergias_cual: this.enfermedades.alergias?.cual,
      cirugias: this.cirugias, transfusiones: this.transfusiones,
      traumaticos: this.traumaticos, ingresos_hospitalarios: this.ingresosHospitalarios,
      go_menarca: this.ginecoObstetricos.menarca, go_ciclo: this.ginecoObstetricos.ciclo,
      go_fum: this.ginecoObstetricos.fum || null, go_dismenorrea: this.ginecoObstetricos.dismenorreaSi ? 'SI' : '',
      go_ivsa: this.ginecoObstetricos.ivsa, go_p_sexuales: this.ginecoObstetricos.pSexuales,
      go_gesta: this.ginecoObstetricos.gesta, go_para: this.ginecoObstetricos.para,
      go_cesarea: this.ginecoObstetricos.cesarea, go_abortos: this.ginecoObstetricos.abortos,
      go_mpf: this.ginecoObstetricos.mpf, go_fecha_pap: this.ginecoObstetricos.fechaPap || null,
      go_resultado: this.ginecoObstetricos.resultado, go_observaciones: this.ginecoObstetricos.observaciones,
      ef_peso: this.exploracionFisica.peso, ef_talla: this.exploracionFisica.talla,
      ef_imc: this.exploracionFisica.imc, ef_fc: this.exploracionFisica.fc,
      ef_fr: this.exploracionFisica.fr, ef_glucosa: this.exploracionFisica.glucosa, ef_ta: this.obtenerLecturaTensionArterialTexto(),
      ef_sat_o2: this.exploracionFisica.satO2,
      ef_temp: this.exploracionFisica.temp, ef_lateralidad: this.exploracionFisica.lateralidad,
      ef_grasa_corporal: this.exploracionFisica.grasaCorporal,
      ef_musculo: this.exploracionFisica.musculo,
      ef_grasa_visceral: this.exploracionFisica.grasaVisceral,
      ef_edad_metabolica: this.exploracionFisica.edadMetabolica,
      ef_metabolismo_basal: this.exploracionFisica.metabolismoBasal,
      ef_observaciones: this.exploracionFisica.observaciones,
      os_cabeza_cuello_resultado: this.organosSistemas[0].resultado, os_cabeza_cuello_hallazgos: this.organosSistemas[0].hallazgos,
      os_ojos_resultado: this.organosSistemas[1].resultado, os_ojos_agud_visual_od: this.organosSistemas[1].agudVisualOD,
      os_ojos_agud_visual_oi: this.organosSistemas[1].agudVisualOI,
      os_ojos_agud_visual_con_correccion: !!this.organosSistemas[1].agudVisualConCorreccion,
      os_ojos_hallazgos: this.organosSistemas[1].hallazgos,
      os_oidos_resultado: this.organosSistemas[2].resultado, os_oidos_hallazgos: this.organosSistemas[2].hallazgos,
      os_nariz_resultado: this.organosSistemas[3].resultado, os_nariz_hallazgos: this.organosSistemas[3].hallazgos,
      os_orofaringe_resultado: this.organosSistemas[4].resultado, os_orofaringe_hallazgos: this.organosSistemas[4].hallazgos,
      os_torax_resultado: this.organosSistemas[5].resultado, os_torax_hallazgos: this.organosSistemas[5].hallazgos,
      os_abdomen_resultado: this.organosSistemas[6].resultado, os_abdomen_hallazgos: this.organosSistemas[6].hallazgos,
      os_extremidades_resultado: this.organosSistemas[7].resultado, os_extremidades_hallazgos: this.organosSistemas[7].hallazgos,
      os_neurologico_resultado: this.organosSistemas[8].resultado, os_neurologico_romberg: this.organosSistemas[8].romberg,
      os_neurologico_hallazgos: this.organosSistemas[8].hallazgos,
      os_piel_resultado: this.organosSistemas[9].resultado, os_piel_hallazgos: this.organosSistemas[9].hallazgos,
      pc_tele_torax: this.paraclinicos.teleTorax, pc_columna: this.paraclinicos.columna,
      pc_biometria: this.paraclinicos.biometria,
      pc_clinica_sanguinea: this.paraclinicos.clinicaSanguinea,
      pc_glucosa: this.paraclinicos.clinicaSanguinea,
      pc_quimica_s: this.paraclinicos.quimicaS,
      pc_audiometria: this.paraclinicos.audiometria, pc_espirometria: this.paraclinicos.espirometria,
      pc_resultado: this.paraclinicos.resultado,
      diagnosticos: this.diagnosticos, observaciones_diagnostico: this.observacionesDiagnostico,
      personal_elaboro: this.personalElaboroHistoria,
      cedula_profesional: this.cedulaProfesional,
      firma_url: this.convertirADriveUrl(this.firmaUrlDoctor) || null,
      instructor_id: this.authService.getInstructorId() || null,
      empresa_id: this.empresaSeleccionada?.empresa_id || null
    };
  }

  // =====================================================
  // HISTORIAL — Control y seguimiento
  // =====================================================

  verHistorial(): void {
    this.vistaActual = 'historial';
    this.cargandoHistorial = true;
    this.limpiarFiltros();
    // Filtrar por empresa seleccionada + instructor_id si no es admin
    const filtros: any = {};
    if (this.empresaSeleccionada) {
      filtros.empresa_id = this.empresaSeleccionada.empresa_id;
    }
    if (!this.esAdmin) {
      const instructorId = this.authService.getInstructorId();
      if (instructorId) {
        filtros.instructor_id = instructorId;
      }
    }
    this.backendServices.obtenerHistoriasClinicas(Object.keys(filtros).length > 0 ? filtros : undefined).subscribe({
      next: (resp: any) => {
        this.cargandoHistorial = false;
        this.historiasClinicas = resp.historias || [];
        this.aplicarFiltros();
      },
      error: () => {
        this.cargandoHistorial = false;
        Swal.fire('Error', 'No se pudo cargar el historial.', 'error');
      }
    });
  }

  volverAlMenuDesdeHistorial(): void {
    this.vistaActual = 'menu';
  }

  volverAlMenuDesdePreview(): void {
    if (this.origenPreview === 'historial') {
      this.historiaActualId = null;
      this.historiaSoloLecturaDesdeHistorial = false;
      this.vistaActual = 'historial';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.historiaActualId = null;
    this.historiaSoloLecturaDesdeHistorial = false;
    this.vistaActual = 'menu';
  }

  getFolioHistoria(historia: any): string {
    const id = Number(historia?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return '—';
    }

    const fechaReferencia = historia?.created_at || historia?.fecha_elaboracion;
    const fecha = parsearFechaFlexible(fechaReferencia) || new Date();
    const anio = Number.isNaN(fecha.getTime())
      ? new Date().getFullYear().toString().slice(-2)
      : fecha.getFullYear().toString().slice(-2);

    return `B-HC-${anio}-${String(id).padStart(3, '0')}`;
  }

  private normalizarFolioHistorial(valor: string): string {
    return String(valor || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  }

  getMensajeSinResultadosHistorial(): string {
    const terminoBusqueda = String(this.filtroTexto || '').trim();
    if (!terminoBusqueda) {
      return 'No se encontraron resultados con los filtros aplicados.';
    }

    const folioBuscado = this.normalizarFolioHistorial(terminoBusqueda);
    const pareceFolio = folioBuscado.startsWith('B-HC-') || /^BHC\d{2}\d+$/i.test(folioBuscado.replace(/-/g, ''));
    if (!pareceFolio) {
      return 'No se encontraron resultados con los filtros aplicados.';
    }

    const existeCoincidenciaPorFolio = this.historiasClinicas.some((historia: any) =>
      this.normalizarFolioHistorial(this.getFolioHistoria(historia)).includes(folioBuscado)
    );

    return existeCoincidenciaPorFolio
      ? 'No se encontraron resultados con los filtros aplicados.'
      : 'No se encontró ningún registro con ese folio';
  }

  // --- Filtros ---

  aplicarFiltros(): void {
    let resultado = [...this.historiasClinicas];

    // Filtro por búsqueda unificada (nombre, matrícula o folio)
    if (this.filtroTexto) {
      const texto = this.filtroTexto.toLowerCase().trim();
      const textoFolio = this.normalizarFolioHistorial(this.filtroTexto);
      resultado = resultado.filter(h =>
        (h.nombre || '').toLowerCase().includes(texto) ||
        (h.matricula || '').toLowerCase().includes(texto) ||
        this.normalizarFolioHistorial(this.getFolioHistoria(h)).includes(textoFolio)
      );
    }

    // Filtro por tipo
    if (this.filtroTipo) {
      resultado = resultado.filter(h => h.tipo_historia === this.filtroTipo);
    }

    // Filtro por fecha desde
    if (this.filtroFechaDesde) {
      const desde = obtenerInicioDiaTimestamp(this.filtroFechaDesde);
      resultado = resultado.filter(h => {
        const fecha = fechaSoloDiaATimestamp(h.fecha_elaboracion);
        return desde !== null && fecha >= desde;
      });
    }

    // Aplicar ordenamiento
    resultado.sort((a, b) => {
      let valA = a[this.columnaOrden] || '';
      let valB = b[this.columnaOrden] || '';
      if (this.columnaOrden === 'fecha_elaboracion') {
        valA = fechaSoloDiaATimestamp(valA);
        valB = fechaSoloDiaATimestamp(valB);
      } else if (this.columnaOrden === 'created_at') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      } else {
        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();
      }
      if (valA < valB) return this.ordenAsc ? -1 : 1;
      if (valA > valB) return this.ordenAsc ? 1 : -1;
      return 0;
    });

    this.historiasFiltradas = resultado;
  }

  ordenarPor(columna: string): void {
    if (this.columnaOrden === columna) {
      this.ordenAsc = !this.ordenAsc;
    } else {
      this.columnaOrden = columna;
      this.ordenAsc = true;
    }
    this.aplicarFiltros();
  }

  limpiarFiltros(): void {
    this.filtroTexto = '';
    this.filtroTipo = '';
    this.filtroFechaDesde = '';
    this.columnaOrden = 'created_at';
    this.ordenAsc = false;
    this.aplicarFiltros();
  }

  hayFiltrosActivos(): boolean {
    return !!(this.filtroTexto || this.filtroTipo || this.filtroFechaDesde);
  }

  // --- Estadísticas ---

  contarPorTipo(tipo: string): number {
    return this.historiasClinicas.filter(h => h.tipo_historia === tipo).length;
  }

  // --- Etiquetas y estilos por tipo ---

  getTipoHistoriaLabel(tipo: string): string {
    const map: any = { ingreso: 'Ingreso', periodico: 'Subsecuente', subsecuente: 'Subsecuente', especial: 'Especial', egreso: 'Egreso' };
    return map[tipo] || tipo || '—';
  }

  getTipoBadgeClass(tipo: string): string {
    const map: any = {
      ingreso: 'tipo-ingreso',
      periodico: 'tipo-periodico',
      subsecuente: 'tipo-periodico',
      especial: 'tipo-especial',
      egreso: 'tipo-egreso'
    };
    return map[tipo] || 'tipo-default';
  }

  getTipoIcon(tipo: string): string {
    const map: any = {
      ingreso: 'fa-sign-in-alt',
      periodico: 'fa-sync-alt',
      subsecuente: 'fa-sync-alt',
      especial: 'fa-star',
      egreso: 'fa-sign-out-alt'
    };
    return map[tipo] || 'fa-file';
  }

  // --- Tiempo transcurrido ---

  getTimeSince(dateStr: string): string {
    if (!dateStr) return '';
    const created = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Justo ahora';
    if (diffMins < 60) return `hace ${diffMins} min`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `hace ${diffHrs}h`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 30) return `hace ${diffDays}d`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `hace ${diffMonths} mes${diffMonths > 1 ? 'es' : ''}`;
    const diffYears = Math.floor(diffMonths / 12);
    return `hace ${diffYears} año${diffYears > 1 ? 's' : ''}`;
  }

  // --- Acciones sobre registros ---

  verDetalleHistoria(id: number): void {
    this.backendServices.obtenerHistoriaClinica(id).subscribe({
      next: (resp: any) => {
        if (resp.success) {
          this.historiaActualId = id;
          this.historiaSoloLecturaDesdeHistorial = true;
          this.cargarHistoriaEnFormulario(resp.historia);
          this.aplicarDefaultsAntecedentesLaboralesSiVacio();
          this.origenPreview = 'historial';
          this.vistaActual = 'preview';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      error: () => {
        Swal.fire('Error', 'No se pudo cargar la historia clínica.', 'error');
      }
    });
  }

  editarHistoria(id: number): void {
    this.backendServices.obtenerHistoriaClinica(id).subscribe({
      next: (resp: any) => {
        if (resp.success) {
          const folioOrigen = this.getFolioHistoria(resp.historia || { id });
          this.cargarHistoriaEnFormulario(resp.historia);
          this.aplicarDefaultsAntecedentesLaboralesSiVacio();
          this.sincronizarDiagnosticosAutomaticos();
          this.editandoHistoriaId = id;
          this.modoEdicionDesdeHistorial = true;
          this.folioOrigenEdicion = folioOrigen;
          this.historiaActualId = null;
          this.historiaSoloLecturaDesdeHistorial = false;
          this.pasoActual = 1;
          this.maxPasoAlcanzado = this.pasos.length;
          this.vistaActual = 'formulario';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      error: () => {
        Swal.fire('Error', 'No se pudo cargar la historia clínica para crear la versión editable.', 'error');
      }
    });
  }

  eliminarHistoria(id: number): void {
    Swal.fire({
      title: '¿Eliminar historia clínica?',
      text: 'Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      cancelButtonColor: '#A8A9A2',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.backendServices.eliminarHistoriaClinica(id).subscribe({
          next: () => {
            Swal.fire({
              title: 'Eliminada',
              text: 'La historia clínica fue eliminada correctamente.',
              icon: 'success',
              confirmButtonColor: '#38512F'
            });
            this.verHistorial();
          },
          error: () => {
            Swal.fire('Error', 'No se pudo eliminar.', 'error');
          }
        });
      }
    });
  }

  private cargarHistoriaEnFormulario(h: any): void {
    const empresaDesdeLista = this.empresas.find((empresa) => empresa.empresa_id === h.empresa_id);
    if (empresaDesdeLista) {
      this.empresaSeleccionada = empresaDesdeLista;
    }

    this.formulario = {
      tipoHistoria: h.tipo_historia, fechaElaboracion: h.fecha_elaboracion?.split('T')[0],
      matricula: h.matricula, area: h.area, nombre: h.nombre, genero: h.genero || '',
      religion: h.religion,
      escolaridad: h.escolaridad, estadoCivil: h.estado_civil, edad: h.edad,
      lugarNacimiento: h.lugar_nacimiento, telefono: h.telefono, domicilio: h.domicilio,
      contactoEmergenciaNombre: h.contacto_emergencia_nombre, contactoEmergenciaTelefono: h.contacto_emergencia_telefono
    };
    this.observacionesLaborales = h.observaciones_laborales || '';
    this.antecedentesLaborales = (h.antecedentes_laborales || []).map((al: any) => ({
      empresa: al.empresa, puesto: al.puesto, tiempo: al.tiempo,
      eppVisual: !!al.epp_visual, eppAuditivo: !!al.epp_auditivo, eppRespiratorio: !!al.epp_respiratorio,
      eppNoAplica: !!al.epp_no_aplica,
      enfermedadTrabajo: al.enfermedad_trabajo, accidenteTrabajo: al.accidente_trabajo
    }));
    if (this.antecedentesLaborales.length === 0) this.agregarFilaLaboral();
    this.heredoFamiliares = {
      diabetes: !!h.hf_diabetes, hipertension: !!h.hf_hipertension, cancer: !!h.hf_cancer,
      cardiacos: !!h.hf_cardiacos, asma: !!h.hf_asma, alergias: !!h.hf_alergias,
      renales: !!h.hf_renales, convulsiones: !!h.hf_convulsiones, auditivas: !!h.hf_auditivas, visuales: !!h.hf_visuales
    };
    this.observacionesHeredoFamiliares = h.observaciones_heredo_familiares || '';
    this.heredoFamiliaresMadre = h.hf_madre || '';
    this.heredoFamiliaresPadre = h.hf_padre || '';
    const exposicionGuardada = h.tab_exposicion || '';
    const tabaquismoNegado = this.normalizarTexto(exposicionGuardada) === 'negado';
    this.tabaquismo = {
      fumo: !!h.tab_fumo,
      fuma: !!h.tab_fuma,
      negado: tabaquismoNegado,
      cigarros: h.tab_cigarros || '',
      intervaloTiempo: h.tab_intervalo_tiempo || '',
      exposicion: exposicionGuardada
    };
    this.indiceTabaquico = tabaquismoNegado ? '' : (h.indice_tabaquico || '');
    const alcoholismoNegado = this.normalizarTexto(h.alc_tipo || '') === 'negado';
    this.alcoholismo = {
      bebio: alcoholismoNegado ? false : !!h.alc_bebio,
      bebe: alcoholismoNegado ? false : !!h.alc_bebe,
      negado: alcoholismoNegado,
      unaVez: alcoholismoNegado ? '' : (h.alc_una_vez || ''),
      tipo: alcoholismoNegado ? 'NEGADO' : (h.alc_tipo || ''),
      intervaloTiempo: alcoholismoNegado ? '' : (h.alc_intervalo_tiempo || '')
    };
    const otrasDrogasNegado = this.normalizarTexto(h.drg_tipo || '') === 'negado';
    this.otrasDrogas = {
      consumio: otrasDrogasNegado ? false : !!h.drg_consumio,
      consume: otrasDrogasNegado ? false : !!h.drg_consume,
      negado: otrasDrogasNegado,
      tipo: otrasDrogasNegado ? '' : (h.drg_tipo || ''),
      intervaloTiempo: otrasDrogasNegado ? '' : (h.drg_intervalo_tiempo || '')
    };
    this.ejercicio = {
      realiza: !!h.ej_realiza,
      tipo: h.ej_tipo || '',
      horasDiaMinutosSemana: h.ej_horas_dia_minutos_semana || '',
      alcanzaRecomendacion: h.ej_alcanza_recomendacion || '',
      tiempoPracticarlo: h.ej_tiempo_practicarlo || ''
    };
    this.actualizarRecomendacionEjercicio(this.ejercicio.horasDiaMinutosSemana);
    this.sueno = { minimo: h.sueno_minimo || '', maximo: h.sueno_maximo || '', promedio: h.sueno_promedio || '' };

    this.actividadesTiempoLibre = h.actividades_tiempo_libre || '';
    this.tipoSanguineo = h.tipo_sanguineo || '';
    this.vacunas = { sarampion: !!h.vac_sarampion, rubeola: !!h.vac_rubeola, influenza: !!h.vac_influenza, toxoideTetanico: !!h.vac_toxoide_tetanico, covid: !!h.vac_covid, otras: h.vac_otras || '' };
    this.habitosHigiene = { banoDiario: h.hig_bano_diario || '', aseoBucal: h.hig_aseo_bucal || '', comidasAlDia: h.hig_comidas_al_dia || '', desparasitacion: !!h.hig_desparasitacion, hacinamiento: !!h.hig_hacinamiento, promiscuidad: !!h.hig_promiscuidad, zoonosis: !!h.hig_zoonosis, zoonosisAnimal: h.hig_zoonosis_animal || '', perforaciones: !!h.hig_perforaciones, perforacionesZonas: h.hig_perforaciones_zonas || '', dormitorios: h.hig_dormitorios || '', habitantes: h.hig_habitantes || '', psUltimos6Meses: h.hig_ps_ultimos_6_meses || '', observacionesVivienda: h.hig_observaciones_vivienda || '' };
    const tatuajesNegado = this.normalizarTexto(h.tat_zona || '') === 'negado';
    this.tatuajes = {
      tiene: tatuajesNegado ? false : !!h.tat_tiene,
      negado: tatuajesNegado,
      zona: tatuajesNegado ? '' : (h.tat_zona || '')
    };
    this.observacionesNoPatologicos = h.observaciones_no_patologicos || '';
    this.onTipoSanguineoChange(this.tipoSanguineo);
    this.actualizarIndiceHacinamientoVivienda();
    this.actualizarPromiscuidadDesdePSUltimos6Meses();
    this.enfermedadesInfantiles = {
      sarampion: !!h.ei_sarampion,
      rubeola: !!h.ei_rubeola,
      varicela: !!h.ei_varicela,
      parotiditis: !!h.ei_parotiditis,
      hepatitis: !!h.ei_hepatitis,
      covid: !!h.ei_covid,
      influenza: !!h.ei_influenza,
      otra: h.ei_otra || ''
    };
    const problemasVistaNegado = this.normalizarTexto(h.pv_cual || '') === 'negado';
    this.problemasVista = {
      tiene: problemasVistaNegado ? false : !!h.pv_tiene,
      cual: problemasVistaNegado ? '' : (h.pv_cual || ''),
      usoLentes: problemasVistaNegado ? false : !!h.pv_uso_lentes,
      negado: problemasVistaNegado
    };
    const problemasAuditivosNegado = this.normalizarTexto(h.pa_cual || '') === 'negado';
    this.problemasAuditivos = {
      tiene: problemasAuditivosNegado ? false : !!h.pa_tiene,
      cual: problemasAuditivosNegado ? '' : (h.pa_cual || ''),
      usoAudifonos: problemasAuditivosNegado ? false : !!h.pa_uso_audifonos,
      negado: problemasAuditivosNegado
    };
    this.observacionesPatologicos = h.observaciones_patologicos || '';
    this.enfermedades = {
      congenitas: { tiene: !!h.enf_congenitas, cual: h.enf_congenitas_cual || '' },
      dentales: { tiene: !!h.enf_dentales, cual: h.enf_dentales_cual || '' },
      endocrinas: { tiene: !!h.enf_endocrinas, cual: h.enf_endocrinas_cual || '' },
      pulmonares: { tiene: !!h.enf_pulmonares, cual: h.enf_pulmonares_cual || '' },
      cardiovasculares: { tiene: !!h.enf_cardiovasculares, cual: h.enf_cardiovasculares_cual || '' },
      digestivas: { tiene: !!h.enf_digestivas, cual: h.enf_digestivas_cual || '' },
      urinarias: { tiene: !!h.enf_urinarias, cual: h.enf_urinarias_cual || '' },
      musculoEsqueleticas: { tiene: !!h.enf_musculo_esqueleticas, cual: h.enf_musculo_esqueleticas_cual || '' },
      dermatologicas: { tiene: !!h.enf_dermatologicas, cual: h.enf_dermatologicas_cual || '' },
      infectoContagiosas: { tiene: !!h.enf_infecto_contagiosas, cual: h.enf_infecto_contagiosas_cual || '' },
      psiquiatricas: { tiene: !!h.enf_psiquiatricas, cual: h.enf_psiquiatricas_cual || '' },
      otrasEnfermedades: { tiene: !!h.enf_otras, cual: h.enf_otras_cual || '' },
      alergias: { tiene: !!h.enf_alergias, cual: h.enf_alergias_cual || '' }
    };
    this.cirugias = h.cirugias || ''; this.transfusiones = h.transfusiones || '';
    this.traumaticos = h.traumaticos || ''; this.ingresosHospitalarios = h.ingresos_hospitalarios || '';
    this.tieneCirugias = !!this.cirugias;
    this.tieneTransfusiones = !!this.transfusiones;
    this.tieneTraumaticos = !!this.traumaticos;
    this.tieneIngresosHospitalarios = !!this.ingresosHospitalarios;
    this.ginecoObstetricos = {
      menarca: h.go_menarca || '', ciclo: h.go_ciclo || '', fum: h.go_fum?.split('T')[0] || '',
      dismenorreaSi: String(h.go_dismenorrea || '').trim().toUpperCase() === 'SI',
      ivsa: h.go_ivsa || '', pSexuales: h.go_p_sexuales || '',
      gesta: h.go_gesta || '', para: h.go_para || '', cesarea: h.go_cesarea || '', abortos: h.go_abortos || '',
      mpf: h.go_mpf || '', fechaPap: h.go_fecha_pap?.split('T')[0] || '', resultado: h.go_resultado || '', observaciones: h.go_observaciones || ''
    };
    this.ginecoObservacionesManual = this.extraerObservacionesGinecoManualesDesde(this.ginecoObstetricos.observaciones);
    this.actualizarObservacionesGinecoObstetricos();
    const lecturaTA = this.descomponerLecturaTensionArterial(h.ef_ta || '');
    this.exploracionFisica = {
      peso: h.ef_peso || '',
      talla: h.ef_talla || '',
      imc: h.ef_imc || '',
      fc: h.ef_fc || '',
      fr: h.ef_fr || '',
      glucosa: h.ef_glucosa || '',
      taSistolica: lecturaTA.pas !== null ? String(lecturaTA.pas) : '',
      taDiastolica: lecturaTA.pad !== null ? String(lecturaTA.pad) : '',
      ta: lecturaTA.pas !== null
        ? (lecturaTA.pad !== null ? `${lecturaTA.pas}/${lecturaTA.pad}` : String(lecturaTA.pas))
        : (h.ef_ta || ''),
      satO2: h.ef_sat_o2 || '',
      temp: h.ef_temp || '',
      lateralidad: h.ef_lateralidad || '',
      grasaCorporal: h.ef_grasa_corporal || '',
      musculo: h.ef_musculo || '',
      grasaVisceral: h.ef_grasa_visceral || '',
      edadMetabolica: h.ef_edad_metabolica || '',
      metabolismoBasal: h.ef_metabolismo_basal || '',
      observaciones: h.ef_observaciones || ''
    };
    this.organosSistemas[0] = { ...this.organosSistemas[0], resultado: h.os_cabeza_cuello_resultado || '', hallazgos: h.os_cabeza_cuello_hallazgos || '' };
    this.organosSistemas[1] = { ...this.organosSistemas[1], resultado: h.os_ojos_resultado || '', agudVisualOD: h.os_ojos_agud_visual_od || '', agudVisualOI: h.os_ojos_agud_visual_oi || '', agudVisualConCorreccion: !!h.os_ojos_agud_visual_con_correccion, hallazgos: h.os_ojos_hallazgos || '' };
    this.organosSistemas[2] = { ...this.organosSistemas[2], resultado: h.os_oidos_resultado || '', hallazgos: h.os_oidos_hallazgos || '' };
    this.organosSistemas[3] = { ...this.organosSistemas[3], resultado: h.os_nariz_resultado || '', hallazgos: h.os_nariz_hallazgos || '' };
    this.organosSistemas[4] = { ...this.organosSistemas[4], resultado: h.os_orofaringe_resultado || '', hallazgos: h.os_orofaringe_hallazgos || '' };
    this.organosSistemas[5] = { ...this.organosSistemas[5], resultado: h.os_torax_resultado || '', hallazgos: h.os_torax_hallazgos || '' };
    this.organosSistemas[6] = { ...this.organosSistemas[6], resultado: h.os_abdomen_resultado || '', hallazgos: h.os_abdomen_hallazgos || '' };
    this.organosSistemas[7] = { ...this.organosSistemas[7], resultado: h.os_extremidades_resultado || '', hallazgos: h.os_extremidades_hallazgos || '' };
    this.organosSistemas[8] = { ...this.organosSistemas[8], resultado: h.os_neurologico_resultado || '', romberg: h.os_neurologico_romberg || '', hallazgos: h.os_neurologico_hallazgos || '' };
    this.organosSistemas[9] = { ...this.organosSistemas[9], resultado: h.os_piel_resultado || '', hallazgos: h.os_piel_hallazgos || '' };
    this.paraclinicos = { teleTorax: h.pc_tele_torax || '', columna: h.pc_columna || '', biometria: h.pc_biometria || '', clinicaSanguinea: h.pc_clinica_sanguinea || h.pc_glucosa || '', quimicaS: h.pc_quimica_s || '', audiometria: h.pc_audiometria || '', espirometria: h.pc_espirometria || '', resultado: h.pc_resultado || '' };
    this.diagnosticos = (h.diagnosticos || []).map((d: any) => ({ diagnostico: d.diagnostico || '', recomendacion: d.recomendacion || '' }));
    if (this.diagnosticos.length === 0) this.agregarDiagnostico();
    this.ultimoDiagnosticosAutomaticos.clear();
    this.observacionesDiagnostico = h.observaciones_diagnostico || '';
    this.sincronizarObservacionesDiagnosticoConsolidadas(true);
    this.personalElaboroHistoria = (h.personal_elaboro || '').replace(/^Dr\.?\s*/i, '');
    this.cedulaProfesional = h.cedula_profesional || '';
    // Cargar firma guardada en la HC (puede ser de otro doctor)
    if (h.firma_url) {
      this.firmaUrlDoctor = this.convertirFirmaAProxy(h.firma_url);
    }
  }

  /**
   * Convierte una URL de Drive (https://drive.google.com/uc?id=XXX)
   * a la URL del proxy local para evitar CORS en html2canvas.
   */
  private convertirFirmaAProxy(url: string): string {
    if (!url) return '';
    // Si ya es una URL de proxy, devolver tal cual
    if (url.includes('/firma-doctor/')) {
      // Extraer el ID y reconstruir con el apiUrl actual
      const proxyMatch = url.match(/\/firma-doctor\/([^/?]+)/);
      if (proxyMatch && proxyMatch[1]) {
        return `${environment.apiUrl}/firma-doctor/${proxyMatch[1]}`;
      }
      return url;
    }
    const match = url.match(/[?&]id=([^&]+)/);
    if (match && match[1]) {
      return `${environment.apiUrl}/firma-doctor/${match[1]}`;
    }
    return url;
  }

  /**
   * Convierte una URL de proxy o Drive a la URL original de Drive
   * para guardar en la base de datos.
   */
  private convertirADriveUrl(url: string): string {
    if (!url) return '';
    const proxyMatch = url.match(/\/firma-doctor\/([^/?]+)/);
    if (proxyMatch && proxyMatch[1]) {
      return `https://drive.google.com/uc?id=${proxyMatch[1]}`;
    }
    if (url.includes('drive.google.com')) {
      return url;
    }
    return url;
  }


  formatFechaElaboracion(fecha: unknown): string {
    return formatearFechaDdmmaaaa(fecha);
  }
}
