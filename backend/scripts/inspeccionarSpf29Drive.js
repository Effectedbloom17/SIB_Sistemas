require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const driveService = require('../driveService');

(async () => {
    await driveService.validarAutenticacionDrive();
    const auth = driveService.getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const sheetId = process.env.PC_SPF29_SHEET_ID;

    const meta = await drive.files.get({
        fileId: sheetId,
        fields: 'id,name,mimeType,modifiedTime,size'
    });
    console.log('meta', meta.data);

    try {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'Hoja1!A6:J40'
        });
        const values = res.data.values || [];
        console.log('values rows', values.length);
        console.log(JSON.stringify(values.slice(0, 15), null, 2));
    } catch (e) {
        console.log('sheets api error:', e.message);
    }

    const folderId = process.env.PC_SPF29_DRIVE_FOLDER_ID;
    const list = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,modifiedTime,size)',
        pageSize: 40,
        orderBy: 'modifiedTime desc'
    });
    console.log('folder files:', JSON.stringify(list.data.files, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
