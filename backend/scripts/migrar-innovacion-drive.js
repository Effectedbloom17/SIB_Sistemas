const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const { google } = require('googleapis');
const driveService = require('../driveService');

const CARPETA_DI_E_ANTERIOR = '1SI7M7lMjMjhTVF6SvpAZuJ0tbVc12fyU';
const CARPETA_REPOSITORIO = '1cjhFcAN_gxQlViMwNc7REIh-TpfwW24s';
const CARPETA_SENALES = '1PlKRTc4uzu_c8JoT54w_07j_kWAJjzo5';

async function moverArchivo(archivoId, carpetaDestinoId) {
    if (typeof driveService.moverArchivoDrive === 'function') {
        return driveService.moverArchivoDrive(archivoId, carpetaDestinoId);
    }
    const drive = google.drive({ version: 'v3', auth: driveService.getAuthClient() });
    const info = await drive.files.get({ fileId: archivoId, fields: 'id,name,parents' });
    const padres = Array.isArray(info.data.parents) ? info.data.parents : [];
    const removeParents = padres.filter(id => id && id !== carpetaDestinoId).join(',');
    await drive.files.update({
        fileId: archivoId,
        addParents: carpetaDestinoId,
        ...(removeParents ? { removeParents } : {}),
        fields: 'id,parents'
    });
}

async function moverRepositorio() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DI_E_ANTERIOR);
    for (const archivo of archivos) {
        await moverArchivo(archivo.id, CARPETA_REPOSITORIO);
        console.log(`[REPOSITORIO] Movido: ${archivo.name}`);
    }
    const conexion = await conectarSgc();
    try {
        await conexion.query(
            `UPDATE sgc_documentacion_extra
             SET carpeta_drive_id = ?
             WHERE carpeta_drive_id = ? OR carpeta_drive_id IS NULL`,
            [CARPETA_REPOSITORIO, CARPETA_DI_E_ANTERIOR]
        );
    } finally {
        await conexion.end();
    }
    return archivos.length;
}

async function conectarSgc() {
    return mysql.createConnection({
        host: process.env.DB_HOST_REMOTE,
        port: Number(process.env.DB_PORT_REMOTE || process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME_SGC || 'biznaga_sgc'
    });
}

async function migrarSenales() {
    const conexion = await conectarSgc();
    try {
        try {
            await conexion.query(
                'ALTER TABLE innovacion_sign ADD COLUMN drive_file_id VARCHAR(128) NULL AFTER ruta_archivo'
            );
        } catch (error) {
            if (!String(error?.message || '').includes('Duplicate column')) {
                throw error;
            }
        }

        const [registros] = await conexion.query(`
            SELECT id, nombre_senal, nombre_archivo, mime_type, tamano_bytes, drive_file_id
            FROM innovacion_sign
            ORDER BY id
        `);
        const resumen = { vinculadas: 0, noEncontradas: [] };

        for (const registro of registros) {
            let archivo = null;
            if (registro.drive_file_id) {
                try {
                    archivo = await driveService.obtenerInfoArchivo(registro.drive_file_id);
                } catch {
                    archivo = null;
                }
            }
            if (!archivo) {
                archivo = await driveService.buscarArchivoGlobal(registro.nombre_archivo);
            }

            const esperado = Number(registro.tamano_bytes || 0);
            const encontrado = Number(archivo?.size || 0);
            if (!archivo?.id || (esperado > 0 && encontrado > 0 && esperado !== encontrado)) {
                resumen.noEncontradas.push({
                    id: registro.id,
                    nombre: registro.nombre_senal || registro.nombre_archivo
                });
                continue;
            }

            await moverArchivo(archivo.id, CARPETA_SENALES);
            await conexion.query(
                'UPDATE innovacion_sign SET drive_file_id = ? WHERE id = ?',
                [archivo.id, registro.id]
            );
            resumen.vinculadas += 1;
            console.log(`[SEÑALES] Vinculada: ${registro.nombre_archivo}`);
        }
        return resumen;
    } finally {
        await conexion.end();
    }
}

async function main() {
    const moverRepo = process.argv.includes('--repositorio');
    const moverSigns = process.argv.includes('--senales');
    const resultado = {};
    if (moverRepo) resultado.repositorioMovidos = await moverRepositorio();
    if (moverSigns) resultado.senales = await migrarSenales();
    console.log(`RESULTADO=${JSON.stringify(resultado)}`);
}

main().catch(error => {
    console.error(`[ERROR] ${error.message}`);
    process.exit(1);
});
