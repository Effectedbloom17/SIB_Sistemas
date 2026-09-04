/**
 * SGC-F-07 · Programa de auditoría — persistencia en biznaga_sgc y sync con Drive.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const { asegurarTablaSgcFormatoDatos, persistirRegistroSgc, obtenerRegistroSgcPersistido } = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'SGC-F-07';
const TEMPLATE_DRIVE_ID = '1JeFz9EUCEPfRcFw90vSO8PHTq9TMX_Jr';
const DRIVE_FILE_ID_SISTEMA = '1JeFz9EUCEPfRcFw90vSO8PHTq9TMX_Jr';
const CARPETA_DRIVE_ID = '1v2IBrryAJg5fILPH602gm_CZhJNyia82';
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-07 Programa de auditoría (sistema)';
const SHEET_TITLE = 'Programa de Auditoría Interna';

const MESES_KEYS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const DRIVE_SHEET_OPTIONS = {
    sheetTitle: SHEET_TITLE,
    maxColumns: 58,
    keepSingleSheet: true
};

const META_ROW = 5;
const HEADER_ROW = 11;
const DATA_START_ROW = 12;
const DATA_END_ROW = 19;
const MAX_AUDITORIAS_TABLA = Math.floor((DATA_END_ROW - DATA_START_ROW + 1) / 2);

const FOOTER_CELDAS = {
    comentariosTitulo: 'C21',
    comentariosDetalle: 'C22',
    notaPrograma: 'C26',
    firmaEjecutivo: 'H30',
    firmaDireccion: 'N30'
};

const COLUMNAS = {
    noAudi: 1,
    tipoAuditoria: 2,
    alcance: 3,
    objetivo: 4,
    criterios: 5,
    equipoAuditor: 6,
    auditorLider: 7,
    metodoAuditoria: 8,
    estadoCalendario: 9,
    fecha: 10,
    calendarioInicio: 11,
    calendarioFin: 58
};

const DATOS_DEFECTO = {
    empresa: 'BIZNAGA RISK AND TECH',
    fechaElaboracion: '2025-01-14',
    auditorias: [
        {
            noAudi: '1',
            tipoAuditoria: 'Interna',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Identificar las oportunidades para la mejora del SGC.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: '',
            auditorLider: '',
            metodoAuditoria: 'En sitio y persona a persona',
            fecha: '',
            calendario: crearCalendarioVacio()
        },
        {
            noAudi: '2',
            tipoAuditoria: 'Externa',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Cumplir con los requisitos de certificación de la norma ISO 9001:2015.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: 'Auditor(es) externo(s)',
            auditorLider: 'Auditor externo',
            metodoAuditoria: 'En sitio y persona a persona',
            fecha: '',
            calendario: crearCalendarioVacio()
        },
        {
            noAudi: '3',
            tipoAuditoria: 'Interna',
            alcance: 'Procesos declarados en DGE-F-01',
            objetivo: 'Identificar las oportunidades para la mejora del SGC.',
            criterios: 'Norma Internacional ISO 9001:2015',
            equipoAuditor: '',
            auditorLider: '',
            metodoAuditoria: 'Remota',
            fecha: '',
            calendario: crearCalendarioVacio()
        }
    ],
    footer: {
        comentariosTitulo: 'Comentarios:',
        comentariosDetalle: '',
        notaPrograma: '',
        firmaEjecutivo: 'Ejecutivo JR SGVC',
        firmaDireccion: 'Dirección General'
    }
};

async function obtenerMetaHojaParaHistorial(fileId, infoArchivo = null) {
    const id = String(fileId || '').trim();
    if (!id) {
        return null;
    }

    let info = infoArchivo;
    if (!info) {
        try {
            info = await driveService.obtenerInfoArchivo(id);
        } catch {
            info = null;
        }
    }

    const mime = String(info?.mimeType || '').trim();
    if (mime !== 'application/vnd.google-apps.spreadsheet') {
        return null;
    }

    try {
        return await driveService.obtenerDimensionesHojaGoogleSheet(id, SHEET_TITLE);
    } catch (err) {
        console.warn('[SGC-F-07] No se pudo leer dimensiones de hoja para historial:', err.message);
        return null;
    }
}

function crearCalendarioVacio() {
    return MESES_KEYS.reduce((acc, mes) => {
        acc[mes] = ['', '', '', ''];
        return acc;
    }, {});
}

function marcarCeldaCalendario(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^(x|✓|1|si|sí)$/i.test(texto)) return 'X';
    return texto.toUpperCase() === 'X' ? 'X' : '';
}

function leerCalendarioDesdeFila(row) {
    const calendario = crearCalendarioVacio();
    MESES_KEYS.forEach((mes, idxMes) => {
        for (let sem = 0; sem < 4; sem++) {
            const col = COLUMNAS.calendarioInicio + idxMes * 4 + sem;
            calendario[mes][sem] = marcarCeldaCalendario(row.getCell(col).value);
        }
    });
    return calendario;
}

function combinarCalendarios(base, extra) {
    const calendario = crearCalendarioVacio();
    MESES_KEYS.forEach((mes) => {
        for (let i = 0; i < 4; i++) {
            calendario[mes][i] = marcarCeldaCalendario(extra?.[mes]?.[i] || base?.[mes]?.[i]);
        }
    });
    return calendario;
}

function migrarCalendarioAuditoria(item) {
    if (item?.calendario && typeof item.calendario === 'object') {
        return combinarCalendarios(crearCalendarioVacio(), item.calendario);
    }
    const calendario = crearCalendarioVacio();
    if (item?.semana1) calendario.enero[0] = marcarCeldaCalendario(item.semana1);
    if (item?.semana2) calendario.enero[1] = marcarCeldaCalendario(item.semana2);
    if (item?.semana3) calendario.enero[2] = marcarCeldaCalendario(item.semana3);
    if (item?.semana4) calendario.enero[3] = marcarCeldaCalendario(item.semana4);
    return calendario;
}

function columnaCalendarioParaMesSemana(idxMes, idxSemana) {
    return COLUMNAS.calendarioInicio + idxMes * 4 + idxSemana;
}

function indiceFilaProgramada(indiceAuditoria) {
    return DATA_START_ROW + indiceAuditoria * 2;
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

function normalizarSaltosLinea(texto) {
    return String(texto || '')
        .replace(/\r\n/g, '\n')
        .replace(/\|/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = String(fecha).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
            return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        }
        return String(fecha).slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaCelda(fechaIso) {
    const iso = formatearFechaIso(fechaIso);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${Number(d)}/${Number(m)}/${y}`;
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

function fechaHoyIso() {
    return formatearFechaIso(new Date());
}

function sanitizarAuditoria(item) {
    return {
        noAudi: String(item?.noAudi || '').trim(),
        tipoAuditoria: String(item?.tipoAuditoria || '').trim(),
        alcance: String(item?.alcance || '').trim(),
        objetivo: String(item?.objetivo || '').trim(),
        criterios: String(item?.criterios || '').trim(),
        equipoAuditor: String(item?.equipoAuditor || '').trim(),
        auditorLider: String(item?.auditorLider || '').trim(),
        metodoAuditoria: String(item?.metodoAuditoria || '').trim(),
        fecha: String(item?.fecha || '').trim(),
        calendario: migrarCalendarioAuditoria(item)
    };
}

function sanitizarFooter(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        comentariosTitulo: String(base.comentariosTitulo ?? DATOS_DEFECTO.footer.comentariosTitulo).trim() || DATOS_DEFECTO.footer.comentariosTitulo,
        comentariosDetalle: String(base.comentariosDetalle ?? DATOS_DEFECTO.footer.comentariosDetalle).trim(),
        notaPrograma: String(base.notaPrograma ?? DATOS_DEFECTO.footer.notaPrograma).trim(),
        firmaEjecutivo: String(base.firmaEjecutivo ?? DATOS_DEFECTO.footer.firmaEjecutivo).trim() || DATOS_DEFECTO.footer.firmaEjecutivo,
        firmaDireccion: String(base.firmaDireccion ?? DATOS_DEFECTO.footer.firmaDireccion).trim() || DATOS_DEFECTO.footer.firmaDireccion
    };
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const auditorias = Array.isArray(base.auditorias) ? base.auditorias : DATOS_DEFECTO.auditorias;
    
    return {
        empresa: String(base.empresa || DATOS_DEFECTO.empresa).trim() || DATOS_DEFECTO.empresa,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        auditorias: auditorias.map(sanitizarAuditoria).filter(a => 
            a.noAudi || a.tipoAuditoria || a.alcance || a.objetivo
        ),
        footer: sanitizarFooter(base.footer)
    };
}

function esFilaAuditoriaValida(noAudi, tipoAuditoria) {
    const no = String(noAudi || '').trim();
    const tipo = String(tipoAuditoria || '').trim();
    if (!no || /^[RP]$/i.test(no)) {
        return false;
    }
    if (!/^\d+$/.test(no)) {
        return false;
    }
    return !!tipo;
}

function parsearFechaRevisionDesdeHoja(ws) {
    for (let r = 1; r <= 8; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 6; c++) {
            const texto = celdaATexto(row.getCell(c).value);
            const match = texto.match(/fecha\s*(?:de\s*)?revisi[oó]n\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
            if (match) {
                return formatearFechaIso(match[1].replace(/-/g, '/'));
            }
        }
    }
    return '';
}

function obtenerHojaDatos(wb, modo = 'vigente') {
    const lista = Array.isArray(wb?.worksheets) ? wb.worksheets : [];
    if (!lista.length) {
        return null;
    }
    if (modo === 'edicion') {
        return excelHistorial.obtenerHojaEdicionDesdeWorkbook(wb, SHEET_TITLE)
            || wb.getWorksheet(SHEET_TITLE)
            || lista[0];
    }
    return excelHistorial.obtenerHojaActivaDesdeWorkbook(wb, SHEET_TITLE, CODIGO_FORMATO)
        || wb.getWorksheet(SHEET_TITLE)
        || lista[0];
}

function parsearDatosDesdeHoja(ws) {
    const fechaElaboracion = parsearFechaRevisionDesdeHoja(ws) || DATOS_DEFECTO.fechaElaboracion;

    const auditorias = [];
    const numerosVistos = new Set();
    let rowNum = DATA_START_ROW;

    while (rowNum <= DATA_END_ROW) {
        const row = ws.getRow(rowNum);
        const noAudi = celdaATexto(row.getCell(COLUMNAS.noAudi).value).trim();
        const tipoAuditoria = celdaATexto(row.getCell(COLUMNAS.tipoAuditoria).value).trim();

        if (esFilaAuditoriaValida(noAudi, tipoAuditoria) && !numerosVistos.has(noAudi)) {
            numerosVistos.add(noAudi);
            const filaRealizada = ws.getRow(rowNum + 1);
            const estadoRealizada = celdaATexto(filaRealizada.getCell(COLUMNAS.estadoCalendario).value).trim();
            const calendario = /^R$/i.test(estadoRealizada)
                ? combinarCalendarios(leerCalendarioDesdeFila(row), leerCalendarioDesdeFila(filaRealizada))
                : leerCalendarioDesdeFila(row);
            auditorias.push({
                noAudi,
                tipoAuditoria,
                alcance: celdaATexto(row.getCell(COLUMNAS.alcance).value),
                objetivo: celdaATexto(row.getCell(COLUMNAS.objetivo).value),
                criterios: celdaATexto(row.getCell(COLUMNAS.criterios).value),
                equipoAuditor: celdaATexto(row.getCell(COLUMNAS.equipoAuditor).value),
                auditorLider: celdaATexto(row.getCell(COLUMNAS.auditorLider).value),
                metodoAuditoria: celdaATexto(row.getCell(COLUMNAS.metodoAuditoria).value),
                fecha: celdaATexto(row.getCell(COLUMNAS.fecha).value),
                calendario
            });
        }
        rowNum++;
    }

    return sanitizarDatos({
        empresa: DATOS_DEFECTO.empresa,
        fechaElaboracion,
        auditorias: auditorias.length ? auditorias : DATOS_DEFECTO.auditorias,
        footer: {
            comentariosTitulo: celdaATexto(ws.getCell(FOOTER_CELDAS.comentariosTitulo).value) || DATOS_DEFECTO.footer.comentariosTitulo,
            comentariosDetalle: celdaATexto(ws.getCell(FOOTER_CELDAS.comentariosDetalle).value),
            notaPrograma: celdaATexto(ws.getCell(FOOTER_CELDAS.notaPrograma).value),
            firmaEjecutivo: celdaATexto(ws.getCell(FOOTER_CELDAS.firmaEjecutivo).value) || DATOS_DEFECTO.footer.firmaEjecutivo,
            firmaDireccion: celdaATexto(ws.getCell(FOOTER_CELDAS.firmaDireccion).value) || DATOS_DEFECTO.footer.firmaDireccion
        }
    });
}

async function leerDatosDesdeBuffer(buffer, opciones = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const modo = String(opciones.modo || 'vigente').toLowerCase();
    const ws = obtenerHojaDatos(wb, modo);
    if (!ws) throw new Error('La plantilla SGC-F-07 no contiene hojas.');
    return parsearDatosDesdeHoja(ws);
}

async function leerDatosDesdePlantilla() {
    const buffer = await descargarBufferDrive(TEMPLATE_DRIVE_ID);
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

function escribirAuditoriaEnFilasPar(ws, filaProgramada, filaRealizada, auditoria) {
    const aud = sanitizarAuditoria(auditoria);
    [filaProgramada, filaRealizada].forEach((fila, idx) => {
        const row = ws.getRow(fila);
        asignarTextoSimple(row.getCell(COLUMNAS.noAudi), aud.noAudi, 'center');
        asignarTextoSimple(row.getCell(COLUMNAS.tipoAuditoria), aud.tipoAuditoria, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.alcance), aud.alcance, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.objetivo), aud.objetivo, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.criterios), aud.criterios, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.equipoAuditor), aud.equipoAuditor, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.auditorLider), aud.auditorLider, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.metodoAuditoria), aud.metodoAuditoria, 'left');
        asignarTextoSimple(row.getCell(COLUMNAS.estadoCalendario), idx === 0 ? 'P' : 'R', 'center');
    });

    const rowP = ws.getRow(filaProgramada);
    asignarTextoSimple(rowP.getCell(COLUMNAS.fecha), aud.fecha, 'center');
    MESES_KEYS.forEach((mes, idxMes) => {
        for (let sem = 0; sem < 4; sem++) {
            const col = columnaCalendarioParaMesSemana(idxMes, sem);
            const marcado = aud.calendario?.[mes]?.[sem] === 'X' ? 'X' : '';
            asignarTextoSimple(rowP.getCell(col), marcado, 'center');
        }
    });
}

async function escribirDatosEnPlantilla(datos, driveFileId = DRIVE_FILE_ID_SISTEMA) {
    const templateBuffer = await descargarBufferDrive(driveFileId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = obtenerHojaDatos(wb, 'edicion');
    if (!ws) throw new Error('La plantilla SGC-F-07 no contiene hojas.');

    const datosSanitizados = sanitizarDatos(datos);

    for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
        const row = ws.getRow(r);
        for (let c = COLUMNAS.noAudi; c <= COLUMNAS.calendarioFin; c++) {
            asignarTextoSimple(row.getCell(c), '', c >= COLUMNAS.calendarioInicio ? 'center' : 'left');
        }
    }

    datosSanitizados.auditorias.slice(0, MAX_AUDITORIAS_TABLA).forEach((auditoria, index) => {
        const filaP = indiceFilaProgramada(index);
        escribirAuditoriaEnFilasPar(ws, filaP, filaP + 1, auditoria);
    });

    const footer = sanitizarFooter(datosSanitizados.footer);
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.comentariosTitulo), footer.comentariosTitulo, 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.comentariosDetalle), footer.comentariosDetalle, 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.notaPrograma), footer.notaPrograma, 'left');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.firmaEjecutivo), footer.firmaEjecutivo, 'center');
    asignarTextoSimple(ws.getCell(FOOTER_CELDAS.firmaDireccion), footer.firmaDireccion, 'center');

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function rangoSheet(celda, sheetTitle = SHEET_TITLE) {
    return `'${sheetTitle}'!${celda}`;
}

function datosAActualizacionesSheet(datos, sheetTitle = SHEET_TITLE) {
    const datosSanitizados = sanitizarDatos(datos);
    const actualizaciones = [];

    for (let rowNum = DATA_START_ROW; rowNum <= DATA_END_ROW; rowNum++) {
        for (let colNum = COLUMNAS.noAudi; colNum <= COLUMNAS.calendarioFin; colNum++) {
            actualizaciones.push({
                range: rangoSheet(`${columnaALetra(colNum)}${rowNum}`, sheetTitle),
                values: [['']]
            });
        }
    }

    let rowNum = DATA_START_ROW;
    datosSanitizados.auditorias.slice(0, MAX_AUDITORIAS_TABLA).forEach((auditoriaRaw) => {
        const auditoria = sanitizarAuditoria(auditoriaRaw);
        actualizaciones.push({
            range: rangoSheet(`A${rowNum}`, sheetTitle),
            values: [[auditoria.noAudi || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`B${rowNum}`, sheetTitle),
            values: [[auditoria.tipoAuditoria || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`C${rowNum}`, sheetTitle),
            values: [[auditoria.alcance || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`D${rowNum}`, sheetTitle),
            values: [[auditoria.objetivo || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`E${rowNum}`, sheetTitle),
            values: [[auditoria.criterios || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`F${rowNum}`, sheetTitle),
            values: [[auditoria.equipoAuditor || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`G${rowNum}`, sheetTitle),
            values: [[auditoria.auditorLider || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`H${rowNum}`, sheetTitle),
            values: [[auditoria.metodoAuditoria || '']]
        });
        actualizaciones.push({
            range: rangoSheet(`I${rowNum}`, sheetTitle),
            values: [['P']]
        });
        actualizaciones.push({
            range: rangoSheet(`J${rowNum}`, sheetTitle),
            values: [[auditoria.fecha || '']]
        });
        MESES_KEYS.forEach((mes, idxMes) => {
            for (let sem = 0; sem < 4; sem++) {
                const col = columnaCalendarioParaMesSemana(idxMes, sem);
                const marcado = auditoria.calendario?.[mes]?.[sem] === 'X' ? 'X' : '';
                actualizaciones.push({
                    range: rangoSheet(`${columnaALetra(col)}${rowNum}`, sheetTitle),
                    values: [[marcado]]
                });
            }
        });
        rowNum += 2;
    });

    const footer = sanitizarFooter(datosSanitizados.footer);
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.comentariosTitulo, sheetTitle),
        values: [[footer.comentariosTitulo || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.comentariosDetalle, sheetTitle),
        values: [[footer.comentariosDetalle || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.notaPrograma, sheetTitle),
        values: [[footer.notaPrograma || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.firmaEjecutivo, sheetTitle),
        values: [[footer.firmaEjecutivo || '']]
    });
    actualizaciones.push({
        range: rangoSheet(FOOTER_CELDAS.firmaDireccion, sheetTitle),
        values: [[footer.firmaDireccion || '']]
    });

    return actualizaciones;
}

async function actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle = SHEET_TITLE) {
    const actualizaciones = datosAActualizacionesSheet(datos, sheetTitle);
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    return driveService.obtenerInfoArchivo(spreadsheetId).catch(() => ({ id: spreadsheetId }));
}

async function escribirSnapshotEnHojaDrive(spreadsheetId, sheetTitle, datos) {
    await actualizarDatosEnGoogleSheet(spreadsheetId, datos, sheetTitle);
}

function contenidoEsEquivalente(a, b) {
    const copia = (datos) => {
        const base = sanitizarDatos(datos);
        return base;
    };
    return JSON.stringify(copia(a)) === JSON.stringify(copia(b));
}

function estructuraEsEquivalente(a, b) {
    const fa = Array.isArray(a?.auditorias) ? a.auditorias.length : 0;
    const fb = Array.isArray(b?.auditorias) ? b.auditorias.length : 0;
    return fa === fb;
}

async function aplicarHistorialSgcF07(opciones) {
    const nombreMesAnio = `SGCF07-${excelHistorial.fechaHistorialMmaa(excelHistorial.fechaAhoraMexicoIso())}`;
    return excelHistorial.aplicarHistorialEnDrive({
        codigoFormato: CODIGO_FORMATO,
        spreadsheetId: opciones.spreadsheetId,
        sheetActiva: SHEET_TITLE,
        datosPrevios: opciones.datosPrevios,
        datosNuevos: opciones.datosNuevos,
        hojasAEliminar: [],
        contenidoEsEquivalente,
        estructuraEsEquivalente,
        escribirSnapshotEnHoja: escribirSnapshotEnHojaDrive,
        origen: opciones.origen || 'sistema',
        forzarTipo: opciones.forzarTipo || null,
        usarHojaVigenteComoOrigen: true,
        resolverNombreHistorial: () => nombreMesAnio
    });
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
            console.warn('[SGC-F-07] No se pudo eliminar copia en Drive:', err.message);
        }
    }
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

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA && (await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA))) {
        if (await archivoEstaEnCarpeta(DRIVE_FILE_ID_SISTEMA, CARPETA_DRIVE_ID)) {
            return DRIVE_FILE_ID_SISTEMA;
        }
    }
    const idDb = registro?.drive_file_id || null;
    if (idDb) {
        const existe = await driveService.verificarArchivoExiste(idDb);
        if (existe && (await archivoEstaEnCarpeta(idDb, CARPETA_DRIVE_ID))) {
            return idDb;
        }
    }
    const enCarpeta = await buscarArchivoDriveTrabajo();
    return enCarpeta?.id || DRIVE_FILE_ID_SISTEMA || null;
}

async function subirOReemplazarEnDrive(buffer, driveFileIdPrevio) {
    if (driveFileIdPrevio) {
        try {
            return await driveService.reemplazarArchivoEnDrive(
                driveFileIdPrevio,
                buffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                NOMBRE_ARCHIVO_DRIVE
            );
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo actualizar el archivo en Drive in-place:', err.message);
        }
    }

    const existentes = await buscarArchivoDriveTrabajo();
    if (existentes?.id && existentes.id !== driveFileIdPrevio) {
        try {
            await driveService.eliminarArchivo(existentes.id);
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo eliminar duplicado en Drive:', err.message);
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
            console.warn('[SGC-F-07] No se pudo leer archivo en Drive, usando BD/plantilla:', err.message);
        }
    }

    if (!datos) {
        datos = await leerDatosRegistro(registro);
    }
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo leer plantilla, usando datos por defecto:', err.message);
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    if (!datos?.auditorias?.length) {
        try {
            const plantilla = await leerDatosDesdePlantilla();
            if (plantilla?.auditorias?.length) {
                datos = plantilla;
            }
        } catch (err) {
            console.warn('[SGC-F-07] Plantilla sin auditorías, usando datos por defecto:', err.message);
        }
    }
    if (!datos?.auditorias?.length) {
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
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const incluyeFooterEnPayload = !!(body?.datos?.footer || body?.footer);
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

    if (!incluyeFooterEnPayload && datosPrevios?.footer) {
        datosEntrada.footer = sanitizarFooter(datosPrevios.footer);
    }

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);

    if (!huboCambio && registroPrevio?.drive_file_id) {
        const datosSinCambio = excelHistorial.adjuntarMetaHoja(
            { ...datosEntrada },
            excelHistorial.leerMetaHoja(datosPrevios)
        );
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registroPrevio.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registroPrevio, datosSinCambio, archivoDrive);
    }

    const driveId = await resolverDriveFileId(registroPrevio);
    let datosGuardar = { ...datosEntrada };

    if (driveId) {
        try {
            const infoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => null);
            if (infoDrive?.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const fechaCambio = fechaHoyIso();
                const datosHistorial = origen !== 'consulta'
                    ? { ...datosEntrada, fechaElaboracion: fechaCambio }
                    : datosEntrada;
                const hist = await aplicarHistorialSgcF07({
                    spreadsheetId: driveId,
                    datosPrevios,
                    datosNuevos: datosHistorial,
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

                if (!hist.aplicado) {
                    const buffer = await descargarBufferDrive(driveId);
                    const wb = new ExcelJS.Workbook();
                    await wb.xlsx.load(buffer);
                    const archivoDrive = await actualizarDatosEnGoogleSheet(
                        driveId,
                        datosGuardar
                    );
                    await guardarRegistroDb(pool, {
                        driveFileId: driveId,
                        datos: datosGuardar,
                        fechaElaboracionOriginal: fechaOriginal,
                        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
                        contenidoModificado
                    });
                    const registro = await obtenerRegistroDb(pool);
                    return construirRespuesta(registro, datosGuardar, archivoDrive);
                } else {
                    const archivoDrive = await driveService
                        .obtenerInfoArchivo(driveId)
                        .catch(() => ({ id: driveId }));
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
            }
        } catch (err) {
            console.warn('[SGC-F-07] No se pudo actualizar celdas en Google Sheet, reemplazando archivo:', err.message);
        }
    }

    datosGuardar.fechaElaboracion = contenidoModificado && fechaModificacion
        ? fechaModificacion
        : fechaOriginal;

    const buffer = await escribirDatosEnPlantilla(datosGuardar, driveId || DRIVE_FILE_ID_SISTEMA);
    const archivoDrive = await subirOReemplazarEnDrive(buffer, driveId);
    const metaHoja = await obtenerMetaHojaParaHistorial(archivoDrive.id, archivoDrive);

    await guardarRegistroDb(pool, {
        driveFileId: archivoDrive.id,
        datos: excelHistorial.adjuntarMetaHoja(
            datosGuardar,
            metaHoja
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

    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosDrive);
    if (!huboCambio) {
        const archivoDrive = await driveService
            .obtenerInfoArchivo(registro.drive_file_id)
            .catch(() => null);
        return construirRespuesta(registro, datosDrive, archivoDrive);
    }

    const hist = await aplicarHistorialSgcF07({
        spreadsheetId: registro.drive_file_id,
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

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    let datos = await leerDatosRegistro(registro);
    if (!datos) {
        try {
            datos = await leerDatosDesdePlantilla();
        } catch (err) {
            datos = sanitizarDatos(DATOS_DEFECTO);
        }
    }

    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || fechaHoyIso();
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const datosPublicar = { ...datos };

    if (registro?.drive_file_id) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[SGC-F-07] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    const buffer = await escribirDatosEnPlantilla(datosPublicar);
    const archivoDrive = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        DRIVE_SHEET_OPTIONS
    );

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

module.exports = {
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema
};
