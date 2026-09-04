/**
 * SGC-F-04 · Reporte de no conformidad — persistencia en biznaga_sgc y sync con Drive.
 * Plantilla: Rev 02 (folio NC-DDMMAA-NN). Arquetipo de ciclo de vida: SGC-F-12.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-04';
/** Plantilla maestra Rev 02 (Google Sheet compartido). */
const TEMPLATE_DRIVE_ID = '1QdDYj8DlY4cAsWpF0UZd7SnoJ2t52WzhnXgrKQ80GvU';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-04 Reporte de no conformidad (sistema)';
const SHEET_TITLE = 'Reporte';

const TIMEZONE_MEXICO = 'America/Mexico_City';
const MAX_COLUMNAS_SISTEMA = 13;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

const FUENTES = ['AUDITORÍA', 'PROCESO', 'QUEJA', 'SERVICIO NO CONFORME', 'OTRO'];
const NORMAS = ['ISO 9001', 'ISO 14001', 'ISO 45001'];
const ACCIONES_INMEDIATAS_KEYS = [
    'correccion',
    'analisisCausas',
    'separacion',
    'contencion',
    'devolucion',
    'informarCliente',
    'suspension',
    'autorizacionConcesion'
];

/**
 * Mapa de celdas (1-based) alineado a la plantilla visual Rev 02 en Google Sheet.
 * Verificado contra TEMPLATE_DRIVE_ID (hoja «Reporte»).
 */
const CELLS = {
    revision: { row: 2, col: 11 },
    fechaRevision: { row: 3, col: 11 },
    fecha: { row: 6, col: 2 },
    folio: { row: 5, col: 12 },
    fuenteDetalle: { row: 10, startCol: 1, endCol: 10 },
    origenArea: { row: 14, startCol: 1, endCol: 4 },
    reportaNombre: { row: 14, col: 6 },
    reportaPuesto: { row: 15, col: 6 },
    reportaEmpresa: { row: 16, col: 6 },
    registraNc: { row: 14, startCol: 10, endCol: 13 },
    descripcionNc: { row: 19, startCol: 1, endCol: 13 },
    fechaCierre: { row: 66, col: 12 },
    firmaEspecialista: { row: 72, col: 2 },
    firmaDireccion: { row: 72, col: 6 }
};

const FUENTE_CELLS = {
    'AUDITORÍA': { row: 9, col: 2 },
    'PROCESO': { row: 9, col: 4 },
    'QUEJA': { row: 9, col: 6 },
    'SERVICIO NO CONFORME': { row: 9, col: 9 },
    'OTRO': { row: 9, col: 11 }
};

const NORMA_CELLS = {
    'ISO 9001': { row: 9, col: 13 },
    'ISO 14001': { row: 10, col: 13 },
    'ISO 45001': { row: 11, col: 13 }
};

/** Columna legacy donde se marcaba la norma (K); se limpia al escribir. */
const NORMA_CELLS_LEGACY_COL = 11;

const ACCION_INMEDIATA_CELLS = {
    correccion: { row: 25, col: 5 },
    analisisCausas: { row: 26, col: 5 },
    separacion: { row: 25, col: 10 },
    contencion: { row: 26, col: 10 },
    devolucion: { row: 27, col: 10 },
    informarCliente: { row: 28, col: 10 },
    suspension: { row: 29, col: 10 },
    autorizacionConcesion: { row: 30, col: 10 }
};

const TABLA_CORRECCION = {
    startRow: 38,
    rows: 4,
    cols: { descripcion: 2, responsable: 8, fecha: 11 }
};

const CAUSAS_START_ROW = 45;
const CAUSAS_COUNT = 5;

const TABLA_CORRECTIVAS = {
    startRow: 51,
    rows: 5,
    cols: { acciones: 2, responsable: 10, fecha: 12 }
};

const TABLA_RESULTADOS = {
    startRow: 59,
    rows: 5,
    cols: { descripcion: 2, verifico: 12 }
};

const DATOS_DEFECTO = {
    revision: '02',
    fechaRevision: '2026-08-05',
    fechaElaboracion: '2026-08-05',
    reportes: []
};

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

async function resolverTituloHojaTrabajo(spreadsheetId, datos = null) {
    if (datos) {
        return resolverNombreHojaReporte(datos);
    }
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const folioSheet = titulos.find((t) => /^NC-/i.test(String(t || '').trim()));
        if (folioSheet) return folioSheet;
    } catch {
        // Sin listado de hojas.
    }
    return SHEET_TITLE;
}

function sanitizarNombreHojaFolio(folio) {
    return String(folio || '').trim().toUpperCase()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function resolverNombreHojaReporte(datos) {
    const rep = resolverReporteActivo(sanitizarDatos(datos));
    const folio = sanitizarNombreHojaFolio(rep?.folio);
    if (folio) return folio;
    const id = String(rep?.id || '').trim();
    if (id) return `BORRADOR-${id.slice(0, 8)}`;
    return 'Sin-folio';
}

function esHojaHistorialLegacySgcF04(titulo) {
    const t = String(titulo || '').trim();
    return /^SGCF04-\d{4}$/i.test(t) || /^SGCF04_r\d+$/i.test(t);
}

function esHojaReporteSgcF04(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    if (esHojaHistorialLegacySgcF04(t)) return false;
    return /^NC-/i.test(t) || /^BORRADOR-/i.test(t);
}

function datosConReporteActivo(datos, reporte) {
    return sanitizarDatos({
        ...(datos || {}),
        reporteActivoId: reporte?.id || null
    });
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
    if (!ws) throw new Error('La plantilla SGC-F-04 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function sincronizarHojasReportesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /reporte/i }
    );

    if (!plantillaOrigen) {
        console.warn(
            '[SGC-F-04] Hoja plantilla «Reporte» no encontrada en el spreadsheet. '
            + `Hojas: ${titulosExistentes.join(', ') || '(ninguna)'}`
        );
    }

    const mapaIdHojaPrevio = new Map();
    if (prev?.reportes) {
        for (const r of prev.reportes) {
            mapaIdHojaPrevio.set(r.id, resolverNombreHojaReporte(datosConReporteActivo(meta, r)));
        }
    }

    const hojasActivas = new Set();

    for (const reporte of meta.reportes) {
        const tieneFolio = !!String(reporte.folio || '').trim();
        if (!reporteTieneContenido(reporte) && !tieneFolio) continue;

        let nombreHoja = resolverNombreHojaReporte(datosConReporteActivo(meta, reporte));
        const hojaPrev = mapaIdHojaPrevio.get(reporte.id);

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-04] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
            }
        }

        if (!setExistentes.has(nombreHoja)) {
            try {
                const dup = await driveService.duplicarHojaGoogleSheet(
                    spreadsheetId,
                    plantillaOrigen || SHEET_TITLE,
                    nombreHoja
                );
                nombreHoja = dup.title;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-04] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        hojasActivas.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(
            spreadsheetId,
            datosConReporteActivo(meta, reporte),
            nombreHoja
        );
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaHistorialLegacySgcF04(titulo)) {
            eliminar.push(titulo);
            continue;
        }
        if (esHojaReporteSgcF04(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-04] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return hojasActivas;
}

function etiquetaFechaRevision(fechaIso) {
    const display = formatearFechaDisplay(fechaIso);
    return display ? `Fecha de revisión: ${display}` : '';
}

function nuevoIdReporte() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `nc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function crearReporteVacio() {
    return {
        id: nuevoIdReporte(),
        fecha: '',
        folio: '',
        fuente: '',
        fuenteDetalle: '',
        normas: { iso9001: false, iso14001: false, iso45001: false },
        origenArea: '',
        reportaNombre: '',
        reportaPuesto: '',
        reportaEmpresa: '',
        registraNombre: '',
        registraPuesto: '',
        registraEmpresa: '',
        registraNc: '',
        descripcionNc: '',
        accionesInmediatas: {
            correccion: false,
            analisisCausas: false,
            separacion: false,
            contencion: false,
            devolucion: false,
            informarCliente: false,
            suspension: false,
            autorizacionConcesion: false
        },
        maximaAutoridadNombre: 'Marisol A. Santillán Melo',
        maximaAutoridadPuesto: 'Directora General',
        accionesCorreccion: [crearFilaCorreccionVacia()],
        causas: ['', '', '', '', ''],
        accionesCorrectivas: [crearFilaCorrectivaVacia(1)],
        resultados: [crearFilaResultadoVacia(1)],
        fechaCierre: '',
        pdfFirmado: null
    };
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-04 Reporte firmado.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarNormas(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    if (Array.isArray(raw)) {
        const set = new Set(raw.map((n) => String(n || '').trim().toUpperCase()));
        return {
            iso9001: set.has('ISO 9001') || set.has('9001'),
            iso14001: set.has('ISO 14001') || set.has('14001'),
            iso45001: set.has('ISO 45001') || set.has('45001')
        };
    }
    return {
        iso9001: !!base.iso9001,
        iso14001: !!base.iso14001,
        iso45001: !!base.iso45001
    };
}

function sanitizarAccionesInmediatas(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    ACCIONES_INMEDIATAS_KEYS.forEach((k) => {
        out[k] = !!base[k];
    });
    return out;
}

function sanitizarFilasDinamicas(lista, factory, mapFn) {
    const raw = Array.isArray(lista) && lista.length ? lista : [factory()];
    return raw.map((item, i) => mapFn(item || {}, i));
}

function componerTextoPersona(nombre, puesto, empresa, fallback = '') {
    const lineas = [];
    const n = String(nombre || '').trim();
    const p = String(puesto || '').trim();
    const e = String(empresa || '').trim();
    if (n) lineas.push(`Nombre: ${n}`);
    if (p) lineas.push(`Puesto: ${p}`);
    if (e) lineas.push(`Empresa: ${e}`);
    if (lineas.length) return lineas.join('\n');
    return normalizarSaltosLinea(fallback);
}

function parsearTextoPersona(texto) {
    const raw = String(texto || '').replace(/\r\n/g, '\n').trim();
    const out = { nombre: '', puesto: '', empresa: '' };
    if (!raw) return out;
    const tomar = (etiqueta) => {
        const m = raw.match(new RegExp(`${etiqueta}\\s*:\\s*(.+)`, 'i'));
        return m ? String(m[1] || '').trim() : '';
    };
    out.nombre = tomar('Nombre');
    out.puesto = tomar('Puesto');
    out.empresa = tomar('Empresa');
    if (out.nombre || out.puesto || out.empresa) return out;
    const lineas = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lineas.length >= 2) {
        return {
            nombre: lineas[0],
            puesto: lineas[1],
            empresa: lineas[2] || ''
        };
    }
    out.nombre = raw;
    return out;
}

function resolverPersonaRegistra(base) {
    let nombre = String(base?.registraNombre || '').trim();
    let puesto = String(base?.registraPuesto || '').trim();
    let empresa = String(base?.registraEmpresa || '').trim();
    if (!nombre && !puesto && !empresa) {
        const parsed = parsearTextoPersona(base?.registraNc);
        nombre = parsed.nombre;
        puesto = parsed.puesto;
        empresa = parsed.empresa;
    }
    return {
        registraNombre: nombre,
        registraPuesto: puesto,
        registraEmpresa: empresa,
        registraNc: componerTextoPersona(nombre, puesto, empresa, base?.registraNc)
    };
}

function sanitizarReporte(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const fuente = String(base.fuente || '').trim().toUpperCase();
    const fuenteOk = FUENTES.includes(fuente) ? fuente : (fuente ? fuente : '');

    const accionesCorreccion = sanitizarFilasDinamicas(
        base.accionesCorreccion,
        crearFilaCorreccionVacia,
        (f) => ({
            descripcion: normalizarSaltosLinea(f.descripcion),
            responsable: String(f.responsable || '').trim(),
            fecha: normalizarFechaCampo(f.fecha)
        })
    );

    const causasRaw = Array.isArray(base.causas) && base.causas.length ? base.causas : ['', '', '', '', ''];
    const causas = causasRaw.map((c) => normalizarSaltosLinea(c));

    const accionesCorrectivas = sanitizarFilasDinamicas(
        base.accionesCorrectivas,
        () => crearFilaCorrectivaVacia(1),
        (f, i) => ({
            no: i + 1,
            acciones: normalizarSaltosLinea(f.acciones),
            responsable: String(f.responsable || '').trim(),
            fecha: normalizarFechaCampo(f.fecha)
        })
    );

    const resultados = sanitizarFilasDinamicas(
        base.resultados,
        () => crearFilaResultadoVacia(1),
        (f, i) => ({
            no: i + 1,
            descripcion: normalizarSaltosLinea(f.descripcion),
            verifico: String(f.verifico || '').trim()
        })
    );

    return {
        id: String(base.id || '').trim() || nuevoIdReporte(),
        fecha: formatearFechaIso(base.fecha) || String(base.fecha || '').trim(),
        folio: String(base.folio || '').trim().toUpperCase(),
        fuente: fuenteOk,
        fuenteDetalle: normalizarSaltosLinea(base.fuenteDetalle),
        normas: sanitizarNormas(base.normas),
        origenArea: String(base.origenArea || '').trim(),
        reportaNombre: String(base.reportaNombre || '').trim(),
        reportaPuesto: String(base.reportaPuesto || '').trim(),
        reportaEmpresa: String(base.reportaEmpresa || '').trim(),
        ...resolverPersonaRegistra(base),
        descripcionNc: normalizarSaltosLinea(base.descripcionNc),
        accionesInmediatas: sanitizarAccionesInmediatas(base.accionesInmediatas),
        maximaAutoridadNombre: String(base.maximaAutoridadNombre || 'Marisol A. Santillán Melo').trim()
            || 'Marisol A. Santillán Melo',
        maximaAutoridadPuesto: String(base.maximaAutoridadPuesto || 'Directora General').trim()
            || 'Directora General',
        accionesCorreccion,
        causas,
        accionesCorrectivas,
        resultados,
        fechaCierre: normalizarFechaCampo(base.fechaCierre),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado)
    };
}

function esReporteLegacyPlano(base) {
    return !Array.isArray(base.reportes)
        && (base.folio || base.descripcionNc || base.fuente || base.fecha || base.origenArea);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let reportesRaw = [];
    if (Array.isArray(base.reportes)) {
        reportesRaw = base.reportes;
    } else if (esReporteLegacyPlano(base)) {
        reportesRaw = [base];
    }
    const reportes = reportesRaw.map(sanitizarReporte);
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        reportes,
        reporteActivoId: base.reporteActivoId ? String(base.reporteActivoId) : null
    };
}

function resolverReporteActivo(datos) {
    const lista = Array.isArray(datos?.reportes) ? datos.reportes : [];
    if (!lista.length) return crearReporteVacio();
    const id = datos?.reporteActivoId;
    if (id) {
        const found = lista.find((r) => r.id === id);
        if (found) return found;
    }
    return lista[0];
}

function textoTieneContenido(valor) {
    return String(valor || '').trim().length > 0;
}

function reporteTieneContenido(r) {
    if (!r) return false;
    return [
        r.fecha, r.folio, r.fuente, r.descripcionNc, r.origenArea, r.reportaNombre,
        r.registraNombre, r.fechaCierre
    ].some(textoTieneContenido)
        || !!r.pdfFirmado?.driveFileId;
}

function camposPrincipalesConContenido(datos) {
    if (!datos) return false;
    return Array.isArray(datos.reportes) && datos.reportes.some(reporteTieneContenido);
}

function camposPrincipalesVacios(datos) {
    return !camposPrincipalesConContenido(datos);
}

function fusionarDatosPreferirDb(datosDrive, datosDb) {
    if (!datosDb) return datosDrive;
    if (!datosDrive) return datosDb;
    // El archivero vive en BD; Drive solo refleja un snapshot del reporte activo.
    if (camposPrincipalesConContenido(datosDb)) {
        return sanitizarDatos({
            ...datosDrive,
            ...datosDb,
            reportes: datosDb.reportes
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

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y.slice(-2)}`;
}

function normalizarFechaCampo(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const iso = formatearFechaIso(texto);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : texto;
}

function marcaCheckbox(activo) {
    return activo ? 'X' : '';
}

function leerMarca(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t === 'X' || t === '✓' || t === '✔' || t === 'SI' || t === 'SÍ' || t === 'TRUE' || t === '1';
}

function crearFilaCorreccionVacia() {
    return { descripcion: '', responsable: '', fecha: '' };
}

function crearFilaCorrectivaVacia(no = 1) {
    return { no, acciones: '', responsable: '', fecha: '' };
}

function crearFilaResultadoVacia(no = 1) {
    return { no, descripcion: '', verifico: '' };
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
        delete base.reporteActivoId;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function estructuraEsEquivalente() {
    // Filas fijas del formato; agregar/editar contenido = cambio de información.
    return true;
}

function leerCelda(ws, row, col) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function leerRango(ws, { row, startCol, endCol }) {
    for (let col = startCol; col <= endCol; col++) {
        const texto = leerCelda(ws, row, col);
        if (texto) return texto;
    }
    return '';
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

function asignarEn(ws, row, col, texto, horizontal = 'left', vertical = 'middle') {
    asignarTexto(ws.getRow(row).getCell(col), texto, horizontal, vertical);
}

function asignarRango(ws, config, texto, horizontal = 'left', vertical = 'middle') {
    asignarEn(ws, config.row, config.startCol, texto, horizontal, vertical);
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

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
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

function parsearDatosDesdeHoja(ws) {
    let fuente = '';
    Object.entries(FUENTE_CELLS).forEach(([label, pos]) => {
        if (leerMarca(leerCelda(ws, pos.row, pos.col))) {
            fuente = label;
        }
    });

    const normas = {
        iso9001: leerMarca(leerCelda(ws, NORMA_CELLS['ISO 9001'].row, NORMA_CELLS['ISO 9001'].col)),
        iso14001: leerMarca(leerCelda(ws, NORMA_CELLS['ISO 14001'].row, NORMA_CELLS['ISO 14001'].col)),
        iso45001: leerMarca(leerCelda(ws, NORMA_CELLS['ISO 45001'].row, NORMA_CELLS['ISO 45001'].col))
    };

    const accionesInmediatas = {};
    ACCIONES_INMEDIATAS_KEYS.forEach((k) => {
        const pos = ACCION_INMEDIATA_CELLS[k];
        accionesInmediatas[k] = pos ? leerMarca(leerCelda(ws, pos.row, pos.col)) : false;
    });

    const accionesCorreccion = [];
    for (let i = 0; i < TABLA_CORRECCION.rows; i++) {
        const r = TABLA_CORRECCION.startRow + i;
        accionesCorreccion.push({
            descripcion: leerCelda(ws, r, TABLA_CORRECCION.cols.descripcion),
            responsable: leerCelda(ws, r, TABLA_CORRECCION.cols.responsable),
            fecha: leerCelda(ws, r, TABLA_CORRECCION.cols.fecha)
        });
    }

    const causas = [];
    for (let i = 0; i < CAUSAS_COUNT; i++) {
        causas.push(leerCelda(ws, CAUSAS_START_ROW + i, 2));
    }

    const accionesCorrectivas = [];
    for (let i = 0; i < TABLA_CORRECTIVAS.rows; i++) {
        const r = TABLA_CORRECTIVAS.startRow + i;
        accionesCorrectivas.push({
            no: i + 1,
            acciones: leerCelda(ws, r, TABLA_CORRECTIVAS.cols.acciones),
            responsable: leerCelda(ws, r, TABLA_CORRECTIVAS.cols.responsable),
            fecha: leerCelda(ws, r, TABLA_CORRECTIVAS.cols.fecha)
        });
    }

    const resultados = [];
    for (let i = 0; i < TABLA_RESULTADOS.rows; i++) {
        const r = TABLA_RESULTADOS.startRow + i;
        resultados.push({
            no: i + 1,
            descripcion: leerCelda(ws, r, TABLA_RESULTADOS.cols.descripcion),
            verifico: leerCelda(ws, r, TABLA_RESULTADOS.cols.verifico)
        });
    }

    const revText = leerCelda(ws, CELLS.revision.row, CELLS.revision.col);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = leerCelda(ws, CELLS.fechaRevision.row, CELLS.fechaRevision.col);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    const fechaLeida = leerCelda(ws, CELLS.fecha.row, CELLS.fecha.col);

    return {
        datos: sanitizarDatos({
            revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
            fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
            fecha: fechaLeida,
            folio: leerCelda(ws, CELLS.folio.row, CELLS.folio.col),
            fuente,
            fuenteDetalle: leerRango(ws, CELLS.fuenteDetalle),
            normas,
            origenArea: leerRango(ws, CELLS.origenArea),
            reportaNombre: leerCelda(ws, CELLS.reportaNombre.row, CELLS.reportaNombre.col),
            reportaPuesto: leerCelda(ws, CELLS.reportaPuesto.row, CELLS.reportaPuesto.col),
            reportaEmpresa: leerCelda(ws, CELLS.reportaEmpresa.row, CELLS.reportaEmpresa.col),
            registraNc: leerRango(ws, CELLS.registraNc),
            descripcionNc: leerRango(ws, CELLS.descripcionNc),
            accionesInmediatas,
            accionesCorreccion,
            causas,
            accionesCorrectivas,
            resultados,
            fechaCierre: leerCelda(ws, CELLS.fechaCierre.row, CELLS.fechaCierre.col),
            firmaEspecialista: leerCelda(ws, CELLS.firmaEspecialista.row, CELLS.firmaEspecialista.col),
            firmaDireccion: leerCelda(ws, CELLS.firmaDireccion.row, CELLS.firmaDireccion.col),
            fechaElaboracion: fechaLeida ? formatearFechaIso(fechaLeida) : DATOS_DEFECTO.fechaElaboracion
        }),
        legacyUsed: false
    };
}

async function leerDatosDesdePlantilla() {
    const buffer = await obtenerBufferPlantillaSgcF04();
    const { datos } = await leerDatosDesdeBuffer(buffer);
    return datos;
}

async function obtenerBufferPlantillaSgcF04() {
    try {
        const info = await driveService.obtenerInfoArchivo(TEMPLATE_DRIVE_ID).catch(() => null);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(TEMPLATE_DRIVE_ID);
        }
        if (
            mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || mime === 'application/vnd.ms-excel'
        ) {
            return driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
        }
        // Plantilla pública suele ser Google Sheet aunque no se lea el mime
        return driveService.exportarGoogleSheetComoXLSX(TEMPLATE_DRIVE_ID);
    } catch (err) {
        console.warn('[SGC-F-04] Export plantilla falló, reintentando descarga nativa:', err.message);
        return driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
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

function escribirDatosEnWorksheet(ws, datos) {
    const meta = sanitizarDatos(datos);
    const rep = resolverReporteActivo(meta);
    asignarEn(ws, CELLS.revision.row, CELLS.revision.col, `Revisión: ${meta.revision || '02'}`);
    asignarEn(ws, CELLS.fechaRevision.row, CELLS.fechaRevision.col,
        etiquetaFechaRevision(meta.fechaRevision));
    asignarEn(ws, CELLS.fecha.row, CELLS.fecha.col, formatearFechaDisplay(rep.fecha), 'center');
    asignarEn(ws, CELLS.folio.row, CELLS.folio.col, rep.folio || '', 'center');

    Object.entries(FUENTE_CELLS).forEach(([label, pos]) => {
        asignarEn(ws, pos.row, pos.col, marcaCheckbox(rep.fuente === label), 'center');
    });
    asignarRango(ws, CELLS.fuenteDetalle, rep.fuenteDetalle || '', 'center', 'middle');

    [9, 10, 11].forEach((row) => {
        asignarEn(ws, row, NORMA_CELLS_LEGACY_COL, '', 'center');
    });
    asignarEn(ws, NORMA_CELLS['ISO 9001'].row, NORMA_CELLS['ISO 9001'].col, marcaCheckbox(rep.normas?.iso9001), 'center');
    asignarEn(ws, NORMA_CELLS['ISO 14001'].row, NORMA_CELLS['ISO 14001'].col, marcaCheckbox(rep.normas?.iso14001), 'center');
    asignarEn(ws, NORMA_CELLS['ISO 45001'].row, NORMA_CELLS['ISO 45001'].col, marcaCheckbox(rep.normas?.iso45001), 'center');

    asignarRango(ws, CELLS.origenArea, rep.origenArea || '', 'center', 'middle');
    asignarEn(ws, CELLS.reportaNombre.row, CELLS.reportaNombre.col, rep.reportaNombre || '');
    asignarEn(ws, CELLS.reportaPuesto.row, CELLS.reportaPuesto.col, rep.reportaPuesto || '');
    asignarEn(ws, CELLS.reportaEmpresa.row, CELLS.reportaEmpresa.col, rep.reportaEmpresa || '');
    asignarRango(
        ws,
        CELLS.registraNc,
        componerTextoPersona(rep.registraNombre, rep.registraPuesto, rep.registraEmpresa, rep.registraNc)
    );
    asignarRango(ws, CELLS.descripcionNc, rep.descripcionNc || '', 'center', 'middle');

    ACCIONES_INMEDIATAS_KEYS.forEach((k) => {
        const pos = ACCION_INMEDIATA_CELLS[k];
        if (pos) asignarEn(ws, pos.row, pos.col, marcaCheckbox(!!rep.accionesInmediatas?.[k]), 'center');
    });

    const maxCorr = Math.max(TABLA_CORRECCION.rows, (rep.accionesCorreccion || []).length);
    for (let i = 0; i < Math.min(maxCorr, TABLA_CORRECCION.rows + 20); i++) {
        if (i >= TABLA_CORRECCION.rows && i >= (rep.accionesCorreccion || []).length) break;
        if (i >= TABLA_CORRECCION.rows) break; // plantilla fija: solo primeras filas
        const fila = rep.accionesCorreccion?.[i] || crearFilaCorreccionVacia();
        const r = TABLA_CORRECCION.startRow + i;
        asignarEn(ws, r, TABLA_CORRECCION.cols.descripcion, fila.descripcion || '');
        asignarEn(ws, r, TABLA_CORRECCION.cols.responsable, fila.responsable || '');
        const fd = /^\d{4}-\d{2}-\d{2}$/.test(fila.fecha) ? formatearFechaDisplay(fila.fecha) : (fila.fecha || '');
        asignarEn(ws, r, TABLA_CORRECCION.cols.fecha, fd, 'center');
    }

    for (let i = 0; i < Math.max(CAUSAS_COUNT, (rep.causas || []).length); i++) {
        if (i >= CAUSAS_COUNT) break;
        asignarEn(ws, CAUSAS_START_ROW + i, 2, rep.causas?.[i] || '');
    }

    for (let i = 0; i < TABLA_CORRECTIVAS.rows; i++) {
        const fila = rep.accionesCorrectivas?.[i] || crearFilaCorrectivaVacia(i + 1);
        const r = TABLA_CORRECTIVAS.startRow + i;
        asignarEn(ws, r, TABLA_CORRECTIVAS.cols.acciones, fila.acciones || '');
        asignarEn(ws, r, TABLA_CORRECTIVAS.cols.responsable, fila.responsable || '');
        const fd = /^\d{4}-\d{2}-\d{2}$/.test(fila.fecha) ? formatearFechaDisplay(fila.fecha) : (fila.fecha || '');
        asignarEn(ws, r, TABLA_CORRECTIVAS.cols.fecha, fd, 'center');
    }

    for (let i = 0; i < TABLA_RESULTADOS.rows; i++) {
        const fila = rep.resultados?.[i] || crearFilaResultadoVacia(i + 1);
        const r = TABLA_RESULTADOS.startRow + i;
        asignarEn(ws, r, TABLA_RESULTADOS.cols.descripcion, fila.descripcion || '');
        asignarEn(ws, r, TABLA_RESULTADOS.cols.verifico, fila.verifico || '');
    }

    asignarEn(ws, CELLS.fechaCierre.row, CELLS.fechaCierre.col,
        /^\d{4}-\d{2}-\d{2}$/.test(rep.fechaCierre)
            ? formatearFechaDisplay(rep.fechaCierre)
            : (rep.fechaCierre || ''),
        'left');
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await obtenerBufferPlantillaSgcF04();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = resolverHojaWorkbook(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-04 no contiene hojas.');
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

function datosAActualizacionesSheet(datos, sheetTitle = SHEET_TITLE) {
    const meta = sanitizarDatos(datos);
    const rep = resolverReporteActivo(meta);
    const actualizaciones = [];
    pushUpdate(actualizaciones, CELLS.revision.row, CELLS.revision.col,
        `Revisión: ${meta.revision || '02'}`, sheetTitle);
    pushUpdate(actualizaciones, CELLS.fechaRevision.row, CELLS.fechaRevision.col,
        etiquetaFechaRevision(meta.fechaRevision), sheetTitle);
    pushUpdate(actualizaciones, CELLS.fecha.row, CELLS.fecha.col,
        formatearFechaDisplay(rep.fecha), sheetTitle);
    pushUpdate(actualizaciones, CELLS.folio.row, CELLS.folio.col, rep.folio || '', sheetTitle);

    Object.entries(FUENTE_CELLS).forEach(([label, pos]) => {
        pushUpdate(actualizaciones, pos.row, pos.col, marcaCheckbox(rep.fuente === label), sheetTitle);
    });
    pushUpdate(actualizaciones, CELLS.fuenteDetalle.row, CELLS.fuenteDetalle.startCol,
        normalizarSaltosLinea(rep.fuenteDetalle), sheetTitle);

    [9, 10, 11].forEach((row) => {
        pushUpdate(actualizaciones, row, NORMA_CELLS_LEGACY_COL, '', sheetTitle);
    });
    pushUpdate(actualizaciones, NORMA_CELLS['ISO 9001'].row, NORMA_CELLS['ISO 9001'].col,
        marcaCheckbox(rep.normas?.iso9001), sheetTitle);
    pushUpdate(actualizaciones, NORMA_CELLS['ISO 14001'].row, NORMA_CELLS['ISO 14001'].col,
        marcaCheckbox(rep.normas?.iso14001), sheetTitle);
    pushUpdate(actualizaciones, NORMA_CELLS['ISO 45001'].row, NORMA_CELLS['ISO 45001'].col,
        marcaCheckbox(rep.normas?.iso45001), sheetTitle);

    pushUpdate(actualizaciones, CELLS.origenArea.row, CELLS.origenArea.startCol,
        rep.origenArea || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.reportaNombre.row, CELLS.reportaNombre.col,
        rep.reportaNombre || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.reportaPuesto.row, CELLS.reportaPuesto.col,
        rep.reportaPuesto || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.reportaEmpresa.row, CELLS.reportaEmpresa.col,
        rep.reportaEmpresa || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.registraNc.row, CELLS.registraNc.startCol,
        componerTextoPersona(rep.registraNombre, rep.registraPuesto, rep.registraEmpresa, rep.registraNc),
        sheetTitle);
    pushUpdate(actualizaciones, CELLS.descripcionNc.row, CELLS.descripcionNc.startCol,
        normalizarSaltosLinea(rep.descripcionNc), sheetTitle);

    ACCIONES_INMEDIATAS_KEYS.forEach((k) => {
        const pos = ACCION_INMEDIATA_CELLS[k];
        if (pos) {
            pushUpdate(actualizaciones, pos.row, pos.col,
                marcaCheckbox(!!rep.accionesInmediatas?.[k]), sheetTitle);
        }
    });

    for (let i = 0; i < TABLA_CORRECCION.rows; i++) {
        const fila = rep.accionesCorreccion?.[i] || crearFilaCorreccionVacia();
        const r = TABLA_CORRECCION.startRow + i;
        pushUpdate(actualizaciones, r, TABLA_CORRECCION.cols.descripcion,
            normalizarSaltosLinea(fila.descripcion), sheetTitle);
        pushUpdate(actualizaciones, r, TABLA_CORRECCION.cols.responsable, fila.responsable || '', sheetTitle);
        const fd = /^\d{4}-\d{2}-\d{2}$/.test(fila.fecha) ? formatearFechaDisplay(fila.fecha) : (fila.fecha || '');
        pushUpdate(actualizaciones, r, TABLA_CORRECCION.cols.fecha, fd, sheetTitle);
    }

    for (let i = 0; i < CAUSAS_COUNT; i++) {
        pushUpdate(actualizaciones, CAUSAS_START_ROW + i, 2,
            normalizarSaltosLinea(rep.causas?.[i]), sheetTitle);
    }

    for (let i = 0; i < TABLA_CORRECTIVAS.rows; i++) {
        const fila = rep.accionesCorrectivas?.[i] || crearFilaCorrectivaVacia(i + 1);
        const r = TABLA_CORRECTIVAS.startRow + i;
        pushUpdate(actualizaciones, r, TABLA_CORRECTIVAS.cols.acciones,
            normalizarSaltosLinea(fila.acciones), sheetTitle);
        pushUpdate(actualizaciones, r, TABLA_CORRECTIVAS.cols.responsable, fila.responsable || '', sheetTitle);
        const fd = /^\d{4}-\d{2}-\d{2}$/.test(fila.fecha) ? formatearFechaDisplay(fila.fecha) : (fila.fecha || '');
        pushUpdate(actualizaciones, r, TABLA_CORRECTIVAS.cols.fecha, fd, sheetTitle);
    }

    for (let i = 0; i < TABLA_RESULTADOS.rows; i++) {
        const fila = rep.resultados?.[i] || crearFilaResultadoVacia(i + 1);
        const r = TABLA_RESULTADOS.startRow + i;
        pushUpdate(actualizaciones, r, TABLA_RESULTADOS.cols.descripcion,
            normalizarSaltosLinea(fila.descripcion), sheetTitle);
        pushUpdate(actualizaciones, r, TABLA_RESULTADOS.cols.verifico, fila.verifico || '', sheetTitle);
    }

    pushUpdate(actualizaciones, CELLS.fechaCierre.row, CELLS.fechaCierre.col,
        /^\d{4}-\d{2}-\d{2}$/.test(rep.fechaCierre)
            ? formatearFechaDisplay(rep.fechaCierre)
            : (rep.fechaCierre || ''), sheetTitle);

    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    const titulo = sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId);
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    try {
        await driveService.aplicarFormatoVisualSgcF04(spreadsheetId, titulo);
    } catch (err) {
        console.warn('[SGC-F-04] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function publicarDatosEnDrive(driveFileId, datos, datosPrevios = null) {
    if (!driveFileId) return null;
    try {
        const infoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await sincronizarHojasReportesEnDrive(driveFileId, datos, datosPrevios);
            return driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
        }
    } catch (err) {
        console.warn('[SGC-F-04] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
    }
    const buffer = await escribirDatosEnPlantilla(datos);
    return subirOReemplazarEnDrive(buffer, driveFileId);
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function aplicarHistorialSgcF04(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    for (const archivo of (archivos || [])) {
        const id = String(archivo.id || '');
        const name = String(archivo.name || '').toLowerCase();
        if (id && id !== excluirId && !esIdPlantillaMaestra(id) && name.startsWith(objetivo)) {
            try {
                await driveService.eliminarArchivo(id);
            } catch (err) {
                console.warn('[SGC-F-04] No se pudo eliminar copia en Drive:', err.message);
            }
        }
    }
}

async function crearCopiaPlantillaEnCarpeta(pool, registro = null) {
    const existePlantilla = TEMPLATE_DRIVE_ID
        ? await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false)
        : false;
    if (!existePlantilla) {
        throw new Error(
            'Plantilla SGC-F-04 no encontrada en Drive. Compártela con la cuenta del sistema (risktechbiznaga@gmail.com) como Editor.'
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

async function archivoEstaEnCarpeta(fileId, folderId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const parents = Array.isArray(info?.parents) ? info.parents : [];
        return parents.includes(folderId);
    } catch {
        return false;
    }
}

async function resolverDriveFileId(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb && !esIdPlantillaMaestra(idDb)) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && await archivoEstaEnCarpeta(idDb, CARPETA_DRIVE_ID)) {
            return idDb;
        }
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

async function asegurarHojaReporteEnDrive(spreadsheetId, datos, nombreHoja) {
    const objetivo = String(nombreHoja || '').trim();
    if (!spreadsheetId || !objetivo || objetivo === 'Sin-folio') {
        return false;
    }

    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const existente = driveService.resolverTituloHojaExistente(titulos, objetivo);
        if (existente) {
            return true;
        }

        const plantillaOrigen = driveService.resolverTituloHojaExistente(
            titulos,
            SHEET_TITLE,
            { fallbackRegex: /reporte/i }
        );
        if (!plantillaOrigen) {
            console.warn(
                `[SGC-F-04] No hay hoja plantilla para crear "${objetivo}". `
                + `Hojas: ${titulos.join(', ') || '(ninguna)'}`
            );
            return false;
        }

        const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaOrigen, objetivo);
        const tituloFinal = dup?.title || objetivo;
        await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloFinal);
        return true;
    } catch (err) {
        console.warn(`[SGC-F-04] No se pudo asegurar hoja "${objetivo}":`, err.message);
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
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaReporte(datos);

    if (driveId && hojaEditor && hojaEditor !== 'Sin-folio') {
        try {
            let gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid == null) {
                const creada = await asegurarHojaReporteEnDrive(driveId, datos, hojaEditor);
                if (creada) {
                    gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
                }
            }
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo resolver gid de hoja editor:', err.message);
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
            console.warn('[SGC-F-04] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo eliminar duplicado en Drive:', err.message);
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
            const buffer = await descargarBufferDrive(driveFileId);
            const lectura = await leerDatosDesdeBuffer(buffer);
            datos = lectura.datos;
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    } else {
        datos = fusionarDatosPreferirDb(datos, datosDb);
    }

    if (necesitaRehidratarDriveDesdeDb(datos, datosDb) && driveFileId) {
        try {
            datos = datosDb;
            const actualizado = await publicarDatosEnDrive(driveFileId, datos, datosDb);
            if (actualizado) archivoDrive = actualizado;
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo rehidratar datos en Drive desde BD:', err.message);
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
            await sincronizarHojasReportesEnDrive(copia.id, datos, null);
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
            console.warn('[SGC-F-04] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
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

    if (!huboCambio && registroPrevio?.drive_file_id) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(registroPrevio.drive_file_id).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                await sincronizarHojasReportesEnDrive(
                    registroPrevio.drive_file_id,
                    datosEntrada,
                    datosPrevios
                );
            }
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo re-sincronizar hojas en Drive:', err.message);
        }
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return await construirRespuesta(registroPrevio, datosEntrada, archivoDrive, {
            hojaEditor: resolverNombreHojaReporte(datosEntrada)
        });
    }

    const driveId = registroPrevio?.drive_file_id || null;
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

                await sincronizarHojasReportesEnDrive(driveId, datosGuardar, datosPrevios);

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
                sincronizarBitacoraF05DesdeF04(pool, datosGuardar).catch((err) => {
                    console.warn('[SGC-F-04] Sync bitácora F-05 omitida:', err.message);
                });
                return await construirRespuesta(registro, datosGuardar, archivoDrive, {
                    hojaEditor: resolverNombreHojaReporte(datosGuardar)
                });
            }
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo actualizar Google Sheet:', err.message);
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
            await sincronizarHojasReportesEnDrive(copia.id, datosGuardar, datosPrevios);
            archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
        }
    } catch (err) {
        console.warn('[SGC-F-04] No se pudo sincronizar con Drive; se guarda solo en BD:', err.message || err);
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive?.id || driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    sincronizarBitacoraF05DesdeF04(pool, datosGuardar).catch((err) => {
        console.warn('[SGC-F-04] Sync bitácora F-05 omitida:', err.message);
    });
    return await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(datosGuardar)
    });
}

async function sincronizarBitacoraF05DesdeF04(pool, datosF04) {
    try {
        const sgcF05Service = require('./sgcF05Service');
        await sgcF05Service.upsertDesdeReportesF04(pool, datosF04?.reportes || []);
    } catch (err) {
        console.warn('[SGC-F-04] No se pudo sincronizar SGC-F-05:', err.message);
    }
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
        reporteActivoId: datosPrevios.reporteActivoId
    };
    const reportesActualizados = Array.isArray(datosPrevios.reportes)
        ? datosPrevios.reportes.map((r) => ({ ...r }))
        : [];

    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        for (const titulo of titulos) {
            if (!esHojaReporteSgcF04(titulo)) continue;
            try {
                const lectura = await leerDatosDesdeHojaGoogleSheet(driveFileId, titulo);
                const repLeido = resolverReporteActivo(lectura.datos);
                const idx = reportesActualizados.findIndex((r) => {
                    const hojaEsperada = resolverNombreHojaReporte(datosConReporteActivo(datosPrevios, r));
                    return hojaEsperada === titulo
                        || sanitizarNombreHojaFolio(r.folio) === sanitizarNombreHojaFolio(repLeido.folio);
                });
                if (idx >= 0) {
                    reportesActualizados[idx] = sanitizarReporte({
                        ...reportesActualizados[idx],
                        ...repLeido,
                        id: reportesActualizados[idx].id
                    });
                }
            } catch (err) {
                console.warn(`[SGC-F-04] No se pudo leer hoja "${titulo}" desde Drive:`, err.message);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-04] No se pudieron listar hojas al sincronizar desde Drive:', err.message);
    }

    const datosDrive = sanitizarDatos({
        ...metaBase,
        reportes: reportesActualizados
    });

    if (necesitaRehidratarDriveDesdeDb(datosDrive, datosPrevios)) {
        try {
            await sincronizarHojasReportesEnDrive(driveFileId, datosPrevios, datosPrevios);
        } catch (err) {
            console.warn('[SGC-F-04] No se pudo rehidratar datos en Drive desde BD:', err.message);
        }
        const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta(registro, datosPrevios, archivoDrive, {
            hojaEditor: resolverNombreHojaReporte(datosPrevios)
        });
    }

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = archivoDriveInfo || await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta(registro, datosDrive, archivoDrive, {
            hojaEditor: resolverNombreHojaReporte(datosDrive)
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
        hojaEditor: resolverNombreHojaReporte(datosGuardar)
    });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
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

    if (registro?.drive_file_id && !esIdPlantillaMaestra(registro.drive_file_id)) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-04] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await eliminarCopiasDriveTrabajo();

    let archivoDrive = null;
    let driveIdGuardado = null;

    try {
        const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
        driveIdGuardado = copia.id;
        await sincronizarHojasReportesEnDrive(driveIdGuardado, datosPublicar, datos);
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado).catch(() => copia);
        console.log(`[SGC-F-04] Plantilla actualizada desde maestra → copia ${driveIdGuardado}`);
    } catch (err) {
        console.warn('[SGC-F-04] Drive no disponible al actualizar plantilla:', err.message);
        driveIdGuardado = registro?.drive_file_id && !esIdPlantillaMaestra(registro.drive_file_id)
            ? registro.drive_file_id
            : null;
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
        hojaEditor: resolverNombreHojaReporte(datosPublicar)
    });
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-04 ${tag} - ${mm}/${yy}.pdf`;
}

async function publicarPdfEnDrive(pdfBuffer, folio) {
    const nombreArchivo = nombrePdfHistorial(folio);
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const reporteId = String(body?.reporteId || body?.reporte_id || '').trim();
    if (!reporteId) throw new Error('Se requiere reporteId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const reportes = Array.isArray(datosPrevios.reportes) ? [...datosPrevios.reportes] : [];
    const idx = reportes.findIndex((r) => r.id === reporteId);
    if (idx < 0) {
        throw new Error('No se encontró el reporte indicado en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, reportes[idx].folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(reportes[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    reportes[idx] = { ...reportes[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        reportes,
        reporteActivoId: reporteId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    const respuesta = await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaReporte(datosGuardar)
    });
    return { ...respuesta, pdfFirmado };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    FUENTES,
    NORMAS,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    sanitizarDatos
};
