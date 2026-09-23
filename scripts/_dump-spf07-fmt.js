const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const backendNm = path.join(root, 'backend', 'node_modules');
require('dotenv').config({ path: path.join(root, 'backend', '.env'), quiet: true });
const { google } = require(path.join(backendNm, 'googleapis'));

(async () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });
  const sid = '1p0XiIIwWth04aKYTs6XYldsy4yNvHGdbJWfWEfYVs4w';
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sid,
    ranges: ["'plantilla'!A31:N55", "'PC-150926-01'!A31:N55"],
    includeGridData: true,
    fields: 'sheets(properties(title),data(rowData(values(formattedValue,effectiveFormat(horizontalAlignment,borders,backgroundColor)))))'
  });
  const lines = [];
  for (const sh of meta.data.sheets) {
    lines.push('==== ' + sh.properties.title);
    const start = 31;
    (sh.data[0].rowData || []).forEach((row, i) => {
      const r = start + i;
      const cells = (row.values || []).map((c, ci) => {
        const v = c.formattedValue || '';
        const align = c.effectiveFormat?.horizontalAlignment || '';
        const bg = c.effectiveFormat?.backgroundColor;
        const hasBorder = !!(c.effectiveFormat?.borders?.top || c.effectiveFormat?.borders?.bottom);
        if (!v && !hasBorder && !align) return null;
        return `${ci + 1}:{${v.slice(0, 40)}|${align}|b=${hasBorder}}`;
      }).filter(Boolean);
      if (cells.length) lines.push(`R${r} ${cells.join(' ')}`);
    });
  }
  fs.writeFileSync(path.join(__dirname, '_spf07-fmt.txt'), lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
