/**
 * Genera catálogos SGC-F-01 (frontend + backend) desde tmp-sgc-f01.xlsx
 * Uso (desde backend/): node scripts/generarCatalogoSgcF01.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const XLSX = path.join(__dirname, '..', 'tmp-sgc-f01.xlsx');
const FE_OUT = path.join(__dirname, '..', '..', 'src', 'app', 'pages', 'sistema-gestion-calidad', 'sgc-f-01.catalog.ts');
const BE_SERVICE = path.join(__dirname, '..', 'sgcSgcF01Service.js');

function cellText(cell) {
  const v = cell?.value;
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result).trim();
    if (v.text != null) return String(v.text).trim();
    if (v.richText) return v.richText.map((x) => x.text).join('').trim();
  }
  return String(v).trim();
}

function fechaIso(t) {
  t = String(t || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!m) return '';
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normVer(v) {
  const t = String(v || '').trim();
  if (!t) return '00';
  if (/^(sí|si|vigente)$/i.test(t)) return 'Sí';
  if (/^(n\/a|na)$/i.test(t)) return 'N/A';
  const m = t.match(/(\d{1,3})/);
  if (m) return String(parseInt(m[1], 10)).padStart(2, '0');
  return t.slice(0, 12);
}

async function parseDocs() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(XLSX));
  const ws = wb.worksheets[0];
  const SECCIONES = new Set(['PROCEDIMIENTOS', 'FORMATOS', 'POLÍTICAS', 'POLITICAS', 'INSTRUCTIVOS', 'DOCUMENTOS EXTERNOS']);
  let seccion = '';
  const docs = [];

  for (let r = 7; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = cellText(row.getCell(1));
    const b = cellText(row.getCell(2));
    const c = cellText(row.getCell(3));
    let codigo = cellText(row.getCell(4)).toUpperCase();
    const ver = cellText(row.getCell(5));
    const fecha = cellText(row.getCell(6));
    const nombre = cellText(row.getCell(7));
    const resp = cellText(row.getCell(8));
    const key = (a || '').toUpperCase();

    if (SECCIONES.has(key) || SECCIONES.has((b || '').toUpperCase())) {
      seccion = SECCIONES.has(key) ? key : (b || '').toUpperCase();
      if (seccion === 'POLITICAS') seccion = 'POLÍTICAS';
      continue;
    }
    if (!nombre) continue;

    const esExterno = seccion === 'DOCUMENTOS EXTERNOS';
    if (!esExterno && !codigo) continue;

    let area = a;
    const pref = codigo.split('-')[0];
    if (pref && pref !== 'SGC' && pref !== 'NA' && ['ATH', 'EIN', 'SP', 'DG', 'PC', 'AMB'].includes(pref)) {
      area = pref;
    }
    if (!area) area = pref === 'NA' || !pref ? 'SGC' : pref;

    let especie = c;
    let tipo = b || 'Interno';

    if (esExterno) {
      tipo = tipo || 'Externo';
      especie = 'Documento externo';
      if (!codigo || codigo === 'NA' || /^EXT-\d+$/.test(codigo)) {
        codigo = '';
      }
    } else if (seccion === 'POLÍTICAS') {
      especie = 'Política';
    } else if (seccion === 'INSTRUCTIVOS') {
      especie = 'Instructivo';
    } else if (seccion === 'PROCEDIMIENTOS') {
      especie = especie || 'Procedimiento';
    } else if (seccion === 'FORMATOS') {
      especie = especie || 'Formato';
    }

    if (!esExterno && (!codigo || codigo === 'NA')) continue;

    docs.push({
      area,
      tipoDocumento: tipo,
      especie,
      codigo,
      versionVigente: normVer(ver),
      fechaRevision: fechaIso(fecha),
      nombreDocumento: nombre,
      responsable: resp || 'Ejecutivo de Sist. Gest. y Cap.',
      seccion
    });
  }
  return docs;
}

function writeFrontend(docs) {
  const L = [];
  L.push('/**');
  L.push(' * SGC-F-01 · Catálogo base de la lista maestra (desarrollo).');
  L.push(' * Fuente: hoja 1raOGsFXYsXffNFY0Zm42KuKKdIDHPtyF (orden Excel, no alfabético).');
  L.push(' * Secciones: PROCEDIMIENTOS → FORMATOS → POLÍTICAS → INSTRUCTIVOS → DOCUMENTOS EXTERNOS');
  L.push(' */');
  L.push('');
  L.push('export interface SgcF01DocumentoCatalogo {');
  L.push('  area: string;');
  L.push('  tipoDocumento: string;');
  L.push('  /** Clave de sección Excel (Procedimiento, Formato, …). */');
  L.push('  especie: string;');
  L.push('  codigo: string;');
  L.push('  versionVigente: string;');
  L.push('  fechaRevision: string;');
  L.push('  nombreDocumento: string;');
  L.push('  responsable: string;');
  L.push('  /** false = no vigente (se conserva en lista, fila rosa). */');
  L.push('  vigente?: boolean;');
  L.push("  fuenteVersion?: 'sistema' | 'catalogo';");
  L.push('  enSistema?: boolean;');
  L.push('}');
  L.push('');
  L.push('export interface SgcF01SeccionDef {');
  L.push('  id: string;');
  L.push('  titulo: string;');
  L.push('  /** Valores de `especie` que pertenecen a esta sección. */');
  L.push('  especies: string[];');
  L.push('}');
  L.push('');
  L.push('/** Orden de bloques tal cual el Excel oficial. */');
  L.push('export const SGC_F01_SECCIONES: SgcF01SeccionDef[] = [');
  L.push("  { id: 'procedimientos', titulo: 'PROCEDIMIENTOS', especies: ['Procedimiento'] },");
  L.push("  { id: 'formatos', titulo: 'FORMATOS', especies: ['Formato'] },");
  L.push("  { id: 'politicas', titulo: 'POLÍTICAS', especies: ['Política'] },");
  L.push("  { id: 'instructivos', titulo: 'INSTRUCTIVOS', especies: ['Instructivo'] },");
  L.push("  { id: 'documentos-externos', titulo: 'DOCUMENTOS EXTERNOS', especies: ['Documento', 'Externo', 'Documento externo'] }");
  L.push('];');
  L.push('');
  L.push('export const SGC_F01_ESPECIES = [');
  L.push("  'Procedimiento',");
  L.push("  'Formato',");
  L.push("  'Política',");
  L.push("  'Instructivo',");
  L.push("  'Documento',");
  L.push("  'Externo',");
  L.push("  'Documento externo',");
  L.push("  'Manual',");
  L.push("  'Registro',");
  L.push("  'Otro'");
  L.push('] as const;');
  L.push('');
  L.push("const RESPONSABLE = 'Ejecutivo de Sist. Gest. y Cap.';");
  L.push('');
  L.push('function d(');
  L.push('  area: string,');
  L.push('  tipoDocumento: string,');
  L.push('  especie: string,');
  L.push('  codigo: string,');
  L.push('  versionVigente: string,');
  L.push('  fechaRevision: string,');
  L.push('  nombreDocumento: string,');
  L.push('  responsable = RESPONSABLE');
  L.push('): SgcF01DocumentoCatalogo {');
  L.push('  return {');
  L.push('    area,');
  L.push('    tipoDocumento,');
  L.push('    especie,');
  L.push('    codigo,');
  L.push('    versionVigente,');
  L.push('    fechaRevision,');
  L.push('    nombreDocumento,');
  L.push('    responsable,');
  L.push('    vigente: true,');
  L.push("    fuenteVersion: 'catalogo',");
  L.push('    enSistema: false');
  L.push('  };');
  L.push('}');
  L.push('');
  L.push('export const SGC_F01_CATALOGO_BASE: SgcF01DocumentoCatalogo[] = [');

  let lastSec = '';
  for (const doc of docs) {
    if (doc.seccion !== lastSec) {
      L.push('');
      L.push(`  // —— ${doc.seccion} ——`);
      lastSec = doc.seccion;
    }
    const respArg = doc.responsable === 'Ejecutivo de Sist. Gest. y Cap.'
      ? ''
      : `, '${esc(doc.responsable)}'`;
    L.push(
      `  d('${esc(doc.area)}', '${esc(doc.tipoDocumento)}', '${esc(doc.especie)}', '${esc(doc.codigo)}', ` +
      `'${esc(doc.versionVigente)}', '${esc(doc.fechaRevision)}', '${esc(doc.nombreDocumento)}'${respArg}),`
    );
  }
  L.push('];');
  L.push('');
  L.push('export function clonarCatalogoSgcF01(): SgcF01DocumentoCatalogo[] {');
  L.push('  return SGC_F01_CATALOGO_BASE.map((row) => ({ ...row }));');
  L.push('}');
  L.push('');
  L.push('export function seccionIdParaEspecie(especie: string): string {');
  L.push("  const e = String(especie || '').trim().toLowerCase();");
  L.push('  for (const sec of SGC_F01_SECCIONES) {');
  L.push('    if (sec.especies.some((x) => x.toLowerCase() === e)) {');
  L.push('      return sec.id;');
  L.push('    }');
  L.push('  }');
  L.push("  return 'otros';");
  L.push('}');
  L.push('');
  L.push('export function esDocumentoExternoSgcF01(doc?: {');
  L.push('  tipoDocumento?: string;');
  L.push('  especie?: string;');
  L.push('  codigo?: string;');
  L.push('} | null): boolean {');
  L.push('  if (!doc) return false;');
  L.push("  const tipo = String(doc.tipoDocumento || '').trim().toLowerCase();");
  L.push("  const especie = String(doc.especie || '').trim().toLowerCase();");
  L.push("  const codigo = String(doc.codigo || '').trim().toUpperCase();");
  L.push("  return tipo === 'externo'");
  L.push("    || especie === 'documento externo'");
  L.push("    || especie === 'externo'");
  L.push("    || /^EXT-\\d+$/.test(codigo);");
  L.push('}');
  L.push('');
  L.push('/** Índice en el catálogo Excel (orden fijo; -1 si no está). */');
  L.push('export function indiceCatalogoSgcF01(codigo: string, nombreDocumento?: string): number {');
  L.push("  const c = String(codigo || '').trim().toUpperCase();");
  L.push('  if (c) {');
  L.push('    const byCode = SGC_F01_CATALOGO_BASE.findIndex((row) => row.codigo.toUpperCase() === c);');
  L.push('    if (byCode >= 0) return byCode;');
  L.push('  }');
  L.push("  const n = String(nombreDocumento || '').trim().toLowerCase();");
  L.push('  if (n) {');
  L.push('    return SGC_F01_CATALOGO_BASE.findIndex((row) => row.nombreDocumento.trim().toLowerCase() === n);');
  L.push('  }');
  L.push('  return -1;');
  L.push('}');
  L.push('');
  L.push('/** Conserva el orden del Excel; docs desconocidos al final por sección. */');
  L.push('export function ordenarComoExcelSgcF01<T extends { codigo?: string; especie?: string; nombreDocumento?: string }>(filas: T[]): T[] {');
  L.push('  return [...filas].sort((a, b) => {');
  L.push("    const ia = indiceCatalogoSgcF01(a.codigo || '', a.nombreDocumento);");
  L.push("    const ib = indiceCatalogoSgcF01(b.codigo || '', b.nombreDocumento);");
  L.push('    if (ia >= 0 && ib >= 0) return ia - ib;');
  L.push('    if (ia >= 0) return -1;');
  L.push('    if (ib >= 0) return 1;');
  L.push("    const sa = SGC_F01_SECCIONES.findIndex((s) => s.id === seccionIdParaEspecie(a.especie || ''));");
  L.push("    const sb = SGC_F01_SECCIONES.findIndex((s) => s.id === seccionIdParaEspecie(b.especie || ''));");
  L.push('    return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);');
  L.push('  });');
  L.push('}');
  L.push('');

  fs.writeFileSync(FE_OUT, L.join('\n'), 'utf8');
  console.log('Frontend OK:', FE_OUT);
}

function writeBackend(docs) {
  let src = fs.readFileSync(BE_SERVICE, 'utf8');

  const entries = docs.map((doc) => {
    const args = [
      JSON.stringify(doc.area),
      JSON.stringify(doc.tipoDocumento),
      JSON.stringify(doc.especie),
      JSON.stringify(doc.codigo),
      JSON.stringify(doc.versionVigente),
      JSON.stringify(doc.fechaRevision),
      JSON.stringify(doc.nombreDocumento)
    ];
    if (doc.responsable !== 'Ejecutivo de Sist. Gest. y Cap.') {
      args.push(JSON.stringify(doc.responsable));
    }
    return `  doc(${args.join(', ')})`;
  });

  const catalogBlock = `const CATALOGO_BASE = [\n${entries.join(',\n')}\n];`;

  if (!/const CATALOGO_BASE = \[/.test(src)) {
    throw new Error('No se encontró CATALOGO_BASE en sgcSgcF01Service.js');
  }
  src = src.replace(/const CATALOGO_BASE = \[[\s\S]*?\];/, catalogBlock);

  // Apuntar plantilla Drive al archivo nuevo (dev) — desactivado:
  // el archivo fuente es temporal y se elimina tras importar el catálogo.
  // src = src.replace(
  //   /const TEMPLATE_DRIVE_ID = '[^']+';/,
  //   "const TEMPLATE_DRIVE_ID = '1raOGsFXYsXffNFY0Zm42KuKKdIDHPtyF';"
  // );

  fs.writeFileSync(BE_SERVICE, src, 'utf8');
  console.log('Backend OK:', BE_SERVICE);
}

(async () => {
  if (!fs.existsSync(XLSX)) {
    console.error('Falta', XLSX, '— descárgalo primero.');
    process.exit(1);
  }
  const docs = await parseDocs();
  const bySec = docs.reduce((a, d) => {
    a[d.seccion] = (a[d.seccion] || 0) + 1;
    return a;
  }, {});
  console.log('Docs:', docs.length, bySec);
  writeFrontend(docs);
  writeBackend(docs);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
