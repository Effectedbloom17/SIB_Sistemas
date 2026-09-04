import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import Swal, { SweetAlertIcon } from 'sweetalert2';
import { BackendServices } from 'src/app/services/backend.services';

const CIUDADES_POR_ESTADO: Record<string, string[]> = {
  'Aguascalientes': ['Aguascalientes', 'Jesús María', 'Calvillo', 'Rincón de Romos', 'Pabellón de Arteaga'],
  'Baja California': ['Tijuana', 'Mexicali', 'Ensenada', 'Rosarito', 'Tecate', 'San Quintín'],
  'Baja California Sur': ['La Paz', 'Los Cabos', 'Cabo San Lucas', 'San José del Cabo', 'Ciudad Constitución', 'Loreto'],
  'Campeche': ['Campeche', 'Ciudad del Carmen', 'Champotón', 'Escárcega', 'Calkiní'],
  'Chiapas': ['Tuxtla Gutiérrez', 'San Cristóbal de las Casas', 'Tapachula', 'Comitán de Domínguez', 'Palenque', 'Ocosingo'],
  'Chihuahua': ['Chihuahua', 'Ciudad Juárez', 'Delicias', 'Cuauhtémoc', 'Parral', 'Nuevo Casas Grandes'],
  'Ciudad de México': ['Ciudad de México', 'Coyoacán', 'Tlalpan', 'Xochimilco', 'Iztapalapa', 'Azcapotzalco'],
  'Coahuila': ['Saltillo', 'Torreón', 'Monclova', 'Piedras Negras', 'Acuña', 'Sabinas'],
  'Colima': ['Colima', 'Manzanillo', 'Tecomán', 'Villa de Álvarez', 'Comala'],
  'Durango': ['Durango', 'Gómez Palacio', 'Lerdo', 'Santiago Papasquiaro', 'El Salto'],
  'Estado de México': ['Toluca', 'Ecatepec', 'Naucalpan', 'Tlalnepantla', 'Nezahualcóyotl', 'Texcoco', 'Atlacomulco', 'Metepec'],
  'Guanajuato': ['León', 'Irapuato', 'Celaya', 'Salamanca', 'Guanajuato', 'San Miguel de Allende', 'Silao'],
  'Guerrero': ['Acapulco', 'Chilpancingo', 'Iguala', 'Taxco', 'Zihuatanejo', 'Chilapa'],
  'Hidalgo': ['Pachuca de Soto', 'Tulancingo de Bravo', 'Tizayuca', 'Mineral de la Reforma', 'Tula de Allende', 'Tepeapulco', 'Actopan', 'Huejutla de Reyes', 'Ixmiquilpan', 'Mixquiahuala de Juárez'],
  'Jalisco': ['Guadalajara', 'Zapopan', 'Tlaquepaque', 'Tonalá', 'Puerto Vallarta', 'Lagos de Moreno', 'Tepatitlán', 'Ocotlán'],
  'Michoacán': ['Morelia', 'Uruapan', 'Zamora', 'Lázaro Cárdenas', 'Apatzingán', 'Pátzcuaro', 'Zitácuaro'],
  'Morelos': ['Cuernavaca', 'Jiutepec', 'Cuautla', 'Temixco', 'Yautepec', 'Jojutla'],
  'Nayarit': ['Tepic', 'Bahía de Banderas', 'Santiago Ixcuintla', 'Compostela', 'Ixtlán del Río'],
  'Nuevo León': ['Monterrey', 'San Nicolás de los Garza', 'Guadalupe', 'Apodaca', 'San Pedro Garza García', 'Santa Catarina', 'Escobedo'],
  'Oaxaca': ['Oaxaca de Juárez', 'Salina Cruz', 'Juchitán de Zaragoza', 'Tuxtepec', 'Huatulco', 'Puerto Escondido'],
  'Puebla': ['Puebla', 'Tehuacán', 'San Martín Texmelucan', 'Atlixco', 'Cholula', 'Huauchinango'],
  'Querétaro': ['Querétaro', 'San Juan del Río', 'El Marqués', 'Corregidora', 'Tequisquiapan'],
  'Quintana Roo': ['Cancún', 'Chetumal', 'Playa del Carmen', 'Cozumel', 'Tulum', 'Felipe Carrillo Puerto'],
  'San Luis Potosí': ['San Luis Potosí', 'Ciudad Valles', 'Soledad de Graciano Sánchez', 'Matehuala', 'Rioverde', 'Tamazunchale'],
  'Sinaloa': ['Culiacán', 'Mazatlán', 'Los Mochis', 'Guasave', 'Navolato', 'El Rosario'],
  'Sonora': ['Hermosillo', 'Ciudad Obregón', 'Nogales', 'Guaymas', 'Navojoa', 'San Luis Río Colorado'],
  'Tabasco': ['Villahermosa', 'Cárdenas', 'Comalcalco', 'Macuspana', 'Teapa', 'Paraíso'],
  'Tamaulipas': ['Reynosa', 'Matamoros', 'Nuevo Laredo', 'Tampico', 'Ciudad Victoria', 'Ciudad Madero', 'Altamira'],
  'Tlaxcala': ['Tlaxcala', 'Apizaco', 'Huamantla', 'Chiautempan', 'Calpulalpan'],
  'Veracruz': ['Veracruz', 'Xalapa', 'Coatzacoalcos', 'Córdoba', 'Poza Rica', 'Orizaba', 'Boca del Río', 'Minatitlán'],
  'Yucatán': ['Mérida', 'Valladolid', 'Tizimín', 'Progreso', 'Umán', 'Kanasín'],
  'Zacatecas': ['Zacatecas', 'Fresnillo', 'Guadalupe', 'Jerez', 'Río Grande', 'Loreto']
};

const ESTADO_A_CVE_INEGI: Record<string, string> = {
  'Aguascalientes': '01',
  'Baja California': '02',
  'Baja California Sur': '03',
  'Campeche': '04',
  'Coahuila': '05',
  'Colima': '06',
  'Chiapas': '07',
  'Chihuahua': '08',
  'Ciudad de México': '09',
  'Durango': '10',
  'Guanajuato': '11',
  'Guerrero': '12',
  'Hidalgo': '13',
  'Jalisco': '14',
  'Estado de México': '15',
  'Michoacán': '16',
  'Morelos': '17',
  'Nayarit': '18',
  'Nuevo León': '19',
  'Oaxaca': '20',
  'Puebla': '21',
  'Querétaro': '22',
  'Quintana Roo': '23',
  'San Luis Potosí': '24',
  'Sinaloa': '25',
  'Sonora': '26',
  'Tabasco': '27',
  'Tamaulipas': '28',
  'Tlaxcala': '29',
  'Veracruz': '30',
  'Yucatán': '31',
  'Zacatecas': '32'
};

@Component({
  selector: 'app-mis-empresas',
  templateUrl: './mis-empresas.component.html',
  styleUrls: ['./mis-empresas.component.scss']
})
export class MisEmpresasComponent implements OnInit {

  // Lista de empresas desde la BD
  empresas: any[] = [];
  empresasFiltradas: any[] = [];
  cargandoEmpresas: boolean = false;
  textoBusqueda: string = '';
  filtroActivo: 'todas' | 'pc' | 'colaboradoras' | 'documentos' = 'todas';

  // Modal de agregar empresa
  mostrarModalAgregarEmpresa: boolean = false;
  empresaNueva: string = '';
  rfcNuevo: string = '';

  // Control del wizard de pasos
  pasoActual: number = 1;

  // Sección de datos específicos de empresa (desplegable)
  mostrarSeccionDatosEmpresa: boolean = false;
  razonSocial: string = '';
  direccion: string = '';
  ciudad: string = '';
  estado: string = '';
  codigoPostal: string = '';
  telefonoEmpresa: string = '';
  emailEmpresa: string = '';
  servicioProteccionCivil: boolean = true;
  esEmpresaColaboradora: boolean = false;
  registroEnSistema: boolean = false;
  empresaColaboradorPadreId: number | null = null;
  logoEmpresaArchivo: File | null = null;
  nombreLogoEmpresaArchivo: string = '';
  logoEmpresaPreviewUrl: string = '';
  logoEmpresaPreviewSafeUrl: SafeUrl | null = null;

  // Dropdowns de Estado / Ciudad
  busquedaEstado: string = '';
  busquedaCiudad: string = '';
  mostrarDropdownEstado: boolean = false;
  mostrarDropdownCiudad: boolean = false;
  estados: string[] = Object.keys(CIUDADES_POR_ESTADO);
  estadosFiltrados: string[] = [];
  ciudadesDelEstado: string[] = [];
  ciudadesFiltradas: string[] = [];
  cpAutofillEstadoCiudadLoading: boolean = false;
  cpAutofillMensaje: string = '';
  cpAutofillMensajeTipo: 'success' | 'warning' | 'info' = 'info';
  private cpAutofillTimeout: ReturnType<typeof setTimeout> | null = null;
  private cpUltimoConsultado: string = '';
  private municipiosPorEstadoCache: Record<string, string[]> = {};

  // Sección de contacto/usuario (desplegable)
  mostrarSeccionContacto: boolean = false;
  contactoNombre: string = '';
  contactoApellido: string = '';
  contactoEmail: string = '';
  contactoTelefono: string = '';
  contactoPuesto: string = '';
  usuarioAcceso: string = '';
  usuarioAccesoEditando: boolean = false;
  usuarioAccesoPersonalizado: boolean = false;
  enviarCorreoProvisional: boolean = false;
  correosAdicionalesCredenciales: string = '';

  constructor(
    private backendService: BackendServices,
    private sanitizer: DomSanitizer,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.cargarEmpresas();
    this.estadosFiltrados = [...this.estados];
  }

  // trackBy: evita re-render de la tabla de empresas al filtrar/buscar.
  trackByEmpresaId(_index: number, empresa: any): any {
    return empresa?.empresa_id ?? _index;
  }

  // Cargar empresas desde la base de datos
  cargarEmpresas() {
    this.cargandoEmpresas = true;
    this.backendService.obtenerEmpresas().subscribe(
      (response: any) => {
        if (response.success) {
          this.empresas = response.empresas;
          this.empresasFiltradas = [...this.empresas];
        }
        this.cargandoEmpresas = false;
      },
      (error) => {
        console.error('Error al cargar empresas:', error);
        this.cargandoEmpresas = false;
        Swal.fire('Error', 'No se pudieron cargar las empresas', 'error');
      }
    );
  }

  // Filtrar empresas por texto de busqueda
  filtrarEmpresas() {
    let resultado = [...this.empresas];

    if (this.textoBusqueda && this.textoBusqueda.trim()) {
      const texto = this.textoBusqueda.toLowerCase().trim();
      resultado = resultado.filter(e =>
        (e.nombre_empresa && e.nombre_empresa.toLowerCase().includes(texto)) ||
        (e.rfc && e.rfc.toLowerCase().includes(texto)) ||
        (this.obtenerEmailCorporativo(e) || '').toLowerCase().includes(texto)
      );
    }

    if (this.filtroActivo === 'pc') {
      resultado = resultado.filter((e) => Number(e.servicio_proteccion_civil) === 1);
    } else if (this.filtroActivo === 'colaboradoras') {
      resultado = resultado.filter((e) => !!e.colaborador);
    } else if (this.filtroActivo === 'documentos') {
      resultado = resultado.filter((e) => Number(e.total_documentos) > 0);
    }

    this.empresasFiltradas = resultado;
  }

  setFiltro(filtro: 'todas' | 'pc' | 'colaboradoras' | 'documentos'): void {
    this.filtroActivo = filtro;
    this.filtrarEmpresas();
  }

  abrirRepositorio(empresa: any, event?: Event): void {
    event?.stopPropagation();
    const id = Number(empresa?.empresa_id);
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    this.router.navigate(['/mis-empresas', id, 'repositorio']);
  }

  get totalEmpresas(): number {
    return this.empresas.length;
  }

  get totalConPc(): number {
    return this.empresas.filter((e) => Number(e.servicio_proteccion_civil) === 1).length;
  }

  get totalColaboradoras(): number {
    return this.empresas.filter((e) => !!e.colaborador).length;
  }

  get totalConDocumentos(): number {
    return this.empresas.filter((e) => Number(e.total_documentos) > 0).length;
  }

  totalDocumentosEmpresa(empresa: any): number {
    return Number(empresa?.total_documentos) || 0;
  }

  obtenerUbicacion(empresa: any): string {
    const partes = [empresa?.ciudad, empresa?.estado].filter(Boolean);
    return partes.join(', ') || '';
  }

  // Obtener iniciales de la empresa para el avatar
  getIniciales(nombre: string): string {
    if (!nombre) return '??';
    const palabras = nombre.split(' ');
    if (palabras.length >= 2) {
      return (palabras[0][0] + palabras[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  // Obtener color del avatar basado en el indice
  getColorAvatar(index: number): string {
    const colores = ['bg-gradient-success', 'bg-gradient-info', 'bg-gradient-primary', 'bg-gradient-warning', 'bg-gradient-danger'];
    return colores[index % colores.length];
  }

  getLogoEmpresaUrl(empresa: any): string | null {
    return this.backendService.resolverUrlDrivePreview(empresa?.logo || empresa?.logo_url);
  }

  onLogoError(empresa: any): void {
    if (!empresa) return;
    empresa.logo = null;
    empresa.logo_url = null;
  }

  obtenerEmailCorporativo(empresa: any): string {
    return (
      empresa?.email ||
      empresa?.email_corporativo ||
      empresa?.correo_corporativo ||
      empresa?.contacto_email ||
      '-'
    );
  }

  obtenerTelefonoEmpresa(empresa: any): string {
    return (
      empresa?.telefono ||
      empresa?.telefono_empresa ||
      empresa?.contacto_telefono ||
      '-'
    );
  }

  get empresasPrincipales(): any[] {
    return this.empresas.filter((empresa) => !empresa?.colaborador);
  }

  get nombreEmpresaColaboradorPadre(): string {
    if (!this.empresaColaboradorPadreId) {
      return '';
    }
    const empresa = this.empresas.find((item) => Number(item.empresa_id) === Number(this.empresaColaboradorPadreId));
    return empresa?.nombre_empresa || '';
  }

  get omitirPasoCredenciales(): boolean {
    return this.esEmpresaColaboradora || this.registroEnSistema;
  }

  get totalPasosRegistro(): number {
    return this.omitirPasoCredenciales ? 2 : 3;
  }

  get etiquetaPasoActual(): number {
    if (this.omitirPasoCredenciales) {
      return this.pasoActual === 1 ? 1 : 2;
    }
    return this.pasoActual;
  }

  get progresoStepper(): string {
    if (this.omitirPasoCredenciales) {
      return this.pasoActual === 1 ? '0%' : '100%';
    }
    if (this.pasoActual === 1) {
      return '0%';
    }
    if (this.pasoActual === 2) {
      return '50%';
    }
    return '100%';
  }

  get mostrarPasoCredenciales(): boolean {
    return this.pasoActual === 2 && !this.omitirPasoCredenciales;
  }

  get mostrarPasoResumen(): boolean {
    return this.pasoActual === 3;
  }

  get mostrarBotonSiguiente(): boolean {
    return this.omitirPasoCredenciales ? this.pasoActual === 1 : this.pasoActual < 3;
  }

  get mostrarBotonRegistrar(): boolean {
    return this.pasoActual === 3;
  }

  get emailEmpresaResumen(): string {
    return (this.emailEmpresa || '').trim();
  }

  get telefonoEmpresaResumen(): string {
    return (this.telefonoEmpresa || '').trim();
  }

  onEsEmpresaColaboradoraChange(): void {
    if (!this.esEmpresaColaboradora) {
      this.empresaColaboradorPadreId = null;
      return;
    }
    this.registroEnSistema = false;
    if (this.pasoActual === 2) {
      this.pasoActual = 1;
    }
  }

  onRegistroEnSistemaChange(): void {
    if (this.registroEnSistema) {
      this.esEmpresaColaboradora = false;
      this.empresaColaboradorPadreId = null;
    }
    if (this.pasoActual === 2) {
      this.pasoActual = 1;
    }
  }

  private irAlPasoResumen(): void {
    this.pasoActual = 3;
  }

  private irAlPasoCredenciales(): void {
    this.pasoActual = 2;
  }

  // Abrir modal de agregar empresa
  abrirModalAgregarEmpresa() {
    this.mostrarModalAgregarEmpresa = true;
    this.pasoActual = 1; // Iniciar en el primer paso
    this.empresaNueva = '';
    this.rfcNuevo = '';
    // Limpiar campos de datos específicos de empresa
    this.mostrarSeccionDatosEmpresa = false;
    this.razonSocial = '';
    this.direccion = '';
    this.ciudad = '';
    this.busquedaCiudad = '';
    this.estado = '';
    this.busquedaEstado = '';
    this.ciudadesDelEstado = [];
    this.ciudadesFiltradas = [];
    this.codigoPostal = '';
    this.cpAutofillEstadoCiudadLoading = false;
    this.cpAutofillMensaje = '';
    this.cpAutofillMensajeTipo = 'info';
    this.cpUltimoConsultado = '';
    this.telefonoEmpresa = '';
    this.emailEmpresa = '';
    this.servicioProteccionCivil = true;
    this.esEmpresaColaboradora = false;
    this.registroEnSistema = false;
    this.empresaColaboradorPadreId = null;
    if (this.logoEmpresaPreviewUrl) {
      URL.revokeObjectURL(this.logoEmpresaPreviewUrl);
    }
    this.logoEmpresaArchivo = null;
    this.nombreLogoEmpresaArchivo = '';
    this.logoEmpresaPreviewUrl = '';
    this.logoEmpresaPreviewSafeUrl = null;
    // Limpiar campos de contacto
    this.mostrarSeccionContacto = false;
    this.contactoNombre = '';
    this.contactoApellido = '';
    this.contactoEmail = '';
    this.contactoTelefono = '';
    this.contactoPuesto = '';
    this.usuarioAcceso = '';
    this.usuarioAccesoEditando = false;
    this.usuarioAccesoPersonalizado = false;
    this.enviarCorreoProvisional = false;
    this.correosAdicionalesCredenciales = '';
  }

  // Cerrar modal
  cerrarModalAgregarEmpresa() {
    this.mostrarModalAgregarEmpresa = false;
    this.pasoActual = 1; // Resetear al primer paso
    this.empresaNueva = '';
    this.rfcNuevo = '';
    // Limpiar campos de datos específicos de empresa
    this.mostrarSeccionDatosEmpresa = false;
    this.razonSocial = '';
    this.direccion = '';
    this.ciudad = '';
    this.busquedaCiudad = '';
    this.estado = '';
    this.busquedaEstado = '';
    this.ciudadesDelEstado = [];
    this.ciudadesFiltradas = [];
    this.codigoPostal = '';
    this.cpAutofillEstadoCiudadLoading = false;
    this.cpAutofillMensaje = '';
    this.cpAutofillMensajeTipo = 'info';
    this.cpUltimoConsultado = '';
    this.telefonoEmpresa = '';
    this.emailEmpresa = '';
    this.servicioProteccionCivil = true;
    this.esEmpresaColaboradora = false;
    this.registroEnSistema = false;
    this.empresaColaboradorPadreId = null;
    if (this.logoEmpresaPreviewUrl) {
      URL.revokeObjectURL(this.logoEmpresaPreviewUrl);
    }
    this.logoEmpresaArchivo = null;
    this.nombreLogoEmpresaArchivo = '';
    this.logoEmpresaPreviewUrl = '';
    this.logoEmpresaPreviewSafeUrl = null;
    // Limpiar campos de contacto
    this.mostrarSeccionContacto = false;
    this.contactoNombre = '';
    this.contactoApellido = '';
    this.contactoEmail = '';
    this.contactoTelefono = '';
    this.contactoPuesto = '';
    this.usuarioAcceso = '';
    this.usuarioAccesoEditando = false;
    this.usuarioAccesoPersonalizado = false;
    this.enviarCorreoProvisional = false;
    this.correosAdicionalesCredenciales = '';
  }

  toggleEnvioCorreoProvisional() {
    this.enviarCorreoProvisional = !this.enviarCorreoProvisional;
  }

  // Navegar al siguiente paso del wizard
  siguientePaso() {
    if (this.pasoActual === 1) {
      if (!this.validarPaso1Basico()) {
        return;
      }
      if (!this.omitirPasoCredenciales && (!this.usuarioAcceso || !this.usuarioAcceso.trim())) {
        this.usuarioAcceso = this.generarUsuarioAcceso(this.empresaNueva);
      }
      this.avanzarDesdePaso1ConValidacionSimilitud();
      return;
    }

    if (this.pasoActual === 2 && !this.omitirPasoCredenciales) {
      if (!this.contactoNombre || !this.contactoNombre.trim()) {
        Swal.fire({
          title: 'Campo Requerido',
          text: 'Ingrese el nombre del contacto',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (!this.contactoPuesto || !this.contactoPuesto.trim()) {
        Swal.fire({
          title: 'Campo Requerido',
          text: 'Ingrese el puesto del contacto',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (!this.emailEmpresa || !this.emailEmpresa.trim()) {
        Swal.fire({
          title: 'Campo Requerido',
          text: 'Ingrese el email corporativo de la empresa',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }


    }

    if (this.pasoActual < 3) {
      if (this.omitirPasoCredenciales && this.pasoActual === 1) {
        this.irAlPasoResumen();
      } else {
        this.pasoActual++;
      }
    }
  }

  private validarPaso1Basico(): boolean {
    if (!this.empresaNueva || !this.empresaNueva.trim()) {
      Swal.fire({
        title: 'Campo Requerido',
        text: 'Por favor ingrese el nombre de la empresa',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
    if (!this.rfcNuevo || !this.rfcNuevo.trim()) {
      Swal.fire({
        title: 'Campo Requerido',
        text: 'Por favor ingrese el RFC de la empresa',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
    if (this.rfcNuevo.trim().length < 12 || this.rfcNuevo.trim().length > 13) {
      Swal.fire({
        title: 'RFC Invalido',
        text: 'El RFC debe tener 12 o 13 caracteres',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
    if (!this.logoEmpresaArchivo) {
      Swal.fire({
        title: 'Logo Requerido',
        text: 'Debe subir el logo de la empresa para continuar',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
    if (this.esEmpresaColaboradora && !this.empresaColaboradorPadreId) {
      Swal.fire({
        title: 'Empresa principal requerida',
        text: 'Seleccione la empresa principal a la que pertenece esta empresa colaboradora',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return false;
    }
    if (this.registroEnSistema) {
      const cp = (this.codigoPostal || '').trim();
      if (!cp || cp.length !== 5) {
        Swal.fire({
          title: 'Campo Requerido',
          text: 'Ingrese un código postal válido de 5 dígitos',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return false;
      }
    }
    return true;
  }

  private avanzarDesdePaso1ConValidacionSimilitud(): void {
    this.backendService.validarSimilitudRegistroEmpresa({
      nombre_empresa: this.empresaNueva,
      rfc: this.rfcNuevo,
      estado: this.estado || this.busquedaEstado,
      ciudad: this.ciudad || this.busquedaCiudad,
      codigo_postal: this.codigoPostal
    }).subscribe(
      (response: any) => {
        if (response?.advertencia_alta) {
          this.mostrarAdvertenciaSimilitud(response).then((continuar) => {
            if (continuar) {
              if (this.omitirPasoCredenciales) {
                this.irAlPasoResumen();
              } else {
                this.irAlPasoCredenciales();
              }
            }
          });
          return;
        }
        if (this.omitirPasoCredenciales) {
          this.irAlPasoResumen();
        } else {
          this.irAlPasoCredenciales();
        }
      },
      () => {
        if (this.omitirPasoCredenciales) {
          this.irAlPasoResumen();
        } else {
          this.irAlPasoCredenciales();
        }
      }
    );
  }

  private async mostrarAdvertenciaSimilitud(response: any): Promise<boolean> {
    const coincidencias = Array.isArray(response?.coincidencias) ? response.coincidencias : [];
    const detalleHtml = coincidencias.length > 0
      ? `<ul style="text-align:left;margin:0.75rem 0 0;padding-left:1.2rem;">${coincidencias.map((c: any) => {
          const campos = Array.isArray(c.campos_coincidentes) ? c.campos_coincidentes.join(', ') : '';
          return `<li><b>${c.nombre_empresa || 'Empresa'}</b> (RFC ${c.rfc || ''})${campos ? ` — coincide en: ${campos}` : ''}</li>`;
        }).join('')}</ul>`
      : '';

    const resultado = await Swal.fire({
      title: 'Información similar en el sistema',
      html: `<p>Ya existe al menos un registro con datos muy parecidos. Verifica que no estés duplicando la misma empresa.</p>${detalleHtml}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Continuar de todos modos',
      cancelButtonText: 'Revisar datos',
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#8898aa'
    });
    return resultado.isConfirmed === true;
  }

  private validarSimilitudAntesDeRegistrar(): Promise<boolean> {
    return new Promise((resolve) => {
      this.backendService.validarSimilitudRegistroEmpresa({
        nombre_empresa: this.empresaNueva,
        rfc: this.rfcNuevo,
        estado: this.estado || this.busquedaEstado,
        ciudad: this.ciudad || this.busquedaCiudad,
        codigo_postal: this.codigoPostal
      }).subscribe(
        async (response: any) => {
          if (response?.advertencia_alta) {
            resolve(await this.mostrarAdvertenciaSimilitud(response));
            return;
          }
          resolve(true);
        },
        () => resolve(true)
      );
    });
  }

  // Navegar al paso anterior del wizard
  pasoAnterior() {
    if (this.pasoActual <= 1) {
      return;
    }
    if (this.omitirPasoCredenciales && this.pasoActual === 3) {
      this.pasoActual = 1;
      return;
    }
    this.pasoActual--;
  }

  onLogoFileSelected(event: any) {
    const file = event?.target?.files?.[0] || null;

    if (this.logoEmpresaPreviewUrl) {
      URL.revokeObjectURL(this.logoEmpresaPreviewUrl);
      this.logoEmpresaPreviewUrl = '';
    }
    this.logoEmpresaPreviewSafeUrl = null;

    if (!file) {
      this.logoEmpresaArchivo = null;
      this.nombreLogoEmpresaArchivo = '';
      return;
    }

    const tiposPermitidos = ['image/png', 'image/jpeg', 'image/webp'];
    if (!tiposPermitidos.includes(file.type)) {
      Swal.fire({
        title: 'Archivo inválido',
        text: 'El logo debe ser una imagen PNG, JPG o WebP',
        icon: 'error',
        confirmButtonColor: '#38512F'
      });
      this.logoEmpresaArchivo = null;
      this.nombreLogoEmpresaArchivo = '';
      return;
    }

    this.logoEmpresaArchivo = file;
    this.nombreLogoEmpresaArchivo = file.name;
    this.logoEmpresaPreviewUrl = URL.createObjectURL(file);
    this.logoEmpresaPreviewSafeUrl = this.sanitizer.bypassSecurityTrustUrl(this.logoEmpresaPreviewUrl);
  }

  // Guardar nueva empresa
  async guardarNuevaEmpresa() {
    const puedeRegistrar = await this.validarSimilitudAntesDeRegistrar();
    if (!puedeRegistrar) {
      return;
    }

    if (!this.empresaNueva || !this.rfcNuevo) {
      Swal.fire({
        title: 'Error',
        text: 'Por favor completa el nombre y el RFC',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (!this.logoEmpresaArchivo) {
      Swal.fire({
        title: 'Error',
        text: 'El logo de la empresa es obligatorio',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const esRegistroColaborador = this.esEmpresaColaboradora && !!this.empresaColaboradorPadreId;
    const esRegistroSinAcceso = this.registroEnSistema && !this.esEmpresaColaboradora;
    const requiereCredenciales = !esRegistroColaborador && !esRegistroSinAcceso;

    if (esRegistroSinAcceso) {
      const cp = (this.codigoPostal || '').trim();
      if (!cp || cp.length !== 5) {
        Swal.fire({
          title: 'Error',
          text: 'El código postal es obligatorio para el registro en sistema',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }
    }

    if (requiereCredenciales) {
      const emailEmpresaLimpio = (this.emailEmpresa || '').trim();
      const telefonoEmpresaLimpio = (this.telefonoEmpresa || '').trim();

      if (!emailEmpresaLimpio) {
        Swal.fire({
          title: 'Error',
          text: 'Debe registrar el correo corporativo de la empresa',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (!this.contactoPuesto || !this.contactoPuesto.trim()) {
        Swal.fire({
          title: 'Error',
          text: 'Debe registrar el puesto de la persona de contacto',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      const usernameAcceso = this.normalizarUsername(this.usuarioAcceso || this.generarUsuarioAcceso(this.empresaNueva));
      const { validos: correosAdicionales, invalidos: correosAdicionalesInvalidos } = this.obtenerCorreosAdicionalesCredenciales();

      if (correosAdicionalesInvalidos.length > 0) {
        Swal.fire({
          title: 'Correos adicionales inválidos',
          text: `Revisa estos correos: ${correosAdicionalesInvalidos.join(', ')}`,
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      if (!usernameAcceso) {
        Swal.fire({
          title: 'Error',
          text: 'El Usuario de Acceso no es válido',
          icon: 'warning',
          confirmButtonColor: '#38512F'
        });
        return;
      }
    }

    if (esRegistroColaborador && !this.empresaColaboradorPadreId) {
      Swal.fire({
        title: 'Empresa principal requerida',
        text: 'Seleccione la empresa principal a la que pertenece esta empresa colaboradora',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const formData = new FormData();
    formData.append('nombre_empresa', this.empresaNueva);
    formData.append('rfc', this.rfcNuevo);

    // Agregar datos específicos de la empresa si se proporcionaron
    if (this.razonSocial) formData.append('razon_social', this.razonSocial);
    if (this.direccion) formData.append('direccion', this.direccion);
    if (this.ciudad) formData.append('ciudad', this.ciudad);
    if (this.estado) formData.append('estado', this.estado);
    if (this.codigoPostal) formData.append('codigo_postal', this.codigoPostal);
    if (requiereCredenciales) {
      const emailEmpresaLimpio = (this.emailEmpresa || '').trim();
      const telefonoEmpresaLimpio = (this.telefonoEmpresa || '').trim();
      const usernameAcceso = this.normalizarUsername(this.usuarioAcceso || this.generarUsuarioAcceso(this.empresaNueva));
      const { validos: correosAdicionales } = this.obtenerCorreosAdicionalesCredenciales();

      if (this.telefonoEmpresa) formData.append('telefono', this.telefonoEmpresa);
      formData.append('email', emailEmpresaLimpio);
      formData.append('crear_usuario', 'true');
      if (this.contactoNombre) formData.append('contacto_nombre', this.contactoNombre);
      if (this.contactoApellido) formData.append('contacto_apellido', this.contactoApellido);
      if (telefonoEmpresaLimpio) formData.append('contacto_telefono', telefonoEmpresaLimpio);
      formData.append('puesto', this.contactoPuesto);
      formData.append('contacto_username', usernameAcceso);
      formData.append('contacto_email', emailEmpresaLimpio);

      if (this.enviarCorreoProvisional) {
        formData.append('enviar_correo_provisional', '1');
      }

      if (correosAdicionales.length > 0) {
        formData.append('credenciales_correos_extra', JSON.stringify(correosAdicionales));
        formData.append('correos_adicionales_credenciales', correosAdicionales.join(','));
      }
    } else {
      formData.append('crear_usuario', 'false');
    }

    formData.append('servicio_proteccion_civil', this.servicioProteccionCivil ? '1' : '0');
    if (this.esEmpresaColaboradora && this.empresaColaboradorPadreId) {
      formData.append('colaborador', String(this.empresaColaboradorPadreId));
    }
    if (this.logoEmpresaArchivo) formData.append('logo', this.logoEmpresaArchivo);

    Swal.fire({
      title: 'Registrando empresa...',
      text: 'Por favor espera un momento',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.backendService.registrarEmpresaConArchivo(formData).subscribe(
      (response: any) => {
        if (response.success) {
          const destinatariosRespuesta: string[] = Array.isArray(response?.destinatarios_credenciales)
            ? response.destinatarios_credenciales
            : [];
          const estadoEnvio = response?.estado_envio_credenciales || null;
          const envioTotal = Number(estadoEnvio?.total || 0);
          const envioExitosos = Number(estadoEnvio?.exitosos || 0);
          const envioFallidos = Number(estadoEnvio?.fallidos || 0);
          const iconoResultado: SweetAlertIcon = envioTotal > 0 && envioExitosos === 0 && envioFallidos > 0
            ? 'warning'
            : 'success';

          let mensajeExito = 'La empresa se ha registrado correctamente.';
          if (esRegistroColaborador) {
            mensajeExito += '\n\nSe registró como empresa colaboradora. El acceso seguirá siendo el de la empresa principal y sus cursos aparecerán en Cursos Activos.';
          } else if (esRegistroSinAcceso) {
            mensajeExito += '\n\nLa empresa quedó registrada en el directorio sin usuario de acceso al sistema.';
          } else {
            mensajeExito += '\n\nSe creó el usuario de acceso de forma automática.';
          }

          if (requiereCredenciales && envioTotal > 0) {
            if (envioExitosos > 0) {
              const destinatariosTexto = destinatariosRespuesta.length > 0
                ? destinatariosRespuesta.join(', ')
                : (this.emailEmpresa || '').trim();
              mensajeExito += `\n\nCredenciales enviadas correctamente a: ${destinatariosTexto}.`;
            }

            if (envioFallidos > 0) {
              mensajeExito += `\n\nAtención: ${envioFallidos} envío(s) de credenciales no se pudieron completar. Revisa el log del backend para más detalle.`;
            }
          } else if (requiereCredenciales) {
            mensajeExito += `\n\nNo hubo envío de credenciales en esta operación.`;
          }
          Swal.fire({
            title: 'Empresa Registrada',
            text: mensajeExito,
            icon: iconoResultado,
            confirmButtonColor: '#38512F'
          });
          this.cerrarModalAgregarEmpresa();
          this.cargarEmpresas();
        } else {
          Swal.fire({
            title: 'Error al Registrar',
            text: response.message || 'No se pudo registrar la empresa.',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      },
      (error) => {
        console.error('Error:', error);
        Swal.fire('Error', error.error?.message || 'Error de conexion con el servidor', 'error');
      }
    );
  }

  // Ocultar empresa del sistema (soft delete)
  eliminarEmpresa(empresa: any) {
    Swal.fire({
      title: '¿Ocultar Empresa?',
      html: `
        <p>Se ocultará <b>"${empresa.nombre_empresa}"</b> del sistema.</p>
        <p class="text-muted" style="font-size: 0.85em;">Los datos permanecen en la base de datos y Google Drive para auditorías.</p>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#f5365c',
      confirmButtonText: 'Sí, Ocultar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({
          title: 'Ocultando empresa...',
          allowOutsideClick: false,
          allowEscapeKey: false,
          didOpen: () => Swal.showLoading()
        });

        this.backendService.eliminarEmpresa(empresa.empresa_id).subscribe(
          (response: any) => {
            if (response.success) {
              Swal.fire({
                title: 'Empresa Ocultada',
                text: 'La empresa ya no aparecerá en el sistema.',
                icon: 'success',
                confirmButtonColor: '#38512F'
              });
              this.cargarEmpresas();
            } else {
              Swal.fire('Error', response.message || 'No se pudo ocultar', 'error');
            }
          },
          (error) => {
            console.error('Error:', error);
            Swal.fire('Error', error.error?.message || 'Error de conexión', 'error');
          }
        );
      }
    });
  }

  // =====================================================
  // Dropdowns de Estado / Ciudad
  // =====================================================
  filtrarEstados() {
    const texto = this.busquedaEstado.toLowerCase().trim();
    if (!texto) { this.estadosFiltrados = [...this.estados]; return; }
    this.estadosFiltrados = this.estados.filter(e => e.toLowerCase().includes(texto));
  }

  filtrarCiudades() {
    const texto = this.busquedaCiudad.toLowerCase().trim();
    if (!texto) { this.ciudadesFiltradas = [...this.ciudadesDelEstado]; return; }
    this.ciudadesFiltradas = this.ciudadesDelEstado.filter(c => c.toLowerCase().includes(texto));
  }

  mostrarEstados() {
    this.mostrarDropdownEstado = true;
    this.estadosFiltrados = [...this.estados];
  }

  mostrarCiudades() {
    this.mostrarDropdownCiudad = true;
    this.ciudadesFiltradas = [...this.ciudadesDelEstado];
  }

  ocultarDropdownEstado() {
    setTimeout(() => {
      this.mostrarDropdownEstado = false;

      const estadoCapturado = this.encontrarEstadoCompatible(this.busquedaEstado || '');
      if (estadoCapturado && estadoCapturado !== this.estado) {
        this.seleccionarEstado(estadoCapturado);
        return;
      }

      this.estado = (this.busquedaEstado || '').trim();
      if (!this.estado) {
        this.ciudadesDelEstado = [];
        this.ciudadesFiltradas = [];
        this.ciudad = '';
        this.busquedaCiudad = '';
      }

      this.busquedaEstado = this.estado || '';
    }, 200);
  }

  ocultarDropdownCiudad() {
    setTimeout(() => {
      this.mostrarDropdownCiudad = false;

      if (this.busquedaCiudad && this.busquedaCiudad.trim()) {
        this.ciudad = this.busquedaCiudad.trim();
      }

      this.busquedaCiudad = this.ciudad;
    }, 200);
  }

  seleccionarEstado(estadoSeleccionado: string) {
    this.estado = estadoSeleccionado;
    this.busquedaEstado = estadoSeleccionado;
    this.mostrarDropdownEstado = false;
    this.ciudadesDelEstado = CIUDADES_POR_ESTADO[estadoSeleccionado] || [];
    this.ciudadesFiltradas = [...this.ciudadesDelEstado];
    this.ciudad = '';
    this.busquedaCiudad = '';
    this.cargarMunicipiosDeEstado(estadoSeleccionado);
  }

  seleccionarCiudad(ciudadSeleccionada: string) {
    this.ciudad = ciudadSeleccionada;
    this.busquedaCiudad = ciudadSeleccionada;
    this.mostrarDropdownCiudad = false;
  }

  onCiudadInputChange(valor: string) {
    this.ciudad = (valor || '').trim();
  }

  onEstadoInputChange(valor: string) {
    this.estado = (valor || '').trim();
  }

  onEmpresaNombreChange(_valor: string) {
    if (!this.usuarioAccesoPersonalizado) {
      this.usuarioAcceso = this.generarUsuarioAcceso(this.empresaNueva);
    }
  }

  habilitarEdicionUsuarioAcceso() {
    this.usuarioAccesoEditando = true;
  }

  guardarUsuarioAcceso() {
    const usernameNormalizado = this.normalizarUsername(this.usuarioAcceso);
    if (!usernameNormalizado) {
      Swal.fire({
        title: 'Usuario inválido',
        text: 'El usuario debe contener letras o números',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    this.usuarioAcceso = usernameNormalizado;
    this.usuarioAccesoEditando = false;
    this.usuarioAccesoPersonalizado = true;
  }

  onCodigoPostalInput(event: any) {
    const valor = (event?.target?.value || '').toString().replace(/\D/g, '').slice(0, 5);
    this.codigoPostal = valor;

    if (event?.target) {
      event.target.value = valor;
    }

    if (this.cpAutofillTimeout) {
      clearTimeout(this.cpAutofillTimeout);
      this.cpAutofillTimeout = null;
    }

    if (valor.length < 5) {
      this.cpAutofillEstadoCiudadLoading = false;
      this.cpAutofillMensaje = '';
      this.cpUltimoConsultado = '';
      return;
    }

    if (valor === this.cpUltimoConsultado) {
      return;
    }

    this.cpAutofillTimeout = setTimeout(() => {
      this.autocompletarEstadoCiudadPorCodigoPostal(valor);
    }, 280);
  }

  private autocompletarEstadoCiudadPorCodigoPostal(codigoPostal: string) {
    this.cpAutofillEstadoCiudadLoading = true;
    this.cpAutofillMensaje = '';

    this.backendService.buscarCodigoPostalMx(codigoPostal).subscribe(
      (response: any) => {
        const estadoApi = (response?.estado || '').toString().trim();
        const municipioApi = (response?.municipio || response?.ciudad || '').toString().trim();
        const settlements = Array.isArray(response?.settlements)
          ? response.settlements.map((item: any) => (item || '').toString().trim()).filter((item: string) => !!item)
          : [];

        const municipioSugerido = municipioApi || settlements[0] || '';
        const estadoCompatible = this.encontrarEstadoCompatible(estadoApi) || estadoApi;

        if (estadoCompatible) {
          this.estado = estadoCompatible;
          this.busquedaEstado = estadoCompatible;
          this.cargarMunicipiosDeEstado(estadoCompatible);
        }

        if (municipioSugerido) {
          this.ciudad = municipioSugerido;
          this.busquedaCiudad = municipioSugerido;
          this.cpAutofillMensaje = 'Datos sugeridos por código postal (puedes corregirlos manualmente).';
          this.cpAutofillMensajeTipo = 'success';
        } else if (estadoCompatible) {
          this.ciudad = '';
          this.busquedaCiudad = '';
          this.cpAutofillMensaje = 'Estado sugerido por código postal. Captura el municipio manualmente.';
          this.cpAutofillMensajeTipo = 'info';
        } else {
          this.cpAutofillMensaje = 'No se encontraron datos actualizados para ese código postal. Captura manualmente.';
          this.cpAutofillMensajeTipo = 'warning';
        }

        this.cpAutofillEstadoCiudadLoading = false;
        this.cpUltimoConsultado = codigoPostal;
      },
      () => {
        this.cpAutofillMensaje = 'No fue posible consultar datos actualizados para ese código postal. Captura estado y municipio manualmente.';
        this.cpAutofillMensajeTipo = 'warning';
        this.cpAutofillEstadoCiudadLoading = false;
        this.cpUltimoConsultado = codigoPostal;
      }
    );
  }

  private encontrarEstadoCompatible(estado: string): string | null {
    const estadoNormalizado = this.normalizarTexto(estado);
    if (!estadoNormalizado) return null;

    return this.estados.find((item) => {
      const itemNormalizado = this.normalizarTexto(item);
      return itemNormalizado === estadoNormalizado ||
        itemNormalizado.includes(estadoNormalizado) ||
        estadoNormalizado.includes(itemNormalizado);
    }) || null;
  }

  private cargarMunicipiosDeEstado(estadoSeleccionado: string) {
    const cveEstado = ESTADO_A_CVE_INEGI[estadoSeleccionado];
    if (!cveEstado) {
      return;
    }

    const cache = this.municipiosPorEstadoCache[estadoSeleccionado];
    if (cache && cache.length > 0) {
      this.ciudadesDelEstado = [...cache];
      this.ciudadesFiltradas = [...cache];
      return;
    }

    this.backendService.obtenerMunicipiosPorEstadoInegi(cveEstado).subscribe(
      (response: any) => {
        const municipios: string[] = Array.isArray(response?.datos)
          ? response.datos
            .map((item: any) => (item?.nom_agem || '').toString().trim())
            .filter((nombre: string) => !!nombre)
          : [];

        if (municipios.length === 0) {
          return;
        }

        const unicos: string[] = [...new Set<string>(municipios)];
        unicos.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

        this.municipiosPorEstadoCache[estadoSeleccionado] = unicos;
        this.ciudadesDelEstado = [...unicos];
        this.ciudadesFiltradas = [...unicos];
      },
      () => {
      }
    );
  }

  private normalizarTexto(valor: string): string {
    return (valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private generarUsuarioAcceso(nombreEmpresa: string): string {
    const baseNormalizada = this.normalizarUsername(nombreEmpresa).slice(0, 5) || 'empre';
    const random = Math.floor(Math.random() * 9000) + 1000;
    return `${baseNormalizada}${random}`;
  }

  private normalizarUsername(valor: string): string {
    return (valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);
  }

  private obtenerCorreosAdicionalesCredenciales(): { validos: string[]; invalidos: string[] } {
    const valor = (this.correosAdicionalesCredenciales || '').trim();
    if (!valor) {
      return { validos: [], invalidos: [] };
    }

    const partes = valor
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter((item) => !!item);

    const validos: string[] = [];
    const invalidos: string[] = [];
    const vistos = new Set<string>();
    const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const correo of partes) {
      const normalizado = correo.toLowerCase();
      if (!regexCorreo.test(correo)) {
        invalidos.push(correo);
        continue;
      }
      if (vistos.has(normalizado)) {
        continue;
      }
      vistos.add(normalizado);
      validos.push(correo);
    }

    return { validos, invalidos };
  }
}
