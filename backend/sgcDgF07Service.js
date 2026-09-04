/**
 * DG-F-07 · Caracterización de procesos — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'DG-F-07';
const TEMPLATE_DRIVE_ID = '1Iyr5StRrsuDWHkSN-7MbiLswUwb01kzO';
const CARPETA_DRIVE_ID = '1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4';
const NOMBRE_ARCHIVO_DRIVE = 'DG-F-07 Caracterización de procesos (sistema)';

const ROW_NOMBRE = 6;
const ROW_OBJETIVO = 10;
const ROW_FLUJO = 13;
const ROW_IO_START = 16;
const COL_NOMBRE = 1;
const COL_RESP = 7;
const COL_SIG = 6;
const COL_VALOR = 3;

const PROCESOS_MAP = [
    { slug: 'planeacion-estrategica', sheetTitle: 'Planeación estratégica' },
    { slug: 'liderazgo', sheetTitle: 'Liderazgo' },
    { slug: 'seg-med-an-y-eval', sheetTitle: 'Seg, med, an y eval.' },
    { slug: 'satisfaccion-del-cliente', sheetTitle: 'Satisfacción del cliente' },
    { slug: 'auditoria-interna', sheetTitle: 'Auditoría Interna' },
    { slug: 'nc-y-ac', sheetTitle: 'NC y AC' },
    { slug: 'revision-por-la-dir', sheetTitle: 'Revisión por la Dir.' },
    { slug: 'mejora-continua', sheetTitle: 'Mejora continua' },
    { slug: 'cotizacion', sheetTitle: 'Cotización' },
    { slug: 'contrato', sheetTitle: 'Contrato' },
    { slug: 'pago-y-facturacion', sheetTitle: 'Pago y facturación' },
    { slug: 'planeacion', sheetTitle: 'Planeación' },
    { slug: 'consul-estrategica', sheetTitle: 'Consul. Estratégica' },
    { slug: 'cap-empresarial', sheetTitle: 'Cap. Empresarial' },
    { slug: 'tramites', sheetTitle: 'Trámites' },
    { slug: 'medicion-tierras-fisicas', sheetTitle: 'Medición tierras físicas' },
    { slug: 'verificacion-ruido', sheetTitle: 'Verificación ruido' },
    { slug: 'verificacion-iluminacion', sheetTitle: 'Verificación iluminación' },
    { slug: 'salud-ocupacional', sheetTitle: 'Salud ocupacional' },
    { slug: 'proteccion-civil', sheetTitle: 'Protección civil' },
    { slug: 'proveeduria-externa', sheetTitle: 'Proveeduría externa' },
    { slug: 'reclutamiento-sel-y-cont', sheetTitle: 'Reclutamiento sel y cont' },
    { slug: 'competencia-y-cap', sheetTitle: 'Competencia y cap.' },
    { slug: 'manto-infraestructura', sheetTitle: 'Manto. infraestructura' },
    { slug: 'control-de-documentos', sheetTitle: 'Control de documentos' },
    { slug: 'comunicacion', sheetTitle: 'Comunicación' },
    { slug: 'ambiente-para-la-opera', sheetTitle: 'Ambiente para la opera.' },
    { slug: 'toma-de-conciencia', sheetTitle: 'Toma de conciencia' },
    { slug: 'conocimientos-de-la-org', sheetTitle: 'Conocimientos de la org.' },
    { slug: 'recursos-de-medicion', sheetTitle: 'Recursos de medición' }
];

const SHEET_BY_SLUG = Object.fromEntries(PROCESOS_MAP.map((p) => [p.slug, p.sheetTitle]));
const SLUG_BY_SHEET = Object.fromEntries(PROCESOS_MAP.map((p) => [p.sheetTitle, p.slug]));

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return valor.toISOString().slice(0, 10);
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
    }
    return normalizarSaltosLinea(String(valor));
}

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\|/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function lineasDesdeTexto(texto) {
    return normalizarSaltosLinea(texto)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

function textoDesdeLineas(lineas) {
    return (Array.isArray(lineas) ? lineas : [])
        .map((l) => String(l || '').trim())
        .filter(Boolean)
        .join('\n');
}

function escaparTituloSheet(titulo) {
    return String(titulo || '').replace(/'/g, "''");
}

function rangoSheet(sheetTitle, celda) {
    return `'${escaparTituloSheet(sheetTitle)}'!${celda}`;
}

function leerCelda(row, col) {
    return celdaATexto(row.getCell(col).value);
}

function encontrarFilasSeccion(ws) {
    let recursosRow = null;
    let criteriosRow = null;
    let indicadoresRow = null;

    for (let r = 1; r <= Math.max(ws.rowCount, 50); r++) {
        const a = leerCelda(ws.getRow(r), COL_NOMBRE).toUpperCase();
        if (!recursosRow && a === 'RECURSOS') recursosRow = r;
        if (!criteriosRow && a.includes('CRITERIOS') && a.includes('MÉTODOS')) criteriosRow = r;
        if (!indicadoresRow && a === 'INDICADORES') indicadoresRow = r;
    }

    return {
        recursosRow: recursosRow || ROW_IO_START + 5,
        criteriosRow: criteriosRow || (recursosRow || ROW_IO_START + 5) + 3,
        indicadoresRow: indicadoresRow || (criteriosRow || ROW_IO_START + 8) + 3
    };
}

function sanitizarProceso(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const entradasRaw = base.entradas;
    const salidasRaw = base.salidas;
    return {
        nombreProceso: String(base.nombreProceso || '').trim(),
        responsable: String(base.responsable || '').trim(),
        objetivo: String(base.objetivo || '').trim(),
        procesoAnterior: String(base.procesoAnterior || '').trim(),
        procesoSiguiente: String(base.procesoSiguiente || '').trim(),
        entradas: Array.isArray(entradasRaw) ? textoDesdeLineas(entradasRaw) : normalizarSaltosLinea(entradasRaw),
        salidas: Array.isArray(salidasRaw) ? textoDesdeLineas(salidasRaw) : normalizarSaltosLinea(salidasRaw),
        recursos: String(base.recursos || '').trim(),
        criteriosMetodos: String(base.criteriosMetodos || '').trim(),
        indicadores: String(base.indicadores || '').trim()
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const fuente = base.procesos && typeof base.procesos === 'object' ? base.procesos : base;
    const procesos = {};
    for (const { slug } of PROCESOS_MAP) {
        procesos[slug] = sanitizarProceso(fuente[slug] || {});
    }
    return { procesos };
}

function parsearProcesoDesdeHoja(ws) {
    const layout = encontrarFilasSeccion(ws);
    const entradas = [];
    const salidas = [];

    for (let r = ROW_IO_START; r < layout.recursosRow; r++) {
        const entrada = leerCelda(ws.getRow(r), COL_NOMBRE);
        const salida = leerCelda(ws.getRow(r), COL_SIG);
        if (entrada) entradas.push(entrada);
        if (salida) salidas.push(salida);
    }

    return sanitizarProceso({
        nombreProceso: leerCelda(ws.getRow(ROW_NOMBRE), COL_NOMBRE),
        responsable: leerCelda(ws.getRow(ROW_NOMBRE), COL_RESP),
        objetivo: leerCelda(ws.getRow(ROW_OBJETIVO), COL_NOMBRE),
        procesoAnterior: leerCelda(ws.getRow(ROW_FLUJO), COL_NOMBRE),
        procesoSiguiente: leerCelda(ws.getRow(ROW_FLUJO), COL_SIG)
            || leerCelda(ws.getRow(ROW_FLUJO), COL_RESP),
        entradas,
        salidas,
        recursos: leerCelda(ws.getRow(layout.recursosRow), COL_VALOR),
        criteriosMetodos: leerCelda(ws.getRow(layout.criteriosRow), COL_VALOR),
        indicadores: leerCelda(ws.getRow(layout.indicadoresRow), COL_VALOR)
    });
}

function asignarTextoMultilinea(celda, texto) {
    const valor = normalizarSaltosLinea(texto);
    celda.value = valor;
    if (valor) {
        celda.alignment = {
            ...(celda.alignment || {}),
            vertical: 'middle',
            wrapText: true
        };
    }
}

function asignarTextoSimple(celda, texto) {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = {
        ...(celda.alignment || {}),
        vertical: 'middle',
        wrapText: true
    };
}

function escribirProcesoEnHoja(ws, proceso) {
    const layout = encontrarFilasSeccion(ws);
    const entradas = lineasDesdeTexto(proceso.entradas);
    const salidas = lineasDesdeTexto(proceso.salidas);
    const maxFilasIo = Math.max(entradas.length, salidas.length, 1);
    const filasDisponibles = Math.max(1, layout.recursosRow - ROW_IO_START);

    if (maxFilasIo > filasDisponibles) {
        const extra = maxFilasIo - filasDisponibles;
        ws.spliceRows(layout.recursosRow, 0, ...Array.from({ length: extra }, () => []));
    }

    const layoutActual = encontrarFilasSeccion(ws);

    asignarTextoSimple(ws.getRow(ROW_NOMBRE).getCell(COL_NOMBRE), proceso.nombreProceso);
    asignarTextoSimple(ws.getRow(ROW_NOMBRE).getCell(COL_RESP), proceso.responsable);
    asignarTextoMultilinea(ws.getRow(ROW_OBJETIVO).getCell(COL_NOMBRE), proceso.objetivo);
    asignarTextoSimple(ws.getRow(ROW_FLUJO).getCell(COL_NOMBRE), proceso.procesoAnterior);
    asignarTextoSimple(ws.getRow(ROW_FLUJO).getCell(COL_SIG), proceso.procesoSiguiente);

    for (let r = ROW_IO_START; r < layoutActual.recursosRow; r++) {
        ws.getRow(r).getCell(COL_NOMBRE).value = null;
        ws.getRow(r).getCell(COL_SIG).value = null;
    }

    const totalFilas = Math.max(entradas.length, salidas.length, 1);
    for (let i = 0; i < totalFilas; i++) {
        const row = ws.getRow(ROW_IO_START + i);
        asignarTextoMultilinea(row.getCell(COL_NOMBRE), entradas[i] || '');
        asignarTextoMultilinea(row.getCell(COL_SIG), salidas[i] || '');
    }

    asignarTextoSimple(ws.getRow(layoutActual.recursosRow).getCell(COL_VALOR), proceso.recursos);
    asignarTextoMultilinea(
        ws.getRow(layoutActual.criteriosRow).getCell(COL_VALOR),
        proceso.criteriosMetodos
    );
    asignarTextoMultilinea(
        ws.getRow(layoutActual.indicadoresRow).getCell(COL_VALOR),
        proceso.indicadores
    );
}

async function leerDatosDesdeBuffer(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const procesos = {};

    for (const ws of wb.worksheets) {
        const slug = SLUG_BY_SHEET[ws.name];
        if (!slug) continue;
        procesos[slug] = parsearProcesoDesdeHoja(ws);
    }

    for (const { slug } of PROCESOS_MAP) {
        if (!procesos[slug]) {
            procesos[slug] = sanitizarProceso({});
        }
    }

    return sanitizarDatos({ procesos });
}

async function leerDatosDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    return leerDatosDesdeBuffer(buffer);
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

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);

    for (const { slug, sheetTitle } of PROCESOS_MAP) {
        const ws = wb.getWorksheet(sheetTitle);
        if (!ws) continue;
        escribirProcesoEnHoja(ws, datos.procesos[slug] || sanitizarProceso({}));
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function datosProcesoAActualizaciones(sheetTitle, proceso, layout) {
    const actualizaciones = [];
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `A${ROW_NOMBRE}`),
        values: [[proceso.nombreProceso || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `G${ROW_NOMBRE}`),
        values: [[proceso.responsable || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `A${ROW_OBJETIVO}`),
        values: [[proceso.objetivo || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `A${ROW_FLUJO}`),
        values: [[proceso.procesoAnterior || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `F${ROW_FLUJO}`),
        values: [[proceso.procesoSiguiente || '']]
    });

    const entradas = lineasDesdeTexto(proceso.entradas);
    const salidas = lineasDesdeTexto(proceso.salidas);
    const filasDisponibles = Math.max(1, layout.recursosRow - ROW_IO_START);
    const totalFilas = Math.max(entradas.length, salidas.length, filasDisponibles);

    for (let i = 0; i < totalFilas; i++) {
        const rowNum = ROW_IO_START + i;
        actualizaciones.push({
            range: rangoSheet(sheetTitle, `A${rowNum}`),
            values: [[entradas[i] || '']]
        });
        actualizaciones.push({
            range: rangoSheet(sheetTitle, `F${rowNum}`),
            values: [[salidas[i] || '']]
        });
    }

    actualizaciones.push({
        range: rangoSheet(sheetTitle, `C${layout.recursosRow}`),
        values: [[proceso.recursos || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `C${layout.criteriosRow}`),
        values: [[proceso.criteriosMetodos || '']]
    });
    actualizaciones.push({
        range: rangoSheet(sheetTitle, `C${layout.indicadoresRow}`),
        values: [[proceso.indicadores || '']]
    });

    return actualizaciones;
}

async function obtenerLayoutsPorHojaDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const layouts = {};

    for (const { slug, sheetTitle } of PROCESOS_MAP) {
        const ws = wb.getWorksheet(sheetTitle);
        if (!ws) continue;
        layouts[slug] = {
            sheetTitle,
            ...encontrarFilasSeccion(ws)
        };
    }

    return layouts;
}

function datosAActualizacionesSheet(datos, layouts) {
    const actualizaciones = [];
    for (const { slug, sheetTitle } of PROCESOS_MAP) {
        const layout = layouts[slug] || {
            sheetTitle,
            recursosRow: 21,
            criteriosRow: 24,
            indicadoresRow: 27
        };
        actualizaciones.push(
            ...datosProcesoAActualizaciones(
                layout.sheetTitle || sheetTitle,
                datos.procesos[slug] || sanitizarProceso({}),
                layout
            )
        );
    }
    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos) {
    const layouts = await obtenerLayoutsPorHojaDesdePlantilla();
    const actualizaciones = datosAActualizacionesSheet(datos, layouts);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        return id && id !== excluirId && name.startsWith(objetivo);
    });

    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[DG-F-07] No se pudo eliminar copia en Drive:', err.message);
        }
    }
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
            console.warn('[DG-F-07] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[DG-F-07] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { keepSingleSheet: false, maxColumns: 26 }
    );
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

function formatearDatetimeMysqlMexico(valor) {
    if (valor == null || valor === '') return null;
    if (valor instanceof Date) return formatearInstanteMexico(valor);
    const texto = String(valor).trim();
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(texto)) return texto;
    const d = new Date(texto);
    if (Number.isNaN(d.getTime())) return texto;
    return formatearInstanteMexico(d);
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

function fechaHoyMexicoIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
}

async function crearHistorialMensualDrive(spreadsheetId, datos) {
    if (!spreadsheetId) {
        return { aplicado: false, hojasCreadas: 0 };
    }

    const baseHistorial = excelHistorial.nombreHojaHistorialInformacion(CODIGO_FORMATO, fechaHoyMexicoIso());
    const layouts = await obtenerLayoutsPorHojaDesdePlantilla();
    let hojasCreadas = 0;

    for (const { slug, sheetTitle } of PROCESOS_MAP) {
        try {
            const nombreHistorial = `${baseHistorial} - ${sheetTitle}`;
            const { title: hojaNueva } = await driveService.duplicarHojaGoogleSheet(
                spreadsheetId,
                sheetTitle,
                nombreHistorial
            );
            const layoutBase = layouts[slug] || {
                recursosRow: 21,
                criteriosRow: 24,
                indicadoresRow: 27
            };
            const actualizaciones = datosProcesoAActualizaciones(
                hojaNueva,
                datos.procesos[slug] || sanitizarProceso({}),
                { ...layoutBase, sheetTitle: hojaNueva }
            );
            await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
            hojasCreadas += 1;
        } catch (err) {
            console.warn(`[DG-F-07] No se pudo crear historial de "${sheetTitle}":`, err.message);
        }
    }

    return { aplicado: hojasCreadas > 0, hojasCreadas };
}

function construirRespuesta(registro, datos, archivoDrive) {
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    return {
        codigo: CODIGO_FORMATO,
        datos,
        fechaElaboracionOriginal: null,
        fechaModificacionContenido: null,
        contenidoModificado: !!registro?.contenido_modificado,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function resolverDriveFileId(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
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

function datosSonEquivalentes(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
}

function procesoTieneContenido(proceso) {
    if (!proceso) {
        return false;
    }
    return Boolean(
        String(proceso.nombreProceso || '').trim()
        || String(proceso.responsable || '').trim()
        || String(proceso.objetivo || '').trim()
        || String(proceso.procesoAnterior || '').trim()
        || String(proceso.procesoSiguiente || '').trim()
        || String(proceso.entradas || '').trim()
        || String(proceso.salidas || '').trim()
        || String(proceso.recursos || '').trim()
        || String(proceso.criteriosMetodos || '').trim()
        || String(proceso.indicadores || '').trim()
    );
}

function datosEstanVacios(datos) {
    const procesos = datos?.procesos || {};
    return !Object.values(procesos).some(procesoTieneContenido);
}

async function asegurarCopiaTrabajoDrive(pool, datos, driveFileIdPrevio = null) {
    const buffer = await escribirDatosEnPlantilla(datos);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveFileIdPrevio);
    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: null,
        fechaModificacionContenido: null,
        contenidoModificado: false
    });
    return archivoDrive;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;
    let driveFileId = await resolverDriveFileId(registro);

    if (registro?.drive_file_id && !driveFileId) {
        console.warn('[DG-F-07] La copia (sistema) en Drive ya no existe; se regenerará desde la plantilla maestra.');
        registro = {
            ...registro,
            drive_file_id: null
        };
    }

    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb && !datosEstanVacios(datosDb) ? datosDb : await leerDatosDesdePlantilla(),
            fechaElaboracionOriginal: null,
            fechaModificacionContenido: null,
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
            console.warn('[DG-F-07] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
            driveFileId = null;
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }

    if (!datos || datosEstanVacios(datos)) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch (err) {
            console.warn('[DG-F-07] No se pudo leer la plantilla maestra:', err.message);
            datos = sanitizarDatos({});
        }
    }

    if (!driveFileId) {
        try {
            archivoDrive = await asegurarCopiaTrabajoDrive(pool, datos, null);
            driveFileId = archivoDrive.id;
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[DG-F-07] No se pudo crear la copia (sistema) en Drive:', err.message);
            await guardarRegistroDb(pool, {
                driveFileId: null,
                datos,
                fechaElaboracionOriginal: null,
                fechaModificacionContenido: null,
                contenidoModificado: false
            });
            registro = await obtenerRegistroDb(pool);
        }
    } else if (datos && registro && datosEstanVacios(await leerDatosRegistro(registro))) {
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: null,
            fechaModificacionContenido: null,
            contenidoModificado: false
        });
        registro = await obtenerRegistroDb(pool);
    }

    registro = {
        ...(registro || {}),
        drive_file_id: driveFileId || null
    };

    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = registroPrevio?.fecha_modificacion_contenido || null;

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
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyMexicoIso();
    }

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive);
    }

    const driveId = registroPrevio?.drive_file_id || null;

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                if (huboCambio && origen !== 'consulta') {
                    await crearHistorialMensualDrive(driveId, datosEntrada);
                }
                const archivoDrive = await actualizarDatosEnGoogleSheet(driveId, datosEntrada);
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosEntrada,
                    fechaElaboracionOriginal: null,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosEntrada, archivoDrive);
            }
        } catch (err) {
            console.warn('[DG-F-07] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosEntrada);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosEntrada,
        fechaElaboracionOriginal: null,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosEntrada, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    if (!registro?.drive_file_id) {
        return cargarFormato(pool);
    }

    // Breve espera para que Google Sheets persista ediciones del iframe antes de exportar.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const buffer = await descargarBufferDrive(registro.drive_file_id);
    const datosDrive = sanitizarDatos(await leerDatosDesdeBuffer(buffer));

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

    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosDrive);
    const contenidoModificado = huboCambio ? true : !!registro.contenido_modificado;
    const fechaModificacion = huboCambio
        ? fechaHoyMexicoIso()
        : registro.fecha_modificacion_contenido;

    if (huboCambio) {
        await crearHistorialMensualDrive(registro.drive_file_id, datosDrive);
    }

    await guardarRegistroDb(pool, {
        driveFileId: registro.drive_file_id,
        datos: datosDrive,
        fechaElaboracionOriginal: null,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService
        .obtenerInfoArchivo(registro.drive_file_id)
        .catch(() => null);

    return construirRespuesta(registroActualizado, datosDrive, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);

    let datos;
    try {
        datos = await leerDatosDesdePlantilla();
    } catch {
        datos = await leerDatosRegistro(registro);
        if (!datos || datosEstanVacios(datos)) {
            datos = sanitizarDatos({});
        }
    }

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[DG-F-07] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await eliminarCopiasDriveTrabajo();

    const buffer = await escribirDatosEnPlantilla(datos);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { keepSingleSheet: false, maxColumns: 26 }
    );

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: null,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
        contenidoModificado: !!registro?.contenido_modificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

module.exports = {
    CODIGO_FORMATO,
    PROCESOS_MAP,
    SHEET_BY_SLUG,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
