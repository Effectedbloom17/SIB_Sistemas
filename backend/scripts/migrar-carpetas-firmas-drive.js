/**
 * Migra las carpetas de firmas a Drive/Firmas/
 * Uso: node backend/scripts/migrar-carpetas-firmas-drive.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const driveService = require('../driveService');

async function main() {
    console.log('[Drive] Iniciando migración de carpetas de firmas...');
    const resultado = await driveService.migrarCarpetasFirmasOrganizacion();

    if (!resultado.success) {
        console.error('[Drive] Migración fallida:', resultado.error || 'error desconocido');
        process.exitCode = 1;
        return;
    }

    console.log('[Drive] Carpeta raíz Firmas:', resultado.carpeta_firmas_id);
    for (const item of resultado.resultados || []) {
        console.log(`  - ${item.nombre}: ${item.estado}${item.folderId ? ` (${item.folderId})` : ''}${item.error ? ` -> ${item.error}` : ''}`);
    }
    console.log('[Drive] Migración completada.');
}

main().catch((error) => {
    console.error('[Drive] Error fatal:', error.message);
    process.exitCode = 1;
});
