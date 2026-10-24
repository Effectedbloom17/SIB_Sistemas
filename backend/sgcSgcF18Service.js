/**
 * SGC-F-18 · Tabla de requisitos legales y reglamentarios — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-18';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1KuD6RwHRedvqsot39ulw5Gps5uUKbK6OzvVlWyELDpU
 */
const TEMPLATE_DRIVE_ID = '1KuD6RwHRedvqsot39ulw5Gps5uUKbK6OzvVlWyELDpU';
/**
 * Archivo de trabajo Centro SGC (historial SGCF18-MMAA / _N).
 * https://docs.google.com/spreadsheets/d/1Ge8QOuUhgrnpEWBH4oTXi4orwDuLsXZKz-ApaLWErSk
 */
const DRIVE_FILE_ID_SISTEMA = '1Ge8QOuUhgrnpEWBH4oTXi4orwDuLsXZKz-ApaLWErSk';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-18 Tabla de requisitos legales (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback de resolución de hoja; el trabajo real usa SGCF18-MMAA(_N). */
const SHEET_TITLE = 'Plantilla';
const MAX_COLUMNAS_SISTEMA = 9;

/** Nombre de hoja base del mes actual (SGCF18-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

const HEADER_ROW = 6;
const DATA_START_ROW = 7;
const REVISION_ROW = 2;
const FECHA_REV_ROW = 3;
const MAX_FILAS = 120;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;

/** Metadatos Código / Revisión / Fecha de rev. (columna H). */
const COL_META = 8;

const COL = {
    nombre: 2,
    emite: 3,
    fechaVigor: 4,
    documento: 5,
    vigencia: 6,
    responsable: 7,
    observaciones: 8
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-20',
    fechaElaboracion: '2025-01-20',
    fechaRevisionInformacion: '',
    filas: [
        {
            nombre: 'ISO 9001:2015 Sistemas de Gestión de Calidad - Requisitos',
            emite: 'Comités Internacionales ISO',
            fechaVigor: '2015',
            documento: 'N/A',
            vigencia: 'Vigente',
            responsable: 'Coordinador del SGC',
            observaciones: ''
        },
        {
            nombre: 'ISO 9000:2015 Sistemas de Gestión de Calidad - Fundamentos y vocabulario',
            emite: 'Comités Internacionales ISO',
            fechaVigor: '2015',
            documento: 'N/A',
            vigencia: 'Vigente',
            responsable: 'Coordinador del SGC',
            observaciones: ''
        },
        {
            nombre: 'ISO 19011:2011 Directrices para la auditoria de los sistemas de gestión',
            emite: 'Comités Internacionales ISO',
            fechaVigor: '2011',
            documento: 'N/A',
            vigencia: 'Vigente',
            responsable: 'Coordinador del SGC',
            observaciones: ''
        },
        {
            nombre: 'Ley General de sociedades mercantiles',
            emite: 'Registro público de la propiedad y el comercio',
            fechaVigor: 'Última reforma: 20-10-23',
            documento: 'Acta constitutiva',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'Fundamento Legal Código Fiscal de la Federación, artículo 27. Reglamento del Código Fiscal de la Federación, artículos 22, 23, 24, 25, 27 y 28. Resolución Miscelánea Fiscal, reglas 2.4.3., 2.4.5., 2.4.11., 2.4.12., 2.4.14. y 3.18.31.',
            emite: 'SAT',
            fechaVigor: 'Sin información',
            documento: 'Cédula de Identificación Fiscal - RFC de la empresa',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-017-STPS-2008, Equipo de protección personal-Selección, uso y manejo en los centros de trabajo',
            emite: 'STPS',
            fechaVigor: '9/12/2008',
            documento: 'Determinación del Equipo de Protección Personal del trabajo de acuerdo a su actividad',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-035-STPS-2018, Factores de riesgo psicosocial en el trabajo-Identificación, análisis y prevención.',
            emite: 'STPS',
            fechaVigor: '23/10/2018',
            documento: 'Aplicación de encuesta para identificar y prevenir factores de riesgo psicosocial',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-036-1-STPS-2018, Factores de riesgo ergonómico en el Trabajo-Identificación, análisis, prevención y control. Parte 1: Manejo manual de cargas.',
            emite: 'STPS',
            fechaVigor: '23/11/2018',
            documento: 'Análisis de los factores de riesgo ergonómico debido al manejo manual de cargas.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-018-STPS-2015, Sistema armonizado para la identificación y comunicación de peligros y riesgos por sustancias químicas peligrosas en los centros de trabajo.',
            emite: 'STPS',
            fechaVigor: '9/10/2015',
            documento:
                'Identificación y comunicación de peligros y riesgos por sustancias químicas (productos de limpieza)',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-030-STPS-2009 Servicios preventivos de seguridad y salud en el trabajo - Funciones y actividades.',
            emite: 'STPS',
            fechaVigor: '2009',
            documento:
                'Diagnóstico y programa preventivo de seguridad y salud en el trabajo. Documento oficial para acreditar formación del personal capacitado.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-019-STPS-2011 Constitución, integración, organización y funcionamiento de las comisiones de seguridad e higiene en los centros de trabajo',
            emite: 'STPS',
            fechaVigor: '2011',
            documento: 'N/A',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre:
                'NOM-026-STPS-2008 Colores y señales de seguridad e higiene, e identificación de riesgos por fluidos conducidos en tuberías',
            emite: 'STPS',
            fechaVigor: '2008',
            documento: 'Señales y avisos de seguridad',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'Ley de la Propiedad Industrial, artículos 87 al 89',
            emite: 'Secretaría de Economía',
            fechaVigor: 'N/A',
            documento: 'Solicitar y reservar el nombre de la empresa ante la Secretaría de Economía.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'Leyes y reglamentos municipales',
            emite: 'Municipio',
            fechaVigor: 'N/A',
            documento: 'Licencia de funcionamiento y uso de suelo',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'Instituto Mexicano de la Propiedad Industrial (IMPI)',
            emite: 'Instituto Mexicano de la Propiedad Industrial (IMPI)',
            fechaVigor: 'N/A',
            documento: 'Registro de marca o nombre comercial',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'NOM-001-STPS-2008: Edificios, locales e instalaciones',
            emite: 'STPS',
            fechaVigor: '2008',
            documento:
                'Diseño y condiciones físicas de edificios, oficinas, áreas de trabajo y circulación, para prevención de accidentes.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'Ley Federal del Trabajo / Reglamento Interior',
            emite: 'STPS',
            fechaVigor: 'N/A',
            documento:
                'Inscripción ante la STPS: Si se impartirá capacitación o se prestan servicios a terceros. Requiere registro como agente capacitador externo si se emiten DC-3.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'Reglamento de Construcción y Desarrollo Urbano',
            emite: 'Municipio',
            fechaVigor: 'N/A',
            documento: 'Permiso de uso de suelo',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'LFT / STPS',
            emite: 'STPS',
            fechaVigor: 'N/A',
            documento:
                'Registro como Agente Capacitador Externo (ACE): Permite impartir cursos válidos ante la STPS y emitir constancias DC-3. Se requiere RFC, plan de cursos, CV y experiencia.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        },
        {
            nombre: 'NOM-052-SEMARNAT-2005 / Ley de Residuos',
            emite: 'STPS',
            fechaVigor: 'N/A',
            documento: 'Si se asesora sobre residuos peligrosos, debe conocerse y aplicarse esta regulación.',
            vigencia: 'Vigente',
            responsable: 'Alta Dirección',
            observaciones: ''
        }
    ]
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

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
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
    return formatearFechaIso(new Date());
}

function sanitizarFila(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        nombre: String(base.nombre || '').trim(),
        emite: String(base.emite || '').trim(),
        fechaVigor: String(base.fechaVigor || '').trim(),
        documento: String(base.documento || '').trim(),
        vigencia: String(base.vigencia || '').trim(),
        responsable: String(base.responsable || '').trim(),
        observaciones: String(base.observaciones || '').trim()
    };
}

function revisionDesdeListaMaestra() {
    try {
        const f01 = require('./sgcSgcF01Service');
        const doc = (f01.CATALOGO_BASE || []).find(
            (d) => String(d?.codigo || '').toUpperCase() === CODIGO_FORMATO
        );
        const rev = String(doc?.versionVigente || '').trim();
        return rev ? rev.padStart(2, '0') : '00';
    } catch {
        return '00';
    }
}

function sanitizarDatos(raw, opciones = {}) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filasRaw = Array.isArray(base.filas) ? base.filas : DATOS_DEFECTO.filas;
    const filas = filasRaw.map(sanitizarFila).filter((f) => f.nombre);
    const permitirVacias = !!opciones.permitirVacias;
    const revisionMaestra = revisionDesdeListaMaestra();
    return {
        revision: revisionMaestra,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevisionInformacion: String(base.fechaRevisionInformacion || '').trim(),
        filas: filas.length ? filas : (permitirVacias ? [] : DATOS_DEFECTO.filas.map(sanitizarFila))
    };
}

function encontrarFilaFinDatos(ws) {
    const maxRow = Math.max(ws.rowCount || 0, DATA_END_ROW);
    let ultimaConDatos = DATA_START_ROW - 1;

    for (let r = DATA_START_ROW; r <= maxRow; r++) {
        const row = ws.getRow(r);
        const nombre = celdaATexto(row.getCell(COL.nombre).value);
        const emite = celdaATexto(row.getCell(COL.emite).value);
        const lower = nombre.toLowerCase();

        if (lower.includes('fecha de revision') || lower.includes('fecha de revisión')) {
            return Math.max(r, ultimaConDatos + 1);
        }
        if (nombre || emite) {
            ultimaConDatos = r;
            continue;
        }
        // Dos filas vacías seguidas tras haber visto datos → fin del bloque.
        if (ultimaConDatos >= DATA_START_ROW) {
            const nextNombre = celdaATexto(ws.getRow(r + 1).getCell(COL.nombre).value);
            const nextEmite = celdaATexto(ws.getRow(r + 1).getCell(COL.emite).value);
            if (!nextNombre && !nextEmite) {
                return r;
            }
        }
    }

    return Math.max(ultimaConDatos + 1, DATA_START_ROW);
}

function leerMetaDesdeHoja(ws) {
    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(COL_META).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(COL_META).value);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);

    let fechaRevisionInfo = '';
    const maxScan = Math.min(Math.max(ws.rowCount || 0, DATA_END_ROW), DATA_END_ROW + 20);
    for (let r = DATA_START_ROW; r <= maxScan; r++) {
        const label = celdaATexto(ws.getRow(r).getCell(COL.nombre).value).toLowerCase();
        if (label.includes('fecha de revision') || label.includes('fecha de revisión')) {
            fechaRevisionInfo = celdaATexto(ws.getRow(r).getCell(COL.emite).value)
                || celdaATexto(ws.getRow(r).getCell(COL.documento).value)
                || celdaATexto(ws.getRow(r).getCell(COL.fechaVigor).value);
            break;
        }
    }

    return {
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaElaboracion,
        fechaRevisionInformacion: fechaRevisionInfo
    };
}

function parsearDatosDesdeHoja(ws, opciones = {}) {
    const filaFin = encontrarFilaFinDatos(ws);
    const filas = [];

    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        const nombre = celdaATexto(row.getCell(COL.nombre).value);
        if (!nombre) continue;
        if (nombre.toLowerCase().includes('nombre de la ley')) continue;
        if (nombre.toLowerCase().includes('fecha de revision') || nombre.toLowerCase().includes('fecha de revisión')) {
            continue;
        }

        filas.push(sanitizarFila({
            nombre,
            emite: celdaATexto(row.getCell(COL.emite).value),
            fechaVigor: celdaATexto(row.getCell(COL.fechaVigor).value),
            documento: celdaATexto(row.getCell(COL.documento).value),
            vigencia: celdaATexto(row.getCell(COL.vigencia).value),
            responsable: celdaATexto(row.getCell(COL.responsable).value),
            observaciones: celdaATexto(row.getCell(COL.observaciones).value)
        }));
    }

    const meta = leerMetaDesdeHoja(ws);
    const permitirDefaultFilas = opciones.usarDefaultSiVacio !== false;

    return sanitizarDatos({
        ...meta,
        filas: filas.length ? filas : []
    }, { permitirVacias: !permitirDefaultFilas });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    let ws = null;
    if (modo === 'edicion') {
        const titulos = (wb.worksheets || []).map((h) => String(h.name || '').trim());
        const delMes = resolverTituloMesMasReciente(titulos);
        if (delMes) {
            ws = (wb.worksheets || []).find((h) => String(h.name || '').trim() === delMes) || null;
        }
        if (!ws) {
            ws = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        }
    } else {
        ws = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    }
    if (!ws) throw new Error('El archivo SGC-F-18 no contiene hojas.');
    return parsearDatosDesdeHoja(ws, {
        usarDefaultSiVacio: opciones.usarDefaultSiVacio !== false
    });
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

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets.find(
        (h) => String(h.name || '').trim().toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase()
    ) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-18 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

function asignarTexto(celda, texto, opciones = {}) {
    celda.value = normalizarSaltosLinea(texto);
    celda.font = {
        ...(celda.font || {}),
        name: 'Century Gothic',
        size: 10,
        ...(opciones.bold ? { bold: true } : {})
    };
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal: opciones.horizontal || 'center'
    };
}

const BORDE_CELDA_F18 = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
};
const FILL_FILA_PAR = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF2F2F2' }
};
const FILL_FILA_IMPAR = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFFF' }
};

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function aplicarEstiloFilaDatos(ws, rowIndex, esPar) {
    const row = ws.getRow(rowIndex);
    row.height = 50;
    const fill = esPar ? FILL_FILA_PAR : FILL_FILA_IMPAR;
    for (let c = COL.nombre; c <= COL.observaciones; c++) {
        const cell = row.getCell(c);
        cell.border = BORDE_CELDA_F18;
        cell.fill = fill;
        cell.font = { ...(cell.font || {}), name: 'Century Gothic', size: 10 };
        cell.alignment = {
            ...(cell.alignment || {}),
            vertical: 'middle',
            horizontal: 'center',
            wrapText: true
        };
    }
}

/**
 * Genera un buffer XLSX a partir de la plantilla externa (solo lectura)
 * con los datos del formato. Nunca sube ni modifica el archivo plantilla.
 */
async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets.find(
        (h) => String(h.name || '').trim().toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase()
    ) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-18 no contiene hojas.');
    // Eliminar hojas extra del workbook exportado: el snapshot solo lleva la estructura.
    for (const hoja of [...wb.worksheets]) {
        if (hoja !== ws) {
            try { wb.removeWorksheet(hoja.id); } catch { /* ignore */ }
        }
    }
    if (ws.name !== TEMPLATE_SHEET_TITLE) {
        try { ws.name = TEMPLATE_SHEET_TITLE; } catch { /* ignore rename limits */ }
    }

    const filasNecesarias = Math.max(datos.filas.length, 1);
    const filaFinDeseada = DATA_START_ROW + filasNecesarias;
    const filaFinActual = Math.max(encontrarFilaFinDatos(ws), DATA_START_ROW);
    if (filaFinDeseada > filaFinActual) {
        ws.spliceRows(
            filaFinActual,
            0,
            ...Array.from({ length: filaFinDeseada - filaFinActual }, () => [])
        );
    }

    const limpiaHasta = Math.max(encontrarFilaFinDatos(ws), filaFinDeseada + 2, DATA_END_ROW);
    for (let r = DATA_START_ROW; r < limpiaHasta; r++) {
        const row = ws.getRow(r);
        const label = celdaATexto(row.getCell(COL.nombre).value).toLowerCase();
        if (label.includes('fecha de revision') || label.includes('fecha de revisión')) {
            for (let c = COL.nombre; c <= COL.observaciones; c++) {
                row.getCell(c).value = null;
            }
            continue;
        }
        for (let c = COL.nombre; c <= COL.observaciones; c++) {
            const cell = row.getCell(c);
            cell.value = null;
            cell.fill = undefined;
        }
    }

    const revision = revisionDesdeListaMaestra();
    ws.getRow(REVISION_ROW).getCell(COL_META).value = `Revisión: ${revision}`;
    ws.getRow(FECHA_REV_ROW).getCell(COL_META).value =
        `Fecha de rev.: ${formatearFechaDisplay(datos.fechaRevision)}`;

    datos.filas.forEach((fila, idx) => {
        const rowIndex = DATA_START_ROW + idx;
        const esPar = idx % 2 === 1; // fila 7 blanca (idx 0), fila 8 #f2f2f2 (idx 1)
        aplicarEstiloFilaDatos(ws, rowIndex, esPar);
        const row = ws.getRow(rowIndex);
        asignarTexto(row.getCell(COL.nombre), fila.nombre);
        asignarTexto(row.getCell(COL.emite), fila.emite);
        asignarTexto(row.getCell(COL.fechaVigor), fila.fechaVigor);
        asignarTexto(row.getCell(COL.documento), fila.documento);
        asignarTexto(row.getCell(COL.vigencia), fila.vigencia);
        asignarTexto(row.getCell(COL.responsable), fila.responsable);
        asignarTexto(row.getCell(COL.observaciones), fila.observaciones);
    });

    if (datos.fechaRevisionInformacion) {
        const infoRowIndex = DATA_START_ROW + datos.filas.length + 1;
        const infoRow = ws.getRow(infoRowIndex);
        asignarTexto(infoRow.getCell(COL.nombre), 'Fecha de revisión de la información contenida:', { bold: true, horizontal: 'left' });
        asignarTexto(infoRow.getCell(COL.emite), datos.fechaRevisionInformacion);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
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

function esArchivoProtegidoDrive(fileId) {
    const id = String(fileId || '').trim();
    return !!id && (id === TEMPLATE_DRIVE_ID || id === DRIVE_FILE_ID_SISTEMA);
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        if (!id || id === excluirId || esArchivoProtegidoDrive(id)) {
            return false;
        }
        return name.startsWith(objetivo);
    });

    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) {
                return false;
            }
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
        if (existeSistema) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/** Valida cabeceras B6 típicas de la plantilla SGC-F-18. */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return false;
    }
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!B${HEADER_ROW}:H${HEADER_ROW}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const nombre = String(row[0] || '').toLowerCase();
        const observaciones = String(row[6] || '').toLowerCase();
        return nombre.includes('nombre') && (nombre.includes('ley') || nombre.includes('norma'))
            && (observaciones.includes('observa') || observaciones.includes('responsable')
                || String(row[5] || '').toLowerCase().includes('responsable'));
    } catch (err) {
        console.warn('[SGC-F-18] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[SGC-F-18] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SGC-F-18] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados de requisitos legales).`
        );
    }
    return copiada.title;
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

/**
 * Última versión del mes: SGCF18-1026_3 > SGCF18-1026_2 > SGCF18-1026.
 */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => t === mes || new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-18] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-18] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-18] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-18] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[SGC-F-18] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-18] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-18] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) {
        return delMes;
    }
    if (!titulos.length) {
        return mesActual;
    }

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[SGC-F-18] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
}

async function editorUrlConHojaVigente(driveId) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId) {
        return null;
    }
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return `${base}&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[SGC-F-18] No se pudo resolver gid editor:', err.message);
    }
    return base;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMysqlMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMysqlMexico(registro?.ultima_sync_drive);
}

async function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function datosSonEquivalentes(a, b) {
    const copia = (datos) => {
        const base = sanitizarDatos(datos);
        delete base._metaHoja;
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const buffer = await escribirDatosEnPlantilla(datos);
    await excelHistorial.escribirSnapshotDesdeBufferPlantilla(spreadsheetId, sheetTitle, buffer);
    const numFilas = Array.isArray(datos?.filas) ? datos.filas.length : 0;
    await driveService.aplicarFormatoFilasSgcF18(
        spreadsheetId,
        sheetTitle,
        DATA_START_ROW,
        numFilas
    ).catch((err) => {
        console.warn('[SGC-F-18] No se pudo aplicar formato visual:', err.message);
    });
}

/**
 * SGC-F-18 solo usa pestañas SGCF18-MMAA / SGCF18-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes.
 */
async function aplicarHistorialSgcF18(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente: datosSonEquivalentes,
        estructuraEsEquivalente: () => true,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
    });
}

/**
 * Elimina pestañas Alias_r* residuales. Conserva SGCF18-MMAA(_N).
 * No borra la pestaña «Plantilla» sobrante del sistema (puede quedarse huérfana).
 */
async function eliminarHojasHistorialFormatoSgcF18(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        return;
    }
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-18] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && patronAlias.test(nombre);
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) {
        return;
    }
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-18] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-18] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    const driveFileId = await resolverDriveFileId(registro);
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

    const datosDb = await leerDatosRegistro(registro);

    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            const datosDrive = await leerDatosDesdeBuffer(buffer, { usarDefaultSiVacio: false });
            if (datosDb?.filas?.length && !datosDrive?.filas?.length) {
                datos = datosDb;
            } else if (datosDrive?.filas?.length) {
                datos = datosDrive;
            } else {
                datos = datosDb || datosDrive;
            }
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoSgcF18(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[SGC-F-18] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[SGC-F-18] «${destino}» no coincide con plantilla; se regenera.`);
            }
            datos = datosDb || datos || sanitizarDatos(DATOS_DEFECTO);
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[SGC-F-18] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        } else if (!datos) {
            datos = datosDb || sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
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

    registro = { ...registro, drive_file_id: driveFileId || null };
    datos = sanitizarDatos(datos || DATOS_DEFECTO);
    return construirRespuesta(registro, datos, archivoDrive);
}

let _guardarFormatoChain = Promise.resolve();

async function guardarFormato(pool, body, options = {}) {
    const ejecutar = () => guardarFormatoInterno(pool, body, options);
    const tarea = _guardarFormatoChain.then(ejecutar, ejecutar);
    _guardarFormatoChain = tarea.then(() => undefined, () => undefined);
    return tarea;
}

async function guardarFormatoInterno(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

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

    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosEntrada);
    const driveId = await resolverDriveFileId(registroPrevio);

    if (!huboCambio && driveId) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(driveId)
            .catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                await eliminarHojasHistorialFormatoSgcF18(driveId);
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF18({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
                    origen
                });
                datosGuardar = hist.datosGuardar;
                datosGuardar.revision = revisionDesdeListaMaestra();

                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = fechaCambio;
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                let archivoDrive = null;
                const tituloSync = String(hist.hojaVigente || '').trim()
                    || await resolverTituloHojaVigente(driveId);
                try {
                    archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
                } catch (syncErr) {
                    console.warn('[SGC-F-18] Sync hoja edición falló tras historial:', syncErr.message);
                }
                if (!archivoDrive) {
                    archivoDrive = await driveService
                        .obtenerInfoArchivo(driveId)
                        .catch(() => ({ id: driveId }));
                }
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive);
            }
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const driveTrabajo = driveId || await resolverDriveFileId(registroPrevio);
    if (!driveTrabajo || driveTrabajo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo sincronizar SGC-F-18: falta archivo sistema.');
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[SGC-F-18] Adoptar plantilla en fallback:', adoptErr.message);
    }
    const archivoDrive = await sincronizarHojaEdicionDrive(driveTrabajo, datosGuardar, tituloNuevo)
        || await driveService.obtenerInfoArchivo(driveTrabajo).catch(() => ({ id: driveTrabajo }));

    await guardarRegistroDb(pool, {
        driveFileId: driveTrabajo,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(driveTrabajo, tituloNuevo).catch(() => null)
        ),
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
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = await leerDatosDesdeBuffer(buffer, { modo: 'edicion' });

    let fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datosDrive.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    let contenidoModificado = !!registro?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    const datosPrevios = await leerDatosRegistro(registro);
    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialSgcF18({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = hist.tipoCambio === 'formato'
            ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
            : fechaCambio;
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

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

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (hoja del mes vigente), sin borrar pestañas de historial ni tocar la plantilla.
 */
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

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema SGC-F-18 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarCopiasDriveTrabajo(driveId);
    await eliminarHojasHistorialFormatoSgcF18(driveId);

    const tituloMes = nombreHojaMesActual(datosPublicar.fechaElaboracion || fechaOriginal);
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo eliminar hoja previa del mes:', err.message);
        }
    }

    tituloHoja = await adoptarPlantillaEnSistema(driveId, tituloMes);
    const archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosPublicar, tituloHoja);

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
