const fs = require('fs');
const path = require('path');

const ESTRUCTURA_FILE_PATH = path.join(__dirname, '..', 'ESTRUCTURA_INFORME.md');

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'para', 'por', 'con', 'a', 'al', 'se', 'un', 'una'
]);

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function limpiarTextoLinea(valor) {
  return String(valor || '')
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarNombreCurso(valor) {
  let nombre = String(valor || '').trim();
  nombre = nombre.replace(/:+\s*$/, '');
  return nombre;
}

function esNombreCursoValido(valor) {
  const nombre = normalizarTexto(valor);
  if (!nombre) return false;
  if (nombre === 'curso sin nombre' || nombre === 'sin nombre') return false;
  return true;
}

function tokenizar(valor) {
  const normalizado = normalizarTexto(valor);
  if (!normalizado) return [];
  return normalizado
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function dedupeLista(lista) {
  const vistos = new Set();
  const resultado = [];

  for (const item of Array.isArray(lista) ? lista : []) {
    const limpio = limpiarTextoLinea(item);
    if (!limpio) continue;
    const key = normalizarTexto(limpio);
    if (!key || vistos.has(key)) continue;
    vistos.add(key);
    resultado.push(limpio);
  }

  return resultado;
}

function parsearEstructuraDesdeMarkdown() {
  if (!fs.existsSync(ESTRUCTURA_FILE_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(ESTRUCTURA_FILE_PATH, 'utf8');
  const lines = raw.replace(/\r/g, '').split('\n');
  const resultados = [];

  let actual = null;
  let modo = null;

  const cerrarActual = () => {
    if (!actual || !esNombreCursoValido(actual.nombreCurso)) return;

    const objetivos = dedupeLista(actual.objetivos);
    const expectativas = dedupeLista(actual.expectativas);

    if (objetivos.length === 0 && expectativas.length === 0) {
      return;
    }

    resultados.push({
      nombreCurso: normalizarNombreCurso(actual.nombreCurso),
      objetivos,
      expectativas,
      expectativasTexto: expectativas.join('\n')
    });
  };

  const nextNonEmpty = (startIndex) => {
    for (let j = startIndex + 1; j < lines.length; j += 1) {
      const candidate = String(lines[j] || '').trim();
      if (candidate) return candidate;
    }
    return '';
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;

    const siguiente = nextNonEmpty(i);
    if (siguiente && /^Objetivos?\s*:?[\s]*$/i.test(siguiente)) {
      cerrarActual();
      actual = {
        nombreCurso: normalizarNombreCurso(line),
        objetivos: [],
        expectativas: []
      };
      modo = null;
      continue;
    }

    if (/^Objetivos?\s*:?[\s]*$/i.test(line)) {
      modo = 'objetivos';
      continue;
    }

    if (/^Expectativas?\s*:?[\s]*$/i.test(line)) {
      modo = 'expectativas';
      continue;
    }

    if (!actual) {
      // Si no hay nombre de curso previo, ignoramos para evitar generar basura.
      continue;
    }

    const contenido = limpiarTextoLinea(line);
    if (!contenido) continue;

    if (modo === 'objetivos') {
      actual.objetivos.push(contenido);
    } else if (modo === 'expectativas') {
      actual.expectativas.push(contenido);
    }
  }

  cerrarActual();
  return resultados;
}

function consolidarCatalogo(entries) {
  const map = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const nombreCurso = normalizarNombreCurso(entry.nombreCurso);
    if (!esNombreCursoValido(nombreCurso)) continue;

    const key = normalizarTexto(nombreCurso);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        nombreCursoCanonico: nombreCurso,
        aliases: new Set([nombreCurso]),
        objetivos: [],
        expectativas: []
      });
    }

    const item = map.get(key);
    item.aliases.add(nombreCurso);
    item.objetivos.push(...(entry.objetivos || []));
    item.expectativas.push(...(entry.expectativas || []));
  }

  const catalogo = [];
  for (const item of map.values()) {
    const objetivos = dedupeLista(item.objetivos);
    const expectativas = dedupeLista(item.expectativas);

    catalogo.push({
      key: item.key,
      nombreCursoCanonico: item.nombreCursoCanonico,
      aliases: Array.from(item.aliases),
      objetivos,
      expectativas,
      expectativasTexto: expectativas.join('\n')
    });
  }

  return catalogo;
}

function calcularScoreMatch(nombreEntrada, catalogItem) {
  const entradaNorm = normalizarTexto(nombreEntrada);
  if (!entradaNorm) return { score: 0, matchType: 'none' };

  const aliasesNorm = [catalogItem.nombreCursoCanonico, ...(catalogItem.aliases || [])]
    .map((alias) => normalizarTexto(alias))
    .filter(Boolean);

  if (aliasesNorm.some((alias) => alias === entradaNorm)) {
    return { score: 100, matchType: 'exact' };
  }

  if (aliasesNorm.some((alias) => alias.includes(entradaNorm) || entradaNorm.includes(alias))) {
    return { score: 90, matchType: 'contains' };
  }

  const entradaTokens = tokenizar(nombreEntrada);
  if (entradaTokens.length === 0) {
    return { score: 0, matchType: 'none' };
  }

  let mejor = 0;
  for (const aliasNorm of aliasesNorm) {
    const aliasTokens = tokenizar(aliasNorm);
    if (aliasTokens.length === 0) continue;

    const setAlias = new Set(aliasTokens);
    const interseccion = entradaTokens.filter((t) => setAlias.has(t)).length;
    const denominador = Math.max(aliasTokens.length, entradaTokens.length);
    const ratio = denominador > 0 ? interseccion / denominador : 0;
    mejor = Math.max(mejor, ratio);
  }

  if (mejor >= 0.45) {
    return { score: Math.round(mejor * 100), matchType: 'token' };
  }

  return { score: Math.round(mejor * 100), matchType: 'none' };
}

function obtenerCatalogoEstructuraInforme() {
  const parsed = parsearEstructuraDesdeMarkdown();
  return consolidarCatalogo(parsed);
}

function buscarSugerenciaPorCurso(nombreCurso) {
  if (!esNombreCursoValido(nombreCurso)) {
    return {
      matched: false,
      reason: 'curso_sin_nombre',
      input: nombreCurso,
      estructura: null
    };
  }

  const catalogo = obtenerCatalogoEstructuraInforme();
  if (catalogo.length === 0) {
    return {
      matched: false,
      reason: 'catalogo_vacio',
      input: nombreCurso,
      estructura: null
    };
  }

  let mejorItem = null;
  let mejorScore = 0;
  let mejorTipo = 'none';

  for (const item of catalogo) {
    const { score, matchType } = calcularScoreMatch(nombreCurso, item);
    if (score > mejorScore) {
      mejorScore = score;
      mejorTipo = matchType;
      mejorItem = item;
    }
  }

  if (!mejorItem || mejorScore < 45 || mejorTipo === 'none') {
    return {
      matched: false,
      reason: 'sin_coincidencia',
      input: nombreCurso,
      bestScore: mejorScore,
      estructura: null
    };
  }

  return {
    matched: true,
    input: nombreCurso,
    matchedCurso: mejorItem.nombreCursoCanonico,
    matchType: mejorTipo,
    score: mejorScore,
    estructura: {
      nombreCurso: mejorItem.nombreCursoCanonico,
      objetivos: mejorItem.objetivos,
      expectativas: mejorItem.expectativas,
      expectativasTexto: mejorItem.expectativasTexto
    }
  };
}

module.exports = {
  obtenerCatalogoEstructuraInforme,
  buscarSugerenciaPorCurso,
  ESTRUCTURA_FILE_PATH
};
