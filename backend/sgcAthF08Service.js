/**
 * ATH-F-08 · Eficacia de la capacitación — persistencia en biznaga_sgc y sync con Drive.
 *
 * Hoja «Evaluación»: catálogo de cursos, matriz colaborador × curso (A/NA),
 * totales por fila, acreditaciones (DC-3, Diploma, Examen, Otro) y eficacia general.
 * La plantilla trae 20 columnas de calificación; el sistema puede crear o quitar
 * columnas extra (hasta MAX_CURSOS) y las refleja en el Google Sheet.
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
const NOMBRE_PDF_ARCHIVO = 'ATH-F-08 Eficacia de la capacitacion.pdf';
const SHEET_TITLE = 'Evaluación';

/**
 * Impresión Sheets (hoja actual), 2 páginas:
 * 1) Matriz + acreditaciones — carta, horizontal, ajustar al ancho.
 * 2) Catálogo de cursos — misma hoja, salto de página automático al unir PDF.
 */
const OPCIONES_PDF_IMPRESION = {
    landscape: true,
    size: 'letter',
    fitToWidth: true,
    margins: 'normales',
    pageOrder: 'down',
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP'
};

/** Columnas de calificación que trae la plantilla (E–X). No se eliminan. */
const CURSOS_PLANTILLA = 20;
/** Tope de columnas que el sistema puede registrar (plantilla + extras). */
const MAX_CURSOS = 60;
const MAX_COLABORADORES = 20;
const DATA_START_ROW = 7;
const DATA_END_ROW = DATA_START_ROW + MAX_COLABORADORES - 1; // 26
const CURSO_COL_INICIO = 5; // E = curso 1
const NOMBRE_COL = 2; // B (merge B:D)
const CURSO_NUM_HEADER_ROW = 6; // Números 1…N encima de las calificaciones
/** Columnas de métricas con la plantilla de 20 cursos: Y, Z, AA. */
const TOTAL_COL = CURSO_COL_INICIO + CURSOS_PLANTILLA; // 25
const APROBADAS_COL = TOTAL_COL + 1; // 26
const EFICACIA_COL = TOTAL_COL + 2; // 27
/** Columnas A–AA (matriz completa). */
const PDF_MAX_COLUMNAS_MATRIZ = EFICACIA_COL;
/** Columnas A–H del catálogo (nº, nombre, fecha, acreditaciones). */
const PDF_MAX_COLUMNAS_CATALOGO = 8;
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

const COLABORADOR_DEFECTO = (numCursos = CURSOS_PLANTILLA) => ({
    nombre: '',
    resultados: Array.from({ length: Math.max(1, Number(numCursos) || CURSOS_PLANTILLA) }, () => '')
});

const DATOS_DEFECTO = {
    fecha: '',
    revision: '00',
    fechaRevision: '2026-02-09',
    cursos: Array.from({ length: CURSOS_PLANTILLA }, () => CURSO_DEFECTO()),
    colaboradores: Array.from({ length: MAX_COLABORADORES }, () => COLABORADOR_DEFECTO())
};

/**
 * Con 20 cursos las métricas quedan en Y/Z/AA y la revisión en Z.
 * Cada columna extra desplaza ese bloque a la derecha.
 */
function layoutColumnas(numCursos) {
    const n = Math.min(
        MAX_CURSOS,
        Math.max(CURSOS_PLANTILLA, Number(numCursos) || CURSOS_PLANTILLA)
    );
    const totalCol = CURSO_COL_INICIO + n;
    return {
        numCursos: n,
        totalCol,
        aprobadasCol: totalCol + 1,
        eficaciaCol: totalCol + 2,
        revisionCol: totalCol + 1
    };
}

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
        : lista.map((_, i) => i);
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

function indicesCursosActivos(cursos, colaboradores = null) {
    const lista = Array.isArray(cursos) ? cursos : [];
    const cols = Array.isArray(colaboradores) ? colaboradores : [];
    return lista
        .map((curso, idx) => ({ curso, idx }))
        .filter((item) => {
            if (String(item.curso?.nombre || '').trim()) return true;
            return cols.some((col) => normalizarResultado((col?.resultados || [])[item.idx]));
        })
        .map((item) => item.idx);
}

function calcularEficaciaGeneral(colaboradores, cursos = null) {
    const activos = indicesCursosActivos(cursos, colaboradores);
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

function sanitizarColaborador(item, numCursos = CURSOS_PLANTILLA) {
    const n = Math.min(MAX_CURSOS, Math.max(1, Number(numCursos) || CURSOS_PLANTILLA));
    const resultadosRaw = Array.isArray(item?.resultados) ? item.resultados : [];
    const resultados = Array.from({ length: n }, (_, i) => normalizarResultado(resultadosRaw[i]));
    return {
        nombre: String(item?.nombre || '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s+/g, ' ').trim(),
        resultados
    };
}

/** Una sola línea en la hoja y en el PDF. El salto de los nombres largos vive solo en la interfaz. */
function nombreColaboradorEnHoja(nombre) {
    return String(nombre || '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function esColaboradorVacio(item) {
    if (String(item?.nombre || '').trim()) return false;
    const resultados = Array.isArray(item?.resultados) ? item.resultados : [];
    return !resultados.some((r) => !!normalizarResultado(r));
}

function resultadoEnIndice(colsRaw, idx) {
    return (Array.isArray(colsRaw) ? colsRaw : []).some((col) => {
        const resultados = Array.isArray(col?.resultados) ? col.resultados : [];
        return !!normalizarResultado(resultados[idx]);
    });
}

/**
 * Conserva los cursos con datos y, si el cliente pide más columnas
 * (`numColumnas`), deja al final los espacios vacíos para crearlas en el Excel.
 * Sin ese dato se descartan solo los huecos vacíos (relleno viejo de 20).
 */
function resolverBloqueCursos(cursosRaw, colsRaw, numColumnasPedidas) {
    const raw = (Array.isArray(cursosRaw) ? cursosRaw : []).slice(0, MAX_CURSOS);
    const cursos = [];
    const indicesOriginales = [];
    raw.forEach((cursoRaw, idx) => {
        const curso = sanitizarCurso(cursoRaw);
        if (esCursoVacio(curso) && !resultadoEnIndice(colsRaw, idx)) return;
        cursos.push(curso);
        indicesOriginales.push(idx);
    });

    let slots = cursos.length;
    const pedidas = Number(numColumnasPedidas);
    if (Number.isFinite(pedidas) && pedidas > slots) {
        slots = Math.min(MAX_CURSOS, Math.floor(pedidas));
    }
    if (slots < 1) slots = 1;
    while (cursos.length < slots) {
        cursos.push(CURSO_DEFECTO());
        indicesOriginales.push(undefined);
    }
    return { cursos, indicesOriginales, numColumnas: slots };
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

    const bloque = resolverBloqueCursos(cursosRaw, colsRaw, base.numColumnas);
    const cursos = bloque.cursos;
    const indicesOriginales = bloque.indicesOriginales;

    const colaboradores = colsRaw
        .map((item) => {
            const baseCol = sanitizarColaborador(item, cursos.length);
            const resultadosRaw = Array.isArray(item?.resultados) ? item.resultados : baseCol.resultados;
            const resultados = Array.from({ length: cursos.length }, (_, i) => {
                const origen = indicesOriginales.length ? indicesOriginales[i] : i;
                if (origen === undefined) {
                    return '';
                }
                return normalizarResultado(resultadosRaw[origen]);
            });
            return {
                nombre: String(item?.nombre || baseCol.nombre || '').trim(),
                resultados
            };
        })
        .filter((c) => !esColaboradorVacio(c))
        .slice(0, MAX_COLABORADORES);

    while (colaboradores.length < MAX_COLABORADORES) {
        colaboradores.push(COLABORADOR_DEFECTO(cursos.length));
    }

    return {
        fecha: formatearFechaIso(base.fecha) || '',
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0').slice(0, 2),
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        numColumnas: bloque.numColumnas,
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

/** Primera celda de métricas: «Total de capacitaciones por colaborador». */
function textoEsInicioDeTotales(texto) {
    const t = String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t.startsWith('total')) return false;
    if (t.includes('aprobad')) return false;
    return true;
}

function numColumnasDesdeValoresEncabezado(filasDesdeColumnaE) {
    const filas = Array.isArray(filasDesdeColumnaE) ? filasDesdeColumnaE : [];
    for (let r = 0; r < filas.length; r++) {
        const row = filas[r] || [];
        for (let c = 0; c < row.length; c++) {
            if (!textoEsInicioDeTotales(row[c])) continue;
            const n = c;
            if (n >= 1) return Math.min(MAX_CURSOS, n);
        }
    }
    return 0;
}

function detectarNumColumnasCursoEnHoja(ws) {
    const filas = [];
    for (let r = 4; r <= CURSO_NUM_HEADER_ROW; r++) {
        const row = ws.getRow(r);
        const valores = [];
        const tope = CURSO_COL_INICIO + MAX_CURSOS + 3;
        for (let col = CURSO_COL_INICIO; col <= tope; col++) {
            valores.push(celdaATexto(row.getCell(col).value));
        }
        filas.push(valores);
    }
    const detectadas = numColumnasDesdeValoresEncabezado(filas);
    return detectadas > 0 ? Math.max(CURSOS_PLANTILLA, detectadas) : CURSOS_PLANTILLA;
}

/**
 * Inserta o quita columnas de curso en un XLSX local, siempre dejando
 * al menos las 20 de la plantilla. Devuelve el layout con el que se puede escribir.
 */
function ajustarColumnasCursoEnWorksheet(ws, necesarias) {
    const objetivo = layoutColumnas(necesarias).numCursos;
    const actuales = detectarNumColumnasCursoEnHoja(ws);
    if (actuales === objetivo || typeof ws.spliceColumns !== 'function') {
        return layoutColumnas(Math.min(objetivo, Math.max(actuales, CURSOS_PLANTILLA)));
    }
    if (objetivo > actuales) {
        const inserts = Array.from({ length: objetivo - actuales }, () => []);
        ws.spliceColumns(CURSO_COL_INICIO + actuales, 0, ...inserts);
        const origen = CURSO_COL_INICIO + actuales - 1;
        for (let col = CURSO_COL_INICIO + actuales; col < CURSO_COL_INICIO + objetivo; col++) {
            copiarEstiloColumnaCurso(ws, origen, col);
        }
    } else if (actuales > objetivo) {
        ws.spliceColumns(CURSO_COL_INICIO + objetivo, actuales - objetivo);
    }
    return layoutColumnas(objetivo);
}

function copiarEstiloColumnaCurso(ws, origen, destino) {
    try {
        const colOrigen = ws.getColumn(origen);
        const colDestino = ws.getColumn(destino);
        if (colOrigen && colDestino && colOrigen.width) {
            colDestino.width = colOrigen.width;
        }
        const ultima = Math.max(Number(ws.rowCount) || 0, 60);
        for (let r = 1; r <= ultima; r++) {
            const a = ws.getRow(r).getCell(origen);
            const b = ws.getRow(r).getCell(destino);
            if (a && a.style) {
                b.style = JSON.parse(JSON.stringify(a.style));
            }
        }
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo copiar el estilo de la columna:', err.message);
    }
}

function leerColaboradoresDesdeHoja(ws, numCursos = CURSOS_PLANTILLA) {
    const colaboradores = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const nombreCelda = celdaATexto(row.getCell(NOMBRE_COL).value)
            || celdaATexto(row.getCell(1).value)
            || celdaATexto(row.getCell(3).value);
        if (String(nombreCelda || '').toLowerCase().includes('acreditaciones')) {
            break;
        }
        const n = Math.min(MAX_CURSOS, Math.max(CURSOS_PLANTILLA, Number(numCursos) || CURSOS_PLANTILLA));
        const resultados = [];
        for (let i = 0; i < n; i++) {
            resultados.push(normalizarResultado(celdaATexto(row.getCell(CURSO_COL_INICIO + i).value)));
        }
        const fila = sanitizarColaborador({
            nombre: celdaATexto(row.getCell(NOMBRE_COL).value),
            resultados
        }, n);
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

function leerCursosDesdeHoja(ws, numCursos = CURSOS_PLANTILLA) {
    const acredStart = detectarFilaAcreditacionesEnHoja(ws);
    const catalogoStart = detectarFilaCatalogoCursosEnHoja(ws, acredStart);
    const acred = layoutAcredRows(acredStart);
    const n = Math.min(MAX_CURSOS, Math.max(CURSOS_PLANTILLA, Number(numCursos) || CURSOS_PLANTILLA));
    return Array.from({ length: n }, (_, i) => {
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
    const columnas = layoutColumnas(detectarNumColumnasCursoEnHoja(ws));
    const revisionTexto = celdaATexto(ws.getRow(REVISION_CELL.row).getCell(columnas.revisionCol).value);
    const fechaRevTexto = celdaATexto(ws.getRow(FECHA_REV_CELL.row).getCell(columnas.revisionCol).value);
    const cursosLeidos = leerCursosDesdeHoja(ws, columnas.numCursos);
    const primeraFechaCurso = (cursosLeidos.find((c) => !!String(c.fecha || '').trim()) || {}).fecha || '';
    const ultimaConDatos = cursosLeidos.reduce((acc, curso, idx) => (
        esCursoVacio(curso) ? acc : idx
    ), -1);
    const columnasHoja = columnas.numCursos > CURSOS_PLANTILLA
        ? columnas.numCursos
        : Math.max(ultimaConDatos + 1, 1);
    return sanitizarDatos({
        fecha: primeraFechaCurso,
        revision: parsearRevisionDesdeCelda(revisionTexto),
        fechaRevision: parsearFechaRevDesdeCelda(fechaRevTexto),
        numColumnas: columnasHoja,
        cursos: cursosLeidos,
        colaboradores: leerColaboradoresDesdeHoja(ws, columnas.numCursos)
    });
}

function escribirFilaColaborador(row, item, index, cursos, columnas) {
    const cols = columnas || layoutColumnas((cursos || []).length);
    const c = sanitizarColaborador(item, cols.numCursos);
    const activos = indicesCursosActivos(cursos, [c]);
    const metricas = calcularMetricasColaborador(c.resultados, activos.length ? activos : null);
    row.getCell(1).value = index + 1;
    asignarTextoSimple(row.getCell(NOMBRE_COL), nombreColaboradorEnHoja(c.nombre), 'left');
    for (let i = 0; i < cols.numCursos; i++) {
        asignarTextoSimple(row.getCell(CURSO_COL_INICIO + i), c.resultados[i] || '', 'center');
    }
    asignarTextoSimple(row.getCell(cols.totalCol), metricas.total > 0 ? String(metricas.total) : '', 'center');
    asignarTextoSimple(row.getCell(cols.aprobadasCol), metricas.total > 0 ? String(metricas.aprobadas) : '', 'center');
    asignarTextoSimple(
        row.getCell(cols.eficaciaCol),
        metricas.eficacia === null ? '' : `${metricas.eficacia}%`,
        'center'
    );
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    const columnas = ajustarColumnasCursoEnWorksheet(ws, d.cursos.length);
    const n = columnas.numCursos;

    for (let i = 0; i < n; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        asignarTextoSimple(
            ws.getRow(CURSO_FECHA_HEADER_ROW).getCell(CURSO_COL_INICIO + i),
            curso.fecha ? formatearFechaDisplay(curso.fecha) : '',
            'center'
        );
        asignarTextoSimple(
            ws.getRow(CURSO_NUM_HEADER_ROW).getCell(CURSO_COL_INICIO + i),
            String(i + 1),
            'center'
        );
    }

    asignarTextoSimple(
        ws.getRow(REVISION_CELL.row).getCell(columnas.revisionCol),
        `Revisión: ${d.revision}`,
        'left'
    );
    asignarTextoSimple(
        ws.getRow(FECHA_REV_CELL.row).getCell(columnas.revisionCol),
        `Fecha Rev.: ${formatearFechaDisplay(d.fechaRevision)}`,
        'left'
    );

    for (let i = 0; i < MAX_COLABORADORES; i++) {
        escribirFilaColaborador(
            ws.getRow(DATA_START_ROW + i),
            d.colaboradores[i] || COLABORADOR_DEFECTO(n),
            i,
            d.cursos,
            columnas
        );
    }

    const acredStart = detectarFilaAcreditacionesEnHoja(ws);
    const catalogoStart = detectarFilaCatalogoCursosEnHoja(ws, acredStart);
    const acred = layoutAcredRows(acredStart);

    for (let i = 0; i < n; i++) {
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

    for (let i = 0; i < n; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        const col = CURSO_COL_INICIO + i;
        asignarTextoSimple(ws.getRow(acred.dc3).getCell(col), curso.acreditaciones.dc3 ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.diploma).getCell(col), curso.acreditaciones.diploma ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.examen).getCell(col), curso.acreditaciones.examen ? 'X' : '', 'center');
        asignarTextoSimple(ws.getRow(acred.otro).getCell(col), curso.acreditaciones.otro ? 'X' : '', 'center');
    }

    const eficaciaGral = calcularEficaciaGeneral(d.colaboradores, d.cursos);
    asignarTextoSimple(
        ws.getRow(acred.eficaciaGeneral).getCell(columnas.eficaciaCol),
        eficaciaGral === null ? '' : `${eficaciaGral}%`,
        'center'
    );

    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 14;
    for (let r = 4; r <= 8; r++) {
        const fila = ws.getRow(r);
        for (let c = 1; c <= 4; c++) {
            const celda = fila.getCell(c);
            const texto = celdaATexto(celda.value);
            if (/nombre del colaborador/i.test(texto)) {
                asignarTextoSimple(celda, 'Nombre del\ncolaborador', 'left');
            }
        }
    }
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
    const columnas = layout?.totalCol
        ? layout
        : layoutColumnas(layout?.numCursos || d.cursos.length);
    const n = Math.min(MAX_CURSOS, Math.max(CURSOS_PLANTILLA, columnas.numCursos || d.cursos.length));
    const actualizaciones = [];
    const activos = indicesCursosActivos(d.cursos, d.colaboradores);
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

    for (let i = 0; i < n; i++) {
        const curso = sanitizarCurso(d.cursos[i] || CURSO_DEFECTO());
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_COL_INICIO + i)}${CURSO_FECHA_HEADER_ROW}`, sheetTitle),
            values: [[curso.fecha ? formatearFechaDisplay(curso.fecha) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(CURSO_COL_INICIO + i)}${CURSO_NUM_HEADER_ROW}`, sheetTitle),
            values: [[String(i + 1)]]
        });
    }

    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(columnas.revisionCol)}${REVISION_CELL.row}`, sheetTitle),
        values: [[`Revisión: ${d.revision}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(columnas.revisionCol)}${FECHA_REV_CELL.row}`, sheetTitle),
        values: [[`Fecha Rev.: ${formatearFechaDisplay(d.fechaRevision)}`]]
    });

    for (let i = 0; i < numFilas; i++) {
        const rowNum = DATA_START_ROW + i;
        const c = i < filled
            ? (d.colaboradores[i] || COLABORADOR_DEFECTO(n))
            : COLABORADOR_DEFECTO(n);
        const metricas = calcularMetricasColaborador(c.resultados, activos.length ? activos : null);
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(1)}${rowNum}`, sheetTitle),
            values: [[c.nombre ? (i + 1) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(NOMBRE_COL)}${rowNum}`, sheetTitle),
            values: [[nombreColaboradorEnHoja(c.nombre)]]
        });
        for (let j = 0; j < n; j++) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(CURSO_COL_INICIO + j)}${rowNum}`, sheetTitle),
                values: [[c.resultados[j] || '']]
            });
        }
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(columnas.totalCol)}${rowNum}`, sheetTitle),
            values: [[metricas.total > 0 ? String(metricas.total) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(columnas.aprobadasCol)}${rowNum}`, sheetTitle),
            values: [[metricas.total > 0 ? String(metricas.aprobadas) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(columnas.eficaciaCol)}${rowNum}`, sheetTitle),
            values: [[metricas.eficacia === null ? '' : `${metricas.eficacia}%`]]
        });
    }

    for (let i = 0; i < n; i++) {
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

    for (let i = 0; i < n; i++) {
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
        range: rangoSheet(`${columnaALetra(columnas.eficaciaCol)}${acred.eficaciaGeneral}`, sheetTitle),
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
async function obtenerSheetIdAthF08(spreadsheetId, sheetTitle) {
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    return sheetId === undefined || sheetId === null ? null : sheetId;
}

async function detectarNumColumnasCursoEnDrive(spreadsheetId, sheetTitle) {
    try {
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const fin = columnaALetra(CURSO_COL_INICIO + MAX_CURSOS + 3);
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetTitle}'!${columnaALetra(CURSO_COL_INICIO)}4:${fin}${CURSO_NUM_HEADER_ROW}`,
            majorDimension: 'ROWS'
        });
        const detectadas = numColumnasDesdeValoresEncabezado(res.data.values || []);
        if (detectadas > 0) {
            return Math.min(MAX_CURSOS, Math.max(CURSOS_PLANTILLA, detectadas));
        }
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo detectar columnas de cursos:', err.message);
    }
    return CURSOS_PLANTILLA;
}

/**
 * Crea o quita columnas de calificación en el Sheet.
 * Nunca deja menos de las 20 columnas de la plantilla.
 * Devuelve cuántas quedaron.
 */
async function ajustarColumnasCursosEnDrive(spreadsheetId, sheetTitle, necesarias) {
    const objetivo = layoutColumnas(necesarias).numCursos;
    const actuales = await detectarNumColumnasCursoEnDrive(spreadsheetId, sheetTitle);
    if (!spreadsheetId || !sheetTitle || actuales === objetivo) {
        return actuales;
    }
    const sheetId = await obtenerSheetIdAthF08(spreadsheetId, sheetTitle);
    if (sheetId === null) return actuales;

    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    if (objetivo > actuales) {
        const startIndex = (CURSO_COL_INICIO - 1) + actuales;
        const cantidad = objetivo - actuales;
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId,
                            dimension: 'COLUMNS',
                            startIndex,
                            endIndex: startIndex + cantidad
                        },
                        inheritFromBefore: true
                    }
                }]
            }
        });
        console.log(`[ATH-F-08] Columnas de curso: ${actuales} → ${objetivo} (insertadas ${cantidad}).`);
        return objetivo;
    }

    const conservar = Math.max(CURSOS_PLANTILLA, objetivo);
    if (actuales > conservar) {
        const startIndex = (CURSO_COL_INICIO - 1) + conservar;
        const endIndex = (CURSO_COL_INICIO - 1) + actuales;
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId,
                            dimension: 'COLUMNS',
                            startIndex,
                            endIndex
                        }
                    }
                }]
            }
        });
        console.log(`[ATH-F-08] Columnas de curso: ${actuales} → ${conservar} (eliminadas ${actuales - conservar}).`);
        return conservar;
    }
    return actuales;
}

async function contarFilasCatalogoExtraEnDrive(spreadsheetId, sheetTitle, catalogoStart) {
    const inicio = Number(catalogoStart) + CURSOS_PLANTILLA;
    if (!inicio || inicio < 1) return 0;
    try {
        const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
        const fin = inicio + MAX_CURSOS;
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetTitle}'!A${inicio}:A${fin}`,
            majorDimension: 'ROWS'
        });
        const values = res.data.values || [];
        let extras = 0;
        for (let i = 0; i < values.length; i++) {
            const marca = String((values[i] || [])[0] || '').trim();
            if (marca === String(CURSOS_PLANTILLA + extras + 1)) {
                extras += 1;
                continue;
            }
            break;
        }
        return extras;
    } catch (err) {
        console.warn('[ATH-F-08] No se pudieron contar filas extra del catálogo:', err.message);
        return 0;
    }
}

async function eliminarFilasEnDrive(spreadsheetId, sheetTitle, filaInicio, cantidad) {
    const n = Math.max(0, Number(cantidad) || 0);
    const fila = Math.max(1, Number(filaInicio) || 1);
    if (!spreadsheetId || !sheetTitle || n <= 0) return false;
    const sheetId = await obtenerSheetIdAthF08(spreadsheetId, sheetTitle);
    if (sheetId === null) return false;
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const startIndex = fila - 1;
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex,
                        endIndex: startIndex + n
                    }
                }
            }]
        }
    });
    return true;
}

/**
 * El catálogo de la plantilla tiene 20 renglones. Si hay más cursos,
 * agrega renglones; si bajan a 20 o menos, quita solo los extra.
 */
async function ajustarFilasCatalogoEnDrive(spreadsheetId, sheetTitle, catalogoStart, numCursos) {
    const objetivo = layoutColumnas(numCursos).numCursos;
    const extras = await contarFilasCatalogoExtraEnDrive(spreadsheetId, sheetTitle, catalogoStart);
    const existentes = CURSOS_PLANTILLA + extras;
    if (objetivo > existentes) {
        const faltan = objetivo - existentes;
        await insertarFilasColaboradoresEnDrive(
            spreadsheetId,
            sheetTitle,
            Number(catalogoStart) + existentes,
            faltan
        );
        return true;
    }
    if (existentes > objetivo && existentes > CURSOS_PLANTILLA) {
        const quitar = existentes - Math.max(objetivo, CURSOS_PLANTILLA);
        await eliminarFilasEnDrive(
            spreadsheetId,
            sheetTitle,
            Number(catalogoStart) + Math.max(objetivo, CURSOS_PLANTILLA),
            quitar
        );
        return true;
    }
    return false;
}

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

    const nombresDb = contarCursosConNombreAthF08(db);
    const nombresDrive = contarCursosConNombreAthF08(drive);
    const preferirCursosDb = nombresDb > nombresDrive
        || (nombresDb === nombresDrive && db.cursos.length >= drive.cursos.length);
    const preferirColabDb = contarColaboradoresConNombreAthF08(db) >= contarColaboradoresConNombreAthF08(drive);
    const cursosBase = preferirCursosDb ? db.cursos : drive.cursos;
    const cursosAlt = preferirCursosDb ? drive.cursos : db.cursos;
    const totalCursos = Math.min(MAX_CURSOS, Math.max(cursosBase.length, cursosAlt.length));
    const cursos = [];
    for (let i = 0; i < totalCursos; i++) {
        const curso = cursosBase[i] || CURSO_DEFECTO();
        const alt = cursosAlt[i] || CURSO_DEFECTO();
        cursos.push(sanitizarCurso({
            nombre: curso.nombre || alt.nombre,
            fecha: curso.fecha || alt.fecha,
            acreditaciones: {
                dc3: !!(curso.acreditaciones.dc3 || alt.acreditaciones.dc3),
                diploma: !!(curso.acreditaciones.diploma || alt.acreditaciones.diploma),
                examen: !!(curso.acreditaciones.examen || alt.acreditaciones.examen),
                otro: !!(curso.acreditaciones.otro || alt.acreditaciones.otro)
            }
        }));
    }

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
            filaMax,
            { numCursos: d.cursos.length }
        );
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function aplicarPresentacionNombreEnDrive(spreadsheetId, sheetTitle) {
    const titulo = String(sheetTitle || '').trim();
    if (!spreadsheetId || !titulo) return;
    const sheetId = await obtenerSheetIdAthF08(spreadsheetId, titulo);
    if (sheetId === null) return;
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 1,
                    endIndex: 4
                },
                properties: { pixelSize: 120 },
                fields: 'pixelSize'
            }
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: DATA_START_ROW - 1,
                    endRowIndex: DATA_END_ROW,
                    startColumnIndex: 1,
                    endColumnIndex: 4
                },
                cell: {
                    userEnteredFormat: {
                        wrapStrategy: 'CLIP',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'
            }
        }
    ];
    try {
        const encabezado = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `'${titulo}'!A4:D8`
        });
        const filas = encabezado.data.values || [];
        filas.forEach((fila, r) => {
            (fila || []).forEach((valor, c) => {
                const texto = String(valor || '');
                if (!/nombre del colaborador/i.test(texto) || texto.includes('\n')) return;
                requests.push({
                    repeatCell: {
                        range: {
                            sheetId,
                            startRowIndex: 3 + r,
                            endRowIndex: 4 + r,
                            startColumnIndex: c,
                            endColumnIndex: c + 1
                        },
                        cell: {
                            userEnteredValue: { stringValue: 'Nombre del\ncolaborador' },
                            userEnteredFormat: {
                                wrapStrategy: 'WRAP',
                                verticalAlignment: 'MIDDLE'
                            }
                        },
                        fields: 'userEnteredValue,userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'
                    }
                });
                void celda;
            });
        });
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo leer el encabezado del nombre:', err.message);
    }
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const d = sanitizarDatos(datos);
    const filled = d.colaboradores.filter((c) => !esColaboradorVacio(c)).length;
    let numCursos = layoutColumnas(d.cursos.length).numCursos;
    try {
        numCursos = await ajustarColumnasCursosEnDrive(spreadsheetId, titulo, numCursos);
    } catch (err) {
        console.warn('[ATH-F-08] No se pudieron ajustar columnas de cursos:', err.message);
        numCursos = await detectarNumColumnasCursoEnDrive(spreadsheetId, titulo);
    }
    const columnas = layoutColumnas(Math.min(numCursos, d.cursos.length));
    const layoutFilas = await asegurarFilasColaboradoresEnDrive(spreadsheetId, titulo, Math.max(filled, 1));
    try {
        await ajustarFilasCatalogoEnDrive(
            spreadsheetId,
            titulo,
            layoutFilas.catalogoStart,
            columnas.numCursos
        );
    } catch (err) {
        console.warn('[ATH-F-08] No se pudieron ajustar filas del catálogo:', err.message);
    }
    const layout = { ...layoutFilas, ...columnas };
    const actualizaciones = datosAActualizacionesSheet(d, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualAthF08(spreadsheetId, titulo, d, layout);
    try {
        await aplicarPresentacionNombreEnDrive(spreadsheetId, titulo);
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo ajustar el ancho del nombre:', err.message);
    }
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
        numColumnas: d.numColumnas,
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
    const activos = indicesCursosActivos(d.cursos, d.colaboradores);
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
        cursos: d.cursos.length ? d.cursos.slice() : [CURSO_DEFECTO()],
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

async function aplanarNombresColaboradorParaPdf(spreadsheetId, sheetTitle) {
    const titulo = String(sheetTitle || '').trim();
    if (!spreadsheetId || !titulo) return;
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const fin = DATA_START_ROW + MAX_COLABORADORES - 1;
    const lectura = `'${titulo}'!B${DATA_START_ROW}:B${fin}`;
    const got = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: lectura });
    const filas = got.data.values || [];
    const data = filas.map((fila) => [
        String((fila && fila[0]) || '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s+/g, ' ').trim()
    ]);
    const haySalto = filas.some((fila) => /[\r\n]/.test(String((fila && fila[0]) || '')));
    if (haySalto && data.length) {
        const end = DATA_START_ROW + data.length - 1;
        await sheetsApi.spreadsheets.values.update({
            spreadsheetId,
            range: `'${titulo}'!B${DATA_START_ROW}:B${end}`,
            valueInputOption: 'RAW',
            requestBody: { values: data }
        });
    }
    await aplicarPresentacionNombreEnDrive(spreadsheetId, titulo);
}

/**
 * El catálogo del PDF usa la columna B, que es angosta y parte el nombre.
 * Se ensancha solo mientras se exporta la página de cursos y luego se restaura.
 */
async function presentarCursosEnUnaFilaParaPdf(spreadsheetId, sheetTitle) {
    const titulo = String(sheetTitle || '').trim();
    const restaurarNada = async () => {};
    if (!spreadsheetId || !titulo) return restaurarNada;

    const acredStart = await detectarFilaAcreditacionesEnDrive(spreadsheetId, titulo);
    const catalogoStart = await detectarFilaCatalogoCursosEnDrive(spreadsheetId, titulo, acredStart);
    const numCursos = await detectarNumColumnasCursoEnDrive(spreadsheetId, titulo);
    const fin = catalogoStart + Math.max(1, numCursos) - 1;
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const sheetId = await obtenerSheetIdAthF08(spreadsheetId, titulo);
    if (sheetId === null) return restaurarNada;

    const lectura = `'${titulo}'!B${catalogoStart}:B${fin}`;
    const got = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: lectura });
    const originales = (got.data.values || []).map((fila) => String((fila && fila[0]) || ''));
    const planos = originales.map((texto) => texto.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s+/g, ' ').trim());
    const haySalto = originales.some((texto, i) => texto !== planos[i]);
    if (haySalto && planos.length) {
        await sheetsApi.spreadsheets.values.update({
            spreadsheetId,
            range: `'${titulo}'!B${catalogoStart}:B${catalogoStart + planos.length - 1}`,
            valueInputOption: 'RAW',
            requestBody: { values: planos.map((texto) => [texto]) }
        });
    }

    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        ranges: [lectura],
        fields: 'sheets(data(rowMetadata(pixelSize),columnMetadata(pixelSize)))'
    });
    const bloque = (meta.data.sheets || [])[0]?.data?.[0] || {};
    const anchoPrevio = Number(bloque.columnMetadata?.[0]?.pixelSize) || 120;
    const altos = (bloque.rowMetadata || []).map((fila) => Number(fila?.pixelSize) || 21);
    const startRow = catalogoStart - 1;
    const endRow = fin;

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    updateDimensionProperties: {
                        range: {
                            sheetId,
                            dimension: 'COLUMNS',
                            startIndex: 1,
                            endIndex: 2
                        },
                        properties: { pixelSize: 460 },
                        fields: 'pixelSize'
                    }
                },
                {
                    updateDimensionProperties: {
                        range: {
                            sheetId,
                            dimension: 'ROWS',
                            startIndex: startRow,
                            endIndex: endRow
                        },
                        properties: { pixelSize: 21 },
                        fields: 'pixelSize'
                    }
                },
                {
                    repeatCell: {
                        range: {
                            sheetId,
                            startRowIndex: startRow,
                            endRowIndex: endRow,
                            startColumnIndex: 1,
                            endColumnIndex: 2
                        },
                        cell: {
                            userEnteredFormat: {
                                wrapStrategy: 'CLIP',
                                verticalAlignment: 'MIDDLE'
                            }
                        },
                        fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'
                    }
                }
            ]
        }
    });

    return async () => {
        const requests = [
            {
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'COLUMNS',
                        startIndex: 1,
                        endIndex: 2
                    },
                    properties: { pixelSize: anchoPrevio },
                    fields: 'pixelSize'
                }
            },
            {
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: startRow,
                        endRowIndex: endRow,
                        startColumnIndex: 1,
                        endColumnIndex: 2
                    },
                    cell: {
                        userEnteredFormat: {
                            wrapStrategy: 'WRAP',
                            verticalAlignment: 'MIDDLE'
                        }
                    },
                    fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'
                }
            }
        ];
        let i = 0;
        while (i < altos.length) {
            const px = altos[i];
            let j = i + 1;
            while (j < altos.length && altos[j] === px) j += 1;
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: startRow + i,
                        endIndex: startRow + j
                    },
                    properties: { pixelSize: px },
                    fields: 'pixelSize'
                }
            });
            i = j;
        }
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
        if (haySalto && originales.length) {
            await sheetsApi.spreadsheets.values.update({
                spreadsheetId,
                range: `'${titulo}'!B${catalogoStart}:B${catalogoStart + originales.length - 1}`,
                valueInputOption: 'RAW',
                requestBody: { values: originales.map((texto) => [texto]) }
            });
        }
    };
}

async function exportarPdfAthF08DosPaginas(driveFileId, gid, sheetTitle) {
    const titulo = String(sheetTitle || SHEET_TITLE).trim() || SHEET_TITLE;
    try {
        await aplanarNombresColaboradorParaPdf(driveFileId, titulo);
    } catch (err) {
        console.warn('[ATH-F-08] No se pudieron dejar los nombres en un renglón para el PDF:', err.message);
    }
    const acredStart = await detectarFilaAcreditacionesEnDrive(driveFileId, titulo);
    const catalogoStart = await detectarFilaCatalogoCursosEnDrive(driveFileId, titulo, acredStart);
    const acred = layoutAcredRows(acredStart);

    // Página 1: encabezado + matriz + bloque Acreditaciones / eficacia general.
    const numCursosPdf = await detectarNumColumnasCursoEnDrive(driveFileId, titulo);
    const columnasPdf = layoutColumnas(numCursosPdf);
    const finPagina1 = Math.max(acred.otro, DATA_START_ROW + 1);
    // Página 2: encabezado «Curso» (si existe) + catálogo de cursos.
    const inicioPagina2 = Math.max(finPagina1 + 1, catalogoStart - 1, 1);
    const finPagina2 = Math.max(inicioPagina2 + 1, catalogoStart + columnasPdf.numCursos) + 1;

    const optsBase = {
        ...OPCIONES_PDF_IMPRESION,
        ...(gid != null ? { gid } : {})
    };

    let buf1;
    let buf2;
    try {
        buf1 = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
            ...optsBase,
            range: { r1: 0, c1: 0, r2: finPagina1, c2: columnasPdf.eficaciaCol }
        });
        let restaurarCursosPdf = async () => {};
        try {
            restaurarCursosPdf = await presentarCursosEnUnaFilaParaPdf(driveFileId, titulo);
            buf2 = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
                ...optsBase,
                range: {
                    r1: inicioPagina2 - 1,
                    c1: 0,
                    r2: finPagina2,
                    c2: PDF_MAX_COLUMNAS_CATALOGO
                }
            });
        } finally {
            await restaurarCursosPdf().catch((err) => {
                console.warn('[ATH-F-08] No se pudo restaurar el catálogo tras el PDF:', err.message);
            });
        }
    } catch (err) {
        console.warn('[ATH-F-08] Export PDF por rangos falló, usando hoja completa:', err.message);
        return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
    }

    try {
        const { PDFDocument } = require('pdf-lib');
        const out = await PDFDocument.create();
        for (const buf of [buf1, buf2]) {
            if (!buf || !buf.length) continue;
            const doc = await PDFDocument.load(Buffer.from(buf), { ignoreEncryption: true });
            const pages = await out.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => out.addPage(p));
        }
        if (!out.getPageCount()) {
            return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
        }
        return Buffer.from(await out.save());
    } catch (err) {
        console.warn('[ATH-F-08] No se pudo unir PDFs de 2 páginas:', err.message);
        return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
    }
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId) {
        driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
    }
    if (!driveFileId) {
        throw new Error('No hay archivo ATH-F-08 en Drive para exportar a PDF.');
    }

    let tituloHoja = SHEET_TITLE;
    let gid = null;
    const info = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
        try {
            tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo resolver la hoja vigente para PDF:', err.message);
        }
        try {
            gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
        } catch (err) {
            console.warn('[ATH-F-08] No se pudo resolver gid de hoja para PDF:', err.message);
        }
    }

    const pdfBuffer = await exportarPdfAthF08DosPaginas(driveFileId, gid, tituloHoja);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de ATH-F-08 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
}

module.exports = {
    CODIGO_FORMATO,
    NOMBRE_PDF_ARCHIVO,
    OPCIONES_PDF_IMPRESION,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    sanitizarDatos,
    calcularEficaciaGeneral,
    calcularMetricasColaborador
};
