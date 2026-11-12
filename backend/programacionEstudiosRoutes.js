/**
 * Programación de estudios médicos (SP-F-30) en la base de médicos.
 */

const {
    asegurarTabla,
    filaPublica,
    guardar,
    obtenerPorId,
    subirPdfFirmado
} = require('./spF30Service');

function poolMedicosDe(deps) {
    return typeof deps.getPoolMedicos === 'function' ? deps.getPoolMedicos() : null;
}

function poolPrincipalDe(deps) {
    return typeof deps.getPool === 'function' ? deps.getPool() : null;
}

async function nombreEmpresa(deps, empresaId, nombreRecibido) {
    const nombre = String(nombreRecibido || '').trim();
    if (nombre) return nombre;
    const id = Number(empresaId);
    if (!Number.isInteger(id) || id <= 0) return '';
    const pool = poolPrincipalDe(deps);
    if (!pool) return '';
    const [rows] = await pool.query(
        'SELECT nombre_empresa FROM empresa WHERE empresa_id = ? LIMIT 1',
        [id]
    );
    return rows[0]?.nombre_empresa || '';
}

function registrarRutasProgramacionEstudios(app, deps) {
    const dbMedicos = deps.dbMedicos || 'medicos_biznaga';

    app.get('/api/programacion-estudios/empresas', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            const pool = poolPrincipalDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const [empresas] = await pool.query(`
                SELECT
                    e.empresa_id,
                    e.nombre_empresa,
                    e.rfc,
                    e.estado,
                    e.ciudad,
                    e.logo,
                    (SELECT COUNT(*) FROM \`${dbMedicos}\`.programacion_estudios p
                     WHERE p.empresa_id = e.empresa_id AND p.activo = 1) AS programaciones_totales
                FROM empresa e
                WHERE e.activo = TRUE
                ORDER BY e.nombre_empresa
            `);
            res.json({ success: true, empresas });
        } catch (error) {
            console.error('[ERROR] Empresas programación de estudios:', error.message);
            res.status(error.status || 500).json({
                success: false,
                message: error.status ? error.message : 'Error al obtener empresas'
            });
        }
    });

    app.get('/api/programacion-estudios', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            let sql = `SELECT * FROM programacion_estudios WHERE activo = 1`;
            const params = [];
            if (req.query.empresa_id) {
                sql += ' AND empresa_id = ?';
                params.push(req.query.empresa_id);
            }
            sql += ' ORDER BY fecha_programacion DESC, id DESC';
            const [rows] = await poolMedicos.query(sql, params);
            res.json({ success: true, programaciones: rows.map((row) => filaPublica(row)) });
        } catch (error) {
            console.error('[ERROR] Listar programaciones de estudios:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener las programaciones' });
        }
    });

    app.get('/api/programacion-estudios/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const row = await obtenerPorId(poolMedicos, req.params.id);
            if (!row) {
                return res.status(404).json({ success: false, message: 'Programación no encontrada' });
            }
            res.json({ success: true, programacion: filaPublica(row) });
        } catch (error) {
            console.error('[ERROR] Obtener programación de estudios:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener la programación' });
        }
    });

    app.post('/api/programacion-estudios', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const empresa = await nombreEmpresa(deps, req.body?.empresa_id, req.body?.nombre_empresa);
            const programacion = await guardar(poolMedicos, req.body || {}, empresa, null);
            res.json({
                success: true,
                message: 'Programación guardada en el archivero.',
                programacion
            });
        } catch (error) {
            console.error('[ERROR] Guardar programación de estudios:', error.message);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || 'No se pudo guardar la programación'
            });
        }
    });

    app.put('/api/programacion-estudios/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const empresa = await nombreEmpresa(deps, req.body?.empresa_id, req.body?.nombre_empresa);
            const programacion = await guardar(poolMedicos, req.body || {}, empresa, Number(req.params.id));
            res.json({
                success: true,
                message: 'Programación actualizada en el archivero.',
                programacion
            });
        } catch (error) {
            console.error('[ERROR] Actualizar programación de estudios:', error.message);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || 'No se pudo actualizar la programación'
            });
        }
    });

    app.delete('/api/programacion-estudios/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            await poolMedicos.query(
                'UPDATE programacion_estudios SET activo = 0 WHERE id = ?',
                [req.params.id]
            );
            res.json({ success: true, message: 'Programación quitada del listado. La hoja del Excel se conserva.' });
        } catch (error) {
            console.error('[ERROR] Eliminar programación de estudios:', error.message);
            res.status(500).json({ success: false, message: 'No se pudo quitar la programación' });
        }
    });

    app.post('/api/programacion-estudios/:id/pdf-firmado', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const programacion = await subirPdfFirmado(poolMedicos, Number(req.params.id), req.body || {});
            res.json({
                success: true,
                message: 'PDF firmado guardado en Documentos Firmados.',
                programacion
            });
        } catch (error) {
            console.error('[ERROR] PDF firmado programación de estudios:', error.message);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || 'No se pudo guardar el PDF firmado'
            });
        }
    });
}

module.exports = { registrarRutasProgramacionEstudios };
