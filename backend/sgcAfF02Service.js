/**
 * AF-F-02 · Contrato — persistencia en biznaga_sgc; PDF desde copia temporal de la plantilla.
 *
 * REGLA DE PLANTILLAS (inmutables — NUNCA reemplazar ni editar in-place):
 * - Google Doc plantilla: TEMPLATE_GOOGLE_DOC_ID (solo se COPIA a un temp para PDF).
 * - .docx original / trabajo: TEMPLATE_ORIGINAL_DRIVE_ID / TEMPLATE_DRIVE_ID (solo lectura).
 * - Si hace falta guardar algo en Drive: siempre archivo NUEVO (p. ej. PDF firmado).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'AF-F-02';
/** Carpeta del formato (plantillas de referencia). */
const CARPETA_DRIVE_ID = '1ie49_SU40w6HCJc1-8dRtNklT-viuhJG';
/** Archivero de contratos Word (.docx generados / editados). */
const CARPETA_WORD_ARCHIVADOS_ID = '14QwCRGN83bnrN9ND_lWBlswC-lgRWd9Z';
/** Carpeta exclusiva de PDFs firmados (archivero). */
const CARPETA_PDF_FIRMADOS_ID = '17NIbw34EuKvojBmGpZVjuLNtp_V2vbY_';
/** .docx original limpio (catálogo). Solo lectura — nunca sobrescribir. */
const TEMPLATE_ORIGINAL_DRIVE_ID = '1sBdyfShWudk4zzooCmmFE0vhZtQNmZGZ';
/** .docx de referencia en carpeta del formato. Solo lectura — nunca sobrescribir. */
const TEMPLATE_DRIVE_ID = '14gR1Mx7iwpLAIU5921hrzfv-f-smOOuS';
/** Plantilla viva Google Doc (Sistema). Solo se COPIA; nunca se edita ni reemplaza. */
const TEMPLATE_GOOGLE_DOC_ID = '1BUj1qEMZGx6rdPSQgECn6paM72cnTfgBUbdkGQjngGk';
const NOMBRE_PLANTILLA_DOCX = 'AF-F-02 Contrato.docx';
const NOMBRE_PDF_ARCHIVO = 'AF-F-02 Contrato.pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** IDs que el servicio no puede mutar ni reemplazar. */
const PLANTILLAS_INMUTABLES = new Set([
    TEMPLATE_ORIGINAL_DRIVE_ID,
    TEMPLATE_DRIVE_ID,
    TEMPLATE_GOOGLE_DOC_ID
]);

function assertNoMutarPlantilla(fileId, accion = 'modificar') {
    const id = String(fileId || '').trim();
    if (id && PLANTILLAS_INMUTABLES.has(id)) {
        throw new Error(
            `[AF-F-02] Prohibido ${accion} la plantilla (${id}). `
            + 'Solo se permiten copias temporales o archivos nuevos.'
        );
    }
}

const MESES_ES = {
    '1': 'enero', '01': 'enero', enero: 'enero',
    '2': 'febrero', '02': 'febrero', febrero: 'febrero',
    '3': 'marzo', '03': 'marzo', marzo: 'marzo',
    '4': 'abril', '04': 'abril', abril: 'abril',
    '5': 'mayo', '05': 'mayo', mayo: 'mayo',
    '6': 'junio', '06': 'junio', junio: 'junio',
    '7': 'julio', '07': 'julio', julio: 'julio',
    '8': 'agosto', '08': 'agosto', agosto: 'agosto',
    '9': 'septiembre', '09': 'septiembre', septiembre: 'septiembre',
    '10': 'octubre', octubre: 'octubre',
    '11': 'noviembre', noviembre: 'noviembre',
    '12': 'diciembre', diciembre: 'diciembre'
};

/** Entrada UI: 12/enero/2026 → texto del contrato: 12 de enero de 2026 */
function formatearPieFechaParaDocumento(pieFecha) {
    const raw = String(pieFecha || '').trim();
    if (!raw || /^x+\/x+\/x+$/i.test(raw)) return '';
    const m = raw.match(/^(\d{1,2})\s*[\/\-]\s*([a-záéíóúñÁÉÍÓÚÑ]+|\d{1,2})\s*[\/\-]\s*(\d{2,4})$/i);
    if (m) {
        const dia = String(parseInt(m[1], 10));
        const mesKey = m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const mes = MESES_ES[mesKey] || MESES_ES[m[2].toLowerCase()] || m[2].toLowerCase();
        let anio = m[3];
        if (anio.length === 2) anio = `20${anio}`;
        return `${dia} de ${mes} de ${anio}`;
    }
    if (/\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}/i.test(raw)) {
        return raw;
    }
    return raw;
}

function sanitizarNombreArchivoDrive(nombre) {
    return String(nombre || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'Cliente';
}

function nombreContratoArchivado(datos) {
    const d = snapshotCampos(datos);
    const cliente = sanitizarNombreArchivoDrive(d.campos?.clienteNombre || d.empresa || 'Contrato');
    const iso = formatearFechaIso(d.fechaElaboracion) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    return `AF-F-02 Contrato - ${cliente} - ${mm}/${yy}.docx`;
}

/**
 * Guarda o actualiza el contrato .docx en el archivero Word.
 * Prioridad: 1) wordDriveFileId del contrato  2) archivo con el mismo nombre en la carpeta
 * Solo crea uno nuevo si no existe ninguno (evita duplicados).
 */
async function archivarContratoWord(drive, tempDocId, datos) {
    if (!drive || !tempDocId) return null;
    assertNoMutarPlantilla(tempDocId, 'archivar');
    try {
        const docxResp = await drive.files.export(
            { fileId: tempDocId, mimeType: DOCX_MIME },
            { responseType: 'arraybuffer' }
        );
        const docxBuffer = Buffer.from(docxResp.data);
        if (!docxBuffer.length) {
            throw new Error('DOCX vacío al archivar');
        }
        const nombre = nombreContratoArchivado(datos);
        let existenteId = String(
            datos?.wordDriveFileId
            || datos?.ultimoContratoWord?.driveFileId
            || ''
        ).trim();

        if (existenteId) {
            assertNoMutarPlantilla(existenteId, 'actualizar');
            const existe = await driveService.verificarArchivoExiste(existenteId).catch(() => false);
            if (!existe) {
                console.warn(`[AF-F-02] wordDriveFileId obsoleto (${existenteId}); se buscará por nombre.`);
                existenteId = '';
            }
        }

        // Fallback: mismo nombre en la carpeta de Word (evita copias al perder el ID).
        if (!existenteId) {
            const porNombre = await driveService.buscarArchivo(nombre, CARPETA_WORD_ARCHIVADOS_ID).catch(() => null);
            if (porNombre?.id) {
                existenteId = String(porNombre.id).trim();
                console.log(`[AF-F-02] Word encontrado por nombre: ${nombre} (${existenteId})`);
            }
        }

        // Último recurso: cualquier AF-F-02 del mismo cliente en la carpeta (el más reciente).
        if (!existenteId) {
            const cliente = sanitizarNombreArchivoDrive(
                (datos?.campos && datos.campos.clienteNombre) || datos?.empresa || ''
            );
            if (cliente && cliente !== 'Cliente') {
                const lista = await listarContratosWordArchivados().catch(() => []);
                const same = (lista || []).filter((f) => {
                    const n = String(f.nombreArchivo || '');
                    return n.toLowerCase().includes(` - ${cliente.toLowerCase()} - `)
                        || n.toLowerCase().startsWith(`af-f-02 contrato - ${cliente.toLowerCase()}`);
                });
                if (same.length) {
                    existenteId = String(same[0].driveFileId || '').trim();
                    console.log(`[AF-F-02] Word reutilizado por cliente: ${same[0].nombreArchivo} (${existenteId})`);
                }
            }
        }

        if (existenteId) {
            assertNoMutarPlantilla(existenteId, 'actualizar');
            const actualizado = await driveService.reemplazarArchivoEnDrive(
                existenteId,
                docxBuffer,
                DOCX_MIME,
                nombre
            );
            // Limpia copias huérfanas con el mismo nombre exacto.
            await consolidarDuplicadosWord(existenteId, nombre).catch((err) => {
                console.warn('[AF-F-02] No se pudieron limpiar Word duplicados:', err.message);
            });
            console.log(`[AF-F-02] Contrato Word actualizado: ${nombre} (${existenteId})`);
            return {
                driveFileId: existenteId,
                nombreArchivo: actualizado?.name || nombre,
                webViewLink: actualizado?.webViewLink || datos?.ultimoContratoWord?.webViewLink || null
            };
        }

        const subido = await driveService.subirArchivoNuevo(
            docxBuffer,
            nombre,
            DOCX_MIME,
            CARPETA_WORD_ARCHIVADOS_ID
        );
        console.log(`[AF-F-02] Contrato Word nuevo: ${nombre} (${subido.id})`);
        return {
            driveFileId: subido.id,
            nombreArchivo: subido.name || nombre,
            webViewLink: subido.webViewLink || null
        };
    } catch (err) {
        console.warn('[AF-F-02] No se pudo archivar/actualizar contrato Word:', err.message);
        return null;
    } finally {
        try {
            await drive.files.delete({ fileId: tempDocId, supportsAllDrives: true });
        } catch (_) { /* ignore */ }
    }
}

/** Conserva un solo .docx canónico; mueve a papelera el resto con el mismo nombre. */
async function consolidarDuplicadosWord(keepId, nombreArchivo) {
    const keep = String(keepId || '').trim();
    const nombre = String(nombreArchivo || '').trim();
    if (!keep || !nombre) return;
    const lista = await listarContratosWordArchivados().catch(() => []);
    const dupes = (lista || []).filter((f) => {
        const id = String(f?.driveFileId || '').trim();
        const n = String(f?.nombreArchivo || '').trim();
        return id && id !== keep && n.toLowerCase() === nombre.toLowerCase();
    });
    for (const f of dupes) {
        const id = String(f.driveFileId).trim();
        assertNoMutarPlantilla(id, 'consolidar');
        await driveService.eliminarArchivo(id).catch((err) => {
            console.warn(`[AF-F-02] No se pudo eliminar Word duplicado ${id}:`, err.message);
        });
        console.log(`[AF-F-02] Word duplicado eliminado: ${f.nombreArchivo} (${id})`);
    }
}

async function listarContratosWordArchivados() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_WORD_ARCHIVADOS_ID);
    return (archivos || [])
        .filter((f) => {
            const n = String(f.name || '');
            if (!/\.docx$/i.test(n)) return false;
            if (n.toLowerCase() === NOMBRE_PLANTILLA_DOCX.toLowerCase()) return false;
            return /^AF-F-02 Contrato -/i.test(n);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))
        .map((f) => ({
            driveFileId: f.id,
            nombreArchivo: f.name,
            webViewLink: f.webViewLink || null,
            fecha: f.modifiedTime || null
        }));
}

const CAMPOS_SECCION = ['intro', 'declaraciones', 'clausulas', 'cierre', 'pieFirmas'];
const CAMPOS_FIRMA = ['clienteFirmante', 'cargoClienteFirmante', 'firmante', 'cargoFirmante'];

const CAMPOS_VARIABLES = [
    'clienteNombre', 'clienteRepresentanteIntro', 'clienteConstitucion', 'clienteRfc',
    'clienteObjeto', 'clienteRepresentanteLegal', 'clienteDomicilio', 'codigoProyecto',
    'fechaFinVigencia', 'montoMensual', 'montoMensualTexto', 'codigoCotizacion',
    'diaFirma', 'anioFirma', 'pieCliente', 'pieFecha'
];

/** Valores vacíos para UI / nuevos contratos (sin placeholders xxx). */
const CAMPOS_VARIABLES_DEFECTO = {
    clienteNombre: '',
    clienteRepresentanteIntro: '',
    clienteConstitucion: '',
    clienteRfc: '',
    clienteObjeto: '',
    clienteRepresentanteLegal: '',
    clienteDomicilio: '',
    codigoProyecto: '',
    fechaFinVigencia: '',
    montoMensual: '',
    montoMensualTexto: '',
    codigoCotizacion: '',
    diaFirma: '',
    anioFirma: '',
    pieCliente: '',
    pieFecha: ''
};

/**
 * Marcadores tal como aparecen en la plantilla Google Doc / Word.
 * Se usan SOLO para buscar y reemplazar; no son defaults de la UI.
 */
const CAMPOS_MARCADORES_PLANTILLA = {
    clienteNombre: 'xxx.',
    clienteRepresentanteIntro: 'xx',
    clienteConstitucion: 'xxx',
    clienteRfc: 'xxxxx',
    clienteObjeto: 'xxxxx',
    clienteRepresentanteLegal: 'xxxx',
    clienteDomicilio: 'xxxxx',
    codigoProyecto: 'xxxx',
    fechaFinVigencia: '2 de octubre de 2024',
    montoMensual: 'xxx',
    montoMensualTexto: 'xxx',
    codigoCotizacion: 'xxx',
    diaFirma: 'xx',
    anioFirma: 'xxx',
    pieCliente: 'xxxx.',
    pieFecha: 'xx/xx/xxxx'
};

function reemplazarUnaVez(texto, buscado, nuevo) {
    const t = String(texto || '');
    const i = t.indexOf(buscado);
    if (i < 0) return t;
    return t.slice(0, i) + nuevo + t.slice(i + buscado.length);
}

function sanitizarCamposVariables(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of CAMPOS_VARIABLES) {
        const val = src[key];
        let texto = val === undefined || val === null ? '' : String(val).trim();
        if (key === 'pieFecha' && texto) {
            // Solo patrón fecha: 12/enero/2026 (limpia basura pegada al placeholder).
            const match = texto.match(/^(\d{1,2}|xx)\s*[\/]\s*([a-záéíóúñÁÉÍÓÚÑ\d]{1,12}|octubre|xxxx)\s*[\/]\s*(\d{2,4}|xxxx|xx)/i);
            if (match) {
                texto = `${match[1]}/${match[2]}/${match[3]}`.toLowerCase();
            } else {
                texto = texto.replace(/[^0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ/]/g, '').slice(0, 24);
            }
        }
        out[key] = texto || CAMPOS_VARIABLES_DEFECTO[key];
    }
    return out;
}

function aplicarCamposSobreSecciones(secciones, camposRaw) {
    const c = sanitizarCamposVariables(camposRaw);
    const m = CAMPOS_MARCADORES_PLANTILLA;
    let intro = String((secciones && secciones.intro) || DATOS_DEFECTO.intro);
    intro = reemplazarUnaVez(intro, 'por una parte ' + m.clienteNombre, 'por una parte ' + (c.clienteNombre || m.clienteNombre));
    intro = reemplazarUnaVez(
        intro,
        'por ' + m.clienteRepresentanteIntro + ' ,en su calidad',
        'por ' + (c.clienteRepresentanteIntro || m.clienteRepresentanteIntro) + ' ,en su calidad'
    );

    let declaraciones = String((secciones && secciones.declaraciones) || DATOS_DEFECTO.declaraciones);
    declaraciones = reemplazarUnaVez(declaraciones, 'acreditado ' + m.clienteConstitucion, 'acreditado ' + (c.clienteConstitucion || m.clienteConstitucion));
    declaraciones = reemplazarUnaVez(declaraciones, 'Contribuyentes ' + m.clienteRfc, 'Contribuyentes ' + (c.clienteRfc || m.clienteRfc));
    declaraciones = reemplazarUnaVez(declaraciones, 'por objeto ' + m.clienteObjeto, 'por objeto ' + (c.clienteObjeto || m.clienteObjeto));
    declaraciones = reemplazarUnaVez(
        declaraciones,
        'legal es ' + m.clienteRepresentanteLegal + ',',
        'legal es ' + (c.clienteRepresentanteLegal || m.clienteRepresentanteLegal) + ','
    );
    declaraciones = reemplazarUnaVez(declaraciones, 'ubicado en ' + m.clienteDomicilio, 'ubicado en ' + (c.clienteDomicilio || m.clienteDomicilio));

    let clausulas = String((secciones && secciones.clausulas) || DATOS_DEFECTO.clausulas);
    clausulas = reemplazarUnaVez(
        clausulas,
        'código ' + m.codigoProyecto + ' cuyas',
        'código ' + (c.codigoProyecto || m.codigoProyecto) + ' cuyas'
    );
    const fechaFinDoc = formatearPieFechaParaDocumento(c.fechaFinVigencia) || c.fechaFinVigencia || m.fechaFinVigencia;
    clausulas = reemplazarUnaVez(
        clausulas,
        'efectos el ' + m.fechaFinVigencia + '.',
        'efectos el ' + fechaFinDoc + '.'
    );
    clausulas = reemplazarUnaVez(
        clausulas,
        'mensual de $' + m.montoMensual + ' (' + m.montoMensualTexto + ' pesos',
        'mensual de $' + (c.montoMensual || m.montoMensual) + ' (' + (c.montoMensualTexto || m.montoMensualTexto) + ' pesos'
    );
    clausulas = reemplazarUnaVez(
        clausulas,
        'cotización B-SC-' + m.codigoCotizacion + ' ',
        'cotización B-SC-' + (c.codigoCotizacion || m.codigoCotizacion) + ' '
    );

    let cierre = String((secciones && secciones.cierre) || DATOS_DEFECTO.cierre);
    cierre = reemplazarUnaVez(cierre, 'el día ' + m.diaFirma + ' de octubre', 'el día ' + (c.diaFirma || m.diaFirma) + ' de octubre');
    cierre = reemplazarUnaVez(cierre, 'del año ' + m.anioFirma, 'del año ' + (c.anioFirma || m.anioFirma));

    let pieFirmas = String((secciones && secciones.pieFirmas) || DATOS_DEFECTO.pieFirmas);
    pieFirmas = reemplazarUnaVez(pieFirmas, 'entre “' + m.pieCliente + '” y', 'entre “' + (c.pieCliente || m.pieCliente) + '” y');
    const pieFechaDoc = formatearPieFechaParaDocumento(c.pieFecha) || formatearPieFechaParaDocumento(m.pieFecha);
    pieFirmas = reemplazarUnaVez(pieFirmas, 'el  xx octubre de xx,', 'el  ' + pieFechaDoc + ',');
    pieFirmas = reemplazarUnaVez(pieFirmas, 'el xx octubre de xx,', 'el ' + pieFechaDoc + ',');

    return { intro, declaraciones, clausulas, cierre, pieFirmas };
}

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2024-09-18',
    revision: '00',
    intro:
        'Contrato de prestación de servicios que celebran por una parte xxx. representada en este acto por xx ,en su calidad de representante legal, a quien en lo sucesivo se le denominará "el cliente" y por la otra, Biznaga Risk and Tech S. de R.L. de C.V., en lo sucesivo “el prestador de servicios", y de manera conjunta se denominarán “las partes”, al tenor de las siguientes:',
    declaraciones:
        'Declaraciones\n'
        + '1. Declara  "el cliente”:\n'
        + '1.1.        Que es una empresa legalmente constituida y organizada conforme a las leyes y disposiciones de los Estados Unidos Mexicanos, acreditado xxx\n'
        + '1.2.        Que se encuentra dada de alta ante el Servicio de Administración Tributaria con la clave de Registro Federal de Contribuyentes xxxxx\n'
        + '1.3.        Que tiene por objeto xxxxx\n'
        + '1.4.        Que su representante legal es xxxx, quien tiene la capacidad legal para suscribir contratos, convenios y otros instrumentos jurídicos.\n'
        + 'i.4.        Que para efectos del presente contrato señala como su domicilio legal el ubicado en xxxxx\n'
        + '2. Declara “el prestador de servicios":\n'
        + '2.1.        Que es una empresa legalmente constituida en el Estado de Hidalgo de conformidad con el Acta Notarial con número de póliza 1960 de la Correduría Pública no. 7.\n'
        + '2.2.        Que tiene por objeto la consultoría en la implementación de sistemas de calidad, seguridad e higiene industrial y medicina laboral, así como en materia ambiental, capacitación, entre otros\n'
        + '2.3.        Que se encuentra dada de alta ante el Servicio de Administración Tributaria con la clave de Registro Federal de Contribuyentes BRT1702204Z5.\n'
        + '2.4.        Que su representante legal es Marisol Azucena Santillán Melo, en términos de la cláusula transitoria segunda del instrumento público 1388 de la Correduría Pública número 7, encontrándose dentro de sus facultades las de suscribir contratos, convenios y otros acuerdos necesarios para el cumplimiento de los objetivos de la persona moral que representa.\n'
        + '2.5.        Que para efectos del presente contrato señala como su domicilio legal el ubicado en Monte Olivo 111, Fraccionamiento Real de la Loma, Pachuca, Hidalgo, con C.P. 42083.\n'
        + '3. Declaran “las partes”:\n'
        + 'Único.- Que se reconocen la personalidad jurídica que ostentan y que es su voluntad suscribir el presente instrumento privado en los términos y condiciones insertos en las siguientes:',
    clausulas:
        'Cláusulas\n'
        + 'Primera. Del objeto del contrato.- “El prestador  de servicios" se obliga a implementar un programa de seguridad y salud en el trabajo para “el cliente”. La denominación de dicho proyecto se identificará con la nomenclatura interna del “prestador de servicios”,  proyecto con código xxxx cuyas características se encuentran especificadas en el “Control de Avance de Proyecto, Cumplimiento Normativa STPS”, [Anexo I].\n'
        + 'Segunda. De las condiciones del proyecto.- La implementación del proyecto tendrá una duración de un año y su objetivo específico es desarrollar y aplicar los controles, procedimientos, programas, diagnosticos y en general todas las disposiciones contenidas en las siguiente Normas Oficiales Mexicanas:\n'
        + '1. "NOM-001-STPS-2008 Edificios, locales, instalaciones y áreas en los centros de trabajo  Condiciones de seguridad.\n'
        + '2. NOM-002-STPS-2010 Prevención y protección contra incendios en los centros de trabajo Condiciones de seguridad.\n'
        + '3. "NOM-004-STPS-1999  Sistemas de protección y dispositivos de seguridad en la maquinaria y equipo que se utilice en los centros de trabajo"\n'
        + '4. " NOM-006-STPS-2014,  Manejo y almacenamiento de materiales Condiciones de seguridad y salud en el trabajo.\n'
        + '5. NOM 005 Relativa a las condiciones de seguridad e higiene, en los centros de trabajo para el manejo, transporte y almacenamiento de sustancias químicas peligrosas\n'
        + '6. NOM-017-STPS-2008  Equipo de protección personal, Selección, uso y manejo en los centros de trabajo\n'
        + '7. "NOM-018-STPS-2015, Sistema armonizado para la identificación y comunicación de peligros y riesgos por sustancias químicas peligrosas en los centros de trabajo\n'
        + '8. "NOM-019-STPS-2011 Constitución, integración, organización y funcionamiento de las comisiones de seguridad e higiene en los centros de trabajo\n'
        + '9. " NOM-020-STPS-2011  Recipientes sujetos a presión, recipientes criogénicos y generadores de vapor o calderas.- Funcionamiento Condiciones de seguridad\n'
        + '10. " NOM-022-STPS-2008 Electricidad estática en los centros de trabajo Condiciones de seguridad.\n'
        + '11. NOM-025-STPS-2008 Condiciones de iluminación en los centros de trabajo\n'
        + '12. NOM-026-STPS-2008  Colores y señales de seguridad e higiene, e identificación de riesgos por fluidos conducidos en tubería\n'
        + '13. NOM-029-STPS-2011, Mantenimiento de las instalaciones eléctricas en los centros de trabajo-Condiciones de seguridad.\n'
        + '14. "NOM-030-STPS-2009, Servicios preventivos de seguridad y salud en el trabajo- Funciones y actividades.\n'
        + '15. "NORMA Oficial Mexicana NOM-036-1-STPS-2018, Factores de riesgo ergonómico en el Trabajo-Identificación, análisis, prevención y control. Parte 1: Manejo manual de cargas.\n'
        + 'El avance y entregas del proyecto se realizarán de conformidad a la programación especificada en el formato interno del "prestador  de servicios", denominado “control de proyecto código SP-F-05”, mismo que se anexa al presente instrumento jurídico en dos tantos firmados en original por las partes, [Anexo II].\n'
        + 'Tercera. De la vigencia.- El presente contrato comenzará su vigencia y surtirá sus efectos a partir de la fecha de su suscripción. Terminando sus efectos el 2 de octubre de 2024.\n'
        + 'Cuarta. Del pago- Como contraprestación del servicio, “el cliente” se obliga a pagar la cantidad mensual de $xxx (xxx pesos 00/100 m.n.) sin IVA, de conformidad con la cotización B-SC-xxx [Anexo III].\n'
        + 'El “prestador de servicios” se obliga a aportar al “cliente” la documentación mensual que contenga el avance de la implementación del proyecto objeto del presente contrato, de acuerdo a la programación establecida en el Anexo II. Dicha documentación deberá entregarse los días 21 de cada mes en el domicilio del “cliente”.\n'
        + 'El pago deberá efectuarse en su totalidad, cuando “el prestador de servicios” cumpla con lo pactado en el párrafo inmediato anterior.\n'
        + 'Quinta. De la forma de pago.- La cantidad enunciada en la cláusula “Tercera” de este instrumento jurídico, deberá ser pagada en moneda nacional, mediante transferencia electrónica.\n'
        + '"El cliente" realizará dicha operación a la cuenta 04704412648 del Banco Scotiabank con CLABE interbancaria 044290047044126481, misma que pertenece al "prestador de servicios".\n'
        + '“El prestador de servicios” expedirá los documentos fiscales digitales correspondientes de cada una de las operaciones financieras realizadas durante la vigencia del contrato.\n'
        + 'Sexta. De la pena convencional.- Si “el prestador de servicios” no entrega la documentación a la que se hizo referencia en el párrafo segundo de la cláusula “Tercera”, dentro del plazo establecido para tal efecto, se impondrá una pena convencional equivalente al 5% por cada día de retraso, sobre el importe de la contraprestación señalada en la cláusula “Tercera”; siendo este porcentaje acumulable hasta que “el prestador de servicios” cumpla con la obligación pactada.\n'
        + 'Séptima. Del acceso a instalaciones e información.- "El cliente" se obliga a proporcionar al "prestador de servicios" todos los elementos e información necesarios para la implementación del programa de seguridad y salud en el trabajo, así como cualquier otra actividad esencial para la eficiente prestación de los servicios contratados en este instrumento.\n'
        + 'Octava. De las causales de rescisión.- "El cliente" podrá rescindir el presente contrato sin responsabilidad, en los siguientes supuestos:\n'
        + '1. Cuando “el prestador de servicios” suspenda injustificadamente la ejecución de los servicios sin previo aviso y acuerdo entre “las partes”.\n'
        + '2. En caso de incumplimiento de las obligaciones pactadas dentro del cuerpo del presente contrato por parte del “prestador de servicios”.\n'
        + '"El cliente” deberá notificar por escrito o cualquier medio con soporte electrónico al “prestador de servicios”, por lo menos 15 días hábiles anteriores, a partir del día en que se pretenda rescindir éste instrumento jurídico.\n'
        + 'Novena. De la terminación del contrato.- El presente contrato de prestación de servicios terminará por alguna de las siguientes causas:\n'
        + '1. La consecución del objeto del presente contrato.\n'
        + '2. La imposibilidad material de seguir prestando el servicio jurídico.\n'
        + '3. El mutuo consentimiento de “las partes”.\n'
        + 'Décima.- De la novación.- Bajo ninguna circunstancia se entenderán por novadas las obligaciones contraídas dentro del presente contrato de forma tácita o por el simple paso del tiempo. Por lo que al término de su vigencia, “las partes” deberán suscribir un nuevo instrumento, si así conviene a sus intereses.\n'
        + 'Décimo primera.  De la naturaleza jurídica de la relación contractual.- “El prestador de servicios" conviene y acepta que en atención al origen del presente contrato, no se derivan de él, en ningún caso, relaciones jurídicas de carácter permanente.\n'
        + 'Las partes reconocen que el presente contrato constituye un instrumento meramente civil, y en ningún caso, implica una relación laboral o de cualquier otra naturaleza.\n'
        + 'Décimo segunda. Confidencialidad.- “El prestador de servicios” se comprometen a guardar confidencialidad respecto de cualquier tipo de documentación, información o proceso que se genere o intercambie con motivo de la ejecución de las actividades objeto del presente contrato de prestación de servicios,  que se sujetarán en lo que les resulte aplicable a la Ley General de Transparencia y Acceso a la Información Pública, Ley General de Protección de Datos Personales en Posesión de Particulares, Ley Federal de Transparencia y Acceso a la Información Pública y demás normativa en materia de confidencialidad.\n'
        + 'De igual forma, “el prestador de servicios” se obliga a no divulgar, poner a disposición o utilizar en beneficio de cualquier persona física o moral diferente del “cliente”, cualquier información confidencial sin el previo consentimiento por escrito de este.\n'
        + 'Décimo tercera. Incumplimiento por caso fortuito o causas de fuerza mayor.- El incumplimiento de cualquiera de las cláusulas de este contrato por un caso fortuito o causas de fuerza mayor, no será motivo de responsabilidad contractual para ninguna de “las partes”, y ambas tendrán derecho a suspender las obligaciones contenidas en este instrumento civil, previa notificación por escrito con 15 días hábiles de anticipación.\n'
        + 'Décimo cuarta. Jurisdicción.- En caso de interpretación y/o controversia, “las partes” acuerdan someterse a los tribunales competentes del fuero común del distrito judicial de Pachuca de Soto, Hidalgo, renunciando expresamente a cualquiera que les pueda corresponder por razón de cualquier presupuesto procesal de competencia.',
    cierre:
        'Leído que fue el presente contrato y enteradas “las partes” de su contenido y alcance legal, manifiestan su conformidad y lo firman por duplicado, de común acuerdo en Pachuca de Soto, Hidalgo, el día xx de octubre  del año xxx',
    clienteFirmante: '',
    cargoClienteFirmante: 'Representante legal',
    firmante: 'Marisol Azucena Santillán Melo',
    cargoFirmante: 'Representante legal',
    pieFirmas:
        'Las presentes firmas corresponden al contrato de prestación de servicios para la implementación de un programa de seguridad y salud en el trabajo, celebrado entre “xxxx.” y  “Biznaga Risk and Tech S. de R.L. de C.V.”, el  xx octubre de xx,  suscrito en Pachuca, Hidalgo.',
    pdfFirmado: null
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function textoEditable(valor, defecto = '') {
    if (valor === undefined || valor === null) {
        return normalizarSaltosLinea(defecto);
    }
    return normalizarSaltosLinea(valor);
}

/** Para secciones del contrato: vacío → texto de la plantilla (nunca dejar huecos). */
function textoSeccion(valor, defecto = '') {
    const texto = textoEditable(valor, defecto);
    return texto || normalizarSaltosLinea(defecto);
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

function siguienteVersionPdf(datos, historialDrive = []) {
    const cliente = sanitizarNombreArchivoDrive(
        (datos?.campos && datos.campos.clienteNombre) || datos?.empresa || 'Contrato'
    );
    const iso = formatearFechaIso(datos?.fechaElaboracion) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const prefijo = `AF-F-02 Contrato - ${cliente} - ${mm}/${yy}`;

    let max = 0;
    const fuentes = [
        ...sanitizarPdfsHistorial(datos?.pdfsHistorial),
        ...(Array.isArray(historialDrive) ? historialDrive : [])
    ];
    const seen = new Set();
    for (const p of fuentes) {
        const n = String(p?.nombreArchivo || '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        // Nuevo formato: ... - 09/26 - 01.pdf
        let m = n.match(new RegExp(`^${escaparRegex(prefijo)} - (\\d{1,2})\\.pdf$`, 'i'));
        if (m) {
            max = Math.max(max, parseInt(m[1], 10) || 0);
            continue;
        }
        // Formatos viejos del mismo cliente/mes cuentan como versión ocupada
        if (n.toLowerCase().startsWith(prefijo.toLowerCase()) && /\.pdf$/i.test(n)) {
            max = Math.max(max, 1);
        }
    }
    return String(max + 1).padStart(2, '0');
}

/** AF-F-02 Contrato - Cliente - MM/AA - 01.pdf */
function nombrePdfHistorial(datos = {}, fechaIso = fechaHoyIso(), historialDrive = []) {
    const campos = sanitizarCamposVariables(datos?.campos);
    const cliente = sanitizarNombreArchivoDrive(campos.clienteNombre || datos?.empresa || 'Contrato');
    const iso = formatearFechaIso(fechaIso || datos?.fechaElaboracion) || fechaHoyIso();
    const [, mm] = iso.split('-');
    const yy = iso.slice(2, 4);
    const version = siguienteVersionPdf({ ...datos, campos, fechaElaboracion: iso }, historialDrive);
    return `AF-F-02 Contrato - ${cliente} - ${mm}/${yy} - ${version}.pdf`;
}

function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esNombrePdfDelFormato(nombre) {
    const n = String(nombre || '').trim();
    if (n.toLowerCase() === NOMBRE_PDF_ARCHIVO.toLowerCase()) return true;
    // Nuevo: ... - 09/26 - 01.pdf | viejo con id/stamp opcional
    return /^AF-F-02 Contrato( - .+)? - \d{2}\/\d{2}( - .+)?\.pdf$/i.test(n);
}

function historialPdfsDelContrato(datos, historialDrive = []) {
    const d = datos && typeof datos === 'object' ? datos : {};
    const desdeContrato = sanitizarPdfsHistorial(d.pdfsHistorial);
    if (desdeContrato.length) return desdeContrato;

    const cliente = sanitizarNombreArchivoDrive(d.campos?.clienteNombre || '');
    const driveList = Array.isArray(historialDrive) ? historialDrive : [];

    return driveList.filter((p) => {
        const n = String(p?.nombreArchivo || '');
        if (p && p.contratoId && d.contratoActivoId && p.contratoId === d.contratoActivoId) return true;
        if (cliente && cliente !== 'Cliente' && new RegExp(
            `^AF-F-02 Contrato - ${escaparRegex(cliente)} - \\d{2}/\\d{2}`,
            'i'
        ).test(n)) return true;
        return false;
    });
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

function textoParrafoElemento(el) {
    return ((el && el.paragraph && el.paragraph.elements) || [])
        .map((e) => (e.textRun && e.textRun.content) || '')
        .join('');
}

function snapshotCampos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const campos = sanitizarCamposVariables(base.campos);
    const seccionesBase = {};
    for (const campo of CAMPOS_SECCION) {
        seccionesBase[campo] = textoSeccion(base[campo], DATOS_DEFECTO[campo]);
    }
    const rendered = aplicarCamposSobreSecciones(seccionesBase, campos);
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        campos,
        intro: rendered.intro,
        declaraciones: rendered.declaraciones,
        clausulas: rendered.clausulas,
        cierre: rendered.cierre,
        pieFirmas: rendered.pieFirmas,
        clienteFirmante: '',
        cargoClienteFirmante: textoEditable(base.cargoClienteFirmante, DATOS_DEFECTO.cargoClienteFirmante)
            || DATOS_DEFECTO.cargoClienteFirmante,
        firmante: textoEditable(base.firmante, DATOS_DEFECTO.firmante) || DATOS_DEFECTO.firmante,
        cargoFirmante: textoEditable(base.cargoFirmante, DATOS_DEFECTO.cargoFirmante)
            || DATOS_DEFECTO.cargoFirmante
    };
}

function sanitizarPlantillaSync(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return snapshotCampos(raw);
}

function snapshotPlantillaDesdeDatos(datos) {
    return snapshotCampos(datos);
}

function crearReplaceRequest(textoAnterior, textoNuevo) {
    const anterior = String(textoAnterior ?? '').trim();
    const nuevo = String(textoNuevo ?? '').trim();
    if (!anterior || anterior === nuevo) {
        return null;
    }
    return {
        replaceAllText: {
            containsText: { text: anterior, matchCase: true },
            replaceText: nuevo
        }
    };
}

function construirCuerpoInsertable(datos) {
    const d = snapshotCampos(datos);
    return [d.intro, d.declaraciones, d.clausulas, d.cierre]
        .map((t) => normalizarSaltosLinea(t))
        .filter(Boolean)
        .join('\n\n') + '\n';
}

async function copiarPlantillaComoGoogleDoc(sourceFileId = TEMPLATE_GOOGLE_DOC_ID) {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    const drive = google.drive({ version: 'v3', auth });
    const requestBody = {
        name: `_temp_af_f02_sync_${Date.now()}`
    };
    // Word → Google Doc: hay que pedir conversión. Doc → Doc: copiar tal cual.
    if (sourceFileId !== TEMPLATE_GOOGLE_DOC_ID) {
        requestBody.mimeType = GOOGLE_DOC_MIME;
    }
    const copyResp = await drive.files.copy({
        fileId: sourceFileId,
        supportsAllDrives: true,
        requestBody,
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo crear la copia temporal de la plantilla AF-F-02.');
    }
    return {
        drive,
        docsApi: google.docs({ version: 'v1', auth }),
        docId
    };
}

function aplicarRequestsEnDoc(docsApi, documentId, requests) {
    assertNoMutarPlantilla(documentId, 'editar con Docs API');
    const limpios = (requests || []).filter(Boolean);
    if (!limpios.length) return Promise.resolve();
    return docsApi.documents.batchUpdate({
        documentId,
        requestBody: { requests: limpios }
    });
}

/** deleteContentRange seguro: evita rangos vacíos/inválidos (error Google Docs). */
function crearDeleteContentRange(startIndex, endIndex) {
    const start = Number(startIndex);
    const end = Number(endIndex);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }
    return {
        deleteContentRange: {
            range: { startIndex: start, endIndex: end }
        }
    };
}

function crearInsertText(index, text) {
    if (text == null) return null;
    const valor = String(text);
    // Google Docs rechaza insertText vacío en algunos contextos.
    if (!valor.length) return null;
    if (!Number.isFinite(Number(index))) return null;
    return {
        insertText: {
            location: { index: Number(index) },
            text: valor
        }
    };
}

/** Última tabla de 2 columnas = bloque de firmas (evita tablas de encabezado). */
function encontrarTablaFirmas(content) {
    let fallback = null;
    let match = null;
    for (const el of content || []) {
        if (!el.table || el.table.columns !== 2) continue;
        fallback = el;
        const cells = el.table.tableRows?.[0]?.tableCells || [];
        const text = cells
            .map((c) => (c.content || []).map((p) => textoParrafoElemento(p)).join(''))
            .join(' ')
            .toLowerCase();
        if (text.includes('prestador') || text.includes('cliente') || text.includes('firmante')) {
            match = el;
        }
    }
    return match || fallback;
}

function parrafoTieneSaltoPagina(el) {
    return ((el && el.paragraph && el.paragraph.elements) || [])
        .some((e) => !!e.pageBreak);
}

function textosCeldasFirmas(datos) {
    const d = snapshotCampos(datos);
    const linea = '______________________________';
    // Compacto: sin fila vacía intermedia para no forzar huecos / salto de página.
    return [
        ['Por el “cliente”', 'Por “el prestador de servicios”'],
        [linea, linea],
        [String(d.clienteFirmante || '').trim() || ' ', String(d.firmante || DATOS_DEFECTO.firmante).trim()],
        [
            String(d.cargoClienteFirmante || DATOS_DEFECTO.cargoClienteFirmante).trim(),
            String(d.cargoFirmante || DATOS_DEFECTO.cargoFirmante).trim()
        ]
    ];
}

/**
 * La tabla original de firmas es 1 fila alta: Google Docs la parte entre páginas.
 * Se elimina y se recrea en hoja nueva como tabla 5×2 (filas cortas) + pie.
 */
async function reconstruirFirmasSinPartir(docsApi, documentId, datos) {
    const d = snapshotCampos(datos);
    let doc = await docsApi.documents.get({ documentId });
    let content = doc.data.body?.content || [];
    let table = encontrarTablaFirmas(content);
    if (!table?.table || table.startIndex == null || table.endIndex == null) {
        console.warn('[AF-F-02] reconstruirFirmas: no hay tabla de firmas.');
        return false;
    }

    // Quitar pageBreaks previos a firmas (evita hoja casi vacía antes de firmar).
    try {
        const breaks = [];
        for (const el of content) {
            if (el.endIndex == null || el.endIndex > table.startIndex) continue;
            for (const pe of (el.paragraph?.elements || [])) {
                if (pe.pageBreak && pe.startIndex != null && pe.endIndex != null) {
                    breaks.push({ start: pe.startIndex, end: pe.endIndex });
                }
            }
        }
        for (let i = breaks.length - 1; i >= 0; i -= 1) {
            const del = crearDeleteContentRange(breaks[i].start, breaks[i].end);
            if (del) await aplicarRequestsEnDoc(docsApi, documentId, [del]);
        }
        if (breaks.length) {
            doc = await docsApi.documents.get({ documentId });
            content = doc.data.body?.content || [];
            table = encontrarTablaFirmas(content);
            if (!table?.table || table.startIndex == null || table.endIndex == null) {
                console.warn('[AF-F-02] reconstruirFirmas: tabla perdida tras quitar saltos.');
                return false;
            }
        }
    } catch (pbErr) {
        console.warn('[AF-F-02] No se pudieron quitar saltos antes de firmas:', pbErr.message);
    }

    let pieEl = null;
    for (const el of content) {
        if (!el.paragraph || el.startIndex == null || el.startIndex < table.endIndex) continue;
        if (textoParrafoElemento(el).trim().startsWith('Las presentes firmas')) {
            pieEl = el;
            break;
        }
    }

    const insertAt = table.startIndex;
    const endDelete = pieEl && pieEl.endIndex != null ? pieEl.endIndex : table.endIndex;

    try {
        const del = crearDeleteContentRange(insertAt, endDelete);
        if (!del) throw new Error('Rango de borrado inválido');
        await aplicarRequestsEnDoc(docsApi, documentId, [del]);
    } catch (err) {
        console.warn('[AF-F-02] No se pudo borrar bloque firmas:', err.message);
        return false;
    }

    // Sin forzar salto de página: quedan en la hoja anterior si caben (evita huecos).
    await aplicarRequestsEnDoc(docsApi, documentId, [
        { insertTable: { rows: 4, columns: 2, location: { index: insertAt } } }
    ]);

    const doc2 = await docsApi.documents.get({ documentId });
    const tableNueva = encontrarTablaFirmas(doc2.data.body?.content || []);
    if (!tableNueva?.table) {
        console.warn('[AF-F-02] reconstruirFirmas: no apareció la tabla nueva.');
        return false;
    }

    const filas = textosCeldasFirmas(d);
    const inserts = [];
    for (let r = filas.length - 1; r >= 0; r -= 1) {
        for (let c = 1; c >= 0; c -= 1) {
            const cell = tableNueva.table.tableRows[r]?.tableCells?.[c];
            const para = (cell?.content || []).find((x) => x.paragraph);
            if (!para || para.startIndex == null) continue;
            const texto = filas[r][c];
            if (!texto || !String(texto).length) continue;
            inserts.push({
                insertText: { location: { index: para.startIndex }, text: String(texto) }
            });
        }
    }
    if (inserts.length) {
        await aplicarRequestsEnDoc(docsApi, documentId, inserts);
    }

    // Estilo: sin bordes, centrado, columnas fijas
    const doc3 = await docsApi.documents.get({ documentId });
    const tableStyle = encontrarTablaFirmas(doc3.data.body?.content || []);
    if (tableStyle?.table) {
        const styleReqs = [{
            updateTableColumnProperties: {
                tableStartLocation: { index: tableStyle.startIndex },
                columnIndices: [0, 1],
                tableColumnProperties: {
                    widthType: 'FIXED_WIDTH',
                    width: { magnitude: 220, unit: 'PT' }
                },
                fields: 'widthType,width'
            }
        }];
        for (let r = 0; r < 4; r += 1) {
            for (let c = 0; c < 2; c += 1) {
                styleReqs.push({
                    updateTableCellStyle: {
                        tableRange: {
                            tableCellLocation: {
                                tableStartLocation: { index: tableStyle.startIndex },
                                rowIndex: r,
                                columnIndex: c
                            },
                            rowSpan: 1,
                            columnSpan: 1
                        },
                        tableCellStyle: {
                            paddingTop: { magnitude: r === 1 ? 6 : 0, unit: 'PT' },
                            paddingBottom: { magnitude: r === 0 ? 2 : 0, unit: 'PT' },
                            paddingLeft: { magnitude: 6, unit: 'PT' },
                            paddingRight: { magnitude: 6, unit: 'PT' },
                            borderTop: { width: { magnitude: 0, unit: 'PT' }, dashStyle: 'SOLID', color: { color: { rgbColor: {} } } },
                            borderBottom: { width: { magnitude: 0, unit: 'PT' }, dashStyle: 'SOLID', color: { color: { rgbColor: {} } } },
                            borderLeft: { width: { magnitude: 0, unit: 'PT' }, dashStyle: 'SOLID', color: { color: { rgbColor: {} } } },
                            borderRight: { width: { magnitude: 0, unit: 'PT' }, dashStyle: 'SOLID', color: { color: { rgbColor: {} } } }
                        },
                        fields: 'paddingTop,paddingBottom,paddingLeft,paddingRight,borderTop,borderBottom,borderLeft,borderRight'
                    }
                });
                const cell = tableStyle.table.tableRows[r]?.tableCells?.[c];
                for (const el of cell?.content || []) {
                    if (!el.paragraph) continue;
                    styleReqs.push({
                        updateParagraphStyle: {
                            range: { startIndex: el.startIndex, endIndex: el.endIndex },
                            paragraphStyle: {
                                alignment: 'CENTER',
                                spaceAbove: { magnitude: 0, unit: 'PT' },
                                spaceBelow: { magnitude: 0, unit: 'PT' },
                                keepWithNext: true,
                                keepLinesTogether: true
                            },
                            fields: 'alignment,spaceAbove,spaceBelow,keepWithNext,keepLinesTogether'
                        }
                    });
                }
            }
        }
        try {
            await aplicarRequestsEnDoc(docsApi, documentId, styleReqs);
        } catch (styleErr) {
            console.warn('[AF-F-02] Estilo tabla firmas:', styleErr.message);
        }
    }

    // Pie debajo de la tabla
    const doc4 = await docsApi.documents.get({ documentId });
    const tableFinal = encontrarTablaFirmas(doc4.data.body?.content || []);
    const pieTexto = String(d.pieFirmas || DATOS_DEFECTO.pieFirmas).trim();
    if (tableFinal?.endIndex != null && pieTexto) {
        await aplicarRequestsEnDoc(docsApi, documentId, [{
            insertText: { location: { index: tableFinal.endIndex }, text: `\n${pieTexto}` }
        }]);
    }

    console.log('[AF-F-02] Firmas reconstruidas (tabla 4x2 compacta, sin salto forzado).');
    return true;
}

/**
 * Fallback: inserta salto antes de la tabla existente.
 */
async function asegurarFirmasEnPaginaNueva(docsApi, documentId) {
    const doc = await docsApi.documents.get({ documentId });
    const content = doc.data.body?.content || [];
    const table = encontrarTablaFirmas(content);
    if (!table || table.startIndex == null) {
        console.warn('[AF-F-02] Sin tabla de firmas; no se inserta salto de página.');
        return false;
    }

    let prev = null;
    for (const el of content) {
        if (el.endIndex != null && el.endIndex <= table.startIndex) {
            prev = el;
        }
    }

    if (prev?.paragraph && parrafoTieneSaltoPagina(prev)) {
        return true;
    }

    try {
        if (prev?.paragraph && prev.endIndex > prev.startIndex + 1) {
            const breakAt = prev.endIndex - 1;
            await aplicarRequestsEnDoc(docsApi, documentId, [{
                insertPageBreak: { location: { index: breakAt } }
            }]);
            return true;
        }
        const idx = table.startIndex;
        await aplicarRequestsEnDoc(docsApi, documentId, [
            { insertText: { location: { index: idx }, text: '\n' } }
        ]);
        await aplicarRequestsEnDoc(docsApi, documentId, [
            { insertPageBreak: { location: { index: idx } } }
        ]);
        return true;
    } catch (err) {
        console.warn('[AF-F-02] asegurarFirmasEnPaginaNueva:', err.message);
        return false;
    }
}

/**
 * Corrige la tabla de firmas (estilo). Ya NO fuerza salto de página.
 */
async function arreglarTablaFirmas(docsApi, documentId) {
    const doc = await docsApi.documents.get({ documentId });
    const table = encontrarTablaFirmas(doc.data.body?.content || []);
    if (!table?.table) return;

    const requests = [];
    requests.push({
        updateTableColumnProperties: {
            tableStartLocation: { index: table.startIndex },
            columnIndices: [0, 1],
            tableColumnProperties: {
                widthType: 'FIXED_WIDTH',
                width: { magnitude: 200, unit: 'PT' }
            },
            fields: 'widthType,width'
        }
    });

    table.table.tableRows[0].tableCells.forEach((cell, cellIdx) => {
        requests.push({
            updateTableCellStyle: {
                tableRange: {
                    tableCellLocation: {
                        tableStartLocation: { index: table.startIndex },
                        rowIndex: 0,
                        columnIndex: cellIdx
                    },
                    rowSpan: 1,
                    columnSpan: 1
                },
                tableCellStyle: {
                    paddingLeft: { magnitude: 16, unit: 'PT' },
                    paddingRight: { magnitude: 16, unit: 'PT' },
                    paddingTop: { magnitude: 2, unit: 'PT' },
                    paddingBottom: { magnitude: 2, unit: 'PT' }
                },
                fields: 'paddingLeft,paddingRight,paddingTop,paddingBottom'
            }
        });

        (cell.content || []).forEach((el) => {
            if (!el.paragraph) return;
            requests.push({
                updateParagraphStyle: {
                    range: { startIndex: el.startIndex, endIndex: el.endIndex },
                    paragraphStyle: {
                        alignment: 'CENTER',
                        indentStart: { magnitude: 0, unit: 'PT' },
                        indentEnd: { magnitude: 0, unit: 'PT' },
                        indentFirstLine: { magnitude: 0, unit: 'PT' },
                        keepWithNext: true,
                        keepLinesTogether: true,
                        borderBottom: {
                            width: { magnitude: 0, unit: 'PT' },
                            padding: { magnitude: 0, unit: 'PT' },
                            dashStyle: 'SOLID',
                            color: { color: { rgbColor: {} } }
                        }
                    },
                    fields: 'alignment,indentStart,indentEnd,indentFirstLine,keepWithNext,keepLinesTogether,borderBottom'
                }
            });
        });
    });

    await aplicarRequestsEnDoc(docsApi, documentId, requests);

    // Intento extra: pageBreakBefore en el primer párrafo de la tabla (si la API lo permite).
    try {
        const firstCell = table.table.tableRows[0].tableCells[0];
        const firstPara = (firstCell.content || []).find((c) => c.paragraph);
        if (firstPara) {
            await aplicarRequestsEnDoc(docsApi, documentId, [{
                updateParagraphStyle: {
                    range: { startIndex: firstPara.startIndex, endIndex: firstPara.endIndex },
                    paragraphStyle: { pageBreakBefore: true },
                    fields: 'pageBreakBefore'
                }
            }]);
        }
    } catch (pbErr) {
        console.warn('[AF-F-02] pageBreakBefore en celda firmas:', pbErr.message);
    }

    // Insertar líneas de firma cortas (guiones) en el párrafo vacío que tenía borderBottom
    const doc2 = await docsApi.documents.get({ documentId });
    const table2 = encontrarTablaFirmas(doc2.data.body?.content || []);
    if (!table2?.table) return;

    const insertIndices = [];
    table2.table.tableRows[0].tableCells.forEach((cell) => {
        const paras = (cell.content || []).filter((c) => c.paragraph);
        const linePara = paras[2];
        if (!linePara) return;
        const text = textoParrafoElemento(linePara).replace(/\n/g, '').trim();
        if (text && /_/.test(text)) return;
        insertIndices.push(linePara.startIndex);
    });
    insertIndices.sort((a, b) => b - a);
    if (insertIndices.length) {
        const linea = '______________________________';
        await aplicarRequestsEnDoc(
            docsApi,
            documentId,
            insertIndices.map((idx) => ({
                insertText: { location: { index: idx }, text: linea }
            }))
        );
    }
}

async function actualizarFirmasEnTabla(docsApi, documentId, datos) {
    const d = snapshotCampos(datos);
    const doc = await docsApi.documents.get({ documentId });
    const table = encontrarTablaFirmas(doc.data.body?.content || []);
    if (!table?.table) return;

    const valores = [
        [d.clienteFirmante, d.cargoClienteFirmante],
        [d.firmante, d.cargoFirmante]
    ];
    const celdas = table.table.tableRows[0].tableCells;

    // De derecha a izquierda; dentro de cada celda: cargo (para 4) y luego nombre (para 3)
    for (let cellIdx = celdas.length - 1; cellIdx >= 0; cellIdx -= 1) {
        const cell = celdas[cellIdx];
        const paras = (cell.content || []).filter((c) => c.paragraph);
        const [nombreNuevo, cargoNuevo] = valores[cellIdx] || [];
        const targets = [
            { para: paras[4], value: cargoNuevo == null ? '' : String(cargoNuevo) },
            { para: paras[3], value: nombreNuevo == null ? '' : String(nombreNuevo) }
        ];

        for (const { para, value } of targets) {
            if (!para) continue;
            const oldText = textoParrafoElemento(para).replace(/\n$/, '');
            if (oldText === value) continue;

            // Preferir replaceAllText por celda; deleteContentRange falla en Docs importados de Word.
            if (oldText) {
                try {
                    const req = crearReplaceRequest(oldText, value || ' ');
                    if (req) {
                        await aplicarRequestsEnDoc(docsApi, documentId, [req]);
                        continue;
                    }
                } catch (_) { /* fallback abajo */ }
            }

            try {
                const ops = [];
                const del = crearDeleteContentRange(para.startIndex, para.endIndex - 1);
                if (oldText.length > 0 && del) {
                    ops.push(del);
                }
                const ins = crearInsertText(para.startIndex, value);
                if (ins) {
                    ops.push(ins);
                }
                if (ops.length) {
                    await aplicarRequestsEnDoc(docsApi, documentId, ops);
                }
            } catch (cellErr) {
                console.warn('[AF-F-02] Celda firmas omitida:', cellErr.message);
            }
        }
    }
}

async function borrarRangoPorElementos(docsApi, documentId, startIndex, endIndex) {
    if (!(endIndex > startIndex)) return;
    const doc = await docsApi.documents.get({ documentId });
    const elementos = (doc.data.body?.content || [])
        .filter((el) => {
            if (el.startIndex == null || el.endIndex == null) return false;
            return el.startIndex >= startIndex && el.endIndex <= endIndex
                && el.endIndex > el.startIndex
                && (el.paragraph || el.table || el.sectionBreak);
        })
        .sort((a, b) => b.startIndex - a.startIndex);

    for (const el of elementos) {
        // No borrar el salto de sección inicial del documento.
        if (el.sectionBreak && el.startIndex <= 1) continue;
        const del = crearDeleteContentRange(el.startIndex, el.endIndex);
        if (!del) continue;
        try {
            await aplicarRequestsEnDoc(docsApi, documentId, [del]);
        } catch (err) {
            console.warn('[AF-F-02] No se pudo borrar elemento', el.startIndex, el.endIndex, err.message);
        }
    }
}

async function reescribirCuerpoYPie(docsApi, documentId, datos) {
    const d = snapshotCampos(datos);
    const doc = await docsApi.documents.get({ documentId });
    const content = doc.data.body?.content || [];

    let introStart = null;
    let tableEl = null;

    for (const el of content) {
        if (el.paragraph) {
            const text = textoParrafoElemento(el).trim();
            if (introStart == null && text.startsWith('Contrato de prestación')) {
                introStart = el.startIndex;
            }
        }
        // Usar la última tabla de 2 columnas (firmas); evita tablas de encabezado.
        if (el.table && el.table.columns === 2) {
            tableEl = el;
        }
    }

    if (introStart == null || !tableEl) {
        throw new Error('No se localizó el cuerpo del contrato en la plantilla.');
    }

    const cuerpo = construirCuerpoInsertable(d);
    const tableStart = tableEl.startIndex;

    // 1) Insertar el cuerpo nuevo ANTES de la tabla de firmas (no borrar primero).
    const insCuerpo = crearInsertText(tableStart, cuerpo);
    if (insCuerpo) {
        await aplicarRequestsEnDoc(docsApi, documentId, [insCuerpo]);
    }

    // 2) Borrar el texto viejo [introStart, tableStart). Tras el insert, ese rango sigue siendo el viejo.
    const delCuerpo = crearDeleteContentRange(introStart, tableStart);
    if (delCuerpo) {
        try {
            await aplicarRequestsEnDoc(docsApi, documentId, [delCuerpo]);
        } catch (err) {
            console.warn('[AF-F-02] Delete masivo falló, borrando por elementos:', err.message);
            await borrarRangoPorElementos(docsApi, documentId, introStart, tableStart);
        }
    }

    // Justificar el cuerpo insertado (releer índices: queda al inicio del rango antiguo)
    const docJust = await docsApi.documents.get({ documentId });
    let cuerpoStart = null;
    let firmasTableStart = null;
    for (const el of docJust.data.body?.content || []) {
        if (el.paragraph) {
            const text = textoParrafoElemento(el).trim();
            if (cuerpoStart == null && text.startsWith('Contrato de prestación')) {
                cuerpoStart = el.startIndex;
            }
        }
        if (el.table && el.table.columns === 2) {
            firmasTableStart = el.startIndex;
        }
    }
    if (cuerpoStart != null && firmasTableStart != null && firmasTableStart > cuerpoStart) {
        await aplicarRequestsEnDoc(docsApi, documentId, [{
            updateParagraphStyle: {
                range: {
                    startIndex: cuerpoStart,
                    endIndex: firmasTableStart
                },
                paragraphStyle: {
                    alignment: 'JUSTIFIED',
                    namedStyleType: 'NORMAL_TEXT'
                },
                fields: 'alignment,namedStyleType'
            }
        }]);
    }

    // Actualizar pie (releer índices)
    const doc2 = await docsApi.documents.get({ documentId });
    const pie = (doc2.data.body?.content || []).find((el) => {
        if (!el.paragraph) return false;
        return textoParrafoElemento(el).trim().startsWith('Las presentes firmas');
    });
    if (pie) {
        const pieText = `${d.pieFirmas}\n`;
        const opsPie = [];
        const delPie = crearDeleteContentRange(pie.startIndex, pie.endIndex - 1);
        if (delPie) opsPie.push(delPie);
        const insPie = crearInsertText(pie.startIndex, pieText);
        if (insPie) opsPie.push(insPie);
        if (opsPie.length) {
            try {
                await aplicarRequestsEnDoc(docsApi, documentId, opsPie);
            } catch (pieErr) {
                console.warn('[AF-F-02] No se pudo actualizar pie de firmas:', pieErr.message);
            }
        }
    }

    // Meta revisión / fecha
    await aplicarRequestsEnDoc(docsApi, documentId, [
        crearReplaceRequest(
            `No. Rev.: ${DATOS_DEFECTO.revision}`,
            `No. Rev.: ${String(d.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`
        ),
        crearReplaceRequest(
            `Fecha Rev.: ${formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaElaboracion)}`,
            `Fecha Rev.: ${formatearFechaPlantillaDoc(d.fechaElaboracion)}`
        )
    ].filter(Boolean));

    try {
        await actualizarFirmasEnTabla(docsApi, documentId, d);
        await arreglarTablaFirmas(docsApi, documentId);
    } catch (firmasErr) {
        console.warn('[AF-F-02] Firmas/tabla (no bloquea PDF):', firmasErr.message);
    }
}

/** Aplica reemplazos de variables xxx (sin deleteContentRange del cuerpo). */
async function aplicarReemplazosVariables(docsApi, documentId, datos) {
    const d = snapshotCampos(datos);
    const c = sanitizarCamposVariables(d.campos || datos.campos);
    const m = CAMPOS_MARCADORES_PLANTILLA;
    const fechaFinDoc = formatearPieFechaParaDocumento(c.fechaFinVigencia) || c.fechaFinVigencia || m.fechaFinVigencia;
    const pieFechaDoc = formatearPieFechaParaDocumento(c.pieFecha) || formatearPieFechaParaDocumento(m.pieFecha);

    const pairs = [
        [`por una parte ${m.clienteNombre}`, `por una parte ${c.clienteNombre || m.clienteNombre}`],
        [`por ${m.clienteRepresentanteIntro} ,en su calidad`, `por ${c.clienteRepresentanteIntro || m.clienteRepresentanteIntro} ,en su calidad`],
        [`por ${m.clienteRepresentanteIntro},en su calidad`, `por ${c.clienteRepresentanteIntro || m.clienteRepresentanteIntro},en su calidad`],
        [`acreditado ${m.clienteConstitucion}`, `acreditado ${c.clienteConstitucion || m.clienteConstitucion}`],
        [`Contribuyentes ${m.clienteRfc}`, `Contribuyentes ${c.clienteRfc || m.clienteRfc}`],
        [`por objeto ${m.clienteObjeto}`, `por objeto ${c.clienteObjeto || m.clienteObjeto}`],
        [`legal es ${m.clienteRepresentanteLegal},`, `legal es ${c.clienteRepresentanteLegal || m.clienteRepresentanteLegal},`],
        [`ubicado en ${m.clienteDomicilio}`, `ubicado en ${c.clienteDomicilio || m.clienteDomicilio}`],
        [`código ${m.codigoProyecto} cuyas`, `código ${c.codigoProyecto || m.codigoProyecto} cuyas`],
        [`codigo ${m.codigoProyecto} cuyas`, `codigo ${c.codigoProyecto || m.codigoProyecto} cuyas`],
        [`efectos el ${m.fechaFinVigencia}.`, `efectos el ${fechaFinDoc}.`],
        [
            `mensual de $${m.montoMensual} (${m.montoMensualTexto} pesos`,
            `mensual de $${c.montoMensual || m.montoMensual} (${c.montoMensualTexto || m.montoMensualTexto} pesos`
        ],
        [`cotización B-SC-${m.codigoCotizacion} `, `cotización B-SC-${c.codigoCotizacion || m.codigoCotizacion} `],
        [`cotizacion B-SC-${m.codigoCotizacion} `, `cotizacion B-SC-${c.codigoCotizacion || m.codigoCotizacion} `],
        [`el día ${m.diaFirma} de octubre`, `el día ${c.diaFirma || m.diaFirma} de octubre`],
        [`el dia ${m.diaFirma} de octubre`, `el dia ${c.diaFirma || m.diaFirma} de octubre`],
        [`del año ${m.anioFirma}`, `del año ${c.anioFirma || m.anioFirma}`],
        [`del ano ${m.anioFirma}`, `del ano ${c.anioFirma || m.anioFirma}`],
        [`entre “${m.pieCliente}” y`, `entre “${c.pieCliente || m.pieCliente}” y`],
        [`entre "${m.pieCliente}" y`, `entre "${c.pieCliente || m.pieCliente}" y`],
        [`el  xx octubre de xx,`, `el  ${pieFechaDoc},`],
        [`el xx octubre de xx,`, `el ${pieFechaDoc},`]
    ];

    const requests = pairs
        .map(([a, b]) => crearReplaceRequest(a, b))
        .filter(Boolean);

    for (const req of requests) {
        try {
            await aplicarRequestsEnDoc(docsApi, documentId, [req]);
        } catch (err) {
            console.warn('[AF-F-02] replace omitido:', err.message);
        }
    }
}

/**
 * Copia la plantilla Google Doc a un archivo TEMPORAL.
 * La plantilla original nunca se edita; al terminar el PDF se borra solo el temp.
 */
async function sincronizarPlantillaGoogleDoc(datos) {
    const destino = snapshotPlantillaDesdeDatos(datos);
    const { drive, docsApi, docId } = await copiarPlantillaComoGoogleDoc(TEMPLATE_GOOGLE_DOC_ID);
    if (!docId || PLANTILLAS_INMUTABLES.has(String(docId))) {
        throw new Error('[AF-F-02] La copia temporal no puede ser una plantilla inmutable.');
    }

    try {
        await aplicarReemplazosVariables(docsApi, docId, destino);

        // Pie de firmas: reemplazo textual en la COPIA temporal.
        try {
            const pieDef = DATOS_DEFECTO.pieFirmas;
            const pieNuevo = String(destino.pieFirmas || pieDef);
            const pieReq = crearReplaceRequest(pieDef, pieNuevo);
            if (pieReq) {
                await aplicarRequestsEnDoc(docsApi, docId, [pieReq]);
            }
        } catch (pieErr) {
            console.warn('[AF-F-02] Pie replace:', pieErr.message);
        }

        // Meta revisión / fecha
        await aplicarRequestsEnDoc(docsApi, docId, [
            crearReplaceRequest(
                `No. Rev.: ${DATOS_DEFECTO.revision}`,
                `No. Rev.: ${String(destino.revision || DATOS_DEFECTO.revision).padStart(2, '0')}`
            ),
            crearReplaceRequest(
                `Fecha Rev.: ${formatearFechaPlantillaDoc(DATOS_DEFECTO.fechaElaboracion)}`,
                `Fecha Rev.: ${formatearFechaPlantillaDoc(destino.fechaElaboracion)}`
            )
        ].filter(Boolean));

        // Reconstruir firmas solo en la copia temporal.
        try {
            await reconstruirFirmasSinPartir(docsApi, docId, destino);
        } catch (saltoErr) {
            console.warn('[AF-F-02] Reconstruir firmas:', saltoErr.message);
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

async function exportarPdfDesdeSync(datos) {
    const syncResult = await sincronizarPlantillaGoogleDoc(datos);
    let archivado = null;
    try {
        if (!syncResult.tempDocId || !syncResult.drive) {
            throw new Error('No se pudo crear la copia temporal del contrato para PDF.');
        }
        const pdfResp = await syncResult.drive.files.export(
            { fileId: syncResult.tempDocId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdfResp.data);
        if (!pdfBuffer.length) {
            throw new Error('El PDF generado está vacío.');
        }
        archivado = await archivarContratoWord(
            syncResult.drive,
            syncResult.tempDocId,
            {
                ...(syncResult.plantillaSync || {}),
                ...datos,
                wordDriveFileId: datos?.wordDriveFileId || datos?.ultimoContratoWord?.driveFileId || null,
                ultimoContratoWord: datos?.ultimoContratoWord || null,
                campos: datos?.campos || syncResult.plantillaSync?.campos
            }
        );
        // archivarContratoWord ya elimina el temp
        syncResult.tempDocId = null;
        return {
            plantillaSync: syncResult.plantillaSync,
            pdfBuffer,
            contratoArchivado: archivado
        };
    } finally {
        if (syncResult.tempDocId && syncResult.drive) {
            try {
                await syncResult.drive.files.delete({
                    fileId: syncResult.tempDocId,
                    supportsAllDrives: true
                });
            } catch (err) {
                console.warn('[AF-F-02] No se pudo eliminar copia temporal de plantilla:', err.message);
            }
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
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || fechaHoyIso(),
        contratoId: String(raw.contratoId || raw.contrato_id || '').trim() || null
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

/** Migra datos antiguos o registros con secciones vacías al texto completo de la plantilla. */
function migrarDatosLegados(base) {
    const src = base && typeof base === 'object' ? base : {};
    const seccionesVacias = CAMPOS_SECCION.every((campo) => !String(src[campo] || '').trim());
    if (!seccionesVacias && String(src.intro || '').trim()) {
        return src;
    }
    return {
        ...DATOS_DEFECTO,
        ...src,
        intro: String(src.intro || '').trim() || DATOS_DEFECTO.intro,
        declaraciones: String(src.declaraciones || '').trim() || DATOS_DEFECTO.declaraciones,
        clausulas: String(src.clausulas || '').trim() || DATOS_DEFECTO.clausulas,
        cierre: String(src.cierre || '').trim() || DATOS_DEFECTO.cierre,
        pieFirmas: String(src.pieFirmas || '').trim() || DATOS_DEFECTO.pieFirmas
    };
}

function nuevoIdContrato() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `aff02-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

/** Contenido de un contrato individual (sin lista del archivero). */
function sanitizarContratoItem(raw) {
    const base = migrarDatosLegados(raw && typeof raw === 'object' ? raw : {});
    const plantillaSync = sanitizarPlantillaSync(base.plantillaSync);
    const item = {
        id: String(base.id || '').trim() || nuevoIdContrato(),
        fechaCreacion: formatearFechaIso(base.fechaCreacion) || formatearFechaIso(base.fechaElaboracion) || fechaHoyIso(),
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        pdfsHistorial: sanitizarPdfsHistorial(base.pdfsHistorial),
        plantillaSync,
        campos: sanitizarCamposVariables(base.campos),
        wordDriveFileId: String(base.wordDriveFileId || base.ultimoContratoWord?.driveFileId || '').trim() || null,
        wordNombre: String(base.wordNombre || base.ultimoContratoWord?.nombreArchivo || '').trim() || null,
        wordWebViewLink: String(base.wordWebViewLink || base.ultimoContratoWord?.webViewLink || '').trim() || null,
        ultimoContratoWord: base.ultimoContratoWord && typeof base.ultimoContratoWord === 'object'
            ? {
                driveFileId: String(base.ultimoContratoWord.driveFileId || '').trim() || null,
                nombreArchivo: String(base.ultimoContratoWord.nombreArchivo || '').trim() || null,
                webViewLink: String(base.ultimoContratoWord.webViewLink || '').trim() || null
            }
            : null
    };
    for (const campo of CAMPOS_SECCION) {
        item[campo] = textoSeccion(base[campo], DATOS_DEFECTO[campo]);
    }
    item.clienteFirmante = '';
    item.cargoClienteFirmante = textoEditable(base.cargoClienteFirmante, DATOS_DEFECTO.cargoClienteFirmante)
        || DATOS_DEFECTO.cargoClienteFirmante;
    item.firmante = textoEditable(base.firmante, DATOS_DEFECTO.firmante) || DATOS_DEFECTO.firmante;
    item.cargoFirmante = textoEditable(base.cargoFirmante, DATOS_DEFECTO.cargoFirmante)
        || DATOS_DEFECTO.cargoFirmante;
    const cliente = String(item.campos?.clienteNombre || '').trim();
    item.titulo = String(base.titulo || '').trim()
        || (cliente ? cliente : 'Nuevo contrato');
    return item;
}

function aplanarContratoActivo(datos) {
    const d = datos && typeof datos === 'object' ? datos : {};
    const contratos = Array.isArray(d.contratos) ? d.contratos : [];
    const activo = contratos.find((c) => c.id === d.contratoActivoId) || contratos[0] || null;
    if (!activo) return d;
    return {
        ...d,
        empresa: activo.empresa,
        fechaElaboracion: activo.fechaElaboracion,
        revision: activo.revision || d.revision,
        campos: activo.campos,
        intro: activo.intro,
        declaraciones: activo.declaraciones,
        clausulas: activo.clausulas,
        cierre: activo.cierre,
        pieFirmas: activo.pieFirmas,
        clienteFirmante: '',
        cargoClienteFirmante: activo.cargoClienteFirmante,
        firmante: activo.firmante,
        cargoFirmante: activo.cargoFirmante,
        pdfFirmado: activo.pdfFirmado,
        pdfsHistorial: Array.isArray(activo.pdfsHistorial) ? activo.pdfsHistorial : [],
        plantillaSync: activo.plantillaSync || d.plantillaSync || null,
        ultimoContratoWord: activo.ultimoContratoWord || null,
        wordDriveFileId: activo.wordDriveFileId || null,
        wordNombre: activo.wordNombre || null,
        wordWebViewLink: activo.wordWebViewLink || null
    };
}

function sanitizarDatos(raw) {
    const base = migrarDatosLegados(raw && typeof raw === 'object' ? raw : {});
    let contratos = Array.isArray(base.contratos)
        ? base.contratos.map((c) => sanitizarContratoItem(c))
        : [];

    // Migración: un solo contrato legacy → archivero (solo si no venía la clave contratos)
    if (!contratos.length && !Array.isArray(raw && raw.contratos)) {
        contratos = [sanitizarContratoItem({
            ...base,
            id: base.contratoActivoId || nuevoIdContrato(),
            fechaCreacion: base.fechaElaboracion || fechaHoyIso()
        })];
    }

    let contratoActivoId = String(base.contratoActivoId || '').trim();
    if (!contratoActivoId || !contratos.some((c) => c.id === contratoActivoId)) {
        contratoActivoId = contratos[0]?.id || null;
    }

    const meta = {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        contratos,
        contratoActivoId
    };

    // Si vienen campos/secciones del contrato activo, volcarlos a la lista
    const conActivoActualizado = volcarCamposActivosALista({
        ...meta,
        empresa: base.empresa,
        campos: base.campos,
        intro: base.intro,
        declaraciones: base.declaraciones,
        clausulas: base.clausulas,
        cierre: base.cierre,
        pieFirmas: base.pieFirmas,
        cargoClienteFirmante: base.cargoClienteFirmante,
        firmante: base.firmante,
        cargoFirmante: base.cargoFirmante,
        pdfFirmado: base.pdfFirmado,
        pdfsHistorial: base.pdfsHistorial,
        plantillaSync: base.plantillaSync,
        ultimoContratoWord: base.ultimoContratoWord,
        wordDriveFileId: base.wordDriveFileId,
        wordNombre: base.wordNombre,
        wordWebViewLink: base.wordWebViewLink
    });

    return aplanarContratoActivo(conActivoActualizado);
}

/** Escribe los campos aplanados del activo dentro de `contratos[]`. */
function volcarCamposActivosALista(datos) {
    const d = datos && typeof datos === 'object' ? datos : {};
    const contratos = Array.isArray(d.contratos) ? d.contratos.map((c) => ({ ...c })) : [];
    if (!contratos.length) {
        return { ...d, contratos: [], contratoActivoId: null };
    }
    let id = String(d.contratoActivoId || '').trim();
    let idx = contratos.findIndex((c) => c && c.id === id);
    if (idx < 0) {
        idx = 0;
        id = contratos[0].id;
    }
    const prev = contratos[idx];
    contratos[idx] = sanitizarContratoItem({
        ...prev,
        empresa: d.empresa !== undefined ? d.empresa : prev.empresa,
        fechaElaboracion: d.fechaElaboracion || prev.fechaElaboracion,
        revision: d.revision || prev.revision,
        campos: d.campos || prev.campos,
        intro: d.intro !== undefined ? d.intro : prev.intro,
        declaraciones: d.declaraciones !== undefined ? d.declaraciones : prev.declaraciones,
        clausulas: d.clausulas !== undefined ? d.clausulas : prev.clausulas,
        cierre: d.cierre !== undefined ? d.cierre : prev.cierre,
        pieFirmas: d.pieFirmas !== undefined ? d.pieFirmas : prev.pieFirmas,
        cargoClienteFirmante: d.cargoClienteFirmante !== undefined
            ? d.cargoClienteFirmante : prev.cargoClienteFirmante,
        firmante: d.firmante !== undefined ? d.firmante : prev.firmante,
        cargoFirmante: d.cargoFirmante !== undefined ? d.cargoFirmante : prev.cargoFirmante,
        pdfFirmado: d.pdfFirmado !== undefined ? d.pdfFirmado : prev.pdfFirmado,
        pdfsHistorial: d.pdfsHistorial !== undefined ? d.pdfsHistorial : prev.pdfsHistorial,
        plantillaSync: d.plantillaSync !== undefined ? d.plantillaSync : prev.plantillaSync,
        ultimoContratoWord: d.ultimoContratoWord || prev.ultimoContratoWord,
        wordDriveFileId: d.wordDriveFileId || prev.wordDriveFileId,
        wordNombre: d.wordNombre || prev.wordNombre,
        wordWebViewLink: d.wordWebViewLink || prev.wordWebViewLink,
        id: prev.id,
        fechaCreacion: prev.fechaCreacion,
        titulo: prev.titulo
    });
    return { ...d, contratos, contratoActivoId: id };
}

function extraerContenidoEditable(datos) {
    const base = sanitizarDatos(datos);
    const out = { empresa: base.empresa, campos: base.campos };
    for (const campo of CAMPOS_SECCION) out[campo] = base[campo];
    out.cargoClienteFirmante = base.cargoClienteFirmante;
    out.firmante = base.firmante;
    out.cargoFirmante = base.cargoFirmante;
    return out;
}

function contenidoEsEquivalente(a, b) {
    const idsA = (Array.isArray(a?.contratos) ? a.contratos : []).map((c) => c?.id).join(',');
    const idsB = (Array.isArray(b?.contratos) ? b.contratos : []).map((c) => c?.id).join(',');
    if (idsA !== idsB) return false;
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
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_PDF_FIRMADOS_ID);
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

async function buscarPdfEnDrive() {
    const lista = await listarPdfsHistorialDrive();
    return lista[0] || null;
}

async function resolverPdfFirmado(datos) {
    const pdfDb = datos?.pdfFirmado;
    if (pdfDb?.driveFileId) {
        const existe = await driveService.verificarArchivoExiste(pdfDb.driveFileId).catch(() => false);
        if (existe) {
            return sanitizarPdfFirmado(pdfDb);
        }
    }

    const lista = await listarPdfsHistorialDrive().catch(() => []);
    const delContrato = historialPdfsDelContrato(datos, lista);
    if (delContrato[0]?.driveFileId) {
        return delContrato[0];
    }
    return pdfDb ? sanitizarPdfFirmado(pdfDb) : null;
}

function construirRespuesta(registro, datos, historialPdfs = [], historialContratosWord = []) {
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

    const historialFiltrado = historialPdfsDelContrato(datos, historialPdfs);
    const historialTodos = Array.isArray(historialPdfs) ? historialPdfs : [];

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            pdfFirmado,
            pdfsHistorial: sanitizarPdfsHistorial(datos.pdfsHistorial).length
                ? sanitizarPdfsHistorial(datos.pdfsHistorial)
                : historialFiltrado
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        pdfPreviewUrl: pdfFirmado?.previewUrl || null,
        pdfDriveFileId: pdfFirmado?.driveFileId || null,
        historialPdfs: historialFiltrado,
        historialPdfsTodos: historialTodos,
        historialContratosWord: Array.isArray(historialContratosWord) ? historialContratosWord : [],
        plantillaDriveFileId: TEMPLATE_GOOGLE_DOC_ID,
        plantillaEditorUrl: `https://docs.google.com/document/d/${TEMPLATE_GOOGLE_DOC_ID}/edit`
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
    let rawParsed = null;
    if (registro?.datos_json) {
        try {
            rawParsed = typeof registro.datos_json === 'string'
                ? JSON.parse(registro.datos_json)
                : registro.datos_json;
        } catch {
            rawParsed = null;
        }
    }
    let datos = await leerDatosRegistro(registro);
    if (!datos) datos = sanitizarDatos(DATOS_DEFECTO);

    // Sembrar BD si el registro no traía el texto completo del contrato.
    const seccionesVacias = !rawParsed
        || CAMPOS_SECCION.every((campo) => !String(rawParsed[campo] || '').trim());
    if (seccionesVacias) {
        await guardarRegistroDb(pool, {
            pdfDriveFileId: datos.pdfFirmado?.driveFileId || registro?.drive_file_id || null,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
        datos = (await leerDatosRegistro(registro)) || datos;
    }

    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    const historialContratosWord = await listarContratosWordArchivados().catch(() => []);

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

    return construirRespuesta(registro, datos, historialPdfs, historialContratosWord);
}

async function guardarFormato(pool, body, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const puedeEditarCompleto = !!opciones.puedeEditarCompleto;
    const payload = body && body.datos && typeof body.datos === 'object' ? body.datos : (body || {});
    const origen = String((body && body.origen) || 'sistema').toLowerCase();
    const pideEdicionCompleta = !!(body && body.edicionCompleta) || !!(payload && payload.edicionCompleta);

    let datosPrevios = null;
    if (registroPrevio && registroPrevio.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registroPrevio.datos_json === 'string'
                    ? JSON.parse(registroPrevio.datos_json)
                    : registroPrevio.datos_json
            );
        } catch (_) {
            datosPrevios = null;
        }
    }

    const camposEntrada = sanitizarCamposVariables(payload.campos);
    const baseMerge = Object.assign({}, datosPrevios || DATOS_DEFECTO, { campos: camposEntrada });

    if (Array.isArray(payload.contratos)) {
        baseMerge.contratos = payload.contratos;
    }
    if (payload.contratoActivoId) {
        baseMerge.contratoActivoId = payload.contratoActivoId;
    }

    if (puedeEditarCompleto && pideEdicionCompleta) {
        for (const campo of CAMPOS_SECCION) {
            if (payload[campo] !== undefined && payload[campo] !== null) {
                baseMerge[campo] = payload[campo];
            }
        }
        if (payload.empresa) baseMerge.empresa = payload.empresa;
        if (payload.cargoClienteFirmante !== undefined) {
            baseMerge.cargoClienteFirmante = payload.cargoClienteFirmante;
        }
        if (payload.firmante !== undefined) baseMerge.firmante = payload.firmante;
        if (payload.cargoFirmante !== undefined) baseMerge.cargoFirmante = payload.cargoFirmante;
    } else if (payload.empresa) {
        baseMerge.empresa = payload.empresa;
    }

    baseMerge.clienteFirmante = '';
    baseMerge.campos = camposEntrada;
    const datosEntrada = sanitizarDatos(baseMerge);

    let fechaOriginal = formatearFechaIso(registroPrevio && registroPrevio.fecha_elaboracion_original);
    let contenidoModificado = !!(registroPrevio && registroPrevio.contenido_modificado);
    let fechaModificacion = formatearFechaIso(registroPrevio && registroPrevio.fecha_modificacion_contenido);
    let revision = (datosPrevios && datosPrevios.revision) || datosEntrada.revision || DATOS_DEFECTO.revision;

    if (!fechaOriginal) fechaOriginal = DATOS_DEFECTO.fechaElaboracion;

    const pdfFirmado = (await resolverPdfFirmado(datosPrevios || datosEntrada))
        || (datosPrevios && datosPrevios.pdfFirmado)
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

    let datosGuardar = {
        empresa: datosEntrada.empresa,
        revision,
        fechaElaboracion,
        pdfFirmado: pdfFirmado ? sanitizarPdfFirmado(pdfFirmado) : null,
        pdfsHistorial: sanitizarPdfsHistorial(datosEntrada.pdfsHistorial),
        plantillaSync: (datosPrevios && datosPrevios.plantillaSync) || null,
        campos: datosEntrada.campos,
        contratos: datosEntrada.contratos || [],
        contratoActivoId: datosEntrada.contratoActivoId || null,
        ultimoContratoWord: datosEntrada.ultimoContratoWord || null,
        wordDriveFileId: datosEntrada.wordDriveFileId || null,
        wordNombre: datosEntrada.wordNombre || null,
        wordWebViewLink: datosEntrada.wordWebViewLink || null
    };
    for (const campo of CAMPOS_SECCION) datosGuardar[campo] = datosEntrada[campo];
    for (const campo of CAMPOS_FIRMA) datosGuardar[campo] = datosEntrada[campo];
    datosGuardar.clienteFirmante = '';

    if (huboCambioContenido && origen !== 'consulta' && (datosGuardar.contratos || []).length) {
        try {
            const syncResult = await sincronizarPlantillaGoogleDoc(datosGuardar);
            datosGuardar.plantillaSync = syncResult.plantillaSync;
            if (syncResult.tempDocId && syncResult.drive) {
                const archivado = await archivarContratoWord(
                    syncResult.drive,
                    syncResult.tempDocId,
                    datosGuardar
                );
                if (archivado?.driveFileId) {
                    datosGuardar.ultimoContratoWord = archivado;
                    datosGuardar.wordDriveFileId = archivado.driveFileId;
                    datosGuardar.wordNombre = archivado.nombreArchivo;
                    datosGuardar.wordWebViewLink = archivado.webViewLink;
                }
            }
        } catch (err) {
            console.error('[AF-F-02] Error sincronizando/archivando contrato:', err.message);
        }
    }

    datosGuardar = sanitizarDatos(volcarCamposActivosALista(datosGuardar));

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    const historialContratosWord = await listarContratosWordArchivados().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs, historialContratosWord);
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    const registroPrevio = await obtenerRegistroDb(pool);
    let datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    const contratoActivoId = String(body?.contratoActivoId || body?.contrato_activo_id || '').trim();
    if (contratoActivoId) {
        datosPrevios = sanitizarDatos({
            ...datosPrevios,
            contratoActivoId
        });
    }

    const historialDrivePrev = await listarPdfsHistorialDrive().catch(() => []);
    const nombreArchivo = nombrePdfHistorial(datosPrevios, fechaHoyIso(), historialDrivePrev);
    const driveResult = await driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );

    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombreArchivo,
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso(),
        contratoId: datosPrevios.contratoActivoId || null
    });

    const histPrev = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial);
    const pdfsHistorial = [pdfFirmado, ...histPrev.filter((p) => p.driveFileId !== pdfFirmado.driveFileId)];

    let datosGuardar = sanitizarDatos(volcarCamposActivosALista({
        ...datosPrevios,
        pdfFirmado,
        pdfsHistorial
    }));

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
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    const historialContratosWord = await listarContratosWordArchivados().catch(() => []);
    return {
        ...construirRespuesta(registro, datosGuardar, historialPdfs, historialContratosWord),
        pdfFirmado
    };
}

async function eliminarPdfHistorial(pool, body, opciones = {}) {
    if (!opciones.puedeBorrarHistorial) {
        throw new Error('No autorizado para eliminar PDFs del historial.');
    }
    const driveFileId = String(body?.driveFileId || body?.drive_file_id || '').trim();
    if (!driveFileId) throw new Error('driveFileId requerido.');

    const registroPrevio = await obtenerRegistroDb(pool);
    let datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);

    const contratoActivoId = String(body?.contratoActivoId || body?.contrato_activo_id || '').trim();
    if (contratoActivoId) {
        datosPrevios = sanitizarDatos({ ...datosPrevios, contratoActivoId });
    }

    await driveService.eliminarArchivo(driveFileId).catch((err) => {
        console.warn('[AF-F-02] No se pudo borrar PDF en Drive:', err.message);
    });

    const hist = sanitizarPdfsHistorial(datosPrevios.pdfsHistorial)
        .filter((p) => p.driveFileId !== driveFileId);
    let pdfFirmado = datosPrevios.pdfFirmado;
    if (pdfFirmado?.driveFileId === driveFileId) {
        pdfFirmado = hist[0] || null;
    }

    const datosGuardar = sanitizarDatos(volcarCamposActivosALista({
        ...datosPrevios,
        pdfFirmado,
        pdfsHistorial: hist
    }));

    await guardarRegistroDb(pool, {
        pdfDriveFileId: datosGuardar.pdfFirmado?.driveFileId || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: registroPrevio?.fecha_elaboracion_original,
        fechaModificacionContenido: registroPrevio?.fecha_modificacion_contenido,
        contenidoModificado: !!registroPrevio?.contenido_modificado
    });

    const registro = await obtenerRegistroDb(pool);
    const historialPdfs = await listarPdfsHistorialDrive().catch(() => []);
    const historialContratosWord = await listarContratosWordArchivados().catch(() => []);
    return construirRespuesta(registro, datosGuardar, historialPdfs, historialContratosWord);
}

async function descargarPlantillaPdf(pool) {
    const respuesta = await cargarFormato(pool);
    const datos = respuesta.datos;

    const { plantillaSync, pdfBuffer, contratoArchivado } = await exportarPdfDesdeSync(datos);
    if (plantillaSync || contratoArchivado) {
        const registro = await obtenerRegistroDb(pool);
        const datosActuales = (await leerDatosRegistro(registro)) || datos;
        const datosActualizados = sanitizarDatos(volcarCamposActivosALista({
            ...datosActuales,
            ...(plantillaSync ? { plantillaSync } : {}),
            ...(contratoArchivado
                ? {
                    ultimoContratoWord: contratoArchivado,
                    wordDriveFileId: contratoArchivado.driveFileId,
                    wordNombre: contratoArchivado.nombreArchivo,
                    wordWebViewLink: contratoArchivado.webViewLink
                }
                : {})
        }));
        await guardarRegistroDb(pool, {
            pdfDriveFileId: datosActualizados.pdfFirmado?.driveFileId || null,
            datos: datosActualizados,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('No se pudo generar el PDF del contrato con los datos actuales.');
    }
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    NOMBRE_PDF_ARCHIVO,
    TEMPLATE_DRIVE_ID,
    TEMPLATE_ORIGINAL_DRIVE_ID,
    TEMPLATE_GOOGLE_DOC_ID,
    CARPETA_DRIVE_ID,
    CARPETA_WORD_ARCHIVADOS_ID,
    CARPETA_PDF_FIRMADOS_ID,
    cargarFormato,
    guardarFormato,
    subirPdfFirmado,
    eliminarPdfHistorial,
    descargarPlantillaPdf,
    sincronizarPlantillaGoogleDoc,
    arreglarTablaFirmas,
    sanitizarDatos,
    archivarContratoWord,
    listarContratosWordArchivados,
    formatearPieFechaParaDocumento
};
