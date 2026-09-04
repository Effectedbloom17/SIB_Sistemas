/**
 * Historial de trámites PIPC finalizados (snapshot por ciclo).
 */

const APARTADOS = ['documentacion', 'oficios', 'observaciones', 'resolutivos', 'extra'];

function parseJsonSafe(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function clasificarApartadoPorClave(clave) {
    const c = String(clave || '').toLowerCase();
    if (!c) return 'documentacion';
    if (c.startsWith('ops_oficio')) return 'oficios';
    if (c.includes('observacion') || c.startsWith('ops_obs')) return 'observaciones';
    if (c.startsWith('ops_resolutivo')) return 'resolutivos';
    return 'documentacion';
}

function clasificarApartadoPorNombre(nombre) {
    const n = String(nombre || '').toLowerCase();
    if (n.includes('oficio')) return 'oficios';
    if (n.includes('observacion') || n.includes('observación')) return 'observaciones';
    if (n.includes('resolutivo')) return 'resolutivos';
    if (n.includes('documentación extra') || n.includes('documentacion extra') || n.includes('extra/')) {
        return 'extra';
    }
    return 'documentacion';
}

function extraerPipcDeNombre(nombre) {
    const n = String(nombre || '');
    const sep = n.indexOf('—');
    if (sep > 0) return n.slice(sep + 1).trim();
    const sep2 = n.indexOf(' - ');
    if (sep2 > 0 && /oficio|observaci|resolutivo/i.test(n.slice(0, sep2))) {
        return n.slice(sep2 + 3).trim();
    }
    return '';
}

function esDriveIdValido(id) {
    const s = String(id || '').trim();
    return s.length >= 10 && !s.includes('/') && !s.includes(' ');
}

async function ensureHistorialCicloTables(poolProteccionCivil) {
    await poolProteccionCivil.query(`
        CREATE TABLE IF NOT EXISTS pc_historial_ciclo_item (
            item_id INT AUTO_INCREMENT PRIMARY KEY,
            operacion_id INT NOT NULL,
            empresa_id INT NOT NULL,
            apartado VARCHAR(32) NOT NULL,
            tipo_item VARCHAR(16) NOT NULL DEFAULT 'archivo',
            pipc_titulo VARCHAR(255) NULL,
            nombre_documento VARCHAR(255) NOT NULL,
            nombre_archivo VARCHAR(255) NULL,
            valor_texto MEDIUMTEXT NULL,
            drive_file_id VARCHAR(191) NULL,
            mime_type VARCHAR(120) NULL,
            tamano_bytes BIGINT NULL,
            clave_workflow VARCHAR(80) NULL,
            grupo_titulo VARCHAR(255) NULL,
            fecha_referencia DATETIME NULL,
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_phci_ciclo (operacion_id),
            INDEX idx_phci_empresa (empresa_id),
            INDEX idx_phci_apartado (operacion_id, apartado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try {
        await poolProteccionCivil.query(
            `ALTER TABLE pc_centro_operaciones ADD COLUMN historial_resumen JSON NULL AFTER fechas_workflow`
        );
    } catch (err) {
        if (!String(err.message || '').includes('Duplicate')) {
            // columna puede existir
        }
    }
    try {
        await poolProteccionCivil.query(
            `ALTER TABLE pc_centro_operaciones ADD COLUMN pipc_titulos JSON NULL AFTER historial_resumen`
        );
    } catch (err) {
        if (!String(err.message || '').includes('Duplicate')) {
            // columna puede existir
        }
    }
}

async function listarArchivosDeDocumentos(pool, documentoIds) {
    const ids = (documentoIds || []).map((id) => Number(id)).filter((id) => id > 0);
    if (!ids.length) return new Map();
    let rows = [];
    try {
        const [r] = await pool.query(
            `SELECT archivo_id, documento_id, drive_file_id, nombre_archivo, mime_type, orden, fecha_subida
             FROM documento_proteccion_civil_archivo
             WHERE documento_id IN (?)
             ORDER BY orden ASC, archivo_id ASC`,
            [ids]
        );
        rows = r || [];
    } catch {
        rows = [];
    }
    const porDoc = new Map();
    for (const row of rows) {
        const key = Number(row.documento_id);
        if (!porDoc.has(key)) porDoc.set(key, []);
        porDoc.get(key).push(row);
    }
    return porDoc;
}

function resumenVacio() {
    return {
        documentacion: 0,
        oficios: 0,
        observaciones: 0,
        resolutivos: 0,
        extra: 0,
        total: 0
    };
}

function incrementarResumen(resumen, apartado) {
    if (!APARTADOS.includes(apartado)) return;
    resumen[apartado] += 1;
    resumen.total += 1;
}

async function insertarItem(pool, item) {
    await pool.query(
        `INSERT INTO pc_historial_ciclo_item
            (operacion_id, empresa_id, apartado, tipo_item, pipc_titulo, nombre_documento,
             nombre_archivo, valor_texto, drive_file_id, mime_type, tamano_bytes,
             clave_workflow, grupo_titulo, fecha_referencia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            item.operacion_id,
            item.empresa_id,
            item.apartado,
            item.tipo_item || 'archivo',
            item.pipc_titulo || null,
            item.nombre_documento,
            item.nombre_archivo || null,
            item.valor_texto || null,
            item.drive_file_id || null,
            item.mime_type || null,
            item.tamano_bytes != null ? item.tamano_bytes : null,
            item.clave_workflow || null,
            item.grupo_titulo || null,
            item.fecha_referencia || null
        ]
    );
}

/**
 * Congela el expediente del ciclo activo antes de borrar documentos operativos.
 */
async function snapshotCicloAlCerrar(pool, { ciclo, empresaId, allDocs }) {
    await ensureHistorialCicloTables(pool);
    const operacionId = Number(ciclo?.operacion_id);
    if (!operacionId) return resumenVacio();

    const [existentes] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM pc_historial_ciclo_item WHERE operacion_id = ?',
        [operacionId]
    );
    if (Number(existentes?.[0]?.cnt || 0) > 0) {
        const [rows] = await pool.query(
            `SELECT apartado, COUNT(*) AS cnt FROM pc_historial_ciclo_item
             WHERE operacion_id = ? GROUP BY apartado`,
            [operacionId]
        );
        const resumen = resumenVacio();
        for (const r of rows || []) incrementarResumen(resumen, r.apartado);
        return resumen;
    }

    const docs = Array.isArray(allDocs) ? allDocs : [];
    const padres = new Map();
    for (const d of docs) {
        if (!Number(d.documento_padre_id || 0) && !d.clave_workflow) {
            padres.set(Number(d.documento_id), d);
        }
    }

    const docIds = docs.map((d) => Number(d.documento_id)).filter(Boolean);
    const archivosPorDoc = await listarArchivosDeDocumentos(pool, docIds);
    const resumen = resumenVacio();
    const pipcTitulos = [];

    for (const padre of padres.values()) {
        const titulo = String(padre.nombre_documento || '').trim();
        if (titulo) pipcTitulos.push(titulo);
    }

    for (const doc of docs) {
        const clave = String(doc.clave_workflow || '').trim();
        const padreId = Number(doc.documento_padre_id || 0);
        const padre = padreId ? padres.get(padreId) : null;
        const apartado = clasificarApartadoPorClave(clave);
        const pipcTitulo = clave
            ? extraerPipcDeNombre(doc.nombre_documento) || (padre?.nombre_documento || '')
            : (padre?.nombre_documento || (padreId ? '' : doc.nombre_documento) || '');
        const grupo = pipcTitulo || doc.nombre_documento || 'Documentos';
        const tipoTexto = String(doc.tipo_entrada || '').toLowerCase() === 'texto';
        const valorTexto = String(doc.valor_texto || '').trim();
        const fechaRef = doc.fecha_subida || null;

        if (tipoTexto && valorTexto) {
            await insertarItem(pool, {
                operacion_id: operacionId,
                empresa_id: empresaId,
                apartado: clave ? apartado : 'documentacion',
                tipo_item: 'texto',
                pipc_titulo: pipcTitulo || null,
                nombre_documento: doc.nombre_documento || 'Campo de texto',
                valor_texto: valorTexto,
                clave_workflow: clave || null,
                grupo_titulo: grupo,
                fecha_referencia: fechaRef
            });
            incrementarResumen(resumen, clave ? apartado : 'documentacion');
            continue;
        }

        if (tipoTexto) continue;

        const extras = archivosPorDoc.get(Number(doc.documento_id)) || [];
        const archivos = extras.length
            ? extras
            : (esDriveIdValido(doc.archivo_url)
                ? [{
                    drive_file_id: doc.archivo_url,
                    nombre_archivo: doc.nombre_archivo,
                    mime_type: null,
                    fecha_subida: doc.fecha_subida
                }]
                : []);

        if (!archivos.length) continue;
        if (!clave && !padreId) continue;

        for (const archivo of archivos) {
            if (!esDriveIdValido(archivo.drive_file_id)) continue;
            await insertarItem(pool, {
                operacion_id: operacionId,
                empresa_id: empresaId,
                apartado,
                tipo_item: 'archivo',
                pipc_titulo: pipcTitulo || null,
                nombre_documento: doc.nombre_documento || 'Documento',
                nombre_archivo: archivo.nombre_archivo || doc.nombre_archivo || 'archivo',
                drive_file_id: archivo.drive_file_id,
                mime_type: archivo.mime_type || null,
                clave_workflow: clave || null,
                grupo_titulo: grupo,
                fecha_referencia: archivo.fecha_subida || fechaRef
            });
            incrementarResumen(resumen, apartado);
        }
    }

    let extras = [];
    try {
        const extraService = require('./pcDocumentacionExtraService');
        extras = await extraService.listarDocumentos(pool, empresaId);
    } catch {
        extras = [];
    }

    const inicioCiclo = ciclo.fecha_creacion ? new Date(ciclo.fecha_creacion).getTime() : 0;
    for (const extra of extras) {
        const created = extra.fechaSubida ? new Date(extra.fechaSubida).getTime() : 0;
        if (inicioCiclo && created && created < inicioCiclo) continue;
        await insertarItem(pool, {
            operacion_id: operacionId,
            empresa_id: empresaId,
            apartado: 'extra',
            tipo_item: 'archivo',
            nombre_documento: extra.titulo || extra.nombreArchivo || 'Documento extra',
            nombre_archivo: extra.nombreArchivo,
            drive_file_id: extra.driveFileId,
            mime_type: extra.mimeType,
            tamano_bytes: extra.tamanoBytes,
            grupo_titulo: extra.carpetaRelativa || 'Documentación Extra',
            fecha_referencia: extra.fechaSubida || null
        });
        incrementarResumen(resumen, 'extra');
    }

    await pool.query(
        `UPDATE pc_centro_operaciones
         SET historial_resumen = ?, pipc_titulos = ?, fecha_actualizacion = NOW()
         WHERE operacion_id = ?`,
        [JSON.stringify(resumen), JSON.stringify(pipcTitulos), operacionId]
    );

    return resumen;
}

async function limpiarDocumentosWorkflowTrasCierre(pool, empresaId) {
    const [rows] = await pool.query(
        `SELECT documento_id FROM documento_proteccion_civil
         WHERE empresa_id = ? AND clave_workflow IS NOT NULL AND TRIM(clave_workflow) <> ''`,
        [empresaId]
    );
    const ids = (rows || []).map((r) => Number(r.documento_id)).filter((id) => id > 0);
    if (!ids.length) return;
    try {
        await pool.query('DELETE FROM documento_proteccion_civil_archivo WHERE documento_id IN (?)', [ids]);
    } catch {
        // tabla puede no existir
    }
    await pool.query('DELETE FROM documento_proteccion_civil WHERE documento_id IN (?)', [ids]);
}

function mapEmpresaRow(e, extra = {}) {
    return {
        empresa_id: Number(e.empresa_id),
        nombre_empresa: e.nombre_empresa || 'Empresa sin nombre',
        rfc: e.rfc || '',
        estado: e.estado || '',
        ciudad: e.ciudad || '',
        logo: e.logo || null,
        logo_url: e.logo || null,
        total_ciclos: Number(extra.total_ciclos || 0),
        total_documentos: Number(extra.total_documentos || 0),
        ultima_fecha: extra.ultima_fecha || null
    };
}

async function listarEmpresasConHistorial(poolPC, poolBiznaga) {
    await ensureHistorialCicloTables(poolPC);

    const [ciclos] = await poolPC.query(`
        SELECT empresa_id,
               COUNT(*) AS total_ciclos,
               MAX(ciclo_cerrado_at) AS ultima_fecha
        FROM pc_centro_operaciones
        WHERE ciclo_cerrado_at IS NOT NULL
        GROUP BY empresa_id
    `);

    const [items] = await poolPC.query(`
        SELECT empresa_id, COUNT(*) AS total_documentos
        FROM pc_historial_ciclo_item
        GROUP BY empresa_id
    `);

    let historialLegacy = [];
    try {
        const [h] = await poolPC.query(`
            SELECT empresa_id, COUNT(*) AS total_documentos, MAX(fecha_creacion) AS ultima_fecha
            FROM historial_documentos_pc
            GROUP BY empresa_id
        `);
        historialLegacy = h || [];
    } catch {
        historialLegacy = [];
    }

    const porEmpresa = new Map();
    for (const row of ciclos || []) {
        porEmpresa.set(Number(row.empresa_id), {
            total_ciclos: Number(row.total_ciclos || 0),
            total_documentos: 0,
            ultima_fecha: row.ultima_fecha
        });
    }
    for (const row of items || []) {
        const id = Number(row.empresa_id);
        const cur = porEmpresa.get(id) || { total_ciclos: 0, total_documentos: 0, ultima_fecha: null };
        cur.total_documentos += Number(row.total_documentos || 0);
        porEmpresa.set(id, cur);
    }
    for (const row of historialLegacy) {
        const id = Number(row.empresa_id);
        const cur = porEmpresa.get(id) || { total_ciclos: 0, total_documentos: 0, ultima_fecha: null };
        if (cur.total_ciclos === 0) {
            cur.total_ciclos = 1;
            cur.total_documentos = Math.max(cur.total_documentos, Number(row.total_documentos || 0));
            cur.ultima_fecha = cur.ultima_fecha || row.ultima_fecha;
            porEmpresa.set(id, cur);
        }
    }

    const ids = [...porEmpresa.keys()];
    if (!ids.length) return [];

    const [empresas] = await poolBiznaga.query(
        `SELECT empresa_id, nombre_empresa, rfc, estado, ciudad, logo
         FROM empresa
         WHERE empresa_id IN (?) AND activo = TRUE
           AND COALESCE(servicio_proteccion_civil, 1) = 1`,
        [ids]
    );

    return (empresas || [])
        .map((e) => mapEmpresaRow(e, porEmpresa.get(Number(e.empresa_id))))
        .sort((a, b) => String(a.nombre_empresa).localeCompare(String(b.nombre_empresa), 'es'));
}

function mapCicloRow(row) {
    const resumen = parseJsonSafe(row.historial_resumen, resumenVacio());
    const pipcTitulos = parseJsonSafe(row.pipc_titulos, []);
    return {
        operacion_id: Number(row.operacion_id),
        empresa_id: Number(row.empresa_id),
        fecha_inicio: row.fecha_creacion,
        fecha_cierre: row.ciclo_cerrado_at,
        fecha_ingreso_tramite: row.fecha_ingreso_tramite,
        pasos_completados: parseJsonSafe(row.pasos_completados, []),
        pipc_titulos: Array.isArray(pipcTitulos) ? pipcTitulos : [],
        resumen,
        es_legacy: false
    };
}

async function listarCiclosEmpresa(poolPC, empresaId) {
    await ensureHistorialCicloTables(poolPC);
    const [rows] = await poolPC.query(
        `SELECT * FROM pc_centro_operaciones
         WHERE empresa_id = ? AND ciclo_cerrado_at IS NOT NULL
         ORDER BY ciclo_cerrado_at DESC, operacion_id DESC`,
        [empresaId]
    );
    const ciclos = (rows || []).map(mapCicloRow);

    if (!ciclos.length) {
        const legacy = await cargarFallbackLegacy(poolPC, empresaId);
        if (legacy) ciclos.push(legacy);
    }
    return ciclos;
}

async function cargarFallbackLegacy(poolPC, empresaId) {
    let docs = [];
    let textos = [];
    try {
        const [d] = await poolPC.query(
            `SELECT historial_id, nombre_documento, nombre_archivo, drive_file_id, mime_type, fecha_creacion
             FROM historial_documentos_pc WHERE empresa_id = ?`,
            [empresaId]
        );
        docs = d || [];
    } catch {
        docs = [];
    }
    try {
        const [t] = await poolPC.query(
            `SELECT historial_texto_id, nombre_documento_padre, nombre_campo, valor_texto, fecha_creacion
             FROM historial_textos_pc WHERE empresa_id = ?`,
            [empresaId]
        );
        textos = t || [];
    } catch {
        textos = [];
    }

    const total = docs.length + textos.length;
    if (!total) return null;

    const resumen = resumenVacio();
    for (const d of docs) incrementarResumen(resumen, clasificarApartadoPorNombre(d.nombre_documento));
    for (const t of textos) incrementarResumen(resumen, 'documentacion');

    const fechas = [...docs, ...textos]
        .map((x) => x.fecha_creacion)
        .filter(Boolean)
        .sort();

    return {
        operacion_id: 0,
        empresa_id: Number(empresaId),
        fecha_inicio: fechas[0] || null,
        fecha_cierre: fechas[fechas.length - 1] || null,
        fecha_ingreso_tramite: null,
        pasos_completados: ['finalizar'],
        pipc_titulos: [...new Set(docs.map((d) => d.nombre_documento).filter(Boolean))],
        resumen,
        es_legacy: true
    };
}

function mapItemRow(row) {
    return {
        item_id: Number(row.item_id),
        apartado: row.apartado,
        tipo_item: row.tipo_item,
        pipc_titulo: row.pipc_titulo || '',
        nombre_documento: row.nombre_documento,
        nombre_archivo: row.nombre_archivo || row.nombre_documento,
        valor_texto: row.valor_texto || null,
        drive_file_id: row.drive_file_id || null,
        mime_type: row.mime_type || null,
        tamano_bytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        grupo_titulo: row.grupo_titulo || row.pipc_titulo || row.nombre_documento,
        fecha_referencia: row.fecha_referencia || row.fecha_creacion
    };
}

async function obtenerDetalleCiclo(poolPC, empresaId, operacionId) {
    await ensureHistorialCicloTables(poolPC);
    const oid = Number(operacionId);

    if (oid === 0) {
        return armarDetalleLegacy(poolPC, empresaId);
    }

    const [ciclos] = await poolPC.query(
        `SELECT * FROM pc_centro_operaciones WHERE operacion_id = ? AND empresa_id = ? LIMIT 1`,
        [oid, empresaId]
    );
    if (!ciclos.length) return null;

    const [items] = await poolPC.query(
        `SELECT * FROM pc_historial_ciclo_item
         WHERE operacion_id = ? AND empresa_id = ?
         ORDER BY apartado ASC, grupo_titulo ASC, fecha_referencia DESC, item_id ASC`,
        [oid, empresaId]
    );

    let mapped = (items || []).map(mapItemRow);
    if (!mapped.length) {
        const legacy = await armarDetalleLegacy(poolPC, empresaId);
        if (legacy) {
            return { ciclo: mapCicloRow(ciclos[0]), ...legacy, usado_fallback: true };
        }
    }

    return {
        ciclo: mapCicloRow(ciclos[0]),
        items: mapped,
        usado_fallback: false
    };
}

async function armarDetalleLegacy(poolPC, empresaId) {
    const ciclo = await cargarFallbackLegacy(poolPC, empresaId);
    if (!ciclo) return { ciclo: null, items: [], usado_fallback: true };

    const items = [];
    try {
        const [docs] = await poolPC.query(
            `SELECT historial_id, nombre_documento, nombre_archivo, drive_file_id, mime_type, fecha_creacion
             FROM historial_documentos_pc WHERE empresa_id = ?`,
            [empresaId]
        );
        for (const d of docs || []) {
            const apartado = clasificarApartadoPorNombre(d.nombre_documento);
            items.push({
                item_id: Number(d.historial_id),
                apartado,
                tipo_item: 'archivo',
                pipc_titulo: d.nombre_documento || '',
                nombre_documento: d.nombre_documento,
                nombre_archivo: d.nombre_archivo,
                valor_texto: null,
                drive_file_id: d.drive_file_id,
                mime_type: d.mime_type,
                tamano_bytes: null,
                grupo_titulo: d.nombre_documento,
                fecha_referencia: d.fecha_creacion
            });
        }
    } catch { /* ignore */ }

    try {
        const [textos] = await poolPC.query(
            `SELECT historial_texto_id, nombre_documento_padre, nombre_campo, valor_texto, fecha_creacion
             FROM historial_textos_pc WHERE empresa_id = ?`,
            [empresaId]
        );
        for (const t of textos || []) {
            items.push({
                item_id: Number(t.historial_texto_id),
                apartado: 'documentacion',
                tipo_item: 'texto',
                pipc_titulo: t.nombre_documento_padre || '',
                nombre_documento: t.nombre_campo,
                nombre_archivo: t.nombre_campo,
                valor_texto: t.valor_texto,
                drive_file_id: null,
                mime_type: null,
                tamano_bytes: null,
                grupo_titulo: t.nombre_documento_padre || 'Textos capturados',
                fecha_referencia: t.fecha_creacion
            });
        }
    } catch { /* ignore */ }

    try {
        const extraService = require('./pcDocumentacionExtraService');
        const extras = await extraService.listarDocumentos(poolPC, empresaId);
        for (const extra of extras || []) {
            items.push({
                item_id: Number(extra.id) + 1000000,
                apartado: 'extra',
                tipo_item: 'archivo',
                pipc_titulo: '',
                nombre_documento: extra.titulo || extra.nombreArchivo,
                nombre_archivo: extra.nombreArchivo,
                valor_texto: null,
                drive_file_id: extra.driveFileId,
                mime_type: extra.mimeType,
                tamano_bytes: extra.tamanoBytes,
                grupo_titulo: extra.carpetaRelativa || 'Documentación Extra',
                fecha_referencia: extra.fechaSubida
            });
        }
    } catch { /* ignore */ }

    return { ciclo, items, usado_fallback: true };
}

function registerPcHistorialCicloRoutes(app, deps) {
    const {
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        handleError,
        getPoolBiznaga
    } = deps;

    async function resolvePool() {
        await deps.poolProteccionCivilReady;
        const pool = deps.getPoolProteccionCivil ? deps.getPoolProteccionCivil() : deps.poolProteccionCivil;
        if (!pool || typeof pool.query !== 'function') {
            throw new Error('Pool de proteccion_civil no disponible');
        }
        return pool;
    }

    app.get('/api/proteccion-civil/historial-pc/empresas', requireAdminOrPC, async (req, res) => {
        try {
            const poolPC = await resolvePool();
            await deps.poolReady;
            const poolBiznaga = getPoolBiznaga();
            const empresas = await listarEmpresasConHistorial(poolPC, poolBiznaga);
            res.json({ success: true, empresas });
        } catch (error) {
            handleError(res, error, 'Error al listar empresas del historial PC');
        }
    });

    app.get(
        '/api/proteccion-civil/empresas/:empresaId/historial-pc/ciclos',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const poolPC = await resolvePool();
                const empresaId = Number(req.params.empresaId);
                const ciclos = await listarCiclosEmpresa(poolPC, empresaId);
                res.json({ success: true, ciclos });
            } catch (error) {
                handleError(res, error, 'Error al listar ciclos del historial PC');
            }
        }
    );

    app.get(
        '/api/proteccion-civil/empresas/:empresaId/historial-pc/ciclos/:operacionId',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const poolPC = await resolvePool();
                const empresaId = Number(req.params.empresaId);
                const operacionId = Number(req.params.operacionId);
                const detalle = await obtenerDetalleCiclo(poolPC, empresaId, operacionId);
                if (!detalle) {
                    return res.status(404).json({ success: false, message: 'Ciclo no encontrado' });
                }
                res.json({ success: true, ...detalle });
            } catch (error) {
                handleError(res, error, 'Error al obtener detalle del historial PC');
            }
        }
    );
}

module.exports = {
    APARTADOS,
    ensureHistorialCicloTables,
    snapshotCicloAlCerrar,
    limpiarDocumentosWorkflowTrasCierre,
    listarEmpresasConHistorial,
    listarCiclosEmpresa,
    obtenerDetalleCiclo,
    registerPcHistorialCicloRoutes
};
