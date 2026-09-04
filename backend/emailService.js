// =====================================================
// BIZNAGA R&T - Email Service
// Módulo para envío de correos electrónicos con nodemailer
// =====================================================

require('dotenv').config({ debug: false, quiet: true });
const nodemailer = require('nodemailer');
const startupLog = require('./startupLog');

// =====================================================
// CONFIGURACIÓN DEL TRANSPORTE SMTP
// =====================================================

let transporter = null;
let emailEnabled = false;
let emailReadyPromise = null;

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE_RAW = process.env.SMTP_SECURE;
const SMTP_SECURE = SMTP_SECURE_RAW !== undefined
    ? String(SMTP_SECURE_RAW).toLowerCase() === 'true'
    : SMTP_PORT === 465;
const SMTP_REQUIRE_TLS = String(process.env.SMTP_REQUIRE_TLS || 'false').toLowerCase() === 'true';
const SMTP_TLS_REJECT_UNAUTHORIZED = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT || 15000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT || 15000);
const SMTP_VERIFY_TIMEOUT = Number(process.env.SMTP_VERIFY_TIMEOUT || 15000);
const SMTP_DEBUG = String(process.env.SMTP_DEBUG || 'false').toLowerCase() === 'true';
const SMTP_AUTO_VERIFY = String(process.env.SMTP_AUTO_VERIFY || 'false').toLowerCase() === 'true';
const SMTP_RECREATE_ON_TRANSIENT = String(process.env.SMTP_RECREATE_ON_TRANSIENT || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Biznaga Risk&Tech';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || SMTP_USER;
const EMAIL_DEBUG_BCC = process.env.EMAIL_DEBUG_BCC || '';
const parseNumber = (value, fallback, min = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};
const SMTP_RETRY_ATTEMPTS = Number(process.env.SMTP_RETRY_ATTEMPTS || 2);
const SMTP_RETRY_BASE_DELAY_MS = Number(process.env.SMTP_RETRY_BASE_DELAY_MS || 1200);
const SMTP_RETRY_MAX_DELAY_MS = Number(process.env.SMTP_RETRY_MAX_DELAY_MS || 8000);
const SMTP_RETRY_421_DELAY_MS = parseNumber(process.env.SMTP_RETRY_421_DELAY_MS, 30000, 1);
const SMTP_QUEUE_ENABLED = String(process.env.SMTP_QUEUE_ENABLED || 'true').toLowerCase() === 'true';
const SMTP_QUEUE_DELAY_MS = parseNumber(process.env.SMTP_QUEUE_DELAY_MS, 1500);
const SMTP_POOL_ENABLED = String(process.env.SMTP_POOL_ENABLED || 'true').toLowerCase() === 'true';
const SMTP_MAX_CONNECTIONS = parseNumber(process.env.SMTP_MAX_CONNECTIONS, 1, 1);
const SMTP_MAX_MESSAGES = parseNumber(process.env.SMTP_MAX_MESSAGES, 50, 1);

let activeTransportMeta = {
    secure: SMTP_SECURE,
    requireTLS: false,
    pool: SMTP_POOL_ENABLED,
    maxConnections: SMTP_MAX_CONNECTIONS
};

let sendQueue = Promise.resolve();
let smtpCooldownUntil = 0;
let smtpCooldownPromise = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function iniciarCooldownSmtp(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return null;
    }

    const objetivo = Date.now() + ms;
    if (objetivo <= smtpCooldownUntil && smtpCooldownPromise) {
        return smtpCooldownPromise;
    }

    smtpCooldownUntil = objetivo;
    if (!smtpCooldownPromise) {
        smtpCooldownPromise = (async () => {
            while (true) {
                const espera = smtpCooldownUntil - Date.now();
                if (espera <= 0) break;
                await sleep(espera);
            }
        })().finally(() => {
            if (Date.now() >= smtpCooldownUntil) {
                smtpCooldownPromise = null;
            }
        });
    }

    return smtpCooldownPromise;
}

async function esperarCooldownSmtp() {
    if (smtpCooldownPromise) {
        await smtpCooldownPromise;
    }
}

function enqueueSend(task) {
    const runQueuedTask = async () => {
        await esperarCooldownSmtp();
        try {
            return await task();
        } finally {
            if (SMTP_QUEUE_DELAY_MS > 0) {
                await sleep(SMTP_QUEUE_DELAY_MS);
            }
        }
    };

    if (!SMTP_QUEUE_ENABLED) {
        return runQueuedTask();
    }

    const run = sendQueue.then(runQueuedTask, runQueuedTask);
    sendQueue = run.catch(() => undefined);
    return run;
}

function esLimiteConexionesSmtp(error) {
    const responseCode = Number(error?.responseCode || error?.statusCode || 0);
    const msg = String(error?.message || error?.response || '').toLowerCase();

    return responseCode === 421 ||
        msg.includes('421') ||
        msg.includes('too many concurrent smtp connections') ||
        msg.includes('too many connections');
}

function esErrorTransitorioEmail(error) {
    const code = String(error?.code || '').toUpperCase();
    const msg = String(error?.message || '').toLowerCase();
    return esLimiteConexionesSmtp(error) ||
        [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'EAI_AGAIN',
            'ENOTFOUND',
            'EPIPE',
            'EHOSTUNREACH',
            'ECONNABORTED'
        ].includes(code) ||
        msg.includes('socket hang up') ||
        msg.includes('connection closed') ||
        msg.includes('read econnreset') ||
        msg.includes('timeout');
}

function construirTransportConfig() {
    const config = SMTP_HOST
        ? {
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            pool: SMTP_POOL_ENABLED,
            maxConnections: SMTP_MAX_CONNECTIONS,
            maxMessages: SMTP_MAX_MESSAGES,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            },
            tls: {
                rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED
            },
            connectionTimeout: SMTP_CONNECTION_TIMEOUT,
            greetingTimeout: SMTP_GREETING_TIMEOUT,
            socketTimeout: SMTP_SOCKET_TIMEOUT,
            logger: SMTP_DEBUG,
            debug: SMTP_DEBUG
        }
        : {
            // Compatibilidad con configuraciones antiguas basadas en Gmail.
            service: 'gmail',
            pool: SMTP_POOL_ENABLED,
            maxConnections: SMTP_MAX_CONNECTIONS,
            maxMessages: SMTP_MAX_MESSAGES,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            },
            connectionTimeout: SMTP_CONNECTION_TIMEOUT,
            greetingTimeout: SMTP_GREETING_TIMEOUT,
            socketTimeout: SMTP_SOCKET_TIMEOUT,
            logger: SMTP_DEBUG,
            debug: SMTP_DEBUG
        };

    if (SMTP_HOST && !SMTP_SECURE && SMTP_REQUIRE_TLS) {
        config.requireTLS = true;
    }

    return {
        config,
        meta: {
            host: SMTP_HOST || 'gmail',
            port: SMTP_HOST ? SMTP_PORT : null,
            secure: SMTP_SECURE,
            requireTLS: Boolean(config.requireTLS),
            pool: Boolean(config.pool),
            maxConnections: config.maxConnections || 1
        }
    };
}

function setTransporter(transportConfig) {
    transporter = nodemailer.createTransport(transportConfig.config);
    activeTransportMeta = transportConfig.meta;
    return transporter;
}

function recrearTransporter() {
    try {
        if (transporter && typeof transporter.close === 'function') {
            transporter.close();
        }
    } catch (_) {
        // Ignorar fallos al cerrar el transporter anterior.
    }

    setTransporter(construirTransportConfig());
}

function cerrarTransporter() {
    try {
        if (transporter && typeof transporter.close === 'function') {
            transporter.close();
        }
    } catch (_) {
        // Ignorar fallos al cerrar el transporter.
    } finally {
        transporter = null;
    }
}

function describirTransportMeta(meta = activeTransportMeta) {
    if (!SMTP_HOST) return 'gmail';
    const modo = meta.secure ? 'SSL' : (meta.requireTLS ? 'STARTTLS' : 'sin SSL');
    const pool = meta.pool ? `, pool ${meta.maxConnections || 1} conexion(es)` : '';
    return `${SMTP_HOST}:${meta.port || SMTP_PORT} (${modo}${pool})`;
}

function verificarTransporter() {
    return Promise.race([
        transporter.verify(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Verification timeout')), SMTP_VERIFY_TIMEOUT))
    ]);
}

if (SMTP_USER && SMTP_PASS) {
    const transportConfig = construirTransportConfig();

    if (SMTP_DEBUG) {
        console.log('  ℹ️  SMTP transport configuration:', {
            host: SMTP_HOST || 'gmail',
            port: SMTP_PORT,
            secure: transportConfig.meta.secure,
            requireTLS: transportConfig.meta.requireTLS,
            pool: transportConfig.meta.pool,
            maxConnections: transportConfig.meta.maxConnections,
            maxMessages: SMTP_MAX_MESSAGES,
            queueDelayMs: SMTP_QUEUE_DELAY_MS,
            tlsRejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED,
            debug: SMTP_DEBUG
        });
    }

    setTransporter(transportConfig);
    emailEnabled = true;
    startupLog.serviceOk('Correo', describirTransportMeta());

    // Evita saturar SMTP en deploys/restarts. Si se habilita, no desactiva el servicio.
    if (SMTP_AUTO_VERIFY) {
        emailReadyPromise = (async () => {
            try {
                await verificarTransporter();
                console.log(`  ✅ SMTP verificado correctamente: ${describirTransportMeta()}`);
                return true;
            } catch (err) {
                console.warn('  ⚠️  SMTP no verificado al arranque, se intentará enviar bajo demanda: ' + err.message);
                return false;
            }
        })();
    } else {
        emailReadyPromise = Promise.resolve(true);
    }
} else {
    startupLog.serviceFail('Correo', 'faltan SMTP_USER y/o SMTP_PASS');
    emailReadyPromise = Promise.resolve(false);
}

// =====================================================
// FUNCIONES DE ENVÍO
// =====================================================

/**
 * Envía un correo electrónico genérico
 * @param {Object} options - { to, subject, html, text, attachments }
 * @returns {Promise<{success: boolean, messageId?: string, error?: string, accepted?: string[], rejected?: string[], pending?: string[], response?: string}>}
 */
async function enviarCorreo({ to, subject, html, text, attachments, replyTo, from, cc, bcc, inReplyTo, references, quiet = false }) {
    if (emailReadyPromise) {
        try {
            await emailReadyPromise;
        } catch (_) {
            // Si falla la verificación, lo manejamos con emailEnabled abajo.
        }
    }

    if (!emailEnabled || !transporter) {
        console.warn('[EMAIL] Intento de envío pero el servicio está deshabilitado');
        return { success: false, error: 'Servicio de email no configurado' };
    }

    const htmlProcesado = typeof html === 'string'
        ? html.replace(/#f0f4ec/gi, '#d7d9da')
        : html;

    const mailOptions = {
        from: from || `"${EMAIL_FROM_NAME}" <${EMAIL_FROM_ADDRESS}>`,
        to,
        cc: cc || undefined,
        subject,
        html: htmlProcesado,
        text,
        replyTo: replyTo || undefined,
        bcc: bcc || EMAIL_DEBUG_BCC || undefined,
        attachments: Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined
    };

    const procesarInfo = (info) => {
        const accepted = Array.isArray(info.accepted) ? info.accepted : [];
        const rejected = Array.isArray(info.rejected) ? info.rejected : [];
        const pending = Array.isArray(info.pending) ? info.pending : [];
        const smtpResponse = typeof info.response === 'string' ? info.response : '';

        const acceptedCount = accepted.length;
        const rejectedCount = rejected.length;
        const pendingCount = pending.length;

        if (acceptedCount === 0 && (rejectedCount > 0 || pendingCount > 0)) {
            if (!quiet) {
                console.error(`[EMAIL] SMTP no aceptó destinatarios para ${to}. Rechazados: ${rejected.join(', ') || 'N/A'}${pendingCount > 0 ? ` | Pendientes: ${pending.join(', ')}` : ''}`);
                if (smtpResponse) {
                    console.error(`[EMAIL] Respuesta SMTP (${to}): ${smtpResponse}`);
                }
            }

            return {
                success: false,
                error: 'Servidor SMTP no aceptó destinatarios',
                messageId: info.messageId,
                accepted,
                rejected,
                pending,
                response: smtpResponse
            };
        }

        if (!quiet) {
            console.log(`[EMAIL] Correo enviado a ${to} - ID: ${info.messageId} | accepted=${acceptedCount} rejected=${rejectedCount}${pendingCount > 0 ? ` pending=${pendingCount}` : ''}`);
            if (smtpResponse) {
                console.log(`[EMAIL] Respuesta SMTP (${to}): ${smtpResponse}`);
            }
        }

        return {
            success: true,
            messageId: info.messageId,
            accepted,
            rejected,
            pending,
            response: smtpResponse
        };
    };

    const enviarConReintentos = async () => {
        const maxIntentos = Math.max(1, SMTP_RETRY_ATTEMPTS + 1);

        for (let intento = 1; intento <= maxIntentos; intento++) {
            try {
                const info = await transporter.sendMail(mailOptions);
                return procesarInfo(info);
            } catch (error) {
                const errorMessage = String(error?.message || 'Error desconocido');
                const esLimiteConexiones = esLimiteConexionesSmtp(error);

                if (intento < maxIntentos && esErrorTransitorioEmail(error)) {
                    const delayBase = Math.min(SMTP_RETRY_BASE_DELAY_MS * Math.pow(2, intento - 1), SMTP_RETRY_MAX_DELAY_MS);
                    const delay = esLimiteConexiones
                        ? Math.max(delayBase, SMTP_RETRY_421_DELAY_MS)
                        : delayBase;
                    console.warn(`[EMAIL] Error transitorio enviando correo a ${to}: ${errorMessage}. Reintentando en ${delay}ms...`);

                    try {
                        if (!esLimiteConexiones && SMTP_RECREATE_ON_TRANSIENT) {
                            recrearTransporter();
                        }
                    } catch (_) {
                        // Ignorar fallos al re-crear el transporter
                    }

                    if (esLimiteConexiones) {
                        iniciarCooldownSmtp(delay);
                        await esperarCooldownSmtp();
                    } else {
                        await sleep(delay);
                    }
                    continue;
                }

                if (esLimiteConexiones && SMTP_RETRY_421_DELAY_MS > 0) {
                    console.warn(`[EMAIL] SMTP limitó conexiones para ${to}. Enfriando cola ${SMTP_RETRY_421_DELAY_MS}ms antes del siguiente correo...`);
                    iniciarCooldownSmtp(SMTP_RETRY_421_DELAY_MS);
                    await esperarCooldownSmtp();
                }

                console.error(`[EMAIL] Error enviando correo a ${to}:`, errorMessage);
                return { success: false, error: errorMessage };
            }
        }

        return { success: false, error: 'No se pudo enviar el correo' };
    };

    return enqueueSend(enviarConReintentos);
}

// =====================================================
// PLANTILLA HTML BASE
// =====================================================

function plantillaBase({ titulo, contenido }) {
    return `
    <div style="font-family: 'Century Gothic', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f8f6;">
        <!-- Header -->
        <div style="background-color: #38512F; padding: 24px 32px; text-align: center;">
            <h1 style="color: #C2D1B2; margin: 0; font-size: 22px;">Biznaga Risk&Tech</h1>
            <p style="color: #E2E3DE; margin: 4px 0 0; font-size: 12px;">Sistema de Capacitaciones</p>
        </div>

        <!-- Body -->
        <div style="padding: 32px; background-color: #ffffff;">
            <h2 style="color: #38512F; margin-top: 0;">${titulo}</h2>
            ${contenido}
        </div>

        <!-- Footer -->
        <div style="background-color: #E2E3DE; padding: 16px 32px; text-align: center;">
            <p style="color: #768D6B; margin: 0; font-size: 12px;">
                Este correo fue enviado automáticamente por el sistema Biznaga Risk&Tech.<br>
                No responder a este correo.
            </p>
        </div>
    </div>
    `;
}

const PC_COLOR_PRIMARIO = '#d97248';
const PC_COLOR_HEADER = '#f5e0d0';
const PC_COLOR_HEADER_TITULO = '#b85a32';
const PC_COLOR_FONDO_SUAVE = '#fdf0ea';
const URL_PLATAFORMA = 'https://sistema.biznaga.com.mx';

function plantillaBaseProteccionCivil({ titulo, contenido }) {
    return `
    <div style="font-family: 'Century Gothic', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f8f6;">
        <!-- Header -->
        <div style="background-color: ${PC_COLOR_HEADER}; padding: 24px 32px; text-align: center;">
            <h1 style="color: ${PC_COLOR_HEADER_TITULO}; margin: 0; font-size: 22px;">Biznaga Risk&Tech</h1>
            <p style="color: ${PC_COLOR_PRIMARIO}; margin: 4px 0 0; font-size: 12px;">Protección Civil</p>
        </div>

        <!-- Body -->
        <div style="padding: 32px; background-color: #ffffff;">
            <h2 style="color: ${PC_COLOR_PRIMARIO}; margin-top: 0;">${titulo}</h2>
            ${contenido}
        </div>

        <!-- Footer -->
        <div style="background-color: #E2E3DE; padding: 16px 32px; text-align: center;">
            <p style="color: ${PC_COLOR_PRIMARIO}; margin: 0; font-size: 12px;">
                Este correo fue enviado automáticamente por el módulo de Protección Civil de Biznaga Risk&Tech.<br>
                No responder a este correo.
            </p>
        </div>
    </div>
    `;
}

function botonPlataformaProteccionCivil(texto = 'Ir a la plataforma', ruta = '') {
    const rutaNormalizada = String(ruta || '').trim();
    const href = rutaNormalizada
        ? `${URL_PLATAFORMA}${rutaNormalizada.startsWith('/') ? '' : '/'}${rutaNormalizada}`
        : URL_PLATAFORMA;

    return `
        <div style="text-align: center; margin: 24px 0;">
            <a href="${href}"
               style="background-color: ${PC_COLOR_PRIMARIO}; color: #ffffff; padding: 14px 28px; border-radius: 8px;
                      text-decoration: none; font-size: 15px; font-weight: 600; display: inline-block;
                      letter-spacing: 0.3px;">
                ${texto}
            </a>
        </div>
    `;
}

function botonPlataforma(texto = 'Ir a la plataforma', ruta = '') {
    const rutaNormalizada = String(ruta || '').trim();
    const href = rutaNormalizada
        ? `${URL_PLATAFORMA}${rutaNormalizada.startsWith('/') ? '' : '/'}${rutaNormalizada}`
        : URL_PLATAFORMA;

    return `
        <div style="text-align: center; margin: 24px 0;">
            <a href="${href}"
               style="background-color: #38512F; color: #ffffff; padding: 14px 28px; border-radius: 8px;
                      text-decoration: none; font-size: 15px; font-weight: 600; display: inline-block;
                      letter-spacing: 0.3px;">
                ${texto}
            </a>
        </div>
    `;
}

function tablaParticipantes(empleados) {
    if (!empleados || empleados.length === 0) return '';

    const filas = empleados.map((emp, i) => `
        <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E3DE;">${i + 1}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E3DE;">${emp.nombre || 'Sin nombre'}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E2E3DE;">${emp.curp || 'Sin CURP'}</td>
        </tr>
    `).join('');

    return `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <thead>
                <tr style="background-color: #38512F; color: #fff;">
                    <th style="padding: 10px 12px; text-align: left;">#</th>
                    <th style="padding: 10px 12px; text-align: left;">Nombre</th>
                    <th style="padding: 10px 12px; text-align: left;">CURP</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function bloqueResumen(cantidadRegistrados, cantidadYaInscritos, totalInscritos) {
    return `
        <div style="background-color: #f0f4ec; border-left: 4px solid #768D6B; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 4px 0; color: #1A1A1A;"><strong>Nuevos inscritos:</strong> ${cantidadRegistrados}</p>
            ${cantidadYaInscritos > 0 ? `<p style="margin: 4px 0; color: #A8A9A2;"><strong>Ya inscritos previamente:</strong> ${cantidadYaInscritos}</p>` : ''}
            <p style="margin: 4px 0; color: #1A1A1A;"><strong>Total participantes en el curso:</strong> ${totalInscritos}</p>
        </div>
    `;
}

function normalizarFechaSinDesfase(fecha) {
    if (!fecha) return null;

    if (fecha instanceof Date) {
        return Number.isNaN(fecha.getTime()) ? null : fecha;
    }

    const valor = String(fecha).trim();
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);

    // Evita desfase por zona horaria al parsear fechas tipo YYYY-MM-DD.
    if (soloFecha) {
        const year = Number(soloFecha[1]);
        const month = Number(soloFecha[2]);
        const day = Number(soloFecha[3]);
        return new Date(year, month - 1, day, 12, 0, 0, 0);
    }

    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatearFechaLargaMx(fecha, incluirDiaSemana = true, fallback = 'Por definir') {
    const d = normalizarFechaSinDesfase(fecha);
    if (!d) return fallback;

    const opciones = {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    if (incluirDiaSemana) {
        opciones.weekday = 'long';
    }

    return d.toLocaleDateString('es-MX', opciones);
}

// =====================================================
// NOTIFICACIÓN AL INSTRUCTOR
// =====================================================

/**
 * Notifica al instructor que una empresa registró participantes en su curso
 */
async function notificarInstructorRegistroParticipantes(datos) {
    const {
        instructorEmail, instructorNombre,
        nombreCurso, nombreEmpresa,
        cantidadRegistrados, cantidadYaInscritos, totalInscritos,
        empleadosRegistrados
    } = datos;

    if (!instructorEmail) {
        console.warn('[EMAIL] No se pudo notificar al instructor: email no disponible');
        return { success: false, error: 'Email del instructor no disponible' };
    }

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Hola <strong>${instructorNombre || 'Instructor'}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            La empresa <strong style="color: #38512F;">${nombreEmpresa}</strong> ha registrado participantes 
            en tu curso <strong style="color: #38512F;">${nombreCurso}</strong>.
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Ya puedes iniciar tu capacitación, ya que la empresa completó el registro de participantes.
        </p>
        ${bloqueResumen(cantidadRegistrados, cantidadYaInscritos, totalInscritos)}
        ${tablaParticipantes(empleadosRegistrados)}
        ${botonPlataforma('Ver detalles del curso')}
        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            Puedes revisar los participantes y el avance del curso desde la plataforma.
        </p>
    `;

    const html = plantillaBase({ titulo: 'Nuevos participantes registrados', contenido });
    const text = `Hola ${instructorNombre || 'Instructor'},\n\nLa empresa ${nombreEmpresa} ha registrado ${cantidadRegistrados} participante(s) en tu curso "${nombreCurso}".\nYa puedes iniciar tu capacitación porque la empresa completó su registro.\nTotal de participantes en el curso: ${totalInscritos}\n\n— Biznaga Risk&Tech`;

    return enviarCorreo({
        to: instructorEmail,
        subject: `Nuevos participantes registrados - ${nombreCurso}`,
        html,
        text
    });
}

// =====================================================
// NOTIFICACIÓN A LA EMPRESA
// =====================================================

/**
 * Notifica a la empresa que sus participantes fueron registrados exitosamente
 */
async function notificarEmpresaRegistroParticipantes(datos) {
    const {
        empresaEmail, empresaNombre,
        nombreCurso, instructorNombre,
        cantidadRegistrados, cantidadYaInscritos, totalInscritos,
        empleadosRegistrados
    } = datos;

    if (!empresaEmail) {
        console.warn('[EMAIL] No se pudo notificar a la empresa: email no disponible');
        return { success: false, error: 'Email de la empresa no disponible' };
    }

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Estimado equipo de <strong style="color: #38512F;">${empresaNombre}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se confirma el registro de participantes en el curso 
            <strong style="color: #38512F;">${nombreCurso}</strong>
            ${instructorNombre ? ` impartido por <strong>${instructorNombre}</strong>` : ''}.
        </p>
        ${bloqueResumen(cantidadRegistrados, cantidadYaInscritos, totalInscritos)}
        ${tablaParticipantes(empleadosRegistrados)}
        ${botonPlataforma('Ir al curso')}
        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            Si necesitas hacer cambios en los participantes, accede a la plataforma antes del inicio del curso.
        </p>
    `;

    const html = plantillaBase({ titulo: 'Confirmación de registro de participantes', contenido });
    const text = `Estimado equipo de ${empresaNombre},\n\nSe confirma el registro de ${cantidadRegistrados} participante(s) en el curso "${nombreCurso}".\nTotal de participantes: ${totalInscritos}\n\n— Biznaga Risk&Tech`;

    return enviarCorreo({
        to: empresaEmail,
        subject: `Registro confirmado - ${nombreCurso}`,
        html,
        text
    });
}

// =====================================================
// NOTIFICACIÓN A EMPRESA: CURSO ASIGNADO
// =====================================================

/**
 * Notifica a la empresa que se le asignó un curso y puede registrar a sus empleados
 */
async function notificarEmpresaCursoAsignado(datos) {
    const {
        empresaEmail, empresaNombre,
        nombreCurso, instructorNombre,
        fechaInicio, fechaFin,
        horaInicio, horaFin,
        modalidad, ubicacion, cupo
    } = datos;

    if (!empresaEmail) {
        console.warn('[EMAIL] No se pudo notificar a la empresa: email no disponible');
        return { success: false, error: 'Email de la empresa no disponible' };
    }

    const formatFecha = (f) => formatearFechaLargaMx(f, true, 'Por definir');

    const detallesCurso = `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 40%;">Fecha inicio</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatFecha(fechaInicio)}</td>
            </tr>
            ${fechaFin ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha fin</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatFecha(fechaFin)}</td>
            </tr>` : ''}
            ${horaInicio ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Horario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${horaInicio}${horaFin ? ' \u2014 ' + horaFin : ''}</td>
            </tr>` : ''}
            ${modalidad ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Modalidad</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${modalidad}</td>
            </tr>` : ''}
            ${ubicacion ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Ubicaci\u00f3n</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${ubicacion}</td>
            </tr>` : ''}
            ${instructorNombre ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Instructor</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${instructorNombre}</td>
            </tr>` : ''}
            ${cupo ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Cupo m\u00e1ximo</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${cupo} participantes</td>
            </tr>` : ''}
        </table>
    `;

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Estimado equipo de <strong style="color: #38512F;">${empresaNombre}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se les ha asignado el curso <strong style="color: #38512F;">${nombreCurso}</strong>.
            Ya pueden dar de alta a los empleados que participarán.
        </p>

        <h3 style="color: #38512F; margin-bottom: 8px;">Detalles del curso</h3>
        ${detallesCurso}

        ${botonPlataforma('Registrar participantes')}
        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            Recuerda registrar a los participantes antes de la fecha de inicio del curso.
        </p>
    `;

    const html = plantillaBase({ titulo: 'Nuevo curso asignado', contenido });
    const text = `Estimado equipo de ${empresaNombre},\n\nSe les ha asignado el curso "${nombreCurso}".\nFecha de inicio: ${formatFecha(fechaInicio)}\n${instructorNombre ? 'Instructor: ' + instructorNombre + '\n' : ''}\nIngresa a la plataforma para registrar a tus participantes.\n\n— Biznaga Risk&Tech`;

    return enviarCorreo({
        to: empresaEmail,
        subject: `Nuevo curso asignado - ${nombreCurso}`,
        html,
        text
    });
}

// =====================================================
// NOTIFICACIÓN A INSTRUCTOR: CURSO ASIGNADO
// =====================================================

/**
 * Notifica al instructor que se le asignó un nuevo curso
 */
async function notificarInstructorCursoAsignado(datos) {
    const {
        instructorEmail, instructorNombre,
        nombreCurso, empresaNombre,
        fechaInicio, fechaFin,
        horaInicio, horaFin,
        modalidad, ubicacion, cupo
    } = datos;

    if (!instructorEmail) {
        console.warn('[EMAIL] No se pudo notificar al instructor: email no disponible');
        return { success: false, error: 'Email del instructor no disponible' };
    }

    const formatFecha = (f) => formatearFechaLargaMx(f, true, 'Por definir');

    const detallesCurso = `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 40%;">Fecha inicio</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatFecha(fechaInicio)}</td>
            </tr>
            ${fechaFin ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha fin</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatFecha(fechaFin)}</td>
            </tr>` : ''}
            ${horaInicio ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Horario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${horaInicio}${horaFin ? ' \u2014 ' + horaFin : ''}</td>
            </tr>` : ''}
            ${modalidad ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Modalidad</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${modalidad}</td>
            </tr>` : ''}
            ${ubicacion ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Ubicaci\u00f3n</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${ubicacion}</td>
            </tr>` : ''}
            ${empresaNombre ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Empresa</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${empresaNombre}</td>
            </tr>` : ''}
            ${cupo ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Cupo m\u00e1ximo</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${cupo} participantes</td>
            </tr>` : ''}
        </table>
    `;

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Hola <strong>${instructorNombre || 'Instructor'}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se te ha asignado el curso <strong style="color: #38512F;">${nombreCurso}</strong> 
            con la empresa <strong style="color: #38512F;">${empresaNombre}</strong>.
        </p>

        <h3 style="color: #38512F; margin-bottom: 8px;">Detalles del curso</h3>
        ${detallesCurso}

        ${botonPlataforma('Ver detalles del curso')}
        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            La empresa registrará a sus participantes en la plataforma. Recibirás una notificación cuando se confirme el registro.
        </p>
    `;

    const html = plantillaBase({ titulo: 'Nuevo curso asignado', contenido });
    const text = `Hola ${instructorNombre || 'Instructor'},\n\nSe te ha asignado el curso "${nombreCurso}" con la empresa ${empresaNombre}.\nFecha de inicio: ${formatFecha(fechaInicio)}\n${modalidad ? 'Modalidad: ' + modalidad + '\n' : ''}\nAccede a la plataforma para revisar los detalles.\n\n— Biznaga Risk&Tech`;

    return enviarCorreo({
        to: instructorEmail,
        subject: `Nuevo curso asignado - ${nombreCurso}`,
        html,
        text
    });
}

// =====================================================
// INVITACION DE CURSO (sin emojis)
// =====================================================

/**
 * Envia invitacion de curso por correo electronico
 * Se envia al instructor, a la empresa y a correos adicionales
 * @param {Object} datos - Datos del curso e invitacion
 * @returns {Promise<{success: boolean, resultados: Object}>}
 */
async function enviarInvitacionCurso(datos) {
    const {
        destinatarios, // Array de emails
        tipoDestinatario = 'general',
        nombreCurso, empresaNombre, instructorNombre,
        fechaInicio, fechaFin,
        horaInicio, horaFin,
        modalidad, ubicacion, estado, ciudad, cupo, notas, adjuntos
    } = datos;

    if (!destinatarios || destinatarios.length === 0) {
        return { success: false, error: 'No hay destinatarios para la invitacion' };
    }

    const formatFecha = (f) => formatearFechaLargaMx(f, true, 'Por definir');
    const esCorreoEmpresa = String(tipoDestinatario || '').trim().toLowerCase() === 'empresa';
    const tieneAdjuntos = Array.isArray(adjuntos) && adjuntos.length > 0;

    const detallesCursoGeneral = `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 40%;">Curso</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${nombreCurso}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Empresa</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${empresaNombre}</td>
            </tr>
            ${instructorNombre ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Instructor</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${instructorNombre}</td>
            </tr>` : ''}
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatFecha(fechaInicio)}${fechaFin && fechaFin !== fechaInicio ? ' al ' + formatFecha(fechaFin) : ''}</td>
            </tr>
            ${horaInicio ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Horario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${horaInicio}${horaFin ? ' - ' + horaFin : ''}</td>
            </tr>` : ''}
            ${modalidad ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Modalidad</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${modalidad.charAt(0).toUpperCase() + modalidad.slice(1)}</td>
            </tr>` : ''}
            ${ubicacion ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Ubicacion</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${ubicacion}</td>
            </tr>` : ''}
            ${estado || ciudad ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Localidad</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${[ciudad, estado].filter(Boolean).join(', ')}</td>
            </tr>` : ''}
            ${cupo ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Cupo maximo</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${cupo} participantes</td>
            </tr>` : ''}
        </table>
    `;

    const bloqueNotas = notas ? `
        <div style="background-color: #f0f4ec; border-left: 4px solid #768D6B; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; color: #38512F; font-weight: bold; font-size: 13px;">Notas adicionales:</p>
            <p style="margin: 4px 0 0; color: #1A1A1A; font-size: 14px;">${notas}</p>
        </div>
        ` : '';

    const contenidoEmpresa = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.7; margin: 0 0 18px;">
            <strong style="color: #38512F; font-size: 17px;">Por favor ingrese a los empleados.</strong>
        </p>

        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6; margin-bottom: 0;">
            Realice el registro desde el siguiente enlace:
        </p>
        ${botonPlataforma('Ir a la plataforma')}

        <div style="background-color: #fff8ea; border: 1px solid #f4ddb0; border-left: 4px solid #D6A43A; padding: 16px 20px; margin: 18px 0; border-radius: 0 10px 10px 0;">
            <p style="margin: 0; color: #5f4b1f; font-weight: bold; font-size: 14px;">Formato de registro de participantes</p>
            <p style="margin: 6px 0 0; color: #5f4b1f; font-size: 14px; line-height: 1.5;">
                ${tieneAdjuntos
                    ? 'Dentro de este correo se envio un documento en Excel con la plantilla de los datos necesarios para llenar al participante.'
                    : 'El documento en Excel con la plantilla de los datos necesarios para llenar al participante se compartira por este mismo medio.'}
            </p>
        </div>

        ${bloqueNotas}

        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            Este correo es una invitacion informativa. Si requiere apoyo, con gusto le atenderemos.
        </p>
    `;

    const contenidoGeneral = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se le hace llegar la invitacion al curso de capacitacion 
            <strong style="color: #38512F;">${nombreCurso}</strong>.
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            A continuacion se presentan los detalles:
        </p>

        ${detallesCursoGeneral}

        ${bloqueNotas}

        ${botonPlataforma('Ir a la plataforma')}
        <p style="color: #A8A9A2; font-size: 13px; margin-top: 8px;">
            Este correo es una invitación informativa. Si tiene preguntas, por favor comuníquese con nosotros.
        </p>
    `;

    const contenido = esCorreoEmpresa ? contenidoEmpresa : contenidoGeneral;

    const html = plantillaBase({ titulo: `Invitacion al curso: ${nombreCurso}`, contenido });
    const textGeneral = `Invitacion al curso de capacitacion\n\nCurso: ${nombreCurso}\nEmpresa: ${empresaNombre}\n${instructorNombre ? 'Instructor: ' + instructorNombre + '\n' : ''}Fecha: ${formatFecha(fechaInicio)}\n${horaInicio ? 'Horario: ' + horaInicio + (horaFin ? ' - ' + horaFin : '') + '\n' : ''}${modalidad ? 'Modalidad: ' + modalidad + '\n' : ''}${ubicacion ? 'Ubicacion: ' + ubicacion + '\n' : ''}\n-- Biznaga Risk&Tech`;
    const textEmpresa = `Invitacion al curso: ${nombreCurso}\n\nPor favor ingrese a los empleados.\nRealice el registro desde el siguiente enlace: ${URL_PLATAFORMA}\n\n${tieneAdjuntos ? 'Dentro de este correo se envio un documento en Excel con la plantilla de los datos necesarios para llenar al participante.' : 'El documento en Excel con la plantilla de los datos necesarios para llenar al participante se compartira por este mismo medio.'}${notas ? '\n\nNotas: ' + notas : ''}\n\n-- Biznaga Risk&Tech`;
    const text = esCorreoEmpresa ? textEmpresa : textGeneral;

    // Enviar a todos los destinatarios
    const resultados = [];
    for (const email of destinatarios) {
        const resultado = await enviarCorreo({
            to: email,
            subject: `Invitacion al curso: ${nombreCurso} - ${empresaNombre}`,
            html,
            text,
            attachments: Array.isArray(adjuntos) && adjuntos.length > 0 ? adjuntos : undefined
        });
        resultados.push({ email, ...resultado });
    }

    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;

    return {
        success: exitosos > 0,
        exitosos,
        fallidos,
        total: destinatarios.length,
        resultados
    };
}

// =====================================================
// NOTIFICACIÓN: CREDENCIALES DE NUEVO USUARIO
// =====================================================

/**
 * Envía al usuario recién creado sus credenciales de acceso al sistema
 */
async function enviarCredencialesNuevoUsuario(datos) {
    const {
        email,
        nombre,
        apellido,
        username,
        clave,
        rol,
        incluirRol,
        mostrarBoton = true,
        textoBoton = 'Iniciar sesión',
        mensajeBienvenida,
        mostrarMensajeBienvenida,
        tituloCorreo,
        asuntoCorreo,
        adjuntos
    } = datos;

    if (!email) {
        console.warn('[EMAIL] No se pudo enviar credenciales: email no disponible');
        return { success: false, error: 'Email no disponible' };
    }

    const mensajePrincipal = mensajeBienvenida
        ? String(mensajeBienvenida)
        : 'Estas son tus nuevas credenciales para ingresar al sistema.';

    const debeIncluirRol = incluirRol !== undefined ? Boolean(incluirRol) : Boolean(rol);

    const tablaDatos = `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 40%;">Usuario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${username}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Contraseña</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${clave}</td>
            </tr>
            ${debeIncluirRol && rol ? `<tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Rol asignado</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${rol}</td>
            </tr>` : ''}
        </table>
    `;

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            ${mensajePrincipal}
        </p>

        <h3 style="color: #38512F; margin-bottom: 8px;">Credenciales de acceso</h3>
        ${tablaDatos}

        ${mostrarBoton ? botonPlataforma(textoBoton) : ''}
    `;

    const html = plantillaBase({ titulo: tituloCorreo || 'Actualización de Credenciales de Acceso', contenido });
    const text = `${mensajePrincipal}\n\nUsuario: ${username}\nContraseña: ${clave}\n${debeIncluirRol && rol ? 'Rol: ' + rol + '\n' : ''}\n— Biznaga Risk&Tech`;

    return enviarCorreo({
        to: email,
        subject: asuntoCorreo || 'Actualización de Credenciales de Acceso - Biznaga Risk&Tech',
        html,
        text,
        attachments: Array.isArray(adjuntos) ? adjuntos : undefined
    });
}

function formatearRolAcceso(rol) {
    const rolNormalizado = String(rol || '').trim().toLowerCase();
    const mapaRoles = {
        root: 'Super Administrador',
        super_admin: 'Super Administrador',
        administrador: 'Administrador'
    };

    return mapaRoles[rolNormalizado] || rolNormalizado || 'Administrador';
}

async function notificarCambioPasswordAcceso(datos) {
    const {
        email,
        nombre,
        apellido,
        username,
        realizadoPor,
        rolRealizadoPor,
        fechaCambio
    } = datos;

    if (!email) {
        console.warn('[EMAIL] No se pudo notificar cambio de contraseña: email no disponible');
        return { success: false, error: 'Email no disponible' };
    }

    const nombreCompleto = `${nombre || ''} ${apellido || ''}`.trim() || username || 'usuario';
    const fechaTexto = formatearFechaLargaMx(fechaCambio || new Date(), true, 'Reciente');

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Hola <strong>${nombreCompleto}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se registro un <strong style="color: #38512F;">cambio de contraseña</strong> en tu cuenta de acceso.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 45%;">Usuario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${username || 'N/A'}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha de cambio</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${fechaTexto}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Actualizado por</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${realizadoPor || 'Administrador'} (${rolEditor})</td>
            </tr>
        </table>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Si no reconoces este movimiento, comunicate de inmediato con el equipo administrador.
        </p>
        ${botonPlataforma('Ingresar al sistema')}
    `;

    const html = plantillaBase({ titulo: 'Aviso de cambio de contraseña', contenido });
    const text = `Hola ${nombreCompleto},\n\nSe registro un cambio de contraseña en tu cuenta (${username || 'N/A'}).\nFecha: ${fechaTexto}.\nActualizado por: ${realizadoPor || 'Administrador'} (${rolEditor}).\n\nSi no reconoces este movimiento, comunicate de inmediato con el equipo administrador.\n\n${URL_PLATAFORMA}\n\n- Biznaga Risk&Tech`;

    return enviarCorreo({
        to: email,
        subject: 'Aviso de cambio de contraseña - Biznaga Risk&Tech',
        html,
        text
    });
}

async function notificarCambioCorreoAcceso(datos) {
    const {
        emailNuevo,
        emailAnterior,
        nombre,
        apellido,
        username,
        realizadoPor,
        rolRealizadoPor,
        fechaCambio
    } = datos;

    if (!emailNuevo) {
        console.warn('[EMAIL] No se pudo notificar cambio de correo: email nuevo no disponible');
        return { success: false, error: 'Email nuevo no disponible' };
    }

    const nombreCompleto = `${nombre || ''} ${apellido || ''}`.trim() || username || 'usuario';
    const emailAnteriorLimpio = String(emailAnterior || '').trim();
    const emailAnteriorValido = Boolean(emailAnteriorLimpio)
        && emailAnteriorLimpio.toLowerCase() !== String(emailNuevo).trim().toLowerCase();

    if (!emailAnteriorValido) {
        console.warn('[EMAIL] No se pudo notificar cambio de correo: email anterior no disponible');
        return { success: false, error: 'Email anterior no disponible' };
    }

    const contenidoAnterior = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Hola <strong>${nombreCompleto}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Este correo ya no esta asociado a tu cuenta de acceso en nuestro sistema.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 45%;">Usuario</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${username || 'N/A'}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Correo anterior</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${emailAnteriorLimpio}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Nuevo correo</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${emailNuevo}</td>
            </tr>
        </table>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Si no reconoces este movimiento, comunicate de inmediato con el equipo administrador.
        </p>
        ${botonPlataforma('Ingresar al sistema')}
    `;

    const htmlAnterior = plantillaBase({ titulo: 'Cambio de correo', contenido: contenidoAnterior });
    const textAnterior = `Hola ${nombreCompleto},\n\nEste correo ya no esta asociado a tu cuenta de acceso en nuestro sistema.\nUsuario: ${username || 'N/A'}\nCorreo anterior: ${emailAnteriorLimpio}\nNuevo correo: ${emailNuevo}\n\nSi no reconoces este movimiento, comunicate de inmediato con el equipo administrador.\n\n${URL_PLATAFORMA}\n\n- Biznaga Risk&Tech`;

    return enviarCorreo({
        to: emailAnteriorLimpio,
        subject: 'Aviso de cambio de correo - Biznaga Risk&Tech',
        html: htmlAnterior,
        text: textAnterior
    });
}

// =====================================================
// NOTIFICACIONES PROTECCION CIVIL
// =====================================================

function formatearFechaMx(fecha) {
    return formatearFechaLargaMx(fecha, false, 'No disponible');
}

async function notificarEmpresaDocumentosPCAsignados(datos) {
    const {
        empresaEmail,
        empresaNombre,
        fechaAsignacion
    } = datos;

    if (!empresaEmail) {
        console.warn('[EMAIL] No se pudo notificar asignacion PC a empresa: email no disponible');
        return { success: false, error: 'Email de la empresa no disponible' };
    }

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Estimado equipo de <strong style="color: ${PC_COLOR_PRIMARIO};">${empresaNombre || 'su empresa'}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Se asignaron nuevos documentos en el modulo de <strong style="color: ${PC_COLOR_PRIMARIO};">Proteccion Civil</strong>.
        </p>
        <div style="background-color: ${PC_COLOR_FONDO_SUAVE}; border-left: 4px solid ${PC_COLOR_PRIMARIO}; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 4px 0; color: #1A1A1A;"><strong>Fecha de asignacion:</strong> ${formatearFechaMx(fechaAsignacion)}</p>
        </div>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Ingresa al sistema para cargar tu documentacion pendiente.
        </p>
        ${botonPlataformaProteccionCivil('Acceder a Proteccion Civil', '/proteccion-civil')}
    `;

    const html = plantillaBaseProteccionCivil({ titulo: 'Documentos asignados en Proteccion Civil', contenido });
    const text = `Estimado equipo de ${empresaNombre || 'su empresa'},\n\nSe asignaron nuevos documentos en el modulo de Proteccion Civil.\nFecha de asignacion: ${formatearFechaMx(fechaAsignacion)}\nIngresa al sistema para cargar la documentacion pendiente.\n\n${URL_PLATAFORMA}/proteccion-civil\n\n- Biznaga Risk&Tech - Proteccion Civil`;

    return enviarCorreo({
        to: empresaEmail,
        subject: 'Proteccion Civil - Documentos asignados',
        html,
        text
    });
}

async function notificarPerfilAsignadorPCDocumentosCompletados(datos) {
    const {
        perfilEmail,
        perfilNombre,
        perfilRol,
        empresaNombre,
        documentoPadre,
        totalSubdocumentos,
        fechaAsignacion,
        fechaCompletado
    } = datos;

    if (!perfilEmail) {
        console.warn('[EMAIL] No se pudo notificar completado PC al asignador: email no disponible');
        return { success: false, error: 'Email del asignador no disponible' };
    }

    const contenido = `
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            Hola <strong>${perfilNombre || 'equipo'}</strong>,
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6;">
            La empresa <strong style="color: #38512F;">${empresaNombre || 'sin nombre'}</strong>
            termino de cargar todos los subdocumentos del documento padre
            <strong style="color: #38512F;">${documentoPadre || 'Documento'}</strong>.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F; width: 45%;">Perfil asignador</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${perfilRol || 'N/A'}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Subdocumentos completados</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${Number(totalSubdocumentos) > 0 ? Number(totalSubdocumentos) : 0}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha de asignacion</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatearFechaMx(fechaAsignacion)}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; background-color: #f0f4ec; font-weight: bold; color: #38512F;">Fecha de completado</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #E2E3DE;">${formatearFechaMx(fechaCompletado)}</td>
            </tr>
        </table>
        ${botonPlataforma('Revisar documentos', '/proteccion-civil-revisar-documentos')}
    `;

    const html = plantillaBase({ titulo: 'Documentacion completada por empresa', contenido });
    const text = `Hola ${perfilNombre || 'equipo'},\n\nLa empresa ${empresaNombre || 'sin nombre'} termino de cargar todos los subdocumentos de ${documentoPadre || 'Documento'}.\nSubdocumentos completados: ${Number(totalSubdocumentos) > 0 ? Number(totalSubdocumentos) : 0}\nFecha de asignacion: ${formatearFechaMx(fechaAsignacion)}\nFecha de completado: ${formatearFechaMx(fechaCompletado)}\n\n${URL_PLATAFORMA}/proteccion-civil-revisar-documentos\n\n- Biznaga Risk&Tech`;

    return enviarCorreo({
        to: perfilEmail,
        subject: `Proteccion Civil - Documentacion completada por ${empresaNombre || 'empresa'}`,
        html,
        text
    });
}

/**
 * Compila un mensaje MIME listo para APPEND en IMAP (p. ej. carpeta Enviados).
 */
async function compilarMensajeCorreo(mailOptions = {}) {
    const MailComposer = require('nodemailer/lib/mail-composer');
    const composer = new MailComposer(mailOptions);
    return composer.compile().build();
}

/**
 * Envía un correo usando las credenciales SMTP del buzón del perfil.
 */
async function enviarCorreoPerfil({
    correoRemitente,
    nombreRemitente,
    password,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpRequireTls,
    rejectUnauthorized,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    attachments,
    inReplyTo,
    references
}) {
    if (!correoRemitente || !password || !smtpHost) {
        return { success: false, error: 'Configuracion SMTP del perfil incompleta' };
    }

    const transportConfig = {
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
            user: correoRemitente,
            pass: password
        },
        tls: {
            rejectUnauthorized: rejectUnauthorized !== false
        }
    };

    if (!smtpSecure && smtpRequireTls) {
        transportConfig.requireTLS = true;
    }

    const transporter = nodemailer.createTransport(transportConfig);

    try {
        const info = await transporter.sendMail({
            from: `"${nombreRemitente || correoRemitente}" <${correoRemitente}>`,
            to,
            cc: cc || undefined,
            bcc: bcc || undefined,
            subject,
            html,
            text,
            attachments: Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
            inReplyTo: inReplyTo || undefined,
            references: references || undefined
        });

        return {
            success: true,
            messageId: info.messageId,
            origen: 'perfil'
        };
    } catch (error) {
        return {
            success: false,
            error: error?.message || 'No se pudo enviar el correo desde el buzon del perfil'
        };
    } finally {
        try {
            transporter.close();
        } catch (_err) {
            // Ignorar errores al cerrar el transporte temporal.
        }
    }
}

// =====================================================
// EXPORTS
// =====================================================
module.exports = {
    enviarCorreo,
    enviarCorreoPerfil,
    compilarMensajeCorreo,
    notificarInstructorRegistroParticipantes,
    notificarEmpresaRegistroParticipantes,
    notificarEmpresaCursoAsignado,
    notificarInstructorCursoAsignado,
    notificarEmpresaDocumentosPCAsignados,
    notificarPerfilAsignadorPCDocumentosCompletados,
    enviarInvitacionCurso,
    enviarCredencialesNuevoUsuario,
    notificarCambioPasswordAcceso,
    notificarCambioCorreoAcceso,
    isEnabled: () => emailEnabled
};
