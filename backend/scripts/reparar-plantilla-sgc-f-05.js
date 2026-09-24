/**
 * Repara la plantilla maestra SGC-F-05 desde la hoja «Plantilla» del Sheet
 * de trabajo (Bitácora estaba corrompida) y reescribe la copia (sistema).
 *
 * Uso: node backend/scripts/reparar-plantilla-sgc-f-05.js
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');
const driveService = require('../driveService');
const sgcF05 = require('../sgcF05Service');
const { asegurarTablaSgcFormatoDatos, obtenerRegistroSgcPersistido } = require('../sgcDgF05Service');

const SISTEMA_ID = '1-arhVklHG2DF8ydrjUQZbkUrqEKbdPbuN3gj-RJzGQU';
const CARPETA_TRABAJO = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_MASTER = 'SGC-F-05 Bitacora de no conformidades';

function crearPoolDev() {
    const envPath = path.join(__dirname, '..', '.env');
    const dotenv = require('dotenv');
    const env = dotenv.parse(fs.readFileSync(envPath));
    return mysql.createPool(buildMysqlPoolOptions({
        host: env.DB_HOST_LOCAL || env.DB_HOST || '127.0.0.1',
        user: env.DB_USER,
        password: env.DB_PASS || env.DB_PASSWORD,
        database: env.DB_NAME_SGC || env.DB_NAME || 'biznaga_sgc',
        port: Number(env.DB_PORT || 3306),
        connectionLimit: 2
    }));
}

async function limpiarFilasDatos(spreadsheetId, sheetTitle) {
    const actualizaciones = [];
    for (let r = 7; r <= 66; r++) {
        actualizaciones.push({
            range: `${sheetTitle}!A${r}:I${r}`,
            values: [['', '', '', '', '', '', '', '', '']]
        });
    }
    for (let i = 0; i < actualizaciones.length; i += 30) {
        await driveService.actualizarCeldasGoogleSheet(
            spreadsheetId,
            actualizaciones.slice(i, i + 30)
        );
    }
}

(async () => {
    if (driveService.arranqueAuthPromise) {
        await driveService.arranqueAuthPromise;
    }
    await new Promise((r) => setTimeout(r, 1200));

    let carpetaPlantillas = CARPETA_TRABAJO;
    try {
        const r = await driveService.moverPlantillasACapacitacionDocumentacion();
        if (r?.folderId) carpetaPlantillas = r.folderId;
        console.log('[SGC-F-05] Carpeta plantillas:', carpetaPlantillas, r?.estado || '');
    } catch (err) {
        console.warn('[SGC-F-05] Usando carpeta trabajo:', err.message);
    }

    const master = await driveService.copiarGoogleSheetACarpeta(
        SISTEMA_ID,
        NOMBRE_MASTER,
        carpetaPlantillas
    );
    console.log('[SGC-F-05] Master creado:', master.id);

    const hojasMaster = await driveService.listarHojasGoogleSheet(master.id);
    console.log('[SGC-F-05] Hojas master iniciales:', hojasMaster.join(', '));

    if (hojasMaster.includes('Bitácora')) {
        await driveService.eliminarHojasGoogleSheet(master.id, ['Bitácora']);
        console.log('[SGC-F-05] Hoja Bitácora corrupta eliminada del master');
    }

    const trasBorrar = await driveService.listarHojasGoogleSheet(master.id);
    if (trasBorrar.includes('Plantilla')) {
        await driveService.renombrarHojaGoogleSheet(master.id, 'Plantilla', 'Bitácora');
        console.log('[SGC-F-05] Plantilla → Bitácora');
    }

    const fix = await driveService.reemplazarTextoEnGoogleSheet(
        master.id,
        'Código: SGC-F-10',
        'Código: SGC-F-05'
    );
    console.log('[SGC-F-05] Código corregido, ocurrencias:', fix.occurrencesChanged);

    await limpiarFilasDatos(master.id, 'Bitácora');
    console.log('[SGC-F-05] Filas de datos limpiadas en master');

    const idPath = path.join(__dirname, '..', 'plantillas', 'SGC-F-05-MASTER-ID.txt');
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, master.id, 'utf8');
    console.log('[SGC-F-05] MASTER_ID=' + master.id);
    console.log('[SGC-F-05] Actualiza TEMPLATE_DRIVE_ID en sgcF05Service.js con ese ID.');

    // Reparar copia (sistema) in-place: misma operación de hojas + reescribir datos BD
    const hojasSistema = await driveService.listarHojasGoogleSheet(SISTEMA_ID);
    console.log('[SGC-F-05] Hojas sistema:', hojasSistema.join(', '));

    if (hojasSistema.includes('Bitácora') && hojasSistema.includes('Plantilla')) {
        await driveService.eliminarHojasGoogleSheet(SISTEMA_ID, ['Bitácora']);
        await driveService.renombrarHojaGoogleSheet(SISTEMA_ID, 'Plantilla', 'Bitácora');
        await driveService.reemplazarTextoEnGoogleSheet(
            SISTEMA_ID,
            'Código: SGC-F-10',
            'Código: SGC-F-05'
        );
        console.log('[SGC-F-05] Copia sistema: Bitácora reemplazada por Plantilla');
    } else if (hojasSistema.includes('Plantilla') && !hojasSistema.includes('Bitácora')) {
        await driveService.renombrarHojaGoogleSheet(SISTEMA_ID, 'Plantilla', 'Bitácora');
        await driveService.reemplazarTextoEnGoogleSheet(
            SISTEMA_ID,
            'Código: SGC-F-10',
            'Código: SGC-F-05'
        );
    }

    let pool = null;
    try {
        pool = crearPoolDev();
        await asegurarTablaSgcFormatoDatos(pool);
        const registro = await obtenerRegistroSgcPersistido(pool, 'SGC-F-05');
        let datos = null;
        if (registro?.datos_json) {
            const raw = typeof registro.datos_json === 'string'
                ? JSON.parse(registro.datos_json)
                : registro.datos_json;
            datos = raw;
        }
        if (datos) {
            // Usar API interna vía actualizarDatos: exportamos función no pública —
            // llamar guardarFormato reescribe Drive + BD.
            await sgcF05.guardarFormato(pool, { datos, origen: 'sistema' });
            console.log('[SGC-F-05] Datos reescritos en Drive con formato de estatus');
        } else {
            console.warn('[SGC-F-05] Sin datos en BD; estructura reparada sin reescritura');
        }
    } catch (err) {
        console.warn('[SGC-F-05] No se pudo reescribir desde BD:', err.message);
    } finally {
        if (pool) await pool.end().catch(() => {});
    }

    console.log('[SGC-F-05] Reparación terminada.');
    console.log('[SGC-F-05] Master:', `https://docs.google.com/spreadsheets/d/${master.id}/edit`);
    console.log('[SGC-F-05] Sistema:', `https://docs.google.com/spreadsheets/d/${SISTEMA_ID}/edit`);
})().catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
