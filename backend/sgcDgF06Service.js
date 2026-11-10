/**
 * DG-F-06 · Cuadro de mando (objetivos e indicadores) — persistencia en biznaga_sgc y sync con Drive.
 * Archivero por año: plantilla externa aislada + una hoja por año en el archivo sistema.
 * Nombre de cada pestaña = `Objetivos e indicadores {año}` (colisiones → « 2», « 3»…).
 * El histograma / hojas auxiliares del sistema se conservan; nunca se escribe en la plantilla.
 *
 * Plantilla: hoja «Plantilla».
 * Meta de encabezado: K1:L3 (L1 código, L2 revisión, L3 fecha DD-MM-YY).
 * Datos desde la fila 8, columnas:
 *   A=No. | B=Objetivo (merge B:C, se escribe en B) | D=Acciones | E=Recursos | F=Responsable
 *   G=Fecha compromiso | H=Indicador | I=Operación aritmética | J=Meta
 *   K=Frecuencia de medición | L=Frecuencia de análisis
 * Dentro de cada hoja: primero filas de objetivos y luego filas de indicadores (continuo).
 */
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'DG-F-06';

/** Plantilla maestra (solo lectura / copyTo). */
const TEMPLATE_DRIVE_ID = '1CkWMC7Oc6sR1zq3R6jsN1YFKA6HrPe_5jtzCoUkv4J0';
const TEMPLATE_SHEET_TITLE = 'Plantilla';

/** Archivo de trabajo Centro SGC (archivero + histograma). */
const DRIVE_FILE_ID_SISTEMA = '1e3UsatVLswQPzVRs5tVCdd95OAPsFwxCRSfgYx3UMBA';
/** Carpeta SGC (mismo folder que F-28); solo se usa como respaldo si el ID del sistema no responde. */
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'DG-F-06 Cuadro de mando (sistema)';
/** Fallback local en el sistema (legado); el origen real es TEMPLATE_DRIVE_ID. */
const SHEET_TITLE = 'Plantilla';

const PREFIJO_HOJA_ANIO = 'Objetivos e indicadores';
const FILA_DATOS_INICIO = 8;
const MAX_FILAS_POR_BLOQUE = 200;
const MAX_ANIOS = 40;
const COL_FIN = 12; // L

const DATOS_DEFECTO_META = {
    revision: '00',
    fechaRevision: '2025-01-21',
    fechaElaboracion: '2025-01-21'
};

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `dgf06-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

/* ───────────────────────────── Fechas ───────────────────────────── */

function formatearFechaIso(valor) {
    if (!valor) return '';
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        const y = valor.getFullYear();
        const m = String(valor.getMonth() + 1).padStart(2, '0');
        const d = String(valor.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(valor).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        let yyyy = dmy[3];
        if (yyyy.length === 2) yyyy = `20${yyyy}`;
        return `${yyyy}-${mm}-${dd}`;
    }
    return '';
}

/** DD-MM-YY (celda L3 de la plantilla). */
function formatearFechaDdMmYy(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y.slice(2)}`;
}

function formatearDatetimeMysqlMexico(valor) {
    if (!valor) return null;
    try {
        const d = valor instanceof Date ? valor : new Date(valor);
        if (Number.isNaN(d.getTime())) return null;
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(d).replace(' ', ' ');
    } catch {
        return null;
    }
}

/* ───────────────────────────── Seed por defecto ───────────────────────────── */

function crearFilasObjetivosSeed(anio) {
    const seed = [
        {
            no: 1,
            proceso: 'Lograr la satisfacción de nuestros clientes',
            acciones: '• Seguimiento a encuestas\n• Atención a quejas\n• Mejora de servicio',
            recursos: '• Humanos\n• Tecnológico\n• Tiempo',
            responsable: 'Dirección General',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Satisfacción del cliente',
            operacion: '% personas que respondieron positivamente / total de respuestas',
            meta: 'Mayor o igual a 90%',
            freqMedicion: 'Mensual',
            freqAnalisis: 'Trimestral'
        },
        {
            no: 2,
            proceso: 'Mantener la competencia del personal',
            acciones: '• Programa de capacitación\n• Evaluación de eficacia',
            recursos: '• Humanos\n• Material didáctico',
            responsable: 'Gerente de Admón y Talento Humano',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Eficacia de la capacitación',
            operacion: 'Evaluaciones aprobadas / evaluaciones aplicadas',
            meta: 'Mayor o igual a 90%',
            freqMedicion: 'Por curso',
            freqAnalisis: 'Semestral'
        },
        {
            no: 3,
            proceso: 'Cumplir el programa de auditorías internas',
            acciones: '• Ejecutar SGC-F-07\n• Seguimiento a hallazgos',
            recursos: '• Auditores internos\n• Tiempo',
            responsable: 'Ejecutivo de Sistemas de Gestión',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Cumplimiento del programa de auditoría',
            operacion: 'Auditorías realizadas / programadas',
            meta: '100%',
            freqMedicion: 'Semestral',
            freqAnalisis: 'Anual'
        }
    ];
    return seed.map((fila, idx) => ({ ...fila, id: `dg-f06-obj-${anio}-${idx + 1}` }));
}

function crearFilasIndicadoresSeed(anio) {
    const seed = [
        {
            no: 1,
            proceso: 'Satisfacción del cliente',
            acciones: '• Aplicar encuesta\n• Análisis de comentarios',
            recursos: '• Tiempo\n• Formularios',
            responsable: 'Ejecutivo de Sistemas de Gestión y Capacitación',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Quejas del cliente',
            operacion: 'No aplica',
            meta: '0 quejas',
            freqMedicion: 'Mensual',
            freqAnalisis: 'Mensual'
        },
        {
            no: 2,
            proceso: 'Competencia y capacitación',
            acciones: '• Evaluar eficacia de cursos\n• Seguimiento a DC-3',
            recursos: '• Humanos\n• Tecnológico',
            responsable: 'Gerente de Administración y Talento Humano',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Eficacia de la capacitación',
            operacion: 'Aprobados / evaluados × 100',
            meta: 'Mayor o igual a 90%',
            freqMedicion: 'Por curso',
            freqAnalisis: 'Semestral'
        },
        {
            no: 3,
            proceso: 'Proveeduría externa',
            acciones: '• Evaluación de proveedores\n• Reevaluación anual',
            recursos: '• Tiempo\n• Registros',
            responsable: 'Gerente de Administración y Talento Humano',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Evaluación de proveedores',
            operacion: 'Nivel de riesgo según matriz',
            meta: 'Nivel de riesgo NULO',
            freqMedicion: 'Anual',
            freqAnalisis: 'Anual'
        },
        {
            no: 4,
            proceso: 'Ambiente para la operación de los procesos',
            acciones: '• Monitoreo de condiciones\n• Acciones correctivas',
            recursos: '• Humanos\n• Equipo de medición',
            responsable: 'Ejecutivo de Sistemas de Gestión',
            fechaCompromiso: `Diciembre de ${anio}`,
            indicador: 'Ambiente de operación',
            operacion: 'Clasificación de hallazgos',
            meta: 'Sin condiciones de riesgo alto',
            freqMedicion: 'Mensual',
            freqAnalisis: 'Trimestral'
        }
    ];
    return seed.map((fila, idx) => ({ ...fila, id: `dg-f06-ind-${anio}-${idx + 1}` }));
}

function anioActualMexico() {
    try {
        const y = Number(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Mexico_City',
            year: 'numeric'
        }).format(new Date()));
        return Number.isFinite(y) ? y : new Date().getFullYear();
    } catch {
        return new Date().getFullYear();
    }
}

function crearAnioSeed(anio) {
    return {
        id: `dg-f06-anio-${anio}`,
        anio,
        titulo: `Cuadro de mando ${anio}`,
        hojaExcel: resolverNombreHojaAnio({ anio }),
        objetivos: crearFilasObjetivosSeed(anio),
        indicadores: crearFilasIndicadoresSeed(anio)
    };
}

/** Seed: año actual + año anterior (año actual activo). */
function crearDatosDefecto() {
    const actual = anioActualMexico();
    const anios = [crearAnioSeed(actual - 1), crearAnioSeed(actual)];
    return sanitizarDatos({
        ...DATOS_DEFECTO_META,
        anios,
        anioActivoId: anios[1].id
    });
}

/* ───────────────────────────── Sanitización ───────────────────────────── */

function normalizarTexto(texto) {
    return String(texto ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function sanitizarAnioNumero(valor) {
    const n = Math.floor(Number(String(valor ?? '').trim()));
    if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
    return anioActualMexico();
}

function sanitizarFila(raw, idx = 0) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const noRaw = base.no;
    let no = noRaw === '' || noRaw == null ? idx + 1 : noRaw;
    const noNum = Number(no);
    no = Number.isFinite(noNum) && String(no).trim() !== '' ? noNum : (String(no).trim() || idx + 1);
    const fila = {
        id: String(base.id || '').trim() || nuevoId(),
        no,
        proceso: normalizarTexto(base.proceso ?? base.objetivo),
        acciones: normalizarTexto(base.acciones),
        recursos: normalizarTexto(base.recursos),
        responsable: normalizarTexto(base.responsable),
        fechaCompromiso: normalizarTexto(base.fechaCompromiso),
        indicador: normalizarTexto(base.indicador),
        operacion: normalizarTexto(base.operacion),
        meta: normalizarTexto(base.meta),
        freqMedicion: normalizarTexto(base.freqMedicion),
        freqAnalisis: normalizarTexto(base.freqAnalisis)
    };
    // Resultados mensuales (solo UI; no se escriben a Excel). Se conservan si llegan.
    if (Array.isArray(base.resultados)) {
        fila.resultados = base.resultados.slice(0, 12).map((r) => ({
            mes: String(r?.mes || '').trim().slice(0, 8),
            valor: String(r?.valor ?? '').trim().slice(0, 40),
            estado: ['ok', 'risk', 'bad', 'warn'].includes(String(r?.estado || '').trim())
                ? String(r.estado).trim()
                : ''
        }));
    }
    return fila;
}

function sanitizarFilas(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_FILAS_POR_BLOQUE).map((f, i) => sanitizarFila(f, i));
}

/**
 * Nombre estándar de la hoja del año: «Objetivos e indicadores YYYY».
 */
function resolverNombreHojaAnio(anioDoc) {
    const anio = sanitizarAnioNumero(anioDoc?.anio);
    return sanitizarNombreHoja(`${PREFIJO_HOJA_ANIO} ${anio}`);
}

function sanitizarAnio(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const anio = sanitizarAnioNumero(base.anio);
    return {
        id: String(base.id || '').trim() || nuevoId(),
        anio,
        titulo: String(base.titulo || '').trim() || `Cuadro de mando ${anio}`,
        hojaExcel: sanitizarNombreHoja(base.hojaExcel || base.hoja_excel || '') || resolverNombreHojaAnio({ anio }),
        objetivos: sanitizarFilas(base.objetivos),
        indicadores: sanitizarFilas(base.indicadores)
    };
}

/**
 * Migra la forma legada `documentos[]` ({ tipo: 'objetivos'|'indicadores', anio, filas })
 * a `anios[]`.
 */
function migrarDocumentosLegado(documentos) {
    const porAnio = new Map();
    for (const doc of documentos || []) {
        if (!doc || typeof doc !== 'object') continue;
        const anio = sanitizarAnioNumero(doc.anio);
        if (!porAnio.has(anio)) {
            porAnio.set(anio, {
                id: String(doc.id || '').trim() ? `dg-f06-anio-${anio}` : nuevoId(),
                anio,
                titulo: `Cuadro de mando ${anio}`,
                hojaExcel: resolverNombreHojaAnio({ anio }),
                objetivos: [],
                indicadores: []
            });
        }
        const destino = porAnio.get(anio);
        const tipo = String(doc.tipo || '').trim().toLowerCase();
        const filas = Array.isArray(doc.filas) ? doc.filas : [];
        if (tipo === 'indicadores') destino.indicadores.push(...filas);
        else if (tipo === 'objetivos') destino.objetivos.push(...filas);
    }
    return [...porAnio.values()].sort((a, b) => a.anio - b.anio);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let aniosRaw = Array.isArray(base.anios) ? base.anios : null;
    if (!aniosRaw && Array.isArray(base.documentos)) {
        aniosRaw = migrarDocumentosLegado(base.documentos);
    }
    const anios = (aniosRaw || []).slice(0, MAX_ANIOS).map(sanitizarAnio);

    let activo = String(base.anioActivoId || '').trim() || null;
    if (activo && !anios.some((a) => a.id === activo)) {
        activo = null;
    }
    return {
        revision: String(base.revision || DATOS_DEFECTO_META.revision).trim() || '00',
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO_META.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO_META.fechaElaboracion,
        anios,
        anioActivoId: activo
    };
}

/** Año activo: el elegido, si no el año en curso, si no el de mayor año. */
function resolverAnioActivo(datos) {
    const meta = sanitizarDatos(datos);
    if (!meta.anios.length) return null;
    const porId = meta.anios.find((a) => a.id === meta.anioActivoId);
    if (porId) return porId;
    const actual = anioActualMexico();
    const delActual = meta.anios.find((a) => a.anio === actual);
    if (delActual) return delActual;
    return [...meta.anios].sort((a, b) => b.anio - a.anio)[0];
}

function datosConAnioActivo(datos, anioDoc) {
    return sanitizarDatos({
        ...(datos || {}),
        anioActivoId: anioDoc?.id || null
    });
}

function anioTieneContenido(anioDoc) {
    if (!anioDoc) return false;
    return (anioDoc.objetivos || []).length + (anioDoc.indicadores || []).length > 0;
}

/* ───────────────────────────── Nombres de hoja ───────────────────────────── */

function esHojaReservadaSgcDgF06(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (t === SHEET_TITLE || /^plantilla\.?$/i.test(t)) return true;
    if (/histograma/i.test(t)) return true;
    if (/^Alias_/i.test(t) || /^Partes_/i.test(t)) return true;
    if (/^_tmp_/i.test(t)) return true;
    if (/^DGF06/i.test(t)) return true;
    if (excelHistorial.esHojaHistorial(t, CODIGO_FORMATO)) return true;
    return false;
}

function tituloHojaCoincide(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buscarTituloHoja(titulos, nombre) {
    return (titulos || []).find((titulo) => tituloHojaCoincide(titulo, nombre)) || '';
}

function esHojaAnioSgcDgF06(titulo) {
    const t = String(titulo || '').trim();
    if (esHojaReservadaSgcDgF06(t)) return false;
    return new RegExp(`^${PREFIJO_HOJA_ANIO}\\s+\\d{4}(\\s+\\d+)?$`, 'i').test(t);
}

function resolverNombreHojaAnioUnico(anioDoc, ocupados = []) {
    let base = resolverNombreHojaAnio(anioDoc);
    if (esHojaReservadaSgcDgF06(base)) {
        base = `Cuadro ${base}`.slice(0, 90);
    }
    const usados = new Set(
        (ocupados || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
    );
    let nombre = base;
    let n = 2;
    while (usados.has(nombre.toLowerCase()) || esHojaReservadaSgcDgF06(nombre)) {
        nombre = `${base} ${n}`.slice(0, 90);
        n += 1;
    }
    return nombre;
}

function resolverNombreHojaAnioActivo(datos, ocupados = []) {
    const activo = resolverAnioActivo(datos);
    if (!activo) return '';
    const fijo = sanitizarNombreHoja(activo.hojaExcel);
    if (fijo && !esHojaReservadaSgcDgF06(fijo) && !(ocupados || []).length) {
        return fijo;
    }
    return resolverNombreHojaAnioUnico(activo, ocupados);
}

/**
 * Asigna un nombre de hoja por año: conserva el nombre previo mientras siga siendo
 * compatible con «Objetivos e indicadores {año}» (o su variante con sufijo); si cambió el año, renombra.
 */
function asignarNombresHojasAnios(anios, mapaPrevio, titulosExistentes) {
    const nombrePorId = new Map();
    const ocupados = [];
    const previosNuestros = new Set(
        [...mapaPrevio.values()].map((n) => String(n || '').trim().toLowerCase())
    );

    for (const item of anios || []) {
        const prev = mapaPrevio.get(item.id);
        if (!prev || esHojaReservadaSgcDgF06(prev)) continue;
        const base = resolverNombreHojaAnio(item).toLowerCase();
        const prevLower = String(prev).trim().toLowerCase();
        const compatible = prevLower === base
            || (prevLower.startsWith(`${base} `) && /^\d+$/.test(prevLower.slice(base.length + 1)));
        if (!compatible) continue;
        if (ocupados.some((o) => tituloHojaCoincide(o, prev))) continue;
        nombrePorId.set(item.id, prev);
        ocupados.push(prev);
    }

    // Hojas ajenas bloquean el nombre; las del patrón «Objetivos e indicadores …» son nuestras y se reutilizan.
    const bloqueadosExternos = (titulosExistentes || []).filter(
        (t) => !previosNuestros.has(String(t || '').trim().toLowerCase()) && !esHojaAnioSgcDgF06(t)
    );
    for (const item of anios || []) {
        if (nombrePorId.has(item.id)) continue;
        const nombre = resolverNombreHojaAnioUnico(item, [...ocupados, ...bloqueadosExternos]);
        nombrePorId.set(item.id, nombre);
        ocupados.push(nombre);
    }
    return nombrePorId;
}

function aplicarNombresHojaEnDatos(datos, hojasPorId) {
    if (!datos || !hojasPorId) return;
    for (const item of datos.anios || []) {
        const nombre = hojasPorId.get(item.id);
        if (nombre) item.hojaExcel = nombre;
    }
}

/* ───────────────────────────── Escritura en Excel ───────────────────────────── */

function rangoSheet(a1, sheetTitle) {
    const titulo = String(sheetTitle || SHEET_TITLE).replace(/'/g, "''");
    return `'${titulo}'!${a1}`;
}

function unirFilasAnio(anioDoc) {
    return [...(anioDoc?.objetivos || []), ...(anioDoc?.indicadores || [])];
}

function valorNo(no) {
    if (typeof no === 'number') return no;
    const n = Number(no);
    if (Number.isFinite(n) && String(no).trim() !== '') return n;
    return String(no ?? '');
}

/** Actualizaciones de celdas A..L de datos (B = objetivo; C queda combinada). */
function filasAActualizacionesSheet(filas, sheetTitle) {
    const total = Math.max(1, filas.length);
    const colA = [];
    const colB = [];
    const colDaL = [];
    for (let i = 0; i < total; i++) {
        const f = filas[i];
        colA.push([f ? valorNo(f.no) : '']);
        colB.push([f ? f.proceso : '']);
        colDaL.push([
            f ? f.acciones : '',
            f ? f.recursos : '',
            f ? f.responsable : '',
            f ? f.fechaCompromiso : '',
            f ? f.indicador : '',
            f ? f.operacion : '',
            f ? f.meta : '',
            f ? f.freqMedicion : '',
            f ? f.freqAnalisis : ''
        ]);
    }
    const r = FILA_DATOS_INICIO;
    return [
        { range: rangoSheet(`A${r}`, sheetTitle), values: colA },
        { range: rangoSheet(`B${r}`, sheetTitle), values: colB },
        { range: rangoSheet(`D${r}`, sheetTitle), values: colDaL }
    ];
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

function getSheetsApi() {
    const { google } = require('googleapis');
    return google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
}

/**
 * Cuenta filas de datos contiguas desde la fila 8 (cualquier celda A..L con contenido). Mínimo 1.
 */
async function detectarFilasDatosActuales(spreadsheetId, sheetTitle) {
    const fin = FILA_DATOS_INICIO + 500;
    const rows = await driveService.leerRangoGoogleSheet(
        spreadsheetId,
        rangoSheet(`A${FILA_DATOS_INICIO}:L${fin}`, sheetTitle)
    );
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
        const tiene = (rows[i] || []).some((c) => String(c ?? '').trim() !== '');
        if (!tiene) break;
        n += 1;
    }
    return Math.max(1, n);
}

/**
 * Garantiza `totalFilas` filas de datos desde la fila 8: inserta debajo de la última fila de datos
 * (heredando formato de la fila previa) o elimina las sobrantes. La plantilla trae 1 fila (fila 8).
 */
async function asegurarFilasDatos(spreadsheetId, sheetTitle, totalFilas) {
    const n = Math.max(1, Math.min(MAX_FILAS_POR_BLOQUE * 2, Number(totalFilas) || 1));
    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        throw new Error(`Hoja "${sheetTitle}" no encontrada`);
    }

    let actuales = 1;
    try {
        actuales = await detectarFilasDatosActuales(spreadsheetId, sheetTitle);
    } catch (err) {
        console.warn('[DG-F-06] No se pudo detectar filas de datos:', err.message);
    }
    const delta = n - actuales;
    const idxPrimeraNueva = FILA_DATOS_INICIO - 1 + actuales; // 0-based

    if (delta > 0) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, idxPrimeraNueva, delta, {
            inheritFromBefore: true
        });
        try {
            const sheetsApi = getSheetsApi();
            await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            copyPaste: {
                                source: {
                                    sheetId,
                                    startRowIndex: FILA_DATOS_INICIO - 1,
                                    endRowIndex: FILA_DATOS_INICIO,
                                    startColumnIndex: 0,
                                    endColumnIndex: COL_FIN
                                },
                                destination: {
                                    sheetId,
                                    startRowIndex: idxPrimeraNueva,
                                    endRowIndex: idxPrimeraNueva + delta,
                                    startColumnIndex: 0,
                                    endColumnIndex: COL_FIN
                                },
                                pasteType: 'PASTE_FORMAT',
                                pasteOrientation: 'NORMAL'
                            }
                        }
                    ]
                }
            });
        } catch (err) {
            console.warn('[DG-F-06] No se pudo copiar formato de fila 8:', err.message);
        }
    } else if (delta < 0) {
        await driveService.eliminarFilasGoogleSheet(spreadsheetId, sheetId, FILA_DATOS_INICIO - 1 + n, -delta);
    }

    // Objetivo combinado B:C por fila
    try {
        const sheetsApi = getSheetsApi();
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    mergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: FILA_DATOS_INICIO - 1,
                            endRowIndex: FILA_DATOS_INICIO - 1 + n,
                            startColumnIndex: 1,
                            endColumnIndex: 3
                        },
                        mergeType: 'MERGE_ROWS'
                    }
                }]
            }
        });
    } catch (err) {
        console.warn('[DG-F-06] No se pudo combinar B:C:', err.message);
    }

    return { sheetId, totalFilas: n, filasAnteriores: actuales };
}

function estimarLineas(texto, ancho) {
    const t = String(texto ?? '').replace(/\r\n/g, '\n');
    if (!t.trim()) return 1;
    let total = 0;
    for (const linea of t.split('\n')) {
        total += Math.max(1, Math.ceil(linea.length / ancho));
    }
    return total;
}

/** Alto de fila (px) según el texto más largo de la fila. */
async function aplicarAltoFilas(spreadsheetId, sheetId, filas) {
    if (!filas.length) return;
    try {
        const requests = [];
        for (let i = 0; i < filas.length; i++) {
            const f = filas[i];
            const lineas = Math.max(
                estimarLineas(f.proceso, 38),
                estimarLineas(f.acciones, 30),
                estimarLineas(f.recursos, 24),
                estimarLineas(f.responsable, 22),
                estimarLineas(f.indicador, 24),
                estimarLineas(f.operacion, 28),
                estimarLineas(f.meta, 20)
            );
            const px = Math.min(320, Math.max(40, 14 + lineas * 16));
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: FILA_DATOS_INICIO - 1 + i,
                        endIndex: FILA_DATOS_INICIO + i
                    },
                    properties: { pixelSize: px },
                    fields: 'pixelSize'
                }
            });
        }
        await getSheetsApi().spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    } catch (err) {
        console.warn('[DG-F-06] Alto de filas:', err.message);
    }
}

/** Lee K1:L3 y decide dónde escribir revisión / fecha (L2 y L3 por defecto). */
async function resolverCeldasMeta(spreadsheetId, sheetTitle, meta) {
    const revisionTxt = String(meta.revision || '00');
    const fechaTxt = formatearFechaDdMmYy(meta.fechaRevision);
    const actualizaciones = [];
    let filas = [];
    try {
        filas = await driveService.leerRangoGoogleSheet(spreadsheetId, rangoSheet('K1:L3', sheetTitle));
    } catch {
        filas = [];
    }
    const celda = (r, c) => String((filas[r] || [])[c] ?? '').trim();

    const decidir = (rowIdx, regexLabel, valor, etiquetaInline) => {
        const k = celda(rowIdx, 0);
        const l = celda(rowIdx, 1);
        // Etiqueta + valor en la misma celda K (p. ej. «Revisión: 00») y L vacía
        if (k && regexLabel.test(k) && /[:：]\s*\S/.test(k) && !l) {
            actualizaciones.push({
                range: rangoSheet(`K${rowIdx + 1}`, sheetTitle),
                values: [[valor ? `${etiquetaInline} ${valor}` : `${etiquetaInline}`]]
            });
            return;
        }
        actualizaciones.push({
            range: rangoSheet(`L${rowIdx + 1}`, sheetTitle),
            values: [[valor]]
        });
    };

    decidir(1, /revisi[oó]n/i, revisionTxt, 'Revisión:');
    decidir(2, /fecha/i, fechaTxt, 'Fecha de rev.:');
    return actualizaciones;
}

async function actualizarDatosEnHoja(spreadsheetId, datos, sheetTitle, anioDoc) {
    const meta = sanitizarDatos(datos);
    const anio = anioDoc || resolverAnioActivo(meta);
    const filas = unirFilasAnio(anio);

    const layout = await asegurarFilasDatos(spreadsheetId, sheetTitle, Math.max(1, filas.length));
    const actualizaciones = [
        ...(await resolverCeldasMeta(spreadsheetId, sheetTitle, meta)),
        ...filasAActualizacionesSheet(filas, sheetTitle)
    ];
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await aplicarAltoFilas(spreadsheetId, layout.sheetId, filas);
    return layout;
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 * Nunca escribe ni borra en TEMPLATE_DRIVE_ID.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || 'Sin-nombre';
    console.warn(
        `[DG-F-06] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    return copiada.title || destino;
}

async function recrearHojaAnio(spreadsheetId, nombreHoja, datosConActivo, anioDoc, plantillaLocal = '') {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('DG-F-06 solo recrea hojas en el archivo sistema.');
    }
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const existente = buscarTituloHoja(titulos, nombreHoja);
    if (existente && !esHojaReservadaSgcDgF06(existente)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [existente]);
        } catch (err) {
            console.warn(`[DG-F-06] No se pudo eliminar hoja previa ${existente}:`, err.message);
        }
    }

    let tituloFinal;
    try {
        tituloFinal = await adoptarPlantillaEnSistema(spreadsheetId, nombreHoja);
    } catch (err) {
        console.warn(`[DG-F-06] copyTo plantilla falló para "${nombreHoja}":`, err.message);
        const origen = plantillaLocal
            || driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /plantilla/i })
            || '';
        if (!origen) throw err;
        const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, origen, nombreHoja);
        tituloFinal = dup.title || nombreHoja;
    }

    await actualizarDatosEnHoja(spreadsheetId, datosConActivo, tituloFinal, anioDoc);
    return tituloFinal;
}

/**
 * Una pestaña por año; nombre = «Objetivos e indicadores {año}».
 * No escribe en la plantilla externa ni borra histograma / hojas reservadas.
 */
async function sincronizarHojasAniosEnDrive(spreadsheetId, datos, datosPrevios = null, opciones = {}) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('DG-F-06 solo escribe en el archivo sistema, nunca en la plantilla externa.');
    }
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaLocal = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    ) || '';

    const mapaIdHojaPrevio = new Map();
    if (prev?.anios) {
        const ocupadosPrevios = [];
        for (const a of prev.anios) {
            const fijo = sanitizarNombreHoja(a.hojaExcel);
            const nombre = fijo || resolverNombreHojaAnioUnico(a, ocupadosPrevios);
            ocupadosPrevios.push(nombre);
            mapaIdHojaPrevio.set(a.id, nombre);
        }
    }

    const nombrePorId = asignarNombresHojasAnios(
        meta.anios.filter(anioTieneContenido),
        mapaIdHojaPrevio,
        titulosExistentes
    );
    const forzarRecrear = !!opciones?.forzarRecrear;
    const hojasActivas = new Set();
    let hojaActiva = '';
    const activoId = resolverAnioActivo(meta)?.id || null;

    for (const anioDoc of meta.anios) {
        if (!anioTieneContenido(anioDoc)) continue;

        let nombreHoja = nombrePorId.get(anioDoc.id)
            || resolverNombreHojaAnioUnico(anioDoc, [...hojasActivas]);
        const hojaPrev = mapaIdHojaPrevio.get(anioDoc.id);

        if (hojaPrev && !tituloHojaCoincide(hojaPrev, nombreHoja)
            && buscarTituloHoja([...setExistentes], hojaPrev)
            && !esHojaReservadaSgcDgF06(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(buscarTituloHoja([...setExistentes], hojaPrev));
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[DG-F-06] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                nombreHoja = hojaPrev;
            }
        }

        const existe = !!buscarTituloHoja([...setExistentes], nombreHoja);
        try {
            if (!existe || forzarRecrear) {
                nombreHoja = await recrearHojaAnio(
                    spreadsheetId,
                    nombreHoja,
                    datosConAnioActivo(meta, anioDoc),
                    anioDoc,
                    plantillaLocal
                );
            } else {
                await actualizarDatosEnHoja(
                    spreadsheetId,
                    datosConAnioActivo(meta, anioDoc),
                    nombreHoja,
                    anioDoc
                );
            }
            setExistentes.add(nombreHoja);
            hojasActivas.add(nombreHoja);
            nombrePorId.set(anioDoc.id, nombreHoja);
            if (anioDoc.id === activoId) {
                hojaActiva = nombreHoja;
            }
        } catch (err) {
            console.warn(`[DG-F-06] No se pudo sincronizar hoja "${nombreHoja}":`, err.message);
        }
    }

    // Solo se borran hojas que fueron nuestras y ya no están en anios (nunca reservadas)
    const eliminar = [];
    for (const titulo of [...setExistentes]) {
        if (esHojaReservadaSgcDgF06(titulo)) continue;
        const vigente = [...hojasActivas].some((nombre) => tituloHojaCoincide(nombre, titulo));
        const eraPrevia = [...mapaIdHojaPrevio.values()].some((nombre) => tituloHojaCoincide(nombre, titulo));
        if (!vigente && eraPrevia) eliminar.push(titulo);
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[DG-F-06] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    if (hojaActiva) {
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, hojaActiva);
        } catch (err) {
            console.warn('[DG-F-06] No se pudo mostrar la hoja activa al frente:', err.message);
        }
    }

    aplicarNombresHojaEnDatos(meta, nombrePorId);
    if (!hojaActiva && activoId) {
        hojaActiva = nombrePorId.get(activoId) || '';
    }
    return { hojasActivas, hojasPorId: nombrePorId, hojaActiva, datos: meta };
}

/* ───────────────────────────── Lectura desde Excel ───────────────────────────── */

async function leerDesdeHoja(spreadsheetId, sheetTitle, anioBase) {
    const objetivosBase = anioBase?.objetivos || [];
    const indicadoresBase = anioBase?.indicadores || [];
    const total = objetivosBase.length + indicadoresBase.length;
    if (!total) return sanitizarAnio({ ...anioBase, hojaExcel: sheetTitle });

    const fin = FILA_DATOS_INICIO + total - 1;
    const rows = await driveService.leerRangoGoogleSheet(
        spreadsheetId,
        rangoSheet(`A${FILA_DATOS_INICIO}:L${fin}`, sheetTitle)
    );
    const get = (r, c) => String((rows[r] || [])[c] ?? '').trim();

    const leerFila = (filaBase, r) => sanitizarFila({
        ...filaBase,
        no: get(r, 0) || filaBase.no,
        proceso: get(r, 1),
        acciones: get(r, 3),
        recursos: get(r, 4),
        responsable: get(r, 5),
        fechaCompromiso: get(r, 6),
        indicador: get(r, 7),
        operacion: get(r, 8),
        meta: get(r, 9),
        freqMedicion: get(r, 10),
        freqAnalisis: get(r, 11)
    }, r);

    const objetivos = objetivosBase.map((f, i) => leerFila(f, i));
    const indicadores = indicadoresBase.map((f, i) => leerFila(f, objetivosBase.length + i));
    return sanitizarAnio({ ...anioBase, objetivos, indicadores, hojaExcel: sheetTitle });
}

/* ───────────────────────────── Persistencia ───────────────────────────── */

function firmaAnio(a) {
    const limpia = (f) => ({
        no: f.no,
        proceso: f.proceso,
        acciones: f.acciones,
        recursos: f.recursos,
        responsable: f.responsable,
        fechaCompromiso: f.fechaCompromiso,
        indicador: f.indicador,
        operacion: f.operacion,
        meta: f.meta,
        freqMedicion: f.freqMedicion,
        freqAnalisis: f.freqAnalisis
    });
    return JSON.stringify({
        anio: a.anio,
        titulo: a.titulo,
        objetivos: (a.objetivos || []).map(limpia),
        indicadores: (a.indicadores || []).map(limpia)
    });
}

function contenidoEsEquivalente(a, b) {
    const da = sanitizarDatos(a);
    const db = sanitizarDatos(b);
    if (da.revision !== db.revision || da.fechaRevision !== db.fechaRevision) return false;
    if (da.anios.length !== db.anios.length) return false;
    for (let i = 0; i < da.anios.length; i++) {
        if (firmaAnio(da.anios[i]) !== firmaAnio(db.anios[i])) return false;
    }
    return true;
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

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) return false;
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') return false;
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[DG-F-06] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) return DRIVE_FILE_ID_SISTEMA;
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && await esSpreadsheetEditableEnDrive(idDb)) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/**
 * Garantiza el archivo sistema (nunca la plantilla externa).
 */
async function asegurarArchivoSistema(pool, registro) {
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        const error = new Error(
            'No se encontró el archivo sistema DG-F-06 en Drive. '
            + `Verifica el ID ${DRIVE_FILE_ID_SISTEMA} y el acceso de la cuenta de servicio.`
        );
        error.statusCode = 404;
        throw error;
    }
    if (driveFileId !== registro?.drive_file_id) {
        const datos = (await leerDatosRegistro(registro)) || crearDatosDefecto();
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
            fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    return driveFileId;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMysqlMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    let driveId = archivoDrive?.id || registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA || null;
    if (esIdPlantillaMaestra(driveId)) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaAnioActivo(datos);

    if (driveId && hojaEditor) {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[DG-F-06] No se pudo resolver gid de hoja editor:', err.message);
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

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let archivoDrive = null;
    const datosDb = await leerDatosRegistro(registro);

    const driveFileId = await asegurarArchivoSistema(pool, registro).catch(() => null);
    if (driveFileId) {
        registro = await obtenerRegistroDb(pool);
    }

    const datos = datosDb && datosDb.anios.length ? datosDb : crearDatosDefecto();

    if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    }

    return construirRespuesta(registro, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaAnioActivo(datos)
    });
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    let datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;

    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO_META.fechaElaboracion;
    }

    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);

    let driveId = null;
    try {
        driveId = await asegurarArchivoSistema(pool, registroPrevio);
    } catch (err) {
        console.warn('[DG-F-06] Archivo sistema no disponible:', err.message);
    }

    if (!huboCambio && driveId) {
        let hojaEditor = resolverNombreHojaAnioActivo(datosEntrada);
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const sync = await sincronizarHojasAniosEnDrive(driveId, datosEntrada, datosPrevios);
                if (sync?.datos) datosEntrada = sync.datos;
                hojaEditor = sync?.hojaActiva || hojaEditor;
            }
        } catch (err) {
            console.warn('[DG-F-06] Re-sync hojas:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive, { hojaEditor });
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

                const sync = await sincronizarHojasAniosEnDrive(driveId, datosGuardar, datosPrevios);
                if (sync?.datos) datosGuardar = sync.datos;
                const hojaEditor = sync?.hojaActiva || resolverNombreHojaAnioActivo(datosGuardar);

                const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive, { hojaEditor });
            }
        } catch (err) {
            console.warn('[DG-F-06] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaAnioActivo(datosGuardar)
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId;
    try {
        driveFileId = await asegurarArchivoSistema(pool, registro);
    } catch {
        return cargarFormato(pool);
    }

    const archivoDriveInfo = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || DATOS_DEFECTO_META.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosDbPrev = await leerDatosRegistro(registro);
    const datosPrevios = datosDbPrev && datosDbPrev.anios.length ? datosDbPrev : crearDatosDefecto();
    const aniosActualizados = datosPrevios.anios.map((a) => ({ ...a }));

    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        for (const titulo of titulos) {
            if (esHojaReservadaSgcDgF06(titulo)) continue;
            try {
                const idx = aniosActualizados.findIndex((a) => {
                    const hojaEsperada = sanitizarNombreHoja(a.hojaExcel) || resolverNombreHojaAnio(a);
                    return tituloHojaCoincide(hojaEsperada, titulo);
                });
                if (idx < 0) continue;
                const leida = await leerDesdeHoja(driveFileId, titulo, aniosActualizados[idx]);
                aniosActualizados[idx] = sanitizarAnio({
                    ...leida,
                    id: aniosActualizados[idx].id,
                    hojaExcel: titulo
                });
            } catch (err) {
                console.warn(`[DG-F-06] No se pudo leer hoja "${titulo}":`, err.message);
            }
        }
    } catch (err) {
        console.warn('[DG-F-06] Listar hojas sync:', err.message);
    }

    const datosDrive = sanitizarDatos({
        ...datosPrevios,
        anios: aniosActualizados
    });

    if (!contenidoEsEquivalente(datosPrevios, datosDrive)) {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosDrive,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datosDrive, archivoDriveInfo, {
        hojaEditor: resolverNombreHojaAnioActivo(datosDrive)
    });
}

/**
 * Regenera las hojas del archivero desde la plantilla externa en el archivo sistema.
 * No copia el libro entero ni escribe en la plantilla.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datosDb = await leerDatosRegistro(registro);
    let datos = datosDb && datosDb.anios.length ? datosDb : crearDatosDefecto();
    const driveFileId = await asegurarArchivoSistema(pool, registro);

    let hojaActiva = resolverNombreHojaAnioActivo(datos);
    if (datos.anios.length) {
        const sync = await sincronizarHojasAniosEnDrive(driveFileId, datos, datosDb || null, {
            forzarRecrear: true
        });
        if (sync?.datos) datos = sync.datos;
        hojaActiva = sync?.hojaActiva || hojaActiva;
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
        contenidoModificado: !!registro?.contenido_modificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta(registroFinal, datos, archivoDrive, { hojaEditor: hojaActiva });
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
