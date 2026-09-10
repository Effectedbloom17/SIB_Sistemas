// =====================================================
// BIZNAGA R&T - Google Drive Service
// Módulo para gestionar archivos en Google Drive
// =====================================================

require('dotenv').config({ debug: false, quiet: true });
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const startupLog = require('./startupLog');

// =====================================================
// CONFIGURACIÓN
// =====================================================

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Logs de operaciones rutinarias (descargas/eliminaciones) solo con DRIVE_DEBUG=1
const DRIVE_DEBUG = String(process.env.DRIVE_DEBUG || '').trim() === '1';
function driveDebug(...args) {
    if (DRIVE_DEBUG) console.log(...args);
}

const OPCIONES_LISTADO_DRIVE = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
};

// --- Método de autenticación ---
// Prioridad 1: OAuth2 con refresh token (necesario para subir archivos en cuentas Gmail gratuitas)
// Prioridad 2: Service Account (solo lectura en cuentas sin Google Workspace)

let drive;
let authMethod = 'none';
let _driveAuthClient = null;
const DRIVE_AUTH_COOLDOWN_MS = 60 * 1000; // 60s cooldown (antes era 10min, demasiado agresivo)
let driveAuthBlockedUntil = 0;
let driveAuthLastError = null;
let driveAuthLastValidatedAt = null;
let arranqueAuthPromise = Promise.resolve({ ok: false, skipped: true });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

function esCredencialGooglePlaceholder(valor) {
    const v = String(valor || '').trim().toLowerCase();
    if (!v) return true;
    return (
        v.includes('xxxxx') ||
        v.includes('changeme') ||
        v.includes('tu_') ||
        v === 'id_carpeta_raiz_en_drive' ||
        v.startsWith('1//xxxxx') ||
        v === 'gocspx-xxxxx' ||
        /^x+\.apps\.googleusercontent\.com$/.test(v) ||
        v.endsWith('xxxxx.apps.googleusercontent.com')
    );
}

function oauthDriveConfigurado() {
    return (
        !esCredencialGooglePlaceholder(GOOGLE_CLIENT_ID) &&
        !esCredencialGooglePlaceholder(GOOGLE_CLIENT_SECRET) &&
        !esCredencialGooglePlaceholder(GOOGLE_REFRESH_TOKEN)
    );
}

function desactivarDrivePorFalloAuth(motivo) {
    authMethod = 'none';
    drive = null;
    _driveAuthClient = null;
    _oauth2Client = null;
    driveAuthBlockedUntil = Date.now() + DRIVE_AUTH_COOLDOWN_MS;
    driveAuthLastError = motivo || 'OAuth no disponible';
}

function driveDisponible() {
    return !!drive && authMethod !== 'none';
}

function extraerMensajeErrorDrive(error) {
    if (!error) return 'Error desconocido de Google Drive';
    return (
        error?.response?.data?.error_description ||
        error?.response?.data?.error?.message ||
        error?.errors?.[0]?.message ||
        error?.message ||
        'Error desconocido de Google Drive'
    );
}

function esErrorNoEncontradoDrive(error) {
    const mensaje = extraerMensajeErrorDrive(error).toLowerCase();
    const codigo = Number(error?.code || error?.response?.status || 0);

    return codigo === 404 ||
        mensaje.includes('file not found') ||
        mensaje.includes('not found');
}

/**
 * Escapa un valor para usarlo dentro de comillas simples en consultas de Google Drive.
 * Sin esto, nombres como "BENJIE'S" rompen la query y devuelven "Invalid Value".
 */
function escaparValorConsultaDrive(valor) {
    return String(valor ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

function esErrorAutenticacionDrive(error) {
    const mensaje = extraerMensajeErrorDrive(error).toLowerCase();
    const codigo = Number(error?.code || error?.response?.status || 0);

    if (codigo === 401) return true;

    // Estos 403 son funcionales/permiso de archivo, no token vencido.
    if (
        mensaje.includes('export only supports docs editors files') ||
        mensaje.includes('insufficientfilepermissions') ||
        mensaje.includes('insufficient permissions for this file') ||
        mensaje.includes('file not found')
    ) {
        return false;
    }

    return (
        mensaje.includes('invalid authentication credentials') ||
        mensaje.includes('token has been expired or revoked') ||
        mensaje.includes('invalid_grant') ||
        mensaje.includes('unauthenticated') ||
        mensaje.includes('login required')
    );
}

async function eliminarArchivoDrive(fileId, contexto = 'Archivo') {
    try {
        await drive.files.delete({
            fileId,
            supportsAllDrives: true
        });
        return true;
    } catch (error) {
        if (esErrorNoEncontradoDrive(error)) {
            driveDebug(`[DRIVE] ${contexto} ya no existe, se omite eliminación: ${fileId}`);
            return false;
        }

        // Fallback: enviar a papelera (a veces hay permiso de editar pero no de borrar permanente)
        const mensaje = String(error?.message || '').toLowerCase();
        const codigo = Number(error?.code || error?.status || error?.response?.status || 0);
        const esPermiso = codigo === 403 || mensaje.includes('insufficient permissions') || mensaje.includes('forbidden');
        if (esPermiso) {
            try {
                await drive.files.update({
                    fileId,
                    requestBody: { trashed: true },
                    supportsAllDrives: true
                });
                console.warn(`[WARN] ${contexto} enviado a papelera de Drive (sin permiso de borrado permanente): ${fileId}`);
                return true;
            } catch (trashErr) {
                const err = new Error(
                    'Sin permiso en Google Drive para eliminar este archivo. ' +
                    'Comparte la carpeta «Recursos humanos» con risktechbiznaga@gmail.com como Editor ' +
                    '(o pide al propietario que te dé permiso de edición).'
                );
                err.statusCode = 403;
                err.cause = trashErr;
                throw err;
            }
        }

        throw error;
    }
}

function construirMensajeErrorAuth(contexto, error) {
    const mensajeGoogle = extraerMensajeErrorDrive(error);
    return `[DRIVE-AUTH] ${contexto}: credenciales OAuth inválidas/expiradas. ` +
        `Ejecuta 'node backend/setup-google-oauth.js', actualiza GOOGLE_REFRESH_TOKEN en backend/.env y reinicia backend. ` +
        `Detalle: ${mensajeGoogle}`;
}

function registrarFalloAuthDrive(contexto, error) {
    driveAuthBlockedUntil = Date.now() + DRIVE_AUTH_COOLDOWN_MS;
    driveAuthLastError = construirMensajeErrorAuth(contexto, error);
    console.error(driveAuthLastError);
}

function validarBloqueoAuthDrive(contexto) {
    if (authMethod !== 'oauth2') return;
    if (Date.now() < driveAuthBlockedUntil) {
        const restanteSegundos = Math.ceil((driveAuthBlockedUntil - Date.now()) / 1000);
        throw new Error(`[DRIVE-AUTH] ${contexto}: Google Drive bloqueado temporalmente (${restanteSegundos}s) por error de autenticación previo. ${driveAuthLastError || ''}`);
    }
}

function robustecerClienteDrive() {
    if (!drive || !drive.files) return;

    const metodos = ['list', 'get', 'create', 'update', 'delete', 'export'];
    for (const metodo of metodos) {
        const original = drive.files[metodo];
        if (typeof original !== 'function') continue;
        if (original.__biznagaWrapped) continue;

        const wrapped = async (...args) => {
            validarBloqueoAuthDrive(`drive.files.${metodo}`);

            try {
                return await original.apply(drive.files, args);
            } catch (error) {
                if (esErrorAutenticacionDrive(error)) {
                    registrarFalloAuthDrive(`drive.files.${metodo}`, error);
                    throw new Error(construirMensajeErrorAuth(`drive.files.${metodo}`, error));
                }
                throw error;
            }
        };

        wrapped.__biznagaWrapped = true;
        drive.files[metodo] = wrapped;
    }
}

async function validarAutenticacionDrive(contexto = 'validación') {
    if (authMethod !== 'oauth2') {
        return { ok: true, authMethod };
    }

    validarBloqueoAuthDrive(contexto);

    try {
        const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
        driveAuthLastValidatedAt = new Date().toISOString();
        driveAuthLastError = null;
        driveAuthBlockedUntil = 0;
        return {
            ok: true,
            authMethod,
            email: about?.data?.user?.emailAddress || null,
            nombre: about?.data?.user?.displayName || null
        };
    } catch (error) {
        if (esErrorAutenticacionDrive(error)) {
            registrarFalloAuthDrive(contexto, error);
            return { ok: false, authMethod, message: construirMensajeErrorAuth(contexto, error) };
        }
        throw error;
    }
}

function obtenerEstadoAutenticacionDrive() {
    return {
        authMethod,
        blocked: Date.now() < driveAuthBlockedUntil,
        blockedUntil: driveAuthBlockedUntil ? new Date(driveAuthBlockedUntil).toISOString() : null,
        lastError: driveAuthLastError,
        lastValidatedAt: driveAuthLastValidatedAt
    };
}

// ── Persistir refresh tokens nuevos en .env automáticamente ──
function persistirRefreshToken(nuevoRefreshToken) {
    if (!nuevoRefreshToken) return;
    if (nuevoRefreshToken === GOOGLE_REFRESH_TOKEN) return;

    const envPaths = [
        path.join(__dirname, '.env'),
        path.join(__dirname, '.env.produccion')
    ];

    for (const envPath of envPaths) {
        try {
            if (!fs.existsSync(envPath)) continue;
            let contenido = fs.readFileSync(envPath, 'utf-8');
            const regex = /^GOOGLE_REFRESH_TOKEN=.+$/m;
            if (regex.test(contenido)) {
                contenido = contenido.replace(regex, `GOOGLE_REFRESH_TOKEN=${nuevoRefreshToken}`);
                fs.writeFileSync(envPath, contenido, 'utf-8');
                console.log(`[DRIVE-AUTH] Refresh token actualizado automáticamente en ${path.basename(envPath)}`);
            }
        } catch (err) {
            console.warn(`[DRIVE-AUTH] No se pudo actualizar ${path.basename(envPath)}: ${err.message}`);
        }
    }
}

// ── Forzar refresco de access token y limpiar bloqueo ──
let _oauth2Client = null;

async function forzarRefrescoToken() {
    if (!_oauth2Client || authMethod !== 'oauth2') {
        throw new Error('[DRIVE-AUTH] No hay cliente OAuth2 inicializado');
    }
    try {
        const { credentials } = await _oauth2Client.refreshAccessToken();
        if (credentials.refresh_token) {
            persistirRefreshToken(credentials.refresh_token);
        }
        _oauth2Client.setCredentials(credentials);
        // Limpiar bloqueo tras éxito
        driveAuthBlockedUntil = 0;
        driveAuthLastError = null;
        driveAuthLastValidatedAt = new Date().toISOString();
        console.log('[DRIVE-AUTH] Access token refrescado exitosamente');
        return { ok: true };
    } catch (error) {
        const msg = extraerMensajeErrorDrive(error);
        console.error(`[DRIVE-AUTH] Error refrescando token: ${msg}`);
        return { ok: false, message: msg };
    }
}

if (oauthDriveConfigurado()) {
    // ── OAuth2 con Refresh Token ──
    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    _oauth2Client = oauth2Client;
    _driveAuthClient = oauth2Client;

    // Escuchar evento de tokens nuevos (Google puede rotar el refresh token)
    oauth2Client.on('tokens', (tokens) => {
        if (tokens.refresh_token) {
            console.log('[DRIVE-AUTH] Google emitió un nuevo refresh token, persistiendo...');
            persistirRefreshToken(tokens.refresh_token);
        }
        // Limpiar bloqueo cuando obtenemos tokens válidos
        driveAuthBlockedUntil = 0;
        driveAuthLastError = null;
        driveAuthLastValidatedAt = new Date().toISOString();
    });

    drive = google.drive({ version: 'v3', auth: oauth2Client });
    authMethod = 'oauth2';
    robustecerClienteDrive();

    arranqueAuthPromise = (async () => {
        try {
            const result = await validarAutenticacionDrive('arranque');
            if (result.ok) {
                startupLog.serviceOk('Drive', result.email || 'OAuth2');
                return result;
            }
            const esDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
            if (esDev) {
                desactivarDrivePorFalloAuth(result.message);
                startupLog.serviceOk('Drive', 'omitido en desarrollo (OAuth inválido)');
                startupLog.detail(`[DRIVE-AUTH] ${result.message}`);
                return { ok: false, skipped: true, message: result.message };
            }
            startupLog.serviceFail('Drive', result.message || 'token inválido');
            return result;
        } catch (e) {
            const esDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
            if (esDev) {
                desactivarDrivePorFalloAuth(e.message);
                startupLog.serviceOk('Drive', 'omitido en desarrollo (OAuth no disponible)');
                startupLog.detail(`[DRIVE-AUTH] ${e.message}`);
                return { ok: false, skipped: true, message: e.message };
            }
            startupLog.serviceFail('Drive', e.message);
            return { ok: false, message: e.message };
        }
    })();
} else {
    // ── Fallback: Service Account ──
    const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json');

    if (!fs.existsSync(CREDENTIALS_PATH)) {
        const esProduccion = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
        if (esProduccion) {
            console.error('[ERROR] No se encontró credenciales de Google Drive.');
            console.error('   Configura OAuth2 (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
            console.error(`   O coloca el archivo Service Account en: ${CREDENTIALS_PATH}`);
            process.exit(1);
        }

        startupLog.serviceOk('Drive', 'omitido (sin credenciales reales)');
        authMethod = 'none';
        arranqueAuthPromise = Promise.resolve({ ok: false, skipped: true });
    } else {

        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        _driveAuthClient = auth;
        drive = google.drive({ version: 'v3', auth });
        authMethod = 'service-account';
        robustecerClienteDrive();

        startupLog.serviceOk('Drive', 'service account, solo lectura');
        startupLog.detail(`   Service Account: ${credentials.client_email}`);
        startupLog.detail(`   Carpeta raíz: ${ROOT_FOLDER_ID}`);
        arranqueAuthPromise = Promise.resolve({ ok: true, email: credentials.client_email });
        console.warn('[WARN] Los Service Accounts no pueden subir archivos en cuentas Gmail gratuitas.');
        console.warn('[WARN] Ejecuta: node setup-google-oauth.js para configurar OAuth2.');
    }
}

// =====================================================
// FUNCIONES DE CARPETAS
// =====================================================

/**
 * Buscar una carpeta por nombre dentro de una carpeta padre
 * @param {string} nombreCarpeta - Nombre de la carpeta a buscar
 * @param {string} carpetaPadreId - ID de la carpeta padre (null = raíz)
 * @returns {Promise<string|null>} - ID de la carpeta encontrada o null
 */
async function buscarCarpeta(nombreCarpeta, carpetaPadreId = ROOT_FOLDER_ID) {
    try {
        const query = `name='${escaparValorConsultaDrive(nombreCarpeta)}' and '${carpetaPadreId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

        const response = await drive.files.list({
            q: query,
            fields: 'files(id, name)',
            pageSize: 50,
            ...OPCIONES_LISTADO_DRIVE
        });

        if (response.data.files.length > 0) {
            return response.data.files[0].id;
        }
        return null;
    } catch (error) {
        console.error('[ERROR] Error buscando carpeta:', error.message);
        throw error;
    }
}

/**
 * Crear una carpeta en Google Drive
 * @param {string} nombreCarpeta - Nombre de la carpeta a crear
 * @param {string} carpetaPadreId - ID de la carpeta padre (null = raíz)
 * @returns {Promise<string>} - ID de la carpeta creada
 */
async function crearCarpeta(nombreCarpeta, carpetaPadreId = ROOT_FOLDER_ID) {
    try {
        // Verificar si la carpeta ya existe
        const carpetaExistente = await buscarCarpeta(nombreCarpeta, carpetaPadreId);
        if (carpetaExistente) {
            return carpetaExistente;
        }

        // Crear la carpeta
        const fileMetadata = {
            name: nombreCarpeta,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [carpetaPadreId]
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, name'
        });

        console.log(`  Carpeta creada: "${response.data.name}" (${response.data.id})`);
        return response.data.id;
    } catch (error) {
        console.error('[ERROR] Error creando carpeta:', error.message);
        throw error;
    }
}

/**
 * Obtener o crear una carpeta (busca primero, si no existe la crea)
 * @param {string} nombreCarpeta - Nombre de la carpeta
 * @param {string} carpetaPadreId - ID de la carpeta padre
 * @returns {Promise<string>} - ID de la carpeta
 */
const _folderLocks = new Map();
const _fileReplaceLocks = new Map();

async function conLockReemplazoArchivo(carpetaId, nombreArchivo, fn) {
    const lockKey = `${carpetaId || ''}::${String(nombreArchivo || '').trim()}`;
    while (_fileReplaceLocks.has(lockKey)) {
        await _fileReplaceLocks.get(lockKey);
    }
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    _fileReplaceLocks.set(lockKey, promise);
    try {
        return await fn();
    } finally {
        resolve();
        _fileReplaceLocks.delete(lockKey);
    }
}

async function obtenerOCrearCarpeta(nombreCarpeta, carpetaPadreId = ROOT_FOLDER_ID) {
    const lockKey = `${carpetaPadreId}/${nombreCarpeta}`;
    // Serializar creaciones concurrentes de la misma carpeta
    while (_folderLocks.has(lockKey)) {
        await _folderLocks.get(lockKey);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    _folderLocks.set(lockKey, promise);
    try {
        const carpetaId = await buscarCarpeta(nombreCarpeta, carpetaPadreId);
        if (carpetaId) {
            return carpetaId;
        }
        return await crearCarpeta(nombreCarpeta, carpetaPadreId);
    } finally {
        _folderLocks.delete(lockKey);
        resolve();
    }
}

// =====================================================
// FUNCIONES DE ARCHIVOS
// =====================================================

async function listarArchivosPorNombreEnCarpeta(nombreArchivo, carpetaId = ROOT_FOLDER_ID) {
    const nombre = String(nombreArchivo || '').trim();
    if (!nombre || !carpetaId) {
        return [];
    }

    const query = `name='${escaparValorConsultaDrive(nombre)}' and '${carpetaId}' in parents and trashed=false`;
    const params = {
        q: query,
        fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
        pageSize: 50,
        ...OPCIONES_LISTADO_DRIVE
    };

    try {
        const response = await drive.files.list({ ...params, orderBy: 'modifiedTime desc' });
        return response.data.files || [];
    } catch (_orderErr) {
        const response = await drive.files.list(params);
        return response.data.files || [];
    }
}

async function eliminarArchivosMismoNombreEnCarpeta(nombres, carpetaId) {
    const lista = (Array.isArray(nombres) ? nombres : [nombres])
        .map((n) => String(n || '').trim())
        .filter(Boolean);
    const vistos = new Set();

    for (const nombre of lista) {
        const archivos = await listarArchivosPorNombreEnCarpeta(nombre, carpetaId);
        for (const archivo of archivos) {
            if (!archivo?.id || vistos.has(archivo.id)) continue;
            vistos.add(archivo.id);
            await eliminarArchivoDrive(archivo.id, `Archivo "${archivo.name}"`);
        }
    }

    return vistos.size;
}

/**
 * Buscar un archivo por nombre dentro de una carpeta
 * @param {string} nombreArchivo - Nombre del archivo a buscar
 * @param {string} carpetaId - ID de la carpeta donde buscar
 * @returns {Promise<object|null>} - Objeto con id y name del archivo, o null
 */
async function buscarArchivo(nombreArchivo, carpetaId = ROOT_FOLDER_ID) {
    try {
        const archivos = await listarArchivosPorNombreEnCarpeta(nombreArchivo, carpetaId);
        return archivos[0] || null;
    } catch (error) {
        console.error('[ERROR] Error buscando archivo:', error.message);
        throw error;
    }
}

async function buscarArchivoGlobal(nombreArchivo) {
    try {
        const query = `name='${escaparValorConsultaDrive(nombreArchivo)}' and trashed=false`;
        const params = {
            q: query,
            fields: 'files(id, name, mimeType, size, createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 1,
            ...OPCIONES_LISTADO_DRIVE
        };
        const response = await drive.files.list(params);

        if (response.data.files.length > 0) {
            return response.data.files[0];
        }
        return null;
    } catch (error) {
        console.error('[ERROR] Error buscando archivo global:', error.message);
        throw error;
    }
}

/**
 * Permite lectura pública por enlace (anyone/reader) para que usuarios sin la cuenta
 * de servicio de Drive puedan ver/descargar desde el navegador.
 */
async function asignarPermisoLecturaPublica(fileId) {
    const id = String(fileId || '').trim();
    if (!id) return false;

    try {
        await drive.permissions.create({
            fileId: id,
            requestBody: { role: 'reader', type: 'anyone' }
        });
        return true;
    } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('duplicate') || error?.code === 409) {
            return true;
        }
        console.warn(`[WARN] No se pudo asignar permiso público a ${id}: ${error.message}`);
        return false;
    }
}

/**
 * Permite edición por enlace (anyone/writer) para que el editor integrado
 * de Google Sheets abra sin exigir acceso a la cuenta de servicio.
 */
async function asignarPermisoEscrituraEnlace(fileId) {
    const id = String(fileId || '').trim();
    if (!id) return false;

    try {
        await drive.permissions.create({
            fileId: id,
            supportsAllDrives: true,
            requestBody: {
                role: 'writer',
                type: 'anyone',
                allowFileDiscovery: false
            }
        });
        return true;
    } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('duplicate') || error?.code === 409) {
            return true;
        }
        console.warn(`[WARN] No se pudo asignar permiso de escritura por enlace a ${id}: ${error.message}`);
        return false;
    }
}

/**
 * True si fileId está dentro de folderId (padres hasta maxDepth).
 * Usado por /api/drive-preview para evidencias de mantenimiento sin BD.
 */
async function perteneceACarpetaAncestral(fileId, folderId, maxDepth = 6) {
    const id = String(fileId || '').trim();
    const root = String(folderId || '').trim();
    if (!id || !root || !drive) return false;
    if (id === root) return true;

    let actual = id;
    const vistos = new Set();
    for (let i = 0; i < maxDepth; i++) {
        if (!actual || vistos.has(actual)) break;
        vistos.add(actual);
        try {
            const meta = await drive.files.get({
                fileId: actual,
                fields: 'id,parents',
                supportsAllDrives: true
            });
            const parents = Array.isArray(meta?.data?.parents) ? meta.data.parents : [];
            if (parents.includes(root)) return true;
            actual = parents[0] || '';
        } catch (_e) {
            return false;
        }
    }
    return false;
}

/**
 * Subir un archivo a Google Drive
 * @param {Buffer|ReadableStream} fileData - Buffer o stream del archivo
 * @param {string} nombreArchivo - Nombre del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {string} carpetaId - ID de la carpeta destino
 * @returns {Promise<object>} - Objeto con información del archivo subido
 */
async function subirArchivo(fileData, nombreArchivo, mimeType, carpetaId = ROOT_FOLDER_ID) {
    try {
        const esBuffer = Buffer.isBuffer(fileData);
        const esStream = !!fileData && typeof fileData.pipe === 'function';
        if (!esBuffer && !esStream) {
            throw new Error('Contenido de archivo inválido: se esperaba Buffer o Stream');
        }

        return await conLockReemplazoArchivo(carpetaId, nombreArchivo, async () => {
            const eliminados = await eliminarArchivosMismoNombreEnCarpeta(nombreArchivo, carpetaId);
            if (eliminados > 0) {
                driveDebug(`[DRIVE] Reemplazando ${eliminados} archivo(s) "${nombreArchivo}"`);
            }

            const fileMetadata = {
                name: nombreArchivo,
                parents: [carpetaId]
            };

            const media = {
                mimeType: mimeType,
                body: esBuffer ? require('stream').Readable.from(fileData) : fileData
            };

            const response = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id, name, mimeType, size, webViewLink, webContentLink',
                supportsAllDrives: true
            });

            try {
                await drive.permissions.create({
                    fileId: response.data.id,
                    requestBody: {
                        role: 'reader',
                        type: 'anyone'
                    }
                });
            } catch (permError) {
                console.warn('[WARN] No se pudo hacer público el archivo:', permError.message);
            }

            console.log(`  Archivo subido: ${response.data.name} (${response.data.id})`);
            return response.data;
        });
    } catch (error) {
        console.error('[ERROR] Error subiendo archivo:', error.message);
        throw error;
    }
}

/**
 * Sube un archivo nuevo sin reemplazar otros archivos con el mismo nombre.
 * Útil para historiales donde se deben conservar todas las versiones.
 */
async function subirArchivoNuevo(fileData, nombreArchivo, mimeType, carpetaId = ROOT_FOLDER_ID) {
    const esBuffer = Buffer.isBuffer(fileData);
    const esStream = !!fileData && typeof fileData.pipe === 'function';
    if (!esBuffer && !esStream) {
        throw new Error('Contenido de archivo inválido: se esperaba Buffer o Stream');
    }

    const media = {
        mimeType,
        body: esBuffer ? require('stream').Readable.from(fileData) : fileData
    };

    const response = await drive.files.create({
        requestBody: {
            name: nombreArchivo,
            parents: [carpetaId]
        },
        media,
        fields: 'id, name, mimeType, size, webViewLink, webContentLink'
    });

    try {
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone'
            }
        });
    } catch (permError) {
        console.warn('[WARN] No se pudo hacer público el archivo:', permError.message);
    }

    console.log(`  Archivo histórico subido: ${response.data.name} (${response.data.id})`);
    return response.data;
}

/**
 * Aplica formato de alineación y ajuste de texto a un rango en Google Sheets.
 * start/end en filas y columnas son 1-based e inclusivos.
 */
async function aplicarFormatoRangoGoogleSheet(spreadsheetId, options = {}) {
    if (!spreadsheetId) {
        return null;
    }

    const sheetTitle = String(options.sheetTitle || '').trim();
    const startRow = Number(options.startRow);
    const endRow = Number(options.endRow);
    const startColumn = Number(options.startColumn);
    const endColumn = Number(options.endColumn);

    if (!sheetTitle || !Number.isFinite(startRow) || !Number.isFinite(endRow)
        || !Number.isFinite(startColumn) || !Number.isFinite(endColumn)
        || startRow < 1 || endRow < startRow || startColumn < 1 || endColumn < startColumn) {
        return null;
    }

    const horizontalAlignment = String(options.horizontalAlignment || 'CENTER').toUpperCase();
    const verticalAlignment = String(options.verticalAlignment || 'MIDDLE').toUpperCase();
    const wrapStrategy = String(options.wrapStrategy || 'WRAP').toUpperCase();

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: startRow - 1,
                        endRowIndex: endRow,
                        startColumnIndex: startColumn - 1,
                        endColumnIndex: endColumn
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment,
                            verticalAlignment,
                            wrapStrategy
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
                }
            }]
        }
    });
}

/**
 * Subir un Excel y convertirlo a Google Sheets para edición en tiempo real.
 * @param {Buffer|ReadableStream} fileData - Contenido XLSX
 * @param {string} nombreArchivo - Nombre sugerido del archivo (se normaliza sin .xlsx)
 * @param {string} carpetaId - ID de carpeta destino
 * @param {object} options - Configuración de normalización post-conversión
 * @param {boolean} options.keepSingleSheet - Si true, conserva solo la primera hoja
 * @param {string} options.sheetTitle - Nombre de la hoja principal
 * @param {number} options.maxColumns - Máximo de columnas a conservar (1-based)
 * @returns {Promise<object>} - Metadata del archivo en Drive
 */
async function subirExcelComoGoogleSheet(fileData, nombreArchivo, carpetaId = ROOT_FOLDER_ID, options = {}) {
    try {
        const esBuffer = Buffer.isBuffer(fileData);
        const esStream = !!fileData && typeof fileData.pipe === 'function';
        if (!esBuffer && !esStream) {
            throw new Error('Contenido de archivo inválido: se esperaba Buffer o Stream');
        }

        const keepSingleSheet = options.keepSingleSheet !== false;
        const targetSheetTitle = typeof options.sheetTitle === 'string' && options.sheetTitle.trim()
            ? options.sheetTitle.trim()
            : 'Informe Final';
        const maxColumnsRaw = Number(options.maxColumns);
        const maxColumns = Number.isFinite(maxColumnsRaw) && maxColumnsRaw > 0
            ? Math.floor(maxColumnsRaw)
            : 9;

        const nombreSheet = String(nombreArchivo || 'Informe_Final')
            .replace(/\.xlsx$/i, '')
            .trim() || 'Informe_Final';

        return await conLockReemplazoArchivo(carpetaId, nombreSheet, async () => {
        const eliminados = await eliminarArchivosMismoNombreEnCarpeta(
            [nombreSheet, nombreArchivo],
            carpetaId
        );
        if (eliminados > 0) {
            driveDebug(`[DRIVE] Reemplazando ${eliminados} archivo(s) "${nombreSheet}"`);
        }

        const response = await drive.files.create({
            requestBody: {
                name: nombreSheet,
                parents: [carpetaId],
                mimeType: 'application/vnd.google-apps.spreadsheet'
            },
            media: {
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                body: esBuffer ? require('stream').Readable.from(fileData) : fileData
            },
            fields: 'id, name, mimeType, size, webViewLink, webContentLink',
            supportsAllDrives: true
        });

        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'writer',
                type: 'anyone',
                allowFileDiscovery: false
            }
        });

        // Normalizar estructura al convertir a Google Sheets.
        try {
            const spreadsheetId = response.data.id;
            const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
            const meta = await sheetsApi.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets(properties(sheetId,title,index,gridProperties(columnCount)))'
            });

            const sheets = Array.isArray(meta?.data?.sheets) ? meta.data.sheets : [];
            if (sheets.length > 0) {
                const principal = sheets[0]?.properties || {};
                const principalId = principal.sheetId;
                const requests = [];

                if (keepSingleSheet) {
                    for (let i = 1; i < sheets.length; i++) {
                        const sheetId = sheets[i]?.properties?.sheetId;
                        if (sheetId !== undefined && sheetId !== null) {
                            requests.push({ deleteSheet: { sheetId } });
                        }
                    }
                }

                if (principalId !== undefined && principalId !== null) {
                    if ((principal.title || '').trim() !== targetSheetTitle) {
                        requests.push({
                            updateSheetProperties: {
                                properties: {
                                    sheetId: principalId,
                                    title: targetSheetTitle
                                },
                                fields: 'title'
                            }
                        });
                    }

                    const colCount = Number(principal?.gridProperties?.columnCount || 0);
                    if (maxColumns > 0 && colCount > maxColumns) {
                        requests.push({
                            deleteDimension: {
                                range: {
                                    sheetId: principalId,
                                    dimension: 'COLUMNS',
                                    startIndex: maxColumns,
                                    endIndex: colCount
                                }
                            }
                        });
                    }
                }

                if (requests.length > 0) {
                    await sheetsApi.spreadsheets.batchUpdate({
                        spreadsheetId,
                        requestBody: { requests }
                    });
                }
            }
        } catch (normalizeSheetErr) {
            console.warn('[WARN] No se pudo normalizar la estructura del Google Sheet (hojas/columnas):', normalizeSheetErr?.message || normalizeSheetErr);
        }

        const id = response.data.id;
        return {
            ...response.data,
            editorUrl: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null
        };
        });
    } catch (error) {
        console.error('[ERROR] Error subiendo Excel como Google Sheets:', error.message);
        throw error;
    }
}

/**
 * Lista títulos de hojas de un Google Sheet.
 * @param {string} spreadsheetId
 * @returns {Promise<string[]>}
 */
async function listarHojasGoogleSheet(spreadsheetId) {
    if (!spreadsheetId) {
        return [];
    }
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(title))'
    });
    return (meta.data.sheets || [])
        .map((s) => String(s.properties?.title || '').trim())
        .filter(Boolean);
}

function normalizarTituloHojaDrive(valor = '') {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function variantesTituloHojaDrive(valor = '') {
    const base = normalizarTituloHojaDrive(valor);
    if (!base) {
        return [];
    }
    const sinPrefijo = base.replace(/^pipc\s+/, '').trim();
    const variantes = [base];
    if (sinPrefijo && sinPrefijo !== base) {
        variantes.push(sinPrefijo);
        variantes.push(`pipc ${sinPrefijo}`);
    }
    return [...new Set(variantes.filter(Boolean))];
}

function coincideTituloHojaDrive(tituloHoja, hojaObjetivo) {
    const titulo = normalizarTituloHojaDrive(tituloHoja);
    if (!titulo) {
        return false;
    }
    const variantesObjetivo = variantesTituloHojaDrive(hojaObjetivo);
    if (variantesObjetivo.includes(titulo)) {
        return true;
    }
    const tituloSinPrefijo = titulo.replace(/^pipc\s+/, '').trim();
    return variantesObjetivo.some((variante) => {
        const varianteSinPrefijo = variante.replace(/^pipc\s+/, '').trim();
        return varianteSinPrefijo && varianteSinPrefijo === tituloSinPrefijo;
    });
}

function claveAlfanumericaHojaDrive(valor = '') {
    return normalizarTituloHojaDrive(valor).replace(/[^a-z0-9]+/g, '');
}

function clavesTituloHojaDrive(valor = '') {
    const base = claveAlfanumericaHojaDrive(valor);
    const sinPipc = claveAlfanumericaHojaDrive(String(valor || '').replace(/^pipc\s+/i, ''));
    return [...new Set([base, sinPipc].filter(Boolean))];
}

/**
 * Busca una pestaña por nombre con coincidencia flexible (PIPC, puntuación, 1 sola hoja).
 * @param {Array<{ title?: string, sheetId?: number }>} hojas
 * @param {string} objetivo
 */
function encontrarHojaPorNombre(hojas, objetivo) {
    const lista = (Array.isArray(hojas) ? hojas : []).filter((h) => String(h?.title || '').trim());
    const nombre = String(objetivo || '').trim();
    if (!lista.length || !nombre) {
        return null;
    }

    const exacta = lista.find((hoja) => coincideTituloHojaDrive(hoja.title, nombre));
    if (exacta) {
        return exacta;
    }

    const clavesObjetivo = clavesTituloHojaDrive(nombre);
    const porClave = lista.filter((hoja) => {
        const clavesHoja = clavesTituloHojaDrive(hoja.title);
        return clavesObjetivo.some((clave) => clavesHoja.includes(clave));
    });
    if (porClave.length === 1) {
        return porClave[0];
    }

    const contiene = lista.filter((hoja) => {
        const clavesHoja = clavesTituloHojaDrive(hoja.title);
        return clavesObjetivo.some((clave) =>
            clavesHoja.some((claveHoja) => claveHoja.includes(clave) || clave.includes(claveHoja))
        );
    });
    if (contiene.length === 1) {
        return contiene[0];
    }

    if (lista.length === 1) {
        return lista[0];
    }
    return null;
}

/**
 * Devuelve el título real de una hoja existente, o null.
 * @param {string[]} titulos
 * @param {string} objetivo
 * @param {{ fallbackRegex?: RegExp }} [opciones]
 */
function resolverTituloHojaExistente(titulos, objetivo, opciones = {}) {
    const lista = (Array.isArray(titulos) ? titulos : [])
        .map((t) => String(t || '').trim())
        .filter(Boolean);
    const encontrada = encontrarHojaPorNombre(
        lista.map((title, index) => ({ title, sheetId: index })),
        objetivo
    );
    if (encontrada?.title) {
        return encontrada.title;
    }
    const re = opciones.fallbackRegex;
    if (re instanceof RegExp) {
        const porRegex = lista.filter((titulo) => re.test(titulo));
        if (porRegex.length === 1) {
            return porRegex[0];
        }
    }
    return null;
}

async function obtenerMetadatosHojasGoogleSheet(spreadsheetId) {
    if (!spreadsheetId) {
        return [];
    }
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title,index)'
    });
    return (meta.data.sheets || [])
        .map((sheet) => ({
            sheetId: sheet.properties?.sheetId,
            title: String(sheet.properties?.title || '').trim(),
            index: sheet.properties?.index ?? 0
        }))
        .filter((sheet) => sheet.sheetId != null)
        .sort((a, b) => a.index - b.index);
}

/**
 * Resuelve el gid (sheetId) de una pestaña por nombre en el mismo archivo de Drive.
 */
async function obtenerGidHojaPorNombre(driveFileId, hojaNombre = '') {
    const objetivo = String(hojaNombre || '').trim();
    if (!driveFileId || !objetivo) {
        return null;
    }

    let tempSheetId = null;

    try {
        const info = await obtenerInfoArchivo(driveFileId);
        const mimeType = String(info?.mimeType || '').trim();
        let hojas = [];

        if (mimeType === 'application/vnd.google-apps.spreadsheet') {
            hojas = await obtenerMetadatosHojasGoogleSheet(driveFileId);
        } else if (esMimeTypeOfficeExcel(mimeType)) {
            try {
                hojas = await obtenerMetadatosHojasGoogleSheet(driveFileId);
            } catch (directErr) {
                console.warn(`[DRIVE] Sheets API directa falló para xlsx ${driveFileId}:`, directErr.message);
            }

            if (!hojas.length) {
                const copyResponse = await drive.files.copy({
                    fileId: driveFileId,
                    requestBody: {
                        name: `_tmp_gid_${Date.now()}`,
                        mimeType: 'application/vnd.google-apps.spreadsheet'
                    },
                    fields: 'id',
                    supportsAllDrives: true
                });
                tempSheetId = copyResponse.data?.id || null;
                if (!tempSheetId) {
                    return null;
                }
                hojas = await obtenerMetadatosHojasGoogleSheet(tempSheetId);
            }
        } else {
            return null;
        }

        const porNombre = encontrarHojaPorNombre(hojas, objetivo);
        if (porNombre?.sheetId != null) {
            console.log(`[DRIVE] gid resuelto por nombre "${objetivo}" -> ${porNombre.sheetId} (${porNombre.title})`);
            return porNombre.sheetId;
        }

        // alt=media siempre da 403 en Google Sheets nativos. Solo inspeccionar XLSX Office.
        if (esMimeTypeOfficeExcel(mimeType)) {
            try {
                const ExcelJS = require('exceljs');
                const buffer = await descargarArchivoBinario(driveFileId);
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                const hojasXlsx = workbook.worksheets.map((ws, index) => ({
                    title: ws.name,
                    sheetId: index
                }));
                const matchXlsx = encontrarHojaPorNombre(hojasXlsx, objetivo);
                const indiceObjetivo = matchXlsx?.sheetId;
                if (indiceObjetivo >= 0 && hojas[indiceObjetivo]?.sheetId != null) {
                    const gid = hojas[indiceObjetivo].sheetId;
                    const titulo = hojas[indiceObjetivo].title || workbook.worksheets[indiceObjetivo]?.name;
                    console.log(`[DRIVE] gid resuelto por índice ${indiceObjetivo} "${objetivo}" -> ${gid} (${titulo})`);
                    return gid;
                }
            } catch (xlsxErr) {
                console.warn(`[DRIVE] No se pudo inspeccionar xlsx para gid "${objetivo}":`, xlsxErr.message);
            }
        }

        driveDebug(
            `[DRIVE] No se encontró gid para hoja "${objetivo}". `
            + `Hojas disponibles: ${hojas.map((h) => h.title).join(', ') || '(ninguna)'}`
        );
        return null;
    } catch (err) {
        console.warn(`[DRIVE] No se pudo resolver gid para hoja "${hojaNombre}":`, err.message);
        return null;
    } finally {
        if (tempSheetId) {
            try {
                await drive.files.delete({ fileId: tempSheetId, supportsAllDrives: true });
            } catch (deleteErr) {
                console.warn(`[DRIVE] No se pudo eliminar hoja temporal ${tempSheetId}:`, deleteErr.message);
            }
        }
    }
}

function construirUrlEditorGoogleSheet(driveFileId, options = {}) {
    const id = String(driveFileId || '').trim();
    if (!id) {
        return '';
    }
    const modo = options.modo === 'preview' ? 'preview' : 'edit';
    const base = `https://docs.google.com/spreadsheets/d/${id}/${modo}`;
    const gid = options.gid;

    if (modo === 'edit') {
        const params = new URLSearchParams({
            usp: 'sharing',
            embedded: 'true',
            single: 'true'
        });
        if (gid != null && gid !== '') {
            params.set('gid', String(gid));
        }
        const query = params.toString();
        const fragmento = gid != null && gid !== '' ? `#gid=${gid}` : '';
        return `${base}?${query}${fragmento}`;
    }

    const fragmento = gid != null && gid !== '' ? `#gid=${gid}` : '';
    return `${base}${fragmento}`;
}

const MIME_OFFICE_EXCEL = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
];

function esMimeTypeOfficeExcel(mimeType) {
    return MIME_OFFICE_EXCEL.includes(String(mimeType || '').trim());
}

/**
 * Convierte un XLS/XLSX nativo en Drive a Google Sheet (copia + conversión).
 * @param {string} fileId
 * @param {{ nombre?: string, carpetaId?: string, eliminarOriginal?: boolean }} options
 */
async function convertirOfficeExcelAGoogleSheet(fileId, options = {}) {
    if (!fileId) {
        throw new Error('fileId requerido');
    }

    const info = await obtenerInfoArchivo(fileId);
    const mimeType = String(info?.mimeType || '').trim();

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        return info;
    }

    if (!esMimeTypeOfficeExcel(mimeType)) {
        throw new Error(`El archivo no es Excel convertible (${mimeType || 'sin mimeType'})`);
    }

    const nombre = String(options.nombre || info?.name || 'Hoja de cálculo').trim();
    const carpetaId = options.carpetaId || null;
    const eliminarOriginal = options.eliminarOriginal !== false;

    const copyResponse = await drive.files.copy({
        fileId,
        requestBody: {
            name: nombre,
            mimeType: 'application/vnd.google-apps.spreadsheet'
        },
        fields: 'id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, parents'
    });

    const nuevoId = copyResponse.data.id;
    if (!nuevoId) {
        throw new Error('Drive no devolvió ID al convertir Excel a Google Sheet');
    }

    if (carpetaId) {
        const parents = Array.isArray(copyResponse.data.parents) ? copyResponse.data.parents : [];
        const removeParents = parents.filter((p) => p && p !== carpetaId).join(',');
        await drive.files.update({
            fileId: nuevoId,
            addParents: carpetaId,
            ...(removeParents ? { removeParents } : {}),
            requestBody: { name: nombre },
            fields: 'id, name, mimeType, parents, webViewLink, webContentLink'
        });
    }

    try {
        await drive.permissions.create({
            fileId: nuevoId,
            requestBody: {
                role: 'writer',
                type: 'anyone',
                allowFileDiscovery: false
            }
        });
    } catch (permErr) {
        console.warn('[WARN] No se pudo asignar permiso público al Google Sheet convertido:', permErr.message);
    }

    if (eliminarOriginal && fileId !== nuevoId) {
        try {
            await eliminarArchivo(fileId);
        } catch (delErr) {
            console.warn('[WARN] No se pudo eliminar el archivo Office original:', delErr.message);
        }
    }

    const finalInfo = await obtenerInfoArchivo(nuevoId).catch(() => copyResponse.data);
    console.log(`[DRIVE] Excel convertido a Google Sheet: ${finalInfo.name} (${nuevoId})`);
    return finalInfo;
}

/**
 * Asegura que un catálogo PIPC editable sea Google Sheet nativo.
 * Los XLSX en Drive no exponen gids válidos al iframe del editor; al convertir,
 * el mismo fileId usa la API de Sheets y cada pestaña abre correctamente.
 */
async function asegurarSpreadsheetNativoParaCatalogo(driveFileId, nombreSugerido = '') {
    if (!driveFileId) {
        throw new Error('driveFileId requerido');
    }

    const info = await obtenerInfoArchivo(driveFileId);
    const mimeType = String(info?.mimeType || '').trim();

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        return {
            fileId: driveFileId,
            mimeType,
            webViewLink: info.webViewLink || null,
            webContentLink: info.webContentLink || null,
            converted: false
        };
    }

    if (!esMimeTypeOfficeExcel(mimeType)) {
        return {
            fileId: driveFileId,
            mimeType,
            webViewLink: info.webViewLink || null,
            webContentLink: info.webContentLink || null,
            converted: false
        };
    }

    const converted = await convertirOfficeExcelAGoogleSheet(driveFileId, {
        nombre: nombreSugerido || info.name,
        eliminarOriginal: true
    });

    const newId = converted.id || converted.fileId;
    if (!newId) {
        throw new Error('Drive no devolvió ID al convertir catálogo PIPC a Google Sheet');
    }

    return {
        fileId: newId,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: converted.webViewLink || null,
        webContentLink: converted.webContentLink || null,
        converted: true,
        previousFileId: driveFileId
    };
}

/**
 * Resuelve un nombre de hoja único (máx. 100 caracteres en Google Sheets).
 * @param {string} spreadsheetId
 * @param {string} nombreBase
 * @returns {Promise<string>}
 */
async function resolverNombreHojaUnico(spreadsheetId, nombreBase) {
    const base = String(nombreBase || 'Historial')
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90) || 'Historial';
    const existentes = new Set(await listarHojasGoogleSheet(spreadsheetId));
    if (!existentes.has(base)) {
        return base;
    }
    for (let i = 2; i <= 99; i++) {
        const candidato = `${base}_${i}`.slice(0, 100);
        if (!existentes.has(candidato)) {
            return candidato;
        }
    }
    return `${base}_${Date.now()}`.slice(0, 100);
}

/**
 * Dimensiones de una hoja (filas y columnas del grid).
 * @param {string} spreadsheetId
 * @param {string} sheetTitle
 */
async function obtenerDimensionesHojaGoogleSheet(spreadsheetId, sheetTitle) {
    if (!spreadsheetId) {
        return { rowCount: 0, columnCount: 0 };
    }
    const titulo = String(sheetTitle || '').trim();
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(title,gridProperties(rowCount,columnCount)))'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => String(s.properties?.title || '').trim() === titulo
    );
    const grid = sheet?.properties?.gridProperties || {};
    return {
        rowCount: Number(grid.rowCount || 0),
        columnCount: Number(grid.columnCount || 0)
    };
}

/**
 * Copia un Google Sheet a una carpeta destino con un nombre nuevo.
 * @param {string} templateId
 * @param {string} nombreArchivo
 * @param {string} carpetaDestinoId
 */
async function copiarGoogleSheetACarpeta(templateId, nombreArchivo, carpetaDestinoId) {
    if (!templateId) {
        throw new Error('templateId requerido');
    }
    if (!carpetaDestinoId) {
        throw new Error('carpetaDestinoId requerida');
    }

    const nombre = String(nombreArchivo || '').trim();
    if (!nombre) {
        throw new Error('nombreArchivo requerido');
    }

    const copyResponse = await drive.files.copy({
        fileId: templateId,
        supportsAllDrives: true,
        requestBody: {
            name: nombre,
            parents: [carpetaDestinoId]
        },
        fields: 'id,name,webViewLink,webContentLink,mimeType,size,modifiedTime'
    });

    const data = copyResponse.data || {};
    if (!data.id) {
        throw new Error('No se pudo copiar la plantilla de Google Sheets');
    }

    try {
        await drive.permissions.create({
            fileId: data.id,
            supportsAllDrives: true,
            requestBody: {
                role: 'writer',
                type: 'anyone',
                allowFileDiscovery: false
            }
        });
    } catch (permErr) {
        console.warn(`[DRIVE] No se pudo asignar permiso al Sheet copiado ${data.id}:`, permErr.message);
    }

    return {
        id: data.id,
        name: data.name || nombre,
        webViewLink: data.webViewLink || `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
        webContentLink: data.webContentLink || null,
        mimeType: data.mimeType || 'application/vnd.google-apps.spreadsheet',
        size: data.size ? Number(data.size) : null,
        modifiedTime: data.modifiedTime || null
    };
}

/**
 * Reemplaza texto en todas las hojas de un Google Sheet.
 * @param {string} spreadsheetId
 * @param {string} findText
 * @param {string} replacement
 */
async function reemplazarTextoEnGoogleSheet(spreadsheetId, findText, replacement, options = {}) {
    if (!spreadsheetId) {
        throw new Error('spreadsheetId requerido');
    }
    const buscar = String(findText || '');
    if (!buscar) {
        throw new Error('findText requerido');
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const findReplace = {
        find: buscar,
        replacement: String(replacement ?? ''),
        matchCase: true
    };
    if (options.sheetId != null && options.sheetId !== '') {
        findReplace.sheetId = Number(options.sheetId);
    } else {
        findReplace.allSheets = true;
    }

    const response = await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{ findReplace }]
        }
    });

    const occurrences = Number(response.data?.replies?.[0]?.findReplace?.occurrencesChanged || 0);
    return { occurrencesChanged: occurrences };
}

async function renombrarHojaGoogleSheet(spreadsheetId, tituloActual, tituloNuevo) {
    const actual = String(tituloActual || '').trim();
    let nuevo = String(tituloNuevo || '').trim()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    if (!spreadsheetId || !actual || !nuevo || actual === nuevo) {
        return { title: actual || nuevo };
    }

    const existentes = await listarHojasGoogleSheet(spreadsheetId);
    if (existentes.includes(nuevo) && nuevo !== actual) {
        nuevo = await resolverNombreHojaUnico(spreadsheetId, nuevo);
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => String(s.properties?.title || '').trim() === actual
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        throw new Error(`Hoja "${actual}" no encontrada`);
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                updateSheetProperties: {
                    properties: { sheetId, title: nuevo },
                    fields: 'title'
                }
            }]
        }
    });
    return { sheetId, title: nuevo };
}

/**
 * Duplica una hoja dentro del mismo spreadsheet y devuelve el título final.
 * @param {string} spreadsheetId
 * @param {string} sourceSheetTitle
 * @param {string} newTitle
 */
async function duplicarHojaGoogleSheet(spreadsheetId, sourceSheetTitle, newTitle) {
    if (!spreadsheetId) {
        throw new Error('spreadsheetId requerido');
    }
    const origen = String(sourceSheetTitle || '').trim();
    if (!origen) {
        throw new Error('sourceSheetTitle requerido');
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const hojas = (meta.data.sheets || []).map((s) => ({
        title: String(s.properties?.title || '').trim(),
        sheetId: s.properties?.sheetId
    }));
    const source = encontrarHojaPorNombre(hojas, origen)
        || hojas.find((h) => String(h.title || '').toLowerCase() === origen.toLowerCase());
    const sourceSheetId = source?.sheetId;
    if (sourceSheetId === undefined || sourceSheetId === null) {
        throw new Error(
            `Hoja origen "${origen}" no encontrada. `
            + `Hojas: ${hojas.map((h) => h.title).join(', ') || '(ninguna)'}`
        );
    }

    const nombreFinal = await resolverNombreHojaUnico(spreadsheetId, newTitle);
    const response = await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                duplicateSheet: {
                    sourceSheetId,
                    newSheetName: nombreFinal
                }
            }]
        }
    });

    const props = response.data?.replies?.[0]?.duplicateSheet?.properties || {};
    return {
        sheetId: props.sheetId,
        title: String(props.title || nombreFinal).trim() || nombreFinal
    };
}

/**
 * Inserta filas en una hoja (índices 0-based, endIndex exclusivo).
 * @param {string} spreadsheetId
 * @param {number} sheetId
 * @param {number} startIndex
 * @param {number} numRows
 * @param {{ inheritFromBefore?: boolean }} [options]
 */
async function insertarFilasGoogleSheet(spreadsheetId, sheetId, startIndex, numRows, options = {}) {
    const filas = Math.max(0, Math.floor(Number(numRows) || 0));
    if (!spreadsheetId || sheetId == null || filas <= 0) {
        return null;
    }
    const start = Math.max(0, Math.floor(Number(startIndex) || 0));
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                insertDimension: {
                    range: {
                        sheetId: Number(sheetId),
                        dimension: 'ROWS',
                        startIndex: start,
                        endIndex: start + filas
                    },
                    inheritFromBefore: options.inheritFromBefore !== false
                }
            }]
        }
    });
}

/**
 * Crea una hoja vacía nueva (sin copiar contenido de otra hoja).
 * @param {string} spreadsheetId
 * @param {string} nombreHoja
 */
/**
 * Elimina hojas por título (ignora las que no existan).
 * @param {string} spreadsheetId
 * @param {string[]} titulos
 */
async function eliminarHojasGoogleSheet(spreadsheetId, titulos) {
    if (!spreadsheetId) {
        return;
    }
    const lista = Array.isArray(titulos)
        ? titulos.map((t) => String(t || '').trim()).filter(Boolean)
        : [];
    if (!lista.length) {
        return;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const requests = [];
    for (const titulo of lista) {
        const sheet = (meta.data.sheets || []).find(
            (s) => String(s.properties?.title || '').trim() === titulo
        );
        const sheetId = sheet?.properties?.sheetId;
        if (sheetId !== undefined && sheetId !== null) {
            requests.push({ deleteSheet: { sheetId } });
        }
    }
    if (requests.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    }
}

async function crearHojaGoogleSheet(spreadsheetId, nombreHoja) {
    if (!spreadsheetId) {
        throw new Error('spreadsheetId requerido');
    }

    const nombreFinal = await resolverNombreHojaUnico(spreadsheetId, nombreHoja);
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const response = await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                addSheet: {
                    properties: { title: nombreFinal }
                }
            }]
        }
    });

    const props = response.data?.replies?.[0]?.addSheet?.properties || {};
    return {
        sheetId: props.sheetId,
        title: String(props.title || nombreFinal).trim() || nombreFinal
    };
}

/**
 * Actualizar celdas de un Google Sheet sin reemplazar el archivo completo.
 * @param {string} spreadsheetId
 * @param {Array<{range: string, values: Array<Array<string|number>>}>} actualizaciones
 */
async function actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones) {
    if (!spreadsheetId) {
        throw new Error('spreadsheetId requerido');
    }
    const entradas = (actualizaciones || []).filter((item) => item?.range && Array.isArray(item.values));
    if (!entradas.length) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const response = await sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: entradas
        }
    });
    return response.data;
}

/**
 * Permite IMAGE()/IMPORT* sin el diálogo «Permitir acceso» (Sheets API).
 * Es irreversible a false una vez activado en el documento.
 * @param {string} spreadsheetId
 */
async function permitirAccesoUrlsExternasGoogleSheet(spreadsheetId) {
    if (!spreadsheetId) return null;
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    try {
        return await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    updateSpreadsheetProperties: {
                        properties: { importFunctionsExternalUrlAccessAllowed: true },
                        fields: 'importFunctionsExternalUrlAccessAllowed'
                    }
                }]
            }
        });
    } catch (err) {
        const detail = err?.response?.data?.error?.message || err.message || String(err);
        // Si ya estaba en true, la API a veces responde OK; otros errores se reportan.
        if (/read only|already|cannot set/i.test(detail)) {
            return null;
        }
        const e = new Error(`importFunctionsExternalUrlAccessAllowed: ${detail}`);
        e.cause = err;
        throw e;
    }
}

/**
 * Elimina columnas extra en un Google Sheet (p. ej. L en adelante → conservar A–K).
 * @param {string} spreadsheetId
 * @param {{ sheetTitle?: string, maxColumns?: number }} options
 */
async function recortarColumnasGoogleSheet(spreadsheetId, options = {}) {
    if (!spreadsheetId) {
        return null;
    }

    const maxColumnsRaw = Number(options.maxColumns);
    const maxColumns = Number.isFinite(maxColumnsRaw) && maxColumnsRaw > 0
        ? Math.floor(maxColumnsRaw)
        : 11;
    const sheetTitle = typeof options.sheetTitle === 'string' && options.sheetTitle.trim()
        ? options.sheetTitle.trim()
        : null;

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))'
    });

    const sheets = Array.isArray(meta?.data?.sheets) ? meta.data.sheets : [];
    const targets = sheetTitle
        ? sheets.filter((s) => (s.properties?.title || '').trim() === sheetTitle)
        : sheets.slice(0, 1);

    const requests = [];
    for (const sheet of targets) {
        const sheetId = sheet?.properties?.sheetId;
        const colCount = Number(sheet?.properties?.gridProperties?.columnCount || 0);
        if (sheetId === undefined || sheetId === null || colCount <= maxColumns) {
            continue;
        }
        requests.push({
            deleteDimension: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: maxColumns,
                    endIndex: colCount
                }
            }
        });
    }

    if (!requests.length) {
        return null;
    }

    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/**
 * Formato visual SGC-F-12: campos 1–5 alineados a la izquierda y columna L más ancha.
 * @param {string} spreadsheetId
 * @param {{ sheetTitle?: string, columnLPixelWidth?: number, textFields?: Array<{row:number,startCol:number,endCol:number}> }} options
 */
async function aplicarFormatoVisualSgcF12(spreadsheetId, options = {}) {
    if (!spreadsheetId) {
        return null;
    }

    const sheetTitle = typeof options.sheetTitle === 'string' && options.sheetTitle.trim()
        ? options.sheetTitle.trim()
        : 'Notificación';
    const columnLPixelWidth = Number(options.columnLPixelWidth) > 0
        ? Math.floor(Number(options.columnLPixelWidth))
        : 150;
    const textFields = Array.isArray(options.textFields) ? options.textFields : [];

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const requests = [];

    for (const field of textFields) {
        const row = Number(field.row);
        const startCol = Number(field.startCol);
        const endCol = Number(field.endCol);
        if (!row || !startCol || !endCol || endCol < startCol) {
            continue;
        }
        const horizontalAlignment = field.align === 'center' ? 'CENTER' : 'LEFT';
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: startCol - 1,
                    endColumnIndex: endCol
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment,
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP'
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
            }
        });
    }

    requests.push({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 11,
                endIndex: 12
            },
            properties: { pixelSize: columnLPixelWidth },
            fields: 'pixelSize'
        }
    });

    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/**
 * Formato visual SGC-F-11: Century Gothic 12 en encabezado y matriz AMEF.
 * @param {string} spreadsheetId
 * @param {{ sheetTitle?: string, numFilasDatos?: number }} options
 */
async function aplicarFormatoVisualSgcF11(spreadsheetId, options = {}) {
    if (!spreadsheetId) {
        return null;
    }

    const sheetTitle = typeof options.sheetTitle === 'string' && options.sheetTitle.trim()
        ? options.sheetTitle.trim()
        : 'AMEF';
    const numFilasDatos = Math.max(1, Number(options.numFilasDatos) || 1);

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const textFormat = {
        fontFamily: 'Century Gothic',
        fontSize: 12
    };
    const textFormatBold = {
        fontFamily: 'Century Gothic',
        fontSize: 12,
        bold: true
    };

    const formatRange = (startRow, endRow, startCol, endCol, horizontal = 'LEFT', bold = false) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow - 1,
                endRowIndex: endRow,
                startColumnIndex: startCol - 1,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat: bold ? textFormatBold : textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [
        formatRange(8, 8, 1, 3, 'CENTER', true),
        formatRange(8, 8, 4, 6, 'CENTER', true),
        formatRange(8, 8, 7, 9, 'CENTER', true),
        formatRange(8, 8, 10, 12, 'CENTER', true),
        formatRange(9, 10, 10, 12, 'CENTER', true),
        formatRange(10, 10, 1, 4, 'CENTER', true),
        formatRange(9, 9, 1, 9, 'LEFT'),
        formatRange(8, 8, 13, 19, 'LEFT'),
        formatRange(9, 9, 13, 19, 'LEFT'),
        formatRange(10, 10, 5, 9, 'LEFT'),
        formatRange(12, 12, 1, 19, 'CENTER', true),
        formatRange(14, 13 + numFilasDatos, 1, 19, 'LEFT')
    ];

    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/**
 * Formato visual SGC-F-06: fondo gris en columna Calif. Eval. Curso (como Desempeño).
 * @param {string} spreadsheetId
 * @param {{ sheetTitle?: string, califEvalCurso?: { startRow:number, endRow:number, startColumn:number, endColumn:number } }} options
 */
async function aplicarFormatoVisualSgcF06(spreadsheetId, options = {}) {
    if (!spreadsheetId) {
        return null;
    }

    const sheetTitle = typeof options.sheetTitle === 'string' && options.sheetTitle.trim()
        ? options.sheetTitle.trim()
        : 'Hoja1';
    const rango = options.califEvalCurso || {};
    const startRow = Number(rango.startRow);
    const endRow = Number(rango.endRow);
    const startColumn = Number(rango.startColumn);
    const endColumn = Number(rango.endColumn);

    if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || !Number.isFinite(startColumn)
        || !Number.isFinite(endColumn) || startRow < 1 || endRow < startRow
        || startColumn < 1 || endColumn < startColumn) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),conditionalFormats)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const targetColStart = startColumn - 1;
    const targetColEnd = endColumn;
    const targetRowStart = startRow - 1;
    const targetRowEnd = endRow;
    const rangosSeSolapan = (range) => {
        if (range?.sheetId !== sheetId) {
            return false;
        }
        const colStart = Number(range.startColumnIndex ?? 0);
        const colEnd = Number(range.endColumnIndex ?? 0);
        const rowStart = Number(range.startRowIndex ?? 0);
        const rowEnd = Number(range.endRowIndex ?? 0);
        return colStart < targetColEnd
            && colEnd > targetColStart
            && rowStart < targetRowEnd
            && rowEnd > targetRowStart;
    };

    // Eliminar reglas CF una por una (los índices cambian tras cada borrado).
    for (let intento = 0; intento < 30; intento += 1) {
        const metaCf = await sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title),conditionalFormats)'
        });
        const hojaCf = (metaCf.data.sheets || []).find(
            (s) => (s.properties?.title || '').trim() === sheetTitle
        );
        const reglas = Array.isArray(hojaCf?.conditionalFormats) ? hojaCf.conditionalFormats : [];
        let indiceBorrar = -1;
        for (let index = reglas.length - 1; index >= 0; index -= 1) {
            const afectaRango = Array.isArray(reglas[index]?.ranges)
                && reglas[index].ranges.some(rangosSeSolapan);
            if (afectaRango) {
                indiceBorrar = index;
                break;
            }
        }
        if (indiceBorrar < 0) {
            break;
        }
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteConditionalFormatRule: {
                        sheetId,
                        index: indiceBorrar
                    }
                }]
            }
        });
    }

    const copiarDesde = options.copiarFormatoDesde || null;
    const colOrigen = Number(copiarDesde?.startColumn);
    const colOrigenFin = Number(copiarDesde?.endColumn || colOrigen);
    const filaOrigenInicio = Number(copiarDesde?.startRow);
    const filaOrigenFin = Number(copiarDesde?.endRow);
    if (
        Number.isFinite(colOrigen) && colOrigen > 0
        && Number.isFinite(filaOrigenInicio) && Number.isFinite(filaOrigenFin)
        && filaOrigenFin >= filaOrigenInicio
    ) {
        try {
            await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        copyPaste: {
                            source: {
                                sheetId,
                                startRowIndex: filaOrigenInicio - 1,
                                endRowIndex: filaOrigenFin,
                                startColumnIndex: colOrigen - 1,
                                endColumnIndex: colOrigenFin
                            },
                            destination: {
                                sheetId,
                                startRowIndex: targetRowStart,
                                endRowIndex: targetRowEnd,
                                startColumnIndex: targetColStart,
                                endColumnIndex: targetColEnd
                            },
                            pasteType: 'PASTE_FORMAT'
                        }
                    }]
                }
            });
            return { ok: true };
        } catch (err) {
            console.warn('[SGC-F-06] copyPaste formato Calif desde Desempeño:', err.message);
        }
    }

    const grisDesempeno = { red: 0.851, green: 0.851, blue: 0.851 };
    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: targetRowStart,
                        endRowIndex: targetRowEnd,
                        startColumnIndex: targetColStart,
                        endColumnIndex: targetColEnd
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: grisDesempeno,
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP'
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy)'
                }
            }]
        }
    });
}

/** Alineación, bordes y fusión H:I en filas de datos DG-F-05 (Google Sheets). */
async function aplicarFormatoFilasDgF05(spreadsheetId, sheetTitle, filaInicio, numFilas, filaEncabezado = 9) {
    if (!spreadsheetId || !numFilas) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const startRow = filaInicio - 1;
    const endRow = startRow + numFilas;
    const bordeNegro = { style: 'SOLID', width: 2, color: { red: 0, green: 0, blue: 0 } };

    const formatoColumna = (startCol, endCol, horizontal) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: endRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP'
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
        }
    });

    const requests = [
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: filaEncabezado - 1,
                    endRowIndex: filaEncabezado,
                    startColumnIndex: 7,
                    endColumnIndex: 9
                }
            }
        },
        formatoColumna(1, 2, 'CENTER'),
        formatoColumna(2, 3, 'CENTER'),
        formatoColumna(3, 4, 'LEFT'),
        formatoColumna(4, 5, 'CENTER'),
        formatoColumna(5, 6, 'CENTER'),
        formatoColumna(6, 7, 'CENTER'),
        formatoColumna(7, 9, 'CENTER'),
        {
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: endRow,
                    startColumnIndex: 1,
                    endColumnIndex: 9
                },
                top: bordeNegro,
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro,
                innerHorizontal: bordeNegro,
                innerVertical: bordeNegro
            }
        }
    ];

    for (let i = 0; i < numFilas; i++) {
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: startRow + i,
                    endRowIndex: startRow + i + 1,
                    startColumnIndex: 7,
                    endColumnIndex: 9
                }
            }
        });
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * Replica el formato de tabla del SGC-F-14 en cada fila de datos (Google Sheets).
 * Aplica alineación por columna, bordes y fusiona B:C (Nombre del proyecto) y G:H
 * (% Avance) en cada renglón con datos, además de limpiar bordes/fusiones de las
 * filas vacías por debajo para que la tabla crezca/encoja respetando el diseño.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetTitle
 * @param {number} filaInicio - Primera fila de datos (1-based).
 * @param {number} numFilas - Cantidad de filas con datos.
 * @param {number} filaMax - Última fila del bloque de datos a normalizar (1-based).
 */
async function aplicarFormatoFilasAthF08(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),merges)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // Columnas (0-based): A #, B:D nombre, E:X cursos 1-20, Y total, Z aprobadas, AA eficacia.
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 27;
    const NOMBRE_COL_INICIO = 1; // B
    const NOMBRE_COL_FIN = 4; // D (exclusivo)
    const filasSolicitadas = Math.max(0, Number(numFilas) || 0);
    const startRow = Math.max(0, Number(filaInicio) - 1);
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : (startRow + filasSolicitadas);
    const merges = Array.isArray(sheet.merges) ? sheet.merges : [];

    const intersecta = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

    // No formatear/fusionar encima de fusiones verticales de plantilla (Acreditaciones, etc.).
    let safeEndRow = startRow + filasSolicitadas;
    for (const m of merges) {
        const mRow0 = Number(m.startRowIndex) || 0;
        const mRow1 = Number(m.endRowIndex) || 0;
        const mCol0 = Number(m.startColumnIndex) || 0;
        const mCol1 = Number(m.endColumnIndex) || 0;
        const rowSpan = mRow1 - mRow0;
        if (rowSpan <= 1) continue;
        if (!intersecta(mCol0, mCol1, 0, NOMBRE_COL_FIN)) continue;
        if (mRow0 >= startRow && mRow0 < safeEndRow) {
            safeEndRow = mRow0;
        }
    }

    const filas = Math.max(0, Math.min(filasSolicitadas, safeEndRow - startRow));
    const dataEndRow = startRow + filas;
    if (filas <= 0) {
        return null;
    }

    // Desfusionar solo fusiones de 1 fila (nombres) contenidas en la zona segura.
    const unmergeRequests = [];
    for (const m of merges) {
        const mRow0 = Number(m.startRowIndex) || 0;
        const mRow1 = Number(m.endRowIndex) || 0;
        const mCol0 = Number(m.startColumnIndex) || 0;
        const mCol1 = Number(m.endColumnIndex) || 0;
        const rowSpan = mRow1 - mRow0;
        if (rowSpan !== 1) continue;
        if (mRow0 < startRow || mRow1 > dataEndRow) continue;
        if (!intersecta(mCol0, mCol1, NOMBRE_COL_INICIO, NOMBRE_COL_FIN)) continue;
        unmergeRequests.push({
            unmergeCells: {
                range: {
                    sheetId,
                    startRowIndex: mRow0,
                    endRowIndex: mRow1,
                    startColumnIndex: mCol0,
                    endColumnIndex: mCol1
                }
            }
        });
    }

    if (unmergeRequests.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: unmergeRequests }
        }).catch(() => { /* fusiones ya liberadas */ });
    }

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };

    const formatoColumna = (startCol, endCol, horizontal, wrapStrategy = 'CLIP') => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: dataEndRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy,
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: startRow,
                    endIndex: dataEndRow
                },
                properties: { pixelSize: 28 },
                fields: 'pixelSize'
            }
        },
        formatoColumna(0, 1, 'CENTER'),
        formatoColumna(1, 4, 'LEFT'),
        formatoColumna(4, 24, 'CENTER'),
        formatoColumna(24, 27, 'CENTER'),
        {
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: bordeNegro,
                innerHorizontal: bordeNegro
            }
        }
    ];

    for (let i = 0; i < filas; i++) {
        const r = startRow + i;
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: r,
                    endRowIndex: r + 1,
                    startColumnIndex: NOMBRE_COL_INICIO,
                    endColumnIndex: NOMBRE_COL_FIN
                },
                mergeType: 'MERGE_ALL'
            }
        });
    }

    const limpioHasta = Math.min(blockEndRow, safeEndRow);
    if (limpioHasta > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: limpioHasta,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: { style: 'NONE' },
                innerHorizontal: { style: 'NONE' }
            }
        });
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * Formato visual SGC-F-16: tipografía de títulos, bordes (sin filas separadoras) y merges.
 * layout: { asistentesStart, asistentesEnd, agendaStart, agendaEnd, compromisosStart, compromisosEnd }
 *
 * Merges por fila de encabezado/datos:
 *   ASISTENTES: Nombre A:D · Puesto E:F · Firma G:H
 *   AGENDA: Descripción B:H
 *   COMPROMISOS: Descripción B:C · Observaciones G:H
 */
async function aplicarFormatoVisualSgcF16(spreadsheetId, sheetTitle, layout) {
    if (!spreadsheetId || !sheetTitle || !layout) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };
    const textFormatTitulo = { fontFamily: 'Century Gothic', fontSize: 10, bold: true };
    const textFormatCuerpo = { fontFamily: 'Century Gothic', fontSize: 10 };
    const COL_INICIO = 0;
    const COL_FIN = 8; // A:H
    const SEPARATOR = 1;

    const bloques = [
        {
            key: 'asistentes',
            titleRow: Number(layout.asistentesStart) - 2,
            headerRow: Number(layout.asistentesStart) - 1,
            dataStart: Number(layout.asistentesStart),
            blockEnd: Number(layout.asistentesEnd)
        },
        {
            key: 'agenda',
            titleRow: Number(layout.agendaStart) - 2,
            headerRow: Number(layout.agendaStart) - 1,
            dataStart: Number(layout.agendaStart),
            blockEnd: Number(layout.agendaEnd)
        },
        {
            key: 'compromisos',
            titleRow: Number(layout.compromisosStart) - 2,
            headerRow: Number(layout.compromisosStart) - 1,
            dataStart: Number(layout.compromisosStart),
            blockEnd: Number(layout.compromisosEnd)
        }
    ].filter((b) => Number.isFinite(b.titleRow) && b.titleRow >= 1
        && Number.isFinite(b.blockEnd) && b.blockEnd >= b.titleRow);

    if (!bloques.length) {
        return null;
    }

    const minTitle = Math.min(...bloques.map((b) => b.titleRow));
    const maxEnd = Math.max(...bloques.map((b) => b.blockEnd));

    // 1) Desfusionar el rango completo para reaplicar merges limpios.
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                unmergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: minTitle - 1,
                        endRowIndex: maxEnd,
                        startColumnIndex: COL_INICIO,
                        endColumnIndex: COL_FIN
                    }
                }
            }]
        }
    }).catch(() => { /* puede no haber fusiones previas */ });

    const requests = [];
    const mergeFila = (row1Based, startCol0, endCol0Exclusive) => {
        if (endCol0Exclusive - startCol0 < 2) return;
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: row1Based - 1,
                    endRowIndex: row1Based,
                    startColumnIndex: startCol0,
                    endColumnIndex: endCol0Exclusive
                },
                mergeType: 'MERGE_ALL'
            }
        });
    };

    for (const b of bloques) {
        const lastDataRow = Math.max(b.dataStart - 1, b.blockEnd - SEPARATOR);
        const separatorRow = b.blockEnd;

        // Título: Century Gothic 10 negrita, centrado, vertical medio
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: b.titleRow - 1,
                    endRowIndex: b.titleRow,
                    startColumnIndex: COL_INICIO,
                    endColumnIndex: COL_FIN
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat: textFormatTitulo
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        });
        mergeFila(b.titleRow, COL_INICIO, COL_FIN);

        // Encabezado + datos: Century Gothic 10, alineación vertical media
        if (lastDataRow >= b.headerRow) {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: Math.max(0, b.headerRow - 1),
                        endRowIndex: lastDataRow,
                        startColumnIndex: COL_INICIO,
                        endColumnIndex: COL_FIN
                    },
                    cell: {
                        userEnteredFormat: {
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textFormat: textFormatCuerpo
                        }
                    },
                    fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)'
                }
            });
        }

        // Bordes solo en título + encabezado + datos (sin la fila vacía separadora)
        if (lastDataRow >= b.titleRow) {
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: b.titleRow - 1,
                        endRowIndex: lastDataRow,
                        startColumnIndex: COL_INICIO,
                        endColumnIndex: COL_FIN
                    },
                    top: bordeNegro,
                    bottom: bordeNegro,
                    left: bordeNegro,
                    right: bordeNegro,
                    innerHorizontal: bordeNegro,
                    innerVertical: bordeNegro
                }
            });
        }

        // Quitar bordes de la fila separadora (NO tocar "top": es el borde inferior del último registro)
        if (separatorRow > lastDataRow) {
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: separatorRow - 1,
                        endRowIndex: separatorRow,
                        startColumnIndex: COL_INICIO,
                        endColumnIndex: COL_FIN
                    },
                    bottom: sinBorde,
                    left: sinBorde,
                    right: sinBorde,
                    innerHorizontal: sinBorde,
                    innerVertical: sinBorde
                }
            });
            // Refuerza el borde inferior del último registro con datos
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: lastDataRow - 1,
                        endRowIndex: lastDataRow,
                        startColumnIndex: COL_INICIO,
                        endColumnIndex: COL_FIN
                    },
                    bottom: bordeNegro
                }
            });
        }

        const filasMerge = [];
        if (Number.isFinite(b.headerRow) && b.headerRow >= 1) {
            filasMerge.push(b.headerRow);
        }
        for (let r = b.dataStart; r <= lastDataRow; r++) {
            filasMerge.push(r);
        }

        for (const r of filasMerge) {
            if (b.key === 'asistentes') {
                mergeFila(r, 0, 4); // A:D Nombre
                mergeFila(r, 4, 6); // E:F Puesto
                mergeFila(r, 6, 8); // G:H Firma
            } else if (b.key === 'agenda') {
                mergeFila(r, 1, 8); // B:H Descripción
            } else if (b.key === 'compromisos') {
                mergeFila(r, 1, 3); // B:C Descripción
                mergeFila(r, 6, 8); // G:H Observaciones
            }
        }
    }

    if (!requests.length) {
        return null;
    }

    const CHUNK = 80;
    for (let i = 0; i < requests.length; i += CHUNK) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requests.slice(i, i + CHUNK) }
        });
    }
    return true;
}

/**
 * SP-F-02: Century Gothic 10, vertical medio, ajuste de texto.
 * Columnas: B = # · C:D = problema · E:F = acciones · G resp · H fecha · I estatus · J obs.
 * Alto de fila de ítems: 50 px.
 */
async function aplicarFormatoVisualSpF02(spreadsheetId, sheetTitle, layout, reporte = null) {
    if (!spreadsheetId || !sheetTitle || !layout) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const textFormat = { fontFamily: 'Century Gothic', fontSize: 10 };
    const itemsStart = Number(layout.itemsStart) || 11;
    const itemsEnd = Number(layout.itemsEnd) || itemsStart;
    const colFin = 10; // A:J
    const FILA_ALTO_PX = 50;

    const requests = [];

    const aplicarRango = (startRow, endRow, startCol, endCol, horizontal, extras = {}) => {
        if (endRow < startRow) return;
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: startRow - 1,
                    endRowIndex: endRow,
                    startColumnIndex: startCol,
                    endColumnIndex: endCol
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: horizontal,
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat,
                        ...extras
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat'
                    + (extras.backgroundColor ? ',backgroundColor' : '') + ')'
            }
        });
    };

    const camposCabecera = [
        layout.empresa, layout.fecha, layout.proposito, layout.hora,
        layout.asistentes, layout.modalidad, layout.consultores, layout.proxVisita,
        layout.resumenTotal, layout.resumenAbiertos, layout.resumenCerrados,
        layout.resumenAvance, layout.resumenRevision
    ].filter((c) => c && Number.isFinite(c.row) && Number.isFinite(c.col));

    for (const c of camposCabecera) {
        aplicarRango(c.row, c.row, c.col - 1, c.col, 'LEFT');
    }

    if (itemsEnd >= itemsStart) {
        const headerRow = itemsStart - 1;
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    unmergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: Math.max(0, headerRow - 1),
                            endRowIndex: itemsEnd,
                            startColumnIndex: 0,
                            endColumnIndex: colFin
                        }
                    }
                }]
            }
        }).catch(() => { /* puede no haber fusiones */ });

        // Encabezado: B = "#" · C:D problema · E:F acciones
        if (headerRow >= 1) {
            aplicarRango(headerRow, headerRow, 1, 2, 'CENTER');
            aplicarRango(headerRow, headerRow, 2, 4, 'CENTER');
            aplicarRango(headerRow, headerRow, 4, 6, 'CENTER');
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: headerRow - 1,
                        endRowIndex: headerRow,
                        startColumnIndex: 2,
                        endColumnIndex: 4
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: headerRow - 1,
                        endRowIndex: headerRow,
                        startColumnIndex: 4,
                        endColumnIndex: 6
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
        }

        // B = # · C:D problema · E:F acciones · G resp · H fecha · I estatus · J obs
        aplicarRango(itemsStart, itemsEnd, 1, 2, 'CENTER');
        aplicarRango(itemsStart, itemsEnd, 2, 4, 'LEFT');
        aplicarRango(itemsStart, itemsEnd, 4, 6, 'LEFT');
        aplicarRango(itemsStart, itemsEnd, 6, 7, 'LEFT');
        aplicarRango(itemsStart, itemsEnd, 7, 8, 'CENTER');
        aplicarRango(itemsStart, itemsEnd, 8, 9, 'CENTER');
        aplicarRango(itemsStart, itemsEnd, 9, 10, 'LEFT');

        for (let r = itemsStart; r <= itemsEnd; r++) {
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: r - 1,
                        endRowIndex: r,
                        startColumnIndex: 2,
                        endColumnIndex: 4
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: r - 1,
                        endRowIndex: r,
                        startColumnIndex: 4,
                        endColumnIndex: 6
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
        }

        // Alto de fila 50 px
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: itemsStart - 1,
                    endIndex: itemsEnd
                },
                properties: { pixelSize: FILA_ALTO_PX },
                fields: 'pixelSize'
            }
        });

        const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: itemsStart - 1,
                    endRowIndex: itemsEnd,
                    startColumnIndex: 1,
                    endColumnIndex: colFin
                },
                top: bordeNegro,
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro,
                innerHorizontal: bordeNegro,
                innerVertical: bordeNegro
            }
        });

        // Fondo de estatus (columna I) según valor
        const items = Array.isArray(reporte?.items) ? reporte.items : [];
        const colorAbierto = { red: 1, green: 0.92, blue: 0.8 };
        const colorCerrado = { red: 0.86, green: 0.95, blue: 0.88 };
        for (let i = 0; i < (itemsEnd - itemsStart + 1); i++) {
            const row = itemsStart + i;
            const est = String(items[i]?.estatus || '').trim().toLowerCase();
            if (!est) continue;
            const bg = /cerrad/.test(est) ? colorCerrado : colorAbierto;
            aplicarRango(row, row, 8, 9, 'CENTER', { backgroundColor: bg });
        }
    }

    if (!requests.length) {
        return null;
    }
    const CHUNK = 80;
    for (let i = 0; i < requests.length; i += CHUNK) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requests.slice(i, i + CHUNK) }
        });
    }
    return true;
}

async function aplicarFormatoFilasSgcF14(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // Columnas (0-based, fin exclusivo): A folio, B:C nombre, D responsable,
    // E prioridad, F estatus, G:H avance. La tabla abarca A:H (0..8).
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 8;

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow = filaInicio - 1;
    const dataEndRow = startRow + filas;
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : dataEndRow;

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };

    // 1) Desfusionar todo el bloque para evitar conflictos al re-fusionar por fila.
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                unmergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: startRow,
                        endRowIndex: Math.max(dataEndRow, blockEndRow),
                        startColumnIndex: TABLA_COL_INICIO + 1,
                        endColumnIndex: TABLA_COL_FIN
                    }
                }
            }]
        }
    }).catch(() => { /* el bloque puede no tener fusiones previas */ });

    // Tipografia de los datos que escribe el sistema: Century Gothic, tamano 11
    // (en lugar de la fuente "predeterminada" de Google Sheets).
    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };

    const formatoColumna = (startCol, endCol, horizontal) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: dataEndRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [];

    if (filas > 0) {
        requests.push(formatoColumna(0, 1, 'CENTER')); // A folio
        requests.push(formatoColumna(1, 3, 'LEFT'));   // B:C nombre del proyecto
        requests.push(formatoColumna(3, 4, 'LEFT'));   // D responsable
        requests.push(formatoColumna(4, 5, 'CENTER')); // E prioridad
        requests.push(formatoColumna(5, 6, 'CENTER')); // F estatus
        requests.push(formatoColumna(6, 8, 'CENTER')); // G:H % avance
        // Solo se agrega el borde inferior de cada fila (el resto del diseno de
        // la tabla ya viene en la plantilla). innerHorizontal traza la linea
        // entre filas y bottom la del ultimo renglon con datos.
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: bordeNegro,
                innerHorizontal: bordeNegro
            }
        });

        for (let i = 0; i < filas; i++) {
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: startRow + i,
                        endRowIndex: startRow + i + 1,
                        startColumnIndex: 1,
                        endColumnIndex: 3
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: startRow + i,
                        endRowIndex: startRow + i + 1,
                        startColumnIndex: 6,
                        endColumnIndex: 8
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
        }
    }

    // 2) Quitar SOLO el borde inferior de las filas vacías que quedaron debajo
    // de los datos (sin tocar el resto del diseño de la plantilla). No se toca
    // "top" para no borrar el borde inferior del último renglón con datos.
    if (blockEndRow > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: blockEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: sinBorde,
                innerHorizontal: sinBorde
            }
        });
    }

    if (!requests.length) {
        return true;
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * SGC-F-02 · Solicitud de cambios a documentos: Century Gothic 11, merges B:D / G:H / I:J / K:M,
 * solo borde inferior en filas con datos.
 */
async function aplicarFormatoFilasSgcF02(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // A NO, B:D nombre, E código, F versión, G:H tipo doc, I:J tipo sol, K:M motivo.
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 13;

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow = filaInicio - 1;
    const dataEndRow = startRow + filas;
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : dataEndRow;

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                unmergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: startRow,
                        endRowIndex: Math.max(dataEndRow, blockEndRow),
                        startColumnIndex: 1,
                        endColumnIndex: TABLA_COL_FIN
                    }
                }
            }]
        }
    }).catch(() => { /* el bloque puede no tener fusiones previas */ });

    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };

    const formatoColumna = (startCol, endCol, horizontal) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: dataEndRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [];

    if (filas > 0) {
        requests.push(formatoColumna(0, 1, 'CENTER'));   // A NO
        requests.push(formatoColumna(1, 4, 'LEFT'));     // B:D nombre
        requests.push(formatoColumna(4, 5, 'CENTER'));   // E código
        requests.push(formatoColumna(5, 6, 'CENTER'));   // F versión
        requests.push(formatoColumna(6, 8, 'CENTER'));   // G:H tipo documento
        requests.push(formatoColumna(8, 10, 'CENTER'));  // I:J tipo solicitud
        requests.push(formatoColumna(10, 13, 'LEFT'));   // K:M motivo
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: bordeNegro,
                innerHorizontal: bordeNegro
            }
        });

        for (let i = 0; i < filas; i++) {
            const merges = [
                [1, 4],   // B:D
                [6, 8],   // G:H
                [8, 10],  // I:J
                [10, 13]  // K:M
            ];
            for (const [startCol, endCol] of merges) {
                requests.push({
                    mergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: startRow + i,
                            endRowIndex: startRow + i + 1,
                            startColumnIndex: startCol,
                            endColumnIndex: endCol
                        },
                        mergeType: 'MERGE_ALL'
                    }
                });
            }
        }
    }

    if (blockEndRow > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: blockEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: sinBorde,
                innerHorizontal: sinBorde
            }
        });
    }

    if (!requests.length) {
        return true;
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * SGC-F-29 · Evaluación de proveedores: Century Gothic 11, alineación por columna
 * y caja de tabla cerrada (incl. Calificación). Tabla A:J con Proveedor en B:C.
 */
async function aplicarFormatoFilasSgcF29(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title),merges)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // A No | B:C Proveedor | D–H criterios | I Calidad producto | J Calificación.
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 10; // A..J (fin exclusivo)
    const HEADER_ROW_IDX = 6; // fila 7 (0-based)

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow = filaInicio - 1;
    const dataEndRow = startRow + Math.max(filas, 0);
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : dataEndRow;
    const tablaEndRow = Math.max(dataEndRow, startRow);

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };
    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };
    const grisEncabezado = { red: 0.85, green: 0.85, blue: 0.85 };

    const formatoColumna = (startCol, endCol, horizontal, rowStart, rowEnd) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: rowStart,
                endRowIndex: rowEnd,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    // Quitar fusiones B:C previas en encabezado + bloque de datos para recrearlas limpias.
    const unmergeRequests = [];
    const mergeTop = Math.min(HEADER_ROW_IDX, startRow);
    const mergeBottom = Math.max(HEADER_ROW_IDX + 1, blockEndRow);
    for (const m of (sheet.merges || [])) {
        const overlapRows = m.startRowIndex < mergeBottom && m.endRowIndex > mergeTop;
        const overlapProv = m.startColumnIndex <= 1 && m.endColumnIndex >= 3;
        if (overlapRows && overlapProv) {
            unmergeRequests.push({ unmergeCells: { range: { ...m, sheetId } } });
        }
    }
    if (unmergeRequests.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: unmergeRequests }
        }).catch(() => { /* fusiones ya liberadas */ });
    }

    const requests = [];

    // Fusionar Proveedor B:C en encabezado y en cada fila del bloque.
    requests.push({
        mergeCells: {
            range: {
                sheetId,
                startRowIndex: HEADER_ROW_IDX,
                endRowIndex: HEADER_ROW_IDX + 1,
                startColumnIndex: 1,
                endColumnIndex: 3
            },
            mergeType: 'MERGE_ALL'
        }
    });
    for (let r = startRow; r < blockEndRow; r++) {
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: r,
                    endRowIndex: r + 1,
                    startColumnIndex: 1,
                    endColumnIndex: 3
                },
                mergeType: 'MERGE_ALL'
            }
        });
    }

    // Encabezado A7:J7 — gris, Century Gothic 10, sin negrita (incl. Calificación).
    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: HEADER_ROW_IDX,
                endRowIndex: HEADER_ROW_IDX + 1,
                startColumnIndex: TABLA_COL_INICIO,
                endColumnIndex: TABLA_COL_FIN
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: grisEncabezado,
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat: {
                        fontFamily: 'Century Gothic',
                        fontSize: 10,
                        bold: false
                    }
                }
            },
            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    if (filas > 0) {
        requests.push(formatoColumna(0, 1, 'CENTER', startRow, dataEndRow));   // A No
        requests.push(formatoColumna(1, 3, 'LEFT', startRow, dataEndRow));    // B:C Proveedor
        requests.push(formatoColumna(3, 10, 'CENTER', startRow, dataEndRow)); // D–J (incl. Calificación)

        // Caja completa encabezado + datos: cierra abajo y a la derecha (Calificación).
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: HEADER_ROW_IDX,
                    endRowIndex: tablaEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                top: bordeNegro,
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro,
                innerHorizontal: bordeNegro,
                innerVertical: bordeNegro
            }
        });
    } else {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: HEADER_ROW_IDX,
                    endRowIndex: HEADER_ROW_IDX + 1,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                top: bordeNegro,
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro,
                innerVertical: bordeNegro
            }
        });
    }

    // Filas vacías: no tocar "top" para no borrar el borde inferior del último dato.
    if (blockEndRow > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: blockEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: sinBorde,
                innerHorizontal: sinBorde
            }
        });
    }

    // Columnas K:L residuales: no tocar "left" de K (borraría el borde derecho de Calificación).
    requests.push({
        updateBorders: {
            range: {
                sheetId,
                startRowIndex: HEADER_ROW_IDX,
                endRowIndex: Math.max(blockEndRow, HEADER_ROW_IDX + 1),
                startColumnIndex: 10,
                endColumnIndex: 12
            },
            top: sinBorde,
            bottom: sinBorde,
            right: sinBorde,
            innerHorizontal: sinBorde,
            innerVertical: sinBorde
        }
    });

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * SGC-F-05 · Bitácora de no conformidades: formatea las filas con datos
 * (Century Gothic 10, alineación por columna, colores de estatus y borde
 * inferior por fila) y limpia los bordes de las filas vacías debajo.
 */
function hexColorToSheetsRgb(hex) {
    const h = String(hex || '').replace('#', '').trim();
    if (h.length !== 6) {
        return { red: 0, green: 0, blue: 0 };
    }
    return {
        red: parseInt(h.slice(0, 2), 16) / 255,
        green: parseInt(h.slice(2, 4), 16) / 255,
        blue: parseInt(h.slice(4, 6), 16) / 255
    };
}

const SGC_F05_ESTATUS_ESTILOS = {
    cerrada: {
        text: hexColorToSheetsRgb('006100'),
        bg: hexColorToSheetsRgb('c6efce')
    },
    abierta: {
        text: hexColorToSheetsRgb('9c0006'),
        bg: hexColorToSheetsRgb('ffc7ce')
    }
};

function estiloEstatusSgcF05(valor) {
    const v = String(valor || '').trim().toLowerCase();
    if (v === 'cerrada') return SGC_F05_ESTATUS_ESTILOS.cerrada;
    if (v === 'abierta') return SGC_F05_ESTATUS_ESTILOS.abierta;
    return null;
}

async function aplicarFormatoFilasSgcF05(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax, registros = []) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // Columnas (0-based, fin exclusivo): A folio, B fuente, C fecha inicio,
    // D fecha cierre, E área, F cliente, G descripción, H acción, I estatus.
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 9;
    const COL_ESTATUS = 8;

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow = filaInicio - 1;
    const dataEndRow = startRow + filas;
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : dataEndRow;

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };

    const textFormat = { fontFamily: 'Century Gothic', fontSize: 10 };

    const formatoColumna = (startCol, endCol, horizontal) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: dataEndRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [];

    if (filas > 0) {
        requests.push(formatoColumna(0, 1, 'CENTER')); // A folio
        requests.push(formatoColumna(1, 2, 'CENTER')); // B fuente
        requests.push(formatoColumna(2, 4, 'CENTER')); // C:D fechas
        requests.push(formatoColumna(4, 6, 'LEFT'));   // E área, F cliente
        requests.push(formatoColumna(6, 8, 'LEFT'));   // G descripción, H acción
        requests.push(formatoColumna(8, 9, 'CENTER')); // I estatus (base)

        const listaRegistros = Array.isArray(registros) ? registros : [];
        for (let i = 0; i < filas; i++) {
            const estilo = estiloEstatusSgcF05(listaRegistros[i]?.estatus);
            if (!estilo) continue;
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: startRow + i,
                        endRowIndex: startRow + i + 1,
                        startColumnIndex: COL_ESTATUS,
                        endColumnIndex: COL_ESTATUS + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textFormat: {
                                fontFamily: 'Century Gothic',
                                fontSize: 10,
                                foregroundColor: estilo.text
                            },
                            backgroundColor: estilo.bg
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,backgroundColor)'
                }
            });
        }

        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: bordeNegro,
                innerHorizontal: bordeNegro
            }
        });
    }

    // Limpiar SOLO el borde inferior de las filas vacías debajo de los datos
    // (sin tocar "top" para no borrar el borde del último renglón con datos).
    if (blockEndRow > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: blockEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: sinBorde,
                innerHorizontal: sinBorde
            }
        });
    }

    if (!requests.length) {
        return true;
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * SGC-F-25 · Actividades posteriores a la entrega: Century Gothic 11,
 * alineación por columna y cuadrícula completa (bordes en todas las celdas con datos).
 */
async function aplicarFormatoFilasSgcF25(spreadsheetId, sheetTitle, filaInicio, numFilas, filaMax) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => (s.properties?.title || '').trim() === String(sheetTitle).trim());
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    // Columnas (0-based, fin exclusivo): A..K (0..11)
    const TABLA_COL_INICIO = 0;
    const TABLA_COL_FIN = 11;

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow = filaInicio - 1;
    const dataEndRow = startRow + filas;
    const blockEndRow = Number.isFinite(filaMax) && filaMax >= filaInicio
        ? Number(filaMax)
        : dataEndRow;

    const bordeNegro = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
    const sinBorde = { style: 'NONE' };
    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };

    const formatoColumna = (startCol, endCol, horizontal) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: dataEndRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [];

    if (filas > 0) {
        requests.push(formatoColumna(0, 1, 'CENTER'));  // A No. contrato
        requests.push(formatoColumna(1, 4, 'LEFT'));    // B-D cliente/actividad/descripción
        requests.push(formatoColumna(4, 5, 'CENTER'));  // E fecha
        requests.push(formatoColumna(5, 6, 'LEFT'));    // F responsables
        requests.push(formatoColumna(6, 11, 'CENTER')); // G-K categorías
        // Cuadrícula completa para que filas nuevas conserven el formato de tabla.
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                top: bordeNegro,
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro,
                innerHorizontal: bordeNegro,
                innerVertical: bordeNegro
            }
        });
        // Refuerza el borde inferior del último renglón con datos (cierre de tabla).
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow - 1,
                    endRowIndex: dataEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: bordeNegro
            }
        });
    }

    // Limpiar bordes de filas vacías debajo SIN tocar "top":
    // el top de la primera fila vacía es el bottom del último renglón con datos.
    if (blockEndRow > dataEndRow) {
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: dataEndRow,
                    endRowIndex: blockEndRow,
                    startColumnIndex: TABLA_COL_INICIO,
                    endColumnIndex: TABLA_COL_FIN
                },
                bottom: sinBorde,
                left: sinBorde,
                right: sinBorde,
                innerHorizontal: sinBorde,
                innerVertical: sinBorde
            }
        });
    }

    if (!requests.length) {
        return true;
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * SGC-F-04 · Reporte de no conformidad: alineación de celdas con datos del sistema
 * (Rev 02). Se aplica después de escribir valores vía API.
 */
/**
 * SGC-F-22 · tipografía Century Gothic 10 y alineación izquierda en campos de captura.
 * Celdas: fecha (E5), identificación (C8:E10), descripción (A13:E17), acciones (A20:E24).
 */
async function aplicarFormatoVisualSgcF22(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const textFormat = {
        fontFamily: 'Century Gothic',
        fontSize: 10,
        foregroundColor: { red: 0, green: 0, blue: 0 }
    };

    const aplicar = (rowStart, rowEnd, colStart, colEnd, horizontal, vertical = 'MIDDLE') => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: rowStart - 1,
                endRowIndex: rowEnd,
                startColumnIndex: colStart - 1,
                endColumnIndex: colEnd
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: vertical,
                    wrapStrategy: 'WRAP',
                    textFormat
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [
        // Fecha del suceso (E5:E6) — centrada (forzar explícito)
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 4,
                    endRowIndex: 6,
                    startColumnIndex: 4,
                    endColumnIndex: 5
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
            }
        },
        // Identificación: valores C8:E10
        aplicar(8, 10, 3, 5, 'LEFT', 'MIDDLE'),
        // Descripción del suceso A13:E17 — centrado horizontal y vertical
        aplicar(13, 17, 1, 5, 'CENTER', 'MIDDLE'),
        // Acciones por parte de Biznaga A20:E24 — centrado horizontal y vertical
        aplicar(20, 24, 1, 5, 'CENTER', 'MIDDLE'),
        // Revisión / Fech. Rev. (E2:E3)
        aplicar(2, 3, 5, 5, 'LEFT', 'MIDDLE')
    ];

    return sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

async function aplicarFormatoVisualSgcF04(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const textoNegroCenturyGothic10 = {
        fontFamily: 'Century Gothic',
        fontSize: 10,
        foregroundColor: { red: 0, green: 0, blue: 0 }
    };

    const alinear = (rowStart, rowEnd, colStart, colEnd, horizontal, vertical = 'MIDDLE') => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: rowStart - 1,
                endRowIndex: rowEnd,
                startColumnIndex: colStart - 1,
                endColumnIndex: colEnd
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: vertical,
                    wrapStrategy: 'WRAP'
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)'
        }
    });

    const alinearConTexto = (rowStart, rowEnd, colStart, colEnd, horizontal, vertical = 'MIDDLE') => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: rowStart - 1,
                endRowIndex: rowEnd,
                startColumnIndex: colStart - 1,
                endColumnIndex: colEnd
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: horizontal,
                    verticalAlignment: vertical,
                    wrapStrategy: 'WRAP',
                    textFormat: textoNegroCenturyGothic10
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    const requests = [];

    // 5. Causas — fusión B45:M49 bajo "Identificación de las causas"
    for (let row = 45; row <= 49; row++) {
        requests.push({
            unmergeCells: {
                range: {
                    sheetId,
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: 1,
                    endColumnIndex: 13
                }
            }
        });
    }
    for (let row = 45; row <= 49; row++) {
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: row - 1,
                    endRowIndex: row,
                    startColumnIndex: 1,
                    endColumnIndex: 13
                },
                mergeType: 'MERGE_ALL'
            }
        });
    }

    // Etiqueta "SERVICIO NO CONFORME" — fusión G9:H9
    requests.push({
        unmergeCells: {
            range: {
                sheetId,
                startRowIndex: 8,
                endRowIndex: 9,
                startColumnIndex: 6,
                endColumnIndex: 8
            }
        }
    }, {
        mergeCells: {
            range: {
                sheetId,
                startRowIndex: 8,
                endRowIndex: 9,
                startColumnIndex: 6,
                endColumnIndex: 8
            },
            mergeType: 'MERGE_ALL'
        }
    }, {
        updateCells: {
            range: {
                sheetId,
                startRowIndex: 8,
                endRowIndex: 9,
                startColumnIndex: 6,
                endColumnIndex: 7
            },
            rows: [{
                values: [{
                    userEnteredValue: { stringValue: 'SERVICIO NO CONFORME' },
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP'
                    }
                }]
            }],
            fields: 'userEnteredValue,userEnteredFormat'
        }
    });

    const anchoColumna = (colIndex, pixelSize) => ({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: colIndex,
                endIndex: colIndex + 1
            },
            properties: { pixelSize },
            fields: 'pixelSize'
        }
    });

    requests.push(
        anchoColumna(0, 70),
        anchoColumna(1, 70),
        anchoColumna(2, 70),
        anchoColumna(4, 60),
        anchoColumna(10, 60)
    );

    requests.push(
        // Folio (L5) y fecha (B6:C6) — negro, Century Gothic 10
        alinearConTexto(5, 5, 12, 13, 'CENTER'),
        alinearConTexto(6, 6, 2, 4, 'CENTER'),
        // 1. Fuente — casillas de marcado
        alinear(9, 9, 2, 3, 'CENTER'),
        alinear(9, 9, 4, 5, 'CENTER'),
        alinear(9, 9, 6, 7, 'CENTER'),
        alinear(9, 9, 7, 9, 'CENTER', 'MIDDLE'),
        alinear(9, 9, 9, 10, 'CENTER'),
        alinear(9, 9, 11, 12, 'CENTER'),
        // Detalle (A10:J11)
        alinear(10, 11, 1, 11, 'CENTER', 'MIDDLE'),
        // Norma que afecta — X a la derecha del texto (columna M)
        alinear(9, 11, 13, 14, 'CENTER'),
        // Origen NC (A14:D16) y descripción (A19:M22)
        alinear(14, 16, 1, 5, 'CENTER', 'MIDDLE'),
        alinear(19, 22, 1, 14, 'CENTER', 'MIDDLE'),
        // 3. Acciones a realizar — casillas E y J
        alinear(25, 25, 5, 6, 'CENTER'),
        alinear(26, 26, 5, 6, 'CENTER'),
        alinear(25, 30, 10, 11, 'CENTER'),
        // 4. Corrección — fecha de implementación (K)
        alinear(38, 41, 11, 12, 'CENTER'),
        // 5. Acción correctiva — lluvia de ideas (B45:M49) y fechas (L)
        alinear(45, 49, 2, 14, 'LEFT', 'MIDDLE'),
        alinear(51, 55, 12, 13, 'CENTER'),
        // 7. Cierre — fecha de cierre (L66:M66)
        alinear(66, 66, 12, 14, 'LEFT')
    );

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

async function resolverFilaFirmasDgF05(spreadsheetId, sheetTitle) {
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle}'!D1:D120`,
        majorDimension: 'ROWS'
    });
    const values = res.data.values || [];
    for (let i = 0; i < values.length; i++) {
        const txt = String(values[i]?.[0] || '').toUpperCase();
        if (txt.includes('ELABORÓ') || txt.includes('ELABORO')) {
            return i + 1;
        }
    }
    return null;
}

async function resolverFilaNotaDgF05(spreadsheetId, sheetTitle) {
    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTitle}'!B1:B120`,
        majorDimension: 'ROWS'
    });
    const values = res.data.values || [];
    for (let i = 0; i < values.length; i++) {
        const txt = String(values[i]?.[0] || '').toLowerCase();
        if (txt.includes('partes interesadas con influencia')) {
            return i + 1;
        }
    }
    return null;
}

/** Quita bordes y valores B:I en filas vacías entre el fin de datos y la fila de nota. */
async function limpiarBordesTablaDebajoDatosDgF05(
    spreadsheetId,
    sheetTitle,
    filaInicioDatos = 10,
    numFilas = 1,
    filasPrevias = 0
) {
    if (!spreadsheetId) {
        return null;
    }

    const filaNota = await resolverFilaNotaDgF05(spreadsheetId, sheetTitle);
    const filaInicioLimpieza = filaInicioDatos + numFilas;
    const filaFinLimpieza = filaNota
        ? filaNota - 1
        : filaInicioDatos + Math.max(filasPrevias, numFilas) - 1;

    if (filaInicioLimpieza > filaFinLimpieza) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const bordeNinguno = { style: 'NONE' };
    const requests = [
        {
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: filaInicioLimpieza - 1,
                    endRowIndex: filaFinLimpieza,
                    startColumnIndex: 1,
                    endColumnIndex: 9
                },
                top: bordeNinguno,
                bottom: bordeNinguno,
                left: bordeNinguno,
                right: bordeNinguno,
                innerHorizontal: bordeNinguno,
                innerVertical: bordeNinguno
            }
        }
    ];

    for (let r = filaInicioLimpieza; r <= filaFinLimpieza; r++) {
        requests.push({
            unmergeCells: {
                range: {
                    sheetId,
                    startRowIndex: r - 1,
                    endRowIndex: r,
                    startColumnIndex: 7,
                    endColumnIndex: 9
                }
            }
        });
    }

    await sheetsApi.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${sheetTitle}'!B${filaInicioLimpieza}:I${filaFinLimpieza}`
    });

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/** Borde inferior última fila de datos, derecho de Seguimiento (col I) y bordes del bloque AUTORIZÓ (col E). */
async function aplicarBordesComplementariosDgF05(
    spreadsheetId,
    sheetTitle,
    filaInicioDatos = 10,
    numFilas = 1,
    filaEncabezado = 9
) {
    if (!spreadsheetId) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const bordeNegro = { style: 'SOLID', width: 2, color: { red: 0, green: 0, blue: 0 } };
    const requests = [];
    const filaFinDatos = filaInicioDatos + Math.max(numFilas, 1) - 1;

    requests.push({
        updateBorders: {
            range: {
                sheetId,
                startRowIndex: filaFinDatos - 1,
                endRowIndex: filaFinDatos,
                startColumnIndex: 1,
                endColumnIndex: 9
            },
            bottom: bordeNegro
        }
    });

    requests.push({
        updateBorders: {
            range: {
                sheetId,
                startRowIndex: filaEncabezado - 1,
                endRowIndex: filaFinDatos,
                startColumnIndex: 8,
                endColumnIndex: 9
            },
            right: bordeNegro
        }
    });

    const filaFirmas = await resolverFilaFirmasDgF05(spreadsheetId, sheetTitle);
    if (filaFirmas) {
        const filaFinBloque = filaFirmas + 7;
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: filaFinBloque - 1,
                    endRowIndex: filaFinBloque,
                    startColumnIndex: 3,
                    endColumnIndex: 4
                },
                bottom: bordeNegro,
                left: bordeNegro,
                right: bordeNegro
            }
        });
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: filaFinBloque - 1,
                    endRowIndex: filaFinBloque,
                    startColumnIndex: 4,
                    endColumnIndex: 5
                },
                bottom: bordeNegro,
                right: bordeNegro
            }
        });
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: filaFirmas,
                    endRowIndex: filaFinBloque,
                    startColumnIndex: 4,
                    endColumnIndex: 5
                },
                right: bordeNegro
            }
        });
    }

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/** Fusión vertical D (Elaboró) como en la plantilla original. */
async function asegurarMergeElaboroDgF05(spreadsheetId, sheetTitle, filaFirmas) {
    if (!spreadsheetId || !filaFirmas) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const filaInicio = filaFirmas + 1;
    const filaFin = filaFirmas + 7;

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    unmergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: filaInicio - 1,
                            endRowIndex: filaFin,
                            startColumnIndex: 3,
                            endColumnIndex: 4
                        }
                    }
                },
                {
                    mergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: filaInicio - 1,
                            endRowIndex: filaFin,
                            startColumnIndex: 3,
                            endColumnIndex: 4
                        },
                        mergeType: 'MERGE_ALL'
                    }
                }
            ]
        }
    });
    return true;
}

/** Quita bordes de la columna F (Influencia) fuera del cuadro principal de datos. */
async function limpiarBordesColumnaInfluenciaFueraTablaDgF05(
    spreadsheetId,
    sheetTitle,
    filaInicioDatos = 10,
    numFilas = 1
) {
    if (!spreadsheetId) {
        return null;
    }

    const filaInicio = filaInicioDatos + numFilas;
    const filaFin = 120;

    if (filaInicio > filaFin) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === sheetTitle);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const bordeNinguno = { style: 'NONE' };
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: filaInicio - 1,
                        endRowIndex: filaFin,
                        startColumnIndex: 5,
                        endColumnIndex: 6
                    },
                    top: bordeNinguno,
                    bottom: bordeNinguno,
                    left: bordeNinguno,
                    right: bordeNinguno
                }
            }]
        }
    });
    return true;
}

/**
 * Descarga binaria (alt=media). No aplica a archivos nativos de Google Workspace.
 */
async function descargarArchivoBinario(fileId) {
    const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
}

/**
 * Descargar un archivo desde Google Drive
 * @param {string} fileId - ID del archivo en Google Drive
 * @returns {Promise<Buffer>} - Buffer con el contenido del archivo
 */
async function descargarArchivo(fileId) {
    try {
        const buffer = await descargarArchivoBinario(fileId);
        driveDebug(`  Archivo descargado (${buffer.length} bytes)`);
        return buffer;
    } catch (error) {
        const codigo = Number(error?.code || error?.response?.status || 0);
        const es403 = codigo === 403 || String(error?.message || '').includes('403');
        if (es403) {
            try {
                const info = await obtenerInfoArchivo(fileId);
                if (String(info?.mimeType || '') === 'application/vnd.google-apps.spreadsheet') {
                    driveDebug('  Google Sheet nativo: exportando como XLSX (alt=media no aplica)');
                    return await exportarGoogleSheetComoXLSX(fileId);
                }
            } catch (_fallbackErr) {
                // Conservar el error original de descarga.
            }
        }
        // No loguear 404 (archivo no existe) — es un flujo normal de la app
        if (error?.code !== 404 && !error?.message?.includes('404') && !error?.message?.includes('not found')) {
            console.error('[ERROR] Error descargando archivo:', error.message);
        }
        throw error;
    }
}

/**
 * Eliminar un archivo de Google Drive
 * @param {string} fileId - ID del archivo a eliminar
 * @returns {Promise<void>}
 */
async function eliminarArchivo(fileId) {
    try {
        const eliminado = await eliminarArchivoDrive(fileId);
        if (eliminado) {
            driveDebug('  Archivo eliminado');
        }
        return eliminado;
    } catch (error) {
        console.error('[ERROR] Error eliminando archivo:', error.message);
        throw error;
    }
}

/**
 * Eliminar una carpeta de Google Drive por ID.
 * @param {string} folderId - ID de la carpeta a eliminar
 * @returns {Promise<void>}
 */
async function eliminarCarpetaPorId(folderId) {
    try {
        const eliminada = await eliminarArchivoDrive(folderId, 'Carpeta');
        if (eliminada) {
            console.log(`  Carpeta eliminada (${folderId})`);
        }
        return eliminada;
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta:', error.message);
        throw error;
    }
}

/**
 * Renombrar una carpeta de Google Drive por ID.
 * @param {string} folderId - ID de la carpeta
 * @param {string} nuevoNombre - Nuevo nombre de carpeta
 * @returns {Promise<void>}
 */
async function renombrarCarpetaPorId(folderId, nuevoNombre) {
    try {
        await drive.files.update({
            fileId: folderId,
            requestBody: { name: String(nuevoNombre || '').trim() }
        });
        console.log(`  Carpeta renombrada (${folderId}) -> ${nuevoNombre}`);
    } catch (error) {
        console.error('[ERROR] Error renombrando carpeta por ID:', error.message);
        throw error;
    }
}

/**
 * Renombra un archivo (o carpeta) de Drive por ID.
 */
async function renombrarArchivoPorId(fileId, nuevoNombre) {
    if (!fileId) throw new Error('fileId es obligatorio para renombrar');
    const name = String(nuevoNombre || '').trim();
    if (!name) throw new Error('nuevoNombre es obligatorio');
    await drive.files.update({
        fileId,
        requestBody: { name }
    });
    console.log(`  Archivo renombrado (${fileId}) -> ${name}`);
    return { id: fileId, name };
}

/**
 * Metadatos básicos de un archivo Drive (incluye parents).
 */
async function obtenerMetadatosArchivo(fileId) {
    if (!fileId) return null;
    const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, parents, size, modifiedTime, trashed',
        supportsAllDrives: true
    });
    return response.data || null;
}

/**
 * Verificar si un archivo existe en Google Drive
 * @param {string} fileId - ID del archivo
 * @returns {Promise<boolean>} - true si existe, false si fue eliminado o no se encuentra
 */
async function verificarArchivoExiste(fileId) {
    try {
        if (!fileId) return false;
        const response = await drive.files.get({
            fileId: fileId,
            fields: 'id, trashed',
            supportsAllDrives: true
        });
        return !response.data?.trashed;
    } catch (error) {
        if (esErrorNoEncontradoDrive(error)) {
            return false;
        }
        // Para otros errores (permisos, red), asumir que existe para no borrar por error
        console.warn(`[WARN] verificarArchivoExiste(${fileId}): ${error.message}`);
        return true;
    }
}

/**
 * Verificar múltiples archivos en lote (más eficiente)
 * @param {string[]} fileIds - Array de IDs de archivos
 * @returns {Promise<Map<string, boolean>>} - Map de fileId → existe
 */
async function verificarArchivosLote(fileIds) {
    const resultados = new Map();
    const tareas = fileIds.filter(id => id).map(async (fileId) => {
        const existe = await verificarArchivoExiste(fileId);
        resultados.set(fileId, existe);
    });
    await Promise.allSettled(tareas);
    return resultados;
}

/**
 * Obtener información de un archivo
 * @param {string} fileId - ID del archivo
 * @returns {Promise<object>} - Información del archivo
 */
async function obtenerInfoArchivo(fileId) {
    try {
        const response = await drive.files.get({
            fileId: fileId,
            fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink',
            supportsAllDrives: true
        });
        return response.data;
    } catch (error) {
        console.error('[ERROR] Error obteniendo info de archivo:', error.message);
        throw error;
    }
}

// =====================================================
// FUNCIONES ESPECÍFICAS PARA EL SISTEMA
// =====================================================

/**
 * Crear estructura de carpetas para una empresa
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @returns {Promise<string>} - ID de la carpeta de la empresa
 */
async function crearCarpetaEmpresa(nombreEmpresa) {
    try {
        // Crear/obtener carpeta "Empresas"
        const carpetaEmpresas = await obtenerOCrearCarpeta('Empresas', ROOT_FOLDER_ID);

        // Crear/obtener carpeta de la empresa
        const carpetaEmpresa = await obtenerOCrearCarpeta(nombreEmpresa, carpetaEmpresas);

        console.log(`  Carpeta de empresa lista: ${nombreEmpresa}`);
        return carpetaEmpresa;
    } catch (error) {
        console.error('[ERROR] Error creando carpeta de empresa:', error.message);
        throw error;
    }
}

/**
 * Subir constancia fiscal de una empresa
 * @param {Buffer} buffer - Buffer del PDF
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @returns {Promise<object>} - Información del archivo subido
 */
async function subirConstanciaEmpresa(buffer, nombreEmpresa) {
    try {
        const carpetaEmpresa = await crearCarpetaEmpresa(nombreEmpresa);
        const nombreArchivo = `${nombreEmpresa}_constancia.pdf`;
        return await subirArchivo(buffer, nombreArchivo, 'application/pdf', carpetaEmpresa);
    } catch (error) {
        console.error('[ERROR] Error subiendo constancia:', error.message);
        throw error;
    }
}

/**
 * Obtener constancia fiscal de una empresa
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @returns {Promise<Buffer|null>} - Buffer del archivo o null si no existe
 */
async function obtenerConstanciaEmpresa(nombreEmpresa) {
    try {
        // Buscar carpeta de la empresa
        const carpetaEmpresas = await buscarCarpeta('Empresas', ROOT_FOLDER_ID);
        if (!carpetaEmpresas) {
            return null;
        }

        const carpetaEmpresa = await buscarCarpeta(nombreEmpresa, carpetaEmpresas);
        if (!carpetaEmpresa) {
            return null;
        }

        // Buscar archivo de constancia
        const nombreArchivo = `${nombreEmpresa}_constancia.pdf`;
        const archivo = await buscarArchivo(nombreArchivo, carpetaEmpresa);

        if (!archivo) {
            return null;
        }

        // Descargar archivo
        return await descargarArchivo(archivo.id);
    } catch (error) {
        console.error('[ERROR] Error obteniendo constancia:', error.message);
        throw error;
    }
}

// =====================================================
// FUNCIÓN DE PRUEBA
// =====================================================

/**
 * Probar la conexión con Google Drive
 * @returns {Promise<boolean>} - true si la conexión es exitosa
 */
async function probarConexion() {
    try {
        console.log('\nProbando conexión con Google Drive...');
        console.log(`   Método de autenticación: ${authMethod}`);

        const response = await drive.files.get({
            fileId: ROOT_FOLDER_ID,
            fields: 'id, name'
        });

        console.log('  Conexión exitosa!');
        console.log(`   Carpeta raíz: ${response.data.name} (${response.data.id})`);

        // Si es OAuth2, probar escritura
        if (authMethod === 'oauth2') {
            const stream = require('stream');
            const testFile = await drive.files.create({
                requestBody: {
                    name: '_test_conexion_biznaga.txt',
                    parents: [ROOT_FOLDER_ID]
                },
                media: {
                    mimeType: 'text/plain',
                    body: stream.Readable.from(Buffer.from('Test de conexion'))
                },
                fields: 'id'
            });
            await drive.files.delete({ fileId: testFile.data.id });
            console.log('  Escritura verificada (OAuth2)');
        }

        return true;
    } catch (error) {
        console.error('[ERROR] Error de conexión:', error.message);
        return false;
    }
}

// =====================================================
// FUNCIONES PARA CURSOS Y ÁREAS TEMÁTICAS
// =====================================================

/**
 * Resolver carpeta "Cursos" bajo Capacitaciones (migra desde raíz si existe legacy).
 * @returns {Promise<string|null>}
 */
async function resolverCarpetaCursos({ crearSiNoExiste = true } = {}) {
    if (_cacheCarpetaCursosId) {
        return _cacheCarpetaCursosId;
    }

    const carpetaCapacitaciones = await obtenerOCrearCarpeta(CARPETA_CAPACITACIONES, ROOT_FOLDER_ID);
    const enCapacitaciones = await buscarCarpeta(CARPETA_CURSOS, carpetaCapacitaciones);
    if (enCapacitaciones) {
        _cacheCarpetaCursosId = enCapacitaciones;
        return enCapacitaciones;
    }

    const enRaiz = await buscarCarpeta(CARPETA_CURSOS, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaCursosId = await moverCarpetaDrive(enRaiz, carpetaCapacitaciones);
        return _cacheCarpetaCursosId;
    }

    if (!crearSiNoExiste) {
        return null;
    }

    _cacheCarpetaCursosId = await crearCarpeta(CARPETA_CURSOS, carpetaCapacitaciones);
    return _cacheCarpetaCursosId;
}

/**
 * Crear/obtener carpeta "Cursos" dentro de Capacitaciones
 * @returns {Promise<string>} - ID de la carpeta Cursos
 */
async function obtenerCarpetaCursos() {
    return resolverCarpetaCursos({ crearSiNoExiste: true });
}

/**
 * Buscar carpeta Cursos sin crearla (para eliminaciones/renombres).
 * @returns {Promise<string|null>}
 */
async function buscarCarpetaCursos() {
    return resolverCarpetaCursos({ crearSiNoExiste: false });
}

function rutaLogCarpetaCurso(nombreArea, nombreCurso = '') {
    const base = `Capacitaciones/Cursos/${nombreArea}`;
    return nombreCurso ? `${base}/${nombreCurso}` : base;
}

/**
 * Crear/obtener carpeta de un área temática dentro de Cursos
 * @param {string} nombreArea - Nombre del área temática
 * @returns {Promise<string>} - ID de la carpeta del área
 */
async function crearCarpetaAreaTematica(nombreArea) {
    try {
        const carpetaCursos = await obtenerCarpetaCursos();
        const carpetaArea = await obtenerOCrearCarpeta(nombreArea, carpetaCursos);
        console.log(`  Carpeta de área temática lista: ${nombreArea}`);
        return carpetaArea;
    } catch (error) {
        console.error('[ERROR] Error creando carpeta de área temática:', error.message);
        throw error;
    }
}

/**
 * Eliminar carpeta de un área temática
 * @param {string} nombreArea - Nombre del área a eliminar
 * @returns {Promise<{success: boolean}>}
 */
async function eliminarCarpetaAreaTematica(nombreArea) {
    try {
        const carpetaCursos = await buscarCarpetaCursos();
        if (!carpetaCursos) return { success: true, message: 'Carpeta Cursos no existe' };

        const carpetaArea = await buscarCarpeta(nombreArea, carpetaCursos);
        if (!carpetaArea) return { success: true, message: 'Carpeta de área no existía' };

        await drive.files.delete({ fileId: carpetaArea });
        return { success: true, message: 'Carpeta eliminada' };
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta de área temática:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Crear/obtener carpeta de un curso dentro de su área temática
 * @param {string} nombreArea - Nombre del área temática
 * @param {string} nombreCurso - Nombre del curso
 * @returns {Promise<{success: boolean, folderId: string, path: string}>}
 */
async function crearCarpetaCurso(nombreArea, nombreCurso) {
    try {
        const carpetaArea = await crearCarpetaAreaTematica(nombreArea);
        const carpetaCurso = await obtenerOCrearCarpeta(nombreCurso, carpetaArea);
        const path = rutaLogCarpetaCurso(nombreArea, nombreCurso);
        console.log(`  Carpeta de curso lista: ${path}`);
        return { success: true, folderId: carpetaCurso, path };
    } catch (error) {
        console.error('[ERROR] Error creando carpeta de curso:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Eliminar carpeta de un curso
 * @param {string} nombreArea - Nombre del área temática
 * @param {string} nombreCurso - Nombre del curso
 * @returns {Promise<{success: boolean}>}
 */
async function eliminarCarpetaCurso(nombreArea, nombreCurso) {
    try {
        const carpetaCursos = await buscarCarpetaCursos();
        if (!carpetaCursos) return { success: true, message: 'Carpeta Cursos no existe' };

        const carpetaArea = await buscarCarpeta(nombreArea, carpetaCursos);
        if (!carpetaArea) return { success: true, message: 'Carpeta de área no existía' };

        const carpetaCurso = await buscarCarpeta(nombreCurso, carpetaArea);
        if (!carpetaCurso) return { success: true, message: 'Carpeta de curso no existía' };

        await drive.files.delete({ fileId: carpetaCurso });
        return { success: true, message: 'Carpeta de curso eliminada' };
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta de curso:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Renombrar carpeta de un curso (en Drive se hace creando nueva y moviendo contenido)
 * @param {string} nombreArea - Nombre del área temática
 * @param {string} nombreAntiguo - Nombre antiguo del curso
 * @param {string} nombreNuevo - Nombre nuevo del curso
 * @returns {Promise<{success: boolean}>}
 */
async function renombrarCarpetaCurso(nombreArea, nombreAntiguo, nombreNuevo) {
    try {
        const carpetaCursos = await buscarCarpetaCursos();
        if (!carpetaCursos) {
            return await crearCarpetaCurso(nombreArea, nombreNuevo);
        }

        const carpetaArea = await buscarCarpeta(nombreArea, carpetaCursos);
        if (!carpetaArea) {
            return await crearCarpetaCurso(nombreArea, nombreNuevo);
        }

        const carpetaCurso = await buscarCarpeta(nombreAntiguo, carpetaArea);
        if (!carpetaCurso) {
            // Si no existe la carpeta antigua, crear la nueva
            return await crearCarpetaCurso(nombreArea, nombreNuevo);
        }

        // Renombrar la carpeta (Google Drive permite rename via update)
        await drive.files.update({
            fileId: carpetaCurso,
            requestBody: { name: nombreNuevo }
        });

        console.log(`  Carpeta de curso renombrada: ${nombreAntiguo} → ${nombreNuevo}`);
        return { success: true, message: 'Carpeta renombrada' };
    } catch (error) {
        console.error('[ERROR] Error renombrando carpeta de curso:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Subir un documento de curso a Google Drive
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} nombreArea - Nombre del área temática
 * @param {string} nombreCurso - Nombre del curso
 * @param {string} nombreArchivo - Nombre del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<object>} - Info del archivo subido (id, name, webViewLink, etc.)
 */
async function subirDocumentoCurso(buffer, nombreArea, nombreCurso, nombreArchivo, mimeType) {
    try {
        const resultado = await crearCarpetaCurso(nombreArea, nombreCurso);
        if (!resultado.success) {
            throw new Error(`No se pudo crear carpeta de curso: ${resultado.error}`);
        }
        return await subirArchivo(buffer, nombreArchivo, mimeType, resultado.folderId);
    } catch (error) {
        console.error('[ERROR] Error subiendo documento de curso:', error.message);
        throw error;
    }
}

/**
 * Descargar un documento de curso por su drive_file_id
 * @param {string} fileId - ID del archivo en Google Drive
 * @returns {Promise<Buffer>} - Buffer del archivo
 */
async function descargarDocumentoCurso(fileId) {
    return await descargarArchivo(fileId);
}

/**
 * Exportar un archivo de Google Drive como PDF (convierte Word/Excel/PPT a PDF)
 * Para archivos que ya son PDF, simplemente los descarga tal cual.
 * @param {string} fileId - ID del archivo en Google Drive
 * @returns {Promise<Buffer>} - Buffer con el contenido del PDF
 */
async function obtenerAccessTokenDrive() {
    if (!_driveAuthClient) {
        throw new Error('No fue posible obtener cliente de autenticación de Google Drive');
    }

    let tokenResult;
    if (typeof _driveAuthClient.getAccessToken === 'function') {
        tokenResult = await _driveAuthClient.getAccessToken();
    } else if (typeof _driveAuthClient.getClient === 'function') {
        const client = await _driveAuthClient.getClient();
        if (!client || typeof client.getAccessToken !== 'function') {
            throw new Error('No fue posible obtener access token de Google Drive');
        }
        tokenResult = await client.getAccessToken();
    } else {
        throw new Error('No fue posible obtener access token de Google Drive');
    }

    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
    if (!token) {
        throw new Error('No fue posible obtener access token de Google Drive');
    }
    return token;
}

const EXPORT_SHEET_PDF_MAX_REINTENTOS = 5;
const EXPORT_SHEET_PDF_DELAY_BASE_MS = 2000;
const EXPORT_SHEET_PDF_DELAY_MAX_MS = 30000;
const EXPORT_SHEET_PDF_DELAY_ENTRE_HOJAS_MS = 1500;

function esperarExportPdf(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function esBufferPdf(buf) {
    return Buffer.isBuffer(buf)
        && buf.length >= 4
        && buf[0] === 0x25
        && buf[1] === 0x50
        && buf[2] === 0x44
        && buf[3] === 0x46;
}

function esRespuestaHtml(buf) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
    const preview = buf.slice(0, 120).toString('utf8').trim().toLowerCase();
    return preview.startsWith('<!doctype') || preview.startsWith('<html');
}

function crearErrorExportPdf(mensaje, statusCode, buf) {
    const err = new Error(mensaje);
    err.response = { status: statusCode || 429, data: buf };
    return err;
}

function esErrorExportPdfReintentable(err, buf) {
    if (buf && esRespuestaHtml(buf)) return true;
    const code = Number(err?.response?.status || err?.code || 0);
    if (code === 429 || code === 503 || code === 500 || code === 502) return true;
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes('rate limit')
        || msg.includes('quota')
        || msg.includes('user rate limit')
        || msg.includes('econnreset')
        || msg.includes('etimedout')
        || msg.includes('socket hang up')
        || msg.includes('no es pdf');
}

async function solicitarExportSheetPdf(baseUrl, token, params) {
    try {
        const response = await axios.get(baseUrl, {
            responseType: 'arraybuffer',
            headers: { Authorization: `Bearer ${token}` },
            params
        });
        const buf = Buffer.from(response.data);
        if (!esBufferPdf(buf)) {
            throw crearErrorExportPdf('Google Sheets devolvió HTML en lugar de PDF', response?.status || 429, buf);
        }
        return buf;
    } catch (errHeader) {
        try {
            const response = await axios.get(baseUrl, {
                responseType: 'arraybuffer',
                params: { ...params, access_token: token }
            });
            const buf = Buffer.from(response.data);
            if (!esBufferPdf(buf)) {
                throw crearErrorExportPdf('Google Sheets devolvió HTML en lugar de PDF', response?.status || 429, buf);
            }
            return buf;
        } catch (errQuery) {
            throw errQuery?.response ? errQuery : errHeader;
        }
    }
}

async function exportarGoogleSheetComoPDF(fileId, options = {}) {
    const token = await obtenerAccessTokenDrive();
    const landscape = !!options.landscape;
    const gidRaw = options.gid !== undefined && options.gid !== null ? String(options.gid) : '';
    const gidOpts = gidRaw ? { gid: gidRaw } : {};

    const baseUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/export`;
    // Si hay gid, TODAS las variantes lo incluyen para no exportar el libro completo.
    const variants = [
        {
            format: 'pdf',
            portrait: landscape ? 'false' : 'true',
            fitw: 'true',
            sheetnames: 'false',
            printtitle: 'false',
            pagenumbers: 'false',
            gridlines: 'false',
            fzr: 'false',
            top_margin: '0.30',
            bottom_margin: '0.30',
            left_margin: '0.30',
            right_margin: '0.30',
            ...gidOpts
        },
        {
            format: 'pdf',
            portrait: landscape ? 'false' : 'true',
            fitw: 'true',
            top_margin: '0.30',
            bottom_margin: '0.30',
            left_margin: '0.30',
            right_margin: '0.30',
            ...gidOpts
        },
        {
            format: 'pdf',
            portrait: landscape ? 'false' : 'true',
            ...gidOpts
        }
    ];

    let lastError = null;
    let lastBuf = null;

    for (let reintento = 0; reintento < EXPORT_SHEET_PDF_MAX_REINTENTOS; reintento++) {
        for (let i = 0; i < variants.length; i++) {
            const params = variants[i];
            try {
                return await solicitarExportSheetPdf(baseUrl, token, params);
            } catch (err) {
                lastError = err;
                lastBuf = err?.response?.data ? Buffer.from(err.response.data) : null;
                const detalle = lastBuf
                    ? lastBuf.toString('utf8').slice(0, 300)
                    : err?.message;
                console.warn(`[exportarSheetPDF] variante ${i + 1}, reintento ${reintento + 1} falló: ${detalle}`);
            }
        }

        if (reintento < EXPORT_SHEET_PDF_MAX_REINTENTOS - 1 && esErrorExportPdfReintentable(lastError, lastBuf)) {
            const delay = Math.min(
                EXPORT_SHEET_PDF_DELAY_BASE_MS * Math.pow(2, reintento),
                EXPORT_SHEET_PDF_DELAY_MAX_MS
            );
            console.warn(`[exportarSheetPDF] rate limit detectado, esperando ${delay}ms antes de reintentar...`);
            await esperarExportPdf(delay);
            continue;
        }
        break;
    }

    throw lastError || new Error('No se pudo exportar Google Sheet a PDF');
}

/**
 * Convierte un XLSX de Drive a Google Sheet temporal y exporta cada hoja como PDF.
 * Devuelve un buffer por hoja (en orden) y un PDF consolidado con todas las hojas.
 */
async function exportarArchivoPDFPorHojas(fileId, options = {}) {
    const info = await obtenerInfoArchivo(fileId);
    const mimeType = info.mimeType || '';
    const landscape = !!options.landscape;
    const officeToGoogleMap = {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
        'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet'
    };

    let spreadsheetId = fileId;
    let tempFileId = null;

    if (officeToGoogleMap[mimeType]) {
        const copyResponse = await drive.files.copy({
            fileId,
            requestBody: {
                name: `_temp_pdf_sheets_export_${Date.now()}`,
                mimeType: officeToGoogleMap[mimeType]
            }
        });
        tempFileId = copyResponse.data.id;
        spreadsheetId = tempFileId;
    } else if (mimeType !== 'application/vnd.google-apps.spreadsheet') {
        throw new Error('El archivo no es una hoja de cálculo compatible para exportar por hojas.');
    }

    try {
        const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
        const meta = await sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties(sheetId,title,index)'
        });
        const hojas = (meta.data.sheets || [])
            .map((s) => ({
                sheetId: s.properties?.sheetId,
                title: s.properties?.title || '',
                index: s.properties?.index ?? 0
            }))
            .filter((h) => h.sheetId != null)
            .sort((a, b) => a.index - b.index);

        if (hojas.length === 0) {
            throw new Error('La hoja de cálculo no tiene pestañas exportables.');
        }

        const porHoja = [];
        for (let hIdx = 0; hIdx < hojas.length; hIdx++) {
            const hoja = hojas[hIdx];
            if (hIdx > 0) {
                await esperarExportPdf(EXPORT_SHEET_PDF_DELAY_ENTRE_HOJAS_MS);
            }
            const buf = await exportarGoogleSheetComoPDF(spreadsheetId, {
                landscape,
                gid: hoja.sheetId
            });
            porHoja.push(buf);
        }

        const { PDFDocument } = require('pdf-lib');
        const consolidado = await PDFDocument.create();
        for (const buf of porHoja) {
            const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
            const indices = doc.getPageIndices();
            const pages = await consolidado.copyPages(doc, indices);
            pages.forEach((page) => consolidado.addPage(page));
        }

        return {
            porHoja,
            consolidado: Buffer.from(await consolidado.save())
        };
    } finally {
        if (tempFileId) {
            try {
                await drive.files.delete({ fileId: tempFileId });
            } catch (cleanupError) {
                console.warn('[exportarPDFPorHojas] No se pudo eliminar copia temporal:', cleanupError.message);
            }
        }
    }
}

async function exportarGoogleSheetComoXLSX(fileId) {
    try {
        const response = await drive.files.export(
            {
                fileId,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            },
            { responseType: 'arraybuffer' }
        );
        return Buffer.from(response.data);
    } catch (error) {
        const codigo = Number(error?.code || error?.response?.status || 0);
        if (codigo === 403 || codigo === 400) {
            try {
                const info = await obtenerInfoArchivo(fileId);
                const mimeType = String(info?.mimeType || '').trim();
                if (
                    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    || mimeType === 'application/vnd.ms-excel'
                ) {
                    console.warn('[WARN] Export API no aplica (archivo Office nativo), descargando directamente');
                    return await descargarArchivoBinario(fileId);
                }
            } catch (_fallbackError) {
                // Mantener el error original de export si el fallback no aplica.
            }
        }
        console.warn('[WARN] Error exportando Google Sheet como XLSX:', error.message);
        throw error;
    }
}

async function exportarArchivoXLSX(fileId) {
    const info = await obtenerInfoArchivo(fileId);
    const mimeType = info.mimeType || '';

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        return await exportarGoogleSheetComoXLSX(fileId);
    }

    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        || mimeType === 'application/vnd.ms-excel'
    ) {
        return await descargarArchivo(fileId);
    }

    throw new Error('El archivo no es una hoja de cálculo compatible para exportar a XLSX.');
}

function detectarMimeDesdeBuffer(buf, filename = '') {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return 'application/octet-stream';
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
    if (buf.length >= 6) {
        const header6 = buf.toString('ascii', 0, 6);
        if (header6 === 'GIF87a' || header6 === 'GIF89a') return 'image/gif';
    }
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
        const ext = String(filename).split('.').pop()?.toLowerCase() || '';
        if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        return 'application/zip';
    }

    const ext = String(filename).split('.').pop()?.toLowerCase() || '';
    const map = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ppt: 'application/vnd.ms-powerpoint'
    };
    return map[ext] || 'application/octet-stream';
}

function asegurarExtensionArchivo(filename, ext) {
    const name = String(filename || 'archivo').trim() || 'archivo';
    const lower = name.toLowerCase();
    if (lower.endsWith(ext)) return name;
    return name.replace(/\.[^/.]+$/, '') + ext;
}

/**
 * Descarga un archivo de Drive en su formato nativo (xlsx, pdf, png, etc.).
 */
async function descargarArchivoNativo(fileId, nombreSugerido = '') {
    const info = await obtenerInfoArchivo(fileId);
    const mimeType = info.mimeType || '';
    let buffer;
    let contentType;
    let filename = String(nombreSugerido || info.name || 'archivo').trim() || 'archivo';

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        buffer = await exportarArchivoXLSX(fileId);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = asegurarExtensionArchivo(filename, '.xlsx');
    } else if (mimeType === 'application/vnd.google-apps.document') {
        const response = await drive.files.export(
            { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            { responseType: 'arraybuffer' }
        );
        buffer = Buffer.from(response.data);
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        filename = asegurarExtensionArchivo(filename, '.docx');
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
        const response = await drive.files.export(
            { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
            { responseType: 'arraybuffer' }
        );
        buffer = Buffer.from(response.data);
        contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        filename = asegurarExtensionArchivo(filename, '.pptx');
    } else {
        buffer = await descargarArchivo(fileId);
        contentType = detectarMimeDesdeBuffer(buffer, filename);
    }

    if (!buffer || !buffer.length) {
        throw new Error('Archivo vacío o no encontrado en Drive');
    }

    return { buffer, contentType, filename };
}

async function exportarArchivoPDF(fileId, options = {}) {
    try {
        // Primero obtener info del archivo para saber su mimeType
        const info = await obtenerInfoArchivo(fileId);
        const mimeType = info.mimeType || '';
        const landscape = !!options.landscape;

        driveDebug(`  [exportarPDF] Archivo: ${info.name}, mimeType: ${mimeType}`);

        // Si ya es PDF, simplemente descargar
        if (mimeType === 'application/pdf') {
            driveDebug('  [exportarPDF] Ya es PDF, descargando directamente');
            return await descargarArchivo(fileId);
        }

        // Tipos nativos de Google Workspace → usar files.export()
        const googleWorkspaceTypes = [
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/vnd.google-apps.presentation'
        ];

        if (googleWorkspaceTypes.includes(mimeType)) {
            if (mimeType === 'application/vnd.google-apps.spreadsheet') {
                driveDebug(`  [exportarPDF] Google Sheet, exportando a PDF (${landscape ? 'landscape' : 'portrait'})`);
                return await exportarGoogleSheetComoPDF(fileId, options);
            }

            driveDebug('  [exportarPDF] Archivo Google Workspace, exportando a PDF');
            const response = await drive.files.export(
                { fileId: fileId, mimeType: 'application/pdf' },
                { responseType: 'arraybuffer' }
            );
            return Buffer.from(response.data);
        }

        // Archivos Office subidos (docx, xlsx, pptx, etc.) → 
        // Google Drive NO permite files.export() directamente en archivos no-nativos.
        // Estrategia: copiar el archivo convirtiéndolo a Google Docs, exportar como PDF, eliminar la copia.
        const officeToGoogleMap = {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
            'application/msword': 'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
            'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation'
        };

        if (officeToGoogleMap[mimeType]) {
            driveDebug('  [exportarPDF] Archivo Office nativo, convirtiendo via Google Docs...');

            // Copiar el archivo forzando conversión a formato Google
            const copyResponse = await drive.files.copy({
                fileId: fileId,
                requestBody: {
                    name: `_temp_pdf_export_${Date.now()}`,
                    mimeType: officeToGoogleMap[mimeType]
                }
            });
            const tempFileId = copyResponse.data.id;

            try {
                let pdfBuffer;
                if (officeToGoogleMap[mimeType] === 'application/vnd.google-apps.spreadsheet') {
                    driveDebug(`  [exportarPDF] Hoja convertida temporalmente, exportando (${landscape ? 'landscape' : 'portrait'})`);
                    pdfBuffer = await exportarGoogleSheetComoPDF(tempFileId, options);
                } else {
                    const pdfResponse = await drive.files.export(
                        { fileId: tempFileId, mimeType: 'application/pdf' },
                        { responseType: 'arraybuffer' }
                    );
                    pdfBuffer = Buffer.from(pdfResponse.data);
                }
                driveDebug(`  [exportarPDF] PDF generado (${pdfBuffer.byteLength} bytes)`);
                return pdfBuffer;
            } finally {
                // Siempre eliminar la copia temporal
                try {
                    await drive.files.delete({ fileId: tempFileId });
                    driveDebug('  [exportarPDF] Copia temporal eliminada');
                } catch (cleanupError) {
                    console.warn('  [exportarPDF] No se pudo eliminar copia temporal:', cleanupError.message);
                }
            }
        }

        // Para cualquier otro tipo (imágenes, etc.), descargar tal cual
        driveDebug('  [exportarPDF] Tipo no convertible, descargando tal cual');
        return await descargarArchivo(fileId);
    } catch (error) {
        console.error('[ERROR] Error exportando archivo como PDF:', error.message);
        throw error;
    }
}

/**
 * Eliminar un documento de curso por su drive_file_id
 * @param {string} fileId - ID del archivo en Google Drive
 * @returns {Promise<void>}
 */
async function eliminarDocumentoCurso(fileId) {
    return await eliminarArchivo(fileId);
}

// =====================================================
// FUNCIONES PARA EXPEDIENTES MÉDICOS
// =====================================================

function limpiarNombreCarpetaDrive(nombre) {
    return String(nombre || '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .trim();
}

async function obtenerCarpetaExpedientesEmpresa(empresaNombre) {
    const carpetaBaseExpedientes = await obtenerOCrearCarpeta('Expedientes_medicos', 'root');

    const nombreEmpresaLimpio = limpiarNombreCarpetaDrive(empresaNombre);
    if (!nombreEmpresaLimpio) {
        return carpetaBaseExpedientes;
    }

    return await obtenerOCrearCarpeta(nombreEmpresaLimpio, carpetaBaseExpedientes);
}

/**
 * Sincronizar carpetas de empresas para Expedientes Médicos.
 * Crea (si no existen) carpetas bajo Expedientes_medicos para cada empresa recibida.
 * @param {string[]} nombresEmpresas - Lista de nombres de empresas
 * @returns {Promise<{baseFolderId: string, createdOrFound: number}>}
 */
async function sincronizarCarpetasExpedientesEmpresas(nombresEmpresas = []) {
    const carpetaBaseExpedientes = await obtenerOCrearCarpeta('Expedientes_medicos', 'root');

    const nombresLimpios = Array.from(
        new Set(
            (Array.isArray(nombresEmpresas) ? nombresEmpresas : [])
                .map((nombre) => limpiarNombreCarpetaDrive(nombre))
                .filter(Boolean)
        )
    );

    for (const nombreEmpresa of nombresLimpios) {
        await obtenerOCrearCarpeta(nombreEmpresa, carpetaBaseExpedientes);
    }

    return {
        baseFolderId: carpetaBaseExpedientes,
        createdOrFound: nombresLimpios.length
    };
}

/**
 * Subir un expediente médico (PDF) a la carpeta de la empresa dentro de Expedientes_medicos en Google Drive.
 * La carpeta Expedientes_medicos está en la RAÍZ de Mi unidad (fuera de Sistema_Integral).
 * Si el archivo ya existe (mismo nombre), lo reemplaza.
 * @param {Buffer} buffer - Buffer del PDF
 * @param {string} nombreArchivo - Nombre del archivo PDF (ej: "B-HC-26-001.pdf")
 * @param {string|null} empresaNombre - Nombre de la empresa para enrutar el archivo a su carpeta
 * @returns {Promise<object>} - Info del archivo subido (id, name, webViewLink, etc.)
 */
async function subirExpedienteMedico(buffer, nombreArchivo, empresaNombre = null) {
    try {
        const carpetaExpedientes = await obtenerCarpetaExpedientesEmpresa(empresaNombre);

        console.log(`  [EXPEDIENTES] Subiendo "${nombreArchivo}" a carpeta empresa (${carpetaExpedientes})...`);
        const resultado = await subirArchivo(buffer, nombreArchivo, 'application/pdf', carpetaExpedientes);
        console.log(`  [EXPEDIENTES] Archivo subido: ${resultado.name} (${resultado.id})`);
        return resultado;
    } catch (error) {
        console.error('[ERROR] Error subiendo expediente médico:', error.message);
        throw error;
    }
}

// =====================================================
// FUNCIONES PARA CAPACITACIONES
// =====================================================

/**
 * Crear carpeta de capacitación (curso programado) en Google Drive
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @param {string} nombreCurso - Nombre del curso
 * @param {string|Date} fechaCreacion - Fecha de creación
 * @returns {Promise<{success: boolean, folderId: string, path: string, nombreCarpeta: string}>}
 */
async function crearCarpetaCapacitacion(nombreEmpresa, nombreCurso, fechaCreacion) {
    try {
        const mesesNombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

        // Obtener/crear carpeta "Capacitaciones"
        const carpetaCapacitaciones = await obtenerOCrearCarpeta('Capacitaciones', ROOT_FOLDER_ID);

        // Normalizar nombres
        const nombreEmpresaLimpio = nombreEmpresa.replace(/[<>:"/\\|?*]/g, '_').trim();
        const nombreCursoLimpio = nombreCurso.replace(/[<>:"/\\|?*]/g, '_').trim();

        // Formatear fecha (sin desfase de zona horaria)
        const fechaRaw = String(fechaCreacion || '').trim();
        let fechaObj;
        if (/^\d{4}-\d{2}-\d{2}/.test(fechaRaw)) {
            const [y, m, d] = fechaRaw.slice(0, 10).split('-').map(Number);
            fechaObj = new Date(y, m - 1, d);
        } else {
            fechaObj = new Date(fechaCreacion);
        }
        const anio = fechaObj.getFullYear();
        const mes = fechaObj.getMonth(); // 0-indexed
        const fechaFormateada = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(fechaObj.getDate()).padStart(2, '0')}`;

        // Subcarpeta por año: "Capacitación 2026"
        const nombreCarpetaAnio = `Capacitación ${anio}`;
        const carpetaAnio = await obtenerOCrearCarpeta(nombreCarpetaAnio, carpetaCapacitaciones);

        // Subcarpeta por mes: "3. Marzo 2026"
        const nombreCarpetaMes = `${mes + 1}. ${mesesNombres[mes]} ${anio}`;
        const carpetaMes = await obtenerOCrearCarpeta(nombreCarpetaMes, carpetaAnio);

        // Crear nombre de carpeta del curso
        const nombreCarpeta = `${nombreEmpresaLimpio}_${nombreCursoLimpio}_${fechaFormateada}`;
        const carpetaCapacitacion = await obtenerOCrearCarpeta(nombreCarpeta, carpetaMes);

        const fullPath = `Capacitaciones/${nombreCarpetaAnio}/${nombreCarpetaMes}/${nombreCarpeta}`;
        console.log(`  Carpeta de capacitación lista: ${fullPath}`);
        return {
            success: true,
            folderId: carpetaCapacitacion,
            path: fullPath,
            nombreCarpeta
        };
    } catch (error) {
        console.error('[ERROR] Error creando carpeta de capacitación:', error.message);
        return { success: false, error: error.message };
    }
}

function normalizarSegmentoCapacitacion(valor, fallback = 'sin_nombre') {
    const limpio = String(valor || '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .trim();
    return limpio || fallback;
}

function formatearFechaISO(fecha) {
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

function construirNombreCarpetaCapacitacion(nombreEmpresa, nombreCurso, fecha) {
    const fechaIso = formatearFechaISO(fecha);
    if (!fechaIso) return null;

    const empresa = normalizarSegmentoCapacitacion(nombreEmpresa, 'empresa');
    const curso = normalizarSegmentoCapacitacion(nombreCurso, 'curso');
    return `${empresa}_${curso}_${fechaIso}`;
}

async function eliminarCarpetaCapacitacion(nombreEmpresa, nombreCurso, fechas = []) {
    try {
        const carpetaCapacitaciones = await buscarCarpeta('Capacitaciones', ROOT_FOLDER_ID);
        if (!carpetaCapacitaciones) {
            return { success: true, eliminadas: 0, message: 'Carpeta Capacitaciones no existe' };
        }

        const candidatos = Array.from(new Set(
            (Array.isArray(fechas) ? fechas : [fechas])
                .map((f) => construirNombreCarpetaCapacitacion(nombreEmpresa, nombreCurso, f))
                .filter(Boolean)
        ));

        let eliminadas = 0;
        const intentadas = [];

        for (const nombreCarpeta of candidatos) {
            intentadas.push(nombreCarpeta);
            const carpetaId = await buscarCarpeta(nombreCarpeta, carpetaCapacitaciones);
            if (!carpetaId) continue;

            await drive.files.delete({ fileId: carpetaId });
            eliminadas += 1;
            console.log(`  Carpeta de capacitación eliminada: Capacitaciones/${nombreCarpeta}`);
        }

        return {
            success: true,
            eliminadas,
            intentadas,
            message: eliminadas > 0 ? 'Carpetas eliminadas' : 'No se encontraron carpetas para eliminar'
        };
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta de capacitación:', error.message);
        return { success: false, error: error.message };
    }
}

// =====================================================
// FUNCIONES PARA PROTECCIÓN CIVIL
// =====================================================

/**
 * Obtener o crear la carpeta raíz PIPC en Google Drive
 * @returns {Promise<string>} - ID de la carpeta PIPC
 */
async function obtenerCarpetaPIPC() {
    if (_cachePipcFolderId) return _cachePipcFolderId;
    _cachePipcFolderId = await obtenerOCrearCarpeta('PIPC', ROOT_FOLDER_ID);
    console.log(`[PC] Carpeta PIPC: ${_cachePipcFolderId}`);
    return _cachePipcFolderId;
}

/**
 * Crear carpeta para un documento asignado:
 *   Proteccion_civil / Historial de documentos / {empresa} / {nombreDocumento} /
 * La carpeta de empresa se crea UNA sola vez (con caché).
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @param {string} nombreDocumento - Nombre del documento padre (ej: "Constancia de uso de suelo+25-02-2026")
 * @returns {Promise<string>} - ID de la carpeta creada
 */
async function crearCarpetaDocumentoPC(nombreEmpresa, nombreDocumento) {
    const intentar = async () => {
        const carpetaHistorial = await obtenerCarpetaPipcHistorial();
        const carpetaEmpresa = await obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial);
        const carpetaDoc = await obtenerOCrearCarpeta(nombreDocumento, carpetaEmpresa);
        console.log(`[PC] Carpeta creada: Proteccion_civil/Historial de documentos/${nombreEmpresa}/${nombreDocumento}`);
        return carpetaDoc;
    };
    try {
        return await intentar();
    } catch (error) {
        if (error.message && error.message.includes('File not found')) {
            console.warn('[PC] Caché de carpetas PC obsoleta (File not found), invalidando y reintentando...');
            invalidarCacheCarpetasPC();
            try {
                return await intentar();
            } catch (retryError) {
                console.error('[ERROR] Error creando carpeta de documento PC (reintento):', retryError.message);
                throw retryError;
            }
        }
        console.error('[ERROR] Error creando carpeta de documento PC:', error.message);
        throw error;
    }
}

/**
 * Subir archivo de protección civil a Google Drive
 * Estructura: Proteccion_civil / Historial de documentos / {empresa} / {doc_padre} / archivo
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @param {string} nombreArchivo - Nombre del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {string} nombreDocPadre - Nombre del documento padre (carpeta con fecha)
 * @returns {Promise<object>} - Info del archivo subido
 */
/**
 * Subir archivo de Documentación Extra (fuera del checklist PIPC).
 * Estructura: Protección_Civil / Historial de Documentos / {empresa} / Documentación Extra / [subcarpetas...]
 * @param {Buffer} buffer
 * @param {string} nombreEmpresa
 * @param {string} nombreArchivo
 * @param {string} mimeType
 * @param {string} [rutaCarpetaRelativa] - Ruta relativa bajo Documentación Extra (ej. "Planos/2024"). Vacío = raíz.
 * @returns {Promise<object>} - Info del archivo + carpetaId destino
 */
async function subirArchivoDocumentacionExtraPC(buffer, nombreEmpresa, nombreArchivo, mimeType, rutaCarpetaRelativa = '') {
    const NOMBRE_CARPETA = 'Documentación Extra';
    const intentar = async () => {
        const carpetaHistorial = await obtenerCarpetaPipcHistorial();
        const carpetaEmpresa = await obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial);
        let carpetaDestino = await obtenerOCrearCarpeta(NOMBRE_CARPETA, carpetaEmpresa);
        const segmentos = String(rutaCarpetaRelativa || '')
            .replace(/\\/g, '/')
            .split('/')
            .map(s => String(s || '').trim())
            .filter(s => s && s !== '.' && s !== '..');
        for (const segmento of segmentos) {
            carpetaDestino = await obtenerOCrearCarpeta(segmento, carpetaDestino);
        }
        // subirArchivoNuevo aplica permiso "anyone/reader" necesario para el visor Drive
        const resultado = await subirArchivoNuevo(
            buffer,
            nombreArchivo,
            mimeType || 'application/octet-stream',
            carpetaDestino
        );
        return {
            id: resultado.id,
            name: resultado.name || nombreArchivo,
            webViewLink: resultado.webViewLink || null,
            carpetaId: carpetaDestino
        };
    };
    try {
        return await intentar();
    } catch (error) {
        if (error.message && error.message.includes('File not found')) {
            console.warn('[PC-EXTRA] Caché de carpetas PC obsoleta, invalidando y reintentando...');
            invalidarCacheCarpetasPC();
            return await intentar();
        }
        console.error('[ERROR] Error subiendo Documentación Extra PC:', error.message);
        throw error;
    }
}

/**
 * Elimina una subcarpeta (y todo su contenido) bajo Documentación Extra de una empresa PC.
 * No elimina la carpeta raíz "Documentación Extra".
 * @param {string} nombreEmpresa
 * @param {string} rutaCarpetaRelativa - Ej. "Titulacion" o "Titulacion/2024"
 * @returns {Promise<{ eliminado: boolean, carpetaId?: string }>}
 */
async function eliminarCarpetaDocumentacionExtraPC(nombreEmpresa, rutaCarpetaRelativa = '') {
    const NOMBRE_CARPETA = 'Documentación Extra';
    const segmentos = String(rutaCarpetaRelativa || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(s => String(s || '').trim())
        .filter(s => s && s !== '.' && s !== '..');
    if (!segmentos.length) {
        throw new Error('Indica la carpeta a eliminar.');
    }

    const intentar = async () => {
        const carpetaHistorial = await obtenerCarpetaPipcHistorial();
        const carpetaEmpresa = await obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial);
        let carpetaActual = await buscarCarpeta(NOMBRE_CARPETA, carpetaEmpresa);
        if (!carpetaActual) {
            return { eliminado: false };
        }
        for (const segmento of segmentos) {
            carpetaActual = await buscarCarpeta(segmento, carpetaActual);
            if (!carpetaActual) {
                return { eliminado: false };
            }
        }
        const ok = await eliminarCarpetaYContenido(carpetaActual);
        return { eliminado: !!ok, carpetaId: carpetaActual };
    };

    try {
        return await intentar();
    } catch (error) {
        if (error.message && error.message.includes('File not found')) {
            console.warn('[PC-EXTRA] Caché de carpetas PC obsoleta al eliminar, invalidando y reintentando...');
            invalidarCacheCarpetasPC();
            return await intentar();
        }
        console.error('[ERROR] Error eliminando carpeta Documentación Extra PC:', error.message);
        throw error;
    }
}

async function subirArchivoProteccionCivil(buffer, nombreEmpresa, nombreArchivo, mimeType, nombreDocPadre = null) {
    const intentar = async () => {
        const carpetaHistorial = await obtenerCarpetaPipcHistorial();
        const carpetaEmpresa = await obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial);

        let carpetaDestino = carpetaEmpresa;
        if (nombreDocPadre) {
            carpetaDestino = await obtenerOCrearCarpeta(nombreDocPadre, carpetaEmpresa);
        }

        return await subirArchivo(buffer, nombreArchivo, mimeType, carpetaDestino);
    };
    try {
        return await intentar();
    } catch (error) {
        if (error.message && error.message.includes('File not found')) {
            console.warn('[PC] Caché de carpetas PC obsoleta (File not found), invalidando y reintentando...');
            invalidarCacheCarpetasPC();
            try {
                return await intentar();
            } catch (retryError) {
                console.error('[ERROR] Error subiendo archivo de Protección Civil (reintento):', retryError.message);
                throw retryError;
            }
        }
        console.error('[ERROR] Error subiendo archivo de Protección Civil:', error.message);
        throw error;
    }
}

/**
 * Subir archivo aprobado al historial de documentos en Google Drive.
 * Estructura: PIPC / Historial de documentos / {EMPRESA} / {Título Asignación} / archivo
 * La carpeta de empresa se crea UNA sola vez.
 * El nombre del archivo sigue el formato: {doc}_{empresa}_{dd-MM-yyyy}.{ext}
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @param {string} tituloDocumento - Título del documento padre (asignación)
 * @param {string} nombreArchivo - Nombre original del archivo (para obtener extensión)
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<object>} - Info del archivo subido (id, name, webViewLink)
 */
async function subirArchivoHistorialPC(buffer, nombreEmpresa, tituloDocumento, nombreArchivo, mimeType, nombreSubdoc = null) {
    try {
        const carpetaHistorial = await obtenerCarpetaPipcHistorial();
        const carpetaEmpresa = await obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial);

        // Crear/obtener carpeta del documento padre (asignación) – nombre de carpeta = tituloDocumento
        const carpetaDocumento = await obtenerOCrearCarpeta(tituloDocumento, carpetaEmpresa);

        // Nombre del archivo: usa el nombre del subdocumento (o tituloDocumento si no se pasó)
        const nombreParaArchivo = nombreSubdoc || tituloDocumento;

        // Generar nombre de archivo: {subdoc_sanitized}_{empresa_sanitized}_{dd-MM-yyyy}.{ext}
        const ext = (nombreArchivo || 'pdf').split('.').pop() || 'pdf';
        const ahora = new Date();
        const dd = String(ahora.getDate()).padStart(2, '0');
        const mm = String(ahora.getMonth() + 1).padStart(2, '0');
        const yyyy = ahora.getFullYear();
        const fechaStr = `${dd}-${mm}-${yyyy}`;
        const sanitize = (s) => String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const docSanitized = sanitize(nombreParaArchivo);
        const empSanitized = sanitize(nombreEmpresa);
        const nuevoNombreArchivo = `${docSanitized}_${empSanitized}_${fechaStr}.${ext}`;

        console.log(`  [HISTORIAL PC] Subiendo "${nuevoNombreArchivo}" en carpeta ${tituloDocumento}/`);
        return await subirArchivo(buffer, nuevoNombreArchivo, mimeType, carpetaDocumento);
    } catch (error) {
        console.error('[ERROR] Error subiendo archivo al historial de PC:', error.message);
        throw error;
    }
}

/**
 * Eliminar un archivo del historial de documentos de PC en Google Drive
 * @param {string} driveFileId - ID del archivo en Google Drive
 * @returns {Promise<void>}
 */
async function eliminarArchivoHistorialPC(driveFileId) {
    try {
        const eliminado = await eliminarArchivoDrive(driveFileId, '[HISTORIAL PC] Archivo');
        if (eliminado) {
            console.log(`  [HISTORIAL PC] Archivo eliminado de Drive: ${driveFileId}`);
        }
        return eliminado;
    } catch (error) {
        console.error('[ERROR] Error eliminando archivo del historial de PC:', error.message);
        throw error;
    }
}

async function _obtenerCarpetaEmpresaHistorialPC(nombreEmpresa, createIfMissing = false) {
    const carpetaHistorial = await obtenerCarpetaPipcHistorial();
    const variantes = Array.from(new Set([
        String(nombreEmpresa || '').trim(),
        String(nombreEmpresa || '').replace(/[^a-zA-Z0-9]/g, '_'),
        String(nombreEmpresa || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_')
    ].filter(Boolean)));

    for (const variante of variantes) {
        const encontrada = await buscarCarpeta(variante, carpetaHistorial);
        if (encontrada) return encontrada;
    }

    if (!createIfMissing) return null;
    const nombreCrear = variantes[0] || `empresa_${Date.now()}`;
    return await obtenerOCrearCarpeta(nombreCrear, carpetaHistorial);
}

async function eliminarCarpetaDocumentoPC(nombreEmpresa, nombreDocumento) {
    try {
        const carpetaEmpresa = await _obtenerCarpetaEmpresaHistorialPC(nombreEmpresa, false);
        if (!carpetaEmpresa) {
            return { success: true, deleted: false, message: 'Carpeta de empresa no encontrada' };
        }

        const carpetaDocumento = await buscarCarpeta(nombreDocumento, carpetaEmpresa);
        if (!carpetaDocumento) {
            return { success: true, deleted: false, message: 'Carpeta de documento no encontrada' };
        }

        await drive.files.delete({ fileId: carpetaDocumento });
        return { success: true, deleted: true, folderId: carpetaDocumento };
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta de documento PC:', error.message);
        return { success: false, error: error.message };
    }
}

async function eliminarCarpetaHistorialEmpresaPC(nombreEmpresa) {
    try {
        const carpetaEmpresa = await _obtenerCarpetaEmpresaHistorialPC(nombreEmpresa, false);
        if (!carpetaEmpresa) {
            return { success: true, deleted: false, message: 'Carpeta de empresa no encontrada' };
        }

        await drive.files.delete({ fileId: carpetaEmpresa });
        return { success: true, deleted: true, folderId: carpetaEmpresa };
    } catch (error) {
        console.error('[ERROR] Error eliminando carpeta de empresa PC:', error.message);
        return { success: false, error: error.message };
    }
}

async function _listarArchivosRecursivos(carpetaId, ruta = '') {
    const archivosDirectos = await listarArchivosCarpeta(carpetaId);
    const subcarpetas = await listarSubcarpetas(carpetaId);

    const actuales = archivosDirectos.map((f) => ({
        ...f,
        ruta
    }));

    if (!subcarpetas.length) return actuales;

    const nested = await Promise.all(
        subcarpetas.map((sub) => {
            const nextRuta = ruta ? `${ruta}/${sub.name}` : sub.name;
            return _listarArchivosRecursivos(sub.id, nextRuta);
        })
    );

    return actuales.concat(...nested);
}

async function listarHistorialEmpresaPC(nombreEmpresa) {
    try {
        const carpetaEmpresa = await _obtenerCarpetaEmpresaHistorialPC(nombreEmpresa, false);
        if (!carpetaEmpresa) {
            return { success: true, documentos: [] };
        }

        const archivos = await _listarArchivosRecursivos(carpetaEmpresa, '');
        const documentos = archivos
            .map((f) => ({
                drive_file_id: f.id,
                nombre_archivo: f.name,
                mime_type: f.mimeType || 'application/octet-stream',
                fecha_actualizacion: f.modifiedTime || null,
                ruta: f.ruta || ''
            }))
            .sort((a, b) => a.nombre_archivo.localeCompare(b.nombre_archivo, 'es', { sensitivity: 'base' }));

        return { success: true, documentos };
    } catch (error) {
        console.error('[ERROR] Error listando historial de empresa PC:', error.message);
        return { success: false, error: error.message, documentos: [] };
    }
}

function normalizarNombreDrive(valor = '') {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

async function listarSubcarpetas(carpetaPadreId) {
    const response = await drive.files.list({
        q: `'${carpetaPadreId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, modifiedTime)',
        spaces: 'drive',
        pageSize: 200
    });
    return response.data.files || [];
}

async function listarArchivosCarpeta(carpetaId) {
    const response = await drive.files.list({
        q: `'${carpetaId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink)',
        spaces: 'drive',
        pageSize: 500,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    return response.data.files || [];
}

async function carpetaDriveEstaVacia(carpetaId) {
    const [subcarpetas, archivos] = await Promise.all([
        listarSubcarpetas(carpetaId),
        listarArchivosCarpeta(carpetaId)
    ]);
    return subcarpetas.length === 0 && archivos.length === 0;
}

/**
 * Elimina una subcarpeta solo si existe y quedó vacía.
 * @returns {Promise<{eliminada: boolean, folderId?: string, nombre?: string, motivo?: string}>}
 */
async function eliminarSubcarpetaVaciaSiExiste(nombreSubcarpeta, carpetaPadreId) {
    const nombre = String(nombreSubcarpeta || '').trim();
    if (!nombre || !carpetaPadreId) {
        return { eliminada: false, motivo: 'parametros_invalidos' };
    }

    const folderId = await buscarCarpeta(nombre, carpetaPadreId);
    if (!folderId) {
        return { eliminada: false, nombre, motivo: 'no_existe' };
    }

    const vacia = await carpetaDriveEstaVacia(folderId);
    if (!vacia) {
        return { eliminada: false, folderId, nombre, motivo: 'con_contenido' };
    }

    const eliminada = await eliminarCarpetaPorId(folderId);
    return {
        eliminada: !!eliminada,
        folderId,
        nombre,
        motivo: eliminada ? 'eliminada' : 'error_eliminacion'
    };
}

// =====================================================
// CARPETAS DE FIRMAS (Firmas / Firmas_Calidad, etc.)
// =====================================================

const CARPETA_FIRMAS_RAIZ = 'Firmas';
const SUBCARPETAS_FIRMAS = [
    'Firmas_Calidad',
    'Firmas_Doctores',
    'Firmas_Instructores',
    'Correos_Firmas'
];

let _cacheCarpetaFirmasRaizId = null;

async function moverCarpetaDrive(carpetaId, nuevoPadreId) {
    const info = await drive.files.get({
        fileId: carpetaId,
        fields: 'id, name, parents',
        supportsAllDrives: true
    });
    const parents = Array.isArray(info.data.parents) ? info.data.parents : [];
    if (parents.includes(nuevoPadreId)) {
        return carpetaId;
    }

    const removeParents = parents.filter((parentId) => parentId && parentId !== nuevoPadreId).join(',');
    await drive.files.update({
        fileId: carpetaId,
        addParents: nuevoPadreId,
        ...(removeParents ? { removeParents } : {}),
        fields: 'id, parents',
        supportsAllDrives: true
    });

    console.log(`[Drive] Carpeta "${info.data.name}" reorganizada (padre: ${nuevoPadreId})`);
    return carpetaId;
}

async function obtenerCarpetaFirmasRaiz() {
    if (_cacheCarpetaFirmasRaizId) {
        return _cacheCarpetaFirmasRaizId;
    }
    _cacheCarpetaFirmasRaizId = await obtenerOCrearCarpeta(CARPETA_FIRMAS_RAIZ, ROOT_FOLDER_ID);
    return _cacheCarpetaFirmasRaizId;
}

async function obtenerOCrearCarpetaFirmas(nombreSubcarpeta) {
    const nombre = String(nombreSubcarpeta || '').trim();
    if (!nombre) {
        throw new Error('Nombre de subcarpeta de firmas inválido');
    }

    const carpetaFirmasRaiz = await obtenerCarpetaFirmasRaiz();

    const carpetaNueva = await buscarCarpeta(nombre, carpetaFirmasRaiz);
    if (carpetaNueva) {
        return carpetaNueva;
    }

    const carpetaLegacy = await buscarCarpeta(nombre, ROOT_FOLDER_ID);
    if (carpetaLegacy) {
        return moverCarpetaDrive(carpetaLegacy, carpetaFirmasRaiz);
    }

    return crearCarpeta(nombre, carpetaFirmasRaiz);
}

async function migrarCarpetasFirmasOrganizacion() {
    const resultados = [];

    try {
        const carpetaFirmasRaiz = await obtenerCarpetaFirmasRaiz();

        for (const nombre of SUBCARPETAS_FIRMAS) {
            try {
                const enFirmas = await buscarCarpeta(nombre, carpetaFirmasRaiz);
                if (enFirmas) {
                    resultados.push({ nombre, estado: 'ya_organizada', folderId: enFirmas });
                    continue;
                }

                const enRaiz = await buscarCarpeta(nombre, ROOT_FOLDER_ID);
                if (enRaiz) {
                    const movida = await moverCarpetaDrive(enRaiz, carpetaFirmasRaiz);
                    resultados.push({ nombre, estado: 'movida', folderId: movida });
                    continue;
                }

                const creada = await crearCarpeta(nombre, carpetaFirmasRaiz);
                resultados.push({ nombre, estado: 'creada', folderId: creada });
            } catch (error) {
                resultados.push({ nombre, estado: 'error', error: error.message });
            }
        }

        return { success: true, carpeta_firmas_id: carpetaFirmasRaiz, resultados };
    } catch (error) {
        console.error('[ERROR] Error migrando carpetas de firmas:', error.message);
        return { success: false, error: error.message, resultados };
    }
}

// =====================================================
// ORGANIZACIÓN GENERAL DE DRIVE (Documentos, Perfiles, Plantillas, tmp)
// =====================================================

const CARPETA_DOCUMENTOS = 'Documentos';
const CARPETA_CAPACITACIONES = 'Capacitaciones';
const CARPETA_DOCUMENTACION_CAP = 'Documentación';
const CARPETA_PLANTILLAS = 'Plantillas (NO BORRAR)';
const CARPETA_PERFILES = 'Perfiles';
const CARPETA_CURSOS = 'Cursos';
const CARPETA_CALIDAD = 'Calidad';
const CARPETA_CONTROL_OFICIOS = 'Control de Oficios';
const PREFIJO_TMP_REPORTE_SALUD = '_tmp_reporte_salud_';
const SISTEMA_GESTION_CALIDAD_FOLDER_ID = String(
    process.env.GOOGLE_DRIVE_SGC_ROOT_FOLDER_ID || '1UqQLy9dmcWQSHxFsjLOAZ6g6cIPhXoip'
).trim();

let _cacheCarpetaDocumentosId = null;
let _cacheCarpetaPerfilesId = null;
let _cacheCarpetaDocumentacionCapId = null;
let _cacheCarpetaCursosId = null;
let _cacheCarpetaControlOficiosId = null;
let _cacheCarpetaCalidadId = null;

async function moverArchivoDrive(archivoId, nuevoPadreId) {
    try {
        const info = await drive.files.get({
            fileId: archivoId,
            fields: 'id, name, parents',
            supportsAllDrives: true
        });
        const parents = Array.isArray(info.data.parents) ? info.data.parents : [];
        if (parents.includes(nuevoPadreId)) {
            return archivoId;
        }

        const removeParents = parents.filter((parentId) => parentId && parentId !== nuevoPadreId).join(',');
        await drive.files.update({
            fileId: archivoId,
            addParents: nuevoPadreId,
            ...(removeParents ? { removeParents } : {}),
            fields: 'id, parents',
            supportsAllDrives: true
        });

        console.log(`[Drive] Archivo "${info.data.name}" movido a carpeta ${nuevoPadreId}`);
        return archivoId;
    } catch (error) {
        const codigo = Number(error?.code || error?.status || error?.response?.status || 0);
        if (codigo === 403) {
            const err = new Error(error?.message || 'Sin permiso para mover el archivo en Drive');
            err.code = 403;
            err.statusCode = 403;
            err.cause = error;
            throw err;
        }
        throw error;
    }
}

async function listarCarpetasEnPadrePorPrefijo(carpetaPadreId, prefijoNombre) {
    const prefijo = escaparValorConsultaDrive(prefijoNombre);
    const response = await drive.files.list({
        q: `'${carpetaPadreId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${prefijo}' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    return response.data.files || [];
}

async function listarArchivosEnPadrePorPrefijo(carpetaPadreId, prefijoNombre) {
    const prefijo = escaparValorConsultaDrive(prefijoNombre);
    const response = await drive.files.list({
        q: `'${carpetaPadreId}' in parents and mimeType!='application/vnd.google-apps.folder' and name contains '${prefijo}' and trashed=false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    return response.data.files || [];
}

async function eliminarCarpetaYContenido(carpetaId) {
    if (!carpetaId) return false;
    try {
        const [subcarpetas, archivos] = await Promise.all([
            listarSubcarpetas(carpetaId),
            listarArchivosCarpeta(carpetaId)
        ]);
        for (const archivo of archivos) {
            await eliminarArchivoDrive(archivo.id, archivo.name);
        }
        for (const sub of subcarpetas) {
            await eliminarCarpetaYContenido(sub.id);
        }
        return await eliminarCarpetaPorId(carpetaId);
    } catch (err) {
        console.warn(`[WARN] No se pudo eliminar carpeta ${carpetaId}:`, err.message);
        return false;
    }
}

async function obtenerCarpetaDocumentos() {
    if (_cacheCarpetaDocumentosId) {
        return _cacheCarpetaDocumentosId;
    }
    _cacheCarpetaDocumentosId = await obtenerOCrearCarpeta(CARPETA_DOCUMENTOS, ROOT_FOLDER_ID);
    return _cacheCarpetaDocumentosId;
}

async function obtenerCarpetaPerfiles() {
    if (_cacheCarpetaPerfilesId) {
        return _cacheCarpetaPerfilesId;
    }

    const carpetaFirmasRaiz = await obtenerCarpetaFirmasRaiz();
    const enFirmas = await buscarCarpeta(CARPETA_PERFILES, carpetaFirmasRaiz);
    if (enFirmas) {
        _cacheCarpetaPerfilesId = enFirmas;
        return enFirmas;
    }

    const enRaiz = await buscarCarpeta(CARPETA_PERFILES, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaPerfilesId = await moverCarpetaDrive(enRaiz, carpetaFirmasRaiz);
        return _cacheCarpetaPerfilesId;
    }

    _cacheCarpetaPerfilesId = await crearCarpeta(CARPETA_PERFILES, carpetaFirmasRaiz);
    return _cacheCarpetaPerfilesId;
}

async function obtenerCarpetaDocumentacionCapacitacion() {
    if (_cacheCarpetaDocumentacionCapId) {
        return _cacheCarpetaDocumentacionCapId;
    }

    const carpetaCapacitaciones = await obtenerOCrearCarpeta(CARPETA_CAPACITACIONES, ROOT_FOLDER_ID);
    _cacheCarpetaDocumentacionCapId = await obtenerOCrearCarpeta(CARPETA_DOCUMENTACION_CAP, carpetaCapacitaciones);
    return _cacheCarpetaDocumentacionCapId;
}

async function resolverCarpetaFotosUsuarios() {
    const envFolder = String(process.env.GOOGLE_DRIVE_FOTOS_USUARIOS_FOLDER_ID || '').trim();
    if (envFolder) {
        try {
            await drive.files.get({
                fileId: envFolder,
                fields: 'id, trashed',
                supportsAllDrives: true
            });
            return envFolder;
        } catch (err) {
            console.warn('[WARN] GOOGLE_DRIVE_FOTOS_USUARIOS_FOLDER_ID inválido, usando Firmas/Perfiles:', err.message);
        }
    }
    return obtenerCarpetaPerfiles();
}

async function moverPlantillasACapacitacionDocumentacion() {
    const carpetaDocumentacion = await obtenerCarpetaDocumentacionCapacitacion();
    const enDestino = await buscarCarpeta(CARPETA_PLANTILLAS, carpetaDocumentacion);
    if (enDestino) {
        return { estado: 'ya_organizada', folderId: enDestino };
    }

    const enRaiz = await buscarCarpeta(CARPETA_PLANTILLAS, ROOT_FOLDER_ID);
    if (enRaiz) {
        const movida = await moverCarpetaDrive(enRaiz, carpetaDocumentacion);
        return { estado: 'movida', folderId: movida };
    }

    const creada = await crearCarpeta(CARPETA_PLANTILLAS, carpetaDocumentacion);
    return { estado: 'creada', folderId: creada };
}

async function moverCursosACapacitaciones() {
    const carpetaCapacitaciones = await obtenerOCrearCarpeta(CARPETA_CAPACITACIONES, ROOT_FOLDER_ID);
    const enCapacitaciones = await buscarCarpeta(CARPETA_CURSOS, carpetaCapacitaciones);
    if (enCapacitaciones) {
        _cacheCarpetaCursosId = enCapacitaciones;
        return { estado: 'ya_organizada', folderId: enCapacitaciones };
    }

    const enRaiz = await buscarCarpeta(CARPETA_CURSOS, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaCursosId = await moverCarpetaDrive(enRaiz, carpetaCapacitaciones);
        return { estado: 'movida', folderId: _cacheCarpetaCursosId };
    }

    _cacheCarpetaCursosId = await crearCarpeta(CARPETA_CURSOS, carpetaCapacitaciones);
    return { estado: 'creada', folderId: _cacheCarpetaCursosId };
}

async function limpiarCarpetasTmpReporteSalud() {
    const resultados = [];
    const carpetaDocumentos = await obtenerCarpetaDocumentos();
    const carpetasTmp = await listarCarpetasEnPadrePorPrefijo(ROOT_FOLDER_ID, PREFIJO_TMP_REPORTE_SALUD);

    for (const carpeta of carpetasTmp) {
        const item = { nombre: carpeta.name, folderId: carpeta.id, estado: 'pendiente' };
        try {
            const archivos = await listarArchivosCarpeta(carpeta.id);
            const bizLogo = archivos.find((archivo) => archivo.name === 'biz_logo.png');

            if (bizLogo) {
                const existente = await buscarArchivo('biz_logo.png', carpetaDocumentos);
                if (!existente) {
                    await moverArchivoDrive(bizLogo.id, carpetaDocumentos);
                    item.bizLogo = 'movido_a_documentos';
                } else {
                    await eliminarArchivoDrive(bizLogo.id, 'biz_logo.png (duplicado tmp)');
                    item.bizLogo = 'duplicado_eliminado';
                }
            }

            const eliminada = await eliminarCarpetaYContenido(carpeta.id);
            item.estado = eliminada ? 'eliminada' : 'error_eliminacion';
        } catch (error) {
            item.estado = 'error';
            item.error = error.message;
        }
        resultados.push(item);
    }

    return { success: true, carpetas_procesadas: resultados.length, resultados };
}

async function moverFotosSueltasDeRaizAPerfiles() {
    const carpetaPerfiles = await obtenerCarpetaPerfiles();
    const fotosSueltas = await listarArchivosEnPadrePorPrefijo(ROOT_FOLDER_ID, 'foto_');
    const resultados = [];

    for (const foto of fotosSueltas) {
        try {
            await moverArchivoDrive(foto.id, carpetaPerfiles);
            resultados.push({ nombre: foto.name, estado: 'movida', fileId: foto.id });
        } catch (error) {
            resultados.push({ nombre: foto.name, estado: 'error', error: error.message });
        }
    }

    return { success: true, fotos_movidas: resultados.filter((r) => r.estado === 'movida').length, resultados };
}

function obtenerSistemaGestionCalidadFolderId() {
    return SISTEMA_GESTION_CALIDAD_FOLDER_ID;
}

async function buscarCarpetaCalidadLegacy() {
    const enRaiz = await buscarCarpeta(CARPETA_CALIDAD, ROOT_FOLDER_ID);
    if (enRaiz) {
        return { ubicacion: 'sistema_integral', folderId: enRaiz };
    }

    const sgcRoot = obtenerSistemaGestionCalidadFolderId();
    const enSgc = await buscarCarpeta(CARPETA_CALIDAD, sgcRoot);
    if (enSgc) {
        return { ubicacion: 'sgc', folderId: enSgc };
    }

    return null;
}

async function extraerControlDeOficiosDeCalidad() {
    const enRaiz = await buscarCarpeta(CARPETA_CONTROL_OFICIOS, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaControlOficiosId = enRaiz;
        return { estado: 'ya_en_raiz', folderId: enRaiz };
    }

    const calidad = await buscarCarpetaCalidadLegacy();
    if (!calidad?.folderId) {
        return { estado: 'calidad_no_encontrada' };
    }

    const controlOficios = await buscarCarpeta(CARPETA_CONTROL_OFICIOS, calidad.folderId);
    if (!controlOficios) {
        return { estado: 'no_existe_en_calidad', carpeta_calidad_id: calidad.folderId };
    }

    const movida = await moverCarpetaDrive(controlOficios, ROOT_FOLDER_ID);
    _cacheCarpetaControlOficiosId = movida;
    return { estado: 'movida', folderId: movida, origen: calidad.ubicacion };
}

async function moverCalidadASistemaGestionCalidad() {
    const sgcRoot = obtenerSistemaGestionCalidadFolderId();
    if (!sgcRoot) {
        throw new Error('GOOGLE_DRIVE_SGC_ROOT_FOLDER_ID no configurado');
    }

    const enSgc = await buscarCarpeta(CARPETA_CALIDAD, sgcRoot);
    if (enSgc) {
        _cacheCarpetaCalidadId = enSgc;
        return { estado: 'ya_organizada', folderId: enSgc, destino: sgcRoot };
    }

    const enRaiz = await buscarCarpeta(CARPETA_CALIDAD, ROOT_FOLDER_ID);
    if (!enRaiz) {
        return { estado: 'no_encontrada_en_raiz' };
    }

    const movida = await moverCarpetaDrive(enRaiz, sgcRoot);
    _cacheCarpetaCalidadId = movida;
    return { estado: 'movida', folderId: movida, destino: sgcRoot };
}

async function obtenerCarpetaControlOficios() {
    if (_cacheCarpetaControlOficiosId) {
        return _cacheCarpetaControlOficiosId;
    }

    const enRaiz = await buscarCarpeta(CARPETA_CONTROL_OFICIOS, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaControlOficiosId = enRaiz;
        return enRaiz;
    }

    const calidad = await buscarCarpetaCalidadLegacy();
    if (calidad?.folderId) {
        const enCalidad = await buscarCarpeta(CARPETA_CONTROL_OFICIOS, calidad.folderId);
        if (enCalidad) {
            _cacheCarpetaControlOficiosId = await moverCarpetaDrive(enCalidad, ROOT_FOLDER_ID);
            return _cacheCarpetaControlOficiosId;
        }
    }

    _cacheCarpetaControlOficiosId = await crearCarpeta(CARPETA_CONTROL_OFICIOS, ROOT_FOLDER_ID);
    return _cacheCarpetaControlOficiosId;
}

async function obtenerCarpetaCalidad() {
    if (_cacheCarpetaCalidadId) {
        return _cacheCarpetaCalidadId;
    }

    const sgcRoot = obtenerSistemaGestionCalidadFolderId();
    const enSgc = await buscarCarpeta(CARPETA_CALIDAD, sgcRoot);
    if (enSgc) {
        _cacheCarpetaCalidadId = enSgc;
        return enSgc;
    }

    const enRaiz = await buscarCarpeta(CARPETA_CALIDAD, ROOT_FOLDER_ID);
    if (enRaiz) {
        _cacheCarpetaCalidadId = await moverCarpetaDrive(enRaiz, sgcRoot);
        return _cacheCarpetaCalidadId;
    }

    _cacheCarpetaCalidadId = await crearCarpeta(CARPETA_CALIDAD, sgcRoot);
    return _cacheCarpetaCalidadId;
}

async function migrarOrganizacionDriveGeneral() {
    const resultados = {
        plantillas: null,
        cursos: null,
        control_oficios: null,
        calidad: null,
        perfiles: null,
        tmp_reporte_salud: null,
        fotos_sueltas: null
    };

    try {
        resultados.plantillas = await moverPlantillasACapacitacionDocumentacion();
    } catch (error) {
        resultados.plantillas = { estado: 'error', error: error.message };
    }

    try {
        resultados.cursos = await moverCursosACapacitaciones();
    } catch (error) {
        resultados.cursos = { estado: 'error', error: error.message };
    }

    try {
        resultados.control_oficios = await extraerControlDeOficiosDeCalidad();
    } catch (error) {
        resultados.control_oficios = { estado: 'error', error: error.message };
    }

    try {
        resultados.calidad = await moverCalidadASistemaGestionCalidad();
    } catch (error) {
        resultados.calidad = { estado: 'error', error: error.message };
    }

    try {
        const carpetaPerfilesId = await obtenerCarpetaPerfiles();
        resultados.perfiles = { estado: 'ok', folderId: carpetaPerfilesId };
    } catch (error) {
        resultados.perfiles = { estado: 'error', error: error.message };
    }

    try {
        resultados.tmp_reporte_salud = await limpiarCarpetasTmpReporteSalud();
    } catch (error) {
        resultados.tmp_reporte_salud = { success: false, error: error.message };
    }

    try {
        resultados.fotos_sueltas = await moverFotosSueltasDeRaizAPerfiles();
    } catch (error) {
        resultados.fotos_sueltas = { success: false, error: error.message };
    }

    const huboCambios = (
        resultados.plantillas?.estado === 'movida'
        || resultados.cursos?.estado === 'movida'
        || resultados.control_oficios?.estado === 'movida'
        || resultados.calidad?.estado === 'movida'
        || (resultados.tmp_reporte_salud?.carpetas_procesadas || 0) > 0
        || (resultados.fotos_sueltas?.fotos_movidas || 0) > 0
        || resultados.perfiles?.estado === 'ok'
    );

    return { success: true, hubo_cambios: huboCambios, resultados };
}

/**
 * Reemplazar el contenido de un archivo en Google Drive manteniendo el mismo ID y nombre.
 * @param {string} fileId - ID del archivo en Drive
 * @param {Buffer} buffer - Nuevo contenido del archivo
 * @param {string} mimeType - Tipo MIME del nuevo archivo
 * @param {string} nombre - Nombre del archivo (se conserva el original)
 * @returns {Promise<object>} - Datos actualizados del archivo
 */
async function reemplazarArchivoEnDrive(fileId, buffer, mimeType, nombre) {
    try {
        const { Readable } = require('stream');
        const media = { mimeType, body: Readable.from(buffer) };
        const response = await drive.files.update({
            fileId,
            requestBody: { name: nombre },
            media,
            fields: 'id, name, mimeType, size, modifiedTime, webViewLink, webContentLink'
        });
        console.log(`[DRIVE] Archivo reemplazado en Drive: ${response.data.name} (${fileId})`);
        return response.data;
    } catch (error) {
        console.error('[ERROR] Error reemplazando archivo en Drive:', error.message);
        throw error;
    }
}

// ── Caché de IDs de carpetas de PC en Drive (evita búsquedas repetidas) ──
let _cacheCarpetaPcId = null;
let _cacheCarpetaCatalogoId = null;
let _cachePipcHistorialPromise = null; // lock para obtenerCarpetaPipcHistorial

// ── Caché para PIPC historial ──
let _cachePipcFolderId = null;
let _cachePipcHistorialFolderId = null;
const _cachePipcEmpresaFolderIds = {};        // ID final por empresa
const _cachePipcEmpresaFolderPromises = {};   // Promesa en vuelo por empresa (evita duplicados por concurrencia)

function invalidarCacheCarpetasPC() {
    _cacheCarpetaPcId = null;
    _cacheCarpetaCatalogoId = null;
    _cachePipcFolderId = null;
    _cachePipcHistorialFolderId = null;
    _cachePipcHistorialPromise = null; // limpiar lock para forzar re-búsqueda
    // También limpiar caché de carpetas de empresa
    Object.keys(_cachePipcEmpresaFolderIds).forEach(k => delete _cachePipcEmpresaFolderIds[k]);
    Object.keys(_cachePipcEmpresaFolderPromises).forEach(k => delete _cachePipcEmpresaFolderPromises[k]);
}

/**
 * Obtener (o crear) la carpeta de empresa dentro de PIPC/Historial de documentos.
 * Usa una promesa compartida para evitar duplicados cuando varias tareas
 * concurrentes solicitan la misma empresa simultáneamente.
 * @param {string} nombreEmpresa
 * @param {string} carpetaHistorial - ID de la carpeta padre "Historial de documentos"
 * @returns {Promise<string>} - ID de la carpeta de empresa
 */
async function obtenerCarpetaEmpresaPC(nombreEmpresa, carpetaHistorial) {
    if (_cachePipcEmpresaFolderIds[nombreEmpresa]) {
        return _cachePipcEmpresaFolderIds[nombreEmpresa];
    }
    // Si ya hay una promesa en vuelo para esta empresa, esperarla (no crear otra)
    if (!_cachePipcEmpresaFolderPromises[nombreEmpresa]) {
        _cachePipcEmpresaFolderPromises[nombreEmpresa] = (async () => {
            let empresaFolderId = await buscarCarpeta(nombreEmpresa, carpetaHistorial);
            if (!empresaFolderId) {
                const subcarpetas = await listarSubcarpetas(carpetaHistorial);
                const objetivo = normalizarNombreDrive(nombreEmpresa);
                const encontrada = subcarpetas.find(f => normalizarNombreDrive(f.name) === objetivo);
                if (encontrada) {
                    empresaFolderId = encontrada.id;
                    console.log(`[PC] Carpeta empresa encontrada por fuzzy: "${encontrada.name}"`);
                } else {
                    empresaFolderId = await crearCarpeta(nombreEmpresa, carpetaHistorial);
                }
            }
            _cachePipcEmpresaFolderIds[nombreEmpresa] = empresaFolderId;
            return empresaFolderId;
        })();
    }
    return _cachePipcEmpresaFolderPromises[nombreEmpresa];
}

/**
 * Obtiene (o crea) la carpeta PIPC/Historial de documentos en Drive
 */
async function obtenerCarpetaPipcHistorial() {
    if (_cachePipcHistorialFolderId) return _cachePipcHistorialFolderId;

    // Deduplicar llamadas concurrentes: si ya hay una en vuelo, esperar su resultado
    if (_cachePipcHistorialPromise) return _cachePipcHistorialPromise;

    _cachePipcHistorialPromise = (async () => {
        try {
            return await _resolverCarpetaPipcHistorial();
        } catch (err) {
            _cachePipcHistorialPromise = null; // permitir reintento en siguiente llamada
            throw err;
        }
    })();

    return _cachePipcHistorialPromise;
}

async function _resolverCarpetaPipcHistorial() {
    if (_cachePipcHistorialFolderId) return _cachePipcHistorialFolderId;

    // Reutilizar la carpeta Proteccion_civil ya cacheada por el catálogo,
    // o buscarla con candidatos de nombre + fallback fuzzy por listado.
    if (!_cacheCarpetaPcId) {
        const padresABuscar = [ROOT_FOLDER_ID, 'root'];
        const nombresPC = [
            'Protección_Civil', 'protección_civil', 'Protección_civil', 'proteccion_civil',
            'protección_Civil', 'proteccion_Civil',
            'Proteccion_civil', 'ProteccionCivil', 'Proteccion Civil',
            'Protección Civil', 'proteccion civil'
        ];
        for (const padre of padresABuscar) {
            // 1) Búsqueda por nombre exacto (Drive API, case-insensitive)
            for (const nombre of nombresPC) {
                const id = await buscarCarpeta(nombre, padre);
                if (id) {
                    _cacheCarpetaPcId = id;
                    console.log(`[PC-HISTORIAL] Carpeta PC encontrada (${padre}): ${id}`);
                    break;
                }
            }
            if (_cacheCarpetaPcId) break;
            // 2) Fallback fuzzy: listar subcarpetas y comparar nombres normalizados
            try {
                const subcarpetas = await listarSubcarpetas(padre);
                const pcNorm = 'proteccion_civil';
                const encontrada = subcarpetas.find(f => normalizarNombreDrive(f.name) === pcNorm);
                if (encontrada) {
                    _cacheCarpetaPcId = encontrada.id;
                    console.log(`[PC-HISTORIAL] Carpeta PC encontrada por fuzzy (${padre}): "${encontrada.name}" (${encontrada.id})`);
                    break;
                }
            } catch (_) { /* ignorar */ }
        }
        if (!_cacheCarpetaPcId) {
            // No existe – crearla con el nombre canónico
            _cacheCarpetaPcId = await crearCarpeta('Protección_Civil', ROOT_FOLDER_ID);
            console.log(`[PC-HISTORIAL] Carpeta Protección_Civil creada bajo ROOT: ${_cacheCarpetaPcId}`);
        }
    }

    // Buscar subcarpeta "Historial de documentos" (o "Historial de Documentos") con fallback fuzzy
    const historialNombres = ['Historial de Documentos', 'Historial de documentos'];
    let historialId = null;
    for (const nombre of historialNombres) {
        historialId = await buscarCarpeta(nombre, _cacheCarpetaPcId);
        if (historialId) break;
    }
    if (!historialId) {
        // Fallback fuzzy por listado
        try {
            const subcarpetas = await listarSubcarpetas(_cacheCarpetaPcId);
            const histNorm = 'historial_de_documentos';
            const encontrada = subcarpetas.find(f => normalizarNombreDrive(f.name) === histNorm);
            if (encontrada) {
                historialId = encontrada.id;
                console.log(`[PC-HISTORIAL] "Historial de Documentos" encontrado por fuzzy: "${encontrada.name}" (${encontrada.id})`);
            }
        } catch (_) { /* ignorar */ }
    }
    if (!historialId) {
        // Crear si no existe
        historialId = await crearCarpeta('Historial de Documentos', _cacheCarpetaPcId);
        console.log(`[PC-HISTORIAL] Carpeta 'Historial de Documentos' creada: ${historialId}`);
    }
    _cachePipcHistorialFolderId = historialId;
    console.log(`[PC-HISTORIAL] Carpeta Historial de Documentos: ${_cachePipcHistorialFolderId}`);
    return _cachePipcHistorialFolderId;
}

async function obtenerCatalogoProteccionCivilDesdeDrive() {
    const t0 = Date.now();
    const authCheck = await validarAutenticacionDrive('sync catálogo protección civil');
    if (!authCheck.ok) {
        return {
            success: false,
            message: authCheck.message,
            categorias: []
        };
    }

    // Candidates to search: within ROOT_FOLDER_ID first, then My Drive root ('root')
    const padresABuscar = [ROOT_FOLDER_ID, 'root'];

    async function buscarCarpetaEnVariasRaices(nombresCandidatos, padres) {
        for (const padre of padres) {
            // 1) Try exact-name API search
            for (const nombre of nombresCandidatos) {
                const id = await buscarCarpeta(nombre, padre);
                if (id) return id;
            }
            // 2) Fuzzy fallback: list all subfolders and normalize names
            const subcarpetas = await listarSubcarpetas(padre);
            const encontrada = subcarpetas.find((folder) => {
                const n = normalizarNombreDrive(folder.name);
                return nombresCandidatos.some(c => normalizarNombreDrive(c) === n);
            });
            if (encontrada) return encontrada.id;
        }
        return null;
    }

    // ── Resolver carpeta Protección_civil (usa caché si existe) ──
    let carpetaPcId = _cacheCarpetaPcId;
    if (!carpetaPcId) {
        const nombresRaizPc = [
            'protección_civil', 'Protección_civil', 'proteccion_civil',
            'Proteccion_civil', 'ProteccionCivil', 'Proteccion Civil',
            'Protección Civil', 'proteccion civil'
        ];
        carpetaPcId = await buscarCarpetaEnVariasRaices(nombresRaizPc, padresABuscar);
        if (carpetaPcId) {
            _cacheCarpetaPcId = carpetaPcId;
            startupLog.detail('[PC-CATALOGO] Carpeta Protección_civil encontrada y cacheada: ' + carpetaPcId);
        }
    }

    if (!carpetaPcId) {
        console.error('[PC-CATALOGO] No se encontró carpeta Protección_civil en Drive (buscado en ROOT y root)');
        return { success: false, message: 'No se encontró carpeta Protección_civil en Drive', categorias: [] };
    }

    // ── Resolver carpeta Catalogo (usa caché si existe) ──
    let carpetaCatalogoId = _cacheCarpetaCatalogoId;
    if (!carpetaCatalogoId) {
        const nombresCatalogo = ['Catalogo', 'Catálogo', 'catalogo', 'catálogo'];
        carpetaCatalogoId = await buscarCarpetaEnVariasRaices(nombresCatalogo, [carpetaPcId]);
        if (carpetaCatalogoId) {
            _cacheCarpetaCatalogoId = carpetaCatalogoId;
            startupLog.detail('[PC-CATALOGO] Carpeta Catalogo encontrada y cacheada: ' + carpetaCatalogoId);
        }
    }

    if (!carpetaCatalogoId) {
        console.error('[PC-CATALOGO] No se encontró subcarpeta Catalogo dentro de Protección_civil');
        return { success: false, message: 'No se encontró carpeta Catalogo dentro de Protección_civil', categorias: [] };
    }

    // ── Listar categorías y archivos EN PARALELO ──
    const carpetasCategoria = await listarSubcarpetas(carpetaCatalogoId);

    const categorias = await Promise.all(
        carpetasCategoria.map(async (carpetaCategoria) => {
            const archivos = await listarArchivosCarpeta(carpetaCategoria.id);
            return {
                nombre: carpetaCategoria.name,
                folderId: carpetaCategoria.id,
                modifiedTime: carpetaCategoria.modifiedTime || null,
                documentos: archivos.map((file) => ({
                    id: file.id,
                    nombre: file.name,
                    mimeType: file.mimeType,
                    size: file.size ? Number(file.size) : null,
                    modifiedTime: file.modifiedTime || null,
                    webViewLink: file.webViewLink || null,
                    webContentLink: file.webContentLink || null
                }))
            };
        })
    );

    startupLog.detail(`[PC-CATALOGO] Drive leído en ${Date.now() - t0}ms (${categorias.length} categorías)`);

    return {
        success: true,
        folderProteccionCivilId: carpetaPcId,
        folderCatalogoId: carpetaCatalogoId,
        categorias
    };
}

// =====================================================
// FUNCIONES DE SINCRONIZACIÓN
// =====================================================

/**
 * Sincronizar carpetas de áreas temáticas con Google Drive
 * @param {Array<{area_id: number, nombre_area: string}>} areas - Lista de áreas de la BD
 * @returns {Promise<object>} - Resultado de la sincronización
 */
async function sincronizarCarpetasAreas(areas) {
    if (!driveDisponible()) {
        return { success: false, skipped: true, error: 'Google Drive no configurado' };
    }

    try {
        const carpetaCursos = await obtenerCarpetaCursos();
        const carpetasCreadas = [];
        const carpetasExistentes = [];

        for (const area of areas) {
            const existente = await buscarCarpeta(area.nombre_area, carpetaCursos);
            if (existente) {
                carpetasExistentes.push(area.nombre_area);
            } else {
                await crearCarpeta(area.nombre_area, carpetaCursos);
                carpetasCreadas.push(area.nombre_area);
            }
        }

        return {
            success: true,
            total_areas: areas.length,
            carpetas_creadas: carpetasCreadas,
            carpetas_existentes: carpetasExistentes
        };
    } catch (error) {
        console.error('[ERROR] Error sincronizando áreas:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Sincronizar carpetas de cursos individuales dentro de cada área
 * @param {Array<{area_id: number, nombre_area: string}>} areas - Lista de áreas
 * @param {Function} obtenerCursosPorArea - Función que recibe area_id y retorna cursos
 * @returns {Promise<object>} - Resultado de la sincronización
 */
async function sincronizarCarpetasCursosCompleta(areas, obtenerCursosPorArea) {
    if (!driveDisponible()) {
        return { success: false, skipped: true, error: 'Google Drive no configurado' };
    }

    try {
        const carpetaCursos = await obtenerCarpetaCursos();
        const carpetasCreadas = [];
        const carpetasExistentes = [];

        for (const area of areas) {
            // Asegurar carpeta del área
            const carpetaArea = await obtenerOCrearCarpeta(area.nombre_area, carpetaCursos);

            // Obtener cursos de esta área
            const cursos = await obtenerCursosPorArea(area.area_id);

            for (const curso of cursos) {
                const existente = await buscarCarpeta(curso.nombre_curso, carpetaArea);
                if (existente) {
                    carpetasExistentes.push(`${area.nombre_area}/${curso.nombre_curso}`);
                } else {
                    await crearCarpeta(curso.nombre_curso, carpetaArea);
                    carpetasCreadas.push(`${area.nombre_area}/${curso.nombre_curso}`);
                    console.log(`  Carpeta de curso creada: ${rutaLogCarpetaCurso(area.nombre_area, curso.nombre_curso)}`);
                }
            }
        }

        return {
            success: true,
            total_areas: areas.length,
            carpetas_cursos_creadas: carpetasCreadas,
            carpetas_cursos_existentes: carpetasExistentes
        };
    } catch (error) {
        console.error('[ERROR] Error sincronizando cursos:', error.message);
        return { success: false, error: error.message };
    }
}

// =====================================================
// FUNCIONES PARA GENERACIÓN DE CONSTANCIAS (Google Slides)
// Optimizado: concurrencia 8, upload directo, cleanup fire-and-forget
// =====================================================

function detectarMimeImagen(buffer) {
    if (!buffer || buffer.length < 4) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    return 'image/png';
}

function extensionDesdeMimeImagen(mimeType) {
    return mimeType === 'image/jpeg' ? 'jpg' : 'png';
}

/**
 * Extrae un fileId de Drive desde un id crudo o URL (uc, lh3, /d/, etc.).
 */
function extraerDriveFileIdDeValor(valor) {
    const raw = String(valor || '').trim();
    if (!raw) return null;
    if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;

    const byIdParam = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const byPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const byGoogleusercontent = raw.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);

    return byIdParam?.[1] || byPath?.[1] || byGoogleusercontent?.[1] || null;
}

/**
 * Sube un buffer de imagen a Drive con permiso público para replaceAllShapesWithImage.
 */
async function subirBufferImagenPublicaParaSlides(buffer, mimeType, nombre) {
    const response = await drive.files.create({
        requestBody: { name: nombre },
        media: { mimeType, body: require('stream').Readable.from(buffer) },
        fields: 'id'
    });
    const fileId = response.data.id;

    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' }
    });

    // Dar tiempo a que el permiso público propague antes de que Slides intente descargar.
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
        fileId,
        // uc+export=download es más confiable que lh3 para archivos recién publicados
        url: `https://drive.google.com/uc?export=download&id=${fileId}`
    };
}

/**
 * Descarga firma vía Drive API (como DC-3) y publica copia temporal accesible por Google Slides.
 * Evita "Access to the provided image was forbidden" de lh3/uc sobre archivos privados.
 */
async function resolverUrlFirmaParaSlides(driveFileId, etiqueta = 'firma') {
    const fileId = extraerDriveFileIdDeValor(driveFileId);
    if (!fileId) return null;

    const buffer = await descargarArchivo(fileId);
    if (!buffer || buffer.length < 4) {
        throw new Error(`Firma ${etiqueta} vacía o inválida (drive_id=${fileId})`);
    }

    const mimeType = detectarMimeImagen(buffer);
    const ext = extensionDesdeMimeImagen(mimeType);
    const nombre = `_tmp_slides_${etiqueta}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const subida = await subirBufferImagenPublicaParaSlides(buffer, mimeType, nombre);

    return { url: subida.url, tempFileId: subida.fileId };
}

// Inicializar Google Slides API con la misma auth
let slides;
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2Slides = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Slides.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    slides = google.slides({ version: 'v1', auth: oauth2Slides });
}

/**
 * Upload ultra-ligero: solo 1 llamada API (sin búsqueda de duplicados, sin permisos)
 * Los permisos se aplican en lote al final. 3x más rápido que subirArchivo().
 */
async function uploadPdfFast(buffer, nombrePdf, carpetaId) {
    const response = await drive.files.create({
        requestBody: { name: nombrePdf, parents: [carpetaId] },
        media: { mimeType: 'application/pdf', body: require('stream').Readable.from(buffer) },
        fields: 'id, webViewLink'
    });
    return response.data;
}

/**
 * Upload rápido genérico (1 sola llamada API, sin búsqueda de duplicados)
 * Soporta cualquier mimeType (xlsx, pdf, etc.)
 */
async function uploadFileFast(buffer, nombreArchivo, mimeType, carpetaId) {
    const response = await drive.files.create({
        requestBody: { name: nombreArchivo, parents: [carpetaId] },
        media: { mimeType, body: require('stream').Readable.from(buffer) },
        fields: 'id, webViewLink'
    });
    // Necesario para miniaturas/visor por enlace (thumbnail + preview en el navegador).
    try {
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: { role: 'reader', type: 'anyone' }
        });
    } catch (permError) {
        console.warn('[WARN] uploadFileFast: no se pudo hacer público el archivo:', permError.message);
    }
    return response.data;
}

/**
 * Preparar un template ajustado con firmas grandes y reposicionadas.
 * Se crea UNA VEZ y se reutiliza para todas las copias del lote.
 * Esto elimina presentations.get + adjustRequests por cada constancia.
 */
async function prepararTemplateAjustado(templateId, firmaUrl, firmaCalidadUrl) {
    if (!firmaUrl && !firmaCalidadUrl) return templateId;

    try {
        const copia = await drive.files.copy({
            fileId: templateId,
            requestBody: { name: `_adjusted_template_${Date.now()}` }
        });
        const adjustedId = copia.data.id;

        const pres = await slides.presentations.get({ presentationId: adjustedId });
        const adjustRequests = [];

        for (const slide of (pres.data.slides || [])) {
            for (const el of (slide.pageElements || [])) {
                if (!el.shape?.text?.textElements || !el.transform) continue;
                const fullText = el.shape.text.textElements.map(te => te.textRun?.content || '').join('');

                const isFirmaInstructor = fullText.includes('{{firma_instructor}}') && firmaUrl;
                const isFirmaCalidad = fullText.includes('{{firma_calidad}}') && firmaCalidadUrl;

                if (isFirmaInstructor || isFirmaCalidad) {
                    const origScaleX = el.transform.scaleX || 1;
                    const origScaleY = el.transform.scaleY || 1;
                    const origW = el.size?.width?.magnitude || 1800000;
                    const origH = el.size?.height?.magnitude || 600000;
                    const scale = isFirmaInstructor ? 1.9 : 1.7;
                    // Grow from center: compensate X/Y for size increase
                    const deltaW = origW * (scale - 1) * origScaleX / 2;
                    const deltaH = origH * (scale - 1) * origScaleY / 2;
                    const instructorShiftRight = isFirmaInstructor ? 130000 : 0; // ~3.7mm
                    const shiftUp = -200000; // subir ambas firmas ~5.6mm

                    adjustRequests.push({
                        updatePageElementTransform: {
                            objectId: el.objectId,
                            applyMode: 'ABSOLUTE',
                            transform: {
                                scaleX: origScaleX * scale,
                                scaleY: origScaleY * scale,
                                shearX: el.transform.shearX || 0,
                                shearY: el.transform.shearY || 0,
                                translateX: (el.transform.translateX || 0) - deltaW + instructorShiftRight,
                                translateY: (el.transform.translateY || 0) - deltaH + shiftUp,
                                unit: 'EMU'
                            }
                        }
                    });
                }
            }
        }

        if (adjustRequests.length > 0) {
            await slides.presentations.batchUpdate({
                presentationId: adjustedId,
                requestBody: { requests: adjustRequests }
            });
            console.log(`[INFO] Template ajustado creado (${adjustRequests.length} firmas reposicionadas/agrandadas)`);
        }

        return adjustedId;
    } catch (err) {
        console.warn(`[WARN] No se pudo crear template ajustado: ${err.message}. Usando original.`);
        return templateId;
    }
}

/**
 * Generar una constancia: copy → batchUpdate (texto+imágenes) → export → upload
 * Solo 4 llamadas API por constancia.
 */
async function generarConstanciaSlides(templateId, variables, nombrePdf, carpetaDestinoId, firmaUrl = null, firmaCalidadUrl = null) {
    let copiaId = null;
    try {
        if (!slides) throw new Error('Google Slides API no inicializada');

        // 1. Copiar template (ya tiene firmas ajustadas si se usó prepararTemplateAjustado)
        const copia = await drive.files.copy({
            fileId: templateId,
            requestBody: { name: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
        });
        copiaId = copia.data.id;

        // 2. UNA SOLA batchUpdate: texto + imágenes de firma
        const requests = Object.entries(variables).map(([k, v]) => ({
            replaceAllText: {
                containsText: { text: `{{${k}}}`, matchCase: false },
                replaceText: String(v || '')
            }
        }));

        if (firmaUrl) {
            requests.push({
                replaceAllShapesWithImage: {
                    imageUrl: firmaUrl,
                    replaceMethod: 'CENTER_INSIDE',
                    containsText: { text: '{{firma_instructor}}', matchCase: false }
                }
            });
        } else {
            requests.push({
                replaceAllText: {
                    containsText: { text: '{{firma_instructor}}', matchCase: false },
                    replaceText: ''
                }
            });
        }

        if (firmaCalidadUrl) {
            requests.push({
                replaceAllShapesWithImage: {
                    imageUrl: firmaCalidadUrl,
                    replaceMethod: 'CENTER_INSIDE',
                    containsText: { text: '{{firma_calidad}}', matchCase: false }
                }
            });
        } else {
            requests.push({
                replaceAllText: {
                    containsText: { text: '{{firma_calidad}}', matchCase: false },
                    replaceText: ''
                }
            });
        }

        if (requests.length > 0) {
            const maxIntentos = 3;
            let ultimoError = null;
            for (let intento = 1; intento <= maxIntentos; intento++) {
                try {
                    await slides.presentations.batchUpdate({
                        presentationId: copiaId,
                        requestBody: { requests }
                    });
                    ultimoError = null;
                    break;
                } catch (batchError) {
                    ultimoError = batchError;
                    const mensaje = String(batchError?.message || batchError || '');
                    const esErrorImagen = mensaje.includes('replaceAllShapesWithImage')
                        || mensaje.includes('retrieving the image');
                    if (!esErrorImagen || intento === maxIntentos) {
                        throw batchError;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 800 * intento));
                }
            }
            if (ultimoError) throw ultimoError;
        }

        // 3. Exportar como PDF
        const pdfResponse = await drive.files.export(
            { fileId: copiaId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );

        // 4. Upload directo (sin búsqueda duplicados, sin permisos)
        const pdfFile = await uploadPdfFast(Buffer.from(pdfResponse.data), nombrePdf, carpetaDestinoId);

        return { success: true, fileId: pdfFile.id, webViewLink: pdfFile.webViewLink, copiaId };
    } catch (error) {
        console.error(`[ERROR] generarConstanciaSlides: ${error.message}`);
        return { success: false, error: error.message, copiaId };
    }
}

async function generarConstanciaPdfBuffer(templateId, variables, firmaUrl = null, firmaCalidadUrl = null) {
    let copiaId = null;
    try {
        if (!slides) throw new Error('Google Slides API no inicializada');

        const copia = await drive.files.copy({
            fileId: templateId,
            requestBody: { name: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
        });
        copiaId = copia.data.id;

        const requests = Object.entries(variables).map(([k, v]) => ({
            replaceAllText: {
                containsText: { text: `{{${k}}}`, matchCase: false },
                replaceText: String(v || '')
            }
        }));

        if (firmaUrl) {
            requests.push({
                replaceAllShapesWithImage: {
                    imageUrl: firmaUrl,
                    replaceMethod: 'CENTER_INSIDE',
                    containsText: { text: '{{firma_instructor}}', matchCase: false }
                }
            });
        } else {
            requests.push({
                replaceAllText: {
                    containsText: { text: '{{firma_instructor}}', matchCase: false },
                    replaceText: ''
                }
            });
        }

        if (firmaCalidadUrl) {
            requests.push({
                replaceAllShapesWithImage: {
                    imageUrl: firmaCalidadUrl,
                    replaceMethod: 'CENTER_INSIDE',
                    containsText: { text: '{{firma_calidad}}', matchCase: false }
                }
            });
        } else {
            requests.push({
                replaceAllText: {
                    containsText: { text: '{{firma_calidad}}', matchCase: false },
                    replaceText: ''
                }
            });
        }

        if (requests.length > 0) {
            const maxIntentos = 3;
            let ultimoError = null;
            for (let intento = 1; intento <= maxIntentos; intento++) {
                try {
                    await slides.presentations.batchUpdate({
                        presentationId: copiaId,
                        requestBody: { requests }
                    });
                    ultimoError = null;
                    break;
                } catch (batchError) {
                    ultimoError = batchError;
                    const mensaje = String(batchError?.message || batchError || '');
                    const esErrorImagen = mensaje.includes('replaceAllShapesWithImage')
                        || mensaje.includes('retrieving the image');
                    if (!esErrorImagen || intento === maxIntentos) {
                        throw batchError;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 800 * intento));
                }
            }
            if (ultimoError) throw ultimoError;
        }

        const pdfResponse = await drive.files.export(
            { fileId: copiaId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );

        return Buffer.from(pdfResponse.data);
    } finally {
        if (copiaId) {
            try {
                await drive.files.delete({ fileId: copiaId });
            } catch (deleteErr) {
                console.warn(`[WARN] No se pudo eliminar copia temporal de Slides ${copiaId}: ${deleteErr.message}`);
            }
        }
    }
}

/**
 * Pool de workers con concurrencia limitada
 */
async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < tasks.length) {
            const i = nextIndex++;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    );
    return results;
}

/**
 * Generar constancias en lote — máxima velocidad
 *
 * Optimizaciones:
 *  - Template ajustado UNA VEZ (firmas reposicionadas/agrandadas) → elimina presentations.get por copia
 *  - UNA sola batchUpdate por constancia (texto + imágenes juntos)
 *  - Concurrencia 10 (subida de 8)
 *  - Upload directo sin búsqueda duplicados
 *  - Permisos y limpieza fire-and-forget
 *
 * API calls por constancia: 4 (copy + batchUpdate + export + create)
 * Overhead: +3 para template ajustado (copy + get + adjust)
 */
async function generarConstanciasLote(templateId, participantes, carpetaDestinoId, onProgress, concurrency = 10, firmaUrl = null, firmaCalidadUrl = null, firmaDriveId = null, firmaCalidadDriveId = null) {
    const tempFirmaFileIds = [];

    // Siempre republicar firmas vía Drive API: lh3/uc sobre archivos privados
    // falla con "Access to the provided image was forbidden" en replaceAllShapesWithImage.
    // Si no llega driveId, lo extraemos de la URL (uc, lh3, /d/).
    const instructorDriveId = extraerDriveFileIdDeValor(firmaDriveId) || extraerDriveFileIdDeValor(firmaUrl);
    const calidadDriveId = extraerDriveFileIdDeValor(firmaCalidadDriveId) || extraerDriveFileIdDeValor(firmaCalidadUrl);

    if (instructorDriveId) {
        try {
            const resolved = await resolverUrlFirmaParaSlides(instructorDriveId, 'instructor');
            if (resolved) {
                firmaUrl = resolved.url;
                tempFirmaFileIds.push(resolved.tempFileId);
                console.log(`[INFO] Firma instructor lista para Slides (origen drive_id=${instructorDriveId})`);
            }
        } catch (err) {
            console.warn(`[WARN] Firma instructor no disponible para Slides: ${err.message}`);
            firmaUrl = null;
        }
    } else if (firmaUrl) {
        // URL externa sin fileId de Drive: no forzar; Slides la intentará tal cual.
        console.warn('[WARN] Firma instructor sin drive_id; se usará la URL recibida (puede fallar si no es pública).');
    }

    if (calidadDriveId) {
        try {
            const resolved = await resolverUrlFirmaParaSlides(calidadDriveId, 'calidad');
            if (resolved) {
                firmaCalidadUrl = resolved.url;
                tempFirmaFileIds.push(resolved.tempFileId);
                console.log(`[INFO] Firma calidad lista para Slides (origen drive_id=${calidadDriveId})`);
            }
        } catch (err) {
            console.warn(`[WARN] Firma calidad no disponible para Slides: ${err.message}`);
            firmaCalidadUrl = null;
        }
    } else if (firmaCalidadUrl) {
        console.warn('[WARN] Firma calidad sin drive_id; se usará la URL recibida (puede fallar si no es pública).');
    }

    // Preparar template con firmas ajustadas UNA VEZ
    const adjustedTemplateId = await prepararTemplateAjustado(templateId, firmaUrl, firmaCalidadUrl);
    const usedAdjusted = adjustedTemplateId !== templateId;

    let completados = 0;
    const copiasTemporales = [];
    const pdfIds = [];

    const tasks = participantes.map((p, index) => {
        return async () => {
            const resultado = await generarConstanciaSlides(adjustedTemplateId, p.variables, p.nombrePdf, carpetaDestinoId, firmaUrl, firmaCalidadUrl);
            if (resultado.copiaId) copiasTemporales.push(resultado.copiaId);
            if (resultado.fileId) pdfIds.push(resultado.fileId);
            completados++;
            if (onProgress) onProgress(completados, participantes.length, p);
            return { ...resultado, index, nombrePdf: p.nombrePdf };
        };
    });

    const resultados = await runWithConcurrency(tasks, concurrency);

    let exitosos = 0, fallidos = 0;
    for (const r of resultados) {
        if (r.success) exitosos++;
        else {
            fallidos++;
            console.error(`[ERROR] Constancia "${r.nombrePdf}" falló: ${r.error}`);
        }
    }

    // Fire-and-forget: permisos + limpieza
    if (pdfIds.length > 0) {
        Promise.allSettled(
            pdfIds.map(id => drive.permissions.create({ fileId: id, requestBody: { role: 'reader', type: 'anyone' } }))
        ).then(res => {
            const failed = res.filter(r => r.status === 'rejected').length;
            if (failed) console.warn(`[WARN] ${failed}/${pdfIds.length} permisos fallaron`);
        });
    }

    // Limpiar copias temporales + template ajustado + firmas temporales públicas
    const toDelete = [...copiasTemporales, ...tempFirmaFileIds];
    if (usedAdjusted) toDelete.push(adjustedTemplateId);
    if (toDelete.length > 0) {
        console.log(`[INFO] Limpiando ${toDelete.length} archivos temporales (background)...`);
        Promise.allSettled(
            toDelete.map(id => drive.files.delete({ fileId: id }))
        ).then(res => {
            const failed = res.filter(r => r.status === 'rejected').length;
            if (failed) console.warn(`[WARN] ${failed} archivos no se pudieron eliminar`);
            else console.log(`[INFO] ${toDelete.length} archivos temporales eliminados`);
        });
    }

    return { exitosos, fallidos, total: participantes.length, resultados };
}

// =====================================================
// GENERACIÓN DE INFORME FOTOGRÁFICO (Google Slides)
// =====================================================

/**
 * Descarga imagen vía Drive API y publica copia temporal accesible por Google Slides.
 */
async function resolverUrlImagenParaSlides(driveFileId, etiqueta = 'imagen') {
    return resolverUrlFirmaParaSlides(driveFileId, etiqueta);
}

/**
 * Generar un Informe Fotográfico a partir de una plantilla de Google Slides.
 * Devuelve la presentación directamente (no PDF).
 *
 * Las imágenes se resuelven descargando desde Drive y publicando copias temporales,
 * igual que en constancias e informe final (lh3.googleusercontent.com falla con archivos privados).
 *
 * @param {string} templateId  - ID de la plantilla en Drive
 * @param {string[]} fotoDriveIds - IDs de Drive de las fotos de evidencia
 * @param {string|null} logoDriveId - ID de Drive del logo de la empresa (o null)
 * @param {string} infoText    - Texto de información del curso
 * @param {string} nombrePdf   - Nombre de la presentación de salida
 * @param {string} carpetaDestinoId - ID de la carpeta destino en Drive
 */
async function generarInformeFotograficoSlides(templateId, fotoDriveIds, logoDriveId, infoText, nombrePdf, carpetaDestinoId) {
    let copiaId = null;
    const tempImageFileIds = [];

    const limpiarImagenesTemporales = () => {
        for (const tempId of tempImageFileIds) {
            drive.files.delete({ fileId: tempId }).catch(() => {});
        }
    };

    const resolverImagenSlides = async (driveFileId, etiqueta) => {
        const fileId = String(driveFileId || '').trim();
        if (!fileId) return null;

        const resolved = await resolverUrlImagenParaSlides(fileId, etiqueta);
        if (!resolved?.url) {
            throw new Error(`No se pudo publicar la imagen ${etiqueta} para Google Slides.`);
        }
        if (resolved.tempFileId) {
            tempImageFileIds.push(resolved.tempFileId);
        }
        return resolved.url;
    };

    try {
        if (!slides) throw new Error('Google Slides API no inicializada');

        const idsFotos = (Array.isArray(fotoDriveIds) ? fotoDriveIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean);
        if (!idsFotos.length) {
            throw new Error('No hay fotos de evidencia válidas para el informe fotográfico.');
        }

        const fotoUrls = [];
        for (let i = 0; i < idsFotos.length; i++) {
            const url = await resolverImagenSlides(idsFotos[i], `foto_${i + 1}`);
            fotoUrls.push(url);
        }

        let logoUrl = null;
        const logoId = String(logoDriveId || '').trim();
        if (logoId) {
            try {
                logoUrl = await resolverImagenSlides(logoId, 'logo');
            } catch (logoErr) {
                console.warn(`[WARN] Logo no disponible para informe fotográfico: ${logoErr.message}`);
                logoUrl = null;
            }
        }

        console.log(`[INFO] Imágenes listas para Informe Fotográfico: ${fotoUrls.length} foto(s), logo: ${logoUrl ? 'sí' : 'no'}`);

        // 1. Copiar la plantilla (si es PowerPoint, se convierte automáticamente a Google Slides)
        const copia = await drive.files.copy({
            fileId: templateId,
            requestBody: {
                name: `tmp_informe_foto_${Date.now()}`,
                mimeType: 'application/vnd.google-apps.presentation' // Fuerza conversión a Google Slides
            }
        });
        copiaId = copia.data.id;

        // 2. Leer la presentación para entender la estructura de la primera diapositiva
        const pres = await slides.presentations.get({ presentationId: copiaId });
        const slidesData = pres.data.slides || [];
        if (slidesData.length === 0) throw new Error('La plantilla no tiene diapositivas');

        const templateSlide = slidesData[0];
        const templateSlideId = templateSlide.objectId;

        // Identificar los placeholders por su contenido de texto
        const findShapesByText = (slide, searchText) => {
            const results = [];
            for (const el of (slide.pageElements || [])) {
                if (!el.shape?.text?.textElements) continue;
                const fullText = el.shape.text.textElements.map(te => te.textRun?.content || '').join('').trim();
                if (fullText.toLowerCase().includes(searchText.toLowerCase())) {
                    results.push(el);
                }
            }
            return results;
        };

        // Clasificar los 2 placeholders de imagen por posición:
        // Superior izquierda (X+Y más bajo), Inferior derecha (X+Y más alto)
        const classifyImagePlaceholders = (shapes) => {
            if (shapes.length === 0) return { supIzq: null, infDer: null };

            const withPos = shapes.map(s => ({
                shape: s,
                x: s.transform?.translateX || 0,
                y: s.transform?.translateY || 0,
                sum: (s.transform?.translateX || 0) + (s.transform?.translateY || 0)
            }));

            // Sort by sum of X+Y: lowest = top-left, highest = bottom-right
            const sorted = [...withPos].sort((a, b) => a.sum - b.sum);

            if (sorted.length === 1) {
                // Solo una imagen, ponerla en supIzq
                return { supIzq: sorted[0].shape, infDer: null };
            }

            // 2+ shapes: el de menor sum es supIzq, el de mayor sum es infDer
            return {
                supIzq: sorted[0].shape,
                infDer: sorted[sorted.length - 1].shape
            };
        };

        // Determine how many slides we need (2 photos per slide)
        const FOTOS_POR_SLIDE = 2;
        const totalFotos = fotoUrls.length;
        const slidesNeeded = Math.max(1, Math.ceil(totalFotos / FOTOS_POR_SLIDE));

        // 3. If we need more than 1 slide, duplicate the template slide
        const slideObjectIds = [templateSlideId];
        if (slidesNeeded > 1) {
            for (let i = 1; i < slidesNeeded; i++) {
                const dupReq = await slides.presentations.batchUpdate({
                    presentationId: copiaId,
                    requestBody: {
                        requests: [{
                            duplicateObject: {
                                objectId: templateSlideId
                            }
                        }]
                    }
                });
                const reply = dupReq.data.replies?.[0]?.duplicateObject;
                if (reply?.objectId) {
                    slideObjectIds.push(reply.objectId);
                }
            }
        }

        // Re-read the presentation after duplications to get fresh element IDs
        const presUpdated = await slides.presentations.get({ presentationId: copiaId });
        const allSlides = presUpdated.data.slides || [];

        // 4. Build batch update requests for ALL slides
        // Z-order by creation order: supIzq first (back), then infDer (front/on top)
        const finalRequests = [];
        for (let slideIdx = 0; slideIdx < allSlides.length; slideIdx++) {
            const currentSlide = allSlides[slideIdx];
            const fotoOffset = slideIdx * FOTOS_POR_SLIDE;
            const fotosForSlide = fotoUrls.slice(fotoOffset, fotoOffset + FOTOS_POR_SLIDE);

            const curImageShapes = findShapesByText(currentSlide, 'Imagen');
            const curLogoShapes = findShapesByText(currentSlide, 'Logo');
            const curInfoShapes = findShapesByText(currentSlide, 'Información');
            const curPlaceholders = classifyImagePlaceholders(curImageShapes);

            // slots[0] = supIzq, slots[1] = infDer
            const slots = [
                { key: 'supIzq', placeholder: curPlaceholders.supIzq },
                { key: 'infDer', placeholder: curPlaceholders.infDer }
            ];

            // Delete ALL image placeholders first
            for (let i = 0; i < slots.length; i++) {
                if (slots[i].placeholder) {
                    finalRequests.push({ deleteObject: { objectId: slots[i].placeholder.objectId } });
                }
            }

            // Create images in z-order: supIzq first (back), then infDer (front/on top)
            // Index 0 = supIzq, Index 1 = infDer
            const zOrder = [0, 1]; // supIzq primero (atrás), infDer después (encima)
            for (const idx of zOrder) {
                const slot = slots[idx];
                if (idx >= fotosForSlide.length) continue;
                if (!slot.placeholder) continue;

                const ph = slot.placeholder;
                const transform = ph.transform || {};
                const size = ph.size || {};
                const sX = transform.scaleX || 1;
                const sY = transform.scaleY || 1;
                // Usar 100% del placeholder - el usuario controla la proporción en la plantilla PowerPoint
                const w = (size.width?.magnitude || 3000000) * Math.abs(sX);
                const h = (size.height?.magnitude || 2000000) * Math.abs(sY);

                finalRequests.push({
                    createImage: {
                        url: fotosForSlide[idx],
                        elementProperties: {
                            pageObjectId: currentSlide.objectId,
                            size: {
                                width: { magnitude: w, unit: 'EMU' },
                                height: { magnitude: h, unit: 'EMU' }
                            },
                            transform: {
                                scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                                translateX: transform.translateX || 0,
                                translateY: transform.translateY || 0,
                                unit: 'EMU'
                            }
                        }
                    }
                });
            }

            // Logo - usar 100% del placeholder (el usuario controla tamaño en la plantilla)
            if (curLogoShapes.length > 0) {
                const logoShape = curLogoShapes[0];
                if (logoUrl) {
                    const lt = logoShape.transform || {};
                    const ls = logoShape.size || {};
                    const lsX = lt.scaleX || 1;
                    const lsY = lt.scaleY || 1;
                    const lw = (ls.width?.magnitude || 1500000) * Math.abs(lsX);
                    const lh = (ls.height?.magnitude || 1500000) * Math.abs(lsY);

                    finalRequests.push({ deleteObject: { objectId: logoShape.objectId } });
                    finalRequests.push({
                        createImage: {
                            url: logoUrl,
                            elementProperties: {
                                pageObjectId: currentSlide.objectId,
                                size: {
                                    width: { magnitude: lw, unit: 'EMU' },
                                    height: { magnitude: lh, unit: 'EMU' }
                                },
                                transform: {
                                    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
                                    translateX: lt.translateX || 0,
                                    translateY: lt.translateY || 0,
                                    unit: 'EMU'
                                }
                            }
                        }
                    });
                } else {
                    finalRequests.push({ deleteObject: { objectId: logoShape.objectId } });
                }
            }

            // Información
            if (curInfoShapes.length > 0) {
                const infoShape = curInfoShapes[0];
                finalRequests.push({
                    deleteText: {
                        objectId: infoShape.objectId,
                        textRange: { type: 'ALL' }
                    }
                });
                finalRequests.push({
                    insertText: {
                        objectId: infoShape.objectId,
                        insertionIndex: 0,
                        text: infoText
                    }
                });
                finalRequests.push({
                    updateTextStyle: {
                        objectId: infoShape.objectId,
                        textRange: { type: 'ALL' },
                        style: {
                            bold: true,
                            fontSize: { magnitude: 14, unit: 'PT' },
                            foregroundColor: {
                                opaqueColor: { rgbColor: { red: 0.1, green: 0.1, blue: 0.1 } }
                            }
                        },
                        fields: 'bold,fontSize,foregroundColor'
                    }
                });
            }
        }

        // 5. Execute all batch requests
        if (finalRequests.length > 0) {
            await slides.presentations.batchUpdate({
                presentationId: copiaId,
                requestBody: { requests: finalRequests }
            });
        }

        // 6. Move presentation to destination folder and rename
        await drive.files.update({
            fileId: copiaId,
            addParents: carpetaDestinoId,
            removeParents: 'root',
            requestBody: { name: nombrePdf },
            fields: 'id, webViewLink'
        });

        // 7. Set public permissions on the presentation
        try {
            await drive.permissions.create({
                fileId: copiaId,
                requestBody: { role: 'reader', type: 'anyone' }
            });
        } catch (permErr) {
            console.warn(`[WARN] No se pudo asignar permiso público al informe fotográfico: ${permErr.message}`);
        }

        // 8. Get the presentation link
        const presentationInfo = await drive.files.get({
            fileId: copiaId,
            fields: 'id, webViewLink'
        });

        return { success: true, fileId: copiaId, webViewLink: presentationInfo.data.webViewLink };
    } catch (error) {
        console.error(`[ERROR] generarInformeFotograficoSlides: ${error.message}`);
        if (copiaId) {
            drive.files.delete({ fileId: copiaId }).catch(() => {});
        }
        return { success: false, error: error.message };
    } finally {
        limpiarImagenesTemporales();
    }

}

// REPORTE DE SALUD — Google Slides
// Crea presentación 16:9 con portada, 7 slides de contenido
// y slide de recomendaciones. Devuelve URL editable.
// =====================================================

/**
 * Sube una imagen base64 a Drive y la hace pública para que Slides la pueda usar.
 * Devuelve la URL pública directa de la imagen.
 */
async function subirImagenTemporal(base64Data, nombre, carpetaId) {
    // base64Data viene como "data:image/png;base64,XXXX"
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) throw new Error('Formato base64 inválido');
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    const response = await drive.files.create({
        requestBody: { name: nombre, parents: carpetaId ? [carpetaId] : [] },
        media: { mimeType, body: require('stream').Readable.from(buffer) },
        fields: 'id'
    });

    const fileId = response.data.id;

    // Hacer público para que Slides lo pueda referenciar
    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' }
    });

    // URL pública accesible por Google Slides API
    // lh3.googleusercontent.com puede tener delays de propagación;
    // drive.google.com/uc es más confiable para archivos recién subidos
    return { fileId, url: `https://drive.google.com/uc?id=${fileId}&export=download` };
}

/**
 * Genera un reporte de salud completo en Google Slides.
 *
 * @param {Object} datos - Datos del reporte
 * @param {string} datos.titulo - Título del reporte (puede tener \n para 2 líneas)
 * @param {string} datos.empresaNombre - Nombre de la empresa
 * @param {string} [datos.nombreCliente] - Nombre del cliente para el archivo final
 * @param {number} datos.anio - Año del reporte
 * @param {Object} datos.textos - Diccionario de textos editables por slide
 * @param {string[]} datos.chartImages - Array de 7 imágenes base64 de gráficas
 * @param {string} [datos.bizLogoBase64] - Logo Biznaga en base64
 * @param {string} [datos.empLogoBase64] - Logo empresa en base64
 * @returns {{ success: boolean, presentationId: string, url: string }}
 */
async function generarReporteSaludSlides(datos) {
    if (!slides) throw new Error('Google Slides API no inicializada');

    const { titulo, empresaNombre, nombreCliente, anio, textos, chartImages, bizLogoBase64, empLogoBase64, empLogoDriveRaw } = datos;
    const fechaActual = new Date();
    const dia = String(fechaActual.getDate()).padStart(2, '0');
    const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
    const anioCorto = String(fechaActual.getFullYear()).slice(-2);
    const fechaFormatoCorto = `${dia}-${mes}-${anioCorto}`;
    const clienteReporte = String(nombreCliente || empresaNombre || '').trim() || 'Cliente';
    const nombreReporte = `Reporte Plan de Salud - ${clienteReporte} - ${fechaFormatoCorto}`;

    const carpetaExpedientesEmpresaId = await obtenerCarpetaExpedientesEmpresa(empresaNombre);

    // ── Constantes de diseño (EMU: 1 inch = 914400 EMU) ──
    const EMU = 914400;
    const SLIDE_W = 10 * EMU;    // 10 in (16:9)
    const SLIDE_H = 5.625 * EMU; // 5.625 in

    const ACCENT = { red: 0.22, green: 0.318, blue: 0.184 }; // #38512F
    const DARK = { red: 0.102, green: 0.102, blue: 0.180 };   // #1a1a2e
    const RED = { red: 0.8, green: 0.2, blue: 0.2 };          // #CC3333
    const GRAY = { red: 0.4, green: 0.4, blue: 0.4 };         // #666666
    const TEXT_COLOR = { red: 0.2, green: 0.2, blue: 0.2 };    // #333333
    const WHITE = { red: 1, green: 1, blue: 1 };
    const LIGHT_GRAY = { red: 0.8, green: 0.8, blue: 0.8 };   // #cccccc

    // ── Resolver empLogoBase64: si el frontend no pudo convertirlo, descargar directo de Drive ──
    let empLogoBase64Final = empLogoBase64 || null;
    if (!empLogoBase64Final && empLogoDriveRaw) {
        try {
            const raw = String(empLogoDriveRaw).trim();
            let driveId = '';
            if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) {
                driveId = raw;
            } else {
                const byId = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                const byPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
                driveId = (byId && byId[1]) || (byPath && byPath[1]) || '';
            }
            if (driveId) {
                const buffer = await descargarArchivo(driveId);
                if (buffer && buffer.length > 0) {
                    // Detectar mime type
                    let mimeType = 'image/png';
                    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
                        mimeType = 'image/jpeg';
                    }
                    empLogoBase64Final = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`[INFO] Logo empresa descargado directo de Drive (${driveId}, ${buffer.length} bytes)`);
                }
            }
        } catch (err) {
            console.warn('[WARN] No se pudo descargar logo empresa desde Drive:', err.message);
        }
    }

    // ── Subir imágenes temporales a Drive ──
    const tempFileIds = [];
    let bizLogoUrl = null, empLogoUrl = null;
    const chartUrls = [];

    // Crear carpeta temporal
    let tmpFolderId = null;
    try {
        const tmpFolder = await drive.files.create({
            requestBody: {
                name: `_tmp_reporte_salud_${Date.now()}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: ROOT_FOLDER_ID ? [ROOT_FOLDER_ID] : []
            },
            fields: 'id'
        });
        tmpFolderId = tmpFolder.data.id;
    } catch (err) {
        console.warn('[WARN] No se pudo crear carpeta temporal:', err.message);
    }

    if (bizLogoBase64) {
        try {
            const r = await subirImagenTemporal(bizLogoBase64, 'biz_logo.png', tmpFolderId);
            bizLogoUrl = r.url;
            tempFileIds.push(r.fileId);
        } catch (err) { console.warn('[WARN] No se pudo subir logo Biznaga:', err.message); }
    }
    if (empLogoBase64Final) {
        try {
            const r = await subirImagenTemporal(empLogoBase64Final, 'emp_logo.png', tmpFolderId);
            empLogoUrl = r.url;
            tempFileIds.push(r.fileId);
        } catch (err) { console.warn('[WARN] No se pudo subir logo empresa:', err.message); }
    }
    for (let i = 0; i < (chartImages || []).length; i++) {
        if (chartImages[i]) {
            try {
                const r = await subirImagenTemporal(chartImages[i], `chart_${i}.png`, tmpFolderId);
                chartUrls.push(r.url);
                tempFileIds.push(r.fileId);
            } catch (err) {
                console.warn(`[WARN] No se pudo subir gráfica ${i}:`, err.message);
                chartUrls.push(null);
            }
        } else {
            chartUrls.push(null);
        }
    }

    // ── 1. Crear presentación en blanco ──
    const presentation = await slides.presentations.create({
        requestBody: {
            title: nombreReporte,
            pageSize: {
                width: { magnitude: SLIDE_W, unit: 'EMU' },
                height: { magnitude: SLIDE_H, unit: 'EMU' }
            }
        }
    });
    const presentationId = presentation.data.presentationId;

    // La primera slide se crea automáticamente — la usaremos como portada
    const firstSlideId = presentation.data.slides[0].objectId;

    // ── IDs para los elementos ──
    const genId = (prefix, idx) => `${prefix}_${idx}_${Date.now().toString(36)}`;

    // ── 2. Construir requests de batchUpdate ──
    const requests = [];

    // --- Eliminar elementos predeterminados de la primera slide ---
    const defaultElements = presentation.data.slides[0].pageElements || [];
    for (const el of defaultElements) {
        requests.push({ deleteObject: { objectId: el.objectId } });
    }

    // --- PORTADA (slide 0 / firstSlideId) ---
    // Fondo blanco
    requests.push({
        updatePageProperties: {
            objectId: firstSlideId,
            pageProperties: {
                pageBackgroundFill: { solidFill: { color: { rgbColor: WHITE } } }
            },
            fields: 'pageBackgroundFill'
        }
    });

    // Barra verde superior
    const portBarId = genId('port_bar', 0);
    requests.push({
        createShape: {
            objectId: portBarId,
            shapeType: 'RECTANGLE',
            elementProperties: {
                pageObjectId: firstSlideId,
                size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.06 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' }
            }
        }
    });
    requests.push({
        updateShapeProperties: {
            objectId: portBarId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: ACCENT } } }, outline: { propertyState: 'NOT_RENDERED' } },
            fields: 'shapeBackgroundFill,outline'
        }
    });

    // Logo Biznaga (izquierda)
    if (bizLogoUrl) {
        const bizLogoId = genId('port_biz', 0);
        requests.push({
            createImage: {
                objectId: bizLogoId,
                url: bizLogoUrl,
                elementProperties: {
                    pageObjectId: firstSlideId,
                    size: { width: { magnitude: 2.35 * EMU, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.12 * EMU, translateY: 0.08 * EMU, unit: 'EMU' }
                }
            }
        });
    }

    // Logo empresa (derecha)
    if (empLogoUrl) {
        const empLogoId = genId('port_emp', 0);
        const empW = 1.378 * EMU;
        requests.push({
            createImage: {
                objectId: empLogoId,
                url: empLogoUrl,
                elementProperties: {
                    pageObjectId: firstSlideId,
                    size: { width: { magnitude: empW, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: (10 - 1.378 - 0.12) * EMU, translateY: 0.08 * EMU, unit: 'EMU' }
                }
            }
        });
    }

    // Título línea 1
    const titulos = (titulo || '').split('\n');
    const portTitle1Id = genId('port_t1', 0);
    requests.push({
        createShape: {
            objectId: portTitle1Id,
            shapeType: 'TEXT_BOX',
            elementProperties: {
                pageObjectId: firstSlideId,
                size: { width: { magnitude: 9 * EMU, unit: 'EMU' }, height: { magnitude: 0.75 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0.5 * EMU, translateY: 1.2 * EMU, unit: 'EMU' }
            }
        }
    });
    requests.push({
        insertText: { objectId: portTitle1Id, text: titulos[0] || '', insertionIndex: 0 }
    });
    requests.push({
        updateTextStyle: {
            objectId: portTitle1Id,
            style: { fontSize: { magnitude: 24, unit: 'PT' }, bold: true, foregroundColor: { opaqueColor: { rgbColor: ACCENT } }, fontFamily: 'Verdana' },
            textRange: { type: 'ALL' },
            fields: 'fontSize,bold,foregroundColor,fontFamily'
        }
    });
    requests.push({
        updateParagraphStyle: {
            objectId: portTitle1Id,
            style: { alignment: 'CENTER' },
            textRange: { type: 'ALL' },
            fields: 'alignment'
        }
    });

    // Título línea 2
    if (titulos[1]) {
        const portTitle2Id = genId('port_t2', 0);
        requests.push({
            createShape: {
                objectId: portTitle2Id,
                shapeType: 'TEXT_BOX',
                elementProperties: {
                    pageObjectId: firstSlideId,
                    size: { width: { magnitude: 9 * EMU, unit: 'EMU' }, height: { magnitude: 0.75 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.5 * EMU, translateY: 1.85 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({
            insertText: { objectId: portTitle2Id, text: titulos[1], insertionIndex: 0 }
        });
        requests.push({
            updateTextStyle: {
                objectId: portTitle2Id,
                style: { fontSize: { magnitude: 24, unit: 'PT' }, bold: true, foregroundColor: { opaqueColor: { rgbColor: ACCENT } }, fontFamily: 'Verdana' },
                textRange: { type: 'ALL' },
                fields: 'fontSize,bold,foregroundColor,fontFamily'
            }
        });
        requests.push({
            updateParagraphStyle: {
                objectId: portTitle2Id,
                style: { alignment: 'CENTER' },
                textRange: { type: 'ALL' },
                fields: 'alignment'
            }
        });
    }

    // Texto intro
    const introText = textos['portada_intro'] || '';
    if (introText) {
        const introId = genId('port_intro', 0);
        requests.push({
            createShape: {
                objectId: introId,
                shapeType: 'TEXT_BOX',
                elementProperties: {
                    pageObjectId: firstSlideId,
                    size: { width: { magnitude: 8.4 * EMU, unit: 'EMU' }, height: { magnitude: 0.8 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.8 * EMU, translateY: 3.0 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({ insertText: { objectId: introId, text: introText, insertionIndex: 0 } });
        requests.push({
            updateTextStyle: {
                objectId: introId,
                style: { fontSize: { magnitude: 10, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: TEXT_COLOR } } },
                textRange: { type: 'ALL' },
                fields: 'fontSize,foregroundColor'
            }
        });
    }

    // Bullets
    const bullets = [textos['portada_bullet1'], textos['portada_bullet2'], textos['portada_bullet3'], textos['portada_bullet4']].filter(Boolean);
    if (bullets.length > 0) {
        const bulletsId = genId('port_bullets', 0);
        const bulletText = bullets.map(b => `◆  ${b}`).join('\n');
        requests.push({
            createShape: {
                objectId: bulletsId,
                shapeType: 'TEXT_BOX',
                elementProperties: {
                    pageObjectId: firstSlideId,
                    size: { width: { magnitude: 8 * EMU, unit: 'EMU' }, height: { magnitude: 1.55 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 1.0 * EMU, translateY: 3.6 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({ insertText: { objectId: bulletsId, text: bulletText, insertionIndex: 0 } });
        requests.push({
            updateTextStyle: {
                objectId: bulletsId,
                style: { fontSize: { magnitude: 9.5, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: TEXT_COLOR } } },
                textRange: { type: 'ALL' },
                fields: 'fontSize,foregroundColor'
            }
        });
    }

    // ── SLIDES DE CONTENIDO (7 slides) ──
    const sections = [
        { titulo: 'GRUPOS DE EDAD', key: 'edad_texto', chartIdx: 0 },
        { titulo: 'SEXO', key: 'genero_texto', chartIdx: 1 },
        { titulo: 'ESTADO NUTRICIONAL', key: 'imc_texto', chartIdx: 2 },
        { titulo: 'CIFRAS TENSIONALES', key: 'ta_texto', chartIdx: 3 },
        { titulo: 'ADICCIONES', key: 'adicciones_texto', chartIdx: 4 },
        { titulo: 'ESTUDIOS PARACLÍNICOS', key: 'paraclinicos_texto', chartIdx: 5 },
        { titulo: 'OTRAS PATOLOGÍAS', key: 'patologias_texto', chartIdx: 6 },
        { titulo: 'ANTECEDENTES HEREDO-FAMILIARES', key: 'heredo_familiares_texto', chartIdx: 7 },
        { titulo: 'ÓRGANOS Y SISTEMAS', key: 'organos_sistemas_texto', chartIdx: 8 },
    ];

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const slideId = genId('content', i);

        // Crear slide
        requests.push({ createSlide: { objectId: slideId, insertionIndex: i + 1 } });

        // Fondo blanco
        requests.push({
            updatePageProperties: {
                objectId: slideId,
                pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: WHITE } } } },
                fields: 'pageBackgroundFill'
            }
        });

        // Barra verde superior
        const topBarId = genId('topbar', i);
        requests.push({
            createShape: {
                objectId: topBarId,
                shapeType: 'RECTANGLE',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.06 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' }
                }
            }
        });
        requests.push({
            updateShapeProperties: {
                objectId: topBarId,
                shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: ACCENT } } }, outline: { propertyState: 'NOT_RENDERED' } },
                fields: 'shapeBackgroundFill,outline'
            }
        });

        // Logo Biznaga (izquierda)
        if (bizLogoUrl) {
            requests.push({
                createImage: {
                    objectId: genId('biz', i),
                    url: bizLogoUrl,
                    elementProperties: {
                        pageObjectId: slideId,
                        size: { width: { magnitude: 2.35 * EMU, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                        transform: { scaleX: 1, scaleY: 1, translateX: 0.2 * EMU, translateY: 0.1 * EMU, unit: 'EMU' }
                    }
                }
            });
        }

        // Logo empresa (derecha)
        if (empLogoUrl) {
            requests.push({
                createImage: {
                    objectId: genId('emp', i),
                    url: empLogoUrl,
                    elementProperties: {
                        pageObjectId: slideId,
                        size: { width: { magnitude: 1.378 * EMU, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                        transform: { scaleX: 1, scaleY: 1, translateX: (10 - 1.378 - 0.2) * EMU, translateY: 0.1 * EMU, unit: 'EMU' }
                    }
                }
            });
        }

        // Nombre empresa (si no hay logo)
        if (empresaNombre && !empLogoUrl) {
            const empNameId = genId('empname', i);
            requests.push({
                createShape: {
                    objectId: empNameId,
                    shapeType: 'TEXT_BOX',
                    elementProperties: {
                        pageObjectId: slideId,
                        size: { width: { magnitude: 2.5 * EMU, unit: 'EMU' }, height: { magnitude: 0.3 * EMU, unit: 'EMU' } },
                        transform: { scaleX: 1, scaleY: 1, translateX: 7.2 * EMU, translateY: 0.2 * EMU, unit: 'EMU' }
                    }
                }
            });
            requests.push({ insertText: { objectId: empNameId, text: empresaNombre, insertionIndex: 0 } });
            requests.push({
                updateTextStyle: {
                    objectId: empNameId,
                    style: { fontSize: { magnitude: 7, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: GRAY } } },
                    textRange: { type: 'ALL' },
                    fields: 'fontSize,foregroundColor'
                }
            });
            requests.push({
                updateParagraphStyle: {
                    objectId: empNameId,
                    style: { alignment: 'END' },
                    textRange: { type: 'ALL' },
                    fields: 'alignment'
                }
            });
        }

        // Barra roja de acento
        const redBarId = genId('redbar', i);
        requests.push({
            createShape: {
                objectId: redBarId,
                shapeType: 'RECTANGLE',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: 0.4 * EMU, unit: 'EMU' }, height: { magnitude: 0.06 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 0.78 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({
            updateShapeProperties: {
                objectId: redBarId,
                shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: RED } } }, outline: { propertyState: 'NOT_RENDERED' } },
                fields: 'shapeBackgroundFill,outline'
            }
        });

        // Título de sección
        const secTitleId = genId('sectitle', i);
        requests.push({
            createShape: {
                objectId: secTitleId,
                shapeType: 'TEXT_BOX',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: 9 * EMU, unit: 'EMU' }, height: { magnitude: 0.5 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 0.9 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({ insertText: { objectId: secTitleId, text: sec.titulo, insertionIndex: 0 } });
        requests.push({
            updateTextStyle: {
                objectId: secTitleId,
                style: { fontSize: { magnitude: 18, unit: 'PT' }, bold: true, foregroundColor: { opaqueColor: { rgbColor: DARK } } },
                textRange: { type: 'ALL' },
                fields: 'fontSize,bold,foregroundColor'
            }
        });

        // Línea divisora
        const divId = genId('div', i);
        requests.push({
            createLine: {
                objectId: divId,
                lineCategory: 'STRAIGHT',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: 2.5 * EMU, unit: 'EMU' }, height: { magnitude: 0, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 1.55 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({
            updateLineProperties: {
                objectId: divId,
                lineProperties: { lineFill: { solidFill: { color: { rgbColor: LIGHT_GRAY } } }, weight: { magnitude: 0.8, unit: 'PT' } },
                fields: 'lineFill,weight'
            }
        });

        // Texto (columna izquierda)
        const txt = textos[sec.key] || '';
        if (txt) {
            const txtId = genId('txt', i);
            requests.push({
                createShape: {
                    objectId: txtId,
                    shapeType: 'TEXT_BOX',
                    elementProperties: {
                        pageObjectId: slideId,
                        size: { width: { magnitude: 4.3 * EMU, unit: 'EMU' }, height: { magnitude: 3.5 * EMU, unit: 'EMU' } },
                        transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 1.65 * EMU, unit: 'EMU' }
                    }
                }
            });
            requests.push({ insertText: { objectId: txtId, text: txt, insertionIndex: 0 } });
            requests.push({
                updateTextStyle: {
                    objectId: txtId,
                    style: { fontSize: { magnitude: 10, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: TEXT_COLOR } } },
                    textRange: { type: 'ALL' },
                    fields: 'fontSize,foregroundColor'
                }
            });
        }

        // Gráfica (columna derecha)
        const chartUrl = chartUrls[sec.chartIdx];
        if (chartUrl) {
            requests.push({
                createImage: {
                    objectId: genId('chart', i),
                    url: chartUrl,
                    elementProperties: {
                        pageObjectId: slideId,
                        size: { width: { magnitude: 4.9 * EMU, unit: 'EMU' }, height: { magnitude: 4.1 * EMU, unit: 'EMU' } },
                        transform: { scaleX: 1, scaleY: 1, translateX: 4.8 * EMU, translateY: 1.0 * EMU, unit: 'EMU' }
                    }
                }
            });
        }

        // Barra verde inferior (footer)
        const footBarId = genId('footbar', i);
        requests.push({
            createShape: {
                objectId: footBarId,
                shapeType: 'RECTANGLE',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.15 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 5.35 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({
            updateShapeProperties: {
                objectId: footBarId,
                shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: ACCENT } } }, outline: { propertyState: 'NOT_RENDERED' } },
                fields: 'shapeBackgroundFill,outline'
            }
        });

        // Línea oscura sobre footer
        const footLineId = genId('footline', i);
        requests.push({
            createShape: {
                objectId: footLineId,
                shapeType: 'RECTANGLE',
                elementProperties: {
                    pageObjectId: slideId,
                    size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.015 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 5.35 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({
            updateShapeProperties: {
                objectId: footLineId,
                shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: DARK } } }, outline: { propertyState: 'NOT_RENDERED' } },
                fields: 'shapeBackgroundFill,outline'
            }
        });
    }

    // ── SLIDE DE RECOMENDACIONES ──
    const recSlideId = genId('rec', 0);
      requests.push({ createSlide: { objectId: recSlideId, insertionIndex: sections.length + 1 } });
    requests.push({
        updatePageProperties: {
            objectId: recSlideId,
            pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: WHITE } } } },
            fields: 'pageBackgroundFill'
        }
    });

    // Header (barra + logos)
    const recTopBarId = genId('rec_topbar', 0);
    requests.push({
        createShape: {
            objectId: recTopBarId,
            shapeType: 'RECTANGLE',
            elementProperties: {
                pageObjectId: recSlideId,
                size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.06 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' }
            }
        }
    });
    requests.push({
        updateShapeProperties: {
            objectId: recTopBarId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: ACCENT } } }, outline: { propertyState: 'NOT_RENDERED' } },
            fields: 'shapeBackgroundFill,outline'
        }
    });

    if (bizLogoUrl) {
        requests.push({
            createImage: {
                objectId: genId('rec_biz', 0),
                url: bizLogoUrl,
                elementProperties: {
                    pageObjectId: recSlideId,
                    size: { width: { magnitude: 2.35 * EMU, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.2 * EMU, translateY: 0.1 * EMU, unit: 'EMU' }
                }
            }
        });
    }
    if (empLogoUrl) {
        requests.push({
            createImage: {
                objectId: genId('rec_emp', 0),
                url: empLogoUrl,
                elementProperties: {
                    pageObjectId: recSlideId,
                    size: { width: { magnitude: 1.378 * EMU, unit: 'EMU' }, height: { magnitude: 0.669 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: (10 - 1.378 - 0.2) * EMU, translateY: 0.1 * EMU, unit: 'EMU' }
                }
            }
        });
    }

    // Barra roja
    const recRedBarId = genId('rec_redbar', 0);
    requests.push({
        createShape: {
            objectId: recRedBarId,
            shapeType: 'RECTANGLE',
            elementProperties: {
                pageObjectId: recSlideId,
                size: { width: { magnitude: 0.4 * EMU, unit: 'EMU' }, height: { magnitude: 0.06 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 0.78 * EMU, unit: 'EMU' }
            }
        }
    });
    requests.push({
        updateShapeProperties: {
            objectId: recRedBarId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: RED } } }, outline: { propertyState: 'NOT_RENDERED' } },
            fields: 'shapeBackgroundFill,outline'
        }
    });

    // Título recomendaciones
    const recTitleId = genId('rec_title', 0);
    requests.push({
        createShape: {
            objectId: recTitleId,
            shapeType: 'TEXT_BOX',
            elementProperties: {
                pageObjectId: recSlideId,
                size: { width: { magnitude: 9 * EMU, unit: 'EMU' }, height: { magnitude: 0.5 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0.25 * EMU, translateY: 0.9 * EMU, unit: 'EMU' }
            }
        }
    });
    requests.push({ insertText: { objectId: recTitleId, text: 'RECOMENDACIONES PARA PLAN DE SALUD', insertionIndex: 0 } });
    requests.push({
        updateTextStyle: {
            objectId: recTitleId,
            style: { fontSize: { magnitude: 18, unit: 'PT' }, bold: true, foregroundColor: { opaqueColor: { rgbColor: DARK } } },
            textRange: { type: 'ALL' },
            fields: 'fontSize,bold,foregroundColor'
        }
    });

    // Texto de recomendaciones
    const recomendaciones = textos['recomendaciones'] || '';
    if (recomendaciones) {
        const recTextId = genId('rec_text', 0);
        requests.push({
            createShape: {
                objectId: recTextId,
                shapeType: 'TEXT_BOX',
                elementProperties: {
                    pageObjectId: recSlideId,
                    size: { width: { magnitude: 9.2 * EMU, unit: 'EMU' }, height: { magnitude: 3.7 * EMU, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 0.4 * EMU, translateY: 1.65 * EMU, unit: 'EMU' }
                }
            }
        });
        requests.push({ insertText: { objectId: recTextId, text: recomendaciones, insertionIndex: 0 } });
        requests.push({
            updateTextStyle: {
                objectId: recTextId,
                style: { fontSize: { magnitude: 10, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: DARK } } },
                textRange: { type: 'ALL' },
                fields: 'fontSize,foregroundColor'
            }
        });
    }

    // Footer recomendaciones
    const recFootBarId = genId('rec_footbar', 0);
    requests.push({
        createShape: {
            objectId: recFootBarId,
            shapeType: 'RECTANGLE',
            elementProperties: {
                pageObjectId: recSlideId,
                size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.15 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 5.35 * EMU, unit: 'EMU' }
            }
        }
    });
    requests.push({
        updateShapeProperties: {
            objectId: recFootBarId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: ACCENT } } }, outline: { propertyState: 'NOT_RENDERED' } },
            fields: 'shapeBackgroundFill,outline'
        }
    });

    const recFootLineId = genId('rec_footline', 0);
    requests.push({
        createShape: {
            objectId: recFootLineId,
            shapeType: 'RECTANGLE',
            elementProperties: {
                pageObjectId: recSlideId,
                size: { width: { magnitude: SLIDE_W, unit: 'EMU' }, height: { magnitude: 0.015 * EMU, unit: 'EMU' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 5.35 * EMU, unit: 'EMU' }
            }
        }
    });
    requests.push({
        updateShapeProperties: {
            objectId: recFootLineId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: DARK } } }, outline: { propertyState: 'NOT_RENDERED' } },
            fields: 'shapeBackgroundFill,outline'
        }
    });

    // ── 3. Ejecutar batchUpdate ──
    await slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests }
    });

    // ── 3.1 Mover presentación a Expedientes_medicos/{Empresa} ──
    try {
        await drive.files.update({
            fileId: presentationId,
            requestBody: { name: nombreReporte },
            fields: 'id, name'
        });

        await drive.files.update({
            fileId: presentationId,
            addParents: carpetaExpedientesEmpresaId,
            removeParents: 'root',
            fields: 'id, parents'
        });
    } catch (err) {
        console.warn('[WARN] No se pudo mover la presentación a carpeta de empresa:', err.message);
    }

    // ── 4. Hacer la presentación editable por cualquiera con el enlace ──
    // Nota: en algunos entornos este permiso puede tardar demasiado aunque el archivo ya exista.
    // Evitamos bloquear la respuesta al frontend indefinidamente.
    await Promise.race([
        drive.permissions.create({
            fileId: presentationId,
            requestBody: { role: 'writer', type: 'anyone' }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout al asignar permisos públicos de Slides')), 8000))
    ]).catch((err) => {
        console.warn('[WARN] No se pudo confirmar permisos públicos a tiempo:', err.message);
    });

    // ── 5. Limpiar imágenes temporales (fire-and-forget) ──
    if (tempFileIds.length > 0 || tmpFolderId) {
        Promise.resolve().then(async () => {
            for (const id of tempFileIds) {
                try {
                    await drive.files.delete({ fileId: id });
                } catch (err) {
                    console.warn(`[WARN] No se pudo eliminar archivo temporal ${id}:`, err.message);
                }
            }
            if (tmpFolderId) {
                await eliminarCarpetaYContenido(tmpFolderId);
            }
        }).catch((err) => {
            console.warn('[WARN] Error limpiando temporales de reporte de salud:', err.message);
        });
    }

    const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;
    console.log(`[INFO] Reporte de salud generado: ${url}`);

    return { success: true, presentationId, url };
}

/**
 * Genera el formato SP-F-03 (Control de entrega de documentos) a partir de una plantilla de Google Docs.
 * Flujo: copiar plantilla -> autollenar campos/tabla -> regresar metadata del documento generado.
 *
 * @param {object} params
 * @param {string} params.templateId - ID del documento plantilla en Google Drive
 * @param {string} params.nombreArchivo - Nombre deseado para el documento generado
 * @param {string} params.carpetaDestinoId - Carpeta destino en Drive
 * @param {object} params.datos - Datos para autollenado del formato
 * @returns {Promise<object>}
 */
async function generarControlEntregaDocumentosDesdeTemplate(params = {}) {
    const templateId = String(params.templateId || '').trim();
    const nombreArchivo = String(params.nombreArchivo || 'SP-F-03 Control de entrega de documentos').trim();
    const carpetaDestinoId = String(params.carpetaDestinoId || ROOT_FOLDER_ID).trim();
    const datos = params.datos || {};

    const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
    const OFFICE_DOC_MIMES = new Set([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
    ]);

    if (!templateId) {
        throw new Error('templateId es obligatorio para generar Control de entrega de documentos.');
    }

    const normalizarTexto = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const extraerTextoDeElementos = (elements = []) => {
        return (Array.isArray(elements) ? elements : [])
            .map((el) => String(el?.textRun?.content || ''))
            .join('');
    };

    const extraerTextoParrafo = (paragraph = null) => {
        if (!paragraph || !Array.isArray(paragraph.elements)) return '';
        return extraerTextoDeElementos(paragraph.elements);
    };

    const extraerTextoCelda = (cell = null) => {
        if (!cell || !Array.isArray(cell.content)) return '';
        return cell.content
            .map((element) => {
                if (element?.paragraph?.elements) {
                    return extraerTextoDeElementos(element.paragraph.elements);
                }
                return '';
            })
            .join('');
    };

    const obtenerRangoEditableCelda = (cell = null) => {
        if (!cell || !Array.isArray(cell.content) || cell.content.length === 0) return null;

        const startIndex = Number(cell.content?.[0]?.startIndex || 0);
        const endIndexRaw = Number(cell.content?.[cell.content.length - 1]?.endIndex || 0);
        const endIndex = endIndexRaw - 1;

        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || endIndex <= startIndex) {
            return null;
        }

        return { startIndex, endIndex };
    };

    const docsApi = google.docs({ version: 'v1', auth: _driveAuthClient });

    // 0) Resolver metadata de plantilla (incluye shortcut) y validar tipo compatible
    const templateMetaResp = await drive.files.get({
        fileId: templateId,
        fields: 'id,name,mimeType,shortcutDetails(targetId,targetMimeType)'
    });

    let templateSourceId = templateId;
    let templateSourceMimeType = String(templateMetaResp?.data?.mimeType || '').trim();

    if (templateSourceMimeType === 'application/vnd.google-apps.shortcut') {
        const targetId = String(templateMetaResp?.data?.shortcutDetails?.targetId || '').trim();
        const targetMimeType = String(templateMetaResp?.data?.shortcutDetails?.targetMimeType || '').trim();

        if (!targetId) {
            throw new Error('La plantilla configurada de Entrega de Documentos es un acceso directo inválido.');
        }

        templateSourceId = targetId;
        templateSourceMimeType = targetMimeType;
    }

    const esGoogleDoc = templateSourceMimeType === GOOGLE_DOC_MIME;
    const esOfficeConvertible = OFFICE_DOC_MIMES.has(templateSourceMimeType);

    if (!esGoogleDoc && !esOfficeConvertible) {
        throw new Error(
            `La plantilla SP-F-03 no es compatible para autollenado. Tipo detectado: ${templateSourceMimeType || 'desconocido'}. ` +
            'Usa un Google Doc nativo o un archivo Word (.doc/.docx).'
        );
    }

    // 1) Copiar plantilla al destino
    const copyRequestBody = {
        name: nombreArchivo,
        parents: [carpetaDestinoId]
    };

    // Si la plantilla viene en Word, forzar conversión a Google Docs al copiar.
    if (!esGoogleDoc) {
        copyRequestBody.mimeType = GOOGLE_DOC_MIME;
    }

    const copyResp = await drive.files.copy({
        fileId: templateSourceId,
        requestBody: copyRequestBody,
        fields: 'id,name,webViewLink,webContentLink,mimeType'
    });

    const documentId = copyResp?.data?.id;
    if (!documentId) {
        throw new Error('No se pudo obtener el ID del documento generado a partir de la plantilla.');
    }

    const generatedMimeType = String(copyResp?.data?.mimeType || '').trim();
    if (generatedMimeType !== GOOGLE_DOC_MIME) {
        throw new Error(
            `No se pudo crear un Google Doc editable desde la plantilla SP-F-03 (tipo generado: ${generatedMimeType || 'desconocido'}). ` +
            'Verifica que la plantilla base sea Google Docs o Word.'
        );
    }

    // 2) Intentar dejar el documento visible por enlace
    try {
        await drive.permissions.create({
            fileId: documentId,
            requestBody: {
                role: 'writer',
                type: 'anyone',
                allowFileDiscovery: false
            }
        });
    } catch (permErr) {
        console.warn('[WARN] No se pudo asignar permiso por enlace al SP-F-03:', permErr?.message || permErr);
    }

    // 3) Leer estructura del documento para autollenado por índices
    let docResp;
    try {
        docResp = await docsApi.documents.get({ documentId });
    } catch (docsGetError) {
        const docsGetMsg = String(
            docsGetError?.response?.data?.error?.message ||
            docsGetError?.message ||
            'Error desconocido de Google Docs'
        );
        const docsGetLower = docsGetMsg.toLowerCase();

        if (
            docsGetLower.includes('operation is not supported for this document') ||
            docsGetLower.includes('failed_precondition')
        ) {
            throw new Error(
                'La plantilla SP-F-03 no quedó como Google Doc editable después de copiarse. ' +
                'Usa una plantilla Google Docs nativa o Word (.doc/.docx).'
            );
        }

        throw docsGetError;
    }
    const bodyContent = Array.isArray(docResp?.data?.body?.content) ? docResp.data.body.content : [];

    const campos = [
        {
            key: 'empresa',
            etiqueta: 'Nombre de la empresa:',
            valor: String(datos.nombreEmpresa || '').trim() || 'Pendiente',
            needles: ['nombre de la empresa']
        },
        {
            key: 'fecha',
            etiqueta: 'Fecha de entrega de documento(s):',
            valor: String(datos.fechaEntrega || '').trim() || 'Pendiente',
            needles: ['fecha de entrega de documento', 'fecha de entrega de documentos']
        },
        {
            key: 'persona',
            etiqueta: 'Nombre completo de la persona que entrega:',
            valor: String(datos.personaEntrega || '').trim() || 'Pendiente',
            needles: ['nombre completo de la persona que entrega']
        }
    ];

    const remplazos = [];
    const camposAplicados = new Set();

    // 3.1) Localizar líneas de encabezado para empresa/fecha/persona
    for (const element of bodyContent) {
        if (!element?.paragraph || !Number.isFinite(Number(element.startIndex)) || !Number.isFinite(Number(element.endIndex))) {
            continue;
        }

        const textoParrafo = extraerTextoParrafo(element.paragraph);
        const textoNormalizado = normalizarTexto(textoParrafo);
        if (!textoNormalizado) continue;

        const campo = campos.find((c) => !camposAplicados.has(c.key)
            && c.needles.some((needle) => textoNormalizado.includes(normalizarTexto(needle))));

        if (!campo) continue;

        const startIndex = Number(element.startIndex);
        const endIndex = Number(element.endIndex) - 1;
        if (endIndex <= startIndex) continue;

        remplazos.push({
            startIndex,
            endIndex,
            text: `${campo.etiqueta} ${campo.valor}`
        });
        camposAplicados.add(campo.key);
    }

    // 3.2) Localizar tabla de "DOCUMENTO(S) O MATERIAL (ES) ENTREGADOS" y llenar ítems 1 y 2
    const tablaObjetivo = bodyContent.find((element) => {
        if (!element?.table?.tableRows) return false;
        const rows = element.table.tableRows;
        for (const row of rows) {
            for (const cell of (row?.tableCells || [])) {
                const text = normalizarTexto(extraerTextoCelda(cell));
                if (text.includes('documento') && text.includes('material') && text.includes('entregados')) {
                    return true;
                }
            }
        }
        return false;
    });

    if (tablaObjetivo?.table?.tableRows?.length >= 3) {
        const items = [
            String(datos.item1 || 'Entrega de constancias').trim(),
            String(datos.item2 || 'Entrega de DC-3').trim()
        ];

        for (let idx = 0; idx < items.length; idx++) {
            const row = tablaObjetivo.table.tableRows[idx + 1]; // fila 0 = encabezado
            const celdas = row?.tableCells || [];
            const celdaDescripcion = celdas[1] || celdas[celdas.length - 1] || null;
            const rango = obtenerRangoEditableCelda(celdaDescripcion);
            if (!rango) continue;

            remplazos.push({
                startIndex: rango.startIndex,
                endIndex: rango.endIndex,
                text: items[idx]
            });
        }
    }

    // 4) Aplicar cambios en orden descendente para mantener índices válidos
    if (remplazos.length > 0) {
        const requests = [];
        const ordered = [...remplazos].sort((a, b) => b.startIndex - a.startIndex);

        for (const reemplazo of ordered) {
            requests.push({
                deleteContentRange: {
                    range: {
                        startIndex: reemplazo.startIndex,
                        endIndex: reemplazo.endIndex
                    }
                }
            });
            requests.push({
                insertText: {
                    location: { index: reemplazo.startIndex },
                    text: reemplazo.text
                }
            });
        }

        await docsApi.documents.batchUpdate({
            documentId,
            requestBody: { requests }
        });
    }

    // 5) Obtener metadata final para respuesta
    const finalInfo = await drive.files.get({
        fileId: documentId,
        fields: 'id,name,webViewLink,webContentLink,mimeType'
    });

    return {
        id: finalInfo?.data?.id || documentId,
        name: finalInfo?.data?.name || nombreArchivo,
        mimeType: finalInfo?.data?.mimeType || 'application/vnd.google-apps.document',
        webViewLink: finalInfo?.data?.webViewLink || `https://docs.google.com/document/d/${documentId}/edit`,
        webContentLink: finalInfo?.data?.webContentLink || null,
        editorUrl: `https://docs.google.com/document/d/${documentId}/edit`
    };
}

/**
 * EIN-F-04 Reporte de mantenimiento — copia plantilla y autollena con datos de la solicitud.
 * Plantilla: 1v7p3hSL-PhDYh7DsCM0vSprGTIiVcXAo
 * Carpeta: 1PSzlU-LIr4wkCZANDgDIchY6lASsPue8
 */
async function generarReporteMantenimientoEinF04(params = {}) {
    const templateId = String(params.templateId || process.env.EIN_F04_TEMPLATE_ID || '1v7p3hSL-PhDYh7DsCM0vSprGTIiVcXAo').trim();
    const carpetaDestinoId = String(
        params.carpetaDestinoId || process.env.EIN_F04_REPORTES_FOLDER_ID || '1q3COOqQEqbkZRPvHNz0l3mNZWn1TfXtx'
    ).trim();
    const carpetaArchiveroId = String(
        params.carpetaArchiveroId || process.env.EIN_F04_ARCHIVERO_FOLDER_ID || '1TPCTKPyeN9dMdh2_FijH1WhbsMIsp267'
    ).trim();
    const folio = String(params.folio || '').trim() || `EIFF02-${Date.now()}`;
    const descripcion = String(
        params.descripcionMantenimiento || params.descripcionMantenimientoRealizado || ''
    ).trim();
    const evidencias = Array.isArray(params.evidencias) ? params.evidencias : [];
    const tipo = String(params.tipoMantenimiento || 'Correctivo').trim() || 'Correctivo';
    const fechaSolicitud = String(params.fechaSolicitud || '').trim();
    const fechaRealizado = String(params.fechaRealizado || fechaSolicitud || '').trim();
    const responsable = String(params.responsable || params.nombreSolicitante || '').trim();
    const nombreArchivo = String(params.nombreArchivo || folio)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim()
        .slice(0, 180);
    const documentIdExistente = String(params.documentId || params.reporteDriveFileId || '').trim();

    const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
    const OFFICE_DOC_MIMES = new Set([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
    ]);

    const normalizarTexto = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const extraerTextoDeElementos = (elements = []) =>
        (Array.isArray(elements) ? elements : []).map((el) => String(el?.textRun?.content || '')).join('');

    const extraerTextoParrafo = (paragraph = null) => {
        if (!paragraph || !Array.isArray(paragraph.elements)) return '';
        return extraerTextoDeElementos(paragraph.elements);
    };

    if (!drive || !_driveAuthClient) {
        throw new Error('Google Drive no está autenticado.');
    }

    const docsApi = google.docs({ version: 'v1', auth: _driveAuthClient });

    const templateMetaResp = await drive.files.get({
        fileId: templateId,
        fields: 'id,name,mimeType,shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });

    let templateSourceId = templateId;
    let templateSourceMimeType = String(templateMetaResp?.data?.mimeType || '').trim();

    if (templateSourceMimeType === 'application/vnd.google-apps.shortcut') {
        const targetId = String(templateMetaResp?.data?.shortcutDetails?.targetId || '').trim();
        const targetMimeType = String(templateMetaResp?.data?.shortcutDetails?.targetMimeType || '').trim();
        if (!targetId) {
            throw new Error('La plantilla EIN-F-04 es un acceso directo inválido.');
        }
        templateSourceId = targetId;
        templateSourceMimeType = targetMimeType;
    }

    const esGoogleDoc = templateSourceMimeType === GOOGLE_DOC_MIME;
    const esOfficeConvertible = OFFICE_DOC_MIMES.has(templateSourceMimeType);
    if (!esGoogleDoc && !esOfficeConvertible) {
        throw new Error(
            `Plantilla EIN-F-04 incompatible (${templateSourceMimeType || 'desconocido'}). Usa Google Docs o Word.`
        );
    }

    const carpetaFolio = await obtenerOCrearCarpeta(folio, carpetaDestinoId);

    let documentId = documentIdExistente;
    let copyResp = null;
    let documentoNuevo = false;

    if (documentId) {
        try {
            const existente = await drive.files.get({
                fileId: documentId,
                fields: 'id,name,webViewLink,mimeType,trashed',
                supportsAllDrives: true
            });
            if (existente?.data?.trashed) {
                documentId = '';
            } else {
                copyResp = { data: existente.data };
            }
        } catch {
            documentId = '';
        }
    }

    if (!documentId) {
        const copyRequestBody = {
            name: nombreArchivo,
            parents: [carpetaFolio]
        };
        if (!esGoogleDoc) {
            copyRequestBody.mimeType = GOOGLE_DOC_MIME;
        }

        copyResp = await drive.files.copy({
            fileId: templateSourceId,
            requestBody: copyRequestBody,
            fields: 'id,name,webViewLink,mimeType',
            supportsAllDrives: true
        });

        documentId = copyResp?.data?.id;
        documentoNuevo = !!documentId;
    }

    if (!documentId) {
        throw new Error('No se pudo crear el documento EIN-F-04.');
    }

    try {
        await drive.permissions.create({
            fileId: documentId,
            requestBody: { role: 'writer', type: 'anyone', allowFileDiscovery: false },
            supportsAllDrives: true
        });
    } catch (permErr) {
        console.warn('[WARN] permiso enlace EIN-F-04:', permErr?.message || permErr);
    }

    if (documentoNuevo && carpetaArchiveroId && carpetaArchiveroId !== carpetaDestinoId) {
        try {
            const carpetaArchiveroFolio = await obtenerOCrearCarpeta(folio, carpetaArchiveroId);
            const archiveroCopia = await drive.files.copy({
                fileId: documentId,
                requestBody: {
                    name: nombreArchivo,
                    parents: [carpetaArchiveroFolio]
                },
                fields: 'id',
                supportsAllDrives: true
            });
            if (archiveroCopia?.data?.id) {
                try {
                    await drive.permissions.create({
                        fileId: archiveroCopia.data.id,
                        requestBody: { role: 'writer', type: 'anyone', allowFileDiscovery: false },
                        supportsAllDrives: true
                    });
                } catch (_) { /* ignore */ }
            }
        } catch (archErr) {
            console.warn('[WARN] copia archivero EIN-F-04:', archErr?.message || archErr);
        }
    }

    const extraerTextoCelda = (cell = null) => {
        if (!cell || !Array.isArray(cell.content)) return '';
        return cell.content
            .map((element) => {
                if (element?.paragraph?.elements) {
                    return extraerTextoDeElementos(element.paragraph.elements);
                }
                return '';
            })
            .join('');
    };

    const obtenerRangoEditableCelda = (cell = null) => {
        if (!cell || !Array.isArray(cell.content) || cell.content.length === 0) return null;
        const startIndex = Number(cell.content[0]?.startIndex || 0);
        const endIndexRaw = Number(cell.content[cell.content.length - 1]?.endIndex || 0);
        const endIndex = endIndexRaw - 1;
        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || endIndex <= startIndex) {
            return null;
        }
        return { startIndex, endIndex };
    };

    const buscarCeldaSeccion = (bodyContent, needles = [], preferirFilaSiguiente = true) => {
        const normalizedNeedles = needles.map((n) => normalizarTexto(n)).filter(Boolean);
        if (!normalizedNeedles.length) return null;

        for (const element of bodyContent) {
            if (!element?.table?.tableRows) continue;
            const rows = element.table.tableRows;
            for (let ri = 0; ri < rows.length; ri++) {
                const cells = rows[ri]?.tableCells || [];
                for (let ci = 0; ci < cells.length; ci++) {
                    const cellText = normalizarTexto(extraerTextoCelda(cells[ci]));
                    if (!normalizedNeedles.some((n) => cellText.includes(n))) continue;

                    if (preferirFilaSiguiente) {
                        const nextRowCell = rows[ri + 1]?.tableCells?.[ci];
                        const rangoNext = obtenerRangoEditableCelda(nextRowCell);
                        if (rangoNext) return rangoNext;
                    }

                    const sameRowCell = cells[ci + 1];
                    const rangoSame = obtenerRangoEditableCelda(sameRowCell);
                    if (rangoSame) return rangoSame;

                    const rangoHeader = obtenerRangoEditableCelda(cells[ci]);
                    if (rangoHeader) return rangoHeader;
                }
            }
        }
        return null;
    };

    const buscarIndiceSeccion = (bodyContent, needles = []) => {
        const rango = buscarCeldaSeccion(bodyContent, needles, true);
        if (rango) return rango.startIndex;

        for (const element of bodyContent) {
            if (!element?.paragraph) continue;
            const norm = normalizarTexto(extraerTextoParrafo(element.paragraph));
            if (needles.some((n) => norm.includes(normalizarTexto(n)))) {
                return Number(element.endIndex);
            }
        }
        return null;
    };

    const EVIDENCIA_IMG_ANCHO_PT = 220;
    const EVIDENCIA_IMG_ALTO_PT = 165;

    // Logo opcional (plantilla ya incluye encabezado con marca)
    if (params.insertarLogo === true) {
        try {
            const fs = require('fs');
            const path = require('path');
            let logoFileId = String(process.env.EIN_F04_LOGO_DRIVE_ID || '').trim();
            if (!logoFileId) {
                const logoPaths = [
                    path.join(__dirname, '../src/assets/img/logo_biznaga.png'),
                    path.join(__dirname, '../../src/assets/img/logo_biznaga.png')
                ];
                const logoPath = logoPaths.find((p) => fs.existsSync(p));
                if (logoPath) {
                    const buf = fs.readFileSync(logoPath);
                    const subido = await subirArchivoNuevo(
                        buf,
                        `logo_biznaga_${folio}.png`,
                        'image/png',
                        carpetaFolio
                    );
                    logoFileId = subido?.id || '';
                }
            }
            if (logoFileId) {
                try {
                    await asignarPermisoLecturaPublica(logoFileId);
                } catch (_) { /* ignore */ }
                const logoUrl = `https://drive.google.com/uc?id=${logoFileId}&export=download`;
                await docsApi.documents.batchUpdate({
                    documentId,
                    requestBody: {
                        requests: [
                            {
                                insertInlineImage: {
                                    location: { index: 1 },
                                    uri: logoUrl,
                                    objectSize: {
                                        height: { magnitude: 48, unit: 'PT' },
                                        width: { magnitude: 120, unit: 'PT' }
                                    }
                                }
                            },
                            {
                                insertText: {
                                    location: { index: 1 },
                                    text: '\n'
                                }
                            }
                        ]
                    }
                });
            }
        } catch (logoErr) {
            console.warn('[WARN] logo EIN-F-04:', logoErr?.message || logoErr);
        }
    }

    const docResp = await docsApi.documents.get({ documentId });
    const bodyContent = Array.isArray(docResp?.data?.body?.content) ? docResp.data.body.content : [];

    const campos = [
        {
            key: 'tipo',
            valor: `Tipo de mantenimiento: ${tipo}`,
            needles: ['tipo de mantenimiento']
        },
        {
            key: 'fechaSol',
            valor: `Fecha de la solicitud del mantenimiento: ${fechaSolicitud || 'Pendiente'}`,
            needles: ['fecha de la solicitud del mantenimiento', 'fecha de la solicitud']
        },
        {
            key: 'fechaReal',
            valor: `Fecha en la que se realizó el mantenimiento: ${fechaRealizado || 'Pendiente'}`,
            needles: ['fecha en la que se realizo el mantenimiento', 'fecha en la que se realizó']
        },
        {
            key: 'responsable',
            valor: `Responsable quien realizó el mantenimiento: ${responsable || 'Pendiente'}`,
            needles: ['responsable quien realizo el mantenimiento', 'responsable quien realizó']
        }
    ];

    const remplazos = [];
    const aplicados = new Set();

    for (const element of bodyContent) {
        if (!element?.paragraph || !Number.isFinite(Number(element.startIndex))) continue;
        const texto = extraerTextoParrafo(element.paragraph);
        const norm = normalizarTexto(texto);
        if (!norm) continue;

        const campo = campos.find(
            (c) => !aplicados.has(c.key) && c.needles.some((n) => norm.includes(normalizarTexto(n)))
        );
        if (!campo) continue;

        const startIndex = Number(element.startIndex);
        const endIndex = Number(element.endIndex) - 1;
        if (endIndex <= startIndex) continue;

        remplazos.push({ startIndex, endIndex, text: campo.valor });
        aplicados.add(campo.key);
    }

    const requests = [];
    remplazos
        .sort((a, b) => b.startIndex - a.startIndex)
        .forEach((r) => {
            requests.push({
                deleteContentRange: { range: { startIndex: r.startIndex, endIndex: r.endIndex } }
            });
            requests.push({
                insertText: { location: { index: r.startIndex }, text: r.text }
            });
        });

    if (requests.length) {
        await docsApi.documents.batchUpdate({ documentId, requestBody: { requests } });
    }

    const doc2 = await docsApi.documents.get({ documentId });
    const body2 = Array.isArray(doc2?.data?.body?.content) ? doc2.data.body.content : [];

    const rangoDesc = buscarCeldaSeccion(body2, [
        'breve descripcion del mantenimiento realizado',
        'breve descripción del mantenimiento realizado'
    ], true);

    if (descripcion) {
        const requestsDesc = [];
        if (rangoDesc) {
            requestsDesc.push({
                deleteContentRange: {
                    range: { startIndex: rangoDesc.startIndex, endIndex: rangoDesc.endIndex }
                }
            });
            requestsDesc.push({
                insertText: { location: { index: rangoDesc.startIndex }, text: descripcion }
            });
        } else {
            const idxDesc = buscarIndiceSeccion(body2, [
                'breve descripcion del mantenimiento realizado',
                'breve descripción del mantenimiento realizado'
            ]);
            if (idxDesc) {
                requestsDesc.push({
                    insertText: { location: { index: idxDesc }, text: `\n${descripcion}\n` }
                });
            }
        }
        if (requestsDesc.length) {
            await docsApi.documents.batchUpdate({ documentId, requestBody: { requests: requestsDesc } });
        }
    }

    const evidenciasConUrl = evidencias.filter((e) => e?.url || e?.driveFileId || e?.webViewLink);
    if (evidenciasConUrl.length) {
        const doc3 = await docsApi.documents.get({ documentId });
        const body3 = Array.isArray(doc3?.data?.body?.content) ? doc3.data.body.content : [];
        let cursor = buscarIndiceSeccion(body3, [
            'evidencia fotografica',
            'evidencia fotográfica'
        ]);

        if (!cursor) {
            const rangoEv = buscarCeldaSeccion(body3, [
                'evidencia fotografica',
                'evidencia fotográfica'
            ], true);
            cursor = rangoEv?.startIndex || null;
        }

        if (!cursor) {
            throw new Error('No se encontró la sección «Evidencia fotográfica» en la plantilla EIN-F-04.');
        }

        for (const ev of evidenciasConUrl) {
            const driveId = String(ev.driveFileId || '').trim();
            if (driveId) {
                try {
                    await asignarPermisoLecturaPublica(driveId);
                } catch (_) { /* ignore */ }
            }
            const imageUrl =
                (driveId ? `https://drive.google.com/uc?id=${driveId}&export=download` : '') ||
                ev.url ||
                '';
            const link = ev.webViewLink || imageUrl;
            try {
                if (imageUrl) {
                    await docsApi.documents.batchUpdate({
                        documentId,
                        requestBody: {
                            requests: [
                                {
                                    insertInlineImage: {
                                        location: { index: cursor },
                                        uri: imageUrl,
                                        objectSize: {
                                            height: { magnitude: EVIDENCIA_IMG_ALTO_PT, unit: 'PT' },
                                            width: { magnitude: EVIDENCIA_IMG_ANCHO_PT, unit: 'PT' }
                                        }
                                    }
                                },
                                { insertText: { location: { index: cursor }, text: '\n' } }
                            ]
                        }
                    });
                    cursor += 2;
                } else if (link) {
                    await docsApi.documents.batchUpdate({
                        documentId,
                        requestBody: {
                            requests: [
                                {
                                    insertText: {
                                        location: { index: cursor },
                                        text: `\n[Evidencia] ${link}\n`
                                    }
                                }
                            ]
                        }
                    });
                    cursor += String(link).length + 14;
                }
            } catch (imgErr) {
                console.warn('[WARN] imagen EIN-F-04:', imgErr?.message || imgErr);
                if (link) {
                    try {
                        await docsApi.documents.batchUpdate({
                            documentId,
                            requestBody: {
                                requests: [
                                    {
                                        insertText: {
                                            location: { index: cursor },
                                            text: `\n[Evidencia] ${link}\n`
                                        }
                                    }
                                ]
                            }
                        });
                        cursor += String(link).length + 14;
                    } catch (_) { /* ignore */ }
                }
            }
        }
    }

    return {
        driveFileId: documentId,
        nombre: copyResp?.data?.name || nombreArchivo,
        webViewLink:
            copyResp?.data?.webViewLink ||
            `https://docs.google.com/document/d/${documentId}/edit`,
        carpetaId: carpetaFolio,
        folio
    };
}

/**
 * EIN-F-02 Solicitud de mantenimiento — copia plantilla Sheets y autollena.
 * Plantilla: 1AjnG4iBXqp1_rvox9c7on-yuKDUTEXtxp6uhsg1O2TY
 */
async function generarSolicitudMantenimientoEinF02(params = {}) {
    const templateId = String(
        params.templateId || process.env.EIN_F02_TEMPLATE_ID || '1AjnG4iBXqp1_rvox9c7on-yuKDUTEXtxp6uhsg1O2TY'
    ).trim();
    const carpetaDestinoId = String(
        params.carpetaDestinoId || process.env.MANTENIMIENTO_DRIVE_FOLDER_ID || '1PSzlU-LIr4wkCZANDgDIchY6lASsPue8'
    ).trim();
    const folio = String(params.folio || '').trim() || `EIFF02-${Date.now()}`;
    const nombreSolicitante = String(params.nombreSolicitante || '').trim();
    const puesto = String(params.puesto || '').trim();
    const area = String(params.area || '').trim();
    const fechaSolicitud = String(params.fechaSolicitud || '').trim();
    const descripcionProblema = String(params.descripcionProblema || params.descripcion || '').trim();
    const observaciones = String(params.observacionesAdministrador || params.observaciones || '').trim();
    const nombreArchivo = String(params.nombreArchivo || `EIN-F-02 Solicitud ${folio}`)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim()
        .slice(0, 180);

    const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
    const OFFICE_SHEET_MIMES = new Set([
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ]);

    const normalizarTexto = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    if (!drive || !_driveAuthClient) {
        throw new Error('Google Drive no está autenticado.');
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });

    const templateMetaResp = await drive.files.get({
        fileId: templateId,
        fields: 'id,name,mimeType,shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true
    });

    let templateSourceId = templateId;
    let templateSourceMimeType = String(templateMetaResp?.data?.mimeType || '').trim();

    if (templateSourceMimeType === 'application/vnd.google-apps.shortcut') {
        const targetId = String(templateMetaResp?.data?.shortcutDetails?.targetId || '').trim();
        const targetMimeType = String(templateMetaResp?.data?.shortcutDetails?.targetMimeType || '').trim();
        if (!targetId) {
            throw new Error('La plantilla EIN-F-02 es un acceso directo inválido.');
        }
        templateSourceId = targetId;
        templateSourceMimeType = targetMimeType;
    }

    const esGoogleSheet = templateSourceMimeType === GOOGLE_SHEET_MIME;
    const esOfficeConvertible = OFFICE_SHEET_MIMES.has(templateSourceMimeType);
    if (!esGoogleSheet && !esOfficeConvertible) {
        throw new Error(
            `Plantilla EIN-F-02 incompatible (${templateSourceMimeType || 'desconocido'}). Usa Google Sheets o Excel.`
        );
    }

    const carpetaFolio = await obtenerOCrearCarpeta(folio, carpetaDestinoId);

    const copyRequestBody = {
        name: nombreArchivo,
        parents: [carpetaFolio]
    };
    if (!esGoogleSheet) {
        copyRequestBody.mimeType = GOOGLE_SHEET_MIME;
    }

    const copyResp = await drive.files.copy({
        fileId: templateSourceId,
        requestBody: copyRequestBody,
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true
    });

    const spreadsheetId = copyResp?.data?.id;
    if (!spreadsheetId) {
        throw new Error('No se pudo crear el Excel EIN-F-02.');
    }

    try {
        await drive.permissions.create({
            fileId: spreadsheetId,
            requestBody: { role: 'writer', type: 'anyone', allowFileDiscovery: false },
            supportsAllDrives: true
        });
    } catch (permErr) {
        console.warn('[WARN] permiso enlace EIN-F-02:', permErr?.message || permErr);
    }

    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const firstSheetTitle = meta?.data?.sheets?.[0]?.properties?.title || 'Hoja 1';

    const valuesResp = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${firstSheetTitle}'`,
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(valuesResp?.data?.values) ? valuesResp.data.values : [];

    const colLetter = (idx0) => {
        let n = idx0 + 1;
        let s = '';
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    };

    const findCell = (needles) => {
        const norms = needles.map(normalizarTexto);
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cellNorm = normalizarTexto(row[c]);
                if (!cellNorm) continue;
                if (norms.some((n) => cellNorm.includes(n))) {
                    return { row: r, col: c, text: String(row[c] || '') };
                }
            }
        }
        return null;
    };

    const actualizaciones = [];

    const setBeside = (needles, valor) => {
        if (!valor) return;
        const hit = findCell(needles);
        if (!hit) return;
        const targetCol = hit.col + 1;
        const a1 = `${colLetter(targetCol)}${hit.row + 1}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[valor]] });
    };

    const setBelow = (needles, valor) => {
        if (!valor) return;
        const hit = findCell(needles);
        if (!hit) return;
        const a1 = `${colLetter(hit.col)}${hit.row + 2}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[valor]] });
    };

    // Etiquetas típicas del formato EIN-F-02 (imagen / plantilla Sheets)
    setBeside(['nombre del solicitante'], nombreSolicitante);
    setBeside(['puesto'], puesto);
    setBeside(['area'], area);
    setBelow(['fecha de solicitud'], fechaSolicitud);
    setBelow(['descripcion del problema', 'descripcion del problema por el solicitante'], descripcionProblema);
    setBelow(['observaciones del administrador', 'observaciones del administrador de mantenimiento'], observaciones);

    // Si "Puesto" / "Área" coincidieron mal por ser palabras cortas, reintenta con filas conocidas
    // Sobrescribe solo si encontramos celdas más específicas (ya aplicadas arriba).

    if (actualizaciones.length) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: actualizaciones
            }
        });
    }

    return {
        driveFileId: spreadsheetId,
        nombre: copyResp?.data?.name || nombreArchivo,
        webViewLink:
            copyResp?.data?.webViewLink ||
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        carpetaId: carpetaFolio,
        folio,
        camposEscritos: actualizaciones.length
    };
}

/**
 * EIN-F-01 Programa de mantenimiento — copia/actualiza plantilla Sheets.
 * Plantilla: 1MaXJjsd9IcjiNd70Z4zXmzouEP0pZG_k9l6izOkGSng
 */
async function generarProgramaMantenimientoEinF01(params = {}) {
    const templateId = String(
        params.templateId || process.env.EIN_F01_TEMPLATE_ID || '1MaXJjsd9IcjiNd70Z4zXmzouEP0pZG_k9l6izOkGSng'
    ).trim();
    const carpetaDestinoId = String(
        params.carpetaDestinoId || process.env.MANTENIMIENTO_DRIVE_FOLDER_ID || '1PSzlU-LIr4wkCZANDgDIchY6lASsPue8'
    ).trim();
    const anio = Number(params.anio) || new Date().getFullYear();
    const meta = params.meta || {};
    const filas = Array.isArray(params.filas) ? params.filas.filter(Boolean) : [];
    const nombreArchivo = String(params.nombreArchivo || `EIN-F-01 Programa ${anio}`)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim()
        .slice(0, 180);

    const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
    const OFFICE_SHEET_MIMES = new Set([
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ]);

    const normalizarTexto = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    if (!drive || !_driveAuthClient) {
        throw new Error('Google Drive no está autenticado.');
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const canonicalTemplateId = templateId;

    const resolverDocumentoEinF01 = async (fileId) => {
        const metaResp = await drive.files.get({
            fileId,
            fields: 'id,name,webViewLink,mimeType,trashed,shortcutDetails(targetId,targetMimeType)',
            supportsAllDrives: true
        });
        if (metaResp?.data?.trashed) {
            throw new Error('El documento EIN-F-01 está en la papelera de Drive.');
        }
        let spreadsheetIdResolved = fileId;
        if (metaResp?.data?.mimeType === 'application/vnd.google-apps.shortcut') {
            const targetId = String(metaResp?.data?.shortcutDetails?.targetId || '').trim();
            if (!targetId) {
                throw new Error('La plantilla EIN-F-01 es un acceso directo inválido.');
            }
            spreadsheetIdResolved = targetId;
        }
        return {
            spreadsheetId: spreadsheetIdResolved,
            webViewLink: metaResp?.data?.webViewLink || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
            nombre: metaResp?.data?.name || nombreArchivo
        };
    };

    let spreadsheetId = String(params.spreadsheetId || '').trim();
    let webViewLink = '';
    let nombreFinal = nombreArchivo;

    // Siempre usar el documento sistema (plantilla viva), no copias en EIN-F-01-AAAA
    if (!spreadsheetId || spreadsheetId !== canonicalTemplateId) {
        spreadsheetId = '';
    }

    if (spreadsheetId) {
        try {
            const doc = await resolverDocumentoEinF01(spreadsheetId);
            spreadsheetId = doc.spreadsheetId;
            webViewLink = doc.webViewLink;
            nombreFinal = doc.nombre || nombreArchivo;
        } catch {
            spreadsheetId = '';
        }
    }

    if (!spreadsheetId) {
        const doc = await resolverDocumentoEinF01(canonicalTemplateId);
        spreadsheetId = doc.spreadsheetId;
        webViewLink = doc.webViewLink;
        nombreFinal = doc.nombre || nombreArchivo;

        try {
            await drive.permissions.create({
                fileId: canonicalTemplateId,
                requestBody: { role: 'writer', type: 'anyone', allowFileDiscovery: false },
                supportsAllDrives: true
            });
        } catch (permErr) {
            console.warn('[WARN] permiso enlace EIN-F-01:', permErr?.message || permErr);
        }
    }

    const metaSheet = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const allSheets = metaSheet?.data?.sheets || [];
    const programaSheet = allSheets.find((s) => {
        const title = normalizarTexto(s?.properties?.title || '');
        return title === 'programa' || title.includes('programa de mantenimiento');
    }) || allSheets[0];
    const firstSheet = programaSheet;
    const firstSheetTitle = firstSheet?.properties?.title || 'Programa';
    const firstSheetId = firstSheet?.properties?.sheetId ?? 0;

    const valuesResp = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${firstSheetTitle}'`,
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(valuesResp?.data?.values) ? valuesResp.data.values : [];

    const colLetter = (idx0) => {
        let n = idx0 + 1;
        let s = '';
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    };

    const findCell = (needles) => {
        const norms = needles.map(normalizarTexto);
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cellNorm = normalizarTexto(row[c]);
                if (!cellNorm) continue;
                if (norms.some((n) => cellNorm.includes(n))) {
                    return { row: r, col: c };
                }
            }
        }
        return null;
    };

    const actualizaciones = [];
    const setBeside = (needles, valor) => {
        if (valor == null || valor === '') return;
        const hit = findCell(needles);
        if (!hit) return;
        const a1 = `${colLetter(hit.col + 1)}${hit.row + 1}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[String(valor)]] });
    };
    const setBelow = (needles, valor) => {
        if (valor == null || valor === '') return;
        const hit = findCell(needles);
        if (!hit) return;
        const a1 = `${colLetter(hit.col)}${hit.row + 2}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[String(valor)]] });
    };
    const setCell = (rowIdx0, colIdx, valor) => {
        if (colIdx == null || colIdx < 0) return;
        const v = valor == null ? '' : String(valor);
        const a1 = `${colLetter(colIdx)}${rowIdx0 + 1}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[v]] });
    };

    setBeside(['periodo de programacion', 'periodo'], meta.periodo || `Enero - Diciembre ${anio}`);
    setBeside(['ano', 'año'], String(anio));
    setBeside(['administrador del programa', 'administrador'], meta.administrador || '');

    let headerRowIdx = -1;
    let colInfra = 0;
    let colResp = 1;
    let colTipo = 2;
    let weekColStart = 3;
    let dataStartIdx = 9;

    for (let r = 0; r < Math.min(rows.length, 40); r++) {
        const row = rows[r] || [];
        const cells = row.map((c) => normalizarTexto(c));
        const infraIdx = cells.findIndex((c) => c.includes('infraestructura'));
        const respIdx = cells.findIndex((c) => c.includes('responsable'));
        if (infraIdx < 0 || respIdx < 0) {
            continue;
        }
        if (cells.some((c) => c.includes('tipo de infraestructura') && c.includes('programa'))) {
            continue;
        }

        const tipoIdx = cells.findIndex((c) => (
            c === 'tipo'
            || (c.startsWith('tipo') && !c.includes('infraestructura') && !c.includes('mantenimiento'))
        ));

        headerRowIdx = r;
        colInfra = infraIdx;
        colResp = respIdx;
        colTipo = tipoIdx >= 0 ? tipoIdx : Math.max(infraIdx, respIdx) + 1;

        let weekStart = colTipo + 1;
        for (let c = colTipo + 1; c < cells.length; c++) {
            if (/^[1-4]$/.test(cells[c])) {
                weekStart = c;
                break;
            }
        }
        weekColStart = weekStart;

        const headerWeeks = cells.filter((c) => /^[1-4]$/.test(c)).length;
        if (headerWeeks >= 3) {
            dataStartIdx = r + 1;
        } else {
            const nextCells = (rows[r + 1] || []).map((c) => normalizarTexto(c));
            const nextWeeks = nextCells.filter((c) => /^[1-4]$/.test(c)).length;
            dataStartIdx = nextWeeks >= 3 ? r + 2 : r + 1;
        }
        break;
    }

    const detectarColumnasSemana = () => {
        if (headerRowIdx < 0) {
            return null;
        }
        const candidatos = [headerRowIdx + 1, headerRowIdx].filter((i) => i >= 0 && i < rows.length);
        for (const rowIdx of candidatos) {
            const cells = (rows[rowIdx] || []).map((c) => normalizarTexto(c));
            const meses = [];
            let bloque = [];
            for (let c = 0; c < cells.length; c++) {
                const v = cells[c];
                if (/^[1-4]$/.test(v)) {
                    bloque.push(c);
                    if (bloque.length === 4) {
                        meses.push([...bloque]);
                        bloque = [];
                    }
                } else if (bloque.length === 4) {
                    meses.push([...bloque]);
                    bloque = [];
                } else if (bloque.length > 0) {
                    bloque = [];
                }
            }
            if (bloque.length === 4) {
                meses.push(bloque);
            }
            if (meses.length >= 6) {
                return meses.slice(0, 12);
            }
        }
        return null;
    };

    const weekColsByMonth = detectarColumnasSemana();
    const spacerCols = weekColsByMonth
        ? weekColsByMonth.slice(0, 11).map((w) => w[3] + 1)
        : Array.from({ length: 11 }, (_, mes) => weekColStart + mes * 5 + 4);

    const colSemana = (mes, sem) => {
        if (weekColsByMonth && weekColsByMonth[mes] && weekColsByMonth[mes][sem] != null) {
            return weekColsByMonth[mes][sem];
        }
        return weekColStart + mes * 5 + sem;
    };

    const COLOR_PROG_FONDO = { red: 0, green: 176 / 255, blue: 80 / 255 };
    const COLOR_PROG_TEXTO = { red: 1, green: 1, blue: 1 };
    const COLOR_BLANCO = { red: 1, green: 1, blue: 1 };
    const COLOR_TEXTO_NEGRO = { red: 0.2, green: 0.2, blue: 0.2 };
    const celdasFormato = [];

    const normalizarEstadoPrograma = (val) => {
        if (val === true || val === 'P' || val === 'p') return 'P';
        if (val === 'reservado' || val === 'reservada' || val === 'marked') return 'reservado';
        return null;
    };

    filas.forEach((fila, i) => {
        const r = dataStartIdx + i;
        setCell(r, colInfra, fila.infraestructura);
        setCell(r, colResp, fila.responsable);
        setCell(r, colTipo, fila.tipo === 'Ext' ? 'Ext' : 'Int');

        const programado = fila.programado && typeof fila.programado === 'object' ? fila.programado : {};
        for (let mes = 0; mes < 12; mes += 1) {
            for (let sem = 0; sem < 4; sem += 1) {
                const col = colSemana(mes, sem);
                const key = `m${mes}-s${sem}`;
                const estado = normalizarEstadoPrograma(programado[key]);
                setCell(r, col, estado === 'P' ? 'P' : '');
                if (estado === 'P' || estado === 'reservado') {
                    celdasFormato.push({
                        row: r,
                        col,
                        conP: estado === 'P'
                    });
                }
            }
        }
        for (const spacerCol of spacerCols) {
            setCell(r, spacerCol, '');
            celdasFormato.push({
                row: r,
                col: spacerCol,
                limpiar: true
            });
        }
    });

    if (actualizaciones.length) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: actualizaciones
            }
        });
    }

    if (celdasFormato.length) {
        const formatRequests = celdasFormato.map((item) => {
            if (item.limpiar) {
                return {
                    repeatCell: {
                        range: {
                            sheetId: firstSheetId,
                            startRowIndex: item.row,
                            endRowIndex: item.row + 1,
                            startColumnIndex: item.col,
                            endColumnIndex: item.col + 1
                        },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: 'CENTER',
                                verticalAlignment: 'MIDDLE',
                                backgroundColor: COLOR_BLANCO,
                                textFormat: {
                                    foregroundColor: COLOR_TEXTO_NEGRO,
                                    bold: false
                                }
                            }
                        },
                        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,backgroundColor,textFormat,textFormat.foregroundColor,textFormat.bold)'
                    }
                };
            }
            return {
                repeatCell: {
                    range: {
                        sheetId: firstSheetId,
                        startRowIndex: item.row,
                        endRowIndex: item.row + 1,
                        startColumnIndex: item.col,
                        endColumnIndex: item.col + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            backgroundColor: COLOR_PROG_FONDO,
                            textFormat: {
                                foregroundColor: item.conP ? COLOR_PROG_TEXTO : COLOR_PROG_FONDO,
                                bold: item.conP
                            }
                        }
                    },
                    fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,backgroundColor,textFormat,textFormat.foregroundColor,textFormat.bold)'
                }
            };
        });
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: formatRequests }
        });
    }

    return {
        driveFileId: canonicalTemplateId,
        nombre: nombreFinal,
        webViewLink: webViewLink || `https://docs.google.com/spreadsheets/d/${canonicalTemplateId}/edit`,
        anio,
        filasEscritas: filas.length,
        camposEscritos: actualizaciones.length,
        templateId: canonicalTemplateId
    };
}

/**
 * EIN-F-03 Bitácora: Century Gothic 10, izquierda, vertical medio, ajuste de texto, fila 55 px.
 * Conserva bordes y fondo alternado copiando formato de las filas modelo y luego aplica tipografía.
 */
const EIN_F03_FILA_ALTO_PX = 55;
const EIN_F03_TEXTO_FORMAT = { fontFamily: 'Century Gothic', fontSize: 10 };

async function aplicarFormatoVisualEinF03Bitacora(spreadsheetId, sheetTitle, filaInicio1, numFilas, colFin = 9) {
    if (!spreadsheetId || !sheetTitle || !numFilas) {
        return null;
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = (meta.data.sheets || []).find(
        (s) => (s.properties?.title || '').trim() === String(sheetTitle).trim()
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        return null;
    }

    const filas = Math.max(0, Number(numFilas) || 0);
    const startRow0 = Math.max(0, Number(filaInicio1) - 1);
    const endRow0 = startRow0 + filas;
    const colEnd = Math.max(1, Number(colFin) || 9);
    const formatSourceGray0 = startRow0;

    const requests = [];

    for (let i = 0; i < filas; i++) {
        const destRow0 = startRow0 + i;
        const sourceRow0 = formatSourceGray0 + (i % 2);
        requests.push({
            copyPaste: {
                source: {
                    sheetId,
                    startRowIndex: sourceRow0,
                    endRowIndex: sourceRow0 + 1,
                    startColumnIndex: 0,
                    endColumnIndex: colEnd
                },
                destination: {
                    sheetId,
                    startRowIndex: destRow0,
                    endRowIndex: destRow0 + 1,
                    startColumnIndex: 0,
                    endColumnIndex: colEnd
                },
                pasteType: 'PASTE_FORMAT'
            }
        });
    }

    requests.push({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: startRow0,
                endRowIndex: endRow0,
                startColumnIndex: 0,
                endColumnIndex: colEnd
            },
            cell: {
                userEnteredFormat: {
                    horizontalAlignment: 'LEFT',
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                    textFormat: EIN_F03_TEXTO_FORMAT
                }
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
        }
    });

    requests.push({
        updateDimensionProperties: {
            range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: startRow0,
                endIndex: endRow0
            },
            properties: { pixelSize: EIN_F03_FILA_ALTO_PX },
            fields: 'pixelSize'
        }
    });

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
    return true;
}

/**
 * EIN-F-03 Bitácora de mantenimiento — escribe en la plantilla oficial y llena filas de datos.
 * Plantilla: 1CmYDinQTOv_nuDUTa0AmiWwgN-pWJWgypQifVOU0oi0
 */
async function generarBitacoraMantenimientoEinF03(params = {}) {
    const folio = String(params.folio || '').trim() || `BIT-${Date.now()}`;

    // Soporta una fila suelta (legacy) o un arreglo `filas`
    let filas = Array.isArray(params.filas) ? params.filas.filter(Boolean) : [];
    if (!filas.length) {
        filas = [{
            no: 1,
            tipoInfraestructura: params.tipoInfraestructura,
            idSerie: params.idSerie,
            tipoMantenimiento: params.tipoMantenimiento,
            internoExterno: params.internoExterno,
            actividades: params.actividades || params.descripcionProblema,
            responsable: params.responsable,
            fechaRealizado: params.fechaRealizado,
            observaciones: params.observaciones
        }];
    }

    const nombreArchivo = String(params.nombreArchivo || `EIN-F-03 Bitácora ${folio}`)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .trim()
        .slice(0, 180);

    const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
    const OFFICE_SHEET_MIMES = new Set([
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ]);

    const normalizarTexto = (value = '') => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    if (!drive || !_driveAuthClient) {
        throw new Error('Google Drive no está autenticado.');
    }

    const sheetsApi = google.sheets({ version: 'v4', auth: _driveAuthClient });
    const canonicalTemplateId = String(
        params.templateId || process.env.EIN_F03_TEMPLATE_ID || '1CmYDinQTOv_nuDUTa0AmiWwgN-pWJWgypQifVOU0oi0'
    ).trim();

    const resolverDocumentoEinF03 = async (fileId) => {
        const metaResp = await drive.files.get({
            fileId,
            fields: 'id,name,webViewLink,mimeType,trashed,shortcutDetails(targetId,targetMimeType)',
            supportsAllDrives: true
        });
        if (metaResp?.data?.trashed) {
            throw new Error('El documento EIN-F-03 está en la papelera de Drive.');
        }
        let spreadsheetIdResolved = fileId;
        if (metaResp?.data?.mimeType === 'application/vnd.google-apps.shortcut') {
            const targetId = String(metaResp?.data?.shortcutDetails?.targetId || '').trim();
            if (!targetId) {
                throw new Error('La plantilla EIN-F-03 es un acceso directo inválido.');
            }
            spreadsheetIdResolved = targetId;
        }
        return {
            spreadsheetId: spreadsheetIdResolved,
            webViewLink: metaResp?.data?.webViewLink || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
            nombre: metaResp?.data?.name || nombreArchivo
        };
    };

    let spreadsheetId = String(params.spreadsheetId || '').trim();
    let webViewLink = '';
    let nombreFinal = nombreArchivo;

    if (!spreadsheetId || spreadsheetId !== canonicalTemplateId) {
        spreadsheetId = '';
    }

    if (spreadsheetId) {
        try {
            const doc = await resolverDocumentoEinF03(spreadsheetId);
            spreadsheetId = doc.spreadsheetId;
            webViewLink = doc.webViewLink;
            nombreFinal = doc.nombre || nombreArchivo;
        } catch {
            spreadsheetId = '';
        }
    }

    if (!spreadsheetId) {
        const doc = await resolverDocumentoEinF03(canonicalTemplateId);
        spreadsheetId = doc.spreadsheetId;
        webViewLink = doc.webViewLink;
        nombreFinal = doc.nombre || nombreArchivo;

        try {
            await drive.permissions.create({
                fileId: canonicalTemplateId,
                requestBody: { role: 'writer', type: 'anyone', allowFileDiscovery: false },
                supportsAllDrives: true
            });
        } catch (permErr) {
            console.warn('[WARN] permiso enlace EIN-F-03:', permErr?.message || permErr);
        }
    }

    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const allSheets = meta?.data?.sheets || [];
    const plantillaSheet = allSheets.find((s) => {
        const title = normalizarTexto(s?.properties?.title || '');
        return title === 'plantilla' || title.includes('bitacora');
    }) || allSheets[0];
    const firstSheetTitle = plantillaSheet?.properties?.title || 'Plantilla';

    const valuesResp = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${firstSheetTitle}'`,
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(valuesResp?.data?.values) ? valuesResp.data.values : [];

    const colLetter = (idx0) => {
        let n = idx0 + 1;
        let s = '';
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    };

    // Buscar fila de encabezados de la bitácora
    let headerRowIdx = -1;
    let colMap = {};
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
        const row = rows[r] || [];
        const cells = row.map((c) => normalizarTexto(c));
        const hasInfra = cells.some((c) => c.includes('tipo de infraestructura') || c === 'tipo de infraestructura');
        const hasTipoMant = cells.some((c) => c.includes('tipo de mantenimiento'));
        if (hasInfra && hasTipoMant) {
            headerRowIdx = r;
            row.forEach((cell, cIdx) => {
                const n = normalizarTexto(cell);
                if (!n) return;
                if (n === 'no' || n.startsWith('no ')) colMap.no = cIdx;
                else if (n.includes('tipo de infraestructura')) colMap.infra = cIdx;
                else if (n.includes('id o no') || n.includes('no de serie') || n.includes('serie')) colMap.idSerie = cIdx;
                else if (n.includes('tipo de mantenimiento')) colMap.tipoMant = cIdx;
                else if (n.includes('interno') || n.includes('externo')) colMap.interno = cIdx;
                else if (n.includes('actividades')) colMap.actividades = cIdx;
                else if (n.includes('responsable')) colMap.responsable = cIdx;
                else if (n.includes('fecha')) colMap.fecha = cIdx;
                else if (n.includes('observaciones')) colMap.obs = cIdx;
            });
            break;
        }
    }

    const dataStartIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 5;
    const actualizaciones = [];

    const setCell = (rowIdx0, colIdx, valor) => {
        if (colIdx == null || colIdx < 0) return;
        const v = valor == null ? '' : String(valor);
        const a1 = `${colLetter(colIdx)}${rowIdx0 + 1}`;
        actualizaciones.push({ range: `'${firstSheetTitle}'!${a1}`, values: [[v]] });
    };

    // Defaults por posición si no se detectaron encabezados (A–I según plantilla)
    if (Object.keys(colMap).length < 3) {
        colMap = {
            no: 0,
            infra: 1,
            idSerie: 2,
            tipoMant: 3,
            interno: 4,
            actividades: 5,
            responsable: 6,
            fecha: 7,
            obs: 8
        };
    }

    filas.forEach((fila, i) => {
        const r = dataStartIdx + i;
        setCell(r, colMap.no, fila.no != null ? fila.no : i + 1);
        setCell(r, colMap.infra, fila.tipoInfraestructura);
        setCell(r, colMap.idSerie, fila.idSerie);
        setCell(r, colMap.tipoMant, fila.tipoMantenimiento);
        const ie = String(fila.internoExterno || 'Interno').trim();
        setCell(r, colMap.interno, ie === 'Externo' ? 'Externo' : 'Interno');
        setCell(r, colMap.actividades, fila.actividades || fila.descripcionProblema);
        setCell(r, colMap.responsable, fila.responsable);
        setCell(r, colMap.fecha, fila.fechaRealizado);
        setCell(r, colMap.obs, fila.observaciones);
    });

    if (actualizaciones.length) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: actualizaciones
            }
        });
    }

    const colEnd = Math.max(...Object.values(colMap).map((c) => Number(c) || 0), 8) + 1;

    if (filas.length > 0) {
        await aplicarFormatoVisualEinF03Bitacora(
            spreadsheetId,
            firstSheetTitle,
            dataStartIdx + 1,
            filas.length,
            colEnd
        );
    }

    return {
        driveFileId: canonicalTemplateId,
        nombre: nombreFinal,
        webViewLink: webViewLink || `https://docs.google.com/spreadsheets/d/${canonicalTemplateId}/edit`,
        folio,
        filasEscritas: filas.length,
        camposEscritos: actualizaciones.length,
        templateId: canonicalTemplateId
    };
}

// =====================================================
// EXPORTAR MÓDULO
// =====================================================

module.exports = {
    arranqueAuthPromise,
    // Carpetas genéricas
    buscarCarpeta,
    crearCarpeta,
    obtenerOCrearCarpeta,

    // Archivos genéricos
    buscarArchivo,
    buscarArchivoGlobal,
    subirArchivo,
    subirArchivoNuevo,
    subirExcelComoGoogleSheet,
    convertirOfficeExcelAGoogleSheet,
    asegurarSpreadsheetNativoParaCatalogo,
    esMimeTypeOfficeExcel,
    descargarArchivo,
    eliminarArchivo,
    eliminarCarpetaPorId,
    renombrarCarpetaPorId,
    renombrarArchivoPorId,
    obtenerMetadatosArchivo,
    obtenerInfoArchivo,
    verificarArchivoExiste,
    verificarArchivosLote,

    // Empresas
    crearCarpetaEmpresa,
    subirConstanciaEmpresa,
    obtenerConstanciaEmpresa,

    // Cursos y Áreas Temáticas
    obtenerCarpetaCursos,
    crearCarpetaAreaTematica,
    eliminarCarpetaAreaTematica,
    crearCarpetaCurso,
    eliminarCarpetaCurso,
    renombrarCarpetaCurso,
    subirDocumentoCurso,
    descargarDocumentoCurso,
    eliminarDocumentoCurso,
    exportarGoogleSheetComoXLSX,
    exportarGoogleSheetComoPDF,
    exportarArchivoXLSX,
    exportarArchivoPDF,
    exportarArchivoPDFPorHojas,
    descargarArchivoNativo,

    // Capacitaciones
    crearCarpetaCapacitacion,
    eliminarCarpetaCapacitacion,

    // Listado de carpetas/archivos
    listarSubcarpetas,
    listarArchivosCarpeta,
    moverArchivoDrive,
    eliminarSubcarpetaVaciaSiExiste,
    obtenerCarpetaFirmasRaiz,
    obtenerOCrearCarpetaFirmas,
    migrarCarpetasFirmasOrganizacion,
    obtenerCarpetaDocumentos,
    obtenerCarpetaPerfiles,
    obtenerCarpetaDocumentacionCapacitacion,
    resolverCarpetaFotosUsuarios,
    moverPlantillasACapacitacionDocumentacion,
    moverCursosACapacitaciones,
    extraerControlDeOficiosDeCalidad,
    moverCalidadASistemaGestionCalidad,
    obtenerCarpetaControlOficios,
    obtenerCarpetaCalidad,
    obtenerSistemaGestionCalidadFolderId,
    buscarCarpetaCursos,
    limpiarCarpetasTmpReporteSalud,
    moverFotosSueltasDeRaizAPerfiles,
    migrarOrganizacionDriveGeneral,
    eliminarCarpetaYContenido,
    SUBCARPETAS_FIRMAS,

    // Expedientes Médicos
    subirExpedienteMedico,
    sincronizarCarpetasExpedientesEmpresas,

    // Protección Civil
    obtenerCarpetaPIPC,
    crearCarpetaDocumentoPC,
    subirArchivoProteccionCivil,
    subirArchivoDocumentacionExtraPC,
    eliminarCarpetaDocumentacionExtraPC,
    subirArchivoHistorialPC,
    eliminarArchivoHistorialPC,
    eliminarCarpetaDocumentoPC,
    eliminarCarpetaHistorialEmpresaPC,
    listarHistorialEmpresaPC,
    obtenerCatalogoProteccionCivilDesdeDrive,
    reemplazarArchivoEnDrive,
    resolverUrlFirmaParaSlides,
    invalidarCacheCarpetasPC,

    // Sincronización
    sincronizarCarpetasAreas,
    sincronizarCarpetasCursosCompleta,

    // Constancias (Google Slides)
    generarConstanciaSlides,
    generarConstanciaPdfBuffer,
    generarConstanciasLote,

    // Informe Fotográfico (Google Slides)
    generarInformeFotograficoSlides,

    // Reporte de Salud (Google Slides)
    generarReporteSaludSlides,

    // Control de entrega de documentos (Google Docs)
    generarControlEntregaDocumentosDesdeTemplate,

    // Mantenimiento EIN-F-04 (Google Docs / Word)
    generarReporteMantenimientoEinF04,
    // Mantenimiento EIN-F-02 (Google Sheets / Excel)
    generarSolicitudMantenimientoEinF02,
    // Mantenimiento EIN-F-03 Bitácora (Google Sheets / Excel)
    generarProgramaMantenimientoEinF01,
    generarBitacoraMantenimientoEinF03,

    // Upload rápido
    uploadFileFast,
    asignarPermisoLecturaPublica,
    asignarPermisoEscrituraEnlace,
    subirImagenTemporal,
    perteneceACarpetaAncestral,

    // Utilidades
    probarConexion,
    validarAutenticacionDrive,
    obtenerEstadoAutenticacionDrive,
    forzarRefrescoToken,
    persistirRefreshToken,

    // Constantes
    ROOT_FOLDER_ID,
    authMethod,
    driveDisponible,

    /** Cliente OAuth2/SA para APIs de Google (Sheets, Docs, etc.) */
    getAuthClient: () => _driveAuthClient,

    actualizarCeldasGoogleSheet,
    permitirAccesoUrlsExternasGoogleSheet,
    aplicarFormatoRangoGoogleSheet,
    listarHojasGoogleSheet,
    obtenerGidHojaPorNombre,
    resolverTituloHojaExistente,
    construirUrlEditorGoogleSheet,
    obtenerMetadatosHojasGoogleSheet,
    resolverNombreHojaUnico,
    obtenerDimensionesHojaGoogleSheet,
    duplicarHojaGoogleSheet,
    renombrarHojaGoogleSheet,
    insertarFilasGoogleSheet,
    crearHojaGoogleSheet,
    eliminarHojasGoogleSheet,
    copiarGoogleSheetACarpeta,
    reemplazarTextoEnGoogleSheet,

    recortarColumnasGoogleSheet,
    aplicarFormatoVisualSgcF12,
    aplicarFormatoVisualSgcF11,
    aplicarFormatoVisualSgcF06,

    aplicarFormatoFilasDgF05,
    aplicarFormatoFilasSgcF05,
    aplicarFormatoVisualSgcF04,
    aplicarFormatoVisualSgcF22,
    aplicarFormatoVisualSgcF16,
    aplicarFormatoVisualSpF02,
    aplicarFormatoFilasSgcF14,
    aplicarFormatoFilasSgcF25,
    aplicarFormatoFilasSgcF02,
    aplicarFormatoFilasSgcF29,
    aplicarFormatoFilasAthF08,

    aplicarBordesComplementariosDgF05,

    limpiarBordesTablaDebajoDatosDgF05,

    limpiarBordesColumnaInfluenciaFueraTablaDgF05,

    asegurarMergeElaboroDgF05,

    resolverFilaFirmasDgF05
};
