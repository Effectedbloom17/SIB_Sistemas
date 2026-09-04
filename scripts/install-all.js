#!/usr/bin/env node
/**
 * Instala dependencias de raíz + backend (mysql2, express, etc.).
 * Necesario en clones nuevos (SIB_Sistemas / residentes).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const backend = path.join(root, 'backend');

function run(cwd, args, label) {
  console.log(`\n>>> ${label}`);
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      npm_config_allow_remote: 'all'
    }
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(path.join(root, 'package.json'))) {
  console.error('No se encontró package.json en la raíz del proyecto.');
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  run(root, ['install', '--allow-remote=all'], 'Instalando dependencias del frontend (raíz)');
} else {
  console.log('node_modules (raíz) ya existe.');
}

if (!fs.existsSync(path.join(backend, 'package.json'))) {
  console.error('No se encontró backend/package.json');
  process.exit(1);
}

run(backend, ['install', '--allow-remote=all'], 'Instalando dependencias del backend (mysql2, express, ...)');

const setupEnv = path.join(__dirname, 'setup-dev-env.js');
if (fs.existsSync(setupEnv) && !fs.existsSync(path.join(backend, '.env'))) {
  run(root, ['run', 'setup:dev'], 'Creando backend/.env de desarrollo');
}

console.log('\nListo. Puedes ejecutar: npm start');
console.log('Si el puerto 4200 está ocupado, cierra el otro npm start o usa otro puerto.');
