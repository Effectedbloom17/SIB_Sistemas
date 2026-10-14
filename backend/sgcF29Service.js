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
// Capacidad base de la plantilla (8–19); se insertan filas si hay más proveedores.
const MAX_FILAS_BASE = 12;
const MAX_FILAS = 80;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS_BASE - 1;
/** Columnas de criterios ya dibujadas en la plantilla (D…); Calificación a la derecha. */
const CRITERIOS_BASE_PLANTILLA = 6;
const ANCHO_COLUMNA_CRITERIO_PX = 90;
const MIN_CRITERIOS_EVALUACION = 3;

// Layout oficial (sin Certificado ISO 9000): A No | B:C Proveedor | D… criterios | Calificación.
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

/** Escalas de puntaje permitidas por criterio. */
const ESCALAS_PUNTAJE = {
    2: [0, 100],
    5: [0, 25, 50, 75, 100],
    6: [0, 20, 40, 60, 80, 100]
};
const PUNTAJES_TODOS = [0, 20, 25, 40, 50, 60, 75, 80, 100];

const CRITERIOS_SISTEMA = [
    {
        clave: 'entregaTiempo',
        nombre: 'Entrega a tiempo',
        escala: 5,
        orden: 1,
        descripciones: {
            '0': 'Del total de entregas nunca se realizó a tiempo',
            '25': 'Del total de entregas casi nunca se realizó a tiempo',
            '50': 'Del total de entregas algunas veces se realizó a tiempo',
            '75': 'Del total de entregas casi siempre se realizó a tiempo',
            '100': 'Del total de entregas siempre se realizó a tiempo'
        }
    },
    {
        clave: 'entregaDomicilio',
        nombre: 'Entrega a Domicilio',
        escala: 5,
        orden: 2,
        descripciones: {
            '0': 'Nunca se realizó entrega a domicilio',
            '25': 'Casi nunca se realizó entrega a domicilio',
            '50': 'Algunas veces se realizó entrega a domicilio',
            '75': 'Casi siempre se realizó entrega a domicilio',
            '100': 'Siempre se realizó entrega a domicilio'
        }
    },
    {
        clave: 'precio',
        nombre: 'Precio',
        escala: 5,
        orden: 3,
        descripciones: {
            '0': 'Muy alto',
            '25': 'Alto',
            '50': 'Regular',
            '75': 'Bueno',
            '100': 'Muy bueno'
        }
    },
    {
        clave: 'pagoTransferencia',
        nombre: 'Pago Transferencia',
        escala: 5,
        orden: 4,
        descripciones: {
            '0': 'No acepta pago por transferencia',
            '25': 'Casi nunca acepta pago por transferencia',
            '50': 'Algunas veces acepta pago por transferencia',
            '75': 'Casi siempre acepta pago por transferencia',
            '100': 'Siempre acepta pago por transferencia'
        }
    },
    {
        clave: 'servicio',
        nombre: 'Calidad del Servicio',
        escala: 5,
        orden: 5,
        descripciones: {
            '0': 'Nunca se atendió para resolver los problemas',
            '25': 'Casi nunca se atendió para resolver los problemas',
            '50': 'Algunas veces se atendió para resolver los problemas',
            '75': 'Casi siempre se atendió para resolver los problemas',
            '100': 'Siempre se atendió para resolver los problemas'
        }
    },
    {
        clave: 'calidad',
        nombre: 'Calidad del producto',
        escala: 5,
        orden: 6,
        descripciones: {
            '0': 'La calidad del producto nunca fue aceptada',
            '25': 'La calidad del producto casi nunca fue aceptada',
            '50': 'La calidad del producto algunas veces fue aceptada',
            '75': 'La calidad del producto casi siempre fue aceptada',
            '100': 'La calidad del producto siempre fue aceptada'
        }
    }
];

const CLAVES_SISTEMA = CRITERIOS_SISTEMA.map((c) => c.clave);

function normalizarEscala(valor) {
    const n = Number(valor);
    if (n === 2 || n === 6) return n;
    return 5;
}

function valoresEscala(escala) {
    return ESCALAS_PUNTAJE[normalizarEscala(escala)] || ESCALAS_PUNTAJE[5];
}

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

const HEADERS_FIJOS = [
    [COLUMNAS.no, 'No.'],
    [COLUMNAS.proveedor, 'Proveedor']
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
    accion: '',
    referencia: '',
    fecha: '',
    entregaTiempo: '',
    entregaDomicilio: '',
    precio: '',
    pagoTransferencia: '',
    servicio: '',
    calidad: '',
    puntajes: {},
    criteriosUsados: [...CLAVES_SISTEMA],
    calificacion: '',
    evaluador: ''
};

function slugCriterio(texto) {
    const base = String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return base || `criterio_${Date.now().toString(36)}`;
}

function sanitizarDescripcionesEscala(raw, escala) {
    const vals = valoresEscala(escala);
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const n of vals) {
        const k = String(n);
        const v = String(src[k] ?? src[n] ?? '').trim().slice(0, 200);
        if (v) out[k] = v;
    }
    return out;
}

function sanitizarCriterioCatalogo(raw, idx = 0) {
    const clave = String(raw?.clave || '').trim().slice(0, 64);
    const nombre = String(
        raw?.nombre || raw?.largo || raw?.corto || raw?.etiquetaLarga || raw?.etiquetaCorta || ''
    ).trim().slice(0, 80);
    if (!clave || !nombre) return null;
    const escala = normalizarEscala(raw?.escala);
    const descripciones = sanitizarDescripcionesEscala(raw?.descripciones, escala);
    return {
        clave,
        nombre,
        corto: nombre,
        largo: nombre,
        escala,
        valores: valoresEscala(escala).map(String),
        esSistema: !!(raw?.esSistema ?? raw?.es_sistema),
        activo: raw?.activo !== false && raw?.activo !== 0,
        orden: Number(raw?.orden) || (idx + 1),
        descripciones: Object.keys(descripciones).length ? descripciones : null
    };
}

async function asegurarColumnaCriterios(pool, columna, ddl) {
    try {
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'sgc_f29_criterios'
               AND COLUMN_NAME = ?`,
            [columna]
        );
        if (!cols?.length) {
            await pool.query(`ALTER TABLE sgc_f29_criterios ADD COLUMN ${ddl}`);
        }
    } catch (err) {
        console.warn(`[SGC-F-29] No se pudo asegurar columna ${columna}:`, err.message);
    }
}

async function asegurarTablaCriterios(pool) {
    if (!pool) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_f29_criterios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            clave VARCHAR(64) NOT NULL,
            corto VARCHAR(80) NOT NULL,
            largo VARCHAR(80) NOT NULL,
            escala TINYINT NOT NULL DEFAULT 5,
            es_sistema TINYINT(1) NOT NULL DEFAULT 0,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            orden INT NOT NULL DEFAULT 100,
            descripciones_json LONGTEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_sgc_f29_criterios_clave (clave)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await asegurarColumnaCriterios(pool, 'escala', 'escala TINYINT NOT NULL DEFAULT 5');
    for (const c of CRITERIOS_SISTEMA) {
        await pool.query(
            `INSERT IGNORE INTO sgc_f29_criterios
                (clave, corto, largo, escala, es_sistema, activo, orden, descripciones_json)
             VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
            [
                c.clave,
                c.nombre,
                c.nombre,
                normalizarEscala(c.escala),
                c.orden,
                JSON.stringify(c.descripciones || {})
            ]
        );
    }
}

async function listarCriterios(pool) {
    await asegurarTablaCriterios(pool);
    const [rows] = await pool.query(
        `SELECT clave, corto, largo, escala, es_sistema, activo, orden, descripciones_json
         FROM sgc_f29_criterios
         WHERE activo = 1
         ORDER BY orden ASC, id ASC`
    );
    const lista = (rows || []).map((r, idx) => {
        let descripciones = null;
        try {
            const raw = r.descripciones_json;
            descripciones = typeof raw === 'string' ? JSON.parse(raw) : (raw || null);
        } catch {
            descripciones = null;
        }
        return sanitizarCriterioCatalogo({
            clave: r.clave,
            nombre: r.largo || r.corto,
            corto: r.corto,
            largo: r.largo,
            escala: r.escala,
            esSistema: !!r.es_sistema,
            activo: !!r.activo,
            orden: r.orden,
            descripciones
        }, idx);
    }).filter(Boolean);
    return lista.length ? lista : CRITERIOS_SISTEMA.map((c, i) => sanitizarCriterioCatalogo({
        clave: c.clave,
        nombre: c.nombre,
        escala: c.escala,
        descripciones: c.descripciones,
        esSistema: true,
        activo: true,
        orden: c.orden
    }, i));
}

async function crearCriterio(pool, body = {}) {
    await asegurarTablaCriterios(pool);
    const nombre = String(
        body.nombre || body.largo || body.corto || body.etiquetaLarga || body.etiquetaCorta || ''
    ).trim().slice(0, 80);
    if (!nombre) {
        const err = new Error('Indica el nombre del criterio.');
        err.statusCode = 400;
        throw err;
    }
    const escala = normalizarEscala(body.escala);
    const valores = valoresEscala(escala);
    const descripciones = sanitizarDescripcionesEscala(body.descripciones, escala);
    for (const n of valores) {
        if (!descripciones[String(n)]) {
            const err = new Error(`Registra la descripción del valor ${n}%.`);
            err.statusCode = 400;
            throw err;
        }
    }
    let clave = slugCriterio(nombre);
    if (CLAVES_SISTEMA.includes(clave) || clave.length < 2) {
        clave = `${clave}_${crypto.randomBytes(3).toString('hex')}`;
    }
    const [existentes] = await pool.query(
        'SELECT clave FROM sgc_f29_criterios WHERE clave = ? OR LOWER(largo) = LOWER(?) OR LOWER(corto) = LOWER(?) LIMIT 1',
        [clave, nombre, nombre]
    );
    if (existentes?.length) {
        const err = new Error('Ya existe un criterio con ese nombre.');
        err.statusCode = 409;
        throw err;
    }
    const [maxOrd] = await pool.query('SELECT COALESCE(MAX(orden), 0) AS m FROM sgc_f29_criterios');
    const orden = Number(maxOrd?.[0]?.m || 0) + 1;
    await pool.query(
        `INSERT INTO sgc_f29_criterios
            (clave, corto, largo, escala, es_sistema, activo, orden, descripciones_json)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
        [clave, nombre, nombre, escala, orden, JSON.stringify(descripciones)]
    );
    return listarCriterios(pool);
}

function puntajeDeItem(item, clave) {
    if (!item) return '';
    if (item.puntajes && typeof item.puntajes === 'object' && item.puntajes[clave] != null) {
        return parsearPuntaje(item.puntajes[clave]);
    }
    if (CLAVES_SISTEMA.includes(clave) && item[clave] != null) {
        return parsearPuntaje(item[clave]);
    }
    return '';
}

/**
 * Columnas de criterios para Excel: catálogo + claves usadas en datos.
 * Garantiza al menos los criterios base de plantilla.
 */
function resolverCriteriosParaExcel(proveedores, catalogo) {
    const cat = Array.isArray(catalogo) && catalogo.length
        ? catalogo.map((c, i) => sanitizarCriterioCatalogo(c, i)).filter(Boolean)
        : CRITERIOS_SISTEMA.map((c, i) => sanitizarCriterioCatalogo({ ...c, esSistema: true }, i));
    const porClave = new Map(cat.map((c) => [c.clave, c]));
    const usadas = new Set();
    for (const p of (Array.isArray(proveedores) ? proveedores : [])) {
        for (const clave of CLAVES_SISTEMA) {
            if (puntajeDeItem(p, clave)) usadas.add(clave);
        }
        const extra = p?.puntajes && typeof p.puntajes === 'object' ? p.puntajes : {};
        for (const [k, v] of Object.entries(extra)) {
            if (parsearPuntaje(v)) usadas.add(k);
        }
    }
    const ordenados = [];
    const pushClave = (clave) => {
        if (ordenados.some((c) => c.clave === clave)) return;
        const known = porClave.get(clave);
        if (known) {
            ordenados.push(known);
            return;
        }
        ordenados.push(sanitizarCriterioCatalogo({
            clave,
            corto: clave,
            largo: clave,
            esSistema: false,
            activo: true,
            orden: 900 + ordenados.length
        }, ordenados.length));
    };
    // Plantilla base (sistema) + solo criterios personalizados que se usaron en alguna evaluación.
    for (const c of CRITERIOS_SISTEMA) pushClave(c.clave);
    for (const k of usadas) {
        if (!CLAVES_SISTEMA.includes(k)) pushClave(k);
    }
    // Mantener al menos CRITERIOS_BASE_PLANTILLA columnas (plantilla).
    while (ordenados.length < CRITERIOS_BASE_PLANTILLA && ordenados.length < CRITERIOS_SISTEMA.length) {
        pushClave(CRITERIOS_SISTEMA[ordenados.length].clave);
    }
    return ordenados;
}

function layoutColumnasDesdeCriterios(criterios) {
    const n = Math.max(CRITERIOS_BASE_PLANTILLA, (criterios || []).length);
    const criterioInicio = COLUMNAS.entregaTiempo; // D = 4
    return {
        no: COLUMNAS.no,
        proveedor: COLUMNAS.proveedor,
        proveedorSpan: COLUMNAS.proveedorSpan,
        criterioInicio,
        criterios: (criterios || []).map((c, i) => ({
            ...c,
            col: criterioInicio + i
        })),
        numCriterios: n,
        calificacion: criterioInicio + n
    };
}

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

function parsearPuntaje(valor, escala = null) {
    const crudo = String(valor ?? '').trim().replace('%', '').replace(',', '.');
    if (!crudo || /^n\/?a$/i.test(crudo)) return '';
    let n = Number(crudo);
    if (!Number.isFinite(n)) return '';
    if (n > 0 && n <= 1) n = n * 100;
    n = Math.round(n);
    const permitidos = escala != null ? valoresEscala(escala) : PUNTAJES_TODOS;
    if (permitidos.includes(n)) return String(n);
    let mejor = permitidos[0] ?? 0;
    let dist = Math.abs(n - mejor);
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
    const puntajes = item?.puntajes && typeof item.puntajes === 'object' ? item.puntajes : {};
    const claves = new Set([
        ...CLAVES_SISTEMA,
        ...Object.keys(puntajes)
    ]);
    const vals = [...claves]
        .map((k) => puntajeDeItem(item, k))
        .filter((v) => v !== '')
        .map(Number);
    if (!vals.length) return '';
    return String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
}

function textoEvaluador(item) {
    return String(item?.evaluador || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function proveedorEstaOculto(item) {
    return item?.oculto === true
        || item?.oculto === 1
        || String(item?.oculto || '').toLowerCase() === 'true';
}

function sanitizarCriteriosUsados(item, puntajes) {
    const raw = Array.isArray(item?.criteriosUsados) ? item.criteriosUsados : null;
    let usados = (raw || [])
        .map((k) => String(k || '').trim().slice(0, 64))
        .filter(Boolean);
    if (!usados.length) {
        usados = Object.keys(puntajes || {}).filter((k) => puntajes[k] !== '');
    }
    if (!usados.length) {
        usados = [...CLAVES_SISTEMA];
    }
    // Conserva solo claves únicas, mín. 3 si hay menos se dejan (validación UI).
    return [...new Set(usados)].slice(0, 40);
}

function sanitizarProveedor(item) {
    const idExistente = String(item?.id || '').trim().slice(0, 64);
    const puntajes = {};
    const extra = item?.puntajes && typeof item.puntajes === 'object' ? item.puntajes : {};
    for (const clave of CLAVES_SISTEMA) {
        const v = parsearPuntaje(extra[clave] ?? item?.[clave]);
        if (v !== '') puntajes[clave] = v;
    }
    for (const [k, raw] of Object.entries(extra)) {
        if (CLAVES_SISTEMA.includes(k)) continue;
        const clave = String(k || '').trim().slice(0, 64);
        if (!clave) continue;
        const v = parsearPuntaje(raw);
        if (v !== '') puntajes[clave] = v;
    }
    const criteriosUsados = sanitizarCriteriosUsados(item, puntajes);
    // Solo puntajes de criterios en uso cuentan para la evaluación.
    const puntajesFiltrados = {};
    for (const k of criteriosUsados) {
        if (puntajes[k] != null && puntajes[k] !== '') {
            puntajesFiltrados[k] = puntajes[k];
        }
    }
    // Conserva valores de criterios no usados por compatibilidad, pero calificación usa los activos.
    const base = {
        id: idExistente,
        proveedor: String(item?.proveedor || '').trim(),
        accion: String(item?.accion || '').trim().slice(0, 160),
        referencia: String(item?.referencia || '').trim().slice(0, 120),
        fecha: formatearFechaIso(item?.fecha) || '',
        entregaTiempo: puntajes.entregaTiempo || '',
        entregaDomicilio: puntajes.entregaDomicilio || '',
        precio: puntajes.precio || '',
        pagoTransferencia: puntajes.pagoTransferencia || '',
        servicio: puntajes.servicio || '',
        calidad: puntajes.calidad || '',
        puntajes,
        criteriosUsados,
        calificacion: '',
        oculto: proveedorEstaOculto(item),
        evaluador: textoEvaluador(item)
    };
    const auto = calcularCalificacion({ ...base, puntajes: puntajesFiltrados });
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
                accion: fila.accion || mismoIdx.accion || '',
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
                accion: fila.accion || matchNombre.accion || '',
                referencia: fila.referencia || matchNombre.referencia || '',
                fecha: fila.fecha || matchNombre.fecha || ''
            };
        }
        return fila;
    });
}

/**
 * La visibilidad no se pierde al guardar el formato ni al leer la hoja.
 * Ocultar (oculto: true) sí se acepta desde el cliente.
 * Restaurar solo lo hace establecerVisibilidadProveedor.
 * Las filas ocultas que no vienen en la hoja se reincorporan.
 */
function conservarOcultos(anteriores, nuevos) {
    const prev = Array.isArray(anteriores) ? anteriores : [];
    const next = Array.isArray(nuevos) ? nuevos : [];
    const prevPorId = new Map();
    for (const p of prev) {
        const id = String(p?.id || '').trim();
        if (id) prevPorId.set(id, p);
    }
    const usados = new Set();
    const salida = next.map((fila) => {
        const id = String(fila?.id || '').trim();
        const anterior = id ? prevPorId.get(id) : null;
        if (id) usados.add(id);
        const oculto = proveedorEstaOculto(anterior) || proveedorEstaOculto(fila);
        return { ...fila, oculto };
    });
    for (const p of prev) {
        if (!proveedorEstaOculto(p)) continue;
        const id = String(p?.id || '').trim();
        if (id && usados.has(id)) continue;
        salida.push({ ...p, oculto: true });
    }
    return salida;
}

/** El nombre no vive en la hoja. Si el guardado o Drive no lo traen, se conserva el anterior. */
function conservarEvaluador(anteriores, nuevos) {
    const prev = Array.isArray(anteriores) ? anteriores : [];
    const next = Array.isArray(nuevos) ? nuevos : [];
    const prevPorId = new Map();
    for (const p of prev) {
        const id = String(p?.id || '').trim();
        if (id) prevPorId.set(id, p);
    }
    return next.map((fila) => {
        const id = String(fila?.id || '').trim();
        const anterior = id ? prevPorId.get(id) : null;
        return {
            ...fila,
            evaluador: textoEvaluador(fila) || textoEvaluador(anterior)
        };
    });
}

function asegurarIdsProveedores(lista) {
    return (Array.isArray(lista) ? lista : []).map((fila) => (
        fila?.id ? fila : { ...fila, id: generarIdEvaluacion() }
    ));
}

/** Las filas ocultas no ocupan cupo de la hoja; siguen guardadas en el JSON. */
function recortarProveedoresVisibles(lista) {
    const salida = [];
    let visibles = 0;
    for (const fila of (Array.isArray(lista) ? lista : [])) {
        if (proveedorEstaOculto(fila)) {
            salida.push({ ...fila, oculto: true });
            continue;
        }
        if (visibles >= MAX_FILAS) continue;
        visibles += 1;
        salida.push({ ...fila, oculto: false });
    }
    return salida;
}

/** La hoja oficial solo muestra proveedores visibles. */
function datosParaHoja(datos) {
    const d = sanitizarDatos({
        ...datos,
        fechaEvaluacion: fechaEvaluacionRegistro(datos)
    });
    return {
        ...d,
        proveedores: (d.proveedores || []).filter((p) => !proveedorEstaOculto(p))
    };
}

function esProveedorVacio(item) {
    const p = sanitizarProveedor(item);
    const tienePuntaje = Object.keys(p.puntajes || {}).length > 0;
    return !p.proveedor && !tienePuntaje && !p.calificacion;
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
        proveedores: recortarProveedoresVisibles(
            asegurarIdsProveedores(
                proveedores
                    .map(sanitizarProveedor)
                    .filter((p) => !esProveedorVacio(p) && !pareceNotaPlantilla(p.proveedor))
            )
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

function mapearHeaderAClaveCriterio(texto) {
    const t = String(texto || '').trim().toLowerCase();
    if (!t || t === 'n/a' || t.includes('calific')) return null;
    for (const c of CRITERIOS_SISTEMA) {
        const nombre = String(c.nombre || '').toLowerCase();
        if (t === nombre) return c.clave;
        if (nombre && t.includes(nombre) && c.clave !== 'calidad') return c.clave;
    }
    if (t.includes('producto')) return 'calidad';
    if (t.includes('servicio')) return 'servicio';
    if (t.includes('transfer')) return 'pagoTransferencia';
    if (t.includes('precio')) return 'precio';
    if (t.includes('domicilio')) return 'entregaDomicilio';
    if (t.includes('tiempo') || t === 'entrega') return 'entregaTiempo';
    return slugCriterio(texto);
}

function leerFilaProveedorDesdeCeldas(getValor, cols, criteriosCols = null) {
    if (Array.isArray(criteriosCols) && criteriosCols.length) {
        const puntajes = {};
        for (const c of criteriosCols) {
            const raw = getValor(c.col);
            if (/^n\/?a$/i.test(String(raw || '').trim())) continue;
            const v = parsearPuntaje(raw);
            if (v !== '') puntajes[c.clave] = v;
        }
        return sanitizarProveedor({
            proveedor: getValor(cols.proveedor),
            puntajes,
            calificacion: getValor(cols.calificacion)
        });
    }
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

function detectarCriteriosDesdeHeader(ws) {
    const headerRow = ws.getRow(HEADER_ROW);
    const criterios = [];
    let calificacionCol = null;
    for (let col = COLUMNAS.entregaTiempo; col <= COLUMNAS.entregaTiempo + 40; col++) {
        const texto = celdaATexto(headerRow.getCell(col).value);
        if (!texto) {
            if (criterios.length) break;
            continue;
        }
        if (/calific/i.test(texto)) {
            calificacionCol = col;
            break;
        }
        const clave = mapearHeaderAClaveCriterio(texto);
        if (clave) {
            criterios.push({ clave, largo: texto, corto: texto, col });
        }
    }
    return {
        criterios,
        calificacionCol: calificacionCol || (COLUMNAS.entregaTiempo + Math.max(CRITERIOS_BASE_PLANTILLA, criterios.length))
    };
}

function leerProveedoresDesdeHoja(ws) {
    const headerC = celdaATexto(ws.getRow(HEADER_ROW).getCell(3).value);
    const headerD = celdaATexto(ws.getRow(HEADER_ROW).getCell(4).value);
    const headerI = celdaATexto(ws.getRow(HEADER_ROW).getCell(9).value);
    const cols = resolverColumnasDesdeHeaders(headerC, headerD, headerI);
    const dinamicos = detectarCriteriosDesdeHeader(ws);
    const colsEff = {
        ...cols,
        calificacion: dinamicos.calificacionCol || cols.calificacion
    };
    const maxScan = Math.max(DATA_END_ROW, DATA_START_ROW + MAX_FILAS - 1);
    const proveedores = [];
    for (let r = DATA_START_ROW; r <= maxScan; r++) {
        const row = ws.getRow(r);
        const proveedorTxt = celdaATexto(row.getCell(colsEff.proveedor).value);
        if (pareceNotaPlantilla(proveedorTxt)) break;
        const fila = leerFilaProveedorDesdeCeldas(
            (col) => celdaATexto(row.getCell(col).value),
            colsEff,
            dinamicos.criterios.length ? dinamicos.criterios : null
        );
        if (!esProveedorVacio(fila)) {
            proveedores.push(fila);
        } else if (!proveedorTxt && proveedores.length) {
            // hueco tras datos: sigue escaneando unas filas por si hay más
            continue;
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

function escribirFilaProveedor(row, item, indice, conDatos, layout) {
    const lay = layout || layoutColumnasDesdeCriterios(CRITERIOS_SISTEMA);
    const maxCol = lay.calificacion + 2;
    if (!conDatos) {
        for (let col = 1; col <= maxCol; col++) {
            limpiarCelda(row, col, col === lay.proveedor ? 'left' : 'center');
        }
        return;
    }
    const p = sanitizarProveedor(item);
    asignarTextoSimple(row.getCell(lay.no), String(indice + 1), 'center');
    asignarTextoSimple(row.getCell(lay.proveedor), p.proveedor, 'left');
    limpiarCelda(row, lay.proveedorSpan, 'left');
    for (const c of lay.criterios) {
        const v = puntajeDeItem(p, c.clave);
        asignarTextoSimple(row.getCell(c.col), v !== '' ? v : 'N/A', 'center');
    }
    // Relleno N/A en columnas base de plantilla no cubiertas por criterios listados.
    for (let i = lay.criterios.length; i < lay.numCriterios; i++) {
        asignarTextoSimple(row.getCell(lay.criterioInicio + i), 'N/A', 'center');
    }
    asignarTextoSimple(row.getCell(lay.calificacion), p.calificacion || 'N/A', 'center');
    for (let col = lay.calificacion + 1; col <= maxCol; col++) {
        limpiarCelda(row, col);
    }
}

function escribirProveedoresEnHoja(ws, proveedoresRaw, layout) {
    const proveedores = Array.isArray(proveedoresRaw) ? proveedoresRaw : [];
    const totalFilas = Math.max(MAX_FILAS_BASE, proveedores.length);
    for (let i = 0; i < totalFilas; i++) {
        const rowNum = DATA_START_ROW + i;
        asegurarMergeProveedorFila(ws, rowNum);
        const conDatos = i < proveedores.length;
        const fila = conDatos ? proveedores[i] : { ...PROVEEDOR_DEFECTO };
        escribirFilaProveedor(ws.getRow(rowNum), fila, i, conDatos, layout);
    }
}

function escribirEncabezadosTabla(ws, layout) {
    const lay = layout || layoutColumnasDesdeCriterios(CRITERIOS_SISTEMA);
    const row = ws.getRow(HEADER_ROW);
    asegurarMergeProveedorFila(ws, HEADER_ROW);
    for (const [col, texto] of HEADERS_FIJOS) {
        asignarTextoSimple(row.getCell(col), texto, 'center');
    }
    limpiarCelda(row, lay.proveedorSpan, 'center');
    for (let i = 0; i < lay.numCriterios; i++) {
        const crit = lay.criterios[i];
        const texto = crit?.nombre || crit?.largo || crit?.corto || '';
        asignarTextoSimple(row.getCell(lay.criterioInicio + i), texto, 'center');
    }
    asignarTextoSimple(row.getCell(lay.calificacion), 'Calificación', 'center');
    for (let col = lay.calificacion + 1; col <= lay.calificacion + 2; col++) {
        limpiarCelda(row, col, 'center');
    }
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

function escribirDatosEnHoja(ws, datos, catalogo = null) {
    const d = datosParaHoja(datos);
    const criterios = resolverCriteriosParaExcel(d.proveedores, catalogo);
    const layout = layoutColumnasDesdeCriterios(criterios);
    escribirMetaEnHoja(ws, d);
    escribirEncabezadosTabla(ws, layout);
    escribirProveedoresEnHoja(ws, d.proveedores, layout);
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

function datosAActualizacionesSheet(datos, sheetTitle, catalogo = null) {
    const d = datosParaHoja(datos);
    const criterios = resolverCriteriosParaExcel(d.proveedores, catalogo);
    const layout = layoutColumnasDesdeCriterios(criterios);
    const actualizaciones = [];
    const fechaTxt = fechaParaSheet(d.fechaEvaluacion) || '';
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.periodo)}${META_ROW}`, sheetTitle),
        values: [[d.periodoEvaluacion || '']]
    });
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.fechaLabel)}${META_ROW}`, sheetTitle),
        values: [['Fecha de la evaluación:']]
    });
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(META_COLS.fechaEvaluacion)}${META_ROW}`, sheetTitle),
        values: [[fechaTxt]]
    });
    for (const [col, texto] of HEADERS_FIJOS) {
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(col)}${HEADER_ROW}`, sheetTitle),
            values: [[texto]]
        });
    }
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(layout.proveedorSpan)}${HEADER_ROW}`, sheetTitle),
        values: [['']]
    });
    for (let i = 0; i < layout.numCriterios; i++) {
        const crit = layout.criterios[i];
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(layout.criterioInicio + i)}${HEADER_ROW}`, sheetTitle),
            values: [[crit?.nombre || crit?.largo || crit?.corto || '']]
        });
    }
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(layout.calificacion)}${HEADER_ROW}`, sheetTitle),
        values: [['Calificación']]
    });
    const totalFilas = Math.max(MAX_FILAS_BASE, d.proveedores.length);
    for (let i = 0; i < totalFilas; i++) {
        const rowNum = DATA_START_ROW + i;
        const conDatos = i < d.proveedores.length;
        const p = conDatos ? sanitizarProveedor(d.proveedores[i]) : { ...PROVEEDOR_DEFECTO };
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(layout.no)}${rowNum}`, sheetTitle),
            values: [[conDatos ? String(i + 1) : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(layout.proveedor)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.proveedor || '') : '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(layout.proveedorSpan)}${rowNum}`, sheetTitle),
            values: [['']]
        });
        for (let ci = 0; ci < layout.numCriterios; ci++) {
            const crit = layout.criterios[ci];
            let valor = '';
            if (conDatos) {
                const v = crit ? puntajeDeItem(p, crit.clave) : '';
                valor = v !== '' ? v : 'N/A';
            }
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(layout.criterioInicio + ci)}${rowNum}`, sheetTitle),
                values: [[valor]]
            });
        }
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(layout.calificacion)}${rowNum}`, sheetTitle),
            values: [[conDatos ? (p.calificacion || 'N/A') : '']]
        });
    }
    return actualizaciones;
}

async function contarCriteriosActualesEnSheet(spreadsheetId, sheetTitle) {
    try {
        const rango = `'${sheetTitle}'!${columnaALetra(COLUMNAS.entregaTiempo)}${HEADER_ROW}:${columnaALetra(COLUMNAS.entregaTiempo + 40)}${HEADER_ROW}`;
        const valores = await driveService.leerRangoGoogleSheet(spreadsheetId, rango);
        const fila = Array.isArray(valores?.[0]) ? valores[0] : [];
        let n = 0;
        for (const celda of fila) {
            const t = String(celda || '').trim();
            if (!t) break;
            if (/calific/i.test(t)) break;
            n += 1;
        }
        return n || CRITERIOS_BASE_PLANTILLA;
    } catch {
        return CRITERIOS_BASE_PLANTILLA;
    }
}

async function asegurarEstructuraHojaDrive(spreadsheetId, sheetTitle, datos, catalogo) {
    if (!spreadsheetId || !sheetTitle) return null;
    const d = datosParaHoja(datos);
    const criterios = resolverCriteriosParaExcel(d.proveedores, catalogo);
    const layout = layoutColumnasDesdeCriterios(criterios);
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId).catch(() => []);
    const hoja = (meta || []).find((h) => String(h.title || '').trim() === String(sheetTitle).trim());
    if (!hoja) return layout;

    const criteriosActuales = await contarCriteriosActualesEnSheet(spreadsheetId, sheetTitle);
    const extraCols = Math.max(0, layout.numCriterios - criteriosActuales);
    if (extraCols > 0 && typeof driveService.insertarColumnasGoogleSheet === 'function') {
        // Insertar justo antes de Calificación actual (tras los criterios existentes).
        const startIndex = (COLUMNAS.entregaTiempo - 1) + criteriosActuales; // 0-based
        try {
            await driveService.insertarColumnasGoogleSheet(
                spreadsheetId,
                hoja.sheetId,
                startIndex,
                extraCols,
                { inheritFromBefore: true, pixelSize: ANCHO_COLUMNA_CRITERIO_PX }
            );
        } catch (err) {
            console.warn('[SGC-F-29] No se pudieron insertar columnas de criterios:', err.message);
        }
    }

    const filasNecesarias = Math.max(MAX_FILAS_BASE, d.proveedores.length);
    let filasDisponibles = MAX_FILAS_BASE;
    try {
        const dims = await driveService.obtenerDimensionesHojaGoogleSheet(spreadsheetId, sheetTitle);
        const rowCount = Number(dims?.rowCount) || 0;
        if (rowCount > DATA_START_ROW) {
            filasDisponibles = Math.max(MAX_FILAS_BASE, rowCount - (DATA_START_ROW - 1) - 1);
        }
    } catch {
        /* usar base */
    }
    const extraFilas = Math.max(0, filasNecesarias - filasDisponibles);
    if (extraFilas > 0 && typeof driveService.insertarFilasGoogleSheet === 'function') {
        try {
            await driveService.insertarFilasGoogleSheet(
                spreadsheetId,
                hoja.sheetId,
                DATA_START_ROW + filasDisponibles - 1,
                extraFilas,
                { inheritFromBefore: true }
            );
        } catch (err) {
            console.warn('[SGC-F-29] No se pudieron insertar filas de proveedores:', err.message);
        }
    }
    return layout;
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

async function aplicarFormatoVisualSgcF29(spreadsheetId, sheetTitle, datos, catalogo = null) {
    if (!spreadsheetId || !sheetTitle) return;
    const d = datosParaHoja(datos);
    const criterios = resolverCriteriosParaExcel(d.proveedores, catalogo);
    const layout = layoutColumnasDesdeCriterios(criterios);
    const numFilas = Math.max(d.proveedores.length, 1);
    const filaMax = DATA_START_ROW + Math.max(MAX_FILAS_BASE, d.proveedores.length) - 1;
    try {
        await driveService.aplicarFormatoFilasSgcF29(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            filaMax,
            {
                numCriterios: layout.numCriterios,
                colCalificacion: layout.calificacion
            }
        );
    } catch (err) {
        console.warn('[SGC-F-29] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle, catalogo = null) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    let cat = catalogo;
    await asegurarEstructuraHojaDrive(spreadsheetId, titulo, datos, cat);
    const actualizaciones = datosAActualizacionesSheet(datos, titulo, cat);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF29(spreadsheetId, titulo, datos, cat);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos, catalogo = null) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle, catalogo);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA, catalogo = null) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-29 no contiene hojas.');
    escribirDatosEnHoja(ws, datos, catalogo);
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
        escribirSnapshotEnHoja: (spreadsheetId, sheetTitle, datos) =>
            escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos, opciones.catalogo || null),
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
                result.datosGuardar,
                opciones.catalogo || null
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

async function obtenerResumenProveedores(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    let lista = (datos.proveedores || []).map((p, idx) => {
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
            aprobado: Number.isFinite(calif) ? calif >= 80 : false,
            oculto: proveedorEstaOculto(p)
        };
    });
    const incluirOcultos = !!opciones.soloOcultos;
    lista = lista.filter((p) => (incluirOcultos ? p.oculto : !p.oculto));
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
    const fusionados = fusionarIdsProveedores(
        datosPrevios?.proveedores || [],
        Array.isArray(rawBody.proveedores) ? rawBody.proveedores : []
    );
    const proveedoresVisibles = options.aplicarVisibilidadCliente
        ? fusionados
        : conservarOcultos(datosPrevios?.proveedores || [], fusionados);
    const proveedoresEntrada = conservarEvaluador(
        datosPrevios?.proveedores || [],
        proveedoresVisibles
    );
    const datosEntrada = sanitizarDatos({
        ...rawBody,
        fechaEvaluacion: fechaEvaluacionRegistro(rawBody),
        proveedores: proveedoresEntrada
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
    const catalogoCriterios = await listarCriterios(pool).catch(() => CRITERIOS_SISTEMA);

    if (!huboCambio && driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        const hojaDestino = await resolverTituloHojaTrabajo(driveId);
        await actualizarDatosEnGoogleSheet(driveId, datosEntrada, hojaDestino, catalogoCriterios);
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
                forzarTipo: body?.tipoCambio || null,
                catalogo: catalogoCriterios
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
                await actualizarDatosEnGoogleSheet(driveId, datosGuardar, hojaDestino, catalogoCriterios);
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

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA, catalogoCriterios);
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
        proveedores: conservarEvaluador(
            datosPrevios?.proveedores || [],
            conservarOcultos(
                datosPrevios?.proveedores || [],
                fusionarIdsProveedores(
                    datosPrevios?.proveedores || [],
                    Array.isArray(leidos?.proveedores) ? leidos.proveedores : []
                )
            )
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

async function listarProveedoresOcultos(pool) {
    const resumen = await obtenerResumenProveedores(pool, { soloOcultos: true });
    return {
        total: resumen.total,
        totalProveedoresUnicos: resumen.totalProveedoresUnicos,
        proveedoresAgrupados: resumen.proveedoresAgrupados || []
    };
}

async function establecerVisibilidadProveedor(pool, nombre, oculto) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const clave = String(nombre || '').trim().toLowerCase();
    if (!clave) {
        const err = new Error('Indica el proveedor.');
        err.statusCode = 400;
        throw err;
    }
    let encontrados = 0;
    const proveedores = (datos.proveedores || []).map((p) => {
        if (String(p?.proveedor || '').trim().toLowerCase() !== clave) return p;
        encontrados += 1;
        return { ...p, oculto: !!oculto };
    });
    if (!encontrados) {
        const err = new Error('No se encontró el proveedor.');
        err.statusCode = 404;
        throw err;
    }
    return guardarFormato(pool, {
        datos: { ...datos, proveedores },
        origen: 'sistema'
    }, { aplicarVisibilidadCliente: true });
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    obtenerResumenProveedores,
    listarProveedoresOcultos,
    establecerVisibilidadProveedor,
    listarCriterios,
    crearCriterio,
    asegurarTablaCriterios,
    MIN_CRITERIOS_EVALUACION
};
