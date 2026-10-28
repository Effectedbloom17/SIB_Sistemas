/**
 * Mueve PDFs firmados de SGC-F-07 a Documentos Firmados.
 * Uso: node backend/scripts/mover-pdfs-firmados-sgc-f-07.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const driveService = require('../driveService');
const sgcF07 = require('../sgcF07Service');

(async () => {
    if (driveService.arranqueAuthPromise) {
        await driveService.arranqueAuthPromise;
    }
    await new Promise((r) => setTimeout(r, 1500));

    const destino = sgcF07.CARPETA_PDF_FIRMADO_DRIVE_ID;
    console.log('[SGC-F-07] Destino Documentos Firmados:', destino);
    const destInfo = await driveService.obtenerInfoArchivo(destino);
    console.log('[SGC-F-07] Carpeta:', destInfo?.name, destInfo?.id);

    const resultado = await sgcF07.moverPdfsFirmadosACarpetaCorrecta();
    console.log('[SGC-F-07] Resultado migración:', resultado);

    const enDestino = await driveService.listarArchivosCarpeta(destino);
    const pdfs = (enDestino || []).filter((f) => /\.pdf$/i.test(f.name || ''));
    console.log('[SGC-F-07] PDFs ahora en Documentos Firmados:', pdfs.map((f) => f.name));
    process.exit(0);
})().catch((err) => {
    console.error('[SGC-F-07] Error migrando PDFs:', err.message || err);
    process.exit(1);
});
