// =====================================================
// Control de resolutivos PIPC (SP-F-29) — BD satélite + Google Sheets
// =====================================================

const { google } = require('googleapis');
const driveService = require('./driveService');

const PC_SPF29_SHEET_ID = process.env.PC_SPF29_SHEET_ID || '1av1MXA-tBjVnWpHmufB55jxUiTrF06ZO';
const PC_SPF29_SHEET_NAME = process.env.PC_SPF29_SHEET_NAME || 'Hoja1';
const PC_SPF29_DESIGN_SHEET_NAME = process.env.PC_SPF29_DESIGN_SHEET_NAME || 'Diseños';
const PC_SPF29_DATA_START_ROW = Number(process.env.PC_SPF29_DATA_START_ROW || 7);
const PC_SPF29_DRIVE_FOLDER_ID = process.env.PC_SPF29_DRIVE_FOLDER_ID || '1Z2Ba-6dUN3mLcAwBhgGkaA8-1uaQxTJJ';
const PC_SPF29_TOTAL_COLS = 10;
const PC_SPF29_COLUMNS = {
    item: 1,
    empresa: 2,
    tipoTramite: 3,
    responsable: 4,
    fechaIngresoTramite: 5,
    fechaOficioObservaciones: 6,
    fechaAprobacion: 7,
    fechaContacto: 8,
    municipio: 9,
    estado: 10
};

const ESTILO_ESTATUS_DISENOS_ROW = {
    'Vigentes': 2,
    'Próximo a vencer': 3,
    'Vencido': 4,
    'En tramite': 5
};

const BORDE_CELDA_TABLA = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
};

const TIPOS_TRAMITE_VALIDOS = ['PIPC', 'OTMS', 'Factibilidad'];
const NOMBRE_ARCHIVO_CONTROL_RESOLUTIVOS = 'SP-F-29 Control de resolutivos PIPC.xlsx';

/** Slots del paso Resolutivo en centro de operaciones → tipo SP-F-29 */
const SLOTS_RESOLUTIVO_CENTRO_OPS = [
    { clave: 'ops_resolutivo_pipc', tipo: 'PIPC', campoFechaAprobacion: 'fecha_aprobacion_pipc' },
    { clave: 'ops_resolutivo_factibilidad', tipo: 'Factibilidad', campoFechaAprobacion: 'fecha_aprobacion_factibilidad' },
    { clave: 'ops_resolutivo_otms', tipo: 'OTMS', campoFechaAprobacion: 'fecha_aprobacion_otms' }
];

const CAMPOS_FECHA_RESOLUTIVO_OPS = new Set(
    SLOTS_RESOLUTIVO_CENTRO_OPS.map((s) => s.campoFechaAprobacion)
);

function slotResolutivoCompleto(archivo, fechaAprobacion) {
    const hasFile = !!(archivo?.archivo_url || archivo?.nombre_archivo);
    const hasAprobacion = !!fechaAprobacion;
    return hasFile && hasAprobacion;
}

/** Vencimiento = un año después de la fecha de aprobación */
function calcularFechaVencimientoDesdeAprobacion(fechaAprobacion) {
    const fa = fechaAprobacion instanceof Date ? fechaAprobacion : parseFechaInput(fechaAprobacion);
    if (!fa || Number.isNaN(fa.getTime())) return null;
    const fv = new Date(fa.getTime());
    fv.setFullYear(fv.getFullYear() + 1);
    return fv;
}

function resolverFechasSlotResolutivo(fechaAprobacion) {
    const fa = parseFechaInput(fechaAprobacion);
    if (!fa) return null;
    const fv = calcularFechaVencimientoDesdeAprobacion(fa);
    if (!fv) return null;
    const contacto = calcularFechaContacto(fv);
    return {
        fecha_aprobacion: toMysqlDate(fa),
        fecha_vencimiento: toMysqlDate(fv),
        fecha_contacto_empresa: contacto ? toMysqlDate(contacto) : null
    };
}

function deepClone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
}

function normalizarTextoControl(valor = '') {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function buildNombreControlResolutivos(extension = 'pdf') {
    const fecha = new Date();
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `control_resolutivos_pipc_${yyyy}${mm}${dd}.${extension}`;
}

function encontrarHojaDisenos(workbook) {
    const objetivo = normalizarTextoControl(PC_SPF29_DESIGN_SHEET_NAME);
    return workbook.worksheets.find((ws) => normalizarTextoControl(ws.name) === objetivo) || null;
}

function extraerEstiloFilaDatosBase(worksheet, rowIdx = PC_SPF29_DATA_START_ROW) {
    const estilos = {};
    const row = worksheet.getRow(rowIdx);
    for (let c = 1; c <= PC_SPF29_TOTAL_COLS; c++) {
        estilos[c] = deepClone(row.getCell(c).style) || {};
    }
    return {
        altura: row.height,
        celdas: estilos
    };
}

function extraerEstilosEstatusDisenos(workbook) {
    const hojaDisenos = encontrarHojaDisenos(workbook);
    const estilos = {};
    if (!hojaDisenos) return estilos;

    Object.entries(ESTILO_ESTATUS_DISENOS_ROW).forEach(([estatus, rowNum]) => {
        const cell = hojaDisenos.getRow(rowNum).getCell(2);
        estilos[estatus] = deepClone(cell.style) || {};
    });
    return estilos;
}

function combinarBordeCelda(estiloBase = {}) {
    const baseBorder = estiloBase.border || {};
    return {
        top: baseBorder.top || BORDE_CELDA_TABLA.top,
        left: baseBorder.left || BORDE_CELDA_TABLA.left,
        bottom: baseBorder.bottom || BORDE_CELDA_TABLA.bottom,
        right: baseBorder.right || BORDE_CELDA_TABLA.right
    };
}

function aplicarEstiloCeldaDatos(cell, estiloBase, estiloEstatus = null) {
    const base = deepClone(estiloBase) || {};
    cell.style = base;
    cell.border = combinarBordeCelda(base);

    if (estiloEstatus) {
        const ref = deepClone(estiloEstatus) || {};
        if (ref.fill) cell.fill = ref.fill;
        if (ref.font) cell.font = ref.font;
        if (ref.alignment) cell.alignment = ref.alignment;
    }
}

function eliminarHojaDisenos(workbook) {
    const hojaDisenos = encontrarHojaDisenos(workbook);
    if (hojaDisenos) {
        workbook.removeWorksheet(hojaDisenos.id);
    }
}

function limpiarFilasEjemploPlantilla(worksheet) {
    for (let row = PC_SPF29_DATA_START_ROW; row <= PC_SPF29_DATA_START_ROW + 120; row++) {
        const rowObj = worksheet.getRow(row);
        for (let col = 1; col <= PC_SPF29_TOTAL_COLS; col++) {
            rowObj.getCell(col).value = null;
        }
    }
}

/**
 * Estatus operativo SP-F-29 (referencia: fecha para contacto empresa):
 * 1) Vencido: hoy >= fecha_contacto + 40 días
 * 2) Próximo a vencer: fecha_contacto está en ventana de 40 días
 *    (desde hoy-39 hasta hoy+40; p.ej. hoy 15/07 → 22/08 es próximo, 29/09 es vigente)
 * 3) Vigentes: tiene fecha de aprobación (contacto aún lejano o fuera de ventana crítica)
 * 4) En tramite: en cualquier otro caso
 */
function calcularEstatusResolutivo(fechaAprobacionOpciones, asignacionIncompleta = false) {
    let fechaAprobacion = null;
    let fechaContactoEmpresa = null;
    let incompleta = !!asignacionIncompleta;

    if (fechaAprobacionOpciones && typeof fechaAprobacionOpciones === 'object' && !(fechaAprobacionOpciones instanceof Date)) {
        fechaAprobacion = fechaAprobacionOpciones.fechaAprobacion ?? fechaAprobacionOpciones.fecha_aprobacion ?? null;
        fechaContactoEmpresa = fechaAprobacionOpciones.fechaContactoEmpresa
            ?? fechaAprobacionOpciones.fecha_contacto_empresa
            ?? null;
        incompleta = !!(fechaAprobacionOpciones.asignacionIncompleta ?? incompleta);
    } else {
        incompleta = !!asignacionIncompleta;
    }

    if (incompleta) return 'En tramite';

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const MS_DIA = 1000 * 60 * 60 * 24;

    const fc = parseFechaInput(fechaContactoEmpresa);
    if (fc) {
        fc.setHours(0, 0, 0, 0);
        const diasHastaContacto = Math.round((fc.getTime() - hoy.getTime()) / MS_DIA);

        // Más de 40 días después de la fecha de contacto → Vencido
        if (diasHastaContacto <= -40) return 'Vencido';

        // Dentro del margen de 40 días (antes o ya llegada la fecha de contacto) → Próximo
        // Ej.: hoy 15/07/2026, contacto 22/08/2026 (+38) → Próximo
        //      hoy 15/07/2026, contacto 29/09/2026 (+76) → no entra aquí
        if (diasHastaContacto <= 40) return 'Próximo a vencer';
    }

    const fa = parseFechaInput(fechaAprobacion);
    if (fa) return 'Vigentes';

    return 'En tramite';
}

async function verificarAsignacionIncompleta(poolPC, documentoAsignacionId, empresaId) {
    if (!poolPC || !documentoAsignacionId) return false;

    const [grupoRows] = await poolPC.query(
        `SELECT documento_id, documento_padre_id, estatus, tipo_entrada, archivo_url, valor_texto
         FROM documento_proteccion_civil
         WHERE documento_id = ? OR documento_padre_id = ?`,
        [documentoAsignacionId, documentoAsignacionId]
    );

    if (!grupoRows.length) return false;

    const padre = grupoRows.find((r) => Number(r.documento_id) === Number(documentoAsignacionId));
    if (!padre) return true;

    const hijos = grupoRows.filter((r) => Number(r.documento_padre_id) === Number(documentoAsignacionId));
    const documentosObjetivo = hijos.length > 0 ? hijos : [padre];

    return documentosObjetivo.some((doc) => {
        if (String(doc.estatus || '').toLowerCase() !== 'aprobado') return true;
        if (String(doc.tipo_entrada || '').toLowerCase() === 'texto') {
            return !String(doc.valor_texto || '').trim();
        }
        return !String(doc.archivo_url || '').trim();
    });
}

function poblarHojaControlResolutivos(worksheet, registros, estiloFilaBase) {
    limpiarFilasEjemploPlantilla(worksheet);

    for (let i = 0; i < registros.length; i++) {
        const excelRow = PC_SPF29_DATA_START_ROW + i;
        const item = registros[i];

        const row = worksheet.getRow(excelRow);
        if (estiloFilaBase.altura) {
            row.height = estiloFilaBase.altura;
        }

        for (let c = 1; c <= PC_SPF29_TOTAL_COLS; c++) {
            const cell = row.getCell(c);
            aplicarEstiloCeldaDatos(cell, estiloFilaBase.celdas[c]);
        }

        row.getCell(PC_SPF29_COLUMNS.item).value = item.item;
        row.getCell(PC_SPF29_COLUMNS.empresa).value = item.nombre_empresa || '';
        row.getCell(PC_SPF29_COLUMNS.tipoTramite).value = item.tipo_tramite || '';
        row.getCell(PC_SPF29_COLUMNS.responsable).value = item.responsable || '';
        row.getCell(PC_SPF29_COLUMNS.fechaIngresoTramite).value = formatearFechaMx(item.fecha_ingreso_tramite);
        row.getCell(PC_SPF29_COLUMNS.fechaOficioObservaciones).value = formatearFechaMx(item.fecha_oficio_observaciones);
        row.getCell(PC_SPF29_COLUMNS.fechaAprobacion).value = formatearFechaMx(item.fecha_aprobacion);
        row.getCell(PC_SPF29_COLUMNS.fechaContacto).value = formatearFechaMx(item.fecha_contacto_empresa);
        row.getCell(PC_SPF29_COLUMNS.municipio).value = item.municipio || '';
        row.getCell(PC_SPF29_COLUMNS.estado).value = item.estado || '';
    }

    const lastDataRow = Math.max(PC_SPF29_DATA_START_ROW, PC_SPF29_DATA_START_ROW + registros.length - 1);
    worksheet.pageSetup = {
        ...(worksheet.pageSetup || {}),
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printArea: `A1:J${lastDataRow}`
    };
}

function formatearFechaMx(dateInput) {
    const d = dateInput instanceof Date ? dateInput : parseFechaInput(dateInput);
    if (!d || Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function parseFechaInput(valor) {
    if (!valor) return null;
    const s = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
        return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function calcularFechaContacto(fechaVencimiento) {
    const fv = parseFechaInput(fechaVencimiento);
    if (!fv) return null;
    const contacto = new Date(fv.getTime());
    contacto.setDate(contacto.getDate() - 40);
    return contacto;
}

function toMysqlDate(dateInput) {
    const d = dateInput instanceof Date ? dateInput : parseFechaInput(dateInput);
    if (!d || Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function migrarEsquemaResolutivos(poolSgc) {
    const alteraciones = [
        `ALTER TABLE pc_control_resolutivos ADD COLUMN estatus VARCHAR(40) NULL DEFAULT NULL AFTER responsable`,
        `ALTER TABLE pc_control_resolutivos MODIFY COLUMN tipo_tramite VARCHAR(80) NULL`,
        `ALTER TABLE pc_control_resolutivos MODIFY COLUMN fecha_aprobacion DATE NULL`,
        `ALTER TABLE pc_control_resolutivos MODIFY COLUMN fecha_vencimiento DATE NULL`,
        `ALTER TABLE pc_control_resolutivos MODIFY COLUMN fecha_contacto_empresa DATE NULL`,
        `ALTER TABLE pc_control_resolutivos ADD COLUMN fecha_ingreso_tramite DATE NULL AFTER fecha_contacto_empresa`,
        `ALTER TABLE pc_control_resolutivos ADD COLUMN fecha_oficio_observaciones DATE NULL AFTER fecha_ingreso_tramite`
    ];

    for (const sql of alteraciones) {
        try {
            await poolSgc.query(sql);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                // ignore if column already exists or type already nullable
            }
        }
    }

    try {
        await poolSgc.query('ALTER TABLE pc_control_resolutivos DROP INDEX uk_pc_resolutivo_asignacion');
    } catch (err) {
        if (err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
            // índice ya eliminado o no existe
        }
    }

    try {
        await poolSgc.query(
            `ALTER TABLE pc_control_resolutivos
             ADD UNIQUE KEY uk_pc_resolutivo_asignacion_tipo (empresa_id_biznaga, documento_asignacion_pc_id, tipo_tramite)`
        );
    } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') {
            // ya migrado
        }
    }
}

async function asegurarTablaPcControlResolutivos(poolSgc) {
    await poolSgc.query(`
        CREATE TABLE IF NOT EXISTS pc_control_resolutivos (
            resolutivo_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            item INT UNSIGNED NOT NULL,
            empresa_id_biznaga INT UNSIGNED NOT NULL,
            documento_asignacion_pc_id INT UNSIGNED NULL,
            nombre_empresa VARCHAR(200) NOT NULL,
            nombre_asignacion VARCHAR(200) NULL,
            tipo_tramite VARCHAR(80) NULL,
            responsable VARCHAR(200) NOT NULL,
            estatus VARCHAR(40) NULL,
            responsable_usuario_id INT UNSIGNED NULL,
            fecha_aprobacion DATE NULL,
            fecha_vencimiento DATE NULL,
            fecha_contacto_empresa DATE NULL,
            municipio VARCHAR(120) NULL,
            estado VARCHAR(120) NULL,
            sheet_file_id VARCHAR(80) NULL,
            sheet_row INT UNSIGNED NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (resolutivo_id),
            UNIQUE KEY uk_pc_resolutivo_asignacion (empresa_id_biznaga, documento_asignacion_pc_id),
            KEY idx_pc_resolutivo_empresa (empresa_id_biznaga),
            KEY idx_pc_resolutivo_item (item)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await migrarEsquemaResolutivos(poolSgc);
}

function resolverEstatusRegistro(row, asignacionIncompleta) {
    return calcularEstatusResolutivo({
        fechaAprobacion: row.fecha_aprobacion,
        fechaContactoEmpresa: row.fecha_contacto_empresa,
        asignacionIncompleta
    });
}

function normalizarNombreAsignacion(valor = '') {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

async function obtenerResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId, tipoTramite = null) {
    if (!documentoAsignacionId) return null;
    let sql = `SELECT resolutivo_id, item, estatus, fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                      tipo_tramite, documento_asignacion_pc_id, nombre_asignacion, nombre_empresa,
                      responsable, responsable_usuario_id, municipio, estado
               FROM pc_control_resolutivos
               WHERE empresa_id_biznaga = ? AND documento_asignacion_pc_id = ? AND activo = 1`;
    const params = [empresaId, documentoAsignacionId];
    if (tipoTramite) {
        sql += ' AND tipo_tramite = ?';
        params.push(tipoTramite);
    }
    sql += ' ORDER BY resolutivo_id ASC LIMIT 1';
    const [rows] = await poolSgc.query(sql, params);
    return rows[0] || null;
}

async function obtenerResolutivoPorEmpresaYTipo(poolSgc, empresaId, tipoTramite) {
    if (!tipoTramite) return null;
    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, estatus, fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                tipo_tramite, documento_asignacion_pc_id, nombre_asignacion, nombre_empresa,
                responsable, responsable_usuario_id, municipio, estado
         FROM pc_control_resolutivos
         WHERE empresa_id_biznaga = ? AND tipo_tramite = ? AND activo = 1
         ORDER BY resolutivo_id DESC LIMIT 1`,
        [empresaId, tipoTramite]
    );
    return rows[0] || null;
}

async function obtenerResolutivoPlaceholderAsignacion(poolSgc, empresaId, documentoAsignacionId) {
    if (!documentoAsignacionId) return null;
    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, estatus, fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                tipo_tramite, documento_asignacion_pc_id, nombre_asignacion, nombre_empresa,
                responsable, responsable_usuario_id, municipio, estado
         FROM pc_control_resolutivos
         WHERE empresa_id_biznaga = ? AND documento_asignacion_pc_id = ? AND activo = 1
           AND (tipo_tramite IS NULL OR TRIM(tipo_tramite) = '')
         ORDER BY resolutivo_id ASC LIMIT 1`,
        [empresaId, documentoAsignacionId]
    );
    return rows[0] || null;
}

async function resolverDocumentoAsignacionActivaPC(poolPC, empresaId) {
    if (!poolPC) return null;
    const [rows] = await poolPC.query(
        `SELECT documento_id, nombre_documento
         FROM documento_proteccion_civil
         WHERE empresa_id = ?
           AND (documento_padre_id IS NULL OR documento_padre_id = 0)
           AND (clave_workflow IS NULL OR clave_workflow = '')
         ORDER BY documento_id DESC LIMIT 1`,
        [empresaId]
    );
    return rows[0] || null;
}

async function obtenerResolutivoEnTramitePorNombre(poolSgc, empresaId, nombreAsignacion) {
    const objetivo = normalizarNombreAsignacion(String(nombreAsignacion || '').replace(/\.xlsx?$/i, '').trim());
    if (!objetivo) return null;

    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, estatus, documento_asignacion_pc_id, nombre_asignacion
         FROM pc_control_resolutivos
         WHERE empresa_id_biznaga = ? AND activo = 1 AND LOWER(TRIM(estatus)) = 'en tramite'`,
        [empresaId]
    );

    return rows.find((row) => normalizarNombreAsignacion(row.nombre_asignacion) === objetivo) || null;
}

function esResolutivoPlaceholder(row) {
    if (!row) return false;
    if (String(row.estatus || '').toLowerCase() === 'en tramite') return true;
    return !row.fecha_aprobacion || !row.fecha_vencimiento || !row.tipo_tramite;
}

async function obtenerDatosEmpresaResolutivo(poolBiznaga, empresaId) {
    const [empresaRows] = await poolBiznaga.query(
        `SELECT nombre_empresa, ciudad, estado
         FROM empresa WHERE empresa_id = ? AND activo = TRUE LIMIT 1`,
        [empresaId]
    );
    if (!empresaRows.length) {
        throw new Error('Empresa no encontrada en la base principal');
    }
    return empresaRows[0];
}

/** Quita prefijos/cargos del nombre (ej. "Ing. Hector" → "Hector"). */
function limpiarTitulosNombre(valor = '') {
    let texto = String(valor || '').trim();
    if (!texto) return '';
    const prefijos = /^(?:(?:Ing|Lic|Dr|Dra|Mtro|Mtr|Mtra|Arq|CP|Prof|Profr|Sr|Sra|Q\s?F\s?B)\.?\s+)+/i;
    return texto.replace(prefijos, '').trim();
}

function formatearNombreResponsable(nombre, apellido) {
    const n = limpiarTitulosNombre(nombre);
    const a = String(apellido || '').trim();
    return [n, a].filter(Boolean).join(' ').trim();
}

async function resolverNombreResponsableUsuario(poolBiznaga, usuarioId, fallback = '') {
    if (usuarioId && poolBiznaga) {
        try {
            const [rows] = await poolBiznaga.query(
                'SELECT nombre, apellido, username FROM usuario WHERE id = ? LIMIT 1',
                [usuarioId]
            );
            if (rows.length) {
                const formatted = formatearNombreResponsable(rows[0].nombre, rows[0].apellido);
                if (formatted) return formatted;
                const username = String(rows[0].username || '').trim();
                if (username) return username;
            }
        } catch (_err) {
            // usar fallback
        }
    }
    const fb = String(fallback || '').trim();
    return fb || 'Usuario';
}

async function obtenerSiguienteItem(poolSgc) {
    const [rows] = await poolSgc.query(
        'SELECT COALESCE(MAX(item), 0) AS max_item FROM pc_control_resolutivos WHERE activo = 1'
    );
    return Number(rows[0]?.max_item || 0) + 1;
}

async function existeResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId) {
    if (!documentoAsignacionId) return false;
    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id FROM pc_control_resolutivos
         WHERE empresa_id_biznaga = ? AND documento_asignacion_pc_id = ? AND activo = 1
         LIMIT 1`,
        [empresaId, documentoAsignacionId]
    );
    return rows.length > 0;
}

async function obtenerAuthSheets() {
    await driveService.validarAutenticacionDrive();
    const auth = driveService.getAuthClient?.();
    if (!auth) {
        throw new Error('Google Drive/Sheets no está autenticado');
    }
    return google.sheets({ version: 'v4', auth });
}

async function appendFilaSpf29(fila) {
    const sheetsApi = await obtenerAuthSheets();
    const range = `${PC_SPF29_SHEET_NAME}!A:J`;
    const response = await sheetsApi.spreadsheets.values.append({
        spreadsheetId: PC_SPF29_SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [fila] }
    });
    const updatedRange = response?.data?.updates?.updatedRange || '';
    const match = updatedRange.match(/!A(\d+)/i);
    const sheetRow = match ? Number(match[1]) : null;
    return { sheetRow, updatedRange };
}

async function crearResolutivoEnTramite({
    poolSgc,
    poolBiznaga,
    empresaId,
    documentoAsignacionId,
    nombreAsignacion,
    responsable,
    responsableUsuarioId
}) {
    if (!documentoAsignacionId) return null;

    await asegurarTablaPcControlResolutivos(poolSgc);

    const existente = await obtenerResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId);
    if (existente) {
        return { resolutivo_id: existente.resolutivo_id, item: existente.item, ya_existia: true };
    }

    const existentePorNombre = nombreAsignacion
        ? await obtenerResolutivoEnTramitePorNombre(poolSgc, empresaId, nombreAsignacion)
        : null;
    if (existentePorNombre) {
        if (documentoAsignacionId && Number(existentePorNombre.documento_asignacion_pc_id) !== Number(documentoAsignacionId)) {
            await poolSgc.query(
                `UPDATE pc_control_resolutivos
                 SET documento_asignacion_pc_id = ?, updated_at = NOW()
                 WHERE resolutivo_id = ?`,
                [documentoAsignacionId, existentePorNombre.resolutivo_id]
            );
        }
        return {
            resolutivo_id: existentePorNombre.resolutivo_id,
            item: existentePorNombre.item,
            ya_existia: true
        };
    }

    const empresa = await obtenerDatosEmpresaResolutivo(poolBiznaga, empresaId);
    const nombreEmpresa = empresa.nombre_empresa || '';
    const municipio = empresa.ciudad || '';
    const estadoEmpresa = empresa.estado || '';
    const item = await obtenerSiguienteItem(poolSgc);
    const nombreResponsable = await resolverNombreResponsableUsuario(
        poolBiznaga,
        responsableUsuarioId,
        responsable
    );

    const [insertResult] = await poolSgc.query(
        `INSERT INTO pc_control_resolutivos (
            item, empresa_id_biznaga, documento_asignacion_pc_id,
            nombre_empresa, nombre_asignacion, tipo_tramite,
            responsable, estatus, responsable_usuario_id,
            fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
            municipio, estado
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'En tramite', ?, NULL, NULL, NULL, ?, ?)`,
        [
            item,
            empresaId,
            documentoAsignacionId,
            nombreEmpresa,
            nombreAsignacion || null,
            nombreResponsable || '—',
            responsableUsuarioId || null,
            municipio,
            estadoEmpresa
        ]
    );

    return {
        resolutivo_id: insertResult.insertId,
        item,
        nombre_empresa: nombreEmpresa,
        nombre_asignacion: nombreAsignacion || null,
        responsable: nombreResponsable,
        estatus: 'En tramite',
        ya_existia: false
    };
}

/**
 * Al completar el paso Resolutivo del centro de operaciones: un registro SP-F-29 por cada
 * PIPC asignado con archivo + fecha de aprobación. Fallback legacy: PIPC/Factibilidad/OTMS.
 */
async function sincronizarResolutivosCentroOperaciones({
    poolSgc,
    poolBiznaga,
    poolPC,
    empresaId,
    responsableUsuarioId = null
}) {
    if (!poolPC?.query || !poolSgc?.query || !poolBiznaga?.query) {
        return { sincronizados: 0, registros: [] };
    }

    await asegurarTablaPcControlResolutivos(poolSgc);

    const [cicloRows] = await poolPC.query(
        `SELECT operacion_id,
                fecha_aprobacion_pipc, fecha_aprobacion_factibilidad, fecha_aprobacion_otms,
                fechas_workflow
         FROM pc_centro_operaciones
         WHERE empresa_id = ? AND activo = 1 AND ciclo_cerrado_at IS NULL
         ORDER BY operacion_id DESC LIMIT 1`,
        [empresaId]
    );
    if (!cicloRows.length) {
        return { sincronizados: 0, registros: [] };
    }
    const ciclo = cicloRows[0];

    let fechasWorkflow = {};
    try {
        const raw = ciclo.fechas_workflow;
        fechasWorkflow = raw
            ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
            : {};
        if (!fechasWorkflow || typeof fechasWorkflow !== 'object' || Array.isArray(fechasWorkflow)) {
            fechasWorkflow = {};
        }
    } catch {
        fechasWorkflow = {};
    }

    const [allDocs] = await poolPC.query(
        `SELECT documento_id, documento_padre_id, catalogo_documento_id, clave_workflow,
                nombre_documento, archivo_url, nombre_archivo, tipo_entrada, valor_texto, estatus
         FROM documento_proteccion_civil WHERE empresa_id = ?`,
        [empresaId]
    );

    const pcOps = require('./pcCentroOperaciones');
    const pipcAsignados = pcOps.listarPipcAsignadosActivos(allDocs);

    let slotsCompletos = [];

    if (pipcAsignados.length > 0) {
        for (const pipc of pipcAsignados) {
            const tipos = [
                { clave: pipc.clave_resolutivo_pipc || `ops_resolutivo_pipc_${pipc.documento_id}`, tipo: 'PIPC' },
                { clave: pipc.clave_resolutivo_factibilidad || `ops_resolutivo_factibilidad_${pipc.documento_id}`, tipo: 'Factibilidad' },
                { clave: pipc.clave_resolutivo_otms || `ops_resolutivo_otms_${pipc.documento_id}`, tipo: 'OTMS' }
            ];
            for (const slot of tipos) {
                const [docRows] = await poolPC.query(
                    `SELECT archivo_url, nombre_archivo
                     FROM documento_proteccion_civil
                     WHERE empresa_id = ? AND clave_workflow = ? LIMIT 1`,
                    [empresaId, slot.clave]
                );
                const archivo = docRows[0] || null;
                const fechaAprobacion = fechasWorkflow[slot.clave] || null;
                if (slotResolutivoCompleto(archivo, fechaAprobacion)) {
                    slotsCompletos.push({
                        tipo: slot.tipo,
                        fechaAprobacion,
                        archivo,
                        documentoAsignacionId: pipc.documento_id,
                        nombreAsignacion: pipc.nombre_documento
                    });
                }
            }
            // Compat: slot único antiguo ops_resolutivo_{id}
            const claveLegacy = `ops_resolutivo_${pipc.documento_id}`;
            if (!fechasWorkflow[`ops_resolutivo_pipc_${pipc.documento_id}`]) {
                const [docLegacy] = await poolPC.query(
                    `SELECT archivo_url, nombre_archivo
                     FROM documento_proteccion_civil
                     WHERE empresa_id = ? AND clave_workflow = ? LIMIT 1`,
                    [empresaId, claveLegacy]
                );
                const archivo = docLegacy[0] || null;
                const fechaAprobacion = fechasWorkflow[claveLegacy] || null;
                if (slotResolutivoCompleto(archivo, fechaAprobacion)) {
                    slotsCompletos.push({
                        tipo: 'PIPC',
                        fechaAprobacion,
                        archivo,
                        documentoAsignacionId: pipc.documento_id,
                        nombreAsignacion: pipc.nombre_documento
                    });
                }
            }
        }
    } else {
        const archivosWorkflow = {};
        for (const slot of SLOTS_RESOLUTIVO_CENTRO_OPS) {
            const [docRows] = await poolPC.query(
                `SELECT archivo_url, nombre_archivo
                 FROM documento_proteccion_civil
                 WHERE empresa_id = ? AND clave_workflow = ? LIMIT 1`,
                [empresaId, slot.clave]
            );
            archivosWorkflow[slot.clave] = docRows[0] || null;
        }
        slotsCompletos = SLOTS_RESOLUTIVO_CENTRO_OPS
            .map((slot) => ({
                tipo: slot.tipo,
                fechaAprobacion: ciclo[slot.campoFechaAprobacion] || null,
                archivo: archivosWorkflow[slot.clave],
                documentoAsignacionId: null,
                nombreAsignacion: null
            }))
            .filter((s) => slotResolutivoCompleto(s.archivo, s.fechaAprobacion));
    }

    if (!slotsCompletos.length) {
        return { sincronizados: 0, registros: [] };
    }

    const asignacionFallback = await resolverDocumentoAsignacionActivaPC(poolPC, empresaId);
    const empresa = await obtenerDatosEmpresaResolutivo(poolBiznaga, empresaId);
    const nombreResponsable = await resolverNombreResponsableUsuario(
        poolBiznaga,
        responsableUsuarioId,
        null
    );

    const registros = [];
    let plantillaGlobal = null;
    let usoPlaceholder = false;

    for (const slot of slotsCompletos) {
        const fechas = resolverFechasSlotResolutivo(slot.fechaAprobacion);
        if (!fechas) continue;

        const documentoAsignacionId = slot.documentoAsignacionId || asignacionFallback?.documento_id || null;
        const nombreAsignacion = slot.nombreAsignacion || asignacionFallback?.nombre_documento || null;

        let plantilla = documentoAsignacionId
            ? await obtenerResolutivoPlaceholderAsignacion(poolSgc, empresaId, documentoAsignacionId)
            : null;
        if (!plantilla && !plantillaGlobal) {
            const [fallback] = await poolSgc.query(
                `SELECT resolutivo_id, item, estatus, fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                        tipo_tramite, documento_asignacion_pc_id, nombre_asignacion, nombre_empresa,
                        responsable, responsable_usuario_id, municipio, estado
                 FROM pc_control_resolutivos
                 WHERE empresa_id_biznaga = ? AND activo = 1
                 ORDER BY resolutivo_id DESC LIMIT 1`,
                [empresaId]
            );
            plantillaGlobal = fallback[0] || null;
            usoPlaceholder = !!plantillaGlobal && !plantillaGlobal.tipo_tramite;
        }
        if (!plantilla) plantilla = usoPlaceholder ? plantillaGlobal : null;

        const base = {
            documento_asignacion_pc_id: documentoAsignacionId || plantilla?.documento_asignacion_pc_id || null,
            nombre_empresa: plantilla?.nombre_empresa || empresa.nombre_empresa || '',
            nombre_asignacion: nombreAsignacion || plantilla?.nombre_asignacion || null,
            responsable: plantilla?.responsable || nombreResponsable || '—',
            responsable_usuario_id: plantilla?.responsable_usuario_id || responsableUsuarioId || null,
            fecha_vencimiento: plantilla?.fecha_vencimiento || null,
            fecha_contacto_empresa: plantilla?.fecha_contacto_empresa || null,
            estatus: plantilla?.estatus || 'En tramite',
            municipio: plantilla?.municipio || empresa.ciudad || '',
            estado: plantilla?.estado || empresa.estado || ''
        };

        let existentePorTipo = documentoAsignacionId
            ? await obtenerResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId, slot.tipo)
            : null;
        if (!existentePorTipo) {
            existentePorTipo = await obtenerResolutivoPorEmpresaYTipo(poolSgc, empresaId, slot.tipo);
        }

        if (!existentePorTipo && usoPlaceholder && plantilla) {
            await poolSgc.query(
                `UPDATE pc_control_resolutivos SET
                    nombre_asignacion = COALESCE(?, nombre_asignacion),
                    documento_asignacion_pc_id = COALESCE(?, documento_asignacion_pc_id),
                    tipo_tramite = ?,
                    fecha_aprobacion = ?,
                    fecha_vencimiento = ?,
                    fecha_contacto_empresa = ?,
                    responsable = COALESCE(?, responsable),
                    responsable_usuario_id = COALESCE(?, responsable_usuario_id),
                    municipio = COALESCE(?, municipio),
                    estado = COALESCE(?, estado),
                    estatus = 'En tramite',
                    updated_at = NOW()
                 WHERE resolutivo_id = ?`,
                [
                    base.nombre_asignacion,
                    base.documento_asignacion_pc_id,
                    slot.tipo,
                    fechas.fecha_aprobacion,
                    fechas.fecha_vencimiento,
                    fechas.fecha_contacto_empresa,
                    base.responsable,
                    base.responsable_usuario_id,
                    base.municipio,
                    base.estado,
                    plantilla.resolutivo_id
                ]
            );
            registros.push({
                resolutivo_id: plantilla.resolutivo_id,
                item: plantilla.item,
                tipo_tramite: slot.tipo,
                ...fechas,
                actualizado: true
            });
            usoPlaceholder = false;
            plantillaGlobal = null;
            continue;
        }

        if (existentePorTipo) {
            await poolSgc.query(
                `UPDATE pc_control_resolutivos SET
                    fecha_aprobacion = ?,
                    fecha_vencimiento = ?,
                    fecha_contacto_empresa = ?,
                    nombre_asignacion = COALESCE(?, nombre_asignacion),
                    documento_asignacion_pc_id = COALESCE(?, documento_asignacion_pc_id),
                    estatus = 'En tramite',
                    updated_at = NOW()
                 WHERE resolutivo_id = ?`,
                [
                    fechas.fecha_aprobacion,
                    fechas.fecha_vencimiento,
                    fechas.fecha_contacto_empresa,
                    base.nombre_asignacion,
                    base.documento_asignacion_pc_id,
                    existentePorTipo.resolutivo_id
                ]
            );
            registros.push({
                resolutivo_id: existentePorTipo.resolutivo_id,
                item: existentePorTipo.item,
                tipo_tramite: slot.tipo,
                ...fechas,
                actualizado: true
            });
            continue;
        }

        const item = await obtenerSiguienteItem(poolSgc);
        const [insertResult] = await poolSgc.query(
            `INSERT INTO pc_control_resolutivos (
                item, empresa_id_biznaga, documento_asignacion_pc_id,
                nombre_empresa, nombre_asignacion, tipo_tramite,
                responsable, estatus, responsable_usuario_id,
                fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                municipio, estado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                item,
                empresaId,
                base.documento_asignacion_pc_id,
                base.nombre_empresa,
                base.nombre_asignacion,
                slot.tipo,
                base.responsable,
                'En tramite',
                base.responsable_usuario_id,
                fechas.fecha_aprobacion,
                fechas.fecha_vencimiento,
                fechas.fecha_contacto_empresa,
                base.municipio,
                base.estado
            ]
        );
        registros.push({
            resolutivo_id: insertResult.insertId,
            item,
            tipo_tramite: slot.tipo,
            ...fechas,
            actualizado: false
        });
    }

    return { sincronizados: registros.length, registros };
}

async function registrarResolutivoPipc({
    poolSgc,
    poolBiznaga,
    poolPC = null,
    empresaId,
    documentoAsignacionId,
    nombreAsignacion,
    tipoTramite,
    fechaAprobacion,
    fechaVencimiento,
    responsable,
    responsableUsuarioId
}) {
    const tipo = String(tipoTramite || '').trim();
    if (!TIPOS_TRAMITE_VALIDOS.includes(tipo)) {
        throw new Error(`Tipo de trámite inválido. Use: ${TIPOS_TRAMITE_VALIDOS.join(', ')}`);
    }

    const fa = parseFechaInput(fechaAprobacion);
    const fv = parseFechaInput(fechaVencimiento);
    if (!fa || !fv) {
        throw new Error('Fechas de aprobación y vencimiento son obligatorias y deben ser válidas');
    }
    if (fv.getTime() < fa.getTime()) {
        throw new Error('La fecha de vencimiento no puede ser anterior a la de aprobación');
    }

    const fechaContacto = calcularFechaContacto(fv);
    if (!fechaContacto) {
        throw new Error('No se pudo calcular la fecha para contacto empresa');
    }

    await asegurarTablaPcControlResolutivos(poolSgc);

    const nombreResponsable = await resolverNombreResponsableUsuario(
        poolBiznaga,
        responsableUsuarioId,
        responsable
    );

    let existente = documentoAsignacionId
        ? await obtenerResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId, tipo)
        : null;
    if (!existente && documentoAsignacionId) {
        const placeholder = await obtenerResolutivoPlaceholderAsignacion(
            poolSgc,
            empresaId,
            documentoAsignacionId
        );
        if (placeholder && esResolutivoPlaceholder(placeholder)) {
            existente = placeholder;
        }
    }

    if (existente && !esResolutivoPlaceholder(existente)) {
        const err = new Error('Esta asignación ya tiene un resolutivo registrado en SP-F-29');
        err.code = 'RESOLUTIVO_YA_REGISTRADO';
        throw err;
    }

    const empresa = await obtenerDatosEmpresaResolutivo(poolBiznaga, empresaId);
    const nombreEmpresa = empresa.nombre_empresa || '';
    const municipio = empresa.ciudad || '';
    const estado = empresa.estado || '';
    const nuevoEstatus = calcularEstatusResolutivo({
        fechaAprobacion: fa,
        fechaContactoEmpresa: fechaContacto,
        asignacionIncompleta: false
    });

    if (existente && esResolutivoPlaceholder(existente)) {
        await poolSgc.query(
            `UPDATE pc_control_resolutivos SET
                nombre_asignacion = COALESCE(?, nombre_asignacion),
                tipo_tramite = ?,
                responsable = ?,
                responsable_usuario_id = ?,
                fecha_aprobacion = ?,
                fecha_vencimiento = ?,
                fecha_contacto_empresa = ?,
                estatus = ?,
                municipio = ?,
                estado = ?,
                updated_at = NOW()
             WHERE resolutivo_id = ?`,
            [
                nombreAsignacion || null,
                tipo,
                nombreResponsable || '—',
                responsableUsuarioId || null,
                toMysqlDate(fa),
                toMysqlDate(fv),
                toMysqlDate(fechaContacto),
                nuevoEstatus,
                municipio,
                estado,
                existente.resolutivo_id
            ]
        );

        return {
            resolutivo_id: existente.resolutivo_id,
            item: existente.item,
            nombre_empresa: nombreEmpresa,
            nombre_asignacion: nombreAsignacion || null,
            tipo_tramite: tipo,
            responsable: nombreResponsable || '—',
            fecha_aprobacion: toMysqlDate(fa),
            fecha_vencimiento: toMysqlDate(fv),
            fecha_contacto_empresa: toMysqlDate(fechaContacto),
            estatus: nuevoEstatus,
            municipio,
            estado,
            actualizado: true,
            sync_sheets: false
        };
    }

    const item = await obtenerSiguienteItem(poolSgc);

    // Sincronización con Google Sheets desactivada por defecto (SP-F-29 puede ser .xlsx en Drive).
    // Activar con PC_SPF29_SYNC_SHEETS=true cuando el archivo sea Google Sheets nativo.
    const syncSheets = String(process.env.PC_SPF29_SYNC_SHEETS || '').toLowerCase() === 'true';
    let sheetRow = null;
    let sheetFileId = null;

    if (syncSheets) {
        const fechasCentroOps = await obtenerFechasCentroOperacionesPorEmpresas(poolPC, [empresaId]);
        const fechasOps = fechasCentroOps.get(Number(empresaId)) || {};
        const filaSheet = [
            item,
            nombreEmpresa,
            tipo,
            nombreResponsable || '—',
            formatearFechaMx(fechasOps.fecha_ingreso_tramite),
            formatearFechaMx(fechasOps.fecha_oficio_observaciones),
            formatearFechaMx(fa),
            formatearFechaMx(fechaContacto),
            municipio,
            estado
        ];
        try {
            const sheetResult = await appendFilaSpf29(filaSheet);
            sheetRow = sheetResult.sheetRow;
            sheetFileId = PC_SPF29_SHEET_ID;
        } catch (sheetErr) {
            console.warn('[PC Resolutivos] No se pudo escribir en Google Sheets (se guardará solo en BD):', sheetErr.message);
        }
    } else {
        console.log('[PC Resolutivos] Registro solo en BD (PC_SPF29_SYNC_SHEETS no activo)');
    }

    const [insertResult] = await poolSgc.query(
        `INSERT INTO pc_control_resolutivos (
            item, empresa_id_biznaga, documento_asignacion_pc_id,
            nombre_empresa, nombre_asignacion, tipo_tramite,
            responsable, estatus, responsable_usuario_id,
            fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
            municipio, estado, sheet_file_id, sheet_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            item,
            empresaId,
            documentoAsignacionId || null,
            nombreEmpresa,
            nombreAsignacion || null,
            tipo,
            nombreResponsable || '—',
            nuevoEstatus,
            responsableUsuarioId || null,
            toMysqlDate(fa),
            toMysqlDate(fv),
            toMysqlDate(fechaContacto),
            municipio,
            estado,
            sheetFileId,
            sheetRow
        ]
    );

    return {
        resolutivo_id: insertResult.insertId,
        item,
        nombre_empresa: nombreEmpresa,
        nombre_asignacion: nombreAsignacion || null,
        tipo_tramite: tipo,
        responsable: nombreResponsable || '—',
        fecha_aprobacion: toMysqlDate(fa),
        fecha_vencimiento: toMysqlDate(fv),
        fecha_contacto_empresa: toMysqlDate(fechaContacto),
        estatus: nuevoEstatus,
        municipio,
        estado,
        sheet_file_id: sheetFileId,
        sheet_row: sheetRow,
        sync_sheets: syncSheets && sheetRow != null,
        actualizado: false
    };
}

async function listarResolutivosEmpresa(poolSgc, empresaId) {
    await asegurarTablaPcControlResolutivos(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, documento_asignacion_pc_id, nombre_asignacion,
                tipo_tramite, responsable, estatus, fecha_aprobacion, fecha_vencimiento,
                fecha_contacto_empresa, municipio, estado, sheet_row, created_at
         FROM pc_control_resolutivos
         WHERE empresa_id_biznaga = ? AND activo = 1
         ORDER BY item ASC`,
        [empresaId]
    );
    return rows;
}

const ESTATUS_RESOLUTIVO_ORDEN = ['Vigentes', 'Próximo a vencer', 'Vencido', 'En tramite'];

function normalizarEstatusOperativo(valor = '') {
    const v = String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
    if (v === 'vigentes') return 'Vigentes';
    if (v.includes('proximo') && v.includes('vencer')) return 'Próximo a vencer';
    if (v === 'vencido') return 'Vencido';
    if (v.includes('tramite')) return 'En tramite';
    return 'En tramite';
}

function obtenerFechaReferenciaResolutivo(row) {
    const candidatos = [row?.fecha_aprobacion, row?.created_at, row?.updated_at];
    for (const candidato of candidatos) {
        const fecha = parseFechaInput(candidato);
        if (fecha) return fecha;
    }
    return null;
}

async function obtenerEstadisticasResolutivosPipc(poolSgc, poolPC = null, poolBiznaga = null, anio = null) {
    const anioNum = Number(anio) || new Date().getFullYear();
    const registros = await obtenerDatosControlResolutivos(poolSgc, poolPC, poolBiznaga);

    const distribucionMap = new Map(
        ESTATUS_RESOLUTIVO_ORDEN.map((estatus) => [estatus, 0])
    );
    const porMesMap = new Map(
        Array.from({ length: 12 }, (_, idx) => [idx + 1, new Map(ESTATUS_RESOLUTIVO_ORDEN.map((e) => [e, 0]))])
    );

    let totalAnio = 0;

    for (const row of registros) {
        const estatus = normalizarEstatusOperativo(row.estatus);
        distribucionMap.set(estatus, (distribucionMap.get(estatus) || 0) + 1);

        const fechaRef = obtenerFechaReferenciaResolutivo(row);
        if (!fechaRef || fechaRef.getFullYear() !== anioNum) continue;

        const mes = fechaRef.getMonth() + 1;
        const mesMap = porMesMap.get(mes);
        if (!mesMap) continue;
        mesMap.set(estatus, (mesMap.get(estatus) || 0) + 1);
        totalAnio++;
    }

    const mesActual = new Date().getMonth() + 1;
    const mesesVisibles = anioNum === new Date().getFullYear()
        ? mesActual
        : 12;
    const mesesLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const porMes = [];
    for (let mes = 1; mes <= mesesVisibles; mes++) {
        const mesMap = porMesMap.get(mes) || new Map();
        const totalMes = ESTATUS_RESOLUTIVO_ORDEN.reduce((acc, estatus) => acc + (mesMap.get(estatus) || 0), 0);
        porMes.push({
            mes,
            mes_label: mesesLabels[mes - 1],
            total: totalMes,
            por_estatus: ESTATUS_RESOLUTIVO_ORDEN.map((estatus) => ({
                estatus,
                total: mesMap.get(estatus) || 0
            }))
        });
    }

    const totalesMensuales = porMes.map((item) => item.total);
    const totalAcumulado = totalesMensuales.reduce((acc, v) => acc + v, 0);
    const mesesConDatos = totalesMensuales.filter((v) => v > 0).length || 1;
    const promedioMensual = +(totalAcumulado / mesesConDatos).toFixed(1);

    const ultimoIndice = totalesMensuales.length - 1;
    const valorActual = ultimoIndice >= 0 ? totalesMensuales[ultimoIndice] : 0;
    const valorAnterior = ultimoIndice > 0 ? totalesMensuales[ultimoIndice - 1] : 0;
    const variacionMensual = valorAnterior > 0
        ? +(((valorActual - valorAnterior) / valorAnterior) * 100).toFixed(1)
        : (valorActual > 0 ? 100 : 0);

    const distribucion = ESTATUS_RESOLUTIVO_ORDEN.map((estatus) => ({
        estatus,
        total: distribucionMap.get(estatus) || 0
    }));
    const totalGeneral = distribucion.reduce((acc, item) => acc + item.total, 0);

    return {
        anio: anioNum,
        total: totalGeneral,
        total_anio: totalAcumulado,
        promedio_mensual: promedioMensual,
        variacion_mensual: variacionMensual,
        distribucion,
        por_mes: porMes,
        estatus_orden: ESTATUS_RESOLUTIVO_ORDEN
    };
}

async function obtenerFechasCentroOperacionesPorEmpresas(poolPC, empresaIds = []) {
    const mapa = new Map();
    if (!poolPC || !empresaIds.length) return mapa;

    const ids = [...new Set(empresaIds.map((id) => Number(id)).filter((id) => id > 0))];
    if (!ids.length) return mapa;

    const [rows] = await poolPC.query(
        `SELECT empresa_id, fecha_ingreso_tramite, fecha_oficio_observaciones, operacion_id
         FROM pc_centro_operaciones
         WHERE empresa_id IN (?)
         ORDER BY activo DESC, (ciclo_cerrado_at IS NULL) DESC, operacion_id DESC`,
        [ids]
    );

    for (const row of rows) {
        const empresaId = Number(row.empresa_id);
        if (mapa.has(empresaId)) continue;
        mapa.set(empresaId, {
            fecha_ingreso_tramite: row.fecha_ingreso_tramite,
            fecha_oficio_observaciones: row.fecha_oficio_observaciones
        });
    }
    return mapa;
}

async function obtenerDatosControlResolutivos(poolSgc, poolPC = null, poolBiznaga = null) {
    await asegurarTablaPcControlResolutivos(poolSgc);
    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, documento_asignacion_pc_id, empresa_id_biznaga,
                nombre_empresa, nombre_asignacion, tipo_tramite, responsable, responsable_usuario_id, estatus,
                fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                fecha_ingreso_tramite, fecha_oficio_observaciones,
                municipio, estado, created_at, updated_at
         FROM pc_control_resolutivos
         WHERE activo = 1
         ORDER BY item ASC`
    );

    const fechasCentroOps = await obtenerFechasCentroOperacionesPorEmpresas(
        poolPC,
        rows.map((row) => row.empresa_id_biznaga)
    );

    const registros = [];
    for (const row of rows) {
        const incompleta = await verificarAsignacionIncompleta(
            poolPC,
            row.documento_asignacion_pc_id,
            row.empresa_id_biznaga
        );
        const estatus = resolverEstatusRegistro(row, incompleta);
        const responsable = await resolverNombreResponsableUsuario(
            poolBiznaga,
            row.responsable_usuario_id,
            row.responsable
        );
        const fechasOps = fechasCentroOps.get(Number(row.empresa_id_biznaga)) || {};
        registros.push({
            ...row,
            estatus,
            responsable,
            // Preferir fechas propias del registro; fallback a centro de operaciones
            fecha_ingreso_tramite: row.fecha_ingreso_tramite || fechasOps.fecha_ingreso_tramite || null,
            fecha_oficio_observaciones: row.fecha_oficio_observaciones || fechasOps.fecha_oficio_observaciones || null
        });
    }
    return registros;
}

function mapearRegistroControlResolutivos(item) {
    return {
        item: item.item,
        resolutivo_id: item.resolutivo_id,
        empresa_id: item.empresa_id_biznaga,
        nombre_empresa: item.nombre_empresa || '',
        nombre_asignacion: item.nombre_asignacion || '',
        tipo_tramite: item.tipo_tramite || '',
        responsable: item.responsable || '',
        fecha_ingreso_tramite: formatearFechaMx(item.fecha_ingreso_tramite),
        fecha_oficio_observaciones: formatearFechaMx(item.fecha_oficio_observaciones),
        fecha_aprobacion: formatearFechaMx(item.fecha_aprobacion),
        fecha_vencimiento: formatearFechaMx(item.fecha_vencimiento),
        fecha_contacto_empresa: formatearFechaMx(item.fecha_contacto_empresa),
        municipio: item.municipio || '',
        estado: item.estado || '',
        estatus: item.estatus || '',
        fecha_ingreso_tramite_iso: toMysqlDate(item.fecha_ingreso_tramite),
        fecha_oficio_observaciones_iso: toMysqlDate(item.fecha_oficio_observaciones),
        fecha_aprobacion_iso: toMysqlDate(item.fecha_aprobacion),
        fecha_vencimiento_iso: toMysqlDate(item.fecha_vencimiento),
        fecha_contacto_empresa_iso: toMysqlDate(item.fecha_contacto_empresa)
    };
}

async function actualizarRegistroControlResolutivo(poolSgc, resolutivoId, payload = {}) {
    await asegurarTablaPcControlResolutivos(poolSgc);

    const id = Number(resolutivoId);
    if (!Number.isFinite(id) || id <= 0) {
        const err = new Error('resolutivo_id inválido');
        err.statusCode = 400;
        throw err;
    }

    const [existentes] = await poolSgc.query(
        `SELECT resolutivo_id, empresa_id_biznaga, fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                fecha_ingreso_tramite, fecha_oficio_observaciones,
                nombre_empresa, nombre_asignacion, tipo_tramite, responsable, responsable_usuario_id,
                municipio, estado, activo
         FROM pc_control_resolutivos
         WHERE resolutivo_id = ?
         LIMIT 1`,
        [id]
    );
    if (!existentes.length || !existentes[0].activo) {
        const err = new Error('Registro de resolutivo no encontrado');
        err.statusCode = 404;
        throw err;
    }

    const actual = existentes[0];
    const nombreEmpresa = String(payload.nombre_empresa ?? actual.nombre_empresa ?? '').trim();
    if (!nombreEmpresa) {
        const err = new Error('El nombre de la empresa es obligatorio');
        err.statusCode = 400;
        throw err;
    }

    let empresaId = actual.empresa_id_biznaga;
    if (payload.empresa_id !== undefined || payload.empresa_id_biznaga !== undefined) {
        const rawEmpresa = payload.empresa_id !== undefined ? payload.empresa_id : payload.empresa_id_biznaga;
        const n = Number(rawEmpresa);
        empresaId = Number.isFinite(n) && n > 0 ? n : 0;
    }

    const responsable = String(payload.responsable ?? actual.responsable ?? '').trim() || '—';
    let responsableUsuarioId = actual.responsable_usuario_id;
    if (payload.responsable_usuario_id !== undefined) {
        const n = Number(payload.responsable_usuario_id);
        responsableUsuarioId = Number.isFinite(n) && n > 0 ? n : null;
    }

    const tipoTramiteRaw = payload.tipo_tramite !== undefined ? payload.tipo_tramite : actual.tipo_tramite;
    const tipoTramite = tipoTramiteRaw == null || String(tipoTramiteRaw).trim() === ''
        ? null
        : String(tipoTramiteRaw).trim();

    const fechaAprobacion = payload.fecha_aprobacion !== undefined
        ? toMysqlDate(payload.fecha_aprobacion)
        : toMysqlDate(actual.fecha_aprobacion);
    let fechaVencimiento = payload.fecha_vencimiento !== undefined
        ? toMysqlDate(payload.fecha_vencimiento)
        : toMysqlDate(actual.fecha_vencimiento);

    if (fechaAprobacion && !fechaVencimiento) {
        const fv = calcularFechaVencimientoDesdeAprobacion(fechaAprobacion);
        fechaVencimiento = fv ? toMysqlDate(fv) : null;
    }

    // Contacto siempre 40 días antes del vencimiento (no editable)
    const fechaContacto = fechaVencimiento
        ? toMysqlDate(calcularFechaContacto(fechaVencimiento))
        : null;

    const fechaIngreso = payload.fecha_ingreso_tramite !== undefined
        ? toMysqlDate(payload.fecha_ingreso_tramite)
        : toMysqlDate(actual.fecha_ingreso_tramite);
    const fechaOficio = payload.fecha_oficio_observaciones !== undefined
        ? toMysqlDate(payload.fecha_oficio_observaciones)
        : toMysqlDate(actual.fecha_oficio_observaciones);

    if (fechaAprobacion && fechaVencimiento) {
        const fa = parseFechaInput(fechaAprobacion);
        const fv = parseFechaInput(fechaVencimiento);
        if (fa && fv && fv.getTime() < fa.getTime()) {
            const err = new Error('La fecha de vencimiento no puede ser anterior a la de aprobación');
            err.statusCode = 400;
            throw err;
        }
    }

    const estatus = calcularEstatusResolutivo({
        fechaAprobacion,
        fechaContactoEmpresa: fechaContacto,
        asignacionIncompleta: false
    });

    const municipio = payload.municipio !== undefined
        ? (String(payload.municipio || '').trim() || null)
        : actual.municipio;
    const estado = payload.estado !== undefined
        ? (String(payload.estado || '').trim() || null)
        : actual.estado;

    await poolSgc.query(
        `UPDATE pc_control_resolutivos SET
            empresa_id_biznaga = ?,
            nombre_empresa = ?,
            tipo_tramite = ?,
            responsable = ?,
            responsable_usuario_id = ?,
            estatus = ?,
            fecha_aprobacion = ?,
            fecha_vencimiento = ?,
            fecha_contacto_empresa = ?,
            fecha_ingreso_tramite = ?,
            fecha_oficio_observaciones = ?,
            municipio = ?,
            estado = ?,
            updated_at = NOW()
         WHERE resolutivo_id = ?`,
        [
            empresaId || 0,
            nombreEmpresa,
            tipoTramite,
            responsable,
            responsableUsuarioId,
            estatus,
            fechaAprobacion,
            fechaVencimiento,
            fechaContacto,
            fechaIngreso,
            fechaOficio,
            municipio,
            estado,
            id
        ]
    );

    const [rows] = await poolSgc.query(
        `SELECT resolutivo_id, item, documento_asignacion_pc_id, empresa_id_biznaga,
                nombre_empresa, nombre_asignacion, tipo_tramite, responsable, estatus,
                fecha_aprobacion, fecha_vencimiento, fecha_contacto_empresa,
                fecha_ingreso_tramite, fecha_oficio_observaciones,
                municipio, estado
         FROM pc_control_resolutivos
         WHERE resolutivo_id = ?
         LIMIT 1`,
        [id]
    );

    return {
        ...mapearRegistroControlResolutivos(rows[0]),
        estatus: calcularEstatusResolutivo({
            fechaAprobacion: rows[0].fecha_aprobacion,
            fechaContactoEmpresa: rows[0].fecha_contacto_empresa
        })
    };
}

async function desactivarRegistroControlResolutivo(poolSgc, resolutivoId) {
    await asegurarTablaPcControlResolutivos(poolSgc);

    const id = Number(resolutivoId);
    if (!Number.isFinite(id) || id <= 0) {
        const err = new Error('resolutivo_id inválido');
        err.statusCode = 400;
        throw err;
    }

    const [existentes] = await poolSgc.query(
        `SELECT resolutivo_id, activo, nombre_empresa
         FROM pc_control_resolutivos
         WHERE resolutivo_id = ?
         LIMIT 1`,
        [id]
    );
    if (!existentes.length) {
        const err = new Error('Registro de resolutivo no encontrado');
        err.statusCode = 404;
        throw err;
    }
    if (!existentes[0].activo) {
        return {
            resolutivo_id: id,
            ya_inactivo: true,
            nombre_empresa: existentes[0].nombre_empresa || ''
        };
    }

    await poolSgc.query(
        `UPDATE pc_control_resolutivos
         SET activo = 0, updated_at = NOW()
         WHERE resolutivo_id = ?`,
        [id]
    );

    return {
        resolutivo_id: id,
        ya_inactivo: false,
        nombre_empresa: existentes[0].nombre_empresa || ''
    };
}

async function listarRegistrosControlResolutivos(poolSgc, poolPC = null, poolBiznaga = null) {
    const registros = await obtenerDatosControlResolutivos(poolSgc, poolPC, poolBiznaga);
    return registros.map((row) => mapearRegistroControlResolutivos(row));
}

async function generarControlResolutivosExcel(poolSgc, poolPC = null, poolBiznaga = null) {
    const ExcelJS = require('exceljs');
    const registros = await obtenerDatosControlResolutivos(poolSgc, poolPC, poolBiznaga);

    if (!registros.length) {
        const err = new Error('No hay resolutivos registrados para generar el control SP-F-29.');
        err.statusCode = 404;
        throw err;
    }

    const templateBuffer = await driveService.exportarArchivoXLSX(PC_SPF29_SHEET_ID);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);

    if (!workbook.worksheets.length) {
        const err = new Error('La plantilla SP-F-29 no contiene hojas.');
        err.statusCode = 500;
        throw err;
    }

    const worksheet = workbook.worksheets.find((ws) => ws.name === PC_SPF29_SHEET_NAME)
        || workbook.worksheets[0];

    workbook.creator = 'Biznaga R&T';
    workbook.created = new Date();

    const estiloFilaBase = extraerEstiloFilaDatosBase(worksheet);
    poblarHojaControlResolutivos(worksheet, registros, estiloFilaBase);
    eliminarHojaDisenos(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    return {
        buffer: Buffer.from(buffer),
        nombreArchivo: buildNombreControlResolutivos('xlsx'),
        totalRegistros: registros.length
    };
}

async function generarControlResolutivosPdf(poolSgc, poolPC = null, poolBiznaga = null) {
    const excel = await generarControlResolutivosExcel(poolSgc, poolPC, poolBiznaga);
    const tempFolderId = await driveService.obtenerOCrearCarpeta('Reportes_Temporales');

    let tempDriveFileId = null;
    try {
        const upload = await driveService.subirExcelComoGoogleSheet(
            excel.buffer,
            `tmp_${Date.now()}_${excel.nombreArchivo}`,
            tempFolderId,
            {
                keepSingleSheet: true,
                sheetTitle: PC_SPF29_SHEET_NAME,
                maxColumns: PC_SPF29_TOTAL_COLS
            }
        );
        tempDriveFileId = upload.id;

        const pdfBuffer = await driveService.exportarArchivoPDF(tempDriveFileId, { landscape: true });
        return {
            buffer: pdfBuffer,
            nombreArchivo: buildNombreControlResolutivos('pdf'),
            totalRegistros: excel.totalRegistros
        };
    } finally {
        if (tempDriveFileId) {
            try {
                await driveService.eliminarArchivo(tempDriveFileId);
            } catch (cleanupError) {
                console.warn('[PC Resolutivos] No se pudo eliminar archivo temporal PDF:', cleanupError.message);
            }
        }
    }
}

async function obtenerEstadoControlResolutivosExcelDrive() {
    const archivos = await driveService.listarArchivosCarpeta(PC_SPF29_DRIVE_FOLDER_ID);
    const nombreObjetivo = normalizarTextoControl(NOMBRE_ARCHIVO_CONTROL_RESOLUTIVOS.replace('.xlsx', ''));

    const candidatos = (archivos || [])
        .filter((f) => {
            const nameNorm = normalizarTextoControl(String(f.name || ''));
            return nameNorm.includes('sp-f-29') && nameNorm.includes('resolutivos') && nameNorm.endsWith('.xlsx');
        })
        .sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());

    const ultimo = candidatos[0] || null;
    return {
        existe: !!ultimo,
        archivo: ultimo,
        candidatos,
        carpeta: {
            folderId: PC_SPF29_DRIVE_FOLDER_ID,
            path: 'ControlResolutivosPIPC'
        },
        nombreObjetivo
    };
}

async function guardarControlResolutivosExcelEnDrive(poolSgc, poolPC = null, poolBiznaga = null) {
    const estadoPrevio = await obtenerEstadoControlResolutivosExcelDrive();
    const excel = await generarControlResolutivosExcel(poolSgc, poolPC, poolBiznaga);

    if (estadoPrevio.candidatos.length) {
        for (const archivoPrevio of estadoPrevio.candidatos) {
            try {
                await driveService.eliminarArchivo(archivoPrevio.id);
            } catch (e) {
                console.warn('[PC Resolutivos] No se pudo eliminar versión previa:', e.message);
            }
        }
    }

    const archivoSubido = await driveService.subirArchivo(
        excel.buffer,
        NOMBRE_ARCHIVO_CONTROL_RESOLUTIVOS,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        PC_SPF29_DRIVE_FOLDER_ID
    );

    return {
        accion: estadoPrevio.existe ? 'actualizado' : 'generado',
        archivo: archivoSubido,
        carpeta: estadoPrevio.carpeta,
        totalRegistros: excel.totalRegistros
    };
}

async function resolutivoYaCompletado(poolSgc, empresaId, documentoAsignacionId) {
    const row = await obtenerResolutivoAsignacion(poolSgc, empresaId, documentoAsignacionId);
    return !!row && !esResolutivoPlaceholder(row);
}

module.exports = {
    TIPOS_TRAMITE_VALIDOS,
    SLOTS_RESOLUTIVO_CENTRO_OPS,
    CAMPOS_FECHA_RESOLUTIVO_OPS,
    slotResolutivoCompleto,
    PC_SPF29_SHEET_ID,
    PC_SPF29_SHEET_NAME,
    PC_SPF29_DATA_START_ROW,
    PC_SPF29_DRIVE_FOLDER_ID,
    NOMBRE_ARCHIVO_CONTROL_RESOLUTIVOS,
    asegurarTablaPcControlResolutivos,
    existeResolutivoAsignacion,
    normalizarNombreAsignacion,
    obtenerResolutivoEnTramitePorNombre,
    crearResolutivoEnTramite,
    sincronizarResolutivosCentroOperaciones,
    registrarResolutivoPipc,
    listarResolutivosEmpresa,
    obtenerDatosControlResolutivos,
    mapearRegistroControlResolutivos,
    listarRegistrosControlResolutivos,
    actualizarRegistroControlResolutivo,
    desactivarRegistroControlResolutivo,
    obtenerFechasCentroOperacionesPorEmpresas,
    obtenerEstadisticasResolutivosPipc,
    normalizarEstatusOperativo,
    ESTATUS_RESOLUTIVO_ORDEN,
    generarControlResolutivosExcel,
    generarControlResolutivosPdf,
    obtenerEstadoControlResolutivosExcelDrive,
    guardarControlResolutivosExcelEnDrive,
    formatearFechaMx,
    calcularFechaContacto,
    calcularEstatusResolutivo,
    verificarAsignacionIncompleta,
    resolutivoYaCompletado,
    formatearNombreResponsable,
    limpiarTitulosNombre,
    resolverNombreResponsableUsuario
};
