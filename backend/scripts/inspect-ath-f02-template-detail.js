const driveService = require('../driveService');
const ExcelJS = require('exceljs');

(async () => {
  const id = '1PH6_usxtmpYsr8AOYqlGi9Z9fJEZ4hywDEqKDjIfKOk';
  const buf = await driveService.exportarGoogleSheetComoXLSX(id);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  // Header meta
  for (const [r,c] of [[1,1],[2,1],[3,1],[4,1],[1,20],[2,20],[3,20],[4,20],[5,20],[6,20],[7,7],[7,8],[8,7],[10,7],[10,15],[11,7],[12,7],[13,7]]) {
    const v = ws.getCell(r,c).value;
    console.log(`(${r},${c})`, JSON.stringify(v));
  }
  // Funciones rows 18-45
  console.log('--- funciones start 18-18 ---');
  for (let r = 18; r <= 47; r++) {
    const t = String(ws.getCell(r,1).value || '').trim();
    if (t) console.log('R'+r, t.slice(0,80));
  }
  // Experiencia rows 64-69
  for (let r = 64; r <= 69; r++) {
    const parts = [];
    for (let c = 1; c <= 15; c++) {
      const t = String(ws.getCell(r,c).value || '').trim();
      if (t) parts.push(`C${c}:${t.slice(0,30)}`);
    }
    if (parts.length) console.log('Exp R'+r, parts.join('|'));
  }
  // Relaciones internas 107-118
  for (let r = 107; r <= 130; r++) {
    const parts = [];
    for (let c = 1; c <= 15; c++) {
      const t = String(ws.getCell(r,c).value || '').trim();
      if (t) parts.push(`C${c}:${t.slice(0,40)}`);
    }
    if (parts.length) console.log('Rel R'+r, parts.join('|'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
