/**
 * Recursos Humanos — Expediente documental de colaboradores.
 * Fuente: carpeta de Drive «Recursos humanos».
 * Se excluyen las subcarpetas FORMATOS RH y Residentes.
 *
 * Listado liviano + navegación por carpetas (sin aplanar todo el árbol).
 */
const { google } = require('googleapis');
const axios = require('axios');
const sharp = require('sharp');
const driveService = require('./driveService');

const CARPETA_RH_ID = '1Jg9BYyilu6PTPb8dIWnCI5GjmWraPUU3';
const CARPETA_DRIVE_URL = `https://drive.google.com/drive/folders/${CARPETA_RH_ID}`;
const EXCLUIDAS = new Set(['formatos rh', 'residentes']);
const CACHE_TTL_MS = 120 * 1000;
const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_PDF = 'application/pdf';
const MIME_IMAGEN = new Set([
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

const CARPETAS_SUGERIDAS = [
    'Acreditaciones',
    'Certificados Médicos',
    'Identificación',
    'Contratos',
    'Comprobantes',
    'Otros'
];

let cacheListado = { expiresAt: 0, payload: null };
const cacheContenido = new Map();
const cacheMiniaturas = new Map();
const cachePermisoArchivo = new Map();
const CACHE_MINIATURA_TTL_MS = 30 * 60 * 1000;
const CACHE_PERMISO_TTL_MS = 5 * 60 * 1000;

function getDrive() {
    const auth = driveService.getAuthClient();
    if (!auth || !driveService.driveDisponible()) {
        throw new Error('Google Drive no está autenticado. Revisa la conexión de Drive.');
    }
    return google.drive({ version: 'v3', auth });
}

function normalizarNombre(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function carpetaExcluida(nombre) {
    return EXCLUIDAS.has(normalizarNombre(nombre));
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
    return null;
}

function inicialesDe(nombre) {
    const partes = String(nombre || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!partes.length) return 'C';
    const primera = partes[0][0];
    const segunda = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || '');
    return (primera + segunda).toUpperCase();
}

function formatearTamano(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function errorHttp(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

async function mapLimit(items, limit, mapper) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            out[i] = await mapper(items[i], i);
        }
    }
    const n = Math.max(1, Math.min(limit, items.length || 1));
    await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
    return out;
}

async function listarHijos(carpetaId) {
    const drive = getDrive();
    const files = [];
    let pageToken = null;
    do {
        const response = await drive.files.list({
            q: `'${carpetaId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)',
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
        fields: 'id, name, mimeType, size, parents, webViewLink, modifiedTime',
        supportsAllDrives: true
    });
    return response.data;
}

/**
 * Cadena de padres hasta la raíz RH (incluye el propio id).
 * Devuelve null si no pertenece al árbol RH o toca una carpeta excluida.
 */
async function cadenaAncestrosHastaRh(fileId) {
    const cadena = [];
    const visitados = new Set();
    let actual = String(fileId || '').trim();
    while (actual && !visitados.has(actual)) {
        visitados.add(actual);
        if (actual === CARPETA_RH_ID) {
            cadena.push({ id: CARPETA_RH_ID, nombre: 'Recursos humanos' });
            return cadena;
        }
        let meta;
        try {
            meta = await obtenerMetadatosConPadres(actual);
        } catch {
            return null;
        }
        if (carpetaExcluida(meta.name) && actual !== fileId) {
            return null;
        }
        cadena.push({ id: meta.id, nombre: meta.name, mimeType: meta.mimeType });
        const padres = Array.isArray(meta.parents) ? meta.parents : [];
        if (!padres.length) return null;
        actual = padres[0];
    }
    return null;
}

async function resolverColaboradorDesdeCadena(cadena) {
    if (!Array.isArray(cadena) || cadena.length < 2) return null;
    // cadena[0] = nodo actual … última = RH
    // colaborador = hijo directo de RH = penúltimo cuando llegamos a RH
    const idxRh = cadena.findIndex((n) => n.id === CARPETA_RH_ID);
    if (idxRh < 1) return null;
    const colaborador = cadena[idxRh - 1];
    if (!colaborador || carpetaExcluida(colaborador.nombre)) return null;
    return colaborador;
}

async function asegurarEsColaborador(folderId) {
    const id = String(folderId || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
        throw errorHttp('Identificador de colaborador inválido', 400);
    }
    const hijos = await listarHijos(CARPETA_RH_ID);
    const carpeta = hijos.find((h) =>
        h.id === id
        && h.mimeType === MIME_FOLDER
        && !carpetaExcluida(h.name)
    );
    if (!carpeta) {
        throw errorHttp('Colaborador no encontrado o carpeta excluida', 404);
    }
    return carpeta;
}

async function asegurarNodoEnExpediente(colaboradorId, nodoId) {
    const colab = await asegurarEsColaborador(colaboradorId);
    const target = String(nodoId || colaboradorId).trim() || colaboradorId;
    if (target === colaboradorId) {
        return { colaborador: colab, nodo: colab, cadena: [{ id: colab.id, nombre: colab.name }] };
    }
    const cadena = await cadenaAncestrosHastaRh(target);
    if (!cadena) {
        throw errorHttp('La carpeta no pertenece al expediente de Recursos Humanos', 404);
    }
    const colabCadena = await resolverColaboradorDesdeCadena(cadena);
    if (!colabCadena || colabCadena.id !== colaboradorId) {
        throw errorHttp('La carpeta no pertenece a este colaborador', 403);
    }
    return {
        colaborador: colab,
        nodo: { id: cadena[0].id, name: cadena[0].nombre, mimeType: cadena[0].mimeType },
        cadena: cadena.slice(0, cadena.findIndex((n) => n.id === CARPETA_RH_ID)).reverse()
    };
}

function mapearArchivo(file) {
    const tipo = clasificarArchivo(file);
    if (!tipo) return null;
    return {
        id: file.id,
        nombre: file.name,
        tipo,
        mimeType: file.mimeType || (tipo === 'pdf' ? MIME_PDF : 'image/jpeg'),
        tamano: Number(file.size) || null,
        tamanoLabel: formatearTamano(file.size),
        modificado: file.modifiedTime || null,
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    };
}

function mapearCarpeta(file, conteo = null) {
    return {
        id: file.id,
        nombre: file.name,
        modificado: file.modifiedTime || null,
        webViewLink: `https://drive.google.com/drive/folders/${file.id}`,
        items: conteo
    };
}

async function resumenNivel(carpetaId) {
    const hijos = await listarHijos(carpetaId);
    let carpetas = 0;
    let archivos = 0;
    let fotoFileId = null;
    let modificado = null;
    for (const h of hijos) {
        if (h.mimeType === MIME_FOLDER) {
            if (!carpetaExcluida(h.name)) carpetas += 1;
            continue;
        }
        const tipo = clasificarArchivo(h);
        if (!tipo) continue;
        archivos += 1;
        if (tipo === 'imagen' && !fotoFileId) fotoFileId = h.id;
        if (h.modifiedTime && (!modificado || h.modifiedTime > modificado)) {
            modificado = h.modifiedTime;
        }
    }
    return { carpetas, archivos, items: carpetas + archivos, fotoFileId, modificado };
}

function tokensNombre(norm) {
    return String(norm || '')
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length > 1);
}

function puntajeCoincidenciaNombre(folderNorm, userNorm) {
    if (!folderNorm || !userNorm) return 0;
    if (folderNorm === userNorm) return 100;
    if (folderNorm.startsWith(userNorm) || userNorm.startsWith(folderNorm)) return 85;
    const tokens = tokensNombre(userNorm);
    if (tokens.length >= 2 && tokens.every((t) => folderNorm.includes(t))) return 70;
    const folderTokens = new Set(tokensNombre(folderNorm));
    const overlap = tokens.filter((t) => folderTokens.has(t)).length;
    if (tokens.length && overlap >= 2 && overlap / tokens.length >= 0.75) return 55;
    return 0;
}

function mejorUsuarioParaCarpeta(folderName, usuarios, usados) {
    const folderNorm = normalizarNombre(folderName);
    let best = null;
    let bestScore = 40;
    for (const usuario of usuarios) {
        if (usados.has(usuario.id)) continue;
        const full = normalizarNombre(`${usuario.nombre || ''} ${usuario.apellido || ''}`);
        const score = puntajeCoincidenciaNombre(folderNorm, full);
        if (score > bestScore) {
            bestScore = score;
            best = usuario;
        }
    }
    return best;
}

async function listarUsuariosOrganigrama(pool) {
    if (!pool || typeof pool.query !== 'function') return [];
    try {
        const [rows] = await pool.query(
            `SELECT u.id, u.nombre, u.apellido, u.organigrama, u.foto_url, u.email, u.telefono
             FROM usuario u
             JOIN roles r ON u.rol_id = r.rol_id
             WHERE u.activo = 1
               AND r.nombre_rol NOT IN ('root', 'empresa')`
        );
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn('[RRHH] No se pudo leer puestos del organigrama:', error.message);
        return [];
    }
}

async function enriquecerConOrganigrama(colaboradores, pool) {
    const usuarios = await listarUsuariosOrganigrama(pool);
    if (!usuarios.length) {
        return colaboradores.map((c) => ({
            ...c,
            organigrama: null,
            usuarioId: null,
            fotoUrl: null,
            email: null,
            telefono: null,
            tieneExpediente: true
        }));
    }

    const usados = new Set();
    const enriquecidos = colaboradores.map((c) => {
        const match = mejorUsuarioParaCarpeta(c.nombre, usuarios, usados);
        if (match) usados.add(match.id);
        return {
            ...c,
            organigrama: match?.organigrama ? String(match.organigrama).trim() : null,
            usuarioId: match?.id || null,
            fotoUrl: match?.foto_url || null,
            email: match?.email || null,
            telefono: match?.telefono || null,
            tieneExpediente: true
        };
    });

    for (const usuario of usuarios) {
        if (usados.has(usuario.id)) continue;
        const puesto = String(usuario.organigrama || '').trim();
        if (!puesto) continue;
        const nombre = `${usuario.nombre || ''} ${usuario.apellido || ''}`.trim() || 'Colaborador';
        enriquecidos.push({
            id: `u:${usuario.id}`,
            nombre,
            iniciales: inicialesDe(nombre),
            carpetas: 0,
            archivos: 0,
            documentos: 0,
            fotoFileId: null,
            fotoUrl: usuario.foto_url || null,
            modificado: null,
            webViewLink: null,
            organigrama: puesto,
            usuarioId: usuario.id,
            email: usuario.email || null,
            telefono: usuario.telefono || null,
            tieneExpediente: false
        });
    }

    return enriquecidos;
}

async function listarColaboradores({ forzar = false, pool = null } = {}) {
    if (!forzar && cacheListado.payload && cacheListado.expiresAt > Date.now()) {
        return cacheListado.payload;
    }

    const hijos = await listarHijos(CARPETA_RH_ID);
    const carpetas = hijos
        .filter((h) => h.mimeType === MIME_FOLDER && !carpetaExcluida(h.name))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));

    const carpetasMapeadas = await mapLimit(carpetas, 5, async (carpeta) => {
        const resumen = await resumenNivel(carpeta.id);
        return {
            id: carpeta.id,
            nombre: carpeta.name,
            iniciales: inicialesDe(carpeta.name),
            carpetas: resumen.carpetas,
            archivos: resumen.archivos,
            documentos: resumen.items,
            fotoFileId: resumen.fotoFileId,
            modificado: resumen.modificado || carpeta.modifiedTime || null,
            webViewLink: `https://drive.google.com/drive/folders/${carpeta.id}`
        };
    });

    const colaboradores = await enriquecerConOrganigrama(carpetasMapeadas, pool);

    const payload = {
        carpetaId: CARPETA_RH_ID,
        carpetaUrl: CARPETA_DRIVE_URL,
        total: colaboradores.length,
        documentos: colaboradores.reduce((acc, c) => acc + (c.documentos || 0), 0),
        carpetasSugeridas: CARPETAS_SUGERIDAS,
        colaboradores
    };
    cacheListado = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    return payload;
}

async function listarContenido(colaboradorId, carpetaId = null, { forzar = false } = {}) {
    const { colaborador, nodo, cadena } = await asegurarNodoEnExpediente(
        colaboradorId,
        carpetaId || colaboradorId
    );
    const actualId = String(nodo.id || colaborador.id);
    const cacheKey = `${colaborador.id}:${actualId}`;
    if (!forzar) {
        const cached = cacheContenido.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.payload;
        }
    }

    if (nodo.mimeType && nodo.mimeType !== MIME_FOLDER && actualId !== colaborador.id) {
        throw errorHttp('El destino no es una carpeta', 400);
    }

    const hijos = await listarHijos(actualId);
    const carpetas = [];
    const archivos = [];

    for (const h of hijos) {
        if (h.mimeType === MIME_FOLDER) {
            if (carpetaExcluida(h.name)) continue;
            carpetas.push(mapearCarpeta(h));
            continue;
        }
        const archivo = mapearArchivo(h);
        if (archivo) archivos.push(archivo);
    }

    carpetas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    archivos.sort((a, b) => {
        if (a.tipo !== b.tipo) return a.tipo === 'imagen' ? -1 : 1;
        return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
    });

    // Conteos ligeros solo del primer nivel de cada subcarpeta (paralelo acotado)
    const conteos = await mapLimit(carpetas, 4, async (c) => resumenNivel(c.id));
    carpetas.forEach((c, i) => {
        c.items = conteos[i]?.items || 0;
        c.archivos = conteos[i]?.archivos || 0;
        c.carpetas = conteos[i]?.carpetas || 0;
    });

    const migas = (cadena && cadena.length)
        ? cadena.map((n) => ({ id: n.id, nombre: n.nombre }))
        : [{ id: colaborador.id, nombre: colaborador.name }];

    const payload = {
        colaborador: {
            id: colaborador.id,
            nombre: colaborador.name,
            iniciales: inicialesDe(colaborador.name),
            webViewLink: `https://drive.google.com/drive/folders/${colaborador.id}`
        },
        carpetaActual: {
            id: actualId,
            nombre: actualId === colaborador.id ? 'Expediente' : (nodo.name || nodo.nombre || 'Carpeta'),
            esRaiz: actualId === colaborador.id,
            webViewLink: `https://drive.google.com/drive/folders/${actualId}`
        },
        migas,
        carpetas,
        archivos,
        totales: {
            carpetas: carpetas.length,
            archivos: archivos.length
        },
        carpetasSugeridas: CARPETAS_SUGERIDAS
    };

    cacheContenido.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return payload;
}

function invalidarCache(colaboradorId = null) {
    cacheListado = { expiresAt: 0, payload: null };
    cacheMiniaturas.clear();
    cachePermisoArchivo.clear();
    if (!colaboradorId) {
        cacheContenido.clear();
        return;
    }
    for (const key of cacheContenido.keys()) {
        if (key.startsWith(`${colaboradorId}:`)) {
            cacheContenido.delete(key);
        }
    }
}

async function crearSubcarpeta(colaboradorId, parentId, nombre) {
    const nombreLimpio = String(nombre || '').trim().replace(/[\\/]+/g, ' ').slice(0, 120);
    if (!nombreLimpio) {
        throw errorHttp('El nombre de la carpeta es obligatorio', 400);
    }
    if (carpetaExcluida(nombreLimpio)) {
        throw errorHttp('Ese nombre de carpeta está reservado', 400);
    }
    const { nodo } = await asegurarNodoEnExpediente(colaboradorId, parentId || colaboradorId);
    const padreId = nodo.id || colaboradorId;
    const id = await driveService.crearCarpeta(nombreLimpio, padreId);
    invalidarCache(colaboradorId);
    return {
        id,
        nombre: nombreLimpio,
        webViewLink: `https://drive.google.com/drive/folders/${id}`
    };
}

async function crearCarpetasSugeridas(colaboradorId) {
    const colab = await asegurarEsColaborador(colaboradorId);
    const hijos = await listarHijos(colab.id);
    const existentes = new Set(hijos.filter((h) => h.mimeType === MIME_FOLDER).map((h) => normalizarNombre(h.name)));
    const creadas = [];
    for (const nombre of CARPETAS_SUGERIDAS) {
        if (existentes.has(normalizarNombre(nombre))) continue;
        const id = await driveService.crearCarpeta(nombre, colab.id);
        creadas.push({ id, nombre });
    }
    invalidarCache(colaboradorId);
    return { creadas, total: creadas.length };
}

async function subirDocumento(colaboradorId, parentId, file) {
    if (!file?.buffer?.length) {
        throw errorHttp('No se recibió el archivo', 400);
    }
    const nombre = String(file.originalname || file.nombre || 'documento').trim().slice(0, 180);
    const mime = String(file.mimetype || 'application/octet-stream');
    const tipo = clasificarArchivo({ name: nombre, mimeType: mime });
    if (!tipo) {
        throw errorHttp('Solo se permiten PDF, JPG o JPEG (también PNG/WEBP)', 415);
    }
    const { nodo } = await asegurarNodoEnExpediente(colaboradorId, parentId || colaboradorId);
    const padreId = nodo.id || colaboradorId;
    const subido = await driveService.subirArchivoNuevo(file.buffer, nombre, mime, padreId);
    invalidarCache(colaboradorId);
    return mapearArchivo(subido) || {
        id: subido.id,
        nombre: subido.name,
        tipo,
        mimeType: mime,
        webViewLink: subido.webViewLink
    };
}

/**
 * Quita el archivo/carpeta del expediente sin borrarlo en Drive.
 * Necesario cuando el dueño es otra cuenta (p. ej. maferbeh…) y no hay canDelete/canTrash,
 * pero sí se puede reorganizar con removeParents.
 */
async function desvincularDelExpediente(fileId) {
    const drive = getDrive();
    const meta = await obtenerMetadatosConPadres(fileId);
    const parents = Array.isArray(meta.parents) ? meta.parents.filter(Boolean) : [];
    if (!parents.length) {
        return { desvinculado: false, nombre: meta.name || null };
    }
    await drive.files.update({
        fileId,
        removeParents: parents.join(','),
        fields: 'id, parents',
        supportsAllDrives: true
    });
    return { desvinculado: true, nombre: meta.name || null, parentsQuitados: parents };
}

async function eliminarItem(colaboradorId, itemId) {
    const id = String(itemId || '').trim();
    if (!id || id === colaboradorId || id === CARPETA_RH_ID) {
        throw errorHttp('No se puede eliminar este elemento', 400);
    }
    await asegurarNodoEnExpediente(colaboradorId, id);

    // 1) Borrado / papelera normal (archivos que sí son de risktechbiznaga)
    try {
        await driveService.eliminarArchivo(id);
        invalidarCache(colaboradorId);
        return { eliminado: true, id, modo: 'borrado' };
    } catch (error) {
        const codigo = Number(error?.statusCode || error?.code || error?.status || 0);
        const msg = String(error?.message || '');
        const esPermiso = codigo === 403 || /sin permiso|insufficient permissions|forbidden/i.test(msg);
        if (!esPermiso) {
            throw error;
        }
    }

    // 2) Fallback: sacar del expediente (sin borrar en la cuenta del dueño original)
    try {
        const result = await desvincularDelExpediente(id);
        if (!result.desvinculado) {
            throw errorHttp('No se pudo quitar el elemento del expediente', 500);
        }
        invalidarCache(colaboradorId);
        return {
            eliminado: true,
            id,
            modo: 'desvinculado',
            message: 'Se quitó del expediente. El archivo sigue en Drive del propietario original (sin permiso de borrado).'
        };
    } catch (unlinkErr) {
        const codigo = Number(unlinkErr?.statusCode || unlinkErr?.code || unlinkErr?.status || 0);
        if (codigo >= 400 && codigo < 600 && unlinkErr?.statusCode) {
            throw unlinkErr;
        }
        throw errorHttp(
            'Sin permiso en Google Drive para eliminar este archivo. ' +
            'Algunos documentos los subió otra cuenta; pídele al propietario que te dé permiso de edición o bórralos desde su Drive.',
            403
        );
    }
}

function extensionDeNombre(nombre) {
    const n = String(nombre || '');
    const i = n.lastIndexOf('.');
    if (i <= 0 || i === n.length - 1) return '';
    return n.slice(i);
}

function sanitizarNombreArchivo(nombreOriginal, nombreNuevo) {
    const ext = extensionDeNombre(nombreOriginal);
    let next = String(nombreNuevo || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ');
    if (!next) {
        throw errorHttp('El nombre no puede quedar vacío', 400);
    }
    if (ext && !next.toLowerCase().endsWith(ext.toLowerCase())) {
        next += ext;
    }
    return next.slice(0, 180);
}

async function reescribirDocumentos(colaboradorId, cambios) {
    if (!Array.isArray(cambios) || !cambios.length) {
        throw errorHttp('No hay archivos para reescribir', 400);
    }
    if (cambios.length > 80) {
        throw errorHttp('Puedes reescribir hasta 80 archivos a la vez', 400);
    }

    const resultados = [];
    for (const cambio of cambios) {
        const id = String(cambio?.id || cambio?.itemId || '').trim();
        if (!id) continue;
        await asegurarNodoEnExpediente(colaboradorId, id);
        const meta = await driveService.obtenerInfoArchivo(id);
        if (!meta || meta.mimeType === MIME_FOLDER) {
            throw errorHttp('Solo se pueden reescribir nombres de archivos', 400);
        }
        const original = String(meta.name || '').trim();
        const finalName = sanitizarNombreArchivo(original, cambio?.nombre || cambio?.nombreNuevo);
        if (finalName === original) {
            resultados.push({ id, nombre: original, sinCambio: true });
            continue;
        }
        await driveService.renombrarArchivoPorId(id, finalName);
        resultados.push({ id, nombre: finalName, anterior: original, sinCambio: false });
    }

    if (!resultados.length) {
        throw errorHttp('No hay archivos válidos para reescribir', 400);
    }

    invalidarCache(colaboradorId);
    const aplicados = resultados.filter((r) => !r.sinCambio).length;
    return {
        total: resultados.length,
        cambios: aplicados,
        resultados,
        message: aplicados
            ? `Se actualizaron ${aplicados} nombre(s) en Drive.`
            : 'No hubo cambios de nombre.'
    };
}

async function moverDocumento(colaboradorId, itemId, destinoCarpetaId) {
    const id = String(itemId || '').trim();
    const destino = String(destinoCarpetaId || '').trim();
    if (!id || !destino) {
        throw errorHttp('Origen y destino son obligatorios', 400);
    }
    if (id === destino) {
        throw errorHttp('No se puede mover un elemento sobre sí mismo', 400);
    }
    await asegurarNodoEnExpediente(colaboradorId, id);
    const { nodo } = await asegurarNodoEnExpediente(colaboradorId, destino);
    const destinoNombre = nodo.name || nodo.nombre || 'carpeta';
    if (nodo.mimeType && nodo.mimeType !== MIME_FOLDER && destino !== colaboradorId) {
        throw errorHttp('El destino debe ser una carpeta', 400);
    }

    // Solo move nativo (cambio de padre). Nunca copiar: eso duplicaba archivos
    // cuando el original era de otra cuenta y no se podía borrar.
    try {
        await driveService.moverArchivoDrive(id, destino);
    } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        const codigo = Number(error?.code || error?.status || error?.statusCode || error?.response?.status || 0);
        const esPermiso = codigo === 403 || msg.includes('insufficient') || msg.includes('forbidden') || msg.includes('permission');
        if (esPermiso) {
            throw errorHttp(
                `Sin permiso para mover este documento a «${destinoNombre}». ` +
                'Revisa que la carpeta del colaborador esté compartida con edición para risktechbiznaga@gmail.com.',
                403
            );
        }
        throw error;
    }

    invalidarCache(colaboradorId);
    return {
        movido: true,
        id,
        destinoId: destino,
        destinoNombre,
        modo: 'nativo',
        message: `Documento movido a «${destinoNombre}»`
    };
}

async function archivoPermitido(fileId) {
    const id = String(fileId || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) return false;
    const cached = cachePermisoArchivo.get(id);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ok;
    }
    const cadena = await cadenaAncestrosHastaRh(id);
    const colab = cadena ? await resolverColaboradorDesdeCadena(cadena) : null;
    const ok = !!colab;
    cachePermisoArchivo.set(id, { ok, expiresAt: Date.now() + CACHE_PERMISO_TTL_MS });
    return ok;
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

async function bajarThumbnailDrive(fileId) {
    const drive = getDrive();
    const meta = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, hasThumbnail, thumbnailLink',
        supportsAllDrives: true
    });
    const link = String(meta.data?.thumbnailLink || '').trim();
    if (!link) {
        return { buffer: null, info: meta.data };
    }
    const url = link.replace(/=s\d+/, '=s400');
    const headers = {};
    const token = await obtenerTokenDrive();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers,
        validateStatus: (status) => status >= 200 && status < 400
    });
    return {
        buffer: Buffer.from(resp.data || []),
        info: meta.data
    };
}

async function servirArchivo(fileId, { miniatura = false } = {}) {
    const id = String(fileId || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
        throw errorHttp('Identificador de archivo inválido', 400);
    }
    const permitido = await archivoPermitido(id);
    if (!permitido) {
        throw errorHttp('El archivo no pertenece al expediente de colaboradores', 404);
    }

    if (miniatura) {
        const cached = cacheMiniaturas.get(id);
        if (cached && cached.expiresAt > Date.now()) {
            return {
                buffer: cached.buffer,
                contentType: cached.contentType,
                filename: cached.filename,
                inline: true
            };
        }

        let info = null;
        let thumb = null;
        try {
            const driveThumb = await bajarThumbnailDrive(id);
            info = driveThumb.info;
            if (driveThumb.buffer && driveThumb.buffer.length > 40) {
                thumb = driveThumb.buffer;
            }
        } catch {
            info = await driveService.obtenerInfoArchivo(id).catch(() => null);
        }

        const tipo = clasificarArchivo(info || {});
        if (!tipo) {
            throw errorHttp('Tipo de archivo no admitido en el expediente', 415);
        }

        if (!thumb && tipo === 'imagen') {
            const buffer = await driveService.descargarArchivo(id);
            if (buffer && buffer.length) {
                thumb = await sharp(buffer)
                    .rotate()
                    .resize(360, 360, { fit: 'cover', withoutEnlargement: true })
                    .jpeg({ quality: 70, mozjpeg: true })
                    .toBuffer();
            }
        }

        if (!thumb || !thumb.length) {
            throw errorHttp('No hay miniatura disponible para este archivo', 404);
        }

        const payload = {
            buffer: thumb,
            contentType: 'image/jpeg',
            filename: `${String(info?.name || 'miniatura').replace(/\.[^.]+$/, '')}.jpg`,
            inline: true
        };
        cacheMiniaturas.set(id, {
            ...payload,
            expiresAt: Date.now() + CACHE_MINIATURA_TTL_MS
        });
        return payload;
    }

    const info = await driveService.obtenerInfoArchivo(id);
    const tipo = clasificarArchivo(info);
    if (!tipo) {
        throw errorHttp('Tipo de archivo no admitido en el expediente', 415);
    }

    const buffer = await driveService.descargarArchivo(id);
    if (!buffer || !buffer.length) {
        throw errorHttp('No se pudo descargar el archivo', 404);
    }

    const contentType = tipo === 'pdf'
        ? MIME_PDF
        : (info.mimeType && MIME_IMAGEN.has(String(info.mimeType).toLowerCase())
            ? info.mimeType
            : 'image/jpeg');

    return {
        buffer,
        contentType,
        filename: info.name || (tipo === 'pdf' ? 'documento.pdf' : 'imagen.jpg'),
        inline: true
    };
}

/** Compatibilidad: expediente = contenido raíz del colaborador */
async function obtenerExpediente(folderId, opts = {}) {
    return listarContenido(folderId, folderId, opts);
}

module.exports = {
    CARPETA_RH_ID,
    CARPETA_DRIVE_URL,
    CARPETAS_SUGERIDAS,
    listarColaboradores,
    listarContenido,
    obtenerExpediente,
    crearSubcarpeta,
    crearCarpetasSugeridas,
    subirDocumento,
    eliminarItem,
    reescribirDocumentos,
    moverDocumento,
    servirArchivo,
    invalidarCache
};
