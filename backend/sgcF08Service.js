/**
 * SGC-F-08 · Plan de auditoría — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-08';
const TEMPLATE_DRIVE_ID = '19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0';
const DRIVE_FILE_ID_SISTEMA = '19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-08 Plan de auditoría (sistema)';
const SHEET_TITLE = 'Plan';

const AGENDA_START_ROW = 22;
const AGENDA_END_ROW = 37;
const ROLES_START_ROW = 38;
const ROLES_END_ROW = 42;

const CELDAS = {
    revision: 'F2',
    fechaRevision: 'F3',
    auditoriaNo: 'B5',
    fechaElaboracionInforme: 'E6',
    fechaInicio: 'B6',
    fechaTermino: 'B7',
    fechaEntregaInforme: 'E8',
    empresa: 'B8',
    ubicacion: 'B9',
    criteriosAuditoria: 'C11',
    alcanceAuditoria: 'C12',
    objetivoAuditoria: 'C13',
    auditorLider: 'B15',
    metodoAuditoria: 'G15',
    equipoAuditor: 'A17',
    numObservadores: 'G16',
    numInterpretes: 'G17',
    numGuias: 'G18'
};

const EQUIPO_AUDITOR_ROW = 17;
const EQUIPO_AUDITOR_END_ROW = 19;

const AGENDA_DEFECTO = [
    {
        actividad: 'Reunión de Apertura de Auditoría',
        fecha: '',
        hora: 'No aplica',
        areaDepto: 'No aplica',
        criterio: 'No aplica',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '4.1 Comprensión de las necesidades y su contexto\n4.2 Comprensión de las partes interesadas\n4.3 Determinación del alcance\n5.1 Liderazgo\n5.1.2 Enfoque al cliente\n6.2 Objetivos de calidad\n5.2 Política\n4.4 Sistema de Gestión de Calidad y sus procesos.\n9.3 Revisión por la dirección\n10.3 Mejora continua',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '6.3 Planificación de los cambios\n7.1.5 Recursos de seguimiento y medición\n7.1.6 Conocimiento de la organización\n7.5 Información documentada\n7.3 Toma de conciencia\n8.5.3 Propiedad del cliente.\n10.2 No conformidad y acciones correctivas\n9.1. Seguimiento, medición y análisis.\n9.1.3 Análisis y evaluación.\n9.2 Auditoría interna.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '5.3 Roles, responsabilidad y autoridades\n7.1.4 Ambiente para la Operación de los procesos\n7.2 Competencia\n7.3 Toma de conciencia\n7.4 Comunicación (Interna)',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1.3 Infraestructura\n8.5.4 Preservación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '7.1 Recursos\n9.1.3 Análisis y evaluación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.4 Control de procesos, productos y servicios suministrados externamente.\n8.4.2. Tipo, alcance y control.\n8.4.3 Información para los proveedores externos',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.5.1 Control de la producción.\n8.5.6 Control de los cambios',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.5.1 Control de la producción.\n8.5.6 Control de los cambios',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.4 Control de procesos, productos y servicios suministrados externamente\n8.5.4 Preservación',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '8.1 planificación y control operacional.\n8.4 Control de procesos, productos y servicios suministrados externamente.\n8.5.1 Control de la producción.\n8.5.2 Identificación y trazabilidad\n8.6 Liberación de los productos y servicios.\n8.7 Control de las salidas no conformes.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: '',
        fecha: '',
        hora: '',
        areaDepto: '',
        criterio: '5.1.2 Enfoque al cliente\n7.4 Comunicación (Externa).\n8.2.2 Determinación para los requisitos para los productos y servicios.\n8.2.3 Revisión de los requisitos para los productos y servicios.\n8.5.5 Actividades posteriores a la entrega.\n9.1.2 Satisfacción al cliente.',
        auditado: '',
        auditor: ''
    },
    {
        actividad: 'Cierre de Auditoría',
        fecha: '',
        hora: 'No aplica',
        areaDepto: 'No aplica',
        criterio: 'No aplica',
        auditado: '',
        auditor: ''
    }
];

const ROLES_DEFECTO = [
    'Auditor líder: coordinar la auditoría interna y asignar a cada miembro del equipo la responsabilidad para auditar procesos.',
    'Equipo auditor: auditar procesos, funciones, actividades o lugares específicos, según sea apropiado.',
    'Observador: acompaña al equipo auditor y vigila el curso de la auditoría, pero no tiene funciones de auditor.',
    'Guía: asiste al equipo auditor y actúan cuando lo solicite el auditor.'
];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-14',
    fechaElaboracion: '2025-01-14',
    auditoriaNo: '',
    fechaElaboracionInforme: '',
    fechaInicio: '',
    fechaTermino: '',
    fechaEntregaInforme: '',
    empresa: '',
    ubicacion: '',
    criteriosAuditoria: '',
    alcanceAuditoria: 'Toda la Norma, excepto el apartado 8.3 Diseño y desarrollo de productos y servicios.',
    objetivoAuditoria: 'Identificar las oportunidades para la mejora del SGC.',
    auditorLider: '',
    metodoAuditoria: 'En sitio',
    equipoAuditor: '',
    numObservadores: '0',
    numInterpretes: '0',
    numGuias: '0',
    agenda: AGENDA_DEFECTO.map((fila) => ({ ...fila })),
    roles: [...ROLES_DEFECTO]
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
        const m = String(fecha).match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
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

function formatearFechaDisplay(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function parsearRevisionDesdeTexto(texto) {
    const match = String(texto || '').match(/revisi[oó]n\s*:?\s*(\d+)/i);
    return match ? String(match[1]).padStart(2, '0') : '';
}

function parsearFechaRevisionDesdeTexto(texto) {
    const match = String(texto || '').match(/fecha\s*(?:de\s*)?revisi[oó]n\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
    if (match) {
        return formatearFechaIso(match[1].replace(/-/g, '/'));
    }
    return '';
}

function deduplicarCriterioEnFilaAgenda(fila) {
    const item = { ...fila };
    const crit = item.criterio;
    if (!crit) {
        return item;
    }
    if (item.auditado && item.auditado === crit) {
        item.auditado = '';
    }
    if (item.auditor && item.auditor === crit) {
        item.auditor = '';
    }
    if (item.auditado && item.auditor && item.auditor === item.auditado && item.auditado === crit) {
        item.auditor = '';
    }
    return item;
}

function sanitizarFilaAgenda(item) {
    return deduplicarCriterioEnFilaAgenda({
        actividad: String(item?.actividad || '').trim(),
        fecha: String(item?.fecha || '').trim(),
        hora: String(item?.hora || '').trim(),
        areaDepto: String(item?.areaDepto || '').trim(),
        criterio: String(item?.criterio || '').trim(),
        auditado: String(item?.auditado || '').trim(),
        auditor: String(item?.auditor || '').trim()
    });
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const agenda = Array.isArray(base.agenda) ? base.agenda : DATOS_DEFECTO.agenda;
    const roles = Array.isArray(base.roles) ? base.roles : DATOS_DEFECTO.roles;
    const fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;

    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || fechaRevision,
        auditoriaNo: String(base.auditoriaNo || '').trim(),
        fechaElaboracionInforme: String(base.fechaElaboracionInforme || '').trim(),
        fechaInicio: String(base.fechaInicio || '').trim(),
        fechaTermino: String(base.fechaTermino || '').trim(),
        fechaEntregaInforme: String(base.fechaEntregaInforme || '').trim(),
        empresa: String(base.empresa || '').trim(),
        ubicacion: String(base.ubicacion || '').trim(),
        criteriosAuditoria: String(base.criteriosAuditoria || '').trim(),
        alcanceAuditoria: String(base.alcanceAuditoria || DATOS_DEFECTO.alcanceAuditoria).trim(),
        objetivoAuditoria: String(base.objetivoAuditoria || DATOS_DEFECTO.objetivoAuditoria).trim(),
        auditorLider: String(base.auditorLider || '').trim(),
        metodoAuditoria: String(base.metodoAuditoria || DATOS_DEFECTO.metodoAuditoria).trim(),
        equipoAuditor: String(base.equipoAuditor || '').trim(),
        numObservadores: String(base.numObservadores ?? DATOS_DEFECTO.numObservadores).trim(),
        numInterpretes: String(base.numInterpretes ?? DATOS_DEFECTO.numInterpretes).trim(),
        numGuias: String(base.numGuias ?? DATOS_DEFECTO.numGuias).trim(),
        agenda: agenda.map(sanitizarFilaAgenda),
        roles: roles.map((r) => String(r || '').trim()).filter(Boolean)
    };
}

function leerTextoMultiFilasColumna(ws, col, startRow, endRow, omitirPatrones = []) {
    const partes = [];
    for (let r = startRow; r <= endRow; r++) {
        const t = celdaATexto(ws.getRow(r).getCell(col).value);
        if (!t) continue;
        const lower = t.toLowerCase();
        if (omitirPatrones.some((pat) => lower.includes(pat))) continue;
        partes.push(t);
    }
    return partes.join('\n').trim();
}

function leerValorCampo(ws, celdaPrincipal, alternativas = [], patronesOmitir = []) {
    const candidatos = [celdaPrincipal, ...alternativas].filter(Boolean);
    for (const addr of candidatos) {
        const t = celdaATexto(ws.getCell(addr).value);
        if (!t) continue;
        const low = t.toLowerCase();
        if (patronesOmitir.some((pat) => low.includes(pat))) continue;
        return t;
    }
    return '';
}

function leerCampoMultilineaHoja(ws, rowNum, celdasPreferidas = [], patronesOmitir = []) {
    for (const addr of celdasPreferidas) {
        const t = leerValorCampo(ws, addr, [], patronesOmitir);
        if (t) return t;
    }
    for (let col = 3; col <= 8; col++) {
        const t = celdaATexto(ws.getRow(rowNum).getCell(col).value);
        if (!t) continue;
        const low = t.toLowerCase();
        if (patronesOmitir.some((pat) => low.includes(pat))) continue;
        return t;
    }
    return '';
}

function resolverFechaRevisionDocumento(datos, datosPrevios) {
    void datos;
    void datosPrevios;
    return DATOS_DEFECTO.fechaRevision;
}

function esTextoPlaceholderSgcF08(valor) {
    const texto = String(valor || '').trim().toLowerCase();
    if (!texto) return true;
    if (texto === 'ejemplo') return true;
    if (texto === 'criterios de auditoría:') return true;
    if (texto === 'alcance de auditoría:') return true;
    if (texto === 'objetivo(s) de auditoría:') return true;
    return false;
}

function fusionarDatosPreservandoTexto(datosNuevos, datosPrevios) {
    const d = sanitizarDatos(datosNuevos || {});
    if (!datosPrevios) {
        d.fechaRevision = resolverFechaRevisionDocumento(d, null);
        return d;
    }
    const p = sanitizarDatos(datosPrevios);
    if (esTextoPlaceholderSgcF08(d.criteriosAuditoria) && p.criteriosAuditoria) {
        d.criteriosAuditoria = p.criteriosAuditoria;
    }
    if (
        (esTextoPlaceholderSgcF08(d.alcanceAuditoria)
            || d.alcanceAuditoria === DATOS_DEFECTO.alcanceAuditoria)
        && p.alcanceAuditoria
    ) {
        d.alcanceAuditoria = p.alcanceAuditoria;
    }
    if (
        (esTextoPlaceholderSgcF08(d.objetivoAuditoria)
            || d.objetivoAuditoria === DATOS_DEFECTO.objetivoAuditoria)
        && p.objetivoAuditoria
    ) {
        d.objetivoAuditoria = p.objetivoAuditoria;
    }
    d.fechaRevision = resolverFechaRevisionDocumento(d, p);
    if (Array.isArray(d.agenda) && Array.isArray(p.agenda)) {
        d.agenda = d.agenda.map((fila, i) => {
            const prev = p.agenda[i];
            if (!prev) return fila;
            const merged = { ...fila };
            if (!merged.auditado && prev.auditado) merged.auditado = prev.auditado;
            if (!merged.auditor && prev.auditor) merged.auditor = prev.auditor;
            return sanitizarFilaAgenda(merged);
        });
    }
    return d;
}

function pushCampoMultilineaSheet(actualizaciones, rowNum, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`C${rowNum}:H${rowNum}`, sheetTitle),
        values: [[valor || '']]
    });
}

function pushCriterioAgenda(actualizaciones, criterio, rowNum, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`D${rowNum}`, sheetTitle),
        values: [[criterio || '']]
    });
}

function esTextoCriterioAgenda(texto) {
    const s = String(texto || '').trim();
    if (!s) return false;
    if (/^\d+\.\d/.test(s)) return true;
    if (s.length >= 48) return true;
    if (/comprensión de las necesidades|planificación y control|infraestructura/i.test(s)) return true;
    return false;
}

function leerEquipoAuditorDesdeHoja(ws) {
    const principal = celdaATexto(ws.getCell(CELDAS.equipoAuditor).value);
    const desdeA = leerTextoMultiFilasColumna(
        ws,
        1,
        EQUIPO_AUDITOR_ROW,
        EQUIPO_AUDITOR_END_ROW,
        ['equipo auditor', 'no. de', 'auditor líder', 'método de auditoría']
    );
    const desdeB = leerTextoMultiFilasColumna(
        ws,
        2,
        16,
        EQUIPO_AUDITOR_END_ROW,
        ['equipo auditor', 'no. de', 'auditor líder', 'método de auditoría']
    );
    return principal || desdeA || desdeB;
}

function resolverCriterioAgendaFila(d, e, a) {
    const criterioEnD = d || '';
    if (criterioEnD) {
        if (e && e === criterioEnD) return criterioEnD;
        if (e && esTextoCriterioAgenda(e)) {
            return e.includes(criterioEnD) ? e : `${criterioEnD}\n${e}`.trim();
        }
        return criterioEnD;
    }
    if (e && esTextoCriterioAgenda(e)) return e;
    if (esTextoCriterioAgenda(a)) return a;
    return e || '';
}

function leerFilaAgenda(row) {
    const a = celdaATexto(row.getCell(1).value);
    const b = celdaATexto(row.getCell(2).value);
    const c = celdaATexto(row.getCell(3).value);
    const d = celdaATexto(row.getCell(4).value);
    const e = celdaATexto(row.getCell(5).value);
    const f = celdaATexto(row.getCell(6).value);
    const g = celdaATexto(row.getCell(7).value);

    const usarLayoutLegacy = !!g || (esTextoCriterioAgenda(e) && !esTextoCriterioAgenda(f));
    const criterioExtra = usarLayoutLegacy ? e : (!f && !g && esTextoCriterioAgenda(e) ? e : '');

    let auditado = usarLayoutLegacy ? f : e;
    let auditor = usarLayoutLegacy ? g : (f || g);

    if (!auditado && !auditor && e && d && esTextoCriterioAgenda(d) && !esTextoCriterioAgenda(e)) {
        auditado = e;
    }

    if (/apertura de auditoría|cierre de auditoría/i.test(a)) {
        return sanitizarFilaAgenda({
            actividad: a,
            hora: b,
            areaDepto: c,
            criterio: resolverCriterioAgendaFila(d, criterioExtra, a),
            auditado,
            auditor
        });
    }

    const criterioFinal = resolverCriterioAgendaFila(d, criterioExtra, a);
    const fechaEnA = esTextoCriterioAgenda(a) ? '' : a;

    if (fechaEnA || b || c) {
        return sanitizarFilaAgenda({
            fecha: fechaEnA,
            hora: b,
            areaDepto: c,
            criterio: criterioFinal,
            auditado,
            auditor
        });
    }

    if (criterioFinal) {
        return sanitizarFilaAgenda({
            criterio: criterioFinal,
            auditado,
            auditor
        });
    }

    return sanitizarFilaAgenda({
        fecha: a,
        hora: b,
        areaDepto: c,
        criterio: d,
        auditado,
        auditor
    });
}

function escribirFilaAgenda(row, item) {
    const fila = sanitizarFilaAgenda(item);
    for (let col = 1; col <= 7; col++) {
        asignarTextoSimple(row.getCell(col), '', 'left');
    }

    if (fila.actividad) {
        asignarTextoSimple(row.getCell(1), fila.actividad);
        asignarTextoSimple(row.getCell(2), fila.hora || 'No aplica', 'center');
        asignarTextoSimple(row.getCell(3), fila.areaDepto || 'No aplica', 'center');
        asignarTextoSimple(row.getCell(4), fila.criterio || 'No aplica', 'left');
        asignarTextoSimple(row.getCell(5), fila.auditado, 'left');
        asignarTextoSimple(row.getCell(6), fila.auditor, 'left');
        asignarTextoSimple(row.getCell(7), '', 'left');
        return;
    }

    if (fila.criterio && !fila.fecha && !fila.hora && !fila.areaDepto) {
        asignarTextoSimple(row.getCell(4), fila.criterio, 'left');
        asignarTextoSimple(row.getCell(5), fila.auditado, 'left');
        asignarTextoSimple(row.getCell(6), fila.auditor, 'left');
        asignarTextoSimple(row.getCell(7), '', 'left');
        return;
    }

    asignarTextoSimple(row.getCell(1), fila.fecha, 'left');
    asignarTextoSimple(row.getCell(2), fila.hora, 'left');
    asignarTextoSimple(row.getCell(3), fila.areaDepto, 'left');
    asignarTextoSimple(row.getCell(4), fila.criterio, 'left');
    asignarTextoSimple(row.getCell(5), fila.auditado, 'left');
    asignarTextoSimple(row.getCell(6), fila.auditor, 'left');
    asignarTextoSimple(row.getCell(7), '', 'left');
}

function esFilaAgendaVacia(item) {
    const fila = sanitizarFilaAgenda(item);
    return !fila.actividad && !fila.fecha && !fila.hora && !fila.areaDepto
        && !fila.criterio && !fila.auditado && !fila.auditor;
}

function leerAgendaDesdeHoja(ws) {
    const agenda = [];
    for (let r = AGENDA_START_ROW; r <= AGENDA_END_ROW; r++) {
        const cellA = celdaATexto(ws.getRow(r).getCell(1).value);
        if (/^roles y responsabilidades/i.test(cellA.trim())) {
            break;
        }
        const fila = leerFilaAgenda(ws.getRow(r));
        if (esFilaAgendaVacia(fila)) {
            continue;
        }
        agenda.push(fila);
    }
    return agenda.length ? agenda : DATOS_DEFECTO.agenda.map((f) => ({ ...f }));
}

function escribirAgendaEnHoja(ws, agendaRaw) {
    const agenda = Array.isArray(agendaRaw) && agendaRaw.length ? agendaRaw : DATOS_DEFECTO.agenda;
    const totalSlots = AGENDA_END_ROW - AGENDA_START_ROW + 1;
    for (let i = 0; i < totalSlots; i++) {
        const rowNum = AGENDA_START_ROW + i;
        const fila = i < agenda.length ? sanitizarFilaAgenda(agenda[i]) : sanitizarFilaAgenda({});
        escribirFilaAgenda(ws.getRow(rowNum), fila);
    }
}

function pushActualizacionesFilaAgenda(actualizaciones, fila, rowNum, sheetTitle) {
    const item = sanitizarFilaAgenda(fila);

    if (item.actividad) {
        actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [[item.actividad]] });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [[item.hora || 'No aplica']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [[item.areaDepto || 'No aplica']] });
        pushCriterioAgenda(actualizaciones, item.criterio || 'No aplica', rowNum, sheetTitle);
        actualizaciones.push({ range: rangoSheet(`E${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
        actualizaciones.push({ range: rangoSheet(`F${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
        actualizaciones.push({ range: rangoSheet(`G${rowNum}`, sheetTitle), values: [['']] });
        return;
    }

    if (item.criterio && !item.fecha && !item.hora && !item.areaDepto) {
        actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [['']] });
        actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [['']] });
        pushCriterioAgenda(actualizaciones, item.criterio, rowNum, sheetTitle);
        actualizaciones.push({ range: rangoSheet(`E${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
        actualizaciones.push({ range: rangoSheet(`F${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
        actualizaciones.push({ range: rangoSheet(`G${rowNum}`, sheetTitle), values: [['']] });
        return;
    }

    actualizaciones.push({ range: rangoSheet(`A${rowNum}`, sheetTitle), values: [[item.fecha || '']] });
    actualizaciones.push({ range: rangoSheet(`B${rowNum}`, sheetTitle), values: [[item.hora || '']] });
    actualizaciones.push({ range: rangoSheet(`C${rowNum}`, sheetTitle), values: [[item.areaDepto || '']] });
    pushCriterioAgenda(actualizaciones, item.criterio || '', rowNum, sheetTitle);
    actualizaciones.push({ range: rangoSheet(`E${rowNum}`, sheetTitle), values: [[item.auditado || '']] });
    actualizaciones.push({ range: rangoSheet(`F${rowNum}`, sheetTitle), values: [[item.auditor || '']] });
    actualizaciones.push({ range: rangoSheet(`G${rowNum}`, sheetTitle), values: [['']] });
}

function parsearDatosDesdeHoja(ws) {
    const revisionTexto = celdaATexto(ws.getCell(CELDAS.revision).value);
    const revision = parsearRevisionDesdeTexto(revisionTexto) || DATOS_DEFECTO.revision;
    const fechaRevisionTexto = celdaATexto(ws.getCell(CELDAS.fechaRevision).value)
        || celdaATexto(ws.getCell('A3').value);
    const fechaRevision = parsearFechaRevisionDesdeTexto(fechaRevisionTexto)
        || DATOS_DEFECTO.fechaRevision;

    const agenda = leerAgendaDesdeHoja(ws);

    const roles = [];
    for (let r = ROLES_START_ROW; r <= ROLES_END_ROW; r++) {
        const texto = celdaATexto(ws.getRow(r).getCell(1).value);
        if (texto) roles.push(texto);
    }

    const equipoAuditor = leerEquipoAuditorDesdeHoja(ws);

    return sanitizarDatos({
        revision,
        fechaRevision,
        fechaElaboracion: fechaRevision,
        auditoriaNo: celdaATexto(ws.getCell(CELDAS.auditoriaNo).value),
        fechaElaboracionInforme: leerValorCampo(ws, 'E6', ['F6', 'D5']),
        fechaInicio: celdaATexto(ws.getCell(CELDAS.fechaInicio).value),
        fechaTermino: celdaATexto(ws.getCell(CELDAS.fechaTermino).value),
        fechaEntregaInforme: leerValorCampo(ws, 'E8', ['F8', 'D7']),
        empresa: celdaATexto(ws.getCell(CELDAS.empresa).value),
        ubicacion: celdaATexto(ws.getCell(CELDAS.ubicacion).value),
        criteriosAuditoria: leerCampoMultilineaHoja(ws, 11, ['C11', 'D11', 'B11'], ['criterios de auditoría']),
        alcanceAuditoria: leerCampoMultilineaHoja(ws, 12, ['C12', 'D12', 'B12'], ['alcance de auditoría']),
        objetivoAuditoria: leerCampoMultilineaHoja(ws, 13, ['C13', 'D13', 'B13'], ['objetivo']),
        auditorLider: celdaATexto(ws.getCell(CELDAS.auditorLider).value),
        metodoAuditoria: celdaATexto(ws.getCell(CELDAS.metodoAuditoria).value),
        equipoAuditor,
        numObservadores: celdaATexto(ws.getCell(CELDAS.numObservadores).value),
        numInterpretes: celdaATexto(ws.getCell(CELDAS.numInterpretes).value),
        numGuias: celdaATexto(ws.getCell(CELDAS.numGuias).value),
        agenda: agenda.length ? agenda : DATOS_DEFECTO.agenda,
        roles: roles.length ? roles : DATOS_DEFECTO.roles
    });
}

function limpiarCeldasLegacySgcF08(ws) {
    asignarTextoSimple(ws.getCell('D5'), '');
    asignarTextoSimple(ws.getCell('D7'), '');
    asignarTextoSimple(ws.getCell('F6'), '');
    asignarTextoSimple(ws.getCell('F8'), '');
    asignarTextoSimple(ws.getCell('D15'), '');
    asignarTextoSimple(ws.getCell('A11'), '');
    asignarTextoSimple(ws.getCell('B11'), '');
    asignarTextoSimple(ws.getCell('A12'), '');
    asignarTextoSimple(ws.getCell('B12'), '');
    asignarTextoSimple(ws.getCell('A13'), '');
    asignarTextoSimple(ws.getCell('B13'), '');
    asignarTextoSimple(ws.getCell('B16'), '');
    for (let r = EQUIPO_AUDITOR_ROW; r <= EQUIPO_AUDITOR_END_ROW; r++) {
        asignarTextoSimple(ws.getRow(r).getCell(2), '');
    }
}

function pushLimpiezaLegacySgcF08(actualizaciones, sheetTitle) {
    const celdas = ['D5', 'D7', 'F6', 'F8', 'D15', 'A11', 'B11', 'A12', 'B12', 'A13', 'B13', 'B16'];
    for (const celda of celdas) {
        actualizaciones.push({ range: rangoSheet(celda, sheetTitle), values: [['']] });
    }
    for (let r = EQUIPO_AUDITOR_ROW; r <= EQUIPO_AUDITOR_END_ROW; r++) {
        actualizaciones.push({ range: rangoSheet(`B${r}`, sheetTitle), values: [['']] });
    }
}

function prepararDatosParaEscritura(datos) {
    const d = sanitizarDatos(datos);
    d.fechaRevision = resolverFechaRevisionDocumento(d, null);
    return d;
}

function escribirDatosEnHoja(ws, datos) {
    const d = prepararDatosParaEscritura(datos);
    limpiarCeldasLegacySgcF08(ws);
    asignarTextoSimple(ws.getCell(CELDAS.revision), `Revisión: ${d.revision}`, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaRevision), `Fecha de revisión: ${formatearFechaDisplay(d.fechaRevision)}`, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.auditoriaNo), d.auditoriaNo);
    asignarTextoSimple(ws.getCell(CELDAS.fechaElaboracionInforme), d.fechaElaboracionInforme, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaInicio), d.fechaInicio, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaTermino), d.fechaTermino, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.fechaEntregaInforme), d.fechaEntregaInforme, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.empresa), d.empresa);
    asignarTextoSimple(ws.getCell(CELDAS.ubicacion), d.ubicacion);
    asignarTextoSimple(ws.getCell(CELDAS.criteriosAuditoria), d.criteriosAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.alcanceAuditoria), d.alcanceAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.objetivoAuditoria), d.objetivoAuditoria, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.auditorLider), d.auditorLider);
    asignarTextoSimple(ws.getCell(CELDAS.metodoAuditoria), d.metodoAuditoria, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.equipoAuditor), d.equipoAuditor, 'left');
    asignarTextoSimple(ws.getCell(CELDAS.numObservadores), d.numObservadores, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.numInterpretes), d.numInterpretes, 'center');
    asignarTextoSimple(ws.getCell(CELDAS.numGuias), d.numGuias, 'center');

    escribirAgendaEnHoja(ws, d.agenda);
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
        console.warn('[SGC-F-08] No se pudo resolver hoja vigente:', err.message);
        return SHEET_TITLE;
    }
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = await obtenerHojaDatos(wb, opciones.modo || 'vigente');
    if (!ws) throw new Error('La plantilla SGC-F-08 no contiene hojas.');
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
    const d = prepararDatosParaEscritura(datos);
    const actualizaciones = [];

    pushLimpiezaLegacySgcF08(actualizaciones, sheetTitle);

    actualizaciones.push({
        range: rangoSheet(CELDAS.revision, sheetTitle),
        values: [[`Revisión: ${d.revision}`]]
    });
    actualizaciones.push({
        range: rangoSheet(CELDAS.fechaRevision, sheetTitle),
        values: [[`Fecha de revisión: ${formatearFechaDisplay(d.fechaRevision)}`]]
    });
    actualizaciones.push({ range: rangoSheet(CELDAS.auditoriaNo, sheetTitle), values: [[d.auditoriaNo]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.fechaElaboracionInforme, sheetTitle), values: [[d.fechaElaboracionInforme]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.fechaInicio, sheetTitle), values: [[d.fechaInicio]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.fechaTermino, sheetTitle), values: [[d.fechaTermino]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.fechaEntregaInforme, sheetTitle), values: [[d.fechaEntregaInforme]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.empresa, sheetTitle), values: [[d.empresa]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.ubicacion, sheetTitle), values: [[d.ubicacion]] });
    pushCampoMultilineaSheet(actualizaciones, 11, d.criteriosAuditoria, sheetTitle);
    pushCampoMultilineaSheet(actualizaciones, 12, d.alcanceAuditoria, sheetTitle);
    pushCampoMultilineaSheet(actualizaciones, 13, d.objetivoAuditoria, sheetTitle);
    actualizaciones.push({ range: rangoSheet(CELDAS.auditorLider, sheetTitle), values: [[d.auditorLider]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.metodoAuditoria, sheetTitle), values: [[d.metodoAuditoria]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.equipoAuditor, sheetTitle), values: [[d.equipoAuditor]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.numObservadores, sheetTitle), values: [[d.numObservadores]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.numInterpretes, sheetTitle), values: [[d.numInterpretes]] });
    actualizaciones.push({ range: rangoSheet(CELDAS.numGuias, sheetTitle), values: [[d.numGuias]] });

    const agenda = d.agenda.length ? d.agenda : DATOS_DEFECTO.agenda;
    const totalSlots = AGENDA_END_ROW - AGENDA_START_ROW + 1;
    for (let i = 0; i < totalSlots; i++) {
        const rowNum = AGENDA_START_ROW + i;
        const fila = i < agenda.length ? agenda[i] : sanitizarFilaAgenda({});
        pushActualizacionesFilaAgenda(actualizaciones, fila, rowNum, sheetTitle);
    }

    return actualizaciones;
}

async function aplicarFormatoVisualSgcF08(spreadsheetId, sheetTitle) {
    if (!spreadsheetId || !sheetTitle) {
        return;
    }
    try {
        await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
            sheetTitle,
            startRow: 6,
            endRow: 7,
            startColumn: 2,
            endColumn: 2,
            horizontalAlignment: 'LEFT'
        });
        await driveService.aplicarFormatoRangoGoogleSheet(spreadsheetId, {
            sheetTitle,
            startRow: AGENDA_START_ROW,
            endRow: AGENDA_END_ROW,
            startColumn: 1,
            endColumn: 7,
            horizontalAlignment: 'LEFT'
        });
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo aplicar formato visual en Google Sheet:', err.message);
    }
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle) {
    const titulo = String(sheetTitle || await resolverTituloHojaTrabajo(spreadsheetId)).trim();
    const actualizaciones = datosAActualizacionesSheet(datos, titulo);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    await aplicarFormatoVisualSgcF08(spreadsheetId, titulo);
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
    if (!ws) throw new Error('La plantilla SGC-F-08 no contiene hojas.');
    escribirDatosEnHoja(ws, datos);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(sanitizarDatos(a)) === JSON.stringify(sanitizarDatos(b));
}

function estructuraEsEquivalente(a, b) {
    const fa = Array.isArray(a?.agenda) ? a.agenda.length : 0;
    const fb = Array.isArray(b?.agenda) ? b.agenda.length : 0;
    return fa === fb;
}

async function aplicarHistorialSgcF08(opciones) {
    let sheetActiva = SHEET_TITLE;
    if (opciones.spreadsheetId) {
        sheetActiva = await resolverTituloHojaTrabajo(opciones.spreadsheetId);
    }
    const nombreMesAnio = `SGCF08-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    const datosNuevosFusionados = fusionarDatosPreservandoTexto(
        opciones.datosNuevos,
        opciones.datosPrevios
    );
    const result = await excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: datosNuevosFusionados,
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
    result.datosGuardar = fusionarDatosPreservandoTexto(
        result.datosGuardar,
        opciones.datosPrevios
    );
    if (result.aplicado && result.hojaVigente && opciones.spreadsheetId) {
        try {
            await escribirSnapshotEnHojaDrive(
                opciones.spreadsheetId,
                result.hojaVigente,
                result.datosGuardar
            );
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo reescribir hoja tras historial:', err.message);
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
    if (!spreadsheetId) {
        return false;
    }
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        if (info?.mimeType !== 'application/vnd.google-apps.spreadsheet') {
            return false;
        }
        const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
        return Array.isArray(titulos) && titulos.length > 0;
    } catch (err) {
        console.warn('[SGC-F-08] No se pudo validar Google Sheet:', err.message);
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
    console.log(`[SGC-F-08] Reconvirtiendo archivo Office (${fileId}) a Google Sheet...`);
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
    console.log(`[SGC-F-08] Google Sheet restaurado: ${nuevoId}`);
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
        throw new Error('No hay archivo SGC-F-08 configurado en Drive.');
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
                if (!existe) {
                    continue;
                }
                if (requiereCarpeta && !(await archivoEstaEnCarpeta(id, CARPETA_DRIVE_ID))) {
                    continue;
                }
                if (soloGoogleSheet && !(await esSpreadsheetEditableEnDrive(id))) {
                    continue;
                }
                return id;
            } catch {
                continue;
            }
        }
        return null;
    };

    const editableSinCarpeta = await resolver(true, false);
    if (editableSinCarpeta) {
        return editableSinCarpeta;
    }

    const editableEnCarpeta = await resolver(true, true);
    if (editableEnCarpeta) {
        return editableEnCarpeta;
    }

    const cualquieraSinCarpeta = await resolver(false, false);
    if (cualquieraSinCarpeta) {
        return cualquieraSinCarpeta;
    }

    return DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            const info = await driveService.obtenerInfoArchivo(driveFileIdPrevio).catch(() => null);
            if (info?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                console.warn('[SGC-F-08] El archivo ya es Google Sheet; no se reemplaza con XLSX.');
                return info;
            }
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }
    return driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 6, keepSingleSheet: false }
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
            fechaElaboracion: fechaMostrar,
            fechaRevision: resolverFechaRevisionDocumento(datos, null)
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
            console.warn('[SGC-F-08] No se pudo restaurar Google Sheet al cargar:', err.message);
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

    if (driveFileId) {
        try {
            const buffer = await descargarBufferDrive(driveFileId);
            datos = await leerDatosDesdeBuffer(buffer);
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => null);
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdeBuffer(await descargarBufferDrive(TEMPLATE_DRIVE_ID));
        } catch (err) {
            console.warn('[SGC-F-08] No se pudo leer plantilla, usando datos por defecto:', err.message);
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
    const datosEntrada = fusionarDatosPreservandoTexto(
        sanitizarDatos(body?.datos || body),
        datosPrevios
    );
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaRevision || DATOS_DEFECTO.fechaElaboracion;
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
            const hist = await aplicarHistorialSgcF08({
                spreadsheetId: driveId,
                datosPrevios,
                datosNuevos: origen !== 'consulta' ? { ...datosEntrada } : datosEntrada,
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
            console.warn('[SGC-F-08] No se pudo actualizar Google Sheet:', err.message);
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
        fechaOriginal = datosDrive.fechaRevision || DATOS_DEFECTO.fechaElaboracion;
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
    if (!huboCambio) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(driveFileId)
            .catch(() => null);
        return construirRespuesta({ ...registro, drive_file_id: driveFileId }, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF08({
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
    const archivoDrive = await driveService
        .obtenerInfoArchivo(driveFileId)
        .catch(() => null);

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
            console.warn('[SGC-F-08] Archivo previo no encontrado al actualizar plantilla:', err.message);
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
    actualizarPlantillaDesdeSistema
};
