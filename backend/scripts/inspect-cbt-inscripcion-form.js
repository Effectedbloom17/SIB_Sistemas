require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });
const forms = google.forms({ version: 'v1', auth: oauth2 });

async function main() {
  const formId = String(process.env.CBT_INSCRIPCION_FORM_ID || '').trim();
  if (formId) {
    const form = await forms.forms.get({ formId });
    printForm(form.data, formId);
    return;
  }

  const q =
    "mimeType='application/vnd.google-apps.form' and (name contains 'Inscripcion' or name contains 'CBT') and trashed=false";
  const res = await drive.files.list({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const files = res.data.files || [];
  console.log('Found forms:', files.length);
  for (const f of files) {
    try {
      const form = await forms.forms.get({ formId: f.id });
      printForm(form.data, f.id, f.name);
    } catch (e) {
      console.log('err', f.id, e.message);
    }
  }
}

function printForm(data, id, driveName) {
  console.log('\n===', driveName || data.info?.title, id, '===');
  console.log('title:', data.info?.title);
  console.log('description:', (data.info?.description || '').slice(0, 120));
  (data.items || []).forEach((it, i) => {
    let kind = 'unknown';
    if (it.pageBreakItem) kind = 'PAGE_BREAK';
    else if (it.questionItem) kind = 'QUESTION';
    else if (it.textItem) kind = 'TEXT';
    else if (it.imageItem) kind = 'IMAGE';
    else if (it.videoItem) kind = 'VIDEO';
    console.log(
      i,
      kind,
      JSON.stringify({
        itemId: it.itemId,
        title: (it.title || '').slice(0, 70),
        desc: (it.description || '').slice(0, 50)
      })
    );
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
