// =====================================================
// BIZNAGA R&T — Seguridad · Matriz de normativas aplicables
// Copia plantilla Word → Normaivas {año} de la empresa, rellena NOM|secciones, PDF
// =====================================================

const { google } = require('googleapis');
const driveService = require('./driveService');

const CARPETA_SISTEMA_DRIVE_ID = '1Jq-rhvJByXIhN0xclZVfmGmlbd8t073y';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const TIMEZONE_MEXICO = 'America/Mexico_City';

/** ID fijo (env) o resolución por nombre «Plantilla_normativas». */
const TEMPLATE_DRIVE_ID_ENV = String(process.env.SEG_MATRIZ_NORMATIVAS_TEMPLATE_DRIVE_ID || '').trim();
const TEMPLATE_NOMBRES_CANDIDATOS = [
    'Plantilla_normativas .DOCX',
    'Plantilla_normativas.DOCX',
    'Plantilla_normativas.docx',
    'Plantilla_normativas .docx',
    'Plantilla_normativas'
];
const NOMBRE_WORD = 'Matriz de normativas aplicables.docx';
const NOMBRE_PDF = 'Matriz de normativas aplicables.pdf';

let plantillaCache = { id: null, at: 0 };

function clienteGoogle() {
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Google Drive no está autenticado.');
    }
    return {
        drive: google.drive({ version: 'v3', auth }),
        docsApi: google.docs({ version: 'v1', auth })
    };
}

function nombreCarpetaDrive(valor, fallback = 'Sin nombre') {
    const limpio = String(valor || '')
        .replace(/[\\/:*?"<>|#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return limpio || fallback;
}

function fechaHoyDisplay() {
    try {
        return new Intl.DateTimeFormat('es-MX', {
            timeZone: TIMEZONE_MEXICO,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(new Date());
    } catch {
        const d = new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear());
        return `${dd}/${mm}/${yy}`;
    }
}

function crearReplaceRequest(buscar, reemplazo) {
    const text = String(buscar || '');
    if (!text) return null;
    return {
        replaceAllText: {
            containsText: { text, matchCase: true },
            replaceText: String(reemplazo ?? '')
        }
    };
}

function extraerTablas(content) {
    const tablas = [];
    for (const el of content || []) {
        if (el?.table) {
            tablas.push({ startIndex: el.startIndex, table: el.table });
        }
    }
    return tablas;
}

function rangoEditableCelda(cell) {
    const content = Array.isArray(cell?.content) ? cell.content : [];
    if (!content.length) return null;
    const start = Number(content[0].startIndex);
    const endRaw = Number(content[content.length - 1].endIndex);
    if (!Number.isFinite(start) || !Number.isFinite(endRaw)) return null;
    return { start, end: endRaw - 1 };
}

async function resolverPlantillaDriveId() {
    if (TEMPLATE_DRIVE_ID_ENV) {
        return TEMPLATE_DRIVE_ID_ENV;
    }
    const ahora = Date.now();
    if (plantillaCache.id && ahora - plantillaCache.at < 10 * 60 * 1000) {
        return plantillaCache.id;
    }
    for (const nombre of TEMPLATE_NOMBRES_CANDIDATOS) {
        try {
            const hit = await driveService.buscarArchivoGlobal(nombre);
            if (hit?.id) {
                plantillaCache = { id: hit.id, at: ahora };
                console.log(`[SEG-MATRIZ] Plantilla resuelta por nombre "${hit.name}" → ${hit.id}`);
                return hit.id;
            }
        } catch (err) {
            console.warn(`[SEG-MATRIZ] Búsqueda "${nombre}":`, err.message);
        }
    }
    // Búsqueda laxa por prefijo en toda la unidad (name contains).
    try {
        const auth = driveService.getAuthClient();
        if (auth) {
            const drive = google.drive({ version: 'v3', auth });
            const resp = await drive.files.list({
                q: "name contains 'Plantilla_normativas' and trashed=false",
                fields: 'files(id, name, mimeType)',
                pageSize: 5,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                corpora: 'allDrives'
            });
            const hit = (resp.data.files || [])[0];
            if (hit?.id) {
                plantillaCache = { id: hit.id, at: ahora };
                console.log(`[SEG-MATRIZ] Plantilla por contains "${hit.name}" → ${hit.id}`);
                return hit.id;
            }
        }
    } catch (err) {
        console.warn('[SEG-MATRIZ] Búsqueda contains falló:', err.message);
    }
    throw new Error(
        'No se encontró la plantilla «Plantilla_normativas». '
        + 'Define SEG_MATRIZ_NORMATIVAS_TEMPLATE_DRIVE_ID o comparte el Doc con la cuenta Drive del backend.'
    );
}

async function asegurarCarpetaNormativasAnio(empresaNombre, anio) {
    const carpetaEmpresa = await driveService.obtenerOCrearCarpeta(
        nombreCarpetaDrive(empresaNombre, 'Empresa'),
        CARPETA_SISTEMA_DRIVE_ID
    );
    return driveService.obtenerOCrearCarpeta(`Normativas ${anio}`, carpetaEmpresa);
}

async function asegurarFilasTabla(docsApi, docId, filasDatos) {
    const objetivo = Math.max(1, Number(filasDatos) || 0);
    for (let guard = 0; guard < objetivo + 5; guard += 1) {
        const doc = await docsApi.documents.get({ documentId: docId });
        const tablas = extraerTablas(doc.data.body?.content);
        const tabla = tablas[0];
        if (!tabla) {
            throw new Error('La plantilla de matriz no tiene tabla NOM | Secciones.');
        }
        const filas = tabla.table.tableRows?.length || 0;
        const datosActuales = Math.max(0, filas - 1); // fila 0 = encabezado
        if (datosActuales >= objetivo) {
            return;
        }
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [{
                    insertTableRow: {
                        tableCellLocation: {
                            tableStartLocation: { index: tabla.startIndex },
                            rowIndex: Math.max(0, filas - 1),
                            columnIndex: 0
                        },
                        insertBelow: true
                    }
                }]
            }
        });
    }
}

async function rellenarTablaMatriz(docsApi, docId, filas) {
    if (!filas.length) return;
    await asegurarFilasTabla(docsApi, docId, filas.length);

    const doc = await docsApi.documents.get({ documentId: docId });
    const tablas = extraerTablas(doc.data.body?.content);
    const tablaInfo = tablas[0];
    const tabla = tablaInfo?.table;
    if (!tabla || !Number.isFinite(tablaInfo.startIndex)) {
        throw new Error('La plantilla de matriz no tiene tabla NOM | Secciones.');
    }

    const escrituras = [];
    for (let i = 0; i < filas.length; i += 1) {
        const rowIdx = i + 1; // 0 = encabezado
        const row = tabla.tableRows?.[rowIdx];
        if (!row) continue;
        const nom = String(filas[i].codigo || '').trim();
        const secciones = Array.isArray(filas[i].secciones)
            ? filas[i].secciones.map((s) => String(s || '').trim()).filter(Boolean).join(', ')
            : String(filas[i].secciones || '').trim();

        const cellNom = row.tableCells?.[0];
        const cellSec = row.tableCells?.[1];
        const rangoNom = rangoEditableCelda(cellNom);
        const rangoSec = rangoEditableCelda(cellSec);
        if (rangoNom) escrituras.push({ ...rangoNom, texto: nom });
        if (rangoSec) escrituras.push({ ...rangoSec, texto: secciones });
    }

    escrituras.sort((a, b) => b.start - a.start);
    const requests = [];
    for (const celda of escrituras) {
        if (celda.end > celda.start) {
            requests.push({
                deleteContentRange: {
                    range: { startIndex: celda.start, endIndex: celda.end }
                }
            });
        }
        if (celda.texto) {
            requests.push({
                insertText: {
                    location: { index: celda.start },
                    text: celda.texto
                }
            });
        }
    }
    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }

    await aplicarEstiloCeldasDatos(docsApi, docId, filas.length);
}

/**
 * Datos de la matriz (sin encabezado): sin negrita + alineación vertical Medio.
 * Columna derecha (secciones): espacio antes/después del párrafo para no tocar bordes.
 */
async function aplicarEstiloCeldasDatos(docsApi, docId, filasDatos) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const tablas = extraerTablas(doc.data.body?.content);
    const tablaInfo = tablas[0];
    const tabla = tablaInfo?.table;
    if (!tabla || !Number.isFinite(tablaInfo.startIndex)) return;

    const totalFilas = Math.min(
        Number(filasDatos) || 0,
        Math.max(0, (tabla.tableRows || []).length - 1)
    );
    const requests = [];

    for (let i = 0; i < totalFilas; i += 1) {
        const rowIdx = i + 1;
        const row = tabla.tableRows?.[rowIdx];
        if (!row) continue;

        for (let col = 0; col < 2; col += 1) {
            const esSecciones = col === 1;
            requests.push({
                updateTableCellStyle: {
                    tableRange: {
                        tableCellLocation: {
                            tableStartLocation: { index: tablaInfo.startIndex },
                            rowIndex: rowIdx,
                            columnIndex: col
                        },
                        rowSpan: 1,
                        columnSpan: 1
                    },
                    tableCellStyle: {
                        contentAlignment: 'MIDDLE',
                        ...(esSecciones
                            ? {
                                paddingTop: { magnitude: 6, unit: 'PT' },
                                paddingBottom: { magnitude: 6, unit: 'PT' },
                                paddingLeft: { magnitude: 6, unit: 'PT' },
                                paddingRight: { magnitude: 6, unit: 'PT' }
                            }
                            : {})
                    },
                    fields: esSecciones
                        ? 'contentAlignment,paddingTop,paddingBottom,paddingLeft,paddingRight'
                        : 'contentAlignment'
                }
            });

            const cell = row.tableCells?.[col];
            for (const el of cell?.content || []) {
                if (!el.paragraph) continue;
                const start = Number(el.startIndex);
                const end = Number(el.endIndex);
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
                // Quitar negrita del texto de datos (NOM y secciones).
                requests.push({
                    updateTextStyle: {
                        range: { startIndex: start, endIndex: end },
                        textStyle: { bold: false },
                        fields: 'bold'
                    }
                });
                if (esSecciones) {
                    requests.push({
                        updateParagraphStyle: {
                            range: { startIndex: start, endIndex: end },
                            paragraphStyle: {
                                spaceAbove: { magnitude: 6, unit: 'PT' },
                                spaceBelow: { magnitude: 6, unit: 'PT' }
                            },
                            fields: 'spaceAbove,spaceBelow'
                        }
                    });
                }
            }
        }
    }

    if (requests.length) {
        await docsApi.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });
    }
}

async function reemplazarOSubir(carpetaId, nombre, buffer, mimeType) {
    const existente = await driveService.buscarArchivo(nombre, carpetaId);
    if (existente?.id) {
        await driveService.reemplazarArchivoEnDrive(existente.id, buffer, mimeType, nombre);
        return {
            id: existente.id,
            name: nombre,
            webViewLink: `https://drive.google.com/file/d/${existente.id}/view`
        };
    }
    return driveService.subirArchivoNuevo(buffer, nombre, mimeType, carpetaId);
}

/**
 * Genera la matriz Word+PDF en Sistema/{Empresa}/Normativas {año}/
 * y devuelve el PDF en base64 para descarga automática (patrón PIPC).
 *
 * @param {{
 *   empresaNombre: string,
 *   anio: number,
 *   filas: Array<{ codigo: string, secciones: string[] }>
 * }} opts
 */
async function generarMatrizNormativas(opts) {
    const empresaNombre = String(opts?.empresaNombre || '').trim();
    const anio = Number(opts?.anio) || new Date().getFullYear();
    const filas = Array.isArray(opts?.filas) ? opts.filas.filter((f) => f?.codigo) : [];
    if (!empresaNombre) {
        throw new Error('Empresa requerida para la matriz de normativas.');
    }
    if (!filas.length) {
        throw new Error('No hay normativas para armar la matriz.');
    }
    if (!driveService.driveDisponible || !driveService.driveDisponible()) {
        throw new Error('Google Drive no está autenticado.');
    }

    const templateId = await resolverPlantillaDriveId();
    const carpetaAnio = await asegurarCarpetaNormativasAnio(empresaNombre, anio);
    const { drive, docsApi } = clienteGoogle();

    const copyResp = await drive.files.copy({
        fileId: templateId,
        requestBody: {
            name: `_temp_matriz_normativas_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        fields: 'id'
    });
    const docId = copyResp?.data?.id;
    if (!docId) {
        throw new Error('No se pudo copiar la plantilla de matriz de normativas.');
    }

    try {
        const fecha = fechaHoyDisplay();
        const placeholders = [
            crearReplaceRequest('{{fecha}}', fecha),
            crearReplaceRequest('{{FECHA}}', fecha),
            crearReplaceRequest('{{nom_empresa}}', empresaNombre),
            crearReplaceRequest('{{NOM_EMPRESA}}', empresaNombre),
            crearReplaceRequest('{{nombre_empresa}}', empresaNombre)
        ].filter(Boolean);

        if (placeholders.length) {
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests: placeholders }
            });
        }

        await rellenarTablaMatriz(docsApi, docId, filas);

        const docxResp = await drive.files.export(
            { fileId: docId, mimeType: DOCX_MIME },
            { responseType: 'arraybuffer' }
        );
        const docxBuffer = Buffer.from(docxResp.data);
        const word = await reemplazarOSubir(carpetaAnio, NOMBRE_WORD, docxBuffer, DOCX_MIME);

        const pdfResp = await drive.files.export(
            { fileId: docId, mimeType: PDF_MIME },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdfResp.data);
        const pdf = await reemplazarOSubir(carpetaAnio, NOMBRE_PDF, pdfBuffer, PDF_MIME);

        const safeEmpresa = nombreCarpetaDrive(empresaNombre, 'Empresa').replace(/\s+/g, '_');
        return {
            word_drive_file_id: word?.id || null,
            word_web_view_link: word?.webViewLink || null,
            pdf_drive_file_id: pdf?.id || null,
            pdf_web_view_link: pdf?.webViewLink || null,
            carpeta_drive_id: carpetaAnio,
            pdfs: [{
                filename: `Matriz_normativas_${safeEmpresa}_${anio}.pdf`,
                mime_type: PDF_MIME,
                base64: pdfBuffer.toString('base64')
            }]
        };
    } finally {
        try {
            await drive.files.delete({ fileId: docId });
        } catch (err) {
            console.warn('[SEG-MATRIZ] No se pudo borrar Doc temporal:', err.message);
        }
    }
}

/**
 * Arma filas {codigo, secciones[]} desde pool tras publicar.
 */
async function armarFilasDesdeAsignacion(pool, empresaId, normativaIds) {
    const ids = (Array.isArray(normativaIds) ? normativaIds : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return [];

    const [rows] = await pool.query(
        `SELECT n.id AS normativa_id, n.codigo, r.punto_norma
         FROM seg_asignacion a
         JOIN seg_normativa n ON n.id = a.normativa_id
         JOIN seg_asignacion_punto p ON p.asignacion_id = a.id
         JOIN seg_normativa_requisito r ON r.id = p.requisito_id
         WHERE a.empresa_id = ?
           AND a.estado = 'activa'
           AND a.normativa_id IN (?)
         ORDER BY n.codigo ASC, r.punto_norma ASC`,
        [empresaId, ids]
    );

    const mapa = new Map();
    for (const row of rows || []) {
        const codigo = String(row.codigo || '').trim();
        if (!codigo) continue;
        if (!mapa.has(codigo)) {
            mapa.set(codigo, { codigo, secciones: [] });
        }
        const punto = String(row.punto_norma || '').trim();
        if (punto) {
            mapa.get(codigo).secciones.push(punto);
        }
    }
    return Array.from(mapa.values());
}

module.exports = {
    generarMatrizNormativas,
    armarFilasDesdeAsignacion,
    NOMBRE_WORD,
    NOMBRE_PDF,
    CARPETA_SISTEMA_DRIVE_ID
};
