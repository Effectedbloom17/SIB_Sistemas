/**
 * Parser de plantillas PIPC (Excel / hojas del archivo maestro SP-F-01).
 */

const DOCUMENTOS_CANONICOS_PIPC = [
    {
        clave: 'ultima opinion tecnica de proteccion civil del municipio',
        documento: 'Ultima opinión técnica de proteccion civil del municipio',
        tipo_entrada: 'archivo',
        obligatorio: true
    }
];

function normalizarClaveTexto(valor = '') {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizarNombreDocumentoPipc(nombreRaw = '') {
    let nombre = String(nombreRaw || '').trim();
    nombre = nombre.replace(/^tiene el archivo de\s+/i, '');
    nombre = nombre.replace(/^cuenta con el archivo de\s+/i, '');
    return nombre.trim();
}

function normalizarClaveDocumentoPipc(nombreRaw = '') {
    return normalizarClaveTexto(normalizarNombreDocumentoPipc(nombreRaw));
}

function normalizarNombreHojaPipc(valor = '') {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\.xlsx?$/i, '')
        .replace(/^pipc\s+/i, '')
        .replace(/[^a-z0-9\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function resolverWorksheetEnWorkbook(workbook, hojaNombre = '') {
    if (!workbook?.worksheets?.length) {
        return null;
    }

    const objetivo = normalizarNombreHojaPipc(hojaNombre);
    if (objetivo) {
        const hoja = workbook.worksheets.find(
            (ws) => normalizarNombreHojaPipc(ws.name) === objetivo
        );
        if (hoja) {
            return hoja;
        }
    }

    // Archivos individuales (Google Sheet): la pestaña suele ser "Hoja1", no el título del catálogo.
    return workbook.worksheets[0] || null;
}

function obtenerTextoCelda(valor) {
    if (!valor) return '';
    if (typeof valor === 'object' && valor.richText) {
        return valor.richText.map((rt) => rt.text || '').join('').trim();
    }
    if (typeof valor === 'object' && valor.text) {
        return String(valor.text).trim();
    }
    if (typeof valor === 'object' && valor.result !== undefined && valor.result !== null) {
        return String(valor.result).trim();
    }
    return String(valor).trim();
}

function esSubtituloEntrega(valor = '') {
    const n = normalizarClaveTexto(valor);
    return n === 'fisico' || n === 'usb' || n === 'presentar';
}

function obtenerMetaEntrada(nombreRaw = '') {
    const limpio = String(nombreRaw || '').trim();
    if (!limpio) return { nombre: '', tipoEntrada: 'archivo' };
    const esTexto = limpio.startsWith('*') || limpio.endsWith('*');
    if (esTexto) {
        return {
            nombre: limpio.replace(/^\*+/, '').replace(/\*+$/, '').trim(),
            tipoEntrada: 'texto'
        };
    }
    return { nombre: normalizarNombreDocumentoPipc(limpio), tipoEntrada: 'archivo' };
}

function detectarColumnasPipcWorksheet(worksheet) {
    let colItem = -1;
    let colDatos = -1;
    let colDesc = -1;
    let colObligatorio = -1;
    let headerRow = -1;

    const maxScanRows = Math.min(worksheet.rowCount || 0, 25);

    for (let r = 1; r <= maxScanRows && colDatos === -1; r++) {
        const row = worksheet.getRow(r);
        for (let c = 1; c <= Math.min(worksheet.columnCount || 0, 15); c++) {
            const cellVal = obtenerTextoCelda(row.getCell(c).value).toLowerCase();
            if (!cellVal) continue;
            if (
                (cellVal.includes('datos') && cellVal.includes('documento')) ||
                (cellVal.includes('datos') && cellVal.includes('trámite')) ||
                (cellVal.includes('datos') && cellVal.includes('tramite')) ||
                cellVal.includes('documentos que se necesitan') ||
                cellVal.includes('documentos necesarios')
            ) {
                colDatos = c;
                headerRow = r;
                break;
            }
        }
    }

    if (headerRow > 0) {
        const hRow = worksheet.getRow(headerRow);
        for (let c = 1; c <= Math.min(worksheet.columnCount || 0, 15); c++) {
            const cellVal = obtenerTextoCelda(hRow.getCell(c).value).toLowerCase();
            if (!cellVal) continue;
            if (colItem === -1 && (cellVal === 'item' || cellVal === 'ítem' || cellVal === 'no.' || cellVal === 'no' || cellVal === '#')) {
                colItem = c;
            }
            if (c === colDatos) continue;
            if (colDesc === -1 && (cellVal.includes('observaci') || cellVal.includes('especificaci') || cellVal.includes('nota'))) {
                colDesc = c;
            }
            if (colObligatorio === -1 && (cellVal.includes('obligatori') || cellVal.includes('requerido') || cellVal.includes('cumple'))) {
                colObligatorio = c;
            }
        }
    }

    if (colDatos === -1) {
        for (let r = 1; r <= maxScanRows && colDatos === -1; r++) {
            const row = worksheet.getRow(r);
            for (let c = 1; c <= Math.min(worksheet.columnCount || 0, 15); c++) {
                const cellVal = obtenerTextoCelda(row.getCell(c).value).toLowerCase();
                if (!cellVal) continue;
                if (cellVal.includes('entregado')) continue;
                if (
                    cellVal.includes('requisito') ||
                    cellVal.includes('concepto') ||
                    (cellVal.includes('documento') && !cellVal.includes('código') && !cellVal.includes('codigo')) ||
                    cellVal === 'nombre' ||
                    cellVal === 'descripción' ||
                    cellVal === 'descripcion'
                ) {
                    colDatos = c;
                    headerRow = r;
                    break;
                }
            }
        }
    }

    if (colDatos === -1) {
        colDatos = 2;
        colItem = 1;
        headerRow = 5;
    }

    if (colItem === -1 && colDatos > 1) {
        const posibleItem = obtenerTextoCelda(worksheet.getRow(headerRow).getCell(colDatos - 1).value).toLowerCase();
        if (posibleItem === 'item' || posibleItem === 'ítem' || posibleItem === 'no.' || posibleItem === 'no' || posibleItem === '#') {
            colItem = colDatos - 1;
        }
    }

    if (headerRow > 0 && colDesc === -1 && colObligatorio === -1) {
        const hRow = worksheet.getRow(headerRow);
        for (let c = 1; c <= Math.min(worksheet.columnCount || 0, 15); c++) {
            if (c === colDatos || c === colItem) continue;
            const cellVal = obtenerTextoCelda(hRow.getCell(c).value).toLowerCase();
            if (!cellVal) continue;
            if (colDesc === -1 && (cellVal.includes('observaci') || cellVal.includes('especificaci') || cellVal.includes('nota'))) {
                colDesc = c;
            }
            if (colObligatorio === -1 && (cellVal.includes('obligatori') || cellVal.includes('requerido') || cellVal.includes('cumple'))) {
                colObligatorio = c;
            }
        }
    }

    return { colItem, colDatos, colDesc, colObligatorio, headerRow };
}

function leerNombreDocumentoFila(row, columnas) {
    const { colItem, colDatos } = columnas;
    let nombreRaw = obtenerTextoCelda(row.getCell(colDatos).value);

    if ((!nombreRaw || /^\d+\.?$/.test(nombreRaw)) && colDatos + 1 <= (row.worksheet?.columnCount || 15)) {
        const alterno = obtenerTextoCelda(row.getCell(colDatos + 1).value);
        if (alterno && !/^\d+\.?$/.test(alterno)) {
            nombreRaw = alterno;
        }
    }

    if ((!nombreRaw || /^\d+\.?$/.test(nombreRaw)) && colItem > 0) {
        const desdeDatos = obtenerTextoCelda(row.getCell(colDatos).value);
        if (desdeDatos && !/^\d+\.?$/.test(desdeDatos)) {
            nombreRaw = desdeDatos;
        }
    }

    return nombreRaw;
}

function suplementarItemsPipc(hojaNombre = '', items = []) {
    const claves = new Set(items.map((item) => normalizarClaveDocumentoPipc(item.documento || item.nombre)));
    const hojaNorm = normalizarClaveTexto(hojaNombre);

    for (const canon of DOCUMENTOS_CANONICOS_PIPC) {
        if (claves.has(canon.clave)) continue;
        if (!hojaNorm.includes('pachuca')) continue;

        items.push({
            id: String(items.length + 1),
            categoria: 'Documentos a solicitar',
            documento: canon.documento,
            especificacion: '',
            obligatorio: canon.obligatorio !== false,
            tipo_entrada: canon.tipo_entrada || 'archivo'
        });
        claves.add(canon.clave);
    }

    return items;
}

function parsearFilasPipcDesdeWorksheet(worksheet, opciones = {}) {
    const columnas = detectarColumnasPipcWorksheet(worksheet);
    const { colDatos, colDesc, colObligatorio, headerRow } = columnas;
    const startRow = Math.max(headerRow + 1, 1);
    const filas = [];
    const clavesVistas = new Set();
    let categoriaActual = 'Documentos a solicitar';

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < startRow) return;

        const nombreRaw = leerNombreDocumentoFila(row, columnas);
        const { nombre: nombreLimpioFila, tipoEntrada } = obtenerMetaEntrada(nombreRaw);

        if (!nombreLimpioFila) return;
        if (/^\d+\.?$/.test(nombreLimpioFila)) return;
        if (esSubtituloEntrega(nombreLimpioFila)) return;

        if (headerRow > 0) {
            const headerVal = obtenerTextoCelda(worksheet.getRow(headerRow).getCell(colDatos).value).toLowerCase();
            if (nombreLimpioFila.toLowerCase() === headerVal) return;
        }

        const clave = normalizarClaveDocumentoPipc(nombreLimpioFila);
        if (!clave || clavesVistas.has(clave)) return;

        const especificacion = colDesc > 0 ? obtenerTextoCelda(row.getCell(colDesc).value) : '';
        let obligatorio = true;
        if (colObligatorio > 0) {
            const obligatorioRaw = obtenerTextoCelda(row.getCell(colObligatorio).value).toLowerCase();
            obligatorio = !['no', 'n', 'false', '0', 'opcional'].includes(obligatorioRaw);
        }

        const cellDatos = row.getCell(colDatos);
        const esBold = !!(cellDatos.font && cellDatos.font.bold);
        const pareceCategoria = esBold && !especificacion && colObligatorio <= 0 && tipoEntrada === 'archivo';

        if (pareceCategoria && nombreLimpioFila.length < 80) {
            categoriaActual = nombreLimpioFila;
            return;
        }

        clavesVistas.add(clave);
        filas.push({
            nombre: nombreLimpioFila,
            categoria: categoriaActual,
            especificacion,
            obligatorio,
            tipo_entrada: tipoEntrada
        });
    });

    let items = filas.map((fila, index) => ({
        id: String(index + 1),
        categoria: fila.categoria,
        documento: fila.nombre,
        especificacion: fila.especificacion,
        obligatorio: fila.obligatorio,
        tipo_entrada: fila.tipo_entrada
    }));

    if (opciones.hojaNombre) {
        items = suplementarItemsPipc(opciones.hojaNombre, items);
    }

    return { filas, items, columnas, total: items.length };
}

function parsearPlantillaPipcDesdeWorksheet(worksheet, opciones = {}) {
    const parseado = parsearFilasPipcDesdeWorksheet(worksheet, opciones);
    const gruposMap = new Map();

    for (const item of parseado.items) {
        if (!gruposMap.has(item.categoria)) {
            gruposMap.set(item.categoria, []);
        }
        gruposMap.get(item.categoria).push(item);
    }

    const grupos = Array.from(gruposMap.entries()).map(([categoria, grupoItems]) => ({
        categoria,
        items: grupoItems
    }));

    return {
        items: parseado.items,
        filas: parseado.filas,
        grupos,
        total: parseado.total
    };
}

module.exports = {
    normalizarNombreDocumentoPipc,
    normalizarClaveDocumentoPipc,
    normalizarClaveTexto,
    normalizarNombreHojaPipc,
    resolverWorksheetEnWorkbook,
    parsearFilasPipcDesdeWorksheet,
    parsearPlantillaPipcDesdeWorksheet,
    suplementarItemsPipc
};
