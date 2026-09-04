const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-06';
const TEMPLATE_DRIVE_ID = '172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A';
const DRIVE_FILE_ID_SISTEMA = '172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-06 Lista y calificación de auditores (sistema)';
const SHEET_TITLE = 'Hoja1';

const HEADER_LABELS = [
    'NOMBRE',
    'Puesto',
    'Tiempo en la empresa',
    'Escolaridad',
    'Curso de auditores internos',
    'Calif. Eval. Curso',
    'Nivel de objetividad e imparcialidad',
    'Desempeño',
    'Promedio',
    'Auditorias realizadas'
];

const HEADER_NORMALIZED = HEADER_LABELS.map((label) => normalizarHeader(label));
const HEADER_ROW_FALLBACK = 8;
const FECHA_EVALUACION_RANGO = 'M5:O5';
const CALIF_EVAL_COL_INICIO = 9;
const CALIF_EVAL_COL_FIN = 9;
const COLUMN_LAYOUT_FALLBACK = {
    NOMBRE: 2,
    Puesto: 4,
    'Tiempo en la empresa': 5,
    Escolaridad: 6,
    'Curso de auditores internos': 7,
    'Calif. Eval. Curso': CALIF_EVAL_COL_INICIO,
    'Nivel de objetividad e imparcialidad': 10,
    Desempeño: 11,
    Promedio: 12,
    'Auditorias realizadas': 13
};
const HEADER_ALIASES = {
    cursoauditores: 'Curso de auditores internos',
    cursoauditoresinternos: 'Curso de auditores internos',
    internos: 'Curso de auditores internos',
    desempeno: 'Desempeño'
};
const DATA_FIRST_ROW = 10;
const DATA_ROW_COUNT = 10;
const MAX_COLUMNAS_SISTEMA = HEADER_LABELS.length + 2;
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: true
};

const DATOS_DEFECTO = {
    resumen: {
        activos: 0,
        acreditados: 0,
        enEntrenamiento: 0
    },
    auditores: Array.from({ length: 10 }, () => ({
        nombre: '',
        puesto: '',
        tiempoEmpresa: '',
        escolaridad: '',
        cursoAuditoresInternos: '',
        calificacionCurso: null,
        nivelObjetividad: '',
        desempeno: '',
        promedio: null,
        auditoriasRealizadas: 0
    }))
};

function normalizarHeader(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z0-9]/g, '');
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

function valorNumerico(valor) {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).replace(',', '.').trim();
    if (!texto) return null;
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
}

function redondearPromedio(valor) {
    if (!Number.isFinite(valor)) return null;
    return Math.round(valor * 10) / 10;
}

function calcularPromedioAuditor(auditor) {
    const calif = valorNumerico(auditor?.calificacionCurso);
    const nivel = valorNumerico(auditor?.nivelObjetividad);
    const desempeno = valorNumerico(auditor?.desempeno);
    if (calif === null || nivel === null || desempeno === null) {
        return null;
    }
    return redondearPromedio((calif + nivel + desempeno) / 3);
}

function normalizarCursoAuditoresInternos(valor) {
    const estado = String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (estado === 'aprobado' || estado === 'a') {
        return 'Aprobado';
    }
    if (
        estado === 'no aprobado'
        || estado === 'reprobado'
        || estado === 'na'
        || estado === 'n/a'
    ) {
        return 'No aprobado';
    }
    return '';
}

function aplicarCalculosAuditor(auditor) {
    const fila = normalizarAuditor(auditor);
    const promedio = calcularPromedioAuditor(fila);
    return {
        ...fila,
        promedio,
        cursoAuditoresInternos: normalizarCursoAuditoresInternos(fila.cursoAuditoresInternos),
        auditoriasRealizadas: Number(fila.auditoriasRealizadas) || 0
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
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

function formatearFechaDisplay(fecha) {
    const iso = formatearFechaIso(fecha);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function valorFechaDb(fecha) {
    if (fecha === null || fecha === undefined || fecha === '') {
        return null;
    }
    const iso = formatearFechaIso(fecha);
    return iso || null;
}

function fechaEvaluacionMexicoDisplay() {
    const ahora = new Date();
    const mexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const dd = String(mexico.getDate()).padStart(2, '0');
    const mm = String(mexico.getMonth() + 1).padStart(2, '0');
    const yyyy = mexico.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function obtenerHojaDatos(wb, modo = 'vigente') {
    if (!wb) {
        return null;
    }
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        return excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || wb.getWorksheet(SHEET_TITLE)
            || wb.worksheets[0]
            || null;
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || wb.worksheets[0]
        || null;
}

async function resolverTituloHojaTrabajo(spreadsheetId, sheetTitle = null) {
    if (sheetTitle) {
        return String(sheetTitle).trim();
    }
    if (!spreadsheetId) {
        return SHEET_TITLE;
    }
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) {
        return false;
    }
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function restaurarDriveComoGoogleSheet(fileId, pool, registro = null) {
    console.log(`[SGC-F-06] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-06] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function persistirDriveFileIdEnDb(pool, driveFileId, registro = null) {
    const registroBase = registro || await obtenerRegistroDb(pool);
    const datosActuales = await leerDatosRegistro(registroBase) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosActuales,
        fechaElaboracionOriginal: valorFechaDb(registroBase?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: valorFechaDb(registroBase?.fecha_modificacion_contenido),
        contenidoModificado: !!registroBase?.contenido_modificado
    });
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
        throw new Error('No hay archivo SGC-F-06 configurado en Drive.');
    }

    try {
        const info = await driveService.obtenerInfoArchivo(idOffice);
        if (!driveService.esMimeTypeOfficeExcel(info?.mimeType)) {
            throw new Error(`Tipo de archivo no compatible: ${info?.mimeType || 'desconocido'}`);
        }
        return await restaurarDriveComoGoogleSheet(idOffice, pool, registro);
    } catch (err) {
        console.error('[SGC-F-06] No se pudo restaurar Google Sheet:', err.message);
        throw new Error(
            'El formato SGC-F-06 en Drive debe ser un Google Sheet editable. '
            + 'Verifique el ID del documento en Drive o contacte al administrador.'
        );
    }
}

function normalizarAuditor(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        nombre: String(base.nombre || '').trim(),
        puesto: String(base.puesto || base.rol || '').trim(),
        tiempoEmpresa: String(base.tiempoEmpresa || base.experiencia || '').trim(),
        escolaridad: String(base.escolaridad || '').trim(),
        cursoAuditoresInternos: normalizarCursoAuditoresInternos(
            base.cursoAuditoresInternos ||
                base.cursoAuditores ||
                (Array.isArray(base.procesos) ? base.procesos.join(', ') : '')
        ),
        calificacionCurso: valorNumerico(
            base.calificacionCurso !== undefined ? base.calificacionCurso : base.calificacion
        ),
        nivelObjetividad: String(base.nivelObjetividad || base.nivel || '').trim(),
        desempeno: String(base.desempeno || '').trim(),
        promedio: valorNumerico(
            base.promedio !== undefined ? base.promedio : base.calificacion || base.califEvaluacion
        ),
        auditoriasRealizadas: Number.isFinite(Number(base.auditoriasRealizadas))
            ? Number(base.auditoriasRealizadas)
            : (Number.isFinite(Number(base.auditorias)) ? Number(base.auditorias) : 0)
    };
}

function normalizarAuditorParaPersistencia(auditor) {
    const fila = aplicarCalculosAuditor(auditor);
    if (!auditorTieneContenido(fila)) {
        return crearAuditorVacio();
    }
    return {
        ...fila,
        auditoriasRealizadas: Number(fila.auditoriasRealizadas) || 0,
        calificacionCurso: fila.calificacionCurso !== null ? Number(fila.calificacionCurso) : null,
        promedio: fila.promedio !== null ? Number(fila.promedio) : null
    };
}

function normalizarResumen(resumen, auditores) {
    const base = resumen && typeof resumen === 'object' ? resumen : {};
    const calculado = calcularResumenDesdeAuditores(auditores);
    return {
        activos: Number.isFinite(Number(base.activos)) ? Number(base.activos) : calculado.activos,
        acreditados: Number.isFinite(Number(base.acreditados))
            ? Number(base.acreditados)
            : calculado.acreditados,
        enEntrenamiento: Number.isFinite(Number(base.enEntrenamiento))
            ? Number(base.enEntrenamiento)
            : calculado.enEntrenamiento
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const auditoresRaw = Array.isArray(base.auditores) ? base.auditores : DATOS_DEFECTO.auditores;
    let auditores = auditoresRaw.map(normalizarAuditorParaPersistencia);
    if (auditores.length === DATA_ROW_COUNT) {
        // Mantener las 10 filas del formato.
    } else if (auditores.length > 0) {
        while (auditores.length < DATA_ROW_COUNT) {
            auditores.push(normalizarAuditorParaPersistencia(crearAuditorVacio()));
        }
        auditores = auditores.slice(0, DATA_ROW_COUNT);
    } else {
        auditores = auditores.filter(auditorTieneContenido);
    }
    const datasetAuditores = auditores.length
        ? auditores
        : DATOS_DEFECTO.auditores.map(normalizarAuditor);
    return {
        resumen: normalizarResumen(base.resumen, datasetAuditores),
        auditores: datasetAuditores
    };
}

function calcularResumenDesdeAuditores(auditores) {
    const conContenido = auditores.filter(auditorTieneContenido);
    const activos = conContenido.length;
    const acreditados = conContenido.filter((a) => {
        const fila = aplicarCalculosAuditor(a);
        return fila.cursoAuditoresInternos === 'Aprobado';
    }).length;
    const enEntrenamiento = conContenido.filter((a) => {
        const fila = aplicarCalculosAuditor(a);
        return fila.cursoAuditoresInternos === 'No aprobado';
    }).length;
    return {
        activos,
        acreditados,
        enEntrenamiento
    };
}

function normalizarEstado(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z]/g, '');
}

function resolverEtiquetaEncabezado(textoNormalizado) {
    const idx = HEADER_NORMALIZED.indexOf(textoNormalizado);
    if (idx >= 0) {
        return HEADER_LABELS[idx];
    }
    return HEADER_ALIASES[textoNormalizado] || null;
}

function registrarColumnaEncabezado(columnas, etiqueta, col) {
    if (!etiqueta || !col || columnas[etiqueta] !== undefined) {
        return;
    }
    columnas[etiqueta] = col;
}

function detectarEncabezadoEnFila(ws, rowNum, columnasBase = {}) {
    const columnas = { ...columnasBase };
    const row = ws.getRow(rowNum);
    const rowSiguiente = rowNum < ws.rowCount ? ws.getRow(rowNum + 1) : null;

    for (let c = 1; c <= Math.max(row.cellCount, MAX_COLUMNAS_SISTEMA); c++) {
        const actual = normalizarHeader(celdaATexto(row.getCell(c).value));
        const siguiente = rowSiguiente
            ? normalizarHeader(celdaATexto(rowSiguiente.getCell(c).value))
            : '';
        const combinado = `${actual}${siguiente}`.trim();

        [actual, combinado, siguiente].forEach((texto) => {
            if (!texto) {
                return;
            }
            const etiqueta = resolverEtiquetaEncabezado(texto);
            registrarColumnaEncabezado(columnas, etiqueta, c);
        });
    }

    return columnas;
}

function completarColumnasFaltantes(headerInfo) {
    const columns = { ...(headerInfo?.columns || {}) };
    HEADER_LABELS.forEach((label) => {
        if (columns[label] === undefined && COLUMN_LAYOUT_FALLBACK[label] !== undefined) {
            columns[label] = COLUMN_LAYOUT_FALLBACK[label];
        }
    });
    return {
        row: headerInfo?.row || HEADER_ROW_FALLBACK,
        columns
    };
}

function detectarEncabezado(ws) {
    const limiteFilas = Math.min(ws.rowCount, 60);
    let mejorCoincidencia = null;

    for (let r = 1; r <= limiteFilas; r++) {
        const columnas = detectarEncabezadoEnFila(ws, r);
        const total = Object.keys(columnas).length;
        if (total >= HEADER_LABELS.length) {
            return completarColumnasFaltantes({ row: r, columns: columnas });
        }
        if (total >= 8 && (!mejorCoincidencia || total > Object.keys(mejorCoincidencia.columns).length)) {
            mejorCoincidencia = { row: r, columns: columnas };
        }
    }

    if (mejorCoincidencia) {
        const filaExtra = detectarEncabezadoEnFila(ws, mejorCoincidencia.row + 1, mejorCoincidencia.columns);
        return completarColumnasFaltantes({
            row: mejorCoincidencia.row,
            columns: filaExtra
        });
    }

    return completarColumnasFaltantes({
        row: HEADER_ROW_FALLBACK,
        columns: { ...COLUMN_LAYOUT_FALLBACK }
    });
}

function escribirEncabezado(ws, headerInfo) {
    const row = ws.getRow(headerInfo.row);
    HEADER_LABELS.forEach((label, idx) => {
        const col = headerInfo.columns[label] ?? idx + 1;
        row.getCell(col).value = label;
    });
    row.commit();
}

function limpiarTabla(ws, inicioFila, columnas) {
    const maxFila = Math.max(ws.rowCount, inicioFila + 120);
    for (let r = inicioFila; r <= maxFila; r++) {
        const row = ws.getRow(r);
        Object.values(columnas).forEach((col) => {
            row.getCell(col).value = null;
        });
        row.commit();
    }
}

function asignarTexto(celda, texto) {
    celda.value = texto;
    celda.alignment = { ...(celda.alignment || {}), vertical: 'middle', wrapText: true };
}

function auditorTieneContenido(auditor) {
    return !!(
        String(auditor?.nombre || '').trim()
        || String(auditor?.puesto || '').trim()
        || String(auditor?.cursoAuditoresInternos || '').trim()
        || auditor?.calificacionCurso != null
        || String(auditor?.nivelObjetividad || '').trim()
        || String(auditor?.desempeno || '').trim()
        || auditor?.promedio != null
    );
}

function esFilaAuditorValida(numero, nombre, puesto) {
    const no = String(numero || '').trim();
    const n = String(nombre || '').trim();
    const p = String(puesto || '').trim();
    if (!/^\d+$/.test(no)) {
        return false;
    }
    if (/^internos$/i.test(n) || /^internos$/i.test(p)) {
        return false;
    }
    if (/^no\.?$/i.test(n)) {
        return false;
    }
    return true;
}

function filaTieneEvaluacion(row, headerInfo) {
    const curso = celdaATexto(row.getCell(headerInfo.columns['Curso de auditores internos']).value);
    const calif = row.getCell(headerInfo.columns['Calif. Eval. Curso']).value;
    const nivel = celdaATexto(row.getCell(headerInfo.columns['Nivel de objetividad e imparcialidad']).value);
    const desempeno = celdaATexto(row.getCell(headerInfo.columns['Desempeño']).value);
    const promedio = row.getCell(headerInfo.columns['Promedio']).value;
    return !!(curso || calif != null || nivel || desempeno || promedio != null);
}

function crearAuditorVacio() {
    return {
        nombre: '',
        puesto: '',
        tiempoEmpresa: '',
        escolaridad: '',
        cursoAuditoresInternos: '',
        calificacionCurso: null,
        nivelObjetividad: '',
        desempeno: '',
        promedio: null,
        auditoriasRealizadas: 0
    };
}

function parsearFilaAuditor(row, headerInfo) {
    return {
        nombre: celdaATexto(row.getCell(headerInfo.columns['NOMBRE']).value),
        puesto: celdaATexto(row.getCell(headerInfo.columns['Puesto']).value),
        tiempoEmpresa: celdaATexto(row.getCell(headerInfo.columns['Tiempo en la empresa']).value),
        escolaridad: celdaATexto(row.getCell(headerInfo.columns['Escolaridad']).value),
        cursoAuditoresInternos: celdaATexto(
            row.getCell(headerInfo.columns['Curso de auditores internos']).value
        ),
        calificacionCurso: valorNumerico(
            row.getCell(headerInfo.columns['Calif. Eval. Curso']).value
        ),
        nivelObjetividad: celdaATexto(
            row.getCell(headerInfo.columns['Nivel de objetividad e imparcialidad']).value
        ),
        desempeno: celdaATexto(row.getCell(headerInfo.columns['Desempeño']).value),
        promedio: valorNumerico(celdaATexto(row.getCell(headerInfo.columns['Promedio']).value)),
        auditoriasRealizadas: Number(
            celdaATexto(row.getCell(headerInfo.columns['Auditorias realizadas']).value) || 0
        )
    };
}

function parsearDatosDesdeHoja(ws) {
    const headerInfo = completarColumnasFaltantes(detectarEncabezado(ws));
    const auditoresPorNumero = new Map();

    for (let r = DATA_FIRST_ROW; r < DATA_FIRST_ROW + DATA_ROW_COUNT; r++) {
        const row = ws.getRow(r);
        const numero = celdaATexto(row.getCell(1).value).trim();
        if (!/^\d+$/.test(numero) || Number(numero) > DATA_ROW_COUNT) {
            continue;
        }
        const fila = parsearFilaAuditor(row, headerInfo);
        if (auditorTieneContenido(fila) || Number(numero) <= DATA_ROW_COUNT) {
            auditoresPorNumero.set(Number(numero), fila);
        }
    }

    const auditores = [];
    for (let i = 1; i <= DATA_ROW_COUNT; i++) {
        auditores.push(auditoresPorNumero.get(i) || crearAuditorVacio());
    }

    return sanitizarDatos({
        resumen: calcularResumenDesdeAuditores(auditores.filter(auditorTieneContenido)),
        auditores
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-06 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
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

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function columnaALetraF06(col) {
    let numero = Number(col);
    let letras = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letras = String.fromCharCode(65 + resto) + letras;
        numero = Math.floor((numero - 1) / 26);
    }
    return letras;
}

function datosAActualizacionesSheet(datos, headerInfo, sheetTitle = SHEET_TITLE) {
    const actualizaciones = [];
    const auditores = (datos.auditores || []).slice(0, DATA_ROW_COUNT);

    actualizaciones.push({
        range: rangoSheet(FECHA_EVALUACION_RANGO, sheetTitle),
        values: [[fechaEvaluacionMexicoDisplay()]]
    });

    for (let index = 0; index < DATA_ROW_COUNT; index++) {
        const auditor = normalizarAuditorParaPersistencia(auditores[index] || crearAuditorVacio());
        const rowNum = DATA_FIRST_ROW + index;
        const cols = headerInfo.columns;

        actualizaciones.push({
            range: rangoSheet(`A${rowNum}`, sheetTitle),
            values: [[String(index + 1)]]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['NOMBRE'])}${rowNum}`, sheetTitle),
            values: [[auditor.nombre || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Puesto'])}${rowNum}`, sheetTitle),
            values: [[auditor.puesto || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Tiempo en la empresa'])}${rowNum}`, sheetTitle),
            values: [[auditor.tiempoEmpresa || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Escolaridad'])}${rowNum}`, sheetTitle),
            values: [[auditor.escolaridad || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Curso de auditores internos'])}${rowNum}`, sheetTitle),
            values: [[auditor.cursoAuditoresInternos || '']]
        });
            actualizaciones.push({
                range: rangoSheet(`${columnaALetraF06(cols['Calif. Eval. Curso'])}${rowNum}`, sheetTitle),
                values: [[auditor.calificacionCurso ?? '']]
            });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Nivel de objetividad e imparcialidad'])}${rowNum}`, sheetTitle),
            values: [[auditor.nivelObjetividad ?? '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Desempeño'])}${rowNum}`, sheetTitle),
            values: [[auditor.desempeno || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Promedio'])}${rowNum}`, sheetTitle),
            values: [[auditor.promedio ?? '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetraF06(cols['Auditorias realizadas'])}${rowNum}`, sheetTitle),
            values: [[auditor.auditoriasRealizadas || '']]
        });
    }

    return actualizaciones;
}

async function reforzarFormatoVisualSgcF06(spreadsheetId, sheetTitle, headerInfo) {
    if (!spreadsheetId || !sheetTitle) {
        return;
    }
    const cols = completarColumnasFaltantes(headerInfo || { columns: COLUMN_LAYOUT_FALLBACK }).columns;
    const colCalif = Number(cols['Calif. Eval. Curso']) || CALIF_EVAL_COL_INICIO;
    const colDesempeno = Number(cols['Desempeño']) || 11;
    const filaInicio = HEADER_ROW_FALLBACK;
    const filaFin = DATA_FIRST_ROW + DATA_ROW_COUNT - 1;
    try {
        await driveService.aplicarFormatoVisualSgcF06(spreadsheetId, {
            sheetTitle,
            califEvalCurso: {
                startRow: filaInicio,
                endRow: filaFin,
                startColumn: colCalif,
                endColumn: colCalif
            },
            copiarFormatoDesde: {
                startRow: filaInicio,
                endRow: filaFin,
                startColumn: colDesempeno,
                endColumn: colDesempeno
            }
        });
        console.log(`[SGC-F-06] Formato gris aplicado en columna ${colCalif} de "${sheetTitle}"`);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo aplicar formato visual:', err.message);
    }
}

async function aplicarFechaEvaluacionEnGoogleSheet(spreadsheetId, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
        range: rangoSheet(FECHA_EVALUACION_RANGO, titulo),
        values: [[fechaEvaluacionMexicoDisplay()]]
    }]);
}

async function resolverHeaderInfoDesdeDrive(spreadsheetId, sheetTitle) {
    const tituloHoja = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = resolverHojaPorTituloWorkbook(wb, tituloHoja) || obtenerHojaDatos(wb);
    if (!ws) {
        return { tituloHoja, headerInfo: { columns: COLUMN_LAYOUT_FALLBACK, row: HEADER_ROW_FALLBACK } };
    }
    return {
        tituloHoja,
        headerInfo: completarColumnasFaltantes(detectarEncabezado(ws))
    };
}

async function publicarCompletoSgcF06(spreadsheetId, datos, sheetTitle = null) {
    const tituloHoja = sheetTitle
        ? String(sheetTitle).trim()
        : await resolverTituloHojaTrabajo(spreadsheetId);

    try {
        await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-06] Error al escribir datos en Google Sheet:', err.message);
    }

    try {
        await aplicarFechaEvaluacionEnGoogleSheet(spreadsheetId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-06] Error al escribir fecha de evaluación:', err.message);
    }

    try {
        const { headerInfo } = await resolverHeaderInfoDesdeDrive(spreadsheetId, tituloHoja);
        await reforzarFormatoVisualSgcF06(spreadsheetId, tituloHoja, headerInfo);
    } catch (err) {
        console.warn('[SGC-F-06] Error al aplicar formato Calif. Eval. Curso:', err.message);
    }

    return tituloHoja;
}

async function publicarDatosEnHojaVigente(spreadsheetId, datos, hist = null) {
    const hojaDestino = hist?.aplicado && hist?.hojaVigente
        ? hist.hojaVigente
        : await resolverTituloHojaTrabajo(spreadsheetId);
    return publicarCompletoSgcF06(spreadsheetId, datos, hojaDestino);
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    const tituloHoja = await resolverTituloHojaTrabajo(spreadsheetId, sheetTitle);
    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = resolverHojaPorTituloWorkbook(wb, tituloHoja) || obtenerHojaDatos(wb);
    const headerInfo = completarColumnasFaltantes(detectarEncabezado(ws));
    const actualizaciones = datosAActualizacionesSheet(datos, headerInfo, tituloHoja);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    const colNivel = Number(headerInfo?.columns?.['Nivel de objetividad e imparcialidad']);
    if (Number.isFinite(colNivel) && colNivel > 0) {
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle: tituloHoja,
                startRow: DATA_FIRST_ROW,
                endRow: DATA_FIRST_ROW + DATA_ROW_COUNT - 1,
                startColumn: colNivel,
                endColumn: colNivel,
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
            });
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo aplicar formato centrado en columna de objetividad:', err.message);
        }
    }
    await reforzarFormatoVisualSgcF06(spreadsheetId, tituloHoja, headerInfo);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

function resolverHojaPorTituloWorkbook(wb, titulo) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    const buscado = String(titulo || '').trim();
    if (!buscado) {
        return null;
    }
    return lista.find((ws) => String(ws.name || '').trim() === buscado)
        || lista.find((ws) => String(ws.name || '').trim().toLowerCase() === buscado.toLowerCase())
        || null;
}

function celdaSegura(row, col) {
    const numero = Number(col);
    if (!Number.isFinite(numero) || numero < 1) {
        throw new Error(`Columna invalida para SGC-F-06: ${col}`);
    }
    return row.getCell(numero);
}

function escribirAuditorEnFila(ws, rowNum, headerInfo, auditor) {
    const fila = normalizarAuditorParaPersistencia(auditor);
    const row = ws.getRow(rowNum);
    const cols = completarColumnasFaltantes(headerInfo).columns;
    asignarTexto(celdaSegura(row, cols['NOMBRE']), fila.nombre);
    asignarTexto(celdaSegura(row, cols['Puesto']), fila.puesto);
    asignarTexto(celdaSegura(row, cols['Tiempo en la empresa']), fila.tiempoEmpresa);
    asignarTexto(celdaSegura(row, cols['Escolaridad']), fila.escolaridad);
    asignarTexto(celdaSegura(row, cols['Curso de auditores internos']), fila.cursoAuditoresInternos);
    const celdaCalif = celdaSegura(row, cols['Calif. Eval. Curso']);
    celdaCalif.value = fila.calificacionCurso ?? '';
    celdaCalif.alignment = {
        ...(celdaCalif.alignment || {}),
        horizontal: 'center',
        vertical: 'middle'
    };

    const celdaObjetividad = celdaSegura(row, cols['Nivel de objetividad e imparcialidad']);
    celdaObjetividad.value = fila.nivelObjetividad ?? '';
    celdaObjetividad.alignment = {
        ...(celdaObjetividad.alignment || {}),
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true
    };

    celdaSegura(row, cols['Desempeño']).value = fila.desempeno ?? '';

    const celdaPromedio = celdaSegura(row, cols['Promedio']);
    celdaPromedio.value = fila.promedio ?? '';
    celdaPromedio.alignment = {
        ...(celdaPromedio.alignment || {}),
        horizontal: 'center',
        vertical: 'middle'
    };

    const celdaAud = celdaSegura(row, cols['Auditorias realizadas']);
    celdaAud.value = fila.auditoriasRealizadas || '';
    celdaAud.alignment = {
        ...(celdaAud.alignment || {}),
        horizontal: 'center',
        vertical: 'middle'
    };
    celdaSegura(row, 1).value = String(rowNum - DATA_FIRST_ROW + 1);
    row.commit();
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const buffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = obtenerHojaDatos(wb) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-06 no contiene hojas.');

    const headerInfo = completarColumnasFaltantes(detectarEncabezado(ws));
    const auditores = (datos.auditores || []).slice(0, DATA_ROW_COUNT);

    ws.getCell(FECHA_EVALUACION_RANGO.split(':')[0]).value = fechaEvaluacionMexicoDisplay();

    for (let index = 0; index < DATA_ROW_COUNT; index++) {
        escribirAuditorEnFila(ws, DATA_FIRST_ROW + index, headerInfo, auditores[index] || crearAuditorVacio());
    }

    const bufferSalida = await wb.xlsx.writeBuffer();
    return Buffer.from(bufferSalida);
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
    } catch (err) {
        return null;
    }
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (
        (archivos || [])
            .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
            .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null
    );
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
                if (!existe) {
                    continue;
                }
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) {
                    continue;
                }
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) {
                    continue;
                }
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) {
        return editableSinCarpeta;
    }

    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) {
        return editableEnCarpeta;
    }

    return await resolver(false, false) || DRIVE_FILE_ID_SISTEMA || null;
}

function formatearDatetimeMexico(valor) {
    if (!valor) return null;
    if (valor instanceof Date) {
        const d = valor;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const anio = d.getFullYear();
        const horas = String(d.getHours()).padStart(2, '0');
        const minutos = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${anio} ${horas}:${minutos}`;
    }
    if (typeof valor === 'string') {
        const fecha = new Date(valor);
        if (!Number.isNaN(fecha.getTime())) {
            return formatearDatetimeMexico(fecha);
        }
        return valor;
    }
    return String(valor);
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    if (archivoDrive?.modifiedTime) {
        return formatearDatetimeMexico(archivoDrive.modifiedTime);
    }
    return formatearDatetimeMexico(registro?.ultima_sync_drive);
}

function construirRespuesta(registro, datos, archivoDrive) {
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;
    return {
        codigo: CODIGO_FORMATO,
        datos,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original || null,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
        contenidoModificado: !!registro?.contenido_modificado
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        fechaElaboracionOriginal: valorFechaDb(payload.fechaElaboracionOriginal),
        fechaModificacionContenido: valorFechaDb(payload.fechaModificacionContenido)
    });
}

function datosSonEquivalentes(a, b) {
    const copia = (datos) => sanitizarDatos(datos);
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

function estructuraEsEquivalente(a, b) {
    const fa = Array.isArray(a?.auditores) ? a.auditores.length : 0;
    const fb = Array.isArray(b?.auditores) ? b.auditores.length : 0;
    return fa === fb;
}

async function aplicarHistorialSgcF06(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente: datosSonEquivalentes,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function publicarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    return actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
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
            console.warn('[SGC-F-06] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(buffer, NOMBRE_ARCHIVO_DRIVE, CARPETA_DRIVE_ID, DRIVE_SHEET_OPTIONS);
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
            console.warn('[SGC-F-06] No se pudo restaurar Google Sheet al cargar:', err.message);
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
            console.warn('[SGC-F-06] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch (err) {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos?.auditores?.length) {
        try {
            const plantilla = await leerDatosDesdePlantilla();
            if (plantilla?.auditores?.length) {
                datos = plantilla;
            }
        } catch (err) {
            console.warn('[SGC-F-06] Plantilla sin auditores, usando datos por defecto:', err.message);
        }
    }
    if (!datos?.auditores?.length) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: fechaHoyIso(),
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

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso();
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    let datosPrevios = null;
    if (registroPrevio?.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch (err) {
            datosPrevios = null;
        }
    }

    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    if (!huboCambio && driveId) {
        await publicarCompletoSgcF06(driveId, datosEntrada);
        const archivoDrive = await driveService
            .obtenerInfoArchivo(driveId)
            .catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const fechaCambio = fechaHoyIso();
        let hist = {
            aplicado: false,
            datosGuardar: datosEntrada,
            hojaVigente: null,
            nombreHistorial: null
        };

        if (huboCambio && datosPrevios) {
            hist = await aplicarHistorialSgcF06({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: origen !== 'consulta' ? { ...datosEntrada } : datosEntrada,
                origen,
                forzarTipo: body?.tipoCambio || 'informacion'
            });
            if (hist.aplicado) {
                console.log(`[SGC-F-06] Historial creado: "${hist.nombreHistorial}"`);
            } else {
                console.warn('[SGC-F-06] No se pudo crear hoja de historial en Drive');
            }
        }

        datosGuardar = hist.datosGuardar || datosEntrada;

        if (hist.aplicado && origen !== 'consulta') {
            contenidoModificado = true;
            fechaModificacion = fechaCambio;
        }

        const hojaDestino = hist.aplicado && hist.hojaVigente
            ? hist.hojaVigente
            : await resolverTituloHojaTrabajo(driveId);
        await publicarCompletoSgcF06(driveId, datosGuardar, hojaDestino);

        await guardarRegistroDb(pool, {
            driveFileId: driveId,
            datos: datosGuardar,
            fechaElaboracionOriginal: fechaOriginal,
            fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
            contenidoModificado
        });
        const registro = await obtenerRegistroDb(pool);
        const archivoDrive = await driveService
            .obtenerInfoArchivo(driveId)
            .catch(() => ({ id: driveId }));
        return construirRespuesta(registro, datosGuardar, archivoDrive);
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
        throw new Error('No hay archivo SGC-F-06 en Drive para sincronizar.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const buffer = await descargarBufferDrive(driveFileId);
    const datosDrive = await leerDatosDesdeBuffer(buffer);

    const datosPrevios = await leerDatosRegistro(registro);
    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosDrive);

    let hist = { aplicado: false, datosGuardar: datosDrive, hojaVigente: null };
    if (huboCambio && datosPrevios) {
        hist = await aplicarHistorialSgcF06({
            spreadsheetId: driveFileId,
            datosPrevios,
            datosNuevos: datosDrive,
            origen: 'drive',
            forzarTipo: 'informacion'
        });
    }

    const datosGuardar = hist.datosGuardar || datosDrive;
    const hojaDestino = hist.aplicado && hist.hojaVigente
        ? hist.hojaVigente
        : await resolverTituloHojaTrabajo(driveFileId);
    await publicarCompletoSgcF06(driveFileId, datosGuardar, hojaDestino);

    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(registro, datosGuardar, archivoDrive);
    }

    const fechaCambio = fechaHoyIso();
    const contenidoModificado = true;
    const fechaModificacion = fechaCambio;

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original || fechaCambio,
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
        } catch (err) {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = { ...datos };

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-06] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
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
