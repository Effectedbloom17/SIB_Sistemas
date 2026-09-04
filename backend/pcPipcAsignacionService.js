/**
 * Sincronización de requisitos PIPC: plantilla completa del Excel + visibilidad empresa.
 */
const {
    normalizarNombreDocumentoPipc,
    normalizarClaveDocumentoPipc,
    parsearPlantillaPipcDesdeWorksheet,
    resolverWorksheetEnWorkbook
} = require('./pcPipcParser');

function mapaVisibilidadDesdeChecklist(itemsChecklist = []) {
    const mapa = new Map();
    for (const item of itemsChecklist) {
        const nombre = normalizarNombreDocumentoPipc(item?.nombre || item?.documento || '');
        if (!nombre) continue;
        const clave = normalizarClaveDocumentoPipc(nombre);
        let visibleEmpresa = false;
        if (item.visible_empresa !== undefined && item.visible_empresa !== null) {
            visibleEmpresa = item.visible_empresa === true || item.visible_empresa === 1;
        } else if (item.necesario !== undefined && item.necesario !== null) {
            visibleEmpresa = item.necesario !== false && item.necesario !== 0;
        }
        mapa.set(clave, visibleEmpresa);
    }
    return mapa;
}

async function parsearFilasCompletasDesdeCatalogo(driveService, docRef, nombrePlantilla = '') {
    if (!docRef?.drive_file_id) {
        return [];
    }

    const ExcelJS = require('exceljs');
    const buffer = await driveService.exportarArchivoXLSX(docRef.drive_file_id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const hojaNombre = docRef.hoja_nombre || nombrePlantilla;
    const worksheet = resolverWorksheetEnWorkbook(workbook, hojaNombre);

    if (!worksheet) {
        return [];
    }

    const parseado = parsearPlantillaPipcDesdeWorksheet(worksheet, { hojaNombre });
    const filasBase = parseado.filas?.length
        ? parseado.filas
        : (parseado.items || []).map((item) => ({
            nombre: item.documento,
            especificacion: item.especificacion,
            obligatorio: item.obligatorio,
            tipo_entrada: item.tipo_entrada
        }));

    return filasBase
        .map((item) => ({
            nombre: normalizarNombreDocumentoPipc(item.nombre || item.documento),
            especificacion: String(item.especificacion || '').trim(),
            obligatorio: item.obligatorio !== false,
            tipo_entrada: item.tipo_entrada || 'archivo'
        }))
        .filter((item) => item.nombre);
}

async function construirFilasCompletasDesdeDoc(driveService, docRef, nombrePlantilla = '') {
    const mapaVisibilidad = mapaVisibilidadDesdeChecklist(docRef.items_checklist || []);
    const filasPlantilla = await parsearFilasCompletasDesdeCatalogo(driveService, docRef, nombrePlantilla);

    if (!filasPlantilla.length && Array.isArray(docRef.items_checklist) && docRef.items_checklist.length) {
        return docRef.items_checklist
            .map((item) => ({
                nombre: normalizarNombreDocumentoPipc(item?.nombre || item?.documento || ''),
                especificacion: String(item.especificacion || '').trim(),
                obligatorio: item.obligatorio !== false,
                tipo_entrada: item.tipo_entrada || 'archivo',
                visible_empresa: mapaVisibilidad.get(
                    normalizarClaveDocumentoPipc(
                        normalizarNombreDocumentoPipc(item?.nombre || item?.documento || '')
                    )
                ) ?? false
            }))
            .filter((item) => item.nombre);
    }

    return filasPlantilla.map((fila) => {
        const clave = normalizarClaveDocumentoPipc(fila.nombre);
        let visibleEmpresa = false;
        if (mapaVisibilidad.size === 0) {
            visibleEmpresa = true;
        } else if (mapaVisibilidad.has(clave)) {
            visibleEmpresa = mapaVisibilidad.get(clave);
        }
        return {
            ...fila,
            visible_empresa: visibleEmpresa
        };
    });
}

function requisitoTieneEntrega(doc) {
    const archivo = String(doc.archivo_url || '').trim();
    const texto = String(doc.valor_texto || '').trim();
    return archivo.length > 5 || texto.length > 0;
}

function puedeActualizarTipoEntradaDesdeCatalogo(hijo, tipoCatalogo) {
    if (String(hijo.estatus || '').toLowerCase() !== 'pendiente') {
        return false;
    }
    if (requisitoTieneEntrega(hijo)) {
        return false;
    }
    const tipoActual = String(hijo.tipo_entrada || 'archivo').toLowerCase();
    const tipoNuevo = String(tipoCatalogo || 'archivo').toLowerCase();
    return tipoActual !== tipoNuevo;
}

function mapaTiposDesdeFilasPlantilla(filasPlantilla = []) {
    return new Map(
        filasPlantilla.map((fila) => [
            normalizarClaveDocumentoPipc(fila.nombre),
            fila.tipo_entrada || 'archivo'
        ])
    );
}

async function leerMapaTiposEntradaCatalogo({
    poolProteccionCivil,
    driveService,
    catalogoDocumentoId,
    repararDriveDoc = null
}) {
    if (!catalogoDocumentoId) {
        return new Map();
    }

    const [catRows] = await poolProteccionCivil.query(
        `SELECT documento_id, nombre, drive_file_id, mime_type, hoja_nombre, archivo_maestro_nombre
         FROM pc_catalogo_documento
         WHERE documento_id = ? AND activo = 1
         LIMIT 1`,
        [catalogoDocumentoId]
    );
    if (!catRows.length) {
        return new Map();
    }

    let cat = { ...catRows[0] };
    let filasPlantilla = [];

    const intentarLeer = async () => {
        if (!cat.drive_file_id) {
            return [];
        }
        return construirFilasCompletasDesdeDoc(
            driveService,
            {
                drive_file_id: cat.drive_file_id,
                hoja_nombre: cat.hoja_nombre || cat.nombre,
                items_checklist: []
            },
            cat.hoja_nombre || cat.nombre
        );
    };

    try {
        filasPlantilla = await intentarLeer();
    } catch (lecturaErr) {
        console.warn(
            `[PC-SYNC] No se pudo leer plantilla catalogo_id=${catalogoDocumentoId}:`,
            lecturaErr.message
        );
    }

    if (!filasPlantilla.length && typeof repararDriveDoc === 'function') {
        try {
            const reparado = await repararDriveDoc(cat);
            if (reparado?.fileId) {
                cat.drive_file_id = reparado.fileId;
                cat.mime_type = reparado.mimeType || cat.mime_type;
                await poolProteccionCivil.query(
                    `UPDATE pc_catalogo_documento SET
                        drive_file_id = ?,
                        mime_type = COALESCE(?, mime_type),
                        drive_web_view_link = COALESCE(?, drive_web_view_link),
                        drive_download_link = COALESCE(?, drive_download_link),
                        fecha_actualizacion = NOW()
                     WHERE documento_id = ?`,
                    [
                        reparado.fileId,
                        reparado.mimeType || null,
                        reparado.webViewLink || null,
                        reparado.webContentLink || null,
                        cat.documento_id
                    ]
                );
                filasPlantilla = await intentarLeer();
            }
        } catch (repararErr) {
            console.warn(
                `[PC-SYNC] No se pudo reparar drive catalogo_id=${catalogoDocumentoId}:`,
                repararErr.message
            );
        }
    }

    return mapaTiposDesdeFilasPlantilla(filasPlantilla);
}

function aplicarTiposEntradaDesdeMapasEnDocumentos(docs = [], padreCatalogoPorId = new Map(), mapasPorCatalogo = new Map()) {
    if (!Array.isArray(docs) || !docs.length || !mapasPorCatalogo.size) {
        return { aplicados: 0 };
    }

    let aplicados = 0;
    for (const doc of docs) {
        const padreId = Number(doc.documento_padre_id || 0);
        if (!padreId) {
            continue;
        }

        const catalogoId = padreCatalogoPorId.get(padreId);
        if (!catalogoId) {
            continue;
        }

        const mapaTipos = mapasPorCatalogo.get(catalogoId);
        if (!mapaTipos?.size) {
            continue;
        }

        const clave = normalizarClaveDocumentoPipc(doc.nombre_documento);
        const tipoCatalogo = mapaTipos.get(clave);
        if (!tipoCatalogo) {
            continue;
        }

        const tipoActual = String(doc.tipo_entrada || 'archivo').toLowerCase();
        const tipoNuevo = String(tipoCatalogo || 'archivo').toLowerCase();
        if (tipoActual === tipoNuevo) {
            continue;
        }

        doc.tipo_entrada = tipoNuevo;
        if (tipoNuevo === 'archivo') {
            doc.autollenado = false;
        }
        aplicados += 1;
    }

    return { aplicados };
}

async function sincronizarTipoEntradaPendientesDesdeCatalogo({
    poolProteccionCivil,
    driveService,
    catalogoDocumentoId,
    empresaId = null,
    repararDriveDoc = null,
    mapaTiposPrecargado = null
}) {
    if (!catalogoDocumentoId) {
        return { actualizados: 0, padres: 0 };
    }

    const mapaTipos = mapaTiposPrecargado instanceof Map && mapaTiposPrecargado.size
        ? mapaTiposPrecargado
        : await leerMapaTiposEntradaCatalogo({
            poolProteccionCivil,
            driveService,
            catalogoDocumentoId,
            repararDriveDoc
        });

    if (!mapaTipos.size) {
        return { actualizados: 0, padres: 0 };
    }

    const [padres] = await poolProteccionCivil.query(
        `SELECT documento_id
         FROM documento_proteccion_civil
         WHERE catalogo_documento_id = ?
           AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           ${empresaId ? 'AND empresa_id = ?' : ''}`,
        empresaId ? [catalogoDocumentoId, Number(empresaId)] : [catalogoDocumentoId]
    );
    if (!padres.length) {
        return { actualizados: 0, padres: 0 };
    }

    let actualizados = 0;
    for (const padre of padres) {
        const [hijos] = await poolProteccionCivil.query(
            `SELECT documento_id, nombre_documento, estatus, tipo_entrada, archivo_url, valor_texto
             FROM documento_proteccion_civil
             WHERE documento_padre_id = ?`,
            [padre.documento_id]
        );

        for (const hijo of hijos) {
            const clave = normalizarClaveDocumentoPipc(hijo.nombre_documento);
            const tipoCatalogo = mapaTipos.get(clave);
            if (!tipoCatalogo) continue;
            if (!puedeActualizarTipoEntradaDesdeCatalogo(hijo, tipoCatalogo)) continue;

            await poolProteccionCivil.query(
                `UPDATE documento_proteccion_civil
                 SET tipo_entrada = ?, fecha_actualizacion = NOW()
                 WHERE documento_id = ?`,
                [tipoCatalogo, hijo.documento_id]
            );
            actualizados += 1;
        }
    }

    return { actualizados, padres: padres.length, mapaTipos };
}

async function sincronizarTiposEntradaEmpresaDesdeCatalogo({
    poolProteccionCivil,
    driveService,
    empresaId,
    repararDriveDoc = null
}) {
    const empresa = Number(empresaId);
    if (!empresa) {
        return {
            actualizados: 0,
            mapasPorCatalogo: new Map(),
            padreCatalogoPorId: new Map()
        };
    }

    const [catalogosEmpresa] = await poolProteccionCivil.query(
        `SELECT DISTINCT catalogo_documento_id
         FROM documento_proteccion_civil
         WHERE empresa_id = ?
           AND catalogo_documento_id IS NOT NULL
           AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           AND (clave_workflow IS NULL OR clave_workflow = '')`,
        [empresa]
    );

    const [padresEmpresa] = await poolProteccionCivil.query(
        `SELECT documento_id, catalogo_documento_id
         FROM documento_proteccion_civil
         WHERE empresa_id = ?
           AND catalogo_documento_id IS NOT NULL
           AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           AND (clave_workflow IS NULL OR clave_workflow = '')`,
        [empresa]
    );

    const padreCatalogoPorId = new Map(
        padresEmpresa.map((padre) => [Number(padre.documento_id), Number(padre.catalogo_documento_id)])
    );
    const mapasPorCatalogo = new Map();
    let actualizados = 0;

    for (const catRow of catalogosEmpresa) {
        const catalogoId = Number(catRow.catalogo_documento_id);
        if (!catalogoId) {
            continue;
        }

        let mapaTipos = mapasPorCatalogo.get(catalogoId);
        if (!mapaTipos) {
            mapaTipos = await leerMapaTiposEntradaCatalogo({
                poolProteccionCivil,
                driveService,
                catalogoDocumentoId: catalogoId,
                repararDriveDoc
            });
            mapasPorCatalogo.set(catalogoId, mapaTipos);
        }

        const sync = await sincronizarTipoEntradaPendientesDesdeCatalogo({
            poolProteccionCivil,
            driveService,
            catalogoDocumentoId: catalogoId,
            empresaId: empresa,
            mapaTiposPrecargado: mapaTipos
        });
        actualizados += sync.actualizados || 0;
    }

    return { actualizados, mapasPorCatalogo, padreCatalogoPorId };
}

async function sincronizarTipoEntradaPorDriveFileId({
    poolProteccionCivil,
    driveService,
    driveFileId
}) {
    if (!driveFileId) {
        return { actualizados: 0, hojas: 0 };
    }

    const [hojas] = await poolProteccionCivil.query(
        `SELECT documento_id
         FROM pc_catalogo_documento
         WHERE drive_file_id = ? AND activo = 1`,
        [driveFileId]
    );

    let actualizados = 0;
    for (const hoja of hojas) {
        const resultado = await sincronizarTipoEntradaPendientesDesdeCatalogo({
            poolProteccionCivil,
            driveService,
            catalogoDocumentoId: hoja.documento_id
        });
        actualizados += resultado.actualizados;
    }

    return { actualizados, hojas: hojas.length };
}

async function insertarRequisitosFaltantesPadrePipc({
    poolProteccionCivil,
    driveService,
    empresaId,
    padreId,
    padreNombre,
    catalogoDocumentoId,
    asignadoPorUsuarioId = null,
    actualizarVisibilidad = false,
    filasVisibilidad = null
}) {
    if (!padreId) {
        return { insertados: 0, actualizados: 0, totalPlantilla: 0 };
    }

    let filasPlantilla = Array.isArray(filasVisibilidad) && filasVisibilidad.length ? filasVisibilidad : [];

    if (!filasPlantilla.length && catalogoDocumentoId) {
        const [catRows] = await poolProteccionCivil.query(
            `SELECT documento_id, nombre, drive_file_id, mime_type, hoja_nombre
             FROM pc_catalogo_documento
             WHERE documento_id = ? AND activo = 1
             LIMIT 1`,
            [catalogoDocumentoId]
        );
        if (!catRows.length || !catRows[0].drive_file_id) {
            return { insertados: 0, actualizados: 0, totalPlantilla: 0 };
        }
        const cat = catRows[0];
        filasPlantilla = await construirFilasCompletasDesdeDoc(
            driveService,
            {
                drive_file_id: cat.drive_file_id,
                hoja_nombre: cat.hoja_nombre || padreNombre,
                items_checklist: []
            },
            padreNombre
        );
    }

    if (!filasPlantilla.length) {
        return { insertados: 0, actualizados: 0, totalPlantilla: 0 };
    }

    const [hijosActuales] = await poolProteccionCivil.query(
        `SELECT documento_id, nombre_documento, visible_empresa, estatus, tipo_entrada, archivo_url, valor_texto
         FROM documento_proteccion_civil
         WHERE documento_padre_id = ?`,
        [padreId]
    );

    const hijosPorClave = new Map(
        hijosActuales.map((row) => [normalizarClaveDocumentoPipc(row.nombre_documento), row])
    );

    let insertados = 0;
    let actualizados = 0;
    const values = [];

    for (const fila of filasPlantilla) {
        const clave = normalizarClaveDocumentoPipc(fila.nombre);
        const existente = hijosPorClave.get(clave);
        if (existente) {
            if (actualizarVisibilidad && Number(existente.visible_empresa) !== (fila.visible_empresa ? 1 : 0)) {
                await poolProteccionCivil.query(
                    'UPDATE documento_proteccion_civil SET visible_empresa = ?, fecha_actualizacion = NOW() WHERE documento_id = ?',
                    [fila.visible_empresa ? 1 : 0, existente.documento_id]
                );
                actualizados += 1;
            }
            if (puedeActualizarTipoEntradaDesdeCatalogo(existente, fila.tipo_entrada || 'archivo')) {
                await poolProteccionCivil.query(
                    `UPDATE documento_proteccion_civil
                     SET tipo_entrada = ?, fecha_actualizacion = NOW()
                     WHERE documento_id = ?`,
                    [fila.tipo_entrada || 'archivo', existente.documento_id]
                );
                actualizados += 1;
            }
            continue;
        }

        const visibleInsert = actualizarVisibilidad && fila.visible_empresa !== undefined
            ? (fila.visible_empresa ? 1 : 0)
            : 0;

        values.push([
            empresaId,
            padreId,
            fila.nombre,
            fila.especificacion || '',
            fila.obligatorio !== false ? 1 : 0,
            visibleInsert,
            fila.tipo_entrada || 'archivo',
            'pendiente',
            asignadoPorUsuarioId,
            new Date(),
            new Date()
        ]);
    }

    if (values.length) {
        await poolProteccionCivil.query(`
            INSERT INTO documento_proteccion_civil
                (empresa_id, documento_padre_id, nombre_documento, especificacion, obligatorio, visible_empresa, tipo_entrada, estatus, asignado_por_usuario_id, fecha_asignacion, fecha_creacion)
            VALUES ?
        `, [values]);
        insertados = values.length;
    }

    return { insertados, actualizados, totalPlantilla: filasPlantilla.length };
}

function esSubtituloOperativoPcNombre(nombre = '') {
    const n = String(nombre)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    return n === 'fisico' || n === 'usb' || n === 'presentar';
}

/**
 * Elimina padres PIPC sin requisitos reales (asignaciones huérfanas o canceladas parcialmente).
 * Corrige registros históricos que bloquean «Asignar documentos».
 */
async function repararPadresPipcHuerfanos(poolProteccionCivil, empresaId) {
    const empresa = Number(empresaId);
    if (!empresa) {
        return { eliminados: 0, padre_ids: [] };
    }

    const [padres] = await poolProteccionCivil.query(
        `SELECT documento_id, catalogo_documento_id, nombre_documento
         FROM documento_proteccion_civil
         WHERE empresa_id = ?
           AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           AND catalogo_documento_id IS NOT NULL
           AND (clave_workflow IS NULL OR clave_workflow = '')`,
        [empresa]
    );

    const padreIdsEliminados = [];

    for (const padre of padres) {
        const [hijos] = await poolProteccionCivil.query(
            `SELECT documento_id, nombre_documento
             FROM documento_proteccion_civil
             WHERE documento_padre_id = ?`,
            [padre.documento_id]
        );
        const hijosReales = hijos.filter((hijo) => !esSubtituloOperativoPcNombre(hijo.nombre_documento));
        if (hijosReales.length > 0) {
            continue;
        }

        if (hijos.length > 0) {
            await poolProteccionCivil.query(
                'DELETE FROM documento_proteccion_civil WHERE documento_padre_id = ?',
                [padre.documento_id]
            );
        }
        await poolProteccionCivil.query(
            'DELETE FROM documento_proteccion_civil WHERE documento_id = ?',
            [padre.documento_id]
        );
        padreIdsEliminados.push(padre.documento_id);
    }

    return { eliminados: padreIdsEliminados.length, padre_ids: padreIdsEliminados };
}

module.exports = {
    mapaVisibilidadDesdeChecklist,
    parsearFilasCompletasDesdeCatalogo,
    construirFilasCompletasDesdeDoc,
    insertarRequisitosFaltantesPadrePipc,
    leerMapaTiposEntradaCatalogo,
    aplicarTiposEntradaDesdeMapasEnDocumentos,
    sincronizarTipoEntradaPendientesDesdeCatalogo,
    sincronizarTiposEntradaEmpresaDesdeCatalogo,
    sincronizarTipoEntradaPorDriveFileId,
    repararPadresPipcHuerfanos,
    esSubtituloOperativoPcNombre
};

