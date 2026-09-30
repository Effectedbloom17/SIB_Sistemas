/**
 * SGC-F-12 · Notificación de cambios — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-12';
const TEMPLATE_DRIVE_ID = '1n0TAYAe9b-Q_XAYUXYArqqYPz60cLFjY';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-12 Notificacion de cambios (sistema)';
/** Hoja maestra del libro. Cada notificación se copia a una hoja con su folio. */
const SHEET_TITLE = 'Plantilla';
const SHEET_TITLE_LEGACY = 'Notificación';

const HEADER_ROW = 18;
const DATA_START_ROW = 19;
const MAX_FILAS_TABLA = 12;
const REVISION_ROW = 2;
const REVISION_COL = 11;
const FECHA_REV_ROW = 3;
const FECHA_REV_COL = 11;

const TEXT_FIELDS = {
    fecha: { row: 6, startCol: 10, endCol: 11, align: 'center' },
    responsableCambio: { row: 8, startCol: 5, endCol: 11, align: 'left' },
    queSeVaACambiar: { row: 10, startCol: 6, endCol: 11, align: 'left' },
    proposito: { row: 12, startCol: 4, endCol: 11, align: 'left' },
    consecuencias: { row: 14, startCol: 5, endCol: 11, align: 'left' },
    planTrabajo: { row: 17, startCol: 4, endCol: 11, align: 'left' }
};

const LEGACY_TEXT_FIELDS = {
    fecha: { row: 7, startCol: 10, endCol: 11 },
    responsableCambio: { row: 9, startCol: 5, endCol: 11 },
    queSeVaACambiar: { row: 11, startCol: 6, endCol: 11 },
    proposito: { row: 13, startCol: 4, endCol: 11 },
    consecuencias: { row: 15, startCol: 5, endCol: 11 }
};

const COL = {
    actividad: 1,
    asignacion: 6,
    recursos: 9,
    fechaCompromiso: 10,
    verificacion: 12
};

const FIRMAS = {
    elaboro: { row: 33, col: 2, fallbackRow: 32 },
    reviso: { row: 33, col: 6, fallbackRow: 32 },
    autorizo: { row: 33, col: 10, fallbackRow: 32 }
};

const MAX_COLUMNAS_SISTEMA = 12;
const COLUMNA_L_ANCHO_PIXELES = 150;
const TIMEZONE_MEXICO = 'America/Mexico_City';
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

const ID_EJEMPLO = 'ejemplo-sgc-f-12-organigrama';

/** Primera notificación de ejemplo, tomada del formato ya capturado (Rev. 07). */
const NOTIFICACION_EJEMPLO = {
    id: ID_EJEMPLO,
    folio: 'CAM-280926-01',
    fecha: '2026-09-28',
    responsableCambio: 'MARIA FERNANDA BECERRA HERNANDEZ',
    queSeVaACambiar: 'ESTRUCTURA ORGANIZACIONAL - ORGANIGRAMA',
    proposito: 'AMPLIAR NUESTRAS CAPACIDADES OPERATIVAS EN FUNCION DE NUESTRO TALENTO HUMANO.',
    consecuencias: 'MAYOR OFERTA DE SERVICIOS EN NUESTRA EMPRESA.',
    elaboro: 'MARIA FERNANDA BECERRA HERNANDEZ',
    reviso: 'SERGIO LUIS GUZMÁN VIGUERAS',
    autorizo: 'MARISOL AZUCENA SANTILLÁN MELO',
    filas: [
        {
            actividad: 'REUNIÓN CON ALTA DIRECCIÓN PARA REVISAR CUALES SERÁN LOS CAMBIOS AL ORGANIGRAMA.',
            asignacion: 'FERNANDA / ALTA DIRECCIÓN',
            recursos: 'TIEMPO',
            fechaCompromiso: '2026-09-29',
            verificacion: 'REALIZADA'
        },
        {
            actividad: 'NOTIFICAR EL CAMBIO AL DOCUMENTO ATH-F-01 AL EJECUTIVO DE SISTEMAS DE GESTIÓN.',
            asignacion: 'FERNANDA',
            recursos: 'SIB',
            fechaCompromiso: '2026-09-29',
            verificacion: 'NOTIFICADO'
        },
        {
            actividad: 'MODIFICACIÓN DEL ORGANIGRAMA.',
            asignacion: 'FERNANDA',
            recursos: 'FORMATO AHT-F-01',
            fechaCompromiso: '2026-10-02',
            verificacion: ''
        },
        {
            actividad: 'CREAR LAS DESCRIPCIONES DE PUESTO DEL ING. ELÉCTRICO Y DEL ARQUITECTO.',
            asignacion: 'FERNANDA',
            recursos: 'FORMATO ATH-F-02',
            fechaCompromiso: '2026-10-09',
            verificacion: ''
        },
        {
            actividad: 'DIFUSIÓN DEL ORGANIGRAMA.',
            asignacion: 'FERNANDA',
            recursos: 'TIEMPO',
            fechaCompromiso: '2026-10-06',
            verificacion: ''
        },
        {
            actividad: 'FIRMA DE LAS NUEVAS DESCRIPCIONES POR LOS COLABORADORES.',
            asignacion: 'FERNANDA',
            recursos: 'TIEMPO',
            fechaCompromiso: '2026-10-09',
            verificacion: ''
        }
    ]
};

const DATOS_DEFECTO = {
    revision: '07',
    fechaRevision: '2026-09-30',
    fechaElaboracion: '2026-09-30',
    notificaciones: [],
    notificacionActivaId: null,
    ejemploAplicado: false
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
    const texto = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        return texto;
    }
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

function camposTextoPrincipales() {
    return Object.entries(TEXT_FIELDS)
        .filter(([key]) => key !== 'planTrabajo')
        .map(([, pos]) => ({
            row: pos.row,
            startCol: pos.startCol,
            endCol: pos.endCol,
            align: pos.align || 'left'
        }));
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function esEtiquetaFirma(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t === 'ELABORÓ' || t === 'ELABORO' || t === 'REVISÓ' || t === 'REVISO'
        || t === 'AUTORIZÓ' || t === 'AUTORIZO'
        || t.includes('DUEÑO DEL PROCESO') || t.includes('EJEC. SIST') || t.includes('DIRECCIÓN GENERAL');
}

function leerCampoTexto(ws, { row, col }) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function leerCampoRango(ws, { row, startCol, endCol }) {
    for (let col = startCol; col <= endCol; col++) {
        const texto = celdaATexto(ws.getRow(row).getCell(col).value);
        if (texto) {
            return normalizarSaltosLinea(texto);
        }
    }
    return '';
}

function leerCampoRangoConFallback(ws, principal, alterno) {
    const texto = leerCampoRango(ws, principal);
    if (texto) {
        return { texto, usoFallback: false };
    }
    if (!alterno) {
        return { texto: '', usoFallback: false };
    }
    const alternoTexto = leerCampoRango(ws, alterno);
    return { texto: alternoTexto, usoFallback: !!alternoTexto };
}

function rangoCeldasRef(config) {
    return `${celdaRef(config.row, config.startCol)}:${celdaRef(config.row, config.endCol)}`;
}

function leerFirma(ws, { row, col, fallbackRow }) {
    const valor = leerCampoTexto(ws, { row, col });
    if (valor && !esEtiquetaFirma(valor)) return valor;
    const fallback = leerCampoTexto(ws, { row: fallbackRow, col });
    if (fallback && !esEtiquetaFirma(fallback)) return fallback;
    return valor && !esEtiquetaFirma(valor) ? valor : '';
}

function normalizarFechaCampo(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const iso = formatearFechaIso(texto);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return texto;
}

function sanitizarFila(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        actividad: String(base.actividad || '').trim(),
        asignacion: String(base.asignacion || '').trim(),
        recursos: String(base.recursos || '').trim(),
        fechaCompromiso: normalizarFechaCampo(base.fechaCompromiso),
        verificacion: String(base.verificacion || '').trim()
    };
}

function nuevoIdNotificacion() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `cam-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function textoTieneContenido(valor) {
    return String(valor || '').trim().length > 0;
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-12 Notificacion firmada.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarPdfsHistorial(raw, vigente) {
    const lista = (Array.isArray(raw) ? raw : [])
        .map(sanitizarPdfFirmado)
        .filter(Boolean);
    const vistos = new Set();
    const unicos = [];
    for (const pdf of lista) {
        if (vistos.has(pdf.driveFileId)) continue;
        vistos.add(pdf.driveFileId);
        unicos.push(pdf);
    }
    if (vigente && !vistos.has(vigente.driveFileId)) {
        unicos.unshift(vigente);
    }
    return unicos;
}

function filasDesdeRaw(raw) {
    const filasRaw = Array.isArray(raw?.filas) ? raw.filas : [];
    return filasRaw.map(sanitizarFila).filter((f) =>
        f.actividad || f.asignacion || f.recursos || f.fechaCompromiso || f.verificacion
    );
}

function notificacionTieneContenido(n) {
    if (!n) return false;
    if ([n.fecha, n.responsableCambio, n.queSeVaACambiar, n.proposito, n.consecuencias, n.planTrabajo]
        .some(textoTieneContenido)) {
        return true;
    }
    return (n.filas || []).length > 0;
}

function fechaTagFolio(fechaIso) {
    const f = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [y, m, d] = f.split('-');
    return `${d}${m}${String(y).slice(-2)}`;
}

function siguienteFolioCam(existentes, fechaIso) {
    const tag = fechaTagFolio(fechaIso);
    let maximo = 0;
    for (const n of existentes || []) {
        const match = String(n?.folio || '').trim().toUpperCase().match(/^CAM-(\d{6})-(\d+)$/);
        if (match && match[1] === tag) {
            const num = parseInt(match[2], 10);
            if (Number.isFinite(num) && num > maximo) maximo = num;
        }
    }
    return `CAM-${tag}-${String(maximo + 1).padStart(2, '0')}`;
}

function sanitizarNotificacion(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    return {
        id: String(base.id || '').trim() || nuevoIdNotificacion(),
        folio: String(base.folio || '').trim().toUpperCase(),
        nombreHoja: String(base.nombreHoja || base.nombre_hoja || '').trim(),
        fecha: formatearFechaIso(base.fecha) || String(base.fecha || '').trim(),
        responsableCambio: String(base.responsableCambio || '').trim(),
        queSeVaACambiar: normalizarSaltosLinea(base.queSeVaACambiar),
        proposito: normalizarSaltosLinea(base.proposito),
        consecuencias: normalizarSaltosLinea(base.consecuencias),
        planTrabajo: normalizarSaltosLinea(base.planTrabajo),
        filas: filasDesdeRaw(base),
        elaboro: String(base.elaboro || '').trim(),
        reviso: String(base.reviso || '').trim(),
        autorizo: String(base.autorizo || '').trim(),
        pdfFirmado,
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial, pdfFirmado)
    };
}

function esPayloadPlano(base) {
    if (!base || typeof base !== 'object' || Array.isArray(base.notificaciones)) return false;
    return notificacionTieneContenido({
        fecha: base.fecha,
        responsableCambio: base.responsableCambio,
        queSeVaACambiar: base.queSeVaACambiar,
        proposito: base.proposito,
        consecuencias: base.consecuencias,
        planTrabajo: base.planTrabajo,
        filas: filasDesdeRaw(base)
    });
}

function asegurarFolios(lista) {
    const out = lista.map((n) => ({ ...n }));
    for (const n of out) {
        if (String(n.folio || '').trim()) {
            n.folio = String(n.folio).trim().toUpperCase();
            continue;
        }
        if (!notificacionTieneContenido(n)) continue;
        n.folio = siguienteFolioCam(out, n.fecha || fechaHoyIso());
    }
    return out;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let notificaciones = [];
    if (Array.isArray(base.notificaciones)) {
        notificaciones = base.notificaciones.map(sanitizarNotificacion);
    } else if (esPayloadPlano(base)) {
        notificaciones = [sanitizarNotificacion(base)];
    }
    notificaciones = asegurarFolios(notificaciones).filter((n) =>
        String(n.folio || '').trim() || notificacionTieneContenido(n) || n.pdfFirmado
    );
    const activa = String(base.notificacionActivaId || base.notificacion_activa_id || '').trim();
    const tieneContenido = notificaciones.some(notificacionTieneContenido);
    const ejemploAplicado = !!base.ejemploAplicado || tieneContenido;
    let revision = String(base.revision || '').trim();
    let fechaRevision = formatearFechaIso(base.fechaRevision);
    let fechaElaboracion = formatearFechaIso(base.fechaElaboracion);
    if (!notificaciones.length && !ejemploAplicado) {
        notificaciones.push(sanitizarNotificacion(NOTIFICACION_EJEMPLO));
        if (!revision || revision === '00') revision = '07';
        if (!fechaRevision || fechaRevision === '2025-01-17') fechaRevision = '2026-09-30';
        if (!fechaElaboracion || fechaElaboracion === '2025-01-17') fechaElaboracion = '2026-09-30';
    }
    const idsFinal = new Set(notificaciones.map((n) => n.id));
    return {
        revision: revision || '07',
        fechaRevision: fechaRevision || '2026-09-30',
        fechaElaboracion: fechaElaboracion || '2026-09-30',
        notificaciones,
        notificacionActivaId: idsFinal.has(activa) ? activa : (notificaciones[0]?.id || null),
        ejemploAplicado: ejemploAplicado || notificaciones.some((n) => n.id === ID_EJEMPLO)
    };
}

function camposPrincipalesConContenido(datos) {
    return (sanitizarDatos(datos).notificaciones || []).some(notificacionTieneContenido);
}

function camposPrincipalesVacios(datos) {
    return !camposPrincipalesConContenido(datos);
}

function fusionarDatosPreferirDb(datosDrive, datosDb) {
    if (!datosDb) return datosDrive;
    if (!datosDrive) return datosDb;
    if ((datosDb.notificaciones || []).length) return datosDb;
    if ((datosDrive.notificaciones || []).length) return datosDrive;
    return datosDb;
}

function necesitaRehidratarDriveDesdeDb(datosDrive, datosDb) {
    const db = datosDb ? sanitizarDatos(datosDb) : null;
    if (!db || !db.notificaciones.length) return false;
    const drive = datosDrive ? sanitizarDatos(datosDrive) : null;
    if (!drive || !drive.notificaciones.length) return true;
    return false;
}

function resolverNotificacionActiva(datos) {
    const meta = datos?.notificaciones ? datos : sanitizarDatos(datos);
    const id = meta.notificacionActivaId;
    return (meta.notificaciones || []).find((n) => n.id === id) || meta.notificaciones[0] || null;
}

function payloadHoja(meta, notificacion) {
    const n = notificacion || {};
    return {
        revision: meta?.revision || DATOS_DEFECTO.revision,
        fechaRevision: meta?.fechaRevision || DATOS_DEFECTO.fechaRevision,
        fecha: n.fecha || '',
        responsableCambio: n.responsableCambio || '',
        queSeVaACambiar: n.queSeVaACambiar || '',
        proposito: n.proposito || '',
        consecuencias: n.consecuencias || '',
        planTrabajo: n.planTrabajo || '',
        filas: Array.isArray(n.filas) ? n.filas : [],
        elaboro: n.elaboro || '',
        reviso: n.reviso || '',
        autorizo: n.autorizo || ''
    };
}

function sanitizarNombreHojaFolio(folio) {
    return String(folio || '').trim().toUpperCase()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function resolverNombreHojaNotificacion(notificacion) {
    const folio = sanitizarNombreHojaFolio(notificacion?.folio);
    if (folio) return folio;
    const guardado = sanitizarNombreHojaFolio(notificacion?.nombreHoja);
    if (guardado && !/^PLANTILLA$/i.test(guardado) && !/^NOTIFICACI/i.test(guardado)) return guardado;
    const id = String(notificacion?.id || '').trim();
    if (id) return `BORRADOR-${id.slice(0, 8)}`;
    return '';
}

function esHojaPlantillaSgcF12(titulo) {
    const t = String(titulo || '').trim();
    return t === SHEET_TITLE || t === SHEET_TITLE_LEGACY || /^plantilla$/i.test(t) || /^notificaci[oó]n$/i.test(t);
}

function esHojaNotificacionSgcF12(titulo) {
    const t = String(titulo || '').trim();
    if (!t || esHojaPlantillaSgcF12(t)) return false;
    return /^CAM-/i.test(t) || /^BORRADOR-/i.test(t);
}

async function resolverHojaPlantilla(spreadsheetId) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const plantilla = driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /^plantilla$/i })
        || driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE_LEGACY, { fallbackRegex: /notificaci[oó]n/i });
    return { titulos, plantilla };
}

async function sincronizarHojasNotificacionesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const { titulos, plantilla } = await resolverHojaPlantilla(spreadsheetId);
    const setExistentes = new Set(titulos);

    if (!plantilla) {
        console.warn(
            '[SGC-F-12] Hoja plantilla no encontrada. '
            + `Hojas: ${titulos.join(', ') || '(ninguna)'}`
        );
    }

    const mapaHojaPrevia = new Map();
    if (prev?.notificaciones) {
        for (const n of prev.notificaciones) {
            const previa = sanitizarNombreHojaFolio(n.nombreHoja) || resolverNombreHojaNotificacion(n);
            if (previa) mapaHojaPrevia.set(n.id, previa);
        }
    }

    const hojasActivas = new Set();

    for (const notificacion of meta.notificaciones) {
        let nombreHoja = resolverNombreHojaNotificacion(notificacion);
        if (!nombreHoja) continue;

        const hojaPrev = mapaHojaPrevia.get(notificacion.id);
        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev) && !esHojaPlantillaSgcF12(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-12] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
            }
        }

        if (!setExistentes.has(nombreHoja)) {
            if (!plantilla) {
                console.warn(`[SGC-F-12] No se pudo crear la hoja "${nombreHoja}" porque no hay plantilla.`);
                continue;
            }
            try {
                const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantilla, nombreHoja);
                nombreHoja = dup.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-12] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        notificacion.nombreHoja = nombreHoja;
        hojasActivas.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(
            spreadsheetId,
            payloadHoja(meta, notificacion),
            MAX_FILAS_TABLA,
            false,
            nombreHoja
        );
    }

    if (datos && Array.isArray(datos.notificaciones)) {
        datos.notificaciones = meta.notificaciones;
        datos.notificacionActivaId = meta.notificacionActivaId;
    }

    const eliminar = [];
    for (const titulo of titulos) {
        if (esHojaPlantillaSgcF12(titulo)) continue;
        if (esHojaNotificacionSgcF12(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return meta;
}

async function faltanHojasNotificaciones(spreadsheetId, datos) {
    const meta = sanitizarDatos(datos);
    if (!meta.notificaciones.length) return false;
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const set = new Set(titulos);
    return meta.notificaciones.some((n) => {
        const nombre = resolverNombreHojaNotificacion(n);
        return nombre && !set.has(nombre) && !set.has(n.nombreHoja);
    });
}

async function publicarDatosEnDrive(driveFileId, datos, datosPrevios = null) {
    if (!driveFileId) {
        return null;
    }
    try {
        const infoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await sincronizarHojasNotificacionesEnDrive(driveFileId, datos, datosPrevios);
            return driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
        }
    } catch (err) {
        console.warn('[SGC-F-12] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
    }
    const buffer = await escribirDatosEnPlantilla(datos);
    const archivo = await subirOReemplazarEnDrive(buffer, driveFileId);
    if (archivo?.id) {
        try {
            await sincronizarHojasNotificacionesEnDrive(archivo.id, datos, datosPrevios);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron crear las hojas del archivero tras reemplazar archivo:', err.message);
        }
    }
    return archivo;
}

function driveEsMasViejoQueDb(registro, archivoDrive) {
    if (!archivoDrive?.modifiedTime || !registro?.ultima_sync_drive) {
        return true;
    }
    const driveTime = new Date(archivoDrive.modifiedTime).getTime();
    const dbTime = new Date(registro.ultima_sync_drive).getTime();
    if (Number.isNaN(driveTime) || Number.isNaN(dbTime)) {
        return true;
    }
    return driveTime <= dbTime;
}

function encontrarFilaFinDatos(ws) {
    const limite = DATA_START_ROW + MAX_FILAS_TABLA;
    for (let r = DATA_START_ROW; r <= limite; r++) {
        const actividad = celdaATexto(ws.getRow(r).getCell(COL.actividad).value);
        const asignacion = celdaATexto(ws.getRow(r).getCell(COL.asignacion).value);
        if (!actividad && !asignacion && r > DATA_START_ROW) {
            const prev = celdaATexto(ws.getRow(r - 1).getCell(COL.actividad).value);
            if (prev) return r;
        }
    }
    return limite;
}

function parsearDatosDesdeHoja(ws) {
    const filaFin = encontrarFilaFinDatos(ws);
    const filas = [];

    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        const actividad = celdaATexto(row.getCell(COL.actividad).value);
        if (!actividad) continue;
        if (actividad.toLowerCase().includes('actividad')) continue;

        filas.push(sanitizarFila({
            actividad,
            asignacion: celdaATexto(row.getCell(COL.asignacion).value),
            recursos: celdaATexto(row.getCell(COL.recursos).value),
            fechaCompromiso: celdaATexto(row.getCell(COL.fechaCompromiso).value),
            verificacion: celdaATexto(row.getCell(COL.verificacion).value)
        }));
    }

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL).value);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);

    const fechaRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.fecha, LEGACY_TEXT_FIELDS.fecha);
    const respRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.responsableCambio, LEGACY_TEXT_FIELDS.responsableCambio);
    const queRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.queSeVaACambiar, LEGACY_TEXT_FIELDS.queSeVaACambiar);
    const propRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.proposito, LEGACY_TEXT_FIELDS.proposito);
    const consRes = leerCampoRangoConFallback(ws, TEXT_FIELDS.consecuencias, LEGACY_TEXT_FIELDS.consecuencias);
    const legacyUsed = [
        fechaRes.usoFallback,
        respRes.usoFallback,
        queRes.usoFallback,
        propRes.usoFallback,
        consRes.usoFallback
    ].some(Boolean);
    const fechaLeida = fechaRes.texto;

    return {
        datos: sanitizarDatos({
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
        fecha: fechaLeida,
        responsableCambio: respRes.texto,
        queSeVaACambiar: queRes.texto,
        proposito: propRes.texto,
        consecuencias: consRes.texto,
        planTrabajo: leerCampoRango(ws, TEXT_FIELDS.planTrabajo),
        fechaElaboracion: fechaLeida
            ? formatearFechaIso(fechaLeida)
            : DATOS_DEFECTO.fechaElaboracion,
        elaboro: leerFirma(ws, FIRMAS.elaboro),
        reviso: leerFirma(ws, FIRMAS.reviso),
        autorizo: leerFirma(ws, FIRMAS.autorizo),
        filas
        }),
        legacyUsed
    };
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla SGC-F-12 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const { datos } = await leerDatosDesdeBuffer(buffer);
    return datos;
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

function asignarTexto(celda, texto) {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = { ...(celda.alignment || {}), vertical: 'middle', wrapText: true };
}

function asignarTextoConAlineacion(celda, texto, align = 'left') {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true,
        horizontal: align === 'center' ? 'center' : 'left'
    };
}

function asignarTextoEnRango(ws, config, texto) {
    const valor = normalizarSaltosLinea(texto);
    asignarTextoConAlineacion(
        ws.getRow(config.row).getCell(config.startCol),
        valor,
        config.align || 'left'
    );
}

function asignarFirma(ws, config, valor) {
    const texto = String(valor || '').trim();
    if (!texto) return;
    const celda = ws.getRow(config.row).getCell(config.col);
    if (celdaATexto(celda.value) && !esEtiquetaFirma(celdaATexto(celda.value))) {
        asignarTexto(celda, texto);
    } else {
        asignarTexto(celda, texto);
    }
}

async function escribirDatosEnPlantilla(datos) {
    const meta = sanitizarDatos(datos);
    const hoja = payloadHoja(meta, resolverNotificacionActiva(meta));
    datos = hoja;
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-12 no contiene hojas.');

    const filaFin = encontrarFilaFinDatos(ws);
    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        Object.values(COL).forEach((c) => {
            row.getCell(c).value = null;
        });
    }

    ws.getRow(REVISION_ROW).getCell(REVISION_COL).value = `Revisión: ${datos.revision || '00'}`;
    ws.getRow(FECHA_REV_ROW).getCell(FECHA_REV_COL).value =
        `Fecha Rev.: ${formatearFechaDisplay(datos.fechaRevision)}`;

    Object.entries(TEXT_FIELDS).forEach(([key, pos]) => {
        if (key === 'planTrabajo') {
            return;
        }
        const valor = key === 'fecha' ? formatearFechaDisplay(datos.fecha) : datos[key];
        asignarTextoEnRango(ws, pos, valor);
    });

    datos.filas.slice(0, MAX_FILAS_TABLA).forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        asignarTexto(row.getCell(COL.actividad), fila.actividad);
        asignarTexto(row.getCell(COL.asignacion), fila.asignacion);
        asignarTexto(row.getCell(COL.recursos), fila.recursos);
        const fc = fila.fechaCompromiso;
        const fcDisplay = /^\d{4}-\d{2}-\d{2}$/.test(fc) ? formatearFechaDisplay(fc) : fc;
        asignarTexto(row.getCell(COL.fechaCompromiso), fcDisplay);
        asignarTexto(row.getCell(COL.verificacion), fila.verificacion);
    });

    asignarFirma(ws, FIRMAS.elaboro, datos.elaboro);
    asignarFirma(ws, FIRMAS.reviso, datos.reviso);
    asignarFirma(ws, FIRMAS.autorizo, datos.autorizo);

    ws.getColumn(COL.verificacion).width = COLUMNA_L_ANCHO_PIXELES / 7;

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
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

function datosAActualizacionesSheet(datos, filasPrevias = 0, limpiarLegacy = false, sheetTitle = SHEET_TITLE) {
    const actualizaciones = [];

    actualizaciones.push({
        range: rangoSheet(celdaRef(REVISION_ROW, REVISION_COL), sheetTitle),
        values: [[`Revisión: ${datos.revision || '00'}`]]
    });
    actualizaciones.push({
        range: rangoSheet(celdaRef(FECHA_REV_ROW, FECHA_REV_COL), sheetTitle),
        values: [[`Fecha Rev.: ${formatearFechaDisplay(datos.fechaRevision)}`]]
    });

    Object.entries(TEXT_FIELDS).forEach(([key, pos]) => {
        if (key === 'planTrabajo') {
            return;
        }
        const valor = key === 'fecha' ? formatearFechaDisplay(datos.fecha) : (datos[key] || '');
        actualizaciones.push({
            range: rangoSheet(celdaRef(pos.row, pos.startCol), sheetTitle),
            values: [[normalizarSaltosLinea(valor)]]
        });
    });

    if (limpiarLegacy) {
        Object.values(LEGACY_TEXT_FIELDS).forEach((pos) => {
            actualizaciones.push({
                range: rangoSheet(celdaRef(pos.row, pos.startCol), sheetTitle),
                values: [['']]
            });
        });
    }

    const totalFilas = Math.max(Array.isArray(datos.filas) ? datos.filas.length : 0, filasPrevias, 1);
    for (let idx = 0; idx < totalFilas; idx++) {
        const fila = (datos.filas && datos.filas[idx]) || {
            actividad: '',
            asignacion: '',
            recursos: '',
            fechaCompromiso: '',
            verificacion: ''
        };
        const rowNum = DATA_START_ROW + idx;
        const fc = fila.fechaCompromiso;
        const fcDisplay = /^\d{4}-\d{2}-\d{2}$/.test(fc) ? formatearFechaDisplay(fc) : fc;

        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.actividad), sheetTitle),
            values: [[normalizarSaltosLinea(fila.actividad)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.asignacion), sheetTitle),
            values: [[normalizarSaltosLinea(fila.asignacion)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.recursos), sheetTitle),
            values: [[normalizarSaltosLinea(fila.recursos)]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.fechaCompromiso), sheetTitle),
            values: [[fcDisplay]]
        });
        actualizaciones.push({
            range: rangoSheet(celdaRef(rowNum, COL.verificacion), sheetTitle),
            values: [[normalizarSaltosLinea(fila.verificacion)]]
        });
    }

    if (datos.elaboro) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.elaboro.row, FIRMAS.elaboro.col), sheetTitle),
            values: [[datos.elaboro]]
        });
    }
    if (datos.reviso) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.reviso.row, FIRMAS.reviso.col), sheetTitle),
            values: [[datos.reviso]]
        });
    }
    if (datos.autorizo) {
        actualizaciones.push({
            range: rangoSheet(celdaRef(FIRMAS.autorizo.row, FIRMAS.autorizo.col), sheetTitle),
            values: [[datos.autorizo]]
        });
    }

    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(
    spreadsheetId,
    datos,
    filasPrevias = 0,
    limpiarLegacy = false,
    sheetTitle = SHEET_TITLE
) {
    const actualizaciones = datosAActualizacionesSheet(datos, filasPrevias, limpiarLegacy, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    if (sheetTitle === SHEET_TITLE) {
        try {
            await driveService.recortarColumnasGoogleSheet(spreadsheetId, DRIVE_SHEET_OPTIONS);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron recortar columnas en Drive:', err.message);
        }
        try {
            await driveService.aplicarFormatoVisualSgcF12(spreadsheetId, {
                sheetTitle: SHEET_TITLE,
                columnLPixelWidth: COLUMNA_L_ANCHO_PIXELES,
                textFields: camposTextoPrincipales()
            });
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo aplicar formato visual en Drive:', err.message);
        }
    }
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const filasPrevias = Array.isArray(datos?.filas) ? datos.filas.length : 0;
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, filasPrevias, false, sheetTitle);
}

async function aplicarHistorialSgcF12(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente: excelHistorial.estructuraFilasEquivalente,
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
                console.warn('[SGC-F-12] No se pudo eliminar copia en Drive:', err.message);
            }
        }
    }
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

async function construirRespuesta(registro, datos, archivoDrive) {
    const meta = sanitizarDatos(datos);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || meta.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    const activa = resolverNotificacionActiva(meta);
    const hojaEditor = activa ? resolverNombreHojaNotificacion(activa) : '';

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;

    if (driveId && hojaEditor) {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo resolver gid de la hoja del folio:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...meta, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || meta.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        hojaEditor: hojaEditor || null
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

function copiaComparable(datos) {
    const meta = sanitizarDatos(datos);
    return {
        notificaciones: (meta.notificaciones || []).map((n) => ({
            id: n.id,
            folio: n.folio,
            fecha: n.fecha,
            responsableCambio: n.responsableCambio,
            queSeVaACambiar: n.queSeVaACambiar,
            proposito: n.proposito,
            consecuencias: n.consecuencias,
            planTrabajo: n.planTrabajo,
            filas: n.filas,
            pdfFirmadoId: n.pdfFirmado?.driveFileId || null,
            historialIds: (n.pdfsHistorial || []).map((p) => p.driveFileId)
        }))
    };
}

function datosSonEquivalentes(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(copiaComparable(a)) === JSON.stringify(copiaComparable(b));
}

function aplicarRevisionPorCambio(revisionActual, fechaRevisionActual, huboCambio, origen = 'sistema') {
    let revision = String(revisionActual || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision;
    let fechaRevision = formatearFechaIso(fechaRevisionActual) || DATOS_DEFECTO.fechaRevision;
    if (huboCambio && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        fechaRevision = fechaHoyIso();
    }
    return { revision, fechaRevision };
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const actualizado = await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
            return actualizado;
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo eliminar duplicado en Drive:', err.message);
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
    let legacyUsado = false;
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
            legacyUsado = lectura.legacyUsed;
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
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

    datos = sanitizarDatos(datos);

    if (driveFileId && (datos.notificaciones || []).length) {
        try {
            const faltan = await faltanHojasNotificaciones(driveFileId, datos);
            if (faltan || legacyUsado) {
                datos = await sincronizarHojasNotificacionesEnDrive(driveFileId, datos, datosDb);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
                await guardarRegistroDb(pool, {
                    driveFileId,
                    datos,
                    fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
                    fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                    contenidoModificado: !!registro?.contenido_modificado
                });
                registro = await obtenerRegistroDb(pool);
            }
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron asegurar las hojas del archivero:', err.message);
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
            const buffer = await escribirDatosEnPlantilla(datos);
            archivoDrive = await subirOReemplazarEnDrive(buffer, null);
            await guardarRegistroDb(pool, {
                driveFileId: archivoDrive.id,
                datos,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
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

    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);

    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    const datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion
            ? fechaModificacion
            : fechaOriginal
    };

    const driveId = registroPrevio?.drive_file_id || null;
    let archivoDrive = null;

    try {
        if (driveId) {
            archivoDrive = await publicarDatosEnDrive(driveId, datosGuardar, datosPrevios);
        }
        if (!archivoDrive) {
            const buffer = await escribirDatosEnPlantilla(datosGuardar);
            archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);
            if (archivoDrive?.id) {
                datosGuardar.notificaciones = (await sincronizarHojasNotificacionesEnDrive(
                    archivoDrive.id,
                    datosGuardar,
                    datosPrevios
                )).notificaciones;
            }
        } else if (datosGuardar.notificaciones) {
            // sincronizarHojas muta el objeto que recibe; publicarDatosEnDrive recibe datosGuardar.
        }
    } catch (err) {
        console.warn('[SGC-F-12] No se pudo sincronizar con Drive; se guarda solo en BD:', err.message || err);
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive?.id || driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return await construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await resolverDriveFileId(registro);
    let archivoDrive = null;

    if (driveFileId) {
        try {
            await sincronizarHojasNotificacionesEnDrive(driveFileId, datos, datos);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
                fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
                contenidoModificado: !!registro?.contenido_modificado
            });
        } catch (err) {
            console.warn('[SGC-F-12] No se pudo sincronizar hojas desde el archivero:', err.message);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        }
    }

    const registroActualizado = await obtenerRegistroDb(pool);
    return await construirRespuesta(registroActualizado || registro, datos, archivoDrive);
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
    datos = sanitizarDatos(datos);

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
            console.warn('[SGC-F-12] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await eliminarCopiasDriveTrabajo();

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );

    if (archivoDrive?.id) {
        try {
            datosPublicar.notificaciones = (await sincronizarHojasNotificacionesEnDrive(
                archivoDrive.id,
                datosPublicar,
                null
            )).notificaciones;
        } catch (err) {
            console.warn('[SGC-F-12] No se pudieron crear hojas de folio al actualizar plantilla:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return await construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === TEMPLATE_DRIVE_ID;
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-12 ${tag} - ${mm}/${yy}.pdf`;
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

async function descargarPlantillaPdf(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const notificacionId = String(opciones.notificacionId || opciones.id || '').trim() || null;
    let notificacion = null;
    if (notificacionId) {
        notificacion = (datos.notificaciones || []).find((n) => n.id === notificacionId) || null;
    }
    if (!notificacion) {
        notificacion = resolverNotificacionActiva(
            notificacionId ? { ...datos, notificacionActivaId: notificacionId } : datos
        );
    }
    if (!notificacion || (!notificacionTieneContenido(notificacion) && !String(notificacion.folio || '').trim())) {
        const err = new Error('Abre o selecciona una notificación con datos para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        const err = new Error('No hay Google Sheet SGC-F-12 configurado para exportar a PDF.');
        err.statusCode = 404;
        throw err;
    }

    const datosParaHoja = sanitizarDatos({
        ...datos,
        notificacionActivaId: notificacion.id
    });
    await sincronizarHojasNotificacionesEnDrive(driveFileId, datosParaHoja, datos);
    const activa = (datosParaHoja.notificaciones || []).find((n) => n.id === notificacion.id) || notificacion;
    const tituloHoja = resolverNombreHojaNotificacion(activa);
    if (!tituloHoja) {
        const err = new Error('No se pudo resolver la hoja de la notificación para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-12] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        const err = new Error(
            `No se encontró la hoja «${tituloHoja}» en Drive. Guarda la información primero para sincronizar la hoja.`
        );
        err.statusCode = 404;
        throw err;
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        size: 'letter',
        fitToWidth: true,
        margins: 'normal'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-12 quedó vacía.');
    }

    const folio = String(activa.folio || '').trim() || tituloHoja;
    const nombreSeguro = sanitizarNombreHojaFolio(folio) || 'CAM';
    return {
        buffer: Buffer.from(pdfBuffer),
        nombreArchivo: `SGC-F-12 ${nombreSeguro}.pdf`
    };
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const notificacionId = String(body?.notificacionId || body?.notificacion_id || '').trim();
    if (!notificacionId) throw new Error('Se requiere notificacionId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const notificaciones = Array.isArray(datosPrevios.notificaciones) ? [...datosPrevios.notificaciones] : [];
    const idx = notificaciones.findIndex((n) => n.id === notificacionId);
    if (idx < 0) {
        throw new Error('No se encontró la notificación indicada en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, notificaciones[idx].folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(notificaciones[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });
    const histPrev = sanitizarPdfsHistorial(notificaciones[idx].pdfsHistorial, notificaciones[idx].pdfFirmado);
    const pdfsHistorial = [
        pdfFirmado,
        ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)
    ];

    notificaciones[idx] = { ...notificaciones[idx], pdfFirmado, pdfsHistorial };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        notificaciones,
        notificacionActivaId: notificacionId
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
    const respuesta = await construirRespuesta(registro, datosGuardar, archivoDrive);
    return { ...respuesta, pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    const notificacionId = String(body?.notificacionId || body?.notificacion_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');
    if (!notificacionId) throw new Error('notificacionId requerido.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const notificaciones = Array.isArray(datosPrevios.notificaciones) ? [...datosPrevios.notificaciones] : [];
    const idx = notificaciones.findIndex((n) => n.id === notificacionId);
    if (idx < 0) throw new Error('No se encontró la notificación indicada en el archivero.');

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[SGC-F-12] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(notificaciones[idx].pdfsHistorial, notificaciones[idx].pdfFirmado)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = notificaciones[idx].pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }
    notificaciones[idx] = {
        ...notificaciones[idx],
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: hist
    };

    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        notificaciones,
        notificacionActivaId: notificacionId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosGuardar.fechaElaboracion,
        fechaModificacionContenido: formatearFechaIso(registroPrevio?.fecha_modificacion_contenido),
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    return await construirRespuesta(registro, datosGuardar, archivoDrive);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    subirPdfFirmado,
    eliminarPdfHistorial,
    sanitizarDatos
};
