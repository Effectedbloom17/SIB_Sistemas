/**
 * SGC-F-16 · Minuta — persistencia en biznaga_sgc y sync con Drive.
 *
 * Archivero: una pestaña por minuta; nombre de hoja = campo «Asunto» (sanitizado).
 * Plantilla externa (solo diseño) ≠ archivo sistema (historial + histograma).
 *
 * Layout hoja «Plantilla»:
 *   C5 fecha de visita · F5 hora · C7 lugar · C9 asunto
 *   Asistentes desde F13 · Agenda desde F17 · Compromisos desde F21
 *   D23 notas tomadas por
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-16';
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/18aG752wFV2Pt7EE0TT_DD4jM5ldGDo6MKD889woKgzE
 */
const TEMPLATE_DRIVE_ID = '18aG752wFV2Pt7EE0TT_DD4jM5ldGDo6MKD889woKgzE';
/**
 * Archivo de trabajo Centro SGC (minutas del archivero + histograma).
 * https://docs.google.com/spreadsheets/d/1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M
 */
const DRIVE_FILE_ID_SISTEMA = '1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** PDF firmados (histórico por minuta); distinto de la carpeta del Google Sheet. */
const CARPETA_PDF_FIRMADOS_ID = '1iFcoHpSBBsukq-dL_R-HsCD6FWfhzXvz';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-16 Minuta (sistema)';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
/** Fallback de resolución; el trabajo real usa pestañas por Asunto. */
const SHEET_TITLE = TEMPLATE_SHEET_TITLE;

const MAX_ASISTENTES = 20;
const MAX_AGENDA = 20;
const MAX_COMPROMISOS = 30;
/** Fila vacía al final de cada bloque (antes de AGENDA / COMPROMISOS / Notas). */
const SEPARATOR_ROWS = 1;
const ESTATUS_VALIDOS = ['Pendiente', 'En proceso', 'Cumplido'];

const LAYOUT_BASE = {
    fecha: { row: 5, col: 3 },
    hora: { row: 5, col: 6 },
    lugar: { row: 7, col: 3 },
    asunto: { row: 9, col: 3 },
    asistentesStart: 13,
    asistentesEnd: 14,
    agendaStart: 17,
    agendaEnd: 18,
    compromisosStart: 21,
    compromisosEnd: 22,
    notas: { row: 23, col: 4 },
    revision: { row: 2, col: 7 },
    fechaRevision: { row: 3, col: 7 }
};

const ASISTENTE_DEFECTO = { nombre: '', puesto: '', firma: '' };
const AGENDA_DEFECTO = { descripcion: '' };
const COMPROMISO_DEFECTO = {
    descripcion: '',
    responsable: '',
    fechaCompromiso: '',
    estatus: 'Pendiente',
    observaciones: ''
};

const DATOS_DEFECTO = {
    fechaElaboracion: '2021-01-13',
    revision: '00',
    fechaRevision: '2021-01-13',
    minutas: [],
    minutaActivaId: null
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

function etiquetaNormalizada(valor) {
    return celdaATexto(valor)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[:.]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function etiquetaEs(valor, ...needles) {
    const t = etiquetaNormalizada(valor);
    return needles.some((n) => t === n || t.startsWith(n));
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
        const iso = String(fecha).match(/(\d{4})-(\d{2})-(\d{2})/);
        return iso ? iso[0] : String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function normalizarHora(valor) {
    const t = String(valor || '').trim();
    if (!t) return '';
    // 24h: 15:32 o 15:32:00
    let m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
        const h = Math.min(23, Math.max(0, Number(m[1])));
        const min = Math.min(59, Math.max(0, Number(m[2])));
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    // 12h: 3:32 pm / 11:00 a.m.
    m = t.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)$/i);
    if (m) {
        let h = Number(m[1]);
        const min = Number(m[2]);
        const esPm = /^p/i.test(m[3].replace(/\s/g, ''));
        if (esPm && h < 12) h += 12;
        if (!esPm && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return '';
}

/** 15:32 → "3:32 pm" */
function formatearHoraAmPm(hhmm) {
    const n = normalizarHora(hhmm);
    if (!n) return '';
    const [hs, ms] = n.split(':').map(Number);
    const sufijo = hs >= 12 ? 'pm' : 'am';
    let h12 = hs % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(ms).padStart(2, '0')} ${sufijo}`;
}

function parsearRangoHoraDesdeTexto(texto) {
    const raw = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { horaInicio: '', horaFin: '' };
    const partes = raw.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2) {
        return {
            horaInicio: normalizarHora(partes[0]),
            horaFin: normalizarHora(partes[1])
        };
    }
    return { horaInicio: '', horaFin: normalizarHora(raw) };
}

/** Una hora → "3:32 pm"; rango → "11:00 am - 2:30 pm" */
function formatearRangoHoraExcel(horaInicio, horaFin) {
    const inicio = normalizarHora(horaInicio);
    const fin = normalizarHora(horaFin);
    if (inicio && fin) {
        return `${formatearHoraAmPm(inicio)} - ${formatearHoraAmPm(fin)}`;
    }
    if (fin) return formatearHoraAmPm(fin);
    if (inicio) return formatearHoraAmPm(inicio);
    return '';
}

function resolverHorasMinuta(base) {
    let horaInicio = normalizarHora(base?.horaInicio || base?.hora_inicio || '');
    let horaFin = normalizarHora(base?.horaFin || base?.hora_fin || '');
    if (!horaInicio && !horaFin) {
        const parsed = parsearRangoHoraDesdeTexto(base?.hora || '');
        horaInicio = parsed.horaInicio;
        horaFin = parsed.horaFin;
    } else if (!horaFin && base?.hora) {
        // Legacy: un solo campo "hora" = finalización
        const parsed = parsearRangoHoraDesdeTexto(base.hora);
        if (parsed.horaInicio && parsed.horaFin) {
            horaInicio = horaInicio || parsed.horaInicio;
            horaFin = parsed.horaFin;
        } else {
            horaFin = parsed.horaFin || normalizarHora(base.hora);
        }
    }
    return {
        horaInicio,
        horaFin,
        hora: formatearRangoHoraExcel(horaInicio, horaFin)
    };
}

function extraerRevision(texto) {
    const m = String(texto || '').match(/(\d{2})/);
    return m ? m[1] : '00';
}

function extraerFechaRevision(texto) {
    const iso = formatearFechaIso(texto);
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const m = String(texto || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    return m ? formatearFechaIso(m[0]) : '';
}

function normalizarEstatus(valor) {
    const limpio = String(valor || '').trim();
    if (!limpio) return 'Pendiente';
    const encontrado = ESTATUS_VALIDOS.find((op) => op.toLowerCase() === limpio.toLowerCase());
    if (encontrado) return encontrado;
    const t = limpio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/cumpl|cerrad|hecho|ok|conclu/.test(t)) return 'Cumplido';
    if (/proceso|seguimiento|curso/.test(t)) return 'En proceso';
    return 'Pendiente';
}

function sanitizarAsistente(item) {
    return {
        nombre: String(item?.nombre || '').trim(),
        puesto: String(item?.puesto || item?.rol || '').trim(),
        firma: String(item?.firma || '').trim()
    };
}

function sanitizarAgenda(item) {
    return { descripcion: String(item?.descripcion || item?.tema || '').trim() };
}

function sanitizarCompromiso(item) {
    return {
        descripcion: normalizarSaltosLinea(item?.descripcion || item?.tema || ''),
        responsable: normalizarSaltosLinea(item?.responsable || ''),
        fechaCompromiso: formatearFechaIso(item?.fechaCompromiso || item?.fecha || ''),
        estatus: normalizarEstatus(item?.estatus),
        observaciones: normalizarSaltosLinea(item?.observaciones || item?.detalle || '')
    };
}

function esAsistenteVacio(item) {
    const a = sanitizarAsistente(item);
    return !a.nombre && !a.puesto && !a.firma;
}

function esAgendaVacia(item) {
    return !sanitizarAgenda(item).descripcion;
}

function esCompromisoVacio(item) {
    const c = sanitizarCompromiso(item);
    return !c.descripcion && !c.responsable && !c.fechaCompromiso && !c.observaciones
        && (!c.estatus || c.estatus === 'Pendiente');
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) {
        out.push(factory());
    }
    return out;
}

function nuevoIdMinuta() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `mn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'SGC-F-16 Minuta firmada.pdf').trim()
            || 'SGC-F-16 Minuta firmada.pdf',
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function tituloHojaCoincide(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buscarTituloHoja(titulos, nombre) {
    return (titulos || []).find((titulo) => tituloHojaCoincide(titulo, nombre)) || '';
}

function esHojaReservadaSgcF16(titulo) {
    const t = String(titulo || '').trim();
    if (!t) return true;
    if (t === SHEET_TITLE || /^plantilla\.?$/i.test(t)) return true;
    if (/histograma/i.test(t)) return true;
    if (/^Alias_/i.test(t) || /^Partes_/i.test(t)) return true;
    if (/^_tmp_/i.test(t)) return true;
    if (/^hoja\s*\d+$/i.test(t)) return true;
    // Historial mensual legado (SGCF16-MMAA / _N) — no tocar ni reutilizar como Asunto.
    if (excelHistorial.esHojaHistorial(t, CODIGO_FORMATO)) return true;
    return false;
}

/**
 * Nombre de pestaña = Asunto (sanitizado). Fallback: folio o BORRADOR-{id}.
 */
function resolverNombreHojaMinuta(minuta, ocupados = []) {
    let base = sanitizarNombreHoja(minuta?.asunto);
    if (!base) {
        const folio = sanitizarNombreHoja(minuta?.folio);
        const id = String(minuta?.id || '').trim();
        base = folio || (id ? `BORRADOR-${id.slice(0, 8)}` : 'Sin-asunto');
    }
    if (esHojaReservadaSgcF16(base)) {
        base = `Minuta ${base}`.slice(0, 90);
    }
    const usados = new Set(
        (ocupados || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
    );
    let nombre = base;
    let n = 2;
    while (usados.has(nombre.toLowerCase()) || esHojaReservadaSgcF16(nombre)) {
        nombre = `${base} ${n}`.slice(0, 90);
        n += 1;
    }
    return nombre;
}

function datosConMinutaActiva(datos, minuta) {
    return sanitizarDatos({
        ...(datos || {}),
        minutaActivaId: minuta?.id || null
    });
}

function aplicarNombresHojaEnDatos(datos, hojasPorId) {
    if (!datos || !hojasPorId) return;
    for (const item of datos.minutas || []) {
        const nombre = hojasPorId.get(item.id);
        if (nombre) item.nombreHoja = nombre;
    }
}

function asignarNombresHojaMinutas(minutas, mapaPrevio, titulosExistentes) {
    const nombrePorId = new Map();
    const ocupados = [];

    for (const item of minutas) {
        const prev = mapaPrevio.get(item.id);
        if (!prev || esHojaReservadaSgcF16(prev)) continue;
        nombrePorId.set(item.id, prev);
        ocupados.push(prev);
    }

    for (const item of minutas) {
        const prev = nombrePorId.get(item.id);
        if (!prev) continue;
        const baseDeseado = sanitizarNombreHoja(item.asunto)
            || sanitizarNombreHoja(item.folio)
            || `BORRADOR-${String(item.id || '').slice(0, 8)}`;
        if (tituloHojaCoincide(baseDeseado, prev)) continue;
        const bloqueados = ocupados.filter((nombre) => !tituloHojaCoincide(nombre, prev));
        for (const titulo of titulosExistentes) {
            if (!tituloHojaCoincide(titulo, prev)) bloqueados.push(titulo);
        }
        const deseado = resolverNombreHojaMinuta(item, bloqueados);
        if (tituloHojaCoincide(deseado, prev)) continue;
        const idx = ocupados.findIndex((nombre) => tituloHojaCoincide(nombre, prev));
        if (idx >= 0) ocupados[idx] = deseado;
        else ocupados.push(deseado);
        nombrePorId.set(item.id, deseado);
    }

    for (const item of minutas) {
        if (nombrePorId.has(item.id)) continue;
        const nombre = resolverNombreHojaMinuta(item, [...ocupados, ...titulosExistentes]);
        nombrePorId.set(item.id, nombre);
        ocupados.push(nombre);
    }
    return nombrePorId;
}

function crearMinutaVacia() {
    return {
        id: nuevoIdMinuta(),
        folio: '',
        fechaVisita: '',
        horaInicio: '',
        horaFin: '',
        hora: '',
        lugar: '',
        asunto: '',
        notasTomadasPor: '',
        asistentes: [{ ...ASISTENTE_DEFECTO }],
        agenda: [{ ...AGENDA_DEFECTO }],
        compromisos: [{ ...COMPROMISO_DEFECTO }],
        pdfFirmado: null,
        nombreHoja: ''
    };
}

function sanitizarMinuta(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const asistentes = (Array.isArray(base.asistentes) ? base.asistentes : [])
        .map(sanitizarAsistente)
        .filter((a) => !esAsistenteVacio(a))
        .slice(0, MAX_ASISTENTES);
    const agenda = (Array.isArray(base.agenda) ? base.agenda : [])
        .map(sanitizarAgenda)
        .filter((a) => !esAgendaVacia(a))
        .slice(0, MAX_AGENDA);
    const compromisos = (Array.isArray(base.compromisos) ? base.compromisos : [])
        .map(sanitizarCompromiso)
        .filter((c) => !esCompromisoVacio(c))
        .slice(0, MAX_COMPROMISOS);
    const horas = resolverHorasMinuta(base);

    return {
        id: String(base.id || '').trim() || nuevoIdMinuta(),
        folio: String(base.folio || '').trim().toUpperCase(),
        fechaVisita: formatearFechaIso(base.fechaVisita),
        horaInicio: horas.horaInicio,
        horaFin: horas.horaFin,
        hora: horas.hora,
        lugar: String(base.lugar || '').trim(),
        asunto: String(base.asunto || '').trim(),
        notasTomadasPor: String(base.notasTomadasPor || '').trim(),
        asistentes: conFilasMinimas(asistentes, 1, () => ({ ...ASISTENTE_DEFECTO })),
        agenda: conFilasMinimas(agenda, 1, () => ({ ...AGENDA_DEFECTO })),
        compromisos: conFilasMinimas(compromisos, 1, () => ({ ...COMPROMISO_DEFECTO })),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        nombreHoja: sanitizarNombreHoja(base.nombreHoja || base.nombre_hoja || '')
    };
}

function esMinutaLegacyPlana(base) {
    return !Array.isArray(base?.minutas)
        && !!(base?.fechaVisita || base?.asunto || base?.hora || base?.lugar
            || base?.notasTomadasPor || base?.asistentes || base?.agenda || base?.compromisos);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let minutasRaw = [];
    if (Array.isArray(base.minutas)) {
        minutasRaw = base.minutas;
    } else if (esMinutaLegacyPlana(base)) {
        minutasRaw = [base];
    }
    const minutas = minutasRaw.map(sanitizarMinuta);
    const minutaActivaId = base.minutaActivaId
        ? String(base.minutaActivaId)
        : (minutas[0]?.id || null);

    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        fechaRevision: extraerFechaRevision(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        minutas,
        minutaActivaId: minutaActivaId && minutas.some((m) => m.id === minutaActivaId)
            ? minutaActivaId
            : (minutas[0]?.id || null)
    };
}

function resolverMinutaActiva(datos) {
    const lista = Array.isArray(datos?.minutas) ? datos.minutas : [];
    if (!lista.length) return crearMinutaVacia();
    const id = datos?.minutaActivaId;
    if (id) {
        const found = lista.find((m) => m.id === id);
        if (found) return found;
    }
    return lista[0];
}

/**
 * Aplana la minuta activa para los escritores de hoja (mapeo de celdas existente).
 */
function aPayloadHoja(datos) {
    const d = sanitizarDatos(datos);
    const m = resolverMinutaActiva(d);
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        fechaElaboracion: d.fechaElaboracion,
        fechaVisita: m.fechaVisita,
        hora: formatearRangoHoraExcel(m.horaInicio, m.horaFin) || m.hora || '',
        lugar: m.lugar,
        asunto: m.asunto,
        notasTomadasPor: m.notasTomadasPor,
        asistentes: m.asistentes,
        agenda: m.agenda,
        compromisos: m.compromisos
    };
}

function minutaTieneContenido(m) {
    if (!m) return false;
    return !!(m.fechaVisita || m.hora || m.horaInicio || m.horaFin || m.lugar || m.asunto || m.notasTomadasPor || m.folio
        || (Array.isArray(m.asistentes) && m.asistentes.some((a) => !esAsistenteVacio(a)))
        || (Array.isArray(m.agenda) && m.agenda.some((a) => !esAgendaVacia(a)))
        || (Array.isArray(m.compromisos) && m.compromisos.some((c) => !esCompromisoVacio(c)))
        || m.pdfFirmado?.driveFileId);
}

function hojaTieneContenido(datosHoja) {
    const hoja = sanitizarDatos(datosHoja || {});
    if (hoja.minutas.length) return hoja.minutas.some(minutaTieneContenido);
    return minutaTieneContenido(resolverMinutaActiva(hoja));
}

/**
 * Prefiere archivero BD; fusiona campos de la hoja Drive solo en la minuta activa.
 * Conserva el resto de minutas y sus pdfFirmado.
 */
function fusionarHojaEnMinutaActiva(datosDb, datosHoja) {
    const db = sanitizarDatos(datosDb || DATOS_DEFECTO);
    const hoja = sanitizarDatos(datosHoja || {});
    const hojaMin = resolverMinutaActiva(hoja);

    if (!db.minutas.length) {
        if (!hojaTieneContenido(hoja)) {
            return db;
        }
        const primera = sanitizarMinuta({ ...hojaMin, pdfFirmado: null });
        return sanitizarDatos({
            revision: hoja.revision || db.revision,
            fechaRevision: hoja.fechaRevision || db.fechaRevision,
            fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
            minutas: [primera],
            minutaActivaId: primera.id
        });
    }

    const activaId = db.minutaActivaId && db.minutas.some((m) => m.id === db.minutaActivaId)
        ? db.minutaActivaId
        : db.minutas[0].id;

    const minutas = db.minutas.map((m) => {
        if (m.id !== activaId) return m;
        return sanitizarMinuta({
            ...m,
            fechaVisita: hojaMin.fechaVisita,
            horaInicio: hojaMin.horaInicio,
            horaFin: hojaMin.horaFin,
            hora: hojaMin.hora,
            lugar: hojaMin.lugar,
            asunto: hojaMin.asunto,
            notasTomadasPor: hojaMin.notasTomadasPor,
            asistentes: hojaMin.asistentes,
            agenda: hojaMin.agenda,
            compromisos: hojaMin.compromisos,
            folio: m.folio,
            pdfFirmado: m.pdfFirmado,
            nombreHoja: hojaMin.nombreHoja || m.nombreHoja || ''
        });
    });

    return sanitizarDatos({
        revision: hoja.revision || db.revision,
        fechaRevision: hoja.fechaRevision || db.fechaRevision,
        fechaElaboracion: db.fechaElaboracion || hoja.fechaElaboracion,
        minutas,
        minutaActivaId: activaId
    });
}

function buscarFilaEtiqueta(ws, needles, maxRow = 80) {
    const maxCol = Math.min(Number(ws.columnCount) || 8, 8);
    for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
            if (etiquetaEs(row.getCell(c).value, ...needles)) {
                return { row: r, col: c };
            }
        }
    }
    return null;
}

function valorDerecha(ws, row, col) {
    const maxCol = Math.min(Number(ws.columnCount) || 8, 8);
    const etiquetasCampo = ['fecha de visita', 'hora', 'lugar', 'asunto', 'notas tomadas por'];
    let primerVacio = null;
    for (let c = col + 1; c <= maxCol; c++) {
        const texto = celdaATexto(ws.getRow(row).getCell(c).value);
        if (etiquetaEs(texto, ...etiquetasCampo)) {
            continue;
        }
        if (texto) {
            return { row, col: c, texto };
        }
        if (!primerVacio) {
            primerVacio = c;
        }
    }
    return { row, col: primerVacio || Math.min(col + 1, maxCol), texto: '' };
}

function esFilaReservadaSeccion(row) {
    const c1 = etiquetaNormalizada(row.getCell(1).value);
    const c2 = etiquetaNormalizada(row.getCell(2).value);
    if (c1 === 'asistentes' || c1 === 'agenda' || c1 === 'compromisos') return true;
    if (c2 === 'asistentes' || c2 === 'agenda' || c2 === 'compromisos') return true;
    if (c1.startsWith('notas tomadas por') || c2.startsWith('notas tomadas por')) return true;
    if (c1 === 'no' || c1 === 'nombre') return true;
    if (c2.startsWith('descripcion del proposito') || c2.startsWith('descripcion de actividades')) return true;
    if (c2 === 'puesto' || c2.startsWith('puesto y')) return true;
    return false;
}

function parsearLayoutDesdeHoja(ws) {
    const layout = { ...LAYOUT_BASE };
    const fecha = buscarFilaEtiqueta(ws, ['fecha de visita']);
    if (fecha) {
        const v = valorDerecha(ws, fecha.row, fecha.col);
        layout.fecha = { row: v.row, col: v.col };
    }
    const hora = buscarFilaEtiqueta(ws, ['hora']);
    if (hora) {
        const v = valorDerecha(ws, hora.row, hora.col);
        layout.hora = { row: v.row, col: v.col };
    }
    const lugar = buscarFilaEtiqueta(ws, ['lugar']);
    if (lugar) {
        const v = valorDerecha(ws, lugar.row, lugar.col);
        layout.lugar = { row: v.row, col: v.col };
    }
    const asunto = buscarFilaEtiqueta(ws, ['asunto']);
    if (asunto) {
        const v = valorDerecha(ws, asunto.row, asunto.col);
        layout.asunto = { row: v.row, col: v.col };
    }
    const asistentes = buscarFilaEtiqueta(ws, ['asistentes']);
    const agenda = buscarFilaEtiqueta(ws, ['agenda']);
    const compromisos = buscarFilaEtiqueta(ws, ['compromisos']);
    const notas = buscarFilaEtiqueta(ws, ['notas tomadas por']);

    if (asistentes && agenda) {
        layout.asistentesStart = asistentes.row + 2;
        layout.asistentesEnd = Math.max(layout.asistentesStart, agenda.row - 1);
    }
    if (agenda && compromisos) {
        layout.agendaStart = agenda.row + 2;
        layout.agendaEnd = Math.max(layout.agendaStart, compromisos.row - 1);
    }
    if (compromisos && notas) {
        layout.compromisosStart = compromisos.row + 2;
        layout.compromisosEnd = Math.max(layout.compromisosStart, notas.row - 1);
    }
    if (notas) {
        const v = valorDerecha(ws, notas.row, notas.col);
        layout.notas = { row: notas.row, col: v.col };
        layout.notasLabelCol = notas.col;
    }
    layout.asistentesSlots = layout.asistentesEnd - layout.asistentesStart + 1;
    layout.agendaSlots = layout.agendaEnd - layout.agendaStart + 1;
    layout.compromisosSlots = layout.compromisosEnd - layout.compromisosStart + 1;
    return layout;
}

function slotsDatosDisponibles(totalSlots) {
    return Math.max(1, Number(totalSlots) - SEPARATOR_ROWS);
}

function slotsNecesarios(numDatos) {
    return Math.max(1, Number(numDatos) || 0) + SEPARATOR_ROWS;
}

function leerRangoFilas(ws, start, end, mapper) {
    const items = [];
    for (let r = start; r <= end; r++) {
        const row = ws.getRow(r);
        if (esFilaReservadaSeccion(row)) {
            continue;
        }
        const mapped = mapper(row, r);
        if (mapped) items.push(mapped);
    }
    return items;
}

function parsearDatosDesdeHoja(ws) {
    const layout = parsearLayoutDesdeHoja(ws);
    const asistentes = leerRangoFilas(ws, layout.asistentesStart, layout.asistentesEnd, (row) => {
        const item = sanitizarAsistente({
            nombre: celdaATexto(row.getCell(1).value),
            puesto: celdaATexto(row.getCell(5).value),
            firma: celdaATexto(row.getCell(7).value)
        });
        return esAsistenteVacio(item) ? null : item;
    });
    const agenda = leerRangoFilas(ws, layout.agendaStart, layout.agendaEnd, (row) => {
        const item = sanitizarAgenda({ descripcion: celdaATexto(row.getCell(2).value) });
        return esAgendaVacia(item) ? null : item;
    });
    const compromisos = leerRangoFilas(ws, layout.compromisosStart, layout.compromisosEnd, (row) => {
        const item = sanitizarCompromiso({
            descripcion: celdaATexto(row.getCell(2).value),
            responsable: celdaATexto(row.getCell(4).value),
            fechaCompromiso: celdaATexto(row.getCell(5).value),
            estatus: celdaATexto(row.getCell(6).value),
            observaciones: celdaATexto(row.getCell(7).value)
        });
        return esCompromisoVacio(item) ? null : item;
    });

    const nombreHoja = String(ws?.name || '').trim();
    const asuntoCelda = celdaATexto(ws.getRow(layout.asunto.row).getCell(layout.asunto.col).value);
    const asuntoDesdeTitulo = (!esHojaReservadaSgcF16(nombreHoja) && !asuntoCelda)
        ? sanitizarNombreHoja(nombreHoja)
        : '';
    return sanitizarDatos({
        revision: extraerRevision(celdaATexto(ws.getRow(layout.revision.row).getCell(layout.revision.col).value)),
        fechaRevision: extraerFechaRevision(celdaATexto(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col).value)),
        fechaVisita: celdaATexto(ws.getRow(layout.fecha.row).getCell(layout.fecha.col).value),
        hora: celdaATexto(ws.getRow(layout.hora.row).getCell(layout.hora.col).value),
        lugar: celdaATexto(ws.getRow(layout.lugar.row).getCell(layout.lugar.col).value),
        asunto: asuntoCelda || asuntoDesdeTitulo,
        notasTomadasPor: celdaATexto(ws.getRow(layout.notas.row).getCell(layout.notas.col).value),
        nombreHoja: esHojaReservadaSgcF16(nombreHoja) ? '' : sanitizarNombreHoja(nombreHoja),
        asistentes,
        agenda,
        compromisos
    });
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

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(col)}${row}`, sheetTitle),
        values: [[valor ?? '']]
    });
}

function slotsSeccion(layout, key) {
    return Math.max(1, Number(layout[`${key}Slots`]) || 1);
}

function aplicarExtrasAlLayout(layout, extraA, extraG, extraC) {
    return {
        ...layout,
        asistentesEnd: layout.asistentesEnd + extraA,
        asistentesSlots: layout.asistentesSlots + extraA,
        agendaStart: layout.agendaStart + extraA,
        agendaEnd: layout.agendaEnd + extraA + extraG,
        agendaSlots: layout.agendaSlots + extraG,
        compromisosStart: layout.compromisosStart + extraA + extraG,
        compromisosEnd: layout.compromisosEnd + extraA + extraG + extraC,
        compromisosSlots: layout.compromisosSlots + extraC,
        notas: { ...layout.notas, row: layout.notas.row + extraA + extraG + extraC }
    };
}

async function obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle) {
    const meta = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hit = (meta || []).find((s) => String(s.title || '').trim() === String(sheetTitle).trim());
    return hit?.sheetId ?? null;
}

async function asegurarFilasSecciones(spreadsheetId, sheetTitle, datos, layout) {
    const d = aPayloadHoja(datos);
    // Reserva 1 fila vacía al final de cada bloque (espacio visual antes del siguiente encabezado).
    const extraA = Math.max(0, slotsNecesarios(d.asistentes.length) - slotsSeccion(layout, 'asistentes'));
    const extraG = Math.max(0, slotsNecesarios(d.agenda.length) - slotsSeccion(layout, 'agenda'));
    const extraC = Math.max(0, slotsNecesarios(d.compromisos.length) - slotsSeccion(layout, 'compromisos'));
    if (!extraA && !extraG && !extraC) {
        return { layout, insertoFilas: false };
    }

    const sheetId = await obtenerSheetIdPorTitulo(spreadsheetId, sheetTitle);
    if (sheetId == null) {
        return { layout, insertoFilas: false };
    }

    // Insertar de abajo hacia arriba para no invalidar índices previos.
    if (extraC > 0) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.compromisosEnd, extraC, {
            inheritFromBefore: true
        });
    }
    if (extraG > 0) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.agendaEnd, extraG, {
            inheritFromBefore: true
        });
    }
    if (extraA > 0) {
        await driveService.insertarFilasGoogleSheet(spreadsheetId, sheetId, layout.asistentesEnd, extraA, {
            inheritFromBefore: true
        });
    }
    return { layout: aplicarExtrasAlLayout(layout, extraA, extraG, extraC), insertoFilas: true };
}

function datosAActualizacionesSheet(datos, sheetTitle, layout) {
    const d = aPayloadHoja(datos);
    const actualizaciones = [];
    pushUpdate(actualizaciones, layout.fecha.row, layout.fecha.col, d.fechaVisita, sheetTitle);
    pushUpdate(actualizaciones, layout.hora.row, layout.hora.col, d.hora, sheetTitle);
    pushUpdate(actualizaciones, layout.lugar.row, layout.lugar.col, d.lugar, sheetTitle);
    pushUpdate(actualizaciones, layout.asunto.row, layout.asunto.col, d.asunto, sheetTitle);
    pushUpdate(actualizaciones, layout.notas.row, layout.notas.col, d.notasTomadasPor, sheetTitle);

    const dataSlotsA = slotsDatosDisponibles(layout.asistentesSlots);
    for (let i = 0; i < layout.asistentesSlots; i++) {
        const row = layout.asistentesStart + i;
        const esSeparador = i >= dataSlotsA || i >= d.asistentes.length;
        const item = !esSeparador ? d.asistentes[i] : ASISTENTE_DEFECTO;
        pushUpdate(actualizaciones, row, 1, item.nombre || '', sheetTitle);
        pushUpdate(actualizaciones, row, 5, item.puesto || '', sheetTitle);
        // Firma solo en Excel (firma física / descarga); la UI web no la edita.
        pushUpdate(actualizaciones, row, 7, item.firma || '', sheetTitle);
    }

    const dataSlotsG = slotsDatosDisponibles(layout.agendaSlots);
    for (let i = 0; i < layout.agendaSlots; i++) {
        const row = layout.agendaStart + i;
        const esSeparador = i >= dataSlotsG || i >= d.agenda.length;
        const item = !esSeparador ? d.agenda[i] : AGENDA_DEFECTO;
        const tiene = !esSeparador && !esAgendaVacia(item);
        pushUpdate(actualizaciones, row, 1, tiene ? String(i + 1) : '', sheetTitle);
        pushUpdate(actualizaciones, row, 2, item.descripcion || '', sheetTitle);
    }

    const dataSlotsC = slotsDatosDisponibles(layout.compromisosSlots);
    for (let i = 0; i < layout.compromisosSlots; i++) {
        const row = layout.compromisosStart + i;
        const esSeparador = i >= dataSlotsC || i >= d.compromisos.length;
        const item = !esSeparador ? d.compromisos[i] : COMPROMISO_DEFECTO;
        const tiene = !esSeparador && !esCompromisoVacio(item);
        pushUpdate(actualizaciones, row, 1, tiene ? String(i + 1) : '', sheetTitle);
        pushUpdate(actualizaciones, row, 2, item.descripcion || '', sheetTitle);
        pushUpdate(actualizaciones, row, 4, item.responsable || '', sheetTitle);
        pushUpdate(actualizaciones, row, 5, item.fechaCompromiso || '', sheetTitle);
        pushUpdate(actualizaciones, row, 6, tiene ? (item.estatus || '') : '', sheetTitle);
        pushUpdate(actualizaciones, row, 7, item.observaciones || '', sheetTitle);
    }
    return actualizaciones;
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

function escribirDatosEnHoja(ws, datos) {
    const d = aPayloadHoja(datos);
    const layout = parsearLayoutDesdeHoja(ws);
    asignarTextoSimple(ws.getRow(layout.fecha.row).getCell(layout.fecha.col), d.fechaVisita);
    asignarTextoSimple(ws.getRow(layout.hora.row).getCell(layout.hora.col), d.hora, 'center');
    asignarTextoSimple(ws.getRow(layout.lugar.row).getCell(layout.lugar.col), d.lugar);
    asignarTextoSimple(ws.getRow(layout.asunto.row).getCell(layout.asunto.col), d.asunto);
    asignarTextoSimple(ws.getRow(layout.notas.row).getCell(layout.notas.col), d.notasTomadasPor);

    const dataSlotsA = slotsDatosDisponibles(layout.asistentesSlots);
    for (let i = 0; i < layout.asistentesSlots; i++) {
        const row = ws.getRow(layout.asistentesStart + i);
        const esSeparador = i >= dataSlotsA || i >= d.asistentes.length;
        const item = !esSeparador ? d.asistentes[i] : ASISTENTE_DEFECTO;
        asignarTextoSimple(row.getCell(1), item.nombre || '');
        asignarTextoSimple(row.getCell(5), item.puesto || '');
        asignarTextoSimple(row.getCell(7), item.firma || '', 'center');
    }
    const dataSlotsG = slotsDatosDisponibles(layout.agendaSlots);
    for (let i = 0; i < layout.agendaSlots; i++) {
        const row = ws.getRow(layout.agendaStart + i);
        const esSeparador = i >= dataSlotsG || i >= d.agenda.length;
        const item = !esSeparador ? d.agenda[i] : AGENDA_DEFECTO;
        const tiene = !esSeparador && !esAgendaVacia(item);
        asignarTextoSimple(row.getCell(1), tiene ? String(i + 1) : '', 'center');
        asignarTextoSimple(row.getCell(2), item.descripcion || '');
    }
    const dataSlotsC = slotsDatosDisponibles(layout.compromisosSlots);
    for (let i = 0; i < layout.compromisosSlots; i++) {
        const row = ws.getRow(layout.compromisosStart + i);
        const esSeparador = i >= dataSlotsC || i >= d.compromisos.length;
        const item = !esSeparador ? d.compromisos[i] : COMPROMISO_DEFECTO;
        const tiene = !esSeparador && !esCompromisoVacio(item);
        asignarTextoSimple(row.getCell(1), tiene ? String(i + 1) : '', 'center');
        asignarTextoSimple(row.getCell(2), item.descripcion || '');
        asignarTextoSimple(row.getCell(4), item.responsable || '');
        asignarTextoSimple(row.getCell(5), item.fechaCompromiso || '', 'center');
        asignarTextoSimple(row.getCell(6), tiene ? (item.estatus || '') : '', 'center');
        asignarTextoSimple(row.getCell(7), item.observaciones || '');
    }
}

function resolverHojaWorkbook(wb, opciones = {}) {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) return null;
    const tituloPreferido = String(opciones.sheetTitle || '').trim();
    if (tituloPreferido) {
        const exacta = wb.getWorksheet(tituloPreferido)
            || lista.find((ws) => tituloHojaCoincide(ws.name, tituloPreferido));
        if (exacta) return exacta;
    }
    const noReservada = lista.find((ws) => !esHojaReservadaSgcF16(ws.name));
    return noReservada
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

function resolverNombreHojaActiva(datos) {
    const d = sanitizarDatos(datos || {});
    const activa = resolverMinutaActiva(d);
    if (!activa || !minutaTieneContenido(activa)) {
        const fijo = sanitizarNombreHoja(activa?.nombreHoja);
        if (fijo) return fijo;
        return resolverNombreHojaMinuta(activa || {});
    }
    return sanitizarNombreHoja(activa.nombreHoja) || resolverNombreHojaMinuta(activa);
}

async function resolverTituloHojaTrabajo(spreadsheetId, datos = null) {
    if (datos) {
        return resolverNombreHojaActiva(datos);
    }
    if (!spreadsheetId) return SHEET_TITLE;
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        const candidato = (titulos || []).find((t) => !esHojaReservadaSgcF16(t));
        if (candidato) return candidato;
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo listar hojas:', err.message);
    }
    return SHEET_TITLE;
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = resolverHojaWorkbook(wb, opciones);
    if (!ws) throw new Error('La plantilla SGC-F-16 no contiene hojas.');
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

async function aplicarWrapTextoCompromisos(spreadsheetId, sheetTitle, layout) {
    if (!layout?.compromisosSlots || layout.compromisosSlots < 1) return;
    const startRow = layout.compromisosStart;
    const endRow = layout.compromisosEnd;
    const rangos = [
        { startColumn: 2, endColumn: 3 }, // Descripción
        { startColumn: 4, endColumn: 4 }, // Responsable
        { startColumn: 7, endColumn: 8 }  // Observaciones
    ];
    for (const rango of rangos) {
        try {
            await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
                sheetTitle,
                startRow,
                endRow,
                startColumn: rango.startColumn,
                endColumn: rango.endColumn,
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
            });
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo aplicar wrap en compromisos:', err.message);
        }
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    let buffer = await descargarBufferDrive(spreadsheetId);
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    let ws = wb.getWorksheet(titulo) || wb.worksheets[0];
    if (!ws) throw new Error('La plantilla SGC-F-16 no contiene hojas.');

    const asegurado = await asegurarFilasSecciones(spreadsheetId, titulo, datos, parsearLayoutDesdeHoja(ws));
    let layout = asegurado.layout;

    // Tras insertar filas, re-parsear desde Drive para no desalinear Notas / secciones.
    if (asegurado.insertoFilas) {
        buffer = await descargarBufferDrive(spreadsheetId);
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        ws = wb.getWorksheet(titulo) || wb.worksheets[0];
        if (!ws) throw new Error('La plantilla SGC-F-16 no contiene hojas.');
        layout = parsearLayoutDesdeHoja(ws);
    }

    const actualizaciones = datosAActualizacionesSheet(datos, titulo, layout);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    await aplicarWrapTextoCompromisos(spreadsheetId, titulo, layout);
    try {
        await driveService.aplicarFormatoVisualSgcF16(spreadsheetId, titulo, layout);
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo aplicar formato visual de secciones:', err.message);
    }
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-16 no escribe en el archivo plantilla externo.');
    }
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = resolverHojaWorkbook(wb, { sheetTitle: resolverNombreHojaActiva(datos) });
    if (!ws) throw new Error('La plantilla SGC-F-16 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 * Nunca escribe ni borra en TEMPLATE_DRIVE_ID.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede adoptar la plantilla sobre el archivo plantilla externo.');
    }
    const destino = String(tituloDestino || '').trim() || 'Minuta';
    console.warn(
        `[SGC-F-16] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}».`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    return copiada.title;
}

async function reescribirHojaMinutaDesdePlantilla(spreadsheetId, nombreHoja, datos) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede reescribir sobre el archivo plantilla externo.');
    }
    const objetivo = String(nombreHoja || '').trim();
    if (!objetivo || objetivo === 'Sin-asunto') {
        throw new Error('Nombre de hoja inválido para regenerar desde plantilla.');
    }
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    if (titulos.includes(objetivo) && !esHojaReservadaSgcF16(objetivo)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [objetivo]);
        } catch (err) {
            console.warn(`[SGC-F-16] No se pudo eliminar hoja previa «${objetivo}»:`, err.message);
        }
    }
    const tituloFinal = await adoptarPlantillaEnSistema(spreadsheetId, objetivo);
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloFinal);
    return tituloFinal;
}

/**
 * Una pestaña por minuta del archivero; nombre = Asunto.
 * No versiona por mes ni escribe en la plantilla externa.
 */
async function sincronizarHojasMinutasEnDrive(spreadsheetId, datos, datosPrevios = null, opciones = {}) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('SGC-F-16 solo escribe en el archivo sistema, nunca en la plantilla externa.');
    }
    const crearTodas = !!opciones.crearTodas;
    const regenerarActivo = !!opciones.regenerarActivo || crearTodas;
    const forzarRecrear = !!opciones.forzarRecrear;
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const setExistentes = new Set(titulosExistentes);
    const plantillaLocal = driveService.resolverTituloHojaExistente(
        titulosExistentes,
        SHEET_TITLE,
        { fallbackRegex: /plantilla/i }
    ) || '';

    const mapaPrevio = new Map();
    const ocupadosPrevios = [];
    if (prev?.minutas) {
        for (const item of prev.minutas) {
            const fijo = sanitizarNombreHoja(item.nombreHoja);
            const nombre = fijo || resolverNombreHojaMinuta(item, ocupadosPrevios);
            ocupadosPrevios.push(nombre);
            mapaPrevio.set(item.id, nombre);
        }
    }

    const minutasConContenido = (meta.minutas || []).filter((m) => minutaTieneContenido(m));
    const nombrePorId = asignarNombresHojaMinutas(minutasConContenido, mapaPrevio, titulosExistentes);
    const nombresVigentes = new Set();
    const activoId = String(meta.minutaActivaId || '').trim();
    const priorizarId = String(opciones?.priorizarId || '').trim();
    let hojaActiva = plantillaLocal || '';
    let hojaPrioritaria = '';

    for (const item of minutasConContenido) {
        let nombreHoja = nombrePorId.get(item.id) || resolverNombreHojaMinuta(item, [...nombresVigentes]);
        const hojaPrev = mapaPrevio.get(item.id);
        const esActivo = !!activoId && item.id === activoId;
        const datosHoja = datosConMinutaActiva(meta, item);

        if (
            hojaPrev
            && !tituloHojaCoincide(hojaPrev, nombreHoja)
            && buscarTituloHoja([...setExistentes], hojaPrev)
            && !esHojaReservadaSgcF16(hojaPrev)
        ) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(spreadsheetId, hojaPrev, nombreHoja);
                setExistentes.delete(buscarTituloHoja([...setExistentes], hojaPrev));
                nombreHoja = ren.title || nombreHoja;
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-16] No se pudo renombrar hoja ${hojaPrev}:`, err.message);
                nombreHoja = hojaPrev;
            }
        }

        const existe = !!buscarTituloHoja([...setExistentes], nombreHoja);

        if (existe && ((esActivo && regenerarActivo) || crearTodas || forzarRecrear)) {
            try {
                nombreHoja = await reescribirHojaMinutaDesdePlantilla(spreadsheetId, nombreHoja, datosHoja);
                setExistentes.add(nombreHoja);
                nombrePorId.set(item.id, nombreHoja);
                nombresVigentes.add(nombreHoja);
                if (item.id === priorizarId) hojaPrioritaria = nombreHoja;
                if (esActivo || (!activoId && item === minutasConContenido[0])) {
                    hojaActiva = nombreHoja;
                }
                continue;
            } catch (errRewrite) {
                console.warn(
                    `[SGC-F-16] Regenerar «${nombreHoja}» desde plantilla falló; se actualizan celdas:`,
                    errRewrite.message
                );
            }
        }

        if (!existe) {
            if (!crearTodas && !esActivo) {
                continue;
            }
            try {
                nombreHoja = await adoptarPlantillaEnSistema(spreadsheetId, nombreHoja);
                setExistentes.add(nombreHoja);
            } catch (err) {
                console.warn(`[SGC-F-16] No se pudo crear hoja "${nombreHoja}" desde plantilla:`, err.message);
                if (plantillaLocal) {
                    try {
                        const dup = await driveService.duplicarHojaGoogleSheet(
                            spreadsheetId,
                            plantillaLocal,
                            nombreHoja
                        );
                        nombreHoja = dup.title || nombreHoja;
                        setExistentes.add(nombreHoja);
                    } catch (errDup) {
                        console.warn('[SGC-F-16] Fallback duplicar hoja local falló:', errDup.message);
                        continue;
                    }
                } else {
                    continue;
                }
            }
        }

        nombrePorId.set(item.id, nombreHoja);
        nombresVigentes.add(nombreHoja);
        await actualizarDatosEnGoogleSheet(spreadsheetId, datosHoja, nombreHoja);
        if (item.id === priorizarId) hojaPrioritaria = nombreHoja;
        if (esActivo || (!activoId && item === minutasConContenido[0])) {
            hojaActiva = nombreHoja;
        }
    }

    const eliminar = [];
    for (const titulo of [...setExistentes]) {
        if (esHojaReservadaSgcF16(titulo)) continue;
        const vigente = [...nombresVigentes].some((nombre) => tituloHojaCoincide(nombre, titulo));
        const eraPrevia = [...mapaPrevio.values()].some((nombre) => tituloHojaCoincide(nombre, titulo));
        if (!vigente && eraPrevia) eliminar.push(titulo);
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, eliminar);
        } catch (err) {
            console.warn('[SGC-F-16] No se pudieron eliminar hojas de minutas obsoletas:', err.message);
        }
    }

    const alFrente = hojaPrioritaria || hojaActiva;
    if (alFrente && minutasConContenido.length) {
        try {
            await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, alFrente);
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo mostrar la hoja de la minuta al frente:', err.message);
        }
    }

    return { hojaActiva: alFrente || hojaActiva, hojasPorId: nombrePorId };
}

async function asegurarHojaMinutaEnDrive(spreadsheetId, datos, nombreHoja) {
    const objetivo = String(nombreHoja || '').trim();
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID || !objetivo || objetivo === 'Sin-asunto') {
        return false;
    }
    try {
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        let tituloFinal = buscarTituloHoja(titulos, objetivo) || objetivo;
        if (!buscarTituloHoja(titulos, objetivo)) {
            try {
                tituloFinal = await adoptarPlantillaEnSistema(spreadsheetId, objetivo);
            } catch (err) {
                console.warn(`[SGC-F-16] copyTo falló para «${objetivo}»:`, err.message);
                const plantillaLocal = driveService.resolverTituloHojaExistente(
                    titulos,
                    SHEET_TITLE,
                    { fallbackRegex: /plantilla/i }
                );
                if (!plantillaLocal) return false;
                const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, plantillaLocal, objetivo);
                tituloFinal = dup?.title || objetivo;
            }
        }
        await actualizarDatosEnGoogleSheet(spreadsheetId, datos, tituloFinal);
        return true;
    } catch (err) {
        console.warn(`[SGC-F-16] No se pudo asegurar hoja "${objetivo}":`, err.message);
        return false;
    }
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        minutas: d.minutas.map((m) => ({
            id: m.id,
            folio: m.folio,
            fechaVisita: m.fechaVisita,
            horaInicio: m.horaInicio,
            horaFin: m.horaFin,
            hora: m.hora,
            lugar: m.lugar,
            asunto: m.asunto,
            notasTomadasPor: m.notasTomadasPor,
            asistentes: m.asistentes.filter((a) => !esAsistenteVacio(a)),
            agenda: m.agenda.filter((a) => !esAgendaVacia(a)),
            compromisos: m.compromisos.filter((c) => !esCompromisoVacio(c)),
            pdfFirmadoId: m.pdfFirmado?.driveFileId || null,
            nombreHoja: m.nombreHoja || ''
        })),
        minutaActivaId: d.minutaActivaId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
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
        console.warn('[SGC-F-16] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-16] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-16] Google Sheet restaurado: ${nuevoId}`);
    return nuevoId;
}

async function asegurarDriveIdGoogleSheet(driveId, pool, registro = null) {
    const candidatos = [driveId, DRIVE_FILE_ID_SISTEMA]
        .filter((id) => id && String(id).trim() !== TEMPLATE_DRIVE_ID);
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
        throw new Error('No hay archivo SGC-F-16 configurado en Drive.');
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
        if (!val || val === TEMPLATE_DRIVE_ID) return;
        if (!candidatos.includes(val)) candidatos.push(val);
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
    const idPrevio = String(driveFileIdPrevio || '').trim();
    if (idPrevio === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede reemplazar el archivo plantilla externo de SGC-F-16.');
    }
    if (idPrevio === DRIVE_FILE_ID_SISTEMA) {
        // Conservar histograma / libro sistema; no reemplazar el archivo entero.
        return driveService.obtenerInfoArchivo(DRIVE_FILE_ID_SISTEMA);
    }
    if (idPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(idPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-16] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                idPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 8, keepSingleSheet: false }
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

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaActiva(datos);

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && hojaEditor && hojaEditor !== 'Sin-asunto') {
        try {
            let gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid == null) {
                const creada = await asegurarHojaMinutaEnDrive(driveId, datos, hojaEditor);
                if (creada) {
                    gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
                }
            }
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo resolver gid de hoja editor:', err.message);
        }
    }

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
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        hojaEditor
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
    const datosDb = await leerDatosRegistro(registro);

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId === TEMPLATE_DRIVE_ID) {
        driveFileId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveFileId && !(await esSpreadsheetEditableEnDrive(driveFileId))) {
        try {
            driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo restaurar Google Sheet al cargar:', err.message);
        }
    }
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        await guardarRegistroDb(pool, {
            driveFileId,
            datos: datosDb || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    // Preferir archivero BD; Drive solo aporta fusión de la hoja de la minuta activa.
    if (datosDb && Array.isArray(datosDb.minutas)) {
        datos = sanitizarDatos(datosDb);
    } else {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }

    let hojaEditor = null;
    if (driveFileId && driveFileId !== TEMPLATE_DRIVE_ID && datos.minutas.length) {
        const activa = resolverMinutaActiva(datos);
        hojaEditor = sanitizarNombreHoja(activa?.nombreHoja) || resolverNombreHojaMinuta(activa || {});
        try {
            const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
            if (!buscarTituloHoja(titulos, hojaEditor)) {
                const sync = await sincronizarHojasMinutasEnDrive(driveFileId, datos, null);
                aplicarNombresHojaEnDatos(datos, sync?.hojasPorId);
                hojaEditor = sync?.hojaActiva || hojaEditor;
                await guardarRegistroDb(pool, {
                    driveFileId,
                    datos,
                    fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion,
                    fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
                    contenidoModificado: !!registro?.contenido_modificado
                });
                registro = await obtenerRegistroDb(pool);
            } else {
                const buffer = await descargarBufferDrive(driveFileId);
                const datosHoja = await leerDatosDesdeBuffer(buffer, { sheetTitle: hojaEditor });
                if (hojaTieneContenido(datosHoja)) {
                    datos = fusionarHojaEnMinutaActiva(datos, datosHoja);
                }
            }
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo leer/sincronizar hojas:', err.message);
        }
    } else if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
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
    return await construirRespuesta(registro, datos, archivoDrive, { hojaEditor });
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

    const rawDatos = body?.datos || body || {};
    const minutaActivaId = body?.minutaActivaId || rawDatos?.minutaActivaId || null;
    const datosEntrada = sanitizarDatos({
        ...rawDatos,
        minutaActivaId: minutaActivaId || rawDatos?.minutaActivaId
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
    if (driveId === TEMPLATE_DRIVE_ID) {
        driveId = DRIVE_FILE_ID_SISTEMA;
    }
    if (driveId) {
        driveId = await asegurarDriveIdGoogleSheet(driveId, pool, registroPrevio);
    }

    let datosGuardar = { ...datosEntrada };

    if (!huboCambio && driveId && driveId !== TEMPLATE_DRIVE_ID
        && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const sync = await sincronizarHojasMinutasEnDrive(driveId, datosEntrada, datosPrevios, {
                regenerarActivo: false,
                priorizarId: datosEntrada.minutaActivaId || null
            });
            aplicarNombresHojaEnDatos(datosGuardar, sync?.hojasPorId);
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo re-sincronizar hojas en Drive:', err.message);
        }
        const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
        return await construirRespuesta(
            { ...registroPrevio, drive_file_id: driveId },
            datosGuardar,
            archivoDrive,
            { hojaEditor: resolverNombreHojaActiva(datosGuardar) }
        );
    }

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    if (driveId && driveId !== TEMPLATE_DRIVE_ID && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const sync = await sincronizarHojasMinutasEnDrive(driveId, datosGuardar, datosPrevios, {
                // Regenerar estructura solo con «Actualizar plantilla»; aquí copyTo si falta hoja / rename Asunto.
                regenerarActivo: false,
                priorizarId: datosGuardar.minutaActivaId || null
            });
            aplicarNombresHojaEnDatos(datosGuardar, sync?.hojasPorId);
            const archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);

            await guardarRegistroDb(pool, {
                driveFileId: driveId,
                datos: datosGuardar,
                fechaElaboracionOriginal: fechaOriginal,
                fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                contenidoModificado
            });
            const registro = await obtenerRegistroDb(pool);
            return await construirRespuesta(registro, datosGuardar, archivoDrive, {
                hojaEditor: sync?.hojaActiva || resolverNombreHojaActiva(datosGuardar)
            });
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    // Fallback: no reemplazar sistema/plantilla; persistir solo BD si Drive falló.
    await guardarRegistroDb(pool, {
        driveFileId: driveId || registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    return await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaActiva(datosGuardar)
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
        return cargarFormato(pool);
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    let fechaOriginal = formatearFechaIso(registro.fecha_elaboracion_original);
    let contenidoModificado = !!registro.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registro.fecha_modificacion_contenido);

    const datosPrevios = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    if (!fechaOriginal) {
        fechaOriginal = datosPrevios.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const activa = resolverMinutaActiva(datosPrevios);
    const hojaEditor = sanitizarNombreHoja(activa?.nombreHoja) || resolverNombreHojaMinuta(activa || {});
    let datosDrive = null;
    try {
        const buffer = await descargarBufferDrive(driveFileId);
        datosDrive = await leerDatosDesdeBuffer(buffer, { sheetTitle: hojaEditor });
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo leer hoja activa desde Drive:', err.message);
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosPrevios, archivoDrive, {
            hojaEditor
        });
    }

    // Fusionar hoja en minuta activa; preservar resto del archivero y PDFs firmados.
    const datosFusionados = fusionarHojaEnMinutaActiva(datosPrevios, datosDrive);

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosFusionados);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return await construirRespuesta(
            { ...registro, drive_file_id: driveFileId },
            datosFusionados,
            archivoDrive,
            { hojaEditor }
        );
    }

    contenidoModificado = true;
    fechaModificacion = fechaHoyIso();
    const datosGuardar = {
        ...datosFusionados,
        fechaElaboracion: fechaModificacion
    };

    try {
        const sync = await sincronizarHojasMinutasEnDrive(driveFileId, datosGuardar, datosPrevios, {
            regenerarActivo: false,
            priorizarId: datosGuardar.minutaActivaId || null
        });
        aplicarNombresHojaEnDatos(datosGuardar, sync?.hojasPorId);
    } catch (err) {
        console.warn('[SGC-F-16] Sync hojas tras lectura Drive:', err.message);
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: fechaModificacion,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);

    return await construirRespuesta(registroActualizado, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaActiva(datosGuardar)
    });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        datos = sanitizarDatos(DATOS_DEFECTO);
    }
    datos = sanitizarDatos(datos);

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = {
        ...datos,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    const driveId = await resolverDriveFileId(registro);
    if (!driveId || driveId === TEMPLATE_DRIVE_ID) {
        const error = new Error(
            driveId === TEMPLATE_DRIVE_ID
                ? 'SGC-F-16 no puede regenerar sobre la plantilla externa.'
                : 'No se encontró el archivo SGC-F-16 (sistema) en Drive.'
        );
        error.statusCode = 404;
        throw error;
    }

    // Regenerar hojas de minutas desde plantilla externa; histograma del sistema intacto.
    let archivoDrive = null;
    try {
        const titulos = await driveService.listarHojasGoogleSheet(driveId);
        const hojasMinuta = (titulos || []).filter((t) => {
            if (esHojaReservadaSgcF16(t)) return false;
            return (datosPublicar.minutas || []).some((m) => {
                const nombre = sanitizarNombreHoja(m.nombreHoja) || resolverNombreHojaMinuta(m);
                return tituloHojaCoincide(nombre, t);
            });
        });
        if (hojasMinuta.length) {
            try {
                await driveService.eliminarHojasGoogleSheet(driveId, hojasMinuta);
            } catch (err) {
                console.warn('[SGC-F-16] No se pudieron eliminar hojas de minuta previas:', err.message);
            }
        }
        const sync = await sincronizarHojasMinutasEnDrive(driveId, datosPublicar, null, { crearTodas: true });
        aplicarNombresHojaEnDatos(datosPublicar, sync?.hojasPorId);
        archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }));
    } catch (err) {
        console.warn('[SGC-F-16] Error al regenerar desde plantilla:', err.message);
        throw err;
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosPublicar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return await construirRespuesta(registroActualizado, datosPublicar, archivoDrive, {
        hojaEditor: resolverNombreHojaActiva(datosPublicar)
    });
}

function nombrePdfHistorial(folio = '', fechaIso = fechaHoyIso()) {
    const iso = formatearFechaIso(fechaIso) || fechaHoyIso();
    const parts = iso.split('-');
    const mm = parts[1] || '01';
    const yy = (parts[0] || '').slice(2, 4) || '00';
    const tag = String(folio || 'sin-folio').replace(/[^\w.-]+/g, '_');
    return `SGC-F-16 ${tag} - ${mm}/${yy}.pdf`;
}

async function publicarPdfEnDrive(pdfBuffer, folio) {
    const nombreArchivo = nombrePdfHistorial(folio);
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombreArchivo,
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const minutaId = String(body?.minutaId || body?.minuta_id || '').trim();
    if (!minutaId) throw new Error('Se requiere minutaId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const minutas = Array.isArray(datosPrevios.minutas) ? [...datosPrevios.minutas] : [];
    const idx = minutas.findIndex((m) => m.id === minutaId);
    if (idx < 0) {
        throw new Error('No se encontró la minuta indicada en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, minutas[idx].folio);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfHistorial(minutas[idx].folio),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    minutas[idx] = { ...minutas[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        minutas,
        minutaActivaId: minutaId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: fechaHoyIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    const respuesta = await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaActiva(datosGuardar)
    });
    return { ...respuesta, pdfFirmado };
}

async function descargarPlantillaPdf(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet SGC-F-16 configurado para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    const datosDb = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const minutaId = String(opciones.minutaId || opciones.id || '').trim() || null;
    let datos = datosDb;

    if (minutaId) {
        const minuta = (datosDb.minutas || []).find((m) => m.id === minutaId) || null;
        if (!minuta) {
            const err = new Error('No se encontró la minuta indicada para exportar a PDF.');
            err.statusCode = 404;
            throw err;
        }
        datos = sanitizarDatos({ ...datosDb, minutaActivaId: minutaId });
    } else {
        datos = sanitizarDatos({
            ...datosDb,
            minutaActivaId: datosDb.minutaActivaId || resolverMinutaActiva(datosDb)?.id || null
        });
    }

    const minutaActiva = resolverMinutaActiva(datos);
    if (!minutaActiva || !minutaTieneContenido(minutaActiva)) {
        const err = new Error('Abre o selecciona una minuta con datos para exportar a PDF.');
        err.statusCode = 400;
        throw err;
    }

    // Asegurar hoja con nombre = Asunto y escribir la minuta pedida.
    const tituloHoja = resolverNombreHojaActiva(datos);
    if (!tituloHoja || tituloHoja === 'Sin-asunto') {
        const err = new Error('Indica el Asunto de la minuta para exportar a PDF (nombra la hoja en Excel).');
        err.statusCode = 400;
        throw err;
    }
    try {
        const sync = await sincronizarHojasMinutasEnDrive(driveFileId, datos, null, {
            regenerarActivo: false,
            priorizarId: minutaActiva.id
        });
        aplicarNombresHojaEnDatos(datos, sync?.hojasPorId);
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo sincronizar la minuta a Drive antes del PDF:', err.message);
        throw new Error(
            'No se pudo sincronizar la minuta activa a Drive antes de exportar el PDF. Intenta guardar e intentar de nuevo.'
        );
    }
    const tituloFinal = resolverNombreHojaActiva(datos) || tituloHoja;

    if (minutaId && datosDb.minutaActivaId !== minutaId) {
        try {
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso(),
                fechaModificacionContenido: formatearFechaIso(registro?.fecha_modificacion_contenido),
                contenidoModificado: !!registro?.contenido_modificado
            });
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo persistir minutaActivaId previo a PDF:', err.message);
        }
    }

    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloFinal);
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloFinal}» para exportar a PDF.`);
    }

    // Carta, vertical, ajustar al ancho, márgenes normales (UI Sheets).
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, {
        gid,
        landscape: false,
        size: 'letter',
        margins: 'normal'
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-16 quedó vacía.');
    }

    const folio = String(minutaActiva.folio || '').trim() || 'Minuta';
    const nombreSeguro = `SGC-F-16 ${folio}`.replace(/[^\w.\- áéíóúÁÉÍÓÚñÑ()]+/gi, '_').trim()
        || 'SGC-F-16 Minuta';
    return {
        buffer: Buffer.from(pdfBuffer),
        nombreArchivo: `${nombreSeguro}.pdf`
    };
}

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    descargarPlantillaPdf,
    sanitizarDatos,
    crearMinutaVacia,
    nuevoIdMinuta,
    resolverMinutaActiva,
    aPayloadHoja,
    adoptarPlantillaEnSistema,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA
};
