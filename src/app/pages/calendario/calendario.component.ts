import { Component, OnInit } from '@angular/core';
import { GoogleCalendarService } from '../../services/google-calendar.service';
import { BackendServices } from '../../services/backend.services';
import { AuthService } from '../../services/auth.service';
import Swal from 'sweetalert2';

interface CalendarSidebarItem {
  id: string;
  nombre: string;
  color: string;
  seleccionado: boolean;
  fijo?: boolean;
}

@Component({
  selector: 'app-calendario',
  templateUrl: './calendario.component.html',
  styleUrls: ['./calendario.component.scss']
})
export class CalendarioComponent implements OnInit {
  calendarSrc: string;
  readonly calendarObjetivoId: string;
  googleCalendarConnected = false;
  googleCalendarAccountEmail: string | null = null;
  calendariosSidebar: CalendarSidebarItem[] = [];
  isLoadingCalendariosSidebar = false;
  
  // Eventos del calendario
  eventosCalendario: any[] = [];
  eventosFiltrados: any[] = [];
  eventoSeleccionado: any = null;
  busquedaEvento: string = '';
  listaEventosAbierta: boolean = false;
  
  // Correos de asistentes para invitaciones
  attendeesEmails: string = '';
  
  // Cursos programados
  cursosProgramados: any[] = [];
  isLoadingCursos = false;
  
  // Control de sincronización
  private yaSincronizado = false;
  private cursosSincronizadosIds = new Set<string>(); // Guardar IDs de cursos ya sincronizados

  private esEmpresa: boolean = false;
  private empresaId: number | null = null;
  private esInstructor: boolean = false;
  private instructorId: number | null = null;

  constructor(
    private googleCalendarService: GoogleCalendarService,
    private backendService: BackendServices,
    private authService: AuthService
  ) {
    this.calendarObjetivoId = this.googleCalendarService.getTargetCalendarId();
    this.inicializarCalendariosSidebarBase();
    this.calendarSrc = this.googleCalendarService.getCalendarEmbedUrl({
      calendarIds: this.obtenerCalendariosSeleccionados()
    });
  }

  async ngOnInit(): Promise<void> {
    // Identificar rol para filtrar cursos
    this.esEmpresa = this.authService.esUsuarioEmpresa();
    this.empresaId = this.authService.getEmpresaId();
    this.esInstructor = this.authService.esInstructor();
    this.instructorId = this.authService.getInstructorId();

    // Inicializar Google Calendar API (autenticación automática si hay token guardado)
    try {
      await this.googleCalendarService.initClient();
      this.actualizarEstadoGoogleCalendar();
      await this.cargarCalendariosSidebar();

      // Cargar eventos del calendario
      await this.cargarEventosCalendario();

      // Cargar cursos programados desde la BD
      this.cargarCursosProgramados();
    } catch (error) {
      this.actualizarEstadoGoogleCalendar();
      this.inicializarCalendariosSidebarBase();
      this.actualizarIframeCalendario();
      // Cargar cursos de todas formas
      this.cargarCursosProgramados();
    }
  }

  private actualizarEstadoGoogleCalendar(): void {
    this.googleCalendarConnected = this.googleCalendarService.isAuthenticated();
    this.googleCalendarAccountEmail = this.googleCalendarService.getAuthenticatedAccountEmail();
  }

  /**
   * Cargar cursos programados desde la base de datos
   */
  cargarCursosProgramados(): void {
    this.isLoadingCursos = true;

    // Empresa sin empresa_id: no puede cargar cursos
    if (this.esEmpresa && !this.empresaId) {
      this.cursosProgramados = [];
      this.isLoadingCursos = false;
      return;
    }

    // Seleccionar endpoint según rol usando BackendService (incluye token de auth automáticamente)
    let request$;
    if (this.esEmpresa && this.empresaId) {
      request$ = this.backendService.obtenerCursosProgramadosPorEmpresa(this.empresaId);
    } else if (this.esInstructor && this.instructorId) {
      request$ = this.backendService.obtenerCursosProgramadosPorInstructor(this.instructorId);
    } else {
      request$ = this.backendService.obtenerCursosProgramados();
    }

    request$.subscribe({
      next: (response: any) => {
        this.cursosProgramados = response.cursosProgramados || [];
        this.isLoadingCursos = false;

        // Sincronizar solo una vez al cargar por primera vez
        if (!this.yaSincronizado && this.googleCalendarService.isAuthenticated()) {
          this.sincronizarConGoogleCalendar();
          this.yaSincronizado = true;
        }
      },
      error: (error: any) => {
        this.isLoadingCursos = false;
      }
    });
  }

  /**
   * Sincronizar cursos programados con Google Calendar
   */
  async sincronizarConGoogleCalendar(): Promise<void> {
    if (!this.googleCalendarService.isAuthenticated()) {
      return;
    }

    if (this.cursosProgramados.length === 0) {
      return;
    }


    try {
      // IMPORTANTE: Obtener eventos existentes de Google Calendar para evitar duplicados
      const eventosExistentes = await this.googleCalendarService.getEvents();
      
      // Verificar si hay eventos con formato antiguo "ID: XXXX" (sin corchetes)
      const eventosFormatoAntiguo = eventosExistentes.filter((evento: any) => {
        // Buscar eventos que tengan "ID: " o "[ID:" en la descripción (formato antiguo)
        return evento.description && (evento.description.match(/^ID:\s*\d+/) || evento.description.includes('[ID:'));
      });
      
      // Si hay eventos con formato antiguo, eliminarlos automáticamente
      if (eventosFormatoAntiguo.length > 0) {
        
        for (const evento of eventosFormatoAntiguo) {
          try {
            await this.googleCalendarService.deleteEvent(evento.id);
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            // handled
          }
        }
        
        
        // Volver a obtener la lista actualizada después de eliminar
        const eventosActualizados = await this.googleCalendarService.getEvents();
        
        // Extraer IDs de los eventos actualizados (ahora desde extendedProperties)
        const idsExistentes = new Set<string>();
        eventosActualizados.forEach((evento: any) => {
          // Buscar en extendedProperties.private.cursoId (nuevo formato)
          if (evento.extendedProperties?.private?.cursoId) {
            idsExistentes.add(evento.extendedProperties.private.cursoId);
          }
        });
        
        await this.sincronizarCursos(idsExistentes);
      } else {
        // No hay formato antiguo, sincronización normal
        const idsExistentes = new Set<string>();
        eventosExistentes.forEach((evento: any) => {
          // Buscar en extendedProperties.private.cursoId (nuevo formato invisible)
          if (evento.extendedProperties?.private?.cursoId) {
            idsExistentes.add(evento.extendedProperties.private.cursoId);
          } else {
            // Fallback: buscar en descripción (formatos antiguos)
            const match = evento.description?.match(/(?:ID:\s*(\d+)|\[ID:(\d+)\])/);
            if (match) {
              const id = match[1] || match[2];
              if (id) {
                idsExistentes.add(id);
              }
            }
          }
        });
        
        await this.sincronizarCursos(idsExistentes);
      }
      
      this.yaSincronizado = true;
    } catch (error) {
      console.error('❌ Error en sincronización con Google Calendar:', error);
    }
  }

  /**
   * Sincroniza solo los cursos que no existen en Google Calendar
   */
  private async sincronizarCursos(idsExistentes: Set<string>): Promise<void> {
    let eventosCreados = 0;
    const promesasCreacion: Promise<void>[] = [];
      
      for (const curso of this.cursosProgramados) {
        const cursoId = curso.programado_id?.toString();
        
        try {
          if (!cursoId) {
            continue;
          }
          
          // Verificar si YA EXISTE en Google Calendar
          if (idsExistentes.has(cursoId)) {
            continue;
          }
          
          // Verificar campos requeridos
          if (!curso.fecha_inicio) {
            continue;
          }
          
          // Construir fechas
          const fechaInicio = curso.fecha_inicio;
          const fechaFin = curso.fecha_fin || curso.fecha_inicio;
          let horaInicio = curso.hora_inicio || '09:00:00';
          let horaFin = curso.hora_fin || '17:00:00';
          
          // Limpiar formato de hora (eliminar milisegundos si existen)
          if (typeof horaInicio === 'string') {
            horaInicio = horaInicio.split('.')[0];
          }
          if (typeof horaFin === 'string') {
            horaFin = horaFin.split('.')[0];
          }
          
          // Formato: YYYY-MM-DDTHH:mm:ss
          const startDateTime = new Date(`${fechaInicio.split('T')[0]}T${horaInicio}`);
          const endDateTime = new Date(`${fechaFin.split('T')[0]}T${horaFin}`);
          
          // VALIDACIÓN: Si la fecha de fin es anterior a la de inicio, ajustar
          if (endDateTime <= startDateTime) {
            // Si es el mismo día, agregar 8 horas a la fecha de inicio
            endDateTime.setTime(startDateTime.getTime() + (8 * 60 * 60 * 1000));
          }
          
          // Construir título del evento
          const cursoNombre = curso.nombre_curso || 'Curso sin nombre';
          const empresaNombre = curso.nombre_empresa || 'Empresa';
          const summary = `${cursoNombre} - ${empresaNombre}`;
          
          // IMPORTANTE: Obtener instructor desde TODAS las posibles columnas de la vista
          let instructorNombre = 'Sin asignar';
          
          // La vista debe tener estos campos del JOIN con instructor
          if (curso.instructor_id) {
            // Intentar con diferentes combinaciones de nombres de columnas
            const nombre = curso.instructor_nombre || curso.nombre_instructor || '';
            const apellidoP = curso.instructor_apellido_paterno || curso.apellido_paterno_instructor || '';
            const apellidoM = curso.instructor_apellido_materno || curso.apellido_materno_instructor || '';
            
            if (nombre || apellidoP) {
              instructorNombre = `${nombre} ${apellidoP} ${apellidoM}`.trim();
            }
          }
          
          
          // Crear promesa sin await (ejecución paralela)
          const promesa = this.googleCalendarService.createEvent({
            summary: summary,
            description: `Curso: ${cursoNombre}\nEmpresa: ${empresaNombre}\nInstructor: ${instructorNombre}\nModalidad: ${curso.modalidad || 'Presencial'}\nEstatus: ${curso.estatus || 'Programado'}\nLocalidad: ${curso.localidad || ''}\nNotas: ${curso.notas || ''}`,
            location: curso.ubicacion || '',
            startDateTime: startDateTime,
            endDateTime: endDateTime,
            attendees: [],
            cursoId: cursoId
          }).then(() => {
            // Marcar como sincronizado en memoria también
            this.cursosSincronizadosIds.add(cursoId);
            eventosCreados++;
          }).catch((error: any) => {
            console.error(`❌ Error al crear evento ${cursoId}:`, error);
          });

          promesasCreacion.push(promesa);
          
        } catch (error: any) {
          console.error(`❌ Error al preparar curso ${cursoId}:`, error);
          console.error(`   Datos del curso:`, {
            nombre: curso.nombre_curso,
            fecha_inicio: curso.fecha_inicio,
            fecha_fin: curso.fecha_fin,
            hora_inicio: curso.hora_inicio,
            hora_fin: curso.hora_fin
          });
        }
      }

      // Ejecutar todas las creaciones en paralelo
      if (promesasCreacion.length > 0) {
        await Promise.all(promesasCreacion);
      }

      
      if (eventosCreados > 0) {
        // Refrescar el calendario
        setTimeout(() => this.refreshCalendar(), 2000);
      }
  }

  /**
   * Refrescar el iframe del calendario
   */
  refreshCalendar(): void {
    this.actualizarIframeCalendario(new Date().getTime());
  }

  /**
   * Conectar con Google Calendar
   */
  async signInWithGoogle(): Promise<void> {
    if (this.googleCalendarService.isAuthenticated()) {
      this.actualizarEstadoGoogleCalendar();
      return;
    }

    try {
      await this.googleCalendarService.signIn();
      this.actualizarEstadoGoogleCalendar();
      await this.cargarCalendariosSidebar();
      Swal.fire({
        icon: 'success',
        title: '¡Conectado!',
        text: 'Conectado exitosamente con Google Calendar',
        confirmButtonColor: '#38512F',
        timer: 2000
      });
      
      // Cargar eventos del calendario
      await this.cargarEventosCalendario();
      
      // Sincronizar solo si no se ha sincronizado antes
      if (!this.yaSincronizado && this.cursosProgramados.length > 0) {
        await this.sincronizarConGoogleCalendar();
        this.yaSincronizado = true;
      }
    } catch (error) {
      this.actualizarEstadoGoogleCalendar();
      console.error('Error al conectar con Google:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: this.extraerMensajeErrorGoogle(error),
        confirmButtonColor: '#38512F'
      });
    }
  }

  private extraerMensajeErrorGoogle(error: any): string {
    const mensaje = String(
      error?.message ||
      error?.result?.error?.message ||
      ''
    ).trim();

    return mensaje || 'Error al conectar con Google. Por favor, intenta de nuevo.';
  }

  crearEventoRapido(): void {
    const fechaBase = new Date();
    fechaBase.setHours(0, 0, 0, 0);
    const inicio = this.formatearFechaGoogleDateTime(fechaBase, '090000');
    const fin = this.formatearFechaGoogleDateTime(fechaBase, '100000');

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      src: this.calendarObjetivoId,
      ctz: 'America/Mexico_City',
      dates: `${inicio}/${fin}`
    });

    window.open(`https://calendar.google.com/calendar/u/0/r/eventedit?${params.toString()}`, '_blank', 'noopener');
  }

  cambiarSeleccionCalendario(calendario: CalendarSidebarItem, event: Event): void {
    const checked = Boolean((event.target as HTMLInputElement | null)?.checked);

    if (calendario.fijo) {
      calendario.seleccionado = true;
      return;
    }

    calendario.seleccionado = checked;
    this.actualizarIframeCalendario(new Date().getTime());
  }

  private async cargarCalendariosSidebar(): Promise<void> {
    this.calendariosSidebar = [
      {
        id: this.calendarObjetivoId,
        nombre: 'risktechbiznaga@gmail.com',
        color: '#1a73e8',
        seleccionado: true,
        fijo: true
      }
    ];

    this.actualizarIframeCalendario(new Date().getTime());
  }

  private inicializarCalendariosSidebarBase(): void {
    this.calendariosSidebar = [
      {
        id: this.calendarObjetivoId,
        nombre: 'risktechbiznaga@gmail.com',
        color: '#1a73e8',
        seleccionado: true,
        fijo: true
      }
    ];
  }

  private actualizarIframeCalendario(refreshToken?: number): void {
    this.calendarSrc = this.googleCalendarService.getCalendarEmbedUrl({
      refreshToken,
      calendarIds: this.obtenerCalendariosSeleccionados()
    });
  }

  private obtenerCalendariosSeleccionados(): string[] {
    return [this.calendarObjetivoId];
  }

  private formatearFechaGoogleDateTime(fecha: Date, hora: string): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}${mes}${dia}T${hora}`;
  }

  /**
   * Desconectar de Google Calendar
   */
  async signOutFromGoogle(): Promise<void> {
    try {
      await this.googleCalendarService.signOut();
      this.actualizarEstadoGoogleCalendar();
      this.inicializarCalendariosSidebarBase();
      this.actualizarIframeCalendario(new Date().getTime());
      Swal.fire({
        icon: 'success',
        title: 'Desconectado',
        text: 'Desconectado de Google Calendar',
        confirmButtonColor: '#38512F',
        timer: 2000
      });
    } catch (error) {
      this.actualizarEstadoGoogleCalendar();
      console.error('Error al desconectar:', error);
    }
  }

  /**
   * Limpiar y resincronizar todos los eventos
   */
  async limpiarYResincronizar(): Promise<void> {
    const result = await Swal.fire({
      title: '⚠️ ¿Limpiar y resincronizar?',
      html: 'Esto eliminará <strong>todos</strong> los eventos del calendario de cursos y los volverá a crear desde la base de datos.<br><br>Los eventos duplicados serán eliminados.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Sí, limpiar y resincronizar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) {
      return;
    }

    try {
      Swal.fire({
        title: 'Limpiando eventos...',
        html: 'Por favor espera, esto puede tomar unos momentos',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      // Eliminar todos los eventos con ID
      const eliminados = await this.googleCalendarService.deleteAllEventsWithId();

      // Limpiar el conjunto de sincronizados
      this.cursosSincronizadosIds.clear();
      this.yaSincronizado = false;

      // Resincronizar
      await this.sincronizarConGoogleCalendar();

      Swal.fire({
        icon: 'success',
        title: '¡Listo!',
        html: `${eliminados} eventos eliminados<br>${this.cursosProgramados.length} eventos resincronizados`,
        confirmButtonColor: '#38512F',
        timer: 2500
      });

      // Refrescar calendario
      setTimeout(() => this.refreshCalendar(), 500);

    } catch (error) {
      console.error('Error al limpiar y resincronizar:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Ocurrió un error al limpiar los eventos',
        confirmButtonColor: '#38512F'
      });
    }
  }

  /**
   * Elimina eventos duplicados del calendario
   */
  async eliminarDuplicados(): Promise<void> {
    if (!this.googleCalendarService.isAuthenticated()) {
      Swal.fire({
        icon: 'warning',
        title: 'No conectado',
        text: 'Debes conectarte a Google Calendar primero',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    const result = await Swal.fire({
      title: '¿Eliminar duplicados?',
      html: '<p>Se eliminarán los eventos duplicados del calendario, manteniendo solo el más reciente de cada curso.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#38512F',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar duplicados',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      Swal.fire({
        title: 'Eliminando duplicados...',
        text: 'Por favor espera',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const eliminados = await this.googleCalendarService.deleteDuplicateEvents();

      Swal.fire({
        icon: 'success',
        title: '¡Listo!',
        text: `${eliminados} eventos duplicados eliminados`,
        confirmButtonColor: '#38512F',
        timer: 2000
      });

      // Refrescar calendario
      setTimeout(() => this.refreshCalendar(), 500);

    } catch (error) {
      console.error('Error al eliminar duplicados:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Ocurrió un error al eliminar duplicados',
        confirmButtonColor: '#38512F'
      });
    }
  }

  /**
   * Método público para recargar cursos (llamado desde otros componentes)
   */
  recargarCursos(): void {
    // Solo recargar la lista, no sincronizar de nuevo
    this.isLoadingCursos = true;
    this.backendService.obtenerCursosProgramados().subscribe(
      (response: any) => {
        const cursosNuevos = response.cursosProgramados || response.data || response.cursos || response || [];
        
        // Buscar cursos nuevos (que no estaban antes)
        const cursosAgregar = cursosNuevos.filter((nuevo: any) => 
          !this.cursosProgramados.some(existente => existente.programado_id === nuevo.programado_id)
        );
        
        // Actualizar lista
        this.cursosProgramados = cursosNuevos;
        this.isLoadingCursos = false;
        
        // Sincronizar solo los nuevos si hay conexión
        if (cursosAgregar.length > 0 && this.googleCalendarService.isAuthenticated()) {
          this.sincronizarCursosNuevos(cursosAgregar);
        }
      },
      (error) => {
        console.error('❌ Error al recargar cursos:', error);
        this.isLoadingCursos = false;
      }
    );
  }

  /**
   * Sincronizar solo cursos nuevos
   */
  private async sincronizarCursosNuevos(cursosNuevos: any[]): Promise<void> {
    
    try {
      // Obtener eventos existentes para verificar
      const eventosExistentes = await this.googleCalendarService.getEvents();
      const idsExistentes = new Set<string>();
      eventosExistentes.forEach((evento: any) => {
        // Buscar en extendedProperties (nuevo formato) o en descripción (fallback)
        if (evento.extendedProperties?.private?.cursoId) {
          idsExistentes.add(evento.extendedProperties.private.cursoId);
        } else {
          const match = evento.description?.match(/(?:ID:\s*(\d+)|\[ID:(\d+)\])/);
          if (match) {
            const id = match[1] || match[2];
            if (id) {
              idsExistentes.add(id);
            }
          }
        }
      });
      
      for (const curso of cursosNuevos) {
        const cursoId = curso.programado_id?.toString();
        
        try {
          if (!cursoId) {
            continue;
          }
          
          // Verificar si ya existe
          if (idsExistentes.has(cursoId)) {
            continue;
          }
          
          if (!curso.fecha_inicio) {
            continue;
          }
          
          const fechaInicio = curso.fecha_inicio;
          const fechaFin = curso.fecha_fin || curso.fecha_inicio;
          let horaInicio = curso.hora_inicio || '09:00:00';
          let horaFin = curso.hora_fin || '17:00:00';
          
          // Limpiar formato de hora
          if (typeof horaInicio === 'string') {
            horaInicio = horaInicio.split('.')[0];
          }
          if (typeof horaFin === 'string') {
            horaFin = horaFin.split('.')[0];
          }
          
          const startDateTime = new Date(`${fechaInicio.split('T')[0]}T${horaInicio}`);
          const endDateTime = new Date(`${fechaFin.split('T')[0]}T${horaFin}`);
          
          // Validar que la fecha de fin sea posterior
          if (endDateTime <= startDateTime) {
            endDateTime.setTime(startDateTime.getTime() + (8 * 60 * 60 * 1000));
          }
          
          const cursoNombre = curso.nombre_curso || 'Curso sin nombre';
          const empresaNombre = curso.nombre_empresa || 'Empresa';
          const summary = `${cursoNombre} - ${empresaNombre}`;
          
          let instructorNombre = 'Sin asignar';
          if (curso.instructor_id) {
            const nombre = curso.instructor_nombre || curso.nombre_instructor || '';
            const apellidoP = curso.instructor_apellido_paterno || curso.apellido_paterno_instructor || '';
            const apellidoM = curso.instructor_apellido_materno || curso.apellido_materno_instructor || '';
            if (nombre || apellidoP) {
              instructorNombre = `${nombre} ${apellidoP} ${apellidoM}`.trim();
            }
          }
          
          
          await this.googleCalendarService.createEvent({
            summary: summary,
            description: `Curso: ${cursoNombre}\nEmpresa: ${empresaNombre}\nInstructor: ${instructorNombre}\nModalidad: ${curso.modalidad || 'Presencial'}\nEstatus: ${curso.estatus || 'Programado'}`,
            location: curso.ubicacion || '',
            startDateTime: startDateTime,
            endDateTime: endDateTime,
            attendees: [],
            cursoId: cursoId
          });

          this.cursosSincronizadosIds.add(cursoId);
          
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`⚠️ Error al sincronizar curso nuevo:`, error);
        }
      }
      
      // Refrescar calendario
      setTimeout(() => this.refreshCalendar(), 1000);
    } catch (error) {
      console.error('❌ Error sincronizando cursos nuevos:', error);
    }
  }

  /**
   * Cargar eventos del calendario de Google
   */
  async cargarEventosCalendario(): Promise<void> {
    if (!this.googleCalendarService.isAuthenticated()) {
      return;
    }

    try {
      const eventos = await this.googleCalendarService.getEvents();
      this.eventosCalendario = eventos.map((evento: any) => ({
        id: evento.id,
        titulo: evento.summary || 'Sin título',
        descripcion: evento.description || '',
        inicio: evento.start?.dateTime || evento.start?.date,
        fin: evento.end?.dateTime || evento.end?.date,
        ubicacion: evento.location || '',
        evento: evento
      }));
      this.eventosFiltrados = [...this.eventosCalendario];
    } catch (error) {
      console.error('❌ Error al cargar eventos:', error);
    }
  }

  /**
   * Filtrar eventos según la búsqueda y rol del usuario
   */
  filtrarEventos(): void {
    const busqueda = this.busquedaEvento.trim().toLowerCase();
    
    // Primero, filtrar según el rol: solo eventos de cursos programados del usuario
    let eventosPorRol = this.eventosCalendario;
    
    // Para admin e instructor: solo mostrar eventos que correspondan a sus cursos programados
    if (!this.esEmpresa) {
      // Obtener IDs de cursos programados del usuario
      const idsCursosProgramados = new Set(
        this.cursosProgramados.map(c => c.programado_id?.toString())
      );
      
      // Filtrar eventos que tienen cursoId en extendedProperties o en descripción
      eventosPorRol = this.eventosCalendario.filter(evento => {
        // Buscar cursoId en extendedProperties
        const cursoIdEvento = evento.evento?.extendedProperties?.private?.cursoId;
        if (cursoIdEvento && idsCursosProgramados.has(cursoIdEvento)) {
          return true;
        }
        
        // Fallback: buscar en descripción (formatos antiguos)
        const match = evento.descripcion?.match(/(?:ID:\s*(\d+)|\[ID:(\d+)\])/);
        if (match) {
          const id = match[1] || match[2];
          if (id && idsCursosProgramados.has(id)) {
            return true;
          }
        }
        
        return false;
      });
    }
    
    // Luego, aplicar filtro de búsqueda si existe
    if (!busqueda) {
      this.eventosFiltrados = [...eventosPorRol];
      return;
    }

    this.eventosFiltrados = eventosPorRol.filter(evento => 
      evento.titulo.toLowerCase().includes(busqueda) ||
      evento.descripcion.toLowerCase().includes(busqueda) ||
      evento.ubicacion.toLowerCase().includes(busqueda)
    );
  }

  /**
   * Seleccionar un evento
   */
  seleccionarEvento(evento: any): void {
    this.eventoSeleccionado = evento;
    this.busquedaEvento = '';
    this.listaEventosAbierta = false; // Cerrar la lista
  }

  /**
   * Abrir la lista de eventos
   */
  abrirListaEventos(): void {
    this.listaEventosAbierta = true;
    this.filtrarEventos();
  }

  /**
   * Cerrar la lista de eventos
   */
  cerrarListaEventos(): void {
    this.listaEventosAbierta = false;
  }

  /**
   * Verificar si el usuario actual es de tipo empresa
   */
  get esUsuarioEmpresa(): boolean {
    return this.esEmpresa;
  }

  /**
   * Enviar invitaciones al evento seleccionado
   */
  async enviarInvitaciones(): Promise<void> {
    if (!this.eventoSeleccionado) {
      Swal.fire({
        icon: 'warning',
        title: 'Selecciona un evento',
        text: 'Debes seleccionar un evento primero',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    if (!this.attendeesEmails.trim()) {
      Swal.fire({
        icon: 'warning',
        title: 'Ingresa correos',
        text: 'Debes ingresar al menos un correo electrónico',
        confirmButtonColor: '#38512F'
      });
      return;
    }

    try {
      const emails = this.attendeesEmails
        .split(',')
        .map(email => email.trim())
        .filter(email => email.length > 0);

      if (emails.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'Correos inválidos',
          text: 'No se encontraron correos válidos',
          confirmButtonColor: '#38512F'
        });
        return;
      }

      Swal.fire({
        title: 'Enviando invitaciones...',
        html: `Enviando a ${emails.length} ${emails.length === 1 ? 'persona' : 'personas'}`,
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      // Actualizar el evento con los asistentes
      const attendees = emails.map(email => ({ email }));
      await this.googleCalendarService.updateEventAttendees(
        this.eventoSeleccionado.id,
        attendees
      );

      Swal.fire({
        icon: 'success',
        title: '¡Invitaciones enviadas!',
        html: `Se enviaron invitaciones a:<br><strong>${emails.join('<br>')}</strong>`,
        confirmButtonColor: '#38512F'
      });

      // Limpiar campos
      this.attendeesEmails = '';
      this.eventoSeleccionado = null;
      this.busquedaEvento = '';
      
      // Recargar eventos
      await this.cargarEventosCalendario();

    } catch (error) {
      console.error('❌ Error al enviar invitaciones:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudieron enviar las invitaciones. Intenta de nuevo.',
        confirmButtonColor: '#38512F'
      });
    }
  }
}
