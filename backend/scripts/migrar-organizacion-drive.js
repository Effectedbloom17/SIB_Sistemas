/**
 * Reorganiza carpetas en Drive:
 * - Plantillas (NO BORRAR) -> Capacitaciones/Documentación/
 * - Perfiles -> Firmas/Perfiles/
 * - Limpia _tmp_reporte_salud_* (conserva biz_logo.png en Documentos/)
 * - Mueve fotos sueltas (foto_*) de la raíz a Firmas/Perfiles/
 *
 * Uso: node backend/scripts/migrar-organizacion-drive.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const driveService = require('../driveService');

async function main() {
    console.log('[Drive] Iniciando reorganización general...');

    const migracionFirmas = await driveService.migrarCarpetasFirmasOrganizacion();
    console.log('[Drive] Firmas:', migracionFirmas.success ? 'OK' : migracionFirmas.error);

    const resultado = await driveService.migrarOrganizacionDriveGeneral();
    if (!resultado.success) {
        console.error('[Drive] Reorganización fallida');
        process.exitCode = 1;
        return;
    }

    const res = resultado.resultados || {};

    console.log('\n[Drive] Plantillas:', res.plantillas?.estado || 'N/A', res.plantillas?.folderId || '');
    console.log('[Drive] Cursos:', res.cursos?.estado || 'N/A', res.cursos?.folderId || '');
    console.log('[Drive] Control de Oficios:', res.control_oficios?.estado || 'N/A', res.control_oficios?.folderId || '');
    console.log('[Drive] Calidad (SGC):', res.calidad?.estado || 'N/A', res.calidad?.folderId || '');
    console.log('[Drive] Perfiles (Firmas/):', res.perfiles?.folderId || res.perfiles?.error || 'N/A');

    const tmp = res.tmp_reporte_salud?.resultados || [];
    console.log(`[Drive] Carpetas tmp reporte salud procesadas: ${tmp.length}`);
    for (const item of tmp) {
        console.log(`  - ${item.nombre}: ${item.estado}${item.bizLogo ? ` (${item.bizLogo})` : ''}${item.error ? ` -> ${item.error}` : ''}`);
    }

    const fotos = res.fotos_sueltas?.resultados || [];
    console.log(`[Drive] Fotos sueltas movidas desde raíz: ${res.fotos_sueltas?.fotos_movidas || 0}`);
    for (const item of fotos) {
        console.log(`  - ${item.nombre}: ${item.estado}`);
    }

    console.log('\n[Drive] Reorganización completada.');
}

main().catch((error) => {
    console.error('[Drive] Error fatal:', error.message);
    process.exitCode = 1;
});
