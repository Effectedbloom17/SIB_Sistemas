/**
 * Carga objetivos generales desde el archivo TXT al campo curso.objetivo.
 * Solo actualiza curso.objetivo (no toca nombre, imagen, activo ni relaciones).
 *
 * Desarrollo:
 *   node backend/scripts/cargar-objetivos-cursos.js
 *   node backend/scripts/cargar-objetivos-cursos.js --apply
 *
 * Producción (siempre dry-run primero):
 *   node backend/scripts/cargar-objetivos-cursos.js --produccion
 *   node backend/scripts/cargar-objetivos-cursos.js --produccion --apply
 *
 * En producción, por defecto solo rellena objetivos vacíos.
 * Para sobrescribir texto existente: --forzar
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');

const APPLY = process.argv.includes('--apply');
const ES_PRODUCCION = process.argv.includes('--produccion');
const FORZAR = process.argv.includes('--forzar');
const fileArgIdx = process.argv.indexOf('--file');
const FILE_PATH = fileArgIdx >= 0 && process.argv[fileArgIdx + 1]
  ? path.resolve(process.argv[fileArgIdx + 1])
  : path.join(__dirname, '..', '..', 'Objetivos del Curso (07-04-2026).txt');

const envFile = ES_PRODUCCION
  ? path.join(__dirname, '..', '.env.produccion')
  : path.join(__dirname, '..', '.env');

if (!fs.existsSync(envFile)) {
  console.error(`No se encontró ${envFile}`);
  process.exit(1);
}
dotenv.config({ path: envFile, quiet: true });

const SCORE_MINIMO = ES_PRODUCCION ? 90 : 82;

/** Alias TXT → fragmento normalizado del nombre en BD (casos difíciles). */
const ALIAS_TXT_A_BD = [
  {
    txt: 'AUDITOR INTERNO EN LAS NORMAS ISO 14001:2015 E ISO 45001:2018',
    bdIncludes: 'AUDITORES INTERNOS PARA AUDITAR SISTEMAS'
  },
  {
    txt: 'IDENTIFICACION DE TUBERIAS Y SEÑALES DE SEGURIDAD (NOM-026-STPS-2008)',
    bdIncludes: 'IDENTIFICACION DE TUBERIAS'
  },
  {
    txt: 'PREVENCION DE LESIONES MUSCULOESQUELETICAS POR CARGA',
    bdIncludes: 'PREVENCION DE LESIONES MUSCULOESQUELETICAS'
  },
  {
    txt: 'PREVENCION DE RIESGOS POR ELECTRICIDAD ESTATICA',
    bdIncludes: 'PREVENCION RIESGOS POR ELECTRICIDAD ESTATICA'
  }
];

function buscarPorAlias(entradaNombre, cursos) {
  const alias = ALIAS_TXT_A_BD.find((a) => normalizarNombre(a.txt) === normalizarNombre(entradaNombre));
  if (!alias) return null;
  const needle = normalizarNombre(alias.bdIncludes);
  const hits = cursos.filter((c) => normalizarNombre(c.nombre_curso).includes(needle));
  if (!hits.length) return null;
  return hits.map((curso) => ({ curso, score: 99 }));
}

function normalizarNombre(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Caracteres corruptos (? en lugar de vocal/ñ acentuada)
    .replace(/I\?N/g, 'ION')
    .replace(/G\?A/g, 'GIA')
    .replace(/SE\?A/g, 'SENA')
    .replace(/A\?O/g, 'ANO')
    .replace(/\?/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens útiles para matching parcial (ignora conectores cortos). */
function tokensClave(normalizado) {
  return normalizado
    .split(' ')
    .filter((t) => t.length >= 3 && !['PARA', 'CON', 'LOS', 'LAS', 'DEL', 'UNA', 'UNO', 'POR', 'QUE', 'AND', 'THE'].includes(t));
}

function scoreMatch(nombreArchivo, nombreCurso) {
  const a = normalizarNombre(nombreArchivo);
  const b = normalizarNombre(nombreCurso);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;

  const ta = tokensClave(a);
  const tb = new Set(tokensClave(b));
  if (!ta.length || !tb.size) return 0;

  let hits = 0;
  for (const t of ta) {
    if (tb.has(t)) hits += 1;
  }
  const ratio = hits / Math.max(ta.length, tb.size);
  const coverage = hits / ta.length;
  return Math.round((ratio * 40) + (coverage * 50));
}

/**
 * Formato del TXT: "NOMBRE DEL CURSO: texto del objetivo"
 * Algunos nombres incluyen subtítulos o años con ":" (ISO 9001:2015, NOM-035: subtítulo: objetivo).
 * Se toma el último ":" como separador nombre / objetivo.
 */
function parsearArchivo(contenido) {
  const mapa = new Map();
  const lineas = String(contenido || '').split(/\r?\n/);

  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (!linea) continue;

    const sep = linea.lastIndexOf(':');
    if (sep <= 0) continue;

    const nombre = linea.slice(0, sep).trim();
    const objetivo = linea.slice(sep + 1).trim();
    if (!nombre || objetivo.length < 12) continue;
    mapa.set(nombre, objetivo);
  }

  return [...mapa.entries()].map(([nombre, objetivo]) => ({ nombre, objetivo }));
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`No se encontró el archivo: ${FILE_PATH}`);
    process.exit(1);
  }

  const host = ES_PRODUCCION
    ? (process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL)
    : (process.env.DB_HOST_LOCAL || process.env.DB_HOST || '127.0.0.1');
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || 'biznaga';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASS || process.env.DB_PASSWORD || '';

  if (!host || !database || !user) {
    console.error('Faltan DB_HOST / DB_NAME / DB_USER en el .env');
    process.exit(1);
  }

  if (ES_PRODUCCION) {
    const hostNorm = String(host).toLowerCase();
    if (hostNorm === '127.0.0.1' || hostNorm === 'localhost') {
      console.error('ABORTADO: --produccion no puede apuntar a localhost');
      process.exit(1);
    }
    if (!String(database).toLowerCase().includes('biznaga')) {
      console.error(`ABORTADO: DB_NAME no parece biznaga: ${database}`);
      process.exit(1);
    }
  }

  console.log(`Entorno: ${ES_PRODUCCION ? 'PRODUCCIÓN' : 'desarrollo'}`);
  console.log(`Modo: ${APPLY ? 'APPLY (escribe SOLO curso.objetivo)' : 'DRY-RUN (solo reporte)'}`);
  if (ES_PRODUCCION && !FORZAR) {
    console.log('Política: solo rellena objetivos vacíos (usa --forzar para sobrescribir).');
  }
  console.log(`BD: ${user}@${host}:${port}/${database}`);
  console.log(`Archivo: ${FILE_PATH}`);
  console.log('');

  const entradas = parsearArchivo(fs.readFileSync(FILE_PATH, 'utf8'));
  console.log(`Entradas en archivo (únicas por nombre): ${entradas.length}`);

  const pool = mysql.createPool(buildMysqlPoolOptions({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 2,
    connectTimeout: ES_PRODUCCION ? 20000 : 15000
  }));

  try {
    const [cursos] = await pool.query(
      `SELECT curso_id, nombre_curso, objetivo, activo
       FROM curso
       ORDER BY nombre_curso ASC`
    );

    const usados = new Set();
    const actualizados = [];
    const sinCambio = [];
    const sinMatch = [];
    const ambiguos = [];
    const omitidosOcupados = [];

    for (const entrada of entradas) {
      const porAlias = buscarPorAlias(entrada.nombre, cursos);
      const puntuados = (porAlias || cursos
        .map((c) => ({ curso: c, score: scoreMatch(entrada.nombre, c.nombre_curso) }))
        .filter((x) => x.score >= SCORE_MINIMO))
        .sort((a, b) => b.score - a.score);

      if (!puntuados.length) {
        sinMatch.push(entrada);
        continue;
      }

      const mejor = puntuados[0];
      // Alias o score perfecto duplicado → actualizar todos los candidatos equivalentes.
      const destinos = porAlias
        ? puntuados
        : puntuados.filter((x) => x.score === 100);
      const listaDestino = destinos.length >= 1 && (porAlias || destinos.length > 1)
        ? (porAlias ? puntuados : destinos)
        : (() => {
            const exactos = puntuados.filter((x) => x.score === 100);
            if (exactos.length === 1) return exactos;
            if (exactos.length > 1) return exactos;
            const segundo = puntuados[1];
            if (
              segundo &&
              segundo.score >= 88 &&
              segundo.score >= mejor.score - 3 &&
              segundo.curso.curso_id !== mejor.curso.curso_id &&
              mejor.score < 100
            ) {
              ambiguos.push({
                entrada,
                candidatos: puntuados.slice(0, 3).map((x) => ({
                  id: x.curso.curso_id,
                  nombre: x.curso.nombre_curso,
                  score: x.score
                }))
              });
              return [];
            }
            return [mejor];
          })();

      if (!listaDestino.length) continue;

      for (const match of listaDestino) {
        const curso = match.curso;
        usados.add(curso.curso_id);
        const actual = String(curso.objetivo || '').trim();
        const nuevo = entrada.objetivo.trim();

        if (actual === nuevo) {
          sinCambio.push({ id: curso.curso_id, nombre: curso.nombre_curso, score: match.score });
          continue;
        }

        if (ES_PRODUCCION && !FORZAR && actual) {
          omitidosOcupados.push({
            id: curso.curso_id,
            nombre: curso.nombre_curso,
            score: match.score,
            actual: actual.slice(0, 90)
          });
          continue;
        }

        actualizados.push({
          id: curso.curso_id,
          nombre: curso.nombre_curso,
          archivo: entrada.nombre,
          score: match.score,
          antes: actual ? actual.slice(0, 80) : '(vacío)',
          despues: nuevo.slice(0, 80)
        });

        if (APPLY) {
          await pool.query(
            'UPDATE curso SET objetivo = ? WHERE curso_id = ? LIMIT 1',
            [nuevo, curso.curso_id]
          );
        }
      }
    }

    console.log(`\nCoincidencias a actualizar: ${actualizados.length}`);
    for (const row of actualizados) {
      console.log(`  [${row.score}] #${row.id} ${row.nombre}`);
      console.log(`      TXT: ${row.archivo}`);
      console.log(`      ANTES: ${row.antes}`);
      console.log(`      DESPUÉS: ${row.despues}...`);
    }

    if (sinCambio.length) {
      console.log(`\nYa tenían el mismo objetivo: ${sinCambio.length}`);
    }

    if (ambiguos.length) {
      console.log(`\nAmbiguos (no tocados): ${ambiguos.length}`);
      for (const a of ambiguos) {
        console.log(`  TXT: ${a.entrada.nombre}`);
        for (const c of a.candidatos) {
          console.log(`    [${c.score}] #${c.id} ${c.nombre}`);
        }
      }
    }

    if (omitidosOcupados.length) {
      console.log(`\nOmitidos (ya tenían objetivo; usa --forzar para sobrescribir): ${omitidosOcupados.length}`);
      for (const o of omitidosOcupados) {
        console.log(`  [${o.score}] #${o.id} ${o.nombre}`);
        console.log(`      ACTUAL: ${o.actual}`);
      }
    }
    if (sinMatch.length) {
      console.log(`\nSin match en BD: ${sinMatch.length}`);
      for (const s of sinMatch) {
        console.log(`  - ${s.nombre}`);
      }
    }

    const cursosSinObjetivo = cursos.filter((c) => !String(c.objetivo || '').trim());
    console.log(`\nCursos en BD sin objetivo (tras dry-run/apply): ${APPLY ? 'revisar BD' : cursosSinObjetivo.length}`);
    if (!APPLY) {
      const vaciosRestantes = cursosSinObjetivo.filter((c) => !actualizados.some((u) => u.id === c.curso_id));
      console.log(`Quedarían sin objetivo tras apply: ${vaciosRestantes.length}`);
      for (const c of vaciosRestantes.slice(0, 25)) {
        console.log(`  #${c.curso_id} ${c.nombre_curso}`);
      }
      if (vaciosRestantes.length > 25) {
        console.log(`  ... y ${vaciosRestantes.length - 25} más`);
      }
    }

    if (!APPLY) {
      console.log('\nDry-run listo.');
      if (ES_PRODUCCION) {
        console.log('  node backend/scripts/cargar-objetivos-cursos.js --produccion --apply');
      } else {
        console.log('  node backend/scripts/cargar-objetivos-cursos.js --apply');
      }
    } else {
      console.log(`\nListo. Actualizados en ${ES_PRODUCCION ? 'PRODUCCIÓN' : 'desarrollo'}: ${actualizados.length}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
