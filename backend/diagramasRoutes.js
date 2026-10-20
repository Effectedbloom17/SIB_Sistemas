/**
 * Rutas REST de Diagramas (Comunicación).
 * Montaje: app.use('/api/diagramas', createDiagramasRouter(deps))
 *
 *   GET    /
 *   GET    /:id
 *   POST   /
 *   PUT    /:id
 *   DELETE /:id
 */
const express = require('express');
const diagramasService = require('./diagramasService');

function createDiagramasRouter({ getPool, getPoolPrincipal, ready, authMiddleware, denyEmpresa }) {
    const router = express.Router();

    async function poolOrThrow() {
        try {
            if (ready && typeof ready.then === 'function') {
                await ready;
            }
        } catch (_err) {
            const error = new Error('La base de sensores no está disponible. Intenta de nuevo en unos segundos.');
            error.status = 503;
            throw error;
        }
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            const error = new Error('La base de sensores no está disponible. Intenta de nuevo en unos segundos.');
            error.status = 503;
            throw error;
        }
        const principal = typeof getPoolPrincipal === 'function' ? getPoolPrincipal() : null;
        await diagramasService.preparar(pool, principal);
        return pool;
    }

    function responderError(res, error, fallback) {
        const status = error.status || 500;
        if (status >= 400 && status < 500) {
            return res.status(status).json({ success: false, message: error.message });
        }
        if (status === 503) {
            return res.status(503).json({ success: false, message: error.message });
        }
        console.error('[diagramas]', fallback, error);
        return res.status(500).json({ success: false, message: fallback });
    }

    router.use(authMiddleware, denyEmpresa);

    router.get('/', async (_req, res) => {
        try {
            const diagramas = await diagramasService.listar(await poolOrThrow());
            res.json({ success: true, diagramas });
        } catch (error) {
            responderError(res, error, 'No se pudieron cargar los diagramas');
        }
    });

    router.get('/:id', async (req, res) => {
        try {
            const diagrama = await diagramasService.obtener(await poolOrThrow(), req.params.id);
            res.json({ success: true, diagrama });
        } catch (error) {
            responderError(res, error, 'No se pudo abrir el diagrama');
        }
    });

    router.post('/', async (req, res) => {
        try {
            const diagrama = await diagramasService.crear(await poolOrThrow(), req.user, req.body?.titulo);
            res.status(201).json({ success: true, diagrama });
        } catch (error) {
            responderError(res, error, 'No se pudo crear el diagrama');
        }
    });

    router.put('/:id', async (req, res) => {
        try {
            const diagrama = await diagramasService.actualizar(
                await poolOrThrow(),
                req.user,
                req.params.id,
                {
                    ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'titulo') ? { titulo: req.body.titulo } : {}),
                    ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'xml') ? { xml: req.body.xml } : {})
                }
            );
            res.json({ success: true, diagrama });
        } catch (error) {
            responderError(res, error, 'No se pudo guardar el diagrama');
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const resultado = await diagramasService.eliminar(await poolOrThrow(), req.params.id);
            res.json({ success: true, ...resultado });
        } catch (error) {
            responderError(res, error, 'No se pudo eliminar el diagrama');
        }
    });

    return router;
}

module.exports = createDiagramasRouter;
