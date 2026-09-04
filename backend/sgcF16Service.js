/**
 * SGC-F-16 · Minuta — persistencia en biznaga_sgc y sync con Drive.
 *
 * Plantilla (hoja «Plantilla»):
 *   C5 fecha de visita · F5 hora · C7 lugar · C9 asunto
 *   Asistentes desde F13 · Agenda desde F17 · Compromisos desde F21
 *   D23 notas tomadas por
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-16';
const TEMPLATE_DRIVE_ID = '1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M';
const DRIVE_FILE_ID_SISTEMA = '1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
/** PDF firmados (histórico por minuta); distinto de la carpeta del Google Sheet. */
const CARPETA_PDF_FIRMADOS_ID = '1iFcoHpSBBsukq-dL_R-HsCD6FWfhzXvz';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-16 Minuta (sistema)';
const SHEET_TITLE = 'Plantilla';

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
        pdfFirmado: null
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
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado)
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
            pdfFirmado: m.pdfFirmado
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

    return sanitizarDatos({
        revision: extraerRevision(celdaATexto(ws.getRow(layout.revision.row).getCell(layout.revision.col).value)),
        fechaRevision: extraerFechaRevision(celdaATexto(ws.getRow(layout.fechaRevision.row).getCell(layout.fechaRevision.col).value)),
        fechaVisita: celdaATexto(ws.getRow(layout.fecha.row).getCell(layout.fecha.col).value),
        hora: celdaATexto(ws.getRow(layout.hora.row).getCell(layout.hora.col).value),
        lugar: celdaATexto(ws.getRow(layout.lugar.row).getCell(layout.lugar.col).value),
        asunto: celdaATexto(ws.getRow(layout.asunto.row).getCell(layout.asunto.col).value),
        notasTomadasPor: celdaATexto(ws.getRow(layout.notas.row).getCell(layout.notas.col).value),
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
        return await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            SHEET_TITLE,
            CODIGO_FORMATO
        );
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
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
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = await obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-16 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
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
            pdfFirmadoId: m.pdfFirmado?.driveFileId || null
        })),
        minutaActivaId: d.minutaActivaId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
}

function estructuraEsEquivalente() {
    return true;
}

async function aplicarHistorialSgcF16(opciones) {
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
            console.warn('[SGC-F-16] No se pudo reescribir hoja tras historial:', err.message);
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
                console.warn('[SGC-F-16] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
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
    const datosDb = await leerDatosRegistro(registro);

    let driveFileId = await resolverDriveFileId(registro);
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

    let datosHoja = null;
    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datosHoja = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    // Preferir archivero BD; fusionar hoja solo en la minuta activa (no sobrescribir minutas[]).
    if (datosDb && Array.isArray(datosDb.minutas) && datosDb.minutas.length) {
        if (datosHoja && hojaTieneContenido(datosHoja)) {
            datos = fusionarHojaEnMinutaActiva(datosDb, datosHoja);
        } else {
            datos = datosDb;
        }
    } else if (datosHoja) {
        datos = sanitizarDatos(datosHoja);
    } else {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[SGC-F-16] No se pudo leer plantilla, usando datos por defecto:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
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
            const hist = await aplicarHistorialSgcF16({
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
            console.warn('[SGC-F-16] No se pudo actualizar Google Sheet:', err.message);
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

    // Fusionar hoja en minuta activa; preservar resto del archivero y PDFs firmados.
    const datosFusionados = fusionarHojaEnMinutaActiva(
        datosPrevios || sanitizarDatos(DATOS_DEFECTO),
        datosDrive
    );

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosFusionados);
    if (!huboCambio) {
        const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosFusionados, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF16({
        spreadsheetId: driveFileId,
        datosPrevios,
        datosNuevos: datosFusionados,
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
            console.warn('[SGC-F-16] Archivo previo no encontrado al actualizar plantilla:', err.message);
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
    const respuesta = construirRespuesta(registro, datosGuardar, archivoDrive);
    return { ...respuesta, pdfFirmado };
}

async function descargarPlantillaPdf(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    let driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) {
        throw new Error('No hay Google Sheet SGC-F-16 configurado para exportar a PDF.');
    }
    driveFileId = await asegurarDriveIdGoogleSheet(driveFileId, pool, registro);

    // Solo la hoja vigente/activa (p. ej. SGCF16-0826), no Plantilla ni históricas.
    const tituloHoja = await resolverTituloHojaTrabajo(driveFileId);
    let gid = null;
    try {
        gid = await driveService.obtenerGidHojaPorNombre(driveFileId, tituloHoja);
    } catch (err) {
        console.warn('[SGC-F-16] No se pudo resolver gid de hoja para PDF:', err.message);
    }
    if (gid == null) {
        throw new Error(`No se encontró la hoja activa «${tituloHoja}» para exportar a PDF.`);
    }

    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(driveFileId, { gid });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SGC-F-16 quedó vacía.');
    }
    return Buffer.from(pdfBuffer);
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
    aPayloadHoja
};
