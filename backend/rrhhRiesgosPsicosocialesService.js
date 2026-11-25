/**
 * Recursos Humanos — Riesgos Psicosociales (NOM-035).
 * Persistencia estructurada + importación de reportes PDF/imagen.
 * Acceso previsto: solo superadministrador (root).
 */
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'rrhh-riesgos-psicosociales');

const NIVELES_RIESGO = [
    {
        clave: 'MUY_ALTO',
        etiqueta: 'MUY ALTO',
        color: '#dc2626',
        accion: 'Se requiere realizar el análisis de cada categoría y dominio para establecer las acciones de intervención apropiadas, mediante un Programa de intervención que deberá incluir evaluaciones específicas, y contemplar campañas de sensibilización, revisar la política de prevención de riesgos psicosociales y programas para la prevención de los factores de riesgo psicosocial, la promoción de un entorno organizacional favorable y la prevención de la violencia laboral, así como reforzar su aplicación y difusión, en su caso.'
    },
    {
        clave: 'ALTO',
        etiqueta: 'ALTO',
        color: '#ea580c',
        accion: 'Se requiere realizar un análisis de cada categoría y dominio, así como las acciones de intervención apropiadas a través de un Programa de intervención, que podrá incluir una evaluación específica y deberá incluir una campaña de sensibilización, revisar la política de prevención de riesgos psicosociales, programas para la prevención de los factores de riesgo psicosocial, la promoción de un entorno organizacional favorable y la prevención de la violencia laboral, así como reforzar su aplicación y difusión, en su caso.'
    },
    {
        clave: 'MEDIO',
        etiqueta: 'MEDIO',
        color: '#ca8a04',
        accion: 'Se requiere revisar la política de prevención de riesgos psicosociales y programas para la prevención de los factores de riesgo psicosocial, la promoción de un entorno organizacional favorable y la prevención de la violencia laboral, así como reforzar su aplicación y difusión, a través de programas de sensibilización.'
    },
    {
        clave: 'BAJO',
        etiqueta: 'BAJO',
        color: '#16a34a',
        accion: 'Es necesario una mayor difusión de la política de prevención de riesgos psicosociales y programas para la prevención de los factores de riesgo psicosocial, la promoción de un entorno organizacional favorable y la prevención de la violencia laboral.'
    },
    {
        clave: 'NULO',
        etiqueta: 'NULO',
        color: '#38bdf8',
        accion: 'El riesgo resulta despreciable por lo que no se requiere medidas adicionales.'
    }
];

const RANGOS_CALIFICACION = [
    { nivel: 'NULO', min: 0, max: 19.999 },
    { nivel: 'BAJO', min: 20, max: 44.999 },
    { nivel: 'MEDIO', min: 45, max: 69.999 },
    { nivel: 'ALTO', min: 70, max: 89.999 },
    { nivel: 'MUY ALTO', min: 90, max: null }
];

const REGLAS_ATS = [
    { seccion: 'I', texto: 'Si el resultado es SI en cualquiera de las preguntas, el trabajador requiere valoración clínica.' },
    { seccion: 'II', texto: 'Si el resultado es 1 o más, el trabajador requiere valoración clínica.' },
    { seccion: 'III', texto: 'Si el resultado es 3 o más, el trabajador requiere valoración clínica.' },
    { seccion: 'IV', texto: 'Si el resultado es 2 o más, el trabajador requiere valoración clínica.' }
];

function asegurarDirUpload() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

function txt(valor, maxLen = 500) {
    const s = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.slice(0, maxLen);
}

function sinAcentos(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function parseJsonSafe(raw, fallback) {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function nivelDesdeCalificacion(calificacion) {
    const n = Number(calificacion);
    if (!Number.isFinite(n)) return null;
    if (n < 20) return 'NULO';
    if (n < 45) return 'BAJO';
    if (n < 70) return 'MEDIO';
    if (n < 90) return 'ALTO';
    return 'MUY ALTO';
}

function colorNivel(etiqueta) {
    const key = sinAcentos(etiqueta).replace(/\s+/g, '_').toUpperCase();
    const map = {
        MUY_ALTO: '#dc2626',
        ALTO: '#ea580c',
        MEDIO: '#ca8a04',
        BAJO: '#16a34a',
        NULO: '#38bdf8'
    };
    return map[key] || '#64748b';
}

async function asegurarTabla(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS RRHH_riesgos_psicosociales (
            id INT AUTO_INCREMENT PRIMARY KEY,
            periodo VARCHAR(160) NOT NULL DEFAULT '',
            tipo_encuesta VARCHAR(40) NOT NULL DEFAULT 'factores',
            departamento VARCHAR(160) NOT NULL DEFAULT 'Todos',
            puesto VARCHAR(160) NOT NULL DEFAULT 'Todos',
            resumen_json JSON NULL,
            detalle_json JSON NULL,
            archivo_nombre VARCHAR(255) NULL,
            archivo_mime VARCHAR(120) NULL,
            archivo_path VARCHAR(500) NULL,
            texto_extraido MEDIUMTEXT NULL,
            notas VARCHAR(1000) NULL,
            creado_por VARCHAR(120) NULL,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_rrhh_rp_tipo (tipo_encuesta),
            INDEX idx_rrhh_rp_periodo (periodo),
            INDEX idx_rrhh_rp_creado (creado_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function extraerTextoPdf(buffer) {
    try {
        const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
        const doc = await pdfjs.getDocument({
            data: new Uint8Array(buffer),
            disableWorker: true,
            isEvalSupported: false
        }).promise;
        const partes = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
            const page = await doc.getPage(n);
            const contenido = await page.getTextContent();
            const linea = (contenido.items || [])
                .map((item) => String(item.str || '').trim())
                .filter(Boolean)
                .join(' ');
            if (linea) partes.push(linea);
        }
        return partes.join('\n').replace(/\s+/g, ' ').trim();
    } catch (err) {
        const e = new Error(`No se pudo leer el PDF: ${err.message}`);
        e.status = 422;
        throw e;
    }
}

function detectarTipoEncuesta(texto) {
    const t = sinAcentos(texto);
    if (t.includes('acontecimientos traumaticos') || t.includes('traumaticos severos') || /\bats\b/.test(t)) {
        return 'ats';
    }
    if (t.includes('factores de riesgo psicosocial') || t.includes('factores de riesgo')) {
        return 'factores';
    }
    return 'factores';
}

function capturarMeta(texto) {
    const periodo =
        texto.match(/Periodo\s*[:：]\s*([^\n|]+?)(?=\s+Encuesta\s*[:：]|\s+Departamento\s*[:：]|$)/i)?.[1] ||
        texto.match(/Periodo\s+([A-Za-zÁÉÍÓÚáéíóúñÑ0-9 ._-]{3,80})/i)?.[1] ||
        '';
    const encuesta =
        texto.match(/Encuesta\s*[:：]\s*([^\n|]+?)(?=\s+Departamento\s*[:：]|\s+Puesto\s*[:：]|$)/i)?.[1] ||
        '';
    const departamento =
        texto.match(/Departamento\s*[:：]\s*([^\n|]+?)(?=\s+Puesto\s*[:：]|$)/i)?.[1] ||
        'Todos';
    const puesto =
        texto.match(/Puesto\s*[:：]\s*([^\n|]+?)(?=\s+Resumen|\s+TOTAL|\s+NIVEL|$)/i)?.[1] ||
        'Todos';
    return {
        periodo: txt(periodo, 160) || 'Sin periodo',
        encuesta: txt(encuesta, 200),
        departamento: txt(departamento, 160) || 'Todos',
        puesto: txt(puesto, 160) || 'Todos'
    };
}

function etiquetaEncuestaLimpia(raw, fallback) {
    const s = txt(raw, 120);
    if (!s) return fallback;
    const cortado = s.split(/\b(TOTAL|REQUIEREN|SIN\s+RIESGO|NIVEL|PERSONAL|CALIFICACI|Resumen)\b/i)[0];
    const limpio = txt(cortado, 120);
    return limpio || fallback;
}

function parsearAts(texto) {
    const meta = capturarMeta(texto);
    const totalMatch = texto.match(/TOTAL\s+EVALUADOS[^\d]*(\d+)/i);
    const requierenMatch = texto.match(/REQUIEREN\s+ATENCI[OÓ]N[^\d]*(\d+)/i);
    const sinRiesgoMatch = texto.match(/SIN\s+RIESGO[^\d]*(\d+)/i);

    const total = totalMatch ? Number(totalMatch[1]) : null;
    const requieren = requierenMatch ? Number(requierenMatch[1]) : null;
    let sinRiesgo = sinRiesgoMatch ? Number(sinRiesgoMatch[1]) : null;
    if (sinRiesgo == null && total != null && requieren != null) {
        sinRiesgo = Math.max(0, total - requieren);
    }

    const personas = [];
    const filaRe = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .'-]{5,80})\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9 /().-]{8,120}?)\s+(SI|NO|\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(SI|NO)/gi;
    let m;
    while ((m = filaRe.exec(texto)) !== null) {
        personas.push({
            nombre: txt(m[1], 160),
            puesto_departamento: txt(m[2], 220),
            i: txt(m[3], 10),
            ii: Number(m[4]),
            iii: Number(m[5]),
            iv: Number(m[6]),
            requiere_atencion: sinAcentos(m[7]) === 'si'
        });
    }

    return {
        periodo: meta.periodo,
        tipo_encuesta: 'ats',
        departamento: meta.departamento,
        puesto: meta.puesto,
        resumen: {
            total_evaluados: total,
            requieren_atencion: requieren,
            sin_riesgo: sinRiesgo
        },
        detalle: {
            reglas: REGLAS_ATS,
            personas,
            encuesta_label: etiquetaEncuestaLimpia(meta.encuesta, 'Acontecimientos Traumáticos severos')
        }
    };
}

function parsearFactores(texto) {
    const meta = capturarMeta(texto);
    const nivelMatch = texto.match(/NIVEL\s+DE\s+RIESGO[^\n]*?\b(MUY\s+ALTO|ALTO|MEDIO|BAJO|NULO)\b/i)
        || texto.match(/\b(MUY\s+ALTO|ALTO|MEDIO|BAJO|NULO)\b[^\n]{0,40}NIVEL\s+DE\s+RIESGO/i);
    const personalMatch = texto.match(/PERSONAL\s+EVALUADO[^\d]*(\d+)/i)
        || texto.match(/Cantidad\s+de\s+Personal\s+Evaluado[^\d]*(\d+)/i);
    const califMatch = texto.match(/CALIFICACI[OÓ]N\s+PROMEDIO[^\d]*([\d]+(?:[.,]\d+)?)/i)
        || texto.match(/Nivel\s+de\s+riesgo\s+Promedio[^\d]*([\d]+(?:[.,]\d+)?)/i)
        || texto.match(/\b([\d]+[.,]\d{2})\b/);

    let calificacion = califMatch ? Number(String(califMatch[1]).replace(',', '.')) : null;
    let nivel = nivelMatch ? txt(nivelMatch[1].replace(/\s+/g, ' ').toUpperCase(), 20) : null;
    if (!nivel && calificacion != null) {
        nivel = nivelDesdeCalificacion(calificacion);
    }
    if (nivel && calificacion == null) {
        // sin calificación numérica: se deja null
    }

    const personal = personalMatch ? Number(personalMatch[1]) : null;

    return {
        periodo: meta.periodo,
        tipo_encuesta: 'factores',
        departamento: meta.departamento,
        puesto: meta.puesto,
        resumen: {
            nivel_riesgo: nivel,
            personal_evaluado: personal,
            calificacion_promedio: calificacion,
            color_nivel: colorNivel(nivel)
        },
        detalle: {
            niveles: NIVELES_RIESGO,
            rangos: RANGOS_CALIFICACION,
            resultado_final: {
                personal_evaluado: personal,
                nivel_riesgo_promedio: calificacion,
                calificacion_promedio: nivel
            },
            encuesta_label: etiquetaEncuestaLimpia(meta.encuesta, 'Factores De Riesgo Psicosocial')
        }
    };
}

function parsearTextoReporte(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio) {
        return {
            periodo: 'Sin periodo',
            tipo_encuesta: 'factores',
            departamento: 'Todos',
            puesto: 'Todos',
            resumen: {},
            detalle: { niveles: NIVELES_RIESGO, rangos: RANGOS_CALIFICACION, personas: [], reglas: REGLAS_ATS },
            confianza: 'baja'
        };
    }
    const tipo = detectarTipoEncuesta(limpio);
    const parsed = tipo === 'ats' ? parsearAts(limpio) : parsearFactores(limpio);
    const resumen = parsed.resumen || {};
    const tieneDatos = Object.values(resumen).some((v) => v != null && v !== '');
    return { ...parsed, confianza: tieneDatos ? 'media' : 'baja' };
}

function mapFila(row) {
    if (!row) return null;
    const resumen = parseJsonSafe(row.resumen_json, {});
    const detalle = parseJsonSafe(row.detalle_json, {});
    return {
        id: row.id,
        periodo: row.periodo,
        tipo_encuesta: row.tipo_encuesta,
        departamento: row.departamento,
        puesto: row.puesto,
        resumen,
        detalle,
        archivo_nombre: row.archivo_nombre,
        archivo_mime: row.archivo_mime,
        tiene_archivo: !!(row.archivo_path && fs.existsSync(row.archivo_path)),
        notas: row.notas,
        creado_por: row.creado_por,
        creado_en: row.creado_en,
        actualizado_en: row.actualizado_en
    };
}

async function listar(pool, { tipo } = {}) {
    await asegurarTabla(pool);
    const params = [];
    let where = '';
    if (tipo && ['ats', 'factores', 'otro'].includes(String(tipo))) {
        where = 'WHERE tipo_encuesta = ?';
        params.push(String(tipo));
    }
    const [rows] = await pool.query(
        `SELECT id, periodo, tipo_encuesta, departamento, puesto, resumen_json, detalle_json,
                archivo_nombre, archivo_mime, archivo_path, notas, creado_por, creado_en, actualizado_en
         FROM RRHH_riesgos_psicosociales
         ${where}
         ORDER BY creado_en DESC, id DESC`,
        params
    );
    return (rows || []).map(mapFila);
}

async function obtener(pool, id) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        `SELECT id, periodo, tipo_encuesta, departamento, puesto, resumen_json, detalle_json,
                archivo_nombre, archivo_mime, archivo_path, texto_extraido, notas, creado_por, creado_en, actualizado_en
         FROM RRHH_riesgos_psicosociales WHERE id = ? LIMIT 1`,
        [Number(id)]
    );
    const fila = mapFila(rows?.[0]);
    if (fila && rows[0]) {
        fila.texto_extraido = rows[0].texto_extraido || '';
    }
    return fila;
}

function normalizarNivelEtiqueta(raw) {
    const n = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (n === 'MUY ALTO' || n === 'MUY_ALTO') return 'MUY ALTO';
    if (['NULO', 'BAJO', 'MEDIO', 'ALTO'].includes(n)) return n;
    return '';
}

function construirGruposDesdePersonas(personas) {
    const map = new Map();
    for (const p of personas || []) {
        const depto = txt(p.departamento, 160) || 'Sin departamento';
        if (!map.has(depto)) {
            map.set(depto, { departamento: depto, personal: 0, suma: 0, niveles: {} });
        }
        const g = map.get(depto);
        const puntaje = Number(p.puntaje);
        g.personal += 1;
        if (Number.isFinite(puntaje)) g.suma += puntaje;
        const nivel = normalizarNivelEtiqueta(p.nivel_riesgo) || nivelDesdeCalificacion(puntaje) || 'NULO';
        g.niveles[nivel] = (g.niveles[nivel] || 0) + 1;
    }
    return Array.from(map.values())
        .map((g) => {
            const promedio = g.personal ? Math.round((g.suma / g.personal) * 100) / 100 : null;
            const nivel = nivelDesdeCalificacion(promedio) || 'NULO';
            return {
                departamento: g.departamento,
                personal: g.personal,
                promedio,
                nivel_riesgo: nivel,
                color_nivel: colorNivel(nivel),
                distribucion_niveles: g.niveles
            };
        })
        .sort((a, b) => String(a.departamento).localeCompare(String(b.departamento), 'es'));
}

function resumenDesdePersonas(personas) {
    const lista = Array.isArray(personas) ? personas : [];
    const dist = { NULO: 0, BAJO: 0, MEDIO: 0, ALTO: 0, 'MUY ALTO': 0 };
    let suma = 0;
    let conPuntaje = 0;
    for (const p of lista) {
        const puntaje = Number(p.puntaje);
        if (Number.isFinite(puntaje)) {
            suma += puntaje;
            conPuntaje += 1;
        }
        const nivel = normalizarNivelEtiqueta(p.nivel_riesgo) || nivelDesdeCalificacion(puntaje) || '';
        if (nivel && Object.prototype.hasOwnProperty.call(dist, nivel)) {
            dist[nivel] += 1;
        }
    }
    const promedio = conPuntaje ? Math.round((suma / conPuntaje) * 100) / 100 : null;
    const nivel = nivelDesdeCalificacion(promedio);
    return {
        personal_evaluado: lista.length,
        calificacion_promedio: promedio,
        nivel_riesgo: nivel,
        color_nivel: colorNivel(nivel),
        distribucion_niveles: dist
    };
}

function normalizarPayload(body = {}) {
    const tipo = ['ats', 'factores', 'otro'].includes(String(body.tipo_encuesta || ''))
        ? String(body.tipo_encuesta)
        : 'factores';
    const resumen = body.resumen && typeof body.resumen === 'object' ? { ...body.resumen } : {};
    let detalle = body.detalle && typeof body.detalle === 'object' ? { ...body.detalle } : {};
    if (tipo === 'factores') {
        const personas = Array.isArray(detalle.personas)
            ? detalle.personas.map((p) => {
                const puntaje = p.puntaje == null || p.puntaje === '' ? null : Number(p.puntaje);
                const nivel = normalizarNivelEtiqueta(p.nivel_riesgo)
                    || (Number.isFinite(puntaje) ? nivelDesdeCalificacion(puntaje) : '')
                    || '';
                return {
                    nombre: txt(p.nombre, 160),
                    puesto: txt(p.puesto, 160),
                    departamento: txt(p.departamento, 160),
                    puntaje: Number.isFinite(puntaje) ? puntaje : null,
                    nivel_riesgo: nivel,
                    color_nivel: colorNivel(nivel)
                };
            }).filter((p) => p.nombre)
            : [];
        const grupos = Array.isArray(detalle.grupos) && detalle.grupos.length
            ? detalle.grupos
            : construirGruposDesdePersonas(personas);
        const calc = personas.length ? resumenDesdePersonas(personas) : null;
        if (calc) {
            Object.assign(resumen, {
                personal_evaluado: resumen.personal_evaluado ?? calc.personal_evaluado,
                calificacion_promedio: resumen.calificacion_promedio ?? calc.calificacion_promedio,
                nivel_riesgo: resumen.nivel_riesgo || calc.nivel_riesgo,
                color_nivel: resumen.color_nivel || calc.color_nivel,
                distribucion_niveles: resumen.distribucion_niveles || calc.distribucion_niveles
            });
        }
        detalle = {
            niveles: detalle.niveles || NIVELES_RIESGO,
            rangos: detalle.rangos || RANGOS_CALIFICACION,
            personas,
            grupos,
            origen: detalle.origen || (personas.length ? 'excel' : 'manual'),
            resultado_final: detalle.resultado_final || {
                personal_evaluado: resumen.personal_evaluado ?? null,
                nivel_riesgo_promedio: resumen.calificacion_promedio ?? null,
                calificacion_promedio: resumen.nivel_riesgo ?? null
            },
            encuesta_label: detalle.encuesta_label || 'Factores De Riesgo Psicosocial'
        };
        if (resumen.nivel_riesgo && !resumen.color_nivel) {
            resumen.color_nivel = colorNivel(resumen.nivel_riesgo);
        }
    }
    if (tipo === 'ats') {
        detalle = {
            reglas: detalle.reglas || REGLAS_ATS,
            personas: Array.isArray(detalle.personas) ? detalle.personas : [],
            encuesta_label: detalle.encuesta_label || 'Acontecimientos Traumáticos severos'
        };
    }
    return {
        periodo: txt(body.periodo, 160) || 'Sin periodo',
        tipo_encuesta: tipo,
        departamento: txt(body.departamento, 160) || 'Todos',
        puesto: txt(body.puesto, 160) || 'Todos',
        resumen,
        detalle,
        notas: txt(body.notas, 1000) || null,
        texto_extraido: body.texto_extraido != null ? String(body.texto_extraido) : null
    };
}

function normalizarHeaderCelda(valor) {
    return sinAcentos(valor)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function mapearColumnasExcel(headers) {
    const idx = { nombre: -1, puesto: -1, departamento: -1, puntaje: -1, nivel: -1 };
    headers.forEach((h, i) => {
        const key = normalizarHeaderCelda(h);
        if (!key) return;
        if (idx.nombre < 0 && (key === 'nombre' || key.includes('nombre'))) idx.nombre = i;
        else if (idx.puesto < 0 && (key === 'puesto' || key.includes('puesto'))) idx.puesto = i;
        else if (idx.departamento < 0 && (key === 'departamento' || key.includes('departamento') || key.includes('area'))) idx.departamento = i;
        else if (idx.puntaje < 0 && (key.includes('puntaje') || key.includes('calificacion') || key.includes('score'))) idx.puntaje = i;
        else if (idx.nivel < 0 && ((key.includes('nivel') && key.includes('riesgo')) || key === 'nivel de riesgo' || key === 'nivel')) idx.nivel = i;
    });
    return idx;
}

async function parsearExcelConcentrado(buffer, originalname = '') {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
        const e = new Error('El Excel no tiene hojas');
        e.status = 422;
        throw e;
    }

    let headerRowNum = 1;
    let colMap = null;
    const maxScan = Math.min(15, sheet.rowCount || 15);
    for (let r = 1; r <= maxScan; r += 1) {
        const row = sheet.getRow(r);
        const headers = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            headers[colNumber - 1] = String(cell.value == null ? '' : (cell.text || cell.value));
        });
        const map = mapearColumnasExcel(headers);
        if (map.nombre >= 0 && (map.puntaje >= 0 || map.nivel >= 0)) {
            headerRowNum = r;
            colMap = map;
            break;
        }
    }
    if (!colMap) {
        const e = new Error('No se encontraron columnas Nombre / Puntaje / Nivel De Riesgo en el Excel');
        e.status = 422;
        throw e;
    }

    const personas = [];
    for (let r = headerRowNum + 1; r <= (sheet.rowCount || 0); r += 1) {
        const row = sheet.getRow(r);
        const cellVal = (idx) => {
            if (idx < 0) return '';
            const cell = row.getCell(idx + 1);
            if (cell.value == null) return '';
            if (typeof cell.value === 'object' && cell.value.result != null) return cell.value.result;
            if (typeof cell.value === 'object' && cell.value.text != null) return cell.value.text;
            return cell.value;
        };
        const nombre = txt(cellVal(colMap.nombre), 160);
        if (!nombre) continue;
        const puntajeRaw = cellVal(colMap.puntaje);
        const puntaje = puntajeRaw === '' || puntajeRaw == null ? null : Number(String(puntajeRaw).replace(',', '.'));
        let nivel = normalizarNivelEtiqueta(cellVal(colMap.nivel));
        if (!nivel && Number.isFinite(puntaje)) nivel = nivelDesdeCalificacion(puntaje);
        personas.push({
            nombre,
            puesto: txt(cellVal(colMap.puesto), 160),
            departamento: txt(cellVal(colMap.departamento), 160),
            puntaje: Number.isFinite(puntaje) ? puntaje : null,
            nivel_riesgo: nivel || '',
            color_nivel: colorNivel(nivel)
        });
    }

    if (!personas.length) {
        const e = new Error('El Excel no trae filas de personal evaluado');
        e.status = 422;
        throw e;
    }

    const resumen = resumenDesdePersonas(personas);
    const grupos = construirGruposDesdePersonas(personas);
    const baseName = String(originalname || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return {
        periodo: txt(baseName, 160) || `Concentrado ${new Date().toISOString().slice(0, 10)}`,
        tipo_encuesta: 'factores',
        departamento: 'Todos',
        puesto: 'Todos',
        resumen,
        detalle: {
            niveles: NIVELES_RIESGO,
            rangos: RANGOS_CALIFICACION,
            personas,
            grupos,
            origen: 'excel',
            resultado_final: {
                personal_evaluado: resumen.personal_evaluado,
                nivel_riesgo_promedio: resumen.calificacion_promedio,
                calificacion_promedio: resumen.nivel_riesgo
            },
            encuesta_label: 'Factores De Riesgo Psicosocial (concentrado)'
        },
        texto_extraido: `Excel ${personas.length} personas · promedio ${resumen.calificacion_promedio}`,
        confianza: 'alta'
    };
}

async function crear(pool, body, { usuario, archivo } = {}) {
    await asegurarTabla(pool);
    const data = normalizarPayload(body);
    let archivoNombre = null;
    let archivoMime = null;
    let archivoPath = null;

    if (archivo?.buffer?.length) {
        asegurarDirUpload();
        const safe = String(archivo.originalname || 'reporte.pdf').replace(/[^\w.\- ()áéíóúÁÉÍÓÚñÑ]+/g, '_').slice(0, 120);
        const stamp = Date.now();
        archivoNombre = safe;
        archivoMime = archivo.mimetype || 'application/octet-stream';
        archivoPath = path.join(UPLOAD_DIR, `${stamp}_${safe}`);
        fs.writeFileSync(archivoPath, archivo.buffer);
        if (!data.texto_extraido && (/pdf/i.test(archivoMime || '') || /\.pdf$/i.test(safe))) {
            try {
                data.texto_extraido = await extraerTextoPdf(archivo.buffer);
            } catch {
                /* se guarda sin texto */
            }
        }
    }

    const [result] = await pool.query(
        `INSERT INTO RRHH_riesgos_psicosociales
         (periodo, tipo_encuesta, departamento, puesto, resumen_json, detalle_json,
          archivo_nombre, archivo_mime, archivo_path, texto_extraido, notas, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.periodo,
            data.tipo_encuesta,
            data.departamento,
            data.puesto,
            JSON.stringify(data.resumen || {}),
            JSON.stringify(data.detalle || {}),
            archivoNombre,
            archivoMime,
            archivoPath,
            data.texto_extraido,
            data.notas,
            txt(usuario, 120) || null
        ]
    );
    return obtener(pool, result.insertId);
}

async function actualizar(pool, id, body) {
    await asegurarTabla(pool);
    const actual = await obtener(pool, id);
    if (!actual) {
        const e = new Error('Registro no encontrado');
        e.status = 404;
        throw e;
    }
    const data = normalizarPayload({ ...actual, ...body, resumen: body.resumen || actual.resumen, detalle: body.detalle || actual.detalle });
    await pool.query(
        `UPDATE RRHH_riesgos_psicosociales
         SET periodo = ?, tipo_encuesta = ?, departamento = ?, puesto = ?,
             resumen_json = ?, detalle_json = ?, notas = ?,
             texto_extraido = COALESCE(?, texto_extraido)
         WHERE id = ?`,
        [
            data.periodo,
            data.tipo_encuesta,
            data.departamento,
            data.puesto,
            JSON.stringify(data.resumen || {}),
            JSON.stringify(data.detalle || {}),
            data.notas,
            data.texto_extraido,
            Number(id)
        ]
    );
    return obtener(pool, id);
}

async function eliminar(pool, id) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        `SELECT archivo_path FROM RRHH_riesgos_psicosociales WHERE id = ? LIMIT 1`,
        [Number(id)]
    );
    const archivoPath = rows?.[0]?.archivo_path;
    const [result] = await pool.query(`DELETE FROM RRHH_riesgos_psicosociales WHERE id = ?`, [Number(id)]);
    if (archivoPath && fs.existsSync(archivoPath)) {
        try { fs.unlinkSync(archivoPath); } catch { /* ignore */ }
    }
    return { deleted: result.affectedRows > 0 };
}

async function obtenerArchivo(pool, id) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        `SELECT archivo_nombre, archivo_mime, archivo_path FROM RRHH_riesgos_psicosociales WHERE id = ? LIMIT 1`,
        [Number(id)]
    );
    const row = rows?.[0];
    if (!row?.archivo_path || !fs.existsSync(row.archivo_path)) {
        const e = new Error('Archivo no disponible');
        e.status = 404;
        throw e;
    }
    return {
        buffer: fs.readFileSync(row.archivo_path),
        mimeType: row.archivo_mime || 'application/octet-stream',
        nombre: row.archivo_nombre || 'reporte'
    };
}

/**
 * Interpreta Excel / PDF / imagen y devuelve borrador editable.
 */
async function previsualizarImportacion({ buffer, mimetype, originalname, texto }) {
    const name = String(originalname || '');
    const mime = String(mimetype || '');
    const esExcel = /sheet|excel|\.xlsx?$/i.test(mime + ' ' + name) || /\.xlsx?$/i.test(name);

    if (esExcel && buffer?.length) {
        const parsed = await parsearExcelConcentrado(buffer, name);
        return {
            ok: true,
            requiere_captura_manual: false,
            mensaje: `Se leyeron ${parsed.detalle.personas.length} personas del Excel. Revisa periodo e indicadores antes de guardar.`,
            borrador: parsed,
            catalogo: catalogoReferencia()
        };
    }

    let textoExtraido = String(texto || '').trim();
    const esPdf = /pdf/i.test(mime) || /\.pdf$/i.test(name);
    if (!textoExtraido && esPdf && buffer?.length) {
        textoExtraido = await extraerTextoPdf(buffer);
    }
    if (!textoExtraido && !esPdf) {
        return {
            ok: true,
            requiere_captura_manual: true,
            mensaje: 'La imagen se puede adjuntar; captura los indicadores manualmente o sube un Excel/PDF.',
            borrador: {
                periodo: 'Sin periodo',
                tipo_encuesta: 'factores',
                departamento: 'Todos',
                puesto: 'Todos',
                resumen: {},
                detalle: {
                    niveles: NIVELES_RIESGO,
                    rangos: RANGOS_CALIFICACION,
                    reglas: REGLAS_ATS,
                    personas: [],
                    grupos: []
                },
                texto_extraido: '',
                confianza: 'baja'
            }
        };
    }
    const parsed = parsearTextoReporte(textoExtraido);
    return {
        ok: true,
        requiere_captura_manual: parsed.confianza === 'baja',
        mensaje: parsed.confianza === 'baja'
            ? 'Se leyó el archivo, pero los indicadores no se reconocieron con claridad. Revísalos antes de guardar.'
            : 'Se extrajeron indicadores del reporte. Revisa y confirma antes de guardar.',
        borrador: {
            ...parsed,
            texto_extraido: textoExtraido
        },
        catalogo: catalogoReferencia()
    };
}

function catalogoReferencia() {
    return { niveles: NIVELES_RIESGO, rangos: RANGOS_CALIFICACION, reglas: REGLAS_ATS };
}

function enriquecerRegistroFactores(reg) {
    if (!reg || reg.tipo_encuesta !== 'factores') return reg;
    const personas = Array.isArray(reg.detalle?.personas) ? reg.detalle.personas : [];
    const grupos = Array.isArray(reg.detalle?.grupos) && reg.detalle.grupos.length
        ? reg.detalle.grupos
        : construirGruposDesdePersonas(personas);
    const distPersonas = resumenDesdePersonas(personas).distribucion_niveles;
    return {
        ...reg,
        detalle: {
            ...(reg.detalle || {}),
            personas,
            grupos
        },
        individuales: personas,
        grupales: grupos,
        distribucion_personas: distPersonas
    };
}

function dashboardDesdeRegistros(registros) {
    const ats = (registros || []).filter((r) => r.tipo_encuesta === 'ats');
    const factores = (registros || []).filter((r) => r.tipo_encuesta === 'factores');
    const ultimoAts = ats[0] || null;
    const ultimoFactoresRaw = factores[0] || null;
    const ultimoFactores = enriquecerRegistroFactores(ultimoFactoresRaw);

    const distNiveles = { NULO: 0, BAJO: 0, MEDIO: 0, ALTO: 0, 'MUY ALTO': 0 };
    for (const r of factores) {
        const n = normalizarNivelEtiqueta(r.resumen?.nivel_riesgo);
        if (n && Object.prototype.hasOwnProperty.call(distNiveles, n)) {
            distNiveles[n] += 1;
        }
    }

    const factoresAsc = [...factores].reverse();
    const comparativas = {
        periodos: factoresAsc.map((r) => ({
            id: r.id,
            periodo: r.periodo,
            creado_en: r.creado_en,
            personal_evaluado: r.resumen?.personal_evaluado ?? null,
            calificacion_promedio: r.resumen?.calificacion_promedio ?? null,
            nivel_riesgo: r.resumen?.nivel_riesgo ?? null,
            color_nivel: colorNivel(r.resumen?.nivel_riesgo)
        })),
        serie_promedio: factoresAsc.map((r) => Number(r.resumen?.calificacion_promedio) || 0),
        serie_personal: factoresAsc.map((r) => Number(r.resumen?.personal_evaluado) || 0),
        etiquetas: factoresAsc.map((r) => r.periodo || `ID ${r.id}`)
    };

    return {
        catalogo: catalogoReferencia(),
        ultimo_ats: ultimoAts,
        ultimo_factores: ultimoFactores,
        individuales: ultimoFactores?.individuales || [],
        grupales: ultimoFactores?.grupales || [],
        distribucion_personas: ultimoFactores?.distribucion_personas || distNiveles,
        comparativas,
        totales: {
            reportes: (registros || []).length,
            ats: ats.length,
            factores: factores.length
        },
        distribucion_niveles: distNiveles
    };
}

module.exports = {
    asegurarTabla,
    listar,
    obtener,
    crear,
    actualizar,
    eliminar,
    obtenerArchivo,
    previsualizarImportacion,
    parsearTextoReporte,
    parsearExcelConcentrado,
    catalogoReferencia,
    dashboardDesdeRegistros,
    construirGruposDesdePersonas,
    resumenDesdePersonas,
    NIVELES_RIESGO,
    RANGOS_CALIFICACION,
    REGLAS_ATS
};
