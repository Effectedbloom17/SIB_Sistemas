/**
 * SGC-F-29 · Evaluación de Proveedores — persistencia en biznaga_sgc y sync con Drive.
 *
 * Tabla: No | Proveedor (B:C) | Entrega a tiempo | Entrega a Domicilio | Precio |
 *        Pago Transferencia | Calidad del Servicio | Calidad del producto | Calificación.
 * Mínimo aprobatorio: 80%. Reutiliza persistencia/historial de formatos SGC.
 */
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');
const sgcF29EvidenciaService = require('./sgcF29EvidenciaService');

const CODIGO_FORMATO = 'SGC-F-29';
const TEMPLATE_DRIVE_ID = '1_MsV1j-HuRUr8mdJogU0NmZL0j0zb35Ty5EtQ0cbCfQ';
const DRIVE_FILE_ID_SISTEMA = '1_MsV1j-HuRUr8mdJogU0NmZL0j0zb35Ty5EtQ0cbCfQ';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-29 Evaluación de Proveedores (sistema)';
const SHEET_TITLE = 'Evaluación Proveedor';

const META_ROW = 5;
const HEADER_ROW = 7;
const DATA_START_ROW = 8;
// La plantilla tiene 12 renglones (8–19); la NOTA vive en la fila 20.
const MAX_FILAS = 12;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;

// Layout oficial (sin Certificado ISO 9000): A No | B:C Proveedor | D Entrega a tiempo |
// E Entrega a Domicilio | F Precio | G Pago Transferencia | H Calidad del Servicio |
// I Calidad del producto | J Calificación.
// Meta fila 5: Periodo valor en C5 (C:E); etiqueta fecha en F5 (F:H); valor fecha en I5 (I:J).
const COLUMNAS = {
    no: 1,                 // A
    proveedor: 2,          // B (fusionada con C)
    proveedorSpan: 3,      // C — espacio del nombre del proveedor
    entregaTiempo: 4,      // D
    entregaDomicilio: 5,   // E
    precio: 6,             // F
    pagoTransferencia: 7,  // G
    servicio: 8,           // H
    calidad: 9,            // I
    calificacion: 10       // J
};

/** Layout previo con columna Certificado ISO 9000 en I. */
const COLUMNAS_CON_ISO = {
    no: 1,
    proveedor: 2,
    proveedorSpan: 3,
    entregaTiempo: 4,
    entregaDomicilio: 5,
    precio: 6,
    pagoTransferencia: 7,
    servicio: 8,
    certificadoIso: 9,
    calidad: 10,
    calificacion: 11
};

/** Layout compacto erróneo (sin fusión B:C; criterios corridos a partir de C). */
const COLUMNAS_COMPACTAS = {
    no: 1,
    proveedor: 2,
    entregaTiempo: 3,
    entregaDomicilio: 4,
    precio: 5,
    pagoTransferencia: 6,
    servicio: 7,
    certificadoIso: 8,
    calidad: 9,
    calificacion: 10
};

/** Layout previo con Familia en C. */
const COLUMNAS_LEGACY = {
    no: 1,
    proveedor: 2,
    familia: 3,
    entregaTiempo: 4,
    entregaDomicilio: 5,
    precio: 6,
    pagoTransferencia: 7,
    servicio: 8,
    certificadoIso: 9,
    calidad: 10,
    calificacion: 11
};

// K y L residuales tras quitar ISO / acortar la tabla a A:J.
const COLUMNAS_EXTRA_LIMPIAR = [11, 12];

const HEADERS_TABLA = [
    [COLUMNAS.no, 'No.'],
    [COLUMNAS.proveedor, 'Proveedor'],
    [COLUMNAS.entregaTiempo, 'Entrega a tiempo'],
    [COLUMNAS.entregaDomicilio, 'Entrega a Domicilio'],
    [COLUMNAS.precio, 'Precio'],
    [COLUMNAS.pagoTransferencia, 'Pago Transferencia'],
    [COLUMNAS.servicio, 'Calidad del Servicio'],
    [COLUMNAS.calidad, 'Calidad del producto'],
    [COLUMNAS.calificacion, 'Calificación']
];

const META_COLS = {
    // Etiqueta en A5:B5; valor del periodo en C5 (fusión C:E).
    periodo: 3,
    // Etiqueta "Fecha de la evaluación:" en F5 (fusión F:H); valor en I5 (fusión I:J).
    fechaLabel: 6,
    fechaEvaluacion: 9
};

/** Celdas meta antiguas / alternativas a leer como respaldo. */
const META_COLS_ALT = {
    periodoLegacy: 2,      // B5
    fechaLegacyG: 7,       // G5 — escritura errónea previa
    fechaLegacyJ: 10,      // J5 — escritura errónea previa
    fechaLegacyH: 8        // H5
};

const PROVEEDOR_DEFECTO = {
    id: '',
    proveedor: '',
    referencia: '',
    fecha: '',
    entregaTiempo: '',
    entregaDomicilio: '',
    precio: '',
    pagoTransferencia: '',
    servicio: '',
    calidad: '',
    calificacion: ''
};

function generarIdEvaluacion() {
    if (typeof sgcF29EvidenciaService.generarEvaluacionId === 'function') {
        return sgcF29EvidenciaService.generarEvaluacionId();
    }
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

const DATOS_DEFECTO = {
    fechaElaboracion: '2025-01-23',
    fechaRevision: '2025-01-23',
    revision: '00',
    periodoEvaluacion: '',
    fechaEvaluacion: '',
    proveedores: []
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function celdaATexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return formatearFechaIso(valor);
    if (typeof valor === 'object') {
        if (valor.result !== undefined && valor.result !== null) return celdaATexto(valor.result);
        if (Array.isArray(valor.richText)) {
            return normalizarSaltosLinea(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltosLinea(String(valor.text));
    }
    return normalizarSaltosLinea(String(valor));
}

function asignarTextoSimple(celda, valor, horizontal = 'left') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso();
}

/** Fecha visible en la plantilla (dd/mm/aaaa) — día del registro en hora México. */
function fechaParaSheet(fecha) {
    const iso = formatearFechaIso(fecha) || fechaHoyIso();
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return iso || '';
    }
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function fechaEvaluacionRegistro(datos) {
    // Siempre el día del registro (México); evita desfases UTC y celdas corruptas.
    return fechaHoyIso();
}

function parsearPuntaje(valor) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo) return '';
    let n = Number(crudo);
    if (!Number.isFinite(n)) return '';
    if (n > 0 && n <= 1) n = n * 100;
    n = Math.round(n);
    // Escala oficial del formato: 0 / 25 / 50 / 75 / 100.
    const permitidos = [0, 25, 50, 75, 100];
    if (permitidos.includes(n)) return String(n);
    // Redondea al escalón más cercano.
    let mejor = 0;
    let dist = Math.abs(n - 0);
    for (const p of permitidos) {
        const d = Math.abs(n - p);
        if (d < dist) {
            dist = d;
            mejor = p;
        }
    }
    return String(mejor);
}

function calcularCalificacion(item) {
    const vals = [
        'entregaTiempo',
        'entregaDomicilio',
        'precio',
        'pagoTransferencia',
        'servicio',
        'calidad'
    ]
        .map((k) => parsearPuntaje(item?.[k]))
        .filter((v) => v !== '')
        .map(Number);
    if (!vals.length) return '';
    return String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
}

function sanitizarProveedor(item) {
    const idExistente = String(item?.id || '').trim().slice(0, 64);
    const base = {
        id: idExistente,
        proveedor: String(item?.proveedor || '').trim(),
        referencia: String(item?.referencia || '').trim().slice(0, 120),
        fecha: formatearFechaIso(item?.fecha) || '',
        entregaTiempo: parsearPuntaje(item?.entregaTiempo),
        entregaDomicilio: parsearPuntaje(item?.entregaDomicilio),
        precio: parsearPuntaje(item?.precio),
        pagoTransferencia: parsearPuntaje(item?.pagoTransferencia),
        servicio: parsearPuntaje(item?.servicio),
        calidad: parsearPuntaje(item?.calidad),
        calificacion: parsearPuntaje(item?.calificacion)
    };
    const auto = calcularCalificacion(base);
    if (auto) base.calificacion = auto;
    return base;
}

/** Conserva ids/referencias al sincronizar desde Excel (sin esos campos). */
function fusionarIdsProveedores(anteriores, nuevos) {
    const prev = Array.isArray(anteriores) ? anteriores : [];
    const next = Array.isArray(nuevos) ? nuevos : [];
    const usados = new Set(
        next.map((f) => String(f?.id || '').trim()).filter(Boolean)
    );
    return next.map((fila, idx) => {
        if (fila.id) {
            return fila;
        }
        const mismoIdx = prev[idx];
        if (
            mismoIdx?.id
            && !usados.has(mismoIdx.id)
            && String(mismoIdx.proveedor || '').trim().toLowerCase()
                === String(fila.proveedor || '').trim().toLowerCase()
        ) {
            usados.add(mismoIdx.id);
            return {
                ...fila,
                id: mismoIdx.id,
                referencia: fila.referencia || mismoIdx.referencia || '',
                fecha: fila.fecha || mismoIdx.fecha || ''
            };
        }
        const matchNombre = prev.find((p) =>
            p?.id
            && !usados.has(p.id)
            && String(p.proveedor || '').trim().toLowerCase()
                === String(fila.proveedor || '').trim().toLowerCase()
        );
        if (matchNombre) {
            usados.add(matchNombre.id);
            return {
                ...fila,
                id: matchNombre.id,
                referencia: fila.referencia || matchNombre.referencia || '',
                fecha: fila.fecha || matchNombre.fecha || ''
            };
        }
        return fila;
    });
}

function asegurarIdsProveedores(lista) {
    return (Array.isArray(lista) ? lista : []).map((fila) => (
        fila?.id ? fila : { ...fila, id: generarIdEvaluacion() }
    ));
}

function esProveedorVacio(item) {
    const p = sanitizarProveedor(item);
    return !p.proveedor && !p.entregaTiempo && !p.entregaDomicilio
        && !p.precio && !p.pagoTransferencia && !p.servicio
        && !p.calidad && !p.calificacion;
}

function pareceNotaPlantilla(texto) {
    const t = String(texto || '').trim().toLowerCase();
    return t.startsWith('nota') || t.includes('mínimo aprobatorio') || t.includes('minimo aprobatorio');
}

function limpiarMetaPeriodo(valor) {
    const t = String(valor || '').trim();
    if (!t) return '';
    if (/^periodo\s+de\s+evaluaci[oó]n\s*:?\s*$/i.test(t)) return '';
    return t.replace(/^periodo\s+de\s+evaluaci[oó]n\s*:\s*/i, '').trim();
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const proveedores = Array.isArray(base.proveedores) ? base.proveedores : [];
    const fechaElaboracion = formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion;
    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaElaboracion,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        periodoEvaluacion: limpiarMetaPeriodo(base.periodoEvaluacion),
        fechaEvaluacion: formatearFechaIso(base.fechaEvaluacion) || '',
        proveedores: asegurarIdsProveedores(
            proveedores
                .map(sanitizarProveedor)
                .filter((p) => !esProveedorVacio(p) && !pareceNotaPlantilla(p.proveedor))
                .slice(0, MAX_FILAS)
        )
    };
}

function layoutHojaTieneFamilia(headerCeldaC) {
    const t = String(headerCeldaC || '').trim().toLowerCase();
    return t.includes('familia');
}

function layoutHojaCompacta(headerCeldaC, headerCeldaD) {
    const c = String(headerCeldaC || '').trim().toLowerCase();
    const d = String(headerCeldaD || '').trim().toLowerCase();
    // Criterios corridos: C = "Entrega a tiempo" y D = domicilio/precio.
    return c.includes('entrega') && (c.includes('tiempo') || d.includes('domicilio') || d.includes('precio'));
}

function layoutHojaConIso(headerCeldaI) {
    const t = String(headerCeldaI || '').trim().toLowerCase();
    return t.includes('iso') || t.includes('certificado');
}

function resolverColumnasDesdeHeaders(headerCeldaC, headerCeldaD, headerCeldaI) {
    if (layoutHojaTieneFamilia(headerCeldaC)) return COLUMNAS_LEGACY;
    if (layoutHojaCompacta(headerCeldaC, headerCeldaD)) return COLUMNAS_COMPACTAS;
    if (layoutHojaConIso(headerCeldaI)) return COLUMNAS_CON_ISO;
    return COLUMNAS;
}

function leerMetaPeriodoDesdeFila(getValor) {
    const candidatos = [
        getValor(META_COLS.periodo),
        getValor(META_COLS_ALT.periodoLegacy)
    ];
    for (const crudo of candidatos) {
        const limpio = limpiarMetaPeriodo(crudo);
        if (limpio) return limpio;
    }
    return '';
}

function leerMetaFechaDesdeFila(getValor) {
    const candidatos = [
        getValor(META_COLS.fechaEvaluacion), // I5
        getValor(META_COLS_ALT.fechaLegacyJ),
        getValor(META_COLS_ALT.fechaLegacyG),
        getValor(META_COLS_ALT.fechaLegacyH)
    ];
    for (const crudo of candidatos) {
        const txt = String(crudo || '').trim();
        // Ignora restos de etiqueta corruptos ("Fecha de l", etc.).
        if (/fecha\s+de/i.test(txt) && !/\d/.test(txt)) continue;
        const iso = formatearFechaIso(crudo);
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
    return '';
}

function leerFilaProveedorDesdeCeldas(getValor, cols) {
    return sanitizarProveedor({
        proveedor: getValor(cols.proveedor),
        entregaTiempo: getValor(cols.entregaTiempo),
        entregaDomicilio: getValor(cols.entregaDomicilio),
        precio: getValor(cols.precio),
        pagoTransferencia: getValor(cols.pagoTransferencia),
        servicio: getValor(cols.servicio),
        calidad: getValor(cols.calidad),
        calificacion: getValor(cols.calificacion)
    });
}

function leerProveedoresDesdeHoja(ws) {
    const headerC = celdaATexto(ws.getRow(HEADER_ROW).getCell(3).value);
    const headerD = celdaATexto(ws.getRow(HEADER_ROW).getCell(4).value);
    const headerI = celdaATexto(ws.getRow(HEADER_ROW).getCell(9).value);
    const cols = resolverColumnasDesdeHeaders(headerC, headerD, headerI);
    const proveedores = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const fila = leerFilaProveedorDesdeCeldas(
            (col) => celdaATexto(row.getCell(col).value),
            cols
        );
        if (!esProveedorVacio(fila) && !pareceNotaPlantilla(fila.proveedor)) {
            proveedores.push(fila);
        }
    }
    return proveedores;
}

function parsearDatosDesdeHoja(ws) {
    const metaRow = ws.getRow(META_ROW);
    const periodo = leerMetaPeriodoDesdeFila((col) => celdaATexto(metaRow.getCell(col).value));
    const fechaEval = leerMetaFechaDesdeFila((col) => metaRow.getCell(col).value);
    return sanitizarDatos({
        revision: DATOS_DEFECTO.revision,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: DATOS_DEFECTO.fechaRevision,
        periodoEvaluacion: periodo,
        fechaEvaluacion: fechaEval,
        proveedores: leerProveedoresDesdeHoja(ws)
    });
}

function asegurarMergeProveedorFila(ws, rowNum) {
    const rango = `${columnaALetra(COLUMNAS.proveedor)}${rowNum}:${columnaALetra(COLUMNAS.proveedorSpan)}${rowNum}`;
    try {
        ws.unMergeCells(rango);
    } catch (_) {
        /* sin fusión previa */
    }
    try {
        ws.mergeCells(rango);
    } catch (_) {
        /* ya fusionada */
    }
}

function limpiarCelda(row, col, horizontal = 'center') {
    asignarTextoSimple(row.getCell(col), '', horizontal);
}

function escribirFilaProveedor(row, item, indice, conDatos) {
    if (!conDatos) {
        // Filas vacías: sin número ni valores residuales.
        limpiarCelda(row, COLUMNAS.no);
        limpiarCelda(row, COLUMNAS.proveedor, 'left');
        limpiarCelda(row, COLUMNAS.proveedorSpan, 'left');
        limpiarCelda(row, COLUMNAS.entregaTiempo);
        limpiarCelda(row, COLUMNAS.entregaDomicilio);
        limpiarCelda(row, COLUMNAS.precio);
        limpiarCelda(row, COLUMNAS.pagoTransferencia);
        limpiarCelda(row, COLUMNAS.servicio);
        limpiarCelda(row, COLUMNAS.calidad);
        limpiarCelda(row, COLUMNAS.calificacion);
        for (const col of COLUMNAS_EXTRA_LIMPIAR) limpiarCelda(row, col);
        return;
    }
    const p = sanitizarProveedor(item);
    asignarTextoSimple(row.getCell(COLUMNAS.no), String(indice + 1), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.proveedor), p.proveedor, 'left');
    limpiarCelda(row, COLUMNAS.proveedorSpan, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.entregaTiempo), p.entregaTiempo, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.entregaDomicilio), p.entregaDomicilio, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.precio), p.precio, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.pagoTransferencia), p.pagoTransferencia, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.servicio), p.servicio, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.calidad), p.calidad, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.calificacion), p.calificacion, 'center');
    for (const col of COLUMNAS_EXTRA_LIMPIAR) limpiarCelda(row, col);
}

function escribirProveedoresEnHoja(ws, proveedoresRaw) {
    const proveedores = Array.isArray(proveedoresRaw) ? proveedoresRaw : [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        asegurarMergeProveedorFila(ws, rowNum);
        const conDatos = i < proveedores.length;
        const fila = conDatos ? proveedores[i] : { ...PROVEEDOR_DEFECTO };
        escribirFilaProveedor(ws.getRow(rowNum), fila, i, conDatos);
    }
}

function escribirEncabezadosTabla(ws) {
    const row = ws.getRow(HEADER_ROW);
    asegurarMergeProveedorFila(ws, HEADER_ROW);
    for (const [col, texto] of HEADERS_TABLA) {
        asignarTextoSimple(row.getCell(col), texto, 'center');
    }
    // C queda cubierta por la fusión Proveedor; K/L residuales (ISO / layout viejo).
    limpiarCelda(row, COLUMNAS.proveedorSpan, 'center');
    for (const col of COLUMNAS_EXTRA_LIMPIAR) limpiarCelda(row, col, 'center');
}

function escribirMetaEnHoja(ws, datos) {
    const d = sanitizarDatos(datos);
    const metaRow = ws.getRow(META_ROW);
    // Valor visible del periodo (C5).
    asignarTextoSimple(metaRow.getCell(META_COLS.periodo), d.periodoEvaluacion, 'left');
    const b5 = celdaATexto(metaRow.getCell(META_COLS_ALT.periodoLegacy).value);
    // Limpia B5 solo si quedó un periodo viejo (no la etiqueta).
    if (b5 && !/^periodo\s+de\s+evaluaci/i.test(b5)) {
        asignarTextoSimple(metaRow.getCell(META_COLS_ALT.periodoLegacy), '', 'left');
    }
    // Etiqueta en F5 (fusión F:H) y fecha del registro (hora México) en I5 (fusión I:J).
    asignarTextoSimple(metaRow.getCell(META_COLS.fechaLabel), 'Fecha de la evaluación:', 'left');
    const fechaTxt = fechaParaSheet(fechaEvaluacionRegistro(d));
    asignarTextoSimple(metaRow.getCell(META_COLS.fechaEvaluacion), fechaTxt, 'center');
}

function escribirDatosEnHoja(ws, datos) {
    const d = sanitizarDatos({
        ...datos,
        fechaEvaluacion: fechaEvaluacionRegistro(datos)
    });
    escribirMetaEnHoja(ws, d);
    escribirEncabezadosTabla(ws);
    escribirProveedoresEnHoja(ws, d.proveedores);
}

function columnaALetra(col) {
    let numero = Number(col);
    let letras = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letras = String.fromCharCode(65 + resto) + letras;
        numero = Math.floor((numero - 1) / 26);
    }
    return letras;
}

function rangoSheet(celda, sheetTitle) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle) {
    const d = sanitizarDatos({
        ...datos,
        fechaEvaluacion: fechaEvaluacionRegistro(datos)
    });
    const actualizaciones = [];
    const fechaTxt = fechaParaSheet(d.fechaEvaluacion) || '';
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.periodo)}${META_ROW}`, sheetTitle),
        values: [[d.periodoEvaluacion || '']]
    });
    // Etiqueta en F5 (fusión F:H) + valor del día (México) en I5 (fusión I:J).
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.fechaLabel)}${META_ROW}`, sheetTitle),
        values: [['Fecha de la evaluación:']]
    });
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.fechaEvaluacion)}${META_ROW}`, sheetTitle),
        values: [[fechaTxt]]
    });
    for (const [col, texto] of HEADERS_TABLA) {
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(col)}${HEADER_ROW}`, sheetTitle),
            values: [[texto]]
        });
    }
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(COLUMNAS.proveedorSpan)}${HEADER_ROW}`, sheetTitle),
        values: [['']]
    });
    for (const col of COLUMNAS_EXTRA_LIMPIAR) {
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(col)}${HEADER_ROW}`, sheetTitle),
            values: [['']]
        });
    }
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const conDatos = i < d.proveedores.length;
        const p = conDatos ? sanitizarProveedor(d.proveedores[i]) : { ...PROVEEDOR_DEFECTO };
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.no)}${rowNum}`, sheetTitle),
            values: [[conDatos ? String(i + 1) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.proveedor)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.proveedor || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.proveedorSpan)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.entregaTiempo)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.entregaTiempo || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.entregaDomicilio)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.entregaDomicilio || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.precio)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.precio || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.pagoTransferencia)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.pagoTransferencia || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.servicio)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.servicio || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.calidad)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.calidad || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.calificacion)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.calificacion || '') : '']]
        });
        for (const col of COLUMNAS_EXTRA_LIMPIAR) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(col)}${rowNum}`, sheetTitle),
                values: [['']]
            });
        }
    }
    return actualizaciones;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        const vigente = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        return vigente || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const lista = Array.isArray(titulos) ? titulos.map((t) => String(t || '').trim()).filter(Boolean) : [];
        if (!lista.length) {
            return SHEET_TITLE;
        }
        const vigente = excelHistorial.resolverTituloHojaVigente(lista, SHEET_TITLE, CODIGO_FORMATO);
        if (lista.includes(vigente)) {
            return vigente;
        }
        const exacta = lista.find((t) => t.toLowerCase() === SHEET_TITLE.toLowerCase());
        if (exacta) {
            return exacta;
        }
        const parcial = lista.find((t) => /evaluaci[oó]n/i.test(t) && !excelHistorial.esHojaHistorial(t, CODIGO_FORMATO));
        if (parcial) {
            return parcial;
        }
        const base = lista.filter((t) => !excelHistorial.esHojaHistorial(t, CODIGO_FORMATO));
        return base[0] || lista[0] || SHEET_TITLE;
    } catch (err) {
        console.warn('[SGC-F-29] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-29 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch {
        return driveService.descargarArchivo(fileId);
    }
}

async function aplicarFormatoVisualSgcF29(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = sanitizarDatos(datos);
    const numFilas = d.proveedores.length;
    try {
        await driveService.aplicarFormatoFilasSgcF29(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW
        );
    } catch (err) {
        console.warn('[SGC-F-29] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF29(spreadsheetId, titulo, datos);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-29 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    const sa = sanitizarDatos(a);
    const sb = sanitizarDatos(b);
    const stripMeta = (lista) => (lista || []).map(({ id, referencia, fecha, ...rest }) => ({
        ...rest,
        fecha: fecha || ''
    }));
    return sa.periodoEvaluacion === sb.periodoEvaluacion
        && sa.fechaEvaluacion === sb.fechaEvaluacion
        && JSON.stringify(stripMeta(sa.proveedores)) === JSON.stringify(stripMeta(sb.proveedores));
}

function estructuraEsEquivalente() {
    // En la bitácora, agregar o quitar proveedores es captura normal de
    // información (no un cambio de formato/revisión). Si el número de filas se
    // tratara como cambio estructural, el historial duplicaría la hoja mensual
    // (SGCF29-MMAA → SGCF29-MMAA_2) y los datos quedarían en una hoja que el
    // sistema no reconoce como vigente, provocando que la vista se "vacíe".
    // Por eso siempre se considera equivalente: el cambio se clasifica como
    // "información" y se reutiliza la hoja del mes.
    return true;
}

async function aplicarHistorialSgcF29(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    const nombreMesAnio = `${excelHistorial.codigoHistorialBase(CODIGO_FORMATO)}-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        try {
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[SGC-F-29] No se pudo reescribir hoja tras historial:', err.message);
        }
    }
    return result;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function archivoEstaEnCarpeta(fileId, folderId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const parents = Array.isArray(info?.parents) ? info.parents : [];
        return parents.includes(folderId);
    } catch {
        return false;
    }
}

async function esSpreadsheetEditableEnDrive(spreadsheetId) {
    if (!spreadsheetId) return false;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-29] No se pudo validar Google Sheet:', err.message);
        return false;
    }
}

async function persistirDriveFileIdEnDb(pool, driveFileId, registro = null) {
    const registroBase = registro || await obtenerRegistroDb(pool);
    const datosActuales = await leerDatosRegistro(registroBase) || sanitizarDatos(DATOS_DEFECTO);
    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosActuales,
        fechaElaboracionOriginal: formatearFechaIso(registroBase?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: formatearFechaIso(registroBase?.fecha_modificacion_contenido),
        contenidoModificado: !!registroBase?.contenido_modificado
    });
}

async function restaurarDriveComoGoogleSheet(fileId, pool, registro = null) {
    console.log(`[SGC-F-29] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
    const archivo = await driveService.convertirOfficeExcelAGoogleSheet(fileId, {
        nombre: NOMBRE_ARCHIVO_DRIVE,
        carpetaId: CARPETA_DRIVE_ID,
        eliminarOriginal: true
    });
    const nuevoId = archivo?.id;
    if (!nuevoId) {
        throw new Error('No se obtuvo ID del Google Sheet restaurado');
    }
    await persistirDriveFileIdEnDb(pool, nuevoId, registro);
    console.log(`[SGC-F-29] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA].filter(Boolean);
    const unicos = [...new Set(candidatos.map((id) => String(id).trim()).filter(Boolean))];

    for (const id of unicos) {
        if (await esSpreadsheetEditableEnDrive(id)) {
            if (id !== driveId) {
                await persistirDriveFileIdEnDb(pool, id, registro);
            }
            return id;
        }
    }

    const idOffice = unicos.find(Boolean);
    if (!idOffice) {
        throw new Error('No hay archivo SGC-F-29 configurado en Drive.');
    }
    return await restaurarDriveComoGoogleSheet(idOffice, pool, registro);
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        try {
            const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
            if (existe && (await esSpreadsheetEditableEnDrive(DRIVE_FILE_ID_SISTEMA))) {
                return DRIVE_FILE_ID_SISTEMA;
            }
        } catch {
            // Continuar con otros candidatos.
        }
    }

    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) {
            candidatos.push(val);
        }
    };

    agregar(registro?.drive_file_id);
    agregar(DRIVE_FILE_ID_SISTEMA);
    const enCarpeta = await buscarArchivoDriveTrabajo();
    agregar(enCarpeta?.id);

    const resolver = async (soloGoogleSheet, requiereCarpeta) => {
        for (const id of candidatos) {
            try {
                const existe = await driveService.verificarArchivoExiste(id);
                if (!existe) continue;
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) continue;
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) continue;
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) return editableSinCarpeta;
    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) return editableEnCarpeta;
    const cualquieraSinCarpeta = await resolver(false, false);
    if (cualquieraSinCarpeta) return cualquieraSinCarpeta;
    return DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-29] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-29] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 9, keepSingleSheet: false }
    );
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

function formatearInstanteMexico(fecha) {
    const dt = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(dt);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

function formatearUltimaSyncDisplay(registro, archivoDrive) {
    const dbVal = registro?.ultima_sync_drive;
    if (dbVal != null && dbVal !== '') {
        return formatearDatetimeMysqlMexico(dbVal);
    }
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) {
        return formatearInstanteMexico(driveVal);
    }
    return null;
}

function construirRespuesta(registro, datos, archivoDrive) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null,
        previewUrl: driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive)
    };
}

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function obtenerResumenProveedores(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const lista = (datos.proveedores || []).map((p, idx) => {
        const calif = p.calificacion !== '' ? Number(p.calificacion) : null;
        return {
            id: p.id || '',
            no: idx + 1,
            proveedor: p.proveedor || '',
            referencia: p.referencia || '',
            fecha: p.fecha || '',
            entregaTiempo: p.entregaTiempo !== '' ? Number(p.entregaTiempo) : null,
            entregaDomicilio: p.entregaDomicilio !== '' ? Number(p.entregaDomicilio) : null,
            precio: p.precio !== '' ? Number(p.precio) : null,
            pagoTransferencia: p.pagoTransferencia !== '' ? Number(p.pagoTransferencia) : null,
            servicio: p.servicio !== '' ? Number(p.servicio) : null,
            calidad: p.calidad !== '' ? Number(p.calidad) : null,
            calificacion: Number.isFinite(calif) ? calif : null,
            aprobado: Number.isFinite(calif) ? calif >= 80 : false
        };
    });
    const conCalif = lista.filter((p) => p.calificacion !== null);
    const promedio = conCalif.length
        ? Math.round(conCalif.reduce((s, p) => s + p.calificacion, 0) / conCalif.length)
        : 0;
    const aprobados = conCalif.filter((p) => p.aprobado).length;
    const reprobados = Math.max(0, conCalif.length - aprobados);

    const promedioCriterio = (campo) => {
        const vals = lista.map((p) => p[campo]).filter((v) => v !== null && Number.isFinite(v));
        if (!vals.length) return 0;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    // Agrupa evaluaciones del mismo proveedor (nombre normalizado).
    const gruposMap = new Map();
    for (const ev of lista) {
        const clave = String(ev.proveedor || '').trim().toLowerCase() || `__sin_${ev.no}`;
        if (!gruposMap.has(clave)) {
            gruposMap.set(clave, {
                proveedor: ev.proveedor || 'Sin nombre',
                evaluaciones: []
            });
        }
        gruposMap.get(clave).evaluaciones.push(ev);
    }
    const proveedoresAgrupados = Array.from(gruposMap.values()).map((g) => {
        const califs = g.evaluaciones
            .map((e) => e.calificacion)
            .filter((c) => c !== null && Number.isFinite(c));
        const promedioProv = califs.length
            ? Math.round(califs.reduce((a, b) => a + b, 0) / califs.length)
            : null;
        const ordenadas = [...g.evaluaciones].sort((a, b) => {
            const ca = a.calificacion == null ? -1 : a.calificacion;
            const cb = b.calificacion == null ? -1 : b.calificacion;
            return cb - ca;
        });
        return {
            proveedor: g.proveedor,
            totalEvaluaciones: g.evaluaciones.length,
            promedioCalificacion: promedioProv,
            aprobado: promedioProv != null ? promedioProv >= 80 : false,
            mejorCalificacion: califs.length ? Math.max(...califs) : null,
            peorCalificacion: califs.length ? Math.min(...califs) : null,
            evaluaciones: ordenadas
        };
    }).sort((a, b) => {
        const pa = a.promedioCalificacion == null ? -1 : a.promedioCalificacion;
        const pb = b.promedioCalificacion == null ? -1 : b.promedioCalificacion;
        return pb - pa;
    });

    let conteosEvidencias = {};
    try {
        const ids = lista.map((p) => p.id).filter(Boolean);
        if (ids.length) {
            conteosEvidencias = await sgcF29EvidenciaService.contarEvidencias(pool, ids);
        }
    } catch (err) {
        console.warn('[SGC-F-29] No se pudieron contar evidencias:', err.message);
    }

    const listaConEvidencias = lista.map((p) => ({
        ...p,
        evidencias: conteosEvidencias[p.id] || 0
    }));
    const agrupadosConEvidencias = proveedoresAgrupados.map((g) => ({
        ...g,
        evidencias: g.evaluaciones.reduce(
            (s, e) => s + (conteosEvidencias[e.id] || 0),
            0
        ),
        evaluaciones: g.evaluaciones.map((e) => ({
            ...e,
            evidencias: conteosEvidencias[e.id] || 0
        }))
    }));

    return {
        total: lista.length,
        totalProveedoresUnicos: proveedoresAgrupados.length,
        promedioCalificacion: promedio,
        aprobados,
        reprobados,
        periodoEvaluacion: datos.periodoEvaluacion || '',
        fechaEvaluacion: datos.fechaEvaluacion || '',
        criterios: {
            entregaTiempo: promedioCriterio('entregaTiempo'),
            entregaDomicilio: promedioCriterio('entregaDomicilio'),
            precio: promedioCriterio('precio'),
            pagoTransferencia: promedioCriterio('pagoTransferencia'),
            servicio: promedioCriterio('servicio'),
            calidad: promedioCriterio('calidad')
        },
        proveedores: listaConEvidencias,
        proveedoresAgrupados: agrupadosConEvidencias
    };
}

async function resolverDriveFileIdRapido(registro) {
    const id = String(registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA || '').trim();
    return id || null;
}

/**
 * Lectura rápida vía Sheets API (sin exportar XLSX).
 * Rango A5:L19 — cubre meta, tabla A:J y limpia residual en K:L.
 */
async function leerDatosRapidoDesdeSheet(spreadsheetId) {
    if (!spreadsheetId) return null;
    const { google } = require('googleapis');
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Drive auth no inicializado');
    }
    const sheetsApi = google.sheets({ version: 'v4', auth });
    const titulo = await resolverTituloHojaTrabajo(spreadsheetId);
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${titulo}'!A${META_ROW}:L${DATA_END_ROW}`,
        majorDimension: 'ROWS'
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    const meta = rows[0] || [];
    const periodo = leerMetaPeriodoDesdeFila((col) => meta[col - 1] || '');
    const fechaEval = leerMetaFechaDesdeFila((col) => meta[col - 1] || '');

    const headerOffset = HEADER_ROW - META_ROW;
    const headerRow = rows[headerOffset] || [];
    const cols = resolverColumnasDesdeHeaders(headerRow[2] || '', headerRow[3] || '', headerRow[8] || '');

    const proveedores = [];
    const offsetDatos = DATA_START_ROW - META_ROW;
    for (let i = 0; i < MAX_FILAS; i++) {
        const row = rows[offsetDatos + i] || [];
        const fila = leerFilaProveedorDesdeCeldas(
            (col) => row[col - 1] || '',
            cols
        );
        if (!esProveedorVacio(fila) && !pareceNotaPlantilla(fila.proveedor)) {
            proveedores.push(fila);
        }
    }

    return sanitizarDatos({
        revision: DATOS_DEFECTO.revision,
        fechaElaboracion: DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: DATOS_DEFECTO.fechaRevision,
        periodoEvaluacion: periodo,
        fechaEvaluacion: fechaEval,
        proveedores
    });
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileIdRapido(registro);

    // Ruta rápida: servir desde BD (lo que el sistema guardó).
    // Evita exportar el Sheet a XLSX en cada apertura (latencia alta de Drive).
    let datos = await leerDatosRegistro(registro);
    const datosVacios = !datos
        || (!(datos.proveedores || []).length
            && !datos.periodoEvaluacion
            && !datos.fechaEvaluacion);

    if (datosVacios && driveFileId) {
        try {
            datos = await leerDatosRapidoDesdeSheet(driveFileId);
            // Persistimos para las siguientes cargas.
            if (datos) {
                await guardarRegistroDb(pool, {
                    driveFileId,
                    datos,
                    fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion || fechaHoyIso(),
                    fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
                    contenidoModificado: !!registro?.contenido_modificado
                });
                registro = await obtenerRegistroDb(pool);
            }
        } catch (err) {
            console.warn('[SGC-F-29] Lectura rápida de Sheet falló, reintentando export:', err.message);
            try {
                const buffer = await descargarBufferDrive(driveFileId);
                datos = await leerDatosDesdeBuffer(buffer);
            } catch (err2) {
                console.warn('[SGC-F-29] No se pudo leer archivo en Drive, usando plantilla/defecto:', err2.message);
            }
        }
    }

    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    if (!registro) {
        registro = {
            fecha_elaboracion_original: datos.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = { ...registro, drive_file_id: driveFileId || null };
    return construirRespuesta(registro, datos, null);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    const registroPrevio = await obtenerRegistroDb(pool);
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
    const rawBody = body?.datos || body || {};
    const datosEntrada = sanitizarDatos({
        ...rawBody,
        fechaEvaluacion: fechaEvaluacionRegistro(rawBody),
        proveedores: fusionarIdsProveedores(
            datosPrevios?.proveedores || [],
            Array.isArray(rawBody.proveedores) ? rawBody.proveedores : []
        )
    });
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    if (!huboCambio && driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveId);
        await actualizarDatosEnGoogleSheet(driveId, datosEntrada, hojaDestino);
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return construirRespuesta({ ...registroPrevio, drive_file_id: driveId }, datosEntrada, archivoDrive);
    }

    let datosGuardar = { ...datosEntrada };

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const fechaCambio = fechaHoyIso();
            const hist = await aplicarHistorialSgcF29({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: { ...datosEntrada },
                origen,
                forzarTipo: body?.tipoCambio || null
            });
            datosGuardar = hist.datosGuardar;

            if (hist.aplicado && origen !== 'consulta') {
                contenidoModificado = true;
                fechaModificacion = fechaCambio;
            }

            datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                ? fechaModificacion
                : fechaOriginal;

            const hojaDestino = hist.aplicado && hist.hojaVigente
                ? hist.hojaVigente
                : await resolverTituloHojaTrabajo(driveId);
            if (!hist.aplicado) {
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino);
            }
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return construirRespuesta(registro, datosGuardar, archivoDrive);
        } catch (err) {
            console.warn('[SGC-F-29] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar, archivoDrive);
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const buffer = await descargarBufferDrive(driveFileId);
    const leidos = await leerDatosDesdeBuffer(buffer, { modo: 'edicion' });

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = formatearFechaIso(leidos?.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion;
    }

    let datosPrevios = null;
    if (registro.datos_json) {
        try {
            datosPrevios = sanitizarDatos(
                typeof registro.datos_json === 'string'
                    ? JSON.parse(registro.datos_json)
                    : registro.datos_json
            );
        } catch {
            datosPrevios = null;
        }
    }

    const datosDrive = sanitizarDatos({
        ...leidos,
        proveedores: fusionarIdsProveedores(
            datosPrevios?.proveedores || [],
            Array.isArray(leidos?.proveedores) ? leidos.proveedores : []
        )
    });

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF29({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosDrive,
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    if (!hist.aplicado) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveFileId);
        await actualizarDatosEnGoogleSheet(driveFileId, datosGuardar, hojaDestino);
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-29] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, null);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos, archivoDrive);
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    obtenerResumenProveedores
};
