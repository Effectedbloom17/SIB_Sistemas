/**
 * Repositorio Empresarial.
 * Documentos e información de cada empresa: se guardan en la carpeta Drive
 * Sistema_Integral / Empresas / {nombre} (la misma donde vive el logo)
 * y se indexan en biznaga.empresa_repositorio / empresa_repositorio_carpetas.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const driveService = require('./driveService');

const CACHE_DIR = path.join(__dirname, 'uploads', 'empresa-repositorio');
const THUMB_DIR = path.join(CACHE_DIR, 'thumbs');
const MIME_GENERICO = 'application/octet-stream';

const MIME_PERMITIDOS = new Set([
    'application/pdf',
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
]);

const EXTENSION_A_MIME = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    txt: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml'
};

const SUBIDA_LOTE_CONCURRENCIA = 2;
const SUBIDA_REINTENTOS_MAX = 3;
const SUBIDA_REINTENTO_MS = 1200;

const COLUMNAS_SELECT = `
    id, empresa_id, titulo, descripcion, categoria, nombre_archivo, nombre_archivo_drive,
    drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type,
    tamano_bytes, subido_por, created_at, updated_at
`;

function extensionDesdeNombre(nombre) {
    const partes = String(nombre || '').toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
}

function resolverMimeType(nombreArchivo, mimeEntrada) {
    const mime = String(mimeEntrada || '').trim().toLowerCase();
    if (mime && MIME_PERMITIDOS.has(mime)) {
        return mime;
    }
    const ext = extensionDesdeNombre(nombreArchivo);
    if (EXTENSION_A_MIME[ext]) {
        return EXTENSION_A_MIME[ext];
    }
    return mime || MIME_GENERICO;
}

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function nombreSeguroArchivo(nombre) {
    const base = String(nombre || 'documento')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return base || 'documento';
}

function sanitizarCarpetaRelativa(ruta) {
    return String(ruta || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(seg => sanitizarTexto(seg, 120).replace(/[/\\?%*:|"<>]/g, '_'))
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .slice(0, 8)
        .join('/');
}

function unirRutaCarpeta(base, relativa) {
    const a = sanitizarCarpetaRelativa(base);
    const b = sanitizarCarpetaRelativa(relativa);
    if (!a) return b;
    if (!b) return a;
    return sanitizarCarpetaRelativa(`${a}/${b}`);
}

function extraerDriveId(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^[a-zA-Z0-9_-]{20,}$/.test(texto)) return texto;
    const match = texto.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
        || texto.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    return match ? match[1] : '';
}

function esArchivoLogo(nombreArchivo, driveFileId, logoDriveId) {
    if (logoDriveId && driveFileId && String(driveFileId) === String(logoDriveId)) {
        return true;
    }
    const n = String(nombreArchivo || '').toLowerCase();
    return /_logo\.(png|jpe?g|webp|gif)$/.test(n) || n.startsWith('logo_empresa_');
}

function formatearRegistro(row) {
    if (!row) return null;
    return {
        id: row.id,
        empresaId: row.empresa_id != null ? Number(row.empresa_id) : null,
        titulo: row.titulo,
        descripcion: row.descripcion || '',
        categoria: row.categoria || '',
        nombreArchivo: row.nombre_archivo,
        nombreArchivoDrive: row.nombre_archivo_drive || row.nombre_archivo,
        mimeType: row.mime_type,
        tamanoBytes: row.tamano_bytes != null ? Number(row.tamano_bytes) : null,
        driveFileId: row.drive_file_id,
        carpetaDriveId: row.carpeta_drive_id || null,
        carpetaRelativa: row.carpeta_relativa || '',
        webViewLink: row.web_view_link || null,
        subidoPor: row.subido_por || null,
        fechaSubida: row.created_at,
        fechaActualizacion: row.updated_at
    };
}

function formatearCarpeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        empresaId: row.empresa_id != null ? Number(row.empresa_id) : null,
        ruta: row.ruta || '',
        nombre: row.nombre || (row.ruta || '').split('/').pop() || '',
        driveFolderId: row.drive_folder_id || null,
        creadaPor: row.creada_por || null,
        fechaCreacion: row.created_at
    };
}

function formatearEmpresa(row) {
    if (!row) return null;
    return {
        empresa_id: Number(row.empresa_id),
        nombre_empresa: row.nombre_empresa || '',
        rfc: row.rfc || '',
        razon_social: row.razon_social || '',
        direccion: row.direccion || '',
        ciudad: row.ciudad || '',
        estado: row.estado || '',
        codigo_postal: row.codigo_postal || '',
        telefono: row.telefono || row.contacto_telefono || '',
        email: row.email || row.contacto_email || '',
        contacto_nombre: row.contacto_nombre || '',
        puesto: row.puesto || '',
        logo: row.logo || null,
        drive_folder_id: row.drive_folder_id || null,
        servicio_proteccion_civil: Number(row.servicio_proteccion_civil) === 1,
        colaborador: row.colaborador != null ? Number(row.colaborador) : null
    };
}

async function asegurarTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS empresa_repositorio (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            descripcion TEXT NULL,
            categoria VARCHAR(64) NULL,
            nombre_archivo VARCHAR(512) NOT NULL,
            nombre_archivo_drive VARCHAR(512) NULL,
            drive_file_id VARCHAR(128) NOT NULL,
            carpeta_drive_id VARCHAR(128) NOT NULL,
            carpeta_relativa VARCHAR(512) NULL,
            web_view_link VARCHAR(512) NULL,
            mime_type VARCHAR(128) NOT NULL,
            tamano_bytes BIGINT NULL,
            subido_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_emp_repo_drive (drive_file_id),
            KEY idx_emp_repo_empresa (empresa_id),
            KEY idx_emp_repo_carpeta (empresa_id, carpeta_relativa(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS empresa_repositorio_carpetas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            ruta VARCHAR(512) NOT NULL,
            nombre VARCHAR(120) NOT NULL,
            drive_folder_id VARCHAR(128) NULL,
            creada_por VARCHAR(128) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_emp_repo_carpeta (empresa_id, ruta(191)),
            KEY idx_emp_repo_carpeta_emp (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function obtenerEmpresaRow(pool, empresaId) {
    const id = Number(empresaId);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Empresa no válida.');
    }
    const [rows] = await pool.query(
        `SELECT empresa_id, nombre_empresa, rfc, razon_social, direccion, ciudad, estado,
                codigo_postal, telefono, email, contacto_nombre, puesto, contacto_telefono,
                contacto_email, logo, drive_folder_id, servicio_proteccion_civil, colaborador, activo
         FROM empresa
         WHERE empresa_id = ?
         LIMIT 1`,
        [id]
    );
    if (!rows.length || Number(rows[0].activo) === 0) {
        const err = new Error('Empresa no encontrada.');
        err.status = 404;
        throw err;
    }
    return rows[0];
}

async function asegurarCarpetaDriveEmpresa(pool, empresaRow) {
    if (empresaRow.drive_folder_id) {
        return empresaRow.drive_folder_id;
    }
    const folderId = await driveService.crearCarpetaEmpresa(empresaRow.nombre_empresa);
    await pool.query(
        'UPDATE empresa SET drive_folder_id = ? WHERE empresa_id = ?',
        [folderId, empresaRow.empresa_id]
    );
    empresaRow.drive_folder_id = folderId;
    return folderId;
}

async function resolverCarpetaDrivePorRuta(pool, empresaRow, rutaRelativa) {
    const raizId = await asegurarCarpetaDriveEmpresa(pool, empresaRow);
    const ruta = sanitizarCarpetaRelativa(rutaRelativa);
    if (!ruta) {
        return raizId;
    }
    let carpetaId = raizId;
    for (const segmento of ruta.split('/')) {
        carpetaId = await driveService.obtenerOCrearCarpeta(segmento, carpetaId);
    }
    return carpetaId;
}

async function listarCarpetasRegistradas(pool, empresaId) {
    await asegurarTablas(pool);
    const [rows] = await pool.query(
        `SELECT id, empresa_id, ruta, nombre, drive_folder_id, creada_por, created_at
         FROM empresa_repositorio_carpetas
         WHERE empresa_id = ?
         ORDER BY ruta ASC`,
        [empresaId]
    );
    return rows.map(formatearCarpeta);
}

async function listarDocumentos(pool, empresaId) {
    await asegurarTablas(pool);
    const empresaRow = await obtenerEmpresaRow(pool, empresaId);
    await asegurarCarpetaDriveEmpresa(pool, empresaRow);
    const logoDriveId = extraerDriveId(empresaRow.logo);

    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM empresa_repositorio
         WHERE empresa_id = ?
         ORDER BY
           CASE WHEN carpeta_relativa IS NULL OR carpeta_relativa = '' THEN 1 ELSE 0 END,
           carpeta_relativa ASC,
           created_at DESC`,
        [empresaRow.empresa_id]
    );

    const documentos = rows
        .filter((row) => !esArchivoLogo(row.nombre_archivo, row.drive_file_id, logoDriveId))
        .map(formatearRegistro);
    const carpetas = await listarCarpetasRegistradas(pool, empresaRow.empresa_id);

    return {
        empresa: formatearEmpresa(empresaRow),
        documentos,
        carpetas
    };
}

async function obtenerDocumento(pool, empresaId, id) {
    await asegurarTablas(pool);
    const [rows] = await pool.query(
        `SELECT ${COLUMNAS_SELECT}
         FROM empresa_repositorio
         WHERE id = ? AND empresa_id = ?
         LIMIT 1`,
        [id, empresaId]
    );
    return formatearRegistro(rows[0] || null);
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function esErrorReintentable(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const code = err?.code || err?.response?.status;
    return (
        code === 429 ||
        code === 503 ||
        code === 500 ||
        msg.includes('rate limit') ||
        msg.includes('quota') ||
        msg.includes('user rate limit') ||
        msg.includes('backend error') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('socket hang up')
    );
}

async function subirABaseDeDatos(pool, {
    empresaId,
    nombreArchivo,
    titulo,
    mimeType,
    buffer,
    driveResult,
    carpetaDriveId,
    carpetaRelativa,
    usuario
}) {
    await asegurarTablas(pool);
    const ruta = sanitizarCarpetaRelativa(carpetaRelativa) || null;
    const [insert] = await pool.query(
        `INSERT INTO empresa_repositorio
            (empresa_id, titulo, descripcion, categoria, nombre_archivo, nombre_archivo_drive,
             drive_file_id, carpeta_drive_id, carpeta_relativa, web_view_link, mime_type, tamano_bytes, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            empresaId,
            titulo,
            null,
            null,
            nombreArchivo,
            driveResult.name || nombreArchivo,
            driveResult.id,
            carpetaDriveId,
            ruta,
            driveResult.webViewLink || null,
            mimeType,
            buffer.length,
            sanitizarTexto(usuario, 128) || null
        ]
    );
    const creado = await obtenerDocumento(pool, empresaId, insert.insertId);
    if (creado?.id && buffer?.length) {
        escribirCacheDocumento(creado.id, creado.nombreArchivo || nombreArchivo, buffer);
    }
    return creado;
}

async function subirUnDocumentoInterno(pool, empresaId, body, usuario, opciones = {}) {
    const usarSubidaRapida = opciones.rapido !== false;
    const empresaRow = await obtenerEmpresaRow(pool, empresaId);
    const archivoBase64 = String(body?.archivo_base64 || body?.archivoBase64 || '').trim();
    const nombreArchivo = nombreSeguroArchivo(body?.nombre_archivo || body?.nombreArchivo);
    const titulo = nombreArchivo;
    const carpetaRelativa = sanitizarCarpetaRelativa(
        body?.carpeta_relativa || body?.carpetaRelativa || ''
    );

    if (!archivoBase64) {
        throw new Error('No se recibió el archivo (archivo_base64 requerido).');
    }
    if (!nombreArchivo) {
        throw new Error('Nombre de archivo inválido.');
    }
    if (esArchivoLogo(nombreArchivo, null, extraerDriveId(empresaRow.logo))) {
        throw new Error('El logo de la empresa se gestiona desde el registro, no desde el repositorio.');
    }

    const mimeType = resolverMimeType(nombreArchivo, body?.mime_type || body?.mimeType);
    const buffer = Buffer.from(archivoBase64, 'base64');
    if (!buffer.length) {
        throw new Error('El archivo está vacío.');
    }

    const carpetaDriveId = await resolverCarpetaDrivePorRuta(pool, empresaRow, carpetaRelativa);
    let driveResult = null;
    let ultimoError = null;

    for (let intento = 1; intento <= SUBIDA_REINTENTOS_MAX; intento++) {
        try {
            driveResult = usarSubidaRapida
                ? await driveService.uploadFileFast(buffer, nombreArchivo, mimeType, carpetaDriveId)
                : await driveService.subirArchivo(buffer, nombreArchivo, mimeType, carpetaDriveId);

            return await subirABaseDeDatos(pool, {
                empresaId: empresaRow.empresa_id,
                nombreArchivo,
                titulo,
                mimeType,
                buffer,
                driveResult,
                carpetaDriveId,
                carpetaRelativa,
                usuario
            });
        } catch (err) {
            ultimoError = err;
            if (driveResult?.id) {
                try {
                    await driveService.eliminarArchivo(driveResult.id);
                } catch (cleanupErr) {
                    console.warn('[EMP-REPO] No se pudo revertir archivo en Drive:', cleanupErr.message);
                }
                driveResult = null;
            }
            if (intento < SUBIDA_REINTENTOS_MAX && esErrorReintentable(err)) {
                await esperar(SUBIDA_REINTENTO_MS * intento);
                continue;
            }
            throw err;
        }
    }
    throw ultimoError || new Error('No se pudo subir el documento.');
}

async function subirDocumento(pool, empresaId, body, usuario) {
    return subirUnDocumentoInterno(pool, empresaId, body, usuario, { rapido: false });
}

async function ejecutarConConcurrencia(items, concurrencia, fn) {
    const resultados = new Array(items.length);
    let indice = 0;

    async function worker() {
        while (indice < items.length) {
            const i = indice++;
            try {
                resultados[i] = { ok: true, valor: await fn(items[i], i) };
            } catch (err) {
                resultados[i] = { ok: false, error: err };
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrencia, items.length) },
        () => worker()
    );
    await Promise.all(workers);
    return resultados;
}

async function subirDocumentosLote(pool, empresaId, archivos, usuario) {
    const lista = Array.isArray(archivos) ? archivos : [];
    if (!lista.length) {
        throw new Error('No se recibieron archivos para subir.');
    }
    if (lista.length > 30) {
        throw new Error('Máximo 30 archivos por lote. Divide la selección en varios envíos.');
    }

    const resultados = await ejecutarConConcurrencia(lista, SUBIDA_LOTE_CONCURRENCIA, async (item) => {
        const nombre = nombreSeguroArchivo(item?.nombre_archivo || item?.nombreArchivo);
        try {
            const documento = await subirUnDocumentoInterno(pool, empresaId, item, usuario, { rapido: true });
            return { ok: true, nombre, documento };
        } catch (err) {
            return {
                ok: false,
                nombre: nombre || 'archivo',
                error: err?.message || String(err)
            };
        }
    });

    const exitosos = [];
    const fallidos = [];
    for (const r of resultados) {
        if (r?.ok && r.valor?.ok) {
            exitosos.push(r.valor.documento);
        } else if (r?.ok && r.valor && !r.valor.ok) {
            fallidos.push({ nombre: r.valor.nombre, error: r.valor.error });
        } else {
            fallidos.push({
                nombre: 'archivo',
                error: r?.error?.message || 'Error desconocido'
            });
        }
    }

    return {
        total: lista.length,
        exitosos: exitosos.length,
        fallidos: fallidos.length,
        documentos: exitosos,
        errores: fallidos
    };
}

async function crearCarpeta(pool, empresaId, body, usuario) {
    await asegurarTablas(pool);
    const empresaRow = await obtenerEmpresaRow(pool, empresaId);
    const nombre = sanitizarTexto(body?.nombre || body?.name, 120).replace(/[/\\?%*:|"<>]/g, '_');
    if (!nombre) {
        throw new Error('Indica un nombre para la carpeta.');
    }
    const padre = sanitizarCarpetaRelativa(body?.carpeta_padre || body?.carpetaPadre || body?.padre || '');
    const ruta = unirRutaCarpeta(padre, nombre);
    if (!ruta) {
        throw new Error('Ruta de carpeta inválida.');
    }

    const [existentes] = await pool.query(
        `SELECT id FROM empresa_repositorio_carpetas WHERE empresa_id = ? AND ruta = ? LIMIT 1`,
        [empresaRow.empresa_id, ruta]
    );
    if (existentes.length) {
        throw new Error(`Ya existe la carpeta «${nombre}».`);
    }

    const driveFolderId = await resolverCarpetaDrivePorRuta(pool, empresaRow, ruta);
    const [insert] = await pool.query(
        `INSERT INTO empresa_repositorio_carpetas
            (empresa_id, ruta, nombre, drive_folder_id, creada_por)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            nombre = VALUES(nombre),
            drive_folder_id = COALESCE(VALUES(drive_folder_id), drive_folder_id)`,
        [empresaRow.empresa_id, ruta, nombre, driveFolderId, sanitizarTexto(usuario, 128) || null]
    );

    let id = insert.insertId;
    if (!id) {
        const [rows] = await pool.query(
            `SELECT id, empresa_id, ruta, nombre, drive_folder_id, creada_por, created_at
             FROM empresa_repositorio_carpetas WHERE empresa_id = ? AND ruta = ? LIMIT 1`,
            [empresaRow.empresa_id, ruta]
        );
        return formatearCarpeta(rows[0]);
    }

    const [rows] = await pool.query(
        `SELECT id, empresa_id, ruta, nombre, drive_folder_id, creada_por, created_at
         FROM empresa_repositorio_carpetas WHERE id = ? LIMIT 1`,
        [id]
    );
    return formatearCarpeta(rows[0]);
}

async function moverDocumento(pool, empresaId, id, carpetaRelativaDestino) {
    const empresaRow = await obtenerEmpresaRow(pool, empresaId);
    const doc = await obtenerDocumento(pool, empresaRow.empresa_id, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    const destino = sanitizarCarpetaRelativa(carpetaRelativaDestino);
    const origen = sanitizarCarpetaRelativa(doc.carpetaRelativa);
    if (destino === origen) {
        return doc;
    }

    const carpetaDriveId = await resolverCarpetaDrivePorRuta(pool, empresaRow, destino);
    if (doc.driveFileId) {
        await driveService.moverArchivoDrive(doc.driveFileId, carpetaDriveId);
    }

    await pool.query(
        `UPDATE empresa_repositorio
         SET carpeta_relativa = ?, carpeta_drive_id = ?
         WHERE id = ? AND empresa_id = ?`,
        [destino || null, carpetaDriveId, id, empresaRow.empresa_id]
    );

    if (destino) {
        const nombre = destino.split('/').pop();
        await pool.query(
            `INSERT IGNORE INTO empresa_repositorio_carpetas
                (empresa_id, ruta, nombre, drive_folder_id)
             VALUES (?, ?, ?, ?)`,
            [empresaRow.empresa_id, destino, nombre, carpetaDriveId]
        );
    }

    return obtenerDocumento(pool, empresaRow.empresa_id, id);
}

async function eliminarCarpeta(pool, empresaId, rutaRelativa) {
    await asegurarTablas(pool);
    const ruta = sanitizarCarpetaRelativa(rutaRelativa);
    if (!ruta) {
        throw new Error('Indica la carpeta a eliminar.');
    }

    const prefijoLike = `${ruta}/%`;
    const [docs] = await pool.query(
        `SELECT id FROM empresa_repositorio
         WHERE empresa_id = ? AND (carpeta_relativa = ? OR carpeta_relativa LIKE ?)
         LIMIT 1`,
        [empresaId, ruta, prefijoLike]
    );
    if (docs.length) {
        throw new Error('La carpeta no está vacía. Mueve o elimina sus documentos primero.');
    }

    const [subcarpetas] = await pool.query(
        `SELECT id FROM empresa_repositorio_carpetas
         WHERE empresa_id = ? AND ruta LIKE ?
         LIMIT 1`,
        [empresaId, prefijoLike]
    );
    if (subcarpetas.length) {
        throw new Error('La carpeta tiene subcarpetas. Elimínalas primero.');
    }

    await pool.query(
        `DELETE FROM empresa_repositorio_carpetas WHERE empresa_id = ? AND ruta = ?`,
        [empresaId, ruta]
    );
    return { eliminado: true, ruta };
}

function asegurarCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (!fs.existsSync(THUMB_DIR)) {
        fs.mkdirSync(THUMB_DIR, { recursive: true });
    }
}

function rutaCacheDocumento(docId, nombreArchivo) {
    const id = Number(docId) || 0;
    const ext = path.extname(String(nombreArchivo || '')).replace(/[^\w.]/g, '') || '.bin';
    return path.join(CACHE_DIR, `${id}${ext}`);
}

function rutaThumbDocumento(docId) {
    return path.join(THUMB_DIR, `${Number(docId) || 0}.jpg`);
}

async function bufferADataUrlMiniatura(buffer, { max = 240 } = {}) {
    if (!buffer || !buffer.length) {
        throw new Error('Archivo vacío.');
    }
    try {
        const jpeg = await sharp(buffer)
            .rotate()
            .resize(max, max, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer();
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err) {
        if (buffer.length <= 1.5 * 1024 * 1024) {
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        throw err;
    }
}

function escribirCacheDocumento(docId, nombreArchivo, buffer) {
    try {
        asegurarCacheDir();
        const destino = rutaCacheDocumento(docId, nombreArchivo);
        fs.writeFileSync(destino, buffer);
        return destino;
    } catch (err) {
        console.warn('[EMP-REPO] No se pudo escribir caché local:', err.message);
        return null;
    }
}

function leerCacheDocumento(docId, nombreArchivo) {
    try {
        const destino = rutaCacheDocumento(docId, nombreArchivo);
        if (fs.existsSync(destino)) {
            return fs.readFileSync(destino);
        }
        asegurarCacheDir();
        const idStr = String(Number(docId));
        const match = fs.readdirSync(CACHE_DIR).find(
            (f) => path.basename(f, path.extname(f)) === idStr
        );
        if (match) {
            return fs.readFileSync(path.join(CACHE_DIR, match));
        }
    } catch (err) {
        console.warn('[EMP-REPO] No se pudo leer caché local:', err.message);
    }
    return null;
}

async function descargarBufferDocumento(pool, empresaId, id) {
    const doc = await obtenerDocumento(pool, empresaId, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }

    const cached = leerCacheDocumento(doc.id, doc.nombreArchivo);
    if (cached && cached.length) {
        return { doc, buffer: cached };
    }

    if (!doc.driveFileId) {
        throw new Error('El documento no tiene archivo asociado en Drive.');
    }
    const buffer = await driveService.descargarArchivo(doc.driveFileId);
    if (buffer && buffer.length) {
        escribirCacheDocumento(doc.id, doc.nombreArchivo, buffer);
    }
    return { doc, buffer };
}

async function obtenerMiniaturaDocumento(pool, empresaId, id, opciones = {}) {
    const docId = Number(id);
    if (!Number.isFinite(docId) || docId <= 0) {
        throw new Error('Documento no encontrado.');
    }
    asegurarCacheDir();
    const thumbPath = rutaThumbDocumento(docId);
    if (fs.existsSync(thumbPath)) {
        const jpeg = fs.readFileSync(thumbPath);
        return {
            dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
            cached: true,
            docId
        };
    }

    const { doc, buffer } = await descargarBufferDocumento(pool, empresaId, docId);
    const dataUrl = await bufferADataUrlMiniatura(buffer, { max: opciones.max || 240 });
    try {
        const b64 = dataUrl.split(',')[1] || '';
        fs.writeFileSync(thumbPath, Buffer.from(b64, 'base64'));
    } catch (err) {
        console.warn('[EMP-REPO] No se pudo guardar miniatura:', err.message);
    }
    return { dataUrl, cached: false, docId: doc.id, nombreArchivo: doc.nombreArchivo };
}

async function eliminarDocumento(pool, empresaId, id) {
    const empresaRow = await obtenerEmpresaRow(pool, empresaId);
    const doc = await obtenerDocumento(pool, empresaRow.empresa_id, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    const logoDriveId = extraerDriveId(empresaRow.logo);
    if (esArchivoLogo(doc.nombreArchivo, doc.driveFileId, logoDriveId)) {
        throw new Error('El logo de la empresa no se puede eliminar desde el repositorio.');
    }
    if (doc.driveFileId) {
        try {
            await driveService.eliminarArchivo(doc.driveFileId);
        } catch (err) {
            console.warn('[EMP-REPO] No se pudo eliminar en Drive:', err.message);
        }
    }
    try {
        const cached = rutaCacheDocumento(doc.id, doc.nombreArchivo);
        if (fs.existsSync(cached)) {
            fs.unlinkSync(cached);
        }
        const thumb = rutaThumbDocumento(doc.id);
        if (fs.existsSync(thumb)) {
            fs.unlinkSync(thumb);
        }
    } catch {
        /* ignore */
    }
    await pool.query(
        'DELETE FROM empresa_repositorio WHERE id = ? AND empresa_id = ?',
        [id, empresaRow.empresa_id]
    );
    return { eliminado: true, id: doc.id };
}

function tipoOfficeDocumento(doc) {
    const nombre = String(doc?.nombreArchivo || '').toLowerCase();
    const mime = String(doc?.mimeType || '').toLowerCase();
    if (mime.includes('word') || /\.docx?$/.test(nombre)) {
        return 'word';
    }
    if (mime.includes('sheet') || mime.includes('excel') || /\.xlsx?$/.test(nombre)) {
        return 'excel';
    }
    if (mime.includes('presentation') || mime.includes('powerpoint') || /\.pptx?$/.test(nombre)) {
        return 'ppt';
    }
    return null;
}

function resolverUrlsVistaDocumento(doc) {
    const id = String(doc?.driveFileId || '').trim();
    if (!id) {
        return { previewUrl: null, editorUrl: null, thumbnailUrl: null };
    }
    const tipo = tipoOfficeDocumento(doc);
    let previewUrl = `https://drive.google.com/file/d/${id}/preview`;
    let editorUrl = `https://drive.google.com/file/d/${id}/view`;
    if (tipo === 'word') {
        previewUrl = `https://docs.google.com/document/d/${id}/preview`;
        editorUrl = `https://docs.google.com/document/d/${id}/edit?usp=sharing`;
    } else if (tipo === 'excel') {
        previewUrl = `https://docs.google.com/spreadsheets/d/${id}/preview`;
        editorUrl = `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`;
    } else if (tipo === 'ppt') {
        previewUrl = `https://docs.google.com/presentation/d/${id}/preview`;
        editorUrl = `https://docs.google.com/presentation/d/${id}/edit?usp=sharing`;
    }
    return {
        previewUrl,
        editorUrl,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w400`
    };
}

async function prepararVistaDocumento(pool, empresaId, id) {
    const doc = await obtenerDocumento(pool, empresaId, id);
    if (!doc) {
        throw new Error('Documento no encontrado.');
    }
    if (doc.driveFileId) {
        await driveService.asignarPermisoLecturaPublica(doc.driveFileId);
    }
    return doc;
}

module.exports = {
    asegurarTablas,
    listarDocumentos,
    obtenerDocumento,
    subirDocumento,
    subirDocumentosLote,
    crearCarpeta,
    moverDocumento,
    eliminarCarpeta,
    descargarBufferDocumento,
    obtenerMiniaturaDocumento,
    bufferADataUrlMiniatura,
    eliminarDocumento,
    prepararVistaDocumento,
    resolverUrlsVistaDocumento,
    sanitizarCarpetaRelativa,
    MIME_PERMITIDOS
};
