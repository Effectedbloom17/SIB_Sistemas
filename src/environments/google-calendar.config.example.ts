// Este es un archivo de configuración de EJEMPLO
// NO subas este archivo a Git con tus credenciales reales

export const environment = {
  production: false,
  googleCalendar: {
    // Obtén estas credenciales de: https://console.cloud.google.com/
    apiKey: 'TU_API_KEY_AQUI',
    clientId: 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com',
    calendarId: '994d340cde78c79e70dcf6a55e6aa382deeb9a9c6a2cb9bc6aba7f02a9c2550c@group.calendar.google.com'
  }
};

// Ejemplo con credenciales ficticias (formato):
// export const environment = {
//   production: false,
//   googleCalendar: {
//     apiKey: 'AIzaSyD1234567890abcdefghijklmn',
//     clientId: '123456789-abc123xyz.apps.googleusercontent.com',
//     calendarId: '994d340cde78c79e70dcf6a55e6aa382deeb9a9c6a2cb9bc6aba7f02a9c2550c@group.calendar.google.com'
//   }
// };
