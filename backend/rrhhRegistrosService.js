/**
 * Recursos Humanos — Registros Recursos Humanos (privado).
 * Carpeta Drive «FORMATOS RH» (excluida del expediente de colaboradores).
 * Acceso: root + whitelist de username (Rozana / Talento Humano).
 */
const { google } = require('googleapis');
const axios = require('axios');
const sharp = require('sharp');
const driveService = require('./driveService');

const CARPETA_RH_ID = '1Jg9BYyilu6PTPb8dIWnCI5GjmWraPUU3';
/** Carpeta Drive «FORMATOS RH» / Talento Humano (destino de subidas y raíz del módulo) */
const CARPETA_REGISTROS_ID = '1euPCpDMhbNZhzBQvXYU5cnxlrMWsa1Od';
const CARPETA_DRIVE_URL = `https://drive.google.com/drive/folders/${CARPETA_REGISTROS_ID}`;
const TITULO_MODULO = 'Registros Recursos Humanos';

/** Solo estas cuentas (además de root en middleware). */
const USERNAMES_REGISTROS_RH = new Set(['rozanarg', 'bizna4116']);

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_PDF = 'application/pdf';
const MIME_IMAGEN = new Set([
    'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif'
]);
const MIME_OFFICE = new Set([
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/rtf'
]);

const CARPETAS_SUGERIDAS = ['Formatos', 'Entregas', 'CVs', 'Otros'];
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MINIATURA_TTL_MS = 30 * 60 * 1000;

const cacheContenido = new Map();
const cacheMiniaturas = new Map();

function getDrive() {
    const auth = driveService.getAuthClient();
    if (!auth || !driveService.driveDisponible()) {
        throw new Error('Google Drive no está autenticado. Revisa la conexión de Drive.');
    }
    return google.drive({ version: 'v3', auth });
}

function errorHttp(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function normalizarNombre(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function extensionDe(nombre) {
    const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
}

function clasificarArchivo(file) {
    const mime = String(file?.mimeType || '').toLowerCase();
    const ext = extensionDe(file?.name);
    if (mime === MIME_PDF || ext === 'pdf') return 'pdf';
    if (MIME_IMAGEN.has(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return 'imagen';
    }
    if (MIME_OFFICE.has(mime) || ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf'].includes(ext)) {
        return 'documento';
    }
    if (mime.startsWith('application/vnd.google-apps.')) return 'gdrive';
    return 'otro';
}

function archivoPermitido(nombre, mimeType) {
    const tipo = clasificarArchivo({ name: nombre, mimeType });
    return tipo === 'pdf' || tipo === 'imagen' || tipo === 'documento';
}

function formatearTamano(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mapearCarpeta(file) {
    return {
        id: file.id,
        nombre: file.name,
        modificado: file.modifiedTime || null,
        webViewLink: `https://drive.google.com/drive/folders/${file.id}`
    };
}

function mapearArchivo(file) {
    const mime = String(file?.mimeType || '').toLowerCase();
    const esAtajo = mime === 'application/vnd.google-apps.shortcut';
    const targetMime = String(file?.shortcutDetails?.targetMimeType || '').toLowerCase();
    const targetId = String(file?.shortcutDetails?.targetId || '').trim();
    const tipo = esAtajo
        ? clasificarArchivo({ name: file?.name, mimeType: targetMime || 'application/pdf' })
        : clasificarArchivo(file);
    if (!tipo || tipo === 'otro') return null;
    const viewId = (esAtajo && targetId) ? targetId : file.id;
    return {
        id: file.id,
        nombre: file.name,
        tipo: tipo === 'gdrive' ? 'documento' : tipo,
        mimeType: esAtajo ? (targetMime || file.mimeType || '') : (file.mimeType || ''),
        tamano: file.size != null ? Number(file.size) : null,
        tamanoLabel: formatearTamano(file.size),
        modificado: file.modifiedTime || null,
        webViewLink: file.webViewLink
            || `https://drive.google.com/file/d/${viewId}/view`,
        esAtajo: esAtajo || undefined,
        targetId: targetId || undefined
    };
}

function usernamePuedeRegistrosRh(username) {
    const u = String(username || '').toLowerCase().trim();
    return !!u && USERNAMES_REGISTROS_RH.has(u);
}

function usuarioPuedeRegistrosRh(user) {
    const roles = Array.isArray(user?.roles)
        ? user.roles.map((r) => String(r).toLowerCase())
        : (user?.rol ? [String(user.rol).toLowerCase()] : []);
    // Superadministrador (root) siempre tiene acceso
    if (roles.includes('root')) return true;
    const rolPrincipal = String(user?.rol || user?.rol_nombre || '').toLowerCase().trim();
    if (rolPrincipal === 'root') return true;
    return usernamePuedeRegistrosRh(user?.username);
}

async function listarHijos(carpetaId) {
    const drive = getDrive();
    const files = [];
    let pageToken = null;
    do {
        const response = await drive.files.list({
            q: `'${carpetaId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, shortcutDetails(targetId,targetMimeType))',
            pageSize: 200,
            pageToken: pageToken || undefined,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        files.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken || null;
    } while (pageToken);
    return files;
}

async function obtenerMetadatosConPadres(fileId) {
    const drive = getDrive();
    const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, parents, webViewLink, modifiedTime, shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });
    return response.data;
}

async function cadenaHastaRegistros(fileId) {
    const cadena = [];
    const visitados = new Set();
    let actual = String(fileId || '').trim();
    while (actual && !visitados.has(actual)) {
        visitados.add(actual);
        if (actual === CARPETA_REGISTROS_ID) {
            cadena.push({ id: CARPETA_REGISTROS_ID, nombre: TITULO_MODULO });
            return cadena;
        }
        let meta;
        try {
            meta = await obtenerMetadatosConPadres(actual);
        } catch {
            return null;
        }
        cadena.push({ id: meta.id, nombre: meta.name, mimeType: meta.mimeType });
        const padres = Array.isArray(meta.parents) ? meta.parents : [];
        if (!padres.length) return null;
        actual = padres[0];
    }
    return null;
}

async function asegurarNodoEnRegistros(carpetaId) {
    const id = String(carpetaId || CARPETA_REGISTROS_ID).trim() || CARPETA_REGISTROS_ID;
    if (id === CARPETA_REGISTROS_ID) {
        return {
            nodo: { id: CARPETA_REGISTROS_ID, name: TITULO_MODULO, mimeType: MIME_FOLDER },
            cadena: [{ id: CARPETA_REGISTROS_ID, nombre: TITULO_MODULO }]
        };
    }
    const cadena = await cadenaHastaRegistros(id);
    if (!cadena || !cadena.some((n) => n.id === CARPETA_REGISTROS_ID)) {
        throw errorHttp('La carpeta no pertenece a Registros Recursos Humanos', 403);
    }
    const actual = cadena[0];
    return {
        nodo: {
            id: actual.id,
            name: actual.nombre,
            mimeType: actual.mimeType || MIME_FOLDER
        },
        cadena: [...cadena].reverse()
    };
}

async function resumenNivel(carpetaId) {
    const hijos = await listarHijos(carpetaId);
    let archivos = 0;
    let carpetas = 0;
    for (const h of hijos) {
        if (h.mimeType === MIME_FOLDER) carpetas += 1;
        else if (mapearArchivo(h)) archivos += 1;
    }
    return { items: archivos + carpetas, archivos, carpetas };
}

function invalidarCache(carpetaId = null) {
    cacheMiniaturas.clear();
    if (!carpetaId) {
        cacheContenido.clear();
        return;
    }
    for (const key of cacheContenido.keys()) {
        if (key === carpetaId || key.startsWith(`${carpetaId}:`)) {
            cacheContenido.delete(key);
        }
    }
}

async function listarContenido(carpetaId = null, { forzar = false } = {}) {
    const { nodo, cadena } = await asegurarNodoEnRegistros(carpetaId || CARPETA_REGISTROS_ID);
    const actualId = String(nodo.id || CARPETA_REGISTROS_ID);
    const cacheKey = actualId;
    if (!forzar) {
        const cached = cacheContenido.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.payload;
        }
    }

    const hijos = await listarHijos(actualId);
    const carpetas = [];
    const archivos = [];
    for (const h of hijos) {
        if (h.mimeType === MIME_FOLDER) {
            carpetas.push(mapearCarpeta(h));
            continue;
        }
        const archivo = mapearArchivo(h);
        if (archivo) archivos.push(archivo);
    }

    const conteos = await Promise.all(
        carpetas.map(async (c) => {
            try {
                return await resumenNivel(c.id);
            } catch {
                return { items: 0, archivos: 0, carpetas: 0 };
            }
        })
    );
    carpetas.forEach((c, i) => {
        c.items = conteos[i]?.items || 0;
        c.archivos = conteos[i]?.archivos || 0;
        c.carpetas = conteos[i]?.carpetas || 0;
    });

    carpetas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    archivos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));

    const bytesNivel = archivos.reduce((acc, a) => acc + (Number(a.tamano) || 0), 0);
    const conteosTipo = { pdf: 0, documentos: 0, imagenes: 0 };
    for (const a of archivos) {
        if (a.tipo === 'pdf') conteosTipo.pdf += 1;
        else if (a.tipo === 'imagen') conteosTipo.imagenes += 1;
        else conteosTipo.documentos += 1;
    }

    let totalesRaiz = { carpetas: 0, archivos: 0, items: 0, bytes: 0 };
    try {
        if (actualId === CARPETA_REGISTROS_ID) {
            totalesRaiz = {
                carpetas: carpetas.length,
                archivos: archivos.length,
                items: carpetas.length + archivos.length,
                bytes: bytesNivel
            };
        } else {
            const resumen = await resumenNivel(CARPETA_REGISTROS_ID);
            totalesRaiz = { ...resumen, bytes: Number(resumen.bytes) || 0 };
        }
    } catch {
        totalesRaiz = { carpetas: 0, archivos: 0, items: 0, bytes: 0 };
    }

    const payload = {
        titulo: TITULO_MODULO,
        carpetaRaizId: CARPETA_REGISTROS_ID,
        carpetaUrl: CARPETA_DRIVE_URL,
        carpetaActual: {
            id: actualId,
            nombre: actualId === CARPETA_REGISTROS_ID ? TITULO_MODULO : (nodo.name || 'Carpeta'),
            esRaiz: actualId === CARPETA_REGISTROS_ID,
            webViewLink: `https://drive.google.com/drive/folders/${actualId}`
        },
        migas: (cadena || []).map((n) => ({ id: n.id, nombre: n.nombre })),
        carpetas,
        archivos,
        totales: {
            carpetas: carpetas.length,
            archivos: archivos.length,
            items: carpetas.length + archivos.length,
            bytes: bytesNivel
        },
        conteosTipo,
        totalesRaiz,
        carpetasSugeridas: CARPETAS_SUGERIDAS
    };
    cacheContenido.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return payload;
}

async function crearSubcarpeta(parentId, nombre) {
    const nombreLimpio = String(nombre || '').trim().replace(/[\\/]+/g, ' ').slice(0, 120);
    if (!nombreLimpio) throw errorHttp('El nombre de la carpeta es obligatorio', 400);
    const { nodo } = await asegurarNodoEnRegistros(parentId || CARPETA_REGISTROS_ID);
    const padreId = nodo.id || CARPETA_REGISTROS_ID;
    const id = await driveService.crearCarpeta(nombreLimpio, padreId);
    invalidarCache();
    return {
        id,
        nombre: nombreLimpio,
        webViewLink: `https://drive.google.com/drive/folders/${id}`
    };
}

async function crearCarpetasSugeridas(parentId = null) {
    const { nodo } = await asegurarNodoEnRegistros(parentId || CARPETA_REGISTROS_ID);
    const padreId = nodo.id || CARPETA_REGISTROS_ID;
    const hijos = await listarHijos(padreId);
    const existentes = new Set(
        hijos.filter((h) => h.mimeType === MIME_FOLDER).map((h) => normalizarNombre(h.name))
    );
    const creadas = [];
    for (const nombre of CARPETAS_SUGERIDAS) {
        if (existentes.has(normalizarNombre(nombre))) continue;
        const id = await driveService.crearCarpeta(nombre, padreId);
        creadas.push({ id, nombre });
    }
    invalidarCache();
    return { creadas, total: creadas.length };
}

/**
 * Busca un archivo por nombre que ya viva bajo Registros RH (sin duplicar).
 */
async function buscarExistenteEnRegistros(nombre) {
    const nombreLimpio = String(nombre || '').trim();
    if (!nombreLimpio) return null;

    // 1) Coincidencia directa en la raíz de Registros
    const enRaiz = await driveService.buscarArchivo(nombreLimpio, CARPETA_REGISTROS_ID).catch(() => null);
    if (enRaiz?.id) {
        const meta = await obtenerMetadatosConPadres(enRaiz.id).catch(() => enRaiz);
        if (meta?.mimeType !== MIME_FOLDER) return meta;
    }

    // 2) Búsqueda global por nombre y validación de cadena bajo Registros
    const drive = getDrive();
    const escaped = String(nombreLimpio).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const baseParams = {
        q: `name='${escaped}' and trashed=false and mimeType!='${MIME_FOLDER}'`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)',
        pageSize: 25,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    };
    let pageToken = null;
    do {
        let response;
        try {
            response = await drive.files.list({
                ...baseParams,
                pageToken: pageToken || undefined,
                orderBy: 'modifiedTime desc'
            });
        } catch {
            response = await drive.files.list({
                ...baseParams,
                pageToken: pageToken || undefined
            });
        }
        const files = response.data.files || [];
        for (const f of files) {
            const cadena = await cadenaHastaRegistros(f.id);
            if (cadena) return f;
        }
        pageToken = response.data.nextPageToken || null;
    } while (pageToken);

    return null;
}

async function ligarArchivoACarpeta(fileMeta, carpetaDestinoId) {
    const drive = getDrive();
    const fileId = String(fileMeta?.id || '').trim();
    const destino = String(carpetaDestinoId || '').trim();
    if (!fileId || !destino) throw errorHttp('No se pudo ligar el archivo', 400);

    const padres = Array.isArray(fileMeta.parents) ? fileMeta.parents : [];
    if (padres.includes(destino)) {
        return {
            archivo: mapearArchivo(fileMeta) || {
                id: fileMeta.id,
                nombre: fileMeta.name,
                tipo: clasificarArchivo(fileMeta),
                mimeType: fileMeta.mimeType || '',
                tamano: fileMeta.size != null ? Number(fileMeta.size) : null,
                tamanoLabel: formatearTamano(fileMeta.size),
                modificado: fileMeta.modifiedTime || null,
                webViewLink: fileMeta.webViewLink
                    || `https://drive.google.com/file/d/${fileMeta.id}/view`
            },
            accion: 'existente',
            ligado: true,
            mensaje: 'El archivo ya estaba en esta carpeta; se reutilizó sin subir de nuevo.'
        };
    }

    const actualizado = await drive.files.update({
        fileId,
        addParents: destino,
        fields: 'id, name, mimeType, size, modifiedTime, webViewLink, parents',
        supportsAllDrives: true
    });
    const data = actualizado.data || fileMeta;
    return {
        archivo: mapearArchivo(data) || {
            id: data.id,
            nombre: data.name,
            tipo: clasificarArchivo(data),
            mimeType: data.mimeType || '',
            webViewLink: data.webViewLink
                || `https://drive.google.com/file/d/${data.id}/view`
        },
        accion: 'ligado',
        ligado: true,
        mensaje: 'Archivo ya existente en el sistema; se ligó sin volver a subirlo.'
    };
}

/**
 * Sube a Drive o, si el nombre ya existe bajo Registros RH, solo lo liga
 * (mismo criterio que Solicitud de documentos: no duplicar binario).
 */
async function subirDocumento(parentId, file) {
    if (!file?.buffer?.length) throw errorHttp('No se recibió el archivo', 400);
    const nombre = String(file.originalname || file.nombre || 'documento').trim().slice(0, 180);
    const mime = String(file.mimetype || 'application/octet-stream');
    if (!archivoPermitido(nombre, mime)) {
        throw errorHttp('Solo se permiten PDF, imágenes, Word, Excel o PowerPoint', 415);
    }
    const { nodo } = await asegurarNodoEnRegistros(parentId || CARPETA_REGISTROS_ID);
    const padreId = nodo.id || CARPETA_REGISTROS_ID;

    const existente = await buscarExistenteEnRegistros(nombre);
    if (existente?.id) {
        const resultado = await ligarArchivoACarpeta(existente, padreId);
        invalidarCache();
        return resultado;
    }

    const subido = await driveService.subirArchivoNuevo(file.buffer, nombre, mime, padreId);
    invalidarCache();
    return {
        archivo: mapearArchivo(subido) || {
            id: subido.id,
            nombre: subido.name,
            tipo: clasificarArchivo(subido),
            mimeType: mime,
            webViewLink: subido.webViewLink
        },
        accion: 'subido',
        ligado: false,
        mensaje: 'Archivo subido correctamente.'
    };
}

async function eliminarItem(itemId) {
    const id = String(itemId || '').trim();
    if (!id || id === CARPETA_REGISTROS_ID || id === CARPETA_RH_ID) {
        throw errorHttp('No se puede eliminar este elemento', 400);
    }
    await asegurarNodoEnRegistros(id);
    try {
        await driveService.eliminarArchivo(id);
        invalidarCache();
        return { eliminado: true, id, modo: 'borrado' };
    } catch (error) {
        const codigo = Number(error?.statusCode || error?.code || error?.status || 0);
        const msg = String(error?.message || '');
        const esPermiso = codigo === 403 || /sin permiso|insufficient permissions|forbidden/i.test(msg);
        if (!esPermiso) throw error;
        throw errorHttp(
            'Sin permiso en Google Drive para eliminar este archivo. Ábrelo en Drive o pide permiso al propietario.',
            403
        );
    }
}

async function renombrarItem(itemId, nombre) {
    const id = String(itemId || '').trim();
    const nombreLimpio = String(nombre || '').trim().replace(/[\\/]+/g, ' ').slice(0, 180);
    if (!id || id === CARPETA_REGISTROS_ID || id === CARPETA_RH_ID) {
        throw errorHttp('No se puede renombrar este elemento', 400);
    }
    if (!nombreLimpio) throw errorHttp('El nombre es obligatorio', 400);
    await asegurarNodoEnRegistros(id);
    const meta = await obtenerMetadatosConPadres(id);
    if (meta?.mimeType === MIME_FOLDER) {
        throw errorHttp('Usa el administrador de carpetas para renombrar carpetas', 400);
    }
    await driveService.renombrarArchivoPorId(id, nombreLimpio);
    invalidarCache();
    return { id, nombre: nombreLimpio };
}

async function obtenerTokenDrive() {
    const auth = driveService.getAuthClient();
    if (!auth) return null;
    if (typeof auth.getAccessToken === 'function') {
        const token = await auth.getAccessToken();
        return token?.token || token || null;
    }
    const creds = auth.credentials || {};
    return creds.access_token || null;
}

/** Thumbnail autenticado de Drive (evita CORS del frontend). */
async function bajarThumbnailDrive(fileId) {
    const drive = getDrive();
    const meta = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, hasThumbnail, thumbnailLink, shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });
    let id = fileId;
    let info = meta.data;
    if (String(info?.mimeType || '') === 'application/vnd.google-apps.shortcut') {
        const targetId = String(info?.shortcutDetails?.targetId || '').trim();
        if (targetId) {
            id = targetId;
            const target = await drive.files.get({
                fileId: targetId,
                fields: 'id, name, mimeType, hasThumbnail, thumbnailLink',
                supportsAllDrives: true
            });
            info = target.data;
        }
    }
    const link = String(info?.thumbnailLink || '').trim();
    if (!link) return { buffer: null, info, id };
    const url = link.replace(/=s\d+/, '=s480');
    const headers = {};
    const token = await obtenerTokenDrive();
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 12000,
        headers,
        validateStatus: (status) => status >= 200 && status < 400
    });
    return { buffer: Buffer.from(resp.data || []), info, id };
}

async function servirArchivo(fileId, { miniatura = false } = {}) {
    let id = String(fileId || '').trim();
    if (!id) throw errorHttp('Archivo inválido', 400);
    await asegurarNodoEnRegistros(id);
    // Incluye shortcutDetails: obtenerInfoArchivo() del driveService no los trae.
    let meta = await obtenerMetadatosConPadres(id);
    if (String(meta?.mimeType || '') === 'application/vnd.google-apps.shortcut') {
        const targetId = String(meta?.shortcutDetails?.targetId || '').trim();
        if (!targetId) throw errorHttp('Atajo de Drive sin destino', 404);
        id = targetId;
        meta = await obtenerMetadatosConPadres(id);
    }
    const tipo = clasificarArchivo(meta || {});
    const mime = String(meta?.mimeType || '').toLowerCase();

    if (miniatura) {
        const cached = cacheMiniaturas.get(id);
        if (cached && cached.expiresAt > Date.now()) {
            return { ...cached.payload, inline: true };
        }

        let thumb = null;
        try {
            const driveThumb = await bajarThumbnailDrive(id);
            if (driveThumb.buffer && driveThumb.buffer.length > 40) {
                thumb = await sharp(driveThumb.buffer)
                    .rotate()
                    .resize(480, 640, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
            }
        } catch { /* fallback abajo */ }

        if (!thumb && tipo === 'imagen') {
            const original = await driveService.descargarArchivo(id);
            if (original?.length) {
                thumb = await sharp(original)
                    .rotate()
                    .resize(480, 640, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 78 })
                    .toBuffer();
            }
        }

        if (!thumb || !thumb.length) {
            throw errorHttp('Miniatura no disponible', 404);
        }
        const payload = {
            buffer: thumb,
            mimeType: 'image/jpeg',
            nombre: `${String(meta?.name || 'miniatura').replace(/\.[^.]+$/, '')}.jpg`
        };
        cacheMiniaturas.set(id, { expiresAt: Date.now() + CACHE_MINIATURA_TTL_MS, payload });
        return { ...payload, inline: true };
    }

    // Nunca redirigir a Drive: el XHR del frontend falla por CORS.
    if (tipo === 'pdf' || tipo === 'imagen' || mime === MIME_PDF || MIME_IMAGEN.has(mime)) {
        const buffer = await driveService.descargarArchivo(id);
        if (!buffer?.length) throw errorHttp('No se pudo descargar el archivo', 404);
        return {
            buffer,
            mimeType: meta?.mimeType || (tipo === 'pdf' ? MIME_PDF : 'image/jpeg'),
            nombre: meta?.name || 'archivo',
            inline: true
        };
    }

    if (tipo === 'documento' || MIME_OFFICE.has(mime) || mime.startsWith('application/vnd.google-apps.')) {
        try {
            const buffer = await driveService.exportarArchivoPDF(id);
            if (buffer?.length) {
                return {
                    buffer,
                    mimeType: MIME_PDF,
                    nombre: `${String(meta?.name || 'documento').replace(/\.[^.]+$/, '')}.pdf`,
                    inline: true
                };
            }
        } catch { /* intentar binario */ }
        const buffer = await driveService.descargarArchivo(id).catch(() => null);
        if (buffer?.length) {
            return {
                buffer,
                mimeType: meta?.mimeType || 'application/octet-stream',
                nombre: meta?.name || 'archivo',
                inline: true
            };
        }
    }

    throw errorHttp('No se puede servir este archivo de forma segura desde la API', 415);
}

/**
 * ¿El archivo cuelga de la carpeta RH o de Registros?
 */
async function perteneceAArbolRh(fileId) {
    const id = String(fileId || '').trim();
    if (!id) return false;
    if (id === CARPETA_RH_ID || id === CARPETA_REGISTROS_ID) return true;
    const visitados = new Set();
    let actual = id;
    while (actual && !visitados.has(actual)) {
        visitados.add(actual);
        if (actual === CARPETA_RH_ID || actual === CARPETA_REGISTROS_ID) return true;
        let meta;
        try {
            meta = await obtenerMetadatosConPadres(actual);
        } catch {
            return false;
        }
        const padres = Array.isArray(meta.parents) ? meta.parents : [];
        if (!padres.length) return false;
        actual = padres[0];
    }
    return false;
}

function mapearCandidatoLigar(file, destinoId) {
    const mapped = mapearArchivo(file);
    if (!mapped) return null;
    const padres = Array.isArray(file.parents) ? file.parents : [];
    return {
        ...mapped,
        yaEnDestino: !!destinoId && padres.includes(destinoId)
    };
}

/**
 * Busca documentos existentes (Drive bajo RH) para ligarlos sin resubir.
 */
async function buscarCandidatosLigar(query, { parentId = null, limite = 25 } = {}) {
    const q = String(query || '').trim();
    const destinoId = String(parentId || CARPETA_REGISTROS_ID).trim() || CARPETA_REGISTROS_ID;
    await asegurarNodoEnRegistros(destinoId);

    if (q.length < 2) {
        return { documentos: [], query: q, minimo: 2 };
    }

    const drive = getDrive();
    const escaped = q.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const baseParams = {
        q: `name contains '${escaped}' and trashed=false and mimeType!='${MIME_FOLDER}'`,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, parents)',
        pageSize: Math.min(50, Math.max(limite * 2, 20)),
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    };

    let files = [];
    try {
        const response = await drive.files.list({ ...baseParams, orderBy: 'modifiedTime desc' });
        files = response.data.files || [];
    } catch {
        const response = await drive.files.list(baseParams);
        files = response.data.files || [];
    }

    const documentos = [];
    for (const f of files) {
        if (!(await perteneceAArbolRh(f.id))) continue;
        const item = mapearCandidatoLigar(f, destinoId);
        if (!item) continue;
        documentos.push(item);
        if (documentos.length >= limite) break;
    }

    return { documentos, query: q, minimo: 2 };
}

async function crearAtajoEnCarpeta(targetFileId, nombre, carpetaDestinoId) {
    const drive = getDrive();
    const targetId = String(targetFileId || '').trim();
    const destino = String(carpetaDestinoId || '').trim();
    const label = String(nombre || 'Documento').trim().slice(0, 180) || 'Documento';
    if (!targetId || !destino) throw errorHttp('No se pudo crear el enlace', 400);

    const hijos = await listarHijos(destino);
    const ya = hijos.find((h) => {
        if (String(h.mimeType || '') !== 'application/vnd.google-apps.shortcut') return false;
        return String(h.shortcutDetails?.targetId || '') === targetId;
    });
    if (ya) {
        return {
            archivo: mapearArchivo(ya),
            accion: 'existente',
            ligado: true,
            mensaje: 'El documento ya estaba ligado en esta carpeta.'
        };
    }

    const created = await drive.files.create({
        requestBody: {
            name: label,
            mimeType: 'application/vnd.google-apps.shortcut',
            parents: [destino],
            shortcutDetails: { targetId }
        },
        fields: 'id, name, mimeType, size, modifiedTime, webViewLink, shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });

    return {
        archivo: mapearArchivo(created.data) || {
            id: created.data.id,
            nombre: created.data.name,
            tipo: 'documento',
            mimeType: created.data.mimeType,
            webViewLink: created.data.webViewLink
                || `https://drive.google.com/file/d/${targetId}/view`,
            esAtajo: true,
            targetId
        },
        accion: 'ligado',
        ligado: true,
        mensaje: 'Documento ligado sin duplicar (mismo archivo del sistema).'
    };
}

/**
 * Liga un archivo existente (por id) a la carpeta destino sin subir binario.
 * Si no se puede añadir como padre (fuera de RH / permisos), crea un atajo.
 */
async function ligarDocumentoPorId(fileId, parentId = null, opciones = {}) {
    const id = String(fileId || '').trim();
    if (!id) throw errorHttp('Documento inválido', 400);

    const meta = await obtenerMetadatosConPadres(id);
    if (!meta?.id || meta.mimeType === MIME_FOLDER) {
        throw errorHttp('Documento inválido', 400);
    }

    const { nodo } = await asegurarNodoEnRegistros(parentId || CARPETA_REGISTROS_ID);
    const destinoId = nodo.id || CARPETA_REGISTROS_ID;
    const nombrePreferido = String(opciones.nombre || meta.name || 'Documento').trim();

    const enRh = await perteneceAArbolRh(id);
    if (enRh) {
        try {
            const resultado = await ligarArchivoACarpeta(meta, destinoId);
            invalidarCache();
            return resultado;
        } catch (err) {
            console.warn('[rrhh-registros] addParents falló, se crea atajo:', err.message);
        }
    }

    const atajo = await crearAtajoEnCarpeta(id, nombrePreferido, destinoId);
    invalidarCache();
    return atajo;
}

async function ligarDocumentoResuelto({
    fileId,
    codigo,
    nombreDocumento,
    parentId
} = {}) {
    const id = String(fileId || '').trim();
    if (!id) throw errorHttp('No se encontró el archivo Drive del documento en el sistema', 404);
    const nombre = [codigo, nombreDocumento].filter(Boolean).join(' · ').trim()
        || nombreDocumento
        || codigo
        || 'Documento';
    return ligarDocumentoPorId(id, parentId, { nombre });
}

module.exports = {
    CARPETA_REGISTROS_ID,
    CARPETA_DRIVE_URL,
    TITULO_MODULO,
    USERNAMES_REGISTROS_RH,
    usernamePuedeRegistrosRh,
    usuarioPuedeRegistrosRh,
    listarContenido,
    crearSubcarpeta,
    crearCarpetasSugeridas,
    subirDocumento,
    buscarCandidatosLigar,
    ligarDocumentoPorId,
    ligarDocumentoResuelto,
    eliminarItem,
    renombrarItem,
    servirArchivo,
    invalidarCache
};
