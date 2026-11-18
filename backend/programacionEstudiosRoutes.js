/**
 * Programación de estudios médicos (SP-F-30) en la base de médicos.
 */

const {
    asegurarTabla,
    filaPublica,
    guardar,
    obtenerPorId,
    subirPdfFirmado,
    siglasEmpresa
} = require('./spF30Service');

let empresaSiglasColumnChecked = false;

function poolMedicosDe(deps) {
    return typeof deps.getPoolMedicos === 'function' ? deps.getPoolMedicos() : null;
}

function poolPrincipalDe(deps) {
    return typeof deps.getPool === 'function' ? deps.getPool() : null;
}

async function asegurarColumnaSiglasEmpresa(pool) {
    if (!pool || empresaSiglasColumnChecked) return;
    try {
        await pool.query('ALTER TABLE empresa ADD COLUMN siglas VARCHAR(12) NULL');
    } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
    empresaSiglasColumnChecked = true;
}

function normalizarSiglasManual(valor) {
    return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
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

async function guardarSiglasEmpresa(pool, empresaId, siglasRaw, crearSiFalta = true) {
    await asegurarColumnaSiglasEmpresa(pool);
    const id = Number(empresaId);
    if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('Empresa inválida');
        err.status = 400;
        throw err;
    }
    const [rows] = await pool.query(
        'SELECT empresa_id, nombre_empresa, siglas FROM empresa WHERE empresa_id = ? LIMIT 1',
        [id]
    );
    if (!rows.length) {
        const err = new Error('Empresa no encontrada');
        err.status = 404;
        throw err;
    }
    const empresa = rows[0];
    let siglas = normalizarSiglasManual(siglasRaw);
    if (siglas.length < 2) {
        if (!crearSiFalta) {
            const err = new Error('Las siglas deben tener al menos 2 caracteres.');
            err.status = 400;
            throw err;
        }
        siglas = normalizarSiglasManual(empresa.siglas) || siglasEmpresa(empresa.nombre_empresa);
    }
    if (siglas.length < 2) {
        const err = new Error('No se pudieron determinar las siglas de la empresa.');
        err.status = 400;
        throw err;
    }
    await pool.query('UPDATE empresa SET siglas = ? WHERE empresa_id = ?', [siglas, id]);
    return { empresa_id: id, nombre_empresa: empresa.nombre_empresa, siglas };
}

function registrarRutasProgramacionEstudios(app, deps) {
    const dbMedicos = deps.dbMedicos || 'medicos_biznaga';

    app.get('/api/programacion-estudios/empresas', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            const pool = poolPrincipalDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            await asegurarColumnaSiglasEmpresa(pool);
            const [empresas] = await pool.query(`
                SELECT
                    e.empresa_id,
                    e.nombre_empresa,
                    e.rfc,
                    e.estado,
                    e.ciudad,
                    e.logo,
                    e.siglas,
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

    app.put('/api/programacion-estudios/empresas/:empresaId/siglas', async (req, res) => {
        try {
            const pool = poolPrincipalDe(deps);
            const empresa = await guardarSiglasEmpresa(
                pool,
                req.params.empresaId,
                req.body?.siglas,
                req.body?.crear_si_falta !== false
            );
            res.json({
                success: true,
                message: 'Siglas de empresa guardadas.',
                empresa
            });
        } catch (error) {
            console.error('[ERROR] Guardar siglas empresa programación:', error.message);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || 'No se pudieron guardar las siglas'
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
            const pool = poolPrincipalDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const empresa = await nombreEmpresa(deps, req.body?.empresa_id, req.body?.nombre_empresa);
            if (req.body?.empresa_id && req.body?.siglas) {
                try {
                    await guardarSiglasEmpresa(pool, req.body.empresa_id, req.body.siglas, true);
                } catch (siglasError) {
                    console.warn('[WARN] No se pudieron persistir siglas de empresa:', siglasError.message);
                }
            }
            const programacion = await guardar(poolMedicos, req.body || {}, empresa, null);
            res.json({
                success: true,
                message: programacion.drive_warning
                    ? 'Programación guardada en el archivero (Excel pendiente de sync).'
                    : 'Programación guardada en el archivero.',
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
            const pool = poolPrincipalDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const empresa = await nombreEmpresa(deps, req.body?.empresa_id, req.body?.nombre_empresa);
            if (req.body?.empresa_id && req.body?.siglas) {
                try {
                    await guardarSiglasEmpresa(pool, req.body.empresa_id, req.body.siglas, true);
                } catch (siglasError) {
                    console.warn('[WARN] No se pudieron persistir siglas de empresa:', siglasError.message);
                }
            }
            const programacion = await guardar(poolMedicos, req.body || {}, empresa, Number(req.params.id));
            res.json({
                success: true,
                message: programacion.drive_warning
                    ? 'Programación actualizada en el archivero (Excel pendiente de sync).'
                    : 'Programación actualizada en el archivero.',
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
