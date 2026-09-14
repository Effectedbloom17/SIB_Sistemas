/**
 * SGC-F-23 · Aviso de privacidad de datos personales (Biznaga)
 * Persistencia en biznaga_sgc, plantilla Google Doc y PDF firmado en Drive.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'SGC-F-23';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const TEMPLATE_DRIVE_ID = '1eU3QvmhqRhh0hQh3v3rzihE3nFyYRVZN9pKxb0gGZ8Q';
const NOMBRE_PLANTILLA = 'SGC-F-23 Aviso de privacidad de datos personales (Biznaga)';
const NOMBRE_PDF_ARCHIVO = 'SGC-F-23 Aviso de privacidad de datos personales (Biznaga).pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

const CAMPOS_TEXTO = [
    'intro',
    'objeto',
    'datosPersonales',
    'notaSensibles',
    'finalidadesPrimarias',
    'notaMercadotecnia',
    'transferencias',
    'transferenciasAdicional',
    'derechosArco',
    'limitacionDivulgacion',
    'modificaciones'
];

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-01-20',
    revision: '00',
    intro:
        'BIZNAGA RISK AND TECH S.DE R.L. DE C.V, con domicilio ubicado en (Calle Laguna no. 7 La Loma, Pachuca Hidalgo 42088, le informa que es responsable del tratamiento de los datos personales de nuestros proveedores y/o proveedores prospecto de bienes y/o servicios, mismos que son tratados de forma estrictamente privada y confidencial, por lo que la obtención, tratamiento, transferencia y ejercicio de los derechos derivados de dichos datos personales, se hace mediante un uso adecuado, legítimo y lícito, salvaguardando permanentemente los principios de licitud, consentimiento, calidad, información, proporcionalidad, responsabilidad, lealtad y finalidad.',
    objeto:
        'En consecuencia, el presente Aviso de Privacidad tiene por objeto informarle acerca de las prácticas en materia de protección de datos personales por parte de la Empresa, describir el tipo de información personal que obtenemos de nuestros clientes, cómo podríamos usar esa información y con quién podemos compartirla en función de la relación jurídica establecida con los mismos. Asimismo, este Aviso de Privacidad describe las medidas que seguimos para proteger la seguridad y confidencialidad de la información que recibimos.',
    datosPersonales:
        'Para lograr las finalidades establecidas en este Aviso de Privacidad, a continuación, señalamos las categorías de datos personales que podremos recabar de usted: datos de identificación, datos de contacto, y datos patrimoniales y/o financieros.',
    notaSensibles:
        'Le informamos que BIZNAGA RISK AND TECH S.DE R.L. DE C.V no solicitará datos personales sensibles de conformidad con la Ley y su Reglamento, para la consecución de las finalidades que se indican más adelante.',
    finalidadesPrimarias:
        'Se dará un tratamiento de conformidad con las finalidades que dieron origen y son necesarias para la existencia, mantenimiento y cumplimiento de la relación establecida con nuestros clientes, en los casos aplicables y que se indican a continuación: (i) Identificación y contacto; (ii) Para el proceso de contratación o alta como cliente; (iii) Llevar a cabo procedimientos internos que requieran su información en virtud de la relación contractual establecida con usted; (iv) Determinar los términos y condiciones de contratación; (v) Emitir la factura correspondiente por los servicios brindados, en su caso; (vi) Registrarlo en nuestras bases de datos físicas y/o electrónicas como cliente; (vii) Para el cumplimiento de la relación jurídica/contractual celebrada con usted, en su caso.',
    notaMercadotecnia:
        'Le informamos que los datos obtenidos no serán utilizados para fines de mercadotecnia, publicidad o prospección comercial.',
    transferencias:
        'Le informamos que no compartiremos sus datos personales con terceras personas, salvo cuando sea necesario en los casos previstos en la Ley y su Reglamento.',
    transferenciasAdicional:
        'Adicionalmente, la Empresa le informa que en términos de lo dispuesto por el artículo 37 de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares, podrá transferir sus datos personales a terceros sin su consentimiento, en los casos previstos en dicho ordenamiento.',
    derechosArco:
        'Como titular de datos personales, usted podrá ejercer los Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición al tratamiento de sus datos personales), o bien, revocar el consentimiento que usted haya otorgado a BIZNAGA RISK AND TECH S.DE R.L. DE C.V, para el tratamiento de sus datos personales, enviando su solicitud, a través de la cuenta de correo electrónico: (contacto@gmail.com). Dicha solicitud deberá contener por lo menos: (a) nombre y domicilio u otro medio para comunicarle la respuesta a su solicitud; (b) los documentos que acrediten su identidad o, en su caso, la representación legal; (c) la descripción clara y precisa de los datos personales respecto de los que se solicita ejercer alguno de los Derechos ARCO, (d) la manifestación expresa para revocar su consentimiento al tratamiento de sus datos personales y por tanto, para que no se usen; y (e) cualquier otro elemento que facilite la localización de los datos personales.',
    correoArco: 'contacto@gmail.com',
    limitacionDivulgacion:
        'Le informamos que, toda vez que sus datos personales se utilizarán solamente para los fines expresamente establecidos en el presente aviso de privacidad y que constituyen aquellas finalidades necesarias para el establecimiento, mantenimiento o cumplimiento de la relación jurídica con nuestros clientes, sin que exista la posibilidad de que sus datos personales sean utilizados para fines diversos, tales como mercadotecnia, publicidad y prospección comercial, BIZNAGA RISK AND TECH S.DE R.L. DE C.V no dispone de un medio para que usted pueda limitar el uso o divulgación de sus datos personales en el caso que nos ocupa, puesto que de ser así se impediría establecer, mantener y dar cumplimiento a la relación jurídica con usted como cliente de BIZNAGA RISK AND TECH S.DE R.L. DE C.V.',
    modificaciones:
        'BIZNAGA RISK AND TECH S.DE R.L. DE C.V., se reserva el derecho, bajo su exclusiva discreción, de cambiar, modificar, agregar o eliminar partes del presente Aviso de Privacidad en cualquier momento. En tal caso, BIZNAGA RISK AND TECH S.DE R.L. DE C.V., le informará de los cambios por el mismo medio que ha puesto a su disposición este Aviso de Privacidad.',
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

/** Respeta cadenas vacías (borrados del usuario); solo usa defecto si falta el campo. */
function textoEditable(valor, defecto = '') {
    if (valor === undefined || valor === null) {
        return normalizarSaltosLinea(defecto);
    }
    return normalizarSaltosLinea(valor);
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

function textoParrafoDoc(texto) {
    const limpio = normalizarSaltosLinea(texto);
    return limpio ? `${limpio}\n` : '';
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotPlantillaDesdeDatos(raw);
}

function snapshotPlantillaDesdeDatos(datos) {
    const base = sanitizarDatos(datos);
    const snap = {
        correoArco: base.correoArco,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante,
        revision: base.revision,
        fechaElaboracion: base.fechaElaboracion
    };
    CAMPOS_TEXTO.forEach((campo) => {
        snap[campo] = base[campo];
    });
    return snap;
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
    const requests = CAMPOS_TEXTO.map((campo) => (
        crearReplaceRequest(textoParrafoDoc(snapshot[campo]), textoParrafoDoc(destino[campo]))
    ));
    requests.push(
        crearReplaceRequest(snapshot.correoArco, destino.correoArco),
        crearReplaceRequest(textoParrafoDoc(snapshot.firmante), textoParrafoDoc(destino.firmante)),
        crearReplaceRequest(textoParrafoDoc(snapshot.cargoFirmante), textoParrafoDoc(destino.cargoFirmante))
    );
    return requests.filter(Boolean);
}

function claveTitulo(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[:.\s]+/g, ' ')
        .trim();
}

const BLOQUES_PLANTILLA = [
    { titulo: 'aviso de privacidad de datos personales', campos: ['intro', 'objeto'] },
    { titulo: 'datos personales recabados', campos: ['datosPersonales', 'notaSensibles'] },
    { titulo: 'finalidades primarias', campos: ['finalidadesPrimarias', 'notaMercadotecnia'] },
    { titulo: 'transferencias', campos: ['transferencias', 'transferenciasAdicional'] },
    { titulo: 'derechos arco y revocacion del consentimiento', campos: ['derechosArco'] },
    { titulo: 'limitacion y/o divulgacion de sus datos personales', campos: ['limitacionDivulgacion'] },
    { titulo: 'modificaciones y cambios al aviso de privacidad', campos: ['modificaciones'] }
];

const TITULOS_SECCION = new Set(BLOQUES_PLANTILLA.map((b) => b.titulo));

function esTituloSeccion(texto) {
    const clave = claveTitulo(texto);
    if (!clave) return false;
    if (TITULOS_SECCION.has(clave)) return true;
    for (const titulo of TITULOS_SECCION) {
        if (clave.startsWith(titulo)) return true;
    }
    return false;
}

function listarParrafos(content) {
    return (content || []).filter((el) => el.paragraph && Number.isFinite(el.startIndex));
}

async function reemplazarTextoParrafo(docsApi, docId, parrafo, textoNuevo) {
    const start = parrafo.startIndex;
    const end = parrafo.endIndex;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const deleteEnd = end - 1;
    const requests = [];
    if (deleteEnd > start) {
        requests.push({
            deleteContentRange: { range: { startIndex: start, endIndex: deleteEnd } }
        });
    }
    const texto = String(textoNuevo || '');
    if (texto) {
        requests.push({
            insertText: { location: { index: start }, text: texto }
        });
    }
    if (!requests.length) return;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}

async function insertarParrafoVacioEn(docsApi, docId, index) {
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{ insertText: { location: { index }, text: '\n' } }]
        }
    });
}

async function escribirBloqueEnDoc(docsApi, docId, bloque, datos, intento = 0) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const parrafos = listarParrafos(doc.data.body?.content || []);
    const headingIdx = parrafos.findIndex((el) => {
        const clave = claveTitulo(textoParrafoElemento(el));
        return clave === bloque.titulo || clave.startsWith(bloque.titulo);
    });
    if (headingIdx < 0) {
        console.warn('[SGC-F-23] No se encontró el título:', bloque.titulo);
        return;
    }

    const cuerpos = [];
    for (let i = headingIdx + 1; i < parrafos.length; i += 1) {
        const texto = textoParrafoElemento(parrafos[i]);
        if (esTituloSeccion(texto)) break;
        if (parrafoTieneSaltoPagina(parrafos[i]) || parrafoTienePageBreakBefore(parrafos[i])) continue;
        cuerpos.push(parrafos[i]);
        if (cuerpos.length >= bloque.campos.length) break;
    }

    const faltan = bloque.campos.length - cuerpos.length;
    if (faltan > 0) {
        if (intento >= 2) {
            console.warn('[SGC-F-23] No se pudieron crear párrafos para', bloque.titulo);
            return;
        }
        const ancla = cuerpos.length ? cuerpos[cuerpos.length - 1] : parrafos[headingIdx];
        let insertAt = ancla.endIndex;
        for (let n = 0; n < faltan; n += 1) {
            await insertarParrafoVacioEn(docsApi, docId, insertAt);
            insertAt += 1;
        }
        return escribirBloqueEnDoc(docsApi, docId, bloque, datos, intento + 1);
    }

    for (let i = bloque.campos.length - 1; i >= 0; i -= 1) {
        const campo = bloque.campos[i];
        const valor = datos[campo] == null ? '' : String(datos[campo]);
        await reemplazarTextoParrafo(docsApi, docId, cuerpos[i], valor);
    }
}

async function escribirDatosEnDoc(docsApi, docId, datos) {
    for (let i = BLOQUES_PLANTILLA.length - 1; i >= 0; i -= 1) {
        await escribirBloqueEnDoc(docsApi, docId, BLOQUES_PLANTILLA[i], datos);
    }
}

async function obtenerClienteDocs() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    return {
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

async function copiarPlantillaComoGoogleDoc() {
    const { drive, docsApi } = await obtenerClienteDocs();
    const copyResp = await drive.files.copy({
        fileId: TEMPLATE_DRIVE_ID,
        requestBody: {
            name: `_temp_sgc_f23_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id',
        supportsAllDrives: true
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo copiar la plantilla Google Doc de SGC-F-23.');
    }
    return { drive, docsApi, docId };
}

async function aplicarRequestsEnDoc(docsApi, documentId, requests) {
    if (!requests.length) return;
    await docsApi.documents.batchUpdate({
        documentId,
        requestBody: { requests }
    });
}

async function sincronizarPlantillaGoogleDoc(datos, snapshotAnterior, opciones = {}) {
    const soloCopiaTemporal = !!opciones.soloCopiaTemporal;
    const ajustesPdf = !!opciones.ajustesPdf;
    const destino = snapshotPlantillaDesdeDatos(datos);

    const { drive, docsApi, docId } = await copiarPlantillaComoGoogleDoc();
    try {
        try {
            await quitarSaltoPaginaArco(docsApi, docId);
            if (!soloCopiaTemporal) {
                await quitarSaltoPaginaArco(docsApi, TEMPLATE_DRIVE_ID);
            }
        } catch (err) {
            console.warn('[SGC-F-23] No se pudo quitar salto ARCO previo:', err.message);
        }

        await escribirDatosEnDoc(docsApi, docId, destino);
        if (!soloCopiaTemporal) {
            await escribirDatosEnDoc(docsApi, TEMPLATE_DRIVE_ID, destino);
        }

        if (ajustesPdf) {
            await aplicarAjustesEspaciadoPdf(docsApi, docId);
        } else {
            try {
                await insertarSaltoPaginaArco(docsApi, docId);
            } catch (err) {
                console.warn('[SGC-F-23] No se pudo insertar salto ARCO en copia:', err.message);
            }
        }
        if (!soloCopiaTemporal) {
            try {
                await insertarSaltoPaginaArco(docsApi, TEMPLATE_DRIVE_ID);
            } catch (err) {
                console.warn('[SGC-F-23] No se pudo insertar salto ARCO en plantilla Word:', err.message);
            }
        }

        return {
            actualizado: true,
            plantillaSync: destino,
            tempDocId: docId,
            drive,
            docsApi
        };
    } catch (err) {
        try {
            await drive.files.delete({ fileId: docId, supportsAllDrives: true });
        } catch (_) { /* ignore */ }
        throw err;
    }
}

function textoParrafoElemento(el) {
    return ((el && el.paragraph && el.paragraph.elements) || [])
        .map((e) => (e.textRun && e.textRun.content) || '')
        .join('');
}

function parrafoTieneSaltoPagina(el) {
    return ((el && el.paragraph && el.paragraph.elements) || [])
        .some((e) => !!e.pageBreak);
}

function parrafoEstaVacio(el) {
    const text = textoParrafoElemento(el);
    return text === '\n' || text.trim() === '';
}

function encontrarParrafoPorTexto(content, needle) {
    const objetivo = String(needle || '').trim().toLowerCase();
    if (!objetivo) return null;
    for (const el of content) {
        const p = el.paragraph;
        if (!p) continue;
        const text = textoParrafoElemento(el).trim().toLowerCase();
        if (text.startsWith(objetivo)) {
            return el;
        }
    }
    return null;
}

const AGUJAS_SALTO_ARCO = [
    'derechos arco y revocación del consentimiento',
    'derechos arco y revocacion del consentimiento'
];

const AGUJAS_INCISO_D = [
    '(d) la manifestación expresa',
    'para revocar su consentimiento al tratamiento'
];

function encontrarIndiceAguja(content, needles) {
    for (const needle of needles) {
        const objetivo = String(needle || '').trim().toLowerCase();
        if (!objetivo) continue;
        for (const el of content) {
            if (!el.paragraph) continue;
            const runs = [];
            let assembled = '';
            for (const e of el.paragraph.elements || []) {
                const t = (e.textRun && e.textRun.content) || '';
                if (!t) continue;
                runs.push({ start: e.startIndex, text: t });
                assembled += t;
            }
            const idx = assembled.toLowerCase().indexOf(objetivo);
            if (idx === -1) continue;
            let restante = idx;
            for (const run of runs) {
                if (restante < run.text.length) {
                    return {
                        element: el,
                        index: (run.start ?? el.startIndex) + restante
                    };
                }
                restante -= run.text.length;
            }
            return { element: el, index: el.startIndex + idx };
        }
    }
    return null;
}

function encontrarIndiceAgujaArco(content) {
    return encontrarIndiceAguja(content, AGUJAS_SALTO_ARCO);
}

function coleccionInmediataAntes(content, destinoStartIndex) {
    const bloque = [];
    for (const el of content) {
        if (!el.paragraph) continue;
        if (el.startIndex >= destinoStartIndex) break;
        if (parrafoTieneSaltoPagina(el) || parrafoEstaVacio(el) || parrafoTienePageBreakBefore(el)) {
            bloque.push(el);
        } else {
            bloque.length = 0;
        }
    }
    return bloque;
}

async function eliminarRangos(docsApi, docId, elementos) {
    if (!elementos.length) return;
    const requests = elementos
        .slice()
        .reverse()
        .map((el) => ({
            deleteContentRange: {
                range: {
                    startIndex: el.startIndex,
                    endIndex: el.endIndex
                }
            }
        }));
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests }
    });
}

async function unirIncisoDSiEstaSeparado(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];
    const halladoD = encontrarIndiceAguja(content, AGUJAS_INCISO_D);
    if (!halladoD) {
        console.warn('[SGC-F-23] unir (d): no se encontró el inciso (d).');
        return;
    }
    if (halladoD.index !== halladoD.element.startIndex) {
        console.log('[SGC-F-23] unir (d): el inciso ya está en el mismo párrafo.');
        return;
    }

    const bloque = coleccionInmediataAntes(content, halladoD.element.startIndex);
    console.log('[SGC-F-23] unir (d): vacíos previos', bloque.map((el) => `${el.startIndex}-${el.endIndex}`).join(', ') || '(ninguno)');
    if (bloque.length) {
        await eliminarRangos(docsApi, docId, bloque);
    }

    const doc2 = await docsApi.documents.get({ documentId: docId });
    const content2 = doc2.data.body?.content || [];
    const hallado2 = encontrarIndiceAguja(content2, AGUJAS_INCISO_D);
    if (!hallado2 || hallado2.index !== hallado2.element.startIndex) {
        console.warn('[SGC-F-23] unir (d): el inciso no quedó al inicio del párrafo.');
        return;
    }

    let previo = null;
    for (const el of content2) {
        if (!el.paragraph) continue;
        if (el.startIndex >= hallado2.element.startIndex) break;
        previo = el;
    }
    if (!previo || parrafoTieneSaltoPagina(previo) || parrafoEstaVacio(previo)) {
        console.warn('[SGC-F-23] unir (d): no hay párrafo previo para unir.', previo && textoParrafoElemento(previo).slice(0, 80));
        return;
    }

    const previoTexto = textoParrafoElemento(previo).toLowerCase();
    if (!previoTexto.includes('como titular')) {
        console.warn('[SGC-F-23] unir (d): el párrafo previo no es el bloque ARCO.', previoTexto.slice(0, 80));
        return;
    }

    const nlStart = previo.endIndex - 1;
    if (nlStart < previo.startIndex) return;

    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{
                deleteContentRange: {
                    range: { startIndex: nlStart, endIndex: previo.endIndex }
                }
            }]
        }
    });
}

/**
 * Quita el Ctrl+Enter y los dos enters antes del título ARCO,
 * y vuelve a unir el inciso (d) si quedó separado.
 */
async function quitarSaltoPaginaArco(docsApi, docId) {
    await unirIncisoDSiEstaSeparado(docsApi, docId);

    const doc = await docsApi.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];
    const hallado = encontrarIndiceAgujaArco(content);
    if (!hallado) return;

    if (hallado.index !== hallado.element.startIndex) return;

    const bloque = coleccionInmediataAntes(content, hallado.element.startIndex);
    const haySalto = bloque.some((el) => parrafoTieneSaltoPagina(el) || parrafoTienePageBreakBefore(el))
        || parrafoTienePageBreakBefore(hallado.element);
    if (!haySalto && !bloque.length) return;

    if (bloque.length) {
        await eliminarRangos(docsApi, docId, bloque);
    }

    const doc2 = await docsApi.documents.get({ documentId: docId });
    const hallado2 = encontrarIndiceAgujaArco(doc2.data.body?.content || []);
    if (!hallado2) return;
    if (!parrafoTienePageBreakBefore(hallado2.element)) return;

    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{
                updateParagraphStyle: {
                    paragraphStyle: { pageBreakBefore: false },
                    fields: 'pageBreakBefore',
                    range: {
                        startIndex: hallado2.element.startIndex,
                        endIndex: Math.max(hallado2.element.startIndex + 1, hallado2.element.endIndex - 1)
                    }
                }
            }]
        }
    });
}

function parrafoTienePageBreakBefore(el) {
    return !!(el && el.paragraph && el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.pageBreakBefore);
}

/**
 * Ctrl+Enter: pasa todo el bloque ARCO (título + párrafo) a la página 2
 * y deja dos enters debajo del logo.
 */
async function insertarSaltoPaginaArco(docsApi, docId) {
    await unirIncisoDSiEstaSeparado(docsApi, docId);

    const doc = await docsApi.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];
    const hallado = encontrarIndiceAgujaArco(content);
    if (!hallado) {
        console.warn('[SGC-F-23] No se encontró el título ARCO para el salto de página.');
        return false;
    }

    const yaAlInicio = hallado.index === hallado.element.startIndex;
    if (yaAlInicio) {
        const bloque = coleccionInmediataAntes(content, hallado.element.startIndex);
        const vacios = bloque.filter((el) => parrafoEstaVacio(el)).length;
        const yaSalto = bloque.some((el) => parrafoTieneSaltoPagina(el) || parrafoTienePageBreakBefore(el))
            || parrafoTienePageBreakBefore(hallado.element);
        if (yaSalto && vacios >= 2) {
            const extras = vacios > 2 ? bloque.slice(0, vacios - 2) : [];
            if (extras.length) {
                await eliminarRangos(docsApi, docId, extras);
                console.log('[SGC-F-23] Salto ARCO ya aplicado; se recortaron vacíos extra en página 1.');
            } else {
                console.log('[SGC-F-23] Salto ARCO ya aplicado.');
            }
            return true;
        }
        if (bloque.length) {
            await eliminarRangos(docsApi, docId, bloque);
        }
    }

    const doc2 = await docsApi.documents.get({ documentId: docId });
    const hallado2 = encontrarIndiceAgujaArco(doc2.data.body?.content || []);
    if (!hallado2) return false;

    const n = hallado2.index;
    const alInicio = n === hallado2.element.startIndex;
    // Al inicio: dos enters. A mitad de párrafo: cierra el párrafo + dos enters.
    const textoInsertar = alInicio ? '\n\n' : '\n\n\n';
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{ insertText: { location: { index: n }, text: textoInsertar } }]
        }
    });

    // El primer párrafo vacío (inicio de la página 2) lleva el salto.
    const inicioSalto = alInicio ? n : n + 1;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{
                updateParagraphStyle: {
                    paragraphStyle: { pageBreakBefore: true },
                    fields: 'pageBreakBefore',
                    range: { startIndex: inicioSalto, endIndex: inicioSalto + 1 }
                }
            }]
        }
    });

    console.log('[SGC-F-23] Salto de página ARCO insertado en', docId);
    return true;
}

/**
 * Ajustes SOLO para PDF:
 * Acerca el cuerpo al logo y fuerza el resto del párrafo ARCO a la
 * página siguiente (Ctrl+Enter) con dos enters bajo la imagen.
 */
async function aplicarAjustesEspaciadoPdf(docsApi, docId) {
    const stylePatch = {
        marginTop: { magnitude: 42, unit: 'PT' },
        marginHeader: { magnitude: 12, unit: 'PT' }
    };

    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [{
                updateDocumentStyle: {
                    documentStyle: stylePatch,
                    fields: 'marginTop,marginHeader'
                }
            }]
        }
    });

    // No recortar vacíos antes de ARCO: ahí va el salto de página + dos enters.
    const titulos = [
        'Limitación y/o divulgación de sus datos personales'
    ];

    for (const titulo of titulos) {
        const docActual = await docsApi.documents.get({ documentId: docId });
        const content = docActual.data.body?.content || [];
        const destino = encontrarParrafoPorTexto(content, titulo);
        if (!destino) continue;

        const vacios = [];
        for (const el of content) {
            if (!el.paragraph) continue;
            if (el.startIndex >= destino.startIndex) break;
            if (parrafoEstaVacio(el)) {
                vacios.push(el);
            } else {
                vacios.length = 0;
            }
        }

        const eliminar = vacios.length > 2 ? vacios.slice(0, -2) : [];
        if (!eliminar.length) continue;
        await eliminarRangos(docsApi, docId, eliminar);
    }

    try {
        await insertarSaltoPaginaArco(docsApi, docId);
    } catch (err) {
        console.warn('[SGC-F-23] No se pudo insertar salto ARCO en PDF:', err.message);
    }
}

async function eliminarCopiaTemporal(drive, docId) {
    if (!drive || !docId) return;
    try {
        await drive.files.delete({ fileId: docId, supportsAllDrives: true });
    } catch (err) {
        console.warn('[SGC-F-23] No se pudo eliminar copia temporal de plantilla:', err.message);
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
    const datos = {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        correoArco: textoEditable(base.correoArco, DATOS_DEFECTO.correoArco),
        firmante: textoEditable(base.firmante, DATOS_DEFECTO.firmante),
        cargoFirmante: textoEditable(base.cargoFirmante, DATOS_DEFECTO.cargoFirmante),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        plantillaSync
    };
    CAMPOS_TEXTO.forEach((campo) => {
        datos[campo] = textoEditable(base[campo], DATOS_DEFECTO[campo]);
    });
    return datos;
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    const editable = {
        empresa: base.empresa,
        correoArco: base.correoArco,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante
    };
    CAMPOS_TEXTO.forEach((campo) => {
        editable[campo] = base[campo];
    });
    return editable;
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
        driveFileId: payload.pdfDriveFileId || payload.driveFileId || TEMPLATE_DRIVE_ID
    });
}

function clonarCamposTexto(origen) {
    const out = {};
    CAMPOS_TEXTO.forEach((campo) => {
        out[campo] = origen[campo];
    });
    return out;
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
        ...clonarCamposTexto(datosEntrada),
        empresa: datosEntrada.empresa,
        correoArco: datosEntrada.correoArco,
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
            await eliminarCopiaTemporal(syncResult.drive, syncResult.tempDocId);
        } catch (err) {
            console.error('[SGC-F-23] Error sincronizando plantilla Word en Drive:', err.message);
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
    const snapshot = datos.plantillaSync || snapshotPlantillaDesdeDatos(DATOS_DEFECTO);

    let syncResult = null;
    try {
        // Copia temporal + ajustes de espaciado SOLO para el PDF (no altera la plantilla viva).
        syncResult = await sincronizarPlantillaGoogleDoc(datos, snapshot, {
            soloCopiaTemporal: true,
            ajustesPdf: true
        });

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

        if (syncResult.tempDocId && syncResult.drive) {
            const pdfResp = await syncResult.drive.files.export(
                { fileId: syncResult.tempDocId, mimeType: 'application/pdf' },
                { responseType: 'arraybuffer' }
            );
            return Buffer.from(pdfResp.data);
        }
    } catch (err) {
        console.warn('[SGC-F-23] Descarga PDF: sync parcial, exportando plantilla actual:', err.message);
        console.warn(err.stack);
    } finally {
        if (syncResult) {
            await eliminarCopiaTemporal(syncResult.drive, syncResult.tempDocId);
        }
    }

    return driveService.exportarArchivoPDF(TEMPLATE_DRIVE_ID);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    NOMBRE_PLANTILLA,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    insertarSaltoPaginaArco,
    unirIncisoDSiEstaSeparado,
    sanitizarDatos
};
