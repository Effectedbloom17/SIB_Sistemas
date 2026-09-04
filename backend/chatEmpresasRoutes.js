/**
 * Rutas REST del Chat Empresas.
 * Montaje: app.use('/api/chat-empresas', createChatEmpresasRouter(deps))
 *
 * Endpoints:
 *   GET    /conversaciones
 *   GET    /conversaciones/:id/mensajes
 *   POST   /mensajes
 *   POST   /conversaciones/:id/leidos
 *   PATCH  /conversaciones/:id
 */
const express = require('express');
const chatEmpresasService = require('./chatEmpresasService');

/**
 * @param {object} deps
 * @param {() => import('mysql2/promise').Pool} deps.getPool  — getter: el pool se asigna async en server.js
 * @param {Function} deps.authMiddleware
 * @param {Function} deps.requireRole
 * @param {() => import('socket.io').Server | null} deps.getIo
 */
function createChatEmpresasRouter({ getPool, authMiddleware, requireRole, getIo }) {
    const router = express.Router();
    const rolesChat = requireRole('root', 'administrador', 'empresa');
    const rolesAdmin = requireRole('root', 'administrador');

    function poolOrThrow() {
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            const error = new Error('Base de datos no disponible todavía. Intenta de nuevo en unos segundos.');
            error.status = 503;
            throw error;
        }
        return pool;
    }

    /** Emite eventos Socket.io tras persistir en MySQL. */
    function emitirNuevoMensaje(mensaje, meta = {}) {
        const io = typeof getIo === 'function' ? getIo() : null;
        if (!io || !mensaje) return;

        const conversacionId = Number(mensaje.conversacion_id);
        const empresaId = Number(mensaje.empresa_id || meta.empresa_id || 0);

        io.to(`conversacion:${conversacionId}`).emit('chat:mensaje', mensaje);
        // También a salas de rol (por si el cliente aún no hizo chat:join)
        io.to('admins').emit('chat:mensaje', mensaje);
        if (empresaId > 0) {
            io.to(`empresa:${empresaId}`).emit('chat:mensaje', mensaje);
        }

        io.to('admins').emit('chat:conversacion_actualizada', {
            conversacion_id: conversacionId,
            empresa_id: empresaId,
            ultimo_mensaje: mensaje.cuerpo,
            ultimo_emisor_tipo: mensaje.emisor_tipo,
            ultimo_mensaje_at: mensaje.created_at,
            mensaje
        });

        if (empresaId > 0) {
            io.to(`empresa:${empresaId}`).emit('chat:conversacion_actualizada', {
                conversacion_id: conversacionId,
                empresa_id: empresaId,
                ultimo_mensaje: mensaje.cuerpo,
                ultimo_emisor_tipo: mensaje.emisor_tipo,
                ultimo_mensaje_at: mensaje.created_at,
                mensaje
            });
        }
    }

    router.get('/conversaciones', authMiddleware, rolesChat, async (req, res) => {
        try {
            const conversaciones = await chatEmpresasService.listarConversaciones(poolOrThrow(), req.user, {
                q: req.query?.q,
                soloNoLeidos:
                    String(req.query?.soloNoLeidos || '') === '1' ||
                    String(req.query?.soloNoLeidos || '').toLowerCase() === 'true'
            });
            res.json({ success: true, conversaciones });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 400 && status < 500) {
                return res.status(status).json({ success: false, message: error.message });
            }
            if (status === 503) {
                return res.status(503).json({ success: false, message: error.message });
            }
            console.error('[CHAT] listar conversaciones:', error);
            res.status(500).json({ success: false, message: 'Error al listar conversaciones' });
        }
    });

    router.get('/conversaciones/:id/mensajes', authMiddleware, rolesChat, async (req, res) => {
        try {
            const data = await chatEmpresasService.listarMensajes(poolOrThrow(), req.params.id, req.user, {
                afterId: req.query?.afterId
            });
            res.json({ success: true, ...data });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 400 && status < 500) {
                return res.status(status).json({ success: false, message: error.message });
            }
            if (status === 503) {
                return res.status(503).json({ success: false, message: error.message });
            }
            console.error('[CHAT] listar mensajes:', error);
            res.status(500).json({ success: false, message: 'Error al listar mensajes' });
        }
    });

    router.post('/mensajes', authMiddleware, rolesChat, async (req, res) => {
        try {
            const mensaje = await chatEmpresasService.enviarMensaje(poolOrThrow(), req.user, {
                cuerpo: req.body?.cuerpo,
                conversacionId: req.body?.conversacionId,
                empresaId: req.body?.empresaId
            });
            emitirNuevoMensaje(mensaje);
            res.status(201).json({ success: true, mensaje });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 400 && status < 500) {
                return res.status(status).json({ success: false, message: error.message });
            }
            if (status === 503) {
                return res.status(503).json({ success: false, message: error.message });
            }
            console.error('[CHAT] enviar mensaje:', error);
            res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
        }
    });

    router.post('/conversaciones/:id/leidos', authMiddleware, rolesChat, async (req, res) => {
        try {
            const result = await chatEmpresasService.marcarLeidos(poolOrThrow(), req.params.id, req.user);
            res.json({ success: true, ...result });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 400 && status < 500) {
                return res.status(status).json({ success: false, message: error.message });
            }
            if (status === 503) {
                return res.status(503).json({ success: false, message: error.message });
            }
            console.error('[CHAT] marcar leídos:', error);
            res.status(500).json({ success: false, message: 'Error al marcar mensajes leídos' });
        }
    });

    router.patch('/conversaciones/:id', authMiddleware, rolesAdmin, async (req, res) => {
        try {
            const conversacion = await chatEmpresasService.actualizarEstado(
                poolOrThrow(),
                req.params.id,
                req.user,
                req.body?.estado
            );
            res.json({ success: true, conversacion });
        } catch (error) {
            const status = error.status || 500;
            if (status >= 400 && status < 500) {
                return res.status(status).json({ success: false, message: error.message });
            }
            if (status === 503) {
                return res.status(503).json({ success: false, message: error.message });
            }
            console.error('[CHAT] actualizar conversación:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar conversación' });
        }
    });

    return { router, emitirNuevoMensaje };
}

module.exports = createChatEmpresasRouter;
