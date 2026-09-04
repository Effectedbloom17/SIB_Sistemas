/**
 * SGC-F-18 · Tabla de requisitos legales y reglamentarios — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-18';
const TEMPLATE_DRIVE_ID = '168hssf8Gj1hfrzQ0sYqQB7JxO9IwmmzV';
const DRIVE_FILE_ID_SISTEMA = '11gAj4_45wIIxbc6-tb64lH9FotFfgMrpUqBwn7Cwiq8';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-18 Tabla de requisitos legales (sistema)';
const SHEET_TITLE = 'Requisitos legales';

const HEADER_ROW = 7;
const DATA_START_ROW = 8;
const REVISION_ROW = 4;
const FECHA_REV_ROW = 5;
const FECHA_REVISION_INFO_ROW = 30;

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
    fechaRevision: '2025-07-03',
    fechaElaboracion: '2025-07-03',
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

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filasRaw = Array.isArray(base.filas) ? base.filas : DATOS_DEFECTO.filas;
    const filas = filasRaw.map(sanitizarFila).filter((f) => f.nombre);
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevisionInformacion: String(base.fechaRevisionInformacion || '').trim(),
        filas: filas.length ? filas : DATOS_DEFECTO.filas.map(sanitizarFila)
    };
}

function encontrarFilaFinDatos(ws) {
    for (let r = DATA_START_ROW; r <= Math.max(ws.rowCount, FECHA_REVISION_INFO_ROW); r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL.nombre).value).toLowerCase();
        if (txt.includes('fecha de revision') || txt.includes('fecha de revisión')) {
            return r;
        }
        if (r > DATA_START_ROW && !txt && !celdaATexto(ws.getRow(r).getCell(COL.emite).value)) {
            const prev = celdaATexto(ws.getRow(r - 1).getCell(COL.nombre).value);
            if (prev) return r;
        }
    }
    return FECHA_REVISION_INFO_ROW;
}

function parsearDatosDesdeHoja(ws) {
    const filaFin = encontrarFilaFinDatos(ws);
    const filas = [];

    for (let r = DATA_START_ROW; r < filaFin; r++) {
        const row = ws.getRow(r);
        const nombre = celdaATexto(row.getCell(COL.nombre).value);
        if (!nombre) continue;
        if (nombre.toLowerCase().includes('nombre de la ley')) continue;

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

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(COL.nombre).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(COL.nombre).value);
    const fechaRevMatch = fechaRevText.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);

    let fechaRevisionInfo = '';
    const filaInfo = ws.getRow(FECHA_REVISION_INFO_ROW);
    fechaRevisionInfo = celdaATexto(filaInfo.getCell(COL.nombre).value);
    if (fechaRevisionInfo.toLowerCase().includes('fecha de revision')) {
        fechaRevisionInfo = celdaATexto(filaInfo.getCell(COL.emite).value)
            || celdaATexto(filaInfo.getCell(COL.documento).value);
    }

    return sanitizarDatos({
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: fechaRevMatch ? formatearFechaIso(fechaRevMatch[1]) : DATOS_DEFECTO.fechaElaboracion,
        fechaRevisionInformacion: fechaRevisionInfo,
        filas: filas.length ? filas : DATOS_DEFECTO.filas
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla SGC-F-18 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
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
    } catch (err) {
        return driveService.descargarArchivo(fileId);
    }
}

function asignarTexto(celda, texto) {
    celda.value = normalizarSaltosLinea(texto);
    celda.alignment = { ...(celda.alignment || {}), vertical: 'middle', wrapText: true };
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-18 no contiene hojas.');

    const filaFin = encontrarFilaFinDatos(ws);
    const filasDisponibles = Math.max(0, filaFin - DATA_START_ROW);
    if (datos.filas.length > filasDisponibles) {
        ws.spliceRows(filaFin, 0, ...Array.from({ length: datos.filas.length - filasDisponibles }, () => []));
    }

    const filaFinActual = encontrarFilaFinDatos(ws);
    for (let r = DATA_START_ROW; r < filaFinActual; r++) {
        const row = ws.getRow(r);
        for (let c = COL.nombre; c <= COL.observaciones; c++) {
            row.getCell(c).value = null;
        }
    }

    ws.getRow(REVISION_ROW).getCell(COL.nombre).value = `Revisión: ${datos.revision || '00'}`;
    ws.getRow(FECHA_REV_ROW).getCell(COL.nombre).value =
        `Fecha de rev.: ${formatearFechaDisplay(datos.fechaRevision)}`;

    datos.filas.forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        asignarTexto(row.getCell(COL.nombre), fila.nombre);
        asignarTexto(row.getCell(COL.emite), fila.emite);
        asignarTexto(row.getCell(COL.fechaVigor), fila.fechaVigor);
        asignarTexto(row.getCell(COL.documento), fila.documento);
        asignarTexto(row.getCell(COL.vigencia), fila.vigencia);
        asignarTexto(row.getCell(COL.responsable), fila.responsable);
        asignarTexto(row.getCell(COL.observaciones), fila.observaciones);
    });

    if (datos.fechaRevisionInformacion) {
        const infoRow = ws.getRow(FECHA_REVISION_INFO_ROW);
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

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA && await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA)) {
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

function construirRespuesta(registro, datos, archivoDrive) {
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
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
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
}

async function aplicarHistorialSgcF18(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente: datosSonEquivalentes,
        estructuraEsEquivalente: excelHistorial.estructuraFilasEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function publicarDatosEnGoogleSheet(spreadsheetId, datos) {
    const buffer = await escribirDatosEnPlantilla(datos);
    await excelHistorial.escribirSnapshotDesdeBufferPlantilla(spreadsheetId, SHEET_TITLE, buffer);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
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
            console.warn('[SGC-F-18] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 11, keepSingleSheet: true }
    );
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

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-18] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = await leerDatosRegistro(registro);
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
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
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

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF18({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = hist.datosGuardar;

                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = hist.tipoCambio === 'formato'
                        ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
                        : fechaCambio;
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                const archivoDrive = await driveService
                    .obtenerInfoArchivo(driveId)
                    .catch(() => ({ id: driveId }));
                if (!hist.aplicado) {
                    await publicarDatosEnGoogleSheet(driveId, datosGuardar);
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
            console.warn('[SGC-F-18] No se pudo actualizar Google Sheet, reemplazando archivo:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(archivoDrive.id, SHEET_TITLE)
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
    if (!driveFileId) {
        throw new Error('No hay archivo SGC-F-18 en Drive para sincronizar.');
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

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-18] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 11, keepSingleSheet: true }
    );

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
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
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos
};
