/**
 * SGC-F-14 · Cortes semestrales de avance de proyectos de mejora.
 *
 * Ciclo (año del folio / lanzamiento en agosto):
 *   - Semestre 1: corte a partir del 1 de febrero del año siguiente (6 meses).
 *   - Semestre 2: corte a partir del 1 de agosto del año siguiente (12 meses).
 *
 * El Sem1 congelado sirve de base comparativa; el Sem2 (corte o en vivo) muestra
 * el avance posterior. La UI pinta el delta en otro color en la barra.
 */
const sgcF14Service = require('./sgcF14Service');

const ESTATUS_VALIDOS = ['Concluido', 'En proceso', 'No iniciado'];

async function asegurarTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_f14_avance_semestre_corte (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            ciclo_anio INT NOT NULL,
            semestre TINYINT NOT NULL,
            fecha_corte DATE NOT NULL,
            total_proyectos INT NOT NULL DEFAULT 0,
            total_en_grafico INT NOT NULL DEFAULT 0,
            avance_promedio INT NOT NULL DEFAULT 0,
            concluidos INT NOT NULL DEFAULT 0,
            en_proceso INT NOT NULL DEFAULT 0,
            no_iniciados INT NOT NULL DEFAULT 0,
            concluidos_grafico INT NOT NULL DEFAULT 0,
            en_proceso_grafico INT NOT NULL DEFAULT 0,
            en_vivo TINYINT(1) NOT NULL DEFAULT 0,
            capturado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            capturado_por VARCHAR(128) NULL,
            UNIQUE KEY uq_sgc_f14_sem_corte (ciclo_anio, semestre),
            KEY idx_sgc_f14_sem_corte_anio (ciclo_anio)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_f14_avance_semestre (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            ciclo_anio INT NOT NULL,
            semestre TINYINT NOT NULL,
            folio VARCHAR(64) NOT NULL,
            proyecto_id VARCHAR(64) NULL,
            nombre_proyecto VARCHAR(512) NULL,
            responsable VARCHAR(255) NULL,
            prioridad VARCHAR(64) NULL,
            estatus VARCHAR(64) NULL,
            avance TINYINT UNSIGNED NOT NULL DEFAULT 0,
            fecha_corte DATE NOT NULL,
            capturado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            capturado_por VARCHAR(128) NULL,
            UNIQUE KEY uq_sgc_f14_sem_folio (ciclo_anio, semestre, folio),
            KEY idx_sgc_f14_sem_ciclo (ciclo_anio, semestre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function parsearAvanceNumerico(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return 0;
    let n = Number(crudo);
    if (!Number.isFinite(n)) return 0;
    if (n > 0 && n <= 1) n *= 100;
    n = Math.round(n);
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
}

function normalizarEstatus(estatus, avance) {
    const limpio = String(estatus || '').trim();
    if (limpio) {
        const encontrado = ESTATUS_VALIDOS.find((op) => op.toLowerCase() === limpio.toLowerCase());
        return encontrado || limpio;
    }
    const n = parsearAvanceNumerico(avance);
    if (n >= 100) return 'Concluido';
    if (n > 0) return 'En proceso';
    return 'No iniciado';
}

function cuentaEnGrafico(proyecto) {
    const estatus = normalizarEstatus(proyecto?.estatus, proyecto?.avance);
    if (estatus === 'No iniciado') return false;
    const avance = parsearAvanceNumerico(proyecto?.avance);
    return avance > 0 || estatus === 'Concluido';
}

function anioDesdeFolio(folio) {
    const texto = String(folio || '').trim();
    const match = texto.match(/^(?:PM|SP)-(\d{2})(\d{2})(\d{2})-\d+$/i);
    if (!match) return null;
    const yy = Number(match[3]);
    if (!Number.isFinite(yy)) return null;
    return 2000 + yy;
}

function fechaIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 1 feb del año siguiente al ciclo (fin del 1er semestre desde agosto). */
function fechaCorteSem1(cicloAnio) {
    return new Date(Number(cicloAnio) + 1, 1, 1);
}

/** 1 ago del año siguiente al ciclo (fin del 2do semestre). */
function fechaCorteSem2(cicloAnio) {
    return new Date(Number(cicloAnio) + 1, 7, 1);
}

function fechaCorteDeSemestre(cicloAnio, semestre) {
    return Number(semestre) === 1 ? fechaCorteSem1(cicloAnio) : fechaCorteSem2(cicloAnio);
}

function etiquetaSemestre(semestre, cicloAnio) {
    const anioCorte = Number(cicloAnio) + 1;
    if (Number(semestre) === 1) {
        return {
            clave: 's1',
            titulo: '1er semestre',
            rango: `Ago ${cicloAnio} – Feb ${anioCorte}`,
            corteLabel: `Febrero ${anioCorte}`
        };
    }
    return {
        clave: 's2',
        titulo: '2do semestre',
        rango: `Feb ${anioCorte} – Ago ${anioCorte}`,
        corteLabel: `Agosto ${anioCorte}`
    };
}

function puedeCapturarSemestre(cicloAnio, semestre, ahora = new Date()) {
    const corte = fechaCorteDeSemestre(cicloAnio, semestre);
    return ahora.getTime() >= corte.getTime();
}

function resumirLista(proyectos = []) {
    const lista = Array.isArray(proyectos) ? proyectos : [];
    const porEstatus = { Concluido: 0, 'En proceso': 0, 'No iniciado': 0 };
    const enGrafico = [];

    for (const p of lista) {
        const estatus = normalizarEstatus(p.estatus, p.avance);
        if (Object.prototype.hasOwnProperty.call(porEstatus, estatus)) {
            porEstatus[estatus] += 1;
        }
        if (cuentaEnGrafico(p)) enGrafico.push(p);
    }

    const suma = enGrafico.reduce((acc, p) => acc + parsearAvanceNumerico(p.avance), 0);
    const concluidosGrafico = enGrafico.filter(
        (p) => normalizarEstatus(p.estatus, p.avance) === 'Concluido'
    ).length;

    return {
        total: lista.length,
        totalEnGrafico: enGrafico.length,
        concluidos: porEstatus.Concluido,
        enProceso: porEstatus['En proceso'],
        noIniciados: porEstatus['No iniciado'],
        concluidosGrafico,
        enProcesoGrafico: enGrafico.length - concluidosGrafico,
        avancePromedio: enGrafico.length ? Math.round(suma / enGrafico.length) : 0,
        proyectos: lista
    };
}

async function obtenerProyectosVivosDelCiclo(pool, cicloAnio) {
    const resumen = await sgcF14Service.obtenerResumenMejora(pool);
    const anio = Number(cicloAnio);
    return (resumen?.proyectos || [])
        .filter((p) => anioDesdeFolio(p.folio) === anio)
        .map((p) => ({
            folio: String(p.folio || '').trim(),
            proyectoId: String(p.id || p.folio || '').trim().slice(0, 64) || null,
            nombreProyecto: String(p.nombreProyecto || '').trim(),
            responsable: String(p.responsable || '').trim(),
            prioridad: String(p.prioridad || '').trim(),
            estatus: normalizarEstatus(p.estatus, p.avance),
            avance: parsearAvanceNumerico(p.avance)
        }))
        .filter((p) => !!p.folio);
}

async function obtenerCorteMeta(pool, cicloAnio, semestre) {
    const [rows] = await pool.query(
        `SELECT ciclo_anio, semestre, fecha_corte, total_proyectos, total_en_grafico,
                avance_promedio, concluidos, en_proceso, no_iniciados,
                concluidos_grafico, en_proceso_grafico, en_vivo,
                capturado_en, capturado_por
           FROM sgc_f14_avance_semestre_corte
          WHERE ciclo_anio = ? AND semestre = ?
          LIMIT 1`,
        [Number(cicloAnio), Number(semestre)]
    );
    return rows?.[0] || null;
}

async function listarProyectosCorte(pool, cicloAnio, semestre) {
    const [rows] = await pool.query(
        `SELECT folio, proyecto_id, nombre_proyecto, responsable, prioridad, estatus, avance
           FROM sgc_f14_avance_semestre
          WHERE ciclo_anio = ? AND semestre = ?
          ORDER BY folio ASC`,
        [Number(cicloAnio), Number(semestre)]
    );
    return (rows || []).map((r) => ({
        folio: r.folio,
        proyectoId: r.proyecto_id || r.folio,
        nombreProyecto: r.nombre_proyecto || '',
        responsable: r.responsable || '',
        prioridad: r.prioridad || '',
        estatus: normalizarEstatus(r.estatus, r.avance),
        avance: parsearAvanceNumerico(r.avance)
    }));
}

async function construirLadoSemestre(pool, cicloAnio, semestre, opciones = {}) {
    const meta = etiquetaSemestre(semestre, cicloAnio);
    const puedeCapturar = puedeCapturarSemestre(cicloAnio, semestre, opciones.ahora);
    const corte = await obtenerCorteMeta(pool, cicloAnio, semestre);

    if (corte && !corte.en_vivo) {
        const proyectos = await listarProyectosCorte(pool, cicloAnio, semestre);
        const resumen = resumirLista(proyectos);
        return {
            ...meta,
            semestre: Number(semestre),
            disponible: true,
            congelado: true,
            enVivo: false,
            puedeCapturar,
            yaCapturado: true,
            fechaCorte: fechaIso(new Date(corte.fecha_corte)),
            capturadoEn: corte.capturado_en,
            capturadoPor: corte.capturado_por || null,
            ...resumen
        };
    }

    // Sem2 en curso: si ya hay Sem1 (o ya pasó el corte Sem1) y aún no hay corte Sem2,
    // mostrar avance vivo para la comparativa.
    if (Number(semestre) === 2 && opciones.permitirEnVivo) {
        const proyectos = opciones.proyectosVivos || [];
        const resumen = resumirLista(proyectos);
        return {
            ...meta,
            semestre: 2,
            disponible: proyectos.length > 0,
            congelado: false,
            enVivo: true,
            puedeCapturar,
            yaCapturado: false,
            fechaCorte: null,
            capturadoEn: null,
            capturadoPor: null,
            ...resumen
        };
    }

    return {
        ...meta,
        semestre: Number(semestre),
        disponible: false,
        congelado: false,
        enVivo: false,
        puedeCapturar,
        yaCapturado: false,
        fechaCorte: fechaIso(fechaCorteDeSemestre(cicloAnio, semestre)),
        capturadoEn: null,
        capturadoPor: null,
        total: 0,
        totalEnGrafico: 0,
        concluidos: 0,
        enProceso: 0,
        noIniciados: 0,
        concluidosGrafico: 0,
        enProcesoGrafico: 0,
        avancePromedio: 0,
        proyectos: []
    };
}

function mapearComparativaProyectos(s1, s2) {
    const porFolioS1 = new Map((s1.proyectos || []).map((p) => [String(p.folio).toUpperCase(), p]));
    const porFolioS2 = new Map((s2.proyectos || []).map((p) => [String(p.folio).toUpperCase(), p]));
    const folios = new Set([...porFolioS1.keys(), ...porFolioS2.keys()]);

    const proyectos = Array.from(folios).map((clave) => {
        const a = porFolioS1.get(clave);
        const b = porFolioS2.get(clave);
        const base = a || b;
        const avanceBase = a ? parsearAvanceNumerico(a.avance) : 0;
        const avanceActual = b ? parsearAvanceNumerico(b.avance) : avanceBase;
        const estatusBase = a ? a.estatus : null;
        const yaTerminadoEnBase = avanceBase >= 100
            || normalizarEstatus(estatusBase, avanceBase) === 'Concluido';
        // Si ya estaba al 100% en el corte base, no tiene sentido marcar "avance ganado".
        const deltaBruto = Math.max(0, avanceActual - avanceBase);
        const delta = yaTerminadoEnBase ? 0 : deltaBruto;
        const retroceso = Math.max(0, avanceBase - avanceActual);
        return {
            folio: base.folio,
            nombreProyecto: (b?.nombreProyecto || a?.nombreProyecto || '').trim(),
            responsable: (b?.responsable || a?.responsable || '').trim(),
            prioridad: (b?.prioridad || a?.prioridad || '').trim(),
            estatusBase,
            estatusActual: b ? b.estatus : (a?.estatus || null),
            avanceBase,
            avanceActual,
            delta,
            retroceso,
            yaTerminadoEnBase,
            huboAvance: delta > 0
        };
    }).sort((x, y) => String(x.folio).localeCompare(String(y.folio), 'es'));

    const conDelta = proyectos.filter((p) => p.huboAvance);
    const promedioDelta = conDelta.length
        ? Math.round(conDelta.reduce((acc, p) => acc + p.delta, 0) / conDelta.length)
        : 0;

    return {
        proyectos,
        totalConAvance: conDelta.length,
        promedioDelta
    };
}

function esEntornoLocal() {
    return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function simulacionLocalHabilitada() {
    if (!esEntornoLocal()) return false;
    return String(process.env.SGC_F14_SIMULAR_COMPARATIVA || '1') !== '0';
}

const CAPTURADO_POR_SIMULACION = 'simulacion-local';

function esCorteSimulado(meta) {
    return !!meta && String(meta.capturado_por || '') === CAPTURADO_POR_SIMULACION;
}

/** Semilla estable por folio para % “aleatorios” reproducibles entre recargas. */
function hashSeed(texto) {
    const s = String(texto || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function pctAleatorioEstable(clave, min, max) {
    const lo = Math.max(0, Number(min) || 0);
    const hi = Math.min(100, Number(max) || 100);
    if (hi <= lo) return lo;
    return lo + (hashSeed(clave) % (hi - lo + 1));
}

/**
 * Simulación demo:
 *  Sem1 → 1 proyecto en 0%, 2 en 100%, resto % aleatorio.
 *  Sem2 → el de 0% pasa a 100%; el resto sube o llega a 100%.
 */
function construirSimulacionSemestres(proyectosVivos = []) {
    const lista = [...(Array.isArray(proyectosVivos) ? proyectosVivos : [])]
        .filter((p) => p && p.folio)
        .sort((a, b) => String(a.folio).localeCompare(String(b.folio), 'es'));

    if (!lista.length) {
        return { sem1: [], sem2: [], folioCero: null };
    }

    const idxCero = hashSeed(`cero:${lista.map((p) => p.folio).join('|')}`) % lista.length;
    const candidatosCien = lista
        .map((_, i) => i)
        .filter((i) => i !== idxCero);
    const idxsCien = [];
    if (candidatosCien.length) {
        const primero = candidatosCien[hashSeed(`cien-a:${lista[0].folio}`) % candidatosCien.length];
        idxsCien.push(primero);
        const resto = candidatosCien.filter((i) => i !== primero);
        if (resto.length) {
            idxsCien.push(resto[hashSeed(`cien-b:${lista[0].folio}`) % resto.length]);
        }
    }
    const setCien = new Set(idxsCien);

    const sem1 = lista.map((p, i) => {
        let avance;
        if (i === idxCero) avance = 0;
        else if (setCien.has(i)) avance = 100;
        else avance = pctAleatorioEstable(`${p.folio}:s1`, 18, 72);
        return {
            ...p,
            avance,
            estatus: normalizarEstatus('', avance)
        };
    });

    const sem2 = lista.map((p, i) => {
        const base = sem1[i].avance;
        let avance;
        if (i === idxCero) {
            avance = 100;
        } else if (base >= 100) {
            avance = 100;
        } else {
            const decide = hashSeed(`${p.folio}:s2-modo`) % 5;
            if (decide <= 1) {
                avance = 100;
            } else {
                const bump = pctAleatorioEstable(`${p.folio}:s2-bump`, 18, 42);
                avance = Math.min(100, base + bump);
                if (avance <= base) avance = Math.min(100, base + 20);
            }
        }
        return {
            ...p,
            avance,
            estatus: normalizarEstatus('', avance)
        };
    });

    return {
        sem1,
        sem2,
        folioCero: lista[idxCero]?.folio || null
    };
}

async function asegurarSimulacionLocal(pool, cicloAnio, proyectosVivos) {
    if (!simulacionLocalHabilitada()) return { aplicada: false };
    if (!Array.isArray(proyectosVivos) || !proyectosVivos.length) {
        return { aplicada: false };
    }

    const meta1 = await obtenerCorteMeta(pool, cicloAnio, 1);
    const meta2 = await obtenerCorteMeta(pool, cicloAnio, 2);
    const hayCorteReal = (meta1 && !esCorteSimulado(meta1) && !meta1.en_vivo)
        || (meta2 && !esCorteSimulado(meta2) && !meta2.en_vivo);
    if (hayCorteReal) {
        return { aplicada: false, motivo: 'corte-real' };
    }

    const { sem1, sem2 } = construirSimulacionSemestres(proyectosVivos);
    const ahoraSem1 = fechaCorteSem1(cicloAnio);
    const ahoraSem2 = fechaCorteSem2(cicloAnio);

    await capturarCorte(pool, cicloAnio, 1, {
        forzar: true,
        capturadoPor: CAPTURADO_POR_SIMULACION,
        proyectosVivos: sem1,
        ahora: ahoraSem1,
        omitirRespuestaComparativa: true
    });
    await capturarCorte(pool, cicloAnio, 2, {
        forzar: true,
        capturadoPor: CAPTURADO_POR_SIMULACION,
        proyectosVivos: sem2,
        ahora: ahoraSem2,
        omitirRespuestaComparativa: true
    });

    return { aplicada: true };
}

async function obtenerComparativa(pool, cicloAnioRaw, opciones = {}) {
    await asegurarTablas(pool);
    const cicloAnio = Number(cicloAnioRaw) || new Date().getFullYear();
    const ahora = opciones.ahora || new Date();
    const proyectosVivos = await obtenerProyectosVivosDelCiclo(pool, cicloAnio);

    let simulacion = { aplicada: false };
    if (opciones.simular !== false) {
        try {
            simulacion = await asegurarSimulacionLocal(pool, cicloAnio, proyectosVivos);
        } catch (err) {
            console.warn('[SGC-F-14 semestre] Simulación local no aplicada:', err.message);
        }
    }

    // Auto-captura opcional del semestre vencido (solo si aún no existe corte).
    if (opciones.autoCapturar !== false && !simulacion.aplicada) {
        for (const sem of [1, 2]) {
            if (!puedeCapturarSemestre(cicloAnio, sem, ahora)) continue;
            const existente = await obtenerCorteMeta(pool, cicloAnio, sem);
            if (existente && !existente.en_vivo) continue;
            if (!proyectosVivos.length) continue;
            try {
                await capturarCorte(pool, cicloAnio, sem, {
                    forzar: false,
                    capturadoPor: opciones.capturadoPor || 'sistema',
                    proyectosVivos,
                    ahora,
                    omitirRespuestaComparativa: true
                });
            } catch (err) {
                console.warn(`[SGC-F-14 semestre] Auto-captura S${sem} ciclo ${cicloAnio}:`, err.message);
            }
        }
    }

    // Con simulación local usamos fechas de corte 2027 para que los lados lean los snapshots.
    const ahoraLectura = simulacion.aplicada ? fechaCorteSem2(cicloAnio) : ahora;

    const s1 = await construirLadoSemestre(pool, cicloAnio, 1, {
        ahora: ahoraLectura,
        proyectosVivos
    });
    const s2 = await construirLadoSemestre(pool, cicloAnio, 2, {
        ahora: ahoraLectura,
        proyectosVivos,
        permitirEnVivo: true
    });

    if (!s1.yaCapturado && s2.enVivo) {
        s2.titulo = 'Avance actual';
        s2.rango = `Desde ago ${cicloAnio}`;
        s2.preCorte = true;
    }

    const meta1 = await obtenerCorteMeta(pool, cicloAnio, 1);
    const meta2 = await obtenerCorteMeta(pool, cicloAnio, 2);
    const esSimulacion = esCorteSimulado(meta1) || esCorteSimulado(meta2);
    if (esSimulacion) {
        s1.simulacion = true;
        s2.simulacion = true;
    }

    const comparativa = mapearComparativaProyectos(s1, s2);
    // Sin Sem1 congelado no hay base real: no pintar "avance ganado".
    if (!s1.yaCapturado) {
        for (const p of comparativa.proyectos) {
            p.avanceBase = p.avanceActual;
            p.delta = 0;
            p.retroceso = 0;
            p.huboAvance = false;
            p.yaTerminadoEnBase = (p.avanceActual || 0) >= 100;
            p.estatusBase = p.estatusActual;
        }
        comparativa.totalConAvance = 0;
        comparativa.promedioDelta = 0;
    }

    const promedioActual = s2.disponible ? s2.avancePromedio : s1.avancePromedio;

    return {
        cicloAnio,
        lanzamientoLabel: `Agosto ${cicloAnio}`,
        simulacionLocal: esSimulacion,
        s1,
        s2,
        ...comparativa,
        avancePromedioActual: promedioActual,
        deltaPromedio: s1.yaCapturado && s2.disponible
            ? Math.max(0, (s2.avancePromedio || 0) - (s1.avancePromedio || 0))
            : 0,
        mensaje: construirMensajeEstado(cicloAnio, s1, s2, esSimulacion)
    };
}

function construirMensajeEstado(cicloAnio, s1, s2, esSimulacion = false) {
    if (esSimulacion) {
        return `Simulación local · ciclo ${cicloAnio}: corte feb ${cicloAnio + 1} vs ago ${cicloAnio + 1}. Los concluidos al 100% no marcan avance ganado.`;
    }
    if (!s1.yaCapturado && !s1.puedeCapturar) {
        return `Los proyectos de ${cicloAnio} se lanzaron en agosto. El 1er corte comparativo se guardará en ${s1.corteLabel}.`;
    }
    if (!s1.yaCapturado && s1.puedeCapturar) {
        return `Ya corresponde el corte del 1er semestre (${s1.corteLabel}). Guarda el avance para habilitar la comparativa.`;
    }
    if (s1.yaCapturado && s2.enVivo) {
        return `1er semestre congelado (${s1.corteLabel}). El 2do semestre muestra el avance en curso hasta el corte de ${s2.corteLabel}.`;
    }
    if (s1.yaCapturado && s2.yaCapturado) {
        return `Comparativa completa del ciclo ${cicloAnio}: ${s1.corteLabel} vs ${s2.corteLabel}.`;
    }
    if (s1.yaCapturado && !s2.puedeCapturar) {
        return `1er semestre capturado. El 2do corte estará disponible en ${s2.corteLabel}.`;
    }
    return `Comparativa semestral del ciclo ${cicloAnio}.`;
}

async function capturarCorte(pool, cicloAnioRaw, semestreRaw, opciones = {}) {
    await asegurarTablas(pool);
    const cicloAnio = Number(cicloAnioRaw);
    const semestre = Number(semestreRaw);
    if (!Number.isFinite(cicloAnio) || cicloAnio < 2000 || cicloAnio > 2100) {
        const err = new Error('Ciclo de año inválido.');
        err.status = 400;
        throw err;
    }
    if (semestre !== 1 && semestre !== 2) {
        const err = new Error('El semestre debe ser 1 o 2.');
        err.status = 400;
        throw err;
    }

    const ahora = opciones.ahora || new Date();
    if (!opciones.forzar && !puedeCapturarSemestre(cicloAnio, semestre, ahora)) {
        const meta = etiquetaSemestre(semestre, cicloAnio);
        const err = new Error(`Aún no corresponde el corte de ${meta.titulo} (disponible desde ${meta.corteLabel}).`);
        err.status = 400;
        throw err;
    }

    const existente = await obtenerCorteMeta(pool, cicloAnio, semestre);
    if (existente && !existente.en_vivo && !opciones.forzar) {
        if (opciones.omitirRespuestaComparativa) {
            return { yaExistia: true, cicloAnio, semestre };
        }
        return {
            yaExistia: true,
            cicloAnio,
            semestre,
            comparativa: await obtenerComparativa(pool, cicloAnio, {
                autoCapturar: false,
                simular: false,
                ahora
            })
        };
    }

    const proyectos = Array.isArray(opciones.proyectosVivos) && opciones.proyectosVivos.length
        ? opciones.proyectosVivos
        : await obtenerProyectosVivosDelCiclo(pool, cicloAnio);

    if (!proyectos.length) {
        const err = new Error(`No hay proyectos del ciclo ${cicloAnio} para capturar.`);
        err.status = 400;
        throw err;
    }

    const resumen = resumirLista(proyectos);
    const fechaCorte = fechaIso(fechaCorteDeSemestre(cicloAnio, semestre));
    const capturadoPor = String(opciones.capturadoPor || 'sistema').trim().slice(0, 128) || 'sistema';

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `DELETE FROM sgc_f14_avance_semestre WHERE ciclo_anio = ? AND semestre = ?`,
            [cicloAnio, semestre]
        );

        for (const p of proyectos) {
            await conn.query(
                `INSERT INTO sgc_f14_avance_semestre
                    (ciclo_anio, semestre, folio, proyecto_id, nombre_proyecto, responsable,
                     prioridad, estatus, avance, fecha_corte, capturado_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    cicloAnio,
                    semestre,
                    String(p.folio).slice(0, 64),
                    p.proyectoId ? String(p.proyectoId).slice(0, 64) : null,
                    String(p.nombreProyecto || '').slice(0, 512),
                    String(p.responsable || '').slice(0, 255),
                    String(p.prioridad || '').slice(0, 64),
                    String(p.estatus || '').slice(0, 64),
                    parsearAvanceNumerico(p.avance),
                    fechaCorte,
                    capturadoPor
                ]
            );
        }

        await conn.query(
            `INSERT INTO sgc_f14_avance_semestre_corte
                (ciclo_anio, semestre, fecha_corte, total_proyectos, total_en_grafico,
                 avance_promedio, concluidos, en_proceso, no_iniciados,
                 concluidos_grafico, en_proceso_grafico, en_vivo, capturado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE
                fecha_corte = VALUES(fecha_corte),
                total_proyectos = VALUES(total_proyectos),
                total_en_grafico = VALUES(total_en_grafico),
                avance_promedio = VALUES(avance_promedio),
                concluidos = VALUES(concluidos),
                en_proceso = VALUES(en_proceso),
                no_iniciados = VALUES(no_iniciados),
                concluidos_grafico = VALUES(concluidos_grafico),
                en_proceso_grafico = VALUES(en_proceso_grafico),
                en_vivo = 0,
                capturado_en = CURRENT_TIMESTAMP,
                capturado_por = VALUES(capturado_por)`,
            [
                cicloAnio,
                semestre,
                fechaCorte,
                resumen.total,
                resumen.totalEnGrafico,
                resumen.avancePromedio,
                resumen.concluidos,
                resumen.enProceso,
                resumen.noIniciados,
                resumen.concluidosGrafico,
                resumen.enProcesoGrafico,
                capturadoPor
            ]
        );

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    const base = {
        yaExistia: false,
        cicloAnio,
        semestre,
        totalProyectos: resumen.total,
        avancePromedio: resumen.avancePromedio,
        fechaCorte
    };

    if (opciones.omitirRespuestaComparativa) {
        return base;
    }

    return {
        ...base,
        comparativa: await obtenerComparativa(pool, cicloAnio, {
            autoCapturar: false,
            simular: false,
            ahora
        })
    };
}

async function listarCiclosDisponibles(pool) {
    await asegurarTablas(pool);
    const resumen = await sgcF14Service.obtenerResumenMejora(pool);
    const anios = new Set();
    const anioActual = new Date().getFullYear();
    anios.add(anioActual);
    anios.add(anioActual - 1);
    for (const p of resumen?.proyectos || []) {
        const a = anioDesdeFolio(p.folio);
        if (a) anios.add(a);
    }
    const [cortes] = await pool.query(
        `SELECT ciclo_anio, semestre, fecha_corte, avance_promedio, capturado_en
           FROM sgc_f14_avance_semestre_corte
          WHERE en_vivo = 0
          ORDER BY ciclo_anio DESC, semestre ASC`
    );
    for (const c of cortes || []) anios.add(Number(c.ciclo_anio));

    return {
        ciclos: Array.from(anios).filter((a) => a >= 2000).sort((a, b) => b - a),
        cortes: (cortes || []).map((c) => ({
            cicloAnio: Number(c.ciclo_anio),
            semestre: Number(c.semestre),
            fechaCorte: c.fecha_corte,
            avancePromedio: Number(c.avance_promedio) || 0,
            capturadoEn: c.capturado_en
        }))
    };
}

module.exports = {
    asegurarTablas,
    obtenerComparativa,
    capturarCorte,
    listarCiclosDisponibles,
    puedeCapturarSemestre,
    anioDesdeFolio,
    fechaCorteSem1,
    fechaCorteSem2
};
