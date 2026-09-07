#!/usr/bin/env node
/**
 * Prepara backend/.env para desarrollo local.
 * - Si no existe: lo crea desde .env.example
 * - Si existe con JWT_SECRET inválido/placeholder: lo repara
 * - Actualiza DB_HOST_LAN si falta o es una IP de equipo obsoleta
 * No modifica .env.produccion ni afecta despliegues.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const envPath = path.join(backendDir, '.env');
const examplePath = path.join(backendDir, '.env.example');

const JWT_PLACEHOLDERS = new Set([
  'cambiaste_esto_en_produccion_con_un_valor_aleatorio_largo',
  'CAMBIA_ESTO_POR_UN_VALOR_ALEATORIO_LARGO',
  'un_string_aleatorio_de_minimo_32_caracteres'
]);

/** IP actual de la PC que corre Docker (host de MariaDB en LAN). */
const DB_HOST_LAN_DEFAULT = '192.168.1.167';
const DB_HOST_LAN_OBSOLETOS = new Set(['192.168.1.78', '192.168.1.174']);

function leerValor(content, key) {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? String(m[1]).trim() : '';
}

function jwtInvalido(secret) {
  return !secret || secret.length < 32 || JWT_PLACEHOLDERS.has(secret);
}

function generarJwt() {
  return crypto.randomBytes(48).toString('hex');
}

function asegurarLinea(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, `${key}=${value}`);
  }
  return `${content.trimEnd()}\n${key}=${value}\n`;
}

function asegurarDbHostLan(content) {
  const actual = leerValor(content, 'DB_HOST_LAN');
  if (!actual || DB_HOST_LAN_OBSOLETOS.has(actual)) {
    return { content: asegurarLinea(content, 'DB_HOST_LAN', DB_HOST_LAN_DEFAULT), changed: true };
  }
  return { content, changed: false };
}

function aplicarDefaultsDev(content, jwtSecret) {
  let out = content;
  out = asegurarLinea(out, 'JWT_SECRET', jwtSecret);
  out = asegurarLinea(out, 'DB_USER', 'root');
  out = asegurarLinea(out, 'DB_PASS', 'root');
  out = asegurarLinea(out, 'DB_PORT', '3306');
  out = asegurarLinea(out, 'NODE_ENV', 'development');
  out = asegurarLinea(out, 'PORT', '3100');
  out = asegurarLinea(out, 'PUBLIC_API_URL', 'http://localhost:3100');

  if (!/^DB_HOST_LOCAL=/m.test(out)) {
    out = asegurarLinea(out, 'DB_HOST_LOCAL', '127.0.0.1');
  }
  out = asegurarDbHostLan(out).content;
  return out;
}

if (!fs.existsSync(examplePath)) {
  console.error('No se encontró backend/.env.example');
  process.exit(1);
}

const quiet = process.argv.includes('--quiet');
const log = (...args) => {
  if (!quiet) console.log(...args);
};

if (!fs.existsSync(envPath)) {
  const jwtSecret = generarJwt();
  let content = fs.readFileSync(examplePath, 'utf8');
  content = aplicarDefaultsDev(content, jwtSecret);

  if (!/^# Generado para desarrollo local/m.test(content)) {
    content =
      '# Generado para desarrollo local con: npm run setup:dev\n' +
      '# Producción usa backend/.env.produccion (deploy.ps1)\n\n' +
      content;
  }

  fs.writeFileSync(envPath, content, 'utf8');
  log('✓ Creado backend/.env para desarrollo local');
  log('  JWT_SECRET generado automáticamente');
  log(`  DB LAN: ${DB_HOST_LAN_DEFAULT}`);
  log('');
  log('Si no tienes Docker en esta PC, confirma DB_HOST_LAN en backend/.env');
  log('Luego: npm start');
  process.exit(0);
}

let existing = fs.readFileSync(envPath, 'utf8');
const jwtActual = leerValor(existing, 'JWT_SECRET');
let changed = false;
const avisos = [];

if (jwtInvalido(jwtActual)) {
  existing = asegurarLinea(existing, 'JWT_SECRET', generarJwt());
  changed = true;
  avisos.push('JWT_SECRET reparado');
}

const lan = asegurarDbHostLan(existing);
existing = lan.content;
if (lan.changed) {
  changed = true;
  avisos.push(`DB_HOST_LAN → ${DB_HOST_LAN_DEFAULT}`);
}

if (changed) {
  fs.writeFileSync(envPath, existing, 'utf8');
  log(`✓ Actualizado backend/.env (${avisos.join(', ')})`);
} else {
  log('backend/.env listo para desarrollo.');
}
process.exit(0);
