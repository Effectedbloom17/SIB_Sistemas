const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const destDir = path.join(root, 'src', 'assets', 'img', 'biznaguita');
const cursorAssets = path.join(
  process.env.USERPROFILE || 'C:\\Users\\chaz3',
  '.cursor',
  'projects',
  'c-Users-chaz3-source-repos-SIB-Sistemas',
  'assets'
);

const pairs = [
  {
    from: path.join(root, 'src', 'assets', 'img', 'mascota-biznaga.png'),
    to: path.join(destDir, 'mascota-biznaga.png'),
    search: 'mascota-biznaga',
  },
  {
    from: path.join(
      cursorAssets,
      'Biznaga_firma_rechazada-2756a35a-9d4b-4d67-839e-da660a9914e1.png'
    ),
    to: path.join(destDir, 'firma-rechazada.png'),
    search: 'Biznaga_firma_rechazada',
  },
  {
    from: path.join(
      cursorAssets,
      'Biznaga_firma_autorizada-c949b5ea-facf-41ac-b514-b40e6b4c096c.png'
    ),
    to: path.join(destDir, 'firma-autorizada.png'),
    search: 'Biznaga_firma_autorizada',
  },
  {
    from: path.join(
      cursorAssets,
      'Biznaga_solicitud_firma-1882547a-644d-4048-b3d4-4fe488145bf6.png'
    ),
    to: path.join(destDir, 'solicitud-firma.png'),
    search: 'Biznaga_solicitud_firma',
  },
];

function findInAssets(needle) {
  if (!fs.existsSync(cursorAssets)) return null;
  const files = fs.readdirSync(cursorAssets);
  const hit = files.find((f) => f.includes(needle));
  return hit ? path.join(cursorAssets, hit) : null;
}

fs.mkdirSync(destDir, { recursive: true });

const results = [];
for (const pair of pairs) {
  let from = pair.from;
  if (!fs.existsSync(from)) {
    const alt = findInAssets(pair.search);
    if (alt) from = alt;
  }
  try {
    if (!fs.existsSync(from)) {
      results.push({ ok: false, to: pair.to, error: `Source missing: ${pair.from}` });
      continue;
    }
    fs.copyFileSync(from, pair.to);
    const st = fs.statSync(pair.to);
    results.push({ ok: true, from, to: pair.to, size: st.size });
  } catch (err) {
    results.push({
      ok: false,
      to: pair.to,
      from,
      error: String(err && err.message ? err.message : err),
    });
  }
}

const outPath = path.join(destDir, '_copy-result.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));
