/**
 * SGC-F-09 · Lista de verificación de auditoría — export PDF desde plantilla Drive.
 * Carta, horizontal, escala predeterminada, márgenes predeterminados.
 */
const driveService = require('./driveService');

const CODIGO_FORMATO = 'SGC-F-09';
const TEMPLATE_DRIVE_ID = '1QP_CEWuDTRJbZiOth-JLxQvw713mSxbp';
const NOMBRE_PDF_ARCHIVO = 'SGC-F-09 Lista de verificacion de auditoria.pdf';

/** Carta, horizontal, escala predeterminada, márgenes predeterminados */
const OPCIONES_PDF_IMPRESION = {
    landscape: true,
    size: 'letter',
    scale: 'predeterminada',
    margins: 'predeterminados'
};

async function resolverDriveFileId() {
    const id = String(TEMPLATE_DRIVE_ID || '').trim();
    if (!id) {
        throw new Error('No hay plantilla SGC-F-09 configurada en Drive.');
    }
    return id;
}

async function descargarPlantillaPdf() {
    const driveFileId = await resolverDriveFileId();
    const pdfBuffer = await driveService.exportarArchivoPDF(driveFileId, {
        ...OPCIONES_PDF_IMPRESION
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-09 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    NOMBRE_PDF_ARCHIVO,
    OPCIONES_PDF_IMPRESION,
    descargarPlantillaPdf
};
