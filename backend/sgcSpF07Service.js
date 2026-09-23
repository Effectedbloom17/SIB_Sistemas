/**
 * SP-F-07 · Plan del curso.
 * Multi-plan archivero (una pestaña por plan) + persistencia biznaga_sgc.
 * Arquetipo: sgcF22Service (archivero) SIN PDF firmado.
 * TEMPLATE_DRIVE_ID = archivo de trabajo en carpeta sistema.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SP-F-07';
const TEMPLATE_DRIVE_ID = '1p0XiIIwWth04aKYTs6XYldsy4yNvHGdbJWfWEfYVs4w';
const DRIVE_FILE_ID_SISTEMA = '1p0XiIIwWth04aKYTs6XYldsy4yNvHGdbJWfWEfYVs4w';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SP-F-07 Plan del curso (sistema)';
const SHEET_TITLE = 'plantilla';
const TIMEZONE_MEXICO = 'America/Mexico_City';
const MAX_COLUMNAS_SISTEMA = 13;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

const MOMENTOS_FILA_INICIO_BASE = 32;
const MOMENTOS_FILA_FIN_BASE = 34;
const REFERENCIAS_MIN = 5;
const REFERENCIAS_MAX_HOJA = 20;
const MOMENTOS_MAX_HOJA = 30;
const OBJETIVOS_PARTICULARES_FILA = 24;

/** Mapa de celdas fijas (1-based) — bloques dinámicos se resuelven en runtime. */
const CELLS = {
    revision: { row: 2, col: 12 },
    nombreCurso: { row: 7, col: 6 },
    proposito: { row: 8, col: 6 },
    instructor: { row: 9, col: 6 },
    fechaPeriodo: { row: 10, col: 6 },
    duracion: { row: 11, col: 6 },
    lugar: { row: 12, col: 6 },
    numParticipantes: { row: 13, col: 6 },
    nivelEstudios: { row: 17, col: 4 },
    conocimientosRequeridos: { row: 18, col: 4 },
    habilidadesRequeridas: { row: 19, col: 4 },
    objetivoGeneral: { row: 23, col: 3 },
    objetivosParticulares: { row: OBJETIVOS_PARTICULARES_FILA, col: 3 },
    recursosDidacticos: { row: 28, col: 3 },
    equipoApoyo: { row: 29, col: 3 },
    momento: { col: 1 },
    fecha: { col: 3 },
    horaInicio: { col: 4 },
    contenidoTematico: { col: 5 },
    descripcionActividades: { col: 8 },
    horaTermino: { col: 10 },
    tecnicasInstruccionales: { col: 11 },
    tecnicasGrupales: { col: 12 },
    duracionMomento: { col: 13 },
    tiempoTotalCol: 13,
    metodoEvaluacionCol: 5,
    referenciasStartCol: 2,
    referenciaNumeroCol: 1
};

const LEYENDA_MOMENTOS = {
    1: 'Momentos de la capacitación',
    3: 'Fecha',
    4: 'Hora de inicio',
    5: 'Contenido temático',
    8: 'Descripción de actividades / subtemas',
    10: 'Hora de termino',
    11: 'Técnicas instruccionales',
    12: 'Técnicas grupales',
    13: 'Duración'
};

const SECCIONES_MOMENTO = ['Apertura', 'Desarrollo', 'Cierre'];

function layoutPorDefecto() {
    return {
        objetivoGeneral: 23,
        particularesInicio: OBJETIVOS_PARTICULARES_FILA,
        particularesFin: OBJETIVOS_PARTICULARES_FILA,
        recursosTitulo: 26,
        recursosDidacticos: 28,
        equipoApoyo: 29,
        leyendaMomentos: 31,
        momentosInicio: MOMENTOS_FILA_INICIO_BASE,
        momentosFin: MOMENTOS_FILA_FIN_BASE,
        tiempoTotal: 35,
        metodoEvaluacion: 37,
        refsTitulo: 39,
        refsInicio: 41,
        refsFin: 41
    };
}

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-08',
    fechaElaboracion: '2025-01-08',
    planes: [],
    planActivoId: null
};

function sanitizarNombreHojaFolio(folio) {
    return String(folio || '').trim().toUpperCase()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function resolverNombreHojaPlan(datos) {
    const plan = resolverPlanActivo(sanitizarDatos(datos));
    const folio = sanitizarNombreHojaFolio(plan?.folio);
    if (folio) return folio;
    const id = String(plan?.id || '').trim();
    if (id) return `BORRADOR-${id.slice(0, 8)}`;
    return 'Sin-folio';
}

function esHojaPlanSpF07(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t.toLowerCase() === SHEET_TITLE.toLowerCase()) return false;
    return /^PC-/i.test(t) || /^BORRADOR-/i.test(t);
}

function datosConPlanActivo(datos, plan) {
    return sanitizarDatos({
        ...(datos || {}),
        planActivoId: plan?.id || null
    });
}

async function resolverTituloHojaTrabajo(spreadsheetId, datos = null) {
    if (datos) {
        return resolverNombreHojaPlan(datos);
    }
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const folioSheet = titulos.find((t) => /^PC-/i.test(String(t || '').trim()));
        if (folioSheet) return folioSheet;
        const borrador = titulos.find((t) => /^BORRADOR-/i.test(String(t || '').trim()));
        if (borrador) return borrador;
    } catch {
        // Sin listado de hojas.
    }
    return SHEET_TITLE;
}

async function leerDatosDesdeHojaGoogleSheet(spreadsheetId, sheetTitle) {
    const buffer = await descargarBufferDrive(spreadsheetId);
    return leerDatosDesdeBuffer(buffer, { modo: 'edicion', sheetTitle });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const tituloPreferido = String(opciones.sheetTitle || '').trim();
    const ws = tituloPreferido
        ? (wb.getWorksheet(tituloPreferido) || resolverHojaWorkbook(wb, opciones.modo))
        : resolverHojaWorkbook(wb, opciones.modo);
    if (!ws) throw new Error('La plantilla SP-F-07 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function sincronizarHojasPlanesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    );

    if (!plantillaOrigen) {
        console.warn(
            '[SP-F-07] Hoja plantilla «plantilla» no encontrada en el spreadsheet. '
            + `Hojas: ${titulosExistentes.join(', ') || '(ninguna)'}`
        );
    }

    const mapaIdHojaPrevio = new Map();
    if (prev?.planes) {
        for (const p of prev.planes) {
            mapaIdHojaPrevio.set(p.id, resolverNombreHojaPlan(datosConPlanActivo(meta, p)));
        }
    }

    const activoId = String(meta.planActivoId || '').trim();
    const nombresVigentes = new Set();
    for (const plan of meta.planes) {
        const tieneFolio = !!String(plan.folio || '').trim();
        if (!planTieneContenido(plan) && !tieneFolio) continue;
        nombresVigentes.add(resolverNombreHojaPlan(datosConPlanActivo(meta, plan)));
    }

    const hojasActualizadas = new Set();

    for (const plan of meta.planes) {
        const tieneFolio = !!String(plan.folio || '').trim();
        if (!planTieneContenido(plan) && !tieneFolio) continue;

        let nombreHoja = resolverNombreHojaPlan(datosConPlanActivo(meta, plan));
        const hojaPrev = mapaIdHojaPrevio.get(plan.id);
        const esActivo = !!activoId && plan.id === activoId;

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SP-F-07] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
            }
        }

        const existeHoja = setExistentes.has(nombreHoja);
        if (!existeHoja) {
            if (!esActivo) {
                continue;
            }
            try {
                const dup = await driveService.duplicarHojaGoogleSheet(
                    spreadsheetId,
                    plantillaOrigen || SHEET_TITLE,
                    nombreHoja
                );
                nombreHoja = dup.title;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SP-F-07] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        hojasActualizadas.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(
            spreadsheetId,
            datosConPlanActivo(meta, plan),
            nombreHoja
        );
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (String(titulo || '').toLowerCase() === SHEET_TITLE) continue;
        if (esHojaPlanSpF07(titulo) && !nombresVigentes.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SP-F-07] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return hojasActualizadas;
}

function nuevoIdPlan() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `pc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function crearMomentoVacio(momento = '') {
    return {
        momento: String(momento || ''),
        fecha: '',
        horaInicio: '',
        contenidoTematico: '',
        descripcionActividades: '',
        horaTermino: '',
        tecnicasInstruccionales: '',
        tecnicasGrupales: '',
        duracion: ''
    };
}

function crearPlanVacio() {
    return {
        id: nuevoIdPlan(),
        folio: '',
        nombreHoja: '',
        nombreCurso: '',
        proposito: '',
        instructor: '',
        fechaPeriodo: '',
        duracion: '',
        lugar: '',
        numParticipantes: '',
        nivelEstudios: '',
        conocimientosRequeridos: '',
        habilidadesRequeridas: '',
        objetivoGeneral: '',
        objetivosParticulares: [''],
        recursosDidacticos: '',
        equipoApoyo: '',
        momentos: [
            crearMomentoVacio('Apertura'),
            crearMomentoVacio('Desarrollo'),
            crearMomentoVacio('Cierre')
        ],
        tiempoTotal: '',
        metodoEvaluacion: '',
        referencias: ['']
    };
}

function sanitizarMomento(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        momento: String(base.momento || '').trim(),
        fecha: normalizarFechaInputSpF07(base.fecha),
        horaInicio: normalizarHoraInputSpF07(base.horaInicio),
        contenidoTematico: normalizarSaltosLinea(base.contenidoTematico),
        descripcionActividades: normalizarSaltosLinea(base.descripcionActividades),
        horaTermino: normalizarHoraInputSpF07(base.horaTermino),
        tecnicasInstruccionales: normalizarSaltosLinea(base.tecnicasInstruccionales),
        tecnicasGrupales: normalizarSaltosLinea(base.tecnicasGrupales),
        duracion: String(base.duracion || '').trim()
    };
}

function normalizarFechaInputSpF07(valor) {
    const raw = String(valor == null ? '' : valor).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        const d = m[1].padStart(2, '0');
        const mo = m[2].padStart(2, '0');
        let y = m[3];
        if (y.length === 2) y = `20${y}`;
        return `${y}-${mo}-${d}`;
    }
    const iso = formatearFechaIso(raw);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : raw;
}

function normalizarHoraInputSpF07(valor) {
    const raw = String(valor == null ? '' : valor).trim();
    if (!raw) return '';
    // 24h: 09:15 / 9:15:00
    let m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
    if (m) {
        return `${String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0')}:${m[2]}`;
    }
    // 12h: 9:15 a.m. / 1:47 pm
    m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\.?$/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2];
        const esPm = /^p/i.test(String(m[3]).replace(/\s/g, ''));
        if (esPm && h < 12) h += 12;
        if (!esPm && h === 12) h = 0;
        return `${String(Math.min(23, h)).padStart(2, '0')}:${min}`;
    }
    return raw;
}

/** Hora legible para hoja/PDF: «9:15 a.m.» / «1:47 p.m.» */
function formatearHoraAmPmSpF07(valor) {
    const n = normalizarHoraInputSpF07(valor);
    if (!n || !/^\d{2}:\d{2}$/.test(n)) {
        return String(valor == null ? '' : valor).trim();
    }
    const [hs, ms] = n.split(':').map((x) => parseInt(x, 10));
    const sufijo = hs >= 12 ? 'p.m.' : 'a.m.';
    let h12 = hs % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(ms).padStart(2, '0')} ${sufijo}`;
}

/** Para values.update USER_ENTERED: el ' evita que Sheets convierta a TIME y quite a.m./p.m. */
function horaParaSheetsSpF07(valor) {
    const texto = formatearHoraAmPmSpF07(valor);
    if (!texto) return '';
    return texto.startsWith("'") ? texto : `'${texto}`;
}

function fechaParaHojaSpF07(valor) {
    const iso = normalizarFechaInputSpF07(valor);
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(valor || '').trim();
    return `${m[3]}/${m[2]}/${m[1]}`;
}

function sanitizarListaTextos(raw, minimo = 1) {
    let lista = [];
    if (Array.isArray(raw)) {
        lista = raw.map((r) => String(r == null ? '' : r).trim());
    } else if (typeof raw === 'string' && raw.trim()) {
        lista = raw.split(/\r?\n+/).map((r) => r.trim()).filter(Boolean);
    }
    if (!lista.length) lista = Array.from({ length: Math.max(1, minimo) }, () => '');
    while (lista.length < minimo) lista.push('');
    return lista;
}

function sanitizarReferencias(raw) {
    return sanitizarListaTextos(raw, REFERENCIAS_MIN);
}

function sanitizarObjetivosParticulares(raw) {
    return sanitizarListaTextos(raw, 1);
}

function sanitizarPlan(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let momentosTablas = null;
    if (Array.isArray(base.momentosTablas) && base.momentosTablas.length) {
        momentosTablas = base.momentosTablas.map((t) => ({
            id: String(t?.id || nuevoIdPlan()),
            momentos: Array.isArray(t?.momentos) ? t.momentos.map(sanitizarMomento) : []
        }));
    }
    let momentos = Array.isArray(base.momentos)
        ? base.momentos.map(sanitizarMomento)
        : [];
    if (momentosTablas) {
        momentos = momentosTablas.flatMap((t) => t.momentos || []);
    }
    const plan = {
        id: String(base.id || '').trim() || nuevoIdPlan(),
        folio: String(base.folio || '').trim().toUpperCase(),
        nombreHoja: String(base.nombreHoja || '').trim(),
        nombreCurso: String(base.nombreCurso || '').trim(),
        proposito: normalizarSaltosLinea(base.proposito),
        instructor: String(base.instructor || '').trim(),
        fechaPeriodo: String(base.fechaPeriodo || '').trim(),
        duracion: String(base.duracion || '').trim(),
        lugar: String(base.lugar || '').trim(),
        numParticipantes: String(base.numParticipantes || '').trim(),
        nivelEstudios: String(base.nivelEstudios || '').trim(),
        conocimientosRequeridos: normalizarSaltosLinea(base.conocimientosRequeridos),
        habilidadesRequeridas: normalizarSaltosLinea(base.habilidadesRequeridas),
        objetivoGeneral: normalizarSaltosLinea(base.objetivoGeneral),
        objetivosParticulares: sanitizarObjetivosParticulares(base.objetivosParticulares),
        recursosDidacticos: normalizarSaltosLinea(base.recursosDidacticos),
        equipoApoyo: normalizarSaltosLinea(base.equipoApoyo),
        momentos,
        tiempoTotal: String(base.tiempoTotal || '').trim(),
        metodoEvaluacion: normalizarSaltosLinea(base.metodoEvaluacion),
        referencias: sanitizarReferencias(base.referencias)
    };
    if (momentosTablas) {
        plan.momentosTablas = momentosTablas;
    }
    return plan;
}

function esPlanLegacyPlano(base) {
    return !Array.isArray(base.planes)
        && (
            base.folio
            || base.nombreCurso
            || base.instructor
            || base.proposito
            || base.objetivoGeneral
            || (Array.isArray(base.momentos) && base.momentos.length)
        );
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let planesRaw = [];
    if (Array.isArray(base.planes)) {
        planesRaw = base.planes;
    } else if (esPlanLegacyPlano(base)) {
        planesRaw = [base];
    }
    const planes = planesRaw.map(sanitizarPlan);
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        planes,
        planActivoId: base.planActivoId ? String(base.planActivoId) : null
    };
}

function resolverPlanActivo(datos) {
    const lista = Array.isArray(datos?.planes) ? datos.planes : [];
    if (!lista.length) return crearPlanVacio();
    const id = datos?.planActivoId;
    if (id) {
        const found = lista.find((p) => p.id === id);
        if (found) return found;
    }
    return lista[0];
}

function textoTieneContenido(valor) {
    return String(valor || '').trim().length > 0;
}

function momentoTieneContenido(m) {
    if (!m) return false;
    return [
        m.momento, m.fecha, m.horaInicio, m.contenidoTematico,
        m.descripcionActividades, m.horaTermino,
        m.tecnicasInstruccionales, m.tecnicasGrupales, m.duracion
    ].some(textoTieneContenido);
}

function planTieneContenido(p) {
    if (!p) return false;
    const particulares = Array.isArray(p.objetivosParticulares)
        ? p.objetivosParticulares.join('\n')
        : p.objetivosParticulares;
    return [
        p.folio, p.nombreCurso, p.proposito, p.instructor, p.fechaPeriodo,
        p.duracion, p.lugar, p.numParticipantes, p.nivelEstudios,
        p.conocimientosRequeridos, p.habilidadesRequeridas,
        p.objetivoGeneral, particulares,
        p.recursosDidacticos, p.equipoApoyo, p.tiempoTotal, p.metodoEvaluacion
    ].some(textoTieneContenido)
        || (Array.isArray(p.momentos) && p.momentos.some(momentoTieneContenido))
        || (Array.isArray(p.referencias) && p.referencias.some(textoTieneContenido));
}

function camposPrincipalesConContenido(datos) {
    if (!datos) return false;
    return Array.isArray(datos.planes) && datos.planes.some(planTieneContenido);
}

function camposPrincipalesVacios(datos) {
    return !camposPrincipalesConContenido(datos);
}

function fusionarDatosPreferirDb(datosDrive, datosDb) {
    if (!datosDb) return datosDrive;
    if (!datosDrive) return datosDb;
    if (camposPrincipalesConContenido(datosDb) || Array.isArray(datosDb.planes)) {
        return sanitizarDatos({
            ...datosDrive,
            ...datosDb,
            planes: datosDb.planes
        });
    }
    return datosDrive;
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

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const texto = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return texto.slice(0, 10);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(d);
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

function fechaHoyIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(new Date());
}

function necesitaRehidratarDriveDesdeDb(datosDrive, datosDb) {
    return !!datosDb
        && camposPrincipalesVacios(datosDrive)
        && camposPrincipalesConContenido(datosDb);
}

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const base = sanitizarDatos(datos);
        delete base.revision;
        delete base.fechaRevision;
        delete base.fechaElaboracion;
        delete base.planActivoId;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function estructuraEsEquivalente() {
    return true;
}

function leerCelda(ws, row, col) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function asignarTexto(celda, texto, horizontal = 'left', vertical = 'middle') {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical,
        wrapText: true
    };
}

function asignarHoraEn(ws, row, col, valor) {
    const texto = formatearHoraAmPmSpF07(valor) || '';
    const celda = ws.getRow(row).getCell(col);
    asignarTexto(celda, texto, 'center', 'middle');
    // Texto plano: evita que Excel/Sheets interprete la hora y oculte a.m./p.m.
    celda.numFmt = '@';
}

function asignarEn(ws, row, col, texto, horizontal = 'left', vertical = 'middle') {
    asignarTexto(ws.getRow(row).getCell(col), texto, horizontal, vertical);
}

function columnaALetra(col) {
    let n = col;
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function celdaRef(row, col) {
    return `${columnaALetra(col)}${row}`;
}

function escaparTituloHojaSheet(sheetTitle) {
    return String(sheetTitle || SHEET_TITLE).replace(/'/g, "''");
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    const titulo = escaparTituloHojaSheet(sheetTitle);
    return `'${titulo}'!${celda}`;
}

async function asegurarTituloHojaExisteExacto(spreadsheetId, sheetTitle) {
    const objetivo = String(sheetTitle || '').trim();
    if (!spreadsheetId || !objetivo) return null;
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const exacto = (titulos || []).find((t) => String(t || '').trim() === objetivo);
    return exacto || null;
}

function resolverHojaWorkbook(wb, modo = 'vigente') {
    const m = String(modo || 'vigente').toLowerCase();
    if (m === 'edicion') {
        return excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || wb.getWorksheet(SHEET_TITLE)
            || wb.worksheets[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || wb.worksheets[0];
}

function normalizarTextoBusqueda(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buscarFilaPorTexto(ws, fragmentos, opciones = {}) {
    const desde = Math.max(1, Number(opciones.desde) || 1);
    const hasta = Math.max(desde, Number(opciones.hasta) || Math.max(ws?.rowCount || 0, 120));
    const colFija = opciones.col != null ? Number(opciones.col) : null;
    const frags = (Array.isArray(fragmentos) ? fragmentos : [fragmentos])
        .map((f) => normalizarTextoBusqueda(f))
        .filter(Boolean);
    if (!ws || !frags.length) return null;

    for (let row = desde; row <= hasta; row++) {
        const cols = colFija
            ? [colFija]
            : Array.from({ length: MAX_COLUMNAS_SISTEMA }, (_, i) => i + 1);
        for (const col of cols) {
            const texto = normalizarTextoBusqueda(leerCelda(ws, row, col));
            if (!texto) continue;
            if (frags.some((f) => texto.includes(f))) return row;
        }
    }
    return null;
}

function leerMomentoEnFila(ws, row) {
    return sanitizarMomento({
        momento: leerCelda(ws, row, CELLS.momento.col),
        fecha: leerCelda(ws, row, CELLS.fecha.col),
        horaInicio: leerCelda(ws, row, CELLS.horaInicio.col),
        contenidoTematico: leerCelda(ws, row, CELLS.contenidoTematico.col),
        descripcionActividades: leerCelda(ws, row, CELLS.descripcionActividades.col),
        horaTermino: leerCelda(ws, row, CELLS.horaTermino.col),
        tecnicasInstruccionales: leerCelda(ws, row, CELLS.tecnicasInstruccionales.col),
        tecnicasGrupales: leerCelda(ws, row, CELLS.tecnicasGrupales.col),
        duracion: leerCelda(ws, row, CELLS.duracionMomento.col)
    });
}

function esFilaNumeroReferencia(ws, row) {
    const num = String(leerCelda(ws, row, CELLS.referenciaNumeroCol) || '').trim();
    const texto = leerCelda(ws, row, CELLS.referenciasStartCol);
    return /^\d+$/.test(num) || textoTieneContenido(texto);
}

function detectarRangoReferencias(ws, refsTitulo, def) {
    const inicioBusqueda = Math.max(1, (refsTitulo || def.refsTitulo) + 1);
    const hasta = Math.max(inicioBusqueda, (ws?.rowCount || 0) + 5, refsTitulo + REFERENCIAS_MAX_HOJA + 8);
    let refsInicio = null;
    let refsFin = null;
    for (let row = inicioBusqueda; row <= hasta; row++) {
        if (!esFilaNumeroReferencia(ws, row)) {
            if (refsInicio != null) break;
            continue;
        }
        if (refsInicio == null) refsInicio = row;
        refsFin = row;
    }
    if (refsInicio == null) {
        refsInicio = def.refsInicio;
        refsFin = def.refsFin;
    }
    if (refsFin == null || refsFin < refsInicio) refsFin = refsInicio;
    return { refsInicio, refsFin };
}

function detectarLayoutDesdeWorksheet(ws) {
    const def = layoutPorDefecto();
    if (!ws) return { ...def };

    const objetivoGeneral = buscarFilaPorTexto(ws, ['general'], { desde: 20, hasta: 35, col: 1 })
        || def.objetivoGeneral;
    const recursosTitulo = buscarFilaPorTexto(ws, ['recursos a utilizar'], { desde: objetivoGeneral })
        || def.recursosTitulo;
    const recursosDidacticos = buscarFilaPorTexto(ws, ['didacticos'], {
        desde: recursosTitulo,
        hasta: recursosTitulo + 8
    }) || def.recursosDidacticos;
    const equipoApoyo = buscarFilaPorTexto(ws, ['equipo de apoyo'], {
        desde: recursosDidacticos,
        hasta: recursosDidacticos + 6
    }) || def.equipoApoyo;

    let particularesInicio = objetivoGeneral + 1;
    let particularesFin = Math.max(particularesInicio, recursosTitulo - 1);
    // Ajusta al bloque real de «Particular…» / «Particulares»
    let primeraPart = null;
    let ultimaPart = null;
    for (let row = particularesInicio; row < recursosTitulo; row++) {
        const label = normalizarTextoBusqueda(leerCelda(ws, row, 1));
        const valor = leerCelda(ws, row, CELLS.objetivosParticulares.col);
        const esPart = label.includes('particular') || textoTieneContenido(valor);
        if (esPart) {
            if (primeraPart == null) primeraPart = row;
            ultimaPart = row;
        }
    }
    if (primeraPart != null) {
        particularesInicio = primeraPart;
        particularesFin = ultimaPart;
    } else {
        particularesInicio = def.particularesInicio;
        particularesFin = def.particularesFin;
    }

    const leyendaMomentos = buscarFilaPorTexto(ws, ['momentos de la capacitacion'], { desde: equipoApoyo })
        || def.leyendaMomentos;
    const metodoEvaluacion = buscarFilaPorTexto(ws, ['metodo de evaluacion'], { desde: leyendaMomentos })
        || def.metodoEvaluacion;
    const refsTitulo = buscarFilaPorTexto(ws, ['referencias bibliograficas'], {
        desde: Math.max(leyendaMomentos, metodoEvaluacion)
    }) || def.refsTitulo;
    const tiempoTotalDetectado = buscarFilaPorTexto(ws, ['tiempo total'], {
        desde: leyendaMomentos,
        hasta: Math.max(leyendaMomentos + 1, metodoEvaluacion)
    });

    let momentosInicio = leyendaMomentos + 1;
    let momentosFin = Math.max(momentosInicio, (tiempoTotalDetectado || metodoEvaluacion) - 1);

    if (!tiempoTotalDetectado) {
        let ultimo = momentosInicio - 1;
        const limite = Math.max(momentosInicio, metodoEvaluacion - 1);
        for (let row = momentosInicio; row <= limite; row++) {
            const label = normalizarTextoBusqueda(leerCelda(ws, row, CELLS.momento.col));
            const esSeccion = SECCIONES_MOMENTO.some((s) => normalizarTextoBusqueda(s) === label);
            if (esSeccion || momentoTieneContenido(leerMomentoEnFila(ws, row))) {
                ultimo = row;
            }
        }
        if (ultimo >= momentosInicio) momentosFin = ultimo;
    } else {
        momentosFin = Math.max(momentosInicio, tiempoTotalDetectado - 1);
    }

    const tiempoTotal = tiempoTotalDetectado || (momentosFin + 1);
    const { refsInicio, refsFin } = detectarRangoReferencias(ws, refsTitulo, def);

    return {
        objetivoGeneral,
        particularesInicio,
        particularesFin,
        recursosTitulo,
        recursosDidacticos,
        equipoApoyo,
        leyendaMomentos,
        momentosInicio,
        momentosFin,
        tiempoTotal,
        metodoEvaluacion,
        refsTitulo,
        refsInicio,
        refsFin
    };
}

function parsearMomentosDesdeHoja(ws, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const momentos = [];
    let ultimoMomento = '';
    for (let row = lay.momentosInicio; row <= lay.momentosFin; row++) {
        const labelCelda = leerCelda(ws, row, CELLS.momento.col);
        if (labelCelda) ultimoMomento = labelCelda;
        const momento = sanitizarMomento({
            ...leerMomentoEnFila(ws, row),
            momento: labelCelda || ultimoMomento
        });
        if (momentoTieneContenido(momento)) {
            momentos.push(momento);
        }
    }
    return momentos;
}

function parsearReferenciasDesdeHoja(ws, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const refs = [];
    for (let row = lay.refsInicio; row <= lay.refsFin; row++) {
        const texto = leerCelda(ws, row, CELLS.referenciasStartCol);
        if (textoTieneContenido(texto)) refs.push(texto);
    }
    return sanitizarReferencias(refs);
}

function parsearObjetivosParticularesDesdeHoja(ws, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const lista = [];
    for (let row = lay.particularesInicio; row <= lay.particularesFin; row++) {
        const texto = leerCelda(ws, row, CELLS.objetivosParticulares.col);
        if (textoTieneContenido(texto)) {
            lista.push(String(texto).replace(/^[a-z]\)\s*/i, '').trim());
        }
    }
    if (lista.length) return sanitizarObjetivosParticulares(lista);

    // Compat: un solo recuadro con a) / b)
    const texto = leerCelda(ws, CELLS.objetivosParticulares.row, CELLS.objetivosParticulares.col);
    if (!textoTieneContenido(texto)) {
        return sanitizarObjetivosParticulares(['']);
    }
    const legacy = texto
        .split(/\r?\n+/)
        .map((t) => t.replace(/^[a-z]\)\s*/i, '').trim())
        .filter(Boolean);
    return sanitizarObjetivosParticulares(legacy.length ? legacy : ['']);
}

/** Etiqueta única del bloque (diseño oficial: «Particulares» fusionado en vertical). */
function etiquetaParticularHoja(_index) {
    return 'Particulares';
}

function letraParticularContenido(index) {
    return `${String.fromCharCode(97 + (Math.max(0, index) % 26))}) `;
}

function formatearParticularesParaHoja(particulares) {
    const lista = sanitizarObjetivosParticulares(particulares)
        .map((t) => String(t || '').replace(/^[a-z]\)\s*/i, '').trim())
        .filter((t) => textoTieneContenido(t));
    if (!lista.length) return '';
    return lista
        .map((texto, i) => `${String.fromCharCode(97 + (i % 26))}) ${texto}`)
        .join('\n');
}

function aplanarMomentosParaHoja(momentos) {
    const lista = Array.isArray(momentos) ? momentos.map(sanitizarMomento) : [];
    // Ciclos A→D→C→A…: cada vez que se vuelve a Apertura tras Cierre, nuevo ciclo.
    const ciclos = [];
    let actual = { Apertura: [], Desarrollo: [], Cierre: [], otros: [] };
    let fase = -1;
    const flush = () => {
        const tieneAlgo = SECCIONES_MOMENTO.some((s) => actual[s].length)
            || actual.otros.length;
        if (tieneAlgo) {
            ciclos.push(actual);
        }
        actual = { Apertura: [], Desarrollo: [], Cierre: [], otros: [] };
        fase = -1;
    };
    for (const m of lista) {
        const key = String(m.momento || '').trim();
        const idx = SECCIONES_MOMENTO.indexOf(key);
        if (idx >= 0) {
            if (fase >= 0 && idx < fase) {
                flush();
            }
            fase = idx;
            actual[key].push(m);
        } else if (momentoTieneContenido(m) || key) {
            actual.otros.push(m);
        }
    }
    flush();

    const cicloTieneDatos = (c) => (
        SECCIONES_MOMENTO.some((s) => (c[s] || []).some(momentoTieneContenido))
        || (c.otros || []).some(momentoTieneContenido)
    );
    let ciclosUsar = ciclos.filter(cicloTieneDatos);
    if (!ciclosUsar.length) {
        ciclosUsar = [{ Apertura: [], Desarrollo: [], Cierre: [], otros: [] }];
    }

    const out = [];
    for (const c of ciclosUsar) {
        for (const seccion of SECCIONES_MOMENTO) {
            const conDatos = (c[seccion] || []).filter(momentoTieneContenido);
            const filas = conDatos.length ? conDatos : [crearMomentoVacio(seccion)];
            out.push(...filas);
        }
        out.push(...(c.otros || []).filter(momentoTieneContenido));
    }
    return out.slice(0, MOMENTOS_MAX_HOJA);
}

function restaurarLeyendasEstructuralesEnActualizaciones(actualizaciones, sheetTitle, layout) {
    const lay = layout || layoutPorDefecto();
    Object.entries(LEYENDA_MOMENTOS).forEach(([col, texto]) => {
        pushUpdate(actualizaciones, lay.leyendaMomentos, Number(col), texto, sheetTitle);
    });
    pushUpdate(actualizaciones, lay.recursosTitulo, 1, 'RECURSOS A UTILIZAR', sheetTitle);
    pushUpdate(actualizaciones, lay.recursosDidacticos, 1, 'Didácticos', sheetTitle);
    pushUpdate(actualizaciones, lay.equipoApoyo, 1, 'Equipo de apoyo', sheetTitle);
    pushUpdate(actualizaciones, lay.tiempoTotal, 11, 'Tiempo total', sheetTitle);
    pushUpdate(actualizaciones, lay.metodoEvaluacion, 1, 'Método de evaluación del aprendizaje', sheetTitle);
    pushUpdate(actualizaciones, lay.refsTitulo, 1, 'REFERENCIAS BIBLIOGRÁFICAS QUE SUSTENTAN AL CURSO', sheetTitle);
    pushUpdate(actualizaciones, lay.objetivoGeneral, 1, 'General', sheetTitle);
    pushUpdate(actualizaciones, lay.particularesInicio, 1, 'Particulares', sheetTitle);
}

function parsearDatosDesdeHoja(ws) {
    const layout = detectarLayoutDesdeWorksheet(ws);
    const revText = leerCelda(ws, CELLS.revision.row, CELLS.revision.col);
    const revMatch = revText.match(/(\d+)/);

    return {
        datos: sanitizarDatos({
            revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
            fechaRevision: DATOS_DEFECTO.fechaRevision,
            nombreCurso: leerCelda(ws, CELLS.nombreCurso.row, CELLS.nombreCurso.col),
            proposito: leerCelda(ws, CELLS.proposito.row, CELLS.proposito.col),
            instructor: leerCelda(ws, CELLS.instructor.row, CELLS.instructor.col),
            fechaPeriodo: leerCelda(ws, CELLS.fechaPeriodo.row, CELLS.fechaPeriodo.col),
            duracion: leerCelda(ws, CELLS.duracion.row, CELLS.duracion.col),
            lugar: leerCelda(ws, CELLS.lugar.row, CELLS.lugar.col),
            numParticipantes: leerCelda(ws, CELLS.numParticipantes.row, CELLS.numParticipantes.col),
            nivelEstudios: leerCelda(ws, CELLS.nivelEstudios.row, CELLS.nivelEstudios.col),
            conocimientosRequeridos: leerCelda(ws, CELLS.conocimientosRequeridos.row, CELLS.conocimientosRequeridos.col),
            habilidadesRequeridas: leerCelda(ws, CELLS.habilidadesRequeridas.row, CELLS.habilidadesRequeridas.col),
            objetivoGeneral: leerCelda(ws, layout.objetivoGeneral || CELLS.objetivoGeneral.row, CELLS.objetivoGeneral.col),
            objetivosParticulares: parsearObjetivosParticularesDesdeHoja(ws, layout),
            recursosDidacticos: leerCelda(ws, layout.recursosDidacticos || CELLS.recursosDidacticos.row, CELLS.recursosDidacticos.col),
            equipoApoyo: leerCelda(ws, layout.equipoApoyo || CELLS.equipoApoyo.row, CELLS.equipoApoyo.col),
            momentos: parsearMomentosDesdeHoja(ws, layout),
            tiempoTotal: leerCelda(ws, layout.tiempoTotal, CELLS.tiempoTotalCol),
            metodoEvaluacion: leerCelda(ws, layout.metodoEvaluacion, CELLS.metodoEvaluacionCol),
            referencias: parsearReferenciasDesdeHoja(ws, layout),
            fechaElaboracion: DATOS_DEFECTO.fechaElaboracion
        }),
        legacyUsed: false
    };
}

async function leerDatosDesdePlantilla() {
    const buffer = await obtenerBufferPlantillaSpF07();
    const { datos } = await leerDatosDesdeBuffer(buffer);
    return datos;
}

async function obtenerBufferPlantillaSpF07() {
    const fileId = DRIVE_FILE_ID_SISTEMA || TEMPLATE_DRIVE_ID;
    try {
        const info = await driveService.obtenerInfoArchivo(fileId).catch(() => null);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        if (
            mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || mime === 'application/vnd.ms-excel'
        ) {
            return driveService.descargarArchivo(fileId);
        }
        return driveService.exportarGoogleSheetComoXLSX(fileId);
    } catch (err) {
        console.warn('[SP-F-07] Export plantilla falló, reintentando descarga nativa:', err.message);
        return driveService.descargarArchivo(fileId);
    }
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch (err) {
        return driveService.descargarArchivo(fileId);
    }
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle || '').trim());
    return hit?.sheetId ?? null;
}

async function fusionarFilasReferenciaBm(spreadsheetId, sheetId, filas) {
    const rows = (Array.isArray(filas) ? filas : [])
        .map((r) => Number(r))
        .filter((r) => Number.isFinite(r) && r >= 1);
    if (!spreadsheetId || sheetId == null || !rows.length) return;
    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const rangeOf = (row) => ({
        sheetId: Number(sheetId),
        startRowIndex: row - 1,
        endRowIndex: row,
        startColumnIndex: 1,
        endColumnIndex: 13
    });
    const requests = [];
    for (const row of rows) {
        requests.push({ unmergeCells: { range: rangeOf(row) } });
        requests.push({
            mergeCells: {
                range: rangeOf(row),
                mergeType: 'MERGE_ALL'
            }
        });
    }
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/**
 * Conserva los límites ampliados tras insertar filas.
 * Si se re-detecta el layout sobre filas vacías, refs/momentos se encogen y el
 * contenido queda escrito fuera de la tabla fusionada (visible en PDF).
 */
function fusionarLayoutExpandido(detectado, expandido) {
    const base = { ...(detectado || layoutPorDefecto()) };
    const def = layoutPorDefecto();
    const exp = expandido || null;
    if (!exp) return base;
    return {
        ...base,
        particularesInicio: Math.min(
            base.particularesInicio || def.particularesInicio,
            exp.particularesInicio || def.particularesInicio
        ),
        particularesFin: Math.max(
            base.particularesFin || def.particularesFin,
            exp.particularesFin || def.particularesFin
        ),
        recursosTitulo: Math.max(base.recursosTitulo || def.recursosTitulo, exp.recursosTitulo || def.recursosTitulo),
        recursosDidacticos: Math.max(
            base.recursosDidacticos || def.recursosDidacticos,
            exp.recursosDidacticos || def.recursosDidacticos
        ),
        equipoApoyo: Math.max(base.equipoApoyo || def.equipoApoyo, exp.equipoApoyo || def.equipoApoyo),
        momentosInicio: Math.min(base.momentosInicio, exp.momentosInicio),
        momentosFin: Math.max(base.momentosFin, exp.momentosFin),
        tiempoTotal: Math.max(base.tiempoTotal, exp.tiempoTotal),
        metodoEvaluacion: Math.max(base.metodoEvaluacion, exp.metodoEvaluacion),
        refsTitulo: Math.max(base.refsTitulo, exp.refsTitulo),
        refsInicio: Math.min(base.refsInicio, exp.refsInicio),
        refsFin: Math.max(base.refsFin, exp.refsFin)
    };
}

async function asegurarMergesReferencias(spreadsheetId, sheetTitle, layout) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;
    const filas = [];
    for (let row = lay.refsInicio; row <= lay.refsFin; row++) filas.push(row);
    if (!filas.length) return;
    try {
        await fusionarFilasReferenciaBm(spreadsheetId, sheetId, filas);
    } catch (err) {
        console.warn('[SP-F-07] No se pudo fusionar referencias B:M:', err.message);
    }
}

/**
 * Objetivos oficiales:
 * - General: A:B + C:M en una fila
 * - Particulares: A:B fusionado en vertical (una sola palabra «Particulares»),
 *   cada particular conserva su propia fila C:M (a / b / c…)
 */
async function asegurarMergesParticularesSpF07(spreadsheetId, sheetTitle, layout) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;
    if (!(lay.particularesFin >= lay.particularesInicio)) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [];

    const filaIni = lay.objetivoGeneral || CELLS.objetivoGeneral.row;
    const filaFin = lay.particularesFin;

    // Limpia merges previos del bloque de objetivos
    requests.push(requestUnmerge(sheetId, filaIni, filaFin, 1, 13));

    // General: etiqueta A:B + valor C:M
    requests.push(requestMerge(sheetId, filaIni, filaIni, 1, 2));
    requests.push(requestMerge(sheetId, filaIni, filaIni, 3, 13));

    // Particulares: una sola etiqueta vertical A:B; valor por fila C:M
    requests.push(requestMerge(
        sheetId,
        lay.particularesInicio,
        lay.particularesFin,
        1,
        2
    ));
    for (let row = lay.particularesInicio; row <= lay.particularesFin; row++) {
        requests.push(requestMerge(sheetId, row, row, 3, 13));
    }

    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudieron fusionar filas de particulares:', err.message);
    }

    // Altura compacta de particulares (evita interlineado exagerado en PDF).
    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    updateDimensionProperties: {
                        range: {
                            sheetId: Number(sheetId),
                            dimension: 'ROWS',
                            startIndex: lay.particularesInicio - 1,
                            endIndex: lay.particularesFin
                        },
                        properties: { pixelSize: 32 },
                        fields: 'pixelSize'
                    }
                }]
            }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudo ajustar altura de particulares:', err.message);
    }
}

/** Título de referencias a ancho completo (evita el texto apilado en columna A). */
async function restaurarTituloReferenciasSpF07(spreadsheetId, sheetTitle, layout) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null || !Number.isFinite(lay.refsTitulo)) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const row = lay.refsTitulo;
    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    requestUnmerge(sheetId, row, row, 1, 13),
                    requestMerge(sheetId, row, row, 1, 13),
                    {
                        repeatCell: {
                            range: {
                                sheetId: Number(sheetId),
                                startRowIndex: row - 1,
                                endRowIndex: row,
                                startColumnIndex: 0,
                                endColumnIndex: MAX_COLUMNAS_SISTEMA
                            },
                            cell: {
                                userEnteredFormat: {
                                    horizontalAlignment: 'LEFT',
                                    verticalAlignment: 'MIDDLE',
                                    wrapStrategy: 'WRAP',
                                    textFormat: { bold: true, italic: true },
                                    backgroundColor: { red: 1, green: 1, blue: 1 }
                                }
                            },
                            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,backgroundColor)'
                        }
                    }
                ]
            }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudo restaurar título de referencias:', err.message);
    }
}

async function asegurarEspacioMomentosYReferencias(spreadsheetId, sheetTitle, datos, layout) {
    const lay = { ...(layout || layoutPorDefecto()) };
    const plan = resolverPlanActivo(sanitizarDatos(datos));
    const partesLista = sanitizarObjetivosParticulares(plan.objetivosParticulares)
        .map((t) => String(t || '').replace(/^[a-z]\)\s*/i, '').trim())
        .filter((t) => textoTieneContenido(t));
    const particularesNeeded = Math.min(20, Math.max(1, partesLista.length || 1));
    const momentosNeeded = Math.min(
        MOMENTOS_MAX_HOJA,
        Math.max(SECCIONES_MOMENTO.length, aplanarMomentosParaHoja(plan.momentos).length)
    );
    const refsLista = sanitizarReferencias(plan.referencias);
    const refsNeeded = Math.min(
        REFERENCIAS_MAX_HOJA,
        Math.max(REFERENCIAS_MIN, refsLista.length)
    );

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        lay.particularesFin = lay.particularesInicio + particularesNeeded - 1;
        lay.momentosFin = lay.momentosInicio + momentosNeeded - 1;
        lay.refsFin = lay.refsInicio + refsNeeded - 1;
        return lay;
    }

    const shiftDebajoParticulares = (n) => {
        if (!n) return;
        lay.particularesFin += n;
        lay.recursosTitulo += n;
        lay.recursosDidacticos += n;
        lay.equipoApoyo += n;
        lay.leyendaMomentos += n;
        lay.momentosInicio += n;
        lay.momentosFin += n;
        lay.tiempoTotal += n;
        lay.metodoEvaluacion += n;
        lay.refsTitulo += n;
        lay.refsInicio += n;
        lay.refsFin += n;
    };

    // 1) Particulares: una fila por objetivo
    const partsActuales = Math.max(0, lay.particularesFin - lay.particularesInicio + 1);
    const extraParts = Math.max(0, particularesNeeded - partsActuales);
    if (extraParts > 0) {
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            sheetId,
            lay.particularesFin,
            extraParts,
            { inheritFromBefore: true }
        );
        shiftDebajoParticulares(extraParts);
    }

    // Antes de insertar/quitar momentos: romper merges verticales.
    await asegurarMergesFilasMomentoSpF07(spreadsheetId, sheetTitle, lay);

    const momentosActuales = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
    const extraMomentos = Math.max(0, momentosNeeded - momentosActuales);
    if (extraMomentos > 0) {
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            sheetId,
            lay.momentosFin,
            extraMomentos,
            { inheritFromBefore: true }
        );
        lay.momentosFin += extraMomentos;
        lay.tiempoTotal += extraMomentos;
        lay.metodoEvaluacion += extraMomentos;
        lay.refsTitulo += extraMomentos;
        lay.refsInicio += extraMomentos;
        lay.refsFin += extraMomentos;
    } else {
        // Quitar filas sobrantes (p. ej. tras eliminar en UI / ciclos vacíos).
        const sobranMomentos = Math.max(0, momentosActuales - momentosNeeded);
        if (sobranMomentos > 0) {
            const start0 = lay.momentosInicio + momentosNeeded - 1;
            try {
                await driveService.eliminarFilasGoogleSheet(
                    spreadsheetId,
                    sheetId,
                    start0,
                    sobranMomentos
                );
                lay.momentosFin -= sobranMomentos;
                lay.tiempoTotal -= sobranMomentos;
                lay.metodoEvaluacion -= sobranMomentos;
                lay.refsTitulo -= sobranMomentos;
                lay.refsInicio -= sobranMomentos;
                lay.refsFin -= sobranMomentos;
            } catch (err) {
                console.warn('[SP-F-07] No se pudieron eliminar filas sobrantes de momentos:', err.message);
            }
        }
    }

    // Particulares: también reducir si se borraron objetivos
    const partsAhora = Math.max(0, lay.particularesFin - lay.particularesInicio + 1);
    const sobranParts = Math.max(0, partsAhora - particularesNeeded);
    if (sobranParts > 0) {
        const startPart0 = lay.particularesInicio + particularesNeeded - 1;
        try {
            await driveService.eliminarFilasGoogleSheet(
                spreadsheetId,
                sheetId,
                startPart0,
                sobranParts
            );
            shiftDebajoParticulares(-sobranParts);
            lay.particularesFin = lay.particularesInicio + particularesNeeded - 1;
        } catch (err) {
            console.warn('[SP-F-07] No se pudieron eliminar filas sobrantes de particulares:', err.message);
        }
    }

    const refsTargetFin = lay.refsInicio + refsNeeded - 1;
    if (lay.refsFin < refsTargetFin) {
        const falta = refsTargetFin - lay.refsFin;
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            sheetId,
            lay.refsFin,
            falta,
            { inheritFromBefore: true }
        );
        lay.refsFin += falta;
    } else if (lay.refsFin > refsTargetFin) {
        const sobranRefs = lay.refsFin - refsTargetFin;
        try {
            await driveService.eliminarFilasGoogleSheet(
                spreadsheetId,
                sheetId,
                refsTargetFin, // 0-based ≈ 1-based fin deseado (insert pattern)
                sobranRefs
            );
            lay.refsFin = refsTargetFin;
        } catch (err) {
            console.warn('[SP-F-07] No se pudieron eliminar filas sobrantes de referencias:', err.message);
        }
    }

    await asegurarMergesReferencias(spreadsheetId, sheetTitle, lay);
    await asegurarMergesFilasMomentoSpF07(spreadsheetId, sheetTitle, lay);
    await asegurarMergesParticularesSpF07(spreadsheetId, sheetTitle, lay);
    return lay;
}

function etiquetaMomentoVisibleEnFila(lista, index) {
    const actual = String(lista[index]?.momento || '').trim();
    if (!actual) return '';
    if (index <= 0) return actual;
    const previa = String(lista[index - 1]?.momento || '').trim();
    return actual === previa ? '' : actual;
}

const BORDE_TABLA_SP_F07 = {
    style: 'SOLID',
    width: 1,
    color: { red: 0, green: 0, blue: 0 }
};

function requestBordesRango(sheetId, startRow, endRow, startCol, endCol) {
    return {
        updateBorders: {
            range: {
                sheetId: Number(sheetId),
                startRowIndex: startRow - 1,
                endRowIndex: endRow,
                startColumnIndex: startCol - 1,
                endColumnIndex: endCol
            },
            top: BORDE_TABLA_SP_F07,
            bottom: BORDE_TABLA_SP_F07,
            left: BORDE_TABLA_SP_F07,
            right: BORDE_TABLA_SP_F07,
            innerHorizontal: BORDE_TABLA_SP_F07,
            innerVertical: BORDE_TABLA_SP_F07
        }
    };
}

function requestUnmerge(sheetId, startRow, endRow, startCol, endCol) {
    return {
        unmergeCells: {
            range: {
                sheetId: Number(sheetId),
                startRowIndex: startRow - 1,
                endRowIndex: endRow,
                startColumnIndex: startCol - 1,
                endColumnIndex: endCol
            }
        }
    };
}

function requestMerge(sheetId, startRow, endRow, startCol, endCol) {
    return {
        mergeCells: {
            range: {
                sheetId: Number(sheetId),
                startRowIndex: startRow - 1,
                endRowIndex: endRow,
                startColumnIndex: startCol - 1,
                endColumnIndex: endCol
            },
            mergeType: 'MERGE_ALL'
        }
    };
}

/**
 * Restaura merges horizontales por fila (como la plantilla).
 * Elimina cualquier merge vertical en Apertura/Desarrollo/Cierre: al cruzar
 * páginas del PDF desalinea columnas y “borra” líneas internas.
 */
async function asegurarMergesFilasMomentoSpF07(spreadsheetId, sheetTitle, layout) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;
    if (!(lay.momentosFin >= lay.momentosInicio)) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });

    const filaMin = Math.min(lay.leyendaMomentos, lay.momentosInicio);
    const filaMax = Math.max(
        lay.momentosFin,
        lay.tiempoTotal || 0,
        lay.metodoEvaluacion || 0,
        lay.refsTitulo || 0
    );

    // 1) Quitar TODO merge vertical (o que cruce filas) en el bloque de momentos.
    try {
        const meta = await sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title),merges)'
        });
        const hoja = (meta.data.sheets || []).find((s) => Number(s.properties?.sheetId) === Number(sheetId));
        const merges = hoja?.merges || [];
        const unmergeReqs = [];
        for (const m of merges) {
            const startRowIndex = m.startRowIndex || 0;
            const endRowIndex = m.endRowIndex || (startRowIndex + 1);
            const startColIndex = m.startColumnIndex || 0;
            const endColIndex = m.endColumnIndex || (startColIndex + 1);
            const startRow = startRowIndex + 1;
            const endRowInclusive = endRowIndex; // endRowIndex ya es exclusivo 0-based ⇒ inclusivo 1-based = endRowIndex
            const cruzaFilas = endRowIndex > startRowIndex + 1;
            const solapaBloque = startRow <= filaMax && endRowInclusive >= filaMin;
            if (cruzaFilas && solapaBloque) {
                unmergeReqs.push({
                    unmergeCells: {
                        range: {
                            sheetId: Number(sheetId),
                            startRowIndex,
                            endRowIndex,
                            startColumnIndex: startColIndex,
                            endColumnIndex: endColIndex
                        }
                    }
                });
            }
        }
        if (unmergeReqs.length) {
            await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: unmergeReqs }
            });
        }
    } catch (err) {
        console.warn('[SP-F-07] No se pudieron quitar merges verticales:', err.message);
    }

    // 2) Reaplicar solo merges horizontales por fila (plantilla).
    const mergeReqs = [];
    for (let row = lay.leyendaMomentos; row <= lay.momentosFin; row++) {
        mergeReqs.push(requestMerge(sheetId, row, row, 1, 2));
        mergeReqs.push(requestMerge(sheetId, row, row, 5, 7));
        mergeReqs.push(requestMerge(sheetId, row, row, 8, 9));
    }

    if (Number.isFinite(lay.tiempoTotal)) {
        const t = lay.tiempoTotal;
        mergeReqs.push(requestMerge(sheetId, t, t, 1, 2));
        mergeReqs.push(requestMerge(sheetId, t, t, 5, 7));
        mergeReqs.push(requestMerge(sheetId, t, t, 8, 9));
        mergeReqs.push(requestMerge(sheetId, t, t, 11, 12));
    }

    if (Number.isFinite(lay.metodoEvaluacion)) {
        const m = lay.metodoEvaluacion;
        mergeReqs.push(requestMerge(sheetId, m, m, 1, 4));
        mergeReqs.push(requestMerge(sheetId, m, m, 5, 13));
    }

    if (mergeReqs.length) {
        try {
            await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: mergeReqs }
            });
        } catch (err) {
            console.warn('[SP-F-07] No se pudieron restaurar merges horizontales de momentos:', err.message);
            for (let row = lay.momentosInicio; row <= lay.momentosFin; row++) {
                try {
                    await sheetsApi.spreadsheets.batchUpdate({
                        spreadsheetId,
                        requestBody: {
                            requests: [
                                requestMerge(sheetId, row, row, 1, 2),
                                requestMerge(sheetId, row, row, 5, 7),
                                requestMerge(sheetId, row, row, 8, 9)
                            ]
                        }
                    });
                } catch (errFila) {
                    console.warn(`[SP-F-07] Merge fila momento ${row}:`, errFila.message);
                }
            }
        }
    }

    // 3) Altura uniforme: evita celdas enormes heredadas del merge vertical en el PDF.
    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    updateDimensionProperties: {
                        range: {
                            sheetId: Number(sheetId),
                            dimension: 'ROWS',
                            startIndex: lay.momentosInicio - 1,
                            endIndex: lay.momentosFin
                        },
                        properties: { pixelSize: 52 },
                        fields: 'pixelSize'
                    }
                }]
            }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudo normalizar altura de filas de momentos:', err.message);
    }
}

const COLOR_GRIS_TABLA = { red: 216 / 255, green: 216 / 255, blue: 216 / 255 };
const COLOR_BLANCO_TABLA = { red: 1, green: 1, blue: 1 };

function requestFondoRango(sheetId, startRow, endRow, startCol, endCol, color) {
    return {
        repeatCell: {
            range: {
                sheetId: Number(sheetId),
                startRowIndex: startRow - 1,
                endRowIndex: endRow,
                startColumnIndex: startCol - 1,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: color
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    };
}

function requestFondoBlancoRango(sheetId, startRow, endRow, startCol, endCol) {
    return requestFondoRango(sheetId, startRow, endRow, startCol, endCol, COLOR_BLANCO_TABLA);
}

function requestFondoGrisRango(sheetId, startRow, endRow, startCol, endCol) {
    return requestFondoRango(sheetId, startRow, endRow, startCol, endCol, COLOR_GRIS_TABLA);
}

/**
 * Diseño oficial: encabezados/etiquetas grises (#D8D8D8), datos blancos, bordes negros.
 * Filas de «Cierre» en momentos: toda la fila en gris (diseño oficial).
 */
async function aplicarBordesTablasSpF07(spreadsheetId, sheetTitle, layout, momentos = null) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [];

    const pintarEtiquetaValor = (startRow, endRow, labelEndCol = 2) => {
        if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || endRow < startRow) return;
        requests.push(requestFondoGrisRango(sheetId, startRow, endRow, 1, labelEndCol));
        requests.push(requestFondoBlancoRango(sheetId, startRow, endRow, labelEndCol + 1, MAX_COLUMNAS_SISTEMA));
        requests.push(requestBordesRango(sheetId, startRow, endRow, 1, MAX_COLUMNAS_SISTEMA));
    };

    // Detalles del curso / perfil
    pintarEtiquetaValor(CELLS.nombreCurso.row, CELLS.numParticipantes.row, 5);
    pintarEtiquetaValor(CELLS.nivelEstudios.row, CELLS.habilidadesRequeridas.row, 3);

    // Objetivos
    if (lay.objetivoGeneral && lay.particularesFin) {
        pintarEtiquetaValor(lay.objetivoGeneral, lay.particularesFin, 2);
    }

    // Recursos a utilizar
    if (lay.recursosDidacticos && lay.equipoApoyo) {
        pintarEtiquetaValor(lay.recursosDidacticos, lay.equipoApoyo, 2);
    }

    // No quitar bordes entre Equipo y Momentos: deja la raya de tabla intacta.

    // Momentos
    if (lay.momentosFin >= lay.momentosInicio) {
        const finMomentos = Math.max(lay.momentosFin, lay.tiempoTotal || lay.momentosFin);
        requests.push(requestFondoGrisRango(
            sheetId, lay.leyendaMomentos, lay.leyendaMomentos, 1, MAX_COLUMNAS_SISTEMA
        ));
        requests.push(requestFondoBlancoRango(
            sheetId, lay.momentosInicio, finMomentos, 1, MAX_COLUMNAS_SISTEMA
        ));
        requests.push(requestFondoGrisRango(
            sheetId, lay.momentosInicio, lay.momentosFin, 1, 2
        ));

        // Cierre: toda la fila en gris (como plantilla oficial)
        const lista = aplanarMomentosParaHoja(momentos);
        const slots = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
        for (let i = 0; i < slots; i++) {
            const m = lista[i] || crearMomentoVacio('');
            if (String(m.momento || '').trim() !== 'Cierre') continue;
            const row = lay.momentosInicio + i;
            requests.push(requestFondoGrisRango(sheetId, row, row, 1, MAX_COLUMNAS_SISTEMA));
        }

        if (Number.isFinite(lay.tiempoTotal)) {
            requests.push(requestFondoBlancoRango(
                sheetId, lay.tiempoTotal, lay.tiempoTotal, 1, MAX_COLUMNAS_SISTEMA
            ));
            requests.push(requestFondoGrisRango(
                sheetId, lay.tiempoTotal, lay.tiempoTotal, 11, 12
            ));
        }
        requests.push(requestBordesRango(
            sheetId, lay.leyendaMomentos, finMomentos, 1, MAX_COLUMNAS_SISTEMA
        ));
        for (let row = lay.leyendaMomentos; row <= finMomentos; row++) {
            requests.push(requestBordesRango(sheetId, row, row, 1, MAX_COLUMNAS_SISTEMA));
        }
    }

    if (Number.isFinite(lay.metodoEvaluacion)) {
        pintarEtiquetaValor(lay.metodoEvaluacion, lay.metodoEvaluacion, 4);
    }

    if (lay.refsFin >= lay.refsInicio) {
        if (lay.refsFin > lay.refsInicio) {
            requests.push({
                copyPaste: {
                    source: {
                        sheetId: Number(sheetId),
                        startRowIndex: lay.refsInicio - 1,
                        endRowIndex: lay.refsInicio,
                        startColumnIndex: 0,
                        endColumnIndex: MAX_COLUMNAS_SISTEMA
                    },
                    destination: {
                        sheetId: Number(sheetId),
                        startRowIndex: lay.refsInicio,
                        endRowIndex: lay.refsFin,
                        startColumnIndex: 0,
                        endColumnIndex: MAX_COLUMNAS_SISTEMA
                    },
                    pasteType: 'PASTE_FORMAT'
                }
            });
        }
        requests.push(requestFondoBlancoRango(
            sheetId, lay.refsInicio, lay.refsFin, 1, MAX_COLUMNAS_SISTEMA
        ));
        requests.push(requestFondoGrisRango(
            sheetId, lay.refsInicio, lay.refsFin, 1, 1
        ));
        for (let row = lay.refsInicio; row <= lay.refsFin; row++) {
            requests.push(requestBordesRango(sheetId, row, row, 1, MAX_COLUMNAS_SISTEMA));
        }
    }

    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudo aplicar diseño gris/blanco:', err.message);
    }
}

/**
 * Colores pedagógicos SOLO en Objetivos (General / Particulares), texto en itálica:
 * rojo=sujeto, verde=verbo, naranja=contenido, morado=para…, azul=a través de…
 */
const COLOR_OBJ_ROJO = { red: 192 / 255, green: 0, blue: 0 };
const COLOR_OBJ_VERDE = { red: 0, green: 176 / 255, blue: 80 / 255 };
const COLOR_OBJ_NARANJA = { red: 237 / 255, green: 125 / 255, blue: 49 / 255 };
const COLOR_OBJ_MORADO = { red: 112 / 255, green: 48 / 255, blue: 160 / 255 };
const COLOR_OBJ_AZUL = { red: 0, green: 112 / 255, blue: 192 / 255 };
const COLOR_OBJ_NEGRO = { red: 0, green: 0, blue: 0 };

const VERBOS_OBJETIVO_SP_F07 = [
    'comprendera', 'aplicara', 'reconocera', 'observara', 'interactuara',
    'identificara', 'analizara', 'evaluara', 'elaborara', 'demostrara',
    'ejecutara', 'desarrollara', 'implementara', 'interpretara', 'diferenciara',
    'describira', 'explicara', 'utilizara', 'realizara', 'determinara',
    'establecera', 'formulara'
];

function normalizarParaMatchObjetivo(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function construirTextFormatRunsObjetivo(texto) {
    const raw = String(texto || '');
    if (!raw.trim()) return null;
    const n = raw.length;
    const tags = new Array(n).fill('black');

    const markRange = (start, end, tag) => {
        const a = Math.max(0, start);
        const b = Math.min(n, end);
        for (let i = a; i < b; i++) tags[i] = tag;
    };

    const norm = normalizarParaMatchObjetivo(raw);

    // Azul: «a través de…» hasta antes de «(Dominio)» o fin
    let idxAzul = norm.indexOf('a traves de');
    while (idxAzul >= 0) {
        let fin = norm.indexOf('(', idxAzul);
        if (fin < 0) fin = n;
        markRange(idxAzul, fin, 'blue');
        idxAzul = norm.indexOf('a traves de', fin);
    }

    // Morado: «para …» que no esté ya en azul
    const rePara = /\bpara\b/gi;
    let mPara;
    while ((mPara = rePara.exec(raw)) !== null) {
        const start = mPara.index;
        if (tags[start] === 'blue') continue;
        let end = start + 4;
        while (end < n && tags[end] !== 'blue' && raw[end] !== '(') end += 1;
        // recorta espacios finales
        while (end > start && /\s/.test(raw[end - 1])) end -= 1;
        markRange(start, end, 'purple');
    }

    // Rojo: sujeto
    const sujetos = [
        /el participante/gi,
        /los participantes/gi,
        /la participante/gi,
        /las participantes/gi
    ];
    for (const re of sujetos) {
        let m;
        while ((m = re.exec(raw)) !== null) {
            markRange(m.index, m.index + m[0].length, 'red');
        }
    }

    // Verde: verbos en futuro (…ará / …erá / …irá) o lista conocida
    const reVerb = /\b[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}(?:ará|erá|irá|ara|era|ira)\b/gi;
    let mVerb;
    while ((mVerb = reVerb.exec(raw)) !== null) {
        const word = mVerb[0];
        const normWord = normalizarParaMatchObjetivo(word);
        const esFuturo = /(ara|era|ira)$/.test(normWord);
        const enLista = VERBOS_OBJETIVO_SP_F07.some((v) => normWord === v || normWord.startsWith(v));
        if (esFuturo || enLista) {
            markRange(mVerb.index, mVerb.index + word.length, 'green');
        }
    }

    // Naranja: tramos entre verde y morado/azul aún en negro (sustantivos de contenido)
    for (let i = 0; i < n; ) {
        if (tags[i] !== 'black' || /\s/.test(raw[i])) {
            i += 1;
            continue;
        }
        // solo si hay un verde antes cercano
        let hayVerdeAntes = false;
        for (let k = i - 1; k >= 0 && k >= i - 80; k--) {
            if (tags[k] === 'green') {
                hayVerdeAntes = true;
                break;
            }
            if (tags[k] === 'purple' || tags[k] === 'blue') break;
        }
        if (!hayVerdeAntes) {
            i += 1;
            continue;
        }
        let j = i;
        while (j < n && tags[j] === 'black' && raw[j] !== '(') j += 1;
        // no pintar conectores cortos solos
        const fragmento = raw.slice(i, j).trim();
        if (fragmento.length >= 4 && !/^(los|las|el|la|un|una|y|de|del|al|en)$/i.test(fragmento)) {
            markRange(i, j, 'orange');
        }
        i = Math.max(j, i + 1);
    }

    const colorDe = (tag) => {
        switch (tag) {
            case 'red': return COLOR_OBJ_ROJO;
            case 'green': return COLOR_OBJ_VERDE;
            case 'orange': return COLOR_OBJ_NARANJA;
            case 'purple': return COLOR_OBJ_MORADO;
            case 'blue': return COLOR_OBJ_AZUL;
            default: return COLOR_OBJ_NEGRO;
        }
    };

    const runs = [];
    let i = 0;
    while (i < n) {
        const tag = tags[i];
        let j = i + 1;
        while (j < n && tags[j] === tag) j += 1;
        runs.push({
            startIndex: i,
            format: {
                foregroundColor: colorDe(tag),
                italic: true,
                bold: false
            }
        });
        i = j;
    }
    return runs;
}

async function aplicarColoresObjetivosSpF07(spreadsheetId, sheetTitle, layout, plan) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [];

    const pushCelda = (row, col, texto) => {
        const value = String(texto || '').trim();
        if (!value) return;
        const runs = construirTextFormatRunsObjetivo(value);
        requests.push({
            updateCells: {
                range: {
                    sheetId: Number(sheetId),
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: col - 1,
                    endColumnIndex: col
                },
                rows: [{
                    values: [{
                        userEnteredValue: { stringValue: value },
                        textFormatRuns: runs || undefined,
                        userEnteredFormat: {
                            wrapStrategy: 'WRAP',
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            textFormat: { italic: true }
                        }
                    }]
                }],
                fields: 'userEnteredValue,textFormatRuns,userEnteredFormat(wrapStrategy,horizontalAlignment,verticalAlignment,textFormat)'
            }
        });
    };

    pushCelda(
        lay.objetivoGeneral || CELLS.objetivoGeneral.row,
        CELLS.objetivoGeneral.col,
        plan.objetivoGeneral
    );

    const partes = sanitizarObjetivosParticulares(plan.objetivosParticulares)
        .map((t) => String(t || '').replace(/^[a-z]\)\s*/i, '').trim());
    const slots = Math.max(0, lay.particularesFin - lay.particularesInicio + 1);
    for (let i = 0; i < slots; i++) {
        const texto = partes[i] || '';
        if (!textoTieneContenido(texto)) continue;
        pushCelda(
            lay.particularesInicio + i,
            CELLS.objetivosParticulares.col,
            `${letraParticularContenido(i)}${texto}`
        );
    }

    if (!requests.length) return;
    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudieron aplicar colores de objetivos:', err.message);
    }
}

async function exportarPdfSpF07DosPaginas(driveFileId, gid, layout) {
    const lay = layout || layoutPorDefecto();
    // Página 1: hasta Objetivos (Particulares). Página 2: Recursos + Momentos + resto.
    // Así «Didácticos / Equipo de apoyo» no quedan solos al final de la hoja 1.
    const finPagina1 = Math.max(
        1,
        Number(lay.particularesFin)
            || (Number(lay.recursosTitulo) ? Number(lay.recursosTitulo) - 1 : 0)
            || Number(lay.objetivoGeneral)
            || 24
    );
    const inicioPagina2 = Math.max(
        1,
        Number(lay.recursosTitulo) || Number(lay.leyendaMomentos) || 26
    );
    const finPagina2 = Math.max(
        inicioPagina2 + 1,
        Number(lay.refsFin) || inicioPagina2,
        Number(lay.metodoEvaluacion) || inicioPagina2
    ) + 2;

    const optsBase = {
        gid,
        landscape: true,
        fitToWidth: true,
        size: 'letter'
    };

    let buf1;
    let buf2;
    try {
        buf1 = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
            ...optsBase,
            range: { r1: 0, c1: 0, r2: finPagina1, c2: MAX_COLUMNAS_SISTEMA }
        });
        buf2 = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
            ...optsBase,
            range: { r1: inicioPagina2 - 1, c1: 0, r2: finPagina2, c2: MAX_COLUMNAS_SISTEMA }
        });
    } catch (err) {
        console.warn('[SP-F-07] Export PDF por rangos falló, usando hoja completa:', err.message);
        return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
    }

    try {
        const { PDFDocument } = require('pdf-lib');
        const out = await PDFDocument.create();
        for (const buf of [buf1, buf2]) {
            if (!buf || !buf.length) continue;
            const doc = await PDFDocument.load(Buffer.from(buf));
            const pages = await out.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => out.addPage(p));
        }
        if (!out.getPageCount()) {
            return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
        }
        return Buffer.from(await out.save());
    } catch (err) {
        console.warn('[SP-F-07] No se pudo unir PDFs de 2 páginas:', err.message);
        return driveService.exportarGoogleSheetComoPDF(driveFileId, optsBase);
    }
}

/**
 * Fusiona en vertical la etiqueta Apertura/Desarrollo/Cierre (diseño oficial).
 * Solo columna A:B; el resto de la fila queda independiente.
 */
async function fusionarEtiquetasMomentoSpF07(spreadsheetId, sheetTitle, layout, momentos) {
    const lay = layout || layoutPorDefecto();
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;
    if (!(lay.momentosFin >= lay.momentosInicio)) return;

    const lista = aplanarMomentosParaHoja(momentos);
    const slots = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
    const rangos = [];
    let i = 0;
    while (i < slots) {
        const label = String((lista[i] || crearMomentoVacio('')).momento || '').trim();
        if (!label) {
            i += 1;
            continue;
        }
        let j = i + 1;
        while (j < slots) {
            const next = String((lista[j] || crearMomentoVacio('')).momento || '').trim();
            if (next !== label) break;
            j += 1;
        }
        rangos.push({
            startRow: lay.momentosInicio + i,
            endRow: lay.momentosInicio + j - 1
        });
        i = j;
    }
    if (!rangos.length) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [];
    for (const r of rangos) {
        for (let row = r.startRow; row <= r.endRow; row++) {
            requests.push(requestUnmerge(sheetId, row, row, 1, 2));
        }
        requests.push(requestMerge(sheetId, r.startRow, r.endRow, 1, 2));
        requests.push(requestFondoGrisRango(sheetId, r.startRow, r.endRow, 1, 2));
    }
    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudieron fusionar etiquetas de momentos:', err.message);
    }
}

function escribirMomentosEnWorksheet(ws, momentos, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const lista = aplanarMomentosParaHoja(momentos);
    Object.entries(LEYENDA_MOMENTOS).forEach(([col, texto]) => {
        asignarEn(ws, lay.leyendaMomentos, Number(col), texto, 'center');
    });
    const slots = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
    for (let i = 0; i < slots; i++) {
        const row = lay.momentosInicio + i;
        const m = lista[i] || crearMomentoVacio('');
        asignarEn(ws, row, CELLS.momento.col, etiquetaMomentoVisibleEnFila(lista, i), 'center');
        asignarEn(ws, row, CELLS.fecha.col, fechaParaHojaSpF07(m.fecha), 'center');
        asignarHoraEn(ws, row, CELLS.horaInicio.col, m.horaInicio);
        asignarEn(ws, row, CELLS.contenidoTematico.col, m.contenidoTematico || '', 'center');
        asignarEn(ws, row, CELLS.descripcionActividades.col, m.descripcionActividades || '', 'center');
        asignarHoraEn(ws, row, CELLS.horaTermino.col, m.horaTermino);
        asignarEn(ws, row, CELLS.tecnicasInstruccionales.col, m.tecnicasInstruccionales || '', 'center');
        asignarEn(ws, row, CELLS.tecnicasGrupales.col, m.tecnicasGrupales || '', 'center');
        asignarEn(ws, row, CELLS.duracionMomento.col, m.duracion || '', 'center');
    }
}

function escribirObjetivosParticularesEnWorksheet(ws, particulares, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const lista = sanitizarObjetivosParticulares(particulares)
        .map((t) => String(t || '').replace(/^[a-z]\)\s*/i, '').trim());
    const slots = Math.max(0, lay.particularesFin - lay.particularesInicio + 1);
    for (let i = 0; i < slots; i++) {
        const row = lay.particularesInicio + i;
        const texto = lista[i] || '';
        // Solo la primera fila lleva «Particulares» (el merge vertical lo muestra una vez)
        asignarEn(ws, row, 1, i === 0 ? etiquetaParticularHoja(i) : '', 'center');
        const contenido = textoTieneContenido(texto) ? `${letraParticularContenido(i)}${texto}` : '';
        asignarEn(ws, row, CELLS.objetivosParticulares.col, contenido, 'center');
    }
}

function escribirReferenciasEnWorksheet(ws, referencias, layout = null) {
    const lay = layout || detectarLayoutDesdeWorksheet(ws);
    const refs = sanitizarReferencias(referencias);
    const slots = Math.max(0, lay.refsFin - lay.refsInicio + 1);
    for (let i = 0; i < slots; i++) {
        const row = lay.refsInicio + i;
        const texto = String(refs[i] || '').trim();
        asignarEn(ws, row, CELLS.referenciaNumeroCol, String(i + 1), 'center');
        asignarEn(ws, row, CELLS.referenciasStartCol, texto, 'center');
    }
}

function escribirDatosEnWorksheet(ws, datos) {
    const meta = sanitizarDatos(datos);
    const plan = resolverPlanActivo(meta);
    const layout = detectarLayoutDesdeWorksheet(ws);
    const rev = meta.revision || '00';
    asignarEn(ws, CELLS.revision.row, CELLS.revision.col, `Rev.: ${rev}`, 'center');
    asignarEn(ws, CELLS.nombreCurso.row, CELLS.nombreCurso.col, plan.nombreCurso || '', 'center');
    asignarEn(ws, CELLS.proposito.row, CELLS.proposito.col, plan.proposito || '', 'center');
    asignarEn(ws, CELLS.instructor.row, CELLS.instructor.col, plan.instructor || '', 'center');
    asignarEn(ws, CELLS.fechaPeriodo.row, CELLS.fechaPeriodo.col, plan.fechaPeriodo || '', 'center');
    asignarEn(ws, CELLS.duracion.row, CELLS.duracion.col, plan.duracion || '', 'center');
    asignarEn(ws, CELLS.lugar.row, CELLS.lugar.col, plan.lugar || '', 'center');
    asignarEn(ws, CELLS.numParticipantes.row, CELLS.numParticipantes.col, plan.numParticipantes || '', 'center');
    asignarEn(ws, CELLS.nivelEstudios.row, CELLS.nivelEstudios.col, plan.nivelEstudios || '', 'center');
    asignarEn(ws, CELLS.conocimientosRequeridos.row, CELLS.conocimientosRequeridos.col, plan.conocimientosRequeridos || '', 'center');
    asignarEn(ws, CELLS.habilidadesRequeridas.row, CELLS.habilidadesRequeridas.col, plan.habilidadesRequeridas || '', 'center');
    asignarEn(ws, layout.objetivoGeneral || CELLS.objetivoGeneral.row, CELLS.objetivoGeneral.col, plan.objetivoGeneral || '', 'center');
    escribirObjetivosParticularesEnWorksheet(ws, plan.objetivosParticulares, layout);
    asignarEn(ws, layout.recursosDidacticos || CELLS.recursosDidacticos.row, CELLS.recursosDidacticos.col, plan.recursosDidacticos || '', 'center');
    asignarEn(ws, layout.equipoApoyo || CELLS.equipoApoyo.row, CELLS.equipoApoyo.col, plan.equipoApoyo || '', 'center');
    escribirMomentosEnWorksheet(ws, plan.momentos, layout);
    asignarEn(ws, layout.tiempoTotal, 11, 'Tiempo total', 'center');
    asignarEn(ws, layout.tiempoTotal, CELLS.tiempoTotalCol, plan.tiempoTotal || '', 'center');
    asignarEn(ws, layout.metodoEvaluacion, 1, 'Método de evaluación del aprendizaje', 'center');
    asignarEn(ws, layout.metodoEvaluacion, CELLS.metodoEvaluacionCol, plan.metodoEvaluacion || '', 'center');
    asignarEn(ws, layout.refsTitulo, 1, 'REFERENCIAS BIBLIOGRÁFICAS QUE SUSTENTAN AL CURSO', 'left');
    escribirReferenciasEnWorksheet(ws, plan.referencias, layout);
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await obtenerBufferPlantillaSpF07();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = resolverHojaWorkbook(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SP-F-07 no contiene hojas.');
    escribirDatosEnWorksheet(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(celdaRef(row, col), sheetTitle),
        values: [[valor == null ? '' : valor]]
    });
}

function limpiarRangoFilasEnActualizaciones(actualizaciones, sheetTitle, rowStart, rowEnd, colStart = 1, colEnd = MAX_COLUMNAS_SISTEMA) {
    const desde = Math.min(rowStart, rowEnd);
    const hasta = Math.max(rowStart, rowEnd);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) return;
    for (let row = desde; row <= hasta; row++) {
        for (let col = colStart; col <= colEnd; col++) {
            pushUpdate(actualizaciones, row, col, '', sheetTitle);
        }
    }
}

function datosAActualizacionesSheet(datos, sheetTitle = SHEET_TITLE, layout = null) {
    const meta = sanitizarDatos(datos);
    const plan = resolverPlanActivo(meta);
    const lay = layout || layoutPorDefecto();
    const actualizaciones = [];
    const rev = meta.revision || '00';

    restaurarLeyendasEstructuralesEnActualizaciones(actualizaciones, sheetTitle, lay);

    if (lay.metodoEvaluacion + 1 <= lay.refsTitulo - 1) {
        limpiarRangoFilasEnActualizaciones(
            actualizaciones,
            sheetTitle,
            lay.metodoEvaluacion + 1,
            lay.refsTitulo - 1
        );
    }
    if (lay.refsTitulo + 1 <= lay.refsInicio - 1) {
        limpiarRangoFilasEnActualizaciones(
            actualizaciones,
            sheetTitle,
            lay.refsTitulo + 1,
            lay.refsInicio - 1
        );
    }
    // Evita basura tipo «Cierre» debajo del bloque de momentos / tiempo total.
    if (lay.momentosFin + 1 <= lay.tiempoTotal - 1) {
        limpiarRangoFilasEnActualizaciones(
            actualizaciones,
            sheetTitle,
            lay.momentosFin + 1,
            lay.tiempoTotal - 1
        );
    }
    if (lay.tiempoTotal + 1 <= lay.metodoEvaluacion - 1) {
        limpiarRangoFilasEnActualizaciones(
            actualizaciones,
            sheetTitle,
            lay.tiempoTotal + 1,
            lay.metodoEvaluacion - 1
        );
    }

    pushUpdate(actualizaciones, CELLS.revision.row, CELLS.revision.col, `Rev.: ${rev}`, sheetTitle);
    pushUpdate(actualizaciones, CELLS.nombreCurso.row, CELLS.nombreCurso.col, plan.nombreCurso || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.proposito.row, CELLS.proposito.col, normalizarSaltosLinea(plan.proposito), sheetTitle);
    pushUpdate(actualizaciones, CELLS.instructor.row, CELLS.instructor.col, plan.instructor || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.fechaPeriodo.row, CELLS.fechaPeriodo.col, plan.fechaPeriodo || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.duracion.row, CELLS.duracion.col, plan.duracion || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.lugar.row, CELLS.lugar.col, plan.lugar || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.numParticipantes.row, CELLS.numParticipantes.col, plan.numParticipantes || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.nivelEstudios.row, CELLS.nivelEstudios.col, plan.nivelEstudios || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.conocimientosRequeridos.row, CELLS.conocimientosRequeridos.col,
        normalizarSaltosLinea(plan.conocimientosRequeridos), sheetTitle);
    pushUpdate(actualizaciones, CELLS.habilidadesRequeridas.row, CELLS.habilidadesRequeridas.col,
        normalizarSaltosLinea(plan.habilidadesRequeridas), sheetTitle);
    pushUpdate(actualizaciones, lay.objetivoGeneral || CELLS.objetivoGeneral.row, CELLS.objetivoGeneral.col,
        normalizarSaltosLinea(plan.objetivoGeneral), sheetTitle);

    const partes = sanitizarObjetivosParticulares(plan.objetivosParticulares)
        .map((t) => String(t || '').replace(/^[a-z]\)\s*/i, '').trim());
    const slotsParts = Math.max(0, lay.particularesFin - lay.particularesInicio + 1);
    for (let i = 0; i < slotsParts; i++) {
        const row = lay.particularesInicio + i;
        const texto = partes[i] || '';
        pushUpdate(
            actualizaciones,
            row,
            1,
            i === 0 ? 'Particulares' : '',
            sheetTitle
        );
        pushUpdate(
            actualizaciones,
            row,
            CELLS.objetivosParticulares.col,
            textoTieneContenido(texto) ? `${letraParticularContenido(i)}${texto}` : '',
            sheetTitle
        );
    }

    pushUpdate(actualizaciones, lay.recursosDidacticos || CELLS.recursosDidacticos.row, CELLS.recursosDidacticos.col,
        normalizarSaltosLinea(plan.recursosDidacticos), sheetTitle);
    pushUpdate(actualizaciones, lay.equipoApoyo || CELLS.equipoApoyo.row, CELLS.equipoApoyo.col,
        normalizarSaltosLinea(plan.equipoApoyo), sheetTitle);

    const lista = aplanarMomentosParaHoja(plan.momentos);
    const slotsMomentos = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
    for (let i = 0; i < slotsMomentos; i++) {
        const row = lay.momentosInicio + i;
        const m = lista[i] || crearMomentoVacio('');
        pushUpdate(actualizaciones, row, CELLS.momento.col, etiquetaMomentoVisibleEnFila(lista, i), sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.fecha.col, fechaParaHojaSpF07(m.fecha), sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.horaInicio.col, horaParaSheetsSpF07(m.horaInicio), sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.contenidoTematico.col, m.contenidoTematico || '', sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.descripcionActividades.col, m.descripcionActividades || '', sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.horaTermino.col, horaParaSheetsSpF07(m.horaTermino), sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.tecnicasInstruccionales.col, m.tecnicasInstruccionales || '', sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.tecnicasGrupales.col, m.tecnicasGrupales || '', sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.duracionMomento.col, m.duracion || '', sheetTitle);
    }

    pushUpdate(actualizaciones, lay.tiempoTotal, CELLS.tiempoTotalCol, plan.tiempoTotal || '', sheetTitle);
    pushUpdate(actualizaciones, lay.metodoEvaluacion, CELLS.metodoEvaluacionCol,
        normalizarSaltosLinea(plan.metodoEvaluacion), sheetTitle);

    const refs = sanitizarReferencias(plan.referencias);
    const slotsRefs = Math.max(0, lay.refsFin - lay.refsInicio + 1);
    for (let i = 0; i < slotsRefs; i++) {
        const row = lay.refsInicio + i;
        pushUpdate(actualizaciones, row, CELLS.referenciaNumeroCol, String(i + 1), sheetTitle);
        pushUpdate(actualizaciones, row, CELLS.referenciasStartCol, String(refs[i] || '').trim(), sheetTitle);
    }

    return actualizaciones;
}

async function centrarBloquesSpF07(spreadsheetId, sheetTitle, layout, plan = null) {
    const lay = layout || layoutPorDefecto();
    // Bloques amplios: etiquetas + valores, para que el PDF no se vea desalineado.
    const bloques = [
        {
            startRow: 1,
            endRow: CELLS.numParticipantes.row,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: CELLS.nivelEstudios.row,
            endRow: CELLS.habilidadesRequeridas.row,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: lay.objetivoGeneral || CELLS.objetivoGeneral.row,
            endRow: lay.particularesFin || CELLS.objetivosParticulares.row,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: lay.recursosDidacticos || CELLS.recursosDidacticos.row,
            endRow: lay.equipoApoyo || CELLS.equipoApoyo.row,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: lay.leyendaMomentos,
            endRow: Math.max(lay.momentosFin, lay.tiempoTotal || lay.momentosFin),
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: lay.metodoEvaluacion,
            endRow: lay.metodoEvaluacion,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        },
        {
            startRow: lay.refsInicio,
            endRow: lay.refsFin,
            startColumn: 1,
            endColumn: MAX_COLUMNAS_SISTEMA
        }
    ];

    for (const bloque of bloques) {
        if (!Number.isFinite(bloque.startRow) || !Number.isFinite(bloque.endRow)
            || bloque.endRow < bloque.startRow) {
            continue;
        }
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow: bloque.startRow,
                endRow: bloque.endRow,
                startColumn: bloque.startColumn,
                endColumn: bloque.endColumn,
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
            });
        } catch (err) {
            console.warn('[SP-F-07] No se pudo centrar bloque:', err.message);
        }
    }

    // Horas como texto (@) + reescritura: conserva «a.m.» / «p.m.» en hoja y PDF.
    await forzarFormatoTextoHorasMomentosSpF07(spreadsheetId, sheetTitle, lay, plan);
}

async function forzarFormatoTextoHorasMomentosSpF07(spreadsheetId, sheetTitle, layout, plan = null) {
    const lay = layout || layoutPorDefecto();
    if (!(lay.momentosFin >= lay.momentosInicio)) return;
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) return;

    const { google } = require('googleapis');
    const sheetsApi = google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
    const requests = [];

    // Formato TEXT en columnas de hora
    for (const col of [CELLS.horaInicio.col, CELLS.horaTermino.col]) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId: Number(sheetId),
                    startRowIndex: lay.momentosInicio - 1,
                    endRowIndex: lay.momentosFin,
                    startColumnIndex: col - 1,
                    endColumnIndex: col
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: { type: 'TEXT' },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP'
                    }
                },
                fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
            }
        });
    }

    // WRAP + alineación en columnas de texto (evita corte en PDF).
    for (const col of [
        CELLS.contenidoTematico.col,
        CELLS.descripcionActividades.col,
        CELLS.tecnicasInstruccionales.col,
        CELLS.tecnicasGrupales.col,
        CELLS.duracionMomento.col
    ]) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId: Number(sheetId),
                    startRowIndex: lay.momentosInicio - 1,
                    endRowIndex: lay.momentosFin,
                    startColumnIndex: col - 1,
                    endColumnIndex: col
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP'
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
            }
        });
    }

    // Altura suficiente para 2 líneas envueltas (p. ej. «Pregunta-Respuesta»).
    requests.push({
        updateDimensionProperties: {
            range: {
                sheetId: Number(sheetId),
                dimension: 'ROWS',
                startIndex: lay.momentosInicio - 1,
                endIndex: lay.momentosFin
            },
            properties: { pixelSize: 52 },
            fields: 'pixelSize'
        }
    });

    // Reescribir horas como stringValue (no TIME) con a.m./p.m.
    if (plan) {
        const lista = aplanarMomentosParaHoja(plan.momentos);
        const slots = Math.max(0, lay.momentosFin - lay.momentosInicio + 1);
        for (let i = 0; i < slots; i++) {
            const m = lista[i] || crearMomentoVacio('');
            const row = lay.momentosInicio + i;
            const hi = formatearHoraAmPmSpF07(m.horaInicio) || '';
            const ht = formatearHoraAmPmSpF07(m.horaTermino) || '';
            for (const [col, texto] of [
                [CELLS.horaInicio.col, hi],
                [CELLS.horaTermino.col, ht]
            ]) {
                requests.push({
                    updateCells: {
                        range: {
                            sheetId: Number(sheetId),
                            startRowIndex: row - 1,
                            endRowIndex: row,
                            startColumnIndex: col - 1,
                            endColumnIndex: col
                        },
                        rows: [{
                            values: [{
                                userEnteredValue: { stringValue: texto },
                                userEnteredFormat: {
                                    numberFormat: { type: 'TEXT' },
                                    horizontalAlignment: 'CENTER',
                                    verticalAlignment: 'MIDDLE',
                                    wrapStrategy: 'WRAP'
                                }
                            }]
                        }],
                        fields: 'userEnteredValue,userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
                    }
                });
            }
        }
    }

    try {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[SP-F-07] No se pudo forzar texto/altura en momentos:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    const titulo = sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId, datos);

    // Si la pestaña del plan no existe, créala desde plantilla (evita Unable to parse range).
    let existe = await asegurarTituloHojaExisteExacto(spreadsheetId, titulo);
    if (!existe && titulo && titulo !== SHEET_TITLE && titulo !== 'Sin-folio') {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const plantillaOrigen = (titulos || []).find((t) => String(t || '').trim().toLowerCase() === SHEET_TITLE)
            || (titulos || []).find((t) => /^plantilla$/i.test(String(t || '').trim()));
        if (!plantillaOrigen) {
            throw new Error(
                `No existe la hoja «${titulo}» ni la plantilla base en Drive. `
                + 'Revisa el archivo SP-F-07 Plan del curso (sistema).'
            );
        }
        await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaOrigen, titulo);
        existe = await asegurarTituloHojaExisteExacto(spreadsheetId, titulo);
        if (!existe) {
            throw new Error(`No se pudo crear la hoja «${titulo}» en Drive.`);
        }
    }

    let buffer = await descargarBufferDrive(spreadsheetId);
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    let ws = wb.getWorksheet(titulo) || resolverHojaWorkbook(wb, 'edicion');
    if (!ws) throw new Error(`La hoja «${titulo}» no existe en SP-F-07.`);

    let layoutDetectado = detectarLayoutDesdeWorksheet(ws);
    const layoutExpandido = await asegurarEspacioMomentosYReferencias(
        spreadsheetId,
        titulo,
        datos,
        layoutDetectado
    );

    buffer = await descargarBufferDrive(spreadsheetId);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    ws = wb.getWorksheet(titulo) || resolverHojaWorkbook(wb, 'edicion');
    layoutDetectado = ws ? detectarLayoutDesdeWorksheet(ws) : layoutDetectado;
    const layout = fusionarLayoutExpandido(layoutDetectado, layoutExpandido);

    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await asegurarMergesFilasMomentoSpF07(spreadsheetId, titulo, layout);
    await asegurarMergesParticularesSpF07(spreadsheetId, titulo, layout);
    await asegurarMergesReferencias(spreadsheetId, titulo, layout);
    await restaurarTituloReferenciasSpF07(spreadsheetId, titulo, layout);
    const planActivo = resolverPlanActivo(sanitizarDatos(datos));
    await fusionarEtiquetasMomentoSpF07(spreadsheetId, titulo, layout, planActivo.momentos);
    // Diseño oficial gris/blanco + bordes (después de merges); Cierre = fila completa gris
    await aplicarBordesTablasSpF07(spreadsheetId, titulo, layout, planActivo.momentos);
    await aplicarColoresObjetivosSpF07(spreadsheetId, titulo, layout, planActivo);
    await centrarBloquesSpF07(spreadsheetId, titulo, layout, planActivo);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function publicarDatosEnDrive(driveFileId, datos, datosPrevios = null) {
    if (!driveFileId) return null;
    try {
        const infoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await sincronizarHojasPlanesEnDrive(driveFileId, datos, datosPrevios);
            return driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
        }
    } catch (err) {
        console.warn('[SP-F-07] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
    }
    const buffer = await escribirDatosEnPlantilla(datos);
    return subirOReemplazarEnDrive(buffer, driveFileId);
}

async function crearCopiaPlantillaEnCarpeta(pool, registro = null) {
    const existeSistema = DRIVE_FILE_ID_SISTEMA
        ? await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false)
        : false;

    if (existeSistema) {
        const info = await driveService.obtenerInfoArchivo(DRIVE_FILE_ID_SISTEMA)
            .catch(() => ({ id: DRIVE_FILE_ID_SISTEMA, name: NOMBRE_ARCHIVO_DRIVE }));
        if (pool && info?.id && registro) {
            await guardarRegistroDb(pool, {
                driveFileId: info.id,
                datos: await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO),
                fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original),
                fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
                contenidoModificado: !!registro?.contenido_modificado
            });
        }
        return info;
    }

    const existePlantilla = TEMPLATE_DRIVE_ID
        ? await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false)
        : false;
    if (!existePlantilla) {
        throw new Error(
            'Plantilla SP-F-07 no encontrada en Drive. Compártela con la cuenta del sistema (risktechbiznaga@gmail.com) como Editor.'
        );
    }
    const copia = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID
    );
    if (pool && copia?.id && registro) {
        await guardarRegistroDb(pool, {
            driveFileId: copia.id,
            datos: await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original),
            fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    return copia;
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

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
    if (existeSistema) {
        return DRIVE_FILE_ID_SISTEMA;
    }

    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }

    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMysqlMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

async function asegurarHojaPlantillaEnDrive(spreadsheetId) {
    if (!spreadsheetId) return false;
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const existente = driveService.resolverTituloHojaExistente(
            titulos,
            SHEET_TITLE,
            { fallbackRegex: /plantilla/i }
        );
        if (existente) {
            if (existente !== SHEET_TITLE) {
                try {
                    await driveService.renombrarHojaGoogleSheet(spreadsheetId, existente, SHEET_TITLE);
                } catch (err) {
                    console.warn('[SP-F-07] No se pudo renombrar hoja plantilla:', err.message);
                }
            }
            return true;
        }
        if (titulos.length) {
            try {
                await driveService.duplicarHojaGoogleSheet(spreadsheetId, titulos[0], SHEET_TITLE);
                return true;
            } catch (err) {
                console.warn('[SP-F-07] No se pudo crear hoja plantilla:', err.message);
            }
        }
        return false;
    } catch (err) {
        console.warn('[SP-F-07] No se pudo asegurar hoja plantilla:', err.message);
        return false;
    }
}

async function asegurarHojaPlanEnDrive(spreadsheetId, datos, nombreHoja) {
    const objetivo = String(nombreHoja || '').trim();
    if (!spreadsheetId || !objetivo || objetivo === 'Sin-folio') {
        return false;
    }

    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        // Coincidencia exacta: no aceptar "plantilla" como si fuera el folio del plan.
        const existenteExacto = (titulos || []).find((t) => String(t || '').trim() === objetivo);
        if (existenteExacto) {
            return true;
        }

        const plantillaOrigen = (titulos || []).find((t) => String(t || '').trim().toLowerCase() === SHEET_TITLE)
            || driveService.resolverTituloHojaExistente(
                titulos,
                SHEET_TITLE,
                { fallbackRegex: /^plantilla$/i }
            );
        if (!plantillaOrigen) {
            console.warn(
                `[SP-F-07] No hay hoja plantilla para crear "${objetivo}". `
                + `Hojas: ${titulos.join(', ') || '(ninguna)'}`
            );
            return false;
        }

        const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaOrigen, objetivo);
        const tituloFinal = dup?.title || objetivo;
        await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloFinal);
        return true;
    } catch (err) {
        console.warn(`[SP-F-07] No se pudo asegurar hoja "${objetivo}":`, err.message);
        return false;
    }
}

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaPlan(datos);

    if (driveId && hojaEditor && hojaEditor !== 'Sin-folio') {
        try {
            let gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid == null) {
                const creada = await asegurarHojaPlanEnDrive(driveId, datos, hojaEditor);
                if (creada) {
                    gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
                }
            }
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SP-F-07] No se pudo resolver gid de hoja editor:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        hojaEditor
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SP-F-07] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio && existentes.id !== DRIVE_FILE_ID_SISTEMA) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SP-F-07] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;
    const datosDb = await leerDatosRegistro(registro);

    const driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
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
            await driveService.asignarPermisoLecturaPublica(driveFileId).catch(() => false);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
            if (datosDb && Array.isArray(datosDb.planes)) {
                datos = sanitizarDatos(datosDb);
            } else {
                const buffer = await descargarBufferDrive(driveFileId);
                const lectura = await leerDatosDesdeBuffer(buffer, { sheetTitle: SHEET_TITLE });
                const metaDrive = sanitizarDatos(lectura.datos);
                datos = sanitizarDatos({
                    revision: metaDrive.revision || DATOS_DEFECTO.revision,
                    fechaRevision: metaDrive.fechaRevision || DATOS_DEFECTO.fechaRevision,
                    fechaElaboracion: metaDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
                    planes: [],
                    planActivoId: null
                });
            }
        } catch (err) {
            console.warn('[SP-F-07] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            const desdePlantilla = await leerDatosDesdePlantilla();
            datos = sanitizarDatos({
                ...desdePlantilla,
                planes: [],
                planActivoId: null
            });
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    } else if (datosDb) {
        datos = fusionarDatosPreferirDb(datos, datosDb);
    }

    if (necesitaRehidratarDriveDesdeDb(datos, datosDb) && driveFileId) {
        try {
            datos = datosDb;
            const actualizado = await publicarDatosEnDrive(driveFileId, datos, datosDb);
            if (actualizado) archivoDrive = actualizado;
        } catch (err) {
            console.warn('[SP-F-07] No se pudo rehidratar datos en Drive desde BD:', err.message);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    if (!driveFileId) {
        try {
            const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
                || datos.fechaElaboracion
                || DATOS_DEFECTO.fechaElaboracion;
            const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
            await asegurarHojaPlantillaEnDrive(copia.id);
            await sincronizarHojasPlanesEnDrive(copia.id, datos, null);
            archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
            await guardarRegistroDb(pool, {
                driveFileId: copia.id,
                datos,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[SP-F-07] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
        }
    }

    registro = {
        ...registro,
        drive_file_id: registro?.drive_file_id || archivoDrive?.id || driveFileId || null
    };
    return await construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;

    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

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

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    const driveIdResuelto = await resolverDriveFileId(registroPrevio);
    const driveId = driveIdResuelto || registroPrevio?.drive_file_id || null;

    if (!huboCambio && driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                await sincronizarHojasPlanesEnDrive(driveId, datosEntrada, datosPrevios);
            }
        } catch (err) {
            console.warn('[SP-F-07] No se pudo re-sincronizar hojas en Drive:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return await construirRespuesta(registroPrevio, datosEntrada, archivoDrive, {
            hojaEditor: resolverNombreHojaPlan(datosEntrada)
        });
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                if (huboCambio && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                await sincronizarHojasPlanesEnDrive(driveId, datosGuardar, datosPrevios);

                const archivoDrive = await driveService
                    .obtenerInfoArchivo(driveId)
                    .catch(() => ({ id: driveId }));
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return await construirRespuesta(registro, datosGuardar, archivoDrive, {
                    hojaEditor: resolverNombreHojaPlan(datosGuardar)
                });
            }
        } catch (err) {
            console.warn('[SP-F-07] No se pudo actualizar Google Sheet:', err.message);
            const e = new Error(
                `No se pudo actualizar Drive (hoja del plan): ${err.message || err}. `
                + 'Abre el archivo «SP-F-07 Plan del curso (sistema)» y revisa la pestaña del folio (PC-…).'
            );
            e.statusCode = 502;
            e.cause = err;
            throw e;
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    let archivoDrive = null;
    try {
        if (driveId) {
            archivoDrive = await publicarDatosEnDrive(driveId, datosGuardar, datosPrevios);
        }
        if (!archivoDrive) {
            const copia = await crearCopiaPlantillaEnCarpeta(pool, registroPrevio);
            await asegurarHojaPlantillaEnDrive(copia.id);
            await sincronizarHojasPlanesEnDrive(copia.id, datosGuardar, datosPrevios);
            archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
        }
    } catch (err) {
        console.warn('[SP-F-07] No se pudo sincronizar con Drive; se guarda solo en BD:', err.message || err);
        await guardarRegistroDb(pool, {
            driveFileId: driveId,
            datos: datosGuardar,
            fechaElaboracionOriginal: fechaOriginal,
            fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
            contenidoModificado
        }).catch(() => null);
        const e = new Error(
            `Se guardó en el sistema, pero no se pudo actualizar Drive: ${err.message || err}.`
        );
        e.statusCode = 502;
        e.cause = err;
        throw e;
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive?.id || driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaPlan(datosGuardar)
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return cargarFormato(pool);
    }

    const archivoDriveInfo = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosPrevios = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const metaBase = {
        revision: datosPrevios.revision,
        fechaRevision: datosPrevios.fechaRevision,
        fechaElaboracion: datosPrevios.fechaElaboracion,
        planActivoId: datosPrevios.planActivoId
    };
    const planesActualizados = Array.isArray(datosPrevios.planes)
        ? datosPrevios.planes.map((p) => ({ ...p }))
        : [];

    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        for (const titulo of titulos) {
            if (!esHojaPlanSpF07(titulo)) continue;
            try {
                const lectura = await leerDatosDesdeHojaGoogleSheet(driveFileId, titulo);
                const planLeido = resolverPlanActivo(lectura.datos);
                const idx = planesActualizados.findIndex((p) => {
                    const hojaEsperada = resolverNombreHojaPlan(datosConPlanActivo(datosPrevios, p));
                    return hojaEsperada === titulo
                        || sanitizarNombreHojaFolio(p.folio) === sanitizarNombreHojaFolio(planLeido.folio)
                        || (sanitizarNombreHojaFolio(titulo) === sanitizarNombreHojaFolio(p.folio));
                });
                if (idx >= 0) {
                    planesActualizados[idx] = sanitizarPlan({
                        ...planesActualizados[idx],
                        ...planLeido,
                        id: planesActualizados[idx].id,
                        folio: planesActualizados[idx].folio || planLeido.folio || titulo
                    });
                }
            } catch (err) {
                console.warn(`[SP-F-07] No se pudo leer hoja "${titulo}" desde Drive:`, err.message);
            }
        }
    } catch (err) {
        console.warn('[SP-F-07] No se pudieron listar hojas al sincronizar desde Drive:', err.message);
    }

    const datosDrive = sanitizarDatos({
        ...metaBase,
        planes: planesActualizados
    });

    if (necesitaRehidratarDriveDesdeDb(datosDrive, datosPrevios)) {
        try {
            await sincronizarHojasPlanesEnDrive(driveFileId, datosPrevios, datosPrevios);
        } catch (err) {
            console.warn('[SP-F-07] No se pudo rehidratar datos en Drive desde BD:', err.message);
        }
        const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta(registro, datosPrevios, archivoDrive, {
            hojaEditor: resolverNombreHojaPlan(datosPrevios)
        });
    }

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta(registro, datosDrive, archivoDrive, {
            hojaEditor: resolverNombreHojaPlan(datosDrive)
        });
    }

    contenidoModificado = true;
    fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    const datosGuardar = {
        ...datosDrive,
        fechaElaboracion: fechaModificacion
    };

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: fechaModificacion,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return await construirRespuesta(registroActualizado, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaPlan(datosGuardar)
    });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datos.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    let driveIdGuardado = await resolverDriveFileId(registro);
    let archivoDrive = null;

    try {
        if (!driveIdGuardado) {
            const info = await crearCopiaPlantillaEnCarpeta(pool, registro);
            driveIdGuardado = info?.id || DRIVE_FILE_ID_SISTEMA;
        }
        await asegurarHojaPlantillaEnDrive(driveIdGuardado);
        await sincronizarHojasPlanesEnDrive(driveIdGuardado, datosPublicar, datos);
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado)
            .catch(() => ({ id: driveIdGuardado }));
        console.log(`[SP-F-07] Plantilla re-sincronizada en spreadsheet sistema ${driveIdGuardado}`);
    } catch (err) {
        console.warn('[SP-F-07] Drive no disponible al actualizar plantilla:', err.message);
        driveIdGuardado = driveIdGuardado || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveIdGuardado,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    if (driveIdGuardado && !archivoDrive) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado).catch(() => null);
    }
    return await construirRespuesta(registroActualizado, datosPublicar, archivoDrive, {
        hojaEditor: resolverNombreHojaPlan(datosPublicar)
    });
}

/**
 * Exporta la hoja del plan activo (o el indicado) a PDF:
 * horizontal, papel carta, márgenes normales, escala «ajustar al ancho».
 */
async function descargarPlantillaPdf(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet SP-F-07 configurado para exportar a PDF.');
    }

    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const planId = String(opciones.planId || '').trim();
    let datosParaHoja = datos;
    if (planId) {
        const hit = (datos.planes || []).find((p) => String(p.id || '') === planId);
        if (hit) {
            datosParaHoja = datosConPlanActivo(datos, hit);
        }
    }

    const tituloHoja = resolverNombreHojaPlan(datosParaHoja);
    if (!tituloHoja || tituloHoja === 'Sin-folio') {
        const err = new Error('Abre o selecciona un plan con folio para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    // Re-sincroniza antes del PDF para que momentos/referencias queden dentro de la tabla.
    let layoutPdf = layoutPorDefecto();
    try {
        await actualizarDatosEnGoogleSheet(driveFileId, datosParaHoja, tituloHoja);
        const buffer = await descargarBufferDrive(driveFileId);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const ws = wb.getWorksheet(tituloHoja);
        if (ws) layoutPdf = detectarLayoutDesdeWorksheet(ws);
    } catch (err) {
        console.warn('[SP-F-07] No se pudo re-sincronizar antes del PDF:', err.message);
    }

    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SP-F-07] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        const err = new Error(
            `No se encontró la hoja «${tituloHoja}» en Drive. Guarda la información primero para sincronizar la hoja.`
        );
        err.statusCode = 404;
        throw err;
    }

    // Página 1 = encabezado/detalles/objetivos/recursos; página 2 = momentos + resto
    const pdfBuffer = await exportarPdfSpF07DosPaginas(driveFileId, gid, layoutPdf);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SP-F-07 quedó vacía.');
    }

    const nombreSeguro = sanitizarNombreHojaFolio(tituloHoja) || 'Plan';
    return {
        buffer: Buffer.from(pdfBuffer),
        nombreArchivo: `SP-F-07 ${nombreSeguro}.pdf`
    };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    sanitizarDatos,
    estructuraEsEquivalente
};
