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

function normalizarPayload(body = {}) {
    const tipo = ['ats', 'factores', 'otro'].includes(String(body.tipo_encuesta || ''))
        ? String(body.tipo_encuesta)
        : 'factores';
    const resumen = body.resumen && typeof body.resumen === 'object' ? body.resumen : {};
    let detalle = body.detalle && typeof body.detalle === 'object' ? body.detalle : {};
    if (tipo === 'factores') {
        detalle = {
            niveles: detalle.niveles || NIVELES_RIESGO,
            rangos: detalle.rangos || RANGOS_CALIFICACION,
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
 * Interpreta un PDF (o texto ya extraído) y devuelve borrador editable.
 */
async function previsualizarImportacion({ buffer, mimetype, originalname, texto }) {
    let textoExtraido = String(texto || '').trim();
    const esPdf = /pdf/i.test(mimetype || '') || /\.pdf$/i.test(originalname || '');
    if (!textoExtraido && esPdf && buffer?.length) {
        textoExtraido = await extraerTextoPdf(buffer);
    }
    if (!textoExtraido && !esPdf) {
        return {
            ok: true,
            requiere_captura_manual: true,
            mensaje: 'La imagen se puede adjuntar; captura los indicadores manualmente o sube un PDF con texto seleccionable.',
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
                    personas: []
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
        catalogo: {
            niveles: NIVELES_RIESGO,
            rangos: RANGOS_CALIFICACION,
            reglas: REGLAS_ATS
        }
    };
}

function catalogoReferencia() {
    return { niveles: NIVELES_RIESGO, rangos: RANGOS_CALIFICACION, reglas: REGLAS_ATS };
}

function dashboardDesdeRegistros(registros) {
    const ats = (registros || []).filter((r) => r.tipo_encuesta === 'ats');
    const factores = (registros || []).filter((r) => r.tipo_encuesta === 'factores');
    const ultimoAts = ats[0] || null;
    const ultimoFactores = factores[0] || null;

    const distNiveles = { NULO: 0, BAJO: 0, MEDIO: 0, ALTO: 0, 'MUY ALTO': 0 };
    for (const r of factores) {
        const n = String(r.resumen?.nivel_riesgo || '').toUpperCase().replace(/\s+/g, ' ').trim();
        if (n && Object.prototype.hasOwnProperty.call(distNiveles, n)) {
            distNiveles[n] += 1;
        } else if (n === 'MUY ALTO' || n === 'MUY_ALTO') {
            distNiveles['MUY ALTO'] += 1;
        }
    }

    return {
        catalogo: catalogoReferencia(),
        ultimo_ats: ultimoAts,
        ultimo_factores: ultimoFactores,
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
    catalogoReferencia,
    dashboardDesdeRegistros,
    NIVELES_RIESGO,
    RANGOS_CALIFICACION,
    REGLAS_ATS
};
