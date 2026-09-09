/**
 * Rutas REST del Repositorio Empresarial.
 * Montaje: app.use('/api/empresas/:empresaId/repositorio', createEmpresaRepositorioRouter(deps))
 */
const express = require('express');
const empresaRepositorioService = require('./empresaRepositorioService');

function parseEmpresaId(req) {
    const id = parseInt(req.params.empresaId, 10);
    if (!Number.isFinite(id) || id <= 0) {
        const error = new Error('ID de empresa inválido.');
        error.status = 400;
        throw error;
    }
    return id;
}

function parseDocId(req) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
        const error = new Error('ID de documento inválido.');
        error.status = 400;
        throw error;
    }
    return id;
}

function createEmpresaRepositorioRouter({
    getPool,
    denyEmpresa,
    requireAdmin,
    handleError,
    obtenerNombreUsuarioAccion
}) {
    // requireAdmin aquí incluye root, administrador, PC, SGC, Ambiental y RRHH.
    const router = express.Router({ mergeParams: true });

    function poolOrThrow() {
        const pool = typeof getPool === 'function' ? getPool() : null;
        if (!pool) {
            const error = new Error('Base de datos no disponible todavía. Intenta de nuevo en unos segundos.');
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
            status === 400 ||
            msg.includes('inválid') ||
            msg.includes('requerido') ||
            msg.includes('vacío') ||
            msg.includes('Ya existe') ||
            msg.includes('no está vacía') ||
            msg.includes('subcarpetas') ||
            msg.includes('Máximo') ||
            msg.includes('logo')
        ) {
            return res.status(400).json({ success: false, message: msg });
        }
        return handleError(res, error, fallback);
    }

    router.get('/', denyEmpresa, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const resultado = await empresaRepositorioService.listarDocumentos(poolOrThrow(), empresaId);
            return res.json({
                success: true,
                empresa: resultado.empresa || null,
                documentos: resultado.documentos || [],
                carpetas: resultado.carpetas || []
            });
        } catch (error) {
            return responderError(res, error, 'No se pudo listar el repositorio empresarial');
        }
    });

    router.post('/carpetas', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const carpeta = await empresaRepositorioService.crearCarpeta(
                poolOrThrow(),
                empresaId,
                req.body || {},
                usuarioAccion(req)
            );
            return res.json({ success: true, message: 'Carpeta creada.', carpeta });
        } catch (error) {
            return responderError(res, error, 'No se pudo crear la carpeta');
        }
    });

    router.delete('/carpetas', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const ruta = req.body?.ruta || req.query?.ruta || '';
            const resultado = await empresaRepositorioService.eliminarCarpeta(poolOrThrow(), empresaId, ruta);
            return res.json({ success: true, message: 'Carpeta eliminada.', ...resultado });
        } catch (error) {
            return responderError(res, error, 'No se pudo eliminar la carpeta');
        }
    });

    router.post('/subir', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const documento = await empresaRepositorioService.subirDocumento(
                poolOrThrow(),
                empresaId,
                req.body || {},
                usuarioAccion(req)
            );
            return res.json({ success: true, message: 'Documento subido.', documento });
        } catch (error) {
            return responderError(res, error, 'No se pudo subir el documento');
        }
    });

    router.post('/subir-lote', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const archivos = req.body?.archivos || [];
            const resultado = await empresaRepositorioService.subirDocumentosLote(
                poolOrThrow(),
                empresaId,
                archivos,
                usuarioAccion(req)
            );
            return res.json({
                success: true,
                message: `${resultado.exitosos} archivo(s) subido(s).`,
                ...resultado
            });
        } catch (error) {
            return responderError(res, error, 'No se pudo subir el lote');
        }
    });

    router.put('/:id/mover', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const documento = await empresaRepositorioService.moverDocumento(
                poolOrThrow(),
                empresaId,
                id,
                req.body?.carpeta_relativa || ''
            );
            return res.json({ success: true, message: 'Documento movido.', documento });
        } catch (error) {
            return responderError(res, error, 'No se pudo mover el documento');
        }
    });

    router.get('/:id/archivo', denyEmpresa, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const { doc, buffer } = await empresaRepositorioService.descargarBufferDocumento(
                poolOrThrow(),
                empresaId,
                id
            );
            const nombre = encodeURIComponent(doc.nombreArchivo || 'documento');
            res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${nombre}`);
            res.setHeader('Content-Length', buffer.length);
            return res.send(buffer);
        } catch (error) {
            return responderError(res, error, 'No se pudo descargar el archivo');
        }
    });

    router.get('/:id/miniatura', denyEmpresa, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const resultado = await empresaRepositorioService.obtenerMiniaturaDocumento(
                poolOrThrow(),
                empresaId,
                id
            );
            return res.json({ success: true, ...resultado });
        } catch (error) {
            return responderError(res, error, 'No se pudo obtener la miniatura');
        }
    });

    router.post('/:id/preparar-vista', denyEmpresa, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const documento = await empresaRepositorioService.prepararVistaDocumento(
                poolOrThrow(),
                empresaId,
                id
            );
            const urls = empresaRepositorioService.resolverUrlsVistaDocumento(documento);
            return res.json({
                success: true,
                documento,
                previewUrl: urls.previewUrl,
                editorUrl: urls.editorUrl,
                thumbnailUrl: urls.thumbnailUrl
            });
        } catch (error) {
            return responderError(res, error, 'No se pudo preparar la vista');
        }
    });

    /** Convierte Excel Office a Google Sheet (si aplica) y devuelve URL de editor embebible. */
    router.post('/:id/asegurar-editor', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const resultado = await empresaRepositorioService.asegurarEditorIntegradoDocumento(
                poolOrThrow(),
                empresaId,
                id
            );
            return res.json({
                success: true,
                ...resultado
            });
        } catch (error) {
            return responderError(res, error, 'No se pudo preparar el editor integrado');
        }
    });

    router.get('/:id', denyEmpresa, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const documento = await empresaRepositorioService.obtenerDocumento(poolOrThrow(), empresaId, id);
            if (!documento) {
                return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
            }
            return res.json({ success: true, documento });
        } catch (error) {
            return responderError(res, error, 'No se pudo obtener el documento');
        }
    });

    router.delete('/:id', requireAdmin, async (req, res) => {
        try {
            const empresaId = parseEmpresaId(req);
            const id = parseDocId(req);
            const resultado = await empresaRepositorioService.eliminarDocumento(poolOrThrow(), empresaId, id);
            return res.json({ success: true, message: 'Documento eliminado.', ...resultado });
        } catch (error) {
            return responderError(res, error, 'No se pudo eliminar el documento');
        }
    });

    return router;
}

module.exports = createEmpresaRepositorioRouter;
