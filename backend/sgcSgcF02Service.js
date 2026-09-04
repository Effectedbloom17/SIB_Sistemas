/**
 * SGC-F-02 · Solicitud de cambios a documentos — persistencia en biznaga_sgc y sync con Drive.
 *
 * Cabecera de solicitante + tabla de documentos (alta/baja/modificación) + firmas SOLICITA/AUTORIZA.
 * Plantilla: Google Sheet 1HIOltlUF0O9zxZ6tedSSCZgzuG0eSw45iHe3IKdF9xQ (Rev 00 · 01-08-24).
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-02';
const TEMPLATE_DRIVE_ID = '1HIOltlUF0O9zxZ6tedSSCZgzuG0eSw45iHe3IKdF9xQ';
const DRIVE_FILE_ID_SISTEMA = '1HIOltlUF0O9zxZ6tedSSCZgzuG0eSw45iHe3IKdF9xQ';
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
/** Carpeta Drive «Documentos Físicos» (PDF / JPG / JPEG). */
const CARPETA_DOCS_FISICOS_ID = '1_uR6M7nJyKNUYv5NK43jklzJF06TDith';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-02 Solicitud de cambios a documentos (sistema)';
const SHEET_TITLE = 'Solicitud';
const MIME_DOCS_FISICOS = new Set(['application/pdf', 'image/jpeg']);
const EXT_DOCS_FISICOS = new Set(['pdf', 'jpg', 'jpeg']);
const MAX_DOC_FISICO_MB = 15;

const HEADER_ROW = 9;
const DATA_START_ROW = 10;
const MAX_FILAS = 30;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;
const MAX_COLUMNAS_SISTEMA = 13;

const REVISION_CELL = { row: 2, col: 12 };
const FECHA_REV_CELL = { row: 3, col: 12 };

const SOLICITANTE = {
    fechaSolicitud: { row: 6, col: 1 },
    nombreSolicitante: { row: 6, col: 3 },
    puestoSolicitante: { row: 6, col: 8 },
    areaDepartamento: { row: 6, col: 10 }
};

const COLUMNAS = {
    no: 1,              // A
    nombreDocumento: 2, // B (B:D)
    codigo: 5,          // E
    versionActual: 6,   // F
    tipoDocumento: 7,   // G (G:H)
    tipoSolicitud: 9,   // I (I:J)
    motivo: 11          // K (K:M)
};

const FIRMAS = {
    solicita: { row: 16, col: 2 },
    autoriza: { row: 16, col: 8 }
};

const TIPOS_DOCUMENTO = [
    'Procedimiento',
    'Instructivo',
    'Formato',
    'Manual',
    'Política',
    'Registro',
    'Otro'
];

const TIPOS_SOLICITUD = [
    'Alta',
    'Baja',
    'Modificación',
    'Actualización'
];

const FILA_DEFECTO = {
    nombreDocumento: '',
    codigo: '',
    versionActual: '',
    tipoDocumento: '',
    tipoSolicitud: '',
    motivo: ''
};

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2024-08-01',
    fechaElaboracion: '2024-08-01',
    solicitudes: [],
    solicitudActivaId: null
};

const TIMEZONE_MEXICO = 'America/Mexico_City';
const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: MAX_COLUMNAS_SISTEMA,
    keepSingleSheet: false
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
    const texto = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        return texto.slice(0, 10);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_MEXICO }).format(d);
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.slice(-2)}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function normalizarOpcion(valor, opciones) {
    const limpio = String(valor || '').trim();
    if (!limpio) return '';
    const encontrado = opciones.find((op) => op.toLowerCase() === limpio.toLowerCase());
    return encontrado || limpio;
}

function esEtiquetaFirma(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t.includes('NOMBRE Y FIRMA')
        || t === 'SOLICITA'
        || t === 'AUTORIZA'
        || t.includes('EJEC. SIST')
        || t.includes('SOLICITANTE');
}

function esFilaEtiquetaPlantilla(fila) {
    const campos = [
        fila?.nombreDocumento,
        fila?.codigo,
        fila?.versionActual,
        fila?.tipoDocumento,
        fila?.tipoSolicitud,
        fila?.motivo
    ];
    return campos.some((c) => esEtiquetaFirma(c));
}

function extraerRevision(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return DATOS_DEFECTO.revision;
    const m = texto.match(/(\d{1,3})\s*$/);
    if (m) {
        return String(parseInt(m[1], 10)).padStart(2, '0');
    }
    const soloDigitos = texto.replace(/\D/g, '');
    if (soloDigitos) {
        return String(parseInt(soloDigitos, 10)).padStart(2, '0');
    }
    return DATOS_DEFECTO.revision;
}

function sanitizarFila(item) {
    return {
        nombreDocumento: String(item?.nombreDocumento || '').trim(),
        codigo: String(item?.codigo || '').trim(),
        versionActual: String(item?.versionActual || '').trim(),
        tipoDocumento: normalizarOpcion(item?.tipoDocumento, TIPOS_DOCUMENTO),
        tipoSolicitud: normalizarOpcion(item?.tipoSolicitud, TIPOS_SOLICITUD),
        motivo: normalizarSaltosLinea(item?.motivo)
    };
}

function esFilaVacia(item) {
    const f = sanitizarFila(item);
    return !f.nombreDocumento && !f.codigo && !f.versionActual
        && !f.tipoDocumento && !f.tipoSolicitud && !f.motivo;
}

function nuevoIdSolicitud() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function crearSolicitudVacia(parcial = {}) {
    return {
        id: String(parcial.id || nuevoIdSolicitud()),
        fechaSolicitud: formatearFechaIso(parcial.fechaSolicitud) || '',
        nombreSolicitante: String(parcial.nombreSolicitante || '').trim(),
        puestoSolicitante: String(parcial.puestoSolicitante || '').trim(),
        areaDepartamento: String(parcial.areaDepartamento || '').trim(),
        solicita: esEtiquetaFirma(parcial.solicita) ? '' : String(parcial.solicita || '').trim(),
        autoriza: esEtiquetaFirma(parcial.autoriza) ? '' : String(parcial.autoriza || '').trim(),
        filas: []
    };
}

function sanitizarSolicitud(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const filas = Array.isArray(base.filas) ? base.filas : [];
    return {
        id: String(base.id || nuevoIdSolicitud()).trim() || nuevoIdSolicitud(),
        fechaSolicitud: formatearFechaIso(base.fechaSolicitud) || String(base.fechaSolicitud || '').trim(),
        nombreSolicitante: String(base.nombreSolicitante || '').trim(),
        puestoSolicitante: String(base.puestoSolicitante || '').trim(),
        areaDepartamento: String(base.areaDepartamento || '').trim(),
        solicita: esEtiquetaFirma(base.solicita) ? '' : String(base.solicita || '').trim(),
        autoriza: esEtiquetaFirma(base.autoriza) ? '' : String(base.autoriza || '').trim(),
        filas: filas
            .map(sanitizarFila)
            .filter((f) => !esFilaVacia(f) && !esFilaEtiquetaPlantilla(f))
            .slice(0, MAX_FILAS)
    };
}

function claveNombreSolicitante(nombre) {
    return String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * Una sola solicitud por persona: fusiona filas/datos cuando el nombre coincide
 * (evita N tarjetas/hojas para el mismo solicitante).
 */
function consolidarSolicitudesPorPersona(solicitudes) {
    const orden = [];
    const mapa = new Map();

    for (const raw of solicitudes || []) {
        const sol = sanitizarSolicitud(raw);
        if (!solicitudTieneContenido(sol)) {
            continue;
        }
        const clave = claveNombreSolicitante(sol.nombreSolicitante);
        if (!clave) {
            // Sin nombre: conservar solo si tiene contenido útil (se validará al guardar).
            orden.push(sol.id);
            mapa.set(sol.id, sol);
            continue;
        }
        const existente = mapa.get(clave);
        if (!existente) {
            orden.push(clave);
            mapa.set(clave, sol);
            continue;
        }
        const idsFila = new Set(
            existente.filas.map((f) => [
                f.nombreDocumento, f.codigo, f.versionActual,
                f.tipoDocumento, f.tipoSolicitud, f.motivo
            ].join('|').toLowerCase())
        );
        for (const fila of sol.filas) {
            const k = [
                fila.nombreDocumento, fila.codigo, fila.versionActual,
                fila.tipoDocumento, fila.tipoSolicitud, fila.motivo
            ].join('|').toLowerCase();
            if (!idsFila.has(k)) {
                existente.filas.push(fila);
                idsFila.add(k);
            }
        }
        existente.filas = existente.filas.slice(0, MAX_FILAS);
        if (!existente.fechaSolicitud && sol.fechaSolicitud) {
            existente.fechaSolicitud = sol.fechaSolicitud;
        }
        if (!existente.puestoSolicitante && sol.puestoSolicitante) {
            existente.puestoSolicitante = sol.puestoSolicitante;
        }
        if (!existente.areaDepartamento && sol.areaDepartamento) {
            existente.areaDepartamento = sol.areaDepartamento;
        }
        if (!existente.solicita && sol.solicita) {
            existente.solicita = sol.solicita;
        }
        if (!existente.autoriza && sol.autoriza) {
            existente.autoriza = sol.autoriza;
        }
        // Conservar el nombre con mejor capitalización / más largo.
        if ((sol.nombreSolicitante || '').length > (existente.nombreSolicitante || '').length) {
            existente.nombreSolicitante = sol.nombreSolicitante;
        }
    }

    return orden.map((k) => mapa.get(k)).filter(Boolean);
}

function solicitudTieneContenido(sol) {
    const s = sanitizarSolicitud(sol);
    return !!(
        s.nombreSolicitante
        || s.puestoSolicitante
        || s.areaDepartamento
        || s.fechaSolicitud
        || s.filas.length
    );
}

function migrarLegacyASolicitudes(base) {
    if (Array.isArray(base.solicitudes)) {
        return base.solicitudes.map(sanitizarSolicitud);
    }
    // Compatibilidad con el modelo plano anterior.
    const legacy = sanitizarSolicitud({
        id: base.id,
        fechaSolicitud: base.fechaSolicitud,
        nombreSolicitante: base.nombreSolicitante,
        puestoSolicitante: base.puestoSolicitante,
        areaDepartamento: base.areaDepartamento,
        solicita: base.solicita,
        autoriza: base.autoriza,
        filas: base.filas
    });
    return solicitudTieneContenido(legacy) ? [legacy] : [];
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const solicitudes = consolidarSolicitudesPorPersona(migrarLegacyASolicitudes(base));
    let solicitudActivaId = String(base.solicitudActivaId || '').trim() || null;
    if (solicitudActivaId && !solicitudes.some((s) => s.id === solicitudActivaId)) {
        // Si se fusionó, apuntar a la solicitud consolidada con el mismo nombre (si existía).
        solicitudActivaId = solicitudes[0]?.id || null;
    }
    if (!solicitudActivaId && solicitudes.length) {
        solicitudActivaId = solicitudes[0].id;
    }
    return {
        revision: extraerRevision(base.revision),
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        solicitudes,
        solicitudActivaId
    };
}

function resolverSolicitudActiva(datos) {
    const d = sanitizarDatos(datos);
    if (!d.solicitudes.length) return null;
    return d.solicitudes.find((s) => s.id === d.solicitudActivaId) || d.solicitudes[0];
}

function datosConSolicitudActiva(datos, solicitud) {
    return sanitizarDatos({
        ...(datos || {}),
        solicitudActivaId: solicitud?.id || null,
        solicitudes: (datos?.solicitudes || []).map((s) => (s.id === solicitud?.id ? solicitud : s))
    });
}

function sanitizarNombreHojaSolicitante(nombre, id) {
    const base = String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    if (base) return base;
    const corto = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    return corto ? `Solicitante-${corto}` : 'Sin-nombre';
}

function resolverNombreHojaSolicitud(solicitud) {
    const s = sanitizarSolicitud(solicitud);
    return sanitizarNombreHojaSolicitante(s.nombreSolicitante, s.id);
}

function esHojaHistorialSgcF02(titulo) {
    const t = String(titulo || '').trim();
    return /^SGCF02-\d{4}$/i.test(t) || /^SGCF02_r\d+$/i.test(t);
}

function esHojaSolicitudSgcF02(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    if (esHojaHistorialSgcF02(t)) return false;
    return true;
}

function leerFilasDesdeHoja(ws) {
    const filas = [];
    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        const fila = sanitizarFila({
            nombreDocumento: celdaATexto(row.getCell(COLUMNAS.nombreDocumento).value),
            codigo: celdaATexto(row.getCell(COLUMNAS.codigo).value),
            versionActual: celdaATexto(row.getCell(COLUMNAS.versionActual).value),
            tipoDocumento: celdaATexto(row.getCell(COLUMNAS.tipoDocumento).value),
            tipoSolicitud: celdaATexto(row.getCell(COLUMNAS.tipoSolicitud).value),
            motivo: celdaATexto(row.getCell(COLUMNAS.motivo).value)
        });
        // Al llegar a la zona de firmas de la plantilla, detener lectura.
        if (esFilaEtiquetaPlantilla(fila)) {
            break;
        }
        if (!esFilaVacia(fila)) {
            filas.push(fila);
        }
    }
    return filas;
}

function leerFirma(ws, { row, col }) {
    const valor = celdaATexto(ws.getRow(row).getCell(col).value);
    if (valor && !esEtiquetaFirma(valor)) return valor;
    const arriba = celdaATexto(ws.getRow(row - 1).getCell(col).value);
    if (arriba && !esEtiquetaFirma(arriba)) return arriba;
    return '';
}

function parsearSolicitudDesdeHoja(ws, opciones = {}) {
    return sanitizarSolicitud({
        id: opciones.id || nuevoIdSolicitud(),
        fechaSolicitud: formatearFechaIso(
            ws.getRow(SOLICITANTE.fechaSolicitud.row).getCell(SOLICITANTE.fechaSolicitud.col).value
        ),
        nombreSolicitante: celdaATexto(
            ws.getRow(SOLICITANTE.nombreSolicitante.row).getCell(SOLICITANTE.nombreSolicitante.col).value
        ) || String(opciones.nombreFallback || '').trim(),
        puestoSolicitante: celdaATexto(
            ws.getRow(SOLICITANTE.puestoSolicitante.row).getCell(SOLICITANTE.puestoSolicitante.col).value
        ),
        areaDepartamento: celdaATexto(
            ws.getRow(SOLICITANTE.areaDepartamento.row).getCell(SOLICITANTE.areaDepartamento.col).value
        ),
        solicita: leerFirma(ws, FIRMAS.solicita),
        autoriza: leerFirma(ws, FIRMAS.autoriza),
        filas: leerFilasDesdeHoja(ws)
    });
}

function parsearMetaDesdeHoja(ws) {
    return {
        revision: extraerRevision(celdaATexto(ws.getRow(REVISION_CELL.row).getCell(REVISION_CELL.col).value)),
        fechaRevision: formatearFechaIso(
            ws.getRow(FECHA_REV_CELL.row).getCell(FECHA_REV_CELL.col).value
        ) || DATOS_DEFECTO.fechaRevision
    };
}

function parsearDatosDesdeHoja(ws) {
    const meta = parsearMetaDesdeHoja(ws);
    const sol = parsearSolicitudDesdeHoja(ws);
    return sanitizarDatos({
        ...meta,
        solicitudes: solicitudTieneContenido(sol) ? [sol] : [],
        solicitudActivaId: sol.id
    });
}

function escribirFilaDocumento(row, item, indice) {
    const f = sanitizarFila(item);
    asignarTextoSimple(row.getCell(COLUMNAS.no), String(indice + 1), 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.nombreDocumento), f.nombreDocumento, 'left');
    asignarTextoSimple(row.getCell(COLUMNAS.codigo), f.codigo, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.versionActual), f.versionActual, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.tipoDocumento), f.tipoDocumento, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.tipoSolicitud), f.tipoSolicitud, 'center');
    asignarTextoSimple(row.getCell(COLUMNAS.motivo), f.motivo, 'left');
}

function escribirFilasEnHoja(ws, filasRaw) {
    const filas = Array.isArray(filasRaw) ? filasRaw : [];
    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const fila = i < filas.length ? filas[i] : { ...FILA_DEFECTO };
        escribirFilaDocumento(ws.getRow(rowNum), fila, i);
        if (i >= filas.length) {
            asignarTextoSimple(ws.getRow(rowNum).getCell(COLUMNAS.no), '', 'center');
        }
    }
}

function escribirDatosEnHoja(ws, datos) {
    const meta = sanitizarDatos(datos);
    const sol = resolverSolicitudActiva(meta) || crearSolicitudVacia();
    asignarTextoSimple(ws.getRow(REVISION_CELL.row).getCell(REVISION_CELL.col), meta.revision, 'center');
    asignarTextoSimple(
        ws.getRow(FECHA_REV_CELL.row).getCell(FECHA_REV_CELL.col),
        formatearFechaDisplay(meta.fechaRevision),
        'center'
    );
    asignarTextoSimple(
        ws.getRow(SOLICITANTE.fechaSolicitud.row).getCell(SOLICITANTE.fechaSolicitud.col),
        formatearFechaDisplay(sol.fechaSolicitud) || sol.fechaSolicitud,
        'center'
    );
    asignarTextoSimple(
        ws.getRow(SOLICITANTE.nombreSolicitante.row).getCell(SOLICITANTE.nombreSolicitante.col),
        sol.nombreSolicitante,
        'left'
    );
    asignarTextoSimple(
        ws.getRow(SOLICITANTE.puestoSolicitante.row).getCell(SOLICITANTE.puestoSolicitante.col),
        sol.puestoSolicitante,
        'left'
    );
    asignarTextoSimple(
        ws.getRow(SOLICITANTE.areaDepartamento.row).getCell(SOLICITANTE.areaDepartamento.col),
        sol.areaDepartamento,
        'left'
    );
    escribirFilasEnHoja(ws, sol.filas);
    asignarTextoSimple(ws.getRow(FIRMAS.solicita.row).getCell(FIRMAS.solicita.col), sol.solicita, 'center');
    asignarTextoSimple(ws.getRow(FIRMAS.autoriza.row).getCell(FIRMAS.autoriza.col), sol.autoriza, 'center');
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
    const meta = sanitizarDatos(datos);
    const sol = resolverSolicitudActiva(meta) || crearSolicitudVacia();
    const actualizaciones = [
        { range: rangoSheet(`${columnaALetra(REVISION_CELL.col)}${REVISION_CELL.row}`, sheetTitle), values: [[meta.revision]] },
        {
            range: rangoSheet(`${columnaALetra(FECHA_REV_CELL.col)}${FECHA_REV_CELL.row}`, sheetTitle),
            values: [[formatearFechaDisplay(meta.fechaRevision)]]
        },
        {
            range: rangoSheet(
                `${columnaALetra(SOLICITANTE.fechaSolicitud.col)}${SOLICITANTE.fechaSolicitud.row}`,
                sheetTitle
            ),
            values: [[formatearFechaDisplay(sol.fechaSolicitud) || sol.fechaSolicitud || '']]
        },
        {
            range: rangoSheet(
                `${columnaALetra(SOLICITANTE.nombreSolicitante.col)}${SOLICITANTE.nombreSolicitante.row}`,
                sheetTitle
            ),
            values: [[sol.nombreSolicitante || '']]
        },
        {
            range: rangoSheet(
                `${columnaALetra(SOLICITANTE.puestoSolicitante.col)}${SOLICITANTE.puestoSolicitante.row}`,
                sheetTitle
            ),
            values: [[sol.puestoSolicitante || '']]
        },
        {
            range: rangoSheet(
                `${columnaALetra(SOLICITANTE.areaDepartamento.col)}${SOLICITANTE.areaDepartamento.row}`,
                sheetTitle
            ),
            values: [[sol.areaDepartamento || '']]
        },
        {
            range: rangoSheet(`${columnaALetra(FIRMAS.solicita.col)}${FIRMAS.solicita.row}`, sheetTitle),
            values: [[sol.solicita || '']]
        },
        {
            range: rangoSheet(`${columnaALetra(FIRMAS.autoriza.col)}${FIRMAS.autoriza.row}`, sheetTitle),
            values: [[sol.autoriza || '']]
        }
    ];

    for (let i = 0; i < MAX_FILAS; i++) {
        const rowNum = DATA_START_ROW + i;
        const f = i < sol.filas.length ? sol.filas[i] : { ...FILA_DEFECTO };
        const no = i < sol.filas.length ? String(i + 1) : '';
        actualizaciones.push({ range: rangoSheet(`${columnaALetra(COLUMNAS.no)}${rowNum}`, sheetTitle), values: [[no]] });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.nombreDocumento)}${rowNum}`, sheetTitle),
            values: [[f.nombreDocumento || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.codigo)}${rowNum}`, sheetTitle),
            values: [[f.codigo || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.versionActual)}${rowNum}`, sheetTitle),
            values: [[f.versionActual || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.tipoDocumento)}${rowNum}`, sheetTitle),
            values: [[f.tipoDocumento || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.tipoSolicitud)}${rowNum}`, sheetTitle),
            values: [[f.tipoSolicitud || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`${columnaALetra(COLUMNAS.motivo)}${rowNum}`, sheetTitle),
            values: [[f.motivo || '']]
        });
    }
    return actualizaciones;
}

async function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    const porNombre = wb.getWorksheet(SHEET_TITLE)
        || lista.find((ws) => /solicitud/i.test(String(ws.name || '')))
        || lista[0];
    if (String(modo || 'vigente').toLowerCase() === 'edicion') {
        const vigente = excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO);
        return vigente || excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE) || porNombre;
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || porNombre;
}

async function resolverTituloHojaTrabajo(spreadsheetId) {
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[SGC-F-02] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-02 no contiene hojas.');
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

async function aplicarFormatoVisualSgcF02(spreadsheetId, sheetTitle, datos) {
    if (!spreadsheetId || !sheetTitle) return;
    const meta = sanitizarDatos(datos);
    const sol = resolverSolicitudActiva(meta);
    const numFilas = sol?.filas?.length || 0;
    try {
        await driveService.aplicarFormatoFilasSgcF02(
            spreadsheetId,
            sheetTitle,
            DATA_START_ROW,
            numFilas,
            DATA_END_ROW
        );
    } catch (err) {
        console.warn('[SGC-F-02] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarFormatoVisualSgcF02(spreadsheetId, titulo, datos);
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
    if (!ws) throw new Error('La plantilla SGC-F-02 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function snapshotContenido(datos) {
    const d = sanitizarDatos(datos);
    return {
        solicitudes: d.solicitudes.map((s) => ({
            id: s.id,
            fechaSolicitud: s.fechaSolicitud,
            nombreSolicitante: s.nombreSolicitante,
            puestoSolicitante: s.puestoSolicitante,
            areaDepartamento: s.areaDepartamento,
            solicita: s.solicita,
            autoriza: s.autoriza,
            filas: s.filas
        })),
        solicitudActivaId: d.solicitudActivaId
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotContenido(a)) === JSON.stringify(snapshotContenido(b));
}

function estructuraEsEquivalente() {
    return true;
}

function resolverNombreHojaUnico(solicitud, usados) {
    let nombre = resolverNombreHojaSolicitud(solicitud);
    const key = nombre.toLowerCase();
    if (!usados.has(key)) {
        usados.add(key);
        return nombre;
    }
    const suf = String(solicitud.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || String(Date.now()).slice(-4);
    nombre = `${nombre.slice(0, 80)}-${suf}`.slice(0, 90);
    usados.add(nombre.toLowerCase());
    return nombre;
}

async function sincronizarHojasSolicitudesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /solicitud/i }
    );

    if (!plantillaOrigen) {
        console.warn(
            '[SGC-F-02] Hoja plantilla «Solicitud» no encontrada en el spreadsheet. '
            + `Hojas: ${titulosExistentes.join(', ') || '(ninguna)'}`
        );
    } else if (plantillaOrigen !== SHEET_TITLE) {
        console.log(`[SGC-F-02] Usando hoja plantilla «${plantillaOrigen}» (se esperaba «${SHEET_TITLE}»).`);
    }

    const mapaIdHojaPrevio = new Map();
    if (prev?.solicitudes) {
        for (const s of prev.solicitudes) {
            mapaIdHojaPrevio.set(s.id, resolverNombreHojaSolicitud(s));
        }
    }

    const usados = new Set([SHEET_TITLE.toLowerCase()]);
    if (plantillaOrigen) {
        usados.add(plantillaOrigen.toLowerCase());
    }
    const hojasActivas = new Set();

    for (const solicitud of meta.solicitudes) {
        if (!solicitud.nombreSolicitante && !solicitudTieneContenido(solicitud)) {
            continue;
        }
        if (!String(solicitud.nombreSolicitante || '').trim()) {
            console.warn('[SGC-F-02] Solicitud sin nombre de solicitante; se omite hoja en Drive.');
            continue;
        }

        let nombreHoja = resolverNombreHojaUnico(solicitud, usados);
        const hojaPrev = mapaIdHojaPrevio.get(solicitud.id);

        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(hojaPrev);
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-02] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                if (setExistentes.has(hojaPrev)) {
                    nombreHoja = hojaPrev;
                }
            }
        }

        if (!setExistentes.has(nombreHoja)) {
            try {
                const dup = await driveService.duplicarHojaGoogleSheet(
                    spreadsheetId,
                    plantillaOrigen || SHEET_TITLE,
                    nombreHoja
                );
                nombreHoja = dup.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-02] No se pudo crear hoja "${nombreHoja}":`, err.message);
                continue;
            }
        }

        hojasActivas.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(
            spreadsheetId,
            datosConSolicitudActiva(meta, solicitud),
            nombreHoja
        );
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaHistorialSgcF02(titulo)) {
            eliminar.push(titulo);
            continue;
        }
        if (esHojaSolicitudSgcF02(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-02] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return hojasActivas;
}

async function leerTodasSolicitudesDesdeDrive(spreadsheetId) {
    const buffer = await descargarBufferDrive(spreadsheetId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const plantilla = wb.getWorksheet(SHEET_TITLE) || wb.worksheets[0];
    const meta = plantilla ? parsearMetaDesdeHoja(plantilla) : {
        revision: DATOS_DEFECTO.revision,
        fechaRevision: DATOS_DEFECTO.fechaRevision
    };

    const solicitudes = [];
    for (const ws of wb.worksheets) {
        const titulo = String(ws.name || '').trim();
        if (!titulo || titulo === SHEET_TITLE || esHojaHistorialSgcF02(titulo)) {
            continue;
        }
        const sol = parsearSolicitudDesdeHoja(ws, {
            id: nuevoIdSolicitud(),
            nombreFallback: titulo
        });
        if (!sol.nombreSolicitante) {
            sol.nombreSolicitante = titulo;
        }
        if (solicitudTieneContenido(sol)) {
            solicitudes.push(sol);
        }
    }

    return sanitizarDatos({
        ...meta,
        solicitudes,
        solicitudActivaId: solicitudes[0]?.id || null
    });
}

async function aplicarHistorialSgcF02(opciones) {
    // El historial mensual se sustituye por hojas por solicitante.
    // Se mantiene la firma por compatibilidad; no archiva hojas MMAA.
    return {
        aplicado: false,
        hojaVigente: SHEET_TITLE,
        datosGuardar: sanitizarDatos(opciones.datosNuevos)
    };
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
        console.warn('[SGC-F-02] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-02] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-02] Google Sheet restaurado: ${nuevoId}`);
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
        throw new Error('No hay archivo SGC-F-02 configurado en Drive.');
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
                console.warn('[SGC-F-02] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-02] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
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
        timeZone: TIMEZONE_MEXICO,
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

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos;
    let archivoDrive = null;

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-02] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
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

    // Preferir BD (lista de solicitudes). Si está vacía, intentar hojas por persona en Drive.
    datos = await leerDatosRegistro(registro);
    if ((!datos || !datos.solicitudes.length) && driveFileId) {
        try {
            datos = await leerTodasSolicitudesDesdeDrive(driveFileId);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-02] No se pudieron leer hojas de solicitantes:', err.message);
        }
    } else if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
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
    return construirRespuesta(registro, datos, archivoDrive);
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

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
    const datosEntrada = sanitizarDatos(body?.datos || body);

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

    let datosGuardar = { ...datosEntrada };
    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            await sincronizarHojasSolicitudesEnDrive(driveId, datosGuardar, datosPrevios);
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
            console.warn('[SGC-F-02] No se pudo sincronizar hojas por solicitante:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    // Tras subir/convertir, intentar crear hojas por solicitante en el nuevo spreadsheet.
    if (archivoDrive?.id) {
        try {
            await sincronizarHojasSolicitudesEnDrive(archivoDrive.id, datosGuardar, datosPrevios);
        } catch (err) {
            console.warn('[SGC-F-02] Sync de hojas tras subida falló:', err.message);
        }
    }

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

    const datosDrive = await leerTodasSolicitudesDesdeDrive(driveFileId);

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

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    const datosGuardar = { ...datosDrive };
    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }
    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

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

    if (registro?.drive_file_id && registro.drive_file_id !== TEMPLATE_DRIVE_ID) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-02] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datos, TEMPLATE_DRIVE_ID);
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

function extensionArchivo(nombre) {
    const partes = String(nombre || '').toLowerCase().split('.');
    return partes.length > 1 ? partes.pop() : '';
}

function resolverMimeDocFisico(nombreArchivo, mimeEntrada) {
    const mime = String(mimeEntrada || '').trim().toLowerCase();
    if (mime === 'image/jpg') return 'image/jpeg';
    if (MIME_DOCS_FISICOS.has(mime)) return mime;
    const ext = extensionArchivo(nombreArchivo);
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return '';
}

function esMimeDocFisicoPermitido(nombreArchivo, mimeEntrada) {
    const mime = resolverMimeDocFisico(nombreArchivo, mimeEntrada);
    const ext = extensionArchivo(nombreArchivo);
    return !!mime && EXT_DOCS_FISICOS.has(ext);
}

function mapearDocFisicoDrive(file) {
    const mime = String(file?.mimeType || '').toLowerCase();
    const nombre = String(file?.name || 'archivo');
    const ext = extensionArchivo(nombre);
    let tipo = 'otro';
    if (mime === 'application/pdf' || ext === 'pdf') tipo = 'pdf';
    else if (mime.startsWith('image/') || ext === 'jpg' || ext === 'jpeg') tipo = 'imagen';
    return {
        id: file.id,
        nombre,
        mimeType: file.mimeType || null,
        size: file.size != null ? Number(file.size) : null,
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || null,
        webContentLink: file.webContentLink || null,
        tipo
    };
}

async function listarDocumentosFisicos() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DOCS_FISICOS_ID);
    return (archivos || [])
        .filter((f) => esMimeDocFisicoPermitido(f.name, f.mimeType)
            || String(f.mimeType || '').toLowerCase() === 'application/pdf'
            || String(f.mimeType || '').toLowerCase().startsWith('image/jpeg'))
        .map(mapearDocFisicoDrive)
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
}

async function subirDocumentoFisico(buffer, nombreArchivo, mimeType) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        const err = new Error('Archivo vacío o inválido.');
        err.status = 400;
        throw err;
    }
    if (buffer.length > MAX_DOC_FISICO_MB * 1024 * 1024) {
        const err = new Error(`El archivo supera el máximo de ${MAX_DOC_FISICO_MB} MB.`);
        err.status = 400;
        throw err;
    }
    const mime = resolverMimeDocFisico(nombreArchivo, mimeType);
    if (!mime || !esMimeDocFisicoPermitido(nombreArchivo, mime)) {
        const err = new Error('Solo se permiten archivos PDF, JPG o JPEG.');
        err.status = 400;
        throw err;
    }
    const seguro = String(nombreArchivo || 'documento')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'documento';
    const subido = await driveService.subirArchivoNuevo(
        buffer,
        seguro,
        mime,
        CARPETA_DOCS_FISICOS_ID
    );
    return mapearDocFisicoDrive(subido);
}

async function eliminarDocumentoFisico(fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        const err = new Error('Identificador de archivo requerido.');
        err.status = 400;
        throw err;
    }
    const lista = await listarDocumentosFisicos();
    if (!lista.some((f) => f.id === id)) {
        const err = new Error('El archivo no pertenece a Documentos Físicos de SGC-F-02.');
        err.status = 403;
        throw err;
    }
    await driveService.eliminarArchivo(id);
    return { id };
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos,
    listarDocumentosFisicos,
    subirDocumentoFisico,
    eliminarDocumentoFisico,
    CARPETA_DOCS_FISICOS_ID,
    TIPOS_DOCUMENTO,
    TIPOS_SOLICITUD
};
