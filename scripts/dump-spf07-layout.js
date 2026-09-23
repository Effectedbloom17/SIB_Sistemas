/**
 * Dump updated SP-F-07 layout after user edits.
 */
const path = require('path');
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
    fields: 'sheets(properties,merges)'
  });
  const sh = info.data.sheets[0];
  console.log('TITLE', sh.properties.title);
  const vals = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: "'" + sh.properties.title.replace(/'/g, "''") + "'!A1:N100"
  });
  (vals.data.values || []).forEach((row, i) => {
    const cells = row
      .map((v, c) => {
        const t = String(v == null ? '' : v).replace(/\n/g, ' / ').trim();
        return t ? c + 1 + ':' + t.slice(0, 90) : null;
      })
      .filter(Boolean);
    if (cells.length) console.log('R' + (i + 1), cells.join(' || '));
  });
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
