const driveService = require('./driveService');

const cacheFirmas = new Map();

/** IDs de Google Drive por buzón (fallback si no hay CORREO_FIRMA_* en .env). */
const FIRMAS_CORREO_DEFECTO = {
    'adrian_seguridad@biznaga.com.mx': '1gIcHRwDMycyXoszzCYU68hL6IvwEXodY', // arle_gate
    'alexis_design@biznaga.com.mx': '1JqqUq9HjuztiJIIUoV-914T147rw5jWk', // alexismf
    'areli_seguridad@biznaga.com.mx': '12hE3j3gIfq-Xf6oV151ogtQRviBQrGeO', // Areli
    'daniel_seguridad@biznaga.com.mx': '14xxJxzTlQ9k761MlQBMW5yyiXdPvNwZV', // Irvin
    'edmundo_pc@biznaga.com.mx': '1c3I6fSXbiCKc8R2vimowBqAR8zsNwyUq', // Edmundo
    'efrain_salud@biznaga.com.mx': '1E2i-aSvoVau5ktRzkmRx3U8aycV41qI6', // drefrain34
    'facturas@biznaga.com.mx': '1Pqx2LfM_2_ePuIbMSqLsBc6p9NnO84Uy', // RozanaRG
    'fernanda_talentohumano@biznaga.com.mx': '1EvEqmifoFQzWHTuShmks99n0uNUM2oJc', // mafer295
    'fernando_design@biznaga.com.mx': '1aVxvu_0IYVgi05jbobZFXW4lpGPjlEY-', // pumba24
    'hector_ti@biznaga.com.mx': '1kUm75eH_B5Jd6tMJfD8cMI5AyMgO9q9l', // Hector
    'joseluis_ambiental@biznaga.com.mx': '1yEXCzyvwIsg7Rfa071nJHAKwfBJgVqNp', // joseluis_ambiental
    'leonel_innovacion@biznaga.com.mx': '16j3LFi09Zi3-HHZfLRtoqsUcEVf63_Y8', // leonel58
    'mariana_administracion@biznaga.com.mx': '1dntOoHOzkZl8IVBeu8W-OO-TiyuBvM-X', // Mar
    'marisol_ceo@biznaga.com.mx': '11wInrv4OK4JBR8a-iNXuGOLgEofeHcP8', // marisol12
    'melody_supervision@biznaga.com.mx': '1B0DbcjAdMZ7tVskeGYGVoCWx2r9RXKJO',
    'pascual_seguridad@biznaga.com.mx': '1oAIhF_pHA8QM_2XxydtrL08Qm79EovHm', // pascual123
    'ruben_seguridad@biznaga.com.mx': '1H-uZCLLbxEZcWVo5EkkqtqcLAVWTYb4t', // RubenRamirez
    'saul_calidad@biznaga.com.mx': '1N-xowVhyDsJbQ7mP2aYZoZ6IVmT-f4mI', // saul
    'sergio_calidad@biznaga.com.mx': '1oj7NcbERIlV7rnu7iHeuLDU5reUrRD0w' // calidad
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
