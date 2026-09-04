const express = require('express');
const path = require('path');
const correoImapService = require('./correoImapService');
const correoFirmaService = require('./correoFirmaService');
const correoAdjuntosService = require('./correoAdjuntosService');

const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Biznaga Risk&Tech';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER || '';
const CORREO_DEBUG = String(process.env.CORREO_DEBUG || 'false').toLowerCase() === 'true';
// Límite MIME estimado para adjuntos embebidos.
// cPanel ~20 MB total → default seguro 15. Brevo suele aceptar más (~28–35).
const CORREO_LIMITE_MENSAJE_MB_ENV = process.env.CORREO_LIMITE_MENSAJE_MB;
const CORREO_LIMITE_MENSAJE_MB_CPANEL = Math.max(1, Number(CORREO_LIMITE_MENSAJE_MB_ENV || 15));
const CORREO_LIMITE_MENSAJE_MB_BREVO = Math.max(
    CORREO_LIMITE_MENSAJE_MB_CPANEL,
    Number(process.env.CORREO_LIMITE_MENSAJE_MB_BREVO || 28)
);

module.exports = function createCorreoRoutes(deps) {
    const {
        emailService,
        obtenerContextoCorreoPerfil,
        responderErrorCorreo,
        cerrarClienteImap,
        normalizarTextoCorreo,
        escaparHtmlCorreo,
        convertirTextoCorreoHtml,
        esCorreoValido,
        obtenerConfigSmtp,
        esEnvioCorreoViaBrevo,
        getPool,
        ambitoCorreo = 'personal'
    } = deps;

    const router = express.Router();

    router.use((req, res, next) => {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store',
            'Vary': 'Authorization, Accept-Encoding'
        });
        next();
    });

    function enviarJsonCorreo(res, payload) {
        res.set('Content-Type', 'application/json; charset=utf-8');
        return res.send(JSON.stringify(payload));
    }

    let promesaTablaBusquedas = null;

    function obtenerPool() {
        return typeof getPool === 'function' ? getPool() : null;
    }

    function asegurarTablaBusquedas() {
        const db = obtenerPool();
        if (!db) {
            return Promise.reject(new Error('Base de datos no disponible para el historial de búsquedas'));
        }
        if (!promesaTablaBusquedas) {
            promesaTablaBusquedas = db.query(`
                CREATE TABLE IF NOT EXISTS correo_busquedas (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    usuario_id INT NOT NULL,
                    ambito VARCHAR(20) NOT NULL DEFAULT 'personal',
                    termino VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_correo_busqueda_usuario (usuario_id, ambito, termino),
                    INDEX idx_correo_busqueda_reciente (usuario_id, ambito, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `).catch((error) => {
                promesaTablaBusquedas = null;
                throw error;
            });
        }
        return promesaTablaBusquedas;
    }

    function normalizarTerminoBusqueda(valor) {
        return String(valor || '').trim().replace(/\s+/g, ' ').slice(0, 255);
    }

    async function listarBusquedasUsuario(usuarioId) {
        await asegurarTablaBusquedas();
        const [rows] = await obtenerPool().query(
            `SELECT id, termino, created_at
             FROM correo_busquedas
             WHERE usuario_id = ? AND ambito = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 20`,
            [usuarioId, ambitoCorreo]
        );
        return rows || [];
    }

    function parsearListaCorreos(valor = '') {
        const partes = String(valor)
            .split(/[;,\n]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        const unicos = [];
        const vistos = new Set();

        for (const correo of partes) {
            if (!vistos.has(correo)) {
                vistos.add(correo);
                unicos.push(correo);
            }
        }

        return unicos;
    }

    function logCorreoDebug(...args) {
        if (CORREO_DEBUG) {
            console.log(...args);
        }
    }

    function obtenerRemitenteBiznaga() {
        return `"${EMAIL_FROM_NAME}" <${EMAIL_FROM_ADDRESS}>`;
    }

    // Siempre mostrar el nombre corporativo, pero con el correo del empleado que envia.
    function obtenerRemitentePerfil(correoPerfil) {
        const correo = String(correoPerfil || '').trim().toLowerCase();
        if (!correo) {
            return obtenerRemitenteBiznaga();
        }
        return `"${EMAIL_FROM_NAME}" <${correo}>`;
    }

    async function construirHtmlCorreoPerfil(htmlMensaje, correoPerfil) {
        const firma = await correoFirmaService.obtenerFirmaParaCorreo(correoPerfil);
        const html = `
            <div style="${correoFirmaService.ESTILO_CUERPO_CORREO}">
                ${htmlMensaje}
                ${firma.html}
            </div>
        `.trim();

        return {
            html,
            firmaAttachment: firma.attachment
        };
    }

    async function construirHtmlCorreoCopiaImap(htmlMensaje, correoPerfil) {
        const firmaHtml = await correoFirmaService.obtenerFirmaHtmlBase64(correoPerfil);
        return `
            <div style="${correoFirmaService.ESTILO_CUERPO_CORREO}">
                ${htmlMensaje}
                ${firmaHtml}
            </div>
        `.trim();
    }

    async function prepararContenidoHtmlCorreo(source, correoPerfil) {
        const contenido = await correoImapService.extraerContenidoCorreo(source);
        let html = await correoFirmaService.repararFirmasEnHtml(contenido.html, correoPerfil);

        if (!html.trim() && contenido.texto) {
            const firmaHtml = await correoFirmaService.obtenerFirmaHtmlBase64(correoPerfil);
            const textoHtml = convertirTextoCorreoHtml(contenido.texto);
            html = `
                <div style="${correoFirmaService.ESTILO_CUERPO_CORREO}">
                    ${textoHtml}
                    ${firmaHtml}
                </div>
            `.trim();
        }

        return {
            html,
            texto: contenido.texto,
            parsed: contenido.parsed
        };
    }

    async function marcarCorreoComoLeido(client, carpetaPath, uid) {
        try {
            await correoImapService.marcarMensajeLeido(client, carpetaPath, uid, true);
        } catch (error) {
            logCorreoDebug(`[CORREO] No se pudo marcar como leido uid=${uid}:`, error?.message || error);
        }
    }

    function combinarAdjuntosCorreo(adjuntosUsuario = [], firmaAttachment = null) {
        const adjuntos = Array.isArray(adjuntosUsuario) ? [...adjuntosUsuario] : [];
        if (firmaAttachment) {
            adjuntos.push(firmaAttachment);
        }
        return adjuntos.length ? adjuntos : undefined;
    }

    function construirTextoCorreoPerfil(texto) {
        return String(texto || '').trim();
    }

    function esErrorTamanoCorreo(mensaje = '') {
        const texto = String(mensaje || '').toLowerCase();
        return texto.includes('552')
            || texto.includes('mail size too large')
            || texto.includes('message too large')
            || texto.includes('size limit')
            || texto.includes('exceeds maximum');
    }

    function estimarBytesMimeAdjunto(adjunto) {
        const raw = Buffer.isBuffer(adjunto?.content) ? adjunto.content.length : 0;
        // Base64 (~4/3) + cabeceras MIME del part.
        return Math.ceil(raw * 4 / 3) + 1024;
    }

    function estimarBytesMimeAdjuntos(adjuntos = []) {
        if (!Array.isArray(adjuntos) || adjuntos.length === 0) {
            return 0;
        }
        return adjuntos.reduce((sum, adjunto) => sum + estimarBytesMimeAdjunto(adjunto), 0);
    }

    function obtenerLimiteMensajeBytes() {
        const usarBrevo = typeof esEnvioCorreoViaBrevo === 'function'
            && esEnvioCorreoViaBrevo()
            && emailService?.isEnabled?.();
        const mb = usarBrevo ? CORREO_LIMITE_MENSAJE_MB_BREVO : CORREO_LIMITE_MENSAJE_MB_CPANEL;
        return Math.round(mb * 1024 * 1024);
    }

    function extensionArchivoCorreo(nombre = '') {
        const ext = String(nombre || '').split('.').pop()?.toLowerCase() || '';
        if (!ext || ext === String(nombre).toLowerCase()) return 'DOC';
        return ext.slice(0, 4).toUpperCase();
    }

    function construirBloqueEnlacesDescargaHtml(paquete) {
        if (!paquete || !Array.isArray(paquete.archivos) || paquete.archivos.length === 0) {
            return '';
        }

        const fechaTexto = escaparHtmlCorreo(
            paquete.fechaExpiracionTexto
            || correoAdjuntosService.formatearFechaLargaEs(paquete.expiresAt)
        );
        const archivos = paquete.archivos;
        const urlZip = escaparHtmlCorreo(paquete.urlZip || '');
        const totalArchivos = archivos.length;
        const etiquetaArchivos = totalArchivos === 1 ? '1 documento' : `${totalArchivos} documentos`;

        const items = archivos.map((item, index) => {
            const nombre = escaparHtmlCorreo(item.nombre || 'Archivo');
            const url = escaparHtmlCorreo(item.url || paquete.url || '#');
            const tamano = escaparHtmlCorreo(
                item.tamanoTexto
                || correoAdjuntosService.formatearTamanoHumano(item.tamanoBytes)
            );
            const ext = escaparHtmlCorreo(extensionArchivoCorreo(item.nombre || ''));
            const bordeInferior = index < archivos.length - 1 ? 'border-bottom:1px solid #e7eee9;' : '';

            return `
              <tr>
                <td style="padding:16px 20px;${bordeInferior}">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr>
                      <td width="48" valign="middle" style="padding-right:14px;">
                        <div style="width:44px;height:52px;background:#f4f7f5;border:1px solid #d8e3dc;border-radius:8px;text-align:center;line-height:52px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#1f6b4a;letter-spacing:0.4px;">
                          ${ext}
                        </div>
                      </td>
                      <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;">
                        <div style="font-size:15px;font-weight:700;color:#14261f;line-height:1.35;word-break:break-word;">
                          ${nombre}
                        </div>
                        <div style="margin-top:4px;font-size:12px;color:#6a7a72;">
                          ${tamano} · Descarga segura
                        </div>
                      </td>
                      <td width="132" valign="middle" align="right" style="padding-left:12px;white-space:nowrap;">
                        <a href="${url}" target="_blank" style="display:inline-block;padding:11px 18px;background:#1f6b4a;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.2px;border:1px solid #164f37;">
                          Descargar
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`;
        }).join('');

        const filaZip = archivos.length > 1 && urlZip
            ? `
              <tr>
                <td style="padding:0 20px 18px 20px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f7faf8;border:1px solid #dce7e1;border-radius:10px;">
                    <tr>
                      <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#345246;">
                        ¿Prefiere bajarlos juntos?
                      </td>
                      <td align="right" style="padding:14px 16px;white-space:nowrap;">
                        <a href="${urlZip}" target="_blank" style="display:inline-block;padding:10px 16px;background:#164f37;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">
                          Descargar todo (.zip)
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
            : '';

        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-collapse:collapse;max-width:640px;">
            <tr>
              <td style="background:#ffffff;border:1px solid #d5e0d9;border-radius:14px;overflow:hidden;">
                <!-- Header -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:18px 20px 14px 20px;background:#16382b;border-radius:14px 14px 0 0;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9bc4af;font-weight:700;">
                        Biznaga · Documentos
                      </div>
                      <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#ffffff;line-height:1.3;">
                        Archivos listos para descarga
                      </div>
                      <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#c5ddd1;">
                        ${escaparHtmlCorreo(etiquetaArchivos)} disponibles en este correo
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Aviso -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:14px 20px;background:#f3f8f5;border-bottom:1px solid #e2ebe6;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                        <tr>
                          <td width="28" valign="top" style="padding-right:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f6b4a;font-weight:700;">
                            i
                          </td>
                          <td style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.55;color:#3d5448;">
                            <strong style="color:#1f6b4a;">Aviso:</strong>
                            los documentos compartidos mediante este correo estarán disponibles para descarga hasta el
                            <strong style="color:#16382b;">${fechaTexto}</strong>.
                            Una vez transcurrida esa fecha, los enlaces dejarán de estar disponibles.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Archivos -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${items}
                </table>

                ${filaZip}

                <!-- Footer bloque -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:12px 20px 16px 20px;border-top:1px solid #e7eee9;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#7a8a82;">
                      Al pulsar <strong style="color:#4b5d54;">Descargar</strong> el archivo se obtiene de forma directa.
                      No requiere cuenta de Google ni contraseña.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        `.trim();
    }

    function construirBloqueEnlacesDescargaTexto(paquete) {
        if (!paquete || !Array.isArray(paquete.archivos) || paquete.archivos.length === 0) {
            return '';
        }

        const fechaTexto = paquete.fechaExpiracionTexto
            || correoAdjuntosService.formatearFechaLargaEs(paquete.expiresAt);
        const lineas = paquete.archivos.map((item) => {
            const tamano = item.tamanoTexto
                || correoAdjuntosService.formatearTamanoHumano(item.tamanoBytes);
            return `- ${item.nombre || 'Archivo'} (${tamano}): ${item.url || ''}`;
        });

        return [
            '',
            `Aviso: los documentos compartidos mediante este correo estarán disponibles para descarga hasta el ${fechaTexto}. Una vez transcurrida esa fecha, los enlaces dejarán de estar disponibles.`,
            '',
            paquete.urlZip ? `Descargar todo (.zip): ${paquete.urlZip}` : null,
            'Archivos:',
            ...lineas,
            ''
        ].filter((x) => x !== null).join('\n');
    }

    async function guardarAdjuntosGrandesLocal(adjuntosGrandes = [], correoPerfil = '', destinatarios = '') {
        if (!Array.isArray(adjuntosGrandes) || adjuntosGrandes.length === 0) {
            return null;
        }

        return correoAdjuntosService.guardarPaqueteAdjuntos(
            adjuntosGrandes.map((adjunto) => ({
                content: adjunto.content,
                filename: adjunto.filename,
                contentType: adjunto.contentType
            })),
            {
                remitente: correoPerfil,
                destinatarios: destinatarios || null
            }
        );
    }

    /**
     * Si el MIME estimado supera el límite SMTP, guarda los adjuntos más grandes
     * en el servidor y deja enlaces de descarga directa en el cuerpo del correo.
     */
    async function resolverAdjuntosGrandes(attachments = [], correoPerfil = '', destinatarios = '') {
        const adjuntos = Array.isArray(attachments) ? [...attachments] : [];
        if (adjuntos.length === 0) {
            return {
                attachmentsInline: [],
                enlacesDescarga: [],
                paquete: null,
                bloqueHtml: '',
                bloqueTexto: ''
            };
        }

        const ordenados = [...adjuntos].sort(
            (a, b) => (Buffer.isBuffer(b.content) ? b.content.length : 0)
                - (Buffer.isBuffer(a.content) ? a.content.length : 0)
        );

        const limiteBytes = obtenerLimiteMensajeBytes();
        const limiteMb = Math.round(limiteBytes / (1024 * 1024));
        const paraEnlace = [];
        const inline = [...ordenados];

        while (inline.length > 0 && estimarBytesMimeAdjuntos(inline) > limiteBytes) {
            paraEnlace.push(inline.shift());
        }

        if (paraEnlace.length === 0) {
            return {
                attachmentsInline: adjuntos,
                enlacesDescarga: [],
                paquete: null,
                bloqueHtml: '',
                bloqueTexto: ''
            };
        }

        console.log(
            `[CORREO] Adjuntos grandes → enlace de descarga | ${paraEnlace.length} archivo(s) | límite ${limiteMb} MB | base=${correoAdjuntosService.PUBLIC_BASE_URL} | ${correoPerfil || '?'}`
        );
        if (correoAdjuntosService.esUrlPublicaLocal()) {
            console.warn(
                '[CORREO] PUBLIC_API_URL apunta a localhost: destinatarios externos no podrán descargar. En producción use https://api.sistema.biznaga.com.mx'
            );
        }

        const paquete = await guardarAdjuntosGrandesLocal(paraEnlace, correoPerfil, destinatarios);
        const enlacesDescarga = (paquete?.archivos || []).map((archivo) => ({
            nombre: archivo.nombre,
            url: archivo.url,
            tamanoBytes: archivo.tamanoBytes,
            expiresAt: paquete.expiresAt,
            fechaExpiracionTexto: paquete.fechaExpiracionTexto
        }));

        return {
            attachmentsInline: inline,
            enlacesDescarga,
            paquete,
            bloqueHtml: construirBloqueEnlacesDescargaHtml(paquete),
            bloqueTexto: construirBloqueEnlacesDescargaTexto(paquete)
        };
    }

    async function enviarViaSmtpGlobal({
        destinatario,
        cc,
        cco,
        asunto,
        html,
        text,
        correoPerfil,
        adjuntosCorreo,
        inReplyTo,
        references
    }) {
        if (!emailService.isEnabled()) {
            return { success: false, error: 'Servicio SMTP global no disponible' };
        }

        return emailService.enviarCorreo({
            to: destinatario,
            cc: cc || undefined,
            bcc: cco || undefined,
            subject: asunto,
            html,
            text,
            from: obtenerRemitentePerfil(correoPerfil),
            replyTo: correoPerfil,
            attachments: adjuntosCorreo,
            inReplyTo: inReplyTo || undefined,
            references: references || undefined,
            quiet: true
        });
    }

    async function enviarViaSmtpPerfil({
        correoPerfil,
        nombrePerfil,
        destinatario,
        cc,
        cco,
        asunto,
        html,
        text,
        adjuntosCorreo,
        inReplyTo,
        references
    }) {
        const configSmtp = obtenerConfigSmtp(correoPerfil);
        if (!configSmtp.host || !configSmtp.pass) {
            return { success: false, error: 'Configuracion SMTP del perfil incompleta' };
        }

        return emailService.enviarCorreoPerfil({
            correoRemitente: correoPerfil,
            nombreRemitente: EMAIL_FROM_NAME,
            password: configSmtp.pass,
            smtpHost: configSmtp.host,
            smtpPort: configSmtp.port,
            smtpSecure: configSmtp.secure,
            smtpRequireTls: configSmtp.requireTLS,
            rejectUnauthorized: configSmtp.rejectUnauthorized,
            to: destinatario,
            cc: cc || undefined,
            bcc: cco || undefined,
            subject: asunto,
            html,
            text,
            attachments: adjuntosCorreo,
            inReplyTo: inReplyTo || undefined,
            references: references || undefined
        });
    }

    function sincronizarConteoCarpeta(carpetas, carpetaId, conteo) {
        if (!Array.isArray(carpetas) || !carpetaId) {
            return carpetas;
        }

        return carpetas.map(carpeta =>
            carpeta.id === carpetaId
                ? {
                    ...carpeta,
                    total: Number(conteo?.total ?? carpeta.total ?? 0),
                    noLeidos: Number(conteo?.noLeidos ?? carpeta.noLeidos ?? 0)
                }
                : carpeta
        );
    }

    async function intentarGuardarCopiaEnviados(contexto, mailOptions) {
        let client;

        try {
            const messageBuffer = await emailService.compilarMensajeCorreo(mailOptions);
            client = correoImapService.crearClienteImap(contexto.correoPerfil, contexto.configImap);
            await client.connect();
            const resultado = await correoImapService.guardarCopiaEnEnviados(client, messageBuffer);
            await client.logout();
            client = null;

            if (!resultado.guardado) {
                console.warn('[CORREO] Copia no guardada en Enviados:', resultado.motivo || 'desconocido');
            }

            return resultado;
        } catch (error) {
            console.warn('[CORREO] Error al guardar copia en Enviados:', error?.message || error);
            return { guardado: false, error: error?.message || 'error_imap' };
        } finally {
            await cerrarClienteImap(client);
        }
    }

    router.get('/busquedas', async (req, res) => {
        try {
            const busquedas = await listarBusquedasUsuario(req.user.id);
            return res.json({ success: true, busquedas });
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener el historial de búsquedas');
        }
    });

    router.post('/busquedas', async (req, res) => {
        try {
            const termino = normalizarTerminoBusqueda(req.body?.termino);
            if (!termino) {
                return res.status(400).json({ success: false, message: 'La búsqueda no puede estar vacía' });
            }

            await asegurarTablaBusquedas();
            const db = obtenerPool();
            await db.query(
                `INSERT INTO correo_busquedas (usuario_id, ambito, termino)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP, id = LAST_INSERT_ID(id)`,
                [req.user.id, ambitoCorreo, termino]
            );
            await db.query(
                `DELETE FROM correo_busquedas
                 WHERE usuario_id = ? AND ambito = ? AND id NOT IN (
                    SELECT id FROM (
                        SELECT id
                        FROM correo_busquedas
                        WHERE usuario_id = ? AND ambito = ?
                        ORDER BY created_at DESC, id DESC
                        LIMIT 20
                    ) recientes
                 )`,
                [req.user.id, ambitoCorreo, req.user.id, ambitoCorreo]
            );

            const busquedas = await listarBusquedasUsuario(req.user.id);
            return res.json({ success: true, busquedas });
        } catch (error) {
            return responderErrorCorreo(res, error, 'guardar la búsqueda');
        }
    });

    router.delete('/busquedas/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Búsqueda inválida' });
            }
            await asegurarTablaBusquedas();
            await obtenerPool().query(
                'DELETE FROM correo_busquedas WHERE id = ? AND usuario_id = ? AND ambito = ?',
                [id, req.user.id, ambitoCorreo]
            );
            return res.json({ success: true });
        } catch (error) {
            return responderErrorCorreo(res, error, 'eliminar la búsqueda');
        }
    });

    router.delete('/busquedas', async (req, res) => {
        try {
            await asegurarTablaBusquedas();
            await obtenerPool().query(
                'DELETE FROM correo_busquedas WHERE usuario_id = ? AND ambito = ?',
                [req.user.id, ambitoCorreo]
            );
            return res.json({ success: true });
        } catch (error) {
            return responderErrorCorreo(res, error, 'borrar el historial de búsquedas');
        }
    });

    router.get('/firma-digital', async (req, res) => {
        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil } = contexto;
            const html = await correoFirmaService.obtenerFirmaHtmlBase64(correoPerfil);

            return enviarJsonCorreo(res, {
                success: true,
                cuenta: correoPerfil,
                tieneFirma: Boolean(html),
                html: html || ''
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'firma-digital');
        }
    });

    router.get('/carpetas', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            logCorreoDebug(`[CORREO] GET /carpetas cuenta=${correoPerfil}`);
            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpetas = await correoImapService.listarCarpetas(client);
            await client.logout();
            client = null;

            return enviarJsonCorreo(res, {
                success: true,
                cuenta: correoPerfil,
                carpetas
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener las carpetas del buzon');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.get('/', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 50);
            const pagina = Math.max(1, Math.floor(Number(req.query.pagina || 1)) || 1);
            const offset = (pagina - 1) * limit;
            const busqueda = normalizarTerminoBusqueda(req.query.q);
            const incluirCarpetas = String(req.query.incluirCarpetas || '1').trim() !== '0';

            logCorreoDebug(`[CORREO] GET / carpeta=${carpetaId} cuenta=${correoPerfil}`);
            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const listado = await client.list();
            let carpetas = [];
            if (incluirCarpetas) {
                carpetas = await correoImapService.listarCarpetas(client, listado);
            }

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId, listado);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({
                    success: false,
                    message: 'La carpeta solicitada no existe en el buzon',
                    carpeta: carpetaId,
                    carpetas
                });
            }

            const resultadoLista = await correoImapService.listarMensajes(
                client,
                carpeta.path,
                limit,
                offset,
                busqueda
            );
            const mensajes = resultadoLista.mensajes.map(mensaje =>
                correoImapService.mapearMensajeLista(mensaje, correoPerfil, null, carpeta.id)
            );

            if (incluirCarpetas) {
                carpetas = sincronizarConteoCarpeta(carpetas, carpeta.id, {
                    total: resultadoLista.totalCarpeta,
                    noLeidos: resultadoLista.noLeidos
                });
            }

            await client.logout();
            client = null;

            logCorreoDebug(`[CORREO] OK carpeta=${carpetaId} path=${resultadoLista.path || carpeta.path} mensajes=${mensajes.length} total=${resultadoLista.total} carpetas=${carpetas.length}`);
            res.set('X-Correo-Carpeta', carpeta.id);
            return enviarJsonCorreo(res, {
                success: true,
                cuenta: correoPerfil,
                carpeta: {
                    id: carpeta.id,
                    etiqueta: carpeta.etiqueta,
                    path: resultadoLista.path || carpeta.path
                },
                carpetas: incluirCarpetas ? carpetas : undefined,
                total: resultadoLista.total,
                totalCarpeta: resultadoLista.totalCarpeta,
                pagina,
                limit,
                totalPaginas: Math.max(1, Math.ceil(resultadoLista.total / limit)),
                busqueda: busqueda || '',
                mensajes,
                actualizado: new Date().toISOString()
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener los correos del buzon');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.get('/:uid/vista', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }

            logCorreoDebug(`[CORREO] GET /${uid}/vista carpeta=${carpetaId} cuenta=${correoPerfil}`);
            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const mensaje = await correoImapService.obtenerMensajePorUid(client, carpeta.path, uid);
            await marcarCorreoComoLeido(client, carpeta.path, uid);
            await client.logout();
            client = null;

            if (!mensaje?.source) {
                return res.status(404).json({ success: false, message: 'Correo no encontrado' });
            }

            const contenido = await prepararContenidoHtmlCorreo(mensaje.source, correoPerfil);
            const detalle = correoImapService.extraerDetalleMensaje(contenido.parsed, correoPerfil);
            let documento = correoImapService.envolverDocumentoHtml(contenido.html);

            if (!documento && contenido.texto) {
                const textoHtml = convertirTextoCorreoHtml(contenido.texto);
                documento = correoImapService.envolverDocumentoHtml(
                    `<div style="font-family:Arial,sans-serif;line-height:1.6;">${textoHtml}</div>`
                );
            }

            if (!documento) {
                return res.status(404).json({ success: false, message: 'El correo no tiene contenido visible' });
            }

            return res.json({
                success: true,
                uid,
                carpeta: carpeta.id,
                detalle,
                html: documento
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener la vista del correo');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.get('/:uid/html', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }

            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const mensaje = await correoImapService.obtenerMensajePorUid(client, carpeta.path, uid);
            await marcarCorreoComoLeido(client, carpeta.path, uid);
            await client.logout();
            client = null;

            if (!mensaje?.source) {
                return res.status(404).json({ success: false, message: 'Correo no encontrado' });
            }

            const contenido = await prepararContenidoHtmlCorreo(mensaje.source, correoPerfil);
            let documento = correoImapService.envolverDocumentoHtml(contenido.html);

            if (!documento && contenido.texto) {
                const textoHtml = convertirTextoCorreoHtml(contenido.texto);
                documento = correoImapService.envolverDocumentoHtml(`<div style="font-family:Arial,sans-serif;line-height:1.6;">${textoHtml}</div>`);
            }

            if (!documento) {
                return res.status(404).json({ success: false, message: 'El correo no tiene contenido visible' });
            }

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('X-Correo-Carpeta', carpeta.id);
            return res.send(documento);
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener el contenido HTML del correo');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.get('/:uid/adjuntos/:indice', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);
            const indice = Number(req.params.indice || -1);

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }
            if (!Number.isInteger(indice) || indice < 0) {
                return res.status(400).json({ success: false, message: 'Indice de adjunto invalido' });
            }

            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const mensaje = await correoImapService.obtenerMensajePorUid(client, carpeta.path, uid);
            await client.logout();
            client = null;

            if (!mensaje?.source) {
                return res.status(404).json({ success: false, message: 'Correo no encontrado' });
            }

            const { simpleParser } = require('mailparser');
            const parsed = await simpleParser(mensaje.source);
            const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
            const adjuntosDescargables = correoImapService.filtrarAdjuntosDescargables(attachments);
            const adjuntoSeleccionado = adjuntosDescargables[indice] || null;

            if (!adjuntoSeleccionado) {
                return res.status(404).json({ success: false, message: 'Adjunto no encontrado' });
            }

            const nombreArchivo = adjuntoSeleccionado.filename || `adjunto-${indice + 1}`;
            let buffer = null;

            if (Buffer.isBuffer(adjuntoSeleccionado.content)) {
                buffer = adjuntoSeleccionado.content;
            } else if (adjuntoSeleccionado.content instanceof Uint8Array) {
                buffer = Buffer.from(adjuntoSeleccionado.content);
            } else if (typeof adjuntoSeleccionado.content === 'string') {
                buffer = Buffer.from(adjuntoSeleccionado.content, 'utf8');
            } else {
                buffer = Buffer.from([]);
            }

            res.setHeader('Content-Type', adjuntoSeleccionado.contentType || 'application/octet-stream');
            // RFC 5987: filename ASCII fallback + filename*=UTF-8''... (acentos, ñ, etc.)
            res.setHeader('Content-Disposition', correoAdjuntosService.contentDispositionAttachment(nombreArchivo));
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Cache-Control', 'no-store');
            return res.send(buffer);
        } catch (error) {
            return responderErrorCorreo(res, error, 'descargar el adjunto');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.get('/:uid/adjuntos', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }

            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const mensaje = await correoImapService.obtenerMensajePorUid(client, carpeta.path, uid);
            await client.logout();
            client = null;

            if (!mensaje?.source) {
                return res.status(404).json({ success: false, message: 'Correo no encontrado' });
            }

            const { simpleParser } = require('mailparser');
            const parsed = await simpleParser(mensaje.source);
            const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
            const adjuntos = correoImapService.mapearAdjuntosDescargables(attachments);

            return res.json({
                success: true,
                uid,
                total: adjuntos.length,
                adjuntos
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'obtener los adjuntos del correo');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.post('/:uid/accion', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);
            const accion = String(req.body?.accion || '').trim().toLowerCase();
            const activo = req.body?.activo;

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }
            if (!accion) {
                return res.status(400).json({ success: false, message: 'La accion es obligatoria' });
            }

            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const resultado = await correoImapService.ejecutarAccionMensaje(client, carpeta, uid, accion, { activo });
            await client.logout();
            client = null;

            return res.json({
                success: true,
                uid,
                carpeta: carpeta.id,
                accion,
                resultado: resultado || null
            });
        } catch (error) {
            return responderErrorCorreo(res, error, 'ejecutar la accion del correo');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.delete('/:uid', async (req, res) => {
        let client;

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, configImap } = contexto;
            const carpetaId = String(req.query.carpeta || 'inbox').trim().toLowerCase();
            const uid = Number(req.params.uid || 0);

            if (!uid || Number.isNaN(uid)) {
                return res.status(400).json({ success: false, message: 'UID de correo invalido' });
            }

            client = correoImapService.crearClienteImap(correoPerfil, configImap);
            await client.connect();

            const carpeta = await correoImapService.resolverRutaCarpeta(client, carpetaId);
            if (!carpeta?.path) {
                await client.logout();
                client = null;
                return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
            }

            const eliminado = await correoImapService.eliminarMensaje(client, carpeta.path, uid);
            await client.logout();
            client = null;

            if (!eliminado) {
                return res.status(404).json({ success: false, message: 'Correo no encontrado' });
            }

            return res.json({ success: true, uid, carpeta: carpeta.id });
        } catch (error) {
            return responderErrorCorreo(res, error, 'eliminar');
        } finally {
            await cerrarClienteImap(client);
        }
    });

    router.post('/enviar', async (req, res) => {
        const inicioEnvio = Date.now();
        let correoPerfilLog = '';
        let destinatarioLog = '';

        try {
            const contexto = await obtenerContextoCorreoPerfil(req, res);
            if (!contexto) return;

            const { correoPerfil, nombrePerfil } = contexto;
            correoPerfilLog = correoPerfil;
            const destinatarios = parsearListaCorreos(req.body?.destinatario || req.body?.to || '');
            const destinatario = destinatarios.join(', ');
            destinatarioLog = destinatario;
            const correosCc = parsearListaCorreos(req.body?.cc || '');
            const correosCco = parsearListaCorreos(req.body?.cco || '');
            const cc = correosCc.join(', ');
            const cco = correosCco.join(', ');
            const asunto = String(req.body?.asunto || req.body?.subject || '').trim();
            const mensaje = normalizarTextoCorreo(req.body?.mensaje || req.body?.cuerpo || req.body?.text || '');
            const htmlPersonalizado = String(req.body?.html || '').trim();
            const inReplyTo = String(req.body?.inReplyTo || req.body?.in_reply_to || '').trim();
            const references = String(req.body?.references || '').trim();

            if (destinatarios.length === 0) {
                return res.status(400).json({ success: false, message: 'Indica al menos un destinatario valido' });
            }

            const destinatariosInvalidos = destinatarios.filter((correo) => !esCorreoValido(correo));
            if (destinatariosInvalidos.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Correo(s) no valido(s): ${destinatariosInvalidos.join(', ')}`
                });
            }

            const correosCcInvalidos = correosCc.filter((correo) => !esCorreoValido(correo));
            if (correosCcInvalidos.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Correo(s) CC no valido(s): ${correosCcInvalidos.join(', ')}`
                });
            }

            const correosCcoInvalidos = correosCco.filter((correo) => !esCorreoValido(correo));
            if (correosCcoInvalidos.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Correo(s) CCO no valido(s): ${correosCcoInvalidos.join(', ')}`
                });
            }
            if (!asunto) {
                return res.status(400).json({ success: false, message: 'El asunto es obligatorio' });
            }
            if (!mensaje && !htmlPersonalizado) {
                return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacio' });
            }

            const adjuntosEntrada = Array.isArray(req.body?.adjuntos) ? req.body.adjuntos : [];
            const attachments = adjuntosEntrada
                .map((adjunto, index) => {
                    const contenidoBase64 = String(adjunto?.contenidoBase64 || adjunto?.contentBase64 || '').trim();
                    if (!contenidoBase64) {
                        return null;
                    }

                    const nombre = path.basename(String(adjunto?.nombre || adjunto?.filename || `adjunto-${index + 1}`))
                        .replace(/["\r\n]/g, '') || `adjunto-${index + 1}`;

                    return {
                        filename: nombre,
                        content: Buffer.from(contenidoBase64, 'base64'),
                        contentType: String(adjunto?.contentType || adjunto?.tipo || 'application/octet-stream')
                    };
                })
                .filter(Boolean);

            let adjuntosResueltos;
            try {
                adjuntosResueltos = await resolverAdjuntosGrandes(attachments, correoPerfil, destinatario);
            } catch (errorAdjuntos) {
                const detalle = errorAdjuntos?.message || String(errorAdjuntos);
                console.error(`[CORREO] Error preparando adjuntos grandes: ${detalle}`);
                return res.status(502).json({
                    success: false,
                    message: `No se pudieron preparar los archivos grandes para envío: ${detalle}`
                });
            }

            const htmlBase = htmlPersonalizado || convertirTextoCorreoHtml(mensaje);
            const htmlMensaje = adjuntosResueltos.bloqueHtml
                ? `${htmlBase}${adjuntosResueltos.bloqueHtml}`
                : htmlBase;
            const correoCompuesto = await construirHtmlCorreoPerfil(htmlMensaje, correoPerfil);
            const html = correoCompuesto.html;
            const textoBase = construirTextoCorreoPerfil(
                mensaje || normalizarTextoCorreo(htmlPersonalizado.replace(/<[^>]+>/g, ' '))
            );
            const text = adjuntosResueltos.bloqueTexto
                ? `${textoBase}\n${adjuntosResueltos.bloqueTexto}`.trim()
                : textoBase;
            const attachmentsInline = adjuntosResueltos.attachmentsInline || [];
            const adjuntosCorreo = combinarAdjuntosCorreo(attachmentsInline, correoCompuesto.firmaAttachment);
            const enlacesDescarga = adjuntosResueltos.enlacesDescarga || [];
            const paqueteDescarga = adjuntosResueltos.paquete || null;

            const mailOptions = {
                from: obtenerRemitentePerfil(correoPerfil),
                replyTo: correoPerfil,
                to: destinatario,
                subject: asunto,
                html,
                text,
                date: new Date(),
                attachments: adjuntosCorreo
            };

            if (cc) {
                mailOptions.cc = cc;
            }
            if (cco) {
                mailOptions.bcc = cco;
            }
            if (inReplyTo) {
                mailOptions.inReplyTo = inReplyTo;
            }
            if (references) {
                mailOptions.references = references;
            }

            const htmlCopiaImap = await construirHtmlCorreoCopiaImap(htmlMensaje, correoPerfil);
            const mailOptionsCopia = {
                ...mailOptions,
                html: htmlCopiaImap,
                // En la copia IMAP guardamos lo mismo que se envió (inline + enlaces en cuerpo).
                attachments: attachmentsInline.length ? attachmentsInline : undefined
            };

            const usarBrevoParaEnvio = esEnvioCorreoViaBrevo();
            const intentos = [];
            let resultadoEnvio = null;
            let origenEnvio = null;

            const payloadEnvio = {
                destinatario,
                cc,
                cco,
                asunto,
                html,
                text,
                correoPerfil,
                adjuntosCorreo,
                inReplyTo: inReplyTo || undefined,
                references: references || undefined
            };

            // Preferir el relay global (Brevo u otro SMTP configurado).
            // Los archivos que superen el límite seguro van como enlace de descarga directa.
            if (emailService.isEnabled()) {
                resultadoEnvio = await enviarViaSmtpGlobal(payloadEnvio);
                intentos.push({ origen: usarBrevoParaEnvio ? 'brevo' : 'sistema', ...resultadoEnvio });
                if (resultadoEnvio.success) {
                    origenEnvio = usarBrevoParaEnvio ? 'brevo' : 'sistema';
                }
            }

            if (!resultadoEnvio?.success) {
                const resultadoPerfil = await enviarViaSmtpPerfil({
                    ...payloadEnvio,
                    nombrePerfil
                });
                intentos.push({ origen: 'perfil', ...resultadoPerfil });

                if (resultadoPerfil.success) {
                    resultadoEnvio = resultadoPerfil;
                    origenEnvio = 'perfil';
                } else if (!resultadoEnvio) {
                    resultadoEnvio = resultadoPerfil;
                }
            }

            if (!resultadoEnvio?.success) {
                if (!emailService.isEnabled() && intentos.every((item) => item.error === 'Configuracion SMTP del perfil incompleta')) {
                    return res.status(503).json({
                        success: false,
                        message: 'No hay un servicio SMTP disponible para enviar correos'
                    });
                }

                const errorTamano = intentos.find((item) => esErrorTamanoCorreo(item.error));
                const errorFinal = errorTamano
                    ? `El correo supera el límite del servidor de correo (~20 MB). Intente de nuevo: los archivos grandes se enviarán automáticamente como enlace de descarga directa.`
                    : (resultadoEnvio?.error || 'No se pudo enviar el correo');
                const ms = Date.now() - inicioEnvio;
                console.error(`[CORREO] ENVIAR ERROR | ${correoPerfil} → ${destinatario} | "${asunto}" | ${errorTamano?.error || errorFinal} | ${ms}ms`);
                return res.status(502).json({
                    success: false,
                    message: errorFinal
                });
            }

            const ms = Date.now() - inicioEnvio;
            const infoEnlaces = enlacesDescarga.length
                ? ` | downloadLinks=${enlacesDescarga.length}`
                : '';
            console.log(`[CORREO] ENVIAR OK | ${correoPerfil} → ${destinatario} | "${asunto}" | ${origenEnvio || 'sistema'}${infoEnlaces} | ${ms}ms`);

            const fechaExpiracionTexto = paqueteDescarga?.fechaExpiracionTexto
                || (paqueteDescarga?.expiresAt
                    ? correoAdjuntosService.formatearFechaLargaEs(paqueteDescarga.expiresAt)
                    : null);

            const respuestaOk = {
                success: true,
                message: enlacesDescarga.length
                    ? `Correo enviado correctamente. ${enlacesDescarga.length} archivo(s) grande(s) se enviaron como enlace de descarga directa${fechaExpiracionTexto ? ` (hasta el ${fechaExpiracionTexto})` : ''}.`
                    : 'Correo enviado correctamente',
                enviadoDesde: correoPerfil,
                origen: origenEnvio || 'sistema',
                messageId: resultadoEnvio.messageId || null,
                adjuntosViaDescarga: enlacesDescarga.map((item) => ({
                    nombre: item.nombre,
                    url: item.url,
                    tamanoBytes: item.tamanoBytes,
                    expiresAt: item.expiresAt || paqueteDescarga?.expiresAt || null,
                    fechaExpiracionTexto: item.fechaExpiracionTexto || fechaExpiracionTexto
                })),
                adjuntosTtlDias: correoAdjuntosService.TTL_DIAS,
                adjuntosExpiresAt: paqueteDescarga?.expiresAt || null,
                adjuntosFechaExpiracionTexto: fechaExpiracionTexto,
                adjuntosUrlPaquete: paqueteDescarga?.url || null,
                adjuntosUrlZip: paqueteDescarga?.urlZip || null,
                adjuntosUrlLocal: correoAdjuntosService.esUrlPublicaLocal(),
                adjuntosPublicBaseUrl: correoAdjuntosService.PUBLIC_BASE_URL,
                // Compatibilidad con clientes que aún lean la clave anterior.
                adjuntosViaDrive: enlacesDescarga.map((item) => ({
                    nombre: item.nombre,
                    url: item.url,
                    tamanoBytes: item.tamanoBytes
                }))
            };

            if (origenEnvio === 'perfil') {
                const copiaEnviados = await intentarGuardarCopiaEnviados(contexto, mailOptionsCopia);
                return res.json({
                    ...respuestaOk,
                    origen: origenEnvio,
                    copiaEnviados: copiaEnviados.guardado === true
                });
            }

            // El correo ya salio; guardar la copia en Enviados (IMAP) sin bloquear la respuesta.
            intentarGuardarCopiaEnviados(contexto, mailOptionsCopia)
                .then((copia) => {
                    if (!copia?.guardado) {
                        console.warn(`[CORREO] Copia en Enviados no guardada (${correoPerfil}): ${copia?.motivo || copia?.error || 'desconocido'}`);
                    }
                })
                .catch((err) => {
                    console.warn(`[CORREO] Error guardando copia en Enviados (${correoPerfil}):`, err?.message || err);
                });

            return res.json({
                ...respuestaOk,
                copiaEnviados: true
            });
        } catch (error) {
            const message = String(error?.message || '');
            const ms = Date.now() - inicioEnvio;
            console.error(`[CORREO] ENVIAR ERROR | ${correoPerfilLog || '?'} → ${destinatarioLog || '?'} | ${message} | ${ms}ms`);
            return res.status(500).json({
                success: false,
                message: 'No se pudo enviar el correo',
                error: message
            });
        }
    });

    return router;
};
