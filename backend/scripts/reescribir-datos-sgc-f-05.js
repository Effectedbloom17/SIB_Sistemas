/**
 * Reescribe los registros SGC-F-05 en la hoja Bitácora del Sheet (sistema)
 * a partir del XLSX descargado (snapshot previo a la reparación).
 *
 * Uso: node backend/scripts/reescribir-datos-sgc-f-05.js [ruta.xlsx]
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ExcelJS = require('exceljs');
const driveService = require('../driveService');

const SISTEMA_ID = '1-arhVklHG2DF8ydrjUQZbkUrqEKbdPbuN3gj-RJzGQU';
const SHEET_TITLE = 'Bitácora';
const DATA_START_ROW = 7;

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) {
        const y = valor.getUTCFullYear();
        const mo = String(valor.getUTCMonth() + 1).padStart(2, '0');
        const day = String(valor.getUTCDate()).padStart(2, '0');
        return `${day}/${mo}/${String(y).slice(-2)}`;
    }
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) return valor.richText.map((p) => p.text || '').join('');
        if (valor.text) return String(valor.text);
    }
    return String(valor).trim();
}

function formatearFechaDisplay(valor) {
    const t = celdaATexto(valor);
    if (!t) return '';
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
    return t;
}

(async () => {
    if (driveService.arranqueAuthPromise) await driveService.arranqueAuthPromise;
    await new Promise((r) => setTimeout(r, 1000));

    const src = process.argv[2]
        || path.join(process.env.TEMP || '', 'sgc-f-05-source.xlsx');
    if (!fs.existsSync(src)) {
        throw new Error(`No existe el snapshot XLSX: ${src}`);
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(src);
    const ws = wb.getWorksheet('Bitácora');
    if (!ws) throw new Error('Snapshot sin hoja Bitácora');

    const registros = [];
    for (let r = DATA_START_ROW; r <= 66; r++) {
        const row = ws.getRow(r);
        const folio = celdaATexto(row.getCell(1).value);
        if (!folio) continue;
        registros.push({
            folio,
            fuente: celdaATexto(row.getCell(2).value),
            fechaInicio: formatearFechaDisplay(row.getCell(3).value),
            fechaCierre: formatearFechaDisplay(row.getCell(4).value),
            area: celdaATexto(row.getCell(5).value),
            cliente: celdaATexto(row.getCell(6).value),
            descripcion: celdaATexto(row.getCell(7).value),
            accion: celdaATexto(row.getCell(8).value),
            estatus: celdaATexto(row.getCell(9).value)
        });
    }
    console.log(`[SGC-F-05] Registros a reescribir: ${registros.length}`);

    const actualizaciones = [];
    for (let i = 0; i < 60; i++) {
        const rowNum = DATA_START_ROW + i;
        const r = registros[i] || {
            folio: '', fuente: '', fechaInicio: '', fechaCierre: '',
            area: '', cliente: '', descripcion: '', accion: '', estatus: ''
        };
        actualizaciones.push({
            range: `${SHEET_TITLE}!A${rowNum}:I${rowNum}`,
            values: [[
                r.folio, r.fuente, r.fechaInicio, r.fechaCierre,
                r.area, r.cliente, r.descripcion, r.accion, r.estatus
            ]]
        });
    }

    for (let i = 0; i < actualizaciones.length; i += 20) {
        await driveService.actualizarCeldasGoogleSheet(
            SISTEMA_ID,
            actualizaciones.slice(i, i + 20)
        );
    }
    console.log('[SGC-F-05] Celdas actualizadas');

    await driveService.aplicarFormatoFilasSgcF05(
        SISTEMA_ID,
        SHEET_TITLE,
        DATA_START_ROW,
        registros.length,
        DATA_START_ROW + 59,
        registros
    );
    console.log('[SGC-F-05] Formato de estatus aplicado (Abierta/Cerrada)');
    console.log(`https://docs.google.com/spreadsheets/d/${SISTEMA_ID}/edit`);
})().catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
