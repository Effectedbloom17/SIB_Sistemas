/**
 * Socket.io — Chat Empresas en tiempo real.
 *
 * Rooms:
 *   admins                  → todos los root/administrador conectados
 *   empresa:{empresaId}     → usuarios de esa empresa
 *   conversacion:{id}       → quienes tienen abierto un hilo concreto
 *
 * Eventos cliente → servidor:
 *   chat:join   { conversacionId }
 *   chat:leave  { conversacionId }
 *   chat:enviar { cuerpo, conversacionId?, empresaId? }  (+ ack opcional)
 *
 * Eventos servidor → cliente:
 *   chat:mensaje
 *   chat:conversacion_actualizada
 *   chat:error
 */
const { Server } = require('socket.io');
const chatEmpresasService = require('./chatEmpresasService');
const startupLog = require('./startupLog');

/**
 * @param {import('http').Server} httpServer
 * @param {object} opts
 * @param {(token: string) => any} opts.verifyJwtToken
 * @param {() => import('mysql2/promise').Pool} opts.getPool
 * @param {string[] | string} [opts.corsOrigins]
 * @param {(mensaje: any) => void} [opts.onMensajeEmitido]
 */
function initChatSocket(httpServer, { verifyJwtToken, getPool, corsOrigins, onMensajeEmitido }) {
    const origins = Array.isArray(corsOrigins)
        ? corsOrigins
        : (corsOrigins ? [corsOrigins] : ['http://localhost:4200', 'http://127.0.0.1:4200']);

    const io = new Server(httpServer, {
        path: '/socket.io',
        cors: {
            origin: origins,
            credentials: true,
            methods: ['GET', 'POST']
        }
    });

    function poolOrThrow() {
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            const error = new Error('Base de datos no disponible todavía');
            error.status = 503;
            throw error;
        }
        return pool;
    }

    // Auth JWT en el handshake (Angular: io(url, { auth: { token } }))
    io.use((socket, next) => {
        try {
            const token =
                socket.handshake.auth?.token ||
                socket.handshake.query?.token ||
                String(socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');

            if (!token) {
                return next(new Error('Token requerido'));
            }
            socket.user = verifyJwtToken(String(token));
            return next();
        } catch (_err) {
            return next(new Error('Token inválido'));
        }
    });

    io.on('connection', (socket) => {
        const user = socket.user || {};
        const admin = chatEmpresasService.esAdminChat(user);
        const empresa = chatEmpresasService.esEmpresaChat(user);
        const empresaId = Number(user.empresa_id || 0);

        if (admin) {
            socket.join('admins');
        }
        if (empresa && empresaId > 0) {
            socket.join(`empresa:${empresaId}`);
        }

        socket.on('chat:join', async (payload, ack) => {
            try {
                const conversacionId = Number(payload?.conversacionId || payload);
                await chatEmpresasService.listarMensajes(poolOrThrow(), conversacionId, user, { afterId: 0 });
                socket.join(`conversacion:${conversacionId}`);
                if (typeof ack === 'function') ack({ success: true });
            } catch (error) {
                socket.emit('chat:error', { message: error.message || 'No se pudo unir al chat' });
                if (typeof ack === 'function') ack({ success: false, message: error.message });
            }
        });

        socket.on('chat:leave', (payload) => {
            const conversacionId = Number(payload?.conversacionId || payload);
            if (conversacionId > 0) {
                socket.leave(`conversacion:${conversacionId}`);
            }
        });

        socket.on('chat:enviar', async (payload, ack) => {
            try {
                const mensaje = await chatEmpresasService.enviarMensaje(poolOrThrow(), user, {
                    cuerpo: payload?.cuerpo,
                    conversacionId: payload?.conversacionId,
                    empresaId: payload?.empresaId
                });

                if (typeof onMensajeEmitido === 'function') {
                    onMensajeEmitido(mensaje);
                } else {
                    const cid = Number(mensaje.conversacion_id);
                    const eid = Number(mensaje.empresa_id || 0);
                    io.to(`conversacion:${cid}`).emit('chat:mensaje', mensaje);
                    io.to('admins').emit('chat:mensaje', mensaje);
                    if (eid > 0) {
                        io.to(`empresa:${eid}`).emit('chat:mensaje', mensaje);
                    }
                    io.to('admins').emit('chat:conversacion_actualizada', {
                        conversacion_id: cid,
                        empresa_id: eid,
                        ultimo_mensaje: mensaje.cuerpo,
                        ultimo_emisor_tipo: mensaje.emisor_tipo,
                        ultimo_mensaje_at: mensaje.created_at,
                        mensaje
                    });
                    if (eid > 0) {
                        io.to(`empresa:${eid}`).emit('chat:conversacion_actualizada', {
                            conversacion_id: cid,
                            empresa_id: eid,
                            ultimo_mensaje: mensaje.cuerpo,
                            ultimo_emisor_tipo: mensaje.emisor_tipo,
                            ultimo_mensaje_at: mensaje.created_at,
                            mensaje
                        });
                    }
                }

                if (typeof ack === 'function') ack({ success: true, mensaje });
            } catch (error) {
                const message = error.message || 'No se pudo enviar el mensaje';
                socket.emit('chat:error', { message });
                if (typeof ack === 'function') ack({ success: false, message });
            }
        });
    });

    startupLog.detail('[CHAT] Socket.io listo en path /socket.io');
    return io;
}

module.exports = { initChatSocket };
