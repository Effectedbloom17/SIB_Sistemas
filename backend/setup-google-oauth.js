require('dotenv').config({ path: __dirname + '/.env', quiet: true });
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n[ERROR] Faltan GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET en backend/.env');
  console.error('  Copia los valores de backend/.env.example o INFRAESTRUCTURA-PRODUCCION.md');
  console.error('  Luego vuelve a ejecutar: node backend/setup-google-oauth.js\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/spreadsheets',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: true,
  scope: SCOPES,
});

console.log('\n=== Google OAuth2 Setup ===\n');
console.log('1. Abre esta URL en tu navegador:\n');
console.log(authUrl);
console.log('\nScopes solicitados:');
SCOPES.forEach((scope) => console.log(` - ${scope}`));
console.log('\n2. Autoriza la aplicación con la cuenta de Google correcta');
console.log('3. Serás redirigido a localhost:3001/callback\n');

/**
 * Actualiza GOOGLE_REFRESH_TOKEN en los archivos .env
 */
function actualizarEnvFiles(refreshToken) {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '.env.produccion')
  ];
  const line = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;
  let actualizados = 0;

  for (const envPath of envPaths) {
    try {
      if (!fs.existsSync(envPath)) continue;
      let contenido = fs.readFileSync(envPath, 'utf-8');

      if (/^#\s*GOOGLE_REFRESH_TOKEN=.*$/m.test(contenido)) {
        contenido = contenido.replace(/^#\s*GOOGLE_REFRESH_TOKEN=.*$/m, line);
      } else if (/^GOOGLE_REFRESH_TOKEN=.*$/m.test(contenido)) {
        contenido = contenido.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line);
      } else {
        contenido = `${contenido.trimEnd()}\n${line}\n`;
      }

      fs.writeFileSync(envPath, contenido, 'utf-8');
      console.log(`✅ ${path.basename(envPath)} actualizado automáticamente`);
      actualizados++;
    } catch (err) {
      console.warn(`⚠️ No se pudo actualizar ${path.basename(envPath)}: ${err.message}`);
    }
  }

  return actualizados;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/callback' && parsed.query.code) {
    try {
      const { tokens } = await oauth2Client.getToken(parsed.query.code);
      console.log('\n✅ Token obtenido exitosamente!\n');
      console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);

      // Actualizar automáticamente los archivos .env
      if (tokens.refresh_token) {
        const n = actualizarEnvFiles(tokens.refresh_token);
        if (n > 0) {
          console.log('\n👆 Token guardado en .env. Reinicia el backend.\n');
        } else {
          console.warn('\n⚠️ No se encontró backend/.env. Agrega manualmente:');
          console.warn(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        }
      } else {
        console.warn('⚠️ No se recibió refresh_token. Revoca el acceso de la app en Google y vuelve a ejecutar este script.');
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>✅ Token obtenido y .env actualizado!</h1><p>Reinicia el backend y cierra esta ventana.</p>');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('Error obteniendo token:', err.message);
      res.writeHead(500);
      res.end('Error: ' + err.message);
    }
  }
});

server.listen(3001, () => {
  console.log('Servidor esperando callback en http://localhost:3001/callback ...\n');
});
