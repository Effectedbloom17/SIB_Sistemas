/**
 * ATH-F-11 · Evaluación de desempeño — archivero de Google Docs.
 * Folio: ED-YY-NNN
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-11';
const TEMPLATE_DRIVE_ID = '10fvVzAiuTVoCva9QAYufIJmGbK1gMdZF3uBvW6Ohxyk';
/** Carpeta raíz ATH-F-11 (Historial > ATH-F-11) */
const CARPETA_RAIZ_DRIVE_ID = '1ZGJPr41Pa7sJ3SdzgLTyd8rGN5xkLAe1';
/** Word / Docs de cada evaluación */
const CARPETA_DRIVE_ID = '1qVOkXyoTR4071iNH-CmwT02usAy4LgVq';
/** PDFs firmados */
const CARPETA_PDF_FIRMADOS_ID = '1CdR7uikvU0zpBOgcxfciFb4E1NWcF-rL';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OFFICE_DOC_MIMES = new Set([
    DOCX_MIME,
    'application/msword'
]);

const COMPETENCIAS_DEFECTO = [
    { id: 'conocimiento_puesto', grupo: 'tecnicas', titulo: 'Conocimiento del puesto', descripcion: 'Aplica los conocimientos y habilidades requeridas para su función.', calificacion: null },
    { id: 'calidad_precision', grupo: 'tecnicas', titulo: 'Calidad y precisión del trabajo', descripcion: 'Cumple con estándares, reduce errores y mantiene orden.', calificacion: null },
    { id: 'responsabilidad_compromiso', grupo: 'organizacionales', titulo: 'Responsabilidad y compromiso', descripcion: 'Cumple normas, políticas internas y responsabilidades asignadas.', calificacion: null },
    { id: 'orientacion_resultados', grupo: 'organizacionales', titulo: 'Orientación a resultados', descripcion: 'Enfoca sus actividades al logro de objetivos y metas del área.', calificacion: null },
    { id: 'trabajo_equipo', grupo: 'interpersonales', titulo: 'Trabajo en equipo', descripcion: 'Colabora de manera efectiva y mantiene relaciones laborales positivas.', calificacion: null },
    { id: 'comunicacion_efectiva', grupo: 'interpersonales', titulo: 'Comunicación efectiva', descripcion: 'Expresa ideas con claridad y escucha activamente.', calificacion: null },
    { id: 'iniciativa_proactividad', grupo: 'personales', titulo: 'Iniciativa y proactividad', descripcion: 'Propone mejoras y actúa sin supervisión constante.', calificacion: null },
    { id: 'adaptabilidad_cambio', grupo: 'personales', titulo: 'Adaptabilidad al cambio', descripcion: 'Se ajusta positivamente a nuevos procesos o situaciones.', calificacion: null }
];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2026-03-04',
    fechaElaboracion: '2026-03-04',
    evaluaciones: [],
    evaluacionActivaId: null
};

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath11-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso().slice(0, 10);
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const crudo = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(crudo)) return crudo;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            let y = m[3];
            if (y.length === 2) y = `20${y}`;
            return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        }
        return crudo.slice(0, 10);
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

function anioCortoFolio(fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    return iso.slice(2, 4);
}

function normalizarFolio(folio) {
    const limpio = String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = limpio.match(/^ED-\d{2}-\d{3}$/);
    return m ? m[0] : limpio;
}

function parsearConsecutivoFolio(folio) {
    const norm = normalizarFolio(folio);
    const m = norm.match(/^ED-(\d{2})-(\d{3})$/);
    if (!m) return null;
    return { anio: m[1], consecutivo: Number(m[2]) };
}

function generarSiguienteFolio(evaluaciones = [], fechaIso = fechaHoyIso()) {
    const yy = anioCortoFolio(fechaIso);
    let max = 0;
    for (const ev of evaluaciones) {
        const parsed = parsearConsecutivoFolio(ev?.folio);
        if (parsed && parsed.anio === yy && parsed.consecutivo > max) {
            max = parsed.consecutivo;
        }
    }
    return `ED-${yy}-${String(max + 1).padStart(3, '0')}`;
}

function normalizarSaltos(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaRevDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function formatearFechaSlash(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

function sanitizarCalificacion(raw) {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    if (![6, 7, 8, 9, 10].includes(n)) return null;
    return n;
}

function sanitizarCompetencias(raw) {
    const mapa = new Map();
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const id = String(item?.id || '').trim();
            if (id) mapa.set(id, item);
        }
    }
    return COMPETENCIAS_DEFECTO.map((def) => {
        const found = mapa.get(def.id) || {};
        return {
            ...def,
            calificacion: sanitizarCalificacion(found.calificacion ?? found.score)
        };
    });
}

function calcularPromedio(competencias) {
    const vals = (competencias || [])
        .map((c) => c.calificacion)
        .filter((n) => n != null && !Number.isNaN(n));
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.round(avg * 100) / 100;
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'Evaluación firmada.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarEvaluacion(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const competencias = sanitizarCompetencias(base.competencias);
    const promedioManual = base.promedioGeneral ?? base.promedio_general;
    return {
        id: String(base.id || '').trim() || nuevoId(),
        folio: normalizarFolio(base.folio) || '',
        nombreCompleto: String(base.nombreCompleto || base.nombre_completo || '').trim(),
        puesto: String(base.puesto || '').trim(),
        areaDepartamento: String(base.areaDepartamento || base.area_departamento || '').trim(),
        noEmpleado: String(base.noEmpleado || base.no_empleado || '').trim(),
        fechaIngreso: formatearFechaIso(base.fechaIngreso || base.fecha_ingreso) || '',
        periodoEvaluado: String(base.periodoEvaluado || base.periodo_evaluado || '').trim(),
        evaluador: String(base.evaluador || '').trim(),
        usuarioId: String(base.usuarioId || base.usuario_id || '').trim() || null,
        competencias,
        observaciones: normalizarSaltos(base.observaciones || ''),
        promedioGeneral: (() => {
            const calc = calcularPromedio(competencias);
            if (calc != null) return calc;
            if (promedioManual === '' || promedioManual == null) return null;
            const n = Number(promedioManual);
            return Number.isNaN(n) ? null : n;
        })(),
        fortalezas: normalizarSaltos(base.fortalezas || ''),
        areasOportunidad: normalizarSaltos(base.areasOportunidad || base.areas_oportunidad || ''),
        planMejora: normalizarSaltos(base.planMejora || base.plan_mejora || ''),
        comentariosEvaluador: normalizarSaltos(base.comentariosEvaluador || base.comentarios_evaluador || ''),
        fechaEvaluacion: formatearFechaIso(base.fechaEvaluacion || base.fecha_evaluacion) || fechaHoyIso(),
        driveFileId: String(base.driveFileId || base.drive_file_id || '').trim() || null,
        nombreArchivo: String(base.nombreArchivo || base.nombre_archivo || '').trim() || null,
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        fechaCreacion: formatearFechaIso(base.fechaCreacion || base.fecha_creacion) || fechaHoyIso(),
        borrador: base.borrador !== false && !base.driveFileId && !base.drive_file_id
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const evaluaciones = (Array.isArray(base.evaluaciones) ? base.evaluaciones : [])
        .map(sanitizarEvaluacion)
        .filter((e) => e.folio || e.nombreCompleto || e.evaluador || e.driveFileId || e.pdfFirmado?.driveFileId);
    const activoId = String(base.evaluacionActivaId || base.evaluacion_activa_id || '').trim();
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        evaluaciones,
        evaluacionActivaId: activoId && evaluaciones.some((e) => e.id === activoId)
            ? activoId
            : (evaluaciones[0]?.id || null)
    };
}

function resolverEvaluacionActiva(datos) {
    const d = sanitizarDatos(datos);
    return d.evaluaciones.find((e) => e.id === d.evaluacionActivaId) || d.evaluaciones[0] || null;
}

function nombreArchivoDrive(folio) {
    const f = normalizarFolio(folio);
    return f || 'ATH-F-11 Evaluación de desempeño';
}

function nombrePdfFirmado(folio) {
    const f = normalizarFolio(folio) || 'sin-folio';
    return `${f} firmado.pdf`;
}

function clienteGoogle() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    return {
        auth,
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

async function resolverTemplateSourceId() {
    const { drive } = clienteGoogle();
    const meta = await drive.files.get({
        fileId: TEMPLATE_DRIVE_ID,
        fields: 'id,mimeType,shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });
    let sourceId = TEMPLATE_DRIVE_ID;
    let mimeType = String(meta?.data?.mimeType || '').trim();
    if (mimeType === 'application/vnd.google-apps.shortcut') {
        sourceId = String(meta?.data?.shortcutDetails?.targetId || '').trim() || sourceId;
        mimeType = String(meta?.data?.shortcutDetails?.targetMimeType || '').trim();
    }
    return { sourceId, mimeType };
}

async function copiarPlantillaComoGoogleDoc(nombreArchivo) {
    const { drive } = clienteGoogle();
    const { sourceId, mimeType } = await resolverTemplateSourceId();
    const esGoogleDoc = mimeType === GOOGLE_DOC_MIME;
    const esOffice = OFFICE_DOC_MIMES.has(mimeType);
    if (!esGoogleDoc && !esOffice) {
        throw new Error(
            `Plantilla ATH-F-11 incompatible (${mimeType || 'desconocido'}). Usa Google Docs o Word.`
        );
    }
    const body = {
        name: String(nombreArchivo || 'ATH-F-11 Evaluación de desempeño').trim(),
        parents: [CARPETA_DRIVE_ID]
    };
    if (!esGoogleDoc) {
        body.mimeType = GOOGLE_DOC_MIME;
    }
    const copyResp = await drive.files.copy({
        fileId: sourceId,
        requestBody: body,
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo crear el documento de evaluación desde la plantilla.');
    }
    return copyResp.data;
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = String(textoNuevo ?? '');
    if (!anterior.trim() || anterior === nuevo) {
        return null;
    }
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: false },
            replaceText: nuevo
        }
    };
}

async function aplicarContenidoEnDocumento(docId, evaluacion) {
    if (!docId || !evaluacion) return;
    const { docsApi } = clienteGoogle();
    const item = sanitizarEvaluacion(evaluacion);
    const requests = [];

    if (item.nombreCompleto) {
        requests.push(crearReplaceRequest(
            'Nombre completo: _____________________________________________________________________',
            `Nombre completo: ${item.nombreCompleto}`
        ));
    }
    if (item.puesto || item.areaDepartamento) {
        requests.push(crearReplaceRequest(
            'Puesto: __________________________ Área / Departamento: _______________________________',
            `Puesto: ${item.puesto || '__________________________'} Área / Departamento: ${item.areaDepartamento || '_______________________________'}`
        ));
    }
    if (item.periodoEvaluado || item.fechaIngreso) {
        const periodo = item.periodoEvaluado || '_____________________________________________________________________';
        const ingreso = formatearFechaSlash(item.fechaIngreso) || '____/_____/______';
        requests.push(crearReplaceRequest(
            'Periodo evaluado: _____________________________________________________________________ Fecha de ingreso: ____/_____/______',
            `Periodo evaluado: ${periodo} Fecha de ingreso: ${ingreso}`
        ));
        // Plantillas previas con líneas separadas
        if (item.periodoEvaluado) {
            requests.push(crearReplaceRequest(
                'Periodo evaluado: _____________________________________________________________________',
                `Periodo evaluado: ${item.periodoEvaluado}`
            ));
        }
        if (item.fechaIngreso) {
            requests.push(crearReplaceRequest(
                'Fecha de ingreso: ____/_____/______',
                `Fecha de ingreso: ${ingreso}`
            ));
        }
    }
    if (item.promedioGeneral != null) {
        requests.push(crearReplaceRequest(
            'Promedio general de desempeño',
            `Promedio general de desempeño: ${item.promedioGeneral}`
        ));
    }
    if (item.fortalezas) {
        requests.push(crearReplaceRequest('Fortalezas del colaborador', `Fortalezas del colaborador\n${item.fortalezas}`));
    }
    if (item.areasOportunidad) {
        requests.push(crearReplaceRequest('Áreas de oportunidad', `Áreas de oportunidad\n${item.areasOportunidad}`));
    }
    if (item.planMejora) {
        requests.push(crearReplaceRequest('Plan de mejora y desarrollo', `Plan de mejora y desarrollo\n${item.planMejora}`));
    }
    if (item.comentariosEvaluador) {
        requests.push(crearReplaceRequest(
            'Comentarios generales del evaluador',
            `Comentarios generales del evaluador\n${item.comentariosEvaluador}`
        ));
    }
    if (item.fechaEvaluacion) {
        requests.push(crearReplaceRequest(
            'Fecha de la evaluación: ____ / ____ / ______',
            `Fecha de la evaluación: ${formatearFechaSlash(item.fechaEvaluacion)}`
        ));
    }

    const unicos = [];
    const vistos = new Set();
    for (const req of requests.filter(Boolean)) {
        const key = JSON.stringify(req);
        if (!vistos.has(key)) {
            vistos.add(key);
            unicos.push(req);
        }
    }
    if (!unicos.length) return;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: unicos }
    });
}

async function asegurarDocumentoEvaluacion(evaluacion, sincronizarContenido = true) {
    const folio = normalizarFolio(evaluacion.folio) || nombreArchivoDrive(evaluacion.folio);
    let driveFileId = evaluacion.driveFileId;
    let nombre = evaluacion.nombreArchivo || nombreArchivoDrive(folio);

    if (!driveFileId) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreArchivoDrive(folio));
        driveFileId = copia.id;
        nombre = copia.name || nombreArchivoDrive(folio);
        if (sincronizarContenido) {
            await aplicarContenidoEnDocumento(driveFileId, evaluacion);
        }
        return { driveFileId, nombreArchivo: nombreArchivoDrive(folio), borrador: false };
    }

    const existe = await driveService.verificarArchivoExiste(driveFileId).catch(() => false);
    if (!existe) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreArchivoDrive(folio));
        driveFileId = copia.id;
        if (sincronizarContenido) {
            await aplicarContenidoEnDocumento(driveFileId, evaluacion);
        }
        return { driveFileId, nombreArchivo: nombreArchivoDrive(folio), borrador: false };
    }

    const nombreDeseado = nombreArchivoDrive(folio);
    if (nombre !== nombreDeseado) {
        await driveService.renombrarArchivoPorId(driveFileId, nombreDeseado).catch((err) => {
            console.warn('[ATH-F-11] No se pudo renombrar documento:', err.message);
        });
        nombre = nombreDeseado;
    }

    if (sincronizarContenido) {
        await aplicarContenidoEnDocumento(driveFileId, evaluacion);
    }
    return { driveFileId, nombreArchivo: nombre, borrador: false };
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

function construirRespuesta(registro, datos, opciones = {}) {
    const activa = resolverEvaluacionActiva(datos);
    const driveId = activa?.driveFileId || null;
    const editorUrl = driveId ? `https://docs.google.com/document/d/${driveId}/edit?usp=sharing` : null;
    const previewUrl = driveId ? `https://docs.google.com/document/d/${driveId}/preview` : null;
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive) || null,
        evaluacionActivaId: activa?.id || null,
        siguienteFolioSugerido: opciones.siguienteFolioSugerido || generarSiguienteFolio(datos.evaluaciones),
        fechaRevisionDisplay: formatearFechaRevDisplay(datos.fechaRevision)
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta(registro, datos, {
        siguienteFolioSugerido: generarSiguienteFolio(datos.evaluaciones)
    });
}

async function procesarEvaluacionesEnGuardado(datosEntrada, datosPrevios) {
    const prevMap = new Map((datosPrevios?.evaluaciones || []).map((e) => [e.id, e]));
    const activaId = String(datosEntrada?.evaluacionActivaId || '').trim();
    const salida = [];

    for (const raw of datosEntrada.evaluaciones) {
        const item = sanitizarEvaluacion(raw);
        const prev = prevMap.get(item.id);

        if (!item.folio) {
            item.folio = generarSiguienteFolio([
                ...salida,
                ...(datosEntrada.evaluaciones || []).filter((e) => e.id !== item.id)
            ]);
        }

        // La evaluación activa (o cualquiera ya no borrador / con Doc) se materializa en Drive.
        const debeMaterializar =
            item.id === activaId
            || !item.borrador
            || !!item.driveFileId
            || !!prev?.driveFileId;
        if (debeMaterializar && item.folio) {
            const doc = await asegurarDocumentoEvaluacion({
                ...item,
                driveFileId: item.driveFileId || prev?.driveFileId || null
            });
            item.driveFileId = doc.driveFileId;
            item.nombreArchivo = doc.nombreArchivo;
            item.borrador = false;
        }

        salida.push(item);
    }

    return sanitizarDatos({
        ...datosEntrada,
        evaluaciones: salida
    });
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
        return sincronizarDesdeDrive(pool, body);
    }

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const datosProcesados = await procesarEvaluacionesEnGuardado(datosEntrada, datosPrevios);
    const contenidoModificado = JSON.stringify(datosProcesados) !== JSON.stringify(datosPrevios);
    const fechaModificacion = contenidoModificado
        ? excelHistorial.fechaAhoraMexicoIso()
        : formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosProcesados,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado: contenidoModificado || !!registroPrevio?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosProcesados);
}

async function sincronizarDesdeDrive(pool, body = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const activaId = String(body?.evaluacionActivaId || body?.evaluacion_id || datos.evaluacionActivaId || '').trim();
    if (activaId) {
        datos.evaluacionActivaId = activaId;
    }
    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido,
        contenidoModificado: !!registro?.contenido_modificado,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });
    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datos);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const existe = await driveService.verificarArchivoExiste(TEMPLATE_DRIVE_ID).catch(() => false);
    if (!existe) {
        throw new Error('Plantilla ATH-F-11 no encontrada en Drive.');
    }
    return {
        codigo: CODIGO_FORMATO,
        templateDriveId: TEMPLATE_DRIVE_ID,
        message: 'La plantilla maestra ATH-F-11 está configurada. Las evaluaciones nuevas se generan como copia independiente.'
    };
}

function crearEvaluacionVacia(evaluaciones = []) {
    const folio = generarSiguienteFolio(evaluaciones);
    return sanitizarEvaluacion({
        id: nuevoId(),
        folio,
        borrador: true,
        fechaCreacion: fechaHoyIso(),
        fechaEvaluacion: fechaHoyIso()
    });
}

async function publicarPdfEnDrive(pdfBuffer, folio) {
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfFirmado(folio),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const evaluacionId = String(body?.evaluacionId || body?.evaluacion_id || '').trim();
    if (!evaluacionId) throw new Error('Se requiere evaluacionId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const evaluaciones = [...datosPrevios.evaluaciones];
    const idx = evaluaciones.findIndex((e) => e.id === evaluacionId);
    if (idx < 0) {
        throw new Error('No se encontró la evaluación indicada en el archivero.');
    }

    const actual = { ...evaluaciones[idx] };
    const driveResult = await publicarPdfEnDrive(pdfBuffer, actual.folio);
    actual.pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfFirmado(actual.folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    evaluaciones[idx] = actual;
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        evaluaciones,
        evaluacionActivaId: evaluacionId
    });

    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const registro = await obtenerRegistroDb(pool);
    const respuesta = construirRespuesta(registro, datosGuardar);
    return {
        ...respuesta,
        pdfFirmado: actual.pdfFirmado
    };
}

/**
 * Exporta a PDF el Google Doc de UNA evaluación (Word/Doc por folio).
 * Si aún no hay archivo en Drive, lo materializa antes de exportar.
 */
async function descargarPdfEvaluacion(pool, evaluacionId) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registro)) || { ...DATOS_DEFECTO, evaluaciones: [] };
    const id = String(evaluacionId || '').trim();
    let actual = id
        ? (datosPrevios.evaluaciones || []).find((e) => e.id === id)
        : resolverEvaluacionActiva(datosPrevios);
    if (!actual) {
        throw new Error('No hay evaluación seleccionada para descargar el PDF.');
    }

    const doc = await asegurarDocumentoEvaluacion(actual, true);
    actual = sanitizarEvaluacion({
        ...actual,
        driveFileId: doc.driveFileId,
        nombreArchivo: doc.nombreArchivo,
        borrador: false
    });

    const evaluaciones = (datosPrevios.evaluaciones || []).map((e) =>
        e.id === actual.id ? actual : e
    );
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        evaluaciones,
        evaluacionActivaId: actual.id
    });
    await guardarRegistroDb(pool, {
        driveFileId: null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true,
        ultimaSyncDrive: excelHistorial.fechaAhoraMexicoIso()
    });

    const pdfBuffer = await driveService.exportarArchivoPDF(doc.driveFileId);
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de la evaluación quedó vacía.');
    }

    const etiqueta = String(actual.nombreCompleto || actual.folio || 'evaluacion')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'evaluacion';
    return {
        pdfBuffer: Buffer.from(pdfBuffer),
        nombreArchivo: `ATH-F-11 ${etiqueta}.pdf`,
        folio: actual.folio,
        evaluacionId: actual.id,
        driveFileId: doc.driveFileId
    };
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_RAIZ_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_PDF_FIRMADOS_ID,
    COMPETENCIAS_DEFECTO,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    descargarPdfEvaluacion,
    sanitizarDatos,
    sanitizarEvaluacion,
    crearEvaluacionVacia,
    generarSiguienteFolio,
    calcularPromedio,
    resolverEvaluacionActiva
};
