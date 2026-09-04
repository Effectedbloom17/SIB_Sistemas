// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  apiUrl: 'http://localhost:3100/api',
  /** Origen del backend para Socket.io (sin /api) */
  socketUrl: 'http://localhost:3100',
  googleCalendar: {
    apiKey: 'AIzaSyBsib_nFWP0lt4vjULaqjVYPo86PK55qSs',
    clientId: '345036206137-k0um2d51ei5n0jgqg8m59q0alp12hh6i.apps.googleusercontent.com',
    calendarId: 'risktechbiznaga@gmail.com'
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
