/**
 * Publica el borrador de notas-version.json al historial con la versión indicada.
 * Uso: node scripts/publicarNotasVersion.js [version]
 */
const path = require('path');

const versionArg = String(process.argv[2] || '').trim();

function resolveVersion() {
    if (versionArg) return versionArg;
    try {
        return require('../../package.json').version;
    } catch (_) {
        try {
            return require('../app-version.json').version;
        } catch (__) {
            console.error('No se pudo resolver la version (pase [version] o empaquete app-version.json).');
            process.exit(1);
        }
    }
}

const notasVersionService = require('../notasVersionService');
const version = resolveVersion();

try {
    const resultado = notasVersionService.publicar(version);
    if (resultado.publicados > 0) {
        console.log(`[NOTAS-VERSION] Publicadas ${resultado.publicados} nota(s) -> v${resultado.version}`);
    } else {
        console.log(`[NOTAS-VERSION] Sin notas en borrador para v${resultado.version}`);
    }
} catch (error) {
    console.error('[NOTAS-VERSION] Error:', error.message || error);
    process.exit(1);
}
