const driveService = require('../driveService');
const ExcelJS = require('exceljs');

function cellText(ws, r, c) {
  const v = ws.getCell(r, c).value;
  if (!v) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((p) => p.text).join('');
  if (typeof v === 'object' && v.text) return v.text;
  return String(v);
}

(async () => {
  const id = '1PH6_usxtmpYsr8AOYqlGi9Z9fJEZ4hywDEqKDjIfKOk';
  const buf = await driveService.exportarGoogleSheetComoXLSX(id);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  // revision meta - scan top right
  for (let r = 1; r <= 5; r++) {
    for (let c = 20; c <= 29; c++) {
      const t = cellText(ws, r, c).trim();
      if (t) console.log(`meta (${r},${c}):`, t);
    }
  }
  // value rows for identification
  for (let r = 7; r <= 16; r++) {
    const vals = [];
    for (let c = 1; c <= 20; c++) {
      const t = cellText(ws, r, c).trim();
      if (t) vals.push(`C${c}:${t.slice(0,50)}`);
    }
    if (vals.length) console.log('R'+r, vals.join(' | '));
  }
  // experiencia data rows 65-69
  for (let r = 65; r <= 69; r++) {
    const vals = [];
    for (let c = 1; c <= 15; c++) {
      const t = cellText(ws, r, c).trim();
      if (t) vals.push(`C${c}:${t.slice(0,30)}`);
    }
    if (vals.length) console.log('Exp data R'+r, vals.join(' | '));
  }
  // relaciones internas data 107-117
  for (let r = 107; r <= 117; r++) {
    const vals = [];
    for (let c = 1; c <= 15; c++) {
      const t = cellText(ws, r, c).trim();
      if (t) vals.push(`C${c}:${t.slice(0,40)}`);
    }
    if (vals.length) console.log('Int R'+r, vals.join(' | '));
  }
})().catch((e) => { console.error(e); process.exit(1); });
