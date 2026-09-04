#!/usr/bin/env node
/**
 * postinstall: asegura dependencias del backend (mysql2, etc.).
 * Se salta si ya están instaladas, salvo que FORCE_BACKEND_INSTALL=1.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backend = path.join(__dirname, '..', 'backend');
const marker = path.join(backend, 'node_modules', 'mysql2');
const force = String(process.env.FORCE_BACKEND_INSTALL || '') === '1';

if (!fs.existsSync(path.join(backend, 'package.json'))) {
  console.warn('[postinstall] No hay backend/package.json; se omite.');
  process.exit(0);
}

if (!force && fs.existsSync(marker)) {
  process.exit(0);
}

console.log('[postinstall] Instalando dependencias del backend...');
const result = spawnSync('npm', ['install', '--allow-remote=all'], {
  cwd: backend,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    npm_config_allow_remote: 'all'
  }
});

process.exit(result.status || 0);
