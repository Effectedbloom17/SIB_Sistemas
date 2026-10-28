/**
 * Rutas de firmas y autorizaciones del SGC.
 * Montaje: app.use('/api/sgc/firmas', createSgcFirmasRouter(deps))
 */
const express = require('express');
const sgcFirmasService = require('./sgcFirmasService');

function createSgcFirmasRouter({
    authMiddleware,
    denyEmpresa,
    getPool,
    getPoolSgc,
    handleError,
    esGestor,
    nombreUsuario
}) {
    const router = express.Router();
    router.use(authMiddleware, denyEmpresa);

    function pools(res) {
        const pool = typeof getPool === 'function' ? getPool() : null;
        const poolSgc = typeof getPoolSgc === 'function' ? getPoolSgc() : null;
        if (!pool?.query || !poolSgc?.query) {
            res.status(503).json({ success: false, message: 'Base de datos SGC no disponible.' });
            return null;
        }
        return { pool, poolSgc };
    }

    function responder(res, error, fallback) {
        const status = Number(error?.status) || 0;
        if (status >= 400 && status < 500) {
            return res.status(status).json({ success: false, message: error.message });
        }
        return handleError(res, error, fallback);
    }

    router.get('/mia', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const firma = await sgcFirmasService.estadoFirmaPersonal(ctx.poolSgc, req.user?.id);
            res.json({ success: true, firma });
        } catch (error) {
            responder(res, error, 'No se pudo consultar tu firma');
        }
    });

    router.get('/mia/cifrado', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const paquete = await sgcFirmasService.obtenerCifradoPropio(ctx.poolSgc, req.user?.id);
            res.json({ success: true, paquete });
        } catch (error) {
            responder(res, error, 'No se pudo leer tu firma cifrada');
        }
    });

    router.post('/mia', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const firma = await sgcFirmasService.guardarFirmaPersonal(ctx.poolSgc, req.user?.id, req.body);
            res.status(201).json({ success: true, firma });
        } catch (error) {
            responder(res, error, 'No se pudo guardar tu firma');
        }
    });

    router.post('/mia/revocar', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const firma = await sgcFirmasService.revocarFirmaPersonal(ctx.poolSgc, req.user?.id);
            res.json({ success: true, firma });
        } catch (error) {
            responder(res, error, 'No se pudo revocar tu firma');
        }
    });

    router.get('/avisos', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const avisos = await sgcFirmasService.listarAvisosFirma(ctx.poolSgc, req.user?.id);
            res.json({ success: true, avisos });
        } catch (error) {
            responder(res, error, 'No se pudieron cargar los avisos de firma');
        }
    });

    router.post('/avisos/:id/descartar', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            await sgcFirmasService.descartarAvisoFirma(ctx.poolSgc, req.params.id, req.user?.id);
            res.json({ success: true });
        } catch (error) {
            responder(res, error, 'No se pudo cerrar el aviso de firma');
        }
    });

    router.get('/usuarios', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const usuarios = await sgcFirmasService.listarUsuariosInternos(ctx.pool);
            res.json({ success: true, usuarios });
        } catch (error) {
            responder(res, error, 'No se pudo cargar el directorio de firmantes');
        }
    });

    router.get('/zonas', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const zonas = await sgcFirmasService.listarZonas(ctx.poolSgc, req.query?.codigo);
            res.json({ success: true, zonas });
        } catch (error) {
            responder(res, error, 'No se pudieron cargar las zonas de firma');
        }
    });

    router.post('/zonas', async (req, res) => {
        try {
            if (!esGestor(req)) {
                return res.status(403).json({
                    success: false,
                    message: 'Solo un gestor del SGC puede configurar zonas de firma.'
                });
            }
            const ctx = pools(res);
            if (!ctx) return;
            const zona = await sgcFirmasService.crearZona(ctx.poolSgc, req.body, req.user?.id);
            res.status(201).json({ success: true, zona });
        } catch (error) {
            responder(res, error, 'No se pudo crear la zona de firma');
        }
    });

    router.put('/zonas/:id', async (req, res) => {
        try {
            if (!esGestor(req)) {
                return res.status(403).json({
                    success: false,
                    message: 'Solo un gestor del SGC puede configurar zonas de firma.'
                });
            }
            const ctx = pools(res);
            if (!ctx) return;
            const zona = await sgcFirmasService.guardarZona(ctx.poolSgc, req.params.id, req.body, req.user?.id);
            res.json({ success: true, zona });
        } catch (error) {
            responder(res, error, 'No se pudo guardar la zona de firma');
        }
    });

    router.get('/solicitudes', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const vista = ['pendientes', 'historial', 'mias'].includes(String(req.query?.vista || ''))
                ? String(req.query.vista)
                : 'mias';
            const solicitudes = await sgcFirmasService.listar(ctx.poolSgc, ctx.pool, {
                usuarioId: req.user?.id,
                esGestor: esGestor(req),
                vista
            });
            res.json({ success: true, solicitudes, vista });
        } catch (error) {
            responder(res, error, 'No se pudieron cargar las solicitudes de firma');
        }
    });

    router.post('/solicitudes', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.crearSolicitud({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                usuarioId: req.user?.id,
                nombreSolicitante: nombreUsuario(req),
                body: req.body
            });
            res.status(201).json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo crear la solicitud de firma');
        }
    });

    router.get('/documento', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.documentoAutorizado(ctx.poolSgc, ctx.pool, {
                codigo: req.query?.codigo,
                ruta: req.query?.ruta,
                usuarioId: req.user?.id,
                esGestor: esGestor(req)
            });
            res.json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo consultar la firma del documento');
        }
    });

    router.post('/solicitudes/:id/preparar-impresion', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            await sgcFirmasService.prepararImpresion({
                poolSgc: ctx.poolSgc,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                firmaPng: req.body?.firmaPng
            });
            res.json({ success: true });
        } catch (error) {
            responder(res, error, 'No se pudo preparar la firma para imprimir');
        }
    });

    router.post('/solicitudes/:id/consumir', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            await sgcFirmasService.consumirFirma({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                esGestor: esGestor(req)
            });
            res.json({ success: true });
        } catch (error) {
            responder(res, error, 'No se pudo eliminar la firma usada');
        }
    });

    router.get('/solicitudes/:id/pdf', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const pdf = await sgcFirmasService.pdfConFirma({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                esGestor: esGestor(req)
            });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="documento-firmado.pdf"');
            res.send(pdf);
        } catch (error) {
            responder(res, error, 'No se pudo imprimir el PDF del documento');
        }
    });

    router.get('/solicitudes/:id/impresion', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const imagenes = await sgcFirmasService.imagenesImpresion({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                esGestor: esGestor(req)
            });
            res.json({ success: true, imagenes });
        } catch (error) {
            responder(res, error, 'No se pudo preparar la impresión');
        }
    });

    router.get('/solicitudes/:id', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.obtenerDetalle(
                ctx.poolSgc,
                ctx.pool,
                req.params.id,
                req.user?.id,
                esGestor(req)
            );
            res.json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo consultar la solicitud de firma');
        }
    });

    router.post('/solicitudes/:id/aprobar', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.decidir({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                decision: 'aprobada',
                observacion: req.body?.observacion,
                firmaPng: req.body?.firmaPng
            });
            res.json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo aprobar la solicitud');
        }
    });

    router.post('/solicitudes/:id/rechazar', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.decidir({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                decision: 'rechazada',
                observacion: req.body?.observacion
            });
            res.json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo rechazar la solicitud');
        }
    });

    router.post('/solicitudes/:id/invalidar', async (req, res) => {
        try {
            const ctx = pools(res);
            if (!ctx) return;
            const solicitud = await sgcFirmasService.invalidarSolicitud({
                poolSgc: ctx.poolSgc,
                pool: ctx.pool,
                solicitudId: req.params.id,
                usuarioId: req.user?.id,
                esGestor: esGestor(req),
                motivo: req.body?.motivo
            });
            res.json({ success: true, solicitud });
        } catch (error) {
            responder(res, error, 'No se pudo invalidar la autorización');
        }
    });

    return router;
}

module.exports = createSgcFirmasRouter;
