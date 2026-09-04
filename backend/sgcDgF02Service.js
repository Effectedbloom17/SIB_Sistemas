/**
 * DG-F-02 · Alcance — persistencia en biznaga_sgc, plantilla Word y PDF en Drive (DG-F).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-02';
const CARPETA_DRIVE_ID = '1xU8fO32D2eF-fwKRzRgAQKN7oo59dvLO';
const TEMPLATE_DRIVE_ID = '1XNThlQXDznpTDfEyiAobyL45HtNrup0A';
const DOCUMENTO_SISTEMA_DRIVE_ID_PREFERIDO = '1u6lOOpunb83isnYK__wG9IV9iH14eEzH';
const NOMBRE_PLANTILLA_DOCX = 'DG-F-02 Alcance.docx';
const NOMBRE_PLANTILLA_SISTEMA = 'DG-F-02 Alcance (sistema).docx';
const NOMBRE_PDF_ARCHIVO = 'DG-F-02 Alcance.pdf';
const TIMEZONE_MEXICO = 'America/Mexico_City';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-17',
    revision: '00',
    alcance:
        'El alcance del Sistema de Gestión de Calidad de Biznaga Risk and Tech comprende el servicio de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión; desde la firma de la cotización o contrato hasta la entrega del proyecto finalizado.',
    requisitosNoAplicables: '',
    pdfFirmado: null
};

const ESPACIO_ENTRE_PARRAFOS_DG_F02 = { magnitude: 10, unit: 'PT' };

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function htmlATextoPlano(html) {
    const texto = String(html || '');
    if (!texto.includes('<')) {
        return normalizarSaltosLinea(texto);
    }
    return normalizarSaltosLinea(
        texto
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
            .replace(/<\/div>\s*<div[^>]*>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
    );
}

function sanitizarHtmlCampo(html) {
    const texto = String(html || '').trim();
    if (!texto) {
        return '';
    }
    if (!texto.includes('<')) {
        return normalizarSaltosLinea(texto);
    }
    return texto
        .replace(/<(?!\/?(?:b|strong|br|p|div)\b)[^>]+>/gi, '')
        .replace(/<(b|strong|p|div)(?:\s[^>]*)?>/gi, '<$1>')
        .trim();
}

function extraerFrasesNegritas(html) {
    const limpio = sanitizarHtmlCampo(html);
    if (!limpio.includes('<')) {
        return [];
    }
    const frases = [];
    const re = /<(strong|b)>([\s\S]*?)<\/\1>/gi;
    let match = re.exec(limpio);
    while (match) {
        const frase = htmlATextoPlano(match[2]);
        if (frase.trim()) {
            frases.push(frase.trim());
        }
        match = re.exec(limpio);
    }
    return frases;
}

function construirMapaIndicesDoc(docData) {
    let plain = '';
    const starts = [];
    for (const el of docData?.body?.content || []) {
        if (!el.paragraph) {
            continue;
        }
        for (const pe of el.paragraph.elements || []) {
            if (!pe.textRun?.content) {
                continue;
            }
            const start = pe.startIndex ?? 0;
            for (let i = 0; i < pe.textRun.content.length; i += 1) {
                starts.push(start + i);
            }
            plain += pe.textRun.content;
        }
    }
    return { plain, starts };
}

function crearRequestsNegrita(docData, frases) {
    if (!frases.length) {
        return [];
    }
    const { plain, starts } = construirMapaIndicesDoc(docData);
    const requests = [];
    const usados = new Set();

    for (const frase of frases) {
        let pos = 0;
        while (pos < plain.length) {
            const idx = plain.indexOf(frase, pos);
            if (idx === -1) {
                break;
            }
            const key = `${idx}:${frase.length}`;
            if (!usados.has(key) && starts[idx] != null && starts[idx + frase.length - 1] != null) {
                usados.add(key);
                requests.push({
                    updateTextStyle: {
                        range: {
                            startIndex: starts[idx],
                            endIndex: starts[idx + frase.length - 1] + 1
                        },
                        textStyle: { bold: true },
                        fields: 'bold'
                    }
                });
            }
            pos = idx + frase.length;
        }
    }
    return requests;
}

async function aplicarFormatoHtmlEnDocCampo(docsApi, docId, html, estiloRef = null) {
    const frases = extraerFrasesNegritas(html);
    if (!frases.length) {
        return;
    }
    const doc = await docsApi.documents.get({ documentId: docId });
    const requests = crearRequestsNegrita(doc.data, frases);
    if (!requests.length) {
        return;
    }
    if (estiloRef) {
        for (const req of requests) {
            req.updateTextStyle.textStyle.fontSize = estiloRef.fontSize;
            req.updateTextStyle.textStyle.weightedFontFamily = estiloRef.weightedFontFamily;
            req.updateTextStyle.fields = 'bold,fontSize,weightedFontFamily';
        }
    }
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}

async function aplicarFormatoHtmlEnDoc(docsApi, docId, datos) {
    await aplicarFormatoHtmlEnDocCampo(docsApi, docId, datos.alcance);
}

function analizarParrafosDoc(docData) {
    const parrafos = [];
    for (const el of docData?.body?.content || []) {
        if (!el.paragraph) {
            continue;
        }
        let text = '';
        let startIndex = null;
        let endIndex = null;
        let textStyle = null;
        const paragraphStyle = el.paragraph.paragraphStyle || null;
        for (const pe of el.paragraph.elements || []) {
            if (!pe.textRun?.content) {
                continue;
            }
            text += pe.textRun.content;
            if (startIndex === null && pe.startIndex != null) {
                startIndex = pe.startIndex;
            }
            if (pe.endIndex != null) {
                endIndex = pe.endIndex;
            }
            if (!textStyle && pe.textRun.textStyle) {
                textStyle = pe.textRun.textStyle;
            }
        }
        if (startIndex == null || endIndex == null) {
            continue;
        }
        parrafos.push({ text, startIndex, endIndex, textStyle, paragraphStyle });
    }
    return parrafos;
}

const ESTILO_CUERPO_DG_F02 = {
    fontSize: { magnitude: 12, unit: 'PT' },
    weightedFontFamily: { fontFamily: 'Century Gothic', weight: 400 }
};


/** Un solo salto de línea entre bloques HTML; evita párrafos vacíos en Google Docs. */
function htmlATextoPlanoParaDocumento(html) {
    const texto = String(html || '');
    if (!texto.includes('<')) {
        return normalizarSaltosLinea(texto).replace(/\n{2,}/g, '\n');
    }
    return normalizarSaltosLinea(
        texto
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
            .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
    ).replace(/\n{2,}/g, '\n');
}

function estiloParrafoCuerpoCompacto(docData, opciones = {}) {
    const ref = estiloParrafoReferenciaDesdeDoc(docData);
    const espacioRef = ref?.spaceBelow?.magnitude;
    const espacioEntre = espacioRef >= 4 && espacioRef <= 12
        ? ref.spaceBelow
        : ESPACIO_ENTRE_PARRAFOS_DG_F02;
    return {
        alignment: ref?.alignment || 'CENTER',
        lineSpacing: 100,
        spaceAbove: { magnitude: 0, unit: 'PT' },
        spaceBelow: opciones.esUltimo ? { magnitude: 0, unit: 'PT' } : espacioEntre
    };
}

function crearRequestEstiloParrafoCompacto(parrafo, paraStyle) {
    return {
        updateParagraphStyle: {
            range: normalizarRangoDeleteGoogleDoc(parrafo.startIndex, parrafo.endIndex),
            paragraphStyle: paraStyle,
            fields: 'alignment,lineSpacing,spaceAbove,spaceBelow'
        }
    };
}

function fontSizeReferenciaValida(textStyle) {
    const mag = textStyle?.fontSize?.magnitude;
    return mag && mag >= 10 ? textStyle.fontSize : null;
}

function estiloCuerpoReferenciaDesdeDoc(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxAlcance = parrafos.findIndex((p) => /^ALCANCE/i.test(p.text.trim()));
    const cuerpo = idxAlcance >= 0 ? parrafos[idxAlcance + 1] : null;
    const base = cuerpo?.textStyle || {};
    return {
        fontSize: fontSizeReferenciaValida(base) || ESTILO_CUERPO_DG_F02.fontSize,
        weightedFontFamily: base.weightedFontFamily || ESTILO_CUERPO_DG_F02.weightedFontFamily,
        foregroundColor: base.foregroundColor || undefined
    };
}

function estiloCuerpoRequisitosReferencia(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxHeading = parrafos.findIndex((p) => /REQUISITOS\s+NO\s+APLICABLES/i.test(p.text));
    const cuerpoReq = idxHeading >= 0 ? parrafos[idxHeading + 1] : null;
    const base = cuerpoReq?.textStyle || {};
    return {
        fontSize: fontSizeReferenciaValida(base) || ESTILO_CUERPO_DG_F02.fontSize,
        weightedFontFamily: base.weightedFontFamily || ESTILO_CUERPO_DG_F02.weightedFontFamily,
        foregroundColor: base.foregroundColor || undefined
    };
}

function estiloParrafoReferenciaDesdeDoc(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxAlcance = parrafos.findIndex((p) => /^ALCANCE/i.test(p.text.trim()));
    return idxAlcance >= 0 ? parrafos[idxAlcance + 1]?.paragraphStyle || null : null;
}

function crearRequestEstiloTexto(rango, estiloRef) {
    const textStyle = {
        fontSize: estiloRef.fontSize,
        weightedFontFamily: estiloRef.weightedFontFamily,
        bold: false
    };
    const fields = ['fontSize', 'weightedFontFamily', 'bold'];
    if (estiloRef.foregroundColor) {
        textStyle.foregroundColor = estiloRef.foregroundColor;
        fields.push('foregroundColor');
    }
    return {
        updateTextStyle: {
            range: rango,
            textStyle,
            fields: fields.join(',')
        }
    };
}

function crearRequestEstiloParrafo(parrafo, paragraphStyleRef) {
    if (!paragraphStyleRef) {
        return null;
    }
    const paraStyle = {};
    const paraFields = [];
    if (paragraphStyleRef.alignment) {
        paraStyle.alignment = paragraphStyleRef.alignment;
        paraFields.push('alignment');
    }
    if (paragraphStyleRef.lineSpacing != null) {
        paraStyle.lineSpacing = paragraphStyleRef.lineSpacing;
        paraFields.push('lineSpacing');
    }
    if (paragraphStyleRef.spaceAbove) {
        paraStyle.spaceAbove = paragraphStyleRef.spaceAbove;
        paraFields.push('spaceAbove');
    }
    if (paragraphStyleRef.spaceBelow) {
        paraStyle.spaceBelow = paragraphStyleRef.spaceBelow;
        paraFields.push('spaceBelow');
    }
    if (!paraFields.length) {
        return null;
    }
    return {
        updateParagraphStyle: {
            range: {
                startIndex: parrafo.startIndex,
                endIndex: Math.max(parrafo.startIndex + 1, parrafo.endIndex - 1)
            },
            paragraphStyle: paraStyle,
            fields: paraFields.join(',')
        }
    };
}

function crearRequestsEstiloCuerpo(rango, estiloRef, paragraphStyleRef) {
    const requests = [crearRequestEstiloTexto(rango, estiloRef)];
    const paraReq = paragraphStyleRef
        ? crearRequestEstiloParrafo(
            { startIndex: rango.startIndex, endIndex: rango.endIndex },
            paragraphStyleRef
        )
        : null;
    if (paraReq) {
        requests.push(paraReq);
    }
    return requests;
}

async function aplicarEstiloCuerpoRequisitos(docsApi, docId, docReferencia) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const existentes = obtenerParrafosRequisitosExistentes(doc.data);
    if (!existentes.length) {
        return;
    }
    const estiloRef = estiloCuerpoRequisitosReferencia(docReferencia);
    const contentStart = existentes[0].startIndex;
    const contentEnd = existentes[existentes.length - 1].endIndex;
    const rangoTexto = normalizarRangoDeleteGoogleDoc(contentStart, contentEnd);
    const requests = [crearRequestEstiloTexto(rangoTexto, estiloRef)];

    for (let i = 0; i < existentes.length; i += 1) {
        const esUltimo = i === existentes.length - 1;
        requests.push(crearRequestEstiloParrafoCompacto(
            existentes[i],
            estiloParrafoCuerpoCompacto(docReferencia, { esUltimo })
        ));
    }

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }
}

function normalizarRangoDeleteGoogleDoc(startIndex, endIndex) {
    return {
        startIndex,
        endIndex: Math.max(startIndex + 1, endIndex - 1)
    };
}

function obtenerContextoSeccionRequisitos(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxHeading = parrafos.findIndex((p) => /REQUISITOS\s+NO\s+APLICABLES/i.test(p.text));
    if (idxHeading === -1) {
        return null;
    }
    const heading = parrafos[idxHeading];
    const existentes = obtenerParrafosRequisitosExistentes(docData);
    return {
        heading,
        existentes,
        insertIndex: existentes.length ? existentes[0].startIndex : heading.endIndex
    };
}

function encontrarRangoContenidoRequisitos(docData) {
    const ctx = obtenerContextoSeccionRequisitos(docData);
    if (!ctx?.existentes.length) {
        return null;
    }
    const contentStart = ctx.existentes[0].startIndex;
    const contentEnd = ctx.existentes[ctx.existentes.length - 1].endIndex;
    if (contentStart == null || contentEnd == null || contentStart >= contentEnd) {
        return null;
    }
    return normalizarRangoDeleteGoogleDoc(contentStart, contentEnd);
}

function textoInsertarRequisitos(html) {
    const plain = htmlATextoPlanoParaDocumento(html);
    if (!plain.trim()) {
        return '';
    }
    const lineas = plain.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lineas.length) {
        return '';
    }
    return `${lineas.join('\n')}\n`;
}

function textoRequisitosDesdeParrafos(docData) {
    return obtenerParrafosRequisitosExistentes(docData)
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join('\n\n');
}

async function sincronizarRequisitosEnDocumento(docsApi, docId, datos) {
    const html = datos.requisitosNoAplicables ?? '';
    const doc = await docsApi.documents.get({ documentId: docId });
    const estiloRef = estiloCuerpoRequisitosReferencia(doc.data);
    const ctx = obtenerContextoSeccionRequisitos(doc.data);
    const textoInsertar = textoInsertarRequisitos(html);

    if (!ctx) {
        return;
    }

    const requests = [];
    let insertIndex = ctx.insertIndex;

    if (ctx.existentes.length) {
        const deleteStart = ctx.existentes[0].startIndex;
        const deleteEnd = ctx.existentes[ctx.existentes.length - 1].endIndex;
        requests.push({
            deleteContentRange: {
                range: normalizarRangoDeleteGoogleDoc(deleteStart, deleteEnd)
            }
        });
        insertIndex = deleteStart;
    }

    if (textoInsertar.trim()) {
        requests.push({
            insertText: { location: { index: insertIndex }, text: textoInsertar }
        });
    }

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }

    if (textoInsertar.trim()) {
        await aplicarEstiloCuerpoRequisitos(docsApi, docId, doc.data);
        await aplicarFormatoHtmlEnDocCampo(docsApi, docId, html, estiloRef);
    }
}

function obtenerParrafosRequisitosExistentes(docData) {
    const parrafos = analizarParrafosDoc(docData);
    const idxHeading = parrafos.findIndex((p) => /REQUISITOS\s+NO\s+APLICABLES/i.test(p.text));
    if (idxHeading === -1) {
        return [];
    }
    const idxFin = parrafos.findIndex(
        (p, i) => i > idxHeading && (/Marisol|DIRECTORA\s+GENERAL|www\.biznaga/i.test(p.text))
    );
    const fin = idxFin > idxHeading ? idxFin : parrafos.length;
    return parrafos.slice(idxHeading + 1, fin).filter((p) => p.text.trim());
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
    if (fecha instanceof Date) {
        const isoUtc = dt.toISOString();
        if (/T00:00:00\.000Z$/.test(isoUtc)) {
            return isoUtc.slice(0, 10);
        }
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE_MEXICO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(dt);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function formatearFechaIso(fecha) {
    return formatearFechaIsoMexico(fecha);
}

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
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
        timeZone: TIMEZONE_MEXICO,
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

function fechaHoyIso() {
    return formatearFechaIsoMexico(new Date());
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

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotPlantillaDesdeDatos(raw);
}

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    if (Number.isNaN(num)) {
        return '01';
    }
    return String(num + 1).padStart(2, '0');
}

function formatearRevisionPlantillaDoc(revision) {
    return String(revision || DATOS_DEFECTO.revision).trim().padStart(2, '0');
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    return {
        empresa: base.empresa,
        alcance: base.alcance,
        requisitosNoAplicables: base.requisitosNoAplicables,
        fechaElaboracion: base.fechaElaboracion,
        revision: base.revision
    };
}

/** Tras cambiar de plantilla Word, el snapshot guardado puede no existir en el .docx nuevo. */
function resolverSnapshotPlantilla(datos) {
    const sync = datos?.plantillaSync;
    if (!sync) {
        return snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
    }
    const alcanceSync = normalizarSaltosLinea(sync.alcance);
    if (alcanceSync.includes('comprende los servicios de consultoría')) {
        return snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
    }
    return snapshotPlantillaDesdeDatos(sync);
}

function snapshotParaReemplazo(snapshotAnterior) {
    if (!snapshotAnterior) {
        return snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
    }
    if (snapshotAnterior.plantillaSync) {
        return resolverSnapshotPlantilla(snapshotAnterior);
    }
    if (snapshotAnterior.alcance && !snapshotAnterior.pdfFirmado && !snapshotAnterior.plantillaSync) {
        return resolverSnapshotPlantilla({ plantillaSync: snapshotAnterior });
    }
    return snapshotPlantillaDesdeDatos(snapshotAnterior);
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

function crearReemplazosFecha(snapshot, destino) {
    const nuevo = `Fecha: ${formatearFechaPlantillaDoc(destino.fechaElaboracion)}`;
    const fechasAnteriores = new Set([
        formatearFechaPlantillaDoc(snapshot.fechaElaboracion),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaElaboracion),
        formatearFechaPlantillaDoc(destino.fechaElaboracion),
        '11-07-25',
        '17-07-25',
        '24-05-26'
    ]);
    if (snapshot.plantillaSync?.fechaElaboracion) {
        fechasAnteriores.add(formatearFechaPlantillaDoc(snapshot.plantillaSync.fechaElaboracion));
    }
    return [...fechasAnteriores]
        .filter((f) => f && `Fecha: ${f}` !== nuevo)
        .map((f) => crearReplaceRequest(`Fecha: ${f}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosRevision(snapshot, destino) {
    const revNuevo = formatearRevisionPlantillaDoc(destino.revision);
    const nuevo = `No. Rev: ${revNuevo}`;
    const revisiones = new Set([
        formatearRevisionPlantillaDoc(snapshot.revision),
        formatearRevisionPlantillaDoc(DATOS_DEFECTO.revision),
        formatearRevisionPlantillaDoc(destino.revision)
    ]);
    if (snapshot.plantillaSync?.revision) {
        revisiones.add(formatearRevisionPlantillaDoc(snapshot.plantillaSync.revision));
    }
    return [...revisiones]
        .filter((r) => `No. Rev: ${r}` !== nuevo)
        .map((r) => crearReplaceRequest(`No. Rev: ${r}`, nuevo))
        .filter(Boolean);
}

function construirRequestsPlantilla(snapshot, destino) {
    return [
        crearReemplazoTextoUnico(snapshot.alcance, destino.alcance),
        ...crearReemplazosRevision(snapshot, destino),
        ...crearReemplazosFecha(snapshot, destino)
    ].filter(Boolean);
}

function variantesTextoDocumento(texto) {
    const limpio = normalizarSaltosLinea(texto);
    const variantes = new Set([
        `${limpio} \n`,
        `${limpio}\n`,
        `${limpio} `,
        limpio,
        textoParrafoDoc(limpio)
    ]);
    const compacto = limpio.replace(/\n\n+/g, '\n');
    if (compacto !== limpio) {
        variantes.add(`${compacto} \n`);
        variantes.add(`${compacto}\n`);
        variantes.add(compacto);
    }
    return [...variantes].filter((v) => v.trim());
}

function crearReemplazoTextoUnico(textoAnterior, textoNuevo) {
    const anterior = htmlATextoPlano(textoAnterior);
    const nuevo = htmlATextoPlano(textoNuevo);
    if (!anterior || anterior === nuevo) {
        return null;
    }
    const nuevoDoc = textoParrafoDoc(nuevo);
    for (const variante of variantesTextoDocumento(anterior)) {
        const req = crearReplaceRequest(variante, nuevoDoc);
        if (req) {
            return req;
        }
    }
    return null;
}

async function buscarDocumentoSistemaEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_PLANTILLA_SISTEMA.toLowerCase();
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
        const resp = await drive.files.get({ fileId: id, fields: 'id, name, trashed' });
        if (resp.data.trashed) {
            return false;
        }
        return String(resp.data.name || '').toLowerCase() === NOMBRE_PLANTILLA_SISTEMA.toLowerCase();
    } catch {
        return false;
    }
}

async function resolverDocumentoSistemaId(datos) {
    const idDb = String(datos?.plantillaSistemaDriveFileId || '').trim();
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
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: NOMBRE_PLANTILLA_SISTEMA,
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id, name, webViewLink'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo crear el documento DG-F-02 Alcance (sistema).');
    }
    console.log(`[DG-F-02] Documento sistema creado en Drive: ${NOMBRE_PLANTILLA_SISTEMA} (${docId})`);
    return docId;
}

async function asegurarDocumentoSistema(datos) {
    const existente = await resolverDocumentoSistemaId(datos);
    if (existente) {
        return { fileId: existente, newlyCreated: false };
    }
    const fileId = await crearDocumentoSistemaDesdePlantilla();
    return { fileId, newlyCreated: true };
}

function extraerTextoPlanoGoogleDoc(docData) {
    let text = '';
    for (const el of docData?.body?.content || []) {
        if (!el.paragraph) {
            continue;
        }
        for (const pe of el.paragraph.elements || []) {
            if (pe.textRun?.content) {
                text += pe.textRun.content;
            }
        }
    }
    return text;
}

function inferirSnapshotDesdeTextoDocumento(textoPlano) {
    const texto = normalizarSaltosLinea(textoPlano);
    const alcanceMatch = texto.match(/ALCANCE\s*\n+([\s\S]*?)\n+REQUISITOS/i);
    const reqMatch = texto.match(/REQUISITOS NO APLICABLES\s*\n+([\s\S]*?)(?:\n{3,}|Marisol|$)/i);
    const alcance = alcanceMatch ? normalizarSaltosLinea(alcanceMatch[1]) : '';
    const requisitosNoAplicables = reqMatch ? normalizarSaltosLinea(reqMatch[1]) : '';
    if (!alcance && !requisitosNoAplicables) {
        return null;
    }
    return {
        empresa: DATOS_DEFECTO.empresa,
        alcance: alcance || DATOS_DEFECTO.alcance,
        requisitosNoAplicables: requisitosNoAplicables,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion
    };
}

async function construirRequestsConFallbackDocumento(docsApi, docId, snapshotAnterior, destino) {
    let snapshot = snapshotParaReemplazo(snapshotAnterior);
    let requests = construirRequestsPlantilla(snapshot, destino);
    if (requests.length > 0) {
        return { snapshot, requests };
    }
    const doc = await docsApi.documents.get({ documentId: docId });
    const snapshotDoc = inferirSnapshotDesdeTextoDocumento(extraerTextoPlanoGoogleDoc(doc.data));
    if (snapshotDoc && !contenidoEsEquivalente(snapshotDoc, destino)) {
        snapshot = snapshotDoc;
        requests = construirRequestsPlantilla(snapshot, destino);
    }
    return { snapshot, requests };
}

async function copiarDocumentoComoGoogleDoc(sourceFileId) {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: sourceFileId,
        requestBody: {
            name: `_temp_dg_f02_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo abrir el documento sistema como Google Doc.');
    }
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
        NOMBRE_PLANTILLA_SISTEMA
    );
}

async function leerSnapshotDesdeGoogleDocApi(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    return inferirSnapshotDesdeTextoDocumento(extraerTextoPlanoGoogleDoc(doc.data));
}

async function resyncCompletoDesdePlantilla(datos, sistemaFileId) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarDocumentoComoGoogleDoc(TEMPLATE_DRIVE_ID);
    try {
        const requests = construirRequestsPlantilla(snapshotPlantillaDesdeDatos(DATOS_DEFECTO), destino);
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }
        await sincronizarRequisitosEnDocumento(docsApi, docId, datos);
        await aplicarFormatoHtmlEnDoc(docsApi, docId, datos);
        const snapshotDoc = await leerSnapshotDesdeGoogleDocApi(docsApi, docId);
        if (snapshotDoc && !contenidoEsEquivalente(snapshotDoc, destino)) {
            console.warn('[DG-F-02] Resync completo: verificación parcial del contenido en plantilla');
        }
        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return destino;
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-02] No se pudo eliminar copia temporal de resync:', err.message);
        }
    }
}

async function sincronizarPlantillaGoogleDoc(datos, snapshotAnterior, sistemaFileId, opciones = {}) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarDocumentoComoGoogleDoc(sistemaFileId);
    let docIdPendiente = docId;

    try {
        const snapshotBase = opciones.forzarSnapshotPlantilla
            ? snapshotPlantillaDesdeDatos(DATOS_DEFECTO)
            : snapshotAnterior;
        const { requests } = await construirRequestsConFallbackDocumento(
            docsApi,
            docId,
            snapshotBase,
            destino
        );

        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }

        await sincronizarRequisitosEnDocumento(docsApi, docId, datos);
        await aplicarFormatoHtmlEnDoc(docsApi, docId, datos);

        const snapshotDoc = await leerSnapshotDesdeGoogleDocApi(docsApi, docId);
        const destinoAlcance = htmlATextoPlano(destino.alcance);
        const docAlcance = htmlATextoPlano(snapshotDoc?.alcance);
        if (!snapshotDoc || docAlcance !== destinoAlcance) {
            await drive.files.delete({ fileId: docIdPendiente }).catch(() => {});
            docIdPendiente = null;
            const destinoResync = await resyncCompletoDesdePlantilla(datos, sistemaFileId);
            return { actualizado: true, plantillaSync: destinoResync };
        }

        if (snapshotDoc && !contenidoEsEquivalente(snapshotDoc, destino)) {
            await sincronizarRequisitosEnDocumento(docsApi, docId, datos);
        }

        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return { actualizado: true, plantillaSync: destino };
    } finally {
        if (docIdPendiente) {
            try {
                await drive.files.delete({ fileId: docIdPendiente });
            } catch (err) {
                console.warn('[DG-F-02] No se pudo eliminar copia temporal de plantilla:', err.message);
            }
        }
    }
}

async function exportarPdfDesdeGoogleDoc(drive, docId) {
    const pdfResp = await drive.files.export(
        { fileId: docId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(pdfResp.data);
}

async function exportarPdfSoloPrimeraPagina(drive, docId) {
    const pdfBuffer = await exportarPdfDesdeGoogleDoc(drive, docId);
    const { PDFDocument } = require('pdf-lib');
    const source = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    if (source.getPageCount() <= 1) {
        return pdfBuffer;
    }
    const destino = await PDFDocument.create();
    const [pagina] = await destino.copyPages(source, [0]);
    destino.addPage(pagina);
    return Buffer.from(await destino.save());
}

async function buscarPdfEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) {
            return sanitizarPdfFirmado(pdfDb);
        }
    }

    const enDrive = await buscarPdfEnDrive();
    if (!enDrive?.id) {
        return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
    }

    return sanitizarPdfFirmado({
        driveFileId: enDrive.id,
        nombreArchivo: enDrive.name || NOMBRE_PDF_ARCHIVO,
        webViewLink: enDrive.webViewLink || null,
        fechaSubida: enDrive.modifiedTime || fechaHoyIso()
    });
}

async function publicarPdfEnDrive(pdfBuffer) {
    const nombreArchivo = nombrePdfHistorial();
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: formatearRevisionPlantillaDoc(base.revision),
        alcance: sanitizarHtmlCampo(base.alcance || DATOS_DEFECTO.alcance) || DATOS_DEFECTO.alcance,
        requisitosNoAplicables: 'requisitosNoAplicables' in base
            ? sanitizarHtmlCampo(String(base.requisitosNoAplicables ?? ''))
            : DATOS_DEFECTO.requisitosNoAplicables,
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        plantillaSync,
        plantillaSistemaDriveFileId: String(base.plantillaSistemaDriveFileId || '').trim() || null
    };
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    return {
        empresa: base.empresa,
        alcance: htmlATextoPlano(base.alcance),
        requisitosNoAplicables: htmlATextoPlano(base.requisitosNoAplicables)
    };
}

function normalizarComparacionRequisitos(texto) {
    return htmlATextoPlano(texto).replace(/\s+/g, ' ').trim();
}

function contenidoEsEquivalente(a, b) {
    const ea = extraerContenidoEditable(a);
    const eb = extraerContenidoEditable(b);
    return ea.empresa === eb.empresa
        && ea.alcance === eb.alcance
        && normalizarComparacionRequisitos(ea.requisitosNoAplicables)
            === normalizarComparacionRequisitos(eb.requisitosNoAplicables);
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

function construirRespuesta(registro, datos) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion;
    const modificado = !!registro?.contenido_modificado;
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const fechaEnDatos = formatearFechaIso(datos.fechaElaboracion);
    const fechaMostrar = fechaEnDatos || (modificado && fechaMod ? fechaMod : fechaOriginal);
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            pdfFirmado
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: modificado ? fechaMod : null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`,
        plantillaSistemaDriveFileId: datos.plantillaSistemaDriveFileId || null,
        plantillaSistemaEditorUrl: datos.plantillaSistemaDriveFileId
            ? `https://docs.google.com/document/d/${datos.plantillaSistemaDriveFileId}/edit`
            : null
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

function payloadRegistroDesdeRegistro(registro, datos, pdfDriveFileId = null) {
    return {
        pdfDriveFileId: pdfDriveFileId ?? registro?.drive_file_id ?? datos?.pdfFirmado?.driveFileId ?? null,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido ?? null,
        contenidoModificado: !!registro?.contenido_modificado
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);

    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    let { fileId: sistemaFileId, newlyCreated: documentoNuevo } = await asegurarDocumentoSistema(datos);
    if (documentoNuevo) {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(
                datos,
                DATOS_DEFECTO,
                sistemaFileId,
                { forzarSnapshotPlantilla: true }
            );
            datos = {
                ...datos,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaSync: syncResult.plantillaSync
            };
            if (registro) {
                await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
                registro = await obtenerRegistroDb(pool);
            }
        } catch (err) {
            console.warn('[DG-F-02] No se pudo sincronizar documento sistema recién creado:', err.message);
            datos = { ...datos, plantillaSistemaDriveFileId: sistemaFileId };
        }
    } else if (sistemaFileId !== datos.plantillaSistemaDriveFileId) {
        datos = { ...datos, plantillaSistemaDriveFileId: sistemaFileId };
        if (registro) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
            registro = await obtenerRegistroDb(pool);
        }
    }

    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos, pdfResuelto.driveFileId));
            registro = await obtenerRegistroDb(pool);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            ultima_sync_drive: null
        };
    }

    return construirRespuesta(registro, datos);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let revision = formatearRevisionPlantillaDoc(datosEntrada.revision);
    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

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

    const huboCambioContenido = datosPrevios
        ? !contenidoEsEquivalente(datosPrevios, datosEntrada)
        : !contenidoEsEquivalente(DATOS_DEFECTO, datosEntrada);

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const { fileId: sistemaFileId } = await asegurarDocumentoSistema(datosPrevios || datosEntrada);

    if (huboCambioContenido && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    if (datosPrevios?.revision) {
        revision = formatearRevisionPlantillaDoc(datosPrevios.revision);
    }
    if (huboCambioContenido && origen !== 'consulta') {
        revision = incrementarRevision(revision);
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        empresa: datosEntrada.empresa,
        alcance: datosEntrada.alcance,
        requisitosNoAplicables: datosEntrada.requisitosNoAplicables,
        fechaElaboracion,
        revision,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        plantillaSync: datosPrevios?.plantillaSync || null,
        plantillaSistemaDriveFileId: sistemaFileId
    };

    if (origen !== 'consulta') {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(
                datosGuardar,
                datosPrevios || DATOS_DEFECTO,
                sistemaFileId
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
        } catch (err) {
            console.error('[DG-F-02] Error sincronizando documento sistema en Drive:', err.message);
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
    return construirRespuesta(registro, datosGuardar);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const driveResult = await publicarPdfEnDrive(pdfBuffer);

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const datosGuardar = { ...datosPrevios, pdfFirmado };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;

    await guardarRegistroDb(pool, {
        ...payloadRegistroDesdeRegistro(registroPrevio, datosGuardar),
        pdfDriveFileId: pdfFirmado.driveFileId,
        fechaElaboracionOriginal: fechaOriginal
    });

    const registro = await obtenerRegistroDb(pool);
    return { ...construirRespuesta(registro, datosGuardar), pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    const respuesta = await cargarFormato(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = respuesta.datos;
    const { fileId: sistemaFileId, newlyCreated } = await asegurarDocumentoSistema(datos);

    const syncResult = await sincronizarPlantillaGoogleDoc(
        datos,
        newlyCreated ? DATOS_DEFECTO : (datos.plantillaSync || resolverSnapshotPlantilla(datos)),
        sistemaFileId,
        { forzarSnapshotPlantilla: newlyCreated }
    );

    let pdfBuffer;
    const { drive, docId } = await copiarDocumentoComoGoogleDoc(sistemaFileId);
    try {
        pdfBuffer = await exportarPdfSoloPrimeraPagina(drive, docId);
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-02] No se pudo eliminar copia temporal para PDF:', err.message);
        }
    }

    const datosActuales = (await leerDatosRegistro(registro)) || datos;
    const datosActualizados = {
        ...datosActuales,
        plantillaSistemaDriveFileId: sistemaFileId,
        plantillaSync: syncResult.plantillaSync || datosActuales.plantillaSync || null
    };
    await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datosActualizados));

    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_PLANTILLA_SISTEMA,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    sanitizarDatos
};
