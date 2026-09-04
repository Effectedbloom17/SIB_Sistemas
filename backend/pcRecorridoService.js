/**
 * Reportes de recorrido (SP-F-02) por empresa/PIPC en Protección Civil.
 * Persistencia en BD proteccion_civil + sincronización con Google Drive por empresa.
 */
const driveService = require('./driveService');
const sgcSpF02Service = require('./sgcSpF02Service');
const { listarPipcAsignadosActivos, obtenerCicloActivo } = require('./pcCentroOperaciones');

/** Historial SP-F-02 en Drive (Protección Civil): carpeta raíz por empresa. */
const CARPETA_PC_RECORRIDO_RAIZ_ID = '1Yo_NbcXSoNKn7LnvUvhiZX8zvB1-w-9d';
/** Plantilla SP-F-02 con logo Biznaga (misma que SGC). */
const PC_TEMPLATE_DRIVE_ID = '1lZOjlr7PAvoudcOJF5Qz28x3ok88UUEb32L1YnxUAZI';
const CARPETA_IMAGENES_RECORRIDO_NOMBRE = 'Imagenes de Recorrido';
const CARPETA_REPORTE_RECORRIDO_PDF_NOMBRE = 'Reporte de Recorrido';
const MODOS_CAPTURA_VALIDOS = new Set(['manual', 'pdf']);

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `pc-rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function parseJson(raw, fallback = null) {
    if (!raw) return fallback;
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return obj && typeof obj === 'object' ? obj : fallback;
    } catch {
        return fallback;
    }
}

async function ensureTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_recorrido_drive (
            drive_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            empresa_id INT UNSIGNED NOT NULL,
            operacion_id INT UNSIGNED NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            nombre_archivo VARCHAR(255) NULL,
            ultima_sync DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (drive_id),
            UNIQUE KEY uq_pc_rec_drive_empresa_ops (empresa_id, operacion_id),
            KEY idx_pc_rec_drive_empresa (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_recorrido_reporte (
            recorrido_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            empresa_id INT UNSIGNED NOT NULL,
            operacion_id INT UNSIGNED NOT NULL,
            documento_pipc_id INT UNSIGNED NOT NULL,
            reporte_uuid VARCHAR(64) NOT NULL,
            folio VARCHAR(32) NULL,
            nombre_hoja VARCHAR(64) NULL,
            datos_json JSON NOT NULL,
            guardado TINYINT(1) NOT NULL DEFAULT 0,
            drive_sync_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (recorrido_id),
            UNIQUE KEY uq_pc_rec_pipc_ciclo (operacion_id, documento_pipc_id),
            UNIQUE KEY uq_pc_rec_uuid (reporte_uuid),
            KEY idx_pc_rec_empresa (empresa_id),
            KEY idx_pc_rec_pipc (documento_pipc_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try {
        await pool.query(`
            ALTER TABLE pc_recorrido_reporte
            ADD COLUMN drive_file_id VARCHAR(128) NULL AFTER nombre_hoja
        `);
    } catch {
        /* columna ya existe */
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_recorrido_modo (
            operacion_id INT UNSIGNED NOT NULL,
            empresa_id INT UNSIGNED NOT NULL,
            modo ENUM('manual','pdf') NOT NULL DEFAULT 'manual',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (operacion_id),
            KEY idx_pc_rec_modo_empresa (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_recorrido_pdf (
            pdf_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            empresa_id INT UNSIGNED NOT NULL,
            operacion_id INT UNSIGNED NOT NULL,
            documento_pipc_id INT UNSIGNED NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            nombre_archivo VARCHAR(255) NOT NULL,
            drive_view_url VARCHAR(512) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (pdf_id),
            KEY idx_pc_rec_pdf_pipc (operacion_id, documento_pipc_id),
            KEY idx_pc_rec_pdf_empresa (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try {
        await pool.query('ALTER TABLE pc_recorrido_pdf DROP INDEX uq_pc_rec_pdf_pipc_ciclo');
    } catch {
        /* índice único ya eliminado o no existía */
    }
    try {
        await pool.query('ALTER TABLE pc_recorrido_pdf ADD KEY idx_pc_rec_pdf_pipc (operacion_id, documento_pipc_id)');
    } catch {
        /* índice ya existe */
    }
}

async function obtenerNombrePipc(pool, documentoPipcId) {
    const [rows] = await pool.query(
        'SELECT nombre_documento FROM documento_proteccion_civil WHERE documento_id = ? LIMIT 1',
        [documentoPipcId]
    );
    return String(rows[0]?.nombre_documento || '').trim();
}

function sanitizarNombreCarpetaPipc(nombre, documentoId) {
    const base = String(nombre || 'PIPC').trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 100);
    return base || `PIPC-${documentoId}`;
}

function sanitizarNombreCarpetaEmpresa(nombre, empresaId) {
    const base = String(nombre || `Empresa ${empresaId}`).trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 100);
    return base || `Empresa-${empresaId}`;
}

async function resolverCarpetaEmpresa(poolBiznaga, empresaId) {
    const nombre = await obtenerNombreEmpresa(poolBiznaga, empresaId);
    const carpetaNombre = sanitizarNombreCarpetaEmpresa(nombre, empresaId);
    return driveService.obtenerOCrearCarpeta(carpetaNombre, CARPETA_PC_RECORRIDO_RAIZ_ID);
}

async function resolverCarpetaImagenesRecorrido(poolBiznaga, empresaId) {
    const carpetaEmpresaId = await resolverCarpetaEmpresa(poolBiznaga, empresaId);
    return driveService.obtenerOCrearCarpeta(CARPETA_IMAGENES_RECORRIDO_NOMBRE, carpetaEmpresaId);
}

async function resolverCarpetaReporteRecorridoPdf(poolBiznaga, empresaId) {
    const carpetaEmpresaId = await resolverCarpetaEmpresa(poolBiznaga, empresaId);
    return driveService.obtenerOCrearCarpeta(CARPETA_REPORTE_RECORRIDO_PDF_NOMBRE, carpetaEmpresaId);
}

async function obtenerModoCaptura(pool, operacionId) {
    const [rows] = await pool.query(
        'SELECT modo FROM pc_recorrido_modo WHERE operacion_id = ? LIMIT 1',
        [operacionId]
    );
    const modo = String(rows[0]?.modo || 'manual').trim().toLowerCase();
    return MODOS_CAPTURA_VALIDOS.has(modo) ? modo : 'manual';
}

async function establecerModoCaptura(pool, empresaId, operacionId, modoRaw) {
    const modo = String(modoRaw || '').trim().toLowerCase();
    if (!MODOS_CAPTURA_VALIDOS.has(modo)) {
        const err = new Error('Modo inválido. Use "manual" o "pdf".');
        err.statusCode = 400;
        throw err;
    }
    await pool.query(
        `INSERT INTO pc_recorrido_modo (operacion_id, empresa_id, modo)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE modo = VALUES(modo), updated_at = NOW()`,
        [operacionId, empresaId, modo]
    );
    return modo;
}

function mapPdfRow(row) {
    if (!row) return null;
    const driveFileId = String(row.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        pdf_id: Number(row.pdf_id) || null,
        drive_file_id: driveFileId,
        nombre_archivo: String(row.nombre_archivo || 'reporte-recorrido.pdf').trim(),
        drive_view_url: row.drive_view_url
            || `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`,
        subido_at: row.updated_at || row.created_at || null
    };
}

function agruparPdfsPorPipc(pdfRows = []) {
    const porPipc = new Map();
    for (const row of pdfRows) {
        const mapped = mapPdfRow(row);
        if (!mapped) continue;
        const pipcId = Number(row.documento_pipc_id);
        if (!porPipc.has(pipcId)) {
            porPipc.set(pipcId, []);
        }
        porPipc.get(pipcId).push(mapped);
    }
    for (const lista of porPipc.values()) {
        lista.sort((a, b) => String(b.subido_at || '').localeCompare(String(a.subido_at || '')));
    }
    return porPipc;
}

async function listarPdfsRecorrido(pool, empresaId, operacionId) {
    const [rows] = await pool.query(
        `SELECT * FROM pc_recorrido_pdf
         WHERE empresa_id = ? AND operacion_id = ?
         ORDER BY updated_at DESC`,
        [empresaId, operacionId]
    );
    return rows.map(mapPdfRow).filter(Boolean);
}

function sanitizarNombrePdfRecorrido(nombrePipc, documentoPipcId, nombreOriginal) {
    const basePipc = sanitizarNombreCarpetaPipc(nombrePipc, documentoPipcId);
    const original = String(nombreOriginal || 'reporte-recorrido.pdf').trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ');
    const conPdf = /\.pdf$/i.test(original) ? original : `${original}.pdf`;
    return `${basePipc} — ${conPdf}`.slice(0, 180);
}

async function subirPdfRecorridoPipc(pool, poolBiznaga, empresaId, operacionId, documentoPipcId, fileBuffer, nombreOriginal) {
    if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
        const err = new Error('No se recibió el archivo PDF.');
        err.statusCode = 400;
        throw err;
    }
    if (fileBuffer.length > 25 * 1024 * 1024) {
        const err = new Error('El PDF no puede superar 25 MB.');
        err.statusCode = 400;
        throw err;
    }

    const header = fileBuffer.slice(0, 5).toString('ascii');
    if (!header.startsWith('%PDF-')) {
        const err = new Error('Solo se permiten archivos PDF.');
        err.statusCode = 400;
        throw err;
    }

    const nombrePipc = await obtenerNombrePipc(pool, documentoPipcId);
    const carpetaId = await resolverCarpetaReporteRecorridoPdf(poolBiznaga, empresaId);
    const nombreArchivo = sanitizarNombrePdfRecorrido(nombrePipc, documentoPipcId, nombreOriginal);

    const resultado = await driveService.subirArchivoNuevo(
        fileBuffer,
        nombreArchivo,
        'application/pdf',
        carpetaId
    );
    const driveFileId = String(resultado?.id || '').trim();
    if (!driveFileId) {
        throw new Error('No se pudo subir el PDF a Google Drive.');
    }

    const driveViewUrl = `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
    const [insertResult] = await pool.query(
        `INSERT INTO pc_recorrido_pdf
            (empresa_id, operacion_id, documento_pipc_id, drive_file_id, nombre_archivo, drive_view_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [empresaId, operacionId, documentoPipcId, driveFileId, nombreArchivo, driveViewUrl]
    );

    await establecerModoCaptura(pool, empresaId, operacionId, 'pdf');

    return {
        pdf: {
            pdf_id: insertResult?.insertId || null,
            drive_file_id: driveFileId,
            nombre_archivo: nombreArchivo,
            drive_view_url: driveViewUrl,
            carpeta_id: carpetaId,
            carpeta_nombre: CARPETA_REPORTE_RECORRIDO_PDF_NOMBRE
        }
    };
}

async function eliminarPdfRecorrido(pool, poolBiznaga, empresaId, operacionId, pdfId) {
    const id = Number(pdfId);
    if (!id) {
        const err = new Error('Identificador de PDF inválido.');
        err.statusCode = 400;
        throw err;
    }

    const [rows] = await pool.query(
        `SELECT pdf_id, drive_file_id FROM pc_recorrido_pdf
         WHERE pdf_id = ? AND empresa_id = ? AND operacion_id = ? LIMIT 1`,
        [id, empresaId, operacionId]
    );
    if (!rows[0]) {
        const err = new Error('PDF no encontrado.');
        err.statusCode = 404;
        throw err;
    }

    const driveFileId = String(rows[0].drive_file_id || '').trim();
    if (driveFileId) {
        try {
            await driveService.eliminarArchivo(driveFileId);
        } catch (err) {
            console.warn('[PC Recorrido] No se pudo eliminar PDF en Drive:', err.message);
        }
    }

    await pool.query('DELETE FROM pc_recorrido_pdf WHERE pdf_id = ?', [id]);
    return { eliminado: true, pdf_id: id };
}

async function resolverCarpetaImagenesPipc(pool, poolBiznaga, empresaId, documentoPipcId) {
    const carpetaImagenesId = await resolverCarpetaImagenesRecorrido(poolBiznaga, empresaId);
    const nombre = await obtenerNombrePipc(pool, documentoPipcId);
    const carpetaNombre = sanitizarNombreCarpetaPipc(nombre, documentoPipcId);
    return driveService.obtenerOCrearCarpeta(carpetaNombre, carpetaImagenesId);
}

async function subirImagenItemRecorrido(pool, poolBiznaga, empresaId, documentoPipcId, body = {}) {
    const campo = String(body.campo || '').trim().toLowerCase();
    if (!['problema', 'observaciones'].includes(campo)) {
        const err = new Error('Campo inválido. Use "problema" u "observaciones".');
        err.statusCode = 400;
        throw err;
    }

    const imagenBase64 = String(body.imagen_base64 || body.imagenBase64 || '').trim();
    if (!imagenBase64) {
        const err = new Error('No se recibió la imagen (imagen_base64 requerido).');
        err.statusCode = 400;
        throw err;
    }

    const buffer = Buffer.from(imagenBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) {
        const err = new Error('La imagen está vacía.');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > 12 * 1024 * 1024) {
        const err = new Error('La imagen no puede superar 12 MB.');
        err.statusCode = 400;
        throw err;
    }

    let procesada;
    try {
        const sharp = require('sharp');
        const imagen = sharp(buffer).rotate();
        const normalizado = await imagen
            .clone()
            .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();
        const thumb = await sharp(normalizado)
            .resize(160, 120, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer();
        procesada = {
            buffer: normalizado,
            mimeType: 'image/jpeg',
            thumbDataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}`
        };
    } catch (_err) {
        const err = new Error('No se pudo procesar la imagen.');
        err.statusCode = 400;
        throw err;
    }

    const itemIndex = Math.max(0, Number(body.item_index ?? body.itemIndex ?? 0));
    const slotIndex = Math.max(0, Number(body.slot_index ?? body.slotIndex ?? 0));
    const nombreArchivo = String(body.nombre_archivo || body.nombreArchivo || '').trim()
        || `item-${itemIndex + 1}-${campo}-${slotIndex + 1}-${Date.now()}.jpg`;

    const carpetaId = await resolverCarpetaImagenesPipc(pool, poolBiznaga, empresaId, documentoPipcId);
    const resultado = await driveService.subirArchivoNuevo(
        procesada.buffer,
        nombreArchivo.replace(/\.\w+$/, '.jpg'),
        procesada.mimeType,
        carpetaId
    );

    return {
        driveFileId: resultado.id,
        nombreArchivo: resultado.name || nombreArchivo,
        mimeType: resultado.mimeType || procesada.mimeType,
        previewUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(resultado.id)}&sz=w400`,
        thumbDataUrl: procesada.thumbDataUrl,
        carpeta_id: carpetaId
    };
}

async function obtenerNombreEmpresa(poolBiznaga, empresaId) {
    if (!poolBiznaga?.query) return '';
    const [rows] = await poolBiznaga.query(
        'SELECT nombre_empresa, razon_social FROM empresa WHERE empresa_id = ? LIMIT 1',
        [empresaId]
    );
    const row = rows[0];
    return String(row?.nombre_empresa || row?.razon_social || '').trim();
}

async function resolverSpreadsheetReportePipc(pool, poolBiznaga, empresaId, documentoPipcId, datos, rowDb = null) {
    const existenteId = String(rowDb?.drive_file_id || datos?.driveFileIdPc || '').trim();
    if (existenteId) {
        try {
            if (await driveService.verificarArchivoExiste(existenteId)) {
                return existenteId;
            }
        } catch {
            /* recrear */
        }
    }

    const nombreEmpresa = await obtenerNombreEmpresa(poolBiznaga, empresaId);
    const nombrePipc = await obtenerNombrePipc(pool, documentoPipcId);
    const carpetaEmpresaId = await resolverCarpetaEmpresa(poolBiznaga, empresaId);
    const folio = datos?.folio || sgcSpF02Service.folioDesdeFecha(sgcSpF02Service.fechaHoyIso());
    const nombreArchivo = `SP-F-02 ${folio} — ${nombrePipc || nombreEmpresa}`.slice(0, 120);

    const copia = await driveService.copiarGoogleSheetACarpeta(
        PC_TEMPLATE_DRIVE_ID,
        nombreArchivo,
        carpetaEmpresaId
    );
    const driveFileId = String(copia?.id || '').trim();
    if (!driveFileId) {
        throw new Error('No se pudo crear el archivo SP-F-02 del recorrido en Google Drive');
    }
    return driveFileId;
}

function mapReporteRow(row) {
    const datos = parseJson(row.datos_json, {}) || {};
    return {
        recorrido_id: row.recorrido_id,
        documento_pipc_id: row.documento_pipc_id,
        reporte_uuid: row.reporte_uuid,
        folio: row.folio || datos.folio || null,
        nombre_hoja: row.nombre_hoja || datos.nombreHoja || null,
        drive_file_id: row.drive_file_id || datos.driveFileIdPc || null,
        guardado: !!row.guardado,
        drive_sync_at: row.drive_sync_at,
        datos: sgcSpF02Service.sanitizarReporte({
            ...datos,
            id: row.reporte_uuid,
            folio: row.folio || datos.folio,
            nombreHoja: row.nombre_hoja || datos.nombreHoja
        })
    };
}

function crearReporteBorradorPipc(pipc, nombreEmpresa, empresaId, operacionId) {
    const hoy = sgcSpF02Service.fechaHoyIso();
    return sgcSpF02Service.sanitizarReporte({
        id: nuevoId(),
        folio: sgcSpF02Service.folioDesdeFecha(hoy),
        nombreEmpresa: nombreEmpresa || '',
        fecha: hoy,
        proposito: `Recorrido PIPC — ${pipc.nombre_documento}`,
        hora: '',
        asistentes: '',
        modalidad: 'Presencial',
        consultores: '',
        proxVisita: '',
        ultimaRevision: hoy,
        origenPc: true,
        documentoPipcId: pipc.documento_id,
        empresaIdPc: empresaId,
        operacionIdPc: operacionId,
        items: []
    });
}

async function sincronizarReporteEnArchiveroSgc(poolSgc, datos, meta) {
    if (!poolSgc?.query) return;
    try {
        await sgcSpF02Service.upsertReportePcEnArchivero(poolSgc, datos, meta);
    } catch (err) {
        console.warn('[PC Recorrido] No se pudo sincronizar archivero SGC:', err.message);
    }
}

async function asegurarReportesProvisionados(pool, poolBiznaga, poolSgc, empresaId, operacionId, pipcAsignados) {
    const nombreEmpresa = await obtenerNombreEmpresa(poolBiznaga, empresaId);
    for (const pipc of pipcAsignados) {
        const existente = await obtenerReportePipc(pool, empresaId, operacionId, pipc.documento_id);
        if (existente) continue;

        const datos = crearReporteBorradorPipc(pipc, nombreEmpresa, empresaId, operacionId);
        await pool.query(
            `INSERT INTO pc_recorrido_reporte
                (empresa_id, operacion_id, documento_pipc_id, reporte_uuid, folio, nombre_hoja, datos_json, guardado)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                empresaId,
                operacionId,
                pipc.documento_id,
                datos.id,
                datos.folio,
                datos.nombreHoja || null,
                JSON.stringify(datos)
            ]
        );

        await sincronizarReporteEnArchiveroSgc(poolSgc, datos, {
            empresaIdPc: empresaId,
            documentoPipcId: pipc.documento_id,
            operacionId
        });
    }
}

async function listarEstadoRecorrido(pool, empresaId, operacionId, allDocs = [], poolBiznaga = null, poolSgc = null) {
    const pipcAsignados = listarPipcAsignadosActivos(allDocs);
    await asegurarReportesProvisionados(pool, poolBiznaga, poolSgc, empresaId, operacionId, pipcAsignados);
    const nombreEmpresa = await obtenerNombreEmpresa(poolBiznaga, empresaId);
    const modoCaptura = await obtenerModoCaptura(pool, operacionId);

    const [rows] = await pool.query(
        `SELECT * FROM pc_recorrido_reporte
         WHERE empresa_id = ? AND operacion_id = ?
         ORDER BY updated_at DESC`,
        [empresaId, operacionId]
    );
    const porPipc = new Map(rows.map((r) => [Number(r.documento_pipc_id), mapReporteRow(r)]));

    const [pdfRows] = await pool.query(
        `SELECT * FROM pc_recorrido_pdf
         WHERE empresa_id = ? AND operacion_id = ?`,
        [empresaId, operacionId]
    );
    const pdfPorPipc = agruparPdfsPorPipc(pdfRows);

    const pipcs = pipcAsignados.map((p) => {
        const rep = porPipc.get(p.documento_id) || null;
        const pdfs = pdfPorPipc.get(p.documento_id) || [];
        const validoManual = rep?.guardado && sgcSpF02Service.reporteEsValidoParaPc(rep.datos);
        const validoPdf = pdfs.length > 0;
        const completo = modoCaptura === 'pdf' ? validoPdf : !!validoManual;
        return {
            documento_id: p.documento_id,
            nombre_documento: p.nombre_documento,
            catalogo_documento_id: p.catalogo_documento_id,
            reporte: rep,
            pdfs,
            pdf: pdfs[0] || null,
            completo
        };
    });
    const total = pipcs.length;
    const completos = pipcs.filter((p) => p.completo).length;
    const recorridoOk = total > 0 && completos === total;

    return {
        pipcs,
        nombre_empresa: nombreEmpresa,
        modo_captura: modoCaptura,
        total_pipcs: total,
        reportes_completos: completos,
        recorrido_completo: recorridoOk,
        estatus: sgcSpF02Service.ESTATUS_VALIDOS,
        modalidades: sgcSpF02Service.MODALIDADES
    };
}

async function obtenerReportePipc(pool, empresaId, operacionId, documentoPipcId) {
    const [rows] = await pool.query(
        `SELECT * FROM pc_recorrido_reporte
         WHERE empresa_id = ? AND operacion_id = ? AND documento_pipc_id = ? LIMIT 1`,
        [empresaId, operacionId, documentoPipcId]
    );
    return rows[0] ? mapReporteRow(rows[0]) : null;
}

async function guardarReportePipc(pool, poolBiznaga, empresaId, operacionId, documentoPipcId, body = {}, poolSgc = null) {
    const nombreEmpresa = await obtenerNombreEmpresa(poolBiznaga, empresaId);
    const [rowsDb] = await pool.query(
        `SELECT * FROM pc_recorrido_reporte
         WHERE empresa_id = ? AND operacion_id = ? AND documento_pipc_id = ? LIMIT 1`,
        [empresaId, operacionId, documentoPipcId]
    );
    const rowDb = rowsDb[0] || null;
    const existente = rowDb ? mapReporteRow(rowDb) : null;
    const uuid = existente?.reporte_uuid || String(body?.reporte_uuid || '').trim() || nuevoId();

    let datos = sgcSpF02Service.sanitizarReporte({
        ...(existente?.datos || {}),
        ...(body?.datos || body || {}),
        id: uuid,
        nombreEmpresa: body?.datos?.nombreEmpresa || body?.nombreEmpresa || nombreEmpresa,
        origenPc: true,
        documentoPipcId,
        empresaIdPc: empresaId,
        operacionIdPc: operacionId
    });

    if (!sgcSpF02Service.reporteEsValidoParaPc(datos)) {
        const err = new Error('Completa fecha, propósito y al menos un hallazgo del recorrido.');
        err.statusCode = 400;
        throw err;
    }

    const driveFileId = await resolverSpreadsheetReportePipc(
        pool,
        poolBiznaga,
        empresaId,
        documentoPipcId,
        datos,
        rowDb
    );
    const sync = await sgcSpF02Service.sincronizarReportePcEnSpreadsheetDedicado(driveFileId, datos);
    datos = sgcSpF02Service.sanitizarReporte({ ...datos, ...sync });

    await pool.query(
        `INSERT INTO pc_recorrido_reporte
            (empresa_id, operacion_id, documento_pipc_id, reporte_uuid, folio, nombre_hoja, drive_file_id, datos_json, guardado, drive_sync_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE
            reporte_uuid = VALUES(reporte_uuid),
            folio = VALUES(folio),
            nombre_hoja = VALUES(nombre_hoja),
            drive_file_id = VALUES(drive_file_id),
            datos_json = VALUES(datos_json),
            guardado = 1,
            drive_sync_at = NOW(),
            updated_at = NOW()`,
        [
            empresaId,
            operacionId,
            documentoPipcId,
            uuid,
            datos.folio,
            datos.nombreHoja || null,
            driveFileId,
            JSON.stringify(datos)
        ]
    );

    await sincronizarReporteEnArchiveroSgc(poolSgc, datos, {
        empresaIdPc: empresaId,
        documentoPipcId,
        operacionId
    });

    const gid = datos.nombreHoja
        ? await driveService.obtenerGidHojaPorNombre(driveFileId, datos.nombreHoja).catch(() => null)
        : null;
    const editorUrl = driveService.construirUrlEditorGoogleSheet(driveFileId, { gid });

    return {
        reporte: await obtenerReportePipc(pool, empresaId, operacionId, documentoPipcId),
        drive_file_id: driveFileId,
        editor_url: editorUrl
    };
}

async function eliminarReportePipc(pool, empresaId, operacionId, documentoPipcId) {
    const [rows] = await pool.query(
        `SELECT drive_file_id, nombre_hoja FROM pc_recorrido_reporte
         WHERE empresa_id = ? AND operacion_id = ? AND documento_pipc_id = ? LIMIT 1`,
        [empresaId, operacionId, documentoPipcId]
    );
    if (!rows[0]) return { eliminado: false };

    const driveFileId = String(rows[0].drive_file_id || '').trim();
    if (driveFileId) {
        try {
            await driveService.eliminarArchivo(driveFileId);
        } catch (err) {
            console.warn('[PC Recorrido] No se pudo eliminar spreadsheet del reporte:', err.message);
        }
    }

    await pool.query(
        `DELETE FROM pc_recorrido_reporte
         WHERE empresa_id = ? AND operacion_id = ? AND documento_pipc_id = ?`,
        [empresaId, operacionId, documentoPipcId]
    );
    return { eliminado: true };
}

async function evaluarRecorridoCompleto(pool, empresaId, operacionId, allDocs = []) {
    const estado = await listarEstadoRecorrido(pool, empresaId, operacionId, allDocs);
    return estado.recorrido_completo;
}

function registerPcRecorridoRoutes(app, deps) {
    const {
        poolProteccionCivilReady,
        getPoolProteccionCivil,
        poolReady,
        getPoolBiznaga,
        poolBiznagaSgcReady,
        getPoolBiznagaSgc,
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        handleError,
        uploadProteccionCivil
    } = deps;

    async function resolvePoolSgc() {
        if (!poolBiznagaSgcReady || !getPoolBiznagaSgc) return null;
        try {
            await poolBiznagaSgcReady;
            return getPoolBiznagaSgc();
        } catch {
            return null;
        }
    }

    async function resolvePool() {
        await poolProteccionCivilReady;
        const pool = getPoolProteccionCivil();
        await ensureTablas(pool);
        return pool;
    }

    app.get(
        '/api/proteccion-civil/empresas/:empresaId/recorrido',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                await poolReady;
                const poolBiznaga = getPoolBiznaga();
                const poolSgc = await resolvePoolSgc();
                const empresaId = Number(req.params.empresaId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }
                const [allDocs] = await pool.query(
                    `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow,
                            nombre_documento, archivo_url, estatus
                     FROM documento_proteccion_civil WHERE empresa_id = ?`,
                    [empresaId]
                );
                const estado = await listarEstadoRecorrido(
                    pool,
                    empresaId,
                    ciclo.operacion_id,
                    allDocs,
                    poolBiznaga,
                    poolSgc
                );
                res.json({ success: true, operacion_id: ciclo.operacion_id, ...estado });
            } catch (error) {
                handleError(res, error, 'No se pudo cargar reportes de recorrido');
            }
        }
    );

    app.put(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/pipc/:documentoPipcId',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                await poolReady;
                const poolBiznaga = getPoolBiznaga();
                const poolSgc = await resolvePoolSgc();
                const empresaId = Number(req.params.empresaId);
                const documentoPipcId = Number(req.params.documentoPipcId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }
                const payload = await guardarReportePipc(
                    pool,
                    poolBiznaga,
                    empresaId,
                    ciclo.operacion_id,
                    documentoPipcId,
                    req.body || {},
                    poolSgc
                );
                res.json({
                    success: true,
                    message: 'Reporte de recorrido guardado y sincronizado con Drive.',
                    ...payload
                });
            } catch (error) {
                handleError(res, error, 'No se pudo guardar el reporte de recorrido');
            }
        }
    );

    app.post(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/pipc/:documentoPipcId/imagen',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                await poolReady;
                const poolBiznaga = getPoolBiznaga();
                const empresaId = Number(req.params.empresaId);
                const documentoPipcId = Number(req.params.documentoPipcId);
                const imagen = await subirImagenItemRecorrido(
                    pool,
                    poolBiznaga,
                    empresaId,
                    documentoPipcId,
                    req.body || {}
                );
                res.json({
                    success: true,
                    message: 'Imagen subida a Google Drive.',
                    imagen
                });
            } catch (error) {
                handleError(res, error, 'No se pudo subir la imagen del recorrido');
            }
        }
    );

    app.post(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/pipc/:documentoPipcId/pdf',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        (req, res, next) => {
            if (!uploadProteccionCivil) {
                return res.status(500).json({ success: false, message: 'Subida de archivos no configurada.' });
            }
            uploadProteccionCivil.single('archivo')(req, res, (err) => {
                if (err) {
                    return handleError(res, err, 'No se pudo recibir el PDF del recorrido');
                }
                next();
            });
        },
        async (req, res) => {
            try {
                const pool = await resolvePool();
                await poolReady;
                const poolBiznaga = getPoolBiznaga();
                const empresaId = Number(req.params.empresaId);
                const documentoPipcId = Number(req.params.documentoPipcId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }

                const file = req.file;
                if (!file?.buffer?.length) {
                    return res.status(400).json({ success: false, message: 'No se recibió el archivo PDF.' });
                }
                const mime = String(file.mimetype || '').toLowerCase();
                if (mime !== 'application/pdf' && !String(file.originalname || '').toLowerCase().endsWith('.pdf')) {
                    return res.status(400).json({ success: false, message: 'Solo se permiten archivos PDF.' });
                }

                const payload = await subirPdfRecorridoPipc(
                    pool,
                    poolBiznaga,
                    empresaId,
                    ciclo.operacion_id,
                    documentoPipcId,
                    file.buffer,
                    file.originalname
                );

                const [allDocs] = await pool.query(
                    `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow,
                            nombre_documento, archivo_url, estatus
                     FROM documento_proteccion_civil WHERE empresa_id = ?`,
                    [empresaId]
                );
                const estado = await listarEstadoRecorrido(
                    pool,
                    empresaId,
                    ciclo.operacion_id,
                    allDocs,
                    poolBiznaga
                );

                res.json({
                    success: true,
                    message: 'PDF subido a la carpeta «Reporte de Recorrido» en Google Drive.',
                    ...payload,
                    recorrido_completo: estado.recorrido_completo,
                    reportes_completos: estado.reportes_completos,
                    total_pipcs: estado.total_pipcs,
                    modo_captura: estado.modo_captura
                });
            } catch (error) {
                handleError(res, error, 'No se pudo subir el PDF del recorrido');
            }
        }
    );

    app.put(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/modo',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                const empresaId = Number(req.params.empresaId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }
                const modo = await establecerModoCaptura(
                    pool,
                    empresaId,
                    ciclo.operacion_id,
                    req.body?.modo
                );
                res.json({ success: true, modo_captura: modo });
            } catch (error) {
                handleError(res, error, 'No se pudo cambiar el modo de captura del recorrido');
            }
        }
    );

    app.delete(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/pdf/:pdfId',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                const poolBiznaga = getPoolBiznaga();
                const empresaId = Number(req.params.empresaId);
                const pdfId = Number(req.params.pdfId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }
                const result = await eliminarPdfRecorrido(
                    pool,
                    poolBiznaga,
                    empresaId,
                    ciclo.operacion_id,
                    pdfId
                );
                const [allDocs] = await pool.query(
                    `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow,
                            nombre_documento, archivo_url, estatus
                     FROM documento_proteccion_civil WHERE empresa_id = ?`,
                    [empresaId]
                );
                const estado = await listarEstadoRecorrido(
                    pool,
                    empresaId,
                    ciclo.operacion_id,
                    allDocs,
                    poolBiznaga
                );
                res.json({
                    success: true,
                    message: 'PDF eliminado.',
                    ...result,
                    recorrido_completo: estado.recorrido_completo,
                    reportes_completos: estado.reportes_completos,
                    total_pipcs: estado.total_pipcs
                });
            } catch (error) {
                handleError(res, error, 'No se pudo eliminar el PDF del recorrido');
            }
        }
    );

    app.delete(
        '/api/proteccion-civil/empresas/:empresaId/recorrido/pipc/:documentoPipcId',
        requireAdminOrPC,
        verificarServicioProteccionCivilEmpresa,
        async (req, res) => {
            try {
                const pool = await resolvePool();
                const empresaId = Number(req.params.empresaId);
                const documentoPipcId = Number(req.params.documentoPipcId);
                const ciclo = await obtenerCicloActivo(pool, empresaId);
                if (!ciclo) {
                    return res.status(404).json({ success: false, message: 'No hay ciclo activo' });
                }
                const result = await eliminarReportePipc(
                    pool,
                    empresaId,
                    ciclo.operacion_id,
                    documentoPipcId
                );
                res.json({ success: true, ...result });
            } catch (error) {
                handleError(res, error, 'No se pudo eliminar el reporte de recorrido');
            }
        }
    );
}

module.exports = {
    ensureTablas,
    listarEstadoRecorrido,
    guardarReportePipc,
    eliminarReportePipc,
    evaluarRecorridoCompleto,
    subirImagenItemRecorrido,
    subirPdfRecorridoPipc,
    eliminarPdfRecorrido,
    establecerModoCaptura,
    registerPcRecorridoRoutes
};
