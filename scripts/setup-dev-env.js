#!/usr/bin/env node
/**
 * Crea backend/.env para desarrollo local si no existe.
 * No modifica .env.produccion ni afecta despliegues.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const envPath = path.join(backendDir, '.env');
const examplePath = path.join(backendDir, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('backend/.env ya existe — no se modificó.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('No se encontró backend/.env.example');
  process.exit(1);
}

const jwtSecret = crypto.randomBytes(48).toString('hex');
let content = fs.readFileSync(examplePath, 'utf8');

content = content.replace(/^JWT_SECRET=.+$/m, `JWT_SECRET=${jwtSecret}`);
content = content.replace(/^DB_USER=.+$/m, 'DB_USER=root');
content = content.replace(/^DB_PASS=.+$/m, 'DB_PASS=root');
content = content.replace(/^DB_PORT=.+$/m, 'DB_PORT=3306');
content = content.replace(/^NODE_ENV=.+$/m, 'NODE_ENV=development');
content = content.replace(/^PORT=.+$/m, 'PORT=3100');
content = content.replace(/^PUBLIC_API_URL=.+$/m, 'PUBLIC_API_URL=http://localhost:3100');

if (!/^# Generado para desarrollo local/m.test(content)) {
  content =
    '# Generado para desarrollo local con: npm run setup:dev\n' +
    '# Producción usa backend/.env.produccion (deploy.ps1)\n\n' +
    content;
}

fs.writeFileSync(envPath, content, 'utf8');
console.log('✓ Creado backend/.env para desarrollo local');
console.log('  JWT_SECRET generado automáticamente');
console.log('  DB: root@127.0.0.1:3306 (docker compose)');
console.log('');
console.log('Siguiente paso: docker compose up -d  (si MariaDB no está corriendo)');
console.log('Luego: npm start');
