/**
 * ATH-F-09 · Cotización — archivero de Google Docs + PDF firmado en Drive.
 * Folio: SC-YY-NNN · Aceptada: AAA-SC-YY-NNN (iniciales de empresa).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-09';
const TEMPLATE_DRIVE_ID = '1hvmnBHHyGmNDnHEaAmXiwNup3m5PL2yu';
const CARPETA_DRIVE_ID = '1caeBZbxZN9PjgPhqUl0FP69uTd_1AHXr';
const CARPETA_PDF_FIRMADOS_ID = '170GMboxHBsaUl7nSu3-q8T1WHIKELZzE';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OFFICE_DOC_MIMES = new Set([
    DOCX_MIME,
    'application/msword'
]);

const PLACEHOLDERS_FOLIO = [
    'SC-XX-XXX',
    'SC-21-00X',
    'SC-26-001'
];

const DATOS_DEFECTO = {
    revision: '02',
    fechaRevision: '2026-08-27',
    fechaElaboracion: '2026-08-27',
    cotizaciones: [],
    cotizacionActivaId: null
};

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath09-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function normalizarFolioBase(folio) {
    const limpio = String(folio || '').trim().toUpperCase();
    const m = limpio.match(/SC-\d{2}-\d{3}$/);
    if (m) return m[0];
    const conPrefijo = limpio.match(/^[A-Z0-9]{2,4}-(SC-\d{2}-\d{3})$/);
    if (conPrefijo) return conPrefijo[1];
    return '';
}

function normalizarFolioCompleto(folio) {
    return String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
}

function extraerInicialesEmpresa(nombre) {
    const limpio = String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .trim();
    if (!limpio) return '';
    const palabras = limpio.split(/\s+/).filter((p) => p.length > 0);
    const stop = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SA', 'CV', 'SRL', 'SC']);
    const significativas = palabras.filter((p) => !stop.has(p));
    const base = significativas.length ? significativas : palabras;
    const siglas = base.map((p) => p[0]).join('').replace(/[^A-Z0-9]/g, '');
    if (siglas.length >= 3) return siglas.slice(0, 3);
    const primera = base[0] || palabras[0] || '';
    return primera.slice(0, 3).padEnd(3, 'X');
}

function folioAceptadoDesdeBase(folioBase, empresa) {
    const base = normalizarFolioBase(folioBase) || normalizarFolioBase(folioBase);
    if (!base) return '';
    const iniciales = extraerInicialesEmpresa(empresa);
    if (!iniciales) return base;
    return `${iniciales}-${base}`;
}

function parsearConsecutivoFolio(folio) {
    const norm = normalizarFolioCompleto(folio);
    const m = norm.match(/SC-(\d{2})-(\d{3})$/);
    if (!m) return null;
    return { anio: m[1], consecutivo: Number(m[2]) };
}

function generarSiguienteFolioBase(cotizaciones = [], fechaIso = fechaHoyIso()) {
    const yy = anioCortoFolio(fechaIso);
    let max = 0;
    for (const c of cotizaciones) {
        const candidatos = [c?.folio, c?.folioBase, c?.folioAnterior];
        for (const f of candidatos) {
            const parsed = parsearConsecutivoFolio(f);
            if (parsed && parsed.anio === yy && parsed.consecutivo > max) {
                max = parsed.consecutivo;
            }
        }
    }
    return `SC-${yy}-${String(max + 1).padStart(3, '0')}`;
}

const TERMINOS_DEFECTO = ['Término 1.', 'Término 2.', 'Término 3.'];
const ENTREGABLES_DEFECTO = ['Entregable 1.', 'Entregable 2.', 'Entregable 3.'];
const PRESUPUESTO_INTRO_DEFECTO =
    'El presupuesto de ejecución del trabajo solicitado será de la siguiente forma:';
const LUGAR_DEFECTO = 'Pachuca, Hidalgo';

const MESES_CARTA = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

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

function formatearFechaCartaLarga(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-').map(Number);
    const mes = MESES_CARTA[(m || 1) - 1] || '';
    return `${d} de ${mes} de ${y}`;
}

function textoCartaDocumento(lugar, fechaIso) {
    const lugarTxt = String(lugar || LUGAR_DEFECTO).trim() || LUGAR_DEFECTO;
    const fechaTxt = formatearFechaCartaLarga(fechaIso);
    return fechaTxt ? `${lugarTxt}, a ${fechaTxt}.` : `${lugarTxt}.`;
}

function sanitizarListaTexto(raw, defecto) {
    const lista = Array.isArray(raw)
        ? raw.map((t) => normalizarSaltos(t)).filter(Boolean)
        : [];
    return lista.length ? lista : [...defecto];
}

function sanitizarPresupuestoItem(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const costo = base.costoUnitario ?? base.costo_unitario;
    const importe = base.importe;
    return {
        descripcion: normalizarSaltos(base.descripcion || ''),
        costoUnitario: costo === '' || costo == null ? null : Number(costo),
        importe: importe === '' || importe == null ? null : Number(importe)
    };
}

function sanitizarPresupuestoItems(raw) {
    const lista = Array.isArray(raw) ? raw.map(sanitizarPresupuestoItem) : [];
    while (lista.length < 3) {
        lista.push(sanitizarPresupuestoItem({}));
    }
    return lista;
}

function recalcularTotalesPresupuesto(items) {
    const filas = sanitizarPresupuestoItems(items);
    let subtotal = 0;
    for (const row of filas) {
        if (row.importe != null && !Number.isNaN(row.importe)) {
            subtotal += row.importe;
        }
    }
    const iva = subtotal > 0 ? Math.round(subtotal * 0.16 * 100) / 100 : null;
    const total = subtotal > 0 ? Math.round((subtotal + (iva || 0)) * 100) / 100 : null;
    return { subtotal: subtotal || null, iva, total };
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'Cotización firmada.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function folioTienePrefijoEmpresa(folio) {
    return /^[A-Z0-9]{2,4}-SC-\d{2}-\d{3}$/.test(normalizarFolioCompleto(folio));
}

function inferirAceptadaCotizacion(cot) {
    const empresa = String(cot?.empresa || '').trim();
    const tienePdf = !!(cot?.pdfFirmado?.driveFileId);
    return tienePdf && !!empresa && folioTienePrefijoEmpresa(cot?.folio);
}

function sanitizarCotizacion(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const folioIngresado = normalizarFolioCompleto(base.folio);
    const folioBase = normalizarFolioBase(base.folioBase || folioIngresado) || '';
    const empresa = String(base.empresa || '').trim();
    const pdfFirmado = sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado);
    let folio = folioIngresado || folioBase;
    const aceptada = inferirAceptadaCotizacion({ folio, empresa, pdfFirmado });
    if (aceptada) {
        if (!folioTienePrefijoEmpresa(folio) && folioBase) {
            folio = folioAceptadoDesdeBase(folioBase, empresa) || folio;
        }
    } else if (folioBase) {
        folio = folioBase;
    }
    const presupuestoItems = sanitizarPresupuestoItems(base.presupuestoItems || base.presupuesto_items);
    const totales = recalcularTotalesPresupuesto(presupuestoItems);
    return {
        id: String(base.id || '').trim() || nuevoId(),
        folio: folio || folioBase,
        folioBase: folioBase || normalizarFolioBase(folio),
        folioAnterior: String(base.folioAnterior || base.folio_anterior || '').trim() || null,
        empresa,
        aceptada,
        driveFileId: String(base.driveFileId || base.drive_file_id || '').trim() || null,
        nombreArchivo: String(base.nombreArchivo || base.nombre_archivo || '').trim() || null,
        fechaCreacion: formatearFechaIso(base.fechaCreacion || base.fecha_creacion) || fechaHoyIso(),
        pdfFirmado,
        borrador: base.borrador !== false && !base.driveFileId && !base.drive_file_id,
        lugar: String(base.lugar || LUGAR_DEFECTO).trim() || LUGAR_DEFECTO,
        fechaCarta: formatearFechaIso(base.fechaCarta || base.fecha_carta) || fechaHoyIso(),
        destinatario: normalizarSaltos(base.destinatario || ''),
        atencion: normalizarSaltos(base.atencion || ''),
        terminos: sanitizarListaTexto(base.terminos, TERMINOS_DEFECTO),
        entregables: sanitizarListaTexto(base.entregables, ENTREGABLES_DEFECTO),
        presupuestoIntro: normalizarSaltos(base.presupuestoIntro || base.presupuesto_intro)
            || PRESUPUESTO_INTRO_DEFECTO,
        presupuestoItems,
        notas: sanitizarListaTexto(base.notas, []),
        subtotal: base.subtotal != null ? Number(base.subtotal) : totales.subtotal,
        iva: base.iva != null ? Number(base.iva) : totales.iva,
        total: base.total != null ? Number(base.total) : totales.total
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const cotizaciones = (Array.isArray(base.cotizaciones) ? base.cotizaciones : [])
        .map(sanitizarCotizacion)
        .filter((c) => c.folio || c.empresa || c.driveFileId);
    const activoId = String(base.cotizacionActivaId || base.cotizacion_activa_id || '').trim();
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        cotizaciones,
        cotizacionActivaId: activoId && cotizaciones.some((c) => c.id === activoId)
            ? activoId
            : (cotizaciones[0]?.id || null)
    };
}

function resolverCotizacionActiva(datos) {
    const d = sanitizarDatos(datos);
    return d.cotizaciones.find((c) => c.id === d.cotizacionActivaId) || d.cotizaciones[0] || null;
}

function nombreArchivoDrive(folio) {
    const f = normalizarFolioCompleto(folio);
    return f || 'ATH-F-09 Cotización';
}

function nombrePdfFirmado(folio) {
    const f = normalizarFolioCompleto(folio) || 'sin-folio';
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
            `Plantilla ATH-F-09 incompatible (${mimeType || 'desconocido'}). Usa Google Docs o Word.`
        );
    }
    const body = {
        name: String(nombreArchivo || 'ATH-F-09 Cotización').trim(),
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
        throw new Error('No se pudo crear el documento de cotización desde la plantilla.');
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

function candidatosReemplazoFolio(folioAnterior, folioNuevo) {
    const requests = [];
    const anterior = normalizarFolioCompleto(folioAnterior);
    const nuevo = normalizarFolioCompleto(folioNuevo);
    if (anterior && nuevo && anterior !== nuevo) {
        requests.push(crearReplaceRequest(anterior, nuevo));
    }
    const baseAnterior = normalizarFolioBase(anterior);
    const baseNuevo = normalizarFolioBase(nuevo);
    if (baseAnterior && baseNuevo && baseAnterior !== baseNuevo) {
        requests.push(crearReplaceRequest(baseAnterior, baseNuevo));
    }
    for (const ph of PLACEHOLDERS_FOLIO) {
        requests.push(crearReplaceRequest(ph, nuevo));
    }
    if (baseNuevo) {
        requests.push(crearReplaceRequest('SC-XX-XXX', baseNuevo));
        requests.push(crearReplaceRequest('SC-21-00X', baseNuevo));
    }
    return requests.filter(Boolean);
}

function candidatosReemplazoLista(plantillas, valores) {
    const requests = [];
    for (let i = 0; i < plantillas.length; i += 1) {
        const anterior = String(plantillas[i] || '').trim();
        const nuevo = String(valores[i] || plantillas[i] || '').trim();
        if (anterior && nuevo && anterior !== nuevo) {
            requests.push(crearReplaceRequest(anterior, nuevo));
        }
    }
    return requests;
}

function formatearMonedaDoc(valor) {
    if (valor == null || Number.isNaN(Number(valor))) return '';
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2
    }).format(Number(valor));
}

async function aplicarContenidoEnDocumento(docId, cotizacion, folioAnterior = null) {
    if (!docId || !cotizacion) return;
    const { docsApi } = clienteGoogle();
    const item = sanitizarCotizacion(cotizacion);
    const requests = [
        ...candidatosReemplazoFolio(folioAnterior, item.folio),
        crearReplaceRequest('Pachuca, Hidalgo, a 20 de mayo de 2020.', textoCartaDocumento(item.lugar, item.fechaCarta)),
        crearReplaceRequest('Pachuca, Hidalgo, a 20 de mayo de 2020', textoCartaDocumento(item.lugar, item.fechaCarta).replace(/\.$/, '')),
        crearReplaceRequest(
            PRESUPUESTO_INTRO_DEFECTO,
            item.presupuestoIntro || PRESUPUESTO_INTRO_DEFECTO
        ),
        ...candidatosReemplazoLista(TERMINOS_DEFECTO, item.terminos),
        ...candidatosReemplazoLista(ENTREGABLES_DEFECTO, item.entregables)
    ];
    if (item.empresa) {
        requests.push(crearReplaceRequest('Nombre de la empresa', item.empresa));
    }
    if (item.destinatario) {
        requests.push(crearReplaceRequest('Nombre del destinatario', item.destinatario));
    }
    if (item.atencion) {
        requests.push(crearReplaceRequest('Atención:', `Atención: ${item.atencion}`));
    }
    for (let i = 0; i < item.presupuestoItems.length; i += 1) {
        const row = item.presupuestoItems[i];
        const n = i + 1;
        if (row.descripcion) {
            requests.push(crearReplaceRequest(`Descripción ${n}`, row.descripcion));
        }
        const costo = formatearMonedaDoc(row.costoUnitario);
        const importe = formatearMonedaDoc(row.importe);
        if (costo) requests.push(crearReplaceRequest(`Costo ${n}`, costo));
        if (importe) requests.push(crearReplaceRequest(`Importe ${n}`, importe));
    }
    const subtotal = formatearMonedaDoc(item.subtotal);
    const iva = formatearMonedaDoc(item.iva);
    const total = formatearMonedaDoc(item.total);
    if (subtotal) requests.push(crearReplaceRequest('SUBTOTAL', subtotal));
    if (iva) requests.push(crearReplaceRequest('IVA', iva));
    if (total) requests.push(crearReplaceRequest('TOTAL', total));

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

async function aplicarFolioEnDocumento(docId, folioNuevo, folioAnterior = null) {
    if (!docId) return;
    const { docsApi } = clienteGoogle();
    const requests = candidatosReemplazoFolio(folioAnterior, folioNuevo);
    const unicos = [];
    const vistos = new Set();
    for (const req of requests) {
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

async function asegurarDocumentoCotizacion(cotizacion, folioAnterior = null, sincronizarContenido = true) {
    const folio = normalizarFolioCompleto(cotizacion.folio) || nombreArchivoDrive(cotizacion.folioBase);
    let driveFileId = cotizacion.driveFileId;
    let nombre = cotizacion.nombreArchivo || nombreArchivoDrive(folio);

    if (!driveFileId) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreArchivoDrive(folio));
        driveFileId = copia.id;
        nombre = copia.name || nombreArchivoDrive(folio);
        await aplicarFolioEnDocumento(driveFileId, folio, folioAnterior);
        if (sincronizarContenido) {
            await aplicarContenidoEnDocumento(driveFileId, cotizacion, folioAnterior);
        }
        return { driveFileId, nombreArchivo: nombreArchivoDrive(folio), borrador: false };
    }

    const existe = await driveService.verificarArchivoExiste(driveFileId).catch(() => false);
    if (!existe) {
        const copia = await copiarPlantillaComoGoogleDoc(nombreArchivoDrive(folio));
        driveFileId = copia.id;
        await aplicarFolioEnDocumento(driveFileId, folio, folioAnterior);
        if (sincronizarContenido) {
            await aplicarContenidoEnDocumento(driveFileId, cotizacion, folioAnterior);
        }
        return { driveFileId, nombreArchivo: nombreArchivoDrive(folio), borrador: false };
    }

    const nombreDeseado = nombreArchivoDrive(folio);
    if (nombre !== nombreDeseado) {
        await driveService.renombrarArchivoPorId(driveFileId, nombreDeseado).catch((err) => {
            console.warn('[ATH-F-09] No se pudo renombrar documento:', err.message);
        });
        nombre = nombreDeseado;
    }

    await aplicarFolioEnDocumento(driveFileId, folio, folioAnterior || cotizacion.folioAnterior);
    if (sincronizarContenido) {
        await aplicarContenidoEnDocumento(
            driveFileId,
            cotizacion,
            folioAnterior || cotizacion.folioAnterior
        );
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
    const activa = resolverCotizacionActiva(datos);
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
        cotizacionActivaId: activa?.id || null,
        siguienteFolioSugerido: opciones.siguienteFolioSugerido || generarSiguienteFolioBase(datos.cotizaciones)
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    return construirRespuesta(registro, datos, {
        siguienteFolioSugerido: generarSiguienteFolioBase(datos.cotizaciones)
    });
}

async function procesarCotizacionesEnGuardado(datosEntrada, datosPrevios) {
    const prevMap = new Map((datosPrevios?.cotizaciones || []).map((c) => [c.id, c]));
    const salida = [];

    for (const raw of datosEntrada.cotizaciones) {
        const item = sanitizarCotizacion(raw);
        const prev = prevMap.get(item.id);
        const folioAnterior = prev?.folio || item.folioAnterior || null;

        if (!item.folioBase && item.folio) {
            item.folioBase = normalizarFolioBase(item.folio);
        }
        if (!item.folio && item.folioBase) {
            item.folio = item.aceptada
                ? folioAceptadoDesdeBase(item.folioBase, item.empresa)
                : item.folioBase;
        }

        const debeMaterializar = !item.borrador || !!item.driveFileId || !!prev?.driveFileId;
        if (debeMaterializar && item.folio) {
            const doc = await asegurarDocumentoCotizacion(
                { ...item, driveFileId: item.driveFileId || prev?.driveFileId || null },
                folioAnterior
            );
            item.driveFileId = doc.driveFileId;
            item.nombreArchivo = doc.nombreArchivo;
            item.borrador = false;
        }

        salida.push(item);
    }

    return sanitizarDatos({
        ...datosEntrada,
        cotizaciones: salida
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

    const datosProcesados = await procesarCotizacionesEnGuardado(datosEntrada, datosPrevios);
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
    const activaId = String(body?.cotizacionActivaId || body?.cotizacion_id || datos.cotizacionActivaId || '').trim();
    if (activaId) {
        datos.cotizacionActivaId = activaId;
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
        throw new Error('Plantilla ATH-F-09 no encontrada en Drive.');
    }
    return {
        codigo: CODIGO_FORMATO,
        templateDriveId: TEMPLATE_DRIVE_ID,
        message: 'La plantilla maestra ATH-F-09 está configurada. Las cotizaciones nuevas se generan como copia independiente.'
    };
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
    const cotizacionId = String(body?.cotizacionId || body?.cotizacion_id || '').trim();
    if (!cotizacionId) throw new Error('Se requiere cotizacionId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const folioPropuesto = normalizarFolioCompleto(body?.folioPropuesto || body?.folio_propuesto || '');
    const aceptar = body?.aceptar !== false && body?.marcarAceptada !== false;

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const cotizaciones = [...datosPrevios.cotizaciones];
    const idx = cotizaciones.findIndex((c) => c.id === cotizacionId);
    if (idx < 0) {
        throw new Error('No se encontró la cotización indicada en el archivero.');
    }

    const actual = { ...cotizaciones[idx] };
    const folioAnterior = actual.folio;
    if (!actual.folioBase) {
        actual.folioBase = normalizarFolioBase(actual.folio) || generarSiguienteFolioBase(cotizaciones);
    }

    if (aceptar) {
        actual.aceptada = true;
        const folioNuevo = folioPropuesto
            || folioAceptadoDesdeBase(actual.folioBase, actual.empresa)
            || actual.folio;
        actual.folio = folioNuevo;
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, actual.folio);
    actual.pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfFirmado(actual.folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    if (actual.driveFileId || !actual.borrador) {
        const doc = await asegurarDocumentoCotizacion(actual, folioAnterior);
        actual.driveFileId = doc.driveFileId;
        actual.nombreArchivo = doc.nombreArchivo;
        actual.borrador = false;
    }

    cotizaciones[idx] = actual;
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        cotizaciones,
        cotizacionActivaId: cotizacionId
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
    const respuesta = await construirRespuesta(registro, datosGuardar);
    return {
        ...respuesta,
        pdfFirmado: actual.pdfFirmado,
        folioActualizado: actual.folio,
        aceptada: actual.aceptada
    };
}

function crearCotizacionVacia(cotizaciones = []) {
    const folioBase = generarSiguienteFolioBase(cotizaciones);
    return sanitizarCotizacion({
        id: nuevoId(),
        folio: folioBase,
        folioBase,
        empresa: '',
        aceptada: false,
        borrador: true,
        fechaCreacion: fechaHoyIso()
    });
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_PDF_FIRMADOS_ID,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    sanitizarDatos,
    sanitizarCotizacion,
    crearCotizacionVacia,
    generarSiguienteFolioBase,
    folioAceptadoDesdeBase,
    extraerInicialesEmpresa,
    resolverCotizacionActiva
};
