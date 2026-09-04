/**
 * DG-F-08 · Filosofía Biznaga Risk and Tech — persistencia en biznaga_sgc, plantilla Word y PDF en Drive.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-08';
const CARPETA_DRIVE_ID = '1DhhFFFEdAWwJtisyv4A1YUe2b2Xvj5uT';
const TEMPLATE_DRIVE_ID = '1I_w2I7K2cm4HSsqnF1xk7Zz1OsXGldLq';
const NOMBRE_PLANTILLA_DOCX = 'DG-F-08 Filosofía Biznaga Risk and Tech.docx';
const NOMBRE_PDF_ARCHIVO = 'DG-F-08 Filosofía Biznaga Risk and Tech.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2026-03-17',
    revision: '00',
    mision:
        'Somos una organización líder en consultoría estratégica y de gestión en seguridad industrial, salud ocupacional y de medio ambiente, estamos comprometidos en todo momento con generar procesos de calidad que apoyen al crecimiento de nuestros clientes.',
    vision:
        'Ser ampliamente reconocido a nivel nacional por desarrollar soluciones confiables en consultoría y gestión, para mejorar la vida de las personas dentro de las empresas y contribuir al aumento de la rentabilidad en los procesos productivos de nuestros clientes.',
    valores:
        'CONFIANZA: Soy confiable, cuando actúo de una manera adecuada ante una situación, creando un ambiente de seguridad en mi entorno.\n\nHONESTIDAD: Soy honesto cuando soy congruente entre lo que se pienso y lo que hago, anteponiendo la verdad en mis acciones.\n\nRESPONSABILIDAD: Soy responsable cuando, reconozco y acepto las consecuencias de mis actos, entendiendo que estos no deben afectar de forma negativa a nadie, incluyéndose él mismo.\n\nPERSISTENTE: Soy persistente cuando tengo la firmeza y el carácter suficiente para lograr el propósito de la organización.\n\nCOMPROMISO: Soy comprometido cuando transformo una promesa en realidad, logrando los objetivos de la organización.\n\nDISCIPLINA: Soy disciplinado cuando tengo una actuación ordenada y perseverante, con la finalidad de llegar a un bien común para la empresa.',
    codigoTrabajoEquipo:
        'El trabajo en equipo es el resultado de un grupo de personas con sentido de pertenencia a la empresa, que trabaja para un fin común, compartiendo los mismos valores institucionales, lo cual incluye:\n\n• Colaborar con cada uno de los integrantes en el tiempo y espacio que me corresponde.\n• Tener apertura y respeto por las nuevas ideas sin importar quien las aporte.\n• Con mis actos busco el bien común del equipo.\n• Comparto información relevante para la mejora del grupo.\n• Contagio el sentido de pertenencia.',
    firmante: 'Marisol Azucena Santillán Melo',
    cargoFirmante: 'DIRECTORA GENERAL',
    pdfFirmado: null
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return String(fecha).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
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

function incrementarRevision(revisionActual) {
    const num = parseInt(String(revisionActual || '0').trim(), 10);
    const siguiente = Number.isNaN(num) ? 1 : num + 1;
    return String(siguiente).padStart(2, '0');
}

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function lineasValores(texto) {
    return normalizarSaltosLinea(texto).split(/\n\n+/).map((l) => l.trim()).filter(Boolean);
}

function partesCodigoTrabajoEquipo(texto) {
    const norm = normalizarSaltosLinea(texto);
    const bloques = norm.split(/\n\n+/);
    const intro = bloques[0] || '';
    const bullets = norm
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('•'))
        .map((l) => l.replace(/^•\s*/, '').trim());
    return { intro, bullets };
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotPlantillaDesdeDatos(raw);
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    return {
        mision: base.mision,
        vision: base.vision,
        valores: base.valores,
        codigoTrabajoEquipo: base.codigoTrabajoEquipo,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante,
        revision: base.revision,
        fechaElaboracion: base.fechaElaboracion
    };
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = String(textoNuevo ?? '');
    if (!anterior.trim() || anterior === nuevo) {
        return null;
    }
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: false },
            replaceText: nuevo
        }
    };
}

function construirRequestsPlantilla(snapshot, destino) {
    const requests = [
        crearReplaceRequest(textoParrafoDoc(snapshot.mision), textoParrafoDoc(destino.mision)),
        crearReplaceRequest(textoParrafoDoc(snapshot.vision), textoParrafoDoc(destino.vision)),
        crearReplaceRequest(textoParrafoDoc(snapshot.firmante), textoParrafoDoc(destino.firmante)),
        crearReplaceRequest(textoParrafoDoc(snapshot.cargoFirmante), textoParrafoDoc(destino.cargoFirmante)),
        crearReplaceRequest(
            `Revisión: ${String(snapshot.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`,
            `Revisión: ${String(destino.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`
        ),
        crearReplaceRequest(
            `Fecha de rev: ${formatearFechaPlantillaDoc(snapshot.fechaElaboracion)}`,
            `Fecha de rev: ${formatearFechaPlantillaDoc(destino.fechaElaboracion)}`
        )
    ];

    const valoresAnt = lineasValores(snapshot.valores);
    const valoresNue = lineasValores(destino.valores);
    const maxValores = Math.max(valoresAnt.length, valoresNue.length);
    for (let i = 0; i < maxValores; i += 1) {
        const ant = valoresAnt[i];
        const nue = valoresNue[i];
        if (!ant || !nue) continue;
        requests.push(crearReplaceRequest(textoParrafoDoc(ant), textoParrafoDoc(nue)));
    }

    const codigoAnt = partesCodigoTrabajoEquipo(snapshot.codigoTrabajoEquipo);
    const codigoNue = partesCodigoTrabajoEquipo(destino.codigoTrabajoEquipo);
    requests.push(
        crearReplaceRequest(textoParrafoDoc(codigoAnt.intro), textoParrafoDoc(codigoNue.intro))
    );
    const maxBullets = Math.max(codigoAnt.bullets.length, codigoNue.bullets.length);
    for (let i = 0; i < maxBullets; i += 1) {
        const ant = codigoAnt.bullets[i];
        const nue = codigoNue.bullets[i];
        if (!ant || !nue) continue;
        requests.push(crearReplaceRequest(textoParrafoDoc(ant), textoParrafoDoc(nue)));
    }

    return requests.filter(Boolean);
}

async function copiarPlantillaComoGoogleDoc() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: `_temp_dg_f08_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo convertir la plantilla Word a Google Doc.');
    }
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

async function sincronizarPlantillaGoogleDoc(datos, snapshotAnterior) {
    const snapshot = snapshotPlantillaDesdeDatos(snapshotAnterior || DATOS_DEFECTO);
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarPlantillaComoGoogleDoc();

    try {
        const requests = construirRequestsPlantilla(snapshot, destino);
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }

        const docxResp = await drive.files.export(
            { fileId: docId, mimeType: DOCX_MIME },
            { responseType: 'arraybuffer' }
        );
        const docxBuffer = Buffer.from(docxResp.data);

        await driveService.reemplazarArchivoEnDrive(
            TEMPLATE_DRIVE_ID,
            docxBuffer,
            DOCX_MIME,
            NOMBRE_PLANTILLA_DOCX
        );

        return {
            actualizado: requests.length > 0,
            plantillaSync: destino
        };
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[DG-F-08] No se pudo eliminar copia temporal de plantilla:', err.message);
        }
    }
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
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        mision: normalizarSaltosLinea(base.mision || DATOS_DEFECTO.mision),
        vision: normalizarSaltosLinea(base.vision || DATOS_DEFECTO.vision),
        valores: normalizarSaltosLinea(base.valores || DATOS_DEFECTO.valores),
        codigoTrabajoEquipo: normalizarSaltosLinea(base.codigoTrabajoEquipo || DATOS_DEFECTO.codigoTrabajoEquipo),
        firmante: String(base.firmante || DATOS_DEFECTO.firmante).trim(),
        cargoFirmante: String(base.cargoFirmante || DATOS_DEFECTO.cargoFirmante).trim(),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        plantillaSync
    };
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    return {
        empresa: base.empresa,
        mision: base.mision,
        vision: base.vision,
        valores: base.valores,
        codigoTrabajoEquipo: base.codigoTrabajoEquipo,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(extraerContenidoEditable(a)) === JSON.stringify(extraerContenidoEditable(b));
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

async function leerDatosRegistro(registro) {
    if (!registro?.datos_json) return null;
    try {
        const parsed = typeof registro.datos_json === 'string'
            ? JSON.parse(registro.datos_json)
            : registro.datos_json;
        return sanitizarDatos(parsed);
    } catch {
        return null;
    }
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

function construirRespuesta(registro, datos) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
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
            fechaElaboracion: fechaMostrar,
            pdfFirmado
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, {
                pdfDriveFileId: pdfResuelto.driveFileId,
                datos,
                fechaElaboracionOriginal: registro.fecha_elaboracion_original,
                fechaModificacionContenido: registro.fecha_modificacion_contenido,
                contenidoModificado: !!registro.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        }
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            ultima_sync_drive: null
        };
    }

    return construirRespuesta(registro, datos);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    let revision = datosEntrada.revision || DATOS_DEFECTO.revision;

    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

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

    if (datosPrevios) {
        revision = datosPrevios.revision;
    }

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const huboCambioContenido = datosPrevios
        ? !contenidoEsEquivalente(datosPrevios, datosEntrada)
        : !contenidoEsEquivalente(DATOS_DEFECTO, datosEntrada);

    if (huboCambioContenido && origen !== 'consulta') {
        revision = incrementarRevision(revision);
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        empresa: datosEntrada.empresa,
        mision: datosEntrada.mision,
        vision: datosEntrada.vision,
        valores: datosEntrada.valores,
        codigoTrabajoEquipo: datosEntrada.codigoTrabajoEquipo,
        firmante: datosEntrada.firmante,
        cargoFirmante: datosEntrada.cargoFirmante,
        revision,
        fechaElaboracion,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        plantillaSync: datosPrevios?.plantillaSync || null
    };

    if (huboCambioContenido && origen !== 'consulta') {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(
                datosGuardar,
                datosPrevios || DATOS_DEFECTO
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
        } catch (err) {
            console.error('[DG-F-08] Error sincronizando plantilla Word en Drive:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    const nombreArchivo = nombrePdfHistorial();
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const datosGuardar = { ...datosPrevios, pdfFirmado };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;
    const contenidoModificado = !!registroPrevio?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    await guardarRegistroDb(pool, {
        pdfDriveFileId: pdfFirmado.driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return { ...construirRespuesta(registro, datosGuardar), pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    const respuesta = await cargarFormato(pool);
    const datos = respuesta.datos;
    const snapshot = datos.plantillaSync || snapshotPlantillaDesdeDatos(datos);

    try {
        const syncResult = await sincronizarPlantillaGoogleDoc(datos, snapshot);
        if (syncResult.plantillaSync) {
            const registro = await obtenerRegistroDb(pool);
            const datosActuales = (await leerDatosRegistro(registro)) || datos;
            const datosActualizados = {
                ...datosActuales,
                plantillaSync: syncResult.plantillaSync
            };
            await guardarRegistroDb(pool, {
                pdfDriveFileId: datosActualizados.pdfFirmado?.driveFileId || null,
                datos: datosActualizados,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
        }
    } catch (err) {
        console.warn('[DG-F-08] Descarga PDF: sync parcial, exportando plantilla actual:', err.message);
    }

    return driveService.exportarArchivoPDF(TEMPLATE_DRIVE_ID);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    sanitizarDatos
};
