/**
 * ATH-F-08 · Eficacia de la capacitación — persistencia en biznaga_sgc y sync con Drive.
 *
 * Hoja «Evaluación»: catálogo de hasta 20 cursos, matriz colaborador × curso (A/NA),
 * totales por fila, acreditaciones (DC-3, Diploma, Examen, Otro) y eficacia general.
 */
const ExcelJS = require('exceljs');
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-08';
const TEMPLATE_DRIVE_ID = '1-tq5eEeFmUPk8cJXOmPEXpycthXTXwe6kwK_-M-7kww';
const DRIVE_FILE_ID_SISTEMA = '1-tq5eEeFmUPk8cJXOmPEXpycthXTXwe6kwK_-M-7kww';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'ATH-F-08 Eficacia de la capacitación (sistema)';
const SHEET_TITLE = 'Evaluación';

const MAX_CURSOS = 20;
const MAX_COLABORADORES = 20;
const DATA_START_ROW = 7;
const DATA_END_ROW = DATA_START_ROW + MAX_COLABORADORES - 1; // 26
const CURSO_COL_INICIO = 5; // E = curso 1
const NOMBRE_COL = 2; // B (merge B:D)
const TOTAL_COL = 25; // Y
const APROBADAS_COL = 26; // Z
const EFICACIA_COL = 27; // AA
const FECHA_CELL_COL = 5; // E5 (legacy / global; las fechas por curso van en E5:X5)
const FECHA_CELL_ROW = 5;
const CURSO_FECHA_HEADER_ROW = 5; // Fechas por curso arriba del número (E5:X5)
const REVISION_CELL = { row: 2, col: 26 }; // Z2
const FECHA_REV_CELL = { row: 3, col: 26 }; // Z3
const CURSO_NOMBRE_START_ROW = 34;
const CURSO_FECHA_COL = 4; // D
const CURSO_ACRED_COLS = { dc3: 5, diploma: 6, examen: 7, otro: 8 }; // E-H
const ACRED_ROWS = { dc3: 27, diploma: 28, examen: 29, otro: 30 };
const ACRED_MARK_COL = 5; // E (resumen global derivado)
const EFICACIA_GENERAL_ROW = 27;

const ACREDITACIONES_VACIAS = () => ({
    dc3: false,
    diploma: false,
    examen: false,
    otro: false
});

const CURSO_DEFECTO = () => ({
    nombre: '',
    fecha: '',
    acreditaciones: ACREDITACIONES_VACIAS()
});

const COLABORADOR_DEFECTO = () => ({
    nombre: '',
    resultados: Array.from({ length: MAX_CURSOS }, () => '')
});

const DATOS_DEFECTO = {
    fecha: '',
    revision: '00',
    fechaRevision: '2026-02-09',
    cursos: Array.from({ length: MAX_CURSOS }, () => CURSO_DEFECTO()),
    colaboradores: Array.from({ length: MAX_COLABORADORES }, () => COLABORADOR_DEFECTO())
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return formatearFechaIso(valor);
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
    }
    return normalizarSaltosLinea(String(valor));
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const crudo = String(fecha).trim();
    const isoDirecto = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDirecto) {
        return `${isoDirecto[1]}-${isoDirecto[2]}-${isoDirecto[3]}`;
    }
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return crudo.slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaDisplay(fecha) {
    const iso = formatearFechaIso(fecha);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y.slice(-2)}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function normalizarResultado(valor) {
    const limpio = String(valor || '').trim().toUpperCase();
    if (!limpio) return '';
    if (limpio === 'A' || limpio === 'APROBADO') return 'A';
    if (limpio === 'NA' || limpio === 'N/A' || limpio === 'NO APROBADO' || limpio === 'NOAPROBADO') return 'NA';
    return '';
}

function calcularMetricasColaborador(resultados, cursosActivos = null) {
    const lista = Array.isArray(resultados) ? resultados : [];
    const indices = Array.isArray(cursosActivos) && cursosActivos.length
        ? cursosActivos
        : Array.from({ length: MAX_CURSOS }, (_, i) => i);
    let total = 0;
    let aprobadas = 0;
    for (const i of indices) {
        const r = normalizarResultado(lista[i]);
        if (!r) continue;
        total += 1;
        if (r === 'A') aprobadas += 1;
    }
    const eficacia = total > 0 ? Math.round((aprobadas / total) * 1000) / 10 : null;
    return { total, aprobadas, eficacia };
}

function indicesCursosActivos(cursos) {
    return (Array.isArray(cursos) ? cursos : [])
        .map((curso, idx) => ({ curso, idx }))
        .filter((item) => !!String(item.curso?.nombre || '').trim())
        .map((item) => item.idx);
}

function calcularEficaciaGeneral(colaboradores, cursos = null) {
    const activos = indicesCursosActivos(cursos);
    let total = 0;
    let aprobadas = 0;
    for (const col of colaboradores || []) {
        const m = calcularMetricasColaborador(col?.resultados, activos.length ? activos : null);
        total += m.total;
        aprobadas += m.aprobadas;
    }
    if (total <= 0) return null;
    return Math.round((aprobadas / total) * 1000) / 10;
}

function sanitizarColaborador(item) {
    const resultadosRaw = Array.isArray(item?.resultados) ? item.resultados : [];
    const resultados = Array.from({ length: MAX_CURSOS }, (_, i) => normalizarResultado(resultadosRaw[i]));
    return {
        nombre: String(item?.nombre || '').trim(),
        resultados
    };
}

function esColaboradorVacio(item) {
    const c = sanitizarColaborador(item);
    return !c.nombre && c.resultados.every((r) => !r);
}

function sanitizarAcreditaciones(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        dc3: !!base.dc3,
        diploma: !!base.diploma,
        examen: !!base.examen,
        otro: !!base.otro
    };
}

function sanitizarCurso(item) {
    if (typeof item === 'string') {
        return {
            nombre: String(item || '').trim(),
            fecha: '',
            acreditaciones: ACREDITACIONES_VACIAS()
        };
    }
    const base = item && typeof item === 'object' ? item : {};
    return {
        nombre: String(base.nombre || '').trim(),
        fecha: formatearFechaIso(base.fecha) || '',
        acreditaciones: sanitizarAcreditaciones(base.acreditaciones)
    };
}

function esCursoVacio(item) {
    const c = sanitizarCurso(item);
    return !c.nombre && !c.fecha
        && !c.acreditaciones.dc3 && !c.acreditaciones.diploma
        && !c.acreditaciones.examen && !c.acreditaciones.otro;
}

function agregarAcreditaciones(a, b) {
    return {
        dc3: !!(a?.dc3 || b?.dc3),
        diploma: !!(a?.diploma || b?.diploma),
        examen: !!(a?.examen || b?.examen),
        otro: !!(a?.otro || b?.otro)
    };
}

function acreditacionesGlobalesDesdeCursos(cursos) {
    return (Array.isArray(cursos) ? cursos : []).reduce(
        (acc, curso) => agregarAcreditaciones(acc, sanitizarCurso(curso).acreditaciones),
        ACREDITACIONES_VACIAS()
    );
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const cursosRaw = Array.isArray(base.cursos) ? base.cursos : [];
    const colsRaw = Array.isArray(base.colaboradores) ? base.colaboradores : [];

    // Compactar cursos vacíos y reindexar resultados de colaboradores
    // para que curso 3+ no pierda calificaciones al sincronizar.
    const cursosCompactos = [];
    const indicesOriginales = [];
    cursosRaw.forEach((cursoRaw, idx) => {
        const curso = sanitizarCurso(cursoRaw);
        if (esCursoVacio(curso)) {
            return;
        }
        cursosCompactos.push(curso);
        indicesOriginales.push(idx);
    });

    const cursos = cursosCompactos.slice(0, MAX_CURSOS);
    while (cursos.length < MAX_CURSOS) {
        cursos.push(CURSO_DEFECTO());
    }

    const colaboradores = colsRaw
        .map((item) => {
            const baseCol = sanitizarColaborador(item);
            const resultadosRaw = Array.isArray(item?.resultados) ? item.resultados : baseCol.resultados;
            const resultados = Array.from({ length: MAX_CURSOS }, (_, i) => {
                const origen = indicesOriginales.length ? indicesOriginales[i] : i;
                if (origen === undefined) {
                    return '';
                }
                return normalizarResultado(resultadosRaw[origen]);
            });
            return {
                nombre: baseCol.nombre,
                resultados
            };
        })
        .filter((c) => !esColaboradorVacio(c))
        .slice(0, MAX_COLABORADORES);

    while (colaboradores.length < MAX_COLABORADORES) {
        colaboradores.push(COLABORADOR_DEFECTO());
    }

    return {
        fecha: formatearFechaIso(base.fecha) || '',
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0').slice(0, 2),
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        cursos,
        colaboradores
    };
}

function parsearRevisionDesdeCelda(texto) {
    const m = String(texto || '').match(/(\d{1,2})/);
    return m ? m[1].padStart(2, '0') : DATOS_DEFECTO.revision;
}

function parsearFechaRevDesdeCelda(texto) {
    const m = String(texto || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!m) return DATOS_DEFECTO.fechaRevision;
    return formatearFechaIso(`${m[1]}-${m[2]}-${m[3]}`);
}

function marcarAcreditacionActiva(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t === 'X' || t === 'SI' || t === 'SÍ' || t === '1' || t === '✓' || t === '✔';
}

function leerColaboradoresDesdeHoja(ws) {
    const colaboradores = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const nombreCelda = celdaATexto(row.getCell(NOMBRE_COL).value)
            || celdaATexto(row.getCell(1).value)
            || celdaATexto(row.getCell(3).value);
        if (String(nombreCelda || '').toLowerCase().includes('acreditaciones')) {
            break;
        }
        const resultados = [];
        for (let i = 0; i < MAX_CURSOS; i++) {
            resultados.push(normalizarResultado(celdaATexto(row.getCell(CURSO_COL_INICIO + i).value)));
        }
        const fila = sanitizarColaborador({
            nombre: celdaATexto(row.getCell(NOMBRE_COL).value),
            resultados
        });
        colaboradores.push(fila);
    }
    return colaboradores;
}

function detectarFilaCatalogoCursosEnHoja(ws, acredStart) {
    const inicio = Math.max((Number(acredStart) || ACRED_ROWS.dc3) + 4, DATA_START_ROW + 1);
    for (let r = inicio; r <= 90; r++) {
        const row = ws.getRow(r);
        const a = celdaATexto(row.getCell(1).value);
        const b = celdaATexto(row.getCell(2).value);
        const c = celdaATexto(row.getCell(3).value);
        const unidos = `${a} ${b} ${c}`.toLowerCase();
        if (unidos.includes('acreditaciones')) continue;
        if (/^curso$/i.test(a) || /^curso$/i.test(b) || /^curso$/i.test(c)) {
            return r + 1;
        }
        if (/^1$/.test(a) && (b.length > 2 || c.length > 2)) {
            return r;
        }
    }
    return CURSO_NOMBRE_START_ROW;
}

function detectarFilaAcreditacionesEnHoja(ws) {
    for (let r = DATA_START_ROW; r <= 80; r++) {
        const row = ws.getRow(r);
        const texto = [1, 2, 3, 4]
            .map((col) => celdaATexto(row.getCell(col).value))
            .join(' ')
            .toLowerCase();
        if (texto.includes('acreditaciones')) {
            return r;
        }
    }
    return ACRED_ROWS.dc3;
}

function leerCursosDesdeHoja(ws) {
    const acredStart = detectarFilaAcreditacionesEnHoja(ws);
    const catalogoStart = detectarFilaCatalogoCursosEnHoja(ws, acredStart);
    const acred = layoutAcredRows(acredStart);
    return Array.from({ length: MAX_CURSOS }, (_, i) => {
        const row = ws.getRow(catalogoStart + i);
        const nombre = celdaATexto(row.getCell(NOMBRE_COL).value) || celdaATexto(row.getCell(4).value);
        const fechaHeader = celdaATexto(ws.getRow(CURSO_FECHA_HEADER_ROW).getCell(CURSO_COL_INICIO + i).value);
        const fechaCatalogo = celdaATexto(row.getCell(CURSO_FECHA_COL).value);
        const col = CURSO_COL_INICIO + i;
        const acredCatalogo = {
            dc3: marcarAcreditacionActiva(celdaATexto(row.getCell(CURSO_ACRED_COLS.dc3).value)),
            diploma: marcarAcreditacionActiva(celdaATexto(row.getCell(CURSO_ACRED_COLS.diploma).value)),
            examen: marcarAcreditacionActiva(celdaATexto(row.getCell(CURSO_ACRED_COLS.examen).value)),
            otro: marcarAcreditacionActiva(celdaATexto(row.getCell(CURSO_ACRED_COLS.otro).value))
        };
        const acredMatriz = {
            dc3: marcarAcreditacionActiva(celdaATexto(ws.getRow(acred.dc3).getCell(col).value)),
            diploma: marcarAcreditacionActiva(celdaATexto(ws.getRow(acred.diploma).getCell(col).value)),
            examen: marcarAcreditacionActiva(celdaATexto(ws.getRow(acred.examen).getCell(col).value)),
            otro: marcarAcreditacionActiva(celdaATexto(ws.getRow(acred.otro).getCell(col).value))
        };
        return {
            nombre,
            fecha: fechaHeader || fechaCatalogo,
            acreditaciones: {
                dc3: acredMatriz.dc3 || acredCatalogo.dc3,
                diploma: acredMatriz.diploma || acredCatalogo.diploma,
                examen: acredMatriz.examen || acredCatalogo.examen,
                otro: acredMatriz.otro || acredCatalogo.otro
            }
        };
    });
}

function parsearDatosDesdeHoja(ws) {
    const revisionTexto = celdaATexto(ws.getRow(REVISION_CELL.row).getCell(REVISION_CELL.col).value);
    const fechaRevTexto = celdaATexto(ws.getRow(FECHA_REV_CELL.row).getCell(FECHA_REV_CELL.col).value);
    const cursos = leerCursosDesdeHoja(ws);
    const primeraFechaCurso = (cursos.find((c) => !!String(c.fecha || '').trim()) || {}).fecha || '';
    return sanitizarDatos({
        fecha: primeraFechaCurso,
        revision: parsearRevisionDesdeCelda(revisionTexto),
        fechaRevision: parsearFechaRevDesdeCelda(fechaRevTexto),
        cursos,
        colaboradores: leerColaboradoresDesdeHoja(ws)
    });
}

function escribirFilaColaborador(row, item, index, cursos) {
    const c = sanitizarColaborador(item);
    const activos = indicesCursosActivos(cursos);
    const metricas = calcularMetricasColaborador(c.resultados, activos.length ? activos : null);
    row.getCell(1).value = index + 1;
    asignarTextoSimple(row.getCell(NOMBRE_COL), c.nombre, 'left');
    for (let i = 0; i < MAX_CURSOS; i++) {
        asignarTextoSimple(row.getCell(CURSO_COL_INICIO + i), c.resultados[i] || '', 'center');
    }
    asignarTextoSimple(row.getCell(TOTAL_COL), metricas.total > 0 ? String(metricas.total) : '', 'center');
    asignarTextoSimple(row.getCell(APROBADAS_COL), metricas.total > 0 ? String(metricas.aprobadas) : '', 'center');
    asignarTextoSimple(
        row.getCell(EFICACIA_COL),
        metricas.eficacia === null ? '' : `${metricas.eficacia}%`,
        'center'
    );
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);

    // Fechas por curso en la fila 5 (E5:X5), alineadas con columnas 1–20.
    for (let i = 0; i < MAX_CURSOS; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        asignarTextoSimple(
            ws.getRow(CURSO_FECHA_HEADER_ROW).getCell(CURSO_COL_INICIO + i),
            curso.fecha ? formatearFechaDisplay(curso.fecha) : '',
            'center'
        );
    }

    asignarTextoSimple(
        ws.getRow(REVISION_CELL.row).getCell(REVISION_CELL.col),
        `Revisión: ${d.revision}`,
        'left'
    );
    asignarTextoSimple(
        ws.getRow(FECHA_REV_CELL.row).getCell(FECHA_REV_CELL.col),
        `Fecha Rev.: ${formatearFechaDisplay(d.fechaRevision)}`,
        'left'
    );

    for (let i = 0; i < MAX_COLABORADORES; i++) {
        escribirFilaColaborador(
            ws.getRow(DATA_START_ROW + i),
            d.colaboradores[i] || COLABORADOR_DEFECTO(),
            i,
            d.cursos
        );
    }

    const acredStart = detectarFilaAcreditacionesEnHoja(ws);
    const catalogoStart = detectarFilaCatalogoCursosEnHoja(ws, acredStart);
    const acred = layoutAcredRows(acredStart);

    for (let i = 0; i < MAX_CURSOS; i++) {
        const row = ws.getRow(catalogoStart + i);
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        row.getCell(1).value = i + 1;
        asignarTextoSimple(row.getCell(NOMBRE_COL), curso.nombre || '', 'left');
        // Catálogo inferior: solo nombre; la fecha vive en la fila 5 de la matriz.
        asignarTextoSimple(row.getCell(CURSO_FECHA_COL), '', 'center');
        asignarTextoSimple(row.getCell(CURSO_ACRED_COLS.dc3), '', 'center');
        asignarTextoSimple(row.getCell(CURSO_ACRED_COLS.diploma), '', 'center');
        asignarTextoSimple(row.getCell(CURSO_ACRED_COLS.examen), '', 'center');
        asignarTextoSimple(row.getCell(CURSO_ACRED_COLS.otro), '', 'center');
    }

    // Acreditaciones por curso en el bloque DC-3 / Diploma / Examen / Otro (columnas E:X).
    for (let i = 0; i < MAX_CURSOS; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        const col = CURSO_COL_INICIO + i;
        asignarTextoSimple(ws.getRow(acred.dc3).getCell(col), curso.acreditaciones.dc3 ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.diploma).getCell(col), curso.acreditaciones.diploma ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.examen).getCell(col), curso.acreditaciones.examen ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.otro).getCell(col), curso.acreditaciones.otro ? 'X' : '', 'center');
    }

    const eficaciaGral = calcularEficaciaGeneral(d.colaboradores, d.cursos);
    asignarTextoSimple(
        ws.getRow(acred.eficaciaGeneral).getCell(EFICACIA_COL),
        eficaciaGral === null ? '' : `${eficaciaGral}%`,
        'center'
    );
}

function columnaALetra(col) {
    let numero = Number(col);
    let letras = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letras = String.fromCharCode(65 + resto) + letras;
        numero = Math.floor((numero - 1) / 26);
    }
    return letras;
}

function rangoSheet(celda, sheetTitle) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle, layout = null) {
    const d = sanitizarDatos(datos);
    const actualizaciones = [];
    const activos = indicesCursosActivos(d.cursos);
    const filled = d.colaboradores.filter((c) => !esColaboradorVacio(c)).length;
    const capacidadLayout = Math.max(
        1,
        Number(layout?.capacidad) || Number(layout?.numFilas) || filled || 1
    );
    // Escribe todos los colaboradores con nombre y limpia filas sobrantes del bloque.
    const numFilas = Math.min(
        Math.max(capacidadLayout, filled, 1),
        MAX_COLABORADORES
    );
    const acred = layoutAcredRows(layout?.acredStart || ACRED_ROWS.dc3);

    // Fechas por curso en E5:X5 (antes se limpiaban y quedaba la fila Fecha vacía).
    for (let i = 0; i < MAX_CURSOS; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_COL_INICIO + i)}${CURSO_FECHA_HEADER_ROW}`, sheetTitle),
            values: [[curso.fecha ? formatearFechaDisplay(curso.fecha) : '']]
        });
    }

    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(REVISION_CELL.col)}${REVISION_CELL.row}`, sheetTitle),
        values: [[`Revisión: ${d.revision}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(FECHA_REV_CELL.col)}${FECHA_REV_CELL.row}`, sheetTitle),
        values: [[`Fecha Rev.: ${formatearFechaDisplay(d.fechaRevision)}`]]
    });

    for (let i = 0; i < numFilas; i++) {
        const rowNum = DATA_START_ROW + i;
        const c = i < filled
            ? (d.colaboradores[i] || COLABORADOR_DEFECTO())
            : COLABORADOR_DEFECTO();
        const metricas = calcularMetricasColaborador(c.resultados, activos.length ? activos : null);
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(1)}${rowNum}`, sheetTitle),
            values: [[c.nombre ? (i + 1) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(NOMBRE_COL)}${rowNum}`, sheetTitle),
            values: [[c.nombre || '']]
        });
        // Siempre volcar las 20 columnas de resultado (curso 3+ inclusive).
        for (let j = 0; j < MAX_CURSOS; j++) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(CURSO_COL_INICIO + j)}${rowNum}`, sheetTitle),
                values: [[c.resultados[j] || '']]
            });
        }
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(TOTAL_COL)}${rowNum}`, sheetTitle),
            values: [[metricas.total > 0 ? String(metricas.total) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(APROBADAS_COL)}${rowNum}`, sheetTitle),
            values: [[metricas.total > 0 ? String(metricas.aprobadas) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(EFICACIA_COL)}${rowNum}`, sheetTitle),
            values: [[metricas.eficacia === null ? '' : `${metricas.eficacia}%`]]
        });
    }

    for (let i = 0; i < MAX_CURSOS; i++) {
        const rowNum = (Number(layout?.catalogoStart) || CURSO_NOMBRE_START_ROW) + i;
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(1)}${rowNum}`, sheetTitle),
            values: [[i + 1]]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(NOMBRE_COL)}${rowNum}`, sheetTitle),
            values: [[curso.nombre || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_FECHA_COL)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_ACRED_COLS.dc3)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_ACRED_COLS.diploma)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_ACRED_COLS.examen)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_ACRED_COLS.otro)}${rowNum}`, sheetTitle),
            values: [['']]
        });
    }

    // Acreditaciones por curso (DC-3 / Diploma / Examen / Otro × columnas E:X).
    for (let i = 0; i < MAX_CURSOS; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        const colLetra = columnaALetra(CURSO_COL_INICIO + i);
        actualizaciones.push({
            range: rangoSheet(`${colLetra}${acred.dc3}`, sheetTitle),
            values: [[curso.acreditaciones.dc3 ? 'X' : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${colLetra}${acred.diploma}`, sheetTitle),
            values: [[curso.acreditaciones.diploma ? 'X' : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${colLetra}${acred.examen}`, sheetTitle),
            values: [[curso.acreditaciones.examen ? 'X' : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${colLetra}${acred.otro}`, sheetTitle),
            values: [[curso.acreditaciones.otro ? 'X' : '']]
        });
    }

    const eficaciaGral = calcularEficaciaGeneral(d.colaboradores, d.cursos);
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(EFICACIA_COL)}${acred.eficaciaGeneral}`, sheetTitle),
        values: [[eficaciaGral === null ? '' : `${eficaciaGral}%`]]
    });

    return actualizaciones;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        const vigente = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        return vigente || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla ATH-F-08 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch {
        return driveService.descargarArchivo(fileId);
    }
}

async function detectarFilaAcreditacionesEnDrive(spreadsheetId, sheetTitle) {
    try {
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetTitle}'!A${DATA_START_ROW}:D80`,
            majorDimension: 'ROWS'
        });
        const values = res.data.values || [];
        for (let i = 0; i < values.length; i++) {
            const texto = (values[i] || []).map((c) => String(c || '')).join(' ').toLowerCase();
            if (texto.includes('acreditaciones')) {
                return DATA_START_ROW + i;
            }
        }
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo detectar fila de Acreditaciones:', err.message);
    }
    return ACRED_ROWS.dc3;
}

async function detectarFilaCatalogoCursosEnDrive(spreadsheetId, sheetTitle, acredStart) {
    const inicio = Math.max((Number(acredStart) || ACRED_ROWS.dc3) + 4, DATA_START_ROW + 1);
    try {
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetTitle}'!A${inicio}:D90`,
            majorDimension: 'ROWS'
        });
        const values = res.data.values || [];
        for (let i = 0; i < values.length; i++) {
            const row = values[i] || [];
            const a = String(row[0] || '').trim();
            const b = String(row[1] || '').trim();
            const c = String(row[2] || '').trim();
            const unidos = `${a} ${b} ${c}`.toLowerCase();
            if (unidos.includes('acreditaciones')) continue;
            if (/^curso$/i.test(a) || /^curso$/i.test(b) || /^curso$/i.test(c)) {
                return inicio + i + 1;
            }
            if (/^1$/.test(a) && (b.length > 2 || c.length > 2)) {
                return inicio + i;
            }
        }
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo detectar catálogo de cursos:', err.message);
    }
    return CURSO_NOMBRE_START_ROW;
}

/**
 * Inserta filas de datos antes del bloque Acreditaciones cuando faltan
 * renglones para todos los colaboradores (evita truncar a 2 filas).
 */
async function insertarFilasColaboradoresEnDrive(spreadsheetId, sheetTitle, filaInsercion, cantidad) {
    const n = Math.max(0, Number(cantidad) || 0);
    const fila = Math.max(DATA_START_ROW, Number(filaInsercion) || DATA_START_ROW);
    if (!spreadsheetId || !sheetTitle || n <= 0) {
        return false;
    }
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return false;
    }
    // filaInsercion es 1-based; la API usa índices 0-based e inserta ANTES de startIndex.
    const startIndex = fila - 1;
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                insertDimension: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex,
                        endIndex: startIndex + n
                    },
                    inheritFromBefore: true
                }
            }]
        }
    });
    return true;
}

/**
 * Asegura espacio para N colaboradores. Si el bloque Acreditaciones queda
 * demasiado arriba, inserta filas y re-detecta el layout.
 */
async function asegurarFilasColaboradoresEnDrive(spreadsheetId, sheetTitle, numColaboradores) {
    const needed = Math.min(Math.max(Number(numColaboradores) || 1, 1), MAX_COLABORADORES);
    let acredStart = await detectarFilaAcreditacionesEnDrive(spreadsheetId, sheetTitle);
    let disponibles = Math.max(0, acredStart - DATA_START_ROW);

    if (needed > disponibles) {
        const faltan = needed - disponibles;
        try {
            await insertarFilasColaboradoresEnDrive(
                spreadsheetId,
                sheetTitle,
                acredStart,
                faltan
            );
            acredStart = await detectarFilaAcreditacionesEnDrive(spreadsheetId, sheetTitle);
            disponibles = Math.max(0, acredStart - DATA_START_ROW);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudieron insertar filas de colaboradores:', err.message);
        }
    }

    const numFilas = Math.min(needed, Math.max(disponibles, 1), MAX_COLABORADORES);
    const capacidad = Math.max(disponibles, numFilas);
    const catalogoStart = await detectarFilaCatalogoCursosEnDrive(spreadsheetId, sheetTitle, acredStart);
    return {
        dataStart: DATA_START_ROW,
        numFilas,
        dataEnd: DATA_START_ROW + numFilas - 1,
        capacidad,
        acredStart,
        catalogoStart
    };
}

function layoutAcredRows(acredStart) {
    const base = Math.max(Number(acredStart) || ACRED_ROWS.dc3, DATA_START_ROW + 1);
    return {
        dc3: base,
        diploma: base + 1,
        examen: base + 2,
        otro: base + 3,
        eficaciaGeneral: base
    };
}

function contarCursosConNombreAthF08(datos) {
    return (Array.isArray(datos?.cursos) ? datos.cursos : [])
        .filter((c) => !!String(c?.nombre || '').trim()).length;
}

function contarColaboradoresConNombreAthF08(datos) {
    return (Array.isArray(datos?.colaboradores) ? datos.colaboradores : [])
        .filter((c) => !!String(c?.nombre || '').trim()).length;
}

/**
 * Evita que una lectura incompleta de Drive borre cursos/colaboradores
 * ya persistidos en BD (p. ej. tras desalineación del catálogo).
 */
function fusionarDatosAthF08(datosDb, datosDrive) {
    const db = datosDb ? sanitizarDatos(datosDb) : null;
    const drive = datosDrive ? sanitizarDatos(datosDrive) : null;
    if (!db && !drive) return sanitizarDatos(DATOS_DEFECTO);
    if (!db) return drive;
    if (!drive) return db;

    const preferirCursosDb = contarCursosConNombreAthF08(db) >= contarCursosConNombreAthF08(drive);
    const preferirColabDb = contarColaboradoresConNombreAthF08(db) >= contarColaboradoresConNombreAthF08(drive);
    const cursosBase = preferirCursosDb ? db.cursos : drive.cursos;
    const cursosAlt = preferirCursosDb ? drive.cursos : db.cursos;
    const cursos = cursosBase.map((curso, i) => {
        const alt = cursosAlt[i] || CURSO_DEFECTO();
        return sanitizarCurso({
            nombre: curso.nombre || alt.nombre,
            fecha: curso.fecha || alt.fecha,
            acreditaciones: {
                dc3: !!(curso.acreditaciones.dc3 || alt.acreditaciones.dc3),
                diploma: !!(curso.acreditaciones.diploma || alt.acreditaciones.diploma),
                examen: !!(curso.acreditaciones.examen || alt.acreditaciones.examen),
                otro: !!(curso.acreditaciones.otro || alt.acreditaciones.otro)
            }
        });
    });

    return sanitizarDatos({
        fecha: db.fecha || drive.fecha,
        revision: drive.revision || db.revision,
        fechaRevision: drive.fechaRevision || db.fechaRevision,
        cursos,
        colaboradores: preferirColabDb ? db.colaboradores : drive.colaboradores
    });
}

async function aplicarFormatoVisualAthF08(spreadsheetId, sheetTitle, datos, layout = null) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    const filled = d.colaboradores.filter((c) => !esColaboradorVacio(c)).length;
    const numFilas = Math.min(
        Math.max(Number(layout?.numFilas) || filled, filled, 1),
        MAX_COLABORADORES
    );
    const filaMax = layout?.acredStart
        ? Math.max(layout.acredStart - 1, DATA_START_ROW)
        : DATA_END_ROW;
    try {
        await driveService.aplicarFormatoFilasAthF08(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            filaMax
        );
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const d = sanitizarDatos(datos);
    const filled = d.colaboradores.filter((c) => !esColaboradorVacio(c)).length;
    const layout = await asegurarFilasColaboradoresEnDrive(spreadsheetId, titulo, Math.max(filled, 1));
    const actualizaciones = datosAActualizacionesSheet(d, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualAthF08(spreadsheetId, titulo, d, layout);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla ATH-F-08 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        fecha: d.fecha,
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        cursos: d.cursos.map((c) => ({
            nombre: c.nombre,
            fecha: c.fecha,
            acreditaciones: c.acreditaciones
        })),
        colaboradores: d.colaboradores.map((c) => ({
            nombre: c.nombre,
            resultados: c.resultados
        }))
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
}

function estructuraEsEquivalente() {
    // Agregar/quitar colaboradores o cursos es captura normal de información.
    return true;
}

async function aplicarHistorialAthF08(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    const nombreMesAnio = `${excelHistorial.codigoHistorialBase(CODIGO_FORMATO)}-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        try {
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function archivoEstaEnCarpeta(fileId, folderId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const parents = Array.isArray(info?.parents) ? info.parents : [];
        return parents.includes(folderId);
    } catch {
        return false;
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function persistirDriveFileIdEnDb(pool, driveFileId, registro = null) {
    const registroBase = registro || await obtenerRegistroDb(pool);
    const datosActuales = await leerDatosRegistro(registroBase) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosActuales,
        fechaElaboracionOriginal: formatearFechaIso(registroBase?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registroBase?.fecha_modificacion_contenido),
        contenidoModificado: !!registroBase?.contenido_modificado
    });
}

async function restaurarDriveComoGoogleSheet(fileId, pool, registro = null) {
    console.log(`[ATH-F-08] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
    const archivo = await driveService.convertirOfficeExcelAGoogleSheet(fileId, {
        nombre: NOMBRE_ARCHIVO_DRIVE,
        carpetaId: CARPETA_DRIVE_ID,
        eliminarOriginal: true
    });
    const nuevoId = archivo?.id;
    if (!nuevoId) {
        throw new Error('No se obtuvo ID del Google Sheet restaurado');
    }
    await persistirDriveFileIdEnDb(pool, nuevoId, registro);
    console.log(`[ATH-F-08] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA].filter(Boolean);
    const unicos = [...new Set(candidatos.map((id) => String(id).trim()).filter(Boolean))];

    for (const id of unicos) {
        if (await esSpreadsheetEditableEnDrive(id)) {
            if (id !== driveId) {
                await persistirDriveFileIdEnDb(pool, id, registro);
            }
            return id;
        }
    }

    const idOffice = unicos.find(Boolean);
    if (!idOffice) {
        throw new Error('No hay archivo ATH-F-08 configurado en Drive.');
    }
    return await restaurarDriveComoGoogleSheet(idOffice, pool, registro);
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        try {
            const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
            if (existe && (await esSpreadsheetEditableEnDrive(DRIVE_FILE_ID_SISTEMA))) {
                return DRIVE_FILE_ID_SISTEMA;
            }
        } catch {
            // Continuar con otros candidatos.
        }
    }

    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) {
            candidatos.push(val);
        }
    };

    agregar(registro?.drive_file_id);
    agregar(DRIVE_FILE_ID_SISTEMA);
    const enCarpeta = await buscarArchivoDriveTrabajo();
    agregar(enCarpeta?.id);

    const resolver = async (soloGoogleSheet, requiereCarpeta) => {
        for (const id of candidatos) {
            try {
                const existe = await driveService.verificarArchivoExiste(id);
                if (!existe) continue;
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) continue;
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) continue;
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) return editableSinCarpeta;
    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) return editableEnCarpeta;
    const cualquieraSinCarpeta = await resolver(false, false);
    if (cualquieraSinCarpeta) return cualquieraSinCarpeta;
    return DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[ATH-F-08] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 27, keepSingleSheet: false }
    );
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) return null;
    try {
        const parsed = typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

function formatearDatetimeMysqlMexico(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string' && !fecha.includes('T')) {
        const [datePart, timePart = '00:00:00'] = fecha.trim().split(/\s+/);
        const [y, m, d] = datePart.split('-');
        const [hh, mm] = timePart.split(':');
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return String(fecha);
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const y = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const min = String(dt.getUTCMinutes()).padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${min}`;
}

function formatearInstanteMexico(fecha) {
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(dt);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    const dbVal = registro?.ultima_sync_drive;
    if (dbVal != null && dbVal !== '') {
        return formatearDatetimeMysqlMexico(dbVal);
    }
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) {
        return formatearInstanteMexico(driveVal);
    }
    return null;
}

function enriquecerDatosRespuesta(datos) {
    const d = sanitizarDatos(datos);
    const activos = indicesCursosActivos(d.cursos);
    const colaboradores = d.colaboradores.map((c) => {
        const m = calcularMetricasColaborador(c.resultados, activos.length ? activos : null);
        return {
            ...c,
            total: m.total,
            aprobadas: m.aprobadas,
            eficacia: m.eficacia
        };
    });
    return {
        ...d,
        cursos: d.cursos.filter((c) => !esCursoVacio(c)),
        colaboradores,
        eficaciaGeneral: calcularEficaciaGeneral(d.colaboradores, d.cursos)
    };
}

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const datosEnriquecidos = enriquecerDatosRespuesta(datos);

    return {
        codigo: CODIGO_FORMATO,
        datos: datosEnriquecidos,
        fechaElaboracionOriginal: fechaOriginal || datosEnriquecidos.fecha || null,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    const datosDb = await leerDatosRegistro(registro);
    const datosDriveRaw = datos ? sanitizarDatos(datos) : null;
    if (datos && datosDb) {
        datos = fusionarDatosAthF08(datosDb, datos);
    } else if (!datos) {
        datos = datosDb;
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo leer plantilla, usando datos por defecto:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    // Si Drive perdió nombres por desalineación del catálogo, restaurar desde BD.
    if (
        driveFileId
        && datosDriveRaw
        && (
            contarCursosConNombreAthF08(datos) > contarCursosConNombreAthF08(datosDriveRaw)
            || contarColaboradoresConNombreAthF08(datos) > contarColaboradoresConNombreAthF08(datosDriveRaw)
        )
    ) {
        try {
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fecha || fechaHoyIso(),
                fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
            if (await esSpreadsheetEditableEnDrive(driveFileId)) {
                const hoja = await resolverTituloHojaTrabajo(driveFileId);
                await actualizarDatosEnGoogleSheet(driveFileId, datos, hoja);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            }
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo restaurar catálogo incompleto en Drive:', err.message);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fecha || fechaHoyIso(),
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = { ...registro, drive_file_id: driveFileId || null };
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    const registroPrevio = await obtenerRegistroDb(pool);
    let datosPrevios = null;
    if (registroPrevio?.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fecha || fechaHoyIso();
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    if (!huboCambio && driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveId);
        await actualizarDatosEnGoogleSheet(driveId, datosEntrada, hojaDestino);
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialAthF08({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: { ...datosEntrada },
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;

            if (hist.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            const hojaDestino = hist.aplicado && hist.hojaVigente
                ? hist.hojaVigente
                : await resolverTituloHojaTrabajo(driveId);
            if (!hist.aplicado) {
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            }
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    let datosPrevios = null;
    if (registro.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registro.datos_json === 'string'
                    ? JSON.parse(registro.datos_json)
                    : registro.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDriveRaw = sanitizarDatos(await leerDatosDesdeBuffer(buffer, { modo: 'edicion' }));
    const datosDrive = fusionarDatosAthF08(datosPrevios, datosDriveRaw);

    if (!fechaOriginal) {
        fechaOriginal = datosDrive.fecha || fechaHoyIso();
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialAthF08({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosDrive,
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    if (!hist.aplicado) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveFileId);
        await actualizarDatosEnGoogleSheet(driveFileId, datosGuardar, hojaDestino);
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (registro?.drive_file_id && registro.drive_file_id !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[ATH-F-08] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    // Trabaja sobre la plantilla maestra (mismo ID sistema).
    const driveId = TEMPLATE_DRIVE_ID;
    await actualizarDatosEnGoogleSheet(driveId, datos, SHEET_TITLE);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos,
    calcularEficaciaGeneral,
    calcularMetricasColaborador
};
