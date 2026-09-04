/**
 * DG-F-01 · Mapa de procesos — imagen JPG + PDF firmado (historial) en Drive.
 */
const fs = require('fs');
const path = require('path');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-01';
const CARPETA_DRIVE_ID = '1aKt_h3NKy369KffJhPA5atPN6l7J74rr';
const NOMBRE_IMAGEN = 'DG-F-01 Mapa de procesos.jpg';
const NOMBRE_PDF_ARCHIVO = 'DG-F-01 Mapa de procesos.pdf';
const IMAGEN_DRIVE_FILE_ID_DEFECTO = '1VBnj5OeYjqcyrymrQrLOs68wsS1aLrzJ';
const LOCAL_ASSET_PATH = path.join(__dirname, '../src/assets/img/img_SGC/dg-f-01-mapa-procesos.jpg');
const IMAGEN_MIN_BYTES = 50000;
const IMAGEN_MIN_BYTES_SUBIDA = 512;

const DATOS_DEFECTO = {
    codigo: 'DG-F-01',
    revision: '00',
    fechaRevision: '20-01-25',
    imagenMapa: {
        driveFileId: IMAGEN_DRIVE_FILE_ID_DEFECTO,
        nombreArchivo: NOMBRE_IMAGEN,
        webViewLink: `https://drive.google.com/file/d/${IMAGEN_DRIVE_FILE_ID_DEFECTO}/view?usp=drive_link`,
        fechaActualizacion: null
    },
    pdfFirmado: null
};

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function formatearDatetimeMysqlMexico(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string' && !fecha.includes('T')) {
        const [datePart, timePart = '00:00:00'] = fecha.trim().split(/\s+/);
        const [y, m, d] = datePart.split('-');
        const [hh, mm] = timePart.split(':');
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return String(fecha);
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const y = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const min = String(dt.getUTCMinutes()).padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${min}`;
}

function sanitizarImagenMapa(raw) {
    if (!raw || typeof raw !== 'object') {
        return { ...DATOS_DEFECTO.imagenMapa };
    }
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || IMAGEN_DRIVE_FILE_ID_DEFECTO).trim();
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || NOMBRE_IMAGEN).trim() || NOMBRE_IMAGEN,
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        fechaActualizacion: formatearFechaIso(raw.fechaActualizacion || raw.fecha_actualizacion) || null
    };
}

function nombrePdfHistorial(fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    return `${NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '')} - ${mm}/${yy}.pdf`;
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esNombrePdfDelFormato(nombre) {
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const n = String(nombre || '').trim();
    return n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()
        || new RegExp(`^${escaparRegex(base)} - \\d{2}/\\d{2}\\.pdf$`, 'i').test(n);
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || NOMBRE_PDF_ARCHIVO).trim()
            || NOMBRE_PDF_ARCHIVO,
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim() || null,
        previewUrl: `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso()
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        codigo: String(base.codigo || DATOS_DEFECTO.codigo).trim() || DATOS_DEFECTO.codigo,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: String(base.fechaRevision || base.fecha_revision || DATOS_DEFECTO.fechaRevision).trim()
            || DATOS_DEFECTO.fechaRevision,
        imagenMapa: sanitizarImagenMapa(base.imagenMapa || base.imagen_mapa),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado)
    };
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) {
        return null;
    }
    try {
        const parsed = typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
}

function construirRespuesta(registro, datos) {
    const pdfFirmado = datos.pdfFirmado
        ? {
            ...datos.pdfFirmado,
            nombreArchivo: datos.pdfFirmado.nombreArchivo || NOMBRE_PDF_ARCHIVO,
            previewUrl: datos.pdfFirmado.previewUrl
                || `https://drive.google.com/file/d/${datos.pdfFirmado.driveFileId}/preview`
        }
        : null;

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            pdfFirmado
        },
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        imagenVersion: registro?.ultima_sync_drive
            ? new Date(registro.ultima_sync_drive).getTime()
            : Date.now(),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null
    };
}

async function buscarPdfEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) {
            return sanitizarPdfFirmado(pdfDb);
        }
    }

    const enDrive = await buscarPdfEnDrive();
    if (!enDrive?.id) {
        return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
    }

    return sanitizarPdfFirmado({
        driveFileId: enDrive.id,
        nombreArchivo: enDrive.name || NOMBRE_PDF_ARCHIVO,
        webViewLink: enDrive.webViewLink || null,
        fechaSubida: enDrive.modifiedTime || fechaHoyIso()
    });
}

/** Publica un PDF nuevo sin borrar versiones anteriores (historial en Drive). */
async function publicarPdfEnDrive(pdfBuffer) {
    const nombreArchivo = nombrePdfHistorial();
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.imagenDriveFileId || payload.driveFileId || null
    });
}

function datosSonEquivalentes(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
}

function inferirMimeType(nombreArchivo) {
    const ext = String(nombreArchivo || '').split('.').pop()?.toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
}

function esFormatoImagen(buffer) {
    if (!buffer || buffer.length < IMAGEN_MIN_BYTES_SUBIDA) {
        return false;
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        return true;
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return true;
    }
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return true;
    }
    if (buffer.toString('ascii', 0, 3) === 'GIF') {
        return true;
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return true;
    }
    return false;
}

/** Acepta subida desde el sistema (incluye formatos modernos reportados por el navegador). */
function esImagenSubible(buffer, mimeType) {
    if (esFormatoImagen(buffer)) {
        return true;
    }
    const tipo = String(mimeType || '').toLowerCase();
    return tipo.startsWith('image/') && buffer.length >= IMAGEN_MIN_BYTES_SUBIDA;
}

/** Imagen completa desde Drive (evita archivos truncados de ~4 KB). */
function esBufferImagenValido(buffer) {
    return esFormatoImagen(buffer) && buffer.length >= IMAGEN_MIN_BYTES;
}

function construirImagenDataUrl(buffer, mimeType) {
    if (!esImagenSubible(buffer, mimeType)) {
        return null;
    }
    const tipo = mimeType || 'image/jpeg';
    return `data:${tipo};base64,${buffer.toString('base64')}`;
}

async function persistirImagenLocal(buffer, mimeType = 'image/jpeg') {
    if (!esImagenSubible(buffer, mimeType)) {
        return;
    }
    try {
        fs.mkdirSync(path.dirname(LOCAL_ASSET_PATH), { recursive: true });
        fs.writeFileSync(LOCAL_ASSET_PATH, buffer);
    } catch (err) {
        console.warn('[DG-F-01] No se pudo guardar copia local de la imagen:', err.message);
    }
}

async function eliminarImagenLocalInvalida() {
    try {
        const local = await leerImagenLocal();
        if (local && !esBufferImagenValido(local) && fs.existsSync(LOCAL_ASSET_PATH)) {
            fs.unlinkSync(LOCAL_ASSET_PATH);
            console.warn('[DG-F-01] Copia local inválida eliminada; se volverá a sincronizar desde Drive.');
        }
    } catch (err) {
        console.warn('[DG-F-01] No se pudo limpiar copia local inválida:', err.message);
    }
}

async function leerImagenLocal() {
    try {
        if (fs.existsSync(LOCAL_ASSET_PATH)) {
            return fs.readFileSync(LOCAL_ASSET_PATH);
        }
    } catch {
        return null;
    }
    return null;
}

async function descargarImagenDesdeDrive(driveFileId) {
    const buffer = await driveService.descargarArchivo(driveFileId);
    if (esBufferImagenValido(buffer)) {
        await persistirImagenLocal(buffer);
    }
    return buffer;
}

async function republicarImagenEnDrive(buffer, mimeType = 'image/jpeg', fileIdAnterior = null) {
    if (fileIdAnterior) {
        try {
            await driveService.eliminarArchivo(fileIdAnterior);
        } catch (err) {
            console.warn('[DG-F-01] No se pudo eliminar imagen previa en Drive:', err.message);
        }
    }

    const existente = await buscarImagenEnDrive();
    if (existente?.id && existente.id !== fileIdAnterior) {
        try {
            await driveService.eliminarArchivo(existente.id);
        } catch (err) {
            console.warn('[DG-F-01] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    const driveResult = await driveService.subirArchivo(
        buffer,
        NOMBRE_IMAGEN,
        mimeType,
        CARPETA_DRIVE_ID
    );

    return {
        driveFileId: driveResult.id,
        nombreArchivo: NOMBRE_IMAGEN,
        webViewLink: driveResult.webViewLink
            || `https://drive.google.com/file/d/${driveResult.id}/view?usp=drive_link`
    };
}

async function asegurarImagenDriveSincronizada(pool, datos) {
    const driveFileId = await resolverImagenDriveFileId(datos);

    try {
        const bufferDrive = await driveService.descargarArchivo(driveFileId);
        if (esBufferImagenValido(bufferDrive)) {
            await persistirImagenLocal(bufferDrive);
            return { driveFileId, datos };
        }
    } catch (err) {
        console.warn('[DG-F-01] Imagen en Drive no disponible:', err.message);
    }

    const local = await leerImagenLocal();
    if (!esFormatoImagen(local)) {
        return { driveFileId, datos };
    }

    console.log('[DG-F-01] Republicando imagen válida desde copia local hacia Drive…');
    const republicada = await republicarImagenEnDrive(local, 'image/jpeg', driveFileId);
    const datosActualizados = {
        ...datos,
        imagenMapa: {
            ...datos.imagenMapa,
            ...republicada,
            fechaActualizacion: fechaHoyIso()
        }
    };

    await guardarRegistroDb(pool, {
        imagenDriveFileId: republicada.driveFileId,
        datos: datosActualizados,
        fechaElaboracionOriginal: fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    return {
        driveFileId: republicada.driveFileId,
        datos: datosActualizados
    };
}

async function buscarImagenEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_IMAGEN.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase() === objetivo)
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverImagenDriveFileId(datos) {
    const idGuardado = datos?.imagenMapa?.driveFileId;
    if (idGuardado) {
        try {
            const existe = await driveService.verificarArchivoExiste(idGuardado);
            if (existe) {
                return idGuardado;
            }
        } catch {
            // continuar con búsqueda/fallback
        }
    }

    const encontrado = await buscarImagenEnDrive();
    if (encontrado?.id) {
        return encontrado.id;
    }

    return IMAGEN_DRIVE_FILE_ID_DEFECTO;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);

    const sincronizada = await asegurarImagenDriveSincronizada(pool, datos);
    datos = sincronizada.datos;
    datos.imagenMapa = {
        ...datos.imagenMapa,
        driveFileId: sincronizada.driveFileId,
        webViewLink: `https://drive.google.com/file/d/${sincronizada.driveFileId}/view?usp=drive_link`
    };

    const pdfDbId = datos.pdfFirmado?.driveFileId || null;
    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
    }

    if (!registro) {
        await guardarRegistroDb(pool, {
            imagenDriveFileId: sincronizada.driveFileId,
            datos,
            fechaElaboracionOriginal: fechaHoyIso(),
            fechaModificacionContenido: null,
            contenidoModificado: 0
        });
        registro = await obtenerRegistroDb(pool);
    } else if (pdfResuelto && pdfResuelto.driveFileId !== pdfDbId) {
        await guardarRegistroDb(pool, {
            imagenDriveFileId: sincronizada.driveFileId,
            datos,
            fechaElaboracionOriginal: formatearFechaIso(registro.fecha_elaboracion_original) || fechaHoyIso(),
            fechaModificacionContenido: formatearFechaIso(registro.fecha_modificacion_contenido),
            contenidoModificado: !!registro.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const respuesta = construirRespuesta(registro, datos);
    try {
        const { buffer, mimeType } = await obtenerImagenMapaBuffer(pool);
        respuesta.imagenDataUrl = construirImagenDataUrl(buffer, mimeType);
    } catch (err) {
        console.warn('[DG-F-01] No se pudo adjuntar imagen en cargarFormato:', err.message);
        respuesta.imagenDataUrl = null;
    }

    return respuesta;
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let datosPrevios = null;
    if (registroPrevio?.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosEntrada);
    const contenidoModificado = huboCambio && origen !== 'consulta'
        ? true
        : !!registroPrevio?.contenido_modificado;
    const fechaModificacion = huboCambio && origen !== 'consulta'
        ? fechaHoyIso()
        : formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    const pdfFirmado = sanitizarPdfFirmado(datosEntrada.pdfFirmado)
        || sanitizarPdfFirmado(datosPrevios?.pdfFirmado)
        || (await resolverPdfFirmado(datosPrevios || datosEntrada));

    const datosGuardar = {
        ...datosEntrada,
        imagenMapa: sanitizarImagenMapa(datosEntrada.imagenMapa || datosPrevios?.imagenMapa),
        pdfFirmado
    };

    await guardarRegistroDb(pool, {
        imagenDriveFileId: datosGuardar.imagenMapa.driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar);
}

async function obtenerImagenMapaBuffer(pool) {
    await eliminarImagenLocalInvalida();

    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    const driveFileId = await resolverImagenDriveFileId(datos);
    const mimeType = inferirMimeType(datos.imagenMapa?.nombreArchivo || NOMBRE_IMAGEN);

    try {
        const bufferDrive = await descargarImagenDesdeDrive(driveFileId);
        if (esBufferImagenValido(bufferDrive)) {
            return {
                buffer: bufferDrive,
                mimeType,
                driveFileId,
                origen: 'drive'
            };
        }
        console.warn(`[DG-F-01] Imagen en Drive inválida (${bufferDrive?.length || 0} bytes)`);
    } catch (err) {
        console.warn('[DG-F-01] Falló descarga desde Drive:', err.message);
    }

    const local = await leerImagenLocal();
    if (esFormatoImagen(local)) {
        return {
            buffer: local,
            mimeType,
            driveFileId,
            origen: 'local'
        };
    }

    throw new Error('No hay una imagen válida del mapa de procesos disponible.');
}

async function subirImagenMapa(pool, body) {
    const imagenBase64 = String(body?.imagen_base64 || body?.imagenBase64 || '').trim();
    if (!imagenBase64) {
        throw new Error('No se recibió la imagen (imagen_base64 requerido).');
    }

    const imagenBuffer = Buffer.from(imagenBase64, 'base64');
    if (!imagenBuffer.length) {
        throw new Error('La imagen está vacía.');
    }

    const mimeType = String(body?.mime_type || body?.mimeType || inferirMimeType(NOMBRE_IMAGEN)).trim() || 'image/jpeg';

    if (!esImagenSubible(imagenBuffer, mimeType)) {
        throw new Error(
            `El archivo seleccionado no es una imagen válida (${imagenBuffer.length} bytes). ` +
            'Usa JPG, PNG o WebP.'
        );
    }

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const driveFileId = await resolverImagenDriveFileId(datosPrevios);

    const republicada = await republicarImagenEnDrive(imagenBuffer, mimeType, driveFileId);
    await persistirImagenLocal(imagenBuffer, mimeType);

    const imagenMapa = {
        driveFileId: republicada.driveFileId,
        nombreArchivo: NOMBRE_IMAGEN,
        webViewLink: republicada.webViewLink,
        fechaActualizacion: fechaHoyIso()
    };

    const datosGuardar = {
        ...datosPrevios,
        imagenMapa
    };

    await guardarRegistroDb(pool, {
        imagenDriveFileId: imagenMapa.driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    return {
        ...construirRespuesta(registro, datosGuardar),
        imagenMapa,
        imagenDataUrl: construirImagenDataUrl(imagenBuffer, mimeType)
    };
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const driveResult = await publicarPdfEnDrive(pdfBuffer);

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const datosGuardar = {
        ...datosPrevios,
        pdfFirmado
    };

    await guardarRegistroDb(pool, {
        imagenDriveFileId: datosGuardar.imagenMapa?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    return { ...construirRespuesta(registro, datosGuardar), pdfFirmado };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_IMAGEN,
    NOMBRE_PDF_ARCHIVO,
    IMAGEN_DRIVE_FILE_ID_DEFECTO,
    CARPETA_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirImagenMapa,
    subirPdfFirmado,
    obtenerImagenMapaBuffer,
    sanitizarDatos
};
