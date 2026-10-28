/**
 * SGC-F-06 · Lista y calificación de auditores internos.
 * Plantilla externa (solo diseño) + archivo sistema (historial SGCF06-MMAA / _N + histograma).
 * Archivero de listas vive en BD/UI; Excel proyecta la lista activa en pestañas mensuales.
 * Patrón: docs/GUIA-PLANTILLA-EXCEL-SGC.md / sgcDgF05Service / sgcF25Service.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-06';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1CsIGwpxURUGwwgd16YGacJK0pPkoYmcsdMoGaY7B-pk
 */
const TEMPLATE_DRIVE_ID = '1CsIGwpxURUGwwgd16YGacJK0pPkoYmcsdMoGaY7B-pk';
/**
 * Archivo de trabajo Centro SGC (historial SGCF06-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A
 */
const DRIVE_FILE_ID_SISTEMA = '172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-06 Lista y calificación de auditores (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback legado / resolución; el trabajo real usa SGCF06-MMAA(_N). */
const SHEET_TITLE = 'Hoja1';
const MAX_COLUMNAS_SISTEMA = 15;

/** Nombre base del mes actual (SGCF06-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

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

const DATOS_DEFECTO = {
    listas: [],
    listaActivaId: null
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

/** Eval. curso: solo 0–10; letras / inválidos → null; fuera de rango → clamp. */
function clampEvalCurso(valor) {
    const numero = valorNumerico(valor);
    if (numero === null) return null;
    return Math.round(Math.max(0, Math.min(10, numero)) * 100) / 100;
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
    if (typeof fecha === 'string') {
        const iso = fecha.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
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

function esTituloPlantillaF06(titulo) {
    const t = String(titulo || '').trim().toLowerCase();
    return !t
        || t === String(TEMPLATE_SHEET_TITLE).toLowerCase()
        || t === String(SHEET_TITLE).toLowerCase()
        || t === 'plantilla.'
        || t.startsWith('_tmp_');
}

function esNombreHojaHistorial(titulo) {
    return excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO);
}

function esHojaDelMesActual(titulo, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const t = String(titulo || '').trim();
    if (!t || !mes) return false;
    if (t === mes) return true;
    return new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t);
}

function listarHojasHistorialOrdenadas(titulos) {
    return (Array.isArray(titulos) ? titulos : [])
        .map((t) => String(t || '').trim())
        .filter((t) => t && esNombreHojaHistorial(t))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
}

/** Última versión del mes: SGCF06-1026_3 > SGCF06-1026_2 > SGCF06-1026. */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => esHojaDelMesActual(t, mes))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

function hojaPorTituloEnWorkbook(wb, titulo) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    const buscado = String(titulo || '').trim();
    if (!buscado) return null;
    return lista.find((ws) => String(ws.name || '').trim() === buscado)
        || lista.find((ws) => String(ws.name || '').trim().toLowerCase() === buscado.toLowerCase())
        || null;
}

function resolverHojaLecturaDesdeWorkbook(wb) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;

    const historiales = listarHojasHistorialOrdenadas(lista.map((ws) => ws.name));
    for (const item of historiales) {
        const ws = hojaPorTituloEnWorkbook(wb, item.titulo);
        if (!ws) continue;
        const hoja = parsearDatosDesdeHoja(ws);
        if (auditoresHojaTienenContenido(hoja?.auditores)) {
            return ws;
        }
    }
    if (historiales[0]) {
        const wsVacia = hojaPorTituloEnWorkbook(wb, historiales[0].titulo);
        if (wsVacia) return wsVacia;
    }
    return hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE)
        || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        || lista[0];
}

function obtenerHojaDatos(wb, modo = 'vigente') {
    if (!wb) return null;
    void modo;
    return resolverHojaLecturaDesdeWorkbook(wb);
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    const historicas = listarHojasHistorialOrdenadas(titulos)
        .filter((item) => !esTituloPlantillaF06(item.titulo));
    if (historicas[0]?.titulo) return historicas[0].titulo;

    if (!titulos.length) return mesActual;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && esNombreHojaHistorial(nombre)
            && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo resolver hoja vigente:', err.message);
    }

    return mesActual;
}

async function resolverTituloHojaTrabajo(spreadsheetId, sheetTitle = null) {
    if (sheetTitle) {
        return String(sheetTitle).trim();
    }
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        return nombreHojaMesActual();
    }
    return resolverTituloHojaVigente(spreadsheetId);
}

async function editorUrlConHojaVigente(driveId) {
    const base = `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`;
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) return null;
    try {
        const titulo = await resolverTituloHojaVigente(driveId);
        const gid = await driveService.obtenerGidHojaPorNombre(driveId, titulo);
        if (gid != null) {
            return `${base}&gid=${gid}#gid=${gid}`;
        }
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo resolver gid editor:', err.message);
    }
    return base;
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
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA]
        .filter(Boolean)
        .map((id) => String(id).trim())
        .filter((id) => id && id !== TEMPLATE_DRIVE_ID);
    const unicos = [...new Set(candidatos)];

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
        calificacionCurso: clampEvalCurso(
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

function nuevoIdLista() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `lista-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function textoPlano(valor) {
    return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
}

function auditoresVacios() {
    return Array.from({ length: DATA_ROW_COUNT }, () => normalizarAuditor(crearAuditorVacio()));
}

function sanitizarAuditores(auditoresRaw) {
    const fuente = Array.isArray(auditoresRaw) ? auditoresRaw : [];
    const auditores = fuente.map(normalizarAuditorParaPersistencia);
    if (!auditores.length) {
        return auditoresVacios();
    }
    while (auditores.length < DATA_ROW_COUNT) {
        auditores.push(normalizarAuditorParaPersistencia(crearAuditorVacio()));
    }
    return auditores.slice(0, DATA_ROW_COUNT);
}

function sanitizarLista(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const auditores = sanitizarAuditores(base.auditores);
    return {
        id: textoPlano(base.id) || nuevoIdLista(),
        titulo: textoPlano(base.titulo) || 'Lista de auditores',
        fecha: formatearFechaIso(base.fecha) || fechaHoyIso(),
        auditores,
        resumen: normalizarResumen(base.resumen, auditores)
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let listas;
    if (Array.isArray(base.listas)) {
        listas = base.listas.map(sanitizarLista);
    } else if (Array.isArray(base.auditores)) {
        listas = [sanitizarLista({
            id: base.listaActivaId || base.id || 'lista-vigente',
            titulo: base.titulo || 'Lista vigente',
            fecha: base.fecha || fechaHoyIso(),
            auditores: base.auditores,
            resumen: base.resumen
        })];
    } else {
        listas = [];
    }
    const activa = textoPlano(base.listaActivaId);
    return {
        listas,
        listaActivaId: activa && listas.some((lista) => lista.id === activa) ? activa : (listas[0]?.id || null)
    };
}

function resolverListaActiva(datos) {
    const sanit = Array.isArray(datos?.listas) ? datos : sanitizarDatos(datos || {});
    const listas = Array.isArray(sanit.listas) ? sanit.listas : [];
    if (!listas.length) return null;
    const id = textoPlano(sanit.listaActivaId);
    return listas.find((lista) => lista.id === id) || listas[0];
}

function proyeccionHoja(datos) {
    const lista = resolverListaActiva(datos);
    if (!lista) {
        const auditores = auditoresVacios();
        return {
            auditores,
            resumen: calcularResumenDesdeAuditores(auditores),
            fecha: fechaHoyIso()
        };
    }
    return {
        auditores: lista.auditores,
        resumen: lista.resumen,
        fecha: lista.fecha || fechaHoyIso()
    };
}

function auditoresHojaTienenContenido(auditores) {
    return (Array.isArray(auditores) ? auditores : []).some(auditorTieneContenido);
}

function fusionarHojaEnListaActiva(datosDb, hoja) {
    const db = sanitizarDatos(datosDb || {});
    const auditoresHoja = sanitizarAuditores(hoja?.auditores);
    const fechaHoja = formatearFechaIso(hoja?.fecha);
    const tiene = auditoresHojaTienenContenido(auditoresHoja);
    if (!db.listas.length) {
        if (!tiene) return db;
        const primera = sanitizarLista({
            id: 'lista-vigente',
            titulo: 'Lista vigente',
            fecha: fechaHoja || fechaHoyIso(),
            auditores: auditoresHoja,
            resumen: hoja?.resumen
        });
        return sanitizarDatos({ listas: [primera], listaActivaId: primera.id });
    }
    if (!tiene) return db;
    const activaId = db.listaActivaId || db.listas[0].id;
    const listas = db.listas.map((lista) => {
        if (lista.id !== activaId) return lista;
        return sanitizarLista({
            ...lista,
            fecha: fechaHoja || lista.fecha,
            auditores: auditoresHoja,
            resumen: hoja?.resumen
        });
    });
    return sanitizarDatos({ listas, listaActivaId: activaId });
}

function listaDesdeHoja(hoja) {
    if (!hoja || !auditoresHojaTienenContenido(hoja.auditores)) return null;
    return sanitizarDatos({
        ...hoja,
        id: 'lista-vigente',
        titulo: 'Lista vigente',
        listaActivaId: 'lista-vigente'
    });
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

    return {
        fecha: leerFechaEvaluacionHoja(ws),
        resumen: calcularResumenDesdeAuditores(auditores.filter(auditorTieneContenido)),
        auditores
    };
}

function leerFechaEvaluacionHoja(ws) {
    if (!ws) return '';
    return formatearFechaIso(celdaATexto(ws.getCell('M5').value));
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-06 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function resolverTituloPlantillaExterna() {
    const titulos = await driveService.listarHojasGoogleSheet(TEMPLATE_DRIVE_ID).catch(() => []);
    const lista = (titulos || []).map((t) => String(t || '').trim()).filter(Boolean);
    const exacta = lista.find((t) => t.toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase());
    if (exacta) return exacta;
    const hoja1 = lista.find((t) => t.toLowerCase() === 'hoja1');
    if (hoja1) return hoja1;
    if (lista.length) return lista[0];
    throw new Error(
        `No se encontró la hoja «${TEMPLATE_SHEET_TITLE}» en la plantilla SGC-F-06 `
        + `(${TEMPLATE_DRIVE_ID}).`
    );
}

/** Valida cabeceras típicas de la plantilla SGC-F-06 (fila 8). */
async function hojaTieneEstructuraPlantilla(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) return false;
    try {
        const filas = await driveService.leerRangoGoogleSheet(
            spreadsheetId,
            `'${String(sheetTitle).replace(/'/g, "''")}'!B${HEADER_ROW_FALLBACK}:N${HEADER_ROW_FALLBACK}`
        );
        const row = Array.isArray(filas?.[0]) ? filas[0] : [];
        const texto = row.map((c) => normalizarHeader(celdaATexto(c))).join(' ');
        return texto.includes('nombre')
            && (texto.includes('puesto') || texto.includes('escolaridad'))
            && (texto.includes('promedio') || texto.includes('desempeno') || texto.includes('auditor'));
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo validar estructura vs plantilla:', err.message);
        return false;
    }
}

/**
 * Copia «Plantilla» del archivo plantilla externo → sistema como SGCF06-MMAA(_N).
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar plantilla sobre el archivo plantilla SGC-F-06.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    const origenTitulo = await resolverTituloPlantillaExterna();
    console.warn(
        `[SGC-F-06] Copiando hoja «${origenTitulo}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        origenTitulo,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            origenTitulo,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SGC-F-06] Anchos de columna desde plantilla:', err.message);
    }
    const ok = await hojaTieneEstructuraPlantilla(spreadsheetId, copiada.title);
    if (!ok) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [copiada.title]);
        } catch (_) { /* ignore */ }
        throw new Error(
            `La copia «${copiada.title}» no coincide con la plantilla externa `
            + `(se esperan encabezados Nombre / Puesto / Auditores).`
        );
    }
    return copiada.title;
}

/**
 * Sustituye SOLO la hoja del mes de trabajo por una copia limpia de la plantilla
 * externa. Nunca reescribe pestañas de historial de meses previos.
 */
async function reescribirHojaDesdePlantilla(spreadsheetId, tituloDestino, datos) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede regenerar sobre el archivo plantilla SGC-F-06.');
    }
    const mesActual = nombreHojaMesActual();
    let titulo = String(tituloDestino || '').trim() || mesActual;
    if (!esHojaDelMesActual(titulo, mesActual)
        && excelHistorial.esHojaHistorialInformacion(titulo, CODIGO_FORMATO)) {
        console.warn(
            `[SGC-F-06] Se ignoró reescritura de historial «${titulo}»; `
            + `se regenera solo el mes actual.`
        );
        titulo = mesActual;
    }

    console.warn(`[SGC-F-06] Regenerando «${titulo}» desde plantilla maestra (copyTo + datos).`);

    const tmpTitle = `_tmp_${titulo}_${Date.now().toString().slice(-6)}`;
    const tituloTmp = await adoptarPlantillaEnSistema(spreadsheetId, tmpTitle);

    await escribirSnapshotEnHojaDrive(spreadsheetId, tituloTmp, datos);

    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    if (titulos.includes(titulo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [titulo]);
        } catch (err) {
            console.warn(`[SGC-F-06] No se pudo eliminar hoja previa «${titulo}»:`, err.message);
        }
    }
    await driveService.renombrarHojaGoogleSheet(spreadsheetId, tituloTmp, titulo);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, titulo);
    } catch (_) { /* opcional */ }

    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function sincronizarHojaEdicionDrive(spreadsheetId, datos, sheetTitlePreferido = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede sincronizar sobre el archivo plantilla SGC-F-06.');
    }
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo listar hojas; se usa plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    let titulo = String(sheetTitlePreferido || '').trim();
    if (!titulo || !titulos.includes(titulo) || esTituloPlantillaF06(titulo)) {
        titulo = resolverTituloMesMasReciente(titulos, mesActual) || mesActual;
    }

    if (!titulos.includes(titulo)) {
        return reescribirHojaDesdePlantilla(spreadsheetId, mesActual, datos);
    }

    const estructuraOk = await hojaTieneEstructuraPlantilla(spreadsheetId, titulo);
    if (!estructuraOk) {
        console.warn(`[SGC-F-06] «${titulo}» no coincide con plantilla externa; se regenera.`);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }

    try {
        await escribirSnapshotEnHojaDrive(spreadsheetId, titulo, datos);
        return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
    } catch (err) {
        console.warn('[SGC-F-06] Sync celda falló; regenerando desde plantilla:', err.message);
        return reescribirHojaDesdePlantilla(spreadsheetId, titulo, datos);
    }
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = hojaPorTituloEnWorkbook(wb, TEMPLATE_SHEET_TITLE)
        || hojaPorTituloEnWorkbook(wb, SHEET_TITLE)
        || (wb.worksheets || [])[0];
    if (!ws) throw new Error('La plantilla SGC-F-06 no contiene hojas.');
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
    const proyeccion = proyeccionHoja(datos);
    const auditores = (proyeccion.auditores || []).slice(0, DATA_ROW_COUNT);
    const fechaDisplay = formatearFechaDisplay(proyeccion.fecha) || fechaEvaluacionMexicoDisplay();

    actualizaciones.push({
        range: rangoSheet(FECHA_EVALUACION_RANGO, sheetTitle),
        values: [[fechaDisplay]]
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

async function aplicarFechaEvaluacionEnGoogleSheet(spreadsheetId, sheetTitle, fechaDisplay = '') {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [{
        range: rangoSheet(FECHA_EVALUACION_RANGO, titulo),
        values: [[fechaDisplay || fechaEvaluacionMexicoDisplay()]]
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
        const fechaDisplay = formatearFechaDisplay(proyeccionHoja(datos).fecha) || fechaEvaluacionMexicoDisplay();
        await aplicarFechaEvaluacionEnGoogleSheet(spreadsheetId, tituloHoja, fechaDisplay);
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
    const proyeccion = proyeccionHoja(datos);
    const auditores = (proyeccion.auditores || []).slice(0, DATA_ROW_COUNT);

    ws.getCell(FECHA_EVALUACION_RANGO.split(':')[0]).value = formatearFechaDisplay(proyeccion.fecha)
        || fechaEvaluacionMexicoDisplay();

    for (let index = 0; index < DATA_ROW_COUNT; index++) {
        escribirAuditorEnFila(ws, DATA_FIRST_ROW + index, headerInfo, auditores[index] || crearAuditorVacio());
    }

    const bufferSalida = await wb.xlsx.writeBuffer();
    return Buffer.from(bufferSalida);
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

function parsearJsonRegistro(registro) {
    if (!registro?.datos_json) return null;
    try {
        return typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
    } catch (err) {
        return null;
    }
}

async function leerDatosRegistro(registro) {
    const parsed = parsearJsonRegistro(registro);
    if (!parsed) return null;
    return sanitizarDatos(parsed);
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID).catch(() => []);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => {
            const id = String(f.id || '');
            if (esArchivoProtegidoDrive(id) && id !== DRIVE_FILE_ID_SISTEMA) return false;
            return String(f.name || '').toLowerCase().startsWith(objetivo);
        })
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

function esArchivoProtegidoDrive(id) {
    const val = String(id || '').trim();
    return !!val && (val === TEMPLATE_DRIVE_ID || val === DRIVE_FILE_ID_SISTEMA);
}

async function eliminarHojasHistorialFormatoSgcF06(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) return;
    const alias = excelHistorial.resolverAlias(CODIGO_FORMATO);
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudieron listar hojas para limpiar Alias_r*:', err.message);
        return;
    }
    const patronAlias = new RegExp(`^${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_r`, 'i');
    const aEliminar = (titulos || []).filter((t) => {
        const nombre = String(t || '').trim();
        return !!nombre && patronAlias.test(nombre);
    });
    if (!aEliminar.length || aEliminar.length >= (titulos || []).length) return;
    try {
        await driveService.eliminarHojasGoogleSheet(spreadsheetId, aEliminar);
        console.warn(`[SGC-F-06] Eliminadas pestañas residuales: ${aEliminar.join(', ')}`);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudieron eliminar pestañas Alias_r*:', err.message);
    }
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
        if (existeSistema) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = String(registro?.drive_file_id || '').trim() || null;
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb).catch(() => false);
        if (existe) return idDb;
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    if (enCarpeta?.id && enCarpeta.id !== TEMPLATE_DRIVE_ID) {
        return enCarpeta.id;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
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

async function construirRespuesta(registro, datos, archivoDrive) {
    let driveId = archivoDrive?.id || registro?.drive_file_id || null;
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    return {
        codigo: CODIGO_FORMATO,
        datos,
        driveFileId: driveId,
        editorUrl: driveId ? await editorUrlConHojaVigente(driveId) : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        plantillaDriveId: TEMPLATE_DRIVE_ID,
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
    const fa = proyeccionHoja(a).auditores.length;
    const fb = proyeccionHoja(b).auditores.length;
    return fa === fb;
}

/**
 * SGC-F-06 solo usa pestañas SGCF06-MMAA / SGCF06-MMAA_N.
 * Cada guardado con cambios crea una versión nueva del mes (_2, _3…).
 */
async function aplicarHistorialSgcF06(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente: datosSonEquivalentes,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        soloHistorialInformacion: true,
        versionarCadaCambioMes: true,
        resolverNombreHistorial: () => nombreHojaMesActual()
    });
}

async function publicarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = null) {
    return actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio && driveFileIdPrevio !== TEMPLATE_DRIVE_ID) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-06] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: MAX_COLUMNAS_SISTEMA, keepSingleSheet: false }
    );
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        driveFileId = DRIVE_FILE_ID_SISTEMA;
    }
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

    const crudo = parsearJsonRegistro(registro);
    const tieneArchivero = Array.isArray(crudo?.listas);
    datos = crudo ? sanitizarDatos(crudo) : null;

    let hoja = null;
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            hoja = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!tieneArchivero) {
        const desdeHoja = listaDesdeHoja(hoja);
        if (desdeHoja) {
            datos = desdeHoja;
        } else if (!datos?.listas?.some((lista) => auditoresHojaTienenContenido(lista.auditores))) {
            try {
                const plantilla = await leerDatosDesdePlantilla();
                const desdePlantilla = listaDesdeHoja(plantilla);
                if (desdePlantilla) datos = desdePlantilla;
            } catch (err) {
                console.warn('[SGC-F-06] Plantilla sin auditores, usando archivero vacío:', err.message);
            }
        }
        if (datos?.listas?.length) {
            try {
                await guardarRegistroDb(pool, {
                    driveFileId: driveFileId || null,
                    datos,
                    fechaElaboracionOriginal: registro?.fecha_elaboracion_original || fechaHoyIso(),
                    fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                    contenidoModificado: !!registro?.contenido_modificado
                });
            } catch (err) {
                console.warn('[SGC-F-06] No se pudo migrar el archivero en BD:', err.message);
            }
        }
    }

    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    // Solo se toca la última versión del MES ACTUAL. Historial previo intacto.
    const tituloMes = nombreHojaMesActual();
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        await eliminarHojasHistorialFormatoSgcF06(driveFileId);
        const titulos = await driveService.listarHojasGoogleSheet(driveFileId).catch(() => []);
        const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
        const existeMes = !!tituloVigente;
        const estructuraMesOk = existeMes
            ? await hojaTieneEstructuraPlantilla(driveFileId, tituloVigente)
            : false;

        if (!existeMes || !estructuraMesOk) {
            const destino = tituloVigente || tituloMes;
            if (!existeMes) {
                console.warn(`[SGC-F-06] Falta hoja del mes «${tituloMes}»; se crea desde plantilla.`);
            } else {
                console.warn(`[SGC-F-06] «${destino}» no coincide con plantilla; se regenera.`);
            }
            try {
                await reescribirHojaDesdePlantilla(driveFileId, destino, datos);
                archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => archivoDrive);
            } catch (healErr) {
                console.warn('[SGC-F-06] No se pudo regenerar hoja del mes desde plantilla:', healErr.message);
            }
        }
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
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo asegurar permiso de enlace:', err.message);
        }
    }
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
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveId) {
        try {
            driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo asegurar Google Sheet:', err.message);
        }
    }

    if (!huboCambio && driveId && driveId !== TEMPLATE_DRIVE_ID) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            await eliminarHojasHistorialFormatoSgcF06(driveId);
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
                    console.log(`[SGC-F-06] Historial creado: "${hist.nombreHistorial || hist.hojaVigente}"`);
                }
            }

            datosGuardar = hist.datosGuardar || datosEntrada;

            if ((hist.aplicado || huboCambio) && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            let tituloSync = String(hist.hojaVigente || '').trim();
            if (!tituloSync || esTituloPlantillaF06(tituloSync) || !esNombreHojaHistorial(tituloSync)) {
                tituloSync = await resolverTituloHojaVigente(driveId);
            }

            let archivoDrive = null;
            try {
                archivoDrive = await sincronizarHojaEdicionDrive(driveId, datosGuardar, tituloSync);
            } catch (syncErr) {
                console.warn('[SGC-F-06] Sync hoja edición falló tras historial:', syncErr.message);
            }
            if (!archivoDrive) {
                await publicarCompletoSgcF06(driveId, datosGuardar, tituloSync);
                archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
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
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    const driveTrabajo = driveId || DRIVE_FILE_ID_SISTEMA;
    if (!driveTrabajo || driveTrabajo === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo sincronizar SGC-F-06: falta archivo sistema.');
    }
    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    let tituloNuevo = await resolverTituloHojaVigente(driveTrabajo);
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveTrabajo);
        if (!titulos.includes(tituloNuevo) || esTituloPlantillaF06(tituloNuevo)) {
            tituloNuevo = await adoptarPlantillaEnSistema(driveTrabajo, nombreHojaMesActual());
        }
    } catch (adoptErr) {
        console.warn('[SGC-F-06] Adoptar plantilla en fallback:', adoptErr.message);
    }
    const archivoDrive = await sincronizarHojaEdicionDrive(driveTrabajo, datosGuardar, tituloNuevo)
        || await driveService.obtenerInfoArchivo(driveTrabajo).catch(() => ({ id: driveTrabajo }));

    await guardarRegistroDb(pool, {
        driveFileId: driveTrabajo,
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
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const buffer = await descargarBufferDrive(driveFileId);
    const hoja = await leerDatosDesdeBuffer(buffer);
    const datosPrevios = await leerDatosRegistro(registro);
    const datosDrive = fusionarHojaEnListaActiva(datosPrevios, hoja);
    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosDrive);

    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta(
            { ...registro, drive_file_id: driveFileId },
            datosPrevios || datosDrive,
            archivoDrive
        );
    }

    let hist = { aplicado: false, datosGuardar: datosDrive, hojaVigente: null };
    if (datosPrevios) {
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
    await sincronizarHojaEdicionDrive(driveFileId, datosGuardar, hojaDestino);

    const fechaCambio = fechaHoyIso();
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original || fechaCambio,
        fechaModificacionContenido: fechaCambio,
        contenidoModificado: true
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

/**
 * Trae la estructura desde el Excel plantilla externo hacia el archivo sistema
 * (hoja del mes vigente), sin borrar historial ni tocar la plantilla ni el histograma.
 */
async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = listaDesdeHoja(await leerDatosDesdePlantilla()) || sanitizarDatos(DATOS_DEFECTO);
        } catch (err) {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }
    datos = sanitizarDatos(datos);

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = { ...datos };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId) {
        throw new Error('No hay archivo sistema SGC-F-06 configurado (DRIVE_FILE_ID_SISTEMA).');
    }
    if (driveId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como archivo de trabajo.');
    }

    await eliminarHojasHistorialFormatoSgcF06(driveId);

    const tituloMes = nombreHojaMesActual();
    const titulos = await driveService.listarHojasGoogleSheet(driveId).catch(() => []);
    const tituloVigente = resolverTituloMesMasReciente(titulos, tituloMes);
    let tituloHoja = tituloVigente || (titulos.includes(tituloMes) ? tituloMes : null);

    if (tituloHoja) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveId, [tituloHoja]);
        } catch (err) {
            console.warn('[SGC-F-06] No se pudo eliminar hoja previa del mes:', err.message);
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

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay Google Sheet SGC-F-06 configurado para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-06] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }

    // Carta, horizontal, márgenes estrechos, escala 80 %.
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: true,
        size: 'letter',
        margins: 'estrechos',
        scalePercent: 80
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-06 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
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
    descargarPlantillaPdf,
    sanitizarDatos
};
