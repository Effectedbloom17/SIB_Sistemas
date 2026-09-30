const driveService = require('../driveService');
const ExcelJS = require('exceljs');

function cellText(ws, r, c) {
  const v = ws.getCell(r, c).value;
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map((p) => p.text).join('');
  if (typeof v === 'object' && v.text) return String(v.text);
  if (typeof v === 'object' && v.result != null) return String(v.result);
  return String(v);
}

(async () => {
  const id = '1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc';
  const info = await driveService.obtenerMetadatosArchivo(id);
  console.log('FILE', JSON.stringify({ id: info.id, name: info.name, mimeType: info.mimeType, parents: info.parents }));
  const buf = await driveService.exportarGoogleSheetComoXLSX(id);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  console.log('SHEETS', wb.worksheets.map((w) => `${w.name} ${w.rowCount}x${w.columnCount}`).join(' | '));
  for (const ws of wb.worksheets) {
    console.log('\n=== HOJA', ws.name, 'actual', ws.actualRowCount, ws.actualColumnCount, '===');
    const maxR = Math.min(Math.max(ws.actualRowCount || 0, 45), 50);
    const maxC = Math.max(ws.actualColumnCount || 0, 8);
    for (let r = 1; r <= maxR; r++) {
      const vals = [];
      for (let c = 1; c <= maxC; c++) {
        const t = cellText(ws, r, c).replace(/\s+/g, ' ').trim();
        if (t) vals.push(`C${c}:${t}`);
      }
      if (vals.length) console.log('R' + r, vals.join(' || '));
    }
    const merges = ws.model && ws.model.merges ? ws.model.merges : [];
    console.log('MERGES', merges.join(' | '));
  }
  process.exit(0);
})().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
