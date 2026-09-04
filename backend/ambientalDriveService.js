/**
 * Sync SP-F-15 / SP-F-28 con Google Sheets (editor integrado).
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const ambientalService = require('./ambientalService');

const SP_F15_SHEET_ID = process.env.AMBIENTAL_SPF15_SHEET_ID || '1BlpayhRhTni6v37zzzJyrwM6DC0HHvlXANYCvKubZ9s';
const SP_F28_SHEET_ID = process.env.AMBIENTAL_SPF28_SHEET_ID || '1UrD9_T6kIA1rz_IMIwlJ6auimKA0xjstTFMa8cKz4dM';
/** Fila 5 = encabezados; datos desde fila 6 (A=número, B=empresa, C=motivo) */
const SP_F15_DATA_ROW = Number(process.env.AMBIENTAL_SPF15_DATA_ROW || 6);
const SP_F15_SHEET_TAB = process.env.AMBIENTAL_SPF15_SHEET_TAB || 'NÚMERO DE OFICIOS';
const SP_F15_FONT_TABLA = 'Century Gothic';
const SP_F15_FILA_ALTURA_PX = 24;
const SP_F28_DATA_ROW = Number(process.env.AMBIENTAL_SPF28_DATA_ROW || 9);
/** A=libre, B=ítem, C=oficio, D=actividades, E=resp, F=fecha, G=estatus, H=obs */
const SP_F28_COL_COUNT = 8;
/** Valores en rangos fusionados D-F; año/revisión en H5/H6 */
const SP_F28_META = { empresa: 'D5:F5', consultor: 'D6:F6', anio: 'H5', ultimaRev: 'H6' };
const SP_F28_SHEET_TAB = process.env.AMBIENTAL_SPF28_SHEET_TAB || 'Control';
const MAX_FILAS_SYNC = 500;

function hexToColor(hex) {
    const h = String(hex).replace('#', '');
    return {
        red: parseInt(h.slice(0, 2), 16) / 255,
        green: parseInt(h.slice(2, 4), 16) / 255,
        blue: parseInt(h.slice(4, 6), 16) / 255
    };
}

const COLOR_ESTATUS_ABIERTO_BG = hexToColor('#ffc7ce');
const COLOR_ESTATUS_ABIERTO_TX = hexToColor('#9c0006');
const COLOR_ESTATUS_CERRADO_BG = hexToColor('#c6efce');
const COLOR_ESTATUS_CERRADO_TX = hexToColor('#006100');

function sheetsApi() {
    return google.sheets({ version: 'v4', auth: driveService.getAuthClient() });
}

function editorUrl(spreadsheetId) {
    return spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=sharing`
        : null;
}

function embedUrl(spreadsheetId) {
    return spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=sharing&embedded=true`
        : null;
}

function celdaTexto(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function parseNumero(val) {
    const n = Number(String(val || '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
}

function parseFechaSheet(val) {
    const s = celdaTexto(val);
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        let y = m[3];
        if (y.length === 2) y = `20${y}`;
        const d = m[1].padStart(2, '0');
        const mo = m[2].padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    return null;
}

function formatearFechaSheet(fecha) {
    if (!fecha) return '';
    const s = String(fecha).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

function normalizarEstatus(val) {
    const s = celdaTexto(val).toLowerCase();
    if (s.startsWith('cerr')) return 'cerrado';
    return 'abierto';
}

function normalizarResponsable(val) {
    const s = celdaTexto(val);
    return s.toLowerCase().startsWith('client') ? 'Cliente' : 'Biznaga';
}

async function leerRango(spreadsheetId, range) {
    const api = sheetsApi();
    const res = await api.spreadsheets.values.get({ spreadsheetId, range, majorDimension: 'ROWS' });
    return res.data.values || [];
}

function rangoSpF15(celda) {
    const tab = SP_F15_SHEET_TAB.replace(/'/g, "''");
    return `'${tab}'!${celda}`;
}

async function leerRangoSpF15(celda) {
    return leerRango(SP_F15_SHEET_ID, rangoSpF15(celda));
}

async function escribirRangoSpF15(celda, values) {
    return escribirRango(SP_F15_SHEET_ID, rangoSpF15(celda), values);
}

async function escribirRango(spreadsheetId, range, values) {
    const api = sheetsApi();
    await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
    });
}

async function limpiarFilasOficiosSpF15() {
    const vacias = Array.from({ length: MAX_FILAS_SYNC }, () => ['', '', '']);
    const end = SP_F15_DATA_ROW + MAX_FILAS_SYNC - 1;
    await escribirRangoSpF15(`A${SP_F15_DATA_ROW}:C${end}`, vacias);
}

async function obtenerSheetIdSpF15() {
    const api = sheetsApi();
    const res = await api.spreadsheets.get({ spreadsheetId: SP_F15_SHEET_ID, fields: 'sheets.properties' });
    const sheets = res.data.sheets || [];
    const preferida = sheets.find((s) => s.properties?.title === SP_F15_SHEET_TAB);
    return (preferida || sheets[0])?.properties?.sheetId;
}

async function aplicarFormatoFilasOficiosSpF15(oficios) {
    if (!oficios.length) return;
    const sheetId = await obtenerSheetIdSpF15();
    if (sheetId === undefined || sheetId === null) return;

    const borderSolid = {
        style: 'SOLID',
        width: 1,
        color: { red: 0, green: 0, blue: 0, alpha: 1 }
    };
    const formatoCentro = {
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        textFormat: { fontFamily: SP_F15_FONT_TABLA }
    };
    const formatoMotivoIzq = {
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
        textFormat: { fontFamily: SP_F15_FONT_TABLA }
    };

    const requests = [];

    oficios.forEach((_o, i) => {
        const rowIndex = SP_F15_DATA_ROW - 1 + i;

        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                },
                properties: { pixelSize: SP_F15_FILA_ALTURA_PX },
                fields: 'pixelSize'
            }
        });

        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 2
                },
                cell: { userEnteredFormat: formatoCentro },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)'
            }
        });

        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 2,
                    endColumnIndex: 3
                },
                cell: { userEnteredFormat: formatoMotivoIzq },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)'
            }
        });

        if (i >= 1) {
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 3
                    },
                    top: borderSolid,
                    bottom: borderSolid,
                    left: borderSolid,
                    right: borderSolid,
                    innerVertical: borderSolid,
                    innerHorizontal: borderSolid
                }
            });
        }
    });

    if (requests.length) {
        await sheetsApi().spreadsheets.batchUpdate({
            spreadsheetId: SP_F15_SHEET_ID,
            requestBody: { requests }
        });
    }
}

async function limpiarFilasTramitesSpF28(spreadsheetId) {
    const vacias = Array.from({ length: MAX_FILAS_SYNC }, () => Array(7).fill(''));
    const end = SP_F28_DATA_ROW + MAX_FILAS_SYNC - 1;
    await escribirRango(spreadsheetId, `B${SP_F28_DATA_ROW}:H${end}`, vacias);
}

function tituloTabIgual(a, b) {
    return String(a || '').trim() === String(b || '').trim();
}

/**
 * La plantilla "Control" trae B10:F10 fusionado y filas 10–187 ocultas.
 * Sin desfusionar, el 2.º trámite pierde columnas; sin desocultar, no se ven.
 */
async function prepararBloqueDatosSpF28(spreadsheetId, sheetId, numFilas = MAX_FILAS_SYNC) {
    if (sheetId === undefined || sheetId === null) return;
    const filas = Math.max(2, Number(numFilas) || MAX_FILAS_SYNC);
    const startRow = SP_F28_DATA_ROW - 1; // 0-based (fila 9)
    const endRow = startRow + filas;

    try {
        await sheetsApi().spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    unmergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: startRow,
                            endRowIndex: endRow,
                            startColumnIndex: 1,
                            endColumnIndex: 8
                        }
                    }
                }]
            }
        });
    } catch (_) { /* sin fusiones en el bloque */ }

    try {
        await sheetsApi().spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    updateDimensionProperties: {
                        range: {
                            sheetId,
                            dimension: 'ROWS',
                            startIndex: startRow,
                            endIndex: endRow
                        },
                        properties: { hiddenByUser: false },
                        fields: 'hiddenByUser'
                    }
                }]
            }
        });
    } catch (_) { /* filas ya visibles */ }
}

/** @deprecated usar prepararBloqueDatosSpF28 */
async function desfusionarBloqueDatosSpF28(spreadsheetId, sheetId, numFilas = MAX_FILAS_SYNC) {
    return prepararBloqueDatosSpF28(spreadsheetId, sheetId, numFilas);
}

async function obtenerSheetIdSpF28(spreadsheetId) {
    const api = sheetsApi();
    const res = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    const sheets = res.data.sheets || [];
    const preferida = sheets.find((s) => tituloTabIgual(s.properties?.title, SP_F28_SHEET_TAB));
    return (preferida || sheets[0])?.properties?.sheetId;
}

const SP_F28_FONT_TABLA = 'Century Gothic';
/** Última fila 1-based de la plantilla con colores de muestra en columna G (filas 10–14). */
const SP_F28_PLANTILLA_COLOR_HASTA_FILA = 14;

/**
 * Quita fondos de Estatus (columna G) solo en filas sin trámites.
 * Conserva el color de las filas que sí tienen datos.
 */
async function limpiarColoresEstatusVaciosSpF28(spreadsheetId, sheetId, numTramites) {
    if (sheetId === undefined || sheetId === null) return;
    const n = Math.max(0, Number(numTramites) || 0);
    const startRow = SP_F28_DATA_ROW - 1 + n; // primera fila vacía (0-based)
    const endRow = Math.max(SP_F28_PLANTILLA_COLOR_HASTA_FILA, startRow + 1); // exclusivo; al menos hasta fila 14
    if (startRow >= endRow) return;

    try {
        await sheetsApi().spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    repeatCell: {
                        range: {
                            sheetId,
                            startRowIndex: startRow,
                            endRowIndex: endRow,
                            startColumnIndex: 6,
                            endColumnIndex: 7
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 1, green: 1, blue: 1 },
                                textFormat: {
                                    fontFamily: SP_F28_FONT_TABLA,
                                    foregroundColor: { red: 0, green: 0, blue: 0 }
                                }
                            }
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat)'
                    }
                }]
            }
        });
    } catch (_) { /* noop */ }
}

async function aplicarFormatoEstatusSpF28(spreadsheetId, tramites, sheetIdOverride) {
    const sheetId = (sheetIdOverride !== undefined && sheetIdOverride !== null)
        ? sheetIdOverride
        : await obtenerSheetIdSpF28(spreadsheetId);
    if (sheetId === undefined || sheetId === null) return;

    const lista = Array.isArray(tramites) ? tramites : [];
    // Primero limpia colores de muestra en filas vacías (plantilla filas 10–14).
    await limpiarColoresEstatusVaciosSpF28(spreadsheetId, sheetId, lista.length);
    if (!lista.length) return;

    const borderSolid = {
        style: 'SOLID',
        width: 1,
        color: { red: 0, green: 0, blue: 0, alpha: 1 }
    };

    const formatoCeldaTabla = {
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        textFormat: { fontFamily: SP_F28_FONT_TABLA }
    };

    const requests = [];

    lista.forEach((t, i) => {
        const rowIndex = SP_F28_DATA_ROW - 1 + i;
        const esAbierto = t.estatus !== 'cerrado';

        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 1,
                    endColumnIndex: 8
                },
                cell: { userEnteredFormat: formatoCeldaTabla },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)'
            }
        });

        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 6,
                    endColumnIndex: 7
                },
                cell: {
                    userEnteredFormat: {
                        ...formatoCeldaTabla,
                        backgroundColor: esAbierto ? COLOR_ESTATUS_ABIERTO_BG : COLOR_ESTATUS_CERRADO_BG,
                        textFormat: {
                            fontFamily: SP_F28_FONT_TABLA,
                            foregroundColor: esAbierto ? COLOR_ESTATUS_ABIERTO_TX : COLOR_ESTATUS_CERRADO_TX
                        }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)'
            }
        });

        // Filas adicionales (2.º trámite en adelante): altura 61 px y bordes B–H
        if (i >= 1) {
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1
                    },
                    properties: { pixelSize: 61 },
                    fields: 'pixelSize'
                }
            });
            requests.push({
                updateBorders: {
                    range: {
                        sheetId,
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex + 1,
                        startColumnIndex: 1,
                        endColumnIndex: 8
                    },
                    top: borderSolid,
                    bottom: borderSolid,
                    left: borderSolid,
                    right: borderSolid,
                    innerVertical: borderSolid,
                    innerHorizontal: borderSolid
                }
            });
        }
    });

    await sheetsApi().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });
}

/** A=libre, B=ítem, C=oficio, D=actividades, E=resp, F=fecha, G=estatus, H=obs */
function filaTramiteParaSheet(t) {
    return [
        '',
        t.item,
        t.oficio || '',
        t.accion_realizar || '',
        t.responsable || 'Biznaga',
        formatearFechaSheet(t.fecha_vencimiento),
        t.estatus === 'cerrado' ? 'Cerrado' : 'Abierto',
        t.observaciones || ''
    ];
}

function filaTramiteDesdeSheet(row) {
    return {
        item: parseNumero(row?.[1]),
        oficio: celdaTexto(row?.[2]),
        accion_realizar: celdaTexto(row?.[3]),
        responsable: normalizarResponsable(row?.[4]),
        fecha_vencimiento: parseFechaSheet(row?.[5]),
        estatus: normalizarEstatus(row?.[6]),
        observaciones: celdaTexto(row?.[7])
    };
}

async function estadoFormato(spreadsheetId) {
    let modifiedTime = null;
    try {
        const info = await driveService.obtenerInfoArchivo(spreadsheetId);
        modifiedTime = info?.modifiedTime || null;
    } catch (_) { /* noop */ }
    return {
        driveFileId: spreadsheetId,
        editorUrl: editorUrl(spreadsheetId),
        embedUrl: embedUrl(spreadsheetId),
        previewUrl: spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/preview` : null,
        ultimaSyncDrive: modifiedTime
    };
}

// ============================================================
// SP-F-28 POR EMPRESA — una pestaña/hoja por empresa registrada
// ============================================================

function escaparTituloTab(title) {
    return String(title).replace(/'/g, "''");
}

function rangoTab(title, celda) {
    return `'${escaparTituloTab(title)}'!${celda}`;
}

/** Nombres de pestaña en Google Sheets: sin []*?/\: y máx. 90 chars. */
function sanitizarTituloTab(nombre, empresaId) {
    let t = String(nombre || '')
        .replace(/[\[\]\*\?\/\\:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t) t = `Empresa ${empresaId}`;
    if (t.length > 90) t = t.slice(0, 90).trim();
    return t;
}

async function obtenerSheetsSpF28() {
    const api = sheetsApi();
    const res = await api.spreadsheets.get({ spreadsheetId: SP_F28_SHEET_ID, fields: 'sheets.properties' });
    return res.data.sheets || [];
}

/**
 * Asegura que exista una pestaña para la empresa (duplicando la plantilla "Control").
 * Devuelve { title, gid } y lo persiste en ambiental_spf28_empresa.
 */
async function asegurarTabEmpresa(pool, empresaId, nombreEmpresa) {
    const api = sheetsApi();
    const sheets = await obtenerSheetsSpF28();

    const stored = await ambientalService.obtenerDriveTabEmpresa(pool, empresaId);
    if (stored?.gid != null) {
        const byGid = sheets.find((s) => String(s.properties?.sheetId) === String(stored.gid));
        if (byGid) {
            return { title: byGid.properties.title, gid: byGid.properties.sheetId };
        }
    }

    const title = sanitizarTituloTab(nombreEmpresa, empresaId);
    let found = sheets.find((s) => tituloTabIgual(s.properties?.title, title));
    let recienDuplicada = false;

    if (!found) {
        const template = sheets.find((s) => tituloTabIgual(s.properties?.title, SP_F28_SHEET_TAB)) || sheets[0];
        // Reparar plantilla antes de clonar (evita heredar B10:F10 fusionado).
        if (template?.properties?.sheetId != null) {
            await desfusionarBloqueDatosSpF28(SP_F28_SHEET_ID, template.properties.sheetId, 180);
            // Quitar colores de muestra G10–G14 en la plantilla (conserva fila 9).
            await limpiarColoresEstatusVaciosSpF28(SP_F28_SHEET_ID, template.properties.sheetId, 1);
        }
        const dup = await api.spreadsheets.batchUpdate({
            spreadsheetId: SP_F28_SHEET_ID,
            requestBody: {
                requests: [{
                    duplicateSheet: {
                        sourceSheetId: template.properties.sheetId,
                        newSheetName: title,
                        insertSheetIndex: sheets.length
                    }
                }]
            }
        });
        const props = dup.data.replies?.[0]?.duplicateSheet?.properties;
        found = { properties: props };
        recienDuplicada = true;
    }

    const gid = found.properties.sheetId;
    if (recienDuplicada) {
        await desfusionarBloqueDatosSpF28(SP_F28_SHEET_ID, gid, 180);
    }
    await ambientalService.guardarDriveTabEmpresa(pool, empresaId, found.properties.title || title, gid);
    return { title: found.properties.title || title, gid };
}

function estadoFormatoEmpresa(spreadsheetId, gid) {
    const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return {
        driveFileId: spreadsheetId,
        editorUrl: `${base}/edit?usp=sharing#gid=${gid}`,
        embedUrl: `${base}/edit?usp=sharing&embedded=true#gid=${gid}`,
        previewUrl: `${base}/preview#gid=${gid}`,
        sheetGid: gid
    };
}

async function limpiarFilasTramitesSpF28Tab(title) {
    const vacias = Array.from({ length: MAX_FILAS_SYNC }, () => Array(7).fill(''));
    const end = SP_F28_DATA_ROW + MAX_FILAS_SYNC - 1;
    await escribirRango(SP_F28_SHEET_ID, rangoTab(title, `B${SP_F28_DATA_ROW}:H${end}`), vacias);
}

async function exportarMetaSpF28EmpresaADrive(pool, empresaId, title) {
    const meta = await ambientalService.obtenerMetaSpF28Empresa(pool, empresaId);
    const anio = new Date().getFullYear();
    await escribirRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.empresa), [[meta.nombre_empresa || '']]);
    await escribirRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.consultor), [[meta.nombre_consultor || '']]);
    await escribirRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.anio), [[String(anio)]]);
    await escribirRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.ultimaRev), [[formatearFechaSheet(meta.documento_creado_at)]]);
}

async function exportarTramitesEmpresaADrive(pool, empresaId) {
    const meta = await ambientalService.obtenerMetaSpF28Empresa(pool, empresaId);
    const { title, gid } = await asegurarTabEmpresa(pool, empresaId, meta.nombre_empresa);
    await exportarMetaSpF28EmpresaADrive(pool, empresaId, title);

    const tramites = await ambientalService.listarTramites(pool, { empresa_id: empresaId });
    const filas = tramites.map((t) => filaTramiteParaSheet(t));
    // Quitar fusiones heredadas de la plantilla antes de limpiar/escribir filas.
    await desfusionarBloqueDatosSpF28(SP_F28_SHEET_ID, gid, Math.max(filas.length + 10, 180));
    await limpiarFilasTramitesSpF28Tab(title);
    if (filas.length) {
        const end = SP_F28_DATA_ROW + filas.length - 1;
        await escribirRango(SP_F28_SHEET_ID, rangoTab(title, `A${SP_F28_DATA_ROW}:H${end}`), filas);
        await aplicarFormatoEstatusSpF28(SP_F28_SHEET_ID, tramites, gid);
    } else {
        // Sin trámites: quitar colores de muestra de la plantilla (G10–G14).
        await aplicarFormatoEstatusSpF28(SP_F28_SHEET_ID, [], gid);
    }
    return estadoFormatoEmpresa(SP_F28_SHEET_ID, gid);
}

async function importarTramitesEmpresaDesdeDrive(pool, empresaId) {
    const meta = await ambientalService.obtenerMetaSpF28Empresa(pool, empresaId);
    const { title, gid } = await asegurarTabEmpresa(pool, empresaId, meta.nombre_empresa);

    const [empresaRows, consultorRows] = await Promise.all([
        leerRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.empresa)),
        leerRango(SP_F28_SHEET_ID, rangoTab(title, SP_F28_META.consultor))
    ]);
    await ambientalService.guardarMetaSpF28Empresa(pool, empresaId, {
        nombre_consultor: celdaTexto(consultorRows?.[0]?.[0])
    });
    const empresaNombre = celdaTexto(empresaRows?.[0]?.[0]) || meta.nombre_empresa;

    const end = SP_F28_DATA_ROW + MAX_FILAS_SYNC - 1;
    const rows = await leerRango(SP_F28_SHEET_ID, rangoTab(title, `A${SP_F28_DATA_ROW}:H${end}`));
    let count = 0;
    for (const row of rows) {
        const parsed = filaTramiteDesdeSheet(row);
        if (!parsed.item || parsed.item <= 0) continue;
        await pool.query(
            `INSERT INTO ambiental_control_tramites
                (empresa_id, empresa_nombre, item, oficio, accion_realizar, responsable, fecha_vencimiento, estatus, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                empresa_nombre = VALUES(empresa_nombre),
                oficio = VALUES(oficio),
                accion_realizar = VALUES(accion_realizar),
                responsable = VALUES(responsable),
                fecha_vencimiento = VALUES(fecha_vencimiento),
                estatus = VALUES(estatus),
                observaciones = VALUES(observaciones),
                activo = 1,
                updated_at = NOW()`,
            [
                empresaId,
                empresaNombre,
                parsed.item,
                parsed.oficio,
                parsed.accion_realizar,
                parsed.responsable,
                parsed.fecha_vencimiento,
                parsed.estatus,
                parsed.observaciones
            ]
        );
        count++;
    }
    return { importados: count, ...estadoFormatoEmpresa(SP_F28_SHEET_ID, gid) };
}

async function estadoSpF28Empresa(pool, empresaId, nombreEmpresa) {
    const { gid } = await asegurarTabEmpresa(pool, empresaId, nombreEmpresa);
    return estadoFormatoEmpresa(SP_F28_SHEET_ID, gid);
}

async function guardarSpF28Empresa(pool, empresaId) {
    const estado = await exportarTramitesEmpresaADrive(pool, empresaId);
    await ambientalService.guardarUltimaSyncEmpresa(pool, empresaId, new Date().toISOString());
    return estado;
}

async function sincronizarSpF28Empresa(pool, empresaId) {
    const result = await importarTramitesEmpresaDesdeDrive(pool, empresaId);
    await ambientalService.guardarUltimaSyncEmpresa(pool, empresaId, new Date().toISOString());
    return result;
}

async function exportarOficiosADrive(pool) {
    const oficios = await ambientalService.listarOficios(pool, {});
    const filas = oficios.map((o) => [
        o.numero_oficio,
        o.empresa || '',
        o.motivo || ''
    ]);
    await limpiarFilasOficiosSpF15();
    if (filas.length) {
        const end = SP_F15_DATA_ROW + filas.length - 1;
        await escribirRangoSpF15(`A${SP_F15_DATA_ROW}:C${end}`, filas);
        await aplicarFormatoFilasOficiosSpF15(oficios);
    }
    return estadoFormato(SP_F15_SHEET_ID);
}

async function importarOficiosDesdeDrive(pool) {
    const end = SP_F15_DATA_ROW + MAX_FILAS_SYNC - 1;
    const rows = await leerRangoSpF15(`A${SP_F15_DATA_ROW}:C${end}`);
    let count = 0;
    for (const row of rows) {
        const numero = parseNumero(row?.[0]);
        if (!numero || numero <= 0) continue;
        await pool.query(
            `INSERT INTO ambiental_control_oficios (numero_oficio, empresa, motivo)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                empresa = VALUES(empresa),
                motivo = VALUES(motivo),
                activo = 1,
                updated_at = NOW()`,
            [numero, celdaTexto(row?.[1]), celdaTexto(row?.[2])]
        );
        count++;
    }
    return { importados: count, ...await estadoFormato(SP_F15_SHEET_ID) };
}

async function exportarMetaSpF28ADrive(pool) {
    const meta = await ambientalService.obtenerMetaSpF28(pool);
    const anio = new Date().getFullYear();
    await escribirRango(SP_F28_SHEET_ID, SP_F28_META.empresa, [[meta.nombre_empresa || '']]);
    await escribirRango(SP_F28_SHEET_ID, SP_F28_META.consultor, [[meta.nombre_consultor || '']]);
    await escribirRango(SP_F28_SHEET_ID, SP_F28_META.anio, [[String(anio)]]);
    await escribirRango(SP_F28_SHEET_ID, SP_F28_META.ultimaRev, [[formatearFechaSheet(meta.documento_creado_at)]]);
}

async function importarMetaSpF28DesdeDrive(pool) {
    const [empresaRows, consultorRows] = await Promise.all([
        leerRango(SP_F28_SHEET_ID, SP_F28_META.empresa),
        leerRango(SP_F28_SHEET_ID, SP_F28_META.consultor)
    ]);
    await ambientalService.guardarMetaSpF28(pool, {
        nombre_empresa: celdaTexto(empresaRows?.[0]?.[0]),
        nombre_consultor: celdaTexto(consultorRows?.[0]?.[0])
    });
}

async function exportarTramitesADrive(pool) {
    await exportarMetaSpF28ADrive(pool);
    const tramites = await ambientalService.listarTramites(pool, {});
    const filas = tramites.map((t) => filaTramiteParaSheet(t));
    const sheetId = await obtenerSheetIdSpF28(SP_F28_SHEET_ID);
    await desfusionarBloqueDatosSpF28(SP_F28_SHEET_ID, sheetId, Math.max(filas.length + 10, 180));
    await limpiarFilasTramitesSpF28(SP_F28_SHEET_ID);
    if (filas.length) {
        const end = SP_F28_DATA_ROW + filas.length - 1;
        await escribirRango(SP_F28_SHEET_ID, `A${SP_F28_DATA_ROW}:H${end}`, filas);
        await aplicarFormatoEstatusSpF28(SP_F28_SHEET_ID, tramites);
    } else {
        await aplicarFormatoEstatusSpF28(SP_F28_SHEET_ID, []);
    }
    return estadoFormato(SP_F28_SHEET_ID);
}

async function importarTramitesDesdeDrive(pool) {
    await importarMetaSpF28DesdeDrive(pool);
    const end = SP_F28_DATA_ROW + MAX_FILAS_SYNC - 1;
    const rows = await leerRango(SP_F28_SHEET_ID, `A${SP_F28_DATA_ROW}:H${end}`);
    let count = 0;
    for (const row of rows) {
        const parsed = filaTramiteDesdeSheet(row);
        if (!parsed.item || parsed.item <= 0) continue;
        await pool.query(
            `INSERT INTO ambiental_control_tramites
                (item, oficio, accion_realizar, responsable, fecha_vencimiento, estatus, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                oficio = VALUES(oficio),
                accion_realizar = VALUES(accion_realizar),
                responsable = VALUES(responsable),
                fecha_vencimiento = VALUES(fecha_vencimiento),
                estatus = VALUES(estatus),
                observaciones = VALUES(observaciones),
                activo = 1,
                updated_at = NOW()`,
            [
                parsed.item,
                parsed.oficio,
                parsed.accion_realizar,
                parsed.responsable,
                parsed.fecha_vencimiento,
                parsed.estatus,
                parsed.observaciones
            ]
        );
        count++;
    }
    return { importados: count, ...await estadoFormato(SP_F28_SHEET_ID) };
}

async function guardarSpF15(pool) {
    const estado = await exportarOficiosADrive(pool);
    await ambientalService.guardarMetaAmbiental(pool, 'spf15_ultima_sync', new Date().toISOString());
    return estado;
}

async function sincronizarSpF15(pool) {
    const result = await importarOficiosDesdeDrive(pool);
    await ambientalService.guardarMetaAmbiental(pool, 'spf15_ultima_sync', new Date().toISOString());
    return result;
}

async function guardarSpF28(pool) {
    const estado = await exportarTramitesADrive(pool);
    await ambientalService.guardarMetaAmbiental(pool, 'spf28_ultima_sync', new Date().toISOString());
    return estado;
}

async function sincronizarSpF28(pool) {
    const result = await importarTramitesDesdeDrive(pool);
    await ambientalService.guardarMetaAmbiental(pool, 'spf28_ultima_sync', new Date().toISOString());
    return result;
}

module.exports = {
    SP_F15_SHEET_ID,
    SP_F28_SHEET_ID,
    editorUrl,
    estadoSpF15: (pool) => estadoFormato(SP_F15_SHEET_ID),
    estadoSpF28: (pool) => estadoFormato(SP_F28_SHEET_ID),
    guardarSpF15,
    sincronizarSpF15,
    guardarSpF28,
    sincronizarSpF28,
    estadoSpF28Empresa,
    guardarSpF28Empresa,
    sincronizarSpF28Empresa
};
