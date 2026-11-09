/**
 * DG-F-02 · Alcance — persistencia en biznaga_sgc, plantilla Word y PDF en Drive (DG-F).
 *
 * Flujo plantilla → sistema (análogo a GUIA-PLANTILLA-EXCEL-SGC.md):
 * - Plantilla externa (solo lectura): placeholders {{codigo}} {{num_rev}} {{fecha}}.
 * - Documento sistema: copia de trabajo en CARPETA_DRIVE_ID.
 * - Words viejos al regenerar (cambio de rev / plantilla): CARPETA_HISTORIAL_DRIVE_ID.
 * - Código / No. Rev / Fecha se rescatan de Lista Maestra (sgc_formato_metadatos / F-01).
 */
const crypto = require('crypto');
const { google } = require('googleapis');
const driveService = require('./driveService');
const pdfDescargaCache = require('./sgcPdfDescargaCache');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-02';
/** Carpeta de trabajo del Word sistema (DG-F-02). */
const CARPETA_DRIVE_ID = '1xU8fO32D2eF-fwKRzRgAQKN7oo59dvLO';
/** Historial de Versiones — Words sistema previos. */
const CARPETA_HISTORIAL_DRIVE_ID = '1-G8mPoNXykGaH4cFfg9J-RH6ACz_Z8G4';
/** Plantilla maestra Word (solo lectura / copy). */
const TEMPLATE_DRIVE_ID = '1wUZcyt1LzEzlQo_5mMSINaNkjjs4AhOk';
/** Subir al cambiar placeholders/estructura de contenido de la plantilla. */
const PLANTILLA_CONTENIDO_VERSION = 2;
const NOMBRE_PLANTILLA_DOCX = 'DG-F-02 Alcance.docx';
const NOMBRE_PLANTILLA_SISTEMA = 'DG-F-02 Alcance (sistema).docx';
const NOMBRE_PDF_ARCHIVO = 'DG-F-02 Alcance.pdf';
const TIMEZONE_MEXICO = 'America/Mexico_City';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-17',
    fechaRevision: '2025-07-11',
    revision: '00',
    alcance:
        'El alcance del Sistema de Gestión de Calidad de Biznaga Risk and Tech comprende el servicio de consultoría estratégica sobre gestión de la seguridad industrial, medio ambiente, salud ocupacional, protección civil y sistemas de gestión; desde la firma de la cotización o contrato hasta la entrega del proyecto finalizado.',
    requisitosNoAplicables: '',
    pdfFirmado: null,
    pdfsHistorial: []
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

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** DG-F-02 Alcance - MM/YY - 01.pdf (legado: ... - MM/YY.pdf) */
function siguienteVersionPdf(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const prefijo = `${base} - ${mm}/${yy}`;
    let max = 0;
    const fuentes = Array.isArray(historialDrive) ? historialDrive : [];
    const seen = new Set();
    for (const p of fuentes) {
        const n = String(p?.nombreArchivo || p?.name || '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const mVer = n.match(new RegExp(`^${escaparRegex(prefijo)} - (\\d{1,2})\\.pdf$`, 'i'));
        if (mVer) {
            max = Math.max(max, parseInt(mVer[1], 10) || 0);
            continue;
        }
        // Formato legado sin número de versión cuenta como versión ocupada
        if (new RegExp(`^${escaparRegex(prefijo)}\\.pdf$`, 'i').test(n)) {
            max = Math.max(max, 1);
        }
    }
    return String(max + 1).padStart(2, '0');
}

function nombrePdfHistorial(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const version = siguienteVersionPdf(iso, historialDrive);
    return `${base} - ${mm}/${yy} - ${version}.pdf`;
}

function esNombrePdfDelFormato(nombre) {
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const n = String(nombre || '').trim();
    return n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()
        || new RegExp(`^${escaparRegex(base)} - \\d{2}/\\d{2}( - \\d{1,2})?\\.pdf$`, 'i').test(n);
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

function sanitizarPdfsHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || seen.has(pdf.driveFileId)) continue;
        seen.add(pdf.driveFileId);
        out.push(pdf);
    }
    return out;
}

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotPlantillaDesdeDatos(raw);
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
        fechaRevision: base.fechaRevision,
        revision: base.revision,
        codigo: CODIGO_FORMATO
    };
}

/**
 * Cabecera oficial del Word: Código / No. Rev / Fecha ← Lista Maestra.
 * Prioridad: metadatos SGC → datos persistidos → catálogo F-01 → defecto.
 */
async function resolverCabeceraListaMaestra(pool, datosActuales = {}) {
    const base = sanitizarDatos(datosActuales);
    let revision = formatearRevisionPlantillaDoc(base.revision);
    let fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;
    let desdeMetadatos = false;

    if (pool) {
        try {
            const [rows] = await pool.query(
                `SELECT revision, fecha_original
                   FROM sgc_formato_metadatos
                  WHERE UPPER(TRIM(codigo_formato)) = ?
                  LIMIT 1`,
                [CODIGO_FORMATO]
            );
            const meta = rows?.[0];
            if (meta) {
                if (meta.revision != null && String(meta.revision).trim() !== '') {
                    revision = formatearRevisionPlantillaDoc(meta.revision);
                    desdeMetadatos = true;
                }
                const fechaMeta = formatearFechaIso(meta.fecha_original);
                if (fechaMeta) {
                    fechaRevision = fechaMeta;
                    desdeMetadatos = true;
                }
            }
        } catch (err) {
            console.warn('[DG-F-02] Metadatos lista maestra omitidos:', err.message);
        }
    }

    if (!desdeMetadatos) {
        try {
            const { CATALOGO_BASE } = require('./sgcSgcF01Service');
            const fila = (CATALOGO_BASE || []).find(
                (d) => String(d?.codigo || '').trim().toUpperCase() === CODIGO_FORMATO
            );
            if (fila) {
                if (fila.versionVigente) {
                    revision = formatearRevisionPlantillaDoc(fila.versionVigente);
                }
                const fechaFila = formatearFechaIso(fila.fechaRevision);
                if (fechaFila) {
                    fechaRevision = fechaFila;
                }
            }
        } catch (err) {
            console.warn('[DG-F-02] Catálogo F-01 omitido para cabecera:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        revision,
        fechaRevision
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
            containsText: { text: anterior, matchCase: true },
            replaceText: nuevo
        }
    };
}

/** Fecha del encabezado Word = fecha de revisión (lista maestra), no la de elaboración. */
function fechaCabeceraWord(destino) {
    return formatearFechaPlantillaDoc(destino.fechaRevision || destino.fechaElaboracion);
}

/**
 * Placeholders de la plantilla maestra:
 * cabecera (Código / No. Rev / Fecha) + cuerpo ({{texto_alcance}}).
 */
function crearReemplazosPlaceholdersCabecera(destino) {
    const codigo = String(destino.codigo || CODIGO_FORMATO).trim() || CODIGO_FORMATO;
    const rev = formatearRevisionPlantillaDoc(destino.revision);
    const fecha = fechaCabeceraWord(destino);
    const alcancePlano = htmlATextoPlanoParaDocumento(destino.alcance);
    return [
        crearReplaceRequest('{{codigo}}', codigo),
        crearReplaceRequest('{{num_rev}}', rev),
        crearReplaceRequest('{{fecha}}', fecha),
        crearReplaceRequest('{{CODIGO}}', codigo),
        crearReplaceRequest('{{NUM_REV}}', rev),
        crearReplaceRequest('{{FECHA}}', fecha),
        crearReplaceRequest('{{texto_alcance}}', alcancePlano),
        crearReplaceRequest('{{TEXTO_ALCANCE}}', alcancePlano),
        crearReplaceRequest('{{alcance}}', alcancePlano)
    ].filter(Boolean);
}

function crearReemplazosCodigo(snapshot, destino) {
    const codigoNuevo = String(destino.codigo || CODIGO_FORMATO).trim() || CODIGO_FORMATO;
    const nuevo = `Código: ${codigoNuevo}`;
    const codigos = new Set([
        String(snapshot.codigo || CODIGO_FORMATO).trim(),
        CODIGO_FORMATO,
        codigoNuevo
    ]);
    if (snapshot.plantillaSync?.codigo) {
        codigos.add(String(snapshot.plantillaSync.codigo).trim());
    }
    return [...codigos]
        .filter((c) => c && `Código: ${c}` !== nuevo)
        .map((c) => crearReplaceRequest(`Código: ${c}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosFecha(snapshot, destino) {
    const nuevo = `Fecha: ${fechaCabeceraWord(destino)}`;
    const fechasAnteriores = new Set([
        formatearFechaPlantillaDoc(snapshot.fechaRevision || snapshot.fechaElaboracion),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaRevision),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaElaboracion),
        fechaCabeceraWord(destino),
        '11-07-25',
        '17-07-25',
        '24-05-26',
        '01-01-25'
    ]);
    if (snapshot.plantillaSync?.fechaRevision) {
        fechasAnteriores.add(formatearFechaPlantillaDoc(snapshot.plantillaSync.fechaRevision));
    }
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
    const alcanceAnterior = String(snapshot?.alcance || '').trim();
    const reemplazoAlcanceLegado = alcanceAnterior.includes('{{')
        ? null
        : crearReemplazoTextoUnico(snapshot.alcance, destino.alcance);
    return [
        ...crearReemplazosPlaceholdersCabecera(destino),
        ...crearReemplazosCodigo(snapshot, destino),
        reemplazoAlcanceLegado,
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
    const enDrive = await buscarDocumentoSistemaEnDrive();
    return enDrive?.id || null;
}

function nombreArchivoHistorialWord(datos = {}) {
    const rev = formatearRevisionPlantillaDoc(datos.revision || DATOS_DEFECTO.revision);
    const fecha = formatearFechaIso(datos.fechaRevision || datos.fechaElaboracion) || fechaHoyIso();
    const stamp = fecha.replace(/-/g, '');
    return `DG-F-02 Alcance (sistema) - Rev ${rev} - ${stamp}.docx`;
}

/**
 * Mueve el Word sistema vigente al Historial de Versiones (no borra).
 */
async function archivarDocumentoSistemaActual(sistemaFileId, datos = {}) {
    const id = String(sistemaFileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) {
        return null;
    }
    try {
        const nombreHist = nombreArchivoHistorialWord(datos);
        await driveService.renombrarArchivoPorId(id, nombreHist).catch((err) => {
            console.warn('[DG-F-02] No se pudo renombrar Word antes de archivar:', err.message);
        });
        await driveService.moverArchivoDrive(id, CARPETA_HISTORIAL_DRIVE_ID);
        console.log(`[DG-F-02] Word sistema archivado → Historial: ${nombreHist} (${id})`);
        return id;
    } catch (err) {
        console.warn('[DG-F-02] No se pudo archivar Word sistema:', err.message);
        return null;
    }
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
    console.log(`[DG-F-02] Documento sistema creado desde plantilla: ${NOMBRE_PLANTILLA_SISTEMA} (${docId})`);
    return docId;
}

/**
 * true si hay que regenerar el Word sistema desde la plantilla maestra:
 * - sin origen o plantilla distinta (migración / nueva plantilla)
 * - versión de contenido de plantilla desactualizada (p. ej. {{texto_alcance}})
 * - cambio de revisión / fecha de lista maestra respecto al último sync
 */
function debeRegenerarDocumentoSistema(datos, cabeceraLista) {
    const origen = String(datos?.plantillaOrigenDriveId || '').trim();
    if (!origen || origen !== TEMPLATE_DRIVE_ID) {
        return true;
    }
    if (Number(datos?.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION) {
        return true;
    }
    const sync = datos?.plantillaSync;
    if (!sync) {
        return false;
    }
    const revSync = formatearRevisionPlantillaDoc(sync.revision);
    const revLista = formatearRevisionPlantillaDoc(cabeceraLista.revision);
    if (revSync !== revLista) {
        return true;
    }
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaLista = formatearFechaIso(cabeceraLista.fechaRevision);
    if (fechaSync && fechaLista && fechaSync !== fechaLista) {
        return true;
    }
    return false;
}

async function asegurarDocumentoSistema(datos, opciones = {}) {
    const existente = await resolverDocumentoSistemaId(datos);
    const forzarRegenerar = !!opciones.forzarRegenerar;

    if (existente && !forzarRegenerar) {
        return { fileId: existente, newlyCreated: false, regenerated: false };
    }

    if (existente && forzarRegenerar) {
        await archivarDocumentoSistemaActual(existente, {
            revision: datos?.plantillaSync?.revision || datos?.revision,
            fechaRevision: datos?.plantillaSync?.fechaRevision || datos?.fechaRevision
        });
    }

    const fileId = await crearDocumentoSistemaDesdePlantilla();
    return {
        fileId,
        newlyCreated: !existente,
        regenerated: !!existente && forzarRegenerar
    };
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
    const revMatch = texto.match(/No\.\s*Rev:\s*(\d{1,3}|\{\{num_rev\}\})/i);
    const fechaMatch = texto.match(/Fecha:\s*(\d{1,2}-\d{1,2}-\d{2,4}|\{\{fecha\}\})/i);
    let fechaRevision = DATOS_DEFECTO.fechaRevision;
    if (fechaMatch?.[1] && !String(fechaMatch[1]).includes('{')) {
        const parts = String(fechaMatch[1]).split('-');
        if (parts.length === 3) {
            const [d, m, yRaw] = parts;
            const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
            fechaRevision = formatearFechaIso(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
                || DATOS_DEFECTO.fechaRevision;
        }
    }
    return {
        empresa: DATOS_DEFECTO.empresa,
        codigo: CODIGO_FORMATO,
        alcance: alcance || DATOS_DEFECTO.alcance,
        requisitosNoAplicables: requisitosNoAplicables,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision,
        revision: revMatch?.[1] && !String(revMatch[1]).includes('{')
            ? formatearRevisionPlantillaDoc(revMatch[1])
            : DATOS_DEFECTO.revision
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
        // 1) Placeholders: cabecera + {{texto_alcance}}
        const reqPlaceholders = crearReemplazosPlaceholdersCabecera(destino);
        if (reqPlaceholders.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests: reqPlaceholders }
            });
        }

        // 2) Legado / texto restante (sin reaplicar placeholders ya resueltos)
        const snapshotPlantilla = await leerSnapshotDesdeGoogleDocApi(docsApi, docId)
            || snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
        const placeholdersAplicados = new Set(
            reqPlaceholders.map((r) => r?.replaceAllText?.containsText?.text).filter(Boolean)
        );
        const requests = construirRequestsPlantilla(snapshotPlantilla, destino)
            .filter((r) => {
                const t = r?.replaceAllText?.containsText?.text || '';
                return t && !placeholdersAplicados.has(t);
            });
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
        if (!snapshotDoc || docAlcance !== destinoAlcance || String(docAlcance).includes('{{')) {
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

async function listarPdfsHistorialDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))
        .map((f) => sanitizarPdfFirmado({
            driveFileId: f.id,
            nombreArchivo: f.name || NOMBRE_PDF_ARCHIVO,
            webViewLink: f.webViewLink || null,
            fechaSubida: f.modifiedTime || fechaHoyIso()
        }))
        .filter(Boolean);
}

async function buscarPdfEnDrive() {
    const lista = await listarPdfsHistorialDrive();
    return lista[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) {
            return sanitizarPdfFirmado(pdfDb);
        }
    }

    const lista = await listarPdfsHistorialDrive().catch(() => []);
    if (lista[0]?.driveFileId) {
        return lista[0];
    }
    return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
}

async function publicarPdfEnDrive(pdfBuffer, historialDrive = []) {
    const nombreArchivo = nombrePdfHistorial(fechaHoyIso(), historialDrive);
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
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        revision: formatearRevisionPlantillaDoc(base.revision),
        alcance: sanitizarHtmlCampo(base.alcance || DATOS_DEFECTO.alcance) || DATOS_DEFECTO.alcance,
        requisitosNoAplicables: 'requisitosNoAplicables' in base
            ? sanitizarHtmlCampo(String(base.requisitosNoAplicables ?? ''))
            : DATOS_DEFECTO.requisitosNoAplicables,
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial),
        plantillaSync,
        plantillaSistemaDriveFileId: String(base.plantillaSistemaDriveFileId || '').trim() || null,
        plantillaOrigenDriveId: String(base.plantillaOrigenDriveId || '').trim() || null,
        plantillaContenidoVersion: Number(base.plantillaContenidoVersion || 0) || 0
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

function construirRespuesta(registro, datos, historialPdfs = []) {
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

    const historialDb = sanitizarPdfsHistorial(datos.pdfsHistorial);
    const historialDrive = Array.isArray(historialPdfs) ? historialPdfs : [];
    const historialUnido = sanitizarPdfsHistorial([
        ...historialDb,
        ...historialDrive
    ]).sort((a, b) => new Date(b.fechaSubida || 0) - new Date(a.fechaSubida || 0));

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            pdfFirmado,
            pdfsHistorial: historialDb.length ? historialDb : historialUnido
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: modificado ? fechaMod : null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: historialUnido,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`,
        plantillaSistemaDriveFileId: datos.plantillaSistemaDriveFileId || null,
        plantillaSistemaEditorUrl: datos.plantillaSistemaDriveFileId
            ? `https://docs.google.com/document/d/${datos.plantillaSistemaDriveFileId}/edit`
            : null,
        plantillaOrigenDriveId: datos.plantillaOrigenDriveId || TEMPLATE_DRIVE_ID,
        carpetaHistorialDriveId: CARPETA_HISTORIAL_DRIVE_ID
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

    const cabeceraLista = await resolverCabeceraListaMaestra(pool, datos);
    datos = {
        ...datos,
        revision: cabeceraLista.revision,
        fechaRevision: cabeceraLista.fechaRevision
    };

    const regenerar = debeRegenerarDocumentoSistema(datos, cabeceraLista);
    let {
        fileId: sistemaFileId,
        newlyCreated: documentoNuevo,
        regenerated
    } = await asegurarDocumentoSistema(datos, { forzarRegenerar: regenerar });

    if (documentoNuevo || regenerated) {
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
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
                plantillaSync: syncResult.plantillaSync
            };
        } catch (err) {
            console.warn('[DG-F-02] No se pudo sincronizar documento sistema recién creado:', err.message);
            datos = {
                ...datos,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
            };
        }
        await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
        registro = await obtenerRegistroDb(pool);
    } else {
        const prev = await leerDatosRegistro(registro);
        const debePersistir = !prev
            || sistemaFileId !== prev.plantillaSistemaDriveFileId
            || prev.plantillaOrigenDriveId !== TEMPLATE_DRIVE_ID
            || Number(prev.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION
            || prev.revision !== datos.revision
            || prev.fechaRevision !== datos.fechaRevision;
        datos = {
            ...datos,
            plantillaSistemaDriveFileId: sistemaFileId,
            plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
            plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
        };
        if (debePersistir) {
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

    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datos, historialPdfs);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
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

    // Ver / Fecha Rev: solo Lista Maestra (no subir al editar contenido del alcance).
    const cabeceraLista = await resolverCabeceraListaMaestra(pool, datosPrevios || datosEntrada);
    const baseParaDoc = {
        ...(datosPrevios || datosEntrada),
        revision: cabeceraLista.revision,
        fechaRevision: cabeceraLista.fechaRevision
    };
    const regenerar = debeRegenerarDocumentoSistema(baseParaDoc, cabeceraLista);
    const {
        fileId: sistemaFileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(baseParaDoc, { forzarRegenerar: regenerar });

    if (huboCambioContenido && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        empresa: datosEntrada.empresa,
        alcance: datosEntrada.alcance,
        requisitosNoAplicables: datosEntrada.requisitosNoAplicables,
        fechaElaboracion,
        fechaRevision: cabeceraLista.fechaRevision,
        revision: cabeceraLista.revision,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        plantillaSync: datosPrevios?.plantillaSync || null,
        plantillaSistemaDriveFileId: sistemaFileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
    };

    if (origen !== 'consulta') {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(
                datosGuardar,
                (newlyCreated || regenerated)
                    ? DATOS_DEFECTO
                    : (datosPrevios || DATOS_DEFECTO),
                sistemaFileId,
                { forzarSnapshotPlantilla: newlyCreated || regenerated }
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
            datosGuardar.plantillaContenidoVersion = PLANTILLA_CONTENIDO_VERSION;
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
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const historialDrivePrev = await listarPdfsHistorialDrive().catch(() => []);
    const driveResult = await publicarPdfEnDrive(pdfBuffer, historialDrivePrev);

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(fechaHoyIso(), historialDrivePrev),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const histPrev = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial);
    const pdfsHistorial = [pdfFirmado, ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)];

    const datosGuardar = { ...datosPrevios, pdfFirmado, pdfsHistorial };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;

    await guardarRegistroDb(pool, {
        ...payloadRegistroDesdeRegistro(registroPrevio, datosGuardar),
        pdfDriveFileId: pdfFirmado.driveFileId,
        fechaElaboracionOriginal: fechaOriginal
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return { ...construirRespuesta(registro, datosGuardar, historialPdfs), pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[DG-F-02] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const datosGuardar = {
        ...datosPrevios,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: hist
    };

    await guardarRegistroDb(pool, {
        ...payloadRegistroDesdeRegistro(registroPrevio, datosGuardar),
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

function wordYaReflejaDatos(datos) {
    const sync = datos?.plantillaSync;
    if (!sync) return false;
    if (formatearRevisionPlantillaDoc(sync.revision) !== formatearRevisionPlantillaDoc(datos.revision)) {
        return false;
    }
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaDatos = formatearFechaIso(datos.fechaRevision);
    if (fechaSync && fechaDatos && fechaSync !== fechaDatos) return false;
    return contenidoEsEquivalente(sync, datos);
}

function clavePdfDescarga(datos) {
    return crypto.createHash('sha1').update(JSON.stringify({
        empresa: datos.empresa || '',
        alcance: datos.alcance || '',
        requisitos: datos.requisitosNoAplicables || '',
        revision: datos.revision || '',
        fechaRevision: datos.fechaRevision || '',
        fileId: datos.plantillaSistemaDriveFileId || ''
    })).digest('hex');
}

async function exportarPdfDelSistema(sistemaFileId) {
    const { drive, docId } = await copiarDocumentoComoGoogleDoc(sistemaFileId);
    try {
        return await exportarPdfSoloPrimeraPagina(drive, docId);
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-02] No se pudo eliminar copia temporal para PDF:', err.message);
        }
    }
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const cabecera = await resolverCabeceraListaMaestra(pool, datos);
    datos = {
        ...datos,
        revision: cabecera.revision,
        fechaRevision: cabecera.fechaRevision
    };

    const regenerar = debeRegenerarDocumentoSistema(datos, cabecera);
    const sistemaFileId = String(datos.plantillaSistemaDriveFileId || '').trim();
    const exportacionDirecta = !regenerar
        && !!sistemaFileId
        && sistemaFileId !== TEMPLATE_DRIVE_ID
        && wordYaReflejaDatos(datos);

    if (exportacionDirecta) {
        const clave = clavePdfDescarga(datos);
        const cache = pdfDescargaCache.leer('DG-F-02', clave);
        if (cache) {
            console.log('[DG-F-02] PDF servido desde caché');
            return cache;
        }
        try {
            const pdfBuffer = await exportarPdfDelSistema(sistemaFileId);
            pdfDescargaCache.guardar('DG-F-02', clave, pdfBuffer);
            console.log('[DG-F-02] PDF exportado del Word vigente, sin resincronizar');
            return pdfBuffer;
        } catch (err) {
            console.warn('[DG-F-02] Exportación directa de PDF falló, se regenera el Word:', err.message);
        }
    }

    const {
        fileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(datos, {
        forzarRegenerar: regenerar || !sistemaFileId
    });
    const syncResult = await sincronizarPlantillaGoogleDoc(
        datos,
        (newlyCreated || regenerated) ? DATOS_DEFECTO : (datos.plantillaSync || resolverSnapshotPlantilla(datos)),
        fileId,
        { forzarSnapshotPlantilla: newlyCreated || regenerated }
    );
    const pdfBuffer = await exportarPdfDelSistema(fileId);
    const datosActualizados = {
        ...datos,
        plantillaSistemaDriveFileId: fileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
        plantillaSync: syncResult.plantillaSync || datos.plantillaSync || null
    };
    pdfDescargaCache.guardar('DG-F-02', clavePdfDescarga(datosActualizados), pdfBuffer);
    await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datosActualizados));
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_PLANTILLA_SISTEMA,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_HISTORIAL_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    sanitizarDatos,
    resolverCabeceraListaMaestra
};
