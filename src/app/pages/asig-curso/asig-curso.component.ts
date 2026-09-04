import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { BackendServices } from 'src/app/services/backend.services';
import { AuthService } from 'src/app/services/auth.service';
import { CorreoSugerido, CorreoSugerenciasService } from 'src/app/services/correo-sugerencias.service';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import Swal from 'sweetalert2';
import { parsearFechaSoloDia } from 'src/app/utils/fecha.util';

@Component({
  selector: 'app-asig-curso',
  templateUrl: './asig-curso.component.html',
  styleUrls: ['./asig-curso.component.scss']
})
export class AsigCursoComponent implements OnInit {

  readonly apiUrl = environment.apiUrl;

  // Datos para los selects
  cursos: any[] = [];
  empresas: any[] = [];
  instructores: any[] = [];

  // Listas filtradas para búsqueda
  cursosFiltrados: any[] = [];
  empresasFiltradas: any[] = [];
  instructoresFiltrados: any[] = [];

  // Textos de búsqueda
  busquedaCurso: string = '';
  busquedaEmpresa: string = '';
  busquedaInstructor: string = '';

  // Control de foco para mostrar dropdowns
  mostrarDropdownCurso: boolean = false;
  mostrarDropdownEmpresa: boolean = false;
  mostrarDropdownInstructor: boolean = false;

  // Correos adicionales con sugerencias
  correosSugeridosFiltrados: CorreoSugerido[] = [];
  mostrarDropdownCorreo: boolean = false;
  correoAdicionalInput: string = '';
  correosAdicionalesSeleccionados: string[] = [];
  correoDropdownStyle: Record<string, string> = {};

  @ViewChild('correoAdicionalInputRef') correoAdicionalInputRef?: ElementRef<HTMLInputElement>;

  // Curso seleccionado para filtrar instructores
  cursoSeleccionado: any = null;

  // Estado de carga
  guardandoCurso: boolean = false;

  // Estado de Google Calendar
  calendarConectado: boolean = true;

  // Verificar si el usuario es instructor
  esInstructor: boolean = false;
  // Instructor sin privilegios de administrador/root
  esInstructorSolo: boolean = false;
  instructorId: number | null = null;
  areasDelInstructor: number[] = [];

  // Formulario de programacion
  programacionForm: any = {
    curso_id: null,
    empresa_id: null,
    instructor_id: null,
    fecha_inicio: '',
    hora_inicio: '',
    hora_fin: '',
    modalidad: 'presencial',
    ubicacion_direccion: '',
    lugar_capacitacion: '',
    codigo_postal: '',
    estado: '',
    ciudad: '',
    localidad: '',
    municipio: '',
    cupo: 25,
    notas: '',
    correos_adicionales: '' // Correos separados por comas
  };

  constructor(
    private backendService: BackendServices,
    private authService: AuthService,
    private correoSugerenciasService: CorreoSugerenciasService
  ) { }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onVentanaCambio(): void {
    if (this.mostrarDropdownCorreo) {
      this.actualizarPosicionDropdownCorreo();
    }
  }

  ngOnInit(): void {
    // Verificar si el usuario es instructor
    this.esInstructor = this.authService.esInstructor();
    this.esInstructorSolo = this.esInstructor && !this.authService.esAdministradorOSuperior();
    this.instructorId = this.authService.getInstructorId();

    this.cargarDatos();
    this.cargarCorreosSugeridos();
  }

  cargarDatos() {
    // Cargar cursos
    this.backendService.cursos().subscribe(
      (data: any) => {
        this.cursos = Array.isArray(data) ? data : (data.cursos || []);

        // Si es instructor solo, filtrar solo cursos de sus áreas
        if (this.esInstructorSolo && this.areasDelInstructor.length > 0) {
          this.cursos = this.cursos.filter(curso =>
            curso.area_id && this.areasDelInstructor.includes(curso.area_id)
          );
        }

        this.cursosFiltrados = [...this.cursos];
      }
    );

    // Cargar empresas
    this.backendService.obtenerEmpresas().subscribe(
      (data: any) => {
        if (data.success) {
          this.empresas = data.empresas;
          this.empresasFiltradas = [...this.empresas];
        }
      }
    );

    // Cargar instructores
    this.backendService.obtenerInstructores().subscribe(
      (data: any) => {
        if (data.success) {
          this.instructores = data.instructores;
          this.instructoresFiltrados = [...this.instructores];

          // Si el usuario es instructor solo, auto-seleccionarlo y obtener sus áreas
          if (this.esInstructorSolo && this.instructorId) {
            const instructorActual = this.instructores.find(i => i.instructor_id === this.instructorId);
            if (instructorActual) {
              // Guardar las áreas del instructor
              this.areasDelInstructor = instructorActual.area_ids_array || [];

              // Auto-seleccionar el instructor
              this.seleccionarInstructor(instructorActual);

              // Re-cargar cursos filtrados ahora que tenemos las áreas
              this.recargarCursosFiltrados();
            }
          }
        }
      }
    );
  }

  /**
   * Recarga los cursos y los filtra según las áreas del instructor
   * Se ejecuta después de obtener las áreas del instructor
   */
  recargarCursosFiltrados() {
    this.backendService.cursos().subscribe(
      (data: any) => {
        this.cursos = Array.isArray(data) ? data : (data.cursos || []);

        // Si es instructor solo, filtrar solo cursos de sus áreas
        if (this.esInstructorSolo && this.areasDelInstructor.length > 0) {
          this.cursos = this.cursos.filter(curso =>
            curso.area_id && this.areasDelInstructor.includes(curso.area_id)
          );
        }

        this.cursosFiltrados = [...this.cursos];
      }
    );
  }

  cargarCorreosSugeridos() {
    this.correoSugerenciasService.cargar(250).subscribe(
      () => this.filtrarCorreosSugeridos(),
      () => {
        this.correosSugeridosFiltrados = [];
      }
    );
  }

  private normalizarTexto(valor: string): string {
    return String(valor || '').toLowerCase().trim();
  }

  private normalizarCorreo(correo: string): string {
    return String(correo || '').trim().toLowerCase();
  }

  getCorreoAvatarUrl(sugerencia: CorreoSugerido): string | null {
    return this.correoSugerenciasService.getCorreoAvatarUrl(sugerencia);
  }

  getCorreoIniciales(sugerencia: CorreoSugerido): string {
    return this.correoSugerenciasService.getCorreoIniciales(sugerencia);
  }

  onCorreoAvatarError(sugerencia: CorreoSugerido): void {
    this.correoSugerenciasService.onCorreoAvatarError(sugerencia);
  }

  actualizarPosicionDropdownCorreo(): void {
    const input = this.correoAdicionalInputRef?.nativeElement;
    if (!input) {
      return;
    }
    this.correoDropdownStyle = this.correoSugerenciasService.estiloDropdownFijo(input, 260);
  }

  mostrarCorreosSugeridos() {
    this.mostrarDropdownCorreo = true;
    this.filtrarCorreosSugeridos();
  }

  ocultarDropdownCorreo() {
    setTimeout(() => this.mostrarDropdownCorreo = false, 200);
  }

  filtrarCorreosSugeridos() {
    this.correosSugeridosFiltrados = this.correoSugerenciasService.filtrar(
      this.correoAdicionalInput,
      this.correosAdicionalesSeleccionados
    );
  }

  onCorreoAdicionalInput(valor: string) {
    this.correoAdicionalInput = valor;
    if (/[;\n,]/.test(valor)) {
      this.agregarCorreosDesdeTexto(valor, true);
      return;
    }
    const texto = this.correoAdicionalInput.trim();
    this.mostrarDropdownCorreo = texto.length > 0;
    this.filtrarCorreosSugeridos();
    if (this.mostrarDropdownCorreo) {
      setTimeout(() => this.actualizarPosicionDropdownCorreo());
    }
  }

  onCorreoAdicionalKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.agregarCorreosDesdeTexto(this.correoAdicionalInput, false);
      return;
    }

    if (event.key === 'Backspace' && !this.correoAdicionalInput && this.correosAdicionalesSeleccionados.length > 0) {
      const ultimo = this.correosAdicionalesSeleccionados[this.correosAdicionalesSeleccionados.length - 1];
      this.eliminarCorreoAdicional(ultimo);
    }
  }

  onCorreoAdicionalBlur() {
    if (this.correoAdicionalInput) {
      this.agregarCorreosDesdeTexto(this.correoAdicionalInput, false);
    }
    this.ocultarDropdownCorreo();
  }

  private agregarCorreosDesdeTexto(texto: string, mantenerUltimo: boolean) {
    const partes = String(texto || '').split(/[;\n,]/).map((item) => item.trim()).filter(Boolean);
    if (partes.length === 0) {
      this.filtrarCorreosSugeridos();
      return;
    }

    let candidatos = partes;
    let ultimo = '';

    if (mantenerUltimo && partes.length > 1) {
      ultimo = partes[partes.length - 1];
      candidatos = partes.slice(0, -1);
    } else if (mantenerUltimo && partes.length === 1 && !this.validarEmail(partes[0])) {
      this.filtrarCorreosSugeridos();
      return;
    }

    candidatos.forEach((correo) => this.agregarCorreoAdicional(correo));
    this.correoAdicionalInput = mantenerUltimo ? ultimo : '';
    this.mostrarDropdownCorreo = this.correoAdicionalInput.trim().length > 0;
    this.filtrarCorreosSugeridos();
  }

  seleccionarCorreoSugerido(sugerencia: CorreoSugerido) {
    if (!sugerencia?.email) return;
    this.agregarCorreoAdicional(sugerencia.email);
    this.correoAdicionalInput = '';
    this.mostrarDropdownCorreo = false;
  }

  agregarCorreoAdicional(correo: string) {
    const normalizado = this.normalizarCorreo(correo);
    if (!normalizado || !this.validarEmail(normalizado)) return;

    const yaExiste = this.correosAdicionalesSeleccionados.some(
      (item) => this.normalizarCorreo(item) === normalizado
    );
    if (yaExiste) return;

    this.correosAdicionalesSeleccionados = [
      ...this.correosAdicionalesSeleccionados,
      normalizado
    ];
    this.sincronizarCorreosAdicionalesForm();
    this.correoSugerenciasService.guardarPersonalSiNuevo(normalizado);
  }

  eliminarCorreoAdicional(correo: string) {
    const normalizado = this.normalizarCorreo(correo);
    this.correosAdicionalesSeleccionados = this.correosAdicionalesSeleccionados.filter(
      (item) => this.normalizarCorreo(item) !== normalizado
    );
    this.sincronizarCorreosAdicionalesForm();
    this.filtrarCorreosSugeridos();
  }

  private sincronizarCorreosAdicionalesForm(): void {
    this.programacionForm.correos_adicionales = this.correosAdicionalesSeleccionados.join(', ');
  }

  programarCurso() {
    if (!this.programacionForm.curso_id || !this.programacionForm.empresa_id || !this.programacionForm.fecha_inicio) {
      Swal.fire({
        title: 'Campos Requeridos',
        text: 'Curso, empresa y fecha de inicio son requeridos',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (!this.programacionForm.instructor_id) {
      Swal.fire({
        title: 'Instructor Requerido',
        text: 'Debes asignar un instructor antes de programar el curso',
        icon: 'warning',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    // Activar estado de carga
    this.guardandoCurso = true;

    // Obtener el nombre completo del usuario actual para created_by
    const usuarioActual = this.authService.usuarioActualValue;
    let nombreUsuario = '';
    if (usuarioActual) {
      const nombre = usuarioActual.nombre || '';
      const apellido = usuarioActual.apellido_paterno || usuarioActual.apellido || '';
      nombreUsuario = `${nombre} ${apellido}`.trim() || usuarioActual.username || '';
    }

    // Preparar los datos para enviar
    const datosCurso = {
      curso_id: this.programacionForm.curso_id,
      empresa_id: this.programacionForm.empresa_id,
      instructor_id: this.programacionForm.instructor_id,
      fecha_inicio: this.programacionForm.fecha_inicio,
      fecha_fin: this.programacionForm.fecha_fin || null,
      hora_inicio: this.programacionForm.hora_inicio || null,
      hora_fin: this.programacionForm.hora_fin || null,
      modalidad: this.programacionForm.modalidad,
      ubicacion: this.programacionForm.lugar_capacitacion || null,
      codigo_postal: this.programacionForm.codigo_postal || null,
      estado: this.programacionForm.estado || this.programacionForm.localidad || null,
      ciudad: this.programacionForm.ciudad || this.programacionForm.municipio || null,
      localidad: this.programacionForm.localidad || null,
      cupo: this.programacionForm.cupo || 25,
      notas: this.programacionForm.notas || null,
      created_by: nombreUsuario || null
    };

    this.backendService.crearCursoProgramado(datosCurso).subscribe(
      async (response: any) => {
        if (response.success) {
          const esFechaAnteriorAHoy = this.esFechaProgramadaAntesDeHoy();
          const programadoId = response.programado_id;

          const curso = this.cursos.find(c => c.curso_id === this.programacionForm.curso_id);
          const empresa = this.empresas.find(e => e.empresa_id === this.programacionForm.empresa_id);
          const instructor = this.instructores.find(i => i.instructor_id === this.programacionForm.instructor_id);

          const cursoNombre = curso?.nombre_curso || 'Curso';
          const empresaNombre = empresa?.nombre_empresa || 'Empresa';
          const instructorNombre = instructor ? `${instructor.nombre} ${instructor.apellido_paterno} ${instructor.apellido_materno || ''}`.trim() : 'Sin asignar';

          // Preparar lista de correos (empresa + instructor + adicionales)
          let attendees: string[] = [];

          if (!esFechaAnteriorAHoy) {
            const emailEmpresa = empresa?.usuario_email || empresa?.email || empresa?.contacto_email;
            if (emailEmpresa && this.validarEmail(emailEmpresa)) {
              attendees.push(emailEmpresa);
            }

            const emailInstructor = instructor?.usuario_email || instructor?.email;
            if (emailInstructor && this.validarEmail(emailInstructor)) {
              // Evitar duplicar
              if (!attendees.includes(emailInstructor)) {
                attendees.push(emailInstructor);
              }
            }

            const correosExtras = this.getCorreosAdicionalesArray();
            if (correosExtras.length > 0) {
              attendees.push(...correosExtras);
            }
          }

          let htmlMensaje = 'Curso programado exitosamente<br><small>✓ Guardado en la base de datos</small>';

          // === CREAR EVENTO EN GOOGLE CALENDAR CORPORATIVO ===
          try {
            const fechaInicio = this.programacionForm.fecha_inicio;
            const horaInicio = this.programacionForm.hora_inicio || '09:00';
            const fechaFin = this.programacionForm.fecha_inicio;
            const horaFin = this.programacionForm.hora_fin || '17:00';

            const startDateTime = new Date(`${fechaInicio}T${horaInicio}:00`);
            const endDateTime = new Date(`${fechaFin}T${horaFin}:00`);

            const eventData = {
              summary: `${cursoNombre} - ${empresaNombre}`,
              description: `Curso: ${cursoNombre}\nEmpresa: ${empresaNombre}\nInstructor: ${instructorNombre}\nModalidad: ${this.programacionForm.modalidad}\nDirección base: ${this.programacionForm.ubicacion_direccion || 'Por definir'}\nLugar específico: ${this.programacionForm.lugar_capacitacion || 'Por definir'}\n${(this.programacionForm.ciudad || this.programacionForm.municipio) ? 'Ciudad: ' + (this.programacionForm.ciudad || this.programacionForm.municipio) : ''}${(this.programacionForm.estado || this.programacionForm.localidad) ? ', ' + (this.programacionForm.estado || this.programacionForm.localidad) : ''}\nNotas: ${this.programacionForm.notas || ''}`,
              location: this.programacionForm.lugar_capacitacion || this.programacionForm.ubicacion_direccion || '',
              startDateTime: startDateTime.toISOString(),
              endDateTime: endDateTime.toISOString(),
              attendees: attendees,
              instructorId: this.programacionForm.instructor_id,
              cursoId: programadoId.toString(),
              sendInvitations: !esFechaAnteriorAHoy
            };

            const calendarResponse: any = await firstValueFrom(
              this.backendService.crearEventoCursoGoogleCalendar(eventData)
            );

            if (calendarResponse?.success) {
              this.calendarConectado = true;
              htmlMensaje += esFechaAnteriorAHoy
                ? '<br><small>&#10003; Agregado a Google Calendar corporativo (sin envío de correos por fecha anterior al día actual)</small>'
                : '<br><small>&#10003; Agregado a Google Calendar corporativo</small>';

              if (!esFechaAnteriorAHoy && attendees.length > 0) {
                htmlMensaje += `<br><small>&#10003; Invitación de calendario enviada a ${attendees.length} asistente(s)</small>`;
              }
            } else {
              this.calendarConectado = false;
              htmlMensaje += '<br><small class="text-warning">No se pudo agregar a Google Calendar corporativo</small>';
            }
          } catch (calendarError: any) {
            this.calendarConectado = false;
            htmlMensaje += '<br><small class="text-warning">No se pudo agregar a Google Calendar corporativo</small>';
            const detalleCalendar = calendarError?.error?.message || calendarError?.error?.google_error;
            if (detalleCalendar) {
              htmlMensaje += `<br><small class="text-muted">${detalleCalendar}</small>`;
            }
          }

          // === ENVIAR INVITACION POR CORREO ===
          if (!esFechaAnteriorAHoy) {
            try {
              const datosInvitacion = {
                curso_id: this.programacionForm.curso_id,
                empresa_id: this.programacionForm.empresa_id,
                instructor_id: this.programacionForm.instructor_id,
                fecha_inicio: this.programacionForm.fecha_inicio,
                fecha_fin: this.programacionForm.fecha_fin || null,
                hora_inicio: this.programacionForm.hora_inicio || null,
                hora_fin: this.programacionForm.hora_fin || null,
                modalidad: this.programacionForm.modalidad,
                ubicacion: this.programacionForm.lugar_capacitacion || null,
                codigo_postal: this.programacionForm.codigo_postal || null,
                estado: this.programacionForm.estado || this.programacionForm.localidad || null,
                ciudad: this.programacionForm.ciudad || this.programacionForm.municipio || null,
                cupo: this.programacionForm.cupo || 25,
                notas: this.programacionForm.notas || null,
                correos_adicionales: this.programacionForm.correos_adicionales || null
              };

              this.backendService.enviarInvitacionCurso(datosInvitacion).subscribe(
                (emailRes: any) => {
                  if (emailRes.success) {
                  } else {
                  }
                },
                (emailErr) => {
                }
              );
              htmlMensaje += `<br><small class="text-success">✓ Notificación por correo enviada</small>`;
            } catch (emailError) {
            }
          } else {
            htmlMensaje += '<br><small class="text-muted">Notificación por correo omitida por ser una fecha anterior al día actual</small>';
          }

          this.guardandoCurso = false;
          Swal.fire({
            title: '¡Programado!',
            html: htmlMensaje,
            icon: 'success',
            confirmButtonColor: '#38512F'
          });

          this.limpiarFormulario();
        } else {
          this.guardandoCurso = false;
          Swal.fire({
            title: 'Error',
            text: response.message || 'No se pudo programar el curso',
            icon: 'error',
            confirmButtonColor: '#38512F'
          });
        }
      },
      (error) => {
        console.error('Error:', error);
        this.guardandoCurso = false;
        Swal.fire({
          title: 'Error',
          text: error.error?.message || 'Error de conexión',
          icon: 'error',
          confirmButtonColor: '#38512F'
        });
      }
    );
  }

  limpiarFormulario() {
    this.programacionForm = {
      curso_id: null,
      empresa_id: null,
      instructor_id: null,
      fecha_inicio: '',
      hora_inicio: '',
      hora_fin: '',
      modalidad: 'presencial',
      ubicacion_direccion: '',
      lugar_capacitacion: '',
      codigo_postal: '',
      estado: '',
      ciudad: '',
      localidad: '',
      municipio: '',
      cupo: 25,
      notas: '',
      correos_adicionales: ''
    };
    this.correoAdicionalInput = '';
    this.correosAdicionalesSeleccionados = [];
    this.busquedaCurso = '';
    this.busquedaEmpresa = '';
    this.busquedaInstructor = '';
    this.cursoSeleccionado = null;
    this.cursosFiltrados = [...this.cursos];
    this.empresasFiltradas = [...this.empresas];
    this.instructoresFiltrados = [...this.instructores];
  }

  /**
   * Validar formato de email
   */
  validarEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  esFechaProgramadaAntesDeHoy(): boolean {
    const fechaCurso = parsearFechaSoloDia(this.programacionForm.fecha_inicio);
    if (!fechaCurso) {
      return false;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    return fechaCurso.getTime() < hoy.getTime();
  }

  // Métodos de filtrado
  filtrarCursos() {
    const texto = this.busquedaCurso.toLowerCase().trim();
    if (!texto) {
      this.cursosFiltrados = [...this.cursos];
      return;
    }
    this.cursosFiltrados = this.cursos.filter(c =>
      c.nombre_curso?.toLowerCase().includes(texto) ||
      c.codigo?.toLowerCase().includes(texto)
    );
  }

  filtrarEmpresas() {
    const texto = this.busquedaEmpresa.toLowerCase().trim();
    if (!texto) {
      this.empresasFiltradas = [...this.empresas];
      return;
    }
    this.empresasFiltradas = this.empresas.filter(e =>
      e.nombre_empresa?.toLowerCase().includes(texto)
    );
  }

  getLogoEmpresaUrl(empresa: any): string | null {
    return this.backendService.resolverUrlDrivePreview(empresa?.logo || empresa?.logo_url);
  }

  getFotoInstructorUrl(inst: any): string | null {
    return this.backendService.resolverUrlDrivePreview(inst?.foto_drive_id || inst?.foto_url);
  }

  onLogoError(empresa: any): void {
    if (!empresa) return;
    empresa.logo = null;
    empresa.logo_url = null;
  }

  /**
   * Filtra instructores por texto Y por área del curso seleccionado
   */
  filtrarInstructores() {
    const texto = this.busquedaInstructor.toLowerCase().trim();

    // Primero filtramos por área del curso si hay uno seleccionado
    let instructoresBase = [...this.instructores];
    if (this.cursoSeleccionado && this.cursoSeleccionado.area_id) {
      instructoresBase = this.instructores.filter(i =>
        i.area_ids_array && i.area_ids_array.includes(this.cursoSeleccionado.area_id)
      );

      // En perfil combinado (instructor + admin/root), permitir siempre auto-asignarse
      if (!this.esInstructorSolo && this.esInstructor && this.instructorId) {
        const instructorPropio = this.instructores.find(i => i.instructor_id === this.instructorId);
        if (instructorPropio && !instructoresBase.some(i => i.instructor_id === instructorPropio.instructor_id)) {
          instructoresBase = [instructorPropio, ...instructoresBase];
        }
      }
    }

    // Luego filtramos por texto
    if (!texto) {
      this.instructoresFiltrados = instructoresBase;
      return;
    }

    this.instructoresFiltrados = instructoresBase.filter(i =>
      `${i.nombre} ${i.apellido_paterno}`.toLowerCase().includes(texto) ||
      i.areas?.toLowerCase().includes(texto)
    );
  }

  // Mostrar/ocultar dropdowns
  mostrarCursos() {
    this.mostrarDropdownCurso = true;
    this.cursosFiltrados = [...this.cursos];
  }

  mostrarEmpresas() {
    this.mostrarDropdownEmpresa = true;
    this.empresasFiltradas = [...this.empresas];
  }

  mostrarInstructores() {
    this.mostrarDropdownInstructor = true;
    // Filtrar por área del curso seleccionado
    this.filtrarInstructores();
  }

  ocultarDropdownCurso() {
    setTimeout(() => this.mostrarDropdownCurso = false, 200);
  }

  ocultarDropdownEmpresa() {
    setTimeout(() => this.mostrarDropdownEmpresa = false, 200);
  }

  ocultarDropdownInstructor() {
    setTimeout(() => this.mostrarDropdownInstructor = false, 200);
  }

  // Seleccionar desde la lista filtrada
  seleccionarCurso(curso: any) {
    this.programacionForm.curso_id = curso.curso_id;
    this.busquedaCurso = curso.nombre_curso;
    this.cursoSeleccionado = curso;
    this.mostrarDropdownCurso = false;

    // Limpiar instructor seleccionado si no coincide con el área del nuevo curso
    if (this.programacionForm.instructor_id) {
      const instructorActual = this.instructores.find(i => i.instructor_id === this.programacionForm.instructor_id);
      if (instructorActual && curso.area_id) {
        if (!instructorActual.area_ids_array?.includes(curso.area_id)) {
          const esInstructorPropioEnPerfilCombinado = !this.esInstructorSolo &&
            this.esInstructor &&
            !!this.instructorId &&
            instructorActual.instructor_id === this.instructorId;

          // En perfil combinado, conservar selección si es su propio instructor
          if (esInstructorPropioEnPerfilCombinado) {
            this.filtrarInstructores();
            return;
          }

          // El instructor actual no tiene el área del curso, limpiarlo
          this.programacionForm.instructor_id = null;
          this.busquedaInstructor = '';
        }
      }
    }

    // Actualizar lista de instructores filtrados
    this.filtrarInstructores();
  }

  seleccionarEmpresa(empresa: any) {
    this.programacionForm.empresa_id = empresa.empresa_id;
    this.busquedaEmpresa = empresa.nombre_empresa;
    this.autocompletarUbicacionDesdeEmpresa(empresa);
    this.mostrarDropdownEmpresa = false;
  }

  private autocompletarUbicacionDesdeEmpresa(empresa: any): void {
    const cp = String(empresa?.codigo_postal || '').replace(/\D/g, '').slice(0, 5);
    const estado = String(empresa?.estado || '').trim();
    const ciudad = String(empresa?.ciudad || '').trim();
    const direccion = String(empresa?.direccion || '').trim();

    this.programacionForm.codigo_postal = cp;
    this.programacionForm.estado = estado;
    this.programacionForm.localidad = estado;
    this.programacionForm.ciudad = ciudad;
    this.programacionForm.municipio = ciudad;
    this.programacionForm.ubicacion_direccion = direccion;
  }

  seleccionarInstructor(instructor: any) {
    this.programacionForm.instructor_id = instructor.instructor_id;
    this.busquedaInstructor = `${instructor.nombre} ${instructor.apellido_paterno}`;
    this.mostrarDropdownInstructor = false;
  }

  /**
   * Obtener email del instructor seleccionado
   */
  getInstructorEmail(): string {
    if (!this.programacionForm.instructor_id) return '';
    const instructor = this.instructores.find(i => i.instructor_id === this.programacionForm.instructor_id);
    return instructor?.usuario_email || '';
  }

  /**
   * Obtener email de la empresa seleccionada
   */
  getEmpresaEmail(): string {
    if (!this.programacionForm.empresa_id) return '';
    const empresa = this.empresas.find(e => e.empresa_id === this.programacionForm.empresa_id);
    return empresa?.usuario_email || '';
  }

  /**
   * Obtener array de correos adicionales válidos para mostrar en chips
   */
  getCorreosAdicionalesArray(): string[] {
    if (this.correosAdicionalesSeleccionados.length > 0) {
      return this.correosAdicionalesSeleccionados
        .map((email) => this.normalizarCorreo(email))
        .filter((email) => email && this.validarEmail(email));
    }

    if (!this.programacionForm.correos_adicionales || !this.programacionForm.correos_adicionales.trim()) {
      return [];
    }

    return this.programacionForm.correos_adicionales
      .split(',')
      .map((email: string) => this.normalizarCorreo(email))
      .filter((email: string) => email && this.validarEmail(email));
  }

}
