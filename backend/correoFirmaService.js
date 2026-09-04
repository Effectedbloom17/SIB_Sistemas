const driveService = require('./driveService');

const cacheFirmas = new Map();

/** IDs de Google Drive por buzón (fallback si no hay CORREO_FIRMA_* en .env). */
const FIRMAS_CORREO_DEFECTO = {
    'alexis_design@biznaga.com.mx': '1TSy0r1IT3NPXRfrtMGi42pFArh80FmQh',
    'areli_seguridad@biznaga.com.mx': '1yIQUVr4qy3WKW-36qZV_xY9TKYB7lotN',
    'daniel_seguridad@biznaga.com.mx': '1wWaTF8RRNlK6P5M5PxYx9QJSyjzRU2_Y',
    'edmundo_pc@biznaga.com.mx': '1aX6ISt6iPTB7epyJXPOJEGdAFXlXb_8m',
    'efrain_salud@biznaga.com.mx': '1UjbqyndCDEMSE5zqXSU1h5XQ_NoMB6XC',
    'facturas@biznaga.com.mx': '1NfgbNF5x70GeqiaVoOWcooI539n9Xtzl',
    'fernanda_talentohumano@biznaga.com.mx': '15FirWRqf6OAnsW2jPug5Tlpw8jXBwhPg',
    'hector_ti@biznaga.com.mx': '1KE456Fqwcjsxu4A7z8m7DiUTsHnfY0Nn',
    'joseluis_ambiental@biznaga.com.mx': '1-0GBj8SgkkBqXMvYXIq-LTcmMFIG7sIn',
    'leonel_innovacion@biznaga.com.mx': '1lE2XBu75aLzVn1bfjzd_A9P9ZWgEqGgl',
    'marisol_ceo@biznaga.com.mx': '1s06mZJ4yrT_k4am7iewR1i-6QSfiee41',
    'melody_supervision@biznaga.com.mx': '1B0DbcjAdMZ7tVskeGYGVoCWx2r9RXKJO',
    'pascual_seguridad@biznaga.com.mx': '1fJp93jryD15ZOJwdml1V8WBeUpji-tZH',
    'ruben_seguridad@biznaga.com.mx': '1DiwPg6QUqWHODGjhgN-ntGKqKZUWc-ZF',
    'saul_calidad@biznaga.com.mx': '1_pvm8WCiFJnaCJVrq2M0BeEPyVIbW4pN',
    'sergio_calidad@biznaga.com.mx': '1Rp30hjrSsHAOOGOkzNtsL0rJTF_BqGUm'
};

const ESTILO_CUERPO_CORREO = [
    "font-family:'Century Gothic',CenturyGothic,AppleGothic,'URW Gothic L',sans-serif",
    'font-size:14px',
    'line-height:1.65',
    'color:#1A1A1A',
    'padding:24px 36px 20px 24px',
    'margin:0'
].join(';');

/** Ancho visual estándar de la firma en lectura/envío (evita firmas enormes en contestaciones). */
const FIRMA_MAX_WIDTH_PX = 520;
const ESTILO_IMG_FIRMA = `max-width:${FIRMA_MAX_WIDTH_PX}px;width:100%;height:auto;display:block;border:0;`;

function normalizarClaveCorreo(correo) {
    return String(correo || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_');
}

function obtenerDriveIdFirma(correo) {
    const clave = normalizarClaveCorreo(correo);
    const desdeEnv = String(process.env[`CORREO_FIRMA_${clave}`] || '').trim();
    if (desdeEnv) {
        return desdeEnv;
    }

    const correoNorm = String(correo || '').trim().toLowerCase();
    return FIRMAS_CORREO_DEFECTO[correoNorm] || '';
}

function tieneFirmaDigital(correo) {
    return Boolean(obtenerDriveIdFirma(correo));
}

function crearCidFirma(correo) {
    const clave = normalizarClaveCorreo(correo).toLowerCase();
    return `firma-${clave}@biznaga.com.mx`;
}

function construirHtmlFirma(cid) {
    return `
        <div style="margin-top:20px;padding-top:12px;">
            <img src="cid:${cid}" alt="Firma digital" style="${ESTILO_IMG_FIRMA}" />
        </div>
    `.trim();
}

function construirHtmlFirmaBase64(buffer) {
    if (!buffer?.length) {
        return '';
    }
    const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
    return `
        <div style="margin-top:20px;padding-top:12px;">
            <img src="data:image/jpeg;base64,${base64}" alt="Firma digital" style="${ESTILO_IMG_FIRMA}" />
        </div>
    `.trim();
}

function esTagImgFirma(tag = '') {
    const html = String(tag || '');
    if (!html) {
        return false;
    }
    if (/alt\s*=\s*["']?\s*Firma digital\s*["']?/i.test(html)) {
        return true;
    }
    if (/cid:[^"'>\s]*firma/i.test(html)) {
        return true;
    }
    if (/firma-biznaga/i.test(html)) {
        return true;
    }
    if (/data-firma-biznaga\s*=\s*["']?1["']?/i.test(html)) {
        return true;
    }
    return false;
}

/**
 * En contestaciones los clientes suelen quitar max-width / poner width nativo enorme.
 * Fuerza tamaño legible en todas las firmas detectadas.
 */
function normalizarImagenesFirmaEnHtml(html = '') {
    const contenido = String(html || '');
    if (!contenido || !/<img\b/i.test(contenido)) {
        return contenido;
    }

    return contenido.replace(/<img\b[^>]*>/gi, (tag) => {
        if (!esTagImgFirma(tag)) {
            return tag;
        }

        let nuevo = tag
            .replace(/\s*width\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/\s*height\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

        if (/style\s*=/i.test(nuevo)) {
            nuevo = nuevo.replace(/style\s*=\s*("[^"]*"|'[^']*')/i, `style="${ESTILO_IMG_FIRMA}"`);
        } else {
            nuevo = nuevo.replace(/<img\b/i, `<img style="${ESTILO_IMG_FIRMA}"`);
        }

        if (!/alt\s*=/i.test(nuevo)) {
            nuevo = nuevo.replace(/<img\b/i, '<img alt="Firma digital"');
        } else {
            nuevo = nuevo.replace(/alt\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'alt="Firma digital"');
        }

        if (!/data-firma-biznaga\s*=/i.test(nuevo)) {
            nuevo = nuevo.replace(/<img\b/i, '<img data-firma-biznaga="1"');
        }

        return nuevo;
    });
}

async function obtenerBufferFirma(correo) {
    const driveId = obtenerDriveIdFirma(correo);
    if (!driveId) {
        return null;
    }

    if (cacheFirmas.has(driveId)) {
        const cached = cacheFirmas.get(driveId);
        if (cached.attachment?.content) {
            return cached.attachment.content;
        }
    }

    const buffer = await driveService.descargarArchivo(driveId);
    if (!buffer?.length) {
        return null;
    }

    if (!cacheFirmas.has(driveId)) {
        const cid = crearCidFirma(correo);
        cacheFirmas.set(driveId, {
            cid,
            attachment: {
                filename: 'firma-biznaga.jpg',
                content: buffer,
                cid,
                contentType: 'image/jpeg',
                contentDisposition: 'inline'
            }
        });
    }

    return buffer;
}

async function obtenerFirmaHtmlBase64(correo) {
    try {
        const buffer = await obtenerBufferFirma(correo);
        return construirHtmlFirmaBase64(buffer);
    } catch (error) {
        console.warn(`[CORREO] Firma base64 no disponible (${correo}):`, error?.message || error);
        return '';
    }
}

async function repararFirmasEnHtml(html, correoPerfil) {
    const contenido = String(html || '').trim();
    if (!contenido) {
        return contenido;
    }

    if (!correoPerfil) {
        return normalizarImagenesFirmaEnHtml(contenido);
    }

    const firmaHtml = await obtenerFirmaHtmlBase64(correoPerfil);
    if (!firmaHtml) {
        return normalizarImagenesFirmaEnHtml(contenido);
    }

    const dataUriMatch = firmaHtml.match(/src="(data:image\/[^"]+)"/i);
    const dataUri = dataUriMatch?.[1] || '';
    if (!dataUri) {
        return normalizarImagenesFirmaEnHtml(contenido);
    }

    let resultado = contenido;

    if (/cid:firma-/i.test(resultado)) {
        resultado = resultado.replace(/src="cid:[^"]*firma[^"]*"/gi, `src="${dataUri}"`);
        resultado = resultado.replace(/src='cid:[^']*firma[^']*'/gi, `src="${dataUri}"`);
    }

    if (!/alt="Firma digital"/i.test(resultado) && /century\s*gothic|centurygothic/i.test(resultado)) {
        resultado = resultado.replace(
            /(<div[^>]*style="[^"]*century[^"]*"[^>]*>[\s\S]*?)(<\/div>\s*)$/i,
            `$1${firmaHtml}$2`
        );
    }

    return normalizarImagenesFirmaEnHtml(resultado);
}

async function obtenerFirmaParaCorreo(correo) {
    const driveId = obtenerDriveIdFirma(correo);
    if (!driveId) {
        return { html: '', attachment: null };
    }

    if (cacheFirmas.has(driveId)) {
        const cached = cacheFirmas.get(driveId);
        return {
            html: construirHtmlFirma(cached.cid),
            attachment: cached.attachment
        };
    }

    try {
        const buffer = await obtenerBufferFirma(correo);
        if (!buffer?.length) {
            return { html: '', attachment: null };
        }

        const cid = crearCidFirma(correo);
        const attachment = {
            filename: 'firma-biznaga.jpg',
            content: buffer,
            cid,
            contentType: 'image/jpeg',
            contentDisposition: 'inline'
        };

        cacheFirmas.set(driveId, { cid, attachment });

        return {
            html: construirHtmlFirma(cid),
            attachment
        };
    } catch (error) {
        console.warn(`[CORREO] Firma digital no disponible (${correo}):`, error?.message || error);
        return { html: '', attachment: null };
    }
}

module.exports = {
    ESTILO_CUERPO_CORREO,
    ESTILO_IMG_FIRMA,
    FIRMA_MAX_WIDTH_PX,
    FIRMAS_CORREO_DEFECTO,
    obtenerFirmaParaCorreo,
    obtenerFirmaHtmlBase64,
    repararFirmasEnHtml,
    normalizarImagenesFirmaEnHtml,
    obtenerDriveIdFirma,
    tieneFirmaDigital
};
