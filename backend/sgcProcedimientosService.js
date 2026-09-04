/**
 * Procedimientos corporativos SGC — persistencia en biznaga_sgc (sgc_procedimientos)
 * y archivos PDF en Google Drive (Calidad / Procedimientos).
 */
const driveService = require('./driveService');

const CARPETA_PROCEDIMIENTOS = 'Procedimientos';

/** Catálogo inicial (mismo contenido que el frontend) para seed en BD. */
const CATALOGO_INICIAL = [
    { codigo: 'ATH-P-01', titulo: 'Reclutamiento selección y contratación', driveFileId: '1aSDR7tBWqGAkaX6ItnVnclnHCEzQ_FlM', categoriaId: 'ath' },
    { codigo: 'ATH-P-02', titulo: 'Competencia y capacitación', driveFileId: '1j2pHscij-nBqkdRVBcIlvuntcUL-x-Iw', categoriaId: 'ath' },
    { codigo: 'ATH-P-03', titulo: 'Cotización contrato pago y facturación', driveFileId: '1aG4HKS6u6xtSsCcy6hTDyVw-I0J1zIKm', categoriaId: 'ath' },
    { codigo: 'ATH-P-04', titulo: 'Desarrollo organizacional', driveFileId: '185vgxkgCoah1WTiUkcOlQ2-r1zJneBb6', categoriaId: 'ath' },
    { codigo: 'EIN-P-01', titulo: 'Mantenimiento a la Infraestructura', driveFileId: '1AS5KdXdsw0q_8FLDdSr6acBe6X2YDELd', categoriaId: 'ein' },
    { codigo: 'SGC-P-01', titulo: 'Control de la información documentada', driveFileId: '1UbPgdWMW_9dkal-SN5pF2HWgx9jIhIwv', categoriaId: 'sgc' },
    { codigo: 'SGC-P-02', titulo: 'No conformidad y acciones correctivas', driveFileId: '1MgSI6jOsM16RkduA3IWFBT6dL1V35Ik1', categoriaId: 'sgc' },
    { codigo: 'SGC-P-03', titulo: 'Auditoría interna', driveFileId: '1PW55oVhSpyrSbUPEbXda5NFT5co0NFH1', categoriaId: 'sgc' },
    { codigo: 'SGC-P-04', titulo: 'Gestión de riesgos y oportunidades', driveFileId: '1i3bmsTRlnurihWL3C0dsoTd3sYPgI9xl', categoriaId: 'sgc' },
    { codigo: 'SGC-P-05', titulo: 'Mejora', driveFileId: '1SEkaHjB4SHuZAMsu5YI7aPSadp8YpNrg', categoriaId: 'sgc' },
    { codigo: 'SGC-P-06', titulo: 'Revisión por la dirección', driveFileId: '1Ury4RP-ZPSFZLw5E0nSbaLMOyF11g5Bu', categoriaId: 'sgc' },
    { codigo: 'SGC-P-07', titulo: 'Equipos de medición', driveFileId: '11v2cNi1gDLjK2U_oBNu1mfOv1f8qEYhY', categoriaId: 'sgc' },
    { codigo: 'SGC-P-08', titulo: 'Satisfacción del cliente', driveFileId: '1yP9mr1mbpkWXXu9ubdYMm_Q81nxA_IRI', categoriaId: 'sgc' },
    { codigo: 'SGC-P-09', titulo: 'Proveeduría externa', driveFileId: '1fOK0RbRQL-9gWf2MB_tpui-xktuMj6gA', categoriaId: 'sgc' },
    { codigo: 'SP-P-01', titulo: 'Consultoría estratégica REV-02', driveFileId: '10C1TvE1Cd8InvNBL2WIkCt_qDgrJDAky', categoriaId: 'sp' },
    { codigo: 'SP-P-02', titulo: 'Capacitación empresarial REV-01', driveFileId: '1pY-Xh9WgM--l8XdEm4vTQ2vZVyL2u7Jz', categoriaId: 'sp' },
    { codigo: 'SP-P-03', titulo: 'Trámites REV-02', driveFileId: '1Gshpfyk-Ku8xcw29nghcsDRCi-r42sIr', categoriaId: 'sp' },
    { codigo: 'SP-P-07', titulo: 'Programa Interno de Protección Civil', driveFileId: '1ocoRjEam6ODkckodKaVzW2tZdcKH-dW9', categoriaId: 'sp' },
    { codigo: 'SP-P-08', titulo: 'Plan integral de salud', driveFileId: '1OONXhouMRc8KuL9U1rJtD9qEDtMSaquX', categoriaId: 'sp' }
];

const CATEGORIAS_VALIDAS = new Set(['ath', 'ein', 'sgc', 'sp']);

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function normalizarCodigo(codigo) {
    return sanitizarTexto(codigo, 32).toUpperCase().replace(/\s+/g, '-');
}

function nombreSeguroArchivo(nombre) {
    const base = String(nombre || 'procedimiento.pdf')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base || 'procedimiento.pdf';
}

function bufferDesdeBase64(archivoBase64) {
    const raw = String(archivoBase64 || '').trim();
    if (!raw) {
        throw new Error('No se recibió el archivo (archivo_base64 requerido).');
    }
    const sinPrefijo = raw.includes(',') ? raw.split(',').pop() : raw;
    const buffer = Buffer.from(sinPrefijo, 'base64');
    if (!buffer.length) {
        throw new Error('El archivo está vacío.');
    }
    return buffer;
}

function formatearRegistro(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        codigo: row.codigo,
        titulo: row.titulo,
        categoriaId: row.categoria_id,
        driveFileId: row.drive_file_id,
        nombreArchivo: row.nombre_archivo || null,
        mimeType: row.mime_type || 'application/pdf',
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        carpetaDriveId: row.carpeta_drive_id || null,
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        actualizadoPor: row.actualizado_por || null,
        activo: row.activo == null ? true : !!row.activo,
        fechaCreacion: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

const COLUMNAS_SELECT = `
    id, codigo, titulo, categoria_id, drive_file_id, nombre_archivo,
    mime_type, tamano_bytes, carpeta_drive_id, web_view_link,
    subido_por, actualizado_por, activo, created_at, updated_at
`;

let _cacheCarpetaProcedimientosId = null;

async function obtenerCarpetaProcedimientos() {
    if (_cacheCarpetaProcedimientosId) {
        return _cacheCarpetaProcedimientosId;
    }
    const carpetaCalidad = await driveService.obtenerCarpetaCalidad();
    _cacheCarpetaProcedimientosId = await driveService.obtenerOCrearCarpeta(
        CARPETA_PROCEDIMIENTOS,
        carpetaCalidad
    );
    return _cacheCarpetaProcedimientosId;
}

async function asegurarTablaSgcProcedimientos(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_procedimientos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codigo VARCHAR(32) NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            categoria_id VARCHAR(16) NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            nombre_archivo VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
            tamano_bytes BIGINT NULL,
            carpeta_drive_id VARCHAR(128) NULL,
            web_view_link VARCHAR(512) NULL,
            subido_por VARCHAR(128) NULL,
            actualizado_por VARCHAR(128) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_proc_codigo (codigo),
            UNIQUE KEY uq_sgc_proc_drive (drive_file_id),
            KEY idx_sgc_proc_categoria (categoria_id),
            KEY idx_sgc_proc_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await sembrarCatalogoInicial(pool);
}

async function sembrarCatalogoInicial(pool) {
    for (const item of CATALOGO_INICIAL) {
        await pool.query(
            `INSERT INTO sgc_procedimientos
                (codigo, titulo, categoria_id, drive_file_id, nombre_archivo, mime_type, activo)
             VALUES (?, ?, ?, ?, ?, 'application/pdf', 1)
             ON DUPLICATE KEY UPDATE
                codigo = codigo`,
            [
                item.codigo,
                item.titulo,
                item.categoriaId,
                item.driveFileId,
                `${item.codigo} ${item.titulo}.pdf`
            ]
        );
    }
}

async function listarProcedimientos(pool) {
    await asegurarTablaSgcProcedimientos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_procedimientos
         WHERE activo = 1
         ORDER BY categoria_id ASC, codigo ASC`
    );
    return rows.map(formatearRegistro);
}

async function obtenerProcedimiento(pool, id) {
    await asegurarTablaSgcProcedimientos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_procedimientos
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    return formatearRegistro(rows[0] || null);
}

async function obtenerPorCodigo(pool, codigo) {
    await asegurarTablaSgcProcedimientos(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM sgc_procedimientos
         WHERE codigo = ?
         LIMIT 1`,
        [normalizarCodigo(codigo)]
    );
    return formatearRegistro(rows[0] || null);
}

/**
 * Sube un PDF nuevo a Drive y crea el registro en BD.
 */
async function subirProcedimiento(pool, body, usuario) {
    await asegurarTablaSgcProcedimientos(pool);

    const codigo = normalizarCodigo(body?.codigo);
    const titulo = sanitizarTexto(body?.titulo, 255);
    const categoriaId = sanitizarTexto(body?.categoria_id || body?.categoriaId, 16).toLowerCase();
    const nombreArchivo = nombreSeguroArchivo(
        body?.nombre_archivo || body?.nombreArchivo || `${codigo} ${titulo}.pdf`
    );

    if (!codigo || !/^[A-Z]{2,4}-P-\d{2}$/.test(codigo)) {
        throw new Error('Código inválido. Usa el formato ÁREA-P-NN (ej. SP-P-08).');
    }
    if (!titulo) {
        throw new Error('El título del procedimiento es obligatorio.');
    }
    if (!CATEGORIAS_VALIDAS.has(categoriaId)) {
        throw new Error('Área inválida. Usa: ath, ein, sgc o sp.');
    }

    const existente = await obtenerPorCodigo(pool, codigo);
    if (existente && existente.activo) {
        throw new Error(`Ya existe el procedimiento ${codigo}. Usa «Reemplazar» para actualizar el PDF.`);
    }

    const buffer = bufferDesdeBase64(body?.archivo_base64 || body?.archivoBase64);
    const mimeType = 'application/pdf';
    const carpetaId = await obtenerCarpetaProcedimientos();

    let driveResult = null;
    try {
        driveResult = await driveService.subirArchivoNuevo(buffer, nombreArchivo, mimeType, carpetaId);
        try {
            await driveService.asignarPermisoLecturaPublica(driveResult.id);
        } catch (permErr) {
            console.warn('[SGC-PROC] No se pudo publicar lectura del PDF:', permErr.message);
        }

        if (existente && !existente.activo) {
            await pool.query(
                `UPDATE sgc_procedimientos
                 SET titulo = ?, categoria_id = ?, drive_file_id = ?, nombre_archivo = ?,
                     mime_type = ?, tamano_bytes = ?, carpeta_drive_id = ?, web_view_link = ?,
                     subido_por = ?, actualizado_por = ?, activo = 1
                 WHERE id = ?`,
                [
                    titulo,
                    categoriaId,
                    driveResult.id,
                    nombreArchivo,
                    mimeType,
                    buffer.length,
                    carpetaId,
                    driveResult.webViewLink || null,
                    sanitizarTexto(usuario, 128) || null,
                    sanitizarTexto(usuario, 128) || null,
                    existente.id
                ]
            );
            return obtenerProcedimiento(pool, existente.id);
        }

        const [insert] = await pool.query(
            `INSERT INTO sgc_procedimientos
                (codigo, titulo, categoria_id, drive_file_id, nombre_archivo, mime_type,
                 tamano_bytes, carpeta_drive_id, web_view_link, subido_por, actualizado_por, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                codigo,
                titulo,
                categoriaId,
                driveResult.id,
                nombreArchivo,
                mimeType,
                buffer.length,
                carpetaId,
                driveResult.webViewLink || null,
                sanitizarTexto(usuario, 128) || null,
                sanitizarTexto(usuario, 128) || null
            ]
        );
        return obtenerProcedimiento(pool, insert.insertId);
    } catch (err) {
        if (driveResult?.id) {
            try {
                await driveService.eliminarArchivo(driveResult.id);
            } catch (cleanupErr) {
                console.warn('[SGC-PROC] No se pudo revertir archivo en Drive:', cleanupErr.message);
            }
        }
        throw err;
    }
}

/**
 * Reemplaza el PDF de un procedimiento existente (mismo código / registro).
 */
async function reemplazarProcedimiento(pool, id, body, usuario) {
    await asegurarTablaSgcProcedimientos(pool);
    const doc = await obtenerProcedimiento(pool, id);
    if (!doc || !doc.activo) {
        throw new Error('Procedimiento no encontrado.');
    }

    const buffer = bufferDesdeBase64(body?.archivo_base64 || body?.archivoBase64);
    const mimeType = 'application/pdf';
    const tituloNuevo = sanitizarTexto(body?.titulo, 255);
    const nombreArchivo = nombreSeguroArchivo(
        body?.nombre_archivo || body?.nombreArchivo || doc.nombreArchivo || `${doc.codigo}.pdf`
    );

    let driveFileId = doc.driveFileId;
    let webViewLink = doc.webViewLink;

    if (driveFileId) {
        const actualizado = await driveService.reemplazarArchivoEnDrive(
            driveFileId,
            buffer,
            mimeType,
            nombreArchivo
        );
        webViewLink = actualizado?.webViewLink || webViewLink;
        try {
            await driveService.asignarPermisoLecturaPublica(driveFileId);
        } catch (permErr) {
            console.warn('[SGC-PROC] No se pudo republicar lectura del PDF:', permErr.message);
        }
    } else {
        const carpetaId = await obtenerCarpetaProcedimientos();
        const driveResult = await driveService.subirArchivoNuevo(buffer, nombreArchivo, mimeType, carpetaId);
        driveFileId = driveResult.id;
        webViewLink = driveResult.webViewLink || null;
        try {
            await driveService.asignarPermisoLecturaPublica(driveFileId);
        } catch (permErr) {
            console.warn('[SGC-PROC] No se pudo publicar lectura del PDF:', permErr.message);
        }
        await pool.query(
            `UPDATE sgc_procedimientos SET carpeta_drive_id = ? WHERE id = ?`,
            [carpetaId, id]
        );
    }

    await pool.query(
        `UPDATE sgc_procedimientos
         SET drive_file_id = ?,
             nombre_archivo = ?,
             mime_type = ?,
             tamano_bytes = ?,
             web_view_link = ?,
             titulo = COALESCE(NULLIF(?, ''), titulo),
             actualizado_por = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            driveFileId,
            nombreArchivo,
            mimeType,
            buffer.length,
            webViewLink,
            tituloNuevo,
            sanitizarTexto(usuario, 128) || null,
            id
        ]
    );

    return obtenerProcedimiento(pool, id);
}

module.exports = {
    CATALOGO_INICIAL,
    asegurarTablaSgcProcedimientos,
    listarProcedimientos,
    obtenerProcedimiento,
    subirProcedimiento,
    reemplazarProcedimiento
};
