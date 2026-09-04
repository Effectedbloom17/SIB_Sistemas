/**
 * DG-F-03 · Objetivos de calidad — persistencia en biznaga_sgc y documento de trabajo en Drive.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-03';
const CARPETA_DRIVE_ID = '1RdZqgzvNXj4kL4rj9z6coO7msnXyECOO';
const TEMPLATE_DRIVE_ID = '17KgKyFPLNuxmwSx0DYjg_JIQ4zjHOWNJ';
/** Documento de trabajo en Drive (sistema).docx — enlace oficial del formato. */
const DOCUMENTO_SISTEMA_DRIVE_ID_PREFERIDO = '1WfvG2rQKY_Hugj65BhNbEnxhpGznDmBg';
const NOMBRE_DOCUMENTO_SISTEMA = 'DG-F-03 Objetivos de calidad (sistema).docx';
const NOMBRE_PDF_ARCHIVO = 'DG-F-03 Objetivos de calidad.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ESTILO_TEXTO_OBJETIVOS = {
    fontSize: { magnitude: 12, unit: 'PT' },
    weightedFontFamily: { fontFamily: 'Century Gothic', weight: 400 }
};
const ESPACIO_ANTES_OBJETIVOS_PT = 12;
/** Una línea vacía entre el título y el cuerpo del documento. */
const ESPACIADO_LINEAS_TRAS_TITULO = '\n\n';
/** Sangría Word: izquierda 1.50 cm, primera línea 0.75 cm. */
const SANGRIA_IZQUIERDA_CM = 1.5;
const SANGRIA_PRIMERA_LINEA_CM = 0.75;

function cmAPuntos(cm) {
    return (Number(cm) * 72) / 2.54;
}

const TIMEZONE_MEXICO = 'America/Mexico_City';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-11',
    revision: '00',
    objetivos: [
        'Lograr la satisfacción de nuestros clientes.',
        'Implementar acciones que permitan mejorar continuamente el desempeño de nuestros procesos.',
        'Mejorar la eficacia de nuestro Sistema de Gestión de Calidad.'
    ].join('\n'),
    firmante: 'Marisol Azucena Santillán Melo',
    cargoFirmante: 'DIRECTORA GENERAL',
    pdfFirmado: null,
    documentoSistemaDriveFileId: null,
    plantillaDriveFileId: TEMPLATE_DRIVE_ID
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

function nombrePdfHistorial(fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    return `${NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '')} - ${mm}/${yy}.pdf`;
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esNombrePdfDelFormato(nombre) {
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const n = String(nombre || '').trim();
    return n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()
        || new RegExp(`^${escaparRegex(base)} - \\d{2}/\\d{2}\\.pdf$`, 'i').test(n);
}

function formatearFechaIsoMexico(fecha) {
    if (!fecha) return '';
    if (typeof fecha === 'string') {
        const trimmed = fecha.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed.slice(0, 10))) {
            return trimmed.slice(0, 10);
        }
        if (/^\d{4}-\d{2}-\d{2}\s/.test(trimmed)) {
            return trimmed.slice(0, 10);
        }
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) {
        return String(fecha).slice(0, 10);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(dt);
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function normalizarObjetivosTexto(raw) {
    if (Array.isArray(raw)) {
        const items = raw.map((o) => String(o || '').trim()).filter(Boolean);
        return items.length ? items.join('\n') : DATOS_DEFECTO.objetivos;
    }
    const texto = normalizarSaltosLinea(raw);
    return texto || DATOS_DEFECTO.objetivos;
}


function quitarPrefijoNumeracion(linea) {
    return String(linea || '').trim().replace(/^\d+\.\s*/, '');
}

function extraerItemsObjetivos(texto) {
    return normalizarObjetivosTexto(texto)
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => quitarPrefijoNumeracion(l));
}

function canonicalizarObjetivosTexto(texto) {
    const items = extraerItemsObjetivos(texto);
    if (!items.length) return DATOS_DEFECTO.objetivos;
    if (items.length === 1) return items[0];
    return items.map((item, index) => `${index + 1}. ${item}`).join('\n\n');
}

function prepararTextoParaDocumento(texto) {
    const items = extraerItemsObjetivos(texto);
    if (!items.length) {
        return { cuerpo: '', usarNumeracion: false };
    }
    if (items.length === 1) {
        return { cuerpo: items[0], usarNumeracion: false };
    }
    const cuerpo = items.map((item, index) => `${index + 1}. ${item}`).join('\n\n');
    return { cuerpo, usarNumeracion: true };
}


function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        objetivos: normalizarObjetivosTexto(raw.objetivos),
        revision: String(raw.revision || DATOS_DEFECTO.revision).trim(),
        fechaElaboracion: formatearFechaIso(raw.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion
    };
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    return {
        objetivos: base.objetivos,
        revision: base.revision,
        fechaElaboracion: base.fechaElaboracion
    };
}

function formatearRevisionPlantillaDoc(revision) {
    return String(revision || DATOS_DEFECTO.revision).trim().padStart(2, '0');
}

function extraerFechasFooterDocumento(textoPlano) {
    const fechas = [];
    const re = /Fecha:\s*(\d{2}-\d{2}-\d{2})/gi;
    let match = re.exec(String(textoPlano || ''));
    while (match) {
        fechas.push(match[1]);
        match = re.exec(String(textoPlano || ''));
    }
    return fechas;
}

function extraerRevisionesFooterDocumento(textoPlano) {
    const revisiones = [];
    const re = /No\.\s*Rev:\s*(\d+)/gi;
    let match = re.exec(String(textoPlano || ''));
    while (match) {
        revisiones.push(match[1].padStart(2, '0'));
        match = re.exec(String(textoPlano || ''));
    }
    return revisiones;
}

function crearReemplazosFecha(snapshot, destino, textoDocumento = '') {
    const nuevo = `Fecha: ${formatearFechaPlantillaDoc(destino.fechaElaboracion)}`;
    const fechasAnteriores = new Set([
        formatearFechaPlantillaDoc(snapshot.fechaElaboracion),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaElaboracion),
        formatearFechaPlantillaDoc(destino.fechaElaboracion),
        '10-07-25',
        '11-07-25',
        '26-05-26',
        '28-05-26'
    ]);
    for (const f of extraerFechasFooterDocumento(textoDocumento)) {
        fechasAnteriores.add(f);
    }
    if (snapshot.plantillaSync?.fechaElaboracion) {
        fechasAnteriores.add(formatearFechaPlantillaDoc(snapshot.plantillaSync.fechaElaboracion));
    }
    return [...fechasAnteriores]
        .filter((f) => f && `Fecha: ${f}` !== nuevo)
        .map((f) => crearReplaceRequest(`Fecha: ${f}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosRevision(snapshot, destino, textoDocumento = '') {
    const revNuevo = formatearRevisionPlantillaDoc(destino.revision);
    const nuevo = `No. Rev: ${revNuevo}`;
    const revisiones = new Set([
        formatearRevisionPlantillaDoc(snapshot.revision),
        formatearRevisionPlantillaDoc(DATOS_DEFECTO.revision),
        formatearRevisionPlantillaDoc(destino.revision)
    ]);
    for (const r of extraerRevisionesFooterDocumento(textoDocumento)) {
        revisiones.add(r);
    }
    if (snapshot.plantillaSync?.revision) {
        revisiones.add(formatearRevisionPlantillaDoc(snapshot.plantillaSync.revision));
    }
    return [...revisiones]
        .filter((r) => `No. Rev: ${r}` !== nuevo)
        .map((r) => crearReplaceRequest(`No. Rev: ${r}`, nuevo))
        .filter(Boolean);
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = String(textoNuevo ?? '');
    if (!anterior.trim() || anterior === nuevo) return null;
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: false },
            replaceText: nuevo
        }
    };
}

function construirRequestsPie(snapshot, destino, textoDocumento = '') {
    return [
        ...crearReemplazosRevision(snapshot, destino, textoDocumento),
        ...crearReemplazosFecha(snapshot, destino, textoDocumento)
    ].filter(Boolean);
}

function analizarParrafosDoc(docData) {
    const parrafos = [];
    for (const el of docData?.body?.content || []) {
        if (!el.paragraph) continue;
        let text = '';
        let startIndex = null;
        let endIndex = null;
        for (const pe of el.paragraph.elements || []) {
            if (!pe.textRun?.content) continue;
            text += pe.textRun.content;
            if (startIndex === null && pe.startIndex != null) startIndex = pe.startIndex;
            if (pe.endIndex != null) endIndex = pe.endIndex;
        }
        if (startIndex == null || endIndex == null) continue;
        parrafos.push({ text, startIndex, endIndex });
    }
    return parrafos;
}

function normalizarRangoDeleteGoogleDoc(startIndex, endIndex) {
    return {
        startIndex,
        endIndex: Math.max(startIndex + 1, endIndex - 1)
    };
}

function obtenerParrafosObjetivosExistentes(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxHeading = parrafos.findIndex((p) => /OBJETIVOS\s+DE\s+CALIDAD/i.test(p.text));
    if (idxHeading === -1) return [];
    const idxFin = parrafos.findIndex(
        (p, i) => i > idxHeading && (/Marisol|DIRECTORA\s+GENERAL|Código:\s*DG-F-03|No\.\s*Rev:/i.test(p.text))
    );
    const fin = idxFin > idxHeading ? idxFin : parrafos.length;
    return parrafos.slice(idxHeading + 1, fin);
}

async function aplicarFormatoObjetivosEnDocumento(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const parrafos = obtenerParrafosObjetivosExistentes(doc.data);
    const contenido = parrafos.filter((p) => p.text.trim());
    if (!contenido.length) return;

    const requests = [];
    contenido.forEach((parrafo, index) => {
        const rango = normalizarRangoDeleteGoogleDoc(parrafo.startIndex, parrafo.endIndex);
        const esNumerado = /^\d+\.\s/.test(parrafo.text.trim());
        const paraStyle = {
            alignment: 'JUSTIFIED',
            lineSpacing: 115,
            ...(esNumerado ? {
                indentStart: { magnitude: cmAPuntos(SANGRIA_IZQUIERDA_CM), unit: 'PT' },
                indentFirstLine: { magnitude: cmAPuntos(SANGRIA_PRIMERA_LINEA_CM), unit: 'PT' }
            } : {}),
            ...(index === 0 ? {
                spaceAbove: { magnitude: ESPACIO_ANTES_OBJETIVOS_PT, unit: 'PT' }
            } : {})
        };
        const paraFields = [
            'alignment',
            'lineSpacing',
            ...(esNumerado ? ['indentStart', 'indentFirstLine'] : []),
            ...(index === 0 ? ['spaceAbove'] : [])
        ];

        requests.push({
            updateTextStyle: {
                range: rango,
                textStyle: { ...ESTILO_TEXTO_OBJETIVOS, bold: false },
                fields: 'fontSize,weightedFontFamily,bold'
            }
        });
        requests.push({
            updateParagraphStyle: {
                range: rango,
                paragraphStyle: paraStyle,
                fields: paraFields.join(',')
            }
        });
    });

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }
}

async function sincronizarObjetivosEnDocumento(docsApi, docId, objetivosTexto, docDataInicial = null) {
    const doc = docDataInicial
        ? { data: docDataInicial }
        : await docsApi.documents.get({ documentId: docId });
    const preparado = prepararTextoParaDocumento(objetivosTexto);
    const parrafos = analizarParrafosDoc(doc.data);
    const idxHeading = parrafos.findIndex((p) => /OBJETIVOS\s+DE\s+CALIDAD/i.test(p.text));
    if (idxHeading === -1) {
        throw new Error('No se encontró el título OBJETIVOS DE CALIDAD en el documento.');
    }

    const heading = parrafos[idxHeading];
    const existentes = obtenerParrafosObjetivosExistentes(doc.data);
    const textoInsertar = preparado.cuerpo ? `${ESPACIADO_LINEAS_TRAS_TITULO}${preparado.cuerpo}\n` : '';
    const requests = [];
    let insertIndex = heading.endIndex;

    if (existentes.length) {
        requests.push({
            deleteContentRange: {
                range: normalizarRangoDeleteGoogleDoc(
                    existentes[0].startIndex,
                    existentes[existentes.length - 1].endIndex
                )
            }
        });
        insertIndex = existentes[0].startIndex;
    }

    if (textoInsertar) {
        requests.push({
            insertText: { location: { index: insertIndex }, text: textoInsertar }
        });
    }

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
        await aplicarFormatoObjetivosEnDocumento(docsApi, docId);
    }
}

function inferirSnapshotDesdeTextoDocumento(textoPlano) {
    const texto = normalizarSaltosLinea(textoPlano);
    const match = texto.match(
        /OBJETIVOS DE CALIDAD\s*\n+([\s\S]*?)(?:\n{2,}Marisol|\nDIRECTORA GENERAL|\nNo\.\s*Rev:|Código:\s*DG-F-03|$)/i
    );
    if (!match) return null;
    const objetivos = normalizarSaltosLinea(match[1]);
    if (!objetivos) return null;

    const revMatch = texto.match(/No\.\s*Rev:\s*(\d+)/i);
    const fechaMatch = texto.match(/Fecha:\s*(\d{2}-\d{2}-\d{2})/i);
    let fechaElaboracion = DATOS_DEFECTO.fechaElaboracion;
    if (fechaMatch) {
        const [d, m, y] = fechaMatch[1].split('-');
        fechaElaboracion = `20${y}-${m}-${d}`;
    }

    return {
        objetivos,
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaElaboracion
    };
}

async function construirRequestsConFallbackDocumento(docsApi, docId, snapshotAnterior, destino) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const textoDoc = extraerTextoPlanoGoogleDoc(doc.data);
    let snapshot = inferirSnapshotDesdeTextoDocumento(textoDoc)
        || snapshotPlantillaDesdeDatos(snapshotAnterior || DATOS_DEFECTO);
    const requests = construirRequestsPie(snapshot, destino, textoDoc);
    return { snapshot, requests, docData: doc.data, textoDoc };
}

async function leerSnapshotDesdeGoogleDocApi(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    return inferirSnapshotDesdeTextoDocumento(extraerTextoPlanoGoogleDoc(doc.data));
}

async function buscarDocumentoSistemaEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    return (archivos || []).find((f) => String(f.name || '').toLowerCase() === objetivo) || null;
}

async function validarDocumentoSistemaEnDrive(fileId) {
    const id = String(fileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) {
        return false;
    }
    try {
        const auth = driveService.getAuthClient();
        if (!auth) {
            return false;
        }
        const drive = google.drive({ version: 'v3', auth });
        const resp = await drive.files.get({ fileId: id, fields: 'id, name, trashed, parents' });
        if (resp.data.trashed) {
            return false;
        }
        return String(resp.data.name || '').toLowerCase() === NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    } catch {
        return false;
    }
}

async function resolverDocumentoSistemaId(datos) {
    const idDb = String(datos?.documentoSistemaDriveFileId || '').trim();
    if (idDb && await validarDocumentoSistemaEnDrive(idDb)) {
        return idDb;
    }
    if (DOCUMENTO_SISTEMA_DRIVE_ID_PREFERIDO
        && await validarDocumentoSistemaEnDrive(DOCUMENTO_SISTEMA_DRIVE_ID_PREFERIDO)) {
        return DOCUMENTO_SISTEMA_DRIVE_ID_PREFERIDO;
    }
    const enDrive = await buscarDocumentoSistemaEnDrive();
    return enDrive?.id || null;
}

async function crearDocumentoSistemaDesdePlantilla() {
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });

    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: NOMBRE_DOCUMENTO_SISTEMA,
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id, webViewLink, modifiedTime, mimeType'
    });

    const fileId = copyResp?.data?.id;
    if (!fileId) {
        throw new Error('No se pudo crear el documento DG-F-03 (sistema) desde la plantilla.');
    }

    console.log(`[DG-F-03] Documento sistema creado en Drive: ${NOMBRE_DOCUMENTO_SISTEMA} (${fileId})`);
    return fileId;
}

async function asegurarDocumentoSistema(datos) {
    const existente = await resolverDocumentoSistemaId(datos);
    if (existente) {
        return { fileId: existente, newlyCreated: false };
    }
    const fileId = await crearDocumentoSistemaDesdePlantilla();
    return { fileId, newlyCreated: true };
}

async function copiarDocumentoComoGoogleDoc(sourceFileId) {
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: sourceFileId,
        requestBody: {
            name: `_temp_dg_f03_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) throw new Error('No se pudo abrir el documento sistema como Google Doc.');
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

async function persistirDocumentoSistema(drive, docId, sistemaFileId) {
    const docxResp = await drive.files.export(
        { fileId: docId, mimeType: DOCX_MIME },
        { responseType: 'arraybuffer' }
    );
    await driveService.reemplazarArchivoEnDrive(
        sistemaFileId,
        Buffer.from(docxResp.data),
        DOCX_MIME,
        NOMBRE_DOCUMENTO_SISTEMA
    );
}

function extraerTextoPlanoGoogleDoc(docData) {
    let text = '';
    for (const el of docData?.body?.content || []) {
        if (!el.paragraph) continue;
        for (const pe of el.paragraph.elements || []) {
            if (pe.textRun?.content) text += pe.textRun.content;
        }
    }
    return text;
}

async function resyncCompletoDesdePlantilla(datos, sistemaFileId) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarDocumentoComoGoogleDoc(TEMPLATE_DRIVE_ID);
    try {
        const doc = await docsApi.documents.get({ documentId: docId });
        await sincronizarObjetivosEnDocumento(docsApi, docId, destino.objetivos, doc.data);
        const textoDoc = extraerTextoPlanoGoogleDoc(doc.data);
        const requests = construirRequestsPie(
            snapshotPlantillaDesdeDatos(DATOS_DEFECTO),
            destino,
            textoDoc
        );
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
        }
        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return destino;
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-03] No se pudo eliminar copia temporal de resync:', err.message);
        }
    }
}

async function sincronizarDocumentoSistema(datos, snapshotAnterior, sistemaFileId, opciones = {}) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarDocumentoComoGoogleDoc(sistemaFileId);

    try {
        const snapshotBase = opciones.forzarSnapshotPlantilla
            ? snapshotPlantillaDesdeDatos(DATOS_DEFECTO)
            : (snapshotAnterior || DATOS_DEFECTO);
        const { requests, docData, textoDoc } = await construirRequestsConFallbackDocumento(
            docsApi,
            docId,
            snapshotBase,
            destino
        );

        await sincronizarObjetivosEnDocumento(docsApi, docId, destino.objetivos, docData);

        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
        }

        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        const snapshotDoc = await leerSnapshotDesdeGoogleDocApi(docsApi, docId);
        return {
            actualizado: true,
            plantillaSync: snapshotDoc || destino
        };
    } catch (err) {
        console.warn('[DG-F-03] Sync incremental falló, reintentando desde plantilla:', err.message);
        const plantillaSync = await resyncCompletoDesdePlantilla(datos, sistemaFileId);
        return { actualizado: true, plantillaSync };
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-03] No se pudo eliminar copia temporal de sync:', err.message);
        }
    }
}

async function asegurarDocumentoSistemaEnDrive(pool, datosActuales = null) {
    let registro = await obtenerRegistroDb(pool);
    let datos = sanitizarDatos(datosActuales || (await leerDatosRegistro(registro)) || DATOS_DEFECTO);
    let { fileId: sistemaFileId, newlyCreated } = await asegurarDocumentoSistema(datos);

    if (newlyCreated) {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datos,
                DATOS_DEFECTO,
                sistemaFileId,
                { forzarSnapshotPlantilla: true }
            );
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaDriveFileId: TEMPLATE_DRIVE_ID,
                plantillaSync: syncResult.plantillaSync
            };
        } catch (err) {
            console.warn('[DG-F-03] Sync inicial del documento sistema:', err.message);
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaDriveFileId: TEMPLATE_DRIVE_ID
            };
        }
        await guardarRegistroDb(pool, {
            pdfDriveFileId: datos.pdfFirmado?.driveFileId || registro?.drive_file_id || null,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    } else if (sistemaFileId !== datos.documentoSistemaDriveFileId) {
        datos = {
            ...datos,
            documentoSistemaDriveFileId: sistemaFileId,
            plantillaDriveFileId: TEMPLATE_DRIVE_ID
        };
        await guardarRegistroDb(pool, {
            pdfDriveFileId: datos.pdfFirmado?.driveFileId || registro?.drive_file_id || null,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    datos = sanitizarDatos(await leerDatosRegistro(registro));
    const archivoDrive = await driveService.obtenerInfoArchivo(sistemaFileId).catch(() => ({ id: sistemaFileId }));
    return { registro, datos, archivoDrive, sistemaFileId, newlyCreated };
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || NOMBRE_PDF_ARCHIVO).trim()
            || NOMBRE_PDF_ARCHIVO,
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        objetivos: canonicalizarObjetivosTexto(base.objetivos),
        firmante: String(base.firmante || DATOS_DEFECTO.firmante).trim(),
        cargoFirmante: String(base.cargoFirmante || DATOS_DEFECTO.cargoFirmante).trim(),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        documentoSistemaDriveFileId: String(base.documentoSistemaDriveFileId || '').trim() || null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaSync
    };
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    return {
        empresa: base.empresa,
        objetivos: base.objetivos,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(extraerContenidoEditable(a)) === JSON.stringify(extraerContenidoEditable(b));
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

async function buscarPdfEnFormatos() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) return sanitizarPdfFirmado(pdfDb);
    }
    const enDrive = await buscarPdfEnFormatos();
    if (!enDrive?.id) return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
    return sanitizarPdfFirmado({
        driveFileId: enDrive.id,
        nombreArchivo: enDrive.name || NOMBRE_PDF_ARCHIVO,
        webViewLink: enDrive.webViewLink || null,
        fechaSubida: enDrive.modifiedTime || fechaHoyIso()
    });
}

function construirRespuesta(registro, datos, archivoDrive = null) {
    const fechaOriginal = formatearFechaIsoMexico(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIsoMexico(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;

    const documentoSistemaDriveFileId = datos.documentoSistemaDriveFileId
        || archivoDrive?.id
        || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar, pdfFirmado, documentoSistemaDriveFileId },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(
            archivoDrive?.modifiedTime || registro?.ultima_sync_drive
        ),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        documentoSistemaDriveFileId,
        documentoSistemaEditorUrl: documentoSistemaDriveFileId
            ? `https://docs.google.com/document/d/${documentoSistemaDriveFileId}/edit`
            : null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const { registro, datos, archivoDrive } = await asegurarDocumentoSistemaEnDrive(pool);

    let datosFinales = datos;
    const pdfResuelto = await resolverPdfFirmado(datosFinales);
    if (pdfResuelto) {
        datosFinales = { ...datosFinales, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, {
                pdfDriveFileId: pdfResuelto.driveFileId,
                datos: datosFinales,
                fechaElaboracionOriginal: registro.fecha_elaboracion_original,
                fechaModificacionContenido: registro.fecha_modificacion_contenido,
                contenidoModificado: !!registro.contenido_modificado
            });
        }
    }

    const registroFinal = await obtenerRegistroDb(pool);
    const datosDb = sanitizarDatos(await leerDatosRegistro(registroFinal)) || datosFinales;
    return construirRespuesta(registroFinal, datosDb, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const { registro: registroPrevio, datos: datosBase, archivoDrive, sistemaFileId } = await asegurarDocumentoSistemaEnDrive(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let revision = datosEntrada.revision || DATOS_DEFECTO.revision;

    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

    const datosPrevios = sanitizarDatos(datosBase);
    if (datosPrevios) revision = datosPrevios.revision;

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const huboCambioContenido = !contenidoEsEquivalente(datosPrevios, datosEntrada);

    if (huboCambioContenido && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal;

    const datosGuardar = {
        empresa: datosEntrada.empresa,
        objetivos: datosEntrada.objetivos,
        firmante: datosEntrada.firmante,
        cargoFirmante: datosEntrada.cargoFirmante,
        revision,
        fechaElaboracion,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        documentoSistemaDriveFileId: sistemaFileId || datosPrevios.documentoSistemaDriveFileId,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaSync: datosPrevios?.plantillaSync || snapshotPlantillaDesdeDatos(datosPrevios)
    };

    if (datosGuardar.documentoSistemaDriveFileId && origen !== 'consulta') {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datosGuardar,
                datosPrevios?.plantillaSync || datosPrevios || DATOS_DEFECTO,
                datosGuardar.documentoSistemaDriveFileId
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
        } catch (err) {
            console.error('[DG-F-03] Error sincronizando documento sistema en Drive:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoActualizado = await driveService.obtenerInfoArchivo(datosGuardar.documentoSistemaDriveFileId).catch(() => archivoDrive);
    return construirRespuesta(registro, datosGuardar, archivoActualizado);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const { registro: registroPrevio, datos: datosPrevios, archivoDrive } = await asegurarDocumentoSistemaEnDrive(pool);

    const nombreArchivo = nombrePdfHistorial();
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const datosGuardar = { ...datosPrevios, pdfFirmado };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        pdfDriveFileId: pdfFirmado.driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return { ...construirRespuesta(registro, datosGuardar, archivoDrive), pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    const respuesta = await cargarFormato(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = respuesta.datos;
    const { fileId: sistemaFileId, newlyCreated } = await asegurarDocumentoSistema(datos);

    const syncResult = await sincronizarDocumentoSistema(
        datos,
        newlyCreated ? DATOS_DEFECTO : (datos.plantillaSync || snapshotPlantillaDesdeDatos(datos)),
        sistemaFileId,
        { forzarSnapshotPlantilla: newlyCreated }
    );

    const pdfBuffer = await driveService.exportarArchivoPDF(sistemaFileId);

    const datosActuales = (await leerDatosRegistro(registro)) || datos;
    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosActuales.pdfFirmado?.driveFileId || registro?.drive_file_id || null,
        datos: {
            ...datosActuales,
            documentoSistemaDriveFileId: sistemaFileId,
            plantillaSync: syncResult.plantillaSync || datosActuales.plantillaSync || null
        },
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido,
        contenidoModificado: !!registro?.contenido_modificado
    });

    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_DOCUMENTO_SISTEMA,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sincronizarDocumentoSistema,
    asegurarDocumentoSistemaEnDrive,
    sanitizarDatos,
    normalizarObjetivosTexto
};

