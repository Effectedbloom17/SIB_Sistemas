/**
 * SP-F-04 · Control de Proyectos Biznaga 2026.
 * Plantilla externa (solo diseño) + archivo sistema (historial SPF04-MMAA / _N + histograma).
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
/**
 * Plantilla maestra (solo estructura/diseño). El sistema la lee y copia; nunca escribe aquí.
 * https://docs.google.com/spreadsheets/d/1y87zEHPmEboXR7y5GAjpPbJPb3Ps0sm62cknZACMhOs
 */
const TEMPLATE_DRIVE_ID = '1y87zEHPmEboXR7y5GAjpPbJPb3Ps0sm62cknZACMhOs';
/**
 * Archivo de trabajo Centro SGC (historial SPF04-MMAA / _N + histograma).
 * https://docs.google.com/spreadsheets/d/1efmyxhAYxuN-H0BxGpUlSsYb3uhutWKDYBTHh8SfnMo
 */
const DRIVE_FILE_ID_SISTEMA = '1efmyxhAYxuN-H0BxGpUlSsYb3uhutWKDYBTHh8SfnMo';
/** Nombre de la pestaña en el archivo plantilla externo. */
const TEMPLATE_SHEET_TITLE = 'Plantilla';
const MAX_COLUMNAS_SISTEMA = 10;
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

/** Nombre de hoja base del mes actual (SPF04-MMAA). */
function nombreHojaMesActual(fechaIso = null) {
    return excelHistorial.nombreHojaHistorialInformacion(
        CODIGO_FORMATO,
        fechaIso || excelHistorial.fechaAhoraMexicoIso()
    );
}

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
    if (n === 'concluido' || n === 'listo') return 100;
    if (n === 'en revision') return 75;
    if (n === 'en proceso' || n === 'en curso') return 50;
    return 0;
}

function avanceProyecto(actividades) {
    if (!actividades.length) return 0;
    const suma = actividades.reduce((acc, actividad) => acc + avanceActividad(actividad), 0);
    return Math.round(suma / actividades.length);
}

/** Clave canónica alineada a Control de Proyectos (etiquetas de UI entre paréntesis). */
function claveEstatusActividad(actividad) {
    const n = normalizarTexto(actividad?.estatus);
    if (n === 'concluido' || n === 'listo' || n === 'finalizado' || n === 'hecho') return 'listo';
    if (n === 'en revision' || n === 'revision') return 'enRevision';
    if (n === 'en proceso' || n === 'en curso' || n === 'en progreso') return 'enCurso';
    return 'noIniciado';
}

function resumenActividadesProyecto(actividades) {
    const lista = Array.isArray(actividades) ? actividades : [];
    const porEstatus = {
        noIniciado: 0,
        enCurso: 0,
        enRevision: 0,
        listo: 0
    };
    for (const actividad of lista) {
        porEstatus[claveEstatusActividad(actividad)] += 1;
    }
    const total = lista.length;
    // Disponibles = aún no concluidas (siguen en el flujo).
    const disponibles = porEstatus.noIniciado + porEstatus.enCurso + porEstatus.enRevision;
    return { total, disponibles, porEstatus };
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
    const resumenActs = resumenActividadesProyecto(actividades);
    const fechas = actividades.map((a) => String(a.createdAt || '')).filter(Boolean).sort();
    const empresaIdRaw = Number(
        cotizacion?.empresaId
        || cotizacion?.empresa_id
        || base.empresaId
        || base.empresa_id
        || 0
    );
    return {
        numero,
        numeroCotizacion: conFormato ? partes.cotizacion : '',
        numeroProyecto: conFormato ? partes.proyecto : (normalizarFolio(base.folio) || partes.proyecto),
        empresaId: Number.isInteger(empresaIdRaw) && empresaIdRaw > 0 ? empresaIdRaw : null,
        empresa: String(cotizacion?.empresa || base.empresaNombre || '').trim(),
        nombreProyecto: String(nombre || '').trim(),
        responsable: responsables,
        observaciones,
        estatus: avance >= 100 ? 'Cerrado' : 'Abierto',
        avance,
        totalActividades: resumenActs.total,
        actividadesDisponibles: resumenActs.disponibles,
        actividadesPorEstatus: resumenActs.porEstatus,
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

/**
 * Última versión del mes: SPF04-1026_3 > SPF04-1026_2 > SPF04-1026.
 */
function resolverTituloMesMasReciente(titulos, mesBase = null) {
    const mes = String(mesBase || nombreHojaMesActual()).trim();
    const lista = Array.isArray(titulos) ? titulos : [];
    const delMes = lista
        .map((t) => String(t || '').trim())
        .filter((t) => t === mes || new RegExp(`^${mes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`, 'i').test(t))
        .map((titulo) => ({
            titulo,
            fecha: excelHistorial.parsearFechaHojaHistorial(titulo, CODIGO_FORMATO)
        }))
        .filter((item) => item.fecha)
        .sort((a, b) => b.fecha.sortKey - a.fecha.sortKey);
    return delMes[0]?.titulo || null;
}

async function resolverDriveFileId(registro = null) {
    if (DRIVE_FILE_ID_SISTEMA) {
        const existeSistema = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA).catch(() => false);
        if (existeSistema) return DRIVE_FILE_ID_SISTEMA;
    }
    const idDb = String(registro?.drive_file_id || '').trim();
    if (idDb && idDb !== TEMPLATE_DRIVE_ID) {
        const existe = await driveService.verificarArchivoExiste(idDb).catch(() => false);
        if (existe) return idDb;
    }
    return DRIVE_FILE_ID_SISTEMA || null;
}

/**
 * Copia la hoja «Plantilla» del archivo plantilla externo al archivo sistema.
 */
async function adoptarPlantillaEnSistema(spreadsheetId, tituloDestino = null) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('El archivo plantilla no puede usarse como destino de copia SP-F-04.');
    }
    const destino = String(tituloDestino || '').trim() || nombreHojaMesActual();
    console.warn(
        `[SP-F-04] Copiando hoja «${TEMPLATE_SHEET_TITLE}» desde plantilla `
        + `${TEMPLATE_DRIVE_ID} → sistema como «${destino}» (o _N si ya existe).`
    );
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        destino
    );
    try {
        await driveService.copiarAnchosColumnasGoogleSheet(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            spreadsheetId,
            copiada.title,
            MAX_COLUMNAS_SISTEMA
        );
    } catch (err) {
        console.warn('[SP-F-04] Anchos de columna desde plantilla:', err.message);
    }
    return copiada;
}

async function resolverTituloHojaVigente(spreadsheetId) {
    const mesActual = nombreHojaMesActual();
    let titulos = [];
    try {
        titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    } catch (err) {
        console.warn('[SP-F-04] No se pudieron listar hojas:', err.message);
    }

    const delMes = resolverTituloMesMasReciente(titulos, mesActual);
    if (delMes) return delMes;

    try {
        const vigente = await excelHistorial.resolverTituloHojaVigenteDesdeDrive(
            spreadsheetId,
            TEMPLATE_SHEET_TITLE,
            CODIGO_FORMATO
        );
        const nombre = String(vigente || '').trim();
        if (nombre && titulos.some((t) => String(t).trim() === nombre)) {
            return nombre;
        }
    } catch (err) {
        console.warn('[SP-F-04] No se pudo resolver hoja vigente:', err.message);
    }

    return titulos[0] || mesActual;
}

async function obtenerMetaHojaPorTitulo(spreadsheetId, titulo) {
    if (!spreadsheetId || !titulo) return null;
    const auth = driveService.getAuthClient();
    if (!auth) return null;
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const hojas = meta.data.sheets || [];
    const exacta = hojas.find((s) => String(s.properties?.title || '').trim() === titulo);
    if (!exacta?.properties) return null;
    return {
        sheetId: exacta.properties.sheetId,
        title: String(exacta.properties.title || titulo).trim() || titulo
    };
}

async function construirRespuesta(datos, driveFileId, registro, aviso, tituloHoja = null) {
    const id = String(driveFileId || '').trim();
    let gid = null;
    let titulo = String(tituloHoja || '').trim();
    if (id && id !== TEMPLATE_DRIVE_ID) {
        if (!titulo) {
            titulo = await resolverTituloHojaVigente(id).catch(() => '');
        }
        if (titulo) {
            gid = await driveService.obtenerGidHojaPorNombre(id, titulo).catch(() => null);
        }
    }
    return {
        codigo: CODIGO_FORMATO,
        datos,
        driveFileId: id && id !== TEMPLATE_DRIVE_ID ? id : (DRIVE_FILE_ID_SISTEMA || null),
        sheetTitle: titulo || null,
        editorUrl: id && id !== TEMPLATE_DRIVE_ID
            ? driveService.construirUrlEditorGoogleSheet(id, { gid })
            : null,
        previewUrl: id && id !== TEMPLATE_DRIVE_ID
            ? driveService.construirUrlEditorGoogleSheet(id, { modo: 'preview', gid })
            : null,
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

async function publicarHoja(spreadsheetId, sheetTitle, sheetId, filas) {
    await escribirValores(spreadsheetId, sheetTitle, filas);
    await aplicarFormatoTabla(spreadsheetId, sheetId, filas);
}

/**
 * Crea una nueva pestaña del mes (SPF04-MMAA o SPF04-MMAA_N) desde la plantilla externa
 * y escribe los datos. No sobrescribe versiones previas ni el histograma.
 */
async function publicarNuevaVersionMes(spreadsheetId, filas) {
    if (!spreadsheetId || spreadsheetId === TEMPLATE_DRIVE_ID) {
        throw new Error('No se puede publicar SP-F-04 sobre el archivo plantilla.');
    }
    const mesActual = nombreHojaMesActual();
    const copiada = await adoptarPlantillaEnSistema(spreadsheetId, mesActual);
    await publicarHoja(spreadsheetId, copiada.title, copiada.sheetId, filas);
    try {
        await driveService.moverHojaAlInicioGoogleSheet(spreadsheetId, copiada.title);
    } catch (_) { /* opcional */ }
    return copiada;
}

/**
 * Asegura que exista al menos una hoja del mes vigente (sin crear versión extra).
 */
async function asegurarHojaMesVigente(spreadsheetId, filas) {
    const mesActual = nombreHojaMesActual();
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId).catch(() => []);
    const vigente = resolverTituloMesMasReciente(titulos, mesActual);
    if (vigente) {
        const meta = await obtenerMetaHojaPorTitulo(spreadsheetId, vigente);
        return meta || { title: vigente, sheetId: null };
    }
    return publicarNuevaVersionMes(spreadsheetId, filas);
}

async function cargarFormato(pool, opciones = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
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
    let tituloHoja = '';
    try {
        driveFileId = await resolverDriveFileId(registro);
        if (!driveFileId || driveFileId === TEMPLATE_DRIVE_ID) {
            throw new Error('No hay archivo sistema SP-F-04 configurado (DRIVE_FILE_ID_SISTEMA).');
        }

        const firmaPrevia = String(registro?.datos_json?.firma || '');
        const hayCambioDatos = !firmaPrevia || firmaPrevia !== datos.firma;
        // Nueva pestaña del mes solo con cambios reales o al regenerar desde plantilla (root).
        // «Actualizar» con los mismos datos no crea _N de más.
        const crearVersion = hayCambioDatos || opciones.recopiar === true;
        await driveService.asignarPermisoEscrituraEnlace(driveFileId);

        let hoja;
        if (crearVersion) {
            // SPF04-MMAA, luego SPF04-MMAA_2, _3… No toca meses previos ni el histograma.
            hoja = await publicarNuevaVersionMes(driveFileId, filas);
            await persistirRegistroSgc(pool, CODIGO_FORMATO, {
                driveFileId,
                fechaElaboracionOriginal: datos.fechaElaboracion,
                fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
                contenidoModificado: true,
                datos
            });
        } else {
            hoja = await asegurarHojaMesVigente(driveFileId, filas);
            if (driveFileId && driveFileId !== registro?.drive_file_id) {
                await persistirRegistroSgc(pool, CODIGO_FORMATO, {
                    driveFileId,
                    fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
                    fechaModificacionContenido: registro?.fecha_modificacion_contenido || null,
                    contenidoModificado: false,
                    datos
                });
            }
        }
        tituloHoja = hoja?.title || '';
    } catch (error) {
        aviso = error?.message || 'No se pudo actualizar la hoja de SP-F-04.';
        console.warn('[SP-F-04]', aviso);
    }

    const registroFinal = await obtenerRegistroSgcPersistido(pool, CODIGO_FORMATO).catch(() => registro);
    return await construirRespuesta(
        datos,
        driveFileId || registroFinal?.drive_file_id,
        registroFinal || registro,
        aviso,
        tituloHoja
    );
}

async function actualizarPlantillaDesdeSistema(pool) {
    return cargarFormato(pool, { forzar: true, recopiar: true });
}

async function descargarPlantillaPdf(pool) {
    const payload = await cargarFormato(pool, { forzar: false });
    const id = String(payload?.driveFileId || DRIVE_FILE_ID_SISTEMA).trim();
    if (!id || id === TEMPLATE_DRIVE_ID) {
        throw new Error('No hay archivo sistema SP-F-04 para exportar a PDF.');
    }
    const titulo = String(payload?.sheetTitle || '').trim()
        || await resolverTituloHojaVigente(id);
    const hoja = await obtenerMetaHojaPorTitulo(id, titulo);
    if (!hoja || hoja.sheetId == null) {
        throw new Error(`No se encontró la hoja vigente «${titulo || nombreHojaMesActual()}» para exportar a PDF.`);
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
    DRIVE_FILE_ID_SISTEMA,
    TEMPLATE_SHEET_TITLE,
    cargarFormato,
    actualizarPlantillaDesdeSistema,
    descargarPlantillaPdf,
    armarFilas,
    partirFolio,
    nombreHojaMesActual
};
