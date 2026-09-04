require('dotenv').config();
const ExcelJS = require('exceljs');
const drive = require('../driveService');

const SHEET_ID = '1fLRLJCl28Mlh5tDJxv13joKp7ET0DrlAKW_IqFp-I4s';

(async () => {
  try {
    const buf = await drive.exportarGoogleSheetComoXLSX(SHEET_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    console.log('Worksheets:', wb.worksheets.map((w) => w.name).join(', '));
    for (const ws of wb.worksheets) {
      console.log('\n===', ws.name, 'rows:', ws.rowCount, 'cols:', ws.columnCount, '===');
      for (let r = 1; r <= Math.min(35, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const vals = [];
        row.eachCell({ includeEmpty: false }, (c, col) => {
          vals.push(`${col}:${String(c.value).substring(0, 120)}`);
        });
        if (vals.length) console.log(`R${r}:`, vals.join(' | '));
      }
    }
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
