const fs = require('fs');
const path = require('path');

const dest = path.join('src', 'assets', 'img', 'biznaguita');
fs.mkdirSync(dest, { recursive: true });

const copies = [
  [
    path.join('src', 'assets', 'img', 'mascota-biznaga.png'),
    path.join(dest, 'mascota-biznaga.png'),
  ],
  [
    'C:\\Users\\chaz3\\.cursor\\projects\\c-Users-chaz3-source-repos-SIB-Sistemas\\assets\\c__Users_chaz3_AppData_Roaming_Cursor_User_workspaceStorage_8364158704197e942497c9c590e70b91_images_Biznaga_firma_rechazada-2756a35a-9d4b-4d67-839e-da660a9914e1.png',
    path.join(dest, 'firma-rechazada.png'),
  ],
  [
    'C:\\Users\\chaz3\\.cursor\\projects\\c-Users-chaz3-source-repos-SIB-Sistemas\\assets\\c__Users_chaz3_AppData_Roaming_Cursor_User_workspaceStorage_8364158704197e942497c9c590e70b91_images_Biznaga_firma_autorizada-c949b5ea-facf-41ac-b514-b40e6b4c096c.png',
    path.join(dest, 'firma-autorizada.png'),
  ],
  [
    'C:\\Users\\chaz3\\.cursor\\projects\\c-Users-chaz3-source-repos-SIB-Sistemas\\assets\\c__Users_chaz3_AppData_Roaming_Cursor_User_workspaceStorage_8364158704197e942497c9c590e70b91_images_Biznaga_solicitud_firma-1882547a-644d-4048-b3d4-4fe488145bf6.png',
    path.join(dest, 'solicitud-firma.png'),
  ],
];

let failed = false;
for (const [src, d] of copies) {
  if (!fs.existsSync(src)) {
    console.error('MISSING:', src);
    failed = true;
    continue;
  }
  fs.copyFileSync(src, d);
  const st = fs.statSync(d);
  console.log(path.basename(d), st.size);
}

console.log('--- dest listing ---');
for (const f of fs.readdirSync(dest)) {
  const st = fs.statSync(path.join(dest, f));
  console.log(f, st.size, st.size > 0 ? 'OK' : 'EMPTY');
}

if (failed) process.exit(1);
