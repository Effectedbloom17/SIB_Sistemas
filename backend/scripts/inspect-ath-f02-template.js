const driveService = require('../driveService');
const ExcelJS = require('exceljs');

(async () => {
  const id = '1PH6_usxtmpYsr8AOYqlGi9Z9fJEZ4hywDEqKDjIfKOk';
  const buf = await driveService.exportarGoogleSheetComoXLSX(id);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  console.log('Sheet:', ws.name, 'rows:', ws.rowCount, 'cols:', ws.columnCount);
  for (let r = 1; r <= Math.min(120, ws.rowCount); r++) {
    const cells = [];
    for (let c = 1; c <= Math.min(15, ws.columnCount); c++) {
      const v = ws.getCell(r, c).value;
      let t = '';
      if (v && typeof v === 'object' && v.richText) t = v.richText.map((p) => p.text).join('');
      else if (v && typeof v === 'object' && v.text) t = v.text;
      else if (v !== null && v !== undefined) t = String(v);
      t = t.replace(/\s+/g, ' ').trim();
      if (t) cells.push(`C${c}:${t.slice(0, 60)}`);
    }
    if (cells.length) console.log(`R${r}:`, cells.join(' | '));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
