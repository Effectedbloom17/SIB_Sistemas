/**
 * SGC · Dashboard de Calidad — agrega los indicadores del Cuadro de mando.
 *
 * Indicadores del panel:
 *   1. Eficacia de la capacitación — tasa de aprobación y calificación promedio
 *      (inscripciones evaluadas en cursos del año).
 *   2. Satisfacción del cliente — encuesta SGC-F-26 en Google Forms (en vivo).
 *   3. Quejas del cliente — registro manual en biznaga_sgc (sgc_queja_cliente).
 *   4. Evaluación de proveedores — calificaciones manuales (sgc_evaluacion_proveedor).
 *   5. Avance de proyectos — resumen del control de proyectos (SP-F-05).
 *   6. Eficacia del SGC — resultados de auditorías desde SGC-F-10
 *      (sgc_f10_historial + informe vigente).
 */
const googleFormsService = require('./googleFormsService');
const driveService = require('./driveService');
const sgcF14Service = require('./sgcF14Service');
const sgcF29Service = require('./sgcF29Service');
const sgcAthF08Service = require('./sgcAthF08Service');
const opinionesService = require('./opinionesService');
const { obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

/** Formulario fijo SGC-F-26 · Encuesta de Satisfacción del cliente. */
const SGC_SATISFACCION_CLIENTE_FORM_ID =
    process.env.SGC_SATISFACCION_CLIENTE_FORM_ID ||
    '1otY7kAA7Ko5CICg2-HwpdLjVEU5hsj6onUM-0NC5tDs';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function normalizar(texto = '') {
    return String(texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// Caché en memoria del dashboard por año (TTL corto) para acelerar recargas.
const CACHE_TTL_MS = 5 * 60 * 1000;
const dashboardCache = new Map(); // anio -> { ts, payload }

function invalidarCacheDashboard() {
    dashboardCache.clear();
}

// ---------------------------------------------------------------------------
// 2. Satisfacción del cliente (SGC-F-26 · Google Forms en vivo)
// ---------------------------------------------------------------------------

function indiceEscalaCuatro(obj) {
    const t = obj.total || 0;
    if (!t) return 0;
    return Math.round(
        (obj.excelente * 100 + obj.bueno * 75 + obj.regular * 50 + obj.malo * 25) / t
    );
}

function nuevaCeldaEscala() {
    return { excelente: 0, bueno: 0, regular: 0, malo: 0, total: 0 };
}

function registrarEscalaEnCelda(label, celda) {
    const n = normalizar(label);
    if (n.includes('excelente')) {
        celda.excelente += 1;
        celda.total += 1;
    } else if (n.includes('buen')) {
        celda.bueno += 1;
        celda.total += 1;
    } else if (n.includes('regular')) {
        celda.regular += 1;
        celda.total += 1;
    } else if (n.includes('mal') || n.includes('deficiente')) {
        celda.malo += 1;
        celda.total += 1;
    }
}

function esPreguntaEscalaSatisfaccion(pregunta) {
    if (!pregunta || pregunta.type !== 'choice') return false;
    const opts = (pregunta.options || []).map((o) => normalizar(o));
    return opts.some((o) => o.includes('excelente')) &&
        opts.some((o) => o.includes('buen') || o.includes('regular') || o.includes('mal'));
}

function esPreguntaServicio(pregunta) {
    if (!pregunta || pregunta.type !== 'choice') return false;
    const t = normalizar(pregunta.title);
    return t.includes('servicio') && t.includes('contrato');
}

function esPreguntaEmpresa(pregunta) {
    if (!pregunta || pregunta.type !== 'text') return false;
    return normalizar(pregunta.title).includes('empresa');
}

function esPreguntaComentario(pregunta) {
    if (!pregunta || pregunta.type !== 'text') return false;
    const t = normalizar(pregunta.title);
    return t.includes('comentario') || t.includes('mejorar');
}

function valoresRespuesta(answer) {
    return (answer?.textAnswers?.answers || [])
        .map((a) => (a?.value || '').trim())
        .filter(Boolean);
}

function construirPreguntasAgregadasForms(preguntasForm = [], responses = []) {
    const mapa = new Map();

    for (const pregunta of preguntasForm) {
        if (pregunta.type === 'choice') {
            mapa.set(pregunta.questionId, {
                question_id: pregunta.questionId,
                title: pregunta.title,
                type: 'choice',
                total_respuestas: 0,
                options: (pregunta.options || []).map((label) => ({ label, count: 0, percent: 0 }))
            });
        } else if (pregunta.type === 'text') {
            mapa.set(pregunta.questionId, {
                question_id: pregunta.questionId,
                title: pregunta.title,
                type: 'text',
                total_respuestas: 0,
                muestras_texto: []
            });
        }
    }

    for (const response of responses) {
        const answers = response?.answers || {};
        for (const [questionId, answer] of Object.entries(answers)) {
            if (!mapa.has(questionId)) continue;
            const pregunta = mapa.get(questionId);
            const valores = valoresRespuesta(answer);
            if (!valores.length) continue;

            pregunta.total_respuestas += 1;

            if (pregunta.type === 'choice') {
                for (const valor of valores) {
                    let opcion = pregunta.options.find((opt) => opt.label === valor);
                    if (!opcion) {
                        opcion = { label: valor, count: 0, percent: 0 };
                        pregunta.options.push(opcion);
                    }
                    opcion.count += 1;
                }
            } else {
                for (const valor of valores) {
                    if (pregunta.muestras_texto.length < 40) {
                        pregunta.muestras_texto.push(valor);
                    }
                }
            }
        }
    }

    for (const pregunta of mapa.values()) {
        if (pregunta.type !== 'choice') continue;
        const total = pregunta.total_respuestas || 1;
        pregunta.options = pregunta.options
            .map((opt) => ({ ...opt, percent: Math.round((opt.count / total) * 100) }))
            .sort((a, b) => b.count - a.count);
    }

    return Array.from(mapa.values());
}

function payloadSatisfaccionVacio(anioNum, extra = {}) {
    return {
        anio: anioNum,
        indiceAnual: 0,
        totalRespuestas: 0,
        empresas: 0,
        cursosConEncuesta: 0,
        recomiendaPct: 0,
        fuente: 'google_forms',
        formId: SGC_SATISFACCION_CLIENTE_FORM_ID,
        ultimaRespuesta: null,
        servicios: [],
        comentarios: [],
        preguntas: [],
        preguntasForm: [],
        respuestasLite: [],
        empresasLista: [],
        distribucion: { excelente: 0, bueno: 0, regular: 0, malo: 0, total: 0 },
        serieMensual: MESES_CORTOS.map((mes, i) => ({
            mes_num: i + 1,
            mes,
            indice: 0,
            respuestas: 0,
            recomienda_pct: 0
        })),
        ...extra
    };
}

/**
 * Índice de satisfacción del cliente (SGC-F-26) leído en vivo desde Google Forms.
 * Se filtra por año de envío; el dashboard cachea ~5 min para no saturar la API.
 */
async function obtenerSatisfaccionCurso(_pool, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();

    let formulario;
    try {
        formulario = await googleFormsService.obtenerFormularioConRespuestas(
            SGC_SATISFACCION_CLIENTE_FORM_ID
        );
    } catch (err) {
        console.warn(
            '[SGC] No se pudo leer la encuesta de satisfacción del cliente (Forms):',
            err.message || err
        );
        return payloadSatisfaccionVacio(anioNum, { error: err.message || String(err) });
    }

    const preguntas = formulario.preguntas || [];
    const preguntaEmpresa = preguntas.find(esPreguntaEmpresa) || null;
    const preguntaComentario = preguntas.find(esPreguntaComentario) ||
        preguntas.filter((p) => p.type === 'text' && !esPreguntaEmpresa(p)).pop() ||
        null;
    const preguntaServicio = preguntas.find(esPreguntaServicio) ||
        preguntas.find((p) => p.type === 'choice' && !esPreguntaEscalaSatisfaccion(p)) ||
        null;
    const preguntasEscala = preguntas.filter(esPreguntaEscalaSatisfaccion);

    const responsesAnio = (formulario.responses || []).filter((r) => {
        const ts = r.lastSubmittedTime || r.createTime;
        if (!ts) return false;
        const d = new Date(ts);
        return !Number.isNaN(d.getTime()) && d.getFullYear() === anioNum;
    });

    const meses = Array.from({ length: 12 }, () => ({
        evaluacion: nuevaCeldaEscala(),
        respuestas: 0
    }));
    const evaluacionAnual = nuevaCeldaEscala();
    const serviciosMap = new Map();
    const empresasMap = new Map(); // key normalizada -> nombre mostrado
    const comentarios = [];
    const respuestasLite = [];
    let ultimaRespuesta = null;

    const preguntasFormChoice = preguntas
        .filter((p) => p.type === 'choice')
        .map((p) => ({
            questionId: p.questionId,
            title: p.title,
            type: 'choice',
            options: p.options || []
        }));

    for (const response of responsesAnio) {
        const ts = response.lastSubmittedTime || response.createTime;
        if (ts && (!ultimaRespuesta || ts > ultimaRespuesta)) ultimaRespuesta = ts;

        const d = new Date(ts);
        const mesIdx = Number.isNaN(d.getTime()) ? 0 : d.getMonth();
        meses[mesIdx].respuestas += 1;

        const answers = response.answers || {};
        let empresaNombre = '';
        let servicioNombre = '';

        if (preguntaEmpresa) {
            const vals = valoresRespuesta(answers[preguntaEmpresa.questionId]);
            for (const v of vals) {
                const key = v.trim().toLowerCase();
                if (key && !empresasMap.has(key)) empresasMap.set(key, v.trim());
                if (!empresaNombre) empresaNombre = v.trim();
            }
        }

        if (preguntaServicio) {
            const vals = valoresRespuesta(answers[preguntaServicio.questionId]);
            for (const v of vals) {
                const prev = serviciosMap.get(v) || 0;
                serviciosMap.set(v, prev + 1);
                if (!servicioNombre) servicioNombre = v;
            }
        }

        if (preguntaComentario) {
            const vals = valoresRespuesta(answers[preguntaComentario.questionId]);
            for (const texto of vals) {
                if (!texto) continue;
                comentarios.push({
                    empresa: empresaNombre || 'Sin empresa',
                    servicio: servicioNombre || '',
                    texto,
                    fecha: formatearFechaIso(ts),
                    fechaIso: ts || null
                });
            }
        }

        for (const pregunta of preguntasEscala) {
            const vals = valoresRespuesta(answers[pregunta.questionId]);
            for (const v of vals) {
                registrarEscalaEnCelda(v, meses[mesIdx].evaluacion);
                registrarEscalaEnCelda(v, evaluacionAnual);
            }
        }

        const answersLite = {};
        for (const pregunta of preguntasFormChoice) {
            const vals = valoresRespuesta(answers[pregunta.questionId]);
            if (vals.length) answersLite[pregunta.questionId] = vals;
        }
        respuestasLite.push({
            mes_num: mesIdx + 1,
            empresa: empresaNombre || 'Sin empresa',
            answers: answersLite
        });
    }

    comentarios.sort((a, b) => String(b.fechaIso || '').localeCompare(String(a.fechaIso || '')));

    const totalServicios = Array.from(serviciosMap.values()).reduce((a, b) => a + b, 0) || 1;
    const servicios = Array.from(serviciosMap.entries())
        .map(([label, count]) => ({
            label,
            count,
            percent: Math.round((count / totalServicios) * 100)
        }))
        .sort((a, b) => b.count - a.count);

    // Completar opciones del formulario con count 0 (como en el resumen de Forms).
    if (preguntaServicio) {
        for (const opt of preguntaServicio.options || []) {
            if (!serviciosMap.has(opt)) {
                servicios.push({ label: opt, count: 0, percent: 0 });
            }
        }
    }

    const serieMensual = meses.map((m, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        indice: indiceEscalaCuatro(m.evaluacion),
        respuestas: m.respuestas,
        recomienda_pct: 0
    }));

    const empresasLista = Array.from(empresasMap.values())
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    const empresas = empresasLista.length || 0;
    const preguntasAgregadas = construirPreguntasAgregadasForms(preguntas, responsesAnio);

    return {
        anio: anioNum,
        indiceAnual: indiceEscalaCuatro(evaluacionAnual),
        totalRespuestas: responsesAnio.length,
        empresas,
        // Alias retrocompatible con KPI anterior ("cursos con datos")
        cursosConEncuesta: empresas,
        recomiendaPct: 0,
        fuente: 'google_forms',
        formId: SGC_SATISFACCION_CLIENTE_FORM_ID,
        formTitulo: formulario.info?.title || 'Encuesta de Satisfacción',
        ultimaRespuesta,
        servicios,
        comentarios,
        preguntas: preguntasAgregadas,
        preguntasForm: preguntasFormChoice,
        respuestasLite,
        empresasLista,
        distribucion: {
            excelente: evaluacionAnual.excelente,
            bueno: evaluacionAnual.bueno,
            regular: evaluacionAnual.regular,
            malo: evaluacionAnual.malo,
            total: evaluacionAnual.total
        },
        serieMensual
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return null;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    return d.toISOString().slice(0, 10);
}

function acumularEscalaCuatroCap(pregunta, target) {
    if (!pregunta || pregunta.type !== 'choice') return;
    for (const opt of pregunta.options || []) {
        const label = normalizar(opt.label);
        const count = Number(opt.count) || 0;
        if (label.includes('excelente')) target.excelente += count;
        else if (label.includes('buen')) target.bueno += count;
        else if (label.includes('regular')) target.regular += count;
        else if (label.includes('mal') || label.includes('deficiente')) target.malo += count;
    }
    target.total += Number(pregunta.total_respuestas) || 0;
}

function acumularSiNoCap(pregunta, target) {
    if (!pregunta || pregunta.type !== 'choice') return;
    for (const opt of pregunta.options || []) {
        const label = normalizar(opt.label);
        const count = Number(opt.count) || 0;
        if (label.includes('si')) target.si += count;
        else if (label.includes('no')) target.no += count;
    }
    target.total += Number(pregunta.total_respuestas) || 0;
}

function acumularOpcionesCap(pregunta, mapaOpciones) {
    if (!pregunta || pregunta.type !== 'choice') return;
    for (const opt of pregunta.options || []) {
        const label = String(opt.label || '').trim();
        if (!label) continue;
        const prev = mapaOpciones.get(label) || 0;
        mapaOpciones.set(label, prev + (Number(opt.count) || 0));
    }
}

function fusionarPreguntaCap(acumulado, pregunta, idx) {
    if (!pregunta) return;
    if (!acumulado[idx]) {
        acumulado[idx] = {
            indice: idx,
            title: pregunta.title || `Pregunta ${idx + 1}`,
            type: pregunta.type || 'choice',
            total_respuestas: 0,
            options: [],
            muestras_texto: []
        };
    }
    const dest = acumulado[idx];
    if (pregunta.title && (!dest.title || dest.title.startsWith('Pregunta '))) {
        dest.title = pregunta.title;
    }
    dest.total_respuestas += Number(pregunta.total_respuestas) || 0;

    if (pregunta.type === 'choice') {
        const mapa = new Map((dest.options || []).map((o) => [o.label, { ...o }]));
        for (const opt of pregunta.options || []) {
            const label = String(opt.label || '').trim();
            if (!label) continue;
            const prev = mapa.get(label) || { label, count: 0, percent: 0 };
            prev.count += Number(opt.count) || 0;
            mapa.set(label, prev);
        }
        dest.options = Array.from(mapa.values())
            .map((o) => ({ ...o, percent: 0 }))
            .sort((a, b) => b.count - a.count);
        const total = dest.total_respuestas || 1;
        dest.options = dest.options.map((o) => ({
            ...o,
            percent: Math.round((o.count / total) * 100)
        }));
    } else {
        for (const texto of pregunta.muestras_texto || []) {
            if (dest.muestras_texto.length < 40) {
                dest.muestras_texto.push(texto);
            }
        }
    }
}

function esPreguntaComentarioCap(pregunta) {
    if (!pregunta || pregunta.type !== 'text') return false;
    const t = normalizar(pregunta.title);
    return t.includes('comentario') || t.includes('mejorar');
}

function payloadSatisfaccionCapVacio(anioNum, extra = {}) {
    return {
        anio: anioNum,
        indiceAnual: 0,
        totalRespuestas: 0,
        cursosConEncuesta: 0,
        recomiendaPct: 0,
        fuente: 'encuestas_capacitacion',
        distribucion: { excelente: 0, bueno: 0, regular: 0, malo: 0, total: 0 },
        dimensiones: [],
        preguntas: [],
        preguntasPorMes: MESES_CORTOS.map((mes, i) => ({
            mes_num: i + 1,
            mes,
            totalRespuestas: 0,
            cursosConEncuesta: 0,
            preguntas: []
        })),
        comentarios: [],
        enfoques: [],
        serieMensual: MESES_CORTOS.map((mes, i) => ({
            mes_num: i + 1,
            mes,
            indice: 0,
            respuestas: 0,
            recomienda_pct: 0
        })),
        ...extra
    };
}

function esErrorArchivoAusenteDrive(err) {
    const codigo = Number(err?.code || err?.response?.status || 0);
    const msg = String(err?.message || '').toLowerCase();
    return codigo === 404
        || msg.includes('status code 404')
        || msg.includes('file not found')
        || msg.includes('not found');
}

async function obtenerStatsEncuestaCursoProgramado(row) {
    if (row.google_form_id) {
        try {
            return await googleFormsService.obtenerEstadisticasFormulario(row.google_form_id);
        } catch (err) {
            if (!esErrorArchivoAusenteDrive(err)) {
                console.warn(`[SGC] Encuesta live programado_id=${row.programado_id}:`, err.message || err);
            }
        }
    }

    if (row.encuesta_archivo_id) {
        try {
            const existe = await driveService.verificarArchivoExiste(row.encuesta_archivo_id);
            if (!existe) {
                return null;
            }
            const buffer = await driveService.descargarArchivo(row.encuesta_archivo_id);
            const metricas = JSON.parse(buffer.toString('utf8'));
            if (Array.isArray(metricas.preguntas) && metricas.preguntas.length) {
                return metricas;
            }
        } catch (err) {
            if (!esErrorArchivoAusenteDrive(err)) {
                console.warn(`[SGC] Encuesta archivada programado_id=${row.programado_id}:`, err.message || err);
            }
        }
    }

    return null;
}

/**
 * Satisfacción de cursos de capacitación (SP-F-14 · encuestas por curso programado).
 * Agrega formularios en vivo y JSON de cierre en Drive del año seleccionado.
 */
async function obtenerSatisfaccionCapacitacion(pool, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();

    const [cursos] = await pool.query(
        `SELECT cp.programado_id, cp.google_form_id, cp.fecha_inicio,
                c.nombre_curso, e.nombre_empresa,
                MAX(CASE WHEN dcp.descripcion = 'encuesta_resultados_cierre' THEN dcp.drive_file_id END) AS encuesta_archivo_id
         FROM curso_programado cp
         INNER JOIN curso c ON c.curso_id = cp.curso_id
         INNER JOIN empresa e ON e.empresa_id = cp.empresa_id
         LEFT JOIN documento_curso_programado dcp
           ON dcp.programado_id = cp.programado_id
          AND dcp.descripcion = 'encuesta_resultados_cierre'
          AND dcp.drive_file_id IS NOT NULL
         WHERE YEAR(cp.fecha_inicio) = ?
           AND (cp.google_form_id IS NOT NULL OR dcp.drive_file_id IS NOT NULL)
         GROUP BY cp.programado_id, cp.google_form_id, cp.fecha_inicio, c.nombre_curso, e.nombre_empresa
         ORDER BY cp.fecha_inicio DESC`,
        [anioNum]
    );

    if (!cursos.length) {
        return payloadSatisfaccionCapVacio(anioNum);
    }

    const evaluacionAnual = nuevaCeldaEscala();
    const pertinenciaAnual = nuevaCeldaEscala();
    const desempenoAnual = nuevaCeldaEscala();
    const dominioAnual = nuevaCeldaEscala();
    const recomendacionAnual = { si: 0, no: 0, total: 0 };
    const enfoquesMap = new Map();
    const preguntasAcum = [];
    const preguntasAcumPorMes = Array.from({ length: 12 }, () => []);
    const metaPorMes = Array.from({ length: 12 }, () => ({
        totalRespuestas: 0,
        cursosConEncuesta: 0
    }));
    const comentarios = [];
    const meses = Array.from({ length: 12 }, () => ({
        evaluacion: nuevaCeldaEscala(),
        recomendacion: { si: 0, no: 0, total: 0 },
        respuestas: 0
    }));

    let totalRespuestas = 0;
    let cursosConDatos = 0;

    for (const curso of cursos) {
        const stats = await obtenerStatsEncuestaCursoProgramado(curso);
        if (!stats || !Array.isArray(stats.preguntas) || stats.preguntas.length < 2) {
            continue;
        }

        const respuestasCurso = Number(stats.total_respuestas) || 0;
        if (respuestasCurso <= 0) continue;

        cursosConDatos += 1;
        totalRespuestas += respuestasCurso;

        const mesIdxRaw = new Date(curso.fecha_inicio).getMonth();
        const mesIdx = Number.isNaN(mesIdxRaw) ? 0 : mesIdxRaw;
        meses[mesIdx].respuestas += respuestasCurso;
        metaPorMes[mesIdx].totalRespuestas += respuestasCurso;
        metaPorMes[mesIdx].cursosConEncuesta += 1;

        const p0 = stats.preguntas[0];
        const p1 = stats.preguntas[1];
        const p2 = stats.preguntas[2];
        const p3 = stats.preguntas[3];
        const p4 = stats.preguntas[4];
        const p5 = stats.preguntas[5];
        const pComentario = stats.preguntas.find(esPreguntaComentarioCap)
            || stats.preguntas.filter((p) => p.type === 'text').pop()
            || null;

        acumularOpcionesCap(p0, enfoquesMap);
        acumularEscalaCuatroCap(p1, evaluacionAnual);
        acumularEscalaCuatroCap(p1, meses[mesIdx].evaluacion);
        acumularEscalaCuatroCap(p2, pertinenciaAnual);
        acumularEscalaCuatroCap(p3, desempenoAnual);
        acumularEscalaCuatroCap(p4, dominioAnual);
        acumularSiNoCap(p5, recomendacionAnual);
        acumularSiNoCap(p5, meses[mesIdx].recomendacion);

        for (let i = 0; i < stats.preguntas.length; i += 1) {
            fusionarPreguntaCap(preguntasAcum, stats.preguntas[i], i);
            fusionarPreguntaCap(preguntasAcumPorMes[mesIdx], stats.preguntas[i], i);
        }

        if (pComentario) {
            for (const texto of pComentario.muestras_texto || []) {
                if (!texto) continue;
                comentarios.push({
                    curso: curso.nombre_curso || 'Curso',
                    empresa: curso.nombre_empresa || 'Empresa',
                    texto,
                    fecha: formatearFechaIso(curso.fecha_inicio),
                    programado_id: curso.programado_id
                });
            }
        }
    }

    comentarios.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    const totalEnfoques = Array.from(enfoquesMap.values()).reduce((a, b) => a + b, 0) || 1;
    const enfoques = Array.from(enfoquesMap.entries())
        .map(([label, count]) => ({
            label,
            count,
            percent: Math.round((count / totalEnfoques) * 100)
        }))
        .sort((a, b) => b.count - a.count);

    const recomiendaPct = recomendacionAnual.total
        ? Math.round((recomendacionAnual.si / recomendacionAnual.total) * 100)
        : 0;

    const dimensiones = [
        {
            id: 'evaluacion',
            titulo: 'Evaluación general',
            indice: indiceEscalaCuatro(evaluacionAnual),
            escala: { ...evaluacionAnual }
        },
        {
            id: 'pertinencia',
            titulo: 'Pertinencia de temas',
            indice: indiceEscalaCuatro(pertinenciaAnual),
            escala: { ...pertinenciaAnual }
        },
        {
            id: 'desempeno',
            titulo: 'Desempeño instructor',
            indice: indiceEscalaCuatro(desempenoAnual),
            escala: { ...desempenoAnual }
        },
        {
            id: 'dominio',
            titulo: 'Dominio instructor',
            indice: indiceEscalaCuatro(dominioAnual),
            escala: { ...dominioAnual }
        },
        {
            id: 'recomendacion',
            titulo: 'Recomienda Biznaga',
            indice: recomiendaPct,
            tipo: 'si_no',
            si: recomendacionAnual.si,
            no: recomendacionAnual.no,
            total: recomendacionAnual.total
        }
    ];

    const serieMensual = meses.map((m, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        indice: indiceEscalaCuatro(m.evaluacion),
        respuestas: m.respuestas,
        recomienda_pct: m.recomendacion.total
            ? Math.round((m.recomendacion.si / m.recomendacion.total) * 100)
            : 0
    }));

    const preguntasPorMes = preguntasAcumPorMes.map((preguntasMes, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        totalRespuestas: metaPorMes[i].totalRespuestas,
        cursosConEncuesta: metaPorMes[i].cursosConEncuesta,
        preguntas: preguntasMes.filter(Boolean)
    }));

    return {
        anio: anioNum,
        indiceAnual: indiceEscalaCuatro(evaluacionAnual),
        totalRespuestas,
        cursosConEncuesta: cursosConDatos,
        recomiendaPct,
        fuente: 'encuestas_capacitacion',
        distribucion: {
            excelente: evaluacionAnual.excelente,
            bueno: evaluacionAnual.bueno,
            regular: evaluacionAnual.regular,
            malo: evaluacionAnual.malo,
            total: evaluacionAnual.total
        },
        dimensiones,
        preguntas: preguntasAcum.filter(Boolean),
        preguntasPorMes,
        comentarios,
        enfoques,
        serieMensual
    };
}

function promedioCalificacion(teorica, practica) {
    const t = teorica != null ? Number(teorica) : null;
    const p = practica != null ? Number(practica) : null;
    if (t != null && !Number.isNaN(t) && p != null && !Number.isNaN(p)) {
        return (t + p) / 2;
    }
    if (t != null && !Number.isNaN(t)) return t;
    if (p != null && !Number.isNaN(p)) return p;
    return null;
}

function tieneEvaluacion(row) {
    return row.calificacion_teorica != null || row.calificacion_practica != null || row.aprobado != null;
}

const NOTA_APROBATORIA = 8;

function esAprobadoPorCalificacion(row) {
    const prom = promedioCalificacion(row.calificacion_teorica, row.calificacion_practica);
    if (prom != null) return prom >= NOTA_APROBATORIA;
    return Number(row.aprobado) === 1;
}

// ---------------------------------------------------------------------------
// 1. Eficacia de la capacitación (inscripciones evaluadas del año)
// ---------------------------------------------------------------------------

async function obtenerEficaciaCapacitacion(pool, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();

    const [rows] = await pool.query(
        `SELECT
            MONTH(cp.fecha_inicio) AS mes_num,
            ic.aprobado,
            ic.calificacion_teorica,
            ic.calificacion_practica
         FROM inscripcion_curso ic
         INNER JOIN curso_programado cp ON cp.programado_id = ic.programado_id
         WHERE YEAR(cp.fecha_inicio) = ?
           AND ic.activo = 1`,
        [anioNum]
    );

    const meses = Array.from({ length: 12 }, (_, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        evaluados: 0,
        aprobados: 0,
        sumaCalificacion: 0,
        conCalificacion: 0
    }));

    let totalEvaluados = 0;
    let totalAprobados = 0;
    let sumaCalificacion = 0;
    let conCalificacion = 0;

    for (const row of rows) {
        if (!tieneEvaluacion(row)) continue;
        const idx = (Number(row.mes_num) || 1) - 1;
        if (idx < 0 || idx > 11) continue;

        totalEvaluados += 1;
        meses[idx].evaluados += 1;

        if (esAprobadoPorCalificacion(row)) {
            totalAprobados += 1;
            meses[idx].aprobados += 1;
        }

        const prom = promedioCalificacion(row.calificacion_teorica, row.calificacion_practica);
        if (prom != null) {
            sumaCalificacion += prom;
            conCalificacion += 1;
            meses[idx].sumaCalificacion += prom;
            meses[idx].conCalificacion += 1;
        }
    }

    const tasaAprobacion = totalEvaluados
        ? Math.round((totalAprobados / totalEvaluados) * 100)
        : 0;
    const promedioCalificacionAnual = conCalificacion
        ? Math.round((sumaCalificacion / conCalificacion) * 10) / 10
        : 0;

    const serieMensual = meses.map((m) => ({
        mes_num: m.mes_num,
        mes: m.mes,
        evaluados: m.evaluados,
        aprobados: m.aprobados,
        tasaAprobacion: m.evaluados ? Math.round((m.aprobados / m.evaluados) * 100) : 0,
        promedioCalificacion: m.conCalificacion
            ? Math.round((m.sumaCalificacion / m.conCalificacion) * 10) / 10
            : 0
    }));

    return {
        anio: anioNum,
        totalEvaluados,
        totalAprobados,
        tasaAprobacion,
        promedioCalificacion: promedioCalificacionAnual,
        notaAprobatoria: NOTA_APROBATORIA,
        serieMensual
    };
}

// ---------------------------------------------------------------------------
// 1b. Eficacia de la capacitación — formato ATH-F-08 (matriz A/NA)
// ---------------------------------------------------------------------------

function anioDeFechaIso(fecha) {
    const m = String(fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[1]) : null;
}

function mesDeFechaIso(fecha) {
    const m = String(fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[2]) : null;
}

/**
 * Calcula el indicador «Eficacia de la capacitación» a partir del formato
 * ATH-F-08: cada celda A/NA de la matriz colaborador × curso cuenta como
 * una evaluación (A = aprobada). Los cursos se agrupan por mes de su fecha.
 */
async function obtenerEficaciaCapacitacionAthF08(poolSgc, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();
    const base = {
        anio: anioNum,
        fuente: 'ATH-F-08',
        totalEvaluados: 0,
        totalAprobados: 0,
        tasaAprobacion: 0,
        totalColaboradores: 0,
        totalCursos: 0,
        serieMensual: MESES_CORTOS.map((mes, i) => ({
            mes_num: i + 1,
            mes,
            cursos: 0,
            evaluados: 0,
            aprobados: 0,
            tasaAprobacion: 0
        }))
    };

    let datos = null;
    try {
        const registro = await obtenerRegistroSgcPersistido(poolSgc, 'ATH-F-08');
        if (registro?.datos_json) {
            datos = sgcAthF08Service.sanitizarDatos(
                typeof registro.datos_json === 'string'
                    ? JSON.parse(registro.datos_json)
                    : registro.datos_json
            );
        }
    } catch (err) {
        console.warn('[SGC Dashboard] No se pudo leer ATH-F-08:', err.message);
    }
    if (!datos) return base;

    const cursosDelAnio = (datos.cursos || [])
        .map((curso, idx) => ({ ...curso, idx }))
        .filter((c) => !!String(c.nombre || '').trim())
        .filter((c) => {
            const anioCurso = anioDeFechaIso(c.fecha) || anioDeFechaIso(datos.fecha);
            return anioCurso === null ? anioNum === new Date().getFullYear() : anioCurso === anioNum;
        });
    if (!cursosDelAnio.length) return base;

    const colaboradores = (datos.colaboradores || [])
        .filter((c) => !!String(c?.nombre || '').trim());

    const serie = base.serieMensual.map((m) => ({ ...m }));
    let totalEvaluados = 0;
    let totalAprobados = 0;
    let totalCursosEvaluados = 0;

    for (const curso of cursosDelAnio) {
        const mes = mesDeFechaIso(curso.fecha) || mesDeFechaIso(datos.fecha);
        const celda = mes && mes >= 1 && mes <= 12 ? serie[mes - 1] : null;
        let evaluacionesCurso = 0;
        for (const col of colaboradores) {
            const r = String(col.resultados?.[curso.idx] || '').trim().toUpperCase();
            if (r !== 'A' && r !== 'NA') continue;
            evaluacionesCurso += 1;
            totalEvaluados += 1;
            if (celda) celda.evaluados += 1;
            if (r === 'A') {
                totalAprobados += 1;
                if (celda) celda.aprobados += 1;
            }
        }
        if (evaluacionesCurso > 0) {
            totalCursosEvaluados += 1;
            if (celda) celda.cursos += 1;
        }
    }

    for (const m of serie) {
        m.tasaAprobacion = m.evaluados ? Math.round((m.aprobados / m.evaluados) * 100) : 0;
    }

    return {
        ...base,
        totalEvaluados,
        totalAprobados,
        tasaAprobacion: totalEvaluados ? Math.round((totalAprobados / totalEvaluados) * 100) : 0,
        totalColaboradores: colaboradores.length,
        totalCursos: totalCursosEvaluados,
        serieMensual: serie
    };
}

// ---------------------------------------------------------------------------
// 6. Eficacia del SGC — resultados de auditorías (SGC-F-10)
// ---------------------------------------------------------------------------

async function asegurarTablaAuditorias(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_auditoria (
            auditoria_id INT AUTO_INCREMENT PRIMARY KEY,
            anio INT NOT NULL,
            fecha DATE NULL,
            titulo VARCHAR(255) NOT NULL,
            area VARCHAR(255) NULL,
            no_conformidades INT NOT NULL DEFAULT 0,
            observaciones TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sgc_auditoria_anio (anio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function nivelEficacia(noConformidades) {
    const nc = Number(noConformidades) || 0;
    if (nc <= 2) return { nivel: 'alto', etiqueta: 'Alto nivel de eficacia', score: 100 };
    if (nc <= 4) return { nivel: 'medio', etiqueta: 'Nivel medio de eficacia', score: 60 };
    return { nivel: 'bajo', etiqueta: 'Bajo nivel de eficacia', score: 25 };
}

function nivelQuejasAbiertas(abiertas) {
    const n = Number(abiertas) || 0;
    if (n <= 0) {
        return { nivel: 'alto', etiqueta: 'Óptimo · Sin quejas abiertas', score: 100 };
    }
    return { nivel: 'bajo', etiqueta: 'Requiere atención', score: 25 };
}

function formatearAuditoriaNoDash(raw) {
    const digitos = String(raw ?? '').replace(/\D/g, '');
    const num = Number(digitos);
    if (!Number.isFinite(num) || num <= 0) return '';
    return String(Math.trunc(num)).padStart(2, '0');
}

function hallazgoF10TieneContenido(h) {
    const desc = String(h?.descripcion || '');
    const plano = desc.includes('<')
        ? desc
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
            .replace(/<\/div>\s*<div[^>]*>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .trim()
        : desc.trim();
    return !!(
        plano
        || String(h?.clausula || '').trim()
        || String(h?.procesos || '').trim()
    );
}

function contadoresClasificacionF10(hallazgos) {
    const lista = Array.isArray(hallazgos) ? hallazgos : [];
    let totalOp = 0;
    let totalNcMenor = 0;
    let totalNcMayor = 0;
    for (const h of lista) {
        const c = String(h?.clasificacion || '').trim().toUpperCase().replace(/\s+/g, '_');
        if (c === 'OP' || c === 'OPORTUNIDAD' || c === 'OPORTUNIDAD_DE_MEJORA') totalOp += 1;
        else if (c === 'NC_MENOR' || c === 'NC-MENOR' || c === 'NCMENOR') totalNcMenor += 1;
        else if (c === 'NC_MAYOR' || c === 'NC-MAYOR' || c === 'NCMAYOR') totalNcMayor += 1;
    }
    return {
        totalHallazgos: lista.length,
        totalOp,
        totalNcMenor,
        totalNcMayor,
        totalNc: totalNcMenor + totalNcMayor
    };
}

function mapearAuditoriaDesdeF10({
    id,
    auditoriaNo,
    anio,
    fecha,
    fechasAuditoria,
    titulo,
    area,
    contadores,
    observaciones,
    cerrado,
    driveFileId,
    editorUrl,
    origen
}) {
    const nc = Number(contadores?.totalNc) || 0;
    const nivel = nivelEficacia(nc);
    return {
        auditoria_id: id,
        historialId: cerrado ? id : null,
        auditoriaNo: auditoriaNo || '',
        anio: Number(anio) || null,
        fecha: formatearFechaIso(fecha),
        fechasAuditoria: fechasAuditoria || '',
        titulo: titulo || `Auditoría Interna No. ${auditoriaNo || '—'}`,
        area: area || '',
        no_conformidades: nc,
        totalHallazgos: Number(contadores?.totalHallazgos) || 0,
        totalOp: Number(contadores?.totalOp) || 0,
        totalNcMenor: Number(contadores?.totalNcMenor) || 0,
        totalNcMayor: Number(contadores?.totalNcMayor) || 0,
        observaciones: observaciones || '',
        nivel: nivel.nivel,
        nivelEtiqueta: nivel.etiqueta,
        cerrado: !!cerrado,
        enCurso: !cerrado,
        fuente: 'SGC-F-10',
        origen: origen || (cerrado ? 'historico' : 'vigente'),
        driveFileId: driveFileId || null,
        editorUrl: editorUrl || null
    };
}

/**
 * Construye el indicador de eficacia desde SGC-F-10:
 * históricos cerrados (sgc_f10_historial) + informe vigente (si tiene contenido).
 * No se filtra por año: las auditorías son pocas y el histórico debe verse completo.
 */
async function obtenerEficacia(poolSgc, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();
    const sgcF10Service = require('./sgcF10Service');
    await sgcF10Service.asegurarTablaHistorialF10(poolSgc);

    const historial = await sgcF10Service.listarHistorial(poolSgc);
    const auditorias = [];

    for (const h of historial) {
        auditorias.push(mapearAuditoriaDesdeF10({
            id: h.id,
            auditoriaNo: h.auditoriaNo,
            anio: h.anio,
            fecha: h.fechaAuditoria,
            fechasAuditoria: h.fechasAuditoria,
            titulo: `Auditoría Interna No. ${h.auditoriaNo}`,
            area: h.ubicaciones || h.empresa || '',
            contadores: {
                totalHallazgos: h.totalHallazgos,
                totalOp: h.totalOp,
                totalNcMenor: h.totalNcMenor,
                totalNcMayor: h.totalNcMayor,
                totalNc: h.totalNc
            },
            observaciones: h.datos?.conclusiones
                ? String(h.datos.conclusiones).slice(0, 280)
                : `SGC-F-10 · ${h.totalHallazgos} hallazgos`,
            cerrado: true,
            driveFileId: h.driveFileId,
            editorUrl: h.editorUrl,
            origen: h.origen || 'historico'
        }));
    }

    // Informe vigente (borrador actual del formato)
    try {
        const registro = await obtenerRegistroSgcPersistido(poolSgc, 'SGC-F-10');
        let datos = null;
        if (registro?.datos_json) {
            datos = typeof registro.datos_json === 'string'
                ? JSON.parse(registro.datos_json)
                : registro.datos_json;
        }
        if (datos && typeof datos === 'object') {
            const auditoriaNo = formatearAuditoriaNoDash(datos.auditoriaNo);
            const yaCerrada = auditorias.some((a) => a.auditoriaNo === auditoriaNo);
            const hallazgos = Array.isArray(datos.hallazgos)
                ? datos.hallazgos.filter(hallazgoF10TieneContenido)
                : [];
            const tieneContenido = hallazgos.length > 0
                || String(datos.conclusiones || '').trim().length > 0;
            if (!yaCerrada && tieneContenido) {
                const contadores = contadoresClasificacionF10(hallazgos);
                const fecha = String(datos.fechasAuditoria || '').match(/\d{4}-\d{2}-\d{2}/)?.[0]
                    || (() => {
                        const m = String(datos.fechasAuditoria || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
                        if (!m) return formatearFechaIso(datos.fechaElaboracion) || null;
                        let y = m[3];
                        if (y.length === 2) y = `20${y}`;
                        return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
                    })();
                const anioVigente = fecha
                    ? Number(String(fecha).slice(0, 4))
                    : anioNum;
                auditorias.push(mapearAuditoriaDesdeF10({
                    id: 0,
                    auditoriaNo: auditoriaNo || '—',
                    anio: anioVigente,
                    fecha,
                    fechasAuditoria: datos.fechasAuditoria || '',
                    titulo: `Auditoría Interna No. ${auditoriaNo || '—'} (en curso)`,
                    area: datos.ubicaciones || datos.empresa || '',
                    contadores,
                    observaciones: 'Informe vigente en SGC-F-10 · aún no cerrado como histórico.',
                    cerrado: false,
                    driveFileId: registro?.drive_file_id || null,
                    editorUrl: registro?.drive_file_id
                        ? `https://docs.google.com/document/d/${registro.drive_file_id}/edit?usp=sharing`
                        : null,
                    origen: 'vigente'
                }));
            }
        }
    } catch (err) {
        console.warn('[SGC-DASH] No se pudo leer el SGC-F-10 vigente:', err.message);
    }

    auditorias.sort((a, b) => {
        // Vigente/en curso siempre primero (= última tomada).
        if (!!a.enCurso !== !!b.enCurso) {
            return a.enCurso ? -1 : 1;
        }
        const fa = a.fecha ? new Date(`${a.fecha}T00:00:00`).getTime() : 0;
        const fb = b.fecha ? new Date(`${b.fecha}T00:00:00`).getTime() : 0;
        if (fb !== fa) return fb - fa;
        const na = Number(String(a.auditoriaNo || '').replace(/\D/g, '')) || 0;
        const nb = Number(String(b.auditoriaNo || '').replace(/\D/g, '')) || 0;
        return nb - na;
    });

    const cerradas = auditorias.filter((a) => a.cerrado);
    const totalAuditorias = auditorias.length;
    const totalNoConformidades = cerradas.reduce((acc, a) => acc + (a.no_conformidades || 0), 0);
    const totalOp = cerradas.reduce((acc, a) => acc + (a.totalOp || 0), 0);
    const totalNcMenor = cerradas.reduce((acc, a) => acc + (a.totalNcMenor || 0), 0);
    const totalNcMayor = cerradas.reduce((acc, a) => acc + (a.totalNcMayor || 0), 0);
    const totalHallazgos = cerradas.reduce((acc, a) => acc + (a.totalHallazgos || 0), 0);
    const promedioNc = cerradas.length ? totalNoConformidades / cerradas.length : 0;

    // "NC actuales" = última auditoría tomada (vigente/en curso si existe; si no, la última cerrada).
    const actual = auditorias[0] || null;
    const nivelActual = actual ? nivelEficacia(actual.no_conformidades) : null;

    // Distribución de eficacia solo con cerradas (histórico tomado).
    const conteoNiveles = { alto: 0, medio: 0, bajo: 0 };
    cerradas.forEach((a) => { conteoNiveles[a.nivel] += 1; });

    const clasificacionActual = {
        op: actual ? Number(actual.totalOp) || 0 : 0,
        ncMenor: actual ? Number(actual.totalNcMenor) || 0 : 0,
        ncMayor: actual ? Number(actual.totalNcMayor) || 0 : 0
    };

    const delAnio = auditorias.filter((a) => Number(a.anio) === anioNum);

    return {
        anio: anioNum,
        fuente: 'SGC-F-10',
        totalAuditorias,
        totalCerradas: cerradas.length,
        totalAuditoriasAnio: delAnio.length,
        totalNoConformidades,
        totalHallazgos,
        totalOp,
        totalNcMenor,
        totalNcMayor,
        promedioNc: Math.round(promedioNc * 10) / 10,
        nivelActual: nivelActual ? nivelActual.nivel : null,
        nivelActualEtiqueta: nivelActual ? nivelActual.etiqueta : 'Sin auditorías en SGC-F-10',
        scoreActual: nivelActual ? nivelActual.score : 0,
        ncActual: actual ? actual.no_conformidades : null,
        auditoriaActualNo: actual?.auditoriaNo || null,
        auditoriaActualEnCurso: actual ? !!actual.enCurso : false,
        conteoNiveles,
        clasificacionActual,
        auditorias
    };
}

async function crearAuditoria(poolSgc, body = {}) {
    await asegurarTablaAuditorias(poolSgc);
    const titulo = String(body.titulo || '').trim();
    if (!titulo) {
        const err = new Error('El título de la auditoría es obligatorio.');
        err.statusCode = 400;
        throw err;
    }
    const fecha = formatearFechaIso(body.fecha);
    const anio = Number(body.anio) || (fecha ? Number(fecha.slice(0, 4)) : new Date().getFullYear());
    const area = String(body.area || '').trim() || null;
    const noConformidades = Math.max(0, Number(body.no_conformidades) || 0);
    const observaciones = String(body.observaciones || '').trim() || null;

    const [result] = await poolSgc.query(
        `INSERT INTO sgc_auditoria (anio, fecha, titulo, area, no_conformidades, observaciones)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [anio, fecha, titulo, area, noConformidades, observaciones]
    );
    invalidarCacheDashboard();
    return result.insertId;
}

async function eliminarAuditoria(poolSgc, auditoriaId) {
    await asegurarTablaAuditorias(poolSgc);
    const id = Number(auditoriaId);
    if (!id) {
        const err = new Error('Identificador de auditoría inválido.');
        err.statusCode = 400;
        throw err;
    }
    await poolSgc.query('DELETE FROM sgc_auditoria WHERE auditoria_id = ?', [id]);
    invalidarCacheDashboard();
}

const ETIQUETA_ESTADO_OPINION = {
    abierto: 'No realizado',
    en_progreso: 'En desarrollo',
    cerrado: 'Realizado'
};

function fechaIsoOpinion(valor) {
    const raw = String(valor || '').trim();
    if (!raw) return null;
    const iso = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/**
 * Resumen de Quejas y Sugerencias desde Opiniones y Sugerencias (`/quejas-sugerencias`).
 * Abiertas = no realizadas + en desarrollo. El óptimo (verde) es 0 pendientes.
 */
async function obtenerQuejasSugerencias(pool, anio) {
    const anioNum = Number(anio) || new Date().getFullYear();
    let registros = [];
    try {
        await opinionesService.asegurarTabla(pool);
        registros = await opinionesService.listar(pool);
    } catch (e) {
        registros = [];
    }

    const delAnio = (registros || []).filter((r) => {
        const fecha = fechaIsoOpinion(r?.created_at);
        if (!fecha) return true;
        return fecha.startsWith(String(anioNum));
    });

    const quejas = delAnio.map((r) => {
        const estado = String(r?.estado || '').trim().toLowerCase() || 'abierto';
        const abierta = estado !== 'cerrado';
        const tipo = String(r?.tipo || '').trim().toLowerCase() === 'sugerencia' ? 'Sugerencia' : 'Opinión';
        return {
            id: Number(r?.opinion_id) || 0,
            folio: String(r?.folio || '').trim(),
            fecha: fechaIsoOpinion(r?.created_at),
            empresa: String(r?.cliente || r?.autor_nombre || '').trim(),
            area: tipo,
            descripcion: String(r?.descripcion || '').trim(),
            fuente: tipo,
            estatus: ETIQUETA_ESTADO_OPINION[estado] || 'No realizado',
            estado,
            abierta
        };
    }).sort((a, b) => {
        const fa = a.fecha ? new Date(`${a.fecha}T00:00:00`).getTime() : 0;
        const fb = b.fecha ? new Date(`${b.fecha}T00:00:00`).getTime() : 0;
        return fb - fa;
    });

    const total = quejas.length;
    const abiertas = quejas.filter((q) => q.abierta).length;
    const cerradas = total - abiertas;
    const nivelActual = nivelQuejasAbiertas(abiertas);

    return {
        anio: anioNum,
        total,
        abiertas,
        cerradas,
        nivelActual: nivelActual.nivel,
        nivelActualEtiqueta: nivelActual.etiqueta,
        scoreActual: nivelActual.score,
        optimo: abiertas === 0,
        quejas
    };
}

// ---------------------------------------------------------------------------
// 3. Quejas del cliente (captura manual)
// ---------------------------------------------------------------------------

const ESTATUS_QUEJA = ['Abierta', 'En atención', 'Cerrada'];

async function asegurarTablaQuejas(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_queja_cliente (
            queja_id INT AUTO_INCREMENT PRIMARY KEY,
            anio INT NOT NULL,
            fecha DATE NULL,
            cliente VARCHAR(255) NOT NULL,
            descripcion TEXT NULL,
            estatus VARCHAR(40) NOT NULL DEFAULT 'Abierta',
            area VARCHAR(255) NULL,
            fecha_cierre DATE NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sgc_queja_anio (anio),
            INDEX idx_sgc_queja_estatus (estatus)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function normalizarEstatusQueja(valor) {
    const limpio = String(valor || '').trim();
    if (!limpio) return 'Abierta';
    const encontrado = ESTATUS_QUEJA.find((item) => normalizar(item) === normalizar(limpio));
    return encontrado || limpio;
}

async function obtenerQuejasCliente(poolSgc, anio) {
    await asegurarTablaQuejas(poolSgc);
    const anioNum = Number(anio) || new Date().getFullYear();

    const [rows] = await poolSgc.query(
        `SELECT queja_id, anio, fecha, cliente, descripcion, estatus, area, fecha_cierre, created_at
         FROM sgc_queja_cliente
         WHERE anio = ?
         ORDER BY (fecha IS NULL), fecha DESC, queja_id DESC`,
        [anioNum]
    );

    const quejas = rows.map((r) => ({
        queja_id: r.queja_id,
        anio: r.anio,
        fecha: formatearFechaIso(r.fecha),
        cliente: r.cliente,
        descripcion: r.descripcion || '',
        estatus: normalizarEstatusQueja(r.estatus),
        area: r.area || '',
        fecha_cierre: formatearFechaIso(r.fecha_cierre)
    }));

    const meses = Array.from({ length: 12 }, (_, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        total: 0,
        cerradas: 0
    }));

    let abiertas = 0;
    let enAtencion = 0;
    let cerradas = 0;

    for (const q of quejas) {
        const est = normalizar(q.estatus);
        if (est === 'cerrada') cerradas += 1;
        else if (est.includes('atencion')) enAtencion += 1;
        else abiertas += 1;

        if (!q.fecha) continue;
        const mes = Number(String(q.fecha).slice(5, 7));
        const idx = mes - 1;
        if (idx < 0 || idx > 11) continue;
        meses[idx].total += 1;
        if (est === 'cerrada') meses[idx].cerradas += 1;
    }

    const total = quejas.length;
    const pctAtendidas = total ? Math.round((cerradas / total) * 100) : 0;

    return {
        anio: anioNum,
        total,
        abiertas,
        enAtencion,
        cerradas,
        pctAtendidas,
        serieMensual: meses,
        quejas
    };
}

async function crearQuejaCliente(poolSgc, body = {}) {
    await asegurarTablaQuejas(poolSgc);
    const cliente = String(body.cliente || '').trim();
    if (!cliente) {
        const err = new Error('El nombre del cliente es obligatorio.');
        err.statusCode = 400;
        throw err;
    }
    const fecha = formatearFechaIso(body.fecha);
    const anio = Number(body.anio) || (fecha ? Number(fecha.slice(0, 4)) : new Date().getFullYear());
    const estatus = normalizarEstatusQueja(body.estatus);
    const fechaCierre = estatus === 'Cerrada' ? formatearFechaIso(body.fecha_cierre || body.fecha) : null;

    const [result] = await poolSgc.query(
        `INSERT INTO sgc_queja_cliente (anio, fecha, cliente, descripcion, estatus, area, fecha_cierre)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            anio,
            fecha,
            cliente,
            String(body.descripcion || '').trim() || null,
            estatus,
            String(body.area || '').trim() || null,
            fechaCierre
        ]
    );
    invalidarCacheDashboard();
    return result.insertId;
}

async function eliminarQuejaCliente(poolSgc, quejaId) {
    await asegurarTablaQuejas(poolSgc);
    const id = Number(quejaId);
    if (!id) {
        const err = new Error('Identificador de queja inválido.');
        err.statusCode = 400;
        throw err;
    }
    await poolSgc.query('DELETE FROM sgc_queja_cliente WHERE queja_id = ?', [id]);
    invalidarCacheDashboard();
}

// ---------------------------------------------------------------------------
// 4. Evaluación de proveedores (captura manual)
// ---------------------------------------------------------------------------

async function asegurarTablaEvaluacionProveedores(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS sgc_evaluacion_proveedor (
            evaluacion_id INT AUTO_INCREMENT PRIMARY KEY,
            anio INT NOT NULL,
            fecha DATE NULL,
            proveedor VARCHAR(255) NOT NULL,
            calificacion TINYINT UNSIGNED NOT NULL DEFAULT 0,
            observaciones TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sgc_eval_prov_anio (anio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function obtenerEvaluacionProveedores(poolSgc, anio) {
    await asegurarTablaEvaluacionProveedores(poolSgc);
    const anioNum = Number(anio) || new Date().getFullYear();

    const [rows] = await poolSgc.query(
        `SELECT evaluacion_id, anio, fecha, proveedor, calificacion, observaciones, created_at
         FROM sgc_evaluacion_proveedor
         WHERE anio = ?
         ORDER BY (fecha IS NULL), fecha DESC, evaluacion_id DESC`,
        [anioNum]
    );

    const evaluaciones = rows.map((r) => ({
        evaluacion_id: r.evaluacion_id,
        anio: r.anio,
        fecha: formatearFechaIso(r.fecha),
        proveedor: r.proveedor,
        calificacion: Math.min(100, Math.max(0, Number(r.calificacion) || 0)),
        observaciones: r.observaciones || ''
    }));

    const meses = Array.from({ length: 12 }, (_, i) => ({
        mes_num: i + 1,
        mes: MESES_CORTOS[i],
        total: 0,
        sumaCalificacion: 0
    }));

    let sumaCalificacion = 0;
    for (const ev of evaluaciones) {
        sumaCalificacion += ev.calificacion;
        if (!ev.fecha) continue;
        const mes = Number(String(ev.fecha).slice(5, 7));
        const idx = mes - 1;
        if (idx < 0 || idx > 11) continue;
        meses[idx].total += 1;
        meses[idx].sumaCalificacion += ev.calificacion;
    }

    const total = evaluaciones.length;
    const promedioCalificacion = total ? Math.round(sumaCalificacion / total) : 0;

    const serieMensual = meses.map((m) => ({
        mes_num: m.mes_num,
        mes: m.mes,
        total: m.total,
        promedio: m.total ? Math.round(m.sumaCalificacion / m.total) : 0
    }));

    return {
        anio: anioNum,
        total,
        promedioCalificacion,
        serieMensual,
        evaluaciones
    };
}

async function crearEvaluacionProveedor(poolSgc, body = {}) {
    await asegurarTablaEvaluacionProveedores(poolSgc);
    const proveedor = String(body.proveedor || '').trim();
    if (!proveedor) {
        const err = new Error('El nombre del proveedor es obligatorio.');
        err.statusCode = 400;
        throw err;
    }
    const fecha = formatearFechaIso(body.fecha);
    const anio = Number(body.anio) || (fecha ? Number(fecha.slice(0, 4)) : new Date().getFullYear());
    const calificacion = Math.min(100, Math.max(0, Number(body.calificacion) || 0));

    const [result] = await poolSgc.query(
        `INSERT INTO sgc_evaluacion_proveedor (anio, fecha, proveedor, calificacion, observaciones)
         VALUES (?, ?, ?, ?, ?)`,
        [
            anio,
            fecha,
            proveedor,
            calificacion,
            String(body.observaciones || '').trim() || null
        ]
    );
    invalidarCacheDashboard();
    return result.insertId;
}

async function eliminarEvaluacionProveedor(poolSgc, evaluacionId) {
    await asegurarTablaEvaluacionProveedores(poolSgc);
    const id = Number(evaluacionId);
    if (!id) {
        const err = new Error('Identificador de evaluación inválido.');
        err.statusCode = 400;
        throw err;
    }
    await poolSgc.query('DELETE FROM sgc_evaluacion_proveedor WHERE evaluacion_id = ?', [id]);
    invalidarCacheDashboard();
}

// ---------------------------------------------------------------------------
// 5. Avance de proyectos (SGC-F-14 — Bitácora de proyectos de mejora)
// ---------------------------------------------------------------------------

async function obtenerAvanceProyectos(poolSgc) {
    try {
        return await sgcF14Service.obtenerResumenMejora(poolSgc);
    } catch (e) {
        return {
            total: 0,
            concluidos: 0,
            enProceso: 0,
            noIniciados: 0,
            avancePromedio: 0,
            totalEnGrafico: 0,
            concluidosGrafico: 0,
            enProcesoGrafico: 0,
            porEstatus: { Concluido: 0, 'En proceso': 0, 'No iniciado': 0 },
            porPrioridad: {
                Inmediato: 0,
                'Mediano plazo': 0,
                'Largo plazo': 0
            },
            proyectos: []
        };
    }
}

// ---------------------------------------------------------------------------
// 5b. Evaluación de proveedores (SGC-F-29)
// ---------------------------------------------------------------------------

async function obtenerProveedoresF29(poolSgc) {
    try {
        return await sgcF29Service.obtenerResumenProveedores(poolSgc);
    } catch (e) {
        return {
            total: 0,
            promedioCalificacion: 0,
            aprobados: 0,
            reprobados: 0,
            periodoEvaluacion: '',
            fechaEvaluacion: '',
            criterios: { entregaTiempo: 0, precio: 0, servicio: 0, calidad: 0 },
            proveedores: []
        };
    }
}

// ---------------------------------------------------------------------------
// Dashboard consolidado
// ---------------------------------------------------------------------------

async function obtenerDashboard(pool, poolSgc, anio, opciones = {}) {
    const anioNum = Number(anio) || new Date().getFullYear();

    if (!opciones.forzarRecarga) {
        const cacheado = dashboardCache.get(anioNum);
        if (cacheado && (Date.now() - cacheado.ts) < CACHE_TTL_MS) {
            return { ...cacheado.payload, cache: true };
        }
    }

    const [
        eficaciaCapacitacion,
        satisfaccionCapacitacion,
        satisfaccionCurso,
        quejasCliente,
        evaluacionProveedores,
        avanceProyectos,
        proveedoresF29,
        eficacia,
        quejasSugerencias
    ] = await Promise.all([
        obtenerEficaciaCapacitacionAthF08(poolSgc, anioNum),
        obtenerSatisfaccionCapacitacion(pool, anioNum),
        obtenerSatisfaccionCurso(pool, anioNum),
        obtenerQuejasCliente(poolSgc, anioNum),
        obtenerEvaluacionProveedores(poolSgc, anioNum),
        obtenerAvanceProyectos(poolSgc),
        obtenerProveedoresF29(poolSgc),
        obtenerEficacia(poolSgc, anioNum),
        obtenerQuejasSugerencias(pool, anioNum)
    ]);

    const anioActual = new Date().getFullYear();
    const anios = [anioActual, anioActual - 1, anioActual - 2, anioActual - 3];
    if (!anios.includes(anioNum)) anios.unshift(anioNum);

    const payload = {
        anio: anioNum,
        anios,
        eficaciaCapacitacion,
        satisfaccionCapacitacion,
        satisfaccionCurso,
        quejasCliente,
        evaluacionProveedores,
        avanceProyectos,
        proveedoresF29,
        eficacia,
        quejasSugerencias,
        // Alias retrocompatible con el frontend anterior
        satisfaccion: satisfaccionCurso,
        mejoraContinua: avanceProyectos
    };

    dashboardCache.set(anioNum, { ts: Date.now(), payload });
    return payload;
}

module.exports = {
    obtenerDashboard,
    obtenerSatisfaccionCurso,
    obtenerSatisfaccionCapacitacion,
    obtenerSatisfaccionMensual: obtenerSatisfaccionCurso,
    obtenerEficaciaCapacitacion,
    obtenerEficaciaCapacitacionAthF08,
    obtenerQuejasCliente,
    crearQuejaCliente,
    eliminarQuejaCliente,
    obtenerEvaluacionProveedores,
    crearEvaluacionProveedor,
    eliminarEvaluacionProveedor,
    obtenerAvanceProyectos,
    obtenerProveedoresF29,
    obtenerEficacia,
    obtenerQuejasSugerencias,
    crearAuditoria,
    eliminarAuditoria,
    asegurarTablaAuditorias,
    invalidarCacheDashboard
};
