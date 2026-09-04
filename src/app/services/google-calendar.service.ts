import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

declare var gapi: any;

@Injectable({
  providedIn: 'root'
})
export class GoogleCalendarService {
  private CLIENT_ID = environment.googleCalendar.clientId;
  private API_KEY = environment.googleCalendar.apiKey;
  private DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'];
  private SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid',
    'profile'
  ].join(' ');
  private readonly TARGET_CALENDAR_ID = 'risktechbiznaga@gmail.com';
  private readonly CALENDAR_ID = this.TARGET_CALENDAR_ID;

  private gapiInitialized = false;
  private isSignedIn = false;
  private tokenClient: any = null;
  private currentAccountEmail: string | null = null;

  private readonly GOOGLE_ACCOUNT_EMAIL_KEY = 'google_calendar_account_email';

  constructor() {
    this.autoSignIn();
  }

  /**
   * Intenta autenticarse automáticamente si hay un token guardado
   */
  async autoSignIn(): Promise<void> {
    const savedToken = localStorage.getItem('google_calendar_token');
    if (savedToken) {
      try {
        const tokenData = JSON.parse(savedToken);
        
        // Verificar si el token no ha expirado
        if (tokenData.expiry && new Date().getTime() < tokenData.expiry) {
          // Esperar a que gapi esté disponible
          await this.waitForGapi();
          await this.initClient();
          
          // Restaurar el token
          gapi.client.setToken(tokenData);
          this.isSignedIn = true;
          this.currentAccountEmail = localStorage.getItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);

          if (!this.currentAccountEmail) {
            await this.cargarInfoCuentaGoogle(tokenData.access_token);
          }

          await this.validarAccesoCalendarioObjetivo();
        } else {
          // Token expirado, limpiar
          localStorage.removeItem('google_calendar_token');
          localStorage.removeItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
          this.currentAccountEmail = null;
        }
      } catch (error) {
        localStorage.removeItem('google_calendar_token');
        localStorage.removeItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
        this.currentAccountEmail = null;
      }
    }
  }

  /**
   * Espera a que GAPI esté disponible
   */
  private waitForGapi(): Promise<void> {
    return new Promise((resolve, reject) => {
      let intentos = 0;
      const MAX_INTENTOS = 100; // 100 * 100ms = 10 segundos
      const checkGapi = () => {
        if (typeof gapi !== 'undefined' && typeof (window as any).google !== 'undefined') {
          resolve();
        } else if (intentos >= MAX_INTENTOS) {
          reject(new Error('Google Calendar no se pudo cargar. Verifica tu conexión a internet.'));
        } else {
          intentos++;
          setTimeout(checkGapi, 100);
        }
      };
      checkGapi();
    });
  }

  /**
   * Inicializa la API de Google Calendar
   */
  async initClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof gapi === 'undefined') {
        reject('GAPI no disponible');
        return;
      }

      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            apiKey: this.API_KEY,
            discoveryDocs: this.DISCOVERY_DOCS
          });

          this.gapiInitialized = true;
          resolve();
        } catch (error) {
          console.error('Error al inicializar GAPI:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Inicia sesión con Google usando OAuth2
   * Usa prompt: '' para reutilizar la sesión existente cuando sea posible,
   * evitando conflictos con tokens de otras APIs del mismo CLIENT_ID.
   */
  async signIn(): Promise<void> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    return new Promise((resolve, reject) => {
      if (!this.tokenClient) {
        this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: this.SCOPES,
          callback: async (response: any) => {
            if (response.error) {
              console.error('Error de autenticación:', response);
              reject(response);
            } else {
              try {
                this.isSignedIn = true;

                // Guardar token en localStorage con tiempo de expiración
                const tokenData = {
                  ...response,
                  expiry: new Date().getTime() + (response.expires_in * 1000)
                };
                localStorage.setItem('google_calendar_token', JSON.stringify(tokenData));

                await this.cargarInfoCuentaGoogle(response.access_token);
                await this.validarAccesoCalendarioObjetivo();

                resolve();
              } catch (error) {
                reject(error);
              }
            }
          },
          // Configuración para evitar problemas de COOP
          ux_mode: 'popup',
          prompt: ''
        });
      }

      // No forzar select_account: usar consent solo si no hay sesión previa,
      // para evitar que Google revoque tokens existentes del mismo client_id
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * Cierra sesión
   * IMPORTANTE: NO se hace revoke() del token porque el mismo CLIENT_ID se usa
   * en el backend para Google Drive. Revocar aquí invalida el refresh token del
   * backend y rompe Drive, Slides, etc. Solo limpiamos la sesión local.
   */
  signOut(): void {
    try {
      if (typeof gapi !== 'undefined' && gapi.client) {
        gapi.client.setToken(null);
      }
    } catch (e) {
      // Ignorar si gapi no está listo
    }

    this.isSignedIn = false;
    this.currentAccountEmail = null;
    localStorage.removeItem('google_calendar_token');
    localStorage.removeItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
  }

  /**
   * Verifica si el usuario está autenticado
   */
  isAuthenticated(): boolean {
    // Verificar flag en memoria
    if (this.isSignedIn) return true;
    
    // Fallback: verificar si hay token válido en localStorage
    const savedToken = localStorage.getItem('google_calendar_token');
    if (savedToken) {
      try {
        const tokenData = JSON.parse(savedToken);
        if (tokenData.expiry && new Date().getTime() < tokenData.expiry) {
          return true;
        }
      } catch (e) {
        // Token corrupto
      }
    }
    return false;
  }

  /**
   * Devuelve el correo de la cuenta de Google conectada (si existe)
   */
  getAuthenticatedAccountEmail(): string | null {
    if (this.currentAccountEmail) {
      return this.currentAccountEmail;
    }

    const emailGuardado = localStorage.getItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
    if (emailGuardado) {
      this.currentAccountEmail = emailGuardado;
      return emailGuardado;
    }

    return null;
  }

  getTargetCalendarId(): string {
    return this.TARGET_CALENDAR_ID;
  }

  getCalendarEmbedUrl(options?: number | {
    refreshToken?: number;
    calendarIds?: string[];
    focusDate?: Date | null;
  }): string {
    const config = typeof options === 'number' ? { refreshToken: options } : (options || {});
    const calendarIdsRaw = Array.isArray(config.calendarIds) ? config.calendarIds : [];

    const calendarIds = [
      this.TARGET_CALENDAR_ID,
      ...calendarIdsRaw
    ].filter((id, index, arr) => !!id && arr.indexOf(id) === index);

    const params = new URLSearchParams();
    params.set('ctz', 'America/Mexico_City');
    params.set('mode', 'MONTH');
    params.set('showTitle', '0');
    params.set('showPrint', '0');
    params.set('showTabs', '1');
    params.set('showCalendars', '0');
    params.set('showNav', '1');

    calendarIds.forEach((calendarId) => {
      params.append('src', calendarId);
    });

    if (config.focusDate instanceof Date && !isNaN(config.focusDate.getTime())) {
      const yyyymmdd = this.formatearFechaYYYYMMDD(config.focusDate);
      params.set('dates', `${yyyymmdd}/${yyyymmdd}`);
    }

    if (config.refreshToken) {
      params.set('refresh', String(config.refreshToken));
    }

    return `https://calendar.google.com/calendar/embed?${params.toString()}`;
  }

  async getCalendarList(): Promise<any[]> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    const calendars: any[] = [];
    let pageToken: string | undefined = undefined;

    try {
      do {
        const response = await gapi.client.calendar.calendarList.list({
          showHidden: false,
          maxResults: 250,
          pageToken: pageToken
        });

        const items = response?.result?.items || [];
        calendars.push(...items);
        pageToken = response?.result?.nextPageToken;
      } while (pageToken);

      return calendars;
    } catch (error) {
      console.error('Error al obtener calendarios del usuario:', error);
      throw error;
    }
  }

  private formatearFechaYYYYMMDD(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}${mes}${dia}`;
  }

  private async cargarInfoCuentaGoogle(accessToken: string): Promise<void> {
    if (!accessToken) {
      return;
    }

    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        await this.cargarEmailDesdeCalendarioPrimario();
        return;
      }

      const userInfo = await response.json();
      const email = this.extraerEmailValido(userInfo?.email);

      if (email) {
        this.currentAccountEmail = email;
        localStorage.setItem(this.GOOGLE_ACCOUNT_EMAIL_KEY, email);
        return;
      }

      await this.cargarEmailDesdeCalendarioPrimario();
    } catch (error) {
      await this.cargarEmailDesdeCalendarioPrimario();
    }
  }

  private async cargarEmailDesdeCalendarioPrimario(): Promise<void> {
    try {
      if (!this.gapiInitialized) {
        await this.initClient();
      }

      const response = await gapi.client.calendar.calendars.get({
        calendarId: 'primary'
      });

      const calendarId = response?.result?.id;
      const email = this.extraerEmailValido(calendarId);

      if (email) {
        this.currentAccountEmail = email;
        localStorage.setItem(this.GOOGLE_ACCOUNT_EMAIL_KEY, email);
      }
    } catch (error) {
    }
  }

  private extraerEmailValido(value: any): string | null {
    if (!value || typeof value !== 'string') {
      return null;
    }

    const normalizado = value.trim().toLowerCase();
    if (!normalizado) {
      return null;
    }

    return normalizado.includes('@') ? normalizado : null;
  }

  private async validarAccesoCalendarioObjetivo(): Promise<void> {
    try {
      await gapi.client.calendar.calendars.get({
        calendarId: this.CALENDAR_ID
      });
    } catch (error: any) {
      const status = Number(error?.status || error?.result?.error?.code || 0);

      if (status === 403 || status === 404) {
        this.signOut();
        throw new Error(`La cuenta conectada no tiene acceso al calendario ${this.TARGET_CALENDAR_ID}. Inicia sesión con esa cuenta o comparte el calendario con permisos de edición.`);
      }

      throw new Error('No se pudo validar el acceso al calendario de Biznaga. Intenta nuevamente.');
    }
  }

  /**
   * Asegura que haya un token válido antes de hacer operaciones
   */
  private async ensureValidToken(): Promise<void> {
    const savedToken = localStorage.getItem('google_calendar_token');
    
    if (!savedToken) {
      throw new Error('No hay sesión de Google Calendar. Por favor conecta en la sección Calendario.');
    }

    try {
      const tokenData = JSON.parse(savedToken);
      
      // Solo renovar si ya expiró (no proactivamente)
      if (tokenData.expiry && new Date().getTime() >= tokenData.expiry) {
        this.currentAccountEmail = null;
        localStorage.removeItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
        throw new Error('Sesión expirada. Reconecta Google Calendar.');
      } else if (!this.isSignedIn) {
        // Token válido pero no está marcado como autenticado, restaurar
        if (!this.gapiInitialized) {
          await this.initClient();
        }
        gapi.client.setToken(tokenData);
        this.isSignedIn = true;
        this.currentAccountEmail = localStorage.getItem(this.GOOGLE_ACCOUNT_EMAIL_KEY);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtiene eventos del calendario
   */
  async getEvents(timeMin?: Date, timeMax?: Date): Promise<any[]> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      // Si no se especifica, buscar TODOS los eventos (sin límite de tiempo)
      const defaultTimeMin = timeMin || new Date('2020-01-01');
      const defaultTimeMax = timeMax || new Date('2030-12-31');
      
      let allEvents: any[] = [];
      let pageToken: string | undefined = undefined;
      
      // Paginación: Obtener TODOS los eventos, no solo los primeros 2500
      do {
        const response = await gapi.client.calendar.events.list({
          calendarId: this.CALENDAR_ID,
          timeMin: defaultTimeMin.toISOString(),
          timeMax: defaultTimeMax.toISOString(),
          showDeleted: false,
          singleEvents: true,
          maxResults: 2500, // Máximo permitido por página
          orderBy: 'startTime',
          pageToken: pageToken
        });

        const items = response.result.items || [];
        allEvents = allEvents.concat(items);
        pageToken = response.result.nextPageToken;
        
        if (pageToken) {
        }
      } while (pageToken);
      
      return allEvents;
    } catch (error) {
      console.error('Error al obtener eventos:', error);
      throw error;
    }
  }

  /**
   * Crea un evento en el calendario
   */
  async createEvent(eventData: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: Date;
    endDateTime: Date;
    attendees?: string[]; // Arreglo de correos electrónicos
    cursoId?: string; // ID del curso para metadata
    sendInvitations?: boolean; // Si es true, envía invitaciones por email a los attendees
  }): Promise<any> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    // Verificar token antes de crear evento
    await this.ensureValidToken();

    const event: any = {
      summary: eventData.summary,
      description: eventData.description || '',
      location: eventData.location || '',
      start: {
        dateTime: eventData.startDateTime.toISOString(),
        timeZone: 'America/Mexico_City'
      },
      end: {
        dateTime: eventData.endDateTime.toISOString(),
        timeZone: 'America/Mexico_City'
      }
    };

    // Agregar asistentes si se proporcionan
    if (eventData.attendees && eventData.attendees.length > 0) {
      event.attendees = eventData.attendees.map(email => ({ email: email }));
    }

    // Guardar el ID del curso en propiedades extendidas (invisible para el usuario)
    if (eventData.cursoId) {
      event.extendedProperties = {
        private: {
          cursoId: eventData.cursoId
        }
      };
    }

    try {
      // Intentar enviar invitaciones si se solicita
      const wantsSendAll = (eventData.sendInvitations && eventData.attendees && eventData.attendees.length > 0);
      
      let response;
      
      if (wantsSendAll) {
        try {
          // Primer intento: crear evento CON envío de invitaciones
          response = await gapi.client.calendar.events.insert({
            calendarId: this.CALENDAR_ID,
            resource: event,
            sendUpdates: 'all'
          });
        } catch (sendError: any) {
          // Si falla el envío de invitaciones, reintentar SIN envío (solo crear evento)
          response = await gapi.client.calendar.events.insert({
            calendarId: this.CALENDAR_ID,
            resource: event,
            sendUpdates: 'none'
          });
        }
      } else {
        // Sin invitaciones solicitadas
        response = await gapi.client.calendar.events.insert({
          calendarId: this.CALENDAR_ID,
          resource: event,
          sendUpdates: 'none'
        });
      }

      return response.result;
    } catch (error: any) {
      console.error('❌ Error al crear evento:', error);
      console.error('   Detalles del evento que falló:', {
        summary: event.summary,
        start: event.start,
        end: event.end,
        location: event.location
      });
      
      // Mostrar mensaje de error específico de la API
      if (error.result && error.result.error) {
        console.error('   Mensaje de Google:', error.result.error.message);
      }
      
      throw error;
    }
  }

  /**
   * Actualiza un evento existente
   */
  async updateEvent(eventId: string, eventData: any): Promise<any> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      const response = await gapi.client.calendar.events.update({
        calendarId: this.CALENDAR_ID,
        eventId: eventId,
        resource: eventData,
        sendUpdates: 'all' // Enviar notificaciones a todos los asistentes
      });

      return response.result;
    } catch (error) {
      console.error('Error al actualizar evento:', error);
      throw error;
    }
  }

  /**
   * Actualiza los asistentes de un evento
   */
  async updateEventAttendees(eventId: string, attendees: Array<{ email: string }>): Promise<any> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      // Primero obtener el evento actual
      const eventResponse = await gapi.client.calendar.events.get({
        calendarId: this.CALENDAR_ID,
        eventId: eventId
      });

      const event = eventResponse.result;

      // Agregar los nuevos asistentes a los existentes (evitar duplicados)
      const existingAttendees = event.attendees || [];
      const existingEmails = new Set(existingAttendees.map((a: any) => a.email));
      
      const newAttendees = attendees.filter(a => !existingEmails.has(a.email));
      const allAttendees = [...existingAttendees, ...newAttendees];

      // Actualizar el evento con los nuevos asistentes
      const response = await gapi.client.calendar.events.patch({
        calendarId: this.CALENDAR_ID,
        eventId: eventId,
        resource: {
          attendees: allAttendees
        },
        sendUpdates: 'all' // Enviar invitaciones por correo
      });

      return response.result;
    } catch (error) {
      console.error('Error al actualizar asistentes:', error);
      throw error;
    }
  }

  /**
   * Elimina un evento
   */
  async deleteEvent(eventId: string): Promise<void> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      await gapi.client.calendar.events.delete({
        calendarId: this.CALENDAR_ID,
        eventId: eventId
      });
    } catch (error) {
      console.error('Error al eliminar evento:', error);
      throw error;
    }
  }

  /**
   * Elimina los eventos de Google Calendar asociados a un curso programado específico
   */
  async deleteEventsByCursoId(cursoId: number | string): Promise<number> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      const eventos = await this.getEvents();
      const idStr = cursoId.toString();
      let eliminados = 0;

      for (const evento of eventos) {
        const eventCursoId = evento.extendedProperties?.private?.cursoId;
        if (eventCursoId === idStr) {
          try {
            await this.deleteEvent(evento.id);
            eliminados++;
          } catch (error) {
            console.error(`Error al eliminar evento ${evento.id}:`, error);
          }
        }
      }

      return eliminados;
    } catch (error) {
      console.error('Error al eliminar eventos por cursoId:', error);
      throw error;
    }
  }

  /**
   * Elimina todos los eventos que contengan un ID en la descripción
   */
  async deleteAllEventsWithId(): Promise<number> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      const eventos = await this.getEvents();
      const promesasEliminacion: Promise<void>[] = [];
      let eliminados = 0;

      for (const evento of eventos) {
        // Eliminar eventos que tengan cursoId en extendedProperties o ID en descripción
        const tieneCursoId = evento.extendedProperties?.private?.cursoId;
        const tieneIdEnDescripcion = evento.description && evento.description.match(/(?:ID:\s*\d+|\[ID:\d+\])/);
        
        if (tieneCursoId || tieneIdEnDescripcion) {
          const promesa = this.deleteEvent(evento.id)
            .then(() => {
              eliminados++;
            })
            .catch((error) => {
              console.error(`Error al eliminar evento ${evento.id}:`, error);
            });
          promesasEliminacion.push(promesa);
        }
      }

      // Esperar a que todas las eliminaciones terminen
      await Promise.all(promesasEliminacion);

      return eliminados;
    } catch (error) {
      console.error('Error al eliminar eventos:', error);
      throw error;
    }
  }

  /**
   * Elimina eventos duplicados basándose en el cursoId
   * Mantiene solo el evento más reciente de cada curso
   */
  async deleteDuplicateEvents(): Promise<number> {
    if (!this.gapiInitialized) {
      await this.initClient();
    }

    await this.ensureValidToken();

    try {
      const eventos = await this.getEvents();
      const eventosPorCursoId = new Map<string, any[]>();
      
      // Agrupar eventos por cursoId
      for (const evento of eventos) {
        const cursoId = evento.extendedProperties?.private?.cursoId;
        if (cursoId) {
          if (!eventosPorCursoId.has(cursoId)) {
            eventosPorCursoId.set(cursoId, []);
          }
          eventosPorCursoId.get(cursoId)!.push(evento);
        }
      }

      let eliminados = 0;
      const promesasEliminacion: Promise<void>[] = [];

      // Para cada grupo de duplicados, mantener solo el más reciente
      for (const eventosGrupo of eventosPorCursoId.values()) {
        if (eventosGrupo.length > 1) {
          // Ordenar por fecha de creación (más reciente primero)
          eventosGrupo.sort((a, b) => {
            const fechaA = new Date(a.created || a.updated).getTime();
            const fechaB = new Date(b.created || b.updated).getTime();
            return fechaB - fechaA;
          });

          // Eliminar todos excepto el primero (más reciente) - en paralelo
          for (let i = 1; i < eventosGrupo.length; i++) {
            const promesa = this.deleteEvent(eventosGrupo[i].id)
              .then(() => {
                eliminados++;
              })
              .catch((error) => {
                console.error(`Error al eliminar duplicado ${eventosGrupo[i].id}:`, error);
              });
            promesasEliminacion.push(promesa);
          }
        }
      }

      // Esperar a que todas las eliminaciones terminen
      await Promise.all(promesasEliminacion);

      return eliminados;
    } catch (error) {
      console.error('Error al eliminar duplicados:', error);
      throw error;
    }
  }
}
