/**
 * SP-F-04 · Control de Proyectos Biznaga 2026.
 * Vista generada: cada proyecto activo de Control de Proyectos.
 * Si el folio es AAA-SC-YY-NNN, la cotización ATH-F-09 aporta SC-YY-NNN.
 * No se captura en este formato.
 */
const { google } = require('googleapis');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');
const athF09 = require('./sgcAthF09Service');
const controlProyectos = require('./sgcControlProyectosService');

const CODIGO_FORMATO = 'SP-F-04';
const TEMPLATE_DRIVE_ID = '1efmyxhAYxuN-H0BxGpUlSsYb3uhutWKDYBTHh8SfnMo';
const SHEET_TITLE = 'Plantilla';
const HEADER_ROW = 5;
const DATA_START_ROW = 6;
const MAX_FILAS = 400;
const COL_FIN = 10;

const COLOR_ABIERTO = 'ffc7ce';
const COLOR_ABIERTO_TEXTO = '9c0006';
const COLOR_CERRADO = 'c6efce';
const COLOR_CERRADO_TEXTO = '006100';
const BORDE = { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } };
const SIN_BORDE = { style: 'NONE' };

function normalizarTexto(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function normalizarFolio(folio) {
    return String(folio || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizarClave(clave) {
    return String(clave || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

/** Folio aceptado AAA-SC-YY-NNN → cotización SC-YY-NNN y proyecto AAA. */
function partirFolio(folio, claveEmpresa = '') {
    const completo = normalizarFolio(folio);
    const conClave = completo.match(/^([A-Z0-9]{2,4})-(SC-\d{2}-\d{3})$/);
    if (conClave) {
        return { cotizacion: conClave[2], proyecto: normalizarClave(conClave[1]), completo };
    }
    const base = completo.match(/SC-\d{2}-\d{3}$/);
    const cotizacion = base ? base[0] : completo;
    const proyecto = normalizarClave(claveEmpresa);
    const armado = proyecto && cotizacion ? `${proyecto}-${cotizacion}` : completo;
    return { cotizacion, proyecto, completo: armado || completo };
}

function parseResponsables(valor) {
    const s = String(valor || '').trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map((x) => String(x || '').trim()).filter(Boolean);
            }
        } catch (_error) {
            /* texto plano */
        }
    }
    return s.split(/\s*\|\s*|\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
}

function unirUnicos(lista, separador) {
    const vistos = new Set();
    const salida = [];
    for (const item of lista) {
        const texto = String(item || '').trim();
        if (!texto) continue;
        const clave = normalizarTexto(texto);
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        salida.push(texto);
    }
    return salida.join(separador);
}

function avanceActividad(actividad) {
    const n = normalizarTexto(actividad?.estatus);
    if (n === 'concluido') return 100;
    if (n === 'en revision') return 75;
    if (n === 'en proceso') return 50;
    return 0;
}

function avanceProyecto(actividades) {
    if (!actividades.length) return 0;
    const suma = actividades.reduce((acc, actividad) => acc + avanceActividad(actividad), 0);
    return Math.round(suma / actividades.length);
}

function esFolioCotizacion(partes) {
    return /^SC-\d{2}-\d{3}$/.test(partes.cotizacion) && Boolean(partes.proyecto);
}

function cotizacionDeFolio(folio, indice) {
    const partes = partirFolio(folio);
    return indice.get(normalizarFolio(folio))
        || indice.get(partes.completo)
        || indice.get(partes.cotizacion)
        || null;
}

function filaDesdeProyecto(actividades, numero, cotizacion) {
    const base = actividades[0] || {};
    const folio = String(cotizacion?.folio || base.folio || '').trim();
    const partes = partirFolio(folio, cotizacion?.claveEmpresa || '');
    const conFormato = esFolioCotizacion(partes);
    const nombre = actividades.map((a) => a.nombreProyecto).find((n) => String(n || '').trim()) || '';
    const responsables = unirUnicos(
        actividades.flatMap((a) => parseResponsables(a.responsable)),
        ' / '
    );
    const observaciones = unirUnicos(
        actividades.map((a) => a.observaciones),
        '\n'
    );
    const avance = avanceProyecto(actividades);
    const fechas = actividades.map((a) => String(a.createdAt || '')).filter(Boolean).sort();
    return {
        numero,
        numeroCotizacion: conFormato ? partes.cotizacion : '',
        numeroProyecto: conFormato ? partes.proyecto : (normalizarFolio(base.folio) || partes.proyecto),
        empresa: String(cotizacion?.empresa || base.empresaNombre || '').trim(),
        nombreProyecto: String(nombre || '').trim(),
        responsable: responsables,
        observaciones,
        estatus: avance >= 100 ? 'Cerrado' : 'Abierto',
        avance,
        folio: partes.completo || normalizarFolio(base.folio) || partes.cotizacion,
        fechaCreacion: fechas[0] || String(cotizacion?.fechaCreacion || '').trim()
    };
}

function armarFilas(cotizaciones, actividades) {
    const cotPorClave = new Map();
    for (const cotizacion of cotizaciones || []) {
        const partes = partirFolio(cotizacion.folio, cotizacion.claveEmpresa);
        for (const clave of [normalizarFolio(cotizacion.folio), partes.completo, partes.cotizacion]) {
            if (clave && !cotPorClave.has(clave)) cotPorClave.set(clave, cotizacion);
        }
    }
    const grupos = new Map();
    for (const actividad of actividades || []) {
        if (actividad?.activo === false) continue;
        const folio = normalizarFolio(actividad.folio);
        const nombre = normalizarTexto(actividad.nombreProyecto);
        const clave = [
            normalizarTexto(actividad.empresaNombre),
            folio || nombre || `id-${actividad.id || ''}`
        ].join('|');
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(actividad);
    }
    const ordenados = Array.from(grupos.values()).sort((a, b) => {
        const fa = a.map((x) => String(x.createdAt || '')).filter(Boolean).sort()[0] || '';
        const fb = b.map((x) => String(x.createdAt || '')).filter(Boolean).sort()[0] || '';
        if (fa !== fb) return fa < fb ? -1 : 1;
        return normalizarFolio(a[0]?.folio).localeCompare(normalizarFolio(b[0]?.folio));
    });
    return ordenados.slice(0, MAX_FILAS).map((lista, index) => (
        filaDesdeProyecto(lista, index + 1, cotizacionDeFolio(lista[0]?.folio, cotPorClave))
    ));
}

function firmaFilas(filas) {
    return JSON.stringify((filas || []).map((f) => ({
        numeroCotizacion: f.numeroCotizacion,
        numeroProyecto: f.numeroProyecto,
        empresa: f.empresa,
        nombreProyecto: f.nombreProyecto,
        responsable: f.responsable,
        observaciones: f.observaciones,
        estatus: f.estatus,
        avance: f.avance,
        folio: f.folio
    })));
}

function hexRgb(hex) {
    const h = String(hex || '').replace('#', '');
    return {
        red: parseInt(h.slice(0, 2), 16) / 255,
        green: parseInt(h.slice(2, 4), 16) / 255,
        blue: parseInt(h.slice(4, 6), 16) / 255
    };
}

async function construirRespuesta(datos, driveFileId, registro, aviso) {
    const id = String(driveFileId || '').trim();
    let gid = null;
    if (id) {
        const hoja = await resolverHoja(id).catch(() => null);
        gid = hoja?.sheetId ?? null;
    }
    return {
        codigo: CODIGO_FORMATO,
        datos,
        driveFileId: id || null,
        editorUrl: id ? driveService.construirUrlEditorGoogleSheet(id, { gid }) : null,
        previewUrl: id ? driveService.construirUrlEditorGoogleSheet(id, { modo: 'preview', gid }) : null,
        ultimaSyncDrive: registro?.ultima_sync_drive || null,
        contenidoModificado: false,
        soloLectura: true,
        aviso: aviso || null
    };
}

async function leerCotizaciones(pool) {
    const registro = await obtenerRegistroSgcPersistido(pool, athF09.CODIGO_FORMATO);
    const datos = athF09.sanitizarDatos(registro?.datos_json || {});
    return datos.cotizaciones || [];
}

async function resolverHoja(spreadsheetId) {
    const auth = driveService.getAuthClient();
    if (!auth) return null;
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hojas = meta.data.sheets || [];
    const exacta = hojas.find((s) => String(s.properties?.title || '').trim() === SHEET_TITLE);
    const parecida = hojas.find((s) => /plantilla/i.test(String(s.properties?.title || '')));
    const hoja = exacta || parecida || hojas[0];
    if (!hoja?.properties) return null;
    return {
        sheetId: hoja.properties.sheetId,
        title: String(hoja.properties.title || SHEET_TITLE).trim() || SHEET_TITLE
    };
}

async function resolverDriveFileId() {
    return TEMPLATE_DRIVE_ID;
}

async function escribirValores(spreadsheetId, sheetTitle, filas) {
    const auth = driveService.getAuthClient();
    if (!auth) return;
    const sheets = google.sheets({ version: 'v4', auth });
    const clearHasta = DATA_START_ROW + MAX_FILAS - 1;
    if (!filas.length) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `'${sheetTitle}'!A${DATA_START_ROW}:J${clearHasta}`
        });
        return;
    }
    const values = filas.map((fila) => ([
        fila.numero,
        fila.numeroCotizacion,
        fila.numeroProyecto,
        fila.empresa,
        fila.nombreProyecto,
        fila.responsable,
        fila.observaciones,
        '',
        '',
        fila.estatus
    ]));
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetTitle}'!A${DATA_START_ROW}`,
        valueInputOption: 'RAW',
        requestBody: { values }
    });
    const sobrante = DATA_START_ROW + filas.length;
    if (sobrante <= clearHasta) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `'${sheetTitle}'!A${sobrante}:J${clearHasta}`
        });
    }
}

function altoFila(fila) {
    const obs = String(fila.observaciones || '');
    const nombre = String(fila.nombreProyecto || '');
    const saltos = obs.split('\n').length;
    const porTexto = Math.ceil(Math.max(obs.length, nombre.length) / 42);
    return Math.min(110, Math.max(24, 18 + Math.max(saltos, porTexto) * 16));
}

async function aplicarFormatoTabla(spreadsheetId, sheetId, filas) {
    const auth = driveService.getAuthClient();
    if (!auth || sheetId == null) return;
    const sheets = google.sheets({ version: 'v4', auth });
    const inicio = DATA_START_ROW - 1;
    const n = filas.length;
    const finDatos = inicio + n;
    const finLimpieza = inicio + MAX_FILAS;
    const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                unmergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: inicio,
                        endRowIndex: finLimpieza,
                        startColumnIndex: 6,
                        endColumnIndex: 9
                    }
                }
            }]
        }
    }).catch(() => { /* el bloque puede no tener fusiones */ });

    const requests = [];
    const bordeRango = (startRow, endRow, startCol, endCol, interiores) => ({
        updateBorders: {
            range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: endRow,
                startColumnIndex: startCol,
                endColumnIndex: endCol
            },
            top: BORDE,
            bottom: BORDE,
            left: BORDE,
            right: BORDE,
            ...(interiores ? { innerHorizontal: BORDE, innerVertical: BORDE } : {})
        }
    });

    if (n > 0) {
        for (let i = 0; i < n; i += 1) {
            requests.push({
                mergeCells: {
                    range: {
                        sheetId,
                        startRowIndex: inicio + i,
                        endRowIndex: inicio + i + 1,
                        startColumnIndex: 6,
                        endColumnIndex: 9
                    },
                    mergeType: 'MERGE_ALL'
                }
            });
        }

        const formato = (startCol, endCol, horizontal) => ({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: inicio,
                    endRowIndex: finDatos,
                    startColumnIndex: startCol,
                    endColumnIndex: endCol
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: horizontal,
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                        textFormat,
                        backgroundColor: { red: 1, green: 1, blue: 1 }
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,backgroundColor)'
            }
        });
        requests.push(formato(0, 3, 'CENTER'));
        requests.push(formato(3, 9, 'LEFT'));

        filas.forEach((fila, i) => {
            const cerrado = fila.estatus === 'Cerrado';
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: inicio + i,
                        endRowIndex: inicio + i + 1,
                        startColumnIndex: 9,
                        endColumnIndex: COL_FIN
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: hexRgb(cerrado ? COLOR_CERRADO : COLOR_ABIERTO),
                            horizontalAlignment: 'CENTER',
                            verticalAlignment: 'MIDDLE',
                            wrapStrategy: 'WRAP',
                            textFormat: {
                                fontFamily: 'Century Gothic',
                                fontSize: 11,
                                bold: true,
                                foregroundColor: hexRgb(cerrado ? COLOR_CERRADO_TEXTO : COLOR_ABIERTO_TEXTO)
                            }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
                }
            });
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: inicio + i,
                        endIndex: inicio + i + 1
                    },
                    properties: { pixelSize: altoFila(fila) },
                    fields: 'pixelSize'
                }
            });
        });
    }

    const limpiarDesde = n > 0 ? finDatos : inicio;
    if (limpiarDesde < finLimpieza) {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: limpiarDesde,
                    endRowIndex: limpiarDesde + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COL_FIN
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 1, green: 1, blue: 1 },
                        borders: {
                            top: BORDE,
                            bottom: SIN_BORDE,
                            left: SIN_BORDE,
                            right: SIN_BORDE
                        }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,borders)'
            }
        });
        if (limpiarDesde + 1 < finLimpieza) {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: limpiarDesde + 1,
                        endRowIndex: finLimpieza,
                        startColumnIndex: 0,
                        endColumnIndex: COL_FIN
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                            borders: {
                                top: SIN_BORDE,
                                bottom: SIN_BORDE,
                                left: SIN_BORDE,
                                right: SIN_BORDE
                            }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,borders)'
                }
            });
        }
        requests.push({
            updateBorders: {
                range: {
                    sheetId,
                    startRowIndex: limpiarDesde,
                    endRowIndex: finLimpieza,
                    startColumnIndex: 0,
                    endColumnIndex: COL_FIN
                },
                top: BORDE,
                bottom: SIN_BORDE,
                left: SIN_BORDE,
                right: SIN_BORDE,
                innerHorizontal: SIN_BORDE,
                innerVertical: SIN_BORDE
            }
        });
    }

    const finTabla = n > 0 ? finDatos : HEADER_ROW;
    requests.push(bordeRango(HEADER_ROW - 1, finTabla, 0, 6, true));
    requests.push(bordeRango(HEADER_ROW - 1, finTabla, 9, COL_FIN, true));
    for (let i = HEADER_ROW - 1; i < finTabla; i += 1) {
        requests.push(bordeRango(i, i + 1, 6, 9, false));
    }

    const CHUNK = 80;
    for (let i = 0; i < requests.length; i += CHUNK) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: requests.slice(i, i + CHUNK) }
        });
    }
}

async function publicarHoja(spreadsheetId, filas) {
    const hoja = await resolverHoja(spreadsheetId);
    if (!hoja) throw new Error('La hoja Plantilla de SP-F-04 no está disponible.');
    await escribirValores(spreadsheetId, hoja.title, filas);
    await aplicarFormatoTabla(spreadsheetId, hoja.sheetId, filas);
}

async function cargarFormato(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const forzar = opciones.forzar === true;
    const registro = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO);
    const [cotizaciones, actividades] = await Promise.all([
        leerCotizaciones(pool),
        controlProyectos.obtenerProyectos(pool)
    ]);
    const filas = armarFilas(cotizaciones, actividades);
    const datos = {
        revision: '00',
        fechaRevision: '2020-10-13',
        fechaElaboracion: excelHistorial.fechaAhoraMexicoIso().slice(0, 10),
        filas,
        firma: firmaFilas(filas)
    };

    let driveFileId = '';
    let aviso = '';
    try {
        driveFileId = await resolverDriveFileId(pool, registro, opciones.recopiar === true);
        const firmaPrevia = String(registro?.datos_json?.firma || '');
        const mismaFirma = firmaPrevia && firmaPrevia === datos.firma && !forzar && !opciones.recopiar;
        if (!mismaFirma) {
            await driveService.asignarPermisoEscrituraEnlace(driveFileId);
            await publicarHoja(driveFileId, filas);
            await persistirRegistroSgc(pool, CODIGO_FORMATO, {
                driveFileId,
                fechaElaboracionOriginal: datos.fechaElaboracion,
                fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
                contenidoModificado: true,
                datos
            });
        } else if (driveFileId && driveFileId !== registro?.drive_file_id) {
            await persistirRegistroSgc(pool, CODIGO_FORMATO, {
                driveFileId,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
                contenidoModificado: false,
                datos
            });
        }
    } catch (error) {
        aviso = error?.message || 'No se pudo actualizar la hoja de SP-F-04.';
        console.warn('[SP-F-04]', aviso);
    }

    const registroFinal = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO).catch(() => registro);
    return await construirRespuesta(datos, driveFileId || registroFinal?.drive_file_id, registroFinal || registro, aviso);
}

async function actualizarPlantillaDesdeSistema(pool) {
    return cargarFormato(pool, { forzar: true, recopiar: true });
}

async function descargarPlantillaPdf(pool) {
    const payload = await cargarFormato(pool, { forzar: true });
    const id = String(payload?.driveFileId || TEMPLATE_DRIVE_ID).trim();
    const hoja = await resolverHoja(id);
    if (!hoja || hoja.sheetId == null) {
        throw new Error('No se encontró la hoja Plantilla para exportar a PDF.');
    }
    const n = Array.isArray(payload?.datos?.filas) ? payload.datos.filas.length : 0;
    const pdfBuffer = await driveService.exportarGoogleSheetComoPDF(id, {
        gid: String(hoja.sheetId),
        landscape: true,
        size: 'letter',
        fitToWidth: true,
        margins: 'normal',
        range: {
            r1: 0,
            r2: DATA_START_ROW + Math.max(n, 1),
            c1: 0,
            c2: COL_FIN
        }
    });
    if (!pdfBuffer || !pdfBuffer.length) {
        throw new Error('La exportación a PDF de SP-F-04 quedó vacía.');
    }
    return pdfBuffer;
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    cargarFormato,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    armarFilas,
    partirFolio
};
