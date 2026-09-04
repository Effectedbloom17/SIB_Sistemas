/**
 * Deja la plantilla base de SGC-F-10 lista para el sync automático:
 *  · un único bloque repetible (tabla de cláusula + tabla de hallazgo),
 *  · marcador {{num_hall}} en la columna "#",
 *  · {{concl_audi}} en la celda de conclusiones,
 *  · un solo {{audi_comp}} en la lista de auditores.
 *
 * Uso: node backend/scripts/preparar-plantilla-f10.js <idPlantillaBase>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), debug: false, quiet: true });

const { google } = require('googleapis');
const driveService = require('../driveService');

const PLANTILLA_ID = process.argv[2];

function textoCelda(cell) {
    const partes = [];
    for (const contenido of (cell?.content || [])) {
        for (const el of (contenido?.paragraph?.elements || [])) {
            if (el?.textRun?.content) partes.push(el.textRun.content);
        }
    }
    return partes.join('');
}

function rangoEditableCelda(cell) {
    const contenidos = cell?.content || [];
    if (!contenidos.length) return null;
    const inicio = Number(contenidos[0]?.startIndex);
    const fin = Number(contenidos[contenidos.length - 1]?.endIndex);
    if (!Number.isFinite(inicio)) return null;
    if (!Number.isFinite(fin) || fin - 1 <= inicio) return { startIndex: inicio, endIndex: inicio };
    return { startIndex: inicio, endIndex: fin - 1 };
}

function tablasNivelSuperior(docData) {
    return (docData?.body?.content || [])
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => el?.table?.tableRows)
        .map(({ el }) => el);
}

(async () => {
    if (!PLANTILLA_ID) throw new Error('Falta el id de la plantilla base.');
    await new Promise((r) => setTimeout(r, 1500));
    const auth = driveService.getAuthClient();
    if (!auth) throw new Error('Google Drive no está autenticado.');
    const docsApi = google.docs({ version: 'v1', auth });

    const doc = await docsApi.documents.get({ documentId: PLANTILLA_ID });
    const tablas = tablasNivelSuperior(doc.data);

    const tablasHallazgo = tablas.filter((t) =>
        (t.table.tableRows || []).some((row) =>
            (row.tableCells || []).some((c) => textoCelda(c).includes('{{desc_desc}}'))));
    const tablaConclusiones = tablas.find((t) =>
        textoCelda(t.table.tableRows?.[0]?.tableCells?.[0]).toUpperCase().includes('CONCLUSIONES'));

    if (!tablasHallazgo.length) throw new Error('No se encontró la tabla de hallazgos con {{desc_desc}}.');

    const grupos = [];

    // Conclusiones: la plantilla traía {{clau_desp}} por error.
    if (tablaConclusiones) {
        const celda = tablaConclusiones.table.tableRows?.[1]?.tableCells?.[0];
        const rango = celda && rangoEditableCelda(celda);
        if (rango) {
            const requests = [];
            if (rango.endIndex > rango.startIndex) {
                requests.push({ deleteContentRange: { range: rango } });
            }
            requests.push({ insertText: { location: { index: rango.startIndex }, text: '{{concl_audi}}' } });
            grupos.push({ start: rango.startIndex, requests });
        }
    }

    // Columna "#" del bloque plantilla → {{num_hall}}
    const tablaBase = tablasHallazgo[0];
    const celdaNum = tablaBase.table.tableRows?.[1]?.tableCells?.[0];
    const rangoNum = celdaNum && rangoEditableCelda(celdaNum);
    if (rangoNum && !textoCelda(celdaNum).includes('{{num_hall}}')) {
        const requests = [];
        if (rangoNum.endIndex > rangoNum.startIndex) {
            requests.push({ deleteContentRange: { range: rangoNum } });
        }
        requests.push({ insertText: { location: { index: rangoNum.startIndex }, text: '{{num_hall}}' } });
        grupos.push({ start: rangoNum.startIndex, requests });
    }

    // Bloques de hallazgo sobrantes: el sync los clona según haga falta.
    for (const tabla of tablasHallazgo.slice(1)) {
        grupos.push({
            start: Number(tabla.startIndex),
            requests: [{
                deleteContentRange: {
                    range: { startIndex: Number(tabla.startIndex), endIndex: Number(tabla.endIndex) }
                }
            }]
        });
    }

    grupos.sort((a, b) => b.start - a.start);
    const requests = grupos.flatMap((g) => g.requests);
    if (requests.length) {
        await docsApi.documents.batchUpdate({ documentId: PLANTILLA_ID, requestBody: { requests } });
        console.log(`[SGC-F-10] Plantilla base ajustada (${requests.length} operaciones).`);
    }

    await docsApi.documents.batchUpdate({
        documentId: PLANTILLA_ID,
        requestBody: {
            requests: [{
                replaceAllText: {
                    containsText: { text: '{{audi_comp}}, {{audi_comp}}', matchCase: true },
                    replaceText: '{{audi_comp}}'
                }
            }]
        }
    });

    console.log('[SGC-F-10] Plantilla base lista.');
})().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
