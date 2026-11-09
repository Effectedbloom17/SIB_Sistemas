/**
 * DG-F-08 · Filosofía Biznaga Risk and Tech — persistencia en biznaga_sgc y documento de trabajo en Drive.
 *
 * Flujo plantilla → sistema (docs/GUIA-PLANTILLA-WORD-SGC.md):
 * - Plantilla externa (solo lectura): {{codigo}} {{num_rev}} {{fecha}}
 *   {{texto_mision}} {{texto_vision}} {{texto_valores}} {{texto_codigotrabajo}}.
 * - Documento sistema: copia de trabajo en CARPETA_DRIVE_ID.
 * - Words viejos al regenerar (cambio de rev / plantilla): CARPETA_HISTORIAL_DRIVE_ID.
 * - Código / No. Rev / Fecha se rescatan de Lista Maestra (sgc_formato_metadatos / F-01).
 */
const crypto = require('crypto');
const { google } = require('googleapis');
const JSZip = require('jszip');
const driveService = require('./driveService');
const pdfDescargaCache = require('./sgcPdfDescargaCache');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'DG-F-08';
/** Carpeta de trabajo del Word vigente. */
const CARPETA_DRIVE_ID = '1DhhFFFEdAWwJtisyv4A1YUe2b2Xvj5uT';
/** Historial de Versiones — Words sistema previos. */
const CARPETA_HISTORIAL_DRIVE_ID = '1BXmG87IePVEHm93fj_CTL3giZwG4SUix';
/** Plantilla maestra Word (solo lectura / files.copy). */
const TEMPLATE_DRIVE_ID = '1bX_RWKjiVwwpHzVZfmRpP71qvv-v9-4k';
/**
 * Subir cuando cambien placeholders o la estructura que el sync debe rellenar.
 * Si el dato guardado es menor, el siguiente load archiva y regenera.
 */
const PLANTILLA_CONTENIDO_VERSION = 1;
const NOMBRE_DOCUMENTO_SISTEMA = 'DG-F-08 Filosofía Biznaga Risk and Tech (sistema).docx';
const NOMBRE_PDF_ARCHIVO = 'DG-F-08 Filosofía Biznaga Risk and Tech.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TIMEZONE_MEXICO = 'America/Mexico_City';
/** Cuerpo, código de trabajo y firma del Word. Los títulos de sección se quedan en 11. */
const TAMANO_TEXTO_PT = 9;
const TAMANO_TITULO_SECCION_PT = 11;
const TITULOS_SECCION_DG_F08 = new Set([
    'Misión',
    'Visión',
    'Valores',
    'Código de trabajo en equipo'
]);

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2026-03-17',
    fechaRevision: '2026-03-17',
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
    pdfFirmado: null,
    pdfsHistorial: [],
    documentoSistemaDriveFileId: null,
    plantillaSistemaDriveFileId: null,
    plantillaOrigenDriveId: null,
    plantillaContenidoVersion: 0,
    plantillaDriveFileId: TEMPLATE_DRIVE_ID
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Respeta cadenas vacías (borrados del usuario); solo usa defecto si falta el campo. */
function textoEditable(valor, defecto = '') {
    if (valor === undefined || valor === null) {
        return normalizarSaltosLinea(defecto);
    }
    return normalizarSaltosLinea(valor);
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Quita basura de sync previo: misión pegada a un valor sin espacio/salto. */
function depurarValoresCorruptos(valores, mision) {
    let texto = normalizarSaltosLinea(valores);
    const misionLimpia = normalizarSaltosLinea(mision);
    if (!texto || !misionLimpia) return texto;

    if (texto.includes(misionLimpia)) {
        texto = texto.split(misionLimpia).join('');
    }
    const inicioMision = escaparRegex(misionLimpia.slice(0, Math.min(24, misionLimpia.length)));
    if (inicioMision) {
        texto = texto.replace(new RegExp(`([A-Za-zÁÉÍÓÚáéíóúñÑ.])${inicioMision}`, 'g'), '$1');
        texto = texto.replace(/Somos una organización líder[\s\S]*$/gm, '');
    }
    return normalizarSaltosLinea(
        texto
            .split(/\n\n+/)
            .map((p) => p.trim())
            .filter(Boolean)
            .join('\n\n')
    );
}

function formatearFechaIso(fecha) {
    return formatearFechaIsoMexico(fecha);
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
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(new Date());
}

function siguienteVersionPdf(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const prefijo = `${base} - ${mm}/${yy}`;
    let max = 0;
    const fuentes = Array.isArray(historialDrive) ? historialDrive : [];
    const seen = new Set();
    for (const p of fuentes) {
        const n = String(p?.nombreArchivo || p?.name || '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const mVer = n.match(new RegExp(`^${escaparRegex(prefijo)} - (\\d{1,2})\\.pdf$`, 'i'));
        if (mVer) {
            max = Math.max(max, parseInt(mVer[1], 10) || 0);
            continue;
        }
        if (new RegExp(`^${escaparRegex(prefijo)}\\.pdf$`, 'i').test(n)) {
            max = Math.max(max, 1);
        }
    }
    return String(max + 1).padStart(2, '0');
}

function nombrePdfHistorial(fechaIso = fechaHoyIso(), historialDrive = []) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const version = siguienteVersionPdf(iso, historialDrive);
    return `${base} - ${mm}/${yy} - ${version}.pdf`;
}

function esNombrePdfDelFormato(nombre) {
    const base = NOMBRE_PDF_ARCHIVO.replace(/\.pdf$/i, '');
    const n = String(nombre || '').trim();
    return n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()
        || new RegExp(`^${escaparRegex(base)} - \\d{2}/\\d{2}( - \\d{1,2})?\\.pdf$`, 'i').test(n);
}

function formatearFechaIsoMexico(fecha) {
    if (!fecha) return '';
    if (typeof fecha === 'string') {
        const trimmed = fecha.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed.slice(0, 10))) {
            return trimmed.slice(0, 10);
        }
        if (/^\d{4}-\d{2}-\d{2}\s/.test(trimmed)) {
            return trimmed.slice(0, 10);
        }
    }
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) {
        return String(fecha).slice(0, 10);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(dt);
}

function formatearFechaPlantillaDoc(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function formatearRevisionPlantillaDoc(revision) {
    return String(revision || DATOS_DEFECTO.revision).trim().padStart(2, '0');
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

function sanitizarPdfsHistorial(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const pdf = sanitizarPdfFirmado(item);
        if (!pdf || seen.has(pdf.driveFileId)) continue;
        seen.add(pdf.driveFileId);
        out.push(pdf);
    }
    return out;
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    const sistemaId = String(
        base.plantillaSistemaDriveFileId
        || base.documentoSistemaDriveFileId
        || ''
    ).trim() || null;
    const sistemaValido = sistemaId && sistemaId !== TEMPLATE_DRIVE_ID ? sistemaId : null;
    const mision = textoEditable(base.mision, DATOS_DEFECTO.mision);
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        revision: formatearRevisionPlantillaDoc(base.revision),
        mision,
        vision: textoEditable(base.vision, DATOS_DEFECTO.vision),
        valores: depurarValoresCorruptos(
            textoEditable(base.valores, DATOS_DEFECTO.valores),
            mision
        ),
        codigoTrabajoEquipo: textoEditable(base.codigoTrabajoEquipo, DATOS_DEFECTO.codigoTrabajoEquipo),
        firmante: textoEditable(base.firmante, DATOS_DEFECTO.firmante),
        cargoFirmante: textoEditable(base.cargoFirmante, DATOS_DEFECTO.cargoFirmante),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial || base.pdfs_historial),
        documentoSistemaDriveFileId: sistemaValido,
        plantillaSistemaDriveFileId: sistemaValido,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaOrigenDriveId: String(base.plantillaOrigenDriveId || '').trim() || null,
        plantillaContenidoVersion: Number(base.plantillaContenidoVersion || 0) || 0,
        plantillaSync
    };
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
        fechaRevision: base.fechaRevision,
        fechaElaboracion: base.fechaElaboracion,
        codigo: CODIGO_FORMATO
    };
}

/**
 * Cabecera oficial del Word: Código / Revisión / Fecha de rev ← Lista Maestra.
 * Prioridad: metadatos SGC → catálogo F-01 → defecto.
 */
async function resolverCabeceraListaMaestra(pool, datosActuales = {}) {
    const base = sanitizarDatos(datosActuales);
    let revision = formatearRevisionPlantillaDoc(base.revision);
    let fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;
    let desdeMetadatos = false;

    if (pool) {
        try {
            const [rows] = await pool.query(
                `SELECT revision, fecha_original
                   FROM sgc_formato_metadatos
                  WHERE UPPER(TRIM(codigo_formato)) = ?
                  LIMIT 1`,
                [CODIGO_FORMATO]
            );
            const meta = rows?.[0];
            if (meta) {
                if (meta.revision != null && String(meta.revision).trim() !== '') {
                    revision = formatearRevisionPlantillaDoc(meta.revision);
                    desdeMetadatos = true;
                }
                const fechaMeta = formatearFechaIso(meta.fecha_original);
                if (fechaMeta) {
                    fechaRevision = fechaMeta;
                    desdeMetadatos = true;
                }
            }
        } catch (err) {
            console.warn('[DG-F-08] Metadatos lista maestra omitidos:', err.message);
        }
    }

    if (!desdeMetadatos) {
        try {
            const { CATALOGO_BASE } = require('./sgcSgcF01Service');
            const fila = (CATALOGO_BASE || []).find(
                (d) => String(d?.codigo || '').trim().toUpperCase() === CODIGO_FORMATO
            );
            if (fila) {
                if (fila.versionVigente) {
                    revision = formatearRevisionPlantillaDoc(fila.versionVigente);
                }
                const fechaFila = formatearFechaIso(fila.fechaRevision);
                if (fechaFila) {
                    fechaRevision = fechaFila;
                }
            }
        } catch (err) {
            console.warn('[DG-F-08] Catálogo F-01 omitido para cabecera:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        revision,
        fechaRevision
    };
}

function snapshotParaReemplazo(snapshotAnterior) {
    if (!snapshotAnterior) {
        return snapshotPlantillaDesdeDatos(DATOS_DEFECTO);
    }
    if (snapshotAnterior.plantillaSync) {
        return snapshotPlantillaDesdeDatos(snapshotAnterior.plantillaSync);
    }
    return snapshotPlantillaDesdeDatos(snapshotAnterior);
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '');
    const nuevo = String(textoNuevo ?? '');
    if (!anterior.trim() || anterior === nuevo) return null;
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: true },
            replaceText: nuevo
        }
    };
}

/** Fecha del Word = fecha de revisión (lista maestra), no la de elaboración. */
function fechaCabeceraWord(destino) {
    return formatearFechaPlantillaDoc(destino.fechaRevision || DATOS_DEFECTO.fechaRevision);
}

function reemplazosCampo(claves, texto) {
    const valor = normalizarSaltosLinea(texto);
    const requests = [];
    for (const clave of claves) {
        requests.push(crearReplaceRequest(`{{${clave}}}`, valor));
        requests.push(crearReplaceRequest(`{{${clave.toUpperCase()}}}`, valor));
        // La plantilla en Drive quedó con una llave de apertura: {texto_mision}}
        requests.push(crearReplaceRequest(`{${clave}}}`, valor));
        requests.push(crearReplaceRequest(`{${clave.toUpperCase()}}}`, valor));
    }
    return requests;
}

/**
 * Placeholders de la plantilla. No filtrar los que contienen {{.
 * Cabecera: {{codigo}} {{num_rev}} {{fecha}}.
 * Cuerpo: {{texto_mision}} {{texto_vision}} {{texto_valores}} {{texto_codigotrabajo}}.
 */
function crearReemplazosPlaceholders(destino) {
    const codigo = CODIGO_FORMATO;
    const rev = formatearRevisionPlantillaDoc(destino.revision);
    const fecha = fechaCabeceraWord(destino);
    return [
        ...reemplazosCampo(['codigo'], codigo),
        ...reemplazosCampo(['num_rev'], rev),
        ...reemplazosCampo(['fecha'], fecha),
        ...reemplazosCampo(['texto_mision'], destino.mision),
        ...reemplazosCampo(['texto_vision'], destino.vision),
        ...reemplazosCampo(['texto_valores'], destino.valores),
        ...reemplazosCampo(['texto_codigotrabajo'], destino.codigoTrabajoEquipo)
    ].filter(Boolean);
}

function crearReemplazosCodigo(snapshot, destino) {
    const nuevo = `Código: ${CODIGO_FORMATO}`;
    const codigos = new Set([
        String(snapshot.codigo || CODIGO_FORMATO).trim(),
        CODIGO_FORMATO
    ]);
    return [...codigos]
        .filter((c) => c && `Código: ${c}` !== nuevo)
        .map((c) => crearReplaceRequest(`Código: ${c}`, nuevo))
        .filter(Boolean);
}

function crearReemplazosFecha(snapshot, destino) {
    const fecha = fechaCabeceraWord(destino);
    const fechasAnteriores = new Set([
        formatearFechaPlantillaDoc(snapshot.fechaRevision),
        formatearFechaPlantillaDoc(snapshot.fechaElaboracion),
        formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaRevision),
        fecha
    ]);
    const requests = [];
    for (const f of fechasAnteriores) {
        if (!f) continue;
        if (`Fecha de rev: ${f}` !== `Fecha de rev: ${fecha}`) {
            requests.push(crearReplaceRequest(`Fecha de rev: ${f}`, `Fecha de rev: ${fecha}`));
        }
        if (`Fecha: ${f}` !== `Fecha: ${fecha}`) {
            requests.push(crearReplaceRequest(`Fecha: ${f}`, `Fecha: ${fecha}`));
        }
    }
    return requests.filter(Boolean);
}

function crearReemplazosRevision(snapshot, destino) {
    const revNuevo = formatearRevisionPlantillaDoc(destino.revision);
    const revisiones = new Set([
        formatearRevisionPlantillaDoc(snapshot.revision),
        formatearRevisionPlantillaDoc(DATOS_DEFECTO.revision),
        revNuevo
    ]);
    const requests = [];
    for (const r of revisiones) {
        if (`Revisión: ${r}` !== `Revisión: ${revNuevo}`) {
            requests.push(crearReplaceRequest(`Revisión: ${r}`, `Revisión: ${revNuevo}`));
        }
        if (`No. Rev: ${r}` !== `No. Rev: ${revNuevo}`) {
            requests.push(crearReplaceRequest(`No. Rev: ${r}`, `No. Rev: ${revNuevo}`));
        }
    }
    return requests.filter(Boolean);
}

function crearReemplazoTexto(anterior, nuevo) {
    const ant = normalizarSaltosLinea(anterior);
    const nue = normalizarSaltosLinea(nuevo);
    if (!ant || ant === nue || ant.includes('{{') || ant.includes('{texto_')) return null;
    return crearReplaceRequest(ant, nue);
}

function construirRequestsPlantilla(snapshot, destino) {
    return [
        ...crearReemplazosPlaceholders(destino),
        crearReemplazoTexto(snapshot.mision, destino.mision),
        crearReemplazoTexto(snapshot.vision, destino.vision),
        crearReemplazoTexto(snapshot.valores, destino.valores),
        crearReemplazoTexto(snapshot.codigoTrabajoEquipo, destino.codigoTrabajoEquipo),
        ...crearReemplazosCodigo(snapshot, destino),
        ...crearReemplazosRevision(snapshot, destino),
        ...crearReemplazosFecha(snapshot, destino)
    ].filter(Boolean);
}

function extraerTextoDeContent(content) {
    let text = '';
    for (const el of content || []) {
        if (el.paragraph) {
            for (const pe of el.paragraph.elements || []) {
                if (pe.textRun?.content) text += pe.textRun.content;
            }
        }
        if (el.table) {
            for (const row of el.table.tableRows || []) {
                for (const cell of row.tableCells || []) {
                    text += extraerTextoDeContent(cell.content);
                }
            }
        }
    }
    return text;
}

function extraerTextoCompletoGoogleDoc(docData) {
    let text = extraerTextoDeContent(docData?.body?.content);
    for (const h of Object.values(docData?.headers || {})) {
        text += `\n${extraerTextoDeContent(h.content)}`;
    }
    for (const f of Object.values(docData?.footers || {})) {
        text += `\n${extraerTextoDeContent(f.content)}`;
    }
    return text;
}

function documentoReflejaDestino(texto, destino) {
    const t = String(texto || '');
    if (/\{\{?\s*(texto_mision|texto_vision|texto_valores|texto_codigotrabajo|codigo|num_rev|fecha)\s*\}\}/i.test(t)) {
        return false;
    }
    const rev = formatearRevisionPlantillaDoc(destino.revision);
    const fecha = fechaCabeceraWord(destino);
    if (rev && !t.includes(rev)) return false;
    if (fecha && !t.includes(fecha)) return false;
    if (!t.includes(CODIGO_FORMATO)) return false;
    const campos = [
        destino.mision,
        destino.vision,
        destino.valores,
        destino.codigoTrabajoEquipo
    ];
    for (const campo of campos) {
        const muestra = normalizarSaltosLinea(campo).slice(0, 40);
        if (muestra && !t.includes(muestra)) return false;
    }
    return true;
}

async function buscarDocumentoSistemaEnDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    return (archivos || []).find((f) => String(f.name || '').toLowerCase() === objetivo) || null;
}

async function validarDocumentoSistemaEnDrive(fileId) {
    const id = String(fileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) return false;
    try {
        const auth = driveService.getAuthClient();
        if (!auth) return false;
        const drive = google.drive({ version: 'v3', auth });
        const resp = await drive.files.get({
            fileId: id,
            fields: 'id, name, trashed',
            supportsAllDrives: true
        });
        if (resp.data.trashed) return false;
        return String(resp.data.name || '').toLowerCase() === NOMBRE_DOCUMENTO_SISTEMA.toLowerCase();
    } catch {
        return false;
    }
}

async function resolverDocumentoSistemaId(datos) {
    const idDb = String(datos?.plantillaSistemaDriveFileId || datos?.documentoSistemaDriveFileId || '').trim();
    if (idDb && await validarDocumentoSistemaEnDrive(idDb)) return idDb;
    const enDrive = await buscarDocumentoSistemaEnDrive();
    return enDrive?.id || null;
}

function nombreArchivoHistorialWord(datos = {}) {
    const rev = formatearRevisionPlantillaDoc(datos.revision || DATOS_DEFECTO.revision);
    const fecha = formatearFechaIso(datos.fechaRevision || datos.fechaElaboracion) || fechaHoyIso();
    const stamp = fecha.replace(/-/g, '');
    return `DG-F-08 Filosofía Biznaga Risk and Tech (sistema) - Rev ${rev} - ${stamp}.docx`;
}

/**
 * Mueve el Word sistema vigente al Historial de Versiones (no borra).
 */
async function archivarDocumentoSistemaActual(sistemaFileId, datos = {}) {
    const id = String(sistemaFileId || '').trim();
    if (!id || id === TEMPLATE_DRIVE_ID) return null;
    try {
        const nombreHist = nombreArchivoHistorialWord(datos);
        await driveService.renombrarArchivoPorId(id, nombreHist).catch((err) => {
            console.warn('[DG-F-08] No se pudo renombrar Word antes de archivar:', err.message);
        });
        await driveService.moverArchivoDrive(id, CARPETA_HISTORIAL_DRIVE_ID);
        console.log(`[DG-F-08] Word sistema archivado → Historial: ${nombreHist} (${id})`);
        return id;
    } catch (err) {
        console.warn('[DG-F-08] No se pudo archivar Word sistema:', err.message);
        return null;
    }
}

async function crearDocumentoSistemaDesdePlantilla() {
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        supportsAllDrives: true,
        requestBody: {
            name: NOMBRE_DOCUMENTO_SISTEMA,
            parents: [CARPETA_DRIVE_ID]
        },
        fields: 'id, name, webViewLink'
    });
    const fileId = copyResp?.data?.id;
    if (!fileId || fileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo crear el documento DG-F-08 (sistema) desde la plantilla.');
    }
    console.log(`[DG-F-08] Documento sistema creado desde plantilla: ${NOMBRE_DOCUMENTO_SISTEMA} (${fileId})`);
    return fileId;
}

/**
 * true si hay que archivar el Word vigente y copiar de nuevo la plantilla:
 * - sin origen o plantilla distinta
 * - versión de contenido de plantilla desactualizada
 * - cambió la revisión o la fecha de revisión de la lista maestra
 */
function debeRegenerarDocumentoSistema(datos, cabeceraLista) {
    const origen = String(datos?.plantillaOrigenDriveId || '').trim();
    if (!origen || origen !== TEMPLATE_DRIVE_ID) return true;
    if (Number(datos?.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION) return true;
    const sync = datos?.plantillaSync;
    if (!sync) return false;
    const revSync = formatearRevisionPlantillaDoc(sync.revision);
    const revLista = formatearRevisionPlantillaDoc(cabeceraLista.revision);
    if (revSync !== revLista) return true;
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaLista = formatearFechaIso(cabeceraLista.fechaRevision);
    if (fechaSync && fechaLista && fechaSync !== fechaLista) return true;
    return false;
}

async function asegurarDocumentoSistema(datos, opciones = {}) {
    const existente = await resolverDocumentoSistemaId(datos);
    const forzarRegenerar = !!opciones.forzarRegenerar;

    if (existente && !forzarRegenerar) {
        return { fileId: existente, newlyCreated: false, regenerated: false };
    }

    if (existente && forzarRegenerar) {
        await archivarDocumentoSistemaActual(existente, {
            revision: datos?.plantillaSync?.revision || datos?.revision,
            fechaRevision: datos?.plantillaSync?.fechaRevision || datos?.fechaRevision,
            fechaElaboracion: datos?.plantillaSync?.fechaElaboracion || datos?.fechaElaboracion
        });
    }

    const fileId = await crearDocumentoSistemaDesdePlantilla();
    return {
        fileId,
        newlyCreated: !existente,
        regenerated: !!existente && forzarRegenerar
    };
}

async function copiarDocumentoComoGoogleDoc(sourceFileId) {
    if (!sourceFileId || sourceFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se edita la plantilla maestra de DG-F-08.');
    }
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: sourceFileId,
        supportsAllDrives: true,
        requestBody: {
            name: `_temp_dg_f08_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) throw new Error('No se pudo abrir el documento sistema como Google Doc.');
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

function textoPlanoParrafoDocx(xmlParrafo) {
    return [...String(xmlParrafo || '').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
        .join('')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function fijarTamanoParrafoDocx(xmlParrafo, puntos) {
    const medio = String(Math.round(Number(puntos) * 2));
    let xml = String(xmlParrafo || '')
        .replace(/<w:sz w:val="\d+"/g, `<w:sz w:val="${medio}"`)
        .replace(/<w:szCs w:val="\d+"/g, `<w:szCs w:val="${medio}"`);
    if (!/<w:sz /.test(xml)) {
        xml = xml.replace(/<w:rPr>/g, `<w:rPr><w:sz w:val="${medio}"/><w:szCs w:val="${medio}"/>`);
    }
    return xml;
}

/**
 * El roundtrip por Google Docs sube el cuerpo a 10 pt.
 * El texto (misión, visión, valores, código y firma) queda en 9; los títulos de sección, en 11.
 */
function aplicarTamanoTextoXml(xml) {
    return String(xml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, (parrafo) => {
        const texto = textoPlanoParrafoDocx(parrafo);
        if (!texto || texto.startsWith('FILOSOFÍA BIZNAGA')) return parrafo;
        if (TITULOS_SECCION_DG_F08.has(texto)) {
            return fijarTamanoParrafoDocx(parrafo, TAMANO_TITULO_SECCION_PT);
        }
        return fijarTamanoParrafoDocx(parrafo, TAMANO_TEXTO_PT);
    });
}

/**
 * La plantilla deja 2 párrafos vacíos antes de cada título de sección.
 * Al rellenar con saltos de línea, Google Docs a veces mete uno extra (p. ej. Visión → Valores).
 */
const MAX_VACIOS_ANTES_SECCION = 2;
/** Enters después del salto de hoja para centrar "Código de trabajo en equipo". */
const VACIOS_ANTES_CODIGO_TRABAJO = 9;
const TITULO_CODIGO_TRABAJO = 'Código de trabajo en equipo';
const PARRAFO_SALTO_PAGINA_DOCX =
    '<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Century Gothic" w:cs="Century Gothic" w:eastAsia="Century Gothic" w:hAnsi="Century Gothic"/><w:b w:val="1"/><w:bCs w:val="1"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
const PARRAFO_VACIO_DOCX =
    '<w:p><w:pPr><w:jc w:val="both"/><w:rPr><w:rFonts w:ascii="Century Gothic" w:cs="Century Gothic" w:eastAsia="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:pPr></w:p>';

function tieneSaltoPaginaDocx(xmlParrafo) {
    return /<w:br\b[^>]*w:type="page"/.test(String(xmlParrafo || ''));
}

function esParrafoVacioDocx(xmlParrafo) {
    // Un párrafo solo con salto de hoja no es “vacío” borrable.
    if (tieneSaltoPaginaDocx(xmlParrafo)) return false;
    return !textoPlanoParrafoDocx(xmlParrafo);
}

function partirDocumentXmlEnPartes(xml) {
    const partes = [];
    const re = /<w:p\b[\s\S]*?<\/w:p>/g;
    let ultimo = 0;
    let m;
    const fuente = String(xml || '');
    while ((m = re.exec(fuente)) !== null) {
        if (m.index > ultimo) partes.push({ tipo: 'otro', xml: fuente.slice(ultimo, m.index) });
        partes.push({ tipo: 'p', xml: m[0] });
        ultimo = m.index + m[0].length;
    }
    if (ultimo < fuente.length) {
        partes.push({ tipo: 'otro', xml: fuente.slice(ultimo) });
    }
    return partes;
}

function compactarEspaciosEntreSeccionesXml(xml) {
    const partes = partirDocumentXmlEnPartes(xml);
    const indicesParrafo = [];
    for (let i = 0; i < partes.length; i += 1) {
        if (partes[i].tipo === 'p') indicesParrafo.push(i);
    }

    const eliminar = new Set();
    for (let k = 0; k < indicesParrafo.length; k += 1) {
        const idx = indicesParrafo[k];
        const titulo = textoPlanoParrafoDocx(partes[idx].xml);
        if (!TITULOS_SECCION_DG_F08.has(titulo)) continue;
        // El aire superior de "Código…" lo fija asegurarPaginaCodigoTrabajoXml.
        if (titulo === TITULO_CODIGO_TRABAJO) continue;

        const vacios = [];
        for (let j = k - 1; j >= 0; j -= 1) {
            const prev = indicesParrafo[j];
            if (tieneSaltoPaginaDocx(partes[prev].xml)) break;
            if (!esParrafoVacioDocx(partes[prev].xml)) break;
            vacios.push(prev);
        }
        vacios.reverse();
        for (let n = 0; n < vacios.length - MAX_VACIOS_ANTES_SECCION; n += 1) {
            eliminar.add(vacios[n]);
        }
    }

    return partes
        .filter((_, i) => !eliminar.has(i))
        .map((p) => p.xml)
        .join('');
}

/**
 * "Código de trabajo en equipo" va en hoja aparte y bajado al centro (~9 enters).
 * El export por Google Docs a veces pierde el salto y el aire superior.
 */
function asegurarPaginaCodigoTrabajoXml(xml) {
    const partes = partirDocumentXmlEnPartes(xml);
    let idxTituloPartes = -1;
    for (let i = 0; i < partes.length; i += 1) {
        if (partes[i].tipo !== 'p') continue;
        if (textoPlanoParrafoDocx(partes[i].xml) === TITULO_CODIGO_TRABAJO) {
            idxTituloPartes = i;
            break;
        }
    }
    if (idxTituloPartes < 0) return String(xml || '');

    let idxBreakPartes = -1;
    for (let i = idxTituloPartes - 1; i >= 0; i -= 1) {
        if (partes[i].tipo !== 'p') continue;
        if (tieneSaltoPaginaDocx(partes[i].xml)) {
            idxBreakPartes = i;
            break;
        }
        if (!esParrafoVacioDocx(partes[i].xml)) break;
    }
    if (idxBreakPartes < 0) {
        partes.splice(idxTituloPartes, 0, { tipo: 'p', xml: PARRAFO_SALTO_PAGINA_DOCX });
        idxBreakPartes = idxTituloPartes;
        idxTituloPartes += 1;
    }

    const vaciosEntre = [];
    for (let i = idxBreakPartes + 1; i < idxTituloPartes; i += 1) {
        if (partes[i].tipo !== 'p') continue;
        if (!esParrafoVacioDocx(partes[i].xml)) {
            // Contenido inesperado entre salto y título: no tocar.
            return partes.map((p) => p.xml).join('');
        }
        vaciosEntre.push(i);
    }

    if (vaciosEntre.length > VACIOS_ANTES_CODIGO_TRABAJO) {
        const sobran = vaciosEntre.length - VACIOS_ANTES_CODIGO_TRABAJO;
        const quitar = new Set(vaciosEntre.slice(0, sobran));
        return partes
            .filter((_, i) => !quitar.has(i))
            .map((p) => p.xml)
            .join('');
    }

    if (vaciosEntre.length < VACIOS_ANTES_CODIGO_TRABAJO) {
        const faltan = VACIOS_ANTES_CODIGO_TRABAJO - vaciosEntre.length;
        const insertos = [];
        for (let n = 0; n < faltan; n += 1) {
            insertos.push({ tipo: 'p', xml: PARRAFO_VACIO_DOCX });
        }
        partes.splice(idxTituloPartes, 0, ...insertos);
    }

    return partes.map((p) => p.xml).join('');
}

async function aplicarTamanoTextoDocx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const archivo = zip.file('word/document.xml');
    if (!archivo) return Buffer.from(buffer);
    let xml = await archivo.async('string');
    xml = compactarEspaciosEntreSeccionesXml(xml);
    xml = asegurarPaginaCodigoTrabajoXml(xml);
    xml = aplicarTamanoTextoXml(xml);
    zip.file('word/document.xml', xml);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function persistirDocumentoSistema(drive, docId, sistemaFileId) {
    if (!sistemaFileId || sistemaFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('El Word de trabajo no puede ser la plantilla maestra.');
    }
    const docxResp = await drive.files.export(
        { fileId: docId, mimeType: DOCX_MIME },
        { responseType: 'arraybuffer' }
    );
    const docx = await aplicarTamanoTextoDocx(Buffer.from(docxResp.data));
    await driveService.reemplazarArchivoEnDrive(
        sistemaFileId,
        docx,
        DOCX_MIME,
        NOMBRE_DOCUMENTO_SISTEMA
    );
}

async function leerTextoDocumento(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    return extraerTextoCompletoGoogleDoc(doc.data);
}

async function resyncCompletoDesdePlantilla(datos, sistemaFileId) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const drive = google.drive({ version: 'v3', auth });
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        supportsAllDrives: true,
        requestBody: {
            name: `_temp_dg_f08_resync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId || docId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se pudo copiar la plantilla DG-F-08 para rellenar.');
    }
    const docsApi = google.docs({ version: 'v1', auth });
    try {
        const requests = crearReemplazosPlaceholders(destino);
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }
        const texto = await leerTextoDocumento(docsApi, docId);
        if (!documentoReflejaDestino(texto, destino)) {
            console.warn('[DG-F-08] Resync completo: la copia sigue sin reflejar cabecera o filosofía');
        }
        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return destino;
    } finally {
        try {
            await drive.files.delete({ fileId: docId, supportsAllDrives: true });
        } catch (err) {
            console.warn('[DG-F-08] No se pudo eliminar copia temporal de resync:', err.message);
        }
    }
}

async function sincronizarDocumentoSistema(datos, snapshotAnterior, sistemaFileId, opciones = {}) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarDocumentoComoGoogleDoc(sistemaFileId);
    let docIdPendiente = docId;

    try {
        const snapshot = opciones.forzarSnapshotPlantilla
            ? snapshotPlantillaDesdeDatos(DATOS_DEFECTO)
            : snapshotParaReemplazo(snapshotAnterior);
        const requests = construirRequestsPlantilla(snapshot, destino);
        if (requests.length > 0) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        }

        const texto = await leerTextoDocumento(docsApi, docId);
        if (!documentoReflejaDestino(texto, destino)) {
            await drive.files.delete({ fileId: docIdPendiente, supportsAllDrives: true }).catch(() => {});
            docIdPendiente = null;
            const plantillaSync = await resyncCompletoDesdePlantilla(datos, sistemaFileId);
            return { actualizado: true, plantillaSync };
        }

        await persistirDocumentoSistema(drive, docId, sistemaFileId);
        return { actualizado: true, plantillaSync: destino };
    } catch (err) {
        if (docIdPendiente) {
            await drive.files.delete({ fileId: docIdPendiente, supportsAllDrives: true }).catch(() => {});
            docIdPendiente = null;
        }
        console.warn('[DG-F-08] Sync parcial, reintentando desde la plantilla:', err.message);
        const plantillaSync = await resyncCompletoDesdePlantilla(datos, sistemaFileId);
        return { actualizado: true, plantillaSync };
    } finally {
        if (docIdPendiente) {
            try {
                await drive.files.delete({ fileId: docIdPendiente, supportsAllDrives: true });
            } catch (err) {
                console.warn('[DG-F-08] No se pudo eliminar copia temporal de sync:', err.message);
            }
        }
    }
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

async function listarPdfsHistorialDrive() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    return (archivos || [])
        .filter((f) => esNombrePdfDelFormato(f.name))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))
        .map((f) => sanitizarPdfFirmado({
            driveFileId: f.id,
            nombreArchivo: f.name || NOMBRE_PDF_ARCHIVO,
            webViewLink: f.webViewLink || null,
            fechaSubida: f.modifiedTime || fechaHoyIso()
        }))
        .filter(Boolean);
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) return sanitizarPdfFirmado(pdfDb);
    }
    const lista = await listarPdfsHistorialDrive().catch(() => []);
    if (lista[0]?.driveFileId) return lista[0];
    return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
}

async function publicarPdfEnDrive(pdfBuffer, historialDrive = []) {
    const nombreArchivo = nombrePdfHistorial(fechaHoyIso(), historialDrive);
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_DRIVE_ID
    );
}

function construirRespuesta(registro, datos, historialPdfs = [], archivoDrive = null) {
    const fechaOriginal = formatearFechaIsoMexico(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIsoMexico(registro?.fecha_modificacion_contenido);
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

    const documentoSistemaDriveFileId = datos.plantillaSistemaDriveFileId
        || datos.documentoSistemaDriveFileId
        || archivoDrive?.id
        || null;

    const historialDb = sanitizarPdfsHistorial(datos.pdfsHistorial);
    const historialDrive = Array.isArray(historialPdfs) ? historialPdfs : [];
    const historialUnido = sanitizarPdfsHistorial([
        ...historialDb,
        ...historialDrive
    ]).sort((a, b) => new Date(b.fechaSubida || 0) - new Date(a.fechaSubida || 0));

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            pdfFirmado,
            documentoSistemaDriveFileId,
            plantillaSistemaDriveFileId: documentoSistemaDriveFileId,
            pdfsHistorial: historialDb.length ? historialDb : historialUnido
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(
            archivoDrive?.modifiedTime || registro?.ultima_sync_drive
        ),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: historialUnido,
        documentoSistemaDriveFileId,
        documentoSistemaEditorUrl: documentoSistemaDriveFileId
            ? `https://docs.google.com/document/d/${documentoSistemaDriveFileId}/edit`
            : null,
        plantillaDriveFileId: TEMPLATE_DRIVE_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_DRIVE_ID}/edit`,
        plantillaOrigenDriveId: datos.plantillaOrigenDriveId || TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: datos.plantillaContenidoVersion || PLANTILLA_CONTENIDO_VERSION,
        carpetaHistorialDriveId: CARPETA_HISTORIAL_DRIVE_ID
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        ...payload,
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || null
    });
}

function payloadRegistroDesdeRegistro(registro, datos, pdfDriveFileId = null) {
    return {
        pdfDriveFileId: pdfDriveFileId ?? registro?.drive_file_id ?? datos?.pdfFirmado?.driveFileId ?? null,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido ?? null,
        contenidoModificado: !!registro?.contenido_modificado
    };
}

async function aplicarCabeceraLista(pool, datos) {
    const cabeceraLista = await resolverCabeceraListaMaestra(pool, datos);
    return {
        cabeceraLista,
        datos: {
            ...sanitizarDatos(datos),
            revision: cabeceraLista.revision,
            fechaRevision: cabeceraLista.fechaRevision
        }
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    const aplicado = await aplicarCabeceraLista(pool, datos);
    datos = aplicado.datos;
    const regenerar = debeRegenerarDocumentoSistema(datos, aplicado.cabeceraLista);
    const {
        fileId: sistemaFileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(datos, { forzarRegenerar: regenerar });

    if (newlyCreated || regenerated) {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datos,
                DATOS_DEFECTO,
                sistemaFileId,
                { forzarSnapshotPlantilla: true }
            );
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
                plantillaSync: syncResult.plantillaSync
            };
        } catch (err) {
            console.warn('[DG-F-08] No se pudo sincronizar documento sistema recién creado:', err.message);
            datos = {
                ...datos,
                documentoSistemaDriveFileId: sistemaFileId,
                plantillaSistemaDriveFileId: sistemaFileId,
                plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
                plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
            };
        }
        await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
        registro = await obtenerRegistroDb(pool);
    } else {
        const prev = await leerDatosRegistro(registro);
        const debePersistir = !prev
            || sistemaFileId !== prev.plantillaSistemaDriveFileId
            || prev.plantillaOrigenDriveId !== TEMPLATE_DRIVE_ID
            || Number(prev.plantillaContenidoVersion || 0) < PLANTILLA_CONTENIDO_VERSION
            || prev.revision !== datos.revision
            || prev.fechaRevision !== datos.fechaRevision;
        datos = {
            ...datos,
            documentoSistemaDriveFileId: sistemaFileId,
            plantillaSistemaDriveFileId: sistemaFileId,
            plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
            plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION
        };
        if (debePersistir) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos));
            registro = await obtenerRegistroDb(pool);
        }
    }

    const pdfResuelto = await resolverPdfFirmado(datos);
    if (pdfResuelto) {
        datos = { ...datos, pdfFirmado: pdfResuelto };
        if (registro && pdfResuelto.driveFileId !== registro.drive_file_id) {
            await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datos, pdfResuelto.driveFileId));
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

    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    const archivoDrive = await driveService.obtenerInfoArchivo(sistemaFileId).catch(() => ({ id: sistemaFileId }));
    return construirRespuesta(registro, datos, historialPdfs, archivoDrive);
}

async function guardarFormato(pool, body) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

    const datosPrevios = await leerDatosRegistro(registroPrevio);

    const huboCambioContenido = datosPrevios
        ? !contenidoEsEquivalente(datosPrevios, datosEntrada)
        : !contenidoEsEquivalente(DATOS_DEFECTO, datosEntrada);

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || datosPrevios?.pdfFirmado
        || datosEntrada.pdfFirmado;

    const baseParaDoc = {
        ...(datosPrevios || {}),
        ...datosEntrada,
        pdfFirmado,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        plantillaSync: datosPrevios?.plantillaSync || null,
        plantillaOrigenDriveId: datosPrevios?.plantillaOrigenDriveId || null,
        plantillaContenidoVersion: datosPrevios?.plantillaContenidoVersion || 0,
        plantillaSistemaDriveFileId: datosPrevios?.plantillaSistemaDriveFileId || null,
        documentoSistemaDriveFileId: datosPrevios?.documentoSistemaDriveFileId || null
    };
    const aplicado = await aplicarCabeceraLista(pool, baseParaDoc);
    const regenerar = debeRegenerarDocumentoSistema(aplicado.datos, aplicado.cabeceraLista);
    const {
        fileId: sistemaFileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(aplicado.datos, { forzarRegenerar: regenerar });

    if (huboCambioContenido && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        ...aplicado.datos,
        empresa: datosEntrada.empresa,
        mision: datosEntrada.mision,
        vision: datosEntrada.vision,
        valores: datosEntrada.valores,
        codigoTrabajoEquipo: datosEntrada.codigoTrabajoEquipo,
        firmante: datosEntrada.firmante,
        cargoFirmante: datosEntrada.cargoFirmante,
        fechaElaboracion,
        revision: aplicado.cabeceraLista.revision,
        fechaRevision: aplicado.cabeceraLista.fechaRevision,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: sanitizarPdfsHistorial(datosPrevios?.pdfsHistorial || datosEntrada.pdfsHistorial),
        documentoSistemaDriveFileId: sistemaFileId,
        plantillaSistemaDriveFileId: sistemaFileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
        plantillaSync: datosPrevios?.plantillaSync || null
    };

    if (origen !== 'consulta') {
        try {
            const syncResult = await sincronizarDocumentoSistema(
                datosGuardar,
                (newlyCreated || regenerated) ? DATOS_DEFECTO : (datosPrevios || DATOS_DEFECTO),
                sistemaFileId,
                { forzarSnapshotPlantilla: newlyCreated || regenerated }
            );
            datosGuardar.plantillaSync = syncResult.plantillaSync;
            datosGuardar.plantillaContenidoVersion = PLANTILLA_CONTENIDO_VERSION;
        } catch (err) {
            console.error('[DG-F-08] Error sincronizando documento sistema en Drive:', err.message);
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
    const archivoDrive = await driveService.obtenerInfoArchivo(sistemaFileId).catch(() => null);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs, archivoDrive);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const historialDrivePrev = await listarPdfsHistorialDrive().catch(() => []);
    const driveResult = await publicarPdfEnDrive(pdfBuffer, historialDrivePrev);

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(fechaHoyIso(), historialDrivePrev),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    const histPrev = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial);
    const pdfsHistorial = [pdfFirmado, ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)];

    const datosGuardar = { ...datosPrevios, pdfFirmado, pdfsHistorial };
    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || datosPrevios.fechaElaboracion;

    await guardarRegistroDb(pool, {
        ...payloadRegistroDesdeRegistro(registroPrevio, datosGuardar),
        pdfDriveFileId: pdfFirmado.driveFileId,
        fechaElaboracionOriginal: fechaOriginal
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return { ...construirRespuesta(registro, datosGuardar, historialPdfs), pdfFirmado };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[DG-F-08] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const datosGuardar = {
        ...datosPrevios,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: hist
    };

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: registroPrevio?.fecha_modificacion_contenido ?? null,
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs);
}

function wordYaReflejaDatos(datos) {
    const sync = datos?.plantillaSync;
    if (!sync) return false;
    if (formatearRevisionPlantillaDoc(sync.revision) !== formatearRevisionPlantillaDoc(datos.revision)) {
        return false;
    }
    const fechaSync = formatearFechaIso(sync.fechaRevision || sync.fechaElaboracion);
    const fechaDatos = formatearFechaIso(datos.fechaRevision);
    if (fechaSync && fechaDatos && fechaSync !== fechaDatos) return false;
    const campos = ['mision', 'vision', 'valores', 'codigoTrabajoEquipo', 'firmante', 'cargoFirmante'];
    return campos.every((campo) => normalizarSaltosLinea(sync[campo]) === normalizarSaltosLinea(datos[campo]));
}

function clavePdfDescarga(datos) {
    return crypto.createHash('sha1').update(JSON.stringify({
        mision: datos.mision || '',
        vision: datos.vision || '',
        valores: datos.valores || '',
        codigoTrabajoEquipo: datos.codigoTrabajoEquipo || '',
        firmante: datos.firmante || '',
        cargoFirmante: datos.cargoFirmante || '',
        revision: datos.revision || '',
        fechaRevision: datos.fechaRevision || '',
        textoPt: TAMANO_TEXTO_PT,
        fileId: datos.plantillaSistemaDriveFileId || datos.documentoSistemaDriveFileId || ''
    })).digest('hex');
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const cabecera = await resolverCabeceraListaMaestra(pool, datos);
    datos = {
        ...datos,
        revision: cabecera.revision,
        fechaRevision: cabecera.fechaRevision
    };

    const regenerar = debeRegenerarDocumentoSistema(datos, cabecera);
    const sistemaFileId = String(datos.plantillaSistemaDriveFileId || datos.documentoSistemaDriveFileId || '').trim();
    const exportacionDirecta = !regenerar
        && !!sistemaFileId
        && sistemaFileId !== TEMPLATE_DRIVE_ID
        && wordYaReflejaDatos(datos);

    if (exportacionDirecta) {
        const clave = clavePdfDescarga(datos);
        const cache = pdfDescargaCache.leer('DG-F-08', clave);
        if (cache) {
            console.log('[DG-F-08] PDF servido desde caché');
            return cache;
        }
        try {
            const pdfBuffer = await driveService.exportarArchivoPDF(sistemaFileId);
            pdfDescargaCache.guardar('DG-F-08', clave, pdfBuffer);
            console.log('[DG-F-08] PDF exportado del Word vigente, sin resincronizar');
            return pdfBuffer;
        } catch (err) {
            console.warn('[DG-F-08] Exportación directa de PDF falló, se regenera el Word:', err.message);
        }
    }

    const {
        fileId,
        newlyCreated,
        regenerated
    } = await asegurarDocumentoSistema(datos, {
        forzarRegenerar: regenerar || !sistemaFileId
    });
    const syncResult = await sincronizarDocumentoSistema(
        datos,
        (newlyCreated || regenerated) ? DATOS_DEFECTO : (datos.plantillaSync || DATOS_DEFECTO),
        fileId,
        { forzarSnapshotPlantilla: newlyCreated || regenerated }
    );
    const pdfBuffer = await driveService.exportarArchivoPDF(fileId);
    const datosActualizados = {
        ...datos,
        documentoSistemaDriveFileId: fileId,
        plantillaSistemaDriveFileId: fileId,
        plantillaOrigenDriveId: TEMPLATE_DRIVE_ID,
        plantillaContenidoVersion: PLANTILLA_CONTENIDO_VERSION,
        plantillaSync: syncResult.plantillaSync || datos.plantillaSync || null
    };
    pdfDescargaCache.guardar('DG-F-08', clavePdfDescarga(datosActualizados), pdfBuffer);
    await guardarRegistroDb(pool, payloadRegistroDesdeRegistro(registro, datosActualizados));
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_DOCUMENTO_SISTEMA,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_HISTORIAL_DRIVE_ID,
    PLANTILLA_CONTENIDO_VERSION,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sincronizarDocumentoSistema,
    sanitizarDatos,
    resolverCabeceraListaMaestra,
    crearReemplazosPlaceholders,
    documentoReflejaDestino,
    aplicarTamanoTextoDocx
};
