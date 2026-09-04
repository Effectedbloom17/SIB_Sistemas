/**
 * DG-F-05 · Listado de partes interesadas — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'DG-F-05';
const TEMPLATE_DRIVE_ID = '1TztLGOGdIW6P-zhjy_kBYAK4GfmX5nPF';
const CARPETA_DRIVE_ID = '1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4';
const NOMBRE_ARCHIVO_DRIVE = 'DG-F-05 Listado de partes interesadas (sistema)';
const SHEET_TITLE = 'Partes Interesadas';

const META_ROW = 7;
const HEADER_ROW = 9;
const DATA_START_ROW = 10;
const META_COL = {
    empresa: 3,
    fecha: 8
};

const COL = {
    parte: 2,
    tipo: 3,
    necesidadesParte: 4,
    necesidadesOrg: 5,
    influencia: 6,
    razon: 7,
    seguimiento: 8
};
const COL_SEGUIMIENTO_FIN = 9;
const COL_TABLA_INICIO = COL.parte;
const COL_TABLA_FIN = COL_SEGUIMIENTO_FIN;

const BORDE_TABLA = { style: 'medium', color: { argb: 'FF000000' } };
const BORDES_CELDA_TABLA = {
    top: BORDE_TABLA,
    left: BORDE_TABLA,
    bottom: BORDE_TABLA,
    right: BORDE_TABLA
};
const TEXTO_ENCABEZADO_SEGUIMIENTO = 'Seguimiento';
const TEXTO_FIRMA = 'Firma';
/** Filas respecto al encabezado ELABORÓ/AUTORIZÓ (fila 17 en plantilla). */
const FILA_NOMBRE_FIRMA_OFFSET = 6;
const FILA_FIRMA_OFFSET = 7;
const FILA_LIMPIEZA_F_MAX = 120;

const CAMPOS_META_FUNDAMENTALES = [
    'empresa',
    'revision',
    'fechaRevision',
    'fechaElaboracion',
    'elaboro',
    'reviso',
    'autorizo'
];
const CAMPOS_META_FUNDAMENTALES_SET = new Set(CAMPOS_META_FUNDAMENTALES);

const REVISION_ROW = 2;
const FECHA_REV_ROW = 3;
const REVISION_COL = 9;

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-21',
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-07-17',
    filas: [
        {
            parteInteresada: 'Colaboradores',
            tipo: 'Interno',
            necesidadesParte:
                'Ambiente de trabajo sano y seguro.\nEquipo necesario para desarrollar su trabajo.\nCapacitación.\nReconocimiento.\nRetroalimentación de su trabajo.',
            necesidadesOrg:
                'Alto rendimiento\nCompromiso con la empresa\nLealtad\nIntegridad\nResponsabilidad',
            influencia: 'Alta',
            razon: 'Necesarios para cumplir el objetivo central de la empresa.',
            seguimiento:
                'Encuesta de ambiente de trabajo, descripciones de puesto, programas de capacitación.'
        },
        {
            parteInteresada: 'Clientes',
            tipo: 'Externo',
            necesidadesParte:
                'Servicio de calidad\nPropuestas de valor\nSoluciones innovadoras\nFlexibilidad\nRelación costo-beneficio',
            necesidadesOrg: 'Cliente confiable\nBuena comunicación\nBuena relación comercial',
            influencia: 'Alta',
            razon: 'Porque son los que compran nuestros servicios y soluciones.',
            seguimiento:
                'Comunicación con clientes (8.2), SGC, encuestas de satisfacción y atención a quejas.'
        },
        {
            parteInteresada: 'Proveedores',
            tipo: 'Externo',
            necesidadesParte:
                'Certeza en los pagos\nIncremento de volumen de compra\nBuena relación a largo plazo\nRetroalimentación',
            necesidadesOrg:
                'Entregas confiables\nPrecios competitivos\nBuen aliado estratégico\nConfiabilidad del proceso',
            influencia: 'Alta',
            razon: 'Es la fuente de insumos para llevar a cabo el objetivo de la organización.',
            seguimiento: 'Órdenes de compra claras, encuesta de satisfacción de proveedores (8.4).'
        },
        {
            parteInteresada: 'Autoridades',
            tipo: 'Externo',
            necesidadesParte: 'Cumplimiento normativo aplicable.',
            necesidadesOrg:
                'Comunicación efectiva\nServicios de calidad\nAsesoría y capacitación\nGarantizar el estado de derecho',
            influencia: 'Alta',
            razon: 'Para trabajar dentro del marco legal.',
            seguimiento: 'Tablero de requisitos legales y reglamentarios.'
        },
        {
            parteInteresada: 'Propietarios o socios',
            tipo: 'Interno',
            necesidadesParte:
                'Buenos resultados\nIncremento de cartera de clientes\nClientes satisfechos\nSGC eficaz',
            necesidadesOrg: 'Apertura al diálogo\nBuena comunicación entre niveles\nRespaldo\nConfianza',
            influencia: 'Alta',
            razon: 'Son la columna estratégica de la organización.',
            seguimiento: 'Indicadores, encuestas, juntas de revisión por dirección y auditorías.'
        }
    ],
    elaboro: 'Alta dirección',
    autorizo: 'Directora General'
};

function extraerMetadatosFundamentales(datos) {
    const base = datos && typeof datos === 'object' ? datos : {};
    return {
        empresa: base.empresa != null ? String(base.empresa) : null,
        revision: base.revision != null ? String(base.revision) : null,
        fechaOriginal: base.fechaRevision != null ? String(base.fechaRevision) : null,
        fechaModificacion: base.fechaElaboracion != null ? String(base.fechaElaboracion) : null,
        elaboro: base.elaboro != null ? String(base.elaboro) : null,
        reviso: base.reviso != null ? String(base.reviso) : null,
        autorizo: base.autorizo != null ? String(base.autorizo) : null
    };
}

function omitirMetadatosFundamentales(datos) {
    const base = datos && typeof datos === 'object' ? datos : {};
    const limpio = { ...base };
    for (const key of CAMPOS_META_FUNDAMENTALES) {
        delete limpio[key];
    }
    return limpio;
}

function normalizarRutaCampo(ruta) {
    return String(ruta || '').replace(/\[\d+\]/g, '[]');
}

function separarRutaSegmentos(ruta) {
    const limpio = String(ruta || '').replace(/^\$\.?/, '').trim();
    if (!limpio) {
        return [];
    }
    return limpio.split('.').filter(Boolean).map((segmento) => {
        const match = segmento.match(/^(.*?)\[(\d+)\]$/);
        if (!match) {
            return { raw: segmento, clave: segmento, indice: null };
        }
        return {
            raw: segmento,
            clave: match[1] || 'item',
            indice: Number(match[2])
        };
    });
}

function construirEtiquetaCampo(clave) {
    return String(clave || '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function construirMetaCampoDesdeRuta(ruta) {
    const segmentos = separarRutaSegmentos(ruta);
    if (!segmentos.length) {
        return {
            seccion: 'raiz',
            subseccion: null,
            campoClave: 'valor',
            etiquetaCampo: 'valor',
            rutaPadre: '$',
            indiceColeccion: null,
            nivelJerarquia: 0,
            rutaNormalizada: '$',
            esColeccion: 0
        };
    }

    const ultimo = segmentos[segmentos.length - 1];
    const seccion = segmentos[0].clave || 'raiz';
    const subseccionSegmentos = segmentos.slice(1, -1).map((s) => s.clave).filter(Boolean);
    const subseccion = subseccionSegmentos.length ? subseccionSegmentos.join('.') : null;

    let indiceColeccion = null;
    for (const seg of segmentos) {
        if (seg.indice != null) {
            indiceColeccion = seg.indice;
            break;
        }
    }

    const rutaPadre = segmentos.length > 1
        ? `$.${segmentos.slice(0, -1).map((s) => s.raw).join('.')}`
        : '$';

    return {
        seccion,
        subseccion,
        campoClave: ultimo.clave || 'valor',
        etiquetaCampo: construirEtiquetaCampo(ultimo.clave || 'valor'),
        rutaPadre,
        indiceColeccion,
        nivelJerarquia: segmentos.length,
        rutaNormalizada: normalizarRutaCampo(ruta),
        esColeccion: indiceColeccion != null ? 1 : 0
    };
}

function enriquecerCampoConMeta(fila) {
    return {
        ...fila,
        ...construirMetaCampoDesdeRuta(fila.ruta)
    };
}

function normalizarTipo(valor) {
    const v = String(valor || '').trim().toLowerCase();
    if (v.startsWith('int')) return 'Interno';
    if (v.startsWith('ext')) return 'Externo';
    return '';
}

function normalizarInfluencia(valor) {
    const v = String(valor || '').trim();
    if (v === 'Alta' || v === 'Media' || v === 'Baja') return v;
    return '';
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

/** Normaliza texto de celda: convierte separadores legacy (|) a saltos de línea. */
function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\|/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Espaciado superior e inferior (línea en blanco) en columnas de necesidades. */
function aplicarEspaciadoNecesidades(texto) {
    const contenido = normalizarSaltosLinea(texto);
    if (!contenido) {
        return '';
    }
    return `\n${contenido}\n`;
}

/** Texto multilínea para escribir en Excel/Sheets (respeta saltos de línea, no usa |). */
function textoMultilineaParaCelda(texto) {
    return normalizarSaltosLinea(texto);
}

function textoNecesidadesParaCelda(texto) {
    return aplicarEspaciadoNecesidades(texto);
}

function asignarTextoMultilinea(celda, texto, horizontal = 'center') {
    const valor = textoMultilineaParaCelda(texto);
    celda.value = valor;
    if (valor) {
        celda.alignment = {
            ...(celda.alignment || {}),
            horizontal,
            vertical: 'middle',
            wrapText: true
        };
    }
}

function asignarTextoNecesidades(celda, texto, horizontal) {
    const valor = textoNecesidadesParaCelda(texto);
    celda.value = valor;
    if (valor) {
        celda.alignment = {
            ...(celda.alignment || {}),
            horizontal,
            vertical: 'middle',
            wrapText: true
        };
    }
}

function asignarTextoSimple(celda, valor, horizontal = 'center') {
    celda.value = valor ?? '';
    celda.alignment = {
        ...(celda.alignment || {}),
        horizontal,
        vertical: 'middle',
        wrapText: true
    };
}

function aplicarBordesFilaFusionada(row, colInicio, colFin) {
    for (let c = colInicio; c <= colFin; c++) {
        const cell = row.getCell(c);
        cell.border = {
            top: BORDE_TABLA,
            bottom: BORDE_TABLA,
            left: c === colInicio ? BORDE_TABLA : (cell.border?.left || BORDE_TABLA),
            right: c === colFin ? BORDE_TABLA : (cell.border?.right || BORDE_TABLA)
        };
    }
}

function reforzarBordesFirmasDesdePlantilla(ws) {
    const filaFirmas = encontrarFilaFirmas(ws);
    if (!filaFirmas) {
        return;
    }

    const filaFirma = filaFirmas + FILA_FIRMA_OFFSET;

    for (let r = filaFirmas + 1; r <= filaFirma; r++) {
        const cell = ws.getRow(r).getCell(COL.necesidadesOrg);
        cell.border = {
            ...(cell.border || {}),
            right: BORDE_TABLA
        };
    }

    const cellElaboro = ws.getRow(filaFirma).getCell(COL.necesidadesParte);
    cellElaboro.border = {
        ...(cellElaboro.border || {}),
        bottom: BORDE_TABLA,
        left: BORDE_TABLA,
        right: BORDE_TABLA
    };

    const cellAutorizo = ws.getRow(filaFirma).getCell(COL.necesidadesOrg);
    cellAutorizo.border = {
        ...(cellAutorizo.border || {}),
        bottom: BORDE_TABLA,
        right: BORDE_TABLA
    };
}

function reforzarBordeInferiorUltimaFilaTabla(ws, numFilas) {
    if (!numFilas) {
        return;
    }

    const row = ws.getRow(DATA_START_ROW + numFilas - 1);
    for (let c = COL_TABLA_INICIO; c <= COL_TABLA_FIN; c++) {
        const cell = row.getCell(c);
        cell.border = {
            ...(cell.border || {}),
            bottom: BORDE_TABLA
        };
    }
    aplicarBordesFilaFusionada(row, COL.seguimiento, COL_SEGUIMIENTO_FIN);
}

function limpiarBordesColumnaInfluenciaFueraTabla(ws, numFilas) {
    const filaInicio = DATA_START_ROW + numFilas;
    const filaFin = Math.max(filaInicio, FILA_LIMPIEZA_F_MAX);

    for (let r = filaInicio; r <= filaFin; r++) {
        ws.getRow(r).getCell(COL.influencia).border = {};
    }
}

function asegurarMergeElaboro(ws, filaFirmas) {
    const filaInicio = filaFirmas + 1;
    const filaFin = filaFirmas + FILA_FIRMA_OFFSET;
    try {
        ws.unMergeCells(filaInicio, COL.necesidadesParte, filaFin, COL.necesidadesParte);
    } catch {
        /* sin fusión previa */
    }
    ws.mergeCells(filaInicio, COL.necesidadesParte, filaFin, COL.necesidadesParte);
}

function escribirFirmasEnHoja(ws, datos) {
    const filaFirmas = encontrarFilaFirmas(ws);
    const filaElaboro = filaFirmas + 1;
    const filaNombre = filaFirmas + FILA_NOMBRE_FIRMA_OFFSET;
    const filaFirma = filaFirmas + FILA_FIRMA_OFFSET;

    for (let r = filaElaboro; r <= filaFirma; r++) {
        ws.getRow(r).getCell(COL.necesidadesOrg).value = null;
    }

    asegurarMergeElaboro(ws, filaFirmas);
    asignarTextoSimple(ws.getRow(filaElaboro).getCell(COL.necesidadesParte), datos.elaboro, 'center');
    asignarTextoSimple(ws.getRow(filaNombre).getCell(COL.necesidadesOrg), datos.autorizo, 'center');
    asignarTextoSimple(ws.getRow(filaFirma).getCell(COL.necesidadesOrg), TEXTO_FIRMA, 'center');
}

function limpiarBordesFilasTablaObsoletas(ws, numFilas, filaNota) {
    const filaInicioLimpieza = DATA_START_ROW + numFilas;
    if (filaInicioLimpieza >= filaNota) {
        return;
    }
    for (let r = filaInicioLimpieza; r < filaNota; r++) {
        const row = ws.getRow(r);
        for (let c = COL_TABLA_INICIO; c <= COL_TABLA_FIN; c++) {
            const cell = row.getCell(c);
            cell.value = null;
            cell.border = {};
        }
        try {
            ws.unMergeCells(r, COL.seguimiento, r, COL_SEGUIMIENTO_FIN);
        } catch {
            /* sin fusión */
        }
    }
}

function reforzarBordesComplementarios(ws, numFilas) {
    aplicarBordesFilaFusionada(ws.getRow(HEADER_ROW), COL.seguimiento, COL_SEGUIMIENTO_FIN);
    for (let idx = 0; idx < numFilas; idx++) {
        const row = ws.getRow(DATA_START_ROW + idx);
        aplicarBordesFilaFusionada(row, COL.seguimiento, COL_SEGUIMIENTO_FIN);
    }
}

function asegurarEncabezadoSeguimiento(ws) {
    const row = ws.getRow(HEADER_ROW);
    let texto = celdaATexto(row.getCell(COL.seguimiento).value)
        || celdaATexto(row.getCell(COL_SEGUIMIENTO_FIN).value)
        || TEXTO_ENCABEZADO_SEGUIMIENTO;
    if (!texto.toLowerCase().includes('seguimiento')) {
        texto = TEXTO_ENCABEZADO_SEGUIMIENTO;
    }

    try {
        ws.unMergeCells(HEADER_ROW, COL.seguimiento, HEADER_ROW, COL_SEGUIMIENTO_FIN);
    } catch {
        /* sin fusión previa */
    }
    ws.mergeCells(HEADER_ROW, COL.seguimiento, HEADER_ROW, COL_SEGUIMIENTO_FIN);
    row.getCell(COL.seguimiento).value = texto;
    row.getCell(COL.seguimiento).alignment = {
        ...(row.getCell(COL.seguimiento).alignment || {}),
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true
    };
}

/** Bordes B:I y fusión H:I (Seguimiento) en cada fila de datos. */
function aplicarFormatoTablaDatos(ws, numFilas) {
    if (!numFilas) {
        return;
    }

    for (let idx = 0; idx < numFilas; idx++) {
        const rowNum = DATA_START_ROW + idx;
        const row = ws.getRow(rowNum);
        const seguimientoVal = row.getCell(COL.seguimiento).value;

        for (let c = COL_TABLA_INICIO; c <= COL_TABLA_FIN; c++) {
            row.getCell(c).border = { ...BORDES_CELDA_TABLA };
        }

        try {
            ws.unMergeCells(rowNum, COL.seguimiento, rowNum, COL_SEGUIMIENTO_FIN);
        } catch {
            /* fila sin fusión previa */
        }
        ws.mergeCells(rowNum, COL.seguimiento, rowNum, COL_SEGUIMIENTO_FIN);

        if (seguimientoVal !== null && seguimientoVal !== undefined && String(seguimientoVal) !== '') {
            asignarTextoMultilinea(row.getCell(COL.seguimiento), String(seguimientoVal), 'center');
        }
        aplicarBordesFilaFusionada(row, COL.seguimiento, COL_SEGUIMIENTO_FIN);
    }

    asegurarEncabezadoSeguimiento(ws);
    aplicarBordesFilaFusionada(ws.getRow(HEADER_ROW), COL.seguimiento, COL_SEGUIMIENTO_FIN);
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

/** Hora de pared México para DATETIME MySQL (serializado como ISO UTC en JSON). */
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function sanitizarFilas(filas) {
    const lista = Array.isArray(filas) ? filas : [];
    const normalizadas = lista.map((f) => ({
        parteInteresada: String(f?.parteInteresada || '').trim(),
        tipo: normalizarTipo(f?.tipo),
        necesidadesParte: aplicarEspaciadoNecesidades(f?.necesidadesParte),
        necesidadesOrg: aplicarEspaciadoNecesidades(f?.necesidadesOrg),
        influencia: normalizarInfluencia(f?.influencia),
        razon: String(f?.razon || '').trim(),
        seguimiento: String(f?.seguimiento || '').trim()
    }));

    const conContenido = normalizadas.filter(
        (f) =>
            f.parteInteresada ||
            f.necesidadesParte ||
            f.necesidadesOrg ||
            f.razon ||
            f.seguimiento
    );

    return conContenido.length ? conContenido : [{ ...DATOS_DEFECTO.filas[0], parteInteresada: '' }];
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const datos = {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim() || DATOS_DEFECTO.revision,
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        filas: sanitizarFilas(base.filas),
        elaboro: String(base.elaboro || DATOS_DEFECTO.elaboro).trim(),
        autorizo: String(base.autorizo || DATOS_DEFECTO.autorizo).trim()
    };
    if (base._metaHoja) {
        datos._metaHoja = base._metaHoja;
    }
    return datos;
}

function encontrarFilaNota(ws) {
    for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL.parte).value).toLowerCase();
        if (txt.includes('partes interesadas con influencia')) return r;
    }
    return DATA_START_ROW + 5;
}

function encontrarFilaFirmas(ws) {
    for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
        const txt = celdaATexto(ws.getRow(r).getCell(COL.necesidadesParte).value).toUpperCase();
        if (txt.includes('ELABORÓ') || txt.includes('ELABORO')) return r;
    }
    return encontrarFilaNota(ws) + 2;
}

function leerCeldaSeguimiento(row) {
    const principal = row.getCell(COL.seguimiento).value;
    if (principal !== null && principal !== undefined && String(principal).trim() !== '') {
        return principal;
    }
    return row.getCell(COL_SEGUIMIENTO_FIN).value;
}

/** Evita repetir CREATE/ALTER + information_schema en cada request (muy costoso). */
let _sgcTablasListas = false;
let _sgcTablasPromise = null;

/** Solo para scripts multi-BD: permite asegurar tablas en otro pool del mismo proceso. */
function resetAsegurarTablasSgcFlag() {
    _sgcTablasListas = false;
    _sgcTablasPromise = null;
}

async function asegurarTablaSgcFormatoDatos(pool) {
    if (_sgcTablasListas) {
        return;
    }
    if (_sgcTablasPromise) {
        return _sgcTablasPromise;
    }

    _sgcTablasPromise = (async () => {
        await _asegurarTablaSgcFormatoDatosInternal(pool);
        _sgcTablasListas = true;
    })().finally(() => {
        _sgcTablasPromise = null;
    });

    return _sgcTablasPromise;
}

async function _asegurarTablaSgcFormatoDatosInternal(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_formato_cabecera (
            codigo_formato VARCHAR(32) NOT NULL PRIMARY KEY,
            drive_file_id VARCHAR(128) NULL,
            fecha_elaboracion_original DATE NULL,
            fecha_modificacion_contenido DATE NULL,
            contenido_modificado TINYINT(1) NOT NULL DEFAULT 0,
            ultima_sync_drive DATETIME NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_formato_campos (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            codigo_formato VARCHAR(32) NOT NULL,
            orden INT NOT NULL,
            ruta_campo VARCHAR(512) NOT NULL,
            ruta_campo_normalizada VARCHAR(512) NULL,
            seccion VARCHAR(128) NULL,
            subseccion VARCHAR(255) NULL,
            campo_clave VARCHAR(128) NULL,
            etiqueta_campo VARCHAR(255) NULL,
            ruta_padre VARCHAR(512) NULL,
            indice_coleccion INT NULL,
            nivel_jerarquia TINYINT NULL,
            es_coleccion TINYINT(1) NOT NULL DEFAULT 0,
            tipo_valor VARCHAR(16) NOT NULL,
            valor_texto LONGTEXT NULL,
            valor_numero DECIMAL(20, 6) NULL,
            valor_booleano TINYINT(1) NULL,
            valor_fecha DATE NULL,
            valor_json JSON NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            KEY idx_sgc_formato_campos_codigo (codigo_formato),
            KEY idx_sgc_formato_campos_ruta (ruta_campo(191)),
            CONSTRAINT fk_sgc_formato_campos_cabecera
                FOREIGN KEY (codigo_formato) REFERENCES sgc_formato_cabecera(codigo_formato)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_formato_catalogo_campos (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            codigo_formato VARCHAR(32) NOT NULL,
            seccion VARCHAR(128) NULL,
            subseccion VARCHAR(255) NULL,
            campo_clave VARCHAR(128) NULL,
            etiqueta_campo VARCHAR(255) NULL,
            ruta_modelo VARCHAR(512) NOT NULL,
            tipo_valor VARCHAR(16) NOT NULL,
            es_coleccion TINYINT(1) NOT NULL DEFAULT 0,
            apariciones INT NOT NULL DEFAULT 0,
            primera_aparicion DATETIME DEFAULT CURRENT_TIMESTAMP,
            ultima_aparicion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_catalogo_modelo (codigo_formato, ruta_modelo),
            KEY idx_sgc_catalogo_seccion (codigo_formato, seccion, campo_clave),
            CONSTRAINT fk_sgc_catalogo_campos_cabecera
                FOREIGN KEY (codigo_formato) REFERENCES sgc_formato_cabecera(codigo_formato)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_formato_metadatos (
            codigo_formato VARCHAR(32) NOT NULL PRIMARY KEY,
            empresa VARCHAR(255) NULL,
            revision VARCHAR(32) NULL,
            fecha_original VARCHAR(32) NULL,
            fecha_modificacion VARCHAR(32) NULL,
            elaboro VARCHAR(255) NULL,
            reviso VARCHAR(255) NULL,
            autorizo VARCHAR(255) NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_sgc_formato_metadatos_cabecera
                FOREIGN KEY (codigo_formato) REFERENCES sgc_formato_cabecera(codigo_formato)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const asegurarColumnaMetadatos = async (nombreColumna, definicionColumna) => {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS total
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'sgc_formato_metadatos'
                AND COLUMN_NAME = ?`,
            [nombreColumna]
        );
        if (Number(rows?.[0]?.total || 0) > 0) {
            return;
        }
        await pool.query(`ALTER TABLE sgc_formato_metadatos ADD COLUMN ${nombreColumna} ${definicionColumna}`);
    };

    await asegurarColumnaMetadatos('fecha_original', 'VARCHAR(32) NULL');
    await asegurarColumnaMetadatos('fecha_modificacion', 'VARCHAR(32) NULL');

    const [rowsFechaRevision] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'sgc_formato_metadatos'
            AND COLUMN_NAME = 'fecha_revision'`
    );
    if (Number(rowsFechaRevision?.[0]?.total || 0) > 0) {
        await pool.query(
            `UPDATE sgc_formato_metadatos
                SET fecha_original = COALESCE(fecha_original, fecha_revision)
              WHERE fecha_revision IS NOT NULL`
        );
        await pool.query('ALTER TABLE sgc_formato_metadatos DROP COLUMN fecha_revision');
    }

    const [rowsFechaElaboracion] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'sgc_formato_metadatos'
            AND COLUMN_NAME = 'fecha_elaboracion'`
    );
    if (Number(rowsFechaElaboracion?.[0]?.total || 0) > 0) {
        await pool.query(
            `UPDATE sgc_formato_metadatos
                SET fecha_modificacion = COALESCE(fecha_modificacion, fecha_elaboracion)
              WHERE fecha_elaboracion IS NOT NULL`
        );
        await pool.query('ALTER TABLE sgc_formato_metadatos DROP COLUMN fecha_elaboracion');
    }

    const [rowsFecha] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'sgc_formato_metadatos'
            AND COLUMN_NAME = 'fecha'`
    );
    if (Number(rowsFecha?.[0]?.total || 0) > 0) {
        await pool.query('ALTER TABLE sgc_formato_metadatos DROP COLUMN fecha');
    }

    const [rowsMetadatosJson] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'sgc_formato_metadatos'
            AND COLUMN_NAME = 'metadatos_json'`
    );
    if (Number(rowsMetadatosJson?.[0]?.total || 0) > 0) {
        await pool.query('ALTER TABLE sgc_formato_metadatos DROP COLUMN metadatos_json');
    }

    const columnasSgcCampos = [
        ['ruta_campo_normalizada', 'VARCHAR(512) NULL'],
        ['seccion', 'VARCHAR(128) NULL'],
        ['subseccion', 'VARCHAR(255) NULL'],
        ['campo_clave', 'VARCHAR(128) NULL'],
        ['etiqueta_campo', 'VARCHAR(255) NULL'],
        ['ruta_padre', 'VARCHAR(512) NULL'],
        ['indice_coleccion', 'INT NULL'],
        ['nivel_jerarquia', 'TINYINT NULL'],
        ['es_coleccion', 'TINYINT(1) NOT NULL DEFAULT 0']
    ];

    for (const [nombreColumna, definicionColumna] of columnasSgcCampos) {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS total
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'sgc_formato_campos'
                AND COLUMN_NAME = ?`,
            [nombreColumna]
        );

        if (Number(rows?.[0]?.total || 0) > 0) {
            continue;
        }

        await pool.query(
            `ALTER TABLE sgc_formato_campos ADD COLUMN ${nombreColumna} ${definicionColumna}`
        );
    }
}

function esFechaIsoSimple(valor) {
    if (typeof valor !== 'string') {
        return false;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(valor.trim());
}

function serializarValorJson(valor) {
    if (valor === undefined) {
        return null;
    }
    try {
        return JSON.stringify(valor);
    } catch {
        return null;
    }
}

function desglosarCamposSgc(valor, rutaBase = '$', filas = []) {
    if (Array.isArray(valor)) {
        if (!valor.length) {
            filas.push(enriquecerCampoConMeta({
                ruta: rutaBase,
                tipo: 'array',
                valorJson: serializarValorJson(valor)
            }));
            return filas;
        }
        valor.forEach((item, idx) => {
            desglosarCamposSgc(item, `${rutaBase}[${idx}]`, filas);
        });
        return filas;
    }

    if (valor && typeof valor === 'object') {
        const entries = Object.entries(valor);
        if (!entries.length) {
            filas.push(enriquecerCampoConMeta({
                ruta: rutaBase,
                tipo: 'object',
                valorJson: serializarValorJson(valor)
            }));
            return filas;
        }
        entries.forEach(([key, item]) => {
            const segmento = key.replace(/\./g, '\\.')
                .replace(/\[/g, '\\[')
                .replace(/\]/g, '\\]');
            desglosarCamposSgc(item, `${rutaBase}.${segmento}`, filas);
        });
        return filas;
    }

    if (valor === null) {
        filas.push(enriquecerCampoConMeta({ ruta: rutaBase, tipo: 'null' }));
        return filas;
    }

    if (typeof valor === 'boolean') {
        filas.push(enriquecerCampoConMeta({
            ruta: rutaBase,
            tipo: 'boolean',
            valorBooleano: valor ? 1 : 0
        }));
        return filas;
    }

    if (typeof valor === 'number') {
        filas.push(enriquecerCampoConMeta({
            ruta: rutaBase,
            tipo: 'number',
            valorNumero: Number.isFinite(valor) ? valor : null
        }));
        return filas;
    }

    const texto = String(valor);
    filas.push(enriquecerCampoConMeta({
        ruta: rutaBase,
        tipo: 'string',
        valorTexto: texto,
        valorFecha: esFechaIsoSimple(texto) ? texto : null
    }));
    return filas;
}

async function sincronizarCatalogoCampos(pool, codigoFormato, filas) {
    if (!filas?.length) {
        return;
    }
    const agrupado = new Map();
    for (const fila of filas) {
        const key = `${codigoFormato}|${fila.rutaNormalizada || fila.ruta}`;
        const actual = agrupado.get(key);
        if (!actual) {
            agrupado.set(key, {
                codigoFormato,
                seccion: fila.seccion || null,
                subseccion: fila.subseccion || null,
                campoClave: fila.campoClave || null,
                etiquetaCampo: fila.etiquetaCampo || null,
                rutaModelo: fila.rutaNormalizada || fila.ruta,
                tipoValor: fila.tipo || 'string',
                esColeccion: fila.esColeccion ? 1 : 0,
                apariciones: 1
            });
            continue;
        }
        actual.apariciones += 1;
        if (actual.tipoValor !== fila.tipo) {
            actual.tipoValor = 'mixed';
        }
    }

    const valores = [...agrupado.values()].map((item) => [
        item.codigoFormato,
        item.seccion,
        item.subseccion,
        item.campoClave,
        item.etiquetaCampo,
        item.rutaModelo,
        item.tipoValor,
        item.esColeccion,
        item.apariciones
    ]);

    await pool.query(
        `INSERT INTO sgc_formato_catalogo_campos
            (codigo_formato, seccion, subseccion, campo_clave, etiqueta_campo,
             ruta_modelo, tipo_valor, es_coleccion, apariciones)
         VALUES ?
         ON DUPLICATE KEY UPDATE
            seccion = VALUES(seccion),
            subseccion = VALUES(subseccion),
            campo_clave = VALUES(campo_clave),
            etiqueta_campo = VALUES(etiqueta_campo),
            tipo_valor = VALUES(tipo_valor),
            es_coleccion = VALUES(es_coleccion),
            apariciones = VALUES(apariciones),
            ultima_aparicion = CURRENT_TIMESTAMP`,
        [valores]
    );
}

async function sincronizarPersistenciaEstructurada(pool, codigoFormato, payload) {
    await asegurarTablaSgcFormatoDatos(pool);

    await pool.query(
        `INSERT INTO sgc_formato_cabecera
            (codigo_formato, drive_file_id, fecha_elaboracion_original,
             fecha_modificacion_contenido, contenido_modificado, ultima_sync_drive)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
            drive_file_id = VALUES(drive_file_id),
            fecha_elaboracion_original = VALUES(fecha_elaboracion_original),
            fecha_modificacion_contenido = VALUES(fecha_modificacion_contenido),
            contenido_modificado = VALUES(contenido_modificado),
            ultima_sync_drive = NOW()`,
        [
            codigoFormato,
            payload.driveFileId || null,
            payload.fechaElaboracionOriginal || null,
            payload.fechaModificacionContenido || null,
            payload.contenidoModificado ? 1 : 0
        ]
    );

    const meta = extraerMetadatosFundamentales(payload?.datos || {});
    await pool.query(
        `INSERT INTO sgc_formato_metadatos
            (codigo_formato, empresa, revision, fecha_original, fecha_modificacion,
             elaboro, reviso, autorizo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            empresa = VALUES(empresa),
            revision = VALUES(revision),
            fecha_original = VALUES(fecha_original),
            fecha_modificacion = VALUES(fecha_modificacion),
            elaboro = VALUES(elaboro),
            reviso = VALUES(reviso),
            autorizo = VALUES(autorizo),
            updated_at = CURRENT_TIMESTAMP`,
        [
            codigoFormato,
            meta.empresa,
            meta.revision,
            meta.fechaOriginal,
            meta.fechaModificacion,
            meta.elaboro,
            meta.reviso,
            meta.autorizo
        ]
    );

    await pool.query('DELETE FROM sgc_formato_campos WHERE codigo_formato = ?', [codigoFormato]);

    const filas = desglosarCamposSgc(omitirMetadatosFundamentales(payload?.datos || {}));
    if (!filas.length) {
        return;
    }

    const valores = filas.map((fila, idx) => [
        codigoFormato,
        idx + 1,
        fila.ruta,
        fila.rutaNormalizada || normalizarRutaCampo(fila.ruta),
        fila.seccion || null,
        fila.subseccion || null,
        fila.campoClave || null,
        fila.etiquetaCampo || null,
        fila.rutaPadre || null,
        fila.indiceColeccion ?? null,
        fila.nivelJerarquia ?? null,
        fila.esColeccion ? 1 : 0,
        fila.tipo,
        fila.valorTexto || null,
        fila.valorNumero ?? null,
        fila.valorBooleano ?? null,
        fila.valorFecha || null,
        fila.valorJson || null
    ]);

    await pool.query(
        `INSERT INTO sgc_formato_campos
            (codigo_formato, orden, ruta_campo, ruta_campo_normalizada,
             seccion, subseccion, campo_clave, etiqueta_campo, ruta_padre,
             indice_coleccion, nivel_jerarquia, es_coleccion,
             tipo_valor, valor_texto, valor_numero, valor_booleano, valor_fecha, valor_json)
         VALUES ?`,
        [valores]
    );

    await sincronizarCatalogoCampos(pool, codigoFormato, filas);
}

function deserializarValorJsonSeguro(valor) {
    if (valor == null || valor === '') {
        return null;
    }
    if (typeof valor === 'object') {
        return valor;
    }
    try {
        return JSON.parse(valor);
    } catch {
        return null;
    }
}

function valorDesdeFilaCampo(fila) {
    const tipo = String(fila?.tipo_valor || '').toLowerCase();
    if (tipo === 'null') {
        return null;
    }
    if (tipo === 'boolean') {
        if (fila?.valor_booleano == null) return null;
        return Number(fila.valor_booleano) === 1;
    }
    if (tipo === 'number') {
        if (fila?.valor_numero == null) return null;
        const numero = Number(fila.valor_numero);
        return Number.isFinite(numero) ? numero : null;
    }
    if (tipo === 'array' || tipo === 'object') {
        const json = deserializarValorJsonSeguro(fila?.valor_json);
        if (json != null) {
            return json;
        }
        return tipo === 'array' ? [] : {};
    }
    if (tipo === 'string') {
        if (fila?.valor_texto != null) {
            return String(fila.valor_texto);
        }
        if (fila?.valor_fecha != null) {
            return String(fila.valor_fecha);
        }
        return '';
    }
    if (fila?.valor_json != null) {
        const json = deserializarValorJsonSeguro(fila.valor_json);
        if (json != null) {
            return json;
        }
    }
    if (fila?.valor_texto != null) {
        return String(fila.valor_texto);
    }
    if (fila?.valor_numero != null) {
        const numero = Number(fila.valor_numero);
        return Number.isFinite(numero) ? numero : null;
    }
    if (fila?.valor_booleano != null) {
        return Number(fila.valor_booleano) === 1;
    }
    if (fila?.valor_fecha != null) {
        return String(fila.valor_fecha);
    }
    return null;
}

function desescaparSegmentoRuta(segmento) {
    return String(segmento || '').replace(/\\([.\[\]\\])/g, '$1');
}

function tokenizarRutaCampo(ruta) {
    const limpio = String(ruta || '').trim();
    if (!limpio || limpio === '$') {
        return [];
    }
    const cuerpo = limpio.startsWith('$.') ? limpio.slice(2) : limpio.replace(/^\$/, '');
    if (!cuerpo) {
        return [];
    }

    const segmentos = [];
    let actual = '';
    let escapando = false;
    for (let i = 0; i < cuerpo.length; i++) {
        const ch = cuerpo[i];
        if (escapando) {
            actual += ch;
            escapando = false;
            continue;
        }
        if (ch === '\\') {
            escapando = true;
            continue;
        }
        if (ch === '.') {
            if (actual) segmentos.push(actual);
            actual = '';
            continue;
        }
        actual += ch;
    }
    if (actual) segmentos.push(actual);

    const tokens = [];
    for (const segmentoRaw of segmentos) {
        let prop = '';
        for (let i = 0; i < segmentoRaw.length; i++) {
            const ch = segmentoRaw[i];
            if (ch === '\\' && i + 1 < segmentoRaw.length) {
                prop += segmentoRaw[i + 1];
                i += 1;
                continue;
            }
            if (ch === '[') {
                if (prop) {
                    tokens.push({ tipo: 'prop', valor: desescaparSegmentoRuta(prop) });
                    prop = '';
                }
                let j = i + 1;
                let num = '';
                while (j < segmentoRaw.length && /\d/.test(segmentoRaw[j])) {
                    num += segmentoRaw[j];
                    j += 1;
                }
                if (segmentoRaw[j] === ']' && num !== '') {
                    tokens.push({ tipo: 'idx', valor: Number(num) });
                    i = j;
                    continue;
                }
                prop += ch;
                continue;
            }
            prop += ch;
        }
        if (prop) {
            tokens.push({ tipo: 'prop', valor: desescaparSegmentoRuta(prop) });
        }
    }
    return tokens;
}

function asignarValorEnRuta(objetivo, ruta, valor) {
    const tokens = tokenizarRutaCampo(ruta);
    if (!tokens.length) {
        return;
    }
    let cursor = objetivo;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const esUltimo = i === tokens.length - 1;
        const siguiente = tokens[i + 1];

        if (token.tipo === 'prop') {
            if (esUltimo) {
                cursor[token.valor] = valor;
                return;
            }
            if (cursor[token.valor] == null || typeof cursor[token.valor] !== 'object') {
                cursor[token.valor] = siguiente?.tipo === 'idx' ? [] : {};
            }
            cursor = cursor[token.valor];
            continue;
        }

        if (!Array.isArray(cursor)) {
            return;
        }
        if (esUltimo) {
            cursor[token.valor] = valor;
            return;
        }
        if (cursor[token.valor] == null || typeof cursor[token.valor] !== 'object') {
            cursor[token.valor] = siguiente?.tipo === 'idx' ? [] : {};
        }
        cursor = cursor[token.valor];
    }
}

function reconstruirDatosDesdeCampos(filas) {
    const datos = {};
    const ordenadas = Array.isArray(filas)
        ? [...filas].sort((a, b) => Number(a?.orden || 0) - Number(b?.orden || 0))
        : [];
    for (const fila of ordenadas) {
        asignarValorEnRuta(datos, fila.ruta_campo, valorDesdeFilaCampo(fila));
    }
    return datos;
}

async function obtenerRegistroSgcPersistido(pool, codigoFormato) {
    await asegurarTablaSgcFormatoDatos(pool);

    const [cabRows] = await pool.query(
        'SELECT * FROM sgc_formato_cabecera WHERE codigo_formato = ? LIMIT 1',
        [codigoFormato]
    );
    const cabecera = cabRows?.[0] || null;
    if (!cabecera) {
        return null;
    }

    const [metaRows] = await pool.query(
        'SELECT * FROM sgc_formato_metadatos WHERE codigo_formato = ? LIMIT 1',
        [codigoFormato]
    );
    const meta = metaRows?.[0] || null;

    const [filas] = await pool.query(
        `SELECT orden, ruta_campo, tipo_valor, valor_texto, valor_numero, valor_booleano, valor_fecha, valor_json
           FROM sgc_formato_campos
          WHERE codigo_formato = ?
          ORDER BY orden ASC`,
        [codigoFormato]
    );

    const datosContenido = reconstruirDatosDesdeCampos(filas || []);
    const datos = { ...datosContenido };
    if (meta?.empresa != null) datos.empresa = meta.empresa;
    if (meta?.revision != null) datos.revision = meta.revision;
    if (meta?.fecha_original != null) datos.fechaRevision = meta.fecha_original;
    if (meta?.fecha_modificacion != null) datos.fechaElaboracion = meta.fecha_modificacion;
    if (meta?.elaboro != null) datos.elaboro = meta.elaboro;
    if (meta?.reviso != null) datos.reviso = meta.reviso;
    if (meta?.autorizo != null) datos.autorizo = meta.autorizo;

    return {
        id: null,
        codigo_formato: cabecera.codigo_formato,
        drive_file_id: cabecera.drive_file_id,
        datos_json: datos,
        fecha_elaboracion_original: cabecera.fecha_elaboracion_original,
        fecha_modificacion_contenido: cabecera.fecha_modificacion_contenido,
        contenido_modificado: cabecera.contenido_modificado,
        ultima_sync_drive: cabecera.ultima_sync_drive,
        created_at: cabecera.created_at,
        updated_at: cabecera.updated_at
    };
}

async function persistirRegistroSgc(pool, codigoFormato, payload = {}) {
    await asegurarTablaSgcFormatoDatos(pool);

    await sincronizarPersistenciaEstructurada(pool, codigoFormato, payload);
}

async function obtenerRegistroDb(pool) {
    return obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
}

function parsearDatosDesdeHoja(ws) {
    const meta = ws.getRow(META_ROW);
    const empresa = celdaATexto(meta.getCell(META_COL.empresa).value);
    const fechaRaw = meta.getCell(META_COL.fecha).value;
    const fechaElaboracion = fechaRaw instanceof Date
        ? formatearFechaIso(fechaRaw)
        : formatearFechaIso(String(fechaRaw || ''));

    const filaNota = encontrarFilaNota(ws);
    const filas = [];
    for (let r = DATA_START_ROW; r < filaNota; r++) {
        const row = ws.getRow(r);
        const parte = celdaATexto(row.getCell(COL.parte).value);
        if (!parte) continue;
        if (parte.toLowerCase().includes('parte interesada')) continue;

        filas.push({
            parteInteresada: parte,
            tipo: normalizarTipo(row.getCell(COL.tipo).value),
            necesidadesParte: aplicarEspaciadoNecesidades(celdaATexto(row.getCell(COL.necesidadesParte).value)),
            necesidadesOrg: aplicarEspaciadoNecesidades(celdaATexto(row.getCell(COL.necesidadesOrg).value)),
            influencia: normalizarInfluencia(row.getCell(COL.influencia).value),
            razon: celdaATexto(row.getCell(COL.razon).value),
            seguimiento: celdaATexto(leerCeldaSeguimiento(row))
        });
    }

    const filaFirmas = encontrarFilaFirmas(ws);
    let elaboro = DATOS_DEFECTO.elaboro;
    let autorizo = DATOS_DEFECTO.autorizo;
    for (let r = filaFirmas + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const valElab = celdaATexto(row.getCell(COL.necesidadesParte).value);
        const valAut = celdaATexto(row.getCell(COL.necesidadesOrg).value);
        if (valElab && valElab.toLowerCase() !== 'firma') elaboro = valElab;
        if (valAut && valAut.toLowerCase() !== 'firma') autorizo = valAut;
    }

    const revText = celdaATexto(ws.getRow(REVISION_ROW).getCell(REVISION_COL).value);
    const revMatch = revText.match(/(\d+)/);
    const fechaRevText = celdaATexto(ws.getRow(FECHA_REV_ROW).getCell(REVISION_COL).value);
    const fechaRevMatch = fechaRevText.match(/(\d{2}-\d{2}-\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);

    return sanitizarDatos({
        revision: revMatch ? revMatch[1].padStart(2, '0') : DATOS_DEFECTO.revision,
        fechaRevision: fechaRevMatch ? (formatearFechaIso(fechaRevMatch[1]) || DATOS_DEFECTO.fechaRevision) : DATOS_DEFECTO.fechaRevision,
        empresa: empresa || DATOS_DEFECTO.empresa,
        fechaElaboracion: fechaElaboracion || DATOS_DEFECTO.fechaElaboracion,
        filas: filas.length ? filas : DATOS_DEFECTO.filas,
        elaboro,
        autorizo
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = modo === 'edicion'
        ? excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
        : excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
    if (!ws) throw new Error('La plantilla DG-F-05 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    return leerDatosDesdeBuffer(buffer);
}

async function descargarBufferDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        const mime = String(info?.mimeType || '');
        if (mime === 'application/vnd.google-apps.spreadsheet') {
            return driveService.exportarGoogleSheetComoXLSX(fileId);
        }
        return driveService.descargarArchivo(fileId);
    } catch (err) {
        return driveService.descargarArchivo(fileId);
    }
}

async function escribirDatosEnPlantilla(datos) {
    const templateBuffer = await driveService.descargarArchivo(TEMPLATE_DRIVE_ID);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('La plantilla DG-F-05 no contiene hojas.');

    const filaNota = encontrarFilaNota(ws);
    const filasNecesarias = datos.filas.length;
    const filasDisponibles = Math.max(0, filaNota - DATA_START_ROW);

    if (filasNecesarias > filasDisponibles) {
        const extra = filasNecesarias - filasDisponibles;
        ws.spliceRows(filaNota, 0, ...Array.from({ length: extra }, () => []));
    }

    const filaNotaActual = encontrarFilaNota(ws);

    for (let r = DATA_START_ROW; r < filaNotaActual; r++) {
        const row = ws.getRow(r);
        for (let c = COL_TABLA_INICIO; c <= COL_TABLA_FIN; c++) {
            row.getCell(c).value = null;
        }
    }

    const meta = ws.getRow(META_ROW);
    meta.getCell(META_COL.empresa).value = datos.empresa;
    const fechaCell = meta.getCell(META_COL.fecha);
    fechaCell.value = datos.fechaElaboracion ? new Date(`${datos.fechaElaboracion}T12:00:00`) : null;

    datos.filas.forEach((fila, idx) => {
        const row = ws.getRow(DATA_START_ROW + idx);
        asignarTextoSimple(row.getCell(COL.parte), fila.parteInteresada, 'center');
        asignarTextoSimple(row.getCell(COL.tipo), fila.tipo, 'center');
        asignarTextoNecesidades(row.getCell(COL.necesidadesParte), fila.necesidadesParte, 'left');
        asignarTextoNecesidades(row.getCell(COL.necesidadesOrg), fila.necesidadesOrg, 'center');
        asignarTextoSimple(row.getCell(COL.influencia), fila.influencia, 'center');
        asignarTextoMultilinea(row.getCell(COL.razon), fila.razon, 'center');
        asignarTextoMultilinea(row.getCell(COL.seguimiento), fila.seguimiento, 'center');
    });

    aplicarFormatoTablaDatos(ws, datos.filas.length);
    limpiarBordesFilasTablaObsoletas(ws, datos.filas.length, filaNotaActual);
    limpiarBordesColumnaInfluenciaFueraTabla(ws, datos.filas.length);
    reforzarBordeInferiorUltimaFilaTabla(ws, datos.filas.length);
    escribirFirmasEnHoja(ws, datos);
    reforzarBordesComplementarios(ws, datos.filas.length);
    reforzarBordesFirmasDesdePlantilla(ws);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

async function eliminarCopiasDriveTrabajo(excluirId = null) {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const candidatos = (archivos || []).filter((f) => {
        const id = String(f.id || '');
        const name = String(f.name || '').toLowerCase();
        return id && id !== excluirId && name.startsWith(objetivo);
    });

    for (const archivo of candidatos) {
        try {
            await driveService.eliminarArchivo(archivo.id);
        } catch (err) {
            console.warn('[DG-F-05] No se pudo eliminar copia en Drive:', err.message);
        }
    }
}

async function resolverDriveFileId(registro) {
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe) {
            return idDb;
        }
    }

    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || null;
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

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo.toLowerCase()))
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

function formatearFechaCelda(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${Number(d)}/${Number(m)}/${y}`;
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function formatearFechaRevisionDisplay(fechaRevision) {
    const iso = formatearFechaIso(fechaRevision);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function datosAActualizacionesSheet(datos, filasPrevias = 0, sheetTitle = SHEET_TITLE) {
    const actualizaciones = [];
    actualizaciones.push({
        range: rangoSheet(`I${REVISION_ROW}`, sheetTitle),
        values: [[`Revisión: ${datos.revision || '00'}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`I${FECHA_REV_ROW}`, sheetTitle),
        values: [[`Fecha de rev.: ${formatearFechaRevisionDisplay(datos.fechaRevision)}`]]
    });
    actualizaciones.push({
        range: rangoSheet(`C${META_ROW}`, sheetTitle),
        values: [[datos.empresa || '']]
    });
    actualizaciones.push({
        range: rangoSheet(`H${META_ROW}`, sheetTitle),
        values: [[formatearFechaCelda(datos.fechaElaboracion)]]
    });

    const totalFilas = Math.max(datos.filas.length, 1);
    for (let idx = 0; idx < totalFilas; idx++) {
        const fila = datos.filas[idx] || {
            parteInteresada: '',
            tipo: '',
            necesidadesParte: '',
            necesidadesOrg: '',
            influencia: '',
            razon: '',
            seguimiento: ''
        };
        const rowNum = DATA_START_ROW + idx;
        actualizaciones.push({
            range: rangoSheet(`B${rowNum}:G${rowNum}`, sheetTitle),
            values: [[
                fila.parteInteresada,
                fila.tipo,
                textoNecesidadesParaCelda(fila.necesidadesParte),
                textoNecesidadesParaCelda(fila.necesidadesOrg),
                fila.influencia,
                textoMultilineaParaCelda(fila.razon)
            ]]
        });
        actualizaciones.push({
            range: rangoSheet(`H${rowNum}`, sheetTitle),
            values: [[textoMultilineaParaCelda(fila.seguimiento)]]
        });
    }

    return actualizaciones;
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    const actualizaciones = datosAActualizacionesSheet(datos, datos.filas?.length || 0, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await actualizarFirmasEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function aplicarHistorialDgF05(opciones) {
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        contenidoEsEquivalente: datosSonEquivalentes,
        estructuraEsEquivalente: excelHistorial.estructuraFilasEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true
    });
}

async function actualizarFirmasEnGoogleSheet(spreadsheetId, datos, sheetTitle = SHEET_TITLE) {
    const filaFirmas = await driveService.resolverFilaFirmasDgF05(spreadsheetId, sheetTitle);
    if (!filaFirmas) {
        return;
    }

    const filaElaboro = filaFirmas + 1;
    const filaNombre = filaFirmas + FILA_NOMBRE_FIRMA_OFFSET;
    const filaFirma = filaFirmas + FILA_FIRMA_OFFSET;
    await driveService.asegurarMergeElaboroDgF05(spreadsheetId, sheetTitle, filaFirmas);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, [
        {
            range: rangoSheet(`D${filaElaboro}`, sheetTitle),
            values: [[datos.elaboro || '']]
        },
        {
            range: rangoSheet(`E${filaNombre}`, sheetTitle),
            values: [[datos.autorizo || '']]
        },
        {
            range: rangoSheet(`E${filaFirma}`, sheetTitle),
            values: [[TEXTO_FIRMA]]
        }
    ]);
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, filasPrevias = 0, sheetTitle = SHEET_TITLE) {
    const numFilas = Math.max(datos.filas.length, 1);
    const actualizaciones = datosAActualizacionesSheet(datos, filasPrevias, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await actualizarFirmasEnGoogleSheet(spreadsheetId, datos);
    await reforzarFormatoDriveSheet(spreadsheetId, numFilas, filasPrevias);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function reforzarFormatoDriveSheet(fileId, numFilas, filasPrevias = 0) {
    if (!fileId || !numFilas) {
        return;
    }
    try {
        const info = await driveService.obtenerInfoArchivo(fileId).catch(() => null);
        if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await driveService.actualizarCeldasGoogleSheet(fileId, [{
                range: `'${SHEET_TITLE}'!H${HEADER_ROW}`,
                values: [[TEXTO_ENCABEZADO_SEGUIMIENTO]]
            }]);
            await driveService.limpiarBordesTablaDebajoDatosDgF05(
                fileId,
                SHEET_TITLE,
                DATA_START_ROW,
                numFilas,
                filasPrevias
            );
            await driveService.limpiarBordesColumnaInfluenciaFueraTablaDgF05(
                fileId,
                SHEET_TITLE,
                DATA_START_ROW,
                numFilas
            );
            await driveService.aplicarFormatoFilasDgF05(
                fileId,
                SHEET_TITLE,
                DATA_START_ROW,
                numFilas,
                HEADER_ROW
            );
            await driveService.aplicarBordesComplementariosDgF05(
                fileId,
                SHEET_TITLE,
                DATA_START_ROW,
                numFilas,
                HEADER_ROW
            );
        }
    } catch (err) {
        console.warn('[DG-F-05] No se pudo reforzar formato en Google Sheet:', err.message);
    }
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const actualizado = await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
            return actualizado;
        } catch (err) {
            console.warn('[DG-F-05] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[DG-F-05] No se pudo eliminar duplicado en Drive:', err.message);
        }
    }

    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: 'Partes Interesadas', maxColumns: 11, keepSingleSheet: true }
    );
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

function datosSonEquivalentes(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    const driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        const datosDb = await leerDatosRegistro(registro);
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[DG-F-05] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }

    if (!datos) {
        datos = await leerDatosDesdePlantilla();
    }

    if (!registro) {
        const fechaOriginal = datos.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
        registro = {
            fecha_elaboracion_original: fechaOriginal,
            fecha_modificacion_contenido: null,
            contenido_modificado: 0,
            drive_file_id: null,
            ultima_sync_drive: null
        };
    }

    registro = {
        ...registro,
        drive_file_id: driveFileId || null
    };

    return construirRespuesta(registro, datos, archivoDrive);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);

    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original)
        || datos.fechaElaboracion
        || DATOS_DEFECTO.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[DG-F-05] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }
    await eliminarCopiasDriveTrabajo();

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: 'Partes Interesadas', maxColumns: 11, keepSingleSheet: true }
    );
    await reforzarFormatoDriveSheet(archivoDrive.id, datosPublicar.filas.length);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datosPublicar, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        try {
            const plantilla = await leerDatosDesdePlantilla();
            fechaOriginal = plantilla.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
        } catch {
            fechaOriginal = DATOS_DEFECTO.fechaElaboracion;
        }
    }

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

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registroPrevio, datosEntrada, archivoDrive);
    }

    const driveId = registroPrevio?.drive_file_id || null;
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialDgF05({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
                    origen,
                    forzarTipo: body?.tipoCambio || null
                });
                datosGuardar = hist.datosGuardar;

                if (hist.aplicado && origen !== 'consulta') {
                    contenidoModificado = true;
                    fechaModificacion = hist.tipoCambio === 'formato'
                        ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
                        : fechaCambio;
                }

                datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
                    ? fechaModificacion
                    : fechaOriginal;

                const archivoDrive = await driveService
                    .obtenerInfoArchivo(driveId)
                    .catch(() => ({ id: driveId }));
                if (!hist.aplicado) {
                    const filasPrevias = Array.isArray(datosPrevios?.filas) ? datosPrevios.filas.length : 0;
                    await actualizarDatosEnGoogleSheet(driveId, datosGuardar, filasPrevias);
                }
                await guardarRegistroDb(pool, {
                    driveFileId: driveId,
                    datos: datosGuardar,
                    fechaElaboracionOriginal: fechaOriginal,
                    fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                    contenidoModificado
                });
                const registro = await obtenerRegistroDb(pool);
                return construirRespuesta(registro, datosGuardar, archivoDrive);
            }
        } catch (err) {
            console.warn('[DG-F-05] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);
    await reforzarFormatoDriveSheet(archivoDrive.id, datosGuardar.filas.length);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            await driveService.obtenerDimensionesHojaGoogleSheet(archivoDrive.id, SHEET_TITLE)
        ),
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
    if (!registro?.drive_file_id) {
        return cargarFormato(pool);
    }

    const buffer = await descargarBufferDrive(registro.drive_file_id);
    const datosDrive = sanitizarDatos(await leerDatosDesdeBuffer(buffer, { modo: 'edicion' }));

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosDrive.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
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

    const huboCambio = !datosPrevios || !datosSonEquivalentes(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registro.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const fechaCambio = fechaHoyIso();
    const hist = await aplicarHistorialDgF05({
        spreadsheetId: registro.drive_file_id,
        datosPrevios,
        datosNuevos: { ...datosDrive, fechaElaboracion: fechaCambio },
        origen: 'drive'
    });

    const datosGuardar = hist.datosGuardar;
    if (hist.aplicado) {
        contenidoModificado = true;
        fechaModificacion = hist.tipoCambio === 'formato'
            ? (datosGuardar.fechaRevision || excelHistorial.fechaAhoraMexicoIso())
            : fechaCambio;
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    await guardarRegistroDb(pool, {
        driveFileId: registro.drive_file_id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService
        .obtenerInfoArchivo(registro.drive_file_id)
        .catch(() => null);

    return construirRespuesta(registroActualizado, datosGuardar, archivoDrive);
}

async function obtenerEstadoDrive() {
    const registro = null;
    const archivo = await buscarArchivoDriveTrabajo();
    return {
        existe: !!archivo,
        archivo,
        registro
    };
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    asegurarTablaSgcFormatoDatos,
    resetAsegurarTablasSgcFlag,
    sincronizarPersistenciaEstructurada,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    obtenerEstadoDrive,
    sanitizarDatos
};
