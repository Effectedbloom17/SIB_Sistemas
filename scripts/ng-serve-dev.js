#!/usr/bin/env node
/**
 * Arranca ng serve en 4200 sin preguntar si el puerto está ocupado
 * y sin pasar por npx (evita avisos npm y DEP0190).
 */
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.NG_SERVE_PORT || 4200);
const HOST = process.env.NG_SERVE_HOST || 'localhost';
const ROOT = path.join(__dirname, '..');
const NG_JS = path.join(ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

function puertoOcupado(port, host) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
            server.close(() => resolve(false));
        });
        server.listen(port, host);
    });
}

(async () => {
    if (await puertoOcupado(PORT, HOST)) {
        console.error(`El puerto ${PORT} ya está en uso. Cierra el ng serve anterior e inténtalo de nuevo.`);
        process.exit(1);
    }

    const child = spawn(process.execPath, [NG_JS, 'serve', '--host', HOST, '--port', String(PORT)], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: false,
        env: process.env
    });
    child.on('exit', (code) => process.exit(code == null ? 1 : code));
})();
