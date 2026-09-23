const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'backend', 'sgcSpF07Service.js');
let src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('function parsearMomentosDesdeHoja(ws) {');
const end = src.indexOf('async function publicarDatosEnDrive(driveFileId, datos, datosPrevios = null) {');
if (start < 0 || end < 0) {
  console.error('markers not found', start, end);
  process.exit(1);
}
const replacement = fs.readFileSync(path.join(__dirname, '_spf07-block.js'), 'utf8');
src = src.slice(0, start) + replacement + '\n\n' + src.slice(end);
fs.writeFileSync(file, src);
console.log('patched', file);
