const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const correoFirmaService = require('./correoFirmaService');

const PADDING_VISTA_CORREO = '24px 36px 20px 24px';
const CSS_VISTA_CORREO = [
    'html{margin:0;padding:0;overflow-x:auto;max-width:100%;}',
    'body{margin:0;overflow-x:auto;max-width:100%;box-sizing:border-box;}',
    'img{max-width:min(100%,680px);height:auto;}',
    `img[alt="Firma digital"],img[data-firma-biznaga="1"]{max-width:${correoFirmaService.FIRMA_MAX_WIDTH_PX}px!important;width:100%!important;height:auto!important;display:block!important;border:0!important;}`
].join('');

const CARPETAS_DEF = [
    {
        id: 'inbox',
        etiqueta: 'Entrada',
        icono: 'inbox',
        candidatos: ['INBOX']
    },
    {
        id: 'drafts',
        etiqueta: 'Borradores',
        icono: 'file-alt',
        candidatos: ['INBOX.Drafts', 'Drafts', 'INBOX/Drafts', '[Gmail]/Drafts']
    },
    {
        id: 'sent',
        etiqueta: 'Enviados',
        icono: 'paper-plane',
        candidatos: ['INBOX.Sent', 'INBOX.Sent Messages', 'INBOX.Sent Items', 'Sent', 'INBOX/Sent', 'INBOX/Sent Messages', 'Sent Items', 'Sent Messages', '.Sent', 'INBOX/.Sent', '[Gmail]/Sent Mail']
    },
    {
        id: 'spam',
        etiqueta: 'SPAM',
        icono: 'exclamation-circle',
        candidatos: ['INBOX.spam', 'INBOX.Junk', 'INBOX/Spam', 'Junk', 'Spam', '[Gmail]/Spam']
    },
    {
        id: 'trash',
        etiqueta: 'Papelera',
        icono: 'trash',
        candidatos: ['INBOX.Trash', 'INBOX.Deleted', 'Trash', 'INBOX/Trash', 'INBOX/Deleted', 'Deleted Items', 'Deleted Messages', '[Gmail]/Trash']
    },
    {
        id: 'archive',
        etiqueta: 'Archivo',
        icono: 'archive',
        candidatos: ['INBOX.Archive', 'Archive', 'INBOX/Archive', '[Gmail]/All Mail']
    }
];

function normalizarTextoCorreo(texto = '') {
    return String(texto || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function crearResumenCorreo(texto = '') {
    const limpio = normalizarTextoCorreo(texto).replace(/\s+/g, ' ');
    return limpio.length > 220 ? `${limpio.slice(0, 217)}...` : limpio;
}

function crearClienteImap(correoPerfil, configImap) {
    return new ImapFlow({
        host: configImap.host,
        port: configImap.port,
        secure: configImap.secure,
        auth: {
            user: correoPerfil,
            pass: configImap.pass
        },
        tls: {
            rejectUnauthorized: configImap.rejectUnauthorized
        },
        logger: false,
        connectionTimeout: 120000,
        greetingTimeout: 30000,
        socketTimeout: 120000
    });
}

const SEGMENTOS_AMBIGUOS = new Set(['messages', 'mail', 'items', 'msg']);

function normalizarPathImap(path = '') {
    return String(path || '').trim().replace(/\\/g, '/').toLowerCase();
}

function pathsImapEquivalent(pathA, pathB) {
    const a = normalizarPathImap(pathA).replace(/\//g, '.');
    const b = normalizarPathImap(pathB).replace(/\//g, '.');
    if (!a || !b) {
        return true;
    }
    return a === b;
}

function resolverCarpetaDesdeListado(listado, definicion) {
    const paths = Array.isArray(listado) ? listado.map(item => item.path) : [];

    for (const candidato of definicion.candidatos) {
        const exacta = paths.find(path => normalizarPathImap(path) === normalizarPathImap(candidato));
        if (exacta) {
            return exacta;
        }
    }

    for (const candidato of definicion.candidatos) {
        const segmento = candidato.split(/[./]/).pop()?.toLowerCase();
        if (!segmento || segmento.length < 3 || SEGMENTOS_AMBIGUOS.has(segmento)) {
            continue;
        }

        const parcial = paths.find(path => {
            const ultimoSegmento = String(path).split(/[./]/).pop()?.toLowerCase();
            return ultimoSegmento === segmento;
        });
        if (parcial) {
            return parcial;
        }
    }

    if (definicion.id === 'inbox') {
        const inboxExacta = paths.find(path => normalizarPathImap(path) === 'inbox');
        return inboxExacta || 'INBOX';
    }

    return null;
}

async function resolverRutaCarpeta(client, carpetaId, listadoPrecargado = null) {
    const definicion = CARPETAS_DEF.find(item => item.id === carpetaId) || CARPETAS_DEF[0];
    const listado = listadoPrecargado || await client.list();
    const path = resolverCarpetaDesdeListado(listado, definicion);
    if (!path) {
        return null;
    }
    return { ...definicion, path };
}

function decodificarQuotedPrintable(texto = '') {
    return String(texto || '')
        .replace(/=\r?\n/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodificarParteMime(parteRaw = '') {
    const partes = String(parteRaw).split(/\r?\n\r?\n/);
    if (partes.length < 2) {
        return '';
    }

    const headers = partes[0];
    let body = partes.slice(1).join('\n\n');
    const encoding = (headers.match(/Content-Transfer-Encoding:\s*([^\r\n;]+)/i) || [])[1]?.trim().toLowerCase() || '';
    const charsetMatch = headers.match(/charset="?([^"\r\n;]+)/i);
    const charset = charsetMatch ? charsetMatch[1].replace(/"/g, '') : 'utf-8';

    try {
        if (encoding === 'base64') {
            return Buffer.from(body.replace(/\s/g, ''), 'base64').toString(charset.toLowerCase() === 'utf-8' ? 'utf8' : charset);
        }
        if (encoding === 'quoted-printable') {
            return Buffer.from(decodificarQuotedPrintable(body), 'binary').toString(charset.toLowerCase() === 'utf-8' ? 'utf8' : charset);
        }
    } catch (_error) {
        // Continuar con cuerpo sin decodificar si falla la conversion.
    }

    return body;
}

function extraerHtmlDesdeMimeRaw(source) {
    const raw = Buffer.isBuffer(source) ? source.toString('binary') : String(source || '');
    const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
    if (!boundaryMatch) {
        if (/Content-Type:\s*text\/html/i.test(raw)) {
            return decodificarParteMime(raw);
        }
        return '';
    }

    const boundary = boundaryMatch[1];
    const partes = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
    let htmlFallback = '';

    for (const parte of partes) {
        if (!/Content-Type:\s*text\/html/i.test(parte)) {
            continue;
        }
        const contenido = decodificarParteMime(parte).trim();
        if (!contenido) {
            continue;
        }
        if (/multipart\/related/i.test(parte)) {
            const nested = extraerHtmlDesdeMimeRaw(Buffer.from(parte, 'binary'));
            if (nested) {
                return nested;
            }
        }
        htmlFallback = contenido;
    }

    return htmlFallback;
}

function esTipoImagenMime(contentType = '') {
    return /^image\//i.test(String(contentType || ''));
}

function esAdjuntoInline(adjunto = {}) {
    const disposition = String(adjunto.contentDisposition || '').toLowerCase();
    const cid = adjunto.contentId || adjunto.cid;
    const nombre = String(adjunto.filename || '').toLowerCase();
    const contentType = String(adjunto.contentType || '');
    const esImagen = esTipoImagenMime(contentType);

    if (nombre === 'firma-biznaga.jpg') {
        return true;
    }

    if (disposition === 'attachment') {
        return false;
    }

    // PDF, Word, Excel, etc. siguen siendo adjuntos aunque vengan como inline o con Content-ID.
    if (nombre && !esImagen) {
        return false;
    }

    if (adjunto.related && esImagen) {
        return true;
    }

    if (disposition === 'inline' && esImagen) {
        return true;
    }

    if (cid && esImagen) {
        return true;
    }

    return false;
}

function filtrarAdjuntosDescargables(attachments = []) {
    if (!Array.isArray(attachments)) {
        return [];
    }
    return attachments.filter((adjunto) => !esAdjuntoInline(adjunto));
}

function mapearAdjuntosDescargables(attachments = []) {
    return filtrarAdjuntosDescargables(attachments).map((adjunto, index) => ({
        indice: index,
        nombre: adjunto.filename || `adjunto-${index + 1}`,
        contentType: adjunto.contentType || 'application/octet-stream',
        size: typeof adjunto.size === 'number'
            ? adjunto.size
            : (Buffer.isBuffer(adjunto.content) ? adjunto.content.length : null),
        contentId: adjunto.contentId || adjunto.cid || null
    }));
}

function incrustarAdjuntosInline(html, attachments = []) {
    if (!html || !Array.isArray(attachments) || attachments.length === 0) {
        return html;
    }

    let resultado = String(html);
    for (const adjunto of attachments) {
        const cidRaw = adjunto?.contentId || adjunto?.cid;
        if (!cidRaw || !adjunto?.content) {
            continue;
        }

        const cid = String(cidRaw).replace(/^<|>$/g, '');
        const buffer = Buffer.isBuffer(adjunto.content)
            ? adjunto.content
            : Buffer.from(adjunto.content);
        const mime = adjunto.contentType || 'application/octet-stream';
        const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
        const cidEscaped = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cidPattern = new RegExp(`cid:${cidEscaped}`, 'gi');
        const nombre = String(adjunto.filename || '').toLowerCase();
        const esFirma = nombre === 'firma-biznaga.jpg' || /firma-/i.test(cid);

        if (esFirma) {
            // Reescribir el <img> completo para forzar tamaño y marcar la firma
            // (los clientes de correo suelen quitar max-width al citar).
            const imgCidPattern = new RegExp(
                `<img\\b([^>]*?)(?:src\\s*=\\s*(?:"cid:${cidEscaped}"|'cid:${cidEscaped}'|cid:${cidEscaped}))([^>]*)>`,
                'gi'
            );
            resultado = resultado.replace(imgCidPattern, (_match, before = '', after = '') => {
                const resto = `${before} ${after}`
                    .replace(/\s*src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                    .replace(/\s*width\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                    .replace(/\s*height\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                    .replace(/\s*style\s*=\s*("[^"]*"|'[^']*')/gi, '')
                    .replace(/\s*alt\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                    .replace(/\s*data-firma-biznaga\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                    .trim();
                const attrsExtra = resto ? ` ${resto}` : '';
                return `<img src="${dataUri}" alt="Firma digital" data-firma-biznaga="1" style="${correoFirmaService.ESTILO_IMG_FIRMA}"${attrsExtra}>`;
            });
        }

        resultado = resultado.replace(cidPattern, dataUri);
    }

    return correoFirmaService.normalizarImagenesFirmaEnHtml(resultado);
}

function sanitizarHtmlCorreo(html = '') {
    if (!html) {
        return '';
    }

    return String(html)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript:/gi, '')
        .trim();
}

function inyectarCssVistaCorreo(documento = '') {
    const html = String(documento || '');
    if (!html) {
        return html;
    }

    const styleTag = `<style type="text/css">${CSS_VISTA_CORREO}</style>`;
    if (/<head[\s>]/i.test(html)) {
        return html.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
    }
    if (/<html[\s>]/i.test(html)) {
        return html.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
    }
    return html;
}

/** El contenedor raíz ya trae padding de plantilla Biznaga (evita doble margen). */
function esContenedorRaizConPaddingBiznaga(html = '') {
    const limpio = String(html || '').trim();
    if (!limpio) {
        return false;
    }

    const fragmento = limpio.match(/^<div\b[^>]*style\s*=\s*"([^"]*)"/i)
        || limpio.match(/^<div\b[^>]*style\s*=\s*'([^']*)'/i);
    if (fragmento?.[1]) {
        const style = fragmento[1];
        return /century\s*gothic|centurygothic/i.test(style) && /padding\s*:/i.test(style);
    }

    const bodyMatch = limpio.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    const interior = String(bodyMatch?.[1] || '').trim();
    const hijo = interior.match(/^<div\b[^>]*style\s*=\s*"([^"]*)"/i)
        || interior.match(/^<div\b[^>]*style\s*=\s*'([^']*)'/i);
    if (hijo?.[1]) {
        const style = hijo[1];
        return /century\s*gothic|centurygothic/i.test(style) && /padding\s*:/i.test(style);
    }

    return false;
}

function asegurarPaddingBodyVista(documento = '', forzarPadding = true) {
    const html = String(documento || '');
    if (!html || !forzarPadding) {
        return html;
    }

    if (!/<body[\s>]/i.test(html)) {
        return html;
    }

    return html.replace(/<body([^>]*)>/i, (match, attrs = '') => {
        if (/style\s*=/i.test(attrs)) {
            return match.replace(/style\s*=\s*("([^"]*)"|'([^']*)')/i, (_m, _full, doble, simple) => {
                const style = String(doble ?? simple ?? '');
                const sinPaddingCero = style
                    .replace(/padding\s*:\s*0(?:px)?(?:\s+0(?:px)?){0,3}\s*;?/gi, '')
                    .replace(/;{2,}/g, ';')
                    .replace(/^\s*;\s*|\s*;\s*$/g, '')
                    .trim();
                if (/padding\s*:/i.test(sinPaddingCero)) {
                    return `style="${sinPaddingCero}"`;
                }
                const nuevo = sinPaddingCero
                    ? `${sinPaddingCero};padding:${PADDING_VISTA_CORREO}`
                    : `padding:${PADDING_VISTA_CORREO}`;
                return `style="${nuevo}"`;
            });
        }
        return `<body${attrs} style="padding:${PADDING_VISTA_CORREO}">`;
    });
}

function envolverDocumentoHtml(html = '') {
    const limpio = sanitizarHtmlCorreo(html);
    if (!limpio) {
        return '';
    }

    const conFirmasNormalizadas = correoFirmaService.normalizarImagenesFirmaEnHtml(limpio);
    const raizConPadding = esContenedorRaizConPaddingBiznaga(conFirmasNormalizadas);

    if (/<!DOCTYPE|<html[\s>]/i.test(conFirmasNormalizadas)) {
        let documento = conFirmasNormalizadas;
        if (/<head[\s>]/i.test(documento) && !/<base[\s>]/i.test(documento)) {
            documento = documento.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">');
        }
        documento = inyectarCssVistaCorreo(documento);
        return asegurarPaddingBodyVista(documento, !raizConPadding);
    }

    const bodyPadding = raizConPadding ? '0' : PADDING_VISTA_CORREO;

    return asegurarPaddingBodyVista(
        inyectarCssVistaCorreo(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"></head><body style="margin:0;padding:${bodyPadding};font-family:'Century Gothic',CenturyGothic,AppleGothic,'URW Gothic L',sans-serif;font-size:14px;line-height:1.65;color:#1A1A1A;">${conFirmasNormalizadas}</body></html>`
        ),
        !raizConPadding
    );
}

async function extraerContenidoCorreo(source) {
    const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source || '');
    const parsed = await simpleParser(buffer, {
        skipHtmlToText: true,
        skipTextToHtml: true
    });

    let html = '';
    if (parsed.html !== false && parsed.html !== null && parsed.html !== undefined) {
        html = Buffer.isBuffer(parsed.html) ? parsed.html.toString('utf8') : String(parsed.html);
    }

    if (!html.trim()) {
        html = extraerHtmlDesdeMimeRaw(buffer);
    }

    if (html.trim() && Array.isArray(parsed.attachments)) {
        html = incrustarAdjuntosInline(html, parsed.attachments);
    }

    const texto = normalizarTextoCorreo(parsed.text || '');

    return {
        html: html.trim(),
        texto,
        parsed
    };
}

function formatearDireccionCorreo(entry) {
    if (!entry) {
        return '';
    }
    if (entry.name && entry.address) {
        return `${entry.name} <${entry.address}>`;
    }
    return entry.address || entry.name || '';
}

function formatearListaCorreo(addressObject) {
    if (!addressObject) {
        return '';
    }
    if (addressObject.text) {
        return String(addressObject.text);
    }
    if (Array.isArray(addressObject.value)) {
        return addressObject.value.map(formatearDireccionCorreo).filter(Boolean).join(', ');
    }
    return '';
}

function obtenerHeaderCorreo(parsed, nombreHeader) {
    if (!parsed?.headers || typeof parsed.headers.get !== 'function') {
        return '';
    }
    const valor = parsed.headers.get(nombreHeader);
    return valor ? String(valor) : '';
}

function extraerDominioCorreo(correo = '') {
    const limpio = String(correo || '').trim().toLowerCase();
    const match = limpio.match(/<?([^\s<>@]+@[^\s<>@]+)>?/);
    const direccion = match?.[1] || limpio;
    const partes = direccion.split('@');
    return partes.length === 2 ? partes[1] : '';
}

function extraerEnviadoPor(parsed) {
    const received = obtenerHeaderCorreo(parsed, 'received') || obtenerHeaderCorreo(parsed, 'Received');
    if (received) {
        const coincidencias = [...String(received).matchAll(/\bfrom\s+([^\s;]+)/gi)];
        if (coincidencias.length > 0) {
            const host = coincidencias[0][1].replace(/^[\[(<]+|[\])>]+$/g, '');
            if (host && !/^[\d.]+$/.test(host)) {
                return host;
            }
        }
    }

    const returnPath = obtenerHeaderCorreo(parsed, 'return-path') || obtenerHeaderCorreo(parsed, 'Return-Path');
    const dominioReturn = extraerDominioCorreo(returnPath);
    if (dominioReturn) {
        return dominioReturn.startsWith('mail.') ? dominioReturn : `mail.${dominioReturn}`;
    }

    const dominioDe = extraerDominioCorreo(parsed?.from?.value?.[0]?.address || parsed?.from?.text || '');
    return dominioDe ? (dominioDe.startsWith('mail.') ? dominioDe : `mail.${dominioDe}`) : '';
}

function extraerFirmadoPor(parsed) {
    const authResults = obtenerHeaderCorreo(parsed, 'authentication-results')
        || obtenerHeaderCorreo(parsed, 'Authentication-Results');

    if (authResults) {
        const dkim = String(authResults).match(/dkim=pass(?:[^;]*?)header\.d=([^;\s]+)/i)
            || String(authResults).match(/header\.d=([^;\s]+)/i);
        if (dkim?.[1]) {
            return dkim[1];
        }
    }

    return extraerDominioCorreo(parsed?.from?.value?.[0]?.address || parsed?.from?.text || '');
}

function formatearFechaDetalleCorreo(fecha) {
    if (!fecha) {
        return '';
    }

    const date = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(date.getTime())) {
        return String(fecha);
    }

    return date.toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
    });
}

function extraerDetalleMensaje(parsed, correoPerfil = '') {
    const remitenteEntry = parsed?.from?.value?.[0];
    const deNombre = remitenteEntry?.name || '';
    const deCorreo = remitenteEntry?.address || '';
    const de = formatearListaCorreo(parsed?.from) || deCorreo || 'Sin remitente';
    const responderA = formatearListaCorreo(parsed?.replyTo)
        || parsed?.replyTo?.value?.[0]?.address
        || deCorreo
        || de;
    const para = formatearListaCorreo(parsed?.to) || correoPerfil;
    const cc = formatearListaCorreo(parsed?.cc);
    const cco = formatearListaCorreo(parsed?.bcc);
    const fecha = formatearFechaDetalleCorreo(parsed?.date);
    const asunto = parsed?.subject || '(Sin asunto)';
    const messageId = String(parsed?.messageId || '').trim();
    const inReplyTo = String(parsed?.inReplyTo || '').trim();
    const references = Array.isArray(parsed?.references)
        ? parsed.references.map((item) => String(item || '').trim()).filter(Boolean).join(' ')
        : String(parsed?.references || '').trim();
    const esContestacion = Boolean(
        inReplyTo
        || /^(re|rv|res)\s*:/i.test(asunto)
    );

    return {
        de,
        deNombre,
        deCorreo,
        responderA,
        para,
        cc,
        cco,
        fecha,
        asunto,
        messageId,
        inReplyTo,
        references,
        esContestacion,
        enviadoPor: extraerEnviadoPor(parsed),
        firmadoPor: extraerFirmadoPor(parsed),
        seguridad: 'Cifrado estandar (TLS)'
    };
}

function obtenerNombreParteMime(node) {
    if (!node?.parameters) {
        return '';
    }
    return String(node.parameters.name || node.parameters.filename || '').trim();
}

function esTipoAdjuntoMime(type = '', subtype = '') {
    const mime = `${type}/${subtype}`.toLowerCase();
    if (/^multipart\//.test(mime)) {
        return false;
    }
    if (/^text\//.test(mime)) {
        return false;
    }
    return true;
}

function mensajeTieneAdjuntos(bodyStructure) {
    if (!bodyStructure) {
        return false;
    }

    const revisar = (node) => {
        if (!node) return false;

        const disposition = node.disposition ? String(node.disposition).toLowerCase() : '';
        const nombre = obtenerNombreParteMime(node);
        const type = String(node.type || '').toLowerCase();
        const subtype = String(node.subtype || '').toLowerCase();

        if (disposition === 'attachment') {
            return true;
        }

        if (nombre && esTipoAdjuntoMime(type, subtype)) {
            return true;
        }

        if (Array.isArray(node.childNodes)) {
            return node.childNodes.some(revisar);
        }
        return false;
    };

    return revisar(bodyStructure);
}

function mapearMensajeLista(mensaje, correoPerfil, parsedResumen = null, carpetaId = 'inbox') {
    const fecha = parsedResumen?.date || mensaje.envelope?.date || null;
    const remitente = parsedResumen?.from?.text
        || mensaje.envelope?.from?.map(item => item.address || item.name).filter(Boolean).join(', ')
        || mensaje.envelope?.from?.[0]?.address
        || 'Sin remitente';
    const destinatario = parsedResumen?.to?.text || correoPerfil;
    const texto = normalizarTextoCorreo(parsedResumen?.text || '');

    return {
        id: String(mensaje.uid || `${fecha?.getTime?.() || Date.now()}`),
        uid: mensaje.uid || null,
        carpeta: carpetaId,
        remitente,
        destinatario,
        asunto: parsedResumen?.subject || mensaje.envelope?.subject || '(Sin asunto)',
        fecha: fecha ? new Date(fecha).toISOString() : null,
        resumen: crearResumenCorreo(texto),
        leido: mensaje.flags?.has('\\Seen') || false,
        favorito: mensaje.flags?.has('\\Flagged') || false,
        tieneAdjunto: parsedResumen
            ? filtrarAdjuntosDescargables(parsedResumen.attachments || []).length > 0
            : mensajeTieneAdjuntos(mensaje.bodyStructure)
    };
}

async function obtenerConteoCarpeta(client, path) {
    try {
        const status = await client.status(path, { messages: true, unseen: true });
        return {
            total: Number(status?.messages || 0),
            noLeidos: Number(status?.unseen || 0)
        };
    } catch (_statusError) {
        let lock;

        try {
            lock = await client.getMailboxLock(path);
            const total = Number(client.mailbox?.exists || 0);
            let noLeidos = 0;

            try {
                const unseen = await client.search({ unseen: true }, { uid: true });
                noLeidos = Array.isArray(unseen) ? unseen.length : 0;
            } catch (_searchError) {
                noLeidos = 0;
            }

            return { total, noLeidos };
        } catch (error) {
            console.warn('[CORREO] No se pudo contar carpeta', path, error?.message || error);
            return { total: 0, noLeidos: 0 };
        } finally {
            if (lock) {
                lock.release();
            }
        }
    }
}

async function listarCarpetas(client, listadoPrecargado = null) {
    const listado = listadoPrecargado || await client.list();
    const carpetas = [];

    for (const definicion of CARPETAS_DEF) {
        const path = resolverCarpetaDesdeListado(listado, definicion);
        if (!path) {
            carpetas.push({
                id: definicion.id,
                etiqueta: definicion.etiqueta,
                icono: definicion.icono,
                path: null,
                total: 0,
                noLeidos: 0,
                disponible: false
            });
            continue;
        }

        const conteo = await obtenerConteoCarpeta(client, path);
        carpetas.push({
            id: definicion.id,
            etiqueta: definicion.etiqueta,
            icono: definicion.icono,
            path,
            total: conteo.total,
            noLeidos: conteo.noLeidos,
            disponible: true
        });
    }

    return carpetas;
}

async function listarMensajes(client, mailboxPath, limit = 50, offset = 0, terminoBusqueda = '') {
    const mensajes = [];
    let totalMensajes = 0;
    let totalCoincidencias = 0;
    let noLeidos = 0;
    let lock;

    try {
        lock = await client.getMailboxLock(mailboxPath);

        totalMensajes = Number(client.mailbox?.exists || 0);
        if (totalMensajes <= 0) {
            return {
                mensajes,
                total: 0,
                totalCarpeta: 0,
                noLeidos: 0,
                path: client.mailbox?.path || mailboxPath
            };
        }

        try {
            const unseen = await client.search({ unseen: true }, { uid: true });
            noLeidos = Array.isArray(unseen) ? unseen.length : 0;
        } catch (_searchError) {
            noLeidos = 0;
        }

        const offsetSeguro = Math.max(0, Number(offset) || 0);
        const termino = String(terminoBusqueda || '').trim();
        let rangoFetch = '';

        if (termino) {
            // IMAP TEXT busca la frase en encabezados y cuerpo, no solo en los
            // mensajes que ya están visibles en el navegador.
            const coincidencias = await client.search({ text: termino }, { uid: true });
            const uids = (Array.isArray(coincidencias) ? coincidencias : [])
                .map(Number)
                .filter(uid => Number.isFinite(uid) && uid > 0)
                .sort((a, b) => b - a);
            totalCoincidencias = uids.length;
            rangoFetch = uids.slice(offsetSeguro, offsetSeguro + limit).join(',');
        } else {
            totalCoincidencias = totalMensajes;
            const hasta = Math.max(0, totalMensajes - offsetSeguro);
            const desde = Math.max(1, hasta - limit + 1);
            rangoFetch = hasta >= 1 ? `${desde}:${hasta}` : '';
        }

        if (!rangoFetch) {
            return {
                mensajes,
                total: totalCoincidencias,
                totalCarpeta: totalMensajes,
                noLeidos,
                path: client.mailbox?.path || mailboxPath
            };
        }

        for await (const mensaje of client.fetch(rangoFetch, {
            uid: true,
            envelope: true,
            flags: true,
            bodyStructure: true
        }, termino ? { uid: true } : undefined)) {
            mensajes.push(mensaje);
        }

        return {
            mensajes: mensajes.sort((a, b) => Number(b.uid || 0) - Number(a.uid || 0)),
            total: totalCoincidencias,
            totalCarpeta: totalMensajes,
            noLeidos,
            path: client.mailbox?.path || mailboxPath
        };
    } finally {
        if (lock) {
            lock.release();
        }
    }
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function obtenerMensajePorUid(client, mailboxPath, uid) {
    const lock = await client.getMailboxLock(mailboxPath);

    try {
        const mensaje = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (mensaje?.source) {
            return mensaje;
        }

        try {
            const descarga = await client.download(String(uid), undefined, { uid: true });
            const source = descarga?.content ? await streamToBuffer(descarga.content) : null;
            if (source?.length) {
                return {
                    uid,
                    source
                };
            }
        } catch (errorDescarga) {
            console.warn('[correo] Fallback download IMAP fallo:', errorDescarga?.message || errorDescarga);
        }

        return mensaje || null;
    } finally {
        lock.release();
    }
}

async function eliminarMensaje(client, mailboxPath, uid) {
    const lock = await client.getMailboxLock(mailboxPath);
    try {
        return await client.messageDelete(String(uid), { uid: true });
    } finally {
        lock.release();
    }
}

async function moverMensaje(client, origenPath, uid, destinoPath) {
    const lock = await client.getMailboxLock(origenPath);
    try {
        return await client.messageMove(String(uid), destinoPath, { uid: true });
    } finally {
        lock.release();
    }
}

async function marcarMensajeLeido(client, mailboxPath, uid, leido = true) {
    const lock = await client.getMailboxLock(mailboxPath);
    try {
        if (leido) {
            return await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
        return await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
    } finally {
        lock.release();
    }
}

async function marcarMensajeFavorito(client, mailboxPath, uid, favorito = true) {
    const lock = await client.getMailboxLock(mailboxPath);
    try {
        if (favorito) {
            return await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
        }
        return await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
    } finally {
        lock.release();
    }
}

async function ejecutarAccionMensaje(client, carpetaOrigen, uid, accion, opciones = {}) {
    const accionNormalizada = String(accion || '').trim().toLowerCase();

    if (accionNormalizada === 'eliminar') {
        return eliminarMensaje(client, carpetaOrigen.path, uid);
    }

    if (accionNormalizada === 'no_leido') {
        await marcarMensajeLeido(client, carpetaOrigen.path, uid, false);
        return { accion: accionNormalizada, leido: false };
    }

    if (accionNormalizada === 'leido') {
        await marcarMensajeLeido(client, carpetaOrigen.path, uid, true);
        return { accion: accionNormalizada, leido: true };
    }

    if (accionNormalizada === 'favorito') {
        const favorito = opciones.activo !== false;
        await marcarMensajeFavorito(client, carpetaOrigen.path, uid, favorito);
        return { accion: accionNormalizada, favorito };
    }

    if (accionNormalizada === 'archivar') {
        const destino = await resolverRutaCarpeta(client, 'archive');
        if (!destino?.path) {
            throw new Error('La carpeta Archivo no esta disponible en el buzon');
        }
        await moverMensaje(client, carpetaOrigen.path, uid, destino.path);
        return { accion: accionNormalizada, carpetaDestino: destino.id };
    }

    if (accionNormalizada === 'spam') {
        const destino = await resolverRutaCarpeta(client, 'spam');
        if (!destino?.path) {
            throw new Error('La carpeta SPAM no esta disponible en el buzon');
        }
        await moverMensaje(client, carpetaOrigen.path, uid, destino.path);
        return { accion: accionNormalizada, carpetaDestino: destino.id };
    }

    throw new Error('Accion de correo no soportada');
}

async function guardarCopiaEnEnviados(client, messageSource) {
    const carpeta = await resolverRutaCarpeta(client, 'sent');
    if (!carpeta?.path) {
        return { guardado: false, motivo: 'carpeta_no_disponible' };
    }

    const buffer = Buffer.isBuffer(messageSource)
        ? messageSource
        : Buffer.from(String(messageSource || ''), 'utf8');

    if (!buffer.length) {
        return { guardado: false, motivo: 'mensaje_vacio' };
    }

    const uid = await client.append(carpeta.path, buffer, ['\\Seen']);
    return {
        guardado: true,
        carpeta: carpeta.id,
        path: carpeta.path,
        uid: uid || null
    };
}

module.exports = {
    CARPETAS_DEF,
    crearClienteImap,
    resolverRutaCarpeta,
    listarCarpetas,
    listarMensajes,
    obtenerMensajePorUid,
    eliminarMensaje,
    moverMensaje,
    marcarMensajeLeido,
    marcarMensajeFavorito,
    ejecutarAccionMensaje,
    guardarCopiaEnEnviados,
    esAdjuntoInline,
    filtrarAdjuntosDescargables,
    mapearAdjuntosDescargables,
    extraerContenidoCorreo,
    extraerDetalleMensaje,
    envolverDocumentoHtml,
    sanitizarHtmlCorreo,
    mapearMensajeLista,
    normalizarTextoCorreo,
    crearResumenCorreo
};
