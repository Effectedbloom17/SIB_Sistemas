/**
 * Gestión de Directorios (teléfonos de emergencia) — Protección Civil.
 * Plantilla Google Docs → copia por directorio → editor integrado + BD.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const PLACEHOLDER_TIPO = '{{tipo_directorio}}';

/** Carpeta Drive: Protección_Civil / Directorios */
const CARPETA_DIRECTORIOS_ID =
    process.env.PC_DIRECTORIOS_FOLDER_ID || '1cNySZ4j3q7r6_ipvdGTo77IZzaJR2UaM';

/** Plantilla_Directorios */
const PLANTILLA_DIRECTORIO_ID =
    process.env.PC_DIRECTORIOS_TEMPLATE_ID || '1yx8h8tFwWbfovTtAmog1MchdydlIV1ApFGWWnFmbgpk';

/** Ejemplo existente a registrar en BD si aún no está. */
const EJEMPLO_DIRECTORIO = {
    nombre: 'MUNICIPIO MINERAL DE LA REFORMA',
    driveFileId: '17WuViyLgequkfsLwqf6mTw3jqoq1TERT0Otg0g_7RUU'
};

const COLUMNAS_SELECT = `
    d.id, d.nombre, d.drive_file_id, d.web_view_link, d.mime_type,
    d.creado_por, d.activo, d.created_at, d.updated_at,
    (SELECT COUNT(*) FROM pc_directorio_contacto c WHERE c.directorio_id = d.id) AS total_contactos
`;

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

/**
 * Unifica a mayúsculas (sin acentos rotos) y limpia caracteres inválidos para nombre Drive.
 */
function normalizarNombreDirectorio(valor) {
    const base = String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9ÁÉÍÓÚÜÑ\s\-_/.,()]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base;
}

function formatearDirectorio(row) {
    if (!row) return null;
    const driveFileId = String(row.drive_file_id || '').trim();
    return {
        id: Number(row.id),
        nombre: row.nombre,
        driveFileId,
        webViewLink: row.web_view_link || (driveFileId
            ? `https://docs.google.com/document/d/${driveFileId}/edit`
            : null),
        editorUrl: driveFileId
            ? `https://docs.google.com/document/d/${driveFileId}/edit?usp=sharing`
            : null,
        mimeType: row.mime_type || GOOGLE_DOC_MIME,
        creadoPor: row.creado_por || null,
        activo: Number(row.activo) !== 0,
        totalContactos: Number(row.total_contactos || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function formatearContacto(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        directorioId: Number(row.directorio_id),
        dependencia: row.dependencia || '',
        telefono: row.telefono || '',
        direccion: row.direccion || '',
        orden: Number(row.orden || 0)
    };
}

async function asegurarTablasPcDirectorios(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_directorio (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(255) NOT NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            web_view_link VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL DEFAULT 'application/vnd.google-apps.document',
            creado_por VARCHAR(128) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_pc_directorio_drive (drive_file_id),
            UNIQUE KEY uq_pc_directorio_nombre (nombre),
            KEY idx_pc_directorio_activo (activo),
            KEY idx_pc_directorio_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pc_directorio_contacto (
            id INT AUTO_INCREMENT PRIMARY KEY,
            directorio_id INT NOT NULL,
            dependencia VARCHAR(512) NOT NULL DEFAULT '',
            telefono VARCHAR(128) NOT NULL DEFAULT '',
            direccion VARCHAR(1024) NOT NULL DEFAULT '',
            orden INT NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_pc_dir_contacto_dir (directorio_id),
            CONSTRAINT fk_pc_dir_contacto_dir
                FOREIGN KEY (directorio_id) REFERENCES pc_directorio(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function obtenerApisGoogle() {
    const auth = driveService.getAuthClient && driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado. Revisa las credenciales del servidor.');
    }
    return {
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

function extraerTextoCelda(cell) {
    if (!cell || !Array.isArray(cell.content)) return '';
    const partes = [];
    for (const block of cell.content) {
        const elements = block?.paragraph?.elements;
        if (!Array.isArray(elements)) continue;
        for (const el of elements) {
            if (el?.textRun?.content) {
                partes.push(el.textRun.content);
            }
        }
    }
    return partes.join('').replace(/\r?\n/g, ' ').trim();
}

/**
 * Lee la primera tabla del Doc (Dependencia | Teléfono | Dirección) omitiendo encabezado.
 */
async function leerContactosDesdeGoogleDoc(documentId) {
    const { docsApi } = obtenerApisGoogle();
    const docResp = await docsApi.documents.get({ documentId });
    const content = docResp?.data?.body?.content || [];
    const contactos = [];

    for (const block of content) {
        const table = block?.table;
        if (!table?.tableRows?.length) continue;

        const rows = table.tableRows;
        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].tableCells || [];
            const dependencia = extraerTextoCelda(cells[0]);
            const telefono = extraerTextoCelda(cells[1]);
            const direccion = extraerTextoCelda(cells[2]);

            const esEncabezado =
                i === 0 &&
                /dependencia/i.test(dependencia) &&
                /tel[eé]fono/i.test(telefono);

            if (esEncabezado) continue;
            if (!dependencia && !telefono && !direccion) continue;

            contactos.push({
                dependencia: sanitizarTexto(dependencia, 512),
                telefono: sanitizarTexto(telefono, 128),
                direccion: sanitizarTexto(direccion, 1024),
                orden: contactos.length
            });
        }
        break;
    }

    return contactos;
}

async function sincronizarContactosDesdeDrive(pool, directorioId, driveFileId) {
    const id = Number(directorioId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('directorio_id inválido.');
    }
    const fileId = String(driveFileId || '').trim();
    if (!fileId) {
        throw new Error('drive_file_id requerido.');
    }

    let contactos = [];
    try {
        contactos = await leerContactosDesdeGoogleDoc(fileId);
    } catch (err) {
        console.warn(`[PC-DIR] No se pudieron leer contactos del Doc ${fileId}:`, err.message);
        return { sincronizados: 0, contactos: [], advertencia: err.message };
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM pc_directorio_contacto WHERE directorio_id = ?', [id]);
        for (const c of contactos) {
            await conn.query(
                `INSERT INTO pc_directorio_contacto
                    (directorio_id, dependencia, telefono, direccion, orden)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, c.dependencia, c.telefono, c.direccion, c.orden]
            );
        }
        await conn.query(
            'UPDATE pc_directorio SET updated_at = NOW() WHERE id = ?',
            [id]
        );
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    return { sincronizados: contactos.length, contactos };
}

async function listarDirectorios(pool) {
    await asegurarTablasPcDirectorios(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM pc_directorio d
         WHERE d.activo = 1
         ORDER BY d.nombre ASC`
    );
    return rows.map(formatearDirectorio);
}

async function obtenerDirectorio(pool, directorioId) {
    await asegurarTablasPcDirectorios(pool);
    const id = Number(directorioId);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM pc_directorio d
         WHERE d.id = ? AND d.activo = 1
         LIMIT 1`,
        [id]
    );
    if (!rows.length) return null;

    const directorio = formatearDirectorio(rows[0]);
    const [contactos] = await pool.query(
        `SELECT id, directorio_id, dependencia, telefono, direccion, orden
         FROM pc_directorio_contacto
         WHERE directorio_id = ?
         ORDER BY orden ASC, id ASC`,
        [id]
    );
    directorio.contactos = contactos.map(formatearContacto);
    return directorio;
}

async function insertarOActualizarRegistro(pool, { nombre, driveFileId, webViewLink, mimeType, creadoPor }) {
    const nombreNorm = normalizarNombreDirectorio(nombre);
    const fileId = String(driveFileId || '').trim();
    if (!nombreNorm) throw new Error('El nombre del directorio es obligatorio.');
    if (!fileId) throw new Error('drive_file_id es obligatorio.');

    const [existentes] = await pool.query(
        `SELECT id FROM pc_directorio
         WHERE drive_file_id = ? OR nombre = ?
         LIMIT 1`,
        [fileId, nombreNorm]
    );

    if (existentes.length) {
        const id = existentes[0].id;
        await pool.query(
            `UPDATE pc_directorio SET
                nombre = ?,
                drive_file_id = ?,
                web_view_link = ?,
                mime_type = ?,
                activo = 1,
                updated_at = NOW()
             WHERE id = ?`,
            [
                nombreNorm,
                fileId,
                webViewLink || null,
                mimeType || GOOGLE_DOC_MIME,
                id
            ]
        );
        return id;
    }

    const [result] = await pool.query(
        `INSERT INTO pc_directorio
            (nombre, drive_file_id, web_view_link, mime_type, creado_por, activo)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [
            nombreNorm,
            fileId,
            webViewLink || null,
            mimeType || GOOGLE_DOC_MIME,
            creadoPor || null
        ]
    );
    return result.insertId;
}

/**
 * Duplica la plantilla, reemplaza {{tipo_directorio}} y registra en BD.
 */
async function crearDirectorioDesdePlantilla(pool, nombreEntrada, creadoPor = null) {
    await asegurarTablasPcDirectorios(pool);
    await (driveService.arranqueAuthPromise || Promise.resolve());

    const nombre = normalizarNombreDirectorio(nombreEntrada);
    if (!nombre || nombre.length < 3) {
        throw new Error('Indica un nombre de directorio válido (mínimo 3 caracteres, solo mayúsculas).');
    }

    const [dupNombre] = await pool.query(
        'SELECT id FROM pc_directorio WHERE nombre = ? AND activo = 1 LIMIT 1',
        [nombre]
    );
    if (dupNombre.length) {
        throw new Error(`Ya existe un directorio registrado con el nombre "${nombre}".`);
    }

    const { drive, docsApi } = obtenerApisGoogle();

    const copyResp = await drive.files.copy({
        fileId: PLANTILLA_DIRECTORIO_ID,
        supportsAllDrives: true,
        requestBody: {
            name: nombre,
            parents: [CARPETA_DIRECTORIOS_ID]
        },
        fields: 'id,name,webViewLink,mimeType'
    });

    const nuevoId = copyResp?.data?.id;
    if (!nuevoId) {
        throw new Error('No se pudo duplicar la plantilla de directorios en Drive.');
    }

    await driveService.asignarPermisoEscrituraEnlace(nuevoId).catch(() => false);

    try {
        await docsApi.documents.batchUpdate({
            documentId: nuevoId,
            requestBody: {
                requests: [
                    {
                        replaceAllText: {
                            containsText: { text: PLACEHOLDER_TIPO, matchCase: false },
                            replaceText: nombre
                        }
                    }
                ]
            }
        });
    } catch (err) {
        console.warn(`[PC-DIR] No se pudo reemplazar ${PLACEHOLDER_TIPO}:`, err.message);
    }

    const webViewLink =
        copyResp.data.webViewLink ||
        `https://docs.google.com/document/d/${nuevoId}/edit`;

    const directorioId = await insertarOActualizarRegistro(pool, {
        nombre,
        driveFileId: nuevoId,
        webViewLink,
        mimeType: copyResp.data.mimeType || GOOGLE_DOC_MIME,
        creadoPor
    });

    await sincronizarContactosDesdeDrive(pool, directorioId, nuevoId).catch((err) => {
        console.warn('[PC-DIR] Sync contactos al crear:', err.message);
    });

    return obtenerDirectorio(pool, directorioId);
}

/**
 * Registra un Google Doc ya existente (sin duplicar plantilla).
 */
async function registrarDirectorioExistente(pool, { nombre, driveFileId, creadoPor = null }) {
    await asegurarTablasPcDirectorios(pool);
    await (driveService.arranqueAuthPromise || Promise.resolve());

    const nombreNorm = normalizarNombreDirectorio(nombre);
    const fileId = String(driveFileId || '').trim();
    if (!nombreNorm || !fileId) {
        throw new Error('nombre y driveFileId son obligatorios.');
    }

    let webViewLink = `https://docs.google.com/document/d/${fileId}/edit`;
    let mimeType = GOOGLE_DOC_MIME;

    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        if (info?.name && !nombre) {
            // keep provided
        }
        if (info?.webViewLink) webViewLink = info.webViewLink;
        if (info?.mimeType) mimeType = info.mimeType;
        await driveService.asignarPermisoEscrituraEnlace(fileId).catch(() => false);
    } catch (err) {
        console.warn(`[PC-DIR] No se pudo leer metadata de ${fileId}:`, err.message);
    }

    const directorioId = await insertarOActualizarRegistro(pool, {
        nombre: nombreNorm,
        driveFileId: fileId,
        webViewLink,
        mimeType,
        creadoPor
    });

    await sincronizarContactosDesdeDrive(pool, directorioId, fileId).catch((err) => {
        console.warn('[PC-DIR] Sync contactos al registrar:', err.message);
    });

    return obtenerDirectorio(pool, directorioId);
}

async function asegurarEjemploMineralDeLaReforma(pool) {
    await asegurarTablasPcDirectorios(pool);
    const [rows] = await pool.query(
        'SELECT id FROM pc_directorio WHERE drive_file_id = ? OR nombre = ? LIMIT 1',
        [EJEMPLO_DIRECTORIO.driveFileId, EJEMPLO_DIRECTORIO.nombre]
    );
    if (rows.length) {
        return obtenerDirectorio(pool, rows[0].id);
    }
    try {
        return await registrarDirectorioExistente(pool, {
            nombre: EJEMPLO_DIRECTORIO.nombre,
            driveFileId: EJEMPLO_DIRECTORIO.driveFileId,
            creadoPor: 'sistema'
        });
    } catch (err) {
        console.warn('[PC-DIR] No se pudo registrar ejemplo Mineral de la Reforma:', err.message);
        return null;
    }
}

async function eliminarDirectorio(pool, directorioId, { eliminarEnDrive = false } = {}) {
    await asegurarTablasPcDirectorios(pool);
    const id = Number(directorioId);
    const [rows] = await pool.query(
        'SELECT id, drive_file_id FROM pc_directorio WHERE id = ? AND activo = 1 LIMIT 1',
        [id]
    );
    if (!rows.length) {
        throw new Error('Directorio no encontrado.');
    }

    await pool.query(
        'UPDATE pc_directorio SET activo = 0, updated_at = NOW() WHERE id = ?',
        [id]
    );

    if (eliminarEnDrive && rows[0].drive_file_id) {
        try {
            await driveService.eliminarArchivo(rows[0].drive_file_id);
        } catch (err) {
            console.warn('[PC-DIR] No se eliminó el archivo en Drive:', err.message);
        }
    }

    return { ok: true };
}

function construirUrlEditor(driveFileId, modo = 'edit') {
    const id = String(driveFileId || '').trim();
    if (!id) return null;
    if (modo === 'preview') {
        return `https://docs.google.com/document/d/${id}/preview`;
    }
    return `https://docs.google.com/document/d/${id}/edit?usp=sharing`;
}

module.exports = {
    CARPETA_DIRECTORIOS_ID,
    PLANTILLA_DIRECTORIO_ID,
    EJEMPLO_DIRECTORIO,
    normalizarNombreDirectorio,
    asegurarTablasPcDirectorios,
    listarDirectorios,
    obtenerDirectorio,
    crearDirectorioDesdePlantilla,
    registrarDirectorioExistente,
    asegurarEjemploMineralDeLaReforma,
    sincronizarContactosDesdeDrive,
    eliminarDirectorio,
    construirUrlEditor
};
