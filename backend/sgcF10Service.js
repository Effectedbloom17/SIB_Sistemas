/**
 * SGC-F-10 · Informe de auditoría — persistencia en biznaga_sgc + sync a Google Doc.
 * El formulario interactivo guarda en BD y replica hallazgos/campos al documento de Drive.
 */
const { Readable } = require('stream');
const { google } = require('googleapis');
const AdmZip = require('adm-zip');
const driveService = require('./driveService');
const sgcDashboardService = require('./sgcDashboardService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');

const CODIGO_FORMATO = 'SGC-F-10';
const TEMPLATE_DRIVE_ID = '1xHRlZqE7k733GqeeELyjwDHY2ljHViG5K3p9ArstWc4';
const DRIVE_FILE_ID_SISTEMA = '1xHRlZqE7k733GqeeELyjwDHY2ljHViG5K3p9ArstWc4';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NOMBRE_DOC_SISTEMA = 'SGC-F-10 Informe de auditoría (sistema)';
const MAX_HALLAZGOS = 40;
const AUDITORIA_NO_ACTUAL = '3';

function fechaHoyDisplayMx() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${day}/${m}/${y}`;
}

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-01-14',
    fechaElaboracion: '2025-01-14',
    auditoriaNo: AUDITORIA_NO_ACTUAL,
    fechasAuditoria: '',
    ubicaciones: '',
    empresaId: null,
    empresa: '',
    domicilio: '',
    objetivos: '',
    criterios: '',
    alcance: '',
    auditorLiderId: null,
    auditorLider: '',
    auditorLiderFirmaDriveId: '',
    auditoresIds: [],
    auditores: '',
    participantesIds: [],
    participantes: '',
    otrosParticipantesIds: [],
    otrosParticipantes: '',
    clausulaNorma: '',
    hallazgos: [{
        id: '',
        clausula: '',
        clasificacion: '',
        descripcion: '',
        procesos: '',
        auditorId: null,
        auditor: '',
        fechaAdicion: ''
    }],
    conclusiones: '',
    firmaAuditorLider: '',
    firmaDireccionGeneralId: null,
    firmaDireccionGeneral: '',
    firmaDireccionGeneralFirmaDriveId: '',
    plantillaBaseFileId: ''
};

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function decodificarEntidadesHtml(texto) {
    return String(texto || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function htmlATextoPlano(html) {
    const texto = String(html || '');
    if (!texto.includes('<')) {
        return normalizarSaltosLinea(texto);
    }
    return normalizarSaltosLinea(
        decodificarEntidadesHtml(
            texto
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
                .replace(/<\/div>\s*<div[^>]*>/gi, '\n\n')
                .replace(/<[^>]+>/g, '')
        )
    );
}

/** Conserva negrita/cursiva del editor de hallazgos (mismo criterio que DG-F-02 + italic). */
function sanitizarHtmlHallazgo(html) {
    const texto = String(html || '').trim();
    if (!texto) {
        return '';
    }
    if (!texto.includes('<')) {
        return normalizarSaltosLinea(texto);
    }
    return texto
        .replace(/<(?!\/?(?:b|strong|i|em|br|p|div)\b)[^>]+>/gi, '')
        .replace(/<(b|strong|i|em|p|div)(?:\s[^>]*)?>/gi, '<$1>')
        .trim();
}

/**
 * Convierte HTML del hallazgo en segmentos de texto con flags bold/italic
 * para insertarlos nativamente en Google Docs / Word.
 */
function htmlASegmentosFormato(html) {
    const limpio = sanitizarHtmlHallazgo(html);
    if (!limpio) {
        return [];
    }
    if (!limpio.includes('<')) {
        const plano = normalizarSaltosLinea(limpio);
        return plano ? [{ text: plano, bold: false, italic: false }] : [];
    }

    let cuerpo = limpio
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<\/div>\s*<div[^>]*>/gi, '\n\n')
        .replace(/<\/?p[^>]*>/gi, '')
        .replace(/<\/?div[^>]*>/gi, '');

    const segmentos = [];
    const re = /<\/?(?:b|strong|i|em)>/gi;
    let bold = false;
    let italic = false;
    let ultimo = 0;
    let match = re.exec(cuerpo);
    while (match) {
        if (match.index > ultimo) {
            const text = decodificarEntidadesHtml(cuerpo.slice(ultimo, match.index));
            if (text) {
                segmentos.push({ text, bold, italic });
            }
        }
        const tag = match[0].toLowerCase();
        if (tag === '<b>' || tag === '<strong>') bold = true;
        else if (tag === '</b>' || tag === '</strong>') bold = false;
        else if (tag === '<i>' || tag === '<em>') italic = true;
        else if (tag === '</i>' || tag === '</em>') italic = false;
        ultimo = match.index + match[0].length;
        match = re.exec(cuerpo);
    }
    if (ultimo < cuerpo.length) {
        const text = decodificarEntidadesHtml(cuerpo.slice(ultimo));
        if (text) {
            segmentos.push({ text, bold, italic });
        }
    }

    // Normaliza saltos extremos sin perder espacios internos con formato.
    while (segmentos.length && !segmentos[0].text.trim() && !/\S/.test(segmentos[0].text)) {
        const soloSaltos = segmentos[0].text.replace(/^\n+/, '');
        if (!soloSaltos) segmentos.shift();
        else {
            segmentos[0].text = soloSaltos;
            break;
        }
    }
    while (segmentos.length) {
        const last = segmentos[segmentos.length - 1];
        const trimmed = last.text.replace(/\n+$/, '');
        if (trimmed === last.text) break;
        if (!trimmed) segmentos.pop();
        else {
            last.text = trimmed;
            break;
        }
    }

    return segmentos.filter((s) => s.text.length > 0);
}

function hallazgoTieneContenido(h) {
    return !!(
        htmlATextoPlano(h?.descripcion).trim()
        || String(h?.clausula || '').trim()
        || String(h?.procesos || '').trim()
    );
}

function requestsInsertarConFormato(startIndex, html) {
    const segmentos = htmlASegmentosFormato(html);
    const plano = segmentos.map((s) => s.text).join('');
    if (!plano) {
        return [];
    }
    const requests = [{
        insertText: { location: { index: startIndex }, text: plano }
    }];
    let offset = 0;
    for (const seg of segmentos) {
        const len = seg.text.length;
        if (len > 0 && (seg.bold || seg.italic)) {
            requests.push({
                updateTextStyle: {
                    range: {
                        startIndex: startIndex + offset,
                        endIndex: startIndex + offset + len
                    },
                    textStyle: {
                        bold: !!seg.bold,
                        italic: !!seg.italic
                    },
                    fields: 'bold,italic'
                }
            });
        }
        offset += len;
    }
    return requests;
}

function normalizarIds(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    if (typeof fecha === 'string') {
        const s = fecha.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m) {
            const d = m[1].padStart(2, '0');
            const mm = m[2].padStart(2, '0');
            let y = m[3];
            if (y.length === 2) y = `20${y}`;
            return `${y}-${mm}-${d}`;
        }
    }
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatearDatetimeMysqlMexico(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string' && !fecha.includes('T')) {
        const [datePart, timePart = '00:00:00'] = fecha.trim().split(/\s+/);
        const [y, m, d] = datePart.split('-');
        const [hh, mm] = timePart.split(':');
        if (!y || !m || !d) return String(fecha);
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y} ${String(hh || '00').padStart(2, '0')}:${String(mm || '00').padStart(2, '0')}`;
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function normalizarClasificacionHallazgo(raw) {
    const valor = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (valor === 'OP' || valor === 'OPORTUNIDAD' || valor === 'OPORTUNIDAD_DE_MEJORA') {
        return 'OP';
    }
    if (valor === 'NC_MENOR' || valor === 'NC-MENOR' || valor === 'NCMENOR') {
        return 'NC_MENOR';
    }
    if (valor === 'NC_MAYOR' || valor === 'NC-MAYOR' || valor === 'NCMAYOR') {
        return 'NC_MAYOR';
    }
    return '';
}

function sanitizarHallazgo(item) {
    const auditorIdNum = Number(item?.auditorId);
    const auditorId = Number.isFinite(auditorIdNum) && auditorIdNum > 0 ? auditorIdNum : null;
    let fechaAdicion = formatearFechaIso(item?.fechaAdicion);
    if (!fechaAdicion) {
        fechaAdicion = fechaHoyIso();
    }
    return {
        id: String(item?.id || '').trim(),
        clausula: String(item?.clausula || '').trim(),
        // Solo para el editor del sistema; no se escribe en el documento de Drive.
        clasificacion: normalizarClasificacionHallazgo(item?.clasificacion),
        descripcion: sanitizarHtmlHallazgo(item?.descripcion),
        procesos: normalizarSaltosLinea(item?.procesos),
        auditorId,
        auditor: String(item?.auditor || '').trim(),
        fechaAdicion
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const hallazgosRaw = Array.isArray(base.hallazgos) ? base.hallazgos : DATOS_DEFECTO.hallazgos;
    const clausulaGlobal = String(base.clausulaNorma || '').trim();
    const hallazgos = hallazgosRaw
        .slice(0, MAX_HALLAZGOS)
        .map((item, idx) => {
            const h = sanitizarHallazgo(item);
            // Compatibilidad con registros previos: una sola cláusula global.
            if (!h.clausula && idx === 0) h.clausula = clausulaGlobal;
            return h;
        });
    const fechaRevision = formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision;
    const empresaIdNum = Number(base.empresaId);
    const liderIdNum = Number(base.auditorLiderId);

    return {
        revision: String(base.revision || DATOS_DEFECTO.revision).trim().padStart(2, '0'),
        fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || fechaRevision,
        auditoriaNo: String(base.auditoriaNo || AUDITORIA_NO_ACTUAL).trim() || AUDITORIA_NO_ACTUAL,
        fechasAuditoria: String(base.fechasAuditoria || '').trim() || fechaHoyDisplayMx(),
        ubicaciones: String(base.ubicaciones || '').trim(),
        empresaId: Number.isFinite(empresaIdNum) && empresaIdNum > 0 ? empresaIdNum : null,
        empresa: String(base.empresa || '').trim(),
        domicilio: String(base.domicilio || '').trim(),
        objetivos: normalizarSaltosLinea(base.objetivos),
        criterios: normalizarSaltosLinea(base.criterios),
        alcance: normalizarSaltosLinea(base.alcance),
        auditorLiderId: Number.isFinite(liderIdNum) && liderIdNum > 0 ? liderIdNum : null,
        auditorLider: String(base.auditorLider || '').trim(),
        auditorLiderFirmaDriveId: String(base.auditorLiderFirmaDriveId || '').trim(),
        auditoresIds: normalizarIds(base.auditoresIds),
        auditores: normalizarSaltosLinea(base.auditores),
        participantesIds: normalizarIds(base.participantesIds),
        participantes: normalizarSaltosLinea(base.participantes),
        otrosParticipantesIds: normalizarIds(base.otrosParticipantesIds),
        otrosParticipantes: normalizarSaltosLinea(base.otrosParticipantes),
        clausulaNorma: clausulaGlobal,
        hallazgos: hallazgos.length
            ? hallazgos
            : [{
                id: '',
                clausula: '',
                clasificacion: '',
                descripcion: '',
                procesos: '',
                auditorId: null,
                auditor: '',
                fechaAdicion: ''
            }],
        conclusiones: normalizarSaltosLinea(base.conclusiones),
        firmaAuditorLider: String(base.firmaAuditorLider || '').trim(),
        firmaDireccionGeneralId: (() => {
            const n = Number(base.firmaDireccionGeneralId);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        firmaDireccionGeneral: String(base.firmaDireccionGeneral || '').trim(),
        firmaDireccionGeneralFirmaDriveId: String(base.firmaDireccionGeneralFirmaDriveId || '').trim(),
        plantillaBaseFileId: String(base.plantillaBaseFileId || '').trim()
    };
}

function extraerContenidoEditable(datos) {
    const d = sanitizarDatos(datos);
    return {
        auditoriaNo: d.auditoriaNo,
        fechasAuditoria: d.fechasAuditoria,
        ubicaciones: d.ubicaciones,
        empresaId: d.empresaId,
        empresa: d.empresa,
        domicilio: d.domicilio,
        objetivos: d.objetivos,
        criterios: d.criterios,
        alcance: d.alcance,
        auditorLiderId: d.auditorLiderId,
        auditorLider: d.auditorLider,
        auditorLiderFirmaDriveId: d.auditorLiderFirmaDriveId,
        auditoresIds: d.auditoresIds,
        auditores: d.auditores,
        participantesIds: d.participantesIds,
        participantes: d.participantes,
        otrosParticipantesIds: d.otrosParticipantesIds,
        otrosParticipantes: d.otrosParticipantes,
        clausulaNorma: d.clausulaNorma,
        hallazgos: d.hallazgos,
        conclusiones: d.conclusiones,
        firmaAuditorLider: d.firmaAuditorLider,
        firmaDireccionGeneralId: d.firmaDireccionGeneralId,
        firmaDireccionGeneral: d.firmaDireccionGeneral,
        firmaDireccionGeneralFirmaDriveId: d.firmaDireccionGeneralFirmaDriveId
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(extraerContenidoEditable(a)) === JSON.stringify(extraerContenidoEditable(b));
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

async function guardarRegistroDb(pool, payload) {
    await persistirRegistroSgc(pool, CODIGO_FORMATO, {
        driveFileId: payload.driveFileId || DRIVE_FILE_ID_SISTEMA,
        datos: payload.datos,
        fechaElaboracionOriginal: payload.fechaElaboracionOriginal,
        fechaModificacionContenido: payload.fechaModificacionContenido,
        contenidoModificado: payload.contenidoModificado
    });
}

function construirRespuesta(registro, datos, extras = {}) {
    const driveFileId = registro?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);

    return {
        codigo: CODIGO_FORMATO,
        datos: {
            ...datos,
            fechaElaboracion: fechaMostrar,
            totalHallazgos: Array.isArray(datos.hallazgos) ? datos.hallazgos.length : 0
        },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId,
        editorUrl: `https://docs.google.com/document/d/${driveFileId}/edit?usp=sharing`,
        previewUrl: `https://docs.google.com/document/d/${driveFileId}/preview`,
        ultimaSyncDrive: formatearDatetimeMysqlMexico(registro?.ultima_sync_drive),
        ...extras
    };
}

function formatearAuditoriaNo(n) {
    const digitos = String(n ?? '').replace(/\D/g, '');
    const num = Number(digitos);
    if (!Number.isFinite(num) || num <= 0) {
        return String(AUDITORIA_NO_ACTUAL).padStart(2, '0');
    }
    return String(Math.trunc(num)).padStart(2, '0');
}

function contadoresHallazgos(hallazgos) {
    const lista = Array.isArray(hallazgos) ? hallazgos : [];
    let totalOp = 0;
    let totalNcMenor = 0;
    let totalNcMayor = 0;
    for (const h of lista) {
        const c = normalizarClasificacionHallazgo(h?.clasificacion);
        if (c === 'OP') totalOp += 1;
        else if (c === 'NC_MENOR') totalNcMenor += 1;
        else if (c === 'NC_MAYOR') totalNcMayor += 1;
    }
    return {
        totalHallazgos: lista.length,
        totalOp,
        totalNcMenor,
        totalNcMayor,
        totalNc: totalNcMenor + totalNcMayor
    };
}

function inferirFechaAuditoria(fechasTexto, fallbackIso = null) {
    const texto = String(fechasTexto || '');
    const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = texto.match(/(\d{1,2})\s*(?:de\s+)?([a-zA-Záéíóúñ.]+)?\s*(?:de\s+)?(\d{4})/i);
    if (dmy) {
        const meses = {
            ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
            jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12'
        };
        const mesKey = String(dmy[2] || '').toLowerCase().slice(0, 3);
        const mes = meses[mesKey] || '01';
        return `${dmy[3]}-${mes}-${String(dmy[1]).padStart(2, '0')}`;
    }
    const slash = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slash) {
        let y = slash[3];
        if (y.length === 2) y = `20${y}`;
        return `${y}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
    }
    return formatearFechaIso(fallbackIso) || fechaHoyIso();
}

async function asegurarTablaHistorialF10(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sgc_f10_historial (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            auditoria_no VARCHAR(32) NOT NULL,
            fechas_auditoria VARCHAR(255) NULL,
            fecha_auditoria DATE NULL,
            anio INT NULL,
            empresa VARCHAR(255) NULL,
            ubicaciones VARCHAR(512) NULL,
            total_hallazgos INT NOT NULL DEFAULT 0,
            total_op INT NOT NULL DEFAULT 0,
            total_nc_menor INT NOT NULL DEFAULT 0,
            total_nc_mayor INT NOT NULL DEFAULT 0,
            total_nc INT NOT NULL DEFAULT 0,
            datos_json JSON NOT NULL,
            drive_file_id VARCHAR(128) NULL,
            drive_file_name VARCHAR(512) NULL,
            origen VARCHAR(64) NOT NULL DEFAULT 'sistema',
            cerrado TINYINT(1) NOT NULL DEFAULT 1,
            cerrado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            cerrado_por VARCHAR(128) NULL,
            sgc_auditoria_id INT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sgc_f10_historial_no (auditoria_no),
            KEY idx_sgc_f10_historial_anio (anio),
            KEY idx_sgc_f10_historial_fecha (fecha_auditoria)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function mapearFilaHistorial(row) {
    if (!row) return null;
    let datos = null;
    try {
        datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    } catch {
        datos = null;
    }
    return {
        id: row.id,
        auditoriaNo: row.auditoria_no,
        fechasAuditoria: row.fechas_auditoria || '',
        fechaAuditoria: formatearFechaIso(row.fecha_auditoria),
        anio: row.anio,
        empresa: row.empresa || '',
        ubicaciones: row.ubicaciones || '',
        totalHallazgos: Number(row.total_hallazgos) || 0,
        totalOp: Number(row.total_op) || 0,
        totalNcMenor: Number(row.total_nc_menor) || 0,
        totalNcMayor: Number(row.total_nc_mayor) || 0,
        totalNc: Number(row.total_nc) || 0,
        driveFileId: row.drive_file_id || null,
        driveFileName: row.drive_file_name || null,
        editorUrl: row.drive_file_id
            ? `https://docs.google.com/document/d/${row.drive_file_id}/edit?usp=sharing`
            : null,
        origen: row.origen || 'sistema',
        cerrado: !!row.cerrado,
        cerradoEn: formatearDatetimeMysqlMexico(row.cerrado_en),
        cerradoPor: row.cerrado_por || null,
        sgcAuditoriaId: row.sgc_auditoria_id || null,
        datos
    };
}

async function listarHistorial(pool) {
    await asegurarTablaHistorialF10(pool);
    const [rows] = await pool.query(
        `SELECT id, auditoria_no, fechas_auditoria, fecha_auditoria, anio, empresa, ubicaciones,
                total_hallazgos, total_op, total_nc_menor, total_nc_mayor, total_nc,
                drive_file_id, drive_file_name, origen, cerrado, cerrado_en, cerrado_por,
                sgc_auditoria_id, datos_json, created_at
           FROM sgc_f10_historial
          ORDER BY id ASC`
    );
    return (rows || [])
        .map(mapearFilaHistorial)
        .sort((a, b) => {
            const na = Number(String(a.auditoriaNo || '').replace(/\D/g, '')) || 0;
            const nb = Number(String(b.auditoriaNo || '').replace(/\D/g, '')) || 0;
            return na - nb || (a.id - b.id);
        });
}

async function obtenerMaxAuditoriaNoHistorial(pool) {
    await asegurarTablaHistorialF10(pool);
    const [rows] = await pool.query('SELECT auditoria_no FROM sgc_f10_historial');
    let max = 0;
    for (const row of rows || []) {
        const n = Number(String(row.auditoria_no || '').replace(/\D/g, ''));
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

async function existeHistorialAuditoriaNo(pool, auditoriaNo) {
    const no = formatearAuditoriaNo(auditoriaNo);
    const [rows] = await pool.query(
        `SELECT id FROM sgc_f10_historial WHERE auditoria_no = ? LIMIT 1`,
        [no]
    );
    return !!rows?.[0]?.id;
}

async function archivarDocumentoDrive(sistemaFileId, nombreHistorico) {
    const { drive } = clienteGoogle();
    const meta = await drive.files.get({
        fileId: sistemaFileId,
        fields: 'id,parents,name,mimeType',
        supportsAllDrives: true
    });
    const copia = await drive.files.copy({
        fileId: sistemaFileId,
        requestBody: {
            name: nombreHistorico,
            parents: meta?.data?.parents || undefined
        },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true
    });
    const id = copia?.data?.id;
    if (!id) {
        throw new Error('No se pudo archivar el documento Word en Drive.');
    }
    return { id, name: copia.data.name || nombreHistorico };
}

async function sincronizarDashboardDesdeHistorial(pool, snapshot, contadores) {
    await sgcDashboardService.asegurarTablaAuditorias(pool);
    const anio = Number(snapshot.anio) || new Date().getFullYear();
    const fecha = snapshot.fechaAuditoria || null;
    const titulo = `Auditoría Interna No. ${snapshot.auditoriaNo}`;
    const area = String(snapshot.ubicaciones || snapshot.alcance || '').trim() || null;
    const observaciones =
        `Histórico SGC-F-10 · ${contadores.totalHallazgos} hallazgos `
        + `(OP ${contadores.totalOp}, NC menor ${contadores.totalNcMenor}, NC mayor ${contadores.totalNcMayor}).`;
    const nc = contadores.totalNc;

    const [existentes] = await pool.query(
        `SELECT auditoria_id FROM sgc_auditoria
          WHERE anio = ?
            AND (
              titulo LIKE ?
              OR titulo LIKE ?
            )
          ORDER BY auditoria_id ASC
          LIMIT 1`,
        [
            anio,
            `%No. ${Number(snapshot.auditoriaNo)}%`,
            `%No. ${snapshot.auditoriaNo}%`
        ]
    );

    if (existentes?.[0]?.auditoria_id) {
        const id = existentes[0].auditoria_id;
        await pool.query(
            `UPDATE sgc_auditoria
                SET fecha = ?, titulo = ?, area = ?, no_conformidades = ?, observaciones = ?
              WHERE auditoria_id = ?`,
            [fecha, titulo, area, nc, observaciones, id]
        );
        sgcDashboardService.invalidarCacheDashboard();
        return id;
    }

    return sgcDashboardService.crearAuditoria(pool, {
        anio,
        fecha,
        titulo,
        area,
        no_conformidades: nc,
        observaciones
    });
}

async function insertarHistorialInmutable(pool, {
    datos,
    driveFileId = null,
    driveFileName = null,
    origen = 'sistema',
    cerradoPor = null,
    fechaAuditoriaOverride = null,
    anioOverride = null
}) {
    await asegurarTablaHistorialF10(pool);
    const d = sanitizarDatos(datos);
    const auditoriaNo = formatearAuditoriaNo(d.auditoriaNo);
    if (await existeHistorialAuditoriaNo(pool, auditoriaNo)) {
        const err = new Error(`La auditoría No. ${auditoriaNo} ya está guardada en el histórico y no se puede modificar.`);
        err.statusCode = 409;
        throw err;
    }

    const contadores = contadoresHallazgos(d.hallazgos);
    const fechaAuditoria = fechaAuditoriaOverride
        || inferirFechaAuditoria(d.fechasAuditoria, d.fechaElaboracion);
    const anio = anioOverride || Number(String(fechaAuditoria).slice(0, 4)) || new Date().getFullYear();
    const snapshotDatos = {
        ...d,
        auditoriaNo,
        totalHallazgos: contadores.totalHallazgos
    };

    const dashboardId = await sincronizarDashboardDesdeHistorial(
        pool,
        {
            auditoriaNo,
            anio,
            fechaAuditoria,
            ubicaciones: d.ubicaciones,
            alcance: d.alcance
        },
        contadores
    );

    const [result] = await pool.query(
        `INSERT INTO sgc_f10_historial (
            auditoria_no, fechas_auditoria, fecha_auditoria, anio, empresa, ubicaciones,
            total_hallazgos, total_op, total_nc_menor, total_nc_mayor, total_nc,
            datos_json, drive_file_id, drive_file_name, origen, cerrado, cerrado_en,
            cerrado_por, sgc_auditoria_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)`,
        [
            auditoriaNo,
            d.fechasAuditoria || null,
            fechaAuditoria,
            anio,
            d.empresa || null,
            d.ubicaciones || null,
            contadores.totalHallazgos,
            contadores.totalOp,
            contadores.totalNcMenor,
            contadores.totalNcMayor,
            contadores.totalNc,
            JSON.stringify(snapshotDatos),
            driveFileId,
            driveFileName,
            origen,
            cerradoPor,
            dashboardId || null
        ]
    );

    return {
        id: result.insertId,
        auditoriaNo,
        contadores,
        fechaAuditoria,
        anio,
        driveFileId,
        driveFileName,
        sgcAuditoriaId: dashboardId || null
    };
}

/**
 * Cierra el informe actual como histórico inmutable (BD + copia Word en Drive)
 * y deja el formulario listo para una nueva auditoría.
 */
async function guardarHistorico(pool, body = {}, usuario = null) {
    await asegurarTablaSgcFormatoDatos(pool);
    await asegurarTablaHistorialF10(pool);

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body || datosPrevios);
    const auditoriaNo = formatearAuditoriaNo(datosEntrada.auditoriaNo);

    const hallazgosConContenido = (datosEntrada.hallazgos || []).filter(hallazgoTieneContenido);
    if (!hallazgosConContenido.length && !String(datosEntrada.conclusiones || '').trim()) {
        const err = new Error('No hay información suficiente para guardar el histórico. Completa al menos un hallazgo o las conclusiones.');
        err.statusCode = 400;
        throw err;
    }

    if (await existeHistorialAuditoriaNo(pool, auditoriaNo)) {
        const err = new Error(`La auditoría No. ${auditoriaNo} ya existe en el histórico.`);
        err.statusCode = 409;
        throw err;
    }

    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosPrevios.fechaElaboracion
        || fechaHoyIso();
    const datosCerrar = {
        ...datosEntrada,
        auditoriaNo,
        revision: datosPrevios.revision || DATOS_DEFECTO.revision,
        fechaRevision: datosPrevios.fechaRevision || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: fechaHoyIso(),
        plantillaBaseFileId: datosPrevios.plantillaBaseFileId || ''
    };

    const driveFileId = registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA;
    try {
        const syncRes = await sincronizarDocumentoDrive(
            datosCerrar,
            driveFileId,
            datosCerrar.plantillaBaseFileId
        );
        if (syncRes?.plantillaBaseFileId) {
            datosCerrar.plantillaBaseFileId = syncRes.plantillaBaseFileId;
        }
    } catch (err) {
        console.warn('[SGC-F-10] Sync previa a histórico falló:', err.message);
    }

    const nombreArchivo = `SGC-F-10 Informe de auditoría No.${auditoriaNo} (histórico)`;
    let archivoHistorico = { id: null, name: nombreArchivo };
    try {
        archivoHistorico = await archivarDocumentoDrive(driveFileId, nombreArchivo);
    } catch (err) {
        console.warn('[SGC-F-10] No se pudo copiar Word histórico en Drive:', err.message);
    }

    const cerradoPor = String(
        usuario?.nombre || usuario?.usuario || usuario?.email || body?.cerradoPor || ''
    ).trim() || null;

    const historico = await insertarHistorialInmutable(pool, {
        datos: datosCerrar,
        driveFileId: archivoHistorico.id,
        driveFileName: archivoHistorico.name,
        origen: 'sistema',
        cerradoPor
    });

    const siguienteNo = formatearAuditoriaNo(
        Math.max(await obtenerMaxAuditoriaNoHistorial(pool), Number(auditoriaNo) || 0) + 1
    );
    const datosNuevos = sanitizarDatos({
        ...DATOS_DEFECTO,
        auditoriaNo: siguienteNo,
        fechasAuditoria: fechaHoyDisplayMx(),
        plantillaBaseFileId: datosCerrar.plantillaBaseFileId || ''
    });

    try {
        const syncNuevo = await sincronizarDocumentoDrive(
            datosNuevos,
            driveFileId,
            datosNuevos.plantillaBaseFileId
        );
        if (syncNuevo?.plantillaBaseFileId) {
            datosNuevos.plantillaBaseFileId = syncNuevo.plantillaBaseFileId;
        }
    } catch (err) {
        console.warn('[SGC-F-10] No se pudo reiniciar Word para la nueva auditoría:', err.message);
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosNuevos,
        fechaElaboracionOriginal: fechaHoyIso(),
        fechaModificacionContenido: null,
        contenidoModificado: false
    });

    const registro = await obtenerRegistroDb(pool);
    const historial = await listarHistorial(pool);
    return construirRespuesta(registro, datosNuevos, {
        historicoCerrado: historico,
        historial,
        mensajeHistorico:
            `Auditoría No. ${auditoriaNo} guardada en histórico. `
            + `El formulario quedó listo para la auditoría No. ${siguienteNo}.`
    });
}

/**
 * Carga auditorías 01/02 en sgc_f10_historial.
 * No modifica el informe vigente (formato activo / producción).
 */
async function seedHistoricosPrecedentes(pool, opciones = {}) {
    await asegurarTablaHistorialF10(pool);
    const { HISTORICOS } = require('./data/sgc-f10-historicos-seed');
    const forzar = !!opciones.forzar;
    const resultados = [];
    const permitidos = new Set(['01', '02']);

    for (const item of HISTORICOS) {
        const auditoriaNo = formatearAuditoriaNo(item.auditoriaNo);
        if (!permitidos.has(auditoriaNo)) {
            resultados.push({
                auditoriaNo,
                accion: 'omitido',
                motivo: 'solo se permiten históricos 01 y 02 (vigente No.03 no se toca)'
            });
            continue;
        }
        if (!forzar && await existeHistorialAuditoriaNo(pool, auditoriaNo)) {
            resultados.push({ auditoriaNo, accion: 'omitido', motivo: 'ya existe' });
            continue;
        }
        if (forzar && await existeHistorialAuditoriaNo(pool, auditoriaNo)) {
            await pool.query('DELETE FROM sgc_f10_historial WHERE auditoria_no = ?', [auditoriaNo]);
        }

        const datos = sanitizarDatos({
            ...DATOS_DEFECTO,
            auditoriaNo,
            fechasAuditoria: item.fechasAuditoria,
            ubicaciones: item.ubicaciones,
            empresa: item.empresa,
            domicilio: item.domicilio,
            objetivos: item.objetivos,
            criterios: item.criterios,
            alcance: item.alcance,
            auditorLider: item.auditorLider,
            auditores: item.auditores,
            participantes: item.participantes,
            otrosParticipantes: item.otrosParticipantes,
            conclusiones: item.conclusiones,
            hallazgos: item.hallazgos,
            fechaElaboracion: item.fechaAuditoria
        });

        const insertado = await insertarHistorialInmutable(pool, {
            datos,
            driveFileId: item.driveFileId || null,
            driveFileName: item.driveFileName || null,
            origen: 'seed_precedente',
            cerradoPor: 'seed',
            fechaAuditoriaOverride: item.fechaAuditoria,
            anioOverride: item.anio
        });
        resultados.push({ auditoriaNo, accion: 'insertado', ...insertado });
    }

    return resultados;
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    await asegurarTablaHistorialF10(pool);
    let registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);

    if (!datos) {
        datos = sanitizarDatos({
            ...DATOS_DEFECTO,
            fechasAuditoria: fechaHoyDisplayMx()
        });
        await guardarRegistroDb(pool, {
            driveFileId: DRIVE_FILE_ID_SISTEMA,
            datos,
            fechaElaboracionOriginal: datos.fechaElaboracion,
            fechaModificacionContenido: null,
            contenidoModificado: false
        });
        registro = await obtenerRegistroDb(pool);
    }

    if (!registro?.drive_file_id) {
        await guardarRegistroDb(pool, {
            driveFileId: DRIVE_FILE_ID_SISTEMA,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    const historial = await listarHistorial(pool);
    return construirRespuesta(registro, datos, { historial });
}

async function guardarFormato(pool, body = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const datosEntrada = sanitizarDatos(body?.datos || body);

    const fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original)
        || datosPrevios.fechaElaboracion
        || fechaHoyIso();

    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);

    const huboCambio = !contenidoEsEquivalente(datosPrevios, datosEntrada);
    if (huboCambio) {
        contenidoModificado = true;
        fechaModificacion = fechaHoyIso();
    }

    const fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const datosGuardar = {
        ...datosEntrada,
        revision: datosPrevios.revision || DATOS_DEFECTO.revision,
        fechaRevision: datosPrevios.fechaRevision || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion
    };

    const driveFileId = registroPrevio?.drive_file_id || DRIVE_FILE_ID_SISTEMA;

    datosGuardar.plantillaBaseFileId = datosPrevios.plantillaBaseFileId || '';

    if (huboCambio || body?.forzarSyncDrive) {
        try {
            const syncRes = await sincronizarDocumentoDrive(
                datosGuardar,
                driveFileId,
                datosPrevios.plantillaBaseFileId
            );
            if (syncRes?.plantillaBaseFileId) {
                datosGuardar.plantillaBaseFileId = syncRes.plantillaBaseFileId;
            }
        } catch (err) {
            console.warn('[SGC-F-10] Sync Drive falló (se guarda BD igual):', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        driveFileId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    return construirRespuesta(registro, datosGuardar);
}

/* ──────────────────────────────────────────────────────────────
 * Sincronización con el documento de Google Drive.
 *
 * Contrato: existe una "plantilla base" (copia intacta con los
 * marcadores {{...}}) que contiene UN bloque de hallazgo
 * (tabla de cláusula + tabla de descripción). Cada guardado
 * exporta la base a .docx, duplica ese bloque tantas veces como
 * apartados haya y rellena los marcadores. Así el reemplazo
 * siempre parte de texto conocido y el formato se conserva.
 * ────────────────────────────────────────────────────────────── */

const TOKEN_CLAUSULA = '{{clau_desp}}';
const TOKEN_DESCRIPCION = '{{desc_desc}}';
const TOKEN_PROCESOS = '{{proc_inv}}';
const TOKEN_NUMERO_HALLAZGO = '{{num_hall}}';
const TOKEN_FIRMA_LIDER = '{{firm_lider}}';
const TOKEN_FIRMA_DIRECCION = '{{firm_gene}}';
const NOMBRE_PLANTILLA_BASE = 'SGC-F-10 Informe de auditoría (plantilla base)';
const ANCHO_FIRMA_PT = 120;
const ALTO_FIRMA_PT = 55;

function textoDrive(valor) {
    // Nunca escribir HTML crudo en el Word/Drive.
    return htmlATextoPlano(valor);
}

function tokensSimples(datos) {
    const d = datos || {};
    const hallazgos = Array.isArray(d.hallazgos) ? d.hallazgos : [];
    return {
        '{{num_audi}}': textoDrive(d.auditoriaNo),
        '{{fech_audi}}': textoDrive(d.fechasAuditoria),
        '{{ubi_audi}}': textoDrive(d.ubicaciones),
        '{{emp_audi}}': textoDrive(d.empresa),
        '{{dom_audi}}': textoDrive(d.domicilio),
        '{{objet_audi}}': textoDrive(d.objetivos),
        '{{cri_audi}}': textoDrive(d.criterios),
        '{{alca_audi}}': textoDrive(d.alcance),
        '{{audi_lider}}': textoDrive(d.auditorLider),
        '{{audi_comp}}': textoDrive(d.auditores),
        '{{audi_par}}': textoDrive(d.participantes),
        '{{audi_otr}}': textoDrive(d.otrosParticipantes),
        '{{audi_num}}': String(hallazgos.length).padStart(2, '0'),
        '{{concl_audi}}': textoDrive(d.conclusiones),
        '{{concl_desp}}': textoDrive(d.conclusiones),
        [TOKEN_FIRMA_LIDER]: textoDrive(d.firmaAuditorLider || d.auditorLider),
        [TOKEN_FIRMA_DIRECCION]: textoDrive(d.firmaDireccionGeneral)
    };
}

/* ── Duplicación del bloque de hallazgo en el XML del .docx ── */

/** Devuelve los elementos hijos directos de <w:body> con sus rangos en el XML. */
function elementosCuerpoDocx(xml) {
    const inicioBody = xml.indexOf('<w:body>');
    const finBody = xml.lastIndexOf('</w:body>');
    if (inicioBody < 0 || finBody < 0) return [];

    const elementos = [];
    let i = inicioBody + '<w:body>'.length;
    while (i < finBody) {
        const abre = xml.indexOf('<', i);
        if (abre < 0 || abre >= finBody) break;
        const cierra = xml.indexOf('>', abre);
        if (cierra < 0) break;
        const crudo = xml.slice(abre + 1, cierra);
        if (crudo.startsWith('/')) { i = cierra + 1; continue; }

        const tag = crudo.split(/[\s/>]/)[0];
        if (crudo.endsWith('/')) {
            elementos.push({ tag, inicio: abre, fin: cierra + 1 });
            i = cierra + 1;
            continue;
        }

        const etiquetaApertura = `<${tag}`;
        const etiquetaCierre = `</${tag}>`;
        let nivel = 1;
        let j = cierra + 1;
        while (nivel > 0 && j < xml.length) {
            const siguienteAbre = xml.indexOf(etiquetaApertura, j);
            const siguienteCierra = xml.indexOf(etiquetaCierre, j);
            if (siguienteCierra < 0) break;
            if (siguienteAbre >= 0 && siguienteAbre < siguienteCierra) {
                const sig = xml[siguienteAbre + etiquetaApertura.length];
                if (sig === '>' || sig === ' ' || sig === '/') nivel++;
                j = siguienteAbre + etiquetaApertura.length;
            } else {
                nivel--;
                j = siguienteCierra + etiquetaCierre.length;
            }
        }
        elementos.push({ tag, inicio: abre, fin: j });
        i = j;
    }
    return elementos;
}

/**
 * Duplica el bloque «tabla de cláusula + tabla de hallazgo» dentro del .docx.
 * @param {Buffer} bufferDocx
 * @param {number} copias
 * @returns {Buffer}
 */
function expandirBloquesHallazgo(bufferDocx, copias) {
    if (copias <= 1) return bufferDocx;

    const zip = new AdmZip(bufferDocx);
    const entrada = zip.getEntry('word/document.xml');
    if (!entrada) return bufferDocx;

    const xml = entrada.getData().toString('utf8');
    const elementos = elementosCuerpoDocx(xml);
    const textoDe = (el) => xml.slice(el.inicio, el.fin).replace(/<[^>]+>/g, '');

    const idxClausula = elementos.findIndex((el) => el.tag === 'w:tbl' && textoDe(el).includes(TOKEN_CLAUSULA));
    const idxHallazgo = elementos.findIndex((el) => el.tag === 'w:tbl' && textoDe(el).includes(TOKEN_DESCRIPCION));
    if (idxHallazgo < 0) {
        console.warn('[SGC-F-10] No se localizó el bloque de hallazgo en el .docx; no se clona.');
        return bufferDocx;
    }

    const desde = idxClausula >= 0 && idxClausula < idxHallazgo ? idxClausula : idxHallazgo;
    // Incluir el párrafo separador posterior para que los bloques no queden pegados.
    let hasta = idxHallazgo;
    if (elementos[hasta + 1]?.tag === 'w:p') hasta += 1;

    const bloque = xml.slice(elementos[desde].inicio, elementos[hasta].fin);
    const xmlNuevo = xml.slice(0, elementos[desde].inicio)
        + bloque.repeat(copias)
        + xml.slice(elementos[hasta].fin);

    zip.updateFile('word/document.xml', Buffer.from(xmlNuevo, 'utf8'));
    return zip.toBuffer();
}

/* ── Lectura y reemplazo dentro del Google Doc temporal ── */

function runsDeTexto(docData) {
    const runs = [];
    const recorrer = (elementos) => {
        for (const el of (elementos || [])) {
            for (const pe of (el?.paragraph?.elements || [])) {
                if (pe?.textRun?.content && Number.isFinite(pe.startIndex)) {
                    runs.push({
                        startIndex: pe.startIndex,
                        endIndex: pe.endIndex,
                        text: pe.textRun.content
                    });
                }
            }
            for (const row of (el?.table?.tableRows || [])) {
                for (const cell of (row?.tableCells || [])) recorrer(cell.content);
            }
        }
    };
    recorrer(docData?.body?.content || []);
    return runs;
}

function extraerTextoDocumento(docData) {
    return runsDeTexto(docData).map((r) => r.text).join('');
}

function rangoDesdeOffsets(runs, offsetInicio, offsetFin) {
    let cursor = 0;
    let startIndex = null;
    let endIndex = null;
    for (const run of runs) {
        const inicioRun = cursor;
        const finRun = cursor + run.text.length;
        if (startIndex === null && offsetInicio >= inicioRun && offsetInicio < finRun) {
            startIndex = run.startIndex + (offsetInicio - inicioRun);
        }
        if (offsetFin > inicioRun && offsetFin <= finRun) {
            endIndex = run.startIndex + (offsetFin - inicioRun);
            break;
        }
        cursor = finRun;
    }
    if (startIndex === null || endIndex === null || endIndex <= startIndex) return null;
    return { startIndex, endIndex };
}

function ocurrenciasEnTexto(texto, token) {
    const salida = [];
    let desde = 0;
    while (desde < texto.length) {
        const idx = texto.indexOf(token, desde);
        if (idx < 0) break;
        salida.push({ inicio: idx, fin: idx + token.length });
        desde = idx + token.length;
    }
    return salida;
}

/**
 * Rellena los marcadores que se repiten una vez por apartado.
 * La n-ésima aparición corresponde al n-ésimo hallazgo.
 * La descripción admite HTML (negrita/cursiva) y se inserta como texto nativo con estilo.
 */
async function rellenarMarcadoresPorApartado(docsApi, docId, hallazgos) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const runs = runsDeTexto(doc.data);
    const plano = runs.map((r) => r.text).join('');

    const valoresPorToken = {
        [TOKEN_NUMERO_HALLAZGO]: hallazgos.map((_, i) => String(i + 1)),
        [TOKEN_CLAUSULA]: hallazgos.map((h) => textoDrive(h?.clausula)),
        [TOKEN_DESCRIPCION]: hallazgos.map((h) => h?.descripcion || ''),
        [TOKEN_PROCESOS]: hallazgos.map((h) => textoDrive(h?.procesos))
    };

    const cambios = [];
    for (const [token, valores] of Object.entries(valoresPorToken)) {
        ocurrenciasEnTexto(plano, token).forEach((oc, i) => {
            const rango = rangoDesdeOffsets(runs, oc.inicio, oc.fin);
            if (rango) {
                cambios.push({
                    rango,
                    valor: valores[i] || '',
                    rico: token === TOKEN_DESCRIPCION
                });
            }
        });
    }
    if (!cambios.length) return;

    cambios.sort((a, b) => b.rango.startIndex - a.rango.startIndex);
    const requests = [];
    for (const cambio of cambios) {
        requests.push({ deleteContentRange: { range: cambio.rango } });
        if (!cambio.valor) {
            continue;
        }
        if (cambio.rico) {
            requests.push(...requestsInsertarConFormato(cambio.rango.startIndex, cambio.valor));
        } else {
            requests.push({
                insertText: { location: { index: cambio.rango.startIndex }, text: String(cambio.valor) }
            });
        }
    }

    if (!requests.length) return;
    await docsApi.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
}

async function escribirTokensSimples(docsApi, docId, datos) {
    const requests = Object.entries(tokensSimples(datos)).map(([token, valor]) => ({
        replaceAllText: {
            containsText: { text: token, matchCase: true },
            replaceText: String(valor || '')
        }
    }));
    if (!requests.length) return;
    await docsApi.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
}

/**
 * Localiza el párrafo que contiene un marcador. Se reemplaza el contenido
 * completo para eliminar los espacios usados anteriormente para centrarlo.
 */
function localizarParrafoConToken(docData, token) {
    let encontrado = null;
    const recorrer = (elementos) => {
        for (const el of (elementos || [])) {
            if (encontrado) return;
            if (el?.paragraph?.elements) {
                const texto = el.paragraph.elements
                    .map((pe) => pe?.textRun?.content || '')
                    .join('');
                if (texto.includes(token)) {
                    const inicio = Number(el.startIndex);
                    const fin = Number(el.endIndex);
                    if (Number.isFinite(inicio) && Number.isFinite(fin) && fin > inicio) {
                        encontrado = {
                            startIndex: inicio,
                            // Se conserva la marca final del párrafo.
                            endIndex: Math.max(inicio, fin - 1)
                        };
                    }
                    return;
                }
            }
            for (const row of (el?.table?.tableRows || [])) {
                for (const cell of (row?.tableCells || [])) recorrer(cell.content);
            }
        }
    };
    recorrer(docData?.body?.content || []);
    return encontrado;
}

/** Sustituye los marcadores de firma por la imagen guardada del usuario. */
async function insertarFirmas(drive, docsApi, docId, datos) {
    const objetivos = [
        { token: TOKEN_FIRMA_LIDER, driveId: datos.auditorLiderFirmaDriveId, etiqueta: 'f10_lider' },
        { token: TOKEN_FIRMA_DIRECCION, driveId: datos.firmaDireccionGeneralFirmaDriveId, etiqueta: 'f10_direccion' }
    ].filter((o) => String(o.driveId || '').trim());

    const temporales = [];
    for (const objetivo of objetivos) {
        let publicada = null;
        try {
            publicada = await driveService.resolverUrlFirmaParaSlides(objetivo.driveId, objetivo.etiqueta);
        } catch (err) {
            console.warn(`[SGC-F-10] Firma ${objetivo.etiqueta} no disponible: ${err.message}`);
            continue;
        }
        if (!publicada?.url) continue;
        temporales.push(publicada.tempFileId);

        const doc = await docsApi.documents.get({ documentId: docId });
        const rango = localizarParrafoConToken(doc.data, objetivo.token);
        if (!rango) continue;

        try {
            const requests = [];
            if (rango.endIndex > rango.startIndex) {
                requests.push({ deleteContentRange: { range: rango } });
            }
            requests.push(
                {
                    insertInlineImage: {
                        location: { index: rango.startIndex },
                        uri: publicada.url,
                        objectSize: {
                            width: { magnitude: ANCHO_FIRMA_PT, unit: 'PT' },
                            height: { magnitude: ALTO_FIRMA_PT, unit: 'PT' }
                        }
                    }
                },
                {
                    updateParagraphStyle: {
                        range: {
                            startIndex: rango.startIndex,
                            endIndex: rango.startIndex + 1
                        },
                        paragraphStyle: {
                            alignment: 'CENTER',
                            spaceAbove: { magnitude: 0, unit: 'PT' },
                            spaceBelow: { magnitude: 0, unit: 'PT' }
                        },
                        fields: 'alignment,spaceAbove,spaceBelow'
                    }
                }
            );
            await docsApi.documents.batchUpdate({
                documentId: docId,
                requestBody: { requests }
            });
        } catch (err) {
            // Si la imagen falla, el marcador se resolverá luego con el nombre.
            console.warn(`[SGC-F-10] No se pudo insertar la firma ${objetivo.etiqueta}: ${err.message}`);
        }
    }

    for (const tempId of temporales) {
        drive.files.delete({ fileId: tempId }).catch(() => {});
    }
}

/** Limpia marcadores que hayan quedado sin valor. */
async function limpiarTokensResiduales(docsApi, docId) {
    const doc = await docsApi.documents.get({ documentId: docId });
    const pendientes = [...new Set(extraerTextoDocumento(doc.data).match(/\{\{[a-z0-9_]+\}\}/gi) || [])];
    if (!pendientes.length) return;
    await docsApi.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: pendientes.map((token) => ({
                replaceAllText: {
                    containsText: { text: token, matchCase: true },
                    replaceText: ''
                }
            }))
        }
    });
}

/* ── Plantilla base y orquestación ── */

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

async function documentoTieneMarcadores(docsApi, drive, fileId) {
    const meta = await drive.files.get({
        fileId,
        fields: 'id,mimeType',
        supportsAllDrives: true
    });
    if (meta?.data?.mimeType === GOOGLE_DOC_MIME) {
        const doc = await docsApi.documents.get({ documentId: fileId });
        return /\{\{[a-z0-9_]+\}\}/i.test(extraerTextoDocumento(doc.data));
    }
    const copia = await drive.files.copy({
        fileId,
        requestBody: { name: `_temp_sgc_f10_check_${Date.now()}`, mimeType: GOOGLE_DOC_MIME },
        fields: 'id',
        supportsAllDrives: true
    });
    const docId = copia?.data?.id;
    try {
        const doc = await docsApi.documents.get({ documentId: docId });
        return /\{\{[a-z0-9_]+\}\}/i.test(extraerTextoDocumento(doc.data));
    } finally {
        try {
            await drive.files.delete({ fileId: docId, supportsAllDrives: true });
        } catch (_) { /* sin efecto */ }
    }
}

/**
 * Devuelve el id de la plantilla base (copia intacta con marcadores).
 * La crea la primera vez a partir del documento del sistema.
 */
async function obtenerPlantillaBase(drive, docsApi, sistemaFileId, baseRegistrada) {
    if (baseRegistrada) {
        try {
            await drive.files.get({ fileId: baseRegistrada, fields: 'id', supportsAllDrives: true });
            return baseRegistrada;
        } catch (err) {
            console.warn('[SGC-F-10] Plantilla base registrada no accesible, se recreará:', err.message);
        }
    }

    // Puede existir de una ejecución anterior aunque no esté registrada en BD.
    try {
        const busqueda = await drive.files.list({
            q: `name = '${NOMBRE_PLANTILLA_BASE.replace(/'/g, "\\'")}' and trashed = false`,
            fields: 'files(id,modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        const encontrada = busqueda?.data?.files?.[0]?.id;
        if (encontrada) {
            console.log(`[SGC-F-10] Plantilla base localizada en Drive: ${encontrada}`);
            return encontrada;
        }
    } catch (err) {
        console.warn('[SGC-F-10] No se pudo buscar la plantilla base en Drive:', err.message);
    }

    const conMarcadores = await documentoTieneMarcadores(docsApi, drive, sistemaFileId);
    if (!conMarcadores) {
        throw new Error(
            'El documento del sistema ya no conserva los marcadores {{...}}. '
            + 'Restaura la versión con marcadores en Drive (Archivo → Historial de versiones) y vuelve a guardar.'
        );
    }

    const meta = await drive.files.get({
        fileId: sistemaFileId,
        fields: 'id,parents',
        supportsAllDrives: true
    });
    const copia = await drive.files.copy({
        fileId: sistemaFileId,
        requestBody: {
            name: NOMBRE_PLANTILLA_BASE,
            parents: meta?.data?.parents || undefined
        },
        fields: 'id',
        supportsAllDrives: true
    });
    const baseId = copia?.data?.id;
    if (!baseId) {
        throw new Error('No se pudo crear la plantilla base de SGC-F-10.');
    }
    console.log(`[SGC-F-10] Plantilla base creada en Drive: ${baseId}`);
    return baseId;
}

/**
 * Regenera el documento del sistema desde la plantilla base con los datos actuales.
 * @returns {Promise<{ plantillaBaseFileId: string }>}
 */
async function sincronizarDocumentoDrive(datos, driveFileId, plantillaBaseRegistrada) {
    const sistemaFileId = driveFileId || DRIVE_FILE_ID_SISTEMA;
    const { drive, docsApi } = clienteGoogle();
    const plantillaBaseFileId = await obtenerPlantillaBase(
        drive,
        docsApi,
        sistemaFileId,
        plantillaBaseRegistrada
    );

    const hallazgos = (Array.isArray(datos.hallazgos) && datos.hallazgos.length ? datos.hallazgos : [{}])
        .slice(0, MAX_HALLAZGOS);

    const baseDocx = await drive.files.export(
        { fileId: plantillaBaseFileId, mimeType: DOCX_MIME },
        { responseType: 'arraybuffer' }
    );
    const docxExpandido = expandirBloquesHallazgo(Buffer.from(baseDocx.data), hallazgos.length);

    const creado = await drive.files.create({
        requestBody: {
            name: `_temp_sgc_f10_sync_${Date.now()}`,
            mimeType: GOOGLE_DOC_MIME
        },
        media: { mimeType: DOCX_MIME, body: Readable.from(docxExpandido) },
        fields: 'id',
        supportsAllDrives: true
    });
    const docId = creado?.data?.id;
    if (!docId) {
        throw new Error('No se pudo preparar la copia de trabajo de SGC-F-10.');
    }

    try {
        await rellenarMarcadoresPorApartado(docsApi, docId, hallazgos);
        await insertarFirmas(drive, docsApi, docId, datos);
        await escribirTokensSimples(docsApi, docId, datos);
        await limpiarTokensResiduales(docsApi, docId);

        const docxResp = await drive.files.export(
            { fileId: docId, mimeType: DOCX_MIME },
            { responseType: 'arraybuffer' }
        );
        await driveService.reemplazarArchivoEnDrive(
            sistemaFileId,
            Buffer.from(docxResp.data),
            DOCX_MIME,
            NOMBRE_DOC_SISTEMA
        );

        return { plantillaBaseFileId };
    } finally {
        try {
            await drive.files.delete({ fileId: docId, supportsAllDrives: true });
        } catch (err) {
            console.warn('[SGC-F-10] No se pudo borrar copia temporal:', err.message);
        }
    }
}

async function sincronizarDesdeDrive(pool) {
    return cargarFormato(pool);
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const datos = sanitizarDatos({
        ...DATOS_DEFECTO,
        fechasAuditoria: fechaHoyDisplayMx(),
        plantillaBaseFileId: datosPrevios.plantillaBaseFileId
    });
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();

    try {
        const res = await sincronizarDocumentoDrive(
            datos,
            DRIVE_FILE_ID_SISTEMA,
            datosPrevios.plantillaBaseFileId
        );
        datos.plantillaBaseFileId = res.plantillaBaseFileId;
    } catch (err) {
        console.warn('[SGC-F-10] No se pudo restablecer el documento en Drive:', err.message);
    }

    await guardarRegistroDb(pool, {
        driveFileId: DRIVE_FILE_ID_SISTEMA,
        datos,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: null,
        contenidoModificado: false
    });

    const registroActualizado = await obtenerRegistroDb(pool);
    return construirRespuesta(registroActualizado, datos);
}

module.exports = {
    CODIGO_FORMATO,
    DATOS_DEFECTO,
    TEMPLATE_DRIVE_ID,
    DRIVE_FILE_ID_SISTEMA,
    cargarFormato,
    guardarFormato,
    guardarHistorico,
    listarHistorial,
    seedHistoricosPrecedentes,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    sanitizarDatos,
    sincronizarDocumentoDrive,
    asegurarTablaHistorialF10
};
