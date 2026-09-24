/**
 * Restaura la estructura correcta SGC-F-05:
 *  · hoja «Plantilla» = plantilla limpia (sin datos, no se escribe)
 *  · hoja «Bitácora»  = hoja de trabajo con la información
 *
 * Partimos del Sheet actual (Bitácora bien formateada con datos).
 *
 * Uso: node backend/scripts/restaurar-hojas-sgc-f-05.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ExcelJS = require('exceljs');
const fs = require('fs');
const driveService = require('../driveService');

const SISTEMA_ID = '1-arhVklHG2DF8ydrjUQZbkUrqEKbdPbuN3gj-RJzGQU';
const MASTER_ID = '1Ef0vaAwFcrED9RZOE2pkoRLZX9RxVUvfI2NLfEEpJBk';
const DATA_START = 7;
const DATA_END = 66;

async function limpiarFilasDatos(spreadsheetId, sheetTitle) {
    const actualizaciones = [];
    for (let r = DATA_START; r <= DATA_END; r++) {
        actualizaciones.push({
            range: `${sheetTitle}!A${r}:I${r}`,
            values: [['', '', '', '', '', '', '', '', '']]
        });
    }
    for (let i = 0; i < actualizaciones.length; i += 25) {
        await driveService.actualizarCeldasGoogleSheet(
            spreadsheetId,
            actualizaciones.slice(i, i + 25)
        );
    }
}

async function asegurarPlantillaYBitacora(spreadsheetId, { limpiarBitacora }) {
    const hojas = await driveService.listarHojasGoogleSheet(spreadsheetId);
    console.log(`  Hojas actuales: ${hojas.join(', ') || '(ninguna)'}`);

    if (!hojas.includes('Bitácora')) {
        throw new Error(`No hay hoja Bitácora en ${spreadsheetId}`);
    }

    if (hojas.includes('Plantilla')) {
        // Ya existe: dejar Bitácora y limpiar Plantilla
        await limpiarFilasDatos(spreadsheetId, 'Plantilla');
        console.log('  Plantilla ya existía → datos limpiados');
    } else {
        // Duplicar Bitácora → Plantilla y vaciar Plantilla
        const dup = await driveService.duplicarHojaGoogleSheet(
            spreadsheetId,
            'Bitácora',
            'Plantilla'
        );
        console.log(`  Duplicada Bitácora → ${dup.title}`);
        await limpiarFilasDatos(spreadsheetId, dup.title || 'Plantilla');
        console.log('  Plantilla vaciada (sin datos)');
    }

    if (limpiarBitacora) {
        await limpiarFilasDatos(spreadsheetId, 'Bitácora');
        console.log('  Bitácora vaciada (master limpio)');
    }

    // Orden visual: Plantilla primero, Bitácora después (opcional vía index)
    const sheetsApi = require('googleapis').google.sheets({
        version: 'v4',
        auth: driveService.getAuthClient()
    });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const lista = meta.data.sheets || [];
    const plantilla = lista.find((s) => s.properties?.title === 'Plantilla');
    const bitacora = lista.find((s) => s.properties?.title === 'Bitácora');
    const requests = [];
    if (plantilla?.properties?.sheetId != null) {
        requests.push({
            updateSheetProperties: {
                properties: { sheetId: plantilla.properties.sheetId, index: 0 },
                fields: 'index'
            }
        });
    }
    if (bitacora?.properties?.sheetId != null) {
        requests.push({
            updateSheetProperties: {
                properties: { sheetId: bitacora.properties.sheetId, index: 1 },
                fields: 'index'
            }
        });
    }
    if (requests.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    }

    const finales = await driveService.listarHojasGoogleSheet(spreadsheetId);
    console.log(`  Hojas finales: ${finales.join(', ')}`);
    return finales;
}

async function reescribirDatosDesdeSnapshot(spreadsheetId) {
    const src = path.join(process.env.TEMP || '', 'sgc-f-05-source.xlsx');
    if (!fs.existsSync(src)) {
        console.warn('  Sin snapshot XLSX; se dejan los datos actuales de Bitácora');
        return;
    }

    function celdaATexto(valor) {
        if (valor === null || valor === undefined) return '';
        if (valor instanceof Date) {
            const y = valor.getUTCFullYear();
            const mo = String(valor.getUTCMonth() + 1).padStart(2, '0');
            const day = String(valor.getUTCDate()).padStart(2, '0');
            return `${day}/${mo}/${String(y).slice(-2)}`;
        }
        if (typeof valor === 'object') {
            if (valor.result != null) return celdaATexto(valor.result);
            if (Array.isArray(valor.richText)) return valor.richText.map((p) => p.text || '').join('');
            if (valor.text) return String(valor.text);
        }
        return String(valor).trim();
    }

    function fechaDisplay(valor) {
        const t = celdaATexto(valor);
        const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
        return t;
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(src);
    const ws = wb.getWorksheet('Bitácora');
    if (!ws) return;

    const registros = [];
    for (let r = DATA_START; r <= DATA_END; r++) {
        const row = ws.getRow(r);
        const folio = celdaATexto(row.getCell(1).value);
        if (!folio) continue;
        registros.push({
            folio,
            fuente: celdaATexto(row.getCell(2).value),
            fechaInicio: fechaDisplay(row.getCell(3).value),
            fechaCierre: fechaDisplay(row.getCell(4).value),
            area: celdaATexto(row.getCell(5).value),
            cliente: celdaATexto(row.getCell(6).value),
            descripcion: celdaATexto(row.getCell(7).value),
            accion: celdaATexto(row.getCell(8).value),
            estatus: celdaATexto(row.getCell(9).value)
        });
    }

    const actualizaciones = [];
    for (let i = 0; i < 60; i++) {
        const rowNum = DATA_START + i;
        const r = registros[i] || {
            folio: '', fuente: '', fechaInicio: '', fechaCierre: '',
            area: '', cliente: '', descripcion: '', accion: '', estatus: ''
        };
        actualizaciones.push({
            range: `Bitácora!A${rowNum}:I${rowNum}`,
            values: [[
                r.folio, r.fuente, r.fechaInicio, r.fechaCierre,
                r.area, r.cliente, r.descripcion, r.accion, r.estatus
            ]]
        });
    }
    for (let i = 0; i < actualizaciones.length; i += 20) {
        await driveService.actualizarCeldasGoogleSheet(
            spreadsheetId,
            actualizaciones.slice(i, i + 20)
        );
    }
    await driveService.aplicarFormatoFilasSgcF05(
        spreadsheetId,
        'Bitácora',
        DATA_START,
        registros.length,
        DATA_END,
        registros
    );
    console.log(`  Datos reescritos en Bitácora (${registros.length} registros) + colores estatus`);
}

(async () => {
    if (driveService.arranqueAuthPromise) await driveService.arranqueAuthPromise;
    await new Promise((r) => setTimeout(r, 1000));

    console.log('[1] Master (Plantilla limpia + Bitácora vacía)');
    await asegurarPlantillaYBitacora(MASTER_ID, { limpiarBitacora: true });

    console.log('[2] Sistema (Plantilla limpia + Bitácora con datos)');
    await asegurarPlantillaYBitacora(SISTEMA_ID, { limpiarBitacora: false });
    // Bitácora del sistema ya tiene datos; reaplicar formato de estatus por si acaso
    await reescribirDatosDesdeSnapshot(SISTEMA_ID);

    // Actualizar XLSX local de respaldo con ambas hojas
    const localPath = path.join(__dirname, '..', 'plantillas', 'SGC-F-05-Bitacora-plantilla.xlsx');
    const buf = await driveService.exportarGoogleSheetComoXLSX(MASTER_ID);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buf);
    console.log('[3] Respaldo local actualizado:', localPath);

    console.log('OK');
    console.log('Master:', `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`);
    console.log('Sistema:', `https://docs.google.com/spreadsheets/d/${SISTEMA_ID}/edit`);
})().catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
