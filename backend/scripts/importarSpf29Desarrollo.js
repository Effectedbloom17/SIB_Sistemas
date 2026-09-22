/**
 * Importa SP-F-29 desde Google Drive (o archivo local) a proteccion_civil (desarrollo).
 * Uso:
 *   node scripts/importarSpf29Desarrollo.js
 *   node scripts/importarSpf29Desarrollo.js --file=ruta/al/archivo.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const driveService = require('../driveService');
const pcResolutivosService = require('../pcResolutivosService');

function parseArgs(argv) {
    const out = { file: null };
    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--file=')) out.file = arg.slice('--file='.length).trim();
    }
    return out;
}

async function crearPool(database) {
    const host = process.env.DB_HOST_LOCAL || '127.0.0.1';
    const port = Number(process.env.DB_PORT || 3306);
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || process.env.DB_PASS || '';
    console.log(`[import] Conectando a ${user}@${host}:${port}/${database} (desarrollo local)`);
    return mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 3,
        timezone: 'local'
    });
}

async function obtenerBufferExcel(filePath) {
    if (filePath) {
        const abs = path.resolve(filePath);
        if (!fs.existsSync(abs)) {
            throw new Error(`No existe el archivo: ${abs}`);
        }
        console.log(`[import] Leyendo archivo local: ${abs}`);
        return fs.readFileSync(abs);
    }

    await driveService.validarAutenticacionDrive();

    // Preferir el Excel más reciente de la carpeta de control (generado por el sistema).
    const folderId = process.env.PC_SPF29_DRIVE_FOLDER_ID
        || pcResolutivosService.PC_SPF29_DRIVE_FOLDER_ID;
    let fileId = process.env.PC_SPF29_SHEET_ID || pcResolutivosService.PC_SPF29_SHEET_ID;
    let fileLabel = `plantilla id=${fileId}`;

    try {
        const archivos = await driveService.listarArchivosCarpeta(folderId);
        const xlsx = (archivos || [])
            .filter((f) => {
                const name = String(f.name || '').toLowerCase();
                const mime = String(f.mimeType || '');
                return name.includes('sp-f-29')
                    && (mime.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.xls'));
            })
            .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
        if (xlsx.length) {
            fileId = xlsx[0].id;
            fileLabel = `${xlsx[0].name} id=${fileId} modified=${xlsx[0].modifiedTime}`;
        }
    } catch (err) {
        console.warn('[import] No se pudo listar carpeta Drive, se usará PC_SPF29_SHEET_ID:', err.message);
    }

    console.log(`[import] Descargando SP-F-29 desde Drive (${fileLabel})`);
    const buffer = await driveService.exportarArchivoXLSX(fileId);
    if (!buffer || !buffer.length) {
        throw new Error('Drive devolvió un Excel vacío');
    }
    const outPath = path.join(__dirname, '..', 'uploads', 'tmp', `spf29_import_${Date.now()}.xlsx`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    console.log(`[import] Copia temporal guardada en ${outPath} (${buffer.length} bytes)`);
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function main() {
    const args = parseArgs(process.argv);
    const poolPc = await crearPool(process.env.DB_NAME_PC || 'proteccion_civil');
    const poolBiznaga = await crearPool(process.env.DB_NAME || 'biznaga');

    try {
        const buffer = await obtenerBufferExcel(args.file);
        const resultado = await pcResolutivosService.importarControlResolutivosDesdeExcel(
            poolPc,
            poolBiznaga,
            buffer,
            { umbralSimilitud: 0.9 }
        );
        console.log('[import] OK');
        console.log(JSON.stringify(resultado, null, 2));
    } finally {
        await poolPc.end();
        await poolBiznaga.end();
    }
}

main().catch((err) => {
    console.error('[import] ERROR:', err.message || err);
    process.exit(1);
});
