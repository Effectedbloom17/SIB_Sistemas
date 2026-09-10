/**
 * Rutas REST evidencias SGC-F-14.
 * Montaje: app.use('/api/sgc/formatos/sgc-f-14/evidencias', createSgcF14EvidenciaRouter(deps))
 */
const express = require('express');
const sgcF14EvidenciaService = require('./sgcF14EvidenciaService');

function createSgcF14EvidenciaRouter({
    getPoolSgc,
    requireAdminOrSgc,
    handleError,
    obtenerNombreUsuarioAccion
}) {
    const router = express.Router({ mergeParams: true });

    function poolOrThrow() {
        const pool = typeof getPoolSgc === 'function' ? getPoolSgc() : null;
        if (!pool) {
            const error = new Error('Base de datos SGC no disponible todavía.');
            error.status = 503;
            throw error;
        }
        return pool;
    }

    function usuarioAccion(req) {
        if (typeof obtenerNombreUsuarioAccion === 'function') {
            return obtenerNombreUsuarioAccion(req);
        }
        return req.user?.usuario || req.user?.email || req.user?.nombre || req.user?.username || '';
    }

    function responderError(res, error, fallback) {
        const status = Number(error?.status) || 0;
        const msg = String(error?.message || '');
        if (status === 404 || msg.includes('no encontrada') || msg.includes('no encontrado')) {
            return res.status(404).json({ success: false, message: msg || fallback });
        }
        if (
            status === 400
            || msg.includes('inválid')
            || msg.includes('requerido')
            || msg.includes('vacío')
            || msg.includes('Máximo')
            || msg.includes('supera')
        ) {
            return res.status(400).json({ success: false, message: msg });
        }
        return handleError(res, error, fallback);
    }

    router.use(requireAdminOrSgc);

    router.get('/conteos', async (req, res) => {
        try {
            const raw = String(req.query?.ids || '').trim();
            const ids = raw
                ? raw.split(',').map((s) => s.trim()).filter(Boolean)
                : (Array.isArray(req.body?.ids) ? req.body.ids : []);
            const conteos = await sgcF14EvidenciaService.contarEvidencias(poolOrThrow(), ids);
            return res.json({ success: true, conteos });
        } catch (error) {
            return responderError(res, error, 'No se pudieron obtener los conteos de evidencias');
        }
    });

    // Rutas estáticas ANTES de /:proyectoId para no capturar "documento".
    router.get('/documento/:id/archivo', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isFinite(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID inválido.' });
            }
            const { documento, buffer } = await sgcF14EvidenciaService.obtenerBufferEvidencia(
                poolOrThrow(),
                id
            );
            res.setHeader('Content-Type', documento.mimeType || 'application/octet-stream');
            res.setHeader(
                'Content-Disposition',
                `inline; filename="${encodeURIComponent(documento.nombreArchivo || 'evidencia')}"`
            );
            return res.send(buffer);
        } catch (error) {
            return responderError(res, error, 'No se pudo descargar la evidencia');
        }
    });

    router.delete('/documento/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isFinite(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID inválido.' });
            }
            const resultado = await sgcF14EvidenciaService.eliminarEvidencia(poolOrThrow(), id);
            return res.json({ success: true, message: 'Evidencia eliminada.', ...resultado });
        } catch (error) {
            return responderError(res, error, 'No se pudo eliminar la evidencia');
        }
    });

    router.get('/:proyectoId', async (req, res) => {
        try {
            const resultado = await sgcF14EvidenciaService.listarEvidencias(
                poolOrThrow(),
                req.params.proyectoId
            );
            return res.json({ success: true, ...resultado });
        } catch (error) {
            return responderError(res, error, 'No se pudieron listar las evidencias');
        }
    });

    router.post('/subir', async (req, res) => {
        try {
            const documento = await sgcF14EvidenciaService.subirEvidencia(
                poolOrThrow(),
                req.body || {},
                usuarioAccion(req)
            );
            return res.json({ success: true, message: 'Evidencia subida.', documento });
        } catch (error) {
            return responderError(res, error, 'No se pudo subir la evidencia');
        }
    });

    router.post('/subir-lote', async (req, res) => {
        try {
            const resultado = await sgcF14EvidenciaService.subirEvidenciasLote(
                poolOrThrow(),
                req.body || {},
                usuarioAccion(req)
            );
            return res.json({
                success: true,
                message: `${resultado.exitosos} archivo(s) subido(s).`,
                ...resultado
            });
        } catch (error) {
            return responderError(res, error, 'No se pudieron subir las evidencias');
        }
    });

    return router;
}

module.exports = createSgcF14EvidenciaRouter;
