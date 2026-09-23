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
  const info = await sheets.spreadsheets.get({
    spreadsheetId: sid,
    fields: 'sheets(properties(title,sheetId),merges)'
  });
  const lines = [];
  for (const sh of info.data.sheets) {
    const t = sh.properties.title;
    lines.push(`==== SHEET ${t} merges=${(sh.merges || []).length}`);
    const vals = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: `'${t.replace(/'/g, "''")}'!A1:N90`
    });
    (vals.data.values || []).forEach((row, i) => {
      const cells = row
        .map((v, c) => {
          const s = String(v == null ? '' : v).replace(/\n/g, ' / ').trim();
          return s ? `${c + 1}:${s.slice(0, 100)}` : null;
        })
        .filter(Boolean);
      if (cells.length) lines.push(`R${i + 1} ${cells.join(' || ')}`);
    });
    (sh.merges || [])
      .filter((m) => m.startRowIndex < 90)
      .forEach((m) => {
        lines.push(
          `MERGE R${m.startRowIndex + 1}-${m.endRowIndex} C${m.startColumnIndex + 1}-${m.endColumnIndex}`
        );
      });
  }
  const out = path.join(__dirname, '_spf07-layout-now.txt');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log('Wrote', out);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
