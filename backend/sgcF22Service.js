/**
 * SGC-F-22 · Reporte de daño o perdida de propiedad del cliente o proveedor.
 * Multi-reporte archivero (una pestaña por reporte) + PDF firmado + persistencia biznaga_sgc.
 * Arquetipo: sgcSgcF04Service (archivero). TEMPLATE_DRIVE_ID = archivo de trabajo en carpeta sistema.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-22';
const TEMPLATE_DRIVE_ID = '1asICBqzuBkhpvD4tXdfB1VIkFNPyhiOGNv6SxaEcYMw';
const DRIVE_FILE_ID_SISTEMA = '1asICBqzuBkhpvD4tXdfB1VIkFNPyhiOGNv6SxaEcYMw';
const CARPETA_DRIVE_ID = '1PG9K6nxp3G-CUSDdHsp1DrcOnatsB1rx';
const CARPETA_PDF_FIRMADOS_ID = '1PG9K6nxp3G-CUSDdHsp1DrcOnatsB1rx';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-22 Reporte de daño o perdida de propiedad del cliente o proveedor (sistema)';
const SHEET_TITLE = 'Plantilla';
const TIMEZONE_MEXICO = 'America/Mexico_City';
const MAX_COLUMNAS_SISTEMA = 5;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
};

/** Mapa de celdas (1-based) verificado contra la plantilla real. */
const CELLS = {
    revision: { row: 2, col: 5 },
    fechaRevision: { row: 3, col: 5 },
    fechaSuceso: { row: 5, col: 5 },
    empresaAfectada: { row: 8, col: 3 },
    nombreClienteProveedor: { row: 9, col: 3 },
    nombreBien: { row: 10, col: 3 },
    descripcionSuceso: { row: 13, col: 1 },
    accionesBiznaga: { row: 20, col: 1 },
    nombreFirma: { row: 33, col: 3 }
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-20',
    fechaElaboracion: '2025-01-20',
    reportes: [],
    reporteActivoId: null
};

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

function esHojaReporteSgcF22(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    return /^DP-/i.test(t) || /^BORRADOR-/i.test(t);
}

function datosConReporteActivo(datos, reporte) {
    return sanitizarDatos({
        ...(datos || {}),
        reporteActivoId: reporte?.id || null
    });
}

async function resolverTituloHojaTrabajo(spreadsheetId, datos = null) {
    if (datos) {
        return resolverNombreHojaReporte(datos);
    }
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const folioSheet = titulos.find((t) => /^DP-/i.test(String(t || '').trim()));
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
    if (!ws) throw new Error('La plantilla SGC-F-22 no contiene hojas.');
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
        { fallbackRegex: /plantilla/i }
    );

    if (!plantillaOrigen) {
        console.warn(
            '[SGC-F-22] Hoja plantilla «Plantilla» no encontrada en el spreadsheet. '
            + `Hojas: ${titulosExistentes.join(', ') || '(ninguna)'}`
        );
    }

    const mapaIdHojaPrevio = new Map();
    if (prev?.reportes) {
        for (const r of prev.reportes) {
            mapaIdHojaPrevio.set(r.id, resolverNombreHojaReporte(datosConReporteActivo(meta, r)));
        }
    }

    const activoId = String(meta.reporteActivoId || '').trim();
    const nombresVigentes = new Set();
    for (const reporte of meta.reportes) {
        const tieneFolio = !!String(reporte.folio || '').trim();
        if (!reporteTieneContenido(reporte) && !tieneFolio) continue;
        nombresVigentes.add(resolverNombreHojaReporte(datosConReporteActivo(meta, reporte)));
    }

    const hojasActualizadas = new Set();

    for (const reporte of meta.reportes) {
        const tieneFolio = !!String(reporte.folio || '').trim();
        if (!reporteTieneContenido(reporte) && !tieneFolio) continue;

        let nombreHoja = resolverNombreHojaReporte(datosConReporteActivo(meta, reporte));
        const hojaPrev = mapaIdHojaPrevio.get(reporte.id);
        const esActivo = !!activoId && reporte.id === activoId;

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-22] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
            }
        }

        const existeHoja = setExistentes.has(nombreHoja);
        if (!existeHoja) {
            // No regenerar hojas borradas a mano: solo crear la del reporte activo.
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
                console.warn(`[SGC-F-22] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        hojasActualizadas.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(
            spreadsheetId,
            datosConReporteActivo(meta, reporte),
            nombreHoja
        );
    }

    // Borrar solo hojas de reportes que ya no están en el archivero (no las que el usuario ocultó/borró a propósito).
    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaReporteSgcF22(titulo) && !nombresVigentes.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-22] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return hojasActualizadas;
}

function etiquetaFechaRevision(fechaIso) {
    const display = formatearFechaDisplayGuiones(fechaIso);
    return display ? `Fech. Rev: ${display}` : '';
}

function nuevoIdReporte() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `dp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function crearReporteVacio() {
    return {
        id: nuevoIdReporte(),
        folio: '',
        fechaSuceso: '',
        empresaAfectada: '',
        nombreClienteProveedor: '',
        nombreBien: '',
        descripcionSuceso: '',
        accionesBiznaga: '',
        nombreFirma: '',
        pdfFirmado: null
    };
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-22 Reporte firmado.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarReporte(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        id: String(base.id || '').trim() || nuevoIdReporte(),
        folio: String(base.folio || '').trim().toUpperCase(),
        fechaSuceso: formatearFechaIso(base.fechaSuceso) || String(base.fechaSuceso || '').trim(),
        empresaAfectada: String(base.empresaAfectada || '').trim(),
        nombreClienteProveedor: String(base.nombreClienteProveedor || '').trim(),
        nombreBien: String(base.nombreBien || '').trim(),
        descripcionSuceso: normalizarSaltosLinea(base.descripcionSuceso),
        accionesBiznaga: normalizarSaltosLinea(base.accionesBiznaga),
        nombreFirma: String(base.nombreFirma || '').trim(),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado)
    };
}

function esReporteLegacyPlano(base) {
    return !Array.isArray(base.reportes)
        && (
            base.folio
            || base.fechaSuceso
            || base.empresaAfectada
            || base.nombreClienteProveedor
            || base.nombreBien
            || base.descripcionSuceso
            || base.accionesBiznaga
            || base.nombreFirma
        );
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
        r.folio, r.fechaSuceso, r.empresaAfectada, r.nombreClienteProveedor,
        r.nombreBien, r.descripcionSuceso, r.accionesBiznaga, r.nombreFirma
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
    if (camposPrincipalesConContenido(datosDb) || Array.isArray(datosDb.reportes)) {
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

function formatearFechaDisplayGuiones(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
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
    const revText = leerCelda(ws, CELLS.revision.row, CELLS.revision.col);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = leerCelda(ws, CELLS.fechaRevision.row, CELLS.fechaRevision.col);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    const fechaSucesoTexto = leerCelda(ws, CELLS.fechaSuceso.row, CELLS.fechaSuceso.col);

    return {
        datos: sanitizarDatos({
            revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
            fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
            fechaSuceso: fechaSucesoTexto,
            empresaAfectada: leerCelda(ws, CELLS.empresaAfectada.row, CELLS.empresaAfectada.col),
            nombreClienteProveedor: leerCelda(ws, CELLS.nombreClienteProveedor.row, CELLS.nombreClienteProveedor.col),
            nombreBien: leerCelda(ws, CELLS.nombreBien.row, CELLS.nombreBien.col),
            descripcionSuceso: leerCelda(ws, CELLS.descripcionSuceso.row, CELLS.descripcionSuceso.col),
            accionesBiznaga: leerCelda(ws, CELLS.accionesBiznaga.row, CELLS.accionesBiznaga.col),
            nombreFirma: leerCelda(ws, CELLS.nombreFirma.row, CELLS.nombreFirma.col),
            fechaElaboracion: fechaSucesoTexto
                ? (formatearFechaIso(fechaSucesoTexto) || DATOS_DEFECTO.fechaElaboracion)
                : DATOS_DEFECTO.fechaElaboracion
        }),
        legacyUsed: false
    };
}

async function leerDatosDesdePlantilla() {
    const buffer = await obtenerBufferPlantillaSgcF22();
    const { datos } = await leerDatosDesdeBuffer(buffer);
    return datos;
}

async function obtenerBufferPlantillaSgcF22() {
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
        console.warn('[SGC-F-22] Export plantilla falló, reintentando descarga nativa:', err.message);
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

function escribirDatosEnWorksheet(ws, datos) {
    const meta = sanitizarDatos(datos);
    const rep = resolverReporteActivo(meta);
    asignarEn(ws, CELLS.revision.row, CELLS.revision.col, `Revisión: ${meta.revision || '00'}`);
    asignarEn(ws, CELLS.fechaRevision.row, CELLS.fechaRevision.col, etiquetaFechaRevision(meta.fechaRevision));
    asignarEn(
        ws,
        CELLS.fechaSuceso.row,
        CELLS.fechaSuceso.col,
        /^\d{4}-\d{2}-\d{2}$/.test(rep.fechaSuceso)
            ? formatearFechaDisplayGuiones(rep.fechaSuceso)
            : (rep.fechaSuceso || ''),
        'center'
    );
    asignarEn(ws, CELLS.empresaAfectada.row, CELLS.empresaAfectada.col, rep.empresaAfectada || '', 'left');
    asignarEn(ws, CELLS.nombreClienteProveedor.row, CELLS.nombreClienteProveedor.col, rep.nombreClienteProveedor || '', 'left');
    asignarEn(ws, CELLS.nombreBien.row, CELLS.nombreBien.col, rep.nombreBien || '', 'left');
    asignarEn(ws, CELLS.descripcionSuceso.row, CELLS.descripcionSuceso.col, rep.descripcionSuceso || '', 'center', 'middle');
    asignarEn(ws, CELLS.accionesBiznaga.row, CELLS.accionesBiznaga.col, rep.accionesBiznaga || '', 'center', 'middle');
    // Firma manuscrita en papel/PDF: conservar línea de la plantilla (no capturar nombre digital).
    asignarEn(ws, CELLS.nombreFirma.row, CELLS.nombreFirma.col, '_______________________________________________', 'center');
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await obtenerBufferPlantillaSgcF22();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = resolverHojaWorkbook(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-22 no contiene hojas.');
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

function valorFechaSucesoParaSheet(fechaSuceso) {
    if (!fechaSuceso) return '';
    const display = /^\d{4}-\d{2}-\d{2}$/.test(fechaSuceso)
        ? formatearFechaDisplayGuiones(fechaSuceso)
        : String(fechaSuceso).trim();
    // Prefijo ' evita que Sheets convierta a fecha serial (y pierda alineación/formato).
    return display ? `'${display}` : '';
}

function datosAActualizacionesSheet(datos, sheetTitle = SHEET_TITLE) {
    const meta = sanitizarDatos(datos);
    const rep = resolverReporteActivo(meta);
    const actualizaciones = [];

    pushUpdate(actualizaciones, CELLS.revision.row, CELLS.revision.col,
        `Revisión: ${meta.revision || '00'}`, sheetTitle);
    pushUpdate(actualizaciones, CELLS.fechaRevision.row, CELLS.fechaRevision.col,
        etiquetaFechaRevision(meta.fechaRevision), sheetTitle);
    pushUpdate(
        actualizaciones,
        CELLS.fechaSuceso.row,
        CELLS.fechaSuceso.col,
        valorFechaSucesoParaSheet(rep.fechaSuceso),
        sheetTitle
    );
    pushUpdate(actualizaciones, CELLS.empresaAfectada.row, CELLS.empresaAfectada.col,
        rep.empresaAfectada || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.nombreClienteProveedor.row, CELLS.nombreClienteProveedor.col,
        rep.nombreClienteProveedor || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.nombreBien.row, CELLS.nombreBien.col,
        rep.nombreBien || '', sheetTitle);
    pushUpdate(actualizaciones, CELLS.descripcionSuceso.row, CELLS.descripcionSuceso.col,
        normalizarSaltosLinea(rep.descripcionSuceso), sheetTitle);
    pushUpdate(actualizaciones, CELLS.accionesBiznaga.row, CELLS.accionesBiznaga.col,
        normalizarSaltosLinea(rep.accionesBiznaga), sheetTitle);
    // Firma manuscrita: restaurar línea de plantilla (no sobrescribir con nombre digital).
    pushUpdate(actualizaciones, CELLS.nombreFirma.row, CELLS.nombreFirma.col,
        '_______________________________________________', sheetTitle);

    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    const titulo = sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId);
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    try {
        await driveService.aplicarFormatoVisualSgcF22(spreadsheetId, titulo);
    } catch (err) {
        console.warn('[SGC-F-22] No se pudo aplicar formato visual:', err.message);
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
        console.warn('[SGC-F-22] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
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
            'Plantilla SGC-F-22 no encontrada en Drive. Compártela con la cuenta del sistema (risktechbiznaga@gmail.com) como Editor.'
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
                    console.warn('[SGC-F-22] No se pudo renombrar hoja plantilla:', err.message);
                }
            }
            return true;
        }
        if (titulos.length) {
            try {
                await driveService.duplicarHojaGoogleSheet(spreadsheetId, titulos[0], SHEET_TITLE);
                return true;
            } catch (err) {
                console.warn('[SGC-F-22] No se pudo crear hoja Plantilla:', err.message);
            }
        }
        return false;
    } catch (err) {
        console.warn('[SGC-F-22] No se pudo asegurar hoja Plantilla:', err.message);
        return false;
    }
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
            { fallbackRegex: /plantilla/i }
        );
        if (!plantillaOrigen) {
            console.warn(
                `[SGC-F-22] No hay hoja plantilla para crear "${objetivo}". `
                + `Hojas: ${titulos.join(', ') || '(ninguna)'}`
            );
            return false;
        }

        const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaOrigen, objetivo);
        const tituloFinal = dup?.title || objetivo;
        await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloFinal);
        return true;
    } catch (err) {
        console.warn(`[SGC-F-22] No se pudo asegurar hoja "${objetivo}":`, err.message);
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
            console.warn('[SGC-F-22] No se pudo resolver gid de hoja editor:', err.message);
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
            console.warn('[SGC-F-22] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio && existentes.id !== DRIVE_FILE_ID_SISTEMA) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-22] No se pudo eliminar duplicado en Drive:', err.message);
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
            // Si BD ya tiene archivero, preferir BD; Drive solo aporta meta de revisión si hace falta.
            if (datosDb && Array.isArray(datosDb.reportes)) {
                datos = sanitizarDatos(datosDb);
            } else {
                // BD vacía: no inventar reportes desde Plantilla; arrancar con lista vacía.
                const buffer = await descargarBufferDrive(driveFileId);
                const lectura = await leerDatosDesdeBuffer(buffer, { sheetTitle: SHEET_TITLE });
                const metaDrive = sanitizarDatos(lectura.datos);
                datos = sanitizarDatos({
                    revision: metaDrive.revision || DATOS_DEFECTO.revision,
                    fechaRevision: metaDrive.fechaRevision || DATOS_DEFECTO.fechaRevision,
                    fechaElaboracion: metaDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
                    reportes: [],
                    reporteActivoId: null
                });
            }
        } catch (err) {
            console.warn('[SGC-F-22] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = datosDb;
    if (!datos) {
        try {
            const desdePlantilla = await leerDatosDesdePlantilla();
            datos = sanitizarDatos({
                ...desdePlantilla,
                reportes: [],
                reporteActivoId: null
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
            console.warn('[SGC-F-22] No se pudo rehidratar datos en Drive desde BD:', err.message);
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
            console.warn('[SGC-F-22] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
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
                await sincronizarHojasReportesEnDrive(driveId, datosEntrada, datosPrevios);
            }
        } catch (err) {
            console.warn('[SGC-F-22] No se pudo re-sincronizar hojas en Drive:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return await construirRespuesta(registroPrevio, datosEntrada, archivoDrive, {
            hojaEditor: resolverNombreHojaReporte(datosEntrada)
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
                return await construirRespuesta(registro, datosGuardar, archivoDrive, {
                    hojaEditor: resolverNombreHojaReporte(datosGuardar)
                });
            }
        } catch (err) {
            console.warn('[SGC-F-22] No se pudo actualizar Google Sheet:', err.message);
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
            await sincronizarHojasReportesEnDrive(copia.id, datosGuardar, datosPrevios);
            archivoDrive = await driveService.obtenerInfoArchivo(copia.id).catch(() => copia);
        }
    } catch (err) {
        console.warn('[SGC-F-22] No se pudo sincronizar con Drive; se guarda solo en BD:', err.message || err);
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
        hojaEditor: resolverNombreHojaReporte(datosGuardar)
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
        reporteActivoId: datosPrevios.reporteActivoId
    };
    const reportesActualizados = Array.isArray(datosPrevios.reportes)
        ? datosPrevios.reportes.map((r) => ({ ...r }))
        : [];

    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
        for (const titulo of titulos) {
            if (!esHojaReporteSgcF22(titulo)) continue;
            try {
                const lectura = await leerDatosDesdeHojaGoogleSheet(driveFileId, titulo);
                const repLeido = resolverReporteActivo(lectura.datos);
                const idx = reportesActualizados.findIndex((r) => {
                    const hojaEsperada = resolverNombreHojaReporte(datosConReporteActivo(datosPrevios, r));
                    return hojaEsperada === titulo
                        || sanitizarNombreHojaFolio(r.folio) === sanitizarNombreHojaFolio(repLeido.folio)
                        || (sanitizarNombreHojaFolio(titulo) === sanitizarNombreHojaFolio(r.folio));
                });
                if (idx >= 0) {
                    reportesActualizados[idx] = sanitizarReporte({
                        ...reportesActualizados[idx],
                        ...repLeido,
                        id: reportesActualizados[idx].id,
                        folio: reportesActualizados[idx].folio || repLeido.folio || titulo,
                        pdfFirmado: reportesActualizados[idx].pdfFirmado
                    });
                }
            } catch (err) {
                console.warn(`[SGC-F-22] No se pudo leer hoja "${titulo}" desde Drive:`, err.message);
            }
        }
    } catch (err) {
        console.warn('[SGC-F-22] No se pudieron listar hojas al sincronizar desde Drive:', err.message);
    }

    const datosDrive = sanitizarDatos({
        ...metaBase,
        reportes: reportesActualizados
    });

    if (necesitaRehidratarDriveDesdeDb(datosDrive, datosPrevios)) {
        try {
            await sincronizarHojasReportesEnDrive(driveFileId, datosPrevios, datosPrevios);
        } catch (err) {
            console.warn('[SGC-F-22] No se pudo rehidratar datos en Drive desde BD:', err.message);
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

    // Conservar el spreadsheet sistema; no borrar ni recopiar.
    let driveIdGuardado = await resolverDriveFileId(registro);
    let archivoDrive = null;

    try {
        if (!driveIdGuardado) {
            const info = await crearCopiaPlantillaEnCarpeta(pool, registro);
            driveIdGuardado = info?.id || DRIVE_FILE_ID_SISTEMA;
        }
        await asegurarHojaPlantillaEnDrive(driveIdGuardado);
        try {
            await driveService.aplicarFormatoVisualSgcF22(driveIdGuardado, SHEET_TITLE);
        } catch (errFmt) {
            console.warn('[SGC-F-22] Formato visual Plantilla:', errFmt.message);
        }
        await sincronizarHojasReportesEnDrive(driveIdGuardado, datosPublicar, datos);
        archivoDrive = await driveService.obtenerInfoArchivo(driveIdGuardado)
            .catch(() => ({ id: driveIdGuardado }));
        console.log(`[SGC-F-22] Plantilla re-sincronizada en spreadsheet sistema ${driveIdGuardado}`);
    } catch (err) {
        console.warn('[SGC-F-22] Drive no disponible al actualizar plantilla:', err.message);
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
        hojaEditor: resolverNombreHojaReporte(datosPublicar)
    });
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-22 ${tag} - ${mm}/${yy}.pdf`;
}

async function publicarPdfEnDrive(pdfBuffer, folio) {
    const nombreArchivo = nombrePdfHistorial(folio);
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const reporteId = String(body?.reporteId || body?.reporte_id || '').trim();
    const folioBuscado = String(body?.folio || '').trim().toUpperCase();
    const snapshot = body?.reporte && typeof body.reporte === 'object' ? body.reporte : null;
    if (!reporteId && !folioBuscado && !snapshot) {
        throw new Error('Se requiere reporteId, folio o datos del reporte para asociar el PDF firmado.');
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const reportes = Array.isArray(datosPrevios.reportes) ? [...datosPrevios.reportes] : [];

    let idx = reporteId ? reportes.findIndex((r) => r.id === reporteId) : -1;
    if (idx < 0 && folioBuscado) {
        idx = reportes.findIndex((r) => String(r.folio || '').trim().toUpperCase() === folioBuscado);
    }
    // Si el reporte solo existe en el frontend (aún no persistido), lo insertamos/upsertamos.
    if (idx < 0 && snapshot) {
        const nuevo = sanitizarReporte({
            ...snapshot,
            id: reporteId || snapshot.id || nuevoIdReporte(),
            folio: folioBuscado || snapshot.folio || ''
        });
        reportes.unshift(nuevo);
        idx = 0;
    }
    if (idx < 0) {
        throw new Error(
            'No se encontró el reporte indicado en el archivero. '
            + 'Guarda la información del formato y vuelve a intentar subir el PDF.'
        );
    }

    const reporteActual = reportes[idx];
    const driveResult = await publicarPdfEnDrive(pdfBuffer, reporteActual.folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(reporteActual.folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    reportes[idx] = { ...reporteActual, pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        reportes,
        reporteActivoId: reportes[idx].id
    });

    const driveFileId = await resolverDriveFileId(registroPrevio) || registroPrevio?.drive_file_id || null;

    await guardarRegistroDb(pool, {
        driveFileId,
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
    CARPETA_PDF_FIRMADOS_ID,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    sanitizarDatos
};
